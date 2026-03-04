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

function showTimedFeedback(elementId, timerKey, type, message) {
    const feedback = document.getElementById(elementId);
    if (!feedback) return;

    clearFeedbackTimer(timerKey);

    if (!message) {
        feedback.classList.add('d-none');
        feedback.innerHTML = '';
        feedback.classList.remove(...ALERT_VARIANT_CLASSES, ...FEEDBACK_TRANSITION_CLASSES);
        feedback.classList.remove('alert-dismissible');
        return;
    }

    feedback.classList.remove('d-none', ...ALERT_VARIANT_CLASSES, ...FEEDBACK_TRANSITION_CLASSES);
    feedback.classList.add(`alert-${type}`, 'fade', 'show', 'alert-dismissible');
    feedback.innerHTML = `${message}<button type="button" class="btn-close" aria-label="Close"></button>`;

    const closeButton = feedback.querySelector('.btn-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            feedback.classList.remove('show');
            setTimeout(() => {
                feedback.classList.add('d-none');
                feedback.classList.remove('fade', 'alert-dismissible', ...ALERT_VARIANT_CLASSES);
                feedback.innerHTML = '';
            }, 300);
        });
    }
}

function showShiftTypesFeedback(type, message) {
    showTimedFeedback('shiftTypesFeedback', 'shiftTypesFeedback', type, message);
}

function showMainPageFeedback(type, message) {
    showTimedFeedback('mainPageFeedback', 'mainPageFeedback', type, message);
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
            showMainPageFeedback(payload.type, payload.message);
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

