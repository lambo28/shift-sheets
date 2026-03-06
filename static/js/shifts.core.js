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

