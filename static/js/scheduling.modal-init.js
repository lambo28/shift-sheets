/**
 * scheduling.modal-init.js
 * Initialization handlers for scheduling modal forms (school terms and closures).
 */

(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        // Initialize edit term modal
        initializeModalDataPopulation('editSchoolTermModal', 'editSchoolTermForm', {
            dataAttrToFormField: {
                'data-term-id': null,
                'data-term-name': 'editTermName',
                'data-term-start': 'editTermStartDate',
                'data-term-end': 'editTermEndDate'
            },
            urlPattern: '/scheduling/term/{data-term-id}/edit'
        });
        
        // Initialize edit closure modal
        initializeModalDataPopulation('editSchoolClosureModal', 'editSchoolClosureForm', {
            dataAttrToFormField: {
                'data-closure-id': null,
                'data-closure-date': 'editClosureDate',
                'data-closure-type': 'editClosureType',
                'data-closure-notes': 'editClosureNotes'
            },
            urlPattern: '/scheduling/school-closure/{data-closure-id}/edit'
        });
    });

})();
