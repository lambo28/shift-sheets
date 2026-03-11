# app.py

from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text, and_, or_
from datetime import datetime, timedelta, date, time
import os
import json
from config import config

# Minimum rest hours required between consecutive shifts (used in swap validation)
MIN_REST_HOURS = 8

# Maximum hours a driver may work within any rolling 24-hour period
MAX_WORK_HOURS_PER_24H = 16

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

_bundle_manifest_cache = {"mtime": None, "data": {}}


def get_bundle_manifest():
    manifest_path = app.static_folder and os.path.join(app.static_folder, "js", "bundles", "manifest.json")
    if not manifest_path or not os.path.exists(manifest_path):
        _bundle_manifest_cache["mtime"] = None
        _bundle_manifest_cache["data"] = {}
        return _bundle_manifest_cache["data"]

    current_mtime = os.path.getmtime(manifest_path)
    if _bundle_manifest_cache["mtime"] != current_mtime:
        try:
            with open(manifest_path, "r", encoding="utf-8") as manifest_file:
                _bundle_manifest_cache["data"] = json.load(manifest_file)
        except (OSError, json.JSONDecodeError):
            _bundle_manifest_cache["data"] = {}
        _bundle_manifest_cache["mtime"] = current_mtime

    return _bundle_manifest_cache["data"]


def bundle_url(bundle_name):
    manifest = get_bundle_manifest()
    resolved_name = manifest.get(bundle_name, bundle_name)
    return url_for("static", filename=f"js/bundles/{resolved_name}")

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
        normalized_pattern = [compact_day_shifts(day_entry) for day_entry in pattern_list]
        self.pattern_data = json.dumps(normalized_pattern)
    
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
    """Records time off dates for a driver (holiday, sickness, VOR, etc)."""
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    holiday_date = db.Column(db.Date, nullable=False)
    time_off_type = db.Column(db.String(20), nullable=False, default='holiday')  # holiday, sickness, vor, other
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
    """Records a single driver's day swap between an existing working day and an off day."""
    id = db.Column(db.Integer, primary_key=True)
    driver_a_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    driver_b_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    date_a = db.Column(db.Date, nullable=False)  # Date driver_a is giving up their shift
    date_b = db.Column(db.Date, nullable=False)  # Date driver_b is giving up their shift
    work_shift_type = db.Column(db.String(50), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    driver_a = db.relationship('Driver', foreign_keys=[driver_a_id], backref=db.backref('swaps_as_a', lazy=True, cascade='all, delete-orphan'))
    driver_b = db.relationship('Driver', foreign_keys=[driver_b_id], backref=db.backref('swaps_as_b', lazy=True, cascade='all, delete-orphan'))

    @property
    def driver(self):
        return self.driver_a

    @property
    def driver_id(self):
        return self.driver_a_id

    @property
    def give_up_date(self):
        return self.date_a

    @property
    def work_date(self):
        return self.date_b


class ExtraCarRequest(db.Model):
    """A request for additional cars beyond normal shifted coverage."""
    __tablename__ = 'extra_car_request'

    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False)
    # 'shift_type' uses an existing shift timing; 'time_window' uses explicit start/end
    request_type = db.Column(db.String(20), nullable=False)
    shift_type = db.Column(db.String(50), nullable=True)   # used when request_type='shift_type'
    window_start = db.Column(db.Time, nullable=True)        # used when request_type='time_window'
    window_end = db.Column(db.Time, nullable=True)          # used when request_type='time_window'
    unlimited = db.Column(db.Boolean, default=False, nullable=False)
    required_slots = db.Column(db.Integer, nullable=True)   # NULL when unlimited=True
    min_partial_hours = db.Column(db.Float, default=2.0, nullable=False)
    status = db.Column(db.String(20), default='OPEN', nullable=False)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    assignments = db.relationship(
        'ExtraCarAssignment',
        back_populates='request',
        cascade='all, delete-orphan',
        order_by='ExtraCarAssignment.created_at',
    )

    def get_time_window(self):
        """Return (start_datetime, end_datetime) for this request."""
        if self.request_type == 'shift_type' and self.shift_type:
            timing = ShiftTiming.query.filter_by(shift_type=self.shift_type).first()
            if not timing or not timing.start_time or not timing.end_time:
                return None, None
            start_dt = datetime.combine(self.date, timing.start_time)
            end_dt = datetime.combine(self.date, timing.end_time)
        elif self.request_type == 'time_window' and self.window_start and self.window_end:
            start_dt = datetime.combine(self.date, self.window_start)
            end_dt = datetime.combine(self.date, self.window_end)
        else:
            return None, None
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)
        return start_dt, end_dt

    def display_window(self):
        """Return a human-readable time window string."""
        start_dt, end_dt = self.get_time_window()
        if not start_dt:
            return '—'
        return f"{start_dt.strftime('%H:%M')} – {end_dt.strftime('%H:%M')}"

    def compute_coverage(self):
        """
        Compute how many independent coverage slots are filled by current assignments.

        Coverage model:
        - Only assignments whose effective overlap with the request window is >= min_partial_hours count.
        - Assignments that are sequential (B starts when or after A ends) form one coverage *chain*,
          which equals one filled slot. Parallel/overlapping assignments each start a new chain.
        - Returns (filled_slots, suggested_status).
        """
        req_start, req_end = self.get_time_window()
        if not req_start or not req_end:
            return 0, self.status

        min_hours = self.min_partial_hours or 2.0
        valid = []

        for asgn in self.assignments:
            asgn_start = datetime.combine(self.date, asgn.start_time) if asgn.start_time else req_start
            asgn_end = datetime.combine(self.date, asgn.end_time) if asgn.end_time else req_end
            if asgn_end <= asgn_start:
                asgn_end += timedelta(days=1)
            # Clip to request window
            eff_start = max(asgn_start, req_start)
            eff_end = min(asgn_end, req_end)
            if eff_end <= eff_start:
                continue
            if (eff_end - eff_start).total_seconds() / 3600 < min_hours:
                continue
            valid.append((eff_start, eff_end))

        valid.sort(key=lambda x: x[0])

        # Greedy chain counting: track end-times of open chains.
        # An assignment extends the chain whose end is <= the assignment's start
        # (sequential / handover). When multiple chains qualify, pick the one
        # ending latest to preserve earlier-ending chains for future assignments.
        chain_ends = []
        for asgn_start, asgn_end in valid:
            best_idx = None
            best_end = None
            for i, chain_end in enumerate(chain_ends):
                if asgn_start >= chain_end:
                    if best_end is None or chain_end > best_end:
                        best_idx = i
                        best_end = chain_end
            if best_idx is not None:
                chain_ends[best_idx] = max(chain_ends[best_idx], asgn_end)
            else:
                chain_ends.append(asgn_end)

        filled_slots = len(chain_ends)

        if self.status == 'CLOSED':
            return filled_slots, 'CLOSED'

        if self.unlimited:
            new_status = 'PARTIALLY_FILLED' if filled_slots > 0 else 'OPEN'
        else:
            required = self.required_slots or 0
            if filled_slots >= required > 0:
                new_status = 'FILLED'
            elif filled_slots > 0:
                new_status = 'PARTIALLY_FILLED'
            else:
                new_status = 'OPEN'

        return filled_slots, new_status


class ExtraCarAssignment(db.Model):
    """A car/driver assignment to an ExtraCarRequest."""
    __tablename__ = 'extra_car_assignment'

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(
        db.Integer,
        db.ForeignKey('extra_car_request.id', ondelete='CASCADE'),
        nullable=False,
    )
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    # Optional time overrides; if NULL the full request window applies
    start_time = db.Column(db.Time, nullable=True)
    end_time = db.Column(db.Time, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    request = db.relationship('ExtraCarRequest', back_populates='assignments')
    driver = db.relationship('Driver', backref=db.backref('extra_assignments', lazy=True))

    def effective_start(self):
        """Return the effective start datetime for this assignment."""
        req_start, _ = self.request.get_time_window()
        if self.start_time and req_start:
            return datetime.combine(self.request.date, self.start_time)
        return req_start

    def effective_end(self):
        """Return the effective end datetime for this assignment."""
        _, req_end = self.request.get_time_window()
        if self.end_time and req_end:
            return datetime.combine(self.request.date, self.end_time)
        return req_end

    def duration_hours(self):
        """Return the effective duration in hours (clipped to request window)."""
        req_start, req_end = self.request.get_time_window()
        if not req_start or not req_end:
            return 0.0
        s = self.effective_start() or req_start
        e = self.effective_end() or req_end
        if e <= s:
            e += timedelta(days=1)
        eff_start = max(s, req_start)
        eff_end = min(e, req_end)
        if eff_end <= eff_start:
            return 0.0
        return (eff_end - eff_start).total_seconds() / 3600

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

    shift_swap_columns = {
        row[1]
        for row in db.session.execute(text("PRAGMA table_info(shift_swap)")).fetchall()
    }

    if 'work_shift_type' not in shift_swap_columns:
        db.session.execute(text("ALTER TABLE shift_swap ADD COLUMN work_shift_type VARCHAR(50)"))

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


@app.template_filter('group_consecutive_holidays')
def group_consecutive_holidays(holidays_list):
    """Group consecutive holiday dates into ranges for display."""
    if not holidays_list:
        return []

    # Keep groups isolated by driver + type + notes so records from different
    # drivers (or different time off categories) never get merged into one row.
    sorted_holidays = sorted(
        holidays_list,
        key=lambda h: (
            h.driver_id,
            h.time_off_type or "holiday",
            h.notes or "",
            h.holiday_date,
        ),
    )
    groups = []
    current_group = [sorted_holidays[0]]

    for holiday in sorted_holidays[1:]:
        # Check if this holiday belongs to the same logical group
        last = current_group[-1]
        same_driver = holiday.driver_id == last.driver_id
        same_type = (holiday.time_off_type or "holiday") == (last.time_off_type or "holiday")
        same_notes = (holiday.notes or "") == (last.notes or "")
        is_consecutive = (holiday.holiday_date - last.holiday_date).days == 1

        if same_driver and same_type and same_notes and is_consecutive:
            current_group.append(holiday)
        else:
            groups.append(current_group)
            current_group = [holiday]

    if current_group:
        groups.append(current_group)

    return groups


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
    return dict(datetime=datetime, bundle_url=bundle_url)

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


def is_driver_on_holiday(driver_id, target_date):
    """Return True when the driver has an approved holiday on target_date."""
    return (
        DriverHoliday.query.filter_by(driver_id=driver_id, holiday_date=target_date).first()
        is not None
    )

def get_drivers_for_date(target_date):
    """Get all drivers working on a specific date with their shift assignments and timing info"""
    all_timings = ShiftTiming.query.all()
    timings_dict = {t.shift_type: t for t in all_timings}

    # Pre-build buckets for top-level (non-sub) shift types only
    drivers_working = {}
    for t in all_timings:
        if not t.parent_shift_type:
            drivers_working[t.shift_type] = []

    # Collect all driver IDs to check: pattern-based assignments + work-day swaps
    assignments = get_active_assignments_for_date(target_date)
    driver_ids = {a.driver_id for a in assignments}

    # Also include drivers who are working via a swap on this date (they may
    # have no matching pattern assignment for this date).
    swap_workers = ShiftSwap.query.filter(
        ShiftSwap.date_b == target_date,
        ShiftSwap.work_shift_type.isnot(None),
    ).with_entities(ShiftSwap.driver_a_id).all()
    for row in swap_workers:
        driver_ids.add(row.driver_a_id)

    if not driver_ids:
        return drivers_working

    drivers = Driver.query.filter(Driver.id.in_(driver_ids)).all()

    for driver in drivers:
        effective_shifts = get_driver_shifts_for_date(driver, target_date, timings_dict, include_swaps=True)
        for entry in effective_shifts:
            shift_type = entry['shift_type']
            if shift_type == 'day_off':
                continue

            driver_info = {
                'driver': driver,
                'start_time': entry['start_time'],
                'end_time': entry['end_time'],
                'is_custom': entry.get('is_override') or entry.get('is_custom_time'),
                'is_adjusted': entry['is_adjusted'],
                'timing_note': None,
                'shift_type': shift_type,
            }

            # Determine where to group this driver
            current_timing = timings_dict.get(shift_type)
            if current_timing and current_timing.parent_shift_type:
                # Sub-shift: group under parent bucket
                parent = current_timing.parent_shift_type
                if parent not in drivers_working:
                    drivers_working[parent] = []
                drivers_working[parent].append(driver_info)
            else:
                if shift_type not in drivers_working:
                    drivers_working[shift_type] = []
                drivers_working[shift_type].append(driver_info)

    return drivers_working


def get_driver_shifts_for_date(driver, target_date, timings_dict=None, include_swaps=True):
    if timings_dict is None:
        all_timings = ShiftTiming.query.all()
        timings_dict = {timing.shift_type: timing for timing in all_timings}

    if is_driver_on_holiday(driver.id, target_date):
        return []

    if include_swaps:
        swaps_for_date = ShiftSwap.query.filter(
            ShiftSwap.driver_a_id == driver.id,
            ShiftSwap.driver_b_id == driver.id,
            ShiftSwap.work_shift_type.isnot(None),
            db.or_(
                ShiftSwap.date_a == target_date,
                ShiftSwap.date_b == target_date,
            )
        ).order_by(ShiftSwap.id.desc()).all()

        work_day_swaps = [swap for swap in swaps_for_date if swap.date_b == target_date]
        if work_day_swaps:
            latest_late_start, earliest_early_finish = get_adjustment_conflict_bounds(driver.id, target_date)
            swap_entries = []

            for swap in work_day_swaps:
                effective_shift_type = swap.work_shift_type
                timing_meta = timings_dict.get(effective_shift_type)
                if not timing_meta:
                    continue

                start_time = timing_meta.start_time
                end_time = timing_meta.end_time

                adjusted_start_time = start_time
                adjusted_end_time = end_time
                if latest_late_start is not None and adjusted_start_time is not None:
                    adjusted_start_time = latest_late_start
                if earliest_early_finish is not None and adjusted_end_time is not None:
                    adjusted_end_time = earliest_early_finish

                is_adjusted = (
                    adjusted_start_time != start_time
                    or adjusted_end_time != end_time
                )

                swap_entries.append({
                    'shift_type': effective_shift_type,
                    'label': timing_meta.display_label,
                    'badge_color': timing_meta.badge_color or 'bg-primary',
                    'icon': timing_meta.icon or 'fas fa-clock',
                    'start_time': adjusted_start_time,
                    'end_time': adjusted_end_time,
                    'default_start_time': timing_meta.start_time,
                    'default_end_time': timing_meta.end_time,
                    'is_override': False,
                    'is_custom_time': False,
                    'is_adjusted': is_adjusted,
                    'is_swap': True,
                    'swap_role': 'work',
                })

            if swap_entries:
                swap_entries.sort(key=lambda item: (item['start_time'] is None, item['start_time'] or datetime.min.time(), item['label']))
                return swap_entries

        give_up_only_swaps = [
            swap for swap in swaps_for_date
            if swap.date_a == target_date and swap.date_b != target_date
        ]
        if give_up_only_swaps:
            return [{
                'shift_type': 'day_off',
                'label': 'OFF',
                'badge_color': 'bg-secondary',
                'icon': 'fas fa-user-clock',
                'start_time': None,
                'end_time': None,
                'default_start_time': None,
                'default_end_time': None,
                'is_override': False,
                'is_custom_time': False,
                'is_adjusted': False,
                'is_swap': True,
                'swap_role': 'give_up',
            }]

    latest_late_start, earliest_early_finish = get_adjustment_conflict_bounds(driver.id, target_date)

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

            adjusted_start_time = start_time
            adjusted_end_time = end_time

            if latest_late_start is not None and adjusted_start_time is not None:
                adjusted_start_time = latest_late_start
            if earliest_early_finish is not None and adjusted_end_time is not None:
                adjusted_end_time = earliest_early_finish

            is_adjusted = (
                adjusted_start_time != start_time
                or adjusted_end_time != end_time
            )

            start_time = adjusted_start_time
            end_time = adjusted_end_time

            default_start_time = default_timing.start_time if default_timing else None
            default_end_time = default_timing.end_time if default_timing else None

            timing_meta = timings_dict.get(effective_shift_type)
            if effective_shift_type == 'day_off':
                label = 'OFF'
                badge_color = 'bg-secondary'
                icon = 'fas fa-user-clock'
            elif timing_meta:
                label = timing_meta.display_label
                badge_color = timing_meta.badge_color or 'bg-primary'
                icon = timing_meta.icon or 'fas fa-clock'
            else:
                label = shift_label(effective_shift_type)
                badge_color = 'bg-primary'
                icon = 'fas fa-clock'

            entries.append({
                'shift_type': effective_shift_type,
                'label': label,
                'badge_color': badge_color,
                'icon': icon,
                'start_time': start_time,
                'end_time': end_time,
                'default_start_time': default_start_time,
                'default_end_time': default_end_time,
                'is_override': bool(custom_timing and custom_timing.override_shift),
                'is_custom_time': bool(custom_timing and (custom_timing.start_time is not None or custom_timing.end_time is not None)),
                'is_adjusted': is_adjusted,
                'is_swap': False,
                'swap_role': None,
            })

    entries.sort(key=lambda item: (item['start_time'] is None, item['start_time'] or datetime.min.time(), item['label']))
    return entries


def driver_has_working_shift_on_date(driver, target_date, timings_dict=None):
    """Return True when driver has at least one non-day-off shift on the target date."""
    shifts = get_driver_shifts_for_date(driver, target_date, timings_dict)
    return any(shift.get('shift_type') != 'day_off' for shift in shifts)


def get_driver_adjustment_time_window(driver, target_date, timings_dict=None):
    """Return (earliest_start, latest_end) from default/custom timings for the driver's working shifts on a date."""
    if timings_dict is None:
        all_timings = ShiftTiming.query.all()
        timings_dict = {timing.shift_type: timing for timing in all_timings}

    if is_driver_on_holiday(driver.id, target_date):
        return None, None

    # Check if this is a swapped work day
    work_day_swap = ShiftSwap.query.filter(
        ShiftSwap.driver_a_id == driver.id,
        ShiftSwap.driver_b_id == driver.id,
        ShiftSwap.date_b == target_date,
        ShiftSwap.work_shift_type.isnot(None)
    ).first()

    if work_day_swap:
        # For swapped work days, get timing from the work_shift_type
        timing = timings_dict.get(work_day_swap.work_shift_type)
        if timing and timing.start_time is not None and timing.end_time is not None:
            return timing.start_time, timing.end_time
        return None, None

    # Check if this is a give-up day (becomes day off)
    give_up_swap = ShiftSwap.query.filter(
        ShiftSwap.driver_a_id == driver.id,
        ShiftSwap.driver_b_id == driver.id,
        ShiftSwap.date_a == target_date
    ).first()

    if give_up_swap:
        # Give-up day becomes a day off, no adjustment window
        return None, None

    assignments = DriverAssignment.query.filter(
        DriverAssignment.driver_id == driver.id,
        DriverAssignment.start_date <= target_date,
        db.or_(
            DriverAssignment.end_date.is_(None),
            DriverAssignment.end_date >= target_date
        )
    ).all()

    window_starts = []
    window_ends = []

    for assignment in assignments:
        shift_types = assignment.get_shifts_for_date(target_date) or []
        if not shift_types:
            continue

        days_since_start = (target_date - assignment.start_date).days
        cycle_day = days_since_start % assignment.shift_pattern.cycle_length
        weekday = target_date.weekday()

        for base_shift_type in shift_types:
            if base_shift_type == 'day_off':
                continue

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

            candidate_starts = []
            candidate_ends = []

            if default_timing and default_timing.start_time is not None:
                candidate_starts.append(default_timing.start_time)
            if custom_timing and custom_timing.start_time is not None:
                candidate_starts.append(custom_timing.start_time)

            if default_timing and default_timing.end_time is not None:
                candidate_ends.append(default_timing.end_time)
            if custom_timing and custom_timing.end_time is not None:
                candidate_ends.append(custom_timing.end_time)

            if candidate_starts and candidate_ends:
                window_starts.append(min(candidate_starts))
                window_ends.append(max(candidate_ends))

    if not window_starts or not window_ends:
        return None, None

    return min(window_starts), max(window_ends)


def get_adjustment_conflict_bounds(driver_id, target_date, exclude_adjustment_id=None):
    """Return (latest_late_start, earliest_early_finish) from existing adjustments on same date."""
    query = ShiftAdjustment.query.filter(
        ShiftAdjustment.driver_id == driver_id,
        ShiftAdjustment.adjustment_date == target_date,
    )

    if exclude_adjustment_id is not None:
        query = query.filter(ShiftAdjustment.id != exclude_adjustment_id)

    adjustments = query.all()
    late_starts = [a.adjusted_time for a in adjustments if a.adjustment_type == 'late_start']
    early_finishes = [a.adjusted_time for a in adjustments if a.adjustment_type == 'early_finish']

    latest_late_start = max(late_starts) if late_starts else None
    earliest_early_finish = min(early_finishes) if early_finishes else None
    return latest_late_start, earliest_early_finish


def is_split_shift_day(driver, target_date, timings_dict=None, include_swaps=True):
    """Return True when a date has two or more working shifts for the driver."""
    shifts = get_driver_shifts_for_date(
        driver,
        target_date,
        timings_dict=timings_dict,
        include_swaps=include_swaps,
    )
    working_shifts = [shift for shift in shifts if shift.get('shift_type') != 'day_off']
    return len(working_shifts) >= 2


def validate_adjustment_time(driver, target_date, adjustment_type, adjusted_time, exclude_adjustment_id=None):
    """Validate adjustment time against working window and existing opposite adjustments.

    Rules:
    - Window start is the earliest start between default and custom timing.
    - Window end is the latest end between default and custom timing.
    - late_start must be strictly inside (window_start, window_end).
    - early_finish must be strictly inside (window_start, window_end).
    - Existing opposite adjustments further tighten allowed bounds.
    """
    all_timings = ShiftTiming.query.all()
    timings_dict = {timing.shift_type: timing for timing in all_timings}

    if is_split_shift_day(driver, target_date, timings_dict=timings_dict, include_swaps=True):
        return "Cannot set adjustment on a split shift day."

    if not driver_has_working_shift_on_date(driver, target_date, timings_dict):
        return "Cannot set adjustment on a day off or time off day."

    window_start, window_end = get_driver_adjustment_time_window(driver, target_date, timings_dict)
    if window_start is None or window_end is None:
        return "Could not determine shift time window for this day."

    latest_late_start, earliest_early_finish = get_adjustment_conflict_bounds(
        driver.id,
        target_date,
        exclude_adjustment_id=exclude_adjustment_id,
    )

    lower_bound = window_start
    upper_bound = window_end

    if adjustment_type == 'late_start' and earliest_early_finish and earliest_early_finish < upper_bound:
        upper_bound = earliest_early_finish
    if adjustment_type == 'early_finish' and latest_late_start and latest_late_start > lower_bound:
        lower_bound = latest_late_start

    if upper_bound <= lower_bound:
        return "Existing adjustments leave no valid time window on this day."

    if adjusted_time <= lower_bound:
        label = "Late start" if adjustment_type == 'late_start' else "Early finish"
        return f"{label} must be later than {lower_bound.strftime('%H:%M')}."

    if adjusted_time >= upper_bound:
        label = "Late start" if adjustment_type == 'late_start' else "Early finish"
        return f"{label} must be earlier than {upper_bound.strftime('%H:%M')}."

    return None

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

    if len(cleaned) > 1:
        timing_order = {
            timing.shift_type: (timing.start_time, timing.end_time, timing.shift_type)
            for timing in ShiftTiming.query.filter(ShiftTiming.shift_type.in_(cleaned)).all()
        }

        cleaned.sort(
            key=lambda shift: (
                shift not in timing_order,
                timing_order.get(shift, (None, None, shift))[0] is None,
                timing_order.get(shift, (None, None, shift))[0] or datetime.max.time(),
                timing_order.get(shift, (None, None, shift))[1] is None,
                timing_order.get(shift, (None, None, shift))[1] or datetime.max.time(),
                shift,
            )
        )

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
# Extra Cars Helper Functions
# -----------------------------------------------------------------------------

def get_driver_all_work_intervals(driver, ref_date, timings_dict=None, exclude_request_id=None):
    """Return a list of (source, start_datetime, end_datetime) tuples representing
    all working periods for ``driver`` across ref_date-1, ref_date, and ref_date+1.

    ``source`` is ``'scheduled'`` for pattern-based shifts or ``'extra'`` for
    ExtraCarAssignment entries.  Entries from the extra-car request identified by
    ``exclude_request_id`` are omitted so that the current request's own existing
    assignments do not count against the driver being validated.
    """
    if timings_dict is None:
        timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

    intervals = []

    # Collect regular scheduled shifts for the three-day window
    for delta in range(-1, 2):
        check_date = ref_date + timedelta(days=delta)
        shifts = get_driver_shifts_for_date(driver, check_date, timings_dict)
        for shift in shifts:
            if shift['shift_type'] == 'day_off':
                continue
            if not shift['start_time'] or not shift['end_time']:
                continue
            s = datetime.combine(check_date, shift['start_time'])
            e = datetime.combine(check_date, shift['end_time'])
            if e <= s:
                e += timedelta(days=1)
            intervals.append(('scheduled', s, e))

    # Collect existing extra-car assignments in the same window
    window_start_date = ref_date - timedelta(days=1)
    window_end_date = ref_date + timedelta(days=1)
    extra_asgns = (
        ExtraCarAssignment.query
        .filter(ExtraCarAssignment.driver_id == driver.id)
        .join(ExtraCarRequest)
        .filter(
            ExtraCarRequest.date >= window_start_date,
            ExtraCarRequest.date <= window_end_date,
            ExtraCarRequest.status != 'CLOSED',
        )
        .all()
    )
    if exclude_request_id is not None:
        extra_asgns = [a for a in extra_asgns if a.request_id != exclude_request_id]

    for ea in extra_asgns:
        req_start, req_end = ea.request.get_time_window()
        if not req_start or not req_end:
            continue
        s = datetime.combine(ea.request.date, ea.start_time) if ea.start_time else req_start
        e = datetime.combine(ea.request.date, ea.end_time) if ea.end_time else req_end
        if e <= s:
            e += timedelta(days=1)
        intervals.append(('extra', s, e))

    return intervals


def validate_extra_car_assignment(driver, request, proposed_start_dt, proposed_end_dt, timings_dict=None):
    """Validate a proposed extra-car assignment against driver work rules.

    Enforces:
    - Minimum rest of ``MIN_REST_HOURS`` hours between consecutive working periods.
    - Maximum of ``MAX_WORK_HOURS_PER_24H`` hours worked within any rolling 24-hour window.

    Returns a tuple ``(is_valid, errors, suggested_start_dt, suggested_end_dt)`` where
    ``suggested_*`` are the tightest legal boundaries found.  When validation passes they
    match the proposed values.
    """
    if timings_dict is None:
        timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}

    errors = []
    raw_intervals = get_driver_all_work_intervals(
        driver, request.date, timings_dict, exclude_request_id=request.id
    )
    existing_intervals = [(s, e) for _, s, e in raw_intervals]

    suggested_start = proposed_start_dt
    suggested_end = proposed_end_dt

    # --- Rest before ---
    prev_ends = [e for s, e in existing_intervals if e <= proposed_start_dt]
    if prev_ends:
        latest_prev_end = max(prev_ends)
        rest_before = (proposed_start_dt - latest_prev_end).total_seconds() / 3600
        if rest_before < MIN_REST_HOURS:
            min_start = latest_prev_end + timedelta(hours=MIN_REST_HOURS)
            errors.append(
                f"Insufficient rest before assignment: {rest_before:.1f}h "
                f"(minimum {MIN_REST_HOURS}h required). "
                f"Earliest valid start: {min_start.strftime('%H:%M')}."
            )
            suggested_start = min_start

    # --- Rest after ---
    next_starts = [s for s, e in existing_intervals if s >= proposed_end_dt]
    if next_starts:
        earliest_next_start = min(next_starts)
        rest_after = (earliest_next_start - proposed_end_dt).total_seconds() / 3600
        if rest_after < MIN_REST_HOURS:
            max_end = earliest_next_start - timedelta(hours=MIN_REST_HOURS)
            errors.append(
                f"Insufficient rest after assignment: {rest_after:.1f}h "
                f"(minimum {MIN_REST_HOURS}h required). "
                f"Latest valid finish: {max_end.strftime('%H:%M')}."
            )
            suggested_end = max_end

    # --- Max hours in any rolling 24-hour window ---
    all_intervals = existing_intervals + [(proposed_start_dt, proposed_end_dt)]
    exceeded = False
    for window_start, _ in all_intervals:
        window_end = window_start + timedelta(hours=24)
        total = sum(
            (min(e, window_end) - max(s, window_start)).total_seconds() / 3600
            for s, e in all_intervals
            if e > window_start and s < window_end
        )
        if total > MAX_WORK_HOURS_PER_24H:
            errors.append(
                f"Would exceed maximum {MAX_WORK_HOURS_PER_24H}h work in a 24-hour period "
                f"({total:.1f}h total)."
            )
            exceeded = True
            break

    return (not errors), errors, suggested_start, suggested_end


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


def redirect_to_driver_custom_timings_panel(driver_id):
    return redirect(url_for("drivers", open_custom_timings_driver=driver_id))

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

# -----------------------------------------------------------------------------
# Cars Working Helpers and Routes
# -----------------------------------------------------------------------------

def get_cars_working_at_time(target_date, target_time):
    """Get count of cars working at a specific date and time"""
    assignments = get_active_assignments_for_date(target_date)
    timings_dict = {t.shift_type: t for t in ShiftTiming.query.all()}

    driver_ids = []
    seen_driver_ids = set()
    for assignment in assignments:
        if assignment.driver_id in seen_driver_ids:
            continue
        seen_driver_ids.add(assignment.driver_id)
        driver_ids.append(assignment.driver_id)

    cars_working = 0
    for driver_id in driver_ids:
        driver = db.session.get(Driver, driver_id)
        if not driver:
            continue

        effective_shifts = get_driver_shifts_for_date(driver, target_date, timings_dict=timings_dict, include_swaps=True)
        is_working_now = False
        for shift in effective_shifts:
            if shift.get('shift_type') == 'day_off':
                continue

            start_time = shift.get('start_time')
            end_time = shift.get('end_time')

            if start_time is None or end_time is None:
                continue
            if end_time < start_time:
                if target_time >= start_time or target_time < end_time:
                    is_working_now = True
                    break
            else:
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
    """Legacy route: redirect to integrated custom timings panel in Drivers."""
    Driver.query.get_or_404(driver_id)
    return redirect_to_driver_custom_timings_panel(driver_id)

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
            flash(f"Error adding custom timing: {str(e)}", "error")
            return redirect_to_driver_custom_timings_panel(driver_id)
    
    return redirect_to_driver_custom_timings_panel(driver_id)

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
    
    return redirect_to_driver_custom_timings_panel(driver_id)

@app.route("/custom-timing/<int:timing_id>/edit", methods=["POST"])
def edit_custom_timing(timing_id):
    """Edit an existing custom timing"""
    timing = DriverCustomTiming.query.get_or_404(timing_id)
    driver_id = timing.driver_id
    modal = request.args.get("modal") == "1"

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
            error_msg = "Choose either Override Shift, Day Off, or Custom Times for a day-of-week rule, not both"
            if is_ajax_request():
                return json_error(error_msg)
            flash(error_msg, "error")
        elif (day_of_week is None or not override_shift) and not start_time and not end_time:
            if day_of_week is not None and not override_shift:
                error_msg = "When selecting custom times for a day-of-week rule, you must enter at least one time"
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

    return redirect_to_driver_custom_timings_panel(driver_id)

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
        day_entries = [] if is_holiday else get_driver_shifts_for_date(driver, current_date, timings_dict)
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


def validate_swap(driver, give_up_date, work_date, work_shift_types):
    """Validate a single-driver day swap with one or more work shift types.

    ``work_shift_types`` may be a comma-separated string or a list of strings.
    Multiple types are only valid when they are all sub-shifts of the same parent.
    """
    # Normalise to list
    if isinstance(work_shift_types, str):
        work_shift_types = [t.strip() for t in work_shift_types.split(',') if t.strip()]
    work_shift_types = [t for t in work_shift_types if t]

    errors = []
    timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}
    same_day_selection = give_up_date == work_date

    if not work_shift_types:
        errors.append("Please choose a valid shift type for the work date.")
        return errors

    for wst in work_shift_types:
        if wst not in timings_dict or wst == 'day_off':
            errors.append("Please choose a valid shift type for the work date.")
            return errors

    if len(work_shift_types) > 1:
        if len(work_shift_types) != len(set(work_shift_types)):
            errors.append("Duplicate shift types selected.")
            return errors
        if any(not timings_dict[wst].parent_shift_type for wst in work_shift_types):
            errors.append("When selecting multiple shift types, all selected shifts must be sub-shifts.")
            return errors

    existing_swaps = ShiftSwap.query.filter(
        ShiftSwap.driver_a_id == driver.id,
        ShiftSwap.driver_b_id == driver.id,
        ShiftSwap.work_shift_type.isnot(None),
        or_(
            ShiftSwap.date_a == give_up_date,
            ShiftSwap.date_b == give_up_date,
            ShiftSwap.date_a == work_date,
            ShiftSwap.date_b == work_date,
        ),
    ).all()
    if existing_swaps:
        for selected_date in {give_up_date, work_date}:
            date_swaps = [
                swap for swap in existing_swaps
                if selected_date in (swap.date_a, swap.date_b)
            ]
            if not date_swaps:
                continue
            existing_shift_types = {
                swap.work_shift_type
                for swap in date_swaps
                if swap.work_shift_type
            }
            for wst in work_shift_types:
                if wst in existing_shift_types:
                    errors.append(
                        f"{selected_date.strftime('%d/%m/%Y')} already has a swap using shift type '{shift_label(wst)}'. "
                        "If reusing a swap date, choose a different shift type."
                    )
                    return errors
            if len(existing_shift_types) + len(work_shift_types) > 2:
                errors.append(
                    f"{selected_date.strftime('%d/%m/%Y')} already has the maximum swaps for that day. "
                    "Only one extra same-day swap is allowed, and it must use a different shift type."
                )
                return errors

    if is_driver_on_holiday(driver.id, work_date):
        errors.append(f"{driver.formatted_name()} is marked as time off on {work_date.strftime('%d/%m/%Y')}.")

    if is_driver_on_holiday(driver.id, give_up_date):
        errors.append(f"{driver.formatted_name()} is already marked as time off on {give_up_date.strftime('%d/%m/%Y')}.")

    base_give_up_entries = get_driver_shifts_for_date(driver, give_up_date, timings_dict, include_swaps=False)
    base_give_up_shift_exists = any(entry.get('shift_type') != 'day_off' for entry in base_give_up_entries)
    effective_give_up_entries = get_driver_shifts_for_date(driver, give_up_date, timings_dict, include_swaps=True)
    effective_give_up_shift_exists = any(entry.get('shift_type') != 'day_off' for entry in effective_give_up_entries)
    give_up_shift_exists = base_give_up_shift_exists or effective_give_up_shift_exists
    base_work_entries = get_driver_shifts_for_date(driver, work_date, timings_dict, include_swaps=False)
    existing_base_work_shift = any(entry.get('shift_type') != 'day_off' for entry in base_work_entries)

    if not give_up_shift_exists:
        errors.append(f"{driver.formatted_name()} has no working shift on {give_up_date.strftime('%d/%m/%Y')}.")

    if same_day_selection and give_up_shift_exists:
        current_shift_types = {
            entry.get('shift_type')
            for entry in effective_give_up_entries
            if entry.get('shift_type') and entry.get('shift_type') != 'day_off'
        }
        if any(wst in current_shift_types for wst in work_shift_types):
            errors.append(
                f"Same-day swap requires a different shift type than the current shift on {give_up_date.strftime('%d/%m/%Y')}."
            )

    if existing_base_work_shift and not same_day_selection:
        errors.append(f"{driver.formatted_name()} already has a working shift on {work_date.strftime('%d/%m/%Y')}.")

    if errors:
        return errors

    # Rest rule: use earliest start and latest end across all selected shift types
    start_times = [timings_dict[wst].start_time for wst in work_shift_types if timings_dict[wst].start_time]
    end_times = [timings_dict[wst].end_time for wst in work_shift_types if timings_dict[wst].end_time]
    if not start_times or not end_times:
        errors.append("Selected shift type has incomplete timing configuration.")
        return errors
    work_start_time = min(start_times)
    work_end_time = max(end_times)

    latest_late_start, earliest_early_finish = get_adjustment_conflict_bounds(driver.id, work_date)
    if latest_late_start is not None and work_start_time is not None:
        work_start_time = latest_late_start
    if earliest_early_finish is not None and work_end_time is not None:
        work_end_time = earliest_early_finish

    work_start = datetime.combine(work_date, work_start_time)
    work_end = datetime.combine(work_date, work_end_time)
    if work_end_time < work_start_time:
        work_end += timedelta(days=1)

    def _check_rest_with_adjacent_days(check_date, new_start, new_end, removed_shift_dates=None):
        inner_errors = []
        removed_shift_dates = removed_shift_dates or set()

        def _adjacent_shift_window(adjacent_date):
            if adjacent_date in removed_shift_dates:
                return None, None
            return _get_shift_datetime(driver, adjacent_date, timings_dict)

        prev_date = check_date - timedelta(days=1)
        prev_start, prev_end = _adjacent_shift_window(prev_date)
        if prev_end and new_start:
            rest = (new_start - prev_end).total_seconds() / 3600
            if rest < MIN_REST_HOURS:
                inner_errors.append(
                    f"{driver.formatted_name()} would have only {rest:.1f}h rest before the shift on "
                    f"{check_date.strftime('%d/%m/%Y')} (minimum {MIN_REST_HOURS} hours required)."
                )

        next_date = check_date + timedelta(days=1)
        next_start, next_end = _adjacent_shift_window(next_date)
        if new_end and next_start:
            rest = (next_start - new_end).total_seconds() / 3600
            if rest < MIN_REST_HOURS:
                inner_errors.append(
                    f"{driver.formatted_name()} would have only {rest:.1f}h rest after the shift on "
                    f"{check_date.strftime('%d/%m/%Y')} (minimum {MIN_REST_HOURS} hours required)."
                )

        return inner_errors

    errors += _check_rest_with_adjacent_days(work_date, work_start, work_end, removed_shift_dates={give_up_date})

    return errors


# -----------------------------------------------------------------------------
# Routes: Scheduling (Holidays, Adjustments, Swaps)
# -----------------------------------------------------------------------------

@app.route("/scheduling")
def scheduling():
    """Scheduling management: holidays, one-off adjustments, shift swaps."""
    all_drivers = Driver.query.order_by(Driver.driver_number).all()
    today = datetime.now().date()
    holidays = (
        DriverHoliday.query
        .join(Driver)
        .order_by(DriverHoliday.holiday_date.desc())
        .all()
    )

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


@app.route("/scheduling/holiday/add", methods=["POST"])
def add_holiday():
    """Add time off date(s) for a driver - supports date ranges."""
    driver_id = parse_positive_int(request.form.get("driver_id"))
    start_date_str = request.form.get("start_date", "").strip()
    end_date_str = request.form.get("end_date", "").strip()
    time_off_type = request.form.get("time_off_type", "holiday").strip()
    notes = request.form.get("notes", "").strip()

    if not driver_id:
        flash("Please select a driver.", "error")
        return redirect(url_for("scheduling"))

    driver = Driver.query.get_or_404(driver_id)

    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        flash("Invalid date format.", "error")
        return redirect(url_for("scheduling"))

    if end_date < start_date:
        flash("End date must be on or after start date.", "error")
        return redirect(url_for("scheduling"))

    replaced_count = DriverHoliday.query.filter(
        DriverHoliday.driver_id == driver_id,
        DriverHoliday.holiday_date >= start_date,
        DriverHoliday.holiday_date <= end_date,
    ).delete(synchronize_session=False)

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
    holiday = DriverHoliday.query.get_or_404(holiday_id)
    driver_name = holiday.driver.formatted_name()
    date_str = holiday.holiday_date.strftime('%d/%m/%Y')
    db.session.delete(holiday)
    db.session.commit()
    flash(f"Time off on {date_str} for {driver_name} removed.", "success")
    return redirect(url_for("scheduling"))


@app.route("/scheduling/holiday/<int:holiday_id>/delete-group", methods=["POST"])
def delete_holiday_group(holiday_id):
    """Delete all time off in a group (consecutive dates) identified by first record."""
    first_holiday = DriverHoliday.query.get_or_404(holiday_id)
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
    driver = Driver.query.get_or_404(driver_id)
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
    
    try:
        driver = Driver.query.get_or_404(driver_id)
        old_start = datetime.strptime(old_start_str, "%Y-%m-%d").date()
        old_end = datetime.strptime(old_end_str, "%Y-%m-%d").date()
        new_start = datetime.strptime(new_start_str, "%Y-%m-%d").date()
        new_end = datetime.strptime(new_end_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
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
        ).delete(synchronize_session=False)

        # Enforce non-overlap by clearing any remaining records in target range
        replaced_count = DriverHoliday.query.filter(
            DriverHoliday.driver_id == driver_id,
            DriverHoliday.holiday_date >= new_start,
            DriverHoliday.holiday_date <= new_end,
        ).delete(synchronize_session=False)

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
    driver = Driver.query.get_or_404(driver_id)
    return jsonify({
        "id": driver.id,
        "formatted_name": driver.formatted_name(),
        "name": driver.name,
        "formatted_driver_number": driver.formatted_driver_number()
    })


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

    driver = Driver.query.get_or_404(driver_id)

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

    validation_error = validate_adjustment_time(driver, adj_date, adjustment_type, adjusted_time)
    if validation_error:
        flash(validation_error, "error")
        return redirect(url_for("scheduling"))

    existing_same_type = ShiftAdjustment.query.filter_by(
        driver_id=driver_id,
        adjustment_date=adj_date,
        adjustment_type=adjustment_type,
    ).first()
    if existing_same_type:
        label = "Late Start" if adjustment_type == "late_start" else "Early Finish"
        flash(f"Only one {label} adjustment is allowed per driver per day.", "error")
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

    validation_error = validate_adjustment_time(
        adjustment.driver,
        adj_date,
        adjustment_type,
        adjusted_time,
        exclude_adjustment_id=adjustment.id,
    )
    if validation_error:
        flash(validation_error, "error")
        return redirect(url_for("scheduling"))

    existing_same_type = ShiftAdjustment.query.filter(
        ShiftAdjustment.driver_id == adjustment.driver_id,
        ShiftAdjustment.adjustment_date == adj_date,
        ShiftAdjustment.adjustment_type == adjustment_type,
        ShiftAdjustment.id != adjustment.id,
    ).first()
    if existing_same_type:
        label = "Late Start" if adjustment_type == "late_start" else "Early Finish"
        flash(f"Only one {label} adjustment is allowed per driver per day.", "error")
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


@app.route("/scheduling/adjustment/<int:driver_id>/delete-finished", methods=["POST"])
def delete_finished_adjustments_for_driver(driver_id):
    """Delete all finished (past-date) adjustments for a driver."""
    driver = Driver.query.get_or_404(driver_id)
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
    driver_id = parse_positive_int(data.get("driver_id"))
    give_up_date_str = (data.get("give_up_date") or "").strip()
    work_date_str = (data.get("work_date") or "").strip()
    raw_wst = data.get("work_shift_type") or ""
    if isinstance(raw_wst, list):
        work_shift_types = [t.strip() for t in raw_wst if str(t).strip()]
    else:
        work_shift_types = [t.strip() for t in str(raw_wst).split(',') if t.strip()]

    if not driver_id:
        return json_error("Please select a driver.")

    driver = db.session.get(Driver, driver_id)
    if not driver:
        return json_error("Driver not found.")

    try:
        give_up_date = datetime.strptime(give_up_date_str, "%Y-%m-%d").date()
        work_date = datetime.strptime(work_date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return json_error("Invalid date format.")

    errors = validate_swap(driver, give_up_date, work_date, work_shift_types)
    if errors:
        return jsonify({"success": False, "errors": errors})
    return jsonify({"success": True, "errors": []})


@app.route("/scheduling/swap/add", methods=["POST"])
def add_swap():
    """Add a confirmed single-driver day swap."""
    driver_id = parse_positive_int(request.form.get("driver_id"))
    give_up_date_str = request.form.get("give_up_date", "").strip()
    work_date_str = request.form.get("work_date", "").strip()
    raw_wst = request.form.get("work_shift_type", "").strip()
    work_shift_types = [t.strip() for t in raw_wst.split(',') if t.strip()]
    notes = request.form.get("notes", "").strip()

    if not driver_id:
        flash("Please select a driver.", "error")
        return redirect(url_for("scheduling"))

    driver = Driver.query.get_or_404(driver_id)

    try:
        give_up_date = datetime.strptime(give_up_date_str, "%Y-%m-%d").date()
        work_date = datetime.strptime(work_date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        flash("Invalid date format.", "error")
        return redirect(url_for("scheduling"))

    errors = validate_swap(driver, give_up_date, work_date, work_shift_types)
    if errors:
        for err in errors:
            flash(err, "error")
        return redirect(url_for("scheduling"))

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
    swap = ShiftSwap.query.get_or_404(swap_id)
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

    # -----------------------------------------------------------------------------
    # Entrypoint
    # -----------------------------------------------------------------------------


# -----------------------------------------------------------------------------
# Routes: Extra Cars
# -----------------------------------------------------------------------------

@app.route("/extra-cars")
def extra_cars():
    """Extra car requests management page."""
    all_requests = (
        ExtraCarRequest.query
        .order_by(ExtraCarRequest.date.desc(), ExtraCarRequest.id.desc())
        .all()
    )
    all_drivers = Driver.query.order_by(Driver.driver_number).all()
    all_shift_timings = ShiftTiming.query.order_by(ShiftTiming.shift_type).all()

    # Attach coverage info to each request
    requests_with_coverage = []
    for req in all_requests:
        filled_slots, suggested_status = req.compute_coverage()
        # Auto-update status when it changes (skip CLOSED requests)
        if req.status != 'CLOSED' and suggested_status != req.status:
            req.status = suggested_status
        requests_with_coverage.append({
            'request': req,
            'filled_slots': filled_slots,
        })
    db.session.commit()

    return render_template(
        'extra_cars.html',
        requests_with_coverage=requests_with_coverage,
        all_drivers=all_drivers,
        all_shift_timings=all_shift_timings,
        today=datetime.now().date(),
    )


@app.route("/extra-cars/request/add", methods=["POST"])
def add_extra_car_request():
    """Create a new extra car request."""
    req_type = request.form.get("request_type", "").strip()
    req_date_str = request.form.get("date", "").strip()
    notes = request.form.get("notes", "").strip() or None

    req_date = parse_date_string(req_date_str)
    if not req_date:
        flash("Please provide a valid date.", "error")
        return redirect(url_for("extra_cars"))

    if req_type not in ("shift_type", "time_window"):
        flash("Please select a valid request type.", "error")
        return redirect(url_for("extra_cars"))

    shift_type_val = None
    window_start_val = None
    window_end_val = None

    if req_type == "shift_type":
        shift_type_val = request.form.get("shift_type", "").strip()
        if not shift_type_val:
            flash("Please select a shift type.", "error")
            return redirect(url_for("extra_cars"))
        timing = ShiftTiming.query.filter_by(shift_type=shift_type_val).first()
        if not timing:
            flash("Selected shift type not found.", "error")
            return redirect(url_for("extra_cars"))
    else:
        window_start_val = parse_time_string(request.form.get("window_start", "").strip())
        window_end_val = parse_time_string(request.form.get("window_end", "").strip())
        if not window_start_val or not window_end_val:
            flash("Please provide valid start and end times.", "error")
            return redirect(url_for("extra_cars"))

    unlimited_raw = request.form.get("unlimited", "")
    unlimited = unlimited_raw in ("1", "true", "on", "yes")

    required_slots = None
    if not unlimited:
        required_slots = parse_positive_int(request.form.get("required_slots", ""))
        if not required_slots:
            flash("Please enter a positive number of required slots, or select unlimited.", "error")
            return redirect(url_for("extra_cars"))

    min_partial_raw = request.form.get("min_partial_hours", "2")
    try:
        min_partial_hours = float(min_partial_raw)
        if min_partial_hours < 0:
            raise ValueError
    except (ValueError, TypeError):
        min_partial_hours = 2.0

    new_req = ExtraCarRequest(
        date=req_date,
        request_type=req_type,
        shift_type=shift_type_val,
        window_start=window_start_val,
        window_end=window_end_val,
        unlimited=unlimited,
        required_slots=required_slots,
        min_partial_hours=min_partial_hours,
        status='OPEN',
        notes=notes,
    )
    db.session.add(new_req)
    db.session.commit()

    flash("Extra car request created.", "success")
    return redirect(url_for("extra_cars"))


@app.route("/extra-cars/request/<int:request_id>/delete", methods=["POST"])
def delete_extra_car_request(request_id):
    """Delete an extra car request and its assignments."""
    req = ExtraCarRequest.query.get_or_404(request_id)
    db.session.delete(req)
    db.session.commit()
    flash("Extra car request deleted.", "success")
    return redirect(url_for("extra_cars"))


@app.route("/extra-cars/request/<int:request_id>/status", methods=["POST"])
def update_extra_car_request_status(request_id):
    """Manually update the status of an extra car request."""
    req = ExtraCarRequest.query.get_or_404(request_id)
    new_status = request.form.get("status", "").strip()
    valid_statuses = ("DRAFT", "OPEN", "PARTIALLY_FILLED", "FILLED", "CLOSED")
    if new_status not in valid_statuses:
        flash("Invalid status.", "error")
        return redirect(url_for("extra_cars"))
    req.status = new_status
    db.session.commit()
    flash(f"Request status updated to {new_status.replace('_', ' ').title()}.", "success")
    return redirect(url_for("extra_cars"))


@app.route("/extra-cars/request/<int:request_id>/assignment/validate", methods=["POST"])
def validate_extra_car_assignment_ajax(request_id):
    """AJAX endpoint to validate a proposed extra-car assignment before saving."""
    req = ExtraCarRequest.query.get_or_404(request_id)

    data = request.get_json(silent=True) or request.form
    driver_id = parse_positive_int(data.get("driver_id"))
    start_str = (data.get("start_time") or "").strip()
    end_str = (data.get("end_time") or "").strip()

    if not driver_id:
        return json_error("Please select a driver.")

    driver = db.session.get(Driver, driver_id)
    if not driver:
        return json_error("Driver not found.")

    req_start, req_end = req.get_time_window()
    if not req_start or not req_end:
        return json_error("Request has an invalid or incomplete time window.")

    # Resolve proposed times (fall back to full request window)
    proposed_start = datetime.combine(req.date, parse_time_string(start_str)) if start_str else req_start
    proposed_end = datetime.combine(req.date, parse_time_string(end_str)) if end_str else req_end
    if proposed_end <= proposed_start:
        proposed_end += timedelta(days=1)

    timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}
    is_valid, errors, suggested_start, suggested_end = validate_extra_car_assignment(
        driver, req, proposed_start, proposed_end, timings_dict
    )

    return jsonify({
        "success": True,
        "valid": is_valid,
        "errors": errors,
        "suggested_start": suggested_start.strftime("%H:%M"),
        "suggested_end": suggested_end.strftime("%H:%M"),
    })


@app.route("/extra-cars/request/<int:request_id>/assignment/add", methods=["POST"])
def add_extra_car_assignment(request_id):
    """Add a driver assignment to an extra car request."""
    req = ExtraCarRequest.query.get_or_404(request_id)

    driver_id = parse_positive_int(request.form.get("driver_id"))
    start_str = request.form.get("start_time", "").strip()
    end_str = request.form.get("end_time", "").strip()
    notes = request.form.get("notes", "").strip() or None

    if not driver_id:
        flash("Please select a driver.", "error")
        return redirect(url_for("extra_cars"))

    driver = db.session.get(Driver, driver_id)
    if not driver:
        flash("Driver not found.", "error")
        return redirect(url_for("extra_cars"))

    req_start, req_end = req.get_time_window()
    if not req_start or not req_end:
        flash("Request has an invalid or incomplete time window.", "error")
        return redirect(url_for("extra_cars"))

    start_time = parse_time_string(start_str) if start_str else None
    end_time = parse_time_string(end_str) if end_str else None

    proposed_start = datetime.combine(req.date, start_time) if start_time else req_start
    proposed_end = datetime.combine(req.date, end_time) if end_time else req_end
    if proposed_end <= proposed_start:
        proposed_end += timedelta(days=1)

    timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}
    is_valid, errors, _, _ = validate_extra_car_assignment(
        driver, req, proposed_start, proposed_end, timings_dict
    )

    if not is_valid:
        for err in errors:
            flash(err, "error")
        return redirect(url_for("extra_cars"))

    assignment = ExtraCarAssignment(
        request_id=req.id,
        driver_id=driver.id,
        start_time=start_time,
        end_time=end_time,
        notes=notes,
    )
    db.session.add(assignment)
    db.session.flush()

    # Recompute and persist status
    filled_slots, new_status = req.compute_coverage()
    if req.status != 'CLOSED':
        req.status = new_status

    db.session.commit()

    flash(
        f"{driver.formatted_name()} added to extra car request "
        f"({proposed_start.strftime('%H:%M')}–{proposed_end.strftime('%H:%M')}).",
        "success",
    )
    return redirect(url_for("extra_cars"))


@app.route(
    "/extra-cars/request/<int:request_id>/assignment/<int:assignment_id>/delete",
    methods=["POST"],
)
def delete_extra_car_assignment(request_id, assignment_id):
    """Remove a driver assignment from an extra car request."""
    req = ExtraCarRequest.query.get_or_404(request_id)
    asgn = ExtraCarAssignment.query.filter_by(id=assignment_id, request_id=request_id).first_or_404()

    db.session.delete(asgn)
    db.session.flush()

    filled_slots, new_status = req.compute_coverage()
    if req.status != 'CLOSED':
        req.status = new_status

    db.session.commit()
    flash("Assignment removed.", "success")
    return redirect(url_for("extra_cars"))


if __name__ == "__main__":
    app.run(
        host=app.config.get('HOST', '0.0.0.0'),
        port=app.config.get('PORT', 5000),
        debug=app.config.get('DEBUG', False)
    )
