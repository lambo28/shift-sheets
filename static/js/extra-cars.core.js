/**
 * extra-cars.core.js
 * Client-side logic for the Extra Cars section.
 */

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Create request form: toggle shift-type vs time-window fields
    // -------------------------------------------------------------------------
    function initRequestTypeToggle() {
        var radios = document.querySelectorAll('input[name="request_type"]');
        var shiftField = document.getElementById('shiftTypeField');
        var windowField = document.getElementById('timeWindowField');
        var shiftSelect = document.getElementById('reqShiftType');
        var windowStart = document.getElementById('reqWindowStart');
        var windowEnd = document.getElementById('reqWindowEnd');

        if (!radios.length || !shiftField || !windowField) return;

        function update() {
            var selected = document.querySelector('input[name="request_type"]:checked');
            var isShift = selected && selected.value === 'shift_type';
            shiftField.classList.toggle('d-none', !isShift);
            windowField.classList.toggle('d-none', isShift);

            if (isShift) {
                shiftSelect.setAttribute('required', '');
                windowStart.removeAttribute('required');
                windowEnd.removeAttribute('required');
            } else {
                shiftSelect.removeAttribute('required');
                windowStart.setAttribute('required', '');
                windowEnd.setAttribute('required', '');
            }
        }

        radios.forEach(function (r) { r.addEventListener('change', update); });
        update();
    }

    // -------------------------------------------------------------------------
    // Unlimited checkbox: disable/enable slots input
    // -------------------------------------------------------------------------
    function initUnlimitedToggle() {
        var checkbox = document.getElementById('reqUnlimited');
        var slotsInput = document.getElementById('reqSlots');
        if (!checkbox || !slotsInput) return;

        function update() {
            slotsInput.disabled = checkbox.checked;
            if (checkbox.checked) {
                slotsInput.removeAttribute('required');
            } else {
                slotsInput.setAttribute('required', '');
            }
        }

        checkbox.addEventListener('change', update);
        update();
    }

    // -------------------------------------------------------------------------
    // Add Assignment Modal
    // -------------------------------------------------------------------------
    function initAssignmentModal() {
        var modal = document.getElementById('addAssignmentModal');
        if (!modal) return;

        var form = document.getElementById('addAssignmentForm');
        var windowLabel = document.getElementById('modalRequestWindow');
        var driverSelect = document.getElementById('modalDriverSelect');
        var startInput = document.getElementById('modalStartTime');
        var endInput = document.getElementById('modalEndTime');
        var notesInput = document.getElementById('modalNotes');
        var validationDiv = document.getElementById('validationResult');
        var validateBtn = document.getElementById('validateBtn');

        // Populate modal data when opened via "Add Driver" buttons
        modal.addEventListener('show.bs.modal', function (event) {
            var trigger = event.relatedTarget;
            if (!trigger) return;

            var requestId = trigger.getAttribute('data-request-id');
            var window_ = trigger.getAttribute('data-request-window');
            var reqStart = trigger.getAttribute('data-request-start');
            var reqEnd = trigger.getAttribute('data-request-end');

            if (form) {
                form.action = '/extra-cars/request/' + requestId + '/assignment/add';
                form._requestId = requestId;
                form._reqStart = reqStart;
                form._reqEnd = reqEnd;
            }

            if (windowLabel) windowLabel.textContent = window_ || '';

            // Reset fields
            if (driverSelect) driverSelect.value = '';
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
            if (notesInput) notesInput.value = '';
            if (validationDiv) {
                validationDiv.innerHTML = '';
                validationDiv.classList.add('d-none');
            }
        });

        // Validate button
        if (validateBtn) {
            validateBtn.addEventListener('click', function () {
                var requestId = form && form._requestId;
                if (!requestId) return;

                var driverId = driverSelect ? driverSelect.value : '';
                if (!driverId) {
                    showValidation(validationDiv, false, ['Please select a driver first.'], null, null);
                    return;
                }

                validateBtn.disabled = true;
                validateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking…';

                var payload = {
                    driver_id: driverId,
                    start_time: startInput ? startInput.value : '',
                    end_time: endInput ? endInput.value : ''
                };

                fetch('/extra-cars/request/' + requestId + '/assignment/validate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify(payload)
                })
                .then(function (resp) { return resp.json(); })
                .then(function (data) {
                    validateBtn.disabled = false;
                    validateBtn.innerHTML = '<i class="fas fa-check-circle"></i> Check legality';

                    if (!data.success) {
                        showValidation(validationDiv, false, [data.error || 'Validation error.'], null, null);
                        return;
                    }

                    showValidation(validationDiv, data.valid, data.errors, data.suggested_start, data.suggested_end);
                })
                .catch(function () {
                    validateBtn.disabled = false;
                    validateBtn.innerHTML = '<i class="fas fa-check-circle"></i> Check legality';
                    showValidation(validationDiv, false, ['Network error during validation.'], null, null);
                });
            });
        }
    }

    function showValidation(container, isValid, errors, suggestedStart, suggestedEnd) {
        if (!container) return;
        container.classList.remove('d-none');

        if (isValid) {
            container.innerHTML =
                '<div class="alert alert-success py-2 mb-0">' +
                '<i class="fas fa-check-circle me-1"></i>' +
                'Assignment is within legal work-rule limits.' +
                '</div>';
        } else {
            var errorHtml = errors.map(function (e) {
                return '<li>' + escapeHtml(e) + '</li>';
            }).join('');

            var suggestion = '';
            if (suggestedStart && suggestedEnd) {
                suggestion =
                    '<p class="mb-0 mt-2">' +
                    '<i class="fas fa-lightbulb me-1 text-warning"></i>' +
                    '<strong>Legal window:</strong> ' +
                    escapeHtml(suggestedStart) + '–' + escapeHtml(suggestedEnd) +
                    '</p>';
            }

            container.innerHTML =
                '<div class="alert alert-danger py-2 mb-0">' +
                '<i class="fas fa-exclamation-triangle me-1"></i>' +
                '<strong>Rule violations:</strong>' +
                '<ul class="mb-0 mt-1">' + errorHtml + '</ul>' +
                suggestion +
                '</div>';
        }
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // -------------------------------------------------------------------------
    // Delete modal integration (uses base.delete-modal.js pattern)
    // -------------------------------------------------------------------------
    function initDeleteButtons() {
        document.querySelectorAll('[data-bs-target="#deleteModal"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var url = btn.getAttribute('data-delete-url');
                var title = btn.getAttribute('data-delete-title') || 'Confirm Deletion';
                var message = btn.getAttribute('data-delete-message') || 'Are you sure?';
                var name = btn.getAttribute('data-delete-name') || '';

                var titleEl = document.getElementById('globalDeleteTitle');
                var msgEl = document.getElementById('globalDeleteMessage');
                var nameEl = document.getElementById('globalDeleteName');
                var nameRow = document.getElementById('globalDeleteNameRow');
                var formEl = document.getElementById('deleteForm');

                if (titleEl) titleEl.textContent = title;
                if (msgEl) msgEl.textContent = message;
                if (nameEl) nameEl.textContent = name;
                if (nameRow) nameRow.classList.toggle('d-none', !name);
                if (formEl) formEl.action = url;
            });
        });
    }

    // -------------------------------------------------------------------------
    // Boot
    // -------------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function () {
        initRequestTypeToggle();
        initUnlimitedToggle();
        initAssignmentModal();
        initDeleteButtons();
    });
}());
