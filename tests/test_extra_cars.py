"""
tests/test_extra_cars.py
Tests for the Extra Cars section: request creation, assignment validation,
coverage/slot counting, and status transitions.
"""
import pytest
from datetime import date, time, datetime, timedelta

from app import app as flask_app, db as _db
from app import (
    Driver, ShiftTiming, ShiftPattern, DriverAssignment,
    ExtraCarRequest, ExtraCarAssignment,
    DriverHoliday, ShiftAdjustment, DriverCustomTiming,
    validate_extra_car_assignment, get_driver_all_work_intervals,
    MIN_REST_HOURS, MAX_WORK_HOURS_PER_24H,
)
from tests.conftest import make_driver, make_shift_timing, make_pattern, make_assignment


# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

def make_extra_request(
    db,
    req_date=None,
    request_type='time_window',
    shift_type=None,
    window_start='08:00',
    window_end='18:00',
    unlimited=False,
    required_slots=1,
    min_partial_hours=2.0,
    status='OPEN',
    notes=None,
):
    req_date = req_date or date(2026, 6, 15)
    wstart = time.fromisoformat(window_start) if window_start else None
    wend = time.fromisoformat(window_end) if window_end else None
    req = ExtraCarRequest(
        date=req_date,
        request_type=request_type,
        shift_type=shift_type,
        window_start=wstart,
        window_end=wend,
        unlimited=unlimited,
        required_slots=required_slots,
        min_partial_hours=min_partial_hours,
        status=status,
        notes=notes,
    )
    db.session.add(req)
    db.session.commit()
    return req


def make_extra_assignment(db, req, driver, start=None, end=None, notes=None):
    asgn = ExtraCarAssignment(
        request_id=req.id,
        driver_id=driver.id,
        start_time=time.fromisoformat(start) if start else None,
        end_time=time.fromisoformat(end) if end else None,
        notes=notes,
    )
    db.session.add(asgn)
    db.session.commit()
    return asgn


def make_driver_holiday(db, driver, holiday_date, time_off_type='holiday', notes=None):
    holiday = DriverHoliday(
        driver_id=driver.id,
        holiday_date=holiday_date,
        time_off_type=time_off_type,
        notes=notes,
    )
    db.session.add(holiday)
    db.session.commit()
    return holiday


def make_shift_adjustment(db, driver, adjustment_date, adjustment_type, adjusted_time, notes=None):
    adjustment = ShiftAdjustment(
        driver_id=driver.id,
        adjustment_date=adjustment_date,
        adjustment_type=adjustment_type,
        adjusted_time=time.fromisoformat(adjusted_time) if isinstance(adjusted_time, str) else adjusted_time,
        notes=notes,
    )
    db.session.add(adjustment)
    db.session.commit()
    return adjustment


def make_custom_timing(
    db,
    driver,
    assignment=None,
    shift_type=None,
    day_of_cycle=None,
    day_of_week=None,
    override_shift=None,
    start_time=None,
    end_time=None,
    priority=4,
    notes=None,
):
    timing = DriverCustomTiming(
        driver_id=driver.id,
        assignment_id=assignment.id if assignment else None,
        shift_type=shift_type,
        day_of_cycle=day_of_cycle,
        day_of_week=day_of_week,
        override_shift=override_shift,
        start_time=time.fromisoformat(start_time) if isinstance(start_time, str) else start_time,
        end_time=time.fromisoformat(end_time) if isinstance(end_time, str) else end_time,
        priority=priority,
        notes=notes,
    )
    db.session.add(timing)
    db.session.commit()
    return timing


# ===========================================================================
# Request creation (via route)
# ===========================================================================

class TestExtraCarRequestCreation:
    def test_create_time_window_request(self, client, db):
        resp = client.post('/extra-cars/request/add', data={
            'date': '2026-07-01',
            'request_type': 'time_window',
            'window_start': '08:00',
            'window_end': '18:00',
            'required_slots': '3',
            'min_partial_hours': '2',
        }, follow_redirects=True)
        assert resp.status_code == 200
        with flask_app.app_context():
            req = ExtraCarRequest.query.first()
            assert req is not None
            assert req.request_type == 'time_window'
            assert req.window_start == time(8, 0)
            assert req.window_end == time(18, 0)
            assert req.required_slots == 3
            assert not req.unlimited

    def test_create_shift_type_request(self, client, db):
        with flask_app.app_context():
            make_shift_timing(db, 'morning', '06:00', '14:00')
        resp = client.post('/extra-cars/request/add', data={
            'date': '2026-07-01',
            'request_type': 'shift_type',
            'shift_type': 'morning',
            'required_slots': '2',
            'min_partial_hours': '2',
        }, follow_redirects=True)
        assert resp.status_code == 200
        with flask_app.app_context():
            req = ExtraCarRequest.query.first()
            assert req is not None
            assert req.request_type == 'shift_type'
            assert req.shift_type == 'morning'

    def test_create_unlimited_request(self, client, db):
        resp = client.post('/extra-cars/request/add', data={
            'date': '2026-07-01',
            'request_type': 'time_window',
            'window_start': '09:00',
            'window_end': '17:00',
            'unlimited': '1',
            'min_partial_hours': '2',
        }, follow_redirects=True)
        assert resp.status_code == 200
        with flask_app.app_context():
            req = ExtraCarRequest.query.first()
            assert req is not None
            assert req.unlimited is True
            assert req.required_slots is None

    def test_create_request_missing_date_rejected(self, client, db):
        resp = client.post('/extra-cars/request/add', data={
            'request_type': 'time_window',
            'window_start': '08:00',
            'window_end': '18:00',
            'required_slots': '1',
        }, follow_redirects=True)
        assert resp.status_code == 200
        with flask_app.app_context():
            assert ExtraCarRequest.query.count() == 0

    def test_create_request_invalid_shift_type_rejected(self, client, db):
        resp = client.post('/extra-cars/request/add', data={
            'date': '2026-07-01',
            'request_type': 'shift_type',
            'shift_type': 'nonexistent_shift',
            'required_slots': '1',
        }, follow_redirects=True)
        assert resp.status_code == 200
        with flask_app.app_context():
            assert ExtraCarRequest.query.count() == 0


# ===========================================================================
# Shift-type window resolution
# ===========================================================================

class TestRequestTimeWindow:
    def test_shift_type_window_resolved_from_timing(self, db):
        with flask_app.app_context():
            make_shift_timing(db, 'late', '16:00', '02:00')
            req = make_extra_request(
                db,
                req_date=date(2026, 6, 15),
                request_type='shift_type',
                shift_type='late',
                window_start=None,
                window_end=None,
            )
            start, end = req.get_time_window()
            assert start == datetime(2026, 6, 15, 16, 0)
            assert end == datetime(2026, 6, 16, 2, 0)   # crosses midnight

    def test_time_window_request_resolved_directly(self, db):
        with flask_app.app_context():
            req = make_extra_request(db, window_start='09:00', window_end='17:00')
            start, end = req.get_time_window()
            assert start.hour == 9
            assert end.hour == 17

    def test_overnight_window_crosses_midnight(self, db):
        with flask_app.app_context():
            req = make_extra_request(db, window_start='22:00', window_end='06:00')
            start, end = req.get_time_window()
            # end should be the next day
            assert end > start
            assert (end - start).total_seconds() / 3600 == 8.0


# ===========================================================================
# Work-rule validation
# ===========================================================================

class TestWorkRuleValidation:
    """Tests for validate_extra_car_assignment()."""

    def _make_driver_on_late_shift(self, db, ref_date):
        """Create a driver with a late (16:00–02:00) shift on ref_date."""
        make_shift_timing(db, 'late', '16:00', '02:00')
        driver = make_driver(db, '99', 'Late Driver')
        pattern = make_pattern(db, 'Late Pattern', 7,
            ['late', 'late', 'late', 'late', 'late', 'late', 'late'])
        make_assignment(db, driver, pattern, ref_date - timedelta(days=7))
        return driver

    def test_valid_assignment_within_rest_rules(self, db):
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'morning', '06:00', '14:00')
            driver = make_driver(db, '1', 'Morning Driver')
            pattern = make_pattern(db, 'Morn', 7,
                ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref - timedelta(days=7))

            req = make_extra_request(db, req_date=date(2026, 6, 16),
                                     window_start='16:00', window_end='20:00')
            # Driver's morning ends 14:00, next extra starts 16:00 (2h gap).
            # 14:00 on ref, 16:00 on ref+1 = 26h gap. Fine.
            p_start = datetime(2026, 6, 16, 16, 0)
            p_end = datetime(2026, 6, 16, 20, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert valid
            assert errors == []

    def test_rest_before_violation(self, db):
        """Driver ends shift at 14:00; assignment starts at 18:00 same day (4h rest < 8h)."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'morning', '06:00', '14:00')
            driver = make_driver(db, '2', 'Test Driver')
            pattern = make_pattern(db, 'P', 7,
                ['morning', 'morning', 'morning', 'morning', 'morning', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref - timedelta(days=7))

            req = make_extra_request(db, req_date=ref, window_start='18:00', window_end='22:00')
            p_start = datetime(2026, 6, 15, 18, 0)
            p_end = datetime(2026, 6, 15, 22, 0)
            valid, errors, suggested_start, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert not valid
            assert len(errors) == 1
            assert 'no legal assignment window' in errors[0].lower()
            assert suggested_start is None

    def test_rest_after_violation(self, db):
        """Assignment ends at 22:00; driver's next shift starts at 06:00 (8h gap exactly ok,
        but if gap < 8h it should fail)."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'morning', '06:00', '14:00')
            driver = make_driver(db, '3', 'Driver Three')
            pattern = make_pattern(db, 'Q', 7,
                ['morning', 'morning', 'morning', 'morning', 'morning', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref - timedelta(days=7))

            # Extra ends at 23:00; next morning starts 06:00 (7h rest < 8h)
            req = make_extra_request(db, req_date=ref, window_start='15:00', window_end='23:00')
            p_start = datetime(2026, 6, 15, 15, 0)
            p_end = datetime(2026, 6, 15, 23, 0)
            valid, errors, _, suggested_end = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert not valid
            assert len(errors) == 1
            assert 'no legal assignment window' in errors[0].lower()
            assert suggested_end is None

    def test_max_16h_violation(self, db):
        """A driver already covering >16h in 24h should fail validation.
        When the proposed window falls entirely within existing work, it will be blocked
        by the overlap check (net-new hours = 0).  Either the 24h-cap error or the
        net-new-hours error is acceptable — both indicate the driver can't take more work.
        """
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            driver = make_driver(db, '88', 'Long Day Driver')

            req_a = make_extra_request(db, req_date=ref, window_start='00:00', window_end='12:00')
            req_b = make_extra_request(db, req_date=ref, window_start='08:00', window_end='20:00')
            make_extra_assignment(db, req_a, driver)
            make_extra_assignment(db, req_b, driver)

            req = make_extra_request(db, req_date=ref, window_start='09:00', window_end='10:00')
            p_start = datetime(2026, 6, 15, 9, 0)
            p_end = datetime(2026, 6, 15, 10, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert not valid
            assert any('24' in e or '16' in e or 'net-new' in e.lower() or 'already works' in e.lower()
                       for e in errors)

    def test_late_shift_driver_adjusted_start(self, db):
        """Driver with previous day late 16:00-02:00 cannot start extra before 10:00."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            driver = self._make_driver_on_late_shift(db, ref)
            # previous day late shift ends 02:00 on ref; rest = 8h → earliest start = 10:00
            req = make_extra_request(db, req_date=ref, window_start='08:00', window_end='18:00')
            p_start = datetime(2026, 6, 15, 8, 0)
            p_end = datetime(2026, 6, 15, 18, 0)
            valid, errors, suggested_start, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert not valid
            assert any('rest before' in e.lower() for e in errors)
            assert suggested_start == datetime(2026, 6, 15, 10, 0)

    def test_valid_assignment_no_existing_shifts(self, db):
        """Driver with no existing shifts should always pass rest/hours checks."""
        with flask_app.app_context():
            driver = make_driver(db, '50', 'Free Driver')
            req = make_extra_request(db, req_date=date(2026, 6, 15),
                                     window_start='08:00', window_end='18:00')
            p_start = datetime(2026, 6, 15, 8, 0)
            p_end = datetime(2026, 6, 15, 18, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert valid
            assert errors == []

    def test_overlapping_existing_intervals_not_double_counted_for_24h_limit(self, db):
        """Overlapping existing work should be merged before rolling 24h hour checks."""
        with flask_app.app_context():
            driver = make_driver(db, '51', 'Overlap Driver')
            work_day = date(2026, 6, 15)

            req1 = make_extra_request(db, req_date=work_day, window_start='08:00', window_end='18:00')
            req2 = make_extra_request(db, req_date=work_day, window_start='12:00', window_end='22:00')
            make_extra_assignment(db, req1, driver)
            make_extra_assignment(db, req2, driver)

            next_req = make_extra_request(
                db,
                req_date=date(2026, 6, 16),
                window_start='06:00',
                window_end='10:00',
            )
            p_start = datetime(2026, 6, 16, 6, 0)
            p_end = datetime(2026, 6, 16, 10, 0)

            valid, errors, _, _ = validate_extra_car_assignment(driver, next_req, p_start, p_end)
            assert valid
            assert not any('24-hour' in e.lower() or 'maximum' in e.lower() for e in errors)

    def test_extra_directly_before_scheduled_shift_is_allowed(self, db):
        """Extra 10:00–16:00 immediately before a 16:00–02:00 shift should be valid.
        They form one combined block 10:00–02:00 (16h).  No internal rest is required
        because there is no gap — just one continuous stretch.
        The 8h rest check is only against the previous block (ending before 10:00).
        """
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'late_adj', '16:00', '02:00')
            driver = make_driver(db, '60', 'Late Adj Driver')
            pattern = make_pattern(db, 'Late Adj', 7,
                ['late_adj', 'late_adj', 'late_adj', 'late_adj', 'late_adj', 'late_adj', 'late_adj'])
            make_assignment(db, driver, pattern, ref - timedelta(days=7))

            req = make_extra_request(db, req_date=ref, window_start='10:00', window_end='16:00')
            p_start = datetime(2026, 6, 15, 10, 0)
            p_end = datetime(2026, 6, 15, 16, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert valid, f"Expected valid but got errors: {errors}"
            assert errors == []

    def test_extra_directly_after_scheduled_shift_is_allowed(self, db):
        """Extra 16:00–18:00 immediately after a 06:00–16:00 shift should be valid.
        They form one combined block 06:00–18:00 (12h), within the 16h cap.
        """
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'day_shift', '06:00', '16:00')
            driver = make_driver(db, '61', 'Day Shift Driver')
            pattern = make_pattern(db, 'Day Shift', 7,
                ['day_shift', 'day_shift', 'day_shift', 'day_shift', 'day_shift', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref - timedelta(days=7))

            req = make_extra_request(db, req_date=ref, window_start='16:00', window_end='18:00')
            p_start = datetime(2026, 6, 15, 16, 0)
            p_end = datetime(2026, 6, 15, 18, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert valid, f"Expected valid but got errors: {errors}"
            assert errors == []

    def test_extra_overlapping_scheduled_shift_blocked_below_min_benefit(self, db):
        """Extra 06:00–16:00 when driver is already on 08:00–18:00 scheduled shift.
        Net new = 06:00–08:00 = 2h, which equals MIN_OVERLAP_BENEFIT → should be allowed.
        But 06:00–07:00 (1h net new) should be blocked.
        """
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'main_shift', '08:00', '18:00')
            driver = make_driver(db, '62', 'Spare Driver')
            pattern = make_pattern(db, 'Main', 7,
                ['main_shift', 'main_shift', 'main_shift', 'main_shift', 'main_shift', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref - timedelta(days=7))

            req_bad = make_extra_request(db, req_date=ref, window_start='08:00', window_end='16:00')
            p_start = datetime(2026, 6, 15, 8, 0)
            p_end = datetime(2026, 6, 15, 16, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req_bad, p_start, p_end)
            assert not valid
            assert any('net-new' in e.lower() or 'already works' in e.lower() for e in errors)

    def test_extra_overlapping_scheduled_shift_allowed_with_enough_net_new(self, db):
        """Extra 06:00–08:00 when driver is 08:00–18:00.
        Net new = exactly 2h at the boundary; qualifies as worthwhile.
        Suggested window should trim to 06:00–08:00.
        """
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'main_s2', '08:00', '18:00')
            driver = make_driver(db, '63', 'Early Extra Driver')
            pattern = make_pattern(db, 'Main2', 7,
                ['main_s2', 'main_s2', 'main_s2', 'main_s2', 'main_s2', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref - timedelta(days=7))

            req = make_extra_request(db, req_date=ref, window_start='06:00', window_end='08:00')
            p_start = datetime(2026, 6, 15, 6, 0)
            p_end = datetime(2026, 6, 15, 8, 0)
            valid, errors, suggested_start, suggested_end = validate_extra_car_assignment(
                driver, req, p_start, p_end)
            assert valid, f"Expected valid but got errors: {errors}"
            assert errors == []

    def test_boundary_exactly_8h_rest_is_valid(self, db):
        """Exactly 8h rest should pass (not fail).
        Driver works morning 06:00-14:00 on ref; next day is off.
        Extra starts at 22:00 on ref (exactly 8h after 14:00) → should pass.
        """
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'morning', '06:00', '14:00')
            driver = make_driver(db, '4', 'Driver Four')
            # Only one working day, rest are off → no rest_after issue
            pattern = make_pattern(db, 'R', 7,
                ['morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref)

            req = make_extra_request(db, req_date=ref, window_start='22:00', window_end='23:00')
            p_start = datetime(2026, 6, 15, 22, 0)  # exactly 8h after 14:00
            p_end = datetime(2026, 6, 15, 23, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert valid

    def test_contradictory_rest_constraints_report_no_legal_window(self, db):
        """When rest-before and rest-after both fail with no overlap, show clear no-window error."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'morn_c', '06:00', '16:00')
            make_shift_timing(db, 'morn_next_c', '06:00', '16:00')
            driver = make_driver(db, '98', 'Tight Rest Driver')
            pattern = make_pattern(db, 'Tight Pattern', 7,
                ['morn_c', 'morn_next_c', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref)

            req = make_extra_request(db, req_date=ref, window_start='20:00', window_end='02:00')
            p_start = datetime(2026, 6, 15, 20, 0)
            p_end = datetime(2026, 6, 16, 2, 0)
            valid, errors, suggested_start, suggested_end = validate_extra_car_assignment(driver, req, p_start, p_end)

            assert not valid
            assert len(errors) == 1
            assert 'no legal assignment window' in errors[0].lower()
            assert suggested_start is None
            assert suggested_end is None

    def test_holiday_removes_scheduled_shift_from_validation(self, db):
        """A holiday should suppress the scheduled shift, so extra work is validated as if off-duty."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'holiday_morning', '06:00', '14:00')
            driver = make_driver(db, '101', 'Holiday Driver')
            pattern = make_pattern(db, 'Holiday Pattern', 7,
                ['holiday_morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref)
            make_driver_holiday(db, driver, ref, time_off_type='holiday')

            req = make_extra_request(db, req_date=ref, window_start='18:00', window_end='22:00')
            p_start = datetime(2026, 6, 15, 18, 0)
            p_end = datetime(2026, 6, 15, 22, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)

            assert valid
            assert errors == []

    def test_custom_timing_is_used_for_rest_validation(self, db):
        """Custom end time should tighten rest rules for extra work."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'custom_base', '06:00', '14:00')
            driver = make_driver(db, '102', 'Custom Timing Driver')
            pattern = make_pattern(db, 'Custom Pattern', 7,
                ['custom_base', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            assignment = make_assignment(db, driver, pattern, ref)
            make_custom_timing(
                db,
                driver,
                assignment=assignment,
                shift_type='custom_base',
                end_time='18:00',
                priority=1,
            )

            req = make_extra_request(db, req_date=ref, window_start='22:00', window_end='23:00')
            p_start = datetime(2026, 6, 15, 22, 0)
            p_end = datetime(2026, 6, 15, 23, 0)
            valid, errors, suggested_start, _ = validate_extra_car_assignment(driver, req, p_start, p_end)

            assert not valid
            assert len(errors) == 1
            assert 'no legal assignment window' in errors[0].lower()
            assert suggested_start is None

    def test_late_start_adjustment_is_used_for_rest_validation(self, db):
        """Late start next day should relax the after-rest boundary compared with the default shift."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'adj_morning', '06:00', '14:00')
            driver = make_driver(db, '103', 'Late Start Driver')
            pattern = make_pattern(db, 'Late Start Pattern', 7,
                ['day_off', 'adj_morning', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref)
            make_shift_adjustment(db, driver, ref + timedelta(days=1), 'late_start', '10:00')

            req = make_extra_request(db, req_date=ref, window_start='00:00', window_end='02:00')
            p_start = datetime(2026, 6, 16, 0, 0)
            p_end = datetime(2026, 6, 16, 2, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)

            assert valid
            assert errors == []

    def test_early_finish_adjustment_is_used_for_rest_validation(self, db):
        """Early finish same day should relax the rest-before boundary for extra work."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'adj_day', '06:00', '16:00')
            driver = make_driver(db, '104', 'Early Finish Driver')
            pattern = make_pattern(db, 'Early Finish Pattern', 7,
                ['adj_day', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref)
            make_shift_adjustment(db, driver, ref, 'early_finish', '12:00')

            req = make_extra_request(db, req_date=ref, window_start='20:00', window_end='22:00')
            p_start = datetime(2026, 6, 15, 20, 0)
            p_end = datetime(2026, 6, 15, 22, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)

            assert valid
            assert errors == []


# ===========================================================================
# Coverage / slot counting
# ===========================================================================

class TestCoverageComputation:
    def test_single_full_window_assignment_counts_as_one_slot(self, db):
        with flask_app.app_context():
            driver = make_driver(db, '1', 'Driver')
            req = make_extra_request(db, required_slots=5, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, driver)  # full window
            filled, status = req.compute_coverage()
            assert filled == 1
            assert status == 'PARTIALLY_FILLED'

    def test_handover_two_cars_counts_as_one_slot(self, db):
        """Car A 08-13 + Car B 13-18 should count as ONE slot (handover model)."""
        with flask_app.app_context():
            d1 = make_driver(db, '1', 'Driver A')
            d2 = make_driver(db, '2', 'Driver B')
            req = make_extra_request(db, required_slots=5, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, d1, start='08:00', end='13:00')
            make_extra_assignment(db, req, d2, start='13:00', end='18:00')
            filled, status = req.compute_coverage()
            assert filled == 1

    def test_substantial_partial_counts_as_one_slot(self, db):
        """09:30–16:30 leaves only two 1.5h gaps, both below the minimum allocatable threshold."""
        with flask_app.app_context():
            driver = make_driver(db, '1', 'Driver')
            req = make_extra_request(db, required_slots=5, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, driver, start='09:30', end='16:30')
            filled, status = req.compute_coverage()
            assert filled == 1
            assert status == 'PARTIALLY_FILLED'

    def test_single_slot_handover_partial_then_complete(self, db):
        """For one-slot 16:00-02:00, 16:00-22:00 is partial; adding 22:00-02:00 completes it."""
        with flask_app.app_context():
            d1 = make_driver(db, '71', 'Driver One')
            d2 = make_driver(db, '72', 'Driver Two')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
                min_partial_hours=2.0,
            )

            make_extra_assignment(db, req, d1, start='16:00', end='22:00')
            filled_before, status_before = req.compute_coverage()
            assert filled_before == 0
            assert status_before == 'PARTIALLY_FILLED'

            make_extra_assignment(db, req, d2, start='22:00', end='02:00')
            filled_after, status_after = req.compute_coverage()
            assert filled_after == 1
            assert status_after == 'FILLED'

    def test_short_partial_under_threshold_not_counted(self, db):
        """A 1-hour contribution (< 2h min_partial_hours) should NOT count."""
        with flask_app.app_context():
            driver = make_driver(db, '1', 'Driver')
            req = make_extra_request(db, required_slots=5, window_start='08:00', window_end='18:00',
                                     min_partial_hours=2.0)
            make_extra_assignment(db, req, driver, start='08:00', end='09:00')  # 1h only
            filled, status = req.compute_coverage()
            assert filled == 0
            assert status == 'OPEN'

    def test_parallel_cars_each_count_as_separate_slot(self, db):
        """Two cars both covering 08:00-18:00 = 2 parallel slots."""
        with flask_app.app_context():
            d1 = make_driver(db, '1', 'Driver A')
            d2 = make_driver(db, '2', 'Driver B')
            req = make_extra_request(db, required_slots=5, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, d1)
            make_extra_assignment(db, req, d2)
            filled, _ = req.compute_coverage()
            assert filled == 2

    def test_handover_plus_parallel_car(self, db):
        """Car A (08-13) + Car B (13-18) handover = 1 slot; Car C (08-18) = 1 more slot."""
        with flask_app.app_context():
            d1 = make_driver(db, '1', 'Driver A')
            d2 = make_driver(db, '2', 'Driver B')
            d3 = make_driver(db, '3', 'Driver C')
            req = make_extra_request(db, required_slots=5, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, d1, start='08:00', end='13:00')
            make_extra_assignment(db, req, d2, start='13:00', end='18:00')
            make_extra_assignment(db, req, d3)
            filled, _ = req.compute_coverage()
            assert filled == 2

    def test_status_open_when_no_assignments(self, db):
        with flask_app.app_context():
            req = make_extra_request(db, required_slots=2)
            filled, status = req.compute_coverage()
            assert filled == 0
            assert status == 'OPEN'

    def test_status_partially_filled(self, db):
        with flask_app.app_context():
            driver = make_driver(db, '1', 'D')
            req = make_extra_request(db, required_slots=3, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, driver)
            filled, status = req.compute_coverage()
            assert filled == 1
            assert status == 'PARTIALLY_FILLED'

    def test_status_filled_when_all_slots_covered(self, db):
        with flask_app.app_context():
            d1 = make_driver(db, '1', 'D1')
            d2 = make_driver(db, '2', 'D2')
            req = make_extra_request(db, required_slots=2, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, d1)
            make_extra_assignment(db, req, d2)
            filled, status = req.compute_coverage()
            assert filled == 2
            assert status == 'FILLED'

    def test_unlimited_request_never_auto_fills(self, db):
        """For unlimited requests compute_coverage should never return FILLED."""
        with flask_app.app_context():
            d1 = make_driver(db, '1', 'D1')
            d2 = make_driver(db, '2', 'D2')
            req = make_extra_request(db, unlimited=True, required_slots=None,
                                     window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, d1)
            make_extra_assignment(db, req, d2)
            filled, status = req.compute_coverage()
            assert status == 'PARTIALLY_FILLED'

    def test_coverage_clips_to_request_window(self, db):
        """Assignment outside request window should only count clipped portion."""
        with flask_app.app_context():
            driver = make_driver(db, '1', 'D')
            # Request 10:00-14:00 (4h window)
            req = make_extra_request(db, required_slots=1,
                                     window_start='10:00', window_end='14:00',
                                     min_partial_hours=2.0)
            # Assignment 08:00-11:00 → clipped to 10:00-11:00 = 1h < 2h → not counted
            make_extra_assignment(db, req, driver, start='08:00', end='11:00')
            filled, status = req.compute_coverage()
            assert filled == 0

    def test_tiny_remaining_gap_under_min_partial_counts_as_filled(self, db):
        """For 1-slot 16:00-02:00, 16:00-01:00 leaves 1h (<2h), so slot is effectively filled."""
        with flask_app.app_context():
            driver = make_driver(db, '91', 'Driver')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
                min_partial_hours=2.0,
            )
            make_extra_assignment(db, req, driver, start='16:00', end='01:00')
            filled, status = req.compute_coverage()
            assert filled == 1
            assert status == 'FILLED'

    def test_split_tiny_gaps_under_min_partial_counts_as_filled(self, db):
        """17:59-00:01 leaves <2h before and after; both are non-allocatable so slot is filled."""
        with flask_app.app_context():
            driver = make_driver(db, '92', 'Driver')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
                min_partial_hours=2.0,
            )
            make_extra_assignment(db, req, driver, start='17:59', end='00:01')
            filled, status = req.compute_coverage()
            assert filled == 1
            assert status == 'FILLED'

    def test_duration_hours_handles_midnight_start_time(self, db):
        """Assignment 00:00-02:00 in an overnight request should report 2.0h, not 0.0h."""
        with flask_app.app_context():
            driver = make_driver(db, '97', 'Midnight Driver')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
                min_partial_hours=2.0,
            )
            asgn = make_extra_assignment(db, req, driver, start='00:00', end='02:00')
            assert asgn.duration_hours() == 2.0


# ===========================================================================
# Status transitions
# ===========================================================================

class TestStatusTransitions:
    def test_status_updates_via_route(self, client, db):
        with flask_app.app_context():
            req = make_extra_request(db)
            req_id = req.id

        resp = client.post(f'/extra-cars/request/{req_id}/status',
                           data={'status': 'CLOSED'},
                           follow_redirects=True)
        assert resp.status_code == 200
        with flask_app.app_context():
            req = db.session.get(ExtraCarRequest, req_id)
            assert req.status == 'CLOSED'

    def test_closed_status_preserved_by_coverage(self, db):
        """CLOSED requests should not have status overwritten by compute_coverage."""
        with flask_app.app_context():
            driver = make_driver(db, '1', 'D')
            req = make_extra_request(db, required_slots=1, status='CLOSED',
                                     window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, driver)
            filled, status = req.compute_coverage()
            assert status == 'CLOSED'

    def test_assignment_route_rejects_invalid_driver(self, client, db):
        with flask_app.app_context():
            req = make_extra_request(db)
            req_id = req.id

        resp = client.post(f'/extra-cars/request/{req_id}/assignment/add',
                           data={'driver_id': '9999'},
                           follow_redirects=True)
        assert resp.status_code == 200
        with flask_app.app_context():
            assert ExtraCarAssignment.query.count() == 0

    def test_delete_request_removes_assignments(self, client, db):
        with flask_app.app_context():
            driver = make_driver(db, '1', 'D')
            req = make_extra_request(db, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, driver)
            req_id = req.id

        resp = client.post(f'/extra-cars/request/{req_id}/delete',
                           follow_redirects=True)
        assert resp.status_code == 200
        with flask_app.app_context():
            assert ExtraCarRequest.query.count() == 0
            assert ExtraCarAssignment.query.count() == 0

    def test_duplicate_assignment_for_same_request_rejected(self, client, db):
        with flask_app.app_context():
            driver = make_driver(db, '11', 'Dup Driver')
            req = make_extra_request(db, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, driver, start='08:00', end='12:00')
            req_id = req.id
            driver_id = driver.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(driver_id), 'start_time': '12:00', 'end_time': '18:00'},
            follow_redirects=True,
        )
        assert resp.status_code == 200

        with flask_app.app_context():
            assert ExtraCarAssignment.query.filter_by(request_id=req_id, driver_id=driver_id).count() == 1

    def test_overlapping_assignment_is_trimmed_to_net_new_window(self, client, db):
        with flask_app.app_context():
            work_date = date(2026, 7, 7)
            make_shift_timing(db, 'day_overlap', '06:00', '16:00')
            driver = make_driver(db, '12', 'Overlap Save Driver')
            pattern = make_pattern(db, 'Overlap Save Pattern', 7,
                ['day_overlap', 'day_overlap', 'day_overlap', 'day_overlap', 'day_overlap', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, work_date - timedelta(days=7))

            req = make_extra_request(db, req_date=work_date, window_start='08:00', window_end='18:00')
            req_id = req.id
            driver_id = driver.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(driver_id), 'start_time': '08:00', 'end_time': '18:00'},
            follow_redirects=True,
        )
        assert resp.status_code == 200

        with flask_app.app_context():
            asgn = ExtraCarAssignment.query.filter_by(request_id=req_id, driver_id=driver_id).first()
            assert asgn is not None
            assert asgn.start_time == time(16, 0)  # trimmed start differs from request start (08:00)
            assert asgn.end_time == time(18, 0)    # end matches request end but is still saved

    def test_shift_type_extra_without_custom_times_shows_shift_name(self, client, db):
        """Verify that an extra car assigned to a shift_type request without custom times shows the shift name, not 'Custom'."""
        with flask_app.app_context():
            work_date = date(2026, 7, 7)
            make_shift_timing(db, 'early', '06:00', '14:00')
            driver = make_driver(db, '13', 'Shift Type Extra Driver')
            pattern = make_pattern(db, 'Day Off Pattern', 7,
                ['day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, work_date)

            # Create shift_type request for 'early'
            req = ExtraCarRequest(
                date=work_date,
                request_type='shift_type',
                shift_type='early',
                unlimited=False,
                required_slots=1,
                status='OPEN',
            )
            db.session.add(req)
            db.session.commit()
            req_id = req.id
            driver_id = driver.id

        # Assign without providing custom times
        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(driver_id)},
            follow_redirects=True,
        )
        assert resp.status_code == 200

        with flask_app.app_context():
            asgn = ExtraCarAssignment.query.filter_by(request_id=req_id, driver_id=driver_id).first()
            assert asgn is not None
            # Times are saved but should match the shift's nominal times
            assert asgn.start_time == time(6, 0)
            assert asgn.end_time == time(14, 0)
            
            # Verify label logic
            from app import get_driver_shifts_for_date
            timings_dict = {st.shift_type: st for st in ShiftTiming.query.all()}
            shifts = get_driver_shifts_for_date(driver, work_date, timings_dict, include_extra=True)
            extra_shift = next((s for s in shifts if s.get('is_extra')), None)
            assert extra_shift is not None
            assert extra_shift['label'] == 'Early', f"Expected label 'Early', got '{extra_shift['label']}'"

    def test_delete_assignment_updates_status(self, client, db):
        with flask_app.app_context():
            driver = make_driver(db, '1', 'D')
            req = make_extra_request(db, required_slots=1,
                                     window_start='08:00', window_end='18:00',
                                     status='FILLED')
            asgn = make_extra_assignment(db, req, driver)
            req_id = req.id
            asgn_id = asgn.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/{asgn_id}/delete',
            follow_redirects=True,
        )
        assert resp.status_code == 200
        with flask_app.app_context():
            req = db.session.get(ExtraCarRequest, req_id)
            assert req.status == 'OPEN'

    def test_assignment_rejected_when_capacity_already_fully_covered(self, client, db):
        with flask_app.app_context():
            d1 = make_driver(db, '81', 'Full Coverage Driver')
            d2 = make_driver(db, '82', 'Extra Driver')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
            )
            make_extra_assignment(db, req, d1)  # full window
            req_id = req.id
            d2_id = d2.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(d2_id), 'start_time': '18:00', 'end_time': '22:00'},
            follow_redirects=True,
        )
        assert resp.status_code == 200
        with flask_app.app_context():
            assert ExtraCarAssignment.query.filter_by(request_id=req_id).count() == 1

    def test_assignment_allowed_when_partial_window_still_uncovered(self, client, db):
        with flask_app.app_context():
            d1 = make_driver(db, '83', 'Partial Driver')
            d2 = make_driver(db, '84', 'Handover Driver')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
            )
            make_extra_assignment(db, req, d1, start='16:00', end='22:00')
            req_id = req.id
            d2_id = d2.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(d2_id), 'start_time': '22:00', 'end_time': '02:00'},
            follow_redirects=True,
        )
        assert resp.status_code == 200
        with flask_app.app_context():
            req = db.session.get(ExtraCarRequest, req_id)
            assert ExtraCarAssignment.query.filter_by(request_id=req_id).count() == 2
            filled, status = req.compute_coverage()
            assert filled == 1
            assert status == 'FILLED'

    def test_blank_times_auto_fill_to_available_window(self, client, db):
        with flask_app.app_context():
            d1 = make_driver(db, '85', 'First Driver')
            d2 = make_driver(db, '86', 'Second Driver')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
                min_partial_hours=2.0,
            )
            make_extra_assignment(db, req, d1, start='16:00', end='22:00')
            req_id = req.id
            d2_id = d2.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(d2_id), 'start_time': '', 'end_time': ''},
            follow_redirects=True,
        )
        assert resp.status_code == 200

        with flask_app.app_context():
            assignments = (
                ExtraCarAssignment.query
                .filter_by(request_id=req_id)
                .order_by(ExtraCarAssignment.id.asc())
                .all()
            )
            assert len(assignments) == 2
            auto_asgn = assignments[1]
            assert auto_asgn.start_time == time(22, 0)
            assert auto_asgn.end_time == time(2, 0)

    def test_full_window_rejected_when_only_partial_window_available(self, client, db):
        with flask_app.app_context():
            d1 = make_driver(db, '87', 'Cover Driver')
            d2 = make_driver(db, '88', 'Overbook Driver')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
                min_partial_hours=2.0,
            )
            make_extra_assignment(db, req, d1, start='16:00', end='22:00')
            req_id = req.id
            d2_id = d2.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(d2_id), 'start_time': '16:00', 'end_time': '02:00'},
            follow_redirects=True,
        )
        assert resp.status_code == 200

        with flask_app.app_context():
            assignments = ExtraCarAssignment.query.filter_by(request_id=req_id).all()
            assert len(assignments) == 1

    def test_one_hour_leftover_not_assignable_and_request_treated_full(self, client, db):
        with flask_app.app_context():
            d1 = make_driver(db, '93', 'Driver A')
            d2 = make_driver(db, '94', 'Driver B')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='16:00',
                window_end='02:00',
                min_partial_hours=2.0,
            )
            make_extra_assignment(db, req, d1, start='16:00', end='01:00')
            req_id = req.id
            d2_id = d2.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(d2_id), 'start_time': '01:00', 'end_time': '02:00'},
            follow_redirects=True,
        )
        assert resp.status_code == 200
        with flask_app.app_context():
            req = db.session.get(ExtraCarRequest, req_id)
            assignments = ExtraCarAssignment.query.filter_by(request_id=req_id).all()
            filled, status = req.compute_coverage()
            assert len(assignments) == 1
            assert filled == 1
            assert status == 'FILLED'

    def test_overnight_next_day_times_can_be_added(self, client, db):
        """01:00-04:00 in a 20:00-04:00 request should map to next-day hours and be accepted."""
        with flask_app.app_context():
            d1 = make_driver(db, '95', 'Driver A')
            d2 = make_driver(db, '96', 'Driver B')
            req = make_extra_request(
                db,
                required_slots=1,
                window_start='20:00',
                window_end='04:00',
                min_partial_hours=2.0,
            )
            make_extra_assignment(db, req, d1, start='20:00', end='01:00')
            req_id = req.id
            d2_id = d2.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/add',
            data={'driver_id': str(d2_id), 'start_time': '01:00', 'end_time': '04:00'},
            follow_redirects=True,
        )
        assert resp.status_code == 200
        with flask_app.app_context():
            req = db.session.get(ExtraCarRequest, req_id)
            assignments = (
                ExtraCarAssignment.query
                .filter_by(request_id=req_id)
                .order_by(ExtraCarAssignment.id.asc())
                .all()
            )
            assert len(assignments) == 2
            filled, status = req.compute_coverage()
            assert filled == 1
            assert status == 'FILLED'


# ===========================================================================
# Validation AJAX endpoint
# ===========================================================================

class TestValidationAjax:
    def test_validate_endpoint_valid_driver(self, client, db):
        with flask_app.app_context():
            driver = make_driver(db, '1', 'D')
            req = make_extra_request(db, window_start='08:00', window_end='18:00')
            req_id = req.id
            driver_id = driver.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/validate',
            json={'driver_id': driver_id, 'start_time': '', 'end_time': ''},
            content_type='application/json',
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['success'] is True
        assert data['valid'] is True
        assert data['errors'] == []

    def test_validate_endpoint_missing_driver(self, client, db):
        with flask_app.app_context():
            req = make_extra_request(db)
            req_id = req.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/validate',
            json={'driver_id': None},
            content_type='application/json',
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert data['success'] is False

    def test_validate_endpoint_rest_violation(self, client, db):
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            make_shift_timing(db, 'morning_v', '06:00', '14:00')
            driver = make_driver(db, '5', 'Validate Driver')
            pattern = make_pattern(db, 'VP', 7,
                ['morning_v', 'morning_v', 'morning_v',
                 'morning_v', 'morning_v', 'day_off', 'day_off'])
            make_assignment(db, driver, pattern, ref - timedelta(days=7))
            req = make_extra_request(db, req_date=ref,
                                     window_start='18:00', window_end='22:00')
            req_id = req.id
            driver_id = driver.id

        resp = client.post(
            f'/extra-cars/request/{req_id}/assignment/validate',
            json={'driver_id': driver_id, 'start_time': '18:00', 'end_time': '22:00'},
            content_type='application/json',
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['valid'] is False
        assert len(data['errors']) > 0


# ===========================================================================
# Extra-car intervals included in future validation
# ===========================================================================

class TestExtraCarIntervals:
    def test_existing_extra_assignment_counted_in_intervals(self, db):
        """A driver's existing extra-car assignment should be counted in
        get_driver_all_work_intervals so a second assignment can't violate rest."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            driver = make_driver(db, '1', 'D')

            # First extra-car request: 08:00-14:00
            req1 = make_extra_request(db, req_date=ref,
                                      window_start='08:00', window_end='14:00',
                                      required_slots=1, status='OPEN')
            make_extra_assignment(db, req1, driver)

            # Second extra-car request: 18:00-22:00 (4h after first ends = < 8h rest)
            req2 = make_extra_request(db, req_date=ref,
                                      window_start='18:00', window_end='22:00',
                                      required_slots=1, status='OPEN')
            p_start = datetime(2026, 6, 15, 18, 0)
            p_end = datetime(2026, 6, 15, 22, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req2, p_start, p_end)
            assert not valid
            assert len(errors) == 1
            assert 'no legal assignment window' in errors[0].lower()
