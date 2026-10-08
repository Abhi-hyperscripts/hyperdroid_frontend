/**
 * THE QUOTATION TAB — the tenant's own document, for one lead.
 *
 *   GET /crm/quotation-templates/render/lead/{leadId}
 *
 * ⭐⭐⭐ WHY THIS IS NOT THE PROFORMA TAB.
 *
 * The proforma is an ACCOUNTING document: AccountsService owns its number
 * series, its tax and its layout, and it has to, because it converts into a tax
 * invoice. What a rep actually emails a prospect first is a QUOTATION on the
 * client's own letterhead — their logo, their column headings, their terms — and
 * no amount of configuration on our PDF makes it theirs. Prospects asked for
 * this repeatedly (owner, 2026-10-08).
 *
 * Both tabs price the SAME LINES. There is one money path; this is a second way
 * of printing it, not a second quote.
 *
 * ⭐⭐⭐ AND THIS TAB IS STANDALONE — IT CARRIES THE LINE EDITOR TOO.
 *
 * The first version rendered only the document and told the rep "add a line on
 * the Proforma tab first". The owner's verdict (2026-10-08): "quite awkward
 * that we have to save line item in proforma and then quote will appear — it
 * should be stand alone quotation thing." They are right. A rep's natural act
 * is "quote this customer"; being sent to a tab named after an accounting
 * document they may never raise is backwards, and it makes the Quotation tab
 * look broken on every lead that has not been through Proforma.
 *
 * ⚠️ THE EDITOR IS THE SAME PANEL OVER THE SAME ROWS — NOT A SECOND SET.
 * Giving quotations their own lines would be a second money path: the same
 * totals, the same Accounts call and the same rules written twice, free to
 * disagree. So this mounts LineItemsPanel on crm_deal_line_items exactly as the
 * Proforma tab does, and re-renders the document when it saves. Edit here or
 * there; it is one quote either way.
 *
 * ⭐⭐⭐ THE DOCUMENT RENDERS IN A SANDBOXED IFRAME, AND THE SANDBOX FLAGS ARE
 * EXACT.
 *
 *   sandbox="allow-same-origin allow-modals"
 *
 * The template is arbitrary HTML uploaded by a tenant admin. It is NOT
 * sanitised — a real quotation needs <style>, tables and images, and a
 * sanitiser strict enough to be worth having would destroy the layout they came
 * for. So the containment is the frame:
 *
 *   · NO allow-scripts, so nothing in the template can execute. A quotation
 *     needs no JavaScript, so denying it costs nothing and makes even a hostile
 *     uploaded file inert.
 *   · allow-same-origin is SAFE here precisely BECAUSE scripts are denied: the
 *     documented danger of combining the two is that the frame can reach out
 *     and remove its own sandbox attribute, and with no script there is nothing
 *     to do that. What it buys is the parent being able to call print() on the
 *     frame, which is the whole PDF feature.
 *   · allow-modals, because print() opens one.
 *
 * Do not add allow-scripts. The data substituted into the template is escaped
 * server-side, but the template itself is not, and that combination is the one
 * that would matter.
 */
(function (global) {
    'use strict';

    const state = new WeakMap();

    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /**
     * Mount the panel into `container` for one lead.
     *
     * Mounted AFTER the lead loads, like the proforma panel: this needs the id
     * and nothing else, but the tab it lives in is drawn by the same code that
     * draws the rest of the detail pane.
     */
    function mount(container, lead, options) {
        if (!container) return;
        const st = {
            lead,
            leadId: lead && (lead.id || lead.Id),
            leadName: (lead && (lead.company_name || lead.first_name)) || 'this lead',
            linesMounted: false,
            html: null,
            unresolved: [],
            error: null,
            loading: false,
            canEdit: !options || options.canEdit !== false,
        };
        state.set(container, st);
        bind(container);
        render(container);
        load(container);
    }

    async function load(container) {
        const st = state.get(container);
        if (!st || !st.leadId) return;

        st.loading = true;
        st.error = null;
        render(container);

        try {
            const res = await api.request(
                `/crm/quotation-templates/render/lead/${encodeURIComponent(st.leadId)}`);
            st.html = res.html || '';
            st.unresolved = res.unknown_placeholders || [];
        } catch (e) {
            // ⭐ THE SERVER'S OWN SENTENCE, NOT "something went wrong".
            //
            // The two refusals a rep will actually hit both tell them exactly
            // what to do — "no template is set up yet", and "add a line on the
            // Proforma tab first" — and flattening those into a generic failure
            // would turn a two-click fix into a support ticket.
            st.html = null;
            st.error = e && e.message ? e.message : 'The quotation could not be produced.';
        } finally {
            st.loading = false;
            render(container);
        }
    }

    function render(container) {
        const st = state.get(container);
        if (!st) return;

        if (st.loading) {
            container.innerHTML = `
                <div class="qtp-wrap">
                    <h4 class="qtp-title">Quotation</h4>
                    <p class="qtp-hint">Producing the document…</p>
                </div>`;
            return;
        }

        if (st.error) {
            // ⭐ THE EDITOR STAYS ON SCREEN. The commonest "error" here is "this
            // lead has no lines yet", which is not a failure — it is the
            // starting state, and the fix is the box directly underneath. A
            // bare error with a Try again button would send the rep looking for
            // another tab, which is the awkwardness this tab exists to remove.
            container.innerHTML = `
                <div class="qtp-wrap">
                    <h4 class="qtp-title">Quotation</h4>
                    <p class="qtp-empty">${esc(st.error)}</p>
                    <div class="qtp-lines"></div>
                    <p class="qtp-hint">The quotation is your own document, on your own
                       letterhead. It prices the same lines as the Proforma tab — one quote, two
                       ways of printing it.</p>
                    <button type="button" class="btn btn-sm btn-secondary" data-qtp="retry">Try again</button>
                </div>`;
            mountLines(container);
            return;
        }

        container.innerHTML = `
            <div class="qtp-wrap">
                <div class="qtp-head">
                    <h4 class="qtp-title">Quotation</h4>
                    <div class="qtp-actions">
                        <button type="button" class="btn btn-sm btn-secondary" data-qtp="retry">Refresh</button>
                        <button type="button" class="btn btn-sm btn-primary" data-qtp="pdf">Download PDF</button>
                    </div>
                </div>

                <!-- The same lines the Proforma tab prices, editable here so this
                     tab stands on its own. Saving re-renders the document below. -->
                <div class="qtp-lines"></div>

                ${st.unresolved.length ? `
                <div class="qtp-unresolved">
                    <strong>${st.unresolved.length} placeholder${st.unresolved.length === 1 ? '' : 's'}
                    in your template ${st.unresolved.length === 1 ? 'is' : 'are'} not recognised</strong>
                    — ${st.unresolved.map(esc).join(', ')}.
                    They are highlighted in the document below. Fix them in the file and re-upload it
                    in Settings → Quotation template.
                </div>` : ''}

                <!-- See the sandbox note at the top of this file. The flags are
                     deliberate and the absent one (allow-scripts) is the point. -->
                <iframe class="qtp-frame" title="Quotation for ${esc(st.leadName)}"
                        sandbox="allow-same-origin allow-modals"></iframe>

                <p class="qtp-hint">Download PDF opens your browser's print dialogue — choose
                   "Save as PDF" as the destination. The page margins and paper size come from
                   that dialogue, so a template designed for A4 should be printed as A4.</p>
            </div>`;

        // ⚠️ srcdoc is SET, not interpolated into the markup above. Putting a
        // whole HTML document inside an attribute in a template literal means
        // escaping it correctly every time, and one miss is a broken document
        // or an injection. Assigning the property hands the browser the string
        // verbatim with no quoting rules in play.
        const frame = container.querySelector('.qtp-frame');
        if (frame) frame.srcdoc = st.html || '';

        mountLines(container);
    }

    /**
     * Put the line editor on this tab, over the SAME rows the Proforma tab edits.
     *
     * ⚠️ RE-MOUNTED ON EVERY RENDER, AND THAT IS DELIBERATE. render() replaces
     * this container's innerHTML, so the previous panel's DOM — and the
     * listeners bound to it — are gone. Keeping a flag and skipping the mount
     * would leave an empty div where the editor was, which is the silent
     * half-dead control this codebase has been bitten by before
     * (cloneNode copies attributes, not listeners).
     *
     * ⭐ onSaved RE-RENDERS THE DOCUMENT. Without it the rep saves a line, sees
     * the total change in the editor, and the quotation underneath still shows
     * the old figures — two numbers for one quote on one screen, which is
     * exactly the disagreement that makes people stop trusting the document.
     */
    function mountLines(container) {
        const st = state.get(container);
        const host = container.querySelector('.qtp-lines');
        if (!st || !host || typeof LineItemsPanel === 'undefined') return;

        LineItemsPanel.mount(host, st.lead, {
            ownerKind: 'lead',
            canEdit: st.canEdit,
            showOpenFull: false,
            // Raising and issuing a proforma belongs to the Proforma tab. A
            // "Raise proforma" button under a quotation offers to produce a
            // different document than the one on screen.
            showQuoteActions: false,
            onSaved: () => load(container),
        });
    }

    function bind(container) {
        if (container.dataset.qtpBound === '1') return;
        container.dataset.qtpBound = '1';

        container.addEventListener('click', (e) => {
            if (e.target.closest('[data-qtp="retry"]')) return load(container);
            if (e.target.closest('[data-qtp="pdf"]')) return downloadPdf(container);
        });
    }

    /**
     * Hand the rendered document to the browser's own print-to-PDF.
     *
     * ⭐⭐ NO SERVER-SIDE PDF, AND THAT IS A MEASURED CHOICE, NOT A SHORTCUT.
     *
     * QuestPDF — the library AccountsService uses for every other document — is
     * code-first and cannot render HTML at all; the community extensions that
     * claim to map only a subset of tags, which for a tenant's own hand-written
     * layout means a document that silently comes out wrong. There is no
     * headless browser and no LibreOffice anywhere in this fleet, and adding one
     * is a new runtime dependency on every host.
     *
     * The browser already has a correct, complete HTML renderer with a
     * print-to-PDF in it. Using it means what the rep previews is exactly what
     * the customer receives — which is the property that matters most on a
     * document somebody else designed.
     *
     * The honest cost, which the hint under the button states: the file name and
     * the margins belong to the print dialogue, not to us.
     */
    function downloadPdf(container) {
        const st = state.get(container);
        const frame = container && container.querySelector('.qtp-frame');
        if (!st || !frame || !st.html) return;

        try {
            // Same-origin (allow-same-origin, no allow-scripts) so the parent may
            // reach in; the frame itself can still run nothing.
            const win = frame.contentWindow;
            if (!win) throw new Error('no frame');
            win.focus();
            win.print();
        } catch (e) {
            console.error('Could not open the print dialogue for the quotation:', e);
            Toast.error('Could not open the print dialogue. Use your browser’s Print on this tab.');
        }
    }

    global.QuotationPanel = { mount, reload: load };
})(window);
