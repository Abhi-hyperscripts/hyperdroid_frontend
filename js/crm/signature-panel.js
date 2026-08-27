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
            <div class="sigp-actions">
                ${canCancel
                    ? `<button type="button" class="sigp-cancel" data-sig-cancel="${esc(r.id)}">Withdraw</button>`
                    : ''}
                ${status === 'signed' || status === 'declined'
                    ? `<button type="button" class="sigp-view" data-sig-view="${esc(r.id)}">View signed copy</button>`
                    : ''}
                ${status === 'signed' && r.document_id && r.has_signed_document === false
                  && r.places_marked > 0 && r.signature_kind === 'drawn'
                    ? `<button type="button" class="sigp-quiet" data-sig-restamp="${esc(r.id)}"
                               title="The signature is recorded, but the stamped PDF was never produced">
                           Produce the stamped copy
                       </button>`
                    : ''}
            </div>
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
                <h4 class="sigp-h">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 17c3.5 0 3.5-10 7-10s3.5 10 7 10c1.5 0 2.5-.8 4-2"/><path d="M3 21h18"/></svg>
                    Signatures
                </h4>
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
            <div class="sigp-f" data-sig-place-row${st.entityType === 'deal' ? ' hidden' : ''}>
                <span>Where do they sign?</span>
                <span class="sigp-place-line">
                    <button type="button" class="sigp-quiet" data-sig-place>
                        ${st.fields.length ? 'Change the places' : 'Mark places on the document'}
                    </button>
                    <em class="sigp-note" data-sig-place-count>
                        ${st.fields.length
                            ? `${st.fields.length} place${st.fields.length === 1 ? '' : 's'} marked`
                            : 'Optional — without this the signature is recorded but not stamped into the file.'}
                    </em>
                </span>
            </div>
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

        // ⭐⭐⭐ A RE-RENDER MUST NOT UNDO THE REP'S CHOICE.
        //
        // This runs on EVERY render, and render() rebuilds the panel's markup —
        // so an unconditional `st.documentId = st.documents[0].id` here silently
        // threw the selection back to the first file whenever anything else
        // redrew the panel (reload() does, from the panel's own refresh path).
        // Worse than losing it: the rebuilt dropdown showed its PLACEHOLDER, so
        // the screen said "Which document?" while the state said "the first
        // one", and Send would have mailed a customer a contract nobody chose.
        //
        // So: keep the current choice if it still names a document this record
        // has, and only fall back to the first otherwise. The picker is then
        // told that value, so what is displayed and what would be sent are the
        // same fact rather than two.
        const stillPresent = st.documents.some((d) => d.id === st.documentId);
        if (!stillPresent) st.documentId = st.documents[0].id;

        if (typeof SearchableDropdown === 'function') {
            st.docDropdown = new SearchableDropdown(host, {
                options: st.documents.map((d) => ({
                    value: d.id,
                    label: d.file_name,
                    description: d.doc_type ? String(d.doc_type).replace(/_/g, ' ') : '',
                })),
                value: st.documentId,
                placeholder: 'Which document?',
                searchPlaceholder: 'Search documents…',
                compact: true,
                onChange: (value) => { st.documentId = value; },
            });
        } else {
            host.innerHTML = st.documents.map((d) =>
                `<label class="sigp-doc-opt">
                     <input type="radio" name="sigDoc" value="${esc(d.id)}"${d.id === st.documentId ? ' checked' : ''}>
                     ${esc(d.file_name)}
                 </label>`).join('');
            host.addEventListener('change', (e) => {
                if (e.target.name === 'sigDoc') st.documentId = e.target.value;
            });
        }
    }

    /**
     * Open the placement dialog for whichever document is selected.
     *
     * The bytes are fetched HERE because the dialog renders them with PDF.js,
     * which needs a URL it can read — and the authenticated download needs a
     * header a plain URL cannot carry.
     */
    async function openPlacer(container) {
        const st = mounted.get(container);
        if (!st || !st.documentId) {
            Toast.error('Choose a document first, then mark where they sign.');
            return;
        }
        if (typeof SignaturePlacer === 'undefined') {
            Toast.error('The placement view could not be loaded.');
            return;
        }

        let blobUrl;
        try {
            const base = (typeof CONFIG !== 'undefined' && CONFIG.crmApiBaseUrl) || '/api';
            const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
            const res = await fetch(
                `${base}/entity-documents/${encodeURIComponent(st.documentId)}/download`,
                { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!res.ok) throw new Error('That document could not be opened');
            blobUrl = URL.createObjectURL(await res.blob());
        } catch (e) {
            Toast.error(e.message || 'That document could not be opened');
            return;
        }

        try {
            const placed = await SignaturePlacer.open(blobUrl, st.fields);
            if (placed) {
                st.fields = placed;
                const count = container.querySelector('[data-sig-place-count]');
                const button = container.querySelector('[data-sig-place]');
                if (count) {
                    count.textContent = placed.length
                        ? `${placed.length} place${placed.length === 1 ? '' : 's'} marked`
                        : 'Optional — without this the signature is recorded but not stamped into the file.';
                }
                if (button) {
                    button.textContent = placed.length ? 'Change the places' : 'Mark places on the document';
                }
            }
        } finally {
            // Freed either way: the dialog has finished with it, and a blob URL
            // that is never revoked holds the whole file in memory for the life
            // of the page.
            URL.revokeObjectURL(blobUrl);
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
        if (kind === 'document') {
            body.document_id = documentId;
            // Only a document can carry places. Sending them on a quote is
            // refused by the server, and rightly — there are no pages.
            body.fields = st.fields || [];
        }

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

        // A fresh form starts with no places. Carrying them over from the last
        // send would silently mark a DIFFERENT document in the same spots.
        st.fields = [];
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

    /**
     * Produce the stamped copy for a signature that never got one.
     *
     * ⭐ THE WORDING SAYS PRODUCE, NOT RE-SIGN.
     *
     * A rep seeing this button is looking at a record that says SIGNED with no
     * file behind it, and the one thing they must not conclude is that the
     * customer has to sign again. Everything needed was frozen when they did:
     * the document, the marked places, and the mark itself — this only renders
     * them. So the button, the toast and the failure all talk about the COPY,
     * never about the signature.
     */
    async function produceSignedCopy(container, button) {
        // Disabled for the round trip: stamping uploads a new file, and two
        // clicks would be two objects with only the second reachable.
        button.disabled = true;
        const original = button.textContent;
        button.textContent = 'Producing…';
        try {
            await api.request(`/crm/signature-requests/${encodeURIComponent(
                button.getAttribute('data-sig-restamp'))}/regenerate-signed-copy`, { method: 'POST' });
            Toast.success('The stamped copy is ready.');
            await load(container);
        } catch (e) {
            Toast.error(e.message || 'The stamped copy could not be produced.');
            button.disabled = false;
            button.textContent = original;
        }
    }

    /**
     * ⭐ THE ANSWER TO "SHOW ME WHAT THEY SIGNED".
     *
     * A signature nobody can produce afterwards is not evidence. This opens the
     * certificate: the frozen document, the mark itself, who made it, when,
     * from which address, the fingerprint, and every event in order — in a
     * window that prints, because the person who asks for this usually needs to
     * send it to somebody.
     */
    async function showCertificate(id) {
        let cert;
        try {
            cert = await api.request(`/crm/signature-requests/${encodeURIComponent(id)}/certificate`);
        } catch (e) {
            Toast.error(e.message || 'Could not open the signed copy');
            return;
        }

        // ⭐⭐⭐ NAMING THE CONTRACT IS NOT SHOWING IT.
        //
        // The first version printed "Document signed: contract.pdf" and stopped
        // there — a certificate that says a document was signed and cannot
        // produce it proves nothing you could send to anyone.
        //
        // The bytes are fetched HERE, in the parent, because the download needs
        // an Authorization header and the certificate opens as a blank popup
        // that has no token. The blob URL it yields is same-origin with the
        // opener, so the popup can embed it.
        let documentUrl = null;
        if (cert.document_id) {
            try {
                const base = (typeof CONFIG !== 'undefined' && CONFIG.crmApiBaseUrl) || '/api';
                const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
                const res = await fetch(
                    `${base}/entity-documents/${encodeURIComponent(cert.document_id)}/download`,
                    { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                if (res.ok) documentUrl = URL.createObjectURL(await res.blob());
            } catch (e) {
                // Not fatal: the rest of the certificate is still the evidence.
                console.error('Could not fetch the signed document:', e);
            }
        }

        const win = window.open('', '_blank', 'width=860,height=900');
        if (!win) { Toast.error('Allow pop-ups to view the signed copy'); return; }

        const snap = cert.snapshot || {};

        // ⭐ ONE MONEY FORMATTER, AND IT LIVES IN currencies.js.
        //
        // The first version built its own Intl.NumberFormat here. Every previous
        // copy of that in this codebase hard-coded en-IN and printed lakh
        // grouping on non-INR amounts — which on a signed record would misstate
        // the figure somebody agreed to.
        //
        // The certificate opens in a NEW WINDOW, so it cannot load the shared
        // file itself. The amounts are therefore formatted HERE, in the parent,
        // and written across as finished strings.
        const money = (v) => {
            const n = Number(v);
            if (!isFinite(n)) return '';
            // formatMoney is a bare global from currencies.js, not namespaced.
            return typeof formatMoney === 'function'
                ? formatMoney(n, snap.currency || 'INR')
                : `${snap.currency || ''} ${n.toFixed(2)}`.trim();
        };
        const when = (v) => v ? new Date(v).toLocaleString(undefined,
            { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

        const lines = Array.isArray(snap.lines) ? snap.lines : [];
        const body = cert.kind === 'quote'
            ? `<table class="lines">
                 <thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead>
                 <tbody>${lines.map((l) => `<tr>
                     <td>${esc(l.description)}</td>
                     <td class="n">${esc(l.quantity)}</td>
                     <td class="n">${esc(money(l.unit_price))}</td>
                     <td class="n"><b>${esc(money(l.line_total))}</b></td>
                 </tr>`).join('')}</tbody>
               </table>
               <p class="total">Total <b>${esc(money(snap.grand_total != null ? snap.grand_total : snap.subtotal))}</b></p>`
            : `<p class="file">Document signed: <b>${esc(snap.file_name || cert.title)}</b>
                 ${documentUrl ? `<a class="open" href="${esc(documentUrl)}" target="_blank" rel="noopener">Open</a>` : ''}</p>
               ${documentUrl
                    ? `<iframe class="doc" src="${esc(documentUrl)}" title="The signed document"></iframe>`
                    : '<p class="muted">The document itself could not be loaded just now — the record below still stands.</p>'}`;

        // The mark: an image when drawn, the name in a hand when typed.
        const mark = cert.signature_kind === 'drawn' && cert.signature_data
            ? `<img class="mark" src="${esc(cert.signature_data)}" alt="Signature of ${esc(cert.signer_name)}">`
            : cert.signature_data
                ? `<div class="mark typed">${esc(cert.signature_data)}</div>`
                : '<p class="muted">No signature — this request was not signed.</p>';

        win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
        <title>Signed copy — ${esc(cert.title)}</title>
        <style>
          body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d262b;
               background:#f2f5f6;margin:0;padding:2rem 1rem 4rem;line-height:1.55}
          .sheet{max-width:760px;margin:0 auto;background:#fff;border:1px solid #d8e0e2;border-radius:8px;padding:2rem 2.2rem}
          h1{font-size:1.35rem;margin:0 0 .2rem}
          .eyebrow{font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#0f5f66;margin:0 0 .5rem}
          .status{display:inline-block;padding:.15rem .5rem;border-radius:999px;font-size:.7rem;font-weight:700;
                  text-transform:uppercase;letter-spacing:.05em}
          .signed{background:#e7f2ec;color:#2f6b4f}.declined{background:#f7e9e7;color:#8f3a30}
          table.lines{border-collapse:collapse;width:100%;margin:1.4rem 0 0}
          table.lines th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:#8797a0;
                         padding:0 .5rem .5rem;border-bottom:1px solid #d8e0e2}
          table.lines td{padding:.6rem .5rem;border-bottom:1px solid #e7edee;font-size:.92rem}
          .n{text-align:right;font-variant-numeric:tabular-nums}
          .total{display:flex;justify-content:space-between;margin:1rem 0 0;padding-top:.7rem;
                 border-top:1px solid #d8e0e2;font-size:1.05rem;font-weight:700}
          .file{margin:1.4rem 0 0;padding:1rem;background:#eef2f3;border-radius:6px;
                display:flex;justify-content:space-between;align-items:center;gap:1rem}
          .file .open{font-size:.82rem;font-weight:600;color:#0f5f66;text-decoration:none;
                      border:1px solid #d8e0e2;border-radius:5px;padding:.3rem .6rem;background:#fff}
          iframe.doc{display:block;width:100%;height:60vh;min-height:340px;margin:.8rem 0 0;
                     border:1px solid #d8e0e2;border-radius:6px;background:#fff}
          @media print{iframe.doc{height:auto;min-height:520px}}
          h2{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:#8797a0;margin:2rem 0 .7rem}
          .mark{max-width:320px;max-height:120px;display:block;border-bottom:1px solid #1d262b;padding-bottom:.3rem}
          .mark.typed{font-family:"Segoe Script","Brush Script MT",cursive;font-size:2rem}
          dl{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1.2rem;margin:.8rem 0 0;font-size:.88rem}
          dt{color:#5b6a72}dd{margin:0;font-weight:600}
          code{font-family:ui-monospace,Menlo,monospace;font-size:.8rem;background:#eef2f3;padding:.1rem .3rem;border-radius:3px;
               overflow-wrap:anywhere}
          ol{margin:.6rem 0 0;padding-left:1.1rem;font-size:.86rem;color:#5b6a72}
          li{margin:.3rem 0}li b{color:#1d262b}
          .muted{color:#8797a0}
          .foot{margin-top:2rem;padding-top:1rem;border-top:1px solid #e7edee;font-size:.78rem;color:#8797a0}
          @media print{body{background:#fff;padding:0}.sheet{border:0;max-width:none}}
        </style></head><body><div class="sheet">
          <p class="eyebrow">Signed copy</p>
          <h1>${esc(cert.title)}</h1>
          <span class="status ${esc(cert.status)}">${esc(cert.status)}</span>
          ${body}

          <h2>${cert.status === 'declined' ? 'Outcome' : 'Signature'}</h2>
          ${mark}
          <dl>
            <!-- ⭐ A DECLINED RECORD MUST NOT SAY "SIGNED BY". It named the
                 person who REFUSED as the person who signed, which is the one
                 sentence on this page that must never be wrong. -->
            <dt>${cert.status === 'declined' ? 'Sent to' : 'Signed by'}</dt><dd>${esc(cert.signer_name)}</dd>
            ${cert.signer_email ? `<dt>Email</dt><dd>${esc(cert.signer_email)}</dd>` : ''}
            ${cert.signer_phone ? `<dt>Phone</dt><dd>${esc(cert.signer_phone)}</dd>` : ''}
            <dt>${cert.status === 'declined' ? 'Declined at' : 'Signed at'}</dt>
            <dd>${esc(when(cert.signed_at || cert.declined_at))}</dd>
            ${cert.signer_ip ? `<dt>From address</dt><dd>${esc(cert.signer_ip)}</dd>` : ''}
            ${cert.decline_reason ? `<dt>Reason given</dt><dd>${esc(cert.decline_reason)}</dd>` : ''}
            <dt>Document fingerprint</dt><dd><code>${esc(cert.content_hash)}</code></dd>
          </dl>

          <h2>Audit trail</h2>
          <ol>${(cert.trail || []).map((e) => `<li>
            <b>${esc(EVENT_LABEL[e.event] || e.event)}</b> — ${esc(when(e.occurred_at))}
            ${e.ip ? ` from ${esc(e.ip)}` : ''}${e.detail ? ` — ${esc(e.detail)}` : ''}
          </li>`).join('')}</ol>

          <p class="foot">Signed electronically through Ragenaizer. The fingerprint above is a
             SHA-256 of the document exactly as it was shown to the signer; it changes if a single
             character of that document changes.</p>
        </div></body></html>`);
        win.document.close();
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
            formOpen: false, sending: false, documents: [], documentId: null, fields: [],
        });

        // Delegated, so a re-render cannot leave a live listener on a node that
        // is no longer in the document.
        container.addEventListener('click', (evt) => {
            const cancel = evt.target.closest('[data-sig-cancel]');
            if (cancel) { cancelRequest(container, cancel.getAttribute('data-sig-cancel')); return; }
            const view = evt.target.closest('[data-sig-view]');
            if (view) { showCertificate(view.getAttribute('data-sig-view')); return; }
            const restamp = evt.target.closest('[data-sig-restamp]');
            if (restamp) { produceSignedCopy(container, restamp); return; }
            if (evt.target.closest('[data-sig-place]')) { openPlacer(container); return; }
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
            const placeRow = container.querySelector('[data-sig-place-row]');
            if (placeRow) placeRow.hidden = evt.target.value !== 'document';
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
