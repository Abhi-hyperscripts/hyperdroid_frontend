/**
 * AccountsService — Proforma Invoices Page
 *
 * Handles 9 backend endpoints for proforma invoice lifecycle:
 *   1. GET    /proforma-invoices          — list with stats
 *   2. GET    /proforma-invoices/{id}     — single with lines
 *   3. POST   /proforma-invoices          — create draft
 *   4. PUT    /proforma-invoices/{id}     — update draft
 *   5. DELETE /proforma-invoices/{id}     — delete draft
 *   6. POST   /proforma-invoices/{id}/send            — mark sent
 *   7. POST   /proforma-invoices/{id}/accept           — accept
 *   8. POST   /proforma-invoices/{id}/reject           — reject
 *   9. POST   /proforma-invoices/{id}/convert-to-invoice — convert to invoice
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let customers = [];
let accounts = [];
let taxConfigs = [];

// Module-scoped cache so row-action handlers can look up full entity by id
let proformaInvoices = [];

let proformaPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let proformaCustomerFilterDD = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('proforma-invoices', '../')) return;

    const tabNames = {
        'proforma-list': 'Proforma Invoices'
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
        case 'proforma-list': loadProformaInvoices(); break;
    }
}

// ============================================================================
// INITIAL DATA
// ============================================================================

async function loadInitialData() {
    try {
        const [custRes, acctRes, taxRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa', { isActive: true }), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('tax/configurations'), { _skipSpinner: true }).catch(() => [])
        ]);
        customers = Array.isArray(custRes) ? custRes : (custRes?.data || custRes?.items || []);
        accounts = Array.isArray(acctRes) ? acctRes : (acctRes?.data || acctRes?.items || []);
        taxConfigs = Array.isArray(taxRes) ? taxRes : (taxRes?.data || taxRes?.items || []);

        populateSelect('proformaCustomerId', customers, 'id', 'name', 'Select customer...');

        loadProformaInvoices();
    } catch (err) {
        console.error('[Proforma] loadInitialData error:', err);
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
    document.getElementById('proformaSearch')?.addEventListener('input', debounce(() => { proformaPage = 1; loadProformaInvoices(); }));
    document.getElementById('proformaStatusFilter')?.addEventListener('change', () => { proformaPage = 1; loadProformaInvoices(); });
}

function initDatePickers() {
    if (typeof flatpickr !== 'function') {
        setTimeout(initDatePickers, 300);
        return;
    }
    const opts = { dateFormat: 'Y-m-d', allowInput: true };
    flatpickr('#proformaDateFrom', { ...opts, onChange: () => { proformaPage = 1; loadProformaInvoices(); } });
    flatpickr('#proformaDateTo', { ...opts, onChange: () => { proformaPage = 1; loadProformaInvoices(); } });
    flatpickr('#proformaDate', opts);
    flatpickr('#proformaValidUntil', opts);
}

// ============================================================================
// DROPDOWNS
// ============================================================================

function initDropdowns() {
    const custOpts = customers.map(c => ({ value: c.id, label: c.name }));

    proformaCustomerFilterDD = new SearchableDropdown(document.getElementById('proformaCustomerFilterContainer'), {
        id: 'proformaCustomerFilter', options: custOpts, placeholder: 'All Customers',
        searchPlaceholder: 'Search customers...', compact: true,
        onChange: () => { proformaPage = 1; loadProformaInvoices(); }
    });
}

// ============================================================================
// PROFORMA INVOICES — LIST
// ============================================================================

async function loadProformaInvoices() {
    const params = { limit: PAGE_SIZE, offset: (proformaPage - 1) * PAGE_SIZE };
    const customerId = proformaCustomerFilterDD?.getValue?.();
    const status = document.getElementById('proformaStatusFilter')?.value;
    const dateFrom = document.getElementById('proformaDateFrom')?.value;
    const dateTo = document.getElementById('proformaDateTo')?.value;
    const search = document.getElementById('proformaSearch')?.value?.trim();

    if (customerId) params.customerId = customerId;
    if (status) params.status = status;
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;
    if (search) params.search = search;

    try {
        const res = await api.request(AccountsCommon.buildUrl('proforma-invoices', params));
        const items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        proformaInvoices = items;  // cache for row action handlers
        // Backend total is the FILTERED count — ?? (not ||) so a legitimate 0 sticks
        const total = res?.total ?? items.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        // Clamp if actioning the last row on a page left us past the end (else an empty "No … found").
        if (proformaPage > totalPages) { proformaPage = totalPages; return loadProformaInvoices(); }

        // Stats — prefer backend stats, fallback to client-side
        const stats = res?.stats || {};
        setText('totalProformas', stats.total_count ?? total);
        setText('draftProformas', stats.draft_count ?? items.filter(i => i.status === 'draft').length);
        setText('sentProformas', stats.sent_count ?? items.filter(i => i.status === 'sent').length);
        setText('acceptedProformas', stats.accepted_count ?? items.filter(i => i.status === 'accepted').length);
        setText('totalProformaValue', stats.total_value != null ? AccountsCommon.formatCurrency(stats.total_value) : AccountsCommon.formatCurrency(items.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0)));

        const tbody = document.getElementById('proformaInvoicesTable');
        if (!items.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No proforma invoices found</p></div></td></tr>';
        } else {
            tbody.innerHTML = items.map(pi => {
                const custName = pi.customer_name || customers.find(c => c.id === pi.customer_id)?.name || '-';
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(pi.proforma_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}</td>
                    <td>${AccountsCommon.formatDate(pi.proforma_date)}</td>
                    <td>${AccountsCommon.formatDate(pi.valid_until)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(pi.total_amount)}</td>
                    <td>${AccountsCommon.statusBadge(pi.status)}</td>
                    <td class="actions-cell">${proformaActions(pi)}</td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('proformasPagination', proformaPage, totalPages, p => { proformaPage = p; loadProformaInvoices(); });
    } catch (err) {
        console.error('[Proforma] loadProformaInvoices error:', err);
        Toast.error('Failed to load proforma invoices');
    }
}

// ============================================================================
// ROW ACTIONS (status-dependent)
// ============================================================================

function proformaActions(pi) {
    const s = (pi.status || '').toLowerCase();

    // View is always available
    let html = `<button class="btn-icon" data-tooltip="View" onclick="viewProforma('${pi.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;

    // Mutating actions require admin (MANAGE_CUSTOMERS)
    if (!accountsRoles.isAdmin()) {
        return html;
    }

    if (s === 'draft') {
        html += ` <button class="btn-icon" data-tooltip="Edit" onclick="editProforma('${pi.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
        html += ` <button class="btn-icon" data-tooltip="Send" onclick="sendProforma('${pi.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Delete" onclick="deleteProforma('${pi.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    }

    if (s === 'sent') {
        html += ` <button class="btn-icon" data-tooltip="Accept" onclick="acceptProforma('${pi.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Reject" onclick="rejectProforma('${pi.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    }

    if (s === 'accepted') {
        html += ` <button class="btn-icon" data-tooltip="Convert to Invoice" onclick="convertToInvoice('${pi.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>`;
    }

    return html;
}

// ============================================================================
// VIEW PROFORMA (read-only detail modal)
// ============================================================================

async function viewProforma(id) {
    try {
        const pi = await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}`));
        const esc = AccountsCommon.escapeHtml;
        const fmt = AccountsCommon.formatCurrency;
        const fmtD = AccountsCommon.formatDate;

        document.getElementById('proformaViewTitle').textContent = `Proforma ${esc(pi.proforma_number || '')}`;

        const custName = pi.customer_name || customers.find(c => c.id === pi.customer_id)?.name || '-';
        const lines = pi.lines || [];

        // Per-line display uses the STORED tax_rate captured at save time,
        // falling back to the config lookup only for legacy lines without one.
        // Totals always come from the document's stored amounts — historical
        // docs must show their own totals, never a live recompute against
        // current tax-config rates.
        const lineRows = lines.map(l => {
            const cfg = taxConfigs.find(t => t.id === l.tax_config_id);
            const lineAmt = Number(l.amount) || 0;
            const lineTax = Number(l.tax_amount) || 0; // stored per-line tax; never recompute from current rates
            const taxLabel = cfg ? `${cfg.name || 'Tax'}${lineTax ? ' ' + fmt(lineTax) : ''}` : (lineTax ? fmt(lineTax) : '—');
            return `<tr>
                <td>${esc(l.description || '-')}</td>
                <td>${esc(l.account_code ? l.account_code + ' — ' + (l.account_name || '') : (l.account_name || '-'))}</td>
                <td>${l.quantity}</td>
                <td class="text-right">${fmt(l.unit_price)}</td>
                <td>${esc(taxLabel)}</td>
                <td class="text-right">${fmt(lineAmt + lineTax)}</td>
            </tr>`;
        }).join('');

        let linesHtml = '';
        if (lines.length) {
            linesHtml = `<div class="data-table-container" style="margin-top: 1rem;">
                <table class="data-table">
                    <thead><tr><th>Description</th><th>Account</th><th style="width:80px;">Qty</th><th style="width:100px;">Unit Price</th><th style="width:140px;">Tax</th><th style="width:110px;">Amount</th></tr></thead>
                    <tbody>${lineRows}</tbody>
                </table>
            </div>`;
        }
        const displayTax = Number(pi.tax_amount || 0);
        const displayTotal = Number(pi.total_amount || 0);

        let convertedHtml = '';
        if (pi.converted_invoice_id) {
            convertedHtml = `<div style="display:flex;justify-content:space-between;padding:0.4rem 0;color:var(--text-secondary);">
                <span>Converted Invoice:</span>
                <span>${esc(pi.converted_invoice_number || pi.converted_invoice_id)}</span>
            </div>`;
        }

        document.getElementById('proformaViewBody').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Customer</div>
                    <div style="font-weight:500;">${esc(custName)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Status</div>
                    <div>${AccountsCommon.statusBadge(pi.status)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Proforma Date</div>
                    <div>${fmtD(pi.proforma_date)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Valid Until</div>
                    <div>${fmtD(pi.valid_until)}</div>
                </div>
            </div>
            ${pi.notes ? `<div style="margin-top:1rem;color:var(--text-secondary);font-size:0.9rem;"><strong>Notes:</strong> ${esc(pi.notes)}</div>` : ''}
            ${linesHtml}
            <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
                <div style="min-width:250px;">
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;color:var(--text-secondary);">
                        <span>Subtotal:</span><span>${fmt(pi.subtotal)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;color:var(--text-secondary);">
                        <span>Tax:</span><span>${fmt(displayTax)}</span>
                    </div>
                    ${pi.discount_amount ? `<div style="display:flex;justify-content:space-between;padding:0.4rem 0;color:var(--text-secondary);">
                        <span>Discount:</span><span>-${fmt(pi.discount_amount)}</span>
                    </div>` : ''}
                    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;font-weight:600;border-top:1px solid var(--border-primary);color:var(--text-primary);">
                        <span>Total:</span><span>${fmt(displayTotal)}</span>
                    </div>
                    ${convertedHtml}
                </div>
            </div>`;

        AccountsCommon.openModal('proformaViewModal');
    } catch (err) {
        Toast.error('Failed to load proforma invoice');
    }
}

// ============================================================================
// PROFORMA MODAL — CREATE / EDIT
// ============================================================================

function showCreateProformaModal() {
    document.getElementById('proformaModalTitle').textContent = 'Create Proforma Invoice';
    document.getElementById('proformaForm').reset();
    document.getElementById('proformaId').value = '';
    document.getElementById('proformaLines').innerHTML = '';
    addProformaLine();
    calculateProformaTotals();
    AccountsCommon.openModal('proformaInvoiceModal');
}

async function editProforma(id) {
    try {
        const pi = await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}`));
        document.getElementById('proformaModalTitle').textContent = `Edit Proforma ${pi.proforma_number || ''}`;
        document.getElementById('proformaId').value = pi.id;
        const proformaCustSel = document.getElementById('proformaCustomerId');
        proformaCustSel.value = pi.customer_id || '';
        proformaCustSel.dispatchEvent(new Event('change')); // re-sync the SearchableDropdown label on repeat edits
        document.getElementById('proformaDate').value = pi.proforma_date?.split('T')[0] || '';
        document.getElementById('proformaValidUntil').value = pi.valid_until?.split('T')[0] || '';
        // Legacy header-level tax select — no longer in the markup (tax is
        // per-line now) and the backend doesn't emit tax_configuration_id,
        // so only set it when both exist to avoid breaking the edit modal.
        const taxSel = document.getElementById('proformaTaxConfigId');
        if (taxSel && pi.tax_configuration_id) taxSel.value = pi.tax_configuration_id;
        document.getElementById('proformaNotes').value = pi.notes || '';

        const lines = pi.lines || [];
        const tbody = document.getElementById('proformaLines');
        tbody.innerHTML = '';
        if (lines.length) {
            lines.forEach(l => addProformaLine(l));
        } else {
            addProformaLine();
        }
        calculateProformaTotals();
        AccountsCommon.openModal('proformaInvoiceModal');
    } catch (err) {
        Toast.error('Failed to load proforma invoice');
    }
}

// ============================================================================
// LINE ITEMS
// ============================================================================

function addProformaLine(data = {}) {
    const tbody = document.getElementById('proformaLines');
    const row = document.createElement('tr');
    const acctOptions = accounts.map(a => {
        const code = a.account_code || a.code || '';
        const name = a.account_name || a.name || '';
        const label = code && name ? `${code} — ${name}` : (name || code);
        return `<option value="${a.id}" ${a.id === data.account_id ? 'selected' : ''}>${AccountsCommon.escapeHtml(label)}</option>`;
    }).join('');

    // Same column order as PO / Invoice / Bill
    row.innerHTML = `
        <td><select class="form-control line-account" data-no-sd="true"><option value="">Select...</option>${acctOptions}</select><div class="searchable-dropdown-container line-account-sd"></div></td>
        <td><input type="text" class="form-control line-desc" value="${AccountsCommon.escapeHtml(data.description || '')}" placeholder="Description"></td>
        <td><input type="number" class="form-control line-qty" value="${data.quantity ?? 1}" min="0" step="any" oninput="calculateProformaTotals()"></td>
        <td><input type="number" class="form-control line-rate" value="${data.unit_price || ''}" min="0" step="0.01" placeholder="0.00" oninput="calculateProformaTotals()"></td>
        <td><div class="searchable-dropdown-container line-tax-sd"></div></td>
        <td class="line-amount" style="text-align:right; padding-top:0.7rem;">0.00</td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="removeProformaLine(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);

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
        id: `prof-line-account-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: buildAccountOptions(),
        value: data.account_id || '',
        placeholder: 'Select account...',
        searchPlaceholder: 'Search accounts…',
        compact: true,
        quickAdd: { title: 'Create new account', onClick: (instance) => openProformaQuickAddAccount(instance, buildAccountOptions) },
        onChange: (v) => { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    row._lineAccountDropdown = accDd;

    const taxOptions = [
        { value: '', label: 'No tax (0%)' },
        ...taxConfigs.map(t => ({ value: t.id, label: `${t.name || t.tax_type || 'Tax'} (${_proformaTaxRateFor(t.id)}%)` }))
    ];
    const initialTaxId = data.tax_config_id !== undefined ? (data.tax_config_id || '') : _proformaDefaultTaxConfigId();
    const taxDd = new SearchableDropdown(row.querySelector('.line-tax-sd'), {
        id: `prof-line-tax-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: taxOptions,
        value: initialTaxId,
        placeholder: 'No tax',
        searchPlaceholder: 'Search tax…',
        compact: true,
        onChange: () => calculateProformaTotals()
    });
    row._lineTaxDropdown = taxDd;

    calculateProformaTotals();
}

function _proformaTaxRateFor(configId) {
    const cfg = taxConfigs.find(t => t.id === configId);
    if (!cfg) return 0;
    // Backend TaxConfiguration nests the rate at configuration.total_rate (the list
    // endpoint doesn't populate rates[]); older/flat keys kept as fallbacks.
    const r = Number(cfg.configuration?.total_rate ?? cfg.total_rate ?? cfg.rate ?? cfg.tax_rate ?? 0);
    if (r) return r;
    if (Array.isArray(cfg.rates)) return cfg.rates.reduce((s, x) => s + Number(x.rate ?? x.rate_percentage ?? 0), 0);
    const m = (cfg.name || '').match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
}
function _proformaDefaultTaxConfigId() {
    if (!taxConfigs?.length) return '';
    const eighteen = taxConfigs.find(t => /18/.test(t.name || '') || _proformaTaxRateFor(t.id) === 18);
    return eighteen ? eighteen.id : taxConfigs[0].id;
}

async function openProformaQuickAddAccount(dropdownInstance, rebuildOptions) {
    let m = document.getElementById('profQuickAddAccountModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'profQuickAddAccountModal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="max-width: 520px;">
                    <div class="modal-header">
                        <h5 class="modal-title">Quick Add Account</h5>
                        <button class="close-btn" onclick="AccountsCommon.closeModal('profQuickAddAccountModal')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                    <div class="modal-body">
                        <div class="form-row two-col">
                            <div class="form-group"><label for="profQaCode">Code *</label><input type="text" id="profQaCode" class="form-control" required></div>
                            <div class="form-group"><label for="profQaName">Name *</label><input type="text" id="profQaName" class="form-control" required></div>
                        </div>
                        <div class="form-row">
                            <div class="form-group"><label for="profQaType">Account Type *</label><div class="searchable-dropdown-container" id="profQaTypeContainer"></div></div>
                        </div>
                        <div id="profQaError" hidden style="margin-top:0.5rem; padding:0.5rem 0.75rem; border-radius:6px; background: color-mix(in srgb, var(--color-error, #c33) 12%, var(--bg-card-hover)); color: var(--color-error, #c33); font-size: 0.85rem;"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="AccountsCommon.closeModal('profQuickAddAccountModal')">Cancel</button>
                        <button class="btn btn-primary" id="profQaSaveBtn">Save</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);
    }
    document.getElementById('profQaCode').value = '';
    document.getElementById('profQaName').value = '';
    document.getElementById('profQaError').hidden = true;
    const typeContainer = document.getElementById('profQaTypeContainer');
    typeContainer.innerHTML = '';
    let types = [];
    try { const tr = await api.request(AccountsCommon.buildUrl('coa/types'), { _skipSpinner: true }); types = Array.isArray(tr) ? tr : (tr?.data || []); } catch {}
    const typeDd = new SearchableDropdown(typeContainer, {
        id: 'profQaType-sd',
        options: [{ value: '', label: '— select —' }, ...types.map(t => ({ value: t.id, label: t.name }))],
        value: '', placeholder: '— select —', compact: false
    });

    AccountsCommon.openModal('profQuickAddAccountModal');
    setTimeout(() => document.getElementById('profQaCode').focus(), 100);

    document.getElementById('profQaSaveBtn').onclick = async () => {
        const code = document.getElementById('profQaCode').value.trim();
        const name = document.getElementById('profQaName').value.trim();
        const typeId = typeDd.selectedValue;
        const errEl = document.getElementById('profQaError');
        errEl.hidden = true;
        if (!code || !name || !typeId) { errEl.textContent = 'Code, Name, and Account Type are required.'; errEl.hidden = false; return; }
        if (!AccountsCommon.beginSubmit('pfQuickAddAccount')) return;
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
            document.querySelectorAll('#proformaLines tr').forEach(r => {
                const other = r._lineAccountDropdown;
                if (other && other !== dropdownInstance) other.refreshOptions(rebuildOptions(), other.selectedValue);
            });
            Toast.success(`Account ${code} created and selected.`);
            AccountsCommon.closeModal('profQuickAddAccountModal');
        } catch (err) { errEl.textContent = err?.message || 'Failed to create account.'; errEl.hidden = false; }
        finally { AccountsCommon.endSubmit('pfQuickAddAccount'); }
    };
}

function removeProformaLine(btn) {
    btn.closest('tr').remove();
    calculateProformaTotals();
}

function calculateProformaTotals() {
    let subtotal = 0;
    let totalTax = 0;
    document.querySelectorAll('#proformaLines tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const amt = qty * rate;
        subtotal += amt;

        const taxConfigId = row._lineTaxDropdown?.selectedValue || '';
        const taxPct = _proformaTaxRateFor(taxConfigId);
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
    setText('proformaSubtotal', subtotal.toFixed(2));
    setText('proformaTax', totalTax.toFixed(2));
    // The proforma stores/prints the pre-tax subtotal (GST is authoritatively added when it converts to
    // an invoice), so the Proforma Total must equal the subtotal — matching the saved + detail-view figures.
    setText('proformaTotal', subtotal.toFixed(2));
}

// ============================================================================
// SAVE PROFORMA (CREATE / UPDATE)
// ============================================================================

async function saveProforma() {
    const form = document.getElementById('proformaForm');
    // The customer <select> is hidden (converted to a SearchableDropdown) but keeps `required`, so
    // reportValidity() fails silently on it with no anchorable bubble. Guard explicitly with a Toast.
    if (!document.getElementById('proformaCustomerId').value) { Toast.error('Please select a customer'); return; }
    if (!form.reportValidity()) return;

    // Skip fully blank rows and require an account on any non-empty row —
    // backend line account_id is a non-nullable Guid (null → 400).
    const lines = [];
    let lineError = null;
    document.querySelectorAll('#proformaLines tr').forEach((row, idx) => {
        const account_id = row.querySelector('.line-account')?.value || null;
        const description = (row.querySelector('.line-desc')?.value || '').trim();
        const quantity = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const unit_price = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const taxConfigId = row._lineTaxDropdown?.selectedValue || null;
        const taxRate = _proformaTaxRateFor(taxConfigId);

        const isBlank = !account_id && !description && !(quantity * unit_price > 0);
        if (isBlank) return;
        if (!account_id) { lineError = lineError || `Line ${idx + 1}: please select an account`; return; }
        lines.push({
            description,
            account_id,
            quantity,
            unit_price,
            tax_config_id: taxConfigId,
            tax_rate: taxRate || 0
        });
    });
    if (lineError) { Toast.error(lineError); return; }
    if (!lines.length) { Toast.error('Add at least one line item with an account'); return; }

    // tax_configuration_id was previously a single header-level field —
    // keeping a no-op default so the existing backend still parses, but tax
    // is now per-line via the lines[*].tax_config_id field above.
    const payload = {
        customer_id: document.getElementById('proformaCustomerId').value,
        proforma_date: document.getElementById('proformaDate').value,
        valid_until: document.getElementById('proformaValidUntil').value,
        notes: document.getElementById('proformaNotes').value,
        tax_configuration_id: null,
        lines
    };

    const id = document.getElementById('proformaId').value;
    if (!AccountsCommon.beginSubmit('saveProforma')) return;
    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}`), { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            Toast.success('Proforma invoice updated');
        } else {
            await api.request(AccountsCommon.buildUrl('proforma-invoices'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            Toast.success('Proforma invoice saved as draft');
        }
        AccountsCommon.closeModal('proformaInvoiceModal');
        loadProformaInvoices();
    } catch (err) {
        Toast.error(err.message || 'Failed to save proforma invoice');
    } finally {
        AccountsCommon.endSubmit('saveProforma');
    }
}

// ============================================================================
// STATUS LIFECYCLE ACTIONS
// ============================================================================

function _proformaLabel(id) {
    const pi = proformaInvoices.find(x => x.id === id);
    if (!pi) return { label: 'this proforma invoice', piNo: '', customerName: '' };
    const fmt = AccountsCommon.formatCurrency;
    const piNo = pi.proforma_number || '';
    const customerName = pi.customer_name || customers?.find(c => c.id === pi.customer_id)?.name || 'the customer';
    const amount = pi.total_amount != null ? fmt(pi.total_amount) : '';
    const dateStr = pi.proforma_date ? new Date(pi.proforma_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const label = `${piNo ? piNo + ' ' : ''}for ${customerName}${amount ? ' totalling ' + amount : ''}${dateStr ? ' dated ' + dateStr : ''}`;
    return { label, piNo, customerName };
}

async function sendProforma(id) {
    const { label } = _proformaLabel(id);
    const ok = await Confirm.show({
        title: 'Send Proforma Invoice',
        message: `Mark ${label} as sent to the customer? This updates the status from Draft to Sent. The customer can then accept or reject the estimate. Use this after you have actually emailed or delivered the proforma.`,
        confirmText: 'Mark as Sent',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}/send`), { method: 'POST' });
        Toast.success('Proforma invoice marked as sent');
        loadProformaInvoices();
    } catch (err) { Toast.error(err.message || 'Failed to send proforma invoice'); }
}

async function acceptProforma(id) {
    const { label } = _proformaLabel(id);
    const ok = await Confirm.show({
        title: 'Accept Proforma Invoice',
        message: `Accept ${label}? The proforma will move from Sent to Accepted and become eligible for conversion to a customer invoice. This records the customer's acceptance of the estimate.`,
        confirmText: 'Accept',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}/accept`), { method: 'POST' });
        Toast.success('Proforma invoice accepted');
        loadProformaInvoices();
    } catch (err) {
        Toast.error(err.message || 'Failed to accept proforma invoice');
        // Accepting a past-valid_until proforma flips it to 'expired' server-side before erroring,
        // so refresh to show the new status instead of a stale 'sent'/Accept row.
        loadProformaInvoices();
    }
}

async function rejectProforma(id) {
    const { label } = _proformaLabel(id);
    const ok = await Confirm.show({
        title: 'Reject Proforma Invoice',
        message: `Reject ${label}? The proforma will move to Rejected status. No financial impact. You can create a new proforma for the customer if needed.`,
        confirmText: 'Reject',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}/reject`), { method: 'POST' });
        Toast.success('Proforma invoice rejected');
        loadProformaInvoices();
    } catch (err) { Toast.error(err.message || 'Failed to reject proforma invoice'); }
}

async function convertToInvoice(id) {
    const { label } = _proformaLabel(id);
    const ok = await Confirm.show({
        title: 'Convert to Customer Invoice',
        message: `Convert ${label} to a customer invoice? This will create a new invoice with the same line items and mark the proforma as Invoiced. The new invoice will start as a Draft and can then be approved and sent. This cannot be undone.`,
        confirmText: 'Convert to Invoice',
        type: 'info'
    });
    if (!ok) return;
    try {
        const result = await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}/convert-to-invoice`), { method: 'POST' });
        const invoiceNo = result?.invoice_number || result?.id || '';
        Toast.success(`Proforma converted to invoice${invoiceNo ? ' ' + invoiceNo : ''}`);
        // Navigate to receivables page so user can see the new invoice
        window.location.href = 'receivables.html';
    } catch (err) { Toast.error(err.message || 'Failed to convert to invoice'); }
}

async function deleteProforma(id) {
    const { label } = _proformaLabel(id);
    const ok = await Confirm.show({
        title: 'Delete Proforma Invoice',
        message: `Delete ${label}? Only draft proforma invoices can be deleted. This cannot be undone.`,
        confirmText: 'Delete',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}`), { method: 'DELETE' });
        Toast.success('Proforma invoice deleted');
        loadProformaInvoices();
    } catch (err) { Toast.error(err.message || 'Failed to delete proforma invoice'); }
}

// ============================================================================
// HELPERS
// ============================================================================

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}
