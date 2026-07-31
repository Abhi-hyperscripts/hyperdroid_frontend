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
let projects = [];

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
let invoiceProjectFilterDD = null;
let invoiceCfController = null;   // custom-fields section controller for the open invoice form

// Render the invoice's Custom Fields section (create → empty; edit → prefilled from stored values).
async function renderInvoiceCustomFields(invoiceId) {
    const host = document.getElementById('invoiceCustomFields');
    if (!host) return;
    const defs = await AccountsCommon.getCustomFieldDefs('customer_invoice');
    const values = invoiceId ? await AccountsCommon.loadCustomFieldValues('customer_invoice', invoiceId) : {};
    invoiceCfController = AccountsCommon.renderCustomFieldsSection(host, defs, values);
}
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
        'delivery-challans': 'Delivery Challans',
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
    _acActiveRender = null;  // each tab's loader re-arms this for theme-toggle redraws
    switch (tabId) {
        case 'customer-invoices':   loadCustomerInvoices(); break;
        case 'customer-payments':   loadCustomerPayments(); break;
        case 'credit-notes':        loadCreditNotes(); break;
        case 'delivery-challans':   loadChallans(); break;
        case 'ar-aging':            loadARAging(); break;
        case 'customer-statements': break; // user-triggered
        case 'tds-receivable':      initTdsReceivable(); break;
    }
}

// Shared chart helpers (_acTheme/_acMount/acDonut/acBarH/acBarV/acArea/_acMonthly/_acRank/_acActiveRender)
// live in js/accounts/accounts-charts.js, loaded before this script on every accounts page.

// Per-subsection chart renderers (each pulls the full matching set so charts aren't limited to one page).
const _STATUS_COLOR = { approved: '#3b82f6', sent: '#06b6d4', partially_paid: '#f59e0b', overdue: '#ef4444', draft: '#64748b', paid: '#10b981' };
const _AR_OUTSTANDING = new Set(['approved', 'sent', 'partially_paid', 'overdue']);
async function renderInvoiceCharts(baseParams) {
    try {
        const res = await api.request(AccountsCommon.buildUrl('invoices', { ...baseParams, limit: 1000, offset: 0 }), { _skipSpinner: true });
        const all = Array.isArray(res) ? res : (res?.data || res?.items || []);
        // Receivable (outstanding) by status — only truly-outstanding invoices (exclude draft/cancelled/
        // paid/credited/written_off) so the donut total matches the Total Receivable KPI.
        const outstanding = all.filter(i => _AR_OUTSTANDING.has(i.status || 'approved') && parseFloat(i.balance_due ?? i.balance ?? 0) > 0);
        const byStatus = {};
        outstanding.forEach(i => { const s = i.status || 'approved'; byStatus[s] = (byStatus[s] || 0) + parseFloat(i.balance_due ?? i.balance ?? 0); });
        const statuses = Object.keys(byStatus);
        acDonut('invStatusChart', statuses.map(s => s.replace(/_/g, ' ')), statuses.map(s => Math.round(byStatus[s] * 100) / 100), statuses.map(s => _STATUS_COLOR[s] || '#64748b'));
        // Top customers by outstanding balance.
        const rank = _acRank(outstanding.map(i => ({ name: i.customer_name || '—', bal: parseFloat(i.balance_due ?? i.balance ?? 0) })), 'name', 'bal', 6);
        acBarH('invCustomerChart', rank.labels, rank.data);
    } catch (e) { _acEmpty('invStatusChart'); _acEmpty('invCustomerChart'); }
}
function renderPaymentCharts(list) {
    const rows = (list || []).map(p => ({ ...p, _cash: parseFloat(p.amount || 0) }));
    const m = _acMonthly(rows, 'payment_date', '_cash', 6);
    acArea('payTrendChart', m.categories, m.data);
    const methods = {};
    rows.forEach(p => { const k = (p.payment_method || 'other').replace(/_/g, ' '); methods[k] = (methods[k] || 0) + p._cash; });
    const mk = Object.keys(methods).filter(k => methods[k] > 0);
    acDonut('payMethodChart', mk.map(k => k.replace(/\b\w/g, c => c.toUpperCase())), mk.map(k => Math.round(methods[k] * 100) / 100));
}
function renderCreditNoteCharts(list) {
    const m = _acMonthly(list || [], 'credit_date', 'amount', 6);
    acBarV('cnTrendChart', m.categories, m.data);
    const rank = _acRank((list || []).map(cn => ({ name: cn.customer_name || '—', amt: parseFloat(cn.amount || 0) })), 'name', 'amt', 6);
    acBarH('cnCustomerChart', rank.labels, rank.data);
}
function renderAgingChart(normalized) {
    const sum = (f) => (normalized || []).reduce((s, r) => s + (parseFloat(r[f]) || 0), 0);
    const cats = ['Current', '1-30', '31-60', '61-90', '90+'];
    const data = [sum('current'), sum('days_1_30'), sum('days_31_60'), sum('days_61_90'), sum('days_90_plus')];
    // Green (current) → red (90+): the visual reads as rising collection risk left-to-right.
    acBarV('agingBucketChart', cats, data.map(v => Math.round(v * 100) / 100), ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444']);
}

// ============================================================================
// INITIAL DATA
// ============================================================================

async function loadInitialData() {
    try {
        const [custRes, acctRes, bankRes, taxRes, projRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa', { isActive: true }), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('tax/configurations'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('projects'), { _skipSpinner: true }).catch(() => [])
        ]);
        customers = Array.isArray(custRes) ? custRes : (custRes?.data || custRes?.items || []);
        accounts = Array.isArray(acctRes) ? acctRes : (acctRes?.data || acctRes?.items || []);
        // Projects: optional per-line tag, scoped to the invoice's customer (backend enforces the match).
        projects = (Array.isArray(projRes) ? projRes : (projRes?.data || projRes?.items || []))
            .filter(p => p.status !== 'cancelled' && p.status !== 'completed');
        bankAccounts = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);
        // Tax configs drive Output GST per Customer Invoice line — what
        // the business owes the government.
        taxConfigs = Array.isArray(taxRes) ? taxRes : (taxRes?.data || []);
        // Build bank account name map
        window._bankAccountMap = {};
        bankAccounts.forEach(b => { window._bankAccountMap[b.id] = b.account_name || b.bank_name || b.name; });

        populateSelect('invoiceCustomerId', customers, 'id', 'name', 'Select customer...');
        // When the invoice's customer changes, re-scope each line's Project dropdown to that customer
        // (the backend rejects a project that belongs to a different customer).
        const invCustSel = document.getElementById('invoiceCustomerId');
        if (invCustSel && !invCustSel._projectHooked) {
            invCustSel._projectHooked = true;
            invCustSel.addEventListener('change', onInvoiceCustomerChange);
        }
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
    flatpickr('#refundAdvDate', opts);
    flatpickr('#statementDateFrom', opts);
    flatpickr('#statementDateTo', opts);
    flatpickr('#tdsFromDate', opts);
    flatpickr('#tdsToDate', opts);
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
    // Project filter: narrows the list to invoices that touch the chosen project (label carries the
    // owning customer so identically-named projects are distinguishable).
    const projFilterOpts = (projects || []).map(p => ({
        value: p.id,
        label: (p.code ? p.code + ' — ' : '') + (p.name || 'Untitled')
            + (p.customer_name ? '  ·  ' + p.customer_name : '')
    }));
    invoiceProjectFilterDD = new SearchableDropdown(document.getElementById('invoiceProjectFilterContainer'), {
        id: 'invoiceProjectFilter', options: projFilterOpts, placeholder: 'All Projects',
        searchPlaceholder: 'Search projects...', compact: true,
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
    let customerId = invoiceCustomerFilterDD?.getValue?.();
    const status = document.getElementById('invoiceStatusFilter')?.value;
    const dateFrom = document.getElementById('invoiceDateFrom')?.value;
    const dateTo = document.getElementById('invoiceDateTo')?.value;
    const search = document.getElementById('invoiceSearch')?.value?.trim();
    const searching = !!search;
    const projectId = invoiceProjectFilterDD?.getValue?.();

    // A project filter forces the fetch to that project's owning customer, then keeps only invoices that
    // carry a line tagged to the project (invoice_id set comes from the shared line-level breakdown).
    let projInvoiceIds = null;
    if (projectId) {
        const proj = (projects || []).find(p => p.id === projectId);
        if (proj?.customer_id) customerId = proj.customer_id;  // scope to the project's customer
        try {
            const bd = await AccountsCommon.getProjectInvoiceBreakdown(customerId);
            projInvoiceIds = bd.invoiceIdsByProject[projectId] || new Set();
        } catch (e) { projInvoiceIds = new Set(); }
    }

    // The backend invoices list has no `search`/`project` param. When either client-only filter is active,
    // fetch a broad page and filter + paginate client-side so the filter reaches ALL matching rows and the
    // pager/tiles reflect the filtered count (not the server total). Otherwise use server-side pagination.
    const clientFilter = searching || !!projectId;
    const params = clientFilter
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
        let statsSource = null;  // when set, KPI tiles are computed from this filtered set, not res.stats
        if (clientFilter) {
            let filtered = items;
            if (projInvoiceIds) filtered = filtered.filter(inv => projInvoiceIds.has(inv.id));
            if (searching) {
                const q = search.toLowerCase();
                filtered = filtered.filter(inv => {
                    const custName = inv.customer_name || customers.find(c => c.id === inv.customer_id)?.name || '';
                    return `${inv.invoice_number || ''} ${custName}`.toLowerCase().includes(q);
                });
            }
            statsSource = filtered;  // tiles must reflect only the filtered rows, across all pages
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

        // Stats — when a client-side filter is active, compute from the FULL filtered set so the tiles
        // match the list; otherwise prefer backend stats with a client-side fallback.
        const stats = res?.stats || {};
        if (statsSource) {
            setText('totalInvoices', statsSource.length);
            setText('draftInvoices', statsSource.filter(i => i.status === 'draft').length);
            setText('approvedInvoices', statsSource.filter(i => i.status === 'approved').length);
            setText('totalReceivable', AccountsCommon.formatCurrency(statsSource.reduce((s, i) => s + parseFloat(i.balance_due || i.balance || 0), 0)));
        } else {
            setText('totalInvoices', stats.total_count ?? total);
            setText('draftInvoices', stats.draft_count ?? items.filter(i => i.status === 'draft').length);
            setText('approvedInvoices', stats.approved_count ?? items.filter(i => i.status === 'approved').length);
            setText('totalReceivable', stats.total_receivable != null ? AccountsCommon.formatCurrency(stats.total_receivable) : AccountsCommon.formatCurrency(items.reduce((s, i) => s + parseFloat(i.balance_due || i.balance || 0), 0)));
        }

        // Charts read the full matching set (respecting customer + date, ignoring the status filter so the
        // status composition stays meaningful) — independent of the list's pagination.
        const _invChartParams = { ...(customerId ? { customerId } : {}), ...(dateFrom ? { fromDate: dateFrom } : {}), ...(dateTo ? { toDate: dateTo } : {}) };
        renderInvoiceCharts(_invChartParams);
        _acActiveRender = () => renderInvoiceCharts(_invChartParams);

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
    // Open invoices: settle from the customer's advance pool (booking deposits).
    if (['approved', 'sent', 'partially_paid', 'overdue'].includes(inv.status)) {
        const bal = parseFloat(inv.balance_due) || 0;
        const num = (inv.invoice_number || '').replace(/'/g, '');
        html += ` <button class="btn-icon" data-tooltip="Apply advance" onclick="openApplyAdvance('${inv.id}', '${inv.customer_id}', ${bal}, '${num}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>`;
        // Write off the balance as bad debt (Dr Bad Debt / Cr AR).
        html += ` <button class="btn-icon" data-tooltip="Write off" onclick="writeOffInvoice('${inv.id}','${num}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 8l-6 6-3-3-4 4"/></svg></button>`;
        // Cancel (reverse) an approved invoice that hasn't been paid against.
        if ((parseFloat(inv.paid_amount) || 0) === 0)
            html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Cancel invoice" onclick="cancelInvoiceDoc('${inv.id}','${num}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>`;
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

// Write off an invoice's outstanding balance as bad debt (Dr Bad Debt / Cr AR). Reason is audit-recorded.
async function writeOffInvoice(id, number) {
    const reason = await AccountsCommon.reasonPrompt({
        title: `Write off ${number}?`,
        message: 'Posts the outstanding balance to Bad Debt. Use this only when the amount is genuinely uncollectible.',
        confirmText: 'Write off'
    });
    if (reason == null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`invoices/${id}/write-off`), { method: 'POST', body: JSON.stringify({ reason }) });
        Toast.success('Invoice written off');
        await loadCustomerInvoices();
    } catch (e) { Toast.error(e.message || 'Write-off failed'); }
}

// Cancel (reverse) an approved invoice that has no payments against it.
async function cancelInvoiceDoc(id, number) {
    const reason = await AccountsCommon.reasonPrompt({
        title: `Cancel invoice ${number}?`,
        message: 'Reverses the GL entry and any stock issued. Only possible while no payment has been recorded.',
        confirmText: 'Cancel invoice'
    });
    if (reason == null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`invoices/${id}/cancel`), { method: 'POST', body: JSON.stringify({ reason }) });
        Toast.success('Invoice cancelled');
        await loadCustomerInvoices();
    } catch (e) { Toast.error(e.message || 'Cancel failed'); }
}

// ── GST E-Invoicing (IRP / IRN) ─────────────────────────────────────────────
// Injects an "E-Invoice" panel into the read-only invoice view. The Generate action
// is gated behind CONFIG.eInvoiceEnabled — a GST Suvidha Provider must be configured
// + validated server-side before it will complete, so we hide it until then rather
// than ship a button that errors. Preview builds the INV-01 payload locally (no GSP call).
async function renderEInvoicePanel(inv) {
    const modal = document.getElementById('customerInvoiceModal');
    if (!modal) return;
    const body = modal.querySelector('.acc-form') || modal.querySelector('.acc-form-page__inner') || modal.querySelector('.modal-body');
    if (!body) return;
    modal.querySelector('.einvoice-panel')?.remove();

    const st = (inv.status || '').toLowerCase();
    if (st === 'draft' || st === 'cancelled') return; // only issued, live invoices

    const panel = document.createElement('div');
    panel.className = 'einvoice-panel';
    panel.style.cssText = 'background:var(--bg-card-hover);border:1px solid var(--border-color);border-radius:8px;padding:14px 16px;margin-bottom:14px;';
    panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <strong style="font-size:0.9rem;color:var(--text-primary);">GST E-Invoice (IRP)</strong>
        <span class="einvoice-status" style="font-size:0.75rem;color:var(--text-secondary);">Checking…</span>
      </div>
      <div class="einvoice-detail" style="margin-top:10px;font-size:0.82rem;color:var(--text-secondary);"></div>`;
    const banner = modal.querySelector('.invoice-readonly-banner');
    if (banner && banner.parentElement === body) banner.insertAdjacentElement('afterend', panel);
    else body.insertBefore(panel, body.firstChild);

    const statusEl = panel.querySelector('.einvoice-status');
    const detailEl = panel.querySelector('.einvoice-detail');
    const isAdmin = accountsRoles.isAdmin();
    const isManager = accountsRoles.isManager();

    let rec = null;
    try { rec = await api.request(AccountsCommon.buildUrl(`einvoice/${inv.id}`), { _skipSpinner: true }); }
    catch (e) { rec = null; } // 404 = not registered yet

    if (rec && rec.irn) {
        const cancelled = (rec.status || '').toLowerCase() === 'cancelled';
        statusEl.innerHTML = cancelled
            ? `<span style="color:var(--color-error);">● Cancelled</span>`
            : `<span style="color:var(--color-success);">● Registered</span>`;
        detailEl.innerHTML = `
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:start;">
              <span>IRN</span><code style="word-break:break-all;color:var(--text-primary);">${AccountsCommon.escapeHtml(rec.irn)}</code>
              ${rec.ack_no ? `<span>Ack No</span><span style="color:var(--text-primary);">${AccountsCommon.escapeHtml(String(rec.ack_no))}</span>` : ''}
              ${rec.ack_date ? `<span>Ack Date</span><span style="color:var(--text-primary);">${AccountsCommon.formatDate(rec.ack_date)}</span>` : ''}
            </div>
            ${rec.signed_qr_code ? `<details style="margin-top:8px;"><summary style="cursor:pointer;">Signed QR (print on the invoice)</summary><textarea readonly style="width:100%;height:80px;margin-top:6px;font-family:monospace;font-size:0.7rem;">${AccountsCommon.escapeHtml(rec.signed_qr_code)}</textarea></details>` : ''}
            ${cancelled && rec.cancel_reason ? `<div style="margin-top:8px;color:var(--color-error);">Cancelled: ${AccountsCommon.escapeHtml(rec.cancel_reason)}</div>` : ''}`;
        if (!cancelled && isAdmin) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline';
            btn.style.cssText = 'margin-top:10px;padding:0.3rem 0.8rem;font-size:0.78rem;';
            btn.textContent = 'Cancel IRN';
            btn.onclick = () => cancelEInvoice(inv.id, inv.invoice_number || '');
            detailEl.appendChild(btn);
        }
    } else {
        statusEl.innerHTML = `<span>● Not registered</span>`;
        detailEl.innerHTML = `Register this B2B invoice on the government IRP to obtain an IRN + signed QR. The customer must have a GSTIN.`;
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center;';
        if (isManager) {
            const prev = document.createElement('button');
            prev.className = 'btn btn-outline';
            prev.style.cssText = 'padding:0.3rem 0.8rem;font-size:0.78rem;';
            prev.textContent = 'Preview payload';
            prev.onclick = () => previewEInvoice(inv.id);
            actions.appendChild(prev);
        }
        if (CONFIG.eInvoiceEnabled && isAdmin) {
            const gen = document.createElement('button');
            gen.className = 'btn btn-primary';
            gen.style.cssText = 'padding:0.3rem 0.8rem;font-size:0.78rem;';
            gen.textContent = 'Generate IRN';
            gen.onclick = () => generateEInvoice(inv.id, inv.invoice_number || '');
            actions.appendChild(gen);
        } else if (isAdmin) {
            const note = document.createElement('span');
            note.style.cssText = 'font-size:0.75rem;color:var(--text-secondary);';
            note.textContent = 'E-invoicing not enabled yet (GSP setup pending).';
            actions.appendChild(note);
        }
        detailEl.appendChild(actions);
    }
}

// Dry-run: fetch and display the INV-01 payload that WOULD be registered. No GSP call.
async function previewEInvoice(id) {
    try {
        const payload = await api.request(AccountsCommon.buildUrl(`einvoice/${id}/preview`), { _skipSpinner: true });
        let modal = document.getElementById('einvoicePreviewModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'einvoicePreviewModal';
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content" style="max-width:720px;">
                <div class="modal-header"><h3>E-Invoice payload (INV-01)</h3>
                  <button class="close-btn" onclick="AccountsCommon.closeModal('einvoicePreviewModal')">&times;</button></div>
                <div class="modal-body">
                  <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:8px;">Exactly what would be registered on the government IRP. Nothing has been submitted.</p>
                  <pre class="einvoice-preview-json" style="max-height:60vh;overflow:auto;background:var(--bg-body);padding:12px;border-radius:6px;font-size:0.72rem;white-space:pre;"></pre>
                </div>
                <div class="modal-footer"><button class="btn btn-outline" onclick="AccountsCommon.closeModal('einvoicePreviewModal')">Close</button></div>
              </div>`;
            document.body.appendChild(modal);
        }
        modal.querySelector('.einvoice-preview-json').textContent = JSON.stringify(payload, null, 2);
        AccountsCommon.openModal('einvoicePreviewModal');
    } catch (e) {
        Toast.error(e.message || 'Could not build the e-invoice payload');
    }
}

// Register the invoice on the IRP (admin only; gated by CONFIG.eInvoiceEnabled in the UI).
async function generateEInvoice(id, number) {
    const ok = await Confirm.show({
        title: `Generate IRN for ${number}?`,
        message: 'Registers this invoice on the government IRP and returns an IRN + signed QR. This is a live, irreversible action (cancellation is allowed within 24h).',
        confirmText: 'Generate IRN',
        type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`einvoice/${id}/generate`), { method: 'POST' });
        Toast.success('IRN generated');
        await editInvoice(id); // reopen refreshes the panel with the new IRN/QR
    } catch (e) { Toast.error(e.message || 'IRN generation failed'); }
}

// Cancel a registered IRN (admin only; reason required by the IRP within 24h).
async function cancelEInvoice(id, number) {
    const reason = await AccountsCommon.reasonPrompt({
        title: `Cancel IRN for ${number}?`,
        message: 'Cancels the registered IRN on the IRP (allowed within 24h of generation). A reason is required and recorded.',
        confirmText: 'Cancel IRN'
    });
    if (reason == null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`einvoice/${id}/cancel`), { method: 'POST', body: JSON.stringify({ reason }) });
        Toast.success('IRN cancelled');
        await editInvoice(id);
    } catch (e) { Toast.error(e.message || 'IRN cancel failed'); }
}

// Void (reverse) a recorded customer receipt: reverses its GL + allocations and restores the bank balance.
async function voidCustomerPayment(id, number) {
    const reason = await AccountsCommon.reasonPrompt({
        title: `Void receipt ${number}?`,
        message: 'Reverses the receipt, un-allocates it from any invoices, and restores the bank balance.',
        confirmText: 'Void receipt'
    });
    if (reason == null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`invoices/payments/${id}/void`), { method: 'POST', body: JSON.stringify({ reason }) });
        Toast.success('Receipt voided');
        await loadCustomerPayments();
    } catch (e) { Toast.error(e.message || 'Void failed'); }
}

// Refund an unapplied customer advance (booking deposit) back to a bank account.
function openRefundAdvance(paymentId, number, maxAmount, bankId) {
    document.getElementById('refundAdvId').value = paymentId;
    document.getElementById('refundAdvMax').textContent = AccountsCommon.formatCurrency(maxAmount);
    document.getElementById('refundAdvAmount').value = maxAmount.toFixed(2);
    document.getElementById('refundAdvAmount').max = maxAmount;
    AccountsCommon.setDateField('refundAdvDate', AccountsCommon.todayLocal());
    const opts = bankAccounts.map(b => ({ value: b.id, label: b.account_name || b.name }));
    document.getElementById('refundAdvBank').innerHTML = '';
    window._refundAdvBankDD = new SearchableDropdown(document.getElementById('refundAdvBank'), { id: 'refundAdvBankDD', options: opts, value: bankId || (opts[0]?.value || ''), placeholder: 'Bank account…', compact: true });
    document.getElementById('refundAdvTitle').textContent = `Refund advance · ${number}`;
    AccountsCommon.openModal('refundAdvanceModal');
}
async function saveRefundAdvance() {
    const id = document.getElementById('refundAdvId').value;
    const amount = parseFloat(document.getElementById('refundAdvAmount').value);
    const bank_account_id = window._refundAdvBankDD?.getValue?.();
    if (!amount || amount <= 0) { Toast.error('Enter a refund amount'); return; }
    if (!bank_account_id) { Toast.error('Pick a bank account'); return; }
    try {
        await api.request(AccountsCommon.buildUrl(`invoices/payments/${id}/refund-advance`), { method: 'POST', body: JSON.stringify({ amount, bank_account_id, refund_date: document.getElementById('refundAdvDate').value }) });
        Toast.success('Advance refunded');
        AccountsCommon.closeModal('refundAdvanceModal');
        await loadCustomerPayments();
    } catch (e) { Toast.error(e.message || 'Refund failed'); }
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
            const sentAt = res?.sent_at ? AccountsCommon.formatDateTime(res.sent_at) : 'now';
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

// ── Inventory item picker: adds a pre-filled line from the catalog ──────────
let inventoryItems = [];
let invoiceItemPickerDD = null;

async function initInvoiceItemPicker() {
    const container = document.getElementById('invoiceItemPicker');
    if (!container || typeof SearchableDropdown !== 'function') return;
    if (!inventoryItems.length) {
        try { inventoryItems = await api.request(AccountsCommon.buildUrl('inventory/items'), { _skipSpinner: true }); } catch { inventoryItems = []; }
    }
    const opts = [{ value: '', label: '+ Add from item catalog…' },
        ...inventoryItems.filter(i => i.is_active).map(i => ({ value: i.id, label: `${i.sku} — ${i.name} (${AccountsCommon.formatCurrency(i.sale_price)})` }))];
    container.innerHTML = '';
    invoiceItemPickerDD = new SearchableDropdown(container, {
        id: 'invoiceItemPickerDD', options: opts, value: '', placeholder: '+ Add from item catalog…',
        searchPlaceholder: 'Search SKU / name…', compact: true,
        onChange: (v) => {
            if (!v) return;
            const it = inventoryItems.find(x => x.id === v);
            if (it) {
                // Default the revenue account: item's own, else first income option already in the line dropdown.
                addInvoiceLine({
                    item_id: it.id, description: it.name, hsn_sac: it.hsn_sac || '',
                    quantity: 1, unit_price: effectiveItemPrice(it),   // customer's price list, else catalog
                    account_id: it.income_account_id || AccountsCommon.postableAccounts(accounts, 'income')[0]?.id || undefined,
                    ...(it.tax_config_id ? { tax_config_id: it.tax_config_id } : {})
                });
                if (it.track_inventory && it.qty_on_hand <= 0)
                    Toast.info(`Heads up: '${it.sku}' has ${it.qty_on_hand} in stock — selling will take it negative.`);
            }
            invoiceItemPickerDD.setValue?.('');
        }
    });
}

// Invoice-level Project dropdown (one project per invoice; applied to every line on save)
let invoiceProjectDropdown = null;

// ── Multi-currency (display-layer FX) ─────────────────────────────────────────
// Line prices are ENTERED in the invoice currency; on save they are converted to
// INR at the captured rate (books stay in INR), and currency+rate ride along for
// the client-facing document. Base-currency invoices skip all of this.
const BASE_CURRENCY = 'INR';
let currencyList = [];          // [{code,name,symbol}] from /currency/list
let invoiceCurrencyDropdown = null;

async function loadCurrencyList() {
    if (currencyList.length) return currencyList;
    try {
        const res = await api.request(AccountsCommon.buildUrl('currency/list'), { _skipSpinner: true });
        currencyList = Array.isArray(res) ? res : [];
    } catch { /* offline fallback below */ }
    if (!currencyList.length) currencyList = [
        { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
        { code: 'USD', name: 'US Dollar', symbol: '$' },
        { code: 'EUR', name: 'Euro', symbol: '€' },
        { code: 'GBP', name: 'British Pound', symbol: '£' }
    ];
    return currencyList;
}

function currencySymbol(code) {
    return currencyList.find(c => c.code === code)?.symbol || code + ' ';
}

function invoiceCurrency() { return invoiceCurrencyDropdown?.getValue?.() || BASE_CURRENCY; }
function invoiceRate() { return parseFloat(document.getElementById('invoiceExchangeRate')?.value) || 0; }

async function initInvoiceCurrencyDropdown(value) {
    const container = document.getElementById('invoiceCurrencyContainer');
    if (!container || typeof SearchableDropdown !== 'function') return;
    await loadCurrencyList();
    const opts = currencyList.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }));
    if (invoiceCurrencyDropdown?.setOptions) {
        invoiceCurrencyDropdown.setOptions(opts, false);
        invoiceCurrencyDropdown.setValue?.(value || BASE_CURRENCY);
    } else {
        container.innerHTML = '';
        invoiceCurrencyDropdown = new SearchableDropdown(container, {
            id: 'invoiceCurrencyDD',
            options: opts,
            value: value || BASE_CURRENCY,
            placeholder: BASE_CURRENCY,
            searchPlaceholder: 'Search currency…',
            compact: true,
            onChange: () => onInvoiceCurrencyChanged(true)
        });
    }
    onInvoiceCurrencyChanged(false);
}

/** Show/hide the rate field; auto-fetch the ECB rate when switching to a foreign currency. */
async function onInvoiceCurrencyChanged(autoFetch) {
    const cur = invoiceCurrency();
    const group = document.getElementById('invoiceRateGroup');
    const hint = document.getElementById('invoiceRateHint');
    const rateEl = document.getElementById('invoiceExchangeRate');
    if (!group) return;
    if (cur === BASE_CURRENCY) {
        group.style.display = 'none';
        if (rateEl) rateEl.value = '';
        calculateInvoiceTotals();
        return;
    }
    group.style.display = '';
    const rateLabel = group.querySelector('label');
    if (rateLabel && !rateLabel.querySelector('.fx-info-btn')) {
        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'fx-info-btn';
        infoBtn.setAttribute('aria-label', 'What is the exchange rate?');
        infoBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        infoBtn.onclick = () => AccountsCommon.showFxRateHelp(invoiceCurrency(), invoiceRate());
        rateLabel.appendChild(infoBtn);
    }
    if (autoFetch) {
        if (hint) hint.textContent = 'Fetching rate…';
        try {
            const date = document.getElementById('invoiceDate')?.value || '';
            const res = await api.request(AccountsCommon.buildUrl('currency/rate', { from: cur, to: BASE_CURRENCY, ...(date ? { date } : {}) }), { _skipSpinner: true });
            if (rateEl) rateEl.value = res.rate;
            if (hint) hint.textContent = `1 ${cur} = ₹${res.rate} · ECB reference (${res.effective_date?.split('T')[0] || 'latest'}) — editable`;
        } catch {
            if (hint) hint.textContent = `Couldn't fetch the ${cur} rate — enter it manually (how many ₹ one ${cur} is worth).`;
        }
    }
    calculateInvoiceTotals();
}

function initInvoiceProjectDropdown(value) {
    const container = document.getElementById('invoiceProjectContainer');
    if (!container || typeof SearchableDropdown !== 'function') return;
    const opts = invoiceProjectOptions();
    if (invoiceProjectDropdown?.setOptions) {
        invoiceProjectDropdown.setOptions(opts, false);
        invoiceProjectDropdown.setValue?.(value || '');
    } else {
        container.innerHTML = '';
        invoiceProjectDropdown = new SearchableDropdown(container, {
            id: 'invoiceProjectDD',
            options: opts,
            value: value || '',
            placeholder: 'No project',
            searchPlaceholder: 'Search projects…',
            compact: true
        });
    }
}

function showCreateInvoiceModal() {
    document.getElementById('invoiceModalTitle').textContent = 'Create Invoice';
    // The modal is shared with the read-only "view issued invoice" path; clear that state first,
    // else after viewing an approved invoice the create form opens disabled with Save hidden.
    _setInvoiceModalReadOnly(false);
    document.getElementById('invoiceForm').reset();
    document.getElementById('invoiceId').value = '';
    document.getElementById('invoiceLines').innerHTML = '';
    const printBtn = document.getElementById('invoicePrintBtn');
    if (printBtn) printBtn.style.display = 'none';
    initInvoiceProjectDropdown('');
    initInvoiceCurrencyDropdown(BASE_CURRENCY);
    initInvoiceItemPicker();
    invoiceIsNewDoc = true;             // schemes auto-manage free lines on NEW invoices only
    invoiceSchemeOptOut.clear();
    loadInvoiceSchemes();
    addInvoiceLine();
    calculateInvoiceTotals();
    renderInvoiceCustomFields(null);
    AccountsCommon.showFormPage('customerInvoiceModal');
}

// Alias: the row template binds the View action to viewInvoice(), but
// historically the page only had editInvoice. Without this alias the
// View button silently throws ReferenceError. Treat View as Edit for
// now — drafts open editable, approved invoices still open in this
// modal but the user can only re-approve or cancel out.
const viewInvoice = (id) => editInvoice(id);

async function editInvoice(id) {
    try {
        invoiceIsNewDoc = false;   // saved lines stay exactly as stored — no scheme auto-management
        const inv = await api.request(AccountsCommon.buildUrl(`invoices/${id}`));
        const isDraft = (inv.status || 'draft') === 'draft';
        const titleEl = document.getElementById('invoiceModalTitle');
        titleEl.textContent = isDraft
            ? `Edit Invoice ${inv.invoice_number || ''}`
            : `View Invoice ${inv.invoice_number || ''}  (${(inv.status || '').toUpperCase()} — read-only)`;

        document.getElementById('invoiceId').value = inv.id;
        const invPrintBtn = document.getElementById('invoicePrintBtn');
        if (invPrintBtn) invPrintBtn.style.display = '';
        document.getElementById('invoiceCustomerId').value = inv.customer_id || '';
        document.getElementById('invoiceDate').value = inv.invoice_date?.split('T')[0] || '';
        document.getElementById('invoiceDueDate').value = inv.due_date?.split('T')[0] || '';
        document.getElementById('invoiceNotes').value = inv.notes || '';

        const lines = inv.lines || inv.line_items || [];
        // FX invoices store line amounts in INR; display them back in the document currency
        // at the captured rate so the user edits what the client sees.
        const fxRate = inv.exchange_rate ? parseFloat(inv.exchange_rate) : 0;
        await initInvoiceCurrencyDropdown(inv.currency || BASE_CURRENCY);
        // AWAIT the catalog load: addInvoiceLine builds each line's unit picker from inventoryItems —
        // rendering lines before the catalog arrives degraded alt-unit lines to a locked single-option
        // dropdown (and hid the picker entirely on base-unit lines) on the first edit after page load.
        await initInvoiceItemPicker();
        await loadInvoicePriceList();   // the edit-loaded customer's rates drive any newly added lines
        if (fxRate > 0) {
            document.getElementById('invoiceExchangeRate').value = fxRate;
            const rh = document.getElementById('invoiceRateHint');
            if (rh) rh.textContent = `1 ${inv.currency} = ₹${fxRate} · rate captured on this invoice — editable`;
            lines.forEach(l => {
                const inr = parseFloat(l.unit_price ?? l.rate ?? 0);
                l.unit_price = Math.round((inr / fxRate) * 100) / 100;
            });
        }
        // One project per invoice: seed the header dropdown from the lines. Legacy invoices could
        // tag lines with different projects — surface that instead of silently rewriting on save.
        const lineProjects = [...new Set(lines.map(l => l.project_id || ''))];
        initInvoiceProjectDropdown(lineProjects.length === 1 ? lineProjects[0] : '');
        if (isDraft && lineProjects.filter(p => p).length > 1)
            Toast.info('This draft has lines tagged to different projects. Saving will apply the single project selected above to all lines.');
        const tbody = document.getElementById('invoiceLines');
        tbody.innerHTML = '';
        if (lines.length) {
            lines.forEach(l => addInvoiceLine(l));
        } else {
            addInvoiceLine();
        }
        calculateInvoiceTotals();
        await renderInvoiceCustomFields(inv.id);

        // GST law: an issued tax invoice (status != 'draft') CANNOT be
        // edited — would break GSTR-1 immutability and the customer's
        // already-filed GSTR-2A. Lock the form to read-only and hide
        // Save buttons. CAs needing changes must issue a Credit Note +
        // a fresh invoice.
        _setInvoiceModalReadOnly(!isDraft);

        // E-invoice panel only makes sense for issued (non-draft) invoices. Runs AFTER
        // _setInvoiceModalReadOnly so its buttons aren't caught by the disable-all sweep.
        if (!isDraft) renderEInvoicePanel(inv);
        else { const p = document.getElementById('customerInvoiceModal')?.querySelector('.einvoice-panel'); if (p) p.remove(); }

        AccountsCommon.showFormPage('customerInvoiceModal');
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
    // SearchableDropdowns are DIVs — the disabled attribute doesn't reach them. Left live on an
    // ISSUED invoice, the line unit/tax/account pills and the item picker still respond: one tap
    // rewrites the displayed (locked-looking) rates and totals — a falsified issued invoice on
    // screen. Kill pointer events wholesale in read-only mode.
    modal.querySelectorAll('.searchable-dropdown-container').forEach(el => {
        el.style.pointerEvents = readOnly ? 'none' : '';
        el.style.opacity = readOnly ? '0.7' : '';
    });
    // Also hide Save Draft + Save & Approve in read-only mode. The form was rebuilt as a full-page
    // .acc-form-page whose action bar is .acc-form-page__actions (legacy .modal-footer kept as a fallback).
    modal.querySelectorAll('.acc-form-page__actions button, .modal-footer button').forEach(b => {
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
        // The invoice modal was rebuilt as a full-page .acc-form-page: its content lives in the
        // <form class="acc-form">, not a .modal-body (which no longer exists → this used to throw
        // "Cannot read properties of null (reading 'insertBefore')" on viewing any issued invoice).
        const body = modal.querySelector('.acc-form') || modal.querySelector('.modal-body') || modal.querySelector('.acc-form-page__inner');
        if (body) body.insertBefore(banner, body.firstChild);
    } else if (!readOnly && banner) {
        banner.remove();
    }
}

function addInvoiceLine(data = {}) {
    // Normalize: backend uses unit_price, frontend uses rate
    if (data.unit_price !== undefined && data.rate === undefined) data.rate = data.unit_price;
    const tbody = document.getElementById('invoiceLines');
    // A fresh line (Add Line click) inherits the previous row's GL account — on a 10-line
    // invoice the account rarely changes row to row, so default to it (still editable).
    if (data.account_id === undefined) {
        if (!AccountsCommon.requirePrevLineAccount(tbody)) return;
        const prevAcct = tbody.querySelector('tr:last-child .line-account')?.value;
        if (prevAcct) data.account_id = prevAcct;
    }
    const row = document.createElement('tr');
    const acctOptions = AccountsCommon.postableAccounts(accounts, 'income').map(a => {
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
        <td><input type="number" class="form-control line-qty" value="${data.quantity ?? 1}" min="0" step="any" oninput="calculateInvoiceTotals()"><div class="searchable-dropdown-container line-uom-sd" style="margin-top:2px;"></div></td>
        <td><input type="number" class="form-control line-rate" value="${data.rate || ''}" min="0" step="0.01" placeholder="0.00" oninput="calculateInvoiceTotals()"></td>
        <td><input type="number" class="form-control line-disc" value="${data.discount_percent || ''}" min="0" max="100" step="0.01" placeholder="0" oninput="calculateInvoiceTotals()"></td>
        <td><div class="searchable-dropdown-container line-tax-sd"></div></td>
        <td class="line-amount" style="text-align:right; padding-top:0.7rem;">0.00</td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="removeInvoiceLine(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    row._itemId = data.item_id || null;
    tbody.appendChild(row);

    // ── Unit picker (multiple UoM): shown only when the item defines a sale unit ──
    // Price is per SELECTED unit; the backend converts qty × conversion to base for stock.
    {
        const invIt = (inventoryItems || []).find(x => x.id === row._itemId);
        const baseU = invIt?.unit || null;
        const altU = invIt?.sale_unit || null;
        const uomChoices = [...new Set([baseU, altU, data.uom].filter(Boolean))];
        if (uomChoices.length > 1) {
            const startUom = data.uom || baseU;
            row._lineUomDropdown = new SearchableDropdown(row.querySelector('.line-uom-sd'), {
                id: `inv-line-uom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                options: uomChoices.map(u => ({ value: u, label: u })),
                value: startUom, compact: true,
                onChange: (v) => {
                    // Convenience: if the rate still matches the previous unit's catalog default,
                    // rescale it to the newly picked unit (base price × its conversion).
                    if (invIt) {
                        const basePx = effectiveItemPrice(invIt);   // customer price list, else catalog
                        const convOf = (u) => (altU && u === altU) ? (invIt.sale_conversion || 1) : 1;
                        const rateEl = row.querySelector('.line-rate');
                        const prevDefault = Math.round(basePx * convOf(row._lineUom || startUom) * 100) / 100;
                        // Rescale only an EMPTY rate or one still at the previous unit's default —
                        // a deliberately-typed price (including ₹0 free-of-charge) must survive a unit switch.
                        const raw = (rateEl.value || '').trim();
                        if (raw === '' || parseFloat(raw) === prevDefault) rateEl.value = Math.round(basePx * convOf(v) * 100) / 100;
                    }
                    row._lineUom = v;
                    calculateInvoiceTotals();
                }
            });
            row._lineUom = startUom;
        } else if (data.uom) {
            // Edit view without the catalog loaded: keep the stored unit visible + intact.
            row._lineUomDropdown = new SearchableDropdown(row.querySelector('.line-uom-sd'), {
                id: `inv-line-uom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                options: [{ value: data.uom, label: data.uom }], value: data.uom, compact: true
            });
        }
    }

    // Hide the native select + wire SearchableDropdown with quick-add
    const select = row.querySelector('.line-account');
    select.style.display = 'none';
    if (data.account_id) select.value = data.account_id;

    const buildAccountOptions = () => [
        { value: '', label: 'Select...' },
        ...AccountsCommon.postableAccounts(accounts, 'income').map(a => {
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
    // A new line defaults to No-tax when the customer is a zero-rated export (else GST 18%), so the preview
    // never overstates an export total; an edited line keeps its persisted tax_config_id.
    const initialTaxId = data.tax_config_id !== undefined ? (data.tax_config_id || '') : (_invoiceCustomerIsZeroRated() ? '' : _invoiceDefaultTaxConfigId());
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

/** Project dropdown options for the invoice's currently-selected customer (backend enforces the match). */
function invoiceProjectOptions() {
    const custId = document.getElementById('invoiceCustomerId')?.value || '';
    const opts = [{ value: '', label: 'No project' }];
    if (!custId) return opts;
    projects.filter(p => p.customer_id === custId)
        .forEach(p => opts.push({ value: p.id, label: p.code ? `${p.code} — ${p.name}` : p.name }));
    return opts;
}

/** True when the selected invoice customer is an overseas (zero-rated export) party. */
function _invoiceCustomerIsZeroRated() {
    const custId = document.getElementById('invoiceCustomerId')?.value;
    return customers.find(c => c.id === custId)?.gst_treatment === 'overseas';
}

/** On customer change: re-scope project dropdowns AND, for a zero-rated export, force every line to
 *  "No tax" and recalc so the preview total matches what the backend actually posts (no GST). */
// ── Customer price list (Feature: price lists → sales) ──────────────────────
// The assigned list's prices are per-BASE-unit DEFAULTS for new lines (same MRP-inclusive
// semantics as item.sale_price). Existing lines are never silently repriced — a customer
// switch only affects lines added afterwards, with a toast so the biller knows which book
// of rates is in force. Missing/inactive list ⇒ standard prices (fail-safe fallback).
let invoicePriceMap = new Map();
let invoicePriceListName = '';
async function loadInvoicePriceList() {
    invoicePriceMap = new Map(); invoicePriceListName = '';
    const custId = document.getElementById('invoiceCustomerId')?.value;
    const cust = customers.find(c => c.id === custId);
    if (!cust?.price_list_id) return;
    try {
        const rows = await api.request(AccountsCommon.buildUrl(`price-lists/${cust.price_list_id}/prices`), { _skipSpinner: true });
        (Array.isArray(rows) ? rows : (rows?.data || [])).forEach(r => invoicePriceMap.set(r.item_id, parseFloat(r.price)));
        const lists = await api.request(AccountsCommon.buildUrl('price-lists'), { _skipSpinner: true }).catch(() => []);
        invoicePriceListName = (Array.isArray(lists) ? lists : (lists?.data || [])).find(p => p.id === cust.price_list_id)?.name || 'price list';
        if (invoicePriceMap.size) Toast.info(`Using '${invoicePriceListName}' rates for ${cust.name} — new lines pre-fill them.`);
    } catch { /* fallback to standard prices */ }
}
/** Effective per-BASE-unit price for an item on THIS invoice: customer's list price, else catalog. */
function effectiveItemPrice(it) { return invoicePriceMap.has(it.id) ? invoicePriceMap.get(it.id) : it.sale_price; }

// ── Trade schemes (buy N get M free) on the invoice screen ──────────────────
// Mirrors POS: ONE auto free line per scheme at 100% discount, qty (BASE units) =
// floor(Σ paid base of the bought item ÷ buy_qty) × free_qty. Auto-maintenance runs ONLY on
// NEW invoices — an edited draft keeps its saved lines exactly as stored (re-deriving would
// double the saved free lines, whose scheme linkage isn't persisted by design).
let invoiceSchemes = [];
const invoiceSchemeOptOut = new Set();
let invoiceIsNewDoc = false;        // set true by the create-modal opener, false by the edit loader
let _maintainingFreeLines = false;  // recursion guard: addInvoiceLine re-enters calculateInvoiceTotals

async function loadInvoiceSchemes() {
    try {
        const r = await api.request(AccountsCommon.buildUrl('trade-schemes', { activeOn: AccountsCommon.todayLocal() }), { _skipSpinner: true });
        invoiceSchemes = Array.isArray(r) ? r : (r?.data || []);
    } catch { invoiceSchemes = []; }
}

function _rowBaseQty(row) {
    const it = (inventoryItems || []).find(x => x.id === row._itemId);
    const uom = row._lineUomDropdown?.getValue?.();
    const conv = (uom && it?.sale_unit && uom.toLowerCase() === it.sale_unit.toLowerCase()) ? (it.sale_conversion || 1) : 1;
    return (parseFloat(row.querySelector('.line-qty')?.value) || 0) * conv;
}

function maintainInvoiceFreeLines() {
    if (_maintainingFreeLines || !invoiceIsNewDoc || !invoiceSchemes.length) return;
    _maintainingFreeLines = true;
    try {
        const rows = [...document.querySelectorAll('#invoiceLines tr')];
        for (const s of invoiceSchemes) {
            const freeItemId = s.free_item_id || s.item_id;
            const freeItem = (inventoryItems || []).find(i => i.id === freeItemId);
            const existing = rows.find(r => r._freeScheme === s.id);
            const paidBase = rows.filter(r => !r._freeScheme && r._itemId === s.item_id).reduce((sum, r) => sum + _rowBaseQty(r), 0);
            const entitled = invoiceSchemeOptOut.has(s.id) || !freeItem ? 0 : Math.floor(paidBase / s.buy_qty) * s.free_qty;
            if (entitled > 0 && !existing) {
                addInvoiceLine({
                    item_id: freeItem.id, description: `FREE — ${s.name}`, hsn_sac: freeItem.hsn_sac || '',
                    quantity: entitled, unit_price: effectiveItemPrice(freeItem), discount_percent: 100,
                    account_id: freeItem.income_account_id || AccountsCommon.postableAccounts(accounts, 'income')[0]?.id || undefined,
                    ...(freeItem.tax_config_id ? { tax_config_id: freeItem.tax_config_id } : {})
                });
                const newRow = document.querySelector('#invoiceLines tr:last-child');
                newRow._freeScheme = s.id;
                newRow.querySelectorAll('.line-qty, .line-rate, .line-disc, .line-desc').forEach(el => el.readOnly = true);
                Toast.info(`Free goods added: ${entitled} × ${freeItem.name} (${s.name}). Remove the line to opt out.`);
            } else if (existing) {
                if (entitled > 0) {
                    const q = existing.querySelector('.line-qty');
                    if (parseFloat(q.value) !== entitled) { q.value = entitled; }
                } else existing.remove();
            }
        }
    } finally { _maintainingFreeLines = false; }
}

/** Rows removed by the biller: if it was an auto free line, opt this invoice out of the scheme. */
function _noteFreeLineRemoval(row) {
    if (row?._freeScheme) invoiceSchemeOptOut.add(row._freeScheme);
}

function onInvoiceCustomerChange() {
    refreshLineProjectDropdowns();
    loadInvoicePriceList();
    const zeroRated = _invoiceCustomerIsZeroRated();
    if (zeroRated) {
        document.querySelectorAll('#invoiceLines tr').forEach(row => row._lineTaxDropdown?.setValue?.(''));
        calculateInvoiceTotals();
    }
    const banner = document.getElementById('invoiceTreatmentBanner');
    if (!banner) return;
    if (zeroRated) {
        banner.style.display = '';
        banner.innerHTML = '🌐 <strong>Overseas customer</strong> — this is a zero-rated export. No GST is applied on approval; every line has been set to “No tax” so the preview matches the posted amount.';
    } else {
        banner.style.display = 'none';
    }
}

/** Re-scope the invoice's Project dropdown when the customer changes (projects are per-customer). */
function refreshLineProjectDropdowns() {
    initInvoiceProjectDropdown('');
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
    const row = btn.closest('tr');
    _noteFreeLineRemoval(row);   // removing an auto free line opts this invoice out of its scheme
    row.remove();
    calculateInvoiceTotals();
}

function calculateInvoiceTotals() {
    maintainInvoiceFreeLines();   // choke point: every qty/line change lands here (no-op on edits)
    let subtotal = 0;
    let totalTax = 0;
    const r2 = n => Math.round(n * 100) / 100;
    document.querySelectorAll('#invoiceLines tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        // Net-of-discount, mirroring the backend rounding exactly: gross=round(qty*rate,2),
        // disc=round(gross*disc%/100,2), net=gross-disc. Tax is charged on the net.
        const discPct = Math.min(100, Math.max(0, parseFloat(row.querySelector('.line-disc')?.value) || 0));
        const gross = r2(qty * rate);
        const discAmt = r2(gross * discPct / 100);
        const amt = gross - discAmt;
        subtotal += amt;

        const taxConfigId = row._lineTaxDropdown?.selectedValue || '';
        const taxPct = _invoiceTaxRateFor(taxConfigId);
        const lineTax = (amt * taxPct) / 100;
        totalTax += lineTax;

        const amtCell = row.querySelector('.line-amount');
        if (amtCell) {
            const discNote = discAmt > 0 ? ` − ${discAmt.toFixed(2)} disc` : '';
            if (taxPct > 0) {
                amtCell.innerHTML = `
                    <div>${(amt + lineTax).toFixed(2)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">${amt.toFixed(2)}${discNote} + ${lineTax.toFixed(2)} tax</div>`;
            } else if (discAmt > 0) {
                amtCell.innerHTML = `<div>${amt.toFixed(2)}</div><div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">${gross.toFixed(2)}${discNote}</div>`;
            } else {
                amtCell.textContent = amt.toFixed(2);
            }
        }
    });

    const cur = invoiceCurrency();
    const sym = cur === BASE_CURRENCY ? '' : currencySymbol(cur);
    setText('invoiceSubtotal', sym + subtotal.toFixed(2));
    setText('invoiceTax', sym + totalTax.toFixed(2));
    setText('invoiceTotal', sym + (subtotal + totalTax).toFixed(2));
    const fxRow = document.getElementById('invoiceFxEquiv');
    if (fxRow) {
        const rate = invoiceRate();
        if (cur !== BASE_CURRENCY && rate > 0) {
            fxRow.style.display = '';
            fxRow.innerHTML = `<span>Posted to books as</span><span>≈ ₹${((subtotal + totalTax) * rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })} @ ${rate}</span>`;
        } else {
            fxRow.style.display = 'none';
        }
    }
}

async function saveInvoice(approve) {
    const form = document.getElementById('invoiceForm');
    if (!form.reportValidity()) return;

    // Block early if a required custom field is empty — avoids creating the invoice then failing its values write.
    const cfErr = AccountsCommon.validateRequiredCustomFields(invoiceCfController);
    if (cfErr) { Toast.error(cfErr); return; }

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
            discount_percent: Math.round(Math.min(100, Math.max(0, parseFloat(row.querySelector('.line-disc')?.value) || 0)) * 100) / 100,   // 2dp — backend DECIMAL(5,2) rejects finer
            tax_config_id: taxConfigId,
            tax_rate: taxRate || 0,
            item_id: row._itemId || null,
            // Selected line unit; the backend normalizes an explicit base unit to null.
            uom: row._lineUomDropdown?.getValue?.() || null,
            project_id: invoiceProjectDropdown?.getValue?.() || null
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
    const docCurrency = invoiceCurrency();
    const docRate = invoiceRate();
    if (docCurrency !== BASE_CURRENCY) {
        if (!(docRate > 0)) {
            Toast.error(`Enter the exchange rate: how many ₹ one ${docCurrency} is worth`);
            return;
        }
        // Convert entered document-currency prices to INR — the books (GL, AR, taxes,
        // payments) run entirely in INR; currency+rate ride along for the client document.
        lines.forEach(l => { l.unit_price = Math.round(l.unit_price * docRate * 100) / 100; });
    }

    const payload = {
        customer_id: document.getElementById('invoiceCustomerId').value,
        invoice_date: document.getElementById('invoiceDate').value,
        due_date: document.getElementById('invoiceDueDate').value,
        notes: document.getElementById('invoiceNotes').value,
        currency: docCurrency,
        exchange_rate: docCurrency !== BASE_CURRENCY ? docRate : null,
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
        // The document now exists — persist its custom-field values.
        if (savedInvoice?.id) {
            try { await AccountsCommon.saveCustomFieldValues('customer_invoice', savedInvoice.id, invoiceCfController?.getValues?.() || {}); }
            catch (e) { Toast.error(e.message || 'Some custom fields were not saved'); }
        }
        AccountsCommon.hideFormPage('customerInvoiceModal');
        // The invoice's lines changed — drop the cached project breakdown so the Project filter and the
        // Project Statement drill-down pick up the new/edited lines on their next read.
        AccountsCommon.invalidateProjectBreakdown(payload.customer_id);
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
        renderPaymentCharts(all);
        _acActiveRender = () => renderPaymentCharts(all);

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
                const pnum = (p.payment_number || '').replace(/'/g, '');
                const advanceLeft = (parseFloat(p.advance_amount) || 0) - (parseFloat(p.advance_applied) || 0);
                let acts = '';
                if (accountsRoles.isAdmin() && p.status !== 'voided') {
                    if (advanceLeft > 0.005)
                        acts += `<button class="btn-icon" data-tooltip="Refund advance" onclick="openRefundAdvance('${p.id}','${pnum}',${advanceLeft},'${p.bank_account_id || ''}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg></button> `;
                    acts += `<button class="btn-icon btn-icon-danger" data-tooltip="Void receipt" onclick="voidCustomerPayment('${p.id}','${pnum}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg></button>`;
                }
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(p.payment_number || '-')}${p.status === 'voided' ? ' <span class="status-badge">voided</span>' : ''}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}</td>
                    <td>${AccountsCommon.formatDate(p.payment_date)}</td>
                    <td>${AccountsCommon.formatCurrency(p.amount)}</td>
                    <td>${AccountsCommon.escapeHtml(bankName)}</td>
                    <td>${AccountsCommon.escapeHtml(p.reference_number || p.reference || '-')}</td>
                    <td class="actions-cell">${acts || '<span class="text-secondary">-</span>'}</td>
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
    updatePaymentGross();
    AccountsCommon.openModal('customerPaymentModal');
}

// Gross applied to invoices = net cash received + TDS withheld by the customer. The invoice clears at
// the gross; only the net cash hits the bank, and the TDS is booked to TDS Receivable. Kept as a
// read-only display so the user can see what their allocations must sum to.
function updatePaymentGross() {
    const amount = parseFloat(document.getElementById('paymentAmount')?.value) || 0;
    const tds = parseFloat(document.getElementById('paymentTds')?.value) || 0;
    const disp = document.getElementById('paymentGrossDisplay');
    if (disp) disp.value = AccountsCommon.formatCurrency(amount + tds);
    // Live forex preview: (net cash + TDS) vs booked allocations. Only a real forex candidate
    // when at least one allocated invoice is foreign-currency.
    const hint = document.getElementById('paymentForexHint');
    if (!hint) return;
    let alloc = 0, fxAlloc = false;
    document.querySelectorAll('#paymentAllocations tr:not(.empty-state)').forEach(row => {
        const amt = parseFloat(row.querySelector('.alloc-amount')?.value) || 0;
        if (amt > 0) { alloc += amt; if (row.dataset.fx) fxAlloc = true; }
    });
    const diff = Math.round(((amount + tds) - alloc) * 100) / 100;
    if (!alloc || diff === 0) { hint.style.display = 'none'; return; }
    hint.style.display = '';
    if (fxAlloc) {
        hint.style.color = diff > 0 ? 'var(--color-success)' : 'var(--color-error)';
        hint.textContent = diff > 0
            ? `Forex gain ${AccountsCommon.formatCurrency(diff)} will post to 4290 Foreign Exchange Gain/Loss`
            : `Forex loss ${AccountsCommon.formatCurrency(-diff)} will post to 4290 Foreign Exchange Gain/Loss`;
    } else if (diff > 0 && tds === 0) {
        hint.style.color = 'var(--color-success)';
        hint.textContent = `${AccountsCommon.formatCurrency(diff)} will be held as a customer advance (apply it to a future invoice from the invoice's ⧉ action)`;
    } else {
        hint.style.color = 'var(--color-warning)';
        hint.textContent = `Allocations are ${AccountsCommon.formatCurrency(Math.abs(diff))} ${diff > 0 ? 'short of' : 'over'} Amount + TDS`;
    }
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
            const isFx = !!inv.exchange_rate;
            const fxBadge = isFx ? ` <span style="font-size:0.72rem;color:var(--text-secondary);">(${AccountsCommon.escapeHtml(inv.currency)} @ ${inv.exchange_rate})</span>` : '';
            return `<tr data-fx="${isFx ? '1' : ''}">
                <td>${AccountsCommon.escapeHtml(inv.invoice_number || '-')}${fxBadge}<input type="hidden" class="alloc-invoice-id" value="${inv.id}"></td>
                <td>${AccountsCommon.formatCurrency(bal)}</td>
                <td><input type="number" class="form-control alloc-amount" step="0.01" min="0" max="${bal}" placeholder="0.00" oninput="updatePaymentGross()"></td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="3"><div class="empty-message"><p>Failed to load invoices</p></div></td></tr>';
    }
}

// ── Customer advances: apply the pool against an open invoice ────────────────
async function openApplyAdvance(invoiceId, customerId, balanceDue, invoiceNumber) {
    let pool = 0;
    try {
        const res = await api.request(AccountsCommon.buildUrl(`invoices/advances/${customerId}`), { _skipSpinner: true });
        pool = parseFloat(res.balance) || 0;
    } catch { }
    if (pool <= 0) { Toast.info('This customer has no advance on account.'); return; }
    const maxApply = Math.min(pool, balanceDue);
    const overlay = document.createElement('div');
    overlay.className = 'modal active';
    overlay.innerHTML = `<div class="modal-content" style="max-width:420px;">
        <div class="modal-header"><h3>Apply Advance — ${AccountsCommon.escapeHtml(invoiceNumber)}</h3></div>
        <div class="modal-body">
            <p style="font-size:0.85rem;color:var(--text-secondary);">Advance available: <strong>${AccountsCommon.formatCurrency(pool)}</strong> · Invoice balance: <strong>${AccountsCommon.formatCurrency(balanceDue)}</strong></p>
            <div class="form-group"><label>Amount to apply</label><input type="number" id="advApplyAmt" class="form-control" step="0.01" min="0" max="${maxApply}" value="${maxApply}"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-outline" id="advCancel">Cancel</button>
            <button class="btn btn-primary" id="advGo">Apply</button>
        </div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#advCancel').onclick = () => overlay.remove();
    overlay.querySelector('#advGo').onclick = async () => {
        const amt = parseFloat(overlay.querySelector('#advApplyAmt').value);
        if (!amt || amt <= 0) { Toast.error('Enter an amount'); return; }
        try {
            await api.request(AccountsCommon.buildUrl('invoices/advances/apply'), {
                method: 'POST', body: JSON.stringify({ invoice_id: invoiceId, amount: amt })
            });
            Toast.success(`Advance ${AccountsCommon.formatCurrency(amt)} applied`);
            overlay.remove();
            loadCustomerInvoices();
        } catch (err) { Toast.error(err.message || 'Failed to apply advance'); }
    };
}

async function saveCustomerPayment() {
    const form = document.getElementById('paymentForm');
    if (!form.reportValidity()) return;

    // min="0" on the input lets ₹0 through native validation — a zero payment
    // posts a meaningless GL entry. Require strictly positive.
    // 'amount' here is the NET cash received into the bank. When the customer withheld TDS at source,
    // the GROSS settled against the invoices (and sent to the backend as `amount`) is netCash + tds.
    const netCash = parseFloat(document.getElementById('paymentAmount').value);
    if (isNaN(netCash) || netCash <= 0) {
        Toast.error('Amount received must be greater than zero');
        return;
    }
    const tds = parseFloat(document.getElementById('paymentTds')?.value) || 0;
    if (tds < 0) {
        Toast.error('TDS withheld cannot be negative');
        return;
    }
    const gross = Math.round((netCash + tds) * 100) / 100;

    // Backend CustomerPaymentAllocationRequest expects { customer_invoice_id, allocated_amount }
    // — NOT { invoice_id, amount }. Sending the wrong shape silently dropped allocations
    // server-side and left invoice balance_due unchanged. Fixed in Phase 4 Tier 1.
    const allocations = [];
    document.querySelectorAll('#paymentAllocations tr:not(.empty-state)').forEach(row => {
        const invoiceId = row.querySelector('.alloc-invoice-id')?.value;
        const allocAmt = parseFloat(row.querySelector('.alloc-amount')?.value) || 0;
        if (invoiceId && allocAmt > 0) allocations.push({ customer_invoice_id: invoiceId, allocated_amount: allocAmt });
    });

    const allocatedTotal = Math.round(allocations.reduce((s, a) => s + a.allocated_amount, 0) * 100) / 100;
    // Difference between what reached the bank (+TDS) and the booked amounts being settled.
    // Against a foreign-currency invoice that difference IS the realized forex gain/loss;
    // otherwise it's a mistake (short/over allocation) and blocks the save.
    let anyFxAllocated = false;
    document.querySelectorAll('#paymentAllocations tr:not(.empty-state)').forEach(row => {
        const amt = parseFloat(row.querySelector('.alloc-amount')?.value) || 0;
        if (amt > 0 && row.dataset.fx) anyFxAllocated = true;
    });
    const forex = Math.round((gross - allocatedTotal) * 100) / 100;
    let advanceMode = false;
    if (forex !== 0 && !anyFxAllocated) {
        // Excess cash on a non-FX receipt = customer advance (booking deposit); shortfall is still an error.
        if (forex > 0 && tds === 0) advanceMode = true;
        else {
            Toast.error(`Allocations (${AccountsCommon.formatCurrency(allocatedTotal)}) must equal Amount Received + TDS (${AccountsCommon.formatCurrency(gross)})`);
            return;
        }
    }

    // Backend RecordCustomerPaymentRequest expects `reference_number`, not `reference`.
    // Fixed in Phase 4 Tier 1 — was being silently dropped before.
    // `amount` = GROSS (what clears the invoices = allocations sum); `tds_amount` = TDS withheld. The
    // bank receives amount - tds_amount. With tds 0, gross == net cash → identical to the legacy payload.
    // `amount` = booked gross being settled (Σ allocations); the bank actually received
    // amount - tds + forex. With no FX difference this equals the legacy gross payload.
    const payload = {
        customer_id: document.getElementById('paymentCustomerId').value,
        payment_date: document.getElementById('paymentDate').value,
        amount: advanceMode ? gross : allocatedTotal,
        allow_advance: advanceMode,
        forex_gain_loss: anyFxAllocated ? forex : 0,
        tds_amount: tds,
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
        renderCreditNoteCharts(all);
        _acActiveRender = () => renderCreditNoteCharts(all);

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
            const canReverse = accountsRoles.isAdmin();
            const reverseSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
            tbody.innerHTML = pageItems.map(cn => {
                const custName = cn.customer_name || customers.find(c => c.id === cn.customer_id)?.name || '-';
                const num = (cn.credit_note_number || '').replace(/'/g, '');
                // Approved credit notes can be reversed (admin only); a reversed one shows its status badge.
                const actions = (canReverse && cn.status === 'approved')
                    ? `<button class="btn-icon danger" data-tooltip="Reverse" onclick="reverseCreditNote('${cn.id}','${num}')">${reverseSvg}</button>`
                    : `<span class="text-secondary">${cn.status && cn.status !== 'approved' ? AccountsCommon.escapeHtml(cn.status) : '-'}</span>`;
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(cn.credit_note_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}</td>
                    <td>${AccountsCommon.escapeHtml(cn.invoice_number || '-')}</td>
                    <td>${AccountsCommon.formatDate(cn.credit_date)}</td>
                    <td>${AccountsCommon.formatCurrency(cn.amount)}</td>
                    <td>${AccountsCommon.escapeHtml(cn.reason || '-')}</td>
                    <td class="actions-cell">${actions}</td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('creditNotesPagination', cnPage, totalPages, p => { cnPage = p; loadCreditNotes(); });
    } catch (err) {
        console.error('[AR] loadCreditNotes error:', err);
        Toast.error('Failed to load credit notes');
    }
}

// Reverse an approved credit note (admin only): reverses its GL entry + tax-ledger row and restores the
// invoice balance it reduced. Refreshes both the credit-note list and the invoices/charts afterwards.
async function reverseCreditNote(id, number) {
    const ok = await Confirm.show({
        title: 'Reverse Credit Note',
        message: `Reverse ${number}? This reverses its journal entry (Dr Accounts Receivable, Cr Sales Revenue) and restores the invoice balance it reduced. This cannot be undone.`,
        confirmText: 'Reverse',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`invoices/credit-notes/${id}/reverse`), {
            method: 'POST',
            body: JSON.stringify({ reason: 'Reversed via Accounts UI' }),
            headers: { 'Content-Type': 'application/json' }
        });
        Toast.success('Credit note reversed');
        loadCreditNotes();
        loadCustomerInvoices();
    } catch (err) {
        Toast.error(err.message || 'Failed to reverse credit note');
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

        renderAgingChart(normalized);
        _acActiveRender = () => renderAgingChart(normalized);

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
// TDS RECEIVABLE (deductee side / Form 26AS) — by client / invoice / project
// ============================================================================

// On first open, default the range to the current financial year (Apr 1 → today,
// India FY) so there's something to show without the user touching the pickers.
let _tdsReceivableInited = false;
let _tdsData = null;          // last report response (cached so view-switching is instant)
let _tdsView = 'client';      // client | invoice | project

function initTdsReceivable() {
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Apr = month 3
    // Set through the flatpickr instance so the calendar opens on the right month (falls back to
    // the raw value if flatpickr hasn't attached yet).
    const setD = (id, val) => {
        const el = document.getElementById(id);
        if (!el || el.value) return;
        if (el._flatpickr) el._flatpickr.setDate(val, false); else el.value = val;
    };
    setD('tdsFromDate', `${fyStartYear}-04-01`);
    setD('tdsToDate', now.toISOString().split('T')[0]);
    if (!_tdsReceivableInited) { _tdsReceivableInited = true; loadTdsReceivable(); }
}

async function loadTdsReceivable() {
    const from = document.getElementById('tdsFromDate')?.value;
    const to = document.getElementById('tdsToDate')?.value;
    if (!from || !to) { Toast.error('Pick a From and To date'); return; }
    if (from > to) { Toast.error('From date must be on or before To date'); return; }
    try {
        _tdsData = await api.request(AccountsCommon.buildUrl('tax/reports/tds-receivable', { fromDate: from, toDate: to }));
        setText('tdsTotal', AccountsCommon.formatCurrency(_tdsData?.total_tds || 0));
        const clients = (_tdsData?.by_client || []).length;
        const meta = document.getElementById('tdsHeroMeta');
        if (meta) meta.textContent = clients
            ? `${AccountsCommon.formatDate ? AccountsCommon.formatDate(from) : from} – ${AccountsCommon.formatDate ? AccountsCommon.formatDate(to) : to} · ${clients} client${clients === 1 ? '' : 's'}`
            : 'No TDS withheld in this period';
        renderTdsView();
    } catch (err) {
        console.error('[TDS] loadTdsReceivable error:', err);
        Toast.error('Failed to load TDS receivable report');
    }
}

// Switch grouping without re-fetching — the report already holds all three cuts.
function setTdsView(view) {
    _tdsView = view;
    document.querySelectorAll('#tds-receivable .tds-seg button').forEach(b =>
        b.classList.toggle('active', b.dataset.view === view));
    renderTdsView();
}

function renderTdsView() {
    if (!_tdsData) return;
    const fmt = AccountsCommon.formatCurrency;
    const esc = AccountsCommon.escapeHtml;
    const host = document.getElementById('tdsBreakdown');
    const head = document.getElementById('tdsBreakdownHead');

    // One integrated component per grouping: a ranked bar-list. Each row IS the bar — label
    // (+ a sub-label for the deductor on invoice/project cuts), a fill sized to its share of the
    // period's total TDS, the amount, and that share %. Ranked so the biggest credit reads first.
    const views = {
        client:  { col: 'Client',  src: _tdsData.by_client || [],  label: r => r.customer_name || '—', sub: () => null },
        invoice: { col: 'Invoice', src: _tdsData.by_invoice || [], label: r => r.invoice_number || '—', sub: r => r.customer_name },
        project: { col: 'Project', src: _tdsData.by_project || [], label: r => r.project_name || '(No project)', sub: r => r.customer_name }
    };
    const v = views[_tdsView] || views.client;
    setText('tdsBreakdownCol', v.col);

    const rows = [...v.src].sort((a, b) => (b.tds || 0) - (a.tds || 0));
    const total = Number(_tdsData.total_tds) || rows.reduce((s, r) => s + (Number(r.tds) || 0), 0);

    if (!rows.length) {
        head.style.display = 'none';
        host.innerHTML = '<div class="tds-empty">No TDS withheld in this period</div>';
        return;
    }
    head.style.display = '';
    host.innerHTML = rows.map(r => {
        const val = Number(r.tds) || 0;
        const shareNum = total > 0 ? (val / total) * 100 : 0;
        const width = Math.max(2, Math.min(100, shareNum));        // floor 2% so tiny slivers still register
        const share = shareNum >= 10 ? Math.round(shareNum) : shareNum.toFixed(1);
        const subVal = v.sub(r);
        return `<div class="tds-bar-row">
            <div class="tds-bar-head">
                <div class="tds-bar-label">${esc(v.label(r))}${subVal ? `<span class="tds-bar-sub">${esc(subVal)}</span>` : ''}</div>
                <div class="tds-bar-amt">${fmt(val)}<span class="tds-bar-pct">${share}%</span></div>
            </div>
            <div class="tds-bar-track"><div class="tds-bar-fill" style="width:${width}%"></div></div>
        </div>`;
    }).join('');
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
        // Header + KPI cards (replaces the old single-line summary).
        let html = `<h3 class="stmt-title">${esc(custName)} — Statement</h3>
        <div class="stats-row">
            <div class="stat-card"><div class="stat-value">${fmt(res?.total_invoiced ?? 0)}</div><div class="stat-label">Total Invoiced</div></div>
            <div class="stat-card"><div class="stat-value">${fmt(res?.total_received ?? 0)}</div><div class="stat-label">Total Received</div></div>
            <div class="stat-card"><div class="stat-value stmt-outstanding">${fmt(res?.total_outstanding ?? 0)}</div><div class="stat-label">Outstanding</div></div>
        </div>`;

        const balLabels = [], balData = [];
        if (!txns.length) {
            html += '<div class="empty-message" style="padding: 2rem; text-align: center;"><p>No transactions in selected period</p></div>';
        } else {
            // Running balance for both the chart and the table (seeded from the backend opening balance).
            let bal = parseFloat(res?.opening_balance) || 0;
            let rows = '';
            txns.forEach(t => {
                const dr = parseFloat(t.debit) || 0;
                const cr = parseFloat(t.credit) || 0;
                bal += dr - cr;
                balLabels.push(fmtD(t.date));
                balData.push(Math.round(bal * 100) / 100);
                rows += `<tr>
                    <td>${fmtD(t.date)}</td>
                    <td>${esc(t.type || '-')}</td>
                    <td>${esc(t.reference || '-')}</td>
                    <td class="text-right">${dr ? fmt(dr) : '-'}</td>
                    <td class="text-right">${cr ? fmt(cr) : '-'}</td>
                    <td class="text-right">${fmt(bal)}</td>
                </tr>`;
            });
            html += `<div class="acc-charts" style="grid-template-columns: 1fr;">
                <div class="acc-chart-card">
                    <h4>Outstanding balance over time</h4>
                    <div class="acc-chart-sub">Running balance after each invoice, payment and credit note</div>
                    <div id="stmtBalanceChart" class="acc-chart"></div>
                </div>
            </div>`;
            html += `<div class="data-table-container"><table class="data-table"><thead><tr>
                <th>Date</th><th>Type</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th>
            </tr></thead><tbody>${rows}</tbody></table></div>`;
        }
        container.innerHTML = html;
        // Chart mounts after the container HTML exists; re-arm for theme-toggle redraws.
        if (balData.length) {
            const draw = () => acArea('stmtBalanceChart', balLabels, balData, 'Balance');
            draw();
            _acActiveRender = draw;
        }
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


// ============================================================================
// INVOICE PRINT / PDF — client-facing document. For a foreign-currency invoice
// every money figure is shown in the DOCUMENT currency with the INR value and
// captured rate alongside (GSTR-1 wants INR; the client wants their currency).
// Seller block comes from Admin → Tenant Settings → organization profile.
// ============================================================================
async function printInvoice() {
    const id = document.getElementById('invoiceId')?.value;
    if (!id) { Toast.error('Save the invoice first'); return; }
    try {
        const [inv, settingsRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl(`invoices/${id}`)),
            api.request(AccountsCommon.buildUrl('settings'), { _skipSpinner: true }).catch(() => ({}))
        ]);
        const settings = settingsRes?.data || settingsRes || {};
        const cust = customers.find(c => c.id === inv.customer_id) || {};
        const esc = AccountsCommon.escapeHtml;
        const fx = inv.exchange_rate ? parseFloat(inv.exchange_rate) : 0;
        const sym = fx ? currencySymbol(inv.currency) : '₹';
        const docAmt = (inr) => fx ? (parseFloat(inr) / fx) : parseFloat(inr);
        const money = (v) => sym + (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const inr = (v) => '₹' + (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const isExport = (cust.gst_treatment === 'overseas');
        const lines = inv.lines || [];

        const custAddr = [cust.billing_address_line1, cust.billing_address_line2, cust.city, cust.state, cust.country, cust.postal_code]
            .filter(Boolean).join(', ');

        const rows = lines.map((l, i) => `
            <tr>
                <td class="c">${i + 1}</td>
                <td>${esc(l.description || l.account_name || '')}</td>
                <td class="c">${esc(l.hsn_sac || '')}</td>
                <td class="r">${Number(l.quantity) || 0}${l.uom ? ' ' + esc(l.uom) : ''}</td>
                <td class="r">${money(docAmt(l.unit_price))}</td>
                <td class="r">${money(docAmt(l.amount ?? (l.quantity * l.unit_price)))}</td>
            </tr>`).join('');

        const fxSummary = fx ? `
            <tr><td colspan="2" class="fxnote">Exchange rate: 1 ${esc(inv.currency)} = ₹${fx} · INR value ${inr(inv.total_amount)}</td></tr>` : '';
        const exportNote = isExport
            ? '<p class="note">SUPPLY MEANT FOR EXPORT UNDER LUT WITHOUT PAYMENT OF INTEGRATED TAX (IGST) — zero-rated export of services.</p>'
            : '';

        const w = window.open('', '_blank');
        if (!w) { Toast.error('Allow pop-ups to print the invoice'); return; }
        w.document.write(`<!DOCTYPE html><html><head><title>${esc(inv.invoice_number || 'Invoice')}</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; padding: 32px; font-size: 13px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1a1a; padding-bottom: 16px; }
    .head h1 { font-size: 22px; letter-spacing: 0.5px; }
    .head .doc { text-align: right; }
    .head .doc .t { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; }
    .meta { display: flex; justify-content: space-between; margin: 18px 0; gap: 24px; }
    .meta .block { flex: 1; }
    .meta h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 6px; }
    .meta p { line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #f0f0f0; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    th, td { border: 1px solid #ccc; padding: 7px 10px; }
    td.r, th.r { text-align: right; } td.c, th.c { text-align: center; }
    .totals { margin-top: 12px; margin-left: auto; width: 320px; }
    .totals td { border: none; padding: 4px 10px; }
    .totals .grand td { border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 15px; padding-top: 8px; }
    .fxnote td { color: #555; font-size: 12px; font-style: italic; }
    .note { margin-top: 18px; font-size: 11.5px; color: #444; border: 1px solid #ddd; padding: 8px 12px; }
    .foot { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; color: #666; }
    @media print { body { padding: 12px; } }
</style></head><body>
    <div class="head">
        <div>
            <h1>${esc(settings.org_legal_name || 'Your Business Name')}</h1>
            <p>${esc(settings.org_address || '')}</p>
            ${settings.org_gstin ? `<p>GSTIN: ${esc(settings.org_gstin)}</p>` : ''}
        </div>
        <div class="doc">
            <div class="t">${isExport ? 'Export Invoice' : 'Tax Invoice'}</div>
            <p><strong>${esc(inv.invoice_number || '')}</strong></p>
            <p>Date: ${(inv.invoice_date || '').split('T')[0]}</p>
            <p>Due: ${(inv.due_date || '').split('T')[0]}</p>
        </div>
    </div>
    <div class="meta">
        <div class="block">
            <h3>Bill To</h3>
            <p><strong>${esc(cust.name || inv.customer_name || '')}</strong></p>
            ${custAddr ? `<p>${esc(custAddr)}</p>` : ''}
            ${cust.gst_number ? `<p>GSTIN: ${esc(cust.gst_number)}</p>` : ''}
        </div>
        <div class="block">
            <h3>Details</h3>
            <p>Currency: ${esc(inv.currency || 'INR')}${fx ? ` (1 ${esc(inv.currency)} = ₹${fx})` : ''}</p>
            <p>Status: ${esc((inv.status || '').replace('_', ' '))}</p>
        </div>
    </div>
    <table>
        <thead><tr><th class="c" style="width:36px;">#</th><th>Description</th><th class="c" style="width:90px;">HSN/SAC</th><th class="r" style="width:60px;">Qty</th><th class="r" style="width:110px;">Unit Price</th><th class="r" style="width:120px;">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
    <table class="totals">
        <tr><td>Subtotal</td><td class="r">${money(docAmt(inv.subtotal))}</td></tr>
        ${Number(inv.tax_amount) ? `<tr><td>Tax (GST)</td><td class="r">${money(docAmt(inv.tax_amount))}</td></tr>` : ''}
        <tr class="grand"><td>Total</td><td class="r">${money(docAmt(inv.total_amount))}</td></tr>
        ${fxSummary}
    </table>
    ${exportNote}
    ${inv.notes ? `<p class="note">${esc(inv.notes)}</p>` : ''}
    <div class="foot">
        <span>Generated by Ragenaizer Accounts</span>
        <span>Authorised Signatory</span>
    </div>
    <script>window.onload = () => window.print();<\/script>
</body></html>`);
        w.document.close();
    } catch (err) {
        console.error('[AR] printInvoice error:', err);
        Toast.error('Failed to build the print view');
    }
}

// ============================================================================
// DELIVERY CHALLANS (GST Rule 55 — goods out without an invoice yet)
// A challan is a transport document: NO stock or ledger effect until it is
// converted to an invoice and that invoice is approved (stock moves ONCE, there).
// ============================================================================

let challansCache = [];
let challanCustomerDD = null;
let challanPurposeDD = null;

const CHALLAN_PURPOSES = [
    { value: 'delivery', label: 'Delivery against order' },
    { value: 'approval', label: 'Sale on approval' },
    { value: 'job_work', label: 'Job work' },
    { value: 'other', label: 'Other (Rule 55)' }
];
const challanPurposeLabel = (v) => CHALLAN_PURPOSES.find(p => p.value === v)?.label || v;

async function loadChallans() {
    try {
        const status = document.getElementById('challanStatusFilter')?.value || '';
        const params = { limit: 500 };
        if (status) params.status = status;
        const res = await api.request(AccountsCommon.buildUrl('delivery-challans', params), { _skipSpinner: true });
        challansCache = Array.isArray(res) ? res : (res?.data || res?.items || []);
        // Stats always reflect ALL statuses (a filtered view shouldn't zero the KPIs).
        let all = challansCache;
        if (status) {
            try {
                const allRes = await api.request(AccountsCommon.buildUrl('delivery-challans', { limit: 500 }), { _skipSpinner: true });
                all = Array.isArray(allRes) ? allRes : (allRes?.data || allRes?.items || []);
            } catch { /* keep filtered set for stats */ }
        }
        document.getElementById('challanTotal').textContent = all.length;
        document.getElementById('challanDraft').textContent = all.filter(c => c.status === 'draft').length;
        document.getElementById('challanIssued').textContent = all.filter(c => c.status === 'issued').length;
        document.getElementById('challanInvoiced').textContent = all.filter(c => c.status === 'invoiced').length;
        renderChallansTable();
    } catch (err) {
        console.error('[Challans] load error:', err);
        Toast.error('Failed to load delivery challans');
    }
}

function renderChallansTable() {
    const tbody = document.getElementById('challansTable');
    if (!tbody) return;
    const esc = AccountsCommon.escapeHtml;
    const q = (document.getElementById('challanSearch')?.value || '').trim().toLowerCase();
    const rows = challansCache.filter(c => !q ||
        (c.challan_number || '').toLowerCase().includes(q) ||
        (c.customer_name || '').toLowerCase().includes(q) ||
        (c.vehicle_no || '').toLowerCase().includes(q));
    if (!rows.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
            <p>${q ? 'No challans match your search' : 'No delivery challans yet — create one when goods leave before the invoice'}</p></div></td></tr>`;
        return;
    }
    const icon = {
        view: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        issue: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
        convert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
        cancel: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
        del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
    };
    tbody.innerHTML = rows.map(c => {
        const acts = [`<button class="btn-icon" onclick="viewChallan('${c.id}')" data-tooltip="View">${icon.view}</button>`];
        if (c.status === 'draft') {
            acts.push(`<button class="btn-icon" onclick="issueChallan('${c.id}')" data-tooltip="Issue (assign number)" data-admin-only>${icon.issue}</button>`);
            acts.push(`<button class="btn-icon btn-icon-danger" onclick="deleteChallan('${c.id}')" data-tooltip="Delete draft" data-admin-only>${icon.del}</button>`);
        } else if (c.status === 'issued') {
            acts.push(`<button class="btn-icon" onclick="convertChallan('${c.id}')" data-tooltip="Convert to invoice" data-admin-only>${icon.convert}</button>`);
            acts.push(`<button class="btn-icon btn-icon-danger" onclick="cancelChallan('${c.id}')" data-tooltip="Cancel (goods came back)" data-admin-only>${icon.cancel}</button>`);
        }
        return `<tr>
            <td><strong>${esc(c.challan_number)}</strong></td>
            <td>${esc(c.customer_name || '')}</td>
            <td>${AccountsCommon.formatDate(c.challan_date)}</td>
            <td>${esc(challanPurposeLabel(c.purpose))}</td>
            <td>${esc(c.vehicle_no || '—')}</td>
            <td>${AccountsCommon.statusBadge(c.status)}</td>
            <td class="table-actions">${acts.join('')}</td>
        </tr>`;
    }).join('');
    accountsRoles.applyRBAC();
}

// ── Create modal ────────────────────────────────────────────────────────────

async function showChallanModal() {
    if (!inventoryItems.length) {
        try { inventoryItems = await api.request(AccountsCommon.buildUrl('inventory/items'), { _skipSpinner: true }); } catch { inventoryItems = []; }
    }
    document.getElementById('challanModalTitle').textContent = 'New Delivery Challan';
    document.getElementById('challanId').value = '';
    document.getElementById('challanVehicle').value = '';
    document.getElementById('challanNotes').value = '';
    document.getElementById('challanLines').innerHTML = '';
    document.getElementById('challanStatusBanner').style.display = 'none';
    _setChallanReadOnly(false);
    if (typeof flatpickr === 'function') flatpickr('#challanDate', { dateFormat: 'Y-m-d', allowInput: true, defaultDate: new Date() });
    else document.getElementById('challanDate').value = new Date().toISOString().slice(0, 10);

    challanCustomerDD = new SearchableDropdown(document.getElementById('challanCustomerDD'), {
        id: 'challanCustomerSD',
        options: [{ value: '', label: 'Select customer...' },
            ...customers.filter(c => c.is_active !== false).map(c => ({ value: c.id, label: c.name }))],
        value: '', placeholder: 'Select customer...', searchPlaceholder: 'Search customers…'
    });
    challanPurposeDD = new SearchableDropdown(document.getElementById('challanPurposeDD'), {
        id: 'challanPurposeSD', options: CHALLAN_PURPOSES, value: 'delivery'
    });
    addChallanLine();
    AccountsCommon.showFormPage('challanModal');
}

function addChallanLine(data = {}) {
    const tbody = document.getElementById('challanLines');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><div class="searchable-dropdown-container chl-item-sd"></div></td>
        <td><input type="number" class="form-control chl-qty" value="${data.quantity ?? 1}" min="0" step="any"><div class="searchable-dropdown-container chl-uom-sd" style="margin-top:2px;"></div></td>
        <td><input type="number" class="form-control chl-price" value="${data.unit_price ?? ''}" min="0" step="0.01" placeholder="auto"></td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="this.closest('tr').remove()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);

    // Challans carry GOODS only (services never ride a transport document).
    const goods = inventoryItems.filter(i => i.is_active && i.item_type === 'goods');
    row._itemDD = new SearchableDropdown(row.querySelector('.chl-item-sd'), {
        id: `chl-item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: [{ value: '', label: 'Select item...' },
            ...goods.map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }))],
        value: data.item_id || '', placeholder: 'Select item...', searchPlaceholder: 'Search SKU / name…', compact: true,
        onChange: (v) => _buildChallanUomPicker(row, v)
    });
    if (data.item_id) _buildChallanUomPicker(row, data.item_id, data.uom);
}

// Unit picker mirrors the invoice line: shown only when the item defines a sale
// unit. The client sends the unit NAME only — the server snapshots the factor.
function _buildChallanUomPicker(row, itemId, presetUom = null) {
    const holder = row.querySelector('.chl-uom-sd');
    holder.innerHTML = '';
    row._lineUom = null;
    const it = inventoryItems.find(x => x.id === itemId);
    if (!it) return;
    const baseU = it.unit || null;
    const altU = it.sale_unit || null;
    const choices = [...new Set([baseU, altU].filter(Boolean))];
    if (choices.length > 1) {
        const start = presetUom || baseU;
        row._uomDD = new SearchableDropdown(holder, {
            id: `chl-uom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            options: choices.map(u => ({ value: u, label: u })), value: start, compact: true,
            onChange: (v) => { row._lineUom = v; _defaultChallanPrice(row, it, v); }
        });
        row._lineUom = start;
    }
    _defaultChallanPrice(row, it, row._lineUom || baseU);
}

function _defaultChallanPrice(row, it, uom) {
    // Convenience default only (field stays editable): sale price × the picked
    // unit's conversion. Only overwrite an empty or still-default value.
    const conv = (it.sale_unit && uom && uom.toLowerCase() === it.sale_unit.toLowerCase()) ? (it.sale_conversion || 1) : 1;
    const el = row.querySelector('.chl-price');
    const fresh = Math.round((it.sale_price || 0) * conv * 100) / 100;
    const raw = (el.value || '').trim();
    if (raw === '' || parseFloat(raw) === row._lastDefaultPrice) el.value = fresh || '';
    row._lastDefaultPrice = fresh;
}

async function saveChallan() {
    const customerId = challanCustomerDD?.getValue?.();
    if (!customerId) { Toast.error('Pick a customer'); return; }
    const date = document.getElementById('challanDate').value;
    if (!date) { Toast.error('Pick a challan date'); return; }
    const lines = [];
    for (const row of document.querySelectorAll('#challanLines tr')) {
        const itemId = row._itemDD?.getValue?.();
        if (!itemId) continue;
        const qty = parseFloat(row.querySelector('.chl-qty').value);
        if (!(qty > 0)) { Toast.error('Every line needs a quantity above zero'); return; }
        const priceRaw = (row.querySelector('.chl-price').value || '').trim();
        lines.push({
            item_id: itemId, quantity: qty,
            uom: row._lineUom || null,
            unit_price: priceRaw === '' ? null : Math.round(parseFloat(priceRaw) * 100) / 100
        });
    }
    if (!lines.length) { Toast.error('Add at least one item line'); return; }
    const btn = document.getElementById('challanSaveBtn');
    btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('delivery-challans'), {
            method: 'POST',
            body: JSON.stringify({
                customer_id: customerId, challan_date: date,
                purpose: challanPurposeDD?.getValue?.() || 'delivery',
                vehicle_no: document.getElementById('challanVehicle').value.trim() || null,
                notes: document.getElementById('challanNotes').value.trim() || null,
                lines
            })
        });
        Toast.success('Draft challan saved — issue it to assign the challan number');
        AccountsCommon.hideFormPage('challanModal');
        loadChallans();
    } catch (err) {
        Toast.error(err?.message || 'Failed to save challan');
    } finally { btn.disabled = false; }
}

// ── View (read-only) ────────────────────────────────────────────────────────

async function viewChallan(id) {
    try {
        const ch = await api.request(AccountsCommon.buildUrl('delivery-challans/' + id));
        if (!ch) return;
        const esc = AccountsCommon.escapeHtml;
        document.getElementById('challanModalTitle').textContent = `Challan ${ch.challan_number}`;
        document.getElementById('challanId').value = ch.id;
        document.getElementById('challanDate').value = (ch.challan_date || '').slice(0, 10);
        document.getElementById('challanVehicle').value = ch.vehicle_no || '';
        document.getElementById('challanNotes').value = ch.notes || '';
        challanCustomerDD = new SearchableDropdown(document.getElementById('challanCustomerDD'), {
            id: 'challanCustomerSD', options: [{ value: ch.customer_id, label: ch.customer_name || 'Customer' }], value: ch.customer_id
        });
        challanPurposeDD = new SearchableDropdown(document.getElementById('challanPurposeDD'), {
            id: 'challanPurposeSD', options: CHALLAN_PURPOSES, value: ch.purpose
        });
        // Static line rows: show the SNAPSHOTTED unit + factor — display honesty.
        document.getElementById('challanLines').innerHTML = (ch.lines || []).map(l => `<tr>
            <td>${esc(l.item_sku)} — ${esc(l.item_name)}</td>
            <td>${Number(l.quantity) || 0}${l.uom ? ' ' + esc(l.uom) : ''}${l.uom && Number(l.uom_conversion) !== 1 ? ` <span style="color:var(--text-secondary);font-size:.78rem;">(× ${Number(l.uom_conversion)})</span>` : ''}</td>
            <td>${l.unit_price != null ? AccountsCommon.formatCurrency(l.unit_price) : '—'}</td>
            <td></td>
        </tr>`).join('');
        const banner = document.getElementById('challanStatusBanner');
        banner.style.display = '';
        banner.innerHTML = `<div style="background:var(--bg-card-hover);border:1px solid var(--border-color);border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:.85rem;">
            Status: ${AccountsCommon.statusBadge(ch.status)}${ch.status === 'invoiced' && ch.converted_invoice_id ? ' — this challan has been billed; find the invoice on the Invoices tab.' : ''}
            ${ch.status === 'issued' ? ' — goods are out on this challan; convert it to an invoice to bill and deduct stock.' : ''}
            ${ch.status === 'draft' ? ' — drafts are editable paperwork; issue to assign the serial challan number.' : ''}</div>`;
        _setChallanReadOnly(true, ch);
        AccountsCommon.showFormPage('challanModal');
    } catch (err) {
        Toast.error('Failed to load challan');
    }
}

function _setChallanReadOnly(readOnly, ch = null) {
    const modal = document.getElementById('challanModal');
    modal.querySelectorAll('input').forEach(el => { if (el.type !== 'hidden') el.disabled = readOnly; });
    // SearchableDropdowns have no disable API — kill pointer events (invoice-modal pattern).
    modal.querySelectorAll('.searchable-dropdown-container').forEach(el => {
        el.style.pointerEvents = readOnly ? 'none' : '';
        el.style.opacity = readOnly ? '0.7' : '';
    });
    document.getElementById('challanAddLineBtn').style.display = readOnly ? 'none' : '';
    const footer = document.getElementById('challanModalFooter');
    if (!readOnly) {
        footer.innerHTML = `<button class="btn btn-outline" onclick="AccountsCommon.hideFormPage('challanModal')">Cancel</button>
            <button class="btn btn-primary" id="challanSaveBtn" onclick="saveChallan()">Save Draft</button>`;
        return;
    }
    const acts = [`<button class="btn btn-outline" onclick="AccountsCommon.hideFormPage('challanModal')">Close</button>`];
    if (ch?.status === 'draft') {
        acts.push(`<button class="btn btn-danger" onclick="AccountsCommon.hideFormPage('challanModal');deleteChallan('${ch.id}')" data-admin-only>Delete</button>`);
        acts.push(`<button class="btn btn-primary" onclick="AccountsCommon.hideFormPage('challanModal');issueChallan('${ch.id}')" data-admin-only>Issue Challan</button>`);
    } else if (ch?.status === 'issued') {
        acts.push(`<button class="btn btn-danger" onclick="AccountsCommon.hideFormPage('challanModal');cancelChallan('${ch.id}')" data-admin-only>Cancel Challan</button>`);
        acts.push(`<button class="btn btn-primary" onclick="AccountsCommon.hideFormPage('challanModal');convertChallan('${ch.id}')" data-admin-only>Convert to Invoice</button>`);
    }
    footer.innerHTML = acts.join('');
    accountsRoles.applyRBAC();
}

// ── Lifecycle actions ───────────────────────────────────────────────────────

async function issueChallan(id) {
    try {
        const ch = await api.request(AccountsCommon.buildUrl(`delivery-challans/${id}/issue`), { method: 'POST' });
        Toast.success(`Challan ${ch.challan_number} issued — goods can move with this number`);
        loadChallans();
    } catch (err) { Toast.error(err?.message || 'Failed to issue challan'); }
}

async function convertChallan(id) {
    const ok = await Confirm.show({
        title: 'Convert to invoice?',
        message: 'This creates a DRAFT invoice from the challan lines. Stock and the ledger move only when you approve that invoice.',
        confirmText: 'Convert'
    });
    if (!ok) return;
    try {
        const inv = await api.request(AccountsCommon.buildUrl(`delivery-challans/${id}/convert-to-invoice`), { method: 'POST' });
        Toast.success(`Draft invoice created from the challan — review and approve it on the Invoices tab`);
        loadChallans();
    } catch (err) { Toast.error(err?.message || 'Failed to convert challan'); }
}

async function cancelChallan(id) {
    const ok = await Confirm.show({
        title: 'Cancel this challan?',
        message: 'Use this when the goods came back (or the challan was raised in error). An invoiced challan cannot be cancelled.',
        confirmText: 'Cancel Challan', type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`delivery-challans/${id}/cancel`), { method: 'POST' });
        Toast.success('Challan cancelled');
        loadChallans();
    } catch (err) { Toast.error(err?.message || 'Failed to cancel challan'); }
}

async function deleteChallan(id) {
    const ok = await Confirm.show({
        title: 'Delete this draft?',
        message: 'Draft challans have no number and no stock effect — deleting is safe.',
        confirmText: 'Delete', type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl('delivery-challans/' + id), { method: 'DELETE' });
        Toast.success('Draft challan deleted');
        loadChallans();
    } catch (err) { Toast.error(err?.message || 'Failed to delete challan'); }
}
