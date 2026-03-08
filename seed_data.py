#!/usr/bin/env python3
"""
Seed data script - populate the database with initial test data.
Edit this file to add your drivers, shift types, and patterns.
"""

from app import app, db
from app import Driver, ShiftPattern, ShiftTiming, DriverAssignment
from datetime import date, time
import json

def seed_database():
    with app.app_context():
        print("Starting database seed...")
        
        # Create shift timings first
        timings = [
            ShiftTiming(
                shift_type='morning',
                display_name='Morning',
                start_time=time(6, 0),
                end_time=time(14, 0),
                badge_color='bg-warning',
                icon='fas fa-sun'
            ),
            ShiftTiming(
                shift_type='afternoon',
                display_name='Afternoon',
                start_time=time(14, 0),
                end_time=time(22, 0),
                badge_color='bg-info',
                icon='fas fa-cloud-sun'
            ),
            ShiftTiming(
                shift_type='night',
                display_name='Night',
                start_time=time(22, 0),
                end_time=time(6, 0),
                badge_color='bg-dark',
                icon='fas fa-moon'
            ),
        ]
        
        for timing in timings:
            existing = ShiftTiming.query.filter_by(shift_type=timing.shift_type).first()
            if not existing:
                db.session.add(timing)
                print(f"✓ Added shift timing: {timing.display_name}")
        
        db.session.commit()
        
        # Create shift patterns
        patterns = [
            {
                'name': '5 Days Working',
                'cycle_length': 7,
                'pattern_data': ['morning', 'morning', 'morning', 'morning', 'morning', 'day_off', 'day_off']
            },
            {
                'name': '4 On 3 Off',
                'cycle_length': 7,
                'pattern_data': ['afternoon', 'afternoon', 'afternoon', 'afternoon', 'day_off', 'day_off', 'day_off']
            },
        ]
        
        for p in patterns:
            existing = ShiftPattern.query.filter_by(name=p['name']).first()
            if not existing:
                pattern = ShiftPattern(
                    name=p['name'],
                    cycle_length=p['cycle_length'],
                    pattern_data=json.dumps(p['pattern_data'])
                )
                db.session.add(pattern)
                print(f"✓ Added pattern: {p['name']}")
        
        db.session.commit()
        
        # Create example drivers
        drivers = [
            {'driver_number': '101', 'name': 'John Smith', 'car_type': 'Standard'},
            {'driver_number': '102', 'name': 'Jane Doe', 'car_type': 'Estate'},
            {'driver_number': '103', 'name': 'Bob Wilson', 'car_type': 'XL Estate'},
        ]
        
        for d in drivers:
            existing = Driver.query.filter_by(driver_number=d['driver_number']).first()
            if not existing:
                driver = Driver(
                    driver_number=d['driver_number'],
                    name=d['name'],
                    car_type=d['car_type'],
                    school_badge=False,
                    pet_friendly=False
                )
                db.session.add(driver)
                print(f"✓ Added driver: {d['name']}")
        
        db.session.commit()
        
        print("\n✅ Database seeded successfully!")
        print(f"   Drivers: {Driver.query.count()}")
        print(f"   Patterns: {ShiftPattern.query.count()}")
        print(f"   Shift Timings: {ShiftTiming.query.count()}")

if __name__ == '__main__':
    seed_database()
