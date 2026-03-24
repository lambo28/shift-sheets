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

        const driver = result.driver || {};
        const cells = row.querySelectorAll('td');
        if (cells.length >= 5) {
            cells[0].innerHTML = buildDriverNumberHtml(driver.formatted_driver_number);
            cells[1].innerHTML = buildDriverNameHtml(driver.formatted_name);
            cells[2].innerHTML = buildVehicleBadgeHtml(driver);
            cells[3].innerHTML = buildAttributeBadgesHtml(driver);
            cells[4].innerHTML = buildPatternHtml(
                result.current_assignment,
                result.future_assignments
            );
        }

        syncDriverActionButtons(row, driver, result.current_assignment);
        syncDriverPanelButtons(driverId, driver, result.current_assignment);

        // Update assignment history data
        driverAssignments[driverId] = result.assignments || [];

        // Recompute custom timing indicators on refreshed pattern badges
        refreshPatternIndicatorsForDriver(driverId);
        updateDriverSummaryStats(result.summary_stats);
        initializeTooltipsWithin(row);
    } catch (error) {
        console.error('Error refreshing driver data:', error);
    }
}

function initializeTooltipsWithin(root) {
    if (typeof bootstrap === 'undefined' || typeof bootstrap.Tooltip !== 'function' || !root) {
        return;
    }

    root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
        bootstrap.Tooltip.getOrCreateInstance(el);
    });
}

function buildDriverNumberHtml(formattedDriverNumber) {
    return `<span class="badge bg-primary fs-6">${formattedDriverNumber || ''}</span>`;
}

function buildDriverNameHtml(formattedName) {
    return `<strong>${formattedName || ''}</strong>`;
}

function buildVehicleBadgeHtml(driver) {
    const carType = driver.car_type || '';
    const badgeClass = {
        'Standard': 'success',
        'Estate': 'info',
        'XL Estate': 'warning',
    }[carType] || 'secondary';
    const electricIcon = driver.electric_vehicle
        ? '&nbsp;&nbsp;<i class="fas fa-bolt" data-bs-toggle="tooltip" data-bs-placement="top" title="Electric Vehicle"></i>'
        : '';

    return `<span class="badge bg-${badgeClass}">${carType}${electricIcon}</span>`;
}

function buildAttributeBadgesHtml(driver) {
    const badges = [];

    if (driver.school_badge) {
        badges.push('<span class="badge bg-warning mb-1"><i class="fas fa-school"></i> School Badge</span>');
    }
    if (driver.pet_friendly) {
        badges.push('<span class="badge bg-success mb-1"><i class="fas fa-paw"></i> Pet Friendly</span>');
    }
    if (driver.assistance_guide_dogs_exempt) {
        badges.push('<span class="badge bg-info mb-1"><i class="fas fa-eye"></i> No Assistance Dogs</span>');
    }

    if (badges.length === 0) {
        badges.push('<span class="text-muted">-</span>');
    }

    return `<div class="d-flex flex-column">${badges.join('')}</div>`;
}

function syncDriverActionButtons(row, driver, currentAssignment) {
    const editButton = row.querySelector('.edit-driver-btn');
    if (editButton) {
        editButton.setAttribute('data-driver-number', driver.driver_number || '');
        editButton.setAttribute('data-driver-name', driver.name || '');
        editButton.setAttribute('data-car-type', driver.car_type || '');
        editButton.setAttribute('data-electric-vehicle', driver.electric_vehicle ? '1' : '0');
        editButton.setAttribute('data-school-badge', driver.school_badge ? '1' : '0');
        editButton.setAttribute('data-pet-friendly', driver.pet_friendly ? '1' : '0');
        editButton.setAttribute('data-assistance-guide-dogs-exempt', driver.assistance_guide_dogs_exempt ? '1' : '0');
    }

    const deleteButton = row.querySelector('.delete-driver-btn');
    if (deleteButton) {
        deleteButton.setAttribute('data-driver-name', driver.formatted_name || '');
    }

    const assignButton = row.querySelector('.assign-pattern-btn');
    if (assignButton) {
        syncDriverMetaButton(assignButton, driver, currentAssignment);
    }

    const customTimingsButton = row.querySelector('.toggle-custom-timings');
    if (customTimingsButton) {
        customTimingsButton.setAttribute('data-driver-number', driver.formatted_driver_number || '');
        customTimingsButton.setAttribute('data-driver-name', driver.formatted_name || '');
    }

    const calendarButton = row.querySelector('.show-driver-calendar-btn');
    if (calendarButton) {
        calendarButton.setAttribute('data-driver-number', driver.formatted_driver_number || '');
        calendarButton.setAttribute('data-driver-name', driver.formatted_name || '');
    }
}

function syncDriverPanelButtons(driverId, driver, currentAssignment) {
    const addAssignmentButton = document.querySelector(`.add-assignment-btn[data-driver-id="${driverId}"]`);
    if (addAssignmentButton) {
        syncDriverMetaButton(addAssignmentButton, driver, currentAssignment);
    }

    const addCustomTimingButton = document.querySelector(`.add-custom-timing-btn[data-driver-id="${driverId}"]`);
    if (addCustomTimingButton) {
        addCustomTimingButton.setAttribute('data-driver-number', driver.formatted_driver_number || '');
        addCustomTimingButton.setAttribute('data-driver-name', driver.formatted_name || '');
    }
}

function syncDriverMetaButton(button, driver, currentAssignment) {
    button.setAttribute('data-driver-number', driver.formatted_driver_number || '');
    button.setAttribute('data-driver-name', driver.formatted_name || '');

    if (currentAssignment && !currentAssignment.end_date) {
        button.setAttribute('data-current-pattern', currentAssignment.pattern_name || '');
        button.setAttribute('data-current-start', currentAssignment.start_date || '');
    } else {
        button.removeAttribute('data-current-pattern');
        button.removeAttribute('data-current-start');
    }
}

function updateDriverSummaryStats(summaryStats) {
    if (!summaryStats || typeof summaryStats !== 'object') {
        return;
    }

    const statContainer = document.getElementById('driverSummaryStats');
    syncDriversEmptyState(summaryStats.total || 0);

    if (!statContainer) {
        return;
    }

    Object.entries(summaryStats).forEach(([key, value]) => {
        const valueEl = statContainer.querySelector(`[data-driver-stat-value="${key}"]`);
        if (valueEl) {
            valueEl.textContent = String(value);
        }
    });
}

function syncDriversEmptyState(totalDrivers = null) {
    const tableSection = document.getElementById('driversTableSection');
    const statContainer = document.getElementById('driverSummaryStats');
    const emptyState = document.getElementById('driversEmptyState');

    if (!tableSection && !emptyState) {
        return;
    }

    const driverCount = totalDrivers ?? document.querySelectorAll('tr[data-driver-id]').length;
    const hasDrivers = driverCount > 0;

    if (tableSection) {
        tableSection.classList.toggle('d-none', !hasDrivers);
    }
    if (statContainer) {
        statContainer.classList.toggle('d-none', !hasDrivers);
    }
    if (emptyState) {
        emptyState.classList.toggle('d-none', hasDrivers);
    }
}

function buildDriverRowHtml(driver, currentAssignment, futureAssignments, customTimingPatternIds = []) {
    const affectedPatternIds = Array.isArray(customTimingPatternIds) ? customTimingPatternIds : [];
    return `
        <tr data-driver-id="${driver.id}">
            <td>${buildDriverNumberHtml(driver.formatted_driver_number)}</td>
            <td>${buildDriverNameHtml(driver.formatted_name)}</td>
            <td>${buildVehicleBadgeHtml(driver)}</td>
            <td>${buildAttributeBadgesHtml(driver)}</td>
            <td>${buildPatternHtml(currentAssignment, futureAssignments, affectedPatternIds)}</td>
            <td>${buildDriverActionsHtml(driver, currentAssignment)}</td>
        </tr>
        <tr id="assignments-panel-${driver.id}" class="assignments-panel d-none">
            <td colspan="7" class="p-0">
                <div class="bg-light border-top p-3">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="mb-0"><i class="fas fa-calendar-alt"></i> Pattern Assignments</h6>
                        <button type="button" class="btn btn-sm btn-primary add-assignment-btn"
                            data-driver-id="${driver.id}"
                            data-driver-number="${driver.formatted_driver_number || ''}"
                            data-driver-name="${driver.formatted_name || ''}"
                            ${buildCurrentPatternAttributes(currentAssignment)}>
                            <i class="fas fa-plus"></i> Add Assignment
                        </button>
                    </div>
                    <div class="assignments-list" data-driver-id="${driver.id}">
                        <p class="text-muted text-center py-4"><i class="fas fa-spinner fa-spin"></i> Loading...</p>
                    </div>
                </div>
            </td>
        </tr>
        <tr id="custom-timings-panel-${driver.id}" class="custom-timings-panel d-none">
            <td colspan="7" class="p-0">
                <div class="bg-light border-top p-3">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="mb-0"><i class="fas fa-clock"></i> Custom Timings</h6>
                        <button type="button" class="btn btn-sm btn-primary add-custom-timing-btn"
                            data-driver-id="${driver.id}"
                            data-driver-number="${driver.formatted_driver_number || ''}"
                            data-driver-name="${driver.formatted_name || ''}">
                            <i class="fas fa-plus"></i> Add Timing
                        </button>
                    </div>
                    <div class="custom-timings-list" data-driver-id="${driver.id}">
                        <p class="text-muted text-center py-4"><i class="fas fa-spinner fa-spin"></i> Loading...</p>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function buildCurrentPatternAttributes(currentAssignment) {
    if (!currentAssignment || currentAssignment.end_date) {
        return '';
    }

    return `data-current-pattern="${escapeHtml(currentAssignment.pattern_name || '')}" data-current-start="${escapeHtml(currentAssignment.start_date || '')}"`;
}

function buildDriverActionsHtml(driver, currentAssignment) {
    return `
        <div class="btn-group" role="group">
            <button type="button"
                    class="btn btn-sm btn-primary edit-driver-btn"
                    title="Edit Driver"
                    data-driver-id="${driver.id}"
                    data-driver-number="${escapeHtml(driver.driver_number || '')}"
                    data-driver-name="${escapeHtml(driver.name || '')}"
                    data-car-type="${escapeHtml(driver.car_type || '')}"
                    data-electric-vehicle="${driver.electric_vehicle ? '1' : '0'}"
                    data-school-badge="${driver.school_badge ? '1' : '0'}"
                    data-pet-friendly="${driver.pet_friendly ? '1' : '0'}"
                    data-assistance-guide-dogs-exempt="${driver.assistance_guide_dogs_exempt ? '1' : '0'}">
                <i class="fas fa-edit"></i>
            </button>
            <button type="button"
                class="btn btn-sm btn-info assign-pattern-btn"
                title="Assign Pattern"
                data-driver-id="${driver.id}"
                data-driver-number="${escapeHtml(driver.formatted_driver_number || '')}"
                data-driver-name="${escapeHtml(driver.formatted_name || '')}"
                ${buildCurrentPatternAttributes(currentAssignment)}>
                <i class="fas fa-calendar"></i>
            </button>
            <button type="button"
                class="btn btn-sm btn-warning toggle-custom-timings"
                title="Custom Timings"
                data-driver-id="${driver.id}"
                data-driver-number="${escapeHtml(driver.formatted_driver_number || '')}"
                data-driver-name="${escapeHtml(driver.formatted_name || '')}">
                <i class="fas fa-clock"></i>
            </button>
            <button type="button"
                class="btn btn-sm btn-success show-driver-calendar-btn"
                title="Driver Calendar"
                data-driver-id="${driver.id}"
                data-driver-number="${escapeHtml(driver.formatted_driver_number || '')}"
                data-driver-name="${escapeHtml(driver.formatted_name || '')}">
                <i class="fas fa-calendar-alt"></i>
            </button>
            <button type="button" class="btn btn-sm btn-danger delete-driver-btn"
                    data-driver-id="${driver.id}"
                    data-driver-name="${escapeHtml(driver.formatted_name || '')}"
                    title="Delete Driver">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
}

function insertDriverRow(driver, currentAssignment, futureAssignments, assignments = [], customTimingPatternIds = []) {
    const tableBody = document.querySelector('table tbody');
    if (!tableBody || !driver || !driver.id) {
        return false;
    }

    const wrapper = document.createElement('tbody');
    wrapper.innerHTML = buildDriverRowHtml(driver, currentAssignment, futureAssignments, customTimingPatternIds).trim();
    const newRows = Array.from(wrapper.children);
    const existingMainRows = Array.from(tableBody.querySelectorAll('tr[data-driver-id]'));
    const sortValue = getDriverSortValue(driver.driver_number);

    let insertBeforeRow = null;
    for (const row of existingMainRows) {
        const rowEditButton = row.querySelector('.edit-driver-btn');
        const existingNumber = rowEditButton ? rowEditButton.getAttribute('data-driver-number') : '';
        if (sortValue < getDriverSortValue(existingNumber)) {
            insertBeforeRow = row;
            break;
        }
    }

    newRows.forEach((newRow) => {
        tableBody.insertBefore(newRow, insertBeforeRow);
    });

    driverAssignments[String(driver.id)] = assignments || [];
    driverAssignments[driver.id] = assignments || [];
    newRows.forEach((row) => initializeTooltipsWithin(row));
    return true;
}

function removeDriverRow(driverId) {
    const mainRow = document.querySelector(`tr[data-driver-id="${driverId}"]`);
    const assignmentsRow = document.getElementById(`assignments-panel-${driverId}`);
    const customTimingsRow = document.getElementById(`custom-timings-panel-${driverId}`);

    if (!mainRow) {
        return false;
    }

    if (assignmentsRow) assignmentsRow.remove();
    if (customTimingsRow) customTimingsRow.remove();
    mainRow.remove();
    delete driverAssignments[String(driverId)];
    delete driverAssignments[driverId];
    return true;
}

function getDriverSortValue(driverNumber) {
    const raw = String(driverNumber || '');
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
        return parsed;
    }
    return Number.MAX_SAFE_INTEGER;
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
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
function buildPatternHtml(currentAssignment, futureAssignments, customTimingPatternIds = []) {
    const affectedPatternIds = Array.isArray(customTimingPatternIds)
        ? customTimingPatternIds.map((id) => String(id))
        : [];

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
            <span class="badge bg-success border border-white ms-1 px-1 py-0 custom-timing-indicator ${affectedPatternIds.includes(String(currentAssignment.pattern_id || '')) ? '' : 'd-none'}" title="Affected by custom timing">
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
            <span class="badge bg-success border border-white ms-1 px-1 py-0 custom-timing-indicator ${affectedPatternIds.includes(String(assignment.pattern_id || '')) ? '' : 'd-none'}" title="Affected by custom timing">
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
