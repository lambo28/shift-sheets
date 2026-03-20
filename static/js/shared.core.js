/**
 * shared.core.js
 * Shared utilities for all pages
 * No dependencies
 */

/**
 * Clean up orphaned Bootstrap modal backdrop elements
 * Called after modals close to restore page interactivity
 */
function cleanupModalArtifacts() {
    const openModals = document.querySelectorAll('.modal.show');
    if (openModals.length > 0) {
        return;
    }

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

/**
 * Close a modal by ID with proper cleanup
 * @param {string} modalId - The ID of the modal element
 */
function hideModalById(modalId) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl || typeof bootstrap === 'undefined') {
        cleanupModalArtifacts();
        return;
    }

    modalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts, { once: true });
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    setTimeout(cleanupModalArtifacts, 400);
}

/**
 * Display a notification banner with auto-dismiss
 * Fixed position, top-right corner with slide animation
 * @param {string} type - Alert type: 'success', 'danger', 'warning', 'info', 'error'
 * @param {string} message - HTML message to display
 * @param {boolean} autoDismiss - Auto-close after duration (default: true)
 * @param {number} duration - Time in ms before auto-dismiss (default: 4000)
 */
function showAlertBanner(type = 'info', message = 'Message', autoDismiss = true, duration = 4000) {
    const container = document.getElementById('alertBannerContainer');
    const alertId = 'alert-' + Date.now();

    const alertClass = {
        'success': 'alert-success',
        'error': 'alert-danger',
        'danger': 'alert-danger',
        'warning': 'alert-warning',
        'info': 'alert-info'
    }[type] || 'alert-info';

    const alert = document.createElement('div');
    alert.id = alertId;
    alert.className = `alert alert-banner ${alertClass} alert-dismissible fade show`;
    alert.role = 'alert';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    container.appendChild(alert);

    if (autoDismiss) {
        setTimeout(() => {
            const alertEl = document.getElementById(alertId);
            if (alertEl) {
                alertEl.classList.add('dismissing');
                setTimeout(() => alertEl.remove(), 300);
            }
        }, duration);
    }
}

/**
 * Fetch JSON from server with error handling
 * @param {string} url - Endpoint URL
 * @param {object} options - Fetch options
 * @returns {object} - {success: boolean, ...data}
 */
async function requestJson(url, options = {}) {
    const response = await fetch(url, options);

    let data;
    try {
        data = await response.json();
    } catch {
        data = { success: false, error: `HTTP ${response.status}` };
    }

    if (!response.ok) {
        return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    return data;
}

/**
 * Initialize modal cleanup binding for all modals
 * Attaches cleanup to hidden.bs.modal event
 */
function initializeModalCleanup() {
    document.querySelectorAll('.modal').forEach((modalEl) => {
        modalEl.addEventListener('hidden.bs.modal', cleanupModalArtifacts);
    });
}

/**
 * Format text to title case (capitalize first letter of each word)
 * @param {string} value - Text to format
 * @returns {string} - Title cased text
 */
function formatTitleCase(value) {
    const normalized = String(value || '').replace(/_/g, ' ').trim();
    if (!normalized) return '';

    return normalized
        .split(/\s+/)
        .map((part) => {
            const lower = part.toLowerCase();
            if (lower === 'am' || lower === 'pm') {
                return lower.toUpperCase();
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
}

/**
 * Generic form submission handler with button state management, error handling, and UI feedback
 * Reduces duplication across multiple form submission handlers
 * @param {HTMLFormElement} form - The form element to submit
 * @param {HTMLElement|string} submitButton - Submit button element or ID
 * @param {object} options - Configuration options:
 *   - action: {string} Form action URL (overrides form.action)
 *   - successMessage: {string} Custom success message
 *   - errorMessage: {string} Custom error message
 *   - onSuccess: {function} Callback after successful submission
 *   - onError: {function} Callback after error
 *   - hideModal: {string} Modal ID to hide on success
 *   - resetForm: {boolean} Reset form on success (default: false)
 *   - validateFn: {function} Pre-submission validation function
 *   - formDataFn: {function} Custom FormData preparation function (called with form, returns FormData)
 *   - savingLabel: {string} Button text while saving (default: from MESSAGES.SAVING)
 * @returns {Promise<object>} - Response data
 */
async function submitForm(form, submitButton, options = {}) {
    if (!form) {
        console.error('submitForm: Form element not found');
        return { success: false };
    }

    // Resolve submit button
    let btnEl = submitButton;
    if (typeof submitButton === 'string') {
        btnEl = document.getElementById(submitButton);
    }
    if (!btnEl) {
        console.error('submitForm: Submit button not found', submitButton);
        return { success: false };
    }

    // Run pre-submission validation if provided
    if (options.validateFn && typeof options.validateFn === 'function') {
        const validationError = options.validateFn();
        if (validationError) {
            showAlertBanner('error', validationError);
            return { success: false };
        }
    }

    // Save button state
    const originalHtml = btnEl.innerHTML;
    const savingLabel = options.savingLabel || (typeof MESSAGES !== 'undefined' && MESSAGES.SAVING ? MESSAGES.SAVING : 'Saving...');

    // Disable button and show saving state
    btnEl.disabled = true;
    btnEl.innerHTML = savingLabel;

    try {
        // Prepare form data (use custom function if provided)
        let formData;
        if (options.formDataFn && typeof options.formDataFn === 'function') {
            formData = options.formDataFn(form);
        } else {
            formData = new FormData(form);
        }

        const formAction = options.action || form.action || '/';
        const fetchOptions = {
            method: 'POST',
            body: formData,
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        };

        // Make request
        const responseData = await requestJson(formAction, fetchOptions);

        // Handle response
        if (responseData.success) {
            const successMsg = options.successMessage || responseData.message || 'Saved successfully';
            showAlertBanner('success', successMsg);

            // Hide modal if specified
            if (options.hideModal) {
                hideModalById(options.hideModal);
            }

            // Reset form if specified
            if (options.resetForm) {
                form.reset();
            }

            // Custom success callback
            if (options.onSuccess && typeof options.onSuccess === 'function') {
                await options.onSuccess(responseData);
            }

            return responseData;
        } else {
            const errorMsg = options.errorMessage || responseData.error || 'An error occurred';
            showAlertBanner('error', errorMsg);

            // Custom error callback
            if (options.onError && typeof options.onError === 'function') {
                await options.onError(responseData);
            }

            return responseData;
        }
    } catch (error) {
        console.error('Form submission error:', error);
        const errorMsg = 'Network error. Please check your connection and try again.';
        showAlertBanner('error', errorMsg);

        if (options.onError && typeof options.onError === 'function') {
            await options.onError({ success: false, error });
        }

        return { success: false, error };
    } finally {
        // Restore button state
        btnEl.disabled = false;
        btnEl.innerHTML = originalHtml;
    }
}

/**
 * Initialize modal data population from button data attributes
 * Reduces duplication of modal show event handlers
 * 
 * @param {string} modalId - ID of the modal element
 * @param {string} formId - ID of the form element
 * @param {Object} fieldMappings - Mapping of data-* attribute names to form field IDs
 *                                  and optional URL template parts
 * 
 * @example
 * initializeModalDataPopulation('editTermModal', 'editTermForm', {
 *     dataAttrToFormField: {
 *         'data-term-id': null,  // Used only for URL, not a form field
 *         'data-term-name': 'editTermName',
 *         'data-term-start': 'editTermStartDate',
 *         'data-term-end': 'editTermEndDate'
 *     },
 *     urlPattern: '/scheduling/term/{data-term-id}/edit'
 * });
 */
function initializeModalDataPopulation(modalId, formId, config) {
    const modal = document.getElementById(modalId);
    const form = document.getElementById(formId);
    
    if (!modal || !form) return;
    
    modal.addEventListener('show.bs.modal', function(event) {
        const button = event.relatedTarget;
        if (!button) return;
        
        const dataAttrs = config.dataAttrToFormField || {};
        const urlPattern = config.urlPattern || '';
        
        // Extract all data attributes from button
        const buttonData = {};
        Object.keys(dataAttrs).forEach(attr => {
            buttonData[attr] = button.getAttribute(attr) || '';
        });
        
        // Populate form fields from button data
        Object.entries(dataAttrs).forEach(([attr, fieldId]) => {
            if (fieldId && buttonData[attr]) {
                const field = document.getElementById(fieldId);
                if (field) {
                    field.value = buttonData[attr];
                }
            }
        });
        
        // Set form action URL if pattern provided
        if (urlPattern) {
            let actionUrl = urlPattern;
            Object.entries(buttonData).forEach(([attr, value]) => {
                actionUrl = actionUrl.replace(`{${attr}}`, value);
            });
            form.action = actionUrl;
        }
    });
}
