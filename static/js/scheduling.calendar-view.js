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

        let html = '';
        html += '<tr>';
        for (let i = 0; i < totalCells; i++) {
            if (i % 7 === 0 && i > 0) html += '</tr><tr>';

            const cellNum = i - startOffset + 1;
            let cellClass = '';
            let cellContent = '';

            if (cellNum >= 1 && cellNum <= daysInMonth) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(cellNum).padStart(2, '0')}`;
                cellClass = 'calendar-view-day';

                const driversOnThisDate = calViewModalData[dateStr] || [];
                const sortedDrivers = [...driversOnThisDate].sort((a, b) => {
                    const aNumber = String(a.driver_number || '');
                    const bNumber = String(b.driver_number || '');
                    return aNumber.localeCompare(bNumber, undefined, { numeric: true, sensitivity: 'base' });
                });

                cellContent = `<div class="d-flex justify-content-between align-items-center mb-1"><strong>${cellNum}</strong>${sortedDrivers.length > 0 ? `<strong class="small text-danger">${sortedDrivers.length} ${sortedDrivers.length === 1 ? 'DRIVER' : 'DRIVERS'} OFF</strong>` : ''}</div>`;
                if (sortedDrivers.length > 0) {
                    cellContent += '<div style="display: flex; flex-wrap: wrap; gap: 2px;">';
                    sortedDrivers.forEach(driverEntry => {
                        const type = driverEntry.time_off_type || 'holiday';
                        const color = typeColorMap[type] || typeColorMap.holiday;
                        cellContent += `<span class="badge" style="background-color: ${color}; color: #000; font-size: 14px; padding: 0.25rem 0.4rem;" title="Driver ${driverEntry.driver_number} off (${type.toUpperCase()})">${driverEntry.driver_number}</span>`;
                    });
                    cellContent += '</div>';
                }
            }

            html += `<td class="${cellClass}" style="height: 80px; vertical-align: top; padding: 8px; position: relative;">${cellContent}</td>`;
        }
        html += '</tr>';

        document.getElementById('calendarViewBody').innerHTML = html;
    }

    function initCalendarViewModal() {
        const modal = document.getElementById('calendarViewModal');
        if (!modal) return;

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
