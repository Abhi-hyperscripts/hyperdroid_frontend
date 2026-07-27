/**
 * Cash Sale (POS) — 30-second counter flow: pick items → total → payment → receipt.
 * Creates the invoice, approves it, and records the payment against the Walk-in
 * Customer in one motion. Stocked items get COGS/stock-out via item_id lines.
 */

let posItems = [], taxConfigs = [], bankAccounts = [], incomeAccounts = [];
let cart = [];   // {item, qty}
let posBankDD = null, posMethodDD = null;

const money = v => AccountsCommon.formatCurrency(v);
const esc = s => AccountsCommon.escapeHtml(s ?? '');

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('pos', '../')) return;
    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', { 'pos-counter': 'Counter' });
    AccountsCommon.setupTabs({ 'pos-counter': 'Counter' });
    accountsRoles.applyRBAC();
    const [itemsRes, taxRes, bankRes, coaRes] = await Promise.all([
        api.request(AccountsCommon.buildUrl('inventory/items'), { _skipSpinner: true }).catch(() => []),
        api.request(AccountsCommon.buildUrl('tax/configurations'), { _skipSpinner: true }).catch(() => []),
        api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => []),
        api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => [])
    ]);
    posItems = (Array.isArray(itemsRes) ? itemsRes : []).filter(i => i.is_active);
    taxConfigs = Array.isArray(taxRes) ? taxRes : (taxRes?.data || []);
    bankAccounts = (Array.isArray(bankRes) ? bankRes : []).filter(b => b.is_active !== false);
    incomeAccounts = AccountsCommon.postableAccounts(Array.isArray(coaRes) ? coaRes : (coaRes?.data || []), 'income');
    renderCategoryChips();
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
    connectStockHub();
    // Camera-scan button only where the native detector + a camera exist (Chrome/Android).
    if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia)
        document.getElementById('posCamBtn').style.display = '';
    const search = document.getElementById('posSearch');
    search.addEventListener('input', renderGrid);
    search.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = search.value.trim().toLowerCase();
            const sellable = i => !i.track_inventory || i.qty_on_hand > 0;
            const hit = posItems.find(i => (i.barcode || '').toLowerCase() === q)
                || posItems.find(i => i.sku.toLowerCase() === q)
                || filteredItems().find(sellable);
            if (hit) { addToCart(hit.id); search.value = ''; renderGrid(); }
        }
    });
});

/**
 * Multi-counter freshness: refetch the catalog (stock counts included), re-render,
 * and cap any cart line that another counter's sale has made unsellable.
 * Runs every 15s while the tab is visible, on tab focus, and after stock conflicts.
 */
async function refreshPosItems(silent = true) {
    try {
        const res = await api.request(AccountsCommon.buildUrl('inventory/items'), { _skipSpinner: true });
        posItems = (Array.isArray(res) ? res : []).filter(i => i.is_active);
        let capped = false;
        cart.forEach(line => {
            const fresh = posItems.find(i => i.id === line.item.id);
            if (!fresh) return;
            line.item = fresh;
            if (fresh.track_inventory && line.qty > fresh.qty_on_hand) {
                line.qty = Math.max(0, fresh.qty_on_hand);
                capped = true;
            }
        });
        cart = cart.filter(c => c.qty > 0);
        renderCategoryChips();
        renderGrid(true);
        renderCart();
        if (capped) Toast.error('Stock changed at another counter — cart quantities adjusted.');
    } catch { /* offline blip — next tick retries */ }
}

setInterval(() => { if (!document.hidden) refreshPosItems(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPosItems(); });

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
        const line = cart.find(c => c.item.id === u.id);
        if (line && line.item.track_inventory && line.qty > u.qty_on_hand) {
            line.qty = Math.max(0, u.qty_on_hand);
            capped = true;
        }
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
            else Toast.error(`No item with barcode '${code}'`);
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
                else Toast.error(`No item with barcode '${raw}'`);
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
            } else Toast.error(label);
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

/** Base (ex-GST) unit price: MRP-inclusive items back-compute; others are already ex-tax. */
function basePrice(i) {
    const rate = i.tax_config_id ? taxRateFor(i.tax_config_id) : 0;
    return i.price_includes_tax && rate > 0
        ? Math.round((i.sale_price / (1 + rate / 100)) * 100) / 100
        : i.sale_price;
}

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

function renderCategoryChips() {
    const host = document.getElementById('posCats');
    if (!host) return;
    const cats = [...new Set(posItems.map(i => i.category_name).filter(Boolean))].sort();
    if (!cats.length) { host.style.display = 'none'; return; }
    host.style.display = '';
    host.innerHTML = [`<button class="pos-chip ${!posCategory ? 'on' : ''}" onclick="setPosCategory('')">All</button>`]
        .concat(cats.map(c => `<button class="pos-chip ${posCategory === c ? 'on' : ''}" onclick="setPosCategory('${esc(c).replace(/'/g, '')}')">${esc(c)}</button>`))
        .join('');
}

function setPosCategory(c) { posCategory = c; renderCategoryChips(); renderGrid(); }

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
        <tbody>${rows.map((i, idx) => `
            <tr class="${idx === 0 ? 'first' : ''}${i.track_inventory && i.qty_on_hand <= 0 ? ' pos-oos' : ''}" onclick="addToCart('${i.id}')">
                <td class="nm">${esc(i.name)}</td>
                <td class="sku">${esc(i.sku)}</td>
                <td class="cat">${esc(i.category_name || '—')}</td>
                <td class="r pr">${money(i.sale_price)}</td>
                <td class="r ${i.track_inventory && i.qty_on_hand <= 0 ? 'out' : ''}">${i.track_inventory ? i.qty_on_hand : '—'}</td>
                <td class="r">${i.track_inventory && i.qty_on_hand <= 0 ? '<span class="pos-add off">✕</span>' : '<span class="pos-add">+</span>'}</td>
            </tr>`).join('')}
        </tbody></table></div>
        ${all.length > rows.length
            ? `<div class="pos-more" id="posMoreSentinel">Showing ${rows.length} of ${all.length} — scroll for more, type to narrow, or scan.</div>`
            : `<div class="pos-more">${all.length} item${all.length === 1 ? '' : 's'}</div>`}`;
    if (all.length > rows.length) armPosScroll();
}

function addToCart(itemId) {
    const it = posItems.find(x => x.id === itemId);
    if (!it) return;
    const line = cart.find(c => c.item.id === itemId);
    // Counter sales are physical goods in hand: never ring more than the shelf holds.
    // (The B2B invoice flow still allows advance-order oversell — that's deliberate.)
    if (it.track_inventory) {
        const inCart = line?.qty || 0;
        if (it.qty_on_hand <= 0) { Toast.error(`'${it.name}' is out of stock — receive or adjust stock first.`); return; }
        if (inCart + 1 > it.qty_on_hand) { Toast.error(`Only ${it.qty_on_hand} of '${it.name}' in stock.`); return; }
    }
    if (line) line.qty += 1; else cart.push({ item: it, qty: 1 });
    renderCart();
}

function setQty(itemId, qty) {
    const line = cart.find(c => c.item.id === itemId);
    if (!line) return;
    let capped = Math.max(0, qty);
    if (line.item.track_inventory && capped > line.item.qty_on_hand) {
        capped = line.item.qty_on_hand;
        Toast.error(`Only ${line.item.qty_on_hand} of '${line.item.name}' in stock.`);
    }
    line.qty = capped;
    if (!line.qty) cart = cart.filter(c => c !== line);
    renderCart();
}

function renderCart() {
    const tb = document.getElementById('posCart');
    tb.innerHTML = cart.length ? cart.map(c => `<tr>
        <td class="pos-line-name">${esc(c.item.name)}<div class="sub">${money(basePrice(c.item))} ex-GST</div></td>
        <td><span class="pos-qty">
            <button type="button" onclick="setQty('${c.item.id}', ${c.qty - 1})">−</button>
            <span>${c.qty}</span>
            <button type="button" onclick="setQty('${c.item.id}', ${c.qty + 1})">+</button>
        </span></td>
        <td style="text-align:right;font-weight:600;">${money(basePrice(c.item) * c.qty)}</td>
    </tr>`).join('') : '<tr><td class="pos-cart-empty">Cart is empty — tap items or scan a barcode.</td></tr>';
    let sub = 0, tax = 0, count = 0;
    cart.forEach(c => {
        const base = basePrice(c.item) * c.qty;
        sub += base; count += c.qty;
        tax += base * (c.item.tax_config_id ? taxRateFor(c.item.tax_config_id) : 0) / 100;
    });
    document.getElementById('posSub').textContent = money(sub);
    document.getElementById('posTax').textContent = money(tax);
    document.getElementById('posTotal').textContent = money(sub + tax);
    const countEl = document.getElementById('posCartCount');
    if (countEl) countEl.textContent = `${count} item${count === 1 ? '' : 's'}`;
    const btn = document.getElementById('posPayBtn');
    if (btn && !btn.disabled) btn.textContent = cart.length ? `Charge ${money(sub + tax)}` : 'Charge ₹0.00';
}

async function ensureWalkInCustomer() {
    const res = await api.request(AccountsCommon.buildUrl('customers', { limit: 200 }), { _skipSpinner: true });
    const list = Array.isArray(res) ? res : (res?.data || res?.items || []);
    const found = list.find(c => c.name === 'Walk-in Customer');
    if (found) return found.id;
    const created = await api.request(AccountsCommon.buildUrl('customers'), {
        method: 'POST',
        body: JSON.stringify({ name: 'Walk-in Customer', payment_terms_days: 0, gst_treatment: 'unregistered' })
    });
    return created.id || created?.data?.id;
}

async function completeSale() {
    if (!cart.length) { Toast.error('Cart is empty'); return; }
    const bankId = posBankDD?.getValue?.();
    if (!bankId) { Toast.error('Pick the account the money went into'); return; }
    if (!incomeAccounts.length) { Toast.error('No postable Income account found — set up your chart of accounts first.'); return; }
    const btn = document.getElementById('posPayBtn');
    btn.disabled = true; btn.textContent = 'Processing…';
    try {
        const customerId = await ensureWalkInCustomer();
        const today = AccountsCommon.todayLocal();
        // One tax config per invoice (backend rule) — a mixed-slab cart auto-splits into one
        // invoice per slab, settled together by a single payment with multiple allocations.
        const groups = new Map();
        cart.forEach(c => {
            const key = c.item.tax_config_id || '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(c);
        });
        const invoices = [];   // {invId, number, total, items:[cartLines]}
        for (const [, groupCart] of groups) {
            const lines = groupCart.map(c => ({
                item_id: c.item.id,
                description: c.item.name,
                hsn_sac: c.item.hsn_sac || '',
                quantity: c.qty,
                unit_price: basePrice(c.item),
                account_id: c.item.income_account_id || incomeAccounts[0].id,
                ...(c.item.tax_config_id ? { tax_config_id: c.item.tax_config_id } : {})
            }));
            const inv = await api.request(AccountsCommon.buildUrl('invoices'), {
                method: 'POST',
                body: JSON.stringify({ customer_id: customerId, invoice_date: today, due_date: today, notes: 'Cash sale (POS)', lines })
            });
            const invId = inv.id || inv?.data?.id;
            let approved;
            try {
                approved = await api.request(AccountsCommon.buildUrl(`invoices/${invId}/approve`, { enforceStock: true }), { method: 'POST' });
            } catch (err) {
                // Lost the race to another counter: remove the stray draft, resync, tell the teller.
                if ((err.message || '').includes('INSUFFICIENT_STOCK')) {
                    await api.request(AccountsCommon.buildUrl(`invoices/${invId}`), { method: 'DELETE', _skipSpinner: true }).catch(() => {});
                    await refreshPosItems();
                    throw new Error('Just sold out at another counter — stock refreshed, please re-check the cart.');
                }
                throw err;
            }
            invoices.push({
                invId,
                number: approved.invoice_number || approved?.data?.invoice_number,
                total: parseFloat(approved.total_amount ?? approved?.data?.total_amount),
                items: groupCart
            });
        }
        const total = Math.round(invoices.reduce((s, i) => s + i.total, 0) * 100) / 100;
        await api.request(AccountsCommon.buildUrl('invoices/payments'), {
            method: 'POST',
            body: JSON.stringify({
                customer_id: customerId, payment_date: today, amount: total, tds_amount: 0,
                bank_account_id: bankId, payment_method: posMethodDD?.getValue?.() || 'cash',
                reference_number: 'POS',
                allocations: invoices.map(i => ({ customer_invoice_id: i.invId, allocated_amount: i.total }))
            }),
            headers: { 'Idempotency-Key': 'pos-' + invoices[0].invId }
        });
        Toast.success(`Sale complete — ${money(total)}`);
        await printReceipt(invoices.map(i => i.number).join(' · '), total);
        await promptSerials(invoices, today);
        cart = [];
        renderCart();
        // refresh stock counts on the grid
        posItems = (await api.request(AccountsCommon.buildUrl('inventory/items'), { _skipSpinner: true })).filter(i => i.is_active);
        renderCategoryChips();
        renderGrid();
    } catch (err) {
        console.error('[POS] completeSale', err);
        Toast.error(err.message || 'Sale failed — check Receivables for a stranded draft/approved invoice.');
    } finally {
        btn.disabled = false; renderCart();
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
            const free = await api.request(AccountsCommon.buildUrl('inventory/serials', { itemId: c.item.id, status: 'in_stock', limit: 200 }), { _skipSpinner: true });
            opts = free.map(s => s.serial_no);
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
            for (const sel of sels) {
                if (!sel.value) continue;
                try {
                    await api.request(AccountsCommon.buildUrl(`inventory/serials/${encodeURIComponent(sel.value)}/sell`), {
                        method: 'POST',
                        body: JSON.stringify({ invoice_id: sel.dataset.inv, sold_date: soldDate }),
                        _skipSpinner: true
                    });
                } catch (err) { Toast.error(`${sel.value}: ${err.message}`); }
            }
            Toast.success('Serials recorded — warranties started');
            overlay.remove(); resolve();
        };
    });
}

/** 80mm thermal receipt via the browser's print dialog. */
async function printReceipt(invoiceNumber, total) {
    let org = {};
    try { const s = await api.request(AccountsCommon.buildUrl('settings'), { _skipSpinner: true }); org = s?.data || s || {}; } catch { }
    const w = window.open('', '_blank', 'width=380,height=600');
    if (!w) return;
    const rows = cart.map(c => {
        const base = basePrice(c.item);
        return `<tr><td>${esc(c.item.name)}<br><small>${c.qty} × ${base.toFixed(2)}</small></td><td class="r">${(base * c.qty).toFixed(2)}</td></tr>`;
    }).join('');
    let sub = 0, tax = 0;
    cart.forEach(c => { const b = basePrice(c.item) * c.qty; sub += b; tax += b * (c.item.tax_config_id ? taxRateFor(c.item.tax_config_id) : 0) / 100; });
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
        <hr>
        <p><small>${esc(invoiceNumber || '')} · ${new Date().toLocaleString('en-IN')}</small></p>
        <hr>
        <table>${rows}</table>
        <hr>
        <table>
            <tr><td>Subtotal</td><td class="r">${sub.toFixed(2)}</td></tr>
            <tr><td>GST</td><td class="r">${tax.toFixed(2)}</td></tr>
            <tr><td><strong>TOTAL</strong></td><td class="r"><strong>₹${total.toFixed(2)}</strong></td></tr>
        </table>
        <hr>
        <p class="c">Thank you! Visit again.</p>
        <script>window.onload = () => window.print();<\/script>
    </body></html>`);
    w.document.close();
}
