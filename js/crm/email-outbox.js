/**
 * Email outbox — what was sent from a connected mailbox, and what came back
 * ----------------------------------------------------------------------------
 * The backend has recorded every send and every reply since mailboxes shipped.
 * Nothing displayed either one outside a single lead's timeline, so a rep could
 * not answer "did anyone reply to anything I sent this week?" without opening
 * leads one at a time.
 *
 *   GET /api/mailbox-send/history?limit=&offset=      the outbox
 *   GET /api/mailbox-send/history/{sendId}/replies    replies to one send
 *   GET /api/mailbox-send/{mailboxId}/replies?messageId=
 *                                                     live IMAP/Graph probe,
 *                                                     used only when the poller
 *                                                     has not caught up yet
 *
 * Scoping is the backend's job: a CRM_USER sees their own sends plus anything
 * sent from a tenant-shared mailbox; SUPERADMIN sees the tenant. Nothing here
 * filters by user — doing so client-side would be a lie either way.
 *
 * Responses are snake_case (SnakeCaseLower), including the anonymous objects
 * the live-probe endpoint returns: `messageId` on the server is `message_id`
 * on the wire.
 */
const EmailOutbox = (() => {
    'use strict';

    const PAGE = 25;

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    function when(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const mins = Math.round((Date.now() - d.getTime()) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.round(hrs / 24);
        if (days < 30) return `${days}d ago`;
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    const exact = (iso) => {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('en-IN',
            { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    // Status straight off the row. 'sent' is the default the DB writes, so a
    // row with no explicit failure is genuinely a successful handoff to the
    // provider — not an assumption.
    function statusChip(s) {
        const v = String(s.status || 'sent').toLowerCase();
        if (s.replied_at) return '<span class="obx-chip obx-chip-replied">Replied</span>';
        if (v === 'bounced') return '<span class="obx-chip obx-chip-bounced">Bounced</span>';
        if (v === 'failed') return '<span class="obx-chip obx-chip-bounced">Failed</span>';
        if (v === 'queued' || v === 'pending') return '<span class="obx-chip obx-chip-pending">Queued</span>';
        return '<span class="obx-chip obx-chip-sent">Sent</span>';
    }

    function shell() {
        return `
        <div class="obx">
            <div class="obx-head">
                <div>
                    <h3 class="obx-title">Email outbox</h3>
                    <p class="obx-sub">Every email sent from a connected mailbox, and the replies that came back.</p>
                </div>
                <div class="obx-head-right">
                    <span class="obx-count" data-obx="count"></span>
                    <button type="button" class="btn btn-sm btn-outline" data-obx="refresh">Refresh</button>
                </div>
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Email outbox</summary>
                <div class="crm-help-body">
                    <p>Emails sent from the CRM — from a lead, a campaign, or a sequence step. Click any
                       row to read the replies it received.</p>
                    <p>Replies are collected by a background poller, so one can take a few minutes to
                       appear. <strong>Check now</strong> asks the mail server directly instead of waiting.</p>
                    <p><em>You see your own sends plus anything sent from a shared mailbox. Admins see
                       the whole tenant.</em></p>
                </div>
            </details>

            <div data-obx="list" class="obx-list"></div>
            <div class="obx-foot">
                <button type="button" class="btn btn-sm btn-outline" data-obx="more" hidden>Load more</button>
            </div>
        </div>`;
    }

    function rowMarkup(s) {
        const id = esc(s.id);
        const replies = Number(s.reply_count || 0);
        return `
        <article class="obx-row${replies ? ' has-replies' : ''}" data-send-id="${id}">
            <button type="button" class="obx-row-main" data-obx="toggle" data-id="${id}"
                    aria-expanded="false">
                <span class="obx-row-top">
                    <span class="obx-to">${esc(s.to_email)}</span>
                    ${statusChip(s)}
                    ${replies ? `<span class="obx-replies">${replies} ${replies === 1 ? 'reply' : 'replies'}</span>` : ''}
                </span>
                <span class="obx-subject">${esc(s.subject || '(no subject)')}</span>
                ${s.body_preview ? `<span class="obx-preview">${esc(s.body_preview)}</span>` : ''}
                <span class="obx-when" title="${esc(exact(s.sent_at))}">${esc(when(s.sent_at))} · ${esc(exact(s.sent_at))}</span>
            </button>
            <div class="obx-thread" data-obx-thread="${id}" hidden></div>
        </article>`;
    }

    function render(container) {
        const st = mounted.get(container);
        const list = container.querySelector('[data-obx="list"]');
        const count = container.querySelector('[data-obx="count"]');
        const more = container.querySelector('[data-obx="more"]');

        count.textContent = st.sends.length
            ? `${st.sends.length} sent${st.exhausted ? '' : '+'}`
            : '';
        list.innerHTML = st.sends.length
            ? st.sends.map(rowMarkup).join('')
            : `<p class="obx-empty">Nothing sent yet. Email a lead from their detail panel, or run a
                 campaign — every send lands here with its replies.</p>`;
        more.hidden = st.exhausted || !st.sends.length;
    }

    async function load(container, { append = false } = {}) {
        const st = mounted.get(container);
        if (st.loading) return;
        st.loading = true;
        const list = container.querySelector('[data-obx="list"]');
        if (!append) list.innerHTML = '<p class="obx-loading">Loading…</p>';

        try {
            const offset = append ? st.sends.length : 0;
            const res = await api.request(`/crm/mailbox-send/history?limit=${PAGE}&offset=${offset}`);
            const items = Array.isArray(res) ? res : (res?.items || []);
            st.sends = append ? st.sends.concat(items) : items;
            st.exhausted = items.length < PAGE;
        } catch (e) {
            console.error('Failed to load outbox:', e);
            list.innerHTML = `<p class="obx-empty">Could not load the outbox. ${esc(e.message || '')}</p>`;
            st.loading = false;
            return;
        }
        st.loading = false;
        render(container);
    }

    function replyMarkup(r) {
        // text_body_clean has the quoted original stripped; fall back to the raw
        // body so a reply the cleaner could not parse still shows something.
        const body = r.text_body_clean || r.text_body || '';
        return `
        <div class="obx-reply">
            <div class="obx-reply-head">
                <strong>${esc(r.from_address)}</strong>
                <span class="obx-reply-when" title="${esc(exact(r.received_at))}">${esc(when(r.received_at))}</span>
            </div>
            ${r.subject ? `<div class="obx-reply-subject">${esc(r.subject)}</div>` : ''}
            <div class="obx-reply-body">${body ? esc(body) : '<em>No text body on this reply.</em>'}</div>
        </div>`;
    }

    async function toggle(container, sendId) {
        const st = mounted.get(container);
        const row = container.querySelector(`[data-send-id="${CSS.escape(sendId)}"]`);
        const thread = container.querySelector(`[data-obx-thread="${CSS.escape(sendId)}"]`);
        const btn = row?.querySelector('[data-obx="toggle"]');
        if (!thread) return;

        if (!thread.hidden) {
            thread.hidden = true;
            btn?.setAttribute('aria-expanded', 'false');
            return;
        }
        thread.hidden = false;
        btn?.setAttribute('aria-expanded', 'true');

        if (st.threads[sendId]) { paintThread(container, sendId); return; }

        thread.innerHTML = '<p class="obx-loading">Loading replies…</p>';
        try {
            const res = await api.request(`/crm/mailbox-send/history/${encodeURIComponent(sendId)}/replies`);
            st.threads[sendId] = Array.isArray(res) ? res : (res?.replies || []);
        } catch (e) {
            console.error('Failed to load replies:', e);
            thread.innerHTML = `<p class="obx-empty">Could not load replies. ${esc(e.message || '')}</p>`;
            return;
        }
        paintThread(container, sendId);
    }

    function paintThread(container, sendId) {
        const st = mounted.get(container);
        const thread = container.querySelector(`[data-obx-thread="${CSS.escape(sendId)}"]`);
        const replies = st.threads[sendId] || [];
        const send = st.sends.find(s => s.id === sendId);
        const probe = send
            ? `<button type="button" class="btn btn-sm btn-outline obx-probe"
                       data-obx="probe" data-id="${esc(sendId)}">Check now</button>`
            : '';
        thread.innerHTML = replies.length
            ? replies.map(replyMarkup).join('') +
              `<div class="obx-thread-foot">${probe}</div>`
            : `<p class="obx-empty obx-empty-thread">No reply yet.
                 The poller checks every few minutes. ${probe}</p>`;
    }

    // Live probe — asks the mail server itself rather than the replies table.
    // Only worth offering because the poller runs on an interval: a reply that
    // arrived thirty seconds ago is genuinely on the server and not yet in our
    // DB, and this is the only way to see it now.
    async function probe(container, sendId) {
        const st = mounted.get(container);
        const send = st.sends.find(s => s.id === sendId);
        if (!send) return;
        const thread = container.querySelector(`[data-obx-thread="${CSS.escape(sendId)}"]`);
        thread.innerHTML = '<p class="obx-loading">Asking the mail server…</p>';
        try {
            const res = await api.request(
                `/crm/mailbox-send/${encodeURIComponent(send.mailbox_id)}/replies` +
                `?messageId=${encodeURIComponent(send.message_id)}`);
            const live = (res?.replies || []).map(r => ({
                from_address: r.from,
                subject: r.subject,
                text_body_clean: r.text_body_clean,
                text_body: r.text_body,
                received_at: r.date
            }));
            if (!live.length) {
                thread.innerHTML = `<p class="obx-empty obx-empty-thread">Still nothing on the server.
                    <button type="button" class="btn btn-sm btn-outline obx-probe"
                            data-obx="probe" data-id="${esc(sendId)}">Check again</button></p>`;
                return;
            }
            st.threads[sendId] = live;
            paintThread(container, sendId);
            if (typeof Toast !== 'undefined') {
                Toast.success(`${live.length} ${live.length === 1 ? 'reply' : 'replies'} found on the server`);
            }
        } catch (e) {
            console.error('Live reply probe failed:', e);
            // Both failure modes here are ordinary, not faults: a send-only
            // SMTP mailbox has no adapter that can read (501), and a mailbox
            // disconnected after the send is simply gone (404). Neither is
            // worth the word "error", and neither should strand the user
            // without a retry, so the button is re-offered every time.
            const s = String(e.status ?? e.message ?? '');
            const msg = /501/.test(s)
                ? 'This mailbox cannot be checked live — it sends only. Replies still arrive via the poller.'
                : /404/.test(s)
                    ? 'That mailbox is no longer connected, so the server cannot be checked. Replies already collected are still shown.'
                    : `Could not reach the mail server. ${e.message || ''}`;
            thread.innerHTML = `<p class="obx-empty obx-empty-thread">${esc(msg)}
                <button type="button" class="btn btn-sm btn-outline obx-probe"
                        data-obx="probe" data-id="${esc(sendId)}">Try again</button></p>`;
        }
    }

    function mount(container) {
        if (!container) return;
        const prev = mounted.get(container);
        mounted.set(container, {
            sends: [], threads: {}, exhausted: false, loading: false,
            bound: prev ? prev.bound : false
        });
        container.innerHTML = shell();

        // Bind once — the settings tab re-mounts this on every switch, and a
        // second listener would double every fetch it triggers.
        if (mounted.get(container).bound) { load(container); return; }
        mounted.get(container).bound = true;

        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-obx]');
            if (!btn) return;
            switch (btn.getAttribute('data-obx')) {
                case 'toggle':  return toggle(container, btn.getAttribute('data-id'));
                case 'probe':   e.stopPropagation(); return probe(container, btn.getAttribute('data-id'));
                case 'refresh': return load(container);
                case 'more':    return load(container, { append: true });
            }
        });

        load(container);
    }

    return { mount, reload: load };
})();
