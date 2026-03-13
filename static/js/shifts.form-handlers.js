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
            document.getElementById('edit_shift_school_term_only').checked = !!data.school_term_only;
            
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
