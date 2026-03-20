/**
 * drivers.form-handlers.js
 * Form submission handlers for Driver Management
 * Dependencies: drivers.core.js
 */

/**
 * Initialize all form event handlers
 */
function initializeFormHandlers() {
    if (window.__driversFormHandlersInitialized) {
        return;
    }
    window.__driversFormHandlersInitialized = true;

    initializeAssignPatternForm();
    initializeAssignmentActionForm();
    initializeAddDriverForm();
    initializeEditDriverForm();
    initializeDeleteDriverForm();
}

/**
 * Handle assignment pattern form submission
 */
function initializeAssignPatternForm() {
    const form = document.getElementById('assignPatternForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const driverId = this.dataset.driverId;
        DEBUG.log('Submitting assignment pattern', 'info', { driverId });

        await submitForm(form, 'assignPatternSubmitBtn', {
            validateFn: () => (validateAssignDates() ? null : MESSAGES.INVALID_DATE_RANGE),
            successMessage: MESSAGES.ASSIGNMENT_SAVED,
            errorMessage: MESSAGES.SERVER_ERROR,
            hideModal: 'assignPatternModal',
            onSuccess: (result) => {
                if (driverId) {
                    driverAssignments[driverId] = result.driverAssignments || [];
                    loadAssignmentHistory(driverId);
                }

                // Reset form fields
                this.action = `/driver/${driverId}/assign-pattern`;
                document.getElementById('assign_pattern_id').value = '';
                document.getElementById('assign_start_day').value = '1';
                showAssignPatternPreview();
                document.getElementById('assign_end_date').value = '';
                document.getElementById('assignPatternSubmitBtn').innerHTML = '<i class="fas fa-calendar-plus"></i> Assign Pattern';

                DEBUG.log('Assignment saved', 'info', { driverId });

                // Refresh driver table in background
                setTimeout(() => refreshDriverRow(driverId), 500);
            },
            onError: (result) => {
                DEBUG.warn('Assignment save failed', { driverId, error: result.error });
            }
        });
    });
}

/**
 * Handle assignment action form submission (end/delete)
 */
function initializeAssignmentActionForm() {
    const form = document.getElementById('assignmentActionForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const formAction = this.action;
        const isDelete = formAction.includes('/delete');
        const actionTitle = isDelete ? MESSAGES.ASSIGNMENT_DELETED : MESSAGES.ASSIGNMENT_ENDED;
        DEBUG.log(`Submitting assignment ${isDelete ? 'delete' : 'end'}`, 'info');

        const submitBtn = this.querySelector('button[type="submit"]');

        await submitForm(form, submitBtn, {
            action: formAction,
            successMessage: actionTitle,
            errorMessage: MESSAGES.SERVER_ERROR,
            hideModal: 'assignmentActionModal',
            onSuccess: (result) => {
                const driverId = result.driverId;
                if (driverId) {
                    driverAssignments[driverId] = result.driverAssignments || [];
                    loadAssignmentHistory(driverId);
                    setTimeout(() => refreshDriverRow(driverId), 500);
                }

                DEBUG.log(`Assignment ${isDelete ? 'deleted' : 'ended'}`, 'info', { driverId });
            },
            onError: (result) => {
                DEBUG.warn(`Assignment ${isDelete ? 'delete' : 'end'} failed`, { error: result.error });
            }
        });
    });
}

/**
 * Handle add driver form submission
 */
function initializeAddDriverForm() {
    const form = document.querySelector('#addDriverModal form');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const submitBtn = this.querySelector('button[type="submit"]');
        DEBUG.log('Submitting add driver form', 'info');

        await submitForm(form, submitBtn, {
            successMessage: MESSAGES.DRIVER_ADDED,
            errorMessage: MESSAGES.SERVER_ERROR,
            hideModal: 'addDriverModal',
            resetForm: true,
            onSuccess: (result) => {
                DEBUG.log('Driver added successfully', 'info', { driverId: result.driverId });
                setTimeout(() => location.reload(), 1500);
            },
            onError: (result) => {
                DEBUG.warn('Add driver failed', { error: result.error });
            }
        });
    });
}

/**
 * Handle edit driver form submission
 */
function initializeEditDriverForm() {
    const form = document.getElementById('editDriverForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const submitBtn = this.querySelector('button[type="submit"]');
        DEBUG.log('Submitting edit driver form', 'info');

        await submitForm(form, submitBtn, {
            successMessage: MESSAGES.DRIVER_UPDATED,
            errorMessage: MESSAGES.SERVER_ERROR,
            hideModal: 'editDriverModal',
            onSuccess: (result) => {
                // Extract driver ID from form action
                const driverId = this.action.match(/\/driver\/(\d+)\/edit/)?.[1];
                if (driverId) {
                    DEBUG.log('Driver updated', 'info', { driverId });
                    setTimeout(() => refreshDriverRow(driverId), 500);
                } else {
                    setTimeout(() => location.reload(), 1500);
                }
            },
            onError: (result) => {
                DEBUG.warn('Edit driver failed', { error: result.error });
            }
        });
    });
}

/**
 * Handle delete driver form submission
 */
function initializeDeleteDriverForm() {
    const form = document.getElementById('deleteForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const submitBtn = this.querySelector('button[type="submit"]');
        DEBUG.log('Submitting delete driver form', 'info');

        await submitForm(form, submitBtn, {
            successMessage: MESSAGES.DRIVER_DELETED,
            errorMessage: MESSAGES.SERVER_ERROR,
            hideModal: 'deleteModal',
            onSuccess: () => {
                DEBUG.log('Driver deleted successfully', 'info');
                setTimeout(() => location.reload(), 1500);
            },
            onError: (result) => {
                DEBUG.warn('Delete driver failed', { error: result.error });
            }
        });
    });
}

/**
 * Validate assignment date fields
 * @returns {boolean} True if dates are valid
 */
function validateAssignDates() {
    const startDateInput = document.getElementById('assign_start_date');
    const endDateInput = document.getElementById('assign_end_date');
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (startDate) {
        endDateInput.min = startDate;

        if (endDate && endDate < startDate) {
            endDateInput.setCustomValidity('End date must be after start date');
            endDateInput.classList.add('is-invalid');
            return false;
        } else {
            endDateInput.setCustomValidity('');
            endDateInput.classList.remove('is-invalid');
            return true;
        }
    }
    return true;
}
