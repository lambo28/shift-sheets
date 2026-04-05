# app.py – Application factory and wiring

from flask import Flask
from sqlalchemy import text
from datetime import datetime
import os
import threading
import time

from backup_utils import AUTO_BACKUP_HOUR, create_auto_backup, get_auto_backup_path, get_sqlite_database_path

from config import config
from extensions import db

# Re-export constants for backward compat (tests import from app)
from constants import MIN_REST_HOURS, MAX_WORK_HOURS_PER_24H, EXTRA_CAR_MIN_PARTIAL_HOURS  # noqa: F401

# Re-export models for backward compat (tests import from app)
from models import (  # noqa: F401
    Driver, ShiftPattern, ShiftTiming, DriverCustomTiming, DriverAssignment,
    DriverHoliday, ShiftAdjustment, ShiftSwap, SchoolTerm, SchoolClosureDate,
    ExtraCarRequest, ExtraCarAssignment, AppSetting,
    normalize_day_shifts, compact_day_shifts, iter_pattern_shift_types,
    resolve_request_relative_datetime, utc_now,
)

# Re-export utilities for backward compat (tests import from app)
from utils import (  # noqa: F401
    get_bundle_manifest, bundle_url,
    is_ajax_request, json_success, json_error,
    calculate_hours, get_operational_date,
    get_drivers_count_by_shift, is_driver_on_holiday,
    get_drivers_for_date, get_driver_shifts_for_date,
    driver_has_working_shift_on_date, get_driver_adjustment_time_window,
    get_adjustment_conflict_bounds, is_split_shift_day, validate_adjustment_time,
    get_week_dates, parse_date_string, parse_time_string,
    parse_optional_int, parse_positive_int,
    parse_day_shifts_from_form, get_active_assignments_for_date,
    get_driver_all_work_intervals, merge_work_intervals,
    interval_within_any_segment,
    get_app_setting, get_app_setting_float, set_app_setting,
    is_date_in_school_term, is_school_closed_day, is_school_term_operational_day,
    school_term_finished_at, school_term_delete_allowed_at,
    school_closure_finished_at, school_closure_delete_allowed_at,
    validate_extra_car_assignment,
    get_custom_timing_affected_pattern_ids, serialize_driver_assignment_items,
    redirect_to_driver_custom_timings_panel,
    get_cars_working_at_time,
    validate_swap, _get_shift_datetime,
    group_consecutive_holidays, shift_abbrev,
)

# -----------------------------------------------------------------------------
# App Setup
# -----------------------------------------------------------------------------

app = Flask(__name__)

_auto_backup_scheduler_started = False

config_name = os.environ.get('FLASK_CONFIG') or 'default'
app.config.from_object(config[config_name])

os.makedirs(app.config.get('BASE_DIR') / 'data', exist_ok=True)

db.init_app(app)


def _ensure_columns(table_name, existing_columns, column_definitions):
    for column_name, column_sql in column_definitions:
        if column_name not in existing_columns:
            db.session.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_sql}"))


def _run_startup_migrations():
    shift_timing_columns = {
        row[1]
        for row in db.session.execute(text("PRAGMA table_info(shift_timing)")).fetchall()
    }
    _ensure_columns(
        "shift_timing",
        shift_timing_columns,
        (
            ("display_name", "display_name VARCHAR(100)"),
            ("badge_color", "badge_color VARCHAR(50) DEFAULT 'bg-primary'"),
            ("icon", "icon VARCHAR(100) DEFAULT 'fas fa-clock'"),
            ("parent_shift_type", "parent_shift_type VARCHAR(50)"),
            ("school_term_only", "school_term_only BOOLEAN DEFAULT 0"),
        ),
    )

    shift_swap_columns = {
        row[1]
        for row in db.session.execute(text("PRAGMA table_info(shift_swap)")).fetchall()
    }
    _ensure_columns(
        "shift_swap",
        shift_swap_columns,
        (("work_shift_type", "work_shift_type VARCHAR(50)"),),
    )

    db.session.execute(
        text(
            """
            DELETE FROM shift_swap
            WHERE driver_a_id != driver_b_id OR work_shift_type IS NULL OR TRIM(work_shift_type) = ''
            """
        )
    )
    db.session.execute(
        text(
            """
            UPDATE shift_timing
            SET display_name = REPLACE(shift_type, '_', ' ')
            WHERE display_name IS NULL OR TRIM(display_name) = ''
            """
        )
    )
    db.session.commit()

# -----------------------------------------------------------------------------
# Template Filters
# -----------------------------------------------------------------------------

@app.template_filter('ordinal_date')
def ordinal_date(date_obj, format_str='%A, %B %d, %Y'):
    """Format date with ordinal suffix (1st, 2nd, 3rd, etc.)"""
    day = date_obj.day
    suffix = 'th' if 10 <= day <= 19 else {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th')
    if '%d' in format_str:
        format_str = format_str.replace('%d', str(day) + suffix)
    return date_obj.strftime(format_str)


@app.template_filter('shift_label')
def shift_label(shift_type):
    if not shift_type:
        return ''
    parts = str(shift_type).replace('_', ' ').split()
    return ' '.join(p.upper() if p.lower() in {'am', 'pm'} else p.capitalize() for p in parts)


@app.template_filter('group_consecutive_holidays')
def _group_consecutive_holidays_filter(holidays_list):
    return group_consecutive_holidays(holidays_list)


@app.template_filter('shift_abbrev')
def _shift_abbrev_filter(shift_type, all_shifts_str=''):
    return shift_abbrev(shift_type, all_shifts_str)


@app.context_processor
def utility_processor():
    return dict(datetime=datetime, bundle_url=bundle_url)


def _run_auto_backup_if_due():
    db_path = get_sqlite_database_path(app.config)
    if db_path is None or not db_path.exists():
        return

    now = datetime.now()
    scheduled_today = now.replace(hour=AUTO_BACKUP_HOUR, minute=0, second=0, microsecond=0)
    if now < scheduled_today:
        return

    backup_path = get_auto_backup_path(db_path, now)
    if backup_path.exists():
        return

    create_auto_backup(db_path, backup_dt=now)


def _auto_backup_scheduler_loop():
    while True:
        try:
            with app.app_context():
                _run_auto_backup_if_due()
        except Exception as exc:
            print(f"[auto-backup] Nightly backup check failed: {exc}")
        time.sleep(60)


def _start_auto_backup_scheduler():
    global _auto_backup_scheduler_started

    if _auto_backup_scheduler_started:
        return

    if app.config.get('DEBUG') and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    _auto_backup_scheduler_started = True
    threading.Thread(target=_auto_backup_scheduler_loop, name='auto-backup-scheduler', daemon=True).start()

# -----------------------------------------------------------------------------
# Route Registration
# -----------------------------------------------------------------------------

from routes import main, drivers, assignments, shifts, custom_timings, scheduling, extra_cars  # noqa: E402

main.register(app)
drivers.register(app)
assignments.register(app)
shifts.register(app)
custom_timings.register(app)
scheduling.register(app)
extra_cars.register(app)

# -----------------------------------------------------------------------------
# Database Initialization
# -----------------------------------------------------------------------------

with app.app_context():
    db.create_all()
    _run_startup_migrations()

_start_auto_backup_scheduler()

# -----------------------------------------------------------------------------
# Entry Point
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(
        host=app.config.get('HOST', '0.0.0.0'),
        port=app.config.get('PORT', 5000),
        debug=app.config.get('DEBUG', False),
    )
