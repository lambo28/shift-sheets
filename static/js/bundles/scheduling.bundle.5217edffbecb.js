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
        data = { success: false, ok: false, error: `HTTP ${response.status}` };
    }

    if (typeof data === 'object' && data !== null) {
        if (typeof data.success !== 'boolean' && typeof data.ok === 'boolean') {
            data.success = data.ok;
        }
        if (typeof data.ok !== 'boolean' && typeof data.success === 'boolean') {
            data.ok = data.success;
        }
    }

    if (!response.ok) {
        return {
            ...data,
            success: false,
            ok: false,
            error: data.error || `HTTP ${response.status}`
        };
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

/**
 * Generic form submission handler with button state management, error handling, and UI feedback
 * Reduces duplication across multiple form submission handlers
 * @param {HTMLFormElement} form - The form element to submit
 * @param {HTMLElement|string} submitButton - Submit button element or ID
 * @param {object} options - Configuration options:
 *   - action: {string} Form action URL (overrides form.action)
 *   - successMessage: {string} Custom success message
 *   - errorMessage: {string} Custom error message
 *   - onSuccess: {function} Callback after successful submission
 *   - onError: {function} Callback after error
 *   - hideModal: {string} Modal ID to hide on success
 *   - resetForm: {boolean} Reset form on success (default: false)
 *   - validateFn: {function} Pre-submission validation function
 *   - formDataFn: {function} Custom FormData preparation function (called with form, returns FormData)
 *   - savingLabel: {string} Button text while saving (default: from MESSAGES.SAVING)
 * @returns {Promise<object>} - Response data
 */
async function submitForm(form, submitButton, options = {}) {
    if (!form) {
        console.error('submitForm: Form element not found');
        return { success: false };
    }

    // Resolve submit button
    let btnEl = submitButton;
    if (typeof submitButton === 'string') {
        btnEl = document.getElementById(submitButton);
    }
    if (!btnEl) {
        console.error('submitForm: Submit button not found', submitButton);
        return { success: false };
    }

    // Run pre-submission validation if provided
    if (options.validateFn && typeof options.validateFn === 'function') {
        const validationError = options.validateFn();
        if (validationError) {
            showAlertBanner('error', validationError);
            return { success: false };
        }
    }

    // Save button state
    const originalHtml = btnEl.innerHTML;
    const savingLabel = options.savingLabel || (typeof MESSAGES !== 'undefined' && MESSAGES.SAVING ? MESSAGES.SAVING : 'Saving...');

    // Disable button and show saving state
    btnEl.disabled = true;
    btnEl.innerHTML = savingLabel;

    try {
        // Prepare form data (use custom function if provided)
        let formData;
        if (options.formDataFn && typeof options.formDataFn === 'function') {
            formData = options.formDataFn(form);
        } else {
            formData = new FormData(form);
        }

        const formAction = options.action || form.action || '/';
        const fetchOptions = {
            method: 'POST',
            body: formData,
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        };

        // Make request
        const responseData = await requestJson(formAction, fetchOptions);

        // Handle response
        if (responseData.success) {
            const successMsg = options.successMessage || responseData.message || 'Saved successfully';
            showAlertBanner('success', successMsg);

            // Hide modal if specified
            if (options.hideModal) {
                hideModalById(options.hideModal);
            }

            // Reset form if specified
            if (options.resetForm) {
                form.reset();
            }

            // Custom success callback
            if (options.onSuccess && typeof options.onSuccess === 'function') {
                await options.onSuccess(responseData);
            }

            return responseData;
        } else {
            const errorMsg = options.errorMessage || responseData.error || 'An error occurred';
            showAlertBanner('error', errorMsg);

            // Custom error callback
            if (options.onError && typeof options.onError === 'function') {
                await options.onError(responseData);
            }

            return responseData;
        }
    } catch (error) {
        console.error('Form submission error:', error);
        const errorMsg = 'Network error. Please check your connection and try again.';
        showAlertBanner('error', errorMsg);

        if (options.onError && typeof options.onError === 'function') {
            await options.onError({ success: false, error });
        }

        return { success: false, error };
    } finally {
        // Restore button state
        btnEl.disabled = false;
        btnEl.innerHTML = originalHtml;
    }
}

/**
 * Initialize modal data population from button data attributes
 * Reduces duplication of modal show event handlers
 * 
 * @param {string} modalId - ID of the modal element
 * @param {string} formId - ID of the form element
 * @param {Object} fieldMappings - Mapping of data-* attribute names to form field IDs
 *                                  and optional URL template parts
 * 
 * @example
 * initializeModalDataPopulation('editTermModal', 'editTermForm', {
 *     dataAttrToFormField: {
 *         'data-term-id': null,  // Used only for URL, not a form field
 *         'data-term-name': 'editTermName',
 *         'data-term-start': 'editTermStartDate',
 *         'data-term-end': 'editTermEndDate'
 *     },
 *     urlPattern: '/scheduling/term/{data-term-id}/edit'
 * });
 */
function initializeModalDataPopulation(modalId, formId, config) {
    const modal = document.getElementById(modalId);
    const form = document.getElementById(formId);
    
    if (!modal || !form) return;
    
    modal.addEventListener('show.bs.modal', function(event) {
        const button = event.relatedTarget;
        if (!button) return;
        
        const dataAttrs = config.dataAttrToFormField || {};
        const urlPattern = config.urlPattern || '';
        
        // Extract all data attributes from button
        const buttonData = {};
        Object.keys(dataAttrs).forEach(attr => {
            buttonData[attr] = button.getAttribute(attr) || '';
        });
        
        // Populate form fields from button data
        Object.entries(dataAttrs).forEach(([attr, fieldId]) => {
            if (fieldId && buttonData[attr]) {
                const field = document.getElementById(fieldId);
                if (field) {
                    field.value = buttonData[attr];
                }
            }
        });
        
        // Set form action URL if pattern provided
        if (urlPattern) {
            let actionUrl = urlPattern;
            Object.entries(buttonData).forEach(([attr, value]) => {
                actionUrl = actionUrl.replace(`{${attr}}`, value);
            });
            form.action = actionUrl;
        }
    });
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

    const hasSwapGiveUp = !!safeDayData?.has_swap_give_up;
    const hasSwapWork = !!safeDayData?.has_swap_work;
    const swapGiveUpCount = safeDayData?.swap_give_up_count || 0;
    const swapWorkCount = safeDayData?.swap_work_count || 0;
    const swapTooltipParts = [];
    if (hasSwapGiveUp) {
        swapTooltipParts.push(swapGiveUpCount > 1 ? `Swap give-up day (${swapGiveUpCount})` : 'Swap give-up day');
    }
    if (hasSwapWork) {
        swapTooltipParts.push(swapWorkCount > 1 ? `Swap work day (${swapWorkCount})` : 'Swap work day');
    }
    const swapMarkerHtml = swapTooltipParts.length
        ? `<i class="fas fa-exchange-alt cal-box-swap-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(swapTooltipParts.join(' • '))}"></i>`
        : '';

    shifts.forEach((shift, idx) => {
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

        const isDayOff = shift.shift_type === 'day_off' || shift.label === 'OFF';
        const shiftIconHtml = isDayOff
            ? '<i class="fas fa-user-clock"></i>'
            : `<i class="${shift.icon || 'fas fa-clock'}"></i>`;

        const swapInside = (idx === 0) ? swapMarkerHtml : '';
        const hasSwapMarkerClass = swapInside ? ' cal-has-swap-marker' : '';
        const shiftTitle = isDayOff ? 'Day off' : (shift.label || 'Shift');
        shiftBadges.push(
            `<span class="badge ${shift.badge_color || 'bg-primary'} cal-shift-box cal-icon-box${hasSwapMarkerClass}" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(shiftTitle)}"><span class="cal-shift-label">${shiftIconHtml}${swapInside}</span></span>`
        );
    });

    let timeOffHtml = '';
    if (safeDayData?.is_holiday) {
        const type = safeDayData.time_off_type || 'other';
        const label = CAL_TIME_OFF_LABELS[type] || 'Time Off';
        const icon = CAL_TIME_OFF_ICONS[type] || 'fa-user-clock';
        const badgeClass = CAL_TIME_OFF_BADGES[type] || 'bg-info text-dark';
        const timeOffHasSwapClass = swapMarkerHtml ? ' cal-has-swap-marker' : '';
        timeOffHtml = `<span class="badge ${badgeClass} cal-shift-box cal-timeoff cal-icon-box${timeOffHasSwapClass}" data-bs-toggle="tooltip" data-bs-placement="top" title="Driver marked as ${escapeHtml(label)}"><span class="cal-shift-label"><i class="fas ${icon} scheduling-type-white-icon"></i>${swapMarkerHtml}</span></span>`;
    }

    const lateStart = adjustments.find((adj) => adj.adjustment_type === 'late_start');
    const earlyFinish = adjustments.find((adj) => adj.adjustment_type === 'early_finish');

    // Check for extra shifts
    const extraShifts = shifts.filter((s) => s.is_extra);
    const extraShiftTooltip = extraShifts.length
        ? `Extra shift${extraShifts.length > 1 ? 's' : ''}: ${extraShifts.map((s) => `${s.label} (${s.start_time}–${s.end_time})`).join(', ')}`
        : null;

    const lateStartIconHtml = lateStart
        ? `<span class="cal-adjustment-icon cal-icon-box badge-late-start-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`${lateStart.label} at ${lateStart.time}${lateStart.notes ? ` — ${lateStart.notes}` : ''}`)}"><i class="fas fa-hourglass-start"></i></span>`
        : '';

    const earlyFinishIconHtml = earlyFinish
        ? `<span class="cal-adjustment-icon cal-icon-box badge-early-finish-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`${earlyFinish.label} at ${earlyFinish.time}${earlyFinish.notes ? ` — ${earlyFinish.notes}` : ''}`)}"><i class="fas fa-hourglass-end"></i></span>`
        : '';

    const extraShiftIconHtml = extraShiftTooltip
        ? `<span class="cal-adjustment-icon cal-icon-box badge-extra-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(extraShiftTooltip)}"><i class="fas fa-plus"></i></span>`
        : '';

    const swapGiveUpIconHtml = hasSwapGiveUp
        ? `<span class="cal-adjustment-icon badge-swap-giveup-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(swapGiveUpCount > 1 ? `Swap give-up day (${swapGiveUpCount})` : 'Swap give-up day')}"><i class="fas fa-right-from-bracket"></i></span>`
        : '';

    const swapWorkIconHtml = hasSwapWork
        ? `<span class="cal-adjustment-icon badge-swap-work-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(swapWorkCount > 1 ? `Swap work day (${swapWorkCount})` : 'Swap work day')}"><i class="fas fa-right-to-bracket"></i></span>`
        : '';

    const baseContentHtml = `${shiftBadges.join('')}${timeOffHtml}`;
    const contentHtml = baseContentHtml
        ? `${baseContentHtml}`
        : '<small class="text-muted">No shift</small>';

    const iconCount =
        (shiftBadges.length + (timeOffHtml ? 1 : 0))
        + (lateStart ? 1 : 0)
        + (earlyFinish ? 1 : 0)
        + (extraShiftTooltip ? 1 : 0);

    let inlineSizeClass = '';
    if (iconCount >= 5) inlineSizeClass = 'cal-icons-5plus';
    else if (iconCount >= 4) inlineSizeClass = 'cal-icons-4';

    return {
        contentHtml,
        bottomTimesHtml: bottomTimeTokens.join(''),
        lateStartIconHtml,
        earlyFinishIconHtml,
        extraShiftIconHtml,
        swapGiveUpIconHtml,
        swapWorkIconHtml,
        inlineSizeClass,
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

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


/* ===== scheduling.holiday-calendar.js ===== */
/**
 * scheduling.holiday-calendar.js
 * Holiday calendar widget for scheduling.
 */

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

    /** @type {Array<{start: string, end: string}>} School term date ranges */
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

    function getMinimumSelectableDateStr() {
        const now = new Date();
        const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() < 6) {
            minDate.setDate(minDate.getDate() - 1);
        }
        return formatDateISO(minDate);
    }

    /**
     * Render the calendar for the current calViewDate month.
     */
    async function renderCalendar() {
        const tbody = document.getElementById('calBody');
        const monthLabel = document.getElementById('calMonthLabel');
        if (!tbody || !monthLabel) return;

        const calendarEl = tbody.closest('.holiday-calendar');
        if (calendarEl) {
            calendarEl.classList.toggle('cal-disabled-state', !selectedDriverId);
        }

        const requiredHint = document.getElementById('holidayDriverRequiredHint');
        if (requiredHint) {
            requiredHint.classList.toggle('d-none', Boolean(selectedDriverId));
        }

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
        const minSelectableDateStr = getMinimumSelectableDateStr();

        if (calStartDate && calStartDate < minSelectableDateStr) {
            calStartDate = null;
            calEndDate = null;
            updateDateDisplay();
            updateFormInputs();
            const btn = document.getElementById('saveHolidayBtn');
            if (btn) btn.disabled = true;
        }

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
                const isInRange = isDateInRange(dateStr);
                const isRangeStart = dateStr === calStartDate;
                const isRangeEnd = dateStr === calEndDate;

                let classes = 'cal-day';
                if (isToday) classes += ' cal-today';
                if (isRangeStart || isRangeEnd) classes += ' cal-selected';

                const dayData = getShiftsForDate(dateStr);
                if (isInSchoolTerm(dateStr)) classes += ' cal-school-term';

                const dayWorkingShifts = ((dayData && dayData.shifts) || []).filter(function (s) { return s.shift_type !== 'day_off'; });
                const isDayWorking = dayWorkingShifts.length > 0;
                const isSwapWorkDay = Boolean(dayData && dayData.has_swap_work);

                if (selectedDriverId && (!isDayWorking || isSwapWorkDay || dateStr < minSelectableDateStr)) classes += ' cal-disabled';

                // Only highlight in-range days that are working days when a driver is selected
                const showInRange = isInRange && calStartDate && calEndDate && calStartDate !== calEndDate;
                if (showInRange && (!selectedDriverId || (isDayWorking && !isSwapWorkDay))) classes += ' cal-in-range';

                const visuals = buildUnifiedCalendarCellContent(dayData);
                const inlineRowHtml = `${visuals.contentHtml}${visuals.extraShiftIconHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;

                html += `<td class="${classes}" data-date="${dateStr}">
                    <div class="cal-day-header">
                        <div class="fw-bold small">${dayCounter}</div>
                    </div>
                    <div class="cal-day-inline ${visuals.inlineSizeClass || ''}">${inlineRowHtml}</div>
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
                if (!selectedDriverId) return;
                if (td.classList.contains('cal-disabled')) return;
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
            if (!selectedDriverId) {
                display.textContent = 'Select a driver, then click a start and end date on the calendar.';
            } else {
                display.textContent = 'Click a start date, then click an end date on the calendar.';
            }
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
        loadSchoolTerms();
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
                    typeSelectEl.dispatchEvent(new Event('change', { bubbles: true }));
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
                selectedDriverId = this.value ? parseInt(this.value, 10) : null;
                // Clear calendar selection when driver is deselected
                if (!selectedDriverId) {
                    driverShiftData = null;
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


/* ===== scheduling.adjustment-calendar.js ===== */
/**
 * scheduling.adjustment-calendar.js
 * Adjustment calendar widget for scheduling.
 */

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
    let adjServerValidationPassed = false;
    let adjValidationTimer = null;

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

    function getMinimumSelectableDateStr() {
        const now = new Date();
        const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() < 6) {
            minDate.setDate(minDate.getDate() - 1);
        }
        return formatDateISO(minDate);
    }

    function updateAdjustmentDateDisplay() {
        const display = document.getElementById('adjDateDisplay');
        if (!display) return;

        if (!adjSelectedDate) {
            display.textContent = 'Select a driver, then click a date on the calendar.';
            return;
        }

        const parts = adjSelectedDate.split('-');
        const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        display.innerHTML = `<strong>Selected:</strong> ${formatted}`;
    }

    function updateAdjustmentFormInput() {
        const input = document.getElementById('adjDate');
        if (input) input.value = adjSelectedDate || '';

        const saveBtn = document.getElementById('saveAdjustmentBtn');
        const typeValue = (document.getElementById('adjType')?.value || '').trim();
        const timeValue = (document.getElementById('adjTime')?.value || '').trim();
        const requiredComplete = Boolean(adjSelectedDate && typeValue && timeValue);
        if (saveBtn) saveBtn.disabled = !requiredComplete || !adjSelectedDateAllowsAdjustment || !adjServerValidationPassed;
    }

    function clearAdjustmentValidationResult() {
        const resultEl = document.getElementById('adjValidationResult');
        if (!resultEl) return;
        resultEl.style.display = 'none';
        resultEl.innerHTML = '';
    }

    function setAdjustmentValidationResult(level, message) {
        const resultEl = document.getElementById('adjValidationResult');
        if (!resultEl) return;
        resultEl.innerHTML = `<div class="alert alert-${level} mb-0">${message}</div>`;
        resultEl.style.display = '';
    }

    function resetAdjustmentValidationState() {
        adjServerValidationPassed = false;
        clearAdjustmentValidationResult();
        updateAdjustmentFormInput();
    }

    async function runAdjustmentAutoValidation() {
        const typeValue = (document.getElementById('adjType')?.value || '').trim();
        const timeValue = (document.getElementById('adjTime')?.value || '').trim();

        if (!adjSelectedDriverId || !adjSelectedDate || !typeValue || !timeValue || !adjSelectedDateAllowsAdjustment) {
            resetAdjustmentValidationState();
            return;
        }

        try {
            const response = await fetch('/scheduling/adjustment/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    driver_id: adjSelectedDriverId,
                    adjustment_date: adjSelectedDate,
                    adjustment_type: typeValue,
                    adjusted_time: timeValue
                })
            });

            const data = await response.json();

            if (data.success) {
                adjServerValidationPassed = true;
                setAdjustmentValidationResult('success', '<i class="fas fa-check-circle me-1"></i>Adjustment is valid. Click <strong>Save Adjustment</strong> to save.');
            } else {
                adjServerValidationPassed = false;
                const errors = data.errors || [data.error || 'Validation failed.'];
                setAdjustmentValidationResult('danger', `<i class="fas fa-times-circle me-1"></i><strong>Validation failed:</strong> ${errors.join(' ')}`);
            }
        } catch (err) {
            adjServerValidationPassed = false;
            setAdjustmentValidationResult('danger', '<i class="fas fa-times-circle me-1"></i>Could not reach the server. Please try again.');
        }

        updateAdjustmentFormInput();
    }

    function scheduleAdjustmentAutoValidation() {
        resetAdjustmentValidationState();
        if (adjValidationTimer) {
            clearTimeout(adjValidationTimer);
        }
        adjValidationTimer = setTimeout(function () {
            runAdjustmentAutoValidation();
        }, 180);
    }

    function updateAdjustmentShiftStatus() {
        const statusEl = document.getElementById('adjShiftStatus');
        if (!statusEl) return;

        if (!adjSelectedDriverId || !adjSelectedDate) {
            adjSelectedDateAllowsAdjustment = false;
            statusEl.innerHTML = '';
            scheduleAdjustmentAutoValidation();
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
            scheduleAdjustmentAutoValidation();
            return;
        }

        if (workingShifts.length > 0) {
            adjSelectedDateAllowsAdjustment = true;
            statusEl.innerHTML = '';
            scheduleAdjustmentAutoValidation();
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
            scheduleAdjustmentAutoValidation();
            return;
        }

        statusEl.innerHTML = '<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>Driver is marked as Day Off on selected day.</span>';

        scheduleAdjustmentAutoValidation();
    }

    async function renderAdjustmentCalendar() {
        const tbody = document.getElementById('adjCalBody');
        const monthLabel = document.getElementById('adjCalMonthLabel');
        if (!tbody || !monthLabel) return;

        const calendarEl = tbody.closest('.holiday-calendar');
        if (calendarEl) {
            calendarEl.classList.toggle('cal-disabled-state', !adjSelectedDriverId);
        }

        const requiredHint = document.getElementById('adjDriverRequiredHint');
        if (requiredHint) {
            requiredHint.classList.toggle('d-none', Boolean(adjSelectedDriverId));
        }

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
        const minSelectableDateStr = getMinimumSelectableDateStr();

        if (adjSelectedDate && adjSelectedDate < minSelectableDateStr) {
            adjSelectedDate = null;
            updateAdjustmentDateDisplay();
            updateAdjustmentShiftStatus();
            updateAdjustmentFormInput();
        }

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

            if (adjSelectedDriverId) {
                const dayShifts = (dayData && dayData.shifts) || [];
                const dayWorkingShifts = dayShifts.filter(function (s) { return s.shift_type !== 'day_off'; });
                const dayNonExtraShifts = dayWorkingShifts.filter(function (s) { return !s.is_extra; });
                if (dateStr < minSelectableDateStr || !dayWorkingShifts.length || dayNonExtraShifts.length >= 2) {
                    classes += ' cal-disabled';
                }
            }

            const visuals = buildUnifiedCalendarCellContent(dayData);
            const inlineRowHtml = `${visuals.contentHtml}${visuals.extraShiftIconHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;

            html += `<td class="${classes}" data-date="${dateStr}">
                <div class="cal-day-header">
                    <div class="fw-bold small">${dayCounter}</div>
                </div>
                <div class="cal-day-inline ${visuals.inlineSizeClass || ''}">${inlineRowHtml}</div>
            </td>`;
            dayCounter++;
        }

        html += '</tr>';
        tbody.innerHTML = html;

        tbody.querySelectorAll('td.cal-day').forEach(function (td) {
            td.addEventListener('click', function () {
                if (!adjSelectedDriverId) return;
                if (td.classList.contains('cal-disabled')) return;
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
                    typeSelectEl.dispatchEvent(new Event('change', { bubbles: true }));
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
                resetAdjustmentValidationState();
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
                resetAdjustmentValidationState();
                updateAdjustmentDateDisplay();
                updateAdjustmentShiftStatus();
                updateAdjustmentFormInput();
                renderAdjustmentCalendar();
            });
        }

        const adjTypeEl = document.getElementById('adjType');
        if (adjTypeEl) {
            adjTypeEl.addEventListener('change', function () {
                scheduleAdjustmentAutoValidation();
            });
        }

        const adjTimeEl = document.getElementById('adjTime');
        if (adjTimeEl) {
            adjTimeEl.addEventListener('change', function () {
                scheduleAdjustmentAutoValidation();
            });
            adjTimeEl.addEventListener('input', function () {
                scheduleAdjustmentAutoValidation();
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


/* ===== scheduling.swap.js ===== */
/**
 * scheduling.swap.js
 * Swap validation and dual-calendar swap selection widget.
 */

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
    const approvedBy = (document.getElementById('swapApprovedBy')?.value || '').trim();

    const resultDiv = document.getElementById('swapValidationResult');
    const confirmBtn = document.getElementById('confirmSwapBtn');
    if (!resultDiv || !confirmBtn) return false;

    resultDiv.style.display = 'none';
    confirmBtn.disabled = true;

    if (!driverId || !giveUpDate || !workDate || !workShiftType || !approvedBy) {
        resultDiv.innerHTML = '<div class="alert alert-warning mb-0"><i class="fas fa-exclamation-triangle me-2"></i>Please fill in all required fields.</div>';
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

    function getMinimumSelectableDateStr() {
        const now = new Date();
        const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() < 6) {
            minDate.setDate(minDate.getDate() - 1);
        }
        return swapFormatDateISO(minDate);
    }

    function enforceSwapCutoffSelection() {
        const minSelectableDateStr = getMinimumSelectableDateStr();
        let didChange = false;

        if (swapGiveUpDate && swapGiveUpDate < minSelectableDateStr) {
            swapGiveUpDate = null;
            didChange = true;
        }
        if (swapWorkDate && swapWorkDate < minSelectableDateStr) {
            swapWorkDate = null;
            didChange = true;
        }

        if (didChange) {
            updateSwapSelectionDisplay();
            syncSwapHiddenFields();
        }
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
        if (dayData.is_holiday) return !!dayData.has_base_working_shift;
        return (
            (dayData.shifts && dayData.shifts.some(shift => shift.shift_type !== 'day_off'))
            || !!dayData.has_base_working_shift
        );
    }

    function isSwapDayOffDay(dateStr) {
        const dayData = getSwapDayData(dateStr);
        if (!dayData) return false;
        if (dayData.is_holiday || dayData.is_within_time_off_block) return false;
        const hasWorkingShift = dayData.shifts && dayData.shifts.some(shift => shift.shift_type !== 'day_off');
        return !hasWorkingShift || !!dayData.has_swap_work;
    }

    function updateSwapSelectionDisplay() {
        const display = document.getElementById('swapDateSelectionDisplay');
        if (!display) return;

        if (!swapSelectedDriverId) {
            display.textContent = 'Select a driver, then click a worked day (left) and an off day (right) on the calendars.';
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
        const minSelectableDateStr = getMinimumSelectableDateStr();
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
            const isWithinTimeOffBlock = !!dayData?.is_within_time_off_block;
            const isSwapUsed = !!(dayData?.has_swap_give_up || dayData?.has_swap_work);
            const hasSwapWork = !!dayData?.has_swap_work;
            // Only treat as a valid off day if the driver actually has a scheduled entry for this day
            // (shifts can be day_off type). An empty shifts array means no schedule at all → not selectable.
            const hasScheduledEntries = !!(dayData && Array.isArray(dayData.shifts) && dayData.shifts.length > 0);
            const isOffDay = !isHoliday && !hasWorkingShift && hasScheduledEntries;
            const isBeforeMinimumDate = dateStr < minSelectableDateStr;

            let classes = 'cal-day';
            let isClickable = Boolean(swapSelectedDriverId);
            let isWorkingDayForPhase = hasWorkingShift;
            const isMirroredSelection = (
                (phase === 'giveup' && !!swapWorkDate && dateStr === swapWorkDate)
                || (phase === 'work' && !!swapGiveUpDate && dateStr === swapGiveUpDate)
            );

            if (swapSelectedDriverId) {
                if (phase === 'giveup') {
                    isWorkingDayForPhase = hasWorkingShift || hasBaseWorkingShift;
                    isClickable = !isBeforeMinimumDate && (
                        (isMirroredSelection && isWorkingDayForPhase)
                        || (isWorkingDayForPhase && !isSwapUsed)
                    );
                } else if (phase === 'work') {
                    isClickable = !isBeforeMinimumDate && !isHoliday && !isWithinTimeOffBlock && (
                        (isMirroredSelection && !isWithinTimeOffBlock)
                        || (isOffDay && !isSwapUsed)
                    );
                }
            }

            if (dateStr === todayStr) classes += ' cal-today';
            if (dateStr === selectedDate) classes += ' cal-selected';
            if (swapSelectedDriverId && !isClickable) classes += ' cal-disabled';
            if (dayData?.has_swap_give_up) classes += ' cal-has-swap-giveup';
            if (dayData?.has_swap_work) classes += ' cal-has-swap-work';

            if (phase === 'giveup' && dateStr === swapGiveUpDate) classes += ' cal-swap-giveup';
            if (phase === 'work' && dateStr === swapWorkDate) classes += ' cal-swap-work';

            html += `<td class="${classes}" data-date="${dateStr}" data-working-day="${isWorkingDayForPhase ? '1' : '0'}" data-off-day="${isOffDay ? '1' : '0'}" data-swap-used="${isSwapUsed ? '1' : '0'}" data-has-swap-work="${hasSwapWork ? '1' : '0'}" data-within-time-off-block="${isWithinTimeOffBlock ? '1' : '0'}">
                <div class="cal-day-header">
                    <div class="fw-bold small">${dayCounter}</div>
                </div>
                <div class="cal-day-inline ${visuals.inlineSizeClass || ''}">${inlineRowHtml}</div>
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
                    isWithinTimeOffBlock: td.getAttribute('data-within-time-off-block') === '1',
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

    function setSwapCalendarsDisabledState(isDisabled) {
        ['swapGiveUpCalBody', 'swapWorkCalBody'].forEach(function (bodyId) {
            const tbody = document.getElementById(bodyId);
            if (!tbody) return;
            const calendarEl = tbody.closest('.holiday-calendar');
            if (!calendarEl) return;
            calendarEl.classList.toggle('cal-disabled-state', Boolean(isDisabled));
        });

        const requiredHint = document.getElementById('swapDriverRequiredHint');
        if (requiredHint) {
            requiredHint.classList.toggle('d-none', !isDisabled);
        }
    }

    async function renderGiveUpCalendar() {
        const tbody = document.getElementById('swapGiveUpCalBody');
        const monthLabel = document.getElementById('swapGiveUpCalMonthLabel');
        if (!tbody || !monthLabel) return;

        enforceSwapCutoffSelection();
        setSwapCalendarsDisabledState(!swapSelectedDriverId);

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

        enforceSwapCutoffSelection();
        setSwapCalendarsDisabledState(!swapSelectedDriverId);

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
                ? ((isMirroredSelection && dayMeta.isWorkingDay) || (dayMeta.isWorkingDay && !dayMeta.isSwapUsed))
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
                ? ((isMirroredSelection && !dayMeta.isWithinTimeOffBlock) || (dayMeta.isOffDay && !dayMeta.isSwapUsed))
                : (isMirroredSelection || isSwapDayOffDay(dateStr));
            if (!validOff) {
                if (swapUsed) {
                    alert('This date is already swapped. Pick a non-swapped off day, or select the same date as the give-up side.');
                } else {
                    alert('You can only select an off day that is not inside a time off block.');
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
                const driverSelectEl = document.getElementById('swapDriver');
                const notesEl = document.getElementById('swapNotes');
                const approvedByEl = document.getElementById('swapApprovedBy');
                const validationResult = document.getElementById('swapValidationResult');
                const confirmBtn = document.getElementById('confirmSwapBtn');

                if (driverSelectEl) {
                    driverSelectEl.value = '';
                }
                if (notesEl) {
                    notesEl.value = '';
                }
                if (approvedByEl) {
                    approvedByEl.value = '';
                }

                swapSelectedDriverId = null;
                swapGiveUpDate = null;
                swapWorkDate = null;

                if (firstShiftOptionEl) {
                    const firstShiftType = firstShiftOptionEl.getAttribute('data-shift-type');
                    selectedPrimarySwapShift = swapShiftMeta[firstShiftType] || null;
                } else {
                    selectedPrimarySwapShift = null;
                }

                renderSwapSecondaryShiftOptions();
                syncSwapShiftTypeHidden();
                renderSwapShiftTypeDisplay();

                updateSwapSelectionDisplay();
                syncSwapHiddenFields();

                if (validationResult) {
                    validationResult.style.display = 'none';
                }
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                }

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
        const swapShiftOptionEls = Array.from(document.querySelectorAll('.swap-shift-option'));
        let selectedPrimarySwapShift = null;

        swapShiftOptionEls.forEach(function(link) {
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

        const firstShiftOptionEl = swapShiftOptionEls.find(function (link) {
            const shiftType = link.getAttribute('data-shift-type');
            return Boolean(shiftType && swapShiftMeta[shiftType]);
        });
        if (firstShiftOptionEl) {
            const firstShiftType = firstShiftOptionEl.getAttribute('data-shift-type');
            selectedPrimarySwapShift = swapShiftMeta[firstShiftType] || null;
        }

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
                badges.push('<span class="badge ' + selectedPrimarySwapShift.color + ' schedule-dropdown-icon-badge me-1"><i class="' + selectedPrimarySwapShift.icon + ' scheduling-type-white-icon"></i></span>' + selectedPrimarySwapShift.label);
            }

            if (!badges.length) {
                displaySpan.innerHTML = '<span class="badge bg-light text-dark border schedule-dropdown-icon-badge me-1"><i class="fas fa-minus text-secondary"></i></span>— Select shift type —';
                return;
            }
            displaySpan.innerHTML = badges.join(' ');
        }

        function renderSwapSecondaryShiftOptions() {
            const wrapper = document.getElementById('swapSecondShiftWrapper');
            const secondarySelect = document.getElementById('swapSecondShiftType');
            const secondaryDisplay = document.getElementById('swapSecondShiftTypeDisplay');
            const secondaryMenu = document.getElementById('swapSecondShiftTypeMenu');
            if (!wrapper || !secondarySelect || !secondaryDisplay || !secondaryMenu) return;

            const renderSecondaryDisplay = function () {
                const secondaryValue = String(secondarySelect.value || '').trim();
                if (!secondaryValue || !swapShiftMeta[secondaryValue]) {
                    secondaryDisplay.innerHTML = '<span class="badge bg-light text-dark border schedule-dropdown-icon-badge me-1"><i class="fas fa-minus text-secondary"></i></span>None';
                    return;
                }
                const meta = swapShiftMeta[secondaryValue];
                secondaryDisplay.innerHTML = '<span class="badge ' + meta.color + ' schedule-dropdown-icon-badge me-1"><i class="' + meta.icon + ' scheduling-type-white-icon"></i></span>' + meta.label;
            };

            const renderSecondaryMenu = function (siblings) {
                let menuHtml = '<li><a class="dropdown-item swap-second-shift-option" href="#" data-value=""><span class="badge bg-light text-dark border schedule-dropdown-icon-badge me-2"><i class="fas fa-minus text-secondary"></i></span>None</a></li>';
                siblings.forEach(function (meta) {
                    menuHtml += '<li><a class="dropdown-item swap-second-shift-option" href="#" data-value="' + meta.shiftType + '"><span class="badge ' + meta.color + ' schedule-dropdown-icon-badge me-2"><i class="' + meta.icon + ' scheduling-type-white-icon"></i></span>' + meta.label + '</a></li>';
                });
                secondaryMenu.innerHTML = menuHtml;

                secondaryMenu.querySelectorAll('.swap-second-shift-option').forEach(function (link) {
                    link.addEventListener('click', function (e) {
                        e.preventDefault();
                        const value = this.getAttribute('data-value') || '';
                        secondarySelect.value = value;
                        secondarySelect.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                });
            };

            if (!selectedPrimarySwapShift || !isSwapSubShift(selectedPrimarySwapShift.shiftType)) {
                secondarySelect.innerHTML = '<option value="">None</option>';
                secondarySelect.value = '';
                secondaryMenu.innerHTML = '';
                renderSecondaryDisplay();
                wrapper.classList.add('d-none');
                return;
            }

            const siblings = getSwapSecondarySubShifts(selectedPrimarySwapShift.shiftType);
            if (!siblings.length) {
                secondarySelect.innerHTML = '<option value="">None</option>';
                secondarySelect.value = '';
                secondaryMenu.innerHTML = '';
                renderSecondaryDisplay();
                wrapper.classList.add('d-none');
                return;
            }

            let options = '<option value="">None</option>';
            siblings.forEach(function(meta) {
                options += '<option value="' + meta.shiftType + '">' + meta.label + '</option>';
            });
            secondarySelect.innerHTML = options;
            secondarySelect.value = '';
            renderSecondaryMenu(siblings);
            renderSecondaryDisplay();
            wrapper.classList.remove('d-none');
        }

        const secondarySelect = document.getElementById('swapSecondShiftType');
        if (secondarySelect) {
            secondarySelect.addEventListener('change', function() {
                const secondaryDisplay = document.getElementById('swapSecondShiftTypeDisplay');
                const secondaryValue = String(secondarySelect.value || '').trim();
                if (secondaryDisplay) {
                    if (!secondaryValue || !swapShiftMeta[secondaryValue]) {
                        secondaryDisplay.innerHTML = '<span class="badge bg-light text-dark border schedule-dropdown-icon-badge me-1"><i class="fas fa-minus text-secondary"></i></span>None';
                    } else {
                        const secondaryMeta = swapShiftMeta[secondaryValue];
                        secondaryDisplay.innerHTML = '<span class="badge ' + secondaryMeta.color + ' schedule-dropdown-icon-badge me-1"><i class="' + secondaryMeta.icon + ' scheduling-type-white-icon"></i></span>' + secondaryMeta.label;
                    }
                }
                syncSwapShiftTypeHidden();
                renderSwapShiftTypeDisplay();
            });
        }

        swapShiftOptionEls.forEach(function(link) {
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

        renderSwapSecondaryShiftOptions();
        syncSwapShiftTypeHidden();
        renderSwapShiftTypeDisplay();

        updateSwapSelectionDisplay();
        syncSwapHiddenFields();
        renderGiveUpCalendar();
        renderWorkCalendar();
    }

    window.schedulingSwapCalendar = {
        init: initSwapCalendar
    };
})();


/* ===== scheduling.calendar-view.js ===== */
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
        const todayStr = new Date().toISOString().slice(0, 10);

        const dayCells = [];

        for (let i = 0; i < totalCells; i++) {
            const cellNum = i - startOffset + 1;
            if (cellNum >= 1 && cellNum <= daysInMonth) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(cellNum).padStart(2, '0')}`;
                let cellClass = 'cal-day calendar-view-day';
                if (dateStr === todayStr) cellClass += ' cal-today';
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


/* ===== scheduling.event-bindings.js ===== */
/**
 * scheduling.event-bindings.js
 * Event handlers and UI wiring for the Scheduling section.
 */

(function () {
    'use strict';

    function initStyledTypeDropdown(selectId, menuId, displayId, placeholder, config = {}) {
        const selectEl = document.getElementById(selectId);
        const menuEl = document.getElementById(menuId);
        const displayEl = document.getElementById(displayId);
        if (!selectEl || !menuEl || !displayEl) return;

        const autoSelectFirst = Boolean(config.autoSelectFirst);

        const selectOptions = Array.from(selectEl.options || []);
        const selectableOptions = selectOptions.filter(function (opt) {
            return String(opt.value || '').trim() !== '';
        });

        menuEl.innerHTML = selectableOptions.map(function (opt) {
            const value = opt.value;
            const label = opt.textContent || value;
            const icon = opt.dataset.icon || 'fas fa-circle';
            const badgeClass = opt.dataset.badge || 'bg-secondary';
            return `<li>
                <a class="dropdown-item scheduling-type-option" href="#" data-value="${value}" data-label="${label}" data-icon="${icon}" data-badge="${badgeClass}">
                    <span class="badge ${badgeClass} schedule-dropdown-icon-badge me-2"><i class="${icon} scheduling-type-white-icon"></i></span>
                    ${label}
                </a>
            </li>`;
        }).join('');

        function renderSelected() {
            const currentValue = String(selectEl.value || '').trim();
            let selected = selectableOptions.find(function (opt) {
                return opt.value === currentValue;
            });

            if (!selected && autoSelectFirst && selectableOptions.length) {
                const fallbackValue = selectableOptions[0].value;
                if (currentValue !== fallbackValue) {
                    selectEl.value = fallbackValue;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    return;
                }
                selected = selectableOptions[0];
            }

            if (!selected) {
                displayEl.innerHTML = `<span class="badge bg-light text-dark border schedule-dropdown-icon-badge me-1"><i class="fas fa-minus text-secondary"></i></span>${placeholder}`;
                return;
            }

            const icon = selected.dataset.icon || 'fas fa-circle';
            const badgeClass = selected.dataset.badge || 'bg-secondary';
            const label = selected.textContent || selected.value;
            displayEl.innerHTML = `<span class="badge ${badgeClass} schedule-dropdown-icon-badge me-1"><i class="${icon} scheduling-type-white-icon"></i></span>${label}`;
        }

        menuEl.querySelectorAll('.scheduling-type-option').forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                const value = this.getAttribute('data-value') || '';
                selectEl.value = value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                renderSelected();
            });
        });

        if (autoSelectFirst && !String(selectEl.value || '').trim() && selectableOptions.length) {
            selectEl.value = selectableOptions[0].value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        selectEl.addEventListener('change', renderSelected);
        renderSelected();
    }

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

        initStyledTypeDropdown('timeOffType', 'timeOffTypeMenu', 'timeOffTypeDisplay', '— Select type —', { autoSelectFirst: true });
        initStyledTypeDropdown('adjType', 'adjTypeMenu', 'adjTypeDisplay', '— Select type —', { autoSelectFirst: true });
        initStyledTypeDropdown('closureType', 'closureTypeMenu', 'closureTypeDisplay', '— Select type —', { autoSelectFirst: true });
        initStyledTypeDropdown('editTimeOffType', 'editTimeOffTypeMenu', 'editTimeOffTypeDisplay', '— Select type —', { autoSelectFirst: true });
        initStyledTypeDropdown('editAdjType', 'editAdjTypeMenu', 'editAdjTypeDisplay', '— Select type —', { autoSelectFirst: true });

        // Update time input hint when adjustment type changes
        const adjTypeSelect = document.getElementById('adjType');
        if (adjTypeSelect) {
            adjTypeSelect.addEventListener('change', updateAdjTimeLabel);
        }

        // Swap auto-validation when required fields are complete
        ['swapDriver', 'swapGiveUpDate', 'swapWorkDate', 'swapWorkShiftType', 'swapApprovedBy'].forEach(function (id) {
            const el = document.getElementById(id);
            if (!el) return;

            el.addEventListener('change', scheduleSwapAutoValidation);
            if (id === 'swapApprovedBy') {
                el.addEventListener('input', scheduleSwapAutoValidation);
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
        initSchoolTermRangeCalendar();
        initSchoolClosureSingleCalendar();

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

        if (termForm) {
            termForm.addEventListener('submit', function (e) {
                const startValue = termStartInput ? String(termStartInput.value || '').trim() : '';
                const endValue = termEndInput ? String(termEndInput.value || '').trim() : '';

                if (!startValue || !endValue) {
                    e.preventDefault();
                    showPageAlert('Please select a start and end date from the School Term calendar.', 'danger');
                    return;
                }

                if (isWeekendDate(startValue) || isWeekendDate(endValue)) {
                    e.preventDefault();
                    showPageAlert('Weekend dates are not allowed in School Calendar entries.', 'danger');
                }
            });
        }

        if (closureForm) {
            closureForm.addEventListener('submit', function (e) {
                const closureValue = closureDateInput ? String(closureDateInput.value || '').trim() : '';
                if (!closureValue) {
                    e.preventDefault();
                    showPageAlert('Please select a school closed day from the calendar.', 'danger');
                    return;
                }

                if (isWeekendDate(closureValue)) {
                    e.preventDefault();
                    showPageAlert('Weekend dates are not allowed in School Calendar entries.', 'danger');
                }
            });
        }
    }

    function initSchoolClosureSingleCalendar() {
        const tbody = document.getElementById('closureCalBody');
        const monthLabel = document.getElementById('closureCalMonthLabel');
        const prevBtn = document.getElementById('closureCalPrev');
        const nextBtn = document.getElementById('closureCalNext');
        const clearBtn = document.getElementById('clearClosureSelection');
        const closureInput = document.getElementById('closureDate');
        const display = document.getElementById('closureDateDisplay');
        const saveBtn = document.getElementById('saveClosureBtn');

        if (!tbody || !monthLabel || !closureInput) return;

        const viewDate = new Date();
        viewDate.setDate(1);

        let selectedDate = closureInput.value || null;

        function toISO(dateObj) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function isWeekendISO(dateStr) {
            if (!dateStr) return false;
            const parsed = new Date(`${dateStr}T00:00:00`);
            if (Number.isNaN(parsed.getTime())) return false;
            const day = parsed.getDay();
            return day === 0 || day === 6;
        }

        function syncInput() {
            closureInput.value = selectedDate || '';
            if (saveBtn) saveBtn.disabled = !selectedDate;
        }

        function updateDisplay() {
            if (!display) return;
            if (!selectedDate) {
                display.textContent = 'Click a date on the calendar.';
                return;
            }
            const selectedObj = new Date(`${selectedDate}T00:00:00`);
            const selectedFormatted = selectedObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            display.innerHTML = `<strong>Selected:</strong> ${selectedFormatted}`;
        }

        function selectDate(dateStr) {
            if (isWeekendISO(dateStr)) return;
            selectedDate = dateStr;
            syncInput();
            updateDisplay();
            render();
        }

        function render() {
            const year = viewDate.getFullYear();
            const month = viewDate.getMonth();
            monthLabel.textContent = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

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

                const dateStr = toISO(new Date(year, month, dayCounter));
                const weekend = isWeekendISO(dateStr);
                const isSelected = dateStr === selectedDate;

                let classes = 'cal-day';
                if (weekend) classes += ' cal-disabled';
                if (isSelected) classes += ' cal-selected';

                html += `<td class="${classes}" data-date="${dateStr}">
                    <div class="cal-day-header">
                        <div class="fw-bold small">${dayCounter}</div>
                    </div>
                </td>`;
                dayCounter++;
            }

            html += '</tr>';
            tbody.innerHTML = html;

            tbody.querySelectorAll('td.cal-day').forEach(function (cell) {
                cell.addEventListener('click', function () {
                    if (cell.classList.contains('cal-disabled')) return;
                    const pickedDate = cell.getAttribute('data-date');
                    if (!pickedDate) return;
                    selectDate(pickedDate);
                });
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                viewDate.setMonth(viewDate.getMonth() - 1);
                render();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                viewDate.setMonth(viewDate.getMonth() + 1);
                render();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                selectedDate = null;
                const notesInput = document.getElementById('closureNotes');
                if (notesInput) notesInput.value = '';
                const closureTypeEl = document.getElementById('closureType');
                if (closureTypeEl) {
                    closureTypeEl.value = '';
                    closureTypeEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                syncInput();
                updateDisplay();
                render();
            });
        }

        syncInput();
        updateDisplay();
        render();
    }

    function initSchoolTermRangeCalendar() {
        const tbody = document.getElementById('termCalBody');
        const monthLabel = document.getElementById('termCalMonthLabel');
        const prevBtn = document.getElementById('termCalPrev');
        const nextBtn = document.getElementById('termCalNext');
        const clearBtn = document.getElementById('clearTermSelection');
        const startInput = document.getElementById('termStartDate');
        const endInput = document.getElementById('termEndDate');
        const display = document.getElementById('termDateDisplay');
        const saveBtn = document.getElementById('saveTermBtn');

        if (!tbody || !monthLabel || !startInput || !endInput) return;

        const viewDate = new Date();
        viewDate.setDate(1);

        let startDate = startInput.value || null;
        let endDate = endInput.value || null;

        if (startDate && !endDate) {
            endDate = startDate;
        }

        function toISO(dateObj) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function isWeekendISO(dateStr) {
            if (!dateStr) return false;
            const parsed = new Date(`${dateStr}T00:00:00`);
            if (Number.isNaN(parsed.getTime())) return false;
            const day = parsed.getDay();
            return day === 0 || day === 6;
        }

        function isInRange(dateStr) {
            if (!startDate) return false;
            if (!endDate) return dateStr === startDate;
            return dateStr >= startDate && dateStr <= endDate;
        }

        function updateDisplayText() {
            if (!display) return;

            if (!startDate) {
                display.textContent = 'Click a start date, then click an end date on the calendar.';
                return;
            }

            const startObj = new Date(`${startDate}T00:00:00`);
            const startFormatted = startObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

            if (!endDate || endDate === startDate) {
                display.innerHTML = `<strong>Selected:</strong> ${startFormatted} (1 day)`;
                return;
            }

            const endObj = new Date(`${endDate}T00:00:00`);
            const endFormatted = endObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const dayCount = Math.floor((endObj - startObj) / (1000 * 60 * 60 * 24)) + 1;
            display.innerHTML = `<strong>Range:</strong> ${startFormatted} to ${endFormatted} (${dayCount} days)`;
        }

        function syncInputs() {
            startInput.value = startDate || '';
            endInput.value = endDate || startDate || '';
            if (saveBtn) saveBtn.disabled = !startDate;
        }

        function selectDate(dateStr) {
            if (isWeekendISO(dateStr)) return;

            if (!startDate || (startDate && endDate)) {
                startDate = dateStr;
                endDate = null;
            } else {
                endDate = dateStr;
                if (endDate < startDate) {
                    const temp = startDate;
                    startDate = endDate;
                    endDate = temp;
                }
            }

            updateDisplayText();
            syncInputs();
            render();
        }

        function render() {
            const year = viewDate.getFullYear();
            const month = viewDate.getMonth();

            monthLabel.textContent = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

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

                const dateStr = toISO(new Date(year, month, dayCounter));
                const weekend = isWeekendISO(dateStr);
                const selectedStart = dateStr === startDate;
                const selectedEnd = dateStr === endDate;
                const inRange = isInRange(dateStr);

                let classes = 'cal-day';
                if (weekend) classes += ' cal-disabled';
                if (selectedStart || selectedEnd) classes += ' cal-selected';
                if (inRange && startDate && endDate && startDate !== endDate) classes += ' cal-in-range';

                html += `<td class="${classes}" data-date="${dateStr}">
                    <div class="cal-day-header">
                        <div class="fw-bold small">${dayCounter}</div>
                    </div>
                </td>`;
                dayCounter++;
            }

            html += '</tr>';
            tbody.innerHTML = html;

            tbody.querySelectorAll('td.cal-day').forEach(function (cell) {
                cell.addEventListener('click', function () {
                    if (cell.classList.contains('cal-disabled')) return;
                    const pickedDate = cell.getAttribute('data-date');
                    if (!pickedDate) return;
                    selectDate(pickedDate);
                });
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                viewDate.setMonth(viewDate.getMonth() - 1);
                render();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                viewDate.setMonth(viewDate.getMonth() + 1);
                render();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                startDate = null;
                endDate = null;
                const termNameInput = document.getElementById('termName');
                if (termNameInput) termNameInput.value = '';
                updateDisplayText();
                syncInputs();
                render();
            });
        }

        updateDisplayText();
        syncInputs();
        render();
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

    let swapAutoValidationTimer = null;

    function areSwapRequiredFieldsComplete() {
        const driverId = (document.getElementById('swapDriver')?.value || '').trim();
        const giveUpDate = (document.getElementById('swapGiveUpDate')?.value || '').trim();
        const workDate = (document.getElementById('swapWorkDate')?.value || '').trim();
        const workShiftType = (document.getElementById('swapWorkShiftType')?.value || '').trim();
        const approvedBy = (document.getElementById('swapApprovedBy')?.value || '').trim();
        return Boolean(driverId && giveUpDate && workDate && workShiftType && approvedBy);
    }

    function scheduleSwapAutoValidation() {
        resetSwapValidation();

        if (swapAutoValidationTimer) {
            clearTimeout(swapAutoValidationTimer);
        }

        if (!areSwapRequiredFieldsComplete()) {
            return;
        }

        swapAutoValidationTimer = setTimeout(function () {
            validateSwapForm();
        }, 180);
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
        if (typeEl) {
            typeEl.value = type;
            typeEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
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
    const editTimeOffTypeEl = document.getElementById('editTimeOffType');
    if (editTimeOffTypeEl) {
        editTimeOffTypeEl.value = timeOffType || 'holiday';
        editTimeOffTypeEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
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


/* ===== scheduling.modal-init.js ===== */
/**
 * scheduling.modal-init.js
 * Initialization handlers for scheduling modal forms (school terms and closures).
 */

(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        // Initialize edit term modal
        initializeModalDataPopulation('editSchoolTermModal', 'editSchoolTermForm', {
            dataAttrToFormField: {
                'data-term-id': null,
                'data-term-name': 'editTermName',
                'data-term-start': 'editTermStartDate',
                'data-term-end': 'editTermEndDate'
            },
            urlPattern: '/scheduling/term/{data-term-id}/edit'
        });
        
        // Initialize edit closure modal
        initializeModalDataPopulation('editSchoolClosureModal', 'editSchoolClosureForm', {
            dataAttrToFormField: {
                'data-closure-id': null,
                'data-closure-date': 'editClosureDate',
                'data-closure-type': 'editClosureType',
                'data-closure-notes': 'editClosureNotes'
            },
            urlPattern: '/scheduling/school-closure/{data-closure-id}/edit'
        });
    });

})();

