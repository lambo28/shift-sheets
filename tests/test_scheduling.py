"""
tests/test_scheduling.py
Tests for the Scheduling section: holidays, one-off adjustments, swap validation.
"""
import json
import pytest
from datetime import date, time, datetime, timedelta

from app import app as flask_app, db as _db
from app import (
    Driver, ShiftPattern, ShiftTiming, DriverAssignment,
    DriverHoliday, ShiftAdjustment, ShiftSwap,
    validate_swap, get_driver_shifts_for_date, get_cars_working_at_time,
    group_consecutive_holidays,
)
from tests.conftest import make_driver, make_shift_timing, make_pattern, make_assignment


# ===========================================================================
# Holiday tests
# ===========================================================================

class TestHolidayModel:

    def test_add_holiday(self, db):
        driver = make_driver(db)
        h = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 7, 1))
        db.session.add(h)
        db.session.commit()
        fetched = DriverHoliday.query.filter_by(driver_id=driver.id).first()
        assert fetched is not None
        assert fetched.holiday_date == date(2026, 7, 1)

    def test_holiday_unique_per_driver_per_date(self, db):
        from sqlalchemy.exc import IntegrityError
        driver = make_driver(db)
        h1 = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 7, 1))
        h2 = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 7, 1))
        db.session.add(h1)
        db.session.commit()
        db.session.add(h2)
        with pytest.raises(IntegrityError):
            db.session.commit()

    def test_holiday_cascade_delete_with_driver(self, db):
        driver = make_driver(db)
        h = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 7, 5))
        db.session.add(h)
        db.session.commit()
        db.session.delete(driver)
        db.session.commit()
        assert DriverHoliday.query.count() == 0


class TestHolidayRoutes:

    def test_add_holiday_success(self, client, db):
        driver = make_driver(db, driver_number='10', name='Alice Smith')
        resp = client.post('/scheduling/holiday/add', data={
            'driver_id': driver.id,
            'start_date': '2026-08-01',
            'end_date': '2026-08-01',
            'notes': 'Summer leave',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert DriverHoliday.query.count() == 1
        h = DriverHoliday.query.first()
        assert h.holiday_date == date(2026, 8, 1)
        assert h.notes == 'Summer leave'

    def test_add_holiday_duplicate_shows_warning(self, client, db):
        driver = make_driver(db)
        h = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 8, 1))
        db.session.add(h)
        db.session.commit()
        resp = client.post('/scheduling/holiday/add', data={
            'driver_id': driver.id,
            'holiday_date': '2026-08-01',
        }, follow_redirects=True)
        assert resp.status_code == 200
        # Duplicate should not create a second record
        assert DriverHoliday.query.count() == 1

    def test_add_holiday_invalid_date(self, client, db):
        driver = make_driver(db)
        resp = client.post('/scheduling/holiday/add', data={
            'driver_id': driver.id,
            'holiday_date': 'not-a-date',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert DriverHoliday.query.count() == 0

    def test_delete_holiday(self, client, db):
        driver = make_driver(db)
        h = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 8, 1))
        db.session.add(h)
        db.session.commit()
        hid = h.id
        resp = client.post(f'/scheduling/holiday/{hid}/delete', follow_redirects=True)
        assert resp.status_code == 200
        assert DriverHoliday.query.count() == 0

    def test_scheduling_page_lists_holidays(self, client, db):
        driver = make_driver(db, name='Bob Jones')
        h = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 9, 5))
        db.session.add(h)
        db.session.commit()
        resp = client.get('/scheduling')
        assert resp.status_code == 200
        assert b'05/09/2026' in resp.data

    def test_add_holiday_date_range(self, client, db):
        driver = make_driver(db, driver_number='10', name='Alice Smith')
        resp = client.post('/scheduling/holiday/add', data={
            'driver_id': driver.id,
            'start_date': '2026-08-01',
            'end_date': '2026-08-05',
            'notes': 'Summer holiday',
        }, follow_redirects=True)
        assert resp.status_code == 200
        # Should create 5 holiday records (Aug 1-5)
        assert DriverHoliday.query.filter_by(driver_id=driver.id).count() == 5
        
        # Verify each date
        for day in range(1, 6):
            h = DriverHoliday.query.filter_by(driver_id=driver.id, holiday_date=date(2026, 8, day)).first()
            assert h is not None
            assert h.notes == 'Summer holiday'

    def test_add_holiday_single_day_via_range(self, client, db):
        driver = make_driver(db, driver_number='11', name='Jane Doe')
        resp = client.post('/scheduling/holiday/add', data={
            'driver_id': driver.id,
            'start_date': '2026-08-10',
            'end_date': '2026-08-10',
            'notes': 'Single day off',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert DriverHoliday.query.filter_by(driver_id=driver.id).count() == 1

    def test_add_holiday_range_skips_existing(self, client, db):
        driver = make_driver(db, driver_number='12', name='Bob Wilson')
        # Pre-create one holiday
        existing = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 8, 3))
        db.session.add(existing)
        db.session.commit()
        
        # Try to add range that includes existing date
        resp = client.post('/scheduling/holiday/add', data={
            'driver_id': driver.id,
            'start_date': '2026-08-01',
            'end_date': '2026-08-05',
            'notes': 'Holiday week',
        }, follow_redirects=True)
        assert resp.status_code == 200
        # Should have 5 total: 1 existing + 4 new (skipping Aug 3)
        assert DriverHoliday.query.filter_by(driver_id=driver.id).count() == 5

    def test_add_holiday_overwrites_overlapping_time_off_types(self, client, db):
        driver = make_driver(db, driver_number='13', name='Overlap Driver')

        # Existing holiday 5th-15th
        current = date(2026, 8, 5)
        while current <= date(2026, 8, 15):
            db.session.add(DriverHoliday(driver_id=driver.id, holiday_date=current, time_off_type='holiday'))
            current += timedelta(days=1)
        db.session.commit()

        # Add VOR 12th-20th, should replace overlap (12th-15th)
        resp = client.post('/scheduling/holiday/add', data={
            'driver_id': driver.id,
            'start_date': '2026-08-12',
            'end_date': '2026-08-20',
            'time_off_type': 'vor',
            'notes': 'Vehicle issue',
        }, follow_redirects=True)
        assert resp.status_code == 200

        # 5th-11th remain holiday
        for day in range(5, 12):
            rec = DriverHoliday.query.filter_by(driver_id=driver.id, holiday_date=date(2026, 8, day)).first()
            assert rec is not None
            assert rec.time_off_type == 'holiday'

        # 12th-20th become VOR
        for day in range(12, 21):
            rec = DriverHoliday.query.filter_by(driver_id=driver.id, holiday_date=date(2026, 8, day)).first()
            assert rec is not None
            assert rec.time_off_type == 'vor'

    def test_update_holiday_overwrites_existing_overlap(self, client, db):
        driver = make_driver(db, driver_number='14', name='Update Overlap Driver')

        # Existing holiday block 5th-11th
        for day in range(5, 12):
            db.session.add(DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 8, day), time_off_type='holiday'))

        # Existing VOR block 12th-20th
        for day in range(12, 21):
            db.session.add(DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 8, day), time_off_type='vor'))

        db.session.commit()

        # Edit holiday back to 5th-15th; should overwrite 12th-15th VOR
        resp = client.post('/scheduling/holiday/update',
            json={
                'driver_id': driver.id,
                'old_start_date': '2026-08-05',
                'old_end_date': '2026-08-11',
                'new_start_date': '2026-08-05',
                'new_end_date': '2026-08-15',
                'time_off_type': 'holiday',
                'notes': ''
            })
        assert resp.status_code == 200
        payload = resp.get_json()
        assert payload['success'] is True

        for day in range(5, 16):
            rec = DriverHoliday.query.filter_by(driver_id=driver.id, holiday_date=date(2026, 8, day)).first()
            assert rec is not None
            assert rec.time_off_type == 'holiday'

        for day in range(16, 21):
            rec = DriverHoliday.query.filter_by(driver_id=driver.id, holiday_date=date(2026, 8, day)).first()
            assert rec is not None
            assert rec.time_off_type == 'vor'

    def test_group_consecutive_holidays_keeps_drivers_and_notes_separate(self, db):
        driver_a = make_driver(db, driver_number='10', name='Alice Smith')
        driver_b = make_driver(db, driver_number='11', name='Bob Jones')

        records = [
            DriverHoliday(driver_id=driver_a.id, holiday_date=date(2026, 8, 1), time_off_type='holiday', notes='Trip A'),
            DriverHoliday(driver_id=driver_a.id, holiday_date=date(2026, 8, 2), time_off_type='holiday', notes='Trip A'),
            DriverHoliday(driver_id=driver_a.id, holiday_date=date(2026, 8, 3), time_off_type='holiday', notes='Trip B'),
            DriverHoliday(driver_id=driver_b.id, holiday_date=date(2026, 8, 2), time_off_type='holiday', notes='Trip A'),
        ]
        db.session.add_all(records)
        db.session.commit()

        grouped = group_consecutive_holidays(DriverHoliday.query.order_by(DriverHoliday.holiday_date).all())

        # Expected groups:
        # 1) driver_a: 01-02 Aug (Trip A)
        # 2) driver_a: 03 Aug (Trip B)
        # 3) driver_b: 02 Aug (Trip A)
        assert len(grouped) == 3
        assert [len(group) for group in grouped] == [2, 1, 1]
        assert grouped[0][0].driver_id == driver_a.id
        assert grouped[1][0].driver_id == driver_a.id
        assert grouped[2][0].driver_id == driver_b.id

    def test_delete_holiday_group_only_deletes_matching_group(self, client, db):
        driver_a = make_driver(db, driver_number='10', name='Alice Smith')
        driver_b = make_driver(db, driver_number='11', name='Bob Jones')

        target_1 = DriverHoliday(driver_id=driver_a.id, holiday_date=date(2026, 8, 1), time_off_type='holiday', notes='Trip A')
        target_2 = DriverHoliday(driver_id=driver_a.id, holiday_date=date(2026, 8, 2), time_off_type='holiday', notes='Trip A')
        different_notes = DriverHoliday(driver_id=driver_a.id, holiday_date=date(2026, 8, 3), time_off_type='holiday', notes='Trip B')
        other_driver = DriverHoliday(driver_id=driver_b.id, holiday_date=date(2026, 8, 2), time_off_type='holiday', notes='Trip A')
        db.session.add_all([target_1, target_2, different_notes, other_driver])
        db.session.commit()

        resp = client.post(f'/scheduling/holiday/{target_1.id}/delete-group', follow_redirects=True)
        assert resp.status_code == 200

        remaining = DriverHoliday.query.order_by(DriverHoliday.driver_id, DriverHoliday.holiday_date).all()
        assert len(remaining) == 2
        assert remaining[0].driver_id == driver_a.id
        assert remaining[0].holiday_date == date(2026, 8, 3)
        assert remaining[0].notes == 'Trip B'
        assert remaining[1].driver_id == driver_b.id
        assert remaining[1].holiday_date == date(2026, 8, 2)


class TestHolidayEffects:

    def test_holiday_removes_driver_shift_for_date(self, db):
        driver = make_driver(db, driver_number='10', name='Alice Smith')
        make_shift_timing(db, 'morning', '06:00', '14:00')
        pattern = make_pattern(db, 'Working Pattern', 7, ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
        make_assignment(db, driver, pattern, date(2026, 6, 1), start_day_of_cycle=1)

        holiday = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 6, 1), notes='Annual leave')
        db.session.add(holiday)
        db.session.commit()

        shifts = get_driver_shifts_for_date(driver, date(2026, 6, 1))
        assert shifts == []

    def test_holiday_excludes_driver_from_cars_working_count(self, db):
        driver = make_driver(db, driver_number='20', name='Bob Jones')
        make_shift_timing(db, 'morning', '06:00', '14:00')
        pattern = make_pattern(db, 'Working Pattern 2', 7, ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
        make_assignment(db, driver, pattern, date(2026, 6, 1), start_day_of_cycle=1)

        holiday = DriverHoliday(driver_id=driver.id, holiday_date=date(2026, 6, 1), notes='Annual leave')
        db.session.add(holiday)
        db.session.commit()

        count = get_cars_working_at_time(date(2026, 6, 1), time(9, 0))
        assert count == 0


# ===========================================================================
# Shift adjustment tests
# ===========================================================================

class TestAdjustmentModel:

    def test_add_adjustment(self, db):
        driver = make_driver(db)
        adj = ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='late_start',
            adjusted_time=time(8, 30),
        )
        db.session.add(adj)
        db.session.commit()
        fetched = ShiftAdjustment.query.first()
        assert fetched.adjustment_type == 'late_start'
        assert fetched.adjusted_time == time(8, 30)


class TestAdjustmentRoutes:

    def test_add_late_start(self, client, db):
        driver = make_driver(db)
        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'late_start',
            'adjusted_time': '08:30',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftAdjustment.query.count() == 1
        adj = ShiftAdjustment.query.first()
        assert adj.adjustment_type == 'late_start'
        assert adj.adjusted_time == time(8, 30)

    def test_add_early_finish(self, client, db):
        driver = make_driver(db)
        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-11',
            'adjustment_type': 'early_finish',
            'adjusted_time': '12:00',
        }, follow_redirects=True)
        assert resp.status_code == 200
        adj = ShiftAdjustment.query.first()
        assert adj.adjustment_type == 'early_finish'

    def test_add_adjustment_invalid_type(self, client, db):
        driver = make_driver(db)
        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-12',
            'adjustment_type': 'invalid_type',
            'adjusted_time': '09:00',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftAdjustment.query.count() == 0

    def test_add_adjustment_invalid_time(self, client, db):
        driver = make_driver(db)
        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-12',
            'adjustment_type': 'late_start',
            'adjusted_time': 'not-a-time',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftAdjustment.query.count() == 0

    def test_edit_adjustment(self, client, db):
        driver = make_driver(db)
        adj = ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='late_start',
            adjusted_time=time(8, 30),
        )
        db.session.add(adj)
        db.session.commit()
        resp = client.post(f'/scheduling/adjustment/{adj.id}/edit', data={
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'early_finish',
            'adjusted_time': '13:00',
        }, follow_redirects=True)
        assert resp.status_code == 200
        updated = ShiftAdjustment.query.get(adj.id)
        assert updated.adjustment_type == 'early_finish'
        assert updated.adjusted_time == time(13, 0)

    def test_delete_adjustment(self, client, db):
        driver = make_driver(db)
        adj = ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='late_start',
            adjusted_time=time(8, 30),
        )
        db.session.add(adj)
        db.session.commit()
        resp = client.post(f'/scheduling/adjustment/{adj.id}/delete', follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftAdjustment.query.count() == 0


# ===========================================================================
# Swap validation tests
# ===========================================================================

class TestSwapValidation:
    """Test the validate_swap() business logic function."""

    def _setup_two_drivers_with_shifts(self, db, shift_a_start='06:00', shift_a_end='14:00',
                                        shift_b_start='14:00', shift_b_end='22:00',
                                        date_a=None, date_b=None):
        """Create two drivers each with a 7-day cycle pattern and an assignment."""
        if date_a is None:
            date_a = date(2026, 6, 1)  # Monday
        if date_b is None:
            date_b = date(2026, 6, 2)  # Tuesday

        st_a = make_shift_timing(db, 'morning', shift_a_start, shift_a_end)
        st_b = make_shift_timing(db, 'afternoon', shift_b_start, shift_b_end)

        # Pattern A: works Mon (day 0), day_off rest of week
        pattern_a_data = ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off']
        pattern_a = make_pattern(db, 'Pattern A', 7, pattern_a_data)

        # Pattern B: works Tue (day 1), day_off rest of week
        pattern_b_data = ['day_off', 'afternoon', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off']
        pattern_b = make_pattern(db, 'Pattern B', 7, pattern_b_data)

        driver_a = make_driver(db, '1', 'Alice Smith')
        driver_b = make_driver(db, '2', 'Bob Jones')

        # Assignments start on the Monday
        make_assignment(db, driver_a, pattern_a, date_a, start_day_of_cycle=1)
        make_assignment(db, driver_b, pattern_b, date_a, start_day_of_cycle=1)

        return driver_a, driver_b, date_a, date_b

    def test_valid_swap(self, db):
        with flask_app.app_context():
            # date_a=Monday (driver_a has morning), date_b=Tuesday (driver_b has afternoon)
            # After swap: driver_a works Tuesday afternoon, driver_b works Monday morning
            driver_a, driver_b, date_a, date_b = self._setup_two_drivers_with_shifts(db)
            errors = validate_swap(driver_a, driver_b, date_a, date_b)
            # Should be valid (no conflicts, adequate rest, same weekly count)
            assert errors == []

    def test_swap_missing_shift_for_driver_a(self, db):
        with flask_app.app_context():
            st = make_shift_timing(db, 'morning', '06:00', '14:00')
            pattern = make_pattern(db, 'Pattern', 7, ['day_off', 'morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver_a = make_driver(db, '1', 'Alice Smith')
            driver_b = make_driver(db, '2', 'Bob Jones')
            ref = date(2026, 6, 1)  # Monday
            make_assignment(db, driver_a, pattern, ref, start_day_of_cycle=1)
            make_assignment(db, driver_b, pattern, ref, start_day_of_cycle=1)

            # driver_a has day_off on Monday (day 0), so swap should fail
            errors = validate_swap(driver_a, driver_b, date(2026, 6, 1), date(2026, 6, 2))
        assert any('no shift' in e for e in errors)

    def test_swap_rest_rule_violation(self, db):
        """Swap must not give a driver less than 8 hours rest."""
        with flask_app.app_context():
            # shift_a ends at 23:30, shift_b starts next day at 06:00 -> only 6.5h rest
            st_a = make_shift_timing(db, 'night', '15:00', '23:30')
            st_b = make_shift_timing(db, 'morning', '06:00', '14:00')

            # driver_a: works Mon (night), driver_b: works Tue (morning)
            ref = date(2026, 6, 1)  # Monday
            pattern_a = make_pattern(db, 'Pattern A', 7,
                ['night', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            pattern_b = make_pattern(db, 'Pattern B', 7,
                ['day_off', 'morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])

            driver_a = make_driver(db, '1', 'Alice Smith')
            driver_b = make_driver(db, '2', 'Bob Jones')
            make_assignment(db, driver_a, pattern_a, ref, start_day_of_cycle=1)
            make_assignment(db, driver_b, pattern_b, ref, start_day_of_cycle=1)

            # After swap: driver_b takes Mon night shift; driver_b also has Tue morning.
            # Rest between Mon night (ends 23:30) and Tue morning (starts 06:00) = 6.5h < 8h
            errors = validate_swap(driver_a, driver_b, date(2026, 6, 1), date(2026, 6, 2))
            assert any('rest' in e.lower() for e in errors), f"Expected rest violation, got: {errors}"

    def test_swap_same_driver_rejected(self, client, db):
        """A swap where both drivers are the same should be rejected."""
        driver = make_driver(db)
        resp = client.post('/scheduling/swap/add', data={
            'driver_a_id': driver.id,
            'driver_b_id': driver.id,
            'date_a': '2026-06-01',
            'date_b': '2026-06-02',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftSwap.query.count() == 0

    def test_swap_validate_endpoint_valid(self, client, db):
        """AJAX validate endpoint returns success for valid swap."""
        with flask_app.app_context():
            st_a = make_shift_timing(db, 'morning', '06:00', '14:00')
            st_b = make_shift_timing(db, 'afternoon', '14:00', '22:00')
            ref = date(2026, 6, 1)
            pattern_a = make_pattern(db, 'PA', 7,
                ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            pattern_b = make_pattern(db, 'PB', 7,
                ['day_off', 'afternoon', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver_a = make_driver(db, '1', 'Alice Smith')
            driver_b = make_driver(db, '2', 'Bob Jones')
            make_assignment(db, driver_a, pattern_a, ref)
            make_assignment(db, driver_b, pattern_b, ref)
            driver_a_id = driver_a.id
            driver_b_id = driver_b.id

        resp = client.post('/scheduling/swap/validate',
            json={
                'driver_a_id': driver_a_id,
                'driver_b_id': driver_b_id,
                'date_a': '2026-06-01',
                'date_b': '2026-06-02',
            },
            headers={'X-Requested-With': 'XMLHttpRequest'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['success'] is True

    def test_swap_validate_endpoint_invalid_no_shift(self, client, db):
        """AJAX validate endpoint returns errors when driver has no shift."""
        with flask_app.app_context():
            st = make_shift_timing(db, 'morning', '06:00', '14:00')
            ref = date(2026, 6, 1)
            # Both drivers have day_off on dates we try to swap
            pattern = make_pattern(db, 'P', 7,
                ['day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver_a = make_driver(db, '1', 'Alice Smith')
            driver_b = make_driver(db, '2', 'Bob Jones')
            make_assignment(db, driver_a, pattern, ref)
            make_assignment(db, driver_b, pattern, ref)
            driver_a_id = driver_a.id
            driver_b_id = driver_b.id

        resp = client.post('/scheduling/swap/validate',
            json={
                'driver_a_id': driver_a_id,
                'driver_b_id': driver_b_id,
                'date_a': '2026-06-01',
                'date_b': '2026-06-02',
            })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['success'] is False
        assert len(data['errors']) > 0

    def test_swap_validate_endpoint_missing_fields(self, client, db):
        resp = client.post('/scheduling/swap/validate',
            json={'driver_a_id': None, 'driver_b_id': None, 'date_a': '', 'date_b': ''})
        assert resp.status_code == 400
        data = resp.get_json()
        assert data['success'] is False


class TestSwapRoutes:

    def test_add_swap_success(self, client, db):
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
            make_shift_timing(db, 'afternoon', '14:00', '22:00')
            ref = date(2026, 6, 1)
            pattern_a = make_pattern(db, 'PA', 7,
                ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            pattern_b = make_pattern(db, 'PB', 7,
                ['day_off', 'afternoon', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver_a = make_driver(db, '1', 'Alice Smith')
            driver_b = make_driver(db, '2', 'Bob Jones')
            make_assignment(db, driver_a, pattern_a, ref)
            make_assignment(db, driver_b, pattern_b, ref)
            driver_a_id = driver_a.id
            driver_b_id = driver_b.id

        resp = client.post('/scheduling/swap/add', data={
            'driver_a_id': driver_a_id,
            'driver_b_id': driver_b_id,
            'date_a': '2026-06-01',
            'date_b': '2026-06-02',
            'notes': 'Test swap',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftSwap.query.count() == 1
        swap = ShiftSwap.query.first()
        assert swap.driver_a_id == driver_a_id
        assert swap.driver_b_id == driver_b_id
        assert swap.notes == 'Test swap'

    def test_delete_swap(self, client, db):
        driver_a = make_driver(db, '1', 'Alice Smith')
        driver_b = make_driver(db, '2', 'Bob Jones')
        swap = ShiftSwap(
            driver_a_id=driver_a.id,
            driver_b_id=driver_b.id,
            date_a=date(2026, 6, 1),
            date_b=date(2026, 6, 2),
        )
        db.session.add(swap)
        db.session.commit()
        resp = client.post(f'/scheduling/swap/{swap.id}/delete', follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftSwap.query.count() == 0

    def test_scheduling_page_lists_swaps(self, client, db):
        driver_a = make_driver(db, '1', 'Alice Smith')
        driver_b = make_driver(db, '2', 'Bob Jones')
        swap = ShiftSwap(
            driver_a_id=driver_a.id,
            driver_b_id=driver_b.id,
            date_a=date(2026, 6, 1),
            date_b=date(2026, 6, 2),
        )
        db.session.add(swap)
        db.session.commit()
        resp = client.get('/scheduling')
        assert resp.status_code == 200
        assert b'01/06/2026' in resp.data
