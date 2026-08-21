/**
 * Commission panel — what this deal earns, and where the payout has got to
 * ----------------------------------------------------------------------------
 * Every DSA, broker and insurance agent is paid on commission, and the CRM had
 * nowhere to record it: the number lived in a spreadsheet, so nothing in the
 * product could answer "what did I earn this month" or "which closed deals have
 * not paid out yet".
 *
 *   PATCH /crm/deals/{id}/commission          set or clear the terms
 *   PATCH /crm/deals/{id}/commission/status   advance the payout
 *
 * Usage:  CommissionPanel.mount(el, deal, { canEdit: true });
 *
 * ⭐ THE PREVIEW USES THE SAME ARITHMETIC AS THE SERVER, DELIBERATELY MIRRORED.
 * A rep typing 1.5% against ₹8,50,000 must see the figure they will be paid.
 * The mirror is the risk — two implementations of one rule — so it is confined
 * to `preview()` below, it rounds the same way (half up, matching the server's
 * AwayFromZero), and the moment the server answers, its number replaces the
 * preview rather than sitting beside it.
 */
const CommissionPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    const STATUS_LABEL = {
        pending: 'Not yet billed',
        invoiced: 'Invoiced',
        received: 'Received',
        written_off: 'Written off',
    };
    const STATUS_ORDER = ['pending', 'invoiced', 'received', 'written_off'];

    // Delegates to the ONE implementation in currencies.js. Four copies of this
    // helper each hard-coded 'en-IN', so a $400,000 deal rendered as
    // "$4,00,000.00" — lakh grouping reads as a different number to anybody
    // outside South Asia, on the figure the whole panel exists to show.
    function money(amount, currency) {
        return formatMoney(amount, currency);
    }

    /**
     * The live preview, mirroring CommissionCalculator on the server.
     * Half-up to 2dp — JS's toFixed rounds half away from zero for positive
     * values, which is the same rule, but it is done explicitly here so the
     * intent survives somebody "simplifying" it.
     */
    function preview(type, rate, flat, dealValue) {
        if (type === 'fixed') {
            const f = Number(flat);
            return isFinite(f) ? Math.round(f * 100) / 100 : null;
        }
        if (type === 'percent') {
            const r = Number(rate), v = Number(dealValue);
            if (!isFinite(r) || !isFinite(v)) return null;
            return Math.round(v * r) / 100;   // v * r / 100, rounded to 2dp, half up
        }
        return null;
    }

    function shell(state) {
        const d = state.deal;
        const type = d.commission_type || '';
        const isFinal = d.commission_amount !== null && d.commission_amount !== undefined;
        const effective = isFinal
            ? d.commission_amount
            : preview(type, d.commission_rate, d.commission_flat, d.deal_value);

        return `
        <div class="cmp">
            <div class="cmp-head">
                <h4 class="cmp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    Commission
                </h4>
                <span class="cmp-amount ${isFinal ? 'is-final' : ''}" data-cmp="amount">${esc(money(effective, d.currency))}</span>
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Commission</summary>
                <div class="crm-help-body">
                    <p>What this deal earns you — a percentage of the deal value, or a flat fee.
                       While the deal is open the figure follows the value as you negotiate.</p>
                    <p><em>The moment the deal is Won the amount is frozen: it becomes a record of
                       what was earned, so editing the deal afterwards never changes the payout.</em></p>
                </div>
            </details>

            ${isFinal ? finalMarkup(state) : termsMarkup(state, type)}
        </div>`;
    }

    function termsMarkup(state, type) {
        const d = state.deal;
        if (!state.canEdit) {
            return `<p class="cmp-readonly">${type
                ? `${esc(type === 'percent' ? d.commission_rate + '% of the deal value' : 'Flat fee')} — not yet earned.`
                : 'No commission set on this deal.'}
                <br><span class="cmp-hint">Only Team Leads, Managers and Admins can change this.</span></p>`;
        }
        return `
            <div class="cmp-form">
                <div class="cmp-types" role="group" aria-label="Commission type">
                    <button type="button" class="cmp-type${type === '' ? ' is-on' : ''}" data-cmp-type="">None</button>
                    <button type="button" class="cmp-type${type === 'percent' ? ' is-on' : ''}" data-cmp-type="percent">% of deal</button>
                    <button type="button" class="cmp-type${type === 'fixed' ? ' is-on' : ''}" data-cmp-type="fixed">Flat fee</button>
                </div>

                <div class="cmp-row" data-cmp-row="percent" ${type === 'percent' ? '' : 'hidden'}>
                    <label>Rate
                        <span class="cmp-input-wrap">
                            <input type="number" step="0.0001" min="0" max="100" data-cmp="rate"
                                   value="${d.commission_rate ?? ''}" placeholder="1.5">
                            <span class="cmp-suffix">%</span>
                        </span>
                    </label>
                </div>

                <div class="cmp-row" data-cmp-row="fixed" ${type === 'fixed' ? '' : 'hidden'}>
                    <label>Flat amount
                        <span class="cmp-input-wrap">
                            <span class="cmp-prefix">${esc(d.currency || '')}</span>
                            <input type="number" step="0.01" min="0" data-cmp="flat"
                                   value="${d.commission_flat ?? ''}" placeholder="2500">
                        </span>
                    </label>
                </div>

                <label class="cmp-notes-label">Notes
                    <textarea rows="2" data-cmp="notes" placeholder="e.g. payout 45 days after disbursal">${esc(d.commission_notes || '')}</textarea>
                </label>

                <div class="cmp-actions">
                    <span class="cmp-hint" data-cmp="hint"></span>
                    <button type="button" class="btn btn-sm btn-primary" data-cmp="save">Save commission</button>
                </div>
            </div>`;
    }

    function finalMarkup(state) {
        const d = state.deal;
        const status = d.commission_status || 'pending';
        const terms = d.commission_type === 'percent'
            ? `${d.commission_rate}% of ${money(d.deal_value, d.currency)}`
            : 'Flat fee';
        return `
            <div class="cmp-final">
                <p class="cmp-final-line">
                    <strong>Earned.</strong> ${esc(terms)} — frozen when this deal was won.
                </p>
                ${d.commission_paid_at ? `<p class="cmp-hint">Received ${esc(new Date(d.commission_paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}</p>` : ''}
                ${d.commission_notes ? `<p class="cmp-final-notes">${esc(d.commission_notes)}</p>` : ''}

                ${state.canEdit ? `
                <div class="cmp-track" role="group" aria-label="Payout status">
                    ${STATUS_ORDER.map(s => `
                        <button type="button" class="cmp-step${s === status ? ' is-on' : ''}${s === 'written_off' ? ' is-off' : ''}"
                                data-cmp-status="${s}" ${s === status ? 'disabled' : ''}>
                            ${esc(STATUS_LABEL[s])}
                        </button>`).join('')}
                </div>` : `<p class="cmp-readonly">${esc(STATUS_LABEL[status] || status)}</p>`}
            </div>`;
    }

    function refreshPreview(container) {
        const st = mounted.get(container);
        if (!st || st.deal.commission_amount != null) return;
        const type = st.pendingType ?? (st.deal.commission_type || '');
        const rate = container.querySelector('[data-cmp="rate"]')?.value;
        const flat = container.querySelector('[data-cmp="flat"]')?.value;
        const el = container.querySelector('[data-cmp="amount"]');
        if (el) el.textContent = money(preview(type, rate, flat, st.deal.deal_value), st.deal.currency);
    }

    async function save(container) {
        const st = mounted.get(container);
        const type = st.pendingType ?? (st.deal.commission_type || '');
        const rate = container.querySelector('[data-cmp="rate"]')?.value;
        const flat = container.querySelector('[data-cmp="flat"]')?.value;
        const notes = container.querySelector('[data-cmp="notes"]')?.value;

        // Caught here so the rep sees it beside the field rather than as a toast
        // after a round trip. The server refuses these too — this is not the
        // gate, it is the courtesy in front of it.
        if (type === 'percent' && (rate === '' || rate === undefined)) {
            Toast.error('Enter a rate, or choose None'); return;
        }
        if (type === 'fixed' && (flat === '' || flat === undefined)) {
            Toast.error('Enter an amount, or choose None'); return;
        }

        const btn = container.querySelector('[data-cmp="save"]');
        btn.disabled = true;
        try {
            const updated = await api.request(`/crm/deals/${encodeURIComponent(st.dealId)}/commission`, {
                method: 'PATCH',
                body: JSON.stringify({
                    commission_type: type === '' ? null : type,
                    commission_rate: type === 'percent' ? Number(rate) : null,
                    commission_flat: type === 'fixed' ? Number(flat) : null,
                    commission_notes: notes || null,
                }),
            });
            Toast.success('Commission saved');
            // Re-render from the SERVER's answer, not from what was typed: it
            // clears the unused side and rounds the rate, and showing the typed
            // values back would hide both.
            remount(container, updated);
        } catch (e) {
            console.error('Failed to save commission:', e);
            Toast.error(e.message || 'Could not save the commission');
        } finally {
            btn.disabled = false;
        }
    }

    async function setStatus(container, status) {
        const st = mounted.get(container);
        let notes = null;
        if (status === 'written_off') {
            notes = await Prompt.show({
                title: 'Write off this commission',
                message: 'Why is this being written off? This is kept on the deal.',
                placeholder: 'e.g. lender disputed the payout',
                confirmText: 'Write off',
            });
            if (notes === null) return;
            if (!String(notes).trim()) { Toast.error('A write-off needs a reason'); return; }
        }
        try {
            const updated = await api.request(
                `/crm/deals/${encodeURIComponent(st.dealId)}/commission/status`,
                { method: 'PATCH', body: JSON.stringify({ status, notes }) });
            Toast.success(`Commission marked ${STATUS_LABEL[status].toLowerCase()}`);
            remount(container, updated);
        } catch (e) {
            console.error('Failed to update commission status:', e);
            Toast.error(e.message || 'Could not update the payout');
        }
    }

    function remount(container, deal) {
        const st = mounted.get(container);
        mount(container, deal, { canEdit: st.canEdit });
    }

    /**
     * @param {HTMLElement} container
     * @param {object} deal  the deal as the API returned it (snake_case)
     * @param {{canEdit?: boolean}} [opts] canEdit gates the form. Presentation
     *        only — the API refuses a member's write regardless, because a
     *        control the server does not enforce is not a control.
     */
    function mount(container, deal, opts) {
        if (!container || !deal) return;
        const prev = mounted.get(container);
        mounted.set(container, {
            dealId: deal.id,
            deal,
            pendingType: null,
            canEdit: !!(opts && opts.canEdit),
            bound: prev ? prev.bound : false,
        });
        container.innerHTML = shell(mounted.get(container));

        if (mounted.get(container).bound) return;
        mounted.get(container).bound = true;

        container.addEventListener('input', (e) => {
            if (e.target.matches('[data-cmp="rate"], [data-cmp="flat"]')) refreshPreview(container);
        });

        // Delegated and bound once: this panel re-renders on every save, and a
        // listener re-added per render would fire one PATCH per render.
        container.addEventListener('click', (e) => {
            const typeBtn = e.target.closest('[data-cmp-type]');
            if (typeBtn) {
                const st = mounted.get(container);
                st.pendingType = typeBtn.getAttribute('data-cmp-type');
                container.querySelectorAll('[data-cmp-type]').forEach(b =>
                    b.classList.toggle('is-on', b === typeBtn));
                container.querySelectorAll('[data-cmp-row]').forEach(r =>
                    r.hidden = r.getAttribute('data-cmp-row') !== st.pendingType);
                refreshPreview(container);
                return;
            }
            const statusBtn = e.target.closest('[data-cmp-status]');
            if (statusBtn) return setStatus(container, statusBtn.getAttribute('data-cmp-status'));
            if (e.target.closest('[data-cmp="save"]')) return save(container);
        });
    }

    return { mount, preview };
})();

// ═══════════════════════════════════════════════════════════════════════════
//  Commission report — earned, outstanding and received for a month
// ═══════════════════════════════════════════════════════════════════════════
//
// Scoped by the server exactly like every other deal read: a rep sees their
// own, a manager their team's, an admin the tenant's. Nothing here filters —
// asking the client to narrow a money report is how a rep ends up looking at
// somebody else's pay.

function openCommissionReport() {
    const el = document.getElementById('commissionMonth');
    if (el && !el.value) {
        const now = new Date();
        el.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    document.getElementById('commissionReportOverlay')?.classList.add('active');
    document.getElementById('commissionReportPanel')?.classList.add('active');
    loadCommissionReport();
}

function closeCommissionReport() {
    document.getElementById('commissionReportOverlay')?.classList.remove('active');
    document.getElementById('commissionReportPanel')?.classList.remove('active');
}

async function loadCommissionReport() {
    const body = document.getElementById('commissionReportBody');
    if (!body) return;
    body.innerHTML = '<div class="crm-loading"><div class="crm-loading-spinner"></div></div>';

    const monthValue = document.getElementById('commissionMonth')?.value;
    if (!monthValue) { body.innerHTML = '<p class="cmr-empty">Pick a month.</p>'; return; }

    // ⭐ THE WINDOW IS BUILT IN UTC, deliberately.
    //
    // The server compares against a timestamptz column, and `new Date(y, m, 1)`
    // is LOCAL midnight — from IST that is 18:30 the previous day, so a deal
    // won on the 1st would land in the previous month's report and a deal won
    // on the last day would fall out of both. Date.UTC removes the offset
    // rather than hoping the two ends cancel.
    const [year, month] = monthValue.split('-').map(Number);
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));

    try {
        const res = await api.request(
            `/crm/deals/commission-summary?from=${from.toISOString()}&to=${to.toISOString()}`);
        renderCommissionReport(body, res);
    } catch (e) {
        console.error('Failed to load the commission report:', e);
        body.innerHTML = `<p class="cmr-empty">${escapeHtml(e.message || 'Could not load the commission report')}</p>`;
    }
}

function renderCommissionReport(body, res) {
    const rows = (res && res.rows) || [];
    if (!rows.length) {
        body.innerHTML = `<p class="cmr-empty">No commission earned in this month yet.
            A deal contributes here once it is <strong>Won</strong> and has commission terms set.</p>`;
        return;
    }

    // The SECOND copy in this file — the commission queue's own formatter. The
    // sweep that collapsed these onto formatMoney found it only by enumerating
    // every Intl currency call rather than one per file.
    const money = (n, c) => formatMoney(n, c);

    // Grouped by CURRENCY, with a per-currency subtotal and no grand total —
    // the API returns the currencies apart for exactly this reason and a single
    // figure across them would be a sum of incommensurable units.
    const byCurrency = {};
    for (const r of rows) (byCurrency[r.currency] ||= []).push(r);

    body.innerHTML = Object.entries(byCurrency).map(([currency, list]) => {
        const sum = k => list.reduce((a, r) => a + Number(r[k] || 0), 0);
        return `
        <section class="cmr-group">
            <header class="cmr-group-head">
                <h4>${escapeHtml(currency)}</h4>
                <span class="cmr-earned">${escapeHtml(money(sum('earned'), currency))} earned</span>
            </header>
            <div class="cmr-totals">
                <span><em>${escapeHtml(money(sum('outstanding'), currency))}</em> outstanding</span>
                <span><em>${escapeHtml(money(sum('received'), currency))}</em> received</span>
                ${sum('written_off') > 0
                    ? `<span class="is-off"><em>${escapeHtml(money(sum('written_off'), currency))}</em> written off</span>`
                    : ''}
            </div>
            <table class="cmr-table">
                <thead><tr><th>Owner</th><th>Deals</th><th>Earned</th><th>Outstanding</th><th>Received</th></tr></thead>
                <tbody>
                    ${list.map(r => `
                        <tr>
                            <td>${escapeHtml(r.owner_name || r.owner_user_id || 'Unassigned')}</td>
                            <td>${Number(r.deal_count || 0)}</td>
                            <td>${escapeHtml(money(r.earned, currency))}</td>
                            <td>${escapeHtml(money(r.outstanding, currency))}</td>
                            <td>${escapeHtml(money(r.received, currency))}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </section>`;
    }).join('');
}
