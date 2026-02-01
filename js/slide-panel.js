/**
 * SlidePanel - Reusable right slide panel utility
 *
 * A generic slide-in panel component that slides from the right on desktop
 * and appears as a bottom sheet on mobile. Features backdrop blur, smooth
 * animations, and keyboard accessibility.
 *
 * Usage:
 *
 * 1. Initialize with options:
 *    const panel = new SlidePanel({
 *        id: 'myPanel',
 *        title: 'Panel Title',
 *        width: '440px',        // Optional, default 440px
 *        onClose: () => { }     // Optional callback
 *    });
 *
 * 2. Open panel with content:
 *    panel.open({
 *        body: '<div>HTML content</div>',
 *        actions: [
 *            { label: 'Edit', icon: 'edit', onClick: () => {} },
 *            { label: 'Delete', icon: 'delete', onClick: () => {}, danger: true }
 *        ]
 *    });
 *
 * 3. Show loading state:
 *    panel.showLoading();
 *
 * 4. Update content:
 *    panel.setBody('<div>New content</div>');
 *    panel.setActions([...]);
 *
 * 5. Close:
 *    panel.close();
 *
 * 6. Destroy (remove from DOM):
 *    panel.destroy();
 */

class SlidePanel {
    constructor(options = {}) {
        this.id = options.id || 'slidePanel_' + Date.now();
        this.title = options.title || 'Details';
        this.width = options.width || '440px';
        this.onClose = options.onClose || null;
        this.onOpen = options.onOpen || null;
        this.escapeToClose = options.escapeToClose !== false;
        this.overlayClickToClose = options.overlayClickToClose !== false;

        this.isOpen = false;
        this.panel = null;
        this.overlay = null;

        this._boundKeyHandler = this._handleKeyDown.bind(this);
        this._init();
    }

    /**
     * Initialize the panel - create DOM elements
     */
    _init() {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'slide-panel-overlay';
        this.overlay.id = `${this.id}_overlay`;
        if (this.overlayClickToClose) {
            this.overlay.addEventListener('click', () => this.close());
        }

        // Create panel
        this.panel = document.createElement('div');
        this.panel.className = 'slide-panel';
        this.panel.id = this.id;
        this.panel.style.setProperty('--panel-width', this.width);

        this.panel.innerHTML = `
            <div class="panel-drag-handle"></div>
            <div class="panel-header">
                <h3 class="panel-title">${this._escapeHtml(this.title)}</h3>
                <button class="panel-close-btn" aria-label="Close panel">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="panel-body" id="${this.id}_body">
                <div class="panel-loading">
                    <div class="spinner"></div>
                </div>
            </div>
            <div class="panel-actions" id="${this.id}_actions">
                <div class="panel-actions-card">
                    <div class="panel-actions-content">
                        <div class="panel-actions-title">Quick Actions</div>
                        <div class="panel-action-buttons" id="${this.id}_actionButtons"></div>
                    </div>
                </div>
            </div>
        `;

        // Attach close button handler
        const closeBtn = this.panel.querySelector('.panel-close-btn');
        closeBtn.addEventListener('click', () => this.close());

        // Append to body
        document.body.appendChild(this.overlay);
        document.body.appendChild(this.panel);
    }

    /**
     * Open the panel
     * @param {Object} options - { body: string, actions: Array }
     */
    open(options = {}) {
        if (options.body) {
            this.setBody(options.body);
        }
        if (options.actions) {
            this.setActions(options.actions);
        } else {
            this.hideActions();
        }

        this.panel.classList.add('active');
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        this.isOpen = true;

        // Add escape key handler
        if (this.escapeToClose) {
            document.addEventListener('keydown', this._boundKeyHandler);
        }

        if (this.onOpen) {
            this.onOpen();
        }
    }

    /**
     * Close the panel
     */
    close() {
        this.panel.classList.remove('active');
        this.overlay.classList.remove('active');
        document.body.style.overflow = '';
        this.isOpen = false;

        // Remove escape key handler
        document.removeEventListener('keydown', this._boundKeyHandler);

        if (this.onClose) {
            this.onClose();
        }
    }

    /**
     * Toggle panel open/close
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Show loading spinner in body
     */
    showLoading() {
        const body = document.getElementById(`${this.id}_body`);
        if (body) {
            body.innerHTML = '<div class="panel-loading"><div class="spinner"></div></div>';
        }
        this.hideActions();
    }

    /**
     * Set the body content
     * @param {string} html - HTML content
     */
    setBody(html) {
        const body = document.getElementById(`${this.id}_body`);
        if (body) {
            body.innerHTML = html;
        }
    }

    /**
     * Set the panel title
     * @param {string} title - New title
     */
    setTitle(title) {
        this.title = title;
        const titleEl = this.panel.querySelector('.panel-title');
        if (titleEl) {
            titleEl.textContent = title;
        }
    }

    /**
     * Set action buttons
     * @param {Array} actions - Array of action objects
     * Each action: { label, icon, onClick, danger, fullWidth }
     */
    setActions(actions) {
        const actionsContainer = document.getElementById(`${this.id}_actions`);
        const buttonsContainer = document.getElementById(`${this.id}_actionButtons`);

        if (!actions || actions.length === 0) {
            this.hideActions();
            return;
        }

        actionsContainer.style.display = '';

        buttonsContainer.innerHTML = actions.map((action, index) => {
            const classes = ['panel-action-btn'];
            if (action.danger) classes.push('danger');
            if (action.fullWidth) classes.push('full-width');

            return `
                <button class="${classes.join(' ')}" data-action-index="${index}">
                    ${action.icon ? this._getIcon(action.icon) : ''}
                    ${this._escapeHtml(action.label)}
                </button>
            `;
        }).join('');

        // Attach click handlers
        buttonsContainer.querySelectorAll('.panel-action-btn').forEach((btn, index) => {
            btn.addEventListener('click', () => {
                if (actions[index].onClick) {
                    actions[index].onClick();
                }
            });
        });
    }

    /**
     * Hide the actions section
     */
    hideActions() {
        const actionsContainer = document.getElementById(`${this.id}_actions`);
        if (actionsContainer) {
            actionsContainer.style.display = 'none';
        }
    }

    /**
     * Show the actions section
     */
    showActions() {
        const actionsContainer = document.getElementById(`${this.id}_actions`);
        if (actionsContainer) {
            actionsContainer.style.display = '';
        }
    }

    /**
     * Destroy the panel and remove from DOM
     */
    destroy() {
        this.close();
        if (this.panel && this.panel.parentNode) {
            this.panel.parentNode.removeChild(this.panel);
        }
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }

    /**
     * Handle keyboard events
     */
    _handleKeyDown(e) {
        if (e.key === 'Escape' && this.isOpen) {
            this.close();
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get SVG icon by name
     */
    _getIcon(name) {
        const icons = {
            'edit': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>`,
            'delete': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>`,
            'view': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>`,
            'history': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>`,
            'transfer': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 10 20 15 15 20"/>
                <path d="M4 4v7a4 4 0 0 0 4 4h12"/>
            </svg>`,
            'user': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
            </svg>`,
            'users': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>`,
            'close': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>`,
            'check': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>`,
            'download': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>`,
            'upload': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>`,
            'share': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>`,
            'settings': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>`,
            'info': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>`,
            'mail': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
            </svg>`,
            'phone': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>`,
            'calendar': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>`,
            'briefcase': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            </svg>`,
            'building': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="4" y="2" width="16" height="20" rx="2" ry="2"/>
                <path d="M9 22v-4h6v4"/>
                <line x1="8" y1="6" x2="8" y2="6"/>
                <line x1="12" y1="6" x2="12" y2="6"/>
                <line x1="16" y1="6" x2="16" y2="6"/>
                <line x1="8" y1="10" x2="8" y2="10"/>
                <line x1="12" y1="10" x2="12" y2="10"/>
                <line x1="16" y1="10" x2="16" y2="10"/>
                <line x1="8" y1="14" x2="8" y2="14"/>
                <line x1="12" y1="14" x2="12" y2="14"/>
                <line x1="16" y1="14" x2="16" y2="14"/>
            </svg>`,
            'folder': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>`,
            'file': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
            </svg>`,
            'plus': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>`,
            'minus': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>`,
            'refresh': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>`,
            'print': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
            </svg>`,
            'copy': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>`,
            'link': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>`,
            'external': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>`,
            'money': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>`,
            'chart': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>`,
            'clock': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>`,
            'location': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
            </svg>`
        };

        return icons[name] || '';
    }
}

/**
 * Helper to create info sections for the panel body
 */
SlidePanel.createInfoSection = function(options) {
    const { title, icon, iconColor, items } = options;

    const iconHtml = icon ? `
        <div class="panel-section-icon ${iconColor || ''}">
            ${typeof icon === 'string' ? SlidePanel.prototype._getIcon.call({}, icon) : icon}
        </div>
    ` : '';

    const itemsHtml = items.map(item => {
        const fullClass = item.fullWidth ? ' panel-info-item-full' : '';
        return `
            <div class="panel-info-item${fullClass}">
                <span class="panel-info-label">${item.label}</span>
                <span class="panel-info-value">${item.value || '-'}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="panel-section">
            <div class="panel-section-header">
                ${iconHtml}
                <h4 class="panel-section-title">${title}</h4>
            </div>
            <div class="panel-info-grid">
                ${itemsHtml}
            </div>
        </div>
    `;
};

/**
 * Helper to create a header card for the panel
 */
SlidePanel.createHeaderCard = function(options) {
    const { avatar, title, subtitle, badges } = options;

    let avatarHtml = '';
    if (avatar) {
        if (avatar.image) {
            avatarHtml = `
                <div class="panel-employee-avatar">
                    <img src="${avatar.image}" alt="${title}" onerror="this.parentElement.innerHTML='${avatar.initials || ''}'">
                </div>
            `;
        } else {
            avatarHtml = `<div class="panel-employee-avatar">${avatar.initials || ''}</div>`;
        }
    }

    const badgesHtml = badges ? badges.map(b =>
        `<span class="status-badge ${b.class || ''}">${b.text}</span>`
    ).join('') : '';

    return `
        <div class="panel-employee-header">
            ${avatarHtml}
            <div class="panel-employee-info">
                <h2 class="panel-employee-name">${title}</h2>
                <div class="panel-employee-meta">
                    ${subtitle ? `<span>${subtitle}</span>` : ''}
                    ${badgesHtml}
                </div>
            </div>
        </div>
    `;
};

// Make SlidePanel globally available
window.SlidePanel = SlidePanel;
