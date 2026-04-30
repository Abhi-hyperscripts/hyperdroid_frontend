/**
 * CRM analytics dashboard — SUPERADMIN view.
 *
 * Single composite payload from /api/crm-admin/analytics/leads is rendered
 * across every block. Date range, source, team, and form-answer filters
 * all narrow the same cohort so every number on the page tells the same
 * story.
 */

// Page state
let _payload = null;
let _dailyChart = null;        // ApexCharts instance — daily trend line
let _funnelChart = null;       // ApexCharts instance — native pyramid funnel
let _engagementChart = null;   // ApexCharts instance — touch-count distribution
let _kpiSparks = [];           // ApexCharts instances for the KPI cards
let _sources = [];
let _teams = [];
// SearchableDropdown wrappers (codebase convention — never native <select>).
// We keep handles so we can call .setValue() when the source-table row click
// scopes the dashboard, and so cross-filter resets stay in sync.
let _dateRangeDropdown = null;
let _sourceDropdown = null;
let _teamDropdown = null;
let _trendMetricDropdown = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof Navigation !== 'undefined') Navigation.init();
    if (typeof setupGuard !== 'undefined' && setupGuard.run) await setupGuard.run();

    await Promise.all([loadSources(), loadTeams()]);

    // Defeat browser autofill — Chrome occasionally restores last-session
    // selections on a fresh page even when our markup defaults to "" (All).
    // The dashboard's whole-tenant view is the right entry point.
    document.getElementById('anaSource').value = '';
    document.getElementById('anaTeam').value = '';

    initSearchableDropdowns();

    FormAnswersFilter.init({
        getSourceId: () => document.getElementById('anaSource')?.value,
        onApply: () => loadAnalytics()
    });

    await loadAnalytics();
});

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    _dateRangeDropdown = convertSelectToSearchable('anaDateRange', {
        compact: true,
        placeholder: 'Last 30 days',
        searchPlaceholder: 'Search…',
        onChange: () => onDateRangeChanged()
    });

    _sourceDropdown = convertSelectToSearchable('anaSource', {
        compact: true,
        placeholder: 'All sources',
        searchPlaceholder: 'Search sources…',
        onChange: () => onSourceChanged()
    });

    _teamDropdown = convertSelectToSearchable('anaTeam', {
        compact: true,
        placeholder: 'All teams',
        searchPlaceholder: 'Search teams…',
        onChange: () => loadAnalytics()
    });

    _trendMetricDropdown = convertSelectToSearchable('anaTrendMetric', {
        compact: true,
        placeholder: 'New leads',
        searchPlaceholder: 'Search metric…',
        onChange: () => renderDailyChart()
    });
}

// ── Filter state ─────────────────────────────────────────────

function getDateWindow() {
    const sel = document.getElementById('anaDateRange').value;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday); endOfToday.setDate(endOfToday.getDate() + 1);

    let from, to;
    if (sel === 'custom') {
        const f = document.getElementById('anaCustomFrom').value;
        const t = document.getElementById('anaCustomTo').value;
        if (f && t) {
            from = new Date(f + 'T00:00:00');
            to = new Date(t + 'T00:00:00'); to.setDate(to.getDate() + 1);
        } else {
            from = new Date(endOfToday); from.setDate(from.getDate() - 30); to = endOfToday;
        }
    } else if (sel === 'this_month') {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        to = endOfToday;
    } else if (sel === 'last_month') {
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
        const days = parseInt(sel, 10) || 30;
        to = endOfToday;
        from = new Date(endOfToday); from.setDate(from.getDate() - days);
    }
    return { from, to };
}

function buildAnalyticsParams() {
    const { from, to } = getDateWindow();
    const params = new URLSearchParams();
    params.set('from', from.toISOString());
    params.set('to', to.toISOString());
    // tzOffsetMinutes is "minutes east of UTC" — JS getTimezoneOffset
    // returns minutes WEST of UTC, so we negate. Backend uses this to
    // bucket the daily-trend chart by USER'S local day rather than UTC.
    params.set('tzOffsetMinutes', String(-new Date().getTimezoneOffset()));
    const src = document.getElementById('anaSource').value;
    if (src) params.set('leadSourceId', src);
    const team = document.getElementById('anaTeam').value;
    if (team) params.set('teamId', team);
    if (src) {
        const fa = FormAnswersFilter.getFilter();
        if (fa && Object.keys(fa).length > 0) params.set('customFields', JSON.stringify(fa));
    }
    return params;
}

function onDateRangeChanged() {
    const sel = document.getElementById('anaDateRange').value;
    const showCustom = sel === 'custom';
    document.getElementById('anaCustomFromWrap').style.display = showCustom ? '' : 'none';
    document.getElementById('anaCustomToWrap').style.display = showCustom ? '' : 'none';
    if (showCustom) {
        // Default custom range to last 30 days for first visit.
        const t = new Date();
        const f = new Date(t); f.setDate(f.getDate() - 30);
        const fmt = d => d.toISOString().slice(0, 10);
        if (!document.getElementById('anaCustomFrom').value) document.getElementById('anaCustomFrom').value = fmt(f);
        if (!document.getElementById('anaCustomTo').value) document.getElementById('anaCustomTo').value = fmt(t);
    }
    loadAnalytics();
}

function onSourceChanged() {
    // Different forms ask different questions — clear the form-answers
    // filter when source changes so we don't carry stale picks.
    FormAnswersFilter.reset();
    loadAnalytics();
}

window.onDateRangeChanged = onDateRangeChanged;
window.onSourceChanged = onSourceChanged;
window.loadAnalytics = loadAnalytics;
window.renderDailyChart = renderDailyChart;

// ── Data loaders ─────────────────────────────────────────────

async function loadSources() {
    try {
        const list = await api.request('/crm/lead-sources');
        _sources = Array.isArray(list) ? list : (list?.data || list?.items || []);
        const sel = document.getElementById('anaSource');
        // Newest first to mirror the leads-list source dropdown.
        _sources.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        for (const s of _sources) {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.source_name + (s.source_type ? ` · ${s.source_type}` : '');
            sel.appendChild(opt);
        }
    } catch (e) { console.warn('loadSources failed', e); }
}

async function loadTeams() {
    try {
        const teams = await api.request('/crm/teams');
        _teams = Array.isArray(teams) ? teams : (teams?.data || teams?.items || []);
        const sel = document.getElementById('anaTeam');
        for (const t of _teams) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.team_name || t.name || t.id;
            sel.appendChild(opt);
        }
    } catch (e) { /* silent — teams optional */ }
}

async function loadAnalytics() {
    const params = buildAnalyticsParams();
    document.getElementById('anaKpiGrid').innerHTML = '<div class="ana-loading">Loading…</div>';
    try {
        _payload = await api.request('/crm/crm-admin/analytics/leads?' + params.toString());
    } catch (e) {
        document.getElementById('anaKpiGrid').innerHTML = `<div class="ana-loading" style="color:var(--color-error);">${escapeHtml(e?.message || String(e))}</div>`;
        return;
    }
    renderKpis();
    renderFunnel();
    renderDailyChart();
    renderEngagementDistribution();
    renderSourceTable();
    renderAnswerBreakdown();
    renderRepLeaderboard();
    FormAnswersFilter.refreshButtonState();
}

// ── Renderers ────────────────────────────────────────────────

// ── ApexCharts theming helpers (mirrors insights-chart-renderer.js) ──

function _isDarkTheme() {
    return (document.documentElement.getAttribute('data-theme') || 'dark') !== 'light';
}
function _chartColors() {
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim() || '#6366f1';
    const text = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#94a3b8';
    const grid = _isDarkTheme() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    return { brand, text, grid };
}

function renderKpis() {
    const k = _payload.kpis;
    const grid = document.getElementById('anaKpiGrid');
    // Tear down any existing sparkline instances before re-rendering — the
    // cards' DOM gets replaced wholesale, so leftover instances would leak.
    _kpiSparks.forEach(c => { try { c.destroy(); } catch {} });
    _kpiSparks = [];

    // Each KPI carries a one-line explanation surfaced via the (i) icon —
    // tooltip.js (a body-anchored tooltip lib already used elsewhere) reads
    // the data-tooltip attribute we set inside kpiCard().
    const defs = [
        { id: 'k0', label: 'NEW LEADS',           value: formatInt(k.new_leads.current),         kpi: k.new_leads,
          tooltip: 'Total leads created in this date range. Filters (source, team, form answers) narrow the cohort.' },
        { id: 'k1', label: 'CONNECT RATE',        value: formatPct(k.connect_rate.current),      kpi: k.connect_rate,
          tooltip: 'Share of leads that received at least one call, email, or meeting after creation. Measures whether reps reached out at all.' },
        { id: 'k2', label: 'QUALIFIED RATE',      value: formatPct(k.qualified_rate.current),    kpi: k.qualified_rate,
          tooltip: 'Share of leads moved to qualified or converted status. A lead quality signal once reps have evaluated it.' },
        { id: 'k3', label: 'WON RATE',            value: formatPct(k.won_rate.current),          kpi: k.won_rate,
          tooltip: 'Share of leads whose deal landed in a Won stage. The bottom of the funnel.' },
        { id: 'k4', label: 'WON VALUE',           value: formatCurrency(k.won_value.current),    kpi: k.won_value,
          tooltip: 'Sum of deal value across all won deals attached to leads in this window. Total revenue captured.' },
        { id: 'k5', label: 'MEDIAN RESPONSE',     value: formatDuration(k.median_response_seconds.current), kpi: k.median_response_seconds, lowerBetter: true,
          tooltip: 'Median time from lead creation to first call/email/meeting. Half of contacted leads got a faster response, half slower. Lower is better.' },
        { id: 'k6', label: 'AVG ACTIVITIES/LEAD', value: (k.avg_activities_per_lead.current || 0).toFixed(1), kpi: k.avg_activities_per_lead,
          tooltip: 'Average number of activities (any type) logged per lead in this window. Higher means more rep effort per lead.' },
        { id: 'k7', label: 'STALE LEADS',         value: formatInt(k.stale_leads.current),       kpi: k.stale_leads, lowerBetter: true,
          tooltip: 'Active leads with no activity in the last 7 days. Excludes leads already closed (won/unqualified). Lower is better.' },
        // Timeline-derived engagement metrics — answer "how widely + how long
        // are reps actually working leads, and how fast does each lead reach
        // a final disposition".
        { id: 'k8', label: 'ENGAGED %',           value: formatPct(k.engaged_pct?.current || 0), kpi: k.engaged_pct || {current:0,previous:0,delta_pct:null,series:[]},
          tooltip: 'Share of leads that received at least 2 contact-type touches (call/email/meeting). Distinguishes truly worked leads from drive-by single-call leads.' },
        { id: 'k9', label: 'AVG ENGAGEMENT DAYS', value: formatDays(k.avg_engagement_days?.current || 0), kpi: k.avg_engagement_days || {current:0,previous:0,delta_pct:null,series:[]},
          tooltip: 'For engaged leads (≥2 touches), the average span between their first and last contact activity. How long reps stay active before going quiet.' },
        { id: 'k10', label: 'AVG DAYS TO WON',    value: formatDays(k.avg_days_to_won?.current || 0), kpi: k.avg_days_to_won || {current:0,previous:0,delta_pct:null,series:[]}, lowerBetter: true,
          tooltip: 'Average time from lead creation to deal-stage Won. Time-to-revenue. Lower is better.' },
        { id: 'k11', label: 'AVG DAYS TO CLOSE',  value: formatDays(k.avg_days_to_terminal?.current || 0), kpi: k.avg_days_to_terminal || {current:0,previous:0,delta_pct:null,series:[]}, lowerBetter: true,
          tooltip: 'Average time from lead creation to ANY terminal disposition (won, lost, or unqualified). Time-to-decision. Lower is better.' }
    ];
    grid.innerHTML = defs.map(d => kpiCard(d)).join('');

    // Mount an ApexCharts sparkline into each card.
    const { brand } = _chartColors();
    defs.forEach(d => {
        const el = document.getElementById(`spark-${d.id}`);
        if (!el) return;
        const series = (d.kpi.series || []).map(v => Number(v) || 0);
        // Some KPIs (e.g. stale_leads — a current snapshot, not a daily trend)
        // intentionally return an empty series. Skip the sparkline rather than
        // mounting an empty chart that renders a stray axis line.
        if (series.length === 0) return;
        const spark = new ApexCharts(el, {
            chart: { type: 'area', height: 36, width: 100, sparkline: { enabled: true }, animations: { enabled: false }, background: 'transparent' },
            stroke: { curve: 'smooth', width: 1.5 },
            fill: { type: 'gradient', gradient: { shadeIntensity: 0.4, opacityFrom: 0.5, opacityTo: 0.05, stops: [0, 100] } },
            colors: [brand],
            tooltip: { enabled: false },
            series: [{ data: series.length ? series : [0, 0] }]
        });
        spark.render();
        _kpiSparks.push(spark);
    });
}

function kpiCard(d) {
    const delta = d.kpi.delta_pct;
    let deltaClass = 'flat', arrow = '–', deltaTxt = '—';
    if (delta != null) {
        const isUp = delta >= 0;
        const isGood = d.lowerBetter ? !isUp : isUp;
        deltaClass = Math.abs(delta) < 0.5 ? 'flat' : (isGood ? 'up' : 'down');
        arrow = Math.abs(delta) < 0.5 ? '–' : (isUp ? '▲' : '▼');
        deltaTxt = `${arrow} ${Math.abs(delta).toFixed(1)}%`;
    }
    // Info button + tooltip — tooltip.js auto-binds on document load.
    const infoBtn = d.tooltip
        ? `<button type="button" class="ana-kpi-info" data-tooltip="${escapeHtml(d.tooltip)}" aria-label="What does ${escapeHtml(d.label)} mean?" tabindex="0">i</button>`
        : '';
    return `
    <div class="ana-kpi-card">
        ${infoBtn}
        <div class="ana-kpi-label">${d.label}</div>
        <div class="ana-kpi-value">${d.value}</div>
        <div class="ana-kpi-delta ${deltaClass}">${deltaTxt} <span style="color:var(--text-secondary)">vs prev period</span></div>
        <div id="spark-${d.id}" class="ana-kpi-spark"></div>
    </div>`;
}

function renderFunnel() {
    const funnel = _payload.funnel || [];
    const chartEl = document.getElementById('anaFunnelChart');
    const dropEl = document.getElementById('anaFunnelDropoffs');

    if (_funnelChart) { try { _funnelChart.destroy(); } catch {} _funnelChart = null; }

    if (funnel.length === 0) {
        chartEl.innerHTML = '<div class="ana-empty">No leads in this window.</div>';
        dropEl.innerHTML = '';
        return;
    }

    // ApexCharts native pyramid: bar chart with horizontal:true + isFunnel:true.
    // We clamp the rendered y-value to a minimum (8% of the top stage) so a
    // stage with count=1 doesn't degenerate into a needle and count=0 still
    // gets a visible flat bar — the real count is preserved in the data
    // label and tooltip. Without this, lopsided funnels (e.g. 53/45/1/0)
    // looked like a sharp arrow with floating "Won: 0" text below.
    const { brand, text } = _chartColors();
    const total = funnel[0]?.count || 1;
    const minRender = Math.max(1, total * 0.08);
    const data = funnel.map(s => ({ x: capitalise(s.stage), y: Math.max(s.count, minRender) }));

    _funnelChart = new ApexCharts(chartEl, {
        chart: {
            type: 'bar', height: '100%', background: 'transparent',
            fontFamily: "'DM Sans', -apple-system, sans-serif",
            toolbar: { show: false },
            animations: { enabled: true, speed: 500 }
        },
        series: [{ name: 'Leads', data }],
        plotOptions: {
            bar: {
                horizontal: true, distributed: true, isFunnel: true,
                barHeight: '85%', borderRadius: 6,
                dataLabels: { position: 'center' }
            }
        },
        colors: [brand, brand, brand, brand],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark', type: 'horizontal',
                shadeIntensity: 0.5,
                gradientToColors: [brand],
                inverseColors: false,
                opacityFrom: 1, opacityTo: 0.7,
                stops: [0, 100]
            }
        },
        dataLabels: {
            enabled: true,
            formatter: (val, opt) => {
                const stage = funnel[opt.dataPointIndex];
                const pct = total > 0 ? (100 * stage.count / total) : 0;
                const pctLabel = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
                return `${capitalise(stage.stage)}: ${formatInt(stage.count)} (${pctLabel}%)`;
            },
            style: { fontSize: '12px', fontWeight: 600, colors: ['#fff'] },
            dropShadow: { enabled: true, blur: 2, opacity: 0.6 }
        },
        legend: { show: false },
        tooltip: {
            theme: _isDarkTheme() ? 'dark' : 'light',
            y: { formatter: (val, ctx) => {
                const stage = funnel[ctx.dataPointIndex];
                const pct = total > 0 ? (100 * stage.count / total) : 0;
                return `${formatInt(stage.count)} leads (${pct.toFixed(1)}% of received)`;
            } }
        },
        xaxis: { labels: { show: false }, axisTicks: { show: false }, axisBorder: { show: false } },
        yaxis: { labels: { style: { colors: text, fontSize: '12px' } } },
        grid: { show: false, padding: { left: 8, right: 8, top: 0, bottom: 0 } }
    });
    _funnelChart.render();

    // Drop-off chips below the pyramid — ApexCharts can't show stage-to-stage
    // drop directly inside a funnel without crowding, so we surface them
    // beneath the chart in a single row.
    dropEl.innerHTML = funnel.slice(1).map(s => `
        <div class="ana-funnel-dropoff">
            <span>${capitalise(s.stage)} drop</span>
            <span class="ana-funnel-dropoff-pct">−${(s.dropoff_pct_from_previous || 0).toFixed(0)}%</span>
        </div>`).join('');
}

function renderDailyChart() {
    const series = _payload.daily_series || [];
    const metricEl = document.getElementById('anaTrendMetric');
    const metric = metricEl ? metricEl.value : 'leads';

    // Backend `day` is ::date but the .NET JSON serializer appends T00:00:00.
    // Parse cleanly so the axis reads "Apr 4" not "04-04T00:00:00".
    const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    const points = series.map(d => {
        const datePart = String(d.day || '').slice(0, 10);
        return {
            x: datePart, // ApexCharts datetime string parses YYYY-MM-DD natively
            label: dayFmt.format(new Date(datePart + 'T00:00:00')),
            y: Number(d[metric]) || 0
        };
    });

    const isCurrency = metric === 'won_value';
    const { brand, text, grid } = _chartColors();

    if (_dailyChart) { try { _dailyChart.destroy(); } catch {} _dailyChart = null; }

    // Pre-format the labels ourselves into a `category` axis. ApexCharts'
    // datetime-axis formatter tokens are finicky (`d` is day-of-week,
    // `format: 'MMM d'` collided with `datetimeFormatter`, leaving labels
    // blank). A category axis with pre-formatted strings gives us full
    // control + lets us explicitly cap tick density.
    const categories = points.map(p => p.label);

    _dailyChart = new ApexCharts(document.getElementById('anaDailyChart'), {
        chart: {
            type: 'area', height: '100%', background: 'transparent',
            fontFamily: "'DM Sans', -apple-system, sans-serif",
            toolbar: { show: false },
            animations: { enabled: true, speed: 400 }
        },
        series: [{ name: trendLabel(metric), data: points.map(p => p.y) }],
        colors: [brand],
        stroke: { curve: 'smooth', width: 2 },
        fill: {
            type: 'gradient',
            gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05, stops: [0, 95] }
        },
        markers: { size: 3, strokeWidth: 0, hover: { size: 6 } },
        dataLabels: { enabled: false },
        xaxis: {
            type: 'category', categories,
            tickPlacement: 'on',
            labels: {
                style: { colors: text, fontSize: '11px' },
                rotate: 0, hideOverlappingLabels: true,
                // ~30 day points → show every 4th-5th label so they don't collide.
                // ApexCharts' built-in tickAmount caps total tick count.
            },
            tickAmount: Math.min(8, Math.max(2, categories.length - 1)),
            axisBorder: { show: false },
            axisTicks: { show: true, color: grid }
        },
        yaxis: {
            labels: {
                style: { colors: text, fontSize: '11px' },
                formatter: v => isCurrency ? formatCurrency(v) : formatInt(v)
            }
        },
        grid: { borderColor: grid, strokeDashArray: 3, padding: { top: 0, bottom: 0, left: 4, right: 8 } },
        tooltip: {
            theme: _isDarkTheme() ? 'dark' : 'light',
            x: { show: true },
            y: { formatter: v => isCurrency ? formatCurrency(v) : formatInt(v) }
        },
        legend: { show: false }
    });
    _dailyChart.render();
}

function trendLabel(m) {
    return ({ leads: 'New leads', contacted: 'Contacted', qualified: 'Qualified', won: 'Won', won_value: 'Won value', activities: 'Activities' })[m] || m;
}

function renderEngagementDistribution() {
    const el = document.getElementById('anaEngagementChart');
    if (!el) return;
    const dist = _payload.engagement_distribution || {};
    const buckets = [
        { label: '0 touches',  count: dist.bucket0 || 0,        cls: 'red' },
        { label: '1 touch',    count: dist.bucket1 || 0,        cls: 'red' },
        { label: '2–3 touches', count: dist.bucket2to3 || 0,    cls: 'yellow' },
        { label: '4–5 touches', count: dist.bucket4to5 || 0,    cls: 'green' },
        { label: '6+ touches',  count: dist.bucket6_plus || 0,  cls: 'green' }
    ];
    const total = buckets.reduce((s, b) => s + b.count, 0);

    if (_engagementChart) { try { _engagementChart.destroy(); } catch {} _engagementChart = null; }

    if (total === 0) {
        el.innerHTML = '<div class="ana-empty">No leads in this window.</div>';
        return;
    }

    const { brand, text, grid } = _chartColors();
    // Red→yellow→green palette so reviewers can instantly read engagement
    // depth (left buckets are dormant, right buckets are deeply worked).
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#16a34a'];

    _engagementChart = new ApexCharts(el, {
        chart: {
            type: 'bar', height: 220, background: 'transparent',
            fontFamily: "'DM Sans', -apple-system, sans-serif",
            toolbar: { show: false },
            animations: { enabled: true, speed: 400 }
        },
        series: [{ name: 'Leads', data: buckets.map(b => b.count) }],
        plotOptions: {
            bar: {
                horizontal: false, distributed: true, borderRadius: 6,
                columnWidth: '55%',
                dataLabels: { position: 'top' }
            }
        },
        colors,
        dataLabels: {
            enabled: true, offsetY: -22,
            formatter: v => v > 0 ? `${v} (${((100*v)/total).toFixed(0)}%)` : '',
            style: { fontSize: '11px', colors: [text], fontWeight: 600 }
        },
        legend: { show: false },
        xaxis: {
            categories: buckets.map(b => b.label),
            labels: { style: { colors: text, fontSize: '11px' } },
            axisBorder: { show: false }, axisTicks: { color: grid }
        },
        yaxis: {
            labels: {
                style: { colors: text, fontSize: '11px' },
                formatter: v => formatInt(v)
            }
        },
        grid: { borderColor: grid, strokeDashArray: 3, padding: { top: 24, bottom: 0, left: 4, right: 8 } },
        tooltip: {
            theme: _isDarkTheme() ? 'dark' : 'light',
            y: { formatter: v => `${v} leads (${((100*v)/total).toFixed(1)}% of cohort)` }
        }
    });
    _engagementChart.render();
}

function renderSourceTable() {
    const tbody = document.querySelector('#anaSourceTable tbody');
    const rows = _payload.source_breakdown || [];
    const activeId = document.getElementById('anaSource').value;
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="ana-empty">No leads in this window. Widen the date range or pick a different source.</td></tr>`;
        return;
    }
    // The "(Unspecified)" row uses a placeholder zero-GUID that doesn't
    // resolve to any real source, so we don't make it clickable.
    const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
    tbody.innerHTML = rows.map(r => {
        const clickable = r.source_id && r.source_id !== ZERO_GUID;
        const onclick = clickable ? `onclick="onSourceRowClicked('${r.source_id}')"` : '';
        const cursor = clickable ? '' : 'style="cursor:default;"';
        return `
        <tr class="ana-source-row ${r.source_id === activeId ? 'is-active' : ''}" ${onclick} ${cursor}>
            <td>
                <div style="font-weight:600;">${escapeHtml(r.source_name)}</div>
                <div style="color:var(--text-secondary);font-size:0.78em;">${escapeHtml(r.source_type || '')}</div>
            </td>
            <td class="num">${formatInt(r.leads)}</td>
            <td class="num">${perfBar(r.connect_pct, 'connect')}</td>
            <td class="num">${perfBar(r.qualified_pct, 'qualified')}</td>
            <td class="num">${perfBar(r.won_pct, 'won')}</td>
            <td class="num">${formatCurrency(r.won_value)}</td>
            <td class="num">${formatCurrency(r.avg_deal_value)}</td>
            <td class="num">${r.median_response_seconds != null ? formatDuration(r.median_response_seconds) : '—'}</td>
        </tr>`;
    }).join('');
}

function onSourceRowClicked(sourceId) {
    // Update the wrapper so the trigger label reflects the new selection;
    // setValue mirrors back to the linked native <select>. Skip
    // triggerChange (we call onSourceChanged ourselves) so the form-answers
    // reset only fires once.
    if (_sourceDropdown) _sourceDropdown.setValue(sourceId, false);
    else document.getElementById('anaSource').value = sourceId;
    onSourceChanged();
}
window.onSourceRowClicked = onSourceRowClicked;

// Detect ISO-8601 timestamp strings: "2026-04-22t18:09:01+05:30" etc.
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}/i;
function looksLikeTimestamp(v) { return typeof v === 'string' && ISO_TIMESTAMP_RE.test(v); }

// Format a value for display in the answer-breakdown table — humanise
// timestamps, lowercase enums look fine as-is.
function formatAnswerValue(v) {
    if (v == null) return '';
    if (looksLikeTimestamp(v)) {
        const d = new Date(v);
        if (!isNaN(d)) return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    return v;
}

// Decide whether an answer-breakdown question is worth showing. Hide
// metadata-style fields where every row carries either the same value
// (constant — no analytical signal) or a unique value (timestamps,
// IDs — every row is its own bucket, breakdown is just noise).
function isUsefulAnswerGroup(g) {
    const values = g.values || [];
    const noAnswerCount = g.no_answer ? g.no_answer.leads : 0;
    const totalLeads = values.reduce((s, r) => s + r.leads, 0) + noAnswerCount;
    if (totalLeads === 0) return false;
    // Need at least one real (non-no-answer) value, else the breakdown
    // is just "(no answer) 100%" which we surface as "No answers." now.
    if (values.length === 0) return false;
    // If ANY value carries 2+ leads, the question has signal worth showing.
    if (values.some(v => v.leads >= 2)) return true;
    // Otherwise every value is unique — usually timestamps or IDs.
    // A small cohort (≤3 leads) might just genuinely have unique answers,
    // so allow it through; anything bigger is almost always metadata noise.
    return totalLeads <= 3;
}

function renderAnswerBreakdown() {
    const card = document.getElementById('anaAnswerCard');
    const wrap = document.getElementById('anaAnswers');
    const allGroups = _payload.answer_breakdown;
    if (!allGroups || allGroups.length === 0) { card.style.display = 'none'; return; }

    const groups = allGroups.filter(isUsefulAnswerGroup);
    const hidden = allGroups.length - groups.length;

    if (groups.length === 0) { card.style.display = 'none'; return; }
    card.style.display = '';
    const hiddenNote = hidden > 0
        ? `<div style="color:var(--text-secondary);font-size:0.78em;margin-bottom:10px;">${hidden} metadata field${hidden===1?'':'s'} hidden — every row was identical or unique (timestamps, IDs, etc.).</div>`
        : '';
    wrap.innerHTML = hiddenNote + groups.map(g => {
        const allRows = [...(g.values || []), ...(g.no_answer ? [Object.assign({}, g.no_answer, { value: '__no_answer__' })] : [])];
        if (allRows.length === 0) {
            return `<div class="ana-answer-block"><div class="ana-answer-q">${escapeHtml(g.label)}</div><div class="ana-empty" style="padding:10px;">No answers.</div></div>`;
        }
        const total = allRows.reduce((s, r) => s + r.leads, 0);
        return `
        <div class="ana-answer-block">
            <div class="ana-answer-q">${escapeHtml(g.label)}</div>
            <table class="ana-table">
                <thead><tr>
                    <th>Answer</th><th class="num">Leads</th><th class="num">% of total</th>
                    <th class="num">Connect %</th><th class="num">Qual %</th>
                    <th class="num">Won %</th><th class="num">Won value</th>
                </tr></thead>
                <tbody>
                    ${allRows.map(r => {
                        const isNoAns = r.value === '__no_answer__';
                        const display = isNoAns ? '<em style="color:var(--text-secondary);">(no answer)</em>' : escapeHtml(formatAnswerValue(r.value));
                        const conn = r.leads === 0 ? 0 : (100 * r.contacted / r.leads);
                        const qual = r.leads === 0 ? 0 : (100 * r.qualified / r.leads);
                        const wonPct = r.leads === 0 ? 0 : (100 * r.won / r.leads);
                        const pctOfTotal = total === 0 ? 0 : (100 * r.leads / total);
                        return `<tr>
                            <td>${display}</td>
                            <td class="num">${formatInt(r.leads)}</td>
                            <td class="num">${pctOfTotal.toFixed(0)}%</td>
                            <td class="num">${perfBar(conn, 'connect')}</td>
                            <td class="num">${perfBar(qual, 'qualified')}</td>
                            <td class="num">${perfBar(wonPct, 'won')}</td>
                            <td class="num">${formatCurrency(r.won_value)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
    }).join('');
}

function renderRepLeaderboard() {
    const tbody = document.querySelector('#anaRepTable tbody');
    const rows = _payload.rep_leaderboard || [];
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="ana-empty">No salesperson activity in this window.</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><span style="font-weight:600;">${escapeHtml(r.name || r.user_id)}</span></td>
            <td class="num">${formatInt(r.leads_worked)}</td>
            <td class="num">${perfBar(r.connect_pct, 'connect')}</td>
            <td class="num">${perfBar(r.qualified_pct, 'qualified')}</td>
            <td class="num">${perfBar(r.won_pct, 'won')}</td>
            <td class="num">${formatCurrency(r.won_value)}</td>
            <td class="num">${r.median_response_seconds != null ? formatDuration(r.median_response_seconds) : '—'}</td>
            <td class="num">${(r.activities_per_day || 0).toFixed(1)}</td>
        </tr>
    `).join('');
}

// ── Formatters ───────────────────────────────────────────────

function formatInt(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-IN');
}
function formatPct(n) { return (Number(n) || 0).toFixed(1) + '%'; }
function formatCurrency(n) {
    const v = Number(n) || 0;
    if (v >= 1e7) return '₹' + (v / 1e7).toFixed(1) + 'Cr';
    if (v >= 1e5) return '₹' + (v / 1e5).toFixed(1) + 'L';
    if (v >= 1e3) return '₹' + (v / 1e3).toFixed(1) + 'k';
    return '₹' + v.toFixed(0);
}
function formatDuration(secs) {
    secs = Number(secs) || 0;
    if (secs < 60) return secs.toFixed(0) + 's';
    if (secs < 3600) return (secs / 60).toFixed(0) + 'm';
    if (secs < 86400) return (secs / 3600).toFixed(1) + 'h';
    return (secs / 86400).toFixed(1) + 'd';
}
// Format a fractional days value for engagement KPIs. Sub-day shows hours,
// sub-week shows decimals; longer windows round to whole days.
function formatDays(days) {
    const d = Number(days) || 0;
    if (d <= 0) return '—';
    if (d < 1) return (d * 24).toFixed(1) + 'h';
    if (d < 7) return d.toFixed(1) + 'd';
    return Math.round(d) + 'd';
}
function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Performance bar — colour-coded mini track + percentage label. Bands per
// metric so connect-rate (40/70) doesn't paint everything green just
// because won-rate's bands (2/5) would. Cap fill width at 100%.
const PERF_BANDS = {
    connect:   { green: 70, yellow: 40 },   // %
    qualified: { green: 20, yellow: 10 },
    won:       { green:  5, yellow:  2 }
};
function perfBar(value, metric) {
    const v = Number(value) || 0;
    const bands = PERF_BANDS[metric] || PERF_BANDS.connect;
    const cls = v >= bands.green ? 'green' : (v >= bands.yellow ? 'yellow' : 'red');
    const fillW = Math.min(100, Math.max(0, v));
    return `<span class="ana-perf ${cls}">
        <span class="ana-perf-track"><span class="ana-perf-fill ${cls}" style="width:${fillW}%"></span></span>
        <span class="ana-perf-label ${cls}">${v.toFixed(v < 10 && metric === 'won' ? 1 : 0)}%</span>
    </span>`;
}
function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
