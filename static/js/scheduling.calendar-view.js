/**
 * scheduling.calendar-view.js
 * Calendar view modal rendering for all drivers' time off.
 */

// ---------------------------------------------------------------------------
// Calendar View Modal
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    let calViewModalDate = new Date();
    calViewModalDate.setDate(1);
    let calViewModalData = {};

    const typeColorMap = {
        'holiday': '#ffc107',
        'sickness': '#dc3545',
        'vor': '#6c757d',
        'other': '#0dcaf0'
    };

    /**
     * Fetch all drivers' time off for the given month
     */
    const schoolTermRanges = [];
    const schoolClosureDates = new Set();

    function loadSchoolTerms() {
        const el = document.getElementById('schoolTermsDataEl');
        if (!el) return;
        try {
            const starts = JSON.parse(el.getAttribute('data-term-starts') || '[]');
            const ends = JSON.parse(el.getAttribute('data-term-ends') || '[]');
            const closures = JSON.parse(el.getAttribute('data-closure-dates') || '[]');
            for (let i = 0; i < starts.length; i++) {
                if (starts[i] && ends[i]) {
                    schoolTermRanges.push({ start: String(starts[i]), end: String(ends[i]) });
                }
            }
            closures.forEach(function (dateStr) {
                if (dateStr) schoolClosureDates.add(String(dateStr));
            });
        } catch (e) { }
    }

    function isWeekendISO(dateStr) {
        if (!dateStr) return false;
        const parsed = new Date(`${dateStr}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return false;
        const day = parsed.getDay();
        return day === 0 || day === 6;
    }

    function isInSchoolTerm(dateStr) {
        if (isWeekendISO(dateStr)) return false;
        if (schoolClosureDates.has(dateStr)) return false;
        return schoolTermRanges.some(function (r) { return dateStr >= r.start && dateStr <= r.end; });
    }

    function escapeCalendarViewHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Fetch all drivers' time off for the given month
     */
    async function fetchAllDriversTimeOff(year, month) {
        try {
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            const response = await fetch(`/scheduling/calendar-view?month=${monthStr}`);
            const data = await response.json();
            if (data.success) {
                calViewModalData = data.days || {};
                return true;
            }
        } catch (err) {
            console.error('Error fetching calendar view data:', err);
        }
        return false;
    }

    /**
     * Render the calendar view modal
     */
    async function renderCalendarViewModal() {
        const year = calViewModalDate.getFullYear();
        const month = calViewModalDate.getMonth();

        document.getElementById('calViewMonthLabel').textContent = calViewModalDate.toLocaleString(
            'default',
            { month: 'long', year: 'numeric' }
        );

        // Fetch data for current month
        const success = await fetchAllDriversTimeOff(year, month);
        if (!success) {
            document.getElementById('calendarViewBody').innerHTML =
                '<tr><td colspan="7" class="text-center text-muted">Unable to load calendar data</td></tr>';
            return;
        }

        const firstDay = new Date(year, month, 1);
        let startOffset = firstDay.getDay() - 1;
        if (startOffset < 0) startOffset = 6;

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

        const dayCells = [];

        for (let i = 0; i < totalCells; i++) {
            const cellNum = i - startOffset + 1;
            if (cellNum >= 1 && cellNum <= daysInMonth) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(cellNum).padStart(2, '0')}`;
                let cellClass = 'cal-day calendar-view-day';
                if (isInSchoolTerm(dateStr)) cellClass += ' cal-school-term';

                const driversOnThisDate = calViewModalData[dateStr] || [];
                const sortedDrivers = [...driversOnThisDate].sort(function (a, b) {
                    const aNumber = String(a.driver_number || '');
                    const bNumber = String(b.driver_number || '');
                    return aNumber.localeCompare(bNumber, undefined, { numeric: true, sensitivity: 'base' });
                });

                const driverCount = sortedDrivers.length;
                let badgeSizeClass = '';
                if (driverCount >= 11) badgeSizeClass = 'cal-view-badges-xs';
                else if (driverCount >= 7) badgeSizeClass = 'cal-view-badges-sm';

                let headerHtml = `<div class="cal-day-header"><div class="fw-bold small">${cellNum}</div>`;
                if (driverCount > 0) {
                    headerHtml += `<span class="cal-view-count-badge">${driverCount} OFF</span>`;
                }
                headerHtml += '</div>';

                let gridHtml = '';
                if (driverCount > 0) {
                    gridHtml += `<div class="cal-day-shifts cal-view-driver-grid ${badgeSizeClass}">`;
                    sortedDrivers.forEach(function (driverEntry) {
                        const type = driverEntry.time_off_type || 'holiday';
                        const color = typeColorMap[type] || typeColorMap.holiday;
                        gridHtml += `<span class="cal-view-driver-badge" style="background-color: ${color};" title="Driver ${escapeCalendarViewHtml(driverEntry.driver_number)} off (${type.toUpperCase()})">${escapeCalendarViewHtml(driverEntry.driver_number)}</span>`;
                    });
                    gridHtml += '</div>';
                } else {
                    gridHtml = '<div class="cal-day-shifts"><small class="text-muted">No drivers off</small></div>';
                }

                dayCells.push(`<td class="${cellClass}">${headerHtml}${gridHtml}</td>`);
            } else {
                dayCells.push('<td class="cal-empty"></td>');
            }
        }

        const rows = [];
        for (let i = 0; i < dayCells.length; i += 7) {
            rows.push(`<tr>${dayCells.slice(i, i + 7).join('')}</tr>`);
        }

        document.getElementById('calendarViewBody').innerHTML = rows.join('');

        if (window.bootstrap && window.bootstrap.Tooltip) {
            document.getElementById('calendarViewBody').querySelectorAll('[title]').forEach(function (el) {
                window.bootstrap.Tooltip.getOrCreateInstance(el);
            });
        }
    }

    function initCalendarViewModal() {
        const modal = document.getElementById('calendarViewModal');
        if (!modal) return;
        loadSchoolTerms();


        const prevBtn = document.getElementById('calViewPrev');
        const nextBtn = document.getElementById('calViewNext');

        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                calViewModalDate.setMonth(calViewModalDate.getMonth() - 1);
                renderCalendarViewModal();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                calViewModalDate.setMonth(calViewModalDate.getMonth() + 1);
                renderCalendarViewModal();
            });
        }

        // Render when modal is shown
        modal.addEventListener('show.bs.modal', function () {
            renderCalendarViewModal();
        });
    }

    // Initialize on document ready
    document.addEventListener('DOMContentLoaded', function () {
        initCalendarViewModal();
    });
})();
