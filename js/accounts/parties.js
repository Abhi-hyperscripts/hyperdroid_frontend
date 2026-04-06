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
});

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
    if (vendorSearch) vendorSearch.addEventListener('input', debounce(() => renderVendorsTable()));

    const customerSearch = document.getElementById('customerSearch');
    if (customerSearch) customerSearch.addEventListener('input', debounce(() => renderCustomersTable()));
}

// ============================================================================
// 1. VENDORS
// ============================================================================

async function loadVendors() {
    try {
        const showInactive = document.getElementById('showInactiveVendors')?.checked || false;
        const params = {};
        if (showInactive) params.includeInactive = true;

        const url = AccountsCommon.buildUrl('vendors', params);
        const res = await api.request(url, { _skipSpinner: true });
        vendors = Array.isArray(res) ? res : (res?.data || res?.items || []);
        updateVendorStats();
        renderVendorsTable();
    } catch (err) {
        console.error('[Parties] loadVendors error:', err);
        Toast.error('Failed to load vendors');
    }
}

function updateVendorStats() {
    const active = vendors.filter(v => v.is_active !== false);
    const inactive = vendors.filter(v => v.is_active === false);
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('totalVendors', vendors.length);
    el('activeVendors', active.length);
    el('inactiveVendors', inactive.length);
}

function renderVendorsTable() {
    const tbody = document.getElementById('vendorsTable');
    if (!tbody) return;

    const search = (document.getElementById('vendorSearch')?.value || '').toLowerCase();
    const showInactive = document.getElementById('showInactiveVendors')?.checked || false;

    let filtered = vendors;
    if (!showInactive) filtered = filtered.filter(v => v.is_active !== false);
    if (search) {
        filtered = filtered.filter(v =>
            (v.name || '').toLowerCase().includes(search) ||
            (v.vendor_code || v.code || '').toLowerCase().includes(search) ||
            (v.email || '').toLowerCase().includes(search) ||
            (v.tax_id || '').toLowerCase().includes(search)
        );
    }

    if (!filtered.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="1" y="3" width="15" height="13"></rect>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                <circle cx="5.5" cy="18.5" r="2.5"></circle>
                <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg><p>No vendors found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(v => {
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
            <td>${AccountsCommon.escapeHtml(v.email || '-')}</td>
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
                <div class="panel-detail-row"><span class="panel-detail-label">Website</span><span class="panel-detail-value">${item.website ? `<a href="${esc(item.website)}" target="_blank" style="color:var(--brand-primary)">${esc(item.website)}</a>` : '-'}</span></div>
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
                <div class="panel-detail-row"><span class="panel-detail-label">Address Line 2</span><span class="panel-detail-value">${esc(item.address_line2 || '-')}</span></div>
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
    AccountsCommon.openModal('vendorModal');
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
    document.getElementById('vendorState').value = v.state || '';
    document.getElementById('vendorStateCode').value = v.state_code || '';
    document.getElementById('vendorCountry').value = v.country || '';
    document.getElementById('vendorPostalCode').value = v.postal_code || '';
    document.getElementById('vendorTaxId').value = v.tax_id || '';
    document.getElementById('vendorPaymentTerms').value = v.payment_terms_days ?? 30;
    document.getElementById('vendorBankName').value = v.bank_name || '';
    document.getElementById('vendorBankAccount').value = v.bank_account_number || '';
    document.getElementById('vendorBankIfsc').value = v.bank_ifsc || '';
    document.getElementById('vendorBankSwift').value = v.bank_swift || '';
    document.getElementById('vendorNotes').value = v.notes || '';
    AccountsCommon.openModal('vendorModal');
}

async function saveVendor() {
    const id = document.getElementById('vendorId').value;
    const name = document.getElementById('vendorName').value.trim();
    if (!name) { Toast.error('Vendor name is required'); return; }

    const payload = {
        name,
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
        tax_id: document.getElementById('vendorTaxId').value.trim() || null,
        payment_terms_days: parseInt(document.getElementById('vendorPaymentTerms').value) || 30,
        bank_name: document.getElementById('vendorBankName').value.trim() || null,
        bank_account_number: document.getElementById('vendorBankAccount').value.trim() || null,
        bank_ifsc: document.getElementById('vendorBankIfsc').value.trim() || null,
        bank_swift: document.getElementById('vendorBankSwift').value.trim() || null,
        notes: document.getElementById('vendorNotes').value.trim() || null
    };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`vendors/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Vendor updated');
        } else {
            await api.request(AccountsCommon.buildUrl('vendors'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Vendor created');
        }
        AccountsCommon.closeModal('vendorModal');
        await loadVendors();
    } catch (err) {
        console.error('[Parties] saveVendor error:', err);
        Toast.error(err.message || 'Failed to save vendor');
    }
}

// ============================================================================
// 2. CUSTOMERS
// ============================================================================

async function loadCustomers() {
    try {
        const showInactive = document.getElementById('showInactiveCustomers')?.checked || false;
        const params = {};
        if (showInactive) params.includeInactive = true;

        const url = AccountsCommon.buildUrl('customers', params);
        const res = await api.request(url, { _skipSpinner: true });
        customers = Array.isArray(res) ? res : (res?.data || res?.items || []);
        updateCustomerStats();
        renderCustomersTable();
    } catch (err) {
        console.error('[Parties] loadCustomers error:', err);
        Toast.error('Failed to load customers');
    }
}

function updateCustomerStats() {
    const active = customers.filter(c => c.is_active !== false);
    const inactive = customers.filter(c => c.is_active === false);
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('totalCustomers', customers.length);
    el('activeCustomers', active.length);
    el('inactiveCustomers', inactive.length);
}

function renderCustomersTable() {
    const tbody = document.getElementById('customersTable');
    if (!tbody) return;

    const search = (document.getElementById('customerSearch')?.value || '').toLowerCase();
    const showInactive = document.getElementById('showInactiveCustomers')?.checked || false;

    let filtered = customers;
    if (!showInactive) filtered = filtered.filter(c => c.is_active !== false);
    if (search) {
        filtered = filtered.filter(c =>
            (c.name || '').toLowerCase().includes(search) ||
            (c.customer_code || c.code || '').toLowerCase().includes(search) ||
            (c.email || '').toLowerCase().includes(search) ||
            (c.tax_id || '').toLowerCase().includes(search)
        );
    }

    if (!filtered.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg><p>No customers found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(c => {
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
            <td>${AccountsCommon.escapeHtml(c.email || '-')}</td>
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

function showCreateCustomerModal() {
    document.getElementById('customerModalTitle').textContent = 'Create Customer';
    document.getElementById('customerForm').reset();
    document.getElementById('customerId').value = '';
    document.getElementById('customerPaymentTerms').value = '30';
    document.getElementById('customerCodeRow').style.display = 'none';
    AccountsCommon.openModal('customerModal');
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
    document.getElementById('customerAddressLine1').value = c.address_line1 || '';
    document.getElementById('customerAddressLine2').value = c.address_line2 || '';
    document.getElementById('customerCity').value = c.city || '';
    document.getElementById('customerState').value = c.state || '';
    document.getElementById('customerStateCode').value = c.state_code || '';
    document.getElementById('customerCountry').value = c.country || '';
    document.getElementById('customerPostalCode').value = c.postal_code || '';
    document.getElementById('customerTaxId').value = c.tax_id || '';
    document.getElementById('customerPaymentTerms').value = c.payment_terms_days ?? 30;
    document.getElementById('customerCreditLimit').value = c.credit_limit ?? '';
    document.getElementById('customerNotes').value = c.notes || '';
    AccountsCommon.openModal('customerModal');
}

async function saveCustomer() {
    const id = document.getElementById('customerId').value;
    const name = document.getElementById('customerName').value.trim();
    if (!name) { Toast.error('Customer name is required'); return; }

    const creditVal = document.getElementById('customerCreditLimit').value;

    const payload = {
        name,
        display_name: document.getElementById('customerDisplayName').value.trim() || null,
        email: document.getElementById('customerEmail').value.trim() || null,
        phone: document.getElementById('customerPhone').value.trim() || null,
        address_line1: document.getElementById('customerAddressLine1').value.trim() || null,
        address_line2: document.getElementById('customerAddressLine2').value.trim() || null,
        city: document.getElementById('customerCity').value.trim() || null,
        state: document.getElementById('customerState').value.trim() || null,
        state_code: document.getElementById('customerStateCode').value.trim() || null,
        country: document.getElementById('customerCountry').value.trim() || null,
        postal_code: document.getElementById('customerPostalCode').value.trim() || null,
        tax_id: document.getElementById('customerTaxId').value.trim() || null,
        payment_terms_days: parseInt(document.getElementById('customerPaymentTerms').value) || 30,
        credit_limit: creditVal ? parseFloat(creditVal) : null,
        notes: document.getElementById('customerNotes').value.trim() || null
    };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`customers/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Customer updated');
        } else {
            await api.request(AccountsCommon.buildUrl('customers'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Customer created');
        }
        AccountsCommon.closeModal('customerModal');
        await loadCustomers();
    } catch (err) {
        console.error('[Parties] saveCustomer error:', err);
        Toast.error(err.message || 'Failed to save customer');
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
        color = 'var(--color-error)';
    } else if (diffHours < 8) {
        text = `in ${Math.round(diffHours)} hours`;
        color = 'var(--color-error)';
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
            const rejectBtn = `<button class="btn-icon" onclick="rejectRequest('${r.id}', '${type}')" data-tooltip="Reject" style="color:var(--color-error);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
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
    }
}
