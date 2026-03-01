# app.py

from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta, date, time
import os
from config import config

app = Flask(__name__)

# Load configuration
config_name = os.environ.get('FLASK_CONFIG') or 'default'
app.config.from_object(config[config_name])

# Ensure data directory exists
os.makedirs(app.config.get('BASE_DIR') / 'data', exist_ok=True)

db = SQLAlchemy(app)

# Clean database models
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
        except:
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
            import json
            return json.loads(self.pattern_data)
        except:
            return []
    
    # Helper method to set pattern data
    def set_pattern_data(self, pattern_list):
        import json
        self.pattern_data = json.dumps(pattern_list)
    
    # Get count of unique drivers assigned to this pattern
    def get_unique_driver_count(self):
        unique_driver_ids = set()
        for assignment in self.assignments:
            unique_driver_ids.add(assignment.driver_id)
        return len(unique_driver_ids)

    # Get unique assigned drivers sorted by numeric driver number
    def get_unique_assigned_drivers_sorted(self):
        unique_drivers = {}
        for assignment in self.assignments:
            if assignment.driver:
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
        pattern = self.get_pattern_data()
        if 0 <= cycle_day < len(pattern):
            return pattern[cycle_day]
        return None

# Add Shift Timing Configuration Model
class ShiftTiming(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    shift_type = db.Column(db.String(20), unique=True, nullable=False)  # 'earlies', 'days', 'lates', 'nights'
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    
    @staticmethod
    def get_default_timings():
        """Get or create default shift timings"""
        default_timings = [
            ('earlies', time(6, 0), time(14, 0)),   # 6 AM - 2 PM
            ('days', time(8, 0), time(16, 0)),      # 8 AM - 4 PM
            ('lates', time(14, 0), time(22, 0)),    # 2 PM - 10 PM
            ('nights', time(22, 0), time(6, 0)),    # 10 PM - 6 AM (next day)
        ]
        
        timings = {}
        for shift_type, start, end in default_timings:
            timing = ShiftTiming.query.filter_by(shift_type=shift_type).first()
            if not timing:
                timing = ShiftTiming(shift_type=shift_type, start_time=start, end_time=end)
                db.session.add(timing)
                db.session.commit()
            timings[shift_type] = timing
        return timings

# Driver Custom Timing Configuration Model
class DriverCustomTiming(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    assignment_id = db.Column(db.Integer, db.ForeignKey('driver_assignment.id'), nullable=True)  # NULL = applies to all assignments
    
    # Override criteria (NULL means "any")
    shift_type = db.Column(db.String(20), nullable=True)  # 'earlies', 'days', 'lates', 'nights', NULL for any
    day_of_cycle = db.Column(db.Integer, nullable=True)   # 0-based day in cycle, NULL for any
    day_of_week = db.Column(db.Integer, nullable=True)    # 0=Monday, 6=Sunday, NULL for any
    
    # Times
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    
    # Priority (lower number = higher priority)
    priority = db.Column(db.Integer, default=100)
    
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
        
        # Find best match based on criteria specificity
        for timing in candidates:
            # Check if this timing matches all criteria
            if timing.shift_type is not None and timing.shift_type != shift_type:
                continue
            if timing.day_of_cycle is not None and timing.day_of_cycle != cycle_day:
                continue
            if timing.day_of_week is not None and timing.day_of_week != weekday:
                continue
            
            # This timing matches - return it
            return timing
        
        return None
        return 'day_off'

class DriverAssignment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    shift_pattern_id = db.Column(db.Integer, db.ForeignKey('shift_pattern.id'), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date)  # Optional - for temporary assignments
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Get shift type for a specific date
    def get_shift_for_date(self, target_date):
        """Get the shift type for a specific date based on the pattern cycle"""
        if target_date < self.start_date:
            return None
        if self.end_date and target_date > self.end_date:
            return None
            
        # Calculate which day of the cycle this date falls on
        days_since_start = (target_date - self.start_date).days
        cycle_day = days_since_start % self.shift_pattern.cycle_length
        
        return self.shift_pattern.get_shift_for_day(cycle_day)

with app.app_context():
    db.create_all()

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

# Add datetime to template context
@app.context_processor
def utility_processor():
    return dict(datetime=datetime)

# Helper functions
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
    except:
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
    return {
        'earlies': len(drivers_by_shift['earlies']),
        'days': len(drivers_by_shift['days']),
        'lates': len(drivers_by_shift['lates']),
        'nights': len(drivers_by_shift['nights'])
    }

def get_drivers_for_date(target_date):
    """Get all drivers working on a specific date with their shift assignments and timing info"""
    drivers_working = {'earlies': [], 'days': [], 'lates': [], 'nights': []}
    
    # Get default timings
    default_timings = ShiftTiming.get_default_timings()
    
    # Get all active driver assignments for the target date
    assignments = DriverAssignment.query.filter(
        DriverAssignment.start_date <= target_date,
        db.or_(
            DriverAssignment.end_date.is_(None),
            DriverAssignment.end_date >= target_date
        )
    ).all()
    
    for assignment in assignments:
        shift_type = assignment.get_shift_for_date(target_date)
        if shift_type and shift_type != 'day_off' and shift_type in drivers_working:
            # Calculate cycle day and weekday for custom timing lookup
            days_since_start = (target_date - assignment.start_date).days
            cycle_day = days_since_start % assignment.shift_pattern.cycle_length
            weekday = target_date.weekday()  # 0=Monday, 6=Sunday
            
            # Check for custom timing
            custom_timing = DriverCustomTiming.get_custom_timing(
                assignment.driver_id, 
                assignment.id, 
                shift_type, 
                cycle_day, 
                weekday
            )
            
            # Get start and end times
            if custom_timing:
                start_time = custom_timing.start_time
                end_time = custom_timing.end_time
                timing_note = custom_timing.notes or "Custom timing"
                is_custom = True
            else:
                timing = default_timings[shift_type]
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
                'timing_note': timing_note
            }
            
            drivers_working[shift_type].append(driver_info)
    
    return drivers_working

def get_week_dates(date_str):
    """Get Monday and Sunday for the week containing the given date"""
    try:
        date = datetime.strptime(date_str, '%Y-%m-%d').date()
        monday = date - timedelta(days=date.weekday())
        sunday = monday + timedelta(days=6)
        return monday, sunday
    except:
        return None, None

# Routes
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
    
    return render_template("index.html", 
                         drivers=drivers,
                         today=today,
                         tomorrow=tomorrow,
                         today_total=today_total,
                         tomorrow_total=tomorrow_total,
                         today_shift_counts=today_shift_counts)

@app.route("/drivers")
def drivers():
    """Manage drivers"""
    from sqlalchemy import cast, Integer
    all_drivers = Driver.query.order_by(cast(Driver.driver_number, Integer)).all()
    return render_template("drivers.html", drivers=all_drivers)

@app.route("/shifts")
def shifts():
    """List all shift patterns and shift type management"""
    all_patterns = ShiftPattern.query.order_by(ShiftPattern.name).all()
    ShiftTiming.get_default_timings()
    all_timings = ShiftTiming.query.order_by(ShiftTiming.start_time, ShiftTiming.shift_type).all()
    timings = {timing.shift_type: timing for timing in all_timings}
    return render_template("shifts.html", patterns=all_patterns, timings=timings, all_timings=all_timings)

@app.route("/shift-types/update", methods=["POST"])
def update_shift_types():
    """Update shift type timings"""
    try:
        processed_shift_types = set()
        for key in request.form.keys():
            if not key.endswith("_start"):
                continue

            shift_type = key[:-6]
            if shift_type in processed_shift_types:
                continue

            start_time_str = request.form.get(f"{shift_type}_start")
            end_time_str = request.form.get(f"{shift_type}_end")

            if not start_time_str or not end_time_str:
                continue

            start_time = datetime.strptime(start_time_str, '%H:%M').time()
            end_time = datetime.strptime(end_time_str, '%H:%M').time()

            timing = ShiftTiming.query.filter_by(shift_type=shift_type).first()
            if timing:
                timing.start_time = start_time
                timing.end_time = end_time
            else:
                timing = ShiftTiming(shift_type=shift_type, start_time=start_time, end_time=end_time)
                db.session.add(timing)

            processed_shift_types.add(shift_type)
        
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)})

@app.route("/shift-types/add", methods=["POST"])
def add_shift_type():
    """Add a new shift type"""
    try:
        shift_type = request.form.get("shift_type", "").strip().lower().replace(" ", "_")
        start_time_str = request.form.get("start_time")
        end_time_str = request.form.get("end_time")

        if not shift_type or not start_time_str or not end_time_str:
            return jsonify({'success': False, 'error': 'All fields are required'})

        if not shift_type.replace("_", "").isalnum():
            return jsonify({'success': False, 'error': 'Shift type can only use letters, numbers, and underscores'})

        existing = ShiftTiming.query.filter_by(shift_type=shift_type).first()
        if existing:
            return jsonify({'success': False, 'error': 'Shift type already exists'})

        start_time = datetime.strptime(start_time_str, '%H:%M').time()
        end_time = datetime.strptime(end_time_str, '%H:%M').time()

        timing = ShiftTiming(shift_type=shift_type, start_time=start_time, end_time=end_time)
        db.session.add(timing)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)})

@app.route("/shift-types/delete/<shift_type>", methods=["POST"])
def delete_shift_type(shift_type):
    """Delete a custom shift type if not in use"""
    try:
        protected_types = {"earlies", "days", "lates", "nights"}
        if shift_type in protected_types:
            return jsonify({'success': False, 'error': 'Default shift types cannot be deleted'})

        patterns = ShiftPattern.query.all()
        for pattern in patterns:
            if shift_type in pattern.get_pattern_data():
                return jsonify({'success': False, 'error': f'Shift type is used in pattern: {pattern.name}'})

        custom_timing = DriverCustomTiming.query.filter_by(shift_type=shift_type).first()
        if custom_timing:
            return jsonify({'success': False, 'error': 'Shift type is used in custom driver timings'})

        timing = ShiftTiming.query.filter_by(shift_type=shift_type).first()
        if not timing:
            return jsonify({'success': False, 'error': 'Shift type not found'})

        db.session.delete(timing)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)})

@app.route("/settings")
def settings():
    """Settings page for shift timings"""
    timings = ShiftTiming.get_default_timings()
    return render_template("settings.html", timings=timings)

@app.route("/settings", methods=["POST"])
def update_settings():
    """Update shift timing settings"""
    try:
        shift_types = ['earlies', 'days', 'lates', 'nights']
        for shift_type in shift_types:
            start_time_str = request.form.get(f"{shift_type}_start")
            end_time_str = request.form.get(f"{shift_type}_end")
            
            if start_time_str and end_time_str:
                start_time = datetime.strptime(start_time_str, '%H:%M').time()
                end_time = datetime.strptime(end_time_str, '%H:%M').time()
                
                timing = ShiftTiming.query.filter_by(shift_type=shift_type).first()
                if timing:
                    timing.start_time = start_time
                    timing.end_time = end_time
                else:
                    timing = ShiftTiming(shift_type=shift_type, start_time=start_time, end_time=end_time)
                    db.session.add(timing)
        
        db.session.commit()
        flash("Shift timings updated successfully!", "success")
    except Exception as e:
        db.session.rollback()
        flash(f"Error updating settings: {str(e)}", "error")
    
    return redirect(url_for("settings"))

@app.route("/shift-pattern/add", methods=["GET", "POST"])
def add_shift_pattern():
    """Add new shift pattern"""
    if request.method == "POST":
        cycle_length = int(request.form.get("cycle_length", 7))
        pattern_data = []
        
        for day in range(cycle_length):
            shift = request.form.get(f"day_{day}_shift", "day_off")
            pattern_data.append(shift)
        
        pattern = ShiftPattern(
            name=request.form.get("name"),
            description=request.form.get("description"),
            cycle_length=cycle_length
        )
        pattern.set_pattern_data(pattern_data)
        
        try:
            db.session.add(pattern)
            db.session.commit()

            is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
            if is_ajax:
                return jsonify({"success": True})

            flash("Shift pattern added successfully!", "success")
            return redirect(url_for("shifts"))
        except Exception as e:
            db.session.rollback()
            is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
            if is_ajax:
                return jsonify({"success": False, "error": str(e)}), 400

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
        pattern.name = request.form.get("name")
        pattern.description = request.form.get("description")
        pattern.cycle_length = int(request.form.get("cycle_length", 7))
        
        # Update pattern data
        pattern_data = []
        for day in range(pattern.cycle_length):
            shift = request.form.get(f"day_{day}_shift", "day_off")
            pattern_data.append(shift)
        pattern.set_pattern_data(pattern_data)
        
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)})

@app.route("/shift-pattern/<int:pattern_id>/delete", methods=["POST"])
def delete_shift_pattern(pattern_id):
    """Delete shift pattern"""
    pattern = ShiftPattern.query.get_or_404(pattern_id)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
    try:
        db.session.delete(pattern)
        db.session.commit()

        if is_ajax:
            return jsonify({"success": True})

        flash("Shift pattern deleted successfully!", "success")
    except Exception as e:
        db.session.rollback()

        if is_ajax:
            return jsonify({"success": False, "error": str(e)}), 400

        flash(f"Error deleting shift pattern: {str(e)}", "error")
    
    return redirect(url_for("shifts"))

@app.route("/driver/<int:driver_id>/assign-pattern", methods=["GET", "POST"])
def assign_pattern_to_driver(driver_id):
    """Assign a shift pattern to a driver"""
    driver = Driver.query.get_or_404(driver_id)
    patterns = ShiftPattern.query.all()
    
    if request.method == "POST":
        start_date = datetime.strptime(request.form.get("start_date"), '%Y-%m-%d').date()
        end_date = datetime.strptime(request.form.get("end_date"), '%Y-%m-%d').date() if request.form.get("end_date") else None
        
        # Find any overlapping assignments that need to be ended
        overlapping_assignments = DriverAssignment.query.filter(
            DriverAssignment.driver_id == driver_id,
            DriverAssignment.start_date < start_date,  # Started before new assignment
            db.or_(
                DriverAssignment.end_date.is_(None),  # Ongoing assignment
                DriverAssignment.end_date >= start_date  # Or ends after new assignment starts
            )
        ).all()
        
        # End all overlapping assignments the day before new one starts
        for assignment in overlapping_assignments:
            assignment.end_date = start_date - timedelta(days=1)
        
        # Create new assignment
        assignment = DriverAssignment(
            driver_id=driver_id,
            shift_pattern_id=int(request.form.get("pattern_id")),
            start_date=start_date,
            end_date=end_date
        )
        
        try:
            db.session.add(assignment)
            db.session.commit()
            flash("Shift pattern assigned successfully!", "success")
            return redirect(url_for("assign_pattern_to_driver", driver_id=driver_id))
        except Exception as e:
            db.session.rollback()
            flash(f"Error assigning pattern: {str(e)}", "error")
    
    return render_template("assign_pattern.html", driver=driver, patterns=patterns, today=date.today())

@app.route("/driver/<int:driver_id>/assignment/<int:assignment_id>/end", methods=["POST"])
def end_assignment(driver_id, assignment_id):
    """End an active driver assignment"""
    driver = Driver.query.get_or_404(driver_id)
    assignment = DriverAssignment.query.get_or_404(assignment_id)
    
    # Verify the assignment belongs to this driver
    if assignment.driver_id != driver_id:
        flash("Invalid assignment", "error")
        return redirect(url_for("drivers"))
    
    # Check if assignment is still active
    if assignment.end_date:
        flash("Assignment is already ended", "error")
        return redirect(url_for("assign_pattern_to_driver", driver_id=driver_id))
    
    try:
        # Set end date to today
        assignment.end_date = datetime.now().date()
        
        # Check if there was a previous assignment that was ended because of this one
        # Look for assignments that ended the day before this one started
        previous_assignment = DriverAssignment.query.filter(
            DriverAssignment.driver_id == driver_id,
            DriverAssignment.end_date == assignment.start_date - timedelta(days=1),
            DriverAssignment.id != assignment_id
        ).order_by(DriverAssignment.start_date.desc()).first()
        
        # If found, restore it to ongoing (remove end date)
        if previous_assignment:
            previous_assignment.end_date = None
            flash(f"Assignment ended and previous pattern '{previous_assignment.shift_pattern.name}' restored for {driver.formatted_name()}", "success")
        else:
            flash(f"Assignment ended successfully for {driver.formatted_name()}", "success")
            
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        flash(f"Error ending assignment: {str(e)}", "error")
    
    return redirect(url_for("assign_pattern_to_driver", driver_id=driver_id))

@app.route("/driver/<int:driver_id>/assignment/<int:assignment_id>/delete", methods=["POST"])
def delete_assignment(driver_id, assignment_id):
    """Delete a driver assignment completely"""
    driver = Driver.query.get_or_404(driver_id)
    assignment = DriverAssignment.query.get_or_404(assignment_id)
    
    # Verify the assignment belongs to this driver
    if assignment.driver_id != driver_id:
        flash("Invalid assignment", "error")
        return redirect(url_for("drivers"))
    
    try:
        # Check if this assignment auto-ended a previous one and restore it
        previous_assignment = DriverAssignment.query.filter(
            DriverAssignment.driver_id == driver_id,
            DriverAssignment.end_date == assignment.start_date - timedelta(days=1),
            DriverAssignment.id != assignment_id
        ).order_by(DriverAssignment.start_date.desc()).first()
        
        pattern_name = assignment.shift_pattern.name
        
        # Delete the assignment
        db.session.delete(assignment)
        
        # Restore previous assignment if it was auto-ended
        if previous_assignment:
            previous_assignment.end_date = None
            flash(f"Assignment '{pattern_name}' deleted and previous pattern '{previous_assignment.shift_pattern.name}' restored for {driver.formatted_name()}", "success")
        else:
            flash(f"Assignment '{pattern_name}' deleted successfully for {driver.formatted_name()}", "success")
            
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        flash(f"Error deleting assignment: {str(e)}", "error")
    
    return redirect(url_for("assign_pattern_to_driver", driver_id=driver_id))

@app.route("/driver/add", methods=["GET", "POST"])
def add_driver():
    """Add new driver"""
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
            flash("Driver added successfully!", "success")
            return redirect(url_for("drivers"))
        except Exception as e:
            db.session.rollback()
            flash(f"Error adding driver: {str(e)}", "error")
    
    return render_template("add_driver.html")

@app.route("/driver/<int:driver_id>/edit", methods=["GET", "POST"])
def edit_driver(driver_id):
    """Edit existing driver"""
    driver = Driver.query.get_or_404(driver_id)
    
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
            flash("Driver updated successfully!", "success")
            return redirect(url_for("drivers"))
        except Exception as e:
            db.session.rollback()
            flash(f"Error updating driver: {str(e)}", "error")
    
    return render_template("edit_driver.html", driver=driver)

@app.route("/driver/<int:driver_id>/delete", methods=["POST"])
def delete_driver(driver_id):
    """Delete driver"""
    driver = Driver.query.get_or_404(driver_id)
    try:
        db.session.delete(driver)
        db.session.commit()
        flash("Driver deleted successfully!", "success")
    except Exception as e:
        db.session.rollback()
        flash(f"Error deleting driver: {str(e)}", "error")
    
    return redirect(url_for("drivers"))

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
    except:
        flash("Invalid date format", "error")
        return redirect(url_for("daily_sheet_form"))
    
    drivers_by_shift = get_drivers_for_date(target_date)
    
    return render_template("daily_sheet.html", 
                         target_date=target_date, 
                         drivers_by_shift=drivers_by_shift)

@app.route("/daily-sheet/print")
def print_daily_sheet():
    """Print-friendly daily shift sheet"""
    target_date_str = request.args.get("date")
    
    try:
        target_date = datetime.strptime(target_date_str, '%Y-%m-%d').date()
    except:
        flash("Invalid date format", "error")
        return redirect(url_for("daily_sheet_form"))
    
    drivers_by_shift = get_drivers_for_date(target_date)
    
    return render_template("print_daily_sheet.html", 
                         target_date=target_date, 
                         drivers_by_shift=drivers_by_shift)

def get_cars_working_at_time(target_date, target_time):
    """Get count of cars working at a specific date and time"""
    from datetime import datetime, timedelta
    
    # Get all active assignments for the target date
    assignments = DriverAssignment.query.filter(
        DriverAssignment.start_date <= target_date,
        db.or_(
            DriverAssignment.end_date.is_(None),
            DriverAssignment.end_date >= target_date
        )
    ).all()
    
    # Get default shift timings
    default_timings = ShiftTiming.get_default_timings()
    
    cars_working = 0
    for assignment in assignments:
        # Get the shift type for this date
        shift_type = assignment.get_shift_for_date(target_date)
        
        if shift_type and shift_type != 'day_off' and shift_type in default_timings:
            # Calculate cycle day and weekday for custom timing lookup
            days_since_start = (target_date - assignment.start_date).days
            cycle_day = days_since_start % assignment.shift_pattern.cycle_length
            weekday = target_date.weekday()  # 0=Monday, 6=Sunday
            
            # Check for custom timing first
            custom_timing = DriverCustomTiming.get_custom_timing(
                assignment.driver_id, 
                assignment.id, 
                shift_type, 
                cycle_day, 
                weekday
            )
            
            if custom_timing:
                # Use custom timing
                start_time = custom_timing.start_time
                end_time = custom_timing.end_time
            else:
                # Use default timing
                timing = default_timings[shift_type]
                start_time = timing.start_time
                end_time = timing.end_time
            
            # Handle overnight shifts (when end time is before start time)
            if end_time < start_time:  # Night shift case
                # Check if target time is after start OR before end (next day)
                if target_time >= start_time or target_time < end_time:
                    cars_working += 1
            else:  # Regular day shift
                # Check if target time is between start and end
                if start_time <= target_time < end_time:
                    cars_working += 1
    
    return cars_working

@app.route("/cars-working", methods=["GET", "POST"])
def cars_working():
    """Page to check how many cars are working at a specific time"""
    if request.method == "POST":
        try:
            date_str = request.form.get("date")
            time_str = request.form.get("time")
            
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            target_time = datetime.strptime(time_str, '%H:%M').time()
            
            car_count = get_cars_working_at_time(target_date, target_time)
            
            return render_template("cars_working.html", 
                                 date=target_date, 
                                 time=target_time, 
                                 car_count=car_count,
                                 timings=ShiftTiming.get_default_timings())
        except Exception as e:
            flash(f"Error calculating cars working: {str(e)}", "error")
    
    return render_template("cars_working.html", timings=ShiftTiming.get_default_timings())

@app.route("/driver/<int:driver_id>/custom-timings")
def driver_custom_timings(driver_id):
    """Manage custom timings for a specific driver"""
    driver = Driver.query.get_or_404(driver_id)
    timings = DriverCustomTiming.query.filter_by(driver_id=driver_id).order_by(DriverCustomTiming.priority).all()
    return render_template("driver_custom_timings.html", driver=driver, timings=timings)

@app.route("/driver/<int:driver_id>/custom-timings/add", methods=["GET", "POST"])
def add_custom_timing(driver_id):
    """Add a new custom timing for a driver"""
    driver = Driver.query.get_or_404(driver_id)
    
    if request.method == "POST":
        try:
            # Parse form data
            assignment_id = request.form.get("assignment_id") or None
            shift_type = request.form.get("shift_type") or None
            day_of_cycle = request.form.get("day_of_cycle")
            day_of_week = request.form.get("day_of_week") or None
            start_time_str = request.form.get("start_time")
            end_time_str = request.form.get("end_time")
            priority = int(request.form.get("priority", 100))
            notes = request.form.get("notes")
            
            # Convert times
            start_time = datetime.strptime(start_time_str, '%H:%M').time()
            end_time = datetime.strptime(end_time_str, '%H:%M').time()
            
            # Convert day_of_cycle to int or None
            day_of_cycle = int(day_of_cycle) if day_of_cycle else None
            day_of_week = int(day_of_week) if day_of_week else None
            assignment_id = int(assignment_id) if assignment_id else None
            
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
            return redirect(url_for("driver_custom_timings", driver_id=driver_id))
            
        except Exception as e:
            db.session.rollback()
            flash(f"Error adding custom timing: {str(e)}", "error")
    
    # Get driver assignments for dropdown
    assignments = DriverAssignment.query.filter_by(driver_id=driver_id).all()
    return render_template("add_custom_timing.html", driver=driver, assignments=assignments)

@app.route("/custom-timing/<int:timing_id>/delete", methods=["POST"])
def delete_custom_timing(timing_id):
    """Delete a custom timing"""
    timing = DriverCustomTiming.query.get_or_404(timing_id)
    driver_id = timing.driver_id
    
    try:
        db.session.delete(timing)
        db.session.commit()
        flash("Custom timing deleted successfully!", "success")
    except Exception as e:
        db.session.rollback()
        flash(f"Error deleting timing: {str(e)}", "error")
    
    return redirect(url_for("driver_custom_timings", driver_id=driver_id))

if __name__ == "__main__":
    app.run(
        host=app.config.get('HOST', '0.0.0.0'),
        port=app.config.get('PORT', 5000),
        debug=app.config.get('DEBUG', False)
    )
