/**
 * scheduling.event-bindings.js
 * Event handlers and UI wiring for the Scheduling section.
 */

(function () {
    'use strict';

    function showPageAlert(message, level = 'danger') {
        if (typeof window.showAlertBanner === 'function') {
            window.showAlertBanner(level, message, true, 4000);
            return;
        }

        const main = document.querySelector('main');
        if (!main) return;

        const alert = document.createElement('div');
        alert.className = `alert alert-${level} alert-dismissible fade show`;
        alert.setAttribute('role', 'alert');
        alert.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
        main.prepend(alert);
    }

    // -----------------------------------------------------------------------
    // Initialise calendar widget once DOM is ready
    // -----------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function () {
        if (window.schedulingCalendar) {
            window.schedulingCalendar.init();
        }
        if (window.schedulingAdjustmentCalendar) {
            window.schedulingAdjustmentCalendar.init();
        }
        if (window.schedulingSwapCalendar) {
            window.schedulingSwapCalendar.init();
        }

        // Update time input hint when adjustment type changes
        const adjTypeSelect = document.getElementById('adjType');
        if (adjTypeSelect) {
            adjTypeSelect.addEventListener('change', updateAdjTimeLabel);
        }

        // Swap validate button
        const validateBtn = document.getElementById('validateSwapBtn');
        if (validateBtn) {
            validateBtn.addEventListener('click', function () {
                validateSwapForm();
            });
        }

        // Re-invalidate when swap fields change (so user must re-validate)
        ['swapDriver', 'swapGiveUpDate', 'swapWorkDate', 'swapWorkShiftType'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', resetSwapValidation);
            }
        });

        // Edit adjustment buttons
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.edit-adj-btn');
            if (!btn) return;
            openEditAdjustmentModal(btn);
        });

        // Restore active tab from sessionStorage to preserve tab after form submission
        restoreActiveTab();

        initSchoolCalendarWeekendValidation();

        // Activate tab from URL hash
        const hash = window.location.hash;
        if (hash) {
            const tabTrigger = document.querySelector(`[data-bs-target="${hash}"]`);
            if (tabTrigger) {
                const bsTab = bootstrap.Tab.getOrCreateInstance(tabTrigger);
                bsTab.show();
            }
        }

        initDriverBlockToggleButtons();
    });

    function isWeekendDate(dateValue) {
        if (!dateValue) return false;
        const parsed = new Date(`${dateValue}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return false;
        const day = parsed.getDay();
        return day === 0 || day === 6;
    }

    function setWeekendValidity(inputEl, message) {
        if (!inputEl) return;
        if (isWeekendDate(inputEl.value)) {
            inputEl.setCustomValidity(message);
        } else {
            inputEl.setCustomValidity('');
        }
    }

    function initSchoolCalendarWeekendValidation() {
        const termForm = document.querySelector('form[action="/scheduling/term/add"]');
        const closureForm = document.querySelector('form[action="/scheduling/school-closure/add"]');

        const termStartInput = document.getElementById('termStartDate');
        const termEndInput = document.getElementById('termEndDate');
        const closureDateInput = document.getElementById('closureDate');

        if (termStartInput) {
            termStartInput.addEventListener('change', function () {
                setWeekendValidity(termStartInput, 'Start date cannot be Saturday or Sunday.');
                termStartInput.reportValidity();
            });
        }

        if (termEndInput) {
            termEndInput.addEventListener('change', function () {
                setWeekendValidity(termEndInput, 'End date cannot be Saturday or Sunday.');
                termEndInput.reportValidity();
            });
        }

        if (closureDateInput) {
            closureDateInput.addEventListener('change', function () {
                setWeekendValidity(closureDateInput, 'Closure date cannot be Saturday or Sunday.');
                closureDateInput.reportValidity();
            });
        }

        if (termForm) {
            termForm.addEventListener('submit', function (e) {
                setWeekendValidity(termStartInput, 'Start date cannot be Saturday or Sunday.');
                setWeekendValidity(termEndInput, 'End date cannot be Saturday or Sunday.');

                if ((termStartInput && !termStartInput.checkValidity()) || (termEndInput && !termEndInput.checkValidity())) {
                    e.preventDefault();
                    termStartInput && termStartInput.reportValidity();
                    termEndInput && termEndInput.reportValidity();
                    showPageAlert('Weekend dates are not allowed in School Calendar entries.', 'danger');
                }
            });
        }

        if (closureForm) {
            closureForm.addEventListener('submit', function (e) {
                setWeekendValidity(closureDateInput, 'Closure date cannot be Saturday or Sunday.');

                if (closureDateInput && !closureDateInput.checkValidity()) {
                    e.preventDefault();
                    closureDateInput.reportValidity();
                    showPageAlert('Weekend dates are not allowed in School Calendar entries.', 'danger');
                }
            });
        }
    }

    function initDriverBlockToggleButtons() {
        const buttons = document.querySelectorAll('.toggle-driver-blocks-btn');
        buttons.forEach(function (btn) {
            const targetSelector = btn.getAttribute('data-bs-target');
            const icon = btn.querySelector('i');
            if (!targetSelector || !icon) return;

            btn.addEventListener('click', function () {
                btn.blur();
            });

            const targets = document.querySelectorAll(targetSelector);
            if (!targets.length) return;

            const updateIcon = function (expanded) {
                icon.classList.toggle('fa-chevron-down', !expanded);
                icon.classList.toggle('fa-chevron-up', expanded);
                btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            };

            updateIcon(Array.from(targets).some(el => el.classList.contains('show')));

            targets.forEach(function (target) {
                target.addEventListener('shown.bs.collapse', function () {
                    updateIcon(true);
                });
                target.addEventListener('hidden.bs.collapse', function () {
                    const anyOpen = Array.from(targets).some(el => el.classList.contains('show'));
                    updateIcon(anyOpen);
                });
            });
        });
    }

    // -----------------------------------------------------------------------
    // Adjustment type label
    // -----------------------------------------------------------------------
    function updateAdjTimeLabel() {
        const adjType = document.getElementById('adjType');
        const label = document.getElementById('adjTimeLabel');
        const hint = document.getElementById('adjTimeHint');
        if (!adjType) return;
        if (adjType.value === 'late_start') {
            if (label) label.textContent = 'New Start Time';
            if (hint) hint.textContent = 'Enter the new (later) start time.';
        } else if (adjType.value === 'early_finish') {
            if (label) label.textContent = 'New Finish Time';
            if (hint) hint.textContent = 'Enter the new (earlier) finish time.';
        } else {
            if (label) label.textContent = 'Adjusted Time';
            if (hint) hint.textContent = 'Enter the new start or finish time.';
        }
    }

    // -----------------------------------------------------------------------
    // Swap validation reset
    // -----------------------------------------------------------------------
    function resetSwapValidation() {
        const resultDiv = document.getElementById('swapValidationResult');
        const confirmBtn = document.getElementById('confirmSwapBtn');
        if (resultDiv) resultDiv.style.display = 'none';
        if (confirmBtn) confirmBtn.disabled = true;
    }

    // -----------------------------------------------------------------------
    // Edit adjustment modal
    // -----------------------------------------------------------------------
    function openEditAdjustmentModal(btn) {
        const adjId = btn.getAttribute('data-adj-id');
        const driverId = btn.getAttribute('data-driver-id');
        const date = btn.getAttribute('data-date');
        const type = btn.getAttribute('data-type');
        const time = btn.getAttribute('data-time');
        const notes = btn.getAttribute('data-notes');

        const form = document.getElementById('editAdjustmentForm');
        if (!form) return;

        form.action = `/scheduling/adjustment/${adjId}/edit`;

        const dateEl = document.getElementById('editAdjDate');
        const typeEl = document.getElementById('editAdjType');
        const timeEl = document.getElementById('editAdjTime');
        const notesEl = document.getElementById('editAdjNotes');

        if (dateEl) dateEl.value = date;
        if (typeEl) typeEl.value = type;
        if (timeEl) timeEl.value = time;
        if (notesEl) notesEl.value = notes;

        const modal = document.getElementById('editAdjustmentModal');
        if (modal) {
            bootstrap.Modal.getOrCreateInstance(modal).show();
        }
    }

    // -----------------------------------------------------------------------
    // Persist active tab across page reloads (form submissions redirect back)
    // -----------------------------------------------------------------------
    function restoreActiveTab() {
        // Remove from sessionStorage immediately after reading so that only one
        // restore happens per form-submission redirect (not on subsequent page loads).
        const stored = sessionStorage.getItem('schedulingActiveTab');
        if (!stored) return;
        sessionStorage.removeItem('schedulingActiveTab');
        const tabTrigger = document.querySelector(`[data-bs-target="${stored}"]`);
        if (tabTrigger) {
            const bsTab = bootstrap.Tab.getOrCreateInstance(tabTrigger);
            bsTab.show();
        }
    }

    // Save the current tab before form submission so we can restore it
    document.addEventListener('submit', function (e) {
        const form = e.target;
        if (!form) return;
        const activeTab = document.querySelector('.scheduling-tabs .nav-link.active');
        if (activeTab) {
            const target = activeTab.getAttribute('data-bs-target');
            if (target) {
                sessionStorage.setItem('schedulingActiveTab', target);
            }
        }
    });

    // Edit Holiday modal
    const editHolidayForm = document.getElementById('editHolidayForm');
    if (editHolidayForm) {
        editHolidayForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const startDate = document.getElementById('editHolStartDate').value;
            const endDate = document.getElementById('editHolEndDate').value;
            const timeOffType = document.getElementById('editTimeOffType').value;
            const notes = document.getElementById('editHolNotes').value;
            const driverId = document.getElementById('editHolDriverId').value;
            const oldStart = document.getElementById('editHolStartDate').dataset.oldStart;
            const oldEnd = document.getElementById('editHolEndDate').dataset.oldEnd;
            
            // Update time off
            fetch('/scheduling/holiday/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    driver_id: driverId,
                    old_start_date: oldStart,
                    old_end_date: oldEnd,
                    new_start_date: startDate,
                    new_end_date: endDate,
                    time_off_type: timeOffType,
                    notes: notes
                })
            }).then(response => response.json()).then(data => {
                if (data.success) {
                    const bootstrapModal = bootstrap.Modal.getInstance(document.getElementById('editHolidayModal'));
                    if (bootstrapModal) bootstrapModal.hide();
                    location.reload();
                } else {
                    showPageAlert(data.message || 'Failed to update time off', 'warning');
                }
            }).catch(err => {
                console.error('Error:', err);
                showPageAlert('Could not update time off. Please try again.', 'danger');
            });
        });
    }

})();

/**
 * Load holiday group data into edit modal
 */
function loadHolidayGroupForEdit(driverId, startDate, endDate, timeOffType, notes) {
    document.getElementById('editHolDriverId').value = driverId;
    document.getElementById('editHolStartDate').value = startDate;
    document.getElementById('editHolEndDate').value = endDate;
    document.getElementById('editHolStartDate').dataset.oldStart = startDate;
    document.getElementById('editHolEndDate').dataset.oldEnd = endDate;
    document.getElementById('editTimeOffType').value = timeOffType || 'holiday';
    document.getElementById('editHolNotes').value = notes;
    
    // Fetch driver name
    fetch('/api/driver/' + driverId)
        .then(response => response.json())
        .then(data => {
            if (data.formatted_name) {
                document.getElementById('editHolDriver').value = data.formatted_name;
            }
        })
        .catch(err => console.error('Error fetching driver:', err));
}
