# app.py

from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from datetime import datetime, timedelta, date
import os
import json
from config import config

# Minimum rest hours required between consecutive shifts (used in swap validation)
MIN_REST_HOURS = 8

# -----------------------------------------------------------------------------
# App Setup
# -----------------------------------------------------------------------------

app = Flask(__name__)

# Load configuration
config_name = os.environ.get('FLASK_CONFIG') or 'default'
app.config.from_object(config[config_name])

# Ensure data directory exists
os.makedirs(app.config.get('BASE_DIR') / 'data', exist_ok=True)

db = SQLAlchemy(app)

# -----------------------------------------------------------------------------
# Database Models
# -----------------------------------------------------------------------------

class Driver(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_number = db.Column(db.String(50), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    car_type = db.Column(db.String(100), nullable=False)  # Standard, Estate, XL Estate, Minibus
    school_badge = db.Column(db.Boolean, default=False)
    pet_friendly = db.Column(db.Boolean, default=False)
    assistance_guide_dogs_exempt = db.Column(db.Boolean, default=False)
    electric_vehicle = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    assignments = db.relationship('DriverAssignment', backref='driver', lazy=True, cascade='all, delete-orphan')
    
    # Helper method to format name in "A. Someone" style
    def formatted_name(self):
        parts = self.name.strip().split()
        if len(parts) >= 2:
            first_initial = parts[0][0].upper() + '.'
            last_name = ' '.join(parts[1:]).title()
            return f"{first_initial} {last_name}"
        return self.name.title()
    
    # Helper method to format driver number (remove leading zeros)
    def formatted_driver_number(self):
        try:
            return str(int(self.driver_number))
        except (ValueError, TypeError):
            return self.driver_number
    
    # Get current active assignment
    def get_current_assignment(self, target_date=None):
        """Get the driver's current shift pattern assignment"""
        if not target_date:
            target_date = datetime.now().date()
            
        assignment = DriverAssignment.query.filter(
            DriverAssignment.driver_id == self.id,
            DriverAssignment.start_date <= target_date,
            db.or_(
                DriverAssignment.end_date.is_(None),
                DriverAssignment.end_date >= target_date
            )
        ).first()
        
        return assignment

class ShiftPattern(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    description = db.Column(db.Text)
    cycle_length = db.Column(db.Integer, nullable=False)  # number of days in cycle
    pattern_data = db.Column(db.Text, nullable=False)  # JSON string of daily shift assignments
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    assignments = db.relationship('DriverAssignment', backref='shift_pattern', lazy=True, cascade='all, delete-orphan')
    
    # Helper method to get pattern as list
    def get_pattern_data(self):
        try:
            return json.loads(self.pattern_data)
        except (json.JSONDecodeError, TypeError):
            return []
    
    # Helper method to set pattern data
    def set_pattern_data(self, pattern_list):
        self.pattern_data = json.dumps(pattern_list)
    
    # Get count of unique drivers assigned to this pattern
    def get_unique_driver_count(self):
        unique_driver_ids = set()
        for assignment in self.assignments:
            unique_driver_ids.add(assignment.driver_id)
        return len(unique_driver_ids)

    # Get unique assigned drivers sorted by numeric driver number
    def get_unique_assigned_drivers_sorted(self):
        today = datetime.now().date()
        unique_drivers = {}
        for assignment in self.assignments:
            is_active_or_scheduled = assignment.end_date is None or assignment.end_date >= today
            if assignment.driver and is_active_or_scheduled:
                unique_drivers[assignment.driver.id] = assignment.driver

        def sort_key(driver):
            try:
                numeric_driver_number = int(driver.driver_number)
                return (0, numeric_driver_number, driver.driver_number)
            except Exception:
                return (1, 0, driver.driver_number)

        return sorted(unique_drivers.values(), key=sort_key)

    # Get what shift type for a specific day in the cycle
    def get_shift_for_day(self, cycle_day):
        shifts = self.get_shifts_for_day(cycle_day)
        if shifts:
            return shifts[0]
        return None

    def get_shifts_for_day(self, cycle_day):
        pattern = self.get_pattern_data()
        if 0 <= cycle_day < len(pattern):
            return normalize_day_shifts(pattern[cycle_day])
        return []

# Add Shift Timing Configuration Model
class ShiftTiming(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    shift_type = db.Column(db.String(50), unique=True, nullable=False)  # user-defined name, up to 50 chars
    display_name = db.Column(db.String(100), nullable=True)  # user-facing name (can keep spaces/case)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    badge_color = db.Column(db.String(50), default='bg-primary')  # Bootstrap badge color class
    icon = db.Column(db.String(100), default='fas fa-clock')  # Font Awesome icon class
    parent_shift_type = db.Column(db.String(50), nullable=True)  # If set, this is a sub-shift grouped under parent

    @property
    def display_label(self):
        if self.display_name and self.display_name.strip():
            return self.display_name.strip()
        parts = self.shift_type.replace('_', ' ').split()
        return ' '.join(p.upper() if p.lower() in {'am', 'pm'} else p.capitalize() for p in parts)

    def get_parent_display_label(self):
        """Get the display label of the parent shift type if it exists."""
        if not self.parent_shift_type:
            return ''
        parent = ShiftTiming.query.filter_by(shift_type=self.parent_shift_type).first()
        return parent.display_label if parent else self.parent_shift_type

    def get_patterns_using_shift(self):
        """Get list of patterns that use this shift type."""
        patterns = []
        all_patterns = ShiftPattern.query.all()
        for pattern in all_patterns:
            pattern_data = pattern.get_pattern_data()
            for day_entry in pattern_data:
                # Handle both single shift and list of shifts
                day_shifts = day_entry if isinstance(day_entry, list) else [day_entry]
                if self.shift_type in day_shifts:
                    patterns.append(pattern)
                    break  # Found in this pattern, no need to check further days
        return patterns


# Driver Custom Timing Configuration Model
class DriverCustomTiming(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    assignment_id = db.Column(db.Integer, db.ForeignKey('driver_assignment.id'), nullable=True)  # NULL = applies to all assignments
    
    # Override criteria (NULL means "any")
    shift_type = db.Column(db.String(50), nullable=True)  # shift type name or NULL for any
    day_of_cycle = db.Column(db.Integer, nullable=True)   # 0-based day in cycle, NULL for any
    day_of_week = db.Column(db.Integer, nullable=True)    # 0=Monday, 6=Sunday, NULL for any
    override_shift = db.Column(db.String(50), nullable=True)  # shift type to work instead on day_of_week
    
    # Times (NULL means "use the default shift time for this field")
    start_time = db.Column(db.Time, nullable=True)
    end_time = db.Column(db.Time, nullable=True)
    
    # Priority (lower number = higher priority)
    priority = db.Column(db.Integer, default=4)
    
    # Metadata
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    driver = db.relationship('Driver', backref='custom_timings')
    assignment = db.relationship('DriverAssignment', backref='custom_timings')
    
    @staticmethod
    def get_custom_timing(driver_id, assignment_id, shift_type, cycle_day, weekday):
        """Get the highest priority custom timing for given criteria"""
        # Build query conditions
        query = DriverCustomTiming.query.filter(DriverCustomTiming.driver_id == driver_id)
        
        # Find all matching timings with priority order
        candidates = []
        
        # Check assignment-specific first (highest priority)
        if assignment_id:
            assignment_specific = query.filter(
                DriverCustomTiming.assignment_id == assignment_id
            ).order_by(DriverCustomTiming.priority).all()
            candidates.extend(assignment_specific)
        
        # Then driver-wide rules
        driver_wide = query.filter(
            DriverCustomTiming.assignment_id.is_(None)
        ).order_by(DriverCustomTiming.priority).all()
        candidates.extend(driver_wide)
        
        # Collect all matches, then choose deterministically by:
        # assignment-specific > driver-wide, lower priority number, higher specificity
        matching_candidates = []
        for timing in candidates:
            # Check if this timing matches all criteria
            if timing.shift_type is not None and timing.shift_type != shift_type:
                continue
            if timing.day_of_cycle is not None and timing.day_of_cycle != cycle_day:
                continue
            if timing.day_of_week is not None and timing.day_of_week != weekday:
                continue

            specificity_score = 0
            if timing.shift_type is not None:
                specificity_score += 1
            if timing.day_of_cycle is not None:
                specificity_score += 1
            if timing.day_of_week is not None:
                specificity_score += 1

            matching_candidates.append((timing, specificity_score))

        if not matching_candidates:
            return None

        matching_candidates.sort(
            key=lambda item: (
                item[0].assignment_id is None,
                item[0].priority,
                -item[1],
                item[0].id
            )
        )
        return matching_candidates[0][0]

class DriverAssignment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    shift_pattern_id = db.Column(db.Integer, db.ForeignKey('shift_pattern.id'), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date)  # Optional - for temporary assignments
    start_day_of_cycle = db.Column(db.Integer, default=1, nullable=False)  # Which day of the pattern cycle to start on
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Track pause/resume relationships for temporary assignments
    paused_by_assignment_id = db.Column(db.Integer, db.ForeignKey('driver_assignment.id'), nullable=True)  # Which assignment caused this to pause
    resumes_assignment_id = db.Column(db.Integer, db.ForeignKey('driver_assignment.id'), nullable=True)  # Which assignment this resumes
    original_end_date = db.Column(db.Date, nullable=True)  # Store original end_date before being paused (so we can restore it)
    
    # Relationships for pause/resume tracking
    paused_by = db.relationship('DriverAssignment', remote_side=[id], foreign_keys=[paused_by_assignment_id], backref='paused_assignments')
    resumes = db.relationship('DriverAssignment', remote_side=[id], foreign_keys=[resumes_assignment_id], backref='resumed_by_assignments')
    
    # Get shift type for a specific date
    def get_shift_for_date(self, target_date):
        """Get the shift type for a specific date based on the pattern cycle"""
        shifts = self.get_shifts_for_date(target_date)
        if shifts:
            return shifts[0]
        return None

    def get_shifts_for_date(self, target_date):
        """Get all shift types for a specific date based on the pattern cycle"""
        if target_date < self.start_date:
            return []
        if self.end_date and target_date > self.end_date:
            return []
            
        # Calculate which day of the cycle this date falls on
        days_since_start = (target_date - self.start_date).days
        # Account for starting on a specific day of the cycle
        cycle_day = (days_since_start + (self.start_day_of_cycle - 1)) % self.shift_pattern.cycle_length
        
        return self.shift_pattern.get_shifts_for_day(cycle_day)

# -----------------------------------------------------------------------------
# Scheduling Models (Holidays, One-off Adjustments, Shift Swaps)
# -----------------------------------------------------------------------------

class DriverHoliday(db.Model):
    """Records holiday dates for a driver."""
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    holiday_date = db.Column(db.Date, nullable=False)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    driver = db.relationship('Driver', backref=db.backref('holidays', lazy=True, cascade='all, delete-orphan'))

    __table_args__ = (
        db.UniqueConstraint('driver_id', 'holiday_date', name='uq_driver_holiday_date'),
    )


class ShiftAdjustment(db.Model):
    """One-off late start or early finish for a scheduled shift date."""
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    adjustment_date = db.Column(db.Date, nullable=False)
    adjustment_type = db.Column(db.String(20), nullable=False)  # 'late_start' or 'early_finish'
    adjusted_time = db.Column(db.Time, nullable=False)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    driver = db.relationship('Driver', backref=db.backref('shift_adjustments', lazy=True, cascade='all, delete-orphan'))


class ShiftSwap(db.Model):
    """Records a swap between two driver assignments on specific dates."""
    id = db.Column(db.Integer, primary_key=True)
    driver_a_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    driver_b_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    date_a = db.Column(db.Date, nullable=False)  # Date driver_a is giving up their shift
    date_b = db.Column(db.Date, nullable=False)  # Date driver_b is giving up their shift
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    driver_a = db.relationship('Driver', foreign_keys=[driver_a_id], backref=db.backref('swaps_as_a', lazy=True, cascade='all, delete-orphan'))
    driver_b = db.relationship('Driver', foreign_keys=[driver_b_id], backref=db.backref('swaps_as_b', lazy=True, cascade='all, delete-orphan'))

# -----------------------------------------------------------------------------
# Initialization
# -----------------------------------------------------------------------------

with app.app_context():
    db.create_all()

    existing_columns = {
        row[1]
        for row in db.session.execute(text("PRAGMA table_info(shift_timing)")).fetchall()
    }

    if 'display_name' not in existing_columns:
        db.session.execute(text("ALTER TABLE shift_timing ADD COLUMN display_name VARCHAR(100)"))

    if 'badge_color' not in existing_columns:
        db.session.execute(text("ALTER TABLE shift_timing ADD COLUMN badge_color VARCHAR(50) DEFAULT 'bg-primary'"))

    if 'icon' not in existing_columns:
        db.session.execute(text("ALTER TABLE shift_timing ADD COLUMN icon VARCHAR(100) DEFAULT 'fas fa-clock'"))

    if 'parent_shift_type' not in existing_columns:
        db.session.execute(text("ALTER TABLE shift_timing ADD COLUMN parent_shift_type VARCHAR(50)"))

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
# Template Helpers and Response Utilities
# -----------------------------------------------------------------------------

# Custom Jinja2 filter for ordinal dates
@app.template_filter('ordinal_date')
def ordinal_date(date_obj, format_str='%A, %B %d, %Y'):
    """Format date with ordinal suffix (1st, 2nd, 3rd, etc.)"""
    day = date_obj.day
    if 10 <= day <= 19:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th')
    
    # Replace %d with day + suffix in the format string
    if '%d' in format_str:
        format_str = format_str.replace('%d', str(day) + suffix)
    
    return date_obj.strftime(format_str)


@app.template_filter('shift_label')
def shift_label(shift_type):
    if not shift_type:
        return ''
    parts = str(shift_type).replace('_', ' ').split()
    return ' '.join(p.upper() if p.lower() in {'am', 'pm'} else p.capitalize() for p in parts)


@app.template_filter('shift_abbrev')
def shift_abbrev(shift_type, all_shifts_str=''):
    """
    Generate intelligent abbreviation for a shift.
    - If unique (no conflicts), use 1 letter
    - If multi-word, use first letter of each word
    Receives shift_type and pipe-separated list of all shifts in the pattern
    """
    if not shift_type or shift_type == 'day_off':
        return 'OFF'
    
    all_shifts = [s.strip() for s in all_shifts_str.split('|') if s.strip() and s.strip() != 'day_off']
    
    # Multi-word: first letter of each word
    words = str(shift_type).replace('_', ' ').split()
    if len(words) > 1:
        return ''.join(w[0].upper() for w in words)
    
    # Single word: check if initial is unique
    initial = shift_type[0].upper()
    conflicts = [s for s in all_shifts if s[0].upper() == initial and s != shift_type]
    
    if not conflicts:
        return initial
    
    # Has conflicts: use full first char
    return initial

# Add datetime to template context
@app.context_processor
def utility_processor():
    return dict(datetime=datetime)

def is_ajax_request():
    return request.headers.get("X-Requested-With") == "XMLHttpRequest"

def json_success(**payload):
    response = {"success": True}
    response.update(payload)
    return jsonify(response)

def json_error(message, status_code=400):
    return jsonify({"success": False, "error": message}), status_code

# -----------------------------------------------------------------------------
# Scheduling Helper Functions
# -----------------------------------------------------------------------------

def calculate_hours(start_time, end_time, break_minutes=0):
    """Calculate hours worked from time strings"""
    try:
        start = datetime.strptime(start_time, '%H:%M')
        end = datetime.strptime(end_time, '%H:%M')
        
        # Handle overnight shifts
        if end < start:
            end = end + timedelta(days=1)
            
        total_minutes = (end - start).total_seconds() / 60
        total_minutes -= break_minutes
        return max(0, total_minutes / 60)  # Convert to hours
    except (ValueError, TypeError):
        return 0.0

def get_operational_date():
    """Get current operational date considering 6am crossover"""
    now = datetime.now()
    if now.hour < 6:
        # Before 6am, still previous operational day
        return (now - timedelta(days=1)).date()
    else:
        # 6am or later, current operational day
        return now.date()

def get_drivers_count_by_shift(target_date):
    """Get count of drivers by shift type for a specific date"""
    drivers_by_shift = get_drivers_for_date(target_date)
    return {shift_type: len(drivers_list) for shift_type, drivers_list in drivers_by_shift.items()}

def get_drivers_for_date(target_date):
    """Get all drivers working on a specific date with their shift assignments and timing info"""
    # Get all user-defined shift types
    all_timings = ShiftTiming.query.all()
    timings_dict = {t.shift_type: t for t in all_timings}

    # Build an empty list for every shift type (both parent and sub-shifts)
    # This ensures all shift types are present in the result dictionary
    drivers_working = {}
    for t in all_timings:
        drivers_working[t.shift_type] = []
    
    # Get all active driver assignments for the target date
    assignments = get_active_assignments_for_date(target_date)
    
    for assignment in assignments:
        shift_types = assignment.get_shifts_for_date(target_date)
        if not shift_types:
            continue

        # Calculate cycle day and weekday for custom timing lookup
        days_since_start = (target_date - assignment.start_date).days
        cycle_day = days_since_start % assignment.shift_pattern.cycle_length
        weekday = target_date.weekday()  # 0=Monday, 6=Sunday
        
        for shift_type in shift_types:
            if shift_type == 'day_off' or shift_type not in timings_dict:
                continue

            # Check for custom timing
            custom_timing = DriverCustomTiming.get_custom_timing(
                assignment.driver_id,
                assignment.id,
                shift_type,
                cycle_day,
                weekday
            )

            effective_shift_type = shift_type
            if custom_timing and custom_timing.override_shift and custom_timing.override_shift in timings_dict:
                effective_shift_type = custom_timing.override_shift

            # Get start and end times
            if custom_timing:
                default_timing = timings_dict.get(effective_shift_type)
                if custom_timing.start_time is not None:
                    start_time = custom_timing.start_time
                elif default_timing:
                    start_time = default_timing.start_time
                else:
                    start_time = None
                if custom_timing.end_time is not None:
                    end_time = custom_timing.end_time
                elif default_timing:
                    end_time = default_timing.end_time
                else:
                    end_time = None
                timing_note = custom_timing.notes or ("Shift override" if custom_timing.override_shift else "Custom timing")
                is_custom = True
            else:
                timing = timings_dict[shift_type]
                start_time = timing.start_time
                end_time = timing.end_time
                timing_note = None
                is_custom = False

            # Create driver info object with timing data
            driver_info = {
                'driver': assignment.driver,
                'start_time': start_time,
                'end_time': end_time,
                'is_custom': is_custom,
                'timing_note': timing_note,
                'shift_type': effective_shift_type
            }

            # Determine where to group this driver
            current_timing = timings_dict.get(effective_shift_type)
            if current_timing and current_timing.parent_shift_type:
                # This is a sub-shift, group under parent
                parent = current_timing.parent_shift_type
                if parent not in drivers_working:
                    drivers_working[parent] = []
                drivers_working[parent].append(driver_info)
            else:
                # This is a main shift or has no parent
                if effective_shift_type not in drivers_working:
                    drivers_working[effective_shift_type] = []
                drivers_working[effective_shift_type].append(driver_info)
    
    return drivers_working


def get_driver_shifts_for_date(driver, target_date, timings_dict=None):
    if timings_dict is None:
        all_timings = ShiftTiming.query.all()
        timings_dict = {timing.shift_type: timing for timing in all_timings}

    assignments = DriverAssignment.query.filter(
        DriverAssignment.driver_id == driver.id,
        DriverAssignment.start_date <= target_date,
        db.or_(
            DriverAssignment.end_date.is_(None),
            DriverAssignment.end_date >= target_date
        )
    ).all()

    entries = []
    for assignment in assignments:
        shift_types = assignment.get_shifts_for_date(target_date) or []
        if not shift_types:
            continue

        days_since_start = (target_date - assignment.start_date).days
        cycle_day = days_since_start % assignment.shift_pattern.cycle_length
        weekday = target_date.weekday()

        for base_shift_type in shift_types:
            custom_timing = DriverCustomTiming.get_custom_timing(
                assignment.driver_id,
                assignment.id,
                base_shift_type,
                cycle_day,
                weekday
            )

            effective_shift_type = base_shift_type
            if custom_timing and custom_timing.override_shift and custom_timing.override_shift in timings_dict:
                effective_shift_type = custom_timing.override_shift

            default_timing = timings_dict.get(effective_shift_type) or timings_dict.get(base_shift_type)

            if custom_timing and custom_timing.start_time is not None:
                start_time = custom_timing.start_time
            elif default_timing:
                start_time = default_timing.start_time
            else:
                start_time = None

            if custom_timing and custom_timing.end_time is not None:
                end_time = custom_timing.end_time
            elif default_timing:
                end_time = default_timing.end_time
            else:
                end_time = None

            timing_meta = timings_dict.get(effective_shift_type)
            if effective_shift_type == 'day_off':
                label = 'OFF'
                badge_color = 'bg-secondary'
            elif timing_meta:
                label = timing_meta.display_label
                badge_color = timing_meta.badge_color or 'bg-primary'
            else:
                label = shift_label(effective_shift_type)
                badge_color = 'bg-primary'

            entries.append({
                'shift_type': effective_shift_type,
                'label': label,
                'badge_color': badge_color,
                'start_time': start_time,
                'end_time': end_time,
                'is_override': bool(custom_timing and custom_timing.override_shift),
                'is_custom_time': bool(custom_timing and (custom_timing.start_time is not None or custom_timing.end_time is not None)),
            })

    entries.sort(key=lambda item: (item['start_time'] is None, item['start_time'] or datetime.min.time(), item['label']))
    return entries

def get_week_dates(date_str):
    """Get Monday and Sunday for the week containing the given date"""
    try:
        date = datetime.strptime(date_str, '%Y-%m-%d').date()
        monday = date - timedelta(days=date.weekday())
        sunday = monday + timedelta(days=6)
        return monday, sunday
    except (ValueError, TypeError):
        return None, None

def parse_date_string(date_str):
    """Parse YYYY-MM-DD string into date object, or None if invalid."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None

def parse_time_string(time_str):
    """Parse HH:MM string into time object, or None if invalid."""
    if not time_str:
        return None
    try:
        return datetime.strptime(time_str, '%H:%M').time()
    except (ValueError, TypeError):
        return None

def parse_optional_int(value):
    """Parse an optional int-like value, returning None for blank and invalid values."""
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

def parse_positive_int(value):
    """Parse positive integer, returning None if invalid."""
    parsed = parse_optional_int(value)
    if parsed is None or parsed <= 0:
        return None
    return parsed

def normalize_day_shifts(day_entry):
    """Normalize a pattern day value into a deduplicated list of shift types."""
    if day_entry is None:
        return ['day_off']

    if isinstance(day_entry, str):
        values = [day_entry]
    elif isinstance(day_entry, list):
        values = day_entry
    else:
        return ['day_off']

    cleaned = []
    seen = set()
    for value in values:
        shift = str(value).strip()
        if not shift or shift == 'day_off':
            continue
        if shift not in seen:
            cleaned.append(shift)
            seen.add(shift)

    return cleaned or ['day_off']

def compact_day_shifts(day_entry):
    """Return day_off, a single shift string, or a list for multi-shift days."""
    normalized = normalize_day_shifts(day_entry)
    if normalized == ['day_off']:
        return 'day_off'
    if len(normalized) == 1:
        return normalized[0]
    return normalized

def parse_day_shifts_from_form(form_data, day_index):
    """Parse one day's shift selection(s) from submitted form data."""
    day_key = f"day_{day_index}_shift"
    values = [v for v in form_data.getlist(day_key) if str(v).strip()]
    if not values:
        return 'day_off'

    normalized_values = [str(v).strip() for v in values]
    if 'day_off' in normalized_values:
        non_day_off = [v for v in normalized_values if v != 'day_off']
        if non_day_off:
            raise ValueError('Day Off cannot be combined with working shifts')
        return 'day_off'

    return compact_day_shifts(normalized_values)

def iter_pattern_shift_types(pattern_data):
    """Yield all working shift types used by a pattern, including multi-shift days."""
    for day_entry in pattern_data:
        for shift_type in normalize_day_shifts(day_entry):
            if shift_type != 'day_off':
                yield shift_type

def get_active_assignments_for_date(target_date):
    """Get assignments active for a given date."""
    return DriverAssignment.query.filter(
        DriverAssignment.start_date <= target_date,
        db.or_(
            DriverAssignment.end_date.is_(None),
            DriverAssignment.end_date >= target_date
        )
    ).all()

# -----------------------------------------------------------------------------
# Routes: Dashboard and Navigation
# -----------------------------------------------------------------------------

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
    
    today_total = sum(len(drivers_list) for drivers_list in today_drivers.values())
    tomorrow_total = sum(len(drivers_list) for drivers_list in tomorrow_drivers.values())
    
    # Get shift distribution for today
    today_shift_counts = get_drivers_count_by_shift(today)
    
    # Get all user-defined shift types for the dashboard
    all_shift_types = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
    
    return render_template("index.html", 
                         drivers=drivers,
                         today=today,
                         tomorrow=tomorrow,
                         today_total=today_total,
                         tomorrow_total=tomorrow_total,
                         today_shift_counts=today_shift_counts,
                         all_shift_types=all_shift_types)

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


def get_custom_timing_affected_pattern_ids(driver):
    pattern_ids = {
        assignment.shift_pattern_id
        for assignment in driver.assignments
        if assignment.shift_pattern_id is not None
    }

    if not pattern_ids:
        return set()

    timings = list(driver.custom_timings or [])
    if not timings:
        return set()

    affected = set()

    # Any-assignment custom timing affects all patterns assigned to this driver
    if any(timing.assignment_id is None for timing in timings):
        affected.update(pattern_ids)

    assignment_by_id = {assignment.id: assignment for assignment in driver.assignments}
    for timing in timings:
        if timing.assignment_id is None:
            continue
        assignment = assignment_by_id.get(timing.assignment_id)
        if assignment and assignment.shift_pattern_id is not None:
            affected.add(assignment.shift_pattern_id)

    return affected


def serialize_driver_assignment_items(driver):
    today = datetime.now().date()
    items = []
    for assignment in driver.assignments:
        if assignment.start_date > today:
            status = "scheduled"
        elif not assignment.end_date or assignment.end_date >= today:
            status = "active"
        else:
            status = "ended"

        items.append({
            "id": assignment.id,
            "patternId": assignment.shift_pattern_id,
            "patternName": assignment.shift_pattern.name,
            "cycleLength": assignment.shift_pattern.cycle_length,
            "patternData": assignment.shift_pattern.get_pattern_data(),
            "startDate": assignment.start_date.strftime("%Y-%m-%d"),
            "endDate": assignment.end_date.strftime("%Y-%m-%d") if assignment.end_date else None,
            "startDayOfCycle": assignment.start_day_of_cycle,
            "createdAt": assignment.created_at.strftime("%d/%m/%Y"),
            "status": status,
            "hasEndDate": assignment.end_date is not None,
        })
    return items

@app.route("/shifts")
def shifts():
    """List all shift patterns and shift type management"""
    all_patterns = ShiftPattern.query.order_by(ShiftPattern.name).all()
    all_timings = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
    timings = {timing.shift_type: timing for timing in all_timings}
    return render_template("shifts.html", patterns=all_patterns, timings=timings, all_timings=all_timings)

# -----------------------------------------------------------------------------
# Routes: Shift Types and Patterns
# -----------------------------------------------------------------------------

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
            else:
                timing = ShiftTiming(
                    shift_type=new_shift_type,
                    display_name=display_name,
                    start_time=start_time,
                    end_time=end_time,
                    badge_color=badge_color,
                    icon=icon,
                    parent_shift_type=parent_shift_type
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
                           badge_color=badge_color, icon=icon, parent_shift_type=parent_shift_type)
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
        'parent_shift_type': timing.parent_shift_type
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
        
        db.session.commit()
        return json_success()
    except (ValueError, TypeError) as e:
        db.session.rollback()
        return json_error(str(e))

@app.route("/shift-pattern/add", methods=["GET", "POST"])
def add_shift_pattern():
    """Add new shift pattern"""
    if request.method == "POST":
        # Block pattern creation if no shift types are defined
        if not ShiftTiming.query.first():
            message = 'No shift types defined. Please add shift types before creating patterns.'
            if is_ajax_request():
                return json_error(message)
            flash(message, "error")
            return redirect(url_for("shifts"))

        cycle_length = parse_positive_int(request.form.get("cycle_length", 7))
        if not cycle_length:
            message = 'Cycle length must be a positive number.'
            if is_ajax_request():
                return json_error(message)
            flash(message, "error")
            return redirect(url_for("shifts"))

        pattern_name = (request.form.get("name") or "").strip()
        if not pattern_name:
            message = 'Pattern name is required.'
            if is_ajax_request():
                return json_error(message)
            flash(message, "error")
            return redirect(url_for("shifts"))

        pattern_data = []
        
        for day in range(cycle_length):
            try:
                day_shifts = parse_day_shifts_from_form(request.form, day)
            except ValueError as exc:
                message = str(exc)
                if is_ajax_request():
                    return json_error(message)
                flash(message, "error")
                return redirect(url_for("shifts"))
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

            flash(f"Error adding shift pattern: {str(e)}", "error")
    
    return render_template("shifts.html")

@app.route("/shift-pattern/<int:pattern_id>/edit-data")
def get_shift_pattern_edit_data(pattern_id):
    """Get shift pattern data for editing"""
    pattern = ShiftPattern.query.get_or_404(pattern_id)
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
    pattern = ShiftPattern.query.get_or_404(pattern_id)
    
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
    pattern = ShiftPattern.query.get_or_404(pattern_id)
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
        if is_ajax_request():
            return json_error(message)
        flash(message, "error")
        return redirect(url_for("shifts"))

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

        flash(f"Error deleting shift pattern: {str(e)}", "error")
    
    return redirect(url_for("shifts"))

    # -----------------------------------------------------------------------------
    # Routes: Driver Assignments
    # -----------------------------------------------------------------------------

@app.route("/driver/<int:driver_id>/assign-pattern", methods=["GET", "POST"])
def assign_pattern_to_driver(driver_id):
    """Assign a shift pattern to a driver"""
    driver = Driver.query.get_or_404(driver_id)
    patterns = ShiftPattern.query.all()
    
    if request.method == "POST":
        is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
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
    driver = Driver.query.get_or_404(driver_id)
    assignment = DriverAssignment.query.get_or_404(assignment_id)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
    
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
    driver = Driver.query.get_or_404(driver_id)
    assignment = DriverAssignment.query.get_or_404(assignment_id)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"

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
    old_pattern_id = assignment.shift_pattern_id

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
    driver = Driver.query.get_or_404(driver_id)
    assignment = DriverAssignment.query.get_or_404(assignment_id)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
    
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

@app.route("/driver/<int:driver_id>/data", methods=["GET"])
def get_driver_data(driver_id):
    """Get current driver data for background refresh"""
    driver = Driver.query.get_or_404(driver_id)
    today = datetime.now().date()
    
    current_assignment = driver.get_current_assignment()
    future_assignments = [a for a in driver.assignments if a.start_date > today]
    
    return jsonify({
        "ok": True,
        "driver": {
            "id": driver.id,
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
    })

# -----------------------------------------------------------------------------
# Routes: Driver Management
# -----------------------------------------------------------------------------

@app.route("/driver/add", methods=["GET", "POST"])
def add_driver():
    """Add new driver"""
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
    
    if request.method == "GET":
        return redirect(url_for("drivers"))

    if request.method == "POST":
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
            message = "Driver added successfully!"
            if is_ajax:
                return jsonify({"ok": True, "message": message}), 200
            flash(message, "success")
            return redirect(url_for("drivers"))
        except Exception as e:
            db.session.rollback()
            error_msg = f"Error adding driver: {str(e)}"
            if is_ajax:
                return jsonify({"ok": False, "error": error_msg}), 500
            flash(error_msg, "error")

    return redirect(url_for("drivers"))

@app.route("/driver/<int:driver_id>/edit", methods=["GET", "POST"])
def edit_driver(driver_id):
    """Edit existing driver"""
    driver = Driver.query.get_or_404(driver_id)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"

    if request.method == "GET":
        return redirect(url_for("drivers"))
    
    if request.method == "POST":
        driver.driver_number = request.form.get("driver_number")
        driver.name = request.form.get("name")
        driver.car_type = request.form.get("car_type")
        driver.school_badge = bool(request.form.get("school_badge"))
        driver.pet_friendly = bool(request.form.get("pet_friendly"))
        driver.assistance_guide_dogs_exempt = bool(request.form.get("assistance_guide_dogs_exempt"))
        driver.electric_vehicle = bool(request.form.get("electric_vehicle"))
        
        try:
            db.session.commit()
            message = "Driver updated successfully!"
            if is_ajax:
                return jsonify({"ok": True, "message": message}), 200
            flash(message, "success")
            return redirect(url_for("drivers"))
        except Exception as e:
            db.session.rollback()
            error_msg = f"Error updating driver: {str(e)}"
            if is_ajax:
                return jsonify({"ok": False, "error": error_msg}), 500
            flash(error_msg, "error")

    return redirect(url_for("drivers"))

@app.route("/driver/<int:driver_id>/delete", methods=["POST"])
def delete_driver(driver_id):
    """Delete driver"""
    driver = Driver.query.get_or_404(driver_id)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
    
    try:
        db.session.delete(driver)
        db.session.commit()
        message = "Driver deleted successfully!"
        if is_ajax:
            return jsonify({"ok": True, "message": message}), 200
        flash(message, "success")
    except Exception as e:
        db.session.rollback()
        error_msg = f"Error deleting driver: {str(e)}"
        if is_ajax:
            return jsonify({"ok": False, "error": error_msg}), 500
        flash(error_msg, "error")
    
    return redirect(url_for("drivers"))

# -----------------------------------------------------------------------------
# Routes: Daily Sheets
# -----------------------------------------------------------------------------

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
    
    return render_template("daily_sheet.html", 
                         target_date=target_date, 
                         drivers_by_shift=drivers_by_shift,
                         timings=timings)

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
    
    return render_template("print_daily_sheet.html", 
                         target_date=target_date, 
                         drivers_by_shift=drivers_by_shift,
                         timings=timings)

# -----------------------------------------------------------------------------
# Cars Working Helpers and Routes
# -----------------------------------------------------------------------------

def get_cars_working_at_time(target_date, target_time):
    """Get count of cars working at a specific date and time"""
    # Get all active assignments for the target date
    assignments = get_active_assignments_for_date(target_date)
    
    # Get all user-defined shift timings
    timings_dict = {t.shift_type: t for t in ShiftTiming.query.all()}
    
    cars_working = 0
    for assignment in assignments:
        # Get all shift types for this date
        shift_types = assignment.get_shifts_for_date(target_date)

        if not shift_types:
            continue

        # Calculate cycle day and weekday for custom timing lookup
        days_since_start = (target_date - assignment.start_date).days
        cycle_day = days_since_start % assignment.shift_pattern.cycle_length
        weekday = target_date.weekday()  # 0=Monday, 6=Sunday
        
        is_working_now = False
        for shift_type in shift_types:
            if shift_type == 'day_off' or shift_type not in timings_dict:
                continue

            # Check for custom timing first
            custom_timing = DriverCustomTiming.get_custom_timing(
                assignment.driver_id,
                assignment.id,
                shift_type,
                cycle_day,
                weekday
            )

            effective_shift_type = shift_type
            if custom_timing and custom_timing.override_shift and custom_timing.override_shift in timings_dict:
                effective_shift_type = custom_timing.override_shift

            if custom_timing:
                # Use custom timing, falling back to default for any null fields
                default_timing = timings_dict.get(effective_shift_type)
                if custom_timing.start_time is not None:
                    start_time = custom_timing.start_time
                elif default_timing:
                    start_time = default_timing.start_time
                else:
                    start_time = None
                if custom_timing.end_time is not None:
                    end_time = custom_timing.end_time
                elif default_timing:
                    end_time = default_timing.end_time
                else:
                    end_time = None
            else:
                # Use default timing
                timing = timings_dict[shift_type]
                start_time = timing.start_time
                end_time = timing.end_time

            # Handle overnight shifts (when end time is before start time)
            if start_time is None or end_time is None:
                continue  # Skip if timing could not be resolved
            if end_time < start_time:  # Night shift case
                # Check if target time is after start OR before end (next day)
                if target_time >= start_time or target_time < end_time:
                    is_working_now = True
                    break
            else:  # Regular day shift
                # Check if target time is between start and end
                if start_time <= target_time < end_time:
                    is_working_now = True
                    break

        if is_working_now:
            cars_working += 1
    
    return cars_working

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

    # -----------------------------------------------------------------------------
    # Routes: Driver Custom Timings
    # -----------------------------------------------------------------------------

@app.route("/driver/<int:driver_id>/custom-timings")
def driver_custom_timings(driver_id):
    """Manage custom timings for a specific driver"""
    driver = Driver.query.get_or_404(driver_id)
    timings = DriverCustomTiming.query.filter_by(driver_id=driver_id).order_by(DriverCustomTiming.priority).all()
    assignments = DriverAssignment.query.filter_by(driver_id=driver_id).all()
    shift_types = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
    return render_template("driver_custom_timings.html", driver=driver, timings=timings,
                           assignments=assignments, shift_types=shift_types)

@app.route("/driver/<int:driver_id>/custom-timings/add", methods=["GET", "POST"])
def add_custom_timing(driver_id):
    """Add a new custom timing for a driver"""
    driver = Driver.query.get_or_404(driver_id)
    
    if request.method == "POST":
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
                return redirect(url_for("drivers"))

            if end_time_str and not end_time:
                flash("Invalid end time format", "error")
                return redirect(url_for("drivers"))

            if priority is None:
                flash("Invalid priority", "error")
                return redirect(url_for("drivers"))

            if day_of_week is not None and (day_of_week < 0 or day_of_week > 6):
                flash("Day of week must be between 0 and 6", "error")
                return redirect(url_for("drivers"))

            if day_of_cycle is not None and day_of_cycle < 0:
                flash("Day of cycle must be 0 or greater", "error")
                return redirect(url_for("drivers"))
            
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
            if request.args.get("modal") == "1":
                return redirect(url_for("driver_custom_timings", driver_id=driver_id, modal="1"))
            return redirect(url_for("driver_custom_timings", driver_id=driver_id))

        except Exception as e:
            db.session.rollback()
            flash(f"Error adding custom timing: {str(e)}", "error")
            if request.args.get("modal") == "1":
                return redirect(url_for("driver_custom_timings", driver_id=driver_id, modal="1"))
            return redirect(url_for("driver_custom_timings", driver_id=driver_id))
    
    # Get driver assignments for dropdown
    assignments = DriverAssignment.query.filter_by(driver_id=driver_id).all()
    shift_types = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
    return render_template("add_custom_timing.html", driver=driver, assignments=assignments, shift_types=shift_types)

@app.route("/custom-timing/<int:timing_id>/delete", methods=["POST"])
def delete_custom_timing(timing_id):
    """Delete a custom timing"""
    timing = DriverCustomTiming.query.get_or_404(timing_id)
    driver_id = timing.driver_id
    modal = request.form.get("modal") == "1"
    
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
            return json_error(f"Error deleting timing: {str(e)}")
        
        flash(f"Error deleting timing: {str(e)}", "error")
    
    if modal:
        return redirect(url_for("driver_custom_timings", driver_id=driver_id, modal="1"))
    return redirect(url_for("driver_custom_timings", driver_id=driver_id))

@app.route("/custom-timing/<int:timing_id>/edit", methods=["POST"])
def edit_custom_timing(timing_id):
    """Edit an existing custom timing"""
    timing = DriverCustomTiming.query.get_or_404(timing_id)
    driver_id = timing.driver_id
    modal = request.args.get("modal") == "1"

    try:
        assignment_id = parse_optional_int(request.form.get("assignment_id"))
        shift_type = request.form.get("shift_type") or None
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

        # Validate times: logic depends on day_of_week and shift_type
        if start_time_str and not start_time:
            error_msg = "Invalid start time format"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif end_time_str and not end_time:
            error_msg = "Invalid end time format"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif day_of_week is not None and override_shift and (start_time or end_time):
            error_msg = "Choose either Override Shift or Custom Times for a day-of-week rule, not both"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif (day_of_week is None or not override_shift) and not start_time and not end_time:
            if day_of_week is not None and not override_shift:
                error_msg = "When selecting a day of week with custom times, you must enter at least one time"
            else:
                error_msg = "You must enter either a start time, end time, or both"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif priority is None:
            error_msg = "Priority must be a number between 1 and 7"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif priority < 1 or priority > 7:
            error_msg = "Priority must be between 1 and 7"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif day_of_week is not None and (day_of_week < 0 or day_of_week > 6):
            error_msg = "Day of week must be between 0 and 6"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif day_of_cycle is not None and day_of_cycle < 0:
            error_msg = "Day of cycle must be 0 or greater"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif assignment_id is not None and not assignment:
            error_msg = "Invalid assignment selected"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif assignment is not None and day_of_week is None and day_of_cycle is not None and shift_type:
            error_msg = "When an assignment is selected, choose either Cycle Day or Shift Type, not both."
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
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
        error_msg = f"Error updating custom timing: {str(e)}"
        if is_ajax_request():
            return json_error(error_msg)
        flash(error_msg, "error")

    if modal:
        return redirect(url_for("driver_custom_timings", driver_id=driver_id, modal="1"))
    return redirect(url_for("driver_custom_timings", driver_id=driver_id))

@app.route("/driver/<int:driver_id>/custom-timings/list")
def get_driver_custom_timings_list(driver_id):
    """Get list of custom timings for a driver (AJAX)"""
    driver = Driver.query.get_or_404(driver_id)
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
    driver = Driver.query.get_or_404(driver_id)

    month_param = request.args.get("month", "").strip()
    if month_param:
        try:
            month_start = datetime.strptime(month_param, "%Y-%m").date().replace(day=1)
        except ValueError:
            return json_error("Invalid month format. Use YYYY-MM")
    else:
        today = datetime.now().date()
        month_start = today.replace(day=1)

    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_days = (next_month - month_start).days

    all_timings = ShiftTiming.query.all()
    timings_dict = {timing.shift_type: timing for timing in all_timings}

    today = datetime.now().date()
    days = []
    for day_offset in range(month_days):
        current_date = month_start + timedelta(days=day_offset)
        day_entries = get_driver_shifts_for_date(driver, current_date, timings_dict)

        days.append({
            "date": current_date.strftime("%Y-%m-%d"),
            "day": current_date.day,
            "is_today": current_date == today,
            "shifts": [
                {
                    "shift_type": entry["shift_type"],
                    "label": entry["label"],
                    "badge_color": entry["badge_color"],
                    "start_time": entry["start_time"].strftime("%H:%M") if entry["start_time"] else None,
                    "end_time": entry["end_time"].strftime("%H:%M") if entry["end_time"] else None,
                    "is_override": entry["is_override"],
                    "is_custom_time": entry["is_custom_time"],
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

@app.route("/custom-timing/<int:timing_id>/get")
def get_custom_timing(timing_id):
    """Get a specific custom timing (AJAX)"""
    timing = DriverCustomTiming.query.get_or_404(timing_id)
    
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
    driver = Driver.query.get_or_404(driver_id)
    
    try:
        assignment_id = parse_optional_int(request.form.get("assignment_id"))
        shift_type = request.form.get("shift_type") or None
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
        
        if start_time_str and not start_time:
            return json_error("Invalid start time format")
        if end_time_str and not end_time:
            return json_error("Invalid end time format")
        if day_of_week is not None and override_shift and (start_time or end_time):
            return json_error("Choose either Override Shift or Custom Times for a day-of-week rule, not both")
        # Time requirement logic:
        # - If day_of_week + override_shift set: times optional (override mode)
        # - Otherwise: at least one time required
        if day_of_week is None or not override_shift:
            if not start_time and not end_time:
                if day_of_week is not None and not override_shift:
                    return json_error("When selecting a day of week with custom times, you must enter at least one time")
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

# -----------------------------------------------------------------------------
# Scheduling Helpers
# -----------------------------------------------------------------------------

def _get_shift_datetime(driver, target_date, timings_dict=None):
    """Return (start_datetime, end_datetime) for a driver on a date, or (None, None)."""
    if timings_dict is None:
        timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

    shifts = get_driver_shifts_for_date(driver, target_date, timings_dict)
    # shifts is a list of dicts with 'start_time', 'end_time'
    if not shifts:
        return None, None

    earliest_start = None
    latest_end = None
    for s in shifts:
        st = s.get('start_time')
        et = s.get('end_time')
        if st and et:
            start_dt = datetime.combine(target_date, st)
            end_dt = datetime.combine(target_date, et)
            if et < st:
                end_dt += timedelta(days=1)
            if earliest_start is None or start_dt < earliest_start:
                earliest_start = start_dt
            if latest_end is None or end_dt > latest_end:
                latest_end = end_dt

    return earliest_start, latest_end


def validate_swap(driver_a, driver_b, date_a, date_b):
    """
    Validate a swap between driver_a on date_a and driver_b on date_b.
    Returns a list of error strings (empty list means valid).
    """
    errors = []
    timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

    # Shifts each driver is giving up
    a_start, a_end = _get_shift_datetime(driver_a, date_a, timings_dict)
    b_start, b_end = _get_shift_datetime(driver_b, date_b, timings_dict)

    # If either driver has no shift on the given date, cannot swap
    if not a_start:
        errors.append(f"{driver_a.formatted_name()} has no shift on {date_a.strftime('%d/%m/%Y')}.")
    if not b_start:
        errors.append(f"{driver_b.formatted_name()} has no shift on {date_b.strftime('%d/%m/%Y')}.")

    if errors:
        return errors

    # After swap:
    # driver_a will work date_b's shift; driver_b will work date_a's shift.
    # Check rest rules and overlaps for driver_a (picking up date_b shift)
    def _get_adjacent_shifts(driver, swap_date, swap_start, swap_end):
        inner_errors = []
        # Check previous day
        prev_date = swap_date - timedelta(days=1)
        prev_start, prev_end = _get_shift_datetime(driver, prev_date, timings_dict)
        if prev_end and swap_start:
            rest = (swap_start - prev_end).total_seconds() / 3600
            if rest < MIN_REST_HOURS:
                inner_errors.append(
                    f"{driver.formatted_name()} would have only {rest:.1f}h rest before the swapped shift "
                    f"on {swap_date.strftime('%d/%m/%Y')} (minimum {MIN_REST_HOURS} hours required)."
                )
        # Check next day
        next_date = swap_date + timedelta(days=1)
        next_start, next_end = _get_shift_datetime(driver, next_date, timings_dict)
        if swap_end and next_start:
            rest = (next_start - swap_end).total_seconds() / 3600
            if rest < MIN_REST_HOURS:
                inner_errors.append(
                    f"{driver.formatted_name()} would have only {rest:.1f}h rest after the swapped shift "
                    f"on {swap_date.strftime('%d/%m/%Y')} (minimum {MIN_REST_HOURS} hours required)."
                )
        # Check same-day overlap (driver may have other shifts on that date in a split pattern)
        existing_start, existing_end = _get_shift_datetime(driver, swap_date, timings_dict)
        if existing_start and swap_start:
            # They overlap if the new shift overlaps the existing one on that day
            overlap_start = max(existing_start, swap_start)
            overlap_end = min(existing_end, swap_end) if existing_end and swap_end else None
            if overlap_end and overlap_start < overlap_end:
                inner_errors.append(
                    f"{driver.formatted_name()} already has a shift on {swap_date.strftime('%d/%m/%Y')} "
                    f"that overlaps with the swapped shift."
                )
        return inner_errors

    # driver_a takes driver_b's shift on date_b
    errors += _get_adjacent_shifts(driver_a, date_b, b_start, b_end)
    # driver_b takes driver_a's shift on date_a
    errors += _get_adjacent_shifts(driver_b, date_a, a_start, a_end)

    # Assignment limit check: count how many shifts each driver works in the relevant week
    def _weekly_shift_count(driver, ref_date):
        start_of_week = ref_date - timedelta(days=ref_date.weekday())
        count = 0
        for i in range(7):
            d = start_of_week + timedelta(days=i)
            shifts = get_driver_shifts_for_date(driver, d, timings_dict)
            # Filter out day_off
            working = [s for s in shifts if s.get('shift_type') != 'day_off' and s.get('start_time')]
            if working:
                count += 1
        return count

    # Assign limit: the driver's current pattern cycle determines expected days; use a
    # simple heuristic – if after the swap a driver works MORE days that week than their
    # assignment would normally give them, reject it.
    a_current_week_count = _weekly_shift_count(driver_a, date_b)
    b_current_week_count = _weekly_shift_count(driver_b, date_a)

    # driver_a is picking up an extra day (date_b) while losing their date_a day
    # Net change is zero within the same week only if dates are in same week; otherwise
    # check against their normal weekly work count derived from pattern cycle_length.
    def _get_expected_weekly_shifts(driver):
        assignment = driver.get_current_assignment()
        if not assignment:
            return None
        pattern = assignment.shift_pattern
        data = pattern.get_pattern_data()
        working_days = sum(
            1 for entry in data
            if entry != 'day_off' and entry != ['day_off'] and entry != []
        )
        # Proportion of cycle that are working days
        if pattern.cycle_length == 0:
            return None
        # Round to nearest integer expected working days per 7-day week
        expected = round(working_days / pattern.cycle_length * 7)
        return expected

    def _check_assignment_limit(driver, gaining_date, losing_date):
        inner_errors = []
        expected = _get_expected_weekly_shifts(driver)
        if expected is None:
            return inner_errors  # No assignment – skip check
        # Count working days in the week of the gaining date (before swap)
        week_count = _weekly_shift_count(driver, gaining_date)
        gaining_week_start = gaining_date - timedelta(days=gaining_date.weekday())
        gaining_week_end = gaining_week_start + timedelta(days=6)
        losing_in_same_week = gaining_week_start <= losing_date <= gaining_week_end
        net_change = 1 if not losing_in_same_week else 0
        if week_count + net_change > expected:
            inner_errors.append(
                f"Swap would give {driver.formatted_name()} {week_count + net_change} working days "
                f"in the week of {gaining_date.strftime('%d/%m/%Y')}, exceeding their assignment "
                f"limit of {expected} days."
            )
        return inner_errors

    errors += _check_assignment_limit(driver_a, date_b, date_a)
    errors += _check_assignment_limit(driver_b, date_a, date_b)

    return errors


# -----------------------------------------------------------------------------
# Routes: Scheduling (Holidays, Adjustments, Swaps)
# -----------------------------------------------------------------------------

@app.route("/scheduling")
def scheduling():
    """Scheduling management: holidays, one-off adjustments, shift swaps."""
    all_drivers = Driver.query.order_by(Driver.driver_number).all()
    holidays = (
        DriverHoliday.query
        .join(Driver)
        .order_by(DriverHoliday.holiday_date.desc())
        .all()
    )
    adjustments = (
        ShiftAdjustment.query
        .join(Driver)
        .order_by(ShiftAdjustment.adjustment_date.desc())
        .all()
    )
    swaps = (
        ShiftSwap.query
        .order_by(ShiftSwap.date_a.desc())
        .all()
    )
    return render_template(
        "scheduling.html",
        drivers=all_drivers,
        holidays=holidays,
        adjustments=adjustments,
        swaps=swaps,
    )


@app.route("/scheduling/holiday/add", methods=["POST"])
def add_holiday():
    """Add a holiday date for a driver."""
    driver_id = parse_positive_int(request.form.get("driver_id"))
    date_str = request.form.get("holiday_date", "").strip()
    notes = request.form.get("notes", "").strip()

    if not driver_id:
        flash("Please select a driver.", "error")
        return redirect(url_for("scheduling"))

    driver = Driver.query.get_or_404(driver_id)

    try:
        holiday_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        flash("Invalid date format.", "error")
        return redirect(url_for("scheduling"))

    existing = DriverHoliday.query.filter_by(driver_id=driver_id, holiday_date=holiday_date).first()
    if existing:
        flash(f"{driver.formatted_name()} already has holiday recorded on {holiday_date.strftime('%d/%m/%Y')}.", "warning")
        return redirect(url_for("scheduling"))

    holiday = DriverHoliday(driver_id=driver_id, holiday_date=holiday_date, notes=notes or None)
    db.session.add(holiday)
    db.session.commit()
    flash(f"Holiday on {holiday_date.strftime('%d/%m/%Y')} added for {driver.formatted_name()}.", "success")
    return redirect(url_for("scheduling"))


@app.route("/scheduling/holiday/<int:holiday_id>/delete", methods=["POST"])
def delete_holiday(holiday_id):
    """Delete a holiday record."""
    holiday = DriverHoliday.query.get_or_404(holiday_id)
    driver_name = holiday.driver.formatted_name()
    date_str = holiday.holiday_date.strftime('%d/%m/%Y')
    db.session.delete(holiday)
    db.session.commit()
    flash(f"Holiday on {date_str} for {driver_name} removed.", "success")
    return redirect(url_for("scheduling"))


@app.route("/scheduling/adjustment/add", methods=["POST"])
def add_adjustment():
    """Add a one-off shift adjustment (late start or early finish)."""
    driver_id = parse_positive_int(request.form.get("driver_id"))
    date_str = request.form.get("adjustment_date", "").strip()
    adjustment_type = request.form.get("adjustment_type", "").strip()
    time_str = request.form.get("adjusted_time", "").strip()
    notes = request.form.get("notes", "").strip()

    if not driver_id:
        flash("Please select a driver.", "error")
        return redirect(url_for("scheduling"))

    Driver.query.get_or_404(driver_id)

    if adjustment_type not in ("late_start", "early_finish"):
        flash("Adjustment type must be 'late_start' or 'early_finish'.", "error")
        return redirect(url_for("scheduling"))

    try:
        adj_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        flash("Invalid date format.", "error")
        return redirect(url_for("scheduling"))

    adjusted_time = parse_time_string(time_str)
    if adjusted_time is None:
        flash("Invalid time format. Use HH:MM.", "error")
        return redirect(url_for("scheduling"))

    adjustment = ShiftAdjustment(
        driver_id=driver_id,
        adjustment_date=adj_date,
        adjustment_type=adjustment_type,
        adjusted_time=adjusted_time,
        notes=notes or None,
    )
    db.session.add(adjustment)
    db.session.commit()
    driver = Driver.query.get(driver_id)
    label = "Late Start" if adjustment_type == "late_start" else "Early Finish"
    flash(f"{label} on {adj_date.strftime('%d/%m/%Y')} added for {driver.formatted_name()}.", "success")
    return redirect(url_for("scheduling"))


@app.route("/scheduling/adjustment/<int:adjustment_id>/edit", methods=["POST"])
def edit_adjustment(adjustment_id):
    """Edit a shift adjustment."""
    adjustment = ShiftAdjustment.query.get_or_404(adjustment_id)
    date_str = request.form.get("adjustment_date", "").strip()
    adjustment_type = request.form.get("adjustment_type", "").strip()
    time_str = request.form.get("adjusted_time", "").strip()
    notes = request.form.get("notes", "").strip()

    if adjustment_type not in ("late_start", "early_finish"):
        flash("Adjustment type must be 'late_start' or 'early_finish'.", "error")
        return redirect(url_for("scheduling"))

    try:
        adj_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        flash("Invalid date format.", "error")
        return redirect(url_for("scheduling"))

    adjusted_time = parse_time_string(time_str)
    if adjusted_time is None:
        flash("Invalid time format. Use HH:MM.", "error")
        return redirect(url_for("scheduling"))

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
    adjustment = ShiftAdjustment.query.get_or_404(adjustment_id)
    db.session.delete(adjustment)
    db.session.commit()
    flash("Adjustment removed.", "success")
    return redirect(url_for("scheduling"))


@app.route("/scheduling/swap/validate", methods=["POST"])
def validate_swap_ajax():
    """AJAX endpoint to validate a proposed swap before confirming."""
    data = request.get_json(silent=True) or request.form
    driver_a_id = parse_positive_int(data.get("driver_a_id"))
    driver_b_id = parse_positive_int(data.get("driver_b_id"))
    date_a_str = (data.get("date_a") or "").strip()
    date_b_str = (data.get("date_b") or "").strip()

    if not driver_a_id or not driver_b_id:
        return json_error("Please select both drivers.")
    if driver_a_id == driver_b_id:
        return json_error("Drivers must be different.")

    driver_a = Driver.query.get(driver_a_id)
    driver_b = Driver.query.get(driver_b_id)
    if not driver_a or not driver_b:
        return json_error("One or both drivers not found.")

    try:
        date_a = datetime.strptime(date_a_str, "%Y-%m-%d").date()
        date_b = datetime.strptime(date_b_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return json_error("Invalid date format.")

    errors = validate_swap(driver_a, driver_b, date_a, date_b)
    if errors:
        return jsonify({"success": False, "errors": errors})
    return jsonify({"success": True, "errors": []})


@app.route("/scheduling/swap/add", methods=["POST"])
def add_swap():
    """Add a confirmed shift swap."""
    driver_a_id = parse_positive_int(request.form.get("driver_a_id"))
    driver_b_id = parse_positive_int(request.form.get("driver_b_id"))
    date_a_str = request.form.get("date_a", "").strip()
    date_b_str = request.form.get("date_b", "").strip()
    notes = request.form.get("notes", "").strip()

    if not driver_a_id or not driver_b_id:
        flash("Please select both drivers.", "error")
        return redirect(url_for("scheduling"))

    if driver_a_id == driver_b_id:
        flash("Drivers must be different.", "error")
        return redirect(url_for("scheduling"))

    driver_a = Driver.query.get_or_404(driver_a_id)
    driver_b = Driver.query.get_or_404(driver_b_id)

    try:
        date_a = datetime.strptime(date_a_str, "%Y-%m-%d").date()
        date_b = datetime.strptime(date_b_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        flash("Invalid date format.", "error")
        return redirect(url_for("scheduling"))

    errors = validate_swap(driver_a, driver_b, date_a, date_b)
    if errors:
        for err in errors:
            flash(err, "error")
        return redirect(url_for("scheduling"))

    swap = ShiftSwap(
        driver_a_id=driver_a_id,
        driver_b_id=driver_b_id,
        date_a=date_a,
        date_b=date_b,
        notes=notes or None,
    )
    db.session.add(swap)
    db.session.commit()
    flash(
        f"Swap recorded: {driver_a.formatted_name()} on {date_a.strftime('%d/%m/%Y')} "
        f"↔ {driver_b.formatted_name()} on {date_b.strftime('%d/%m/%Y')}.",
        "success",
    )
    return redirect(url_for("scheduling"))


@app.route("/scheduling/swap/<int:swap_id>/delete", methods=["POST"])
def delete_swap(swap_id):
    """Delete a swap record."""
    swap = ShiftSwap.query.get_or_404(swap_id)
    db.session.delete(swap)
    db.session.commit()
    flash("Swap removed.", "success")
    return redirect(url_for("scheduling"))

    # -----------------------------------------------------------------------------
    # Entrypoint
    # -----------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(
        host=app.config.get('HOST', '0.0.0.0'),
        port=app.config.get('PORT', 5000),
        debug=app.config.get('DEBUG', False)
    )
