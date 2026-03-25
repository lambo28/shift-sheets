/**
 * scheduling.holiday-calendar.js
 * Holiday calendar widget for scheduling.
 */

// ---------------------------------------------------------------------------
// Holiday calendar widget
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    /** @type {Date} Currently displayed month/year in the calendar */
    let calViewDate = new Date();
    calViewDate.setDate(1);

    /** @type {string|null} Start date of range selection in 'YYYY-MM-DD' format */
    let calStartDate = null;

    /** @type {string|null} End date of range selection in 'YYYY-MM-DD' format */
    let calEndDate = null;

    /** @type {Set<string>} Dates already saved as holidays (YYYY-MM-DD), populated by server on render */
    const existingHolidayDates = new Set();

    /** @type {Object} Shift data for the selected driver */
    let driverShiftData = null;

    /** @type {number|null} Currently selected driver ID */
    let selectedDriverId = null;

    /**
     * Fetch shift data for the selected driver
     */
    async function fetchDriverShifts(driverId, monthStr) {
        if (!driverId) {
            driverShiftData = null;
            return;
        }

        try {
            const response = await fetch(`/driver/${driverId}/calendar-data?month=${monthStr}`);
            const data = await response.json();
            if (data.success) {
                driverShiftData = data;
            } else {
                driverShiftData = null;
            }
        } catch (err) {
            console.error('Error fetching driver shifts:', err);
            driverShiftData = null;
        }
    }

    /**
     * Get shift data for a specific date
     */
    function getShiftsForDate(dateStr) {
        if (!driverShiftData || !driverShiftData.days) return null;
        const day = driverShiftData.days.find(d => d.date === dateStr);
        return day || null;
    }

    function getMinimumSelectableDateStr() {
        const now = new Date();
        const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() < 6) {
            minDate.setDate(minDate.getDate() - 1);
        }
        return formatDateISO(minDate);
    }

    /**
     * Render the calendar for the current calViewDate month.
     */
    async function renderCalendar() {
        const tbody = document.getElementById('calBody');
        const monthLabel = document.getElementById('calMonthLabel');
        if (!tbody || !monthLabel) return;

        const calendarEl = tbody.closest('.holiday-calendar');
        if (calendarEl) {
            calendarEl.classList.toggle('cal-disabled-state', !selectedDriverId);
        }

        const requiredHint = document.getElementById('holidayDriverRequiredHint');
        if (requiredHint) {
            requiredHint.classList.toggle('d-none', Boolean(selectedDriverId));
        }

        disposeTooltipsIn(tbody);

        const year = calViewDate.getFullYear();
        const month = calViewDate.getMonth(); // 0-indexed

        monthLabel.textContent = calViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        // Fetch shift data for current month if driver is selected
        if (selectedDriverId) {
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            await fetchDriverShifts(selectedDriverId, monthStr);
        }

        const today = new Date();
        const todayStr = formatDateISO(today);
        const minSelectableDateStr = getMinimumSelectableDateStr();

        if (calStartDate && calStartDate < minSelectableDateStr) {
            calStartDate = null;
            calEndDate = null;
            updateDateDisplay();
            updateFormInputs();
            const btn = document.getElementById('saveHolidayBtn');
            if (btn) btn.disabled = true;
        }

        // First day of month (0=Sun ... 6=Sat). Convert to Mon-based (0=Mon ... 6=Sun)
        const firstDay = new Date(year, month, 1);
        let startOffset = firstDay.getDay() - 1; // Mon=0, Tue=1 ... Sat=5
        if (startOffset < 0) startOffset = 6;    // Sunday (getDay()=0) maps to position 6 in Mon-first layout

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let html = '';
        let dayCounter = 1;
        let cellIndex = 0;
        const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

        html += '<tr>';
        for (let i = 0; i < totalCells; i++) {
            if (i % 7 === 0 && i > 0) html += '</tr><tr>';

            if (i < startOffset || dayCounter > daysInMonth) {
                html += '<td class="cal-empty"></td>';
            } else {
                const dateStr = formatDateISO(new Date(year, month, dayCounter));
                const isToday = dateStr === todayStr;
                const isHoliday = existingHolidayDates.has(dateStr);
                const isInRange = isDateInRange(dateStr);
                const isRangeStart = dateStr === calStartDate;
                const isRangeEnd = dateStr === calEndDate;

                let classes = 'cal-day';
                if (isToday) classes += ' cal-today';
                if (isHoliday) classes += ' cal-holiday';
                if (isRangeStart || isRangeEnd) classes += ' cal-selected';

                const dayData = getShiftsForDate(dateStr);
                const dayWorkingShifts = ((dayData && dayData.shifts) || []).filter(function (s) { return s.shift_type !== 'day_off'; });
                const isDayWorking = dayWorkingShifts.length > 0;
                const isSwapWorkDay = Boolean(dayData && dayData.has_swap_work);

                if (selectedDriverId && (!isDayWorking || isSwapWorkDay || dateStr < minSelectableDateStr)) classes += ' cal-disabled';

                // Only highlight in-range days that are working days when a driver is selected
                const showInRange = isInRange && calStartDate && calEndDate && calStartDate !== calEndDate;
                if (showInRange && (!selectedDriverId || (isDayWorking && !isSwapWorkDay))) classes += ' cal-in-range';

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
            cellIndex++;
        }
        html += '</tr>';

        tbody.innerHTML = html;

        // Attach click handlers
        tbody.querySelectorAll('td.cal-day').forEach(function (td) {
            td.addEventListener('click', function () {
                if (!selectedDriverId) return;
                if (td.classList.contains('cal-disabled')) return;
                selectCalDay(td.getAttribute('data-date'));
            });
        });

        if (window.bootstrap && window.bootstrap.Tooltip) {
            tbody.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
                window.bootstrap.Tooltip.getOrCreateInstance(el);
            });
        }
    }

    function selectCalDay(dateStr) {
        // Range selection logic: first click sets start, second click sets end
        if (!calStartDate || (calStartDate && calEndDate)) {
            // Starting a new selection
            calStartDate = dateStr;
            calEndDate = null;
        } else {
            // Setting end date
            calEndDate = dateStr;
            // Ensure start is before end
            if (calEndDate < calStartDate) {
                [calStartDate, calEndDate] = [calEndDate, calStartDate];
            }
        }

        updateDateDisplay();
        updateFormInputs();

        // Enable the save button if we have at least a start date
        const btn = document.getElementById('saveHolidayBtn');
        if (btn) btn.disabled = !calStartDate;

        renderCalendar();
    }

    function isDateInRange(dateStr) {
        if (!calStartDate) return false;
        if (!calEndDate) return dateStr === calStartDate;
        return dateStr >= calStartDate && dateStr <= calEndDate;
    }

    function updateDateDisplay() {
        const display = document.getElementById('holidayDateDisplay');
        if (!display) return;

        if (!calStartDate) {
            if (!selectedDriverId) {
                display.textContent = 'Select a driver, then click a start and end date on the calendar.';
            } else {
                display.textContent = 'Click a start date, then click an end date on the calendar.';
            }
            return;
        }

        const startParts = calStartDate.split('-');
        const startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
        const startFormatted = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        if (!calEndDate) {
            display.innerHTML = `<strong>Start:</strong> ${startFormatted}<br><small class="text-muted">Click another date to select end (or click same date for single day)</small>`;
        } else if (calStartDate === calEndDate) {
            display.innerHTML = `<strong>Selected:</strong> ${startFormatted} (1 day)`;
        } else {
            const endParts = calEndDate.split('-');
            const endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
            const endFormatted = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const dayCount = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            display.innerHTML = `<strong>Range:</strong> ${startFormatted} to ${endFormatted} (${dayCount} days)`;
        }
    }

    function updateFormInputs() {
        document.getElementById('holidayStartDate').value = calStartDate || '';
        document.getElementById('holidayEndDate').value = calEndDate || calStartDate || '';
    }

    function formatDateISO(d) {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${da}`;
    }

    /**
     * Populate existing holidays from the page's hidden data.
     * The template embeds holiday dates via a data attribute on #holidaysDataEl.
     */
    function loadExistingHolidays() {
        const el = document.getElementById('holidaysDataEl');
        if (!el) return;
        try {
            const dates = JSON.parse(el.getAttribute('data-holidays') || '[]');
            dates.forEach(function (d) { existingHolidayDates.add(d); });
        } catch (e) {
            // No holidays data available
        }
    }

    function initCalendar() {
        loadExistingHolidays();
        renderCalendar();

        const prev = document.getElementById('calPrev');
        const next = document.getElementById('calNext');
        const clearBtn = document.getElementById('clearHolidaySelection');
        const driverSelect = document.getElementById('holidayDriverSelect');

        if (prev) {
            prev.addEventListener('click', function () {
                calViewDate.setMonth(calViewDate.getMonth() - 1);
                renderCalendar();
            });
        }
        if (next) {
            next.addEventListener('click', function () {
                calViewDate.setMonth(calViewDate.getMonth() + 1);
                renderCalendar();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                const driverSelectEl = document.getElementById('holidayDriverSelect');
                const typeSelectEl = document.getElementById('timeOffType');
                const notesEl = document.getElementById('holidayNotes');

                if (driverSelectEl) {
                    driverSelectEl.value = '';
                }
                if (typeSelectEl) {
                    typeSelectEl.value = 'holiday';
                    typeSelectEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (notesEl) {
                    notesEl.value = '';
                }

                selectedDriverId = null;
                driverShiftData = null;
                calStartDate = null;
                calEndDate = null;
                updateDateDisplay();
                updateFormInputs();
                const btn = document.getElementById('saveHolidayBtn');
                if (btn) btn.disabled = true;
                renderCalendar();
            });
        }
        if (driverSelect) {
            driverSelect.addEventListener('change', function () {
                selectedDriverId = this.value ? parseInt(this.value, 10) : null;
                // Clear calendar selection when driver is deselected
                if (!selectedDriverId) {
                    driverShiftData = null;
                    calStartDate = null;
                    calEndDate = null;
                    updateDateDisplay();
                    updateFormInputs();
                    const btn = document.getElementById('saveHolidayBtn');
                    if (btn) btn.disabled = true;
                }
                renderCalendar();
            });
        }
    }

    // Expose for use by event-bindings
    window.schedulingCalendar = {
        init: initCalendar,
        refresh: renderCalendar,
        setDriver: function(driverId) {
            selectedDriverId = driverId;
            renderCalendar();
        },
        addHolidayDate: function (dateStr) {
            existingHolidayDates.add(dateStr);
            renderCalendar();
        },
        removeHolidayDate: function (dateStr) {
            existingHolidayDates.delete(dateStr);
            renderCalendar();
        }
    };
})();
