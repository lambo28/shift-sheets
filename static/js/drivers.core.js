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
    } catch (error) {
        console.error('Error refreshing driver data:', error);
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

        html += `<span class="badge ${hasEndDate ? 'bg-warning text-dark' : 'bg-success'} mb-1">
            ${currentAssignment.pattern_name}
        </span>`;

        const startDateFormatted = new Date(currentAssignment.start_date).toLocaleDateString('en-GB');
        const endDateFormatted = currentAssignment.end_date
            ? new Date(currentAssignment.end_date).toLocaleDateString('en-GB')
            : null;

        html += '<small class="text-muted">';
        if (hasEndDate) {
            const daysToEnd = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
            if (daysToEnd === 0) {
                html += `Ending Today · Started ${startDateFormatted}`;
            } else if (daysToEnd === 1) {
                html += `Ending Tomorrow · Started ${startDateFormatted}`;
            } else {
                html += `Ending ${endDateFormatted} · Started ${startDateFormatted}`;
            }
        } else {
            html += `Active · Since ${startDateFormatted}`;
        }
        html += '</small>';
    }

    for (const assignment of futureAssignments) {
        const startDate = new Date(assignment.start_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        startDate.setHours(0, 0, 0, 0);
        const daysUntilStart = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));

        html += `<span class="badge bg-primary mb-1">${assignment.pattern_name}</span>`;
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

    if (assignments.length === 0) {
        historySection.style.display = 'none';
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
                <button type="button" class="btn btn-sm btn-outline-primary edit-assignment-btn"
                        data-assignment-id="${assignment.id}" data-driver-id="${driverId}" title="Edit Assignment">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger delete-assignment-btn" 
                        data-assignment-id="${assignment.id}" data-pattern-name="${assignment.patternName}" 
                        data-driver-id="${driverId}" title="Delete Assignment">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        } else if (assignment.status === 'active' && !assignment.hasEndDate) {
            html += `
                <button type="button" class="btn btn-sm btn-outline-primary edit-assignment-btn"
                        data-assignment-id="${assignment.id}" data-driver-id="${driverId}" title="Edit Assignment">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-warning end-assignment-btn" 
                        data-assignment-id="${assignment.id}" data-pattern-name="${assignment.patternName}" 
                        data-driver-id="${driverId}" title="End Assignment">
                    <i class="fas fa-stop"></i> End
                </button>
            `;
        } else if (assignment.status === 'active' && assignment.hasEndDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const endDate = new Date(assignment.endDate);
            endDate.setHours(0, 0, 0, 0);
            const endingToday = endDate.getTime() === today.getTime();

            html += `
                <button type="button" class="btn btn-sm btn-outline-primary edit-assignment-btn"
                        data-assignment-id="${assignment.id}" data-driver-id="${driverId}" title="Edit Assignment">
                    <i class="fas fa-edit"></i>
                </button>
            `;

            if (!endingToday) {
                html += `
                    <button type="button" class="btn btn-sm btn-outline-warning end-assignment-btn" 
                            data-assignment-id="${assignment.id}" data-pattern-name="${assignment.patternName}" 
                            data-driver-id="${driverId}" title="End Assignment Now">
                        <i class="fas fa-stop"></i> End
                    </button>
                `;
            }
        } else if (assignment.status === 'ended') {
            html += `
                <button type="button" class="btn btn-sm btn-outline-danger delete-assignment-btn" 
                        data-assignment-id="${assignment.id}" data-pattern-name="${assignment.patternName}" 
                        data-driver-id="${driverId}" title="Delete Assignment">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }

        html += '</div></td></tr>';
    });

    html += '</tbody></table></div>';
    historyContent.innerHTML = html;
    historySection.style.display = 'block';
}
