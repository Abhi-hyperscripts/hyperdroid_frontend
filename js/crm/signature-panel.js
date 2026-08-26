/**
 * Signatures panel — send a quote or a document for signature, and watch it.
 * ----------------------------------------------------------------------------
 *   GET  /crm/signature-requests?lead_id=|deal_id=   list, with audit trails
 *   POST /crm/signature-requests                     send one, returns the link
 *   POST /crm/signature-requests/{id}/cancel         withdraw
 *
 * Usage: SignaturePanel.mount(document.getElementById('dealSignaturesPanel'), 'deal', dealId);
 *
 * ⭐ THE LINK IS SHOWN ONCE. The server keeps only a hash of the token, so the
 * response to the create call is the only time the URL exists. This panel makes
 * that plain rather than letting a rep close the dialog and go looking for it.
 *
 * Responses are snake_case (the API's SnakeCaseLower policy).
 */
const SignaturePanel = (() => {
    'use strict';

    // QUOTE-SAFE on purpose: escaped values are interpolated into
    // double-quoted attributes (data-id="…"), and an escaper that leaves " and
    // ' alone lets a signer name break out of one.
    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new Map();

    const STATUS_LABEL = {
        sent: 'Sent', viewed: 'Opened', signed: 'Signed',
        declined: 'Declined', cancelled: 'Withdrawn', expired: 'Expired',
    };

    const EVENT_LABEL = {
        created: 'Sent for signature', viewed: 'Opened by the signer',
        signed: 'Signed', declined: 'Declined', cancelled: 'Withdrawn',
    };

    function fmtDate(value, withTime) {
        if (!value) return '';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '';
        const opts = withTime
            ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { day: 'numeric', month: 'short', year: 'numeric' };
        return d.toLocaleString(undefined, opts);
    }

    // ─── render ─────────────────────────────────────────────────────────────

    function requestRow(r) {
        const status = r.status || 'sent';
        const trail = Array.isArray(r.trail) ? r.trail : [];

        // Only an OPEN request can be withdrawn — the same rule the server
        // enforces, asked the same way, so the button cannot offer something
        // the server will refuse.
        const canCancel = status === 'sent' || status === 'viewed';

        return `
        <div class="sigp-row" data-sig-id="${esc(r.id)}">
            <div class="sigp-main">
                <div class="sigp-head">
                    <span class="sigp-title">${esc(r.title)}</span>
                    <span class="sigp-badge sigp-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>
                </div>
                <div class="sigp-meta">
                    <span>${esc(r.signer_name)}</span>
                    ${r.signer_email ? `<span>${esc(r.signer_email)}</span>` : ''}
                    ${r.signer_phone ? `<span>${esc(r.signer_phone)}</span>` : ''}
                    <span>${esc(r.kind === 'quote' ? 'Quote' : 'Document')}</span>
                </div>
                ${status === 'signed'
                    ? `<div class="sigp-line sigp-good">Signed ${esc(fmtDate(r.signed_at, true))}</div>`
                    : status === 'declined'
                        ? `<div class="sigp-line sigp-bad">Declined ${esc(fmtDate(r.declined_at, true))}${
                            r.decline_reason ? ` — “${esc(r.decline_reason)}”` : ''}</div>`
                        : status === 'expired'
                            ? `<div class="sigp-line">Expired ${esc(fmtDate(r.expires_at))}</div>`
                            : `<div class="sigp-line">Open until ${esc(fmtDate(r.expires_at))}</div>`}
                <details class="sigp-trail">
                    <summary>Audit trail (${trail.length})</summary>
                    <ol>
                        ${trail.map((e) => `
                            <li>
                                <b>${esc(EVENT_LABEL[e.event] || e.event)}</b>
                                <span>${esc(fmtDate(e.occurred_at, true))}</span>
                                ${e.ip ? `<span>from ${esc(e.ip)}</span>` : ''}
                                ${e.detail ? `<span>${esc(e.detail)}</span>` : ''}
                            </li>`).join('')}
                    </ol>
                    <p class="sigp-hash">Document fingerprint <code>${esc(String(r.content_hash || '').slice(0, 16))}…</code></p>
                </details>
            </div>
            ${canCancel
                ? `<button type="button" class="sigp-cancel" data-sig-cancel="${esc(r.id)}">Withdraw</button>`
                : ''}
        </div>`;
    }

    function render(container) {
        const st = mounted.get(container);
        if (!st) return;

        // ⭐⭐⭐ "COULD NOT LOAD" AND "NOTHING HERE" MUST NOT LOOK THE SAME.
        //
        // The catch blanked the list and rendered, which is exactly what a
        // record with no requests renders. So a failed request told the rep
        // "nothing has been sent for signature" — and the natural next action is
        // to send another one, duplicating a live signing link the rep cannot
        // see. Saying so, and offering the retry, is the whole fix.
        const rows = st.loadFailed
            ? `<p class="sigp-empty sigp-failed">
                   These could not be loaded, so this list is not the whole picture.
                   <button type="button" class="sigp-quiet" data-sig-retry>Try again</button>
               </p>`
            : st.requests.length
                ? st.requests.map(requestRow).join('')
                : `<p class="sigp-empty">Nothing has been sent for signature yet.</p>`;

        container.innerHTML = `
        <div class="sigp">
            <div class="sigp-bar">
                <h4 class="sigp-h">Signatures</h4>
                ${st.formOpen || st.loadFailed
                    ? ''
                    : `<button type="button" class="sigp-send" data-sig-new${st.sending ? ' disabled' : ''}>
                           ${st.sending ? 'Creating…' : 'Send for signature'}
                       </button>`}
            </div>
            <details class="crm-help crm-help-sm"${st.helpOpen ? ' open' : ''}>
                <summary>What is this? — Signatures</summary>
                <div class="crm-help-body">
                    <p>Send the quote, or a document you have already attached, to the customer to sign
                       online. They get a link, open it on any device, and sign — no printing.</p>
                    <p><em>What they sign is frozen when you send it. If you change the deal's lines
                       afterwards, the signature still proves what was agreed, but the deal stops
                       counting as accepted — because the quote they signed is no longer this one.</em></p>
                </div>
            </details>
            ${st.formOpen ? sendForm(st) : ''}
            <div class="sigp-list">${rows}</div>
        </div>`;

        // The picker is a component, so it can only be built once its host is
        // in the document — which is now, not while the string was being made.
        if (st.formOpen) mountDocumentPicker(container, st);
    }

    // ─── data ───────────────────────────────────────────────────────────────

    async function load(container) {
        const st = mounted.get(container);
        if (!st) return;
        try {
            const q = st.entityType === 'deal' ? `deal_id=${encodeURIComponent(st.entityId)}`
                                               : `lead_id=${encodeURIComponent(st.entityId)}`;
            st.requests = await api.request(`/crm/signature-requests?${q}`) || [];
            st.loadFailed = false;
        } catch (e) {
            console.error('Failed to load signature requests:', e);
            st.requests = [];
            st.loadFailed = true;
        }
        render(container);
    }

    // ─── actions ────────────────────────────────────────────────────────────

    /**
     * The send form, rendered INLINE rather than in a dialog.
     *
     * There is no generic form-modal in this codebase — Confirm and Prompt take
     * a message and give back a boolean or a string, and building a modal
     * framework to ask five questions would be a worse trade than showing the
     * five questions. It also keeps the record visible behind the form, which
     * is what the rep is checking against while they fill it in.
     */
    function sendForm(st) {
        // A quote can only be signed on a deal — a lead has no lines. Offering
        // it on a lead would produce a refusal the rep cannot act on.
        const kindRow = st.entityType === 'deal'
            ? `<label class="sigp-f">
                   <span>What should they sign?</span>
                   <span class="sigp-radios">
                       <label><input type="radio" name="sigKind" value="quote" checked> The quote</label>
                       <label><input type="radio" name="sigKind" value="document"> A document</label>
                   </span>
               </label>`
            : `<input type="hidden" id="sigKindFixed" value="document">`;

        return `
        <form class="sigp-form" data-sig-form>
            ${kindRow}
            <label class="sigp-f" data-sig-doc-field${st.entityType === 'deal' ? ' hidden' : ''}>
                <span>Which document?</span>
                <span data-sig-doc-host>
                    ${st.documents.length
                        ? '<span data-sig-doc-mount></span>'
                        : `<em class="sigp-note">Attach a document to this record first.</em>`}
                </span>
            </label>
            <label class="sigp-f">
                <span>Who is signing?</span>
                <input type="text" id="sigSignerName" maxlength="200" required
                       placeholder="Their full name">
            </label>
            <label class="sigp-f">
                <span>Their email</span>
                <input type="email" id="sigSignerEmail" maxlength="320" placeholder="name@example.com">
            </label>
            <label class="sigp-f">
                <span>Their phone</span>
                <input type="tel" id="sigSignerPhone" maxlength="40" placeholder="+91 …">
            </label>
            <p class="sigp-note">An email address or a phone number — we need at least one, so the
               link can be sent.</p>
            <label class="sigp-f">
                <span>Link stays open for</span>
                <input type="number" id="sigExpiryDays" value="14" min="1" max="90"> days
            </label>
            <div class="sigp-form-actions">
                <button type="submit" class="sigp-send">Create signing link</button>
                <button type="button" class="sigp-quiet" data-sig-cancel-form>Cancel</button>
            </div>
        </form>`;
    }

    /**
     * Never a native <select> — codebase convention. SearchableDropdown IS the
     * component (constructed, not called through a factory); when it is
     * unavailable we degrade to a radio list rather than leaving the rep unable
     * to choose, because the API validates the id either way.
     */
    function mountDocumentPicker(container, st) {
        const host = container.querySelector('[data-sig-doc-mount]');
        if (!host || !st.documents.length) return;

        // Default to the first, so a rep who never touches the picker still
        // sends something rather than meeting a refusal.
        st.documentId = st.documents[0].id;

        if (typeof SearchableDropdown === 'function') {
            st.docDropdown = new SearchableDropdown(host, {
                options: st.documents.map((d) => ({
                    value: d.id,
                    label: d.file_name,
                    description: d.doc_type ? String(d.doc_type).replace(/_/g, ' ') : '',
                })),
                placeholder: 'Which document?',
                searchPlaceholder: 'Search documents…',
                compact: true,
                onChange: (value) => { st.documentId = value; },
            });
        } else {
            host.innerHTML = st.documents.map((d, i) =>
                `<label class="sigp-doc-opt">
                     <input type="radio" name="sigDoc" value="${esc(d.id)}"${i === 0 ? ' checked' : ''}>
                     ${esc(d.file_name)}
                 </label>`).join('');
            host.addEventListener('change', (e) => {
                if (e.target.name === 'sigDoc') st.documentId = e.target.value;
            });
        }
    }

    function chosenKind(container, st) {
        if (st.entityType !== 'deal') return 'document';
        const picked = container.querySelector('input[name="sigKind"]:checked');
        return picked ? picked.value : 'quote';
    }

    async function submitSendForm(container) {
        const st = mounted.get(container);
        if (!st || st.sending) return;

        const kind = chosenKind(container, st);
        const name = (container.querySelector('#sigSignerName')?.value || '').trim();
        const email = (container.querySelector('#sigSignerEmail')?.value || '').trim();
        const phone = (container.querySelector('#sigSignerPhone')?.value || '').trim();
        const days = Number(container.querySelector('#sigExpiryDays')?.value) || 14;
        const documentId = st.documentId || null;

        // Asked here as well as by the server, because the server's refusal
        // costs a round trip and the rep has to retype nothing to fix it.
        if (!name) { Toast.error('Who is signing? A signature needs a name against it.'); return; }
        if (!email && !phone) { Toast.error('Add an email address or a phone number.'); return; }
        if (kind === 'document' && !documentId) {
            Toast.error('Attach a document to this record first, then send it for signature.');
            return;
        }

        const body = {
            kind,
            signer_name: name,
            signer_email: email || null,
            signer_phone: phone || null,
            expires_in_days: days,
        };
        if (st.entityType === 'deal') body.deal_id = st.entityId; else body.lead_id = st.entityId;
        if (kind === 'document') body.document_id = documentId;

        // ⭐⭐⭐ A REFUSAL MUST NOT WIPE WHAT THEY TYPED.
        //
        // This called render() to reflect the sending state, and render()
        // rebuilds the form from scratch — so the moment Create was pressed the
        // fields blanked, and a server refusal ("this deal has no lines yet")
        // left the rep looking at an empty form with no idea what had been in
        // it. They then retype four fields to hit the same refusal.
        //
        // The submit button is therefore driven DIRECTLY, and nothing
        // re-renders until the save has actually succeeded. That is the exact
        // opposite of the rule for the SAVE button on the line-items panel — and
        // deliberately so. There, the button lives among rows that re-render on
        // every keystroke, so a DOM-held flag was lost and the state had to own
        // it. Here nothing re-renders while the form is open, so touching the
        // DOM is safe and re-rendering is the thing that does harm.
        st.sending = true;
        const submit = container.querySelector('[data-sig-form] button[type="submit"]');
        if (submit) { submit.disabled = true; submit.textContent = 'Creating…'; }

        try {
            const created = await api.request('/crm/signature-requests', {
                method: 'POST', body: JSON.stringify(body),
            });
            st.sending = false;
            st.formOpen = false;
            await load(container);
            showLink(created);
        } catch (e) {
            // Re-enable in place. The form keeps every value, so correcting one
            // field and pressing Create again is all it takes.
            st.sending = false;
            if (submit) { submit.disabled = false; submit.textContent = 'Create signing link'; }
            Toast.error(e.message || 'Could not create the signing link');
        }
    }

    async function openSendForm(container) {
        const st = mounted.get(container);
        if (!st) return;

        // Loaded before the form opens so the document picker is never empty
        // for a moment and then populated under the rep's cursor.
        try {
            const q = st.entityType === 'deal' ? `deal_id=${encodeURIComponent(st.entityId)}`
                                               : `lead_id=${encodeURIComponent(st.entityId)}`;
            st.documents = await api.request(`/crm/entity-documents?${q}`) || [];
        } catch (e) {
            // Same rule as the list above: an empty picker would read as "this
            // record has no documents", which is a different untruth with the
            // same cause.
            console.error('Could not load documents:', e);
            st.documents = [];
            Toast.error('Could not load this record\'s documents. Try again in a moment.');
            return;
        }

        st.formOpen = true;
        render(container);
    }

    /**
     * ⭐ SHOWN ONCE, AND SAID SO.
     *
     * Only a hash of the token is stored, so this URL cannot be looked up
     * again — by us or by anyone who reaches the database. A rep who closes
     * this without copying it has to send a new request, which is the right
     * outcome but a bad surprise, so this is explicit about it.
     */
    function showLink(created) {
        const url = created && created.signing_url;
        if (!url) { Toast.success('Signature request created'); return; }

        const st = { url };
        // Copied for them, so the common path needs no instruction at all. The
        // link is rendered as well, because clipboard access is refused often
        // enough that "we copied it" cannot be the only way to get at it.
        navigator.clipboard?.writeText(url).then(
            () => Toast.success('Signing link copied to your clipboard'),
            () => Toast.info('Copy the signing link from the panel below'));

        Confirm.show({
            title: 'Signing link ready',
            message: `Send this to ${created.signer_name}:\n\n${url}\n\n`
                   + 'This link is shown once — we keep only a fingerprint of it, so it cannot be '
                   + 'recovered later. Copy it now, or send a new request.',
            type: 'success',
            confirmText: 'Done',
            showCancel: false,
        });
        return st;
    }

    async function cancelRequest(container, id) {
        const ok = await Confirm.show({
            title: 'Withdraw this request?',
            message: 'The link stops working immediately. If they have already opened it, they will '
                   + 'see that it was withdrawn.',
            type: 'warning',
            confirmText: 'Withdraw',
        });
        if (!ok) return;

        try {
            await api.request(`/crm/signature-requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
            Toast.success('Request withdrawn');
            await load(container);
        } catch (e) {
            Toast.error(e.message || 'Could not withdraw the request');
        }
    }

    // ─── mount ──────────────────────────────────────────────────────────────

    function mount(container, entityType, entityId) {
        if (!container) return;

        mounted.set(container, {
            entityType, entityId, requests: [], helpOpen: false, loadFailed: false,
            formOpen: false, sending: false, documents: [], documentId: null,
        });

        // Delegated, so a re-render cannot leave a live listener on a node that
        // is no longer in the document.
        container.addEventListener('click', (evt) => {
            const cancel = evt.target.closest('[data-sig-cancel]');
            if (cancel) { cancelRequest(container, cancel.getAttribute('data-sig-cancel')); return; }
            if (evt.target.closest('[data-sig-retry]')) { load(container); return; }
            if (evt.target.closest('[data-sig-new]')) { openSendForm(container); return; }
            if (evt.target.closest('[data-sig-cancel-form]')) {
                const st = mounted.get(container);
                if (st) { st.formOpen = false; render(container); }
            }
        });

        // Submit rather than click, so Enter in a field works the way it does
        // in every other form on the page.
        container.addEventListener('submit', (evt) => {
            if (!evt.target.matches('[data-sig-form]')) return;
            evt.preventDefault();
            submitSendForm(container);
        });

        // Switching between "the quote" and "a document" shows or hides the
        // picker directly rather than re-rendering, which would discard whatever
        // the rep has already typed into the other fields.
        container.addEventListener('change', (evt) => {
            if (evt.target.name !== 'sigKind') return;
            const field = container.querySelector('[data-sig-doc-field]');
            if (field) field.hidden = evt.target.value !== 'document';
        });

        container.addEventListener('toggle', (evt) => {
            const st = mounted.get(container);
            if (st && evt.target.matches('.crm-help')) st.helpOpen = evt.target.open;
        }, true);

        render(container);
        load(container);
    }

    function unmount(container) { mounted.delete(container); }

    return { mount, unmount, reload: load };
})();
