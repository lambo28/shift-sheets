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

# Enhanced database models
class Driver(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_number = db.Column(db.String(50), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20))
    email = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship to shifts
    shifts = db.relationship('ShiftSheet', backref='driver', lazy=True)

class ShiftSheet(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('driver.id'), nullable=False)
    week_starting = db.Column(db.Date, nullable=False)
    week_ending = db.Column(db.Date, nullable=False) 
    total_hours = db.Column(db.Float, default=0.0)
    total_miles = db.Column(db.Float, default=0.0)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship to daily entries
    daily_entries = db.relationship('DailyEntry', backref='shift_sheet', lazy=True, cascade='all, delete-orphan')

class DailyEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    shift_sheet_id = db.Column(db.Integer, db.ForeignKey('shift_sheet.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    start_time = db.Column(db.String(10))  # HH:MM format
    end_time = db.Column(db.String(10))    # HH:MM format
    break_time = db.Column(db.Integer, default=0)  # minutes
    hours_worked = db.Column(db.Float, default=0.0)
    mileage_start = db.Column(db.Integer)
    mileage_end = db.Column(db.Integer)
    miles_driven = db.Column(db.Float, default=0.0)
    route = db.Column(db.String(200))
    notes = db.Column(db.Text)

# ✅ Create tables inside application context
with app.app_context():
    db.create_all()

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
    """Main dashboard showing recent shifts"""
    recent_shifts = ShiftSheet.query.order_by(ShiftSheet.created_at.desc()).limit(10).all()
    drivers = Driver.query.all()
    return render_template("index.html", recent_shifts=recent_shifts, drivers=drivers)

@app.route("/drivers")
def drivers():
    """Manage drivers"""
    all_drivers = Driver.query.order_by(Driver.driver_number).all()
    return render_template("drivers.html", drivers=all_drivers)

@app.route("/driver/add", methods=["GET", "POST"])
def add_driver():
    """Add new driver"""
    if request.method == "POST":
        driver = Driver(
            driver_number=request.form.get("driver_number"),
            name=request.form.get("name"),
            phone=request.form.get("phone", ""),
            email=request.form.get("email", "")
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

@app.route("/shift/new")
def new_shift():
    """Create new shift sheet"""
    drivers = Driver.query.order_by(Driver.driver_number).all()
    return render_template("new_shift.html", drivers=drivers)

@app.route("/shift/create", methods=["POST"])
def create_shift():
    """Create new shift sheet"""
    driver_id = request.form.get("driver_id")
    week_date = request.form.get("week_date")
    
    monday, sunday = get_week_dates(week_date)
    if not monday or not sunday:
        flash("Invalid date format", "error")
        return redirect(url_for("new_shift"))
    
    # Check if shift already exists for this driver and week
    existing = ShiftSheet.query.filter_by(
        driver_id=driver_id, 
        week_starting=monday
    ).first()
    
    if existing:
        flash("Shift sheet already exists for this driver and week", "error")
        return redirect(url_for("view_shift", shift_id=existing.id))
    
    # Create new shift sheet
    shift = ShiftSheet(
        driver_id=driver_id,
        week_starting=monday,
        week_ending=sunday
    )
    
    db.session.add(shift)
    db.session.commit()
    
    # Create daily entries for the week
    current_date = monday
    for i in range(7):
        daily_entry = DailyEntry(
            shift_sheet_id=shift.id,
            date=current_date
        )
        db.session.add(daily_entry)
        current_date += timedelta(days=1)
    
    db.session.commit()
    flash("Shift sheet created successfully!", "success")
    return redirect(url_for("edit_shift", shift_id=shift.id))

@app.route("/shift/<int:shift_id>")
def view_shift(shift_id):
    """View shift sheet"""
    shift = ShiftSheet.query.get_or_404(shift_id)
    daily_entries = DailyEntry.query.filter_by(shift_sheet_id=shift_id).order_by(DailyEntry.date).all()
    return render_template("view_shift.html", shift=shift, daily_entries=daily_entries)

@app.route("/shift/<int:shift_id>/edit")
def edit_shift(shift_id):
    """Edit shift sheet"""
    shift = ShiftSheet.query.get_or_404(shift_id)
    daily_entries = DailyEntry.query.filter_by(shift_sheet_id=shift_id).order_by(DailyEntry.date).all()
    return render_template("edit_shift.html", shift=shift, daily_entries=daily_entries)

@app.route("/shift/<int:shift_id>/update", methods=["POST"])
def update_shift(shift_id):
    """Update shift sheet data"""
    shift = ShiftSheet.query.get_or_404(shift_id)
    
    # Update shift notes
    shift.notes = request.form.get("shift_notes", "")
    
    # Update daily entries
    daily_entries = DailyEntry.query.filter_by(shift_sheet_id=shift_id).all()
    
    total_hours = 0.0
    total_miles = 0.0
    
    for entry in daily_entries:
        entry_id = str(entry.id)
        
        entry.start_time = request.form.get(f"start_time_{entry_id}", "")
        entry.end_time = request.form.get(f"end_time_{entry_id}", "")
        entry.break_time = int(request.form.get(f"break_time_{entry_id}", 0) or 0)
        entry.mileage_start = int(request.form.get(f"mileage_start_{entry_id}") or 0)
        entry.mileage_end = int(request.form.get(f"mileage_end_{entry_id}") or 0)
        entry.route = request.form.get(f"route_{entry_id}", "")
        entry.notes = request.form.get(f"notes_{entry_id}", "")
        
        # Calculate hours and miles
        if entry.start_time and entry.end_time:
            entry.hours_worked = calculate_hours(entry.start_time, entry.end_time, entry.break_time)
            total_hours += entry.hours_worked
        
        if entry.mileage_start and entry.mileage_end:
            entry.miles_driven = max(0, entry.mileage_end - entry.mileage_start)
            total_miles += entry.miles_driven
    
    # Update totals
    shift.total_hours = total_hours
    shift.total_miles = total_miles
    
    try:
        db.session.commit()
        flash("Shift sheet updated successfully!", "success")
    except Exception as e:
        db.session.rollback()
        flash(f"Error updating shift sheet: {str(e)}", "error")
    
    return redirect(url_for("view_shift", shift_id=shift_id))

@app.route("/shift/<int:shift_id>/print")
def print_shift(shift_id):
    """Print-friendly view of shift sheet"""
    shift = ShiftSheet.query.get_or_404(shift_id)
    daily_entries = DailyEntry.query.filter_by(shift_sheet_id=shift_id).order_by(DailyEntry.date).all()
    return render_template("print_shift.html", shift=shift, daily_entries=daily_entries)

@app.route("/shift/<int:shift_id>/delete", methods=["POST"])
def delete_shift(shift_id):
    """Delete shift sheet"""
    shift = ShiftSheet.query.get_or_404(shift_id)
    try:
        db.session.delete(shift)
        db.session.commit()
        flash("Shift sheet deleted successfully!", "success")
    except Exception as e:
        db.session.rollback()
        flash(f"Error deleting shift sheet: {str(e)}", "error")
    
    return redirect(url_for("index"))

if __name__ == "__main__":
    app.run(
        host=app.config.get('HOST', '0.0.0.0'),
        port=app.config.get('PORT', 5000),
        debug=app.config.get('DEBUG', False)
    )
