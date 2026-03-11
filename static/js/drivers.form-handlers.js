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

        if (!validateAssignDates()) {
            showAlertBanner('error', MESSAGES.INVALID_DATE_RANGE);
            return false;
        }

        const submitBtn = document.getElementById('assignPatternSubmitBtn');
        const driverId = this.dataset.driverId;
        const originalHtml = submitBtn.innerHTML;

        submitBtn.disabled = true;
        submitBtn.innerHTML = MESSAGES.SAVING;
        DEBUG.log('Submitting assignment pattern', 'info', { driverId });

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: new FormData(this),
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                const errorMsg = result.error || MESSAGES.SERVER_ERROR;
                showAlertBanner('error', errorMsg);
                DEBUG.warn('Assignment save failed', { driverId, error: errorMsg });
                return;
            }

            if (driverId) {
                driverAssignments[driverId] = result.driverAssignments || [];
                loadAssignmentHistory(driverId);
            }

            hideModalById('assignPatternModal');

            // Reset form
            this.action = `/driver/${driverId}/assign-pattern`;
            document.getElementById('assign_pattern_id').value = '';
            document.getElementById('assign_start_day').value = '1';
            showAssignPatternPreview();
            document.getElementById('assign_end_date').value = '';
            submitBtn.innerHTML = '<i class="fas fa-calendar-plus"></i> Assign Pattern';

            showAlertBanner('success', result.message || MESSAGES.ASSIGNMENT_SAVED);
            DEBUG.log('Assignment saved', 'info', { driverId });

            // Refresh driver table in background
            setTimeout(() => refreshDriverRow(driverId), 500);
        } catch (error) {
            showAlertBanner('error', MESSAGES.NETWORK_ERROR);
            DEBUG.error('Error saving assignment', { error, driverId });
        } finally {
            submitBtn.disabled = false;
            if (!submitBtn.innerHTML.includes('Assign Pattern') && 
                !submitBtn.innerHTML.includes('Update Assignment')) {
                submitBtn.innerHTML = originalHtml;
            }
        }
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

        try {
            const response = await fetch(formAction, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                const errorMsg = result.error || MESSAGES.SERVER_ERROR;
                showAlertBanner('error', errorMsg);
                DEBUG.warn(`Assignment ${isDelete ? 'delete' : 'end'} failed`, { error: errorMsg });
                return;
            }

            // Close the action modal
            hideModalById('assignmentActionModal');

            // Update assignment history
            const driverId = result.driverId;
            if (driverId) {
                driverAssignments[driverId] = result.driverAssignments || [];
                loadAssignmentHistory(driverId);
            }

            showAlertBanner('success', result.message || actionTitle);
            DEBUG.log(`Assignment ${isDelete ? 'deleted' : 'ended'}`, 'info', { driverId });

            // Refresh driver table in background
            if (driverId) {
                setTimeout(() => refreshDriverRow(driverId), 500);
            }
        } catch (error) {
            showAlertBanner('error', MESSAGES.NETWORK_ERROR);
            DEBUG.error('Error processing assignment action', { error });
        }
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
        const originalHtml = submitBtn.innerHTML;

        submitBtn.disabled = true;
        submitBtn.innerHTML = MESSAGES.SAVING;
        DEBUG.log('Submitting add driver form', 'info');

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: new FormData(this),
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                const errorMsg = result.error || MESSAGES.SERVER_ERROR;
                showAlertBanner('error', errorMsg);
                DEBUG.warn('Add driver failed', { error: errorMsg });
                return;
            }

            // Close modal
            hideModalById('addDriverModal');

            this.reset();

            showAlertBanner('success', result.message || MESSAGES.DRIVER_ADDED);
            DEBUG.log('Driver added successfully', 'info', { driverId: result.driverId });
            
            setTimeout(() => location.reload(), 1500);
        } catch (error) {
            showAlertBanner('error', MESSAGES.NETWORK_ERROR);
            DEBUG.error('Error adding driver', { error });
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHtml;
        }
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
        const originalHtml = submitBtn.innerHTML;

        submitBtn.disabled = true;
        submitBtn.innerHTML = MESSAGES.SAVING;
        DEBUG.log('Submitting edit driver form', 'info');

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: new FormData(this),
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                const errorMsg = result.error || MESSAGES.SERVER_ERROR;
                showAlertBanner('error', errorMsg);
                DEBUG.warn('Edit driver failed', { error: errorMsg });
                return;
            }

            // Close modal
            hideModalById('editDriverModal');

            // Extract driver ID from form action
            const driverId = this.action.match(/\/driver\/(\d+)\/edit/)?.[1];
            if (driverId) {
                showAlertBanner('success', result.message || MESSAGES.DRIVER_UPDATED);
                DEBUG.log('Driver updated', 'info', { driverId });
                setTimeout(() => refreshDriverRow(driverId), 500);
            } else {
                showAlertBanner('success', result.message || MESSAGES.DRIVER_UPDATED);
                setTimeout(() => location.reload(), 1500);
            }
        } catch (error) {
            showAlertBanner('error', MESSAGES.NETWORK_ERROR);
            DEBUG.error('Error updating driver', { error });
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHtml;
        }
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
        const originalHtml = submitBtn.innerHTML;

        submitBtn.disabled = true;
        submitBtn.innerHTML = MESSAGES.SAVING;
        DEBUG.log('Submitting delete driver form', 'info');

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                const errorMsg = result.error || MESSAGES.SERVER_ERROR;
                showAlertBanner('error', errorMsg);
                DEBUG.warn('Delete driver failed', { error: errorMsg });
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalHtml;
                return;
            }

            // Close modal if open
            hideModalById('deleteModal');

            showAlertBanner('success', result.message || MESSAGES.DRIVER_DELETED);
            DEBUG.log('Driver deleted successfully', 'info');
            setTimeout(() => location.reload(), 1500);
        } catch (error) {
            showAlertBanner('error', MESSAGES.NETWORK_ERROR);
            DEBUG.error('Error deleting driver', { error });
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHtml;
        }
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
