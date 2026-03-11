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
    DriverHoliday, ShiftAdjustment, ShiftSwap, DriverCustomTiming,
    validate_swap, get_driver_shifts_for_date, get_cars_working_at_time,
    group_consecutive_holidays,
)
from tests.conftest import make_driver, make_shift_timing, make_pattern, make_assignment


# ===========================================================================
# Holiday tests
# ===========================================================================

class TestSwapCalendarData:
    def test_calendar_data_marks_existing_swap_days(self, client, db):
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
            ref = date(2026, 6, 1)
            pattern = make_pattern(db, 'Swap Marker Pattern', 7,
                ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver = make_driver(db, '1', 'Alice Smith')
            driver_id = driver.id
            make_assignment(db, driver, pattern, ref, start_day_of_cycle=1)

            swap = ShiftSwap(
                driver_a_id=driver.id,
                driver_b_id=driver.id,
                date_a=date(2026, 6, 1),
                date_b=date(2026, 6, 2),
                work_shift_type='morning',
            )
            db.session.add(swap)
            db.session.commit()

        resp = client.get(f'/driver/{driver_id}/calendar-data?month=2026-06')
        assert resp.status_code == 200
        payload = json.loads(resp.data)
        assert payload.get('success') is True

        give_up_day = next(d for d in payload['days'] if d['date'] == '2026-06-01')
        work_day = next(d for d in payload['days'] if d['date'] == '2026-06-02')

        assert give_up_day['has_swap_give_up'] is True
        assert give_up_day['swap_give_up_count'] == 1
        assert work_day['has_swap_work'] is True
        assert work_day['swap_work_count'] == 1

    def test_calendar_data_applies_swap_to_shift_output(self, client, db):
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
            ref = date(2026, 6, 1)
            pattern = make_pattern(db, 'Swap Apply Pattern', 7,
                ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver = make_driver(db, '1', 'Alice Smith')
            driver_id = driver.id
            make_assignment(db, driver, pattern, ref, start_day_of_cycle=1)

            db.session.add(ShiftSwap(
                driver_a_id=driver_id,
                driver_b_id=driver_id,
                date_a=date(2026, 6, 1),
                date_b=date(2026, 6, 2),
                work_shift_type='morning',
            ))
            db.session.commit()

        resp = client.get(f'/driver/{driver_id}/calendar-data?month=2026-06')
        assert resp.status_code == 200
        payload = json.loads(resp.data)
        assert payload.get('success') is True

        give_up_day = next(d for d in payload['days'] if d['date'] == '2026-06-01')
        work_day = next(d for d in payload['days'] if d['date'] == '2026-06-02')

        assert len(give_up_day['shifts']) == 1
        assert give_up_day['shifts'][0]['shift_type'] == 'day_off'
        assert give_up_day['shifts'][0]['is_swap'] is True
        assert give_up_day['shifts'][0]['swap_role'] == 'give_up'

        assert len(work_day['shifts']) == 1
        assert work_day['shifts'][0]['shift_type'] == 'morning'
        assert work_day['shifts'][0]['is_swap'] is True
        assert work_day['shifts'][0]['swap_role'] == 'work'

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

    def _make_driver_with_working_day(self, db, work_date):
        driver = make_driver(db)
        make_shift_timing(db, 'morning', '06:00', '14:00')
        pattern = make_pattern(
            db,
            f'Adjustment Pattern {driver.id}',
            7,
            ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off']
        )
        make_assignment(db, driver, pattern, work_date, start_day_of_cycle=1)
        return driver

    def _make_driver_with_default_and_custom_window(self, db, work_date):
        driver = make_driver(db)
        make_shift_timing(db, 'morning', '06:00', '18:00')
        pattern = make_pattern(
            db,
            f'Custom Window Pattern {driver.id}',
            7,
            ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off']
        )
        assignment = make_assignment(db, driver, pattern, work_date, start_day_of_cycle=1)

        custom = DriverCustomTiming(
            driver_id=driver.id,
            assignment_id=assignment.id,
            shift_type='morning',
            day_of_cycle=0,
            day_of_week=work_date.weekday(),
            start_time=time(4, 0),
            end_time=time(14, 0),
            priority=1,
        )
        db.session.add(custom)
        db.session.commit()
        return driver

    def test_add_late_start(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))
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
        driver = self._make_driver_with_working_day(db, date(2026, 7, 11))
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
        driver = self._make_driver_with_working_day(db, date(2026, 7, 12))
        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-12',
            'adjustment_type': 'invalid_type',
            'adjusted_time': '09:00',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftAdjustment.query.count() == 0

    def test_add_adjustment_invalid_time(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 12))
        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-12',
            'adjustment_type': 'late_start',
            'adjusted_time': 'not-a-time',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftAdjustment.query.count() == 0

    def test_add_adjustment_rejects_day_off(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))
        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-11',  # day 2 in cycle -> day_off
            'adjustment_type': 'late_start',
            'adjusted_time': '09:00',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftAdjustment.query.count() == 0

    def test_add_adjustment_allows_both_types_same_day(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))

        late_resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'late_start',
            'adjusted_time': '08:00',
        }, follow_redirects=True)
        early_resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'early_finish',
            'adjusted_time': '13:00',
        }, follow_redirects=True)

        assert late_resp.status_code == 200
        assert early_resp.status_code == 200
        assert ShiftAdjustment.query.filter_by(driver_id=driver.id, adjustment_date=date(2026, 7, 10)).count() == 2

    def test_add_adjustment_rejects_duplicate_type_same_day(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))
        db.session.add(ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='late_start',
            adjusted_time=time(8, 0),
        ))
        db.session.commit()

        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'late_start',
            'adjusted_time': '09:00',
        }, follow_redirects=True)

        assert resp.status_code == 200
        assert ShiftAdjustment.query.filter_by(driver_id=driver.id, adjustment_date=date(2026, 7, 10), adjustment_type='late_start').count() == 1

    def test_early_finish_uses_combined_custom_default_bounds(self, client, db):
        driver = self._make_driver_with_default_and_custom_window(db, date(2026, 7, 10))

        ok = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'early_finish',
            'adjusted_time': '17:59',
        }, follow_redirects=True)
        assert ok.status_code == 200
        assert ShiftAdjustment.query.count() == 1

        too_early = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'early_finish',
            'adjusted_time': '04:00',
        }, follow_redirects=True)
        assert too_early.status_code == 200
        assert ShiftAdjustment.query.count() == 1

        too_late = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'early_finish',
            'adjusted_time': '18:00',
        }, follow_redirects=True)
        assert too_late.status_code == 200
        assert ShiftAdjustment.query.count() == 1

    def test_late_start_uses_combined_custom_default_bounds(self, client, db):
        driver = self._make_driver_with_default_and_custom_window(db, date(2026, 7, 10))

        ok = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'late_start',
            'adjusted_time': '17:59',
        }, follow_redirects=True)
        assert ok.status_code == 200
        assert ShiftAdjustment.query.count() == 1

        too_early = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'late_start',
            'adjusted_time': '04:00',
        }, follow_redirects=True)
        assert too_early.status_code == 200
        assert ShiftAdjustment.query.count() == 1

        too_late = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'late_start',
            'adjusted_time': '18:00',
        }, follow_redirects=True)
        assert too_late.status_code == 200
        assert ShiftAdjustment.query.count() == 1

    def test_early_finish_must_be_after_existing_late_start(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))
        db.session.add(ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='late_start',
            adjusted_time=time(10, 0),
        ))
        db.session.commit()

        resp = client.post('/scheduling/adjustment/add', data={
            'driver_id': driver.id,
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'early_finish',
            'adjusted_time': '09:30',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftAdjustment.query.count() == 1

    def test_edit_adjustment(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))
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

    def test_edit_adjustment_rejects_day_off(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))
        adj = ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='late_start',
            adjusted_time=time(8, 30),
        )
        db.session.add(adj)
        db.session.commit()

        resp = client.post(f'/scheduling/adjustment/{adj.id}/edit', data={
            'adjustment_date': '2026-07-11',  # day 2 in cycle -> day_off
            'adjustment_type': 'early_finish',
            'adjusted_time': '13:00',
        }, follow_redirects=True)
        assert resp.status_code == 200

        updated = ShiftAdjustment.query.get(adj.id)
        assert updated.adjustment_date == date(2026, 7, 10)
        assert updated.adjustment_type == 'late_start'
        assert updated.adjusted_time == time(8, 30)

    def test_edit_adjustment_rejects_duplicate_type_same_day(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))
        first = ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='late_start',
            adjusted_time=time(8, 0),
        )
        second = ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='early_finish',
            adjusted_time=time(13, 0),
        )
        db.session.add(first)
        db.session.add(second)
        db.session.commit()

        resp = client.post(f'/scheduling/adjustment/{second.id}/edit', data={
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'late_start',
            'adjusted_time': '09:00',
        }, follow_redirects=True)
        assert resp.status_code == 200

        updated = ShiftAdjustment.query.get(second.id)
        assert updated.adjustment_type == 'early_finish'

    def test_edit_late_start_rejects_if_after_existing_early_finish(self, client, db):
        driver = self._make_driver_with_working_day(db, date(2026, 7, 10))
        existing_early = ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='early_finish',
            adjusted_time=time(11, 0),
        )
        target = ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=date(2026, 7, 10),
            adjustment_type='late_start',
            adjusted_time=time(8, 0),
        )
        db.session.add(existing_early)
        db.session.add(target)
        db.session.commit()

        resp = client.post(f'/scheduling/adjustment/{target.id}/edit', data={
            'adjustment_date': '2026-07-10',
            'adjustment_type': 'late_start',
            'adjusted_time': '11:00',
        }, follow_redirects=True)
        assert resp.status_code == 200

        updated = ShiftAdjustment.query.get(target.id)
        assert updated.adjusted_time == time(8, 0)

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

    def test_late_start_overrides_custom_start_time_in_shift_output(self, db):
        work_date = date(2026, 8, 2)
        driver = make_driver(db)
        make_shift_timing(db, 'morning', '06:00', '14:00')
        pattern = make_pattern(
            db,
            f'Adj Overrides Custom Pattern {driver.id}',
            7,
            ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off']
        )
        assignment = make_assignment(db, driver, pattern, work_date, start_day_of_cycle=1)

        db.session.add(DriverCustomTiming(
            driver_id=driver.id,
            assignment_id=assignment.id,
            shift_type='morning',
            day_of_cycle=0,
            day_of_week=work_date.weekday(),
            start_time=time(9, 0),
            priority=1,
        ))
        db.session.add(ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=work_date,
            adjustment_type='late_start',
            adjusted_time=time(7, 0),
        ))
        db.session.commit()

        shifts = get_driver_shifts_for_date(driver, work_date)
        assert len(shifts) == 1
        assert shifts[0]['start_time'] == time(7, 0)
        assert shifts[0]['default_start_time'] == time(6, 0)

    def test_calendar_data_uses_adjustment_time_over_custom(self, client, db):
        work_date = date(2026, 8, 2)
        driver = make_driver(db)
        make_shift_timing(db, 'morning', '06:00', '14:00')
        pattern = make_pattern(
            db,
            f'Calendar Effective Pattern {driver.id}',
            7,
            ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off']
        )
        assignment = make_assignment(db, driver, pattern, work_date, start_day_of_cycle=1)

        db.session.add(DriverCustomTiming(
            driver_id=driver.id,
            assignment_id=assignment.id,
            shift_type='morning',
            day_of_cycle=0,
            day_of_week=work_date.weekday(),
            start_time=time(9, 0),
            priority=1,
        ))
        db.session.add(ShiftAdjustment(
            driver_id=driver.id,
            adjustment_date=work_date,
            adjustment_type='late_start',
            adjusted_time=time(7, 0),
        ))
        db.session.commit()

        resp = client.get(f'/driver/{driver.id}/calendar-data?month={work_date.strftime("%Y-%m")}')
        assert resp.status_code == 200
        payload = json.loads(resp.data)
        assert payload.get('success') is True

        target_day = next(d for d in payload['days'] if d['date'] == work_date.strftime('%Y-%m-%d'))
        assert len(target_day['shifts']) == 1
        assert target_day['shifts'][0]['start_time'] == '07:00'
        assert target_day['shifts'][0]['default_start_time'] == '06:00'


# ===========================================================================
# Swap validation tests
# ===========================================================================

class TestSwapValidation:
    """Test the validate_swap() business logic function."""

    @staticmethod
    def _has_working_shift(driver, target_date):
        shifts = get_driver_shifts_for_date(driver, target_date)
        return any(s.get('shift_type') != 'day_off' for s in shifts)

    @staticmethod
    def _find_dates_for_single_driver_swap(driver, ref_date, max_days=14):
        give_up_date = None
        work_date = None

        for i in range(max_days):
            current = ref_date + timedelta(days=i)
            has_working = TestSwapValidation._has_working_shift(driver, current)
            if has_working and give_up_date is None:
                give_up_date = current
            if (not has_working) and work_date is None:
                work_date = current
            if give_up_date and work_date and give_up_date != work_date:
                break

        return give_up_date, work_date

    def _setup_single_driver_swap(self, db):
        """Create one driver with a pattern suitable for a valid single-driver day swap."""
        make_shift_timing(db, 'morning', '06:00', '14:00')
        make_shift_timing(db, 'afternoon', '14:00', '22:00')

        ref = date(2026, 6, 1)  # Monday
        pattern = make_pattern(db, 'Pattern A', 7,
            ['day_off', 'morning', 'day_off', 'afternoon', 'day_off', 'day_off', 'day_off'])
        driver = make_driver(db, '1', 'Alice Smith')
        make_assignment(db, driver, pattern, ref, start_day_of_cycle=1)

        give_up_date, work_date = self._find_dates_for_single_driver_swap(driver, ref)
        assert give_up_date is not None and work_date is not None
        return driver, give_up_date, work_date

    def test_valid_swap(self, db):
        with flask_app.app_context():
            driver, give_up_date, work_date = self._setup_single_driver_swap(db)
            errors = validate_swap(driver, give_up_date, work_date, 'morning')
            assert errors == []

    def test_swap_missing_shift_for_give_up_date(self, db):
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
            pattern = make_pattern(db, 'Pattern', 7, ['day_off', 'morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver = make_driver(db, '1', 'Alice Smith')
            ref = date(2026, 6, 1)  # Monday
            make_assignment(db, driver, pattern, ref, start_day_of_cycle=1)

            # Monday is day_off, so give-up date has no working shift
            errors = validate_swap(driver, date(2026, 6, 1), date(2026, 6, 2), 'morning')
        assert any('no working shift' in e.lower() for e in errors)

    def test_swap_rest_rule_violation(self, db):
        """Swap must not give a driver less than 8 hours rest on adjacent days."""
        with flask_app.app_context():
            make_shift_timing(db, 'night', '15:00', '23:30')
            make_shift_timing(db, 'morning', '06:00', '14:00')

            ref = date(2026, 6, 1)  # Monday
            pattern = make_pattern(db, 'Pattern A', 7,
                ['day_off', 'night', 'day_off', 'morning', 'day_off', 'day_off', 'day_off'])

            driver = make_driver(db, '1', 'Alice Smith')
            make_assignment(db, driver, pattern, ref, start_day_of_cycle=1)

            work_date = None
            for i in range(1, 15):
                current = ref + timedelta(days=i)
                prev = current - timedelta(days=1)
                current_has_working = self._has_working_shift(driver, current)
                prev_shifts = get_driver_shifts_for_date(driver, prev)
                prev_has_night = any(s.get('shift_type') == 'night' for s in prev_shifts)
                if (not current_has_working) and prev_has_night:
                    work_date = current
                    break

            assert work_date is not None

            give_up_date = None
            for i in range(1, 15):
                current = ref + timedelta(days=i)
                if current == work_date:
                    continue
                shifts = get_driver_shifts_for_date(driver, current)
                if any(s.get('shift_type') == 'morning' for s in shifts):
                    give_up_date = current
                    break

            assert give_up_date is not None

            errors = validate_swap(driver, give_up_date, work_date, 'morning')
            assert any('rest' in e.lower() for e in errors), f"Expected rest violation, got: {errors}"

    def test_swap_rest_rule_ignores_removed_give_up_day_shift(self, db):
        """If adjacent-day shift is the give-up day, rest check should ignore it."""
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
            make_shift_timing(db, 'late', '15:00', '23:30')

            ref = date(2026, 6, 1)  # Monday
            pattern = make_pattern(db, 'Pattern Adjacent Removal', 7,
                ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])

            driver = make_driver(db, '1', 'Alice Smith')
            make_assignment(db, driver, pattern, ref, start_day_of_cycle=1)

            # Give up Monday morning and work Sunday late (adjacent day before).
            # Without removing Monday's shift this appears to violate rest,
            # but with swap semantics Monday becomes OFF and should pass.
            give_up_date = date(2026, 6, 8)
            work_date = date(2026, 6, 7)

            errors = validate_swap(driver, give_up_date, work_date, 'late')
            assert not any('rest' in e.lower() for e in errors), f"Did not expect rest violation, got: {errors}"

    def test_swap_rejects_same_date(self, client, db):
        """A swap with same give-up/work date should be rejected."""
        make_shift_timing(db, 'morning', '06:00', '14:00')
        pattern = make_pattern(db, 'P', 7, ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
        driver = make_driver(db, '1', 'Alice Smith')
        make_assignment(db, driver, pattern, date(2026, 6, 1), start_day_of_cycle=1)

        resp = client.post('/scheduling/swap/add', data={
            'driver_id': driver.id,
            'give_up_date': '2026-06-02',
            'work_date': '2026-06-02',
            'work_shift_type': 'morning',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftSwap.query.count() == 0

    def test_swap_validate_endpoint_valid(self, client, db):
        """AJAX validate endpoint returns success for valid single-driver swap."""
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
            make_shift_timing(db, 'afternoon', '14:00', '22:00')
            ref = date(2026, 6, 1)
            pattern = make_pattern(db, 'PA', 7,
                ['morning', 'day_off', 'afternoon', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver = make_driver(db, '1', 'Alice Smith')
            make_assignment(db, driver, pattern, ref)
            driver_id = driver.id

        resp = client.post('/scheduling/swap/validate',
            json={
                'driver_id': driver_id,
                'give_up_date': '2026-06-03',
                'work_date': '2026-06-02',
                'work_shift_type': 'morning',
            },
            headers={'X-Requested-With': 'XMLHttpRequest'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['success'] is True

    def test_swap_validate_endpoint_invalid_no_shift(self, client, db):
        """AJAX validate endpoint returns errors when give-up date has no shift."""
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
            ref = date(2026, 6, 1)
            pattern = make_pattern(db, 'P', 7,
                ['day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            driver = make_driver(db, '1', 'Alice Smith')
            make_assignment(db, driver, pattern, ref)
            driver_id = driver.id

        resp = client.post('/scheduling/swap/validate',
            json={
                'driver_id': driver_id,
                'give_up_date': '2026-06-01',
                'work_date': '2026-06-02',
                'work_shift_type': 'morning',
            })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['success'] is False
        assert len(data['errors']) > 0

    def test_swap_validate_endpoint_missing_fields(self, client, db):
        resp = client.post('/scheduling/swap/validate',
            json={'driver_id': None, 'give_up_date': '', 'work_date': '', 'work_shift_type': ''})
        assert resp.status_code == 400
        data = resp.get_json()
        assert data['success'] is False

    def test_swap_rejects_dates_already_used_in_existing_swap(self, db):
        with flask_app.app_context():
            driver, give_up_date, work_date = self._setup_single_driver_swap(db)

            db.session.add(ShiftSwap(
                driver_a_id=driver.id,
                driver_b_id=driver.id,
                date_a=give_up_date,
                date_b=work_date,
                work_shift_type='morning',
            ))
            db.session.commit()

            errors = validate_swap(driver, give_up_date, work_date, 'morning')
            assert any('already belongs to an existing swap' in e.lower() for e in errors)


class TestSwapRoutes:

    @staticmethod
    def _has_working_shift(driver, target_date):
        shifts = get_driver_shifts_for_date(driver, target_date)
        return any(s.get('shift_type') != 'day_off' for s in shifts)

    @staticmethod
    def _find_dates_for_single_driver_swap(driver, ref_date, max_days=14):
        give_up_date = None
        work_date = None

        for i in range(max_days):
            current = ref_date + timedelta(days=i)
            has_working = TestSwapRoutes._has_working_shift(driver, current)
            if has_working and give_up_date is None:
                give_up_date = current
            if (not has_working) and work_date is None:
                work_date = current
            if give_up_date and work_date and give_up_date != work_date:
                break

        return give_up_date, work_date

    def test_add_swap_success(self, client, db):
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
            make_shift_timing(db, 'afternoon', '14:00', '22:00')
            ref = date(2026, 6, 1)
            pattern = make_pattern(db, 'PA', 7,
                ['day_off', 'morning', 'day_off', 'afternoon', 'day_off', 'day_off', 'day_off'])
            driver = make_driver(db, '1', 'Alice Smith')
            make_assignment(db, driver, pattern, ref)
            driver_id = driver.id
            give_up_date, work_date = self._find_dates_for_single_driver_swap(driver, ref)
            assert give_up_date is not None and work_date is not None

        resp = client.post('/scheduling/swap/add', data={
            'driver_id': driver_id,
            'give_up_date': give_up_date.strftime('%Y-%m-%d'),
            'work_date': work_date.strftime('%Y-%m-%d'),
            'work_shift_type': 'morning',
            'notes': 'Test swap',
        }, follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftSwap.query.count() == 1
        swap = ShiftSwap.query.first()
        assert swap.driver_a_id == driver_id
        assert swap.driver_b_id == driver_id
        assert swap.work_shift_type == 'morning'
        assert swap.notes == 'Test swap'

    def test_delete_swap(self, client, db):
        driver = make_driver(db, '1', 'Alice Smith')
        swap = ShiftSwap(
            driver_a_id=driver.id,
            driver_b_id=driver.id,
            date_a=date(2026, 6, 1),
            date_b=date(2026, 6, 2),
            work_shift_type='morning',
        )
        db.session.add(swap)
        db.session.commit()
        resp = client.post(f'/scheduling/swap/{swap.id}/delete', follow_redirects=True)
        assert resp.status_code == 200
        assert ShiftSwap.query.count() == 0

    def test_scheduling_page_lists_swaps(self, client, db):
        driver = make_driver(db, '1', 'Alice Smith')
        swap = ShiftSwap(
            driver_a_id=driver.id,
            driver_b_id=driver.id,
            date_a=date(2026, 6, 1),
            date_b=date(2026, 6, 2),
            work_shift_type='morning',
        )
        db.session.add(swap)
        db.session.commit()
        resp = client.get('/scheduling')
        assert resp.status_code == 200
        assert b'01/06/2026' in resp.data
