// ============================================================================
// ACCOUNTS CHARTS — shared ApexCharts helpers (theme-aware)
// Loaded on every accounts page BEFORE its page script. Owns the chart registry,
// theme detection, the theme-toggle redraw observer, and the generic chart
// builders (donut / horizontal bar / vertical bar / area). Page scripts provide
// their own per-subsection renderers and set `_acActiveRender` so a theme toggle
// redraws whatever is currently on screen.
// ============================================================================
const _acCharts = {};
// Brand + status palette; stable order so the same category keeps its colour across charts.
const _acPalette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'];
function _acTheme() {
    const css = getComputedStyle(document.documentElement);
    const brand = css.getPropertyValue('--brand-primary').trim() || '#3b82f6';
    const text = css.getPropertyValue('--text-secondary').trim() || '#94a3b8';
    // Match the app's canonical detection (theme.js): default is DARK; only an explicit 'light' is light.
    const isDark = (document.documentElement.getAttribute('data-theme') || 'dark') !== 'light';
    return { brand, text, grid: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)', isDark };
}
// Re-render the active tab's charts when the user toggles the theme (ApexCharts bakes colours in at
// render time, so a light-rendered chart stays light after switching to dark until we redraw it).
let _acActiveRender = null;
if (!window._acThemeWatched) {
    window._acThemeWatched = true;
    try {
        new MutationObserver(() => { if (typeof _acActiveRender === 'function') _acActiveRender(); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) { /* no-op */ }
}
const _inr = (v) => AccountsCommon.formatCurrency(v);
function _acMount(id, options) {
    const el = document.getElementById(id);
    if (!el || typeof ApexCharts === 'undefined') return;
    if (_acCharts[id]) { _acCharts[id].destroy(); delete _acCharts[id]; }
    el.innerHTML = '';
    _acCharts[id] = new ApexCharts(el, options);
    _acCharts[id].render();
}
function _acEmpty(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (_acCharts[id]) { _acCharts[id].destroy(); delete _acCharts[id]; }
    el.innerHTML = `<div class="acc-chart-empty">${msg || 'No data for this period'}</div>`;
}
// Bucket a list of {dateKey, amtKey} into the last N calendar months.
function _acMonthly(items, dateKey, amtKey, months = 6) {
    const now = new Date();
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en', { month: 'short' }), total: 0 });
    }
    const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    items.forEach(it => { const ds = (it[dateKey] || '').substring(0, 7); if (idx[ds] != null) buckets[idx[ds]].total += parseFloat(it[amtKey] || 0); });
    return { categories: buckets.map(b => b.label), data: buckets.map(b => Math.round(b.total * 100) / 100) };
}
// Sum `amtKey` grouped by `labelKey`, ranked desc, top N.
function _acRank(items, labelKey, amtKey, topN = 6) {
    const m = {};
    items.forEach(it => { const k = it[labelKey] || '—'; m[k] = (m[k] || 0) + parseFloat(it[amtKey] || 0); });
    const rows = Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, topN);
    return { labels: rows.map(r => r[0]), data: rows.map(r => Math.round(r[1] * 100) / 100) };
}
function acDonut(id, labels, series, colors) {
    if (!series.length || series.every(v => !v)) return _acEmpty(id);
    const t = _acTheme();
    _acMount(id, {
        chart: { type: 'donut', height: 250, background: 'transparent', fontFamily: 'inherit' },
        theme: { mode: t.isDark ? 'dark' : 'light' },
        labels, series, colors: colors || _acPalette.slice(0, series.length),
        stroke: { colors: ['transparent'] }, dataLabels: { enabled: false },
        legend: { position: 'bottom', labels: { colors: t.text }, fontSize: '12px', markers: { width: 9, height: 9 }, itemMargin: { horizontal: 8, vertical: 3 } },
        plotOptions: { pie: { donut: { size: '70%', labels: { show: true,
            name: { color: t.text, fontSize: '12px' },
            value: { color: t.isDark ? '#f1f5f9' : '#0f172a', fontSize: '18px', fontWeight: 700, formatter: _inr },
            total: { show: true, label: 'Total', fontSize: '12px', color: t.text, formatter: () => _inr(series.reduce((a, b) => a + b, 0)) } } } } },
        tooltip: { theme: t.isDark ? 'dark' : 'light', y: { formatter: _inr } }
    });
}
function acBarH(id, labels, data) {
    if (!data.length) return _acEmpty(id);
    const t = _acTheme();
    _acMount(id, {
        chart: { type: 'bar', height: Math.max(data.length * 44, 170), background: 'transparent', toolbar: { show: false }, fontFamily: 'inherit' },
        theme: { mode: t.isDark ? 'dark' : 'light' },
        plotOptions: { bar: { horizontal: true, borderRadius: 5, barHeight: '56%' } }, colors: [t.brand],
        series: [{ name: 'Amount', data }],
        dataLabels: { enabled: true, formatter: _inr, style: { fontSize: '11px', fontWeight: 600, colors: ['#fff'] } },
        xaxis: { categories: labels, labels: { formatter: _inr, style: { colors: t.text, fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { style: { colors: t.text, fontSize: '12px' }, maxWidth: 170 } },
        grid: { borderColor: t.grid, strokeDashArray: 4, yaxis: { lines: { show: false } } },
        tooltip: { theme: t.isDark ? 'dark' : 'light', y: { formatter: _inr } }
    });
}
function acBarV(id, categories, data, colors) {
    if (!data.length || data.every(v => !v)) return _acEmpty(id);
    const t = _acTheme();
    _acMount(id, {
        chart: { type: 'bar', height: 250, background: 'transparent', toolbar: { show: false }, fontFamily: 'inherit' },
        theme: { mode: t.isDark ? 'dark' : 'light' },
        plotOptions: { bar: { horizontal: false, borderRadius: 5, columnWidth: '52%', distributed: !!colors } },
        colors: colors || [t.brand], legend: { show: false },
        series: [{ name: 'Amount', data }],
        dataLabels: { enabled: false },
        xaxis: { categories, labels: { style: { colors: t.text, fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { formatter: _inr, style: { colors: t.text, fontSize: '11px' } } },
        grid: { borderColor: t.grid, strokeDashArray: 4 },
        tooltip: { theme: t.isDark ? 'dark' : 'light', y: { formatter: _inr } }
    });
}
// Multi-series grouped columns (e.g. Revenue vs Expenses). series = [{ name, data:[…] }, …].
function acColumns(id, categories, series, colors) {
    if (!series || !series.length || series.every(s => (s.data || []).every(v => !v))) return _acEmpty(id);
    const t = _acTheme();
    _acMount(id, {
        chart: { type: 'bar', height: 300, background: 'transparent', toolbar: { show: false }, fontFamily: 'inherit' },
        theme: { mode: t.isDark ? 'dark' : 'light' },
        plotOptions: { bar: { horizontal: false, borderRadius: 4, columnWidth: '58%' } },
        colors: colors || _acPalette,
        series, dataLabels: { enabled: false },
        legend: { position: 'top', horizontalAlign: 'left', labels: { colors: t.text }, fontSize: '12px', markers: { width: 10, height: 10 } },
        stroke: { show: true, width: 2, colors: ['transparent'] },
        xaxis: { categories, labels: { style: { colors: t.text, fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { formatter: _inr, style: { colors: t.text, fontSize: '11px' } } },
        grid: { borderColor: t.grid, strokeDashArray: 4 },
        tooltip: { theme: t.isDark ? 'dark' : 'light', shared: true, intersect: false, y: { formatter: _inr } }
    });
}
function acArea(id, categories, data, name) {
    if (!data.length || data.every(v => !v)) return _acEmpty(id);
    const t = _acTheme();
    _acMount(id, {
        chart: { type: 'area', height: 250, background: 'transparent', toolbar: { show: false }, fontFamily: 'inherit' },
        theme: { mode: t.isDark ? 'dark' : 'light' },
        stroke: { curve: 'smooth', width: 2.5 }, colors: [t.brand],
        fill: { type: 'gradient', gradient: { shadeIntensity: 0.4, opacityFrom: 0.35, opacityTo: 0.03, stops: [0, 100] } },
        series: [{ name: name || 'Amount', data }], dataLabels: { enabled: false },
        xaxis: { categories, labels: { style: { colors: t.text, fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { formatter: _inr, style: { colors: t.text, fontSize: '11px' } } },
        grid: { borderColor: t.grid, strokeDashArray: 4 },
        tooltip: { theme: t.isDark ? 'dark' : 'light', y: { formatter: _inr } }
    });
}
