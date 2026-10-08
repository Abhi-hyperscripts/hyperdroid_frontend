/**
 * E-kart Inquiries — the rep's inbox for carts clients submit through their catalogue link.
 * ========================================================================================
 *
 * ⭐ WHY THIS PAGE EXISTS. Submissions worked from day one and were invisible. A client's cart became
 * a deal, its line items, an inquiry row and a timeline activity — and nothing in the product listed
 * them. The only place the destination was ever named was one sentence inside the issue-access modal,
 * shown once, at the moment the login was created: "Their submissions will appear as deals tagged
 * ekart-inquiry." Months later, during a live demo to a client, the reps watched that client submit a
 * cart and could not say where it had gone. It was a ₹0 card among forty on the pipeline board.
 *
 * Two lists, because there are two questions:
 *   Inquiries   — what came in, newest first, and whether anybody has priced it yet.
 *   Logins      — who can see our catalogue. Previously unanswerable: a credential was reachable only
 *                 from the single lead or contact it hangs off, so nobody could enumerate them.
 *
 * Both are scope-filtered on the SERVER (the deal's owner/team for inquiries, the anchor's for
 * logins), so this file never decides who may see what.
 */
(function () {
    'use strict';

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const state = { tab: 'inquiries', awaitingOnly: false, includeRevoked: false, portalUrl: '' };

    function when(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d)) return '—';
        const mins = Math.round((Date.now() - d.getTime()) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
        if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)}d ago`;
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    // ---------- inquiries ----------

    async function loadInquiries() {
        const host = document.getElementById('ekiList');
        if (!host) return;
        host.innerHTML = '<div class="eki-empty">Loading…</div>';
        try {
            const q = state.awaitingOnly ? '?awaiting=true' : '';
            const res = await api.request(`/crm/ekart-access/inquiries${q}`);
            const rows = res?.inquiries || [];
            const count = document.getElementById('ekiCount');
            if (count) count.textContent = rows.length === 0 ? '' : `${res.total} total`;
            if (rows.length === 0) {
                host.innerHTML = `<div class="eki-empty">
                    <strong>No inquiries ${state.awaitingOnly ? 'waiting to be priced' : 'yet'}.</strong>
                    <p>When a client submits a cart from their catalogue link it lands here, and the rep who
                    owns the relationship gets a notification.</p>
                </div>`;
                return;
            }
            host.innerHTML = rows.map(renderInquiry).join('');
        } catch (e) {
            host.innerHTML = `<div class="eki-empty">Could not load inquiries. ${esc(e?.message || '')}</div>`;
        }
    }

    function renderInquiry(r) {
        // The two states worth shouting about, in the order the rep acts on them.
        const flags = [];
        if (r.lines_awaiting_price > 0)
            flags.push(`<span class="eki-flag eki-flag-warn">${r.lines_awaiting_price} line${r.lines_awaiting_price === 1 ? '' : 's'} unpriced</span>`);
        if (r.needs_company)
            // Pricing refuses every line naming a catalogue product when the deal has no company. Saying
            // so here is the whole point — the alternative is the rep opening the deal, promising the
            // client a quote, and only then being refused.
            flags.push('<span class="eki-flag eki-flag-block">Attach a company before pricing</span>');
        if (!r.deal_name)
            flags.push('<span class="eki-flag eki-flag-muted">Deal removed</span>');

        const anchor = r.contact_id
            ? `contacts.html?contact=${encodeURIComponent(r.contact_id)}`
            : r.lead_id ? `leads.html?lead=${encodeURIComponent(r.lead_id)}` : null;

        return `<article class="eki-card">
            <div class="eki-card-main">
                <div class="eki-who">
                    <strong>${esc(r.client_name)}</strong>
                    ${r.login_id ? `<code class="eki-login">${esc(r.login_id)}</code>` : ''}
                </div>
                <div class="eki-meta">
                    ${r.line_count} item${r.line_count === 1 ? '' : 's'}
                    · ${esc(when(r.created_at))}
                    ${r.stage_name ? ` · ${esc(r.stage_name)}` : ''}
                </div>
                ${r.note ? `<p class="eki-note">“${esc(r.note)}”</p>` : ''}
                ${flags.length ? `<div class="eki-flags">${flags.join('')}</div>` : ''}
            </div>
            <div class="eki-card-actions">
                ${r.deal_name
                    // The standalone QUOTE page, not the pipeline board. Pricing is the job this card
                    // exists to start, and quote.html is the page built for it (the deal drawer is 438px
                    // wide — the total, the remove control and the whole "Choose product" button fall off
                    // the edge there). Sending the rep to the board would make them hunt for the card and
                    // then open a panel that cannot do the work.
                    ? `<a class="btn btn-sm btn-primary" href="quote.html?deal=${encodeURIComponent(r.deal_id)}">Open &amp; price</a>`
                    : ''}
                ${anchor ? `<a class="btn btn-sm btn-secondary" href="${anchor}">${r.contact_id ? 'Contact' : 'Lead'}</a>` : ''}
            </div>
        </article>`;
    }

    // ---------- logins ----------

    async function loadCredentials() {
        const host = document.getElementById('ekiCreds');
        if (!host) return;
        host.innerHTML = '<div class="eki-empty">Loading…</div>';
        try {
            const q = state.includeRevoked ? '?include_revoked=true' : '';
            const res = await api.request(`/crm/ekart-access/credentials${q}`);
            state.portalUrl = res?.portal_url || '';
            const rows = res?.credentials || [];
            if (rows.length === 0) {
                host.innerHTML = `<div class="eki-empty">
                    <strong>No catalogue logins issued.</strong>
                    <p>Open a lead or contact and use “E-kart access” to issue one.</p>
                </div>`;
                return;
            }
            host.innerHTML = rows.map(renderCredential).join('');
        } catch (e) {
            host.innerHTML = `<div class="eki-empty">Could not load logins. ${esc(e?.message || '')}</div>`;
        }
    }

    function renderCredential(c) {
        const locked = c.locked_until && new Date(c.locked_until) > new Date();
        const flags = [];
        if (c.revoked_at) flags.push('<span class="eki-flag eki-flag-muted">Revoked</span>');
        else if (locked) flags.push('<span class="eki-flag eki-flag-warn">Locked</span>');
        else if (c.active_sessions > 0) flags.push(`<span class="eki-flag eki-flag-ok">${c.active_sessions} signed in</span>`);
        // An anchor that no longer resolves. This is the only screen that shows these at all, which is
        // what makes them revocable — the lead/contact panel 404s on a removed anchor.
        if (!c.anchor_name) flags.push('<span class="eki-flag eki-flag-block">Anchor removed</span>');

        const anchor = c.anchor_kind === 'contact' && c.contact_id
            ? `contacts.html?contact=${encodeURIComponent(c.contact_id)}`
            : c.lead_id ? `leads.html?lead=${encodeURIComponent(c.lead_id)}` : null;

        return `<article class="eki-card">
            <div class="eki-card-main">
                <div class="eki-who">
                    <strong>${esc(c.display_name || c.anchor_name || '(unnamed)')}</strong>
                    <code class="eki-login">${esc(c.login_id)}</code>
                </div>
                <div class="eki-meta">
                    Issued ${esc(when(c.created_at))}
                    · ${c.inquiry_count} inquir${c.inquiry_count === 1 ? 'y' : 'ies'}
                    ${c.last_inquiry_at ? ` · last ${esc(when(c.last_inquiry_at))}` : ''}
                </div>
                ${flags.length ? `<div class="eki-flags">${flags.join('')}</div>` : ''}
            </div>
            <div class="eki-card-actions">
                ${anchor ? `<a class="btn btn-sm btn-secondary" href="${anchor}">${c.anchor_kind === 'contact' ? 'Contact' : 'Lead'}</a>` : ''}
                ${c.revoked_at ? '' : `<button class="btn btn-sm btn-danger" data-revoke="${esc(c.access_id)}">Revoke</button>`}
            </div>
        </article>`;
    }

    async function revoke(accessId, btn) {
        if (!confirm('Revoke this catalogue login? The client is signed out immediately and the login stops working.')) return;
        if (btn) btn.disabled = true;
        try {
            await api.request(`/crm/ekart-access/${accessId}/revoke`, { method: 'POST' });
            window.Toast?.success('Login revoked. The client is signed out.');
            await loadCredentials();
        } catch (e) {
            window.Toast?.error(e?.message || 'Could not revoke that login.');
            if (btn) btn.disabled = false;
        }
    }

    // ---------- shell ----------

    function showTab(tab) {
        state.tab = tab;
        document.querySelectorAll('[data-eki-tab]').forEach((b) =>
            b.classList.toggle('active', b.dataset.ekiTab === tab));
        document.querySelectorAll('[data-eki-pane]').forEach((p) => {
            p.hidden = p.dataset.ekiPane !== tab;
        });
        if (tab === 'inquiries') loadInquiries(); else loadCredentials();
    }

    /**
     * Live updates. The backend sends EkartInquiryReceived to the OWNING rep only, so a toast here is
     * never somebody else's client. Without this the page is accurate only as of when it was opened —
     * and the failure being fixed is precisely a rep not learning that something arrived.
     */
    function listenForArrivals() {
        if (!window.signalR || !window.CONFIG?.crmApiBaseUrl) return;
        try {
            const hub = new signalR.HubConnectionBuilder()
                .withUrl(`${CONFIG.crmApiBaseUrl.replace(/\/api$/, '')}/hubs/crm`,
                    { accessTokenFactory: () => getAuthToken() })
                .withAutomaticReconnect()
                .build();
            hub.on('EkartInquiryReceived', (p) => {
                window.Toast?.info(`${p?.clientName || 'A client'} submitted ${p?.lineCount || 0} item(s).`);
                if (state.tab === 'inquiries') loadInquiries();
            });
            hub.start().catch(() => {});
        } catch (_) { /* the page is still correct without live updates */ }
    }

    function init() {
        document.querySelectorAll('[data-eki-tab]').forEach((b) =>
            b.addEventListener('click', () => showTab(b.dataset.ekiTab)));

        const awaiting = document.getElementById('ekiAwaitingOnly');
        awaiting?.addEventListener('change', () => { state.awaitingOnly = awaiting.checked; loadInquiries(); });

        const revoked = document.getElementById('ekiIncludeRevoked');
        revoked?.addEventListener('change', () => { state.includeRevoked = revoked.checked; loadCredentials(); });

        // Delegated, because the cards are re-rendered on every load and listeners bound to the old
        // nodes would be lost — the cloneNode/re-render trap that has made controls dead here before.
        document.addEventListener('click', (e) => {
            const b = e.target.closest('[data-revoke]');
            if (b) revoke(b.dataset.revoke, b);
        });

        showTab('inquiries');
        listenForArrivals();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.EkartInquiries = { loadInquiries, loadCredentials, showTab };
})();
