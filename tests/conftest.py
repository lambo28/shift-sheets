"""
tests/conftest.py
Shared pytest fixtures for shift-sheets tests.
"""
import json
import pytest
from datetime import date, time

from app import app as flask_app, db as _db
from app import (
    Driver, ShiftPattern, ShiftTiming, DriverAssignment,
    DriverHoliday, ShiftAdjustment, ShiftSwap,
)


@pytest.fixture(scope='session')
def app():
    flask_app.config.update({
        'TESTING': True,
        'SQLALCHEMY_DATABASE_URI': 'sqlite:///:memory:',
        'WTF_CSRF_ENABLED': False,
        'SECRET_KEY': 'test-secret',
    })
    with flask_app.app_context():
        _db.create_all()
        yield flask_app
        _db.drop_all()


@pytest.fixture(scope='function')
def db(app):
    """Provide a fresh database session per test."""
    with app.app_context():
        _db.session.remove()
        # Truncate all tables
        for table in reversed(_db.metadata.sorted_tables):
            _db.session.execute(table.delete())
        _db.session.commit()
        yield _db
        _db.session.remove()


@pytest.fixture(scope='function')
def client(app, db):
    return app.test_client()


# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

def make_driver(db, driver_number='1', name='Test Driver'):
    d = Driver(
        driver_number=driver_number,
        name=name,
        car_type='Standard',
    )
    db.session.add(d)
    db.session.commit()
    return d


def make_shift_timing(db, shift_type='morning', start='06:00', end='14:00', parent_shift_type=None):
    st = ShiftTiming(
        shift_type=shift_type,
        display_name=shift_type.replace('_', ' ').title(),
        start_time=time.fromisoformat(start),
        end_time=time.fromisoformat(end),
        badge_color='bg-primary',
        icon='fas fa-clock',
        parent_shift_type=parent_shift_type,
    )
    db.session.add(st)
    db.session.commit()
    return st


def make_pattern(db, name='Day Pattern', cycle_length=7, pattern_data=None):
    if pattern_data is None:
        pattern_data = ['morning', 'morning', 'morning', 'morning', 'morning', 'day_off', 'day_off']
    p = ShiftPattern(
        name=name,
        cycle_length=cycle_length,
        pattern_data=json.dumps(pattern_data),
    )
    db.session.add(p)
    db.session.commit()
    return p


def make_assignment(db, driver, pattern, start_date, end_date=None, start_day_of_cycle=1):
    a = DriverAssignment(
        driver_id=driver.id,
        shift_pattern_id=pattern.id,
        start_date=start_date,
        end_date=end_date,
        start_day_of_cycle=start_day_of_cycle,
    )
    db.session.add(a)
    db.session.commit()
    return a
