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
            assert any('rest before' in e.lower() for e in errors)
            # Suggested start should be 14:00 + 8h = 22:00
            assert suggested_start == datetime(2026, 6, 15, 22, 0)

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
            assert any('rest after' in e.lower() for e in errors)
            # Suggested end: next_start(06:00 on 16th) - 8h = 22:00 on 15th
            assert suggested_end == datetime(2026, 6, 15, 22, 0)

    def test_max_16h_violation(self, db):
        """Driver with late shift 16:00-02:00 (10h) cannot add extra 08:00-18:00 (10h) = 20h."""
        with flask_app.app_context():
            ref = date(2026, 6, 15)
            driver = self._make_driver_on_late_shift(db, ref)
            req = make_extra_request(db, req_date=ref, window_start='08:00', window_end='18:00')
            p_start = datetime(2026, 6, 15, 10, 0)   # after rest
            p_end = datetime(2026, 6, 15, 18, 0)
            valid, errors, _, _ = validate_extra_car_assignment(driver, req, p_start, p_end)
            assert not valid
            assert any('24' in e or '16' in e for e in errors)

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
        """09:30–16:30 (7h in an 08-18 window) ≥ 2h threshold → counts as 1 slot."""
        with flask_app.app_context():
            driver = make_driver(db, '1', 'Driver')
            req = make_extra_request(db, required_slots=5, window_start='08:00', window_end='18:00')
            make_extra_assignment(db, req, driver, start='09:30', end='16:30')
            filled, status = req.compute_coverage()
            assert filled == 1

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
            assert any('rest before' in e.lower() for e in errors)
