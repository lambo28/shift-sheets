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
