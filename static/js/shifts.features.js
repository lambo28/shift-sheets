// Create pattern management
function hideModalById(modalId) {
    const modal = bootstrap.Modal.getInstance(document.getElementById(modalId));
    if (modal) {
        modal.hide();
    }
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

    const input = document.querySelector(`#shiftTypesForm select[name="${shiftType}_parent"]`);
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
            <label for="create_day_${i}_shift" class="form-label">${dayNames[i]}</label>
            ${renderDayShiftSelect(`create_day_${i}_shift`, `day_${i}_shift`, ['day_off'])}
        `;
        
        container.appendChild(dayDiv);
        initializeDayShiftSelect(`create_day_${i}_shift`, ['day_off']);
    }
    
    attachFormattedInputListener('createName', toTitleCaseWords);
    attachFormattedInputListener('createDescription', toSentenceCase);
}

function saveCreatePattern() {
    const form = document.getElementById('createPatternForm');
    const formData = new FormData(form);
    
    // Add daily shift data
    const cycleLength = parseInt(document.getElementById('createCycleLength').value);
    for (let i = 0; i < cycleLength; i++) {
        const select = document.getElementById(`create_day_${i}_shift`);
        if (select) {
            getSelectedDayShiftValues(select).forEach((value) => {
                formData.append(`day_${i}_shift`, value);
            });
        }
    }
    
    requestJson('/shift-pattern/add', {
        method: 'POST',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
    })
    .then(data => {
        if (data.success) {
            hideModalById('createPatternModal');
            setPendingMainFeedback('success', 'Shift pattern added successfully.');
            location.reload(); // Refresh page to show updated data
        } else {
            showMainPageFeedback('danger', 'Error creating pattern: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error creating pattern:', error);
        showMainPageFeedback('danger', 'Error creating pattern.');
    });
}

// Shift types management
function addShiftType() {
    const form = document.getElementById('newShiftTypeForm');
    const formData = new FormData(form);

    const rawName = (formData.get('shift_type') || '').toString().trim();
    const shiftType = rawName.toLowerCase().replace(/\s+/g, '_');
    const startTime = formData.get('start_time');
    const endTime = formData.get('end_time');

    if (!shiftType || !startTime || !endTime) {
        showShiftTypesFeedback('danger', 'Please fill in all new shift type fields.');
        return;
    }

    if (!/^[a-z0-9_]+$/.test(shiftType)) {
        showShiftTypesFeedback('danger', 'Shift type name can only contain letters, numbers, and underscores.');
        return;
    }

    formData.set('shift_type', shiftType);
    formData.set('display_name', rawName);

    requestJson('/shift-types/add', {
        method: 'POST',
        body: formData
    })
    .then(data => {
        if (!data.success) {
            showShiftTypesFeedback('danger', 'Error adding shift type: ' + (data.error || 'Unknown error'));
            return;
        }

        const badgeColor = formData.get('badge_color') || 'bg-primary';
        const icon = formData.get('icon') || 'fas fa-clock';
        const parentShift = formData.get('parent_shift_type') || '_none';
        const iconColor = getBadgeTextColor(badgeColor);
        
        const existingCard = document.getElementById(`shift-card-${shiftType}`);
        if (!existingCard) {
            const grid = document.getElementById('shiftTypesGrid');
            const card = document.createElement('div');
            card.className = 'col-md-6 col-lg-4 mb-4';
            card.id = `shift-card-${shiftType}`;
            const label = rawName;
            
            // Build parent options
            const allShiftCards = grid.querySelectorAll('[id^="shift-card-"]');
            let parentOptions = '<option value="_none">Main Shift (Standalone)</option>';
            allShiftCards.forEach(c => {
                const cardShiftType = c.id.replace('shift-card-', '');
                if (cardShiftType !== shiftType) {
                    const selected = parentShift === cardShiftType ? 'selected' : '';
                    parentOptions += `<option value="${cardShiftType}" ${selected}>${toTitleCase(cardShiftType)}</option>`;
                }
            });

            card.innerHTML = `
                <div class="border rounded p-3 h-100">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h6 class="mb-0">
                            <i class="${icon} ${iconColor}"></i>
                            ${label}
                        </h6>
                        <button type="button" class="btn btn-sm btn-outline-danger js-delete-shift-type" data-shift-type="${shiftType}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    <div class="row">
                        <div class="col-12 mb-2">
                            <label for="${shiftType}_name" class="form-label">Name</label>
                            <input type="text" class="form-control" id="${shiftType}_name" name="${shiftType}_name" value="${label}" required>
                        </div>
                        <div class="col-6">
                            <label for="${shiftType}_start" class="form-label">Start</label>
                            <input type="time" class="form-control" id="${shiftType}_start" name="${shiftType}_start" value="${startTime}" required>
                        </div>
                        <div class="col-6">
                            <label for="${shiftType}_end" class="form-label">End</label>
                            <input type="time" class="form-control" id="${shiftType}_end" name="${shiftType}_end" value="${endTime}" required>
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-6">
                            <label for="${shiftType}_color" class="form-label">Badge Color</label>
                            <select class="form-select form-select-sm" id="${shiftType}_color" name="${shiftType}_color">
                                <option value="bg-primary" ${badgeColor === 'bg-primary' ? 'selected' : ''}>Blue</option>
                                <option value="bg-success" ${badgeColor === 'bg-success' ? 'selected' : ''}>Green</option>
                                <option value="bg-danger" ${badgeColor === 'bg-danger' ? 'selected' : ''}>Red</option>
                                <option value="bg-warning" ${badgeColor === 'bg-warning' ? 'selected' : ''}>Yellow</option>
                                <option value="bg-info" ${badgeColor === 'bg-info' ? 'selected' : ''}>Cyan</option>
                                <option value="bg-secondary" ${badgeColor === 'bg-secondary' ? 'selected' : ''}>Gray</option>
                                <option value="bg-dark" ${badgeColor === 'bg-dark' ? 'selected' : ''}>Dark</option>
                            </select>
                        </div>
                        <div class="col-6">
                            <label for="${shiftType}_icon" class="form-label">Icon</label>
                            <select class="form-select form-select-sm" id="${shiftType}_icon" name="${shiftType}_icon">
                                <option value="fas fa-sun" ${icon === 'fas fa-sun' ? 'selected' : ''}>☀️ Sun</option>
                                <option value="fas fa-moon" ${icon === 'fas fa-moon' ? 'selected' : ''}>🌙 Moon</option>
                                <option value="fas fa-clock" ${icon === 'fas fa-clock' ? 'selected' : ''}>🕐 Clock</option>
                                <option value="fas fa-briefcase" ${icon === 'fas fa-briefcase' ? 'selected' : ''}>💼 Briefcase</option>
                                <option value="fas fa-star" ${icon === 'fas fa-star' ? 'selected' : ''}>⭐ Star</option>
                                <option value="fas fa-heart" ${icon === 'fas fa-heart' ? 'selected' : ''}>❤️ Heart</option>
                                <option value="fas fa-bolt" ${icon === 'fas fa-bolt' ? 'selected' : ''}>⚡ Lightning</option>
                                <option value="fas fa-fire" ${icon === 'fas fa-fire' ? 'selected' : ''}>🔥 Fire</option>
                                <option value="fas fa-tree" ${icon === 'fas fa-tree' ? 'selected' : ''}>🌳 Tree</option>
                            </select>
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12">
                            <label for="${shiftType}_parent" class="form-label">Group Under (Optional)</label>
                            <select class="form-select form-select-sm" id="${shiftType}_parent" name="${shiftType}_parent">
                                ${parentOptions}
                            </select>
                            <small class="text-muted">Sub-shifts are grouped under their parent on daily sheets</small>
                        </div>
                    </div>
                </div>
            `;

            grid.appendChild(card);
            
            // Update the new shift form's parent dropdown to include this new shift
            const newShiftParentSelect = document.getElementById('new_shift_parent');
            if (newShiftParentSelect) {
                const newOption = document.createElement('option');
                newOption.value = shiftType;
                newOption.textContent = label;
                newShiftParentSelect.appendChild(newOption);
            }
        }

        syncCurrentShiftsCard(shiftType, startTime, endTime, icon, badgeColor);
        captureShiftTimesBaseline();

        form.reset();
        showShiftTypesFeedback('success', 'Shift type added successfully.');
    })
    .catch(error => {
        console.error('Error adding shift type:', error);
        showShiftTypesFeedback('danger', 'Error adding shift type.');
    });
}

function deleteShiftType(shiftType) {
    window.pendingShiftTypeDelete = shiftType;
    showShiftTypeDeleteFeedback('danger', '');

    window.showGlobalDeleteConfirm({
        title: 'Confirm Deletion',
        message: 'Are you sure you want to delete the shift type',
        name: toTitleCase(shiftType),
        warning: 'This cannot be undone.',
        action: `/shift-types/delete/${shiftType}`,
        submitLabel: 'Delete Shift Type'
    });
}

function confirmDeleteShiftType() {
    const shiftType = window.pendingShiftTypeDelete;
    if (!shiftType) {
        showShiftTypeDeleteFeedback('danger', 'No shift type selected for deletion.');
        return;
    }

    requestJson(`/shift-types/delete/${shiftType}`, {
        method: 'POST'
    })
    .then(data => {
        if (!data.success) {
            showShiftTypeDeleteFeedback('danger', 'Error deleting shift type: ' + (data.error || 'Unknown error'));
            return;
        }

        const globalDeleteModal = bootstrap.Modal.getInstance(document.getElementById('deleteModal'));
        if (globalDeleteModal) {
            globalDeleteModal.hide();
        }

        const card = document.getElementById(`shift-card-${shiftType}`);
        if (card) {
            card.remove();
        }

        removeCurrentShiftsCard(shiftType);
        captureShiftTimesBaseline();
        window.pendingShiftTypeDelete = null;
        showShiftTypesFeedback('success', 'Shift type deleted successfully.');
    })
    .catch(error => {
        console.error('Error deleting shift type:', error);
        showShiftTypeDeleteFeedback('danger', 'Error deleting shift type.');
    });
}

function showShiftTypeDeleteFeedback(type, message) {
    showTimedFeedback('deletePatternFeedback', 'deletePatternFeedback', type, message);
}

function showDeletePatternFeedback(type, message) {
    showTimedFeedback('deletePatternFeedback', 'deletePatternFeedback', type, message);
}

function saveShiftTypes() {
    const form = document.getElementById('shiftTypesForm');
    const formData = new FormData(form);
    
    requestJson('/shift-types/update', {
        method: 'POST',
        body: formData
    })
    .then(data => {
        if (data.success) {
            captureShiftTimesBaseline();
            setPendingMainFeedback('success', 'Shift types saved successfully.');
            location.reload();
        } else {
            showShiftTypesFeedback('danger', 'Error saving shift types: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error saving shift types:', error);
        showShiftTypesFeedback('danger', 'Error saving shift types.');
    });
}

const dayNames = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7',
                  'Day 8', 'Day 9', 'Day 10', 'Day 11', 'Day 12', 'Day 13', 'Day 14',
                  'Day 15', 'Day 16', 'Day 17', 'Day 18', 'Day 19', 'Day 20', 'Day 21',
                  'Day 22', 'Day 23', 'Day 24', 'Day 25', 'Day 26', 'Day 27', 'Day 28',
                  'Day 29', 'Day 30', 'Day 31', 'Day 32'];

function confirmDelete(patternId, patternName) {
    showDeletePatternFeedback('danger', '');
    window.showGlobalDeleteConfirm({
        title: 'Confirm Deletion',
        message: 'Are you sure you want to delete the shift pattern',
        name: patternName,
        warning: 'This will also remove ended driver assignments using this pattern.',
        action: `/shift-pattern/${patternId}/delete`,
        submitLabel: 'Delete Pattern'
    });
}

function editPattern(patternId) {
    // Fetch pattern data and populate edit form
    fetch(`/shift-pattern/${patternId}/edit-data`)
        .then(response => response.json())
        .then(data => {
            document.getElementById('editPatternId').value = data.id;
            document.getElementById('editName').value = data.name;
            document.getElementById('editDescription').value = data.description || '';
            document.getElementById('editCycleLength').value = data.cycle_length;
            
            // Store pattern data for use in updateEditPatternDays
            window.currentEditPatternData = data.pattern_data;
            updateEditPatternDays();
            
            const editModal = new bootstrap.Modal(document.getElementById('editPatternModal'));
            editModal.show();
        })
        .catch(error => {
            console.error('Error fetching pattern data:', error);
            showMainPageFeedback('danger', 'Error loading pattern data.');
        });
}

function updateEditPatternDays() {
    const cycleLength = parseInt(document.getElementById('editCycleLength').value);
    const container = document.getElementById('editPatternDaysContainer');
    
    container.innerHTML = '';
    
    for (let i = 0; i < cycleLength; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'col-md-3 mb-3';
        
        // Get existing value if available
        const currentValue = (window.currentEditPatternData && window.currentEditPatternData[i]) ? window.currentEditPatternData[i] : ['day_off'];
        
        dayDiv.innerHTML = `
            <label for="edit_day_${i}_shift" class="form-label">${dayNames[i]}</label>
            ${renderDayShiftSelect(`edit_day_${i}_shift`, `day_${i}_shift`, currentValue)}
        `;
        
        container.appendChild(dayDiv);
        initializeDayShiftSelect(`edit_day_${i}_shift`, currentValue);
    }
    
    attachFormattedInputListener('editName', toTitleCaseWords);
    attachFormattedInputListener('editDescription', toSentenceCase);
}

function savePattern() {
    const form = document.getElementById('editPatternForm');
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
    
    const patternId = document.getElementById('editPatternId').value;
    
    requestJson(`/shift-pattern/${patternId}/edit`, {
        method: 'POST',
        body: formData
    })
    .then(data => {
        if (data.success) {
            hideModalById('editPatternModal');
            setPendingMainFeedback('success', 'Shift pattern updated successfully.');
            location.reload(); // Refresh page to show updated data
        } else {
            showMainPageFeedback('danger', 'Error saving pattern: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error saving pattern:', error);
        showMainPageFeedback('danger', 'Error saving pattern.');
    });
}

function updateCopyPatternDays() {
    const select = document.getElementById('copyCycleLength');
    const container = document.getElementById('copyPatternDaysContainer');
    const daysSection = document.getElementById('copyPatternDays');
    
    if (select.value && parseInt(select.value) > 0) {
        const days = parseInt(select.value);
        daysSection.style.display = 'block';
        container.innerHTML = '';
        
        for (let i = 0; i < days; i++) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'col-md-3 mb-3';
            const currentValue = (window.currentCopyPatternData && window.currentCopyPatternData[i]) ? window.currentCopyPatternData[i] : ['day_off'];
            dayDiv.innerHTML = `
                <label for="copyDay${i}" class="form-label">${dayNames[i]}</label>
                ${renderDayShiftSelect(`copyDay${i}`, `day_${i}_shift`, currentValue)}
            `;
            container.appendChild(dayDiv);
            initializeDayShiftSelect(`copyDay${i}`, currentValue);
        }
    } else {
        daysSection.style.display = 'none';
    }
}

function copyPattern(patternId) {
    // Fetch pattern data
    fetch(`/shift-pattern/${patternId}/edit-data`)
        .then(async response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (!data || !Array.isArray(data.pattern_data)) {
                showMainPageFeedback('danger', 'Error loading pattern data: invalid response.');
                return;
            }
            
            try {
                // Pre-fill form with pattern data
                document.getElementById('copyName').value = `${data.name} (Copy)`;
                document.getElementById('copyDescription').value = data.description || '';
                document.getElementById('copyCycleLength').value = data.cycle_length;
                
                // Store pattern data for setting day values
                window.currentCopyPatternData = data.pattern_data;
                updateCopyPatternDays();
                
                // Show modal
                new bootstrap.Modal(document.getElementById('copyPatternModal')).show();
            } catch (uiError) {
                console.error('UI error while preparing copy modal:', uiError);
                showMainPageFeedback('danger', 'Error loading pattern data: failed to prepare copy form.');
            }
        })
        .catch(error => {
            console.error('Error fetching pattern:', error);
            showMainPageFeedback('danger', 'Error loading pattern data: request failed.');
        });
}

function saveCopyPattern() {
    const form = document.getElementById('copyPatternForm');
    const formData = new FormData(form);
    
    if (!formData.get('name') || !formData.get('cycle_length')) {
        showMainPageFeedback('danger', 'Please fill in all required fields.');
        return;
    }
    
    // Add daily shift data
    const cycleLength = parseInt(formData.get('cycle_length'));
    for (let i = 0; i < cycleLength; i++) {
        const select = document.getElementById(`copyDay${i}`);
        if (select) {
            getSelectedDayShiftValues(select).forEach((value) => {
                formData.append(`day_${i}_shift`, value);
            });
        }
    }
    
    document.getElementById('copyPatternBtn').disabled = true;
    document.getElementById('copyPatternBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    
    requestJson('/shift-pattern/add', {
        method: 'POST',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
    })
    .then(data => {
        if (data.success) {
            hideModalById('copyPatternModal');
            form.reset();
            document.getElementById('copyPatternDays').style.display = 'none';
            setPendingMainFeedback('success', 'Shift pattern copied successfully.');
            location.reload(); // Reload to show new pattern
        } else {
            showMainPageFeedback('danger', 'Error creating pattern copy: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showMainPageFeedback('danger', 'Error creating pattern copy.');
    })
    .finally(() => {
        document.getElementById('copyPatternBtn').disabled = false;
        document.getElementById('copyPatternBtn').innerHTML = 'Create Copy';
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

