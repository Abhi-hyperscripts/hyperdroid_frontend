/**
 * InsightsCharts — full ApexCharts renderer extracted from
 * js/research/insights.js so non-dashboard pages (e.g. the Custom Tables
 * AI Insight popup) can render the exact same chart shapes with the same
 * fidelity: significance arrows, theme awareness, count-aware tooltips,
 * responsive mobile heights, etc.
 *
 * Public API:
 *   window.InsightsCharts.renderChart(el, chartConfig, options)
 *     el:          HTMLElement — container (will be cleared).
 *     chartConfig: { chart_type, title, data, significance_markers? }
 *     options: {
 *       onSegmentClick?: (segmentName, category) => void
 *           — when provided, bar/column dataPoint clicks will invoke.
 *           Dashboard context only; not used by the AI-insight popup.
 *       formatSettings?: { decimals, showPercent, meansDecimals }
 *           — optional override. Falls back to localStorage['ins-format-settings'],
 *             then to FORMAT_DEFAULTS.
 *     } -> { instance: ApexCharts } | null
 *
 *   window.InsightsCharts.renderCharts(elsOrIds, chartConfigs, options)
 *     Convenience wrapper — renders a parallel array of chart configs.
 *
 * Intentionally STRIPS:
 *   - chart-instance registry (caller handles lifecycle).
 *   - segment_profiles auto-wiring (opt-in via options.onSegmentClick).
 *   - sources / narrative rewrites (dashboard-only).
 *
 * Kept verbatim from insights.js so output is pixel-identical:
 *   baseChartOptions, detectValueSuffix, fmtPct/fmtPctNum/fmtMean/fmtWithSuffix,
 *   buildSignificanceLookup/getSigDirection/colorizeSignificanceLabels,
 *   resolveCount (with dashboardData dependency replaced by an explicit
 *   chartData.base / chartData.n field), buildSigTooltip, and all
 *   15 builders (bar, column=bar, line, area, radar, heatmap, scatter,
 *   bubble, treemap, radialBar, polarArea, boxPlot, pie, donut, stacked_bar,
 *   gauge).
 */
(function () {
    'use strict';

    if (window.InsightsCharts) return;  // idempotent include

    const CHART_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ef4444', '#ec4899', '#14b8a6'];
    const CHART_FONT = "'DM Sans', -apple-system, sans-serif";
    const FORMAT_DEFAULTS = { decimals: 1, showPercent: true, meansDecimals: 2 };

    function getFormatSettings(override) {
        if (override) return { ...FORMAT_DEFAULTS, ...override };
        try {
            const saved = localStorage.getItem('ins-format-settings');
            return saved ? { ...FORMAT_DEFAULTS, ...JSON.parse(saved) } : { ...FORMAT_DEFAULTS };
        } catch { return { ...FORMAT_DEFAULTS }; }
    }

    let _fmtOverride = null;  // set per-call by renderChart so helpers don't need threading
    function fmt() { return getFormatSettings(_fmtOverride); }

    function fmtPct(val) {
        if (val == null || isNaN(val)) return '';
        const s = fmt();
        const num = Number(val);
        const formatted = s.decimals === 0 ? Math.round(num).toString() : num.toFixed(s.decimals);
        return s.showPercent ? formatted + '%' : formatted;
    }
    function fmtPctNum(val) {
        if (val == null || isNaN(val)) return '';
        const s = fmt();
        return s.decimals === 0 ? Math.round(Number(val)).toString() : Number(val).toFixed(s.decimals);
    }
    function fmtMean(val) {
        if (val == null || isNaN(val)) return '';
        const s = fmt();
        return Number(val).toFixed(s.meansDecimals);
    }
    function fmtWithSuffix(val, suffix) {
        if (val == null || isNaN(val)) return '';
        if (suffix === '%') return fmtPct(val);
        const s = fmt();
        const num = Number(val);
        const formatted = s.decimals === 0 ? Math.round(num).toLocaleString() : num.toFixed(s.decimals);
        return suffix ? formatted + ' ' + suffix : formatted;
    }

    // ═══ THEME ═══
    function getTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    }
    function isDark() { return getTheme() === 'dark'; }
    function getChartLabelColor() { return isDark() ? '#94a3b8' : '#64748b'; }
    function getChartGridColor() { return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'; }
    function getChartValueColor() { return isDark() ? '#e2e8f0' : '#1e293b'; }
    function getGaugeTrackColor() { return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'; }
    function getDataLabelColor() { return isDark() ? '#ffffff' : '#334155'; }
    function getPieStrokeColor() { return isDark() ? '#111827' : '#ffffff'; }
    function isMobile() { return window.innerWidth <= 600; }

    const VALUE_FORMAT_MAP = {
        'percentage': '%', 'count': '', 'currency_usd': ' USD', 'currency_eur': ' EUR',
        'billion_usd': 'B USD', 'trillion_usd': 'T USD', 'million': 'M', 'billion': 'B',
        'decimal': '', 'ratio': '', 'index': '', 'year': '', 'custom': ''
    };
    function detectValueSuffix(data, config) {
        if (data.value_format) {
            if (data.value_format === 'custom' && data.value_suffix) return data.value_suffix;
            const mapped = VALUE_FORMAT_MAP[data.value_format];
            if (mapped !== undefined) return mapped;
        }
        if (data.suffix) return data.suffix;
        if (config.suffix) return config.suffix;
        const title = (config.title || '').toLowerCase();
        const statsKeywords = ['mean', 'median', 'index', 'score', 'coefficient', 'correlation', 'count', 'average', 'ratio'];
        if (statsKeywords.some(k => title.includes(k))) return '';
        const allVals = Array.isArray(data.series)
            ? (typeof data.series[0] === 'object' && data.series[0]?.data
                ? data.series.flatMap(s => s.data || [])
                : data.series)
            : [];
        const nums = allVals.filter(v => typeof v === 'number');
        if (nums.length > 0 && nums.every(v => v >= 0 && v <= 100)) return '%';
        return '';
    }
    function chartHeight(desktopH, mobileH) { return isMobile() ? mobileH : desktopH; }

    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function baseChartOptions() {
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        return {
            chart: {
                background: 'transparent',
                fontFamily: CHART_FONT,
                width: '100%',
                toolbar: { show: false, export: { png: { background: 'transparent' }, svg: { background: 'transparent' } } },
                animations: { enabled: true, easing: 'easeinout', speed: 600 }
            },
            theme: { mode: getTheme(), palette: 'palette1' },
            colors: CHART_COLORS,
            grid: { borderColor: gridColor, strokeDashArray: 3 },
            tooltip: { theme: getTheme(), style: { fontSize: '12px' } },
            legend: { labels: { colors: labelColor }, fontSize: '12px', fontFamily: CHART_FONT }
        };
    }

    // ═══ SIGNIFICANCE MARKERS ═══
    function buildSignificanceLookup(config) {
        const markers = config.significance_markers;
        if (!Array.isArray(markers) || markers.length === 0) return null;
        const lookup = new Map();
        markers.forEach(m => {
            const key = m.series ? `${m.category}|||${m.series}` : `${m.category}|||__any__`;
            lookup.set(key, m.direction);
        });
        return lookup;
    }
    function getSigDirection(lookup, category, seriesName) {
        if (!lookup) return null;
        return lookup.get(`${category}|||${seriesName}`) || lookup.get(`${category}|||__any__`) || null;
    }
    function colorizeSignificanceLabels(chartContext) {
        if (!chartContext?.el) return;
        const textEls = chartContext.el.querySelectorAll('.apexcharts-datalabel, .apexcharts-data-labels text');
        textEls.forEach(el => {
            const t = el.textContent || '';
            if (t.includes('▲')) {
                el.setAttribute('fill', '#10b981');
                el.style.fill = '#10b981';
                el.style.fontWeight = '700';
            } else if (t.includes('▼')) {
                el.setAttribute('fill', '#ef4444');
                el.style.fill = '#ef4444';
                el.style.fontWeight = '700';
            }
        });
    }
    function resolveCount(chartData, seriesIndex, dataPointIndex, pctValue) {
        const counts = chartData?.counts;
        if (counts) {
            if (Array.isArray(counts) && counts[seriesIndex]?.data) {
                const c = counts[seriesIndex].data[dataPointIndex];
                if (c != null) return c;
            }
            if (Array.isArray(counts) && typeof counts[0] === 'number') {
                const c = counts[dataPointIndex];
                if (c != null) return c;
            }
        }
        const base = chartData?.base ?? chartData?.n;
        if (base && typeof pctValue === 'number') return Math.round(pctValue * base / 100);
        return null;
    }
    function buildSigTooltip(sigLookup, categories, chartData, config, valSuffix) {
        const suffix = valSuffix !== undefined ? valSuffix : detectValueSuffix(chartData, config);
        return {
            y: {
                formatter: (val, opts) => {
                    let label = typeof val === 'number' ? fmtWithSuffix(val, suffix) : String(val);
                    const count = resolveCount(chartData, opts.seriesIndex, opts.dataPointIndex, val);
                    if (count != null) label += ` <span style="opacity:0.7">(n=${count.toLocaleString()})</span>`;
                    if (sigLookup) {
                        const cat = categories[opts.dataPointIndex];
                        const sName = opts.w?.config?.series?.[opts.seriesIndex]?.name;
                        const dir = getSigDirection(sigLookup, cat, sName);
                        if (dir === 'high') label += ' <span style="color:#10b981;font-weight:700">▲ sig. higher</span>';
                        else if (dir === 'low') label += ' <span style="color:#ef4444;font-weight:700">▼ sig. lower</span>';
                    }
                    return label;
                }
            }
        };
    }

    // ═══ BUILDERS ═══
    function buildGaugeOptions(data, config) {
        const value = data.series ? data.series[0] : (config.value || 0);
        const label = (data.labels && data.labels[0]) || config.kpi_label || '';
        const labelColor = getChartLabelColor();
        const valueColor = getChartValueColor();
        const trackColor = getGaugeTrackColor();
        const mobile = isMobile();
        const valSuffix = detectValueSuffix(data, config);
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'radialBar', height: chartHeight(260, 220) },
            series: [Math.min(100, Math.max(0, value))],
            plotOptions: {
                radialBar: {
                    hollow: { size: '65%', background: 'transparent' },
                    track: { background: trackColor, strokeWidth: '100%' },
                    dataLabels: {
                        name: { show: true, fontSize: mobile ? '11px' : '13px', color: labelColor, offsetY: 20 },
                        value: { show: true, fontSize: mobile ? '26px' : '32px', fontWeight: 700, color: valueColor, offsetY: -16, formatter: (val) => fmtWithSuffix(val, valSuffix) }
                    }
                }
            },
            labels: [label],
            stroke: { lineCap: 'round' },
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } }
        };
    }

    function buildPieOptions(data, config, type) {
        const series = Array.isArray(data.series) ? data.series : [];
        const labels = Array.isArray(data.labels) ? data.labels : [];
        const strokeColor = getPieStrokeColor();
        const mobile = isMobile();
        const valSuffix = detectValueSuffix(data, config);
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: type === 'donut' ? 'donut' : 'pie', height: chartHeight(280, 240) },
            series,
            labels,
            plotOptions: { pie: { donut: { size: type === 'donut' ? '55%' : '0%' }, expandOnClick: false } },
            legend: { ...baseChartOptions().legend, position: 'bottom', fontSize: mobile ? '11px' : '12px', horizontalAlign: 'center' },
            dataLabels: {
                enabled: true,
                formatter: (val) => fmtWithSuffix(val, valSuffix),
                style: { fontSize: mobile ? '10px' : '12px', fontWeight: 600, colors: [getDataLabelColor()] },
                dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.4 }
            },
            stroke: { width: 1, colors: [strokeColor] },
            tooltip: {
                ...baseChartOptions().tooltip,
                y: {
                    formatter: (val, opts) => {
                        let label = fmtWithSuffix(val, valSuffix);
                        const count = resolveCount(data, 0, opts?.dataPointIndex ?? 0, val);
                        if (count != null) label += ` <span style="opacity:0.7">(n=${count.toLocaleString()})</span>`;
                        return label;
                    }
                }
            }
        };
    }

    function buildBarOptions(data, config, horizontal) {
        let series, categories;
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();
        if (Array.isArray(data.series) && data.series.length > 0 && typeof data.series[0] === 'object' && data.series[0].data) {
            series = data.series;
            categories = data.categories || data.labels || [];
        } else {
            series = [{ name: config.title || 'Value', data: data.series || [] }];
            categories = data.labels || data.categories || [];
        }
        const maxLabelLen = mobile ? 14 : 30;
        const displayCategories = categories.map(c => typeof c === 'string' && c.length > maxLabelLen ? c.substring(0, maxLabelLen) + '...' : c);
        const opts = {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'bar', height: chartHeight(280, Math.max(220, categories.length * 40)) },
            series,
            plotOptions: {
                bar: {
                    horizontal,
                    borderRadius: mobile ? 3 : 4,
                    columnWidth: mobile ? '65%' : '55%',
                    barHeight: mobile ? '60%' : '55%',
                    distributed: series.length === 1 && series[0].data.length <= 8
                }
            },
            xaxis: {
                categories: displayCategories,
                labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, maxWidth: mobile ? 100 : 180, trim: true },
                axisBorder: { color: gridColor },
                axisTicks: { color: gridColor }
            },
            yaxis: { labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, maxWidth: mobile ? 90 : 160 } },
            legend: { ...baseChartOptions().legend, fontSize: mobile ? '10px' : '12px', position: 'bottom' },
            dataLabels: { enabled: false }
        };

        const sigLookup = buildSignificanceLookup(config);
        const valSuffix = detectValueSuffix(data, config);
        if (horizontal) opts.xaxis.labels.formatter = v => fmtWithSuffix(v, valSuffix);
        else opts.yaxis.labels.formatter = v => fmtWithSuffix(v, valSuffix);

        if (!mobile) {
            opts.dataLabels = {
                enabled: true,
                formatter: (val, o) => {
                    let label = fmtWithSuffix(val, valSuffix);
                    if (sigLookup) {
                        const cat = categories[o.dataPointIndex];
                        const sName = series[o.seriesIndex]?.name;
                        const dir = getSigDirection(sigLookup, cat, sName);
                        if (dir) label += dir === 'high' ? ' ▲' : ' ▼';
                    }
                    return label;
                },
                style: { fontSize: '11px', fontWeight: 600, colors: [getDataLabelColor()] },
                offsetY: horizontal ? 0 : -8,
                dropShadow: horizontal ? { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.35 } : { enabled: false }
            };
            if (sigLookup) opts.chart.events = { animationEnd: colorizeSignificanceLabels, mounted: colorizeSignificanceLabels };
        }
        const sigTip = buildSigTooltip(sigLookup, categories, data, config, valSuffix);
        if (sigTip.y) opts.tooltip = { ...opts.tooltip, ...sigTip };
        return opts;
    }

    function buildStackedBarOptions(data, config) {
        const series = Array.isArray(data.series) ? data.series : [];
        const categories = data.categories || data.labels || [];
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();
        const sigLookup = buildSignificanceLookup(config);
        const valSuffix = detectValueSuffix(data, config);
        const maxLabelLen = mobile ? 14 : 30;
        const displayCategories = categories.map(c => typeof c === 'string' && c.length > maxLabelLen ? c.substring(0, maxLabelLen) + '...' : c);
        const isPercentFormat = valSuffix === '%' || !data.value_format;
        const usePercentStack = series.length > 1 && isPercentFormat;
        const opts = {
            ...baseChartOptions(),
            chart: {
                ...baseChartOptions().chart, type: 'bar',
                height: chartHeight(320, Math.max(260, categories.length * 44)),
                stacked: true,
                ...(usePercentStack ? { stackType: '100%' } : {}),
                events: sigLookup ? { animationEnd: colorizeSignificanceLabels, mounted: colorizeSignificanceLabels } : {}
            },
            series,
            plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: mobile ? '55%' : '50%' } },
            xaxis: {
                categories: displayCategories,
                labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, formatter: (val) => usePercentStack ? fmtPct(val) : fmtWithSuffix(val, valSuffix) },
                axisBorder: { color: gridColor }
            },
            yaxis: { labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, maxWidth: mobile ? 90 : 160 } },
            tooltip: { y: { formatter: (val) => usePercentStack ? fmtPct(val) : fmtWithSuffix(val, valSuffix) } },
            legend: { ...baseChartOptions().legend, fontSize: mobile ? '10px' : '12px', position: 'bottom' },
            dataLabels: {
                enabled: !mobile,
                formatter: (val, o) => {
                    if (usePercentStack && val <= 5) return '';
                    let label = usePercentStack ? fmtPct(val) : fmtWithSuffix(val, valSuffix);
                    if (sigLookup) {
                        const cat = categories[o.dataPointIndex];
                        const sName = series[o.seriesIndex]?.name;
                        const dir = getSigDirection(sigLookup, cat, sName);
                        if (dir) label += dir === 'high' ? ' ▲' : ' ▼';
                    }
                    return label;
                },
                style: { fontSize: '11px', fontWeight: 600, colors: [getDataLabelColor()] },
                dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.35 }
            },
            fill: { opacity: 0.9 }
        };
        const sigTip = buildSigTooltip(sigLookup, categories, data, config, valSuffix);
        if (sigTip.y) opts.tooltip = { ...opts.tooltip, ...sigTip };
        return opts;
    }

    function buildLineOptions(data, config) {
        let series, categories;
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();
        const valSuffix = detectValueSuffix(data, config);
        if (Array.isArray(data.series) && data.series.length > 0 && typeof data.series[0] === 'object' && data.series[0].data) {
            series = data.series; categories = data.categories || data.labels || [];
        } else {
            series = [{ name: config.title || 'Value', data: data.series || [] }]; categories = data.labels || data.categories || [];
        }
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'line', height: chartHeight(300, 240) },
            series,
            xaxis: { categories, labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, rotate: mobile ? -45 : 0, rotateAlways: mobile && categories.length > 4 }, axisBorder: { color: gridColor } },
            yaxis: { labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, formatter: v => fmtWithSuffix(v, valSuffix) } },
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } },
            legend: { ...baseChartOptions().legend, fontSize: mobile ? '10px' : '12px', position: 'bottom' },
            stroke: { curve: 'smooth', width: mobile ? 2 : 2.5 },
            markers: { size: mobile ? 3 : 4, strokeWidth: 0 },
            dataLabels: { enabled: false }
        };
    }

    function buildAreaOptions(data, config) {
        let series, categories;
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();
        const valSuffix = detectValueSuffix(data, config);
        if (Array.isArray(data.series) && data.series.length > 0 && typeof data.series[0] === 'object' && data.series[0].data) {
            series = data.series; categories = data.categories || data.labels || [];
        } else {
            series = [{ name: config.title || 'Value', data: data.series || [] }]; categories = data.labels || data.categories || [];
        }
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'area', height: chartHeight(320, 260) },
            series,
            stroke: { curve: 'smooth', width: 2 },
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] } },
            xaxis: { categories, labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, rotate: mobile ? -45 : 0, rotateAlways: mobile && categories.length > 4 }, axisBorder: { color: gridColor } },
            yaxis: { labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, formatter: v => fmtWithSuffix(v, valSuffix) } },
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } },
            legend: { ...baseChartOptions().legend, fontSize: mobile ? '10px' : '12px', position: 'bottom' },
            markers: { size: mobile ? 3 : 4, strokeWidth: 0, hover: { size: 6 } },
            dataLabels: { enabled: false }
        };
    }

    function buildRadarOptions(data, config) {
        let series, categories;
        const labelColor = getChartLabelColor();
        const polygonColor = isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const mobile = isMobile();
        if (Array.isArray(data.series) && data.series.length > 0 && typeof data.series[0] === 'object' && data.series[0].data) {
            series = data.series; categories = data.categories || data.labels || [];
        } else {
            series = [{ name: config.title || 'Value', data: data.series || [] }]; categories = data.labels || data.categories || [];
        }
        if (series.length < 2) {
            const flatData = series[0]?.data || [];
            return buildBarOptions({ series: flatData, labels: categories, categories, value_format: data.value_format, value_suffix: data.value_suffix }, config, true);
        }
        const valSuffix = detectValueSuffix(data, config);
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'radar', height: chartHeight(380, 300) },
            series: series.map(s => ({ name: s.name, data: s.data })),
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } },
            xaxis: { categories, labels: { style: { fontSize: mobile ? '9px' : '10px', colors: Array(categories.length).fill(labelColor) } } },
            yaxis: { show: false },
            stroke: { width: 2 },
            fill: { opacity: 0.15 },
            markers: { size: mobile ? 3 : 4, strokeWidth: 0, hover: { size: 6 } },
            plotOptions: { radar: { polygons: { strokeColors: polygonColor, connectorColors: polygonColor, fill: { colors: ['transparent'] } } } },
            legend: { ...baseChartOptions().legend, fontSize: mobile ? '10px' : '12px', position: 'bottom' }
        };
    }

    function buildHeatmapOptions(data, config) {
        const series = Array.isArray(data.series) ? data.series : [];
        const categories = data.categories || data.labels || [];
        const mobile = isMobile();
        const valSuffix = detectValueSuffix(data, config);
        const hmSeries = series.map(s => ({
            name: s.name,
            data: (s.data || []).map((v, i) => ({ x: categories[i] || `Col ${i + 1}`, y: typeof v === 'number' ? v : 0 }))
        }));
        const colorRanges = [
            { from: -Infinity, to: -0.5, color: '#ef4444', name: 'Strong Negative' },
            { from: -0.5, to: -0.1, color: '#f59e0b', name: 'Weak Negative' },
            { from: -0.1, to: 0.1, color: '#94a3b8', name: 'Negligible' },
            { from: 0.1, to: 0.5, color: '#06b6d4', name: 'Weak Positive' },
            { from: 0.5, to: Infinity, color: '#10b981', name: 'Strong Positive' }
        ];
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'heatmap', height: chartHeight(Math.max(300, series.length * 40), Math.max(260, series.length * 36)) },
            series: hmSeries,
            plotOptions: { heatmap: { radius: 2, enableShades: false, colorScale: { ranges: colorRanges } } },
            dataLabels: { enabled: true, formatter: v => fmtWithSuffix(v, valSuffix), style: { fontSize: mobile ? '9px' : '10px', colors: [getDataLabelColor()] } },
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } },
            stroke: { width: 1, colors: [isDark() ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.1)'] },
            legend: { show: false },
            xaxis: { labels: { style: { fontSize: mobile ? '9px' : '10px', colors: getChartLabelColor() }, rotate: categories.length > 6 ? -45 : 0, rotateAlways: categories.length > 6 } }
        };
    }

    function buildScatterOptions(data, config) {
        const points = data.points || [];
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();
        const scSeries = points.map(s => ({ name: s.name, data: (s.data || []).map(p => ({ x: p.x, y: p.y, meta: p.label || '' })) }));
        const scColors = points.map((s, i) => s.color || CHART_COLORS[i % CHART_COLORS.length]);
        const ann = data.annotations || {};
        const annOpts = { xaxis: [], yaxis: [] };
        const annLabelStyle = { color: isDark() ? '#fff' : '#000', background: isDark() ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)', fontSize: '10px', padding: { left: 4, right: 4, top: 2, bottom: 2 } };
        const annBorderColor = isDark() ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
        if (ann.x_line != null) annOpts.xaxis.push({ x: ann.x_line, strokeDashArray: 4, borderColor: annBorderColor, label: { text: 'Mean', style: annLabelStyle, position: 'top' } });
        if (ann.y_line != null) annOpts.yaxis.push({ y: ann.y_line, strokeDashArray: 4, borderColor: annBorderColor, label: { text: 'Mean', style: annLabelStyle, position: 'left' } });
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'scatter', height: chartHeight(380, 300), zoom: { enabled: false } },
            series: scSeries,
            colors: scColors,
            markers: { size: mobile ? 6 : 8, strokeWidth: 1, strokeColors: 'rgba(0,0,0,0.3)', hover: { size: mobile ? 9 : 11 } },
            xaxis: {
                type: 'numeric',
                title: data.x_label ? { text: data.x_label, style: { color: labelColor, fontSize: '11px' } } : undefined,
                labels: { formatter: v => Number(v).toFixed(1) + (data.x_format === 'percentage' ? '%' : ''), style: { fontSize: '10px', colors: labelColor } },
                tickAmount: 6
            },
            yaxis: {
                title: data.y_label ? { text: data.y_label, style: { color: labelColor, fontSize: '11px' } } : undefined,
                labels: { formatter: v => Number(v).toFixed(1) + (data.y_format === 'percentage' ? '%' : ''), style: { fontSize: '10px', colors: labelColor } }
            },
            annotations: annOpts,
            grid: { ...baseChartOptions().grid, xaxis: { lines: { show: true } } },
            tooltip: {
                theme: getTheme(),
                custom: ({ seriesIndex, dataPointIndex, w }) => {
                    const pt = w.config.series[seriesIndex]?.data[dataPointIndex];
                    if (!pt) return '';
                    const sn = w.config.series[seriesIndex].name || '';
                    const bg = isDark() ? '#1e293b' : '#ffffff';
                    const fg = isDark() ? '#e2e8f0' : '#1e293b';
                    const xSuffix = data.x_format === 'percentage' ? '%' : (data.x_format ? '' : ((data.x_label || '').includes('%') ? '%' : ''));
                    const ySuffix = data.y_format === 'percentage' ? '%' : (data.y_format ? '' : ((data.y_label || '').includes('%') ? '%' : ''));
                    return `<div style="padding:8px 12px;font-size:12px;background:${bg};color:${fg};border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.2);"><strong>${esc(pt.meta || sn)}</strong><br>${data.x_label || 'X'}: ${fmtWithSuffix(pt.x, xSuffix)}<br>${data.y_label || 'Y'}: ${fmtWithSuffix(pt.y, ySuffix)}</div>`;
                }
            },
            legend: { ...baseChartOptions().legend, position: 'bottom' }
        };
    }

    function buildBubbleOptions(data, config) {
        const points = data.points || [];
        const labelColor = getChartLabelColor();
        const mobile = isMobile();
        const bSeries = points.map(s => ({ name: s.name, data: (s.data || []).map(p => [p.x, p.y, p.z || 10]) }));
        const bColors = points.map((s, i) => s.color || CHART_COLORS[i % CHART_COLORS.length]);
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'bubble', height: chartHeight(380, 300), zoom: { enabled: false } },
            series: bSeries,
            colors: bColors.length ? bColors : CHART_COLORS,
            fill: { opacity: 0.7 },
            xaxis: { type: 'numeric', title: data.x_label ? { text: data.x_label, style: { color: labelColor, fontSize: '11px' } } : undefined, labels: { style: { fontSize: '10px', colors: labelColor } }, tickAmount: 6 },
            yaxis: { title: data.y_label ? { text: data.y_label, style: { color: labelColor, fontSize: '11px' } } : undefined, labels: { style: { fontSize: '10px', colors: labelColor } } },
            tooltip: {
                theme: getTheme(),
                custom: ({ seriesIndex, dataPointIndex, w }) => {
                    const pt = w.config.series[seriesIndex]?.data[dataPointIndex];
                    if (!pt) return '';
                    const sn = w.config.series[seriesIndex].name || '';
                    const bg = isDark() ? '#1e293b' : '#ffffff';
                    const fg = isDark() ? '#e2e8f0' : '#1e293b';
                    const xVal = Array.isArray(pt) ? pt[0] : pt.x;
                    const yVal = Array.isArray(pt) ? pt[1] : pt.y;
                    const zVal = Array.isArray(pt) ? pt[2] : pt.z;
                    const xSuffix = data.x_format === 'percentage' ? '%' : (data.x_format ? '' : ((data.x_label || '').includes('%') ? '%' : ''));
                    const ySuffix = data.y_format === 'percentage' ? '%' : (data.y_format ? '' : ((data.y_label || '').includes('%') ? '%' : ''));
                    return `<div style="padding:8px 12px;font-size:12px;background:${bg};color:${fg};border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.2);"><strong>${esc(sn)}</strong><br>${data.x_label || 'X'}: ${fmtWithSuffix(xVal, xSuffix)}<br>${data.y_label || 'Y'}: ${fmtWithSuffix(yVal, ySuffix)}${zVal ? '<br>Size: ' + fmtWithSuffix(zVal, '') : ''}</div>`;
                }
            },
            legend: { ...baseChartOptions().legend, position: 'bottom' }
        };
    }

    function buildTreemapOptions(data, config) {
        const points = data.points || [];
        const mobile = isMobile();
        const valSuffix = detectValueSuffix(data, config);
        let tmSeries;
        if (points.length > 0) {
            tmSeries = points.map(s => ({ name: s.name, data: (s.data || []).map(p => ({ x: p.label || p.x, y: p.y })) }));
        } else if (Array.isArray(data.series) && Array.isArray(data.labels)) {
            tmSeries = [{ data: data.labels.map((label, i) => ({ x: label, y: data.series[i] || 0 })) }];
        } else {
            tmSeries = [];
        }
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'treemap', height: chartHeight(340, 280) },
            series: tmSeries,
            plotOptions: { treemap: { enableShades: true, shadeIntensity: 0.3, distributed: tmSeries.length <= 1 } },
            dataLabels: { enabled: true, style: { fontSize: mobile ? '10px' : '11px', fontWeight: 600, colors: [getDataLabelColor()] }, formatter: (text, op) => [text, op.value != null ? fmtWithSuffix(op.value, valSuffix) : ''], offsetY: -2, dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.35 } },
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } },
            legend: { show: false }
        };
    }

    function buildRadialBarOptions(data, config) {
        const series = Array.isArray(data.series) ? data.series.map(v => Math.min(100, Math.max(0, v))) : [];
        const labels = Array.isArray(data.labels) ? data.labels : [];
        const labelColor = getChartLabelColor();
        const valueColor = getChartValueColor();
        const trackColor = getGaugeTrackColor();
        const mobile = isMobile();
        const valSuffix = detectValueSuffix(data, config);
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'radialBar', height: chartHeight(340, 280) },
            series,
            labels,
            plotOptions: {
                radialBar: {
                    hollow: { size: labels.length > 3 ? '30%' : '45%' },
                    track: { background: trackColor, strokeWidth: '100%' },
                    dataLabels: {
                        name: { fontSize: mobile ? '10px' : '12px', color: labelColor, offsetY: -10 },
                        value: { fontSize: mobile ? '16px' : '18px', fontWeight: 600, color: valueColor, formatter: v => fmtWithSuffix(v, valSuffix) },
                        total: { show: labels.length > 1, label: 'Average', fontSize: '11px', color: labelColor, formatter: w => fmtWithSuffix(w.globals.series.reduce((a, b) => a + b, 0) / w.globals.series.length, valSuffix) }
                    }
                }
            },
            stroke: { lineCap: 'round' },
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } }
        };
    }

    function buildPolarAreaOptions(data, config) {
        const valSuffix = detectValueSuffix(data, config);
        const series = Array.isArray(data.series) ? (valSuffix === '%' ? data.series.map(v => Math.min(100, Math.max(0, v))) : data.series) : [];
        const labels = Array.isArray(data.labels) ? data.labels : [];
        const strokeColor = getPieStrokeColor();
        const polygonColor = isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const mobile = isMobile();
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'polarArea', height: chartHeight(340, 280) },
            series,
            labels,
            fill: { opacity: 0.8 },
            stroke: { width: 1, colors: [strokeColor] },
            plotOptions: { polarArea: { rings: { strokeWidth: 1, strokeColor: polygonColor }, spokes: { strokeWidth: 1, connectorColors: polygonColor } } },
            yaxis: { show: false },
            legend: { ...baseChartOptions().legend, position: mobile ? 'bottom' : 'right', fontSize: mobile ? '10px' : '12px' },
            dataLabels: { enabled: true, formatter: v => fmtWithSuffix(v, valSuffix), style: { fontSize: mobile ? '9px' : '11px', fontWeight: 600, colors: [getDataLabelColor()] }, dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.35 } },
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } }
        };
    }

    function buildBoxPlotOptions(data, config) {
        const series = Array.isArray(data.series) ? data.series : [];
        const categories = data.categories || data.labels || [];
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();
        const valSuffix = detectValueSuffix(data, config);
        const bpSeries = series.map(s => ({
            name: s.name || 'Distribution',
            type: 'boxPlot',
            data: (s.data || []).map((d, i) => ({ x: categories[i] || `Group ${i + 1}`, y: Array.isArray(d) ? d : [d, d, d, d, d] }))
        }));
        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'boxPlot', height: chartHeight(340, 280) },
            series: bpSeries,
            plotOptions: { boxPlot: { colors: { upper: isDark() ? '#3b82f6' : '#2563eb', lower: isDark() ? '#10b981' : '#059669' } } },
            xaxis: { labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' } } },
            yaxis: { labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' }, formatter: v => fmtWithSuffix(v, valSuffix) } },
            tooltip: { y: { formatter: v => fmtWithSuffix(v, valSuffix) } },
            grid: { borderColor: gridColor, strokeDashArray: 3 },
            legend: { ...baseChartOptions().legend, position: 'bottom' }
        };
    }

    // ═══ PUBLIC API ═══
    function renderChart(el, chartConfig, options) {
        options = options || {};
        if (!el || !chartConfig) return null;
        if (typeof ApexCharts === 'undefined') {
            el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted,#94a3b8);font-size:12px;">Chart library not loaded</div>`;
            return null;
        }
        _fmtOverride = options.formatSettings || null;
        try {
            const type = chartConfig.chart_type || 'bar';
            const data = chartConfig.data || {};
            let opts;
            switch (type) {
                case 'gauge':       opts = buildGaugeOptions(data, chartConfig); break;
                case 'pie':
                case 'donut':       opts = buildPieOptions(data, chartConfig, type); break;
                case 'bar':         opts = buildBarOptions(data, chartConfig, true); break;
                case 'column':      opts = buildBarOptions(data, chartConfig, false); break;
                case 'stacked_bar': opts = buildStackedBarOptions(data, chartConfig); break;
                case 'line':        opts = buildLineOptions(data, chartConfig); break;
                case 'area':        opts = buildAreaOptions(data, chartConfig); break;
                case 'radar':       opts = buildRadarOptions(data, chartConfig); break;
                case 'heatmap':     opts = buildHeatmapOptions(data, chartConfig); break;
                case 'scatter':     opts = buildScatterOptions(data, chartConfig); break;
                case 'bubble':      opts = buildBubbleOptions(data, chartConfig); break;
                case 'treemap':     opts = buildTreemapOptions(data, chartConfig); break;
                case 'radialBar':   opts = buildRadialBarOptions(data, chartConfig); break;
                case 'polarArea':   opts = buildPolarAreaOptions(data, chartConfig); break;
                case 'boxPlot':     opts = buildBoxPlotOptions(data, chartConfig); break;
                default:            opts = buildBarOptions(data, chartConfig, false);
            }
            if (!opts) return null;

            if (options.onSegmentClick) {
                // Mirror insights.js addSegmentClickHandlers: fire a callback when
                // the user clicks a bar/column/treemap segment. Caller resolves the
                // segment identity from the DOM.
                opts.chart = opts.chart || {};
                const prev = opts.chart.events || {};
                opts.chart.events = {
                    ...prev,
                    dataPointSelection: (e, ctx, cfg) => {
                        try {
                            const seriesName = cfg.w?.config?.series?.[cfg.seriesIndex]?.name || '';
                            const cat = cfg.w?.config?.xaxis?.categories?.[cfg.dataPointIndex] || '';
                            options.onSegmentClick(seriesName, cat, { chartConfig, cfg });
                        } catch (err) { console.warn('onSegmentClick handler threw:', err); }
                    }
                };
            }

            el.innerHTML = '';
            const chart = new ApexCharts(el, opts);
            chart.render();
            return { instance: chart };
        } catch (err) {
            console.warn('[InsightsCharts] render failed:', err);
            el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted,#94a3b8);font-size:12px;">Chart could not be rendered</div>`;
            return null;
        } finally {
            _fmtOverride = null;
        }
    }

    function renderCharts(targets, configs, options) {
        const out = [];
        (configs || []).forEach((cfg, i) => {
            const el = typeof targets[i] === 'string' ? document.getElementById(targets[i]) : targets[i];
            out.push(renderChart(el, cfg, options));
        });
        return out;
    }

    window.InsightsCharts = { renderChart, renderCharts };
})();
