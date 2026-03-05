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
                    setPendingMainFeedback('success', 'Shift pattern deleted successfully.');
                    location.reload();
                } else {
                    showAlertBanner('danger', 'Error deleting pattern: ' + (data.error || 'Unknown error'));
                }
            })
            .catch(error => {
                console.error('Error deleting pattern:', error);
                showAlertBanner('danger', 'Error deleting pattern.');
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
