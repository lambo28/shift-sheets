import json
import os
from datetime import datetime, timedelta, date, time, UTC
from flask import url_for, request, redirect, jsonify, current_app, flash

from extensions import db
from constants import MIN_REST_HOURS, MAX_WORK_HOURS_PER_24H, EXTRA_CAR_MIN_PARTIAL_HOURS
from models import (
    Driver, ShiftPattern, ShiftTiming, DriverCustomTiming, DriverAssignment,
    DriverHoliday, ShiftAdjustment, ShiftSwap, SchoolTerm, SchoolClosureDate,
    ExtraCarRequest, ExtraCarAssignment, AppSetting,
    normalize_day_shifts, compact_day_shifts, iter_pattern_shift_types,
    resolve_request_relative_datetime,
)

_bundle_manifest_cache = {"mtime": None, "data": {}}


def get_bundle_manifest():
    manifest_path = current_app.static_folder and os.path.join(current_app.static_folder, "js", "bundles", "manifest.json")
    if not manifest_path or not os.path.exists(manifest_path):
        _bundle_manifest_cache["mtime"] = None
        _bundle_manifest_cache["data"] = {}
        return _bundle_manifest_cache["data"]

    current_mtime = os.path.getmtime(manifest_path)
    if _bundle_manifest_cache["mtime"] != current_mtime:
        try:
            with open(manifest_path, "r", encoding="utf-8") as manifest_file:
                _bundle_manifest_cache["data"] = json.load(manifest_file)
        except (OSError, json.JSONDecodeError):
            _bundle_manifest_cache["data"] = {}
        _bundle_manifest_cache["mtime"] = current_mtime

    return _bundle_manifest_cache["data"]


def bundle_url(bundle_name):
    manifest = get_bundle_manifest()
    resolved_name = manifest.get(bundle_name, bundle_name)
    return url_for("static", filename=f"js/bundles/{resolved_name}")


def shift_label(shift_type):
    if not shift_type:
        return ''
    parts = str(shift_type).replace('_', ' ').split()
    return ' '.join(p.upper() if p.lower() in {'am', 'pm'} else p.capitalize() for p in parts)


def group_consecutive_holidays(holidays_list):
    """Group consecutive holiday dates into ranges for display."""
    if not holidays_list:
        return []

    # Keep groups isolated by driver + type + notes so records from different
    # drivers (or different time off categories) never get merged into one row.
    sorted_holidays = sorted(
        holidays_list,
        key=lambda h: (
            h.driver_id,
            h.time_off_type or "holiday",
            h.notes or "",
            h.holiday_date,
        ),
    )
    groups = []
    current_group = [sorted_holidays[0]]

    for holiday in sorted_holidays[1:]:
        # Check if this holiday belongs to the same logical group
        last = current_group[-1]
        same_driver = holiday.driver_id == last.driver_id
        same_type = (holiday.time_off_type or "holiday") == (last.time_off_type or "holiday")
        same_notes = (holiday.notes or "") == (last.notes or "")
        is_consecutive = (holiday.holiday_date - last.holiday_date).days == 1

        if same_driver and same_type and same_notes and is_consecutive:
            current_group.append(holiday)
        else:
            groups.append(current_group)
            current_group = [holiday]

    if current_group:
        groups.append(current_group)

    return groups


def shift_abbrev(shift_type, all_shifts_str=''):
    """Generate intelligent abbreviation for a shift type.

    Uses the first letter of each word for multi-word shift names, or a single
    letter initial for single-word names (falling back to the full initial if
    ambiguous within the pattern).
    """
    if not shift_type or shift_type == 'day_off':
        return 'OFF'

    words = str(shift_type).replace('_', ' ').split()
    if len(words) > 1:
        return ''.join(w[0].upper() for w in words)

    return shift_type[0].upper()


def is_ajax_request():
    return request.headers.get("X-Requested-With") == "XMLHttpRequest"


def json_success(**payload):
    response = {"success": True}
    response.update(payload)
    return jsonify(response)


def json_error(message, status_code=400):
    return jsonify({"success": False, "error": message}), status_code


def validation_error_response(message, redirect_factory=None, status_code=400, category="error"):
    """Return JSON for AJAX requests, otherwise flash and redirect.

    This keeps validation branches consistent across routes that support both
    API-style and form-style submissions.
    """
    if is_ajax_request():
        return json_error(message, status_code=status_code)

    flash(message, category)
    if redirect_factory:
        return redirect_factory()
    return redirect(request.url)


def validation_errors_response(messages, redirect_factory=None, status_code=400, category="error"):
    """Return/flash multiple validation errors consistently.

    For AJAX callers this returns a single json_error payload with messages
    joined by '; '. For form posts this flashes each message and redirects.
    """
    cleaned_messages = [str(msg) for msg in (messages or []) if str(msg).strip()]
    if not cleaned_messages:
        return validation_error_response(
            "Validation failed.",
            redirect_factory=redirect_factory,
            status_code=status_code,
            category=category,
        )

    if is_ajax_request():
        return json_error("; ".join(cleaned_messages), status_code=status_code)

    for message in cleaned_messages:
        flash(message, category)
    if redirect_factory:
        return redirect_factory()
    return redirect(request.url)


def transactional_response(operation_fn, success_message, error_message=None, redirect_url=None, redirect_fn=None):
    """Wrap database operations with automatic commit/rollback and response handling.
    
    Simplifies the common pattern of trying a database operation, committing on success,
    rolling back on error, and returning appropriate AJAX or flash+redirect responses.
    
    Args:
        operation_fn: Callable that performs the database operation (called within try block)
        success_message: Message to return/flash on success
        error_message: Message to return/flash on error (default: auto-generated)
        redirect_url: URL to redirect to on success (form posts only)
        redirect_fn: Function that returns URL on error (default: current URL)
    
    Returns:
        For AJAX: json_success() or json_error()
        For forms: redirect() with appropriate flash
    
    Example:
        return transactional_response(
            operation_fn=lambda: db.session.add(driver) or db.session.commit(),
            success_message="Driver added successfully!",
            redirect_url=url_for("drivers")
        )
    """
    try:
        operation_fn()
        # Success path
        if is_ajax_request():
            return json_success()
        flash(success_message, "success")
        return redirect(redirect_url or request.url)
    except Exception as e:
        db.session.rollback()
        error_msg = error_message or f"Operation failed: {str(e)}"
        if is_ajax_request():
            return json_error(error_msg)
        flash(error_msg, "error")
        if redirect_fn:
            return redirect_fn()
        return redirect(request.url)


def calculate_hours(start_time, end_time, break_minutes=0):
    """Calculate hours worked from time strings"""
    try:
        start = datetime.strptime(start_time, '%H:%M')
        end = datetime.strptime(end_time, '%H:%M')

        # Handle overnight shifts
        if end < start:
            end = end + timedelta(days=1)

        total_minutes = (end - start).total_seconds() / 60
        total_minutes -= break_minutes
        return max(0, total_minutes / 60)  # Convert to hours
    except (ValueError, TypeError):
        return 0.0


def get_operational_date():
    """Get current operational date considering 6am crossover"""
    now = datetime.now()
    if now.hour < 6:
        # Before 6am, still previous operational day
        return (now - timedelta(days=1)).date()
    else:
        # 6am or later, current operational day
        return now.date()


def get_drivers_count_by_shift(target_date):
    """Get count of drivers by shift type for a specific date"""
    drivers_by_shift = get_drivers_for_date(target_date)
    return {shift_type: len(drivers_list) for shift_type, drivers_list in drivers_by_shift.items()}


def is_driver_on_holiday(driver_id, target_date):
    """Return True when the driver has an approved holiday on target_date."""
    return (
        DriverHoliday.query.filter_by(driver_id=driver_id, holiday_date=target_date).first()
        is not None
    )


def get_drivers_for_date(target_date):
    """Get all drivers working on a specific date with their shift assignments and timing info"""
    all_timings = ShiftTiming.query.all()
    timings_dict = {t.shift_type: t for t in all_timings}

    # Pre-build buckets for top-level (non-sub) shift types only
    drivers_working = {}
    for t in all_timings:
        if not t.parent_shift_type:
            drivers_working[t.shift_type] = []

    # Collect all driver IDs to check: pattern-based assignments + work-day swaps
    assignments = get_active_assignments_for_date(target_date)
    driver_ids = {a.driver_id for a in assignments}

    # Also include drivers who are working via a swap on this date (they may
    # have no matching pattern assignment for this date).
    swap_workers = ShiftSwap.query.filter(
        ShiftSwap.date_b == target_date,
        ShiftSwap.work_shift_type.isnot(None),
    ).with_entities(ShiftSwap.driver_a_id).all()
    for row in swap_workers:
        driver_ids.add(row.driver_a_id)

    extra_workers = (
        ExtraCarAssignment.query
        .join(ExtraCarRequest, ExtraCarAssignment.request_id == ExtraCarRequest.id)
        .filter(ExtraCarRequest.date == target_date)
        .with_entities(ExtraCarAssignment.driver_id)
        .all()
    )
    for row in extra_workers:
        driver_ids.add(row.driver_id)

    if not driver_ids:
        return drivers_working

    drivers = Driver.query.filter(Driver.id.in_(driver_ids)).all()

    for driver in drivers:
        effective_shifts = get_driver_shifts_for_date(
            driver,
            target_date,
            timings_dict,
            include_swaps=True,
            include_extra=True,
        )
        for entry in effective_shifts:
            shift_type = entry['shift_type']
            if shift_type == 'day_off':
                continue

            driver_info = {
                'driver': driver,
                'start_time': entry['start_time'],
                'end_time': entry['end_time'],
                'is_custom': entry.get('is_override') or entry.get('is_custom_time'),
                'is_adjusted': entry['is_adjusted'],
                'timing_note': None,
                'shift_type': shift_type,
            }

            # Determine where to group this driver
            current_timing = timings_dict.get(shift_type)
            if current_timing and current_timing.parent_shift_type:
                # Sub-shift: group under parent bucket
                parent = current_timing.parent_shift_type
                if parent not in drivers_working:
                    drivers_working[parent] = []
                drivers_working[parent].append(driver_info)
            else:
                if shift_type not in drivers_working:
                    drivers_working[shift_type] = []
                drivers_working[shift_type].append(driver_info)

    return drivers_working


def get_driver_shifts_for_date(driver, target_date, timings_dict=None, include_swaps=True, include_extra=False):
    if timings_dict is None:
        all_timings = ShiftTiming.query.all()
        timings_dict = {timing.shift_type: timing for timing in all_timings}

    extra_entries = []
    if include_extra:
        extra_assignments = (
            ExtraCarAssignment.query
            .join(ExtraCarRequest, ExtraCarAssignment.request_id == ExtraCarRequest.id)
            .filter(
                ExtraCarAssignment.driver_id == driver.id,
                ExtraCarRequest.date == target_date,
            )
            .order_by(ExtraCarAssignment.id.asc())
            .all()
        )

        for extra_assignment in extra_assignments:
            request_start, request_end = extra_assignment.request.get_time_window()
            effective_start = extra_assignment.effective_start()
            effective_end = extra_assignment.effective_end()
            if not request_start or not request_end or not effective_start or not effective_end:
                continue

            _req = extra_assignment.request
            is_custom_time = False
            if _req.request_type == 'time_window':
                extra_label = 'Custom'
                is_custom_time = True
            else:
                # For shift_type requests: check if assignment times match the shift's nominal times
                _timing = timings_dict.get(_req.shift_type)
                assign_start = extra_assignment.effective_start()
                assign_end = extra_assignment.effective_end()
                if _timing and assign_start and assign_end:
                    shift_start_datetime = datetime.combine(target_date, _timing.start_time)
                    shift_end_datetime = datetime.combine(target_date, _timing.end_time)
                    if shift_end_datetime <= shift_start_datetime:
                        shift_end_datetime += timedelta(days=1)
                    # If assignment times match shift's nominal times: use shift name, not custom
                    if (assign_start.time() == _timing.start_time and
                        assign_end.time() == _timing.end_time):
                        extra_label = _timing.display_label
                        is_custom_time = False
                    else:
                        extra_label = 'Custom'
                        is_custom_time = True
                else:
                    extra_label = _req.shift_type.replace('_', ' ').title() if _req.shift_type else 'Extra'
                    is_custom_time = False
            extra_entries.append({
                'shift_type': 'extra_car',
                'label': extra_label,
                'badge_color': 'bg-danger',
                'icon': 'fas fa-plus',
                'start_time': effective_start.time(),
                'end_time': effective_end.time(),
                'default_start_time': request_start.time(),
                'default_end_time': request_end.time(),
                'is_override': False,
                'is_custom_time': is_custom_time,
                'is_adjusted': False,
                'is_swap': False,
                'swap_role': None,
                'is_extra': True,
            })

    def finalize_entries(base_entries):
        merged_entries = list(base_entries)
        if extra_entries:
            # Suppress plain day-off entries — the extra shift IS the work for this day
            merged_entries = [e for e in merged_entries if e.get('shift_type') != 'day_off']
            merged_entries.extend(extra_entries)
        merged_entries.sort(
            key=lambda item: (
                item['start_time'] is None,
                item['start_time'] or datetime.min.time(),
                item['label'],
            )
        )
        return merged_entries

    def build_day_off_entry(is_swap=False, swap_role=None):
        return {
            'shift_type': 'day_off',
            'label': 'OFF',
            'badge_color': 'bg-secondary',
            'icon': 'fas fa-user-clock',
            'start_time': None,
            'end_time': None,
            'default_start_time': None,
            'default_end_time': None,
            'is_override': False,
            'is_custom_time': False,
            'is_adjusted': False,
            'is_swap': is_swap,
            'swap_role': swap_role,
            'is_extra': False,
        }

    school_term_day_cache: dict = {}

    def is_shift_allowed_for_date(shift_type):
        return _is_shift_type_allowed_on_date(shift_type, timings_dict, target_date, school_term_day_cache)

    if is_driver_on_holiday(driver.id, target_date):
        return finalize_entries([])

    if include_swaps:
        swaps_for_date = ShiftSwap.query.filter(
            ShiftSwap.driver_a_id == driver.id,
            ShiftSwap.driver_b_id == driver.id,
            ShiftSwap.work_shift_type.isnot(None),
            db.or_(
                ShiftSwap.date_a == target_date,
                ShiftSwap.date_b == target_date,
            )
        ).order_by(ShiftSwap.id.desc()).all()

        work_day_swaps = [swap for swap in swaps_for_date if swap.date_b == target_date]
        if work_day_swaps:
            latest_late_start, earliest_early_finish = get_adjustment_conflict_bounds(driver.id, target_date)
            swap_entries = []

            for swap in work_day_swaps:
                effective_shift_type = swap.work_shift_type
                timing_meta = timings_dict.get(effective_shift_type)
                if not timing_meta:
                    continue

                start_time = timing_meta.start_time
                end_time = timing_meta.end_time

                adjusted_start_time = start_time
                adjusted_end_time = end_time
                if latest_late_start is not None and adjusted_start_time is not None:
                    adjusted_start_time = latest_late_start
                if earliest_early_finish is not None and adjusted_end_time is not None:
                    adjusted_end_time = earliest_early_finish

                is_adjusted = (
                    adjusted_start_time != start_time
                    or adjusted_end_time != end_time
                )

                swap_entries.append({
                    'shift_type': effective_shift_type,
                    'label': timing_meta.display_label,
                    'badge_color': timing_meta.badge_color or 'bg-primary',
                    'icon': timing_meta.icon or 'fas fa-clock',
                    'start_time': adjusted_start_time,
                    'end_time': adjusted_end_time,
                    'default_start_time': timing_meta.start_time,
                    'default_end_time': timing_meta.end_time,
                    'is_override': False,
                    'is_custom_time': False,
                    'is_adjusted': is_adjusted,
                    'is_swap': True,
                    'swap_role': 'work',
                })

            if swap_entries:
                swap_entries.sort(key=lambda item: (item['start_time'] is None, item['start_time'] or datetime.min.time(), item['label']))
                return finalize_entries(swap_entries)

        give_up_only_swaps = [
            swap for swap in swaps_for_date
            if swap.date_a == target_date and swap.date_b != target_date
        ]
        if give_up_only_swaps:
            return finalize_entries([build_day_off_entry(is_swap=True, swap_role='give_up')])

    latest_late_start, earliest_early_finish = get_adjustment_conflict_bounds(driver.id, target_date)

    assignments = DriverAssignment.query.filter(
        DriverAssignment.driver_id == driver.id,
        DriverAssignment.start_date <= target_date,
        db.or_(
            DriverAssignment.end_date.is_(None),
            DriverAssignment.end_date >= target_date
        )
    ).all()

    entries = []
    filtered_term_only_shift = False
    for assignment in assignments:
        shift_types = assignment.get_shifts_for_date(target_date) or []
        if not shift_types:
            continue

        days_since_start = (target_date - assignment.start_date).days
        cycle_day = days_since_start % assignment.shift_pattern.cycle_length
        weekday = target_date.weekday()

        for base_shift_type in shift_types:
            custom_timing = DriverCustomTiming.get_custom_timing(
                assignment.driver_id,
                assignment.id,
                base_shift_type,
                cycle_day,
                weekday
            )

            effective_shift_type = base_shift_type
            if custom_timing and custom_timing.override_shift and custom_timing.override_shift in timings_dict:
                effective_shift_type = custom_timing.override_shift

            if not is_shift_allowed_for_date(effective_shift_type):
                timing_meta_for_filter = timings_dict.get(effective_shift_type) or timings_dict.get(base_shift_type)
                if timing_meta_for_filter and timing_meta_for_filter.school_term_only:
                    filtered_term_only_shift = True
                continue

            default_timing = timings_dict.get(effective_shift_type) or timings_dict.get(base_shift_type)

            if custom_timing and custom_timing.start_time is not None:
                start_time = custom_timing.start_time
            elif default_timing:
                start_time = default_timing.start_time
            else:
                start_time = None

            if custom_timing and custom_timing.end_time is not None:
                end_time = custom_timing.end_time
            elif default_timing:
                end_time = default_timing.end_time
            else:
                end_time = None

            adjusted_start_time = start_time
            adjusted_end_time = end_time

            if latest_late_start is not None and adjusted_start_time is not None:
                adjusted_start_time = latest_late_start
            if earliest_early_finish is not None and adjusted_end_time is not None:
                adjusted_end_time = earliest_early_finish

            is_adjusted = (
                adjusted_start_time != start_time
                or adjusted_end_time != end_time
            )

            start_time = adjusted_start_time
            end_time = adjusted_end_time

            default_start_time = default_timing.start_time if default_timing else None
            default_end_time = default_timing.end_time if default_timing else None

            timing_meta = timings_dict.get(effective_shift_type)
            if effective_shift_type == 'day_off':
                label = 'OFF'
                badge_color = 'bg-secondary'
                icon = 'fas fa-user-clock'
            elif timing_meta:
                label = timing_meta.display_label
                badge_color = timing_meta.badge_color or 'bg-primary'
                icon = timing_meta.icon or 'fas fa-clock'
            else:
                label = shift_label(effective_shift_type)
                badge_color = 'bg-primary'
                icon = 'fas fa-clock'

            entries.append({
                'shift_type': effective_shift_type,
                'label': label,
                'badge_color': badge_color,
                'icon': icon,
                'start_time': start_time,
                'end_time': end_time,
                'default_start_time': default_start_time,
                'default_end_time': default_end_time,
                'is_override': bool(custom_timing and custom_timing.override_shift),
                'is_custom_time': bool(custom_timing and (custom_timing.start_time is not None or custom_timing.end_time is not None)),
                'is_adjusted': is_adjusted,
                'is_swap': False,
                'swap_role': None,
                'is_extra': False,
            })

    if not entries and filtered_term_only_shift:
        entries.append(build_day_off_entry())

    return finalize_entries(entries)


def driver_has_working_shift_on_date(driver, target_date, timings_dict=None):
    """Return True when driver has at least one non-day-off shift on the target date."""
    shifts = get_driver_shifts_for_date(driver, target_date, timings_dict)
    return any(shift.get('shift_type') != 'day_off' for shift in shifts)


def get_driver_adjustment_time_window(driver, target_date, timings_dict=None):
    """Return (earliest_start, latest_end) from default/custom timings for the driver's working shifts on a date."""
    if timings_dict is None:
        all_timings = ShiftTiming.query.all()
        timings_dict = {timing.shift_type: timing for timing in all_timings}

    if is_driver_on_holiday(driver.id, target_date):
        return None, None

    # Check if this is a swapped work day
    work_day_swap = ShiftSwap.query.filter(
        ShiftSwap.driver_a_id == driver.id,
        ShiftSwap.driver_b_id == driver.id,
        ShiftSwap.date_b == target_date,
        ShiftSwap.work_shift_type.isnot(None)
    ).first()

    if work_day_swap:
        # For swapped work days, get timing from the work_shift_type
        timing = timings_dict.get(work_day_swap.work_shift_type)
        if timing and timing.start_time is not None and timing.end_time is not None:
            return timing.start_time, timing.end_time
        return None, None

    # Check if this is a give-up day (becomes day off)
    give_up_swap = ShiftSwap.query.filter(
        ShiftSwap.driver_a_id == driver.id,
        ShiftSwap.driver_b_id == driver.id,
        ShiftSwap.date_a == target_date
    ).first()

    if give_up_swap:
        # Give-up day becomes a day off, no adjustment window
        return None, None

    school_term_day_cache: dict = {}

    def is_shift_allowed_for_date(shift_type):
        return _is_shift_type_allowed_on_date(shift_type, timings_dict, target_date, school_term_day_cache)

    assignments = DriverAssignment.query.filter(
        DriverAssignment.driver_id == driver.id,
        DriverAssignment.start_date <= target_date,
        db.or_(
            DriverAssignment.end_date.is_(None),
            DriverAssignment.end_date >= target_date
        )
    ).all()

    window_starts = []
    window_ends = []

    for assignment in assignments:
        shift_types = assignment.get_shifts_for_date(target_date) or []
        if not shift_types:
            continue

        days_since_start = (target_date - assignment.start_date).days
        cycle_day = days_since_start % assignment.shift_pattern.cycle_length
        weekday = target_date.weekday()

        for base_shift_type in shift_types:
            if base_shift_type == 'day_off':
                continue

            custom_timing = DriverCustomTiming.get_custom_timing(
                assignment.driver_id,
                assignment.id,
                base_shift_type,
                cycle_day,
                weekday
            )

            effective_shift_type = base_shift_type
            if custom_timing and custom_timing.override_shift and custom_timing.override_shift in timings_dict:
                effective_shift_type = custom_timing.override_shift

            if not is_shift_allowed_for_date(effective_shift_type):
                continue

            default_timing = timings_dict.get(effective_shift_type) or timings_dict.get(base_shift_type)

            candidate_starts = []
            candidate_ends = []

            if default_timing and default_timing.start_time is not None:
                candidate_starts.append(default_timing.start_time)
            if custom_timing and custom_timing.start_time is not None:
                candidate_starts.append(custom_timing.start_time)

            if default_timing and default_timing.end_time is not None:
                candidate_ends.append(default_timing.end_time)
            if custom_timing and custom_timing.end_time is not None:
                candidate_ends.append(custom_timing.end_time)

            if candidate_starts and candidate_ends:
                window_starts.append(min(candidate_starts))
                window_ends.append(max(candidate_ends))

    if not window_starts or not window_ends:
        return None, None

    return min(window_starts), max(window_ends)


def get_adjustment_conflict_bounds(driver_id, target_date, exclude_adjustment_id=None):
    """Return (latest_late_start, earliest_early_finish) from existing adjustments on same date."""
    query = ShiftAdjustment.query.filter(
        ShiftAdjustment.driver_id == driver_id,
        ShiftAdjustment.adjustment_date == target_date,
    )

    if exclude_adjustment_id is not None:
        query = query.filter(ShiftAdjustment.id != exclude_adjustment_id)

    adjustments = query.all()
    late_starts = [a.adjusted_time for a in adjustments if a.adjustment_type == 'late_start']
    early_finishes = [a.adjusted_time for a in adjustments if a.adjustment_type == 'early_finish']

    latest_late_start = max(late_starts) if late_starts else None
    earliest_early_finish = min(early_finishes) if early_finishes else None
    return latest_late_start, earliest_early_finish


def is_split_shift_day(driver, target_date, timings_dict=None, include_swaps=True):
    """Return True when a date has two or more non-extra working shifts for the driver."""
    shifts = get_driver_shifts_for_date(
        driver,
        target_date,
        timings_dict=timings_dict,
        include_extra=True,
        include_swaps=include_swaps,
    )
    working_shifts = [
        shift for shift in shifts
        if shift.get('shift_type') != 'day_off' and not shift.get('is_extra')
    ]
    return len(working_shifts) >= 2


def validate_adjustment_time(driver, target_date, adjustment_type, adjusted_time, exclude_adjustment_id=None):
    """Validate adjustment time against working window and existing opposite adjustments.

    Rules:
    - Window start is the earliest start between default and custom timing.
    - Window end is the latest end between default and custom timing.
    - late_start must be strictly inside (window_start, window_end).
    - early_finish must be strictly inside (window_start, window_end).
    - Existing opposite adjustments further tighten allowed bounds.
    """
    all_timings = ShiftTiming.query.all()
    timings_dict = {timing.shift_type: timing for timing in all_timings}

    if is_split_shift_day(driver, target_date, timings_dict=timings_dict, include_swaps=True):
        return "Cannot set adjustment on a split shift day."

    if not driver_has_working_shift_on_date(driver, target_date, timings_dict):
        return "Cannot set adjustment on a day off or time off day."

    window_start, window_end = get_driver_adjustment_time_window(driver, target_date, timings_dict)
    if window_start is None or window_end is None:
        return "Could not determine shift time window for this day."

    latest_late_start, earliest_early_finish = get_adjustment_conflict_bounds(
        driver.id,
        target_date,
        exclude_adjustment_id=exclude_adjustment_id,
    )

    lower_bound = window_start
    upper_bound = window_end

    if adjustment_type == 'late_start' and earliest_early_finish and earliest_early_finish < upper_bound:
        upper_bound = earliest_early_finish
    if adjustment_type == 'early_finish' and latest_late_start and latest_late_start > lower_bound:
        lower_bound = latest_late_start

    if upper_bound <= lower_bound:
        return "Existing adjustments leave no valid time window on this day."

    if adjusted_time <= lower_bound:
        label = "Late start" if adjustment_type == 'late_start' else "Early finish"
        return f"{label} must be later than {lower_bound.strftime('%H:%M')}."

    if adjusted_time >= upper_bound:
        label = "Late start" if adjustment_type == 'late_start' else "Early finish"
        return f"{label} must be earlier than {upper_bound.strftime('%H:%M')}."

    return None


def get_week_dates(date_str):
    """Get Monday and Sunday for the week containing the given date"""
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d').date()
        monday = d - timedelta(days=d.weekday())
        sunday = monday + timedelta(days=6)
        return monday, sunday
    except (ValueError, TypeError):
        return None, None


def parse_date_string(date_str):
    """Parse YYYY-MM-DD string into date object, or None if invalid."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def parse_time_string(time_str):
    """Parse HH:MM string into time object, or None if invalid."""
    if not time_str:
        return None
    try:
        return datetime.strptime(time_str, '%H:%M').time()
    except (ValueError, TypeError):
        return None


def parse_optional_int(value):
    """Parse an optional int-like value, returning None for blank and invalid values."""
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def parse_positive_int(value):
    """Parse positive integer, returning None if invalid."""
    parsed = parse_optional_int(value)
    if parsed is None or parsed <= 0:
        return None
    return parsed


def require_driver(driver_id_raw):
    """Validate a driver_id field and look up the Driver row.

    Returns ``(driver, None)`` on success or ``(None, error_response)`` on
    failure, letting callers use the two-line guard pattern::

        driver, err = require_driver(data.get("driver_id"))
        if err:
            return err
    """
    driver_id = parse_positive_int(driver_id_raw)
    if not driver_id:
        return None, json_error("Please select a driver.")
    driver = db.session.get(Driver, driver_id)
    if not driver:
        return None, json_error("Driver not found.")
    return driver, None


def require_date(date_str_raw, field_label="date"):
    """Parse a YYYY-MM-DD string and return ``(date_obj, None)`` or
    ``(None, error_response)`` for invalid/missing values.

    Example::

        give_up_date, err = require_date(data.get("give_up_date"), "give-up date")
        if err:
            return err
    """
    date_obj = parse_date_string((date_str_raw or "").strip())
    if date_obj is None:
        label = field_label or "date"
        return None, json_error(f"Invalid {label} format.")
    return date_obj, None


def parse_month_start(month_str):
    """Parse YYYY-MM string into the first day of that month.

    Returns (month_start_date, error_message). When month_str is blank, defaults
    to the current month start.
    """
    normalized = (month_str or "").strip()
    if not normalized:
        return datetime.now().date().replace(day=1), None

    try:
        return datetime.strptime(normalized, "%Y-%m").date().replace(day=1), None
    except (ValueError, TypeError):
        return None, "Invalid month format. Use YYYY-MM"


def parse_day_shifts_from_form(form_data, day_index):
    """Parse one day's shift selection(s) from submitted form data."""
    day_key = f"day_{day_index}_shift"
    values = [v for v in form_data.getlist(day_key) if str(v).strip()]
    if not values:
        return 'day_off'

    normalized_values = [str(v).strip() for v in values]
    if 'day_off' in normalized_values:
        non_day_off = [v for v in normalized_values if v != 'day_off']
        if non_day_off:
            raise ValueError('Day Off cannot be combined with working shifts')
        return 'day_off'

    return compact_day_shifts(normalized_values)


def get_active_assignments_for_date(target_date):
    """Get assignments active for a given date."""
    return DriverAssignment.query.filter(
        DriverAssignment.start_date <= target_date,
        db.or_(
            DriverAssignment.end_date.is_(None),
            DriverAssignment.end_date >= target_date
        )
    ).all()


def get_driver_all_work_intervals(driver, ref_date, timings_dict=None, exclude_request_id=None):
    """Return a list of (source, start_datetime, end_datetime) tuples representing
    all working periods for ``driver`` across ref_date-1, ref_date, and ref_date+1.

    ``source`` is ``'scheduled'`` for pattern-based shifts or ``'extra'`` for
    ExtraCarAssignment entries.  Entries from the extra-car request identified by
    ``exclude_request_id`` are omitted so that the current request's own existing
    assignments do not count against the driver being validated.
    """
    if timings_dict is None:
        timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

    intervals = []

    # Collect regular scheduled shifts for the three-day window
    for delta in range(-1, 2):
        check_date = ref_date + timedelta(days=delta)
        shifts = get_driver_shifts_for_date(driver, check_date, timings_dict)
        for shift in shifts:
            if shift['shift_type'] == 'day_off':
                continue
            if not shift['start_time'] or not shift['end_time']:
                continue
            s = datetime.combine(check_date, shift['start_time'])
            e = datetime.combine(check_date, shift['end_time'])
            if e <= s:
                e += timedelta(days=1)
            intervals.append(('scheduled', s, e))

    # Collect existing extra-car assignments in the same window
    window_start_date = ref_date - timedelta(days=1)
    window_end_date = ref_date + timedelta(days=1)
    extra_asgns = (
        ExtraCarAssignment.query
        .filter(ExtraCarAssignment.driver_id == driver.id)
        .join(ExtraCarRequest)
        .filter(
            ExtraCarRequest.date >= window_start_date,
            ExtraCarRequest.date <= window_end_date,
            ExtraCarRequest.status != 'CLOSED',
        )
        .all()
    )
    if exclude_request_id is not None:
        extra_asgns = [a for a in extra_asgns if a.request_id != exclude_request_id]

    for ea in extra_asgns:
        req_start, req_end = ea.request.get_time_window()
        if not req_start or not req_end:
            continue
        s = (
            resolve_request_relative_datetime(req_start, req_end, ea.start_time)
            if ea.start_time else req_start
        )
        e = (
            resolve_request_relative_datetime(req_start, req_end, ea.end_time)
            if ea.end_time else req_end
        )
        if e <= s:
            e += timedelta(days=1)
        intervals.append(('extra', s, e))

    return intervals


def merge_work_intervals(intervals):
    """Merge overlapping or contiguous datetime intervals."""
    normalized = []
    for start_dt, end_dt in intervals:
        if not start_dt or not end_dt:
            continue
        if end_dt <= start_dt:
            continue
        normalized.append((start_dt, end_dt))

    if not normalized:
        return []

    normalized.sort(key=lambda item: item[0])
    merged = [normalized[0]]

    for start_dt, end_dt in normalized[1:]:
        last_start, last_end = merged[-1]
        if start_dt <= last_end:
            merged[-1] = (last_start, max(last_end, end_dt))
        else:
            merged.append((start_dt, end_dt))

    return merged


def interval_within_any_segment(start_dt, end_dt, segments):
    """Return True if [start_dt, end_dt] is fully inside one segment."""
    tolerance = timedelta(seconds=1)
    return any(
        start_dt >= (seg_start - tolerance) and end_dt <= (seg_end + tolerance)
        for seg_start, seg_end in segments
    )


def get_app_setting(key, default=None):
    """Fetch an app setting value by key, returning default if unset."""
    setting = db.session.get(AppSetting, key)
    if setting is None:
        return default
    return setting.value


def get_app_setting_float(key, default):
    """Fetch an app setting parsed as float; fall back to default if invalid."""
    raw_value = get_app_setting(key, None)
    if raw_value is None:
        return default
    try:
        parsed = float(raw_value)
        if parsed < 0:
            return default
        return parsed
    except (TypeError, ValueError):
        return default


def set_app_setting(key, value):
    """Create or update an app setting value."""
    setting = db.session.get(AppSetting, key)
    if setting is None:
        setting = AppSetting(key=key, value=str(value))
        db.session.add(setting)
    else:
        setting.value = str(value)


def is_date_in_school_term(target_date):
    """Return True when date falls within any configured school term range."""
    if not target_date:
        return False
    if target_date.weekday() >= 5:
        return False
    return (
        SchoolTerm.query
        .filter(SchoolTerm.start_date <= target_date, SchoolTerm.end_date >= target_date)
        .first()
        is not None
    )


def is_school_closed_day(target_date):
    """Return True when date is marked as a school-closed day."""
    if not target_date:
        return False
    return SchoolClosureDate.query.filter_by(closure_date=target_date).first() is not None


def is_school_term_operational_day(target_date):
    """Return True when date is in term time and not a closed day."""
    return is_date_in_school_term(target_date) and not is_school_closed_day(target_date)


def _is_shift_type_allowed_on_date(shift_type, timings_dict, target_date, _school_term_cache):
    """Return True when shift_type may operate on target_date.

    Shifts marked ``school_term_only`` are suppressed on non-term or closed days.
    Pass a mutable dict as *_school_term_cache* so the term-status lookup is done
    at most once per call site.
    """
    timing = timings_dict.get(shift_type)
    if not timing or not timing.school_term_only:
        return True
    if 'result' not in _school_term_cache:
        _school_term_cache['result'] = is_school_term_operational_day(target_date)
    return _school_term_cache['result']


def school_term_finished_at(term):
    """Return the datetime when a school term is considered finished."""
    return datetime.combine(term.end_date, time.max)


def school_term_delete_allowed_at(term):
    """Return the datetime when deleting a finished school term becomes allowed."""
    return school_term_finished_at(term) + timedelta(hours=24)


def school_closure_finished_at(closure):
    """Return the datetime when a school closure day is considered finished."""
    return datetime.combine(closure.closure_date, time.max)


def school_closure_delete_allowed_at(closure):
    """Return the datetime when deleting a finished school closure becomes allowed."""
    return school_closure_finished_at(closure) + timedelta(hours=24)


def validate_extra_car_assignment(driver, request_obj, proposed_start_dt, proposed_end_dt, timings_dict=None):
    """Validate a proposed extra-car assignment against driver work rules.

    Rules enforced:
    1. The combined work block containing the proposed period must have at least
       MIN_REST_HOURS hours of clear rest *before* it (measured from the end of the
       previous separate work block) and at least MIN_REST_HOURS hours of clear rest
       *after* it (measured to the start of the next separate work block).

       Crucially, if the proposed extra is directly adjacent to (or overlapping with)
       an existing shift, they form ONE continuous block — the rest gap is only checked
       at the outer boundaries of that combined block, not at the internal join.

    2. The total worked hours within any rolling 24-hour window must not exceed
       MAX_WORK_HOURS_PER_24H.

    3. If the proposed period *overlaps* an existing shift, only the non-overlapping
       net-new hours count toward the check.  The assignment is allowed if the
       net-new hours >= MIN_OVERLAP_BENEFIT (2h by default), and the suggested
       window is trimmed to the non-overlapping portion.

    Returns ``(is_valid, errors, suggested_start_dt, suggested_end_dt)``.
    """
    MIN_OVERLAP_BENEFIT = 2.0  # hours; minimum net-new hours that make an overlapping extra worthwhile

    if timings_dict is None:
        timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

    errors = []
    raw_intervals = get_driver_all_work_intervals(
        driver, request_obj.date, timings_dict, exclude_request_id=request_obj.id
    )
    existing_intervals = [(s, e) for _, s, e in raw_intervals]

    suggested_start = proposed_start_dt
    suggested_end = proposed_end_dt

    # -----------------------------------------------------------------------
    # Step 1: Detect overlap with existing work and compute net-new window
    # -----------------------------------------------------------------------
    # Build the merged existing work so we can find what portion of the proposed
    # assignment is truly new hours vs already covered.
    merged_existing = merge_work_intervals(existing_intervals)

    def compute_net_new_hours(p_start, p_end, merged):
        """Return hours in [p_start, p_end] not covered by any interval in merged."""
        covered = 0.0
        for s, e in merged:
            overlap_start = max(p_start, s)
            overlap_end = min(p_end, e)
            if overlap_end > overlap_start:
                covered += (overlap_end - overlap_start).total_seconds() / 3600
        proposed_hours = (p_end - p_start).total_seconds() / 3600
        return max(0.0, proposed_hours - covered)

    net_new = compute_net_new_hours(proposed_start_dt, proposed_end_dt, merged_existing)
    proposed_hours = (proposed_end_dt - proposed_start_dt).total_seconds() / 3600

    # Is there any overlap at all?
    has_overlap = net_new < proposed_hours - 0.001

    if has_overlap:
        if net_new < MIN_OVERLAP_BENEFIT:
            errors.append(
                f"Driver already works during most of this window. "
                f"This would only add {net_new:.1f}h of extra coverage "
                f"(minimum {MIN_OVERLAP_BENEFIT:.0f}h)."
            )
            return False, errors, suggested_start, suggested_end

        # Find the non-overlapping segments to suggest a trimmed window.
        # We take the earliest and latest non-covered portions.
        # Simple approach: suggest the first contiguous free segment.
        check_dt = proposed_start_dt
        delta = timedelta(minutes=1)
        seg_start = None
        best_seg = (None, None)
        best_dur = 0.0
        while check_dt < proposed_end_dt:
            seg_end = check_dt + delta
            is_free = not any(s <= check_dt < e for s, e in merged_existing)
            if is_free and seg_start is None:
                seg_start = check_dt
            elif not is_free and seg_start is not None:
                dur = (check_dt - seg_start).total_seconds() / 3600
                if dur > best_dur:
                    best_dur = dur
                    best_seg = (seg_start, check_dt)
                seg_start = None
            check_dt = seg_end
        if seg_start is not None:
            dur = (proposed_end_dt - seg_start).total_seconds() / 3600
            if dur > best_dur:
                best_seg = (seg_start, proposed_end_dt)

        if best_seg[0]:
            suggested_start = best_seg[0]
            suggested_end = best_seg[1]

    # -----------------------------------------------------------------------
    # Step 2: Build the merged combined block (existing + proposed) for rest checks
    # -----------------------------------------------------------------------
    # The merged view after adding the proposed period shows which continuous
    # blocks of work result.  Rest gaps are only checked at the outer edges of
    # the block that contains the proposed work — not at internal joins.
    merged_with_proposed = merge_work_intervals(existing_intervals + [(proposed_start_dt, proposed_end_dt)])

    # Find the block in merged_with_proposed that contains the proposed period
    combined_block = None
    for blk_start, blk_end in merged_with_proposed:
        if blk_start <= proposed_start_dt and blk_end >= proposed_end_dt:
            combined_block = (blk_start, blk_end)
            break
    if combined_block is None:
        combined_block = (proposed_start_dt, proposed_end_dt)

    cb_start, cb_end = combined_block

    # --- Rest before the combined block ---
    prev_ends = [e for s, e in merged_existing if e <= cb_start]
    if prev_ends:
        latest_prev_end = max(prev_ends)
        rest_before = (cb_start - latest_prev_end).total_seconds() / 3600
        if rest_before < MIN_REST_HOURS:
            min_block_start = latest_prev_end + timedelta(hours=MIN_REST_HOURS)
            # Suggest the earliest the *proposed* period can start:
            # shift the proposed start right by the same amount the block must shift
            shift = min_block_start - cb_start
            min_start = proposed_start_dt + shift
            errors.append(
                f"Insufficient rest before assignment: {rest_before:.1f}h "
                f"(minimum {MIN_REST_HOURS}h required). "
                f"Earliest valid start: {min_start.strftime('%H:%M')}."
            )
            suggested_start = min_start

    # --- Rest after the combined block ---
    next_starts = [s for s, e in merged_existing if s >= cb_end]
    if next_starts:
        earliest_next_start = min(next_starts)
        rest_after = (earliest_next_start - cb_end).total_seconds() / 3600
        if rest_after < MIN_REST_HOURS:
            max_block_end = earliest_next_start - timedelta(hours=MIN_REST_HOURS)
            shift = cb_end - max_block_end
            max_end = proposed_end_dt - shift
            errors.append(
                f"Insufficient rest after assignment: {rest_after:.1f}h "
                f"(minimum {MIN_REST_HOURS}h required). "
                f"Latest valid finish: {max_end.strftime('%H:%M')}."
            )
            suggested_end = max_end

    # If rest-before and rest-after constraints conflict, there is no legal window.
    if suggested_start and suggested_end and suggested_end <= suggested_start:
        errors = [
            "No legal assignment window is available for this driver in this request "
            "once 8-hour rest is enforced before and after surrounding shifts."
        ]
        suggested_start = None
        suggested_end = None

    # -----------------------------------------------------------------------
    # Step 3: Max hours in any rolling 24-hour window
    # -----------------------------------------------------------------------
    all_intervals = merge_work_intervals(existing_intervals + [(proposed_start_dt, proposed_end_dt)])
    for window_start, _ in all_intervals:
        window_end = window_start + timedelta(hours=24)
        total = sum(
            (min(e, window_end) - max(s, window_start)).total_seconds() / 3600
            for s, e in all_intervals
            if e > window_start and s < window_end
        )
        if total > MAX_WORK_HOURS_PER_24H:
            errors.append(
                f"Would exceed maximum {MAX_WORK_HOURS_PER_24H}h work in a 24-hour period "
                f"({total:.1f}h total)."
            )
            break

    return (not errors), errors, suggested_start, suggested_end


def get_custom_timing_affected_pattern_ids(driver):
    pattern_ids = {
        assignment.shift_pattern_id
        for assignment in driver.assignments
        if assignment.shift_pattern_id is not None
    }

    if not pattern_ids:
        return set()

    timings = list(driver.custom_timings or [])
    if not timings:
        return set()

    affected = set()

    # Any-assignment custom timing affects all patterns assigned to this driver
    if any(timing.assignment_id is None for timing in timings):
        affected.update(pattern_ids)

    assignment_by_id = {assignment.id: assignment for assignment in driver.assignments}
    for timing in timings:
        if timing.assignment_id is None:
            continue
        assignment = assignment_by_id.get(timing.assignment_id)
        if assignment and assignment.shift_pattern_id is not None:
            affected.add(assignment.shift_pattern_id)

    return affected


def serialize_driver_assignment_items(driver):
    today = datetime.now().date()
    items = []
    for assignment in driver.assignments:
        if assignment.start_date > today:
            status = "scheduled"
        elif not assignment.end_date or assignment.end_date >= today:
            status = "active"
        else:
            status = "ended"

        items.append({
            "id": assignment.id,
            "patternId": assignment.shift_pattern_id,
            "patternName": assignment.shift_pattern.name,
            "cycleLength": assignment.shift_pattern.cycle_length,
            "patternData": assignment.shift_pattern.get_pattern_data(),
            "startDate": assignment.start_date.strftime("%Y-%m-%d"),
            "endDate": assignment.end_date.strftime("%Y-%m-%d") if assignment.end_date else None,
            "startDayOfCycle": assignment.start_day_of_cycle,
            "createdAt": assignment.created_at.strftime("%d/%m/%Y"),
            "status": status,
            "hasEndDate": assignment.end_date is not None,
        })
    return items


def redirect_to_driver_custom_timings_panel(driver_id):
    return redirect(url_for("drivers", open_custom_timings_driver=driver_id))


def get_cars_working_at_time(target_date, target_time):
    """Get count of cars working at a specific date and time"""
    assignments = get_active_assignments_for_date(target_date)
    timings_dict = {t.shift_type: t for t in ShiftTiming.query.all()}

    driver_ids = []
    seen_driver_ids = set()
    for assignment in assignments:
        if assignment.driver_id in seen_driver_ids:
            continue
        seen_driver_ids.add(assignment.driver_id)
        driver_ids.append(assignment.driver_id)

    cars_working = 0
    for driver_id in driver_ids:
        driver = db.session.get(Driver, driver_id)
        if not driver:
            continue

        effective_shifts = get_driver_shifts_for_date(driver, target_date, timings_dict=timings_dict, include_swaps=True)
        is_working_now = False
        for shift in effective_shifts:
            if shift.get('shift_type') == 'day_off':
                continue

            start_time = shift.get('start_time')
            end_time = shift.get('end_time')

            if start_time is None or end_time is None:
                continue
            if end_time < start_time:
                if target_time >= start_time or target_time < end_time:
                    is_working_now = True
                    break
            else:
                if start_time <= target_time < end_time:
                    is_working_now = True
                    break

        if is_working_now:
            cars_working += 1

    return cars_working


def _get_shift_datetime(driver, target_date, timings_dict=None):
    """Return (start_datetime, end_datetime) for a driver on a date, or (None, None)."""
    if timings_dict is None:
        timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

    shifts = get_driver_shifts_for_date(driver, target_date, timings_dict)
    # shifts is a list of dicts with 'start_time', 'end_time'
    if not shifts:
        return None, None

    earliest_start = None
    latest_end = None
    for s in shifts:
        st = s.get('start_time')
        et = s.get('end_time')
        if st and et:
            start_dt = datetime.combine(target_date, st)
            end_dt = datetime.combine(target_date, et)
            if et < st:
                end_dt += timedelta(days=1)
            if earliest_start is None or start_dt < earliest_start:
                earliest_start = start_dt
            if latest_end is None or end_dt > latest_end:
                latest_end = end_dt

    return earliest_start, latest_end


def validate_swap(driver, give_up_date, work_date, work_shift_types):
    """Validate a single-driver day swap with one or more work shift types.

    ``work_shift_types`` may be a comma-separated string or a list of strings.
    Multiple types are only valid when they are all sub-shifts of the same parent.
    """
    # Normalise to list
    if isinstance(work_shift_types, str):
        work_shift_types = [t.strip() for t in work_shift_types.split(',') if t.strip()]
    work_shift_types = [t for t in work_shift_types if t]

    errors = []
    timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}
    same_day_selection = give_up_date == work_date

    if not work_shift_types:
        errors.append("Please choose a valid shift type for the work date.")
        return errors

    for wst in work_shift_types:
        if wst not in timings_dict or wst == 'day_off':
            errors.append("Please choose a valid shift type for the work date.")
            return errors

    if not is_school_term_operational_day(work_date):
        term_only_selected = [wst for wst in work_shift_types if timings_dict.get(wst) and timings_dict[wst].school_term_only]
        if term_only_selected:
            labels = ', '.join(shift_label(wst) for wst in term_only_selected)
            errors.append(
                f"{work_date.strftime('%d/%m/%Y')} is outside operational school term time; term-only shifts cannot be used ({labels})."
            )
            return errors

    if len(work_shift_types) > 1:
        if len(work_shift_types) != len(set(work_shift_types)):
            errors.append("Duplicate shift types selected.")
            return errors
        if any(not timings_dict[wst].parent_shift_type for wst in work_shift_types):
            errors.append("When selecting multiple shift types, all selected shifts must be sub-shifts.")
            return errors

    existing_swaps = ShiftSwap.query.filter(
        ShiftSwap.driver_a_id == driver.id,
        ShiftSwap.driver_b_id == driver.id,
        ShiftSwap.work_shift_type.isnot(None),
        db.or_(
            ShiftSwap.date_a == give_up_date,
            ShiftSwap.date_b == give_up_date,
            ShiftSwap.date_a == work_date,
            ShiftSwap.date_b == work_date,
        ),
    ).all()
    if existing_swaps:
        for selected_date in {give_up_date, work_date}:
            date_swaps = [
                swap for swap in existing_swaps
                if selected_date in (swap.date_a, swap.date_b)
            ]
            if not date_swaps:
                continue
            existing_shift_types = {
                swap.work_shift_type
                for swap in date_swaps
                if swap.work_shift_type
            }
            for wst in work_shift_types:
                if wst in existing_shift_types:
                    errors.append(
                        f"{selected_date.strftime('%d/%m/%Y')} already has a swap using shift type '{shift_label(wst)}'. "
                        "If reusing a swap date, choose a different shift type."
                    )
                    return errors
            if len(existing_shift_types) + len(work_shift_types) > 2:
                errors.append(
                    f"{selected_date.strftime('%d/%m/%Y')} already has the maximum swaps for that day. "
                    "Only one extra same-day swap is allowed, and it must use a different shift type."
                )
                return errors

    if is_driver_on_holiday(driver.id, work_date):
        errors.append(f"{driver.formatted_name()} is marked as time off on {work_date.strftime('%d/%m/%Y')}.")

    if is_driver_on_holiday(driver.id, give_up_date):
        errors.append(f"{driver.formatted_name()} is already marked as time off on {give_up_date.strftime('%d/%m/%Y')}.")

    base_give_up_entries = get_driver_shifts_for_date(driver, give_up_date, timings_dict, include_swaps=False)
    base_give_up_shift_exists = any(entry.get('shift_type') != 'day_off' for entry in base_give_up_entries)
    effective_give_up_entries = get_driver_shifts_for_date(driver, give_up_date, timings_dict, include_swaps=True)
    effective_give_up_shift_exists = any(entry.get('shift_type') != 'day_off' for entry in effective_give_up_entries)
    give_up_shift_exists = base_give_up_shift_exists or effective_give_up_shift_exists
    base_work_entries = get_driver_shifts_for_date(driver, work_date, timings_dict, include_swaps=False)
    existing_base_work_shift = any(entry.get('shift_type') != 'day_off' for entry in base_work_entries)

    if not give_up_shift_exists:
        errors.append(f"{driver.formatted_name()} has no working shift on {give_up_date.strftime('%d/%m/%Y')}.")

    if same_day_selection and give_up_shift_exists:
        current_shift_types = {
            entry.get('shift_type')
            for entry in effective_give_up_entries
            if entry.get('shift_type') and entry.get('shift_type') != 'day_off'
        }
        if any(wst in current_shift_types for wst in work_shift_types):
            errors.append(
                f"Same-day swap requires a different shift type than the current shift on {give_up_date.strftime('%d/%m/%Y')}."
            )

    if existing_base_work_shift and not same_day_selection:
        errors.append(f"{driver.formatted_name()} already has a working shift on {work_date.strftime('%d/%m/%Y')}.")

    if errors:
        return errors

    # Rest rule: use earliest start and latest end across all selected shift types
    start_times = [timings_dict[wst].start_time for wst in work_shift_types if timings_dict[wst].start_time]
    end_times = [timings_dict[wst].end_time for wst in work_shift_types if timings_dict[wst].end_time]
    if not start_times or not end_times:
        errors.append("Selected shift type has incomplete timing configuration.")
        return errors
    work_start_time = min(start_times)
    work_end_time = max(end_times)

    latest_late_start, earliest_early_finish = get_adjustment_conflict_bounds(driver.id, work_date)
    if latest_late_start is not None and work_start_time is not None:
        work_start_time = latest_late_start
    if earliest_early_finish is not None and work_end_time is not None:
        work_end_time = earliest_early_finish

    work_start = datetime.combine(work_date, work_start_time)
    work_end = datetime.combine(work_date, work_end_time)
    if work_end_time < work_start_time:
        work_end += timedelta(days=1)

    def _check_rest_with_adjacent_days(check_date, new_start, new_end, removed_shift_dates=None):
        inner_errors = []
        removed_shift_dates = removed_shift_dates or set()

        def _adjacent_shift_window(adjacent_date):
            if adjacent_date in removed_shift_dates:
                return None, None
            return _get_shift_datetime(driver, adjacent_date, timings_dict)

        prev_date = check_date - timedelta(days=1)
        prev_start, prev_end = _adjacent_shift_window(prev_date)
        if prev_end and new_start:
            rest = (new_start - prev_end).total_seconds() / 3600
            if rest < MIN_REST_HOURS:
                inner_errors.append(
                    f"{driver.formatted_name()} would have only {rest:.1f}h rest before the shift on "
                    f"{check_date.strftime('%d/%m/%Y')} (minimum {MIN_REST_HOURS} hours required)."
                )

        next_date = check_date + timedelta(days=1)
        next_start, next_end = _adjacent_shift_window(next_date)
        if new_end and next_start:
            rest = (next_start - new_end).total_seconds() / 3600
            if rest < MIN_REST_HOURS:
                inner_errors.append(
                    f"{driver.formatted_name()} would have only {rest:.1f}h rest after the shift on "
                    f"{check_date.strftime('%d/%m/%Y')} (minimum {MIN_REST_HOURS} hours required)."
                )

        return inner_errors

    errors += _check_rest_with_adjacent_days(work_date, work_start, work_end, removed_shift_dates={give_up_date})

    return errors
