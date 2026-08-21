/**
 * Property claim panel — the unit this deal is buying
 * ----------------------------------------------------------------------------
 * The listing page shows the whole tower; this shows the ONE unit a deal has
 * reserved, and lets a rep reserve one without leaving the deal.
 *
 *   GET  /crm/properties?availableOnly=true   what can be held right now
 *   POST /crm/properties/{id}/claim           hold it for this deal
 *   POST /crm/properties/{id}/release         give it back
 *
 * ⭐ TWO SERVER RULES SHAPE THIS PANEL.
 * A unit can be held by only one deal — losing that race answers 409 with the
 * incumbent's hold, so the panel can say who has it and until when. And a hold
 * EXPIRES: a lapsed hold means the unit is back on the market, which this panel
 * has to say out loud rather than showing a reassuring "held" badge over a
 * reservation that no longer exists.
 *
 * Usage:  PropertyClaimPanel.mount(el, deal);
 */
const PropertyClaimPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();
    const HOLD_PRESETS = [7, 14, 30];

    function money(amount, currency) {
        return amount === null || amount === undefined ? '—' : formatMoney(amount, currency);
    }

    function holdHasExpired(p) {
        return !!p.hold_expires_at && new Date(p.hold_expires_at) <= new Date();
    }

    function untilText(p) {
        if (!p.hold_expires_at) return '';
        return new Date(p.hold_expires_at).toLocaleDateString('en-IN',
            { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // ─── Rendering ──────────────────────────────────────────────────────────

    function shell(state) {
        return `
        <div class="pcp">
            <div class="pcp-head">
                <h4 class="pcp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                    Unit
                </h4>
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Unit</summary>
                <div class="crm-help-body">
                    <p>The flat this deal is buying. Holding it takes it off the market for everyone
                       else while the booking is agreed.</p>
                    <p><em>A hold runs out on its own, so an abandoned deal never keeps a unit
                       reserved forever. Extend it any time before it lapses.</em></p>
                </div>
            </details>

            ${state.error ? `<p class="pcp-error">${esc(state.error)}</p>` : ''}
            ${state.held ? heldMarkup(state) : pickerMarkup(state)}
        </div>`;
    }

    function heldMarkup(state) {
        const p = state.held;
        const lapsed = holdHasExpired(p);
        const committed = p.status === 'booked' || p.status === 'sold';
        return `
            <div class="pcp-held is-${esc(p.status)}">
                <p class="pcp-held-name">${esc(p.display_name)}</p>
                <p class="pcp-held-project">${esc(p.project)} · ${esc(money(p.price, p.currency))}</p>
                ${committed
                    ? `<p class="pcp-held-note is-committed">${p.status === 'sold' ? 'Sold to this deal.' : 'Booked for this deal.'}</p>`
                    : lapsed
                        ? `<p class="pcp-held-note is-lapsed">
                             This hold lapsed on ${esc(untilText(p))} — the unit is back on the market
                             and somebody else can take it. Extend it to keep it.
                           </p>`
                        : `<p class="pcp-held-note">Held until ${esc(untilText(p))}</p>`}

                ${committed ? '' : `
                <div class="pcp-actions">
                    <span class="pcp-holds" role="group" aria-label="Extend the hold">
                        ${HOLD_PRESETS.map(d => `
                            <button type="button" class="pcp-hold" data-pcp-extend="${d}">+${d}d</button>`).join('')}
                    </span>
                    <button type="button" class="btn btn-sm btn-secondary" data-pcp="release">Release</button>
                </div>`}
            </div>`;
    }

    function pickerMarkup(state) {
        if (!state.available.length) {
            return `<p class="pcp-none">No units are free to hold right now.
                <br><span class="pcp-hint">Add units on the Properties page, or release a hold that is no longer needed.</span></p>`;
        }
        return `
            <div class="pcp-picker">
                <label class="pcp-full">Unit<span data-pcp="unit-host"></span></label>
                <div class="pcp-actions">
                    <span class="pcp-holds" role="group" aria-label="Hold for">
                        ${HOLD_PRESETS.map(d => `
                            <button type="button" class="pcp-hold${d === state.holdDays ? ' is-on' : ''}"
                                    data-pcp-days="${d}">${d} days</button>`).join('')}
                    </span>
                    <button type="button" class="btn btn-sm btn-primary" data-pcp="claim">Hold this unit</button>
                </div>
            </div>`;
    }

    function mountUnitPicker(container) {
        const st = mounted.get(container);
        const host = container.querySelector('[data-pcp="unit-host"]');
        if (!host) return;

        // Portaled menus outlive their host — close AND destroy before replacing.
        if (st.unitDropdown) {
            try { st.unitDropdown.close?.(); st.unitDropdown.destroy?.(); } catch (_) { /* gone */ }
            st.unitDropdown = null;
        }

        if (typeof SearchableDropdown === 'function') {
            st.unitDropdown = new SearchableDropdown(host, {
                options: st.available.map(p => ({
                    value: p.id,
                    label: `${p.project} — ${p.display_name}`,
                    description: money(p.price, p.currency),
                })),
                placeholder: 'Which unit?',
                searchPlaceholder: 'Search units…',
                compact: true,
                onChange: (value) => { st.selected = value; },
            });
        } else {
            host.innerHTML = '<span class="pcp-hint">Unit picker unavailable</span>';
        }
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    async function claim(container, propertyId, holdDays) {
        const st = mounted.get(container);
        if (!propertyId) { Toast.error('Pick a unit first'); return; }

        try {
            const result = await api.request(`/crm/properties/${encodeURIComponent(propertyId)}/claim`, {
                method: 'POST',
                body: JSON.stringify({ deal_id: st.dealId, hold_days: holdDays }),
            });
            st.error = null;
            Toast.success(result.already_held ? 'Hold extended' : 'Unit held for this deal');
            await reload(container);
        } catch (e) {
            // ⭐ A 409 CARRIES THE INCUMBENT'S HOLD. Shown in place rather than as
            // a toast, because "held for the Verma deal until 3 Sept" is what
            // decides whether the agent waits or offers a different flat — and a
            // toast is gone before they have read it.
            const other = e && e.data && e.data.property;
            st.error = other
                ? `${e.message} ${other.held_by_deal_name ? `It is held for ${other.held_by_deal_name}` : 'It is held'}`
                  + `${other.hold_expires_at ? ` until ${untilText(other)}.` : '.'}`
                : (e && e.message) || 'Could not hold this unit';
            console.error('Failed to hold the unit:', e);
            render(container);
        }
    }

    async function release(container) {
        const st = mounted.get(container);
        const ok = await showConfirm(
            `Release ${st.held ? st.held.display_name : 'this unit'}? It goes straight back on the market `
            + 'and another deal can take it.',
            'Release unit', 'danger');
        if (!ok) return;
        try {
            await api.request(`/crm/properties/${encodeURIComponent(st.held.id)}/release`, {
                method: 'POST',
                body: JSON.stringify({ deal_id: st.dealId }),
            });
            st.error = null;
            Toast.success('Unit released');
            await reload(container);
        } catch (e) {
            console.error('Failed to release the unit:', e);
            Toast.error((e && e.message) || 'Could not release the unit');
        }
    }

    // ─── Mounting ───────────────────────────────────────────────────────────

    function render(container) {
        container.innerHTML = shell(mounted.get(container));
        mountUnitPicker(container);
    }

    async function reload(container) {
        const st = mounted.get(container);
        try {
            // Everything, so the unit THIS deal holds can be found whatever its
            // status — a booked or sold unit is no longer "available" and would
            // vanish from the panel that is supposed to show it.
            const all = await api.request('/crm/properties');
            const rows = Array.isArray(all) ? all : [];
            st.held = rows.find(p => p.held_by_deal_id === st.dealId) || null;
            st.available = rows.filter(p =>
                p.status !== 'sold' && p.status !== 'booked'
                && (!p.held_by_deal_id || holdHasExpired(p)));
            st.selected = null;
        } catch (e) {
            console.error('Failed to load the property claim:', e);
            st.held = null;
            st.available = [];
            st.error = 'Could not load the unit for this deal.';
        }
        render(container);
    }

    function mount(container, deal) {
        if (!container || !deal) return;
        const prev = mounted.get(container);
        mounted.set(container, {
            dealId: deal.id,
            held: null,
            available: [],
            selected: null,
            holdDays: HOLD_PRESETS[0],
            error: null,
            unitDropdown: null,
            bound: prev ? prev.bound : false,
        });

        container.innerHTML = '<p class="pcp-loading">Loading unit…</p>';
        reload(container);

        if (mounted.get(container).bound) return;
        mounted.get(container).bound = true;

        // Delegated and bound ONCE — the panel re-renders after every claim and
        // release, and a per-render listener would fire one POST per render.
        container.addEventListener('click', (e) => {
            const st = mounted.get(container);

            const days = e.target.closest('[data-pcp-days]');
            if (days) {
                st.holdDays = Number(days.getAttribute('data-pcp-days'));
                container.querySelectorAll('[data-pcp-days]').forEach(b =>
                    b.classList.toggle('is-on', b === days));
                return;
            }
            const extend = e.target.closest('[data-pcp-extend]');
            if (extend && st.held) {
                return claim(container, st.held.id, Number(extend.getAttribute('data-pcp-extend')));
            }
            if (e.target.closest('[data-pcp="claim"]')) return claim(container, st.selected, st.holdDays);
            if (e.target.closest('[data-pcp="release"]')) return release(container);
        });
    }

    return { mount, holdHasExpired };
})();
