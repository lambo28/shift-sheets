/**
 * scheduling.core.js
 * Core utilities for the Scheduling section (holidays, adjustments, swaps).
 */

const CAL_TIME_OFF_LABELS = {
    holiday: 'Holiday',
    sickness: 'Sickness',
    vor: 'VOR',
    other: 'Time Off'
};

const CAL_TIME_OFF_ICONS = {
    holiday: 'fa-umbrella-beach',
    sickness: 'fa-notes-medical',
    vor: 'fa-wrench',
    other: 'fa-user-clock'
};

const CAL_TIME_OFF_BADGES = {
    holiday: 'bg-warning text-dark',
    sickness: 'bg-danger',
    vor: 'bg-secondary',
    other: 'bg-info text-dark'
};

function calToMinutes(timeValue) {
    if (!timeValue || typeof timeValue !== 'string' || !timeValue.includes(':')) return null;
    const [hours, mins] = timeValue.split(':').map((v) => parseInt(v, 10));
    if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
    return (hours * 60) + mins;
}

function calToTimeText(minutesValue) {
    if (minutesValue === null || minutesValue === undefined) return '';
    const hrs = String(Math.floor(minutesValue / 60)).padStart(2, '0');
    const mins = String(minutesValue % 60).padStart(2, '0');
    return `${hrs}:${mins}`;
}

function buildUnifiedCalendarCellContent(dayData) {
    const safeDayData = dayData || null;
    const shifts = safeDayData && Array.isArray(safeDayData.shifts) ? safeDayData.shifts : [];
    const adjustments = safeDayData && Array.isArray(safeDayData.adjustments) ? safeDayData.adjustments : [];
    const hasDayOffShift = shifts.some((shift) => shift.shift_type === 'day_off' || shift.label === 'OFF');

    const shiftBadges = [];
    const bottomTimeTokens = [];

    const hasSwapGiveUp = !!safeDayData?.has_swap_give_up;
    const hasSwapWork = !!safeDayData?.has_swap_work;
    const swapGiveUpCount = safeDayData?.swap_give_up_count || 0;
    const swapWorkCount = safeDayData?.swap_work_count || 0;
    const swapTooltipParts = [];
    if (hasSwapGiveUp) {
        swapTooltipParts.push(swapGiveUpCount > 1 ? `Swap give-up day (${swapGiveUpCount})` : 'Swap give-up day');
    }
    if (hasSwapWork) {
        swapTooltipParts.push(swapWorkCount > 1 ? `Swap work day (${swapWorkCount})` : 'Swap work day');
    }
    const swapMarkerHtml = swapTooltipParts.length
        ? `<i class="fas fa-exchange-alt cal-box-swap-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(swapTooltipParts.join(' • '))}"></i>`
        : '';

    shifts.forEach((shift, idx) => {
        const isExtraShift = !!shift.is_extra;
        const startMinutes = calToMinutes(shift.start_time);
        const endMinutes = calToMinutes(shift.end_time);
        const defaultStartMinutes = calToMinutes(shift.default_start_time) ?? startMinutes;
        const defaultEndMinutes = calToMinutes(shift.default_end_time) ?? endMinutes;

        const startText = calToTimeText(startMinutes);
        const endText = calToTimeText(endMinutes);
        const rangeText = `${startText}${startText && endText ? '–' : ''}${endText}`;

        const isChangedFromDefault = (
            ((startMinutes !== null || defaultStartMinutes !== null) ? startMinutes !== defaultStartMinutes : false)
            ||
            ((endMinutes !== null || defaultEndMinutes !== null) ? endMinutes !== defaultEndMinutes : false)
        );

        if (!safeDayData?.is_holiday && !hasDayOffShift && rangeText && isChangedFromDefault) {
            bottomTimeTokens.push(`<span class="cal-shift-time-changed">${rangeText}</span>`);
        }

        if (isExtraShift) {
            return;
        }

        const isDayOff = shift.shift_type === 'day_off' || shift.label === 'OFF';
        const shiftIconHtml = isDayOff
            ? '<i class="fas fa-user-clock"></i>'
            : `<i class="${shift.icon || 'fas fa-clock'}"></i>`;

        const swapInside = (idx === 0) ? swapMarkerHtml : '';
        const hasSwapMarkerClass = swapInside ? ' cal-has-swap-marker' : '';
        const shiftTitle = isDayOff ? 'Day off' : (shift.label || 'Shift');
        shiftBadges.push(
            `<span class="badge ${shift.badge_color || 'bg-primary'} cal-shift-box cal-icon-box${hasSwapMarkerClass}" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(shiftTitle)}"><span class="cal-shift-label">${shiftIconHtml}${swapInside}</span></span>`
        );
    });

    let timeOffHtml = '';
    if (safeDayData?.is_holiday) {
        const type = safeDayData.time_off_type || 'other';
        const label = CAL_TIME_OFF_LABELS[type] || 'Time Off';
        const icon = CAL_TIME_OFF_ICONS[type] || 'fa-user-clock';
        const badgeClass = CAL_TIME_OFF_BADGES[type] || 'bg-info text-dark';
        const timeOffHasSwapClass = swapMarkerHtml ? ' cal-has-swap-marker' : '';
        timeOffHtml = `<span class="badge ${badgeClass} cal-shift-box cal-timeoff cal-icon-box${timeOffHasSwapClass}" data-bs-toggle="tooltip" data-bs-placement="top" title="Driver marked as ${escapeHtml(label)}"><span class="cal-shift-label"><i class="fas ${icon} scheduling-type-white-icon"></i>${swapMarkerHtml}</span></span>`;
    }

    const lateStart = adjustments.find((adj) => adj.adjustment_type === 'late_start');
    const earlyFinish = adjustments.find((adj) => adj.adjustment_type === 'early_finish');

    // Check for extra shifts
    const extraShifts = shifts.filter((s) => s.is_extra);
    const extraShiftTooltip = extraShifts.length
        ? `Extra shift${extraShifts.length > 1 ? 's' : ''}: ${extraShifts.map((s) => `${s.label} (${s.start_time}–${s.end_time})`).join(', ')}`
        : null;

    const lateStartIconHtml = lateStart
        ? `<span class="cal-adjustment-icon cal-icon-box badge-late-start-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`${lateStart.label} at ${lateStart.time}${lateStart.notes ? ` — ${lateStart.notes}` : ''}`)}"><i class="fas fa-hourglass-start"></i></span>`
        : '';

    const earlyFinishIconHtml = earlyFinish
        ? `<span class="cal-adjustment-icon cal-icon-box badge-early-finish-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(`${earlyFinish.label} at ${earlyFinish.time}${earlyFinish.notes ? ` — ${earlyFinish.notes}` : ''}`)}"><i class="fas fa-hourglass-end"></i></span>`
        : '';

    const extraShiftIconHtml = extraShiftTooltip
        ? `<span class="cal-adjustment-icon cal-icon-box badge-extra-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(extraShiftTooltip)}"><i class="fas fa-plus"></i></span>`
        : '';

    const swapGiveUpIconHtml = hasSwapGiveUp
        ? `<span class="cal-adjustment-icon badge-swap-giveup-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(swapGiveUpCount > 1 ? `Swap give-up day (${swapGiveUpCount})` : 'Swap give-up day')}"><i class="fas fa-right-from-bracket"></i></span>`
        : '';

    const swapWorkIconHtml = hasSwapWork
        ? `<span class="cal-adjustment-icon badge-swap-work-icon" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(swapWorkCount > 1 ? `Swap work day (${swapWorkCount})` : 'Swap work day')}"><i class="fas fa-right-to-bracket"></i></span>`
        : '';

    const baseContentHtml = `${shiftBadges.join('')}${timeOffHtml}`;
    const contentHtml = baseContentHtml
        ? `${baseContentHtml}`
        : (extraShiftTooltip ? '' : '<small class="text-muted">No shift</small>');

    const iconCount =
        (shiftBadges.length + (timeOffHtml ? 1 : 0))
        + (lateStart ? 1 : 0)
        + (earlyFinish ? 1 : 0)
        + (extraShiftTooltip ? 1 : 0);

    let inlineSizeClass = '';
    if (iconCount >= 5) inlineSizeClass = 'cal-icons-5plus';
    else if (iconCount >= 4) inlineSizeClass = 'cal-icons-4';

    return {
        contentHtml,
        bottomTimesHtml: bottomTimeTokens.join(''),
        lateStartIconHtml,
        earlyFinishIconHtml,
        extraShiftIconHtml,
        swapGiveUpIconHtml,
        swapWorkIconHtml,
        inlineSizeClass,
    };
}

function disposeTooltipsIn(containerEl) {
    if (!containerEl || !window.bootstrap || !window.bootstrap.Tooltip) return;

    containerEl.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
        const instance = window.bootstrap.Tooltip.getInstance(el);
        if (instance) {
            instance.hide();
            instance.dispose();
        }
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
