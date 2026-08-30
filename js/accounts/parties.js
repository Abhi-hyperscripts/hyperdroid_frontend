/**
 * AccountsService — Vendors & Customers Page
 *
 * Handles 4 sidebar tabs:
 *   1. Vendor List
 *   2. Customer List
 *   3. Pending Vendors
 *   4. Pending Customers
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let vendors = [];
let customers = [];
let pendingVendorRequests = [];
let pendingCustomerRequests = [];
let currentApproveRequest = null;

// Server-side pagination state (backend returns {data,total,stats} per page).
const PAGE_SIZE = 50;
let vendorPage = 1;
let customerPage = 1;
let vendorTotal = 0;
let customerTotal = 0;

// Country + State region pickers (Zoho-style; country defaults to India, state auto-fills GST code).
let customerRegion = null;
let vendorRegion = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('parties', '../')) return;

    const tabNames = {
        'vendor-list': 'Vendor List',
        'customer-list': 'Customer List',
        'pending-vendors': 'Pending Vendors',
        'pending-customers': 'Pending Customers'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    setupSearchListeners();
    initRegionPickers();
});

// Build the Country/State pickers once (their containers live in the static modals).
function initRegionPickers() {
    if (typeof SearchableDropdown === 'undefined') return;
    if (document.getElementById('customerCountryContainer') && !customerRegion) {
        customerRegion = AccountsCommon.createRegionPicker({
            countryContainer: 'customerCountryContainer', stateContainer: 'customerStateContainer',
            stateTextInput: 'customerStateText', hiddenCountry: 'customerCountry',
            hiddenState: 'customerState', hiddenStateCode: 'customerStateCode', defaultCountry: 'India'
        });
    }
    if (document.getElementById('vendorCountryContainer') && !vendorRegion) {
        vendorRegion = AccountsCommon.createRegionPicker({
            countryContainer: 'vendorCountryContainer', stateContainer: 'vendorStateContainer',
            stateTextInput: 'vendorStateText', hiddenCountry: 'vendorCountry',
            hiddenState: 'vendorState', hiddenStateCode: 'vendorStateCode', defaultCountry: 'India'
        });
    }
}

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'vendor-list':       loadVendors(); break;
        case 'customer-list':     loadCustomers(); break;
        case 'pending-vendors':   loadPendingRequests('vendor'); break;
        case 'pending-customers': loadPendingRequests('client'); break;
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        await Promise.all([loadVendors(), loadCustomers(), loadPendingCounts()]);
    } catch (err) {
        console.error('[Parties] loadInitialData error:', err);
    }
}

// ============================================================================
// SEARCH LISTENERS
// ============================================================================

function setupSearchListeners() {
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    const vendorSearch = document.getElementById('vendorSearch');
    if (vendorSearch) vendorSearch.addEventListener('input', debounce(() => loadVendors(1)));

    const customerSearch = document.getElementById('customerSearch');
    if (customerSearch) customerSearch.addEventListener('input', debounce(() => loadCustomers(1)));
}

// ============================================================================
// 1. VENDORS
// ============================================================================

async function loadVendors(page = vendorPage) {
    try {
        // Server-side pagination: one page (50 rows) crosses the wire, not the whole table.
        // Search + active/inactive filter run on the server; KPI tiles come from the envelope's
        // unfiltered `stats`. (Tolerant of an older backend that returns a raw array.)
        vendorPage = page;
        AccountsCommon.setTableLoading('vendorsTable', 7, 'Loading vendors…');
        const search = (document.getElementById('vendorSearch')?.value || '').trim();
        const showInactive = document.getElementById('showInactiveVendors')?.checked || false;
        const params = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
        if (search) params.search = search;
        if (!showInactive) params.isActive = true;
        const res = await api.request(AccountsCommon.buildUrl('vendors', params), { _skipSpinner: true });
        const env = Array.isArray(res) ? { data: res, total: res.length, stats: null } : (res || {});
        vendors = env.data || [];
        vendorTotal = env.total ?? vendors.length;
        updateVendorStats(env.stats);
        renderVendorsTable();
    } catch (err) {
        console.error('[Parties] loadVendors error:', err);
        Toast.error('Failed to load vendors');
    }
}

function updateVendorStats(stats) {
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    // Prefer the envelope's unfiltered counts; fall back to the current page (old backend).
    if (stats) {
        el('totalVendors', stats.total_count);
        el('activeVendors', stats.active_count);
        el('inactiveVendors', stats.inactive_count);
    } else {
        el('totalVendors', vendors.length);
        el('activeVendors', vendors.filter(v => v.is_active !== false).length);
        el('inactiveVendors', vendors.filter(v => v.is_active === false).length);
    }
}

function renderVendorsTable() {
    const tbody = document.getElementById('vendorsTable');
    if (!tbody) return;

    if (!vendors.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="1" y="3" width="15" height="13"></rect>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                <circle cx="5.5" cy="18.5" r="2.5"></circle>
                <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg><p>No vendors found</p></div></td></tr>`;
        AccountsCommon.renderPagination('vendorPagination', 1, 1, () => {});
        return;
    }

    const totalPages = Math.max(1, Math.ceil((vendorTotal || vendors.length) / PAGE_SIZE));
    AccountsCommon.renderPagination('vendorPagination', vendorPage, totalPages, (p) => loadVendors(p));

    tbody.innerHTML = vendors.map(v => {
        const statusClass = v.is_active !== false ? 'status-active' : 'status-rejected';
        const statusText = v.is_active !== false ? 'Active' : 'Inactive';
        const viewBtn = `<button class="btn-icon" onclick="viewVendor('${v.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        const editBtn = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editVendor('${v.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
            : '';
        const actions = viewBtn + editBtn || '-';
        return `<tr>
            <td>${AccountsCommon.escapeHtml(v.vendor_code || v.code || '-')}</td>
            <td>${AccountsCommon.escapeHtml(v.name)}</td>
            <td>${AccountsCommon.escapeHtml(v.phone || '-')}</td>
            <td>${AccountsCommon.escapeHtml(v.tax_id || '-')}</td>
            <td>${v.payment_terms_days != null ? v.payment_terms_days + ' days' : '-'}</td>
            <td><span class="badge ${statusClass}">${statusText}</span></td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// DETAIL SLIDE PANEL (shared for vendor/customer view)
// ============================================================================

// Render a website as a link only for http(s) URLs — javascript:/data: etc.
// are shown as plain text to prevent XSS via a stored website value.
function safeWebsiteLink(website) {
    if (!website) return '-';
    const esc = AccountsCommon.escapeHtml;
    let href = String(website).trim();
    if (!/^https?:\/\//i.test(href)) {
        // No scheme — treat as https; anything with a non-http(s) scheme is plain text
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return esc(website);
        href = 'https://' + href;
    }
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="color:var(--brand-primary)">${esc(website)}</a>`;
}

function openDetailPanel(item, type) {
    const isVendor = type === 'vendor';
    const esc = AccountsCommon.escapeHtml;
    const fmt = AccountsCommon.formatCurrency;
    const code = isVendor ? (item.vendor_code || item.code) : (item.customer_code || item.code);
    const initials = (item.name || '??').substring(0, 2).toUpperCase();

    document.getElementById('detailPanelTitle').textContent = isVendor ? 'Vendor Details' : 'Customer Details';

    document.getElementById('detailPanelBody').innerHTML = `
        <!-- Header Card -->
        <div class="panel-employee-header">
            <div class="panel-employee-avatar">${esc(initials)}</div>
            <div class="panel-employee-info">
                <div class="panel-employee-name">${esc(item.name || '-')}</div>
                <div class="panel-employee-meta">
                    ${code ? `<span>${esc(code)}</span><span>·</span>` : ''}
                    <span class="status-badge" style="background:${item.is_active !== false ? 'var(--status-active)' : 'var(--status-rejected)'}; color:white;">${item.is_active !== false ? 'Active' : 'Inactive'}</span>
                </div>
            </div>
        </div>

        <!-- Contact Section -->
        <div class="panel-section">
            <div class="panel-section-header">
                <div class="panel-section-icon contact">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                </div>
                <span class="panel-section-title">Contact Information</span>
            </div>
            <div class="panel-detail-grid">
                <div class="panel-detail-row"><span class="panel-detail-label">Email</span><span class="panel-detail-value">${esc(item.email || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Phone</span><span class="panel-detail-value">${esc(item.phone || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Contact Person</span><span class="panel-detail-value">${esc(item.contact_person || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Website</span><span class="panel-detail-value">${safeWebsiteLink(item.website)}</span></div>
            </div>
        </div>

        <!-- Business Section -->
        <div class="panel-section">
            <div class="panel-section-header">
                <div class="panel-section-icon info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
                </div>
                <span class="panel-section-title">Business Details</span>
            </div>
            <div class="panel-detail-grid">
                <div class="panel-detail-row"><span class="panel-detail-label">Display Name</span><span class="panel-detail-value">${esc(item.display_name || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Industry</span><span class="panel-detail-value">${esc(item.industry || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Payment Terms</span><span class="panel-detail-value">${item.payment_terms_days != null ? item.payment_terms_days + ' days' : '-'}</span></div>
                ${!isVendor && item.credit_limit != null ? `<div class="panel-detail-row"><span class="panel-detail-label">Credit Limit</span><span class="panel-detail-value">${fmt(item.credit_limit)}</span></div>` : ''}
                <div class="panel-detail-row"><span class="panel-detail-label">GST / Tax Number</span><span class="panel-detail-value">${esc(item.tax_id || item.gst_number || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">PAN / Tax ID</span><span class="panel-detail-value">${esc(item.pan_number || '-')}</span></div>
            </div>
        </div>

        <!-- Address Section -->
        <div class="panel-section">
            <div class="panel-section-header">
                <div class="panel-section-icon personal">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                </div>
                <span class="panel-section-title">Address</span>
            </div>
            <div class="panel-detail-grid">
                <div class="panel-detail-row"><span class="panel-detail-label">Address Line 1</span><span class="panel-detail-value">${esc(item.address_line1 || item.billing_address_line1 || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Address Line 2</span><span class="panel-detail-value">${esc(item.address_line2 || item.billing_address_line2 || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">City</span><span class="panel-detail-value">${esc(item.city || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">State</span><span class="panel-detail-value">${esc(item.state || '-')}${item.state_code ? ' (' + esc(item.state_code) + ')' : ''}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Country</span><span class="panel-detail-value">${esc(item.country || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Postal Code</span><span class="panel-detail-value">${esc(item.postal_code || '-')}</span></div>
            </div>
        </div>

        ${isVendor && (item.bank_name || item.bank_account_number) ? `
        <!-- Bank Section -->
        <div class="panel-section">
            <div class="panel-section-header">
                <div class="panel-section-icon success">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                </div>
                <span class="panel-section-title">Bank Details</span>
            </div>
            <div class="panel-detail-grid">
                <div class="panel-detail-row"><span class="panel-detail-label">Bank Name</span><span class="panel-detail-value">${esc(item.bank_name || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">Account Number</span><span class="panel-detail-value">${esc(item.bank_account_number || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">IFSC</span><span class="panel-detail-value">${esc(item.bank_ifsc || '-')}</span></div>
                <div class="panel-detail-row"><span class="panel-detail-label">SWIFT</span><span class="panel-detail-value">${esc(item.bank_swift || '-')}</span></div>
            </div>
        </div>
        ` : ''}

        ${item.notes ? `
        <div class="panel-section">
            <div class="panel-section-header">
                <div class="panel-section-icon primary">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <span class="panel-section-title">Notes</span>
            </div>
            <p style="font-size:13px; color:var(--text-secondary); margin:0; line-height:1.6;">${esc(item.notes)}</p>
        </div>
        ` : ''}
    `;

    if (!isVendor) renderPortalAccessSection(item);

    document.getElementById('detailPanelOverlay').classList.add('active');
    document.getElementById('detailPanel').classList.add('active');
    document.body.classList.add('modal-open');
}

function closeDetailPanel() {
    document.getElementById('detailPanelOverlay').classList.remove('active');
    document.getElementById('detailPanel').classList.remove('active');
    document.body.classList.remove('modal-open');
}

// Wire overlay click to close
document.addEventListener('DOMContentLoaded', function() {
    const overlay = document.getElementById('detailPanelOverlay');
    if (overlay) overlay.addEventListener('click', closeDetailPanel);
});

async function viewVendor(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`vendors/${id}`));
        const v = res?.data || res;
        if (!v) { Toast.error('Vendor not found'); return; }
        openDetailPanel(v, 'vendor');
    } catch (err) {
        console.error('[Parties] viewVendor error:', err);
        Toast.error('Failed to load vendor details');
    }
}

async function viewCustomer(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`customers/${id}`));
        const c = res?.data || res;
        if (!c) { Toast.error('Customer not found'); return; }
        openDetailPanel(c, 'customer');
    } catch (err) {
        console.error('[Parties] viewCustomer error:', err);
        Toast.error('Failed to load customer details');
    }
}

// ============================================================================
// VENDOR MODAL
// ============================================================================

function showCreateVendorModal() {
    document.getElementById('vendorModalTitle').textContent = 'Create Vendor';
    document.getElementById('vendorForm').reset();
    document.getElementById('vendorId').value = '';
    document.getElementById('vendorPaymentTerms').value = '30';
    document.getElementById('vendorCodeRow').style.display = 'none';
    if (document.getElementById('vendorGstTreatment')) { document.getElementById('vendorGstTreatment').value = 'registered'; onVendorTreatmentChange(); }
    if (vendorRegion) vendorRegion.reset('India');   // country defaults to India, state cleared
    AccountsCommon.showFormPage('vendorModal');
}

function editVendor(id) {
    const v = vendors.find(x => x.id === id);
    if (!v) return;

    document.getElementById('vendorModalTitle').textContent = 'Edit Vendor';
    document.getElementById('vendorId').value = v.id;
    document.getElementById('vendorCodeRow').style.display = '';
    document.getElementById('vendorCode').value = v.vendor_code || v.code || '';
    document.getElementById('vendorName').value = v.name || '';
    document.getElementById('vendorDisplayName').value = v.display_name || '';
    document.getElementById('vendorEmail').value = v.email || '';
    document.getElementById('vendorPhone').value = v.phone || '';
    document.getElementById('vendorAddressLine1').value = v.address_line1 || '';
    document.getElementById('vendorAddressLine2').value = v.address_line2 || '';
    document.getElementById('vendorCity').value = v.city || '';
    if (vendorRegion) vendorRegion.set({ country: v.country || 'India', state: v.state || '', stateCode: v.state_code || '' });
    document.getElementById('vendorPostalCode').value = v.postal_code || '';
    document.getElementById('vendorTaxId').value = v.tax_id || '';
    document.getElementById('vendorGstNumber').value = v.gst_number || '';
    document.getElementById('vendorPanNumber').value = v.pan_number || '';
    document.getElementById('vendorDrugLicense').value = v.drug_license_no || '';
    if (document.getElementById('vendorGstTreatment')) { document.getElementById('vendorGstTreatment').value = v.gst_treatment || 'registered'; onVendorTreatmentChange(); }
    document.getElementById('vendorPaymentTerms').value = v.payment_terms_days ?? 30;
    document.getElementById('vendorBankName').value = v.bank_name || '';
    document.getElementById('vendorBankAccount').value = v.bank_account_number || '';
    document.getElementById('vendorBankIfsc').value = v.bank_ifsc || '';
    document.getElementById('vendorBankSwift').value = v.bank_swift || '';
    document.getElementById('vendorNotes').value = v.notes || '';
    AccountsCommon.showFormPage('vendorModal');
}

// Update the GSTIN required-marker + an explanatory hint when the GST treatment changes.
function onVendorTreatmentChange() {
    const t = document.getElementById('vendorGstTreatment')?.value || 'registered';
    applyOverseasFieldRules('vendor', t === 'overseas');
    const req = document.getElementById('vendorTaxIdReq');
    if (req) req.style.visibility = (t === 'registered') ? 'visible' : 'hidden';
    const hint = document.getElementById('vendorTreatmentHint');
    if (hint) hint.textContent = ({
        registered: '',
        unregistered: 'Unregistered vendor — its bills carry no input GST (no input tax credit).',
        composition: 'Composition dealer — issues a bill of supply; no input GST (no ITC).',
        overseas: 'Overseas vendor — bill has no Indian GST (import IGST is paid separately at customs).'
    })[t] || '';
}

/**
 * ⭐ THE FORM MUST AGREE WITH THE SERVER ABOUT WHAT IS REQUIRED. The overseas hint already told the
 * user "state not required" while the label still carried a red asterisk AND the phone input carried
 * a hard `required` attribute — so an overseas party could not be saved through the UI at all, and
 * the prose contradicted the control sitting next to it. The server now exempts overseas from phone
 * and state; this keeps the form saying the same thing, in both directions (switching back to a
 * domestic treatment restores both).
 */
function applyOverseasFieldRules(party, isOverseas) {
    const star = (id, on) => { const e = document.getElementById(id); if (e) e.style.visibility = on ? 'visible' : 'hidden'; };
    const need = (id, on) => { const e = document.getElementById(id); if (e) { if (on) e.setAttribute('required', ''); else e.removeAttribute('required'); } };
    star(`${party}PhoneReq`, !isOverseas);
    star(`${party}StateReq`, !isOverseas);
    need(`${party}Phone`, !isOverseas);
    need(`${party}State`, !isOverseas);
}

function onCustomerTreatmentChange() {
    const t = document.getElementById('customerGstTreatment')?.value || 'registered';
    applyOverseasFieldRules('customer', t === 'overseas');
    const req = document.getElementById('customerTaxIdReq');
    if (req) req.style.visibility = (t === 'registered') ? 'visible' : 'hidden';
    const hint = document.getElementById('customerTreatmentHint');
    if (hint) hint.textContent = ({
        registered: '',
        unregistered: 'Unregistered (B2C) — you still charge GST by the customer’s state.',
        composition: 'Composition dealer — you still charge normal GST on your sale to them.',
        overseas: 'Overseas — invoices are zero-rated exports (no GST); state not required.'
    })[t] || '';
}

async function saveVendor() {
    const id = document.getElementById('vendorId').value;
    const name = document.getElementById('vendorName').value.trim();
    const treatment = document.getElementById('vendorGstTreatment')?.value || 'registered';

    // tax_id fallback: Indian users typically enter GST or PAN rather than a generic Tax ID.
    const taxId = document.getElementById('vendorTaxId').value.trim()
        || document.getElementById('vendorGstNumber').value.trim()
        || document.getElementById('vendorPanNumber').value.trim();

    // Client-side validation mirroring the backend's required master-data fields, so the
    // user gets one clear message + focus instead of a chain of server-side 400s.
    const required = [
        ['vendorName', 'Vendor name'],
        ['vendorPhone', 'Phone'],
        ['vendorEmail', 'Email'],
        ['vendorAddressLine1', 'Address Line 1'],
        ['vendorCity', 'City'],
        ['vendorState', 'State'],
        ['vendorCountry', 'Country']
    ];
    for (const [fid, label] of required) {
        const el = document.getElementById(fid);
        if (!el || !el.value.trim()) { Toast.error(`${label} is required`); el?.focus(); return; }
    }
    // GSTIN / Tax ID + state code are mandatory only for a GST-registered vendor.
    if (treatment === 'registered' && !taxId) { Toast.error('GSTIN / Tax ID is required for a GST-registered vendor (pick Unregistered or Overseas if it has none)'); document.getElementById('vendorTaxId').focus(); return; }
    // State code is derived from the state picker; only an Indian GST-registered vendor needs it.
    const venCountry = (document.getElementById('vendorCountry').value || '').trim().toLowerCase();
    if (venCountry === 'india' && treatment === 'registered' && !document.getElementById('vendorStateCode').value.trim()) { Toast.error('Please select the vendor’s state (place of supply for input GST)'); return; }

    const payload = {
        name,
        gst_treatment: treatment,
        display_name: document.getElementById('vendorDisplayName').value.trim() || null,
        email: document.getElementById('vendorEmail').value.trim() || null,
        phone: document.getElementById('vendorPhone').value.trim() || null,
        address_line1: document.getElementById('vendorAddressLine1').value.trim() || null,
        address_line2: document.getElementById('vendorAddressLine2').value.trim() || null,
        city: document.getElementById('vendorCity').value.trim() || null,
        state: document.getElementById('vendorState').value.trim() || null,
        state_code: document.getElementById('vendorStateCode').value.trim() || null,
        country: document.getElementById('vendorCountry').value.trim() || null,
        postal_code: document.getElementById('vendorPostalCode').value.trim() || null,
        tax_id: taxId || null,
        // Backend accepts and prefers gst_number/pan_number over tax_id for TDS
        gst_number: document.getElementById('vendorGstNumber').value.trim() || null,
        pan_number: document.getElementById('vendorPanNumber').value.trim() || null,
        drug_license_no: document.getElementById('vendorDrugLicense').value.trim() || (document.getElementById('vendorId').value ? '' : null),
        payment_terms_days: parseInt(document.getElementById('vendorPaymentTerms').value) || 30,
        bank_name: document.getElementById('vendorBankName').value.trim() || null,
        bank_account_number: document.getElementById('vendorBankAccount').value.trim() || null,
        bank_ifsc: document.getElementById('vendorBankIfsc').value.trim() || null,
        bank_swift: document.getElementById('vendorBankSwift').value.trim() || null,
        notes: document.getElementById('vendorNotes').value.trim() || null
    };

    if (!AccountsCommon.beginSubmit('saveVendor')) return;
    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`vendors/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Vendor updated');
        } else {
            await api.request(AccountsCommon.buildUrl('vendors'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Vendor created');
        }
        AccountsCommon.hideFormPage('vendorModal');
        await loadVendors();
    } catch (err) {
        console.error('[Parties] saveVendor error:', err);
        Toast.error(err.message || 'Failed to save vendor');
    } finally {
        AccountsCommon.endSubmit('saveVendor');
    }
}

// ============================================================================
// 2. CUSTOMERS
// ============================================================================

async function loadCustomers(page = customerPage) {
    try {
        // Server-side pagination (one page over the wire); search + filter run on the server.
        customerPage = page;
        AccountsCommon.setTableLoading('customersTable', 7, 'Loading customers…');
        const search = (document.getElementById('customerSearch')?.value || '').trim();
        const showInactive = document.getElementById('showInactiveCustomers')?.checked || false;
        const params = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
        if (search) params.search = search;
        if (!showInactive) params.isActive = true;
        const res = await api.request(AccountsCommon.buildUrl('customers', params), { _skipSpinner: true });
        const env = Array.isArray(res) ? { data: res, total: res.length, stats: null } : (res || {});
        customers = env.data || [];
        customerTotal = env.total ?? customers.length;
        updateCustomerStats(env.stats);
        renderCustomersTable();
    } catch (err) {
        console.error('[Parties] loadCustomers error:', err);
        Toast.error('Failed to load customers');
    }
}

function updateCustomerStats(stats) {
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    if (stats) {
        el('totalCustomers', stats.total_count);
        el('activeCustomers', stats.active_count);
        el('inactiveCustomers', stats.inactive_count);
    } else {
        el('totalCustomers', customers.length);
        el('activeCustomers', customers.filter(c => c.is_active !== false).length);
        el('inactiveCustomers', customers.filter(c => c.is_active === false).length);
    }
}

function renderCustomersTable() {
    const tbody = document.getElementById('customersTable');
    if (!tbody) return;

    if (!customers.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg><p>No customers found</p></div></td></tr>`;
        AccountsCommon.renderPagination('customerPagination', 1, 1, () => {});
        return;
    }

    const totalPages = Math.max(1, Math.ceil((customerTotal || customers.length) / PAGE_SIZE));
    AccountsCommon.renderPagination('customerPagination', customerPage, totalPages, (p) => loadCustomers(p));

    tbody.innerHTML = customers.map(c => {
        const statusClass = c.is_active !== false ? 'status-active' : 'status-rejected';
        const statusText = c.is_active !== false ? 'Active' : 'Inactive';
        const creditDisplay = c.credit_limit != null ? AccountsCommon.formatCurrency(c.credit_limit) : '-';
        const viewBtn = `<button class="btn-icon" onclick="viewCustomer('${c.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        const editBtn = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editCustomer('${c.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
            : '';
        const actions = viewBtn + editBtn || '-';
        return `<tr>
            <td>${AccountsCommon.escapeHtml(c.customer_code || c.code || '-')}</td>
            <td>${AccountsCommon.escapeHtml(c.name)}</td>
            <td>${AccountsCommon.escapeHtml(c.phone || '-')}</td>
            <td>${AccountsCommon.escapeHtml(c.tax_id || '-')}</td>
            <td>${creditDisplay}</td>
            <td><span class="badge ${statusClass}">${statusText}</span></td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// CUSTOMER MODAL
// ============================================================================

// ── Price list assignment (Feature: price lists → sales) ────────────────────
// The list is a DEFAULT: invoice lines for this customer pre-fill the list price
// (per BASE unit, same MRP-inclusive semantics as the item's own price); users can
// still override per line. Missing/inactive lists fall back to item.sale_price.
let customerPriceListDD = null;
async function initCustomerPriceListDD(selected) {
    const host = document.getElementById('customerPriceList');
    if (!host || typeof SearchableDropdown !== 'function') return;
    let lists = [];
    try { const r = await api.request(AccountsCommon.buildUrl('price-lists'), { _skipSpinner: true }); lists = (Array.isArray(r) ? r : (r?.data || [])).filter(p => p.is_active !== false); } catch { }
    host.innerHTML = '';
    customerPriceListDD = new SearchableDropdown(host, {
        id: 'customerPriceListDD',
        options: [{ value: '', label: 'None — standard item prices' }, ...lists.map(p => ({ value: p.id, label: p.name }))],
        value: selected || '', placeholder: 'None — standard item prices', compact: true
    });
}

function showCreateCustomerModal() {
    document.getElementById('customerModalTitle').textContent = 'Create Customer';
    document.getElementById('customerForm').reset();
    document.getElementById('customerId').value = '';
    document.getElementById('customerPaymentTerms').value = '30';
    document.getElementById('customerCodeRow').style.display = 'none';
    if (document.getElementById('customerGstTreatment')) { document.getElementById('customerGstTreatment').value = 'registered'; onCustomerTreatmentChange(); }
    if (customerRegion) customerRegion.reset('India');   // country defaults to India, state cleared
    initCustomerPriceListDD('');
    AccountsCommon.showFormPage('customerModal');
}

function editCustomer(id) {
    const c = customers.find(x => x.id === id);
    if (!c) return;

    document.getElementById('customerModalTitle').textContent = 'Edit Customer';
    document.getElementById('customerId').value = c.id;
    document.getElementById('customerCodeRow').style.display = '';
    document.getElementById('customerCode').value = c.customer_code || c.code || '';
    document.getElementById('customerName').value = c.name || '';
    document.getElementById('customerDisplayName').value = c.display_name || '';
    document.getElementById('customerEmail').value = c.email || '';
    document.getElementById('customerPhone').value = c.phone || '';
    document.getElementById('customerAddressLine1').value = c.billing_address_line1 || c.address_line1 || '';
    document.getElementById('customerAddressLine2').value = c.billing_address_line2 || c.address_line2 || '';
    document.getElementById('customerCity').value = c.city || '';
    if (customerRegion) customerRegion.set({ country: c.country || 'India', state: c.state || '', stateCode: c.state_code || '' });
    document.getElementById('customerPostalCode').value = c.postal_code || '';
    document.getElementById('customerTaxId').value = c.tax_id || '';
    if (document.getElementById('customerGstTreatment')) { document.getElementById('customerGstTreatment').value = c.gst_treatment || 'registered'; onCustomerTreatmentChange(); }
    document.getElementById('customerPaymentTerms').value = c.payment_terms_days ?? 30;
    document.getElementById('customerCreditLimit').value = c.credit_limit ?? '';
    document.getElementById('customerNotes').value = c.notes || '';
    document.getElementById('customerInterestRate').value = c.interest_rate_pct ?? '';
    document.getElementById('customerDrugLicense').value = c.drug_license_no || '';
    initCustomerPriceListDD(c.price_list_id || '');
    AccountsCommon.showFormPage('customerModal');
}

async function saveCustomer() {
    const id = document.getElementById('customerId').value;
    const name = document.getElementById('customerName').value.trim();
    const treatment = document.getElementById('customerGstTreatment')?.value || 'registered';

    // Client-side validation mirroring the backend's required master-data fields, so the
    // user gets one clear message + focus instead of a chain of server-side 400s.
    const required = [
        ['customerName', 'Customer name'],
        ['customerPhone', 'Phone'],
        ['customerEmail', 'Email'],
        ['customerAddressLine1', 'Address Line 1'],
        ['customerCity', 'City'],
        ['customerState', 'State'],
        ['customerCountry', 'Country']
    ];
    for (const [fid, label] of required) {
        const el = document.getElementById(fid);
        if (!el || !el.value.trim()) { Toast.error(`${label} is required`); el?.focus(); return; }
    }
    // GSTIN is mandatory only for a GST-registered customer; a domestic customer needs a state code
    // (place of supply — GST is always charged on a domestic sale, whatever the buyer's registration).
    if (treatment === 'registered' && !document.getElementById('customerTaxId').value.trim()) { Toast.error('GSTIN / Tax ID is required for a GST-registered customer (pick Unregistered or Overseas if it has none)'); document.getElementById('customerTaxId').focus(); return; }
    // State code is derived from the state picker; only a domestic (India) customer needs a place of supply.
    const custCountry = (document.getElementById('customerCountry').value || '').trim().toLowerCase();
    if (custCountry === 'india' && treatment !== 'overseas' && !document.getElementById('customerStateCode').value.trim()) { Toast.error('Please select the customer’s state (place of supply for GST)'); return; }

    const creditVal = document.getElementById('customerCreditLimit').value;

    const payload = {
        name,
        gst_treatment: treatment,
        display_name: document.getElementById('customerDisplayName').value.trim() || null,
        email: document.getElementById('customerEmail').value.trim() || null,
        phone: document.getElementById('customerPhone').value.trim() || null,
        billing_address_line1: document.getElementById('customerAddressLine1').value.trim() || null,
        billing_address_line2: document.getElementById('customerAddressLine2').value.trim() || null,
        city: document.getElementById('customerCity').value.trim() || null,
        state: document.getElementById('customerState').value.trim() || null,
        state_code: document.getElementById('customerStateCode').value.trim() || null,
        country: document.getElementById('customerCountry').value.trim() || null,
        postal_code: document.getElementById('customerPostalCode').value.trim() || null,
        tax_id: document.getElementById('customerTaxId').value.trim() || null,
        payment_terms_days: parseInt(document.getElementById('customerPaymentTerms').value) || 30,
        credit_limit: creditVal ? parseFloat(creditVal) : null,
        notes: document.getElementById('customerNotes').value.trim() || null,
        // UPDATE uses partial semantics (null = unchanged), so a cleared selection sends the
        // EMPTY-GUID sentinel to remove the assignment; CREATE just omits it.
        price_list_id: customerPriceListDD?.getValue?.() || (id ? '00000000-0000-0000-0000-000000000000' : null),
        // Partial-update: 0 turns interest off (backend treats 0 and NULL alike); blank on CREATE omits.
        interest_rate_pct: (() => { const v = document.getElementById('customerInterestRate').value.trim(); return v === '' ? (id ? 0 : null) : parseFloat(v); })(),
        drug_license_no: document.getElementById('customerDrugLicense').value.trim() || (id ? '' : null)
    };

    if (!AccountsCommon.beginSubmit('saveCustomer')) return;
    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`customers/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Customer updated');
        } else {
            await api.request(AccountsCommon.buildUrl('customers'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Customer created');
        }
        AccountsCommon.hideFormPage('customerModal');
        await loadCustomers();
    } catch (err) {
        console.error('[Parties] saveCustomer error:', err);
        Toast.error(err.message || 'Failed to save customer');
    } finally {
        AccountsCommon.endSubmit('saveCustomer');
    }
}

// ============================================================================
// 3. PENDING REQUESTS (Vendors & Customers)
// ============================================================================

/**
 * Load pending counts for sidebar badges.
 * Called on page load to show badge numbers without loading full tables.
 */
async function loadPendingCounts() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('requests/pending-count'), { _skipSpinner: true });
        const data = res?.data || res || {};
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('pendingVendorCount', data.vendor || data.vendors || 0);
        el('pendingCustomerCount', data.client || data.clients || data.customer || data.customers || 0);
    } catch (err) {
        console.error('[Parties] loadPendingCounts error:', err);
    }
}

/**
 * Format SLA deadline as relative time with color coding.
 * Green if >24h, yellow if <24h, red if <8h or overdue.
 */
function formatSlaDeadline(deadline) {
    if (!deadline) return '<span style="color:var(--text-secondary)">-</span>';

    const now = new Date();
    const sla = new Date(deadline);
    const diffMs = sla - now;
    const diffHours = diffMs / (1000 * 60 * 60);

    let color, text;
    if (diffMs < 0) {
        // Overdue
        const overHours = Math.abs(diffHours);
        if (overHours < 1) {
            text = `OVERDUE ${Math.round(Math.abs(diffMs / 60000))} min ago`;
        } else if (overHours < 48) {
            text = `OVERDUE ${Math.round(overHours)} hours ago`;
        } else {
            text = `OVERDUE ${Math.round(overHours / 24)} days ago`;
        }
        color = 'var(--color-danger)';
    } else if (diffHours < 8) {
        text = `in ${Math.round(diffHours)} hours`;
        color = 'var(--color-danger)';
    } else if (diffHours < 24) {
        text = `in ${Math.round(diffHours)} hours`;
        color = 'var(--color-warning)';
    } else if (diffHours < 48) {
        text = `in ${Math.round(diffHours)} hours`;
        color = 'var(--color-success)';
    } else {
        text = `in ${Math.round(diffHours / 24)} days`;
        color = 'var(--color-success)';
    }

    return `<span style="color:${color};font-weight:600;">${AccountsCommon.escapeHtml(text)}</span>`;
}

/**
 * Load pending requests for a given type ("vendor" or "client").
 * Populates the corresponding table and stats.
 */
async function loadPendingRequests(type) {
    const isVendor = type === 'vendor';
    const tbodyId = isVendor ? 'pendingVendorTableBody' : 'pendingCustomerTableBody';
    const tbody = document.getElementById(tbodyId);

    try {
        const url = AccountsCommon.buildUrl('requests', { type: type, status: 'pending' });
        const res = await api.request(url, { _skipSpinner: true });
        const items = Array.isArray(res) ? res : (res?.data || res?.items || []);

        if (isVendor) {
            pendingVendorRequests = items;
        } else {
            pendingCustomerRequests = items;
        }

        // Update stats
        const pendingCountId = isVendor ? 'pvPendingCount' : 'pcPendingCount';
        const slaWarningId = isVendor ? 'pvSlaWarning' : 'pcSlaWarning';
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el(pendingCountId, items.length);

        // Count SLA warnings (less than 24 hours or overdue)
        const now = new Date();
        const slaWarnings = items.filter(r => {
            if (!r.sla_deadline) return false;
            const diffMs = new Date(r.sla_deadline) - now;
            return diffMs < 24 * 60 * 60 * 1000; // less than 24 hours
        });
        el(slaWarningId, slaWarnings.length);

        // Update sidebar badge
        const badgeId = isVendor ? 'pendingVendorCount' : 'pendingCustomerCount';
        el(badgeId, items.length);

        // Render table
        if (!tbody) return;
        if (!items.length) {
            const icon = isVendor
                ? '<rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle>'
                : '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>';
            tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">${icon}</svg>
                <p>No pending ${isVendor ? 'vendor' : 'customer'} requests</p></div></td></tr>`;
            return;
        }

        const esc = AccountsCommon.escapeHtml;
        tbody.innerHTML = items.map(r => {
            const approveBtn = `<button class="btn-icon" onclick="approveRequest('${r.id}', '${type}')" data-tooltip="Approve" style="color:var(--color-success);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg></button>`;
            const rejectBtn = `<button class="btn-icon" onclick="rejectRequest('${r.id}', '${type}')" data-tooltip="Reject" style="color:var(--color-danger);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
            return `<tr>
                <td>${esc(r.party_name || r.name || '-')}</td>
                <td>${esc(r.requested_by_name || r.requested_by || '-')}</td>
                <td>${esc(r.requested_from_service || r.source_service || '-')}</td>
                <td>${esc(r.email || '-')}</td>
                <td>${esc(r.phone || '-')}</td>
                <td>${esc(r.city || '-')}</td>
                <td>${formatSlaDeadline(r.sla_deadline)}</td>
                <td class="actions-cell">${approveBtn}${rejectBtn}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error(`[Parties] loadPendingRequests(${type}) error:`, err);
        Toast.error(`Failed to load pending ${type} requests`);
        if (tbody) {
            tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message"><p>Failed to load</p></div></td></tr>`;
        }
    }
}

// ============================================================================
// APPROVE REQUEST
// ============================================================================

function approveRequest(requestId, type) {
    const isVendor = type === 'vendor';
    const items = isVendor ? pendingVendorRequests : pendingCustomerRequests;
    const req = items.find(r => r.id === requestId);

    currentApproveRequest = req || { id: requestId };

    // Pre-fill modal with data from the request
    document.getElementById('approveRequestId').value = requestId;
    document.getElementById('approveRequestType').value = type;
    document.getElementById('approveRequestName').textContent =
        `Approve: ${req?.party_name || req?.name || 'Unknown'} (${isVendor ? 'Vendor' : 'Customer'})`;

    document.getElementById('arEmail').value = req?.email || '';
    document.getElementById('arPhone').value = req?.phone || '';
    document.getElementById('arTaxId').value = req?.tax_id || req?.gst_number || req?.pan_number || '';
    document.getElementById('arAddress').value = req?.address_line1 || req?.address || '';
    document.getElementById('arCity').value = req?.city || '';
    document.getElementById('arState').value = req?.state || '';
    document.getElementById('arCountry').value = req?.country || '';
    document.getElementById('arPaymentTerms').value = req?.payment_terms_days ?? 30;

    AccountsCommon.openModal('approveRequestModal');
}

function closeApproveModal() {
    AccountsCommon.closeModal('approveRequestModal');
    currentApproveRequest = null;
}

async function confirmApprove() {
    const requestId = document.getElementById('approveRequestId').value;
    const type = document.getElementById('approveRequestType').value;

    if (!requestId) return;

    const email = document.getElementById('arEmail').value.trim();
    const phone = document.getElementById('arPhone').value.trim();
    const taxId = document.getElementById('arTaxId').value.trim();
    const address = document.getElementById('arAddress').value.trim();
    const city = document.getElementById('arCity').value.trim();
    const state = document.getElementById('arState').value.trim();
    const country = document.getElementById('arCountry').value.trim();

    if (!email || !phone || !taxId || !address || !city || !state || !country) {
        Toast.error('Please fill in all required fields');
        return;
    }

    const payload = {
        action: 'approve',
        email,
        phone,
        tax_id: taxId,
        address_line1: address,
        city,
        state,
        country,
        payment_terms_days: parseInt(document.getElementById('arPaymentTerms').value) || 30
    };

    if (!AccountsCommon.beginSubmit('confirmApprove')) return;
    try {
        await api.request(AccountsCommon.buildUrl(`requests/${requestId}/review`), {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        Toast.success('Request approved and party created');
        closeApproveModal();
        // Reload pending list and main list
        await Promise.all([
            loadPendingRequests(type),
            loadPendingCounts(),
            type === 'vendor' ? loadVendors() : loadCustomers()
        ]);
    } catch (err) {
        console.error('[Parties] confirmApprove error:', err);
        Toast.error(err.message || 'Failed to approve request');
    } finally {
        AccountsCommon.endSubmit('confirmApprove');
    }
}

// ============================================================================
// REJECT REQUEST
// ============================================================================

function rejectRequest(requestId, type) {
    const isVendor = type === 'vendor';
    const items = isVendor ? pendingVendorRequests : pendingCustomerRequests;
    const req = items.find(r => r.id === requestId);

    document.getElementById('rejectRequestId').value = requestId;
    document.getElementById('rejectRequestName').textContent =
        `Reject: ${req?.party_name || req?.name || 'Unknown'} (${isVendor ? 'Vendor' : 'Customer'})`;
    document.getElementById('rejectReason').value = '';

    AccountsCommon.openModal('rejectRequestModal');
}

function closeRejectModal() {
    AccountsCommon.closeModal('rejectRequestModal');
}

async function confirmReject() {
    const requestId = document.getElementById('rejectRequestId').value;
    const reason = document.getElementById('rejectReason').value.trim();

    if (!requestId) return;
    if (!reason) {
        Toast.error('Please provide a reason for rejection');
        return;
    }

    const payload = {
        action: 'reject',
        rejection_reason: reason
    };

    if (!AccountsCommon.beginSubmit('confirmReject')) return;
    try {
        await api.request(AccountsCommon.buildUrl(`requests/${requestId}/review`), {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        Toast.success('Request rejected');
        closeRejectModal();

        // Determine which type to reload based on current active tab
        const activeTab = document.querySelector('.sidebar-btn.active')?.dataset?.tab;
        const type = activeTab === 'pending-vendors' ? 'vendor' : 'client';
        await Promise.all([loadPendingRequests(type), loadPendingCounts()]);
    } catch (err) {
        console.error('[Parties] confirmReject error:', err);
        Toast.error(err.message || 'Failed to reject request');
    } finally {
        AccountsCommon.endSubmit('confirmReject');
    }
}

// ============================================================================
// CLIENT PORTAL ACCESS (customer detail panel)
//
// Finance issues the client's portal password against the email already on the customer record, hands
// it over by email or any other medium, and can re-issue or revoke it at any time. The password appears
// on screen exactly once — the reply to Generate — and is never retrievable afterwards.
// ============================================================================

function renderPortalAccessSection(customer) {
    const body = document.getElementById('detailPanelBody');
    if (!body) return;
    const section = document.createElement('div');
    section.className = 'panel-section';
    section.id = 'portalAccessSection';
    section.innerHTML = `
        <div class="panel-section-header">
            <div class="panel-section-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <span class="panel-section-title">Client Portal Access</span>
        </div>
        <p style="font-size:12px; color:var(--text-secondary); margin:0 0 10px; line-height:1.5;">
            Lets this client sign in and see their own invoices, quotations, receipts and account statement.
            Their login is the email on this customer record; you issue the password.
        </p>
        <div id="portalAccessBody" style="font-size:13px; color:var(--text-secondary);">Loading…</div>
    `;
    body.appendChild(section);
    loadPortalAccess(customer.id);
}

async function loadPortalAccess(customerId) {
    const host = document.getElementById('portalAccessBody');
    if (!host) return;
    try {
        const status = await api.request(AccountsCommon.buildUrl(`customers/${customerId}/portal-access`), { _skipSpinner: true });
        renderPortalAccessStatus(customerId, status, null);
    } catch (err) {
        // A 403 means the signed-in user is not an Accounts admin: the section still explains itself.
        const msg = /403|forbidden|permission/i.test(err?.message || '') ? 'Only an Accounts admin can manage portal access.' : (err?.message || 'Could not load portal access.');
        host.innerHTML = `<div style="color:var(--text-secondary);">${AccountsCommon.escapeHtml(msg)}</div>`;
    }
}

function renderPortalAccessStatus(customerId, status, issued) {
    const host = document.getElementById('portalAccessBody');
    if (!host) return;
    const esc = AccountsCommon.escapeHtml;
    const when = (d) => d ? new Date(d).toLocaleString() : '-';
    const active = !!status.exists && !!status.is_active;
    const badge = !status.exists
        ? `<span class="status-badge" style="background:var(--bg-tertiary); color:var(--text-secondary);">Not set up</span>`
        : active
            ? `<span class="status-badge" style="background:var(--status-active); color:white;">Active</span>`
            : `<span class="status-badge" style="background:var(--status-rejected); color:white;">Revoked</span>`;
    const locked = status.locked_until && new Date(status.locked_until) > new Date();
    const noEmail = !status.login_email;

    const rows = [];
    rows.push(`<div class="panel-detail-row"><span class="panel-detail-label">Status</span><span class="panel-detail-value">${badge}</span></div>`);
    rows.push(`<div class="panel-detail-row"><span class="panel-detail-label">Login email</span><span class="panel-detail-value">${noEmail ? '<em>No email on record</em>' : esc(status.login_email)}</span></div>`);
    if (status.exists) {
        rows.push(`<div class="panel-detail-row"><span class="panel-detail-label">Password issued</span><span class="panel-detail-value">${esc(when(status.password_set_at))}</span></div>`);
        rows.push(`<div class="panel-detail-row"><span class="panel-detail-label">Last login</span><span class="panel-detail-value">${esc(when(status.last_login_at))}</span></div>`);
        if (locked) rows.push(`<div class="panel-detail-row"><span class="panel-detail-label">Locked</span><span class="panel-detail-value" style="color:var(--color-warning);">Too many wrong passwords — unlocks ${esc(when(status.locked_until))}. Generating a new password unlocks it now.</span></div>`);
    }

    const warnings = [];
    if (noEmail) warnings.push('Add an email address to this customer first — it is what the client signs in with.');
    if (status.exists && status.email_matches_customer === false) warnings.push('The customer\'s email changed after the password was issued. The client must still sign in with the OLD address until you generate a new password.');

    const oneTime = issued ? `
        <div style="margin:12px 0; padding:12px; border:1px dashed var(--brand-primary); border-radius:8px; background:var(--bg-tertiary);">
            <div style="font-weight:600; color:var(--text-primary); margin-bottom:6px;">New password — shown once</div>
            <div style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:16px; letter-spacing:1px; color:var(--text-primary); user-select:all;" id="portalIssuedPassword">${esc(issued.password)}</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:6px; line-height:1.5;">
                Copy it now and hand it to the client with the portal link. Once you leave this panel it cannot be shown again — you would generate another.
            </div>
            <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                <button class="btn btn-sm btn-primary" type="button" id="portalCopyPasswordBtn">Copy password</button>
                <button class="btn btn-sm btn-secondary" type="button" id="portalCopyMessageBtn">Copy full message</button>
            </div>
        </div>` : '';

    host.innerHTML = `
        <div class="panel-detail-grid">${rows.join('')}</div>
        ${warnings.map(w => `<div style="margin-top:8px; font-size:12px; color:var(--color-warning); line-height:1.5;">${esc(w)}</div>`).join('')}
        ${oneTime}
        <div class="panel-detail-row" style="margin-top:10px;"><span class="panel-detail-label">Portal link</span>
            <span class="panel-detail-value" style="word-break:break-all;"><span id="portalLinkText">${esc(status.portal_url || '')}</span>
            <button class="btn btn-sm btn-link" type="button" id="portalCopyLinkBtn" style="padding:0 6px;">Copy</button></span></div>
        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" type="button" id="portalGenerateBtn" ${noEmail ? 'disabled' : ''}>${active ? 'Generate new password' : 'Generate password'}</button>
            <button class="btn btn-sm btn-secondary" type="button" id="portalEmailBtn" ${noEmail ? 'disabled' : ''}>Email password to client</button>
            ${active ? '<button class="btn btn-sm btn-outline-danger" type="button" id="portalRevokeBtn">Revoke access</button>' : ''}
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:8px; line-height:1.5;">
            Generating or emailing replaces any previous password and signs the client out everywhere.
            Email goes to the login address from your configured sending mailbox.
        </div>`;

    document.getElementById('portalGenerateBtn')?.addEventListener('click', () => portalGenerate(customerId, active));
    document.getElementById('portalEmailBtn')?.addEventListener('click', () => portalSendEmail(customerId, active, status.login_email));
    document.getElementById('portalRevokeBtn')?.addEventListener('click', () => portalRevoke(customerId));
    document.getElementById('portalCopyLinkBtn')?.addEventListener('click', () => portalCopy(status.portal_url || '', 'Portal link copied'));
    if (issued) {
        document.getElementById('portalCopyPasswordBtn')?.addEventListener('click', () => portalCopy(issued.password, 'Password copied'));
        document.getElementById('portalCopyMessageBtn')?.addEventListener('click', () => portalCopy(
            `Your client portal access\n\nPortal link: ${issued.portal_url || status.portal_url || ''}\nLogin email: ${issued.login_email}\nPassword: ${issued.password}\n\nKeep this password safe. Contact us if you need it changed.`,
            'Message copied'));
    }
}

async function portalGenerate(customerId, alreadyActive) {
    if (alreadyActive) {
        const ok = await AccountsCommon.confirm('This replaces the client\'s current password and signs them out of the portal. Continue?', 'Generate new password');
        if (!ok) return;
    }
    try {
        const issued = await api.request(AccountsCommon.buildUrl(`customers/${customerId}/portal-access/generate`), { method: 'POST' });
        const status = await api.request(AccountsCommon.buildUrl(`customers/${customerId}/portal-access`), { _skipSpinner: true });
        renderPortalAccessStatus(customerId, status, issued);
        Toast.success('Password generated — copy it now, it is shown once');
    } catch (err) {
        console.error('[Parties] portalGenerate error:', err);
        Toast.error(err.message || 'Failed to generate the password');
    }
}

async function portalSendEmail(customerId, alreadyActive, email) {
    const ok = await AccountsCommon.confirm(
        `A new password will be generated and emailed to ${email || 'the client'} with the portal link.${alreadyActive ? ' The current password stops working.' : ''} Continue?`,
        'Email portal password');
    if (!ok) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl(`customers/${customerId}/portal-access/send-email`), { method: 'POST' });
        Toast.success(`Password emailed to ${res?.sent_to || email || 'the client'}`);
        await loadPortalAccess(customerId);
    } catch (err) {
        console.error('[Parties] portalSendEmail error:', err);
        Toast.error(err.message || 'The email could not be sent');
        await loadPortalAccess(customerId);
    }
}

async function portalRevoke(customerId) {
    const ok = await AccountsCommon.confirm('The client will be signed out and unable to log in until you generate a new password. Continue?', 'Revoke portal access');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`customers/${customerId}/portal-access/revoke`), { method: 'POST' });
        Toast.success('Portal access revoked');
        await loadPortalAccess(customerId);
    } catch (err) {
        console.error('[Parties] portalRevoke error:', err);
        Toast.error(err.message || 'Failed to revoke portal access');
    }
}

async function portalCopy(text, okMessage) {
    try {
        await navigator.clipboard.writeText(text);
        Toast.success(okMessage);
    } catch (_) {
        Toast.error('Copy failed — select the text and copy it manually');
    }
}
