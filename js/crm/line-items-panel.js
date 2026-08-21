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
                <td class="lip-col-qty">${esc(line.quantity)}</td>
                <td class="lip-col-price">${esc(money(line.unit_price, currency))}</td>
                <td class="lip-col-acct">${esc(line.account_code || '—')}</td>
                <td class="lip-col-total">${esc(money(lineTotal(line.quantity, line.unit_price), currency))}</td>
            </tr>`;
        }
        return `
        <tr data-lip-row="${index}">
            <td class="lip-col-desc">
                <input type="text" data-lip-field="description" maxlength="${MAX_DESCRIPTION}"
                       value="${esc(line.description)}" placeholder="e.g. Onboarding &amp; setup"
                       aria-label="Line ${index + 1} description">
            </td>
            <td class="lip-col-qty">
                <input type="number" data-lip-field="quantity" step="0.001" min="0.001"
                       value="${esc(line.quantity)}" aria-label="Line ${index + 1} quantity">
            </td>
            <td class="lip-col-price">
                <input type="number" data-lip-field="unit_price" step="0.01" min="0"
                       value="${esc(line.unit_price)}" aria-label="Line ${index + 1} unit price">
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
            if (!String(l.description).trim()) { Toast.error(`Line ${i + 1} needs a description`); return; }
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
                        })),
                    }),
                });

            st.lines = result.lines || [];
            st.currency = result.currency || st.currency;
            render(container);
            Toast.success(typed.length === 0
                ? 'Lines removed — this deal is priced by its value again'
                : 'Lines saved');

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
            Toast.success(result.already_existed
                ? `Quotation ${result.proforma_number || ''} already exists for this deal`.trim()
                : `Quotation ${result.proforma_number || ''} raised`.trim());
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
    }

    async function load(container) {
        const st = mounted.get(container);
        try {
            const result = await api.request(`/crm/deals/${encodeURIComponent(st.dealId)}/line-items`);
            st.lines = result.lines || [];
            st.currency = result.currency || st.currency;
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
