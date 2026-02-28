# app.py

from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
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
    
    # Get what shift type for a specific day in the cycle
    def get_shift_for_day(self, cycle_day):
        pattern = self.get_pattern_data()
        if 0 <= cycle_day < len(pattern):
            return pattern[cycle_day]
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
    """Get all drivers working on a specific date with their shift assignments"""
    drivers_working = {'earlies': [], 'days': [], 'lates': [], 'nights': []}
    
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
            drivers_working[shift_type].append(assignment.driver)
    
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
    all_drivers = Driver.query.order_by(Driver.driver_number).all()
    return render_template("drivers.html", drivers=all_drivers)

@app.route("/shifts")
def shifts():
    """List all shift patterns"""
    all_patterns = ShiftPattern.query.order_by(ShiftPattern.name).all()
    return render_template("shifts.html", patterns=all_patterns)

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
            flash("Shift pattern added successfully!", "success")
            return redirect(url_for("shifts"))
        except Exception as e:
            db.session.rollback()
            flash(f"Error adding shift pattern: {str(e)}", "error")
    
    return render_template("add_shift_pattern.html")

@app.route("/shift-pattern/<int:pattern_id>/delete", methods=["POST"])
def delete_shift_pattern(pattern_id):
    """Delete shift pattern"""
    pattern = ShiftPattern.query.get_or_404(pattern_id)
    try:
        db.session.delete(pattern)
        db.session.commit()
        flash("Shift pattern deleted successfully!", "success")
    except Exception as e:
        db.session.rollback()
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
            return redirect(url_for("drivers"))
        except Exception as e:
            db.session.rollback()
            flash(f"Error assigning pattern: {str(e)}", "error")
    
    return render_template("assign_pattern.html", driver=driver, patterns=patterns)

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

if __name__ == "__main__":
    app.run(
        host=app.config.get('HOST', '0.0.0.0'),
        port=app.config.get('PORT', 5000),
        debug=app.config.get('DEBUG', False)
    )
