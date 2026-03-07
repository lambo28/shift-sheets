/**
 * scheduling.core.js
 * Core utilities for the Scheduling section (holidays, adjustments, swaps).
 */

// ---------------------------------------------------------------------------
// Holiday calendar widget
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    /** @type {Date} Currently displayed month/year in the calendar */
    let calViewDate = new Date();
    calViewDate.setDate(1);

    /** @type {string|null} Currently selected date in 'YYYY-MM-DD' format */
    let calSelectedDate = null;

    /** @type {Set<string>} Dates already saved as holidays (YYYY-MM-DD), populated by server on render */
    const existingHolidayDates = new Set();

    /**
     * Render the calendar for the current calViewDate month.
     */
    function renderCalendar() {
        const tbody = document.getElementById('calBody');
        const monthLabel = document.getElementById('calMonthLabel');
        if (!tbody || !monthLabel) return;

        const year = calViewDate.getFullYear();
        const month = calViewDate.getMonth(); // 0-indexed

        monthLabel.textContent = calViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        const today = new Date();
        const todayStr = formatDateISO(today);

        // First day of month (0=Sun ... 6=Sat). Convert to Mon-based (0=Mon ... 6=Sun)
        const firstDay = new Date(year, month, 1);
        let startOffset = firstDay.getDay() - 1; // Mon=0, Tue=1 ... Sat=5
        if (startOffset < 0) startOffset = 6;    // Sunday (getDay()=0) maps to position 6 in Mon-first layout

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let html = '';
        let dayCounter = 1;
        let cellIndex = 0;
        const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

        html += '<tr>';
        for (let i = 0; i < totalCells; i++) {
            if (i % 7 === 0 && i > 0) html += '</tr><tr>';

            if (i < startOffset || dayCounter > daysInMonth) {
                html += '<td class="cal-empty"></td>';
            } else {
                const dateStr = formatDateISO(new Date(year, month, dayCounter));
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === calSelectedDate;
                const isHoliday = existingHolidayDates.has(dateStr);

                let classes = 'cal-day';
                if (isToday) classes += ' cal-today';
                if (isHoliday) classes += ' cal-holiday';
                if (isSelected) classes += ' cal-selected';

                html += `<td class="${classes}" data-date="${dateStr}">${dayCounter}</td>`;
                dayCounter++;
            }
            cellIndex++;
        }
        html += '</tr>';

        tbody.innerHTML = html;

        // Attach click handlers
        tbody.querySelectorAll('td.cal-day').forEach(function (td) {
            td.addEventListener('click', function () {
                selectCalDay(td.getAttribute('data-date'));
            });
        });
    }

    function selectCalDay(dateStr) {
        calSelectedDate = dateStr;
        document.getElementById('holidayDateInput').value = dateStr;

        // Update display text
        const display = document.getElementById('holidayDateDisplay');
        if (display) {
            const parts = dateStr.split('-');
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            display.textContent = 'Selected: ' + d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }

        // Enable the save button
        const btn = document.getElementById('saveHolidayBtn');
        if (btn) btn.disabled = false;

        renderCalendar();
    }

    function formatDateISO(d) {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${da}`;
    }

    /**
     * Populate existing holidays from the page's hidden data.
     * The template embeds holiday dates via a data attribute on #holidaysDataEl.
     */
    function loadExistingHolidays() {
        const el = document.getElementById('holidaysDataEl');
        if (!el) return;
        try {
            const dates = JSON.parse(el.getAttribute('data-holidays') || '[]');
            dates.forEach(function (d) { existingHolidayDates.add(d); });
        } catch (e) {
            // No holidays data available
        }
    }

    function initCalendar() {
        loadExistingHolidays();
        renderCalendar();

        const prev = document.getElementById('calPrev');
        const next = document.getElementById('calNext');
        if (prev) {
            prev.addEventListener('click', function () {
                calViewDate.setMonth(calViewDate.getMonth() - 1);
                renderCalendar();
            });
        }
        if (next) {
            next.addEventListener('click', function () {
                calViewDate.setMonth(calViewDate.getMonth() + 1);
                renderCalendar();
            });
        }
    }

    // Expose for use by event-bindings
    window.schedulingCalendar = {
        init: initCalendar,
        refresh: renderCalendar,
        addHolidayDate: function (dateStr) {
            existingHolidayDates.add(dateStr);
            renderCalendar();
        },
        removeHolidayDate: function (dateStr) {
            existingHolidayDates.delete(dateStr);
            renderCalendar();
        }
    };

})();


// ---------------------------------------------------------------------------
// Swap validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate the swap form via AJAX and show results.
 * Returns a Promise resolving to true if valid, false otherwise.
 */
async function validateSwapForm() {
    const driverAId = document.getElementById('swapDriverA').value;
    const driverBId = document.getElementById('swapDriverB').value;
    const dateA = document.getElementById('swapDateA').value;
    const dateB = document.getElementById('swapDateB').value;

    const resultDiv = document.getElementById('swapValidationResult');
    const confirmBtn = document.getElementById('confirmSwapBtn');
    if (!resultDiv || !confirmBtn) return false;

    resultDiv.style.display = 'none';
    confirmBtn.disabled = true;

    if (!driverAId || !driverBId || !dateA || !dateB) {
        resultDiv.innerHTML = '<div class="alert alert-warning mb-0"><i class="fas fa-exclamation-triangle me-2"></i>Please fill in all fields before validating.</div>';
        resultDiv.style.display = '';
        return false;
    }

    try {
        const response = await fetch('/scheduling/swap/validate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                driver_a_id: driverAId,
                driver_b_id: driverBId,
                date_a: dateA,
                date_b: dateB
            })
        });

        const data = await response.json();

        if (data.success) {
            resultDiv.innerHTML = '<div class="alert alert-success mb-0"><i class="fas fa-check-circle me-2"></i>Swap is valid. Click <strong>Confirm Swap</strong> to save.</div>';
            confirmBtn.disabled = false;
        } else {
            const errList = (data.errors || [data.error || 'Unknown error'])
                .map(function (e) { return `<li>${escapeHtml(e)}</li>`; })
                .join('');
            resultDiv.innerHTML = `<div class="alert alert-danger mb-0"><i class="fas fa-times-circle me-2"></i><strong>Validation failed:</strong><ul class="mb-0 mt-1">${errList}</ul></div>`;
            confirmBtn.disabled = true;
        }
    } catch (err) {
        resultDiv.innerHTML = '<div class="alert alert-danger mb-0"><i class="fas fa-times-circle me-2"></i>Could not reach the server. Please try again.</div>';
        confirmBtn.disabled = true;
    }

    resultDiv.style.display = '';
    return !document.getElementById('confirmSwapBtn').disabled;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
