document.addEventListener('DOMContentLoaded', function () {
    const dateInput = document.getElementById('target_date');
    if (!dateInput) return;

    const today = new Date();
    const todayString = today.toISOString().split('T')[0];
    dateInput.value = todayString;

    const currentHour = today.getHours();
    let minDate;

    if (currentHour >= 12) {
        minDate = todayString;
    } else {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        minDate = yesterday.toISOString().split('T')[0];
    }

    dateInput.min = minDate;
});
