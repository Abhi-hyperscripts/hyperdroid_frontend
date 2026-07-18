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
let taxConfigs = [];
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
        const [custRes, acctRes, bankRes, taxRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa', { isActive: true }), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('tax/configurations'), { _skipSpinner: true }).catch(() => [])
        ]);
        customers = Array.isArray(custRes) ? custRes : (custRes?.data || custRes?.items || []);
        accounts = Array.isArray(acctRes) ? acctRes : (acctRes?.data || acctRes?.items || []);
        bankAccounts = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);
        // Tax configs drive Output GST per Customer Invoice line — what
        // the business owes the government.
        taxConfigs = Array.isArray(taxRes) ? taxRes : (taxRes?.data || []);
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
    const customerId = invoiceCustomerFilterDD?.getValue?.();
    const status = document.getElementById('invoiceStatusFilter')?.value;
    const dateFrom = document.getElementById('invoiceDateFrom')?.value;
    const dateTo = document.getElementById('invoiceDateTo')?.value;
    const search = document.getElementById('invoiceSearch')?.value?.trim();
    const searching = !!search;

    // The backend invoices list has no `search` param. When searching, fetch a broad page and
    // filter + paginate client-side so the search reaches ALL matching rows and the pager reflects
    // the filtered count (not the server total). Otherwise use normal server-side pagination.
    const params = searching
        ? { limit: 1000, offset: 0 }
        : { limit: PAGE_SIZE, offset: (invoicePage - 1) * PAGE_SIZE };
    if (customerId) params.customerId = customerId;
    if (status) params.status = status;
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;

    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices', params));
        let items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        customerInvoices = items;  // cache the full fetch for row action handlers

        let total, totalPages;
        if (searching) {
            const q = search.toLowerCase();
            const filtered = items.filter(inv => {
                const custName = inv.customer_name || customers.find(c => c.id === inv.customer_id)?.name || '';
                return `${inv.invoice_number || ''} ${custName}`.toLowerCase().includes(q);
            });
            total = filtered.length;
            totalPages = Math.ceil(total / PAGE_SIZE) || 1;
            if (invoicePage > totalPages) invoicePage = totalPages;
            items = filtered.slice((invoicePage - 1) * PAGE_SIZE, invoicePage * PAGE_SIZE);
        } else {
            // `total` feeds ONLY the pager below — the KPI tiles read res.stats. Backend returns the
            // FILTERED count; ?? (not ||) so a legitimate 0 doesn't fall through to items.length.
            total = res?.total ?? items.length;
            totalPages = Math.ceil(total / PAGE_SIZE) || 1;
            // Clamp if actioning the last row on a page left us past the end (else an empty "No … found").
            if (invoicePage > totalPages) { invoicePage = totalPages; return loadCustomerInvoices(); }
        }

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
                    <td class="text-right">${AccountsCommon.formatCurrency(inv.balance_due ?? inv.balance ?? 0)}</td>
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
    // View + PDF buttons always shown
    let html = `<button class="btn-icon" data-tooltip="View" onclick="viewInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
    html += ` <button class="btn-icon" data-tooltip="Download PDF" onclick="downloadInvoicePdf('${inv.id}', '${(inv.invoice_number||'').replace(/'/g,'')}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>`;
    // Mutating actions require admin
    if (!accountsRoles.isAdmin()) {
        return html;
    }
    if (inv.status === 'draft') {
        html += ` <button class="btn-icon" data-tooltip="Edit" onclick="editInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
        html += ` <button class="btn-icon" data-tooltip="Approve" onclick="approveInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Delete" onclick="deleteDraftInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    }
    if (inv.status === 'approved') {
        html += ` <button class="btn-icon" data-tooltip="Send" onclick="sendInvoice('${inv.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`;
    }
    if (inv.status === 'sent' || inv.status === 'approved' || inv.status === 'partially_paid' || inv.status === 'overdue') {
        html += ` <button class="btn-icon" data-tooltip="Send Reminder" onclick="sendInvoiceReminder('${inv.id}', '${(inv.invoice_number||'').replace(/'/g,'')}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>`;
        html += ` <button class="btn btn-outline" style="padding:0.2rem 0.6rem;font-size:0.75rem;" onclick="payInvoice('${inv.customer_id}')">Pay</button>`;
    }
    return html;
}

/**
 * Send a manual payment reminder email for an invoice and show the result.
 * The backend records the send attempt in the invoice_reminders table so the
 * history is visible in the reminder timeline (also accessible via
 * GET /invoices/{id}/reminders).
 */
async function sendInvoiceReminder(invoiceId, invoiceNumber) {
    const ok = await Confirm.show({
        title: 'Send Payment Reminder',
        message: `Send a payment reminder email for invoice ${invoiceNumber || invoiceId}? The customer will receive an email immediately and the send will be logged to the reminder history.`,
        confirmText: 'Send Reminder',
        type: 'info'
    });
    if (!ok) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl(`invoices/${invoiceId}/send-reminder`), { method: 'POST' });
        // The endpoint returns HTTP 200 with success:false when the email was recorded but delivery
        // failed (e.g. no customer email, notification service down) — don't report that as sent.
        if (res && res.success === false) {
            Toast.warning(res.message || 'Reminder was recorded but the email could not be delivered.');
        } else {
            const sentAt = res?.sent_at ? AccountsCommon.formatDate(res.sent_at, true) : 'now';
            Toast.success(`Reminder sent at ${sentAt}`);
        }
    } catch (err) {
        console.error('[Receivables] sendInvoiceReminder error:', err);
        Toast.error(err.message || 'Failed to send reminder');
    }
}

// ============================================================================
// BULK INVOICE IMPORT
// ============================================================================

// Quote-aware CSV → array of {header: value} objects. Local replica of the
// parser in setup.js (_parseCsv there is not exported, and setup.js is not
// loaded on this page). Handles quoted fields containing commas, escaped ""
// quotes, and CRLF line endings.
function _parseCsv(text) {
    const rows = [];
    let i = 0, field = '', row = [], inQuotes = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow   = () => { rows.push(row); row = []; };
    while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += ch; i++; continue;
        }
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === ',') { pushField(); i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch === '\n') { pushField(); pushRow(); i++; continue; }
        field += ch; i++;
    }
    if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
    if (rows.length === 0) return [];

    const headers = rows.shift().map(h => h.trim());
    return rows
        .filter(r => r.some(cell => (cell ?? '').trim() !== ''))
        .map(r => {
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
            return obj;
        });
}

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
                // Quote-aware parse — a naive split(',') shifted every column after
                // a quoted field containing a comma (e.g. "Acme, Inc.").
                const rows = _parseCsv(content);
                if (!rows.length) { Toast.error('CSV must have a header row and at least one data row'); return; }
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
    if (!AccountsCommon.beginSubmit('submitBulkInvoices')) return;
    try {
        const invoices = JSON.parse(text);
        if (!Array.isArray(invoices)) { Toast.error('Data must be a JSON array'); return; }
        if (!invoices.length) { Toast.error('Array is empty'); return; }
        // Backend BulkCreateInvoices binds a bare List<CreateCustomerInvoiceRequest> —
        // wrapping in { invoices } binds null and 400s. Send the array itself.
        const res = await api.request(AccountsCommon.buildUrl('invoices/bulk'), {
            method: 'POST',
            body: JSON.stringify(invoices),
            headers: { 'Content-Type': 'application/json' }
        });
        // Backend returns { total, created, results: [{ success, ... }] } — no failed/error_count.
        const created = res?.created ?? invoices.length;
        const failed = Array.isArray(res?.results) ? res.results.filter(r => !r.success).length : 0;
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
    } finally {
        AccountsCommon.endSubmit('submitBulkInvoices');
    }
}

// ============================================================================
// INVOICE MODAL & CRUD
// ============================================================================

function showCreateInvoiceModal() {
    document.getElementById('invoiceModalTitle').textContent = 'Create Invoice';
    // The modal is shared with the read-only "view issued invoice" path; clear that state first,
    // else after viewing an approved invoice the create form opens disabled with Save hidden.
    _setInvoiceModalReadOnly(false);
    document.getElementById('invoiceForm').reset();
    document.getElementById('invoiceId').value = '';
    document.getElementById('invoiceLines').innerHTML = '';
    addInvoiceLine();
    calculateInvoiceTotals();
    AccountsCommon.openModal('customerInvoiceModal');
}

// Alias: the row template binds the View action to viewInvoice(), but
// historically the page only had editInvoice. Without this alias the
// View button silently throws ReferenceError. Treat View as Edit for
// now — drafts open editable, approved invoices still open in this
// modal but the user can only re-approve or cancel out.
const viewInvoice = (id) => editInvoice(id);

async function editInvoice(id) {
    try {
        const inv = await api.request(AccountsCommon.buildUrl(`invoices/${id}`));
        const isDraft = (inv.status || 'draft') === 'draft';
        const titleEl = document.getElementById('invoiceModalTitle');
        titleEl.textContent = isDraft
            ? `Edit Invoice ${inv.invoice_number || ''}`
            : `View Invoice ${inv.invoice_number || ''}  (${(inv.status || '').toUpperCase()} — read-only)`;

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

        // GST law: an issued tax invoice (status != 'draft') CANNOT be
        // edited — would break GSTR-1 immutability and the customer's
        // already-filed GSTR-2A. Lock the form to read-only and hide
        // Save buttons. CAs needing changes must issue a Credit Note +
        // a fresh invoice.
        _setInvoiceModalReadOnly(!isDraft);

        AccountsCommon.openModal('customerInvoiceModal');
    } catch (err) {
        Toast.error('Failed to load invoice');
    }
}

function _setInvoiceModalReadOnly(readOnly) {
    const modal = document.getElementById('customerInvoiceModal');
    if (!modal) return;
    // Disable every editable control
    modal.querySelectorAll('input, textarea, select, button').forEach(el => {
        // Always keep Cancel and Close buttons usable
        if (el.matches('.close-btn') || /^Cancel$/i.test(el.innerText?.trim() || '')) return;
        if (readOnly) el.setAttribute('disabled', 'disabled');
        else el.removeAttribute('disabled');
    });
    // Also hide Save Draft + Save & Approve in read-only mode
    modal.querySelectorAll('.modal-footer button').forEach(b => {
        const t = b.innerText.trim();
        if (t === 'Save Draft' || t === 'Save & Approve') {
            b.style.display = readOnly ? 'none' : '';
        }
    });
    // Add a banner at top of body if missing
    let banner = modal.querySelector('.invoice-readonly-banner');
    if (readOnly && !banner) {
        banner = document.createElement('div');
        banner.className = 'invoice-readonly-banner';
        banner.style.cssText = 'background: color-mix(in srgb, var(--color-warning, #ed6c02) 14%, var(--bg-card-hover)); color: var(--text-primary); padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 0.85rem; border: 1px solid color-mix(in srgb, var(--color-warning, #ed6c02) 35%, transparent);';
        banner.innerHTML = `
            <strong>This invoice has been issued and cannot be edited.</strong><br>
            Once a tax invoice is approved, GST regulations require it to remain immutable for GSTR-1 filing.
            To make corrections, <em>cancel this invoice</em> or issue a <em>credit note</em>, then create a fresh invoice.
        `;
        const body = modal.querySelector('.modal-body');
        body.insertBefore(banner, body.firstChild);
    } else if (!readOnly && banner) {
        banner.remove();
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

    // Same column order as PO: Account first, then Description, HSN/SAC, Qty,
    // Unit Price, Tax, Amount. HSN/SAC is required on India tax invoices ≥₹50K
    // and is now persisted+returned by the backend (customer_invoice_lines.hsn_sac).
    row.innerHTML = `
        <td><select class="form-control line-account" data-no-sd="true"><option value="">Select...</option>${acctOptions}</select><div class="searchable-dropdown-container line-account-sd"></div></td>
        <td><input type="text" class="form-control line-desc" value="${AccountsCommon.escapeHtml(data.description || '')}" placeholder="Description"></td>
        <td><input type="text" class="form-control line-hsn" value="${AccountsCommon.escapeHtml(data.hsn_sac || '')}" placeholder="HSN/SAC"></td>
        <td><input type="number" class="form-control line-qty" value="${data.quantity ?? 1}" min="0" step="any" oninput="calculateInvoiceTotals()"></td>
        <td><input type="number" class="form-control line-rate" value="${data.rate || ''}" min="0" step="0.01" placeholder="0.00" oninput="calculateInvoiceTotals()"></td>
        <td><div class="searchable-dropdown-container line-tax-sd"></div></td>
        <td class="line-amount" style="text-align:right; padding-top:0.7rem;">0.00</td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="removeInvoiceLine(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);

    // Hide the native select + wire SearchableDropdown with quick-add
    const select = row.querySelector('.line-account');
    select.style.display = 'none';
    if (data.account_id) select.value = data.account_id;

    const buildAccountOptions = () => [
        { value: '', label: 'Select...' },
        ...accounts.map(a => {
            const code = a.account_code || a.code || '';
            const name = a.account_name || a.name || '';
            return { value: a.id, label: code && name ? `${code} — ${name}` : (name || code) };
        })
    ];
    const accDd = new SearchableDropdown(row.querySelector('.line-account-sd'), {
        id: `inv-line-account-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: buildAccountOptions(),
        value: data.account_id || '',
        placeholder: 'Select account...',
        searchPlaceholder: 'Search accounts…',
        compact: true,
        quickAdd: { title: 'Create new account', onClick: (instance) => openInvoiceQuickAddAccount(instance, buildAccountOptions) },
        onChange: (v) => { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    row._lineAccountDropdown = accDd;

    // Tax dropdown — Output GST per line, defaults to GST 18%
    const taxOptions = [
        { value: '', label: 'No tax (0%)' },
        ...taxConfigs.map(t => ({ value: t.id, label: `${t.name || t.tax_type || 'Tax'} (${_invoiceTaxRateFor(t.id)}%)` }))
    ];
    const initialTaxId = data.tax_config_id !== undefined ? (data.tax_config_id || '') : _invoiceDefaultTaxConfigId();
    const taxDd = new SearchableDropdown(row.querySelector('.line-tax-sd'), {
        id: `inv-line-tax-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: taxOptions,
        value: initialTaxId,
        placeholder: 'No tax',
        searchPlaceholder: 'Search tax…',
        compact: true,
        onChange: () => calculateInvoiceTotals()
    });
    row._lineTaxDropdown = taxDd;

    calculateInvoiceTotals();
}

function _invoiceTaxRateFor(configId) {
    const cfg = taxConfigs.find(t => t.id === configId);
    if (!cfg) return 0;
    // Rate is nested at configuration.total_rate on the list payload; flat keys are fallbacks.
    const r = Number(cfg.configuration?.total_rate ?? cfg.rate ?? cfg.tax_rate ?? cfg.percentage ?? 0);
    if (r) return r;
    if (Array.isArray(cfg.rates)) return cfg.rates.reduce((s, r) => s + Number(r.rate_percentage ?? r.percentage ?? 0), 0);
    const m = (cfg.name || '').match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
}
function _invoiceDefaultTaxConfigId() {
    if (!taxConfigs?.length) return '';
    const eighteen = taxConfigs.find(t => /18/.test(t.name || '') || _invoiceTaxRateFor(t.id) === 18);
    return eighteen ? eighteen.id : taxConfigs[0].id;
}

async function openInvoiceQuickAddAccount(dropdownInstance, rebuildOptions) {
    let m = document.getElementById('invQuickAddAccountModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'invQuickAddAccountModal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="max-width: 520px;">
                    <div class="modal-header">
                        <h5 class="modal-title">Quick Add Account</h5>
                        <button class="close-btn" onclick="AccountsCommon.closeModal('invQuickAddAccountModal')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                    <div class="modal-body">
                        <div class="form-row two-col">
                            <div class="form-group"><label for="invQaCode">Code *</label><input type="text" id="invQaCode" class="form-control" required></div>
                            <div class="form-group"><label for="invQaName">Name *</label><input type="text" id="invQaName" class="form-control" required></div>
                        </div>
                        <div class="form-row">
                            <div class="form-group"><label for="invQaType">Account Type *</label><div class="searchable-dropdown-container" id="invQaTypeContainer"></div></div>
                        </div>
                        <div id="invQaError" hidden style="margin-top:0.5rem; padding:0.5rem 0.75rem; border-radius:6px; background: color-mix(in srgb, var(--color-error, #c33) 12%, var(--bg-card-hover)); color: var(--color-error, #c33); font-size: 0.85rem;"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="AccountsCommon.closeModal('invQuickAddAccountModal')">Cancel</button>
                        <button class="btn btn-primary" id="invQaSaveBtn">Save</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);
    }
    document.getElementById('invQaCode').value = '';
    document.getElementById('invQaName').value = '';
    document.getElementById('invQaError').hidden = true;
    const typeContainer = document.getElementById('invQaTypeContainer');
    typeContainer.innerHTML = '';
    let types = [];
    try { const tr = await api.request(AccountsCommon.buildUrl('coa/types'), { _skipSpinner: true }); types = Array.isArray(tr) ? tr : (tr?.data || []); } catch {}
    const typeDd = new SearchableDropdown(typeContainer, {
        id: 'invQaType-sd',
        options: [{ value: '', label: '— select —' }, ...types.map(t => ({ value: t.id, label: t.name }))],
        value: '', placeholder: '— select —', compact: false
    });

    AccountsCommon.openModal('invQuickAddAccountModal');
    setTimeout(() => document.getElementById('invQaCode').focus(), 100);

    document.getElementById('invQaSaveBtn').onclick = async () => {
        const code = document.getElementById('invQaCode').value.trim();
        const name = document.getElementById('invQaName').value.trim();
        const typeId = typeDd.selectedValue;
        const errEl = document.getElementById('invQaError');
        errEl.hidden = true;
        if (!code || !name || !typeId) { errEl.textContent = 'Code, Name, and Account Type are required.'; errEl.hidden = false; return; }
        if (!AccountsCommon.beginSubmit('raQuickAddAccount')) return;
        try {
            const created = await api.request(AccountsCommon.buildUrl('coa'), { method: 'POST', body: JSON.stringify({ account_code: code, account_name: name, account_type_id: typeId }) });
            const fresh = await api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true });
            accounts = Array.isArray(fresh) ? fresh : (fresh?.data || fresh?.items || []);
            const newId = created?.id || accounts.find(a => a.account_code === code)?.id;
            dropdownInstance.refreshOptions(rebuildOptions(), newId);
            const tr = dropdownInstance.container.closest('tr');
            const sel = tr?.querySelector('.line-account');
            if (sel && newId) {
                const opt = document.createElement('option'); opt.value = newId; opt.textContent = `${code} — ${name}`; opt.selected = true;
                sel.appendChild(opt); sel.value = newId;
            }
            document.querySelectorAll('#invoiceLines tr').forEach(r => {
                const other = r._lineAccountDropdown;
                if (other && other !== dropdownInstance) other.refreshOptions(rebuildOptions(), other.selectedValue);
            });
            Toast.success(`Account ${code} created and selected.`);
            AccountsCommon.closeModal('invQuickAddAccountModal');
        } catch (err) { errEl.textContent = err?.message || 'Failed to create account.'; errEl.hidden = false; }
        finally { AccountsCommon.endSubmit('raQuickAddAccount'); }
    };
}

function removeInvoiceLine(btn) {
    btn.closest('tr').remove();
    calculateInvoiceTotals();
}

function calculateInvoiceTotals() {
    let subtotal = 0;
    let totalTax = 0;
    document.querySelectorAll('#invoiceLines tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const amt = qty * rate;
        subtotal += amt;

        const taxConfigId = row._lineTaxDropdown?.selectedValue || '';
        const taxPct = _invoiceTaxRateFor(taxConfigId);
        const lineTax = (amt * taxPct) / 100;
        totalTax += lineTax;

        const amtCell = row.querySelector('.line-amount');
        if (amtCell) {
            if (taxPct > 0) {
                amtCell.innerHTML = `
                    <div>${(amt + lineTax).toFixed(2)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">${amt.toFixed(2)} + ${lineTax.toFixed(2)} tax</div>`;
            } else {
                amtCell.textContent = amt.toFixed(2);
            }
        }
    });

    setText('invoiceSubtotal', subtotal.toFixed(2));
    setText('invoiceTax', totalTax.toFixed(2));
    setText('invoiceTotal', (subtotal + totalTax).toFixed(2));
}

async function saveInvoice(approve) {
    const form = document.getElementById('invoiceForm');
    if (!form.reportValidity()) return;

    const lines = [];
    let lineError = null;
    document.querySelectorAll('#invoiceLines tr').forEach((row, idx) => {
        const taxConfigId = row._lineTaxDropdown?.selectedValue || null;
        const taxRate = _invoiceTaxRateFor(taxConfigId);
        const description = row.querySelector('.line-desc')?.value.trim() || '';
        const accountId = row.querySelector('.line-account')?.value || '';
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        // Skip fully-blank rows (no description, no account, no amount)
        if (!description && !accountId && rate <= 0) return;
        // Backend CreateCustomerInvoiceLineRequest.account_id is a non-nullable
        // Guid — sending null 400s. Require an account on every row with data.
        if (!accountId) {
            if (!lineError) lineError = `Line ${idx + 1}: select an account for this line item`;
            return;
        }
        // Backend CreateCustomerInvoiceLineRequest accepts account_id, description,
        // quantity, unit_price, tax_config_id and hsn_sac (all persisted). tax_rate
        // is derived server-side from the tax config, so it is not sent.
        lines.push({
            description,
            account_id: accountId,
            hsn_sac: row.querySelector('.line-hsn')?.value || '',
            quantity: parseFloat(row.querySelector('.line-qty')?.value) || 0,
            unit_price: rate,
            tax_config_id: taxConfigId,
            tax_rate: taxRate || 0
        });
    });

    if (lineError) {
        Toast.error(lineError);
        return;
    }
    if (!lines.length) {
        Toast.error('At least one line item is required');
        return;
    }

    // The backend requires all-or-nothing tax tagging: every line the SAME config, or none (default).
    // Catch both "mixed slabs" and "some taxed + some exempt" here with a clear message instead of a 400.
    const taggedCount = lines.filter(l => l.tax_config_id).length;
    const distinctTaxConfigs = [...new Set(lines.map(l => l.tax_config_id).filter(Boolean))];
    if (distinctTaxConfigs.length > 1) {
        Toast.error('All line items must use the same tax rate. Set every line to the same GST/tax option before saving.');
        return;
    }
    if (taggedCount > 0 && taggedCount < lines.length) {
        Toast.error('Either apply the same tax option to every line, or set them all to "No tax". Mixing taxed and tax-exempt lines is not allowed.');
        return;
    }

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
    // Disable both save buttons while the request is in flight — a double-click
    // fired two POSTs and created duplicate invoices.
    const saveBtns = ['invoiceSaveDraftBtn', 'invoiceSaveApproveBtn']
        .map(bid => document.getElementById(bid)).filter(Boolean);
    saveBtns.forEach(b => b.disabled = true);
    try {
        let savedInvoice;
        try {
            if (id) {
                savedInvoice = await api.request(AccountsCommon.buildUrl(`invoices/${id}`), { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            } else {
                savedInvoice = await api.request(AccountsCommon.buildUrl('invoices'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            }
        } catch (err) {
            Toast.error(err.message || 'Failed to save invoice');
            return;
        }

        // The draft now exists. Approval is a separate step — if it fails, the draft must
        // still be surfaced (close modal + refresh) so the user doesn't re-submit and create a duplicate.
        if (approve && savedInvoice?.id) {
            try {
                await api.request(AccountsCommon.buildUrl(`invoices/${savedInvoice.id}/approve`), { method: 'POST' });
                Toast.success('Invoice created and approved');
            } catch (err) {
                Toast.error(`Saved as draft, but approval failed: ${err.message || 'unknown error'}`);
            }
        } else {
            Toast.success(id ? 'Invoice updated' : 'Invoice saved as draft');
        }
        AccountsCommon.closeModal('customerInvoiceModal');
        loadCustomerInvoices();
    } finally {
        saveBtns.forEach(b => b.disabled = false);
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
    } catch (err) { Toast.error(err.message || 'Failed to approve invoice'); }
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
    } catch (err) { Toast.error(err.message || 'Failed to send invoice'); }
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
    } catch (err) { Toast.error(err.message || 'Failed to delete invoice'); }
}

// ============================================================================
// CUSTOMER PAYMENTS
// ============================================================================

async function loadCustomerPayments() {
    const customerId = paymentCustomerFilterDD?.getValue?.();
    const dateFrom = document.getElementById('paymentDateFrom')?.value;
    const dateTo = document.getElementById('paymentDateTo')?.value;
    const search = (document.getElementById('paymentSearch')?.value || '').trim().toLowerCase();

    // Backend GET invoices/payments only supports customerId + limit/offset and
    // returns a bare array with no total. Fetch up to the server cap (200) and
    // do date/search filtering + pagination client-side.
    const params = { limit: 200 };
    if (customerId) params.customerId = customerId;

    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices/payments', params));
        const all = Array.isArray(res) ? res : (res?.data || res?.items || []);
        customerPayments = all;

        const items = all.filter(p => {
            const d = (p.payment_date || '').substring(0, 10);
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            if (search) {
                const custName = p.customer_name || customers.find(c => c.id === p.customer_id)?.name || '';
                const hay = `${p.payment_number || ''} ${custName} ${p.reference_number || ''} ${p.payment_method || ''}`.toLowerCase();
                if (!hay.includes(search)) return false;
            }
            return true;
        });

        const totalPages = Math.ceil(items.length / PAGE_SIZE) || 1;
        if (paymentPage > totalPages) paymentPage = totalPages;
        const pageItems = items.slice((paymentPage - 1) * PAGE_SIZE, paymentPage * PAGE_SIZE);

        const tbody = document.getElementById('customerPaymentsTable');
        if (!pageItems.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No payments recorded</p></div></td></tr>';
        } else {
            tbody.innerHTML = pageItems.map(p => {
                const custName = p.customer_name || customers.find(c => c.id === p.customer_id)?.name || '-';
                const bankName = p.bank_account_name || p.bank_name || window._bankAccountMap?.[p.bank_account_id] || bankAccounts.find(b => b.id === p.bank_account_id)?.account_name || (p.bank_account_id ? p.bank_account_id.substring(0, 8) + '...' : '-');
                // No row action: CustomerPayment has no invoice_id and there is no
                // payment-detail endpoint — the old "View" button 404'd via editInvoice(payment id).
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(p.payment_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}</td>
                    <td>${AccountsCommon.formatDate(p.payment_date)}</td>
                    <td>${AccountsCommon.formatCurrency(p.amount)}</td>
                    <td>${AccountsCommon.escapeHtml(bankName)}</td>
                    <td>${AccountsCommon.escapeHtml(p.reference_number || p.reference || '-')}</td>
                    <td><span class="text-secondary">-</span></td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('paymentsPagination', paymentPage, totalPages, p => { paymentPage = p; loadCustomerPayments(); });
    } catch (err) {
        console.error('[AR] loadCustomerPayments error:', err);
        Toast.error('Failed to load payments');
    }
}

// One idempotency key per modal-open: retries/double-clicks of the SAME payment
// reuse the key (backend dedupes on the Idempotency-Key header), while a newly
// opened modal gets a fresh key so a genuine second payment is not swallowed.
let _paymentIdemKey = null;

function showRecordPaymentModal() {
    _paymentIdemKey = crypto.randomUUID();
    document.getElementById('paymentModalTitle').textContent = 'Record Payment';
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentId').value = '';
    document.getElementById('paymentAllocations').innerHTML = '<tr class="empty-state"><td colspan="3"><div class="empty-message"><p>Select a customer to see outstanding invoices</p></div></td></tr>';
    AccountsCommon.openModal('customerPaymentModal');
}

// Open the Record Payment modal pre-filled with the invoice's customer.
// Dispatching 'change' fires the select's inline onchange
// (loadCustomerInvoicesForPayment — loads the allocation list, mirroring
// payables' loadVendorOpenBills) and re-syncs the SearchableDropdown wrapper.
function payInvoice(customerId) {
    showRecordPaymentModal();
    const sel = document.getElementById('paymentCustomerId');
    if (sel) {
        sel.value = customerId;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
            return bal > 0 && (st === 'approved' || st === 'sent' || st === 'partially_paid' || st === 'overdue');
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

    // min="0" on the input lets ₹0 through native validation — a zero payment
    // posts a meaningless GL entry. Require strictly positive.
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    if (isNaN(amount) || amount <= 0) {
        Toast.error('Payment amount must be greater than zero');
        return;
    }

    // Backend CustomerPaymentAllocationRequest expects { customer_invoice_id, allocated_amount }
    // — NOT { invoice_id, amount }. Sending the wrong shape silently dropped allocations
    // server-side and left invoice balance_due unchanged. Fixed in Phase 4 Tier 1.
    const allocations = [];
    document.querySelectorAll('#paymentAllocations tr:not(.empty-state)').forEach(row => {
        const invoiceId = row.querySelector('.alloc-invoice-id')?.value;
        const allocAmt = parseFloat(row.querySelector('.alloc-amount')?.value) || 0;
        if (invoiceId && allocAmt > 0) allocations.push({ customer_invoice_id: invoiceId, allocated_amount: allocAmt });
    });

    // Over-allocation guard: the sum of invoice allocations cannot exceed the
    // payment amount (small epsilon for float noise on 2-dp currency).
    const allocatedTotal = allocations.reduce((s, a) => s + a.allocated_amount, 0);
    if (allocatedTotal - amount > 0.005) {
        Toast.error(`Allocated total (${AccountsCommon.formatCurrency(allocatedTotal)}) exceeds the payment amount (${AccountsCommon.formatCurrency(amount)})`);
        return;
    }

    // Backend RecordCustomerPaymentRequest expects `reference_number`, not `reference`.
    // Fixed in Phase 4 Tier 1 — was being silently dropped before.
    const payload = {
        customer_id: document.getElementById('paymentCustomerId').value,
        payment_date: document.getElementById('paymentDate').value,
        amount,
        bank_account_id: document.getElementById('paymentBankAccountId').value,
        reference_number: document.getElementById('paymentReference').value,
        payment_method: document.getElementById('paymentMethod')?.value || 'bank_transfer',
        allocations
    };

    // Disable the submit button for the duration of the request (double-click =
    // duplicate POST) and send the per-modal-open Idempotency-Key so even a
    // network-level retry can't record the payment twice (backend dedupes on it).
    const saveBtn = document.getElementById('paymentSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('invoices/payments'), {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json', ...(_paymentIdemKey && { 'Idempotency-Key': _paymentIdemKey }) }
        });
        Toast.success('Payment recorded');
        AccountsCommon.closeModal('customerPaymentModal');
        loadCustomerPayments();
        loadCustomerInvoices();
    } catch (err) {
        Toast.error(err.message || 'Failed to save payment');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

// ============================================================================
// CREDIT NOTES
// ============================================================================

async function loadCreditNotes() {
    const customerId = cnCustomerFilterDD?.getValue?.();
    const dateFrom = document.getElementById('cnDateFrom')?.value;
    const dateTo = document.getElementById('cnDateTo')?.value;
    const search = (document.getElementById('cnSearch')?.value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('creditNoteStatusFilter')?.value;

    // Backend GET invoices/credit-notes supports customerId + limit/offset and
    // returns {data,total}. Fetch up to the server cap and do status/date/search
    // filtering + pagination client-side.
    const params = { limit: 200 };
    if (customerId) params.customerId = customerId;

    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices/credit-notes', params));
        const all = Array.isArray(res) ? res : (res?.data || res?.items || []);
        creditNotes = all;

        const items = all.filter(cn => {
            if (statusFilter && (cn.status || '') !== statusFilter) return false;
            const d = (cn.credit_date || '').substring(0, 10);
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            if (search) {
                const custName = cn.customer_name || customers.find(c => c.id === cn.customer_id)?.name || '';
                const hay = `${cn.credit_note_number || ''} ${custName} ${cn.invoice_number || ''} ${cn.reason || ''}`.toLowerCase();
                if (!hay.includes(search)) return false;
            }
            return true;
        });

        const totalPages = Math.ceil(items.length / PAGE_SIZE) || 1;
        if (cnPage > totalPages) cnPage = totalPages;
        const pageItems = items.slice((cnPage - 1) * PAGE_SIZE, cnPage * PAGE_SIZE);

        const tbody = document.getElementById('creditNotesTable');
        if (!pageItems.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No credit notes found</p></div></td></tr>';
        } else {
            tbody.innerHTML = pageItems.map(cn => {
                const custName = cn.customer_name || customers.find(c => c.id === cn.customer_id)?.name || '-';
                // No row action: the old "View" button had no click handler and
                // there is no credit-note detail endpoint to wire it to.
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(cn.credit_note_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}</td>
                    <td>${AccountsCommon.escapeHtml(cn.invoice_number || '-')}</td>
                    <td>${AccountsCommon.formatDate(cn.credit_date)}</td>
                    <td>${AccountsCommon.formatCurrency(cn.amount)}</td>
                    <td>${AccountsCommon.escapeHtml(cn.reason || '-')}</td>
                    <td><span class="text-secondary">-</span></td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('creditNotesPagination', cnPage, totalPages, p => { cnPage = p; loadCreditNotes(); });
    } catch (err) {
        console.error('[AR] loadCreditNotes error:', err);
        Toast.error('Failed to load credit notes');
    }
}

// One idempotency key per modal-open: retries/double-clicks of the SAME credit note
// reuse the key (backend dedupes on the Idempotency-Key header), while a newly opened
// modal gets a fresh key so a genuine second credit note is not swallowed.
let _creditNoteIdemKey = null;

function showCreateCreditNoteModal() {
    _creditNoteIdemKey = crypto.randomUUID();
    document.getElementById('creditNoteModalTitle').textContent = 'Create Credit Note';
    document.getElementById('creditNoteForm').reset();
    document.getElementById('creditNoteId').value = '';
    document.getElementById('cnInvoiceId').innerHTML = '<option value="">Select invoice...</option>';
    syncCnAmountMax(); // clear any max left over from a previous open
    AccountsCommon.openModal('creditNoteModal');
}

async function loadCustomerInvoicesForCN() {
    const custId = document.getElementById('cnCustomerId').value;
    const sel = document.getElementById('cnInvoiceId');
    sel.innerHTML = '<option value="">Select invoice...</option>';
    syncCnAmountMax();
    if (!custId) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices', { customerId: custId, limit: 200 }));
        const items = (Array.isArray(res) ? res : (res?.data || res?.items || []))
            // Mirror the payables debit-note rule: a credit note can only be raised
            // against an ISSUED invoice with money still open — not a draft (never
            // issued, just edit/delete it), a cancelled one, or a fully-paid one.
            .filter(inv => {
                const bal = parseFloat(inv.balance_due) || 0;
                const st = (inv.status || '').toLowerCase();
                return bal > 0 && (st === 'approved' || st === 'sent' || st === 'partially_paid' || st === 'overdue');
            });
        items.forEach(inv => {
            const bal = parseFloat(inv.balance_due) || 0;
            const opt = document.createElement('option');
            opt.value = inv.id;
            opt.dataset.balance = bal;
            opt.textContent = `${inv.invoice_number || inv.id} - ${AccountsCommon.formatCurrency(inv.total_amount)} (${AccountsCommon.formatCurrency(bal)} due)`;
            sel.appendChild(opt);
        });
    } catch (err) { console.error('[AR] loadCustomerInvoicesForCN error:', err); }
}

// Cap the credit-note amount at the selected invoice's outstanding balance.
// reportValidity() in saveCreditNote() then enforces the max natively.
// Wired to cnInvoiceId's onchange in receivables.html.
function syncCnAmountMax() {
    const sel = document.getElementById('cnInvoiceId');
    const amt = document.getElementById('cnAmount');
    if (!amt) return;
    const bal = parseFloat(sel?.selectedOptions?.[0]?.dataset?.balance);
    if (!isNaN(bal) && bal > 0) amt.max = bal;
    else amt.removeAttribute('max');
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

    // Disable the submit button during the request — double-click = duplicate credit note.
    const saveBtn = document.getElementById('creditNoteSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('invoices/credit-notes'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json', ...(_creditNoteIdemKey && { 'Idempotency-Key': _creditNoteIdemKey }) } });
        Toast.success('Credit note created');
        AccountsCommon.closeModal('creditNoteModal');
        loadCreditNotes();
        loadCustomerInvoices();
    } catch (err) {
        Toast.error(err.message || 'Failed to create credit note');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
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
            // Seed the running balance from the backend's opening balance (net activity
            // strictly before fromDate), mirroring the AP vendor statement. 0 when no From-date.
            let bal = parseFloat(res?.opening_balance) || 0;
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

async function downloadInvoicePdf(id, invoiceNumber) {
    try {
        const baseUrl = api._getBaseUrl('/accounts/');
        const url = `${baseUrl}/accounts/invoices/${id}/pdf?tenantId=${AccountsCommon.getTenantId()}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${api.token}` } });
        if (!response.ok) throw new Error('Failed to download PDF');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `Invoice-${invoiceNumber || id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        Toast.success('Invoice PDF downloaded');
    } catch (err) {
        console.error('[Receivables] PDF download error:', err);
        Toast.error('Failed to download PDF');
    }
}
