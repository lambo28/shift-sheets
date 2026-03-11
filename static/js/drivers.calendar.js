/**
 * drivers.calendar.js
 * Driver calendar modal logic for Driver Management
 */

let driverCalendarState = {
    driverId: null,
    driverNumber: '',
    driverName: '',
    monthDate: null,
};

function toCalendarMonthParam(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function escapeDriverCalendarHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderDriverCalendar(data) {
    const body = document.getElementById('driverCalendarBody');
    const monthLabel = document.getElementById('driverCalendarMonthLabel');
    if (!body || !monthLabel) return;

    monthLabel.textContent = data.month_label || '';

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const firstWeekday = Number(data.first_weekday || 0);
    const dayCells = [];

    for (let i = 0; i < firstWeekday; i++) {
        dayCells.push('<td class="cal-empty"></td>');
    }

    (data.days || []).forEach((day) => {
        const lateStart = Array.isArray(day.adjustments)
            ? day.adjustments.find((adj) => adj.adjustment_type === 'late_start')
            : null;
        const earlyFinish = Array.isArray(day.adjustments)
            ? day.adjustments.find((adj) => adj.adjustment_type === 'early_finish')
            : null;

        const toMinutes = (timeValue) => {
            if (!timeValue || typeof timeValue !== 'string' || !timeValue.includes(':')) return null;
            const [hours, mins] = timeValue.split(':').map((v) => parseInt(v, 10));
            if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
            return (hours * 60) + mins;
        };

        const toTimeText = (minutesValue) => {
            if (minutesValue === null || minutesValue === undefined) return '';
            const hrs = String(Math.floor(minutesValue / 60)).padStart(2, '0');
            const mins = String(minutesValue % 60).padStart(2, '0');
            return `${hrs}:${mins}`;
        };

        const hasDayOffShift = Array.isArray(day.shifts)
            ? day.shifts.some((shift) => shift.shift_type === 'day_off' || shift.label === 'OFF')
            : false;

        const shiftBadges = [];
        const bottomTimeTokens = [];

        (day.shifts || []).forEach((shift) => {
            const startMinutes = toMinutes(shift.start_time);
            const endMinutes = toMinutes(shift.end_time);
            const defaultStartMinutes = toMinutes(shift.default_start_time) ?? startMinutes;
            const defaultEndMinutes = toMinutes(shift.default_end_time) ?? endMinutes;

            const effectiveStartMinutes = startMinutes;
            const effectiveEndMinutes = endMinutes;

            const startText = toTimeText(effectiveStartMinutes);
            const endText = toTimeText(effectiveEndMinutes);
            const hasTime = Boolean(startText || endText);
            const rangeText = hasTime
                ? `${startText}${startText && endText ? '–' : ''}${endText}`
                : '';

            const isChangedFromDefault =
                (effectiveStartMinutes !== null || defaultStartMinutes !== null)
                    ? effectiveStartMinutes !== defaultStartMinutes
                    : false
                ||
                (effectiveEndMinutes !== null || defaultEndMinutes !== null)
                    ? effectiveEndMinutes !== defaultEndMinutes
                    : false;

            if (!day.is_holiday && !hasDayOffShift && rangeText && isChangedFromDefault) {
                bottomTimeTokens.push(`<span class="cal-shift-time-changed">${rangeText}</span>`);
            }

            const shiftIconHtml = (shift.shift_type === 'day_off' || shift.label === 'OFF')
                ? ''
                : `<i class="${shift.icon || 'fas fa-clock'} text-white"></i>`;
            const swapIconHtml = shift.is_swap
                ? `<i class="fas fa-right-left ms-1" title="Swapped shift" aria-label="Swapped shift"></i>`
                : '';
            shiftBadges.push(`<span class="badge ${shift.badge_color || 'bg-primary'} cal-shift-box"><span class="cal-shift-label">${shiftIconHtml}${shift.label}${swapIconHtml}</span></span>`);
        });

        const shiftsHtml = shiftBadges.join('');
        const bottomTimesHtml = bottomTimeTokens.join('');

        let timeOffHtml = '';
        if (day.is_holiday) {
            const type = day.time_off_type || 'other';
            const typeLabelMap = {
                holiday: 'Holiday',
                sickness: 'Sickness',
                vor: 'VOR',
                other: 'Time Off'
            };
            const typeIconMap = {
                holiday: 'fa-umbrella-beach',
                sickness: 'fa-notes-medical',
                vor: 'fa-wrench',
                other: 'fa-user-clock'
            };
            const typeBadgeMap = {
                holiday: 'bg-warning text-dark',
                sickness: 'bg-danger',
                vor: 'bg-secondary',
                other: 'bg-info text-dark'
            };
            const label = typeLabelMap[type] || 'Time Off';
            const icon = typeIconMap[type] || 'fa-user-clock';
            const badgeClass = typeBadgeMap[type] || 'bg-info text-dark';
            timeOffHtml = `<span class="badge ${badgeClass} cal-shift-box cal-timeoff" data-bs-toggle="tooltip" data-bs-placement="top" title="Driver marked as ${escapeDriverCalendarHtml(label)}"><span class="cal-shift-label"><i class="fas ${icon}"></i>OFF</span></span>`;
        }

        const lateStartIconHtml = lateStart
            ? `<span class="cal-adjustment-icon badge-late-start-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeDriverCalendarHtml(`${lateStart.label} at ${lateStart.time}${lateStart.notes ? ` — ${lateStart.notes}` : ''}`)}"><i class="fas fa-hourglass-start"></i></span>`
            : '';
        const earlyFinishIconHtml = earlyFinish
            ? `<span class="cal-adjustment-icon badge-early-finish-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeDriverCalendarHtml(`${earlyFinish.label} at ${earlyFinish.time}${earlyFinish.notes ? ` — ${earlyFinish.notes}` : ''}`)}"><i class="fas fa-hourglass-end"></i></span>`
            : '';

        const contentHtml = `${shiftsHtml}${timeOffHtml}` || '<small class="text-muted">No shift</small>';

        const cellClass = day.is_today ? 'table-warning' : '';

        dayCells.push(`
            <td class="cal-day ${cellClass}">
                <div class="cal-day-header">
                    <div class="fw-bold small">${day.day}</div>
                </div>
                <div class="cal-day-shifts">${contentHtml}</div>
                <div class="cal-day-bottom">
                    <div class="cal-day-bottom-left">${lateStartIconHtml}</div>
                    <div class="cal-day-bottom-center">${bottomTimesHtml}</div>
                    <div class="cal-day-bottom-right">${earlyFinishIconHtml}</div>
                </div>
            </td>
        `);
    });

    while (dayCells.length % 7 !== 0) {
        dayCells.push('<td class="cal-empty"></td>');
    }

    const rows = [];
    for (let i = 0; i < dayCells.length; i += 7) {
        rows.push(`<tr>${dayCells.slice(i, i + 7).join('')}</tr>`);
    }

    body.innerHTML = `
        <div class="holiday-calendar readonly">
            <table class="table table-bordered align-middle mb-0">
                <thead class="table-light">
                    <tr>${weekdays.map((name) => `<th class="text-center">${name}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.join('')}
                </tbody>
            </table>
        </div>
    `;

    if (window.bootstrap && window.bootstrap.Tooltip) {
        body.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
            window.bootstrap.Tooltip.getOrCreateInstance(el);
        });
    }
}

function loadDriverCalendar() {
    if (!driverCalendarState.driverId || !driverCalendarState.monthDate) return;

    const body = document.getElementById('driverCalendarBody');
    const title = document.getElementById('driverCalendarTitle');
    if (title) {
        const displayDriver = driverCalendarState.driverNumber
            ? `#${driverCalendarState.driverNumber} ${driverCalendarState.driverName}`
            : driverCalendarState.driverName;
        title.textContent = `Driver Calendar - ${displayDriver}`;
    }
    if (body) {
        body.innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-spinner fa-spin"></i> Loading calendar...</div>';
    }

    const monthParam = toCalendarMonthParam(driverCalendarState.monthDate);
    fetch(`/driver/${driverCalendarState.driverId}/calendar-data?month=${monthParam}`, {
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then((data) => {
            if (!data.success) throw new Error(data.error || 'Failed to load calendar');
            renderDriverCalendar(data);
        })
        .catch((err) => {
            if (body) {
                body.innerHTML = `<div class="alert alert-danger mb-0">${err.message || 'Error loading calendar.'}</div>`;
            }
        });
}

function initializeDriverCalendarModule() {
    document.getElementById('driverCalendarPrevMonth')?.addEventListener('click', function() {
        if (!driverCalendarState.monthDate) return;
        driverCalendarState.monthDate = new Date(driverCalendarState.monthDate.getFullYear(), driverCalendarState.monthDate.getMonth() - 1, 1);
        loadDriverCalendar();
    });

    document.getElementById('driverCalendarNextMonth')?.addEventListener('click', function() {
        if (!driverCalendarState.monthDate) return;
        driverCalendarState.monthDate = new Date(driverCalendarState.monthDate.getFullYear(), driverCalendarState.monthDate.getMonth() + 1, 1);
        loadDriverCalendar();
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.show-driver-calendar-btn')) {
            return;
        }

        const btn = e.target.closest('.show-driver-calendar-btn');
        const driverId = btn.getAttribute('data-driver-id');
        const driverNumber = btn.getAttribute('data-driver-number') || '';
        const driverName = btn.getAttribute('data-driver-name') || '';

        driverCalendarState.driverId = driverId;
        driverCalendarState.driverNumber = driverNumber;
        driverCalendarState.driverName = driverName;
        driverCalendarState.monthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        loadDriverCalendar();
        new bootstrap.Modal(document.getElementById('driverCalendarModal')).show();
    });
}
