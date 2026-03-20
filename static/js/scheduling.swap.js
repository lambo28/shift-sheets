/**
 * scheduling.swap.js
 * Swap validation and dual-calendar swap selection widget.
 */

// ---------------------------------------------------------------------------
// Swap validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate the day-swap form via AJAX and show results.
 * Returns a Promise resolving to true if valid, false otherwise.
 */
async function validateSwapForm() {
    const driverId = document.getElementById('swapDriver').value;
    const giveUpDate = document.getElementById('swapGiveUpDate').value;
    const workDate = document.getElementById('swapWorkDate').value;
    const workShiftType = document.getElementById('swapWorkShiftType').value;

    const resultDiv = document.getElementById('swapValidationResult');
    const confirmBtn = document.getElementById('confirmSwapBtn');
    if (!resultDiv || !confirmBtn) return false;

    resultDiv.style.display = 'none';
    confirmBtn.disabled = true;

    if (!driverId || !giveUpDate || !workDate || !workShiftType) {
        resultDiv.innerHTML = '<div class="alert alert-warning mb-0"><i class="fas fa-exclamation-triangle me-2"></i>Please fill in all fields before validating.</div>';
        resultDiv.style.display = '';
        return false;
    }

    try {
        const response = await fetch('/scheduling/swap/validate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                driver_id: driverId,
                give_up_date: giveUpDate,
                work_date: workDate,
                work_shift_type: workShiftType
            })
        });

        const data = await response.json();

        if (data.success) {
            resultDiv.innerHTML = '<div class="alert alert-success mb-0"><i class="fas fa-check-circle me-2"></i>Swap is valid. Click <strong>Confirm Swap</strong> to save.</div>';
            confirmBtn.disabled = false;
        } else {
            const errList = (data.errors || [data.error || 'Unknown error'])
                .map(function (e) { return `<li>${escapeHtml(e)}</li>`; })
                .join('');
            resultDiv.innerHTML = `<div class="alert alert-danger mb-0"><i class="fas fa-times-circle me-2"></i><strong>Validation failed:</strong><ul class="mb-0 mt-1">${errList}</ul></div>`;
            confirmBtn.disabled = true;
        }
    } catch (err) {
        resultDiv.innerHTML = '<div class="alert alert-danger mb-0"><i class="fas fa-times-circle me-2"></i>Could not reach the server. Please try again.</div>';
        confirmBtn.disabled = true;
    }

    resultDiv.style.display = '';
    return !document.getElementById('confirmSwapBtn').disabled;
}

// ---------------------------------------------------------------------------
// Swap calendar widget (dual-calendar two-date picker)
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    let swapGiveUpCalViewDate = new Date();
    swapGiveUpCalViewDate.setDate(1);

    let swapWorkCalViewDate = new Date();
    swapWorkCalViewDate.setDate(1);

    let swapSelectedDriverId = null;
    let swapDriverShiftData = null;
    let swapGiveUpDate = null;
    let swapWorkDate = null;

    function swapFormatDateISO(dateValue) {
        const year = dateValue.getFullYear();
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async function fetchSwapDriverShifts(driverId, monthStr) {
        if (!driverId) {
            swapDriverShiftData = null;
            return;
        }

        try {
            const response = await fetch(`/driver/${driverId}/calendar-data?month=${monthStr}`);
            const data = await response.json();
            swapDriverShiftData = data.success ? data : null;
        } catch (err) {
            console.error('Error fetching swap driver shifts:', err);
            swapDriverShiftData = null;
        }
    }

    function getSwapDayData(dateStr) {
        if (!swapDriverShiftData || !swapDriverShiftData.days) return null;
        return swapDriverShiftData.days.find(day => day.date === dateStr) || null;
    }

    function isSwapDayWorkingDay(dateStr) {
        const dayData = getSwapDayData(dateStr);
        if (!dayData) return false;
        if (dayData.is_holiday) return false;
        return dayData.shifts && dayData.shifts.some(shift => shift.shift_type !== 'day_off');
    }

    function isSwapDayOffDay(dateStr) {
        const dayData = getSwapDayData(dateStr);
        if (!dayData) return false;
        if (dayData.is_holiday) return false;
        const hasWorkingShift = dayData.shifts && dayData.shifts.some(shift => shift.shift_type !== 'day_off');
        return !hasWorkingShift || !!dayData.has_swap_work;
    }

    function updateSwapSelectionDisplay() {
        const display = document.getElementById('swapDateSelectionDisplay');
        if (!display) return;

        if (!swapSelectedDriverId) {
            display.textContent = 'Select a driver, then click a worked day (left) and an off day (right).';
            return;
        }

        if (!swapGiveUpDate) {
            display.innerHTML = '<strong>Step 1:</strong> Select the worked day to give up (left).';
            return;
        }

        if (!swapWorkDate) {
            const giveUp = new Date(`${swapGiveUpDate}T00:00:00`).toLocaleDateString('en-GB');
            display.innerHTML = `<strong>Give up:</strong> ${giveUp} · <strong>Step 2:</strong> Select the off day to work (right).`;
            return;
        }

        const giveUp = new Date(`${swapGiveUpDate}T00:00:00`).toLocaleDateString('en-GB');
        const work = new Date(`${swapWorkDate}T00:00:00`).toLocaleDateString('en-GB');
        display.innerHTML = `<strong>Give up:</strong> ${giveUp} · <strong>Work:</strong> ${work}`;
    }

    function syncSwapHiddenFields() {
        const giveUpInput = document.getElementById('swapGiveUpDate');
        const workInput = document.getElementById('swapWorkDate');

        if (giveUpInput) {
            giveUpInput.value = swapGiveUpDate || '';
            giveUpInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (workInput) {
            workInput.value = swapWorkDate || '';
            workInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function renderCalendarGrid(tbody, year, month, selectedDate, phase, todayStr) {
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

            const dateStr = swapFormatDateISO(new Date(year, month, dayCounter));
            const dayData = getSwapDayData(dateStr);
            const visuals = buildUnifiedCalendarCellContent(dayData);
            const inlineRowHtml = `${visuals.contentHtml}${visuals.extraShiftIconHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;
            const hasWorkingShift = !!(dayData?.shifts && dayData.shifts.some(shift => shift.shift_type !== 'day_off'));
            const hasBaseWorkingShift = !!dayData?.has_base_working_shift;
            const isHoliday = !!dayData?.is_holiday;
            const isSwapUsed = !!(dayData?.has_swap_give_up || dayData?.has_swap_work);
            const hasSwapWork = !!dayData?.has_swap_work;
            const isOffDay = !isHoliday && !hasWorkingShift;

            let classes = 'cal-day';
            let isClickable = true;
            let isWorkingDayForPhase = hasWorkingShift;
            const isMirroredSelection = (
                (phase === 'giveup' && !!swapWorkDate && dateStr === swapWorkDate)
                || (phase === 'work' && !!swapGiveUpDate && dateStr === swapGiveUpDate)
            );

            if (phase === 'giveup') {
                isWorkingDayForPhase = hasWorkingShift || hasBaseWorkingShift;
                isClickable = !isHoliday && (isMirroredSelection || (isWorkingDayForPhase && !isSwapUsed));
            } else if (phase === 'work') {
                isClickable = !isHoliday && (isMirroredSelection || (isOffDay && !isSwapUsed));
            }

            if (dateStr === todayStr) classes += ' cal-today';
            if (dateStr === selectedDate) classes += ' cal-selected';
            if (!isClickable && swapSelectedDriverId) classes += ' cal-disabled';
            if (dayData?.has_swap_give_up) classes += ' cal-has-swap-giveup';
            if (dayData?.has_swap_work) classes += ' cal-has-swap-work';

            if (phase === 'giveup' && dateStr === swapGiveUpDate) classes += ' cal-swap-giveup';
            if (phase === 'work' && dateStr === swapWorkDate) classes += ' cal-swap-work';

            html += `<td class="${classes}" data-date="${dateStr}" data-working-day="${isWorkingDayForPhase ? '1' : '0'}" data-off-day="${isOffDay ? '1' : '0'}" data-swap-used="${isSwapUsed ? '1' : '0'}" data-has-swap-work="${hasSwapWork ? '1' : '0'}" ${!isClickable ? 'style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                <div class="cal-day-header">
                    <div class="fw-bold small">${dayCounter}</div>
                </div>
                <div class="cal-day-inline">${inlineRowHtml}</div>
            </td>`;

            dayCounter++;
        }

        html += '</tr>';
        tbody.innerHTML = html;

        tbody.querySelectorAll('td.cal-day').forEach(function (td) {
            td.addEventListener('click', function () {
                if (!swapSelectedDriverId) return;
                if (td.classList.contains('cal-disabled')) return;
                const dateStr = td.getAttribute('data-date');
                const dayMeta = {
                    isWorkingDay: td.getAttribute('data-working-day') === '1',
                    isOffDay: td.getAttribute('data-off-day') === '1',
                    isSwapUsed: td.getAttribute('data-swap-used') === '1',
                    hasSwapWork: td.getAttribute('data-has-swap-work') === '1',
                };
                if (phase === 'giveup') {
                    selectGiveUpDate(dateStr, dayMeta);
                } else if (phase === 'work') {
                    selectWorkDate(dateStr, dayMeta);
                }
            });
        });

        if (window.bootstrap && window.bootstrap.Tooltip) {
            tbody.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
                window.bootstrap.Tooltip.getOrCreateInstance(el);
            });
        }
    }

    async function renderGiveUpCalendar() {
        const tbody = document.getElementById('swapGiveUpCalBody');
        const monthLabel = document.getElementById('swapGiveUpCalMonthLabel');
        if (!tbody || !monthLabel) return;

        disposeTooltipsIn(tbody);

        const year = swapGiveUpCalViewDate.getFullYear();
        const month = swapGiveUpCalViewDate.getMonth();
        monthLabel.textContent = swapGiveUpCalViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        if (swapSelectedDriverId) {
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            await fetchSwapDriverShifts(swapSelectedDriverId, monthStr);
        } else {
            swapDriverShiftData = null;
        }

        const todayStr = swapFormatDateISO(new Date());
        renderCalendarGrid(tbody, year, month, swapGiveUpDate, 'giveup', todayStr);
    }

    async function renderWorkCalendar() {
        const tbody = document.getElementById('swapWorkCalBody');
        const monthLabel = document.getElementById('swapWorkCalMonthLabel');
        if (!tbody || !monthLabel) return;

        disposeTooltipsIn(tbody);

        const year = swapWorkCalViewDate.getFullYear();
        const month = swapWorkCalViewDate.getMonth();
        monthLabel.textContent = swapWorkCalViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        if (swapSelectedDriverId) {
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            await fetchSwapDriverShifts(swapSelectedDriverId, monthStr);
        } else {
            swapDriverShiftData = null;
        }

        const todayStr = swapFormatDateISO(new Date());
        renderCalendarGrid(tbody, year, month, swapWorkDate, 'work', todayStr);
    }

    function selectGiveUpDate(dateStr, dayMeta = null) {
        if (dateStr === swapGiveUpDate) {
            swapGiveUpDate = null;
        } else {
            const isMirroredSelection = !!swapWorkDate && dateStr === swapWorkDate;
            const validWorking = dayMeta
                ? (isMirroredSelection || (dayMeta.isWorkingDay && !dayMeta.isSwapUsed))
                : (isMirroredSelection || isSwapDayWorkingDay(dateStr));
            if (!validWorking) {
                alert('You can only select a worked day that the driver has a shift on.');
                return;
            }
            swapGiveUpDate = dateStr;
        }

        updateSwapSelectionDisplay();
        syncSwapHiddenFields();
        renderGiveUpCalendar();
        renderWorkCalendar();
    }

    function selectWorkDate(dateStr, dayMeta = null) {
        if (dateStr === swapWorkDate) {
            swapWorkDate = null;
        } else {
            const isMirroredSelection = !!swapGiveUpDate && dateStr === swapGiveUpDate;
            const swapUsed = dayMeta ? dayMeta.isSwapUsed : false;
            const validOff = dayMeta
                ? (isMirroredSelection || (dayMeta.isOffDay && !dayMeta.isSwapUsed))
                : (isMirroredSelection || isSwapDayOffDay(dateStr));
            if (!validOff) {
                if (swapUsed) {
                    alert('This date is already swapped. Pick a non-swapped off day, or select the same date as the give-up side.');
                } else {
                    alert('You can only select an off day that is not a holiday.');
                }
                return;
            }
            swapWorkDate = dateStr;
        }

        updateSwapSelectionDisplay();
        syncSwapHiddenFields();
        renderGiveUpCalendar();
        renderWorkCalendar();
    }

    function initSwapCalendar() {
        const giveUpBody = document.getElementById('swapGiveUpCalBody');
        const workBody = document.getElementById('swapWorkCalBody');
        if (!giveUpBody || !workBody) return;

        // Give-up calendar navigation
        const giveUpPrev = document.getElementById('swapGiveUpCalPrev');
        const giveUpNext = document.getElementById('swapGiveUpCalNext');

        if (giveUpPrev) {
            giveUpPrev.addEventListener('click', function () {
                swapGiveUpCalViewDate.setMonth(swapGiveUpCalViewDate.getMonth() - 1);
                renderGiveUpCalendar();
            });
        }

        if (giveUpNext) {
            giveUpNext.addEventListener('click', function () {
                swapGiveUpCalViewDate.setMonth(swapGiveUpCalViewDate.getMonth() + 1);
                renderGiveUpCalendar();
            });
        }

        // Work calendar navigation
        const workPrev = document.getElementById('swapWorkCalPrev');
        const workNext = document.getElementById('swapWorkCalNext');

        if (workPrev) {
            workPrev.addEventListener('click', function () {
                swapWorkCalViewDate.setMonth(swapWorkCalViewDate.getMonth() - 1);
                renderWorkCalendar();
            });
        }

        if (workNext) {
            workNext.addEventListener('click', function () {
                swapWorkCalViewDate.setMonth(swapWorkCalViewDate.getMonth() + 1);
                renderWorkCalendar();
            });
        }

        // Clear selection
        const clearBtn = document.getElementById('clearSwapSelection');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                swapGiveUpDate = null;
                swapWorkDate = null;
                updateSwapSelectionDisplay();
                syncSwapHiddenFields();
                renderGiveUpCalendar();
                renderWorkCalendar();
            });
        }

        // Driver selection
        const driverSelect = document.getElementById('swapDriver');
        if (driverSelect) {
            driverSelect.addEventListener('change', function () {
                swapSelectedDriverId = this.value ? parseInt(this.value, 10) : null;
                swapGiveUpDate = null;
                swapWorkDate = null;
                updateSwapSelectionDisplay();
                syncSwapHiddenFields();
                renderGiveUpCalendar();
                renderWorkCalendar();
            });
        }

        const swapShiftMeta = {};
        let selectedPrimarySwapShift = null;

        document.querySelectorAll('.swap-shift-option').forEach(function(link) {
            const shiftType = link.getAttribute('data-shift-type');
            if (!shiftType) return;
            swapShiftMeta[shiftType] = {
                shiftType: shiftType,
                parentShiftType: link.getAttribute('data-parent-shift-type') || '',
                color: link.getAttribute('data-color') || 'bg-primary',
                icon: link.getAttribute('data-icon') || 'fas fa-clock',
                label: link.getAttribute('data-label') || shiftType
            };
        });

        function isSwapSubShift(shiftType) {
            return !!(swapShiftMeta[shiftType] && swapShiftMeta[shiftType].parentShiftType);
        }

        function getSwapSecondarySubShifts(primaryShiftType) {
            if (!isSwapSubShift(primaryShiftType)) {
                return [];
            }
            return Object.values(swapShiftMeta).filter(function(meta) {
                return meta.shiftType !== primaryShiftType && !!meta.parentShiftType;
            });
        }

        function syncSwapShiftTypeHidden() {
            const hiddenInput = document.getElementById('swapWorkShiftType');
            if (!hiddenInput) return;

            const selected = [];
            if (selectedPrimarySwapShift && selectedPrimarySwapShift.shiftType) {
                selected.push(selectedPrimarySwapShift.shiftType);
            }

            const secondarySelect = document.getElementById('swapSecondShiftType');
            const secondaryValue = secondarySelect ? String(secondarySelect.value || '').trim() : '';
            if (secondaryValue) {
                selected.push(secondaryValue);
            }

            hiddenInput.value = selected.join(',');
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function renderSwapShiftTypeDisplay() {
            const displaySpan = document.getElementById('swapWorkShiftTypeDisplay');
            if (!displaySpan) return;

            const badges = [];
            if (selectedPrimarySwapShift) {
                badges.push('<span class="badge ' + selectedPrimarySwapShift.color + ' p-2 me-1"><i class="' + selectedPrimarySwapShift.icon + '"></i></span>' + selectedPrimarySwapShift.label);
            }

            const secondarySelect = document.getElementById('swapSecondShiftType');
            const secondaryValue = secondarySelect ? String(secondarySelect.value || '').trim() : '';
            if (secondaryValue && swapShiftMeta[secondaryValue]) {
                const secondaryMeta = swapShiftMeta[secondaryValue];
                badges.push('<span class="badge ' + secondaryMeta.color + ' p-2 me-1"><i class="' + secondaryMeta.icon + '"></i></span>' + secondaryMeta.label);
            }

            if (!badges.length) {
                displaySpan.innerHTML = '— Select shift type —';
                return;
            }
            displaySpan.innerHTML = badges.join(' ');
        }

        function renderSwapSecondaryShiftOptions() {
            const wrapper = document.getElementById('swapSecondShiftWrapper');
            const secondarySelect = document.getElementById('swapSecondShiftType');
            if (!wrapper || !secondarySelect) return;

            if (!selectedPrimarySwapShift || !isSwapSubShift(selectedPrimarySwapShift.shiftType)) {
                secondarySelect.innerHTML = '<option value="">None</option>';
                secondarySelect.value = '';
                wrapper.classList.add('d-none');
                return;
            }

            const siblings = getSwapSecondarySubShifts(selectedPrimarySwapShift.shiftType);
            if (!siblings.length) {
                secondarySelect.innerHTML = '<option value="">None</option>';
                secondarySelect.value = '';
                wrapper.classList.add('d-none');
                return;
            }

            let options = '<option value="">None</option>';
            siblings.forEach(function(meta) {
                options += '<option value="' + meta.shiftType + '">' + meta.label + '</option>';
            });
            secondarySelect.innerHTML = options;
            secondarySelect.value = '';
            wrapper.classList.remove('d-none');
        }

        const secondarySelect = document.getElementById('swapSecondShiftType');
        if (secondarySelect) {
            secondarySelect.addEventListener('change', function() {
                syncSwapShiftTypeHidden();
                renderSwapShiftTypeDisplay();
            });
        }

        document.querySelectorAll('.swap-shift-option').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const shiftType = this.getAttribute('data-shift-type');
                if (!shiftType || !swapShiftMeta[shiftType]) return;

                selectedPrimarySwapShift = swapShiftMeta[shiftType];

                renderSwapSecondaryShiftOptions();
                syncSwapShiftTypeHidden();
                renderSwapShiftTypeDisplay();
            });
        });

        updateSwapSelectionDisplay();
        syncSwapHiddenFields();
        renderGiveUpCalendar();
        renderWorkCalendar();
    }

    window.schedulingSwapCalendar = {
        init: initSwapCalendar
    };
})();
