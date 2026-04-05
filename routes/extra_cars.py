from flask import render_template, request, redirect, url_for, flash, jsonify
from datetime import datetime, timedelta

from extensions import db
from models import Driver, DriverHoliday, ShiftAdjustment, ShiftTiming, ExtraCarRequest, ExtraCarAssignment
from constants import EXTRA_CAR_MIN_PARTIAL_HOURS
from utils import (
    json_error,
    validation_error_response,
    validation_errors_response,
    parse_date_string, parse_time_string, parse_positive_int,
    require_driver,
    validate_extra_car_assignment, interval_within_any_segment,
    resolve_request_relative_datetime, is_school_term_operational_day,
    get_driver_shifts_for_date,
)


def _require_driver_or_redirect(driver_id_raw, redirect_fn):
    """Look up driver for form-POST handlers, redirecting on failure."""
    driver_id = parse_positive_int(driver_id_raw)
    if not driver_id:
        return None, redirect_fn("Please select a driver.")
    driver = db.session.get(Driver, driver_id)
    if not driver:
        return None, redirect_fn("Driver not found.")
    return driver, None


def register(app):
    def _extra_cars_redirect(message, category="error"):
        return validation_error_response(
            message,
            redirect_factory=lambda: redirect(url_for("extra_cars")),
            category=category,
        )

    def _iter_interval_dates(start_dt, end_dt):
        """Yield each date touched by [start_dt, end_dt)."""
        if end_dt > start_dt:
            final_date = (end_dt - timedelta(seconds=1)).date()
        else:
            final_date = start_dt.date()
        cursor = start_dt.date()
        while cursor <= final_date:
            yield cursor
            cursor += timedelta(days=1)

    def _merge_assignment_notes(existing_notes, auto_note):
        """Merge user notes with an auto note shown in the assignment notes column."""
        base = (existing_notes or "").strip()
        if not base:
            return auto_note
        return f"{base} | {auto_note}"

    def _driver_has_matching_shift_window(driver, req_start_dt, req_end_dt, timings_dict):
        """Return True when driver has a normal shift exactly matching request window."""
        entries = get_driver_shifts_for_date(
            driver,
            req_start_dt.date(),
            timings_dict=timings_dict,
            include_swaps=True,
            ignore_holiday=True,
        )
        for entry in entries:
            if entry.get('shift_type') == 'day_off':
                continue
            start_time = entry.get('start_time')
            end_time = entry.get('end_time')
            if start_time is None or end_time is None:
                continue

            shift_start = datetime.combine(req_start_dt.date(), start_time)
            shift_end = datetime.combine(req_start_dt.date(), end_time)
            if shift_end <= shift_start:
                shift_end += timedelta(days=1)

            if shift_start == req_start_dt and shift_end == req_end_dt:
                return True
        return False

    def _upsert_partial_day_adjustments_for_reinstated_shift(driver, req_start_dt, req_end_dt, timings_dict):
        """Preserve off-hours around a request by writing late-start/early-finish adjustments."""
        entries = get_driver_shifts_for_date(
            driver,
            req_start_dt.date(),
            timings_dict=timings_dict,
            include_swaps=True,
            ignore_holiday=True,
        )

        adjustments_written = 0
        for entry in entries:
            if entry.get('shift_type') == 'day_off':
                continue

            start_time = entry.get('start_time')
            end_time = entry.get('end_time')
            if start_time is None or end_time is None:
                continue

            shift_start = datetime.combine(req_start_dt.date(), start_time)
            shift_end = datetime.combine(req_start_dt.date(), end_time)
            if shift_end <= shift_start:
                shift_end += timedelta(days=1)

            if req_end_dt <= shift_start or req_start_dt >= shift_end:
                continue

            if shift_start < req_start_dt < shift_end and req_start_dt.date() == shift_start.date():
                late_start = ShiftAdjustment.query.filter_by(
                    driver_id=driver.id,
                    adjustment_date=shift_start.date(),
                    adjustment_type='late_start',
                ).first()
                if late_start:
                    late_start.adjusted_time = req_start_dt.time()
                else:
                    db.session.add(
                        ShiftAdjustment(
                            driver_id=driver.id,
                            adjustment_date=shift_start.date(),
                            adjustment_type='late_start',
                            adjusted_time=req_start_dt.time(),
                            notes='Auto-created from extra-car assignment while on time off.',
                        )
                    )
                adjustments_written += 1

            if shift_start < req_end_dt < shift_end:
                early_finish = ShiftAdjustment.query.filter_by(
                    driver_id=driver.id,
                    adjustment_date=shift_start.date(),
                    adjustment_type='early_finish',
                ).first()
                if early_finish:
                    early_finish.adjusted_time = req_end_dt.time()
                else:
                    db.session.add(
                        ShiftAdjustment(
                            driver_id=driver.id,
                            adjustment_date=shift_start.date(),
                            adjustment_type='early_finish',
                            adjusted_time=req_end_dt.time(),
                            notes='Auto-created from extra-car assignment while on time off.',
                        )
                    )
                adjustments_written += 1

        return adjustments_written

    def _intervals_cover_window(intervals, window_start, window_end):
        """Return True when intervals fully cover [window_start, window_end)."""
        clipped = []
        for start_dt, end_dt in intervals:
            start = max(start_dt, window_start)
            end = min(end_dt, window_end)
            if end > start:
                clipped.append((start, end))

        if not clipped:
            return False

        clipped.sort(key=lambda item: item[0])
        merged_start, merged_end = clipped[0]
        if merged_start > window_start:
            return False

        for start_dt, end_dt in clipped[1:]:
            if start_dt > merged_end:
                return False
            if end_dt > merged_end:
                merged_end = end_dt

        return merged_end >= window_end

    def _reinstated_shift_plus_assignment_covers_request(driver, req_start_dt, req_end_dt, asgn_start_dt, asgn_end_dt, timings_dict):
        """Return True when base shift coverage + assignment covers the full request window."""
        shift_intervals = []
        entries = get_driver_shifts_for_date(
            driver,
            req_start_dt.date(),
            timings_dict=timings_dict,
            include_swaps=True,
            ignore_holiday=True,
        )
        for entry in entries:
            if entry.get('shift_type') == 'day_off':
                continue
            start_time = entry.get('start_time')
            end_time = entry.get('end_time')
            if start_time is None or end_time is None:
                continue

            shift_start = datetime.combine(req_start_dt.date(), start_time)
            shift_end = datetime.combine(req_start_dt.date(), end_time)
            if shift_end <= shift_start:
                shift_end += timedelta(days=1)
            shift_intervals.append((shift_start, shift_end))

        all_intervals = list(shift_intervals)
        all_intervals.append((asgn_start_dt, asgn_end_dt))
        return _intervals_cover_window(all_intervals, req_start_dt, req_end_dt)

    @app.route("/extra-cars")
    def extra_cars():
        """Extra car requests management page."""
        now = datetime.now()
        all_requests = (
            ExtraCarRequest.query
            .order_by(ExtraCarRequest.date.asc(), ExtraCarRequest.id.asc())
            .all()
        )
        all_drivers = Driver.query.order_by(Driver.driver_number).all()
        all_shift_timings = ShiftTiming.query.order_by(ShiftTiming.shift_type).all()
        # Attach coverage info and split into current vs finished
        requests_with_coverage = []
        finished_requests_with_coverage = []
        for req in all_requests:
            filled_slots, suggested_status = req.compute_coverage()
            available_start, available_end = req.get_recommended_available_window()
            # Auto-update status when it changes (skip CLOSED requests)
            if req.status != 'CLOSED' and suggested_status != req.status:
                req.status = suggested_status

            payload = {
                'request': req,
                'filled_slots': filled_slots,
                'available_start': available_start,
                'available_end': available_end,
            }

            _, req_end_dt = req.get_time_window()
            has_ended = req_end_dt is not None and req_end_dt <= now

            if req.status == 'CLOSED' and has_ended:
                if req_end_dt is not None:
                    delete_cutoff = req_end_dt + timedelta(hours=24)
                    payload['deletable'] = now >= delete_cutoff
                    payload['delete_available_from'] = delete_cutoff.strftime('%-d %b %Y %H:%M')
                else:
                    payload['deletable'] = True
                    payload['delete_available_from'] = None
                finished_requests_with_coverage.append(payload)
            else:
                requests_with_coverage.append(payload)
        db.session.commit()

        return render_template(
            'extra_cars.html',
            requests_with_coverage=requests_with_coverage,
            finished_requests_with_coverage=finished_requests_with_coverage,
            all_drivers=all_drivers,
            all_shift_timings=all_shift_timings,
            today=datetime.now().date(),
        )

    @app.route("/extra-cars/request/add", methods=["POST"])
    def add_extra_car_request():
        """Create a new extra car request."""
        req_type = request.form.get("request_type", "").strip()
        req_date_str = request.form.get("date", "").strip()
        notes = request.form.get("notes", "").strip() or None

        req_date = parse_date_string(req_date_str)
        if not req_date:
            return _extra_cars_redirect("Please provide a valid date.")

        now = datetime.now()
        today = now.date()
        if req_date < today:
            return _extra_cars_redirect(
                f"Cannot create an extra car request for past date {req_date.strftime('%d/%m/%Y')}. "
                f"Please choose today or a future date.",
            )

        if req_type not in ("shift_type", "time_window"):
            return _extra_cars_redirect("Please select a valid request type.")

        shift_type_val = None
        window_start_val = None
        window_end_val = None

        if req_type == "shift_type":
            shift_type_val = request.form.get("shift_type", "").strip()
            if not shift_type_val:
                return _extra_cars_redirect("Please select a shift type.")
            timing = ShiftTiming.query.filter_by(shift_type=shift_type_val).first()
            if not timing:
                return _extra_cars_redirect("Selected shift type not found.")
            if not timing.start_time or not timing.end_time:
                return _extra_cars_redirect("Selected shift type has invalid timing.")
            if timing.school_term_only and not is_school_term_operational_day(req_date):
                return _extra_cars_redirect(
                    f"{timing.display_label} is marked as school term only and cannot be used on {req_date.strftime('%d/%m/%Y')}.",
                )

            req_start_dt = datetime.combine(req_date, timing.start_time)
            req_end_dt = datetime.combine(req_date, timing.end_time)
            if req_end_dt <= req_start_dt:
                req_end_dt += timedelta(days=1)

            if req_date == today and req_end_dt <= now:
                return _extra_cars_redirect(
                    f"Cannot create {timing.display_label} for today because it already finished at "
                    f"{req_end_dt.strftime('%H:%M')} (current time: {now.strftime('%H:%M')}).",
                )
        else:
            window_start_val = parse_time_string(request.form.get("window_start", "").strip())
            window_end_val = parse_time_string(request.form.get("window_end", "").strip())
            if not window_start_val or not window_end_val:
                return _extra_cars_redirect("Please provide valid start and end times.")

            req_start_dt = datetime.combine(req_date, window_start_val)
            req_end_dt = datetime.combine(req_date, window_end_val)
            if req_end_dt <= req_start_dt:
                req_end_dt += timedelta(days=1)

            if req_date == today and req_start_dt <= now:
                return _extra_cars_redirect(
                    f"Cannot create a custom window starting at {req_start_dt.strftime('%H:%M')} for today. "
                    f"Start time must be after current time ({now.strftime('%H:%M')}).",
                )

        request_duration_hours = (req_end_dt - req_start_dt).total_seconds() / 3600
        if request_duration_hours < EXTRA_CAR_MIN_PARTIAL_HOURS:
            return _extra_cars_redirect(
                f"Extra car request window must be at least {EXTRA_CAR_MIN_PARTIAL_HOURS:g} hours.",
            )

        unlimited_raw = request.form.get("unlimited", "")
        unlimited = unlimited_raw in ("1", "true", "on", "yes")

        required_slots = None
        if not unlimited:
            required_slots = parse_positive_int(request.form.get("required_slots", ""))
            if not required_slots:
                return _extra_cars_redirect("Please enter a positive number of required slots, or select unlimited.")

        min_partial_hours = EXTRA_CAR_MIN_PARTIAL_HOURS

        new_req = ExtraCarRequest(
            date=req_date,
            request_type=req_type,
            shift_type=shift_type_val,
            window_start=window_start_val,
            window_end=window_end_val,
            unlimited=unlimited,
            required_slots=required_slots,
            min_partial_hours=min_partial_hours,
            status='OPEN',
            notes=notes,
        )
        db.session.add(new_req)
        db.session.commit()

        flash("Extra car request created.", "success")
        return redirect(url_for("extra_cars"))

    @app.route("/extra-cars/request/<int:request_id>/delete", methods=["POST"])
    def delete_extra_car_request(request_id):
        """Delete an extra car request and its assignments."""
        req = db.get_or_404(ExtraCarRequest, request_id)
        db.session.delete(req)
        db.session.commit()
        flash("Extra car request deleted.", "success")
        return redirect(url_for("extra_cars"))

    @app.route("/extra-cars/request/<int:request_id>/edit", methods=["POST"])
    def edit_extra_car_request(request_id):
        """Edit an existing extra car request."""
        req = db.get_or_404(ExtraCarRequest, request_id)

        req_type = request.form.get("request_type", "").strip()
        req_date_str = request.form.get("date", "").strip()
        notes = request.form.get("notes", "").strip() or None

        req_date = parse_date_string(req_date_str)
        if not req_date:
            return _extra_cars_redirect("Please provide a valid date.")

        today = datetime.now().date()
        if req_date < today:
            return _extra_cars_redirect("Cannot set an extra car request to a past date.")

        if req_type not in ("shift_type", "time_window"):
            return _extra_cars_redirect("Please select a valid request type.")

        if req_type == "shift_type":
            shift_type_val = request.form.get("shift_type", "").strip()
            if not shift_type_val:
                return _extra_cars_redirect("Please select a shift type.")
            timing = ShiftTiming.query.filter_by(shift_type=shift_type_val).first()
            if not timing:
                return _extra_cars_redirect("Selected shift type not found.")
            if not timing.start_time or not timing.end_time:
                return _extra_cars_redirect("Selected shift type has invalid timing.")
            if timing.school_term_only and not is_school_term_operational_day(req_date):
                return _extra_cars_redirect(
                    f"{timing.display_label} is marked as school term only and cannot be used on {req_date.strftime('%d/%m/%Y')}.",
                )

            req_start_dt = datetime.combine(req_date, timing.start_time)
            req_end_dt = datetime.combine(req_date, timing.end_time)
            if req_end_dt <= req_start_dt:
                req_end_dt += timedelta(days=1)

            req.shift_type = shift_type_val
            req.window_start = None
            req.window_end = None
        else:
            window_start_val = parse_time_string(request.form.get("window_start", "").strip())
            window_end_val = parse_time_string(request.form.get("window_end", "").strip())
            if not window_start_val or not window_end_val:
                return _extra_cars_redirect("Please provide valid start and end times.")

            req_start_dt = datetime.combine(req_date, window_start_val)
            req_end_dt = datetime.combine(req_date, window_end_val)
            if req_end_dt <= req_start_dt:
                req_end_dt += timedelta(days=1)

            req.shift_type = None
            req.window_start = window_start_val
            req.window_end = window_end_val

        request_duration_hours = (req_end_dt - req_start_dt).total_seconds() / 3600
        if request_duration_hours < EXTRA_CAR_MIN_PARTIAL_HOURS:
            return _extra_cars_redirect(
                f"Extra car request window must be at least {EXTRA_CAR_MIN_PARTIAL_HOURS:g} hours.",
            )

        if req_end_dt <= datetime.now():
            return _extra_cars_redirect("Cannot set an extra car request to a past time window.")

        unlimited_raw = request.form.get("unlimited", "")
        unlimited = unlimited_raw in ("1", "true", "on", "yes")

        required_slots = None
        if not unlimited:
            required_slots = parse_positive_int(request.form.get("required_slots", ""))
            if not required_slots:
                return _extra_cars_redirect("Please enter a positive number of required slots, or select unlimited.")

        new_status = request.form.get("status", "").strip()
        if new_status in ("OPEN", "CLOSED"):
            req.status = new_status

        req.date = req_date
        req.request_type = req_type
        req.unlimited = unlimited
        req.required_slots = required_slots
        req.notes = notes
        db.session.commit()

        flash("Extra car request updated.", "success")
        return redirect(url_for("extra_cars"))

    @app.route("/extra-cars/request/<int:request_id>/status", methods=["POST"])
    def update_extra_car_request_status(request_id):
        """Manually update the status of an extra car request."""
        req = db.get_or_404(ExtraCarRequest, request_id)
        new_status = request.form.get("status", "").strip()
        valid_statuses = ("DRAFT", "OPEN", "PARTIALLY_FILLED", "FILLED", "CLOSED")
        if new_status not in valid_statuses:
            return _extra_cars_redirect("Invalid status.")
        req.status = new_status
        db.session.commit()
        flash(f"Request status updated to {new_status.replace('_', ' ').title()}.", "success")
        return redirect(url_for("extra_cars"))

    @app.route("/extra-cars/request/<int:request_id>/assignment/validate", methods=["POST"])
    def validate_extra_car_assignment_ajax(request_id):
        """AJAX endpoint to validate a proposed extra-car assignment before saving."""
        req = db.get_or_404(ExtraCarRequest, request_id)

        available_segments = req.get_available_capacity_segments() if not req.unlimited else None
        if not req.unlimited:
            if not available_segments:
                return jsonify({
                    "success": True,
                    "valid": False,
                    "errors": ["Request capacity is already fully covered for the whole window."],
                    "suggested_start": "",
                    "suggested_end": "",
                })

        data = request.get_json(silent=True) or request.form
        start_str = (data.get("start_time") or "").strip()
        end_str = (data.get("end_time") or "").strip()

        driver, err = require_driver(data.get("driver_id"))
        if err:
            return err

        existing_assignment = ExtraCarAssignment.query.filter_by(
            request_id=req.id,
            driver_id=driver.id,
        ).first()
        if existing_assignment:
            return jsonify({
                "success": True,
                "valid": False,
                "errors": ["This driver is already assigned to this request."],
                "suggested_start": "",
                "suggested_end": "",
            })

        req_start, req_end = req.get_time_window()
        if not req_start or not req_end:
            return json_error("Request has an invalid or incomplete time window.")

        # Resolve proposed times (fall back to full request window)
        proposed_start = (
            resolve_request_relative_datetime(req_start, req_end, parse_time_string(start_str))
            if start_str else req_start
        )
        proposed_end = (
            resolve_request_relative_datetime(req_start, req_end, parse_time_string(end_str))
            if end_str else req_end
        )
        if proposed_end <= proposed_start:
            proposed_end += timedelta(days=1)

        if not req.unlimited and available_segments is not None:
            if not interval_within_any_segment(proposed_start, proposed_end, available_segments):
                suggested_start, suggested_end = req.get_recommended_available_window()
                suggestion = ""
                if suggested_start and suggested_end:
                    suggestion = (
                        f" Only {suggested_start.strftime('%H:%M')}–{suggested_end.strftime('%H:%M')} "
                        "is currently available."
                    )
                return jsonify({
                    "success": True,
                    "valid": False,
                    "errors": [
                        "Proposed assignment exceeds currently available capacity window."
                        + suggestion
                    ],
                    "suggested_start": suggested_start.strftime("%H:%M") if suggested_start else "",
                    "suggested_end": suggested_end.strftime("%H:%M") if suggested_end else "",
                })

        timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

        # If this is a shift-type request and the driver's normal shift matches the
        # request window AND they have a holiday covering those dates, the add route
        # will automatically remove the holiday — skip conflict validation here.
        if req.request_type == 'shift_type' and _driver_has_matching_shift_window(
            driver, proposed_start, proposed_end, timings_dict
        ):
            from models import DriverHoliday
            has_holiday = any(
                DriverHoliday.query.filter_by(
                    driver_id=driver.id, holiday_date=d
                ).first()
                for d in _iter_interval_dates(proposed_start, proposed_end)
            )
            if has_holiday:
                return jsonify({
                    "success": True,
                    "valid": True,
                    "errors": [],
                    "suggested_start": proposed_start.strftime("%H:%M"),
                    "suggested_end": proposed_end.strftime("%H:%M"),
                })

        is_valid, errors, suggested_start, suggested_end = validate_extra_car_assignment(
            driver, req, proposed_start, proposed_end, timings_dict
        )

        return jsonify({
            "success": True,
            "valid": is_valid,
            "errors": errors,
            "suggested_start": suggested_start.strftime("%H:%M") if suggested_start else "",
            "suggested_end": suggested_end.strftime("%H:%M") if suggested_end else "",
        })

    @app.route("/extra-cars/request/<int:request_id>/assignment/add", methods=["POST"])
    def add_extra_car_assignment(request_id):
        """Add a driver assignment to an extra car request."""
        req = db.get_or_404(ExtraCarRequest, request_id)

        available_segments = req.get_available_capacity_segments() if not req.unlimited else None
        if not req.unlimited:
            if not available_segments:
                return _extra_cars_redirect("Request capacity is already fully covered for the whole window.")

        driver, err = _require_driver_or_redirect(
            request.form.get("driver_id"), _extra_cars_redirect
        )
        if err:
            return err

        start_str = request.form.get("start_time", "").strip()
        end_str = request.form.get("end_time", "").strip()
        notes = request.form.get("notes", "").strip() or None

        existing_assignment = ExtraCarAssignment.query.filter_by(
            request_id=req.id,
            driver_id=driver.id,
        ).first()
        if existing_assignment:
            return _extra_cars_redirect("This driver is already assigned to this request.")

        req_start, req_end = req.get_time_window()
        if not req_start or not req_end:
            return _extra_cars_redirect("Request has an invalid or incomplete time window.")

        start_time = parse_time_string(start_str) if start_str else None
        end_time = parse_time_string(end_str) if end_str else None

        if not req.unlimited and not start_str and not end_str:
            suggested_start, suggested_end = req.get_recommended_available_window()
            if not suggested_start or not suggested_end:
                return _extra_cars_redirect("No available capacity window for this request.")
            proposed_start = suggested_start
            proposed_end = suggested_end
            start_time = proposed_start.time()
            end_time = proposed_end.time()
        else:
            proposed_start = (
                resolve_request_relative_datetime(req_start, req_end, start_time)
                if start_time else req_start
            )
            proposed_end = (
                resolve_request_relative_datetime(req_start, req_end, end_time)
                if end_time else req_end
            )
            if proposed_end <= proposed_start:
                proposed_end += timedelta(days=1)

        timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

        if req.request_type == 'shift_type' and _driver_has_matching_shift_window(driver, req_start, req_end, timings_dict):
            holidays_removed = 0
            for touched_date in _iter_interval_dates(req_start, req_end):
                holiday = DriverHoliday.query.filter_by(driver_id=driver.id, holiday_date=touched_date).first()
                if holiday:
                    db.session.delete(holiday)
                    holidays_removed += 1

            if holidays_removed:
                if not req.unlimited:
                    req.required_slots = max(0, (req.required_slots or 0) - 1)

                if req.required_slots == 0:
                    req.status = 'FILLED'
                else:
                    _, suggested_status = req.compute_coverage()
                    if req.status != 'CLOSED':
                        req.status = suggested_status

                db.session.commit()
                flash(
                    f"Removed time off for {driver.formatted_name()} and reduced required slots to {req.required_slots}.",
                    "success",
                )
                return redirect(url_for("extra_cars"))

        if not req.unlimited and available_segments is not None:
            if not interval_within_any_segment(proposed_start, proposed_end, available_segments):
                suggested_start, suggested_end = req.get_recommended_available_window()
                if suggested_start and suggested_end:
                    return _extra_cars_redirect(
                        "Proposed assignment exceeds available capacity. "
                        f"Use {suggested_start.strftime('%H:%M')}–{suggested_end.strftime('%H:%M')}.",
                    )
                else:
                    return _extra_cars_redirect("Proposed assignment exceeds available capacity.")

        is_valid, errors, suggested_start, suggested_end = validate_extra_car_assignment(
            driver, req, proposed_start, proposed_end, timings_dict
        )

        if not is_valid:
            return validation_errors_response(
                errors,
                redirect_factory=lambda: redirect(url_for("extra_cars")),
            )

        final_start = suggested_start or proposed_start
        final_end = suggested_end or proposed_end

        if final_end <= final_start:
            return _extra_cars_redirect("No valid extra-shift time window is available for this driver.")

        final_duration_hours = (final_end - final_start).total_seconds() / 3600
        if final_duration_hours < EXTRA_CAR_MIN_PARTIAL_HOURS:
            return _extra_cars_redirect(
                f"Driver assignment must be at least {EXTRA_CAR_MIN_PARTIAL_HOURS:g} hours.",
            )

        holiday_dates_removed = []
        for touched_date in _iter_interval_dates(final_start, final_end):
            holiday = DriverHoliday.query.filter_by(driver_id=driver.id, holiday_date=touched_date).first()
            if holiday:
                db.session.delete(holiday)
                holiday_dates_removed.append(touched_date)

        adjustments_written = 0
        consumed_slot_via_reinstatement = False
        assignment_auto_note = None
        if holiday_dates_removed:
            adjustments_written = _upsert_partial_day_adjustments_for_reinstated_shift(
                driver,
                req_start,
                req_end,
                timings_dict,
            )

            if not req.unlimited and _reinstated_shift_plus_assignment_covers_request(
                driver,
                req_start,
                req_end,
                final_start,
                final_end,
                timings_dict,
            ):
                req.required_slots = max(0, (req.required_slots or 0) - 1)
                consumed_slot_via_reinstatement = True

            note_suffix = " and slot demand adjusted" if consumed_slot_via_reinstatement else ""
            assignment_auto_note = (
                f"AUTO: worked while booked time off; holiday removed{note_suffix}."
            )

        if final_start != proposed_start or final_end != proposed_end:
            flash(
                f"Assignment adjusted to non-overlapping time: {final_start.strftime('%H:%M')}–{final_end.strftime('%H:%M')}.",
                "info",
            )

        # Always save the final times so they're preserved
        assignment = ExtraCarAssignment(
            request_id=req.id,
            driver_id=driver.id,
            start_time=final_start.time(),
            end_time=final_end.time(),
            notes=_merge_assignment_notes(notes, assignment_auto_note) if assignment_auto_note else notes,
        )
        db.session.add(assignment)
        db.session.flush()

        # Recompute and persist status
        filled_slots, new_status = req.compute_coverage()
        if req.status != 'CLOSED':
            req.status = new_status

        db.session.commit()

        if adjustments_written:
            flash(
                "Created schedule adjustment(s) to preserve booked-off hours outside the requested window.",
                "info",
            )

        flash(
            f"{driver.formatted_name()} added to extra car request "
            f"({final_start.strftime('%H:%M')}–{final_end.strftime('%H:%M')}).",
            "success",
        )
        return redirect(url_for("extra_cars"))

    @app.route(
        "/extra-cars/request/<int:request_id>/assignment/<int:assignment_id>/delete",
        methods=["POST"],
    )
    def delete_extra_car_assignment(request_id, assignment_id):
        """Remove a driver assignment from an extra car request."""
        req = db.get_or_404(ExtraCarRequest, request_id)
        asgn = ExtraCarAssignment.query.filter_by(id=assignment_id, request_id=request_id).first_or_404()

        db.session.delete(asgn)
        db.session.flush()

        filled_slots, new_status = req.compute_coverage()
        if req.status != 'CLOSED':
            req.status = new_status

        db.session.commit()
        flash("Assignment removed.", "success")
        return redirect(url_for("extra_cars"))
