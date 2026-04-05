from flask import render_template, request, redirect, url_for, flash, send_file, after_this_request
from datetime import datetime, timedelta
from pathlib import Path
import os
import shutil
import tempfile

from extensions import db
from models import Driver, ShiftTiming
from backup_utils import (
    AUTO_BACKUP_RETENTION_DAYS,
    AUTO_BACKUP_HOUR,
    create_temp_backup_copy,
    get_auto_backup_dir,
    get_sqlite_database_path,
    list_auto_backups,
    looks_like_sqlite_db,
    next_auto_backup_time,
    resolve_auto_backup_path,
)
from utils import (
    get_drivers_for_date, get_drivers_count_by_shift, get_operational_date,
    get_cars_working_at_time, parse_date_string, parse_time_string,
)


def register(app):
    def _replace_database_from_file(db_path, source_file_path):
        """Replace current database with source_file_path after validating a safe temp copy."""
        db_path.parent.mkdir(parents=True, exist_ok=True)

        temp_file = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.db', dir=str(db_path.parent)) as tmp:
                shutil.copy2(source_file_path, tmp.name)
                temp_file = Path(tmp.name)

            if not looks_like_sqlite_db(temp_file):
                return False, 'Uploaded file is not a valid Shift Sheets database backup.'

            db.session.remove()
            db.engine.dispose()

            os.replace(temp_file, db_path)
            temp_file = None
            return True, 'Backup restored successfully.'
        except Exception as exc:
            return False, f'Backup restore failed: {exc}'
        finally:
            if temp_file is not None and temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass

    def _parse_target_date(value):
        try:
            return datetime.strptime(value, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            flash("Invalid date format", "error")
            return None

    def _build_daily_sheet_context(target_date):
        drivers_by_shift = get_drivers_for_date(target_date)
        all_timings = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
        timings = {timing.shift_type: timing for timing in all_timings}
        total_drivers = len({
            info['driver'].id
            for drivers_list in drivers_by_shift.values()
            for info in drivers_list
        })
        return {
            "target_date": target_date,
            "drivers_by_shift": drivers_by_shift,
            "timings": timings,
            "total_drivers": total_drivers,
        }

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

        target_date = _parse_target_date(target_date_str)
        if not target_date:
            return redirect(url_for("daily_sheet_form"))

        context = _build_daily_sheet_context(target_date)
        return render_template("daily_sheet.html", **context)

    @app.route("/daily-sheet/print")
    def print_daily_sheet():
        """Print-friendly daily shift sheet"""
        target_date_str = request.args.get("date")

        target_date = _parse_target_date(target_date_str)
        if not target_date:
            return redirect(url_for("daily_sheet_form"))

        context = _build_daily_sheet_context(target_date)
        return render_template("print_daily_sheet.html", **context)

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
                flash(f"Error calculating cars working: {e}", "error")

        return render_template("cars_working.html", timings=all_timings_dict)

    @app.route('/settings')
    def settings():
        """Settings page for maintenance actions such as backup/restore."""
        db_path = get_sqlite_database_path(app.config)
        db_path_exists = bool(db_path and db_path.exists())
        auto_backups = list_auto_backups(db_path)
        last_auto_backup = auto_backups[0] if auto_backups else None
        return render_template(
            'settings.html',
            database_path=str(db_path) if db_path else None,
            database_path_exists=db_path_exists,
            auto_backup_dir=str(get_auto_backup_dir(db_path)) if db_path else None,
            auto_backups=auto_backups,
            last_auto_backup=last_auto_backup,
            auto_backup_retention_days=AUTO_BACKUP_RETENTION_DAYS,
            auto_backup_hour=AUTO_BACKUP_HOUR,
            next_auto_backup_at=next_auto_backup_time() if db_path else None,
        )

    @app.route('/settings/backup/download-now', methods=['GET'])
    def download_backup_now():
        """Create a fresh backup copy and download it without saving into project data."""
        db_path = get_sqlite_database_path(app.config)
        if db_path is None:
            flash('Backup download is only supported for SQLite deployments.', 'error')
            return redirect(url_for('settings'))

        if not db_path.exists():
            flash('Database file not found. Backup could not be created.', 'error')
            return redirect(url_for('settings'))

        temp_backup_path = create_temp_backup_copy(db_path)

        @after_this_request
        def cleanup_temp_backup(response):
            try:
                temp_backup_path.unlink(missing_ok=True)
            except Exception:
                pass
            return response

        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        download_name = f'shift-sheets-backup-{timestamp}.db'
        return send_file(
            temp_backup_path,
            as_attachment=True,
            download_name=download_name,
            mimetype='application/octet-stream',
        )

    @app.route('/settings/backup/auto/download', methods=['GET'])
    def download_auto_backup():
        """Download one of the stored automatic backups."""
        db_path = get_sqlite_database_path(app.config)
        backup_name = (request.args.get('backup_name') or '').strip()
        backup_path = resolve_auto_backup_path(db_path, backup_name)
        if backup_path is None:
            flash('Selected automatic backup was not found.', 'error')
            return redirect(url_for('settings'))

        return send_file(
            backup_path,
            as_attachment=True,
            download_name=backup_path.name,
            mimetype='application/octet-stream',
        )

    @app.route('/settings/backup/auto/restore', methods=['POST'])
    def restore_auto_backup():
        """Restore the current database from a selected automatic backup file."""
        db_path = get_sqlite_database_path(app.config)
        backup_name = (request.form.get('backup_name') or '').strip()
        backup_path = resolve_auto_backup_path(db_path, backup_name)
        if backup_path is None:
            flash('Selected automatic backup was not found.', 'error')
            return redirect(url_for('settings'))

        success, message = _replace_database_from_file(db_path, backup_path)
        flash(message, 'success' if success else 'error')
        return redirect(url_for('settings'))

    @app.route('/settings/backup/restore', methods=['POST'])
    def restore_backup():
        """Restore database from uploaded SQLite backup file."""
        db_path = get_sqlite_database_path(app.config)
        if db_path is None:
            flash('Backup restore is only supported for SQLite deployments.', 'error')
            return redirect(url_for('settings'))

        uploaded = request.files.get('backup_file')
        if uploaded is None or not uploaded.filename:
            flash('Please choose a backup file to restore.', 'error')
            return redirect(url_for('settings'))

        filename = uploaded.filename.lower()
        if not (filename.endswith('.db') or filename.endswith('.sqlite') or filename.endswith('.sqlite3')):
            flash('Invalid file type. Please upload a .db or .sqlite backup file.', 'error')
            return redirect(url_for('settings'))

        temp_file = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.db', dir=str(db_path.parent)) as tmp:
                uploaded.save(tmp.name)
                temp_file = Path(tmp.name)

            if not looks_like_sqlite_db(temp_file):
                flash('Uploaded file is not a valid Shift Sheets database backup.', 'error')
                return redirect(url_for('settings'))

            success, message = _replace_database_from_file(db_path, temp_file)
            flash(message, 'success' if success else 'error')
        finally:
            if temp_file is not None and temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass

        return redirect(url_for('settings'))

    @app.route('/settings/database/clear', methods=['POST'])
    def clear_database():
        """Danger action: wipe all application records after explicit confirmation."""
        confirmation_word = (request.form.get('confirm_word') or '').strip().upper()
        if confirmation_word != 'DELETE':
            flash('Database clear cancelled. Type DELETE to confirm.', 'error')
            return redirect(url_for('settings'))

        try:
            db.session.remove()
            for table in reversed(db.metadata.sorted_tables):
                db.session.execute(table.delete())
            db.session.commit()
            flash('Database cleared successfully.', 'success')
        except Exception as exc:
            db.session.rollback()
            flash(f'Failed to clear database: {exc}', 'error')

        return redirect(url_for('settings'))

