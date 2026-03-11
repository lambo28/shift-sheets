document.addEventListener('DOMContentLoaded', function () {
    const dateInput = document.getElementById('date');
    const timeInput = document.getElementById('time');

    if (!dateInput || !timeInput) return;

    if (!dateInput.value) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }

    if (!timeInput.value) {
        const now = new Date();
        let nextHour = now.getHours() + 1;

        if (nextHour >= 24) {
            nextHour = 0;
        }

        timeInput.value = String(nextHour).padStart(2, '0') + ':00';
    }
});
