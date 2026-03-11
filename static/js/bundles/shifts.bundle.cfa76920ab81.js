/* Auto-generated bundle. Do not edit directly. */
/* Bundle: shifts.bundle.js */


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


/* ===== shifts.core.js ===== */
/**
 * shifts.core.js
 * Core utilities for Shift Patterns management
 */

function getCurrentShiftTypes() {
    const form = document.getElementById('shiftTypesForm');
    if (!form) return [];

    const types = [];
    form.querySelectorAll('input[name$="_start"]').forEach((input) => {
        types.push(input.name.replace(/_start$/, ''));
    });

    return types;
}

function formatShiftLabel(value) {
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

function getShiftAbbreviation(shiftName, allShifts = []) {
    // Get formatted version of the shift name
    const formatted = formatShiftLabel(shiftName);
    const words = formatted.split(/\s+/);
    
    // Single word: check if initial is unique in all shifts
    if (words.length === 1) {
        const initial = shiftName.charAt(0).toUpperCase();
        const conflicts = allShifts.filter(s => s.charAt(0).toUpperCase() === initial && s !== shiftName);
        if (conflicts.length === 0) {
            return initial;
        }
    }
    
    // Multiple words: first letter of each word
    if (words.length > 1) {
        return words.map(w => w.charAt(0).toUpperCase()).join('');
    }
    
    // Fallback: first letter
    return shiftName.charAt(0).toUpperCase();
}

function buildShiftTypeOptions(selectedValue = '') {
    const shiftTypes = getCurrentShiftTypes();
    return shiftTypes.map((type) => {
        const selected = selectedValue === type ? 'selected' : '';
        const displayInput = document.querySelector(`#shiftTypesForm input[name="${type}_name"]`);
        const label = formatShiftLabel(displayInput ? displayInput.value : type);
        return `<option value="${type}" ${selected}>${label}</option>`;
    }).join('');
}

function getBadgeTextColor(badgeColor) {
    const colorMap = {
        'bg-primary': 'text-primary',
        'bg-success': 'text-success',
        'bg-danger': 'text-danger',
        'bg-warning': 'text-warning',
        'bg-info': 'text-info',
        'bg-secondary': 'text-secondary',
        'bg-dark': 'text-dark'
    };
    return colorMap[badgeColor] || 'text-primary';
}

function toTitleCase(value) {
    return formatShiftLabel(value);
}

function syncCurrentShiftsCard(shiftType, startTime, endTime, icon = 'fas fa-clock', badgeColor = 'bg-primary') {
    const currentGrid = document.getElementById('currentShiftsGrid');
    if (!currentGrid) return;

    let card = currentGrid.querySelector(`.current-shift-card[data-shift-type="${shiftType}"]`);
    if (!card) {
        card = document.createElement('div');
        card.className = 'col-md-3 current-shift-card';
        card.setAttribute('data-shift-type', shiftType);
        currentGrid.appendChild(card);
    }

    card.setAttribute('data-start-time', startTime);
    const textColor = getBadgeTextColor(badgeColor);
    const label = toTitleCase(shiftType);
    card.innerHTML = `
        <div class="text-center p-3 border rounded">
            <i class="${icon} ${textColor} fa-2x mb-2"></i>
            <h6>${label}</h6>
            <p class="mb-0"><strong>${startTime} - ${endTime}</strong></p>
        </div>
    `;

    const cards = Array.from(currentGrid.querySelectorAll('.current-shift-card'));
    cards.sort((a, b) => (a.getAttribute('data-start-time') || '').localeCompare(b.getAttribute('data-start-time') || ''));
    cards.forEach(sortedCard => currentGrid.appendChild(sortedCard));
}

function removeCurrentShiftsCard(shiftType) {
    const currentGrid = document.getElementById('currentShiftsGrid');
    if (!currentGrid) return;
    const card = currentGrid.querySelector(`.current-shift-card[data-shift-type="${shiftType}"]`);
    if (card) {
        card.remove();
    }
}

let shiftTimesBaseline = {};

function captureShiftTimesBaseline() {
    const form = document.getElementById('shiftTypesForm');
    if (!form) return;

    const baseline = {};
    form.querySelectorAll('input[name$="_start"], input[name$="_end"]').forEach((input) => {
        baseline[input.name] = input.value;
    });
    shiftTimesBaseline = baseline;
}

function restoreShiftTimesFromBaseline() {
    const form = document.getElementById('shiftTypesForm');
    if (!form) return;

    form.querySelectorAll('input[name$="_start"], input[name$="_end"]').forEach((input) => {
        if (Object.prototype.hasOwnProperty.call(shiftTimesBaseline, input.name)) {
            input.value = shiftTimesBaseline[input.name];
        }
    });
}

const feedbackTimers = {};
const ALERT_VARIANT_CLASSES = ['alert-success', 'alert-danger', 'alert-warning', 'alert-info'];
const FEEDBACK_TRANSITION_CLASSES = ['fade', 'show'];

function clearFeedbackTimer(timerKey) {
    const timerGroup = feedbackTimers[timerKey];
    if (!timerGroup) return;

    if (timerGroup.hide) {
        clearTimeout(timerGroup.hide);
    }
    if (timerGroup.cleanup) {
        clearTimeout(timerGroup.cleanup);
    }

    delete feedbackTimers[timerKey];
}

function setPendingMainFeedback(type, message) {
    try {
        sessionStorage.setItem('pendingMainFeedback', JSON.stringify({ type, message }));
    } catch (error) {
        console.warn('Could not store pending feedback:', error);
    }
}

function flushPendingMainFeedback() {
    try {
        const raw = sessionStorage.getItem('pendingMainFeedback');
        if (!raw) return;

        sessionStorage.removeItem('pendingMainFeedback');
        const payload = JSON.parse(raw);
        if (payload && payload.type && payload.message) {
            showAlertBanner(payload.type, payload.message);
        }
    } catch (error) {
        console.warn('Could not load pending feedback:', error);
    }
}

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

function attachFormattedInputListener(inputId, formatter) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl || inputEl.hasFormattingListener) return;

    inputEl.addEventListener('input', function(e) {
        const input = e.target;
        const cursorPosition = input.selectionStart;
        input.value = formatter(input.value);
        input.setSelectionRange(cursorPosition, cursorPosition);
    });

    inputEl.hasFormattingListener = true;
}

function toTitleCaseWords(value) {
    return value
        .toLowerCase()
        .replace(/\b\w/g, function(char) {
            return char.toUpperCase();
        })
        .replace(/\bAm\b/g, 'AM')
        .replace(/\bPm\b/g, 'PM');
}

function toSentenceCase(value) {
    return value.toLowerCase().replace(/(^|\. )(\w)/g, function(match, p1, p2) {
        return p1 + p2.toUpperCase();
    });
}

function normalizeSelectedShiftValues(value) {
    if (Array.isArray(value)) {
        const cleaned = value.map(v => String(v || '').trim()).filter(Boolean);
        return cleaned.length ? cleaned : ['day_off'];
    }

    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }

    return ['day_off'];
}

function getSelectedDayShiftValues(selectEl) {
    if (!selectEl) {
        return ['day_off'];
    }

    const primaryValue = String(selectEl.value || 'day_off').trim() || 'day_off';
    if (primaryValue === 'day_off') {
        return ['day_off'];
    }

    const values = [primaryValue];
    const secondarySelect = document.getElementById(`${selectEl.id}_extra`);
    if (secondarySelect) {
        const secondaryValue = String(secondarySelect.value || '').trim();
        if (secondaryValue && secondaryValue !== 'day_off' && secondaryValue !== primaryValue) {
            values.push(secondaryValue);
        }
    }

    return values;
}

function getParentShiftType(shiftType) {
    if (!shiftType || shiftType === 'day_off') {
        return null;
    }

    const input = document.querySelector(`#shiftTypesForm input[name="${shiftType}_parent"]`);
    if (!input) {
        return null;
    }

    const value = String(input.value || '').trim();
    if (!value || value === '_none') {
        return null;
    }
    return value;
}

function isSubShift(shiftType) {
    return !!getParentShiftType(shiftType);
}

function getAvailableSecondarySubShifts(primaryShiftType) {
    if (!isSubShift(primaryShiftType)) {
        return [];
    }

    return getCurrentShiftTypes().filter((type) => {
        return type !== primaryShiftType && isSubShift(type);
    });
}

function buildShiftOptionsMarkup(selectedValue = 'day_off') {
    const dayOffSelected = selectedValue === 'day_off' ? 'selected' : '';
    const options = getCurrentShiftTypes().map((type) => {
        const isSelected = selectedValue === type ? 'selected' : '';
        const displayInput = document.querySelector(`#shiftTypesForm input[name="${type}_name"]`);
        const label = formatShiftLabel(displayInput ? displayInput.value : type);
        return `<option value="${type}" ${isSelected}>${label}</option>`;
    }).join('');

    return `<option value="day_off" ${dayOffSelected}>Day Off</option>${options}`;
}

function updateSecondaryShiftVisibility(primarySelect, secondarySelect, preferredValue = '') {
    if (!primarySelect || !secondarySelect) {
        return;
    }

    const wrapper = document.getElementById(`${secondarySelect.id}_wrapper`);
    const primaryValue = String(primarySelect.value || 'day_off').trim() || 'day_off';

    if (primaryValue === 'day_off' || !isSubShift(primaryValue)) {
        secondarySelect.innerHTML = '<option value="">None</option>';
        secondarySelect.value = '';
        if (wrapper) {
            wrapper.classList.add('d-none');
        }
        return;
    }

    const siblings = getAvailableSecondarySubShifts(primaryValue);
    let options = '<option value="">None</option>';
    siblings.forEach((type) => {
        const displayInput = document.querySelector(`#shiftTypesForm input[name="${type}_name"]`);
        const label = formatShiftLabel(displayInput ? displayInput.value : type);
        const selected = preferredValue === type ? 'selected' : '';
        options += `<option value="${type}" ${selected}>${label}</option>`;
    });

    secondarySelect.innerHTML = options;
    if (preferredValue && siblings.includes(preferredValue)) {
        secondarySelect.value = preferredValue;
    } else {
        secondarySelect.value = '';
    }

    if (wrapper) {
        wrapper.classList.remove('d-none');
    }
}

function handlePrimaryShiftChange(selectEl) {
    if (!selectEl) {
        return;
    }
    const secondarySelect = document.getElementById(`${selectEl.id}_extra`);
    updateSecondaryShiftVisibility(selectEl, secondarySelect);
}

function renderDayShiftSelect(selectId, fieldName, selectedValues = ['day_off']) {
    const normalized = normalizeSelectedShiftValues(selectedValues);
    const primaryValue = normalized[0] || 'day_off';
    const secondaryValue = normalized.length > 1 ? normalized[1] : '';

    return `
        <select class="form-select" id="${selectId}" name="${fieldName}" onchange="handlePrimaryShiftChange(this)">
            ${buildShiftOptionsMarkup(primaryValue)}
        </select>
        <div id="${selectId}_extra_wrapper" class="mt-2 d-none">
            <label for="${selectId}_extra" class="form-label mb-1">Second Shift (Optional)</label>
            <select class="form-select" id="${selectId}_extra" aria-label="Second Shift">
                <option value="">None</option>
            </select>
        </div>
        <small class="text-muted">Choose one shift. If it is a sub-shift, you can add a second one.</small>
    `;
}

function initializeDayShiftSelect(selectId, selectedValues = ['day_off']) {
    const primarySelect = document.getElementById(selectId);
    const secondarySelect = document.getElementById(`${selectId}_extra`);
    if (!primarySelect || !secondarySelect) {
        return;
    }

    const normalized = normalizeSelectedShiftValues(selectedValues);
    primarySelect.value = normalized[0] || 'day_off';
    const secondaryValue = normalized.length > 1 ? normalized[1] : '';
    updateSecondaryShiftVisibility(primarySelect, secondarySelect, secondaryValue);
}



/* ===== shifts.form-handlers.js ===== */
/**
 * shifts.form-handlers.js
 * Form submission handlers for Shift Patterns management
 * Dependencies: shifts.core.js
 */

function getCycleDayLabel(index) {
    return `Cycle Day ${index + 1}`;
}

/**
 * Initialize all form event handlers
 */
function initializeFormHandlers() {
    if (window.__shiftsFormHandlersInitialized) {
        return;
    }
    window.__shiftsFormHandlersInitialized = true;

    // Form handlers are attached via shifts.event-bindings.js
}

/**
 * Update create pattern day fields
 */
function updateCreatePatternDays() {
    const cycleLength = parseInt(document.getElementById('createCycleLength').value);
    const container = document.getElementById('createPatternDaysContainer');
    const section = document.getElementById('createPatternDays');
    const submitBtn = document.getElementById('createPatternBtn');
    
    if (!cycleLength) {
        section.style.display = 'none';
        submitBtn.disabled = true;
        return;
    }
    
    const shiftTypes = getCurrentShiftTypes();
    if (shiftTypes.length === 0) {
        section.style.display = 'block';
        submitBtn.disabled = true;
        container.innerHTML = '<div class="col-12"><div class="alert alert-warning"><i class="fas fa-exclamation-triangle"></i> No shift types are defined. Please add shift types via <strong>Manage Shifts</strong> before creating patterns.</div></div>';
        return;
    }
    
    section.style.display = 'block';
    submitBtn.disabled = false;
    container.innerHTML = '';
    
    for (let i = 0; i < cycleLength; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'col-md-3 mb-3';
        
        dayDiv.innerHTML = `
            <label for="create_day_${i}_shift" class="form-label">${getCycleDayLabel(i)}</label>
            ${renderDayShiftSelect(`create_day_${i}_shift`, `day_${i}_shift`, ['day_off'])}
        `;
        
        container.appendChild(dayDiv);
        initializeDayShiftSelect(`create_day_${i}_shift`, ['day_off']);
    }
    
    attachFormattedInputListener('createName', toTitleCaseWords);
    attachFormattedInputListener('createDescription', toSentenceCase);
}

function saveCreatePattern(event) {
    if (event) {
        event.preventDefault();
    }

    const form = document.getElementById('createPatternForm');
    if (!form) return;
    
    const cycleLength = document.getElementById('createCycleLength').value;
    const error = Validate.cycle_length(cycleLength);
    if (error) {
        showAlertBanner('error', error);
        DEBUG.warn('Invalid cycle length', { cycleLength });
        return;
    }
    
    const formData = new FormData(form);
    const cycleLengthNum = parseInt(cycleLength, 10);
    
    // Add daily shift data
    for (let i = 0; i < cycleLengthNum; i++) {
        const select = document.getElementById(`create_day_${i}_shift`);
        if (select) {
            getSelectedDayShiftValues(select).forEach((value) => {
                formData.append(`day_${i}_shift`, value);
            });
        }
    }
    
    const submitBtn = document.getElementById('createPatternBtn');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = MESSAGES.SAVING;
    DEBUG.log('Submitting create pattern form', 'info', { cycleLength: cycleLengthNum });
    
    requestJson(form.action || '/shift-pattern/add', {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        if (data.success) {
            hideModalById('createPatternModal');
            form.reset();
            document.getElementById('createPatternDays').style.display = 'none';
            showAlertBanner('success', data.message || MESSAGES.PATTERN_CREATED);
            DEBUG.log('Pattern created', 'info');
            location.reload(); // Reload to show new pattern
        } else {
            const errorMsg = data.error || MESSAGES.SERVER_ERROR;
            showAlertBanner('error', errorMsg);
            DEBUG.warn('Create pattern failed', { error: errorMsg });
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error creating pattern', { error });
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
    });
}

function addShiftType(event) {
    if (event) {
        event.preventDefault();
    }

    const form = document.getElementById('addShiftTypeForm');
    if (!form) return;
    
    const formData = new FormData(form);
    const submitBtn = document.getElementById('submitAddShiftTypeBtn');
    const originalHtml = submitBtn.innerHTML;
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = MESSAGES.SAVING;
    DEBUG.log('Submitting add shift type form', 'info');
    
    requestJson(form.action || '/shift-types/add', {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        if (data.success) {
            hideModalById('addShiftTypeModal');
            form.reset();
            showAlertBanner('success', data.message || MESSAGES.SHIFT_TYPE_ADDED);
            DEBUG.log('Shift type added', 'info');
            location.reload();
        } else {
            const errorMsg = data.error || MESSAGES.SERVER_ERROR;
            showAlertBanner('error', errorMsg);
            DEBUG.warn('Add shift type failed', { error: errorMsg });
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error adding shift type', { error });
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
    });
}

function editShiftType(shiftType) {
    // Fetch full shift data via AJAX
    requestJson(`/shift-types/${shiftType}/data`)
    .then(data => {
        if (data && data.shift_type) {
            // Populate the edit form
            document.getElementById('edit_shift_type_original').value = shiftType;
            document.getElementById('edit_shift_type').value = data.display_label || '';
            document.getElementById('edit_shift_start').value = data.start_time || '';
            document.getElementById('edit_shift_end').value = data.end_time || '';
            document.getElementById('edit_shift_color').value = data.badge_color || 'bg-primary';
            document.getElementById('edit_shift_icon').value = data.icon || 'fas fa-clock';
            
            // Populate parent select with all available shift types  
            const parentSelect = document.getElementById('edit_shift_parent');
            
            // Get all shift type rows from the table
            const shiftRows = document.querySelectorAll('#shiftTypesTableBody tr[id^="shift-row-"]');
            const allShiftTypes = Array.from(shiftRows).map(tr => {
                const btn = tr.querySelector('.js-edit-shift-type');
                return btn?.dataset.shiftType;
            }).filter(Boolean);
            
            // Clear existing options (except _none)
            const existing = parentSelect.querySelectorAll('option:not([value="_none"])');
            existing.forEach(opt => opt.remove());
            
            // Add all other shift types
            allShiftTypes.forEach(otherType => {
                if (otherType !== shiftType) {
                    const option = document.createElement('option');
                    option.value = otherType;
                    const nameCell = document.querySelector(`tr[id="shift-row-${otherType}"] td:nth-child(2) strong`);
                    const nameText = nameCell?.textContent?.trim() || otherType;
                    option.textContent = nameText;
                    parentSelect.appendChild(option);
                }
            });
            
            // Set the parent value if it exists
            if (data.parent_shift_type) {
                parentSelect.value = data.parent_shift_type;
            } else {
                parentSelect.value = '_none';
            }
            
            // Show the edit modal
            const modal = new bootstrap.Modal(document.getElementById('editShiftTypeModal'));
            modal.show();
        } else {
            showAlertBanner('error', MESSAGES.LOAD_DATA_ERROR);
            DEBUG.warn('Could not load shift type data');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error loading shift type data', { error });
    });
}

function submitEditShiftType(event) {
    if (event) {
        event.preventDefault();
    }

    const form = document.getElementById('editShiftTypeForm');
    if (!form) return;
    
    const originalShiftType = document.getElementById('edit_shift_type_original').value;
    const formData = new FormData(form);
    
    const submitBtn = document.getElementById('submitEditShiftTypeBtn');
    const originalHtml = submitBtn.innerHTML;
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = MESSAGES.SAVING;
    DEBUG.log('Submitting edit shift type form', 'info');
    
    requestJson(`/shift-types/${originalShiftType}/edit`, {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        if (data.success) {
            hideModalById('editShiftTypeModal');
            form.reset();
            showAlertBanner('success', data.message || MESSAGES.SHIFT_TYPE_UPDATED);
            DEBUG.log('Shift type updated', 'info');
            location.reload();
        } else {
            const errorMsg = data.error || MESSAGES.SERVER_ERROR;
            showAlertBanner('error', errorMsg);
            DEBUG.warn('Edit shift type failed', { error: errorMsg });
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error updating shift type', { error });
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
    });
}

function deleteShiftType(shiftType, shiftName) {
    // Close modal immediately to prevent any form submission issues
    const modalEl = document.getElementById('deleteModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }
    
    DEBUG.log('Deleting shift type', { shiftType });
    
    requestJson(`/shift-types/delete/${shiftType}`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        // Clear pending deletion
        window.pendingShiftTypeDelete = null;
        
        if (data.success) {
            showAlertBanner('success', data.message || MESSAGES.SHIFT_TYPE_DELETED);
            DEBUG.log('Shift type deleted', 'info');
            location.reload();
        } else {
            // Show error message
            const errorMsg = data.error || MESSAGES.SERVER_ERROR;
            showAlertBanner('error', errorMsg);
            DEBUG.warn('Delete shift type failed', { error: errorMsg });
        }
    })
    .catch(error => {
        console.error('Error:', error);
        // Clear pending deletion
        window.pendingShiftTypeDelete = null;
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error deleting shift type', { error });
    });
}

function confirmDeleteShiftType(shiftType, shiftName) {
    // Store the delete context as a global so the form submit handler can access it
    window.pendingShiftTypeDelete = { shiftType, shiftName };
    
    window.showGlobalDeleteConfirm({
        title: 'Confirm Deletion',
        message: 'Are you sure you want to delete the shift type',
        name: shiftName,
        warning: 'This action cannot be undone. Deletion will fail if the shift type is used in any patterns or if other shifts are grouped under it.',
        action: 'javascript:void(0);',
        submitLabel: 'Delete Shift Type'
    });
}

function deletePattern(patternId, patternName) {
    // Close modal immediately to prevent any form submission issues
    const modalEl = document.getElementById('deleteModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }
    
    DEBUG.log('Deleting pattern', { patternId });
    
    requestJson(`/shift-pattern/${patternId}/delete`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        // Clear pending deletion
        window.pendingPatternDelete = null;
        
        if (data.success) {
            showAlertBanner('success', data.message || MESSAGES.PATTERN_DELETED);
            DEBUG.log('Pattern deleted', 'info');
            location.reload();
        } else {
            // Show error message
            const errorMsg = data.error || MESSAGES.SERVER_ERROR;
            showAlertBanner('error', errorMsg);
            DEBUG.warn('Delete pattern failed', { error: errorMsg });
        }
    })
    .catch(error => {
        console.error('Error:', error);
        // Clear pending deletion
        window.pendingPatternDelete = null;
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error deleting pattern', { error });
    });
}

function confirmDelete(patternId, patternName) {
    // Store the delete context as a global so the button handler can access it
    window.pendingPatternDelete = { patternId, patternName };
    
    window.showGlobalDeleteConfirm({
        title: 'Confirm Deletion',
        message: 'Are you sure you want to delete the shift pattern',
        name: patternName,
        warning: 'This action cannot be undone. Deletion will fail if there are active or scheduled driver assignments.',
        action: 'javascript:void(0);',
        submitLabel: 'Delete Pattern'
    });
}

function editPattern(patternId) {
    DEBUG.log('Loading pattern for edit', { patternId });
    
    requestJson(`/shift-pattern/${patternId}/edit-data`)
    .then(data => {
        if (data && data.id) {
            window.currentEditPatternData = {
                id: data.id,
                name: data.name,
                description: data.description,
                cycle_length: data.cycle_length,
                data: data.pattern_data || []
            };
            
            // Populate form with pattern data
            document.getElementById('editName').value = data.name || '';
            document.getElementById('editDescription').value = data.description || '';
            document.getElementById('editCycleLength').value = data.cycle_length || 1;
            document.getElementById('editPatternId').value = data.id;

            const form = document.getElementById('editPatternForm');
            if (form) {
                form.action = `/shift-pattern/${data.id}/edit`;
            }
            
            updateEditPatternDays();
            
            const modal = new bootstrap.Modal(document.getElementById('editPatternModal'));
            modal.show();
            DEBUG.log('Pattern loaded successfully', 'info');
        } else {
            showAlertBanner('error', MESSAGES.LOAD_DATA_ERROR);
            DEBUG.warn('Could not load pattern data');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error loading pattern', { error });
    });
}

function updateEditPatternDays() {
    const cycleLength = parseInt(document.getElementById('editCycleLength').value);
    const container = document.getElementById('editPatternDaysContainer');
    const section = document.getElementById('editPatternDays');
    const submitBtn = document.getElementById('savePatternBtn');
    
    if (!cycleLength) {
        section.style.display = 'none';
        submitBtn.disabled = true;
        return;
    }
    
    section.style.display = 'block';
    submitBtn.disabled = false;
    container.innerHTML = '';
    
    const currentPattern = window.currentEditPatternData || {};
    
    for (let i = 0; i < cycleLength; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'col-md-3 mb-3';
        
        const dayShifts = currentPattern.data && currentPattern.data[i] ? currentPattern.data[i] : ['day_off'];
        
        dayDiv.innerHTML = `
            <label for="edit_day_${i}_shift" class="form-label">${getCycleDayLabel(i)}</label>
            ${renderDayShiftSelect(`edit_day_${i}_shift`, `day_${i}_shift`, dayShifts)}
        `;
        
        container.appendChild(dayDiv);
        initializeDayShiftSelect(`edit_day_${i}_shift`, dayShifts);
    }
    
    attachFormattedInputListener('editName', toTitleCaseWords);
    attachFormattedInputListener('editDescription', toSentenceCase);
}

function savePattern(event) {
    if (event) {
        event.preventDefault();
    }

    const form = document.getElementById('editPatternForm');
    if (!form) return;
    
    const formData = new FormData(form);
    
    // Add daily shift data
    const cycleLength = parseInt(document.getElementById('editCycleLength').value);
    for (let i = 0; i < cycleLength; i++) {
        const select = document.getElementById(`edit_day_${i}_shift`);
        if (select) {
            getSelectedDayShiftValues(select).forEach((value) => {
                formData.append(`day_${i}_shift`, value);
            });
        }
    }
    
    const submitBtn = document.getElementById('savePatternBtn');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = MESSAGES.SAVING;
    DEBUG.log('Submitting edit pattern form', 'info');
    
    const patternId = document.getElementById('editPatternId')?.value;
    const actionUrl = form.action || (patternId ? `/shift-pattern/${patternId}/edit` : '');
    if (!actionUrl) {
        showAlertBanner('error', MESSAGES.FORM_ERROR);
        DEBUG.warn('Could not determine edit endpoint');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
        return;
    }

    requestJson(actionUrl, {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        if (data.success) {
            hideModalById('editPatternModal');
            form.reset();
            document.getElementById('editPatternDays').style.display = 'none';
            showAlertBanner('success', data.message || MESSAGES.PATTERN_UPDATED);
            DEBUG.log('Pattern updated', 'info');
            location.reload(); // Reload to show updated pattern
        } else {
            const errorMsg = data.error || MESSAGES.SERVER_ERROR;
            showAlertBanner('error', errorMsg);
            DEBUG.warn('Edit pattern failed', { error: errorMsg });
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error updating pattern', { error });
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
    });
}

function updateCopyPatternDays() {
    const cycleLength = parseInt(document.getElementById('copyCycleLength').value);
    const container = document.getElementById('copyPatternDaysContainer');
    const section = document.getElementById('copyPatternDays');
    const submitBtn = document.getElementById('copyPatternBtn');
    
    if (!cycleLength) {
        section.style.display = 'none';
        submitBtn.disabled = true;
        return;
    }
    
    section.style.display = 'block';
    submitBtn.disabled = false;
    container.innerHTML = '';
    
    const currentPattern = window.currentCopyPatternData || {};
    
    for (let i = 0; i < cycleLength; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'col-md-3 mb-3';
        
        const dayShifts = currentPattern.data && currentPattern.data[i] ? currentPattern.data[i] : ['day_off'];
        
        dayDiv.innerHTML = `
            <label for="copy_day_${i}_shift" class="form-label">${getCycleDayLabel(i)}</label>
            ${renderDayShiftSelect(`copy_day_${i}_shift`, `day_${i}_shift`, dayShifts)}
        `;
        
        container.appendChild(dayDiv);
        initializeDayShiftSelect(`copy_day_${i}_shift`, dayShifts);
    }
}

function copyPattern(patternId) {
    DEBUG.log('Loading pattern for copy', { patternId });
    
    requestJson(`/shift-pattern/${patternId}/edit-data`)
    .then(data => {
        if (data && data.id) {
            window.currentCopyPatternData = {
                id: data.id,
                name: data.name,
                description: data.description,
                cycle_length: data.cycle_length,
                data: data.pattern_data || []
            };
            
            // Populate form with source pattern data
            document.getElementById('copyName').value = `${data.name} (Copy)`;
            document.getElementById('copyDescription').value = data.description || '';
            document.getElementById('copyCycleLength').value = data.cycle_length || 1;
            
            updateCopyPatternDays();
            
            const modal = new bootstrap.Modal(document.getElementById('copyPatternModal'));
            modal.show();
            DEBUG.log('Pattern loaded for copy', 'info');
        } else {
            showAlertBanner('error', MESSAGES.LOAD_DATA_ERROR);
            DEBUG.warn('Could not load pattern data');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error loading pattern', { error });
    });
}

function saveCopyPattern(event) {
    if (event) {
        event.preventDefault();
    }

    const form = document.getElementById('copyPatternForm');
    if (!form) return;
    
    const formData = new FormData(form);
    
    // Add daily shift data
    const cycleLength = parseInt(document.getElementById('copyCycleLength').value);
    for (let i = 0; i < cycleLength; i++) {
        const select = document.getElementById(`copy_day_${i}_shift`);
        if (select) {
            getSelectedDayShiftValues(select).forEach((value) => {
                formData.append(`day_${i}_shift`, value);
            });
        }
    }
    
    const submitBtn = document.getElementById('copyPatternBtn');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = MESSAGES.SAVING;
    DEBUG.log('Submitting copy pattern form', 'info');
    
    requestJson(form.action || '/shift-pattern/add', {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        if (data.success) {
            hideModalById('copyPatternModal');
            form.reset();
            document.getElementById('copyPatternDays').style.display = 'none';
            showAlertBanner('success', data.message || MESSAGES.PATTERN_COPIED);
            DEBUG.log('Pattern copied', 'info');
            location.reload(); // Reload to show new pattern
        } else {
            const errorMsg = data.error || MESSAGES.SERVER_ERROR;
            showAlertBanner('error', errorMsg);
            DEBUG.warn('Copy pattern failed', { error: errorMsg });
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('error', MESSAGES.NETWORK_ERROR);
        DEBUG.error('Error copying pattern', { error });
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
    });
}

function viewPattern(patternId) {
    // This would fetch pattern details via AJAX in a real implementation
    document.getElementById('patternDetails').innerHTML = `
        <p class="text-muted">Pattern details would be loaded here...</p>
    `;
    
    const patternModal = new bootstrap.Modal(document.getElementById('patternModal'));
    patternModal.show();
}

function resetNewShiftTypeForm() {
    restoreShiftTimesFromBaseline();

    const form = document.getElementById('newShiftTypeForm');
    if (form) {
        form.reset();
    }

    const feedback = document.getElementById('shiftTypesFeedback');
    if (feedback) {
        feedback.classList.add('d-none');
        feedback.textContent = '';
        feedback.classList.remove(...ALERT_VARIANT_CLASSES, ...FEEDBACK_TRANSITION_CLASSES);
    }

    clearFeedbackTimer('shiftTypesFeedback');
}


/* ===== shifts.event-bindings.js ===== */
/**
 * shifts.event-bindings.js
 * UI event listeners for Shift Patterns management
 * Dependencies: shifts.core.js, shifts.form-handlers.js
 */

/**
 * Initialize all event listeners and modal handlers
 */
function initializeEventBindings() {
    if (window.__shiftsEventBindingsInitialized) {
        return;
    }
    window.__shiftsEventBindingsInitialized = true;

    initializeModalHandlers();
    initializeFormControlHandlers();
    initializePatternButtons();
    initializeTooltips();
    flushPendingMainFeedback();
}

/**
 * Setup modal lifecycle event handlers
 */
function initializeModalHandlers() {
    const addShiftTypeModalEl = document.getElementById('addShiftTypeModal');
    if (addShiftTypeModalEl) {
        addShiftTypeModalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts);
    }

    const deleteModalEl = document.getElementById('deleteModal');
    if (deleteModalEl) {
        deleteModalEl.addEventListener('hidden.bs.modal', () => {
            window.pendingPatternDelete = null;
            window.pendingShiftTypeDelete = null;
        });
    }

    const deleteFormEl = document.getElementById('deleteForm');
    if (deleteFormEl) {
        deleteFormEl.addEventListener('submit', (e) => {
            // Pattern deletions proceed via normal form submission
            // Shift type deletions are handled via button click (button type is changed to 'button')
        });
    }

    // Handle deletion button clicks (when button type is 'button' not 'submit')
    const deleteSubmitBtn = document.getElementById('globalDeleteSubmitBtn');
    if (deleteSubmitBtn) {
        deleteSubmitBtn.addEventListener('click', (e) => {
            // Handle shift type deletion
            if (deleteSubmitBtn.type === 'button' && window.pendingShiftTypeDelete) {
                e.preventDefault();
                e.stopPropagation();
                const { shiftType, shiftName } = window.pendingShiftTypeDelete;
                deleteShiftType(shiftType, shiftName);
            }
            // Handle pattern deletion
            else if (deleteSubmitBtn.type === 'button' && window.pendingPatternDelete) {
                e.preventDefault();
                e.stopPropagation();
                const { patternId, patternName } = window.pendingPatternDelete;
                deletePattern(patternId, patternName);
            }
        });
    }

    document.querySelectorAll('.modal').forEach((modalEl) => {
        modalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts);
    });
}

/**
 * Setup form control change handlers (cycle length selects, buttons)
 */
function initializeFormControlHandlers() {
    const editCycleLengthEl = document.getElementById('editCycleLength');
    if (editCycleLengthEl) {
        editCycleLengthEl.addEventListener('change', updateEditPatternDays);
    }

    const createCycleLengthEl = document.getElementById('createCycleLength');
    if (createCycleLengthEl) {
        createCycleLengthEl.addEventListener('change', updateCreatePatternDays);
    }

    const copyCycleLengthEl = document.getElementById('copyCycleLength');
    if (copyCycleLengthEl) {
        copyCycleLengthEl.addEventListener('change', updateCopyPatternDays);
    }

    // Auto-format shift name in add modal
    const addShiftNameEl = document.getElementById('add_shift_type');
    if (addShiftNameEl) {
        addShiftNameEl.addEventListener('blur', (e) => {
            e.target.value = formatShiftLabel(e.target.value);
        });
    }

    // Auto-format shift name in edit modal
    const editShiftNameEl = document.getElementById('edit_shift_type');
    if (editShiftNameEl) {
        editShiftNameEl.addEventListener('blur', (e) => {
            e.target.value = formatShiftLabel(e.target.value);
        });
    }

    // Auto-format pattern name in create modal
    const createPatternNameEl = document.getElementById('createName');
    if (createPatternNameEl) {
        createPatternNameEl.addEventListener('blur', (e) => {
            e.target.value = formatTitleCase(e.target.value);
        });
    }

    // Auto-format pattern name in edit modal
    const editPatternNameEl = document.getElementById('editName');
    if (editPatternNameEl) {
        editPatternNameEl.addEventListener('blur', (e) => {
            e.target.value = formatTitleCase(e.target.value);
        });
    }

    // Form submit button handlers
    const savePatternBtn = document.getElementById('savePatternBtn');
    if (savePatternBtn) {
        savePatternBtn.addEventListener('click', savePattern);
    }

    const submitAddShiftTypeBtn = document.getElementById('submitAddShiftTypeBtn');
    if (submitAddShiftTypeBtn) {
        submitAddShiftTypeBtn.addEventListener('click', addShiftType);
    }

    const submitEditShiftTypeBtn = document.getElementById('submitEditShiftTypeBtn');
    if (submitEditShiftTypeBtn) {
        submitEditShiftTypeBtn.addEventListener('click', submitEditShiftType);
    }

    const copyPatternBtn = document.getElementById('copyPatternBtn');
    if (copyPatternBtn) {
        copyPatternBtn.addEventListener('click', saveCopyPattern);
    }

    const createPatternBtn = document.getElementById('createPatternBtn');
    if (createPatternBtn) {
        createPatternBtn.addEventListener('click', saveCreatePattern);
    }

    const createPatternForm = document.getElementById('createPatternForm');
    if (createPatternForm) {
        createPatternForm.addEventListener('submit', saveCreatePattern);
    }

    const copyPatternForm = document.getElementById('copyPatternForm');
    if (copyPatternForm) {
        copyPatternForm.addEventListener('submit', saveCopyPattern);
    }

    const editPatternForm = document.getElementById('editPatternForm');
    if (editPatternForm) {
        editPatternForm.addEventListener('submit', savePattern);
    }

    const addShiftTypeForm = document.getElementById('addShiftTypeForm');
    if (addShiftTypeForm) {
        addShiftTypeForm.addEventListener('submit', addShiftType);
    }

    // Delete form submission - direct form post for shift types
    document.querySelectorAll('.js-delete-shift-form').forEach((form) => {
        form.addEventListener('submit', function(event) {
            // Let the form submit naturally - it will do a standard POST to the backend
            // The backend will handle the redirect to show the page reloaded
        });
    });

    // Delete pattern forms
    const deleteForm = document.getElementById('deleteForm');
    if (deleteForm) {
        deleteForm.addEventListener('submit', function(event) {
            event.preventDefault();
            DEBUG.log('Submitting delete pattern form', 'info');

            requestJson(deleteForm.action, {
                method: 'POST',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
            .then(data => {
                if (data.success) {
                    const deleteModal = bootstrap.Modal.getInstance(document.getElementById('deleteModal'));
                    if (deleteModal) {
                        deleteModal.hide();
                    }
                    showAlertBanner('success', data.message || MESSAGES.PATTERN_DELETED);
                    DEBUG.log('Pattern deleted', 'info');
                    location.reload();
                } else {
                    const errorMsg = data.error || MESSAGES.SERVER_ERROR;
                    showAlertBanner('error', errorMsg);
                    DEBUG.warn('Delete pattern failed', { error: errorMsg });
                }
            })
            .catch(error => {
                console.error('Error deleting pattern:', error);
                showAlertBanner('error', MESSAGES.NETWORK_ERROR);
                DEBUG.error('Error deleting pattern', { error });
            });
        });
    }
}

/**
 * Setup pattern action button handlers (edit, copy, delete)
 */
function initializePatternButtons() {
    // Edit shift type buttons
    document.querySelectorAll('.js-edit-shift-type').forEach((button) => {
        button.addEventListener('click', () => {
            const shiftType = button.dataset.shiftType || '';
            if (shiftType) {
                editShiftType(shiftType);
            }
        });
    });

    // Delete shift type buttons
    document.querySelectorAll('.js-delete-shift-type').forEach((button) => {
        button.addEventListener('click', () => {
            const shiftType = button.dataset.shiftType || '';
            const shiftName = button.dataset.shiftName || '';
            if (shiftType) {
                confirmDeleteShiftType(shiftType, shiftName);
            }
        });
    });

    // Edit pattern buttons
    document.querySelectorAll('.js-edit-pattern').forEach((button) => {
        button.addEventListener('click', () => {
            const patternId = parseInt(button.dataset.patternId, 10);
            if (!Number.isNaN(patternId)) {
                editPattern(patternId);
            }
        });
    });

    // Copy pattern buttons
    document.querySelectorAll('.js-copy-pattern').forEach((button) => {
        button.addEventListener('click', () => {
            const patternId = parseInt(button.dataset.patternId, 10);
            if (!Number.isNaN(patternId)) {
                copyPattern(patternId);
            }
        });
    });

    // Delete pattern buttons
    document.querySelectorAll('.js-delete-pattern').forEach((button) => {
        button.addEventListener('click', () => {
            const patternId = parseInt(button.dataset.patternId, 10);
            const patternName = button.dataset.patternName || '';
            if (!Number.isNaN(patternId)) {
                confirmDelete(patternId, patternName);
            }
        });
    });
}

/**
 * Initialize Bootstrap tooltips
 */
function initializeTooltips() {
    document.querySelectorAll('.drivers-tooltip[data-bs-toggle="tooltip"]').forEach((element) => {
        new bootstrap.Tooltip(element);
    });
}

/**
 * Initialize all event bindings on DOM ready
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEventBindings);
} else {
    initializeEventBindings();
}

