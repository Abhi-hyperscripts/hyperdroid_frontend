/**
 * Lead history panel — follow-ups, email engagement, assignment history
 * ----------------------------------------------------------------------------
 * Three things the backend recorded faithfully and the app never showed:
 *
 *   GET /api/leads/{id}/followups            what is scheduled on this lead
 *   GET /api/leads/{id}/engagement-events    which marketing emails they opened
 *                                            or clicked
 *   GET /api/leads/{id}/assignment-history   who reassigned this lead and why
 *
 * They share a panel because they answer one question between them — "what has
 * happened to this lead, and what is coming" — and because a lead detail with
 * three more separate cards would be a wall.
 *
 * Read-only by design: each of these is a record of something that already
 * happened. Follow-ups are created and completed elsewhere (the Schedule
 * Follow-up action); this is the list that was missing.
 *
 * Responses are snake_case.
 */
const LeadHistoryPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    const TABS = [
        { key: 'followups', label: 'Follow-ups' },
        { key: 'engagement', label: 'Email engagement' },
        { key: 'assignment', label: 'Ownership' }
    ];

    function when(iso, { future = false } = {}) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const diffMin = Math.round((d.getTime() - Date.now()) / 60000);
        const abs = Math.abs(diffMin);
        const word = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
        let rel;
        if (abs < 60) rel = word(abs, 'minute');
        else if (abs < 1440) rel = word(Math.round(abs / 60), 'hour');
        else rel = word(Math.round(abs / 1440), 'day');
        if (abs < 1) return 'just now';
        return diffMin > 0 ? `in ${rel}` : `${rel} ago`;
    }

    function exactDate(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('en-IN',
            { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function shell(active) {
        return `
        <div class="lhp">
            <div class="lhp-head">
                <h4 class="lhp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
                    History &amp; engagement
                </h4>
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — History &amp; engagement</summary>
                <div class="crm-help-body">
                    <p><strong>Follow-ups</strong> is what is scheduled on this lead and what has been
                       done. <strong>Email engagement</strong> shows which of your marketing emails
                       they opened or clicked — useful before you call.
                       <strong>Ownership</strong> is who has held this lead and why it moved.</p>
                    <p><em>Tip: a lead with recent opens and no reply is usually worth a call rather
                       than another email.</em></p>
                </div>
            </details>

            <div class="lhp-tabs" role="tablist">
                ${TABS.map(t => `<button type="button" class="lhp-tab${t.key === active ? ' active' : ''}"
                        role="tab" data-lhp-tab="${t.key}">${esc(t.label)}</button>`).join('')}
            </div>

            <div data-lhp="body" class="lhp-body"></div>
        </div>`;
    }

    // ── Renderers ───────────────────────────────────────────────────────
    function followupsView(rows) {
        if (!rows.length) return empty('Nothing scheduled. Use <strong>Schedule Follow-up</strong> to add one.');
        return rows
            .slice()
            .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
            .map(f => {
                const done = f.status === 'completed';
                const missed = f.status === 'missed'
                    || (!done && f.status !== 'cancelled' && new Date(f.scheduled_at) < Date.now());
                const cls = done ? 'is-done' : (missed ? 'is-missed' : '');
                return `
                <div class="lhp-row ${cls}">
                    <span class="lhp-dot"></span>
                    <div class="lhp-row-text">
                        <div class="lhp-row-title">
                            ${esc(String(f.followup_type || 'follow-up').replace(/_/g, ' '))}
                            <span class="lhp-status">${esc(f.status || 'pending')}</span>
                        </div>
                        ${f.notes ? `<p class="lhp-row-note">${esc(f.notes)}</p>` : ''}
                        <div class="lhp-row-meta" title="${esc(exactDate(f.scheduled_at))}">
                            ${esc(when(f.scheduled_at))} · ${esc(exactDate(f.scheduled_at))}
                        </div>
                    </div>
                </div>`;
            }).join('');
    }

    function engagementView(rows) {
        if (!rows.length) {
            return empty('No opens or clicks recorded. They appear once this lead is sent a tracked campaign email.');
        }
        return rows
            .slice()
            .sort((a, b) => new Date(b.event_at) - new Date(a.event_at))
            .map(e => {
                const kind = String(e.event_kind || '').toLowerCase();
                return `
                <div class="lhp-row lhp-ev-${esc(kind)}">
                    <span class="lhp-dot"></span>
                    <div class="lhp-row-text">
                        <div class="lhp-row-title">
                            ${esc(kind || 'event')}
                        </div>
                        ${e.click_url ? `<p class="lhp-row-note lhp-url">${esc(e.click_url)}</p>` : ''}
                        <div class="lhp-row-meta">${esc(when(e.event_at))} · ${esc(exactDate(e.event_at))}</div>
                    </div>
                </div>`;
            }).join('');
    }

    function assignmentView(rows) {
        if (!rows.length) return empty('No ownership changes recorded for this lead.');
        return rows
            .slice()
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .map(h => `
                <div class="lhp-row">
                    <span class="lhp-dot"></span>
                    <div class="lhp-row-text">
                        <div class="lhp-row-title">${esc(String(h.action || '').replace(/_/g, ' '))}</div>
                        ${h.reason ? `<p class="lhp-row-note">${esc(h.reason)}</p>` : ''}
                        <div class="lhp-row-meta">
                            ${esc(h.performed_by || 'system')} · ${esc(exactDate(h.created_at))}
                        </div>
                    </div>
                </div>`).join('');
    }

    const empty = (html) => `<p class="lhp-empty">${html}</p>`;

    // ── Loading ─────────────────────────────────────────────────────────
    const ENDPOINTS = {
        followups: (id) => `/crm/leads/${encodeURIComponent(id)}/followups`,
        engagement: (id) => `/crm/leads/${encodeURIComponent(id)}/engagement-events`,
        assignment: (id) => `/crm/leads/${encodeURIComponent(id)}/assignment-history`
    };
    const VIEWS = { followups: followupsView, engagement: engagementView, assignment: assignmentView };

    async function show(container, key) {
        const st = mounted.get(container);
        if (!st) return;
        st.active = key;
        container.querySelectorAll('.lhp-tab').forEach(t =>
            t.classList.toggle('active', t.getAttribute('data-lhp-tab') === key));

        const body = container.querySelector('[data-lhp="body"]');
        body.innerHTML = '<p class="lhp-loading">Loading…</p>';

        if (!st.cache[key]) {
            try {
                const res = await api.request(ENDPOINTS[key](st.leadId));
                st.cache[key] = Array.isArray(res) ? res : (res?.items || []);
            } catch (e) {
                console.error(`Failed to load ${key}:`, e);
                body.innerHTML = `<p class="lhp-empty">Could not load this. ${esc(e.message || '')}</p>`;
                return;
            }
        }
        // a slow tab must not overwrite a newer one the user has since clicked
        if (st.active !== key) return;
        body.innerHTML = VIEWS[key](st.cache[key]);
    }

    function mount(container, leadId) {
        if (!container) return;
        const prev = mounted.get(container);
        mounted.set(container, { leadId, cache: {}, active: 'followups', bound: prev ? prev.bound : false });
        container.innerHTML = shell('followups');

        // Bound once — the detail panel re-mounts on every open.
        if (!mounted.get(container).bound) {
            mounted.get(container).bound = true;
            container.addEventListener('click', (e) => {
                const tab = e.target.closest('[data-lhp-tab]');
                if (tab) show(container, tab.getAttribute('data-lhp-tab'));
            });
        }
        show(container, 'followups');
    }

    return { mount };
})();
