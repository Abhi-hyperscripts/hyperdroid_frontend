/**
 * AccountsService — Vendors & Customers Page
 *
 * Handles 2 sidebar tabs:
 *   1. Vendor List
 *   2. Customer List
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let vendors = [];
let customers = [];

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('parties', '../')) return;

    const tabNames = {
        'vendor-list': 'Vendor List',
        'customer-list': 'Customer List'
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
        case 'vendor-list':   loadVendors(); break;
        case 'customer-list': loadCustomers(); break;
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        await Promise.all([loadVendors(), loadCustomers()]);
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
// VENDOR DETAIL VIEW
// ============================================================================

async function viewVendor(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`vendors/${id}`));
        const v = res?.data || res;
        if (!v) { Toast.error('Vendor not found'); return; }

        const esc = AccountsCommon.escapeHtml;
        const fmt = AccountsCommon.formatCurrency;
        const statusText = v.is_active !== false ? 'Active' : 'Inactive';

        document.getElementById('partyDetailModalTitle').textContent = 'Vendor Details';
        document.getElementById('partyDetailBody').innerHTML = `
            <div class="detail-grid">
                <div class="detail-row"><span class="detail-label">Vendor Code</span><span class="detail-value">${esc(v.vendor_code || v.code || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${esc(v.name || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Display Name</span><span class="detail-value">${esc(v.display_name || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${esc(v.email || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">${esc(v.phone || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Tax ID</span><span class="detail-value">${esc(v.tax_id || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Payment Terms</span><span class="detail-value">${v.payment_terms_days != null ? v.payment_terms_days + ' days' : '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusText}</span></div>
                <div class="detail-row"><span class="detail-label">Address Line 1</span><span class="detail-value">${esc(v.address_line1 || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Address Line 2</span><span class="detail-value">${esc(v.address_line2 || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">City</span><span class="detail-value">${esc(v.city || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">State</span><span class="detail-value">${esc(v.state || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">State Code</span><span class="detail-value">${esc(v.state_code || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Country</span><span class="detail-value">${esc(v.country || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Postal Code</span><span class="detail-value">${esc(v.postal_code || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Bank Name</span><span class="detail-value">${esc(v.bank_name || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Bank Account</span><span class="detail-value">${esc(v.bank_account_number || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Bank IFSC</span><span class="detail-value">${esc(v.bank_ifsc || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Bank SWIFT</span><span class="detail-value">${esc(v.bank_swift || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${esc(v.notes || '-')}</span></div>
            </div>`;
        AccountsCommon.openModal('partyDetailModal');
    } catch (err) {
        console.error('[Parties] viewVendor error:', err);
        Toast.error('Failed to load vendor details');
    }
}

// ============================================================================
// CUSTOMER DETAIL VIEW
// ============================================================================

async function viewCustomer(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`customers/${id}`));
        const c = res?.data || res;
        if (!c) { Toast.error('Customer not found'); return; }

        const esc = AccountsCommon.escapeHtml;
        const fmt = AccountsCommon.formatCurrency;
        const statusText = c.is_active !== false ? 'Active' : 'Inactive';

        document.getElementById('partyDetailModalTitle').textContent = 'Customer Details';
        document.getElementById('partyDetailBody').innerHTML = `
            <div class="detail-grid">
                <div class="detail-row"><span class="detail-label">Customer Code</span><span class="detail-value">${esc(c.customer_code || c.code || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${esc(c.name || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Display Name</span><span class="detail-value">${esc(c.display_name || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${esc(c.email || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">${esc(c.phone || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Tax ID</span><span class="detail-value">${esc(c.tax_id || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Payment Terms</span><span class="detail-value">${c.payment_terms_days != null ? c.payment_terms_days + ' days' : '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Credit Limit</span><span class="detail-value">${c.credit_limit != null ? fmt(c.credit_limit) : '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusText}</span></div>
                <div class="detail-row"><span class="detail-label">Address Line 1</span><span class="detail-value">${esc(c.address_line1 || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Address Line 2</span><span class="detail-value">${esc(c.address_line2 || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">City</span><span class="detail-value">${esc(c.city || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">State</span><span class="detail-value">${esc(c.state || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">State Code</span><span class="detail-value">${esc(c.state_code || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Country</span><span class="detail-value">${esc(c.country || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Postal Code</span><span class="detail-value">${esc(c.postal_code || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${esc(c.notes || '-')}</span></div>
            </div>`;
        AccountsCommon.openModal('partyDetailModal');
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
