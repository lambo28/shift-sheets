const shiftTypesModalEl = document.getElementById('shiftTypesModal');
if (shiftTypesModalEl) {
    shiftTypesModalEl.addEventListener('show.bs.modal', captureShiftTimesBaseline);
    shiftTypesModalEl.addEventListener('hidden.bs.modal', resetNewShiftTypeForm);
}

const shiftTypeDeleteModalEl = document.getElementById('shiftTypeDeleteModal');
if (shiftTypeDeleteModalEl) {
    shiftTypeDeleteModalEl.addEventListener('hidden.bs.modal', () => {
        shiftTypeDeleteModalEl.style.zIndex = '';
        showShiftTypeDeleteFeedback('danger', '');
    });
}

const deleteModalEl = document.getElementById('deleteModal');
if (deleteModalEl) {
    deleteModalEl.addEventListener('hidden.bs.modal', () => {
        showDeletePatternFeedback('danger', '');
    });
}

const shiftTypesCancelBtn = document.getElementById('shiftTypesCancelBtn');
if (shiftTypesCancelBtn) {
    shiftTypesCancelBtn.addEventListener('click', () => {
        showMainPageFeedback('danger', 'No changes made.');
    });
}

const editCycleLengthEl = document.getElementById('editCycleLength');
if (editCycleLengthEl) {
    editCycleLengthEl.addEventListener('change', updateEditPatternDays);
}

const createCycleLengthEl = document.getElementById('createCycleLength');
if (createCycleLengthEl) {
    createCycleLengthEl.addEventListener('change', updateCreatePatternDays);
}

const copyCycleLengthEl = document.getElementById('copyCycleLength');
if (copyCycleLengthEl) {
    copyCycleLengthEl.addEventListener('change', updateCopyPatternDays);
}

const savePatternBtn = document.getElementById('savePatternBtn');
if (savePatternBtn) {
    savePatternBtn.addEventListener('click', savePattern);
}

const confirmShiftTypeDeleteBtn = document.getElementById('confirmShiftTypeDeleteBtn');
if (confirmShiftTypeDeleteBtn) {
    confirmShiftTypeDeleteBtn.addEventListener('click', confirmDeleteShiftType);
}

const addShiftTypeBtn = document.getElementById('addShiftTypeBtn');
if (addShiftTypeBtn) {
    addShiftTypeBtn.addEventListener('click', addShiftType);
}

const saveShiftTypesBtn = document.getElementById('saveShiftTypesBtn');
if (saveShiftTypesBtn) {
    saveShiftTypesBtn.addEventListener('click', saveShiftTypes);
}

const copyPatternBtn = document.getElementById('copyPatternBtn');
if (copyPatternBtn) {
    copyPatternBtn.addEventListener('click', saveCopyPattern);
}

const createPatternBtn = document.getElementById('createPatternBtn');
if (createPatternBtn) {
    createPatternBtn.addEventListener('click', saveCreatePattern);
}

document.addEventListener('click', (event) => {
    const deleteShiftTypeBtn = event.target.closest('.js-delete-shift-type');
    if (!deleteShiftTypeBtn) return;

    const shiftType = deleteShiftTypeBtn.dataset.shiftType || '';
    if (shiftType) {
        deleteShiftType(shiftType);
    }
});

document.querySelectorAll('.drivers-tooltip[data-bs-toggle="tooltip"]').forEach((element) => {
    new bootstrap.Tooltip(element);
});

document.querySelectorAll('.js-edit-pattern').forEach((button) => {
    button.addEventListener('click', () => {
        const patternId = parseInt(button.dataset.patternId, 10);
        if (!Number.isNaN(patternId)) {
            editPattern(patternId);
        }
    });
});

document.querySelectorAll('.js-copy-pattern').forEach((button) => {
    button.addEventListener('click', () => {
        const patternId = parseInt(button.dataset.patternId, 10);
        if (!Number.isNaN(patternId)) {
            copyPattern(patternId);
        }
    });
});

document.querySelectorAll('.js-delete-pattern').forEach((button) => {
    button.addEventListener('click', () => {
        const patternId = parseInt(button.dataset.patternId, 10);
        const patternName = button.dataset.patternName || '';
        if (!Number.isNaN(patternId)) {
            confirmDelete(patternId, patternName);
        }
    });
});

const deleteForm = document.getElementById('deleteForm');
if (deleteForm) {
    deleteForm.addEventListener('submit', function(event) {
        event.preventDefault();

        requestJson(deleteForm.action, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        })
        .then(data => {
            if (data.success) {
                const deleteModal = bootstrap.Modal.getInstance(document.getElementById('deleteModal'));
                if (deleteModal) {
                    deleteModal.hide();
                }
                setPendingMainFeedback('success', 'Shift pattern deleted successfully.');
                location.reload();
            } else {
                showDeletePatternFeedback('danger', 'Error deleting pattern: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error deleting pattern:', error);
            showDeletePatternFeedback('danger', 'Error deleting pattern.');
        });
    });
}

flushPendingMainFeedback();
