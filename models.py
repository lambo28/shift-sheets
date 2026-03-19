from __future__ import annotations
import json
from datetime import datetime, timedelta, time, UTC

from extensions import db
from constants import EXTRA_CAR_MIN_PARTIAL_HOURS


def utc_now():
    """Return the current UTC timestamp as a naive datetime for DB storage."""
    return datetime.now(UTC).replace(tzinfo=None)


def resolve_request_relative_datetime(req_start_dt, req_end_dt, time_value):
    """Resolve a time-of-day into the correct datetime inside a request window span.

    For overnight windows (e.g. 16:00–02:00), times earlier than request start
    belong to the next day (01:00 -> next day 01:00).
    """
    candidate = datetime.combine(req_start_dt.date(), time_value)
    is_overnight_window = req_end_dt.date() > req_start_dt.date()
    if is_overnight_window and candidate < req_start_dt:
        candidate += timedelta(days=1)
    return candidate


class Driver(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_number = db.Column(db.String(50), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    car_type = db.Column(db.String(100), nullable=False)  # Standard, Estate, XL Estate, Minibus
    school_badge = db.Column(db.Boolean, default=False)
    pet_friendly = db.Column(db.Boolean, default=False)
    assistance_guide_dogs_exempt = db.Column(db.Boolean, default=False)
    electric_vehicle = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=utc_now)

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
    created_at = db.Column(db.DateTime, default=utc_now)

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


class ShiftTiming(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    shift_type = db.Column(db.String(50), unique=True, nullable=False)  # user-defined name, up to 50 chars
    display_name = db.Column(db.String(100), nullable=True)  # user-facing name (can keep spaces/case)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    badge_color = db.Column(db.String(50), default='bg-primary')  # Bootstrap badge color class
    icon = db.Column(db.String(100), default='fas fa-clock')  # Font Awesome icon class
    parent_shift_type = db.Column(db.String(50), nullable=True)  # If set, this is a sub-shift grouped under parent
    school_term_only = db.Column(db.Boolean, default=False, nullable=False)

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
    created_at = db.Column(db.DateTime, default=utc_now)

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
    created_at = db.Column(db.DateTime, default=utc_now)

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


class DriverHoliday(db.Model):
    """Records time off dates for a driver (holiday, sickness, VOR, etc)."""
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    holiday_date = db.Column(db.Date, nullable=False)
    time_off_type = db.Column(db.String(20), nullable=False, default='holiday')  # holiday, sickness, vor, other
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now)

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
    created_at = db.Column(db.DateTime, default=utc_now)

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
    created_at = db.Column(db.DateTime, default=utc_now)

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


class SchoolTerm(db.Model):
    """Global school term date ranges."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now)


class SchoolClosureDate(db.Model):
    """Global school-closed days (e.g., bank holidays and training days)."""
    id = db.Column(db.Integer, primary_key=True)
    closure_date = db.Column(db.Date, nullable=False)
    closure_type = db.Column(db.String(30), nullable=False)  # bank_holiday | training_day
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now)

    __table_args__ = (
        db.UniqueConstraint('closure_date', 'closure_type', name='uq_school_closure_date_type'),
    )


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
    created_at = db.Column(db.DateTime, default=utc_now)

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

    def _get_valid_coverage_intervals(self):
        """Return (req_start, req_end, valid_intervals) for coverage/capacity checks."""
        req_start, req_end = self.get_time_window()
        if not req_start or not req_end:
            return None, None, []

        min_hours = EXTRA_CAR_MIN_PARTIAL_HOURS
        valid = []
        for asgn in self.assignments:
            asgn_start = (
                resolve_request_relative_datetime(req_start, req_end, asgn.start_time)
                if asgn.start_time else req_start
            )
            asgn_end = (
                resolve_request_relative_datetime(req_start, req_end, asgn.end_time)
                if asgn.end_time else req_end
            )
            if asgn_end <= asgn_start:
                asgn_end += timedelta(days=1)
            eff_start = max(asgn_start, req_start)
            eff_end = min(asgn_end, req_end)
            if eff_end <= eff_start:
                continue
            if (eff_end - eff_start).total_seconds() / 3600 < min_hours:
                continue
            valid.append((eff_start, eff_end))

        return req_start, req_end, valid

    def get_available_capacity_segments(self):
        """Return list of uncovered capacity segments as (start_dt, end_dt)."""
        req_start, req_end, valid = self._get_valid_coverage_intervals()
        if not req_start or not req_end:
            return []

        if self.unlimited:
            return [(req_start, req_end)]

        required = self.required_slots or 0
        if required <= 0:
            return [(req_start, req_end)]

        min_hours = EXTRA_CAR_MIN_PARTIAL_HOURS
        breakpoints = {req_start, req_end}
        for asgn_start, asgn_end in valid:
            breakpoints.add(asgn_start)
            breakpoints.add(asgn_end)

        ordered = sorted(breakpoints)
        raw_available_segments = []
        for index in range(len(ordered) - 1):
            segment_start = ordered[index]
            segment_end = ordered[index + 1]
            if segment_end <= segment_start:
                continue
            midpoint = segment_start + (segment_end - segment_start) / 2
            active = sum(1 for s, e in valid if s <= midpoint < e)
            if active < required:
                raw_available_segments.append((segment_start, segment_end))

        if not raw_available_segments:
            return []

        merged = [raw_available_segments[0]]
        for segment_start, segment_end in raw_available_segments[1:]:
            prev_start, prev_end = merged[-1]
            if segment_start <= prev_end:
                merged[-1] = (prev_start, max(prev_end, segment_end))
            else:
                merged.append((segment_start, segment_end))

        # Only segments that are at least min_partial_hours are practically allocatable.
        return [
            (segment_start, segment_end)
            for segment_start, segment_end in merged
            if (segment_end - segment_start).total_seconds() / 3600 >= min_hours
        ]

    def get_recommended_available_window(self):
        """Return best available segment (start_dt, end_dt) for a new assignment."""
        segments = self.get_available_capacity_segments()
        if not segments:
            return None, None

        min_hours = EXTRA_CAR_MIN_PARTIAL_HOURS
        eligible = [
            (s, e)
            for s, e in segments
            if (e - s).total_seconds() / 3600 >= min_hours
        ]
        candidates = eligible or segments
        best = max(candidates, key=lambda item: (item[1] - item[0]).total_seconds())
        return best

    def compute_coverage(self):
        """
                Compute how many slot lanes are fully covered for the whole request window.

                Coverage model:
                - Only assignments whose effective overlap with the request window is >= min_partial_hours count.
                - ``filled_slots`` equals the minimum number of active assignments across the entire
                    request window (i.e., full continuous slot coverage).
                - Any valid assignment activity (even if not continuous) yields PARTIALLY_FILLED status.
                - Returns (filled_slots, suggested_status).
        """
        req_start, req_end, valid = self._get_valid_coverage_intervals()
        if not req_start or not req_end:
            return 0, self.status

        now = datetime.now()
        if req_end <= now:
            return 0, 'CLOSED'

        min_hours = EXTRA_CAR_MIN_PARTIAL_HOURS

        if not valid:
            filled_slots = 0
            has_any_coverage = False
        else:
            # Build timeline segments and count active assignments in each segment.
            breakpoints = {req_start, req_end}
            for asgn_start, asgn_end in valid:
                breakpoints.add(asgn_start)
                breakpoints.add(asgn_end)

            ordered = sorted(breakpoints)
            segments = []
            for index in range(len(ordered) - 1):
                segment_start = ordered[index]
                segment_end = ordered[index + 1]
                if segment_end <= segment_start:
                    continue
                midpoint = segment_start + (segment_end - segment_start) / 2
                active = sum(1 for s, e in valid if s <= midpoint < e)
                segments.append((segment_start, segment_end, active))

            segment_counts = [active for _, _, active in segments]

            def has_significant_deficit(threshold):
                deficit_start = None
                deficit_end = None
                for segment_start, segment_end, active in segments:
                    if active < threshold:
                        if deficit_start is None:
                            deficit_start = segment_start
                        deficit_end = segment_end
                    elif deficit_start is not None:
                        hours = (deficit_end - deficit_start).total_seconds() / 3600
                        if hours >= min_hours:
                            return True
                        deficit_start = None
                        deficit_end = None

                if deficit_start is not None:
                    hours = (deficit_end - deficit_start).total_seconds() / 3600
                    if hours >= min_hours:
                        return True
                return False

            has_any_coverage = any(count > 0 for count in segment_counts)

            max_active = max(segment_counts) if segment_counts else 0
            filled_slots = 0
            for threshold in range(1, max_active + 1):
                if has_significant_deficit(threshold):
                    break
                filled_slots = threshold

        if self.status == 'CLOSED':
            return filled_slots, 'CLOSED'

        if self.unlimited:
            new_status = 'PARTIALLY_FILLED' if has_any_coverage else 'OPEN'
        else:
            required = self.required_slots or 0
            if filled_slots >= required > 0:
                new_status = 'FILLED'
            elif has_any_coverage:
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
    created_at = db.Column(db.DateTime, default=utc_now)

    request = db.relationship('ExtraCarRequest', back_populates='assignments')
    driver = db.relationship('Driver', backref=db.backref('extra_assignments', lazy=True))

    def effective_start(self):
        """Return the effective start datetime for this assignment."""
        req_start, req_end = self.request.get_time_window()
        if self.start_time and req_start:
            return resolve_request_relative_datetime(req_start, req_end, self.start_time)
        return req_start

    def effective_end(self):
        """Return the effective end datetime for this assignment."""
        req_start, req_end = self.request.get_time_window()
        if self.end_time and req_end:
            return resolve_request_relative_datetime(req_start, req_end, self.end_time)
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


class AppSetting(db.Model):
    """Simple key-value store for lightweight app-wide settings."""
    __tablename__ = 'app_setting'

    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.String(255), nullable=False)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)


# These must come AFTER model definitions since normalize_day_shifts uses ShiftTiming.query

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


def iter_pattern_shift_types(pattern_data):
    """Yield all working shift types used by a pattern, including multi-shift days."""
    for day_entry in pattern_data:
        for shift_type in normalize_day_shifts(day_entry):
            if shift_type != 'day_off':
                yield shift_type
