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
    }

    function totalsBlock(state, subtotal) {
        const { currency } = state;
        if (state.taxUnavailable) {
            return `
            <div class="lip-totals">
                <div class="lip-total-row"><span>Subtotal</span><b>${esc(money(subtotal, currency))}</b></div>
                <div class="lip-total-warn">
                    Tax could not be calculated just now, so this is the pre-tax total.
                </div>
            </div>`;
        }
        if (state.totalTax === null || state.totalTax === undefined) return '';
        return `
        <div class="lip-totals">
            <div class="lip-total-row"><span>Taxable</span><b>${esc(money(state.taxableTotal, currency))}</b></div>
            <div class="lip-total-row"><span>Tax</span><b>${esc(money(state.totalTax, currency))}</b></div>
            <div class="lip-total-row lip-total-grand"><span>Total</span><b>${esc(money(state.grandTotal, currency))}</b></div>
        </div>`;
    }

    function shell(state) {
        // The HSN/SAC column appears only when a line actually carries one.
        // A services quote priced in free text has no tax classification to
        // show, and an always-present column of dashes is noise on a document.
        const showHsn = (state.lines || []).some(l => l.hsn_sac);
        state.showHsn = showHsn;
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

            <details class="crm-help crm-help-sm">
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
            <div class="lip-table-wrap">
                <table class="lip-table">
                    <thead>
                        <tr>
                            <th class="lip-col-desc">Description</th>
                            ${showHsn ? '<th class="lip-col-hsn">HSN/SAC</th>' : ''}
                            <th class="lip-col-qty">Qty</th>
                            <th class="lip-col-price">Unit price</th>
                            <th class="lip-col-acct">Account</th>
                            <th class="lip-col-total">Total</th>
                            ${canEdit ? '<th class="lip-col-x"><span class="sr-only">Remove</span></th>' : ''}
                        </tr>
                    </thead>
                    <tbody data-lip="rows">
                        ${lines.map((l, i) => row(l, i, state)).join('')}
                    </tbody>
                </table>
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
                <button type="button" class="btn btn-sm btn-primary" data-lip="save">Save lines</button>
            </div>` : ''}

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

    function row(line, index, state) {
        const { canEdit, currency } = state;
        if (!canEdit) {
            return `
            <tr>
                <td class="lip-col-desc">${esc(line.description)}</td>
                ${state.showHsn ? `<td class="lip-col-hsn" title="${esc(lineTaxHint(state, line))}">${esc(line.hsn_sac || '—')}</td>` : ''}
                <td class="lip-col-qty">${esc(line.quantity)}</td>
                <td class="lip-col-price">${esc(money(line.unit_price, currency))}</td>
                <td class="lip-col-acct">${esc(line.account_code || '—')}</td>
                <td class="lip-col-total">${esc(money(lineTotal(line.quantity, line.unit_price), currency))}</td>
            </tr>`;
        }
        // ⭐ THE ITEM ID LIVES ON THE ROW, NOT IN A STATE OBJECT.
        //
        // readLines() rebuilds the payload from the DOM on every save, so a
        // catalogue reference held only in JavaScript state would be dropped
        // silently the moment the rep pressed Save — the line would post as
        // free text at whatever price was on screen. This service has already
        // shipped that exact bug once, on a different panel.
        const isCatalogue = !!line.item_id;
        return `
        <tr data-lip-row="${index}"${isCatalogue ? ` data-lip-item="${esc(line.item_id)}"` : ''} class="${isCatalogue ? 'lip-catalogue' : ''}">
            <td class="lip-col-desc">
                <input type="text" data-lip-field="description" maxlength="${MAX_DESCRIPTION}"
                       value="${esc(line.description)}" placeholder="e.g. Onboarding &amp; setup"
                       aria-label="Line ${index + 1} description">
                ${isCatalogue ? `<span class="lip-sku" title="${esc(line.uom ? 'Sold in ' + line.uom : '')}">${esc(line.sku || '')}${line.uom ? ' · ' + esc(line.uom) : ''}</span>` : ''}
                ${stockBadge(line)}
                <button type="button" class="lip-pick" data-lip="${isCatalogue ? 'unpick' : 'pick'}" hidden
                        title="${isCatalogue ? 'Remove the product from this line' : 'Choose a product from the catalogue'}">${
                            isCatalogue ? 'Remove product' : 'Choose product'}</button>
            </td>
            ${state.showHsn ? `<td class="lip-col-hsn" title="${esc(lineTaxHint(state, line))}">${esc(line.hsn_sac || '—')}</td>` : ''}
            <td class="lip-col-qty">
                <input type="number" data-lip-field="quantity" step="0.001" min="0.001"
                       value="${esc(line.quantity)}" aria-label="Line ${index + 1} quantity">
            </td>
            <td class="lip-col-price">
                <input type="number" data-lip-field="unit_price" step="0.01" min="0"
                       value="${esc(line.unit_price)}" aria-label="Line ${index + 1} unit price"
                       ${isCatalogue ? 'readonly title="This price comes from the product catalogue"' : ''}>
            </td>
            <td class="lip-col-acct">
                <input type="text" data-lip-field="account_code" maxlength="40"
                       value="${esc(line.account_code || '')}" placeholder="optional"
                       aria-label="Line ${index + 1} account code">
            </td>
            <td class="lip-col-total" data-lip-cell="total">${esc(money(lineTotal(line.quantity, line.unit_price), currency))}</td>
            <td class="lip-col-x">
                <button type="button" class="lip-x" data-lip="remove" aria-label="Remove line ${index + 1}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </td>
        </tr>`;
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
    function attachItem(tr, item) {
        tr.setAttribute('data-lip-item', item.id);
        tr.classList.add('lip-catalogue');

        const desc = tr.querySelector('[data-lip-field="description"]');
        if (desc && !desc.value.trim()) desc.value = item.name || '';

        const price = tr.querySelector('[data-lip-field="unit_price"]');
        if (price) {
            price.readOnly = true;
            price.title = 'This price comes from the product catalogue';
            price.placeholder = 'priced on save';
        }

        let sku = tr.querySelector('.lip-sku');
        if (!sku) {
            sku = document.createElement('span');
            sku.className = 'lip-sku';
            tr.querySelector('.lip-col-desc')?.appendChild(sku);
        }
        sku.textContent = [item.sku, item.sale_unit].filter(Boolean).join(' \u00b7 ');

        if (item.tracks_stock && !item.can_be_reserved) {
            sku.textContent += ' \u00b7 no unit size';
            sku.classList.add('lip-sku-warn');
        }

        // The control has to become its own opposite. Setting the row's
        // attributes without flipping the button left the rep able to attach a
        // product and with no way to take it off again until the next render —
        // and re-rendering only happens on save, which is exactly when a wrong
        // product becomes a wrong quote.
        const control = tr.querySelector('.lip-pick');
        if (control) {
            control.setAttribute('data-lip', 'unpick');
            control.textContent = 'Remove product';
            control.title = 'Remove the product from this line';
        }
    }

    function detachItem(tr) {
        tr.removeAttribute('data-lip-item');
        tr.classList.remove('lip-catalogue');
        const price = tr.querySelector('[data-lip-field="unit_price"]');
        if (price) { price.readOnly = false; price.title = ''; price.placeholder = ''; }
        tr.querySelector('.lip-sku')?.remove();

        // Flipped HERE rather than by the click handler, so attach and detach
        // are exact inverses and neither caller has to remember half the job.
        const control = tr.querySelector('.lip-pick');
        if (control) {
            control.setAttribute('data-lip', 'pick');
            control.textContent = 'Choose product';
            control.title = 'Choose a product from the catalogue';
        }
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

        const draw = (rows) => {
            list.innerHTML = rows.length
                ? rows.map(i => `
                    <button type="button" class="lip-picker-row" data-pick="${esc(i.id)}">
                        <span class="lip-picker-name">${esc(i.name)}</span>
                        <span class="lip-picker-meta">${esc(i.sku || '')}${i.sale_unit ? ' \u00b7 ' + esc(i.sale_unit) : ''}${
                            i.tracks_stock && !i.can_be_reserved ? ' \u00b7 no unit size' : ''}${
                            // Availability where it is a meaningful question.
                            // Absent for a non-stocked item rather than "0".
                            i.available !== null && i.available !== undefined
                                ? ` \u00b7 ${esc(i.available)}${i.stock_uom ? ' ' + esc(i.stock_uom) : ''} available`
                                : ''}</span>
                    </button>`).join('')
                : '<div class="lip-picker-empty">Nothing matches that.</div>';
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
            if (item) { attachItem(tr, item); refreshTotals(container); }
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
    function readLines(container) {
        return Array.from(container.querySelectorAll('[data-lip-row]')).map(tr => ({
            description: tr.querySelector('[data-lip-field="description"]')?.value ?? '',
            quantity: tr.querySelector('[data-lip-field="quantity"]')?.value ?? '',
            unit_price: tr.querySelector('[data-lip-field="unit_price"]')?.value ?? '',
            account_code: tr.querySelector('[data-lip-field="account_code"]')?.value ?? '',
            // Read back off the ROW. Without this the catalogue link is lost on
            // save and the line silently becomes free text.
            item_id: tr.getAttribute('data-lip-item') || null,
        }));
    }

    function refreshTotals(container) {
        const st = mounted.get(container);
        if (!st) return;
        let total = 0;
        container.querySelectorAll('[data-lip-row]').forEach(tr => {
            const q = tr.querySelector('[data-lip-field="quantity"]')?.value;
            const p = tr.querySelector('[data-lip-field="unit_price"]')?.value;
            const t = lineTotal(q, p);
            total += t;
            const cell = tr.querySelector('[data-lip-cell="total"]');
            if (cell) cell.textContent = money(t, st.currency);
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
                    dealValue: result.total,
                    currency: st.currency,
                    pricedByLines: result.priced_by_lines,
                },
            }));
        } catch (e) {
            console.error('Failed to save the line items:', e);
            Toast.error(e.message || 'Could not save the lines');
        } finally {
            if (btn) btn.disabled = false;
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
            if (e.target.closest('[data-lip="save"]')) return save(container);
            if (e.target.closest('[data-lip="quote"]')) return raiseQuotation(container);

            const pick = e.target.closest('[data-lip="pick"]');
            if (pick) return openPicker(container, pick.closest('[data-lip-row]'));

            const unpick = e.target.closest('[data-lip="unpick"]');
            if (unpick) {
                detachItem(unpick.closest('[data-lip-row]'));
                return refreshTotals(container);
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
