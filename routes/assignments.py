from flask import render_template, request, redirect, url_for, flash, jsonify
from datetime import datetime, timedelta, date

from extensions import db
from models import Driver, ShiftPattern, DriverAssignment
from utils import (
    parse_date_string, parse_optional_int, serialize_driver_assignment_items,
    is_ajax_request,
)


def register(app):
    @app.route("/driver/<int:driver_id>/assign-pattern", methods=["GET", "POST"])
    def assign_pattern_to_driver(driver_id):
        """Assign a shift pattern to a driver"""
        driver = db.get_or_404(Driver, driver_id)
        patterns = ShiftPattern.query.all()

        if request.method == "POST":
            is_ajax = is_ajax_request()
            start_date = parse_date_string(request.form.get("start_date"))
            end_date = parse_date_string(request.form.get("end_date")) if request.form.get("end_date") else None
            pattern_id = parse_optional_int(request.form.get("pattern_id"))
            start_day_of_cycle = parse_optional_int(request.form.get("start_day_of_cycle")) or 1

            if not start_date:
                if is_ajax:
                    return jsonify({"ok": False, "error": "Invalid start date"}), 400
                flash("Invalid start date", "error")
                return redirect(url_for("drivers"))
            if request.form.get("end_date") and not end_date:
                if is_ajax:
                    return jsonify({"ok": False, "error": "Invalid end date"}), 400
                flash("Invalid end date", "error")
                return redirect(url_for("drivers"))
            if end_date and end_date < start_date:
                if is_ajax:
                    return jsonify({"ok": False, "error": "End date cannot be before start date"}), 400
                flash("End date cannot be before start date", "error")
                return redirect(url_for("drivers"))
            if not pattern_id:
                if is_ajax:
                    return jsonify({"ok": False, "error": "Invalid shift pattern"}), 400
                flash("Invalid shift pattern", "error")
                return redirect(url_for("drivers"))

            # Find any overlapping assignments that need to be ended
            overlapping_assignments = DriverAssignment.query.filter(
                DriverAssignment.driver_id == driver_id,
                DriverAssignment.start_date < start_date,  # Started before new assignment
                db.or_(
                    DriverAssignment.end_date.is_(None),  # Ongoing assignment
                    DriverAssignment.end_date >= start_date  # Or ends after new assignment starts
                )
            ).all()

            # Create new assignment first so we have an ID to reference
            assignment = DriverAssignment(
                driver_id=driver_id,
                shift_pattern_id=pattern_id,
                start_date=start_date,
                end_date=end_date,
                start_day_of_cycle=start_day_of_cycle
            )

            try:
                db.session.add(assignment)
                db.session.flush()  # Get the ID without committing

                # Handle overlapping assignments
                for overlapping in overlapping_assignments:
                    original_end_date = overlapping.end_date
                    # Store original end date before modifying, then set to day before new assignment starts
                    overlapping.original_end_date = original_end_date
                    overlapping.end_date = start_date - timedelta(days=1)
                    overlapping.paused_by_assignment_id = assignment.id

                    # If the new assignment is temporary (has end_date) and the overlapping one
                    # would have continued past the new assignment's end, create a resumption
                    should_resume = False
                    resume_end_date = None

                    if end_date:
                        if not original_end_date:
                            # Overlapping was ongoing - will resume as ongoing
                            should_resume = True
                            resume_end_date = None
                        elif original_end_date > end_date:
                            # Overlapping had end date beyond new assignment - will resume with original end date
                            should_resume = True
                            resume_end_date = original_end_date

                    if should_resume:
                        resumption = DriverAssignment(
                            driver_id=driver_id,
                            shift_pattern_id=overlapping.shift_pattern_id,
                            start_date=end_date + timedelta(days=1),
                            end_date=resume_end_date,
                            start_day_of_cycle=overlapping.start_day_of_cycle,
                            resumes_assignment_id=overlapping.id
                        )
                        db.session.add(resumption)

                db.session.commit()
                if is_ajax:
                    return jsonify({
                        "ok": True,
                        "message": "Shift pattern assigned successfully!",
                        "driverAssignments": serialize_driver_assignment_items(driver),
                    })
                flash("Shift pattern assigned successfully!", "success")
                return redirect(url_for("drivers"))
            except Exception as e:
                db.session.rollback()
                if is_ajax:
                    return jsonify({"ok": False, "error": f"Error assigning pattern: {str(e)}"}), 500
                flash(f"Error assigning pattern: {str(e)}", "error")
                return redirect(url_for("drivers"))

        return render_template("assign_pattern.html", driver=driver, patterns=patterns, today=date.today())

    @app.route("/driver/<int:driver_id>/assignment/<int:assignment_id>/end", methods=["POST"])
    def end_assignment(driver_id, assignment_id):
        """End an active driver assignment"""
        driver = db.get_or_404(Driver, driver_id)
        assignment = db.get_or_404(DriverAssignment, assignment_id)
        is_ajax = is_ajax_request()

        # Verify the assignment belongs to this driver
        if assignment.driver_id != driver_id:
            error_msg = "Invalid assignment"
            if is_ajax:
                return jsonify({"ok": False, "error": error_msg}), 400
            flash(error_msg, "error")
            return redirect(url_for("drivers"))

        today = datetime.now().date()

        # Check if assignment has already ended (end date in the past)
        if assignment.end_date and assignment.end_date < today:
            error_msg = "Assignment has already ended"
            if is_ajax:
                return jsonify({"ok": False, "error": error_msg}), 400
            flash(error_msg, "error")
            return redirect(url_for("drivers"))

        try:
            # Set end date to today (or update it to today if it was set for future)
            assignment.end_date = datetime.now().date()

            # Check if this assignment paused any others - if so, delete their auto-resumptions
            # and restore them with their original end dates
            for paused in assignment.paused_assignments:
                # Find and delete any resumption assignment for this paused assignment
                resumption = DriverAssignment.query.filter(
                    DriverAssignment.resumes_assignment_id == paused.id,
                    DriverAssignment.driver_id == driver_id
                ).first()
                if resumption:
                    db.session.delete(resumption)
                # Restore paused assignment with its original end date
                paused.end_date = paused.original_end_date
                paused.paused_by_assignment_id = None
                paused.original_end_date = None

            # Check if there was a previous assignment that was ended because of this one
            # (for cases where user manually created assignment without the auto system)
            previous_assignment = DriverAssignment.query.filter(
                DriverAssignment.driver_id == driver_id,
                DriverAssignment.end_date == assignment.start_date - timedelta(days=1),
                DriverAssignment.id != assignment_id,
                DriverAssignment.paused_by_assignment_id.is_(None)  # Not already tracked as paused
            ).order_by(DriverAssignment.start_date.desc()).first()

            # If found, restore it to ongoing (remove end date)
            if previous_assignment:
                previous_assignment.end_date = None
                message = f"Assignment ended and previous pattern '{previous_assignment.shift_pattern.name}' restored"
            else:
                message = "Assignment ended successfully"

            db.session.commit()

            if is_ajax:
                return jsonify({
                    "ok": True,
                    "message": message,
                    "driverId": driver_id,
                    "driverAssignments": serialize_driver_assignment_items(driver)
                }), 200

            flash(message + f" for {driver.formatted_name()}", "success")
        except Exception as e:
            db.session.rollback()
            error_msg = f"Error ending assignment: {str(e)}"
            if is_ajax:
                return jsonify({"ok": False, "error": error_msg}), 500
            flash(error_msg, "error")

        return redirect(url_for("drivers"))

    @app.route("/driver/<int:driver_id>/assignment/<int:assignment_id>/edit", methods=["POST"])
    def edit_assignment(driver_id, assignment_id):
        """Edit an existing driver assignment"""
        driver = db.get_or_404(Driver, driver_id)
        assignment = db.get_or_404(DriverAssignment, assignment_id)
        is_ajax = is_ajax_request()

        if assignment.driver_id != driver_id:
            if is_ajax:
                return jsonify({"ok": False, "error": "Invalid assignment"}), 400
            flash("Invalid assignment", "error")
            return redirect(url_for("drivers"))

        start_date = parse_date_string(request.form.get("start_date"))
        end_date = parse_date_string(request.form.get("end_date")) if request.form.get("end_date") else None
        pattern_id = parse_optional_int(request.form.get("pattern_id"))
        start_day_of_cycle = parse_optional_int(request.form.get("start_day_of_cycle")) or 1

        if not start_date:
            if is_ajax:
                return jsonify({"ok": False, "error": "Invalid start date"}), 400
            flash("Invalid start date", "error")
            return redirect(url_for("drivers"))
        if request.form.get("end_date") and not end_date:
            if is_ajax:
                return jsonify({"ok": False, "error": "Invalid end date"}), 400
            flash("Invalid end date", "error")
            return redirect(url_for("drivers"))
        if end_date and end_date < start_date:
            if is_ajax:
                return jsonify({"ok": False, "error": "End date cannot be before start date"}), 400
            flash("End date cannot be before start date", "error")
            return redirect(url_for("drivers"))
        if not pattern_id:
            if is_ajax:
                return jsonify({"ok": False, "error": "Invalid shift pattern"}), 400
            flash("Invalid shift pattern", "error")
            return redirect(url_for("drivers"))

        # Store old values before updating
        old_start_date = assignment.start_date
        old_end_date = assignment.end_date

        # Check for overlaps excluding this assignment and excluding resumptions it created
        overlap_exists = DriverAssignment.query.filter(
            DriverAssignment.driver_id == driver_id,
            DriverAssignment.id != assignment_id,
            DriverAssignment.resumes_assignment_id != assignment_id,  # Exclude resumptions created by this
            DriverAssignment.start_date <= (end_date if end_date else date.max),
            db.or_(
                DriverAssignment.end_date.is_(None),
                DriverAssignment.end_date >= start_date,
            ),
        ).first()

        if overlap_exists:
            if is_ajax:
                return jsonify({"ok": False, "error": "Edited assignment overlaps with another assignment"}), 400
            flash("Edited assignment overlaps with another assignment", "error")
            return redirect(url_for("drivers"))

        try:
            # Update the assignment
            assignment.shift_pattern_id = pattern_id
            assignment.start_date = start_date
            assignment.end_date = end_date
            assignment.start_day_of_cycle = start_day_of_cycle
            db.session.flush()

            # If dates or end_date changed, recalculate pause/resume relationships
            if old_start_date != start_date or old_end_date != end_date:
                # Update paused assignments' end dates if start date changed
                if old_start_date != start_date:
                    for paused in assignment.paused_assignments:
                        paused.end_date = start_date - timedelta(days=1)

                # Handle resumption assignments based on end_date changes
                if old_end_date != end_date:
                    # Find existing resumptions created by this assignment
                    existing_resumptions = DriverAssignment.query.filter(
                        DriverAssignment.driver_id == driver_id,
                        DriverAssignment.resumes_assignment_id.in_(
                            [p.id for p in assignment.paused_assignments]
                        )
                    ).all()

                    if end_date:
                        # Assignment now/still has end date - update or create resumptions
                        for paused in assignment.paused_assignments:
                            resumption = next((r for r in existing_resumptions if r.resumes_assignment_id == paused.id), None)
                            if resumption:
                                # Update existing resumption start date
                                resumption.start_date = end_date + timedelta(days=1)
                            else:
                                # Create new resumption if one doesn't exist
                                new_resumption = DriverAssignment(
                                    driver_id=driver_id,
                                    shift_pattern_id=paused.shift_pattern_id,
                                    start_date=end_date + timedelta(days=1),
                                    end_date=None,
                                    start_day_of_cycle=paused.start_day_of_cycle,
                                    resumes_assignment_id=paused.id
                                )
                                db.session.add(new_resumption)
                    else:
                        # Assignment is now ongoing (no end_date) - delete resumptions
                        for resumption in existing_resumptions:
                            db.session.delete(resumption)

            db.session.commit()
            if is_ajax:
                return jsonify({
                    "ok": True,
                    "message": f"Assignment updated successfully for {driver.formatted_name()}",
                    "driverAssignments": serialize_driver_assignment_items(driver),
                })
            flash(f"Assignment updated successfully for {driver.formatted_name()}", "success")
        except Exception as e:
            db.session.rollback()
            if is_ajax:
                return jsonify({"ok": False, "error": f"Error updating assignment: {str(e)}"}), 500
            flash(f"Error updating assignment: {str(e)}", "error")

        return redirect(url_for("drivers"))

    @app.route("/driver/<int:driver_id>/assignment/<int:assignment_id>/delete", methods=["POST"])
    def delete_assignment(driver_id, assignment_id):
        """Delete a driver assignment completely"""
        driver = db.get_or_404(Driver, driver_id)
        assignment = db.get_or_404(DriverAssignment, assignment_id)
        is_ajax = is_ajax_request()

        # Verify the assignment belongs to this driver
        if assignment.driver_id != driver_id:
            error_msg = "Invalid assignment"
            if is_ajax:
                return jsonify({"ok": False, "error": error_msg}), 400
            flash(error_msg, "error")
            return redirect(url_for("drivers"))

        try:
            pattern_name = assignment.shift_pattern.name

            # If this assignment paused others, restore them
            for paused in assignment.paused_assignments:
                # Find and delete any resumption assignment for this paused assignment
                resumption = DriverAssignment.query.filter(
                    DriverAssignment.resumes_assignment_id == paused.id,
                    DriverAssignment.driver_id == driver_id
                ).first()
                if resumption:
                    db.session.delete(resumption)
                # Restore paused assignment with its original end date
                paused.end_date = paused.original_end_date
                paused.original_end_date = None
                paused.paused_by_assignment_id = None

            # Check if this assignment auto-ended a previous one and restore it
            # (for cases where user manually created assignment without the auto system)
            previous_assignment = DriverAssignment.query.filter(
                DriverAssignment.driver_id == driver_id,
                DriverAssignment.end_date == assignment.start_date - timedelta(days=1),
                DriverAssignment.id != assignment_id,
                DriverAssignment.paused_by_assignment_id.is_(None)  # Not already tracked as paused
            ).order_by(DriverAssignment.start_date.desc()).first()

            # Delete the assignment
            db.session.delete(assignment)

            # Restore previous assignment if it was auto-ended
            if previous_assignment:
                previous_assignment.end_date = None
                message = f"Assignment '{pattern_name}' deleted and previous pattern '{previous_assignment.shift_pattern.name}' restored"
            else:
                message = f"Assignment '{pattern_name}' deleted successfully"

            db.session.commit()

            if is_ajax:
                return jsonify({
                    "ok": True,
                    "message": message,
                    "driverId": driver_id,
                    "driverAssignments": serialize_driver_assignment_items(driver)
                }), 200

            flash(message + f" for {driver.formatted_name()}", "success")
        except Exception as e:
            db.session.rollback()
            error_msg = f"Error deleting assignment: {str(e)}"
            if is_ajax:
                return jsonify({"ok": False, "error": error_msg}), 500
            flash(error_msg, "error")

        return redirect(url_for("drivers"))
