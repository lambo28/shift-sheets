document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.showAlertBanner !== 'function') {
        return;
    }

    const flashAlerts = document.querySelectorAll('main > .alert.alert-dismissible');
    flashAlerts.forEach(function (alertEl) {
        let level = 'info';
        if (alertEl.classList.contains('alert-success')) level = 'success';
        else if (alertEl.classList.contains('alert-danger')) level = 'error';
        else if (alertEl.classList.contains('alert-warning')) level = 'warning';

        const cloned = alertEl.cloneNode(true);
        const closeBtn = cloned.querySelector('.btn-close');
        if (closeBtn) closeBtn.remove();

        const messageHtml = cloned.innerHTML.trim();
        window.showAlertBanner(level, messageHtml, true, 4000);
        alertEl.remove();
    });
});
