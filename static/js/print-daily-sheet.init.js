document.addEventListener('DOMContentLoaded', function () {
    const printButton = document.getElementById('printDailySheetBtn');
    if (printButton) {
        printButton.addEventListener('click', function () {
            window.print();
        });
    }

    window.setTimeout(function () {
        window.print();
    }, 500);
});
