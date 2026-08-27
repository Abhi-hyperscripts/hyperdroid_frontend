/**
 * The signing page — what a customer sees when they open a signing link.
 * ----------------------------------------------------------------------------
 * There is no login here. The token in the URL is the credential, so this file
 * holds the least state it can and asks the server for everything.
 *
 *   POST /api/signing/open      { token }                      → the document
 *   POST /api/signing/sign      { token, ...signature }        → signed
 *   POST /api/signing/decline   { token, reason }              → declined
 *
 * ⭐ THE TOKEN GOES IN THE BODY, NEVER THE PATH. A URL carrying a bearer
 * credential ends up in access logs, browser history and Referer headers. It is
 * in OUR query string because a link is what we sent, and the first thing this
 * file does is take it out of the address bar.
 *
 * Responses are snake_case (the API's SnakeCaseLower policy).
 */
(() => {
    'use strict';

    // QUOTE-SAFE on purpose: escaped values land inside double-quoted
    // attributes, and an escaper that leaves " and ' alone lets a deal name
    // supplied by whoever created the quote break out of one.
    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const $ = (id) => document.getElementById(id);

    const api = () => (window.CONFIG && window.CONFIG.crmApiBaseUrl) || '/api';

    let token = '';
    let view = null;
    let pad = null;
    let submitting = false;

    // ─── money ──────────────────────────────────────────────────────────────

    /**
     * ⭐ THE SIGNER'S OWN LOCALE, NOT OURS.
     *
     * The currency comes from the quote; the grouping comes from the browser
     * reading it. Hard-coding en-IN would print ₹1,00,000 to a customer in
     * Singapore who has never seen a lakh grouping and would reasonably read it
     * as a different number on a document they are about to sign.
     */
    function money(amount, currency) {
        const n = Number(amount);
        if (!isFinite(n)) return '';
        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency', currency: currency || 'INR', minimumFractionDigits: 2,
            }).format(n);
        } catch {
            return `${currency || ''} ${n.toFixed(2)}`.trim();
        }
    }

    // ─── transport ──────────────────────────────────────────────────────────

    async function post(path, body) {
        const res = await fetch(`${api()}/signing/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        let payload = null;
        try { payload = await res.json(); } catch { /* a body is not guaranteed */ }

        if (!res.ok) {
            const err = new Error((payload && payload.error) || 'Something went wrong.');
            err.status = res.status;
            throw err;
        }
        return payload;
    }

    // ─── rendering ──────────────────────────────────────────────────────────

    /**
     * ⭐ THE SIGNER'S OWN PREFERENCE, REMEMBERED.
     *
     * The page follows the system by default — nothing is stamped on <html>,
     * so prefers-color-scheme decides and most people never think about it.
     * The toggle exists because a signer may want the light sheet to read a
     * contract in daylight, or to print it, whatever their OS is set to.
     *
     * Stamping "light" or "dark" makes the explicit choice beat the system in
     * BOTH directions, which is why the CSS guards its dark media block with
     * :not([data-theme="light"]).
     */
    function setUpTheme() {
        const btn = $('themeToggle');
        if (!btn) return;

        let saved = null;
        try { saved = localStorage.getItem('rz-sign-theme'); } catch (e) { /* private mode */ }
        if (saved === 'light' || saved === 'dark') {
            document.documentElement.setAttribute('data-theme', saved);
        }

        btn.addEventListener('click', () => {
            const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const current = document.documentElement.getAttribute('data-theme')
                || (systemDark ? 'dark' : 'light');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('rz-sign-theme', next); } catch (e) { /* private mode */ }
        });
    }

    function show(id) {
        ['loadingState', 'errorState', 'documentState', 'doneState'].forEach((s) => {
            const el = $(s);
            if (el) el.hidden = s !== id;
        });

        // ⭐ THE FOOTER TALKS ABOUT "THIS SIGNATURE", SO IT NEEDS ONE TO EXIST.
        //
        // "A record of this signature, including the time and the document it
        // applied to, is kept with the sender" is a reassurance while a document
        // is on screen and after it is signed. Under "This link isn't available"
        // it describes a signature that was never made, and while the page is
        // still loading it answers a question nobody has asked yet.
        const foot = document.querySelector('.foot');
        if (foot) foot.hidden = (id === 'errorState' || id === 'loadingState');
    }

    function fail(message) {
        $('errorMessage').textContent = message;
        show('errorState');
    }

    function renderQuote(snap) {
        const currency = snap.currency || 'INR';
        const lines = Array.isArray(snap.lines) ? snap.lines : [];

        const rows = lines.map((l) => `
            <tr>
                <td>
                    <span class="ln-desc">${esc(l.description)}</span>
                    ${l.sku ? `<span class="ln-sku">${esc(l.sku)}</span>` : ''}
                </td>
                <td class="num">${esc(l.quantity)}${l.uom ? ` <span class="ln-uom">${esc(l.uom)}</span>` : ''}</td>
                <td class="num">${esc(money(l.unit_price, currency))}</td>
                <td class="num strong">${esc(money(l.line_total, currency))}</td>
            </tr>`).join('');

        // ⭐⭐⭐ A PRE-TAX FIGURE MAY NEVER BE LABELLED "TOTAL".
        //
        // This showed only the rows that exist, reasoning that "a Tax row on an
        // untaxed quote reads as an error" — and then fell back to the SUBTOTAL
        // under the word Total when tax was unknown. Measured 2026-08-27: a
        // quote of three typed lines reached a customer reading
        // "Total US$845,000.00" while Accounts raised the same document at
        // ₹9,97,100 including 18% GST. The signer would have agreed to a number
        // 18% below the invoice.
        //
        // Silence about tax is the failure, not the cure. Standard practice is
        // the opposite of what the old comment assumed:
        //
        //   • A proforma/quote is expected to carry a tax breakup. It is not a
        //     statutory GST document and no format is prescribed, but showing
        //     estimated tax is what makes it convertible into a tax invoice.
        //   • The document must SAY whether prices include tax. B2B convention
        //     is exclusive-of-tax, explicitly stated — "prices are exclusive of
        //     taxes unless otherwise quoted" is the standard clause.
        //   • The named failure mode is a quote and its invoice disagreeing on
        //     tax treatment, which is exactly this defect.
        //
        // So when tax is known it is shown; when it is NOT, the big number is
        // labelled for what it actually is and the basis is stated in words. It
        // does not block signing — no quoting tool does, and a business
        // routinely quotes before tax is settled.
        const taxKnown = snap.total_tax != null;

        const totals = [];
        if (snap.taxable_total != null)
            totals.push(['Taxable', money(snap.taxable_total, currency), false]);
        if (taxKnown)
            totals.push(['Tax', money(snap.total_tax, currency), false]);
        if (snap.untaxed_total != null && Number(snap.untaxed_total) !== 0)
            totals.push(['Not taxed', money(snap.untaxed_total, currency), false]);

        totals.push(taxKnown
            ? ['Total', money(snap.grand_total != null ? snap.grand_total : snap.subtotal, currency), true]
            : ['Total before tax', money(snap.subtotal, currency), true]);

        return `
            <div class="doc-scroll">
                <table class="lines">
                    <thead>
                        <tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="totals">
                ${totals.map(([label, value, grand]) => `
                    <div class="total-row${grand ? ' grand' : ''}">
                        <span>${esc(label)}</span><b>${esc(value)}</b>
                    </div>`).join('')}
            </div>
            ${!taxKnown ? `
                <p class="doc-note">These prices are exclusive of tax. Any tax that applies will be
                   calculated and shown on the invoice, and is payable in addition to the amount
                   above.</p>` : ''}
            ${taxKnown && snap.tax_is_provisional ? `
                <p class="doc-note">The tax shown is provisional and may be recalculated on the
                   final invoice against your registered details.</p>` : ''}`;
    }

    /**
     * ⭐⭐⭐ THE SIGNER MUST BE ABLE TO READ IT.
     *
     * This used to render a file icon, a name and a size — so a customer was
     * asked to put their signature on a contract they had never been shown. A
     * record claiming they agreed to a document they could not open is worse
     * than no record, because it looks like consent.
     *
     * The document is fetched through the same token, embedded where the
     * browser can render it, and always downloadable — because an embed that
     * fails silently is the same defect wearing a viewer.
     */
    function renderDocument(snap) {
        const size = Number(snap.size_bytes);
        const readable = isFinite(size) && size > 0
            ? (size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`)
            : '';
        return `
            <div class="doc-file">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                    <b>${esc(snap.file_name)}</b>
                    ${readable ? `<span>${esc(readable)}</span>` : ''}
                </div>
                <a class="doc-open" id="docOpen" href="#" target="_blank" rel="noopener">Open in a new tab</a>
            </div>
            ${(view.fields || []).length
                ? `<p class="doc-marks" id="docMarks">
                       This document has <b>${(view.fields || []).length}</b> place${(view.fields || []).length === 1 ? '' : 's'}
                       marked for your signature. Sign once below and it will be added to every one.
                   </p>`
                : ''}
            <div class="doc-viewer" id="docViewer">
                <p class="doc-loading">Loading the document…</p>
            </div>`;
    }

    /**
     * Fetch the document and put it on the page.
     *
     * Called after render, because the fetch needs the token and the elements
     * need to exist. Failure is SAID rather than left as an empty frame — a
     * signer staring at a blank box does not know whether the contract is empty
     * or the page is broken.
     */
    async function loadDocument() {
        const viewer = $('docViewer');
        const open = $('docOpen');
        if (!viewer) return;

        let doc;
        try {
            doc = await post('document', { token });
        } catch (e) {
            viewer.innerHTML = '';
            viewer.appendChild(Object.assign(document.createElement('p'), {
                className: 'doc-failed',
                textContent: 'This document could not be opened. Please ask the sender to resend it '
                           + '— do not sign something you have not read.',
            }));
            if (open) open.hidden = true;
            return;
        }

        if (open) open.href = doc.url;

        const type = String(doc.content_type || '');
        const hasFields = ((view && view.fields) || []).length > 0;

        // ⭐ BOXES NEED PAGES, NOT AN IFRAME.
        //
        // The native PDF viewer is the better reading experience — real page
        // controls, search, print — so it is used whenever there is nothing to
        // overlay. But nothing can be positioned on top of it: the document
        // inside is a separate browsing context. When the sender has marked
        // places, the pages are rendered as canvases here so the mark can be
        // shown exactly where it will land.
        if (type === 'application/pdf' && hasFields && typeof PdfJsLoader !== 'undefined') {
            try {
                viewer.innerHTML = '';
                viewer.classList.add('doc-viewer-pages');
                const total = await PdfJsLoader.renderInto(viewer, doc.url, viewer.clientWidth - 24);
                labelPages(viewer, total, (view && view.fields) || []);
                return;
            } catch (e) {
                // Fall through to the iframe. A signer who cannot see the boxes
                // is better served by a readable document than by an error.
                console.error('Could not render the pages:', e);
            }
        }

        if (type === 'application/pdf' || type.startsWith('image/')) {
            const frame = document.createElement(type.startsWith('image/') ? 'img' : 'iframe');
            frame.src = doc.url;
            if (frame.tagName === 'IFRAME') frame.title = 'The document you are signing';
            else frame.alt = 'The document you are signing';
            viewer.innerHTML = '';
            viewer.appendChild(frame);
        } else {
            // Word, Excel and the rest cannot be embedded. Say so plainly and
            // point at the link, rather than showing an empty frame.
            viewer.innerHTML = '';
            viewer.appendChild(Object.assign(document.createElement('p'), {
                className: 'doc-note',
                textContent: 'This file type cannot be shown here. Open it in a new tab to read it '
                           + 'before you sign.',
            }));
        }
    }

    function render() {
        $('docTitle').textContent = view.title || 'Document';
        $('docSigner').textContent = view.signer_name || '';

        // The printed block beneath the execution rule. On a paper deed the
        // signature sits on the line and the party's name is PRINTED under it,
        // so there is no doubt whose mark it is. Same here — filled from the
        // party the document was prepared for, not from what gets typed, so it
        // states who is expected to sign rather than echoing the signer.
        const printedName = $('printedName');
        if (printedName) printedName.textContent = view.signer_name || '';
        const printedDate = $('printedDate');
        if (printedDate) printedDate.textContent = formatDate(new Date().toISOString());

        const snap = view.snapshot || {};
        $('docBody').innerHTML = view.kind === 'quote' ? renderQuote(snap) : renderDocument(snap);
        if (view.kind !== 'quote') loadDocument();

        if (!view.is_actionable) {
            // A finished link still shows the document — the signer has every
            // right to see what they agreed to — but with no way to act again.
            $('signBlock').hidden = true;
            $('closedNotice').hidden = false;
            $('closedNotice').textContent = closedMessage(view.outcome, view.signed_at);
            show('documentState');
            return;
        }

        $('signBlock').hidden = false;
        $('closedNotice').hidden = true;
        $('expiryNote').textContent = `This link stays open until ${formatDate(view.expires_at)}.`;

        // Default the typed name to who the request is for. Prefilled, not
        // fixed: the person actually signing may be a director whose name
        // differs from the contact we sent it to, and the audit trail records
        // what they typed either way.
        const typed = $('typedName');
        if (typed && !typed.value) {
            typed.value = view.signer_name || '';
            // ⭐ SETTING .value FIRES NOTHING.
            //
            // The handwriting preview mirrors this field on `input`, and
            // assigning the property does not raise that event — so a signer who
            // never edited the prefilled name saw an empty preview above it and
            // no sign of the signature they were about to give. Announcing the
            // change keeps one source of truth for the preview rather than
            // writing to it from two places.
            typed.dispatchEvent(new Event('input', { bubbles: true }));
        }

        show('documentState');
        setupPad();
        syncSignButton();
    }

    function closedMessage(outcome, signedAt) {
        switch (outcome) {
            case 'signed':   return `This document was signed on ${formatDate(signedAt)}. Nothing further is needed.`;
            case 'declined': return 'This document was declined. If that was a mistake, ask for a new link.';
            case 'cancelled':return 'This request was withdrawn by the sender.';
            case 'expired':  return 'This signing link has expired. Ask for a new one to be sent.';
            default:         return 'This document is no longer open for signature.';
        }
    }

    /**
     * ⭐ A FOUR-PAGE CONTRACT IN A SCROLL BOX NEEDS THE VIEWER'S OWN CHROME.
     *
     * Rendered as canvases, the pages lose everything a PDF reader gives you:
     * there is no page number, no total, and no way to find the one page you
     * actually have to sign. Four near-identical pages in a 3,000px scroll is a
     * hunt. The document prints its own "Page 1 of 4" INSIDE the image, which
     * is the document talking, not the viewer.
     *
     * So each page gets a rail: which page it is, out of how many, and — where
     * it applies — that this is a page carrying a signature place. The badge is
     * the only thing here in the accent, because finding those pages is the one
     * navigational question this document actually poses.
     */
    function labelPages(viewer, total, fields) {
        const marked = new Set(fields.map((f) => Number(f.page)));
        viewer.querySelectorAll('.sign-page').forEach((el) => {
            const n = Number(el.dataset.page);
            const rail = document.createElement('div');
            rail.className = 'page-rail';
            const num = document.createElement('span');
            num.textContent = `Page ${n} of ${total}`;
            rail.appendChild(num);
            if (marked.has(n)) {
                const badge = document.createElement('b');
                badge.textContent = 'Signature here';
                rail.appendChild(badge);
            }
            el.parentNode.insertBefore(rail, el);
        });
    }

    function formatDate(value) {
        if (!value) return '';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    }

    // ─── the signature pad ──────────────────────────────────────────────────

    /**
     * A canvas the signer draws on with a finger or a mouse.
     *
     * ⭐ SIZED IN DEVICE PIXELS. A canvas has two sizes — its CSS box and its
     * backing store — and if the backing store is left at the 300×150 default
     * while CSS stretches it to 600px wide, every stroke lands at half the
     * coordinates the pointer reported and the signature comes out skewed.
     */
    function setupPad() {
        const canvas = $('padCanvas');
        if (!canvas || pad) return;

        const ctx = canvas.getContext('2d');
        let drawing = false;
        let dirty = false;

        function resize() {
            const ratio = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            if (!rect.width) return;

            // Re-sizing a canvas CLEARS it, so a half-drawn signature would
            // vanish on an orientation change. Keep what is there and put it
            // back after.
            const previous = dirty ? canvas.toDataURL('image/png') : null;

            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = getComputedStyle(canvas).color || '#111';

            if (previous) {
                const img = new Image();
                img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
                img.src = previous;
            }
        }

        function pointAt(evt) {
            const rect = canvas.getBoundingClientRect();
            const src = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
            return { x: src.clientX - rect.left, y: src.clientY - rect.top };
        }

        function start(evt) {
            evt.preventDefault();
            drawing = true;
            const p = pointAt(evt);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
        }

        function move(evt) {
            if (!drawing) return;
            evt.preventDefault();
            const p = pointAt(evt);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            if (!dirty) { dirty = true; syncSignButton(); }
        }

        function end() {
            if (!drawing) return;
            drawing = false;
            // Refreshed at the end of a stroke rather than on every move —
            // toDataURL on each mousemove would make the pad crawl.
            if (dirty) previewMarks(canvas.toDataURL('image/png'));
        }

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', () => {
            end();
            if (dirty) previewMarks(canvas.toDataURL('image/png'));
        });
        window.addEventListener('resize', resize);

        resize();

        pad = {
            isEmpty: () => !dirty,
            clear: () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                dirty = false;
                previewMarks(null);
                syncSignButton();
            },
            toDataUrl: () => canvas.toDataURL('image/png'),
        };

        $('padClear').addEventListener('click', () => pad.clear());
    }

    /**
     * ⭐ SHOW THE SIGNER WHERE IT WILL LAND, BEFORE THEY COMMIT.
     *
     * The boxes the sender marked are drawn over the rendered pages, and the
     * mark appears in all of them the moment it is made. Telling somebody
     * "it will be added to every one" and showing nothing asks them to take it
     * on trust about a document they are about to be bound by.
     *
     * Purely a preview. The stamping that matters happens on the server, from
     * the same stored fractions.
     */
    function previewMarks(dataUrl) {
        const fields = (view && view.fields) || [];
        if (!fields.length) return;

        document.querySelectorAll('.sign-mark').forEach((m) => m.remove());
        if (!dataUrl) return;

        fields.forEach((f) => {
            const page = document.querySelector(`.sign-page[data-page="${f.page}"]`);
            if (!page) return;
            const r = page.getBoundingClientRect();
            const img = document.createElement('img');
            img.className = 'sign-mark';
            img.src = dataUrl;
            img.alt = '';
            img.style.left = `${f.x * r.width}px`;
            img.style.top = `${f.y * r.height}px`;
            img.style.width = `${f.w * r.width}px`;
            img.style.height = `${f.h * r.height}px`;
            page.appendChild(img);
        });
    }

    function currentMode() {
        const checked = document.querySelector('input[name="signMode"]:checked');
        return checked ? checked.value : 'drawn';
    }

    function syncSignButton() {
        const agreed = $('agreeBox').checked;
        const named = $('typedName').value.trim().length > 0;
        const marked = currentMode() === 'typed' ? named : !!(pad && !pad.isEmpty());
        $('signButton').disabled = submitting || !(agreed && named && marked);

        // The execution rule turns violet once a real mark exists — state, not
        // decoration. It says the document has become executable, and it is the
        // only thing on the page that changes colour.
        const execution = document.querySelector('.execution');
        if (execution) execution.classList.toggle('is-signed', marked);
    }

    function switchMode() {
        const mode = currentMode();
        $('drawArea').hidden = mode !== 'drawn';
        $('typeArea').hidden = mode !== 'typed';
        if (mode === 'drawn') setupPad();
        syncSignButton();
    }

    // ─── actions ────────────────────────────────────────────────────────────

    async function sign() {
        if (submitting) return;

        const mode = currentMode();
        const typedName = $('typedName').value.trim();

        // Re-checked here rather than trusting the disabled button: the button
        // is re-enabled by syncSignButton on every keystroke, and a fact held
        // only in the DOM is one render away from being wrong.
        if (!$('agreeBox').checked || !typedName) return;
        if (mode === 'drawn' && (!pad || pad.isEmpty())) return;

        submitting = true;
        syncSignButton();
        $('signButton').textContent = 'Signing…';

        try {
            await post('sign', {
                token,
                signature_kind: mode,
                signature_data: mode === 'drawn' ? pad.toDataUrl() : typedName,
                typed_name: typedName,
                agreed: true,
            });
            finish('signed');
        } catch (e) {
            submitting = false;
            $('signButton').textContent = 'Sign this document';
            syncSignButton();
            $('signError').textContent = e.message;
            $('signError').hidden = false;
        }
    }

    async function decline() {
        if (submitting) return;
        const reason = $('declineReason').value.trim();

        submitting = true;
        try {
            await post('decline', { token, reason });
            finish('declined');
        } catch (e) {
            submitting = false;
            $('signError').textContent = e.message;
            $('signError').hidden = false;
            closeDecline();
        }
    }

    /**
     * Show the outcome and get everything else off the screen.
     *
     * ⭐ CLOSING THE MODAL IS PART OF FINISHING.
     *
     * decline() closed it on FAILURE and not on success, so a successful
     * decline left "Decline to sign" sitting on top of the "Declined"
     * confirmation, with a live Decline button inviting a second press. Done
     * here rather than in each caller, because the next outcome added would
     * forget it in exactly the same way.
     */
    function finish(outcome) {
        closeDecline();
        $('doneTitle').textContent = outcome === 'signed' ? 'Signed — thank you' : 'Declined';
        $('doneBody').textContent = outcome === 'signed'
            ? 'Your signature has been recorded and the sender has been notified. You can close this page.'
            : 'We have let the sender know. You can close this page.';
        $('doneIcon').classList.toggle('is-declined', outcome !== 'signed');
        show('doneState');
    }

    function openDecline() { $('declineModal').hidden = false; $('declineReason').focus(); }
    function closeDecline() { $('declineModal').hidden = true; }

    // ─── boot ───────────────────────────────────────────────────────────────

    async function boot() {
        const params = new URLSearchParams(window.location.search);
        token = (params.get('t') || '').trim();

        // ⭐ TAKE THE CREDENTIAL OUT OF THE ADDRESS BAR IMMEDIATELY.
        //
        // It has to arrive in the URL — a link is what we send — but leaving it
        // there puts a token that can sign in the customer's name into browser
        // history, into any screenshot they take, and into the Referer of every
        // outbound request this page makes. replaceState keeps it in memory and
        // takes it off the screen.
        if (token && window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        if (!token) {
            fail('This link is incomplete. Please open the link exactly as it was sent to you.');
            return;
        }

        try {
            view = await post('open', { token });
        } catch (e) {
            fail(e.message || 'This signing link is no longer available.');
            return;
        }

        render();
    }

    document.addEventListener('DOMContentLoaded', () => {
        setUpTheme();
        $('agreeBox').addEventListener('change', syncSignButton);
        $('typedName').addEventListener('input', syncSignButton);
        document.querySelectorAll('input[name="signMode"]').forEach((r) =>
            r.addEventListener('change', switchMode));
        $('signButton').addEventListener('click', sign);
        $('declineButton').addEventListener('click', openDecline);
        $('declineCancel').addEventListener('click', closeDecline);
        $('declineConfirm').addEventListener('click', decline);
        boot();
    });
})();
