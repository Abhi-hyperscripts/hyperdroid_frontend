/**
 * Inventory page — Items / Stock on Hand / Movements / Serials & Warranty.
 * Backend: /api/accounts/inventory/*
 */

let items = [];
let categories = [];
let itemDD = null, typeDD = null, catDD = null, adjItemDD = null, snItemDD = null, moveFilterDD = null;

const fmtMoney = v => AccountsCommon.formatCurrency(v);
const esc = s => AccountsCommon.escapeHtml(s ?? '');

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('inventory', '../')) return;
    const tabNames = { 'inv-items': 'Items', 'inv-stock': 'Stock on Hand', 'inv-movements': 'Movements', 'inv-serials': 'Serials & Warranty' };
    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();
    AccountsCommon.initDatePickers(['adjDate', 'registerAsOf']);
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

function renderItems() {
    const tb = document.getElementById('itemsTable');
    if (!tb) return;
    const q = (document.getElementById('itemSearch')?.value || '').toLowerCase();
    const rows = items.filter(i => !q || i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
    if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-secondary);">No items yet. Click "+ New Item" to create your product catalog.</td></tr>';
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    tb.innerHTML = rows.map(i => `<tr>
        <td><code>${esc(i.sku)}</code></td>
        <td>${esc(i.name)}</td>
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
}

function showItemModal() {
    document.getElementById('itemModalTitle').textContent = 'New Item';
    ['itemId', 'itSku', 'itName', 'itSalePrice', 'itPurchasePrice', 'itHsn', 'itBarcode'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('itUnit').value = 'pcs';
    document.getElementById('itWarranty').value = '0';
    document.getElementById('itReorder').value = '0';
    document.getElementById('itTrack').checked = true;
    document.getElementById('itSerial').checked = false;
    document.getElementById('itCategory').innerHTML = '';
    document.getElementById('itType').innerHTML = '';
    initItemModalDropdowns();
    AccountsCommon.openModal('itemModal');
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
    document.getElementById('itWarranty').value = i.warranty_months;
    document.getElementById('itReorder').value = i.reorder_level;
    document.getElementById('itTrack').checked = i.track_inventory;
    document.getElementById('itSerial').checked = i.tracking_mode === 'serial';
    document.getElementById('itCategory').innerHTML = '';
    document.getElementById('itType').innerHTML = '';
    initItemModalDropdowns(i.category_id, i.item_type);
    AccountsCommon.openModal('itemModal');
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
        warranty_months: parseInt(document.getElementById('itWarranty').value) || 0,
        reorder_level: parseFloat(document.getElementById('itReorder').value) || 0,
        track_inventory: document.getElementById('itTrack').checked,
        tracking_mode: document.getElementById('itSerial').checked ? 'serial' : 'none'
    };
    if (!payload.sku || !payload.name) { Toast.error('SKU and name are required'); return; }
    const btn = document.getElementById('saveItemBtn'); btn.disabled = true;
    try {
        if (id) await api.request(AccountsCommon.buildUrl(`inventory/items/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
        else await api.request(AccountsCommon.buildUrl('inventory/items'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success(id ? 'Item updated' : 'Item created');
        AccountsCommon.closeModal('itemModal');
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
        const [rows, val] = await Promise.all([
            api.request(AccountsCommon.buildUrl('inventory/stock'), { _skipSpinner: true }),
            api.request(AccountsCommon.buildUrl('inventory/valuation'), { _skipSpinner: true })
        ]);
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

function showAdjustModal() {
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
        const rows = await api.request(AccountsCommon.buildUrl('inventory/movements', itemId ? { itemId, limit: 200 } : { limit: 200 }), { _skipSpinner: true });
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
    } catch (err) { console.error('[Inventory] loadMovements', err); }
}

// ── Serials & warranty ─────────────────────────────────────────────────────
async function loadSerials() {
    try {
        const rows = await api.request(AccountsCommon.buildUrl('inventory/serials', { limit: 200 }), { _skipSpinner: true });
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
            <td class="actions-cell">${s.status === 'sold' ? `<button class="btn-icon" onclick="setSerialStatus('${esc(s.serial_no)}','returned')" data-tooltip="Mark returned">↩</button><button class="btn-icon" onclick="setSerialStatus('${esc(s.serial_no)}','claimed')" data-tooltip="Warranty claim">🛠</button>` : ''}</td>
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
    AccountsCommon.openModal('bomModal');
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
            body: JSON.stringify({ finished_item_id: itemId, quantity: qty, build_date: document.getElementById('buildDate').value })
        });
        Toast.success(`Built ${qty} @ ${AccountsCommon.formatCurrency(res.unit_cost)} each`);
        AccountsCommon.closeModal('bomModal');
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
