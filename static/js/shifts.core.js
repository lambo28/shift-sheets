function getCurrentShiftTypes() {
    const form = document.getElementById('shiftTypesForm');
    if (!form) return ['earlies', 'days', 'lates', 'nights'];

    const types = [];
    form.querySelectorAll('input[name$="_start"]').forEach((input) => {
        types.push(input.name.replace(/_start$/, ''));
    });

    return types.length ? types : ['earlies', 'days', 'lates', 'nights'];
}

function buildShiftTypeOptions(selectedValue = '') {
    const shiftTypes = getCurrentShiftTypes();
    return shiftTypes.map((type) => {
        const selected = selectedValue === type ? 'selected' : '';
        const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `<option value="${type}" ${selected}>${label}</option>`;
    }).join('');
}

function getShiftIconClass(shiftType) {
    if (shiftType === 'earlies') return 'fa-sun text-warning';
    if (shiftType === 'days') return 'fa-sun text-success';
    if (shiftType === 'lates') return 'fa-moon text-info';
    if (shiftType === 'nights') return 'fa-moon text-dark';
    return 'fa-clock text-primary';
}

function toTitleCase(value) {
    return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function syncCurrentShiftsCard(shiftType, startTime, endTime) {
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
    const iconClass = getShiftIconClass(shiftType);
    const label = toTitleCase(shiftType);
    card.innerHTML = `
        <div class="text-center p-3 border rounded">
            <i class="fas ${iconClass} fa-2x mb-2"></i>
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
        feedback.textContent = '';
        feedback.classList.remove(...ALERT_VARIANT_CLASSES, ...FEEDBACK_TRANSITION_CLASSES);
        return;
    }

    feedback.classList.remove('d-none', ...ALERT_VARIANT_CLASSES, ...FEEDBACK_TRANSITION_CLASSES);
    feedback.classList.add(`alert-${type}`, 'fade', 'show');
    feedback.textContent = message;

    const timerGroup = {};
    timerGroup.hide = setTimeout(() => {
        feedback.classList.remove('show');
        timerGroup.cleanup = setTimeout(() => {
            feedback.classList.add('d-none');
            feedback.classList.remove('fade');
            feedback.textContent = '';
            delete feedbackTimers[timerKey];
        }, 300);
    }, 10000);
    feedbackTimers[timerKey] = timerGroup;
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

