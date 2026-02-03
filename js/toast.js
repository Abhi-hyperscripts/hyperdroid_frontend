/**
 * Unified Toast Notification System for Ragenaizer
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
            max-width: calc(100vw - 48px);
            width: 400px;
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

    /**
     * Create and show an action toast with Yes/No buttons
     * Used for prompting users to take action (e.g., refresh page)
     * @param {string} message - The message to display
     * @param {object} options - Configuration options
     * @returns {Promise<boolean>} - Resolves to true if Yes clicked, false if No clicked or dismissed
     */
    function showAction(message, options = {}) {
        init();

        const {
            type = 'info',
            yesText = 'Yes',
            noText = 'No',
            title = null
        } = options;

        const themeColors = getColors();
        const colors = themeColors[type] || themeColors.info;
        const icon = ICONS[type] || ICONS.info;

        return new Promise((resolve) => {
            // Limit concurrent toasts
            while (container.children.length >= CONFIG.maxToasts) {
                const oldest = container.firstChild;
                if (oldest) removeToast(oldest);
            }

            // Create toast element
            const toast = document.createElement('div');
            toast.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 10px;
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
                max-width: 100%;
                word-wrap: break-word;
            `;

            // Build title HTML if provided
            const titleHtml = title ? `<div style="font-weight: 600; font-size: 13px; margin-bottom: 2px;">${escapeHtml(title)}</div>` : '';

            // Toast content with buttons
            toast.innerHTML = `
                <div style="display: flex; align-items: flex-start; gap: 12px;">
                    <div style="flex-shrink: 0; margin-top: 1px;">${icon}</div>
                    <div style="flex: 1;">
                        ${titleHtml}
                        <div>${escapeHtml(message)}</div>
                    </div>
                    <button class="toast-dismiss-btn" style="
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
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
                    <button class="toast-no-btn" style="
                        padding: 6px 14px;
                        font-size: 12px;
                        font-weight: 500;
                        border: 1px solid rgba(255,255,255,0.3);
                        background: transparent;
                        color: var(--text-inverse);
                        border-radius: 4px;
                        cursor: pointer;
                        transition: background 0.2s;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">${escapeHtml(noText)}</button>
                    <button class="toast-yes-btn" style="
                        padding: 6px 14px;
                        font-size: 12px;
                        font-weight: 500;
                        border: none;
                        background: rgba(255,255,255,0.2);
                        color: var(--text-inverse);
                        border-radius: 4px;
                        cursor: pointer;
                        transition: background 0.2s;
                    " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">${escapeHtml(yesText)}</button>
                </div>
            `;

            // Get button references
            const dismissBtn = toast.querySelector('.toast-dismiss-btn');
            const noBtn = toast.querySelector('.toast-no-btn');
            const yesBtn = toast.querySelector('.toast-yes-btn');

            // Track if already resolved
            let resolved = false;

            function closeAndResolve(result) {
                if (resolved) return;
                resolved = true;
                removeToast(toast);
                resolve(result);
            }

            // Button handlers
            dismissBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAndResolve(false);
            });

            noBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAndResolve(false);
            });

            yesBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAndResolve(true);
            });

            // Add to container
            container.appendChild(toast);

            // Trigger animation
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    toast.style.transform = 'translateX(0)';
                    toast.style.opacity = '1';
                });
            });

            // No auto-dismiss for action toasts - user must click a button
            // But auto-dismiss after 30 seconds to prevent stale toasts
            const timeoutId = setTimeout(() => closeAndResolve(false), 30000);
            toast.dataset.timeoutId = timeoutId;

            // Pause auto-dismiss on hover
            toast.addEventListener('mouseenter', () => {
                clearTimeout(parseInt(toast.dataset.timeoutId));
            });

            toast.addEventListener('mouseleave', () => {
                const newTimeoutId = setTimeout(() => closeAndResolve(false), 30000);
                toast.dataset.timeoutId = newTimeoutId;
            });
        });
    }

    // Public API
    return {
        show,
        success: (message, options) => show(message, 'success', options),
        error: (message, options) => show(message, 'error', options),
        warning: (message, options) => show(message, 'warning', options),
        info: (message, options) => show(message, 'info', options),
        action: showAction,
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

/**
 * Unified Confirmation Dialog System for Ragenaizer
 * Uses CSS variables from theme.css for full theme awareness
 *
 * Usage:
 *   // Async/await pattern (recommended)
 *   const confirmed = await Confirm.show('Are you sure?');
 *   if (confirmed) { ... }
 *
 *   // With options
 *   const confirmed = await Confirm.show({
 *       title: 'Delete Item',
 *       message: 'This action cannot be undone.',
 *       type: 'danger',
 *       confirmText: 'Delete',
 *       cancelText: 'Cancel'
 *   });
 *
 *   // Shorthand methods
 *   await Confirm.danger('Delete this item?', 'Delete Item');
 *   await Confirm.warning('Proceed with caution?');
 */
const Confirm = (function() {
    // Configuration
    const CONFIG = {
        animationDuration: 200
    };

    // Inject CSS styles once
    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;

        const style = document.createElement('style');
        style.textContent = `
            .confirm-overlay {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                background: var(--overlay-dark, rgba(0, 0, 0, 0.5)) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                z-index: 2147483647 !important;
                opacity: 0;
                transition: opacity 200ms ease;
            }

            .confirm-modal {
                background: rgba(15, 23, 42, 0.6) !important;
                border-radius: 16px !important;
                max-width: 380px;
                width: 90%;
                transform: scale(0.95);
                transition: transform 200ms ease, box-shadow 300ms ease, border-color 300ms ease;
                overflow: hidden;
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2) !important;
                backdrop-filter: blur(24px) saturate(150%);
                -webkit-backdrop-filter: blur(24px) saturate(150%);
            }

            /* Glow effect on hover only */
            .confirm-modal:hover {
                border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.5) !important;
                box-shadow:
                    0 0 20px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.25),
                    0 0 40px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.1),
                    0 8px 24px rgba(0, 0, 0, 0.2) !important;
            }

            /* Light theme adjustments */
            [data-theme="light"] .confirm-modal {
                background: rgba(255, 255, 255, 0.7) !important;
                border: 1px solid rgba(0, 0, 0, 0.06) !important;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08) !important;
            }

            [data-theme="light"] .confirm-modal:hover {
                border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.4) !important;
                box-shadow:
                    0 0 20px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.15),
                    0 0 40px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.08),
                    0 8px 24px rgba(0, 0, 0, 0.08) !important;
            }

            .confirm-content {
                padding: 20px 20px 16px 20px;
                position: relative;
                background: transparent;
            }

            /* Subtle gradient glow at top */
            .confirm-content::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 80px;
                background: linear-gradient(180deg, rgba(var(--brand-primary-rgb, 99, 102, 241), 0.06) 0%, transparent 100%);
                pointer-events: none;
                border-radius: 14px 14px 0 0;
            }

            .confirm-body {
                display: flex;
                align-items: flex-start;
                gap: 14px;
            }

            .confirm-icon {
                flex-shrink: 0;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .confirm-icon.danger {
                background: var(--color-danger-light);
                color: var(--color-danger);
            }

            .confirm-icon.warning {
                background: var(--color-warning-light);
                color: var(--color-warning);
            }

            .confirm-icon.info {
                background: var(--color-info-light);
                color: var(--color-info);
            }

            .confirm-icon.success {
                background: var(--color-success-light);
                color: var(--color-success);
            }

            .confirm-text {
                flex: 1;
                min-width: 0;
            }

            .confirm-title {
                margin: 0 0 6px 0;
                font-size: 15px;
                font-weight: 600;
                color: var(--text-primary);
                line-height: 1.4;
            }

            .confirm-message {
                margin: 0;
                font-size: 13px;
                color: var(--text-secondary);
                line-height: 1.5;
                white-space: pre-line;
            }

            .confirm-actions {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                padding: 14px 20px;
                background: rgba(0, 0, 0, 0.15);
                border-top: 1px solid rgba(255, 255, 255, 0.06);
            }

            [data-theme="light"] .confirm-actions {
                background: rgba(0, 0, 0, 0.03);
                border-top: 1px solid rgba(0, 0, 0, 0.06);
            }

            .confirm-btn {
                padding: 9px 18px;
                font-size: 13px;
                font-weight: 500;
                border-radius: 10px;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .confirm-btn-cancel {
                border: 1px solid var(--border-color-light, rgba(255,255,255,0.15));
                background: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.08);
                color: var(--text-primary);
            }

            .confirm-btn-cancel:hover {
                background: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.15);
                border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.3);
                transform: translateY(-1px);
            }

            .confirm-btn-ok {
                border: none;
                color: var(--text-inverse, white);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }

            .confirm-btn-ok:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
            }

            .confirm-btn-ok.danger {
                background: linear-gradient(135deg, var(--color-danger, #ef4444), var(--color-danger-dark, #dc2626));
            }

            .confirm-btn-ok.danger:hover {
                box-shadow: 0 6px 16px rgba(239, 68, 68, 0.4);
            }

            .confirm-btn-ok.warning {
                background: linear-gradient(135deg, var(--color-warning, #f59e0b), var(--color-warning-dark, #d97706));
            }

            .confirm-btn-ok.warning:hover {
                box-shadow: 0 6px 16px rgba(245, 158, 11, 0.4);
            }

            .confirm-btn-ok.info {
                background: linear-gradient(135deg, var(--color-info, #3b82f6), var(--color-info-dark, #2563eb));
            }

            .confirm-btn-ok.info:hover {
                box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
            }

            .confirm-btn-ok.success {
                background: linear-gradient(135deg, var(--color-success, #10b981), var(--color-success-dark, #059669));
            }

            .confirm-btn-ok.success:hover {
                box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
            }

            /* Loading spinner */
            .confirm-btn-ok.loading {
                pointer-events: none;
                opacity: 0.8;
            }

            .confirm-btn-ok .btn-spinner {
                display: none;
                width: 14px;
                height: 14px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: confirm-spin 0.8s linear infinite;
            }

            .confirm-btn-ok.loading .btn-spinner {
                display: inline-block;
            }

            .confirm-btn-ok.loading .btn-text {
                display: none;
            }

            @keyframes confirm-spin {
                to { transform: rotate(360deg); }
            }

            .confirm-btn-cancel:disabled {
                opacity: 0.5;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    // Type configurations (icons only)
    const ICONS = {
        danger: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>`,
        warning: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>`,
        info: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>`,
        success: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>`
    };

    // Current modal element
    let currentModal = null;

    /**
     * Show confirmation dialog
     * @param {string|object} options - Message string or options object
     * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
     */
    function show(options = {}) {
        // Inject styles on first use
        injectStyles();

        // Handle string argument
        if (typeof options === 'string') {
            options = { message: options };
        }

        const {
            title = 'Confirm',
            message = 'Are you sure you want to proceed?',
            type = 'info',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            showCancel = true,
            onConfirm = null,  // Async function to run on confirm
            loadingText = 'Processing...'
        } = options;

        const icon = ICONS[type] || ICONS.info;

        return new Promise((resolve) => {
            // Remove existing modal if any
            if (currentModal) {
                currentModal.remove();
            }

            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'confirm-overlay';

            // Create modal
            const modal = document.createElement('div');
            modal.className = 'confirm-modal';

            modal.innerHTML = `
                <div class="confirm-content">
                    <div class="confirm-body">
                        <div class="confirm-icon ${type}">
                            ${icon}
                        </div>
                        <div class="confirm-text">
                            <h3 class="confirm-title">${escapeHtml(title)}</h3>
                            <p class="confirm-message">${escapeHtml(message)}</p>
                        </div>
                    </div>
                </div>
                <div class="confirm-actions">
                    ${showCancel ? `<button class="confirm-btn confirm-btn-cancel">${escapeHtml(cancelText)}</button>` : ''}
                    <button class="confirm-btn confirm-btn-ok ${type}">
                        <span class="btn-text">${escapeHtml(confirmText)}</span>
                        <span class="btn-spinner"></span>
                    </button>
                </div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            currentModal = overlay;

            // Get button references
            const cancelBtn = modal.querySelector('.confirm-btn-cancel');
            const okBtn = modal.querySelector('.confirm-btn-ok');

            // Animate in
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    overlay.style.opacity = '1';
                    modal.style.transform = 'scale(1)';
                });
            });

            // Close function
            function close(result) {
                overlay.style.opacity = '0';
                modal.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    overlay.remove();
                    currentModal = null;
                    resolve(result);
                }, CONFIG.animationDuration);
            }

            // Set loading state
            function setLoading(loading) {
                if (loading) {
                    okBtn.classList.add('loading');
                    if (cancelBtn) cancelBtn.disabled = true;
                } else {
                    okBtn.classList.remove('loading');
                    if (cancelBtn) cancelBtn.disabled = false;
                }
            }

            // Event handlers
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => close(false));
            }

            okBtn.addEventListener('click', async () => {
                if (onConfirm) {
                    // If onConfirm callback provided, run it with loading state
                    setLoading(true);
                    try {
                        await onConfirm();
                        close(true);
                    } catch (error) {
                        setLoading(false);
                        console.error('Confirm action failed:', error);
                        // Optionally show error toast
                        if (typeof Toast !== 'undefined') {
                            Toast.error(error.message || 'Action failed');
                        }
                    }
                } else {
                    // Default behavior: just close and resolve
                    close(true);
                }
            });

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    close(false);
                }
            });

            // Close on Escape key
            function handleKeydown(e) {
                if (e.key === 'Escape') {
                    close(false);
                    document.removeEventListener('keydown', handleKeydown);
                } else if (e.key === 'Enter') {
                    close(true);
                    document.removeEventListener('keydown', handleKeydown);
                }
            }
            document.addEventListener('keydown', handleKeydown);

            // Focus the confirm button
            okBtn.focus();
        });
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Public API
    return {
        show,
        danger: (message, title = 'Confirm') => show({ message, title, type: 'danger', confirmText: 'Delete' }),
        warning: (message, title = 'Warning') => show({ message, title, type: 'warning' }),
        info: (message, title = 'Confirm') => show({ message, title, type: 'info' }),
        success: (message, title = 'Confirm') => show({ message, title, type: 'success' })
    };
})();

/**
 * Legacy-style function for simple confirmations
 * Drop-in replacement for window.confirm()
 * @param {string} message - The confirmation message
 * @returns {Promise<boolean>}
 */
function showConfirm(message, title = 'Confirm', type = 'info') {
    return Confirm.show({ message, title, type });
}

/**
 * Info Modal - Theme-aware information display
 * Drop-in replacement for window.alert() with better formatting
 */
const InfoModal = (() => {
    let stylesInjected = false;

    function injectStyles() {
        if (stylesInjected) return;

        const style = document.createElement('style');
        style.textContent = `
            .info-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            .info-modal-overlay.show {
                opacity: 1;
            }
            .info-modal {
                background: var(--bg-card);
                border-radius: var(--border-radius-lg, 12px);
                box-shadow: var(--shadow-xl);
                max-width: 500px;
                width: 90%;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                transform: scale(0.9);
                transition: transform 0.2s ease;
            }
            .info-modal-overlay.show .info-modal {
                transform: scale(1);
            }
            .info-modal-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px 20px;
                border-bottom: 1px solid var(--border-color);
            }
            .info-modal-icon {
                width: 24px;
                height: 24px;
                flex-shrink: 0;
            }
            .info-modal-icon.info { color: var(--color-info); }
            .info-modal-icon.success { color: var(--color-success); }
            .info-modal-icon.warning { color: var(--color-warning); }
            .info-modal-icon.danger { color: var(--color-danger); }
            .info-modal-title {
                font-size: 16px;
                font-weight: 600;
                color: var(--text-primary);
                margin: 0;
                flex: 1;
            }
            .info-modal-close {
                background: var(--brand-primary);
                border: none;
                width: 28px;
                height: 28px;
                padding: 0;
                cursor: pointer;
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: opacity 0.15s ease;
            }
            .info-modal-close:hover {
                opacity: 0.9;
            }
            .info-modal-body {
                padding: 16px 20px;
                overflow-y: auto;
                flex: 1;
            }
            .info-modal-content {
                font-size: 13px;
                line-height: 1.6;
                color: var(--text-secondary);
                white-space: pre-wrap;
                font-family: var(--font-mono, 'SF Mono', Monaco, 'Cascadia Code', monospace);
            }
            .info-modal-html-content {
                font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
                white-space: normal;
            }
            /* Rich content styles for InfoModal */
            .info-modal-html-content .detail-grid {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 8px 16px;
                margin-bottom: 16px;
            }
            .info-modal-html-content .detail-label {
                color: var(--text-tertiary);
                font-size: 12px;
            }
            .info-modal-html-content .detail-value {
                color: var(--text-primary);
                font-weight: 500;
            }
            .info-modal-html-content .component-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 12px;
                font-size: 12px;
            }
            .info-modal-html-content .component-table th {
                text-align: left;
                padding: 8px;
                background: var(--gray-100);
                border-bottom: 1px solid var(--border-color);
                color: var(--text-secondary);
                font-weight: 600;
            }
            .info-modal-html-content .component-table td {
                padding: 8px;
                border-bottom: 1px solid var(--gray-200);
            }
            .info-modal-html-content .component-table tr:last-child td {
                border-bottom: none;
            }
            .info-modal-html-content .badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 10px;
                font-weight: 600;
                text-transform: uppercase;
            }
            .info-modal-html-content .badge-earning {
                background: var(--success-alpha-20, rgba(34, 197, 94, 0.2));
                color: var(--color-success-text, #15803d);
            }
            .info-modal-html-content .badge-deduction {
                background: var(--danger-alpha-20, rgba(239, 68, 68, 0.2));
                color: var(--color-danger-text, #dc2626);
            }
            .info-modal-html-content .badge-added {
                background: var(--success-alpha-20, rgba(34, 197, 94, 0.2));
                color: var(--color-success-text, #15803d);
            }
            .info-modal-html-content .badge-removed {
                background: var(--danger-alpha-20, rgba(239, 68, 68, 0.2));
                color: var(--color-danger-text, #dc2626);
            }
            .info-modal-html-content .badge-modified {
                background: var(--warning-alpha-20, rgba(234, 179, 8, 0.2));
                color: var(--color-warning-text, #a16207);
            }
            .info-modal-html-content .section-title {
                font-size: 12px;
                font-weight: 600;
                color: var(--text-secondary);
                margin: 16px 0 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .info-modal-html-content .section-title:first-child {
                margin-top: 0;
            }
            .info-modal-html-content .diff-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 0;
                border-bottom: 1px solid var(--gray-100);
            }
            .info-modal-html-content .diff-item:last-child {
                border-bottom: none;
            }
            .info-modal-html-content .diff-icon {
                width: 20px;
                height: 20px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: bold;
            }
            .info-modal-html-content .diff-icon.added {
                background: var(--success-alpha-20);
                color: var(--color-success);
            }
            .info-modal-html-content .diff-icon.removed {
                background: var(--danger-alpha-20);
                color: var(--color-danger);
            }
            .info-modal-html-content .diff-icon.modified {
                background: var(--warning-alpha-20);
                color: var(--color-warning);
            }
            .info-modal-html-content .summary-box {
                background: var(--gray-50);
                border-radius: 8px;
                padding: 12px;
                margin-top: 16px;
            }
            .info-modal-html-content .summary-row {
                display: flex;
                justify-content: space-between;
                padding: 4px 0;
                font-size: 13px;
            }
            .info-modal-html-content .summary-row.total {
                border-top: 2px solid var(--gray-300);
                margin-top: 8px;
                padding-top: 8px;
                font-weight: 600;
            }
            .info-modal-html-content .amount {
                font-family: var(--font-mono, monospace);
            }
            .info-modal-html-content .amount.positive {
                color: var(--color-success);
            }
            .info-modal-html-content .amount.negative {
                color: var(--color-danger);
            }
            .info-modal-footer {
                padding: 12px 20px;
                border-top: 1px solid var(--border-color);
                display: flex;
                justify-content: flex-end;
                background: var(--gray-50);
                border-radius: 0 0 var(--border-radius-lg, 12px) var(--border-radius-lg, 12px);
            }
            .info-modal-btn {
                padding: 8px 20px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s ease;
                border: none;
                background: var(--brand-primary);
                color: white;
            }
            .info-modal-btn:hover {
                opacity: 0.9;
            }
        `;
        document.head.appendChild(style);
        stylesInjected = true;
    }

    const icons = {
        info: '<svg class="info-modal-icon info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        success: '<svg class="info-modal-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
        warning: '<svg class="info-modal-icon warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        danger: '<svg class="info-modal-icon danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    };

    function show({ title = 'Information', message = '', type = 'info', buttonText = 'OK', html = false, maxWidth = null } = {}) {
        return new Promise((resolve) => {
            injectStyles();

            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            // If html=true, use message directly; otherwise escape it
            const bodyContent = html ? message : escapeHtml(message);
            // When using HTML content, don't use the monospace font class
            const contentClass = html ? 'info-modal-content info-modal-html-content' : 'info-modal-content';
            // Custom max-width if provided
            const modalStyle = maxWidth ? `style="max-width: ${maxWidth};"` : '';

            const overlay = document.createElement('div');
            overlay.className = 'info-modal-overlay';
            overlay.innerHTML = `
                <div class="info-modal" ${modalStyle}>
                    <div class="info-modal-header">
                        ${icons[type] || icons.info}
                        <h3 class="info-modal-title">${title}</h3>
                        <button class="info-modal-close" aria-label="Close">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="info-modal-body">
                        <div class="${contentClass}">${bodyContent}</div>
                    </div>
                    <div class="info-modal-footer">
                        <button class="info-modal-btn">${buttonText}</button>
                    </div>
                </div>
            `;

            function close() {
                overlay.classList.remove('show');
                setTimeout(() => {
                    overlay.remove();
                    resolve();
                }, 200);
            }

            overlay.querySelector('.info-modal-close').addEventListener('click', close);
            overlay.querySelector('.info-modal-btn').addEventListener('click', close);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close();
            });

            document.body.appendChild(overlay);
            requestAnimationFrame(() => overlay.classList.add('show'));

            // Focus the OK button
            overlay.querySelector('.info-modal-btn').focus();

            // Handle Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', handleEscape);
                    close();
                }
            };
            document.addEventListener('keydown', handleEscape);
        });
    }

    return { show };
})();

/**
 * Legacy-style function for info display
 * Drop-in replacement for window.alert()
 * @param {string} message - The message to display
 * @param {string} title - Optional title
 * @returns {Promise<void>}
 */
function showInfo(message, title = 'Information', type = 'info') {
    return InfoModal.show({ message, title, type });
}

/**
 * Prompt Modal - Theme-aware input prompt
 * Drop-in replacement for window.prompt() with better styling
 *
 * Usage:
 *   const value = await Prompt.show('Enter your name:', 'Default Name');
 *   const ctc = await Prompt.show({
 *       title: 'Salary Preview',
 *       message: 'Enter CTC for calculation:',
 *       defaultValue: '1200000',
 *       type: 'number',
 *       placeholder: 'e.g., 1200000'
 *   });
 */
const Prompt = (() => {
    let stylesInjected = false;

    function injectStyles() {
        if (stylesInjected) return;

        const style = document.createElement('style');
        style.textContent = `
            .prompt-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: var(--overlay-dark, rgba(0, 0, 0, 0.5));
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            .prompt-modal-overlay.show {
                opacity: 1;
            }
            .prompt-modal {
                background: var(--bg-card);
                border-radius: var(--border-radius-lg, 12px);
                box-shadow: var(--shadow-xl);
                max-width: 420px;
                width: 90%;
                display: flex;
                flex-direction: column;
                transform: scale(0.9);
                transition: transform 0.2s ease;
            }
            .prompt-modal-overlay.show .prompt-modal {
                transform: scale(1);
            }
            .prompt-modal-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px 20px;
                border-bottom: 1px solid var(--border-color);
            }
            .prompt-modal-icon {
                width: 24px;
                height: 24px;
                flex-shrink: 0;
                color: var(--color-info);
            }
            .prompt-modal-title {
                font-size: 16px;
                font-weight: 600;
                color: var(--text-primary);
                margin: 0;
                flex: 1;
            }
            .prompt-modal-close {
                background: var(--brand-primary);
                border: none;
                width: 28px;
                height: 28px;
                padding: 0;
                cursor: pointer;
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: opacity 0.15s ease;
            }
            .prompt-modal-close:hover {
                opacity: 0.9;
            }
            .prompt-modal-body {
                padding: 16px 20px;
            }
            .prompt-modal-message {
                font-size: 14px;
                color: var(--text-secondary);
                margin: 0 0 12px 0;
                line-height: 1.5;
            }
            .prompt-modal-input {
                width: 100%;
                padding: 10px 12px;
                font-size: 14px;
                border: 1px solid var(--border-color);
                border-radius: var(--border-radius-sm, 6px);
                background: var(--bg-input, var(--bg-card));
                color: var(--text-primary);
                transition: border-color 0.15s ease, box-shadow 0.15s ease;
                box-sizing: border-box;
            }
            .prompt-modal-input:focus {
                outline: none;
                border-color: var(--brand-primary);
                box-shadow: 0 0 0 3px var(--brand-primary-alpha-20, rgba(59, 130, 246, 0.2));
            }
            .prompt-modal-input::placeholder {
                color: var(--text-tertiary);
            }
            .prompt-modal-footer {
                padding: 12px 20px;
                border-top: 1px solid var(--border-color);
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                background: var(--gray-50);
                border-radius: 0 0 var(--border-radius-lg, 12px) var(--border-radius-lg, 12px);
            }
            .prompt-modal-btn {
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s ease;
            }
            .prompt-modal-btn-cancel {
                border: 1px solid var(--border-color);
                background: var(--bg-card);
                color: var(--text-primary);
            }
            .prompt-modal-btn-cancel:hover {
                background: var(--bg-card-hover, var(--gray-100));
            }
            .prompt-modal-btn-ok {
                border: none;
                background: var(--brand-primary);
                color: white;
            }
            .prompt-modal-btn-ok:hover {
                opacity: 0.9;
            }
        `;
        document.head.appendChild(style);
        stylesInjected = true;
    }

    /**
     * Show a prompt dialog
     * @param {string|object} options - Message string or options object
     * @returns {Promise<string|null>} - Resolves to input value or null if cancelled
     */
    function show(options = {}) {
        // Handle string argument (simple prompt)
        if (typeof options === 'string') {
            options = { message: options };
        }

        const {
            title = 'Input Required',
            message = 'Please enter a value:',
            defaultValue = '',
            placeholder = '',
            type = 'text',
            confirmText = 'OK',
            cancelText = 'Cancel'
        } = options;

        return new Promise((resolve) => {
            injectStyles();

            const overlay = document.createElement('div');
            overlay.className = 'prompt-modal-overlay';
            overlay.innerHTML = `
                <div class="prompt-modal">
                    <div class="prompt-modal-header">
                        <svg class="prompt-modal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                        <h3 class="prompt-modal-title">${escapeHtml(title)}</h3>
                        <button class="prompt-modal-close" aria-label="Close">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="prompt-modal-body">
                        <p class="prompt-modal-message">${escapeHtml(message)}</p>
                        <input
                            type="${type}"
                            class="prompt-modal-input"
                            value="${escapeHtml(defaultValue)}"
                            placeholder="${escapeHtml(placeholder)}"
                        />
                    </div>
                    <div class="prompt-modal-footer">
                        <button class="prompt-modal-btn prompt-modal-btn-cancel">${escapeHtml(cancelText)}</button>
                        <button class="prompt-modal-btn prompt-modal-btn-ok">${escapeHtml(confirmText)}</button>
                    </div>
                </div>
            `;

            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            const input = overlay.querySelector('.prompt-modal-input');
            const closeBtn = overlay.querySelector('.prompt-modal-close');
            const cancelBtn = overlay.querySelector('.prompt-modal-btn-cancel');
            const okBtn = overlay.querySelector('.prompt-modal-btn-ok');

            function close(value) {
                overlay.classList.remove('show');
                setTimeout(() => {
                    overlay.remove();
                    resolve(value);
                }, 200);
            }

            closeBtn.addEventListener('click', () => close(null));
            cancelBtn.addEventListener('click', () => close(null));
            okBtn.addEventListener('click', () => close(input.value));

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close(null);
            });

            // Handle Enter key in input
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    close(input.value);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    close(null);
                }
            });

            // Handle Escape key globally
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', handleEscape);
                    close(null);
                }
            };
            document.addEventListener('keydown', handleEscape);

            document.body.appendChild(overlay);
            requestAnimationFrame(() => {
                overlay.classList.add('show');
                input.focus();
                input.select();
            });
        });
    }

    return { show };
})();

/**
 * Legacy-style function for prompts
 * Drop-in replacement for window.prompt()
 * @param {string} message - The prompt message
 * @param {string} defaultValue - Optional default value
 * @returns {Promise<string|null>}
 */
function showPrompt(message, defaultValue = '', title = 'Input Required') {
    return Prompt.show({ message, defaultValue, title });
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Toast, showToast, Confirm, showConfirm, InfoModal, showInfo, Prompt, showPrompt };
}
