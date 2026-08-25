/**
 * Line items panel — what the deal is actually FOR, and the quote it becomes
 * ----------------------------------------------------------------------------
 * A deal was one name and one number, so the proforma raised in Accounts when it
 * closed read "TerraByte Analytics — Annual Licence, ₹4,00,000". That is not a
 * document anybody can send a customer, and not one Finance can post against a
 * revenue account either.
 *
 *   GET  /crm/deals/{id}/line-items    the lines and what they come to
 *   PUT  /crm/deals/{id}/line-items    replace the whole set
 *   POST /crm/deals/{id}/quotation     raise (or re-fetch) the proforma
 *
 * ⭐ WHEN LINES EXIST THEY ARE THE ONLY AUTHORITY ON THE DEAL VALUE.
 * The server recomputes deal_value from the lines and REFUSES a manual value
 * while any line exists. This panel says so plainly, because a value box that
 * silently rejects what you type is worse than one that is visibly locked.
 *
 * Usage:  LineItemsPanel.mount(el, deal, { canEdit: true });
 */
const LineItemsPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    const MAX_LINES = 200;
    const MAX_DESCRIPTION = 500;

    // Delegates to the ONE implementation in currencies.js. Four copies of this
    // helper each hard-coded 'en-IN', so a $400,000 deal rendered as
    // "$4,00,000.00" — lakh grouping reads as a different number to anybody
    // outside South Asia, on the figure the whole panel exists to show.
    function money(amount, currency) {
        return formatMoney(amount, currency);
    }

    /**
     * ⭐ MIRRORS DealLineMath ON THE SERVER, INCLUDING THE ORDER OF OPERATIONS.
     *
     * The deal total is the sum of ROUNDED line totals, not the rounded sum.
     * The two differ, and the quotation the customer receives prints the LINES —
     * so a header rounded independently could disagree with the column of
     * numbers directly beneath it, in a document somebody is being asked to pay
     * against.
     *
     * The epsilon is not decoration: 1.005 * 100 is 100.49999999999999 in IEEE
     * double, so a plain Math.round gives 1.00 where the server's
     * MidpointRounding.AwayFromZero gives 1.01.
     */
    function round2(n) {
        return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    }

    function lineTotal(qty, price) {
        const q = Number(qty), p = Number(price);
        if (!isFinite(q) || !isFinite(p)) return 0;
        return round2(q * p);
    }

    function sum(lines) {
        return lines.reduce((t, l) => t + lineTotal(l.quantity, l.unit_price), 0);
    }

    // ─── Rendering ──────────────────────────────────────────────────────────

    /**
     * The money summary.
     *
     * ⭐⭐ "TAX COULD NOT BE CALCULATED" IS NOT THE SAME AS "NO TAX".
     *
     * A quote whose lines sell catalogue goods but whose tax could not be
     * fetched must SAY so. Showing the pre-tax figure as though it were the
     * price is how a customer receives a quote missing 18% and gets re-invoiced
     * for the difference later.
     */
    /**
     * Copy the server's money figures onto the panel state.
     *
     * Read from the response and never recomputed here: the whole point of
     * asking Accounts is that the quote and the invoice agree, and a total
     * re-derived in the browser is a second opinion.
     */
    /**
     * Whether this line can actually be supplied.
     *
     * ⭐ THREE STATES, NOT TWO. enough_in_stock is null when the item does not
     * track inventory OR the catalogue could not be asked — and neither of
     * those is "out of stock". Rendering a red badge for "we do not know" would
     * have reps chasing stock for made-to-order goods that never had any.
     */
    /**
     * What this line is taxed, as Accounts broke it down.
     *
     * The per-line figures were being fetched, stored on the panel state and
     * never rendered — payload paid for and thrown away. An Indian tax document
     * shows tax per line, so it belongs on the HSN cell rather than nowhere.
     */
    function lineTaxHint(state, line) {
        const t = state.taxByLine && state.taxByLine[line.id];
        if (!t) return '';
        const parts = (t.components || []).map(c => `${c.name} ${c.rate}%: ${money(c.amount, state.currency)}`);
        return parts.length
            ? `${parts.join('  ·  ')}  =  ${money(t.total_tax, state.currency)}`
            : `Tax ${money(t.total_tax, state.currency)}`;
    }

    function stockBadge(line) {
        if (!line.item_id || line.enough_in_stock === null || line.enough_in_stock === undefined) return '';
        if (line.enough_in_stock) {
            return `<span class="lip-stock lip-stock-ok">in stock</span>`;
        }
        const have = line.available_base;
        return `<span class="lip-stock lip-stock-short">only ${esc(have ?? 0)}${
            line.stock_uom ? ' ' + esc(line.stock_uom) : ''} available</span>`;
    }

    function applyTotals(st, result) {
        st.taxableTotal = result.taxable_total ?? null;
        st.totalTax = result.total_tax ?? null;
        st.grandTotal = result.grand_total ?? null;
        st.taxUnavailable = !!result.tax_unavailable;
        st.taxByLine = result.tax_by_line || null;
        st.pricedAtListPrice = !!result.priced_at_list_price;
        st.taxIsProvisional = !!result.tax_is_provisional;
        st.taxNeedsGstTreatment = !!result.tax_needs_gst_treatment;
    }

    /// ⭐ SAY WHEN A PRICE IS THE SHELF PRICE.
    //
    // A quote can be priced from the catalogue rather than from anything agreed
    // with this customer — because they are on no price list, or because
    // Accounts does not know them yet (a company becomes an Accounts customer
    // only when a deal is won). Both are honest, and both look identical to a
    // negotiated figure once they are on the page.
    //
    // So it is stated. A rep who knows this is the list price can go and agree a
    // better one; a rep who assumes it was already agreed cannot.
    function listPriceNote(state) {
        if (!state.pricedAtListPrice) return '';
        return `
            <div class="lip-note">
                Priced at catalogue list prices — nothing customer-specific has been agreed for these
                products yet.
            </div>`;
    }

    function totalsBlock(state, subtotal) {
        const { currency } = state;
        if (state.taxUnavailable) {
            // ⭐ TWO DIFFERENT REASONS, TWO DIFFERENT NEXT ACTIONS.
            //
            // "Nobody has stated this company's GST treatment" is answerable, by
            // a person, in about five seconds. "The catalogue did not answer" is
            // an outage nobody here can fix. Reporting both as "tax could not be
            // calculated" leaves a rep waiting for a service to come back when
            // what is actually missing is a field on the company.
            const why = state.taxNeedsGstTreatment
                ? `This company's GST treatment has not been set, so the quote cannot show tax.
                   Set it on the company to decide whether this sale is a zero-rated export.`
                : 'Tax could not be calculated just now, so this is the pre-tax total.';
            return `
            <div class="lip-totals">
                <div class="lip-total-row"><span>Subtotal</span><b>${esc(money(subtotal, currency))}</b></div>
                <div class="lip-total-warn">${esc(why)}</div>
            </div>`;
        }
        if (state.totalTax === null || state.totalTax === undefined) return '';
        // ⭐ A PROVISIONAL TOTAL SAYS SO.
        //
        // It was computed from facts CRM supplied, because Accounts has no
        // customer record for this company yet. When one exists — after the deal
        // is won — the invoice will use ITS state and treatment, which may
        // differ. Saying nothing here is how a rep quotes a figure the invoice
        // then contradicts.
        const provisional = state.taxIsProvisional
            ? `<div class="lip-total-warn">Provisional — recalculated against the customer's own
                 details once they exist in Accounts, so the final invoice may differ.</div>`
            : '';
        return `
        <div class="lip-totals">
            <div class="lip-total-row"><span>Taxable</span><b>${esc(money(state.taxableTotal, currency))}</b></div>
            <div class="lip-total-row"><span>Tax</span><b>${esc(money(state.totalTax, currency))}</b></div>
            <div class="lip-total-row lip-total-grand"><span>Total</span><b>${esc(money(state.grandTotal, currency))}</b></div>
            ${provisional}
        </div>`;
    }

    function shell(state) {
        const { lines, currency, canEdit, hasQuotation, quotationNumber } = state;
        const total = sum(lines);

        return `
        <div class="lip">
            <div class="lip-head">
                <h4 class="lip-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    Line items
                </h4>
                ${lines.length > 0
                    ? `<span class="lip-total" data-lip="total">${esc(money(total, currency))}</span>`
                    : ''}
            </div>
            ${state.showOpenFull ? `
            <a class="lip-open-full" href="quote.html?deal=${esc(state.dealId)}">
                Open the full quote
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            </a>` : ''}

            <details class="crm-help crm-help-sm"${st.helpOpen ? ' open' : ''}>
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Line items</summary>
                <div class="crm-help-body">
                    <p>What this deal is made up of, line by line. These same lines become the
                       quotation you send the customer, so they should read the way you want
                       them to read on the document.</p>
                    <p><em>While there are lines here, they set the deal's value — the value field
                       above follows this total and cannot be typed over. Remove every line to go
                       back to pricing the deal by hand.</em></p>
                </div>
            </details>

            ${lines.length > 0 ? `
            <p class="lip-authority">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                This deal is priced by its lines. The deal value follows this total.
            </p>` : ''}

            ${!canEdit ? `
            <p class="lip-readonly">
                Only Team Leads, Managers and Admins can change what a deal is priced at.
            </p>` : ''}

            ${lines.length === 0 ? `
            <p class="lip-none">${canEdit
                ? 'No lines yet — this deal is priced by the value on it. Add a line to itemise it.'
                : 'This deal is priced by the value on it, not by line items.'}</p>
            ` : `
            <div class="lip-lines">
                <div class="lip-head-row" aria-hidden="true">
                    <span class="lip-head-item">Item</span>
                    <span class="lip-head-sum">Qty &times; Unit price</span>
                    <span class="lip-head-total">Line total</span>
                </div>
                <div data-lip="rows">
                    ${lines.map((l, i) => row(l, i, state)).join('')}
                </div>
            </div>
            `}

            ${canEdit ? `
            <div class="lip-actions">
                <button type="button" class="btn btn-sm btn-secondary" data-lip="add">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add line
                </button>
                <span class="lip-spacer"></span>
                <span class="lip-hint" data-lip="hint"></span>
                <button type="button" class="btn btn-sm btn-primary" data-lip="save"${
                    st.saving ? ' disabled' : ''}>Save lines</button>
            </div>` : ''}

            ${listPriceNote(state)}
            ${totalsBlock(state, total)}

            <div class="lip-quote">
                ${hasQuotation ? `
                    <p class="lip-quote-done">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        Quotation raised${quotationNumber ? ` — <strong>${esc(quotationNumber)}</strong>` : ''}
                    </p>
                    <p class="lip-hint">Raising it again returns the same document — a deal has one quotation.</p>
                ` : `
                    <p class="lip-hint">A quotation is raised in Accounts from these lines. It is the same
                       document the deal raises automatically when it is won, so raising it now does not
                       create a second one.</p>
                `}
                ${canEdit ? `
                <button type="button" class="btn btn-sm ${hasQuotation ? 'btn-secondary' : 'btn-primary'}" data-lip="quote">
                    ${hasQuotation ? 'View / re-fetch quotation' : 'Raise quotation'}
                </button>` : ''}
            </div>
        </div>`;
    }

    /// A product thumbnail, or its initial when there is no image yet.
    //
    // Accounts holds items.image_urls but does not expose it on ItemGrpc, so
    // image_url is empty today (Addendum 8). The fallback is not a placeholder
    // waiting to be replaced — a coloured initial is how the rest of this CRM
    // renders an entity with no picture, and it reads as deliberate rather than
    // broken.
    function productThumb(line) {
        // ⚠ NO INLINE onerror CARRYING DATA.
        //
        // The first version put the fallback initial into an onerror="" via
        // JSON.stringify — a value inside a JS string inside an HTML attribute,
        // which needs BOTH escapings and which HTML-escaping alone cannot do
        // (ai-assistant.js learned this the hard way). Worse, JSON.stringify's
        // own double quotes would have terminated the attribute on the first
        // image that ever loaded. It was latent only because Accounts does not
        // expose image_url yet.
        //
        // So the fallback is always PRESENT, underneath, and a failed image
        // simply hides itself. No data crosses into an attribute that executes.
        const initial = `<span class="lip-prod-img lip-prod-img-fallback" aria-hidden="true">
                             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                                 <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                                 <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                                 <line x1="12" y1="22.08" x2="12" y2="12"/>
                             </svg>
                         </span>`;
        // ⭐ BOTH BRANCHES MUST PRODUCE THE SAME BOX.
        //
        // This returned the bare fallback span, unwrapped. Every rule that gives
        // the fallback a size, a position and a centred glyph is scoped to
        // `.lip-prod-thumb`, so a product with no image rendered an unsized
        // inline SVG straight into the flex row while a product WITH one
        // rendered a 38px tile. Same function, two different shapes, and only
        // the branch with data was ever looked at.
        if (!line.image_url) {
            return `<span class="lip-prod-thumb">${initial}</span>`;
        }

        // ⭐ "AND N MORE" — the count is what stops one image and a gallery of
        // four looking identical. Accounts sends the primary URL only (200 rows
        // of every URL is payload nobody reads) and a count beside it, so the
        // truth stays expressible without the payload.
        const more = line.image_count > 1
            ? `<span class="lip-prod-more" title="${esc(line.image_count)} images">+${esc(line.image_count - 1)}</span>`
            : '';
        return `<span class="lip-prod-thumb">
                    ${initial}
                    <img class="lip-prod-img lip-prod-img-real" src="${esc(line.image_url)}"
                         alt="" loading="lazy" onerror="this.hidden = true">
                    ${more}
                </span>`;
    }

    /// SKU, unit and category on one line — the facts that tell two similar
    /// products apart. Empty pieces are dropped rather than rendered as dashes.
    /// SKU, unit, HSN and category on one line — the facts that tell two similar
    /// products apart. Empty pieces are dropped rather than rendered as dashes.
    ///
    /// HSN moved here from its own table column: four digits do not earn a
    /// column, and it belongs beside the other identifiers rather than floating
    /// in the middle of the money. It keeps the tax breakdown as its tooltip.
    function productMeta(line, state) {
        // ⭐ ONE QUIET LINE, NOT A ROW OF PILLS.
        //
        // These were four chips. Chips give every fact the same visual weight as
        // a button, so a SKU shouted as loudly as the stock state that a rep
        // actually has to act on — and stacked under a name, a description and a
        // thumbnail it was five competing elements in one cell.
        //
        // Provenance is a document footnote: it is there to be checked, not
        // scanned. Middot-separated text, one line, muted. The one thing that IS
        // actionable — stock — keeps its badge, and so does the exceptional case
        // of a product the catalogue has withdrawn.
        const bits = [
            line.sku ? `<span class="lip-mono">${esc(line.sku)}</span>` : '',
            line.uom ? esc(line.uom) : '',
            line.hsn_sac
                ? `<span title="${esc(lineTaxHint(state, line))}">HSN <span class="lip-mono">${esc(line.hsn_sac)}</span></span>`
                : '',
            line.category_name ? esc(line.category_name) : '',
        ].filter(Boolean);

        // The note truncates in a narrow container, so the full text has to stay
        // reachable — a fact you cannot read is not a fact you shipped.
        const plain = [line.sku, line.uom, line.hsn_sac ? `HSN ${line.hsn_sac}` : '',
                       line.category_name].filter(Boolean).join(' \u00b7 ');
        const provenance = bits.length
            ? `<span class="lip-prov" title="${esc(plain)}">${
                   bits.join('<span class="lip-dot">·</span>')}</span>`
            : '';

        // ⭐ TWO DIFFERENT FACTS, NOT ONE.
        //
        // `.lip-flag` used to mean "no longer sold" here and "no unit size" in
        // attachItem — one class carrying two meanings, one per renderer, which
        // is exactly the split this file just removed. Both are rendered here
        // now, and they can both be true.
        const withdrawn = line.no_longer_sellable
            ? '<span class="lip-flag" title="The catalogue no longer sells this product">no longer sold</span>'
            : '';

        // Only knowable when the product is chosen — the saved line does not
        // carry it — and that is the moment it matters, while another product
        // can still be picked instead.
        const unreservable = line.cannot_be_reserved
            ? '<span class="lip-flag" title="This product is stocked but has no unit size, '
              + 'so it cannot be reserved">no unit size</span>'
            : '';

        return provenance + withdrawn + unreservable;
    }

    function row(line, index, state) {
        const { canEdit, currency } = state;
        const isCatalogue = !!line.item_id;
        // A catalogue line the server has not priced yet has no total yet — the
        // same judgement refreshTotals makes, and the two must agree or the
        // figure changes character on the next keystroke.
        const awaitingPrice = isCatalogue
            && (line.unit_price === '' || line.unit_price === null || line.unit_price === undefined);
        const total = awaitingPrice
            ? 'on save'
            : money(lineTotal(line.quantity, line.unit_price), currency);

        // ⭐⭐⭐ ONE CONTROL HEIGHT, ONE BASELINE, NO EXCEPTIONS.
        //
        // The previous version sized every control independently and top-aligned
        // them: the name ended up ~24px, the numbers ~27px, the total was text
        // offset by 8px of padding, and the account field ~21px on a band of its
        // own. Four heights and three baselines on what is supposed to read as a
        // single row. No amount of padding fixes that — the controls have to
        // SHARE a height, which is what --lip-h does.
        //
        // A line is a worked calculation with a subject:
        //
        //   band 1  thumb · name ······················ qty × price = total · ×
        //   band 2  SKU · unit · HSN · category · stock · account code
        //
        // Everything interactive lives in band 1 at exactly one height.
        // Band 2 is provenance — a document footnote, not a second row of
        // controls competing with the first.
        const name = canEdit
            // The name is the longest thing on the line and the first to be cut:
            // "…Shampoo 1000 ml" renders as "…Shampoo 1000 m", and a size that
            // reads as a different size is worse than one that is absent. The
            // input scrolls, but only if you already know to look — so the whole
            // value stays readable on hover.
            ? `<input type="text" class="lip-f lip-f-name" data-lip-field="description"
                      maxlength="${MAX_DESCRIPTION}" value="${esc(line.description)}"
                      title="${esc(line.description)}"
                      placeholder="Describe this line"
                      aria-label="Line ${index + 1} description">`
            : `<span class="lip-f lip-f-name lip-f-ro"
                     title="${esc(line.description)}">${esc(line.description)}</span>`;

        // THE ARITHMETIC COLUMN — the one place this design spends boldness.
        //
        // qty × price = total, in tabular mono, with the operators as muted
        // glyphs. Read down a quote and the decimal points form a true vertical
        // line and the sum visibly builds. It is the artifact's own vernacular —
        // a quote IS a worked ledger — and it is functional: the column can be
        // audited by eye, which a row of boxed inputs cannot.
        const sum = canEdit
            ? `<input type="number" class="lip-f lip-n lip-n-qty" data-lip-field="quantity"
                      step="0.001" min="0.001" value="${esc(line.quantity)}"
                      aria-label="Line ${index + 1} quantity">
               <span class="lip-op" aria-hidden="true">&times;</span>
               <input type="number" class="lip-f lip-n lip-n-price" data-lip-field="unit_price"
                      step="0.01" min="0" value="${esc(line.unit_price)}"
                      aria-label="Line ${index + 1} unit price"
                      ${isCatalogue ? `readonly placeholder="—" title="${
                          // Two states, as the deleted painter had. The generic
                          // sentence never said the thing that matters: WHY the
                          // number can change when the quote is saved.
                          line.unit_price === '' || line.unit_price === null || line.unit_price === undefined
                              ? 'This price comes from the product catalogue'
                              : 'The catalogue price. If this customer has an agreed rate it replaces this on save.'
                      }"` : ''}>
               <span class="lip-op" aria-hidden="true">=</span>`
            : `<span class="lip-f lip-n lip-n-ro">${esc(line.quantity)}</span>
               <span class="lip-op" aria-hidden="true">&times;</span>
               <span class="lip-f lip-n lip-n-ro">${esc(money(line.unit_price, currency))}</span>
               <span class="lip-op" aria-hidden="true">=</span>`;

        return `
        <div class="lip-row${isCatalogue ? ' is-catalogue' : ''}" data-lip-row="${index}"${
            isCatalogue ? ` data-lip-item="${esc(line.item_id)}"` : ''}>

            <div class="lip-band">
                ${isCatalogue ? productThumb(line) : '<span class="lip-thumb-gap" aria-hidden="true"></span>'}
                ${name}
                <div class="lip-sum">${sum}</div>
                <div class="lip-f lip-n lip-n-total${awaitingPrice ? ' lip-n-pending' : ''}" data-lip-cell="total">${esc(total)}</div>
                ${canEdit ? `
                <button type="button" class="lip-kill" data-lip="remove"
                        aria-label="Remove line ${index + 1}">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>` : '<span class="lip-kill-gap" aria-hidden="true"></span>'}
            </div>

            ${
            // An empty band still costs its min-height plus its margin. For a
            // read-only free-text line there is no provenance, no stock badge, no
            // pick control and no account code — nothing at all — so the strip was
            // 23px of dead space on every such line. Emit it only when it has
            // something to hold.
            // isCatalogue is not the same question as "productMeta will render
            // something". A catalogue line with no sku, uom, HSN or category —
            // a non-stocked service item is the ordinary case — passed the
            // condition and then rendered an empty strip, which is exactly the
            // 23px of dead space this condition was added to remove. Ask the
            // renderer instead of a proxy for it.
            (productMeta(line, state) || stockBadge(line) || canEdit || line.account_code) ? `
            <div class="lip-note-line">
                ${isCatalogue ? productMeta(line, state) : ''}
                ${stockBadge(line)}
                ${canEdit ? `
                <button type="button" class="lip-pick" data-lip="${isCatalogue ? 'unpick' : 'pick'}" hidden
                        title="${isCatalogue ? 'Remove the product from this line' : 'Choose a product from the catalogue'}">${
                            isCatalogue ? 'Remove product' : 'Choose product'}</button>
                <input type="text" class="lip-f lip-acct" data-lip-field="account_code" maxlength="40"
                       value="${esc(line.account_code || '')}" placeholder="Account code"
                       aria-label="Line ${index + 1} account code">`
                : // ⚠⚠ READ-ONLY HAS NOW LOST THIS TWICE. DO NOT MAKE IT THREE.
                  //
                  // The account code lives in the editing strip, and that strip is
                  // editor-only — so a viewer who could see the code in the table
                  // layout stopped seeing it, silently, in the card rewrite. It was
                  // restored with a comment saying exactly that, and THIS rewrite
                  // deleted the render and the comment together.
                  //
                  // Both times it was found by diffing what the old row rendered
                  // against what the new one does. Never by looking at the screen:
                  // the viewer sees a line that looks complete.
                  //
                  // canEdit is false for a team member when the tenant has
                  // allow_member_deal_edits off (deals.js -> canEditDealFinancial),
                  // and the API returns account_code regardless. So this is a real
                  // reader losing a real value, not a hypothetical.
                  (line.account_code
                      ? `<span class="lip-acct-ro" title="Account code">${esc(line.account_code)}</span>`
                      : '')}
            </div>` : ''}

            ${isCatalogue && line.item_description
                ? `<p class="lip-blurb" title="${esc(line.item_description)}">${esc(line.item_description)}</p>`
                : ''}
        </div>`;
    }

    // ─── The product picker ─────────────────────────────────────────────────

    /**
     * Whether this workspace has a catalogue at all.
     *
     * Asked ONCE and remembered. Most tenants sell services and have no
     * catalogue; asking per keystroke would be a round trip per character to
     * learn the same "no" every time.
     */
    let catalogueAvailable = null;

    async function catalogueIsAvailable() {
        if (catalogueAvailable !== null) return catalogueAvailable;
        try {
            const res = await api.request('/crm/deals/catalogue/search?q=&limit=1');
            catalogueAvailable = !!res.available;
        } catch (e) {
            // An outage is not an absence — but for the purpose of "should the
            // button be here", both mean "not right now". Left unlatched so a
            // later attempt can succeed.
            return false;
        }
        return catalogueAvailable;
    }

    async function searchCatalogue(query) {
        try {
            const res = await api.request(
                `/crm/deals/catalogue/search?q=${encodeURIComponent(query || '')}&limit=20`);
            return res.available ? (res.items || []) : [];
        } catch (e) {
            Toast.error(e.message || 'The catalogue did not answer — nothing has been changed.');
            return [];
        }
    }

    /**
     * Attach a product to a row.
     *
     * The price is deliberately NOT set from the item's list price here. The
     * server prices the line against this customer's price list and returns the
     * real figure on save; writing the list price now would show a number that
     * changes under the rep the moment they save, for a contracted account.
     */
    /**
     * ⭐⭐⭐ ONE RENDERER. THIS IS THE PERMANENT FIX.
     *
     * attachItem and detachItem used to PAINT the row: set attributes, build
     * spans, flip the button, swap the thumbnail. row() paints it too, from the
     * model. Two renderers for one row, and every defect found in this panel was
     * the two of them disagreeing:
     *
     *   · product details vanished on "Add line"  — attach painted, model never learned
     *   · the product's name stayed after Remove   — detach's set ⊂ attach's set
     *   · the price showed 0                       — attach set readonly and the
     *                                                placeholder, but not the value
     *   · photo and description were not restored  — attach's set ⊂ detach's set
     *   · "no unit size" vs "no longer sold"       — one class, two meanings, one
     *                                                per renderer
     *
     * Each was fixed on its own, and the next one arrived from a direction the
     * last fix did not cover, because the SHAPE was never addressed: any fact
     * one renderer knows and the other does not is a bug waiting for a
     * re-render. Guards can catch instances. Only deleting the second renderer
     * makes the class impossible.
     *
     * So these now write to the MODEL and re-render. row() is the only thing
     * that turns a line into markup. A fact added next year is rendered once, by
     * construction, and cannot be lost by a path nobody thought to update.
     *
     * (This removed ~270 lines of DOM mutation and the two model-sync helpers
     * that existed solely to keep the two renderers in step.)
     */
    function attachItem(container, tr, item) {
        const st = mounted.get(container);
        if (!st) return;

        // ⭐⭐⭐ THE ROW MAY NOT BE THERE ANY MORE.
        //
        // openPicker captures this element, then awaits a catalogue round trip
        // BEFORE the overlay exists — the panel is fully clickable throughout.
        // Delete another row in that window and this node is detached, still
        // carrying its old data-lip-row. Reading an index off it then writes the
        // product onto whichever line now sits at that position: its SKU,
        // thumbnail and readonly price appear on the wrong quote line, and it
        // saves that way. The description does not change, so the swap is easy
        // to miss entirely.
        //
        // isConnected is the whole test. Refusing is right: there is no way to
        // know which line the rep meant once their target has moved, and a
        // wrong line on a customer's quote is worse than asking again.
        if (!tr.isConnected) {
            Toast.error('That line changed while the catalogue was open — pick the product again.');
            return;
        }

        const idx = Number(tr.getAttribute('data-lip-row'));
        // Typed values first, or picking a product discards edits made since the
        // last save. All three callers of readLines read before they mutate.
        st.lines = readLines(container);
        const line = st.lines[idx];
        if (!line) return;

        const hasList = item.list_price !== null && item.list_price !== undefined;
        // A description the rep typed is theirs and survives; an empty one is
        // filled from the product, and remembered as ours so detach can undo
        // exactly that and nothing else.
        const typed = String(line.description ?? '').trim();

        Object.assign(line, {
            item_id: item.id,
            description: typed || item.name || '',
            // What we filled, so detach can compare the live text against it.
            // A boolean ("we filled it") cannot tell that the rep has since
            // rewritten the field; the text can.
            description_auto: typed ? null : (item.name || ''),
            unit_price: hasList ? item.list_price : '',
            image_url: item.image_url ?? null,
            image_count: item.image_count ?? 0,
            item_description: item.description ?? null,
            sku: item.sku ?? null,
            uom: item.sale_unit ?? null,
            category_name: item.category_name ?? null,
            no_longer_sellable: item.is_sellable === false,
            // Only knowable at pick time — the saved line does not carry it —
            // and this is the moment it matters, when another product can still
            // be chosen instead.
            cannot_be_reserved: !!(item.tracks_stock && !item.can_be_reserved),
        });

        render(container);
        refreshTotals(container);
    }

    function detachItem(container, tr) {
        const st = mounted.get(container);
        if (!st || !tr || !tr.isConnected) return;   // same reasoning as attach
        const idx = Number(tr.getAttribute('data-lip-row'));
        st.lines = readLines(container);
        const line = st.lines[idx];
        if (!line) return;

        // ⭐⭐⭐ COMPARE THE LIVE TEXT. A LATCHED FLAG CANNOT SEE AN EDIT.
        //
        // This asked `line.description_from_item === true` — a boolean set when
        // the product was picked and never cleared when the rep rewrote the
        // field. So a description they typed themselves was wiped on Remove
        // product, with no confirm and no undo.
        //
        // The code this replaced compared the live VALUE against what attach had
        // filled in, which is correct and is what happens here: the description
        // goes only if it is still, character for character, the product's name.
        const clearDescription =
            String(line.description ?? '') === String(line.description_auto ?? '\u0000');

        st.lines[idx] = stripProductFacts({
            ...line,
            item_id: null,
            description: clearDescription ? '' : line.description,
            // ⭐⭐⭐ THE PRICE STAYS. BLANKING IT SAVED THE LINE AT ZERO.
            //
            // This set unit_price: '' — "leave the field empty for them to fill".
            // But the awaitingPrice guard that stops an empty price rendering as
            // ₹0.00 is gated on the line being a CATALOGUE line, and this line
            // has just stopped being one. So both renderers fell through to
            // lineTotal(q, '') === 0 and the row read `5 × ⌷ = ₹0.00`.
            //
            // Worse, it SAVED that way: save() does Number('') === 0, which
            // passes validation, and posts unit_price: 0 with item_id: null — so
            // the server has nothing to re-price from. Two clicks and no warning
            // took a ₹2,342.50 line to zero and dropped the deal value with it.
            //
            // Keeping the figure is also what the rep means: they are converting
            // a catalogue line to free text, not giving the goods away. The
            // field becomes editable (row() only marks it readonly for a
            // catalogue line), so they can change it.
            unit_price: line.unit_price,
        });

        render(container);
        refreshTotals(container);
    }

    /**
     * A self-contained chooser.
     *
     * Built and destroyed here rather than driven by a shared Modal helper —
     * there isn't one. This codebase's convention is an overlay plus a panel
     * toggled with `.active`, and this panel already renders all of its own
     * markup, so the picker owns its element and removes it on close.
     */
    async function openPicker(container, tr) {
        // The deal's currency, for showing each product's price in the picker.
        // The item carries its own (Accounts is single-currency per tenant) and
        // that wins; this is only the fallback when it sends none.
        const currency = (mounted.get(container) || {}).currency;
        const items = await searchCatalogue('');

        const overlay = document.createElement('div');
        overlay.className = 'lip-picker-overlay active';
        overlay.innerHTML = `
            <div class="lip-picker" role="dialog" aria-modal="true" aria-label="Choose a product">
                <div class="lip-picker-head">
                    <h3>Choose a product</h3>
                    <button type="button" class="lip-picker-close" aria-label="Close">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <input type="search" class="lip-picker-q" placeholder="Search by name or SKU" aria-label="Search products">
                <div class="lip-picker-list"></div>
            </div>`;
        document.body.appendChild(overlay);

        const list = overlay.querySelector('.lip-picker-list');
        let found = items.slice();

        /**
         * A product this deal cannot carry: the catalogue prices it in one
         * currency and the deal is denominated in another.
         *
         * Deliberately false when either side is unknown — an item with no
         * currency is refused by the server for a DIFFERENT and better-stated
         * reason ("came back with no currency"), and pre-empting it here would
         * put the wrong explanation in front of the rep.
         */
        const wrongCurrency = (i) =>
            !!i.currency && !!currency &&
            String(i.currency).toUpperCase() !== String(currency).toUpperCase();

        /**
         * ⭐⭐⭐ A PRODUCT THIS QUOTE ALREADY SELLS.
         *
         * Picking the same catalogue item onto a second line produces two rows
         * quoting the same thing at the same price, which is a mistake ~always:
         * the rep wanted more units, and the remedy is the quantity box on the
         * line that already exists.
         *
         * Excludes the row being edited, so re-picking the SAME product onto the
         * line that already has it is not blocked — that is a no-op, not a
         * duplicate, and refusing it would be baffling.
         *
         * Read from the DOM rather than st.lines because the picker can be
         * opened on a row whose product was chosen a moment ago and not yet
         * saved — the DOM is what is true right now.
         */
        const alreadyOnQuote = (i) => {
            const id = String(i.id);
            return [...container.querySelectorAll('[data-lip-row]')]
                .filter(row => row !== tr)
                .some(row => row.getAttribute('data-lip-item') === id);
        };

        const draw = (rows) => {
            list.innerHTML = rows.length
                ? rows.map(i => `
                    <button type="button" class="lip-picker-row${
                            (wrongCurrency(i) || alreadyOnQuote(i)) ? ' is-unavailable' : ''}" data-pick="${esc(i.id)}"${
                            wrongCurrency(i)
                                ? ` disabled aria-disabled="true" title="Priced in ${esc(i.currency)}; this deal is in ${esc(currency)}"`
                                : alreadyOnQuote(i)
                                ? ' disabled aria-disabled="true" title="Already on this quote — change the quantity on that line instead"'
                                : ''}>
                        ${productThumb({ image_url: i.image_url, image_count: i.image_count,
                                         description: i.name, sku: i.sku })}
                        <span class="lip-picker-body">
                            <span class="lip-picker-name">${esc(i.name)}</span>
                            ${i.description
                                ? `<span class="lip-picker-desc">${esc(i.description)}</span>`
                                : ''}
                            <span class="lip-picker-meta">${[
                                i.sku ? `<span class="lip-chip lip-chip-sku">${esc(i.sku)}</span>` : '',
                                i.sale_unit ? `<span class="lip-chip">${esc(i.sale_unit)}</span>` : '',
                                i.category_name ? `<span class="lip-chip lip-chip-cat">${esc(i.category_name)}</span>` : '',
                                // "Cannot be reserved" is a real caveat at the moment
                                // of choosing, not after saving.
                                i.tracks_stock && !i.can_be_reserved
                                    ? '<span class="lip-chip lip-chip-warn">no unit size</span>' : '',
                                // ⭐ A CAVEAT AT THE MOMENT OF CHOOSING, like the
                                // one above it. The server refuses a product
                                // priced in another currency, correctly — but it
                                // refused on SAVE, so the rep picked a product,
                                // typed a quantity, pressed Save and only then
                                // got a red toast. The fact was knowable here all
                                // along: the item carries its currency and the
                                // panel knows the deal's.
                                wrongCurrency(i)
                                    ? `<span class="lip-chip lip-chip-warn">priced in ${esc(i.currency)}</span>` : '',
                                // Same principle as the currency chip beside it:
                                // the rep learns at the moment of choosing, not
                                // by ending up with two identical lines and
                                // noticing later — or not noticing.
                                alreadyOnQuote(i)
                                    ? '<span class="lip-chip lip-chip-warn">already on this quote</span>' : '',
                            ].filter(Boolean).join('')}</span>
                        </span>
                        <span class="lip-picker-right">
                            <span class="lip-picker-price">${esc(money(i.list_price, i.currency || currency))}</span>
                            ${
                                // Availability where it is a meaningful question.
                                // Absent for a non-stocked item rather than "0".
                                i.available !== null && i.available !== undefined
                                    ? `<span class="lip-picker-stock ${i.available > 0 ? 'ok' : 'none'}">${esc(i.available)}${
                                        i.stock_uom ? ' ' + esc(i.stock_uom) : ''}</span>`
                                    : ''}
                        </span>
                    </button>`).join('')
                : '<div class="lip-picker-empty">Nothing matches that.</div>';

            // ⭐⭐⭐ WHEN NOTHING HERE CAN BE CHOSEN, SAY WHY, AND SAY WHAT TO DO.
            //
            // A tenant whose catalogue is in one currency and whose deals are in
            // another gets a picker where every row is disabled. Twenty greyed
            // rows and no explanation is worse than the red toast it replaced.
            // Measured on the demo tenant: all 29 deals in USD, catalogue in INR
            // — the feature was unreachable from any deal and nothing said so.
            //
            // The banner states the two facts and the one action. It is not a
            // refusal the rep can argue with; it is the missing sentence.
            const blocked = rows.length > 0 && rows.every(wrongCurrency);
            if (blocked) {
                const ccy = rows[0].currency;
                list.insertAdjacentHTML('afterbegin', `
                    <div class="lip-picker-blocked">
                        <strong>This deal is in ${esc(currency)}; the catalogue is priced in ${esc(ccy)}.</strong>
                        Change the deal's currency to ${esc(ccy)} to add products to it.
                    </div>`);
            }
        };
        draw(found);

        const close = () => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
        };
        const onKey = (ev) => { if (ev.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);

        overlay.querySelector('.lip-picker-close').addEventListener('click', close);
        // Backdrop only — a click inside the dialog must not dismiss it.
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

        let timer = null;
        overlay.querySelector('.lip-picker-q').addEventListener('input', (ev) => {
            // Debounced: a lookup per keystroke is a round trip per keystroke.
            clearTimeout(timer);
            const q = ev.target.value;
            timer = setTimeout(async () => { found = await searchCatalogue(q); draw(found); }, 250);
        });

        list.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-pick]');
            if (!btn) return;
            const item = found.find(i => String(i.id) === btn.getAttribute('data-pick'));
            // A disabled <button> swallows clicks in every browser we support,
            // so this is belt and braces — but the row is also reachable by
            // keyboard in some assistive tooling, and attaching a product the
            // server will refuse is exactly the outcome this change removes.
            if (item && (wrongCurrency(item) || alreadyOnQuote(item))) return;
            if (item) {
                // One call: the model is updated and the row re-rendered from it.
                attachItem(container, tr, item);
            }
            close();
        });

        overlay.querySelector('.lip-picker-q').focus();
    }

    /**
     * Show the product buttons only where a catalogue exists.
     *
     * Re-run after every render, because the panel rebuilds its rows on save
     * and on add/remove and new rows come back hidden.
     */
    async function revealPickersIfAvailable(container) {
        if (!(await catalogueIsAvailable())) return;
        container.querySelectorAll('.lip-pick').forEach(b => { b.hidden = false; });
    }

    // ─── Reading the form back ──────────────────────────────────────────────

    /**
     * The lines as currently typed.
     *
     * ⭐ READ FROM THE DOM, NEVER FROM state.lines.
     * The rows are re-rendered only on load and on save, so between those the
     * inputs are the truth. Serialising the state object instead would post the
     * values the panel was BUILT with and throw away everything just typed —
     * a save that reports success and changes nothing.
     */
    /**
     * ⭐⭐⭐ THE DOM HOLDS WHAT WAS TYPED. IT DOES NOT HOLD WHAT THE SERVER SAID.
     *
     * This returned five keys — description, quantity, unit_price, account_code,
     * item_id — because those are the five things a row lets you EDIT. And
     * addLine, removeLine and save all do `st.lines = readLines(container)`,
     * which throws away every fact the row does not have an input for:
     * image_url, image_count, item_description, sku, uom, hsn_sac,
     * category_name, no_longer_sellable, enough_in_stock, available_base,
     * stock_uom.
     *
     * `isCatalogue` survives (it keys off item_id), so the re-render kept the
     * readonly price and the "Remove product" button while the photo fell back
     * to the grey placeholder, and the SKU, HSN, category, stock badge and
     * description all silently vanished — from EVERY catalogue row, on the
     * panel's primary button, until the next save and reload.
     *
     * This is the third time the same set has been lost by a third path. The
     * first two were attachItem and detachItem, and the commit that fixed those
     * said "the set is now the set" — a claim scoped, without saying so, to the
     * two paths I happened to be looking at. Enumerating the CALLERS of the
     * thing that drops the set is what finds the third.
     *
     * So the typed values are merged ONTO the line they came from. All three
     * callers read before they mutate, so row index still maps to st.lines.
     */
    function readLines(container) {
        const st = mounted.get(container);
        const existing = st?.lines || [];
        return Array.from(container.querySelectorAll('[data-lip-row]')).map((tr, i) => {
            const idx = Number(tr.getAttribute('data-lip-row'));
            const from = existing[Number.isFinite(idx) ? idx : i] || {};
            return {
                ...from,
                description: tr.querySelector('[data-lip-field="description"]')?.value ?? '',
                quantity: tr.querySelector('[data-lip-field="quantity"]')?.value ?? '',
                unit_price: tr.querySelector('[data-lip-field="unit_price"]')?.value ?? '',
                account_code: tr.querySelector('[data-lip-field="account_code"]')?.value ?? '',
                // Read back off the ROW. Without this the catalogue link is lost on
                // save and the line silently becomes free text.
                item_id: tr.getAttribute('data-lip-item') || null,
            };
        }).map(l => l.item_id ? l : stripProductFacts(l));
    }

    /**
     * Everything that belonged to a product, removed when the row no longer
     * names one. Carrying the facts forward is right for a row that still sells
     * the same product and wrong for one that has been unpicked — the row would
     * keep the old SKU, photo and stock while claiming to be free text.
     */
    function stripProductFacts(line) {
        const {
            image_url, image_count, item_description, sku, uom, hsn_sac,
            category_name, no_longer_sellable, enough_in_stock, available_base,
            stock_uom,
            // Set when a product is attached; meaningless once it is not.
            cannot_be_reserved, description_auto,
            ...rest
        } = line;
        return rest;
    }

    function refreshTotals(container) {
        const st = mounted.get(container);
        if (!st) return;
        let total = 0;
        container.querySelectorAll('[data-lip-row]').forEach(tr => {
            const q = tr.querySelector('[data-lip-field="quantity"]')?.value;
            const p = tr.querySelector('[data-lip-field="unit_price"]')?.value;
            // ⭐ A CATALOGUE LINE WITH NO PRICE YET HAS NO TOTAL YET.
            //
            // `5 × (nothing) = ₹0.00` states a fact — that this line is worth
            // nothing — which is false and alarming on a product the rep just
            // saw priced. Until the server prices it, the honest answer is that
            // we do not know.
            const awaitingPrice = tr.hasAttribute('data-lip-item') && String(p ?? '').trim() === '';
            const t = awaitingPrice ? 0 : lineTotal(q, p);
            total += t;
            const cell = tr.querySelector('[data-lip-cell="total"]');
            if (cell) {
                cell.textContent = awaitingPrice ? 'on save' : money(t, st.currency);
                cell.classList.toggle('lip-n-pending', awaitingPrice);
            }
        });
        // The total element only exists while there are lines — see shell().
        // Showing a running total of $0.00 beside a $400,000 deal claimed the
        // deal was worth nothing, when in fact it simply is not priced by lines.
        const el = container.querySelector('[data-lip="total"]');
        if (el) el.textContent = money(total, st.currency);
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    function addLine(container) {
        const st = mounted.get(container);
        const lines = readLines(container);
        if (lines.length >= MAX_LINES) {
            Toast.error(`A deal can have at most ${MAX_LINES} lines`);
            return;
        }
        // Rebuilt from what is TYPED plus the new blank row, so adding a line
        // does not discard edits made since the last save.
        st.lines = lines.concat([{ description: '', quantity: 1, unit_price: 0, account_code: '' }]);
        render(container);
        const rows = container.querySelectorAll('[data-lip-row]');
        rows[rows.length - 1]?.querySelector('[data-lip-field="description"]')?.focus();
    }

    function removeLine(container, tr) {
        const st = mounted.get(container);
        const index = Number(tr.getAttribute('data-lip-row'));
        const lines = readLines(container);
        lines.splice(index, 1);
        st.lines = lines;
        render(container);
    }

    async function save(container) {
        const st = mounted.get(container);
        const typed = readLines(container);

        // Checked here so the message lands beside the row rather than as a
        // toast after a round trip. The server refuses all of these too — this
        // is the courtesy in front of the gate, not the gate.
        for (let i = 0; i < typed.length; i++) {
            const l = typed[i];
            // A line that names a product already has words — the catalogue
            // supplies them. Demanding a typed description here rejected the
            // ordinary case of picking a product and typing nothing.
            if (!l.item_id && !String(l.description).trim()) { Toast.error(`Line ${i + 1} needs a description`); return; }
            const q = Number(l.quantity);
            if (!isFinite(q) || q <= 0) { Toast.error(`Line ${i + 1}: quantity must be more than zero`); return; }
            const p = Number(l.unit_price);
            if (!isFinite(p) || p < 0) { Toast.error(`Line ${i + 1}: a price cannot be negative`); return; }
        }

        // ⭐⭐⭐ "IN FLIGHT" IS STATE, NOT A PROPERTY OF ONE BUTTON.
        //
        // This disabled the button element and re-enabled it in `finally`. Any
        // render() in between replaces container.innerHTML, so shell() emits a
        // FRESH, ENABLED button and the finally re-enables a node that is no
        // longer in the document. Remove a product while a save is in flight and
        // Save is live again — two concurrent PUTs that each replace the whole
        // line set, with no ordering guarantee about which one wins.
        //
        // Now the state carries it and every render reproduces it, which is the
        // same lesson as the renderer collapse: a fact held only in the DOM is
        // lost the moment the DOM is rebuilt.
        st.saving = true;
        const btn = container.querySelector('[data-lip="save"]');
        if (btn) btn.disabled = true;
        try {
            const result = await api.request(
                `/crm/deals/${encodeURIComponent(st.dealId)}/line-items`,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        lines: typed.map(l => ({
                            description: String(l.description).trim(),
                            quantity: Number(l.quantity),
                            unit_price: Number(l.unit_price),
                            account_code: String(l.account_code || '').trim() || null,
                            // The server RE-PRICES a line that carries this and
                            // ignores the unit_price above, so the number on
                            // screen can never become the number quoted.
                            item_id: l.item_id || null,
                        })),
                    }),
                });

            st.lines = result.lines || [];
            st.currency = result.currency || st.currency;
            applyTotals(st, result);
            render(container);
            Toast.success(typed.length === 0
                ? 'Lines removed — this deal is priced by its value again'
                : 'Lines saved');

            // Tell whoever mounted us that the lines moved. The quote page uses
            // this to show or hide "Reserve stock", which is only meaningful
            // once a line actually sells goods.
            if (st.onSaved) { try { st.onSaved(st.lines); } catch (err) { console.error(err); } }

            // The deal value has just moved. Telling the page rather than
            // reloading it keeps the panel's own state, and a stale value on
            // screen beside a new total is exactly the kind of disagreement
            // that makes people distrust the number.
            document.dispatchEvent(new CustomEvent('crm:deal-value-changed', {
                detail: {
                    dealId: st.dealId,
                    // ⭐⭐ NO LINES MEANS THE VALUE DID NOT MOVE — DO NOT CLAIM IT DID.
                    //
                    // Removing every line hands pricing back to the deal's own
                    // value, and the server deliberately LEAVES deal_value alone
                    // in that case ("removing the lines must not zero a deal
                    // somebody priced by hand"). This announced result.total
                    // regardless, which is 0 for an empty set — so the screen
                    // showed a £0 deal while the database still held £300,000,
                    // and the real figure came back on the next reload.
                    //
                    // Measured live: chip $300,000.00 -> $0.00, server 300000.
                    // The toast beside it said "this deal is priced by its value
                    // again", which is exactly the value being wiped from view.
                    //
                    // Undefined rather than null: every listener coerces with
                    // Number(), and Number(null) is 0 — which is the wrong
                    // number, silently. Number(undefined) is NaN, which they
                    // already reject.
                    dealValue: result.priced_by_lines ? result.total : undefined,
                    currency: st.currency,
                    pricedByLines: result.priced_by_lines,
                },
            }));
        } catch (e) {
            console.error('Failed to save the line items:', e);
            Toast.error(e.message || 'Could not save the lines');
        } finally {
            st.saving = false;
            // The element captured above may have been replaced by a render
            // during the request, so clear the flag on whatever button is in the
            // document NOW as well as on the one we started with.
            const live = container.querySelector('[data-lip="save"]');
            if (live) live.disabled = false;
            if (btn && btn !== live) btn.disabled = false;
        }
    }

    async function raiseQuotation(container) {
        const st = mounted.get(container);
        const btn = container.querySelector('[data-lip="quote"]');
        if (btn) btn.disabled = true;
        try {
            const result = await api.request(
                `/crm/deals/${encodeURIComponent(st.dealId)}/quotation`, { method: 'POST' });

            st.hasQuotation = true;
            st.quotationNumber = result.proforma_number || null;
            render(container);

            // ⭐ "ALREADY RAISED" IS A DIFFERENT FACT FROM "RAISED".
            // Reporting both as success would imply a second quotation just went
            // out to the customer, and somebody would go looking for it.
            // ⭐ SAY WHAT IT IS FOR, NOT JUST THAT IT EXISTS.
            //
            // The rep was told a document number and nothing about the figure on
            // it — and the figure is the thing they repeat to the customer. The
            // amount comes from the PROFORMA (what Accounts computed), not from
            // the deal, so it cannot drift away from the document being named
            // beside it.
            const raisedFor = Number.isFinite(Number(result.total_amount))
                ? ` for ${money(result.total_amount, result.currency || st.currency)}`
                : '';
            Toast.success(result.already_existed
                ? `Quotation ${result.proforma_number || ''}${raisedFor} already exists for this deal`.trim()
                : `Quotation ${result.proforma_number || ''}${raisedFor} raised`.trim());
        } catch (e) {
            console.error('Failed to raise the quotation:', e);
            Toast.error(e.message || 'Could not raise the quotation');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ─── Mounting ───────────────────────────────────────────────────────────

    function render(container) {
        container.innerHTML = shell(mounted.get(container));
        // Every render rebuilds the rows, and a fresh row's product button
        // comes back hidden. Revealing only from mount() would mean the button
        // vanished the first time a rep added a line — the exact moment they
        // wanted it.
        revealPickersIfAvailable(container);
    }

    async function load(container) {
        const st = mounted.get(container);
        try {
            const result = await api.request(`/crm/deals/${encodeURIComponent(st.dealId)}/line-items`);
            st.lines = result.lines || [];
            st.currency = result.currency || st.currency;
            applyTotals(st, result);
        } catch (e) {
            console.error('Failed to load the line items:', e);
            st.lines = [];
        }
        render(container);
    }

    function mount(container, deal, opts = {}) {
        if (!container || !deal) return;
        const prev = mounted.get(container);
        mounted.set(container, {
            dealId: deal.id,
            currency: deal.currency || 'INR',
            canEdit: opts.canEdit !== false,
            // Fired after a successful save. Added for the quote page, which
            // shows a "Reserve stock" action only once the lines actually sell
            // goods — without a hook it could not know the lines had changed,
            // and a callback passed to a mount() that ignored it would have
            // been silently dead.
            onSaved: typeof opts.onSaved === 'function' ? opts.onSaved : null,
            // The drawer is 438px, which is not enough for this table — the
            // Total and Remove columns fall off the edge and the product picker
            // is unreachable. So the drawer offers a way OUT to the full page.
            // The quote page passes false: a link back to itself is furniture.
            showOpenFull: opts.showOpenFull !== false,
            lines: [],
            hasQuotation: !!deal.has_quotation,
            quotationNumber: deal.accounts_proforma_number || null,
            bound: prev ? prev.bound : false,
        });

        container.innerHTML = '<p class="lip-loading">Loading lines…</p>';
        load(container);

        if (mounted.get(container).bound) return;
        mounted.get(container).bound = true;

        // Delegated and bound ONCE. This panel re-renders on every save and on
        // every add/remove; a listener attached per render would fire one PUT
        // per render, and the count would climb with every edit.
        container.addEventListener('click', (e) => {
            if (e.target.closest('[data-lip="add"]')) return addLine(container);
            const rm = e.target.closest('[data-lip="remove"]');
            if (rm) return removeLine(container, rm.closest('[data-lip-row]'));
            // ⭐ THE HELP PANEL'S OPEN STATE IS STATE TOO.
            //
            // <details> keeps "open" in the DOM, and every render rebuilds the
            // DOM — so expanding the help and then picking a product snapped it
            // shut. Same shape as the save button: a fact held only in the DOM
            // does not survive a re-render.
            const help = e.target.closest('.crm-help > summary');
            if (help) {
                const st0 = mounted.get(container);
                if (st0) st0.helpOpen = !help.parentElement.open;
                return;   // let the browser do the toggling
            }

            if (e.target.closest('[data-lip="save"]')) return save(container);
            if (e.target.closest('[data-lip="quote"]')) return raiseQuotation(container);

            const pick = e.target.closest('[data-lip="pick"]');
            if (pick) return openPicker(container, pick.closest('[data-lip-row]'));

            const unpick = e.target.closest('[data-lip="unpick"]');
            if (unpick) {
                return detachItem(container, unpick.closest('[data-lip-row]'));
            }
        });


        container.addEventListener('input', (e) => {
            if (e.target.matches('[data-lip-field="quantity"], [data-lip-field="unit_price"]')) {
                refreshTotals(container);
            }
        });
    }

    // lineTotal and round2 are exported so anything else showing these numbers
    // uses the same arithmetic rather than re-deriving the rounding rule the
    // server actually applies.
    return { mount, lineTotal, round2, sum };
})();
