/**
 * E-kart — the client-facing product inquiry portal.
 *
 * A rep issues a login (EK-… id + password) against a lead or contact in the CRM. The client signs
 * in here, browses the supplier's catalogue, builds a cart of item+quantity, and submits it as an
 * INQUIRY — it lands in the CRM as a deal the sales team prices. Nothing here is an order.
 *
 * Auth: POST /api/ekart/login → opaque token, sent as X-Ekart-Token. Tenant comes from the link
 * (?t=<tenantId>), same convention as the accounts client portal. Cart lives in sessionStorage per
 * tenant until submitted.
 */
(function () {
    'use strict';

    const TOKEN_HEADER = 'X-Ekart-Token';
    const params = new URLSearchParams(location.search);
    const TENANT_KEY = 'ek_tenant';
    const TOKEN_KEY = 'ek_token';
    const NAME_KEY = 'ek_name';
    let tenantId = params.get('t') || sessionStorage.getItem(TENANT_KEY) || '';
    let token = sessionStorage.getItem(TOKEN_KEY) || '';
    let priceMode = 'hidden';
    let items = [];                       // last catalogue page, by render order
    const cartKey = () => 'ek_cart_' + tenantId;
    let cart = loadCart();                // { itemId: { name, unit, qty } }

    const $ = (id) => document.getElementById(id);
    const api = () => (window.CONFIG && window.CONFIG.crmApiBaseUrl) || '/api';
    const toast = (kind, msg) => { if (typeof Toast !== 'undefined' && Toast[kind]) Toast[kind](msg); else alert(msg); };
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function loadCart() {
        try { return JSON.parse(sessionStorage.getItem(cartKey()) || '{}') || {}; } catch { return {}; }
    }
    function saveCart() {
        try { sessionStorage.setItem(cartKey(), JSON.stringify(cart)); } catch { /* private mode */ }
        renderCartCount();
    }

    async function call(method, path, body) {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers[TOKEN_HEADER] = token;
        const res = await fetch(`${api()}/ekart/${path}`, { method, headers, body: body ? JSON.stringify(body) : null });
        if (res.status === 401 && path !== 'login') { signOut(false); throw new Error('Your session expired — please sign in again.'); }
        let data = null;
        try { data = await res.json(); } catch { /* empty body */ }
        if (!res.ok) throw new Error((data && data.message) || 'Something went wrong. Please try again.');
        return data;
    }

    // ---------- login ----------

    function showLogin() {
        $('appView').hidden = true;
        $('loginView').style.display = '';
        $('loginTenantMissing').hidden = !!tenantId;
    }

    async function showApp() {
        $('loginView').style.display = 'none';
        $('appView').hidden = false;
        $('whoAmI').textContent = sessionStorage.getItem(NAME_KEY) || '';
        await refreshCatalog('');
    }

    $('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!tenantId) { $('loginTenantMissing').hidden = false; return; }
        const btn = $('loginBtn'); btn.disabled = true; $('loginError').hidden = true;
        try {
            const data = await call('POST', 'login', {
                tenant_id: tenantId,
                login_id: $('loginId').value.trim(),
                password: $('password').value,
            });
            token = data.token; priceMode = data.price_mode || 'hidden';
            sessionStorage.setItem(TOKEN_KEY, token);
            sessionStorage.setItem(TENANT_KEY, tenantId);
            sessionStorage.setItem(NAME_KEY, data.display_name || '');
            await showApp();
        } catch (err) {
            $('loginError').textContent = err.message;
            $('loginError').hidden = false;
        } finally { btn.disabled = false; }
    });

    function signOut(callServer) {
        if (callServer && token) { call('POST', 'logout').catch(() => {}); }
        token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(NAME_KEY);
        showLogin();
    }
    $('logoutBtn').addEventListener('click', () => signOut(true));

    // ---------- catalogue ----------

    async function refreshCatalog(query) {
        try {
            const data = await call('GET', 'catalog' + (query ? `?query=${encodeURIComponent(query)}` : ''));
            priceMode = data.price_mode || priceMode;
            if (data.display_name) { sessionStorage.setItem(NAME_KEY, data.display_name); $('whoAmI').textContent = data.display_name; }
            items = data.items || [];
            $('priceHint').hidden = priceMode !== 'list';
            renderGrid();
        } catch (err) {
            items = [];
            renderGrid();
            $('catalogEmptyMsg').textContent = err.message;
            $('catalogEmpty').hidden = false;
        }
    }

    function money(v, currency) {
        try {
            if (window.formatMoney) return window.formatMoney(v, currency || 'INR');
            return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR' }).format(v);
        } catch { return String(v); }
    }

    function renderGrid() {
        const grid = $('catalogGrid');
        $('catalogEmpty').hidden = items.length > 0;
        if (items.length === 0) { grid.innerHTML = ''; $('catalogEmptyMsg').textContent = 'No products matched your search.'; return; }
        grid.innerHTML = items.map((it) => {
            const inCart = cart[it.id];
            const price = (priceMode === 'list' && it.list_price != null)
                ? `<span class="ek-card-price">${esc(money(it.list_price, it.currency))}</span>` : '';
            return `
            <div class="ek-card" data-id="${esc(it.id)}">
                <div class="ek-card-img">${it.image_url ? `<img src="${esc(it.image_url)}" alt="" loading="lazy">` : '<span class="ek-noimg">📦</span>'}</div>
                <div class="ek-card-body">
                    <div class="ek-card-name">${esc(it.name)}</div>
                    ${it.description ? `<div class="ek-card-desc">${esc(it.description)}</div>` : ''}
                    <div class="ek-card-meta">${price}<span class="ek-card-unit">per ${esc(it.unit || 'unit')}</span></div>
                    <div class="ek-card-actions">
                        <input type="number" class="ek-qty" min="0.001" step="any" value="${inCart ? esc(inCart.qty) : '1'}" aria-label="Quantity">
                        <button type="button" class="ek-add${inCart ? ' in-cart' : ''}">${inCart ? 'Update' : 'Add'}</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    $('catalogGrid').addEventListener('click', (e) => {
        const btn = e.target.closest('.ek-add');
        if (!btn) return;
        const card = btn.closest('.ek-card');
        const id = card.getAttribute('data-id');
        const it = items.find((x) => String(x.id) === id);
        if (!it) return;
        const qty = parseFloat(card.querySelector('.ek-qty').value);
        if (!(qty > 0)) { toast('error', 'Enter a quantity above zero.'); return; }
        cart[id] = { name: it.name, unit: it.unit || 'unit', qty };
        saveCart();
        btn.textContent = 'Update'; btn.classList.add('in-cart');
        toast('success', `${it.name} — ${qty} ${it.unit || ''} in your inquiry`);
    });

    let searchTimer = null;
    $('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => refreshCatalog(e.target.value.trim()), 300);
    });

    // ---------- cart ----------

    function renderCartCount() {
        const n = Object.keys(cart).length;
        $('cartCount').hidden = n === 0;
        $('cartCount').textContent = n;
    }

    function renderCart() {
        const body = $('cartBody');
        const ids = Object.keys(cart);
        $('submitBtn').disabled = ids.length === 0;
        if (ids.length === 0) { body.innerHTML = '<p class="ek-smallprint" style="padding:20px 0">Nothing here yet — add products from the catalogue.</p>'; return; }
        body.innerHTML = ids.map((id) => `
            <div class="ek-line" data-id="${esc(id)}">
                <div class="ek-line-name">${esc(cart[id].name)}<div class="ek-line-unit">${esc(cart[id].unit)}</div></div>
                <input type="number" class="ek-qty" min="0.001" step="any" value="${esc(cart[id].qty)}" aria-label="Quantity">
                <button type="button" class="ek-line-remove" aria-label="Remove">×</button>
            </div>`).join('');
    }

    $('cartBody').addEventListener('click', (e) => {
        const rm = e.target.closest('.ek-line-remove');
        if (!rm) return;
        delete cart[rm.closest('.ek-line').getAttribute('data-id')];
        saveCart(); renderCart(); renderGrid();
    });
    $('cartBody').addEventListener('change', (e) => {
        const line = e.target.closest('.ek-line');
        if (!line || !e.target.classList.contains('ek-qty')) return;
        const qty = parseFloat(e.target.value);
        const id = line.getAttribute('data-id');
        if (qty > 0) { cart[id].qty = qty; saveCart(); }
        else { delete cart[id]; saveCart(); renderCart(); }
    });

    function openDrawer(which) {
        $('scrim').hidden = false;
        $('cartDrawer').hidden = which !== 'cart';
        $('historyDrawer').hidden = which !== 'history';
        if (which === 'cart') renderCart();
        if (which === 'history') renderHistory();
    }
    function closeDrawers() { $('scrim').hidden = true; $('cartDrawer').hidden = true; $('historyDrawer').hidden = true; }
    $('cartBtn').addEventListener('click', () => openDrawer('cart'));
    $('historyBtn').addEventListener('click', () => openDrawer('history'));
    $('cartClose').addEventListener('click', closeDrawers);
    $('historyClose').addEventListener('click', closeDrawers);
    $('scrim').addEventListener('click', closeDrawers);

    $('submitBtn').addEventListener('click', async () => {
        const ids = Object.keys(cart);
        if (ids.length === 0) return;
        const btn = $('submitBtn'); btn.disabled = true; btn.textContent = 'Sending…';
        try {
            await call('POST', 'inquiries', {
                lines: ids.map((id) => ({ item_id: id, quantity: cart[id].qty })),
                note: $('cartNote').value.trim() || null,
            });
            cart = {}; saveCart(); $('cartNote').value = '';
            closeDrawers(); renderGrid();
            toast('success', 'Inquiry sent — their team will come back to you with a quote.');
        } catch (err) {
            toast('error', err.message);
        } finally { btn.disabled = false; btn.textContent = 'Send inquiry'; }
    });

    // ---------- history ----------

    async function renderHistory() {
        const body = $('historyBody');
        body.innerHTML = '<p class="ek-smallprint" style="padding:20px 0">Loading…</p>';
        try {
            const data = await call('GET', 'inquiries');
            const list = (data && data.inquiries) || [];
            if (list.length === 0) { body.innerHTML = '<p class="ek-smallprint" style="padding:20px 0">No inquiries yet — your submitted carts will show here.</p>'; return; }
            body.innerHTML = list.map((q) => `
                <div class="ek-inq">
                    <div class="ek-inq-top">
                        <span class="ek-inq-date">${esc(new Date(q.submitted_at).toLocaleString())}</span>
                        <span class="ek-inq-status">${esc(q.status || 'Received')}</span>
                    </div>
                    <div>${esc(q.line_count)} product${q.line_count === 1 ? '' : 's'}</div>
                    ${q.note ? `<div class="ek-inq-note">${esc(q.note)}</div>` : ''}
                </div>`).join('');
        } catch (err) {
            body.innerHTML = `<p class="ek-smallprint" style="padding:20px 0">${esc(err.message)}</p>`;
        }
    }

    // ---------- boot ----------

    renderCartCount();
    if (token) { showApp().catch(() => showLogin()); } else { showLogin(); }
})();
