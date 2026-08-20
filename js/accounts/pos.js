/**
 * Cash Sale (POS) — 30-second counter flow: pick items → total → payment → receipt.
 * Creates the invoice, approves it, and records the payment against the Walk-in
 * Customer in one motion. Stocked items get COGS/stock-out via item_id lines.
 */

let posItems = [], taxConfigs = [], bankAccounts = [], incomeAccounts = [];
let cart = [];   // {item, qty}
let posBankDD = null, posMethodDD = null, posCategoryDD = null;

const money = v => AccountsCommon.formatCurrency(v);
const esc = s => AccountsCommon.escapeHtml(s ?? '');

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('pos', '../')) return;
    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', { 'pos-counter': 'Counter' });
    AccountsCommon.setupTabs({ 'pos-counter': 'Counter' });
    // POS runs full-width by default — the counter wants the whole screen. setupSidebar opens the nav on
    // desktop; override that here so this page loads with it HIDDEN. The hamburger still reveals it on demand.
    document.getElementById('sidebarToggle')?.classList.remove('active');
    document.getElementById('accountsSidebar')?.classList.remove('open');
    document.querySelector('.accounts-container')?.classList.remove('sidebar-open');
    document.getElementById('sidebarOverlay')?.classList.remove('active');
    accountsRoles.applyRBAC();
    const [itemsRes, taxRes, bankRes, coaRes] = await Promise.all([
        api.request(AccountsCommon.buildUrl('inventory/items', { usage: 'sales' }), { _skipSpinner: true }).catch(() => []),
        api.request(AccountsCommon.buildUrl('tax/configurations'), { _skipSpinner: true }).catch(() => []),
        api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => []),
        api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => [])
    ]);
    posItems = (Array.isArray(itemsRes) ? itemsRes : []).filter(i => i.is_active);
    taxConfigs = Array.isArray(taxRes) ? taxRes : (taxRes?.data || []);
    bankAccounts = (Array.isArray(bankRes) ? bankRes : []).filter(b => b.is_active !== false);
    incomeAccounts = AccountsCommon.postableAccounts(Array.isArray(coaRes) ? coaRes : (coaRes?.data || []), 'income');
    renderCategoryFilter();
    renderGrid();
    renderCart();
    posBankDD = new SearchableDropdown(document.getElementById('posBank'), {
        id: 'posBankDD',
        options: bankAccounts.map(b => ({ value: b.id, label: b.account_name + (b.bank_name ? ` (${b.bank_name})` : '') })),
        value: bankAccounts[0]?.id || '', placeholder: 'Select account…', compact: true
    });
    posMethodDD = new SearchableDropdown(document.getElementById('posMethod'), {
        id: 'posMethodDD',
        options: [
            { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' },
            { value: 'card', label: 'Card' }, { value: 'bank_transfer', label: 'Bank Transfer' }
        ],
        value: 'cash', compact: true
    });
    initPosCustomerPicker();   // bill-to picker (Walk-in default; known customers reprice via their list)
    loadPosSchemes();          // active free-goods schemes — auto free lines maintained per cart change
    connectStockHub();
    updateNetBadge();
    syncOfflineSales();   // drain anything queued from a previous offline session
    // Camera-scan button only where the native detector + a camera exist (Chrome/Android).
    if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia)
        document.getElementById('posCamBtn').style.display = '';
    const search = document.getElementById('posSearch');
    search.addEventListener('input', renderGrid);
    search.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = search.value.trim().toLowerCase();
            const sellable = i => !i.track_inventory || posSellable(i) > 0;
            const hit = posItems.find(i => (i.barcode || '').toLowerCase() === q)
                || posItems.find(i => i.sku.toLowerCase() === q)
                || filteredItems().find(sellable);
            if (hit) { addToCart(hit.id); search.value = ''; renderGrid(); }
            else if (looksLikeBarcode(q)) { search.value = ''; renderGrid(); posQuickAdd(q); }
        }
    });
});

/**
 * Multi-counter freshness: refetch the catalog (stock counts included), re-render,
 * and cap any cart line that another counter's sale has made unsellable.
 * Runs every 15s while the tab is visible, on tab focus, and after stock conflicts.
 */
async function refreshPosItems(silent = true) {
    posLotMrp.clear();   // lot MRPs can change as lots deplete — refetch with the catalog
    try {
        const res = await api.request(AccountsCommon.buildUrl('inventory/items', { usage: 'sales' }), { _skipSpinner: true });
        posItems = (Array.isArray(res) ? res : []).filter(i => i.is_active);
        let capped = false, packChanged = false;
        // BASE-unit-aware capping: walk this item's lines in cart order, each consuming from
        // what the fresh snapshot says remains (pack lines floor to whole packs).
        const remaining = new Map();
        cart.forEach(line => {
            const fresh = posItems.find(i => i.id === line.item.id);
            if (!fresh) return;
            line.item = fresh;
            // Re-anchor the line's unit to the fresh master: a case-rename keeps the line (renamed
            // label), a removed/renamed-away pack REVERTS the line to base units LOUDLY — the stale
            // pack badge would otherwise show pack pricing the backend can no longer resolve.
            if (line.uom) {
                if (fresh.sale_unit && line.uom.toLowerCase() === fresh.sale_unit.toLowerCase()) line.uom = fresh.sale_unit;
                else { line.uom = null; packChanged = true; }
            }
            // A line created at this counter seconds ago is exempt: its stock reads zero BECAUSE it
            // was just created, and capping to zero would delete the sale in progress.
            if (!fresh.track_inventory || line.counterCreated) return;
            if (!remaining.has(fresh.id)) remaining.set(fresh.id, fresh.qty_on_hand);
            const avail = remaining.get(fresh.id);
            const conv = lineConv(line);
            const maxQty = conv === 1 ? avail : Math.floor(avail / conv);
            if (line.qty > maxQty) { line.qty = Math.max(0, maxQty); capped = true; }
            remaining.set(fresh.id, avail - lineBaseQty(line));
        });
        cart = cart.filter(c => c.qty > 0);
        // posLotMrp was cleared above; re-fetch the FEFO lot MRP for every batch item still in the cart
        // so those lines keep their MRP price instead of silently falling back to the catalog price
        // (ensureLotMrp re-renders each line as its fetch lands).
        cart.forEach(c => ensureLotMrp(c.item));
        renderCategoryFilter();
        renderGrid(true);
        renderCart();
        if (capped) Toast.error('Stock changed at another counter — cart quantities adjusted.');
        if (packChanged) Toast.error('An item\'s pack definition changed — affected cart lines reverted to the base unit. Re-check prices.');
        // A successful fetch proves we're back online — drain any offline queue.
        if (netOffline) { netOffline = false; updateNetBadge(); }
        syncOfflineSales();
    } catch (err) { if (isNetworkError(err)) markOffline(); /* next tick retries */ }
}

setInterval(() => { if (!document.hidden) refreshPosItems(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPosItems(); });

// ═══════════════════════════════════════════════════════════════════════════
// OFFLINE MODE — the counter must keep billing when the internet dies.
// Sales completed offline are queued in IndexedDB (survives reload/power-cut),
// print a provisional receipt, and sync in order the moment the connection is
// back. Real invoice numbers are assigned at sync; replayed sales post WITHOUT
// stock enforcement (the goods already left the store — negative stock is the
// honest record of that, not a reason to lose the sale).
// ═══════════════════════════════════════════════════════════════════════════

let netOffline = !navigator.onLine;
let posSyncing = false;

function isNetworkError(err) {
    return !navigator.onLine || /failed to fetch|load failed|network\s?error|connection refused|err_(network|internet|connection)/i.test(err?.message || '');
}

function posDb(name) {
    return new Promise((resolve, reject) => {
        // TENANT-SCOPED database name: the offline queue for Company A lives in a DIFFERENT
        // IndexedDB than Company B's, so a sale queued under one company can NEVER sync into
        // another's books on a shared browser. The name derives from the current JWT, so sync
        // (which always opens the CURRENT tenant's DB) only ever drains this tenant's queue.
        // 'pos2' since multi-UoM: entries now carry per-line uom. A STALE pre-UoM tab replaying a
        // pack sale would post base prices with no unit (books ≠ printed receipt, silently) — the
        // new DB name makes new-schema entries invisible to old code; legacy entries are migrated
        // below and replay fine under current code (uom absent → base units, exactly as rung up).
        const tenantId = AccountsCommon.getTenantId?.();
        if (!tenantId) { reject(new Error('no tenant')); return; }   // not logged in → nothing to sync
        const r = indexedDB.open((name || 'ragenaizer-pos2-') + tenantId, 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('offline_sales')) r.result.createObjectStore('offline_sales', { keyPath: 'id' }); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

/** One-time drain of the pre-UoM queue DB into the current one (old entries have no uom — they
 *  replay correctly under current code). Old tabs keep using the old DB and never see new entries. */
async function migrateLegacyPosQueue() {
    try {
        const legacy = await posDb('ragenaizer-pos-');
        const entries = await new Promise((resolve, reject) => {
            const tx = legacy.transaction('offline_sales', 'readonly');
            const req = tx.objectStore('offline_sales').getAll();
            req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
        });
        for (const e of entries) {
            await posQueuePut(e);
            await new Promise((resolve, reject) => {
                const tx = legacy.transaction('offline_sales', 'readwrite');
                tx.objectStore('offline_sales').delete(e.id);
                tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            });
        }
    } catch { /* best effort — legacy DB may not exist */ }
}
async function posQueuePut(entry) {
    const db = await posDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('offline_sales', 'readwrite');
        tx.objectStore('offline_sales').put(entry);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
}
async function posQueueDelete(id) {
    const db = await posDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('offline_sales', 'readwrite');
        tx.objectStore('offline_sales').delete(id);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
}
async function posQueueAll() {
    const db = await posDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction('offline_sales', 'readonly').objectStore('offline_sales').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

function markOffline() {
    if (!netOffline) { netOffline = true; updateNetBadge(); }
}
window.addEventListener('offline', markOffline);
window.addEventListener('online', () => { netOffline = false; updateNetBadge(); syncOfflineSales(); });

async function updateNetBadge() {
    const el = document.getElementById('posNetBadge');
    if (!el) return;
    const entries = await posQueueAll().catch(() => []);
    const queued = entries.filter(e => e.status !== 'error').length;
    const errored = entries.filter(e => e.status === 'error').length;
    const show = (text, colorVar, clickable) => {
        el.style.display = '';
        el.textContent = text;
        el.style.color = `var(${colorVar})`;
        el.style.background = `color-mix(in srgb, var(${colorVar}) 15%, transparent)`;
        el.style.border = `1px solid color-mix(in srgb, var(${colorVar}) 40%, transparent)`;
        el.style.cursor = clickable ? 'pointer' : 'default';
        el.onclick = clickable ? showQueueIssues : null;
    };
    if (posSyncing) show(`Syncing ${queued} offline sale${queued === 1 ? '' : 's'}…`, '--brand-primary', false);
    else if (netOffline) show(`Offline — billing keeps working${queued ? ` · ${queued} queued` : ''}`, '--color-warning', false);
    else if (errored) show(`${errored} offline sale${errored === 1 ? '' : 's'} need attention`, '--color-error', true);
    else if (queued) show(`${queued} sale${queued === 1 ? '' : 's'} waiting to sync`, '--color-warning', false);
    else { el.style.display = 'none'; el.onclick = null; }
}

/** Queue a sale that couldn't reach the server; prints a provisional receipt. */
async function queueOfflineSale(sale) {
    // offlineRef is assigned once at sale creation (completeSale), so the idempotency keys for the
    // invoice create + payment are IDENTICAL whether the sale posts live or via replay.
    sale.id = sale.offlineRef;
    sale.at = new Date().toISOString();
    sale.status = 'queued';
    let sub = 0; const r2q = n => Math.round((n + Number.EPSILON) * 100) / 100; // EPSILON: 1.4999999999999998-style float error must round like the server's decimal AwayFromZero
    const netOf = c => { const g = r2q(salePx(c) * c.qty); return g - r2q(g * (c.disc || 0) / 100); };
    sale.cart.forEach(c => { sub += netOf(c); });
    const tax = posGroupedTax(sale.cart, netOf);   // per-slab, so the offline total matches the replayed invoice
    sale.total = Math.round((sub + tax) * 100) / 100;
    await posQueuePut(sale);
    // Optimistically decrement the local stock view (in BASE units) so the next offline sale
    // at THIS counter sees honest numbers (server truth returns on sync).
    sale.cart.forEach(c => { const it = posItems.find(i => i.id === c.item.id); if (it && it.track_inventory) { const b = lineBaseQty(c); it.qty_on_hand -= b; if (it.dispensable_qty != null) it.dispensable_qty = Math.max(0, Number(it.dispensable_qty) - b); } });
    await printReceipt(sale.offlineRef, sale.total, true, sale.cart, sale.customerName);
    Toast.success(`Sale saved offline (${sale.offlineRef}) — will sync when back online`);
    resetSaleState();
    renderCart(); renderGrid(true);
    updateNetBadge();
}

/**
 * Shared server flow for a sale: split by slab → create+approve invoices → one payment.
 * Resumable: progress (created invoices) is tracked on the sale object — and persisted
 * for queued sales — so a retry never double-creates invoices; the payment is
 * idempotent via a stable key.
 */
async function submitSaleToServer(sale, { enforceStock }) {
    if (!incomeAccounts.length) throw new Error('No postable Income account — set up your chart of accounts before syncing offline sales.');
    // Pack-definition drift guard: the receipt froze money at the SNAPSHOT pack price, but the
    // server resolves the conversion from the CURRENT item master at post time. If the pack was
    // redefined (or its unit renamed — incl. a base-unit rename that would silently launder the
    // pack line to conversion 1) while this sale waited, posting would move different stock than
    // the printed receipt promised. Fail LOUD so the sale lands in "needing attention" instead.
    for (const c of sale.cart) {
        if (!c.uom) continue;
        // Only meaningful against a LOADED catalog: after a transient items-fetch failure posItems
        // is [], and erroring here would permanently park every queued pack sale as "needing
        // attention" with a message blaming a perfectly fine item. Skip; the server still validates.
        if (!posItems.length) break;
        const fresh = posItems.find(i => i.id === c.item.id);
        if (!fresh)
            throw new Error(`'${c.item.name}' is no longer in the catalog — restore it before this sale can post.`);
        if (fresh.sale_unit !== c.item.sale_unit || (fresh.sale_conversion || 1) !== (c.item.sale_conversion || 1) || fresh.unit !== c.item.unit)
            throw new Error(`'${c.item.name}' pack definition changed since this sale was rung up (${c.qty} ${c.uom} @ receipt-time pack of ${c.item.sale_conversion || 1}) — review the item and re-ring or discard.`);
    }
    // Bill to the customer FROZEN on the sale (picked at the counter), else the Walk-in default.
    const customerId = sale.customerId || await ensureWalkInCustomer();
    const date = sale.date;
    const groups = [];
    {
        const map = new Map();
        sale.cart.forEach(c => {
            const key = effTaxConfigId(c.item) || '';
            if (!map.has(key)) { map.set(key, []); groups.push(map.get(key)); }
            map.get(key).push(c);
        });
    }
    const invoices = (sale.progress?.invoices || []).map(p => ({ ...p, items: [] }));
    for (let gi = invoices.length; gi < groups.length; gi++) {
        const groupCart = groups[gi];
        const lines = groupCart.map(c => ({
            item_id: c.item.id,
            description: c.item.name,
            hsn_sac: c.item.hsn_sac || '',
            quantity: c.qty,
            unit_price: salePx(c),         // FROZEN per-selected-unit price; backend converts qty × factor to base for stock
            uom: c.uom || null,
            discount_percent: c.disc || 0,
            account_id: c.item.income_account_id || incomeAccounts[0].id,
            ...(effTaxConfigId(c.item) ? { tax_config_id: effTaxConfigId(c.item) } : {})
        }));
        // client_ref makes the create IDEMPOTENT: if the server committed this invoice but the
        // response was lost, the replayed create returns the SAME invoice instead of a duplicate.
        // Stable per (sale, slab group). sale.offlineRef is assigned at sale creation (see completeSale).
        const inv = await api.request(AccountsCommon.buildUrl('invoices'), {
            method: 'POST',
            body: JSON.stringify({
                customer_id: customerId, invoice_date: date, due_date: date,
                notes: `Cash sale (POS · ${sale.offlineRef})`, client_ref: `${sale.offlineRef}:${gi}`, lines
            })
        });
        const invId = inv.id || inv?.data?.id;
        const alreadyApproved = (inv.status || inv?.data?.status) && (inv.status || inv?.data?.status) !== 'draft';
        let approved;
        if (alreadyApproved) {
            // The idempotent create returned an invoice already approved on a prior (lost-response)
            // attempt — don't re-approve (would double stock-out); reuse it as-is.
            approved = inv.data || inv;
        } else {
            try {
                approved = await api.request(AccountsCommon.buildUrl(`invoices/${invId}/approve`, enforceStock ? { enforceStock: true } : {}), { method: 'POST' });
            } catch (err) {
                if (enforceStock && (err.message || '').includes('INSUFFICIENT_STOCK')) {
                    await api.request(AccountsCommon.buildUrl(`invoices/${invId}`), { method: 'DELETE', _skipSpinner: true }).catch(() => {});
                    await refreshPosItems();
                    throw new Error('Just sold out at another counter — stock refreshed, please re-check the cart.');
                }
                throw err;
            }
        }
        invoices.push({
            invId,
            number: approved.invoice_number || approved?.data?.invoice_number,
            total: parseFloat(approved.total_amount ?? approved?.data?.total_amount),
            items: groupCart
        });
        sale.progress = { invoices: invoices.map(i => ({ invId: i.invId, number: i.number, total: i.total })) };
        if (sale.id) await posQueuePut(sale).catch(() => {});
    }
    const total = Math.round(invoices.reduce((s, i) => s + i.total, 0) * 100) / 100;
    await api.request(AccountsCommon.buildUrl('invoices/payments'), {
        method: 'POST',
        body: JSON.stringify({
            customer_id: customerId, payment_date: date, amount: total, tds_amount: 0,
            bank_account_id: sale.bankId, payment_method: sale.method,
            reference_number: sale.offlineRef ? `POS ${sale.offlineRef}` : 'POS',
            // Skip ₹0 invoices: a cross-GST free-goods scheme (free item in its own tax slab) produces an
            // all-free ₹0 invoice whose stock still moved, but a ₹0 payment allocation is rejected and
            // strands the whole sale. The ₹0 invoice needs no payment; only allocate to invoices with value.
            allocations: invoices.filter(i => i.total > 0).map(i => ({ customer_invoice_id: i.invId, allocated_amount: i.total }))
        }),
        headers: { 'Idempotency-Key': 'pos-' + (sale.offlineRef || invoices[0].invId) }
    });
    return { invoices, total };
}

/** Replay queued offline sales, oldest first. Stops on network loss; business
 * rejections are flagged for attention instead of blocking the rest. */
async function syncOfflineSales() {
    // Cross-TAB exclusion: posSyncing is per-tab, but two tabs on the same browser share one IndexedDB
    // queue. Without a shared lock both drain it and both call the non-idempotent approve on the same
    // (idempotently-created) invoice → double stock-out. Web Locks serializes across tabs; ifAvailable
    // means a second tab that can't get the lock simply skips this pass instead of queueing behind it.
    if (navigator.locks?.request) {
        return navigator.locks.request('pos-offline-sync', { ifAvailable: true }, async (lock) => {
            if (!lock) return;                 // another tab is draining — skip
            await _syncOfflineSalesInner();
        });
    }
    return _syncOfflineSalesInner();           // no Web Locks: fall back to the per-tab guard
}

async function _syncOfflineSalesInner() {
    if (posSyncing) return;
    // Claim the guard SYNCHRONOUSLY, before any await: the 'online' event and a 15s refresh tick can both
    // reach the check in the same event-loop turn while posSyncing is still false, and both would then
    // replay the same queued sale — the invoice/payment are server-idempotent but the APPROVE step is not,
    // so a double-approve slips through. Setting the flag now makes the guard actually exclusive.
    posSyncing = true;
    let syncedAny = false;   // did we ACTUALLY post any queued sale this pass?
    try {
        await migrateLegacyPosQueue();
        const entries = (await posQueueAll().catch(() => [])).filter(e => e.status !== 'error')
            .sort((a, b) => (a.at || '').localeCompare(b.at || ''));
        if (!entries.length) { updateNetBadge(); return; }
        updateNetBadge();
        for (const entry of entries) {
            // Same committed-guard as completeSale: once submitSaleToServer returns, the invoice(s) AND the
            // payment are committed on the server; the posQueueDelete after it is local cleanup. A failure in
            // that cleanup (e.g. an IndexedDB abort) must NOT re-file a fully-PAID sale as 'error' — that would
            // let the teller Discard it, cancelling the invoices but stranding the recorded payment. On a
            // post-commit failure, leave the entry as-is: the next sync retries idempotently (client_ref +
            // payment Idempotency-Key) and re-attempts the delete.
            let committed = false;
            try {
                const { invoices } = await submitSaleToServer(entry, { enforceStock: false });
                committed = true;
                syncedAny = true;
                await posQueueDelete(entry.id).catch(() => {});
                Toast.success(`${entry.offlineRef} synced — ${invoices.map(i => i.number).join(' · ')}`);
                if (entry.cart.some(c => c.item.tracking_mode === 'serial'))
                    Toast.error(`${entry.offlineRef} had serial-tracked items — assign serials in Inventory → Serials`);
            } catch (err) {
                if (committed) { Toast.error(`${entry.offlineRef} posted; local cleanup will finish on the next sync.`); continue; }
                if (isNetworkError(err)) { markOffline(); return; }
                entry.status = 'error'; entry.error = err.message || 'Posting failed';
                await posQueuePut(entry).catch(() => {});
                Toast.error(`${entry.offlineRef} could not post: ${entry.error}`);
            }
        }
    } finally {
        posSyncing = false;
        updateNetBadge();
        // Only refresh when we ACTUALLY synced a queued sale (stock changed). refreshPosItems() itself
        // calls syncOfflineSales(), so refreshing on an empty-queue pass mutually recurses into a constant
        // re-render loop (the POS "flickers" while an item sits in the cart, and hammers inventory/lookup
        // ~6×/sec). On the normal online path the queue is empty → syncedAny stays false → no refresh.
        if (syncedAny) refreshPosItems();
    }
}

/** Modal for offline sales the server rejected: retry after fixing, or discard. */
async function showQueueIssues() {
    const errored = (await posQueueAll().catch(() => [])).filter(e => e.status === 'error');
    if (!errored.length) { updateNetBadge(); return; }
    document.getElementById('posQueueModal')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal active';
    overlay.id = 'posQueueModal';
    overlay.innerHTML = `<div class="modal-content" style="max-width:520px;">
        <div class="modal-header"><h3>Offline sales needing attention</h3><button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button></div>
        <div class="modal-body">
            <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:10px;">These sales were billed offline but the server rejected them when syncing. Fix the cause (e.g. missing account setup), then retry — or discard if the sale was rung up by mistake.</p>
            ${errored.map(e => `<div style="border:1px solid var(--border-color);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;gap:8px;">
                    <strong>${esc(e.offlineRef)}</strong><span>${money(e.total || 0)}</span>
                </div>
                <div style="font-size:0.8rem;color:var(--text-secondary);">${esc(new Date(e.at).toLocaleString('en-IN'))} · ${e.cart.length} line${e.cart.length === 1 ? '' : 's'}</div>
                <div style="font-size:0.8rem;color:var(--color-error);margin-top:4px;">${esc(e.error || '')}</div>
                <button class="btn btn-outline" style="margin-top:8px;height:30px;padding:0 12px;font-size:0.8rem;" onclick="discardOfflineSale('${esc(AccountsCommon.escJs(e.id))}')">Discard</button>
            </div>`).join('')}
        </div>
        <div class="modal-footer">
            <button class="btn btn-outline" onclick="this.closest('.modal').remove()">Close</button>
            <button class="btn btn-primary" onclick="retryErroredSales()">Retry all</button>
        </div></div>`;
    document.body.appendChild(overlay);
}

async function retryErroredSales() {
    const entries = (await posQueueAll().catch(() => [])).filter(e => e.status === 'error');
    for (const e of entries) { e.status = 'queued'; delete e.error; await posQueuePut(e).catch(() => {}); }
    document.getElementById('posQueueModal')?.remove();
    syncOfflineSales();
}

async function discardOfflineSale(id) {
    // A multi-slab sale can have PARTIALLY posted before erroring: earlier groups' invoices are
    // approved (stock out, AR open) and recorded in entry.progress. A plain delete would orphan
    // them as phantom receivables — cancel them first so the books return to pre-sale truth.
    const entry = (await posQueueAll().catch(() => [])).find(e => e.id === id);
    const posted = entry?.progress?.invoices || [];
    const warn = posted.length
        ? `Part of this sale already posted (${posted.map(i => i.number || i.invId).join(', ')}). Discarding will CANCEL ${posted.length === 1 ? 'that invoice' : 'those invoices'} (restoring stock) and delete the queued sale.`
        : 'The queued sale will be deleted and never posted to the books. Only do this if it was rung up by mistake.';
    Confirm.show('Discard this offline sale?', warn, async () => {
        for (const inv of posted) {
            try { await api.request(AccountsCommon.buildUrl(`invoices/${inv.invId}/cancel`), { method: 'POST', body: JSON.stringify({ reason: `POS sale ${entry.offlineRef} discarded` }) }); }
            catch (err) {
                // An already-cancelled/written-off invoice (from a prior partial discard, or one the user
                // cancelled manually in Receivables) is a no-op success — SKIP it so a re-run resumes and reaches
                // the still-live invoices, instead of aborting forever on the first already-cancelled one (which
                // made the entry permanently un-discardable and left later invoices as phantom AR/stock).
                if (/already cancelled|already written[_ ]off/i.test(err.message || '')) continue;
                Toast.error(`Could not cancel ${inv.number || inv.invId}: ${err.message} — cancel it in Receivables, then discard again.`); return;
            }
        }
        await posQueueDelete(id).catch(() => {});
        document.getElementById('posQueueModal')?.remove();
        updateNetBadge();
        Toast.success(posted.length ? 'Posted invoices cancelled and offline sale discarded' : 'Offline sale discarded');
    });
}

/**
 * Live multi-counter channel: the backend pushes fresh item snapshots the instant any
 * counter's sale (or bill/adjustment/build/cancel) commits. Polling stays as fallback;
 * correctness is guaranteed by the server-side enforceStock lock either way.
 */
function applyStockPush(updates) {
    let capped = false;
    (updates || []).forEach(u => {
        const it = posItems.find(i => i.id === u.id);
        if (!it) return;
        it.qty_on_hand = u.qty_on_hand;
        it.avg_cost = u.avg_cost;
        // BASE-unit-aware capping across every cart line of this item (pack lines → whole packs).
        let avail = u.qty_on_hand;
        cart.filter(c => c.item.id === u.id && c.item.track_inventory).forEach(line => {
            const conv = lineConv(line);
            const maxQty = conv === 1 ? avail : Math.floor(avail / conv);
            if (line.qty > maxQty) { line.qty = Math.max(0, maxQty); capped = true; }
            avail -= lineBaseQty(line);
        });
    });
    cart = cart.filter(c => c.qty > 0);
    renderGrid(true);
    renderCart();
    if (capped) Toast.error('Stock changed at another counter — cart quantities adjusted.');
}

/**
 * Global keyboard wedge: USB/Bluetooth barcode scanners are HID keyboards that "type"
 * the code in <50ms bursts ending with Enter. A burst of ≥6 chars with <45ms gaps is
 * unambiguously a scan (humans type ~150ms/char), so scans are captured ANYWHERE on
 * the page — the teller can never miss a beep because focus was on a chip or stepper.
 * The search box keeps its own Enter handler; the wedge skips it to avoid double-adds.
 */
let _wedgeBuf = '';
let _wedgeLast = 0;
document.addEventListener('keydown', (e) => {
    const inSearch = e.target === document.getElementById('posSearch');
    // Editable fields other than the search box (line Disc %, qty inputs, modals) own their
    // keystrokes: a scan burst while one is focused would otherwise TYPE the barcode into it —
    // e.g. an EAN's first digits clamping a focused Disc box to 100% (a free-goods line) while
    // the trailing Enter still added the item, making the beep look like it "worked".
    const t = e.target;
    const inEditable = !inSearch && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (inEditable) { _wedgeBuf = ''; return; }
    const now = performance.now();
    if (now - _wedgeLast > 45) _wedgeBuf = '';
    _wedgeLast = now;
    if (e.key === 'Enter') {
        if (!inSearch && _wedgeBuf.length >= 6) {
            const code = _wedgeBuf.toLowerCase();
            _wedgeBuf = '';
            const hit = posItems.find(i => (i.barcode || '').toLowerCase() === code)
                || posItems.find(i => i.sku.toLowerCase() === code);
            if (hit) { e.preventDefault(); addToCart(hit.id); }
            else { e.preventDefault(); posQuickAdd(code); }
        }
        return;
    }
    if (e.key.length === 1) _wedgeBuf += e.key;
});

/**
 * Phone-camera scanning via the native BarcodeDetector (Chrome/Android — the dominant
 * store hardware in India). The button only appears where the API + camera exist;
 * elsewhere the wedge/search paths carry the load. On detect: same add path as a
 * hardware scanner, plus a vibration tick as the 'beep'.
 */
let _camStream = null, _camTimer = null, _camDetector = null;

async function startCameraScan() {
    try {
        _camDetector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
        _camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = document.getElementById('posCamVideo');
        video.srcObject = _camStream;
        document.getElementById('posCamOverlay').style.display = '';
        _camTimer = setInterval(async () => {
            try {
                const codes = await _camDetector.detect(video);
                if (!codes.length) return;
                const raw = (codes[0].rawValue || '').trim().toLowerCase();
                if (!raw) return;
                const hit = posItems.find(i => (i.barcode || '').toLowerCase() === raw)
                    || posItems.find(i => i.sku.toLowerCase() === raw);
                stopCameraScan();
                if (hit) { addToCart(hit.id); navigator.vibrate?.(60); }
                else { navigator.vibrate?.(60); posQuickAdd(raw); }
            } catch { /* per-frame detect errors are harmless */ }
        }, 250);
    } catch (err) {
        stopCameraScan();
        Toast.error(err?.name === 'NotAllowedError' ? 'Camera permission denied' : 'Camera scanning unavailable on this device');
    }
}

function stopCameraScan() {
    clearInterval(_camTimer); _camTimer = null;
    _camStream?.getTracks().forEach(t => t.stop());
    _camStream = null;
    document.getElementById('posCamOverlay').style.display = 'none';
}

let posHub = null;
let pairCode = null;
let pairToken = null;

function connectStockHub() {
    if (typeof signalR === 'undefined' || typeof getAuthToken !== 'function') return;
    try {
        posHub = new signalR.HubConnectionBuilder()
            .withUrl(`${CONFIG.endpoints.accounts}/hubs/stock`, { accessTokenFactory: () => getAuthToken() })
            .withAutomaticReconnect([0, 2000, 10000, 30000])
            .build();
        posHub.on('StockChanged', applyStockPush);
        posHub.on('ScannerPaired', () => {
            const st = document.getElementById('pairStatus');
            if (st) { st.textContent = '✓ Phone paired — scans land in this cart'; st.style.color = 'var(--color-success)'; }
            Toast.success('Phone scanner paired');
        });
        posHub.on('RemoteScan', (raw) => {
            const code = (raw || '').toLowerCase();
            const hit = posItems.find(i => (i.barcode || '').toLowerCase() === code)
                || posItems.find(i => i.sku.toLowerCase() === code);
            let ok = false, label = `No item with barcode '${raw}'`;
            if (hit) {
                const before = cart.reduce((s, c) => s + c.qty, 0);
                addToCart(hit.id);   // stock guards apply exactly as at the till
                ok = cart.reduce((s, c) => s + c.qty, 0) > before;
                label = ok ? hit.name : `'${hit.name}' out of stock`;
                if (!ok) label = `'${hit.name}' — out of stock`;
            } else {
                // The phone is not where the item gets created — the till is. Ack honestly (nothing was
                // added) and open the form on the counter screen, where someone is standing.
                label = `New item — finish on the counter screen`;
                posQuickAdd(raw);
            }
            if (pairToken) posHub.invoke('AckScan', pairToken, ok, label).catch(() => {});
        });
        posHub.start().then(() => console.log('[POS] stock hub connected'))
            .catch(err => console.warn('[POS] stock hub unavailable, polling only:', err?.message));
    } catch (e) { console.warn('[POS] stock hub init failed', e); }
}

/** Pair a phone as a handheld scanner: register a short code on the hub, show it big. */
async function pairPhoneScanner() {
    document.getElementById('pairModal')?.remove();   // repeat clicks replace, never stack
    if (!posHub || posHub.state !== 'Connected') { Toast.error('Live channel not connected yet — try again in a moment'); return; }
    pairCode = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    const reg = await posHub.invoke('RegisterPosSession', pairCode).catch(() => null);
    if (!reg?.token) { Toast.error('Could not open a pairing session'); return; }
    pairToken = reg.token;
    const overlay = document.createElement('div');
    overlay.className = 'modal active'; overlay.id = 'pairModal';
    const scanUrl = `${location.origin}/pages/accounts/scanner.html?token=${pairToken}`;
    overlay.innerHTML = `<div class="modal-content" style="max-width:420px;text-align:center;">
        <div class="modal-header"><h3>Pair phone scanner</h3><button class="close-btn" onclick="document.getElementById('pairModal').remove()">&times;</button></div>
        <div class="modal-body">
            <p style="font-size:0.88rem;color:var(--text-secondary);">Scan this with the phone's camera — it opens the scanner already paired to this counter:</p>
            <div id="pairQr" style="display:inline-block;background:#fff;padding:12px;border-radius:12px;margin:12px 0;"></div>
            <p style="font-size:0.8rem;color:var(--text-secondary);">or open <a href="${scanUrl}" target="_blank" style="word-break:break-all;">${scanUrl.replace(location.origin, 'ragenaizer.com')}</a><br>and enter the code:</p>
            <div style="font-size:2rem;font-weight:800;letter-spacing:0.3em;margin:8px 0;">${pairCode}</div>
            <p id="pairStatus" style="font-size:0.85rem;color:var(--text-secondary);">Waiting for the phone…</p>
        </div></div>`;
    document.body.appendChild(overlay);
    if (typeof QRCode !== 'undefined')
        new QRCode(document.getElementById('pairQr'), { text: scanUrl, width: 170, height: 170, correctLevel: QRCode.CorrectLevel.M });
}

function taxRateFor(configId) {
    const cfg = taxConfigs.find(t => t.id === configId);
    if (!cfg) return 0;
    const r = Number(cfg.configuration?.total_rate ?? cfg.rate ?? cfg.tax_rate ?? 0);
    if (r) return r;
    const m = (cfg.name || '').match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
}

// GST on a base at `rate`% computed the SAME way the backend posts an INTRA-STATE sale: split into two
// equal heads (CGST + SGST), round EACH to 2dp, then sum — so the cart total matches the receipt to the
// paisa (a flat round(base*rate/100) differed by ~1 paisa on odd amounts). POS walk-in is always the store's
// own state = intra-state, so the two-head split is always the right model here.
const gstOn = (base, rate) => { const half = Math.round((base * (rate / 2) / 100 + Number.EPSILON) * 100) / 100; return half * 2; };   // EPSILON: half-paisa float error must round like the server's AwayFromZero

// Total GST for a cart the SAME way the backend books it: PER SLAB (tax config), not per line. The server
// (submitSaleToServer) splits the cart by tax_config_id, sums each group's net, and applies gstOn ONCE per
// group. Summing gstOn(lineNet) per line instead over-rounds — e.g. two ₹5.30 lines at 18% give per-line
// 0.96+0.96=1.92 but per-slab round(10.60×9%)×2=1.90 — so the Charge button / receipt wouldn't foot to the
// booked invoice. netOf(c) returns a line's post-discount net (each caller already computes it identically).
function posGroupedTax(lines, netOf) {
    const bySlab = new Map();
    lines.forEach(c => { const k = effTaxConfigId(c.item) || ''; bySlab.set(k, (bySlab.get(k) || 0) + netOf(c)); });
    let tax = 0;
    for (const [k, net] of bySlab) tax += gstOn(net, taxRateFor(k));
    return tax;
}

// The tenant's active-DEFAULT GST config — the SAME one the backend applies to an invoice line that
// specifies no tax config (ResolveDocumentGstAsync → GetActiveTaxConfig: active GST slabs whose
// configuration.auto_default != 'false', ordered effective_from DESC, created_at ASC, id ASC). The POS must
// resolve it too, else an item with no tax_config_id previews ₹0 GST in the cart while the receipt (from the
// posted invoice) charges the default — the "print shows a different number" bug.
let _defaultGstId;
function defaultGstConfigId() {
    if (_defaultGstId !== undefined) return _defaultGstId;
    const cands = taxConfigs.filter(t => (t.tax_type || 'GST') === 'GST' && t.is_active !== false
        && String(t.configuration?.auto_default ?? 'true') !== 'false');
    cands.sort((a, b) =>
        String(b.effective_from || '').localeCompare(String(a.effective_from || '')) ||
        String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
        String(a.id).localeCompare(String(b.id)));
    _defaultGstId = cands[0]?.id || null;
    return _defaultGstId;
}
// Effective tax config for an item: its own, else the tenant default GST (so cart preview == posted receipt).
function effTaxConfigId(item) { return item.tax_config_id || defaultGstConfigId(); }

// SELLABLE on-hand: for a batch item this is the non-expired (dispensable) quantity the backend returns as
// dispensable_qty — the counter must not treat expired lots as sellable (the sale engine refuses them, so an
// expired-only item would look in-stock, skip the substitute prompt, and only fail at Charge). Falls back to
// qty_on_hand for a non-batch item or an older snapshot without the field.
// Cap by qty_on_hand as well as dispensable_qty: local stock mutations (offline sale decrement, online
// StockChanged push) update qty_on_hand but may leave dispensable_qty stale — Math.min ensures the sellable
// figure can never exceed what's actually on hand, so the oversell guard holds between full refetches.
function posSellable(it) { return it.dispensable_qty != null ? Math.min(Number(it.dispensable_qty), Number(it.qty_on_hand)) : it.qty_on_hand; }

// ── Bill-to customer + their price list (Feature: price lists → sales, POS) ──
// Walk-in by default. Picking a known customer bills the sale in their name and, when they
// carry a price list, REPRICES the cart with its per-base-unit rates (an explicit pricing
// action at the counter — POS has no manual price entry, so nothing user-typed is lost).
// Prices are FROZEN onto the sale snapshot at Charge, so offline replay posts exactly what
// the printed receipt promised even if the list changes while queued.
let posCustomerId = null;         // null = Walk-in Customer (resolved server-side)
let posCustomerName = 'Walk-in Customer';
let posPriceMap = new Map();      // item_id → per-base-unit list price
// Pharma: retail price for a batch item is the DISPENSED LOT's MRP, not the catalog price.
// item_id → { mrp, lot } from the POS lookup (FEFO next lot, expired lots already skipped
// server-side). null mrp cached too, so an item without lot MRP is only fetched once.
let posLotMrp = new Map();
let posCustomerDD = null;

// Reset ALL per-transaction state after a sale settles (live, offline, or partial-post). Resetting only
// cart+schemes left the bill-to CUSTOMER and their price list sticky, so the NEXT walk-in was silently sold at
// the previous customer's negotiated rates AND booked against their AR/name. A new transaction must always
// start as Walk-in at catalog prices unless the teller explicitly picks a customer.
function resetSaleState() {
    cart = [];
    posSchemeOptOut.clear();
    posCustomerId = null;
    posCustomerName = 'Walk-in Customer';
    posPriceMap = new Map();
    posCustomerDD?.setValue?.('');
}

async function initPosCustomerPicker() {
    const host = document.getElementById('posCustomer');
    if (!host || typeof SearchableDropdown !== 'function') return;
    let custs = [];
    try {
        const r = await api.request(AccountsCommon.buildUrl('customers', { limit: 500 }), { _skipSpinner: true });
        custs = (Array.isArray(r) ? r : (r?.data || r?.items || [])).filter(c => c.is_active !== false && c.name !== 'Walk-in Customer');
    } catch {
        // Walk-in still works, but flag the load failure so an empty customer list
        // isn't misread as "no customers on file".
        if (typeof Toast !== 'undefined') Toast.error('Could not load customers — walk-in only for now.');
    }
    host.innerHTML = '';
    posCustomerDD = new SearchableDropdown(host, {
        id: 'posCustomerDD',
        options: [{ value: '', label: 'Walk-in Customer' }, ...custs.map(c => ({ value: c.id, label: c.name }))],
        value: '', placeholder: 'Walk-in Customer', searchPlaceholder: 'Search customers…', compact: true,
        onChange: async (v) => {
            posCustomerId = v || null;
            const cust = custs.find(c => c.id === v);
            posCustomerName = cust?.name || 'Walk-in Customer';
            posPriceMap = new Map();
            if (cust?.price_list_id) {
                try {
                    const rows = await api.request(AccountsCommon.buildUrl(`price-lists/${cust.price_list_id}/prices`), { _skipSpinner: true });
                    (Array.isArray(rows) ? rows : (rows?.data || [])).forEach(r => posPriceMap.set(r.item_id, parseFloat(r.price)));
                    if (posPriceMap.size) Toast.info(`${cust.name}'s price list applied — cart repriced.`);
                } catch { /* fallback to standard prices */ }
            }
            renderCart();   // recompute all automatic prices under the new book of rates
        }
    });
}

/** Base (ex-GST) unit price: the bill-to customer's LIST price when one exists, else the
 *  catalog price; MRP-inclusive items back-compute. Back-out uses the EFFECTIVE config
 *  (item's own, else the tenant default) — the payload is taxed at that same effective
 *  config, so reading the raw tax_config_id here left an untagged MRP item un-backed-out
 *  while the server still added GST on top of the MRP. */
// Half-away-from-zero to 2dp — mirrors the backend's MidpointRounding.AwayFromZero so the
// frontend can predict exactly what GST the server will add per head.
function round2Away(v) {
    return Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-9) / 100;
}
// The backend's re-inclusive total for an ex-tax price: two GST heads (rate/2 each) rounded
// separately, matching the intra-state CGST+SGST posting (the worst case for round-up drift;
// single-head IGST rounds less, so staying ≤ MRP here keeps it ≤ MRP there too).
function inclusiveFromExTax(exTax, ratePct) {
    const head = round2Away(exTax * (ratePct / 2) / 100);
    return round2Away(exTax + 2 * head);
}
// Largest ex-tax price whose backend re-inclusive total does not exceed the MRP.
function mrpExTax(mrp, ratePct) {
    let ex = Math.floor((mrp / (1 + ratePct / 100)) * 100) / 100;
    // Guard against the two-head round-up overshoot; in practice this loops 0–1 times.
    while (ex > 0 && inclusiveFromExTax(ex, ratePct) > mrp + 1e-9) ex = Math.round((ex - 0.01) * 100) / 100;
    return ex;
}

function basePrice(i) {
    // A negotiated price-list price wins; else the FEFO lot's MRP (pharma retail); else catalog.
    const lot = posLotMrp.get(i.id);
    if (!posPriceMap.has(i.id) && lot && lot.mrp > 0) {
        // MRP is tax-INCLUSIVE by definition (Legal Metrology) — back the GST out. A plain floor of
        // MRP/(1+rate) isn't enough: the backend re-adds GST as TWO heads (CGST+SGST) each rounded to
        // the paisa, and two independent round-ups can push the re-inclusive total to MRP + 1p — a
        // Legal Metrology violation. Floor, then step DOWN a paisa until the backend's own two-head
        // rounding lands at or below MRP.
        const mrpRate = taxRateFor(effTaxConfigId(i));
        return mrpRate > 0 ? mrpExTax(lot.mrp, mrpRate) : lot.mrp;
    }
    const px = posPriceMap.has(i.id) ? posPriceMap.get(i.id) : i.sale_price;
    const rate = taxRateFor(effTaxConfigId(i));
    return i.price_includes_tax && rate > 0
        ? Math.round((px / (1 + rate / 100)) * 100) / 100
        : px;
}

// Lazily fetch the FEFO lot MRP for a batch item (server skips expired lots). Caches
// negative results so each item is asked at most once per catalog refresh.
async function ensureLotMrp(it) {
    if (it.tracking_mode !== 'batch' || posLotMrp.has(it.id)) return;
    posLotMrp.set(it.id, { mrp: null, lot: null });   // sentinel first — no refetch storms
    try {
        const r = await api.request(AccountsCommon.buildUrl('inventory/lookup', { code: it.sku }), { _skipSpinner: true });
        posLotMrp.set(it.id, { mrp: r?.next_batch_mrp ? parseFloat(r.next_batch_mrp) : null, lot: r?.next_batch_number || null });
        if (posLotMrp.get(it.id).mrp) renderCart();   // reprice the line that triggered the fetch
    } catch { /* keep sentinel — catalog price applies */ }
}

// ── Multiple UoM at the counter ──────────────────────────────────────────────
// A cart line can be rung in the item's sale pack (e.g. strip) instead of the base unit.
// Scans and grid taps ALWAYS target the base-unit line (a scan is one physical piece);
// the pack line is a separate cart entry. All stock caps compare BASE units.
function lineConv(c) { return c.uom && c.item.sale_unit && c.uom.toLowerCase() === c.item.sale_unit.toLowerCase() ? (c.item.sale_conversion || 1) : 1; }   // case-insensitive: the backend resolves names OrdinalIgnoreCase — a case-only rename must not silently reprice
/** Per-selected-unit price for SALE math: the price FROZEN on the snapshot at Charge when
 *  present (offline replay must post the receipt's numbers), else the live computed price. */
function salePx(c) { return c.px != null ? c.px : linePrice(c); }

// ── Trade schemes (buy N get M free) at the counter ─────────────────────────
// One AUTO free line per scheme, maintained after every cart change: qty (BASE units) =
// floor(Σ paid base qty of the bought item ÷ buy_qty) × free_qty, capped to available stock.
// The free line rides the normal machinery as a 100%-discount line (stock out, zero revenue).
// Removing it opts the SALE out of that scheme; the sale snapshot freezes it like any line.
let posSchemes = [];                    // active schemes for today (loaded once per session)
const posSchemeOptOut = new Set();      // scheme ids the teller removed for THIS sale

async function loadPosSchemes() {
    try {
        const r = await api.request(AccountsCommon.buildUrl('trade-schemes', { activeOn: AccountsCommon.todayLocal() }), { _skipSpinner: true });
        posSchemes = Array.isArray(r) ? r : (r?.data || []);
    } catch { posSchemes = []; }
}

function recomputeFreeLines() {
    if (!posSchemes.length) return;
    let changed = false;
    for (const s of posSchemes) {
        const freeItemId = s.free_item_id || s.item_id;
        const freeItem = posItems.find(i => i.id === freeItemId);
        const existing = cart.find(c => c.freeScheme === s.id);
        const paidBase = cart.filter(c => !c.free && c.item.id === s.item_id).reduce((sum, c) => sum + lineBaseQty(c), 0);
        let entitled = posSchemeOptOut.has(s.id) || !freeItem ? 0 : Math.floor(paidBase / s.buy_qty) * s.free_qty;
        if (entitled > 0 && freeItem.track_inventory) {
            // The free goods leave the shelf too — never promise more than remains after paid lines, and only
            // count SELLABLE (non-expired) stock so a scheme can't auto-add an expired free good.
            const avail = posSellable(freeItem) - cart.filter(c => c !== existing && c.item.id === freeItemId).reduce((sum, c) => sum + lineBaseQty(c), 0);
            if (entitled > avail) { entitled = Math.max(0, Math.floor(avail / s.free_qty) * s.free_qty); if (existing?.qty !== entitled) Toast.error(`'${freeItem.name}' free goods limited by stock.`); }
        }
        if (entitled > 0) {
            if (!existing) { cart.push({ item: freeItem, qty: entitled, disc: 100, uom: null, free: true, freeScheme: s.id, schemeName: s.name }); changed = true; }
            else if (existing.qty !== entitled) { existing.qty = entitled; changed = true; }
        } else if (existing) {
            cart = cart.filter(c => c !== existing); changed = true;
        }
    }
    return changed;
}

/** Teller removed the free line — opt this sale out of the scheme (won't re-add on recompute). */
function removeFreeLine(idx) {
    const line = cart[idx];
    if (!line?.free) return;
    posSchemeOptOut.add(line.freeScheme);
    cart = cart.filter(c => c !== line);
    renderCart();
}
function linePrice(c) { const conv = lineConv(c); return conv === 1 ? basePrice(c.item) : Math.round(basePrice(c.item) * conv * 100) / 100; }
function lineBaseQty(c) { return Math.round(c.qty * lineConv(c) * 10000) / 10000; }
function itemBaseInCart(itemId, exceptLine) { return cart.filter(c => c.item.id === itemId && c !== exceptLine).reduce((s, c) => s + lineBaseQty(c), 0); }
/** Offerable pack for an item at the counter (serial items sell per piece only). */
function packOf(i) { return i.sale_unit && i.tracking_mode !== 'serial' ? i.sale_unit : null; }

let posCategory = '';   // active category chip ('' = all)
const POS_PAGE = 60;     // rows appended per scroll batch (infinite scroll)
let posVisible = POS_PAGE;
let posScrollObserver = null;

function filteredItems() {
    const q = (document.getElementById('posSearch')?.value || '').toLowerCase();
    return posItems.filter(i =>
        (!posCategory || i.category_name === posCategory) &&
        (!q || i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q)));
}

// Category is a SECONDARY filter on a scan/search-first POS, and there can be ~60 of them — a searchable
// dropdown scales to that and reclaims the whole row for the item grid, where a wrapping chip wall buried it.
function renderCategoryFilter() {
    const host = document.getElementById('posCats');
    if (!host) return;
    const wrap = host.closest('.pos-cat-filter');
    const cats = [...new Set(posItems.map(i => i.category_name).filter(Boolean))].sort();
    if (!cats.length) { if (wrap) wrap.style.display = 'none'; return; }
    if (wrap) wrap.style.display = '';
    const opts = [{ value: '', label: 'All categories' }, ...cats.map(c => ({ value: c, label: c }))];
    if (posCategoryDD) {
        posCategoryDD.setOptions(opts, true);   // preserve the current pick if it's still stocked
        // A category that sold out its last unit can vanish from the list — fall back to All so the grid
        // doesn't stay filtered to nothing.
        if (posCategory && !cats.includes(posCategory)) { posCategory = ''; posCategoryDD.setValue('', false); renderGrid(); }
        return;
    }
    posCategoryDD = new SearchableDropdown(host, {
        id: 'posCatDD', options: opts, value: posCategory || '',
        placeholder: 'All categories', searchPlaceholder: 'Search categories…',
        onChange: (v) => setPosCategory(v || '')
    });
}

function setPosCategory(c) { posCategory = c; renderGrid(); }

/** Watch the sentinel under the table; append the next batch when it scrolls into view. */
function armPosScroll() {
    const sentinel = document.getElementById('posMoreSentinel');
    if (!sentinel) return;
    posScrollObserver?.disconnect();
    posScrollObserver = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) {
            posVisible += POS_PAGE;
            renderGrid(true);
        }
    }, { rootMargin: '200px' });
    posScrollObserver.observe(sentinel);
}

/** Small product thumbnail for a grid row. Uses the item's first image (the storefront main image);
 *  falls back to a letter badge when the item has no image or the URL fails to load. Lazy-loaded so a
 *  7,000-item catalogue only fetches what's on screen. */
function posThumb(i) {
    let urls = i.image_urls;
    if (typeof urls === 'string') { try { urls = JSON.parse(urls); } catch { urls = []; } }
    urls = Array.isArray(urls) ? urls : [];
    const url = urls.find(u => typeof u === 'string' && /^https?:\/\//i.test(u));
    const letter = esc((String(i.name || '?').trim()[0] || '?').toUpperCase());
    if (!url) return `<span class="pos-thumb">${letter}</span>`;
    // Letter shows behind; the image covers it once loaded, and re-shows if the URL 404s (onerror removes it).
    return `<span class="pos-thumb"><span class="pos-thumb-letter">${letter}</span><img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

function renderGrid(keepCount) {
    if (!keepCount) posVisible = POS_PAGE;   // search/category change restarts the window
    const grid = document.getElementById('posGrid');
    const all = filteredItems();
    // Dense table + infinite scroll: render in POS_PAGE batches, appending as the
    // sentinel under the table enters the viewport. Scanning/search stays the fast path.
    const rows = all.slice(0, posVisible);
    if (!rows.length) {
        grid.innerHTML = `<div class="pos-empty"><p style="font-size:2rem;margin-bottom:8px;">🛒</p><p><strong>${posItems.length ? 'No matches.' : 'No items yet.'}</strong></p><p>${posItems.length ? 'Try a different search or category.' : 'Build your catalog in <a href="inventory.html">Inventory → Items</a> — or import it from CSV in one paste.'}</p></div>`;
        return;
    }
    grid.innerHTML = `<div class="pos-table-wrap"><table class="pos-table">
        <thead><tr><th>Item</th><th>SKU</th><th>Category</th><th class="r">Price</th><th class="r">Stock</th><th></th></tr></thead>
        <tbody>${rows.map((i, idx) => { const sell = posSellable(i); return `
            <tr class="${idx === 0 ? 'first' : ''}${i.track_inventory && sell <= 0 ? ' pos-oos' : ''}"${i.description ? ` title="${esc(i.description)}"` : ''} onclick="addToCart('${i.id}')">
                <td class="nm"><div class="pos-nm-cell">${posThumb(i)}<span>${esc(i.name)}${i.rack ? ` <span style="font-size:.72rem;color:var(--text-secondary);border:1px solid var(--border-color);border-radius:4px;padding:0 4px;white-space:nowrap;">📍 ${esc(i.rack)}</span>` : ''}</span></div></td>
                <td class="sku">${esc(i.sku)}</td>
                <td class="cat">${esc(i.category_name || '—')}</td>
                <td class="r pr">${money(i.sale_price)}</td>
                <td class="r ${i.track_inventory && sell <= 0 ? 'out' : ''}">${i.track_inventory ? sell : '—'}</td>
                <td class="r">${i.track_inventory && sell <= 0 ? '<span class="pos-add off">✕</span>' : '<span class="pos-add">+</span>'}</td>
            </tr>`; }).join('')}
        </tbody></table></div>
        ${all.length > rows.length
            ? `<div class="pos-more" id="posMoreSentinel">Showing ${rows.length} of ${all.length} — scroll for more, type to narrow, or scan.</div>`
            : `<div class="pos-more">${all.length} item${all.length === 1 ? '' : 's'}</div>`}`;
    if (all.length > rows.length) armPosScroll();
}

/**
 * @param {boolean} justCreated Set ONLY by quick-add, for the item created seconds ago from a product
 *   the teller is physically holding.
 *
 *   The stock guard below exists to stop a counter ringing more than the shelf holds — right in every
 *   normal case, and wrong in exactly this one. A just-created item has no recorded stock by
 *   definition, so the guard refused to sell the very product that caused it to be created: the form
 *   succeeded, the item appeared in the grid greyed out, and the sale could not be completed. If no
 *   quantity was entered, stock goes to -1 after the sale, which is the truthful record — one was sold
 *   that was never recorded as received — and the reorder report and next stock count both surface it.
 */
function addToCart(itemId, justCreated = false) {
    const it = posItems.find(x => x.id === itemId);
    if (!it) return;
    // Scans/taps are one physical piece — always the BASE-unit line (pack lines are separate).
    const line = cart.find(c => c.item.id === itemId && !c.uom);
    // Counter sales are physical goods in hand: never ring more than the shelf holds.
    // (The B2B invoice flow still allows advance-order oversell — that's deliberate.)
    if (it.track_inventory && !justCreated) {
        const inCartBase = itemBaseInCart(itemId, null);
        const sell = posSellable(it);   // non-expired for batch items — expired-only ⇒ offer a substitute
        if (sell <= 0) { offerSubstitutes(it); return; }
        if (inCartBase + 1 > sell) { Toast.error(`Only ${sell} ${it.unit || ''} of '${it.name}' in stock.`); return; }
    }
    if (line) line.qty += 1;
    // counterCreated survives on the LINE, not just this call: the 15-second multi-counter refresh
    // re-caps every line against fresh stock, and a just-created item reads zero by definition —
    // it would cap this line to 0 and then filter it out, silently deleting the very sale that
    // caused the item to be created. The teller is holding the product; the shelf provably has it.
    else cart.push({ item: it, qty: 1, disc: 0, uom: null, counterCreated: justCreated || undefined });
    ensureLotMrp(it);
    renderCart();
}

function setQty(idx, qty) {
    const line = cart[idx];
    if (!line) return;
    let capped = Math.max(0, qty);
    if (line.item.track_inventory) {
        // Cap in BASE units across every cart line of this item; pack lines cap to whole packs. Cap against
        // SELLABLE (non-expired) stock — expired lots aren't dispensable at the counter.
        const sell = posSellable(line.item);
        const availBase = sell - itemBaseInCart(line.item.id, line);
        const conv = lineConv(line);
        const maxQty = conv === 1 ? availBase : Math.floor(availBase / conv);
        if (capped > maxQty) {
            capped = Math.max(0, maxQty);
            Toast.error(`Only ${sell} ${line.item.unit || ''} of '${line.item.name}' in stock.`);
        }
    }
    line.qty = capped;
    if (!line.qty) cart = cart.filter(c => c !== line);
    renderCart();
}

// Which cart line is expanded for editing (unit toggle + discount). Tracked by LINE OBJECT
// identity, not index — merges/removals shift indices and an index-tracked expansion would
// silently jump to a neighbouring line (wrong-line discount at a busy counter).
let posExpandedLine = null;
function togglePosLine(idx) {
    const line = cart[idx];
    posExpandedLine = posExpandedLine === line ? null : (line || null);
    renderCart();
}

/** Switch a cart line between the base unit and the item's sale pack. The NUMBER stays
 *  ("3" pcs → "3" strips — the cashier said three of the now-selected thing); price and
 *  stock caps re-derive. Merges into an existing line of the target unit if one exists. */
function setLineUom(idx, uom) {
    const line = cart[idx];
    if (!line) return;
    const target = uom || null;
    if ((line.uom || null) === target) return;
    // Never auto-merge into an existing line of the target unit: the NUMBERS are in different
    // units (3 pcs + 2 strip ≠ "5 strip" — that one tap would ring 50 tablets), and discounts
    // may differ. The teller adjusts the existing line directly instead.
    const twin = cart.find(c => c !== line && c.item.id === line.item.id && (c.uom || null) === target);
    if (twin) {
        Toast.error(`'${line.item.name}' already has a ${target || line.item.unit || 'base'} line — adjust that line's quantity instead.`);
        return;
    }
    line.uom = target;
    if (line.item.track_inventory) {
        const sell = posSellable(line.item);
        const availBase = sell - itemBaseInCart(line.item.id, line);
        const conv = lineConv(line);
        const maxQty = conv === 1 ? availBase : Math.floor(availBase / conv);
        if (line.qty > maxQty) {
            line.qty = Math.max(0, maxQty);
            Toast.error(`Only ${sell} ${line.item.unit || ''} of '${line.item.name}' in stock — quantity adjusted.`);
        }
    }
    cart = cart.filter(c => c.qty > 0);
    renderCart();
}

// Per-line trade discount % at the counter. Clamped 0-100; recompute totals live. Sent as
// discount_percent to the same POST /invoices endpoint (backend charges GST on the net).
function setLineDisc(idx, val) {
    const line = cart[idx];
    if (!line) return;
    // Round to 2dp — the backend rejects finer (DECIMAL(5,2)); a typed 12.345 must not 400 at Charge.
    line.disc = Math.round(Math.min(100, Math.max(0, parseFloat(val) || 0)) * 100) / 100;
    // Recompute totals WITHOUT re-rendering the row (keeps focus in the input the user is typing in).
    let sub = 0;
    const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const netOf = c => { const g = r2(linePrice(c) * c.qty); return g - r2(g * (c.disc || 0) / 100); };
    cart.forEach(c => { sub += netOf(c); });
    const tax = posGroupedTax(cart, netOf);   // per-slab, matching the booked invoice
    document.getElementById('posSub').textContent = money(sub);
    document.getElementById('posTax').textContent = money(tax);
    document.getElementById('posTotal').textContent = money(sub + tax);
    updatePayButton(sub, tax);
    // refresh the line's net amount cell
    const rows = document.querySelectorAll('#posCart tr');
    cart.forEach((c, i) => { const cell = rows[i]?.querySelector('.pos-line-amt'); if (cell) { const g = r2(linePrice(c) * c.qty); cell.textContent = money(g - r2(g * (c.disc || 0) / 100)); } });
}

/** Single source of truth for the Charge button. Disabled when the cart is empty (no zero-value
 *  "sale" — invoice + payment + receipt fire on Charge) and left alone while a sale is posting
 *  (the processing flag), so no caller can re-enable it mid-post or clobber "Processing…". */
function updatePayButton(sub, tax) {
    const btn = document.getElementById('posPayBtn');
    if (!btn || btn.dataset.processing === '1') return;
    const has = cart.length > 0;
    btn.disabled = !has;
    btn.textContent = has ? `Charge ${money(sub + tax)}` : 'Charge ₹0.00';
}

function renderCart() {
    const tb = document.getElementById('posCart');
    recomputeFreeLines();   // single choke point — every cart mutation lands here
    if (posExpandedLine && !cart.includes(posExpandedLine)) posExpandedLine = null;   // line removed under the expansion
    const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const lineNet = c => { const g = r2(linePrice(c) * c.qty); return g - r2(g * (c.disc || 0) / 100); };
    // ONE compact row per line (≈50px): name + tiny context, always-on qty stepper, bold amount.
    // Tapping the line expands ONE extra row with the occasional controls — unit toggle + a
    // labelled Disc % box — so editing power never costs permanent height (Square/Shopify POS
    // pattern). posExpandedLine (object identity) tracks the single expanded line.
    const chipStyle = 'padding:4px 14px;font-size:12px;line-height:1.5;border-radius:999px;cursor:pointer;';
    const chipOff = chipStyle + 'border:1px solid var(--border-color, #3a4358);background:transparent;color:var(--text-secondary,#9aa4b8);';
    const chipOn = chipStyle + 'border:1px solid var(--brand-primary,#3b6ef5);background:var(--brand-primary,#3b6ef5);color:#fff;';
    tb.innerHTML = cart.length ? cart.map((c, idx) => {
        // Auto free-goods line: read-only card — FREE badge, no stepper/disc (qty is scheme-managed),
        // ✕ opts the sale out of the scheme. Amount ₹0.00 via the normal 100%-discount math.
        if (c.free) return `<tr><td colspan="4" style="padding:9px 12px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="flex:1;min-width:0;">
                    <div class="pos-line-name" style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.item.name)}</div>
                    <div class="sub" style="font-size:11px;"><span style="color:var(--color-success,#3fb96f);font-weight:700;">FREE</span> ×${c.qty}${c.item.unit ? ' ' + esc(c.item.unit) : ''} · ${esc(c.schemeName || 'scheme')}</div>
                </div>
                <div class="pos-line-amt" style="font-size:14px;font-weight:700;flex-shrink:0;min-width:70px;text-align:right;">₹0.00</div>
                <button type="button" class="btn-icon" title="Remove free goods (opt out of the scheme for this sale)" onclick="removeFreeLine(${idx})" style="flex-shrink:0;">✕</button>
            </div>
        </td></tr>`;
        const pack = packOf(c.item);
        const open = posExpandedLine === c;
        const lotPx = !posPriceMap.has(c.item.id) && posLotMrp.get(c.item.id)?.mrp > 0 ? posLotMrp.get(c.item.id) : null;
        const context = `${money(linePrice(c))}${c.uom ? `/${esc(c.uom)}` : ''}${lotPx ? ` · MRP${lotPx.lot ? ' ' + esc(lotPx.lot) : ''}` : ''}${(c.disc || 0) > 0 ? ` · −${c.disc}%` : ''}`;
        const expanded = open ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;flex-wrap:wrap;">
            ${pack ? `<div style="display:flex;gap:6px;align-items:center;">
                <span class="sub" style="font-size:11px;">Sell per</span>
                <button type="button" style="${!c.uom ? chipOn : chipOff}" onclick="event.stopPropagation(); setLineUom(${idx}, null)">${esc(c.item.unit || 'pcs')}</button>
                <button type="button" style="${c.uom === pack ? chipOn : chipOff}" onclick="event.stopPropagation(); setLineUom(${idx}, '${esc(AccountsCommon.escJs(pack))}')">${esc(pack)} ×${c.item.sale_conversion || 1}</button>
            </div>` : '<span></span>'}
            <label class="sub" style="display:flex;align-items:center;gap:6px;cursor:text;font-size:12px;" onclick="event.stopPropagation();">Discount
                <input type="number" class="pos-line-disc" value="${c.disc || ''}" min="0" max="100" step="0.01" placeholder="0" title="Discount %" oninput="setLineDisc(${idx}, this.value)" style="width:70px;padding:7px 8px;text-align:right;font-size:13px;">%
            </label>
        </div>` : '';
        return `<tr><td colspan="4" style="padding:9px 12px;cursor:pointer;${open ? 'background:var(--bg-tertiary,rgba(255,255,255,0.03));' : ''}" onclick="togglePosLine(${idx})">
        <div style="display:flex;align-items:center;gap:10px;">
            <div style="flex:1;min-width:0;">
                <div class="pos-line-name" style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.item.name)}</div>
                <div class="sub" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${context} <span style="opacity:.65;">· tap to edit</span></div>
            </div>
            <span class="pos-qty" style="flex-shrink:0;" onclick="event.stopPropagation();">
                <button type="button" onclick="setQty(${idx}, ${c.qty - 1})">−</button>
                <span>${c.qty}${c.uom ? ` <small style="font-size:9.5px;">${esc(c.uom)}</small>` : ''}</span>
                <button type="button" onclick="setQty(${idx}, ${c.qty + 1})">+</button>
            </span>
            <div class="pos-line-amt" style="font-size:14px;font-weight:700;flex-shrink:0;min-width:70px;text-align:right;">${money(lineNet(c))}</div>
        </div>
        ${expanded}
    </td></tr>`;
    }).join('') : '<tr><td class="pos-cart-empty" colspan="4">Cart is empty — tap items or scan a barcode.</td></tr>';
    let sub = 0, count = 0;
    cart.forEach(c => { sub += lineNet(c); count += lineBaseQty(c); });
    const tax = posGroupedTax(cart, lineNet);   // per-slab, matching the booked invoice
    document.getElementById('posSub').textContent = money(sub);
    document.getElementById('posTax').textContent = money(tax);
    document.getElementById('posTotal').textContent = money(sub + tax);
    const countEl = document.getElementById('posCartCount');
    if (countEl) countEl.textContent = `${count} item${count === 1 ? '' : 's'}`;
    updatePayButton(sub, tax);
}

async function ensureWalkInCustomer() {
    const res = await api.request(AccountsCommon.buildUrl('customers', { limit: 200 }), { _skipSpinner: true });
    const list = Array.isArray(res) ? res : (res?.data || res?.items || []);
    const found = list.find(c => c.name === 'Walk-in Customer');
    if (found) return found.id;
    // Backend requires a phone and, for a domestic (unregistered) party, a state code
    // (place of supply). A counter sale is by definition in the shop, so the business's
    // own home state from Settings IS the place of supply; the phone is a placeholder.
    let stateCode = '';
    try { const s = await api.request(AccountsCommon.buildUrl('settings'), { _skipSpinner: true }); stateCode = (s?.data || s || {}).state_code || ''; } catch { }
    if (!stateCode) throw new Error('Set your business state in Settings first — POS needs it to classify GST on counter sales.');
    const created = await api.request(AccountsCommon.buildUrl('customers'), {
        method: 'POST',
        // Placeholder contact fields: the backend requires the full party profile, but a
        // walk-in counter buyer has none — the store's own location stands in.
        body: JSON.stringify({
            name: 'Walk-in Customer', phone: '0000000000', email: 'walkin@pos.local',
            billing_address_line1: 'Counter sale', city: 'Counter sale', state: 'As per store', country: 'India',
            payment_terms_days: 0, gst_treatment: 'unregistered', state_code: stateCode
        })
    });
    return created.id || created?.data?.id;
}

async function completeSale() {
    if (!cart.length) { Toast.error('Cart is empty'); return; }
    const bankId = posBankDD?.getValue?.();
    if (!bankId) { Toast.error('Pick the account the money went into'); return; }
    if (!incomeAccounts.length) { Toast.error('No postable Income account found — set up your chart of accounts first.'); return; }
    const btn = document.getElementById('posPayBtn');
    btn.dataset.processing = '1'; btn.disabled = true; btn.textContent = 'Processing…';
    // Snapshot the sale up front: the same object either posts live or gets queued,
    // and any invoices already created before a mid-sale network drop ride along in
    // sale.progress so the replay never double-creates them.
    const sale = {
        cart: cart.map(c => ({ item: { ...c.item }, qty: c.qty, disc: c.disc || 0, uom: c.uom || null, px: linePrice(c) })),   // px FROZEN: replay posts the receipt's price
        customerId: posCustomerId, customerName: posCustomerName,
        date: AccountsCommon.todayLocal(),
        bankId,
        method: posMethodDD?.getValue?.() || 'cash',
        // Stable ref for this sale, assigned up front so the invoice-create client_ref and the
        // payment Idempotency-Key are the SAME whether the sale posts live or via offline replay.
        offlineRef: 'OFF-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()
    };
    // Once submitSaleToServer returns, the invoice(s) AND the payment are fully committed on the server —
    // everything after is cosmetic (receipt print, serial prompt, grid refresh). A failure in that cosmetic
    // tail must NOT fall through to the partial-post/needs-attention handling below: that branch is for a sale
    // that posted PARTWAY with NO payment, and Discarding it cancels the invoices but can't reverse a payment
    // that was never made — so mis-routing a fully-PAID sale there would let the teller Discard it and strand
    // the cash receipt. `committed` short-circuits the catch for any post-commit failure.
    let committed = false;
    try {
        if (netOffline) { await queueOfflineSale(sale); return; }
        const { invoices, total } = await submitSaleToServer(sale, { enforceStock: true });
        committed = true;
        Toast.success(`Sale complete — ${money(total)}`);
        await printReceipt(invoices.map(i => i.number).join(' · '), total, false, sale.cart, sale.customerName);
        await promptSerials(invoices, sale.date);
        resetSaleState();
        renderCart();
        // refresh stock counts on the grid
        posItems = (await api.request(AccountsCommon.buildUrl('inventory/items', { usage: 'sales' }), { _skipSpinner: true })).filter(i => i.is_active);
        renderCategoryFilter();
        renderGrid();
    } catch (err) {
        console.error('[POS] completeSale', err);
        if (committed) {
            // Sale posted + PAID successfully; only a post-sale cosmetic step failed. Clear the counter and move
            // on — never re-queue (double-print/double-decrement) or file as needs-attention (Discard would
            // strand the recorded payment). The receipt may not have printed; the sale is safely in the books.
            resetSaleState();
            renderCart();
            Toast.error('Sale posted successfully — a post-sale step (receipt or stock refresh) failed. Reload if the grid looks stale; the sale is recorded.');
            return;
        }
        if (isNetworkError(err)) {
            markOffline();
            await queueOfflineSale(sale);
        } else if (sale.progress?.invoices?.length) {
            // A multi-slab sale that PARTIALLY posted (earlier groups approved — stock out, AR
            // open) must not evaporate into a toast: persist it as a needs-attention entry so
            // Retry resumes idempotently from sale.progress (same offlineRef → same client_refs →
            // the posted groups dedupe) and Discard cancels the posted invoices. Losing the object
            // here caused double-posted groups on re-ring and phantom AR.
            sale.id = sale.offlineRef; sale.at = new Date().toISOString();
            sale.status = 'error'; sale.error = err.message || 'Posting failed part-way';
            await posQueuePut(sale).catch(() => {});
            resetSaleState();
            Toast.error(`${err.message || 'Sale failed part-way'} — the sale is saved under "needing attention": fix the cause and Retry (it resumes where it stopped), or Discard to cancel what posted.`);
            updateNetBadge();
        } else {
            Toast.error(err.message || 'Sale failed — check Receivables for a stranded draft/approved invoice.');
        }
    } finally {
        delete btn.dataset.processing; btn.disabled = false; renderCart();   // renderCart re-disables if the cart is now empty
    }
}

/**
 * After a sale containing serial-tracked items: pick WHICH units went out, so the
 * warranty registry stays exact. Skippable (serials can be marked later in Inventory).
 */
async function promptSerials(invoices, soldDate) {
    const serialLines = [];
    for (const inv of invoices)
        for (const c of inv.items)
            if (c.item.tracking_mode === 'serial') serialLines.push({ inv, c });
    if (!serialLines.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal active';
    let inner = '';
    for (let li = 0; li < serialLines.length; li++) {
        const { c } = serialLines[li];
        let opts = [];
        try {
            // /inventory/serials returns a { items, ... } page envelope; tolerate both shapes. A bare
            // .map() here threw into the swallowing catch below, which left the picker silently EMPTY —
            // the cashier could not assign a serial at all, with no error to explain why.
            const res = await api.request(AccountsCommon.buildUrl('inventory/serials', { itemId: c.item.id, status: 'in_stock', limit: 200 }), { _skipSpinner: true });
            opts = (Array.isArray(res) ? res : (res?.items || [])).map(s => s.serial_no);
        } catch { }
        for (let u = 0; u < c.qty; u++) {
            inner += `<div class="form-group"><label>${esc(c.item.name)} — unit ${u + 1}</label>
                <select class="form-control pos-serial" data-inv="${serialLines[li].inv.invId}">
                    <option value="">(skip — assign later)</option>
                    ${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
                </select></div>`;
        }
    }
    overlay.innerHTML = `<div class="modal-content" style="max-width:460px;">
        <div class="modal-header"><h3>Which serial numbers were sold?</h3></div>
        <div class="modal-body">${inner}</div>
        <div class="modal-footer">
            <button class="btn btn-outline" id="posSerialSkip">Skip</button>
            <button class="btn btn-primary" id="posSerialSave">Save</button>
        </div></div>`;
    document.body.appendChild(overlay);
    await new Promise(resolve => {
        overlay.querySelector('#posSerialSkip').onclick = () => { overlay.remove(); resolve(); };
        overlay.querySelector('#posSerialSave').onclick = async () => {
            const sels = overlay.querySelectorAll('.pos-serial');
            let anyFailed = false, anyOk = false;
            for (const sel of sels) {
                if (!sel.value) continue;
                try {
                    await api.request(AccountsCommon.buildUrl(`inventory/serials/${encodeURIComponent(sel.value)}/sell`), {
                        method: 'POST',
                        body: JSON.stringify({ invoice_id: sel.dataset.inv, sold_date: soldDate }),
                        _skipSpinner: true
                    });
                    anyOk = true;
                } catch (err) { anyFailed = true; Toast.error(`${sel.value}: ${err.message}`); }
            }
            // Only claim success if nothing failed — a blanket green toast after
            // per-serial error toasts told the user every warranty started when
            // some (or all) did not.
            if (!anyFailed && anyOk) {
                Toast.success('Serials recorded — warranties started');
            } else if (anyFailed && anyOk) {
                Toast.error('Some serials could not be recorded — see errors above.');
            }
            overlay.remove(); resolve();
        };
    });
}

/** 80mm thermal receipt via the browser's print dialog. offline=true prints a
 *  provisional receipt (queued sale — real invoice number arrives at sync). */
async function printReceipt(invoiceNumber, total, offline = false, saleCart = null, billTo = null) {
    // Print from the SALE's frozen snapshot, never the live global cart — the 15s catalog
    // refresh / stock pushes can mutate cart mid-submission and the slip would show lines or
    // prices that were never charged.
    const printCart = saleCart || cart;
    let org = {};
    if (!offline) {
        try {
            const s = await api.request(AccountsCommon.buildUrl('settings'), { _skipSpinner: true });
            org = s?.data || s || {};
            try { localStorage.setItem('acct_org_profile', JSON.stringify({ org_legal_name: org.org_legal_name, org_address: org.org_address, org_gstin: org.org_gstin, org_drug_license1: org.org_drug_license1, org_drug_license2: org.org_drug_license2 })); } catch { }
        } catch { }
    } else {
        // Offline: use the org profile cached from the last successful load, if any.
        try { org = JSON.parse(localStorage.getItem('acct_org_profile') || '{}'); } catch { }
    }
    const w = window.open('', '_blank', 'width=380,height=600');
    if (!w) return;
    const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    let gross = 0, totDisc = 0;
    const netOf = c => { const g = r2(salePx(c) * c.qty); return g - r2(g * (c.disc || 0) / 100); };
    const rows = printCart.map(c => {
        const unit = salePx(c);
        const g = r2(unit * c.qty);
        const disc = r2(g * (c.disc || 0) / 100);
        const net = g - disc;
        gross += g; totDisc += disc;
        return `<tr><td>${esc(c.item.name)}<br><small>${c.qty}${c.uom ? ' ' + esc(c.uom) : ''} × ${unit.toFixed(2)}${disc > 0 ? ` (−${c.disc}%)` : ''}</small></td><td class="r">${net.toFixed(2)}</td></tr>`;
    }).join('');
    const tax = posGroupedTax(printCart, netOf);   // per-slab, so the receipt GST line foots to the booked total
    const sub = gross;   // MRP/list subtotal before discount
    w.document.write(`<!DOCTYPE html><html><head><title>${esc(invoiceNumber || 'Receipt')}</title><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Courier New',monospace; font-size:12px; width:72mm; padding:4mm; }
        .c { text-align:center; } .r { text-align:right; }
        table { width:100%; border-collapse:collapse; margin:6px 0; }
        td { padding:2px 0; vertical-align:top; }
        hr { border:none; border-top:1px dashed #000; margin:6px 0; }
        h2 { font-size:14px; } small { font-size:10px; }
    </style></head><body>
        <h2 class="c">${esc(org.org_legal_name || 'CASH RECEIPT')}</h2>
        ${org.org_address ? `<p class="c"><small>${esc(org.org_address)}</small></p>` : ''}
        ${org.org_gstin ? `<p class="c"><small>GSTIN: ${esc(org.org_gstin)}</small></p>` : ''}
        ${org.org_drug_license1 || org.org_drug_license2 ? `<p class="c"><small>D.L. No: ${esc([org.org_drug_license1, org.org_drug_license2].filter(Boolean).join(', '))}</small></p>` : ''}
        <hr>
        <p><small>${esc(invoiceNumber || '')} · ${new Date().toLocaleString('en-IN')}</small></p>
        ${offline ? '<p><small>Offline sale — tax invoice number will be assigned when the counter reconnects.</small></p>' : ''}
        ${billTo && billTo !== 'Walk-in Customer' ? `<p><small>Bill to: ${esc(billTo)}</small></p>` : ''}
        <hr>
        <table>${rows}</table>
        <hr>
        <table>
            <tr><td>Subtotal</td><td class="r">${sub.toFixed(2)}</td></tr>
            ${totDisc > 0 ? `<tr><td>Discount</td><td class="r">−${totDisc.toFixed(2)}</td></tr>` : ''}
            <tr><td>GST</td><td class="r">${tax.toFixed(2)}</td></tr>
            <tr><td><strong>TOTAL</strong></td><td class="r"><strong>₹${total.toFixed(2)}</strong></td></tr>
        </table>
        <hr>
        <p class="c">Thank you! Visit again.</p>
        <script>window.onload = () => window.print();<\/script>
    </body></html>`);
    w.document.close();
}

// ============================================================================
// SUBSTITUTES (pharma) — out-of-stock tap offers same-salt alternatives.
// ============================================================================

async function offerSubstitutes(item) {
    let subs = [];
    try { subs = await api.request(AccountsCommon.buildUrl(`inventory/items/${item.id}/substitutes`), { _skipSpinner: true }); }
    catch { subs = []; }
    const inStock = (subs || []).filter(s => Number(s.qty_on_hand) > 0);
    if (!inStock.length) {
        Toast.error(`'${item.name}' is out of stock — receive or adjust stock first.`);
        return;
    }
    const esc = AccountsCommon.escapeHtml;
    let m = document.getElementById('posSubsModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'posSubsModal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="max-width: 520px;">
                    <div class="modal-header">
                        <h5 class="modal-title" id="posSubsTitle">Substitutes</h5>
                        <button class="close-btn" onclick="AccountsCommon.closeModal('posSubsModal')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                    <div class="modal-body" id="posSubsBody"></div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="AccountsCommon.closeModal('posSubsModal')">Close</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);
    }
    document.getElementById('posSubsTitle').textContent = `'${item.name}' is out of stock — same-salt substitutes`;
    document.getElementById('posSubsBody').innerHTML = inStock.map(s => `
        <button type="button" class="btn btn-outline" style="display:flex;width:100%;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;text-align:left;"
            onclick="AccountsCommon.closeModal('posSubsModal'); addToCart('${s.item_id}');">
            <span style="min-width:0;">
                <strong>${esc(s.name)}</strong>${s.exact_composition ? ' <span class="status-badge status-active" style="font-size:.68rem;">same composition</span>' : ''}<br>
                <span style="font-size:.78rem;color:var(--text-secondary);">${esc((s.salts || []).map(x => x.salt_name + (x.strength ? ' ' + x.strength : '')).join(' + '))}</span>
            </span>
            <span style="text-align:right;white-space:nowrap;">
                ${AccountsCommon.formatCurrency(s.sale_price)}<br>
                <span style="font-size:.78rem;color:var(--color-success);">${Number(s.qty_on_hand)} ${esc(s.unit || '')} in stock</span>
            </span>
        </button>`).join('');
    AccountsCommon.openModal('posSubsModal');
}

// ── Quick-add at the counter ────────────────────────────────────────────────
//
// A shop whose stock is on paper cannot digitise eight thousand SKUs before its
// first sale. So an unknown scan must be recoverable AT THE TILL, in seconds —
// otherwise the teller, who cannot leave a queue, sells the item off-system and
// the stock figures drift from the shelf permanently.
//
// The form asks the shortest set of questions that still produces a CORRECT
// item: what it is, what it sells for, what tax it carries. Everything else has
// a default and can be corrected later from the Items screen. Creation goes
// through the ordinary item path server-side, so an item born here is exactly as
// valid as one typed in properly.

/** True for input that is plausibly a scanned barcode rather than a typed search. */
function looksLikeBarcode(s) { return /^\d{6,}$/.test((s || '').trim()); }

function posQuickAdd(code) {
    const barcode = (code || '').trim();
    document.getElementById('posQuickAddModal')?.remove();

    const slabs = (taxConfigs || [])
        .filter(t => (t.tax_type || 'GST') === 'GST' && t.is_active !== false)
        .map(t => `<option value="${AccountsCommon.escapeHtml(t.name)}">${AccountsCommon.escapeHtml(t.name)}</option>`)
        .join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal active';
    overlay.id = 'posQuickAddModal';
    overlay.innerHTML = `<div class="modal-content" style="max-width:460px;">
        <div class="modal-header">
            <h3>New item</h3>
            <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
        </div>
        <div class="modal-body">
            ${barcode ? `<div style="font-size:.78rem;color:var(--text-secondary);margin-bottom:.75rem;">
                Barcode <strong style="color:var(--text-primary);">${AccountsCommon.escapeHtml(barcode)}</strong> —
                not in your catalogue yet. Add it now and keep selling.</div>` : ''}
            <div class="form-group">
                <label>Item name</label>
                <input type="text" id="qaName" class="form-control" placeholder="e.g. Tata Salt 1kg" autocomplete="off">
            </div>
            <div style="display:flex;gap:.6rem;">
                <div class="form-group" style="flex:1;">
                    <label>Selling price</label>
                    <input type="number" id="qaPrice" class="form-control" step="0.01" min="0" inputmode="decimal">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>GST</label>
                    <select id="qaTax" class="form-control"><option value="">No tax</option>${slabs}</select>
                </div>
            </div>
            <div style="display:flex;gap:.6rem;">
                <div class="form-group" style="flex:1;">
                    <label>In stock now <span style="color:var(--text-secondary);font-weight:400;">(optional)</span></label>
                    <input type="number" id="qaQty" class="form-control" step="0.001" min="0" inputmode="decimal">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Cost each</label>
                    <input type="number" id="qaCost" class="form-control" step="0.01" min="0" inputmode="decimal">
                </div>
            </div>
            <p style="font-size:.74rem;color:var(--text-secondary);margin:0;">
                Leave the stock boxes blank if you are not sure — you can count it later.
                If you do enter a quantity, enter what it cost you, or it goes on the shelf worth nothing.
            </p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-outline" onclick="this.closest('.modal').remove()">Cancel</button>
            <button class="btn btn-primary" id="qaSave" onclick="saveQuickAdd()">Add &amp; sell</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.dataset.barcode = barcode;

    const name = document.getElementById('qaName');
    name.focus();

    // ⭐ Ask the shared catalogue what this barcode is — WITHOUT making the teller wait for it.
    //
    // The modal is already on screen and already focused, so a slow or failed lookup costs nothing:
    // worst case the form stays blank, which is exactly where it would have been anyway. Blocking the
    // form on a network call would make the common case (a national product somebody has already
    // named) FEEL slower than the rare one, which is the wrong way round at a queue.
    if (barcode) prefillFromCatalogue(barcode);
    // Enter anywhere in the form saves — at a queue, reaching for the mouse is the slow part.
    overlay.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); saveQuickAdd(); }
        if (e.key === 'Escape') overlay.remove();
    });
}

async function saveQuickAdd() {
    const overlay = document.getElementById('posQuickAddModal');
    if (!overlay) return;
    const val = id => document.getElementById(id)?.value?.trim() || '';
    const num = id => { const v = val(id); return v === '' ? null : Number(v); };

    const name = val('qaName');
    if (!name) { Toast.error('Give the item a name'); document.getElementById('qaName')?.focus(); return; }
    const price = num('qaPrice');
    if (price === null || isNaN(price) || price < 0) { Toast.error('Enter a selling price'); document.getElementById('qaPrice')?.focus(); return; }

    const btn = document.getElementById('qaSave');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    try {
        const created = await api.request(AccountsCommon.buildUrl('inventory/quick-item'), {
            method: 'POST',
            body: JSON.stringify({
                barcode: overlay.dataset.barcode || null,
                name, sale_price: price,
                tax_rate: val('qaTax') || null,
                opening_qty: num('qaQty'),
                purchase_price: num('qaCost')
            })
        });
        overlay.remove();
        // Refresh the catalogue so the new item exists client-side, THEN ring it up: addToCart works
        // off posItems, so adding before the refresh would silently do nothing.
        await refreshPosItems(true);
        addToCart(created.item_id, true);
        Toast.success(Number(created.qty_on_hand) > 0
            ? `${created.name} added`
            : `${created.name} added — stock will read negative until you count it`);
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Add & sell'; }
        Toast.error(err?.message || 'Could not add that item');
    }
}

/**
 * Fills the new-item form from the shared catalogue, if another shop has already named this barcode.
 *
 * Only ever fills fields the teller has NOT touched. A scan-then-type race is real — they can start
 * typing before the response lands — and overwriting someone mid-word is worse than not helping at
 * all. Every filled field stays editable: this is a suggestion with its provenance shown, not an
 * answer, and the shop can see its own shelf while we cannot.
 */
async function prefillFromCatalogue(barcode) {
    let res;
    try {
        res = await api.request(
            AccountsCommon.buildUrl(`inventory/catalogue/${encodeURIComponent(barcode)}`),
            { _skipSpinner: true });
    } catch { return; }   // fail-soft: a blank form is the status quo, not a regression

    const overlay = document.getElementById('posQuickAddModal');
    // The teller may have finished and closed the form while this was in flight.
    if (!overlay || overlay.dataset.barcode !== barcode || !res?.found || !res.entry) return;

    const e = res.entry;
    const nameEl = document.getElementById('qaName');
    const taxEl = document.getElementById('qaTax');
    let filled = false;

    if (nameEl && !nameEl.value.trim()) { nameEl.value = e.name; filled = true; }

    // The catalogue stores a RATE; this tenant has its own slabs. Match on the number in each option
    // rather than the label, because "GST 5%" and "5%" and "GST5" are all the same slab to a shopkeeper.
    if (taxEl && !taxEl.value && e.gst_rate != null) {
        const wanted = Number(e.gst_rate);
        const hit = [...taxEl.options].find(o => {
            const m = (o.value || '').match(/\d+(?:\.\d+)?/);
            return m && Number(m[0]) === wanted;
        });
        if (hit) { taxEl.value = hit.value; filled = true; }   // patched setter mirrors this to the visible control
    }

    if (!filled) return;

    // Say where it came from and how much to trust it. One shop reporting a name is a guess; several
    // agreeing is a fact, and the teller is the one who can see the packet.
    const confirmed = e.confirmations > 1
        ? `confirmed by ${e.confirmations} shops`
        : 'reported by one shop — worth a glance';
    const body = overlay.querySelector('.modal-body');
    if (body && !document.getElementById('qaFromCatalogue')) {
        const note = document.createElement('div');
        note.id = 'qaFromCatalogue';
        note.style.cssText = 'margin:-4px 0 12px;padding:8px 10px;border-radius:6px;'
            + 'background:var(--bg-tertiary);border:1px solid var(--color-success);'
            + 'font-size:.75rem;color:var(--text-secondary);';
        note.innerHTML = `Filled in from the shared catalogue — ${AccountsCommon.escapeHtml(confirmed)}. `
            + `Edit anything that looks wrong.`;
        body.insertBefore(note, body.firstChild);
    }

    // Everything we could know is known; the price is the one thing only this shop can say.
    const priceEl = document.getElementById('qaPrice');
    if (priceEl && !priceEl.value && document.activeElement === nameEl) priceEl.focus();
}
