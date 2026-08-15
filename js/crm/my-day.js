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
        // Independent of the report payload — its own endpoint, so a failure
        // here must not take the rest of the page down with it.
        loadComingUp();
        renderActivityMixChart(data.effort || {});
        renderCallsFunnelChart(data.effort || {}, data.outcome || {});
        renderTimelineChart(data.timeline || []);
        renderHeroWave(data.timeline || []);

        // Total-actions pill
        const totalBubble = document.getElementById('effortTotal');
        const total = data.effort?.total ?? 0;
        if (totalBubble) {
            totalBubble.textContent = `${total} action${total === 1 ? '' : 's'}`;
            totalBubble.style.display = total > 0 ? 'inline-block' : 'none';
        }
    }

    // ── Hero wave: total actions/day as the header backdrop ────────────
    // Monotone-cubic line over the selected window (Lead Desk pattern).
    // Hidden for the Today window (single bucket = no line to draw).
    function renderHeroWave(timeline) {
        const band = document.getElementById('mdWave');
        const capEl = document.getElementById('mdWaveCap');
        const tip = document.getElementById('mdWaveTip');
        if (!band) return;
        const buckets = Array.isArray(timeline) ? timeline.map(d => d.total ?? 0) : [];
        if (buckets.length <= 1 || buckets.every(v => v === 0)) {
            band.hidden = true;
            if (capEl) capEl.textContent = '';
            return;
        }
        const DAYS = buckets.length;
        const W = 1200, H = 96, padT = 56, padB = 6;
        const ih = H - padT - padB;
        const yMax = Math.max(...buckets) * 1.15 || 1;
        const x = i => (i / (DAYS - 1)) * W;
        const y = v => padT + ih - (v / yMax) * ih;

        function smoothPath() {
            const pts = buckets.map((v, i) => [x(i), y(v)]);
            const n = pts.length;
            const dx = [], m = [];
            for (let i = 0; i < n - 1; i++) {
                dx.push(pts[i + 1][0] - pts[i][0]);
                m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
            }
            const t = [m[0]];
            for (let i = 1; i < n - 1; i++) t.push((m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2);
            t.push(m[n - 2]);
            for (let i = 0; i < n - 1; i++) {
                if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
                else {
                    const a = t[i] / m[i], b = t[i + 1] / m[i];
                    const s = a * a + b * b;
                    if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
                }
            }
            let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
            for (let i = 0; i < n - 1; i++) {
                const h = dx[i];
                d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1) +
                     ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1) +
                     ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
            }
            return d;
        }

        const line = smoothPath();
        const area = line + ' L' + W + ',' + H + ' L0,' + H + ' Z';
        let peak = 0;
        buckets.forEach((v, i) => { if (v > buckets[peak]) peak = i; });
        const dayLabel = i => {
            const d = new Date(timeline[i].day);
            return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        };

        band.innerHTML =
            `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Actions per day in the selected window">` +
            `<defs><linearGradient id="mdWaveFill" x1="0" y1="0" x2="0" y2="1">` +
            `<stop offset="0" stop-color="var(--brand-primary)" stop-opacity="0.24"/>` +
            `<stop offset="1" stop-color="var(--brand-primary)" stop-opacity="0"/>` +
            `</linearGradient></defs>` +
            `<path d="${area}" fill="url(#mdWaveFill)" stroke="none"/>` +
            `<path class="draw-line" d="${line}" fill="none" stroke="var(--brand-primary)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>` +
            `<circle cx="${x(peak).toFixed(1)}" cy="${y(buckets[peak]).toFixed(1)}" r="3.5" fill="var(--brand-primary)"/>` +
            `<line id="mdWaveCross" x1="0" y1="${padT}" x2="0" y2="${padT + ih}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>` +
            `</svg>`;
        band.hidden = false;
        if (capEl) capEl.textContent = 'Actions/day · ' + DAYS + 'd';

        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const p = band.querySelector('.draw-line');
            const len = p.getTotalLength();
            p.style.strokeDasharray = len;
            p.style.strokeDashoffset = len;
            p.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.15s';
            requestAnimationFrame(() => requestAnimationFrame(() => { p.style.strokeDashoffset = '0'; }));
        }

        const svg = band.querySelector('svg');
        const cross = band.querySelector('#mdWaveCross');
        svg.addEventListener('mousemove', (e) => {
            if (!tip) return;
            const rect = svg.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width * W;
            const idx = Math.min(DAYS - 1, Math.max(0, Math.round((relX / W) * (DAYS - 1))));
            cross.style.display = '';
            cross.setAttribute('x1', x(idx));
            cross.setAttribute('x2', x(idx));
            tip.style.display = 'block';
            tip.style.left = Math.min(Math.max(x(idx) / W * rect.width, 70), rect.width - 70) + 'px';
            tip.style.top = '46px';
            tip.textContent = '';
            const b = document.createElement('b'); b.textContent = String(buckets[idx]);
            tip.append(dayLabel(idx) + ' · ', b, ' actions');
        });
        svg.addEventListener('mouseleave', () => {
            cross.style.display = 'none';
            if (tip) tip.style.display = 'none';
        });
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

    // Daily Activity — stacked column timeseries showing effort per day for
    // the selected period. Only renders for Week / Month — for Today there's
    // a single bucket so the chart adds no value over the tiles themselves.
    // When every day in the window is empty (e.g. a brand new rep), we still
    // show the chart wrapper with a friendly empty state.
    function renderTimelineChart(timeline) {
        const card = document.getElementById('timelineCard');
        const sub = document.getElementById('timelineSub');
        const body = document.getElementById('chartTimeline');
        if (!card || !body) return;

        // Hide for single-day windows entirely. The tile values + the
        // donut/funnel already show the same information.
        if (!Array.isArray(timeline) || timeline.length <= 1) {
            card.style.display = 'none';
            return;
        }
        card.style.display = '';

        const days = timeline.map(b => b.day);
        const totalActions = timeline.reduce((s, b) => s + (b.total || 0), 0);
        if (sub) sub.textContent = totalActions === 0
            ? 'no actions logged in this window'
            : `${totalActions} action${totalActions === 1 ? '' : 's'} across ${timeline.length} days`;

        if (totalActions === 0) {
            if (_charts['chartTimeline']) {
                try { _charts['chartTimeline'].destroy(); } catch (_) {}
                delete _charts['chartTimeline'];
            }
            body.innerHTML = '<div class="md-chart-empty">Nothing logged in this window — log a call, email, meeting, or task on a day to see it bloom here.</div>';
            return;
        }

        // Series order is intentional: dense "loud" metrics (calls, emails)
        // first so the eye lands on them. Subtle inputs (deal moves, notes)
        // last because they're rarer but still meaningful.
        const series = [
            { name: 'Calls',     color: '#6366f1', key: 'calls_logged' },
            { name: 'Emails',    color: '#3b82f6', key: 'emails_logged' },
            { name: 'Meetings',  color: '#a855f7', key: 'meetings_held' },
            { name: 'Notes',     color: '#eab308', key: 'notes_logged' },
            { name: 'New leads', color: '#14b8a6', key: 'new_leads' },
            { name: 'Tasks',     color: '#22c55e', key: 'tasks_completed' },
            { name: 'Follow-ups',color: '#f97316', key: 'followups_completed' },
            { name: 'Deal moves',color: '#ec4899', key: 'deals_stage_changes' }
        ].map(s => ({
            name: s.name,
            color: s.color,
            data: timeline.map(b => Number(b[s.key] || 0))
        }));

        renderChart('chartTimeline', {
            chart: {
                type: 'bar', height: 300, stacked: true,
                toolbar: { show: false }
            },
            series: series.map(s => ({ name: s.name, data: s.data })),
            colors: series.map(s => s.color),
            xaxis: {
                categories: days,
                labels: {
                    style: { fontSize: '11px' },
                    formatter: (val) => {
                        // Format "2026-05-08" → "May 8". Cheap + readable.
                        if (!val) return '';
                        try {
                            const d = new Date(val + 'T00:00:00');
                            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                        } catch { return val; }
                    }
                }
            },
            yaxis: {
                labels: { style: { fontSize: '11px' } },
                title: { text: 'actions', style: { fontSize: '10px', fontWeight: 500 } }
            },
            plotOptions: {
                bar: { columnWidth: '60%', borderRadius: 3, borderRadiusApplication: 'end' }
            },
            stroke: { width: 0 },
            dataLabels: { enabled: false },
            legend: {
                position: 'top', horizontalAlign: 'center',
                fontSize: '11px', itemMargin: { vertical: 0, horizontal: 6 },
                markers: { width: 10, height: 10, radius: 3 }
            },
            grid: { padding: { top: 0, right: 10, bottom: 0, left: 10 } },
            tooltip: { y: { formatter: (v) => v + (v === 1 ? ' action' : ' actions') } }
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
            // The card carries the age of its WORST item. That is what makes a
            // card holding a 93-day debt read differently from one holding a
            // 5-day slip, before any text is read.
            const ages = list.map(i => overdueDays(i.due_at)).filter(d => d != null);
            const oldest = ages.length ? Math.max(...ages) : null;
            return `
                <div class="md-missed-card ${isEmpty ? 'empty' : ''}" data-age="${ageBucket(oldest)}">
                    <div class="md-missed-head">
                        <span class="md-missed-title">${escapeHtml(def.title)}</span>
                        ${oldest != null
                            ? `<span class="md-missed-oldest">oldest <b>${oldest}d</b></span>`
                            : ''}
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

    // ─── Ageing ───────────────────────────────────────────────────────────
    // Overdue work is arrears, so it is bucketed the way a receivables ageing
    // report buckets debt: 1–30, 31–60, 61–90, 90+. The bucket drives colour;
    // the position within 0→90 drives the gauge. Anything past 90 pins full.
    const AGE_CAP = 90;

    function overdueDays(iso) {
        if (!iso) return null;
        const due = new Date(iso);
        if (isNaN(due)) return null;
        const days = Math.floor((Date.now() - due.getTime()) / 86400000);
        return days >= 1 ? days : null;
    }

    function ageBucket(days) {
        if (days == null) return 'clear';
        if (days > 60) return '90';
        if (days > 30) return '60';
        return '30';
    }

    // ─── Coming up ────────────────────────────────────────────────────────
    //
    // GET /api/leads/followups/due — everything scheduled in the next 24 hours,
    // team-scoped by the backend. It had no caller: My Day reported what had
    // already slipped and never what was about to. A rep opening this page in
    // the morning could see their debts but not their day.
    //
    // Forward-looking, so no ageing gauge — the ledger language is for work
    // that is already late. Here the useful figure is how long you have.

    const FOLLOWUP_ICON = {
        call: '📞', email: '✉️', meeting: '📅', whatsapp: '💬', task: '✅'
    };

    // "in 40m" / "in 6h" / "now". Anything already past reads as "now" rather
    // than a negative — an overdue item belongs in the missed cards above, and
    // showing "in -3h" here would just be wrong twice.
    function untilLabel(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const mins = Math.round((d.getTime() - Date.now()) / 60000);
        if (mins <= 0) return 'now';
        if (mins < 60) return `in ${mins}m`;
        const hrs = Math.round(mins / 60);
        return `in ${hrs}h`;
    }

    async function loadComingUp() {
        const host = document.getElementById('upNext');
        if (!host) return;
        host.innerHTML = '<p class="md-upnext-state">Loading…</p>';
        let rows;
        try {
            const res = await api.request('/crm/leads/followups/due');
            rows = Array.isArray(res) ? res : (res?.items || []);
        } catch (e) {
            console.error('[my-day] coming up failed:', e);
            host.innerHTML = `<p class="md-upnext-state">Could not load what is coming up. ${escapeHtml(e.message || '')}</p>`;
            return;
        }
        if (!rows.length) {
            host.innerHTML = '<p class="md-upnext-state">Nothing scheduled in the next 24 hours. '
                + 'Follow-ups you book on a lead show up here.</p>';
            return;
        }

        host.innerHTML = rows
            .slice()
            .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
            .map(f => {
                const type = String(f.followup_type || 'follow-up');
                const at = new Date(f.scheduled_at);
                const clock = isNaN(at) ? '' : at.toLocaleTimeString('en-IN',
                    { hour: '2-digit', minute: '2-digit' });
                return `
                <div class="md-up-row" data-followup="${escapeAttr(f.id)}" data-lead="${escapeAttr(f.lead_id || '')}">
                    <span class="md-up-icon">${FOLLOWUP_ICON[type] || '•'}</span>
                    <div class="md-up-main">
                        <div class="md-up-title">${escapeHtml(type.replace(/_/g, ' '))}</div>
                        ${f.notes ? `<p class="md-up-note">${escapeHtml(String(f.notes).replace(/\s+/g, ' ').trim())}</p>` : ''}
                    </div>
                    <div class="md-up-when">
                        <span class="md-up-in">${escapeHtml(untilLabel(f.scheduled_at))}</span>
                        <span class="md-up-clock">${escapeHtml(clock)}</span>
                    </div>
                    <div class="md-up-actions">
                        <button type="button" class="md-up-btn" data-up="open">Open lead</button>
                        <button type="button" class="md-up-btn md-up-btn-done" data-up="done">Done</button>
                    </div>
                </div>`;
            }).join('');
    }

    // Bound once at module level — the section re-renders on every period
    // change, and a listener per render would fire one click N times.
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('#upNext [data-up]');
        if (!btn) return;
        const row = btn.closest('.md-up-row');
        const leadId = row?.getAttribute('data-lead');
        const fid = row?.getAttribute('data-followup');

        if (btn.getAttribute('data-up') === 'open') {
            // Same sessionStorage handoff the missed rows use — leads.js opens
            // the panel after its own load completes.
            if (leadId) sessionStorage.setItem('crm_openLeadId', encodeURIComponent(leadId));
            window.location = `leads.html?${ownerLinkParam()}`;
            return;
        }

        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = '…';
        try {
            await api.request(`/crm/leads/followups/${encodeURIComponent(fid)}/complete`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed_notes: 'Marked done from My Day' })
            });
            row.classList.add('is-done');
            if (typeof Toast !== 'undefined') Toast.success('Follow-up marked done');
            // Re-read rather than just hiding the row: the count above is
            // derived from the same data and would otherwise disagree.
            setTimeout(loadComingUp, 600);
        } catch (err) {
            btn.disabled = false;
            btn.textContent = original;
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Could not complete it');
        }
    });

    function renderMissedItem(item) {
        const title = item.title || '(untitled)';
        const due = item.due_at ? formatDueMeta(item.due_at) : '';
        const days = overdueDays(item.due_at);
        const bucket = ageBucket(days);
        // Gauge fill is the item's position on the 0→90-day scale. A 4% floor
        // keeps a one-day-old item visible as a mark rather than nothing.
        const fill = days == null ? 0 : Math.max(4, Math.min(100, (days / AGE_CAP) * 100));
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
            <li onclick="${onclick}" data-age="${bucket}" style="--age-fill:${fill}%">
                <span class="md-item-title" title="${escapeAttr(title)}">${escapeHtml(title)}</span>
                <span class="md-item-age">${days == null
                    ? `<em>${escapeHtml(due || 'no date')}</em>`
                    : `${days}<em>d</em>`}</span>
                <span class="md-item-gauge" aria-hidden="true"></span>
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
