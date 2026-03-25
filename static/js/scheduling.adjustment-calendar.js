/**
 * scheduling.adjustment-calendar.js
 * Adjustment calendar widget for scheduling.
 */

// ---------------------------------------------------------------------------
// Adjustment calendar widget (single-date picker)
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    let adjCalViewDate = new Date();
    adjCalViewDate.setDate(1);

    let adjSelectedDate = null;
    let adjSelectedDriverId = null;
    let adjDriverShiftData = null;
    let adjSelectedDateAllowsAdjustment = false;
    let adjServerValidationPassed = false;
    let adjValidationTimer = null;

    async function fetchAdjustmentDriverShifts(driverId, monthStr) {
        if (!driverId) {
            adjDriverShiftData = null;
            return;
        }

        try {
            const response = await fetch(`/driver/${driverId}/calendar-data?month=${monthStr}`);
            const data = await response.json();
            if (data.success) {
                adjDriverShiftData = data;
            } else {
                adjDriverShiftData = null;
            }
        } catch (err) {
            console.error('Error fetching adjustment driver shifts:', err);
            adjDriverShiftData = null;
        }
    }

    function getAdjustmentShiftsForDate(dateStr) {
        if (!adjDriverShiftData || !adjDriverShiftData.days) return null;
        return adjDriverShiftData.days.find(day => day.date === dateStr) || null;
    }

    function formatDateISO(d) {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${da}`;
    }

    function getMinimumSelectableDateStr() {
        const now = new Date();
        const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() < 6) {
            minDate.setDate(minDate.getDate() - 1);
        }
        return formatDateISO(minDate);
    }

    function updateAdjustmentDateDisplay() {
        const display = document.getElementById('adjDateDisplay');
        if (!display) return;

        if (!adjSelectedDate) {
            display.textContent = 'Select a driver, then click a date on the calendar.';
            return;
        }

        const parts = adjSelectedDate.split('-');
        const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        display.innerHTML = `<strong>Selected:</strong> ${formatted}`;
    }

    function updateAdjustmentFormInput() {
        const input = document.getElementById('adjDate');
        if (input) input.value = adjSelectedDate || '';

        const saveBtn = document.getElementById('saveAdjustmentBtn');
        const typeValue = (document.getElementById('adjType')?.value || '').trim();
        const timeValue = (document.getElementById('adjTime')?.value || '').trim();
        const requiredComplete = Boolean(adjSelectedDate && typeValue && timeValue);
        if (saveBtn) saveBtn.disabled = !requiredComplete || !adjSelectedDateAllowsAdjustment || !adjServerValidationPassed;
    }

    function clearAdjustmentValidationResult() {
        const resultEl = document.getElementById('adjValidationResult');
        if (!resultEl) return;
        resultEl.style.display = 'none';
        resultEl.innerHTML = '';
    }

    function setAdjustmentValidationResult(level, message) {
        const resultEl = document.getElementById('adjValidationResult');
        if (!resultEl) return;
        resultEl.innerHTML = `<div class="alert alert-${level} mb-0">${message}</div>`;
        resultEl.style.display = '';
    }

    function resetAdjustmentValidationState() {
        adjServerValidationPassed = false;
        clearAdjustmentValidationResult();
        updateAdjustmentFormInput();
    }

    async function runAdjustmentAutoValidation() {
        const typeValue = (document.getElementById('adjType')?.value || '').trim();
        const timeValue = (document.getElementById('adjTime')?.value || '').trim();

        if (!adjSelectedDriverId || !adjSelectedDate || !typeValue || !timeValue || !adjSelectedDateAllowsAdjustment) {
            resetAdjustmentValidationState();
            return;
        }

        try {
            const response = await fetch('/scheduling/adjustment/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    driver_id: adjSelectedDriverId,
                    adjustment_date: adjSelectedDate,
                    adjustment_type: typeValue,
                    adjusted_time: timeValue
                })
            });

            const data = await response.json();

            if (data.success) {
                adjServerValidationPassed = true;
                setAdjustmentValidationResult('success', '<i class="fas fa-check-circle me-1"></i>Adjustment is valid. Click <strong>Save Adjustment</strong> to save.');
            } else {
                adjServerValidationPassed = false;
                const errors = data.errors || [data.error || 'Validation failed.'];
                setAdjustmentValidationResult('danger', `<i class="fas fa-times-circle me-1"></i><strong>Validation failed:</strong> ${errors.join(' ')}`);
            }
        } catch (err) {
            adjServerValidationPassed = false;
            setAdjustmentValidationResult('danger', '<i class="fas fa-times-circle me-1"></i>Could not reach the server. Please try again.');
        }

        updateAdjustmentFormInput();
    }

    function scheduleAdjustmentAutoValidation() {
        resetAdjustmentValidationState();
        if (adjValidationTimer) {
            clearTimeout(adjValidationTimer);
        }
        adjValidationTimer = setTimeout(function () {
            runAdjustmentAutoValidation();
        }, 180);
    }

    function updateAdjustmentShiftStatus() {
        const statusEl = document.getElementById('adjShiftStatus');
        if (!statusEl) return;

        if (!adjSelectedDriverId || !adjSelectedDate) {
            adjSelectedDateAllowsAdjustment = false;
            statusEl.innerHTML = '';
            scheduleAdjustmentAutoValidation();
            return;
        }

        const dayData = getAdjustmentShiftsForDate(adjSelectedDate);
        const shifts = dayData && Array.isArray(dayData.shifts) ? dayData.shifts : [];
        const workingShifts = shifts.filter(shift => shift.shift_type !== 'day_off');
        const nonExtraWorkingShifts = workingShifts.filter(shift => !shift.is_extra);
        const isSplitShiftDay = nonExtraWorkingShifts.length >= 2;

        if (isSplitShiftDay) {
            adjSelectedDateAllowsAdjustment = false;
            const labels = workingShifts.map(shift => shift.label).join(', ');
            statusEl.innerHTML = `<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>Split shift day selected (${labels}). Late starts and early finishes are not used on split shift days.</span>`;
            scheduleAdjustmentAutoValidation();
            return;
        }

        if (workingShifts.length > 0) {
            adjSelectedDateAllowsAdjustment = true;
            statusEl.innerHTML = '';
            scheduleAdjustmentAutoValidation();
            return;
        }

        adjSelectedDateAllowsAdjustment = false;

        if (dayData && dayData.is_holiday) {
            const typeMap = {
                holiday: 'Holiday',
                sickness: 'Sickness',
                vor: 'VOR',
                other: 'Other'
            };
            const reason = typeMap[dayData.time_off_type] || 'Time Off';
            statusEl.innerHTML = `<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>Driver is marked as having time off (${reason}).</span>`;
            scheduleAdjustmentAutoValidation();
            return;
        }

        statusEl.innerHTML = '<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>Driver is marked as Day Off on selected day.</span>';

        scheduleAdjustmentAutoValidation();
    }

    async function renderAdjustmentCalendar() {
        const tbody = document.getElementById('adjCalBody');
        const monthLabel = document.getElementById('adjCalMonthLabel');
        if (!tbody || !monthLabel) return;

        const calendarEl = tbody.closest('.holiday-calendar');
        if (calendarEl) {
            calendarEl.classList.toggle('cal-disabled-state', !adjSelectedDriverId);
        }

        const requiredHint = document.getElementById('adjDriverRequiredHint');
        if (requiredHint) {
            requiredHint.classList.toggle('d-none', Boolean(adjSelectedDriverId));
        }

        disposeTooltipsIn(tbody);

        const year = adjCalViewDate.getFullYear();
        const month = adjCalViewDate.getMonth();
        monthLabel.textContent = adjCalViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        if (adjSelectedDriverId) {
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            await fetchAdjustmentDriverShifts(adjSelectedDriverId, monthStr);
        } else {
            adjDriverShiftData = null;
        }

        const todayStr = formatDateISO(new Date());
        const minSelectableDateStr = getMinimumSelectableDateStr();

        if (adjSelectedDate && adjSelectedDate < minSelectableDateStr) {
            adjSelectedDate = null;
            updateAdjustmentDateDisplay();
            updateAdjustmentShiftStatus();
            updateAdjustmentFormInput();
        }

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

            const dateStr = formatDateISO(new Date(year, month, dayCounter));
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === adjSelectedDate;

            let classes = 'cal-day';
            if (isToday) classes += ' cal-today';
            if (isSelected) classes += ' cal-selected';

            const dayData = getAdjustmentShiftsForDate(dateStr);

            if (adjSelectedDriverId) {
                const dayShifts = (dayData && dayData.shifts) || [];
                const dayWorkingShifts = dayShifts.filter(function (s) { return s.shift_type !== 'day_off'; });
                const dayNonExtraShifts = dayWorkingShifts.filter(function (s) { return !s.is_extra; });
                if (dateStr < minSelectableDateStr || !dayWorkingShifts.length || dayNonExtraShifts.length >= 2) {
                    classes += ' cal-disabled';
                }
            }

            const visuals = buildUnifiedCalendarCellContent(dayData);
            const inlineRowHtml = `${visuals.contentHtml}${visuals.extraShiftIconHtml}${visuals.lateStartIconHtml}${visuals.earlyFinishIconHtml}`;

            html += `<td class="${classes}" data-date="${dateStr}">
                <div class="cal-day-header">
                    <div class="fw-bold small">${dayCounter}</div>
                </div>
                <div class="cal-day-inline ${visuals.inlineSizeClass || ''}">${inlineRowHtml}</div>
            </td>`;
            dayCounter++;
        }

        html += '</tr>';
        tbody.innerHTML = html;

        tbody.querySelectorAll('td.cal-day').forEach(function (td) {
            td.addEventListener('click', function () {
                if (!adjSelectedDriverId) return;
                if (td.classList.contains('cal-disabled')) return;
                adjSelectedDate = td.getAttribute('data-date');
                updateAdjustmentDateDisplay();
                updateAdjustmentShiftStatus();
                updateAdjustmentFormInput();
                renderAdjustmentCalendar();
            });
        });

        if (window.bootstrap && window.bootstrap.Tooltip) {
            tbody.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
                window.bootstrap.Tooltip.getOrCreateInstance(el);
            });
        }
    }

    function initAdjustmentCalendar() {
        const body = document.getElementById('adjCalBody');
        if (!body) return;

        const prev = document.getElementById('adjCalPrev');
        const next = document.getElementById('adjCalNext');
        const clearBtn = document.getElementById('clearAdjSelection');
        const driverSelect = document.getElementById('adjDriverSelect');

        if (prev) {
            prev.addEventListener('click', function () {
                adjCalViewDate.setMonth(adjCalViewDate.getMonth() - 1);
                renderAdjustmentCalendar();
            });
        }

        if (next) {
            next.addEventListener('click', function () {
                adjCalViewDate.setMonth(adjCalViewDate.getMonth() + 1);
                renderAdjustmentCalendar();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                const driverSelectEl = document.getElementById('adjDriverSelect');
                const typeSelectEl = document.getElementById('adjType');
                const timeEl = document.getElementById('adjTime');
                const notesEl = document.getElementById('adjNotes');

                if (driverSelectEl) {
                    driverSelectEl.value = '';
                }
                if (typeSelectEl) {
                    typeSelectEl.value = '';
                    typeSelectEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (timeEl) {
                    timeEl.value = '';
                }
                if (notesEl) {
                    notesEl.value = '';
                }

                adjSelectedDriverId = null;
                adjDriverShiftData = null;
                adjSelectedDate = null;
                resetAdjustmentValidationState();
                updateAdjustmentDateDisplay();
                updateAdjustmentShiftStatus();
                updateAdjustmentFormInput();
                renderAdjustmentCalendar();
            });
        }

        if (driverSelect) {
            driverSelect.addEventListener('change', function () {
                adjSelectedDriverId = this.value ? parseInt(this.value, 10) : null;
                adjSelectedDate = null;
                resetAdjustmentValidationState();
                updateAdjustmentDateDisplay();
                updateAdjustmentShiftStatus();
                updateAdjustmentFormInput();
                renderAdjustmentCalendar();
            });
        }

        const adjTypeEl = document.getElementById('adjType');
        if (adjTypeEl) {
            adjTypeEl.addEventListener('change', function () {
                scheduleAdjustmentAutoValidation();
            });
        }

        const adjTimeEl = document.getElementById('adjTime');
        if (adjTimeEl) {
            adjTimeEl.addEventListener('change', function () {
                scheduleAdjustmentAutoValidation();
            });
            adjTimeEl.addEventListener('input', function () {
                scheduleAdjustmentAutoValidation();
            });
        }

        updateAdjustmentDateDisplay();
        updateAdjustmentShiftStatus();
        updateAdjustmentFormInput();
        renderAdjustmentCalendar();
    }

    window.schedulingAdjustmentCalendar = {
        init: initAdjustmentCalendar
    };
})();
