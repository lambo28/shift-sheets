/**
 * scheduling.event-bindings.js
 * Event handlers and UI wiring for the Scheduling section.
 */

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // Initialise calendar widget once DOM is ready
    // -----------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function () {
        if (window.schedulingCalendar) {
            window.schedulingCalendar.init();
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
        ['swapDriverA', 'swapDriverB', 'swapDateA', 'swapDateB'].forEach(function (id) {
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

        // Activate tab from URL hash
        const hash = window.location.hash;
        if (hash) {
            const tabTrigger = document.querySelector(`[data-bs-target="${hash}"]`);
            if (tabTrigger) {
                const bsTab = bootstrap.Tab.getOrCreateInstance(tabTrigger);
                bsTab.show();
            }
        }
    });

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

})();
