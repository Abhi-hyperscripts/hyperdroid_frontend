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

/**
 * Unified Confirmation Dialog System for HyperDroid
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
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: var(--overlay-dark);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999999;
                opacity: 0;
                transition: opacity 200ms ease;
            }

            .confirm-modal {
                background: var(--bg-card);
                border-radius: var(--border-radius-lg);
                box-shadow: var(--shadow-xl);
                max-width: 380px;
                width: 90%;
                transform: scale(0.95);
                transition: transform 200ms ease;
                overflow: hidden;
            }

            .confirm-content {
                padding: 20px 20px 16px 20px;
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
                padding: 12px 20px;
                background: var(--gray-50);
                border-top: 1px solid var(--border-color);
            }

            .confirm-btn {
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 500;
                border-radius: var(--border-radius-sm);
                cursor: pointer;
                transition: var(--transition-fast);
            }

            .confirm-btn-cancel {
                border: 1px solid var(--border-color);
                background: var(--bg-card);
                color: var(--text-primary);
            }

            .confirm-btn-cancel:hover {
                background: var(--bg-card-hover);
            }

            .confirm-btn-ok {
                border: none;
                color: var(--text-inverse);
            }

            .confirm-btn-ok.danger {
                background: var(--color-danger);
            }

            .confirm-btn-ok.danger:hover {
                background: var(--color-danger-dark);
            }

            .confirm-btn-ok.warning {
                background: var(--color-warning);
            }

            .confirm-btn-ok.warning:hover {
                background: var(--color-warning-dark);
            }

            .confirm-btn-ok.info {
                background: var(--color-info);
            }

            .confirm-btn-ok.info:hover {
                background: var(--color-info-dark);
            }

            .confirm-btn-ok.success {
                background: var(--color-success);
            }

            .confirm-btn-ok.success:hover {
                background: var(--color-success-dark);
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
            showCancel = true
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
                    <button class="confirm-btn confirm-btn-ok ${type}">${escapeHtml(confirmText)}</button>
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

            // Event handlers
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => close(false));
            }
            okBtn.addEventListener('click', () => close(true));

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
                background: none;
                border: none;
                padding: 4px;
                cursor: pointer;
                color: var(--text-secondary);
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .info-modal-close:hover {
                background: var(--gray-100);
                color: var(--text-primary);
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

    function show({ title = 'Information', message = '', type = 'info', buttonText = 'OK' } = {}) {
        return new Promise((resolve) => {
            injectStyles();

            const overlay = document.createElement('div');
            overlay.className = 'info-modal-overlay';
            overlay.innerHTML = `
                <div class="info-modal">
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
                        <div class="info-modal-content">${escapeHtml(message)}</div>
                    </div>
                    <div class="info-modal-footer">
                        <button class="info-modal-btn">${buttonText}</button>
                    </div>
                </div>
            `;

            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

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

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Toast, showToast, Confirm, showConfirm, InfoModal, showInfo };
}
