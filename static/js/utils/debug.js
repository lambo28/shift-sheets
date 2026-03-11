/**
 * Debug logging utility - respects log level
 * 
 * Usage:
 *   DEBUG.log('User clicked button', 'info', { userId: 123 })
 *   DEBUG.error('Failed to save', 'error', { error });
 *   DEBUG.warn('Deprecated function used', 'warn');
 * 
 * Control level from browser console:
 *   DEBUG.setLevel('debug')   - See all logs
 *   DEBUG.setLevel('info')    - See info, warn, error (default)
 *   DEBUG.setLevel('error')   - See only errors
 * 
 * @type {Object}
 */
const DEBUG = (() => {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    let currentLevel = localStorage.getItem('DEBUG_LEVEL') || 'info';
    
    const getPrefix = (level) => {
        const emoji = {
            debug: '🔍',
            info: 'ℹ️',
            warn: '⚠️',
            error: '❌'
        };
        const timestamp = new Date().toLocaleTimeString();
        return `${emoji[level] || '•'} [${timestamp}] [${level.toUpperCase()}]`;
    };
    
    return {
        /**
         * Set logging level
         * @param {string} level - 'debug', 'info', 'warn', 'error'
         */
        setLevel(level) {
            if (!levels.hasOwnProperty(level)) {
                console.warn(`Invalid debug level: ${level}`);
                return;
            }
            currentLevel = level;
            localStorage.setItem('DEBUG_LEVEL', level);
            console.log(`%cDebug level set to: ${level}`, 'color: #0d6efd; font-weight: bold;');
        },
        
        /**
         * Generic log function
         * @param {string} message - Log message
         * @param {string} level - 'debug', 'info', 'warn', 'error'
         * @param {*} data - Optional data to log
         */
        log(message, level = 'info', data = null) {
            if (!levels.hasOwnProperty(level)) level = 'info';
            if (levels[level] >= levels[currentLevel]) {
                const prefix = getPrefix(level);
                if (data) {
                    console.log(`%c${prefix} ${message}`, 'color: #0d6efd; font-weight: bold;', data);
                } else {
                    console.log(`%c${prefix} ${message}`, 'color: #0d6efd; font-weight: bold;');
                }
            }
        },
        
        /**
         * Debug level logging (lowest priority)
         * @param {string} message 
         * @param {*} data 
         */
        debug(message, data) {
            this.log(message, 'debug', data);
        },
        
        /**
         * Info level logging (default minimum)
         * @param {string} message 
         * @param {*} data 
         */
        info(message, data) {
            this.log(message, 'info', data);
        },
        
        /**
         * Warning level logging
         * @param {string} message 
         * @param {*} data 
         */
        warn(message, data) {
            this.log(message, 'warn', data);
        },
        
        /**
         * Error level logging (highest priority)
         * @param {string} message 
         * @param {*} data 
         */
        error(message, data) {
            this.log(message, 'error', data);
        },
        
        /**
         * Get current debug level
         * @returns {string}
         */
        getLevel() {
            return currentLevel;
        }
    };
})();

// Initialize - log that debug module loaded
if (window.location.href.includes('localhost') || window.location.href.includes('127.0.0.1')) {
    DEBUG.debug('Debug module loaded');
}
