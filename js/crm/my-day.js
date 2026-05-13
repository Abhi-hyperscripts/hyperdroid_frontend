// ── CRM My Day ────────────────────────────────────────────────────────
// Rep-scoped daily report. Three sections:
//   • What I did   — effort counters (calls / emails / meetings / notes / new leads / tasks / followups / deal moves)
//   • What I got   — outcome counters (calls connected, connect rate, deals won)
//   • What I missed — overdue tasks, overdue followups, stale leads, untouched new leads
//
// Period is client-side computed (Today / This Week / This Month) and sent
// to the server as ?from=&to= (ISO 8601 UTC). The server's "today" default
// is also UTC; passing explicit boundaries lets us shift to the rep's
// local-time window without changing the API.

(function () {
    const tileDefs = {
        effort: [
            { key: 'calls_logged',         label: 'Calls Logged',       caption: 'manually logged in CRM' },
            { key: 'emails_logged',        label: 'Emails Logged',      caption: 'manually logged in CRM' },
            { key: 'meetings_held',        label: 'Meetings Held',      caption: 'manually logged in CRM' },
            { key: 'notes_logged',         label: 'Notes Added',        caption: 'free-form notes' },
            { key: 'new_leads',            label: 'New Leads',          caption: 'created by you' },
            { key: 'tasks_completed',      label: 'Tasks Completed',    caption: 'assigned to you' },
            { key: 'followups_completed',  label: 'Follow-ups Done',    caption: 'on your leads' },
            { key: 'deals_stage_changes',  label: 'Deals Moved',        caption: 'stage advances' }
        ],
        outcome: [
            { key: 'calls_connected',      label: 'Calls Connected',    caption: 'outcome = connected' },
            { key: 'call_connect_rate',    label: 'Connect Rate',       caption: 'connected ÷ total calls', isPercent: true },
            { key: 'deals_won',            label: 'Deals Won',          caption: 'moved into "won" stage' }
        ]
    };

    // Each "see all" footer link points the rep at the leads page narrowed
    // to their own pipeline. `ownerUserId=me` is resolved client-side from
    // the JWT in leads.js — no manager can craft a URL to see someone else's
    // data. Bucket-specific filters (staleDays, hasOverdueTask, etc.) need
    // new backend filter modes; tracked for Phase 2.
    const missedDefs = [
        { key: 'overdue_tasks',       countKey: 'overdue_tasks_count',       title: 'Overdue Tasks',
          empty: 'No overdue tasks. Clear!',      linkText: 'See my leads',  link: 'leads.html?ownerUserId=me' },
        { key: 'overdue_followups',   countKey: 'overdue_followups_count',   title: 'Overdue Follow-ups',
          empty: 'No overdue follow-ups.',        linkText: 'See my leads',  link: 'leads.html?ownerUserId=me' },
        { key: 'stale_leads',         countKey: 'stale_leads_count',         title: 'Stale Leads',
          empty: 'No stale leads.',               linkText: 'See my leads',  link: 'leads.html?ownerUserId=me' },
        { key: 'untouched_new_leads', countKey: 'untouched_new_leads_count', title: 'Untouched New Leads',
          empty: 'No untouched new leads today.', linkText: 'See my leads',  link: 'leads.html?ownerUserId=me&status=new' }
    ];

    let currentPeriod = 'today';
    // When non-null, the report is being viewed FOR another rep — hits
    // /user-day instead of /my-day, and the title/badge update accordingly.
    // Plain CRM_USER never sees the picker so this stays null for them.
    let selectedRepId = null;
    let selfUserId = null;
    // SearchableDropdown instance (created lazily after we have the rep list).
    let _repDropdown = null;
    // ApexCharts instances keyed by element id. Each render destroys the
    // prior chart on that element first to avoid leaks when the period or
    // rep changes.
    const _charts = {};

    document.addEventListener('DOMContentLoaded', async () => {
        if (typeof Navigation !== 'undefined') Navigation.init('crm', '../');

        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }

        const me = api.getUser?.() || {};
        selfUserId = me.id || me.userId || me.user_id || null;

        wirePeriodSelector();
        // Picker init is fire-and-forget — if the user is a plain rep, the
        // endpoint returns just themselves and the picker stays hidden.
        // We don't await it so the main report still loads on slow auth lookups.
        initRepPicker();
        await loadReport();
    });

    function wirePeriodSelector() {
        const buttons = document.querySelectorAll('#periodSelector button[data-period]');
        buttons.forEach(b => b.addEventListener('click', async () => {
            currentPeriod = b.dataset.period;
            buttons.forEach(x => x.classList.toggle('active', x === b));
            const lbl = document.getElementById('effortPeriodLabel');
            if (lbl) lbl.textContent = ({ today: 'today', week: 'this week', month: 'this month' })[currentPeriod] || '';
            await loadReport();
        }));
    }

    // Compute [from, to) for the selected period. Everything is UTC so the
    // server window matches what we send. Today = local midnight → next
    // local midnight, normalized to UTC.
    function computeWindow() {
        const now = new Date();
        const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (currentPeriod === 'today') {
            const from = localMidnight;
            const to = new Date(localMidnight.getTime() + 24 * 3600 * 1000);
            return { from, to };
        }
        if (currentPeriod === 'week') {
            // ISO week starts Monday. JS Sunday=0 … Saturday=6.
            const daysSinceMonday = (localMidnight.getDay() + 6) % 7;
            const from = new Date(localMidnight.getTime() - daysSinceMonday * 24 * 3600 * 1000);
            const to = new Date(from.getTime() + 7 * 24 * 3600 * 1000);
            return { from, to };
        }
        if (currentPeriod === 'month') {
            const from = new Date(now.getFullYear(), now.getMonth(), 1);
            const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            return { from, to };
        }
        // Fallback to today
        const from = localMidnight;
        const to = new Date(localMidnight.getTime() + 24 * 3600 * 1000);
        return { from, to };
    }

    async function loadReport() {
        const loading = document.getElementById('loadingState');
        const errorEl = document.getElementById('errorState');
        const body = document.getElementById('reportBody');
        loading.style.display = 'block';
        errorEl.style.display = 'none';
        body.style.display = 'none';

        const { from, to } = computeWindow();
        const qs = `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;

        // Pick endpoint based on whether we're viewing someone else.
        // Self always goes through /my-day so plain CRM_USERs can't be told
        // they don't have access to their own report by an outdated picker.
        const isOther = selectedRepId && selectedRepId !== selfUserId;
        const endpoint = isOther
            ? `/crm/reports/user-day${qs}&userId=${encodeURIComponent(selectedRepId)}`
            : `/crm/reports/my-day${qs}`;

        try {
            const data = await api.request(endpoint);
            render(data);
            loading.style.display = 'none';
            body.style.display = 'block';
        } catch (e) {
            loading.style.display = 'none';
            errorEl.style.display = 'block';
            errorEl.textContent = 'Failed to load report: ' + (e?.message || 'unknown error');
            console.error('[my-day]', e);
        }
    }

    // ── Rep picker ─────────────────────────────────────────────────────
    // Calls /api/reports/viewable-reps. The endpoint returns:
    //   • SUPERADMIN / CRM_ADMIN → every active user
    //   • manager / teamlead     → members of their elevated teams (+ self)
    //   • plain CRM_USER         → just themselves
    // We only show the picker when there's more than one rep — for plain
    // members it stays hidden.
    //
    // The visible control is a SearchableDropdown (project convention —
    // no native <select> in our UI). The hidden <select> still exists to
    // hold the canonical value + drive Playwright tests.
    async function initRepPicker() {
        const wrap = document.getElementById('repPicker');
        const sel = document.getElementById('repSelect');
        if (!wrap || !sel) return;

        let payload;
        try {
            payload = await api.request('/crm/reports/viewable-reps');
        } catch (e) {
            // 401 / 403 / network — silently hide. Plain CRM_USER will never
            // need the picker, so a failure here just means "no picker".
            console.warn('[my-day] viewable-reps lookup failed', e);
            return;
        }

        const reps = Array.isArray(payload?.reps) ? payload.reps : [];
        if (reps.length <= 1) return;  // Just self → no picker needed.

        // "Me" pins to the top so the rep selecting themselves is one click.
        const meRep = reps.find(r => r.user_id === selfUserId);
        const others = reps
            .filter(r => r.user_id !== selfUserId)
            .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));

        // Build option list for SearchableDropdown. `value` = user_id;
        // `label` = the visible name (with team hint for others).
        const options = [];
        if (meRep) {
            options.push({
                value: meRep.user_id,
                label: 'Me (' + (meRep.display_name || 'self') + ')',
                description: meRep.team_name ? meRep.team_name : null
            });
        }
        others.forEach(r => {
            options.push({
                value: r.user_id,
                label: r.display_name || r.email,
                description: r.team_name || null
            });
        });

        // Also populate the (hidden) native <select> so the value can be
        // read by anything (Playwright tests, accessibility tooling) that
        // looks at it.
        sel.innerHTML = '';
        options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            sel.appendChild(opt);
        });

        const initial = selfUserId || (meRep ? meRep.user_id : reps[0].user_id);
        selectedRepId = initial;
        sel.value = initial;

        // Wrap with SearchableDropdown. Virtual scroll kicks in for >50 reps
        // — the admin case where the picker shows the whole tenant roster.
        if (typeof SearchableDropdown !== 'undefined') {
            _repDropdown = new SearchableDropdown(wrap, {
                options,
                value: initial,
                placeholder: 'Select rep…',
                searchPlaceholder: 'Search reps…',
                virtualScroll: options.length > 50,
                onChange: async (value, option) => {
                    selectedRepId = value;
                    sel.value = value;
                    updateHeader(option?.label || '');
                    await loadReport();
                }
            });
        } else {
            // Defensive fallback — should never hit in practice because the
            // page-level script tag pulls searchable-dropdown.js before
            // my-day.js. If we ever do hit this, surface the native select.
            console.warn('[my-day] SearchableDropdown not loaded, falling back to <select>');
            sel.style.display = '';
            sel.addEventListener('change', async () => {
                selectedRepId = sel.value;
                updateHeader(sel.options[sel.selectedIndex]?.text || '');
                await loadReport();
            });
        }

        wrap.classList.add('visible');
    }

    // When a non-self rep is selected, update the page title + badge so it's
    // crystal clear the manager isn't looking at their own zeros by mistake.
    function updateHeader(selectedLabel) {
        const title = document.getElementById('reportTitle');
        const sub = document.getElementById('reportSubtitle');
        const badge = document.getElementById('viewingOtherBadge');
        const badgeText = document.getElementById('viewingOtherText');
        if (!title || !sub || !badge || !badgeText) return;

        const isOther = selectedRepId && selectedRepId !== selfUserId;
        if (isOther) {
            // Strip the team hint ("— Team Alpha") for the page title.
            const name = (selectedLabel || '').split('—')[0].trim() || 'Rep';
            title.textContent = `${name}'s Day`;
            sub.textContent = `${name}'s activity, outcomes, and what needs their attention.`;
            badgeText.textContent = `Viewing ${name}`;
            badge.classList.add('visible');
        } else {
            title.textContent = 'My Day';
            sub.textContent = 'Your activity, outcomes, and what needs your attention.';
            badge.classList.remove('visible');
        }
    }

    function render(data) {
        renderTileSection('effortGrid', tileDefs.effort, data.effort || {});
        renderTileSection('outcomeGrid', tileDefs.outcome, data.outcome || {});
        renderMissed(data.missed || {});
        renderActivityMixChart(data.effort || {});
        renderCallsFunnelChart(data.effort || {}, data.outcome || {});

        // Total-actions pill
        const totalBubble = document.getElementById('effortTotal');
        const total = data.effort?.total ?? 0;
        if (totalBubble) {
            totalBubble.textContent = `${total} action${total === 1 ? '' : 's'}`;
            totalBubble.style.display = total > 0 ? 'inline-block' : 'none';
        }
    }

    // ── Charts ─────────────────────────────────────────────────────────
    // ApexCharts theming follows dashboard.js — transparent bg, foreColor
    // and grid colours derived from the current theme so light/dark mode
    // both look right without a re-render.
    function apexTheme() {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        return {
            mode: isDark ? 'dark' : 'light',
            foreColor: isDark ? '#94a3b8' : '#475569',
            grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'
        };
    }

    function renderChart(id, options) {
        const el = document.getElementById(id);
        if (!el) return;
        if (_charts[id]) {
            try { _charts[id].destroy(); } catch (_) {}
            delete _charts[id];
        }
        // Inject themed defaults.
        const t = apexTheme();
        options.chart = Object.assign({}, options.chart, {
            background: 'transparent',
            foreColor: t.foreColor,
            fontFamily: 'inherit'
        });
        options.theme = { mode: t.mode };
        if (options.grid) options.grid.borderColor = t.grid;
        if (typeof ApexCharts === 'undefined') {
            el.innerHTML = '<div class="md-chart-empty">Charts library failed to load</div>';
            return;
        }
        _charts[id] = new ApexCharts(el, options);
        _charts[id].render();
    }

    // Donut showing how the rep allocated their time/effort across the
    // logged categories. Empty bucket → friendly message instead of an
    // empty chart.
    function renderActivityMixChart(effort) {
        const mix = [
            { key: 'calls_logged',        label: 'Calls',     color: '#6366f1' },
            { key: 'emails_logged',       label: 'Emails',    color: '#3b82f6' },
            { key: 'meetings_held',       label: 'Meetings',  color: '#a855f7' },
            { key: 'notes_logged',        label: 'Notes',     color: '#eab308' },
            { key: 'tasks_completed',     label: 'Tasks',     color: '#22c55e' },
            { key: 'followups_completed', label: 'Follow-ups',color: '#f97316' },
            { key: 'deals_stage_changes', label: 'Deal moves',color: '#ec4899' }
        ];
        const data = mix.map(m => Number(effort[m.key] || 0));
        const total = data.reduce((a, b) => a + b, 0);
        const el = document.getElementById('chartActivityMix');
        const sub = document.getElementById('activityMixSub');

        if (total === 0) {
            if (_charts['chartActivityMix']) {
                try { _charts['chartActivityMix'].destroy(); } catch (_) {}
                delete _charts['chartActivityMix'];
            }
            if (el) el.innerHTML = '<div class="md-chart-empty">No activity in this period yet — log a call, email, or meeting to see the split here.</div>';
            if (sub) sub.textContent = '0 actions logged';
            return;
        }
        if (sub) sub.textContent = `${total} action${total === 1 ? '' : 's'} logged`;

        renderChart('chartActivityMix', {
            chart: { type: 'donut', height: 280, toolbar: { show: false } },
            series: data,
            labels: mix.map(m => m.label),
            colors: mix.map(m => m.color),
            stroke: { width: 2, colors: ['transparent'] },
            fill: { opacity: 0.9 },
            legend: {
                position: 'right', fontSize: '12px',
                itemMargin: { vertical: 2 }
            },
            dataLabels: {
                enabled: true,
                formatter: (val) => Math.round(val) + '%',
                style: { fontSize: '11px', fontWeight: 600 }
            },
            plotOptions: {
                pie: {
                    donut: {
                        size: '62%',
                        labels: {
                            show: true,
                            total: {
                                show: true, label: 'Total',
                                fontSize: '12px',
                                formatter: () => String(total)
                            },
                            value: { fontSize: '20px', fontWeight: 700 }
                        }
                    }
                }
            },
            tooltip: { y: { formatter: v => v + (v === 1 ? ' action' : ' actions') } },
            responsive: [{
                breakpoint: 600,
                options: {
                    chart: { height: 260 },
                    legend: { position: 'bottom' }
                }
            }]
        });
    }

    // Calls Funnel — three-step horizontal funnel from raw calls logged →
    // calls that connected → deals that closed. Visualises the rep's
    // top-of-funnel efficiency and is the report's most actionable view:
    // wide gap between "logged" and "connected" means dialing isn't
    // landing; wide gap between "connected" and "won" means conversations
    // aren't closing.
    function renderCallsFunnelChart(effort, outcome) {
        const calls = Number(effort.calls_logged || 0);
        const connected = Number(outcome.calls_connected || 0);
        const won = Number(outcome.deals_won || 0);
        const el = document.getElementById('chartCallsFunnel');

        if (calls === 0 && connected === 0 && won === 0) {
            if (_charts['chartCallsFunnel']) {
                try { _charts['chartCallsFunnel'].destroy(); } catch (_) {}
                delete _charts['chartCallsFunnel'];
            }
            if (el) el.innerHTML = '<div class="md-chart-empty">No calls or deals yet — once you log a call, the funnel will show how it converts.</div>';
            return;
        }

        renderChart('chartCallsFunnel', {
            chart: { type: 'bar', height: 280, toolbar: { show: false } },
            series: [{ name: 'Count', data: [calls, connected, won] }],
            xaxis: {
                categories: ['Calls Logged', 'Connected', 'Deals Won'],
                labels: { style: { fontSize: '11px' } }
            },
            colors: ['#6366f1', '#3b82f6', '#10b981'],
            plotOptions: {
                bar: {
                    horizontal: true,
                    distributed: true,
                    borderRadius: 4,
                    barHeight: '55%',
                    dataLabels: { position: 'top' }
                }
            },
            dataLabels: {
                enabled: true,
                offsetX: 35,
                style: { fontSize: '12px', fontWeight: 700, colors: ['var(--text-primary)'] },
                formatter: (val, opts) => {
                    // Show absolute count + conversion-from-top label
                    if (val === 0) return '0';
                    if (opts.dataPointIndex === 0) return String(val);
                    const denom = calls;
                    if (!denom) return String(val);
                    const pct = Math.round((val / denom) * 1000) / 10;
                    return `${val} (${pct}%)`;
                }
            },
            legend: { show: false },
            grid: {
                xaxis: { lines: { show: true } },
                yaxis: { lines: { show: false } },
                padding: { left: 10, right: 30 }
            },
            tooltip: {
                y: {
                    formatter: (val, opts) => {
                        if (opts.dataPointIndex === 0) return `${val} calls logged`;
                        const denom = calls;
                        if (!denom) return `${val}`;
                        const pct = Math.round((val / denom) * 1000) / 10;
                        return `${val} (${pct}% of dialed)`;
                    }
                }
            }
        });
    }

    function renderTileSection(gridId, defs, src) {
        const grid = document.getElementById(gridId);
        if (!grid) return;
        grid.innerHTML = defs.map(d => {
            const raw = src[d.key];
            const displayed = formatTileValue(raw, d);
            const isZero = raw === 0 || raw === null || raw === undefined;
            return `
                <div class="md-tile ${isZero ? 'md-tile-zero' : ''}">
                    <span class="md-tile-label">${d.label}</span>
                    <span class="md-tile-value">${displayed}</span>
                    <span class="md-tile-caption">${escapeHtml(d.caption)}</span>
                </div>
            `;
        }).join('');
    }

    function formatTileValue(raw, def) {
        if (raw === null || raw === undefined) return '—';
        if (def.isPercent) return `${Math.round(raw * 10) / 10}%`;
        return Number(raw).toLocaleString();
    }

    // Owner-id used for the "See leads" deep-link. When a manager is viewing
    // another rep, the link should point at THAT rep's pipeline, not the
    // manager's. Plain reps always land on `?ownerUserId=me`.
    function ownerLinkParam() {
        return (selectedRepId && selectedRepId !== selfUserId)
            ? `ownerUserId=${encodeURIComponent(selectedRepId)}`
            : `ownerUserId=me`;
    }

    function renderMissed(missed) {
        const grid = document.getElementById('missedGrid');
        if (!grid) return;
        const ownerParam = ownerLinkParam();
        grid.innerHTML = missedDefs.map(def => {
            const count = missed[def.countKey] ?? 0;
            const list = missed[def.key] || [];
            const isEmpty = count === 0;
            // Rewrite the canned `?ownerUserId=me` in def.link to point at the
            // currently-selected rep when a manager is viewing someone else.
            const link = def.link.replace(/ownerUserId=me/, ownerParam);
            return `
                <div class="md-missed-card ${isEmpty ? 'empty' : ''}">
                    <div class="md-missed-head">
                        <span class="md-missed-title">${escapeHtml(def.title)}</span>
                        <span class="md-missed-count">${count}</span>
                    </div>
                    ${isEmpty
                        ? `<div class="md-missed-empty">${escapeHtml(def.empty)}</div>`
                        : `<ul class="md-missed-list">${list.map(renderMissedItem).join('')}</ul>`
                    }
                    ${count > list.length
                        ? `<div class="md-missed-foot">+ ${count - list.length} more · <a href="${link}">${escapeHtml(def.linkText)}</a></div>`
                        : (isEmpty ? '' : `<div class="md-missed-foot"><a href="${link}">${escapeHtml(def.linkText)}</a></div>`)}
                </div>
            `;
        }).join('');
    }

    function renderMissedItem(item) {
        const title = item.title || '(untitled)';
        const due = item.due_at ? formatDueMeta(item.due_at) : '';
        // Each row uses sessionStorage to hand off the target lead id, then
        // navigates to leads.html?ownerUserId=<target>. leads.js reads the
        // handoff after init and opens the detail panel — avoids the race we
        // had with a URL-param auto-open that fired before the page was ready.
        const leadId = item.related_lead_id;
        const ownerParam = ownerLinkParam();
        const onclick = leadId
            ? `sessionStorage.setItem('crm_openLeadId','${encodeURIComponent(leadId)}'); window.location='leads.html?${ownerParam}'; return false;`
            : `window.location='leads.html?${ownerParam}'; return false;`;
        return `
            <li onclick="${onclick}">
                <span class="md-item-title" title="${escapeAttr(title)}">${escapeHtml(title)}</span>
                <span class="md-item-meta">${escapeHtml(due)}</span>
            </li>
        `;
    }

    // Show "3d overdue" or "due today" depending on how far past the date is.
    function formatDueMeta(iso) {
        try {
            const dueAt = new Date(iso);
            const now = new Date();
            const diffMs = now - dueAt;
            const diffDays = Math.floor(diffMs / (24 * 3600 * 1000));
            if (diffDays >= 1) return `${diffDays}d overdue`;
            if (diffDays === 0 && diffMs > 0) return 'today';
            // Future (or never touched — null)
            return dueAt.toLocaleDateString();
        } catch { return ''; }
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(s) { return escapeHtml(s); }
})();
