/**
 * shifts.form-handlers.js
 * Form submission handlers for Shift Patterns management
 * Dependencies: shifts.core.js
 */

// Pattern day names - used by all pattern form handlers
const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
            <label for="create_day_${i}_shift" class="form-label">${dayNames[i]}</label>
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
    
    const submitBtn = document.getElementById('createPatternBtn');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    
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
            setPendingMainFeedback('success', 'Shift pattern created successfully.');
            location.reload(); // Reload to show new pattern
        } else {
            showAlertBanner('danger', 'Error creating pattern: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('danger', 'Error creating pattern.');
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
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
    
    requestJson(form.action || '/shift-types/add', {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        if (data.success) {
            hideModalById('addShiftTypeModal');
            form.reset();
            setPendingMainFeedback('success', 'Shift type added successfully.');
            location.reload();
        } else {
            showAlertBanner('danger', 'Error adding shift type: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('danger', 'Error adding shift type.');
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
            showAlertBanner('danger', 'Could not load shift type data.');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('danger', 'Error loading shift type data.');
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
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    
    requestJson(`/shift-types/${originalShiftType}/edit`, {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        if (data.success) {
            hideModalById('editShiftTypeModal');
            form.reset();
            setPendingMainFeedback('success', 'Shift type updated successfully.');
            location.reload();
        } else {
            showAlertBanner('danger', 'Error updating shift type: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('danger', 'Error updating shift type.');
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
    
    requestJson(`/shift-types/delete/${shiftType}`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        // Clear pending deletion
        window.pendingShiftTypeDelete = null;
        
        if (data.success) {
            setPendingMainFeedback('success', 'Shift type deleted successfully.');
            location.reload();
        } else {
            // Show error message
            showAlertBanner('danger', data.error || 'Error deleting shift type');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        // Clear pending deletion
        window.pendingShiftTypeDelete = null;
        showAlertBanner('danger', 'Error deleting shift type.');
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
    
    requestJson(`/shift-pattern/${patternId}/delete`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(data => {
        // Clear pending deletion
        window.pendingPatternDelete = null;
        
        if (data.success) {
            setPendingMainFeedback('success', 'Shift pattern deleted successfully.');
            location.reload();
        } else {
            // Show error message
            showAlertBanner('danger', data.error || 'Error deleting pattern');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        // Clear pending deletion
        window.pendingPatternDelete = null;
        showAlertBanner('danger', 'Error deleting pattern.');
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
        } else {
            showAlertBanner('danger', 'Could not load pattern data.');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('danger', 'Error loading pattern.');
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
            <label for="edit_day_${i}_shift" class="form-label">${dayNames[i]}</label>
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
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    const patternId = document.getElementById('editPatternId')?.value;
    const actionUrl = form.action || (patternId ? `/shift-pattern/${patternId}/edit` : '');
    if (!actionUrl) {
        showAlertBanner('danger', 'Could not determine edit endpoint.');
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
            setPendingMainFeedback('success', 'Shift pattern updated successfully.');
            location.reload(); // Reload to show updated pattern
        } else {
            showAlertBanner('danger', 'Error updating pattern: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('danger', 'Error updating pattern.');
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
            <label for="copy_day_${i}_shift" class="form-label">${dayNames[i]}</label>
            ${renderDayShiftSelect(`copy_day_${i}_shift`, `day_${i}_shift`, dayShifts)}
        `;
        
        container.appendChild(dayDiv);
        initializeDayShiftSelect(`copy_day_${i}_shift`, dayShifts);
    }
}

function copyPattern(patternId) {
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
        } else {
            showAlertBanner('danger', 'Could not load pattern data.');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('danger', 'Error loading pattern.');
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
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    
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
            setPendingMainFeedback('success', 'Shift pattern copied successfully.');
            location.reload(); // Reload to show new pattern
        } else {
            showAlertBanner('danger', 'Error creating pattern copy: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showAlertBanner('danger', 'Error creating pattern copy.');
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
