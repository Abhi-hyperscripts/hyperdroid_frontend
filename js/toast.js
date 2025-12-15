/**
 * Unified Toast Notification System for HyperDroid
 *
 * Usage:
 *   Toast.success('Operation completed successfully');
 *   Toast.error('Something went wrong');
 *   Toast.warning('Please check your input');
 *   Toast.info('New updates available');
 *
 *   // Or use the legacy function for backwards compatibility:
 *   showToast('Message', 'success');
 */

const Toast = (function() {
    // Configuration
    const CONFIG = {
        duration: 4000,          // How long toast stays visible (ms)
        animationDuration: 300,  // Slide animation duration (ms)
        maxToasts: 5,            // Maximum concurrent toasts
        position: 'top-right',   // Position: top-right, top-left, bottom-right, bottom-left
        offset: { top: 90, right: 24, bottom: 24, left: 24 } // Offset from edges (below navbar)
    };

    // Container element
    let container = null;

    // Icons for each toast type
    const ICONS = {
        success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>`,
        error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>`,
        warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>`,
        info: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>`
    };

    // Colors for each toast type - using CSS variables for theme compatibility
    function getColors() {
        const styles = getComputedStyle(document.documentElement);
        return {
            success: {
                bg: styles.getPropertyValue('--color-success').trim() || '#10b981',
                border: styles.getPropertyValue('--color-success-dark').trim() || '#059669'
            },
            error: {
                bg: styles.getPropertyValue('--color-danger').trim() || '#ef4444',
                border: styles.getPropertyValue('--color-danger-dark').trim() || '#dc2626'
            },
            warning: {
                bg: styles.getPropertyValue('--color-warning').trim() || '#f59e0b',
                border: styles.getPropertyValue('--color-warning-dark').trim() || '#d97706'
            },
            info: {
                bg: styles.getPropertyValue('--color-info').trim() || '#3b82f6',
                border: styles.getPropertyValue('--color-info-dark').trim() || '#2563eb'
            }
        };
    }

    /**
     * Initialize the toast container
     */
    function init() {
        if (container) return;

        // Create container
        container = document.createElement('div');
        container.id = 'unified-toast-container';
        container.style.cssText = `
            position: fixed;
            top: ${CONFIG.offset.top}px;
            right: ${CONFIG.offset.right}px;
            z-index: 99999999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
            max-width: 400px;
            width: 100%;
        `;

        document.body.appendChild(container);
    }

    /**
     * Create and show a toast notification
     * @param {string} message - The message to display
     * @param {string} type - Toast type: success, error, warning, info
     * @param {object} options - Optional configuration overrides
     */
    function show(message, type = 'info', options = {}) {
        init();

        const duration = options.duration || CONFIG.duration;
        const themeColors = getColors();
        const colors = themeColors[type] || themeColors.info;
        const icon = ICONS[type] || ICONS.info;

        // Limit concurrent toasts
        while (container.children.length >= CONFIG.maxToasts) {
            const oldest = container.firstChild;
            if (oldest) removeToast(oldest);
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.style.cssText = `
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 14px 16px;
            background: ${colors.bg};
            border-left: 4px solid ${colors.border};
            border-radius: 8px;
            box-shadow: var(--shadow-lg);
            color: var(--text-inverse);
            font-size: 14px;
            font-weight: 500;
            line-height: 1.4;
            pointer-events: auto;
            transform: translateX(120%);
            transition: transform ${CONFIG.animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${CONFIG.animationDuration}ms ease;
            opacity: 0;
            cursor: pointer;
            max-width: 100%;
            word-wrap: break-word;
        `;

        // Toast content
        toast.innerHTML = `
            <div style="flex-shrink: 0; margin-top: 1px;">${icon}</div>
            <div style="flex: 1; margin-right: 8px;">${escapeHtml(message)}</div>
            <button style="
                flex-shrink: 0;
                background: none;
                border: none;
                color: var(--text-inverse);
                opacity: 0.7;
                cursor: pointer;
                padding: 0;
                font-size: 18px;
                line-height: 1;
                transition: opacity 0.2s;
            " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">&times;</button>
        `;

        // Close button handler
        const closeBtn = toast.querySelector('button');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeToast(toast);
        });

        // Click anywhere on toast to dismiss
        toast.addEventListener('click', () => removeToast(toast));

        // Add to container
        container.appendChild(toast);

        // Trigger animation (use requestAnimationFrame for smooth animation)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.transform = 'translateX(0)';
                toast.style.opacity = '1';
            });
        });

        // Auto-remove after duration
        const timeoutId = setTimeout(() => removeToast(toast), duration);

        // Store timeout ID for potential cancellation
        toast.dataset.timeoutId = timeoutId;

        // Pause auto-dismiss on hover
        toast.addEventListener('mouseenter', () => {
            clearTimeout(parseInt(toast.dataset.timeoutId));
        });

        toast.addEventListener('mouseleave', () => {
            const newTimeoutId = setTimeout(() => removeToast(toast), 1500);
            toast.dataset.timeoutId = newTimeoutId;
        });

        return toast;
    }

    /**
     * Remove a toast with animation
     * @param {HTMLElement} toast - The toast element to remove
     */
    function removeToast(toast) {
        if (!toast || !toast.parentNode) return;

        // Clear any pending timeout
        if (toast.dataset.timeoutId) {
            clearTimeout(parseInt(toast.dataset.timeoutId));
        }

        // Animate out
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';

        // Remove after animation
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, CONFIG.animationDuration);
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Clear all toasts
     */
    function clearAll() {
        if (!container) return;
        Array.from(container.children).forEach(toast => removeToast(toast));
    }

    // Public API
    return {
        show,
        success: (message, options) => show(message, 'success', options),
        error: (message, options) => show(message, 'error', options),
        warning: (message, options) => show(message, 'warning', options),
        info: (message, options) => show(message, 'info', options),
        clear: clearAll
    };
})();

/**
 * Legacy function for backwards compatibility
 * Maps old showToast(message, type) calls to new Toast API
 */
function showToast(message, type = 'success') {
    // Map legacy type names to new ones
    const typeMap = {
        'success': 'success',
        'error': 'error',
        'warning': 'warning',
        'info': 'info',
        'danger': 'error'  // Some implementations use 'danger'
    };

    const mappedType = typeMap[type] || 'info';
    Toast.show(message, mappedType);
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Toast, showToast };
}
