/**
 * scheduling.core.js
 * Core utilities for the Scheduling section (holidays, adjustments, swaps).
 */

const CAL_TIME_OFF_LABELS = {
    holiday: 'Holiday',
    sickness: 'Sickness',
    vor: 'VOR',
    other: 'Time Off'
};

const CAL_TIME_OFF_ICONS = {
    holiday: 'fa-umbrella-beach',
    sickness: 'fa-notes-medical',
    vor: 'fa-wrench',
    other: 'fa-user-clock'
};

const CAL_TIME_OFF_BADGES = {
    holiday: 'bg-warning text-dark',
    sickness: 'bg-danger',
    vor: 'bg-secondary',
    other: 'bg-info text-dark'
};

function calToMinutes(timeValue) {
    if (!timeValue || typeof timeValue !== 'string' || !timeValue.includes(':')) return null;
    const [hours, mins] = timeValue.split(':').map((v) => parseInt(v, 10));
    if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
    return (hours * 60) + mins;
}

function calToTimeText(minutesValue) {
    if (minutesValue === null || minutesValue === undefined) return '';
    const hrs = String(Math.floor(minutesValue / 60)).padStart(2, '0');
    const mins = String(minutesValue % 60).padStart(2, '0');
    return `${hrs}:${mins}`;
}

function buildUnifiedCalendarCellContent(dayData) {
    const safeDayData = dayData || null;
    const shifts = safeDayData && Array.isArray(safeDayData.shifts) ? safeDayData.shifts : [];
    const adjustments = safeDayData && Array.isArray(safeDayData.adjustments) ? safeDayData.adjustments : [];
    const hasDayOffShift = shifts.some((shift) => shift.shift_type === 'day_off' || shift.label === 'OFF');

    const shiftBadges = [];
    const bottomTimeTokens = [];

    shifts.forEach((shift) => {
        const startMinutes = calToMinutes(shift.start_time);
        const endMinutes = calToMinutes(shift.end_time);
        const defaultStartMinutes = calToMinutes(shift.default_start_time) ?? startMinutes;
        const defaultEndMinutes = calToMinutes(shift.default_end_time) ?? endMinutes;

        const startText = calToTimeText(startMinutes);
        const endText = calToTimeText(endMinutes);
        const rangeText = `${startText}${startText && endText ? '–' : ''}${endText}`;

        const isChangedFromDefault = (
            ((startMinutes !== null || defaultStartMinutes !== null) ? startMinutes !== defaultStartMinutes : false)
            ||
            ((endMinutes !== null || defaultEndMinutes !== null) ? endMinutes !== defaultEndMinutes : false)
        );

        if (!safeDayData?.is_holiday && !hasDayOffShift && rangeText && isChangedFromDefault) {
            bottomTimeTokens.push(`<span class="cal-shift-time-changed">${rangeText}</span>`);
        }

        const shiftIconHtml = (shift.shift_type === 'day_off' || shift.label === 'OFF')
            ? ''
            : `<i class="${shift.icon || 'fas fa-clock'} text-white"></i>`;

        shiftBadges.push(`<span class="badge ${shift.badge_color || 'bg-primary'} cal-shift-box"><span class="cal-shift-label">${shiftIconHtml}${shift.label}</span></span>`);
    });

    let timeOffHtml = '';
    if (safeDayData?.is_holiday) {
        const type = safeDayData.time_off_type || 'other';
        const label = CAL_TIME_OFF_LABELS[type] || 'Time Off';
        const icon = CAL_TIME_OFF_ICONS[type] || 'fa-user-clock';
        const badgeClass = CAL_TIME_OFF_BADGES[type] || 'bg-info text-dark';
        timeOffHtml = `<span class="badge ${badgeClass} cal-shift-box cal-timeoff" data-bs-toggle="tooltip" data-bs-placement="top" title="Driver marked as ${escapeHtml(label)}"><span class="cal-shift-label"><i class="fas ${icon}"></i>OFF</span></span>`;
    }

    const lateStart = adjustments.find((adj) => adj.adjustment_type === 'late_start');
    const earlyFinish = adjustments.find((adj) => adj.adjustment_type === 'early_finish');

    const lateStartIconHtml = lateStart
        ? `<span class="cal-adjustment-icon badge-late-start-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`${lateStart.label} at ${lateStart.time}${lateStart.notes ? ` — ${lateStart.notes}` : ''}`)}"><i class="fas fa-hourglass-start"></i></span>`
        : '';

    const earlyFinishIconHtml = earlyFinish
        ? `<span class="cal-adjustment-icon badge-early-finish-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`${earlyFinish.label} at ${earlyFinish.time}${earlyFinish.notes ? ` — ${earlyFinish.notes}` : ''}`)}"><i class="fas fa-hourglass-end"></i></span>`
        : '';

    const contentHtml = `${shiftBadges.join('')}${timeOffHtml}` || '<small class="text-muted">No shift</small>';

    return {
        contentHtml,
        bottomTimesHtml: bottomTimeTokens.join(''),
        lateStartIconHtml,
        earlyFinishIconHtml,
    };
}

function disposeTooltipsIn(containerEl) {
    if (!containerEl || !window.bootstrap || !window.bootstrap.Tooltip) return;

    containerEl.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
        const instance = window.bootstrap.Tooltip.getInstance(el);
        if (instance) {
            instance.hide();
            instance.dispose();
        }
    });
}

// ---------------------------------------------------------------------------
// Holiday calendar widget
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    /** @type {Date} Currently displayed month/year in the calendar */
    let calViewDate = new Date();
    calViewDate.setDate(1);

    /** @type {string|null} Start date of range selection in 'YYYY-MM-DD' format */
    let calStartDate = null;

    /** @type {string|null} End date of range selection in 'YYYY-MM-DD' format */
    let calEndDate = null;

    /** @type {Set<string>} Dates already saved as holidays (YYYY-MM-DD), populated by server on render */
    const existingHolidayDates = new Set();

    /** @type {Object} Shift data for the selected driver */
    let driverShiftData = null;

    /** @type {number|null} Currently selected driver ID */
    let selectedDriverId = null;

    /**
     * Fetch shift data for the selected driver
     */
    async function fetchDriverShifts(driverId, monthStr) {
        if (!driverId) {
            driverShiftData = null;
            return;
        }

        try {
            const response = await fetch(`/driver/${driverId}/calendar-data?month=${monthStr}`);
            const data = await response.json();
            if (data.success) {
                driverShiftData = data;
            } else {
                driverShiftData = null;
            }
        } catch (err) {
            console.error('Error fetching driver shifts:', err);
            driverShiftData = null;
        }
    }

    /**
     * Get shift data for a specific date
     */
    function getShiftsForDate(dateStr) {
        if (!driverShiftData || !driverShiftData.days) return null;
        const day = driverShiftData.days.find(d => d.date === dateStr);
        return day || null;
    }

    /**
     * Render the calendar for the current calViewDate month.
     */
    async function renderCalendar() {
        const tbody = document.getElementById('calBody');
        const monthLabel = document.getElementById('calMonthLabel');
        if (!tbody || !monthLabel) return;

        disposeTooltipsIn(tbody);

        const year = calViewDate.getFullYear();
        const month = calViewDate.getMonth(); // 0-indexed

        monthLabel.textContent = calViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        // Fetch shift data for current month if driver is selected
        if (selectedDriverId) {
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            await fetchDriverShifts(selectedDriverId, monthStr);
        }

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
                const isHoliday = existingHolidayDates.has(dateStr);
                const isInRange = isDateInRange(dateStr);
                const isRangeStart = dateStr === calStartDate;
                const isRangeEnd = dateStr === calEndDate;

                let classes = 'cal-day';
                if (isToday) classes += ' cal-today';
                if (isHoliday) classes += ' cal-holiday';
                if (isRangeStart || isRangeEnd) classes += ' cal-selected';
                if (isInRange && calStartDate && calEndDate && calStartDate !== calEndDate) classes += ' cal-in-range';

                const dayData = getShiftsForDate(dateStr);
                const visuals = buildUnifiedCalendarCellContent(dayData);
                const inlineRowHtml = `${visuals.contentHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;

                html += `<td class="${classes}" data-date="${dateStr}">
                    <div class="cal-day-header">
                        <div class="fw-bold small">${dayCounter}</div>
                    </div>
                    <div class="cal-day-inline">${inlineRowHtml}</div>
                </td>`;
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

        if (window.bootstrap && window.bootstrap.Tooltip) {
            tbody.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
                window.bootstrap.Tooltip.getOrCreateInstance(el);
            });
        }
    }

    function selectCalDay(dateStr) {
        // Range selection logic: first click sets start, second click sets end
        if (!calStartDate || (calStartDate && calEndDate)) {
            // Starting a new selection
            calStartDate = dateStr;
            calEndDate = null;
        } else {
            // Setting end date
            calEndDate = dateStr;
            // Ensure start is before end
            if (calEndDate < calStartDate) {
                [calStartDate, calEndDate] = [calEndDate, calStartDate];
            }
        }

        updateDateDisplay();
        updateFormInputs();

        // Enable the save button if we have at least a start date
        const btn = document.getElementById('saveHolidayBtn');
        if (btn) btn.disabled = !calStartDate;

        renderCalendar();
    }

    function isDateInRange(dateStr) {
        if (!calStartDate) return false;
        if (!calEndDate) return dateStr === calStartDate;
        return dateStr >= calStartDate && dateStr <= calEndDate;
    }

    function updateDateDisplay() {
        const display = document.getElementById('holidayDateDisplay');
        if (!display) return;

        if (!calStartDate) {
            display.textContent = 'Click a date to start selecting a range.';
            return;
        }

        const startParts = calStartDate.split('-');
        const startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
        const startFormatted = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        if (!calEndDate) {
            display.innerHTML = `<strong>Start:</strong> ${startFormatted}<br><small class="text-muted">Click another date to select end (or click same date for single day)</small>`;
        } else if (calStartDate === calEndDate) {
            display.innerHTML = `<strong>Selected:</strong> ${startFormatted} (1 day)`;
        } else {
            const endParts = calEndDate.split('-');
            const endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
            const endFormatted = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const dayCount = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            display.innerHTML = `<strong>Range:</strong> ${startFormatted} to ${endFormatted} (${dayCount} days)`;
        }
    }

    function updateFormInputs() {
        document.getElementById('holidayStartDate').value = calStartDate || '';
        document.getElementById('holidayEndDate').value = calEndDate || calStartDate || '';
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
        const clearBtn = document.getElementById('clearHolidaySelection');
        const driverSelect = document.getElementById('holidayDriverSelect');
        
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
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                const driverSelectEl = document.getElementById('holidayDriverSelect');
                const typeSelectEl = document.getElementById('timeOffType');
                const notesEl = document.getElementById('holidayNotes');

                if (driverSelectEl) {
                    driverSelectEl.value = '';
                }
                if (typeSelectEl) {
                    typeSelectEl.value = 'holiday';
                }
                if (notesEl) {
                    notesEl.value = '';
                }

                selectedDriverId = null;
                driverShiftData = null;
                calStartDate = null;
                calEndDate = null;
                updateDateDisplay();
                updateFormInputs();
                const btn = document.getElementById('saveHolidayBtn');
                if (btn) btn.disabled = true;
                renderCalendar();
            });
        }
        if (driverSelect) {
            driverSelect.addEventListener('change', function () {
                selectedDriverId = this.value ? parseInt(this.value) : null;
                // Clear calendar selection when driver is deselected
                if (!selectedDriverId) {
                    calStartDate = null;
                    calEndDate = null;
                    updateDateDisplay();
                    updateFormInputs();
                    const btn = document.getElementById('saveHolidayBtn');
                    if (btn) btn.disabled = true;
                }
                renderCalendar();
            });
        }
    }

    // Expose for use by event-bindings
    window.schedulingCalendar = {
        init: initCalendar,
        refresh: renderCalendar,
        setDriver: function(driverId) {
            selectedDriverId = driverId;
            renderCalendar();
        },
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
    // Adjustment calendar widget (single-date picker)
    // ---------------------------------------------------------------------------

    (function () {
        'use strict';

        let adjCalViewDate = new Date();
        adjCalViewDate.setDate(1);

        let adjSelectedDate = null;
        let adjSelectedDriverId = null;
        let adjDriverShiftData = null;
        let adjSelectedDateHasWorkingShift = false;

        async function fetchAdjustmentDriverShifts(driverId, monthStr) {
            if (!driverId) {
                adjDriverShiftData = null;
                return;
            }

            try {
                const response = await fetch(`/driver/${driverId}/calendar-data?month=${monthStr}`);
                const data = await response.json();
                if (data.success) {
                    adjDriverShiftData = data;
                } else {
                    adjDriverShiftData = null;
                }
            } catch (err) {
                console.error('Error fetching adjustment driver shifts:', err);
                adjDriverShiftData = null;
            }
        }

        function getAdjustmentShiftsForDate(dateStr) {
            if (!adjDriverShiftData || !adjDriverShiftData.days) return null;
            return adjDriverShiftData.days.find(day => day.date === dateStr) || null;
        }

        function formatDateISO(d) {
            const yr = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const da = String(d.getDate()).padStart(2, '0');
            return `${yr}-${mo}-${da}`;
        }

        function updateAdjustmentDateDisplay() {
            const display = document.getElementById('adjDateDisplay');
            if (!display) return;

            if (!adjSelectedDate) {
                display.textContent = 'Select a driver, then click a date on the calendar.';
                return;
            }

            const parts = adjSelectedDate.split('-');
            const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            display.innerHTML = `<strong>Selected:</strong> ${formatted}`;
        }

        function updateAdjustmentFormInput() {
            const input = document.getElementById('adjDate');
            if (input) input.value = adjSelectedDate || '';

            const saveBtn = document.getElementById('saveAdjustmentBtn');
            if (saveBtn) saveBtn.disabled = !adjSelectedDate || !adjSelectedDateHasWorkingShift;
        }

        function updateAdjustmentShiftStatus() {
            const statusEl = document.getElementById('adjShiftStatus');
            if (!statusEl) return;

            if (!adjSelectedDriverId || !adjSelectedDate) {
                adjSelectedDateHasWorkingShift = false;
                statusEl.innerHTML = '';
                return;
            }

            const dayData = getAdjustmentShiftsForDate(adjSelectedDate);
            const shifts = dayData && Array.isArray(dayData.shifts) ? dayData.shifts : [];
            const workingShifts = shifts.filter(shift => shift.shift_type !== 'day_off');

            if (workingShifts.length > 0) {
                adjSelectedDateHasWorkingShift = true;
                const labels = workingShifts.map(shift => shift.label).join(', ');
                statusEl.innerHTML = `<span class="text-success"><i class="fas fa-check-circle me-1"></i>Shift on selected day: ${labels}</span>`;
                return;
            }

            adjSelectedDateHasWorkingShift = false;

            if (dayData && dayData.is_holiday) {
                const typeMap = {
                    holiday: 'Holiday',
                    sickness: 'Sickness',
                    vor: 'VOR',
                    other: 'Other'
                };
                const reason = typeMap[dayData.time_off_type] || 'Time Off';
                statusEl.innerHTML = `<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>Driver is marked as having time off (${reason}).</span>`;
                return;
            }

            statusEl.innerHTML = '<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>No shift assigned on selected day.</span>';
        }

        async function renderAdjustmentCalendar() {
            const tbody = document.getElementById('adjCalBody');
            const monthLabel = document.getElementById('adjCalMonthLabel');
            if (!tbody || !monthLabel) return;

            disposeTooltipsIn(tbody);

            const year = adjCalViewDate.getFullYear();
            const month = adjCalViewDate.getMonth();
            monthLabel.textContent = adjCalViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

            if (adjSelectedDriverId) {
                const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
                await fetchAdjustmentDriverShifts(adjSelectedDriverId, monthStr);
            } else {
                adjDriverShiftData = null;
            }

            const todayStr = formatDateISO(new Date());
            const firstDay = new Date(year, month, 1);
            let startOffset = firstDay.getDay() - 1;
            if (startOffset < 0) startOffset = 6;

            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

            let html = '<tr>';
            let dayCounter = 1;

            for (let i = 0; i < totalCells; i++) {
                if (i % 7 === 0 && i > 0) html += '</tr><tr>';

                if (i < startOffset || dayCounter > daysInMonth) {
                    html += '<td class="cal-empty"></td>';
                    continue;
                }

                const dateStr = formatDateISO(new Date(year, month, dayCounter));
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === adjSelectedDate;

                let classes = 'cal-day';
                if (isToday) classes += ' cal-today';
                if (isSelected) classes += ' cal-selected';

                const dayData = getAdjustmentShiftsForDate(dateStr);
                const visuals = buildUnifiedCalendarCellContent(dayData);
                const inlineRowHtml = `${visuals.contentHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;

                html += `<td class="${classes}" data-date="${dateStr}">
                    <div class="cal-day-header">
                        <div class="fw-bold small">${dayCounter}</div>
                    </div>
                    <div class="cal-day-inline">${inlineRowHtml}</div>
                </td>`;
                dayCounter++;
            }

            html += '</tr>';
            tbody.innerHTML = html;

            tbody.querySelectorAll('td.cal-day').forEach(function (td) {
                td.addEventListener('click', function () {
                    if (!adjSelectedDriverId) return;
                    adjSelectedDate = td.getAttribute('data-date');
                    updateAdjustmentDateDisplay();
                    updateAdjustmentShiftStatus();
                    updateAdjustmentFormInput();
                    renderAdjustmentCalendar();
                });
            });

            if (window.bootstrap && window.bootstrap.Tooltip) {
                tbody.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
                    window.bootstrap.Tooltip.getOrCreateInstance(el);
                });
            }
        }

        function initAdjustmentCalendar() {
            const body = document.getElementById('adjCalBody');
            if (!body) return;

            const prev = document.getElementById('adjCalPrev');
            const next = document.getElementById('adjCalNext');
            const clearBtn = document.getElementById('clearAdjSelection');
            const driverSelect = document.getElementById('adjDriverSelect');

            if (prev) {
                prev.addEventListener('click', function () {
                    adjCalViewDate.setMonth(adjCalViewDate.getMonth() - 1);
                    renderAdjustmentCalendar();
                });
            }

            if (next) {
                next.addEventListener('click', function () {
                    adjCalViewDate.setMonth(adjCalViewDate.getMonth() + 1);
                    renderAdjustmentCalendar();
                });
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', function () {
                    const driverSelectEl = document.getElementById('adjDriverSelect');
                    const typeSelectEl = document.getElementById('adjType');
                    const timeEl = document.getElementById('adjTime');
                    const notesEl = document.getElementById('adjNotes');

                    if (driverSelectEl) {
                        driverSelectEl.value = '';
                    }
                    if (typeSelectEl) {
                        typeSelectEl.value = '';
                    }
                    if (timeEl) {
                        timeEl.value = '';
                    }
                    if (notesEl) {
                        notesEl.value = '';
                    }

                    adjSelectedDriverId = null;
                    adjDriverShiftData = null;
                    adjSelectedDate = null;
                    updateAdjustmentDateDisplay();
                    updateAdjustmentShiftStatus();
                    updateAdjustmentFormInput();
                    renderAdjustmentCalendar();
                });
            }

            if (driverSelect) {
                driverSelect.addEventListener('change', function () {
                    adjSelectedDriverId = this.value ? parseInt(this.value, 10) : null;
                    adjSelectedDate = null;
                    updateAdjustmentDateDisplay();
                    updateAdjustmentShiftStatus();
                    updateAdjustmentFormInput();
                    renderAdjustmentCalendar();
                });
            }

            updateAdjustmentDateDisplay();
            updateAdjustmentShiftStatus();
            updateAdjustmentFormInput();
            renderAdjustmentCalendar();
        }

        window.schedulingAdjustmentCalendar = {
            init: initAdjustmentCalendar
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

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
