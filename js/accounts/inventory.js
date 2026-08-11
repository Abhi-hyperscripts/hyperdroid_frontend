/**
 * Inventory page — Items / Stock on Hand / Movements / Serials & Warranty.
 * Backend: /api/accounts/inventory/*
 */

let items = [];
let categories = [];
let itemDD = null, typeDD = null, catDD = null, adjItemDD = null, snItemDD = null, moveFilterDD = null;
// New-feature state
let locations = [];
let trackDD = null, valDD = null, schedDD = null;           // item modal enums
let locTypeDD = null, xfItemDD = null, xfFromDD = null, xfToDD = null, locBalDD = null;
let woItemDD = null, woLocDD = null, scLocDD = null, spItemDD = null;
let priceLists = [], selectedPriceListId = null;
const TRACK_OPTS = [{ value: 'none', label: 'None' }, { value: 'batch', label: 'Batch / lot (expiry, FEFO)' }, { value: 'serial', label: 'Serial (per-unit warranty)' }];
const VAL_OPTS = [{ value: 'weighted_avg', label: 'Weighted average' }, { value: 'fifo', label: 'FIFO' }];
const SCHED_OPTS = [{ value: 'none', label: 'None' }, { value: 'H', label: 'Schedule H' }, { value: 'H1', label: 'Schedule H1' }, { value: 'X', label: 'Schedule X' }];

const fmtMoney = v => AccountsCommon.formatCurrency(v);
const esc = s => AccountsCommon.escapeHtml(s ?? '');

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('inventory', '../')) return;
    const tabNames = { 'inv-items': 'Items', 'inv-stock': 'Stock on Hand', 'inv-locations': 'Locations', 'inv-batches': 'Batches & Expiry', 'inv-workorders': 'Work Orders', 'inv-count': 'Stock Count', 'inv-pricelists': 'Price Lists', 'inv-schemes': 'Schemes', 'inv-import': 'Bulk Import', 'inv-reorder': 'Reorder Report', 'inv-movements': 'Movements', 'inv-serials': 'Serials & Warranty' };
    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();
    AccountsCommon.initDatePickers(['adjDate', 'registerAsOf', 'xfDate', 'woDate', 'woExpiry', 'scDate', 'impAsOf']);
    AccountsCommon.setDateField('registerAsOf', AccountsCommon.todayLocal());
    document.getElementById('itemSearch')?.addEventListener('input', () => renderItems());
    document.getElementById('itemShowInactive')?.addEventListener('change', () => loadItems());
    document.getElementById('serialLookup')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookupSerial(); } });
    await loadCategories();
    await loadItems();
});

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'inv-items': loadItems(); break;
        case 'inv-stock': loadStock(); break;
        case 'inv-locations': loadLocationsTab(); break;
        case 'inv-batches': loadBatchesTab(); break;
        case 'inv-workorders': loadWorkOrders(); break;
        case 'inv-count': loadStockCounts(); break;
        case 'inv-pricelists': loadPriceLists(); break;
        case 'inv-schemes': loadSchemes(); break;
        case 'inv-reorder': loadReorder(); break;
        case 'inv-movements': loadMovements(); break;
        case 'inv-serials': loadSerials(); break;
    }
}

// ── Items ──────────────────────────────────────────────────────────────────
async function loadCategories() {
    try { categories = await api.request(AccountsCommon.buildUrl('inventory/categories'), { _skipSpinner: true }); } catch { categories = []; }
}

async function loadItems() {
    try {
        const inc = document.getElementById('itemShowInactive')?.checked;
        items = await api.request(AccountsCommon.buildUrl('inventory/items', inc ? { includeInactive: true } : {}), { _skipSpinner: true });
        renderItems();
    } catch (err) { console.error('[Inventory] loadItems', err); Toast.error('Failed to load items'); }
}

let itemVisFilter = '';   // '' | sellable | notsold | purchasable | notbought
function setItemVisFilter(v) {
    itemVisFilter = v;
    document.querySelectorAll('#itemVisChips .vis-chip').forEach(b => b.classList.toggle('on', b.dataset.vis === v));
    renderItems();
}
function matchesVis(i) {
    switch (itemVisFilter) {
        case 'sellable': return i.is_sellable !== false;
        case 'notsold': return i.is_sellable === false;
        case 'purchasable': return i.is_purchasable !== false;
        case 'notbought': return i.is_purchasable === false;
        default: return true;
    }
}

function renderItems() {
    const tb = document.getElementById('itemsTable');
    if (!tb) return;
    const q = (document.getElementById('itemSearch')?.value || '').toLowerCase();
    const rows = items.filter(i => (!q || i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)) && matchesVis(i));
    if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-secondary);">No items yet. Click "+ New Item" to create your product catalog.</td></tr>';
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    tb.innerHTML = rows.map(i => `<tr>
        <td><code>${esc(i.sku)}</code></td>
        <td>${esc(i.name)}${i.is_sellable === false ? ' <span class="status-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);font-size:.68rem;">Not sold</span>' : ''}${i.is_purchasable === false ? ' <span class="status-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);font-size:.68rem;">Not bought</span>' : ''}</td>
        <td>${esc(i.category_name || '-')}</td>
        <td>${i.item_type === 'goods' ? (i.tracking_mode === 'serial' ? 'Goods · serial' : 'Goods') : 'Service'}</td>
        <td>${fmtMoney(i.sale_price)}</td>
        <td>${i.track_inventory ? (i.qty_on_hand < 0 ? `<span style="color:var(--color-error);font-weight:600;">${i.qty_on_hand}</span>` : i.qty_on_hand) : '—'}</td>
        <td>${i.track_inventory ? fmtMoney(i.avg_cost) : '—'}</td>
        <td>${i.warranty_months ? i.warranty_months + ' mo' : '-'}</td>
        <td><span class="status-badge ${i.is_active ? 'status-active' : 'status-rejected'}">${i.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="actions-cell"><button class="btn-icon" onclick="showLabelModal('${i.id}')" data-tooltip="Print barcode labels"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5v14"/><path d="M7 5v14"/><path d="M11 5v14"/><path d="M15 5v14"/><path d="M19 5v14"/><path d="M21 5v14" stroke-width="1"/></svg></button>${isAdmin ? `${i.item_type === 'goods' && i.track_inventory ? `<button class="btn-icon" onclick="openBom('${i.id}')" data-tooltip="BOM / Build">⚙</button>` : ''}<button class="btn-icon" onclick="editItem('${i.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button class="btn-icon ${i.is_active ? 'danger' : ''}" onclick="toggleItem('${i.id}', ${!i.is_active})" data-tooltip="${i.is_active ? 'Deactivate' : 'Reactivate'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></button>` : ''}</td>
    </tr>`).join('');
}

function initItemModalDropdowns(selectedCat, selectedType) {
    const catOpts = [{ value: '', label: 'No category' }, ...categories.map(c => ({ value: c.id, label: c.name }))];
    catDD = new SearchableDropdown(document.getElementById('itCategory'), { id: 'itCatDD', options: catOpts, value: selectedCat || '', placeholder: 'No category', compact: true });
    typeDD = new SearchableDropdown(document.getElementById('itType'), {
        id: 'itTypeDD',
        options: [{ value: 'goods', label: 'Goods (stockable)' }, { value: 'service', label: 'Service' }],
        value: selectedType || 'goods', compact: true
    });
    trackDD = new SearchableDropdown(document.getElementById('itTracking'), { id: 'itTrackingDD', options: TRACK_OPTS, value: arguments[2] || 'none', compact: true });
    valDD = new SearchableDropdown(document.getElementById('itValuation'), { id: 'itValuationDD', options: VAL_OPTS, value: arguments[3] || 'weighted_avg', compact: true });
    schedDD = new SearchableDropdown(document.getElementById('itSchedule'), { id: 'itScheduleDD', options: SCHED_OPTS, value: arguments[4] || 'none', compact: true });
}

// Storefront images: parse the textarea (one URL per line) into a clean array of http(s) links (capped).
function parseItemImageUrls() {
    return (document.getElementById('itImageUrls').value || '')
        .split('\n').map(s => s.trim())
        .filter(u => /^https?:\/\//i.test(u))
        .slice(0, 12);
}

// Live thumbnail strip under the Image URLs field. Builds nodes via the DOM (no innerHTML) so a pasted URL
// can never inject markup; a URL that fails to load dims instead of showing a broken-image icon.
function renderItemImagePreview() {
    const host = document.getElementById('itImagePreview');
    if (!host) return;
    host.innerHTML = '';
    parseItemImageUrls().forEach((u, idx) => {
        const img = document.createElement('img');
        img.src = u;
        img.alt = 'Preview ' + (idx + 1);
        img.title = idx === 0 ? 'Main image' : u;
        img.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-tertiary);';
        img.onerror = () => { img.style.opacity = '.35'; img.title = 'Could not load: ' + u; };
        host.appendChild(img);
    });
}

function showItemModal() {
    document.getElementById('itemModalTitle').textContent = 'New Item';
    ['itemId', 'itSku', 'itName', 'itSalePrice', 'itPurchasePrice', 'itHsn', 'itBarcode', 'itPurchaseUnit', 'itPurchaseConv', 'itSaleUnit', 'itSaleConv', 'itRack', 'itDescription', 'itImageUrls'].forEach(id => document.getElementById(id).value = '');
    renderItemImagePreview();
    document.getElementById('itUnit').value = 'pcs';
    document.getElementById('itWarranty').value = '0';
    document.getElementById('itReorder').value = '0';
    document.getElementById('itReorderQty').value = '0';
    document.getElementById('itTrack').checked = true;
    document.getElementById('itSellable').checked = true;
    document.getElementById('itPurchasable').checked = true;
    ['itCategory', 'itType', 'itTracking', 'itValuation', 'itSchedule'].forEach(id => document.getElementById(id).innerHTML = '');
    initItemModalDropdowns(null, 'goods', 'none', 'weighted_avg', 'none');
    initItemSaltRows([]);
    AccountsCommon.showFormPage('itemModal');
}

function editItem(id) {
    const i = items.find(x => x.id === id);
    if (!i) return;
    document.getElementById('itemModalTitle').textContent = `Edit ${i.sku}`;
    document.getElementById('itemId').value = i.id;
    document.getElementById('itSku').value = i.sku;
    document.getElementById('itName').value = i.name;
    document.getElementById('itSalePrice').value = i.sale_price;
    document.getElementById('itPurchasePrice').value = i.purchase_price ?? '';
    document.getElementById('itHsn').value = i.hsn_sac || '';
    document.getElementById('itBarcode').value = i.barcode || '';
    document.getElementById('itUnit').value = i.unit;
    document.getElementById('itPurchaseUnit').value = i.purchase_unit || '';
    document.getElementById('itPurchaseConv').value = i.purchase_conversion ?? '';
    document.getElementById('itSaleUnit').value = i.sale_unit || '';
    document.getElementById('itSaleConv').value = i.sale_conversion ?? '';
    document.getElementById('itRack').value = i.rack || '';
    document.getElementById('itWarranty').value = i.warranty_months;
    document.getElementById('itReorder').value = i.reorder_level;
    document.getElementById('itReorderQty').value = i.reorder_quantity ?? 0;
    document.getElementById('itTrack').checked = i.track_inventory;
    document.getElementById('itSellable').checked = i.is_sellable !== false;
    document.getElementById('itPurchasable').checked = i.is_purchasable !== false;
    document.getElementById('itDescription').value = i.description || '';
    document.getElementById('itImageUrls').value = (Array.isArray(i.image_urls) ? i.image_urls : []).join('\n');
    renderItemImagePreview();
    ['itCategory', 'itType', 'itTracking', 'itValuation', 'itSchedule'].forEach(id => document.getElementById(id).innerHTML = '');
    initItemModalDropdowns(i.category_id, i.item_type, i.tracking_mode || 'none', i.valuation_method || 'weighted_avg', i.drug_schedule || 'none');
    initItemSaltRows(null, i.id);   // async-loads the item's saved composition
    AccountsCommon.showFormPage('itemModal');
}

async function saveItem() {
    const id = document.getElementById('itemId').value;
    const payload = {
        sku: document.getElementById('itSku').value.trim(),
        name: document.getElementById('itName').value.trim(),
        category_id: catDD?.getValue?.() || null,
        item_type: typeDD?.getValue?.() || 'goods',
        sale_price: parseFloat(document.getElementById('itSalePrice').value) || 0,
        purchase_price: parseFloat(document.getElementById('itPurchasePrice').value) || null,
        hsn_sac: document.getElementById('itHsn').value.trim() || null,
        barcode: document.getElementById('itBarcode').value.trim() || null,
        unit: document.getElementById('itUnit').value.trim() || 'pcs',
        purchase_unit: document.getElementById('itPurchaseUnit').value.trim() || null,
        // Send a typed 0 as 0 (not null) so the backend answers "must be > 0" instead of the
        // confusing "set both or neither" pair error when the user did fill both fields.
        purchase_conversion: document.getElementById('itPurchaseConv').value.trim() === '' ? null : parseFloat(document.getElementById('itPurchaseConv').value),
        sale_unit: document.getElementById('itSaleUnit').value.trim() || null,
        sale_conversion: document.getElementById('itSaleConv').value.trim() === '' ? null : parseFloat(document.getElementById('itSaleConv').value),
        rack: document.getElementById('itRack').value.trim() || null,
        warranty_months: parseInt(document.getElementById('itWarranty').value) || 0,
        reorder_level: parseFloat(document.getElementById('itReorder').value) || 0,
        reorder_quantity: parseFloat(document.getElementById('itReorderQty').value) || 0,
        track_inventory: document.getElementById('itTrack').checked,
        is_sellable: document.getElementById('itSellable').checked,
        is_purchasable: document.getElementById('itPurchasable').checked,
        description: document.getElementById('itDescription').value.trim() || null,
        image_urls: parseItemImageUrls(),
        tracking_mode: trackDD?.getValue?.() || 'none',
        valuation_method: valDD?.getValue?.() || 'weighted_avg',
        drug_schedule: schedDD?.getValue?.() || 'none'
    };
    if (!payload.sku || !payload.name) { Toast.error('SKU and name are required'); return; }
    const btn = document.getElementById('saveItemBtn'); btn.disabled = true;
    try {
        let savedId = id;
        if (id) await api.request(AccountsCommon.buildUrl(`inventory/items/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
        else savedId = (await api.request(AccountsCommon.buildUrl('inventory/items'), { method: 'POST', body: JSON.stringify(payload) }))?.id;
        // Composition rides in a second call (separate endpoint); only for goods. Guard: on an EDIT whose
        // composition is still async-loading (rows empty), skip the write entirely — otherwise we'd PUT an
        // empty set and WIPE the item's stored salts. A new item (no id) always writes (nothing to wipe).
        if (savedId && payload.item_type === 'goods' && (!id || _itemSaltsReady)) {
            try { await api.request(AccountsCommon.buildUrl(`inventory/items/${savedId}/salts`), { method: 'PUT', body: JSON.stringify({ salts: collectItemSalts() }) }); }
            catch (e) { Toast.error('Item saved, but the composition failed: ' + (e?.message || '')); }
        }
        Toast.success(id ? 'Item updated' : 'Item created');
        AccountsCommon.hideFormPage('itemModal');
        await loadItems();
    } catch (err) { Toast.error(err.message || 'Failed to save item'); }
    finally { btn.disabled = false; }
}

async function toggleItem(id, active) {
    try {
        await api.request(AccountsCommon.buildUrl(`inventory/items/${id}/activate`, { active }), { method: 'POST' });
        Toast.success(active ? 'Item reactivated' : 'Item deactivated');
        await loadItems();
    } catch (err) { Toast.error(err.message || 'Failed'); }
}

function showCategoryModal() { document.getElementById('catName').value = ''; AccountsCommon.openModal('categoryModal'); }

async function saveCategory() {
    const name = document.getElementById('catName').value.trim();
    if (!name) { Toast.error('Name is required'); return; }
    try {
        await api.request(AccountsCommon.buildUrl('inventory/categories'), { method: 'POST', body: JSON.stringify({ name }) });
        Toast.success('Category created');
        AccountsCommon.closeModal('categoryModal');
        await loadCategories();
    } catch (err) { Toast.error(err.message || 'Failed'); }
}

// ── Stock ──────────────────────────────────────────────────────────────────
async function loadStock() {
    try {
        const [rows, val, mismatches] = await Promise.all([
            api.request(AccountsCommon.buildUrl('inventory/stock'), { _skipSpinner: true }),
            api.request(AccountsCommon.buildUrl('inventory/valuation'), { _skipSpinner: true }),
            api.request(AccountsCommon.buildUrl('inventory/serial-mismatches'), { _skipSpinner: true }).catch(() => [])
        ]);
        renderSerialReconBanner(mismatches);
        document.getElementById('stockValueStat').textContent = fmtMoney(val.stock_value);
        document.getElementById('stockGlStat').textContent = fmtMoney(val.inventory_gl_balance);
        const sync = document.getElementById('stockSyncStat');
        sync.textContent = val.in_sync ? '✓ Yes' : `✗ Off by ${fmtMoney(Math.abs(val.difference))}`;
        sync.style.color = val.in_sync ? 'var(--color-success)' : 'var(--color-error)';
        document.getElementById('lowStockStat').textContent = rows.filter(r => r.below_reorder).length;
        const tb = document.getElementById('stockTable');
        tb.innerHTML = rows.length ? rows.map(r => `<tr>
            <td><code>${esc(r.sku)}</code></td><td>${esc(r.name)}</td><td>${esc(r.category_name || '-')}</td>
            <td>${r.qty_on_hand < 0 ? `<span style="color:var(--color-error);font-weight:600;">${r.qty_on_hand}</span>` : r.qty_on_hand} ${esc(r.unit)}</td>
            <td>${fmtMoney(r.avg_cost)}</td><td>${fmtMoney(r.stock_value)}</td>
            <td>${r.reorder_level || '-'}</td>
            <td>${r.below_reorder ? '<span class="status-badge status-pending">Low stock</span>' : ''}</td>
        </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-secondary);">No stocked items yet.</td></tr>';
    } catch (err) { console.error('[Inventory] loadStock', err); Toast.error('Failed to load stock'); }
}

function renderSerialReconBanner(mismatches) {
    const el = document.getElementById('serialReconBanner');
    if (!el) return;
    if (!Array.isArray(mismatches) || !mismatches.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const lines = mismatches.slice(0, 6).map(m =>
        `<code>${esc(m.sku)}</code> — ${m.qty_on_hand} on hand vs ${m.in_stock_serials} serial(s) registered <strong>(${m.delta > 0 ? '+' : ''}${m.delta})</strong>`).join('<br>');
    const more = mismatches.length > 6 ? `<br>…and ${mismatches.length - 6} more.` : '';
    el.innerHTML = `⚠️ <strong>${mismatches.length} serial-tracked item(s) need serial numbers registered.</strong> Units are in stock but their serials aren't recorded — scan them in via the Serials tab so warranty lookups stay accurate.<br><br>${lines}${more}`;
    el.style.display = 'block';
}

// One Idempotency-Key per modal-open for each stock-moving action (adjustment, transfer, assembly build, lot
// write-off). A retry/replay of the SAME action reuses the key so the backend dedupes it (these paths post no
// GL, or post stock+GL together — a lost-response resubmit would otherwise double-book stock, so the header
// marker is the only server-side guard; the btn.disabled only stops a rapid double-click). A fresh modal-open
// mints a new key so a genuinely new action is never swallowed.
let _adjIdemKey = null, _transferIdemKey = null, _buildIdemKey = null, _lotWoIdemKey = null;

function showAdjustModal() {
    _adjIdemKey = crypto.randomUUID();
    document.getElementById('adjQty').value = '';
    document.getElementById('adjCost').value = '';
    document.getElementById('adjNotes').value = '';
    document.getElementById('adjOpening').checked = false;
    AccountsCommon.setDateField('adjDate', AccountsCommon.todayLocal());
    const opts = items.filter(i => i.track_inventory && i.item_type === 'goods' && i.is_active)
        .map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }));
    document.getElementById('adjItem').innerHTML = '';
    adjItemDD = new SearchableDropdown(document.getElementById('adjItem'), { id: 'adjItemDD', options: opts, placeholder: 'Select item…', compact: true });
    AccountsCommon.openModal('adjustModal');
}

async function saveAdjustment() {
    const itemId = adjItemDD?.getValue?.();
    const qty = parseFloat(document.getElementById('adjQty').value);
    if (!itemId || !qty) { Toast.error('Item and a non-zero quantity are required'); return; }
    const btn = document.getElementById('saveAdjBtn'); btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('inventory/adjustments'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(_adjIdemKey && { 'Idempotency-Key': _adjIdemKey }) },
            body: JSON.stringify({
                item_id: itemId,
                adjustment_date: document.getElementById('adjDate').value,
                quantity_delta: qty,
                unit_cost: parseFloat(document.getElementById('adjCost').value) || null,
                is_opening: document.getElementById('adjOpening').checked,
                notes: document.getElementById('adjNotes').value.trim() || null
            })
        });
        Toast.success('Stock adjusted');
        AccountsCommon.closeModal('adjustModal');
        await loadItems();
        await loadStock();
    } catch (err) { Toast.error(err.message || 'Failed to adjust'); }
    finally { btn.disabled = false; }
}

// ── Movements ──────────────────────────────────────────────────────────────
const MOVE_LABELS = { opening: 'Opening', purchase_in: 'Purchase in', sale_out: 'Sale out', adjustment_in: 'Adjust +', adjustment_out: 'Adjust −', build_in: 'Build in', build_out: 'Build out' };

async function loadMovements() {
    try {
        if (!moveFilterDD) {
            const opts = [{ value: '', label: 'All items' }, ...items.map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }))];
            moveFilterDD = new SearchableDropdown(document.getElementById('moveItemFilter'), {
                id: 'moveFilterDD', options: opts, value: '', placeholder: 'All items', compact: true,
                onChange: () => loadMovements()
            });
        }
        const itemId = moveFilterDD?.getValue?.() || '';
        // unwrap(): /inventory/movements now returns { items, count, limit, offset, truncated } like every
        // other paged list, so a caller can tell a capped page from the whole set. unwrap tolerates both shapes.
        const rows = unwrap(await api.request(AccountsCommon.buildUrl('inventory/movements', itemId ? { itemId, limit: 200 } : { limit: 200 }), { _skipSpinner: true }));
        const tb = document.getElementById('movementsTable');
        tb.innerHTML = rows.length ? rows.map(m => {
            const isIn = m.movement_type.includes('in') || m.movement_type === 'opening';
            return `<tr>
                <td>${(m.movement_date || '').split('T')[0]}</td>
                <td><code>${esc(m.item_sku)}</code> ${esc(m.item_name)}</td>
                <td>${MOVE_LABELS[m.movement_type] || esc(m.movement_type)}</td>
                <td style="color:${isIn ? 'var(--color-success)' : 'var(--color-error)'};font-weight:600;">${isIn ? '+' : '−'}${m.quantity}</td>
                <td>${fmtMoney(m.unit_cost)}</td><td>${fmtMoney(m.total_cost)}</td>
                <td>${esc((m.reference_type || '-').replace(/_/g, ' '))}</td>
                <td>${esc(m.notes || '')}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-secondary);">No movements yet — approve a purchase bill or record an adjustment.</td></tr>';
        renderMovementCharts(rows);
    } catch (err) { console.error('[Inventory] loadMovements', err); }
}

// Charts for the stock ledger: monthly in-vs-out value flow + a by-type breakdown.
function renderMovementCharts(rows) {
    const isInMove = m => (m.movement_type || '').includes('in') || m.movement_type === 'opening';
    // Last 6 months of in/out value (at cost). Value (₹) is the common denominator across items.
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en-IN', { month: 'short' }) });
    }
    const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
    const inData = months.map(() => 0), outData = months.map(() => 0);
    rows.forEach(m => {
        const k = (m.movement_date || '').slice(0, 7);
        if (!(k in idx)) return;
        const v = Math.abs(parseFloat(m.total_cost) || 0);
        if (isInMove(m)) inData[idx[k]] += v; else outData[idx[k]] += v;
    });
    const r2 = v => Math.round(v * 100) / 100;
    _chart('acColumns', 'moveFlowChart', months.map(m => m.label),
        [{ name: 'Stock in', data: inData.map(r2) }, { name: 'Stock out', data: outData.map(r2) }],
        ['#10b981', '#ef4444']);
    // Movement composition by type (count).
    const byType = {};
    rows.forEach(m => { const t = MOVE_LABELS[m.movement_type] || m.movement_type || 'other'; byType[t] = (byType[t] || 0) + 1; });
    const tk = Object.keys(byType);
    _chart('acDonut', 'moveTypeChart', tk, tk.map(t => byType[t]), null, cnt);
}

// ── Serials & warranty ─────────────────────────────────────────────────────
async function loadSerials() {
    try {
        // unwrap(): /inventory/serials returns { items, count, limit, offset, truncated } like every other
        // paged list now, so a caller can tell a capped page from the whole set. unwrap tolerates both.
        const rows = unwrap(await api.request(AccountsCommon.buildUrl('inventory/serials', { limit: 200 }), { _skipSpinner: true }));
        const tb = document.getElementById('serialsTable');
        const badge = s => ({ in_stock: 'status-active', sold: 'status-pending', returned: 'status-pending', claimed: 'status-rejected' })[s] || '';
        tb.innerHTML = rows.length ? rows.map(s => `<tr>
            <td><code>${esc(s.serial_no)}</code></td>
            <td>${esc(s.item_sku)} ${esc(s.item_name)}</td>
            <td><span class="status-badge ${badge(s.status)}">${esc(s.status.replace('_', ' '))}</span></td>
            <td>${esc(s.sold_customer_name || '-')}</td>
            <td>${esc(s.sold_invoice_number || '-')}</td>
            <td>${s.sold_date ? s.sold_date.split('T')[0] : '-'}</td>
            <td>${s.warranty_expiry ? `${s.warranty_expiry.split('T')[0]} ${s.in_warranty ? '<span style="color:var(--color-success);">✓</span>' : '<span style="color:var(--color-error);">expired</span>'}` : '-'}</td>
            <td class="actions-cell">${s.status === 'sold' ? `<button class="btn-icon" onclick="setSerialStatus('${esc(AccountsCommon.escJs(s.serial_no))}','returned')" data-tooltip="Mark returned">↩</button><button class="btn-icon" onclick="setSerialStatus('${esc(AccountsCommon.escJs(s.serial_no))}','claimed')" data-tooltip="Warranty claim">🛠</button>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-secondary);">No serials yet. Receive serials against a serial-tracked item.</td></tr>';
    } catch (err) { console.error('[Inventory] loadSerials', err); }
}

async function lookupSerial() {
    const sn = document.getElementById('serialLookup').value.trim();
    const box = document.getElementById('serialLookupResult');
    if (!sn) { box.style.display = 'none'; return; }
    try {
        const s = await api.request(AccountsCommon.buildUrl(`inventory/serials/${encodeURIComponent(sn)}`), { _skipSpinner: true });
        box.style.display = '';
        const w = s.warranty_expiry
            ? (s.in_warranty
                ? `<span style="color:var(--color-success);font-weight:700;">IN WARRANTY</span> until ${s.warranty_expiry.split('T')[0]}`
                : `<span style="color:var(--color-error);font-weight:700;">OUT OF WARRANTY</span> (ended ${s.warranty_expiry.split('T')[0]})`)
            : 'No warranty on record';
        box.innerHTML = `<h4 style="margin-bottom:8px;"><code>${esc(s.serial_no)}</code> — ${esc(s.item_name)}</h4>
            <p>Status: <strong>${esc(s.status.replace('_', ' '))}</strong> · ${w}</p>
            ${s.sold_customer_name ? `<p>Sold to <strong>${esc(s.sold_customer_name)}</strong> on ${(s.sold_date || '').split('T')[0]} — invoice ${esc(s.sold_invoice_number || '-')}</p>` : '<p>Not sold yet (in stock).</p>'}`;
    } catch {
        box.style.display = '';
        box.innerHTML = `<p style="color:var(--color-error);">Serial '<code>${esc(sn)}</code>' not found.</p>`;
    }
}

function showReceiveSerialsModal() {
    const opts = items.filter(i => i.tracking_mode === 'serial' && i.is_active).map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }));
    if (!opts.length) { Toast.error('No serial-tracked items — edit an item and enable serial tracking first.'); return; }
    document.getElementById('snList').value = '';
    document.getElementById('snCost').value = '';
    document.getElementById('snItem').innerHTML = '';
    snItemDD = new SearchableDropdown(document.getElementById('snItem'), { id: 'snItemDD', options: opts, placeholder: 'Select item…', compact: true });
    AccountsCommon.openModal('serialsModal');
}

async function saveSerials() {
    const itemId = snItemDD?.getValue?.();
    const serials = document.getElementById('snList').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!itemId || !serials.length) { Toast.error('Item and at least one serial are required'); return; }
    try {
        const res = await api.request(AccountsCommon.buildUrl(`inventory/items/${itemId}/serials`), {
            method: 'POST',
            body: JSON.stringify({ serial_numbers: serials, unit_cost: parseFloat(document.getElementById('snCost').value) || null })
        });
        Toast.success(`${res.received} serial(s) received`);
        AccountsCommon.closeModal('serialsModal');
        await loadSerials();
    } catch (err) { Toast.error(err.message || 'Failed'); }
}

// ── CSV import ─────────────────────────────────────────────────────────────
function parseCsvRows() {
    const txt = document.getElementById('csvBox').value.trim();
    if (!txt) return [];
    const yes = v => ['y', 'yes', 'true', '1'].includes((v || '').trim().toLowerCase());
    return txt.split('\n').map(l => l.trim()).filter(Boolean)
        .filter(l => !/^sku\s*,/i.test(l))   // skip a header row
        .map(l => {
            const c = l.split(',').map(x => x.trim());
            return {
                sku: c[0], name: c[1],
                sale_price: parseFloat(c[2]) || 0,
                purchase_price: parseFloat(c[3]) || null,
                hsn_sac: c[4] || null,
                unit: c[5] || 'pcs',
                warranty_months: parseInt(c[6]) || 0,
                reorder_level: parseFloat(c[7]) || 0,
                track_inventory: c[8] !== undefined ? yes(c[8]) : true,
                tracking_mode: yes(c[9]) ? 'serial' : 'none',
                barcode: c[10] || null,
                item_type: 'goods'
            };
        }).filter(r => r.sku && r.name);
}

function showImportModal() {
    document.getElementById('csvBox').value = '';
    document.getElementById('csvPreview').textContent = '';
    document.getElementById('csvBox').oninput = () => {
        const rows = parseCsvRows();
        document.getElementById('csvPreview').textContent = rows.length ? `${rows.length} item(s) ready to import — first: ${rows[0].sku} "${rows[0].name}" @ ${rows[0].sale_price}` : '';
    };
    AccountsCommon.openModal('importModal');
}

async function runCsvImport() {
    const rows = parseCsvRows();
    if (!rows.length) { Toast.error('Nothing to import — paste CSV rows first'); return; }
    const btn = document.getElementById('csvImportBtn'); btn.disabled = true;
    let ok = 0; const fails = [];
    for (const r of rows) {
        btn.textContent = `Importing ${ok + fails.length + 1}/${rows.length}…`;
        try { await api.request(AccountsCommon.buildUrl('inventory/items'), { method: 'POST', body: JSON.stringify(r), _skipSpinner: true }); ok++; }
        catch (err) { fails.push(`${r.sku}: ${err.message}`); }
    }
    btn.disabled = false; btn.textContent = 'Import';
    if (fails.length) Toast.error(`${ok} imported, ${fails.length} failed — ${fails[0]}${fails.length > 1 ? ` (+${fails.length - 1} more)` : ''}`);
    else { Toast.success(`${ok} item(s) imported`); AccountsCommon.closeModal('importModal'); }
    await loadItems();
}

// ── Stock register (as-of print view) ──────────────────────────────────────
async function printStockRegister() {
    const asOf = document.getElementById('registerAsOf').value || AccountsCommon.todayLocal();
    try {
        const [rows, settingsRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('inventory/stock-register', { asOf }), { _skipSpinner: true }),
            api.request(AccountsCommon.buildUrl('settings'), { _skipSpinner: true }).catch(() => ({}))
        ]);
        const org = settingsRes?.data || settingsRes || {};
        const total = rows.reduce((s, r) => s + r.stock_value, 0);
        const w = window.open('', '_blank');
        if (!w) { Toast.error('Allow pop-ups to print'); return; }
        w.document.write(`<!DOCTYPE html><html><head><title>Stock Register ${asOf}</title><style>
            body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a1a1a;padding:28px;}
            h1{font-size:18px;} h2{font-size:14px;color:#555;font-weight:500;margin:4px 0 16px;}
            table{width:100%;border-collapse:collapse;margin-top:10px;}
            th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;}
            th{background:#f0f0f0;font-size:11px;text-transform:uppercase;}
            td.r,th.r{text-align:right;} tfoot td{font-weight:700;border-top:2px solid #1a1a1a;}
        </style></head><body>
            <h1>${esc(org.org_legal_name || 'Stock Register')}</h1>
            <h2>Closing stock as of ${asOf}${org.org_gstin ? ' · GSTIN ' + esc(org.org_gstin) : ''}</h2>
            <table><thead><tr><th>SKU</th><th>Item</th><th>Category</th><th class="r">Qty</th><th class="r">Avg Cost</th><th class="r">Value</th></tr></thead>
            <tbody>${rows.map(r => `<tr><td>${esc(r.sku)}</td><td>${esc(r.name)}</td><td>${esc(r.category_name || '-')}</td><td class="r">${r.qty_on_hand} ${esc(r.unit)}</td><td class="r">${(+r.avg_cost).toFixed(2)}</td><td class="r">${(+r.stock_value).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="6">No stock as of this date.</td></tr>'}</tbody>
            <tfoot><tr><td colspan="5">Total closing stock value</td><td class="r">₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr></tfoot>
            </table>
            <script>window.onload = () => window.print();<\/script>
        </body></html>`);
        w.document.close();
    } catch (err) { Toast.error(err.message || 'Failed to build the register'); }
}

// ── Barcode label printing ─────────────────────────────────────────────────
// Label stock formats: thermal roll printers print one label per page; A4 sheets
// use the two most common Indian label-sheet layouts (65-up and 24-up).
const LABEL_FORMATS = {
    t50x25: { label: 'Thermal roll · 50×25 mm', page: '@page{size:50mm 25mm;margin:0}', cell: 'width:50mm;height:25mm;page-break-after:always;', barcodeH: 34 },
    t40x25: { label: 'Thermal roll · 40×25 mm', page: '@page{size:40mm 25mm;margin:0}', cell: 'width:40mm;height:25mm;page-break-after:always;', barcodeH: 32 },
    a4x65: { label: 'A4 sheet · 65 labels (38.1×21.2 mm)', page: '@page{size:A4;margin:10.7mm 4.65mm}', grid: 'display:grid;grid-template-columns:repeat(5,38.1mm);grid-auto-rows:21.2mm;column-gap:2.5mm;', cell: 'width:38.1mm;height:21.2mm;overflow:hidden;', barcodeH: 26 },
    a4x24: { label: 'A4 sheet · 24 labels (64×34 mm)', page: '@page{size:A4;margin:12.7mm 7mm}', grid: 'display:grid;grid-template-columns:repeat(3,64mm);grid-auto-rows:34mm;column-gap:2.5mm;', cell: 'width:64mm;height:34mm;overflow:hidden;', barcodeH: 44 },
};
let labelSizeDD = null;

function labelCode(i) { return (i.barcode || i.sku || '').trim(); }

function showLabelModal(preselectId) {
    if (!labelSizeDD && typeof SearchableDropdown !== 'undefined') {
        labelSizeDD = new SearchableDropdown(document.getElementById('labelSizeContainer'), {
            options: Object.entries(LABEL_FORMATS).map(([value, f]) => ({ value, label: f.label })),
            placeholder: 'Label format…'
        });
        labelSizeDD.setValue?.('t50x25');
        document.getElementById('labelSearch').addEventListener('input', () => renderLabelRows());
    }
    renderLabelRows(preselectId);
    AccountsCommon.openModal('labelModal');
}

function renderLabelRows(preselectId) {
    const tb = document.getElementById('labelItemsTable');
    const q = (document.getElementById('labelSearch').value || '').toLowerCase();
    // Preserve any quantities already typed before re-rendering the filtered list.
    const kept = {};
    tb.querySelectorAll('input[data-item]').forEach(inp => { if (+inp.value > 0) kept[inp.dataset.item] = +inp.value; });
    if (preselectId) kept[preselectId] = kept[preselectId] || 1;
    const rows = items.filter(i => i.is_active && labelCode(i) &&
        (!q || i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)));
    tb.innerHTML = rows.map(i => `<tr>
        <td><code>${esc(i.sku)}</code></td>
        <td>${esc(i.name)}</td>
        <td style="font-size:0.8rem;color:var(--text-secondary);">${esc(labelCode(i))}${BarcodeRender.normalizeEan(labelCode(i)) ? ' · EAN-13' : ' · Code 128'}</td>
        <td><input type="number" min="0" max="500" data-item="${i.id}" class="form-control" style="height:32px;padding:0 8px;" value="${kept[i.id] || 0}"></td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--text-secondary);">No matching items (items need a barcode or SKU).</td></tr>';
}

function printLabels() {
    const fmt = LABEL_FORMATS[labelSizeDD?.getValue?.() || 't50x25'] || LABEL_FORMATS.t50x25;
    const showName = document.getElementById('labelShowName').checked;
    const showPrice = document.getElementById('labelShowPrice').checked;
    const wanted = [];
    document.querySelectorAll('#labelItemsTable input[data-item]').forEach(inp => {
        const qty = Math.min(500, +inp.value || 0);
        if (qty > 0) { const item = items.find(x => x.id === inp.dataset.item); if (item) wanted.push({ item, qty }); }
    });
    if (!wanted.length) { Toast.error('Set a label count on at least one item'); return; }

    const failed = [];
    const cells = [];
    for (const { item, qty } of wanted) {
        const svg = BarcodeRender.svg(labelCode(item), { height: fmt.barcodeH, moduleWidth: 2 });
        if (!svg) { failed.push(item.sku); continue; }
        const inner = `
            ${showName ? `<div style="font-size:7pt;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.name)}</div>` : ''}
            <div style="line-height:0;">${svg}</div>
            ${showPrice ? `<div style="font-size:8pt;font-weight:700;">₹${(+item.sale_price || 0).toLocaleString('en-IN')}</div>` : ''}`;
        for (let k = 0; k < qty; k++)
            cells.push(`<div style="${fmt.cell}box-sizing:border-box;padding:1mm 1.5mm;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">${inner}</div>`);
    }
    if (!cells.length) { Toast.error('None of the selected codes could be rendered'); return; }
    if (failed.length) Toast.error(`Skipped (unencodable code): ${failed.join(', ')}`);

    const w = window.open('', '_blank');
    if (!w) { Toast.error('Allow pop-ups to print'); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>Barcode labels</title><style>
        ${fmt.page}
        body{margin:0;font-family:'Segoe UI',Arial,sans-serif;color:#000;}
        svg{max-width:100%;height:auto;}
    </style></head><body>
        ${fmt.grid ? `<div style="${fmt.grid}">${cells.join('')}</div>` : cells.join('')}
        <script>window.onload = () => window.print();<\/script>
    </body></html>`);
    w.document.close();
    AccountsCommon.closeModal('labelModal');
}

// ── BOM / assembly ─────────────────────────────────────────────────────────
let bomDDs = [];

function bomComponentOptions() {
    const finishedId = document.getElementById('bomItemId').value;
    return items.filter(i => i.item_type === 'goods' && i.track_inventory && i.is_active && i.id !== finishedId)
        .map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }));
}

function addBomLine(line) {
    const tb = document.getElementById('bomLines');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><div class="searchable-dropdown-container bom-comp"></div></td>
        <td><input type="number" class="form-control bom-qty" min="0" step="any" value="${line?.quantity ?? 1}"></td>
        <td class="bom-onhand">${line ? line.qty_on_hand : '-'}</td>
        <td><button type="button" class="btn-icon danger" onclick="this.closest('tr').remove()">×</button></td>`;
    tb.appendChild(tr);
    const dd = new SearchableDropdown(tr.querySelector('.bom-comp'), {
        id: 'bomComp' + Math.random().toString(36).slice(2, 7),
        options: bomComponentOptions(), value: line?.component_item_id || '', placeholder: 'Component…', compact: true,
        onChange: v => { const it = items.find(x => x.id === v); tr.querySelector('.bom-onhand').textContent = it ? it.qty_on_hand : '-'; }
    });
    tr._dd = dd;
}

async function openBom(itemId) {
    _buildIdemKey = crypto.randomUUID();
    const it = items.find(x => x.id === itemId);
    document.getElementById('bomModalTitle').textContent = `BOM — ${it.sku} ${it.name}`;
    document.getElementById('bomItemId').value = itemId;
    document.getElementById('bomLines').innerHTML = '';
    document.getElementById('buildQty').value = '1';
    AccountsCommon.setDateField('buildDate', AccountsCommon.todayLocal());
    AccountsCommon.initDatePickers(['buildDate']);
    try {
        const bom = await api.request(AccountsCommon.buildUrl(`inventory/items/${itemId}/bom`), { _skipSpinner: true });
        (bom.lines || []).forEach(l => addBomLine(l));
    } catch { /* no bom yet */ }
    if (!document.querySelectorAll('#bomLines tr').length) addBomLine();
    document.getElementById('bomExplosionView').style.display = 'none';
    AccountsCommon.showFormPage('bomPage');
}

function collectBomLines() {
    return Array.from(document.querySelectorAll('#bomLines tr')).map(tr => ({
        component_item_id: tr._dd?.getValue?.() || '',
        quantity: parseFloat(tr.querySelector('.bom-qty').value) || 0
    })).filter(l => l.component_item_id && l.quantity > 0);
}

async function saveBom() {
    const itemId = document.getElementById('bomItemId').value;
    try {
        await api.request(AccountsCommon.buildUrl(`inventory/items/${itemId}/bom`), { method: 'PUT', body: JSON.stringify({ lines: collectBomLines() }) });
        Toast.success('BOM saved');
    } catch (err) { Toast.error(err.message || 'Failed to save BOM'); }
}

async function buildAssembly() {
    const itemId = document.getElementById('bomItemId').value;
    const qty = parseFloat(document.getElementById('buildQty').value);
    if (!qty || qty <= 0) { Toast.error('Enter a build quantity'); return; }
    const btn = document.getElementById('buildBtn'); btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl(`inventory/items/${itemId}/bom`), { method: 'PUT', body: JSON.stringify({ lines: collectBomLines() }) });
        const res = await api.request(AccountsCommon.buildUrl('inventory/builds'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(_buildIdemKey && { 'Idempotency-Key': _buildIdemKey }) },
            body: JSON.stringify({ finished_item_id: itemId, quantity: qty, build_date: document.getElementById('buildDate').value })
        });
        Toast.success(`Built ${qty} @ ${AccountsCommon.formatCurrency(res.unit_cost)} each`);
        AccountsCommon.hideFormPage('bomPage');
        await loadItems();
    } catch (err) { Toast.error(err.message || 'Build failed'); }
    finally { btn.disabled = false; }
}

async function setSerialStatus(sn, status) {
    try {
        await api.request(AccountsCommon.buildUrl(`inventory/serials/${encodeURIComponent(sn)}/status`), { method: 'POST', body: JSON.stringify({ status }) });
        Toast.success(`Marked ${status.replace('_', ' ')}`);
        await loadSerials();
    } catch (err) { Toast.error(err.message || 'Failed'); }
}

// ════════════════════════════════════════════════════════════════════════════
//  NEW FEATURE TABS — Locations · Batches/Expiry · Work Orders · Stock Count ·
//  Price Lists · Reorder.  Backend: /api/accounts/{inventory,work-orders,
//  stock-counts,price-lists}/*
// ════════════════════════════════════════════════════════════════════════════
const unwrap = r => Array.isArray(r) ? r : (r?.data || r?.balances || r?.items || r?.entries || r?.rows || []);
const num = v => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });
// Count formatter for non-currency charts (donut totals, quantity bars).
const cnt = v => Math.round(Number(v ?? 0)).toLocaleString('en-IN');
// Status colours shared by the sub-tab charts (consistent with the status badges).
const _WO_COLORS = { planned: '#64748b', in_progress: '#f59e0b', completed: '#10b981', cancelled: '#ef4444' };
const _SC_COLORS = { draft: '#64748b', counting: '#f59e0b', open: '#f59e0b', finalized: '#10b981', cancelled: '#ef4444' };
// Guard: charts are no-ops if the chart lib failed to load — keeps tabs working regardless.
const _chart = (fn, ...args) => { try { if (typeof window[fn] === 'function') window[fn](...args); } catch (e) { /* chart is decorative */ } };

// ── Locations ───────────────────────────────────────────────────────────────
async function loadLocations() {
    try { locations = unwrap(await api.request(AccountsCommon.buildUrl('inventory/locations'), { _skipSpinner: true })); }
    catch { locations = []; }
}
async function loadLocationsTab() {
    await loadLocations();
    const tb = document.getElementById('locationsTable');
    tb.innerHTML = locations.length ? locations.map(l => `
        <tr><td>${esc(l.name)}</td><td style="text-transform:capitalize;">${esc(l.location_type || '')}</td><td>${esc(l.gstin || '—')}</td>
        <td>${esc(l.address || '—')}</td><td style="text-align:center;">${l.is_default ? '✓' : ''}</td>
        <td><span class="status-badge ${l.is_active ? 'status-active' : ''}">${l.is_active ? 'Active' : 'Inactive'}</span></td></tr>`).join('')
        : `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No locations yet — a default location is used until you add one.</td></tr>`;
    const opts = [{ value: '', label: 'All locations' }, ...locations.map(l => ({ value: l.id, label: l.name }))];
    document.getElementById('locBalFilter').innerHTML = '';
    locBalDD = new SearchableDropdown(document.getElementById('locBalFilter'), { id: 'locBalDD', options: opts, value: '', compact: true, onChange: loadLocBalances });
    await loadLocBalances();
    // Overview chart: total stock value per location (unfiltered, top 8).
    try {
        const all = unwrap(await api.request(AccountsCommon.buildUrl('inventory/stock-balances'), { _skipSpinner: true }));
        const byLoc = {};
        all.forEach(b => { const k = b.location_name || '—'; byLoc[k] = (byLoc[k] || 0) + (parseFloat(b.value) || 0); });
        const rows = Object.entries(byLoc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
        _chart('acBarH', 'locValueChart', rows.map(r => r[0]), rows.map(r => Math.round(r[1] * 100) / 100));
    } catch { _chart('acBarH', 'locValueChart', [], []); }
}
async function loadLocBalances() {
    const loc = locBalDD?.getValue?.() || '';
    const tb = document.getElementById('locBalancesTable');
    try {
        const list = unwrap(await api.request(AccountsCommon.buildUrl('inventory/stock-balances', loc ? { locationId: loc } : {}), { _skipSpinner: true }));
        tb.innerHTML = list.length ? list.map(b => `
            <tr><td>${esc(b.location_name || '—')}</td><td>${esc(b.sku || '')}</td><td>${esc(b.item_name || b.name || '')}</td>
            <td>${num(b.quantity)}</td><td>${fmtMoney(b.value)}</td></tr>`).join('')
            : `<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No stock at this location.</td></tr>`;
    } catch { tb.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Could not load balances.</td></tr>`; }
}
function showLocationModal() {
    ['locName', 'locGstin', 'locAddress'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('locType').innerHTML = '';
    locTypeDD = new SearchableDropdown(document.getElementById('locType'), { id: 'locTypeDD', options: [{ value: 'warehouse', label: 'Warehouse' }, { value: 'store', label: 'Store' }, { value: 'branch', label: 'Branch' }], value: 'warehouse', compact: true });
    AccountsCommon.openModal('locationModal');
}
async function saveLocation() {
    const name = document.getElementById('locName').value.trim();
    if (!name) { Toast.error('Name is required'); return; }
    const btn = document.getElementById('saveLocBtn'); btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('inventory/locations'), { method: 'POST', body: JSON.stringify({
            name, location_type: locTypeDD?.getValue?.() || 'warehouse',
            gstin: document.getElementById('locGstin').value.trim() || null,
            address: document.getElementById('locAddress').value.trim() || null }) });
        Toast.success('Location created'); AccountsCommon.closeModal('locationModal'); await loadLocationsTab();
    } catch (e) { Toast.error(e.message || 'Failed to create location'); } finally { btn.disabled = false; }
}
async function showTransferModal() {
    _transferIdemKey = crypto.randomUUID();
    if (!locations.length) await loadLocations();
    document.getElementById('xfQty').value = '';
    AccountsCommon.setDateField('xfDate', AccountsCommon.todayLocal());
    const itemOpts = items.filter(i => i.track_inventory && i.item_type === 'goods' && i.is_active).map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }));
    const locOpts = locations.map(l => ({ value: l.id, label: l.name }));
    ['xfItem', 'xfFrom', 'xfTo'].forEach(id => document.getElementById(id).innerHTML = '');
    xfItemDD = new SearchableDropdown(document.getElementById('xfItem'), { id: 'xfItemDD', options: itemOpts, placeholder: 'Select item…', compact: true });
    xfFromDD = new SearchableDropdown(document.getElementById('xfFrom'), { id: 'xfFromDD', options: locOpts, placeholder: 'From…', compact: true });
    xfToDD = new SearchableDropdown(document.getElementById('xfTo'), { id: 'xfToDD', options: locOpts, placeholder: 'To…', compact: true });
    AccountsCommon.openModal('transferModal');
}
async function saveTransfer() {
    const item_id = xfItemDD?.getValue?.(), from = xfFromDD?.getValue?.(), to = xfToDD?.getValue?.();
    const qty = parseFloat(document.getElementById('xfQty').value);
    if (!item_id || !from || !to || !qty) { Toast.error('Item, both locations and a quantity are required'); return; }
    if (from === to) { Toast.error('Source and destination must differ'); return; }
    const btn = document.getElementById('saveXfBtn'); btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('inventory/transfer'), { method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(_transferIdemKey && { 'Idempotency-Key': _transferIdemKey }) },
            body: JSON.stringify({
            item_id, from_location_id: from, to_location_id: to, quantity: qty, transfer_date: document.getElementById('xfDate').value }) });
        Toast.success('Stock transferred'); AccountsCommon.closeModal('transferModal'); await loadLocBalances();
    } catch (e) { Toast.error(e.message || 'Transfer failed'); } finally { btn.disabled = false; }
}

// ── Batches & Expiry ─────────────────────────────────────────────────────────
function switchBatchView(view) {
    document.querySelectorAll('.acc-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.batchview === view));
    document.querySelectorAll('.batch-view').forEach(v => v.style.display = 'none');
    document.getElementById('batchView-' + view).style.display = '';
    if (view === 'balances') loadBatchBalances();
    else if (view === 'expiry') loadExpiryReport();
    else loadScheduleH();
}
function loadBatchesTab() { switchBatchView('balances'); }
function expiryCell(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr), today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / 86400000);
    const color = days < 0 ? 'var(--color-error)' : days <= 30 ? 'var(--color-warning)' : 'var(--text-primary)';
    return `<span style="color:${color};font-weight:${days <= 30 ? 600 : 400};">${AccountsCommon.formatDate(dateStr)}</span>`;
}
async function loadBatchBalances() {
    const tb = document.getElementById('batchBalancesTable');
    try {
        const list = unwrap(await api.request(AccountsCommon.buildUrl('inventory/batch-balances'), { _skipSpinner: true }));
        window._lotBalances = list;
        tb.innerHTML = list.length ? list.map((b, i) => `
            <tr><td>${esc(b.sku || '')}</td><td>${esc(b.item_name || b.name || '')}</td><td>${esc(b.batch_number || '—')}</td>
            <td>${esc(b.location_name || '—')}</td><td>${expiryCell(b.expiry_date)}</td><td>${num(b.quantity)}</td><td>${fmtMoney(b.value)}</td>
            <td>${Number(b.quantity) > 0 ? `<button class="btn btn-outline btn-sm" onclick="showLotWriteOff(${i})" data-admin-only>Write off</button>` : ''}</td></tr>`).join('')
            : `<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No batch/lot stock yet. Receive a batch-tracked item with a lot number.</td></tr>`;
        accountsRoles.applyRBAC();
        // Top items by lot value on hand.
        const byItem = {};
        list.forEach(b => { const k = b.item_name || b.name || b.sku || '—'; byItem[k] = (byItem[k] || 0) + (parseFloat(b.value) || 0); });
        const rows = Object.entries(byItem).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
        _chart('acBarH', 'batchValueChart', rows.map(r => r[0]), rows.map(r => Math.round(r[1] * 100) / 100));
    } catch { tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Could not load lot balances.</td></tr>`; }
}
async function loadExpiryReport() {
    const days = parseInt(document.getElementById('expiryDays').value) || 90;
    const tb = document.getElementById('expiryTable');
    try {
        const list = unwrap(await api.request(AccountsCommon.buildUrl('inventory/expiry-report', { withinDays: days }), { _skipSpinner: true }));
        tb.innerHTML = list.length ? list.map(b => {
            const d = b.expiry_date ? Math.round((new Date(b.expiry_date) - new Date().setHours(0, 0, 0, 0)) / 86400000) : null;
            return `<tr><td>${esc(b.sku || '')}</td><td>${esc(b.item_name || b.name || '')}</td><td>${esc(b.batch_number || '—')}</td>
            <td>${esc(b.location_name || '—')}</td><td>${expiryCell(b.expiry_date)}</td><td>${d === null ? '—' : d}</td><td>${num(b.quantity_on_hand ?? b.quantity)}</td><td>${fmtMoney(b.value)}</td>
            <td>${Number(b.quantity_on_hand ?? b.quantity) > 0 ? `<button class="btn btn-outline btn-sm" onclick="showLotWriteOffByLot('${b.item_id}', '${esc(AccountsCommon.escJs(b.batch_number))}')" data-admin-only>Write off</button>` : ''}</td></tr>`;
        }).join('')
            : `<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Nothing expiring in the next ${days} days.</td></tr>`;
        accountsRoles.applyRBAC();
        // Value at risk grouped by urgency of expiry.
        const buckets = [
            { label: 'Expired', color: '#ef4444', test: d => d < 0 },
            { label: '≤30d', color: '#f59e0b', test: d => d >= 0 && d <= 30 },
            { label: '31–60d', color: '#eab308', test: d => d >= 31 && d <= 60 },
            { label: '61–90d', color: '#84cc16', test: d => d >= 61 && d <= 90 },
            { label: '90d+', color: '#10b981', test: d => d > 90 }
        ];
        const totals = buckets.map(() => 0);
        list.forEach(b => {
            const d = b.expiry_date ? Math.round((new Date(b.expiry_date) - new Date().setHours(0, 0, 0, 0)) / 86400000) : null;
            if (d === null) return;
            const i = buckets.findIndex(bk => bk.test(d));
            if (i >= 0) totals[i] += (parseFloat(b.value) || 0);
        });
        // Keep only buckets that carry value so an empty tail (e.g. beyond the window) isn't a dead bar.
        const keep = buckets.map((bk, i) => ({ bk, v: Math.round(totals[i] * 100) / 100 })).filter(x => x.v > 0);
        _chart('acBarV', 'expiryRiskChart', keep.map(x => x.bk.label), keep.map(x => x.v), keep.map(x => x.bk.color));
    } catch { tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Could not load expiry report.</td></tr>`; }
}
async function loadScheduleH() {
    const tb = document.getElementById('scheduleHTable');
    try {
        const list = unwrap(await api.request(AccountsCommon.buildUrl('inventory/schedule-h-register'), { _skipSpinner: true }));
        tb.innerHTML = list.length ? list.map(r => `
            <tr><td>${AccountsCommon.formatDate(r.movement_date)}</td><td>${esc(r.sku || '')}</td><td>${esc(r.name || '')}</td>
            <td><span class="status-badge">${esc(r.drug_schedule || '')}</span></td><td>${esc(r.batch_number || '—')}</td>
            <td>${r.expiry_date ? AccountsCommon.formatDate(r.expiry_date) : '—'}</td><td>${num(r.quantity)}</td>
            <td>${esc(r.customer_name || '—')}</td><td>${esc(r.invoice_number || '—')}</td></tr>`).join('')
            : `<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No controlled-drug dispensing recorded in the last 90 days.</td></tr>`;
    } catch { tb.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Could not load register.</td></tr>`; }
}

// ── Work Orders ──────────────────────────────────────────────────────────────
async function loadWorkOrders() {
    const tb = document.getElementById('workOrdersTable');
    try {
        const list = unwrap(await api.request(AccountsCommon.buildUrl('work-orders'), { _skipSpinner: true }));
        tb.innerHTML = list.length ? list.map(w => {
            const st = (w.status || '').toLowerCase();
            let actions = '';
            if (st === 'planned') actions = `<button class="btn btn-sm btn-outline" onclick="issueWorkOrder('${w.id}')" data-admin-only>Issue</button> <button class="btn btn-sm btn-outline" onclick="cancelWorkOrder('${w.id}')" data-admin-only>Cancel</button>`;
            else if (st === 'in_progress') actions = `<button class="btn btn-sm btn-primary" onclick="showCompleteWorkOrder('${w.id}')" data-admin-only>Complete</button> <button class="btn btn-sm btn-outline" onclick="cancelWorkOrder('${w.id}')" data-admin-only>Cancel</button>`;
            return `<tr><td>${esc(w.wo_number || w.id.slice(0, 8))}</td><td>${esc(w.finished_item_name || w.finished_sku || '')}</td>
            <td>${num(w.quantity)}</td><td>${w.build_date ? AccountsCommon.formatDate(w.build_date) : '—'}</td>
            <td><span class="status-badge ${st === 'completed' ? 'status-active' : st === 'cancelled' ? '' : 'status-pending'}">${esc(w.status || '')}</span></td>
            <td>${fmtMoney(w.issued_cost)}</td><td class="actions-cell">${actions}</td></tr>`;
        }).join('')
            : `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No work orders yet. Create one for any item that has a BOM.</td></tr>`;
        accountsRoles.applyRBAC();
        // Status breakdown (donut) + component cost currently in WIP (in-progress orders).
        const byStatus = {};
        list.forEach(w => { const s = (w.status || 'unknown').toLowerCase(); byStatus[s] = (byStatus[s] || 0) + 1; });
        const sk = Object.keys(byStatus);
        _chart('acDonut', 'woStatusChart', sk.map(s => s.replace(/_/g, ' ')), sk.map(s => byStatus[s]), sk.map(s => _WO_COLORS[s] || '#64748b'), cnt);
        const wip = list.filter(w => (w.status || '').toLowerCase() === 'in_progress');
        _chart('acBarH', 'woWipChart', wip.map(w => w.wo_number || (w.id || '').slice(0, 8)), wip.map(w => Math.round((parseFloat(w.issued_cost) || 0) * 100) / 100));
    } catch { tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Could not load work orders.</td></tr>`; }
}
async function showWorkOrderModal() {
    if (!locations.length) await loadLocations();
    document.getElementById('woQty').value = '1'; document.getElementById('woNotes').value = '';
    AccountsCommon.setDateField('woDate', AccountsCommon.todayLocal());
    const itemOpts = items.filter(i => i.item_type === 'goods' && i.is_active).map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }));
    const locOpts = [{ value: '', label: 'Default location' }, ...locations.map(l => ({ value: l.id, label: l.name }))];
    ['woItem', 'woLocation'].forEach(id => document.getElementById(id).innerHTML = '');
    woItemDD = new SearchableDropdown(document.getElementById('woItem'), { id: 'woItemDD', options: itemOpts, placeholder: 'Finished item…', compact: true });
    woLocDD = new SearchableDropdown(document.getElementById('woLocation'), { id: 'woLocDD', options: locOpts, value: '', compact: true });
    AccountsCommon.openModal('workOrderModal');
}
async function saveWorkOrder() {
    const finished_item_id = woItemDD?.getValue?.();
    const quantity = parseFloat(document.getElementById('woQty').value);
    if (!finished_item_id || !quantity) { Toast.error('Finished item and quantity are required'); return; }
    const btn = document.getElementById('saveWoBtn'); btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('work-orders'), { method: 'POST', body: JSON.stringify({
            finished_item_id, quantity, build_date: document.getElementById('woDate').value,
            location_id: woLocDD?.getValue?.() || null, notes: document.getElementById('woNotes').value.trim() || null }) });
        Toast.success('Work order created'); AccountsCommon.closeModal('workOrderModal'); await loadWorkOrders();
    } catch (e) { Toast.error(e.message || 'Failed to create work order'); } finally { btn.disabled = false; }
}
const _woIssuing = new Set();
async function issueWorkOrder(id) {
    if (_woIssuing.has(id)) return;   // rapid double-click would otherwise double-issue materials to WIP
    _woIssuing.add(id);
    try { await api.request(AccountsCommon.buildUrl(`work-orders/${id}/issue`), { method: 'POST' }); Toast.success('Materials issued to WIP'); await loadWorkOrders(); }
    catch (e) { Toast.error(e.message || 'Issue failed'); }
    finally { _woIssuing.delete(id); }
}
// Guard a rapid double-click on Complete (mirrors _woIssuing). This is a UX fix: the BACKEND is already
// race-safe — CompleteWorkOrder locks the WO row FOR UPDATE and rejects any status != 'in_progress', so a
// second concurrent/retried complete fails cleanly and can NEVER double-produce finished goods. The Set just
// stops the confusing double-request + error-toast within this tab.
const _woCompleting = new Set();
function showCompleteWorkOrder(id) {
    document.getElementById('woCompleteId').value = id;
    document.getElementById('woBatch').value = ''; document.getElementById('woMrp').value = '';
    AccountsCommon.setDateField('woExpiry', '');
    AccountsCommon.openModal('woCompleteModal');
}
async function completeWorkOrder() {
    const id = document.getElementById('woCompleteId').value;
    if (_woCompleting.has(id)) return;   // rapid double-click → don't fire a second /complete
    _woCompleting.add(id);
    const body = {
        batch_number: document.getElementById('woBatch').value.trim() || null,
        expiry_date: document.getElementById('woExpiry').value || null,
        mrp: parseFloat(document.getElementById('woMrp').value) || null };
    try { await api.request(AccountsCommon.buildUrl(`work-orders/${id}/complete`), { method: 'POST', body: JSON.stringify(body) }); Toast.success('Work order completed'); AccountsCommon.closeModal('woCompleteModal'); await loadWorkOrders(); }
    catch (e) { Toast.error(e.message || 'Complete failed'); }
    finally { _woCompleting.delete(id); }
}
async function cancelWorkOrder(id) {
    if (!await Confirm.show({ title: 'Cancel work order?', message: 'Any issued materials are returned from WIP to inventory.' })) return;
    try { await api.request(AccountsCommon.buildUrl(`work-orders/${id}/cancel`), { method: 'POST' }); Toast.success('Work order cancelled'); await loadWorkOrders(); }
    catch (e) { Toast.error(e.message || 'Cancel failed'); }
}

// ── Stock Count ──────────────────────────────────────────────────────────────
async function loadStockCounts() {
    const tb = document.getElementById('stockCountsTable');
    try {
        const list = unwrap(await api.request(AccountsCommon.buildUrl('stock-counts'), { _skipSpinner: true }));
        tb.innerHTML = list.length ? list.map(c => {
            const st = (c.status || '').toLowerCase();
            const open = st === 'draft' || st === 'counting' || st === 'open';
            let actions = open
                ? `<button class="btn btn-sm btn-primary" onclick="openCountDetail('${c.id}')" data-admin-only>Enter Counts</button>`
                : `<button class="btn btn-sm btn-outline" onclick="openCountDetail('${c.id}')">View</button>`;
            if (open) actions += ` <button class="btn-icon btn-icon-danger" onclick="cancelStockCount('${c.id}','${esc(AccountsCommon.escJs(c.count_number || ''))}')" data-admin-only data-tooltip="Cancel count"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>`;
            return `<tr><td>${esc(c.count_number || c.id.slice(0, 8))}</td><td>${c.count_date ? AccountsCommon.formatDate(c.count_date) : '—'}</td>
            <td>${esc(c.location_name || 'All')}</td><td>${c.line_count ?? '—'}</td>
            <td><span class="status-badge ${st === 'finalized' ? 'status-active' : st === 'cancelled' ? '' : 'status-pending'}">${esc(c.status || '')}</span></td>
            <td class="actions-cell">${actions}</td></tr>`;
        }).join('')
            : `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No stock counts yet.</td></tr>`;
        accountsRoles.applyRBAC();
        const byStatus = {};
        list.forEach(c => { const s = (c.status || 'unknown').toLowerCase(); byStatus[s] = (byStatus[s] || 0) + 1; });
        const sk = Object.keys(byStatus);
        _chart('acDonut', 'scStatusChart', sk.map(s => s.replace(/_/g, ' ')), sk.map(s => byStatus[s]), sk.map(s => _SC_COLORS[s] || '#64748b'), cnt);
    } catch { tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Could not load counts.</td></tr>`; }
}
async function showStockCountModal() {
    if (!locations.length) await loadLocations();
    AccountsCommon.setDateField('scDate', AccountsCommon.todayLocal());
    const locOpts = [{ value: '', label: 'All locations' }, ...locations.map(l => ({ value: l.id, label: l.name }))];
    document.getElementById('scLocation').innerHTML = '';
    scLocDD = new SearchableDropdown(document.getElementById('scLocation'), { id: 'scLocDD', options: locOpts, value: '', compact: true });
    AccountsCommon.openModal('stockCountModal');
}
async function saveStockCount() {
    const btn = document.getElementById('saveScBtn'); btn.disabled = true;
    try {
        const c = await api.request(AccountsCommon.buildUrl('stock-counts'), { method: 'POST', body: JSON.stringify({
            count_date: document.getElementById('scDate').value, location_id: scLocDD?.getValue?.() || null }) });
        Toast.success('Stock count created'); AccountsCommon.closeModal('stockCountModal'); await loadStockCounts();
        if (c?.id) openCountDetail(c.id);
    } catch (e) { Toast.error(e.message || 'Failed to create count'); } finally { btn.disabled = false; }
}
async function openCountDetail(id) {
    try {
        const c = await api.request(AccountsCommon.buildUrl(`stock-counts/${id}`), { _skipSpinner: true });
        document.getElementById('countDetailId').value = id;
        document.getElementById('countDetailTitle').textContent = `Stock Count ${c.count_number || ''}`;
        const finalized = (c.status || '').toLowerCase() === 'finalized' || (c.status || '').toLowerCase() === 'cancelled';
        document.getElementById('finalizeCountBtn').style.display = finalized ? 'none' : '';
        const lines = c.lines || [];
        document.getElementById('countLinesTable').innerHTML = lines.length ? lines.map(l => `
            <tr><td>${esc(l.sku || '')}</td><td>${esc(l.name || '')}</td><td>${num(l.system_qty)}${l.unit ? ' ' + esc(l.unit) : ''}</td>
            <td>${finalized ? num(l.counted_qty) : `<input type="number" step="any" class="form-control" style="padding:.3rem .5rem;" data-item="${l.item_id}" value="${l.counted_qty ?? ''}" title="Count in ${esc(l.unit || 'base units')}">`}</td>
            <td>${l.counted_qty != null ? num((l.counted_qty - l.system_qty)) + (l.unit ? ' ' + esc(l.unit) : '') : '—'}</td></tr>`).join('')
            : `<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:1rem;">No lines.</td></tr>`;
        AccountsCommon.openModal('countDetailModal');
    } catch (e) { Toast.error(e.message || 'Could not open count'); }
}
async function finalizeStockCount() {
    const id = document.getElementById('countDetailId').value;
    const inputs = [...document.querySelectorAll('#countLinesTable input[data-item]')];
    try {
        for (const inp of inputs) {
            if (inp.value === '') continue;
            await api.request(AccountsCommon.buildUrl(`stock-counts/${id}/lines`), { method: 'POST', body: JSON.stringify({ item_id: inp.dataset.item, counted_qty: parseFloat(inp.value) }) });
        }
        if (!await Confirm.show({ title: 'Finalize count?', message: 'Counted-vs-system variances post as GL-tied stock adjustments. This cannot be undone.' })) return;
        await api.request(AccountsCommon.buildUrl(`stock-counts/${id}/finalize`), { method: 'POST' });
        Toast.success('Count finalized — variance posted'); AccountsCommon.closeModal('countDetailModal'); await loadStockCounts();
    } catch (e) { Toast.error(e.message || 'Finalize failed'); }
}
// Full multi-level BOM explosion for the item open in the BOM modal, at the entered build qty:
// shows the flattened raw-material requirements (with shortfalls) and the rolled-up cost.
async function explodeBom() {
    const itemId = document.getElementById('bomItemId').value;
    const qty = parseFloat(document.getElementById('buildQty').value) || 1;
    const view = document.getElementById('bomExplosionView');
    if (!itemId) { Toast.error('Save the BOM first'); return; }
    view.style.display = ''; view.innerHTML = '<p style="color:var(--text-secondary);font-size:.85rem;">Exploding…</p>';
    try {
        const d = await api.request(AccountsCommon.buildUrl(`inventory/items/${itemId}/bom-explosion`, { quantity: qty }), { _skipSpinner: true });
        const raws = d.raw_materials || [];
        if (!raws.length) { view.innerHTML = '<p style="color:var(--text-secondary);font-size:.85rem;">No components — this item has no bill of materials.</p>'; return; }
        const rows = raws.map(r => {
            const short = Number(r.shortfall) > 0;
            return `<tr>
                <td>${esc(r.sku || '')}</td><td>${esc(r.name || '')}</td>
                <td style="text-align:right;">${num(r.required_qty)}</td>
                <td style="text-align:right;">${num(r.qty_on_hand)}</td>
                <td style="text-align:right;${short ? 'color:var(--color-error);font-weight:600;' : ''}">${short ? num(r.shortfall) : '—'}</td>
                <td style="text-align:right;">${fmtMoney(Number(r.required_qty) * Number(r.unit_cost))}</td>
            </tr>`;
        }).join('');
        view.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="font-size:.9rem;">Raw materials to build ${num(qty)} · ${d.max_depth}-level BOM</strong>
                <span style="font-size:.9rem;">Rolled-up cost: <strong>${fmtMoney(d.total_cost)}</strong></span>
            </div>
            <div class="data-table-container"><table class="data-table">
                <thead><tr><th>SKU</th><th>Component</th><th style="text-align:right;">Required</th><th style="text-align:right;">On hand</th><th style="text-align:right;">Shortfall</th><th style="text-align:right;">Cost</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>`;
    } catch (e) { view.innerHTML = `<p style="color:var(--color-error);font-size:.85rem;">${esc(e.message || 'Explosion failed')}</p>`; }
}

async function cancelStockCount(id, number) {
    const reason = await AccountsCommon.reasonPrompt({
        title: `Cancel stock count ${number}?`,
        message: 'Discards the count without posting any adjustment. System quantities are unchanged.',
        confirmText: 'Cancel count'
    });
    if (reason == null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`stock-counts/${id}/cancel`), { method: 'POST', body: JSON.stringify({ reason }) });
        Toast.success('Stock count cancelled'); await loadStockCounts();
    } catch (e) { Toast.error(e.message || 'Cancel failed'); }
}

// ── Trade schemes (buy N get M free) ────────────────────────────────────────
let schemes = [];
let schItemDD = null, schFreeItemDD = null;

async function loadSchemes() {
    try { schemes = unwrap(await api.request(AccountsCommon.buildUrl('trade-schemes', { includeInactive: true }), { _skipSpinner: true })); }
    catch { schemes = []; }
    const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN') : '…';
    const tb = document.getElementById('schemesTable');
    tb.innerHTML = schemes.length ? schemes.map(s => `
        <tr><td>${esc(s.name)}</td><td>${esc(s.item_sku || '')} ${esc(s.item_name || '')}</td>
        <td>${num(s.buy_qty)}</td>
        <td>${num(s.free_qty)} × ${esc(s.free_item_sku || s.item_sku || '')} FREE</td>
        <td>${s.starts_on || s.ends_on ? `${fmtD(s.starts_on)} → ${fmtD(s.ends_on)}` : 'Always'}</td>
        <td style="text-align:center;">${s.is_active ? '✓' : '—'}</td>
        <td><button class="btn btn-sm btn-outline" onclick="toggleScheme('${s.id}', ${s.is_active ? 'false' : 'true'})" data-admin-only>${s.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')
        : `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No schemes yet — '10+1' style offers auto-apply on invoices and at the counter.</td></tr>`;
    accountsRoles.applyRBAC();
}

async function showSchemeModal() {
    ['schName', 'schBuyQty', 'schFreeQty', 'schStarts', 'schEnds'].forEach(id => document.getElementById(id).value = '');
    if (!items.length) await loadItems();
    const goods = items.filter(i => i.is_active && i.item_type === 'goods');
    const opts = goods.map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }));
    document.getElementById('schItem').innerHTML = '';
    document.getElementById('schFreeItem').innerHTML = '';
    schItemDD = new SearchableDropdown(document.getElementById('schItem'), { id: 'schItemDD', options: opts, value: '', placeholder: 'Select item…', searchPlaceholder: 'Search SKU / name…', compact: true });
    schFreeItemDD = new SearchableDropdown(document.getElementById('schFreeItem'), { id: 'schFreeItemDD', options: [{ value: '', label: 'Same item' }, ...opts.filter(o => { const it = goods.find(g => g.id === o.value); return it?.tracking_mode !== 'serial'; })], value: '', placeholder: 'Same item', searchPlaceholder: 'Search SKU / name…', compact: true });
    AccountsCommon.openModal('schemeModal');
}

async function saveScheme() {
    const payload = {
        name: document.getElementById('schName').value.trim(),
        item_id: schItemDD?.getValue?.() || null,
        buy_qty: parseFloat(document.getElementById('schBuyQty').value) || 0,
        free_qty: parseFloat(document.getElementById('schFreeQty').value) || 0,
        free_item_id: schFreeItemDD?.getValue?.() || null,
        starts_on: document.getElementById('schStarts').value || null,
        ends_on: document.getElementById('schEnds').value || null
    };
    if (!payload.name) { Toast.error('Scheme name is required'); return; }
    if (!payload.item_id) { Toast.error('Pick the item the customer must buy'); return; }
    if (payload.buy_qty <= 0 || payload.free_qty <= 0) { Toast.error('Buy and free quantities must be greater than 0'); return; }
    const btn = document.getElementById('saveSchemeBtn'); btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('trade-schemes'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Scheme created — it now auto-applies on invoices and at the counter');
        AccountsCommon.closeModal('schemeModal');
        await loadSchemes();
    } catch (err) { Toast.error(err.message || 'Failed to create scheme'); }
    finally { btn.disabled = false; }
}

async function toggleScheme(id, active) {
    try {
        await api.request(AccountsCommon.buildUrl(`trade-schemes/${id}/activate`, { active }), { method: 'POST' });
        Toast.success(active === true || active === 'true' ? 'Scheme activated' : 'Scheme deactivated');
        await loadSchemes();
    } catch (err) { Toast.error(err.message || 'Failed'); }
}

// ── Price Lists ──────────────────────────────────────────────────────────────
async function loadPriceLists() {
    try { priceLists = unwrap(await api.request(AccountsCommon.buildUrl('price-lists'), { _skipSpinner: true })); }
    catch { priceLists = []; }
    const tb = document.getElementById('priceListsTable');
    tb.innerHTML = priceLists.length ? priceLists.map(p => `
        <tr class="${p.id === selectedPriceListId ? 'row-selected' : ''}" style="cursor:pointer;" onclick="selectPriceList('${p.id}','${esc(AccountsCommon.escJs(p.name))}')">
        <td>${esc(p.name)}</td><td style="text-align:center;">${p.is_active ? '✓' : '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();activatePriceList(\'' + p.id + '\')" data-admin-only>Activate</button>'}</td></tr>`).join('')
        : `<tr><td colspan="2" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No price lists yet.</td></tr>`;
    accountsRoles.applyRBAC();
    if (selectedPriceListId) await loadPriceListItems();
}
async function selectPriceList(id, name) {
    selectedPriceListId = id;
    document.getElementById('plSelectedName').textContent = name;
    document.getElementById('plAddPriceBtn').style.display = '';
    document.querySelectorAll('#priceListsTable tr').forEach(r => r.classList.remove('row-selected'));
    accountsRoles.applyRBAC();
    await loadPriceListItems();
}
async function loadPriceListItems() {
    const tb = document.getElementById('priceListItemsTable');
    const chartWrap = document.getElementById('plChartWrap');
    if (!selectedPriceListId) { tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Select a price list.</td></tr>`; if (chartWrap) chartWrap.style.display = 'none'; return; }
    try {
        const list = unwrap(await api.request(AccountsCommon.buildUrl(`price-lists/${selectedPriceListId}/prices`), { _skipSpinner: true }));
        tb.innerHTML = list.length ? list.map(p => `
            <tr><td>${esc(p.sku || '')}</td><td>${esc(p.name || p.item_name || '')}</td><td>${fmtMoney(p.price)}</td>
            <td class="actions-cell"><button class="btn-icon" onclick="removeItemPrice('${p.item_id}')" data-admin-only data-tooltip="Remove">🗑</button></td></tr>`).join('')
            : `<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No item prices set. Use “Set Item Price”.</td></tr>`;
        accountsRoles.applyRBAC();
        // Price-per-item bar for the selected list (top 10 by price).
        if (list.length) {
            if (chartWrap) chartWrap.style.display = '';
            const top = [...list].sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0)).slice(0, 10);
            _chart('acBarH', 'plPriceChart', top.map(p => p.name || p.item_name || p.sku || ''), top.map(p => Math.round((parseFloat(p.price) || 0) * 100) / 100));
        } else if (chartWrap) { chartWrap.style.display = 'none'; }
    } catch { tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Could not load prices.</td></tr>`; }
}
function showPriceListModal() { document.getElementById('plName').value = ''; AccountsCommon.openModal('priceListModal'); }
async function savePriceList() {
    const name = document.getElementById('plName').value.trim();
    if (!name) { Toast.error('Name is required'); return; }
    try { await api.request(AccountsCommon.buildUrl('price-lists'), { method: 'POST', body: JSON.stringify({ name }) }); Toast.success('Price list created'); AccountsCommon.closeModal('priceListModal'); await loadPriceLists(); }
    catch (e) { Toast.error(e.message || 'Failed'); }
}
async function activatePriceList(id) {
    try { await api.request(AccountsCommon.buildUrl(`price-lists/${id}/activate`), { method: 'POST' }); Toast.success('Activated'); await loadPriceLists(); }
    catch (e) { Toast.error(e.message || 'Failed'); }
}
function showSetPriceModal() {
    if (!selectedPriceListId) { Toast.error('Select a price list first'); return; }
    document.getElementById('spPrice').value = '';
    document.getElementById('spItem').innerHTML = '';
    const opts = items.filter(i => i.is_active).map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }));
    spItemDD = new SearchableDropdown(document.getElementById('spItem'), { id: 'spItemDD', options: opts, placeholder: 'Select item…', compact: true });
    AccountsCommon.openModal('setPriceModal');
}
async function saveItemPrice() {
    const item_id = spItemDD?.getValue?.(); const price = parseFloat(document.getElementById('spPrice').value);
    if (!item_id || isNaN(price)) { Toast.error('Item and price are required'); return; }
    try { await api.request(AccountsCommon.buildUrl(`price-lists/${selectedPriceListId}/prices`), { method: 'POST', body: JSON.stringify({ item_id, price }) }); Toast.success('Price set'); AccountsCommon.closeModal('setPriceModal'); await loadPriceListItems(); }
    catch (e) { Toast.error(e.message || 'Failed'); }
}
async function removeItemPrice(itemId) {
    if (!await Confirm.show({ title: 'Remove price?', message: 'This item will fall back to its default sale price.' })) return;
    try { await api.request(AccountsCommon.buildUrl(`price-lists/${selectedPriceListId}/prices/${itemId}`), { method: 'DELETE' }); Toast.success('Removed'); await loadPriceListItems(); }
    catch (e) { Toast.error(e.message || 'Failed'); }
}

// ── Reorder Report ────────────────────────────────────────────────────────────
async function loadReorder() {
    const tb = document.getElementById('reorderTable');
    try {
        const list = unwrap(await api.request(AccountsCommon.buildUrl('inventory/reorder-report'), { _skipSpinner: true }));
        tb.innerHTML = list.length ? list.map(r => `
            <tr><td>${esc(r.sku || '')}</td><td>${esc(r.name || r.item_name || '')}</td><td>${num(r.qty_on_hand)}${r.unit ? ' ' + esc(r.unit) : ''}</td>
            <td>${num(r.reorder_level)}</td><td><strong>${num(r.suggested_order_qty ?? r.reorder_quantity)}${r.unit ? ' ' + esc(r.unit) : ''}</strong></td>
            <td>${esc(r.preferred_vendor_name || r.vendor_name || '—')}</td></tr>`).join('')
            : `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Nothing below its reorder level. 🎉</td></tr>`;
        // Suggested order quantity by item (most urgent first, top 8) — count-scaled, not currency.
        const top = [...list]
            .map(r => ({ label: r.sku || r.name || r.item_name || '', qty: Number(r.suggested_order_qty ?? r.reorder_quantity ?? 0) }))
            .filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 8);
        _chart('acBarV', 'reorderChart', top.map(x => x.label), top.map(x => x.qty), null, cnt);
    } catch { tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Could not load reorder report.</td></tr>`; }
}

// ============================================================================
// SALT / COMPOSITION editor (pharma) — rows of (salt dropdown + strength).
// Sent as the item's FULL composition via PUT items/{id}/salts on save.
// ============================================================================

let saltsCache = [];

async function ensureSalts() {
    try { saltsCache = await api.request(AccountsCommon.buildUrl('inventory/salts'), { _skipSpinner: true }); }
    catch { saltsCache = saltsCache || []; }
}

let _itSaltLoadSeq = 0;
// False while an edit's composition is still async-loading — saveItem must NOT write the /salts endpoint
// during this window (the rows are empty, so it would PUT { salts: [] } and WIPE the stored composition).
let _itemSaltsReady = false;
async function initItemSaltRows(existing, itemId = null) {
    const wrap = document.getElementById('itSaltRows');
    if (!wrap) return;
    // Sequence token: opening item B while item A's async composition fetch is still in flight must not
    // let A's rows render into B's form. Every await re-checks that this is still the latest load.
    const seq = ++_itSaltLoadSeq;
    _itemSaltsReady = false;
    wrap.innerHTML = '';
    await ensureSalts();
    if (seq !== _itSaltLoadSeq) return;
    let rows = existing || [];
    if (itemId) {
        try { rows = await api.request(AccountsCommon.buildUrl(`inventory/items/${itemId}/salts`), { _skipSpinner: true }); }
        catch { rows = []; }
        if (seq !== _itSaltLoadSeq) return;   // a newer item opened while we waited — abandon this render
    }
    rows.forEach(r => addItemSaltRow(r));
    if (seq === _itSaltLoadSeq) _itemSaltsReady = true;   // composition now reflects the stored rows — safe to save
}

function addItemSaltRow(data = {}) {
    const wrap = document.getElementById('itSaltRows');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:6px;align-items:center;';
    row.innerHTML = `
        <div class="searchable-dropdown-container it-salt-sd" style="flex:1;min-width:0;"></div>
        <input type="text" class="form-control it-salt-strength" placeholder="strength e.g. 500mg" maxlength="40" style="max-width:150px;" value="${AccountsCommon.escapeHtml(data.strength || '')}">
        <button type="button" class="btn-icon btn-icon-danger" onclick="this.parentElement.remove()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    wrap.appendChild(row);
    const buildOpts = () => [{ value: '', label: 'Select salt...' },
        ...saltsCache.filter(s => s.is_active).map(s => ({ value: s.id, label: s.name }))];
    row._saltDD = new SearchableDropdown(row.querySelector('.it-salt-sd'), {
        id: `it-salt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        options: buildOpts(), value: data.salt_id || '', placeholder: 'Select salt...',
        searchPlaceholder: 'Search / add salt…', compact: true,
        quickAdd: { title: 'Create new salt', onClick: (instance) => openQuickAddSalt(instance, buildOpts) }
    });
}

function collectItemSalts() {
    const out = [];
    document.querySelectorAll('#itSaltRows > div').forEach(row => {
        const id = row._saltDD?.getValue?.();
        if (!id) return;
        if (out.some(x => x.salt_id === id)) return;   // silently dedupe double picks
        out.push({ salt_id: id, strength: row.querySelector('.it-salt-strength').value.trim() || null });
    });
    return out;
}

// Quick-add salt modal (built on demand — mirrors the invoice quick-add-account pattern;
// native prompt() is banned).
function openQuickAddSalt(dropdownInstance, rebuildOptions) {
    let m = document.getElementById('quickAddSaltModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'quickAddSaltModal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="max-width: 420px;">
                    <div class="modal-header">
                        <h5 class="modal-title">New Salt / Molecule</h5>
                        <button class="close-btn" onclick="AccountsCommon.closeModal('quickAddSaltModal')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group"><label for="qaSaltName">Name *</label>
                        <input type="text" id="qaSaltName" class="form-control" maxlength="120" placeholder="e.g. Paracetamol"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="AccountsCommon.closeModal('quickAddSaltModal')">Cancel</button>
                        <button class="btn btn-primary" id="qaSaltSaveBtn">Create</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);
    }
    document.getElementById('qaSaltName').value = '';
    document.getElementById('qaSaltSaveBtn').onclick = async () => {
        const name = document.getElementById('qaSaltName').value.trim();
        if (!name) { Toast.error('Enter the salt name'); return; }
        try {
            const created = await api.request(AccountsCommon.buildUrl('inventory/salts'), { method: 'POST', body: JSON.stringify({ name }) });
            saltsCache.push(created);
            dropdownInstance.setOptions?.(rebuildOptions());
            dropdownInstance.setValue?.(created.id);
            Toast.success(`Salt '${created.name}' created`);
            AccountsCommon.closeModal('quickAddSaltModal');
        } catch (e) { Toast.error(e?.message || 'Failed to create salt'); }
    };
    AccountsCommon.openModal('quickAddSaltModal');
}

// ── Lot write-off (expiry / breakage) — named-lot drain, never FEFO ─────────
// Local calendar date (YYYY-MM-DD) — toISOString() is UTC and back-dates the adjustment
// after IST midnight, landing the write-off in the wrong (possibly locked) period.
function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let lotWoTarget = null;   // { item_id, batch_number, rows: [balance rows for this lot] }
let lotWoLocationDD = null, lotWoReasonDD = null;

async function showLotWriteOffByLot(itemId, batchNumber) {
    // Expiry view has no location — resolve from batch balances.
    let rows = window._lotBalances;
    if (!rows) {
        try { rows = unwrap(await api.request(AccountsCommon.buildUrl('inventory/batch-balances'), { _skipSpinner: true })); }
        catch { rows = []; }
        window._lotBalances = rows;
    }
    const matches = rows.filter(b => b.item_id === itemId && b.batch_number === batchNumber && Number(b.quantity) > 0);
    if (!matches.length) { Toast.error('No stock of this lot found at any location'); return; }
    openLotWriteOff(matches);
}

function showLotWriteOff(idx) {
    const b = (window._lotBalances || [])[idx];
    if (!b) return;
    openLotWriteOff([b]);
}

function openLotWriteOff(matches) {
    _lotWoIdemKey = crypto.randomUUID();
    const b = matches[0];
    lotWoTarget = { item_id: b.item_id, batch_number: b.batch_number, rows: matches };
    document.getElementById('lotWoSummary').innerHTML =
        `<strong>${esc(b.sku || '')} — ${esc(b.item_name || b.name || '')}</strong> · Lot <strong>${esc(b.batch_number)}</strong>` +
        (b.expiry_date ? ` · expires ${AccountsCommon.formatDate(b.expiry_date)}` : '');
    lotWoLocationDD = new SearchableDropdown(document.getElementById('lotWoLocationDD'), {
        id: 'lotWoLocationSD',
        options: matches.map(m => ({ value: m.location_id, label: `${m.location_name || 'Main Store'} (${num(m.quantity)} on hand)` })),
        value: matches[0].location_id,
        onChange: (v) => {
            const m = lotWoTarget.rows.find(x => x.location_id === v);
            if (m) document.getElementById('lotWoQty').value = m.quantity;
        }
    });
    document.getElementById('lotWoQty').value = b.quantity;
    lotWoReasonDD = new SearchableDropdown(document.getElementById('lotWoReasonDD'), {
        id: 'lotWoReasonSD',
        options: [
            { value: 'Expired', label: 'Expired — past its date' },
            { value: 'Damaged', label: 'Damaged / breakage' },
            { value: 'Other', label: 'Other write-off' }
        ],
        value: b.expiry_date && new Date(b.expiry_date) < new Date() ? 'Expired' : 'Damaged'
    });
    document.getElementById('lotWoNote').value = '';
    AccountsCommon.openModal('lotWriteOffModal');
}

async function saveLotWriteOff() {
    const locId = lotWoLocationDD?.getValue?.();
    const qty = parseFloat(document.getElementById('lotWoQty').value);
    if (!locId) { Toast.error('Pick the location'); return; }
    if (!(qty > 0)) { Toast.error('Enter the quantity to write off'); return; }
    const onHand = Number(lotWoTarget.rows.find(x => x.location_id === locId)?.quantity);
    if (onHand >= 0 && qty > onHand) { Toast.error(`Cannot write off more than the ${onHand} on hand at this location.`); return; }
    const reason = lotWoReasonDD?.getValue?.() || 'Other';
    const note = document.getElementById('lotWoNote').value.trim();
    const btn = document.getElementById('lotWoBtn');
    btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('inventory/adjustments'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(_lotWoIdemKey && { 'Idempotency-Key': _lotWoIdemKey }) },
            body: JSON.stringify({
                item_id: lotWoTarget.item_id,
                adjustment_date: localToday(),
                quantity_delta: -qty,
                batch_number: lotWoTarget.batch_number,
                location_id: locId,
                notes: `${reason} write-off${note ? ' — ' + note : ''}`
            })
        });
        Toast.success(`Lot ${lotWoTarget.batch_number} written off (${qty})`);
        AccountsCommon.closeModal('lotWriteOffModal');
        window._lotBalances = null;
        const active = document.querySelector('.acc-seg-btn.active')?.dataset?.batchview || 'balances';
        switchBatchView(active);
    } catch (err) {
        Toast.error(err?.message || 'Failed to write off the lot');
    } finally { btn.disabled = false; }
}

// ============================================================================
// BULK IMPORT — item master and opening stock
//
// The file is parsed here and sent as rows, matching how the bank-statement
// import already works. Everything that decides whether a row is ACCEPTABLE
// lives on the server: this side only turns a spreadsheet into JSON.
//
// Two things carry all the risk, and both are handled deliberately below —
// parsing CSV correctly (a naive split on commas silently corrupts any file
// with a quoted comma in an item name, which in a grocery master is most of
// them), and never letting a preview be mistaken for a completed import.
// ============================================================================

let _impRows = null, _impKind = null, _impFileName = '';

/**
 * RFC 4180 CSV. Handles quoted fields, commas and newlines INSIDE quotes,
 * doubled quotes as an escape, a UTF-8 BOM, and CR/CRLF/LF line endings.
 *
 * Written out rather than split(',') because "Britannia Good Day, Cashew 200g"
 * is an entirely ordinary item name, and splitting on the comma turns one
 * product into two broken rows without saying anything.
 */
function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip BOM
    const rows = [];
    let row = [], field = '', inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }   // "" -> literal quote
                else inQuotes = false;
            } else field += ch;
            continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === ',') { row.push(field); field = ''; continue; }
        if (ch === '\r') { if (text[i + 1] === '\n') i++; rows.push([...row, field]); row = []; field = ''; continue; }
        if (ch === '\n') { rows.push([...row, field]); row = []; field = ''; continue; }
        field += ch;
    }
    if (field.length || row.length) rows.push([...row, field]);
    // Drop trailing blank lines, which every spreadsheet export produces.
    return rows.filter(r => r.some(c => (c || '').trim().length));
}

// Column aliases. A Marg or Tally export does not say "sale_price" — refusing
// those files over a header name would defeat the point of the importer.
const IMP_ALIASES = {
    sku:            ['sku', 'item code', 'itemcode', 'code', 'product code', 'alias'],
    name:           ['name', 'item name', 'product name', 'particulars', 'description'],
    barcode:        ['barcode', 'ean', 'upc', 'bar code'],
    category:       ['category', 'group', 'item group', 'stock group'],
    hsn_sac:        ['hsn_sac', 'hsn', 'hsn code', 'hsn/sac', 'sac'],
    unit:           ['unit', 'uom', 'unit of measure', 'units'],
    tax_rate:       ['tax_rate', 'tax rate', 'gst', 'gst rate', 'gst%', 'tax', 'gst %'],
    sale_price:     ['sale_price', 'sale price', 'selling price', 'sales rate', 'sale rate'],
    purchase_price: ['purchase_price', 'purchase price', 'purchase rate', 'cost price', 'cost'],
    mrp:            ['mrp', 'max retail price'],
    reorder_level:  ['reorder_level', 'reorder level', 'reorder', 'min qty', 'minimum qty'],
    tracking_mode:  ['tracking_mode', 'tracking', 'batch tracked'],
    price_includes_tax: ['price_includes_tax', 'inclusive', 'tax inclusive', 'incl tax'],
    quantity:       ['quantity', 'qty', 'stock', 'opening qty', 'opening quantity', 'closing qty'],
    unit_cost:      ['unit_cost', 'unit cost', 'rate', 'cost', 'purchase rate', 'value'],
    batch_number:   ['batch_number', 'batch', 'batch no', 'lot'],
    mfg_date:       ['mfg_date', 'mfg', 'mfg date', 'manufactured'],
    expiry_date:    ['expiry_date', 'expiry', 'exp date', 'expiry date', 'best before'],
    party_type:     ['party_type', 'type', 'party type'],
    gstin:          ['gstin', 'gst no', 'gst number', 'gstin/uin', 'tax id', 'gst'],
    email:          ['email', 'e-mail', 'email id'],
    phone:          ['phone', 'mobile', 'contact', 'phone no', 'mobile no', 'contact no'],
    address_line1:  ['address_line1', 'address', 'address 1', 'address line 1', 'street'],
    city:           ['city', 'town'],
    state:          ['state', 'state name'],
    state_code:     ['state_code', 'state code', 'gst state code'],
    country:        ['country'],
    postal_code:    ['postal_code', 'pincode', 'pin code', 'zip', 'postcode'],
    gst_treatment:  ['gst_treatment', 'gst treatment', 'registration type', 'gst type'],
    payment_terms_days: ['payment_terms_days', 'payment terms', 'credit days', 'terms']
};

function mapHeaders(headerRow) {
    const norm = h => (h || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const map = {}, used = new Set();
    headerRow.forEach((h, idx) => {
        const n = norm(h);
        for (const [field, aliases] of Object.entries(IMP_ALIASES)) {
            if (map[field] === undefined && aliases.includes(n)) { map[field] = idx; used.add(idx); return; }
        }
    });
    // Columns we did not recognise are REPORTED, never silently dropped — otherwise a
    // mis-named price column looks like a successful import of items with no price.
    const ignored = headerRow.map((h, i) => used.has(i) ? null : (h || '').trim()).filter(h => h);
    return { map, ignored };
}

const _impNum = v => { const n = parseFloat(String(v ?? '').replace(/[₹,\s]/g, '')); return isNaN(n) ? null : n; };
const _impStr = v => { const s = String(v ?? '').trim(); return s.length ? s : null; };
const _impBool = v => { const s = String(v ?? '').trim().toLowerCase(); return ['y','yes','true','1'].includes(s) ? true : (['n','no','false','0'].includes(s) ? false : null); };
/** dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd → ISO, or null. */
const _impDate = v => {
    const s = String(v ?? '').trim(); if (!s) return null;
    let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : null;
};

/**
 * Reads an .xlsx into the same array-of-arrays the CSV path produces, so everything downstream —
 * header mapping, preview, commit — is shared and there is only one import pipeline to trust.
 *
 * SheetJS is fetched ONLY when someone actually picks a spreadsheet: most imports are CSV, and a
 * library this size has no business loading on every visit to the inventory page.
 *
 * `raw: false` matters more than it looks. Excel stores a date as a serial number, and reading one
 * raw turns an expiry date into "45914" — which would sail through as a number and silently give a
 * batch of milk an expiry in the year 2125. Formatted values give back what the user sees.
 */
async function readXlsx(file) {
    if (!window.XLSX) {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Could not load the Excel reader. Check your connection, or save the file as CSV.'));
            document.head.appendChild(s);
        });
    }
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('That workbook has no sheets.');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    return rows.filter(r => r.some(c => String(c ?? '').trim().length));
}

async function pickImportFile(input, kind) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    _impFileName = file.name;
    try {
        const isExcel = /\.xlsx?$/i.test(file.name);
        const rows = isExcel ? await readXlsx(file) : parseCsv(await file.text());
        if (rows.length < 2) { Toast.error('That file has no data rows under the header.'); return; }
        const { map, ignored } = mapHeaders(rows[0]);

        const need = kind === 'items' ? ['sku', 'name']
                   : kind === 'parties' ? ['name']
                   : ['sku', 'quantity', 'unit_cost'];
        const missing = need.filter(f => map[f] === undefined);
        if (missing.length) {
            Toast.error(`Could not find a column for: ${missing.join(', ')}. Download the template to see the expected names.`);
            return;
        }

        const cell = (r, f) => map[f] === undefined ? null : r[map[f]];
        _impKind = kind;
        if (kind === 'parties') {
            _impRows = rows.slice(1).map((r, i) => ({
                row_number: i + 2,
                party_type: _impStr(cell(r, 'party_type')), code: _impStr(cell(r, 'code')),
                name: _impStr(cell(r, 'name')), gstin: _impStr(cell(r, 'gstin')),
                email: _impStr(cell(r, 'email')), phone: _impStr(cell(r, 'phone')),
                address_line1: _impStr(cell(r, 'address_line1')), city: _impStr(cell(r, 'city')),
                state: _impStr(cell(r, 'state')), state_code: _impStr(cell(r, 'state_code')),
                country: _impStr(cell(r, 'country')), postal_code: _impStr(cell(r, 'postal_code')),
                gst_treatment: _impStr(cell(r, 'gst_treatment')),
                payment_terms_days: _impNum(cell(r, 'payment_terms_days'))
            }));
            if (ignored.length) Toast.warning(`Ignored ${ignored.length} unrecognised column(s): ${ignored.slice(0, 6).join(', ')}`);
            await runImport(true);
            return;
        }
        _impRows = rows.slice(1).map((r, i) => kind === 'items' ? {
            row_number: i + 2,                       // +2: 1-based, and the header is row 1
            sku: _impStr(cell(r, 'sku')), name: _impStr(cell(r, 'name')),
            barcode: _impStr(cell(r, 'barcode')), category: _impStr(cell(r, 'category')),
            hsn_sac: _impStr(cell(r, 'hsn_sac')), unit: _impStr(cell(r, 'unit')),
            tax_rate: _impStr(cell(r, 'tax_rate')),
            sale_price: _impNum(cell(r, 'sale_price')), purchase_price: _impNum(cell(r, 'purchase_price')),
            mrp: _impNum(cell(r, 'mrp')), reorder_level: _impNum(cell(r, 'reorder_level')),
            tracking_mode: _impStr(cell(r, 'tracking_mode')),
            price_includes_tax: _impBool(cell(r, 'price_includes_tax'))
        } : {
            row_number: i + 2,
            sku: _impStr(cell(r, 'sku')),
            quantity: _impNum(cell(r, 'quantity')), unit_cost: _impNum(cell(r, 'unit_cost')),
            batch_number: _impStr(cell(r, 'batch_number')),
            mfg_date: _impDate(cell(r, 'mfg_date')), expiry_date: _impDate(cell(r, 'expiry_date'))
        });

        if (ignored.length) Toast.warning(`Ignored ${ignored.length} unrecognised column(s): ${ignored.slice(0, 6).join(', ')}`);
        await runImport(true);
    } catch (err) {
        Toast.error(err?.message || 'Could not read that file');
    }
}

async function runImport(dryRun) {
    if (!_impRows) return;
    const body = { rows: _impRows, dry_run: dryRun };
    let path = 'import/items';
    if (_impKind === 'items') {
        body.update_existing = true;
        body.create_missing_categories = !!document.getElementById('impCreateCats')?.checked;
    } else if (_impKind === 'parties') {
        path = 'import/parties';
        body.default_party_type = document.getElementById('impPartyType')?.value || null;
    } else {
        path = 'import/opening-stock';
        const asOf = document.getElementById('impAsOf')?.value;
        if (!asOf) { Toast.error('Pick the "as of" date for the opening stock first.'); return; }
        body.as_of_date = asOf;
    }
    try {
        const res = await api.request(AccountsCommon.buildUrl(path), { method: 'POST', body: JSON.stringify(body) });
        renderImportResult(res);
        if (!dryRun) {
            Toast.success(`Imported — ${res.created} created, ${res.updated} updated, ${res.skipped} skipped, ${res.errors} failed`);
            _impRows = null;
            if (_impKind === 'items') { await loadItems(); }
        }
    } catch (err) {
        Toast.error(err?.message || 'Import failed');
    }
}

function renderImportResult(r) {
    const tile = (label, value, tone) => `
        <div style="background:var(--bg-tertiary);border:1px solid ${tone ? `var(--color-${tone})` : 'var(--border-color)'};border-radius:10px;padding:.6rem .85rem;min-width:110px;">
            <div style="font-size:.7rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;">${label}</div>
            <div style="font-size:1.1rem;font-weight:700;color:${tone ? `var(--color-${tone})` : 'var(--text-primary)'};">${value}</div>
        </div>`;

    // The DETAIL column carries the whole value of the preview — it is the column that tells someone
    // holding a spreadsheet which row to go and fix. Explicit widths, because left to itself the table
    // gives the space to Row/SKU/Outcome and squeezes the reason down to one word per line.
    const rowsHtml = (r.rows || []).map(x => `
        <tr>
            <td>${x.row_number}</td>
            <td style="overflow-wrap:anywhere;">${AccountsCommon.escapeHtml(x.sku || '—')}</td>
            <td><span class="status-badge" style="background:var(--color-${x.outcome === 'error' ? 'error' : x.outcome === 'skipped' ? 'warning' : 'success'});color:var(--text-inverse);">${AccountsCommon.escapeHtml(x.outcome)}</span></td>
            <td style="white-space:normal;overflow:visible;text-overflow:clip;line-height:1.45;font-size:.78rem;color:var(--text-secondary);">${AccountsCommon.escapeHtml(x.message || '')}</td>
        </tr>`).join('');

    document.getElementById('impResultArea').innerHTML = `
        <div class="glass-card">
            <div class="glass-card-body">
                <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.75rem;">
                    <h4 style="margin:0;">${r.dry_run ? 'Preview' : 'Import complete'}</h4>
                    <span style="font-size:.78rem;color:var(--text-secondary);">${AccountsCommon.escapeHtml(_impFileName)} · ${r.total_rows} row(s)</span>
                    ${r.dry_run ? `<span style="flex:1"></span>
                        <button class="btn btn-primary btn-sm" onclick="runImport(false)" ${r.errors && !r.created && !r.updated ? 'disabled' : ''}>
                            Import ${r.created + r.updated} row(s)
                        </button>` : ''}
                </div>
                ${r.dry_run ? `<p style="margin:0 0 .75rem;font-size:.8rem;color:var(--text-secondary);">
                    Nothing has been saved yet. Check the rows below, then press Import.</p>` : ''}
                <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.9rem;">
                    ${tile('Create', r.created)}
                    ${tile('Update', r.updated)}
                    ${tile('Skip', r.skipped, r.skipped ? 'warning' : null)}
                    ${tile('Failed', r.errors, r.errors ? 'error' : null)}
                </div>
                ${(r.warnings || []).map(w => `<p style="margin:0 0 .4rem;font-size:.8rem;color:var(--color-warning);">${AccountsCommon.escapeHtml(w)}</p>`).join('')}
                ${rowsHtml ? `<div class="data-table-container" style="max-height:420px;overflow:auto;">
                    <table class="data-table" style="table-layout:fixed;width:100%;">
                        <thead><tr><th style="width:6%;">Row</th><th style="width:18%;">SKU</th><th style="width:12%;">Outcome</th><th style="width:64%;">Detail</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table></div>` : ''}
            </div>
        </div>`;
}

function downloadImportTemplate(kind) {
    // ⭐ buildUrl returns a PATH ('/accounts/…') for api.request to prefix with the Accounts API base.
    // window.open resolves a bare path against the PAGE origin instead, so this opened
    // localhost:5501/accounts/… — the static frontend — and served a 404 page. The template is the first
    // thing a user clicks, so it was the first thing that broke.
    //
    // Prefixed here with exactly what api.request would prefix, and opened as a real navigation. The
    // endpoint is AllowAnonymous precisely so this works without attaching a bearer token to a download.
    const url = CONFIG.accountsApiBaseUrl + AccountsCommon.buildUrl(`import/template/${kind}`);
    window.open(url, '_blank');
}
