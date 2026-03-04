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
            return false;
        }

        const submitBtn = document.getElementById('assignPatternSubmitBtn');
        const driverId = this.dataset.driverId;
        const originalHtml = submitBtn.innerHTML;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: new FormData(this),
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                showAlertBanner('error', 
                    '<i class="fas fa-exclamation-circle"></i> ' +
                    (result.error || 'Could not save assignment. Please try again.')
                );
                return;
            }

            if (driverId) {
                driverAssignments[driverId] = result.driverAssignments || [];
                loadAssignmentHistory(driverId);
            }

            // Reset form
            this.action = `/driver/${driverId}/assign-pattern`;
            document.getElementById('assign_pattern_id').value = '';
            document.getElementById('assign_start_day').value = '1';
            showAssignPatternPreview();
            document.getElementById('assign_end_date').value = '';
            submitBtn.innerHTML = '<i class="fas fa-calendar-plus"></i> Assign Pattern';

            showAlertBanner('success', 
                '<i class="fas fa-check-circle"></i> ' +
                (result.message || 'Assignment saved successfully.')
            );

            // Refresh driver table in background
            setTimeout(() => refreshDriverRow(driverId), 500);
        } catch (error) {
            showAlertBanner('error', 
                '<i class="fas fa-exclamation-circle"></i> Could not save assignment. Please try again.'
            );
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
        const actionTitle = isDelete ? 'Deleting' : 'Ending';

        try {
            const response = await fetch(formAction, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                showAlertBanner('error',
                    '<i class="fas fa-exclamation-circle"></i> ' +
                    (result.error || `Could not ${actionTitle.toLowerCase()} assignment. Please try again.`)
                );
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

            showAlertBanner('success',
                '<i class="fas fa-check-circle"></i> ' +
                (result.message || `Assignment ${isDelete ? 'deleted' : 'ended'} successfully.`)
            );

            // Refresh driver table in background
            if (driverId) {
                setTimeout(() => refreshDriverRow(driverId), 500);
            }
        } catch (error) {
            showAlertBanner('error',
                '<i class="fas fa-exclamation-circle"></i> Could not process request. Please try again.'
            );
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
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: new FormData(this),
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                showAlertBanner('error',
                    '<i class="fas fa-exclamation-circle"></i> ' +
                    (result.error || 'Could not add driver. Please try again.')
                );
                return;
            }

            // Close modal
            hideModalById('addDriverModal');

            this.reset();

            showAlertBanner('success',
                '<i class="fas fa-check-circle"></i> ' +
                (result.message || 'Driver added successfully.')
            );
            setTimeout(() => location.reload(), 1500);
        } catch (error) {
            showAlertBanner('error',
                '<i class="fas fa-exclamation-circle"></i> Could not add driver. Please try again.'
            );
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
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: new FormData(this),
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                showAlertBanner('error',
                    '<i class="fas fa-exclamation-circle"></i> ' +
                    (result.error || 'Could not update driver. Please try again.')
                );
                return;
            }

            // Close modal
            hideModalById('editDriverModal');

            // Extract driver ID from form action
            const driverId = this.action.match(/\/driver\/(\d+)\/edit/)?.[1];
            if (driverId) {
                showAlertBanner('success',
                    '<i class="fas fa-check-circle"></i> ' +
                    (result.message || 'Driver updated successfully.')
                );
                setTimeout(() => refreshDriverRow(driverId), 500);
            } else {
                showAlertBanner('success',
                    '<i class="fas fa-check-circle"></i> ' +
                    (result.message || 'Driver updated successfully.')
                );
                setTimeout(() => location.reload(), 1500);
            }
        } catch (error) {
            showAlertBanner('error',
                '<i class="fas fa-exclamation-circle"></i> Could not update driver. Please try again.'
            );
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
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                showAlertBanner('error',
                    '<i class="fas fa-exclamation-circle"></i> ' +
                    (result.error || 'Could not delete driver. Please try again.')
                );
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalHtml;
                return;
            }

            // Close modal if open
            hideModalById('deleteModal');

            showAlertBanner('success',
                '<i class="fas fa-check-circle"></i> ' +
                (result.message || 'Driver deleted successfully.')
            );
            setTimeout(() => location.reload(), 1500);
        } catch (error) {
            showAlertBanner('error',
                '<i class="fas fa-exclamation-circle"></i> Could not delete driver. Please try again.'
            );
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
