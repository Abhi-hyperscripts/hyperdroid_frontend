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
let _dailyChart = null;
let _sources = [];
let _teams = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof Navigation !== 'undefined') Navigation.init();
    if (typeof setupGuard !== 'undefined' && setupGuard.run) await setupGuard.run();

    await Promise.all([loadSources(), loadTeams()]);

    // Defeat browser autofill — Chrome occasionally restores last-session
    // selections on a fresh page even when our markup defaults to "" (All).
    // The dashboard's whole-tenant view is the right entry point.
    document.getElementById('anaSource').value = '';
    document.getElementById('anaTeam').value = '';

    FormAnswersFilter.init({
        getSourceId: () => document.getElementById('anaSource')?.value,
        onApply: () => loadAnalytics()
    });

    await loadAnalytics();
});

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
    renderSourceTable();
    renderAnswerBreakdown();
    renderRepLeaderboard();
    FormAnswersFilter.refreshButtonState();
}

// ── Renderers ────────────────────────────────────────────────

function renderKpis() {
    const k = _payload.kpis;
    const grid = document.getElementById('anaKpiGrid');
    const cards = [
        kpiCard('NEW LEADS',           formatInt(k.new_leads.current),         k.new_leads,           k.new_leads.series),
        kpiCard('CONNECT RATE',        formatPct(k.connect_rate.current),      k.connect_rate,        k.connect_rate.series),
        kpiCard('QUALIFIED RATE',      formatPct(k.qualified_rate.current),    k.qualified_rate,      k.qualified_rate.series),
        kpiCard('WON RATE',            formatPct(k.won_rate.current),          k.won_rate,            k.won_rate.series),
        kpiCard('WON VALUE',           formatCurrency(k.won_value.current),    k.won_value,           k.won_value.series),
        kpiCard('MEDIAN RESPONSE',     formatDuration(k.median_response_seconds.current), k.median_response_seconds, k.median_response_seconds.series, /*lowerIsBetter=*/true),
        kpiCard('AVG ACTIVITIES/LEAD', k.avg_activities_per_lead.current.toFixed(1), k.avg_activities_per_lead, k.avg_activities_per_lead.series),
        kpiCard('STALE LEADS',         formatInt(k.stale_leads.current),       k.stale_leads,         k.stale_leads.series, /*lowerIsBetter=*/true)
    ];
    grid.innerHTML = cards.join('');
    // Render sparklines after the cards mount.
    document.querySelectorAll('.ana-kpi-spark').forEach(canvas => {
        const series = JSON.parse(canvas.dataset.series || '[]');
        drawSparkline(canvas, series);
    });
}

function kpiCard(label, value, kpi, series, lowerIsBetter) {
    const delta = kpi.delta_pct;
    let deltaClass = 'flat', arrow = '–', deltaTxt = '—';
    if (delta != null) {
        const isUp = delta >= 0;
        const isGood = lowerIsBetter ? !isUp : isUp;
        deltaClass = Math.abs(delta) < 0.5 ? 'flat' : (isGood ? 'up' : 'down');
        arrow = Math.abs(delta) < 0.5 ? '–' : (isUp ? '▲' : '▼');
        deltaTxt = `${arrow} ${Math.abs(delta).toFixed(1)}%`;
    }
    return `
    <div class="ana-kpi-card">
        <div class="ana-kpi-label">${label}</div>
        <div class="ana-kpi-value">${value}</div>
        <div class="ana-kpi-delta ${deltaClass}">${deltaTxt} <span style="color:var(--text-secondary)">vs prev period</span></div>
        <canvas class="ana-kpi-spark" data-series='${JSON.stringify(series || [])}'></canvas>
    </div>`;
}

function drawSparkline(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!data || data.length === 0) return;
    const min = Math.min(...data, 0), max = Math.max(...data, 1);
    const span = max - min || 1;
    const step = w / Math.max(1, data.length - 1);
    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim() || '#6366f1';
    data.forEach((v, i) => {
        const x = i * step;
        const y = h - ((v - min) / span) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

function renderFunnel() {
    const el = document.getElementById('anaFunnel');
    const funnel = _payload.funnel || [];
    const max = Math.max(1, ...funnel.map(s => s.count));
    el.innerHTML = funnel.map(s => `
        <div class="ana-funnel-row">
            <div>${capitalise(s.stage)}</div>
            <div class="ana-funnel-bar"><div class="ana-funnel-fill" style="width:${(s.count / max) * 100}%"></div></div>
            <div class="ana-funnel-count">
                ${formatInt(s.count)}
                ${s.dropoff_pct_from_previous > 0 ? `<span class="ana-funnel-drop">−${s.dropoff_pct_from_previous.toFixed(0)}%</span>` : ''}
            </div>
        </div>
    `).join('');
}

function renderDailyChart() {
    const series = _payload.daily_series || [];
    const metric = document.getElementById('anaTrendMetric').value;
    const labels = series.map(d => d.day.slice(5));   // MM-DD
    const data = series.map(d => d[metric] || 0);

    const isCurrency = metric === 'won_value';
    const ctx = document.getElementById('anaDailyChart').getContext('2d');
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim() || '#6366f1';
    const text = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#94a3b8';
    if (_dailyChart) _dailyChart.destroy();
    _dailyChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{
            label: trendLabel(metric),
            data,
            fill: true, tension: 0.3,
            backgroundColor: brand + '33',
            borderColor: brand, borderWidth: 2,
            pointRadius: 2, pointHoverRadius: 5
        }]},
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: text, maxTicksLimit: 8 }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: text, callback: v => isCurrency ? formatCurrency(v) : v }, grid: { color: 'rgba(255,255,255,0.05)' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${trendLabel(metric)}: ${isCurrency ? formatCurrency(ctx.parsed.y) : ctx.parsed.y}` } }
            }
        }
    });
}

function trendLabel(m) {
    return ({ leads: 'New leads', contacted: 'Contacted', qualified: 'Qualified', won: 'Won', won_value: 'Won value', activities: 'Activities' })[m] || m;
}

function renderSourceTable() {
    const tbody = document.querySelector('#anaSourceTable tbody');
    const rows = _payload.source_breakdown || [];
    const activeId = document.getElementById('anaSource').value;
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="ana-empty">No leads in this window. Widen the date range or pick a different source.</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr class="ana-source-row ${r.source_id === activeId ? 'is-active' : ''}" onclick="onSourceRowClicked('${r.source_id}')">
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
        </tr>
    `).join('');
}

function onSourceRowClicked(sourceId) {
    document.getElementById('anaSource').value = sourceId;
    onSourceChanged();
}
window.onSourceRowClicked = onSourceRowClicked;

function renderAnswerBreakdown() {
    const card = document.getElementById('anaAnswerCard');
    const wrap = document.getElementById('anaAnswers');
    const groups = _payload.answer_breakdown;
    if (!groups || groups.length === 0) { card.style.display = 'none'; return; }
    card.style.display = '';
    wrap.innerHTML = groups.map(g => {
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
                        const display = isNoAns ? '<em style="color:var(--text-secondary);">(no answer)</em>' : escapeHtml(r.value);
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
        tbody.innerHTML = `<tr><td colspan="8" class="ana-empty">No counsellor activity in this window.</td></tr>`;
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
