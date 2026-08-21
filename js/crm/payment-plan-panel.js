/**
 * Instalment plan panel — the schedule a closed deal is actually paid on
 * ----------------------------------------------------------------------------
 * A deal was one number and one close date. Every business that sells on
 * instalments — education fees, gym memberships, real-estate bookings, B2B
 * contracts billed quarterly — tracked "who owes what this month" in a
 * spreadsheet, because the CRM had nowhere to say it.
 *
 * PaymentPlans already does all of it: schedule generation, part payments, an
 * aging dashboard and a dunning cadence. It had ZERO callers. This panel wires
 * the deal to it rather than reimplementing any of it here.
 *
 *   GET  /crm/deals/{id}/payment-plan   the schedule (204 when there is none)
 *   POST /crm/deals/{id}/payment-plan   open one
 *
 * ⭐ ONE SCHEDULE PER DEAL, PERMANENTLY. A second schedule is a second set of
 * automated payment demands chasing the same customer for the same money, so
 * the server refuses one and this panel never offers it.
 *
 * Usage:  PaymentPlanPanel.mount(el, deal, { canEdit: true });
 */
const PaymentPlanPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    const MIN_INSTALMENTS = 2;
    const MAX_INSTALMENTS = 120;

    const STATUS_LABEL = {
        pending: 'Due',
        partial: 'Part paid',
        paid: 'Paid',
        overdue: 'Overdue',
        waived: 'Waived',
        cancelled: 'Cancelled',
    };

    // Delegates to the ONE implementation in currencies.js. Four copies of this
    // helper each hard-coded 'en-IN', so a $400,000 deal rendered as
    // "$4,00,000.00" — lakh grouping reads as a different number to anybody
    // outside South Asia, on the figure the whole panel exists to show.
    function money(amount, currency) {
        return formatMoney(amount, currency);
    }

    /**
     * ⭐ A DUE DATE IS A CALENDAR DAY, AND THE PARSING FOR THAT ALREADY EXISTS.
     *
     * RenewalPanel got this wrong once — a DATE serialised without a zone marker
     * is parsed as LOCAL midnight, so round-tripping it through toISOString
     * walks it back a day from any zone east of UTC. Its fixed implementation is
     * exported precisely so panels like this one do not re-derive it and
     * re-introduce the same off-by-one.
     *
     * The dependency is asserted rather than silently defaulted: rendering every
     * due date as a dash because a script tag moved is a worse failure than a
     * loud one.
     */
    function humanDate(iso) {
        if (typeof RenewalPanel === 'undefined' || !RenewalPanel.humanDate) {
            console.error(
                'PaymentPlanPanel needs RenewalPanel for calendar-day parsing — ' +
                'load renewal-panel.js before payment-plan-panel.js');
            return '—';
        }
        return RenewalPanel.humanDate(iso);
    }

    /**
     * The chosen month, spelled out.
     *
     * ⭐ BUILT FROM THE MONTH ALONE, NEVER FROM month + day.
     * Composing "2026-02" with a due day of 31 gives "2026-02-31", which
     * new Date(2026, 1, 31) silently ROLLS OVER to 3 March — so the confirmation
     * would have promised a start date the schedule never uses, in the one
     * dialog whose job is to state exactly what is about to happen. The day is
     * reported separately because that is how the generator treats it.
     */
    function monthName(ym) {
        const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
        if (!m) return 'the selected month';
        return new Date(Number(m[1]), Number(m[2]) - 1, 1)
            .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    }

    /** 1st, 2nd, 3rd, 4th… 11th, 12th, 13th, 21st. */
    function ordinal(n) {
        const v = Math.floor(Number(n));
        if (!isFinite(v)) return String(n);
        const rem100 = v % 100;
        if (rem100 >= 11 && rem100 <= 13) return `${v}th`;
        switch (v % 10) {
            case 1: return `${v}st`;
            case 2: return `${v}nd`;
            case 3: return `${v}rd`;
            default: return `${v}th`;
        }
    }

    /** Today, as YYYY-MM, for the month picker's default and its floor. */
    function thisMonth() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * The instalment amounts, mirroring PaymentPlans' generator: equal parts
     * with the LAST absorbing the rounding residue, so the parts always sum to
     * the whole. Shown as a preview before committing, because "6 × ₹40,000"
     * is the thing the rep is actually agreeing with the customer.
     */
    function preview(total, count) {
        const t = Number(total), n = Math.floor(Number(count));
        if (!isFinite(t) || !isFinite(n) || n < 1) return null;
        const per = Math.round((t / n + Number.EPSILON) * 100) / 100;
        return { per, last: Math.round((t - per * (n - 1) + Number.EPSILON) * 100) / 100 };
    }

    // ─── Rendering ──────────────────────────────────────────────────────────

    function shell(state) {
        return `
        <div class="ppp">
            <div class="ppp-head">
                <h4 class="ppp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                    Instalment plan
                </h4>
                ${state.plan ? `<span class="ppp-outstanding">${esc(money(state.plan.outstanding_amount, state.plan.currency))} outstanding</span>` : ''}
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Instalment plan</summary>
                <div class="crm-help-body">
                    <p>Splits what this deal is worth into monthly instalments and hands the
                       schedule to Payment Plans, which chases each one as it falls due —
                       ten days before, three days before, on the day, then daily until paid.</p>
                    <p><em>A deal gets one schedule. Opening it again shows you the same one,
                       because a second schedule would chase the customer twice for the same
                       money.</em></p>
                </div>
            </details>

            ${state.loadError
                ? `<p class="ppp-error">${esc(state.loadError)}</p>`
                : state.plan ? scheduleMarkup(state) : openMarkup(state)}
        </div>`;
    }

    function openMarkup(state) {
        if (!state.canEdit) {
            return `<p class="ppp-readonly">No instalment plan on this deal.
                <br><span class="ppp-hint">Only Team Leads, Managers and Admins can open one.</span></p>`;
        }
        if (!state.companyId) {
            return `<p class="ppp-blocked">
                This deal needs a company before it can be scheduled — the instalments belong to
                a customer, not to a deal name.</p>`;
        }
        if (!(Number(state.dealValue) > 0)) {
            return `<p class="ppp-blocked">
                This deal has no value yet, so there is nothing to split into instalments.</p>`;
        }

        const p = preview(state.dealValue, state.count);
        return `
            <div class="ppp-form">
                <div class="ppp-fields">
                    <label>Instalments
                        <input type="number" data-ppp="count" min="${MIN_INSTALMENTS}" max="${MAX_INSTALMENTS}"
                               step="1" value="${esc(state.count)}">
                    </label>
                    <label>Due on
                        <span class="ppp-input-wrap">
                            <input type="number" data-ppp="day" min="1" max="31" step="1" value="${esc(state.day)}">
                            <span class="ppp-suffix">of the month</span>
                        </span>
                    </label>
                    <label>First instalment
                        <input type="month" data-ppp="month" value="${esc(state.month)}">
                    </label>
                </div>

                <p class="ppp-preview" data-ppp="preview">${esc(previewText(state, p))}</p>
                <p class="ppp-hint">
                    A due day of 29, 30 or 31 falls on the last day of shorter months, so February
                    is billed rather than skipped.
                </p>

                <div class="ppp-actions">
                    <button type="button" class="btn btn-sm btn-primary" data-ppp="open">Open instalment plan</button>
                </div>
            </div>`;
    }

    function previewText(state, p) {
        if (!p) return '';
        const cur = state.currency;
        const n = Math.floor(Number(state.count));
        if (p.per === p.last) return `${n} × ${money(p.per, cur)}`;
        // The residue is stated rather than hidden — a rep reading "6 × ₹40,000"
        // against a total that is not divisible by six would be quoting a figure
        // the customer will not be billed.
        return `${n - 1} × ${money(p.per, cur)}, then ${money(p.last, cur)}`;
    }

    function scheduleMarkup(state) {
        const plan = state.plan;
        const rows = plan.installments || [];
        return `
            <div class="ppp-summary">
                <div class="ppp-stat"><span class="ppp-stat-label">Total</span><span>${esc(money(plan.total_amount, plan.currency))}</span></div>
                <div class="ppp-stat"><span class="ppp-stat-label">Paid</span><span>${esc(money(plan.paid_amount, plan.currency))}</span></div>
                <div class="ppp-stat"><span class="ppp-stat-label">Instalments</span><span>${rows.length}</span></div>
            </div>

            <div class="ppp-table-wrap">
                <table class="ppp-table">
                    <thead>
                        <tr>
                            <th class="ppp-col-no">#</th>
                            <th class="ppp-col-due">Due</th>
                            <th class="ppp-col-amt">Amount</th>
                            <th class="ppp-col-paid">Paid</th>
                            <th class="ppp-col-st">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length === 0
                            ? `<tr class="ppp-empty"><td colspan="5">
                                   This plan has no instalments yet. Milestone-driven plans create them
                                   as each milestone is reached.</td></tr>`
                            : rows.map(i => `
                            <tr class="ppp-row is-${esc(i.status || 'pending')}">
                                <td class="ppp-col-no">${esc(i.sequence_no)}</td>
                                <td class="ppp-col-due">${esc(humanDate(i.due_date))}</td>
                                <td class="ppp-col-amt">${esc(money(i.amount_due, plan.currency))}</td>
                                <td class="ppp-col-paid">${esc(money(i.amount_paid, plan.currency))}</td>
                                <td class="ppp-col-st"><span class="ppp-badge is-${esc(i.status || 'pending')}">${esc(STATUS_LABEL[i.status] || i.status || 'Due')}</span></td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>

            <p class="ppp-hint">
                Payments are recorded in Payment Plans; this is a read-only view of the schedule
                it is chasing.
            </p>`;
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    function refreshPreview(container) {
        const st = mounted.get(container);
        if (!st || st.plan) return;
        st.count = container.querySelector('[data-ppp="count"]')?.value ?? st.count;
        const el = container.querySelector('[data-ppp="preview"]');
        if (el) el.textContent = previewText(st, preview(st.dealValue, st.count));
    }

    async function open(container) {
        const st = mounted.get(container);
        const count = Number(container.querySelector('[data-ppp="count"]')?.value);
        const day = Number(container.querySelector('[data-ppp="day"]')?.value);
        const month = container.querySelector('[data-ppp="month"]')?.value;

        // Caught here so the message lands beside the field rather than as a
        // toast after a round trip. The server refuses all of these too.
        if (!isFinite(count) || count < MIN_INSTALMENTS || count > MAX_INSTALMENTS) {
            Toast.error(`Choose between ${MIN_INSTALMENTS} and ${MAX_INSTALMENTS} instalments`); return;
        }
        if (!isFinite(day) || day < 1 || day > 31) { Toast.error('The due day must be between 1 and 31'); return; }
        if (!month) { Toast.error('Pick the month the first instalment falls in'); return; }

        const p = preview(st.dealValue, count);
        const ok = await showConfirm(
            `Open a schedule of ${count} instalments (${previewText({ ...st, count }, p)}) ` +
            `starting ${monthName(month)}, due on the ${ordinal(day)} of each month? ` +
            `Payment Plans will start chasing each instalment as it falls due.`,
            'Open instalment plan');
        if (!ok) return;

        const btn = container.querySelector('[data-ppp="open"]');
        if (btn) btn.disabled = true;
        try {
            const result = await api.request(
                `/crm/deals/${encodeURIComponent(st.dealId)}/payment-plan`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        installment_count: count,
                        day_of_month: day,
                        // The day here is ignored by the generator — day_of_month
                        // decides it — but a date is required, and the first of
                        // the chosen month is the unambiguous one to send.
                        start_date: `${month}-01`,
                    }),
                });

            st.plan = result.plan;
            render(container);

            // ⭐ "ALREADY SCHEDULED" IS NOT "SCHEDULED".
            // Reporting both as success would imply a fresh set of payment
            // demands just went out, and somebody would go looking for them.
            Toast.success(result.already_existed
                ? 'This deal already had an instalment plan — showing it'
                : 'Instalment plan opened');
        } catch (e) {
            console.error('Failed to open the instalment plan:', e);
            Toast.error(e.message || 'Could not open the instalment plan');
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
            const result = await api.request(`/crm/deals/${encodeURIComponent(st.dealId)}/payment-plan`);
            // 204 answers with no body: this deal has no schedule, which is a
            // different answer from a schedule containing nothing.
            st.plan = result && result.plan ? result.plan : null;
        } catch (e) {
            console.error('Failed to load the instalment plan:', e);
            // ⭐ NOT SILENTLY "NO PLAN". A deal that HAS a schedule, shown as
            // having none, invites a rep to open a second one — which the server
            // then refuses in a way that reads like a bug.
            st.loadError = 'Could not load the instalment plan just now. Reload to try again.';
        }
        render(container);
    }

    function mount(container, deal, opts = {}) {
        if (!container || !deal) return;
        const prev = mounted.get(container);
        mounted.set(container, {
            dealId: deal.id,
            companyId: deal.company_id || null,
            dealValue: Number(deal.deal_value) || 0,
            currency: deal.currency || 'INR',
            canEdit: opts.canEdit !== false,
            plan: null,
            loadError: null,
            count: 6,
            day: 5,
            month: thisMonth(),
            bound: prev ? prev.bound : false,
        });

        container.innerHTML = '<p class="ppp-loading">Loading schedule…</p>';
        load(container);

        if (mounted.get(container).bound) return;
        mounted.get(container).bound = true;

        // Delegated and bound ONCE — this panel re-renders after opening a plan,
        // and a listener re-added per render would POST once per render.
        container.addEventListener('click', (e) => {
            if (e.target.closest('[data-ppp="open"]')) return open(container);
        });
        container.addEventListener('input', (e) => {
            if (e.target.matches('[data-ppp="count"]')) refreshPreview(container);
        });
    }

    return { mount, preview, previewText, monthName, ordinal };
})();
