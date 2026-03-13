/**
 * extra-cars.core.js
 * Client-side logic for the Extra Cars section.
 */

(function () {
    'use strict';

    var MIN_REQUEST_WINDOW_HOURS = 2;

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

        function runValidation() {
            var requestId = form && form._requestId;
            if (!requestId || !driverSelect) return;

            var driverId = driverSelect.value;
            if (!driverId) {
                if (validationDiv) {
                    validationDiv.innerHTML = '';
                    validationDiv.classList.add('d-none');
                }
                return;
            }

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
                if (!data.success) {
                    showValidation(validationDiv, false, [data.error || 'Validation error.'], null, null);
                    return;
                }

                showValidation(validationDiv, data.valid, data.errors, data.suggested_start, data.suggested_end);
            })
            .catch(function () {
                showValidation(validationDiv, false, ['Network error during validation.'], null, null);
            });
        }

        function applyAssignedDriverDisables(assignedIds) {
            if (!driverSelect) return;
            var assignedSet = new Set((assignedIds || []).map(function (id) { return String(id); }));
            Array.prototype.forEach.call(driverSelect.options, function (opt) {
                if (!opt.value) return;
                var isAssigned = assignedSet.has(String(opt.value));
                opt.disabled = isAssigned;
                if (isAssigned) {
                    if (!/\(already assigned\)$/.test(opt.textContent)) {
                        opt.textContent += ' (already assigned)';
                    }
                } else {
                    opt.textContent = opt.textContent.replace(/\s*\(already assigned\)$/, '');
                }
            });
        }

        // Populate modal data when opened via "Add Driver" buttons
        modal.addEventListener('show.bs.modal', function (event) {
            var trigger = event.relatedTarget;
            if (!trigger) return;

            var requestId = trigger.getAttribute('data-request-id');
            var window_ = trigger.getAttribute('data-request-window');
            var reqStart = trigger.getAttribute('data-request-start');
            var reqEnd = trigger.getAttribute('data-request-end');
            var availableStart = trigger.getAttribute('data-available-start');
            var availableEnd = trigger.getAttribute('data-available-end');
            var assignedIdsRaw = trigger.getAttribute('data-assigned-driver-ids') || '';
            var assignedIds = assignedIdsRaw
                .split(',')
                .map(function (id) { return id.trim(); })
                .filter(function (id) { return id.length > 0; });

            if (form) {
                form.action = '/extra-cars/request/' + requestId + '/assignment/add';
                form._requestId = requestId;
                form._reqStart = reqStart;
                form._reqEnd = reqEnd;
            }

            if (windowLabel) windowLabel.textContent = window_ || '';

            // Reset fields
            if (driverSelect) driverSelect.value = '';
            if (startInput) startInput.value = availableStart || '';
            if (endInput) endInput.value = availableEnd || '';
            if (notesInput) notesInput.value = '';
            if (validationDiv) {
                validationDiv.innerHTML = '';
                validationDiv.classList.add('d-none');
            }

            applyAssignedDriverDisables(assignedIds);
        });

        if (driverSelect) {
            driverSelect.addEventListener('change', runValidation);
        }
        if (startInput) {
            startInput.addEventListener('change', runValidation);
        }
        if (endInput) {
            endInput.addEventListener('change', runValidation);
        }

        if (form) {
            form.addEventListener('submit', function (event) {
                if (!driverSelect || !driverSelect.value) return;
                var selectedOption = driverSelect.options[driverSelect.selectedIndex];
                if (selectedOption && selectedOption.disabled) {
                    event.preventDefault();
                    showValidation(validationDiv, false, ['This driver is already assigned to this request.'], null, null);
                }
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
                    '<strong>Suggested time window:</strong> ' +
                    escapeHtml(suggestedStart) + '–' + escapeHtml(suggestedEnd) +
                    '</p>';
            }

            container.innerHTML =
                '<div class="alert alert-danger py-2 mb-0">' +
                '<i class="fas fa-exclamation-triangle me-1"></i>' +
                '<strong>Can’t assign this driver yet:</strong>' +
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

    function parseTimeToMinutes(value) {
        if (!value || typeof value !== 'string') return null;
        var parts = value.split(':');
        if (parts.length < 2) return null;
        var hours = Number(parts[0]);
        var minutes = Number(parts[1]);
        if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
        return (hours * 60) + minutes;
    }

    function durationMinutesAcrossMidnight(startMinutes, endMinutes) {
        if (startMinutes === null || endMinutes === null) return null;
        if (endMinutes <= startMinutes) endMinutes += 24 * 60;
        return endMinutes - startMinutes;
    }

    function showWindowValidationError() {
        var message = 'Request window must be at least ' + MIN_REQUEST_WINDOW_HOURS + ' hours.';
        if (typeof showAlertBanner === 'function') {
            showAlertBanner('error', message, true, 4000);
        } else {
            window.alert(message);
        }
    }

    function validateMinimumRequestWindow(options) {
        var requestTypeSelector = options.requestTypeSelector;
        var shiftSelect = options.shiftSelect;
        var windowStart = options.windowStart;
        var windowEnd = options.windowEnd;
        var scope = options.scope || document;

        var selectedType = scope.querySelector(requestTypeSelector + ':checked');
        if (!selectedType) return true;

        var minimumMinutes = MIN_REQUEST_WINDOW_HOURS * 60;

        if (selectedType.value === 'shift_type') {
            if (!shiftSelect || !shiftSelect.value) return true;
            var selectedOption = shiftSelect.options[shiftSelect.selectedIndex];
            if (!selectedOption) return true;
            var shiftStart = parseTimeToMinutes(selectedOption.getAttribute('data-start'));
            var shiftEnd = parseTimeToMinutes(selectedOption.getAttribute('data-end'));
            var shiftDuration = durationMinutesAcrossMidnight(shiftStart, shiftEnd);
            if (shiftDuration !== null && shiftDuration < minimumMinutes) {
                showWindowValidationError();
                return false;
            }
            return true;
        }

        var customStart = parseTimeToMinutes(windowStart && windowStart.value);
        var customEnd = parseTimeToMinutes(windowEnd && windowEnd.value);
        if (customStart === null || customEnd === null) return true;
        var customDuration = durationMinutesAcrossMidnight(customStart, customEnd);
        if (customDuration !== null && customDuration < minimumMinutes) {
            showWindowValidationError();
            return false;
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // Notes punctuation helper (create/edit request forms)
    // -------------------------------------------------------------------------
    function punctuateIfNeeded(text) {
        var value = (text || '').trim();
        if (!value) return '';
        if (/[.!?]$/.test(value)) return value;
        return value + '.';
    }

    function formatTitleCaseLikeDriver(value) {
        var normalized = String(value || '').replace(/_/g, ' ').trim();
        if (!normalized) return '';
        return normalized
            .split(/\s+/)
            .map(function (part) {
                var lower = part.toLowerCase();
                if (lower === 'am' || lower === 'pm') {
                    return lower.toUpperCase();
                }
                return lower.charAt(0).toUpperCase() + lower.slice(1);
            })
            .join(' ');
    }

    function formatNoteText(value) {
        return punctuateIfNeeded(formatTitleCaseLikeDriver(value));
    }

    function bindNoteFormatter(inputEl) {
        if (!inputEl) return;
        inputEl.addEventListener('blur', function (e) {
            e.target.value = formatNoteText(e.target.value);
        });
    }

    function initNotesAutoPunctuation() {
        var addForm = document.getElementById('addRequestForm');
        var addNotes = document.getElementById('reqNotes');
        bindNoteFormatter(addNotes);
        if (addForm && addNotes) {
            addForm.addEventListener('submit', function () {
                addNotes.value = formatNoteText(addNotes.value);
            });
        }

        var editForm = document.getElementById('editRequestForm');
        var editNotes = document.getElementById('editReqNotes');
        bindNoteFormatter(editNotes);
        if (editForm && editNotes) {
            editForm.addEventListener('submit', function () {
                editNotes.value = formatNoteText(editNotes.value);
            });
        }

        var assignmentForm = document.getElementById('addAssignmentForm');
        var assignmentNotes = document.getElementById('modalNotes');
        bindNoteFormatter(assignmentNotes);
        if (assignmentForm && assignmentNotes) {
            assignmentForm.addEventListener('submit', function () {
                assignmentNotes.value = formatNoteText(assignmentNotes.value);
            });
        }
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
    // Collapse chevron toggling for request cards
    // -------------------------------------------------------------------------
    function initCollapseChevrons() {
        document.querySelectorAll('[data-bs-toggle="collapse"][data-bs-target^="#requestBody"]').forEach(function (btn) {
            var targetId = btn.getAttribute('data-bs-target').replace('#', '');
            var collapseEl = document.getElementById(targetId);
            if (!collapseEl) return;
            var icon = btn.querySelector('.request-chevron');
            collapseEl.addEventListener('hide.bs.collapse', function () {
                if (icon) { icon.classList.replace('fa-chevron-up', 'fa-chevron-down'); }
                btn.setAttribute('aria-expanded', 'false');
            });
            collapseEl.addEventListener('show.bs.collapse', function () {
                if (icon) { icon.classList.replace('fa-chevron-down', 'fa-chevron-up'); }
                btn.setAttribute('aria-expanded', 'true');
            });
        });
    }

    // -------------------------------------------------------------------------
    // Edit request modal
    // -------------------------------------------------------------------------
    function initEditRequestModal() {
        var modal = document.getElementById('editRequestModal');
        if (!modal) return;

        var form        = document.getElementById('editRequestForm');
        var dateInput   = document.getElementById('editReqDate');
        var statusSel   = document.getElementById('editReqStatus');
        var shiftField  = document.getElementById('editShiftTypeField');
        var winField    = document.getElementById('editTimeWindowField');
        var shiftSel    = document.getElementById('editReqShiftType');
        var winStart    = document.getElementById('editReqWindowStart');
        var winEnd      = document.getElementById('editReqWindowEnd');
        var slotsInput  = document.getElementById('editReqSlots');
        var unlimCheck  = document.getElementById('editReqUnlimited');
        var notesInput  = document.getElementById('editReqNotes');

        function updateTypeFields() {
            var sel = modal.querySelector('input[name="request_type"]:checked');
            var isShift = sel && sel.value === 'shift_type';
            if (shiftField) shiftField.classList.toggle('d-none', !isShift);
            if (winField)   winField.classList.toggle('d-none', isShift);
            if (shiftSel) {
                if (isShift) shiftSel.setAttribute('required', '');
                else         shiftSel.removeAttribute('required');
            }
            if (winStart && winEnd) {
                if (!isShift) { winStart.setAttribute('required', ''); winEnd.setAttribute('required', ''); }
                else          { winStart.removeAttribute('required'); winEnd.removeAttribute('required'); }
            }
        }

        modal.querySelectorAll('input[name="request_type"]').forEach(function (r) {
            r.addEventListener('change', updateTypeFields);
        });

        if (unlimCheck && slotsInput) {
            unlimCheck.addEventListener('change', function () {
                slotsInput.disabled = unlimCheck.checked;
                if (unlimCheck.checked) slotsInput.removeAttribute('required');
                else                    slotsInput.setAttribute('required', '');
            });
        }

        modal.addEventListener('show.bs.modal', function (event) {
            var t = event.relatedTarget;
            if (!t) return;

            var requestId  = t.getAttribute('data-request-id');
            var reqDate    = t.getAttribute('data-request-date');
            var reqType    = t.getAttribute('data-request-type');
            var shiftType  = t.getAttribute('data-request-shift-type');
            var wStart     = t.getAttribute('data-request-window-start');
            var wEnd       = t.getAttribute('data-request-window-end');
            var unlimited  = t.getAttribute('data-request-unlimited') === '1';
            var slots      = t.getAttribute('data-request-slots');
            var status     = t.getAttribute('data-request-status');
            var notes      = t.getAttribute('data-request-notes');

            if (form)       form.action = '/extra-cars/request/' + requestId + '/edit';
            if (dateInput)  dateInput.value = reqDate || '';
            if (statusSel)  statusSel.value = status || 'OPEN';
            if (notesInput) notesInput.value = notes || '';

            var radioShift  = modal.querySelector('#editRtShift');
            var radioWindow = modal.querySelector('#editRtWindow');
            if (reqType === 'time_window') { if (radioWindow) radioWindow.checked = true; }
            else                           { if (radioShift)  radioShift.checked  = true; }
            updateTypeFields();

            if (shiftSel)  shiftSel.value  = shiftType || '';
            if (winStart)  winStart.value  = wStart || '';
            if (winEnd)    winEnd.value    = wEnd || '';

            if (unlimCheck) {
                unlimCheck.checked = unlimited;
                if (slotsInput) {
                    slotsInput.disabled = unlimited;
                    slotsInput.value = unlimited ? '' : (slots || '');
                }
            }
        });

        if (form) {
            form.addEventListener('submit', function (event) {
                var isValid = validateMinimumRequestWindow({
                    requestTypeSelector: 'input[name="request_type"]',
                    shiftSelect: shiftSel,
                    windowStart: winStart,
                    windowEnd: winEnd,
                    scope: modal
                });
                if (!isValid) event.preventDefault();
            });
        }
    }

    function initAddRequestMinimumWindowValidation() {
        var form = document.getElementById('addRequestForm');
        if (!form) return;

        var shiftSelect = document.getElementById('reqShiftType');
        var windowStart = document.getElementById('reqWindowStart');
        var windowEnd = document.getElementById('reqWindowEnd');

        form.addEventListener('submit', function (event) {
            var isValid = validateMinimumRequestWindow({
                requestTypeSelector: 'input[name="request_type"]',
                shiftSelect: shiftSelect,
                windowStart: windowStart,
                windowEnd: windowEnd,
                scope: document
            });
            if (!isValid) event.preventDefault();
        });
    }

    // -------------------------------------------------------------------------
    // Boot
    // -------------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function () {
        initRequestTypeToggle();
        initUnlimitedToggle();
        initAddRequestMinimumWindowValidation();
        initAssignmentModal();
        initNotesAutoPunctuation();
        initDeleteButtons();
        initCollapseChevrons();
        initEditRequestModal();
    });
}());
