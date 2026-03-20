from flask import request, flash, jsonify
from datetime import datetime, timedelta
from sqlalchemy import and_, or_

from extensions import db
from models import Driver, ShiftTiming, DriverCustomTiming, DriverAssignment, DriverHoliday, ShiftAdjustment, ShiftSwap
from utils import (
    json_success, json_error, is_ajax_request,
    parse_optional_int, parse_time_string, parse_month_start,
    validation_error_response,
    redirect_to_driver_custom_timings_panel,
    get_driver_shifts_for_date, shift_label,
)


def register(app):
    @app.route("/driver/<int:driver_id>/custom-timings")
    def driver_custom_timings(driver_id):
        """Legacy route: redirect to integrated custom timings panel in Drivers."""
        db.get_or_404(Driver, driver_id)
        return redirect_to_driver_custom_timings_panel(driver_id)

    @app.route("/driver/<int:driver_id>/custom-timings/add", methods=["GET", "POST"])
    def add_custom_timing(driver_id):
        """Add a new custom timing for a driver"""
        driver = db.get_or_404(Driver, driver_id)

        if request.method != "POST":
            return redirect_to_driver_custom_timings_panel(driver_id)

        try:
            # Parse form data
            assignment_id = parse_optional_int(request.form.get("assignment_id"))
            shift_type = request.form.get("shift_type") or None
            day_of_cycle = request.form.get("day_of_cycle")
            day_of_week = request.form.get("day_of_week") or None
            start_time_str = request.form.get("start_time")
            end_time_str = request.form.get("end_time")
            priority = parse_optional_int(request.form.get("priority")) or 100
            notes = request.form.get("notes")

            # Convert and validate fields
            start_time = parse_time_string(start_time_str)
            end_time = parse_time_string(end_time_str)
            day_of_cycle = parse_optional_int(day_of_cycle)
            day_of_week = parse_optional_int(day_of_week)

            # Validate that at least one time override is provided, or a notes entry is given
            if start_time_str and not start_time:
                flash("Invalid start time format", "error")
                return redirect_to_driver_custom_timings_panel(driver_id)

            if end_time_str and not end_time:
                flash("Invalid end time format", "error")
                return redirect_to_driver_custom_timings_panel(driver_id)

            if priority is None:
                flash("Invalid priority", "error")
                return redirect_to_driver_custom_timings_panel(driver_id)

            if day_of_week is not None and (day_of_week < 0 or day_of_week > 6):
                flash("Day of week must be between 0 and 6", "error")
                return redirect_to_driver_custom_timings_panel(driver_id)

            if day_of_cycle is not None and day_of_cycle < 0:
                flash("Day of cycle must be 0 or greater", "error")
                return redirect_to_driver_custom_timings_panel(driver_id)

            # Create timing
            timing = DriverCustomTiming(
                driver_id=driver_id,
                assignment_id=assignment_id,
                shift_type=shift_type,
                day_of_cycle=day_of_cycle,
                day_of_week=day_of_week,
                start_time=start_time,
                end_time=end_time,
                priority=priority,
                notes=notes
            )

            db.session.add(timing)
            db.session.commit()
            flash("Custom timing added successfully!", "success")
            return redirect_to_driver_custom_timings_panel(driver_id)

        except Exception as e:
            db.session.rollback()
            flash(f"Error adding custom timing: {e}", "error")
            return redirect_to_driver_custom_timings_panel(driver_id)

        return redirect_to_driver_custom_timings_panel(driver_id)

    @app.route("/custom-timing/<int:timing_id>/delete", methods=["POST"])
    def delete_custom_timing(timing_id):
        """Delete a custom timing"""
        timing = db.get_or_404(DriverCustomTiming, timing_id)
        driver_id = timing.driver_id

        try:
            db.session.delete(timing)
            db.session.commit()

            # Return JSON if AJAX request
            if is_ajax_request():
                return json_success()

            flash("Custom timing deleted successfully!", "success")
        except Exception as e:
            db.session.rollback()

            # Return JSON error if AJAX request
            if is_ajax_request():
                return json_error(f"Error deleting timing: {e}")

            flash(f"Error deleting timing: {e}", "error")

        return redirect_to_driver_custom_timings_panel(driver_id)

    @app.route("/custom-timing/<int:timing_id>/edit", methods=["POST"])
    def edit_custom_timing(timing_id):
        """Edit an existing custom timing"""
        timing = db.get_or_404(DriverCustomTiming, timing_id)
        driver_id = timing.driver_id

        try:
            assignment_id = parse_optional_int(request.form.get("assignment_id"))
            shift_type = request.form.get("shift_type") or None
            day_of_week_mode = (request.form.get("day_of_week_mode") or "").strip()
            override_shift = request.form.get("override_shift") or None
            day_of_cycle = parse_optional_int(request.form.get("day_of_cycle"))
            day_of_week = parse_optional_int(request.form.get("day_of_week"))
            start_time_str = request.form.get("start_time")
            end_time_str = request.form.get("end_time")
            priority = parse_optional_int(request.form.get("priority")) or 4
            notes = request.form.get("notes") or None
            assignment = None
            if assignment_id is not None:
                assignment = DriverAssignment.query.filter_by(id=assignment_id, driver_id=driver_id).first()

            start_time = parse_time_string(start_time_str)
            end_time = parse_time_string(end_time_str)

            if day_of_week is None:
                override_shift = None
                day_of_week_mode = ""
            else:
                if day_of_week_mode == "day_off":
                    override_shift = "day_off"
                    start_time = None
                    end_time = None
                elif day_of_week_mode == "custom_times":
                    override_shift = None
                else:
                    day_of_week_mode = "override"

            # Validate times: logic depends on day_of_week and shift_type
            redirect_factory = lambda: redirect_to_driver_custom_timings_panel(driver_id)
            if start_time_str and not start_time:
                return validation_error_response("Invalid start time format", redirect_factory=redirect_factory)
            elif end_time_str and not end_time:
                return validation_error_response("Invalid end time format", redirect_factory=redirect_factory)
            elif day_of_week is not None and override_shift and (start_time or end_time):
                return validation_error_response(
                    "Choose either Override Shift, Day Off, or Custom Times for a day-of-week rule, not both",
                    redirect_factory=redirect_factory,
                )
            elif (day_of_week is None or not override_shift) and not start_time and not end_time:
                if day_of_week is not None and not override_shift:
                    return validation_error_response(
                        "When selecting custom times for a day-of-week rule, you must enter at least one time",
                        redirect_factory=redirect_factory,
                    )
                return validation_error_response(
                    "You must enter either a start time, end time, or both",
                    redirect_factory=redirect_factory,
                )
            elif priority is None:
                return validation_error_response("Priority must be a number between 1 and 7", redirect_factory=redirect_factory)
            elif priority < 1 or priority > 7:
                return validation_error_response("Priority must be between 1 and 7", redirect_factory=redirect_factory)
            elif day_of_week is not None and (day_of_week < 0 or day_of_week > 6):
                return validation_error_response("Day of week must be between 0 and 6", redirect_factory=redirect_factory)
            elif day_of_cycle is not None and day_of_cycle < 0:
                return validation_error_response("Day of cycle must be 0 or greater", redirect_factory=redirect_factory)
            elif assignment_id is not None and not assignment:
                return validation_error_response("Invalid assignment selected", redirect_factory=redirect_factory)
            elif assignment is not None and day_of_week is None and day_of_cycle is not None and shift_type:
                return validation_error_response(
                    "When an assignment is selected, choose either Cycle Day or Shift Type, not both.",
                    redirect_factory=redirect_factory,
                )
            else:
                timing.assignment_id = assignment_id
                timing.shift_type = shift_type
                timing.day_of_cycle = day_of_cycle
                timing.day_of_week = day_of_week
                timing.override_shift = override_shift
                timing.start_time = start_time
                timing.end_time = end_time
                timing.priority = priority
                timing.notes = notes
                db.session.commit()

                if is_ajax_request():
                    return json_success()

                flash("Custom timing updated successfully!", "success")

        except Exception as e:
            db.session.rollback()
            error_msg = f"Error updating custom timing: {e}"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")

        return redirect_to_driver_custom_timings_panel(driver_id)

    @app.route("/driver/<int:driver_id>/custom-timings/list")
    def get_driver_custom_timings_list(driver_id):
        """Get list of custom timings for a driver (AJAX)"""
        driver = db.get_or_404(Driver, driver_id)
        timings = DriverCustomTiming.query.filter_by(driver_id=driver_id).order_by(
            DriverCustomTiming.priority.asc(),
            DriverCustomTiming.id.asc()
        ).all()

        return jsonify({
            "success": True,
            "driver_name": driver.formatted_name(),
            "timings": [
                {
                    "id": t.id,
                    "assignment_id": t.assignment_id,
                    "assignment_name": t.assignment.shift_pattern.name if t.assignment else None,
                    "shift_type": t.shift_type,
                    "day_of_cycle": t.day_of_cycle,
                    "day_of_week": t.day_of_week,
                    "override_shift": t.override_shift,
                    "day_cycle_shifts": (
                        t.assignment.shift_pattern.get_shifts_for_day(t.day_of_cycle)
                        if t.assignment and t.assignment.shift_pattern and t.day_of_cycle is not None
                        else []
                    ),
                    "start_time": t.start_time.strftime("%H:%M") if t.start_time else None,
                    "end_time": t.end_time.strftime("%H:%M") if t.end_time else None,
                    "notes": t.notes,
                    "priority": t.priority
                }
                for t in timings
            ]
        })

    @app.route("/driver/<int:driver_id>/calendar-data")
    def get_driver_calendar_data(driver_id):
        driver = db.get_or_404(Driver, driver_id)

        month_start, month_error = parse_month_start(request.args.get("month", ""))
        if month_error:
            return json_error(month_error)

        next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
        month_days = (next_month - month_start).days

        all_timings = ShiftTiming.query.all()
        timings_dict = {timing.shift_type: timing for timing in all_timings}

        # Get holidays for this driver in the month
        holidays_in_month = DriverHoliday.query.filter(
            DriverHoliday.driver_id == driver_id,
            DriverHoliday.holiday_date >= month_start,
            DriverHoliday.holiday_date < next_month
        ).all()
        holiday_dates = {h.holiday_date.strftime("%Y-%m-%d"): h for h in holidays_in_month}

        adjustments_in_month = ShiftAdjustment.query.filter(
            ShiftAdjustment.driver_id == driver_id,
            ShiftAdjustment.adjustment_date >= month_start,
            ShiftAdjustment.adjustment_date < next_month,
        ).order_by(ShiftAdjustment.adjustment_date.asc(), ShiftAdjustment.id.asc()).all()

        adjustment_dates = {}
        for adjustment in adjustments_in_month:
            date_key = adjustment.adjustment_date.strftime("%Y-%m-%d")
            if date_key not in adjustment_dates:
                adjustment_dates[date_key] = []
            adjustment_dates[date_key].append(adjustment)

        swaps_in_month = ShiftSwap.query.filter(
            ShiftSwap.driver_a_id == driver_id,
            ShiftSwap.driver_b_id == driver_id,
            ShiftSwap.work_shift_type.isnot(None),
            or_(
                and_(ShiftSwap.date_a >= month_start, ShiftSwap.date_a < next_month),
                and_(ShiftSwap.date_b >= month_start, ShiftSwap.date_b < next_month),
            ),
        ).all()

        swap_give_up_dates = {}
        swap_work_dates = {}
        for swap in swaps_in_month:
            give_up_key = swap.date_a.strftime("%Y-%m-%d")
            work_key = swap.date_b.strftime("%Y-%m-%d")

            give_up_entry = {
                "swap_id": swap.id,
                "role": "give_up",
                "other_date": work_key,
                "work_shift_type": swap.work_shift_type,
            }
            work_entry = {
                "swap_id": swap.id,
                "role": "work",
                "other_date": give_up_key,
                "work_shift_type": swap.work_shift_type,
                "work_shift_label": (
                    timings_dict[swap.work_shift_type].display_label
                    if swap.work_shift_type in timings_dict
                    else shift_label(swap.work_shift_type)
                ),
            }

            swap_give_up_dates.setdefault(give_up_key, []).append(give_up_entry)
            swap_work_dates.setdefault(work_key, []).append(work_entry)

        today = datetime.now().date()
        days = []
        for day_offset in range(month_days):
            current_date = month_start + timedelta(days=day_offset)
            date_str = current_date.strftime("%Y-%m-%d")
            holiday_record = holiday_dates.get(date_str)
            is_holiday = holiday_record is not None
            day_adjustments = adjustment_dates.get(date_str, [])

            # If on holiday, show no shifts (holiday overrides)
            day_entries = [] if is_holiday else get_driver_shifts_for_date(driver, current_date, timings_dict, include_extra=True)
            base_day_entries = [] if is_holiday else get_driver_shifts_for_date(driver, current_date, timings_dict, include_swaps=False)
            has_base_working_shift = any(entry.get("shift_type") != "day_off" for entry in base_day_entries)

            days.append({
                "date": date_str,
                "day": current_date.day,
                "is_today": current_date == today,
                "is_holiday": is_holiday,
                "time_off_type": holiday_record.time_off_type if holiday_record else None,
                "has_swap_give_up": date_str in swap_give_up_dates,
                "has_swap_work": date_str in swap_work_dates,
                "swap_give_up_count": len(swap_give_up_dates.get(date_str, [])),
                "swap_work_count": len(swap_work_dates.get(date_str, [])),
                "has_base_working_shift": has_base_working_shift,
                "swaps": swap_give_up_dates.get(date_str, []) + swap_work_dates.get(date_str, []),
                "adjustments": [
                    {
                        "adjustment_type": adj.adjustment_type,
                        "label": "Late Start" if adj.adjustment_type == "late_start" else "Early Finish",
                        "time": adj.adjusted_time.strftime("%H:%M"),
                        "notes": adj.notes or "",
                    }
                    for adj in day_adjustments
                ],
                "shifts": [
                    {
                        "shift_type": entry["shift_type"],
                        "label": entry["label"],
                        "badge_color": entry["badge_color"],
                        "icon": entry["icon"],
                        "start_time": entry["start_time"].strftime("%H:%M") if entry["start_time"] else None,
                        "end_time": entry["end_time"].strftime("%H:%M") if entry["end_time"] else None,
                        "default_start_time": entry["default_start_time"].strftime("%H:%M") if entry["default_start_time"] else None,
                        "default_end_time": entry["default_end_time"].strftime("%H:%M") if entry["default_end_time"] else None,
                        "is_override": entry["is_override"],
                        "is_custom_time": entry["is_custom_time"],
                        "is_swap": bool(entry.get("is_swap")),
                        "swap_role": entry.get("swap_role"),
                        "is_extra": bool(entry.get("is_extra")),
                    }
                    for entry in day_entries
                ]
            })

        return jsonify({
            "success": True,
            "driver_name": driver.formatted_name(),
            "month": month_start.strftime("%Y-%m"),
            "month_label": month_start.strftime("%B %Y"),
            "first_weekday": month_start.weekday(),
            "days": days,
        })

    @app.route("/scheduling/calendar-view")
    def scheduling_calendar_view():
        """Get all drivers' time off for calendar view (AJAX)"""
        month_start, month_error = parse_month_start(request.args.get("month", ""))
        if month_error:
            return json_error(month_error)

        next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)

        # Get all holidays in this month
        holidays = DriverHoliday.query.filter(
            DriverHoliday.holiday_date >= month_start,
            DriverHoliday.holiday_date < next_month
        ).all()

        driver_ids = {holiday.driver_id for holiday in holidays}
        drivers = Driver.query.filter(Driver.id.in_(driver_ids)).all() if driver_ids else []
        driver_number_map = {driver.id: driver.driver_number for driver in drivers}

        # Group by date for easy calendar rendering
        days_data = {}
        for holiday in holidays:
            date_str = holiday.holiday_date.strftime("%Y-%m-%d")
            if date_str not in days_data:
                days_data[date_str] = []
            days_data[date_str].append({
                "driver_id": holiday.driver_id,
                "driver_number": driver_number_map.get(holiday.driver_id, holiday.driver_id),
                "time_off_type": holiday.time_off_type or "holiday",
            })

        return jsonify({
            "success": True,
            "month": month_start.strftime("%Y-%m"),
            "days": days_data,
        })

    @app.route("/custom-timing/<int:timing_id>/get")
    def get_custom_timing(timing_id):
        """Get a specific custom timing (AJAX)"""
        timing = db.get_or_404(DriverCustomTiming, timing_id)

        return jsonify({
            "success": True,
            "timing": {
                "id": timing.id,
                "assignment_id": timing.assignment_id,
                "shift_type": timing.shift_type,
                "day_of_cycle": timing.day_of_cycle,
                "day_of_week": timing.day_of_week,
                "override_shift": timing.override_shift,
                "start_time": timing.start_time.strftime("%H:%M") if timing.start_time else None,
                "end_time": timing.end_time.strftime("%H:%M") if timing.end_time else None,
                "notes": timing.notes,
                "priority": timing.priority
            }
        })

    @app.route("/driver/<int:driver_id>/custom-timing/add", methods=["POST"])
    def add_custom_timing_ajax(driver_id):
        """Add custom timing via AJAX"""
        driver = db.get_or_404(Driver, driver_id)

        try:
            assignment_id = parse_optional_int(request.form.get("assignment_id"))
            shift_type = request.form.get("shift_type") or None
            day_of_week_mode = (request.form.get("day_of_week_mode") or "").strip()
            override_shift = request.form.get("override_shift") or None
            day_of_cycle = parse_optional_int(request.form.get("day_of_cycle"))
            day_of_week = parse_optional_int(request.form.get("day_of_week"))
            start_time_str = request.form.get("start_time")
            end_time_str = request.form.get("end_time")
            priority = parse_optional_int(request.form.get("priority")) or 4
            notes = request.form.get("notes") or None
            assignment = None

            start_time = parse_time_string(start_time_str)
            end_time = parse_time_string(end_time_str)

            if day_of_week is None:
                override_shift = None
                day_of_week_mode = ""
            else:
                if day_of_week_mode == "day_off":
                    override_shift = "day_off"
                    start_time = None
                    end_time = None
                elif day_of_week_mode == "custom_times":
                    override_shift = None
                else:
                    day_of_week_mode = "override"

            if start_time_str and not start_time:
                return json_error("Invalid start time format")
            if end_time_str and not end_time:
                return json_error("Invalid end time format")
            if day_of_week is not None and override_shift and (start_time or end_time):
                return json_error("Choose either Override Shift, Day Off, or Custom Times for a day-of-week rule, not both")
            # Time requirement logic:
            # - If day_of_week + override_shift set: times optional (override mode)
            # - Otherwise: at least one time required
            if day_of_week is None or not override_shift:
                if not start_time and not end_time:
                    if day_of_week is not None and not override_shift:
                        return json_error("When selecting custom times for a day-of-week rule, you must enter at least one time")
                    elif day_of_week is None:
                        return json_error("You must enter either a start time, end time, or both")
            if priority is None or priority < 1 or priority > 7:
                return json_error("Priority must be between 1 and 7")
            if day_of_week is not None and (day_of_week < 0 or day_of_week > 6):
                return json_error("Day of week must be 0-6")
            if day_of_cycle is not None and day_of_cycle < 0:
                return json_error("Day of cycle must be >= 0")
            if assignment_id is not None:
                assignment = DriverAssignment.query.filter_by(id=assignment_id, driver_id=driver_id).first()
                if not assignment:
                    return json_error("Invalid assignment selected")
            # Mutual exclusion: without day_of_week, can't have both shift_type and day_of_cycle
            # With day_of_week selected, shift_type remains a filter and can combine with day_of_cycle
            if assignment is not None and day_of_week is None and day_of_cycle is not None and shift_type:
                return json_error("When an assignment is selected, choose either Cycle Day or Shift Type, not both.")
            timing = DriverCustomTiming(
                driver_id=driver_id,
                assignment_id=assignment_id,
                shift_type=shift_type,
                day_of_cycle=day_of_cycle,
                day_of_week=day_of_week,
                override_shift=override_shift,
                start_time=start_time,
                end_time=end_time,
                priority=priority,
                notes=notes
            )

            db.session.add(timing)
            db.session.commit()
            return json_success(timing_id=timing.id)

        except Exception as e:
            db.session.rollback()
            return json_error(str(e))
