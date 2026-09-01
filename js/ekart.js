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
    const LOGIN_KEY = 'ek_login';
    let tenantId = params.get('t') || sessionStorage.getItem(TENANT_KEY) || '';
    let token = sessionStorage.getItem(TOKEN_KEY) || '';
    // A buyer who deals with two suppliers on this platform can paste supplier B's link into the tab where
    // they are signed in to supplier A. The URL would say B while the token still resolved A — A's
    // catalogue, A's name, A's prices, under B's address. The token belongs to whoever issued it.
    if (params.get('t') && sessionStorage.getItem(TENANT_KEY) && params.get('t') !== sessionStorage.getItem(TENANT_KEY)) {
        token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(NAME_KEY);
    }
    let priceMode = 'hidden';
    let items = [];                       // last catalogue page, by render order
    let loginId = sessionStorage.getItem(LOGIN_KEY) || '';
    // Keyed by the CLIENT, not just the supplier. Round 2 cleared the cart on every sign-out, which kept
    // the next client on a shared tablet out of the previous one's basket; round 7 stopped clearing it on
    // an INVOLUNTARY sign-out (so a lockout someone else triggers cannot delete an afternoon's work) — and
    // with a tenant-wide key that handed client B client A's basket, and let B submit it as their own.
    // Per-client keys give both: A's cart survives A's lockout, B never sees it.
    const cartKey = () => 'ek_cart_' + tenantId + '_' + loginId;
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
            const newLogin = $('loginId').value.trim().toUpperCase();
            if (newLogin !== loginId) {
                // A different person is signing in on this device: their note is not the last one's.
                const note = $('cartNote'); if (note) note.value = '';
            }
            loginId = newLogin;
            sessionStorage.setItem(LOGIN_KEY, loginId);
            sessionStorage.setItem(TOKEN_KEY, token);
            sessionStorage.setItem(TENANT_KEY, tenantId);
            sessionStorage.setItem(NAME_KEY, data.display_name || '');
            cart = loadCart();            // this client's own cart, not whatever was in the tab
            renderCartCount();
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
        // The cart goes with a DELIBERATE sign-out. Shared tablet, same tenant: without that the next
        // client signs in to the previous one's basket, sees what they were buying, and can submit it
        // under their own name.
        //
        // An INVOLUNTARY 401 keeps it. The login id is not a secret — it travels in the same message as the
        // password — so five wrong guesses by anyone who has seen it lock the account for fifteen minutes
        // and log the real buyer out. Throwing away the sixty lines they had assembled would make that a
        // remote delete button; they sign back in and their basket is still there.
        if (callServer) {
            cart = {};
            try { sessionStorage.removeItem(cartKey()); } catch { /* private mode */ }
            const note = $('cartNote'); if (note) note.value = '';
        }
        renderCartCount();
        // …and the DRAWERS, which are the only thing that actually shows a cart or a history. Clearing the
        // state alone left client A's basket and A's submitted notes rendered for client B to read. The
        // history is emptied either way: it is the SERVER's list for whoever was signed in.
        renderCart();
        $('historyBody').innerHTML = '';
        items = [];
        $('catalogGrid').innerHTML = '';
        closeDrawers();
        showLogin();
    }
    $('logoutBtn').addEventListener('click', () => signOut(true));

    // ---------- catalogue ----------

    let catalogSeq = 0;
    async function refreshCatalog(query) {
        // Responses can land out of order: "pan" (slow) after "panel" (fast) would leave the grid showing
        // pan's rows under panel's search box — and a slow FAILURE would blank a catalogue that loaded fine.
        const mySeq = ++catalogSeq;
        try {
            const data = await call('GET', 'catalog' + (query ? `?query=${encodeURIComponent(query)}` : ''));
            if (mySeq !== catalogSeq) return;
            priceMode = data.price_mode || priceMode;
            if (data.display_name) { sessionStorage.setItem(NAME_KEY, data.display_name); $('whoAmI').textContent = data.display_name; }
            items = data.items || [];
            catalogFailed = false;
            $('priceHint').hidden = priceMode !== 'list';
            renderGrid();
        } catch (err) {
            if (mySeq !== catalogSeq) return;
            items = [];
            catalogFailed = true;
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

    let catalogFailed = false;
    function renderGrid() {
        const grid = $('catalogGrid');
        $('catalogEmpty').hidden = items.length > 0;
        if (items.length === 0) {
            grid.innerHTML = '';
            // Only claim "nothing matched" when the catalogue actually answered. A repaint triggered by a
            // cart edit was replacing a live outage message with a claim that the supplier has no such
            // products — over an empty search box.
            if (!catalogFailed) $('catalogEmptyMsg').textContent = 'No products matched your search.';
            return;
        }
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
        const qty = normaliseQty(parseFloat(card.querySelector('.ek-qty').value));
        if (qty == null) return;
        cart[id] = { name: it.name, unit: it.unit || 'unit', qty };
        saveCart();
        btn.textContent = 'Update'; btn.classList.add('in-cart');
        toast('success', `${it.name} — ${qty} ${it.unit || ''} in your inquiry`);
    });

    /// The server stores quantities as NUMERIC(15,3) and caps a line at a million, so show the client the
    /// number that will actually be on their inquiry rather than letting the whole cart be refused later.
    function normaliseQty(raw) {
        if (!(raw > 0)) { toast('error', 'Enter a quantity above zero.'); return null; }
        const rounded = Math.round(raw * 1000) / 1000;
        if (rounded < 0.001) { toast('error', 'That quantity is too small to order.'); return null; }
        if (rounded > 1000000) { toast('error', 'That is more than 1,000,000 of one product — please call the team.'); return null; }
        return rounded;
    }

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
        const id = line.getAttribute('data-id');
        if (!cart[id]) { renderCart(); return; }          // the cart was cleared under this drawer
        const raw = parseFloat(e.target.value);
        // Blank or zero is how a client REMOVES a line. A number that is merely out of range is a typo —
        // an extra zero on the quantity — and deleting the product for it loses what they were buying.
        if (e.target.value.trim() === '' || raw === 0) { delete cart[id]; saveCart(); renderCart(); renderGrid(); return; }
        const qty = normaliseQty(raw);
        if (qty == null) { renderCart(); return; }        // keep the line, restore the stored quantity
        cart[id].qty = qty; saveCart(); renderCart();
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

    let historySeq = 0;
    async function renderHistory() {
        const body = $('historyBody');
        const mySeq = ++historySeq;
        body.innerHTML = '<p class="ek-smallprint" style="padding:20px 0">Loading…</p>';
        try {
            const data = await call('GET', 'inquiries');
            if (mySeq !== historySeq || !token) return;
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
            if (mySeq !== historySeq || !token) return;
            body.innerHTML = `<p class="ek-smallprint" style="padding:20px 0">${esc(err.message)}</p>`;
        }
    }

    // The drawers are fixed-position and start below the navbar, so they need its REAL height —
    // .ek-nav wraps on narrow screens, and a hardcoded offset would put the drawer under the nav
    // on a phone or leave a gap on a desktop. Re-measured on resize and whenever the nav's own
    // contents change (signing in adds the buttons, which is what makes it wrap).
    function syncNavHeight() {
        const nav = document.querySelector('.ek-nav');
        if (nav) document.documentElement.style.setProperty('--ek-nav-h', nav.getBoundingClientRect().height + 'px');
    }
    window.addEventListener('resize', syncNavHeight);
    if (window.ResizeObserver) {
        const nav = document.querySelector('.ek-nav');
        if (nav) new ResizeObserver(syncNavHeight).observe(nav);
    }

    // ---------- boot ----------

    syncNavHeight();
    renderCartCount();
    if (token) { showApp().catch(() => showLogin()); } else { showLogin(); }
})();
