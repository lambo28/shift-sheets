/**
 * drivers.custom-timings.helpers.js
 * Helper functions for custom timings UI and form state.
 */

function updateDriverPatternTimingIndicators(driverId, timings) {
    const row = document.querySelector(`tr[data-driver-id="${driverId}"]`);
    if (!row) return;

    const patternBadges = row.querySelectorAll('[data-pattern-id]');
    if (!patternBadges.length) return;

    const assignments = driverAssignments[String(driverId)] || driverAssignments[driverId] || [];
    const assignmentToPatternId = {};
    const allPatternIds = new Set();

    assignments.forEach((assignment) => {
        const assignmentId = Number(assignment.id);
        const patternId = Number(assignment.patternId);
        if (Number.isFinite(assignmentId) && Number.isFinite(patternId)) {
            assignmentToPatternId[assignmentId] = patternId;
            allPatternIds.add(patternId);
        }
    });

    const affectedPatternIds = new Set();
    (Array.isArray(timings) ? timings : []).forEach((timing) => {
        const assignmentId = timing?.assignment_id;
        if (assignmentId === null || assignmentId === undefined || assignmentId === '') {
            allPatternIds.forEach((patternId) => affectedPatternIds.add(patternId));
            return;
        }

        const patternId = assignmentToPatternId[Number(assignmentId)];
        if (Number.isFinite(patternId)) {
            affectedPatternIds.add(patternId);
        }
    });

    patternBadges.forEach((badge) => {
        const patternId = Number(badge.getAttribute('data-pattern-id'));
        const indicator = badge.querySelector('.custom-timing-indicator');
        if (!indicator || !Number.isFinite(patternId)) return;

        if (affectedPatternIds.has(patternId)) {
            indicator.classList.remove('d-none');
        } else {
            indicator.classList.add('d-none');
        }
    });
}

function formatUkDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-GB');
}

function getRelativeStartText(startDateString) {
    if (!startDateString) return '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(startDateString);
    startDate.setHours(0, 0, 0, 0);

    const diffDays = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Starts Today';
    if (diffDays === 1) return 'Starts Tomorrow';
    if (diffDays >= 2 && diffDays <= 7) return 'Starts This Week';
    if (diffDays >= 8 && diffDays <= 14) return 'Starts Next Week';
    if (diffDays >= 15 && diffDays <= 21) return 'Starts in 2 Weeks';
    if (diffDays >= 22 && diffDays <= 28) return 'Starts in 3 Weeks';
    if (diffDays >= 29 && diffDays <= 60) return 'Starts Next Month';

    const diffMonths = Math.round(diffDays / 30);
    return `Starts in ${diffMonths} Months`;
}

function normalizePatternDayShifts(dayEntry) {
    if (!dayEntry) return [];

    if (Array.isArray(dayEntry)) {
        return dayEntry.map((value) => String(value || '').trim()).filter(Boolean);
    }

    if (typeof dayEntry === 'string') {
        if (dayEntry.includes(',')) {
            return dayEntry.split(',').map((value) => value.trim()).filter(Boolean);
        }
        return [dayEntry.trim()].filter(Boolean);
    }

    if (typeof dayEntry === 'object' && Array.isArray(dayEntry.shifts)) {
        return dayEntry.shifts.map((value) => String(value || '').trim()).filter(Boolean);
    }

    return [];
}

function getShiftDisplay(shiftType) {
    const normalizedShiftType = String(shiftType || '').trim();
    if (!normalizedShiftType || normalizedShiftType === 'day_off') {
        return {
            label: 'OFF',
            badgeColor: 'bg-secondary',
            timeRange: ''
        };
    }

    const timing = shiftTimings[normalizedShiftType];
    if (!timing) {
        return {
            label: typeof formatTitleCase === 'function'
                ? formatTitleCase(normalizedShiftType.replace(/_/g, ' '))
                : normalizedShiftType,
            badgeColor: 'bg-primary',
            timeRange: ''
        };
    }

    return {
        label: timing.label || normalizedShiftType,
        badgeColor: timing.badgeColor || 'bg-primary',
        timeRange: timing.startTime && timing.endTime ? `${timing.startTime}–${timing.endTime}` : ''
    };
}

function buildDayOfCycleOption(dayIndex, dayShifts, isSelected) {
    const shifts = dayShifts.length > 0 ? dayShifts : ['day_off'];
    const shiftBadges = shifts.map((shiftType) => {
        const display = getShiftDisplay(shiftType);
        return `<span class="badge ${display.badgeColor} me-1">${display.label}</span>`;
    }).join('');

    return `
        <li>
            <a class="dropdown-item d-flex justify-content-between align-items-center ${isSelected ? 'active' : ''}" 
               href="#" 
               data-day-value="${dayIndex}">
                <span>Day ${dayIndex + 1}</span>
                <span>${shiftBadges}</span>
            </a>
        </li>
    `;
}

function renderDayOfCycleMenu(assignmentId, selectedDayOfCycle = null) {
    const dayGroup = document.getElementById('ctFormDayOfCycleGroup');
    const dayInput = document.getElementById('ctFormDayOfCycle');
    const dayMenu = document.getElementById('ctFormDayOfCycleMenu');
    const dayDisplay = document.getElementById('ctFormDayOfCycleDisplay');
    const driverId = document.getElementById('ctFormDriverId').value;

    if (!dayGroup || !dayInput || !dayMenu || !dayDisplay) return;

    if (!assignmentId) {
        dayGroup.classList.add('d-none');
        dayMenu.innerHTML = '';
        dayInput.value = '';
        dayDisplay.innerHTML = 'Any day in cycle';
        updateAssignmentCriteriaMutualExclusion('day');
        return;
    }

    const assignments = driverAssignments[String(driverId)] || driverAssignments[driverId] || [];
    const assignment = assignments.find((item) => String(item.id) === String(assignmentId));

    if (!assignment) {
        dayGroup.classList.add('d-none');
        dayMenu.innerHTML = '';
        dayInput.value = '';
        dayDisplay.innerHTML = 'Any day in cycle';
        updateAssignmentCriteriaMutualExclusion('day');
        return;
    }

    const cycleLength = Number(assignment.cycleLength || 0);
    const patternData = Array.isArray(assignment.patternData) ? assignment.patternData : [];
    const selectedValue = selectedDayOfCycle !== null && selectedDayOfCycle !== undefined && selectedDayOfCycle !== ''
        ? String(selectedDayOfCycle)
        : '';

    let menuHtml = `
        <li>
            <a class="dropdown-item ${selectedValue === '' ? 'active' : ''}" 
               href="#" 
               data-day-value="">
                Any day in cycle
            </a>
        </li>
    `;

    for (let dayIndex = 0; dayIndex < cycleLength; dayIndex++) {
        const dayShifts = normalizePatternDayShifts(patternData[dayIndex]);
        menuHtml += buildDayOfCycleOption(dayIndex, dayShifts, selectedValue === String(dayIndex));
    }

    dayMenu.innerHTML = menuHtml;
    dayInput.value = selectedValue;

    if (selectedValue === '') {
        dayDisplay.innerHTML = 'Any day in cycle';
    } else {
        const dayIndex = parseInt(selectedValue, 10);
        const dayShifts = normalizePatternDayShifts(patternData[dayIndex]);
        const shifts = dayShifts.length > 0 ? dayShifts : ['day_off'];
        const shiftBadges = shifts.map((shiftType) => {
            const display = getShiftDisplay(shiftType);
            return `<span class="badge ${display.badgeColor} me-1">${display.label}</span>`;
        }).join('');
        dayDisplay.innerHTML = `Day ${dayIndex + 1} ${shiftBadges}`;
    }

    dayGroup.classList.remove('d-none');

    dayMenu.querySelectorAll('[data-day-value]').forEach((item) => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const value = this.getAttribute('data-day-value') || '';
            dayInput.value = value;

            dayMenu.querySelectorAll('.dropdown-item').forEach((el) => el.classList.remove('active'));
            this.classList.add('active');

            if (value === '') {
                dayDisplay.innerHTML = 'Any day in cycle';
            } else {
                const dayIndex = parseInt(value, 10);
                const dayShifts = normalizePatternDayShifts(patternData[dayIndex]);
                const shifts = dayShifts.length > 0 ? dayShifts : ['day_off'];
                const shiftBadges = shifts.map((shiftType) => {
                    const display = getShiftDisplay(shiftType);
                    return `<span class="badge ${display.badgeColor} me-1">${display.label}</span>`;
                }).join('');
                dayDisplay.innerHTML = `Day ${dayIndex + 1} ${shiftBadges}`;
            }

            updateAssignmentCriteriaMutualExclusion('day');
        });
    });

    updateAssignmentCriteriaMutualExclusion('day');
}

function populateAssignmentOptions(driverId, selectedAssignmentId = '') {
    const assignmentSelect = document.getElementById('ctFormAssignmentId');
    if (!assignmentSelect) return;

    const assignments = driverAssignments[String(driverId)] || driverAssignments[driverId] || [];
    assignmentSelect.innerHTML = '<option value="">Any assignment</option>';

    const selectedAssignment = selectedAssignmentId
        ? assignments.find((assignment) => String(assignment.id) === String(selectedAssignmentId))
        : null;

    const visibleAssignments = assignments.filter((assignment) => assignment.status !== 'ended');

    visibleAssignments.forEach((assignment) => {
        const option = document.createElement('option');
        option.value = String(assignment.id);

        const startDateFormatted = formatUkDate(assignment.startDate);
        const endDateFormatted = formatUkDate(assignment.endDate);

        let detailText = '';
        if (assignment.status === 'scheduled') {
            const relativeStart = getRelativeStartText(assignment.startDate);
            detailText = `${relativeStart} (${startDateFormatted})`;
        } else if (assignment.status === 'active') {
            if (assignment.hasEndDate && assignment.endDate) {
                const relativeEnd = typeof getRelativeEndingText === 'function'
                    ? getRelativeEndingText(assignment.endDate)
                    : `Ending ${endDateFormatted}`;
                detailText = `${relativeEnd} · Started ${startDateFormatted}`;
            } else {
                detailText = `Active · Since ${startDateFormatted}`;
            }
        } else {
            detailText = assignment.endDate
                ? `Ended ${endDateFormatted} · Started ${startDateFormatted}`
                : `Ended · Started ${startDateFormatted}`;
        }

        option.textContent = `${assignment.patternName} — ${detailText}`;
        assignmentSelect.appendChild(option);
    });

    if (selectedAssignment && selectedAssignment.status === 'ended') {
        const endedOption = document.createElement('option');
        endedOption.value = String(selectedAssignment.id);

        const startDateFormatted = formatUkDate(selectedAssignment.startDate);
        const endDateFormatted = formatUkDate(selectedAssignment.endDate);
        const endedDetailText = selectedAssignment.endDate
            ? `Ended ${endDateFormatted} · Started ${startDateFormatted}`
            : `Ended · Started ${startDateFormatted}`;

        endedOption.textContent = `${selectedAssignment.patternName} — ${endedDetailText}`;
        assignmentSelect.appendChild(endedOption);
    }

    assignmentSelect.value = selectedAssignmentId ? String(selectedAssignmentId) : '';
}

function initializeShiftTypeDropdown() {
    const shiftTypeMenu = document.getElementById('ctFormShiftTypeMenu');
    const shiftTypeInput = document.getElementById('ctFormShiftType');
    const shiftTypeDisplay = document.getElementById('ctFormShiftTypeDisplay');

    if (!shiftTypeMenu || !shiftTypeInput || !shiftTypeDisplay) return;

    let menuHtml = `
        <li>
            <a class="dropdown-item active" href="#" data-shift-value="">
                Any shift type
            </a>
        </li>
    `;

    Object.keys(shiftTimings).sort().forEach((shiftType) => {
        const timing = shiftTimings[shiftType];
        const label = timing.label || shiftType;
        const badgeColor = timing.badgeColor || 'bg-primary';

        menuHtml += `
            <li>
                <a class="dropdown-item d-flex justify-content-between align-items-center" 
                   href="#" 
                   data-shift-value="${shiftType}">
                    <span>${label}</span>
                    <span class="badge ${badgeColor}">${label}</span>
                </a>
            </li>
        `;
    });

    shiftTypeMenu.innerHTML = menuHtml;

    shiftTypeMenu.querySelectorAll('[data-shift-value]').forEach((item) => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const value = this.getAttribute('data-shift-value') || '';
            shiftTypeInput.value = value;

            shiftTypeMenu.querySelectorAll('.dropdown-item').forEach((el) => el.classList.remove('active'));
            this.classList.add('active');

            if (value === '') {
                shiftTypeDisplay.innerHTML = 'Any shift type';
            } else {
                const timing = shiftTimings[value];
                const label = timing?.label || value;
                const badgeColor = timing?.badgeColor || 'bg-primary';
                shiftTypeDisplay.innerHTML = `<span class="badge ${badgeColor}">${label}</span>`;
            }

            updateAssignmentCriteriaMutualExclusion('shift');
        });
    });
}

function initializeOverrideShiftDropdown() {
    const overrideShiftMenu = document.getElementById('ctFormOverrideShiftMenu');
    const overrideShiftInput = document.getElementById('ctFormOverrideShift');
    const overrideShiftDisplay = document.getElementById('ctFormOverrideShiftDisplay');

    if (!overrideShiftMenu || !overrideShiftInput || !overrideShiftDisplay) return;

    let menuHtml = '';

    Object.keys(shiftTimings).sort().forEach((shiftType) => {
        const timing = shiftTimings[shiftType];
        const label = timing.label || shiftType;
        const badgeColor = timing.badgeColor || 'bg-primary';

        menuHtml += `
            <li>
                <a class="dropdown-item d-flex justify-content-between align-items-center" 
                   href="#" 
                   data-shift-value="${shiftType}">
                    <span>${label}</span>
                    <span class="badge ${badgeColor}">${label}</span>
                </a>
            </li>
        `;
    });

    overrideShiftMenu.innerHTML = menuHtml;

    overrideShiftMenu.querySelectorAll('[data-shift-value]').forEach((item) => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const value = this.getAttribute('data-shift-value') || '';

            overrideShiftMenu.querySelectorAll('.dropdown-item').forEach((el) => el.classList.remove('active'));
            this.classList.add('active');

            setOverrideShiftValue(value);
        });
    });
}

function setDropdownButtonDisabled(buttonId, isDisabled) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    button.disabled = Boolean(isDisabled);
    if (isDisabled) {
        button.classList.add('disabled');
        button.setAttribute('aria-disabled', 'true');
    } else {
        button.classList.remove('disabled');
        button.removeAttribute('aria-disabled');
    }
}

function updateDayOfWeekModeVisibility() {
    const dayOfWeekValue = document.getElementById('ctFormDayOfWeek')?.value || '';
    const modeGroup = document.getElementById('ctFormDayOfWeekModeGroup');

    if (modeGroup) {
        if (dayOfWeekValue) {
            modeGroup.classList.remove('d-none');
            updateDayOfWeekModeFieldsVisibility();
        } else {
            modeGroup.classList.add('d-none');
            document.getElementById('ctFormModeOverride').checked = true;
            const modeDayOff = document.getElementById('ctFormModeDayOff');
            if (modeDayOff) modeDayOff.checked = false;
            setOverrideShiftValue('');
            updateDayOfWeekModeFieldsVisibility();
        }
    }
}

function updateDayOfWeekModeFieldsVisibility() {
    const dayOfWeekValue = document.getElementById('ctFormDayOfWeek')?.value || '';
    const modeOverride = document.getElementById('ctFormModeOverride').checked;
    const modeDayOff = document.getElementById('ctFormModeDayOff')?.checked;
    const overrideShiftGroup = document.getElementById('ctFormOverrideShiftGroup');
    const timeInputsRow = document.querySelector('.time-inputs-row');

    if (!dayOfWeekValue) {
        if (overrideShiftGroup) overrideShiftGroup.classList.add('d-none');
        if (timeInputsRow) timeInputsRow.classList.remove('d-none');
        return;
    }

    if (modeOverride) {
        if (overrideShiftGroup) overrideShiftGroup.classList.remove('d-none');
        if (timeInputsRow) timeInputsRow.classList.add('d-none');
        document.getElementById('ctFormStartTime').value = '';
        document.getElementById('ctFormEndTime').value = '';
    } else if (modeDayOff) {
        if (overrideShiftGroup) overrideShiftGroup.classList.add('d-none');
        if (timeInputsRow) timeInputsRow.classList.add('d-none');
        document.getElementById('ctFormStartTime').value = '';
        document.getElementById('ctFormEndTime').value = '';
        setOverrideShiftValue('day_off');
    } else {
        if (overrideShiftGroup) overrideShiftGroup.classList.add('d-none');
        if (timeInputsRow) timeInputsRow.classList.remove('d-none');
        setOverrideShiftValue('');
    }
}

function updateAssignmentCriteriaMutualExclusion(preferred = 'day') {
    const assignmentValue = document.getElementById('ctFormAssignmentId')?.value || '';
    const assignmentSelected = Boolean(assignmentValue);
    const shiftTypeValue = document.getElementById('ctFormShiftType')?.value || '';
    const dayOfCycleValue = document.getElementById('ctFormDayOfCycle')?.value || '';
    const dayOfWeekValue = document.getElementById('ctFormDayOfWeek')?.value || '';
    const dayOfWeekSelected = Boolean(dayOfWeekValue);
    const modeOverride = document.getElementById('ctFormModeOverride')?.checked;
    const modeDayOff = document.getElementById('ctFormModeDayOff')?.checked;

    if (!assignmentSelected) {
        setDropdownButtonDisabled('ctFormShiftTypeButton', false);
        setDropdownButtonDisabled('ctFormDayOfCycleButton', false);
        return;
    }

    if (dayOfWeekSelected && (modeOverride || modeDayOff)) {
        setDropdownButtonDisabled('ctFormDayOfCycleButton', true);
        setDropdownButtonDisabled('ctFormShiftTypeButton', false);
        document.getElementById('ctFormDayOfCycle').value = '';
        return;
    }

    if (!dayOfWeekSelected) {
        const hasShiftType = Boolean(shiftTypeValue);
        const hasCycleDay = dayOfCycleValue !== '';

        if (hasShiftType && hasCycleDay) {
            if (preferred === 'shift') {
                renderDayOfCycleMenu(assignmentValue, '');
            } else {
                setShiftTypeValue('');
            }
        }

        const currentShiftType = document.getElementById('ctFormShiftType')?.value || '';
        const currentCycleDay = document.getElementById('ctFormDayOfCycle')?.value || '';

        setDropdownButtonDisabled('ctFormDayOfCycleButton', Boolean(currentShiftType));
        setDropdownButtonDisabled('ctFormShiftTypeButton', currentCycleDay !== '');
    } else {
        setDropdownButtonDisabled('ctFormDayOfCycleButton', false);
        setDropdownButtonDisabled('ctFormShiftTypeButton', false);
    }
}

function setShiftTypeValue(shiftType) {
    const shiftTypeInput = document.getElementById('ctFormShiftType');
    const shiftTypeDisplay = document.getElementById('ctFormShiftTypeDisplay');
    const shiftTypeMenu = document.getElementById('ctFormShiftTypeMenu');

    if (!shiftTypeInput || !shiftTypeDisplay || !shiftTypeMenu) return;

    const value = shiftType || '';
    shiftTypeInput.value = value;

    shiftTypeMenu.querySelectorAll('.dropdown-item').forEach((el) => {
        const itemValue = el.getAttribute('data-shift-value') || '';
        if (itemValue === value) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    if (value === '') {
        shiftTypeDisplay.innerHTML = 'Any shift type';
    } else {
        const timing = shiftTimings[value];
        const label = timing?.label || value;
        const badgeColor = timing?.badgeColor || 'bg-primary';
        shiftTypeDisplay.innerHTML = `<span class="badge ${badgeColor}">${label}</span>`;
    }
}

function setOverrideShiftValue(shiftType) {
    const overrideShiftInput = document.getElementById('ctFormOverrideShift');
    const overrideShiftDisplay = document.getElementById('ctFormOverrideShiftDisplay');
    const overrideShiftMenu = document.getElementById('ctFormOverrideShiftMenu');

    if (!overrideShiftInput || !overrideShiftDisplay || !overrideShiftMenu) return;

    const value = shiftType || '';
    overrideShiftInput.value = value;

    overrideShiftMenu.querySelectorAll('.dropdown-item').forEach((el) => {
        const itemValue = el.getAttribute('data-shift-value') || '';
        if (itemValue === value) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    if (value === '') {
        overrideShiftDisplay.innerHTML = 'Select shift';
    } else {
        const timing = shiftTimings[value];
        const label = timing?.label || value;
        const badgeColor = timing?.badgeColor || 'bg-primary';
        overrideShiftDisplay.innerHTML = `<span class="badge ${badgeColor}">${label}</span>`;
    }
}

function openCustomTimingForm(driverId, driverName, driverNumber = '') {
    document.getElementById('ctFormDriverId').value = driverId;
    document.getElementById('ctFormTimingId').value = '';
    document.getElementById('customTimingForm').reset();
    document.getElementById('ctFormPriority').value = '4';
    document.getElementById('ctFormModeOverride').checked = true;
    const modeDayOff = document.getElementById('ctFormModeDayOff');
    if (modeDayOff) modeDayOff.checked = false;
    populateAssignmentOptions(driverId);
    initializeShiftTypeDropdown();
    initializeOverrideShiftDropdown();
    setShiftTypeValue('');
    setOverrideShiftValue('');
    renderDayOfCycleMenu('', null);
    updateDayOfWeekModeVisibility();
    updateAssignmentCriteriaMutualExclusion('day');
    const displayDriver = driverNumber ? `#${driverNumber} ${driverName}` : driverName;
    document.getElementById('customTimingFormTitle').textContent = `Add Custom Timing - ${displayDriver}`;
    new bootstrap.Modal(document.getElementById('customTimingFormModal')).show();
}

function editCustomTiming(driverId, timingId, driverName, driverNumber = '') {
    fetch(`/custom-timing/${timingId}/get`, {
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            if (data.success) {
                const t = data.timing;
                document.getElementById('ctFormDriverId').value = driverId;
                document.getElementById('ctFormTimingId').value = timingId;
                populateAssignmentOptions(driverId, t.assignment_id);
                initializeShiftTypeDropdown();
                initializeOverrideShiftDropdown();
                setShiftTypeValue(t.shift_type || '');
                renderDayOfCycleMenu(t.assignment_id || '', t.day_of_cycle !== null ? t.day_of_cycle : '');
                updateAssignmentCriteriaMutualExclusion('day');
                document.getElementById('ctFormDayOfWeek').value = t.day_of_week !== null ? t.day_of_week : '';
                const isOverrideMode = t.day_of_week !== null && Boolean(t.override_shift);
                const isDayOffMode = t.day_of_week !== null && t.override_shift === 'day_off';
                document.getElementById('ctFormModeOverride').checked = isOverrideMode && !isDayOffMode;
                document.getElementById('ctFormModeCustomTimes').checked = !isOverrideMode;
                const modeDayOffEl = document.getElementById('ctFormModeDayOff');
                if (modeDayOffEl) modeDayOffEl.checked = isDayOffMode;
                setOverrideShiftValue(t.override_shift || '');
                updateDayOfWeekModeVisibility();
                updateDayOfWeekModeFieldsVisibility();
                document.getElementById('ctFormStartTime').value = t.start_time || '';
                document.getElementById('ctFormEndTime').value = t.end_time || '';
                {
                    let priorityValue = Number(t.priority ?? 4);
                    if (!Number.isFinite(priorityValue) || priorityValue < 1) priorityValue = 4;
                    if (priorityValue > 7) priorityValue = 7;
                    document.getElementById('ctFormPriority').value = String(priorityValue);
                }
                document.getElementById('ctFormNotes').value = t.notes || '';
                const displayDriver = driverNumber ? `#${driverNumber} ${driverName}` : driverName;
                document.getElementById('customTimingFormTitle').textContent = `Edit Custom Timing - ${displayDriver}`;
                new bootstrap.Modal(document.getElementById('customTimingFormModal')).show();
            }
        })
        .catch(err => console.error('Error loading timing:', err));
}

function deleteCustomTiming(timingId, callback) {
    fetch(`/custom-timing/${timingId}/delete`, {
        method: 'POST',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            if (data.success && callback) callback();
            if (data.success) {
                showAlertBanner('success', MESSAGES.CUSTOM_TIMING_DELETED);
                DEBUG.log('Custom timing deleted', 'info');
            } else {
                const errorMsg = data.error || MESSAGES.CUSTOM_TIMING_DELETE_ERROR;
                showAlertBanner('error', errorMsg);
                DEBUG.warn('Delete custom timing failed', { error: errorMsg });
            }
        })
        .catch(err => {
            console.error('Error deleting timing:', err);
            showAlertBanner('error', MESSAGES.CUSTOM_TIMING_DELETE_ERROR);
            DEBUG.error('Error deleting custom timing', { error: err.message });
        });
}
