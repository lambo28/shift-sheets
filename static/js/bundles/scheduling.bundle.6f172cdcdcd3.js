/* Auto-generated bundle. Do not edit directly. */
/* Bundle: scheduling.bundle.js */


/* ===== shared.core.js ===== */
/**
 * shared.core.js
 * Shared utilities for all pages
 * No dependencies
 */

/**
 * Clean up orphaned Bootstrap modal backdrop elements
 * Called after modals close to restore page interactivity
 */
function cleanupModalArtifacts() {
    const openModals = document.querySelectorAll('.modal.show');
    if (openModals.length > 0) {
        return;
    }

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

/**
 * Close a modal by ID with proper cleanup
 * @param {string} modalId - The ID of the modal element
 */
function hideModalById(modalId) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl || typeof bootstrap === 'undefined') {
        cleanupModalArtifacts();
        return;
    }

    modalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts, { once: true });
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    setTimeout(cleanupModalArtifacts, 400);
}

/**
 * Display a notification banner with auto-dismiss
 * Fixed position, top-right corner with slide animation
 * @param {string} type - Alert type: 'success', 'danger', 'warning', 'info', 'error'
 * @param {string} message - HTML message to display
 * @param {boolean} autoDismiss - Auto-close after duration (default: true)
 * @param {number} duration - Time in ms before auto-dismiss (default: 4000)
 */
function showAlertBanner(type = 'info', message = 'Message', autoDismiss = true, duration = 4000) {
    const container = document.getElementById('alertBannerContainer');
    const alertId = 'alert-' + Date.now();

    const alertClass = {
        'success': 'alert-success',
        'error': 'alert-danger',
        'danger': 'alert-danger',
        'warning': 'alert-warning',
        'info': 'alert-info'
    }[type] || 'alert-info';

    const alert = document.createElement('div');
    alert.id = alertId;
    alert.className = `alert alert-banner ${alertClass} alert-dismissible fade show`;
    alert.role = 'alert';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    container.appendChild(alert);

    if (autoDismiss) {
        setTimeout(() => {
            const alertEl = document.getElementById(alertId);
            if (alertEl) {
                alertEl.classList.add('dismissing');
                setTimeout(() => alertEl.remove(), 300);
            }
        }, duration);
    }
}

/**
 * Fetch JSON from server with error handling
 * @param {string} url - Endpoint URL
 * @param {object} options - Fetch options
 * @returns {object} - {success: boolean, ...data}
 */
async function requestJson(url, options = {}) {
    const response = await fetch(url, options);

    let data;
    try {
        data = await response.json();
    } catch {
        data = { success: false, error: `HTTP ${response.status}` };
    }

    if (!response.ok) {
        return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    return data;
}

/**
 * Initialize modal cleanup binding for all modals
 * Attaches cleanup to hidden.bs.modal event
 */
function initializeModalCleanup() {
    document.querySelectorAll('.modal').forEach((modalEl) => {
        modalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts);
    });
}

/**
 * Format text to title case (capitalize first letter of each word)
 * @param {string} value - Text to format
 * @returns {string} - Title cased text
 */
function formatTitleCase(value) {
    const normalized = String(value || '').replace(/_/g, ' ').trim();
    if (!normalized) return '';

    return normalized
        .split(/\s+/)
        .map((part) => {
            const lower = part.toLowerCase();
            if (lower === 'am' || lower === 'pm') {
                return lower.toUpperCase();
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
}


/* ===== scheduling.flash-banner.js ===== */
document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.showAlertBanner !== 'function') {
        return;
    }

    const flashAlerts = document.querySelectorAll('main > .alert.alert-dismissible');
    flashAlerts.forEach(function (alertEl) {
        let level = 'info';
        if (alertEl.classList.contains('alert-success')) level = 'success';
        else if (alertEl.classList.contains('alert-danger')) level = 'error';
        else if (alertEl.classList.contains('alert-warning')) level = 'warning';

        const cloned = alertEl.cloneNode(true);
        const closeBtn = cloned.querySelector('.btn-close');
        if (closeBtn) closeBtn.remove();

        const messageHtml = cloned.innerHTML.trim();
        window.showAlertBanner(level, messageHtml, true, 4000);
        alertEl.remove();
    });
});


/* ===== scheduling.core.js ===== */
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
        const isExtraShift = !!shift.is_extra;
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

        if (isExtraShift) {
            return;
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
    const hasSwapGiveUp = !!safeDayData?.has_swap_give_up;
    const hasSwapWork = !!safeDayData?.has_swap_work;
    const swapGiveUpCount = safeDayData?.swap_give_up_count || 0;
    const swapWorkCount = safeDayData?.swap_work_count || 0;

    // Check for extra shifts
    const extraShifts = shifts.filter((s) => s.is_extra);
    const extraShiftTooltip = extraShifts.length
        ? `Extra shift${extraShifts.length > 1 ? 's' : ''}: ${extraShifts.map((s) => `${s.label} (${s.start_time}–${s.end_time})`).join(', ')}`
        : null;

    const lateStartIconHtml = lateStart
        ? `<span class="cal-adjustment-icon badge-late-start-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`${lateStart.label} at ${lateStart.time}${lateStart.notes ? ` — ${lateStart.notes}` : ''}`)}"><i class="fas fa-hourglass-start"></i></span>`
        : '';

    const earlyFinishIconHtml = earlyFinish
        ? `<span class="cal-adjustment-icon badge-early-finish-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`${earlyFinish.label} at ${earlyFinish.time}${earlyFinish.notes ? ` — ${earlyFinish.notes}` : ''}`)}"><i class="fas fa-hourglass-end"></i></span>`
        : '';

    const extraShiftIconHtml = extraShiftTooltip
        ? `<span class="cal-adjustment-icon badge-extra-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(extraShiftTooltip)}"><i class="fas fa-plus"></i></span>`
        : '';

    const swapGiveUpIconHtml = hasSwapGiveUp
        ? `<span class="cal-adjustment-icon badge-swap-giveup-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`Swap give-up day (${swapGiveUpCount})`)}"><i class="fas fa-right-from-bracket"></i></span>`
        : '';

    const swapWorkIconHtml = hasSwapWork
        ? `<span class="cal-adjustment-icon badge-swap-work-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`Swap work day (${swapWorkCount})`)}"><i class="fas fa-right-to-bracket"></i></span>`
        : '';

    const swapTooltipParts = [];
    if (hasSwapGiveUp) swapTooltipParts.push(`Swap give-up day (${swapGiveUpCount})`);
    if (hasSwapWork) swapTooltipParts.push(`Swap work day (${swapWorkCount})`);

    const swapInlineMarkerHtml = swapTooltipParts.length
        ? `<i class="fas fa-exchange-alt ms-1" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(swapTooltipParts.join(' • '))}"></i>`
        : '';

    const baseContentHtml = `${shiftBadges.join('')}${timeOffHtml}`;
    const contentHtml = (baseContentHtml || swapInlineMarkerHtml)
        ? `${baseContentHtml}${swapInlineMarkerHtml}`
        : '<small class="text-muted">No shift</small>';

    return {
        contentHtml,
        bottomTimesHtml: bottomTimeTokens.join(''),
        lateStartIconHtml,
        earlyFinishIconHtml,
        extraShiftIconHtml,
        swapGiveUpIconHtml,
        swapWorkIconHtml,
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
                const inlineRowHtml = `${visuals.contentHtml}${visuals.extraShiftIconHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;

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
        let adjSelectedDateAllowsAdjustment = false;

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
            if (saveBtn) saveBtn.disabled = !adjSelectedDate || !adjSelectedDateAllowsAdjustment;
        }

        function updateAdjustmentShiftStatus() {
            const statusEl = document.getElementById('adjShiftStatus');
            if (!statusEl) return;

            if (!adjSelectedDriverId || !adjSelectedDate) {
                adjSelectedDateAllowsAdjustment = false;
                statusEl.innerHTML = '';
                return;
            }

            const dayData = getAdjustmentShiftsForDate(adjSelectedDate);
            const shifts = dayData && Array.isArray(dayData.shifts) ? dayData.shifts : [];
            const workingShifts = shifts.filter(shift => shift.shift_type !== 'day_off');
            const nonExtraWorkingShifts = workingShifts.filter(shift => !shift.is_extra);
            const isSplitShiftDay = nonExtraWorkingShifts.length >= 2;

            if (isSplitShiftDay) {
                adjSelectedDateAllowsAdjustment = false;
                const labels = workingShifts.map(shift => shift.label).join(', ');
                statusEl.innerHTML = `<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>Split shift day selected (${labels}). Late starts and early finishes are not used on split shift days.</span>`;
                return;
            }

            if (workingShifts.length > 0) {
                adjSelectedDateAllowsAdjustment = true;
                const labels = workingShifts.map(shift => shift.label).join(', ');
                statusEl.innerHTML = `<span class="text-success"><i class="fas fa-check-circle me-1"></i>Shift on selected day: ${labels}</span>`;
                return;
            }

            adjSelectedDateAllowsAdjustment = false;

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

            statusEl.innerHTML = '<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>Driver is marked as Day Off on selected day.</span>';
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
                const inlineRowHtml = `${visuals.contentHtml}${visuals.extraShiftIconHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;

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
 * Validate the day-swap form via AJAX and show results.
 * Returns a Promise resolving to true if valid, false otherwise.
 */
async function validateSwapForm() {
    const driverId = document.getElementById('swapDriver').value;
    const giveUpDate = document.getElementById('swapGiveUpDate').value;
    const workDate = document.getElementById('swapWorkDate').value;
    const workShiftType = document.getElementById('swapWorkShiftType').value;

    const resultDiv = document.getElementById('swapValidationResult');
    const confirmBtn = document.getElementById('confirmSwapBtn');
    if (!resultDiv || !confirmBtn) return false;

    resultDiv.style.display = 'none';
    confirmBtn.disabled = true;

    if (!driverId || !giveUpDate || !workDate || !workShiftType) {
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
                driver_id: driverId,
                give_up_date: giveUpDate,
                work_date: workDate,
                work_shift_type: workShiftType
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
// Swap calendar widget (dual-calendar two-date picker)
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    let swapGiveUpCalViewDate = new Date();
    swapGiveUpCalViewDate.setDate(1);
    
    let swapWorkCalViewDate = new Date();
    swapWorkCalViewDate.setDate(1);

    let swapSelectedDriverId = null;
    let swapDriverShiftData = null;
    let swapGiveUpDate = null;
    let swapWorkDate = null;

    function swapFormatDateISO(dateValue) {
        const year = dateValue.getFullYear();
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async function fetchSwapDriverShifts(driverId, monthStr) {
        if (!driverId) {
            swapDriverShiftData = null;
            return;
        }

        try {
            const response = await fetch(`/driver/${driverId}/calendar-data?month=${monthStr}`);
            const data = await response.json();
            swapDriverShiftData = data.success ? data : null;
        } catch (err) {
            console.error('Error fetching swap driver shifts:', err);
            swapDriverShiftData = null;
        }
    }

    function getSwapDayData(dateStr) {
        if (!swapDriverShiftData || !swapDriverShiftData.days) return null;
        return swapDriverShiftData.days.find(day => day.date === dateStr) || null;
    }

    function isSwapDayWorkingDay(dateStr) {
        const dayData = getSwapDayData(dateStr);
        if (!dayData) return false;
        if (dayData.is_holiday) return false;
        return dayData.shifts && dayData.shifts.some(shift => shift.shift_type !== 'day_off');
    }

    function isSwapDayOffDay(dateStr) {
        const dayData = getSwapDayData(dateStr);
        if (!dayData) return false;
        if (dayData.is_holiday) return false;
        const hasWorkingShift = dayData.shifts && dayData.shifts.some(shift => shift.shift_type !== 'day_off');
        return !hasWorkingShift || !!dayData.has_swap_work;
    }

    function updateSwapSelectionDisplay() {
        const display = document.getElementById('swapDateSelectionDisplay');
        if (!display) return;

        if (!swapSelectedDriverId) {
            display.textContent = 'Select a driver, then click a worked day (left) and an off day (right).';
            return;
        }

        if (!swapGiveUpDate) {
            display.innerHTML = '<strong>Step 1:</strong> Select the worked day to give up (left).';
            return;
        }

        if (!swapWorkDate) {
            const giveUp = new Date(`${swapGiveUpDate}T00:00:00`).toLocaleDateString('en-GB');
            display.innerHTML = `<strong>Give up:</strong> ${giveUp} · <strong>Step 2:</strong> Select the off day to work (right).`;
            return;
        }

        const giveUp = new Date(`${swapGiveUpDate}T00:00:00`).toLocaleDateString('en-GB');
        const work = new Date(`${swapWorkDate}T00:00:00`).toLocaleDateString('en-GB');
        display.innerHTML = `<strong>Give up:</strong> ${giveUp} · <strong>Work:</strong> ${work}`;
    }

    function syncSwapHiddenFields() {
        const giveUpInput = document.getElementById('swapGiveUpDate');
        const workInput = document.getElementById('swapWorkDate');

        if (giveUpInput) {
            giveUpInput.value = swapGiveUpDate || '';
            giveUpInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (workInput) {
            workInput.value = swapWorkDate || '';
            workInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function renderCalendarGrid(tbody, year, month, selectedDate, phase, todayStr) {
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

            const dateStr = swapFormatDateISO(new Date(year, month, dayCounter));
            const dayData = getSwapDayData(dateStr);
            const visuals = buildUnifiedCalendarCellContent(dayData);
            const inlineRowHtml = `${visuals.contentHtml}${visuals.extraShiftIconHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;
            const hasWorkingShift = !!(dayData?.shifts && dayData.shifts.some(shift => shift.shift_type !== 'day_off'));
            const hasBaseWorkingShift = !!dayData?.has_base_working_shift;
            const isHoliday = !!dayData?.is_holiday;
            const isSwapUsed = !!(dayData?.has_swap_give_up || dayData?.has_swap_work);
            const hasSwapWork = !!dayData?.has_swap_work;
            const isOffDay = !isHoliday && !hasWorkingShift;

            let classes = 'cal-day';
            let isClickable = true;
            let isWorkingDayForPhase = hasWorkingShift;
            const isMirroredSelection = (
                (phase === 'giveup' && !!swapWorkDate && dateStr === swapWorkDate)
                || (phase === 'work' && !!swapGiveUpDate && dateStr === swapGiveUpDate)
            );

            if (phase === 'giveup') {
                isWorkingDayForPhase = hasWorkingShift || hasBaseWorkingShift;
                isClickable = !isHoliday && (isMirroredSelection || (isWorkingDayForPhase && !isSwapUsed));
            } else if (phase === 'work') {
                isClickable = !isHoliday && (isMirroredSelection || (isOffDay && !isSwapUsed));
            }

            if (dateStr === todayStr) classes += ' cal-today';
            if (dateStr === selectedDate) classes += ' cal-selected';
            if (!isClickable && swapSelectedDriverId) classes += ' cal-disabled';
            if (dayData?.has_swap_give_up) classes += ' cal-has-swap-giveup';
            if (dayData?.has_swap_work) classes += ' cal-has-swap-work';

            if (phase === 'giveup' && dateStr === swapGiveUpDate) classes += ' cal-swap-giveup';
            if (phase === 'work' && dateStr === swapWorkDate) classes += ' cal-swap-work';

            html += `<td class="${classes}" data-date="${dateStr}" data-working-day="${isWorkingDayForPhase ? '1' : '0'}" data-off-day="${isOffDay ? '1' : '0'}" data-swap-used="${isSwapUsed ? '1' : '0'}" data-has-swap-work="${hasSwapWork ? '1' : '0'}" ${!isClickable ? 'style="opacity: 0.5; cursor: not-allowed;"' : ''}>
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
                if (!swapSelectedDriverId) return;
                if (td.classList.contains('cal-disabled')) return;
                const dateStr = td.getAttribute('data-date');
                const dayMeta = {
                    isWorkingDay: td.getAttribute('data-working-day') === '1',
                    isOffDay: td.getAttribute('data-off-day') === '1',
                    isSwapUsed: td.getAttribute('data-swap-used') === '1',
                    hasSwapWork: td.getAttribute('data-has-swap-work') === '1',
                };
                if (phase === 'giveup') {
                    selectGiveUpDate(dateStr, dayMeta);
                } else if (phase === 'work') {
                    selectWorkDate(dateStr, dayMeta);
                }
            });
        });

        if (window.bootstrap && window.bootstrap.Tooltip) {
            tbody.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
                window.bootstrap.Tooltip.getOrCreateInstance(el);
            });
        }
    }

    async function renderGiveUpCalendar() {
        const tbody = document.getElementById('swapGiveUpCalBody');
        const monthLabel = document.getElementById('swapGiveUpCalMonthLabel');
        if (!tbody || !monthLabel) return;

        disposeTooltipsIn(tbody);

        const year = swapGiveUpCalViewDate.getFullYear();
        const month = swapGiveUpCalViewDate.getMonth();
        monthLabel.textContent = swapGiveUpCalViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        if (swapSelectedDriverId) {
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            await fetchSwapDriverShifts(swapSelectedDriverId, monthStr);
        } else {
            swapDriverShiftData = null;
        }

        const todayStr = swapFormatDateISO(new Date());
        renderCalendarGrid(tbody, year, month, swapGiveUpDate, 'giveup', todayStr);
    }

    async function renderWorkCalendar() {
        const tbody = document.getElementById('swapWorkCalBody');
        const monthLabel = document.getElementById('swapWorkCalMonthLabel');
        if (!tbody || !monthLabel) return;

        disposeTooltipsIn(tbody);

        const year = swapWorkCalViewDate.getFullYear();
        const month = swapWorkCalViewDate.getMonth();
        monthLabel.textContent = swapWorkCalViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        if (swapSelectedDriverId) {
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            await fetchSwapDriverShifts(swapSelectedDriverId, monthStr);
        } else {
            swapDriverShiftData = null;
        }

        const todayStr = swapFormatDateISO(new Date());
        renderCalendarGrid(tbody, year, month, swapWorkDate, 'work', todayStr);
    }

    function selectGiveUpDate(dateStr, dayMeta = null) {
        if (dateStr === swapGiveUpDate) {
            swapGiveUpDate = null;
        } else {
            const isMirroredSelection = !!swapWorkDate && dateStr === swapWorkDate;
            const validWorking = dayMeta
                ? (isMirroredSelection || (dayMeta.isWorkingDay && !dayMeta.isSwapUsed))
                : (isMirroredSelection || isSwapDayWorkingDay(dateStr));
            if (!validWorking) {
                alert('You can only select a worked day that the driver has a shift on.');
                return;
            }
            swapGiveUpDate = dateStr;
        }

        updateSwapSelectionDisplay();
        syncSwapHiddenFields();
        renderGiveUpCalendar();
        renderWorkCalendar();
    }

    function selectWorkDate(dateStr, dayMeta = null) {
        if (dateStr === swapWorkDate) {
            swapWorkDate = null;
        } else {
            const isMirroredSelection = !!swapGiveUpDate && dateStr === swapGiveUpDate;
            const swapUsed = dayMeta ? dayMeta.isSwapUsed : false;
            const validOff = dayMeta
                ? (isMirroredSelection || (dayMeta.isOffDay && !dayMeta.isSwapUsed))
                : (isMirroredSelection || isSwapDayOffDay(dateStr));
            if (!validOff) {
                if (swapUsed) {
                    alert('This date is already swapped. Pick a non-swapped off day, or select the same date as the give-up side.');
                } else {
                    alert('You can only select an off day that is not a holiday.');
                }
                return;
            }
            swapWorkDate = dateStr;
        }

        updateSwapSelectionDisplay();
        syncSwapHiddenFields();
        renderGiveUpCalendar();
        renderWorkCalendar();
    }

    function initSwapCalendar() {
        const giveUpBody = document.getElementById('swapGiveUpCalBody');
        const workBody = document.getElementById('swapWorkCalBody');
        if (!giveUpBody || !workBody) return;

        // Give-up calendar navigation
        const giveUpPrev = document.getElementById('swapGiveUpCalPrev');
        const giveUpNext = document.getElementById('swapGiveUpCalNext');
        
        if (giveUpPrev) {
            giveUpPrev.addEventListener('click', function () {
                swapGiveUpCalViewDate.setMonth(swapGiveUpCalViewDate.getMonth() - 1);
                renderGiveUpCalendar();
            });
        }

        if (giveUpNext) {
            giveUpNext.addEventListener('click', function () {
                swapGiveUpCalViewDate.setMonth(swapGiveUpCalViewDate.getMonth() + 1);
                renderGiveUpCalendar();
            });
        }

        // Work calendar navigation
        const workPrev = document.getElementById('swapWorkCalPrev');
        const workNext = document.getElementById('swapWorkCalNext');
        
        if (workPrev) {
            workPrev.addEventListener('click', function () {
                swapWorkCalViewDate.setMonth(swapWorkCalViewDate.getMonth() - 1);
                renderWorkCalendar();
            });
        }

        if (workNext) {
            workNext.addEventListener('click', function () {
                swapWorkCalViewDate.setMonth(swapWorkCalViewDate.getMonth() + 1);
                renderWorkCalendar();
            });
        }

        // Clear selection
        const clearBtn = document.getElementById('clearSwapSelection');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                swapGiveUpDate = null;
                swapWorkDate = null;
                updateSwapSelectionDisplay();
                syncSwapHiddenFields();
                renderGiveUpCalendar();
                renderWorkCalendar();
            });
        }

        // Driver selection
        const driverSelect = document.getElementById('swapDriver');
        if (driverSelect) {
            driverSelect.addEventListener('change', function () {
                swapSelectedDriverId = this.value ? parseInt(this.value, 10) : null;
                swapGiveUpDate = null;
                swapWorkDate = null;
                updateSwapSelectionDisplay();
                syncSwapHiddenFields();
                renderGiveUpCalendar();
                renderWorkCalendar();
            });
        }

        const swapShiftMeta = {};
        let selectedPrimarySwapShift = null;

        document.querySelectorAll('.swap-shift-option').forEach(function(link) {
            const shiftType = link.getAttribute('data-shift-type');
            if (!shiftType) return;
            swapShiftMeta[shiftType] = {
                shiftType: shiftType,
                parentShiftType: link.getAttribute('data-parent-shift-type') || '',
                color: link.getAttribute('data-color') || 'bg-primary',
                icon: link.getAttribute('data-icon') || 'fas fa-clock',
                label: link.getAttribute('data-label') || shiftType
            };
        });

        function isSwapSubShift(shiftType) {
            return !!(swapShiftMeta[shiftType] && swapShiftMeta[shiftType].parentShiftType);
        }

        function getSwapSecondarySubShifts(primaryShiftType) {
            if (!isSwapSubShift(primaryShiftType)) {
                return [];
            }
            return Object.values(swapShiftMeta).filter(function(meta) {
                return meta.shiftType !== primaryShiftType && !!meta.parentShiftType;
            });
        }

        function syncSwapShiftTypeHidden() {
            const hiddenInput = document.getElementById('swapWorkShiftType');
            if (!hiddenInput) return;

            const selected = [];
            if (selectedPrimarySwapShift && selectedPrimarySwapShift.shiftType) {
                selected.push(selectedPrimarySwapShift.shiftType);
            }

            const secondarySelect = document.getElementById('swapSecondShiftType');
            const secondaryValue = secondarySelect ? String(secondarySelect.value || '').trim() : '';
            if (secondaryValue) {
                selected.push(secondaryValue);
            }

            hiddenInput.value = selected.join(',');
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function renderSwapShiftTypeDisplay() {
            const displaySpan = document.getElementById('swapWorkShiftTypeDisplay');
            if (!displaySpan) return;

            const badges = [];
            if (selectedPrimarySwapShift) {
                badges.push('<span class="badge ' + selectedPrimarySwapShift.color + ' p-2 me-1"><i class="' + selectedPrimarySwapShift.icon + '"></i></span>' + selectedPrimarySwapShift.label);
            }

            const secondarySelect = document.getElementById('swapSecondShiftType');
            const secondaryValue = secondarySelect ? String(secondarySelect.value || '').trim() : '';
            if (secondaryValue && swapShiftMeta[secondaryValue]) {
                const secondaryMeta = swapShiftMeta[secondaryValue];
                badges.push('<span class="badge ' + secondaryMeta.color + ' p-2 me-1"><i class="' + secondaryMeta.icon + '"></i></span>' + secondaryMeta.label);
            }

            if (!badges.length) {
                displaySpan.innerHTML = '— Select shift type —';
                return;
            }
            displaySpan.innerHTML = badges.join(' ');
        }

        function renderSwapSecondaryShiftOptions() {
            const wrapper = document.getElementById('swapSecondShiftWrapper');
            const secondarySelect = document.getElementById('swapSecondShiftType');
            if (!wrapper || !secondarySelect) return;

            if (!selectedPrimarySwapShift || !isSwapSubShift(selectedPrimarySwapShift.shiftType)) {
                secondarySelect.innerHTML = '<option value="">None</option>';
                secondarySelect.value = '';
                wrapper.classList.add('d-none');
                return;
            }

            const siblings = getSwapSecondarySubShifts(selectedPrimarySwapShift.shiftType);
            if (!siblings.length) {
                secondarySelect.innerHTML = '<option value="">None</option>';
                secondarySelect.value = '';
                wrapper.classList.add('d-none');
                return;
            }

            let options = '<option value="">None</option>';
            siblings.forEach(function(meta) {
                options += '<option value="' + meta.shiftType + '">' + meta.label + '</option>';
            });
            secondarySelect.innerHTML = options;
            secondarySelect.value = '';
            wrapper.classList.remove('d-none');
        }

        const secondarySelect = document.getElementById('swapSecondShiftType');
        if (secondarySelect) {
            secondarySelect.addEventListener('change', function() {
                syncSwapShiftTypeHidden();
                renderSwapShiftTypeDisplay();
            });
        }

        document.querySelectorAll('.swap-shift-option').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const shiftType = this.getAttribute('data-shift-type');
                if (!shiftType || !swapShiftMeta[shiftType]) return;

                selectedPrimarySwapShift = swapShiftMeta[shiftType];

                renderSwapSecondaryShiftOptions();
                syncSwapShiftTypeHidden();
                renderSwapShiftTypeDisplay();
            });
        });

        updateSwapSelectionDisplay();
        syncSwapHiddenFields();
        renderGiveUpCalendar();
        renderWorkCalendar();
    }

    window.schedulingSwapCalendar = {
        init: initSwapCalendar
    };
})();

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


/* ===== scheduling.event-bindings.js ===== */
/**
 * scheduling.event-bindings.js
 * Event handlers and UI wiring for the Scheduling section.
 */

(function () {
    'use strict';

    function showPageAlert(message, level = 'danger') {
        if (typeof window.showAlertBanner === 'function') {
            window.showAlertBanner(level, message, true, 4000);
            return;
        }

        const main = document.querySelector('main');
        if (!main) return;

        const alert = document.createElement('div');
        alert.className = `alert alert-${level} alert-dismissible fade show`;
        alert.setAttribute('role', 'alert');
        alert.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
        main.prepend(alert);
    }

    // -----------------------------------------------------------------------
    // Initialise calendar widget once DOM is ready
    // -----------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function () {
        if (window.schedulingCalendar) {
            window.schedulingCalendar.init();
        }
        if (window.schedulingAdjustmentCalendar) {
            window.schedulingAdjustmentCalendar.init();
        }
        if (window.schedulingSwapCalendar) {
            window.schedulingSwapCalendar.init();
        }

        // Update time input hint when adjustment type changes
        const adjTypeSelect = document.getElementById('adjType');
        if (adjTypeSelect) {
            adjTypeSelect.addEventListener('change', updateAdjTimeLabel);
        }

        // Swap validate button
        const validateBtn = document.getElementById('validateSwapBtn');
        if (validateBtn) {
            validateBtn.addEventListener('click', function () {
                validateSwapForm();
            });
        }

        // Re-invalidate when swap fields change (so user must re-validate)
        ['swapDriver', 'swapGiveUpDate', 'swapWorkDate', 'swapWorkShiftType'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', resetSwapValidation);
            }
        });

        // Edit adjustment buttons
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.edit-adj-btn');
            if (!btn) return;
            openEditAdjustmentModal(btn);
        });

        // Restore active tab from sessionStorage to preserve tab after form submission
        restoreActiveTab();

        initSchoolCalendarWeekendValidation();

        // Activate tab from URL hash
        const hash = window.location.hash;
        if (hash) {
            const tabTrigger = document.querySelector(`[data-bs-target="${hash}"]`);
            if (tabTrigger) {
                const bsTab = bootstrap.Tab.getOrCreateInstance(tabTrigger);
                bsTab.show();
            }
        }

        initDriverBlockToggleButtons();
    });

    function isWeekendDate(dateValue) {
        if (!dateValue) return false;
        const parsed = new Date(`${dateValue}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return false;
        const day = parsed.getDay();
        return day === 0 || day === 6;
    }

    function setWeekendValidity(inputEl, message) {
        if (!inputEl) return;
        if (isWeekendDate(inputEl.value)) {
            inputEl.setCustomValidity(message);
        } else {
            inputEl.setCustomValidity('');
        }
    }

    function initSchoolCalendarWeekendValidation() {
        const termForm = document.querySelector('form[action="/scheduling/term/add"]');
        const closureForm = document.querySelector('form[action="/scheduling/school-closure/add"]');

        const termStartInput = document.getElementById('termStartDate');
        const termEndInput = document.getElementById('termEndDate');
        const closureDateInput = document.getElementById('closureDate');

        if (termStartInput) {
            termStartInput.addEventListener('change', function () {
                setWeekendValidity(termStartInput, 'Start date cannot be Saturday or Sunday.');
                termStartInput.reportValidity();
            });
        }

        if (termEndInput) {
            termEndInput.addEventListener('change', function () {
                setWeekendValidity(termEndInput, 'End date cannot be Saturday or Sunday.');
                termEndInput.reportValidity();
            });
        }

        if (closureDateInput) {
            closureDateInput.addEventListener('change', function () {
                setWeekendValidity(closureDateInput, 'Closure date cannot be Saturday or Sunday.');
                closureDateInput.reportValidity();
            });
        }

        if (termForm) {
            termForm.addEventListener('submit', function (e) {
                setWeekendValidity(termStartInput, 'Start date cannot be Saturday or Sunday.');
                setWeekendValidity(termEndInput, 'End date cannot be Saturday or Sunday.');

                if ((termStartInput && !termStartInput.checkValidity()) || (termEndInput && !termEndInput.checkValidity())) {
                    e.preventDefault();
                    termStartInput && termStartInput.reportValidity();
                    termEndInput && termEndInput.reportValidity();
                    showPageAlert('Weekend dates are not allowed in School Calendar entries.', 'danger');
                }
            });
        }

        if (closureForm) {
            closureForm.addEventListener('submit', function (e) {
                setWeekendValidity(closureDateInput, 'Closure date cannot be Saturday or Sunday.');

                if (closureDateInput && !closureDateInput.checkValidity()) {
                    e.preventDefault();
                    closureDateInput.reportValidity();
                    showPageAlert('Weekend dates are not allowed in School Calendar entries.', 'danger');
                }
            });
        }
    }

    function initDriverBlockToggleButtons() {
        const buttons = document.querySelectorAll('.toggle-driver-blocks-btn');
        buttons.forEach(function (btn) {
            const targetSelector = btn.getAttribute('data-bs-target');
            const icon = btn.querySelector('i');
            if (!targetSelector || !icon) return;

            btn.addEventListener('click', function () {
                btn.blur();
            });

            const targets = document.querySelectorAll(targetSelector);
            if (!targets.length) return;

            const updateIcon = function (expanded) {
                icon.classList.toggle('fa-chevron-down', !expanded);
                icon.classList.toggle('fa-chevron-up', expanded);
                btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            };

            updateIcon(Array.from(targets).some(el => el.classList.contains('show')));

            targets.forEach(function (target) {
                target.addEventListener('shown.bs.collapse', function () {
                    updateIcon(true);
                });
                target.addEventListener('hidden.bs.collapse', function () {
                    const anyOpen = Array.from(targets).some(el => el.classList.contains('show'));
                    updateIcon(anyOpen);
                });
            });
        });
    }

    // -----------------------------------------------------------------------
    // Adjustment type label
    // -----------------------------------------------------------------------
    function updateAdjTimeLabel() {
        const adjType = document.getElementById('adjType');
        const label = document.getElementById('adjTimeLabel');
        const hint = document.getElementById('adjTimeHint');
        if (!adjType) return;
        if (adjType.value === 'late_start') {
            if (label) label.textContent = 'New Start Time';
            if (hint) hint.textContent = 'Enter the new (later) start time.';
        } else if (adjType.value === 'early_finish') {
            if (label) label.textContent = 'New Finish Time';
            if (hint) hint.textContent = 'Enter the new (earlier) finish time.';
        } else {
            if (label) label.textContent = 'Adjusted Time';
            if (hint) hint.textContent = 'Enter the new start or finish time.';
        }
    }

    // -----------------------------------------------------------------------
    // Swap validation reset
    // -----------------------------------------------------------------------
    function resetSwapValidation() {
        const resultDiv = document.getElementById('swapValidationResult');
        const confirmBtn = document.getElementById('confirmSwapBtn');
        if (resultDiv) resultDiv.style.display = 'none';
        if (confirmBtn) confirmBtn.disabled = true;
    }

    // -----------------------------------------------------------------------
    // Edit adjustment modal
    // -----------------------------------------------------------------------
    function openEditAdjustmentModal(btn) {
        const adjId = btn.getAttribute('data-adj-id');
        const driverId = btn.getAttribute('data-driver-id');
        const date = btn.getAttribute('data-date');
        const type = btn.getAttribute('data-type');
        const time = btn.getAttribute('data-time');
        const notes = btn.getAttribute('data-notes');

        const form = document.getElementById('editAdjustmentForm');
        if (!form) return;

        form.action = `/scheduling/adjustment/${adjId}/edit`;

        const dateEl = document.getElementById('editAdjDate');
        const typeEl = document.getElementById('editAdjType');
        const timeEl = document.getElementById('editAdjTime');
        const notesEl = document.getElementById('editAdjNotes');

        if (dateEl) dateEl.value = date;
        if (typeEl) typeEl.value = type;
        if (timeEl) timeEl.value = time;
        if (notesEl) notesEl.value = notes;

        const modal = document.getElementById('editAdjustmentModal');
        if (modal) {
            bootstrap.Modal.getOrCreateInstance(modal).show();
        }
    }

    // -----------------------------------------------------------------------
    // Persist active tab across page reloads (form submissions redirect back)
    // -----------------------------------------------------------------------
    function restoreActiveTab() {
        // Remove from sessionStorage immediately after reading so that only one
        // restore happens per form-submission redirect (not on subsequent page loads).
        const stored = sessionStorage.getItem('schedulingActiveTab');
        if (!stored) return;
        sessionStorage.removeItem('schedulingActiveTab');
        const tabTrigger = document.querySelector(`[data-bs-target="${stored}"]`);
        if (tabTrigger) {
            const bsTab = bootstrap.Tab.getOrCreateInstance(tabTrigger);
            bsTab.show();
        }
    }

    // Save the current tab before form submission so we can restore it
    document.addEventListener('submit', function (e) {
        const form = e.target;
        if (!form) return;
        const activeTab = document.querySelector('.scheduling-tabs .nav-link.active');
        if (activeTab) {
            const target = activeTab.getAttribute('data-bs-target');
            if (target) {
                sessionStorage.setItem('schedulingActiveTab', target);
            }
        }
    });

    // Edit Holiday modal
    const editHolidayForm = document.getElementById('editHolidayForm');
    if (editHolidayForm) {
        editHolidayForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const startDate = document.getElementById('editHolStartDate').value;
            const endDate = document.getElementById('editHolEndDate').value;
            const timeOffType = document.getElementById('editTimeOffType').value;
            const notes = document.getElementById('editHolNotes').value;
            const driverId = document.getElementById('editHolDriverId').value;
            const oldStart = document.getElementById('editHolStartDate').dataset.oldStart;
            const oldEnd = document.getElementById('editHolEndDate').dataset.oldEnd;
            
            // Update time off
            fetch('/scheduling/holiday/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    driver_id: driverId,
                    old_start_date: oldStart,
                    old_end_date: oldEnd,
                    new_start_date: startDate,
                    new_end_date: endDate,
                    time_off_type: timeOffType,
                    notes: notes
                })
            }).then(response => response.json()).then(data => {
                if (data.success) {
                    const bootstrapModal = bootstrap.Modal.getInstance(document.getElementById('editHolidayModal'));
                    if (bootstrapModal) bootstrapModal.hide();
                    location.reload();
                } else {
                    showPageAlert(data.message || 'Failed to update time off', 'warning');
                }
            }).catch(err => {
                console.error('Error:', err);
                showPageAlert('Could not update time off. Please try again.', 'danger');
            });
        });
    }

})();

/**
 * Load holiday group data into edit modal
 */
function loadHolidayGroupForEdit(driverId, startDate, endDate, timeOffType, notes) {
    document.getElementById('editHolDriverId').value = driverId;
    document.getElementById('editHolStartDate').value = startDate;
    document.getElementById('editHolEndDate').value = endDate;
    document.getElementById('editHolStartDate').dataset.oldStart = startDate;
    document.getElementById('editHolEndDate').dataset.oldEnd = endDate;
    document.getElementById('editTimeOffType').value = timeOffType || 'holiday';
    document.getElementById('editHolNotes').value = notes;
    
    // Fetch driver name
    fetch('/api/driver/' + driverId)
        .then(response => response.json())
        .then(data => {
            if (data.formatted_name) {
                document.getElementById('editHolDriver').value = data.formatted_name;
            }
        })
        .catch(err => console.error('Error fetching driver:', err));
}

