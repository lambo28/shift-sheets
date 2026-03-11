/**
 * drivers.page-init.js
 * Page bootstrap for Driver Management screen
 */

var driverAssignments = window.driverAssignments || {};
var shiftTimings = window.shiftTimings || {};

function openCustomTimingsPanelFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const driverId = params.get('open_custom_timings_driver');
    if (!driverId) return;

    const button = document.querySelector(`.toggle-custom-timings[data-driver-id="${driverId}"]`);
    if (button) {
        button.click();
    }

    params.delete('open_custom_timings_driver');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
}

document.addEventListener('DOMContentLoaded', function() {
    var driverAssignmentsData = document.getElementById('driverAssignmentsData');
    var shiftTimingsData = document.getElementById('shiftTimingsData');

    var driverAssignmentsJson = driverAssignmentsData ? driverAssignmentsData.textContent : '{}';
    var shiftTimingsJson = shiftTimingsData ? shiftTimingsData.textContent : '{}';

    var parsedDriverAssignments = {};
    var parsedShiftTimings = {};

    try {
        parsedDriverAssignments = JSON.parse(driverAssignmentsJson || '{}');
    } catch (e) {
        parsedDriverAssignments = {};
    }

    try {
        parsedShiftTimings = JSON.parse(shiftTimingsJson || '{}');
    } catch (e) {
        parsedShiftTimings = {};
    }

    window.driverAssignments = parsedDriverAssignments;
    window.shiftTimings = parsedShiftTimings;
    driverAssignments = parsedDriverAssignments;
    shiftTimings = parsedShiftTimings;

    if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function(el) {
            new bootstrap.Tooltip(el);
        });
    }

    if (typeof initializeFormHandlers === 'function') {
        initializeFormHandlers();
    }
    if (typeof initializeEventBindings === 'function') {
        initializeEventBindings();
    }

    openCustomTimingsPanelFromQuery();

    if (typeof initializeDriverCustomTimingsModule === 'function') {
        initializeDriverCustomTimingsModule();
    }

    if (typeof initializeDriverCalendarModule === 'function') {
        initializeDriverCalendarModule();
    }
});
