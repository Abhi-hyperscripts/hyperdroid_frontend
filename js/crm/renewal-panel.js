/**
 * Renewal panel — when this policy expires, and what happened to it
 * ----------------------------------------------------------------------------
 * Insurance is a renewals business and so is most of BFSI: a policy sold once
 * is revenue every year it is renewed. Before this the CRM could record the
 * sale and nothing else — the second year lived in a rep's memory, and a lapsed
 * policy was invisible until the customer had already gone elsewhere.
 *
 *   PATCH /crm/deals/{id}/renewal          set or clear the date + reminders
 *   PATCH /crm/deals/{id}/renewal/status   renewed / not renewing / back to pending
 *   GET   /crm/deals/renewals-due          the work queue
 *
 * Usage:  RenewalPanel.mount(el, deal);
 */
const RenewalPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    const STATUS_LABEL = {
        pending: 'Due',
        renewed: 'Renewed',
        lapsed: 'Lapsed',
        not_renewing: 'Not renewing',
    };

    // 'lapsed' is absent on purpose — it is what the nightly sweep CONCLUDES
    // when a date passes untouched. Offering it as a button would blur "we let
    // this go" with "they told us no", and those are different facts about a
    // customer. The server refuses it too.
    const SETTABLE = ['renewed', 'not_renewing', 'pending'];

    const PRESETS = [
        { label: '30 / 7 / 1', days: [30, 7, 1] },
        { label: '60 / 30 / 7', days: [60, 30, 7] },
        { label: '90 / 30', days: [90, 30] },
        { label: 'None', days: [] },
    ];

    /**
     * ⭐ A RENEWAL DATE IS A CALENDAR DAY, NOT AN INSTANT — DO NOT ROUND-TRIP IT
     * THROUGH Date + toISOString.
     *
     * The column is a DATE and the API serialises it as "2027-08-20T00:00:00"
     * with no zone marker, which the browser parses as LOCAL midnight. From IST
     * that is 18:30 the PREVIOUS day in UTC, so `new Date(iso).toISOString()`
     * returned 2027-08-19 — the panel header (rendered locally) said 20 Aug
     * while the date input beside it said 19/08, and pressing Save would have
     * walked the renewal one day earlier every single time.
     *
     * Caught by looking at a screenshot of the two side by side; neither value
     * is wrong on its own, and only the disagreement gives it away.
     *
     * Taking the first ten characters treats the value as what it is: a day.
     */
    function dateOnly(iso) {
        if (!iso) return '';
        const s = String(iso);
        return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
    }

    /**
     * The same calendar day, formatted for reading. Built from the Y/M/D parts
     * rather than parsed, so no zone can shift it either.
     */
    function humanDate(iso) {
        const ymd = dateOnly(iso);
        if (!ymd) return '—';
        const [y, m, d] = ymd.split('-').map(Number);
        return new Date(y, m - 1, d)
            .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    /**
     * renewed_at is a real INSTANT (timestamptz), unlike renewal_date — so it
     * is parsed rather than sliced. Keeping the two apart is the point: the
     * bug above came from treating a calendar day like an instant.
     */
    function instantDate(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    /**
     * How the countdown reads. Negative is OVERDUE and says so — an overdue
     * renewal shown as "in -3 days" is the row a rep most needs to notice and
     * the one they are least likely to parse.
     */
    function countdown(days) {
        if (days === null || days === undefined) return '';
        if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
        if (days === 0) return 'today';
        if (days === 1) return 'tomorrow';
        return `in ${days} days`;
    }

    function shell(state) {
        const d = state.deal;
        const has = !!d.renewal_date;
        const status = d.renewal_status || 'pending';
        const days = d.days_until_renewal;
        const overdue = has && status === 'pending' && typeof days === 'number' && days < 0;

        return `
        <div class="rnp">
            <div class="rnp-head">
                <h4 class="rnp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    Renewal
                </h4>
                ${has ? `<span class="rnp-when ${overdue ? 'is-overdue' : ''}">${esc(humanDate(d.renewal_date))}${
                    status === 'pending' ? ` · ${esc(countdown(days))}` : ''}</span>` : ''}
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Renewal</summary>
                <div class="crm-help-body">
                    <p>When this policy or contract expires. Reminders fire the chosen number of
                       days beforehand, to whoever owns the deal.</p>
                    <p><em>A renewal nobody acts on is marked <strong>lapsed</strong> automatically a
                       week after its date — that is how a customer who quietly left becomes
                       visible instead of sitting in the list looking due.</em></p>
                </div>
            </details>

            ${has ? statusMarkup(state, status) : ''}

            <div class="rnp-form">
                <label class="rnp-date-label">Renews on
                    <input type="date" data-rnp="date" value="${esc(dateOnly(d.renewal_date))}">
                </label>

                <div class="rnp-presets" role="group" aria-label="Reminder schedule">
                    <span class="rnp-presets-label">Remind</span>
                    ${PRESETS.map(p => `
                        <button type="button" class="rnp-preset${
                            state.selectedPreset === p.label ? ' is-on' : ''}"
                                data-rnp-preset="${esc(p.label)}">${esc(p.label)}</button>`).join('')}
                    <span class="rnp-presets-suffix">days before</span>
                </div>

                <label class="rnp-notes-label">Notes
                    <textarea rows="2" data-rnp="notes" placeholder="e.g. premium likely to rise — call in advance">${esc(d.renewal_notes || '')}</textarea>
                </label>

                <div class="rnp-actions">
                    ${has ? '<button type="button" class="btn btn-sm btn-secondary" data-rnp="clear">Remove</button>' : '<span></span>'}
                    <button type="button" class="btn btn-sm btn-primary" data-rnp="save">${has ? 'Update renewal' : 'Set renewal'}</button>
                </div>
            </div>
        </div>`;
    }

    function statusMarkup(state, status) {
        const d = state.deal;
        return `
        <div class="rnp-status is-${esc(status)}">
            <div class="rnp-status-row">
                <span class="rnp-status-badge">${esc(STATUS_LABEL[status] || status)}</span>
                ${d.renewed_at ? `<span class="rnp-hint">on ${esc(instantDate(d.renewed_at))}</span>` : ''}
            </div>
            ${status === 'lapsed'
                ? '<p class="rnp-hint">Nobody acted on this before the date passed. Setting a new date puts it back in play.</p>'
                : ''}
            <div class="rnp-track">
                ${SETTABLE.map(s => `
                    <button type="button" class="rnp-step${s === status ? ' is-on' : ''}"
                            data-rnp-status="${s}" ${s === status ? 'disabled' : ''}>
                        ${esc(STATUS_LABEL[s])}
                    </button>`).join('')}
            </div>
        </div>`;
    }

    /**
     * Which preset is currently in force, or null when there is nothing to
     * reflect.
     *
     * ⭐ A DEAL WITH NO RENEWAL HAS NO SCHEDULE — it must NOT match the "None"
     * preset. Both are an empty offsets array, so matching on the array alone
     * preselected "None" on every deal that had never had a renewal, and a rep
     * who set a date and hit Save got NO reminders: silently the opposite of
     * what they came to do. The date is what distinguishes "the user chose no
     * reminders" from "nothing has been chosen yet".
     */
    function currentPresetLabel(deal) {
        if (!deal.renewal_date) return null;
        const days = Array.isArray(deal.renewal_reminder_offset_days) ? deal.renewal_reminder_offset_days : null;
        if (!days) return null;
        const key = days.join(',');
        const hit = PRESETS.find(p => p.days.join(',') === key);
        return hit ? hit.label : null;
    }

    async function save(container) {
        const st = mounted.get(container);
        const date = container.querySelector('[data-rnp="date"]')?.value;
        const notes = container.querySelector('[data-rnp="notes"]')?.value;
        if (!date) { Toast.error('Pick the date this renews on'); return; }

        const preset = PRESETS.find(p => p.label === st.selectedPreset);
        const btn = container.querySelector('[data-rnp="save"]');
        btn.disabled = true;
        try {
            const updated = await api.request(`/crm/deals/${encodeURIComponent(st.dealId)}/renewal`, {
                method: 'PATCH',
                body: JSON.stringify({
                    renewal_date: date,
                    // null (not []) means "use the tenant default" — an empty
                    // array means "no reminders", and the two are different
                    // instructions the server distinguishes.
                    reminder_days: preset ? preset.days : null,
                    renewal_notes: notes || null,
                }),
            });
            Toast.success('Renewal saved');
            remount(container, updated);
        } catch (e) {
            console.error('Failed to save the renewal:', e);
            Toast.error(e.message || 'Could not save the renewal');
        } finally {
            btn.disabled = false;
        }
    }

    async function clear(container) {
        const st = mounted.get(container);
        const ok = await showConfirm(
            'Remove the renewal date? Its reminders stop and it drops off the renewals list.',
            'Remove renewal', 'danger');
        if (!ok) return;
        try {
            const updated = await api.request(`/crm/deals/${encodeURIComponent(st.dealId)}/renewal`, {
                method: 'PATCH',
                body: JSON.stringify({ renewal_date: null }),
            });
            Toast.success('Renewal removed');
            remount(container, updated);
        } catch (e) {
            console.error('Failed to clear the renewal:', e);
            Toast.error(e.message || 'Could not remove the renewal');
        }
    }

    async function setStatus(container, status) {
        const st = mounted.get(container);
        let notes = null;
        if (status === 'not_renewing') {
            notes = await Prompt.show({
                title: 'Not renewing',
                message: 'Why is the customer not renewing? This stays on the deal.',
                placeholder: 'e.g. moved to a competitor on price',
                confirmText: 'Save',
            });
            if (notes === null) return;
        }
        try {
            const updated = await api.request(
                `/crm/deals/${encodeURIComponent(st.dealId)}/renewal/status`,
                { method: 'PATCH', body: JSON.stringify({ status, notes }) });
            Toast.success(`Renewal marked ${(STATUS_LABEL[status] || status).toLowerCase()}`);
            remount(container, updated);
        } catch (e) {
            console.error('Failed to update the renewal status:', e);
            Toast.error(e.message || 'Could not update the renewal');
        }
    }

    function remount(container, deal) { mount(container, deal); }

    function mount(container, deal) {
        if (!container || !deal) return;
        const prev = mounted.get(container);
        mounted.set(container, {
            dealId: deal.id,
            deal,
            selectedPreset: currentPresetLabel(deal) || PRESETS[0].label,
            bound: prev ? prev.bound : false,
        });
        container.innerHTML = shell(mounted.get(container));

        if (mounted.get(container).bound) return;
        mounted.get(container).bound = true;

        // Delegated and bound once: this panel re-renders on every save, and a
        // listener re-added per render would fire one PATCH per render.
        container.addEventListener('click', (e) => {
            const preset = e.target.closest('[data-rnp-preset]');
            if (preset) {
                mounted.get(container).selectedPreset = preset.getAttribute('data-rnp-preset');
                container.querySelectorAll('[data-rnp-preset]').forEach(b =>
                    b.classList.toggle('is-on', b === preset));
                return;
            }
            const statusBtn = e.target.closest('[data-rnp-status]');
            if (statusBtn) return setStatus(container, statusBtn.getAttribute('data-rnp-status'));
            if (e.target.closest('[data-rnp="save"]')) return save(container);
            if (e.target.closest('[data-rnp="clear"]')) return clear(container);
        });
    }

    // humanDate is exported because the renewals-due queue below renders the
    // same calendar-day values and must not re-derive the parsing that this
    // panel got wrong once.
    return { mount, countdown, humanDate, dateOnly };
})();

// ═══════════════════════════════════════════════════════════════════════════
//  Renewals due — the work queue
// ═══════════════════════════════════════════════════════════════════════════

function openRenewalsDue() {
    document.getElementById('renewalsDueOverlay')?.classList.add('active');
    document.getElementById('renewalsDuePanel')?.classList.add('active');
    loadRenewalsDue();
}

function closeRenewalsDue() {
    document.getElementById('renewalsDueOverlay')?.classList.remove('active');
    document.getElementById('renewalsDuePanel')?.classList.remove('active');
}

async function loadRenewalsDue() {
    const body = document.getElementById('renewalsDueBody');
    if (!body) return;
    body.innerHTML = '<div class="crm-loading"><div class="crm-loading-spinner"></div></div>';

    const within = document.getElementById('renewalsWithin')?.value || '60';
    try {
        const rows = await api.request(`/crm/deals/renewals-due?within_days=${encodeURIComponent(within)}`);
        renderRenewalsDue(body, Array.isArray(rows) ? rows : []);
    } catch (e) {
        console.error('Failed to load renewals due:', e);
        body.innerHTML = `<p class="rnd-empty">${escapeHtml(e.message || 'Could not load renewals')}</p>`;
    }
}

function renderRenewalsDue(body, rows) {
    if (!rows.length) {
        body.innerHTML = `<p class="rnd-empty">Nothing due in this window.
            A deal appears here once it has a renewal date and has not been closed out.</p>`;
        return;
    }

    const money = (n, c) => formatMoney(n, c);

    body.innerHTML = `
        <p class="rnd-count">${rows.length} renewal${rows.length === 1 ? '' : 's'} to work</p>
        <div class="rnd-list">
            ${rows.map(r => {
                const overdue = r.days_until_renewal < 0;
                return `
                <article class="rnd-item${overdue ? ' is-overdue' : ''}" data-deal-id="${escapeHtml(r.deal_id)}">
                    <div class="rnd-item-main">
                        <button type="button" class="rnd-item-name" data-rnd-open="${escapeHtml(r.deal_id)}">
                            ${escapeHtml(r.deal_name)}
                        </button>
                        <span class="rnd-item-value">${escapeHtml(money(r.deal_value, r.currency))}</span>
                    </div>
                    <div class="rnd-item-meta">
                        <span class="rnd-item-when${overdue ? ' is-overdue' : ''}">
                            ${escapeHtml(RenewalPanel.countdown(r.days_until_renewal))}
                        </span>
                        <span>${escapeHtml(RenewalPanel.humanDate(r.renewal_date))}</span>
                        ${r.owner_name ? `<span>${escapeHtml(r.owner_name)}</span>` : ''}
                    </div>
                </article>`;
            }).join('')}
        </div>`;

    // Delegated once per render is safe here: the body is replaced wholesale,
    // so the previous listener goes with the nodes it was attached to.
    body.onclick = (e) => {
        const btn = e.target.closest('[data-rnd-open]');
        if (!btn) return;
        closeRenewalsDue();
        if (typeof openDealDetailPanel === 'function') openDealDetailPanel(btn.getAttribute('data-rnd-open'));
    };
}
