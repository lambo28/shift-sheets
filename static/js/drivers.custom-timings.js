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

