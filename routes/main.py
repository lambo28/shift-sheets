from flask import render_template, request, redirect, url_for, flash, jsonify
from datetime import datetime, timedelta

from extensions import db
from models import Driver, ShiftTiming
from utils import (
    get_drivers_for_date, get_drivers_count_by_shift, get_operational_date,
    get_cars_working_at_time, parse_date_string, parse_time_string,
    get_app_setting, set_app_setting,
)


def register(app):
    @app.route("/")
    def index():
        """Main dashboard"""
        drivers = Driver.query.all()

        # Get operational dates
        today = get_operational_date()
        tomorrow = today + timedelta(days=1)

        # Get driver counts for today and tomorrow
        today_drivers = get_drivers_for_date(today)
        tomorrow_drivers = get_drivers_for_date(tomorrow)

        today_total = len({info['driver'].id for drivers_list in today_drivers.values() for info in drivers_list})
        tomorrow_total = len({info['driver'].id for drivers_list in tomorrow_drivers.values() for info in drivers_list})

        # Get shift distribution for today
        today_shift_counts = get_drivers_count_by_shift(today)

        # Get all user-defined shift types for the dashboard
        all_shift_types = ShiftTiming.query.filter(
            ShiftTiming.parent_shift_type.is_(None)
        ).order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()

        return render_template("index.html",
                             drivers=drivers,
                             today=today,
                             tomorrow=tomorrow,
                             today_total=today_total,
                             tomorrow_total=tomorrow_total,
                             today_shift_counts=today_shift_counts,
                             all_shift_types=all_shift_types)

    @app.route("/daily-sheet")
    def daily_sheet_form():
        """Show form to generate daily shift sheet"""
        return render_template("daily_sheet_form.html")

    @app.route("/daily-sheet/generate", methods=["POST"])
    def generate_daily_sheet():
        """Generate daily shift sheet for a specific date"""
        target_date_str = request.form.get("target_date")

        try:
            target_date = datetime.strptime(target_date_str, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            flash("Invalid date format", "error")
            return redirect(url_for("daily_sheet_form"))

        drivers_by_shift = get_drivers_for_date(target_date)
        all_timings = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
        timings = {timing.shift_type: timing for timing in all_timings}
        total_drivers = len({info['driver'].id for drivers_list in drivers_by_shift.values() for info in drivers_list})

        return render_template("daily_sheet.html",
                             target_date=target_date,
                             drivers_by_shift=drivers_by_shift,
                             timings=timings,
                             total_drivers=total_drivers)

    @app.route("/daily-sheet/print")
    def print_daily_sheet():
        """Print-friendly daily shift sheet"""
        target_date_str = request.args.get("date")

        try:
            target_date = datetime.strptime(target_date_str, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            flash("Invalid date format", "error")
            return redirect(url_for("daily_sheet_form"))

        drivers_by_shift = get_drivers_for_date(target_date)
        all_timings = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
        timings = {timing.shift_type: timing for timing in all_timings}
        total_drivers = len({info['driver'].id for drivers_list in drivers_by_shift.values() for info in drivers_list})

        return render_template("print_daily_sheet.html",
                             target_date=target_date,
                             drivers_by_shift=drivers_by_shift,
                             timings=timings,
                             total_drivers=total_drivers)

    @app.route("/cars-working", methods=["GET", "POST"])
    def cars_working():
        """Page to check how many cars are working at a specific time"""
        all_timings_dict = {t.shift_type: t for t in ShiftTiming.query.all()}
        if request.method == "POST":
            try:
                date_str = request.form.get("date")
                time_str = request.form.get("time")

                target_date = parse_date_string(date_str)
                target_time = parse_time_string(time_str)

                if not target_date or not target_time:
                    flash("Invalid date or time", "error")
                    return render_template("cars_working.html", timings=all_timings_dict)

                car_count = get_cars_working_at_time(target_date, target_time)

                return render_template("cars_working.html",
                                     date=target_date,
                                     time=target_time,
                                     car_count=car_count,
                                     timings=all_timings_dict)
            except Exception as e:
                flash(f"Error calculating cars working: {str(e)}", "error")

        return render_template("cars_working.html", timings=all_timings_dict)

    @app.route("/theme/toggle", methods=["POST"])
    def toggle_theme():
        """Toggle UI theme between light and dark from the top navigation."""
        ui_theme = get_app_setting('ui_theme', 'light')
        if ui_theme not in ('light', 'dark'):
            ui_theme = 'light'
        next_theme = 'dark' if ui_theme == 'light' else 'light'

        set_app_setting('ui_theme', next_theme)
        db.session.commit()
        flash(f"Theme switched to {next_theme} mode.", "success")

        next_url = (request.form.get('next') or '').strip()
        if next_url and next_url.startswith('/'):
            return redirect(next_url)
        return redirect(url_for('index'))
