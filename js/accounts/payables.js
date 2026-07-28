/**
 * AccountsService — Accounts Payable Page
 *
 * Handles 4 sidebar tabs:
 *   1. Vendor Bills          3. AP Aging
 *   2. Payments              4. Vendor Statements
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let vendorBills = [];
let vendors = [];
let accounts = [];
let taxConfigs = [];
let costCentres = [];
let bankAccounts = [];
let billLines = [];
let currentBillPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let billVendorFilterDropdown = null;
let paymentVendorFilterDropdown = null;
let stmtVendorDropdown = null;
let dnVendorFilterDropdown = null;
let dnVendorDropdown = null;
let dnBillDropdown = null;
let billCfController = null;   // custom-fields section controller for the open vendor-bill form

// Render the bill's Custom Fields section (create → empty; edit → prefilled from stored values).
async function renderBillCustomFields(billId) {
    const host = document.getElementById('billCustomFields');
    if (!host) return;
    const defs = await AccountsCommon.getCustomFieldDefs('vendor_bill');
    const values = billId ? await AccountsCommon.loadCustomFieldValues('vendor_bill', billId) : {};
    billCfController = AccountsCommon.renderCustomFieldsSection(host, defs, values);
}
let debitNotes = [];
let dnPage = 1;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('payables', '../')) return;

    const tabNames = {
        'vendor-bills': 'Vendor Bills',
        'vendor-payments': 'Payments',
        'debit-notes': 'Debit Notes',
        'ap-aging': 'AP Aging',
        'vendor-statements': 'Vendor Statements'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    setupSearchListeners();
    initDatePickers();
});

// Flatpickr on every date field (matches the Receivables date control — no native <input type=date>).
function initDatePickers() {
    if (typeof flatpickr !== 'function') { setTimeout(initDatePickers, 300); return; }
    const opts = { dateFormat: 'Y-m-d', allowInput: true };
    // Filter-bar dates reload their list on change (mirrors the old inline onchange).
    flatpickr('#billFromDate', { ...opts, onChange: () => { currentBillPage = 1; loadVendorBills(); } });
    flatpickr('#billToDate', { ...opts, onChange: () => { currentBillPage = 1; loadVendorBills(); } });
    // Statement + modal dates: plain pickers (statement uses its Generate button).
    ['#stmtFromDate', '#stmtToDate', '#dnDate', '#billDate', '#billDueDate', '#paymentDate'].forEach(sel => flatpickr(sel, opts));
}

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    _acActiveRender = null;  // each tab's loader re-arms this for theme-toggle redraws
    switch (tabId) {
        case 'vendor-bills':      loadVendorBills(); break;
        case 'vendor-payments':   loadVendorPayments(); break;
        case 'debit-notes':       loadDebitNotes(); break;
        case 'ap-aging':          loadAPAging(); break;
        case 'vendor-statements': break; // user-triggered
    }
}

// ============================================================================
// CHARTS — per-subsection renderers (mirror of receivables; shared helpers live
// in accounts-charts.js). Each sets _acActiveRender so a theme toggle redraws.
// ============================================================================
const _AP_STATUS_COLOR = { approved: '#3b82f6', partially_paid: '#f59e0b', overdue: '#ef4444', draft: '#64748b', paid: '#10b981' };
const _AP_OUTSTANDING = new Set(['approved', 'sent', 'partially_paid', 'overdue']);
function _vendorName(o) { return o.vendor_name || (vendors || []).find(v => v.id === o.vendor_id)?.name || '—'; }
async function renderBillCharts(baseParams) {
    try {
        const res = await api.request(AccountsCommon.buildUrl('vendor-bills', { ...baseParams, limit: 1000, offset: 0 }), { _skipSpinner: true });
        const all = Array.isArray(res) ? res : (res?.data || res?.items || []);
        // Only truly-outstanding bills count toward "payable" — exclude draft/cancelled/paid/credited so
        // the donut total matches the Total Outstanding KPI (a cancelled bill can retain balance_due>0).
        const outstanding = all.filter(b => _AP_OUTSTANDING.has(b.status || 'approved') && parseFloat(b.balance_due ?? b.balance ?? 0) > 0);
        const byStatus = {};
        outstanding.forEach(b => { const s = b.status || 'approved'; byStatus[s] = (byStatus[s] || 0) + parseFloat(b.balance_due ?? b.balance ?? 0); });
        const st = Object.keys(byStatus);
        acDonut('billStatusChart', st.map(s => s.replace(/_/g, ' ')), st.map(s => Math.round(byStatus[s] * 100) / 100), st.map(s => _AP_STATUS_COLOR[s] || '#64748b'));
        const rank = _acRank(outstanding.map(b => ({ name: _vendorName(b), bal: parseFloat(b.balance_due ?? b.balance ?? 0) })), 'name', 'bal', 6);
        acBarH('billVendorChart', rank.labels, rank.data);
    } catch (e) { _acEmpty('billStatusChart'); _acEmpty('billVendorChart'); }
}
function renderVendorPaymentCharts(list) {
    const rows = (list || []).map(p => ({ ...p, _cash: parseFloat(p.amount || 0) }));
    const m = _acMonthly(rows, 'payment_date', '_cash', 6);
    acArea('vpayTrendChart', m.categories, m.data, 'Paid');
    const methods = {};
    rows.forEach(p => { const k = (p.payment_method || 'other').replace(/_/g, ' '); methods[k] = (methods[k] || 0) + p._cash; });
    const mk = Object.keys(methods).filter(k => methods[k] > 0);
    acDonut('vpayMethodChart', mk.map(k => k.replace(/\b\w/g, c => c.toUpperCase())), mk.map(k => Math.round(methods[k] * 100) / 100));
}
function renderDebitNoteCharts(list) {
    const m = _acMonthly(list || [], 'debit_date', 'amount', 6);
    acBarV('dnTrendChart', m.categories, m.data);
    const rank = _acRank((list || []).map(dn => ({ name: _vendorName(dn), amt: parseFloat(dn.amount || 0) })), 'name', 'amt', 6);
    acBarH('dnVendorChart', rank.labels, rank.data);
}
function renderAPAgingChart(normalized) {
    const sum = (f) => (normalized || []).reduce((s, r) => s + (parseFloat(r[f]) || 0), 0);
    acBarV('apAgingBucketChart', ['Current', '1-30', '31-60', '61-90', '90+'],
        [sum('current'), sum('days_1_30'), sum('days_31_60'), sum('days_61_90'), sum('days_90_plus')].map(v => Math.round(v * 100) / 100),
        ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444']);
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        // Phase 4 Tier 1 hot-fix — was loading 4 things in parallel, two of which were
        // confusingly named: a `coa?search=bank` call (returned GL accounts whose names
        // contained "bank", e.g. "Bank Accounts" parent, "Bank Charges" expense) was being
        // assigned to `bankAccounts`, and the REAL `/bank/accounts` was only used for a
        // name map. The Vendor Payment modal's bank picker then rendered GL accounts
        // instead of actual bank accounts → user couldn't select a valid bank → the
        // payment validation always failed silently. Dropped the broken coa preload and
        // assigned the real bank accounts to `bankAccounts`.
        const [vendorRes, accountRes, bankAcctRes, taxRes, ccRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('tax/configurations'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('cost-centres'), { _skipSpinner: true }).catch(() => [])
        ]);

        vendors = Array.isArray(vendorRes) ? vendorRes : (vendorRes?.data || vendorRes?.items || []);
        const acctData = Array.isArray(accountRes) ? accountRes : (accountRes?.data || accountRes?.items || []);
        accounts = acctData;
        bankAccounts = Array.isArray(bankAcctRes) ? bankAcctRes : (bankAcctRes?.data || bankAcctRes?.items || []);
        // Cost centres: optional analytical tag per bill line (active only, for new bills).
        costCentres = (Array.isArray(ccRes) ? ccRes : (ccRes?.data || ccRes?.items || [])).filter(c => c.status !== 'inactive');
        // Tax configurations seeded by "Initialize India GST" — drives Input
        // GST per Vendor Bill line so ITC is captured correctly.
        taxConfigs = Array.isArray(taxRes) ? taxRes : (taxRes?.data || []);
        // Build bank account name map for payment list rendering
        window._bankAccountMap = {};
        bankAccounts.forEach(b => { window._bankAccountMap[b.id] = b.account_name || b.bank_name || b.name; });

        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] loadInitialData error:', err);
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

    const billSearch = document.getElementById('billSearch');
    if (billSearch) billSearch.addEventListener('input', debounce(() => { currentBillPage = 1; loadVendorBills(); }));
}

// ============================================================================
// 1. VENDOR BILLS
// ============================================================================

async function loadVendorBills() {
    try {
        const vendorId = billVendorFilterDropdown?.getValue?.() || '';
        const status = document.getElementById('billStatusFilter')?.value || '';
        const fromDate = document.getElementById('billFromDate')?.value || '';
        const toDate = document.getElementById('billToDate')?.value || '';
        const search = document.getElementById('billSearch')?.value || '';

        const params = { limit: PAGE_SIZE, offset: (currentBillPage - 1) * PAGE_SIZE };
        if (vendorId) params.vendorId = vendorId;
        if (status) params.status = status;
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;
        if (search) params.search = search;

        const url = AccountsCommon.buildUrl('vendor-bills', params);
        const res = await api.request(url, { _skipSpinner: true });
        const data = res?.data || res?.items || (Array.isArray(res) ? res : []);
        vendorBills = data;

        // Charts read the full matching set (vendor + date; ignore status so the status split stays meaningful).
        const _billChartParams = { ...(vendorId ? { vendorId } : {}), ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
        renderBillCharts(_billChartParams);
        _acActiveRender = () => renderBillCharts(_billChartParams);

        // `total` feeds ONLY the pager below — the KPI tiles read res.stats.
        // Backend now returns the FILTERED count in `total`; use ?? (not ||) so a
        // legitimate total of 0 doesn't fall through to vendorBills.length and cap pages.
        const total = res?.total ?? res?.totalCount ?? vendorBills.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        // Clamp if actioning the last row on a page left us past the end (else an empty "No … found").
        if (currentBillPage > totalPages) { currentBillPage = totalPages; return loadVendorBills(); }

        // Update stats — prefer backend stats, fallback to client-side
        const stats = res?.stats || {};
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('totalBills', stats.total_count ?? stats.total_bills ?? total);
        el('draftBills', stats.draft_count ?? vendorBills.filter(b => b.status === 'draft').length);
        el('approvedBills', stats.approved_count ?? vendorBills.filter(b => b.status === 'approved').length);
        el('totalOutstanding', stats.total_outstanding != null ? AccountsCommon.formatCurrency(stats.total_outstanding) : AccountsCommon.formatCurrency(vendorBills.reduce((s, b) => s + (parseFloat(b.balance_due || b.balance) || 0), 0)));

        renderBillsTable();
        AccountsCommon.renderPagination('billsPagination', currentBillPage, totalPages, (page) => {
            currentBillPage = page;
            loadVendorBills();
        });
    } catch (err) {
        console.error('[Payables] loadVendorBills error:', err);
        Toast.error('Failed to load vendor bills');
    }
}

function renderBillsTable() {
    const tbody = document.getElementById('vendorBillsTable');
    if (!tbody) return;
    if (!vendorBills.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>No vendor bills found</p></div></td></tr>`;
        return;
    }
    const vendorMap = {};
    vendors.forEach(v => { vendorMap[v.id] = v.name || v.vendor_name; });
    const editSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    const cancelSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    const isAdmin = accountsRoles.isAdmin();
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;

    const viewSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    tbody.innerHTML = vendorBills.map(b => {
        // Every bill, regardless of status, gets a View button. Status-specific
        // actions are layered on top of that.
        const pdfSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        let actions = `<button class="btn-icon" onclick="viewBill('${b.id}')" data-tooltip="View">${viewSvg}</button><button class="btn-icon" onclick="downloadBillPdf('${b.id}', '${(b.bill_number||'').replace(/'/g,'')}')" data-tooltip="Download PDF">${pdfSvg}</button>`;
        if (isAdmin && b.status === 'draft') {
            actions += `<button class="btn-icon" onclick="editBill('${b.id}')" data-tooltip="Edit">${editSvg}</button><button class="btn-icon" onclick="approveBill('${b.id}')" data-tooltip="Approve">${checkSvg}</button><button class="btn-icon danger" onclick="cancelBill('${b.id}')" data-tooltip="Cancel">${cancelSvg}</button>`;
        } else if (isAdmin && (b.status === 'approved' || b.status === 'partially_paid')) {
            actions += `<button class="btn btn-sm btn-outline" onclick="showRecordPaymentModal('${b.id}')" data-tooltip="Record payment against this bill">Pay</button>`;
        }
        return `<tr>
            <td><code>${esc(b.bill_number || '-')}</code></td>
            <td>${esc(vendorMap[b.vendor_id] || b.vendor_name || '-')}</td>
            <td>${fmtD(b.bill_date)}</td><td>${fmtD(b.due_date)}</td>
            <td class="text-right">${fmt(b.total_amount ?? b.total ?? 0)}</td>
            <td class="text-right">${fmt(b.balance_due ?? b.total_amount ?? 0)}</td>
            <td>${AccountsCommon.statusBadge(b.status)}</td>
            <td class="actions-cell">${actions || '<span class="text-secondary">-</span>'}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// BILL MODAL — CREATE / EDIT
// ============================================================================

// ── Inventory item picker (bills): pre-filled purchase lines from the catalog ──
let inventoryItems = [];
let billItemPickerDD = null;

async function initBillItemPicker() {
    const container = document.getElementById('billItemPicker');
    if (!container || typeof SearchableDropdown !== 'function') return;
    if (!inventoryItems.length) {
        try { inventoryItems = await api.request(AccountsCommon.buildUrl('inventory/items'), { _skipSpinner: true }); } catch { inventoryItems = []; }
    }
    const opts = [{ value: '', label: '+ Add from item catalog…' },
        ...inventoryItems.filter(i => i.is_active).map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }))];
    container.innerHTML = '';
    billItemPickerDD = new SearchableDropdown(container, {
        id: 'billItemPickerDD', options: opts, value: '', placeholder: '+ Add from item catalog…',
        searchPlaceholder: 'Search SKU / name…', compact: true,
        onChange: (v) => {
            if (!v) return;
            const it = inventoryItems.find(x => x.id === v);
            if (it) addBillLine({
                item_id: it.id, description: it.name, quantity: 1,
                unit_price: it.purchase_price ?? it.sale_price,
                account_id: AccountsCommon.postableAccounts(accounts, 'expense')[0]?.id || '',
                ...(it.tax_config_id ? { tax_config_id: it.tax_config_id } : {})
            });
            billItemPickerDD.setValue?.('');
        }
    });
}

// ── Scan-to-receive: barcode/SKU field on the bill form ─────────────────────
// A truckload of dealer stock is received by scanning: USB scanners type the
// code + Enter into #billScanInput; each scan adds the item as a line at its
// purchase price, and a REPEAT scan bumps that line's quantity instead of
// duplicating it. Items are matched by barcode first, then SKU.

function findItemByCode(code) {
    const q = (code || '').trim().toLowerCase();
    if (!q) return null;
    return inventoryItems.find(i => i.is_active && (i.barcode || '').toLowerCase() === q)
        || inventoryItems.find(i => i.is_active && i.sku.toLowerCase() === q);
}

function billReceiveItem(item, qty = 1, unitCost = null, description = null) {
    // The pristine starter line (no item, no description, zero rate) just gets in the
    // way once real receiving starts — drop it before adding the first scanned line.
    const rows = document.querySelectorAll('#billLinesBody tr');
    if (rows.length === 1 && !rows[0].dataset.itemId
        && !(rows[0].querySelector('.line-desc')?.value || '').trim()
        && !parseFloat(rows[0].querySelector('.line-rate')?.value || '0')) {
        rows[0].remove();
    }
    // Repeat scan → bump the existing line for this item.
    const existing = document.querySelector(`#billLinesBody tr[data-item-id="${item.id}"]`);
    if (existing) {
        const qtyInput = existing.querySelector('.line-qty');
        qtyInput.value = (parseFloat(qtyInput.value) || 0) + qty;
        calculateBillTotals();
        return existing;
    }
    addBillLine({
        item_id: item.id, description: description || item.name, quantity: qty,
        unit_price: unitCost ?? (item.purchase_price ?? item.sale_price),
        account_id: AccountsCommon.postableAccounts(accounts, 'expense')[0]?.id || '',
        ...(item.tax_config_id ? { tax_config_id: item.tax_config_id } : {})
    });
    return document.querySelector('#billLinesBody tr:last-child');
}

function wireBillScanInput() {
    const input = document.getElementById('billScanInput');
    if (!input || input._wired) return;
    input._wired = true;
    input.addEventListener('keydown', async e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const code = input.value.trim();
        input.value = '';
        if (!code) return;
        if (!inventoryItems.length) await initBillItemPicker();
        const item = findItemByCode(code);
        if (!item) { Toast.error(`No item with barcode/SKU '${code}' — add it in Inventory (or use CSV import with auto-create).`); return; }
        const row = billReceiveItem(item);
        row?.scrollIntoView({ block: 'nearest' });
        Toast.success(`${item.name} — qty ${row?.querySelector('.line-qty')?.value || 1}`);
    });
}

// ── Dealer-invoice CSV → bill lines ─────────────────────────────────────────

function showBillCsvModal() {
    document.getElementById('billCsvBox').value = '';
    document.getElementById('billCsvPreview').textContent = '';
    document.getElementById('billCsvFile').value = '';
    AccountsCommon.openModal('billCsvModal');
}

async function billCsvFilePicked(e) {
    const f = e.target.files?.[0];
    if (f) document.getElementById('billCsvBox').value = await f.text();
}

/** Quote-aware CSV rows (handles "quoted, commas" and "" escapes). */
function parseBillCsv(text) {
    if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip UTF-8 BOM (Excel exports)
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
        else if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(c => c.trim() !== '')) rows.push(row);
            row = [];
        } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    return rows;
}

async function runBillCsvImport() {
    const text = document.getElementById('billCsvBox').value.trim();
    if (!text) { Toast.error('Paste or upload the CSV first'); return; }
    const autoCreate = document.getElementById('billCsvAutoCreate').checked;
    if (!inventoryItems.length) await initBillItemPicker();

    const rows = parseBillCsv(text);
    let added = 0, bumped = 0, created = 0;
    const failed = [];
    const btn = document.getElementById('billCsvImportBtn');
    btn.disabled = true;
    try {
        for (const cells of rows) {
            const code = (cells[0] || '').trim();
            if (!code || /^(barcode|sku|barcode_or_sku|code)$/i.test(code)) continue;   // header row
            const qty = parseFloat(cells[1]);
            const cost = cells[2] !== undefined && String(cells[2]).trim() !== '' ? parseFloat(cells[2]) : null;
            const desc = (cells[3] || '').trim() || null;
            if (!(qty > 0)) { failed.push(`${code} (bad qty)`); continue; }
            if (cost !== null && !(cost >= 0)) { failed.push(`${code} (bad cost)`); continue; }
            let item = findItemByCode(code);
            if (!item && autoCreate) {
                try {
                    // New product from the dealer: numeric codes are barcodes, others become the SKU.
                    const isBarcode = /^\d{8,14}$/.test(code);
                    item = await api.request(AccountsCommon.buildUrl('inventory/items'), {
                        method: 'POST',
                        body: JSON.stringify({
                            sku: isBarcode ? 'ITM-' + code.slice(-6) : code,
                            name: desc || code,
                            item_type: 'goods', track_inventory: true, unit: 'pcs',
                            purchase_price: cost ?? 0, sale_price: cost ?? 0,
                            ...(isBarcode ? { barcode: code } : {})
                        }),
                        _skipSpinner: true
                    });
                    inventoryItems.push(item);
                    created++;
                } catch (err) { failed.push(`${code} (create: ${err.message})`); continue; }
            }
            if (!item) { failed.push(code); continue; }
            const before = document.querySelector(`#billLinesBody tr[data-item-id="${item.id}"]`);
            billReceiveItem(item, qty, cost, desc);
            before ? bumped++ : added++;
        }
    } finally { btn.disabled = false; }

    const bits = [`${added} line${added === 1 ? '' : 's'} added`];
    if (bumped) bits.push(`${bumped} merged into existing lines`);
    if (created) bits.push(`${created} item${created === 1 ? '' : 's'} auto-created`);
    document.getElementById('billCsvPreview').innerHTML = failed.length
        ? `<span style="color:var(--color-error);">Unmatched (${failed.length}): ${AccountsCommon.escapeHtml(failed.join(', '))}${autoCreate ? '' : ' — tick auto-create or add them in Inventory first'}</span>`
        : '';
    if (added || bumped) {
        Toast.success(bits.join(' · '));
        if (!failed.length) AccountsCommon.closeModal('billCsvModal');
    } else if (failed.length) {
        Toast.error('No rows matched your item catalog');
    }
}

// Document-currency picker (display-layer FX) — shared controller from AccountsCommon.
const billFx = AccountsCommon.createFxPicker({
    containerId: 'billCurrencyContainer', rateGroupId: 'billRateGroup',
    rateInputId: 'billExchangeRate', rateHintId: 'billRateHint',
    dateFieldId: 'billDate', ddId: 'billCurrencyDD',
    onUpdate: () => calculateBillTotals()
});

function showCreateBillModal() {
    document.getElementById('billForm').reset();
    document.getElementById('billId').value = '';
    document.getElementById('billDate').value = AccountsCommon.todayLocal();
    billFx.init(AccountsCommon.FX_BASE);
    initBillItemPicker();
    wireBillScanInput();
    populateBillVendorSelect();
    clearBillLines();
    addBillLine();
    setBillModalMode('create');
    renderBillCustomFields(null);
    AccountsCommon.showFormPage('vendorBillModal');
}

function setBillModalMode(mode, bill) {
    // mode: 'create' | 'edit' | 'view'
    const isView = mode === 'view';
    const billNumber = bill?.bill_number || '';
    const status = (bill?.status || '').toUpperCase();

    const title = document.getElementById('billModalTitle');
    const saveDraft = document.getElementById('billSaveDraftBtn');
    const saveApprove = document.getElementById('billSaveApproveBtn');
    const form = document.querySelector('#vendorBillModal form, #vendorBillModal .modal-body');
    if (title) {
        if (mode === 'create') title.textContent = 'Create Vendor Bill';
        else if (mode === 'edit') title.textContent = `Edit Vendor Bill ${billNumber}`;
        else title.textContent = `View Vendor Bill ${billNumber} (${status} — read-only)`;
    }
    if (saveDraft) saveDraft.style.display = isView ? 'none' : '';
    if (saveApprove) saveApprove.style.display = isView ? 'none' : '';
    if (form) {
        form.querySelectorAll('input, select, textarea, button').forEach(el => {
            // Always keep Close/Cancel buttons usable
            if (el.classList?.contains('close-btn')) return;
            if (/^Cancel$/i.test(el.innerText?.trim() || '')) return;
            if (isView) el.setAttribute('disabled', 'disabled');
            else el.removeAttribute('disabled');
            if ('readOnly' in el) el.readOnly = isView;
        });
    }

    // Status-aware read-only banner.
    // Draft bills are viewed read-only when opened via the eye icon, but they
    // are NOT yet booked to the GL — copy must reflect that. Once approved or
    // beyond, the bill is in GSTR-2A territory and editing is locked for
    // compliance, not just display.
    const modal = document.getElementById('vendorBillModal');
    let banner = modal?.querySelector('.bill-readonly-banner');
    const statusLower = (bill?.status || 'draft').toLowerCase();
    const isPostedToGl = statusLower !== 'draft' && statusLower !== 'cancelled';

    if (isView && modal) {
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'bill-readonly-banner';
            // Rebuilt as a full-page .acc-form-page: content is in <form class="acc-form">, not .modal-body.
            // (The optional-chaining guard meant no crash, but the banner silently never appeared.)
            const body = modal.querySelector('.acc-form') || modal.querySelector('.modal-body') || modal.querySelector('.acc-form-page__inner');
            body?.insertBefore(banner, body.firstChild);
        }
        if (isPostedToGl) {
            banner.style.cssText = 'background: color-mix(in srgb, var(--color-warning, #ed6c02) 14%, var(--bg-card-hover)); color: var(--text-primary); padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 0.85rem; border: 1px solid color-mix(in srgb, var(--color-warning, #ed6c02) 35%, transparent);';
            banner.innerHTML = `
                <strong>This bill is ${statusLower.toUpperCase()} and cannot be edited.</strong><br>
                Once a vendor bill is booked into the GL, the related Input Tax Credit (ITC)
                is part of your purchase register and will reconcile against GSTR-2A.
                To make corrections, <em>cancel this bill</em> or raise a <em>debit note</em>,
                then create a fresh bill.
            `;
        } else if (statusLower === 'cancelled') {
            banner.style.cssText = 'background: color-mix(in srgb, var(--color-error, #ef4444) 12%, var(--bg-card-hover)); color: var(--text-primary); padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 0.85rem; border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 35%, transparent);';
            banner.innerHTML = `
                <strong>This bill is cancelled and cannot be edited.</strong><br>
                Cancelled bills are kept for the audit trail. Create a new bill if you need
                to record a fresh vendor invoice.
            `;
        } else {
            // Draft, opened in view mode (e.g. via the eye icon).
            banner.style.cssText = 'background: color-mix(in srgb, var(--brand-primary, #3b82f6) 12%, var(--bg-card-hover)); color: var(--text-primary); padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 0.85rem; border: 1px solid color-mix(in srgb, var(--brand-primary, #3b82f6) 35%, transparent);';
            banner.innerHTML = `
                <strong>Read-only preview — this draft bill has not been posted to the ledger yet.</strong><br>
                A draft bill has <em>no GL impact</em> and does not appear in your purchase
                register. Close this dialog and click <strong>Edit</strong> to modify it,
                or <strong>Approve</strong> to post it to the GL and start the AP / GSTR-2A flow.
            `;
        }
    } else if (!isView && banner) {
        banner.remove();
    }
}

async function loadBillIntoModal(id, mode) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`vendor-bills/${id}`));
        const bill = res?.data || res;
        if (!bill) { Toast.error('Bill not found'); return; }

        // GST law mirror of the customer invoice rule: once a vendor bill is
        // approved (status != 'draft'), it's been booked into the GL and any
        // related ITC is reportable. Editing it would corrupt the purchase
        // register / GSTR-2A reconciliation. Force view-mode regardless of
        // what the caller asked for.
        const isDraft = (bill.status || 'draft') === 'draft';
        const effectiveMode = isDraft ? mode : 'view';

        document.getElementById('billId').value = bill.id;
        document.getElementById('billDate').value = (bill.bill_date || '').substring(0, 10);
        document.getElementById('billDueDate').value = (bill.due_date || '').substring(0, 10);
        document.getElementById('billPoReference').value = bill.po_reference || '';
        document.getElementById('billNotes').value = bill.notes || '';
        // TDS fields were removed from the modal — guard against null
        const tdsAmtEl = document.getElementById('billTdsAmount');
        const tdsSecEl = document.getElementById('billTdsSection');
        if (tdsAmtEl) tdsAmtEl.value = bill.tds_amount || '';
        if (tdsSecEl) tdsSecEl.value = '';
        populateBillVendorSelect(bill.vendor_id);

        clearBillLines();
        const lines = bill.lines || bill.line_items || [];
        // FX bills store line amounts in INR; display them back in the document currency
        // at the captured rate so the user edits what the vendor's bill actually says.
        const billFxRate = bill.exchange_rate ? parseFloat(bill.exchange_rate) : 0;
        await billFx.init(bill.currency || AccountsCommon.FX_BASE, billFxRate);
        initBillItemPicker();
        if (billFxRate > 0) {
            lines.forEach(l => {
                const inr = parseFloat(l.unit_price ?? l.rate ?? 0);
                l.unit_price = Math.round((inr / billFxRate) * 100) / 100;
            });
        }
        if (lines.length) {
            lines.forEach(l => addBillLine(l));
        } else {
            addBillLine();
        }
        calculateBillTotals();
        await renderBillCustomFields(bill.id);
        setBillModalMode(effectiveMode, bill);
        AccountsCommon.showFormPage('vendorBillModal');
    } catch (err) {
        console.error('[Payables] loadBillIntoModal error:', err);
        Toast.error('Failed to load bill details');
    }
}

async function editBill(id) { return loadBillIntoModal(id, 'edit'); }
async function viewBill(id) { return loadBillIntoModal(id, 'view'); }

function populateBillVendorSelect(selectedId) {
    const sel = document.getElementById('billVendor');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Vendor...</option>' +
        vendors.map(v => `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${AccountsCommon.escapeHtml(v.name || v.vendor_name)}</option>`).join('');
    if (!sel._treatmentHooked) { sel._treatmentHooked = true; sel.addEventListener('change', onBillVendorChange); }
    onBillVendorChange();
}

/** True when the selected bill vendor charges no GST (unregistered / composition / overseas → no ITC). */
function _billVendorIsExempt() {
    const vid = document.getElementById('billVendor')?.value;
    const t = vendors.find(x => x.id === vid)?.gst_treatment;
    return !!(t && t !== 'registered');
}

/** Flag when the selected vendor charges no GST AND force lines to "No tax" + recalc, so the preview total
 *  matches what the backend posts (no input tax credit is recognised for an exempt vendor). */
function onBillVendorChange() {
    const exempt = _billVendorIsExempt();
    if (exempt) {
        document.querySelectorAll('#billLinesBody tr').forEach(row => row._lineTaxDropdown?.setValue?.(''));
        calculateBillTotals();
    }
    const banner = document.getElementById('billTreatmentBanner');
    if (!banner) return;
    const vid = document.getElementById('billVendor')?.value;
    const t = vendors.find(x => x.id === vid)?.gst_treatment;
    if (exempt) {
        const label = t === 'overseas'
            ? 'Overseas vendor — the bill carries no Indian GST (import IGST is paid separately at customs).'
            : (t === 'composition' ? 'Composition vendor — issues a bill of supply.' : 'Unregistered vendor.');
        banner.style.display = '';
        banner.innerHTML = '🚫 <strong>No input GST</strong> — ' + label + ' No input tax credit is recognised; every line has been set to “No tax” and the preview posts at the net amount.';
    } else {
        banner.style.display = 'none';
    }
}

// ============================================================================
// LINE ITEMS
// ============================================================================

function clearBillLines() {
    billLines = [];
    const tbody = document.getElementById('billLinesBody');
    if (tbody) tbody.innerHTML = '';
}

function addBillLine(data) {
    const idx = billLines.length;
    // Normalize: backend uses unit_price, frontend uses rate
    if (data && data.unit_price !== undefined && data.rate === undefined) {
        data.rate = data.unit_price;
    }
    // A fresh line (Add Line click, no data) inherits the previous row's GL account —
    // same convenience as invoices; still editable per line. Read the DOM select, not
    // billLines[]: the dropdown's onChange only syncs the hidden select, so the array
    // holds the value from load time, not the user's current pick.
    if (!data && !AccountsCommon.requirePrevLineAccount(document.getElementById('billLinesBody'))) return;
    const inheritedAcct = !data ? (document.querySelector('#billLinesBody tr:last-child .line-account')?.value || '') : '';
    billLines.push(data || { description: '', account_id: inheritedAcct, quantity: 1, rate: 0 });

    const tbody = document.getElementById('billLinesBody');
    if (!tbody) return;

    const row = document.createElement('tr');
    row.dataset.lineIdx = idx;
    if (data && data.item_id) row.dataset.itemId = data.item_id;

    const d = billLines[idx];
    const accountOpts = '<option value="">Select...</option>' +
        AccountsCommon.postableAccounts(accounts, 'expense').map(a => {
            const code = a.account_code || a.code || '';
            const name = a.account_name || a.name || '';
            const label = code && name ? `${code} — ${name}` : (name || code);
            return `<option value="${a.id}" ${a.id === d.account_id ? 'selected' : ''}>${AccountsCommon.escapeHtml(label)}</option>`;
        }).join('');

    // Same column order as the Purchase Order modal: Account first (primary
    // selection), then Description, Qty, Unit Price, Tax, Amount, delete.
    row.innerHTML = `
        <td><select class="form-control line-account" data-no-sd="true">${accountOpts}</select><div class="searchable-dropdown-container line-account-sd"></div></td>
        <td><input type="text" class="form-control line-desc" value="${AccountsCommon.escapeHtml(d.description || '')}" placeholder="Description"></td>
        <td><input type="number" class="form-control line-qty" value="${d.quantity ?? 1}" min="0" step="any" oninput="calculateBillTotals()"></td>
        <td><input type="number" class="form-control line-rate" value="${d.rate ?? 0}" min="0" step="0.01" placeholder="0.00" oninput="calculateBillTotals()"></td>
        <td><div class="searchable-dropdown-container line-tax-sd"></div></td>
        <td><div class="searchable-dropdown-container line-cc-sd"></div></td>
        <td class="line-amount" style="text-align:right; padding-top:0.7rem;">0.00</td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="removeBillLine(${idx})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);

    // Hide the native select + wire a SearchableDropdown with quick-add
    const select = row.querySelector('.line-account');
    select.style.display = 'none';
    if (d.account_id) select.value = d.account_id;

    const buildAccountOptions = () => [
        { value: '', label: 'Select...' },
        ...AccountsCommon.postableAccounts(accounts, 'expense').map(a => {
            const code = a.account_code || a.code || '';
            const name = a.account_name || a.name || '';
            return { value: a.id, label: code && name ? `${code} — ${name}` : (name || code) };
        })
    ];
    const accDd = new SearchableDropdown(row.querySelector('.line-account-sd'), {
        id: `bill-line-account-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: buildAccountOptions(),
        value: d.account_id || '',
        placeholder: 'Select account...',
        searchPlaceholder: 'Search accounts…',
        compact: true,
        quickAdd: {
            title: 'Create new account',
            onClick: (instance) => openBillQuickAddAccount(instance, buildAccountOptions)
        },
        onChange: (v) => { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    row._lineAccountDropdown = accDd;

    // Tax dropdown — Input GST per line, defaults to GST 18%
    const taxOptions = [
        { value: '', label: 'No tax (0%)' },
        ...taxConfigs.map(t => ({ value: t.id, label: `${t.name || t.tax_type || 'Tax'} (${_billTaxRateFor(t.id)}%)` }))
    ];
    // A new line defaults to No-tax when the vendor is GST-exempt (else GST 18%), so the preview never
    // overstates a no-ITC bill; an edited line keeps its persisted tax_config_id.
    const initialTaxId = data?.tax_config_id !== undefined ? (data.tax_config_id || '') : (_billVendorIsExempt() ? '' : _billDefaultTaxConfigId());
    const taxDd = new SearchableDropdown(row.querySelector('.line-tax-sd'), {
        id: `bill-line-tax-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: taxOptions,
        value: initialTaxId,
        placeholder: 'No tax',
        searchPlaceholder: 'Search tax…',
        compact: true,
        onChange: () => calculateBillTotals()
    });
    row._lineTaxDropdown = taxDd;

    // Cost centre — optional analytical tag per line (does not affect the GL).
    const ccOptions = [
        { value: '', label: 'No cost centre' },
        ...costCentres.map(c => ({ value: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name }))
    ];
    const ccDd = new SearchableDropdown(row.querySelector('.line-cc-sd'), {
        id: `bill-line-cc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: ccOptions,
        value: (data?.cost_centre_id) || '',
        placeholder: 'None',
        searchPlaceholder: 'Search cost centres…',
        compact: true
    });
    row._lineCostCentreDropdown = ccDd;

    calculateBillTotals();
}

function _billTaxRateFor(configId) {
    const cfg = taxConfigs.find(t => t.id === configId);
    if (!cfg) return 0;
    // Rate is nested at configuration.total_rate on the list payload; flat keys are fallbacks.
    const r = Number(cfg.configuration?.total_rate ?? cfg.rate ?? cfg.tax_rate ?? cfg.percentage ?? 0);
    if (r) return r;
    if (Array.isArray(cfg.rates)) {
        return cfg.rates.reduce((s, r) => s + Number(r.rate_percentage ?? r.percentage ?? 0), 0);
    }
    const m = (cfg.name || '').match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
}
function _billDefaultTaxConfigId() {
    if (!taxConfigs || !taxConfigs.length) return '';
    const eighteen = taxConfigs.find(t => /18/.test(t.name || '') || _billTaxRateFor(t.id) === 18);
    return eighteen ? eighteen.id : taxConfigs[0].id;
}

// Inline quick-add for Account from inside the Vendor Bill line — same
// pattern as PO. Opens a small modal, POSTs to /coa, refreshes the
// dropdown, auto-selects the new account.
async function openBillQuickAddAccount(dropdownInstance, rebuildOptions) {
    let m = document.getElementById('billQuickAddAccountModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'billQuickAddAccountModal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="max-width: 520px;">
                    <div class="modal-header">
                        <h5 class="modal-title">Quick Add Account</h5>
                        <button class="close-btn" onclick="AccountsCommon.closeModal('billQuickAddAccountModal')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                    <div class="modal-body">
                        <div class="form-row two-col">
                            <div class="form-group"><label for="billQaCode">Code *</label><input type="text" id="billQaCode" class="form-control" required></div>
                            <div class="form-group"><label for="billQaName">Name *</label><input type="text" id="billQaName" class="form-control" required></div>
                        </div>
                        <div class="form-row">
                            <div class="form-group"><label for="billQaType">Account Type *</label><div class="searchable-dropdown-container" id="billQaTypeContainer"></div></div>
                        </div>
                        <div id="billQaError" hidden style="margin-top:0.5rem; padding:0.5rem 0.75rem; border-radius:6px; background: color-mix(in srgb, var(--color-error, #c33) 12%, var(--bg-card-hover)); color: var(--color-error, #c33); font-size: 0.85rem;"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="AccountsCommon.closeModal('billQuickAddAccountModal')">Cancel</button>
                        <button class="btn btn-primary" id="billQaSaveBtn">Save</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);
    }
    document.getElementById('billQaCode').value = '';
    document.getElementById('billQaName').value = '';
    document.getElementById('billQaError').hidden = true;

    const typeContainer = document.getElementById('billQaTypeContainer');
    typeContainer.innerHTML = '';
    let types = [];
    try {
        const tr = await api.request(AccountsCommon.buildUrl('coa/types'), { _skipSpinner: true });
        types = Array.isArray(tr) ? tr : (tr?.data || []);
    } catch { types = []; }
    const typeDd = new SearchableDropdown(typeContainer, {
        id: 'billQaType-sd',
        options: [{ value: '', label: '— select —' }, ...types.map(t => ({ value: t.id, label: t.name }))],
        value: '', placeholder: '— select —', compact: false
    });

    AccountsCommon.openModal('billQuickAddAccountModal');
    setTimeout(() => document.getElementById('billQaCode').focus(), 100);

    document.getElementById('billQaSaveBtn').onclick = async () => {
        const code = document.getElementById('billQaCode').value.trim();
        const name = document.getElementById('billQaName').value.trim();
        const typeId = typeDd.selectedValue;
        const errEl = document.getElementById('billQaError');
        errEl.hidden = true;
        if (!code || !name || !typeId) {
            errEl.textContent = 'Code, Name, and Account Type are required.';
            errEl.hidden = false;
            return;
        }
        if (!AccountsCommon.beginSubmit('apQuickAddAccount')) return;
        try {
            const created = await api.request(AccountsCommon.buildUrl('coa'), {
                method: 'POST',
                body: JSON.stringify({ account_code: code, account_name: name, account_type_id: typeId })
            });
            const fresh = await api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true });
            accounts = Array.isArray(fresh) ? fresh : (fresh?.data || fresh?.items || []);
            const newId = created?.id || accounts.find(a => a.account_code === code)?.id;
            dropdownInstance.refreshOptions(rebuildOptions(), newId);
            const tr = dropdownInstance.container.closest('tr');
            const sel = tr?.querySelector('.line-account');
            if (sel && newId) {
                const opt = document.createElement('option');
                opt.value = newId; opt.textContent = `${code} — ${name}`; opt.selected = true;
                sel.appendChild(opt); sel.value = newId;
            }
            // Refresh other lines too
            document.querySelectorAll('#billLinesBody tr').forEach(r => {
                const other = r._lineAccountDropdown;
                if (other && other !== dropdownInstance) other.refreshOptions(rebuildOptions(), other.selectedValue);
            });
            Toast.success(`Account ${code} created and selected.`);
            AccountsCommon.closeModal('billQuickAddAccountModal');
        } catch (err) {
            errEl.textContent = err?.message || 'Failed to create account.';
            errEl.hidden = false;
        } finally {
            AccountsCommon.endSubmit('apQuickAddAccount');
        }
    };
}

function removeBillLine(index) {
    const tbody = document.getElementById('billLinesBody');
    if (!tbody) return;
    const row = tbody.querySelector(`tr[data-line-idx="${index}"]`);
    if (row) row.remove();
    billLines[index] = null; // mark removed
    calculateBillTotals();
}

function calculateBillTotals() {
    const tbody = document.getElementById('billLinesBody');
    if (!tbody) return;
    let subtotal = 0;
    let totalTax = 0;

    tbody.querySelectorAll('tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const amt = qty * rate;
        subtotal += amt;

        const taxConfigId = row._lineTaxDropdown?.selectedValue || '';
        const taxPct = _billTaxRateFor(taxConfigId);
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

    const sub = document.getElementById('billSubtotal');
    const tax = document.getElementById('billTax');
    const tot = document.getElementById('billTotal');
    const cur = billFx.currency();
    const sym = cur === AccountsCommon.FX_BASE ? '' : AccountsCommon.fxSymbol(cur);
    if (sub) sub.textContent = sym + subtotal.toFixed(2);
    if (tax) tax.textContent = sym + totalTax.toFixed(2);
    if (tot) tot.textContent = sym + (subtotal + totalTax).toFixed(2);
    const fxRow = document.getElementById('billFxEquiv');
    if (fxRow) {
        const rate = billFx.rate();
        if (cur !== AccountsCommon.FX_BASE && rate > 0) {
            fxRow.style.display = '';
            fxRow.innerHTML = `<span>Posted to books as</span><span>≈ ₹${((subtotal + totalTax) * rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })} @ ${rate}</span>`;
        } else {
            fxRow.style.display = 'none';
        }
    }
}

// ============================================================================
// SAVE / APPROVE / CANCEL BILL
// ============================================================================

async function saveBill(approve = false) {
    // Enforce native input constraints (line qty/rate min="0") like saveInvoice does — without this a
    // negative quantity/rate reaches the backend and bounces with a raw 400 instead of a friendly hint.
    const form = document.getElementById('billForm');
    if (form && !form.reportValidity()) return;

    // Block early if a required custom field is empty — avoids creating the bill then failing its values write.
    const cfErr = AccountsCommon.validateRequiredCustomFields(billCfController);
    if (cfErr) { Toast.error(cfErr); return; }

    const id = document.getElementById('billId').value;
    const vendorId = document.getElementById('billVendor').value;
    const billDate = document.getElementById('billDate').value;
    const dueDate = document.getElementById('billDueDate').value;
    const poReference = document.getElementById('billPoReference').value.trim();
    const notes = document.getElementById('billNotes').value.trim();

    if (!vendorId || !billDate || !dueDate) {
        Toast.error('Vendor, Bill Date, and Due Date are required');
        return;
    }

    // Collect line items from DOM (now Account-first, with per-line tax)
    const tbody = document.getElementById('billLinesBody');
    const lines = [];
    let lineError = null;
    Array.from(tbody?.querySelectorAll('tr') || []).forEach((row, idx) => {
        const description = row.querySelector('.line-desc')?.value.trim() || '';
        const account_id = row.querySelector('.line-account')?.value || '';
        const quantity = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const tax_config_id = row._lineTaxDropdown?.selectedValue || null;
        const tax_rate = _billTaxRateFor(tax_config_id);
        const cost_centre_id = row._lineCostCentreDropdown?.selectedValue || null;
        // Skip fully-blank rows (no description, no account, no amount)
        if (!description && !account_id && rate <= 0) return;
        // Backend CreateVendorBillLineRequest.account_id is a non-nullable Guid —
        // sending null 400s. Require an account on every row that has any data.
        if (!account_id) {
            if (!lineError) lineError = `Line ${idx + 1}: select an account for this line item`;
            return;
        }
        lines.push({
            item_id: row.dataset.itemId || null,
            description,
            account_id,
            quantity,
            unit_price: rate,
            tax_config_id,
            tax_rate: tax_rate || 0,
            cost_centre_id
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

    // Note: TDS fields removed from this modal (they belonged in a separate
    // TDS workflow). If the backend still requires them, send 0/null defaults
    // so existing endpoints don't break.
    const billCurrency = billFx.currency();
    const billRate = billFx.rate();
    if (billCurrency !== AccountsCommon.FX_BASE) {
        if (!(billRate > 0)) {
            Toast.error(`Enter the exchange rate: how many ₹ one ${billCurrency} is worth`);
            return;
        }
        // Convert entered document-currency prices to INR — books run entirely in INR.
        lines.forEach(l => { l.unit_price = Math.round(l.unit_price * billRate * 100) / 100; });
    }

    const payload = {
        vendor_id: vendorId, bill_date: billDate, due_date: dueDate,
        currency: billCurrency,
        exchange_rate: billCurrency !== AccountsCommon.FX_BASE ? billRate : null,
        po_reference: poReference, notes, lines,
        tds_amount: 0, tds_section: null
    };

    // Disable both save buttons while the request is in flight — a double-click
    // fired two POSTs and created duplicate bills.
    const saveBtns = ['billSaveDraftBtn', 'billSaveApproveBtn']
        .map(bid => document.getElementById(bid)).filter(Boolean);
    saveBtns.forEach(b => b.disabled = true);
    try {
        let savedBill;
        try {
            if (id) {
                savedBill = await api.request(AccountsCommon.buildUrl(`vendor-bills/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            } else {
                savedBill = await api.request(AccountsCommon.buildUrl('vendor-bills'), { method: 'POST', body: JSON.stringify(payload) });
            }
        } catch (err) {
            console.error('[Payables] saveBill error:', err);
            Toast.error(err.message || 'Failed to save bill');
            return;
        }

        // The draft now exists. Approval is a separate step — if it fails, the draft must
        // still be surfaced (close modal + refresh) so the user doesn't re-submit and create a duplicate.
        if (approve && savedBill?.id) {
            try {
                await api.request(AccountsCommon.buildUrl(`vendor-bills/${savedBill.id}/approve`), { method: 'POST' });
                Toast.success('Bill created and approved');
            } catch (err) {
                console.error('[Payables] approveBill (chained) error:', err);
                Toast.error(`Saved as draft, but approval failed: ${err.message || 'unknown error'}`);
            }
        } else {
            Toast.success(id ? 'Bill updated' : 'Bill saved as draft');
        }
        // The document now exists — persist its custom-field values.
        if (savedBill?.id) {
            try { await AccountsCommon.saveCustomFieldValues('vendor_bill', savedBill.id, billCfController?.getValues?.() || {}); }
            catch (e) { Toast.error(e.message || 'Some custom fields were not saved'); }
        }
        AccountsCommon.hideFormPage('vendorBillModal');
        await loadVendorBills();
    } finally {
        saveBtns.forEach(b => b.disabled = false);
    }
}

async function approveBill(id) {
    const b = vendorBills.find(x => x.id === id);
    const fmt = AccountsCommon.formatCurrency;
    const billNo = b?.bill_number || '';
    const vendorName = b?.vendor_name || vendors.find(v => v.id === b?.vendor_id)?.name || 'the vendor';
    const amount = b?.total_amount != null ? fmt(b.total_amount) : '';
    const billDate = b?.bill_date ? new Date(b.bill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const label = b ? `${billNo ? billNo + ' ' : ''}from ${vendorName}${amount ? ' for ' + amount : ''}${billDate ? ' dated ' + billDate : ''}` : 'this vendor bill';
    const ok = await Confirm.show({
        title: 'Approve Vendor Bill',
        message: `Approve ${label}? The bill will move from Draft to Approved, post a journal entry (Dr Expense + Dr Input GST, Cr Accounts Payable), and become eligible for payment. This cannot be undone without reversing the journal entry.`,
        confirmText: 'Approve',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`vendor-bills/${id}/approve`), { method: 'POST' });
        Toast.success('Bill approved');
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] approveBill error:', err);
        Toast.error(err.message || 'Failed to approve bill');
    }
}

async function cancelBill(id) {
    const b = vendorBills.find(x => x.id === id);
    const fmt = AccountsCommon.formatCurrency;
    const billNo = b?.bill_number || '';
    const vendorName = b?.vendor_name || vendors.find(v => v.id === b?.vendor_id)?.name || 'the vendor';
    const amount = b?.total_amount != null ? fmt(b.total_amount) : '';
    const label = b ? `${billNo ? billNo + ' ' : ''}from ${vendorName}${amount ? ' for ' + amount : ''}` : 'this vendor bill';
    const ok = await Confirm.show({
        title: 'Cancel Vendor Bill',
        message: `Cancel ${label}? The bill will be marked as cancelled and removed from Accounts Payable. If the bill was already approved, the associated journal entry will be reversed. This cannot be undone.`,
        confirmText: 'Cancel Bill',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`vendor-bills/${id}/cancel`), { method: 'POST' });
        Toast.success('Bill cancelled');
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] cancelBill error:', err);
        Toast.error(err.message || 'Failed to cancel bill');
    }
}

// ============================================================================
// BULK BILL IMPORT
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

function showBulkBillModal() {
    document.getElementById('bulkBillData').value = '';
    const fileInput = document.getElementById('bulkBillFile');
    if (fileInput) fileInput.value = '';
    AccountsCommon.openModal('bulkBillModal');
}

function handleBulkBillFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const content = e.target.result;
        if (file.name.endsWith('.json')) {
            document.getElementById('bulkBillData').value = content;
        } else if (file.name.endsWith('.csv')) {
            try {
                // Quote-aware parse — a naive split(',') shifted every column after
                // a quoted field containing a comma (e.g. "Acme, Inc.").
                const rows = _parseCsv(content);
                if (!rows.length) { Toast.error('CSV must have a header row and at least one data row'); return; }
                document.getElementById('bulkBillData').value = JSON.stringify(rows, null, 2);
            } catch (csvErr) {
                Toast.error('Failed to parse CSV file');
            }
        } else {
            Toast.error('Unsupported file type. Use .json or .csv');
        }
    };
    reader.readAsText(file);
}

async function submitBulkBills() {
    const text = document.getElementById('bulkBillData').value.trim();
    if (!text) { Toast.error('Please paste bill data or upload a file'); return; }
    if (!AccountsCommon.beginSubmit('submitBulkBills')) return;
    try {
        const bills = JSON.parse(text);
        if (!Array.isArray(bills)) { Toast.error('Data must be a JSON array'); return; }
        if (!bills.length) { Toast.error('Array is empty'); return; }
        // Backend BulkCreateBills binds a bare List<CreateVendorBillRequest> —
        // wrapping in { bills } binds null and 400s. Send the array itself.
        const res = await api.request(AccountsCommon.buildUrl('vendor-bills/bulk'), {
            method: 'POST',
            body: JSON.stringify(bills)
        });
        // Backend returns { total, created, results: [{ success, ... }] } — no failed/error_count.
        const created = res?.created ?? bills.length;
        const failed = Array.isArray(res?.results) ? res.results.filter(r => !r.success).length : 0;
        if (failed > 0) {
            Toast.warning(`${created} bills created, ${failed} failed`);
        } else {
            Toast.success(`${created} bills created successfully`);
        }
        AccountsCommon.closeModal('bulkBillModal');
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] submitBulkBills error:', err);
        Toast.error(err.message || 'Failed to import bills');
    } finally {
        AccountsCommon.endSubmit('submitBulkBills');
    }
}

// ============================================================================
// 2. VENDOR PAYMENTS
// ============================================================================

async function loadVendorPayments() {
    try {
        const vendorId = paymentVendorFilterDropdown?.getValue?.() || '';
        // Backend GetPayments defaults to 50 and returns a bare array with no
        // total, so there's no pager here — fetch the server cap (200) so the
        // list shows the most recent 200 payments instead of silently stopping at 50.
        const params = { limit: 200 };
        if (vendorId) params.vendorId = vendorId;

        const url = AccountsCommon.buildUrl('vendor-bills/payments', params);
        const res = await api.request(url, { _skipSpinner: true });
        const payments = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderPaymentsTable(payments);
        renderVendorPaymentCharts(payments);
        _acActiveRender = () => renderVendorPaymentCharts(payments);
    } catch (err) {
        console.error('[Payables] loadVendorPayments error:', err);
        Toast.error('Failed to load payments');
    }
}

function renderPaymentsTable(payments) {
    const tbody = document.getElementById('vendorPaymentsTable');
    if (!tbody) return;
    if (!payments.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg><p>No payments recorded</p></div></td></tr>`;
        return;
    }
    const vendorMap = {}, acctMap = {};
    vendors.forEach(v => { vendorMap[v.id] = v.name || v.vendor_name; });
    accounts.forEach(a => { acctMap[a.id] = a.account_name || a.name; });
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;
    const voidSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    const isAdmin = accountsRoles.isAdmin();

    tbody.innerHTML = payments.map(p => `<tr>
        <td><code>${esc(p.payment_number || '-')}</code></td>
        <td>${esc(vendorMap[p.vendor_id] || p.vendor_name || '-')}</td>
        <td>${fmtD(p.payment_date)}</td>
        <td class="text-right">${fmt(p.amount)}</td>
        <td>${esc(p.bank_account_name || p.bank_name || window._bankAccountMap?.[p.bank_account_id] || acctMap[p.bank_account_id] || (p.bank_account_id ? p.bank_account_id.substring(0, 8) + '...' : '-'))}</td>
        <td>${esc(p.reference_number || '-')}</td>
        <td class="actions-cell">${isAdmin ? `<button class="btn-icon danger" onclick="deletePayment('${p.id}')" data-tooltip="Void">${voidSvg}</button>` : '-'}</td>
    </tr>`).join('');
}

// ============================================================================
// PAYMENT MODAL
// ============================================================================

// One idempotency key per modal-open: retries/double-clicks of the SAME payment
// reuse the key (backend dedupes on the Idempotency-Key header), while a newly
// opened modal gets a fresh key so a genuine second payment is not swallowed.
let _paymentIdemKey = null;

function showRecordPaymentModal(billId) {
    _paymentIdemKey = crypto.randomUUID();
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentDate').value = AccountsCommon.todayLocal();
    populatePaymentVendorSelect();
    populatePaymentBankSelect();

    const allocBody = document.getElementById('paymentAllocBody');
    if (allocBody) allocBody.innerHTML = '<tr class="empty-state"><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">Select a vendor to see open bills</td></tr>';

    if (billId) {
        const bill = vendorBills.find(b => b.id === billId);
        if (bill) {
            document.getElementById('paymentVendor').value = bill.vendor_id;
            // Backend VendorBill uses balance_due — `balance`/`total` don't exist,
            // and a fully-paid bill (balance_due 0) must not prefill the total.
            document.getElementById('paymentAmount').value = bill.balance_due ?? '';
            loadVendorOpenBills(billId);
        }
    }
    AccountsCommon.openModal('vendorPaymentModal');
}

function populatePaymentVendorSelect(selectedId) {
    const sel = document.getElementById('paymentVendor');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Vendor...</option>' +
        vendors.map(v => `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${AccountsCommon.escapeHtml(v.name || v.vendor_name)}</option>`).join('');
}

function populatePaymentBankSelect(selectedId) {
    const sel = document.getElementById('paymentBankAccount');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Account...</option>' +
        bankAccounts.map(a => {
            const name = a.account_name || a.name || '';
            const bank = a.bank_name ? ` (${a.bank_name})` : '';
            return `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${AccountsCommon.escapeHtml(name + bank)}</option>`;
        }).join('');
}

async function loadVendorOpenBills(preSelectBillId) {
    const vendorId = document.getElementById('paymentVendor')?.value;
    const allocBody = document.getElementById('paymentAllocBody');
    if (!allocBody) return;

    if (!vendorId) {
        allocBody.innerHTML = '<tr class="empty-state"><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">Select a vendor to see open bills</td></tr>';
        return;
    }

    try {
        // Backend VendorBill model uses `balance_due` (NOT `balance` or `total`).
        // Old code's `b.balance || b.total` fallback resolved to undefined → 0 → filtered out everything.
        // Also: backend status filter is exact-match — fetch all approved+sent+partially_paid and pick > 0 client-side.
        const url = AccountsCommon.buildUrl('vendor-bills', { vendorId, limit: 200 });
        const res = await api.request(url, { _skipSpinner: true });
        const allBills = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const openBills = allBills.filter(b => {
            const bal = parseFloat(b.balance_due) || 0;
            const st = (b.status || '').toLowerCase();
            return bal > 0 && (st === 'approved' || st === 'sent' || st === 'partially_paid' || st === 'overdue');
        });

        if (!openBills.length) {
            allocBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">No open bills for this vendor</td></tr>';
            return;
        }

        allocBody.innerHTML = openBills.map(b => {
            const balance = parseFloat(b.balance_due) || 0;
            const preAlloc = (preSelectBillId === b.id) ? balance.toFixed(2) : '';
            const isFx = !!b.exchange_rate;
            const fxBadge = isFx ? ` <span style="font-size:0.72rem;color:var(--text-secondary);">(${AccountsCommon.escapeHtml(b.currency)} @ ${b.exchange_rate})</span>` : '';
            return `<tr>
                <td><code>${AccountsCommon.escapeHtml(b.bill_number || '-')}</code>${fxBadge}</td>
                <td>${AccountsCommon.formatDate(b.due_date)}</td>
                <td class="text-right">${AccountsCommon.formatCurrency(balance)}</td>
                <td><input type="number" class="form-control form-control-sm alloc-amount" data-bill-id="${b.id}" data-balance="${balance}" data-fx="${isFx ? '1' : ''}" value="${preAlloc}" min="0" max="${balance}" step="0.01" placeholder="0.00" oninput="updateVendorPaymentForex()"></td>
            </tr>`;
        }).join('');
        updateVendorPaymentForex();
    } catch (err) {
        console.error('[Payables] loadVendorOpenBills error:', err);
        allocBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">Failed to load bills</td></tr>';
    }
}

// Live forex preview for vendor payments: booked allocations vs what actually leaves the bank.
// Paying LESS than booked on a foreign-currency bill = forex gain; more = loss.
function updateVendorPaymentForex() {
    const hint = document.getElementById('vendorPaymentForexHint');
    if (!hint) return;
    const bankPaid = parseFloat(document.getElementById('paymentAmount')?.value) || 0;
    let alloc = 0, fxAlloc = false;
    document.querySelectorAll('#paymentAllocBody .alloc-amount').forEach(input => {
        const amt = parseFloat(input.value) || 0;
        if (amt > 0) { alloc += amt; if (input.dataset.fx) fxAlloc = true; }
    });
    const diff = Math.round((alloc - bankPaid) * 100) / 100;   // positive = gain (paid less than booked)
    if (!alloc || !bankPaid || diff === 0) { hint.style.display = 'none'; return; }
    hint.style.display = '';
    if (fxAlloc) {
        hint.style.color = diff > 0 ? 'var(--color-success)' : 'var(--color-error)';
        hint.textContent = diff > 0
            ? `Forex gain ${AccountsCommon.formatCurrency(diff)} will post to 4290 Foreign Exchange Gain/Loss`
            : `Forex loss ${AccountsCommon.formatCurrency(-diff)} will post to 4290 Foreign Exchange Gain/Loss`;
    } else {
        hint.style.color = 'var(--color-warning)';
        hint.textContent = `Allocations differ from the amount paid by ${AccountsCommon.formatCurrency(Math.abs(diff))}`;
    }
}

async function saveVendorPayment() {
    // Mirror the AR side: run native form validation first — it enforces the
    // required fields, min="0" on the amount (blocks negatives) and each
    // allocation row's max attribute (blocks over-allocating a single bill).
    const form = document.getElementById('paymentForm');
    if (form && !form.reportValidity()) return;

    const vendorId = document.getElementById('paymentVendor').value;
    const paymentDate = document.getElementById('paymentDate').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const bankAccountId = document.getElementById('paymentBankAccount').value;
    const referenceNumber = document.getElementById('paymentReference').value.trim();

    if (!vendorId || !paymentDate || !bankAccountId) {
        Toast.error('Vendor, Date, Amount, and Bank Account are required');
        return;
    }
    // min="0" on the input lets ₹0 through native validation — require strictly positive.
    if (isNaN(amount) || amount <= 0) {
        Toast.error('Payment amount must be greater than zero');
        return;
    }

    // Backend PaymentAllocationRequest expects { vendor_bill_id, allocated_amount }
    // — NOT { bill_id, amount }. Sending the wrong shape silently dropped allocations
    // server-side and left vendor bill balance_due unchanged. Fixed in Phase 4 Tier 1.
    const allocations = [];
    document.querySelectorAll('.alloc-amount').forEach(input => {
        const allocAmt = parseFloat(input.value) || 0;
        if (allocAmt > 0) {
            allocations.push({ vendor_bill_id: input.dataset.billId, allocated_amount: allocAmt });
        }
    });

    const allocatedTotal = Math.round(allocations.reduce((s, a) => s + a.allocated_amount, 0) * 100) / 100;
    // Booked-vs-bank difference: against a foreign-currency bill it IS the realized forex
    // gain/loss (positive = gain, we paid fewer rupees); otherwise it's a mistake and blocks.
    let anyFxAllocated = false;
    document.querySelectorAll('#paymentAllocBody .alloc-amount').forEach(input => {
        const amt = parseFloat(input.value) || 0;
        if (amt > 0 && input.dataset.fx) anyFxAllocated = true;
    });
    const forex = Math.round((allocatedTotal - amount) * 100) / 100;
    if (forex !== 0 && !anyFxAllocated) {
        Toast.error(`Allocated total (${AccountsCommon.formatCurrency(allocatedTotal)}) must equal the amount paid (${AccountsCommon.formatCurrency(amount)})`);
        return;
    }

    // `amount` = booked AP being settled (Σ allocations); the bank actually pays
    // amount - forex. With no FX difference this equals the legacy payload.
    const payload = {
        vendor_id: vendorId, payment_date: paymentDate, amount: allocatedTotal,
        forex_gain_loss: anyFxAllocated ? forex : 0,
        bank_account_id: bankAccountId, reference_number: referenceNumber,
        payment_method: document.getElementById('paymentMethod')?.value || 'bank_transfer',
        allocations
    };

    // Disable the submit button for the duration of the request (double-click =
    // duplicate POST) and send the per-modal-open Idempotency-Key so even a
    // network-level retry can't record the payment twice (backend dedupes on it).
    const saveBtn = document.getElementById('paymentSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('vendor-bills/payments'), {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { ...(_paymentIdemKey && { 'Idempotency-Key': _paymentIdemKey }) }
        });
        Toast.success('Payment recorded');
        AccountsCommon.closeModal('vendorPaymentModal');
        await loadVendorBills();
        await loadVendorPayments();
    } catch (err) {
        console.error('[Payables] saveVendorPayment error:', err);
        Toast.error(err.message || 'Failed to record payment');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function deletePayment(id) {
    const ok = await Confirm.danger('Void this payment? The allocated bills will be updated.', 'Void Payment');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`vendor-bills/payments/${id}`), { method: 'DELETE' });
        Toast.success('Payment voided');
        await loadVendorPayments();
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] deletePayment error:', err);
        Toast.error(err.message || 'Failed to void payment');
    }
}

// ============================================================================
// 3. AP AGING
// ============================================================================

async function loadAPAging() {
    try {
        const url = AccountsCommon.buildUrl('vendor-bills/aging');
        const res = await api.request(url, { _skipSpinner: true });
        const rawData = Array.isArray(res) ? res : (res?.data || res?.items || []);

        // Normalize field names from backend (current_amount, days_30...) to frontend (current, days_1_30...)
        const data = rawData.map(row => ({
            vendor_name: row.vendor_name,
            vendor_id: row.vendor_id,
            current: row.current_amount ?? row.current ?? 0,
            days_1_30: row.days_30 ?? row.days_1_30 ?? 0,
            days_31_60: row.days_60 ?? row.days_31_60 ?? 0,
            days_61_90: row.days_90 ?? row.days_61_90 ?? 0,
            days_90_plus: row.days_120_plus ?? row.days_90_plus ?? 0,
            total: row.total ?? 0
        }));

        // Compute summary from data
        const summary = res?.summary || {};
        const sumField = (field) => data.reduce((s, r) => s + (parseFloat(r[field]) || 0), 0);
        const fmt = (v) => AccountsCommon.formatCurrency(v || 0);
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('apCurrent', fmt(summary.current ?? sumField('current')));
        el('ap30', fmt(summary.days_1_30 ?? sumField('days_1_30')));
        el('ap60', fmt(summary.days_31_60 ?? sumField('days_31_60')));
        el('ap90', fmt(summary.days_61_90 ?? sumField('days_61_90')));
        el('ap90Plus', fmt(summary.days_90_plus ?? sumField('days_90_plus')));

        renderAPAgingChart(data);
        _acActiveRender = () => renderAPAgingChart(data);

        renderAPAgingTable(data);
    } catch (err) {
        console.error('[Payables] loadAPAging error:', err);
        Toast.error('Failed to load AP aging');
    }
}

function renderAPAgingTable(data) {
    const tbody = document.getElementById('apAgingTable');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><p>No aging data available</p></div></td></tr>`;
        return;
    }
    const fmt = (v) => AccountsCommon.formatCurrency(v || 0);
    const warn = (v) => (parseFloat(v) || 0) > 0 ? ' style="color:var(--color-danger)"' : '';

    tbody.innerHTML = data.map(row => {
        const t = [row.current, row.days_1_30, row.days_31_60, row.days_61_90, row.days_90_plus].reduce((s, v) => s + (parseFloat(v) || 0), 0);
        return `<tr><td>${AccountsCommon.escapeHtml(row.vendor_name || '-')}</td>
            <td class="text-right">${fmt(row.current)}</td><td class="text-right">${fmt(row.days_1_30)}</td>
            <td class="text-right"${warn(row.days_31_60)}>${fmt(row.days_31_60)}</td>
            <td class="text-right"${warn(row.days_61_90)}>${fmt(row.days_61_90)}</td>
            <td class="text-right"${warn(row.days_90_plus)}>${fmt(row.days_90_plus)}</td>
            <td class="text-right"><strong>${fmt(t)}</strong></td></tr>`;
    }).join('');
}

// ============================================================================
// 4. VENDOR STATEMENTS
// ============================================================================

async function loadVendorStatement() {
    const vendorId = stmtVendorDropdown?.getValue?.();
    const fromDate = document.getElementById('stmtFromDate')?.value || '';
    const toDate = document.getElementById('stmtToDate')?.value || '';
    const container = document.getElementById('vendorStatementContent');

    if (!vendorId) {
        Toast.error('Please select a vendor');
        return;
    }

    try {
        const params = {};
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;

        const url = AccountsCommon.buildUrl(`vendor-bills/vendors/${vendorId}/statement`, params);
        const res = await api.request(url, { _skipSpinner: true });
        const stmt = res?.data || res;

        // Merge bills and payments into a single transaction list
        const bills = (stmt.bills || []).map(b => ({
            date: b.bill_date,
            reference: b.bill_number,
            description: 'Vendor Bill',
            debit: parseFloat(b.total_amount) || 0,
            credit: 0
        }));
        const payments = (stmt.payments || []).map(p => ({
            date: p.payment_date,
            reference: p.payment_number,
            description: `Payment (${p.payment_method || 'bank_transfer'})`,
            debit: 0,
            credit: parseFloat(p.amount) || 0
        }));
        // Debit notes reduce what we owe the vendor — the mirror of the AR
        // statement's credit_notes merge. In this table's display convention
        // (bills sit in the Debit column and INCREASE the balance owed), a debit
        // note must land in the Credit column so the running balance reconciles
        // with the Outstanding header (backend: billed − paid − debit notes − TDS).
        const debitNoteTxns = (stmt.debit_notes || []).map(d => ({
            date: d.debit_date,
            reference: d.debit_note_number,
            description: 'Debit Note',
            debit: 0,
            credit: parseFloat(d.amount) || 0
        }));
        // TDS withheld on a bill is never paid to the vendor — surface it as a
        // credit on the bill date so the running balance nets it out, same as
        // the header's total_outstanding does.
        const tdsTxns = (stmt.bills || [])
            .filter(b => (parseFloat(b.tds_amount) || 0) > 0)
            .map(b => ({
                date: b.bill_date,
                reference: b.bill_number,
                description: 'TDS Deducted',
                debit: 0,
                credit: parseFloat(b.tds_amount) || 0
            }));
        const txns = stmt.transactions || [...bills, ...payments, ...debitNoteTxns, ...tdsTxns].sort((a, b) => new Date(a.date) - new Date(b.date));

        if (!txns.length) {
            container.innerHTML = '<div class="empty-message"><p>No transactions found for this vendor in the selected period</p></div>';
            return;
        }

        const vendor = vendors.find(v => v.id === vendorId);
        const vendorName = stmt.vendor_name || (vendor ? (vendor.name || vendor.vendor_name) : 'Vendor');
        const fmt = AccountsCommon.formatCurrency, esc = AccountsCommon.escapeHtml, fmtD = AccountsCommon.formatDate;
        let bal = parseFloat(stmt.opening_balance) || 0;
        const balLabels = [], balData = [];
        const rows = txns.map(t => {
            const dr = parseFloat(t.debit) || parseFloat(t.bill_amount) || 0;
            const cr = parseFloat(t.credit) || parseFloat(t.payment_amount) || 0;
            bal += dr - cr;
            balLabels.push(fmtD(t.date || t.bill_date || t.payment_date));
            balData.push(Math.round(bal * 100) / 100);
            return `<tr><td>${fmtD(t.date || t.bill_date || t.payment_date)}</td>
                <td>${esc(t.reference || t.bill_number || t.payment_number || '-')}</td>
                <td>${esc(t.description || t.type || '-')}</td>
                <td class="text-right">${dr ? fmt(dr) : '-'}</td><td class="text-right">${cr ? fmt(cr) : '-'}</td>
                <td class="text-right">${fmt(bal)}</td></tr>`;
        }).join('');

        const closingBal = bal;
        const totalBilled = stmt.total_billed || bills.reduce((s, b) => s + b.debit, 0);
        const totalPaid = stmt.total_paid || payments.reduce((s, p) => s + p.credit, 0);
        const outstanding = stmt.total_outstanding ?? closingBal;

        container.innerHTML = `<h3 class="stmt-title">${esc(vendorName)} — Statement</h3>
            <div class="stats-row">
                <div class="stat-card"><div class="stat-value">${fmt(totalBilled)}</div><div class="stat-label">Total Billed</div></div>
                <div class="stat-card"><div class="stat-value">${fmt(totalPaid)}</div><div class="stat-label">Total Paid</div></div>
                <div class="stat-card"><div class="stat-value stmt-outstanding">${fmt(outstanding)}</div><div class="stat-label">Outstanding</div></div>
            </div>
            <div class="acc-charts" style="grid-template-columns: 1fr;">
                <div class="acc-chart-card">
                    <h4>Outstanding balance over time</h4>
                    <div class="acc-chart-sub">Running balance owed after each bill, payment and debit note</div>
                    <div id="vstmtBalanceChart" class="acc-chart"></div>
                </div>
            </div>
            <div class="data-table-container"><table class="data-table">
            <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:1rem;">No transactions</td></tr>'}</tbody>
            </table></div>`;
        if (balData.length) {
            const draw = () => acArea('vstmtBalanceChart', balLabels, balData, 'Balance');
            draw();
            _acActiveRender = draw;
        }
    } catch (err) {
        console.error('[Payables] loadVendorStatement error:', err);
        Toast.error('Failed to load vendor statement');
        container.innerHTML = '<div class="empty-message"><p>Failed to load statement</p></div>';
    }
}

// ============================================================================
// SEARCHABLE DROPDOWNS INIT
// ============================================================================

function initDropdowns() {
    const vendorOpts = [{ value: '', label: 'All Vendors' }, ...vendors.map(v => ({ value: v.id, label: v.name || v.vendor_name }))];

    // Bill vendor filter
    const billVendorContainer = document.getElementById('billVendorFilterContainer');
    if (billVendorContainer) {
        billVendorFilterDropdown = new SearchableDropdown(billVendorContainer, {
            id: 'billVendorFilter',
            options: vendorOpts,
            placeholder: 'Filter by Vendor',
            compact: true,
            onChange: () => { currentBillPage = 1; loadVendorBills(); }
        });
    }

    // Payment vendor filter
    const paymentVendorContainer = document.getElementById('paymentVendorFilterContainer');
    if (paymentVendorContainer) {
        paymentVendorFilterDropdown = new SearchableDropdown(paymentVendorContainer, {
            id: 'paymentVendorFilter',
            options: vendorOpts,
            placeholder: 'Filter by Vendor',
            compact: true,
            onChange: () => loadVendorPayments()
        });
    }

    // Statement vendor dropdown
    const stmtContainer = document.getElementById('stmtVendorContainer');
    if (stmtContainer) {
        stmtVendorDropdown = new SearchableDropdown(stmtContainer, {
            id: 'stmtVendor',
            options: [{ value: '', label: 'Select Vendor' }, ...vendors.map(v => ({ value: v.id, label: v.name || v.vendor_name }))],
            placeholder: 'Select Vendor',
            compact: true
        });
    }

    // Debit Notes vendor filter
    const dnFilterContainer = document.getElementById('dnVendorFilterContainer');
    if (dnFilterContainer) {
        dnVendorFilterDropdown = new SearchableDropdown(dnFilterContainer, {
            id: 'dnVendorFilter',
            options: vendorOpts,
            placeholder: 'Filter by Vendor',
            compact: true,
            onChange: () => { dnPage = 1; loadDebitNotes(); }
        });
    }
}

// ============================================================================
// 5. DEBIT NOTES
// ============================================================================

async function loadDebitNotes() {
    try {
        const vendorId = dnVendorFilterDropdown?.getValue?.();
        const params = { limit: PAGE_SIZE, offset: (dnPage - 1) * PAGE_SIZE };
        if (vendorId) params.vendorId = vendorId;

        const res = await api.request(AccountsCommon.buildUrl('debit-notes', params), { _skipSpinner: true });
        debitNotes = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderDebitNoteCharts(debitNotes);
        _acActiveRender = () => renderDebitNoteCharts(debitNotes);
        const total = res?.total ?? debitNotes.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        if (dnPage > totalPages) { dnPage = totalPages; return loadDebitNotes(); }

        const tbody = document.getElementById('debitNotesTable');
        if (!tbody) return;

        if (!debitNotes.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No debit notes found</p></div></td></tr>';
            AccountsCommon.renderPagination('debitNotesPagination', 1, 1, () => {});
            return;
        }

        const esc = AccountsCommon.escapeHtml;
        const vendorMap = {};
        vendors.forEach(v => vendorMap[v.id] = v.name || v.vendor_name);

        tbody.innerHTML = debitNotes.map(dn => {
            const statusBadge = dn.status === 'approved' ? 'status-active'
                : dn.status === 'draft' ? 'status-pending' : 'status-pending';
            const actions = dn.status === 'draft'
                ? `<button class="btn btn-outline" style="padding:0.2rem 0.6rem;font-size:0.8rem;" onclick="approveDebitNote('${dn.id}')">Approve</button>`
                : '';
            return `<tr>
                <td><code>${esc(dn.debit_note_number || '-')}</code></td>
                <td>${esc(vendorMap[dn.vendor_id] || dn.vendor_name || '-')}</td>
                <td>${esc(dn.bill_number || '-')}</td>
                <td>${AccountsCommon.formatDate(dn.debit_date)}</td>
                <td>${AccountsCommon.formatCurrency(dn.amount)}</td>
                <td><span class="badge ${statusBadge}">${esc(dn.status || 'draft')}</span></td>
                <td>
                    <button class="btn btn-outline" style="padding:0.2rem 0.6rem;font-size:0.8rem;" onclick="viewDebitNote('${dn.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    ${actions}
                </td>
            </tr>`;
        }).join('');

        AccountsCommon.renderPagination('debitNotesPagination', dnPage, totalPages, p => { dnPage = p; loadDebitNotes(); });
    } catch (err) {
        console.error('[Payables] loadDebitNotes error:', err);
        Toast.error('Failed to load debit notes');
    }
}

function showCreateDebitNoteModal() {
    document.getElementById('dnModalTitle').textContent = 'Create Debit Note';
    document.getElementById('dnId').value = '';
    document.getElementById('dnDate').value = '';
    document.getElementById('dnAmount').value = '';
    document.getElementById('dnReason').value = '';

    // Vendor dropdown in modal
    const vendorContainer = document.getElementById('dnVendorContainer');
    if (vendorContainer) {
        vendorContainer.innerHTML = '';
        dnVendorDropdown = new SearchableDropdown(vendorContainer, {
            id: 'dnVendor',
            options: [{ value: '', label: 'Select Vendor' }, ...vendors.map(v => ({ value: v.id, label: v.name || v.vendor_name }))],
            placeholder: 'Select Vendor',
            onChange: (val) => loadBillsForDebitNote(val)
        });
    }

    // Bill dropdown (populated on vendor change)
    const billContainer = document.getElementById('dnBillContainer');
    if (billContainer) {
        billContainer.innerHTML = '';
        dnBillDropdown = new SearchableDropdown(billContainer, {
            id: 'dnBill',
            options: [{ value: '', label: 'Select Bill...' }],
            placeholder: 'Select Bill'
        });
    }

    AccountsCommon.openModal('debitNoteModal');
}

async function loadBillsForDebitNote(vendorId) {
    if (!vendorId || !dnBillDropdown) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('vendor-bills', { vendorId, limit: 200 }), { _skipSpinner: true });
        const bills = (res?.data || []).filter(b => b.status !== 'cancelled' && b.status !== 'draft');
        dnBillDropdown.setOptions([
            { value: '', label: 'Select Bill...' },
            ...bills.map(b => ({ value: b.id, label: `${b.bill_number} — ${AccountsCommon.formatCurrency(b.total_amount)}` }))
        ]);
    } catch (err) { console.error('[Payables] loadBillsForDN error:', err); }
}

async function saveDebitNote() {
    const vendorId = dnVendorDropdown?.getValue?.();
    const billId = dnBillDropdown?.getValue?.() || null;
    const debitDate = document.getElementById('dnDate').value;
    const amount = parseFloat(document.getElementById('dnAmount').value);
    const reason = document.getElementById('dnReason').value.trim();

    if (!vendorId || !debitDate || isNaN(amount) || amount <= 0) {
        Toast.error('Vendor, Date, and Amount are required');
        return;
    }
    // A debit note must adjust a specific bill (backend requires it) — else AP aging desyncs from GL.
    if (!billId) {
        Toast.error('Select the vendor bill this debit note adjusts.');
        return;
    }

    const payload = { vendor_id: vendorId, debit_date: debitDate, amount, reason: reason || null };
    if (billId) payload.vendor_bill_id = billId;

    // Disable the submit button during the request — double-click = duplicate debit note.
    const saveBtn = document.getElementById('dnSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('debit-notes'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Debit note created');
        AccountsCommon.closeModal('debitNoteModal');
        await loadDebitNotes();
    } catch (err) {
        console.error('[Payables] saveDebitNote error:', err);
        Toast.error(err.message || 'Failed to create debit note');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function approveDebitNote(id) {
    const ok = await Confirm.show({ title: 'Approve Debit Note', message: 'Approve this debit note? This will post a GL entry.', confirmText: 'Approve', type: 'info' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`debit-notes/${id}/approve`), { method: 'POST' });
        Toast.success('Debit note approved');
        await loadDebitNotes();
    } catch (err) {
        console.error('[Payables] approveDebitNote error:', err);
        Toast.error(err.message || 'Failed to approve debit note');
    }
}

async function viewDebitNote(id) {
    try {
        const dn = await api.request(AccountsCommon.buildUrl(`debit-notes/${id}`));
        const vendorName = vendors.find(v => v.id === dn.vendor_id)?.name || dn.vendor_name || '-';
        Toast.info(`${dn.debit_note_number} — ${vendorName} — ${AccountsCommon.formatCurrency(dn.amount)} — ${dn.status}`);
    } catch (err) {
        Toast.error('Failed to load debit note');
    }
}

async function downloadBillPdf(id, billNumber) {
    try {
        const baseUrl = api._getBaseUrl('/accounts/');
        const url = `${baseUrl}/accounts/vendor-bills/${id}/pdf?tenantId=${AccountsCommon.getTenantId()}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${api.token}` } });
        if (!response.ok) throw new Error('Failed to download PDF');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `Bill-${billNumber || id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        Toast.success('Bill PDF downloaded');
    } catch (err) {
        console.error('[Payables] PDF download error:', err);
        Toast.error('Failed to download PDF');
    }
}
