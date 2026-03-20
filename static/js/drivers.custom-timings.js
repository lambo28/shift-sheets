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
                            ${data.timings.map(t => renderCustomTimingCard(t, driverId, data.driver_name)).join('')}
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

