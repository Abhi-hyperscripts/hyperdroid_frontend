/**
 * Related records — the rollups the backend already served and nothing asked for
 * ----------------------------------------------------------------------------
 *   GET /api/Companies/{id}/contacts   who we know at this company
 *   GET /api/Companies/{id}/deals      what is in play with them
 *   GET /api/Contacts/{id}/deals       what this person is on
 *
 * All three answer the same question from different sides — "what else is
 * attached to this record" — so they share one renderer. Each is a plain list
 * with a click-through to the owning page; nothing here edits, because every
 * one of these records has a proper editor elsewhere and a second one would be
 * a second source of truth.
 *
 * Usage:
 *   RelatedPanel.mount(el, [
 *     { key: 'contacts', label: 'Contacts', url: `/crm/companies/${id}/contacts` },
 *     { key: 'deals',    label: 'Deals',    url: `/crm/companies/${id}/deals` }
 *   ]);
 */
const RelatedPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    // Deals carry their own currency and it is NOT always the tenant's. An
    // early version of this file formatted every value as INR and rendered a
    // USD deal as "₹15,00,000" — a wrong number, not just a wrong symbol.
    const money = (v, currency) => {
        const n = Number(v);
        if (!isFinite(n) || n === 0) return null;
        const code = (currency || 'INR').toUpperCase();
        // The LOCALE has to follow the currency, not the tenant: formatting a
        // USD deal with en-IN grouping produced "$15,00,000" for 1.5 million —
        // the right symbol on a lakh-grouped number, which reads as a
        // different figure entirely to anyone who deals in dollars.
        const locale = code === 'INR' ? 'en-IN' : 'en-US';
        try {
            return n.toLocaleString(locale, { style: 'currency', currency: code, maximumFractionDigits: 0 });
        } catch {
            // Unknown/garbage code — show the number with the code beside it
            // rather than silently pretending it is the default currency.
            return `${n.toLocaleString(locale, { maximumFractionDigits: 0 })} ${code}`;
        }
    };

    const shortDate = (iso) => {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    // ── Row shapes, one per record type ──────────────────────────────────
    function contactRow(c) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unnamed contact';
        const sub = [c.job_title, c.email, c.phone || c.mobile].filter(Boolean).join(' · ');
        return `
        <a class="rel-row" href="contacts.html?contact=${encodeURIComponent(c.id)}">
            <span class="rel-avatar">${esc((name[0] || '?').toUpperCase())}</span>
            <span class="rel-text">
                <span class="rel-title">${esc(name)}</span>
                ${sub ? `<span class="rel-sub">${esc(sub)}</span>` : ''}
            </span>
            <svg class="rel-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </a>`;
    }

    function dealRow(d) {
        const val = money(d.deal_value ?? d.value ?? d.amount, d.currency);
        // The rollup query does not join deal_stages, so stage_name_resolved
        // comes back null here. Outcome is still knowable: the win/lose reason
        // fields are only ever set when a deal closes that way.
        const stage = d.stage_name_resolved || d.stage_name || d.stage;
        const won = !!d.won_reason || /won/i.test(String(d.stage_type_resolved || ''));
        const lost = !!d.lost_reason || /lost/i.test(String(d.stage_type_resolved || ''));
        const outcome = won ? 'Won' : lost ? 'Lost' : null;
        const closeLabel = d.actual_close_date
            ? `closed ${shortDate(d.actual_close_date)}`
            : d.expected_close_date ? `closes ${shortDate(d.expected_close_date)}` : null;
        const sub = [stage, outcome, d.contact_name, closeLabel].filter(Boolean).join(' · ');
        return `
        <a class="rel-row" href="deals.html?deal=${encodeURIComponent(d.id)}">
            <span class="rel-avatar rel-avatar-deal${won ? ' is-won' : lost ? ' is-lost' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </span>
            <span class="rel-text">
                <span class="rel-title">${esc(d.deal_name || d.title || 'Untitled deal')}</span>
                ${sub ? `<span class="rel-sub">${esc(sub)}</span>` : ''}
            </span>
            ${val ? `<span class="rel-value">${esc(val)}</span>` : ''}
            <svg class="rel-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </a>`;
    }

    const ROWS = { contacts: contactRow, deals: dealRow };

    const EMPTY = {
        contacts: 'No contacts recorded at this company yet. Contacts appear here once a lead from this company is converted.',
        deals: 'No deals yet. A deal is created when a lead here is qualified.'
    };

    function shell(tabs, active) {
        return `
        <div class="rel">
            <div class="rel-tabs" role="tablist">
                ${tabs.map(t => `
                    <button type="button" class="rel-tab${t.key === active ? ' active' : ''}"
                            role="tab" data-rel-tab="${esc(t.key)}">
                        ${esc(t.label)}<span class="rel-tab-count" data-rel-count="${esc(t.key)}"></span>
                    </button>`).join('')}
            </div>
            <div class="rel-body" data-rel="body"></div>
        </div>`;
    }

    async function show(container, key) {
        const st = mounted.get(container);
        if (!st) return;
        st.active = key;
        container.querySelectorAll('.rel-tab').forEach(t =>
            t.classList.toggle('active', t.getAttribute('data-rel-tab') === key));

        const body = container.querySelector('[data-rel="body"]');
        body.innerHTML = '<p class="rel-state">Loading…</p>';

        if (!st.cache[key]) {
            const tab = st.tabs.find(t => t.key === key);
            try {
                const res = await api.request(tab.url);
                st.cache[key] = Array.isArray(res) ? res : (res?.items || res?.data || []);
            } catch (e) {
                console.error(`[related] ${key} failed:`, e);
                body.innerHTML = `<p class="rel-state">Could not load. ${esc(e.message || '')}</p>`;
                return;
            }
        }
        // A slow tab must not paint over one the user has since clicked.
        if (st.active !== key) return;

        const rows = st.cache[key];
        const badge = container.querySelector(`[data-rel-count="${CSS.escape(key)}"]`);
        if (badge) badge.textContent = rows.length ? ` ${rows.length}` : '';

        const shape = st.tabs.find(t => t.key === key)?.shape || key;
        body.innerHTML = rows.length
            ? rows.map(ROWS[shape] || contactRow).join('')
            : `<p class="rel-state">${EMPTY[shape] || 'Nothing here yet.'}</p>`;
    }

    function mount(container, tabs) {
        if (!container || !tabs || !tabs.length) return;
        const prev = mounted.get(container);
        mounted.set(container, {
            tabs, cache: {}, active: tabs[0].key, bound: prev ? prev.bound : false
        });
        container.innerHTML = shell(tabs, tabs[0].key);

        // Bind once — detail panels re-mount on every open.
        if (!mounted.get(container).bound) {
            mounted.get(container).bound = true;
            container.addEventListener('click', (e) => {
                const t = e.target.closest('[data-rel-tab]');
                if (t) show(container, t.getAttribute('data-rel-tab'));
            });
        }
        show(container, tabs[0].key);
    }

    return { mount };
})();
