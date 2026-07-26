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
        // [data-manager-only]: visible to ACCOUNTS_MANAGER/ADMIN/SUPERADMIN only (e.g. Recurring,
        // whose controller is manager+). Hidden from ACCOUNTS_USER / ACCOUNTS_AUDITOR.
        if (!this.isManager()) {
            document.querySelectorAll('[data-manager-only]').forEach(el => {
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
            window.location.href = basePath + 'login.html';
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

        // "What is this?" education panels — collapsed accounting primers per subsection
        this._injectHelpPanels(pageId);

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
     * Per-project breakdown of a customer's invoice LINES. The backend invoice list is header-only and the
     * project-statement endpoint returns per-project TOTALS, so to itemise a project we fetch each of the
     * customer's invoices and read its lines (which carry project_id). Result is cached per customer.
     * @returns {Promise<{byProject:Object, invoiceIdsByProject:Object}>} keyed by project_id ('_none' for untagged).
     */
    async getProjectInvoiceBreakdown(customerId, { force = false } = {}) {
        this._projBreakdown = this._projBreakdown || {};
        if (!customerId) return { byProject: {}, invoiceIdsByProject: {} };
        if (!force && this._projBreakdown[customerId]) return this._projBreakdown[customerId];
        const listRes = await api.request(this.buildUrl('invoices', { customerId, limit: 1000, offset: 0 }), { _skipSpinner: true });
        const invoices = Array.isArray(listRes) ? listRes : (listRes?.data || listRes?.items || []);
        const details = await Promise.all(invoices.map(inv =>
            api.request(this.buildUrl('invoices/' + inv.id), { _skipSpinner: true }).catch(() => null)));
        const byProject = {}, invoiceIdsByProject = {};
        details.forEach((d, i) => {
            if (!d) return;
            const inv = invoices[i];
            (d.lines || d.line_items || []).forEach(ln => {
                const key = ln.project_id || '_none';
                (byProject[key] = byProject[key] || []).push({
                    invoice_id: inv.id, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date,
                    invoice_status: inv.status, invoice_balance: inv.balance_due ?? inv.balance ?? 0,
                    description: ln.description, amount: parseFloat(ln.amount || 0)
                });
                (invoiceIdsByProject[key] = invoiceIdsByProject[key] || new Set()).add(inv.id);
            });
        });
        const result = { byProject, invoiceIdsByProject };
        this._projBreakdown[customerId] = result;
        return result;
    },
    /** Drop the cached breakdown (call after creating/editing an invoice so the project views refresh). */
    invalidateProjectBreakdown(customerId) {
        if (!this._projBreakdown) return;
        if (customerId) delete this._projBreakdown[customerId]; else this._projBreakdown = {};
    },

    // ── Full-page create/edit form (Accounts): swap the list view for the form view in normal
    //    document flow, so the window scrolls naturally (no fixed-overlay footer overlap / clipped
    //    dropdowns). The form view must be a sibling OUTSIDE `.accounts-container`.
    showFormPage(viewId) {
        const container = document.querySelector('.accounts-container');
        if (container) container.style.display = 'none';
        const view = document.getElementById(viewId);
        if (view) view.style.display = 'block';
        window.scrollTo(0, 0);
    },
    hideFormPage(viewId) {
        const view = document.getElementById(viewId);
        if (view) view.style.display = 'none';
        const container = document.querySelector('.accounts-container');
        if (container) container.style.display = '';
        window.scrollTo(0, 0);
    },

    // ── Custom fields (Zoho-style) ───────────────────────────────────────────────────────────────
    // Definitions are per (entity_type); values are stored per document via their own endpoints, so the
    // document create/read paths are untouched. field_key is always a safe slug (^[a-z][a-z0-9_]*$),
    // so it's safe in attribute selectors without escaping.

    /** Active field definitions for an entity type (cached per type). */
    async getCustomFieldDefs(entityType, { force = false } = {}) {
        this._cfDefs = this._cfDefs || {};
        if (!force && this._cfDefs[entityType]) return this._cfDefs[entityType];
        const res = await api.request(this.buildUrl('custom-fields', { entityType }), { _skipSpinner: true }).catch(() => []);
        const defs = Array.isArray(res) ? res : (res?.data || res?.items || []);
        this._cfDefs[entityType] = defs;
        return defs;
    },
    invalidateCustomFieldDefs(entityType) {
        if (!this._cfDefs) return;
        if (entityType) delete this._cfDefs[entityType]; else this._cfDefs = {};
    },

    /** The stored custom-field values for one document → { field_key: value } ({} if none/new). */
    async loadCustomFieldValues(entityType, entityId) {
        if (!entityId) return {};
        const res = await api.request(this.buildUrl('custom-fields/values', { entityType, entityId }), { _skipSpinner: true }).catch(() => null);
        return res?.field_values || {};
    },

    /** Persist a document's custom-field values (call AFTER the document exists / has an id). */
    saveCustomFieldValues(entityType, entityId, values) {
        return api.request(this.buildUrl('custom-fields/values'), {
            method: 'PUT',
            body: JSON.stringify({ entity_type: entityType, entity_id: entityId, field_values: values || {} }),
            headers: { 'Content-Type': 'application/json' }
        });
    },

    /**
     * Render a "Custom Fields" section card into hostEl from defs + values. Returns a controller with
     * getValues() → { field_key: value }. Empty defs clears the host and returns a no-op controller.
     */
    renderCustomFieldsSection(hostEl, defs, values = {}) {
        const host = typeof hostEl === 'string' ? document.getElementById(hostEl) : hostEl;
        const noop = { getValues: () => ({}), defs: defs || [] };
        if (!host) return noop;
        if (!defs || !defs.length) { host.innerHTML = ''; return noop; }
        const v = (x) => this.escapeHtml(x == null ? '' : String(x));
        const dropdowns = {};

        const cells = defs.map(d => {
            const req = d.is_required ? ' <span class="req">*</span>' : ' <span class="opt">(optional)</span>';
            const wide = d.field_type === 'textarea' ? ' pf-wide' : '';
            const val = values[d.field_key];
            let control;
            if (d.field_type === 'textarea')
                control = `<textarea class="form-control" data-cf="${v(d.field_key)}" rows="2">${v(val)}</textarea>`;
            else if (d.field_type === 'number')
                control = `<input type="number" step="any" class="form-control" data-cf="${v(d.field_key)}" value="${v(val)}">`;
            else if (d.field_type === 'date')
                // flatpickr text input (matches the rest of the Accounts forms). dateFormat 'Y-m-d'
                // keeps .value as YYYY-MM-DD, identical to the old native date input the backend expects.
                control = `<input type="text" class="form-control" data-cf="${v(d.field_key)}" data-cf-date="1" value="${v(val)}" placeholder="Select date">`;
            else if (d.field_type === 'dropdown')
                control = `<div class="searchable-dropdown-container" data-cf-dd="${v(d.field_key)}"></div><input type="hidden" data-cf="${v(d.field_key)}" value="${v(val)}">`;
            else
                control = `<input type="text" class="form-control" data-cf="${v(d.field_key)}" value="${v(val)}">`;
            return `<div class="form-group${wide}"><label>${v(d.label)}${req}</label>${control}</div>`;
        }).join('');

        host.innerHTML = `<div class="form-section">
            <div class="section-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg> Custom Fields</div>
            <div class="pgrid">${cells}</div>
        </div>`;

        if (typeof SearchableDropdown !== 'undefined') {
            defs.filter(d => d.field_type === 'dropdown').forEach(d => {
                const cont = host.querySelector(`[data-cf-dd="${d.field_key}"]`);
                const hidden = host.querySelector(`input[type=hidden][data-cf="${d.field_key}"]`);
                if (!cont) return;
                const opts = [{ value: '', label: '— Select —' }].concat((d.options || []).map(o => ({ value: o, label: o })));
                dropdowns[d.field_key] = new SearchableDropdown(cont, {
                    options: opts, value: values[d.field_key] ?? '', placeholder: 'Select…',
                    searchPlaceholder: 'Search…', onChange: (val) => { if (hidden) hidden.value = val || ''; }
                });
            });
        }

        // Fold date custom fields into flatpickr (matches the main form date pickers).
        if (typeof flatpickr === 'function') {
            host.querySelectorAll('input[data-cf-date="1"]').forEach(el => {
                flatpickr(el, { dateFormat: 'Y-m-d', allowInput: true });
            });
        }

        return {
            defs,
            getValues() {
                const out = {};
                defs.forEach(d => {
                    let val;
                    if (dropdowns[d.field_key]) val = dropdowns[d.field_key].getValue?.() ?? '';
                    else { const el = host.querySelector(`[data-cf="${d.field_key}"]`); val = el ? el.value : ''; }
                    if (val !== '' && val != null) out[d.field_key] = val;
                });
                return out;
            }
        };
    },

    /** Client-side required check so we don't create a document then fail its values write. Returns error msg or null. */
    validateRequiredCustomFields(controller) {
        if (!controller || !controller.defs) return null;
        const vals = controller.getValues();
        for (const d of controller.defs) {
            if (d.is_required && (vals[d.field_key] == null || vals[d.field_key] === ''))
                return `${d.label} is required`;
        }
        return null;
    },

    // ── India GST state codes (canonical, current jurisdictions) ─────────────────────────────────
    // The 2-digit code is the place-of-supply signal that drives CGST+SGST (intra-state) vs IGST
    // (inter-state). Kept here so nobody has to memorise "Delhi = 07". Sorted by name for the picker.
    INDIA_STATES: [
        { name: 'Andaman & Nicobar Islands', code: '35' },
        { name: 'Andhra Pradesh', code: '37' },
        { name: 'Arunachal Pradesh', code: '12' },
        { name: 'Assam', code: '18' },
        { name: 'Bihar', code: '10' },
        { name: 'Chandigarh', code: '04' },
        { name: 'Chhattisgarh', code: '22' },
        { name: 'Dadra & Nagar Haveli and Daman & Diu', code: '26' },
        { name: 'Delhi', code: '07' },
        { name: 'Goa', code: '30' },
        { name: 'Gujarat', code: '24' },
        { name: 'Haryana', code: '06' },
        { name: 'Himachal Pradesh', code: '02' },
        { name: 'Jammu & Kashmir', code: '01' },
        { name: 'Jharkhand', code: '20' },
        { name: 'Karnataka', code: '29' },
        { name: 'Kerala', code: '32' },
        { name: 'Ladakh', code: '38' },
        { name: 'Lakshadweep', code: '31' },
        { name: 'Madhya Pradesh', code: '23' },
        { name: 'Maharashtra', code: '27' },
        { name: 'Manipur', code: '14' },
        { name: 'Meghalaya', code: '17' },
        { name: 'Mizoram', code: '15' },
        { name: 'Nagaland', code: '13' },
        { name: 'Odisha', code: '21' },
        { name: 'Puducherry', code: '34' },
        { name: 'Punjab', code: '03' },
        { name: 'Rajasthan', code: '08' },
        { name: 'Sikkim', code: '11' },
        { name: 'Tamil Nadu', code: '33' },
        { name: 'Telangana', code: '36' },
        { name: 'Tripura', code: '16' },
        { name: 'Uttar Pradesh', code: '09' },
        { name: 'Uttarakhand', code: '05' },
        { name: 'West Bengal', code: '19' },
        { name: 'Other Territory', code: '97' }
    ],

    // Country list — India first (default), then the rest alphabetically. Covers the markets a software
    // firm actually bills; GST/state-code logic only applies when Country === 'India'.
    COUNTRIES: [
        'India', 'Afghanistan', 'Albania', 'Algeria', 'Argentina', 'Australia', 'Austria', 'Bahrain',
        'Bangladesh', 'Belgium', 'Bhutan', 'Brazil', 'Bulgaria', 'Cambodia', 'Canada', 'Chile', 'China',
        'Colombia', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Egypt', 'Estonia', 'Ethiopia', 'Finland',
        'France', 'Germany', 'Ghana', 'Greece', 'Hong Kong', 'Hungary', 'Iceland', 'Indonesia', 'Iran',
        'Iraq', 'Ireland', 'Israel', 'Italy', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Latvia',
        'Lebanon', 'Lithuania', 'Luxembourg', 'Malaysia', 'Maldives', 'Malta', 'Mauritius', 'Mexico',
        'Morocco', 'Myanmar', 'Nepal', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Oman', 'Pakistan',
        'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Saudi Arabia', 'Singapore',
        'Slovakia', 'Slovenia', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland',
        'Taiwan', 'Tanzania', 'Thailand', 'Turkey', 'Uganda', 'Ukraine', 'United Arab Emirates',
        'United Kingdom', 'United States', 'Vietnam', 'Zambia', 'Zimbabwe', 'Other'
    ],

    /** GST state code for a state name (case-insensitive), or '' if not an Indian state. */
    stateCodeFor(name) {
        if (!name) return '';
        const s = this.INDIA_STATES.find(x => x.name.toLowerCase() === String(name).trim().toLowerCase());
        return s ? s.code : '';
    },

    /**
     * Wire a Country + State region picker (Zoho-style). Country is a dropdown defaulting to India; when
     * India is chosen the State becomes a dropdown that auto-derives the (hidden) GST state code, otherwise
     * State falls back to a free-text box and the code is dropped. Canonical values live in the three hidden
     * inputs so existing save/read code keeps working unchanged.
     * @param o {countryContainer, stateContainer, stateTextInput, hiddenCountry, hiddenState, hiddenStateCode, defaultCountry?}
     * @returns controller with reset(country?) and set({country,state,stateCode})
     */
    createRegionPicker(o) {
        const self = this;
        const el = x => (typeof x === 'string' ? document.getElementById(x) : x);
        const countryContainer = el(o.countryContainer), stateContainer = el(o.stateContainer);
        const stateText = el(o.stateTextInput);
        const hCountry = el(o.hiddenCountry), hState = el(o.hiddenState), hCode = el(o.hiddenStateCode);
        const isIndia = c => String(c || '').trim().toLowerCase() === 'india';

        const stateDD = new SearchableDropdown(stateContainer, {
            options: self.INDIA_STATES.map(s => ({ value: s.name, label: `${s.name} · ${s.code}` })),
            placeholder: 'Select state', searchPlaceholder: 'Search states…',
            onChange: (val) => { hState.value = val || ''; hCode.value = self.stateCodeFor(val); }
        });

        const applyCountry = (country) => {
            hCountry.value = country || '';
            if (isIndia(country)) {
                stateContainer.style.display = '';
                stateText.style.display = 'none';
            } else {
                stateContainer.style.display = 'none';
                stateText.style.display = '';
                hCode.value = '';                       // GST codes are India-only
                hState.value = (stateText.value || '').trim();
            }
        };

        const countryDD = new SearchableDropdown(countryContainer, {
            options: self.COUNTRIES.map(c => ({ value: c, label: c })),
            placeholder: 'Select country', searchPlaceholder: 'Search countries…',
            onChange: (val) => applyCountry(val)
        });

        stateText.addEventListener('input', () => {
            if (!isIndia(countryDD.getValue())) { hState.value = stateText.value.trim(); hCode.value = ''; }
        });

        const controller = {
            reset(country) {
                const c = country || o.defaultCountry || 'India';
                countryDD.setValue(c, false);
                stateDD.setValue('', false);
                stateText.value = '';
                hState.value = ''; hCode.value = '';
                applyCountry(c);
            },
            set({ country, state, stateCode }) {
                const c = country || o.defaultCountry || 'India';
                countryDD.setValue(c, false);
                applyCountry(c);
                if (isIndia(c)) {
                    stateDD.setValue(state || '', false);
                    hState.value = state || '';
                    hCode.value = stateCode || self.stateCodeFor(state);
                } else {
                    stateText.value = state || '';
                    hState.value = state || '';
                    hCode.value = '';
                }
            }
        };
        controller.reset();
        return controller;
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
    // Chart-of-accounts helpers
    // ------------------------------------------------------------------

    /**
     * Filter the chart-of-accounts list to accounts valid as a document line's posting account:
     * only leaf accounts that allow direct posting (excludes parent/group header accounts, which the
     * backend rejects with "does not allow direct posting"), active only, and — when `typeContains` is
     * given — restricted to an account-type class (case-insensitive substring, e.g. 'expense', 'income').
     */
    postableAccounts(accounts, typeContains) {
        return (accounts || []).filter(a => {
            if (a.allow_direct_posting === false) return false;
            if (a.is_active === false) return false;
            if (typeContains) {
                const t = (a.account_type_name || '').toLowerCase();
                if (!t.includes(typeContains.toLowerCase())) return false;
            }
            return true;
        });
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

    /** Today's date as 'YYYY-MM-DD' in the LOCAL timezone (never UTC).
     *  Use for date-input defaults / "today" — toISOString() shifts a day in IST 00:00-05:30. */
    todayLocal() {
        return this.toDateInput(new Date());
    },

    /** Convert a Date or date-like value to a 'YYYY-MM-DD' string in LOCAL time,
     *  suitable for <input type="date"> values and preview rows without a UTC day-shift. */
    toDateInput(dateLike) {
        const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
        if (isNaN(d)) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
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

    /** Inject collapsed "What is this?" education panels (content map lives in
     *  accounts-help.js, lazy-loaded so pages don't need an extra script tag).
     *  One panel per .tab-content whose `${pageId}:${id}` has an entry; pages
     *  without tabs use the `${pageId}:_page` key, placed after the <h1>. */
    _injectHelpPanels(pageId) {
        const inject = () => {
            const HELP = window.ACCOUNTS_HELP || {};
            const mk = (html) => {
                const d = document.createElement('details');
                d.className = 'acc-help';
                d.innerHTML = `<summary>What is this?</summary><div class="acc-help-body">${html}</div>`;
                return d;
            };
            document.querySelectorAll('.tab-content').forEach(tc => {
                const html = HELP[`${pageId}:${tc.id}`];
                if (html && !tc.querySelector(':scope > details.acc-help')) tc.prepend(mk(html));
            });
            const pageHtml = HELP[`${pageId}:_page`];
            if (pageHtml && !document.querySelector('details.acc-help[data-page-help]')) {
                const h1 = document.querySelector('h1');
                if (h1) {
                    const p = mk(pageHtml);
                    p.dataset.pageHelp = '1';
                    (h1.closest('.page-header') || h1.parentElement).insertAdjacentElement('afterend', p);
                }
            }
        };
        if (window.ACCOUNTS_HELP) { inject(); return; }
        const s = document.createElement('script');
        const v = typeof CACHE_VERSION !== 'undefined' ? CACHE_VERSION : Date.now();
        s.src = `../../js/accounts/accounts-help.js?v=${v}`;
        s.onload = inject;
        document.head.appendChild(s);
    },

    /** Attach flatpickr to date text inputs. The flatpickr CDN script loads AFTER the
     *  page script on every accounts page, so this retries until the library exists.
     *  specs: array of 'inputId' or { id, onChange } for filter inputs that reload a list. */
    initDatePickers(specs) {
        const attach = () => {
            if (typeof flatpickr !== 'function') { setTimeout(attach, 300); return; }
            specs.forEach(spec => {
                const s = typeof spec === 'string' ? { id: spec } : spec;
                const el = document.getElementById(s.id);
                if (!el || el._flatpickr) return;
                const opts = { dateFormat: 'Y-m-d', allowInput: true };
                if (s.onChange) opts.onChange = s.onChange;
                flatpickr(el, opts);
            });
        };
        attach();
    },

    /** Set (or clear) a date input's value through its flatpickr instance so the
     *  calendar's selected date stays in sync with the visible value. Falls back to
     *  raw .value if flatpickr hasn't attached yet. */
    setDateField(id, val) {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        if (!el) return;
        if (el._flatpickr) {
            if (val) el._flatpickr.setDate(val, false);
            else el._flatpickr.clear();
        } else {
            el.value = val || '';
        }
    },

    // ------------------------------------------------------------------
    // UI Helpers
    // ------------------------------------------------------------------

    /** XSS-safe HTML escaping — quote-safe, so it is correct in element text,
     *  HTML-attribute, and (with escJs for the JS layer) inline-handler contexts. */
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /** Escape a value destined for a single-quoted JS string inside an inline
     *  handler attribute, e.g. onclick="fn('${escJs(x)}')". Apply escapeHtml
     *  AFTER this when the result also sits in an HTML attribute. */
    escJs(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    },

    /** Double-submit guard keyed by an action name. Call beginSubmit(key) at the top of a
     *  mutating handler (AFTER field validation, so a validation bail doesn't strand the key);
     *  if it returns false, a prior invocation is still in flight — return immediately. Always
     *  pair with endSubmit(key) in a finally that covers the await. Prevents a double-click from
     *  POSTing the same create/payment/import twice. */
    _inFlightSubmits: new Set(),
    beginSubmit(key) {
        if (this._inFlightSubmits.has(key)) return false;
        this._inFlightSubmits.add(key);
        return true;
    },
    endSubmit(key) {
        this._inFlightSubmits.delete(key);
    },

    /** Status badge HTML using theme CSS variables */
    statusBadge(status) {
        if (!status) return '';
        const s = String(status).toLowerCase();
        // Each status gets its own CSS class for distinct visual identity
        const classMap = {
            active: 'status-active', approved: 'status-active', posted: 'status-active',
            completed: 'status-active',
            paid: 'status-paid', reimbursed: 'status-paid', credited: 'status-paid',
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

    /**
     * Client-side pagination for pages whose list endpoint returns the full
     * array (no server limit/offset). Rendering 10k+ rows freezes the tab and
     * balloons the DOM to 100k+ nodes; slicing to one page keeps it snappy.
     * @param {Array} items - the full (already filtered) array
     * @param {number} page - the requested 1-based page
     * @param {number} [pageSize=50]
     * @returns {{slice:Array, page:number, totalPages:number, total:number}}
     */
    paginate(items, page, pageSize = 50) {
        const list = Array.isArray(items) ? items : [];
        const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
        const p = Math.min(Math.max(1, page || 1), totalPages);
        const start = (p - 1) * pageSize;
        return { slice: list.slice(start, start + pageSize), page: p, totalPages, total: list.length };
    },

    /**
     * Show an inline spinner row in a table body while its list is (re)fetching.
     * Call at the top of a load*() function, before the awaited request, so the
     * user always gets active feedback — critical on the high-latency
     * India→Germany link where a fetch can take seconds and re-loads would
     * otherwise sit on stale rows with no sign anything is happening.
     */
    setTableLoading(tbodyId, colspan = 6, message = 'Loading…') {
        const tb = document.getElementById(tbodyId);
        if (tb) tb.innerHTML = `<tr><td colspan="${colspan}" class="acct-table-loading"><span class="acct-inline-spinner"></span>${this.escapeHtml(message)}</td></tr>`;
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
            // Only drop the body scroll-lock when NO other modal is still open. A quick-add modal opened
            // over an invoice/PO modal must not unlock the body when it closes, else the page scrolls behind
            // the still-open outer modal.
            if (!document.querySelector('.modal.active')) {
                document.body.classList.remove('modal-open');
            }
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
     * Uses the app's themed Confirm modal (repo rule: never the native window.confirm).
     */
    async confirm(message, title = 'Confirm') {
        // Prefer the shared themed Confirm modal used across the app.
        if (window.Confirm && typeof window.Confirm.show === 'function') {
            return window.Confirm.show({ title, message });
        }
        if (typeof showConfirmDialog === 'function') {
            return showConfirmDialog(message, title);
        }
        // Last-resort fallback only if no themed modal is loaded at all.
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
