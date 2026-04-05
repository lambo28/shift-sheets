from flask import render_template, request, redirect, url_for, flash, jsonify
from datetime import datetime, timedelta, time

from extensions import db
from models import (
    Driver, ShiftTiming, ShiftAdjustment, ShiftSwap,
    DriverHoliday, SchoolTerm, SchoolClosureDate,
    ExtraCarRequest, ExtraCarAssignment,
)
from utils import (
    json_success, json_error,
    validation_error_response,
    validation_errors_response,
    parse_date_string, parse_time_string, parse_positive_int,
    require_driver, require_date,
    validate_adjustment_time, validate_swap, check_adjustment_deletion_rest_violation,
    group_consecutive_holidays,
    get_driver_shifts_for_date,
    is_driver_on_holiday, is_split_shift_day, driver_has_working_shift_on_date,
    shift_label,
    append_swap_holiday_restore_metadata, extract_swap_holiday_restore_metadata,
    strip_swap_internal_metadata,
    school_term_finished_at, school_term_delete_allowed_at,
    school_closure_finished_at, school_closure_delete_allowed_at,
)


def register(app):
    def _format_swap_notes_for_display(notes):
        visible_notes = strip_swap_internal_metadata(notes)
        if not visible_notes:
            return None
        parts = [part.strip() for part in str(visible_notes).splitlines() if part.strip()]
        return ' | '.join(parts) if parts else None

    def _scheduling_redirect(message, category="error"):
        return validation_error_response(
            message,
            redirect_factory=lambda: redirect(url_for("scheduling")),
            category=category,
        )

    def _require_driver_or_redirect(driver_id_raw):
        """Resolve a driver from form data, returning a scheduling redirect on error."""
        driver_id = parse_positive_int(driver_id_raw)
        if not driver_id:
            return None, None, _scheduling_redirect("Please select a driver.")

        driver = db.session.get(Driver, driver_id)
        if not driver:
            return None, None, _scheduling_redirect("Driver not found.")

        return driver_id, driver, None

    def _driver_matches_extra_request_shift_window(driver, req, timings_dict):
        """Return True when driver's effective shift window matches request window."""
        req_start, req_end = req.get_time_window()
        if not req_start or not req_end:
            return False

        entries = get_driver_shifts_for_date(
            driver,
            req.date,
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

            shift_start = datetime.combine(req.date, start_time)
            shift_end = datetime.combine(req.date, end_time)
            if shift_end <= shift_start:
                shift_end += timedelta(days=1)

            if shift_start == req_start and shift_end == req_end:
                return True

        return False

    def _intervals_cover_window(intervals, window_start, window_end):
        """Return True when the merged intervals cover the full request window."""
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

    def _driver_has_auto_reinstatement_adjustment(driver, target_date):
        """Return True when auto-created adjustments exist for a reinstated extra-car day."""
        return ShiftAdjustment.query.filter(
            ShiftAdjustment.driver_id == driver.id,
            ShiftAdjustment.adjustment_date == target_date,
            ShiftAdjustment.notes == 'Auto-created from extra-car assignment while on time off.',
        ).first() is not None

    def _driver_shift_plus_assignment_covers_request(driver, req, timings_dict):
        """Return True when driver's base shift plus their assignment covers the full request window."""
        req_start, req_end = req.get_time_window()
        if not req_start or not req_end:
            return False

        assignments = [asgn for asgn in req.assignments if asgn.driver_id == driver.id]
        if not assignments:
            return False

        intervals = []
        entries = get_driver_shifts_for_date(
            driver,
            req.date,
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

            shift_start = datetime.combine(req.date, start_time)
            shift_end = datetime.combine(req.date, end_time)
            if shift_end <= shift_start:
                shift_end += timedelta(days=1)
            intervals.append((shift_start, shift_end))

        for assignment in assignments:
            asgn_start = assignment.effective_start()
            asgn_end = assignment.effective_end()
            if asgn_start and asgn_end and asgn_end > asgn_start:
                intervals.append((asgn_start, asgn_end))

        return _intervals_cover_window(intervals, req_start, req_end)

    def _increase_extra_slots_for_new_time_off(driver, holiday_dates, timings_dict):
        """Increase required slots for shift-type fast-path reinstatements (no assignment row)."""
        if not holiday_dates:
            return 0

        adjusted = 0
        for holiday_date in holiday_dates:
            requests = ExtraCarRequest.query.filter(
                ExtraCarRequest.date == holiday_date,
                ExtraCarRequest.request_type == 'shift_type',
                ExtraCarRequest.unlimited.is_(False),
            ).all()

            for req in requests:
                if any(asgn.driver_id == driver.id for asgn in req.assignments):
                    continue
                if not _driver_matches_extra_request_shift_window(driver, req, timings_dict):
                    continue

                req.required_slots = (req.required_slots or 0) + 1
                adjusted += 1

        return adjusted

    def _remove_extra_assignments_for_new_time_off(driver, holiday_dates):
        """Remove driver's extra-car assignments on newly added time-off dates."""
        if not holiday_dates:
            return 0, 0

        requests = ExtraCarRequest.query.filter(
            ExtraCarRequest.date.in_(holiday_dates)
        ).all()

        removed = 0
        slots_restored = 0
        impacted_requests = []
        for req in requests:
            rows = ExtraCarAssignment.query.filter_by(
                request_id=req.id,
                driver_id=driver.id,
            ).all()
            if not rows:
                continue

            for row in rows:
                db.session.delete(row)
                removed += 1
            if not req.unlimited:
                req.required_slots = (req.required_slots or 0) + len(rows)
                slots_restored += len(rows)
            impacted_requests.append(req)

        if removed:
            db.session.flush()

        return removed, slots_restored

    def _refresh_extra_request_statuses_for_dates(target_dates):
        """Recompute status for future requests affected by holiday changes."""
        if not target_dates:
            return

        now_dt = datetime.now()
        requests = ExtraCarRequest.query.filter(
            ExtraCarRequest.date.in_(target_dates)
        ).all()
        for req in requests:
            req_start, req_end = req.get_time_window()
            if not req_start or not req_end:
                continue
            if req_end <= now_dt:
                req.status = 'CLOSED'
                continue

            db.session.expire(req, ['assignments'])

            if req.status == 'CLOSED':
                req.status = 'OPEN'

            _, new_status = req.compute_coverage()
            req.status = new_status

    @app.route("/scheduling")
    def scheduling():
        """Scheduling management: holidays, one-off adjustments, shift swaps."""
        all_drivers = Driver.query.order_by(Driver.driver_number).all()
        now_dt = datetime.now()
        today = datetime.now().date()
        holidays = (
            DriverHoliday.query
            .join(Driver)
            .order_by(DriverHoliday.holiday_date.desc())
            .all()
        )
        all_school_terms = SchoolTerm.query.order_by(SchoolTerm.start_date.asc(), SchoolTerm.id.asc()).all()
        all_school_closures = SchoolClosureDate.query.order_by(SchoolClosureDate.closure_date.asc(), SchoolClosureDate.id.asc()).all()

        school_terms = []
        school_terms_finished = []
        for term in all_school_terms:
            finished_at = school_term_finished_at(term)
            delete_allowed_at = school_term_delete_allowed_at(term)
            if now_dt > finished_at:
                school_terms_finished.append({
                    "term": term,
                    "delete_allowed": now_dt >= delete_allowed_at,
                    "delete_allowed_at": delete_allowed_at,
                })
            else:
                school_terms.append(term)

        school_terms_finished.sort(key=lambda entry: entry["term"].end_date, reverse=True)
        finished_school_term_count = len(school_terms_finished)

        school_closures = []
        school_closures_finished = []
        for closure in all_school_closures:
            finished_at = school_closure_finished_at(closure)
            delete_allowed_at = school_closure_delete_allowed_at(closure)
            if now_dt > finished_at:
                school_closures_finished.append({
                    "closure": closure,
                    "delete_allowed": now_dt >= delete_allowed_at,
                    "delete_allowed_at": delete_allowed_at,
                })
            else:
                school_closures.append(closure)

        school_closures_finished.sort(key=lambda entry: entry["closure"].closure_date, reverse=True)
        finished_school_closure_count = len(school_closures_finished)

        holiday_groups = group_consecutive_holidays(holidays)
        grouped_by_driver = {}
        for group in holiday_groups:
            first = group[0]
            last = group[-1]
            driver_id = first.driver_id
            if driver_id not in grouped_by_driver:
                grouped_by_driver[driver_id] = {
                    "driver": first.driver,
                    "current_future_blocks": [],
                    "finished_blocks": [],
                }
            if last.holiday_date < today:
                grouped_by_driver[driver_id]["finished_blocks"].append(group)
            else:
                grouped_by_driver[driver_id]["current_future_blocks"].append(group)

        for entry in grouped_by_driver.values():
            entry["current_future_blocks"] = sorted(
                entry["current_future_blocks"],
                key=lambda block: block[0].holiday_date,
            )
            entry["finished_blocks"] = sorted(
                entry["finished_blocks"],
                key=lambda block: block[-1].holiday_date,
                reverse=True,
            )

        def _driver_sort_key(entry):
            number = str(entry["driver"].driver_number)
            return (0, int(number)) if number.isdigit() else (1, number.lower())

        time_off_by_driver = sorted(
            [entry for entry in grouped_by_driver.values() if entry["current_future_blocks"]],
            key=_driver_sort_key,
        )
        finished_time_off_days = sum(
            len(group)
            for entry in grouped_by_driver.values()
            for group in entry["finished_blocks"]
        )

        adjustments = (
            ShiftAdjustment.query
            .join(Driver)
            .order_by(Driver.driver_number.asc(), ShiftAdjustment.adjustment_date.desc(), ShiftAdjustment.id.desc())
            .all()
        )

        grouped_adjustments = {}
        for adjustment in adjustments:
            driver_id = adjustment.driver_id
            if driver_id not in grouped_adjustments:
                grouped_adjustments[driver_id] = {
                    "driver": adjustment.driver,
                    "current_future_records": [],
                    "finished_records": [],
                }

            day_map = grouped_adjustments[driver_id].setdefault("_day_map", {})
            day_key = adjustment.adjustment_date
            if day_key not in day_map:
                day_map[day_key] = {
                    "date": adjustment.adjustment_date,
                    "late_start": None,
                    "early_finish": None,
                    "notes": [],
                }

            day_entry = day_map[day_key]
            if adjustment.adjustment_type == "late_start":
                day_entry["late_start"] = adjustment
            elif adjustment.adjustment_type == "early_finish":
                day_entry["early_finish"] = adjustment

            if adjustment.notes:
                day_entry["notes"].append(adjustment.notes)

        for entry in grouped_adjustments.values():
            day_map = entry.pop("_day_map", {})
            day_records = sorted(day_map.values(), key=lambda rec: rec["date"])
            for record in day_records:
                unique_notes = []
                for note in record["notes"]:
                    if note not in unique_notes:
                        unique_notes.append(note)
                record["notes"] = " | ".join(unique_notes)

            for record in day_records:
                if record["date"] < today:
                    entry["finished_records"].append(record)
                else:
                    entry["current_future_records"].append(record)

            entry["finished_records"] = sorted(entry["finished_records"], key=lambda rec: rec["date"], reverse=True)

        adjustments_by_driver = sorted(
            [entry for entry in grouped_adjustments.values() if entry["current_future_records"]],
            key=_driver_sort_key,
        )

        adjustments_with_finished = sorted(
            [entry for entry in grouped_adjustments.values() if entry["finished_records"]],
            key=_driver_sort_key,
        )

        finished_adjustment_days = sum(
            len(entry["finished_records"])
            for entry in grouped_adjustments.values()
        )

        all_swaps = (
            ShiftSwap.query
            .filter(ShiftSwap.driver_a_id == ShiftSwap.driver_b_id)
            .filter(ShiftSwap.work_shift_type.isnot(None))
            .order_by(ShiftSwap.date_b.asc())
            .all()
        )

        all_timings = ShiftTiming.query.all()
        timings_dict = {timing.shift_type: timing for timing in all_timings}

        for swap in all_swaps:
            give_up_entries = get_driver_shifts_for_date(
                swap.driver,
                swap.give_up_date,
                timings_dict,
                include_swaps=False,
            )
            swap.give_up_shift_entries = [
                entry for entry in give_up_entries
                if entry.get('shift_type') and entry.get('shift_type') != 'day_off'
            ]

            work_shift_timing = timings_dict.get(swap.work_shift_type)
            swap.work_shift_badge_color = (
                work_shift_timing.badge_color
                if work_shift_timing and work_shift_timing.badge_color
                else 'bg-info text-dark'
            )
            swap.work_shift_icon = (
                work_shift_timing.icon
                if work_shift_timing and work_shift_timing.icon
                else 'fas fa-clock'
            )
            swap.work_shift_label = (
                work_shift_timing.display_label
                if work_shift_timing and work_shift_timing.display_label
                else shift_label(swap.work_shift_type)
            )

        # Merge split-shift swap records into one visual swap entry per
        # (driver, give-up date, work date), with ordered work-shift badges.
        merged_swaps_map = {}
        for swap in all_swaps:
            merge_key = (swap.driver_a_id, swap.give_up_date, swap.date_b)
            merged = merged_swaps_map.get(merge_key)
            if not merged:
                merged = {
                    "id": swap.id,
                    "driver": swap.driver,
                    "driver_a_id": swap.driver_a_id,
                    "give_up_date": swap.give_up_date,
                    "work_date": swap.date_b,
                    "notes": _format_swap_notes_for_display(swap.notes),
                    "give_up_shift_entries": list(swap.give_up_shift_entries or []),
                    "work_shift_entries": [],
                    "swap_ids": [],
                }
                merged_swaps_map[merge_key] = merged

            merged["swap_ids"].append(swap.id)
            visible_notes = _format_swap_notes_for_display(swap.notes)
            if not merged.get("notes") and visible_notes:
                merged["notes"] = visible_notes

            merged["work_shift_entries"].append({
                "shift_type": swap.work_shift_type,
                "label": swap.work_shift_label,
                "badge_color": swap.work_shift_badge_color,
                "icon": swap.work_shift_icon,
                "start_time": (timings_dict.get(swap.work_shift_type).start_time if timings_dict.get(swap.work_shift_type) else None),
            })

        merged_swaps = list(merged_swaps_map.values())
        for merged in merged_swaps:
            unique_work_entries = {}
            for entry in merged["work_shift_entries"]:
                unique_work_entries[entry["shift_type"]] = entry

            merged["work_shift_entries"] = sorted(
                unique_work_entries.values(),
                key=lambda entry: (
                    entry["start_time"] is None,
                    entry["start_time"] or time.max,
                    entry["label"] or entry["shift_type"],
                ),
            )

        # Group swaps by driver, split into current/future and finished
        grouped_swaps = {}
        for swap in merged_swaps:
            driver_id = swap["driver_a_id"]
            if driver_id not in grouped_swaps:
                grouped_swaps[driver_id] = {
                    "driver": swap["driver"],
                    "current_future_swaps": [],
                    "finished_swaps": [],
                }
            if swap["work_date"] < today:
                grouped_swaps[driver_id]["finished_swaps"].append(swap)
            else:
                grouped_swaps[driver_id]["current_future_swaps"].append(swap)

        # Sort finished descending (most recent first), current ascending (soonest first)
        for entry in grouped_swaps.values():
            entry["current_future_swaps"].sort(key=lambda s: s["work_date"])
            entry["finished_swaps"].sort(key=lambda s: s["work_date"], reverse=True)

        swaps_by_driver = sorted(
            [entry for entry in grouped_swaps.values() if entry["current_future_swaps"]],
            key=_driver_sort_key,
        )

        finished_swap_count = sum(
            len(entry["finished_swaps"])
            for entry in grouped_swaps.values()
        )

        # Also expose drivers that only have finished swaps (for the "Delete All Finished" button awareness)
        swaps_with_finished = sorted(
            [entry for entry in grouped_swaps.values() if entry["finished_swaps"]],
            key=_driver_sort_key,
        )

        swap_shift_types = [
            timing for timing in ShiftTiming.query.order_by(ShiftTiming.shift_type.asc()).all()
            if timing.shift_type != 'day_off'
        ]

        return render_template(
            "scheduling.html",
            drivers=all_drivers,
            holidays=holidays,
            all_school_terms=all_school_terms,
            all_school_closures=all_school_closures,
            school_terms=school_terms,
            school_terms_finished=school_terms_finished,
            finished_school_term_count=finished_school_term_count,
            school_closures=school_closures,
            school_closures_finished=school_closures_finished,
            finished_school_closure_count=finished_school_closure_count,
            time_off_by_driver=time_off_by_driver,
            finished_time_off_days=finished_time_off_days,
            adjustments=adjustments,
            adjustments_by_driver=adjustments_by_driver,
            adjustments_with_finished=adjustments_with_finished,
            finished_adjustment_days=finished_adjustment_days,
            swaps_by_driver=swaps_by_driver,
            swaps_with_finished=swaps_with_finished,
            finished_swap_count=finished_swap_count,
            swap_shift_types=swap_shift_types,
        )

    @app.route("/scheduling/term/add", methods=["POST"])
    def add_school_term():
        """Add a school term date range."""
        name = (request.form.get("name") or "").strip()
        start_date = parse_date_string((request.form.get("start_date") or "").strip())
        end_date = parse_date_string((request.form.get("end_date") or "").strip())

        if not name:
            return _scheduling_redirect("Please enter a term name.")

        if not start_date or not end_date:
            return _scheduling_redirect("Please provide valid start and end dates for the term.")

        if end_date < start_date:
            return _scheduling_redirect("Term end date must be on or after the start date.")

        if start_date.weekday() >= 5 or end_date.weekday() >= 5:
            return _scheduling_redirect("School term start/end dates cannot be on Saturday or Sunday.")

        db.session.add(SchoolTerm(name=name, start_date=start_date, end_date=end_date))
        db.session.commit()
        flash("School term added.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/term/<int:term_id>/delete", methods=["POST"])
    def delete_school_term(term_id):
        """Delete a school term range."""
        term = db.get_or_404(SchoolTerm, term_id)
        now_dt = datetime.now()
        if now_dt > school_term_finished_at(term) and now_dt < school_term_delete_allowed_at(term):
            return _scheduling_redirect("Finished school terms can be deleted 24 hours after they finish.")

        db.session.delete(term)
        db.session.commit()
        flash("School term deleted.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/term/<int:term_id>/edit", methods=["POST"])
    def edit_school_term(term_id):
        """Edit an existing school term."""
        term = db.get_or_404(SchoolTerm, term_id)

        name = (request.form.get("name") or "").strip()
        start_date = parse_date_string((request.form.get("start_date") or "").strip())
        end_date = parse_date_string((request.form.get("end_date") or "").strip())

        if not name:
            return _scheduling_redirect("Please enter a term name.")

        if not start_date or not end_date:
            return _scheduling_redirect("Please provide valid start and end dates for the term.")

        if end_date < start_date:
            return _scheduling_redirect("Term end date must be on or after the start date.")

        if start_date.weekday() >= 5 or end_date.weekday() >= 5:
            return _scheduling_redirect("School term start/end dates cannot be on Saturday or Sunday.")

        term.name = name
        term.start_date = start_date
        term.end_date = end_date
        db.session.commit()
        flash("School term updated.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/term/delete-finished-old", methods=["POST"])
    def delete_finished_school_terms_old():
        """Delete finished school terms that are at least 24 hours past finish."""
        now_dt = datetime.now()
        deletable_terms = [
            term
            for term in SchoolTerm.query.all()
            if now_dt > school_term_finished_at(term) and now_dt >= school_term_delete_allowed_at(term)
        ]

        if not deletable_terms:
            return _scheduling_redirect("No finished school terms are old enough to delete yet.", "warning")

        for term in deletable_terms:
            db.session.delete(term)
        db.session.commit()
        flash(f"Deleted {len(deletable_terms)} old finished school term(s).", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/school-closure/add", methods=["POST"])
    def add_school_closure():
        """Add a school-closed date (bank holiday/training day)."""
        closure_date = parse_date_string((request.form.get("closure_date") or "").strip())
        closure_type = (request.form.get("closure_type") or "").strip()
        notes = (request.form.get("notes") or "").strip() or None

        if not closure_date:
            return _scheduling_redirect("Please provide a valid closure date.")

        if closure_date.weekday() >= 5:
            return _scheduling_redirect("Saturday and Sunday cannot be added to school calendar entries.")

        if closure_type not in ("bank_holiday", "training_day"):
            return _scheduling_redirect("Please choose a valid closure type.")

        existing = SchoolClosureDate.query.filter_by(closure_date=closure_date, closure_type=closure_type).first()
        if existing:
            return _scheduling_redirect("That school closure date already exists.", "warning")

        db.session.add(SchoolClosureDate(closure_date=closure_date, closure_type=closure_type, notes=notes))
        db.session.commit()
        flash("School closure date added.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/school-closure/<int:closure_id>/delete", methods=["POST"])
    def delete_school_closure(closure_id):
        """Delete a school closure date entry."""
        closure = db.get_or_404(SchoolClosureDate, closure_id)
        now_dt = datetime.now()
        if now_dt > school_closure_finished_at(closure) and now_dt < school_closure_delete_allowed_at(closure):
            return _scheduling_redirect("Finished school closed days can be deleted 24 hours after they finish.")

        db.session.delete(closure)
        db.session.commit()
        flash("School closure date deleted.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/school-closure/<int:closure_id>/edit", methods=["POST"])
    def edit_school_closure(closure_id):
        """Edit an existing school-closed day entry."""
        closure = db.get_or_404(SchoolClosureDate, closure_id)

        closure_date = parse_date_string((request.form.get("closure_date") or "").strip())
        closure_type = (request.form.get("closure_type") or "").strip()
        notes = (request.form.get("notes") or "").strip() or None

        if not closure_date:
            return _scheduling_redirect("Please provide a valid closure date.")

        if closure_date.weekday() >= 5:
            return _scheduling_redirect("Saturday and Sunday cannot be added to school calendar entries.")

        if closure_type not in ("bank_holiday", "training_day"):
            return _scheduling_redirect("Please choose a valid closure type.")

        existing = SchoolClosureDate.query.filter(
            SchoolClosureDate.closure_date == closure_date,
            SchoolClosureDate.closure_type == closure_type,
            SchoolClosureDate.id != closure.id,
        ).first()
        if existing:
            return _scheduling_redirect("That school closure date already exists.", "warning")

        closure.closure_date = closure_date
        closure.closure_type = closure_type
        closure.notes = notes
        db.session.commit()
        flash("School closure date updated.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/school-closure/delete-finished-old", methods=["POST"])
    def delete_finished_school_closures_old():
        """Delete finished school closed days that are at least 24 hours past finish."""
        now_dt = datetime.now()
        deletable_closures = [
            closure
            for closure in SchoolClosureDate.query.all()
            if now_dt > school_closure_finished_at(closure) and now_dt >= school_closure_delete_allowed_at(closure)
        ]

        if not deletable_closures:
            return _scheduling_redirect("No finished school closed days are old enough to delete yet.", "warning")

        for closure in deletable_closures:
            db.session.delete(closure)
        db.session.commit()
        flash(f"Deleted {len(deletable_closures)} old finished school closed day(s).", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/holiday/add", methods=["POST"])
    def add_holiday():
        """Add time off date(s) for a driver - supports date ranges."""
        driver_id, driver, err = _require_driver_or_redirect(request.form.get("driver_id"))
        if err:
            return err
        start_date_str = request.form.get("start_date", "").strip()
        end_date_str = request.form.get("end_date", "").strip()
        time_off_type = request.form.get("time_off_type", "holiday").strip()
        notes = request.form.get("notes", "").strip()

        start_date = parse_date_string(start_date_str)
        end_date = parse_date_string(end_date_str)
        if start_date is None or end_date is None:
            return _scheduling_redirect("Invalid date format.")

        if end_date < start_date:
            return _scheduling_redirect("End date must be on or after start date.")

        existing_holiday_dates = {
            row.holiday_date
            for row in DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver_id,
                DriverHoliday.holiday_date >= start_date,
                DriverHoliday.holiday_date <= end_date,
            ).all()
        }

        # If a swap touches the selected holiday window, remove it first so
        # holiday day eligibility is based on the base (non-swapped) pattern.
        removed_swaps = ShiftSwap.query.filter(
            ShiftSwap.driver_a_id == driver_id,
            ShiftSwap.driver_b_id == driver_id,
            ShiftSwap.work_shift_type.isnot(None),
            db.or_(
                db.and_(ShiftSwap.date_a >= start_date, ShiftSwap.date_a <= end_date),
                db.and_(ShiftSwap.date_b >= start_date, ShiftSwap.date_b <= end_date),
            ),
        ).delete(synchronize_session='fetch')

        replaced_count = DriverHoliday.query.filter(
            DriverHoliday.driver_id == driver_id,
            DriverHoliday.holiday_date >= start_date,
            DriverHoliday.holiday_date <= end_date,
        ).delete(synchronize_session='fetch')

        timings_dict = {t.shift_type: t for t in ShiftTiming.query.all()}
        current_date = start_date
        days_added = 0
        added_holiday_dates = []
        while current_date <= end_date:
            base_day_entries = get_driver_shifts_for_date(
                driver,
                current_date,
                timings_dict=timings_dict,
                include_swaps=False,
            )
            has_base_working_shift = any(entry.get('shift_type') != 'day_off' for entry in base_day_entries)
            if has_base_working_shift:
                holiday = DriverHoliday(
                    driver_id=driver_id,
                    holiday_date=current_date,
                    time_off_type=time_off_type,
                    notes=notes or None,
                )
                db.session.add(holiday)
                days_added += 1
                added_holiday_dates.append(current_date)
            current_date += timedelta(days=1)

        newly_added_dates = [d for d in added_holiday_dates if d not in existing_holiday_dates]
        slots_increased_fast_path = _increase_extra_slots_for_new_time_off(driver, newly_added_dates, timings_dict)
        assignments_removed, slots_increased_from_removed_assignments = _remove_extra_assignments_for_new_time_off(driver, newly_added_dates)
        slots_increased = slots_increased_fast_path + slots_increased_from_removed_assignments

        removed_adjustments = 0
        if added_holiday_dates:
            removed_adjustments = ShiftAdjustment.query.filter(
                ShiftAdjustment.driver_id == driver_id,
                ShiftAdjustment.adjustment_date.in_(added_holiday_dates),
            ).delete(synchronize_session='fetch')

        _refresh_extra_request_statuses_for_dates(newly_added_dates)

        db.session.commit()

        if days_added == 0:
            success_msg = f"No working days found in the selected range for {driver.formatted_name()} — nothing added."
        elif days_added == 1:
            success_msg = f"Time off on {start_date.strftime('%d/%m/%Y')} added for {driver.formatted_name()}."
        else:
            success_msg = (
                f"{days_added} working day(s) marked as time off for {driver.formatted_name()} "
                f"({start_date.strftime('%d/%m/%Y')} to {end_date.strftime('%d/%m/%Y')})."
            )

        if replaced_count:
            success_msg += f" Replaced {replaced_count} overlapping day(s) to keep time off types non-overlapping."
        if removed_swaps:
            success_msg += f" Removed {removed_swaps} swap(s) that overlapped the selected holiday range."
        if removed_adjustments:
            success_msg += f" Removed {removed_adjustments} adjustment(s) on new time-off date(s)."
        if assignments_removed:
            success_msg += f" Removed {assignments_removed} extra-car assignment(s) on new time-off date(s)."
        if slots_increased:
            success_msg += f" Increased required slots on {slots_increased} extra-car request(s) due to new time off."

        flash(success_msg, "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/holiday/<int:holiday_id>/delete", methods=["POST"])
    def delete_holiday(holiday_id):
        """Delete a time off record."""
        holiday = db.get_or_404(DriverHoliday, holiday_id)
        driver_name = holiday.driver.formatted_name()
        date_str = holiday.holiday_date.strftime('%d/%m/%Y')
        db.session.delete(holiday)
        db.session.commit()
        flash(f"Time off on {date_str} for {driver_name} removed.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/holiday/<int:holiday_id>/delete-group", methods=["POST"])
    def delete_holiday_group(holiday_id):
        """Delete all time off in a grouped block identified by first record."""
        first_holiday = db.get_or_404(DriverHoliday, holiday_id)
        driver_id = first_holiday.driver_id
        time_off_type = first_holiday.time_off_type or "holiday"
        notes = first_holiday.notes or ""
        start_date = first_holiday.holiday_date

        timings_dict = {t.shift_type: t for t in ShiftTiming.query.all()}

        # Find grouped block - include dates bridged only by non-working days
        holidays_to_delete = [first_holiday]
        candidates = DriverHoliday.query.filter(
            DriverHoliday.driver_id == driver_id,
            DriverHoliday.holiday_date > start_date,
        ).order_by(DriverHoliday.holiday_date.asc()).all()

        for candidate in candidates:
            candidate_type = candidate.time_off_type or "holiday"
            candidate_notes = candidate.notes or ""
            if candidate_type != time_off_type or candidate_notes != notes:
                continue

            last_holiday = holidays_to_delete[-1]
            day_gap = (candidate.holiday_date - last_holiday.holiday_date).days
            if day_gap <= 0:
                continue

            if day_gap == 1:
                holidays_to_delete.append(candidate)
                continue

            bridges_only_non_working = True
            check_date = last_holiday.holiday_date + timedelta(days=1)
            while check_date < candidate.holiday_date:
                if driver_has_working_shift_on_date(first_holiday.driver, check_date, timings_dict):
                    bridges_only_non_working = False
                    break
                check_date += timedelta(days=1)

            if bridges_only_non_working:
                holidays_to_delete.append(candidate)
            else:
                break

        end_date = holidays_to_delete[-1].holiday_date
        driver_name = first_holiday.driver.formatted_name()

        for holiday in holidays_to_delete:
            db.session.delete(holiday)

        db.session.commit()

        if len(holidays_to_delete) == 1:
            flash(f"Time off on {start_date.strftime('%d/%m/%Y')} for {driver_name} removed.", "success")
        else:
            flash(f"Time off block ({start_date.strftime('%d/%m/%Y')} to {end_date.strftime('%d/%m/%Y')}) for {driver_name} removed.", "success")

        return redirect(url_for("scheduling"))

    @app.route("/scheduling/holiday/<int:driver_id>/delete-finished", methods=["POST"])
    def delete_finished_holidays_for_driver(driver_id):
        """Delete all finished time off records (past dates) for a driver."""
        driver = db.get_or_404(Driver, driver_id)
        today = datetime.now().date()

        deleted_count = DriverHoliday.query.filter(
            DriverHoliday.driver_id == driver_id,
            DriverHoliday.holiday_date < today,
        ).delete(synchronize_session=False)

        db.session.commit()

        if deleted_count:
            flash(f"Removed {deleted_count} finished time off day(s) for {driver.formatted_name()}.", "success")
        else:
            flash(f"No finished time off to remove for {driver.formatted_name()}.", "warning")

        return redirect(url_for("scheduling"))

    @app.route("/scheduling/holiday/delete-finished-all", methods=["POST"])
    def delete_all_finished_holidays():
        """Delete all finished time off records for all drivers."""
        today = datetime.now().date()

        deleted_count = DriverHoliday.query.filter(
            DriverHoliday.holiday_date < today,
        ).delete(synchronize_session=False)

        db.session.commit()

        if deleted_count:
            flash(f"Removed {deleted_count} finished time off day(s).", "success")
        else:
            flash("No finished time off to remove.", "warning")

        return redirect(url_for("scheduling"))

    @app.route("/scheduling/holiday/update", methods=["POST"])
    def update_holiday():
        """Update a holiday group - delete old dates and create new range."""
        data = request.get_json() or {}

        driver_id = data.get("driver_id")
        old_start_str = data.get("old_start_date")
        old_end_str = data.get("old_end_date")
        new_start_str = data.get("new_start_date")
        new_end_str = data.get("new_end_date")
        time_off_type = data.get("time_off_type", "holiday").strip()
        notes = data.get("notes", "").strip()

        driver = db.get_or_404(Driver, driver_id)
        old_start = parse_date_string(old_start_str)
        old_end = parse_date_string(old_end_str)
        new_start = parse_date_string(new_start_str)
        new_end = parse_date_string(new_end_str)
        if None in (old_start, old_end, new_start, new_end):
            flash("Invalid date format.", "warning")
            return jsonify({"success": False, "message": "Invalid date format"}), 400

        if new_end < new_start:
            flash("End date must be on or after start date.", "warning")
            return jsonify({"success": False, "message": "End date must be on or after start date"}), 400

        existing_holiday_dates = {
            row.holiday_date
            for row in DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver_id,
            ).all()
        }

        try:
            # Remove the original edited block
            DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver_id,
                DriverHoliday.holiday_date >= old_start,
                DriverHoliday.holiday_date <= old_end,
            ).delete(synchronize_session='fetch')

            # Remove swaps touching the target range so holiday eligibility uses
            # base (non-swapped) working days.
            removed_swaps = ShiftSwap.query.filter(
                ShiftSwap.driver_a_id == driver_id,
                ShiftSwap.driver_b_id == driver_id,
                ShiftSwap.work_shift_type.isnot(None),
                db.or_(
                    db.and_(ShiftSwap.date_a >= new_start, ShiftSwap.date_a <= new_end),
                    db.and_(ShiftSwap.date_b >= new_start, ShiftSwap.date_b <= new_end),
                ),
            ).delete(synchronize_session='fetch')

            # Enforce non-overlap by clearing any remaining records in target range
            replaced_count = DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver_id,
                DriverHoliday.holiday_date >= new_start,
                DriverHoliday.holiday_date <= new_end,
            ).delete(synchronize_session='fetch')

            # Write updated block (working days only)
            timings_dict = {t.shift_type: t for t in ShiftTiming.query.all()}
            current_date = new_start
            added_holiday_dates = []
            while current_date <= new_end:
                base_day_entries = get_driver_shifts_for_date(
                    driver,
                    current_date,
                    timings_dict=timings_dict,
                    include_swaps=False,
                )
                has_base_working_shift = any(entry.get('shift_type') != 'day_off' for entry in base_day_entries)
                if has_base_working_shift:
                    holiday = DriverHoliday(
                        driver_id=driver_id,
                        holiday_date=current_date,
                        time_off_type=time_off_type,
                        notes=notes or None,
                    )
                    db.session.add(holiday)
                    added_holiday_dates.append(current_date)
                current_date += timedelta(days=1)

            newly_added_dates = [d for d in added_holiday_dates if d not in existing_holiday_dates]
            slots_increased_fast_path = _increase_extra_slots_for_new_time_off(driver, newly_added_dates, timings_dict)
            assignments_removed, slots_increased_from_removed_assignments = _remove_extra_assignments_for_new_time_off(driver, newly_added_dates)
            slots_increased = slots_increased_fast_path + slots_increased_from_removed_assignments

            removed_adjustments = 0
            if added_holiday_dates:
                removed_adjustments = ShiftAdjustment.query.filter(
                    ShiftAdjustment.driver_id == driver_id,
                    ShiftAdjustment.adjustment_date.in_(added_holiday_dates),
                ).delete(synchronize_session='fetch')

            _refresh_extra_request_statuses_for_dates(newly_added_dates)

            db.session.commit()
            success_msg = f"Time off updated for {driver.formatted_name()}."
            if replaced_count:
                success_msg += f" Replaced {replaced_count} overlapping day(s) to keep time off types non-overlapping."
            if removed_swaps:
                success_msg += f" Removed {removed_swaps} swap(s) that overlapped the selected holiday range."
            if removed_adjustments:
                success_msg += f" Removed {removed_adjustments} adjustment(s) on new time-off date(s)."
            if assignments_removed:
                success_msg += f" Removed {assignments_removed} extra-car assignment(s) on new time-off date(s)."
            if slots_increased:
                success_msg += f" Increased required slots on {slots_increased} extra-car request(s) due to new time off."
            flash(success_msg, "success")
            return jsonify({"success": True, "message": f"Time off updated for {driver.formatted_name()}"})
        except Exception:
            db.session.rollback()
            flash("Could not update time off. Please try again.", "error")
            return jsonify({"success": False, "message": "Could not update time off"}), 500

    @app.route("/api/driver/<int:driver_id>", methods=["GET"])
    def api_get_driver(driver_id):
        """Get basic driver info for AJAX endpoints."""
        driver = db.get_or_404(Driver, driver_id)
        return jsonify({
            "id": driver.id,
            "formatted_name": driver.formatted_name(),
            "name": driver.name,
            "formatted_driver_number": driver.formatted_driver_number()
        })

    @app.route("/scheduling/adjustment/validate", methods=["POST"])
    def validate_adjustment_ajax():
        """AJAX endpoint to validate an adjustment before save."""
        data = request.get_json(silent=True) or request.form

        driver, err = require_driver(data.get("driver_id"))
        if err:
            return err

        date_str = (data.get("adjustment_date") or "").strip()
        adjustment_type = (data.get("adjustment_type") or "").strip()
        time_str = (data.get("adjusted_time") or "").strip()

        adj_date, err = require_date(date_str, "adjustment date")
        if err:
            return err

        if adjustment_type not in ("late_start", "early_finish"):
            return json_error("Adjustment type must be 'late_start' or 'early_finish'.")

        adjusted_time = parse_time_string(time_str)
        if adjusted_time is None:
            return json_error("Invalid time format. Use HH:MM.")

        validation_error = validate_adjustment_time(driver, adj_date, adjustment_type, adjusted_time)
        if validation_error:
            return jsonify({"success": False, "errors": [validation_error]})

        existing_same_type = ShiftAdjustment.query.filter_by(
            driver_id=driver.id,
            adjustment_date=adj_date,
            adjustment_type=adjustment_type,
        ).first()
        if existing_same_type:
            label = "Late Start" if adjustment_type == "late_start" else "Early Finish"
            return jsonify({"success": False, "errors": [f"Only one {label} adjustment is allowed per driver per day."]})

        return jsonify({"success": True, "errors": []})

    @app.route("/scheduling/adjustment/add", methods=["POST"])
    def add_adjustment():
        """Add a one-off shift adjustment (late start or early finish)."""
        driver_id, driver, err = _require_driver_or_redirect(request.form.get("driver_id"))
        if err:
            return err
        date_str = request.form.get("adjustment_date", "").strip()
        adjustment_type = request.form.get("adjustment_type", "").strip()
        time_str = request.form.get("adjusted_time", "").strip()
        notes = request.form.get("notes", "").strip()

        if adjustment_type not in ("late_start", "early_finish"):
            return _scheduling_redirect("Adjustment type must be 'late_start' or 'early_finish'.")

        adj_date = parse_date_string(date_str)
        if adj_date is None:
            return _scheduling_redirect("Invalid date format.")

        adjusted_time = parse_time_string(time_str)
        if adjusted_time is None:
            return _scheduling_redirect("Invalid time format. Use HH:MM.")

        validation_error = validate_adjustment_time(driver, adj_date, adjustment_type, adjusted_time)
        if validation_error:
            return _scheduling_redirect(validation_error)

        existing_same_type = ShiftAdjustment.query.filter_by(
            driver_id=driver_id,
            adjustment_date=adj_date,
            adjustment_type=adjustment_type,
        ).first()
        if existing_same_type:
            label = "Late Start" if adjustment_type == "late_start" else "Early Finish"
            return _scheduling_redirect(f"Only one {label} adjustment is allowed per driver per day.")

        adjustment = ShiftAdjustment(
            driver_id=driver_id,
            adjustment_date=adj_date,
            adjustment_type=adjustment_type,
            adjusted_time=adjusted_time,
            notes=notes or None,
        )
        db.session.add(adjustment)
        db.session.commit()
        label = "Late Start" if adjustment_type == "late_start" else "Early Finish"
        flash(f"{label} on {adj_date.strftime('%d/%m/%Y')} added for {driver.formatted_name()}.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/adjustment/<int:adjustment_id>/edit", methods=["POST"])
    def edit_adjustment(adjustment_id):
        """Edit a shift adjustment."""
        adjustment = db.get_or_404(ShiftAdjustment, adjustment_id)
        date_str = request.form.get("adjustment_date", "").strip()
        adjustment_type = request.form.get("adjustment_type", "").strip()
        time_str = request.form.get("adjusted_time", "").strip()
        notes = request.form.get("notes", "").strip()

        if adjustment_type not in ("late_start", "early_finish"):
            return _scheduling_redirect("Adjustment type must be 'late_start' or 'early_finish'.")

        adj_date = parse_date_string(date_str)
        if adj_date is None:
            return _scheduling_redirect("Invalid date format.")

        adjusted_time = parse_time_string(time_str)
        if adjusted_time is None:
            return _scheduling_redirect("Invalid time format. Use HH:MM.")

        validation_error = validate_adjustment_time(
            adjustment.driver,
            adj_date,
            adjustment_type,
            adjusted_time,
            exclude_adjustment_id=adjustment.id,
        )
        if validation_error:
            return _scheduling_redirect(validation_error)

        existing_same_type = ShiftAdjustment.query.filter(
            ShiftAdjustment.driver_id == adjustment.driver_id,
            ShiftAdjustment.adjustment_date == adj_date,
            ShiftAdjustment.adjustment_type == adjustment_type,
            ShiftAdjustment.id != adjustment.id,
        ).first()
        if existing_same_type:
            label = "Late Start" if adjustment_type == "late_start" else "Early Finish"
            return _scheduling_redirect(f"Only one {label} adjustment is allowed per driver per day.")

        adjustment.adjustment_date = adj_date
        adjustment.adjustment_type = adjustment_type
        adjustment.adjusted_time = adjusted_time
        adjustment.notes = notes or None
        db.session.commit()
        flash("Adjustment updated.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/adjustment/<int:adjustment_id>/delete", methods=["POST"])
    def delete_adjustment(adjustment_id):
        """Delete a shift adjustment."""
        adjustment = db.get_or_404(ShiftAdjustment, adjustment_id)
        rest_error = check_adjustment_deletion_rest_violation(adjustment.driver, adjustment)
        if rest_error:
            flash(rest_error, "error")
            return redirect(url_for("scheduling"))
        db.session.delete(adjustment)
        db.session.commit()
        flash("Adjustment removed.", "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/adjustment/<int:driver_id>/delete-finished", methods=["POST"])
    def delete_finished_adjustments_for_driver(driver_id):
        """Delete all finished (past-date) adjustments for a driver."""
        driver = db.get_or_404(Driver, driver_id)
        today = datetime.now().date()

        deleted_count = ShiftAdjustment.query.filter(
            ShiftAdjustment.driver_id == driver_id,
            ShiftAdjustment.adjustment_date < today,
        ).delete(synchronize_session=False)

        db.session.commit()

        if deleted_count:
            flash(f"Removed {deleted_count} finished adjustment(s) for {driver.formatted_name()}.", "success")
        else:
            flash(f"No finished adjustments to remove for {driver.formatted_name()}.", "warning")

        return redirect(url_for("scheduling"))

    @app.route("/scheduling/adjustment/delete-finished-all", methods=["POST"])
    def delete_all_finished_adjustments():
        """Delete all finished (past-date) adjustments for all drivers."""
        today = datetime.now().date()

        deleted_count = ShiftAdjustment.query.filter(
            ShiftAdjustment.adjustment_date < today,
        ).delete(synchronize_session=False)

        db.session.commit()

        if deleted_count:
            flash(f"Removed {deleted_count} finished adjustment(s).", "success")
        else:
            flash("No finished adjustments to remove.", "warning")

        return redirect(url_for("scheduling"))

    @app.route("/scheduling/swap/delete-finished-all", methods=["POST"])
    def delete_all_finished_swaps():
        """Delete all finished (past work-date) swap records for all drivers."""
        today = datetime.now().date()

        deleted_count = ShiftSwap.query.filter(
            ShiftSwap.driver_a_id == ShiftSwap.driver_b_id,
            ShiftSwap.work_shift_type.isnot(None),
            ShiftSwap.date_b < today,
        ).delete(synchronize_session=False)

        db.session.commit()

        if deleted_count:
            flash(f"Removed {deleted_count} finished swap(s).", "success")
        else:
            flash("No finished swaps to remove.", "warning")

        return redirect(url_for("scheduling"))

    @app.route("/scheduling/swap/validate", methods=["POST"])
    def validate_swap_ajax():
        """AJAX endpoint to validate a proposed single-driver day swap before confirming."""
        data = request.get_json(silent=True) or request.form
        give_up_date_str = (data.get("give_up_date") or "").strip()
        work_date_str = (data.get("work_date") or "").strip()
        raw_wst = data.get("work_shift_type") or ""
        if isinstance(raw_wst, list):
            work_shift_types = [t.strip() for t in raw_wst if str(t).strip()]
        else:
            work_shift_types = [t.strip() for t in str(raw_wst).split(',') if t.strip()]

        driver, err = require_driver(data.get("driver_id"))
        if err:
            return err

        give_up_date, err = require_date(give_up_date_str, "give-up date")
        if err:
            return err
        work_date, err = require_date(work_date_str, "work date")
        if err:
            return err

        errors = validate_swap(driver, give_up_date, work_date, work_shift_types)
        if errors:
            return jsonify({"success": False, "errors": errors})
        return jsonify({"success": True, "errors": []})

    @app.route("/scheduling/swap/add", methods=["POST"])
    def add_swap():
        """Add a confirmed single-driver day swap."""
        driver_id, driver, err = _require_driver_or_redirect(request.form.get("driver_id"))
        if err:
            return err
        give_up_date_str = request.form.get("give_up_date", "").strip()
        work_date_str = request.form.get("work_date", "").strip()
        raw_wst = request.form.get("work_shift_type", "").strip()
        work_shift_types = [t.strip() for t in raw_wst.split(',') if t.strip()]
        approved_by = request.form.get("approved_by", "").strip()
        notes = request.form.get("notes", "").strip()

        if not approved_by:
            return validation_errors_response(
                ["Approved by is required."],
                redirect_factory=lambda: redirect(url_for("scheduling")),
            )

        swap_notes = f"Approved by: {approved_by}"
        if notes:
            swap_notes = f"{swap_notes}\n{notes}"

        give_up_date = parse_date_string(give_up_date_str)
        work_date = parse_date_string(work_date_str)
        if give_up_date is None or work_date is None:
            return _scheduling_redirect("Invalid date format.")

        errors = validate_swap(driver, give_up_date, work_date, work_shift_types)
        if errors:
            return validation_errors_response(
                errors,
                redirect_factory=lambda: redirect(url_for("scheduling")),
            )

        removed_holiday_dates = []

        # Allow a holiday-covered working day to be used as the give-up date.
        # Saving the swap converts that date from holiday back to a plain day off.
        holiday_on_give_up = DriverHoliday.query.filter(
            DriverHoliday.driver_id == driver_id,
            DriverHoliday.holiday_date == give_up_date,
        ).first()
        if holiday_on_give_up:
            swap_notes = append_swap_holiday_restore_metadata(
                swap_notes,
                holiday_on_give_up.holiday_date,
                holiday_on_give_up.time_off_type,
                holiday_on_give_up.notes,
            )
            db.session.delete(holiday_on_give_up)
            removed_holiday_dates.append(give_up_date)

        # Delete adjustments on give-up date only when it truly becomes day off
        if give_up_date != work_date:
            existing_adjustments = ShiftAdjustment.query.filter(
                ShiftAdjustment.driver_id == driver_id,
                ShiftAdjustment.adjustment_date == give_up_date
            ).all()
            for adjustment in existing_adjustments:
                db.session.delete(adjustment)

        # Sort shift types by start_time so they are stored in time order
        all_timings = {t.shift_type: t for t in ShiftTiming.query.all()}
        work_shift_types.sort(key=lambda wst: (
            all_timings[wst].start_time if wst in all_timings and all_timings[wst].start_time else time(23, 59)
        ))
        for wst in work_shift_types:
            swap = ShiftSwap(
                driver_a_id=driver_id,
                driver_b_id=driver_id,
                date_a=give_up_date,
                date_b=work_date,
                work_shift_type=wst,
                notes=swap_notes,
            )
            db.session.add(swap)

        db.session.flush()

        removed_split_adjustments = 0
        removed_invalid_adjustment_details = []
        if is_split_shift_day(driver, work_date, include_swaps=True):
            removed_split_adjustments = ShiftAdjustment.query.filter(
                ShiftAdjustment.driver_id == driver_id,
                ShiftAdjustment.adjustment_date == work_date,
            ).delete(synchronize_session=False)
        else:
            # Re-validate existing adjustments against the new swapped shift window
            adjustments_on_work_date = ShiftAdjustment.query.filter(
                ShiftAdjustment.driver_id == driver_id,
                ShiftAdjustment.adjustment_date == work_date,
            ).order_by(ShiftAdjustment.id.asc()).all()

            for adj in adjustments_on_work_date:
                err = validate_adjustment_time(
                    driver, work_date, adj.adjustment_type,
                    adj.adjusted_time, exclude_adjustment_id=adj.id,
                )
                if err:
                    label = "Late start" if adj.adjustment_type == "late_start" else "Early finish"
                    removed_invalid_adjustment_details.append(
                        f"{label} {adj.adjusted_time.strftime('%H:%M')}"
                    )
                    db.session.delete(adj)

        db.session.commit()

        shift_type_labels = ', '.join(
            all_timings[wst].display_label if wst in all_timings and all_timings[wst].display_label else shift_label(wst)
            for wst in work_shift_types
        )

        success_message = (
            f"Swap recorded: {driver.formatted_name()} gives up {give_up_date.strftime('%d/%m/%Y')} "
            f"and works {work_date.strftime('%d/%m/%Y')} ({shift_type_labels})."
        )
        if removed_split_adjustments:
            success_message += (
                f" Removed {removed_split_adjustments} adjustment(s) on {work_date.strftime('%d/%m/%Y')} "
                "because split shift days do not use late/early adjustments."
            )
        if removed_invalid_adjustment_details:
            success_message += (
                f" Removed {len(removed_invalid_adjustment_details)} adjustment(s) on "
                f"{work_date.strftime('%d/%m/%Y')} as they are no longer valid for the swapped shift "
                f"({', '.join(removed_invalid_adjustment_details)})."
            )
        if removed_holiday_dates:
            removed_holiday_text = ", ".join(d.strftime('%d/%m/%Y') for d in removed_holiday_dates)
            success_message += f" Converted holiday date(s) to normal day off for the give-up side of the swap: {removed_holiday_text}."

        flash(success_message, "success")
        return redirect(url_for("scheduling"))

    @app.route("/scheduling/swap/<int:swap_id>/delete", methods=["POST"])
    def delete_swap(swap_id):
        """Delete a swap record."""
        swap = db.get_or_404(ShiftSwap, swap_id)
        driver = swap.driver
        work_date = swap.work_date

        sibling_swaps = ShiftSwap.query.filter(
            ShiftSwap.driver_a_id == swap.driver_a_id,
            ShiftSwap.driver_b_id == swap.driver_b_id,
            ShiftSwap.date_a == swap.date_a,
            ShiftSwap.date_b == swap.date_b,
            ShiftSwap.work_shift_type.isnot(None),
        ).all()

        for row in sibling_swaps:
            db.session.delete(row)
        db.session.flush()

        removed_adjustments = 0
        removed_adjustment_details = []
        removed_time_off_dates = []
        restored_time_off_dates = []
        timings_dict = {t.shift_type: t for t in ShiftTiming.query.all()}
        restore_holiday_meta = []
        for sibling in sibling_swaps:
            restore_holiday_meta.extend(extract_swap_holiday_restore_metadata(sibling.notes))
        if not driver_has_working_shift_on_date(driver, work_date):
            adjustments_to_remove = ShiftAdjustment.query.filter(
                ShiftAdjustment.driver_id == driver.id,
                ShiftAdjustment.adjustment_date == work_date,
            ).order_by(ShiftAdjustment.adjustment_type.asc(), ShiftAdjustment.adjusted_time.asc()).all()

            for adjustment in adjustments_to_remove:
                label = "Late Start" if adjustment.adjustment_type == "late_start" else "Early Finish"
                removed_adjustment_details.append(f"{label} {adjustment.adjusted_time.strftime('%H:%M')}")
                db.session.delete(adjustment)

            removed_adjustments = len(adjustments_to_remove)
        else:
            # The day is still a working day, but removing the swap can change the
            # shift window (e.g. swapped 16:00-02:00 back to base 06:00-16:00).
            # Remove any adjustments that are no longer valid for the restored window.
            adjustments_on_work_date = ShiftAdjustment.query.filter(
                ShiftAdjustment.driver_id == driver.id,
                ShiftAdjustment.adjustment_date == work_date,
            ).order_by(ShiftAdjustment.adjustment_type.asc(), ShiftAdjustment.adjusted_time.asc()).all()

            for adjustment in adjustments_on_work_date:
                validation_error = validate_adjustment_time(
                    driver,
                    work_date,
                    adjustment.adjustment_type,
                    adjustment.adjusted_time,
                    exclude_adjustment_id=adjustment.id,
                )
                if validation_error:
                    label = "Late Start" if adjustment.adjustment_type == "late_start" else "Early Finish"
                    removed_adjustment_details.append(f"{label} {adjustment.adjusted_time.strftime('%H:%M')}")
                    db.session.delete(adjustment)

            removed_adjustments = len(removed_adjustment_details)

        # Keep time-off records aligned with effective working state after swap removal.
        # 1) Remove time-off rows from dates that are now non-working.
        # 2) If a date becomes working again and sits inside an existing time-off block,
        #    restore that date as time off so the block remains intact.
        for target_date in {swap.date_a, swap.date_b}:
            has_working_shift = driver_has_working_shift_on_date(driver, target_date, timings_dict)
            existing_time_off = DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver.id,
                DriverHoliday.holiday_date == target_date,
            ).first()

            if not has_working_shift:
                if existing_time_off:
                    db.session.delete(existing_time_off)
                    removed_time_off_dates.append(target_date)
                continue

            if existing_time_off:
                continue

            matching_restore_meta = next(
                (
                    meta for meta in restore_holiday_meta
                    if meta.get('date') == target_date.strftime('%Y-%m-%d')
                ),
                None,
            )
            if matching_restore_meta:
                db.session.add(
                    DriverHoliday(
                        driver_id=driver.id,
                        holiday_date=target_date,
                        time_off_type=matching_restore_meta.get('time_off_type') or 'holiday',
                        notes=matching_restore_meta.get('notes') or None,
                    )
                )
                restored_time_off_dates.append(target_date)
                continue

            prev_time_off = DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver.id,
                DriverHoliday.holiday_date < target_date,
            ).order_by(DriverHoliday.holiday_date.desc()).first()
            next_time_off = DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver.id,
                DriverHoliday.holiday_date > target_date,
            ).order_by(DriverHoliday.holiday_date.asc()).first()

            if not prev_time_off or not next_time_off:
                continue

            prev_type = prev_time_off.time_off_type or "holiday"
            next_type = next_time_off.time_off_type or "holiday"
            prev_notes = prev_time_off.notes or ""
            next_notes = next_time_off.notes or ""
            if prev_type != next_type or prev_notes != next_notes:
                continue

            if not (prev_time_off.holiday_date < target_date < next_time_off.holiday_date):
                continue

            in_same_block = True
            check_date = prev_time_off.holiday_date + timedelta(days=1)
            while check_date < next_time_off.holiday_date:
                if check_date == target_date:
                    check_date += timedelta(days=1)
                    continue

                day_time_off = DriverHoliday.query.filter(
                    DriverHoliday.driver_id == driver.id,
                    DriverHoliday.holiday_date == check_date,
                ).first()
                if day_time_off:
                    day_type = day_time_off.time_off_type or "holiday"
                    day_notes = day_time_off.notes or ""
                    if day_type != prev_type or day_notes != prev_notes:
                        in_same_block = False
                        break
                elif driver_has_working_shift_on_date(driver, check_date, timings_dict):
                    in_same_block = False
                    break

                check_date += timedelta(days=1)

            if not in_same_block:
                continue

            db.session.add(
                DriverHoliday(
                    driver_id=driver.id,
                    holiday_date=target_date,
                    time_off_type=prev_time_off.time_off_type,
                    notes=prev_time_off.notes,
                )
            )
            restored_time_off_dates.append(target_date)

        db.session.commit()

        messages = []
        if removed_adjustments:
            detail_text = ", ".join(removed_adjustment_details)
            messages.append(
                f"Removed {removed_adjustments} adjustment(s) on {work_date.strftime('%d/%m/%Y')} because they are no longer valid for that day: {detail_text}."
            )

        if removed_time_off_dates:
            removed_dates_text = ", ".join(d.strftime('%d/%m/%Y') for d in sorted(removed_time_off_dates))
            messages.append(
                f"Removed time off from non-working date(s): {removed_dates_text}."
            )

        if restored_time_off_dates:
            restored_dates_text = ", ".join(d.strftime('%d/%m/%Y') for d in sorted(restored_time_off_dates))
            messages.append(
                f"Restored time off on date(s) back inside an existing time-off block: {restored_dates_text}."
            )

        if messages:
            flash(f"Swap removed. {' '.join(messages)}", "success")
            return redirect(url_for("scheduling"))

        removed_swaps = len(sibling_swaps) if sibling_swaps else 1
        if removed_swaps > 1:
            flash(f"Swap removed ({removed_swaps} shift entries).", "success")
        else:
            flash("Swap removed.", "success")
        return redirect(url_for("scheduling"))
