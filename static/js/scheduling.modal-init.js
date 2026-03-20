/**
 * scheduling.modal-init.js
 * Initialization handlers for scheduling modal forms (school terms and closures).
 */

(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        initEditSchoolTermModal();
        initEditSchoolClosureModal();
    });

    function initEditSchoolTermModal() {
        const editTermModal = document.getElementById('editSchoolTermModal');
        const editTermForm = document.getElementById('editSchoolTermForm');
        if (!editTermModal || !editTermForm) return;

        editTermModal.addEventListener('show.bs.modal', function (event) {
            const button = event.relatedTarget;
            if (!button) return;

            const termId = button.getAttribute('data-term-id') || '';
            const termName = button.getAttribute('data-term-name') || '';
            const termStart = button.getAttribute('data-term-start') || '';
            const termEnd = button.getAttribute('data-term-end') || '';

            editTermForm.action = `/scheduling/term/${termId}/edit`;
            document.getElementById('editTermName').value = termName;
            document.getElementById('editTermStartDate').value = termStart;
            document.getElementById('editTermEndDate').value = termEnd;
        });
    }

    function initEditSchoolClosureModal() {
        const editClosureModal = document.getElementById('editSchoolClosureModal');
        const editClosureForm = document.getElementById('editSchoolClosureForm');
        if (!editClosureModal || !editClosureForm) return;

        editClosureModal.addEventListener('show.bs.modal', function (event) {
            const button = event.relatedTarget;
            if (!button) return;

            const closureId = button.getAttribute('data-closure-id') || '';
            const closureDate = button.getAttribute('data-closure-date') || '';
            const closureType = button.getAttribute('data-closure-type') || 'bank_holiday';
            const closureNotes = button.getAttribute('data-closure-notes') || '';

            editClosureForm.action = `/scheduling/school-closure/${closureId}/edit`;
            document.getElementById('editClosureDate').value = closureDate;
            document.getElementById('editClosureType').value = closureType;
            document.getElementById('editClosureNotes').value = closureNotes;
        });
    }

})();
