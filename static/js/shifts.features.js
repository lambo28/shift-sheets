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
    return value.toLowerCase().replace(/\b\w/g, function(char) {
        return char.toUpperCase();
    });
}

function toSentenceCase(value) {
    return value.toLowerCase().replace(/(^|\. )(\w)/g, function(match, p1, p2) {
        return p1 + p2.toUpperCase();
    });
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
    
    section.style.display = 'block';
    submitBtn.disabled = false;
    container.innerHTML = '';
    
    for (let i = 0; i < cycleLength; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'col-md-3 mb-3';
        
        dayDiv.innerHTML = `
            <label for="create_day_${i}_shift" class="form-label">${dayNames[i]}</label>
            <select class="form-select" id="create_day_${i}_shift" name="day_${i}_shift" required>
                <option value="day_off">Day Off</option>
                ${buildShiftTypeOptions()}
            </select>
        `;
        
        container.appendChild(dayDiv);
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
            formData.append(`day_${i}_shift`, select.value);
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

    const rawName = (formData.get('shift_type') || '').toString().trim().toLowerCase();
    const shiftType = rawName.replace(/\s+/g, '_');
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

    requestJson('/shift-types/add', {
        method: 'POST',
        body: formData
    })
    .then(data => {
        if (!data.success) {
            showShiftTypesFeedback('danger', 'Error adding shift type: ' + (data.error || 'Unknown error'));
            return;
        }

        const existingCard = document.getElementById(`shift-card-${shiftType}`);
        if (!existingCard) {
            const grid = document.getElementById('shiftTypesGrid');
            const card = document.createElement('div');
            card.className = 'col-md-6 col-lg-4 mb-4';
            card.id = `shift-card-${shiftType}`;
            const label = toTitleCase(shiftType);

            card.innerHTML = `
                <div class="border rounded p-3 h-100">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h6 class="mb-0">${label}</h6>
                        <button type="button" class="btn btn-sm btn-outline-danger js-delete-shift-type" data-shift-type="${shiftType}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    <div class="row">
                        <div class="col-6">
                            <label for="${shiftType}_start" class="form-label">Start</label>
                            <input type="time" class="form-control" id="${shiftType}_start" name="${shiftType}_start" value="${startTime}" required>
                        </div>
                        <div class="col-6">
                            <label for="${shiftType}_end" class="form-label">End</label>
                            <input type="time" class="form-control" id="${shiftType}_end" name="${shiftType}_end" value="${endTime}" required>
                        </div>
                    </div>
                </div>
            `;

            grid.appendChild(card);
        }

        syncCurrentShiftsCard(shiftType, startTime, endTime);
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
    const shiftTypeName = document.getElementById('shiftTypeName');
    if (shiftTypeName) {
        shiftTypeName.textContent = toTitleCase(shiftType);
    }
    showShiftTypeDeleteFeedback('danger', '');
    const shiftTypeDeleteModalEl = document.getElementById('shiftTypeDeleteModal');
    if (shiftTypeDeleteModalEl) {
        shiftTypeDeleteModalEl.style.zIndex = '2000';
    }

    const modal = new bootstrap.Modal(shiftTypeDeleteModalEl);
    modal.show();

    setTimeout(() => {
        const backdrops = document.querySelectorAll('.modal-backdrop.show');
        if (backdrops.length > 0) {
            const topBackdrop = backdrops[backdrops.length - 1];
            topBackdrop.style.zIndex = '1990';
        }
    }, 0);
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

        hideModalById('shiftTypeDeleteModal');

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
    showTimedFeedback('shiftTypeDeleteFeedback', 'shiftTypeDeleteFeedback', type, message);
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
            const startInputs = form.querySelectorAll('input[name$="_start"]');
            startInputs.forEach((startInput) => {
                const shiftType = startInput.name.replace(/_start$/, '');
                const endInput = form.querySelector(`input[name="${shiftType}_end"]`);
                if (endInput) {
                    syncCurrentShiftsCard(shiftType, startInput.value, endInput.value);
                }
            });
            captureShiftTimesBaseline();

            hideModalById('shiftTypesModal');

            showMainPageFeedback('success', 'Shift times saved successfully.');
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
    document.getElementById('patternName').textContent = patternName;
    document.getElementById('deleteForm').action = `/shift-pattern/${patternId}/delete`;
    showDeletePatternFeedback('danger', '');
    
    const deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));
    deleteModal.show();
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
        const currentValue = (window.currentEditPatternData && window.currentEditPatternData[i]) ? window.currentEditPatternData[i] : 'day_off';
        
        dayDiv.innerHTML = `
            <label for="edit_day_${i}_shift" class="form-label">${dayNames[i]}</label>
            <select class="form-select" id="edit_day_${i}_shift" name="day_${i}_shift" required>
                <option value="day_off" ${currentValue === 'day_off' ? 'selected' : ''}>Day Off</option>
                ${buildShiftTypeOptions(currentValue)}
            </select>
        `;
        
        container.appendChild(dayDiv);
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
            formData.append(`day_${i}_shift`, select.value);
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
            dayDiv.innerHTML = `
                <label for="copyDay${i}" class="form-label">${dayNames[i]}</label>
                <select class="form-select" id="copyDay${i}" name="day_${i}_shift">
                    <option value="day_off">Day Off</option>
                    ${buildShiftTypeOptions()}
                </select>
            `;
            container.appendChild(dayDiv);
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
                
                // Wait for DOM update then set day values
                setTimeout(() => {
                    if (window.currentCopyPatternData) {
                        for (let i = 0; i < data.cycle_length; i++) {
                            const select = document.getElementById(`copyDay${i}`);
                            if (select && window.currentCopyPatternData[i]) {
                                select.value = window.currentCopyPatternData[i];
                            }
                        }
                    }
                }, 100);
                
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
            formData.append(`day_${i}_shift`, select.value);
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

