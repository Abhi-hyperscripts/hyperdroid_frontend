/**
 * AccountsService — Accounts Receivable Page
 *
 * Handles 5 sidebar tabs:
 *   1. Customer Invoices    4. AR Aging
 *   2. Customer Payments    5. Customer Statements
 *   3. Credit Notes
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let customers = [];
let accounts = [];
let bankAccounts = [];

// Module-scoped caches so row-action handlers can look up the full entity
// by id without re-fetching. Populated by load*() functions after every API call.
let customerInvoices = [];
let customerPayments = [];
let creditNotes = [];

let invoicePage = 1;
let paymentPage = 1;
let cnPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let invoiceCustomerFilterDD = null;
let paymentCustomerFilterDD = null;
let cnCustomerFilterDD = null;
let statementCustomerDD = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('receivables', '../')) return;

    const tabNames = {
        'customer-invoices': 'Invoices',
        'customer-payments': 'Payments',
        'credit-notes': 'Credit Notes',
        'ar-aging': 'AR Aging',
        'customer-statements': 'Customer Statements'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    setupSearchListeners();
    initDatePickers();
});

// ============================================================================
// TAB SWITCH
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'customer-invoices':   loadCustomerInvoices(); break;
        case 'customer-payments':   loadCustomerPayments(); break;
        case 'credit-notes':        loadCreditNotes(); break;
        case 'ar-aging':            loadARAging(); break;
        case 'customer-statements': break; // user-triggered
    }
}

// ============================================================================
// INITIAL DATA
// ============================================================================

async function loadInitialData() {
    try {
        const [custRes, acctRes, bankRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa', { isActive: true }), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => [])
        ]);
        customers = Array.isArray(custRes) ? custRes : (custRes?.data || custRes?.items || []);
        accounts = Array.isArray(acctRes) ? acctRes : (acctRes?.data || acctRes?.items || []);
        bankAccounts = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);
        // Build bank account name map
        window._bankAccountMap = {};
        bankAccounts.forEach(b => { window._bankAccountMap[b.id] = b.account_name || b.bank_name || b.name; });

        populateSelect('invoiceCustomerId', customers, 'id', 'name', 'Select customer...');
        populateSelect('paymentCustomerId', customers, 'id', 'name', 'Select customer...');
        populateSelect('cnCustomerId', customers, 'id', 'name', 'Select customer...');
        populateSelect('paymentBankAccountId', bankAccounts.map(b => ({ ...b, name: b.account_name || b.name })), 'id', 'name', 'Select bank...');

        loadCustomerInvoices();
    } catch (err) {
        console.error('[AR] loadInitialData error:', err);
    }
}

function populateSelect(selectId, items, valueField, labelField, placeholder) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">${AccountsCommon.escapeHtml(placeholder)}</option>`;
    items.forEach(item => {
        sel.innerHTML += `<option value="${item[valueField]}">${AccountsCommon.escapeHtml(item[labelField] || item.code || '')}</option>`;
    });
}

// ============================================================================
// SEARCH & DATE PICKERS
// ============================================================================

function setupSearchListeners() {
    const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    document.getElementById('invoiceSearch')?.addEventListener('input', debounce(() => { invoicePage = 1; loadCustomerInvoices(); }));
    document.getElementById('invoiceStatusFilter')?.addEventListener('change', () => { invoicePage = 1; loadCustomerInvoices(); });
    document.getElementById('paymentSearch')?.addEventListener('input', debounce(() => { paymentPage = 1; loadCustomerPayments(); }));
    document.getElementById('cnSearch')?.addEventListener('input', debounce(() => { cnPage = 1; loadCreditNotes(); }));
}

function initDatePickers() {
    if (typeof flatpickr !== 'function') {
        setTimeout(initDatePickers, 300);
        return;
    }
    const opts = { dateFormat: 'Y-m-d', allowInput: true };
    flatpickr('#invoiceDateFrom', { ...opts, onChange: () => { invoicePage = 1; loadCustomerInvoices(); } });
    flatpickr('#invoiceDateTo', { ...opts, onChange: () => { invoicePage = 1; loadCustomerInvoices(); } });
    flatpickr('#paymentDateFrom', { ...opts, onChange: () => { paymentPage = 1; loadCustomerPayments(); } });
    flatpickr('#paymentDateTo', { ...opts, onChange: () => { paymentPage = 1; loadCustomerPayments(); } });
    flatpickr('#cnDateFrom', { ...opts, onChange: () => { cnPage = 1; loadCreditNotes(); } });
    flatpickr('#cnDateTo', { ...opts, onChange: () => { cnPage = 1; loadCreditNotes(); } });
    flatpickr('#statementDateFrom', opts);
    flatpickr('#statementDateTo', opts);
    flatpickr('#invoiceDate', opts);
    flatpickr('#invoiceDueDate', opts);
    flatpickr('#paymentDate', opts);
    flatpickr('#cnDate', opts);
}

// ============================================================================
// DROPDOWNS
// ============================================================================

function initDropdowns() {
    const custOpts = customers.map(c => ({ value: c.id, label: c.name }));

    invoiceCustomerFilterDD = new SearchableDropdown(document.getElementById('invoiceCustomerFilterContainer'), {
        id: 'invoiceCustomerFilter', options: custOpts, placeholder: 'All Customers',
        searchPlaceholder: 'Search customers...', compact: true,
        onChange: () => { invoicePage = 1; loadCustomerInvoices(); }
    });
    paymentCustomerFilterDD = new SearchableDropdown(document.getElementById('paymentCustomerFilterContainer'), {
        id: 'paymentCustomerFilter', options: custOpts, placeholder: 'All Customers',
        searchPlaceholder: 'Search customers...', compact: true,
        onChange: () => { paymentPage = 1; loadCustomerPayments(); }
    });
    cnCustomerFilterDD = new SearchableDropdown(document.getElementById('cnCustomerFilterContainer'), {
        id: 'cnCustomerFilter', options: custOpts, placeholder: 'All Customers',
        searchPlaceholder: 'Search customers...', compact: true,
        onChange: () => { cnPage = 1; loadCreditNotes(); }
    });
    statementCustomerDD = new SearchableDropdown(document.getElementById('statementCustomerFilterContainer'), {
        id: 'statementCustomerFilter', options: custOpts, placeholder: 'Select Customer',
        searchPlaceholder: 'Search customers...', compact: true
    });
}

// ============================================================================
// CUSTOMER INVOICES
// ============================================================================

async function loadCustomerInvoices() {
    const params = { limit: PAGE_SIZE, offset: (invoicePage - 1) * PAGE_SIZE };
    const customerId = invoiceCustomerFilterDD?.getValue?.();
    const status = document.getElementById('invoiceStatusFilter')?.value;
    const dateFrom = document.getElementById('invoiceDateFrom')?.value;
    const dateTo = document.getElementById('invoiceDateTo')?.value;
    const search = document.getElementById('invoiceSearch')?.value?.trim();

    if (customerId) params.customerId = customerId;
    if (status) params.status = status;
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;
    if (search) params.search = search;

    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices', params));
        const items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        customerInvoices = items;  // cache for row action handlers
        const total = res?.total || items.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        // Stats — prefer backend stats, fallback to client-side
        const stats = res?.stats || {};
        setText('totalInvoices', stats.total_count ?? total);
        setText('draftInvoices', stats.draft_count ?? items.filter(i => i.status === 'draft').length);
        setText('approvedInvoices', stats.approved_count ?? items.filter(i => i.status === 'approved').length);
        setText('totalReceivable', stats.total_receivable != null ? AccountsCommon.formatCurrency(stats.total_receivable) : AccountsCommon.formatCurrency(items.reduce((s, i) => s + parseFloat(i.balance_due || i.balance || 0), 0)));

        const tbody = document.getElementById('customerInvoicesTable');
        if (!items.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="8"><div class="empty-message"><p>No invoices found</p></div></td></tr>';
        } else {
            tbody.innerHTML = items.map(inv => {
                const custName = inv.customer_name || customers.find(c => c.id === inv.customer_id)?.name || '-';
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(inv.invoice_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}</td>
                    <td>${AccountsCommon.formatDate(inv.invoice_date)}</td>
                    <td>${AccountsCommon.formatDate(inv.due_date)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(inv.total_amount)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(inv.balance_due || inv.balance)}</td>
                    <td>${AccountsCommon.statusBadge(inv.status)}</td>
                    <td class="actions-cell">${invoiceActions(inv)}</td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('invoicesPagination', invoicePage, totalPages, p => { invoicePage = p; loadCustomerInvoices(); });
    } catch (err) {
        console.error('[AR] loadCustomerInvoices error:', err);
        Toast.error('Failed to load invoices');
    }
}

function invoiceActions(inv) {
    // View button always shown
    let html = `<button class="btn-icon" data-tooltip="View" onclick="viewInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
    if (inv.status === 'draft') {
        html += ` <button class="btn-icon" data-tooltip="Edit" onclick="editInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
        html += ` <button class="btn-icon" data-tooltip="Approve" onclick="approveInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Delete" onclick="deleteDraftInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    }
    if (inv.status === 'approved') {
        html += ` <button class="btn-icon" data-tooltip="Send" onclick="sendInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`;
    }
    if (inv.status === 'sent' || inv.status === 'approved' || inv.status === 'partially_paid') {
        html += ` <button class="btn btn-outline" style="padding:0.2rem 0.6rem;font-size:0.75rem;" onclick="showRecordPaymentModal(); document.getElementById('paymentCustomerId').value='${inv.customer_id}';">Pay</button>`;
    }
    return html;
}

// ============================================================================
// BULK INVOICE IMPORT
// ============================================================================

function showBulkInvoiceModal() {
    document.getElementById('bulkInvoiceData').value = '';
    const fileInput = document.getElementById('bulkInvoiceFile');
    if (fileInput) fileInput.value = '';
    AccountsCommon.openModal('bulkInvoiceModal');
}

function handleBulkInvoiceFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const content = e.target.result;
        if (file.name.endsWith('.json')) {
            document.getElementById('bulkInvoiceData').value = content;
        } else if (file.name.endsWith('.csv')) {
            try {
                const lines = content.split('\n').filter(l => l.trim());
                if (lines.length < 2) { Toast.error('CSV must have a header row and at least one data row'); return; }
                const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
                const rows = lines.slice(1).map(line => {
                    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                    const obj = {};
                    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
                    return obj;
                });
                document.getElementById('bulkInvoiceData').value = JSON.stringify(rows, null, 2);
            } catch (csvErr) {
                Toast.error('Failed to parse CSV file');
            }
        } else {
            Toast.error('Unsupported file type. Use .json or .csv');
        }
    };
    reader.readAsText(file);
}

async function submitBulkInvoices() {
    const text = document.getElementById('bulkInvoiceData').value.trim();
    if (!text) { Toast.error('Please paste invoice data or upload a file'); return; }
    try {
        const invoices = JSON.parse(text);
        if (!Array.isArray(invoices)) { Toast.error('Data must be a JSON array'); return; }
        if (!invoices.length) { Toast.error('Array is empty'); return; }
        const res = await api.request(AccountsCommon.buildUrl('invoices/bulk'), {
            method: 'POST',
            body: JSON.stringify({ invoices }),
            headers: { 'Content-Type': 'application/json' }
        });
        const created = res?.created || res?.success_count || invoices.length;
        const failed = res?.failed || res?.error_count || 0;
        if (failed > 0) {
            Toast.warning(`${created} invoices created, ${failed} failed`);
        } else {
            Toast.success(`${created} invoices created successfully`);
        }
        AccountsCommon.closeModal('bulkInvoiceModal');
        await loadCustomerInvoices();
    } catch (err) {
        console.error('[AR] submitBulkInvoices error:', err);
        Toast.error(err.message || 'Failed to import invoices');
    }
}

// ============================================================================
// INVOICE MODAL & CRUD
// ============================================================================

function showCreateInvoiceModal() {
    document.getElementById('invoiceModalTitle').textContent = 'Create Invoice';
    document.getElementById('invoiceForm').reset();
    document.getElementById('invoiceId').value = '';
    document.getElementById('invoiceLines').innerHTML = '';
    addInvoiceLine();
    calculateInvoiceTotals();
    AccountsCommon.openModal('customerInvoiceModal');
}

async function editInvoice(id) {
    try {
        const inv = await api.request(AccountsCommon.buildUrl(`invoices/${id}`));
        document.getElementById('invoiceModalTitle').textContent = `Edit Invoice ${inv.invoice_number || ''}`;
        document.getElementById('invoiceId').value = inv.id;
        document.getElementById('invoiceCustomerId').value = inv.customer_id || '';
        document.getElementById('invoiceDate').value = inv.invoice_date?.split('T')[0] || '';
        document.getElementById('invoiceDueDate').value = inv.due_date?.split('T')[0] || '';
        document.getElementById('invoiceNotes').value = inv.notes || '';

        const lines = inv.lines || inv.line_items || [];
        const tbody = document.getElementById('invoiceLines');
        tbody.innerHTML = '';
        if (lines.length) {
            lines.forEach(l => addInvoiceLine(l));
        } else {
            addInvoiceLine();
        }
        calculateInvoiceTotals();
        AccountsCommon.openModal('customerInvoiceModal');
    } catch (err) {
        Toast.error('Failed to load invoice');
    }
}

function addInvoiceLine(data = {}) {
    // Normalize: backend uses unit_price, frontend uses rate
    if (data.unit_price !== undefined && data.rate === undefined) data.rate = data.unit_price;
    const tbody = document.getElementById('invoiceLines');
    const row = document.createElement('tr');
    const acctOptions = accounts.map(a => {
        const code = a.account_code || a.code || '';
        const name = a.account_name || a.name || '';
        const label = code && name ? `${code} — ${name}` : (name || code);
        return `<option value="${a.id}" ${a.id === data.account_id ? 'selected' : ''}>${AccountsCommon.escapeHtml(label)}</option>`;
    }).join('');

    row.innerHTML = `
        <td><input type="text" class="form-control line-desc" value="${AccountsCommon.escapeHtml(data.description || '')}" placeholder="Description"></td>
        <td><select class="form-control line-account"><option value="">Select...</option>${acctOptions}</select></td>
        <td><input type="text" class="form-control line-hsn" value="${AccountsCommon.escapeHtml(data.hsn_sac || '')}" placeholder="HSN/SAC"></td>
        <td><input type="number" class="form-control line-qty" value="${data.quantity || 1}" min="0" step="any" oninput="calculateInvoiceTotals()"></td>
        <td><input type="number" class="form-control line-rate" value="${data.rate || ''}" min="0" step="0.01" placeholder="0.00" oninput="calculateInvoiceTotals()"></td>
        <td class="line-amount" style="text-align:right; padding-top:0.7rem;">0.00</td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="removeInvoiceLine(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);
    calculateInvoiceTotals();
}

function removeInvoiceLine(btn) {
    btn.closest('tr').remove();
    calculateInvoiceTotals();
}

function calculateInvoiceTotals() {
    let subtotal = 0;
    document.querySelectorAll('#invoiceLines tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const amt = qty * rate;
        subtotal += amt;
        const amtCell = row.querySelector('.line-amount');
        if (amtCell) amtCell.textContent = amt.toFixed(2);
    });
    // Tax is computed server-side; show 0 for now
    const tax = 0;
    setText('invoiceSubtotal', subtotal.toFixed(2));
    setText('invoiceTax', tax.toFixed(2));
    setText('invoiceTotal', (subtotal + tax).toFixed(2));
}

async function saveInvoice(approve) {
    const form = document.getElementById('invoiceForm');
    if (!form.reportValidity()) return;

    const lines = [];
    document.querySelectorAll('#invoiceLines tr').forEach(row => {
        // Note: backend CreateCustomerInvoiceLineRequest accepts only
        // {account_id, description, quantity, unit_price}. The `hsn_sac` field is silently
        // dropped server-side; collected here so the future backend extension can use it.
        lines.push({
            description: row.querySelector('.line-desc')?.value || '',
            account_id: row.querySelector('.line-account')?.value || null,
            hsn_sac: row.querySelector('.line-hsn')?.value || '',
            quantity: parseFloat(row.querySelector('.line-qty')?.value) || 0,
            unit_price: parseFloat(row.querySelector('.line-rate')?.value) || 0
        });
    });

    // Backend CreateCustomerInvoiceRequest has NO `status` field — passing
    // status:'approved' here was silently dropped, so "Save & Approve" only ever
    // saved a draft. Fixed in Phase 4 Tier 1: send a clean payload without `status`,
    // then chain a POST /approve when approve===true.
    const payload = {
        customer_id: document.getElementById('invoiceCustomerId').value,
        invoice_date: document.getElementById('invoiceDate').value,
        due_date: document.getElementById('invoiceDueDate').value,
        notes: document.getElementById('invoiceNotes').value,
        lines
    };

    const id = document.getElementById('invoiceId').value;
    try {
        let savedInvoice;
        if (id) {
            // PUT /invoices/{id} doesn't exist on backend yet — Tier 3 will add it.
            // Until then, Edit Invoice clicks here will 405; row is still flagged as gap.
            savedInvoice = await api.request(AccountsCommon.buildUrl(`invoices/${id}`), { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        } else {
            savedInvoice = await api.request(AccountsCommon.buildUrl('invoices'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        }

        if (approve && savedInvoice?.id) {
            // Chain the approve call so "Save & Approve" actually approves
            await api.request(AccountsCommon.buildUrl(`invoices/${savedInvoice.id}/approve`), { method: 'POST' });
            Toast.success('Invoice created and approved');
        } else {
            Toast.success(id ? 'Invoice updated' : 'Invoice saved as draft');
        }
        AccountsCommon.closeModal('customerInvoiceModal');
        loadCustomerInvoices();
    } catch (err) {
        Toast.error(err.message || 'Failed to save invoice');
    }
}

function _invoiceLabel(id) {
    const inv = customerInvoices.find(x => x.id === id);
    if (!inv) return { label: 'this invoice', invNo: '', customerName: '' };
    const fmt = AccountsCommon.formatCurrency;
    const invNo = inv.invoice_number || '';
    const customerName = inv.customer_name || customers?.find(c => c.id === inv.customer_id)?.name || 'the customer';
    const amount = inv.total_amount != null ? fmt(inv.total_amount) : '';
    const dateStr = inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const label = `${invNo ? invNo + ' ' : ''}for ${customerName}${amount ? ' totalling ' + amount : ''}${dateStr ? ' dated ' + dateStr : ''}`;
    return { label, invNo, customerName };
}

async function approveInvoice(id) {
    const { label } = _invoiceLabel(id);
    const ok = await Confirm.show({
        title: 'Approve Customer Invoice',
        message: `Approve ${label}? The invoice will move from Draft to Approved, post a journal entry (Dr Accounts Receivable, Cr Sales Revenue + Cr Output GST), and become eligible for payment collection. This cannot be undone without reversing the journal entry.`,
        confirmText: 'Approve',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`invoices/${id}/approve`), { method: 'POST' });
        Toast.success('Invoice approved');
        loadCustomerInvoices();
    } catch (err) { Toast.error('Failed to approve invoice'); }
}

async function sendInvoice(id) {
    const { label } = _invoiceLabel(id);
    const ok = await Confirm.show({
        title: 'Send Customer Invoice',
        message: `Mark ${label} as sent to the customer? This updates the invoice status to Sent and records the send date in the audit trail. Use this after you've actually emailed or delivered the invoice.`,
        confirmText: 'Mark as Sent',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`invoices/${id}/send`), { method: 'POST' });
        Toast.success('Invoice marked as sent');
        loadCustomerInvoices();
    } catch (err) { Toast.error('Failed to send invoice'); }
}

async function deleteDraftInvoice(id) {
    const { label } = _invoiceLabel(id);
    const ok = await Confirm.show({
        title: 'Delete Draft Invoice',
        message: `Delete ${label}? Only draft invoices can be deleted — once approved, an invoice can only be cancelled via a credit note. This cannot be undone.`,
        confirmText: 'Delete',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`invoices/${id}`), { method: 'DELETE' });
        Toast.success('Invoice deleted');
        loadCustomerInvoices();
    } catch (err) { Toast.error('Failed to delete invoice'); }
}

// ============================================================================
// CUSTOMER PAYMENTS
// ============================================================================

async function loadCustomerPayments() {
    const params = { limit: PAGE_SIZE, offset: (paymentPage - 1) * PAGE_SIZE };
    const customerId = paymentCustomerFilterDD?.getValue?.();
    const dateFrom = document.getElementById('paymentDateFrom')?.value;
    const dateTo = document.getElementById('paymentDateTo')?.value;
    const search = document.getElementById('paymentSearch')?.value?.trim();

    if (customerId) params.customerId = customerId;
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;
    if (search) params.search = search;

    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices/payments', params));
        const items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        customerPayments = items;
        const total = res?.total || items.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        const tbody = document.getElementById('customerPaymentsTable');
        if (!items.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No payments recorded</p></div></td></tr>';
        } else {
            tbody.innerHTML = items.map(p => {
                const custName = p.customer_name || customers.find(c => c.id === p.customer_id)?.name || '-';
                const bankName = p.bank_account_name || p.bank_name || window._bankAccountMap?.[p.bank_account_id] || bankAccounts.find(b => b.id === p.bank_account_id)?.account_name || (p.bank_account_id ? p.bank_account_id.substring(0, 8) + '...' : '-');
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(p.payment_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}</td>
                    <td>${AccountsCommon.formatDate(p.payment_date)}</td>
                    <td>${AccountsCommon.formatCurrency(p.amount)}</td>
                    <td>${AccountsCommon.escapeHtml(bankName)}</td>
                    <td>${AccountsCommon.escapeHtml(p.reference_number || p.reference || '-')}</td>
                    <td><button class="btn-icon" data-tooltip="View" onclick="editInvoice('${p.invoice_id || p.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('paymentsPagination', paymentPage, totalPages, p => { paymentPage = p; loadCustomerPayments(); });
    } catch (err) {
        console.error('[AR] loadCustomerPayments error:', err);
        Toast.error('Failed to load payments');
    }
}

function showRecordPaymentModal() {
    document.getElementById('paymentModalTitle').textContent = 'Record Payment';
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentId').value = '';
    document.getElementById('paymentAllocations').innerHTML = '<tr class="empty-state"><td colspan="3"><div class="empty-message"><p>Select a customer to see outstanding invoices</p></div></td></tr>';
    AccountsCommon.openModal('customerPaymentModal');
}

async function loadCustomerInvoicesForPayment() {
    const custId = document.getElementById('paymentCustomerId').value;
    const tbody = document.getElementById('paymentAllocations');
    if (!custId) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="3"><div class="empty-message"><p>Select a customer to see outstanding invoices</p></div></td></tr>';
        return;
    }
    try {
        // Backend expects camelCase `customerId` (not `customer_id`) and exact-string `status`
        // (so we can't pass a comma-separated list — fetch all and filter client-side).
        // Also reads `balance_due` (not `balance`) per CustomerInvoice model.
        const res = await api.request(AccountsCommon.buildUrl('invoices', { customerId: custId, limit: 200 }));
        const allItems = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const items = allItems.filter(inv => {
            const bal = parseFloat(inv.balance_due) || 0;
            const st = (inv.status || '').toLowerCase();
            return bal > 0 && (st === 'approved' || st === 'sent' || st === 'partial' || st === 'overdue');
        });
        if (!items.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="3"><div class="empty-message"><p>No outstanding invoices</p></div></td></tr>';
            return;
        }
        tbody.innerHTML = items.map(inv => {
            const bal = parseFloat(inv.balance_due) || 0;
            return `<tr>
                <td>${AccountsCommon.escapeHtml(inv.invoice_number || '-')}<input type="hidden" class="alloc-invoice-id" value="${inv.id}"></td>
                <td>${AccountsCommon.formatCurrency(bal)}</td>
                <td><input type="number" class="form-control alloc-amount" step="0.01" min="0" max="${bal}" placeholder="0.00"></td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="3"><div class="empty-message"><p>Failed to load invoices</p></div></td></tr>';
    }
}

async function saveCustomerPayment() {
    const form = document.getElementById('paymentForm');
    if (!form.reportValidity()) return;

    // Backend CustomerPaymentAllocationRequest expects { customer_invoice_id, allocated_amount }
    // — NOT { invoice_id, amount }. Sending the wrong shape silently dropped allocations
    // server-side and left invoice balance_due unchanged. Fixed in Phase 4 Tier 1.
    const allocations = [];
    document.querySelectorAll('#paymentAllocations tr:not(.empty-state)').forEach(row => {
        const invoiceId = row.querySelector('.alloc-invoice-id')?.value;
        const amount = parseFloat(row.querySelector('.alloc-amount')?.value) || 0;
        if (invoiceId && amount > 0) allocations.push({ customer_invoice_id: invoiceId, allocated_amount: amount });
    });

    // Backend RecordCustomerPaymentRequest expects `reference_number`, not `reference`.
    // Fixed in Phase 4 Tier 1 — was being silently dropped before.
    const payload = {
        customer_id: document.getElementById('paymentCustomerId').value,
        payment_date: document.getElementById('paymentDate').value,
        amount: parseFloat(document.getElementById('paymentAmount').value) || 0,
        bank_account_id: document.getElementById('paymentBankAccountId').value,
        reference_number: document.getElementById('paymentReference').value,
        payment_method: document.getElementById('paymentMethod')?.value || 'bank_transfer',
        allocations
    };

    try {
        await api.request(AccountsCommon.buildUrl('invoices/payments'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        Toast.success('Payment recorded');
        AccountsCommon.closeModal('customerPaymentModal');
        loadCustomerPayments();
        loadCustomerInvoices();
    } catch (err) {
        Toast.error(err.message || 'Failed to save payment');
    }
}

// ============================================================================
// CREDIT NOTES
// ============================================================================

async function loadCreditNotes() {
    const params = { limit: PAGE_SIZE, offset: (cnPage - 1) * PAGE_SIZE };
    const customerId = cnCustomerFilterDD?.getValue?.();
    const dateFrom = document.getElementById('cnDateFrom')?.value;
    const dateTo = document.getElementById('cnDateTo')?.value;
    const search = document.getElementById('cnSearch')?.value?.trim();
    const statusFilter = document.getElementById('creditNoteStatusFilter')?.value;

    if (customerId) params.customerId = customerId;
    if (statusFilter) params.status = statusFilter;
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;
    if (search) params.search = search;

    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices/credit-notes', params));
        const items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        creditNotes = items;
        const total = res?.total || items.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        const tbody = document.getElementById('creditNotesTable');
        if (!items.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No credit notes found</p></div></td></tr>';
        } else {
            tbody.innerHTML = items.map(cn => {
                const custName = cn.customer_name || customers.find(c => c.id === cn.customer_id)?.name || '-';
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(cn.credit_note_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}</td>
                    <td>${AccountsCommon.escapeHtml(cn.invoice_number || '-')}</td>
                    <td>${AccountsCommon.formatDate(cn.credit_date)}</td>
                    <td>${AccountsCommon.formatCurrency(cn.amount)}</td>
                    <td>${AccountsCommon.escapeHtml(cn.reason || '-')}</td>
                    <td><button class="btn-icon" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('creditNotesPagination', cnPage, totalPages, p => { cnPage = p; loadCreditNotes(); });
    } catch (err) {
        console.error('[AR] loadCreditNotes error:', err);
        Toast.error('Failed to load credit notes');
    }
}

function showCreateCreditNoteModal() {
    document.getElementById('creditNoteModalTitle').textContent = 'Create Credit Note';
    document.getElementById('creditNoteForm').reset();
    document.getElementById('creditNoteId').value = '';
    document.getElementById('cnInvoiceId').innerHTML = '<option value="">Select invoice...</option>';
    AccountsCommon.openModal('creditNoteModal');
}

async function loadCustomerInvoicesForCN() {
    const custId = document.getElementById('cnCustomerId').value;
    const sel = document.getElementById('cnInvoiceId');
    sel.innerHTML = '<option value="">Select invoice...</option>';
    if (!custId) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices', { customerId: custId, limit: 200 }));
        const items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        items.forEach(inv => {
            sel.innerHTML += `<option value="${inv.id}">${AccountsCommon.escapeHtml(inv.invoice_number || inv.id)} - ${AccountsCommon.formatCurrency(inv.total_amount)}</option>`;
        });
    } catch (err) { console.error('[AR] loadCustomerInvoicesForCN error:', err); }
}

async function saveCreditNote() {
    const form = document.getElementById('creditNoteForm');
    if (!form.reportValidity()) return;

    const payload = {
        customer_id: document.getElementById('cnCustomerId').value,
        customer_invoice_id: document.getElementById('cnInvoiceId').value,
        credit_date: document.getElementById('cnDate').value,
        amount: parseFloat(document.getElementById('cnAmount').value) || 0,
        reason: document.getElementById('cnReason').value
    };

    try {
        await api.request(AccountsCommon.buildUrl('invoices/credit-notes'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        Toast.success('Credit note created');
        AccountsCommon.closeModal('creditNoteModal');
        loadCreditNotes();
        loadCustomerInvoices();
    } catch (err) {
        Toast.error(err.message || 'Failed to create credit note');
    }
}

// ============================================================================
// AR AGING
// ============================================================================

async function loadARAging() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices/aging'));
        const rawData = Array.isArray(res) ? res : (res?.data || res?.buckets || []);
        const items = Array.isArray(rawData) ? rawData : (rawData.customers || []);

        // Normalize field names from backend (current_amount, days_30...) to display
        const normalized = items.map(r => ({
            customer_name: r.customer_name,
            current: r.current_amount ?? r.current ?? 0,
            days_1_30: r.days_30 ?? r['1_30'] ?? r.days_1_30 ?? 0,
            days_31_60: r.days_60 ?? r['31_60'] ?? r.days_31_60 ?? 0,
            days_61_90: r.days_90 ?? r['61_90'] ?? r.days_61_90 ?? 0,
            days_90_plus: r.days_120_plus ?? r['90_plus'] ?? r.days_90_plus ?? 0,
            total: r.total ?? 0
        }));

        // Compute summary from data
        const sumField = (field) => normalized.reduce((s, r) => s + (parseFloat(r[field]) || 0), 0);
        const fmt = AccountsCommon.formatCurrency;
        setText('agingCurrent', fmt(sumField('current')));
        setText('aging1to30', fmt(sumField('days_1_30')));
        setText('aging31to60', fmt(sumField('days_31_60')));
        setText('aging61to90', fmt(sumField('days_61_90')));
        setText('aging90plus', fmt(sumField('days_90_plus')));

        const tbody = document.getElementById('arAgingTable');
        if (!normalized.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No aging data available</p></div></td></tr>';
        } else {
            tbody.innerHTML = normalized.map(r => `<tr>
                <td>${AccountsCommon.escapeHtml(r.customer_name || '-')}</td>
                <td>${fmt(r.current)}</td>
                <td>${fmt(r.days_1_30)}</td>
                <td>${fmt(r.days_31_60)}</td>
                <td>${fmt(r.days_61_90)}</td>
                <td>${fmt(r.days_90_plus)}</td>
                <td><strong>${fmt(r.total)}</strong></td>
            </tr>`).join('');
        }
    } catch (err) {
        console.error('[AR] loadARAging error:', err);
        Toast.error('Failed to load aging data');
    }
}

// ============================================================================
// CUSTOMER STATEMENTS
// ============================================================================

async function loadCustomerStatement() {
    const custId = statementCustomerDD?.getValue?.();
    if (!custId) { Toast.error('Please select a customer'); return; }

    const dateFrom = document.getElementById('statementDateFrom')?.value;
    const dateTo = document.getElementById('statementDateTo')?.value;
    const params = {};
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;

    const container = document.getElementById('statementContent');
    try {
        const res = await api.request(AccountsCommon.buildUrl(`invoices/customers/${custId}/statement`, params));
        const fmt = AccountsCommon.formatCurrency, esc = AccountsCommon.escapeHtml, fmtD = AccountsCommon.formatDate;

        // Merge invoices, payments, and credit notes into transactions
        const invoices = (res?.invoices || []).map(i => ({
            date: i.invoice_date, type: 'Invoice', reference: i.invoice_number,
            debit: parseFloat(i.total_amount) || 0, credit: 0
        }));
        const payments = (res?.payments || []).map(p => ({
            date: p.payment_date, type: `Payment (${p.payment_method || 'bank'})`, reference: p.payment_number,
            debit: 0, credit: parseFloat(p.amount) || 0
        }));
        const credits = (res?.credit_notes || []).map(c => ({
            date: c.credit_date, type: 'Credit Note', reference: c.credit_note_number,
            debit: 0, credit: parseFloat(c.amount) || 0
        }));
        const txns = res?.transactions || [...invoices, ...payments, ...credits].sort((a, b) => new Date(a.date) - new Date(b.date));

        const custName = res?.customer_name || res?.customer?.name || 'Customer Statement';
        let html = `<div class="glass-card" style="margin-bottom: 1rem;"><div class="glass-card-body">
            <h4>${esc(custName)} — Statement</h4>
            <p style="color: var(--text-secondary); margin: 0;">Total Invoiced: ${fmt(res?.total_invoiced ?? 0)} | Total Received: ${fmt(res?.total_received ?? 0)} | Outstanding: <strong>${fmt(res?.total_outstanding ?? 0)}</strong></p>
        </div></div>`;

        if (!txns.length) {
            html += '<div class="empty-message" style="padding: 2rem; text-align: center;"><p>No transactions in selected period</p></div>';
        } else {
            html += `<div class="data-table-container"><table class="data-table"><thead><tr>
                <th>Date</th><th>Type</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th>
            </tr></thead><tbody>`;
            let bal = 0;
            txns.forEach(t => {
                const dr = parseFloat(t.debit) || 0;
                const cr = parseFloat(t.credit) || 0;
                bal += dr - cr;
                html += `<tr>
                    <td>${fmtD(t.date)}</td>
                    <td>${esc(t.type || '-')}</td>
                    <td>${esc(t.reference || '-')}</td>
                    <td class="text-right">${dr ? fmt(dr) : '-'}</td>
                    <td class="text-right">${cr ? fmt(cr) : '-'}</td>
                    <td class="text-right">${fmt(bal)}</td>
                </tr>`;
            });
            html += '</tbody></table></div>';
        }
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="empty-message" style="padding: 2rem; text-align: center;"><p>Failed to generate statement</p></div>';
        Toast.error('Failed to generate statement');
    }
}

// ============================================================================
// HELPERS
// ============================================================================

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}
