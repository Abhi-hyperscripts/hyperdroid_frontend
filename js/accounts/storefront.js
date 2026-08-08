/**
 * Storefront — admin control plane for the self-hosted online store (Ragenaizer Commerce).
 * Tabs: API Keys · Coupons · Discounts · BXGY · Gift Cards. Backend: /api/accounts/{storefront-keys,
 * coupons, automatic-discounts, bxgy, gift-cards}. Create/generate/revoke = ADMIN. Frontend-only; no backend change.
 */

const esc = (t) => AccountsCommon.escapeHtml(t);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
// For DATE-ONLY validity fields (starts/expires) stored as a UTC instant on the picked calendar date —
// render in UTC so a +05:30 viewer doesn't see "31 Dec" shift to "01 Jan". Audit timestamps keep fmtDate.
const fmtDateUTC = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

/* The starts/expires columns are `timestamptz` — the API rejects a bare "YYYY-MM-DD" (binds as
 * DateTimeKind.Unspecified). Send a UTC-designated instant instead. An expiry date must stay valid
 * *through* that whole day, so it maps to 23:59:59Z; a start date maps to 00:00:00Z. Because the
 * instant lands on the same UTC calendar date the merchant picked, dateOnly() round-trips it back. */
function toUtcInstant(dateStr, endOfDay) {
    const s = (dateStr || '').trim();
    if (!s) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${endOfDay ? '23:59:59' : '00:00:00'}Z` : s;
}
// Display side: take the UTC calendar date only, so flatpickr never shifts it a day in a +05:30 tz.
const dateOnly = (v) => v ? String(v).slice(0, 10) : '';

document.addEventListener('DOMContentLoaded', async () => {
    if (!await AccountsCommon.initPage('storefront', '../')) return;

    const tabNames = { 'sf-keys': 'API Keys', 'sf-coupons': 'Coupons', 'sf-discounts': 'Discounts', 'sf-bxgy': 'BXGY', 'sf-giftcards': 'Gift Cards' };
    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, (tab) => {
        // Lazy-load each tab's data the first time it's opened (built incrementally).
        if (tab === 'sf-keys' && !loadedTabs.keys) { loadedTabs.keys = true; loadKeys(); }
        if (tab === 'sf-coupons' && !loadedTabs.coupons) { loadedTabs.coupons = true; loadCoupons(); }
        if (tab === 'sf-discounts' && !loadedTabs.discounts) { loadedTabs.discounts = true; loadDiscounts(); }
        if (tab === 'sf-bxgy' && !loadedTabs.bxgy) { loadedTabs.bxgy = true; loadBxgy(); }
        if (tab === 'sf-giftcards' && !loadedTabs.gift) { loadedTabs.gift = true; loadGift(); }
    });

    accountsRoles.applyRBAC();
    await loadKeys(); loadedTabs.keys = true;
});

const loadedTabs = {};

/* ── API Keys ─────────────────────────────────────────────────────────────────────────────────────── */

async function loadKeys() {
    try {
        AccountsCommon.setTableLoading('sfKeysTable', 6, 'Loading keys…');
        const res = await api.request(AccountsCommon.buildUrl('storefront-keys'), { _skipSpinner: true });
        renderKeys(Array.isArray(res) ? res : (res?.data || []));
    } catch (err) {
        console.error('[Storefront] loadKeys error:', err);
        const tb = document.getElementById('sfKeysTable');
        if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load keys</td></tr>';
    }
}

function renderKeys(keys) {
    const tb = document.getElementById('sfKeysTable');
    if (!tb) return;
    if (!keys.length) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-secondary);">No storefront keys yet. Click "Generate storefront key" to create one.</td></tr>';
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    tb.innerHTML = keys.map(k => {
        const active = k.is_active !== false;
        const badge = active
            ? '<span class="status-badge" style="background:var(--color-success-bg,rgba(34,197,94,.15));color:var(--color-success,#16a34a);">Active</span>'
            : '<span class="status-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);">Revoked</span>';
        const revoke = (isAdmin && active)
            ? `<button class="btn btn-outline btn-sm" onclick="revokeKey('${esc(k.id)}','${esc(k.key_prefix)}')">Revoke</button>`
            : '<span style="color:var(--text-muted);">—</span>';
        return `<tr>
            <td class="mono" style="font-family:monospace;">${esc(k.key_prefix)}…</td>
            <td>${esc(k.label) || '<span style="color:var(--text-muted);">—</span>'}</td>
            <td>${badge}</td>
            <td>${fmtDate(k.last_used_at)}</td>
            <td>${fmtDate(k.created_at)}</td>
            <td>${revoke}</td>
        </tr>`;
    }).join('');
}

async function mintKey() {
    const label = await AccountsCommon.reasonPrompt({
        title: 'Generate storefront key',
        message: 'Give this key a label so you can recognise it later (optional).',
        confirmText: 'Generate',
        placeholder: 'e.g. Production store',
        required: false, danger: false
    });
    if (label === null) return;   // cancelled
    try {
        const res = await api.request(AccountsCommon.buildUrl('storefront-keys'), {
            method: 'POST', body: JSON.stringify({ label: (label || '').trim() || null })
        });
        if (res?.key) revealKey(res.key, res.key_prefix);
        Toast.success('Storefront key generated');
        await loadKeys();
    } catch (err) {
        console.error('[Storefront] mintKey error:', err);
        Toast.error(err?.message || 'Could not generate the key');
    }
}

// Show the plaintext key ONCE, with a copy button and a clear warning that it won't be shown again.
function revealKey(key, prefix) {
    const box = document.getElementById('sfKeyReveal');
    if (!box) return;
    box.style.display = 'block';
    box.innerHTML = `
        <div class="glass-card" style="padding:1rem 1.25rem;border:1px solid var(--color-warning,#eab308);">
            <div style="font-weight:700;margin-bottom:.4rem;color:var(--color-warning,#eab308);">Copy your key now — it won't be shown again</div>
            <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
                <code id="sfNewKey" style="font-family:monospace;background:var(--bg-tertiary);padding:.5rem .75rem;border-radius:6px;word-break:break-all;flex:1;min-width:220px;">${esc(key)}</code>
                <button class="btn btn-primary btn-sm" onclick="copyKey()">Copy</button>
                <button class="btn btn-outline btn-sm" onclick="document.getElementById('sfKeyReveal').style.display='none'">Done</button>
            </div>
            <div style="margin-top:.5rem;font-size:.82rem;color:var(--text-secondary);">Paste this into your storefront's <em>Connect</em> screen (Storefront API key). Prefix <code>${esc(prefix)}</code> is all that's stored here.</div>
        </div>`;
}

function copyKey() {
    const el = document.getElementById('sfNewKey');
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(
        () => Toast.success('Key copied to clipboard'),
        () => Toast.error('Could not copy — select and copy manually')
    );
}

async function revokeKey(id, prefix) {
    const ok = await AccountsCommon.reasonPrompt({
        title: 'Revoke storefront key',
        message: `Revoke key ${prefix}…? Any store using it will immediately stop working until you connect a new key.`,
        confirmText: 'Revoke', required: false, danger: true
    });
    if (ok === null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`storefront-keys/${id}`), { method: 'DELETE' });
        Toast.success('Key revoked');
        await loadKeys();
    } catch (err) {
        console.error('[Storefront] revokeKey error:', err);
        Toast.error(err?.message || 'Could not revoke the key');
    }
}

/* ── Coupons ──────────────────────────────────────────────────────────────────────────────────────── */
// Reads tolerate either snake_case (the read DTO) or camelCase; writes send camelCase (the Upsert record).
let couponTypeDD = null;
let couponsCache = [];
const pick = (o, a, b) => (o?.[a] ?? o?.[b]);
const inr = (v) => '₹' + (+v || 0).toLocaleString('en-IN');

async function loadCoupons() {
    try {
        AccountsCommon.setTableLoading('sfCouponsTable', 7, 'Loading coupons…');
        const res = await api.request(AccountsCommon.buildUrl('coupons'), { _skipSpinner: true });
        couponsCache = Array.isArray(res) ? res : (res?.data || []);
        renderCoupons();
    } catch (err) {
        console.error('[Storefront] loadCoupons error:', err);
        const tb = document.getElementById('sfCouponsTable');
        if (tb) tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load coupons</td></tr>';
    }
}

function validityText(s, e) {
    const f = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    if (s && e) return `${f(s)} – ${f(e)}`;
    if (e) return `until ${f(e)}`;
    if (s) return `from ${f(s)}`;
    return 'Always';
}

function renderCoupons() {
    const tb = document.getElementById('sfCouponsTable');
    if (!tb) return;
    if (!couponsCache.length) {
        tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-secondary);">No coupons yet. Click "New coupon" to create one.</td></tr>';
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    tb.innerHTML = couponsCache.map(c => {
        const flat = pick(c, 'discount_type', 'discountType') === 'flat';
        const val = c.value ?? 0;
        const cap = pick(c, 'max_discount', 'maxDiscount');
        const disc = (flat ? inr(val) : `${val}%`) + (!flat && cap ? ` (max ${inr(cap)})` : '');
        const used = pick(c, 'times_used', 'timesUsed') ?? 0;
        const lim = pick(c, 'usage_limit', 'usageLimit');
        const active = pick(c, 'is_active', 'isActive') !== false;
        const badge = active
            ? '<span class="status-badge" style="background:rgba(34,197,94,.15);color:#16a34a;">Active</span>'
            : '<span class="status-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);">Inactive</span>';
        const actions = isAdmin
            ? `<button class="btn btn-outline btn-sm" onclick='openCoupon("${esc(c.id)}")'>Edit</button> <button class="btn btn-outline btn-sm" onclick='deleteCoupon("${esc(c.id)}","${esc(c.code)}")'>Delete</button>`
            : '<span style="color:var(--text-muted);">—</span>';
        return `<tr>
            <td style="font-family:monospace;font-weight:600;">${esc(c.code)}</td>
            <td>${disc}</td>
            <td>${inr(pick(c, 'min_order', 'minOrder') ?? 0)}</td>
            <td>${lim ? `${used}/${lim}` : used}</td>
            <td>${validityText(pick(c, 'starts_at', 'startsAt'), pick(c, 'expires_at', 'expiresAt'))}</td>
            <td>${badge}</td>
            <td>${actions}</td>
        </tr>`;
    }).join('');
}

function openCoupon(id) {
    const c = id ? couponsCache.find(x => x.id === id) : null;
    document.getElementById('couponModalTitle').textContent = c ? `Edit ${c.code}` : 'New coupon';
    document.getElementById('cpId').value = c?.id || '';
    document.getElementById('cpCode').value = c?.code || '';
    document.getElementById('cpValue').value = c?.value ?? '';
    document.getElementById('cpMaxDisc').value = pick(c, 'max_discount', 'maxDiscount') ?? '';
    document.getElementById('cpMinOrder').value = pick(c, 'min_order', 'minOrder') ?? 0;
    document.getElementById('cpUsageLimit').value = pick(c, 'usage_limit', 'usageLimit') ?? '';
    document.getElementById('cpPerCust').value = pick(c, 'per_customer_limit', 'perCustomerLimit') ?? '';
    document.getElementById('cpActive').checked = pick(c, 'is_active', 'isActive') !== false;
    document.getElementById('cpType').innerHTML = '';
    couponTypeDD = new SearchableDropdown(document.getElementById('cpType'), {
        id: 'cpTypeDD', compact: true,
        options: [{ value: 'percent', label: 'Percent (%)' }, { value: 'flat', label: 'Flat (₹)' }],
        value: pick(c, 'discount_type', 'discountType') || 'percent'
    });
    AccountsCommon.openModal('couponModal');
    AccountsCommon.initDatePickers(['cpStarts', 'cpExpires']);
    AccountsCommon.setDateField('cpStarts', dateOnly(pick(c, 'starts_at', 'startsAt')));
    AccountsCommon.setDateField('cpExpires', dateOnly(pick(c, 'expires_at', 'expiresAt')));
}

async function saveCoupon() {
    const code = document.getElementById('cpCode').value.trim().toUpperCase();
    const value = parseFloat(document.getElementById('cpValue').value);
    if (!code) { Toast.error('A coupon code is required'); return; }
    if (!(value >= 0)) { Toast.error('Enter a discount value'); return; }
    const num = (id) => { const v = document.getElementById(id).value.trim(); return v === '' ? null : parseFloat(v); };
    const int = (id) => { const v = document.getElementById(id).value.trim(); return v === '' ? null : parseInt(v); };
    const body = {
        code,
        discountType: couponTypeDD?.getValue?.() || 'percent',
        value,
        maxDiscount: num('cpMaxDisc'),
        minOrder: num('cpMinOrder') ?? 0,
        startsAt: toUtcInstant(document.getElementById('cpStarts').value, false),
        expiresAt: toUtcInstant(document.getElementById('cpExpires').value, true),
        usageLimit: int('cpUsageLimit'),
        perCustomerLimit: int('cpPerCust'),
        isActive: document.getElementById('cpActive').checked
    };
    const id = document.getElementById('cpId').value;
    const btn = document.getElementById('cpSaveBtn'); btn.disabled = true;
    try {
        if (id) await api.request(AccountsCommon.buildUrl(`coupons/${id}`), { method: 'PUT', body: JSON.stringify(body) });
        else await api.request(AccountsCommon.buildUrl('coupons'), { method: 'POST', body: JSON.stringify(body) });
        Toast.success(id ? 'Coupon updated' : 'Coupon created');
        AccountsCommon.closeModal('couponModal');
        await loadCoupons();
    } catch (err) {
        console.error('[Storefront] saveCoupon error:', err);
        Toast.error(err?.message || 'Could not save the coupon');
    } finally { btn.disabled = false; }
}

async function deleteCoupon(id, code) {
    const ok = await AccountsCommon.reasonPrompt({ title: 'Delete coupon', message: `Delete coupon ${code}? Shoppers will no longer be able to use it.`, confirmText: 'Delete', required: false, danger: true });
    if (ok === null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`coupons/${id}`), { method: 'DELETE' });
        Toast.success('Coupon deleted');
        await loadCoupons();
    } catch (err) {
        console.error('[Storefront] deleteCoupon error:', err);
        Toast.error(err?.message || 'Could not delete the coupon');
    }
}

/* ── Automatic discounts ──────────────────────────────────────────────────────────────────────────── */
let discountTypeDD = null;
let discountsCache = [];

async function loadDiscounts() {
    try {
        AccountsCommon.setTableLoading('sfDiscountsTable', 8, 'Loading discounts…');
        const res = await api.request(AccountsCommon.buildUrl('automatic-discounts'), { _skipSpinner: true });
        discountsCache = Array.isArray(res) ? res : (res?.data || []);
        renderDiscounts();
    } catch (err) {
        console.error('[Storefront] loadDiscounts error:', err);
        const tb = document.getElementById('sfDiscountsTable');
        if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load discounts</td></tr>';
    }
}

function renderDiscounts() {
    const tb = document.getElementById('sfDiscountsTable');
    if (!tb) return;
    if (!discountsCache.length) {
        tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-secondary);">No automatic discounts yet.</td></tr>';
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    tb.innerHTML = discountsCache.map(d => {
        const flat = pick(d, 'discount_type', 'discountType') === 'flat';
        const val = d.value ?? 0;
        const cap = pick(d, 'max_discount', 'maxDiscount');
        const disc = (flat ? inr(val) : `${val}%`) + (!flat && cap ? ` (max ${inr(cap)})` : '');
        const seg = pick(d, 'customer_tag', 'customerTag');
        const freeShip = pick(d, 'free_shipping', 'freeShipping') ? '✓' : '<span style="color:var(--text-muted);">—</span>';
        const active = pick(d, 'is_active', 'isActive') !== false;
        const badge = active
            ? '<span class="status-badge" style="background:rgba(34,197,94,.15);color:#16a34a;">Active</span>'
            : '<span class="status-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);">Inactive</span>';
        const actions = isAdmin
            ? `<button class="btn btn-outline btn-sm" onclick='openDiscount("${esc(d.id)}")'>Edit</button> <button class="btn btn-outline btn-sm" onclick='deleteDiscount("${esc(d.id)}","${esc(d.title)}")'>Delete</button>`
            : '<span style="color:var(--text-muted);">—</span>';
        return `<tr>
            <td style="font-weight:600;">${esc(d.title)}</td>
            <td>${disc}</td>
            <td>${inr(pick(d, 'min_order', 'minOrder') ?? 0)}</td>
            <td>${seg ? esc(seg) : '<span style="color:var(--text-muted);">Everyone</span>'}</td>
            <td>${freeShip}</td>
            <td>${d.priority ?? 0}</td>
            <td>${badge}</td>
            <td>${actions}</td>
        </tr>`;
    }).join('');
}

function openDiscount(id) {
    const d = id ? discountsCache.find(x => x.id === id) : null;
    document.getElementById('discountModalTitle').textContent = d ? `Edit ${d.title}` : 'New automatic discount';
    document.getElementById('dsId').value = d?.id || '';
    document.getElementById('dsTitle').value = d?.title || '';
    document.getElementById('dsValue').value = d?.value ?? '';
    document.getElementById('dsMaxDisc').value = pick(d, 'max_discount', 'maxDiscount') ?? '';
    document.getElementById('dsMinOrder').value = pick(d, 'min_order', 'minOrder') ?? 0;
    document.getElementById('dsCustomerTag').value = pick(d, 'customer_tag', 'customerTag') || '';
    document.getElementById('dsPriority').value = d?.priority ?? 0;
    document.getElementById('dsFreeShip').checked = pick(d, 'free_shipping', 'freeShipping') === true;
    document.getElementById('dsActive').checked = pick(d, 'is_active', 'isActive') !== false;
    document.getElementById('dsType').innerHTML = '';
    discountTypeDD = new SearchableDropdown(document.getElementById('dsType'), {
        id: 'dsTypeDD', compact: true,
        options: [{ value: 'percent', label: 'Percent (%)' }, { value: 'flat', label: 'Flat (₹)' }],
        value: pick(d, 'discount_type', 'discountType') || 'percent'
    });
    AccountsCommon.openModal('discountModal');
    AccountsCommon.initDatePickers(['dsStarts', 'dsExpires']);
    AccountsCommon.setDateField('dsStarts', dateOnly(pick(d, 'starts_at', 'startsAt')));
    AccountsCommon.setDateField('dsExpires', dateOnly(pick(d, 'expires_at', 'expiresAt')));
}

async function saveDiscount() {
    const title = document.getElementById('dsTitle').value.trim();
    const value = parseFloat(document.getElementById('dsValue').value);
    if (!title) { Toast.error('A title is required'); return; }
    if (!(value >= 0)) { Toast.error('Enter a discount value'); return; }
    const num = (id) => { const v = document.getElementById(id).value.trim(); return v === '' ? null : parseFloat(v); };
    const body = {
        title,
        discountType: discountTypeDD?.getValue?.() || 'percent',
        value,
        maxDiscount: num('dsMaxDisc'),
        minOrder: num('dsMinOrder') ?? 0,
        customerTag: document.getElementById('dsCustomerTag').value.trim() || null,
        startsAt: toUtcInstant(document.getElementById('dsStarts').value, false),
        expiresAt: toUtcInstant(document.getElementById('dsExpires').value, true),
        priority: parseInt(document.getElementById('dsPriority').value) || 0,
        isActive: document.getElementById('dsActive').checked,
        freeShipping: document.getElementById('dsFreeShip').checked
    };
    const id = document.getElementById('dsId').value;
    const btn = document.getElementById('dsSaveBtn'); btn.disabled = true;
    try {
        if (id) await api.request(AccountsCommon.buildUrl(`automatic-discounts/${id}`), { method: 'PUT', body: JSON.stringify(body) });
        else await api.request(AccountsCommon.buildUrl('automatic-discounts'), { method: 'POST', body: JSON.stringify(body) });
        Toast.success(id ? 'Discount updated' : 'Discount created');
        AccountsCommon.closeModal('discountModal');
        await loadDiscounts();
    } catch (err) {
        console.error('[Storefront] saveDiscount error:', err);
        Toast.error(err?.message || 'Could not save the discount');
    } finally { btn.disabled = false; }
}

async function deleteDiscount(id, title) {
    const ok = await AccountsCommon.reasonPrompt({ title: 'Delete discount', message: `Delete "${title}"? It will stop applying at checkout.`, confirmText: 'Delete', required: false, danger: true });
    if (ok === null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`automatic-discounts/${id}`), { method: 'DELETE' });
        Toast.success('Discount deleted');
        await loadDiscounts();
    } catch (err) {
        console.error('[Storefront] deleteDiscount error:', err);
        Toast.error(err?.message || 'Could not delete the discount');
    }
}

/* ── BXGY ─────────────────────────────────────────────────────────────────────────────────────────── */
let bxgyCache = [];
let bxItemsCache = [];        // sellable catalog items, for the picker + id→name lookup
let bxItemDD = null;

async function loadBxgyItems() {
    if (bxItemsCache.length) return bxItemsCache;
    try {
        const res = await api.request(AccountsCommon.buildUrl('inventory/items'), { _skipSpinner: true });
        const list = Array.isArray(res) ? res : (res?.data || []);
        bxItemsCache = list.filter(i => i.is_sellable !== false);
    } catch (err) { console.error('[Storefront] loadBxgyItems error:', err); bxItemsCache = []; }
    return bxItemsCache;
}

async function loadBxgy() {
    try {
        AccountsCommon.setTableLoading('sfBxgyTable', 7, 'Loading offers…');
        await loadBxgyItems();
        const res = await api.request(AccountsCommon.buildUrl('bxgy'), { _skipSpinner: true });
        bxgyCache = Array.isArray(res) ? res : (res?.data || []);
        renderBxgy();
    } catch (err) {
        console.error('[Storefront] loadBxgy error:', err);
        const tb = document.getElementById('sfBxgyTable');
        if (tb) tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load offers</td></tr>';
    }
}

function bxItemName(id) {
    const it = bxItemsCache.find(x => x.id === id);
    return it ? `${it.sku} — ${it.name}` : id;
}

function renderBxgy() {
    const tb = document.getElementById('sfBxgyTable');
    if (!tb) return;
    if (!bxgyCache.length) {
        tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-secondary);">No BXGY offers yet.</td></tr>';
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    tb.innerHTML = bxgyCache.map(b => {
        const active = pick(b, 'is_active', 'isActive') !== false;
        const badge = active
            ? '<span class="status-badge" style="background:rgba(34,197,94,.15);color:#16a34a;">Active</span>'
            : '<span class="status-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);">Inactive</span>';
        const actions = isAdmin
            ? `<button class="btn btn-outline btn-sm" onclick='openBxgy("${esc(b.id)}")'>Edit</button> <button class="btn btn-outline btn-sm" onclick='deleteBxgy("${esc(b.id)}","${esc(b.title)}")'>Delete</button>`
            : '<span style="color:var(--text-muted);">—</span>';
        return `<tr>
            <td style="font-weight:600;">${esc(b.title)}</td>
            <td>${esc(bxItemName(pick(b, 'item_id', 'itemId')))}</td>
            <td>Buy ${pick(b, 'buy_qty', 'buyQty')} / Get ${pick(b, 'get_qty', 'getQty')}</td>
            <td>${pick(b, 'get_discount_percent', 'getDiscountPercent')}%</td>
            <td>${b.priority ?? 0}</td>
            <td>${badge}</td>
            <td>${actions}</td>
        </tr>`;
    }).join('');
}

async function openBxgy(id) {
    await loadBxgyItems();
    const b = id ? bxgyCache.find(x => x.id === id) : null;
    document.getElementById('bxgyModalTitle').textContent = b ? `Edit ${b.title}` : 'New BXGY offer';
    document.getElementById('bxId').value = b?.id || '';
    document.getElementById('bxTitle').value = b?.title || '';
    document.getElementById('bxBuy').value = pick(b, 'buy_qty', 'buyQty') ?? 2;
    document.getElementById('bxGet').value = pick(b, 'get_qty', 'getQty') ?? 1;
    document.getElementById('bxDisc').value = pick(b, 'get_discount_percent', 'getDiscountPercent') ?? 100;
    document.getElementById('bxPriority').value = b?.priority ?? 0;
    document.getElementById('bxActive').checked = pick(b, 'is_active', 'isActive') !== false;
    document.getElementById('bxItem').innerHTML = '';
    bxItemDD = new SearchableDropdown(document.getElementById('bxItem'), {
        id: 'bxItemDD', compact: true, placeholder: 'Search item…',
        options: bxItemsCache.map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` })),
        value: pick(b, 'item_id', 'itemId') || ''
    });
    AccountsCommon.openModal('bxgyModal');
    AccountsCommon.initDatePickers(['bxStarts', 'bxExpires']);
    AccountsCommon.setDateField('bxStarts', dateOnly(pick(b, 'starts_at', 'startsAt')));
    AccountsCommon.setDateField('bxExpires', dateOnly(pick(b, 'expires_at', 'expiresAt')));
}

async function saveBxgy() {
    const title = document.getElementById('bxTitle').value.trim();
    const itemId = bxItemDD?.getValue?.();
    if (!title) { Toast.error('A title is required'); return; }
    if (!itemId) { Toast.error('Pick an item'); return; }
    const body = {
        title, itemId,
        buyQty: parseInt(document.getElementById('bxBuy').value) || 0,
        getQty: parseInt(document.getElementById('bxGet').value) || 0,
        getDiscountPercent: parseFloat(document.getElementById('bxDisc').value) || 0,
        startsAt: toUtcInstant(document.getElementById('bxStarts').value, false),
        expiresAt: toUtcInstant(document.getElementById('bxExpires').value, true),
        priority: parseInt(document.getElementById('bxPriority').value) || 0,
        isActive: document.getElementById('bxActive').checked
    };
    if (body.buyQty < 1 || body.getQty < 1) { Toast.error('Buy and Get quantities must be at least 1'); return; }
    const id = document.getElementById('bxId').value;
    const btn = document.getElementById('bxSaveBtn'); btn.disabled = true;
    try {
        if (id) await api.request(AccountsCommon.buildUrl(`bxgy/${id}`), { method: 'PUT', body: JSON.stringify(body) });
        else await api.request(AccountsCommon.buildUrl('bxgy'), { method: 'POST', body: JSON.stringify(body) });
        Toast.success(id ? 'Offer updated' : 'Offer created');
        AccountsCommon.closeModal('bxgyModal');
        await loadBxgy();
    } catch (err) {
        console.error('[Storefront] saveBxgy error:', err);
        Toast.error(err?.message || 'Could not save the offer');
    } finally { btn.disabled = false; }
}

async function deleteBxgy(id, title) {
    const ok = await AccountsCommon.reasonPrompt({ title: 'Delete BXGY offer', message: `Delete "${title}"?`, confirmText: 'Delete', required: false, danger: true });
    if (ok === null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`bxgy/${id}`), { method: 'DELETE' });
        Toast.success('Offer deleted');
        await loadBxgy();
    } catch (err) {
        console.error('[Storefront] deleteBxgy error:', err);
        Toast.error(err?.message || 'Could not delete the offer');
    }
}

/* ── Gift cards ───────────────────────────────────────────────────────────────────────────────────── */
let giftCache = [];

async function loadGift() {
    try {
        AccountsCommon.setTableLoading('sfGiftTable', 6, 'Loading gift cards…');
        const res = await api.request(AccountsCommon.buildUrl('gift-cards'), { _skipSpinner: true });
        giftCache = Array.isArray(res) ? res : (res?.data || []);
        renderGift();
    } catch (err) {
        console.error('[Storefront] loadGift error:', err);
        const tb = document.getElementById('sfGiftTable');
        if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load gift cards</td></tr>';
    }
}

function renderGift() {
    const tb = document.getElementById('sfGiftTable');
    if (!tb) return;
    if (!giftCache.length) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-secondary);">No gift cards yet. Click "Issue gift card" to create one.</td></tr>';
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    tb.innerHTML = giftCache.map(g => {
        const active = pick(g, 'is_active', 'isActive') !== false && (g.status ? g.status !== 'disabled' : true);
        const badge = active
            ? '<span class="status-badge" style="background:rgba(34,197,94,.15);color:#16a34a;">Active</span>'
            : '<span class="status-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);">Disabled</span>';
        const actions = (isAdmin && active)
            ? `<button class="btn btn-outline btn-sm" onclick='disableGift("${esc(g.id)}","${esc(g.code)}")'>Disable</button>`
            : '<span style="color:var(--text-muted);">—</span>';
        return `<tr>
            <td style="font-family:monospace;font-weight:600;">${esc(g.code)}</td>
            <td>${inr(g.balance ?? 0)}</td>
            <td>${inr(pick(g, 'initial_balance', 'initialBalance') ?? 0)}</td>
            <td>${fmtDateUTC(pick(g, 'expires_at', 'expiresAt'))}</td>
            <td>${badge}</td>
            <td>${actions}</td>
        </tr>`;
    }).join('');
}

function openGift() {
    document.getElementById('gcAmount').value = '';
    document.getElementById('gcCode').value = '';
    document.getElementById('gcFunding').value = '';
    document.getElementById('gcNote').value = '';
    AccountsCommon.openModal('giftModal');
    AccountsCommon.initDatePickers(['gcExpires']);
    AccountsCommon.setDateField('gcExpires', '');
}

async function issueGift() {
    const amount = parseFloat(document.getElementById('gcAmount').value);
    if (!(amount > 0)) { Toast.error('Enter an amount greater than zero'); return; }
    const body = {
        amount,
        code: document.getElementById('gcCode').value.trim().toUpperCase() || null,
        expiresAt: toUtcInstant(document.getElementById('gcExpires').value, true),
        note: document.getElementById('gcNote').value.trim() || null,
        fundingAccountCode: document.getElementById('gcFunding').value.trim() || null
    };
    const btn = document.getElementById('gcSaveBtn'); btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('gift-cards'), { method: 'POST', body: JSON.stringify(body) });
        Toast.success('Gift card issued');
        AccountsCommon.closeModal('giftModal');
        await loadGift();
    } catch (err) {
        console.error('[Storefront] issueGift error:', err);
        Toast.error(err?.message || 'Could not issue the gift card');
    } finally { btn.disabled = false; }
}

async function disableGift(id, code) {
    const ok = await AccountsCommon.reasonPrompt({ title: 'Disable gift card', message: `Disable card ${code}? Its remaining balance can no longer be redeemed.`, confirmText: 'Disable', required: false, danger: true });
    if (ok === null) return;
    try {
        await api.request(AccountsCommon.buildUrl(`gift-cards/${id}/disable`), { method: 'POST' });
        Toast.success('Gift card disabled');
        await loadGift();
    } catch (err) {
        console.error('[Storefront] disableGift error:', err);
        Toast.error(err?.message || 'Could not disable the gift card');
    }
}
