/**
 * Centralized user-facing messages
 * Keeps all UI text in one place for easy maintenance and future i18n
 * 
 * Usage:
 *   showAlertBanner('success', MESSAGES.DRIVER_ADDED);
 *   showAlertBanner('error', MESSAGES.NETWORK_ERROR);
 * 
 * @type {Object}
 */
const MESSAGES = {
    // ========== SUCCESS MESSAGES ==========
    DRIVER_ADDED: '<i class="fas fa-check-circle"></i> Driver added successfully.',
    DRIVER_UPDATED: '<i class="fas fa-check-circle"></i> Driver updated successfully.',
    DRIVER_DELETED: '<i class="fas fa-check-circle"></i> Driver deleted successfully.',
    
    ASSIGNMENT_SAVED: '<i class="fas fa-check-circle"></i> Assignment saved successfully.',
    ASSIGNMENT_ENDED: '<i class="fas fa-check-circle"></i> Assignment ended successfully.',
    ASSIGNMENT_DELETED: '<i class="fas fa-check-circle"></i> Assignment deleted successfully.',
    
    PATTERN_CREATED: '<i class="fas fa-check-circle"></i> Shift pattern created successfully.',
    PATTERN_UPDATED: '<i class="fas fa-check-circle"></i> Shift pattern updated successfully.',
    PATTERN_DELETED: '<i class="fas fa-check-circle"></i> Shift pattern deleted successfully.',
    PATTERN_COPIED: '<i class="fas fa-check-circle"></i> Shift pattern copied successfully.',
    
    SHIFT_TYPE_ADDED: '<i class="fas fa-check-circle"></i> Shift type added successfully.',
    SHIFT_TYPE_UPDATED: '<i class="fas fa-check-circle"></i> Shift type updated successfully.',
    SHIFT_TYPE_DELETED: '<i class="fas fa-check-circle"></i> Shift type deleted successfully.',
    
    CUSTOM_TIMING_SAVED: '<i class="fas fa-check-circle"></i> Custom timing saved successfully.',
    CUSTOM_TIMING_DELETED: '<i class="fas fa-check-circle"></i> Custom timing deleted successfully.',
    
    HOLIDAY_ADDED: '<i class="fas fa-check-circle"></i> Holiday added successfully.',
    HOLIDAY_DELETED: '<i class="fas fa-check-circle"></i> Holiday deleted successfully.',
    
    DATA_IMPORTED: '<i class="fas fa-check-circle"></i> Data imported successfully.',
    DATA_EXPORTED: '<i class="fas fa-check-circle"></i> Data exported successfully.',
    
    // ========== ERROR MESSAGES ==========
    INVALID_INPUT: '<i class="fas fa-exclamation-circle"></i> Invalid input. Please check your entries.',
    
    NETWORK_ERROR: '<i class="fas fa-exclamation-circle"></i> Network error. Please check your connection and try again.',
    SERVER_ERROR: '<i class="fas fa-exclamation-circle"></i> Server error. Please try again later or contact support.',
    TIMEOUT_ERROR: '<i class="fas fa-exclamation-circle"></i> Request timed out. Please try again.',
    
    PERMISSION_DENIED: '<i class="fas fa-exclamation-circle"></i> You do not have permission for this action.',
    NOT_FOUND: '<i class="fas fa-exclamation-circle"></i> The requested item was not found.',
    
    DUPLICATE_ENTRY: '<i class="fas fa-exclamation-circle"></i> This entry already exists.',
    VALIDATION_FAILED: '<i class="fas fa-exclamation-circle"></i> Validation failed. Please check your entries.',
    
    REQUIRED_FIELD_MISSING: '<i class="fas fa-exclamation-circle"></i> Please fill in all required fields.',
    INVALID_DATE_RANGE: '<i class="fas fa-exclamation-circle"></i> Invalid date range. End date must be after start date.',
    INVALID_TIME_RANGE: '<i class="fas fa-exclamation-circle"></i> Invalid time range. End time must be after start time.',
    LOAD_DATA_ERROR: '<i class="fas fa-exclamation-circle"></i> Could not load data. Please try again.',
    FORM_ERROR: '<i class="fas fa-exclamation-circle"></i> Form error. Please check your input.',
    CUSTOM_TIMING_SAVE_ERROR: '<i class="fas fa-exclamation-circle"></i> Could not save custom timing. Please try again.',
    CUSTOM_TIMING_DELETE_ERROR: '<i class="fas fa-exclamation-circle"></i> Could not delete custom timing. Please try again.',
    
    UNSAVED_CHANGES: '<i class="fas fa-exclamation-triangle"></i> You have unsaved changes. Please save before continuing.',
    
    // ========== WARNING MESSAGES ==========
    CONFIRM_DELETE: '<i class="fas fa-exclamation-triangle"></i> Are you sure? This action cannot be undone.',
    CONFIRM_OVERWRITE: '<i class="fas fa-exclamation-triangle"></i> This will overwrite existing data. Continue?',
    
    DEPRECATED_FEATURE: '<i class="fas fa-info-circle"></i> This feature is deprecated and will be removed soon.',
    
    // ========== LOADING/PROCESS MESSAGES ==========
    LOADING: '<i class="fas fa-spinner fa-spin"></i> Loading...',
    LOADING_DATA: '<i class="fas fa-spinner fa-spin"></i> Loading data...',
    
    SAVING: '<i class="fas fa-spinner fa-spin"></i> Saving...',
    SAVING_CHANGES: '<i class="fas fa-spinner fa-spin"></i> Saving changes...',
    
    DELETING: '<i class="fas fa-spinner fa-spin"></i> Deleting...',
    
    PROCESSING: '<i class="fas fa-spinner fa-spin"></i> Processing...',
    PROCESSING_FILE: '<i class="fas fa-spinner fa-spin"></i> Processing file...',
    
    UPLOADING: '<i class="fas fa-spinner fa-spin"></i> Uploading...',
    DOWNLOADING: '<i class="fas fa-spinner fa-spin"></i> Downloading...',
    
    GENERATING: '<i class="fas fa-spinner fa-spin"></i> Generating...',
    GENERATING_REPORT: '<i class="fas fa-spinner fa-spin"></i> Generating report...',
    
    // ========== INFO MESSAGES ==========
    NO_DATA: '<i class="fas fa-info-circle"></i> No data to display.',
    NO_RESULTS: '<i class="fas fa-info-circle"></i> No results found.',
    EMPTY_SELECTION: '<i class="fas fa-info-circle"></i> Please select at least one item.',
    
    // ========== CUSTOM MESSAGE BUILDERS ==========
    error: (message) => `<i class="fas fa-exclamation-circle"></i> ${message}`,
    success: (message) => `<i class="fas fa-check-circle"></i> ${message}`,
    warning: (message) => `<i class="fas fa-exclamation-triangle"></i> ${message}`,
    info: (message) => `<i class="fas fa-info-circle"></i> ${message}`,
};
