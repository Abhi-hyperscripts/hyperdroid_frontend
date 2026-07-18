/**
 * AccountsService — Purchase Orders Page
 *
 * Handles 10 backend endpoints for purchase order lifecycle:
 *   1.  GET    /purchase-orders              — list with stats
 *   2.  GET    /purchase-orders/{id}         — single with lines
 *   3.  POST   /purchase-orders              — create draft
 *   4.  PUT    /purchase-orders/{id}         — update draft
 *   5.  DELETE /purchase-orders/{id}         — delete draft
 *   6.  POST   /purchase-orders/{id}/approve          — approve
 *   7.  POST   /purchase-orders/{id}/send              — send to vendor
 *   8.  POST   /purchase-orders/{id}/receive           — mark received
 *   9.  POST   /purchase-orders/{id}/convert-to-bill   — convert to vendor bill
 *  10.  POST   /purchase-orders/{id}/cancel             — cancel
 *
 * Status lifecycle: draft → approved → sent → received → billed
 *                   Can cancel from draft / approved / sent
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let vendors = [];
let accounts = [];
let taxConfigs = [];

// Module-scoped cache so row-action handlers can look up full entity by id
let purchaseOrders = [];

let poPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let poVendorFilterDD = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('purchase-orders', '../')) return;

    const tabNames = {
        'po-list': 'Purchase Orders'
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
        case 'po-list': loadPurchaseOrders(); break;
    }
}

// ============================================================================
// INITIAL DATA
// ============================================================================

async function loadInitialData() {
    try {
        const [vendRes, acctRes, taxRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa', { isActive: true }), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('tax/configurations'), { _skipSpinner: true }).catch(() => [])
        ]);
        vendors = Array.isArray(vendRes) ? vendRes : (vendRes?.data || vendRes?.items || []);
        accounts = Array.isArray(acctRes) ? acctRes : (acctRes?.data || acctRes?.items || []);
        // Tax configurations seeded by "Initialize India GST" — used to
        // auto-apply GST per PO line. Falls back to empty array if not seeded.
        taxConfigs = Array.isArray(taxRes) ? taxRes : (taxRes?.data || []);

        populateSelect('poVendorId', vendors, 'id', 'name', 'Select vendor...');

        loadPurchaseOrders();
    } catch (err) {
        console.error('[PurchaseOrders] loadInitialData error:', err);
    }
}

// Pick a sensible default tax config (GST 18% if available, else first one).
function _defaultTaxConfigId() {
    if (!taxConfigs || !taxConfigs.length) return '';
    const eighteen = taxConfigs.find(t => /18/.test(t.name || '') || _taxRateFor(t.id) === 18);
    return eighteen ? eighteen.id : taxConfigs[0].id;
}

function _taxRateFor(configId) {
    const cfg = taxConfigs.find(t => t.id === configId);
    if (!cfg) return 0;
    // Backend TaxConfiguration nests the rate at configuration.total_rate (the list
    // endpoint doesn't populate rates[]); older/flat keys kept as fallbacks.
    const r = Number(cfg.configuration?.total_rate ?? cfg.total_rate ?? cfg.rate ?? cfg.tax_rate ?? 0);
    if (r) return r;
    if (Array.isArray(cfg.rates)) {
        return cfg.rates.reduce((s, x) => s + Number(x.rate ?? x.rate_percentage ?? 0), 0);
    }
    // Last-ditch: parse "GST 18%" out of the name
    const m = (cfg.name || '').match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
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
    document.getElementById('poSearch')?.addEventListener('input', debounce(() => { poPage = 1; loadPurchaseOrders(); }));
    document.getElementById('poStatusFilter')?.addEventListener('change', () => { poPage = 1; loadPurchaseOrders(); });
}

function initDatePickers() {
    if (typeof flatpickr !== 'function') {
        setTimeout(initDatePickers, 300);
        return;
    }
    const opts = { dateFormat: 'Y-m-d', allowInput: true };
    flatpickr('#poDateFrom', { ...opts, onChange: () => { poPage = 1; loadPurchaseOrders(); } });
    flatpickr('#poDateTo', { ...opts, onChange: () => { poPage = 1; loadPurchaseOrders(); } });
    flatpickr('#poDate', opts);
    flatpickr('#poExpectedDate', opts);
}

// ============================================================================
// DROPDOWNS
// ============================================================================

function initDropdowns() {
    const vendOpts = vendors.map(v => ({ value: v.id, label: v.name }));

    poVendorFilterDD = new SearchableDropdown(document.getElementById('poVendorFilterContainer'), {
        id: 'poVendorFilter', options: vendOpts, placeholder: 'All Vendors',
        searchPlaceholder: 'Search vendors...', compact: true,
        onChange: () => { poPage = 1; loadPurchaseOrders(); }
    });
}

// ============================================================================
// PURCHASE ORDERS — LIST
// ============================================================================

async function loadPurchaseOrders() {
    const params = { limit: PAGE_SIZE, offset: (poPage - 1) * PAGE_SIZE };
    const vendorId = poVendorFilterDD?.getValue?.();
    const status = document.getElementById('poStatusFilter')?.value;
    const dateFrom = document.getElementById('poDateFrom')?.value;
    const dateTo = document.getElementById('poDateTo')?.value;
    const search = document.getElementById('poSearch')?.value?.trim();

    if (vendorId) params.vendorId = vendorId;
    if (status) params.status = status;
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;
    if (search) params.search = search;

    try {
        const res = await api.request(AccountsCommon.buildUrl('purchase-orders', params));
        const items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        purchaseOrders = items;  // cache for row action handlers
        // Backend total is the FILTERED count — ?? (not ||) so a legitimate 0 sticks
        const total = res?.total ?? items.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        // Clamp if actioning the last row on a page left us past the end (else an empty "No … found").
        if (poPage > totalPages) { poPage = totalPages; return loadPurchaseOrders(); }

        // Stats — prefer backend stats, fallback to client-side
        const stats = res?.stats || {};
        setText('totalPOs', stats.total_count ?? total);
        setText('draftPOs', stats.draft_count ?? items.filter(i => i.status === 'draft').length);
        setText('approvedPOs', stats.approved_count ?? items.filter(i => i.status === 'approved').length);
        setText('sentPOs', stats.sent_count ?? items.filter(i => i.status === 'sent').length);
        setText('receivedPOs', stats.received_count ?? items.filter(i => i.status === 'received').length);
        setText('totalPOValue', stats.total_value != null ? AccountsCommon.formatCurrency(stats.total_value) : AccountsCommon.formatCurrency(items.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0)));

        const tbody = document.getElementById('purchaseOrdersTable');
        if (!items.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No purchase orders found</p></div></td></tr>';
        } else {
            tbody.innerHTML = items.map(po => {
                const vendName = po.vendor_name || vendors.find(v => v.id === po.vendor_id)?.name || '-';
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(po.po_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(vendName)}</td>
                    <td>${AccountsCommon.formatDate(po.po_date)}</td>
                    <td>${AccountsCommon.formatDate(po.expected_date)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(po.total_amount)}</td>
                    <td>${AccountsCommon.statusBadge(po.status)}</td>
                    <td class="actions-cell">${poActions(po)}</td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('posPagination', poPage, totalPages, p => { poPage = p; loadPurchaseOrders(); });
    } catch (err) {
        console.error('[PurchaseOrders] loadPurchaseOrders error:', err);
        Toast.error('Failed to load purchase orders');
    }
}

// ============================================================================
// ROW ACTIONS (status-dependent)
// ============================================================================

function poActions(po) {
    const s = (po.status || '').toLowerCase();

    // View + PDF are always available
    let html = `<button class="btn-icon" data-tooltip="View" onclick="viewPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
    html += ` <button class="btn-icon" data-tooltip="Download PDF" onclick="downloadPoPdf('${po.id}', '${(po.po_number||'').replace(/'/g,'')}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>`;

    // Mutating actions require admin (MANAGE_VENDORS)
    if (!accountsRoles.isAdmin()) {
        return html;
    }

    if (s === 'draft') {
        html += ` <button class="btn-icon" data-tooltip="Edit" onclick="editPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
        html += ` <button class="btn-icon" data-tooltip="Approve" onclick="approvePO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Delete" onclick="deletePO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    }

    if (s === 'approved') {
        html += ` <button class="btn-icon" data-tooltip="Send" onclick="sendPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Cancel" onclick="cancelPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    }

    if (s === 'sent') {
        html += ` <button class="btn-icon" data-tooltip="Receive" onclick="receivePO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Cancel" onclick="cancelPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    }

    if (s === 'received') {
        html += ` <button class="btn-icon" data-tooltip="Convert to Bill" onclick="convertToBill('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>`;
    }

    return html;
}

// ============================================================================
// VIEW PURCHASE ORDER (read-only detail modal)
// ============================================================================

async function viewPO(id) {
    try {
        const po = await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}`));
        const esc = AccountsCommon.escapeHtml;
        const fmt = AccountsCommon.formatCurrency;
        const fmtD = AccountsCommon.formatDate;

        document.getElementById('poViewTitle').textContent = `Purchase Order ${esc(po.po_number || '')}`;

        const vendName = po.vendor_name || vendors.find(v => v.id === po.vendor_id)?.name || '-';
        const lines = po.lines || [];

        // Per-line display uses the STORED tax_amount on the line — historical docs must
        // show their own totals, never a live recompute against current tax-config rates.
        const lineRows = lines.map(l => {
            const cfg = taxConfigs.find(t => t.id === l.tax_config_id);
            const lineAmt = Number(l.amount) || 0;
            const lineTax = Number(l.tax_amount) || 0;
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
        const displayTax = Number(po.tax_amount || 0);
        const displayTotal = Number(po.total_amount || 0);

        let approvedHtml = '';
        if (po.approved_by) {
            approvedHtml = `<div>
                <div style="color:var(--text-secondary);font-size:0.85rem;">Approved At</div>
                <div>${po.approved_at ? fmtD(po.approved_at) : '-'}</div>
            </div>`;
        }

        document.getElementById('poViewBody').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Vendor</div>
                    <div style="font-weight:500;">${esc(vendName)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Status</div>
                    <div>${AccountsCommon.statusBadge(po.status)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">PO Date</div>
                    <div>${fmtD(po.po_date)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Expected Date</div>
                    <div>${fmtD(po.expected_date)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Currency</div>
                    <div>${esc(po.currency || 'INR')}</div>
                </div>
                ${approvedHtml}
            </div>
            ${po.notes ? `<div style="margin-top:1rem;color:var(--text-secondary);font-size:0.9rem;"><strong>Notes:</strong> ${esc(po.notes)}</div>` : ''}
            ${linesHtml}
            <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
                <div style="min-width:250px;">
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;color:var(--text-secondary);">
                        <span>Subtotal:</span><span>${fmt(po.subtotal)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;color:var(--text-secondary);">
                        <span>Tax:</span><span>${fmt(displayTax)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;font-weight:600;border-top:1px solid var(--border-primary);color:var(--text-primary);">
                        <span>Total:</span><span>${fmt(displayTotal)}</span>
                    </div>
                </div>
            </div>`;

        AccountsCommon.openModal('poViewModal');
    } catch (err) {
        Toast.error('Failed to load purchase order');
    }
}

// ============================================================================
// PO MODAL — CREATE / EDIT
// ============================================================================

function showCreatePOModal() {
    document.getElementById('poModalTitle').textContent = 'Create Purchase Order';
    document.getElementById('poForm').reset();
    document.getElementById('poId').value = '';
    document.getElementById('poCurrency').value = 'INR';
    document.getElementById('poLines').innerHTML = '';
    addPOLine();
    calculatePOTotals();
    AccountsCommon.openModal('purchaseOrderModal');
}

async function editPO(id) {
    try {
        const po = await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}`));
        document.getElementById('poModalTitle').textContent = `Edit PO ${po.po_number || ''}`;
        document.getElementById('poId').value = po.id;
        const poVendorSel = document.getElementById('poVendorId');
        poVendorSel.value = po.vendor_id || '';
        poVendorSel.dispatchEvent(new Event('change')); // re-sync the SearchableDropdown label on repeat edits
        document.getElementById('poDate').value = po.po_date?.split('T')[0] || '';
        document.getElementById('poExpectedDate').value = po.expected_date?.split('T')[0] || '';
        document.getElementById('poCurrency').value = po.currency || 'INR';
        document.getElementById('poNotes').value = po.notes || '';

        const lines = po.lines || [];
        const tbody = document.getElementById('poLines');
        tbody.innerHTML = '';
        if (lines.length) {
            lines.forEach(l => addPOLine(l));
        } else {
            addPOLine();
        }
        calculatePOTotals();
        AccountsCommon.openModal('purchaseOrderModal');
    } catch (err) {
        Toast.error('Failed to load purchase order');
    }
}

// ============================================================================
// LINE ITEMS
// ============================================================================

function addPOLine(data = {}) {
    const tbody = document.getElementById('poLines');
    const row = document.createElement('tr');
    const acctOptions = accounts.map(a => {
        const code = a.account_code || a.code || '';
        const name = a.account_name || a.name || '';
        const label = code && name ? `${code} — ${name}` : (name || code);
        return `<option value="${a.id}" ${a.id === data.account_id ? 'selected' : ''}>${AccountsCommon.escapeHtml(label)}</option>`;
    }).join('');

    // Column order: Account first (primary selection), then Description, Qty,
    // Unit Price, Amount. Account dropdown gets the widest cell so the
    // code+name label fits without truncation.
    // data-no-sd on the account select so the global auto-converter skips
    // it — we wire a SearchableDropdown with a `quickAdd` callback below
    // so CAs can add a new account without leaving the PO form.
    row.innerHTML = `
        <td><select class="form-control line-account" data-no-sd="true"><option value="">Select...</option>${acctOptions}</select><div class="searchable-dropdown-container line-account-sd"></div></td>
        <td><input type="text" class="form-control line-desc" value="${AccountsCommon.escapeHtml(data.description || '')}" placeholder="Description"></td>
        <td><input type="number" class="form-control line-qty" value="${data.quantity ?? 1}" min="0" step="any" oninput="calculatePOTotals()"></td>
        <td><input type="number" class="form-control line-rate" value="${data.unit_price || ''}" min="0" step="0.01" placeholder="0.00" oninput="calculatePOTotals()"></td>
        <td><div class="searchable-dropdown-container line-tax-sd"></div></td>
        <td class="line-amount" style="text-align:right; padding-top:0.7rem;">0.00</td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="removePOLine(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);

    // Hide the native select (display:none) and wire a SearchableDropdown to
    // the sibling container with quickAdd enabled.
    const select = row.querySelector('.line-account');
    select.style.display = 'none';
    const containerEl = row.querySelector('.line-account-sd');
    const buildOptions = () => [
        { value: '', label: 'Select...' },
        ...accounts.map(a => {
            const code = a.account_code || a.code || '';
            const name = a.account_name || a.name || '';
            return { value: a.id, label: code && name ? `${code} — ${name}` : (name || code) };
        })
    ];
    const dd = new SearchableDropdown(containerEl, {
        id: `po-line-account-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: buildOptions(),
        value: data.account_id || '',
        placeholder: 'Select account...',
        searchPlaceholder: 'Search accounts…',
        compact: true,
        quickAdd: {
            title: 'Create new account',
            onClick: (instance) => openQuickAddAccountModal(instance, buildOptions)
        },
        onChange: (v) => { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    row._lineAccountDropdown = dd;

    // Tax-rate dropdown — defaults to GST 18% (or first available config).
    // Each line carries its own rate so a single PO can mix exempt + taxed
    // items. If no tax configs are seeded yet, dropdown is empty and tax
    // stays at 0 — the "Initialize India GST" button on Setup → Taxation
    // creates the standard 5/12/18/28 slabs in one click.
    const taxContainer = row.querySelector('.line-tax-sd');
    const taxOptions = [
        { value: '', label: 'No tax (0%)' },
        ...taxConfigs.map(t => ({
            value: t.id,
            label: `${t.name || t.tax_type || 'Tax'} (${_taxRateFor(t.id)}%)`
        }))
    ];
    const initialTaxId = data.tax_config_id !== undefined
        ? data.tax_config_id || ''
        : _defaultTaxConfigId();
    const taxDd = new SearchableDropdown(taxContainer, {
        id: `po-line-tax-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: taxOptions,
        value: initialTaxId,
        placeholder: 'No tax',
        searchPlaceholder: 'Search tax…',
        compact: true,
        onChange: () => calculatePOTotals()
    });
    row._lineTaxDropdown = taxDd;

    calculatePOTotals();
}

/**
 * Lightweight "quick add" for Account from within the PO line-items
 * dropdown. Prompts for just the essentials (code + name + type), POSTs to
 * /coa, appends to the in-memory accounts[], refreshes the dropdown options,
 * and auto-selects the newly created account.
 */
async function openQuickAddAccountModal(dropdownInstance, rebuildOptions) {
    // Ensure the quick-add mini-modal exists on the page
    let m = document.getElementById('poQuickAddAccountModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'poQuickAddAccountModal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="max-width: 520px;">
                    <div class="modal-header">
                        <h5 class="modal-title">Quick Add Account</h5>
                        <button class="close-btn" onclick="AccountsCommon.closeModal('poQuickAddAccountModal')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                    <div class="modal-body">
                        <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 0.75rem;">
                            Create a new ledger account inline. It's added to your Chart of Accounts immediately.
                        </p>
                        <div class="form-row two-col">
                            <div class="form-group">
                                <label for="poQaCode">Code *</label>
                                <input type="text" id="poQaCode" class="form-control" placeholder="e.g. 1200" required>
                            </div>
                            <div class="form-group">
                                <label for="poQaName">Name *</label>
                                <input type="text" id="poQaName" class="form-control" placeholder="e.g. Office Supplies" required>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="poQaType">Account Type *</label>
                                <div class="searchable-dropdown-container" id="poQaTypeContainer"></div>
                            </div>
                        </div>
                        <div id="poQaError" class="custom-coa-error" hidden style="margin-top:0.5rem; padding:0.5rem 0.75rem; border-radius:6px; background: color-mix(in srgb, var(--color-error, #c33) 12%, var(--bg-card-hover)); color: var(--color-error, #c33); font-size: 0.85rem;"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="AccountsCommon.closeModal('poQuickAddAccountModal')">Cancel</button>
                        <button class="btn btn-primary" id="poQaSaveBtn">Save</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);
    }
    // Reset fields + attach a fresh Type dropdown
    document.getElementById('poQaCode').value = '';
    document.getElementById('poQaName').value = '';
    document.getElementById('poQaError').hidden = true;
    const typeContainer = document.getElementById('poQaTypeContainer');
    typeContainer.innerHTML = '';
    // Fetch account types. No hard-coded fallback: account_type_id must be a real
    // Guid from coa/types — sending a string like 'Assets' would 400 on the backend.
    let types = [];
    try {
        const typesRes = await api.request(AccountsCommon.buildUrl('coa/types'), { _skipSpinner: true });
        types = Array.isArray(typesRes) ? typesRes : (typesRes?.data || []);
    } catch (err) {
        console.error('[PO quick-add account] failed to load account types:', err);
    }
    if (!types.length) {
        Toast.error('Account types could not be loaded — quick-add is unavailable. Create the account from the Chart of Accounts page instead.');
        return;
    }
    const typeDropdown = new SearchableDropdown(typeContainer, {
        id: 'poQaType-sd',
        options: [{ value: '', label: '— select —' }, ...types.map(t => ({ value: t.id, label: t.name }))],
        value: '',
        placeholder: '— select —',
        compact: false
    });

    AccountsCommon.openModal('poQuickAddAccountModal');
    setTimeout(() => document.getElementById('poQaCode').focus(), 100);

    // Wire Save
    const saveBtn = document.getElementById('poQaSaveBtn');
    saveBtn.onclick = async () => {
        const code = document.getElementById('poQaCode').value.trim();
        const name = document.getElementById('poQaName').value.trim();
        const typeId = typeDropdown.selectedValue;
        const errEl = document.getElementById('poQaError');
        errEl.hidden = true;
        if (!code || !name || !typeId) {
            errEl.textContent = 'Code, Name, and Account Type are required.';
            errEl.hidden = false;
            return;
        }
        saveBtn.disabled = true;
        const prev = saveBtn.textContent;
        saveBtn.textContent = 'Saving…';
        try {
            const created = await api.request(AccountsCommon.buildUrl('coa'), {
                method: 'POST',
                body: JSON.stringify({
                    account_code: code,
                    account_name: name,
                    account_type_id: typeId
                })
            });
            // Re-pull the full account list so our in-memory cache matches
            const fresh = await api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true });
            accounts = Array.isArray(fresh) ? fresh : (fresh?.data || fresh?.items || []);

            // Rebuild this dropdown's options and auto-select the new account
            const newId = created?.id || accounts.find(a => a.account_code === code)?.id;
            dropdownInstance.refreshOptions(rebuildOptions(), newId);

            // Sync the hidden native select too
            const row = dropdownInstance.container.closest('tr');
            const nativeSel = row?.querySelector('.line-account');
            if (nativeSel && newId) {
                // Ensure the new option exists in the native select for form posts
                const opt = document.createElement('option');
                opt.value = newId;
                opt.textContent = `${code} — ${name}`;
                opt.selected = true;
                nativeSel.appendChild(opt);
                nativeSel.value = newId;
            }

            // Also refresh every OTHER line-account dropdown so the new
            // account shows up without re-rendering rows.
            document.querySelectorAll('#poLines tr').forEach(tr => {
                const other = tr._lineAccountDropdown;
                if (other && other !== dropdownInstance) {
                    const current = other.selectedValue;
                    other.refreshOptions(rebuildOptions(), current);
                }
            });

            Toast.success(`Account ${code} created and selected.`);
            AccountsCommon.closeModal('poQuickAddAccountModal');
        } catch (err) {
            console.error('[PO quick-add account]', err);
            errEl.textContent = err?.message || 'Failed to create account.';
            errEl.hidden = false;
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = prev;
        }
    };
}

function removePOLine(btn) {
    btn.closest('tr').remove();
    calculatePOTotals();
}

function calculatePOTotals() {
    let subtotal = 0;
    let totalTax = 0;
    document.querySelectorAll('#poLines tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const amt = qty * rate;
        subtotal += amt;

        // Per-line tax — uses the SearchableDropdown's selected tax config
        const taxConfigId = row._lineTaxDropdown?.selectedValue || '';
        const taxPct = _taxRateFor(taxConfigId);
        const lineTax = (amt * taxPct) / 100;
        totalTax += lineTax;

        // Show line subtotal + tax breakdown in the Amount cell
        const amtCell = row.querySelector('.line-amount');
        if (amtCell) {
            if (taxPct > 0) {
                amtCell.innerHTML = `
                    <div>${(amt + lineTax).toFixed(2)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">
                        ${amt.toFixed(2)} + ${lineTax.toFixed(2)} tax
                    </div>`;
            } else {
                amtCell.textContent = amt.toFixed(2);
            }
        }
    });

    setText('poSubtotal', subtotal.toFixed(2));
    setText('poTax', totalTax.toFixed(2));
    // The PO stores/prints the pre-tax subtotal (GST is authoritatively added when it converts to a
    // bill), so the PO Total must equal the subtotal — matching the saved + detail-view figures.
    setText('poTotal', subtotal.toFixed(2));
}

// ============================================================================
// SAVE PO (CREATE / UPDATE)
// ============================================================================

async function savePO() {
    const form = document.getElementById('poForm');
    // The vendor <select> is hidden (converted to a SearchableDropdown) but keeps `required`, so
    // reportValidity() fails silently on it with no anchorable bubble. Guard explicitly with a Toast.
    if (!document.getElementById('poVendorId').value) { Toast.error('Please select a vendor'); return; }
    if (!form.reportValidity()) return;

    // Skip fully blank rows and require an account on any non-empty row —
    // backend line account_id is a non-nullable Guid (null → 400).
    const lines = [];
    let lineError = null;
    document.querySelectorAll('#poLines tr').forEach((row, idx) => {
        const account_id = row.querySelector('.line-account')?.value || null;
        const description = (row.querySelector('.line-desc')?.value || '').trim();
        const quantity = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const unit_price = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const taxConfigId = row._lineTaxDropdown?.selectedValue || null;
        const taxRate = _taxRateFor(taxConfigId);

        const isBlank = !account_id && !description && !(quantity * unit_price > 0);
        if (isBlank) return;
        if (!account_id) { lineError = lineError || `Line ${idx + 1}: please select an account`; return; }
        lines.push({
            description,
            account_id,
            quantity,
            unit_price,
            tax_config_id: taxConfigId || null,
            tax_rate: taxRate || 0
        });
    });
    if (lineError) { Toast.error(lineError); return; }
    if (!lines.length) { Toast.error('Add at least one line item with an account'); return; }

    const payload = {
        vendor_id: document.getElementById('poVendorId').value,
        po_date: document.getElementById('poDate').value,
        expected_date: document.getElementById('poExpectedDate').value,
        currency: document.getElementById('poCurrency').value || 'INR',
        notes: document.getElementById('poNotes').value,
        lines
    };

    const id = document.getElementById('poId').value;
    if (!AccountsCommon.beginSubmit('savePO')) return;
    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}`), { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            Toast.success('Purchase order updated');
        } else {
            await api.request(AccountsCommon.buildUrl('purchase-orders'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            Toast.success('Purchase order saved as draft');
        }
        AccountsCommon.closeModal('purchaseOrderModal');
        loadPurchaseOrders();
    } catch (err) {
        Toast.error(err.message || 'Failed to save purchase order');
    } finally {
        AccountsCommon.endSubmit('savePO');
    }
}

// ============================================================================
// STATUS LIFECYCLE ACTIONS
// ============================================================================

function _poLabel(id) {
    const po = purchaseOrders.find(x => x.id === id);
    if (!po) return { label: 'this purchase order', poNo: '', vendorName: '' };
    const fmt = AccountsCommon.formatCurrency;
    const poNo = po.po_number || '';
    const vendorName = po.vendor_name || vendors?.find(v => v.id === po.vendor_id)?.name || 'the vendor';
    const amount = po.total_amount != null ? fmt(po.total_amount) : '';
    const dateStr = po.po_date ? new Date(po.po_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const label = `${poNo ? poNo + ' ' : ''}for ${vendorName}${amount ? ' totalling ' + amount : ''}${dateStr ? ' dated ' + dateStr : ''}`;
    return { label, poNo, vendorName };
}

async function approvePO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Approve Purchase Order',
        message: `Approve ${label}? This moves the PO from Draft to Approved. Once approved, it can be sent to the vendor. Only approved POs can be sent.`,
        confirmText: 'Approve',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/approve`), { method: 'POST' });
        Toast.success('Purchase order approved');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to approve purchase order'); }
}

async function sendPO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Send Purchase Order',
        message: `Mark ${label} as sent to the vendor? This updates the status from Approved to Sent. Use this after you have actually emailed or delivered the PO to the vendor.`,
        confirmText: 'Mark as Sent',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/send`), { method: 'POST' });
        Toast.success('Purchase order marked as sent');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to send purchase order'); }
}

async function receivePO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Receive Purchase Order',
        message: `Mark ${label} as received? This confirms that the goods or services have been received from the vendor. The PO will move from Sent to Received and become eligible for conversion to a vendor bill.`,
        confirmText: 'Mark as Received',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/receive`), { method: 'POST' });
        Toast.success('Purchase order marked as received');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to mark purchase order as received'); }
}

async function convertToBill(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Convert to Vendor Bill',
        message: `Convert ${label} to a vendor bill? This will create a new bill with the same line items and mark the PO as Billed. The new bill will start as a Draft and can then be approved and paid. This cannot be undone.`,
        confirmText: 'Convert to Bill',
        type: 'info'
    });
    if (!ok) return;
    try {
        const result = await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/convert-to-bill`), { method: 'POST' });
        // Response shape is { message, purchase_order_id, bill } — the bill
        // number lives on the nested bill object.
        const billNo = result?.bill?.bill_number || '';
        Toast.success(`Purchase order converted to bill${billNo ? ' ' + billNo : ''}`);
        // Navigate to payables page so user can see the new bill
        window.location.href = 'payables.html';
    } catch (err) { Toast.error(err.message || 'Failed to convert to bill'); }
}

async function cancelPO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Cancel Purchase Order',
        message: `Cancel ${label}? The purchase order will be marked as Cancelled. This cannot be undone. Only draft, approved, and sent POs can be cancelled.`,
        confirmText: 'Cancel PO',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/cancel`), { method: 'POST' });
        Toast.success('Purchase order cancelled');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to cancel purchase order'); }
}

async function deletePO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Delete Purchase Order',
        message: `Delete ${label}? Only draft purchase orders can be deleted. This cannot be undone.`,
        confirmText: 'Delete',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}`), { method: 'DELETE' });
        Toast.success('Purchase order deleted');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to delete purchase order'); }
}

// ============================================================================
// HELPERS
// ============================================================================

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

async function downloadPoPdf(id, poNumber) {
    try {
        const baseUrl = api._getBaseUrl('/accounts/');
        const url = `${baseUrl}/accounts/purchase-orders/${id}/pdf?tenantId=${AccountsCommon.getTenantId()}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${api.token}` } });
        if (!response.ok) throw new Error('Failed to download PDF');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `PO-${poNumber || id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        Toast.success('PO PDF downloaded');
    } catch (err) {
        console.error('[PurchaseOrders] PDF download error:', err);
        Toast.error('Failed to download PDF');
    }
}
