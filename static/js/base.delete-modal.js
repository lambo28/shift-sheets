(function () {
    window.showGlobalDeleteConfirm = function (options) {
        const config = options || {};
        const title = config.title || 'Confirm Deletion';
        const message = config.message || 'Are you sure you want to delete this item?';
        const name = config.name || '';
        const warning = config.warning || '';
        const action = config.action || '#';
        const submitLabel = config.submitLabel || 'Delete';

        const titleEl = document.getElementById('globalDeleteTitle');
        const messageEl = document.getElementById('globalDeleteMessage');
        const nameRowEl = document.getElementById('globalDeleteNameRow');
        const nameEl = document.getElementById('globalDeleteName');
        const warningEl = document.getElementById('globalDeleteWarning');
        const formEl = document.getElementById('deleteForm');
        const submitEl = document.getElementById('globalDeleteSubmitBtn');

        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;

        if (nameRowEl && nameEl) {
            if (name) {
                nameEl.textContent = name;
                nameRowEl.classList.remove('d-none');
            } else {
                nameEl.textContent = '';
                nameRowEl.classList.add('d-none');
            }
        }

        if (warningEl) {
            if (warning) {
                warningEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + warning;
                warningEl.classList.remove('d-none');
            } else {
                warningEl.innerHTML = '';
                warningEl.classList.add('d-none');
            }
        }

        if (formEl) formEl.action = action;
        if (submitEl) {
            submitEl.textContent = submitLabel;
            submitEl.type = action === 'javascript:void(0);' ? 'button' : 'submit';
        }

        let feedbackEl = document.getElementById('deletePatternFeedback');
        if (!feedbackEl) {
            feedbackEl = document.createElement('div');
            feedbackEl.id = 'deletePatternFeedback';
            feedbackEl.className = 'alert d-none mt-3';
            feedbackEl.setAttribute('role', 'alert');
            const modalBody = document.querySelector('#deleteModal .modal-body');
            if (modalBody) {
                modalBody.appendChild(feedbackEl);
            }
        } else {
            feedbackEl.classList.add('d-none');
            feedbackEl.textContent = '';
            feedbackEl.classList.remove('alert-success', 'alert-danger', 'alert-warning', 'alert-info', 'fade', 'show', 'alert-dismissible');
        }

        const modalEl = document.getElementById('deleteModal');
        if (!modalEl || typeof bootstrap === 'undefined') return;
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    };
})();
