'use strict';

/**
 * Insights PPT Generator
 * Takes an insights dashboard JSON and generates a professional PowerPoint presentation.
 * Uses PptxGenJS (must be loaded via CDN before this script).
 *
 * Usage:
 *   generateInsightsPPT(dashboardJson, { projectName: 'Xbox', sampleSize: 1121 });
 *
 * @param {Object} data - The dashboard JSON (same structure rendered by insights.js)
 * @param {Object} opts - Options: projectName, sampleSize, accentColor, fileName
 */
function generateInsightsPPT(data, opts = {}) {

    if (typeof PptxGenJS === 'undefined') {
        alert('PptxGenJS library not loaded. Cannot generate PPT.');
        return;
    }

    // ═══ CONFIGURATION ═══
    const projectName = opts.projectName || data.project_name || 'Insights Dashboard';
    const sampleSize = opts.sampleSize || data.sample_size || '';
    const fileName = opts.fileName || `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_Insights`;
    const accent = opts.accentColor || '3B82F6';

    // Color palette
    const C = {
        accent,
        accentDark: '2563EB',
        accentLight: 'DBEAFE',
        bg: '0F172A',
        surface: '1E293B',
        surfaceLight: '334155',
        white: 'FFFFFF',
        textPrimary: 'F1F5F9',
        textSecondary: '94A3B8',
        textMuted: '64748B',
        success: '10B981',
        warning: 'F59E0B',
        danger: 'EF4444',
        purple: '8B5CF6',
        cyan: '06B6D4',
        chartColors: ['3B82F6', '10B981', '8B5CF6', 'F59E0B', '06B6D4', 'EF4444', 'EC4899', '14B8A6',
                       'F97316', '6366F1', '84CC16', 'E11D48'],
    };

    const FONT = 'DM Sans';
    const FONT_FALLBACK = 'Calibri';

    // ═══ CREATE PRESENTATION ═══
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = projectName + ' — Insights';
    pptx.author = 'Ragenaizer';

    // Define a reusable master/template
    pptx.defineSlideMaster({
        title: 'CONTENT',
        background: { color: C.bg },
        objects: [
            // Top accent line
            { rect: { x: 0, y: 0, w: '100%', h: 0.04, fill: { color: C.accent } } },
            // Footer
            { text: {
                text: 'Powered by Ragenaizer',
                options: { x: 0.4, y: 5.15, w: 3, h: 0.3, fontSize: 7, color: C.textMuted, fontFace: FONT }
            }},
            { text: {
                text: projectName,
                options: { x: 6, y: 5.15, w: 3.6, h: 0.3, fontSize: 7, color: C.textMuted, fontFace: FONT, align: 'right' }
            }},
        ]
    });

    pptx.defineSlideMaster({
        title: 'SECTION',
        background: { color: C.bg },
        objects: [
            { rect: { x: 0, y: 0, w: '100%', h: 0.04, fill: { color: C.accent } } },
        ]
    });

    // ═══ HELPER FUNCTIONS ═══

    function truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max - 1) + '...' : str;
    }

    function stripBullet(text) {
        if (!text) return '';
        return text.replace(/^[\s•\-–—*]+/, '').trim();
    }

    function parseBullets(text) {
        if (!text) return [];
        if (Array.isArray(text)) return text.map(t => stripBullet(typeof t === 'string' ? t : t.text || ''));
        return text.split('\n').map(l => stripBullet(l)).filter(l => l.length > 0);
    }

    function pctStr(val) {
        if (val == null) return '';
        return typeof val === 'number' ? val.toFixed(1) + '%' : String(val);
    }

    function getChartColor(i) {
        return C.chartColors[i % C.chartColors.length];
    }

    /** Convert flat or multi-series data into PptxGenJS chart data format */
    function toPptxSeries(chartData) {
        const d = chartData.data || chartData;
        const series = d.series || [];
        const labels = d.labels || d.categories || [];

        if (series.length === 0) return { labels: [], series: [] };

        // Multi-series: [{name, data: []}]
        if (typeof series[0] === 'object' && series[0].data) {
            return {
                labels,
                series: series.map((s, i) => ({
                    name: s.name || `Series ${i + 1}`,
                    labels,
                    values: s.data.map(v => (typeof v === 'number' ? v : parseFloat(v) || 0)),
                    color: getChartColor(i),
                }))
            };
        }

        // Flat series: [num, num, ...]
        return {
            labels,
            series: [{
                name: chartData.title || 'Value',
                labels,
                values: series.map(v => (typeof v === 'number' ? v : parseFloat(v) || 0)),
                color: C.accent,
            }]
        };
    }

    // ═══ SLIDE BUILDERS ═══

    /** 1. Title Slide */
    function addTitleSlide() {
        const slide = pptx.addSlide({ masterName: 'SECTION' });

        // Big accent block
        slide.addShape(pptx.ShapeType.rect, {
            x: 0, y: 0, w: '100%', h: 2.8,
            fill: { type: 'solid', color: C.accent },
        });

        // Gradient overlay at bottom of accent block
        slide.addShape(pptx.ShapeType.rect, {
            x: 0, y: 2.4, w: '100%', h: 0.4,
            fill: { type: 'solid', color: C.bg, transparency: 50 },
        });

        // Project name
        slide.addText(projectName, {
            x: 0.6, y: 0.7, w: 8.8, h: 1,
            fontSize: 36, fontFace: FONT, bold: true, color: C.white,
        });

        // Subtitle
        slide.addText('Insights Dashboard', {
            x: 0.6, y: 1.6, w: 8.8, h: 0.5,
            fontSize: 18, fontFace: FONT, color: 'FFFFFFCC',
        });

        // Info bar
        const infoItems = [];
        if (sampleSize) infoItems.push(`N = ${Number(sampleSize).toLocaleString()}`);
        const tabs = data.tabs || data.sections || [];
        infoItems.push(`${tabs.length} sections`);
        const totalCharts = tabs.reduce((sum, t) => sum + (t.charts || []).length, 0);
        infoItems.push(`${totalCharts} charts`);
        infoItems.push(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));

        slide.addText(infoItems.join('  |  '), {
            x: 0.6, y: 3.2, w: 8.8, h: 0.4,
            fontSize: 11, fontFace: FONT, color: C.textSecondary,
        });

        // Branding
        slide.addText('Powered by Ragenaizer', {
            x: 0.6, y: 4.8, w: 3, h: 0.3,
            fontSize: 9, fontFace: FONT, color: C.textMuted,
        });
    }

    /** 2. Executive Summary + KPI Cards Slide */
    function addExecutiveSummarySlide() {
        const kpis = data.kpi_cards || [];
        const summary = data.executive_summary || data.overall_insights || '';
        if (kpis.length === 0 && !summary) return;

        const slide = pptx.addSlide({ masterName: 'CONTENT' });

        // Section header
        slide.addText('Executive Overview', {
            x: 0.4, y: 0.2, w: 9, h: 0.5,
            fontSize: 20, fontFace: FONT, bold: true, color: C.white,
        });

        // KPI cards (up to 6)
        const kpiCount = Math.min(kpis.length, 6);
        if (kpiCount > 0) {
            const cardW = kpiCount <= 3 ? 2.8 : (9.2 / kpiCount);
            const gap = 0.12;
            const startX = 0.4;
            const cardY = 0.85;
            const cardH = 1.35;

            kpis.slice(0, kpiCount).forEach((kpi, i) => {
                const cx = startX + i * (cardW + gap);

                // Card background
                slide.addShape(pptx.ShapeType.roundRect, {
                    x: cx, y: cardY, w: cardW, h: cardH,
                    fill: { color: C.surface }, rectRadius: 0.08,
                    line: { color: C.surfaceLight, width: 0.5 },
                });

                // KPI label
                slide.addText((kpi.kpi_label || kpi.label || '').toUpperCase(), {
                    x: cx + 0.1, y: cardY + 0.08, w: cardW - 0.2, h: 0.25,
                    fontSize: 7, fontFace: FONT, bold: true, color: C.textMuted,
                    align: 'center',
                });

                // KPI value
                const rawVal = kpi.value != null ? kpi.value : kpi.kpi_value;
                const suffix = kpi.suffix || '%';
                const displayVal = rawVal != null ? `${rawVal}${suffix}` : '—';
                slide.addText(displayVal, {
                    x: cx + 0.1, y: cardY + 0.3, w: cardW - 0.2, h: 0.5,
                    fontSize: 26, fontFace: FONT, bold: true, color: C.accent,
                    align: 'center',
                });

                // KPI benchmark/subtitle
                const bench = kpi.benchmark || kpi.subtitle || '';
                if (bench) {
                    slide.addText(bench, {
                        x: cx + 0.08, y: cardY + 0.78, w: cardW - 0.16, h: 0.2,
                        fontSize: 7, fontFace: FONT, color: C.textSecondary,
                        align: 'center',
                    });
                }

                // KPI insight
                const insight = kpi.insight || '';
                if (insight) {
                    slide.addText(truncate(insight, 80), {
                        x: cx + 0.08, y: cardY + 0.98, w: cardW - 0.16, h: 0.3,
                        fontSize: 6.5, fontFace: FONT, color: C.textMuted, italic: true,
                        align: 'center', valign: 'top',
                    });
                }
            });
        }

        // Executive Summary bullets
        const bullets = parseBullets(summary);
        if (bullets.length > 0) {
            const summaryY = kpiCount > 0 ? 2.45 : 0.85;

            slide.addText('KEY FINDINGS', {
                x: 0.4, y: summaryY, w: 9, h: 0.3,
                fontSize: 10, fontFace: FONT, bold: true, color: C.accent,
            });

            const bulletTexts = bullets.slice(0, 6).map(b => ({
                text: truncate(b, 200),
                options: { bullet: { code: '25CF', color: C.accent }, indentLevel: 0 }
            }));

            slide.addText(bulletTexts, {
                x: 0.5, y: summaryY + 0.32, w: 9, h: 2.3,
                fontSize: 10, fontFace: FONT, color: C.textPrimary,
                lineSpacingMultiple: 1.3, valign: 'top',
                paraSpaceAfter: 6,
            });
        }
    }

    /** 3. Section Divider Slide */
    function addSectionDivider(tab, index, totalTabs) {
        const slide = pptx.addSlide({ masterName: 'SECTION' });

        // Section number circle
        slide.addShape(pptx.ShapeType.ellipse, {
            x: 0.6, y: 1.8, w: 0.6, h: 0.6,
            fill: { color: C.accent },
        });
        slide.addText(String(index + 1), {
            x: 0.6, y: 1.8, w: 0.6, h: 0.6,
            fontSize: 18, fontFace: FONT, bold: true, color: C.white,
            align: 'center', valign: 'middle',
        });

        // Section title
        slide.addText(tab.tab_label || tab.label || `Section ${index + 1}`, {
            x: 1.4, y: 1.65, w: 8, h: 0.8,
            fontSize: 28, fontFace: FONT, bold: true, color: C.white,
        });

        // Tab summary (key findings)
        const findings = parseBullets(tab.tab_summary || tab.key_findings || '');
        if (findings.length > 0) {
            slide.addText('KEY FINDINGS', {
                x: 1.4, y: 2.6, w: 8, h: 0.3,
                fontSize: 9, fontFace: FONT, bold: true, color: C.accent,
            });

            const bulletTexts = findings.slice(0, 5).map(f => ({
                text: truncate(f, 180),
                options: { bullet: { code: '2022', color: C.textMuted }, indentLevel: 0 }
            }));

            slide.addText(bulletTexts, {
                x: 1.5, y: 2.92, w: 7.8, h: 2,
                fontSize: 10, fontFace: FONT, color: C.textSecondary,
                lineSpacingMultiple: 1.25, valign: 'top',
                paraSpaceAfter: 4,
            });
        }

        // Progress indicator
        slide.addText(`Section ${index + 1} of ${totalTabs}`, {
            x: 7.5, y: 5.1, w: 2.1, h: 0.3,
            fontSize: 8, fontFace: FONT, color: C.textMuted, align: 'right',
        });
    }

    /** 4. Chart Slide — renders one or two charts per slide */
    function addChartSlides(tab) {
        const charts = tab.charts || [];
        if (charts.length === 0) return;

        // Group charts: full-width gets own slide, half-width paired
        let i = 0;
        while (i < charts.length) {
            const chart1 = charts[i];
            const isHalf1 = chart1.chart_size === 'half';
            const chart2 = (isHalf1 && i + 1 < charts.length && charts[i + 1].chart_size === 'half')
                ? charts[i + 1] : null;

            const slide = pptx.addSlide({ masterName: 'CONTENT' });

            // Tab label in header
            slide.addText(truncate(tab.tab_label || '', 50), {
                x: 0.4, y: 0.12, w: 5, h: 0.28,
                fontSize: 8, fontFace: FONT, color: C.textMuted,
            });

            if (chart2) {
                // Two half-width charts side by side
                renderChartOnSlide(slide, chart1, { x: 0.3, y: 0.45, w: 4.6, h: 4.4 });
                renderChartOnSlide(slide, chart2, { x: 5.1, y: 0.45, w: 4.6, h: 4.4 });
                i += 2;
            } else {
                // Single full-width chart
                renderChartOnSlide(slide, chart1, { x: 0.3, y: 0.45, w: 9.4, h: 4.4 });
                i += 1;
            }
        }
    }

    /** Render a single chart within a slide region */
    function renderChartOnSlide(slide, config, region) {
        const { x, y, w, h } = region;
        const chartType = (config.chart_type || config.type || 'bar').toLowerCase();
        const d = config.data || {};
        const title = config.title || config.question_label || '';
        const base = d.base || d.n || '';
        const insight = config.insight || config.annotation || '';

        // Card background
        slide.addShape(pptx.ShapeType.roundRect, {
            x, y, w, h,
            fill: { color: C.surface }, rectRadius: 0.06,
            line: { color: C.surfaceLight, width: 0.4 },
        });

        // Title bar
        const titleText = truncate(title, 70);
        const baseText = base ? `  N=${Number(base).toLocaleString()}` : '';
        slide.addText([
            { text: titleText, options: { bold: true, fontSize: 10, color: C.white } },
            { text: baseText, options: { fontSize: 8, color: C.textMuted } },
        ], {
            x: x + 0.15, y: y + 0.08, w: w - 0.3, h: 0.35,
            fontFace: FONT, valign: 'middle',
        });

        // Chart content area
        const chartX = x + 0.1;
        const chartY = y + 0.5;
        const chartW = w - 0.2;
        const chartH = h - (insight ? 1.05 : 0.6);

        // Route to specific chart renderer
        switch (chartType) {
            case 'gauge':
            case 'radialbar':
                renderGaugeCard(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            case 'pie':
            case 'donut':
                renderPieChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH }, chartType === 'donut');
                break;
            case 'bar':
                renderBarChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH }, true);
                break;
            case 'column':
                renderBarChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH }, false);
                break;
            case 'stacked_bar':
                renderStackedBarChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            case 'line':
                renderLineChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            case 'area':
                renderAreaChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            case 'radar':
                renderRadarChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            case 'scatter':
            case 'bubble':
                renderScatterChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            case 'heatmap':
                renderHeatmapTable(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            case 'treemap':
            case 'polararea':
                renderDataTable(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            case 'boxplot':
                renderDataTable(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH });
                break;
            default:
                renderBarChart(slide, config, { x: chartX, y: chartY, w: chartW, h: chartH }, true);
        }

        // Insight annotation at bottom
        if (insight) {
            slide.addText(truncate(insight, 160), {
                x: x + 0.15, y: y + h - 0.52, w: w - 0.3, h: 0.42,
                fontSize: 8, fontFace: FONT, italic: true, color: C.textSecondary,
                valign: 'top',
            });
        }
    }

    // ═══ CHART RENDERERS ═══

    /** Gauge / KPI — large centered number with label */
    function renderGaugeCard(slide, config, r) {
        const d = config.data || {};
        const rawVal = Array.isArray(d.series) ? d.series[0] : d.value;
        const suffix = d.suffix || '%';
        const displayVal = rawVal != null ? `${rawVal}${suffix}` : '—';

        slide.addText(displayVal, {
            x: r.x, y: r.y + r.h * 0.15, w: r.w, h: r.h * 0.5,
            fontSize: 42, fontFace: FONT, bold: true, color: C.accent,
            align: 'center', valign: 'middle',
        });

        const bench = d.benchmark || config.benchmark || '';
        if (bench) {
            slide.addText(bench, {
                x: r.x, y: r.y + r.h * 0.6, w: r.w, h: 0.3,
                fontSize: 10, fontFace: FONT, color: C.textSecondary,
                align: 'center',
            });
        }
    }

    /** Pie / Donut chart using PptxGenJS native */
    function renderPieChart(slide, config, r, isDonut) {
        const { labels, series } = toPptxSeries(config);
        if (series.length === 0 || series[0].values.length === 0) return;

        const chartData = [{
            name: series[0].name,
            labels: labels,
            values: series[0].values,
        }];

        const colors = labels.map((_, i) => getChartColor(i));

        slide.addChart(isDonut ? pptx.charts.DOUGHNUT : pptx.charts.PIE, chartData, {
            x: r.x, y: r.y, w: r.w, h: r.h,
            showTitle: false,
            showValue: true,
            showPercent: false,
            dataLabelPosition: 'outEnd',
            dataLabelFontSize: 8,
            dataLabelColor: C.textPrimary,
            dataLabelFontFace: FONT,
            chartColors: colors,
            showLegend: true,
            legendPos: 'b',
            legendFontSize: 7,
            legendFontFace: FONT,
            legendColor: C.textSecondary,
            holeSize: isDonut ? 55 : 0,
        });
    }

    /** Bar chart (horizontal or vertical) */
    function renderBarChart(slide, config, r, horizontal) {
        const { labels, series } = toPptxSeries(config);
        if (series.length === 0) return;

        const chartData = series.map((s, i) => ({
            name: s.name,
            labels: labels,
            values: s.values,
        }));

        const colors = series.length === 1
            ? labels.map((_, i) => getChartColor(i))
            : series.map((_, i) => getChartColor(i));

        slide.addChart(pptx.charts.BAR, chartData, {
            x: r.x, y: r.y, w: r.w, h: r.h,
            showTitle: false,
            barDir: horizontal ? 'bar' : 'col',
            barGrouping: 'clustered',
            barGapWidthPct: 80,
            chartColors: colors,
            showValue: true,
            dataLabelPosition: horizontal ? 'outEnd' : 'outEnd',
            dataLabelFontSize: 8,
            dataLabelColor: C.textPrimary,
            dataLabelFontFace: FONT,
            catAxisLabelColor: C.textSecondary,
            catAxisLabelFontSize: 8,
            catAxisLabelFontFace: FONT,
            valAxisLabelColor: C.textMuted,
            valAxisLabelFontSize: 7,
            valAxisLabelFontFace: FONT,
            catGridLine: { style: 'none' },
            valGridLine: { color: C.surfaceLight, width: 0.3 },
            showLegend: series.length > 1,
            legendPos: 'b',
            legendFontSize: 7,
            legendFontFace: FONT,
            legendColor: C.textSecondary,
            plotBgColor: C.surface,
        });
    }

    /** 100% Stacked Bar chart */
    function renderStackedBarChart(slide, config, r) {
        const { labels, series } = toPptxSeries(config);
        if (series.length === 0) return;

        const chartData = series.map(s => ({
            name: s.name,
            labels: labels,
            values: s.values,
        }));

        const colors = series.map((_, i) => getChartColor(i));

        slide.addChart(pptx.charts.BAR, chartData, {
            x: r.x, y: r.y, w: r.w, h: r.h,
            showTitle: false,
            barDir: 'bar',
            barGrouping: 'percentStacked',
            chartColors: colors,
            showValue: true,
            dataLabelPosition: 'ctr',
            dataLabelFontSize: 7,
            dataLabelColor: C.white,
            dataLabelFontFace: FONT,
            catAxisLabelColor: C.textSecondary,
            catAxisLabelFontSize: 8,
            catAxisLabelFontFace: FONT,
            valAxisHidden: true,
            catGridLine: { style: 'none' },
            valGridLine: { style: 'none' },
            showLegend: true,
            legendPos: 'b',
            legendFontSize: 7,
            legendFontFace: FONT,
            legendColor: C.textSecondary,
            plotBgColor: C.surface,
        });
    }

    /** Line chart */
    function renderLineChart(slide, config, r) {
        const { labels, series } = toPptxSeries(config);
        if (series.length === 0) return;

        const chartData = series.map(s => ({
            name: s.name,
            labels: labels,
            values: s.values,
        }));

        const colors = series.map((_, i) => getChartColor(i));

        slide.addChart(pptx.charts.LINE, chartData, {
            x: r.x, y: r.y, w: r.w, h: r.h,
            showTitle: false,
            chartColors: colors,
            lineSize: 2,
            lineSmooth: false,
            showMarker: true,
            markerSize: 5,
            showValue: false,
            catAxisLabelColor: C.textSecondary,
            catAxisLabelFontSize: 7,
            catAxisLabelFontFace: FONT,
            valAxisLabelColor: C.textMuted,
            valAxisLabelFontSize: 7,
            valAxisLabelFontFace: FONT,
            catGridLine: { style: 'none' },
            valGridLine: { color: C.surfaceLight, width: 0.3 },
            showLegend: series.length > 1,
            legendPos: 'b',
            legendFontSize: 7,
            legendFontFace: FONT,
            legendColor: C.textSecondary,
            plotBgColor: C.surface,
        });
    }

    /** Area chart */
    function renderAreaChart(slide, config, r) {
        const { labels, series } = toPptxSeries(config);
        if (series.length === 0) return;

        const chartData = series.map(s => ({
            name: s.name,
            labels: labels,
            values: s.values,
        }));

        const colors = series.map((_, i) => getChartColor(i));

        slide.addChart(pptx.charts.AREA, chartData, {
            x: r.x, y: r.y, w: r.w, h: r.h,
            showTitle: false,
            chartColors: colors,
            opacity: 40,
            showValue: false,
            catAxisLabelColor: C.textSecondary,
            catAxisLabelFontSize: 7,
            catAxisLabelFontFace: FONT,
            valAxisLabelColor: C.textMuted,
            valAxisLabelFontSize: 7,
            catGridLine: { style: 'none' },
            valGridLine: { color: C.surfaceLight, width: 0.3 },
            showLegend: series.length > 1,
            legendPos: 'b',
            legendFontSize: 7,
            legendFontFace: FONT,
            legendColor: C.textSecondary,
            plotBgColor: C.surface,
        });
    }

    /** Radar chart */
    function renderRadarChart(slide, config, r) {
        const { labels, series } = toPptxSeries(config);
        if (series.length === 0) return;

        const chartData = series.map(s => ({
            name: s.name,
            labels: labels,
            values: s.values,
        }));

        const colors = series.map((_, i) => getChartColor(i));

        slide.addChart(pptx.charts.RADAR, chartData, {
            x: r.x, y: r.y, w: r.w, h: r.h,
            showTitle: false,
            chartColors: colors,
            radarStyle: 'standard',
            catAxisLabelColor: C.textSecondary,
            catAxisLabelFontSize: 7,
            catAxisLabelFontFace: FONT,
            showLegend: series.length > 1,
            legendPos: 'b',
            legendFontSize: 7,
            legendFontFace: FONT,
            legendColor: C.textSecondary,
        });
    }

    /** Scatter chart (for scatter and bubble types) */
    function renderScatterChart(slide, config, r) {
        const d = config.data || {};
        const series = d.series || [];
        if (series.length === 0) return;

        // Scatter expects [{name, values: [{x,y}]}]
        const chartData = series.map((s, i) => {
            const vals = (s.data || []).map(pt => {
                if (Array.isArray(pt)) return { x: pt[0], y: pt[1] };
                if (typeof pt === 'object' && pt.x != null) return pt;
                return { x: i, y: pt };
            });
            return { name: s.name || `Series ${i + 1}`, values: vals };
        });

        const colors = series.map((_, i) => getChartColor(i));

        slide.addChart(pptx.charts.SCATTER, chartData, {
            x: r.x, y: r.y, w: r.w, h: r.h,
            showTitle: false,
            chartColors: colors,
            showValue: false,
            catAxisLabelColor: C.textSecondary,
            catAxisLabelFontSize: 7,
            valAxisLabelColor: C.textMuted,
            valAxisLabelFontSize: 7,
            catGridLine: { color: C.surfaceLight, width: 0.3 },
            valGridLine: { color: C.surfaceLight, width: 0.3 },
            showLegend: series.length > 1,
            legendPos: 'b',
            legendFontSize: 7,
            legendFontFace: FONT,
            legendColor: C.textSecondary,
            plotBgColor: C.surface,
        });
    }

    /** Heatmap — rendered as a colored table */
    function renderHeatmapTable(slide, config, r) {
        const d = config.data || {};
        const series = d.series || [];
        const cats = d.categories || d.labels || [];
        if (series.length === 0) return;

        // Find min/max for color scaling
        let allVals = [];
        series.forEach(s => (s.data || []).forEach(v => { if (typeof v === 'number') allVals.push(v); }));
        const minV = Math.min(...allVals);
        const maxV = Math.max(...allVals);

        function heatColor(val) {
            if (maxV === minV) return C.accent;
            const ratio = (val - minV) / (maxV - minV);
            if (ratio < 0.25) return '1E3A5F';
            if (ratio < 0.5) return '2563EB';
            if (ratio < 0.75) return '3B82F6';
            return '60A5FA';
        }

        // Header row
        const headerRow = [
            { text: '', options: { fill: { color: C.surfaceLight }, fontSize: 6, color: C.textSecondary, fontFace: FONT, align: 'center', bold: true } },
            ...cats.map(c => ({
                text: truncate(String(c), 12),
                options: { fill: { color: C.surfaceLight }, fontSize: 6, color: C.textSecondary, fontFace: FONT, align: 'center', bold: true }
            }))
        ];

        // Data rows
        const dataRows = series.map(s => [
            { text: truncate(s.name || '', 14), options: { fill: { color: C.surfaceLight }, fontSize: 6, color: C.textSecondary, fontFace: FONT, bold: true } },
            ...(s.data || []).map(v => ({
                text: typeof v === 'number' ? v.toFixed(2) : String(v || ''),
                options: { fill: { color: heatColor(v) }, fontSize: 7, color: C.white, fontFace: FONT, align: 'center' }
            }))
        ]);

        const rows = [headerRow, ...dataRows];
        const colCount = rows[0].length;
        const colW = Math.min((r.w) / colCount, 1.2);

        slide.addTable(rows, {
            x: r.x, y: r.y, w: r.w, h: r.h,
            fontSize: 7,
            fontFace: FONT,
            border: { type: 'solid', color: C.bg, pt: 0.5 },
            colW: Array(colCount).fill(colW),
            autoPage: false,
            margin: [2, 2, 2, 2],
        });
    }

    /** Generic data table fallback (for treemap, polarArea, boxPlot, etc.) */
    function renderDataTable(slide, config, r) {
        const d = config.data || {};
        const series = d.series || [];
        const labels = d.labels || d.categories || [];

        // Flat series: labels + values
        if (series.length > 0 && typeof series[0] === 'number') {
            const headerRow = [
                { text: 'Category', options: { fill: { color: C.surfaceLight }, fontSize: 8, color: C.textSecondary, fontFace: FONT, bold: true } },
                { text: 'Value', options: { fill: { color: C.surfaceLight }, fontSize: 8, color: C.textSecondary, fontFace: FONT, bold: true, align: 'right' } },
            ];

            const dataRows = labels.map((lbl, i) => [
                { text: truncate(String(lbl), 40), options: { fill: { color: C.surface }, fontSize: 8, color: C.textPrimary, fontFace: FONT } },
                { text: pctStr(series[i]), options: { fill: { color: C.surface }, fontSize: 8, color: C.accent, fontFace: FONT, bold: true, align: 'right' } },
            ]);

            slide.addTable([headerRow, ...dataRows.slice(0, 12)], {
                x: r.x, y: r.y, w: r.w, h: r.h,
                border: { type: 'solid', color: C.surfaceLight, pt: 0.4 },
                colW: [r.w * 0.65, r.w * 0.35],
                autoPage: false,
                margin: [3, 4, 3, 4],
            });
            return;
        }

        // Multi-series: categories as rows, series as columns
        if (series.length > 0 && typeof series[0] === 'object') {
            const cats = d.categories || d.labels || [];
            const headerRow = [
                { text: '', options: { fill: { color: C.surfaceLight }, fontSize: 7, color: C.textSecondary, fontFace: FONT, bold: true } },
                ...series.map(s => ({
                    text: truncate(s.name || '', 14),
                    options: { fill: { color: C.surfaceLight }, fontSize: 7, color: C.textSecondary, fontFace: FONT, bold: true, align: 'center' }
                }))
            ];

            const dataRows = cats.map((cat, ci) => [
                { text: truncate(String(cat), 20), options: { fill: { color: C.surface }, fontSize: 7, color: C.textPrimary, fontFace: FONT } },
                ...series.map(s => ({
                    text: pctStr(s.data?.[ci]),
                    options: { fill: { color: C.surface }, fontSize: 7, color: C.accent, fontFace: FONT, align: 'center' }
                }))
            ]);

            const colCount = headerRow.length;
            slide.addTable([headerRow, ...dataRows.slice(0, 10)], {
                x: r.x, y: r.y, w: r.w, h: r.h,
                border: { type: 'solid', color: C.surfaceLight, pt: 0.4 },
                colW: Array(colCount).fill(r.w / colCount),
                autoPage: false,
                margin: [2, 3, 2, 3],
            });
        }
    }

    /** 5. Thank You / End Slide */
    function addEndSlide() {
        const slide = pptx.addSlide({ masterName: 'SECTION' });

        slide.addShape(pptx.ShapeType.rect, {
            x: 0, y: 0, w: '100%', h: '100%',
            fill: { color: C.bg },
        });

        slide.addText('Thank You', {
            x: 0, y: 1.5, w: '100%', h: 1,
            fontSize: 36, fontFace: FONT, bold: true, color: C.white,
            align: 'center',
        });

        slide.addText(projectName + ' — Insights Dashboard', {
            x: 0, y: 2.5, w: '100%', h: 0.5,
            fontSize: 14, fontFace: FONT, color: C.textSecondary,
            align: 'center',
        });

        if (sampleSize) {
            slide.addText(`Sample Size: N = ${Number(sampleSize).toLocaleString()}`, {
                x: 0, y: 3.1, w: '100%', h: 0.4,
                fontSize: 11, fontFace: FONT, color: C.textMuted,
                align: 'center',
            });
        }

        slide.addText('Generated by Ragenaizer.com', {
            x: 0, y: 4.4, w: '100%', h: 0.4,
            fontSize: 9, fontFace: FONT, color: C.textMuted,
            align: 'center',
        });

        slide.addText(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), {
            x: 0, y: 4.8, w: '100%', h: 0.3,
            fontSize: 8, fontFace: FONT, color: C.textMuted,
            align: 'center',
        });
    }

    // ═══ MAIN GENERATION FLOW ═══

    try {
        const tabs = data.tabs || data.sections || [];

        // 1. Title slide
        addTitleSlide();

        // 2. Executive summary + KPIs
        addExecutiveSummarySlide();

        // 3. For each section: divider + chart slides
        tabs.forEach((tab, idx) => {
            addSectionDivider(tab, idx, tabs.length);
            addChartSlides(tab);
        });

        // 4. End slide
        addEndSlide();

        // 5. Download
        pptx.writeFile({ fileName: `${fileName}.pptx` })
            .then(() => {
                if (typeof showInsToast === 'function') {
                    showInsToast('PPT downloaded successfully!', 'success');
                }
            })
            .catch(err => {
                console.error('[PPT] Generation failed:', err);
                alert('Failed to generate PPT: ' + err.message);
            });

    } catch (err) {
        console.error('[PPT] Error building presentation:', err);
        alert('Error generating PPT: ' + err.message);
    }
}
