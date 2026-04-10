/**
 * AccountsService — Shared Utility Module
 *
 * Common helpers for all AccountsService frontend pages.
 * Provides auth checks, sidebar setup, tab switching, RBAC,
 * formatting, pagination, modals, and API query helpers.
 *
 * Usage: include this script before any page-specific JS.
 *   <script src="../js/accounts/accounts-common.js"></script>
 */

// ============================================================================
// ROLE CONSTANTS & RBAC
// ============================================================================

const ACCOUNTS_ROLES = {
    SUPERADMIN: 'SUPERADMIN',
    ACCOUNTS_USER: 'ACCOUNTS_USER',
    ACCOUNTS_ADMIN: 'ACCOUNTS_ADMIN',
    ACCOUNTS_MANAGER: 'ACCOUNTS_MANAGER',
    ACCOUNTS_AUDITOR: 'ACCOUNTS_AUDITOR'
};

/**
 * RBAC helper — mirrors hrms/roleUtils.js pattern
 */
const accountsRoles = {
    _roles: [],
    _initialized: false,

    init() {
        const token = getAuthToken();
        if (!token) { this._roles = []; return; }
        const payload = decodeJwtPayload(token);
        if (!payload) { this._roles = []; return; }

        // ASP.NET Identity puts roles in 'role' claim (string or array)
        const raw = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
                 || payload.role || [];
        this._roles = Array.isArray(raw) ? raw : [raw];
        this._initialized = true;
    },

    hasRole(role) {
        return this._roles.includes(role);
    },

    hasAnyRole(...roles) {
        return roles.some(r => this._roles.includes(r));
    },

    /** Any accounts-related role or SUPERADMIN */
    canAccess() {
        return this.hasAnyRole(
            ACCOUNTS_ROLES.SUPERADMIN,
            ACCOUNTS_ROLES.ACCOUNTS_USER,
            ACCOUNTS_ROLES.ACCOUNTS_ADMIN,
            ACCOUNTS_ROLES.ACCOUNTS_MANAGER,
            ACCOUNTS_ROLES.ACCOUNTS_AUDITOR
        );
    },

    isAdmin() {
        return this.hasAnyRole(ACCOUNTS_ROLES.SUPERADMIN, ACCOUNTS_ROLES.ACCOUNTS_ADMIN);
    },

    isManager() {
        return this.hasAnyRole(
            ACCOUNTS_ROLES.SUPERADMIN,
            ACCOUNTS_ROLES.ACCOUNTS_ADMIN,
            ACCOUNTS_ROLES.ACCOUNTS_MANAGER
        );
    },

    isAuditor() {
        return this.hasAnyRole(
            ACCOUNTS_ROLES.SUPERADMIN,
            ACCOUNTS_ROLES.ACCOUNTS_ADMIN,
            ACCOUNTS_ROLES.ACCOUNTS_AUDITOR
        );
    },

    /** Show/hide an element by ID based on a permission flag */
    setElementVisibility(elementId, visible) {
        const el = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
        if (el) el.style.display = visible ? '' : 'none';
    },

    /**
     * Hide elements with [data-admin-only] if user is not admin.
     * Hide elements with [data-auditor-only] if user is not auditor.
     */
    applyRBAC() {
        if (!this.isAdmin()) {
            document.querySelectorAll('[data-admin-only]').forEach(el => {
                el.style.display = 'none';
            });
        }
        if (!this.isAuditor()) {
            document.querySelectorAll('[data-auditor-only]').forEach(el => {
                el.style.display = 'none';
            });
        }
    },

    getRoles() { return [...this._roles]; },

    getDebugInfo() {
        return { roles: this._roles, initialized: this._initialized };
    }
};

// ============================================================================
// MAIN AccountsCommon OBJECT
// ============================================================================

const AccountsCommon = {

    // ------------------------------------------------------------------
    // Page Initialization
    // ------------------------------------------------------------------

    /**
     * Call from every accounts page DOMContentLoaded.
     * Checks auth, inits Navigation, RBAC, and sidebar.
     * @param {string} pageId   - Identifier for the page (e.g. 'chart-of-accounts')
     * @param {string} basePath - Relative path to Frontend root (e.g. '../')
     */
    async initPage(pageId, basePath = '../') {
        if (!api.isAuthenticated()) {
            window.location.href = basePath + 'index.html';
            return false;
        }

        // Top navigation bar
        if (typeof Navigation !== 'undefined') {
            Navigation.init('accounts', basePath);
        }

        // RBAC
        accountsRoles.init();

        if (!accountsRoles.canAccess()) {
            if (typeof showToast === 'function') {
                showToast('You do not have access to the Accounts module', 'error');
            }
            window.location.href = basePath + 'home.html';
            return false;
        }

        console.log(`[Accounts:${pageId}] Page initialized`, accountsRoles.getDebugInfo());

        // Auto-convert all native <select> filters (outside modals) to searchable dropdowns
        this._convertFilterSelects();

        return true;
    },

    /**
     * Convert native <select> elements in filter bars to searchable dropdowns.
     * Only converts selects that are NOT inside modals.
     */
    _convertFilterSelects() {
        if (typeof convertSelectToSearchable !== 'function') return;
        // Wait for DOM to be ready with all dynamic content
        setTimeout(() => {
            const selects = document.querySelectorAll('.filters-bar select:not([data-searchable]), .filter-row select:not([data-searchable])');
            selects.forEach(sel => {
                if (!sel.id || sel.closest('.modal')) return;
                const originalOnChange = sel.onchange;
                convertSelectToSearchable(sel.id, {
                    compact: true,
                    onChange: (value) => {
                        sel.value = value;
                        if (originalOnChange) originalOnChange.call(sel);
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            });
        }, 500);
    },

    // ------------------------------------------------------------------
    // Sidebar (matches sidebar-nav.css pattern from HRMS)
    // ------------------------------------------------------------------

    /**
     * Setup collapsible sidebar navigation.
     * @param {string} toggleId  - ID of the toggle button (default 'sidebarToggle')
     * @param {string} sidebarId - ID of the sidebar element (default 'accountsSidebar')
     * @param {string} overlayId - ID of the mobile overlay (default 'sidebarOverlay')
     * @param {Object} tabNames  - Map of tab-id to display label
     */
    setupSidebar(toggleId = 'sidebarToggle', sidebarId = 'accountsSidebar', overlayId = 'sidebarOverlay', tabNames = {}) {
        const toggle = document.getElementById(toggleId);
        const sidebar = document.getElementById(sidebarId);
        const overlay = document.getElementById(overlayId);
        const container = document.querySelector('.accounts-container') || document.querySelector('.hrms-container');
        const activeTabName = document.getElementById('activeTabName');

        if (!toggle || !sidebar) return;

        function updateActiveTabTitle(tabId) {
            if (activeTabName && tabNames[tabId]) {
                activeTabName.textContent = tabNames[tabId];
            }
        }

        // Desktop: open by default, Mobile: closed
        if (window.innerWidth > 1024) {
            toggle.classList.add('active');
            sidebar.classList.add('open');
            container?.classList.add('sidebar-open');
        } else {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
            overlay?.classList.remove('active');
        }

        // Toggle
        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            sidebar.classList.toggle('open');
            container?.classList.toggle('sidebar-open');
            if (window.innerWidth <= 1024) {
                overlay?.classList.toggle('active');
            }
        });

        // Mobile overlay close
        overlay?.addEventListener('click', () => {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
            overlay?.classList.remove('active');
        });

        // Collapsible nav groups
        document.querySelectorAll('.nav-group-header').forEach(header => {
            header.addEventListener('click', () => {
                header.closest('.nav-group')?.classList.toggle('collapsed');
            });
        });

        // Update title on sidebar tab click
        document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => updateActiveTabTitle(btn.dataset.tab));
        });

        // Escape key closes sidebar
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) {
                toggle.classList.remove('active');
                sidebar.classList.remove('open');
                container?.classList.remove('sidebar-open');
                overlay?.classList.remove('active');
            }
        });
    },

    // ------------------------------------------------------------------
    // Tab Switching
    // ------------------------------------------------------------------

    /**
     * Wire up sidebar-btn / tab-btn click handlers and honour URL hash.
     * @param {Object} [tabNames] - Map of tab-id to display label (optional)
     * @param {Function} [onSwitch] - Optional callback(tabId) after switch
     */
    setupTabs(tabNames = {}, onSwitch) {
        // Support legacy call: setupTabs(callback) where first arg is a function
        if (typeof tabNames === 'function') {
            onSwitch = tabNames;
            tabNames = {};
        }

        const tabBtns = document.querySelectorAll('.sidebar-btn[data-tab], .tab-btn[data-tab]');
        const activeTabName = document.getElementById('activeTabName');

        const activate = (tabId) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            const activeBtn = document.querySelector(`.sidebar-btn[data-tab="${tabId}"], .tab-btn[data-tab="${tabId}"]`);
            activeBtn?.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const panel = document.getElementById(tabId);
            if (panel) panel.classList.add('active');

            // Update active tab title
            if (activeTabName && tabNames[tabId]) {
                activeTabName.textContent = tabNames[tabId];
            }

            history.replaceState(null, '', '#' + tabId);

            // Close sidebar on mobile after tab switch
            if (window.innerWidth <= 1024) {
                document.getElementById('accountsSidebar')?.classList.remove('open');
                document.getElementById('sidebarToggle')?.classList.remove('active');
                document.querySelector('.accounts-container')?.classList.remove('sidebar-open');
                document.getElementById('sidebarOverlay')?.classList.remove('active');
            }

            if (typeof onSwitch === 'function') onSwitch(tabId);
        };

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => activate(btn.dataset.tab));
        });

        // Honour hash on load
        const hash = window.location.hash.replace('#', '');
        if (hash && document.getElementById(hash)) {
            activate(hash);
        }
    },

    /**
     * Programmatically switch to a tab.
     */
    switchTab(tabName, loadCallback) {
        const tabBtns = document.querySelectorAll('.sidebar-btn[data-tab], .tab-btn[data-tab]');
        tabBtns.forEach(b => b.classList.remove('active'));

        const activeBtn = document.querySelector(`.sidebar-btn[data-tab="${tabName}"], .tab-btn[data-tab="${tabName}"]`);
        activeBtn?.classList.add('active');

        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const panel = document.getElementById(tabName);
        if (panel) panel.classList.add('active');

        window.location.hash = tabName;
        if (typeof loadCallback === 'function') loadCallback(tabName);
    },

    // ------------------------------------------------------------------
    // Tenant & Query Helpers
    // ------------------------------------------------------------------

    /** Extract tenant_id from current JWT */
    getTenantId() {
        const token = getAuthToken();
        if (!token) return null;
        const payload = decodeJwtPayload(token);
        return payload?.tenant_id || null;
    },

    /**
     * Build a full URL path: /accounts/{endpoint}?tenantId=xxx&params
     * @param {string} endpoint - e.g. 'ledgers' or 'journal-entries/123'
     * @param {Object} params   - Additional query params
     * @returns {string}
     */
    buildUrl(endpoint, params = {}) {
        const base = `/accounts/${endpoint.replace(/^\//, '')}`;
        const qs = this.buildQuery(params);
        return base + qs;
    },

    /**
     * Build a query string that always includes tenantId.
     * @param {Object} params - Additional key/value pairs
     * @returns {string} e.g. '?tenantId=xxx&page=1'
     */
    buildQuery(params = {}) {
        const tenantId = this.getTenantId();
        const qp = new URLSearchParams();
        if (tenantId) qp.set('tenantId', tenantId);
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') qp.set(k, v);
        });
        const qs = qp.toString();
        return qs ? `?${qs}` : '';
    },

    // ------------------------------------------------------------------
    // Formatting Helpers
    // ------------------------------------------------------------------

    formatCurrency(amount, currency = 'INR') {
        if (amount == null || isNaN(amount)) return '-';
        const locale = currency === 'INR' ? 'en-IN' : 'en-US';
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    },

    formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d)) return '-';
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    },

    formatDateTime(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d)) return '-';
        return d.toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    },

    // ------------------------------------------------------------------
    // UI Helpers
    // ------------------------------------------------------------------

    /** XSS-safe HTML escaping */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /** Status badge HTML using theme CSS variables */
    statusBadge(status) {
        if (!status) return '';
        const s = String(status).toLowerCase();
        // Each status gets its own CSS class for distinct visual identity
        const classMap = {
            active: 'status-active', approved: 'status-active', posted: 'status-active',
            completed: 'status-active',
            paid: 'status-paid', reimbursed: 'status-paid',
            sent: 'status-sent',
            submitted: 'status-submitted', in_progress: 'status-submitted',
            draft: 'status-draft', not_started: 'status-draft', trial: 'status-draft',
            pending: 'status-pending', partially_paid: 'status-pending', partial: 'status-pending',
            rejected: 'status-rejected', overdue: 'status-rejected', failed: 'status-rejected',
            cancelled: 'status-rejected', past_due: 'status-rejected',
            reversed: 'status-reversed', expired: 'status-reversed',
            disposed: 'status-rejected', written_off: 'status-rejected',
            inactive: 'status-inactive', closed: 'status-inactive',
            accepted: 'status-accepted', received: 'status-accepted',
            invoiced: 'status-invoiced', billed: 'status-invoiced'
        };
        const cls = classMap[s] || 'status-pending';
        const label = this.escapeHtml(status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        return `<span class="badge ${cls}">${label}</span>`;
    },

    /** Empty-state placeholder HTML */
    emptyState(message, icon = 'inbox') {
        return `
            <div class="empty-state">
                <i class="fas fa-${this.escapeHtml(icon)}"></i>
                <p>${this.escapeHtml(message)}</p>
            </div>`;
    },

    // ------------------------------------------------------------------
    // Dropdown Helpers
    // ------------------------------------------------------------------

    /**
     * Populate a SearchableDropdown from an API endpoint.
     * @param {string} containerId - DOM container for the dropdown
     * @param {string} endpoint    - API endpoint (e.g. '/accounts/ledgers')
     * @param {Object} opts
     * @param {string} opts.valueField   - Property for option value (default 'id')
     * @param {string} opts.labelField   - Property for option label (default 'name')
     * @param {string} opts.placeholder
     * @param {Function} opts.onChange
     * @param {*} opts.value             - Pre-selected value
     * @returns {SearchableDropdown|null}
     */
    async loadDropdownFromAPI(containerId, endpoint, opts = {}) {
        const container = document.getElementById(containerId);
        if (!container || typeof SearchableDropdown !== 'function') return null;

        const valueField = opts.valueField || 'id';
        const labelField = opts.labelField || 'name';

        try {
            const qs = this.buildQuery(opts.queryParams || {});
            const res = await api.request(`${endpoint}${qs}`, { _skipSpinner: true });
            const items = Array.isArray(res) ? res : (res?.data || res?.items || []);

            const options = items.map(item => ({
                value: item[valueField],
                label: item[labelField]
            }));

            return new SearchableDropdown(container, {
                id: opts.id || containerId + 'Dropdown',
                options,
                value: opts.value !== undefined ? opts.value : null,
                placeholder: opts.placeholder || 'Select...',
                searchPlaceholder: opts.searchPlaceholder || 'Search...',
                compact: opts.compact || false,
                onChange: opts.onChange || (() => {})
            });
        } catch (err) {
            console.error(`[Accounts] Failed to load dropdown from ${endpoint}:`, err);
            return null;
        }
    },

    // ------------------------------------------------------------------
    // Pagination
    // ------------------------------------------------------------------

    /**
     * Render simple pagination controls.
     * @param {string} containerId - DOM element ID for pagination
     * @param {number} currentPage
     * @param {number} totalPages
     * @param {Function} onPageChange - callback(pageNumber)
     */
    renderPagination(containerId, currentPage, totalPages, onPageChange) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (totalPages <= 1) { container.innerHTML = ''; return; }

        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage + 1 < maxVisible) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        let html = '<div class="pagination">';
        html += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">&laquo;</button>`;

        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }

        html += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">&raquo;</button>`;
        html += '</div>';

        container.innerHTML = html;
        container.querySelectorAll('.pagination-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page, 10);
                if (page >= 1 && page <= totalPages) onPageChange(page);
            });
        });
    },

    // ------------------------------------------------------------------
    // Modals
    // ------------------------------------------------------------------

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.classList.add('modal-open');
            // Auto-convert native <select> to searchable dropdowns
            this._convertModalSelects(modal);
        }
    },

    /**
     * Convert all native <select> inside a modal to SearchableDropdown.
     * Skips selects that are already converted (have data-searchable attribute).
     */
    _convertModalSelects(modal) {
        if (typeof convertSelectToSearchable !== 'function') return;
        const selects = modal.querySelectorAll('select:not([data-searchable])');
        selects.forEach(sel => {
            // Preserve any onchange handler
            const originalOnChange = sel.onchange;
            convertSelectToSearchable(sel.id, {
                compact: true,
                onChange: (value) => {
                    // Sync value back to hidden select for form reads
                    sel.value = value;
                    if (originalOnChange) originalOnChange.call(sel);
                    // Also fire change event for any listeners
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            document.body.classList.remove('modal-open');
        }
    },

    // ------------------------------------------------------------------
    // Confirm Dialog
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Searchable Dropdown Retry Helper
    // ------------------------------------------------------------------

    /**
     * Retry initializing searchable dropdowns until the class is available.
     * Matches the pattern from HRMS organization.js.
     * @param {Function} initFn - Function that creates SearchableDropdown instances
     * @param {number} maxRetries - Max retry attempts (default 10)
     * @param {number} delay - Delay between retries in ms (default 200)
     */
    initSearchableDropdownsWithRetry(initFn, maxRetries = 10, delay = 200) {
        let attempt = 0;
        const tryInit = () => {
            attempt++;
            if (typeof SearchableDropdown === 'function') {
                try { initFn(); } catch (e) {
                    console.error('[Accounts] SearchableDropdown init error:', e);
                }
                return;
            }
            if (attempt < maxRetries) {
                setTimeout(tryInit, delay);
            } else {
                console.warn('[Accounts] SearchableDropdown not available after', maxRetries, 'retries');
            }
        };
        tryInit();
    },

    // ------------------------------------------------------------------
    // Confirm Dialog
    // ------------------------------------------------------------------

    /**
     * Simple promise-based confirm dialog.
     * Falls back to window.confirm if no custom modal exists.
     */
    async confirm(message, title = 'Confirm') {
        // If a global confirmDialog helper exists (e.g. from a shared UI lib), use it
        if (typeof showConfirmDialog === 'function') {
            return showConfirmDialog(message, title);
        }
        return window.confirm(message);
    }
};

// ============================================================================
// Phase 4 Tier 1 hot-fix — buttons inside <form> elements default to type="submit"
// per the HTML spec. Every action button in the accounts modals (Save Draft,
// Save & Approve, Record Payment, Cancel, etc) was missing an explicit type
// attribute. Clicking them triggered form submission, which navigated the page
// and aborted the in-flight async API request — so EVERY save action that
// looked like it worked via direct JS call would actually fail when the user
// clicked the button. Patch globally on DOMContentLoaded so we don't have to
// touch ~165 buttons across 13 HTML files.
// ============================================================================
function _patchAccountsFormButtons(root = document) {
    const buttons = root.querySelectorAll('form button:not([type])');
    buttons.forEach(btn => { btn.type = 'button'; });
}

// Initial patch when the DOM is parsed
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => _patchAccountsFormButtons());
} else {
    _patchAccountsFormButtons();
}

// Also patch any buttons added later by dynamically rendered modals/templates.
// MutationObserver is cheap because we only re-scan added subtrees.
if (typeof MutationObserver !== 'undefined') {
    const _btnObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.tagName === 'BUTTON' && !node.hasAttribute('type') && node.closest('form')) {
                        node.type = 'button';
                    } else if (node.querySelectorAll) {
                        _patchAccountsFormButtons(node);
                    }
                }
            }
        }
    });
    if (document.body) {
        _btnObserver.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => _btnObserver.observe(document.body, { childList: true, subtree: true }));
    }
}
