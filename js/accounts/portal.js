/**
 * Client Portal — a customer's read-only window onto their own invoices, quotations, receipts and
 * account statement.
 *
 * No platform login: the supplier issues the password against the email on the customer record, and the
 * portal talks to `/v1/portal/*` with an opaque session token in the `X-Portal-Token` header. The tenant
 * (which supplier's books) rides in the link as `?t=<tenant id>`; the session is the customer.
 *
 * Two bodies on one page: the sign-in is the platform login page (body.form-desk), the portal is the
 * suite's Pulse language (body.cp-portal). The hero wave is the customer's OWN invoices and receipts,
 * drawn per day — the same data wave every Ragenaizer app puts under its header.
 */
(function () {
    'use strict';

    const TOKEN_KEY = 'rz_portal_token';
    const TENANT_KEY = 'rz_portal_tenant';
    const TOKEN_HEADER = 'X-Portal-Token';
    const LOGIN_BODY = 'landing-page desk-landing form-desk';
    const APP_BODY = 'dashboard cp-portal';

    const base = (typeof CONFIG !== 'undefined' && CONFIG.endpoints && CONFIG.endpoints.accounts) ? CONFIG.endpoints.accounts.replace(/\/$/, '') : '';
    const params = new URLSearchParams(location.search);
    let tenantId = params.get('t') || sessionStorage.getItem(TENANT_KEY) || '';
    let token = sessionStorage.getItem(TOKEN_KEY) || '';
    let me = null;
    let currency = 'INR';
    let invoiceFilter = '';

    // ── helpers ──────────────────────────────────────────────────────────────────────────────

    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = (n) => {
        if (n == null || isNaN(n)) return '-';
        try { return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(n)); }
        catch (_) { return Number(n).toFixed(2); }
    };
    const date = (d) => d ? new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }) : '-';
    const badge = (status, overdue) => {
        const s = overdue ? 'overdue' : String(status || '').toLowerCase();
        return `<span class="cp-badge ${esc(s)}">${esc(s.replace(/_/g, ' '))}</span>`;
    };
    const toast = (kind, msg) => { if (typeof Toast !== 'undefined' && Toast[kind]) Toast[kind](msg); else console.log(kind, msg); };
    const skeleton = (rows = 5) => `<div class="cp-skel">${'<i></i>'.repeat(rows)}</div>`;
    const empty = (title, hint) => `<div class="cp-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M4 7a2 2 0 012-2h9l5 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2z"/><path d="M14 5v5h5"/><path d="M8 13h8M8 17h5"/></svg>
        <b>${esc(title)}</b><span>${esc(hint)}</span></div>`;
    const errorBox = (msg) => `<div class="cp-empty"><b>Something went wrong</b><span class="cp-error">${esc(msg)}</span></div>`;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /** Figures count up into place — the number arriving is the moment the page feels alive. */
    function countUp(el, value, fmt, ms = 900) {
        const target = Number(value) || 0;
        if (reduced || !isFinite(target)) { el.textContent = fmt(target); return; }
        const t0 = performance.now();
        const step = (t) => {
            const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
            el.textContent = fmt(target * e);
            if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
        };
        requestAnimationFrame(step);
    }
    const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

    async function call(path, { method = 'GET', body = null, raw = false } = {}) {
        const headers = { 'Accept': raw ? 'application/pdf' : 'application/json' };
        if (body) headers['Content-Type'] = 'application/json';
        if (token) headers[TOKEN_HEADER] = token;
        const res = await fetch(`${base}/v1/portal/${path}`, { method, headers, body: body ? JSON.stringify(body) : null });
        if (res.status === 401 && path !== 'login') { signOut(true); throw new Error('Your session has expired. Please sign in again.'); }
        if (raw) {
            if (!res.ok) throw new Error(await errorText(res));
            return res.blob();
        }
        if (res.status === 204) return null;
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
        if (!res.ok) { const e = new Error((data && (data.message || data.error)) || `Request failed (${res.status})`); e.status = res.status; e.data = data; throw e; }
        return data;
    }
    async function errorText(res) {
        try { const d = await res.json(); return d.message || d.error || `Request failed (${res.status})`; } catch (_) { return `Request failed (${res.status})`; }
    }

    function show(view) {
        document.body.className = view === 'app' ? APP_BODY : LOGIN_BODY;
        $('loginView').hidden = view !== 'login';
        $('appView').hidden = view !== 'app';
        window.scrollTo(0, 0);
    }

    // ── login / logout ──────────────────────────────────────────────────────────────────────

    async function login(ev) {
        ev.preventDefault();
        const err = $('errorMessage'); err.hidden = true;
        if (!tenantId) { $('loginTenantMissing').hidden = false; return; }
        const btn = $('loginBtn'); btn.disabled = true; btn.classList.add('loading');
        try {
            const res = await call('login', { method: 'POST', body: { tenant_id: tenantId, email: $('email').value.trim(), password: $('password').value } });
            token = res.token;
            sessionStorage.setItem(TOKEN_KEY, token);
            sessionStorage.setItem(TENANT_KEY, tenantId);
            $('password').value = '';
            await boot();
        } catch (e) {
            let msg = e.message || 'Sign in failed';
            if (e.status === 423) {
                const until = e.data && e.data.locked_until ? new Date(e.data.locked_until) : null;
                msg = `Too many failed attempts. ${until ? 'Try again after ' + until.toLocaleTimeString() + '.' : 'Please try again later.'}`;
            } else if (e.status === 401) msg = 'That email and password do not match. Check the password your supplier sent you.';
            else if (e.status === 403) msg = 'This portal is not available right now. Please contact your supplier.';
            err.textContent = msg; err.hidden = false;
        } finally { btn.disabled = false; btn.classList.remove('loading'); }
    }

    function signOut(expired) {
        const had = token;
        token = ''; me = null;
        sessionStorage.removeItem(TOKEN_KEY);
        if (had && !expired) call('logout', { method: 'POST' }).catch(() => {});
        Object.keys(loaded).forEach((k) => delete loaded[k]);
        clearInterval(liveTimer); closePalette();
        const am = $('accountMenu'); if (am) { am.hidden = true; $('accountBtn')?.setAttribute('aria-expanded', 'false'); }
        show('login');
        if (expired) { const err = $('errorMessage'); err.textContent = 'Your session has expired. Please sign in again.'; err.hidden = false; }
    }

    // ── app ─────────────────────────────────────────────────────────────────────────────────

    async function boot() {
        me = await call('me');
        currency = me.base_currency || 'INR';
        const company = me.company_name || 'Client portal';
        const initials = (me.customer_name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
        $('navCompany').textContent = company;
        $('navAvatar').textContent = initials;
        $('customerNameTop').textContent = me.customer_name || '';
        $('menuAvatar').textContent = initials;
        $('menuName').textContent = me.customer_name || '';
        $('menuEmail').textContent = me.email || '';
        $('menuCompany').textContent = company;
        $('menuCode').textContent = me.customer_code || '—';
        $('menuSession').textContent = me.session_expires_at ? 'until ' + new Date(me.session_expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'active';
        $('heroEyebrow').textContent = `Client portal · ${company}`;
        $('customerName').innerHTML = `${esc(me.customer_name || 'Welcome')}<em>.</em>`;
        $('customerMeta').innerHTML = [
            me.customer_code ? `<span>Account <b style="font-family:var(--cp-mono)">${esc(me.customer_code)}</b></span>` : '',
            me.email ? `<span>${esc(me.email)}</span>` : '',
            me.billing_address ? `<span>${esc(me.billing_address)}</span>` : '',
        ].filter(Boolean).join('<span class="dot">·</span>');
        $('heroSlug').innerHTML = me.session_expires_at
            ? `Signed in · until <b>${esc(new Date(me.session_expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</b>`
            : 'Signed in';
        $('companyEmail').textContent = me.company_email || 'your supplier';

        countUp($('tileOutstanding'), me.total_outstanding, money);
        $('tileOutstandingSub').textContent = Number(me.total_outstanding) > 0 ? 'What you owe as of today' : 'Nothing outstanding — you are fully settled';
        countUp($('tileOverdue'), me.overdue_amount, money);
        $('tileOverdueWrap').classList.toggle('warn', Number(me.overdue_amount) > 0);
        $('tileOverdueWrap').classList.toggle('ok', !(Number(me.overdue_amount) > 0));
        $('tileOverdueSub').textContent = me.overdue_invoice_count ? `${me.overdue_invoice_count} invoice${me.overdue_invoice_count === 1 ? '' : 's'} past due` : 'Nothing past due';
        countUp($('tileOpen'), me.open_invoice_count ?? 0, (v) => String(Math.round(v)), 600);
        $('tileTerms').textContent = me.payment_terms_days != null ? `${me.payment_terms_days} days` : '—';
        markSynced();

        show('app');
        switchTab('invoices');
        drawWave().catch(() => {});
        armLive();
    }

    // ── live: the page keeps itself current without being asked ───────────────────────────
    let liveTimer = null;
    function markSynced() {
        const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        $('heroSlug').innerHTML = `<b>Live</b> · synced ${esc(t)}`;
    }
    function armLive() {
        clearInterval(liveTimer);
        liveTimer = setInterval(async () => {
            if (!token || document.hidden) return;
            try {
                const fresh = await call('me');
                const changed = JSON.stringify(fresh) !== JSON.stringify(me);
                me = fresh;
                if (changed) {
                    countUp($('tileOutstanding'), me.total_outstanding, money);
                    countUp($('tileOverdue'), me.overdue_amount, money);
                    $('tileOverdueWrap').classList.toggle('warn', Number(me.overdue_amount) > 0);
                    $('tileOverdueWrap').classList.toggle('ok', !(Number(me.overdue_amount) > 0));
                    $('tileOpen').textContent = String(me.open_invoice_count ?? 0);
                    const active = document.querySelector('.cp-tab.active')?.dataset.tab;
                    Object.keys(loaded).forEach((k) => delete loaded[k]);
                    if (active) switchTab(active);
                    drawWave().catch(() => {});
                    toast('info', 'Your account was updated by your supplier — figures refreshed.');
                }
                markSynced();
            } catch (_) { /* a failed poll is silent; the next one will try again */ }
        }, 90000);
    }

    /** Insight chips: derived from the customer's own documents, no guesswork. */
    function renderInsights(invoices, payments) {
        const host = $('insights'); if (!host) return;
        const today = startOfDay(new Date());
        const open = invoices.filter((i) => Number(i.balance_due) > 0 && i.status !== 'written_off');
        const chips = [];
        const nextDue = open.filter((i) => !i.is_overdue).sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
        if (nextDue) {
            const d = daysBetween(today, new Date(nextDue.due_date));
            chips.push(`<span class="cp-chip ${d <= 3 ? 'amber' : ''}"><i></i>Next due <b>${esc(nextDue.invoice_number)}</b> · <b>${money(nextDue.balance_due)}</b> · ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days'}</span>`);
        }
        const overdue = open.filter((i) => i.is_overdue);
        if (overdue.length) {
            const oldest = overdue.sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
            chips.push(`<span class="cp-chip warn"><i></i>Overdue <b>${money(overdue.reduce((s, i) => s + Number(i.balance_due), 0))}</b> · oldest ${daysBetween(new Date(oldest.due_date), today)} days past due</span>`);
        }
        const year = today.getFullYear();
        const paidThisYear = payments.filter((p) => new Date(p.payment_date).getFullYear() === year).reduce((s, p) => s + Number(p.amount || 0), 0);   // settled (cash + TDS)
        const yearReceipts = payments.filter((p) => new Date(p.payment_date).getFullYear() === year);
        // A receipt's `amount` is what settled the invoice = cash + TDS the client withheld. The client PAID the cash.
        const tdsThisYear = yearReceipts.reduce((t, p) => t + Number(p.tds_amount || 0), 0);
        const cashThisYear = Math.max(0, paidThisYear - tdsThisYear);
        if ($('tileReceived')) { countUp($('tileReceived'), cashThisYear, money); $('tileReceivedSub').textContent = yearReceipts.length ? `${yearReceipts.length} receipt${yearReceipts.length === 1 ? '' : 's'} in ${year}${tdsThisYear ? ' · + ' + money(tdsThisYear) + ' TDS withheld' : ''}` : `No receipts yet in ${year}`; }
        if (cashThisYear > 0) chips.push(`<span class="cp-chip ok"><i></i>Paid in ${year} <b>${money(cashThisYear)}</b> across ${yearReceipts.length} receipt${yearReceipts.length === 1 ? '' : 's'}</span>`);
        if (invoices.length) {
            const first = invoices.map((i) => new Date(i.invoice_date)).sort((a, b) => a - b)[0];
            chips.push(`<span class="cp-chip"><i></i>Customer since <b>${esc(first.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))}</b> · ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}</span>`);
        }
        host.innerHTML = chips.join('');
    }

    const loaded = {};
    function switchTab(name) {
        document.querySelectorAll('.cp-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
        ['invoices', 'quotes', 'projects', 'statement', 'payments', 'tds'].forEach((t) => { $('tab-' + t).hidden = t !== name; });
        if (!loaded[name]) { loaded[name] = true; ({ invoices: loadInvoices, quotes: loadQuotes, projects: loadProjects, statement: loadStatement, payments: loadPayments, tds: loadTds })[name](); }
    }

    // ── the hero wave: the customer's own ledger, per day ───────────────────────────────────

    function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
    function smoothPath(vals, x, y) {
        const pts = vals.map((v, i) => [x(i), y(v)]);
        const n = pts.length;
        if (n < 2) return '';
        const dx = [], m = [];
        for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1)); }
        const t = [m[0]];
        for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
        t.push(m[n - 2]);
        for (let i = 0; i < n - 1; i++) {
            if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
            else { const a = t[i] / m[i], b = t[i + 1] / m[i]; const s = a * a + b * b; if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; } }
        }
        let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
        for (let i = 0; i < n - 1; i++) {
            const h = dx[i];
            d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1)
               + ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1)
               + ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
        }
        return d;
    }

    async function drawWave() {
        const host = $('heroWave');
        const [inv, pay] = await Promise.all([call('invoices?limit=200'), call('payments?limit=200')]);
        const today = startOfDay(new Date());
        const series = [
            { color: 'var(--brand-primary)', fill: true, values: {} },     // invoiced per day
            { color: 'var(--cp-mint)', fill: false, values: {} },          // received per day
            { color: 'var(--cp-rose)', fill: false, values: {}, dots: true }, // overdue balance, as markers
        ];
        (inv.items || []).forEach((i) => {
            const k = startOfDay(new Date(i.invoice_date)).getTime();
            series[0].values[k] = (series[0].values[k] || 0) + Number(i.total_amount || 0);
            if (i.is_overdue) series[2].values[k] = (series[2].values[k] || 0) + Number(i.balance_due || 0);
        });
        (pay.items || []).forEach((p) => {
            const k = startOfDay(new Date(p.payment_date)).getTime();
            series[1].values[k] = (series[1].values[k] || 0) + Number(p.amount || 0);
        });
        renderInsights(inv.items || [], pay.items || []);
        call('tds').then((t) => {
            if (!Number(t.total_tds)) return;
            const host = $('insights'); if (!host) return;
            host.insertAdjacentHTML('beforeend', `<span class="cp-chip"><i></i>TDS withheld this FY <b>${money(t.total_tds)}</b> · <button class="cp-btn-link" data-goto-tab="tds" type="button" style="padding:0">see breakdown</button></span>`);
        }).catch(() => {});
        paletteDocs = { invoices: inv.items || [], quotes: paletteDocs.quotes };
        const dayKey = (off) => { const d = new Date(today); d.setDate(today.getDate() - off); return d.getTime(); };
        const countIn = (days) => series.some((s) => { for (let i = 0; i < days; i++) if (s.values[dayKey(i)]) return true; return false; });
        const DAYS = countIn(30) ? 30 : (countIn(90) ? 90 : (countIn(365) ? 365 : 0));
        if (!DAYS) { $('heroEmpty').hidden = false; return; }

        // The zero-baseline sits BELOW the clipped box (padB < 0): quiet days draw nothing, so no horizontal
        // line ever runs along the bottom of the hero — only activity rises into view.
        // Aurora, not a chart. Each series is a blurred luminous ribbon whose height is the day's value;
        // no strokes, no markers, no axes. Quiet days are dark; activity glows. The zero-baseline sits
        // below the box so nothing draws where nothing happened.
        const W = 1200, H = 200, padT = 10, padB = -30, ih = H - padT - padB;
        const start = new Date(today); start.setDate(today.getDate() - (DAYS - 1));
        const bands = series.map((s) => {
            const buckets = new Array(DAYS).fill(0);
            for (let i = 0; i < DAYS; i++) { const d = new Date(start); d.setDate(start.getDate() + i); buckets[i] = s.values[d.getTime()] || 0; }
            return { ...s, buckets };
        }).filter((b) => b.buckets.some((v) => v > 0));
        // widen every event across neighbouring days so a single invoice becomes a soft mound, not a spike
        const soften = (arr) => arr.map((_, i) => { let acc = 0, wsum = 0; for (let k = -6; k <= 6; k++) { const j = i + k; if (j < 0 || j >= arr.length) continue; const w = Math.exp(-(k * k) / 10); acc += arr[j] * w; wsum += w; } return acc / wsum; });
        bands.forEach((b) => { b.soft = soften(b.buckets); });
        const yMax = Math.max(...bands.flatMap((b) => b.soft)) * 1.1 || 1;
        const x = (i) => (i / (DAYS - 1)) * W;
        const y = (v) => padT + ih - (v / yMax) * ih;
        const hues = { 0: ['#6366F1', '#818CF8'], 1: ['#34d399', '#2DD4BF'], 2: ['#f87171', '#FB923C'] };
        const paths = bands.map((b, idx) => {
            const [c1, c2] = hues[series.indexOf(series.find((s) => s.color === b.color))] || hues[0];
            const line = smoothPath(b.soft, x, y);
            return `<path data-fill d="${line} L${W},${H + 40} L0,${H + 40} Z" fill="url(#cpAur${idx})" filter="url(#cpAurora)" opacity="0.9"/>`;
        }).join('');
        const grads = bands.map((b, idx) => {
            const [c1, c2] = hues[series.indexOf(series.find((s) => s.color === b.color))] || hues[0];
            return `<linearGradient id="cpAur${idx}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c2}" stop-opacity="0.55"/><stop offset="0.45" stop-color="${c1}" stop-opacity="0.22"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></linearGradient>`;
        }).join('');
        host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <defs>${grads}<filter id="cpAurora" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="14"/></filter></defs>${paths}</svg>`;
        host.title = `Your ledger, last ${DAYS} days — invoiced (blue), received (green), overdue (red)`;
    }

    // ── invoices ────────────────────────────────────────────────────────────────────────────

    async function loadInvoices() {
        const host = $('invoicesTable'); host.innerHTML = skeleton(5);
        try {
            const qs = invoiceFilter ? `?status=${encodeURIComponent(invoiceFilter)}&limit=200` : '?limit=200';
            const page = await call('invoices' + qs);
            const rows = page.items || [];
            if (!invoiceFilter) { const c = $('tabCountInvoices'); c.textContent = rows.length; c.hidden = !rows.length; }
            if (!rows.length) { host.innerHTML = empty(invoiceFilter ? 'No invoices match this filter' : 'No invoices yet', invoiceFilter ? 'Try "All" to see everything on your account.' : 'Invoices your supplier issues to you will appear here the moment they are approved.'); return; }
            const paid = rows.reduce((s, i) => s + Number(i.paid_amount || 0), 0), total = rows.reduce((s, i) => s + Number(i.total_amount || 0), 0);
            if (!invoiceFilter) $('paidRing').style.setProperty('--pct', total ? Math.round(paid / total * 100) : 0);
            host.innerHTML = `<table class="cp-table"><thead><tr>
                <th>Invoice</th><th>Date</th><th>Due</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th></th>
            </tr></thead><tbody>${rows.map((i) => `<tr>
                <td><button class="cp-btn-link" data-open-invoice="${esc(i.id)}" type="button">${esc(i.invoice_number)}</button></td>
                <td class="cp-date">${date(i.invoice_date)}</td><td class="cp-date">${date(i.due_date)}</td>
                <td>${badge(i.status, i.is_overdue)}</td>
                <td class="num">${money(i.total_amount)}</td><td class="num">${money(i.paid_amount)}</td><td class="num strong">${money(i.balance_due)}</td>
                <td class="num"><span class="acts"><button class="cp-btn cp-btn-sm" data-pdf-invoice="${esc(i.id)}" data-name="${esc(i.invoice_number)}" type="button">PDF</button>
                    ${i.payment_link && i.balance_due > 0 ? `<a class="cp-btn cp-btn-sm cp-btn-primary" href="${esc(i.payment_link)}" target="_blank" rel="noopener">Pay</a>` : ''}</span></td>
            </tr>`).join('')}</tbody></table>${page.truncated ? '<div class="cp-help" style="margin-top:8px;">Showing the first 200 invoices. The statement covers your full history.</div>' : ''}`;
        } catch (e) { host.innerHTML = errorBox(e.message); }
    }

    async function openInvoice(id) {
        openDrawer('Invoice', 'Invoice', skeleton(6));
        try {
            const inv = await call(`invoices/${id}`);
            $('drawerTitle').textContent = inv.invoice_number;
            $('drawerBody').innerHTML = `
                <dl class="cp-kv">
                    <dt>Status</dt><dd class="text">${badge(inv.status, inv.is_overdue)}</dd>
                    <dt>Invoice date</dt><dd>${date(inv.invoice_date)}</dd>
                    <dt>Due date</dt><dd>${date(inv.due_date)}</dd>
                    <dt>Total</dt><dd>${money(inv.total_amount)}</dd>
                    <dt>Paid</dt><dd>${money(inv.paid_amount)}</dd>
                    <dt>Balance due</dt><dd><strong>${money(inv.balance_due)}</strong></dd>
                    ${inv.ship_to_legal_name ? `<dt>Ship to</dt><dd class="text">${esc(inv.ship_to_legal_name)}${inv.ship_to_address ? '<br>' + esc(inv.ship_to_address) : ''}</dd>` : ''}
                </dl>
                ${linesTable(inv)}
                <div class="cp-drawer-actions">
                    <button class="cp-btn cp-btn-primary" data-preview="invoices" data-id="${esc(inv.id)}" data-name="${esc(inv.invoice_number)}" type="button">Preview tax invoice</button>
                    <button class="cp-btn" data-pdf-invoice="${esc(inv.id)}" data-name="${esc(inv.invoice_number)}" type="button">Download PDF</button>
                    ${inv.payment_link && inv.balance_due > 0 ? `<a class="cp-btn" href="${esc(inv.payment_link)}" target="_blank" rel="noopener">Pay online</a>` : ''}
                </div>
                <div id="previewHost"></div>`;
        } catch (e) { $('drawerBody').innerHTML = errorBox(e.message); }
    }

    function linesTable(doc) {
        const lines = doc.lines || [];
        if (!lines.length) return '';
        return `<div class="cp-table-wrap"><table class="cp-table"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Tax</th><th class="num">Amount</th></tr></thead>
            <tbody>${lines.map((l) => `<tr>
                <td>${esc(l.description || '-')}${l.hsn_sac ? `<span class="sub">HSN/SAC ${esc(l.hsn_sac)}</span>` : ''}</td>
                <td class="num">${esc(l.quantity)}${l.uom ? ' ' + esc(l.uom) : ''}</td>
                <td class="num">${money(l.unit_price)}</td><td class="num">${money(l.tax_amount)}</td><td class="num">${money(l.amount)}</td>
            </tr>`).join('')}
            <tr><td colspan="4" class="num">Subtotal</td><td class="num">${money(doc.subtotal)}</td></tr>
            ${Number(doc.discount_amount) ? `<tr><td colspan="4" class="num">Discount</td><td class="num">− ${money(doc.discount_amount)}</td></tr>` : ''}
            <tr><td colspan="4" class="num">Tax</td><td class="num">${money(doc.tax_amount)}</td></tr>
            <tr class="total"><td colspan="4" class="num">Total</td><td class="num">${money(doc.total_amount)}</td></tr>
            </tbody></table></div>`;
    }

    // ── quotations ──────────────────────────────────────────────────────────────────────────

    async function loadQuotes() {
        const host = $('quotesTable'); host.innerHTML = skeleton(4);
        try {
            const page = await call('proforma-invoices?limit=200');
            const rows = page.items || [];
            const c = $('tabCountQuotes'); c.textContent = rows.length; c.hidden = !rows.length;
            paletteDocs.quotes = rows;
            if (!rows.length) { host.innerHTML = empty('No quotations yet', 'When your supplier sends you a quote or proforma invoice, it will be listed here with its validity date.'); return; }
            host.innerHTML = `<table class="cp-table"><thead><tr>
                <th>Quotation</th><th>Date</th><th>Valid until</th><th>Status</th><th class="num">Total</th><th></th>
            </tr></thead><tbody>${rows.map((q) => `<tr>
                <td><button class="cp-btn-link" data-open-quote="${esc(q.id)}" type="button">${esc(q.proforma_number)}</button></td>
                <td class="cp-date">${date(q.proforma_date)}</td><td class="cp-date">${date(q.valid_until)}</td>
                <td>${badge(q.status)}${q.converted_invoice_number ? `<span class="sub">Invoice ${esc(q.converted_invoice_number)}</span>` : ''}</td>
                <td class="num strong">${money(q.total_amount)}</td>
                <td class="num"><span class="acts"><button class="cp-btn cp-btn-sm" data-pdf-quote="${esc(q.id)}" data-name="${esc(q.proforma_number)}" type="button">PDF</button></span></td>
            </tr>`).join('')}</tbody></table>`;
        } catch (e) { host.innerHTML = errorBox(e.message); }
    }

    async function openQuote(id) {
        openDrawer('Quotation', 'Quotation', skeleton(6));
        try {
            const q = await call(`proforma-invoices/${id}`);
            $('drawerTitle').textContent = q.proforma_number;
            $('drawerBody').innerHTML = `
                <dl class="cp-kv">
                    <dt>Status</dt><dd class="text">${badge(q.status)}</dd>
                    <dt>Date</dt><dd>${date(q.proforma_date)}</dd>
                    <dt>Valid until</dt><dd>${date(q.valid_until)}</dd>
                    <dt>Total</dt><dd><strong>${money(q.total_amount)}</strong></dd>
                    ${q.converted_invoice_number ? `<dt>Invoiced as</dt><dd>${esc(q.converted_invoice_number)}</dd>` : ''}
                </dl>
                ${linesTable(q)}
                <div class="cp-drawer-actions">
                    <button class="cp-btn cp-btn-primary" data-preview="proforma-invoices" data-id="${esc(q.id)}" data-name="${esc(q.proforma_number)}" type="button">Preview quotation</button>
                    <button class="cp-btn" data-pdf-quote="${esc(q.id)}" data-name="${esc(q.proforma_number)}" type="button">Download PDF</button>
                </div>
                <div id="previewHost"></div>`;
        } catch (e) { $('drawerBody').innerHTML = errorBox(e.message); }
    }

    // ── statement ───────────────────────────────────────────────────────────────────────────

    async function loadStatement() {
        const host = $('statementBody'); host.innerHTML = skeleton(7);
        const from = $('stmtFrom').value, to = $('stmtTo').value;
        try {
            const qs = [from ? `fromDate=${from}` : '', to ? `toDate=${to}` : ''].filter(Boolean).join('&');
            const s = await call('statement' + (qs ? '?' + qs : ''));
            // One chronological ledger from the statement's typed sections. Debits raise what you owe;
            // credits reduce it. Same rows, same dates, same totals as the statement your supplier emails.
            const rows = [];
            (s.invoices || []).forEach((i) => rows.push({ d: i.invoice_date, type: 'Invoice', ref: i.invoice_number, debit: i.total_amount, credit: 0, note: i.status }));
            (s.payments || []).forEach((p) => rows.push({ d: p.payment_date, type: 'Payment', ref: p.payment_number, debit: 0, credit: Number(p.amount) - Number(p.advance_remaining || 0) - Number(p.advance_refunded || 0), note: p.payment_method }));
            (s.credit_notes || []).forEach((c) => rows.push({ d: c.credit_date, type: 'Credit note', ref: c.credit_note_number, debit: 0, credit: c.amount, note: c.reason }));
            (s.gift_card_redemptions || []).forEach((g) => rows.push({ d: g.redeem_date, type: 'Gift card', ref: g.invoice_number, debit: 0, credit: g.amount, note: g.card_code }));
            (s.advance_applications || []).forEach((a) => rows.push({ d: a.event_date, type: 'Advance applied', ref: a.invoice_number, debit: 0, credit: a.amount, note: '' }));
            (s.write_offs || []).forEach((w) => rows.push({ d: w.write_off_date, type: 'Adjustment', ref: w.invoice_number, debit: 0, credit: w.amount, note: '' }));
            (s.refunds || []).forEach((r) => rows.push({ d: r.created_at, type: 'Refund', ref: '', debit: r.amount, credit: 0, note: r.method }));
            rows.sort((a, b) => new Date(a.d) - new Date(b.d));
            let bal = Number(s.opening_balance || 0);
            const body = rows.map((r) => { bal += Number(r.debit) - Number(r.credit); return `<tr>
                <td class="cp-date">${date(r.d)}</td><td>${esc(r.type)}</td><td>${esc(r.ref)}${r.note ? `<span class="sub">${esc(String(r.note).replace(/_/g, ' '))}</span>` : ''}</td>
                <td class="num">${r.debit ? money(r.debit) : ''}</td><td class="num">${r.credit ? money(r.credit) : ''}</td><td class="num strong">${money(bal)}</td></tr>`; }).join('');
            const credits = Number(s.total_credits || 0) + Number(s.total_gift_card_redeemed || 0) + Number(s.total_advance_applied || 0);
            host.innerHTML = `
                <div class="cp-strip">
                    <div class="cp-tile"><div class="cp-tile-label">Opening balance</div><div class="cp-tile-value">${money(s.opening_balance)}</div></div>
                    <div class="cp-tile"><div class="cp-tile-label">Invoiced</div><div class="cp-tile-value">${money(s.total_invoiced)}</div></div>
                    <div class="cp-tile ok"><div class="cp-tile-label">Received</div><div class="cp-tile-value">${money(s.total_received)}</div></div>
                    <div class="cp-tile"><div class="cp-tile-label">Credits</div><div class="cp-tile-value">${money(credits)}</div></div>
                    <div class="cp-tile ${Number(s.total_outstanding) > 0 ? 'warn' : 'ok'}"><div class="cp-tile-label">Closing balance</div><div class="cp-tile-value">${money(s.total_outstanding)}</div></div>
                </div>
                ${Number(s.advances_on_hand) > 0 ? `<div class="cp-deposit">You also have <b>${money(s.advances_on_hand)}</b> on deposit with your supplier, not yet applied to an invoice.</div>` : ''}
                ${rows.length ? `<div class="cp-table-wrap"><table class="cp-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
                    <tbody><tr><td class="cp-date">${from ? date(from) : ''}</td><td>Opening balance</td><td></td><td class="num"></td><td class="num"></td><td class="num">${money(s.opening_balance)}</td></tr>${body}
                    <tr class="total"><td colspan="5">Closing balance</td><td class="num">${money(s.total_outstanding)}</td></tr></tbody></table></div>`
                    : empty('No activity in this period', 'Widen the dates, or leave both blank for your full history.')}`;
        } catch (e) { host.innerHTML = errorBox(e.message); }
    }

    // ── projects ────────────────────────────────────────────────────────────────────────────

    async function loadProjects() {
        const host = $('projectsBody'); host.innerHTML = skeleton(6);
        try {
            const ps = await call('projects');
            const groups = (ps.projects || []).filter((g) => g.invoices.length || Number(g.billed));
            const real = groups.filter((g) => g.project_id);
            const c = $('tabCountProjects'); c.textContent = real.length; c.hidden = !real.length;
            if (!groups.length) { host.innerHTML = empty('No invoices to group yet', 'Once your supplier bills work against a project, it will appear here with its own running total.'); return; }
            // "Collected" in the supplier's books = cash + TDS credit (both settle the invoice). From this side of the
            // table the client paid the cash and withheld the TDS, so the two are shown apart — and then
            // paid + TDS withheld + credited + due = billed, which is the sum a client can check by hand.
            const totalTds = groups.reduce((t, g) => t + Number(g.tds_withheld || 0), 0);
            const cash = (g) => Math.max(0, Number(g.collected || 0) - Number(g.tds_withheld || 0));
            host.innerHTML = `
                <div class="cp-strip">
                    <div class="cp-tile"><div class="cp-tile-label">Billed (ex tax)</div><div class="cp-tile-value">${money(ps.total_billed_ex_tax)}</div></div>
                    <div class="cp-tile"><div class="cp-tile-label">Tax</div><div class="cp-tile-value">${money(ps.total_tax)}</div></div>
                    <div class="cp-tile ok"><div class="cp-tile-label">Paid (cash)</div><div class="cp-tile-value">${money(Math.max(0, Number(ps.total_collected) - totalTds))}</div></div>
                    <div class="cp-tile"><div class="cp-tile-label">TDS withheld</div><div class="cp-tile-value">${money(totalTds)}</div></div>
                    <div class="cp-tile"><div class="cp-tile-label">Credited</div><div class="cp-tile-value">${money(ps.total_credited)}</div></div>
                    <div class="cp-tile ${Number(ps.total_due) > 0 ? 'warn' : 'ok'}"><div class="cp-tile-label">Due</div><div class="cp-tile-value">${money(ps.total_due)}</div></div>
                </div>
                <div class="cp-help" style="margin-bottom:12px;">Paid (cash) + TDS withheld + credited + due = billed. TDS you deduct settles the invoice on your supplier's books, so it is shown beside what you actually paid rather than inside it.</div>
                <div class="cp-projects">${groups.map((g) => {
                    const pct = Number(g.billed) > 0 ? Math.min(100, Math.round(Number(g.collected) / Number(g.billed) * 100)) : 0;
                    return `<article class="cp-project">
                        <header class="cp-project-head">
                            <div>
                                <div class="cp-eyebrow"><i></i>${g.project_id ? esc(g.project_code || 'Project') : 'Not tied to a project'}${g.status ? ` · ${esc(g.status)}` : ''}</div>
                                <h3>${esc(g.project_name)}</h3>
                            </div>
                            <div class="cp-project-due ${Number(g.due) > 0 ? 'warn' : 'ok'}"><span>Due</span><b>${money(g.due)}</b></div>
                        </header>
                        <div class="cp-project-bar" title="${pct}% of billed settled (cash + TDS)"><i style="width:${pct}%"></i></div>
                        <dl class="cp-project-facts">
                            <div><dt>Billed (ex tax)</dt><dd>${money(g.billed_ex_tax)}</dd></div>
                            <div><dt>Tax</dt><dd>${money(g.tax)}</dd></div>
                            <div><dt>Billed</dt><dd>${money(g.billed)}</dd></div>
                            <div><dt>Paid (cash)</dt><dd>${money(cash(g))}</dd></div>
                            <div><dt>TDS withheld</dt><dd>${money(g.tds_withheld)}</dd></div>
                            <div><dt>Credited</dt><dd>${money(g.credited)}</dd></div>
                        </dl>
                        ${g.invoices.length ? `<div class="cp-table-wrap"><table class="cp-table"><thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th class="num">This project (ex tax)</th><th class="num">Invoice total</th><th class="num">Balance</th></tr></thead>
                            <tbody>${g.invoices.map((i) => `<tr>
                                <td><button class="cp-btn-link" data-open-invoice="${esc(i.id)}" type="button">${esc(i.invoice_number)}</button></td>
                                <td class="cp-date">${date(i.invoice_date)}</td><td>${badge(i.status, i.is_overdue)}</td>
                                <td class="num strong">${money(i.share_ex_tax)}</td><td class="num">${money(i.total_amount)}</td><td class="num">${money(i.balance_due)}</td>
                            </tr>`).join('')}</tbody></table></div>` : '<div class="cp-help">No issued invoices yet for this project.</div>'}
                    </article>`; }).join('')}</div>`;
        } catch (e) { host.innerHTML = errorBox(e.message); }
    }

    // ── TDS withheld ────────────────────────────────────────────────────────────────────────

    async function loadTds() {
        const host = $('tdsBody'); host.innerHTML = skeleton(4);
        const from = $('tdsFrom').value, to = $('tdsTo').value;
        try {
            const qs = [from ? `fromDate=${from}` : '', to ? `toDate=${to}` : ''].filter(Boolean).join('&');
            const t = await call('tds' + (qs ? '?' + qs : ''));
            if (!from) $('tdsFrom').value = String(t.from_date).slice(0, 10);
            if (!to) $('tdsTo').value = String(t.to_date).slice(0, 10);
            const period = `${date(t.from_date)} – ${date(t.to_date)}`;
            if (!Number(t.total_tds)) { host.innerHTML = empty('No TDS in this period', `No payment you made between ${period} carried tax deducted at source. Change the dates to look at another period.`); return; }
            const table = (rows, label, key) => `<div class="cp-table-wrap"><table class="cp-table"><thead><tr><th>${label}</th><th class="num">TDS withheld</th><th class="num">Share</th></tr></thead>
                <tbody>${rows.map((r) => `<tr><td>${key === 'invoice' ? `<button class="cp-btn-link" data-open-invoice="${esc(r.invoice_id)}" type="button">${esc(r.invoice_number)}</button>` : esc(r.project_name || 'Not tied to a project')}</td>
                    <td class="num strong">${money(r.tds)}</td><td class="num">${(Number(r.tds) / Number(t.total_tds) * 100).toFixed(0)}%</td></tr>`).join('')}
                <tr class="total"><td>Total</td><td class="num">${money(rows.reduce((s, r) => s + Number(r.tds), 0))}</td><td class="num">100%</td></tr></tbody></table></div>`;
            host.innerHTML = `
                <div class="cp-strip">
                    <div class="cp-tile cp-tile-hero"><div class="cp-tile-label">Total TDS withheld</div><div class="cp-tile-value">${money(t.total_tds)}</div><div class="cp-tile-sub">${esc(period)}</div></div>
                    <div class="cp-tile"><div class="cp-tile-label">Invoices</div><div class="cp-tile-value">${t.by_invoice.length}</div><div class="cp-tile-sub">carried a deduction</div></div>
                    <div class="cp-tile"><div class="cp-tile-label">Projects</div><div class="cp-tile-value">${t.by_project.length}</div><div class="cp-tile-sub">apportioned by line value</div></div>
                </div>
                <div class="cp-help" style="margin-bottom:14px;">Per-invoice and per-project figures split each payment's TDS in proportion to what it settled, so they can differ from the total by a few paise after rounding — exactly as your supplier's own report does.</div>
                <div class="cp-two"><div><h3 class="cp-sub">By invoice</h3>${table(t.by_invoice, 'Invoice', 'invoice')}</div><div><h3 class="cp-sub">By project</h3>${table(t.by_project, 'Project', 'project')}</div></div>`;
        } catch (e) { host.innerHTML = errorBox(e.message); }
    }

    // ── payments & credits ──────────────────────────────────────────────────────────────────

    async function loadPayments() {
        const p = $('paymentsTable'), c = $('creditsTable');
        p.innerHTML = skeleton(3); c.innerHTML = skeleton(2);
        try {
            const [pay, cr] = await Promise.all([call('payments?limit=200'), call('credit-notes?limit=200')]);
            const pr = pay.items || [];
            p.innerHTML = pr.length ? `<table class="cp-table"><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Reference</th><th class="num">Paid (cash)</th><th class="num">TDS withheld</th><th class="num">Settled</th><th class="num">On deposit</th></tr></thead>
                <tbody>${pr.map((x) => `<tr><td><span style="font-family:var(--cp-mono)">${esc(x.payment_number)}</span></td><td class="cp-date">${date(x.payment_date)}</td><td>${esc(String(x.payment_method || '').replace(/_/g, ' '))}</td><td>${esc(x.reference_number || '-')}</td>
                <td class="num strong">${money(Math.max(0, Number(x.amount) - Number(x.tds_amount || 0)))}</td><td class="num">${Number(x.tds_amount) ? money(x.tds_amount) : ''}</td><td class="num">${money(x.amount)}</td><td class="num">${Number(x.advance_remaining) ? money(x.advance_remaining) : ''}</td></tr>`).join('')}</tbody></table>
                <div class="cp-help" style="margin-top:8px;">Settled = what the receipt cleared on your account (cash you paid + TDS you withheld).</div>`
                : empty('No payments recorded yet', 'Receipts your supplier records against your invoices will show here with their method and reference.');
            const crr = cr.items || [];
            c.innerHTML = crr.length ? `<table class="cp-table"><thead><tr><th>Credit note</th><th>Date</th><th>Against</th><th>Reason</th><th>Status</th><th class="num">Amount</th></tr></thead>
                <tbody>${crr.map((x) => `<tr><td><span style="font-family:var(--cp-mono)">${esc(x.credit_note_number)}</span></td><td class="cp-date">${date(x.credit_date)}</td><td>${esc(x.invoice_number || '-')}</td><td>${esc(x.reason || '-')}</td><td>${badge(x.status)}</td><td class="num strong">${money(x.amount)}</td></tr>`).join('')}</tbody></table>`
                : empty('No credit notes', 'Any credit your supplier issues against an invoice will appear here.');
        } catch (e) { p.innerHTML = errorBox(e.message); c.innerHTML = ''; }
    }

    // ── PDFs / drawer ───────────────────────────────────────────────────────────────────────

    async function downloadPdf(kind, id, name, btn) {
        const label = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
        try {
            const blob = await call(`${kind}/${id}/pdf`, { raw: true });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${kind === 'invoices' ? 'Invoice' : 'Quotation'}-${name}.pdf`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            toast('success', `${kind === 'invoices' ? 'Invoice' : 'Quotation'} ${name} downloaded`);
        } catch (e) { toast('error', e.message || 'Could not download the PDF'); }
        finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
    }

    /** The real document, rendered in place — the same bytes Finance holds, not a re-drawing. */
    async function previewPdf(kind, id, name, btn) {
        const host = $('previewHost'); if (!host) return;
        if (host.dataset.open === id) { host.innerHTML = ''; host.dataset.open = ''; btn.textContent = btn.dataset.label || 'Preview'; return; }
        btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = 'Rendering…';
        try {
            const blob = await call(`${kind}/${id}/pdf`, { raw: true });
            const url = URL.createObjectURL(blob);
            host.innerHTML = `<div class="cp-preview"><div class="cp-preview-bar"><span>${esc(name)} · PDF</span><span>${(blob.size / 1024).toFixed(0)} KB</span></div><iframe title="${esc(name)}" src="${url}#toolbar=0&navpanes=0"></iframe></div>`;
            host.dataset.open = id;
            btn.textContent = 'Hide preview';
        } catch (e) { toast('error', e.message || 'Could not render the document'); btn.textContent = btn.dataset.label; }
        finally { btn.disabled = false; }
    }

    // ── ⌘K: jump to anything ────────────────────────────────────────────────────────────────
    let paletteDocs = { invoices: [], quotes: [] };
    let paletteSel = 0;
    function paletteItems(q) {
        const s = (q || '').trim().toLowerCase();
        const items = [
            { k: 'section', label: 'Invoices', run: () => switchTab('invoices') },
            { k: 'section', label: 'Quotations', run: () => switchTab('quotes') },
            { k: 'section', label: 'Projects', run: () => switchTab('projects') },
            { k: 'section', label: 'Account statement', run: () => switchTab('statement') },
            { k: 'section', label: 'TDS withheld', run: () => switchTab('tds') },
            { k: 'section', label: 'Payments & credits', run: () => switchTab('payments') },
            { k: 'action', label: 'Sign out', run: () => signOut(false) },
            ...paletteDocs.invoices.map((i) => ({ k: 'invoice', label: i.invoice_number, meta: `${money(i.balance_due)} due · ${date(i.due_date)}`, run: () => { switchTab('invoices'); openInvoice(i.id); } })),
            ...paletteDocs.quotes.map((x) => ({ k: 'quote', label: x.proforma_number, meta: `${money(x.total_amount)} · ${x.status}`, run: () => { switchTab('quotes'); openQuote(x.id); } })),
        ];
        return s ? items.filter((it) => (it.label + ' ' + (it.meta || '') + ' ' + it.k).toLowerCase().includes(s)) : items;
    }
    function renderPalette() {
        const items = paletteItems($('paletteInput').value);
        paletteSel = Math.min(paletteSel, Math.max(0, items.length - 1));
        $('paletteList').innerHTML = items.length
            ? items.map((it, i) => `<div class="cp-palette-item ${i === paletteSel ? 'sel' : ''}" data-i="${i}"><span class="k">${esc(it.k)}</span><span>${esc(it.label)}</span>${it.meta ? `<span class="m">${esc(it.meta)}</span>` : ''}</div>`).join('')
            : '<div class="cp-palette-empty">Nothing matches. Try an invoice number.</div>';
        $('paletteList').querySelectorAll('.cp-palette-item').forEach((el) => el.addEventListener('click', () => runPalette(Number(el.dataset.i))));
    }
    function runPalette(i) { const it = paletteItems($('paletteInput').value)[i]; closePalette(); if (it) it.run(); }
    function openPalette() { if (!me) return; paletteSel = 0; $('paletteInput').value = ''; $('paletteOverlay').hidden = false; renderPalette(); $('paletteInput').focus(); }
    function closePalette() { $('paletteOverlay').hidden = true; }

    /** Pointer-following light on the glass. Cheap: two CSS vars per surface. */
    function armSpotlight() {
        document.addEventListener('pointermove', (ev) => {
            const el = ev.target.closest('.cp-tile, .cp-panel, .cp-pitch');
            if (!el) return;
            const r = el.getBoundingClientRect();
            el.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100).toFixed(1) + '%');
            el.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100).toFixed(1) + '%');
        }, { passive: true });
    }
    /** The hero field moves slower than the page. */
    function armParallax() {
        if (reduced) return;
        let raf = 0;
        const apply = () => { raf = 0; const h = $('hero'); if (h) h.style.setProperty('--cp-scroll', String(Math.min(window.scrollY, 600))); };
        window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    }

    function openDrawer(kind, title, html) { $('drawerKind').textContent = kind; $('drawerTitle').textContent = title; $('drawerBody').innerHTML = html; $('drawer').hidden = false; $('drawerOverlay').hidden = false; }
    function closeDrawer() { $('drawer').hidden = true; $('drawerOverlay').hidden = true; }

    // ── wiring ──────────────────────────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', async () => {
        $('loginForm').addEventListener('submit', login);
        $('togglePassword').addEventListener('click', () => {
            const input = $('password'); input.type = input.type === 'password' ? 'text' : 'password';
        });
        $('logoutBtn').addEventListener('click', () => signOut(false));
        const accountBtn = $('accountBtn'), accountMenu = $('accountMenu');
        const setMenu = (open) => { accountMenu.hidden = !open; accountBtn.setAttribute('aria-expanded', String(open)); };
        accountBtn.addEventListener('click', (ev) => { ev.stopPropagation(); setMenu(accountMenu.hidden); });
        document.addEventListener('click', (ev) => { if (!accountMenu.hidden && !ev.target.closest('.cp-nav-user')) setMenu(false); });
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !accountMenu.hidden) setMenu(false); });
        $('drawerClose').addEventListener('click', closeDrawer);
        $('drawerOverlay').addEventListener('click', closeDrawer);
        document.querySelectorAll('.cp-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
        document.querySelectorAll('[data-invoice-filter]').forEach((b) => b.addEventListener('click', () => {
            invoiceFilter = b.dataset.invoiceFilter;
            document.querySelectorAll('[data-invoice-filter]').forEach((x) => x.classList.toggle('on', x === b));
            loadInvoices();
        }));
        $('stmtRun').addEventListener('click', loadStatement);
        $('tdsRun').addEventListener('click', loadTds);
        document.addEventListener('click', (ev) => { const t = ev.target.closest('[data-goto-tab]'); if (t) switchTab(t.dataset.gotoTab); });
        armSpotlight(); armParallax();
        $('paletteBtn').addEventListener('click', openPalette);
        $('paletteOverlay').addEventListener('click', (ev) => { if (ev.target === $('paletteOverlay')) closePalette(); });
        $('paletteInput').addEventListener('input', () => { paletteSel = 0; renderPalette(); });
        $('paletteInput').addEventListener('keydown', (ev) => {
            const n = paletteItems($('paletteInput').value).length;
            if (ev.key === 'ArrowDown') { ev.preventDefault(); paletteSel = (paletteSel + 1) % Math.max(1, n); renderPalette(); }
            else if (ev.key === 'ArrowUp') { ev.preventDefault(); paletteSel = (paletteSel - 1 + Math.max(1, n)) % Math.max(1, n); renderPalette(); }
            else if (ev.key === 'Enter') { ev.preventDefault(); runPalette(paletteSel); }
        });
        document.addEventListener('keydown', (ev) => {
            if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if ($('paletteOverlay').hidden) openPalette(); else closePalette(); }
        });
        document.addEventListener('click', (ev) => {
            const t = ev.target.closest('[data-open-invoice],[data-open-quote],[data-pdf-invoice],[data-pdf-quote],[data-preview]');
            if (!t) return;
            if (t.dataset.preview) previewPdf(t.dataset.preview, t.dataset.id, t.dataset.name, t);
            else if (t.dataset.openInvoice) openInvoice(t.dataset.openInvoice);
            else if (t.dataset.openQuote) openQuote(t.dataset.openQuote);
            else if (t.dataset.pdfInvoice) downloadPdf('invoices', t.dataset.pdfInvoice, t.dataset.name, t);
            else if (t.dataset.pdfQuote) downloadPdf('proforma-invoices', t.dataset.pdfQuote, t.dataset.name, t);
        });
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { if (!$('paletteOverlay').hidden) closePalette(); else closeDrawer(); } });

        if (!tenantId) $('loginTenantMissing').hidden = false;
        if (token && tenantId) {
            try { await boot(); return; } catch (_) { /* fall through to login */ }
        }
        show('login');
    });
})();
