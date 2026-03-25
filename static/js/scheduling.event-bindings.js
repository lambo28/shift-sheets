/**
 * scheduling.event-bindings.js
 * Event handlers and UI wiring for the Scheduling section.
 */

(function () {
    'use strict';

    function initStyledTypeDropdown(selectId, menuId, displayId, placeholder, config = {}) {
        const selectEl = document.getElementById(selectId);
        const menuEl = document.getElementById(menuId);
        const displayEl = document.getElementById(displayId);
        if (!selectEl || !menuEl || !displayEl) return;

        const autoSelectFirst = Boolean(config.autoSelectFirst);

        const selectOptions = Array.from(selectEl.options || []);
        const selectableOptions = selectOptions.filter(function (opt) {
            return String(opt.value || '').trim() !== '';
        });

        menuEl.innerHTML = selectableOptions.map(function (opt) {
            const value = opt.value;
            const label = opt.textContent || value;
            const icon = opt.dataset.icon || 'fas fa-circle';
            const badgeClass = opt.dataset.badge || 'bg-secondary';
            return `<li>
                <a class="dropdown-item scheduling-type-option" href="#" data-value="${value}" data-label="${label}" data-icon="${icon}" data-badge="${badgeClass}">
                    <span class="badge ${badgeClass} schedule-dropdown-icon-badge me-2"><i class="${icon} scheduling-type-white-icon"></i></span>
                    ${label}
                </a>
            </li>`;
        }).join('');

        function renderSelected() {
            const currentValue = String(selectEl.value || '').trim();
            let selected = selectableOptions.find(function (opt) {
                return opt.value === currentValue;
            });

            if (!selected && autoSelectFirst && selectableOptions.length) {
                const fallbackValue = selectableOptions[0].value;
                if (currentValue !== fallbackValue) {
                    selectEl.value = fallbackValue;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    return;
                }
                selected = selectableOptions[0];
            }

            if (!selected) {
                displayEl.innerHTML = `<span class="badge bg-light text-dark border schedule-dropdown-icon-badge me-1"><i class="fas fa-minus text-secondary"></i></span>${placeholder}`;
                return;
            }

            const icon = selected.dataset.icon || 'fas fa-circle';
            const badgeClass = selected.dataset.badge || 'bg-secondary';
            const label = selected.textContent || selected.value;
            displayEl.innerHTML = `<span class="badge ${badgeClass} schedule-dropdown-icon-badge me-1"><i class="${icon} scheduling-type-white-icon"></i></span>${label}`;
        }

        menuEl.querySelectorAll('.scheduling-type-option').forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                const value = this.getAttribute('data-value') || '';
                selectEl.value = value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                renderSelected();
            });
        });

        if (autoSelectFirst && !String(selectEl.value || '').trim() && selectableOptions.length) {
            selectEl.value = selectableOptions[0].value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        selectEl.addEventListener('change', renderSelected);
        renderSelected();
    }

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

        initStyledTypeDropdown('timeOffType', 'timeOffTypeMenu', 'timeOffTypeDisplay', '— Select type —', { autoSelectFirst: true });
        initStyledTypeDropdown('adjType', 'adjTypeMenu', 'adjTypeDisplay', '— Select type —', { autoSelectFirst: true });
        initStyledTypeDropdown('closureType', 'closureTypeMenu', 'closureTypeDisplay', '— Select type —', { autoSelectFirst: true });
        initStyledTypeDropdown('editTimeOffType', 'editTimeOffTypeMenu', 'editTimeOffTypeDisplay', '— Select type —', { autoSelectFirst: true });
        initStyledTypeDropdown('editAdjType', 'editAdjTypeMenu', 'editAdjTypeDisplay', '— Select type —', { autoSelectFirst: true });

        // Update time input hint when adjustment type changes
        const adjTypeSelect = document.getElementById('adjType');
        if (adjTypeSelect) {
            adjTypeSelect.addEventListener('change', updateAdjTimeLabel);
        }

        // Swap auto-validation when required fields are complete
        ['swapDriver', 'swapGiveUpDate', 'swapWorkDate', 'swapWorkShiftType', 'swapApprovedBy'].forEach(function (id) {
            const el = document.getElementById(id);
            if (!el) return;

            el.addEventListener('change', scheduleSwapAutoValidation);
            if (id === 'swapApprovedBy') {
                el.addEventListener('input', scheduleSwapAutoValidation);
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
        initSchoolTermRangeCalendar();
        initSchoolClosureSingleCalendar();

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

        if (termForm) {
            termForm.addEventListener('submit', function (e) {
                const startValue = termStartInput ? String(termStartInput.value || '').trim() : '';
                const endValue = termEndInput ? String(termEndInput.value || '').trim() : '';

                if (!startValue || !endValue) {
                    e.preventDefault();
                    showPageAlert('Please select a start and end date from the School Term calendar.', 'danger');
                    return;
                }

                if (isWeekendDate(startValue) || isWeekendDate(endValue)) {
                    e.preventDefault();
                    showPageAlert('Weekend dates are not allowed in School Calendar entries.', 'danger');
                }
            });
        }

        if (closureForm) {
            closureForm.addEventListener('submit', function (e) {
                const closureValue = closureDateInput ? String(closureDateInput.value || '').trim() : '';
                if (!closureValue) {
                    e.preventDefault();
                    showPageAlert('Please select a school closed day from the calendar.', 'danger');
                    return;
                }

                if (isWeekendDate(closureValue)) {
                    e.preventDefault();
                    showPageAlert('Weekend dates are not allowed in School Calendar entries.', 'danger');
                }
            });
        }
    }

    function initSchoolClosureSingleCalendar() {
        const tbody = document.getElementById('closureCalBody');
        const monthLabel = document.getElementById('closureCalMonthLabel');
        const prevBtn = document.getElementById('closureCalPrev');
        const nextBtn = document.getElementById('closureCalNext');
        const clearBtn = document.getElementById('clearClosureSelection');
        const closureInput = document.getElementById('closureDate');
        const display = document.getElementById('closureDateDisplay');
        const saveBtn = document.getElementById('saveClosureBtn');

        if (!tbody || !monthLabel || !closureInput) return;

        const viewDate = new Date();
        viewDate.setDate(1);

        let selectedDate = closureInput.value || null;

        function toISO(dateObj) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function isWeekendISO(dateStr) {
            if (!dateStr) return false;
            const parsed = new Date(`${dateStr}T00:00:00`);
            if (Number.isNaN(parsed.getTime())) return false;
            const day = parsed.getDay();
            return day === 0 || day === 6;
        }

        function syncInput() {
            closureInput.value = selectedDate || '';
            if (saveBtn) saveBtn.disabled = !selectedDate;
        }

        function updateDisplay() {
            if (!display) return;
            if (!selectedDate) {
                display.textContent = 'Click a date on the calendar.';
                return;
            }
            const selectedObj = new Date(`${selectedDate}T00:00:00`);
            const selectedFormatted = selectedObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            display.innerHTML = `<strong>Selected:</strong> ${selectedFormatted}`;
        }

        function selectDate(dateStr) {
            if (isWeekendISO(dateStr)) return;
            selectedDate = dateStr;
            syncInput();
            updateDisplay();
            render();
        }

        function render() {
            const year = viewDate.getFullYear();
            const month = viewDate.getMonth();
            monthLabel.textContent = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

            const firstDay = new Date(year, month, 1);
            let startOffset = firstDay.getDay() - 1;
            if (startOffset < 0) startOffset = 6;

            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

            let html = '<tr>';
            let dayCounter = 1;

            for (let i = 0; i < totalCells; i++) {
                if (i % 7 === 0 && i > 0) html += '</tr><tr>';

                if (i < startOffset || dayCounter > daysInMonth) {
                    html += '<td class="cal-empty"></td>';
                    continue;
                }

                const dateStr = toISO(new Date(year, month, dayCounter));
                const weekend = isWeekendISO(dateStr);
                const isSelected = dateStr === selectedDate;

                let classes = 'cal-day';
                if (weekend) classes += ' cal-disabled';
                if (isSelected) classes += ' cal-selected';

                html += `<td class="${classes}" data-date="${dateStr}">
                    <div class="cal-day-header">
                        <div class="fw-bold small">${dayCounter}</div>
                    </div>
                </td>`;
                dayCounter++;
            }

            html += '</tr>';
            tbody.innerHTML = html;

            tbody.querySelectorAll('td.cal-day').forEach(function (cell) {
                cell.addEventListener('click', function () {
                    if (cell.classList.contains('cal-disabled')) return;
                    const pickedDate = cell.getAttribute('data-date');
                    if (!pickedDate) return;
                    selectDate(pickedDate);
                });
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                viewDate.setMonth(viewDate.getMonth() - 1);
                render();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                viewDate.setMonth(viewDate.getMonth() + 1);
                render();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                selectedDate = null;
                syncInput();
                updateDisplay();
                render();
            });
        }

        syncInput();
        updateDisplay();
        render();
    }

    function initSchoolTermRangeCalendar() {
        const tbody = document.getElementById('termCalBody');
        const monthLabel = document.getElementById('termCalMonthLabel');
        const prevBtn = document.getElementById('termCalPrev');
        const nextBtn = document.getElementById('termCalNext');
        const clearBtn = document.getElementById('clearTermSelection');
        const startInput = document.getElementById('termStartDate');
        const endInput = document.getElementById('termEndDate');
        const display = document.getElementById('termDateDisplay');
        const saveBtn = document.getElementById('saveTermBtn');

        if (!tbody || !monthLabel || !startInput || !endInput) return;

        const viewDate = new Date();
        viewDate.setDate(1);

        let startDate = startInput.value || null;
        let endDate = endInput.value || null;

        if (startDate && !endDate) {
            endDate = startDate;
        }

        function toISO(dateObj) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function isWeekendISO(dateStr) {
            if (!dateStr) return false;
            const parsed = new Date(`${dateStr}T00:00:00`);
            if (Number.isNaN(parsed.getTime())) return false;
            const day = parsed.getDay();
            return day === 0 || day === 6;
        }

        function isInRange(dateStr) {
            if (!startDate) return false;
            if (!endDate) return dateStr === startDate;
            return dateStr >= startDate && dateStr <= endDate;
        }

        function updateDisplayText() {
            if (!display) return;

            if (!startDate) {
                display.textContent = 'Click a start date, then click an end date on the calendar.';
                return;
            }

            const startObj = new Date(`${startDate}T00:00:00`);
            const startFormatted = startObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

            if (!endDate || endDate === startDate) {
                display.innerHTML = `<strong>Selected:</strong> ${startFormatted} (1 day)`;
                return;
            }

            const endObj = new Date(`${endDate}T00:00:00`);
            const endFormatted = endObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const dayCount = Math.floor((endObj - startObj) / (1000 * 60 * 60 * 24)) + 1;
            display.innerHTML = `<strong>Range:</strong> ${startFormatted} to ${endFormatted} (${dayCount} days)`;
        }

        function syncInputs() {
            startInput.value = startDate || '';
            endInput.value = endDate || startDate || '';
            if (saveBtn) saveBtn.disabled = !startDate;
        }

        function selectDate(dateStr) {
            if (isWeekendISO(dateStr)) return;

            if (!startDate || (startDate && endDate)) {
                startDate = dateStr;
                endDate = null;
            } else {
                endDate = dateStr;
                if (endDate < startDate) {
                    const temp = startDate;
                    startDate = endDate;
                    endDate = temp;
                }
            }

            updateDisplayText();
            syncInputs();
            render();
        }

        function render() {
            const year = viewDate.getFullYear();
            const month = viewDate.getMonth();

            monthLabel.textContent = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

            const firstDay = new Date(year, month, 1);
            let startOffset = firstDay.getDay() - 1;
            if (startOffset < 0) startOffset = 6;

            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

            let html = '<tr>';
            let dayCounter = 1;

            for (let i = 0; i < totalCells; i++) {
                if (i % 7 === 0 && i > 0) html += '</tr><tr>';

                if (i < startOffset || dayCounter > daysInMonth) {
                    html += '<td class="cal-empty"></td>';
                    continue;
                }

                const dateStr = toISO(new Date(year, month, dayCounter));
                const weekend = isWeekendISO(dateStr);
                const selectedStart = dateStr === startDate;
                const selectedEnd = dateStr === endDate;
                const inRange = isInRange(dateStr);

                let classes = 'cal-day';
                if (weekend) classes += ' cal-disabled';
                if (selectedStart || selectedEnd) classes += ' cal-selected';
                if (inRange && startDate && endDate && startDate !== endDate) classes += ' cal-in-range';

                html += `<td class="${classes}" data-date="${dateStr}">
                    <div class="cal-day-header">
                        <div class="fw-bold small">${dayCounter}</div>
                    </div>
                </td>`;
                dayCounter++;
            }

            html += '</tr>';
            tbody.innerHTML = html;

            tbody.querySelectorAll('td.cal-day').forEach(function (cell) {
                cell.addEventListener('click', function () {
                    if (cell.classList.contains('cal-disabled')) return;
                    const pickedDate = cell.getAttribute('data-date');
                    if (!pickedDate) return;
                    selectDate(pickedDate);
                });
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                viewDate.setMonth(viewDate.getMonth() - 1);
                render();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                viewDate.setMonth(viewDate.getMonth() + 1);
                render();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                startDate = null;
                endDate = null;
                updateDisplayText();
                syncInputs();
                render();
            });
        }

        updateDisplayText();
        syncInputs();
        render();
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

    let swapAutoValidationTimer = null;

    function areSwapRequiredFieldsComplete() {
        const driverId = (document.getElementById('swapDriver')?.value || '').trim();
        const giveUpDate = (document.getElementById('swapGiveUpDate')?.value || '').trim();
        const workDate = (document.getElementById('swapWorkDate')?.value || '').trim();
        const workShiftType = (document.getElementById('swapWorkShiftType')?.value || '').trim();
        const approvedBy = (document.getElementById('swapApprovedBy')?.value || '').trim();
        return Boolean(driverId && giveUpDate && workDate && workShiftType && approvedBy);
    }

    function scheduleSwapAutoValidation() {
        resetSwapValidation();

        if (swapAutoValidationTimer) {
            clearTimeout(swapAutoValidationTimer);
        }

        if (!areSwapRequiredFieldsComplete()) {
            return;
        }

        swapAutoValidationTimer = setTimeout(function () {
            validateSwapForm();
        }, 180);
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
        if (typeEl) {
            typeEl.value = type;
            typeEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
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
    const editTimeOffTypeEl = document.getElementById('editTimeOffType');
    if (editTimeOffTypeEl) {
        editTimeOffTypeEl.value = timeOffType || 'holiday';
        editTimeOffTypeEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
