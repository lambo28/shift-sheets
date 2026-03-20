from flask import render_template, request, redirect, url_for, flash, jsonify
from datetime import datetime, timedelta, time

from extensions import db
from models import (
    Driver, ShiftTiming, ShiftAdjustment, ShiftSwap,
    DriverHoliday, SchoolTerm, SchoolClosureDate,
)
from utils import (
    json_success, json_error,
    validation_error_response,
    validation_errors_response,
    parse_date_string, parse_time_string, parse_positive_int,
    require_driver, require_date,
    validate_adjustment_time, validate_swap,
    group_consecutive_holidays,
    get_driver_shifts_for_date,
    is_driver_on_holiday, is_split_shift_day, driver_has_working_shift_on_date,
    shift_label,
    school_term_finished_at, school_term_delete_allowed_at,
    school_closure_finished_at, school_closure_delete_allowed_at,
)


def register(app):
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
                    "notes": swap.notes,
                    "give_up_shift_entries": list(swap.give_up_shift_entries or []),
                    "work_shift_entries": [],
                    "swap_ids": [],
                }
                merged_swaps_map[merge_key] = merged

            merged["swap_ids"].append(swap.id)
            if not merged.get("notes") and swap.notes:
                merged["notes"] = swap.notes

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

        replaced_count = DriverHoliday.query.filter(
            DriverHoliday.driver_id == driver_id,
            DriverHoliday.holiday_date >= start_date,
            DriverHoliday.holiday_date <= end_date,
        ).delete(synchronize_session='fetch')

        current_date = start_date
        days_added = 0
        while current_date <= end_date:
            holiday = DriverHoliday(
                driver_id=driver_id,
                holiday_date=current_date,
                time_off_type=time_off_type,
                notes=notes or None,
            )
            db.session.add(holiday)
            days_added += 1
            current_date += timedelta(days=1)

        db.session.commit()

        if days_added == 1:
            success_msg = f"Time off on {start_date.strftime('%d/%m/%Y')} added for {driver.formatted_name()}."
        else:
            success_msg = (
                f"{days_added} time off days added for {driver.formatted_name()} "
                f"({start_date.strftime('%d/%m/%Y')} to {end_date.strftime('%d/%m/%Y')})."
            )

        if replaced_count:
            success_msg += f" Replaced {replaced_count} overlapping day(s) to keep time off types non-overlapping."

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
        """Delete all time off in a group (consecutive dates) identified by first record."""
        first_holiday = db.get_or_404(DriverHoliday, holiday_id)
        driver_id = first_holiday.driver_id
        time_off_type = first_holiday.time_off_type or "holiday"
        notes = first_holiday.notes or ""
        start_date = first_holiday.holiday_date

        # Find the group - collect all consecutive time off
        holidays_to_delete = [first_holiday]
        next_date = start_date + timedelta(days=1)
        while True:
            next_holiday = DriverHoliday.query.filter_by(driver_id=driver_id, holiday_date=next_date).first()
            if not next_holiday:
                break

            next_type = next_holiday.time_off_type or "holiday"
            next_notes = next_holiday.notes or ""
            if next_type != time_off_type or next_notes != notes:
                break

            holidays_to_delete.append(next_holiday)
            next_date += timedelta(days=1)

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

        try:
            # Remove the original edited block
            DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver_id,
                DriverHoliday.holiday_date >= old_start,
                DriverHoliday.holiday_date <= old_end,
            ).delete(synchronize_session='fetch')

            # Enforce non-overlap by clearing any remaining records in target range
            replaced_count = DriverHoliday.query.filter(
                DriverHoliday.driver_id == driver_id,
                DriverHoliday.holiday_date >= new_start,
                DriverHoliday.holiday_date <= new_end,
            ).delete(synchronize_session='fetch')

            # Write updated block
            current_date = new_start
            while current_date <= new_end:
                holiday = DriverHoliday(
                    driver_id=driver_id,
                    holiday_date=current_date,
                    time_off_type=time_off_type,
                    notes=notes or None,
                )
                db.session.add(holiday)
                current_date += timedelta(days=1)

            db.session.commit()
            success_msg = f"Time off updated for {driver.formatted_name()}."
            if replaced_count:
                success_msg += f" Replaced {replaced_count} overlapping day(s) to keep time off types non-overlapping."
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
        notes = request.form.get("notes", "").strip()

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
                notes=notes or None,
            )
            db.session.add(swap)

        db.session.flush()

        removed_split_adjustments = 0
        if is_split_shift_day(driver, work_date, include_swaps=True):
            removed_split_adjustments = ShiftAdjustment.query.filter(
                ShiftAdjustment.driver_id == driver_id,
                ShiftAdjustment.adjustment_date == work_date,
            ).delete(synchronize_session=False)

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

        db.session.commit()

        if removed_adjustments:
            detail_text = ", ".join(removed_adjustment_details)
            flash(
                f"Swap removed. Also removed {removed_adjustments} adjustment(s) on {work_date.strftime('%d/%m/%Y')} because that day is now off: {detail_text}.",
                "success",
            )
            return redirect(url_for("scheduling"))

        removed_swaps = len(sibling_swaps) if sibling_swaps else 1
        if removed_swaps > 1:
            flash(f"Swap removed ({removed_swaps} shift entries).", "success")
        else:
            flash("Swap removed.", "success")
        return redirect(url_for("scheduling"))
