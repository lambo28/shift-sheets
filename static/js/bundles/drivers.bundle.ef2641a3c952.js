/* Auto-generated bundle. Do not edit directly. */
/* Bundle: drivers.bundle.js */


/* ===== shared.core.js ===== */
/**
 * shared.core.js
 * Shared utilities for all pages
 * No dependencies
 */

/**
 * Clean up orphaned Bootstrap modal backdrop elements
 * Called after modals close to restore page interactivity
 */
function cleanupModalArtifacts() {
    const openModals = document.querySelectorAll('.modal.show');
    if (openModals.length > 0) {
        return;
    }

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

/**
 * Close a modal by ID with proper cleanup
 * @param {string} modalId - The ID of the modal element
 */
function hideModalById(modalId) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl || typeof bootstrap === 'undefined') {
        cleanupModalArtifacts();
        return;
    }

    modalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts, { once: true });
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    setTimeout(cleanupModalArtifacts, 400);
}

/**
 * Display a notification banner with auto-dismiss
 * Fixed position, top-right corner with slide animation
 * @param {string} type - Alert type: 'success', 'danger', 'warning', 'info', 'error'
 * @param {string} message - HTML message to display
 * @param {boolean} autoDismiss - Auto-close after duration (default: true)
 * @param {number} duration - Time in ms before auto-dismiss (default: 4000)
 */
function showAlertBanner(type = 'info', message = 'Message', autoDismiss = true, duration = 4000) {
    const container = document.getElementById('alertBannerContainer');
    const alertId = 'alert-' + Date.now();

    const alertClass = {
        'success': 'alert-success',
        'error': 'alert-danger',
        'danger': 'alert-danger',
        'warning': 'alert-warning',
        'info': 'alert-info'
    }[type] || 'alert-info';

    const alert = document.createElement('div');
    alert.id = alertId;
    alert.className = `alert alert-banner ${alertClass} alert-dismissible fade show`;
    alert.role = 'alert';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    container.appendChild(alert);

    if (autoDismiss) {
        setTimeout(() => {
            const alertEl = document.getElementById(alertId);
            if (alertEl) {
                alertEl.classList.add('dismissing');
                setTimeout(() => alertEl.remove(), 300);
            }
        }, duration);
    }
}

/**
 * Fetch JSON from server with error handling
 * @param {string} url - Endpoint URL
 * @param {object} options - Fetch options
 * @returns {object} - {success: boolean, ...data}
 */
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

/**
 * Initialize modal cleanup binding for all modals
 * Attaches cleanup to hidden.bs.modal event
 */
function initializeModalCleanup() {
    document.querySelectorAll('.modal').forEach((modalEl) => {
        modalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts);
    });
}

/**
 * Format text to title case (capitalize first letter of each word)
 * @param {string} value - Text to format
 * @returns {string} - Title cased text
 */
function formatTitleCase(value) {
    const normalized = String(value || '').replace(/_/g, ' ').trim();
    if (!normalized) return '';

    return normalized
        .split(/\s+/)
        .map((part) => {
            const lower = part.toLowerCase();
            if (lower === 'am' || lower === 'pm') {
                return lower.toUpperCase();
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
}


/* ===== drivers.core.js ===== */
/**
 * drivers.core.js
 * Core utilities for Driver Management
 * Dependencies: none
 */

// driverAssignments is initialized by the template after this script loads

/**
 * Refresh a specific driver row in the table without full page reload
 * @param {number} driverId - The ID of the driver to refresh
 */
async function refreshDriverRow(driverId) {
    try {
        const response = await fetch(`/driver/${driverId}/data`, {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });

        const result = await response.json();
        if (!response.ok || !result.ok) {
            console.error('Failed to refresh driver data');
            return;
        }

        const row = document.querySelector(`tr[data-driver-id="${driverId}"]`);
        if (!row) {
            console.warn(`Driver row not found for ID ${driverId}`);
            return;
        }

        // Update the Shift Patterns cell (index 4)
        const cells = row.querySelectorAll('td');
        if (cells.length >= 5) {
            cells[4].innerHTML = buildPatternHtml(
                result.current_assignment,
                result.future_assignments
            );
        }

        // Update assignment history data
        driverAssignments[driverId] = result.assignments || [];

        // Recompute custom timing indicators on refreshed pattern badges
        refreshPatternIndicatorsForDriver(driverId);
    } catch (error) {
        console.error('Error refreshing driver data:', error);
    }
}

async function refreshPatternIndicatorsForDriver(driverId) {
    try {
        const response = await fetch(`/driver/${driverId}/custom-timings/list`, {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });

        if (!response.ok) {
            return;
        }

        const result = await response.json();
        if (!result.success) {
            return;
        }

        if (typeof updateDriverPatternTimingIndicators === 'function') {
            updateDriverPatternTimingIndicators(driverId, result.timings || []);
        }
    } catch (error) {
        console.error('Error refreshing pattern indicators:', error);
    }
}

/**
 * Build HTML for pattern display
 * @param {object} currentAssignment - Current active assignment
 * @param {array} futureAssignments - Future scheduled assignments
 * @returns {string} HTML for pattern cell
 */
function buildPatternHtml(currentAssignment, futureAssignments) {
    if (!currentAssignment && futureAssignments.length === 0) {
        return '<div class="text-muted text-center"><small>No pattern assigned</small></div>';
    }

    let html = '<div class="d-flex flex-column">';

    if (currentAssignment) {
        const today = new Date();
        const endDate = currentAssignment.end_date ? new Date(currentAssignment.end_date) : null;
        const hasEndDate = currentAssignment.has_end_date;

        html += `<span class="badge ${hasEndDate ? 'bg-warning text-dark' : 'bg-success'} mb-1" data-pattern-id="${currentAssignment.pattern_id || ''}">
            ${currentAssignment.pattern_name}
            <span class="badge bg-success border border-white ms-1 px-1 py-0 custom-timing-indicator d-none" title="Affected by custom timing">
                <i class="fas fa-clock text-white"></i>
            </span>
        </span>`;

        const startDateFormatted = new Date(currentAssignment.start_date).toLocaleDateString('en-GB');
        const endDateFormatted = currentAssignment.end_date
            ? new Date(currentAssignment.end_date).toLocaleDateString('en-GB')
            : null;

        html += '<small class="text-muted">';
        if (hasEndDate) {
            html += `From ${startDateFormatted} until ${endDateFormatted}`;
        } else {
            html += `From ${startDateFormatted} onward`;
        }
        html += '</small>';
    }

    for (const assignment of futureAssignments) {
        const startDate = new Date(assignment.start_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        startDate.setHours(0, 0, 0, 0);
        const daysUntilStart = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));

        html += `<span class="badge bg-primary mb-1" data-pattern-id="${assignment.pattern_id || ''}">
            ${assignment.pattern_name}
            <span class="badge bg-success border border-white ms-1 px-1 py-0 custom-timing-indicator d-none" title="Affected by custom timing">
                <i class="fas fa-clock text-white"></i>
            </span>
        </span>`;
        html += `<small class="text-muted">
            Scheduled · Starts in ${daysUntilStart} day${daysUntilStart !== 1 ? 's' : ''} 
            (${startDate.toLocaleDateString('en-GB')})
        </small>`;
    }

    html += '</div>';
    return html;
}



/**
 * Show confirmation modal for assignment actions
 * @param {object} options - Configuration options
 */
function showAssignmentActionConfirm(options = {}) {
    const {
        title = 'Confirm Action',
        message = 'Are you sure?',
        action = '#',
        submitLabel = 'Confirm'
    } = options;

    const titleEl = document.getElementById('assignmentActionTitle');
    const messageEl = document.getElementById('assignmentActionMessage');
    const formEl = document.getElementById('assignmentActionForm');
    const submitEl = document.getElementById('assignmentActionSubmitBtn');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.innerHTML = message;
    if (formEl) formEl.action = action;
    if (submitEl) {
        submitEl.textContent = submitLabel;
        submitEl.className = 'btn btn-' + (submitLabel.includes('Delete') ? 'danger' : 'warning');
    }

    const modalEl = document.getElementById('assignmentActionModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
}

/**

 * Get relative text for when an assignment ends
 * @param {string} endDateString - End date as string
 * @returns {string} Relative ending text
 */
function getRelativeEndingText(endDateString) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateString);
    endDate.setHours(0, 0, 0, 0);

    const diffDays = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Ending Today';
    if (diffDays === 1) return 'Ending Tomorrow';
    if (diffDays >= 2 && diffDays <= 7) return 'Ending This Week';
    if (diffDays >= 8 && diffDays <= 14) return 'Ending Next Week';
    if (diffDays >= 15 && diffDays <= 21) return 'Ending in 2 Weeks';
    if (diffDays >= 22 && diffDays <= 28) return 'Ending in 3 Weeks';
    if (diffDays >= 29 && diffDays <= 60) return 'Ending Next Month';

    const diffMonths = Math.round(diffDays / 30);
    return `Ending in ${diffMonths} Months`;
}

/**
 * Load and display assignment history for a driver
 * @param {number} driverId - The driver ID
 */
function loadAssignmentHistory(driverId) {
    const assignments = driverAssignments[driverId] || [];
    const historySection = document.getElementById('assignmentHistorySection');
    const historyContent = document.getElementById('assignmentHistoryContent');
    const panelContent = document.querySelector(`.assignments-list[data-driver-id="${driverId}"]`);

    if (assignments.length === 0) {
        if (historySection) historySection.style.display = 'none';
        if (panelContent) {
            panelContent.innerHTML = '<p class="text-muted text-center py-3 mb-0">No assignments yet. Use <strong>Add Assignment</strong> to create one.</p>';
        }
        return;
    }

    let html = '<div class="table-responsive"><table class="table table-sm table-hover">';
    html += '<thead><tr><th>Pattern</th><th>Period</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead>';
    html += '<tbody>';

    assignments.forEach(assignment => {
        const startDateFormatted = new Date(assignment.startDate).toLocaleDateString('en-GB');
        const endDateFormatted = assignment.endDate
            ? new Date(assignment.endDate).toLocaleDateString('en-GB')
            : 'Ongoing';

        let statusBadge = '';
        if (assignment.status === 'scheduled') {
            statusBadge = '<span class="badge bg-primary">Scheduled</span>';
        } else if (assignment.status === 'active') {
            if (assignment.hasEndDate) {
                const relativeText = getRelativeEndingText(assignment.endDate);
                statusBadge = `<span class="badge bg-warning">${relativeText}</span>`;
            } else {
                statusBadge = '<span class="badge bg-success">Active</span>';
            }
        } else if (assignment.status === 'ended') {
            statusBadge = '<span class="badge bg-secondary">Ended</span>';
        }

        html += `
            <tr>
                <td>${assignment.patternName}</td>
                <td>${startDateFormatted} - ${endDateFormatted}</td>
                <td>${statusBadge}</td>
                <td>${assignment.createdAt}</td>
                <td><div class="btn-group" role="group">
        `;

        // Render appropriate action buttons based on status
        if (assignment.status === 'scheduled') {
            html += `
                <button type="button" class="btn btn-sm btn-primary edit-assignment-btn"
                        data-assignment-id="${assignment.id}" data-driver-id="${driverId}" title="Edit Assignment">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn btn-sm btn-danger delete-assignment-btn" 
                        data-assignment-id="${assignment.id}" data-pattern-name="${assignment.patternName}" 
                        data-driver-id="${driverId}" title="Delete Assignment">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        } else if (assignment.status === 'active' && !assignment.hasEndDate) {
            html += `
                <button type="button" class="btn btn-sm btn-primary edit-assignment-btn"
                        data-assignment-id="${assignment.id}" data-driver-id="${driverId}" title="Edit Assignment">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn btn-sm btn-warning end-assignment-btn" 
                        data-assignment-id="${assignment.id}" data-pattern-name="${assignment.patternName}" 
                        data-driver-id="${driverId}" title="End Assignment">
                    <i class="fas fa-stop"></i>
                </button>
            `;
        } else if (assignment.status === 'active' && assignment.hasEndDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const endDate = new Date(assignment.endDate);
            endDate.setHours(0, 0, 0, 0);
            const endingToday = endDate.getTime() === today.getTime();

            html += `
                <button type="button" class="btn btn-sm btn-primary edit-assignment-btn"
                        data-assignment-id="${assignment.id}" data-driver-id="${driverId}" title="Edit Assignment">
                    <i class="fas fa-edit"></i>
                </button>
            `;

            if (!endingToday) {
                html += `
                    <button type="button" class="btn btn-sm btn-warning end-assignment-btn" 
                            data-assignment-id="${assignment.id}" data-pattern-name="${assignment.patternName}" 
                            data-driver-id="${driverId}" title="End Assignment Now">
                        <i class="fas fa-stop"></i>
                    </button>
                `;
            }
        } else if (assignment.status === 'ended') {
            html += `
                <button type="button" class="btn btn-sm btn-danger delete-assignment-btn" 
                        data-assignment-id="${assignment.id}" data-pattern-name="${assignment.patternName}" 
                        data-driver-id="${driverId}" title="Delete Assignment">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }

        html += '</div></td></tr>';
    });

    html += '</tbody></table></div>';
    if (historyContent) {
        historyContent.innerHTML = html;
    }
    if (historySection) {
        historySection.style.display = 'block';
    }
    if (panelContent) {
        panelContent.innerHTML = html;
    }
}


/* ===== drivers.form-handlers.js ===== */
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


/* ===== drivers.event-bindings.js ===== */
/**
 * drivers.event-bindings.js
 * UI event listeners for Driver Management
 * Dependencies: drivers.core.js, drivers.form-handlers.js
 */

/**
 * Initialize all event listeners
 */
function initializeEventBindings() {
    if (window.__driversEventBindingsInitialized) {
        return;
    }
    window.__driversEventBindingsInitialized = true;

    initializeModalCleanup();
    initializeGlobalClickHandler();
    initializeStringFormatters();
    initializePatternForm();
}

function initializeModalCleanup() {
    document.querySelectorAll('.modal').forEach((modalEl) => {
        modalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts);
    });
}

/**
 * Global click handler for all button actions
 */
function initializeGlobalClickHandler() {
    document.addEventListener('click', function(event) {
        handleAssignPatternButton(event) ||
        handleAddAssignmentButton(event) ||
        handleAssignmentDeleteButton(event) ||
        handleAssignmentEndButton(event) ||
        handleAssignmentEditButton(event) ||
        handleEditDriverButton(event) ||
        handleDeleteDriverButton(event);
    });
}

/**
 * Handle assign pattern button click
 */
function handleAssignPatternButton(event) {
    if (!event.target.closest('.assign-pattern-btn')) return false;

    const button = event.target.closest('.assign-pattern-btn');
    const driverId = button.getAttribute('data-driver-id');
    const panel = document.getElementById(`assignments-panel-${driverId}`);
    if (!panel) return true;

    const willOpen = panel.classList.contains('d-none');

    if (willOpen) {
        document.querySelectorAll('.assignments-panel').forEach((row) => row.classList.add('d-none'));
        document.querySelectorAll('.custom-timings-panel').forEach((row) => row.classList.add('d-none'));
        document.querySelectorAll('.assign-pattern-btn').forEach((btn) => btn.classList.remove('active'));
        document.querySelectorAll('.toggle-custom-timings').forEach((btn) => btn.classList.remove('active'));
    }

    panel.classList.toggle('d-none', !willOpen);
    button.classList.toggle('active', willOpen);
    button.blur();

    if (willOpen) {
        loadAssignmentHistory(driverId);
    }

    return true;
}

function openAssignPatternModalForDriver(driverMeta) {
    const { driverId, driverNumber, driverName, currentPattern, currentStart } = driverMeta;

    document.getElementById('assignPatternForm').action = `/driver/${driverId}/assign-pattern`;
    document.getElementById('assignPatternModalTitle').innerHTML =
        `<i class="fas fa-calendar-plus"></i> Assign Shift Pattern - #${driverNumber} ${driverName}`;

    const today = new Date();
    const todayString = `${today.getFullYear()}-${
        String(today.getMonth() + 1).padStart(2, '0')}-${
        String(today.getDate()).padStart(2, '0')}`;
    document.getElementById('assign_start_date').value = todayString;
    document.getElementById('assign_end_date').value = '';

    document.getElementById('assign_pattern_id').value = '';
    document.getElementById('assignPatternPreview').style.display = 'none';
    document.getElementById('assign_current_assignment_warning').style.display = 'none';
    document.getElementById('assign_end_date').classList.remove('is-invalid');
    document.getElementById('assignPatternSubmitBtn').innerHTML =
        '<i class="fas fa-calendar-plus"></i> Assign Pattern';

    document.getElementById('assignPatternForm').dataset.currentPattern = currentPattern || '';
    document.getElementById('assignPatternForm').dataset.currentStart = currentStart || '';
    document.getElementById('assignPatternForm').dataset.driverId = driverId;

    loadAssignmentHistory(driverId);

    const assignModal = new bootstrap.Modal(document.getElementById('assignPatternModal'));
    assignModal.show();
}

function handleAddAssignmentButton(event) {
    if (!event.target.closest('.add-assignment-btn')) return false;

    const button = event.target.closest('.add-assignment-btn');
    openAssignPatternModalForDriver({
        driverId: button.getAttribute('data-driver-id'),
        driverNumber: button.getAttribute('data-driver-number'),
        driverName: button.getAttribute('data-driver-name'),
        currentPattern: button.getAttribute('data-current-pattern') || '',
        currentStart: button.getAttribute('data-current-start') || '',
    });

    return true;
}

/**
 * Handle assignment delete button click
 */
function handleAssignmentDeleteButton(event) {
    if (!event.target.closest('.delete-assignment-btn')) return false;

    const button = event.target.closest('.delete-assignment-btn');
    const assignmentId = button.getAttribute('data-assignment-id');
    const patternName = button.getAttribute('data-pattern-name');
    const driverId = button.getAttribute('data-driver-id');

    showAssignmentActionConfirm({
        title: 'Delete Assignment',
        message: `<strong>Are you sure you want to DELETE this assignment?</strong><br><br>
                 Pattern: <strong>${patternName}</strong><br><br>
                 This will permanently remove the assignment from history.`,
        action: `/driver/${driverId}/assignment/${assignmentId}/delete`,
        submitLabel: 'Delete Assignment'
    });

    return true;
}

/**
 * Handle assignment end button click
 */
function handleAssignmentEndButton(event) {
    if (!event.target.closest('.end-assignment-btn')) return false;

    const button = event.target.closest('.end-assignment-btn');
    const assignmentId = button.getAttribute('data-assignment-id');
    const patternName = button.getAttribute('data-pattern-name');
    const driverId = button.getAttribute('data-driver-id');

    showAssignmentActionConfirm({
        title: 'End Assignment',
        message: `<strong>Are you sure you want to end this assignment?</strong><br><br>
                 Pattern: <strong>${patternName}</strong><br><br>
                 This will stop the shift pattern from today onwards.`,
        action: `/driver/${driverId}/assignment/${assignmentId}/end`,
        submitLabel: 'End Assignment'
    });

    return true;
}

/**
 * Handle assignment edit button click
 */
function handleAssignmentEditButton(event) {
    if (!event.target.closest('.edit-assignment-btn')) return false;

    const button = event.target.closest('.edit-assignment-btn');
    const assignmentId = button.getAttribute('data-assignment-id');
    const driverId = button.getAttribute('data-driver-id');
    const assignToggleBtn = document.querySelector(`.assign-pattern-btn[data-driver-id="${driverId}"]`);
    const driverNumber = assignToggleBtn?.getAttribute('data-driver-number') || '';
    const driverName = assignToggleBtn?.getAttribute('data-driver-name') || '';

    const assignments = driverAssignments[driverId] || [];
    const assignment = assignments.find(a => String(a.id) === String(assignmentId));

    if (!assignment) {
        showAlertBanner('error',
            '<i class="fas fa-exclamation-circle"></i> Could not find assignment to edit. Please refresh and try again.'
        );
        return true;
    }

    // Populate form with assignment data
    document.getElementById('assignPatternForm').dataset.driverId = driverId;
    document.getElementById('assignPatternForm').action =
        `/driver/${driverId}/assignment/${assignmentId}/edit`;
    document.getElementById('assign_pattern_id').value = String(assignment.patternId);
    showAssignPatternPreview();
    document.getElementById('assign_start_day').value = String(assignment.startDayOfCycle || 1);
    showAssignPatternPreview();
    document.getElementById('assign_start_date').value = assignment.startDate || '';
    document.getElementById('assign_end_date').value = assignment.endDate || '';
    document.getElementById('assign_current_assignment_warning').style.display = 'none';
    document.getElementById('assignPatternSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Update Assignment';
    const displayDriver = driverNumber && driverName
        ? ` - #${driverNumber} ${driverName}`
        : '';
    document.getElementById('assignPatternModalTitle').innerHTML =
        `<i class="fas fa-edit"></i> Edit Shift Assignment${displayDriver}`;

    // Show modal
    const assignModal = new bootstrap.Modal(document.getElementById('assignPatternModal'));
    assignModal.show();

    return true;
}

/**
 * Handle edit driver button click
 */
function handleEditDriverButton(event) {
    if (!event.target.closest('.edit-driver-btn')) return false;

    const button = event.target.closest('.edit-driver-btn');
    const driverId = button.getAttribute('data-driver-id');

    // Populate form
    document.getElementById('editDriverForm').action = `/driver/${driverId}/edit`;
    document.getElementById('edit_driver_number').value = button.getAttribute('data-driver-number') || '';
    document.getElementById('edit_name').value = button.getAttribute('data-driver-name') || '';
    document.getElementById('edit_car_type').value = button.getAttribute('data-car-type') || '';
    document.getElementById('edit_electric_vehicle').checked = 
        button.getAttribute('data-electric-vehicle') === '1';
    document.getElementById('edit_school_badge').checked =
        button.getAttribute('data-school-badge') === '1';
    document.getElementById('edit_pet_friendly').checked =
        button.getAttribute('data-pet-friendly') === '1';
    document.getElementById('edit_assistance_guide_dogs_exempt').checked =
        button.getAttribute('data-assistance-guide-dogs-exempt') === '1';

    // Show modal
    const editModal = new bootstrap.Modal(document.getElementById('editDriverModal'));
    editModal.show();

    return true;
}

/**
 * Handle delete driver button click
 */
function handleDeleteDriverButton(event) {
    if (!event.target.closest('.delete-driver-btn')) return false;

    const button = event.target.closest('.delete-driver-btn');
    const driverId = button.getAttribute('data-driver-id');
    const driverName = button.getAttribute('data-driver-name');

    if (typeof window.showGlobalDeleteConfirm === 'function') {
        window.showGlobalDeleteConfirm({
            title: 'Confirm Deletion',
            message: 'Are you sure you want to delete driver',
            name: driverName,
            warning: 'This will also remove all pattern assignments for this driver.',
            action: `/driver/${driverId}/delete`,
            submitLabel: 'Delete Driver'
        });
    }

    return true;
}

/**
 * Initialize string format handlers
 */
function initializeStringFormatters() {
    ['add_name', 'edit_name'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('blur', function(e) {
            e.target.value = formatTitleCase(e.target.value);
        });
    });
}

/**
 * Initialize pattern form handlers
 */
function initializePatternForm() {
    const patternSelect = document.getElementById('assign_pattern_id');
    const startDaySelect = document.getElementById('assign_start_day');
    const startDateInput = document.getElementById('assign_start_date');
    const endDateInput = document.getElementById('assign_end_date');

    if (patternSelect) {
        patternSelect.addEventListener('change', showAssignPatternPreview);
    }

    if (startDaySelect) {
        startDaySelect.addEventListener('change', showAssignPatternPreview);
    }

    if (startDateInput) {
        startDateInput.addEventListener('change', function() {
            validateAssignDates();
            updateAssignPatternWarning();
        });
    }

    if (endDateInput) {
        endDateInput.addEventListener('change', validateAssignDates);
    }
}

/**
 * Update pattern assignment warning
 */
function updateAssignPatternWarning() {
    const form = document.getElementById('assignPatternForm');
    const patternSelect = document.getElementById('assign_pattern_id');
    const startDateInput = document.getElementById('assign_start_date');
    const warningDiv = document.getElementById('assign_current_assignment_warning');
    const warningText = document.getElementById('assign_warning_text');

    const currentPattern = form?.dataset.currentPattern || '';
    const currentStart = form?.dataset.currentStart || '';

    if (currentPattern && patternSelect.value && startDateInput.value) {
        const startDate = new Date(startDateInput.value);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() - 1);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        startDate.setHours(0, 0, 0, 0);

        if (startDate > today) {
            warningText.innerHTML = `This driver is assigned to "${currentPattern}". 
                Current pattern will continue until ${endDate.toLocaleDateString('en-GB')} 
                and new pattern starts ${startDate.toLocaleDateString('en-GB')}.`;
        } else {
            warningText.innerHTML = `This driver is currently assigned to "${currentPattern}". 
                The new assignment will end the current one.`;
        }
        warningDiv.style.display = 'block';
    } else {
        warningDiv.style.display = 'none';
    }
}

/**
 * Build and display shift pattern preview
 */
function showAssignPatternPreview() {
    const select = document.getElementById('assign_pattern_id');
    const preview = document.getElementById('assignPatternPreview');
    const display = document.getElementById('assignPatternDisplay');
    const startDaySection = document.getElementById('startDaySection');
    const startDaySelect = document.getElementById('assign_start_day');

    if (!select.value) {
        preview.style.display = 'none';
        startDaySection.style.display = 'none';
        return;
    }

    const option = select.selectedOptions[0];
    const cycleLength = parseInt(option.dataset.cycle || 1);
    let patternData = [];

    try {
        patternData = JSON.parse(option.dataset.pattern || '[]');
    } catch (error) {
        patternData = [];
    }

    // Populate starting day dropdown and preserve current selection
    const existingSelectedDay = parseInt(startDaySelect.value || '1', 10) || 1;
    startDaySelect.innerHTML = '';
    for (let i = 1; i <= cycleLength; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Day ${i}`;
        startDaySelect.appendChild(opt);
    }
    const selectedDay = Math.min(Math.max(existingSelectedDay, 1), cycleLength);
    startDaySelect.value = String(selectedDay);
    startDaySection.style.display = 'block';

    // Build pattern display
    const normalizedPattern = patternData.map(dayEntry =>
        Array.isArray(dayEntry) ? dayEntry : [dayEntry]
    );
    const allShifts = normalizedPattern.flat();
    const nonOffShifts = allShifts.filter(s => s !== 'day_off');

    const startIndex = selectedDay - 1;
    const orderedPattern = normalizedPattern
        .slice(startIndex)
        .concat(normalizedPattern.slice(0, startIndex));

    display.innerHTML = '';
    orderedPattern.forEach(dayShifts => {
        const workingShifts = dayShifts.filter(s => s !== 'day_off');

        if (workingShifts.length >= 2) {
            const openParen = document.createElement('span');
            openParen.textContent = '(';
            openParen.style.marginRight = '2px';
            openParen.style.fontWeight = 'bold';
            display.appendChild(openParen);
        }

        const shiftsToRender = workingShifts.length > 0 ? workingShifts : ['day_off'];
        shiftsToRender.forEach(shift => {
            const badge = createShiftBadge(shift, nonOffShifts);
            display.appendChild(badge);
        });

        if (workingShifts.length >= 2) {
            const closeParen = document.createElement('span');
            closeParen.textContent = ')';
            closeParen.style.marginLeft = '2px';
            closeParen.style.fontWeight = 'bold';
            display.appendChild(closeParen);
        }
    });

    preview.style.display = 'block';
    updateAssignPatternWarning();
}

/**
 * Create a shift badge element using real shift timing data
 */
function createShiftBadge(shift, nonOffShifts) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.minWidth = '24px';
    badge.style.lineHeight = '1.3';
    badge.style.padding = '0.35em 0.5em';
    badge.style.cursor = 'default';

    // Handle day_off
    if (shift === 'day_off') {
        badge.className += ' bg-secondary';
        badge.textContent = 'OFF';
        badge.title = 'Rest Day';
        return badge;
    }

    // Use real shift timing data if available
    const shiftTiming = window.shiftTimings && window.shiftTimings[shift];
    
    if (shiftTiming) {
        // Use actual badge color and label from shift timing
        badge.className += ' ' + (shiftTiming.badgeColor || 'bg-primary');
        badge.title = shiftTiming.label || formatShiftName(shift);
        
        // Generate abbreviation (matching shift_abbrev filter logic)
        const words = shift.replace(/_/g, ' ').split(/\s+/);
        let abbrev;
        
        if (words.length > 1) {
            // Multi-word: first letter of each word
            abbrev = words.map(w => w[0].toUpperCase()).join('');
        } else {
            // Single word: check if initial is unique
            const initial = shift[0].toUpperCase();
            const conflicts = nonOffShifts.filter(s => 
                s !== 'day_off' && s[0].toUpperCase() === initial && s !== shift
            );
            abbrev = conflicts.length > 0 ? shift[0].toUpperCase() : initial;
        }
        
        badge.textContent = abbrev;
    } else {
        // Fallback for shift types without timing data
        badge.className += ' bg-primary';
        const formatted = formatShiftName(shift);
        const words = shift.replace(/_/g, ' ').split(/\s+/);
        
        const abbrev = words.length > 1 ?
            words.map(w => w[0].toUpperCase()).join('') :
            shift[0].toUpperCase();
        
        badge.textContent = abbrev;
        badge.title = formatted;
    }

    return badge;
}

/**
 * Format shift name for display
 */
function formatShiftName(shift) {
    return shift.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    initializeEventBindings();
    initializeFormHandlers();
});


/* ===== drivers.calendar.js ===== */
/**
 * drivers.calendar.js
 * Driver calendar modal logic for Driver Management
 */

let driverCalendarState = {
    driverId: null,
    driverNumber: '',
    driverName: '',
    monthDate: null,
};

function toCalendarMonthParam(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function escapeDriverCalendarHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderDriverCalendar(data) {
    const body = document.getElementById('driverCalendarBody');
    const monthLabel = document.getElementById('driverCalendarMonthLabel');
    if (!body || !monthLabel) return;

    monthLabel.textContent = data.month_label || '';

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const firstWeekday = Number(data.first_weekday || 0);
    const dayCells = [];

    for (let i = 0; i < firstWeekday; i++) {
        dayCells.push('<td class="cal-empty"></td>');
    }

    (data.days || []).forEach((day) => {
        const lateStart = Array.isArray(day.adjustments)
            ? day.adjustments.find((adj) => adj.adjustment_type === 'late_start')
            : null;
        const earlyFinish = Array.isArray(day.adjustments)
            ? day.adjustments.find((adj) => adj.adjustment_type === 'early_finish')
            : null;

        const toMinutes = (timeValue) => {
            if (!timeValue || typeof timeValue !== 'string' || !timeValue.includes(':')) return null;
            const [hours, mins] = timeValue.split(':').map((v) => parseInt(v, 10));
            if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
            return (hours * 60) + mins;
        };

        const toTimeText = (minutesValue) => {
            if (minutesValue === null || minutesValue === undefined) return '';
            const hrs = String(Math.floor(minutesValue / 60)).padStart(2, '0');
            const mins = String(minutesValue % 60).padStart(2, '0');
            return `${hrs}:${mins}`;
        };

        const hasDayOffShift = Array.isArray(day.shifts)
            ? day.shifts.some((shift) => shift.shift_type === 'day_off' || shift.label === 'OFF')
            : false;

        const shiftBadges = [];
        const bottomTimeTokens = [];

        (day.shifts || []).forEach((shift) => {
            const startMinutes = toMinutes(shift.start_time);
            const endMinutes = toMinutes(shift.end_time);
            const defaultStartMinutes = toMinutes(shift.default_start_time) ?? startMinutes;
            const defaultEndMinutes = toMinutes(shift.default_end_time) ?? endMinutes;

            const effectiveStartMinutes = startMinutes;
            const effectiveEndMinutes = endMinutes;

            const startText = toTimeText(effectiveStartMinutes);
            const endText = toTimeText(effectiveEndMinutes);
            const hasTime = Boolean(startText || endText);
            const rangeText = hasTime
                ? `${startText}${startText && endText ? '–' : ''}${endText}`
                : '';

            const startChanged =
                (effectiveStartMinutes !== null || defaultStartMinutes !== null)
                    ? effectiveStartMinutes !== defaultStartMinutes
                    : false;
            const endChanged =
                (effectiveEndMinutes !== null || defaultEndMinutes !== null)
                    ? effectiveEndMinutes !== defaultEndMinutes
                    : false;
            const isChangedFromDefault = startChanged || endChanged;

            const shiftIconHtml = (shift.shift_type === 'day_off' || shift.label === 'OFF')
                ? ''
                : `<i class="${shift.icon || 'fas fa-clock'} text-white"></i>`;
            const swapIconHtml = shift.is_swap
                ? `<i class="fas fa-right-left ms-1" title="Swapped shift" aria-label="Swapped shift"></i>`
                : '';
            shiftBadges.push(`<span class="badge ${shift.badge_color || 'bg-primary'} cal-shift-box"><span class="cal-shift-label">${shiftIconHtml}${shift.label}${swapIconHtml}</span></span>`);
        });

        const workingShifts = (day.shifts || []).filter((shift) => shift.shift_type !== 'day_off' && shift.label !== 'OFF');
        const standardShifts = workingShifts.filter((shift) => !shift.is_extra);
        const extraShifts = workingShifts.filter((shift) => shift.is_extra);

        const toWindow = (shift) => {
            const startMinutes = toMinutes(shift.start_time);
            const endMinutes = toMinutes(shift.end_time);
            if (startMinutes === null || endMinutes === null) return null;
            let normalizedEnd = endMinutes;
            if (normalizedEnd <= startMinutes) normalizedEnd += 24 * 60;
            return { start: startMinutes, end: normalizedEnd };
        };

        const allWindows = workingShifts.map(toWindow).filter(Boolean);
        const standardWindows = standardShifts.map(toWindow).filter(Boolean);

        // Check if any shift has custom times or if there are adjustments/extras
        const hasCustomTimes = workingShifts.some((shift) => shift.is_custom_time);
        const hasAdjustments = lateStart || earlyFinish;
        const shouldShowBottomTime = hasCustomTimes || extraShifts.length > 0 || hasAdjustments;

        if (!day.is_holiday && !hasDayOffShift && allWindows.length && shouldShowBottomTime) {
            const allStart = Math.min(...allWindows.map((window) => window.start));
            const allEnd = Math.max(...allWindows.map((window) => window.end));
            bottomTimeTokens.push(
                `<span class="cal-shift-time-changed">${toTimeText(allStart % (24 * 60))}–${toTimeText(allEnd % (24 * 60))}</span>`
            );
        }

        const shiftsHtml = shiftBadges.join('');
        const bottomTimesHtml = bottomTimeTokens.join('');

        let timeOffHtml = '';
        if (day.is_holiday) {
            const type = day.time_off_type || 'other';
            const typeLabelMap = {
                holiday: 'Holiday',
                sickness: 'Sickness',
                vor: 'VOR',
                other: 'Time Off'
            };
            const typeIconMap = {
                holiday: 'fa-umbrella-beach',
                sickness: 'fa-notes-medical',
                vor: 'fa-wrench',
                other: 'fa-user-clock'
            };
            const typeBadgeMap = {
                holiday: 'bg-warning text-dark',
                sickness: 'bg-danger',
                vor: 'bg-secondary',
                other: 'bg-info text-dark'
            };
            const label = typeLabelMap[type] || 'Time Off';
            const icon = typeIconMap[type] || 'fa-user-clock';
            const badgeClass = typeBadgeMap[type] || 'bg-info text-dark';
            timeOffHtml = `<span class="badge ${badgeClass} cal-shift-box cal-timeoff" data-bs-toggle="tooltip" data-bs-placement="top" title="Driver marked as ${escapeDriverCalendarHtml(label)}"><span class="cal-shift-label"><i class="fas ${icon}"></i>OFF</span></span>`;
        }

        const lateStartIconHtml = lateStart
            ? `<span class="cal-adjustment-icon badge-late-start-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeDriverCalendarHtml(`${lateStart.label} at ${lateStart.time}${lateStart.notes ? ` — ${lateStart.notes}` : ''}`)}"><i class="fas fa-hourglass-start"></i></span>`
            : '';
        const earlyFinishIconHtml = earlyFinish
            ? `<span class="cal-adjustment-icon badge-early-finish-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeDriverCalendarHtml(`${earlyFinish.label} at ${earlyFinish.time}${earlyFinish.notes ? ` — ${earlyFinish.notes}` : ''}`)}"><i class="fas fa-hourglass-end"></i></span>`
            : '';

        const contentHtml = `${shiftsHtml}${timeOffHtml}` || '<small class="text-muted">No shift</small>';

        const cellClass = day.is_today ? 'table-warning' : '';

        dayCells.push(`
            <td class="cal-day ${cellClass}">
                <div class="cal-day-header">
                    <div class="fw-bold small">${day.day}</div>
                </div>
                <div class="cal-day-shifts">${contentHtml}</div>
                <div class="cal-day-bottom">
                    <div class="cal-day-bottom-left">${lateStartIconHtml}</div>
                    <div class="cal-day-bottom-center">${bottomTimesHtml}</div>
                    <div class="cal-day-bottom-right">${earlyFinishIconHtml}</div>
                </div>
            </td>
        `);
    });

    while (dayCells.length % 7 !== 0) {
        dayCells.push('<td class="cal-empty"></td>');
    }

    const rows = [];
    for (let i = 0; i < dayCells.length; i += 7) {
        rows.push(`<tr>${dayCells.slice(i, i + 7).join('')}</tr>`);
    }

    body.innerHTML = `
        <div class="holiday-calendar readonly">
            <table class="table table-bordered align-middle mb-0">
                <thead class="table-light">
                    <tr>${weekdays.map((name) => `<th class="text-center">${name}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.join('')}
                </tbody>
            </table>
        </div>
    `;

    if (window.bootstrap && window.bootstrap.Tooltip) {
        body.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
            window.bootstrap.Tooltip.getOrCreateInstance(el);
        });
    }
}

function loadDriverCalendar() {
    if (!driverCalendarState.driverId || !driverCalendarState.monthDate) return;

    const body = document.getElementById('driverCalendarBody');
    const title = document.getElementById('driverCalendarTitle');
    if (title) {
        const displayDriver = driverCalendarState.driverNumber
            ? `#${driverCalendarState.driverNumber} ${driverCalendarState.driverName}`
            : driverCalendarState.driverName;
        title.textContent = `Driver Calendar - ${displayDriver}`;
    }
    if (body) {
        body.innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-spinner fa-spin"></i> Loading calendar...</div>';
    }

    const monthParam = toCalendarMonthParam(driverCalendarState.monthDate);
    fetch(`/driver/${driverCalendarState.driverId}/calendar-data?month=${monthParam}`, {
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then((data) => {
            if (!data.success) throw new Error(data.error || 'Failed to load calendar');
            renderDriverCalendar(data);
        })
        .catch((err) => {
            if (body) {
                body.innerHTML = `<div class="alert alert-danger mb-0">${err.message || 'Error loading calendar.'}</div>`;
            }
        });
}

function initializeDriverCalendarModule() {
    document.getElementById('driverCalendarPrevMonth')?.addEventListener('click', function() {
        if (!driverCalendarState.monthDate) return;
        driverCalendarState.monthDate = new Date(driverCalendarState.monthDate.getFullYear(), driverCalendarState.monthDate.getMonth() - 1, 1);
        loadDriverCalendar();
    });

    document.getElementById('driverCalendarNextMonth')?.addEventListener('click', function() {
        if (!driverCalendarState.monthDate) return;
        driverCalendarState.monthDate = new Date(driverCalendarState.monthDate.getFullYear(), driverCalendarState.monthDate.getMonth() + 1, 1);
        loadDriverCalendar();
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.show-driver-calendar-btn')) {
            return;
        }

        const btn = e.target.closest('.show-driver-calendar-btn');
        const driverId = btn.getAttribute('data-driver-id');
        const driverNumber = btn.getAttribute('data-driver-number') || '';
        const driverName = btn.getAttribute('data-driver-name') || '';

        driverCalendarState.driverId = driverId;
        driverCalendarState.driverNumber = driverNumber;
        driverCalendarState.driverName = driverName;
        driverCalendarState.monthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        loadDriverCalendar();
        new bootstrap.Modal(document.getElementById('driverCalendarModal')).show();
    });
}


/* ===== drivers.custom-timings.js ===== */
/**
 * drivers.custom-timings.js
 * Custom timing panel and form logic for Driver Management
 * Dependencies: shared.core.js, drivers.core.js
 */

function initializeDriverCustomTimingsModule() {
    const deleteModalEl = document.getElementById('deleteModal');
    if (deleteModalEl) {
        deleteModalEl.addEventListener('hidden.bs.modal', function() {
            window.pendingCustomTimingDelete = null;
        });
    }

    const deleteSubmitBtn = document.getElementById('globalDeleteSubmitBtn');
    if (deleteSubmitBtn) {
        deleteSubmitBtn.addEventListener('click', function(e) {
            if (deleteSubmitBtn.type === 'button' && window.pendingCustomTimingDelete) {
                e.preventDefault();
                e.stopPropagation();

                const { timingId, driverId } = window.pendingCustomTimingDelete;
                hideModalById('deleteModal');
                deleteCustomTiming(timingId, () => loadCustomTimings(driverId));
                window.pendingCustomTimingDelete = null;
            }
        });
    }

    const assignmentSelect = document.getElementById('ctFormAssignmentId');
    if (assignmentSelect) {
        assignmentSelect.addEventListener('change', function() {
            renderDayOfCycleMenu(this.value || '', null);
            updateAssignmentCriteriaMutualExclusion('day');
        });
    }

    const dayOfWeekSelect = document.getElementById('ctFormDayOfWeek');
    if (dayOfWeekSelect) {
        dayOfWeekSelect.addEventListener('change', function() {
            updateDayOfWeekModeVisibility();
            updateAssignmentCriteriaMutualExclusion('day');
        });
    }

    const modeRadios = document.querySelectorAll('input[name="day_of_week_mode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            updateDayOfWeekModeFieldsVisibility();
        });
    });

    document.addEventListener('click', function(e) {
        if (e.target.closest('.toggle-custom-timings')) {
            const btn = e.target.closest('.toggle-custom-timings');
            const driverId = btn.getAttribute('data-driver-id');
            const panel = document.getElementById(`custom-timings-panel-${driverId}`);
            if (!panel) return;

            const willOpen = panel.classList.contains('d-none');

            if (willOpen) {
                document.querySelectorAll('.custom-timings-panel').forEach((row) => row.classList.add('d-none'));
                document.querySelectorAll('.assignments-panel').forEach((row) => row.classList.add('d-none'));
                document.querySelectorAll('.toggle-custom-timings').forEach((toggleBtn) => toggleBtn.classList.remove('active'));
                document.querySelectorAll('.assign-pattern-btn').forEach((assignBtn) => assignBtn.classList.remove('active'));
            }

            panel.classList.toggle('d-none', !willOpen);
            btn.classList.toggle('active', willOpen);
            btn.blur();

            const list = panel.querySelector('.custom-timings-list');
            if (willOpen && list && list.querySelector('.fa-spinner')) {
                loadCustomTimings(driverId);
            }
        }

        if (e.target.closest('.add-custom-timing-btn')) {
            const btn = e.target.closest('.add-custom-timing-btn');
            const driverId = btn.getAttribute('data-driver-id');
            const driverNumber = btn.getAttribute('data-driver-number') || '';
            const driverName = btn.getAttribute('data-driver-name');
            openCustomTimingForm(driverId, driverName, driverNumber);
        }

        if (e.target.closest('.edit-custom-timing-inline')) {
            const btn = e.target.closest('.edit-custom-timing-inline');
            const driverId = btn.getAttribute('data-driver-id');
            const timingId = btn.getAttribute('data-timing-id');
            const driverNumber = btn.getAttribute('data-driver-number') || '';
            const driverName = btn.getAttribute('data-driver-name');
            editCustomTiming(driverId, timingId, driverName, driverNumber);
        }

        if (e.target.closest('.delete-custom-timing-inline')) {
            const btn = e.target.closest('.delete-custom-timing-inline');
            const timingId = btn.getAttribute('data-timing-id');
            const driverId = btn.getAttribute('data-driver-id');

            if (typeof window.showGlobalDeleteConfirm === 'function') {
                window.pendingCustomTimingDelete = { timingId, driverId };
                window.showGlobalDeleteConfirm({
                    title: 'Delete Custom Timing',
                    message: 'Are you sure you want to delete this custom timing?',
                    warning: 'This action cannot be undone.',
                    action: 'javascript:void(0);',
                    submitLabel: 'Delete Timing'
                });
            } else {
                deleteCustomTiming(timingId, () => {
                    loadCustomTimings(driverId);
                });
            }
        }
    });

    document.getElementById('customTimingForm')?.addEventListener('submit', function(e) {
        e.preventDefault();
        const driverId = document.getElementById('ctFormDriverId').value;
        const timingId = document.getElementById('ctFormTimingId').value;
        const formData = new FormData(this);

        const url = timingId
            ? `/custom-timing/${timingId}/edit`
            : `/driver/${driverId}/custom-timing/add`;

        fetch(url, {
            method: 'POST',
            body: formData,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        })
        .then(async (r) => {
            let payload = null;
            try {
                payload = await r.json();
            } catch (jsonErr) {
                payload = null;
            }

            if (!r.ok) {
                const errorMessage = payload?.error || `HTTP ${r.status}`;
                throw new Error(errorMessage);
            }

            return payload || { success: false, error: 'Invalid server response.' };
        })
        .then(data => {
            if (data.success) {
                hideModalById('customTimingFormModal');

                loadCustomTimings(driverId);
                showAlertBanner('success', MESSAGES.CUSTOM_TIMING_SAVED);
                DEBUG.log('Custom timing saved', 'info', { driverId });
            } else {
                const errorMsg = data.error || MESSAGES.CUSTOM_TIMING_SAVE_ERROR;
                showAlertBanner('error', errorMsg);
                DEBUG.warn('Save custom timing failed', { driverId, error: errorMsg });
            }
        })
        .catch(err => {
            console.error('Error saving custom timing:', err);
            showAlertBanner('error', MESSAGES.CUSTOM_TIMING_SAVE_ERROR);
            DEBUG.error('Error saving custom timing', { error: err.message, driverId });
        });
    });
}

function loadCustomTimings(driverId) {
    fetch(`/driver/${driverId}/custom-timings/list`, {
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            const list = document.querySelector(`.custom-timings-list[data-driver-id="${driverId}"]`);
            updateDriverPatternTimingIndicators(driverId, data?.timings || []);
            if (data.success && data.timings) {
                if (data.timings.length === 0) {
                    list.innerHTML = '<p class="text-muted text-center py-4">No custom timings set</p>';
                } else {
                    list.innerHTML = `
                        <div class="list-group">
                            ${data.timings.map(t => `
                                    <div class="list-group-item">
                                        ${(() => {
                                            const patternText = t.assignment_name || 'Any Pattern';
                                            const hasSpecificShiftType = Boolean(t.shift_type);
                                            const shiftTiming = hasSpecificShiftType ? shiftTimings[t.shift_type] : null;
                                            const shiftTypeLabel = hasSpecificShiftType
                                                ? (shiftTiming?.label || t.shift_type)
                                                : 'Any';
                                            const shiftTypeBadgeClass = shiftTiming?.badgeColor || 'bg-secondary';
                                            let priority = Number(t.priority ?? 4);
                                            if (!Number.isFinite(priority) || priority < 1) priority = 4;
                                            if (priority > 7) priority = 7;
                                            const priorityBadgeClassMap = {
                                                1: 'bg-danger',
                                                2: 'bg-warning text-dark',
                                                3: 'bg-info text-dark',
                                                4: 'bg-primary',
                                                5: 'bg-success',
                                                6: 'bg-secondary',
                                                7: 'bg-dark'
                                            };
                                            const priorityBadgeClass = priorityBadgeClassMap[priority] || 'bg-primary';
                                            const hasSpecificAssignment = Boolean(t.assignment_name);
                                            const hasShiftOnDay = t.day_of_cycle !== null && Array.isArray(t.day_cycle_shifts) && t.day_cycle_shifts.length > 0;
                                            const hasCycleDay = t.day_of_cycle !== null;
                                            const weekdayLabel = t.day_of_week !== null ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][t.day_of_week] : '';
                                            const hasCustomTimes = Boolean(t.start_time) || Boolean(t.end_time);
                                            const hasOverrideShift = Boolean(t.override_shift);
                                            const isDayOffMode = Boolean(weekdayLabel) && t.override_shift === 'day_off';
                                            const isShiftOverride = Boolean(weekdayLabel) && hasOverrideShift && !isDayOffMode;
                                            const isCustomTimesMode = Boolean(weekdayLabel) && !hasOverrideShift && hasCustomTimes;
                                            const shiftMatchesCycle = !hasSpecificShiftType || !hasCycleDay || !hasShiftOnDay || t.day_cycle_shifts.includes(t.shift_type);
                                            const hasRuleCriteria = hasSpecificShiftType || hasCycleDay || Boolean(weekdayLabel);

                                            let ruleSummaryHtml = '';
                                            if (isDayOffMode) {
                                                ruleSummaryHtml = `
                                                    <div class="mb-2 d-flex align-items-center flex-wrap gap-1 fw-bold">
                                                        <span>Every</span>
                                                        <span class="badge bg-light text-dark border">${weekdayLabel}</span>
                                                        ${hasSpecificShiftType ? `<span>, that is</span><span class="badge ${shiftTypeBadgeClass}">${shiftTypeLabel}</span><span>, set as</span>` : `<span>, set as</span>`}
                                                        <span class="badge bg-secondary">OFF</span><span>.</span>
                                                    </div>
                                                `;
                                            } else if (isShiftOverride) {
                                                const overrideShiftDisplay = getShiftDisplay(t.override_shift);
                                                ruleSummaryHtml = `
                                                    <div class="mb-2 d-flex align-items-center flex-wrap gap-1 fw-bold">
                                                        <span>Every</span>
                                                        <span class="badge bg-light text-dark border">${weekdayLabel}</span>
                                                        ${hasSpecificShiftType ? `<span>, that is</span><span class="badge ${shiftTypeBadgeClass}">${shiftTypeLabel}</span><span>, override to</span>` : `<span>, override to</span>`}
                                                        <span class="d-inline-flex align-items-center gap-0"><span class="badge ${overrideShiftDisplay.badgeColor}">${overrideShiftDisplay.label}</span><span>.</span></span>
                                                    </div>
                                                `;
                                            } else if (isCustomTimesMode) {
                                                const customTimeSentence = (() => {
                                                    const start = t.start_time || '';
                                                    const end = t.end_time || '';
                                                    if (start && end) return 'use custom starting and finishing times';
                                                    if (start) return 'use custom starting time';
                                                    return 'use custom finishing time';
                                                })();
                                                ruleSummaryHtml = `
                                                    <div class="mb-2 d-flex align-items-center flex-wrap gap-1 fw-bold">
                                                        <span>Every</span>
                                                        <span class="badge bg-light text-dark border">${weekdayLabel}</span>
                                                        ${hasSpecificShiftType ? `<span>, that is</span><span class="badge ${shiftTypeBadgeClass}">${shiftTypeLabel}</span><span>, ${customTimeSentence}.</span>` : `<span>, ${customTimeSentence}.</span>`}
                                                    </div>
                                                `;
                                            } else if (hasRuleCriteria) {
                                                ruleSummaryHtml = `
                                                    <div class="mb-2 d-flex align-items-center flex-wrap gap-1 fw-bold">
                                                        <span>Any</span>
                                                        ${hasSpecificShiftType ? `<span class="badge ${shiftTypeBadgeClass}">${shiftTypeLabel}</span>` : ''}
                                                        <span>Shift</span>
                                                        ${weekdayLabel ? `<span>that is on a</span><span class="badge bg-light text-dark border">${weekdayLabel}</span>` : ''}
                                                        ${hasCycleDay ? `<span>${weekdayLabel ? 'and on' : 'on'}</span><span class="badge bg-light text-dark border">Cycle Day ${t.day_of_cycle + 1}</span>` : ''}
                                                        ${hasShiftOnDay
                                                            ? `<span>which is a</span>${t.day_cycle_shifts.map((shiftType) => {
                                                                const display = getShiftDisplay(shiftType);
                                                                return `<span class="badge ${display.badgeColor}">${display.label}</span>`;
                                                            }).join('')}`
                                                            : ''}
                                                    </div>
                                                `;
                                            }

                                            const conflictWarningHtml = hasSpecificShiftType && hasCycleDay && hasShiftOnDay && !shiftMatchesCycle && !isShiftOverride
                                                ? `<div class="mb-2"><span class="badge bg-danger">Conflict: selected shift is not on this cycle day</span></div>`
                                                : '';
                                            const timeText = (() => {
                                                const start = t.start_time || '';
                                                const end = t.end_time || '';
                                                if (start && end) return `Starting ${start} · Finishing ${end}`;
                                                if (start) return `Starting ${start}`;
                                                if (end) return `Finishing ${end}`;
                                                return 'Default time';
                                            })();
                                            const customTimeText = (() => {
                                                const start = t.start_time || '';
                                                const end = t.end_time || '';
                                                if (start && end) return `Starting ${start} · Finishing ${end}`;
                                                if (start) return `Starting ${start}`;
                                                if (end) return `Finishing ${end}`;
                                                return 'Time';
                                            })();
                                            const rightBadgeHtml = isDayOffMode
                                                ? `<span class="badge bg-secondary fs-6 px-3 py-2 me-2">Day Off</span>`
                                                : isShiftOverride
                                                ? `<span class="badge bg-warning text-dark fs-6 px-3 py-2 me-2">Shift Override</span>`
                                                : `<span class="badge bg-info text-dark fs-6 px-3 py-2 me-2">${isCustomTimesMode ? customTimeText : timeText}</span>`;

                                            return `
                                                <div class="d-flex justify-content-between align-items-center mb-2">
                                                    <div class="me-2">
                                                        <span class="badge ${priorityBadgeClass} fs-6 px-3 py-2 rounded-pill">Priority ${priority}</span>
                                                    </div>
                                                    <div class="small" style="flex: 1;">
                                                        <div class="mb-2">
                                                            ${hasSpecificAssignment
                                                                ? `<span><span class="fw-bold me-1">Shifts on Pattern:</span>${patternText}</span>`
                                                                : `<span class="fw-bold">Shifts on Any Pattern</span>`}
                                                        </div>
                                                        ${ruleSummaryHtml}
                                                        ${conflictWarningHtml}
                                                    </div>
                                                    <div class="text-end ms-3 d-flex align-items-center justify-content-end" style="min-width: 320px;">
                                                        ${rightBadgeHtml}
                                                        <div class="btn-group btn-group-sm">
                                                            <button type="button" class="btn btn-sm btn-primary edit-custom-timing-inline" data-driver-id="${driverId}" data-timing-id="${t.id}" data-driver-name="${data.driver_name}" data-driver-number="${(document.querySelector(`.add-custom-timing-btn[data-driver-id="${driverId}"]`)?.getAttribute('data-driver-number') || '').replace(/"/g, '&quot;')}">
                                                                <i class="fas fa-edit"></i>
                                                            </button>
                                                            <button type="button" class="btn btn-sm btn-danger delete-custom-timing-inline" data-driver-id="${driverId}" data-timing-id="${t.id}">
                                                                <i class="fas fa-trash"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                ${t.notes ? `
                                                    <div class="mt-2 pt-2 border-top small">
                                                        <div class="fw-bold mb-1">Notes</div>
                                                        <div>${t.notes}</div>
                                                    </div>
                                                ` : ''}
                                            `;
                                        })()}
                                    </div>
                            `).join('')}
                        </div>
                    `;
                }
            }
        })
        .catch(err => {
            console.error('Error loading custom timings:', err);
            document.querySelector(`.custom-timings-list[data-driver-id="${driverId}"]`).innerHTML = `<p class="text-danger text-center py-4">Error loading timings</p>`;
        });
}

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
        const dayIndex = parseInt(selectedValue);
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
                const dayIndex = parseInt(value);
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


/* ===== drivers.page-init.js ===== */
/**
 * drivers.page-init.js
 * Page bootstrap for Driver Management screen
 */

var driverAssignments = window.driverAssignments || {};
var shiftTimings = window.shiftTimings || {};

function openCustomTimingsPanelFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const driverId = params.get('open_custom_timings_driver');
    if (!driverId) return;

    const button = document.querySelector(`.toggle-custom-timings[data-driver-id="${driverId}"]`);
    if (button) {
        button.click();
    }

    params.delete('open_custom_timings_driver');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
}

document.addEventListener('DOMContentLoaded', function() {
    var driverAssignmentsData = document.getElementById('driverAssignmentsData');
    var shiftTimingsData = document.getElementById('shiftTimingsData');

    var driverAssignmentsJson = driverAssignmentsData ? driverAssignmentsData.textContent : '{}';
    var shiftTimingsJson = shiftTimingsData ? shiftTimingsData.textContent : '{}';

    var parsedDriverAssignments = {};
    var parsedShiftTimings = {};

    try {
        parsedDriverAssignments = JSON.parse(driverAssignmentsJson || '{}');
    } catch (e) {
        parsedDriverAssignments = {};
    }

    try {
        parsedShiftTimings = JSON.parse(shiftTimingsJson || '{}');
    } catch (e) {
        parsedShiftTimings = {};
    }

    window.driverAssignments = parsedDriverAssignments;
    window.shiftTimings = parsedShiftTimings;
    driverAssignments = parsedDriverAssignments;
    shiftTimings = parsedShiftTimings;

    if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function(el) {
            new bootstrap.Tooltip(el);
        });
    }

    if (typeof initializeFormHandlers === 'function') {
        initializeFormHandlers();
    }
    if (typeof initializeEventBindings === 'function') {
        initializeEventBindings();
    }

    openCustomTimingsPanelFromQuery();

    if (typeof initializeDriverCustomTimingsModule === 'function') {
        initializeDriverCustomTimingsModule();
    }

    if (typeof initializeDriverCalendarModule === 'function') {
        initializeDriverCalendarModule();
    }
});

