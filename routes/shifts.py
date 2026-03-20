from flask import render_template, request, redirect, url_for, flash, jsonify
from datetime import datetime

from extensions import db
from models import ShiftPattern, ShiftTiming, DriverAssignment, DriverCustomTiming
from utils import (
    json_success, json_error, is_ajax_request,
    validation_error_response,
    parse_positive_int, parse_day_shifts_from_form,
    normalize_day_shifts, compact_day_shifts,
)


def register(app):
    @app.route("/shifts")
    def shifts():
        """List all shift patterns and shift type management"""
        all_patterns = ShiftPattern.query.order_by(ShiftPattern.name).all()
        all_timings = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
        timings = {timing.shift_type: timing for timing in all_timings}
        return render_template("shifts.html", patterns=all_patterns, timings=timings, all_timings=all_timings)

    @app.route("/shift-types/update", methods=["POST"])
    def update_shift_types():
        """Update shift type timings"""
        try:
            submitted_shift_types = []
            for key in request.form.keys():
                if key.endswith("_start"):
                    submitted_shift_types.append(key[:-6])

            rename_map = {}
            normalized_new_names = set()

            for old_shift_type in submitted_shift_types:
                requested_name = request.form.get(f"{old_shift_type}_name", old_shift_type)
                display_name = requested_name.strip()
                new_shift_type = requested_name.strip().lower().replace(" ", "_")

                if not new_shift_type:
                    return json_error('Shift type name cannot be empty')

                if not display_name:
                    return json_error('Shift display name cannot be empty')

                if not new_shift_type.replace("_", "").isalnum():
                    return json_error('Shift type can only use letters, numbers, and underscores')

                if new_shift_type in normalized_new_names:
                    return json_error('Two shift types cannot have the same name')

                normalized_new_names.add(new_shift_type)
                rename_map[old_shift_type] = new_shift_type

            existing_db_names = {timing.shift_type for timing in ShiftTiming.query.all()}
            submitted_set = set(submitted_shift_types)
            for old_shift_type, new_shift_type in rename_map.items():
                if new_shift_type != old_shift_type and new_shift_type in existing_db_names and new_shift_type not in submitted_set:
                    return json_error(f'Shift type name already exists: {new_shift_type}')

            processed_shift_types = set()
            for old_shift_type in submitted_shift_types:
                if old_shift_type in processed_shift_types:
                    continue

                new_shift_type = rename_map[old_shift_type]
                display_name = request.form.get(f"{old_shift_type}_name", old_shift_type).strip()
                start_time_str = request.form.get(f"{old_shift_type}_start")
                end_time_str = request.form.get(f"{old_shift_type}_end")
                badge_color = request.form.get(f"{old_shift_type}_color", "bg-primary")
                icon = request.form.get(f"{old_shift_type}_icon", "fas fa-clock")
                parent_shift_type = request.form.get(f"{old_shift_type}_parent", "").strip() or None
                school_term_only = request.form.get(f"{old_shift_type}_school_term_only") in ("1", "true", "on", "yes")

                if not start_time_str or not end_time_str:
                    continue

                if parent_shift_type == '_none':
                    parent_shift_type = None
                elif parent_shift_type in rename_map:
                    parent_shift_type = rename_map[parent_shift_type]

                if parent_shift_type and parent_shift_type not in normalized_new_names and parent_shift_type not in existing_db_names:
                    return json_error(f'Selected parent shift does not exist: {parent_shift_type}')

                if parent_shift_type == new_shift_type:
                    return json_error('A shift cannot be grouped under itself')

                start_time = datetime.strptime(start_time_str, '%H:%M').time()
                end_time = datetime.strptime(end_time_str, '%H:%M').time()

                timing = ShiftTiming.query.filter_by(shift_type=old_shift_type).first()
                if timing:
                    timing.shift_type = new_shift_type
                    timing.display_name = display_name
                    timing.start_time = start_time
                    timing.end_time = end_time
                    timing.badge_color = badge_color
                    timing.icon = icon
                    timing.parent_shift_type = parent_shift_type
                    timing.school_term_only = school_term_only
                else:
                    timing = ShiftTiming(
                        shift_type=new_shift_type,
                        display_name=display_name,
                        start_time=start_time,
                        end_time=end_time,
                        badge_color=badge_color,
                        icon=icon,
                        parent_shift_type=parent_shift_type,
                        school_term_only=school_term_only,
                    )
                    db.session.add(timing)

                processed_shift_types.add(old_shift_type)

            changed_names = {old: new for old, new in rename_map.items() if old != new}
            if changed_names:
                patterns = ShiftPattern.query.all()
                for pattern in patterns:
                    pattern_data = pattern.get_pattern_data()
                    updated_data = []
                    for day_entry in pattern_data:
                        day_shifts = normalize_day_shifts(day_entry)
                        renamed = [changed_names.get(shift, shift) for shift in day_shifts]
                        updated_data.append(compact_day_shifts(renamed))
                    if updated_data != pattern_data:
                        pattern.set_pattern_data(updated_data)

                for old_shift_type, new_shift_type in changed_names.items():
                    DriverCustomTiming.query.filter_by(shift_type=old_shift_type).update(
                        {'shift_type': new_shift_type}, synchronize_session=False
                    )
                    DriverCustomTiming.query.filter_by(override_shift=old_shift_type).update(
                        {'override_shift': new_shift_type}, synchronize_session=False
                    )
                    ShiftTiming.query.filter_by(parent_shift_type=old_shift_type).update(
                        {'parent_shift_type': new_shift_type}, synchronize_session=False
                    )

            db.session.commit()
            return json_success()
        except (ValueError, TypeError) as e:
            db.session.rollback()
            return json_error(str(e))

    @app.route("/shift-types/add", methods=["POST"])
    def add_shift_type():
        """Add a new shift type"""
        try:
            raw_shift_name = request.form.get("shift_type", "").strip()
            base_shift_type = raw_shift_name.lower().replace(" ", "_")
            display_name = request.form.get("display_name", "").strip() or raw_shift_name
            start_time_str = request.form.get("start_time")
            end_time_str = request.form.get("end_time")
            badge_color = request.form.get("badge_color", "bg-primary")
            icon = request.form.get("icon", "fas fa-clock")
            parent_shift_type = request.form.get("parent_shift_type", "").strip() or None
            school_term_only = request.form.get("school_term_only") in ("1", "true", "on", "yes")

            if parent_shift_type == '_none':
                parent_shift_type = None

            if not base_shift_type or not start_time_str or not end_time_str:
                return json_error('All fields are required')

            if not base_shift_type.replace("_", "").isalnum():
                return json_error('Shift type can only use letters, numbers, and underscores')

            # Check if display name already exists (prevent duplicate user-facing names)
            existing_display = ShiftTiming.query.filter_by(display_name=display_name).first()
            if existing_display:
                existing_start = existing_display.start_time.strftime('%H:%M') if existing_display.start_time else 'N/A'
                existing_end = existing_display.end_time.strftime('%H:%M') if existing_display.end_time else 'N/A'
                return json_error(
                    f"A shift type with display name '{display_name}' already exists ({existing_start}-{existing_end}). "
                    f"Please use a different name."
                )

            # Find unique internal shift_type name by appending numbers if needed
            shift_type = base_shift_type
            counter = 2
            while ShiftTiming.query.filter_by(shift_type=shift_type).first():
                shift_type = f"{base_shift_type}_{counter}"
                counter += 1

            # Validate parent exists if specified
            if parent_shift_type:
                parent = ShiftTiming.query.filter_by(shift_type=parent_shift_type).first()
                if not parent:
                    return json_error('Selected parent shift does not exist')

            start_time = datetime.strptime(start_time_str, '%H:%M').time()
            end_time = datetime.strptime(end_time_str, '%H:%M').time()

            timing = ShiftTiming(shift_type=shift_type, display_name=display_name, start_time=start_time, end_time=end_time,
                       badge_color=badge_color, icon=icon, parent_shift_type=parent_shift_type,
                       school_term_only=school_term_only)
            db.session.add(timing)
            db.session.commit()
            return json_success()
        except (ValueError, TypeError) as e:
            db.session.rollback()
            return json_error(str(e))

    @app.route("/shift-types/delete/<shift_type>", methods=["POST"])
    def delete_shift_type(shift_type):
        """Delete a shift type if not in use"""
        try:
            # Check if shift type is used in any patterns
            timing = ShiftTiming.query.filter_by(shift_type=shift_type).first()
            if not timing:
                return json_error('Shift type not found')

            patterns_using = timing.get_patterns_using_shift()
            if patterns_using:
                pattern_names = ', '.join([p.name for p in patterns_using])
                message = f'Cannot delete shift type while it is used in patterns: {pattern_names}'
                return json_error(message)

            # Check if other shifts are grouped under this shift type
            child_shifts = ShiftTiming.query.filter_by(parent_shift_type=shift_type).all()
            if child_shifts:
                child_names = ', '.join([s.display_label for s in child_shifts])
                message = f'Cannot delete shift type while other shifts are grouped under it: {child_names}'
                return json_error(message)

            # Check if used in custom driver timings
            custom_timing = DriverCustomTiming.query.filter(
                db.or_(
                    DriverCustomTiming.shift_type == shift_type,
                    DriverCustomTiming.override_shift == shift_type
                )
            ).first()
            if custom_timing:
                return json_error('Cannot delete shift type while it is used in custom driver timings')

            db.session.delete(timing)
            db.session.commit()
            return json_success()
        except Exception as e:
            db.session.rollback()
            return json_error(str(e))

    @app.route("/shift-types/<shift_type>/data", methods=["GET"])
    def get_shift_type_data(shift_type):
        """Get shift type data for editing"""
        timing = ShiftTiming.query.filter_by(shift_type=shift_type).first()
        if not timing:
            return json_error('Shift type not found'), 404

        return jsonify({
            'shift_type': timing.shift_type,
            'display_label': timing.display_label,
            'start_time': timing.start_time.strftime('%H:%M'),
            'end_time': timing.end_time.strftime('%H:%M'),
            'badge_color': timing.badge_color,
            'icon': timing.icon,
            'parent_shift_type': timing.parent_shift_type,
            'school_term_only': bool(timing.school_term_only),
        })

    @app.route("/shift-types/<shift_type>/edit", methods=["POST"])
    def edit_shift_type(shift_type):
        """Edit an existing shift type"""
        try:
            timing = ShiftTiming.query.filter_by(shift_type=shift_type).first()
            if not timing:
                return json_error('Shift type not found')

            display_name = request.form.get("shift_type", "").strip()
            start_time_str = request.form.get("start_time")
            end_time_str = request.form.get("end_time")
            badge_color = request.form.get("badge_color", "bg-primary")
            icon = request.form.get("icon", "fas fa-clock")
            parent_shift_type = request.form.get("parent_shift_type", "").strip() or None
            school_term_only = request.form.get("school_term_only") in ("1", "true", "on", "yes")

            if parent_shift_type == '_none':
                parent_shift_type = None

            if not display_name or not start_time_str or not end_time_str:
                return json_error('All fields are required')

            # Validate parent exists if specified
            if parent_shift_type:
                parent = ShiftTiming.query.filter_by(shift_type=parent_shift_type).first()
                if not parent:
                    return json_error('Selected parent shift does not exist')

            start_time = datetime.strptime(start_time_str, '%H:%M').time()
            end_time = datetime.strptime(end_time_str, '%H:%M').time()

            timing.display_name = display_name
            timing.start_time = start_time
            timing.end_time = end_time
            timing.badge_color = badge_color
            timing.icon = icon
            timing.parent_shift_type = parent_shift_type
            timing.school_term_only = school_term_only

            db.session.commit()
            return json_success()
        except (ValueError, TypeError) as e:
            db.session.rollback()
            return json_error(str(e))

    @app.route("/shift-pattern/add", methods=["GET", "POST"])
    def add_shift_pattern():
        """Add new shift pattern"""
        if request.method == "POST":
            redirect_factory = lambda: redirect(url_for("shifts"))

            # Block pattern creation if no shift types are defined
            if not ShiftTiming.query.first():
                message = 'No shift types defined. Please add shift types before creating patterns.'
                return validation_error_response(message, redirect_factory=redirect_factory)

            cycle_length = parse_positive_int(request.form.get("cycle_length", 7))
            if not cycle_length:
                message = 'Cycle length must be a positive number.'
                return validation_error_response(message, redirect_factory=redirect_factory)

            pattern_name = (request.form.get("name") or "").strip()
            if not pattern_name:
                message = 'Pattern name is required.'
                return validation_error_response(message, redirect_factory=redirect_factory)

            pattern_data = []

            for day in range(cycle_length):
                try:
                    day_shifts = parse_day_shifts_from_form(request.form, day)
                except ValueError as exc:
                    message = str(exc)
                    return validation_error_response(message, redirect_factory=redirect_factory)
                pattern_data.append(day_shifts)

            pattern = ShiftPattern(
                name=pattern_name,
                description=request.form.get("description"),
                cycle_length=cycle_length
            )
            pattern.set_pattern_data(pattern_data)

            try:
                db.session.add(pattern)
                db.session.commit()

                if is_ajax_request():
                    return json_success()

                flash("Shift pattern added successfully!", "success")
                return redirect(url_for("shifts"))
            except Exception as e:
                db.session.rollback()
                if is_ajax_request():
                    return json_error(str(e))

                flash(f"Error adding shift pattern: {e}", "error")

        return render_template("shifts.html")

    @app.route("/shift-pattern/<int:pattern_id>/edit-data")
    def get_shift_pattern_edit_data(pattern_id):
        """Get shift pattern data for editing"""
        pattern = db.get_or_404(ShiftPattern, pattern_id)
        return jsonify({
            'id': pattern.id,
            'name': pattern.name,
            'description': pattern.description,
            'cycle_length': pattern.cycle_length,
            'pattern_data': pattern.get_pattern_data()
        })

    @app.route("/shift-pattern/<int:pattern_id>/edit", methods=["POST"])
    def edit_shift_pattern(pattern_id):
        """Edit existing shift pattern"""
        pattern = db.get_or_404(ShiftPattern, pattern_id)

        try:
            # Update basic info
            pattern_name = (request.form.get("name") or "").strip()
            if not pattern_name:
                return json_error('Pattern name is required')

            cycle_length = parse_positive_int(request.form.get("cycle_length", 7))
            if not cycle_length:
                return json_error('Cycle length must be a positive number')

            pattern.name = pattern_name
            pattern.description = request.form.get("description")
            pattern.cycle_length = cycle_length

            # Update pattern data
            pattern_data = []
            for day in range(pattern.cycle_length):
                day_shifts = parse_day_shifts_from_form(request.form, day)
                pattern_data.append(day_shifts)
            pattern.set_pattern_data(pattern_data)

            db.session.commit()
            return json_success()
        except Exception as e:
            db.session.rollback()
            return json_error(str(e))

    @app.route("/shift-pattern/<int:pattern_id>/delete", methods=["POST"])
    def delete_shift_pattern(pattern_id):
        """Delete shift pattern"""
        pattern = db.get_or_404(ShiftPattern, pattern_id)
        today = datetime.now().date()

        # Block deletion if any assignment is active or scheduled.
        # Allow deletion when all assignments ended before today.
        has_active_or_scheduled = DriverAssignment.query.filter(
            DriverAssignment.shift_pattern_id == pattern_id,
            db.or_(
                DriverAssignment.end_date.is_(None),
                DriverAssignment.end_date >= today
            )
        ).first()

        if has_active_or_scheduled:
            message = "Cannot delete pattern while it has active or scheduled assignments. End or reassign those first."
            return validation_error_response(message, redirect_factory=lambda: redirect(url_for("shifts")))

        try:
            db.session.delete(pattern)
            db.session.commit()

            if is_ajax_request():
                return json_success()

            flash("Shift pattern deleted successfully!", "success")
        except Exception as e:
            db.session.rollback()

            if is_ajax_request():
                return json_error(str(e))

            flash(f"Error deleting shift pattern: {e}", "error")

        return redirect(url_for("shifts"))
