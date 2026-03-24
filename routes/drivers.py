from flask import render_template, request, redirect, url_for, flash, jsonify
from datetime import datetime

from extensions import db
from models import Driver, ShiftPattern, ShiftTiming
from utils import (
    serialize_driver_assignment_items, get_custom_timing_affected_pattern_ids,
    is_ajax_request, json_success, json_error,
)


def register(app):
    def _serialize_driver_summary_stats():
        all_drivers = Driver.query.all()
        return {
            "total": len(all_drivers),
            "school_badge": sum(1 for driver in all_drivers if driver.school_badge),
            "pet_friendly": sum(1 for driver in all_drivers if driver.pet_friendly),
            "assistance_guide_dogs_exempt": sum(1 for driver in all_drivers if driver.assistance_guide_dogs_exempt),
            "electric_vehicle": sum(1 for driver in all_drivers if driver.electric_vehicle),
            "with_patterns": sum(1 for driver in all_drivers if driver.get_current_assignment()),
        }

    def _serialize_driver_refresh_payload(driver):
        today = datetime.now().date()
        current_assignment = driver.get_current_assignment()
        future_assignments = [a for a in driver.assignments if a.start_date > today]

        return {
            "driver": {
                "id": driver.id,
                "driver_number": driver.driver_number,
                "formatted_driver_number": driver.formatted_driver_number(),
                "formatted_name": driver.formatted_name(),
                "name": driver.name,
                "car_type": driver.car_type,
                "school_badge": driver.school_badge,
                "pet_friendly": driver.pet_friendly,
                "assistance_guide_dogs_exempt": driver.assistance_guide_dogs_exempt,
                "electric_vehicle": driver.electric_vehicle,
                "created_at": driver.created_at.strftime('%d/%m/%Y'),
            },
            "current_assignment": {
                "pattern_id": current_assignment.shift_pattern_id if current_assignment else None,
                "pattern_name": current_assignment.shift_pattern.name if current_assignment else None,
                "start_date": current_assignment.start_date.strftime('%Y-%m-%d') if current_assignment else None,
                "end_date": current_assignment.end_date.strftime('%Y-%m-%d') if current_assignment and current_assignment.end_date else None,
                "has_end_date": current_assignment.end_date is not None if current_assignment else False,
            } if current_assignment else None,
            "future_assignments": [
                {
                    "pattern_id": a.shift_pattern_id,
                    "pattern_name": a.shift_pattern.name,
                    "start_date": a.start_date.strftime('%Y-%m-%d'),
                }
                for a in future_assignments
            ],
            "assignments": serialize_driver_assignment_items(driver),
            "custom_timing_pattern_ids": sorted(get_custom_timing_affected_pattern_ids(driver)),
            "summary_stats": _serialize_driver_summary_stats(),
        }

    @app.route("/drivers")
    def drivers():
        """Manage drivers"""
        def driver_sort_key(driver):
            try:
                return (0, int(driver.driver_number), driver.driver_number)
            except (ValueError, TypeError):
                return (1, 0, driver.driver_number)

        all_drivers = sorted(Driver.query.all(), key=driver_sort_key)
        all_patterns = ShiftPattern.query.all()
        all_shift_types = ShiftTiming.query.all()
        shift_timings = {
            st.shift_type: {
                "label": st.display_label,
                "badgeColor": st.badge_color or "bg-primary",
                "startTime": st.start_time.strftime("%H:%M") if st.start_time else None,
                "endTime": st.end_time.strftime("%H:%M") if st.end_time else None,
            }
            for st in all_shift_types
        }

        driver_assignments = {}
        custom_timing_pattern_ids = {}
        for driver in all_drivers:
            driver_assignments[driver.id] = serialize_driver_assignment_items(driver)
            custom_timing_pattern_ids[driver.id] = sorted(get_custom_timing_affected_pattern_ids(driver))

        return render_template(
            "drivers.html",
            drivers=all_drivers,
            patterns=all_patterns,
            shift_types=all_shift_types,
            shift_timings=shift_timings,
            datetime=datetime,
            driver_assignments=driver_assignments,
            custom_timing_pattern_ids=custom_timing_pattern_ids,
        )

    @app.route("/driver/add", methods=["GET", "POST"])
    def add_driver():
        """Add new driver"""
        if request.method == "GET":
            return redirect(url_for("drivers"))

        driver = Driver(
            driver_number=request.form.get("driver_number"),
            name=request.form.get("name"),
            car_type=request.form.get("car_type"),
            school_badge=bool(request.form.get("school_badge")),
            pet_friendly=bool(request.form.get("pet_friendly")),
            assistance_guide_dogs_exempt=bool(request.form.get("assistance_guide_dogs_exempt")),
            electric_vehicle=bool(request.form.get("electric_vehicle"))
        )

        try:
            db.session.add(driver)
            db.session.commit()
            if is_ajax_request():
                return json_success(driverId=driver.id, **_serialize_driver_refresh_payload(driver))
            flash("Driver added successfully!", "success")
            return redirect(url_for("drivers"))
        except Exception as e:
            db.session.rollback()
            error_msg = f"Error adding driver: {e}"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
            return redirect(url_for("drivers"))

    @app.route("/driver/<int:driver_id>/edit", methods=["GET", "POST"])
    def edit_driver(driver_id):
        """Edit existing driver"""
        driver = db.get_or_404(Driver, driver_id)

        if request.method == "GET":
            return redirect(url_for("drivers"))

        driver.driver_number = request.form.get("driver_number")
        driver.name = request.form.get("name")
        driver.car_type = request.form.get("car_type")
        driver.school_badge = bool(request.form.get("school_badge"))
        driver.pet_friendly = bool(request.form.get("pet_friendly"))
        driver.assistance_guide_dogs_exempt = bool(request.form.get("assistance_guide_dogs_exempt"))
        driver.electric_vehicle = bool(request.form.get("electric_vehicle"))

        try:
            db.session.commit()
            if is_ajax_request():
                return json_success(driverId=driver.id, summary_stats=_serialize_driver_summary_stats())
            flash("Driver updated successfully!", "success")
            return redirect(url_for("drivers"))
        except Exception as e:
            db.session.rollback()
            error_msg = f"Error updating driver: {e}"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
            return redirect(url_for("drivers"))

    @app.route("/driver/<int:driver_id>/delete", methods=["POST"])
    def delete_driver(driver_id):
        """Delete driver"""
        driver = db.get_or_404(Driver, driver_id)

        try:
            db.session.delete(driver)
            db.session.commit()
            if is_ajax_request():
                return json_success(driverId=driver_id, summary_stats=_serialize_driver_summary_stats())
            flash("Driver deleted successfully!", "success")
        except Exception as e:
            db.session.rollback()
            error_msg = f"Error deleting driver: {e}"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")

        return redirect(url_for("drivers"))

    @app.route("/driver/<int:driver_id>/data", methods=["GET"])
    def get_driver_data(driver_id):
        """Get current driver data for background refresh"""
        driver = db.get_or_404(Driver, driver_id)
        return jsonify({"ok": True, **_serialize_driver_refresh_payload(driver)})
