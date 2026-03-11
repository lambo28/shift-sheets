/**
 * Form input validation utilities
 * All validators return null on success, or error message string on failure
 * 
 * Usage:
 *   const error = Validate.driver_id(value);
 *   if (error) {
 *       showAlertBanner('error', error);
 *       return;
 *   }
 * 
 * @type {Object}
 */
const Validate = {
    /**
     * Validate positive integer with bounds
     * @param {*} val - Value to validate
     * @param {Object} options - {min, max, name}
     * @returns {string|null} Error message or null
     */
    positive_integer(val, options = {}) {
        const { min = 1, max = Infinity, name = 'Value' } = options;
        const num = parseInt(val, 10);
        
        if (val === null || val === undefined || val === '') {
            return `${name} is required`;
        }
        
        if (isNaN(num)) {
            return `${name} must be a number`;
        }
        
        if (num < min) {
            return `${name} must be at least ${min}`;
        }
        
        if (num > max) {
            return `${name} must be at most ${max}`;
        }
        
        return null;
    },
    
    /**
     * Validate driver ID (1-999999)
     * @param {*} val 
     * @returns {string|null}
     */
    driver_id(val) {
        return this.positive_integer(val, { 
            min: 1, 
            max: 999999, 
            name: 'Driver ID' 
        });
    },
    
    /**
     * Validate cycle length (1-365)
     * @param {*} val 
     * @returns {string|null}
     */
    cycle_length(val) {
        return this.positive_integer(val, { 
            min: 1, 
            max: 365, 
            name: 'Cycle length' 
        });
    },
    
    /**
     * Validate date string in YYYY-MM-DD format
     * @param {*} val 
     * @returns {string|null}
     */
    date_string(val) {
        if (!val) return 'Date is required';
        
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            return 'Invalid date format (use YYYY-MM-DD)';
        }
        
        const date = new Date(val + 'T00:00:00');
        if (isNaN(date.getTime())) {
            return 'Invalid date';
        }
        
        return null;
    },
    
    /**
     * Validate time string in HH:MM format
     * @param {*} val 
     * @returns {string|null}
     */
    time_string(val) {
        if (!val) return 'Time is required';
        
        if (!/^\d{2}:\d{2}$/.test(val)) {
            return 'Invalid time format (use HH:MM)';
        }
        
        const [h, m] = val.split(':').map(Number);
        
        if (h < 0 || h > 23 || m < 0 || m > 59) {
            return 'Invalid time values (hours 0-23, minutes 0-59)';
        }
        
        return null;
    },
    
    /**
     * Validate email address
     * @param {*} val 
     * @returns {string|null}
     */
    email(val) {
        if (!val) return 'Email is required';
        
        // Basic email validation - more complex regex available if needed
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
            return 'Invalid email address';
        }
        
        return null;
    },
    
    /**
     * Validate required field (non-empty string)
     * @param {*} val 
     * @param {string} fieldName - Field display name
     * @returns {string|null}
     */
    required(val, fieldName = 'This field') {
        if (val === null || val === undefined) {
            return `${fieldName} is required`;
        }
        
        if (typeof val === 'string' && val.trim() === '') {
            return `${fieldName} is required`;
        }
        
        if (typeof val === 'number' && isNaN(val)) {
            return `${fieldName} is required`;
        }
        
        return null;
    },
    
    /**
     * Validate minimum string length
     * @param {*} val 
     * @param {number} min 
     * @returns {string|null}
     */
    min_length(val, min) {
        if (!val) return `Required field (minimum ${min} characters)`;
        
        const str = String(val);
        if (str.length < min) {
            return `Must be at least ${min} characters (currently ${str.length})`;
        }
        
        return null;
    },
    
    /**
     * Validate maximum string length
     * @param {*} val 
     * @param {number} max 
     * @returns {string|null}
     */
    max_length(val, max) {
        if (!val) return null;
        
        const str = String(val);
        if (str.length > max) {
            return `Must be at most ${max} characters (currently ${str.length})`;
        }
        
        return null;
    },
    
    /**
     * Validate URL format
     * @param {*} val 
     * @returns {string|null}
     */
    url(val) {
        if (!val) return 'URL is required';
        
        try {
            new URL(val);
            return null;
        } catch {
            return 'Invalid URL format';
        }
    },
    
    /**
     * Validate match between two values (passwords, etc)
     * @param {*} val1 
     * @param {*} val2 
     * @param {string} fieldName 
     * @returns {string|null}
     */
    match(val1, val2, fieldName = 'Values') {
        if (val1 !== val2) {
            return `${fieldName} do not match`;
        }
        return null;
    },
    
    /**
     * Run multiple validations, return first error or null
     * @param {Object} validators - {fieldName: [validator_fn, validator_fn, ...], ...}
     * @returns {string|null} First error found or null
     */
    multi(validators) {
        for (const [fieldName, validatorFunctions] of Object.entries(validators)) {
            if (!Array.isArray(validatorFunctions)) continue;
            
            for (const validatorFn of validatorFunctions) {
                if (typeof validatorFn !== 'function') continue;
                
                const error = validatorFn();
                if (error) return error;
            }
        }
        return null;
    }
};
