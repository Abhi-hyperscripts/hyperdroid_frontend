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
// The customer's contracted rates for THIS quote. Declared with the other module state rather than
// beside loadProformaPriceList further down: `let` is hoisted but sits in the temporal dead zone
// until its line runs, and setProformaBillTo (defined ~22k chars earlier) now reads them. Every
// current caller is inside a handler, so evaluation finishes first — but a future top-level call
// would throw a ReferenceError, and there is no reason to leave that trap armed.
let proformaPriceMap = new Map();
let proformaPriceListName = '';

// Module-scoped cache so row-action handlers can look up full entity by id
let proformaInvoices = [];

let proformaPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let proformaCustomerFilterDD = null;
let proformaCfController = null;   // custom-fields section controller for the open proforma form

// Render the proforma's Custom Fields section (create → empty; edit → prefilled from stored values).
async function renderProformaCustomFields(proformaId) {
    const host = document.getElementById('proformaCustomFields');
    if (!host) return;
    const defs = await AccountsCommon.getCustomFieldDefs('proforma_invoice');
    const values = proformaId ? await AccountsCommon.loadCustomFieldValues('proforma_invoice', proformaId) : {};
    proformaCfController = AccountsCommon.renderCustomFieldsSection(host, defs, values);
}

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
    // The customer decides which rates a picked item pre-fills. The SearchableDropdown writes
    // through to this native select and dispatches 'change', and the edit path fires the same
    // event — so one listener covers picking a customer, changing it, and loading a saved quote.
    document.getElementById('proformaCustomerId')?.addEventListener('change', () => { loadProformaPriceList(); });
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

// Pipeline charts — proforma value by status + top customers by quoted value. Uses the shared
// accounts-charts.js helpers; pulls the full matching set so it isn't limited to one page.
const _PF_STATUS_COLOR = { draft: '#64748b', sent: '#3b82f6', accepted: '#10b981', rejected: '#ef4444', invoiced: '#06b6d4', expired: '#f59e0b' };
async function renderProformaCharts(baseParams) {
    try {
        const res = await api.request(AccountsCommon.buildUrl('proforma-invoices', { ...baseParams, limit: 1000, offset: 0 }), { _skipSpinner: true });
        const all = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const byStatus = {};
        all.forEach(pi => { const amt = parseFloat(pi.total_amount || 0); if (amt > 0) { const s = pi.status || 'draft'; byStatus[s] = (byStatus[s] || 0) + amt; } });
        const st = Object.keys(byStatus);
        acDonut('pfStatusChart', st.map(s => s.replace(/_/g, ' ')), st.map(s => Math.round(byStatus[s] * 100) / 100), st.map(s => _PF_STATUS_COLOR[s] || '#64748b'));
        const rank = _acRank(all.map(pi => ({ name: _proformaPartyName(pi) || '—', amt: parseFloat(pi.total_amount || 0) })), 'name', 'amt', 6);
        acBarH('pfCustomerChart', rank.labels, rank.data);
    } catch (e) { _acEmpty('pfStatusChart'); _acEmpty('pfCustomerChart'); }
}

// The party a proforma is billed to: the linked customer's name, else the ad-hoc recipient (prospect) name.
function _proformaPartyName(pi) {
    return pi.customer_name || customers.find(c => c.id === pi.customer_id)?.name || pi.recipient_name || '';
}

// Audience tab: '' (All), 'customer' (issued to an existing client), 'prospect' (ad-hoc recipient).
let _proformaAudience = '';
function setProformaAudience(a) {
    _proformaAudience = (a === 'customer' || a === 'prospect') ? a : '';
    document.querySelectorAll('#proformaAudienceTabs .acc-tab').forEach(t =>
        t.classList.toggle('active', (t.dataset.audience || '') === _proformaAudience));
    proformaPage = 1;
    loadProformaInvoices();
}

async function loadProformaInvoices() {
    const customerId = proformaCustomerFilterDD?.getValue?.();
    const status = document.getElementById('proformaStatusFilter')?.value;
    const dateFrom = document.getElementById('proformaDateFrom')?.value;
    const dateTo = document.getElementById('proformaDateTo')?.value;
    const search = document.getElementById('proformaSearch')?.value?.trim();
    const searching = !!search;

    // The backend proforma-invoices list has NO `search` param (it only binds customerId/status/dates/
    // limit/offset). When searching, fetch a broad page and filter + paginate client-side (mirrors
    // receivables.js) so the box actually filters instead of silently returning the full list.
    const params = searching
        ? { limit: 1000, offset: 0 }
        : { limit: PAGE_SIZE, offset: (proformaPage - 1) * PAGE_SIZE };
    if (customerId) params.customerId = customerId;
    if (status) params.status = status;
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;
    if (_proformaAudience) params.audience = _proformaAudience;

    try {
        const res = await api.request(AccountsCommon.buildUrl('proforma-invoices', params));
        let items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        proformaInvoices = items;  // cache for row action handlers

        // Charts read the full matching set (customer + date; ignore status so the pipeline split shows).
        const _pfChartParams = { ...(customerId ? { customerId } : {}), ...(dateFrom ? { fromDate: dateFrom } : {}), ...(dateTo ? { toDate: dateTo } : {}) };
        renderProformaCharts(_pfChartParams);
        _acActiveRender = () => renderProformaCharts(_pfChartParams);

        let total, totalPages;
        if (searching) {
            const q = search.toLowerCase();
            const filtered = items.filter(pi => {
                const custName = _proformaPartyName(pi);
                return `${pi.proforma_number || ''} ${custName}`.toLowerCase().includes(q);
            });
            total = filtered.length;
            totalPages = Math.ceil(total / PAGE_SIZE) || 1;
            if (proformaPage > totalPages) proformaPage = totalPages;
            items = filtered.slice((proformaPage - 1) * PAGE_SIZE, proformaPage * PAGE_SIZE);
        } else {
            // Backend total is the FILTERED count — ?? (not ||) so a legitimate 0 sticks
            total = res?.total ?? items.length;
            totalPages = Math.ceil(total / PAGE_SIZE) || 1;
            // Clamp if actioning the last row on a page left us past the end (else an empty "No … found").
            if (proformaPage > totalPages) { proformaPage = totalPages; return loadProformaInvoices(); }
        }

        // Stats — prefer backend stats, fallback to client-side
        const stats = res?.stats || {};
        setText('totalProformas', stats.total_count ?? total);
        setText('draftProformas', stats.draft_count ?? items.filter(i => i.status === 'draft').length);
        setText('sentProformas', stats.sent_count ?? items.filter(i => i.status === 'sent').length);
        setText('acceptedProformas', stats.accepted_count ?? items.filter(i => i.status === 'accepted').length);
        setText('totalProformaValue', stats.total_value != null ? AccountsCommon.formatCurrency(stats.total_value) : AccountsCommon.formatCurrency(items.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0)));

        // Audience tab counts (whole-tenant, independent of the active tab — same as the KPI tiles).
        if (stats.customer_count != null || stats.prospect_count != null) {
            setText('pfTabCountAll', stats.total_count ?? '');
            setText('pfTabCountCustomer', stats.customer_count ?? '');
            setText('pfTabCountProspect', stats.prospect_count ?? '');
        }

        const tbody = document.getElementById('proformaInvoicesTable');
        if (!items.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No proforma invoices found</p></div></td></tr>';
        } else {
            tbody.innerHTML = items.map(pi => {
                const custName = _proformaPartyName(pi) || '-';
                // Tag prospect (recipient-only) rows so the user can tell them apart from real customers.
                const partyTag = !pi.customer_id && pi.recipient_name ? ' <span class="acc-pill">Prospect</span>' : '';
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(pi.proforma_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(custName)}${partyTag}</td>
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
    // PDF at EVERY status, deliberately. The edit/send/accept buttons below are status-gated because they
    // change the document; downloading it does not — and a rep most often needs the file for a quote that
    // is already sent, accepted or lapsed (re-sending a copy, or attaching it to a renewal).
    html += ` <button class="btn-icon" data-tooltip="Download PDF" onclick="downloadProformaPdf('${pi.id}', '${AccountsCommon.escapeHtml(pi.proforma_number || '')}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>`;

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
        // Bind rather than interpolate. AccountsCommon.escapeHtml DOES escape both quote characters, so
        // the row button's inline handler is safe — but binding needs no escaping at all, and a listener
        // cannot be broken by whatever a tenant puts in a document number.
        const pdfBtn = document.getElementById('proformaViewPdfBtn');
        if (pdfBtn) pdfBtn.onclick = () => downloadProformaPdf(pi.id, pi.proforma_number || '');

        const custName = _proformaPartyName(pi) || '-';
        const isProspect = !pi.customer_id && pi.recipient_name;
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
            // ⭐ SHOW THE DISCOUNT, OR THE ROW READS AS AN ARITHMETIC ERROR. `amount` is stored NET,
            // so on a discounted line qty x unit_price does NOT equal the Amount beside it — 10 x
            // Rs 1,000 showing Rs 9,000 looks like a bug to the person checking their own quote.
            // The Disc % column is what makes the row add up on screen, exactly as it does on the PDF.
            const discPct = Number(l.discount_percent) || 0;
            return `<tr>
                <td>${esc(l.description || '-')}</td>
                <td>${esc(l.account_code ? l.account_code + ' — ' + (l.account_name || '') : (l.account_name || '-'))}</td>
                <td>${esc(l.hsn_sac || '-')}</td>
                <td>${l.quantity}${l.uom ? ' ' + esc(l.uom) : ''}</td>
                <td class="text-right">${fmt(l.unit_price)}</td>
                <td class="text-right">${discPct > 0 ? discPct + '%' : '-'}</td>
                <td>${esc(taxLabel)}</td>
                <td class="text-right">${fmt(lineAmt + lineTax)}</td>
            </tr>`;
        }).join('');

        let linesHtml = '';
        if (lines.length) {
            linesHtml = `<div class="data-table-container" style="margin-top: 1rem;">
                <table class="data-table">
                    <thead><tr><th>Description</th><th>Account</th><th style="width:90px;">HSN/SAC</th><th style="width:90px;">Qty</th><th style="width:100px;">Unit Price</th><th style="width:70px;">Disc %</th><th style="width:140px;">Tax</th><th style="width:110px;">Amount</th></tr></thead>
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
                    <div style="color:var(--text-secondary);font-size:0.85rem;">${isProspect ? 'Recipient (prospect)' : 'Customer'}</div>
                    <div style="font-weight:500;">${esc(custName)}${isProspect ? ' <span class="acc-pill">Prospect</span>' : ''}</div>
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

// Bill-To mode: 'customer' (existing client) or 'recipient' (ad-hoc prospect). Toggles which fields show
// and which are required. The backend accepts EITHER a customer_id OR a recipient_name.
let _proformaBillTo = 'customer';
function setProformaBillTo(mode) {
    _proformaBillTo = mode === 'recipient' ? 'recipient' : 'customer';
    document.querySelectorAll('#proformaBillToToggle .acc-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === _proformaBillTo));
    const isRecipient = _proformaBillTo === 'recipient';
    const custGroup = document.getElementById('proformaCustomerGroup');
    if (custGroup) custGroup.style.display = isRecipient ? 'none' : '';
    document.querySelectorAll('.proforma-recipient-field').forEach(el => el.style.display = isRecipient ? '' : 'none');
    // ⭐ SWITCHING TO PROSPECT MODE MUST DROP THE CUSTOMER'S CONTRACTED RATES. This only HIDES the
    // customer field — the select keeps its value, and saveProforma sends customer_id = null. Without
    // this, picking Customer A (their price list loads), switching to prospect, then adding a
    // catalogue item priced that prospect's line at A's NEGOTIATED rate: a wrong number on the quote,
    // and one that leaks a confidential contracted price to a third party.
    if (isRecipient) { proformaPriceMap = new Map(); proformaPriceListName = ''; }
    else loadProformaPriceList();
}

// ── Multi-currency (display-layer FX) — mirror of the invoice form ────────────
const BASE_CURRENCY = 'INR';
let currencyList = [];
let proformaCurrencyDropdown = null;

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

function proformaCurrency() { return proformaCurrencyDropdown?.getValue?.() || BASE_CURRENCY; }
function proformaRate() { return parseFloat(document.getElementById('proformaExchangeRate')?.value) || 0; }

async function initProformaCurrencyDropdown(value) {
    const container = document.getElementById('proformaCurrencyContainer');
    if (!container || typeof SearchableDropdown !== 'function') return;
    await loadCurrencyList();
    const opts = currencyList.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }));
    if (proformaCurrencyDropdown?.setOptions) {
        proformaCurrencyDropdown.setOptions(opts, false);
        proformaCurrencyDropdown.setValue?.(value || BASE_CURRENCY);
    } else {
        container.innerHTML = '';
        proformaCurrencyDropdown = new SearchableDropdown(container, {
            id: 'proformaCurrencyDD',
            options: opts,
            value: value || BASE_CURRENCY,
            placeholder: BASE_CURRENCY,
            searchPlaceholder: 'Search currency…',
            compact: true,
            onChange: () => onProformaCurrencyChanged(true)
        });
    }
    onProformaCurrencyChanged(false);
}

async function onProformaCurrencyChanged(autoFetch) {
    const cur = proformaCurrency();
    const group = document.getElementById('proformaRateGroup');
    const hint = document.getElementById('proformaRateHint');
    const rateEl = document.getElementById('proformaExchangeRate');
    if (!group) return;
    if (cur === BASE_CURRENCY) {
        group.style.display = 'none';
        if (rateEl) rateEl.value = '';
        calculateProformaTotals();
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
        infoBtn.onclick = () => AccountsCommon.showFxRateHelp(proformaCurrency(), proformaRate());
        rateLabel.appendChild(infoBtn);
    }
    if (autoFetch) {
        if (hint) hint.textContent = 'Fetching rate…';
        try {
            const date = document.getElementById('proformaDate')?.value || '';
            const res = await api.request(AccountsCommon.buildUrl('currency/rate', { from: cur, to: BASE_CURRENCY, ...(date ? { date } : {}) }), { _skipSpinner: true });
            if (rateEl) rateEl.value = res.rate;
            if (hint) hint.textContent = `1 ${cur} = ₹${res.rate} · ECB reference (${res.effective_date?.split('T')[0] || 'latest'}) — editable`;
        } catch {
            if (hint) hint.textContent = `Couldn't fetch the ${cur} rate — enter it manually (how many ₹ one ${cur} is worth).`;
        }
    }
    calculateProformaTotals();
}

function showCreateProformaModal() {
    document.getElementById('proformaModalTitle').textContent = 'Create Proforma Invoice';
    document.getElementById('proformaForm').reset();
    document.getElementById('proformaId').value = '';
    setProformaBillTo('customer');
    // form.reset() clears the value but doesn't notify the SearchableDropdown, so after an edit the SD
    // label would still show the previous customer while the hidden value is '' (saveProforma then
    // falsely rejects with "Please select a customer"). Dispatch change to re-sync the label.
    const proformaCustSel = document.getElementById('proformaCustomerId');
    proformaCustSel.value = '';
    proformaCustSel.dispatchEvent(new Event('change'));
    document.getElementById('proformaLines').innerHTML = '';
    initProformaCurrencyDropdown(BASE_CURRENCY);
    // Clear any rates left from the last quote opened — a stale map would price a NEW
    // customer's lines at the PREVIOUS customer's contracted rates.
    proformaPriceMap = new Map(); proformaPriceListName = '';
    initProformaItemPicker();
    addProformaLine();
    calculateProformaTotals();
    renderProformaCustomFields(null);
    AccountsCommon.showFormPage('proformaInvoiceModal');
}

async function editProforma(id) {
    try {
        const pi = await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}`));
        document.getElementById('proformaModalTitle').textContent = `Edit Proforma ${pi.proforma_number || ''}`;
        document.getElementById('proformaId').value = pi.id;
        // Recipient-only proforma (no customer) → recipient mode; else existing-customer mode.
        const isRecipient = !pi.customer_id;
        setProformaBillTo(isRecipient ? 'recipient' : 'customer');
        const proformaCustSel = document.getElementById('proformaCustomerId');
        proformaCustSel.value = pi.customer_id || '';
        proformaCustSel.dispatchEvent(new Event('change')); // re-sync the SearchableDropdown label on repeat edits
        document.getElementById('proformaRecipientName').value = pi.recipient_name || '';
        document.getElementById('proformaRecipientEmail').value = pi.recipient_email || '';
        document.getElementById('proformaRecipientPhone').value = pi.recipient_phone || '';
        document.getElementById('proformaRecipientGstin').value = pi.recipient_gstin || '';
        document.getElementById('proformaRecipientAddress').value = pi.recipient_address || '';
        document.getElementById('proformaDate').value = pi.proforma_date?.split('T')[0] || '';
        document.getElementById('proformaValidUntil').value = pi.valid_until?.split('T')[0] || '';
        // Legacy header-level tax select — no longer in the markup (tax is
        // per-line now) and the backend doesn't emit tax_configuration_id,
        // so only set it when both exist to avoid breaking the edit modal.
        const taxSel = document.getElementById('proformaTaxConfigId');
        if (taxSel && pi.tax_configuration_id) taxSel.value = pi.tax_configuration_id;
        document.getElementById('proformaNotes').value = pi.notes || '';

        const lines = pi.lines || [];
        const fxRate = pi.exchange_rate ? parseFloat(pi.exchange_rate) : 0;
        await initProformaCurrencyDropdown(pi.currency || BASE_CURRENCY);
        if (fxRate > 0) {
            document.getElementById('proformaExchangeRate').value = fxRate;
            const rh = document.getElementById('proformaRateHint');
            if (rh) rh.textContent = `1 ${pi.currency} = ₹${fxRate} · rate captured on this quote — editable`;
            lines.forEach(l => {
                const inr = parseFloat(l.unit_price ?? 0);
                l.unit_price = Math.round((inr / fxRate) * 100) / 100;
            });
        }
        const tbody = document.getElementById('proformaLines');
        tbody.innerHTML = '';
        // The picker is needed on the EDIT path too, not just on create — adding a catalogue line
        // to an existing quote is the ordinary way a quote grows during a negotiation.
        initProformaItemPicker();
        if (lines.length) {
            // addProformaLine reads hsn_sac / discount_percent / item_id / uom straight off the API
            // row, so an edited quote round-trips every particular instead of dropping the ones the
            // editor cannot show.
            lines.forEach(l => addProformaLine(l));
        } else {
            addProformaLine();
        }
        calculateProformaTotals();
        await renderProformaCustomFields(pi.id);
        AccountsCommon.showFormPage('proformaInvoiceModal');
    } catch (err) {
        Toast.error('Failed to load proforma invoice');
    }
}

// ============================================================================
// LINE ITEMS
// ============================================================================

function addProformaLine(data = {}) {
    const tbody = document.getElementById('proformaLines');
    // A fresh line inherits the previous row's GL account (same convenience as invoices) —
    // still editable per line; loaded lines keep their own saved account.
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

    // Same column order as PO / Invoice / Bill
    row.innerHTML = `
        <td><select class="form-control line-account" data-no-sd="true"><option value="">Select...</option>${acctOptions}</select><div class="searchable-dropdown-container line-account-sd"></div></td>
        <td><input type="text" class="form-control line-desc" value="${AccountsCommon.escapeHtml(data.description || '')}" placeholder="Description"></td>
        <td><input type="text" class="form-control line-hsn" value="${AccountsCommon.escapeHtml(data.hsn_sac || '')}" placeholder="HSN/SAC"></td>
        <td><input type="number" class="form-control line-qty" value="${data.quantity ?? 1}" min="0" step="any" oninput="calculateProformaTotals()"></td>
        <td><input type="number" class="form-control line-rate" value="${data.unit_price || ''}" min="0" step="0.01" placeholder="0.00" oninput="calculateProformaTotals()"></td>
        <td><input type="number" class="form-control line-disc" value="${data.discount_percent || ''}" min="0" max="100" step="0.01" placeholder="0" oninput="calculateProformaTotals()"></td>
        <td><div class="searchable-dropdown-container line-tax-sd"></div></td>
        <td class="line-amount" style="text-align:right; padding-top:0.7rem;">0.00</td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="removeProformaLine(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);

    // Held on the row, not in a field: the item is an identity the line was quoted from,
    // and it must survive to the invoice on conversion.
    row._itemId = data.item_id || null;
    row._uom = data.uom || null;

    const select = row.querySelector('.line-account');
    select.style.display = 'none';
    if (data.account_id) select.value = data.account_id;

    // ⭐ FILTER THE LIST THE USER ACTUALLY SEES. The hidden native <select> above is built
    // from postableAccounts(accounts, 'income'), but this — the SearchableDropdown that
    // replaces it on screen — mapped the raw account list, so a quotation offered every
    // account in the chart: "1000 — Assets", "1110 — Cash & Cash Equivalents", "1111 —
    // Cash in Hand". You cannot sell Cash in Hand. Its three siblings (receivables,
    // payables, purchase-orders) all filter here; this was the one that did not.
    const buildAccountOptions = () => [
        { value: '', label: 'Select...' },
        ...AccountsCommon.postableAccounts(accounts, 'income').map(a => {
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



/**
 * ⭐ THE CUSTOMER'S CONTRACTED RATES, ON THE QUOTE TOO.
 *
 * <p>The invoice screen pre-fills a picked item at the customer's PRICE-LIST rate
 * (loadInvoicePriceList / effectiveItemPrice) and only falls back to the catalogue
 * price when they are on no list. The quote screen had no such notion — so a customer
 * on negotiated rates would be QUOTED list price and INVOICED contract price, and the
 * two documents would disagree about the number the customer actually agreed to.
 * That is precisely the divergence quote/invoice parity exists to remove, so adding
 * an item picker without this would have opened the hole the feature was closing.</p>
 *
 * <p>Prospect mode has no price list by construction: there is no customer record yet,
 * so the map stays empty and the catalogue price is used.</p>
 */
async function loadProformaPriceList() {
    proformaPriceMap = new Map(); proformaPriceListName = '';
    const custId = document.getElementById('proformaCustomerId')?.value;
    const cust = customers.find(c => c.id === custId);
    if (!cust?.price_list_id) return;
    try {
        const rows = await api.request(AccountsCommon.buildUrl(`price-lists/${cust.price_list_id}/prices`), { _skipSpinner: true });
        (Array.isArray(rows) ? rows : (rows?.data || [])).forEach(r => proformaPriceMap.set(r.item_id, parseFloat(r.price)));
        const lists = await api.request(AccountsCommon.buildUrl('price-lists'), { _skipSpinner: true }).catch(() => []);
        proformaPriceListName = (Array.isArray(lists) ? lists : (lists?.data || [])).find(p => p.id === cust.price_list_id)?.name || 'price list';
        if (proformaPriceMap.size) Toast.info(`Using '${proformaPriceListName}' rates for ${cust.name} — new lines pre-fill them.`);
    } catch { /* fall back to catalogue prices, as the invoice does */ }
}

/** Effective per-BASE-unit price for an item on THIS quote: customer's list price, else catalog. */
function effectiveProformaPrice(it) {
    return proformaPriceMap.has(it.id) ? proformaPriceMap.get(it.id) : it.sale_price;
}

// ─────────────────────────── quote from the catalogue ───────────────────────────

let proformaItems = [];
let proformaItemPickerDD = null;

/**
 * ⭐ THE SAME ITEM PICKER THE INVOICE HAS. A quotation is a preview of the tax invoice it
 * becomes, so it must be quotable from the catalogue — picking an item pre-fills the
 * description, price, HSN and GST slab, and the item identity rides through conversion.
 * Without this a quote could only ever be typed free-hand, and every particular had to be
 * re-entered on the invoice, which is exactly how a bill comes to disagree with the quote
 * the customer accepted.
 *
 * `usage: 'sales'` matches the invoice's call, so raw materials and other not-sold items
 * stay out of a sales document.
 */
async function initProformaItemPicker() {
    const container = document.getElementById('proformaItemPicker');
    if (!container || typeof SearchableDropdown !== 'function') return;
    if (!proformaItems.length) {
        try {
            proformaItems = await api.request(AccountsCommon.buildUrl('inventory/items', { usage: 'sales' }), { _skipSpinner: true });
        } catch { proformaItems = []; }
    }
    if (!Array.isArray(proformaItems)) proformaItems = proformaItems?.data || [];
    const opts = [{ value: '', label: '+ Add from item catalog…' },
        ...proformaItems.filter(i => i.is_active).map(i => ({
            value: i.id, label: `${i.sku} — ${i.name} (${AccountsCommon.formatCurrency(i.sale_price)})`
        }))];
    container.innerHTML = '';
    proformaItemPickerDD = new SearchableDropdown(container, {
        id: 'proformaItemPickerDD', options: opts, value: '', placeholder: '+ Add from item catalog…',
        searchPlaceholder: 'Search SKU / name…', compact: true,
        onChange: (v) => {
            if (!v) return;
            const it = proformaItems.find(x => x.id === v);
            if (it) {
                addProformaLine({
                    item_id: it.id, description: it.name, hsn_sac: it.hsn_sac || '',
                    quantity: 1, unit_price: effectiveProformaPrice(it), uom: it.unit || null,
                    // The item's own revenue account, else the first income account already offered
                    // in the line dropdown — never a balance-sheet account.
                    account_id: it.income_account_id || AccountsCommon.postableAccounts(accounts, 'income')[0]?.id || undefined,
                    ...(it.tax_config_id ? { tax_config_id: it.tax_config_id } : {})
                });
                calculateProformaTotals();
            }
            proformaItemPickerDD.setValue?.('');
        }
    });
}

function removeProformaLine(btn) {
    btn.closest('tr').remove();
    calculateProformaTotals();
}


/**
 * ⭐⭐ MONEY IN INTEGER PAISE, BECAUSE float64 AND decimal DISAGREE.
 *
 * <p>The server computes a line in C# `decimal` — exact base-10, rounded half-away-from-zero.
 * The obvious JS mirror, `Math.round(qty * rate * 100) / 100`, is NOT the same function: 1.5 × 0.15
 * is 0.22499999999999998 in float64, so it rounds DOWN to 0.22 while the server stores 0.23. A
 * differential run over 1,089 (qty, rate, discount) combinations found 9 disagreements, and one
 * case leaked raw dust into the displayed figure (115.04999999999998).</p>
 *
 * <p>A paisa is not a rounding curiosity here: the screen would show the customer one total and the
 * database would keep another, on the very document the parity work exists to keep consistent.</p>
 *
 * <p>Scaling both operands to integers first makes the product exact, so the only rounding is the
 * deliberate one. Quantity carries up to 4dp and money 2dp, matching the columns. Safe while the
 * intermediate stays under 2^53, which the money-precision guards already ensure.</p>
 */
function _pfPaise(qty, rate) {
    const qi = Math.round(qty * 10000);      // 4dp, as NUMERIC(18,4)
    const ri = Math.round(rate * 100);       // 2dp money
    return Math.round((qi * ri) / 10000);    // -> paise, half-up like AwayFromZero on positives
}

/** A line's NET value in rupees: gross rounded to 2dp, less the trade discount — the same order,
 *  and the same rounding, as ProformaLineNet in the business layer. */
function proformaLineNet(qty, rate, discPct) {
    const gross = _pfPaise(qty, rate);
    const disc = Math.round((gross * discPct) / 100);
    return (gross - disc) / 100;
}

function calculateProformaTotals() {
    let subtotal = 0;
    let totalTax = 0;
    document.querySelectorAll('#proformaLines tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        // ⭐ MIRROR THE SERVER'S ARITHMETIC, IN THE SAME ORDER. gross is rounded to 2dp BEFORE the
        // discount and the tax is charged on the NET — see ProformaLineNet in the business layer.
        // Computing tax on gross here would show the customer one total on screen and store another.
        const disc = Math.min(100, Math.max(0, parseFloat(row.querySelector('.line-disc')?.value) || 0));
        const amt = proformaLineNet(qty, rate, disc);
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
    const cur = proformaCurrency();
    const sym = cur === BASE_CURRENCY ? '' : currencySymbol(cur);
    setText('proformaSubtotal', sym + subtotal.toFixed(2));
    setText('proformaTax', sym + totalTax.toFixed(2));
    // ⭐ THE FORM WAS THE ONLY SURFACE SAYING SOMETHING DIFFERENT. The comment here used to claim
    // the Total must equal the pre-tax subtotal "matching the saved + detail-view figures" — and that
    // claim was false in all four directions: the DB stores `total_amount = @sub + @tax`, the list
    // column, the detail view and the quotation PDF all print that tax-inclusive figure. So a user
    // filled in a discounted line, read "Total ₹9,000", saved, and the list showed ₹10,620 for the
    // same quote. Prose asserting a consistency the code does not have is worse than no comment: it
    // is what stops the next reader checking. The form now agrees with the document it produces.
    setText('proformaTotal', sym + (subtotal + totalTax).toFixed(2));
    const fxRow = document.getElementById('proformaFxEquiv');
    if (fxRow) {
        const rate = proformaRate();
        if (cur !== BASE_CURRENCY && rate > 0) {
            fxRow.style.display = '';
            fxRow.innerHTML = `<span>Posted to books as</span><span>≈ ₹${(subtotal * rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })} @ ${rate}</span>`;
        } else {
            fxRow.style.display = 'none';
        }
    }
}

// ============================================================================
// SAVE PROFORMA (CREATE / UPDATE)
// ============================================================================

async function saveProforma() {
    const form = document.getElementById('proformaForm');
    const isRecipient = _proformaBillTo === 'recipient';
    // Mode-aware guard: existing-customer mode needs a selected customer; recipient mode needs a name.
    // (The customer <select> is hidden behind a SearchableDropdown, so validate explicitly with a Toast.)
    if (!isRecipient && !document.getElementById('proformaCustomerId').value) { Toast.error('Please select a customer'); return; }
    if (isRecipient && !document.getElementById('proformaRecipientName').value.trim()) { Toast.error('Please enter a recipient name'); return; }
    if (!form.reportValidity()) return;

    // Block early if a required custom field is empty — avoids creating the proforma then failing its values write.
    const cfErr = AccountsCommon.validateRequiredCustomFields(proformaCfController);
    if (cfErr) { Toast.error(cfErr); return; }

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
            hsn_sac: (row.querySelector('.line-hsn')?.value || '').trim() || null,
            discount_percent: Math.min(100, Math.max(0, parseFloat(row.querySelector('.line-disc')?.value) || 0)),
            item_id: row._itemId || null,
            uom: row._uom || null,
            tax_config_id: taxConfigId,
            tax_rate: taxRate || 0
        });
    });
    if (lineError) { Toast.error(lineError); return; }
    if (!lines.length) { Toast.error('Add at least one line item with an account'); return; }

    // tax_configuration_id was previously a single header-level field —
    // keeping a no-op default so the existing backend still parses, but tax
    // is now per-line via the lines[*].tax_config_id field above.
    const docCurrency = proformaCurrency();
    const docRate = proformaRate();
    if (docCurrency !== BASE_CURRENCY) {
        if (!(docRate > 0)) {
            Toast.error(`Enter the exchange rate: how many ₹ one ${docCurrency} is worth`);
            return;
        }
        lines.forEach(l => { l.unit_price = Math.round(l.unit_price * docRate * 100) / 100; });
    }

    const payload = {
        currency: docCurrency,
        exchange_rate: docCurrency !== BASE_CURRENCY ? docRate : null,
        // Existing-customer mode sends customer_id; recipient mode sends the recipient_* fields (customer_id null).
        customer_id: isRecipient ? null : (document.getElementById('proformaCustomerId').value || null),
        recipient_name: isRecipient ? (document.getElementById('proformaRecipientName').value.trim() || null) : null,
        recipient_email: isRecipient ? (document.getElementById('proformaRecipientEmail').value.trim() || null) : null,
        recipient_phone: isRecipient ? (document.getElementById('proformaRecipientPhone').value.trim() || null) : null,
        recipient_gstin: isRecipient ? (document.getElementById('proformaRecipientGstin').value.trim() || null) : null,
        recipient_address: isRecipient ? (document.getElementById('proformaRecipientAddress').value.trim() || null) : null,
        proforma_date: document.getElementById('proformaDate').value,
        valid_until: document.getElementById('proformaValidUntil').value,
        notes: document.getElementById('proformaNotes').value,
        tax_configuration_id: null,
        lines
    };

    const id = document.getElementById('proformaId').value;
    if (!AccountsCommon.beginSubmit('saveProforma')) return;
    try {
        let savedProforma;
        if (id) {
            savedProforma = await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}`), { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            Toast.success('Proforma invoice updated');
        } else {
            savedProforma = await api.request(AccountsCommon.buildUrl('proforma-invoices'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            Toast.success('Proforma invoice saved as draft');
        }
        // The document now exists — persist its custom-field values.
        const savedProformaId = savedProforma?.id || id;
        if (savedProformaId) {
            try { await AccountsCommon.saveCustomFieldValues('proforma_invoice', savedProformaId, proformaCfController?.getValues?.() || {}); }
            catch (e) { Toast.error(e.message || 'Some custom fields were not saved'); }
        }
        AccountsCommon.hideFormPage('proformaInvoiceModal');
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
    const customerName = _proformaPartyName(pi) || 'the customer';
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
    const pi = proformaInvoices.find(x => x.id === id);
    // Recipient-only (prospect) proforma: we can't bill an AR invoice without a real customer, so collect
    // the customer details first (pre-filled from the quote) and convert with that payload.
    if (pi && !pi.customer_id && pi.recipient_name) { openProformaConvertModal(pi); return; }

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

// ── Convert a recipient-only proforma: create the customer, then convert ──────────────────────────
let _convertGstDd = null;
let _proformaConverting = false;

function openProformaConvertModal(pi) {
    const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v || ''; };
    document.getElementById('convertProformaId').value = pi.id;
    set('convName', pi.recipient_name);
    set('convEmail', pi.recipient_email);
    set('convPhone', pi.recipient_phone);
    set('convTaxId', pi.recipient_gstin);
    set('convAddress', pi.recipient_address);
    set('convCity', '');
    set('convState', '');
    set('convStateCode', (pi.recipient_gstin || '').trim().slice(0, 2)); // GSTIN first 2 digits = state code
    set('convCountry', 'India');

    const initialTreatment = pi.recipient_gstin ? 'registered' : 'unregistered';
    if (!_convertGstDd && typeof SearchableDropdown !== 'undefined') {
        _convertGstDd = new SearchableDropdown(document.getElementById('convGstTreatmentContainer'), {
            options: [
                { value: 'registered', label: 'Registered (has GSTIN)' },
                { value: 'unregistered', label: 'Unregistered' },
                { value: 'composition', label: 'Composition' },
                { value: 'overseas', label: 'Overseas (export, zero-rated)' }
            ],
            value: initialTreatment,
            onChange: onConvertTreatmentChange
        });
    } else if (_convertGstDd) {
        _convertGstDd.setValue ? _convertGstDd.setValue(initialTreatment) : (_convertGstDd.selectedValue = initialTreatment);
    }
    onConvertTreatmentChange();
    AccountsCommon.openModal('proformaConvertModal');
}

function _convertTreatment() { return _convertGstDd?.getValue?.() || _convertGstDd?.selectedValue || 'registered'; }

// GSTIN is required only for a registered customer; state code is needed for every domestic (non-overseas) one.
function onConvertTreatmentChange() {
    const t = _convertTreatment();
    const taxGrp = document.getElementById('convTaxIdGroup');
    const stateGrp = document.getElementById('convStateCodeGroup');
    if (taxGrp) taxGrp.style.display = t === 'registered' ? '' : 'none';
    if (stateGrp) stateGrp.style.display = t === 'overseas' ? 'none' : '';
}

async function submitProformaConvert() {
    if (_proformaConverting) return;
    const id = document.getElementById('convertProformaId').value;
    const val = elId => (document.getElementById(elId)?.value || '').trim();
    const treatment = _convertTreatment();
    const customer = {
        name: val('convName'), phone: val('convPhone'), email: val('convEmail'),
        gst_treatment: treatment,
        tax_id: val('convTaxId') || null,
        billing_address_line1: val('convAddress'), city: val('convCity'), state: val('convState'),
        state_code: val('convStateCode') || null, country: val('convCountry') || 'India'
    };
    // Client-side guards mirroring CreateCustomer (surface a clean message before the round-trip).
    if (!customer.name) return Toast.error('Name is required');
    if (!customer.phone) return Toast.error('Phone is required');
    if (!customer.email) return Toast.error('Email is required');
    if (treatment === 'registered' && !customer.tax_id) return Toast.error('GSTIN is required for a registered customer');
    if (treatment !== 'overseas' && !customer.state_code) return Toast.error('State code (place of supply) is required');
    if (!customer.billing_address_line1 || !customer.city || !customer.state || !customer.country) return Toast.error('Address, city, state and country are required');

    _proformaConverting = true;
    try {
        const result = await api.request(AccountsCommon.buildUrl(`proforma-invoices/${id}/convert-to-invoice`), {
            method: 'POST', body: JSON.stringify({ customer }), headers: { 'Content-Type': 'application/json' }
        });
        const invoiceNo = result?.invoice_number || result?.id || '';
        Toast.success(`Customer created and proforma converted${invoiceNo ? ' to ' + invoiceNo : ''}`);
        AccountsCommon.closeModal('proformaConvertModal');
        window.location.href = 'receivables.html';
    } catch (err) {
        Toast.error(err.message || 'Failed to convert to invoice');
    } finally {
        _proformaConverting = false;
    }
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

/**
 * Download a quotation as a PDF. Mirrors downloadInvoicePdf in receivables.js — same auth header, same
 * blob-to-anchor dance, same revokeObjectURL.
 *
 * ⚠️ A FAILED DOWNLOAD MUST NOT LOOK LIKE A SUCCESSFUL ONE. fetch() does not throw on 4xx/5xx, so without
 * the response.ok check the error BODY is saved as a .pdf — the browser shows a download, the file opens
 * to garbage, and the user reports "the PDF is corrupt" rather than "I was not allowed to do that".
 */
async function downloadProformaPdf(id, proformaNumber) {
    try {
        const baseUrl = api._getBaseUrl('/accounts/');
        const url = `${baseUrl}/accounts/proforma-invoices/${id}/pdf?tenantId=${AccountsCommon.getTenantId()}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${api.token}` } });
        if (!response.ok) throw new Error(`Failed to download PDF (${response.status})`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `Quote-${proformaNumber || id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        Toast.success('Quotation PDF downloaded');
    } catch (err) {
        console.error('[Proforma] PDF download error:', err);
        Toast.error(err.message || 'Failed to download PDF');
    }
}
