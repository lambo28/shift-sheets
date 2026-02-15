# app.py

from flask import Flask, render_template, request, redirect
from flask_sqlalchemy import SQLAlchemy
import os

app = Flask(__name__)

# SQLite database in data folder
db_path = os.path.join("data", "shifts.db")
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{db_path}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Simple table for shift entries
class ShiftEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_number = db.Column(db.String(50))
    shift_start_date = db.Column(db.String(20))
    shift_cycle_days = db.Column(db.Integer)

# ✅ Create tables inside application context
with app.app_context():
    db.create_all()

# Routes
@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        driver = request.form.get("driverNumber")
        start_date = request.form.get("shiftStartDate")
        cycle_days = request.form.get("shiftCycleDays")

        entry = ShiftEntry(
            driver_number=driver,
            shift_start_date=start_date,
            shift_cycle_days=cycle_days
        )
        db.session.add(entry)
        db.session.commit()
        return redirect("/")

    return render_template("index.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
