/**
 * Insights Dashboard Renderer
 * Fetches dashboard JSON from public API and renders with ApexCharts.
 * No authentication required — public share link.
 * Supports dark/light theme toggle.
 * Supports 15 chart types: gauge, pie, donut, bar, column, stacked_bar, line,
 * area, radar, heatmap, scatter, bubble, treemap, radialBar, polarArea, boxPlot.
 */

(function () {
    'use strict';

    // ═══ CONFIG ═══
    const API_BASE = (function () {
        const h = window.location.hostname;
        if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.'))
            return window.location.origin.replace(':5501', ':5114').replace('http://', 'https://');
        return 'https://research.ragenaizer.com';
    })();

    const CHART_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ef4444', '#ec4899', '#14b8a6'];
    const CHART_FONT = "'DM Sans', -apple-system, sans-serif";

    // Track all rendered chart instances for theme switching
    let chartInstances = [];
    let kpiChartInstances = [];
    let dashboardData = null;

    // ═══ THEME ═══
    function getTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    }

    function isDark() {
        return getTheme() === 'dark';
    }

    function getChartLabelColor() {
        return isDark() ? '#94a3b8' : '#64748b';
    }

    function getChartGridColor() {
        return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    }

    function getChartValueColor() {
        return isDark() ? '#e2e8f0' : '#1e293b';
    }

    function getGaugeTrackColor() {
        return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    }

    function getPieStrokeColor() {
        return isDark() ? '#111827' : '#ffffff';
    }

    function isMobile() {
        return window.innerWidth <= 600;
    }

    function chartHeight(desktopH, mobileH) {
        return isMobile() ? mobileH : desktopH;
    }

    // Restore saved theme preference
    const savedTheme = localStorage.getItem('ins-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    // ═══ INIT ═══
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
        showError('No share token provided. Please use a valid insights link.');
        return;
    }

    fetchDashboard(token);

    // ═══ FETCH ═══
    async function fetchDashboard(shareToken) {
        try {
            const resp = await fetch(`${API_BASE}/api/insights/${shareToken}`);
            if (!resp.ok) {
                if (resp.status === 404) {
                    showError('Dashboard not found. It may still be generating or the link is invalid.');
                } else {
                    showError(`Failed to load dashboard (HTTP ${resp.status}).`);
                }
                return;
            }

            const data = await resp.json();
            let dashboard = data.dashboard_json;

            if (typeof dashboard === 'string') {
                dashboard = JSON.parse(dashboard);
            }

            if (!dashboard) {
                showError('Dashboard data is empty.');
                return;
            }

            // Update page title
            if (dashboard.project_name) {
                document.title = `${dashboard.project_name} — Insights`;
            }

            dashboardData = dashboard;
            renderDashboard(dashboard);

            // Load chatbot widget if embed_key is available
            if (data.embed_key) {
                loadChatbotWidget(data.embed_key);
            }
        } catch (err) {
            console.error('Failed to load insights:', err);
            showError('Failed to load the insights dashboard. Please try again later.');
        }
    }

    // ═══ ERROR STATE ═══
    function showError(msg) {
        document.getElementById('insLoading').style.display = 'none';
        const errorEl = document.getElementById('insError');
        errorEl.style.display = 'flex';
        document.getElementById('insErrorMsg').textContent = msg;
    }

    // ═══ TOAST ═══
    function showToast(msg) {
        const toast = document.getElementById('insToast');
        toast.textContent = msg;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 2500);
    }

    // ═══ CHATBOT WIDGET ═══
    function loadChatbotWidget(embedKey) {
        const widgetBase = window.location.origin;
        const apiBase = API_BASE;

        const script = document.createElement('script');
        script.src = `${widgetBase}/embed/widget.js`;
        script.setAttribute('data-key', embedKey);
        script.setAttribute('data-api', apiBase);
        document.body.appendChild(script);
    }

    // ═══ RENDER DASHBOARD ═══
    function renderDashboard(d) {
        document.getElementById('insLoading').style.display = 'none';
        const root = document.getElementById('insDashboard');
        root.style.display = 'block';

        const generatedDate = d.generated_at ? new Date(d.generated_at).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
        }) : '';

        const themeIcon = isDark()
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

        // ═══ POPULATE HEADER ROW (same pattern as project-detail) ═══
        const tabs = d.tabs || d.sections || [];
        const firstTabLabel = tabs.length > 0 ? (tabs[0].tab_label || tabs[0].title || 'Overview') : 'Overview';

        // Project title in header
        const titleEl = document.getElementById('insProjectTitle');
        if (titleEl) titleEl.textContent = d.project_name || 'Insights Dashboard';

        // Update OG meta tags + page title dynamically
        const ogTitleText = (d.project_name || 'Insights Dashboard') + ' — Insights';
        document.title = ogTitleText;
        const ogTitle = document.getElementById('ogTitle');
        if (ogTitle) ogTitle.setAttribute('content', ogTitleText);
        const ogDesc = document.getElementById('ogDesc');
        if (ogDesc && d.executive_summary) ogDesc.setAttribute('content', d.executive_summary.substring(0, 200));

        // Active tab name
        const activeTabNameEl = document.getElementById('activeTabName');
        if (activeTabNameEl) activeTabNameEl.textContent = firstTabLabel;

        // Meta info — sample size + methodology info icon
        const metaEl = document.getElementById('insProjectMeta');
        if (metaEl) {
            let metaHtml = '';
            if (d.sample_size) {
                metaHtml += `<span class="meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                    <span>N=${Number(d.sample_size).toLocaleString()}</span>
                </span>`;
            }
            if (d.methodology_note) {
                metaHtml += `<span class="ins-info-trigger" onclick="insToggleMethodology(event)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    <div class="ins-info-popover" id="insMethodologyPopover">${esc(d.methodology_note)}</div>
                </span>`;
            }
            metaEl.innerHTML = metaHtml;
        }

        // Actions (theme + share)
        const actionsEl = document.getElementById('insHeaderActions');
        if (actionsEl) {
            actionsEl.innerHTML = `
                <div class="ins-menu-wrap">
                    <button class="ins-menu-btn" onclick="insToggleMenu()" title="Options">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                    <div class="ins-menu-dropdown" id="insMenuDropdown">
                        <button onclick="insToggleTheme(); insCloseMenu()">
                            ${themeIcon}
                            <span>${isDark() ? 'Light Mode' : 'Dark Mode'}</span>
                        </button>
                        <button onclick="insShareLink(); insCloseMenu()">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                            <span>Share</span>
                        </button>
                        <button onclick="insPrintDashboard(); insCloseMenu()">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                            <span>Print</span>
                        </button>
                    </div>
                </div>`;
        }

        // Show header area
        document.getElementById('insHeaderArea').style.display = 'block';

        // Build sidebar if >3 tabs
        if (tabs.length > 3) {
            buildSidebar(tabs);
        }

        let html = '';

        // Methodology Note — now shown via info icon popover in header meta

        // KPI Cards with gauge meters
        if (d.kpi_cards && d.kpi_cards.length > 0) {
            html += '<div class="ins-kpi-row">';
            d.kpi_cards.forEach((kpi, i) => {
                const accent = i % 4;
                html += `
                <div class="ins-kpi-card ins-kpi-accent-${accent}">
                    <div class="ins-kpi-label">${esc(kpi.kpi_label || '')}</div>
                    <div class="ins-kpi-gauge" id="insKpiGauge-${i}"></div>
                    ${kpi.benchmark ? `<div class="ins-kpi-insight" style="font-style:normal;opacity:0.7;">${esc(kpi.benchmark)}</div>` : ''}
                    ${kpi.insight ? `<div class="ins-kpi-insight">${esc(kpi.insight)}</div>` : ''}
                </div>`;
            });
            html += '</div>';
        }

        // Executive Summary & Key Takeaways — collapsible card
        if (d.executive_summary || d.overall_insights) {
            const hasExec = !!d.executive_summary;
            const hasKey = !!d.overall_insights;
            const headerLabel = hasExec && hasKey ? 'Executive Summary' : (hasExec ? 'Executive Summary' : 'Key Takeaways');

            html += `<div class="ins-summary-card" id="insSummaryCard">`;
            // Clickable header with chevron
            html += `<div class="ins-summary-header" onclick="insToggleSummary()">
                <span class="ins-summary-label">${headerLabel}</span>
                <svg class="ins-summary-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>`;
            // Collapsible body
            html += `<div class="ins-summary-body">`;
            // Mini-tabs (only if both sections exist)
            if (hasExec && hasKey) {
                html += `<div class="ins-mini-tabs">
                    <button class="ins-mini-tab active" onclick="event.stopPropagation(); insSwitchMiniTab(this, 'exec')">Executive Summary</button>
                    <button class="ins-mini-tab" onclick="event.stopPropagation(); insSwitchMiniTab(this, 'key')">Key Takeaways</button>
                </div>`;
            }
            // Content panels
            if (hasExec) {
                html += `<div class="ins-mini-panel active" id="insMiniExec">
                    <div class="ins-summary-text">${formatBullets(d.executive_summary)}</div>
                </div>`;
            }
            if (hasKey) {
                html += `<div class="ins-mini-panel${!hasExec ? ' active' : ''}" id="insMiniKey">
                    <div class="ins-summary-text">${formatBullets(d.overall_insights)}</div>
                </div>`;
            }
            html += `</div></div>`; // close ins-summary-body + ins-summary-card
        }

        // Tabs — sidebar handles navigation for >3 tabs, horizontal tabs for <=3
        if (tabs.length > 0) {
            if (tabs.length <= 3) {
                // ═══ HORIZONTAL TABS (<=3 tabs) ═══
                html += '<div class="ins-tabs-bar" id="insTabsBar">';
                tabs.forEach((tab, i) => {
                    const label = tab.tab_label || tab.title || `Tab ${i + 1}`;
                    const id = tab.tab_id || `tab-${i}`;
                    html += `<button class="ins-tab-btn${i === 0 ? ' active' : ''}" data-tab="${id}" onclick="insSwitchTab('${id}')">${esc(label)}</button>`;
                });
                html += '</div>';
            }

            tabs.forEach((tab, i) => {
                const id = tab.tab_id || `tab-${i}`;
                const charts = tab.charts || [];
                html += `<div class="ins-tab-panel${i === 0 ? ' active' : ''}" id="insPanel-${id}">`;

                // Tab summary — collapsible card
                if (tab.tab_summary) {
                    const tabLabel = tab.tab_label || `Section ${i + 1}`;
                    html += `<div class="ins-summary-card ins-tab-summary-card" id="insTabSummary-${id}">
                        <div class="ins-summary-header" onclick="insToggleTabSummary('${id}')">
                            <span class="ins-summary-label">${esc(tabLabel)} — Key Findings</span>
                            <svg class="ins-summary-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </div>
                        <div class="ins-summary-body">
                            <div class="ins-summary-text">${formatBullets(tab.tab_summary)}</div>
                        </div>
                    </div>`;
                }

                html += '<div class="ins-chart-grid">';
                // Pre-compute which charts are full-width to detect lone half-width at end
                const widths = charts.map(c => {
                    const isWide = ['stacked_bar', 'line', 'area', 'heatmap', 'scatter', 'bubble', 'boxPlot'].includes(c.chart_type);
                    return charts.length === 1 || isWide || c.chart_size === 'full';
                });
                // Promote unpaired half-width charts to full-width
                // Walk through and pair consecutive halves; any lone half becomes full
                for (let k = 0; k < widths.length; k++) {
                    if (!widths[k]) {
                        if (k + 1 < widths.length && !widths[k + 1]) {
                            k++; // paired — skip both
                        } else {
                            widths[k] = true; // lone half → promote to full
                        }
                    }
                }
                charts.forEach((chart, ci) => {
                    const fullWidth = widths[ci];
                    html += `
                    <div class="ins-chart-card${fullWidth ? ' full-width' : ''}">
                        <div class="ins-chart-title">${esc(chart.title || chart.question_label || '')}</div>
                        ${chart.question_id ? `<div class="ins-chart-subtitle">${esc(chart.question_id)}</div>` : ''}
                        <div class="ins-chart-area" id="insChart-${id}-${ci}"></div>
                        ${chart.insight ? `<div class="ins-chart-insight">${esc(chart.insight)}</div>` : ''}
                        ${chart.significance_notes ? `<div class="ins-chart-sig-note">${esc(chart.significance_notes)}</div>` : ''}
                    </div>`;
                });
                html += '</div></div>'; // close ins-chart-grid + ins-tab-panel
            });
        }

        // Footer
        html += `
        <div class="ins-footer">
            <div class="ins-footer-text">Powered by <a href="https://ragenaizer.com" target="_blank">Ragenaizer.com</a></div>
        </div>`;

        root.innerHTML = html;

        // Render charts after DOM is ready
        requestAnimationFrame(() => {
            renderAllCharts(tabs);
            renderKpiGauges(d.kpi_cards || []);
        });
    }

    // ═══ KPI GAUGE METERS ═══
    const KPI_ACCENT_COLORS = ['#3b82f6', '#10b981', '#a78bfa', '#22d3ee'];

    function renderKpiGauges(kpis) {
        // Destroy previous KPI gauge instances
        kpiChartInstances.forEach(c => {
            try { c.destroy(); } catch (e) { /* ignore */ }
        });
        kpiChartInstances = [];

        kpis.forEach((kpi, i) => {
            const el = document.getElementById(`insKpiGauge-${i}`);
            if (!el) return;
            el.innerHTML = ''; // clear any leftover DOM

            const rawValue = kpi.value != null ? parseFloat(kpi.value) : 0;
            const suffix = (kpi.suffix || '%').trim();
            const color = KPI_ACCENT_COLORS[i % 4];
            const trackColor = getGaugeTrackColor();
            const valueColor = getChartValueColor();

            // Determine gauge percentage (0-100) and display value
            let gaugePercent, displayValue;
            if (suffix === '/10' || suffix.toLowerCase().includes('/10')) {
                // Could be 7.4/10 (<=10) or 74.3/10 (LLM scaled it already)
                const scaledValue = rawValue <= 10 ? rawValue * 10 : rawValue;
                gaugePercent = Math.min(100, Math.max(0, scaledValue));
                displayValue = rawValue % 1 === 0 ? rawValue.toFixed(0) : rawValue.toFixed(1);
            } else if (suffix === '/5' || suffix.toLowerCase().includes('/5')) {
                const scaledValue = rawValue <= 5 ? rawValue * 20 : rawValue;
                gaugePercent = Math.min(100, Math.max(0, scaledValue));
                displayValue = rawValue % 1 === 0 ? rawValue.toFixed(0) : rawValue.toFixed(1);
            } else {
                // Percentage or raw number — treat as 0-100
                gaugePercent = Math.min(100, Math.max(0, rawValue));
                displayValue = rawValue % 1 === 0 ? rawValue.toFixed(0) : rawValue.toFixed(1);
            }

            const options = {
                chart: {
                    type: 'radialBar',
                    height: 160,
                    sparkline: { enabled: true },
                    background: 'transparent',
                    animations: { enabled: true, easing: 'easeinout', speed: 800 }
                },
                series: [gaugePercent],
                plotOptions: {
                    radialBar: {
                        startAngle: -135,
                        endAngle: 135,
                        hollow: {
                            size: '60%',
                            background: 'transparent'
                        },
                        track: {
                            background: trackColor,
                            strokeWidth: '100%',
                            margin: 0
                        },
                        dataLabels: {
                            name: { show: false },
                            value: {
                                show: true,
                                fontSize: '22px',
                                fontWeight: 700,
                                fontFamily: CHART_FONT,
                                color: valueColor,
                                offsetY: 8,
                                formatter: () => `${displayValue}${suffix}`
                            }
                        }
                    }
                },
                fill: {
                    type: 'gradient',
                    gradient: {
                        shade: 'dark',
                        type: 'horizontal',
                        shadeIntensity: 0.3,
                        gradientToColors: [color],
                        stops: [0, 100]
                    }
                },
                colors: [color],
                stroke: { lineCap: 'round' }
            };

            try {
                const chart = new ApexCharts(el, options);
                chart.render();
                kpiChartInstances.push(chart);
            } catch (e) {
                el.innerHTML = `<div style="text-align:center;padding:20px;font-size:28px;font-weight:700;color:${color}">${displayValue}${suffix}</div>`;
            }
        });
    }

    // ═══ RENDER ALL CHARTS ═══
    function renderAllCharts(tabs) {
        // Destroy previous chart instances (skip KPI gauges — they're at the start of the array)
        chartInstances.forEach(c => {
            try { c.destroy(); } catch (e) { /* ignore */ }
        });
        chartInstances = [];

        tabs.forEach((tab, i) => {
            const id = tab.tab_id || `tab-${i}`;
            (tab.charts || []).forEach((chart, ci) => {
                renderChart(`insChart-${id}-${ci}`, chart);
            });
        });
    }

    // ═══ CHART RENDERING ═══
    function renderChart(elId, chartConfig) {
        const el = document.getElementById(elId);
        if (!el) return;

        const type = chartConfig.chart_type || 'bar';
        const data = chartConfig.data || {};
        let options = null;

        try {
            switch (type) {
                case 'gauge':
                    options = buildGaugeOptions(data, chartConfig);
                    break;
                case 'pie':
                case 'donut':
                    options = buildPieOptions(data, chartConfig, type);
                    break;
                case 'bar':
                    options = buildBarOptions(data, chartConfig, true);
                    break;
                case 'column':
                    options = buildBarOptions(data, chartConfig, false);
                    break;
                case 'stacked_bar':
                    options = buildStackedBarOptions(data, chartConfig);
                    break;
                case 'line':
                    options = buildLineOptions(data, chartConfig);
                    break;
                case 'area':
                    options = buildAreaOptions(data, chartConfig);
                    break;
                case 'radar':
                    options = buildRadarOptions(data, chartConfig);
                    break;
                case 'heatmap':
                    options = buildHeatmapOptions(data, chartConfig);
                    break;
                case 'scatter':
                    options = buildScatterOptions(data, chartConfig);
                    break;
                case 'bubble':
                    options = buildBubbleOptions(data, chartConfig);
                    break;
                case 'treemap':
                    options = buildTreemapOptions(data, chartConfig);
                    break;
                case 'radialBar':
                    options = buildRadialBarOptions(data, chartConfig);
                    break;
                case 'polarArea':
                    options = buildPolarAreaOptions(data, chartConfig);
                    break;
                case 'boxPlot':
                    options = buildBoxPlotOptions(data, chartConfig);
                    break;
                default:
                    options = buildBarOptions(data, chartConfig, false);
            }

            if (options) {
                el.innerHTML = '';
                const chart = new ApexCharts(el, options);
                chart.render();
                chartInstances.push(chart);
            }
        } catch (err) {
            console.warn(`Failed to render chart ${elId}:`, err);
            el.innerHTML = '<div style="color:var(--ins-text-muted);font-size:13px;padding:40px;text-align:center;">Chart could not be rendered</div>';
        }
    }

    function baseChartOptions() {
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();

        return {
            chart: {
                background: 'transparent',
                fontFamily: CHART_FONT,
                toolbar: { show: false },
                animations: { enabled: true, easing: 'easeinout', speed: 600 }
            },
            theme: {
                mode: getTheme(),
                palette: 'palette1'
            },
            colors: CHART_COLORS,
            grid: {
                borderColor: gridColor,
                strokeDashArray: 3
            },
            tooltip: {
                theme: getTheme(),
                style: { fontSize: '12px' }
            },
            legend: {
                labels: { colors: labelColor },
                fontSize: '12px',
                fontFamily: CHART_FONT
            }
        };
    }

    // ═══ EXISTING CHART BUILDERS ═══

    function buildGaugeOptions(data, config) {
        const value = data.series ? data.series[0] : (config.value || 0);
        const label = (data.labels && data.labels[0]) || config.kpi_label || '';
        const labelColor = getChartLabelColor();
        const valueColor = getChartValueColor();
        const trackColor = getGaugeTrackColor();
        const mobile = isMobile();

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
                        value: {
                            show: true,
                            fontSize: mobile ? '26px' : '32px',
                            fontWeight: 700,
                            color: valueColor,
                            offsetY: -16,
                            formatter: (val) => `${Math.round(val)}${config.suffix || '%'}`
                        }
                    }
                }
            },
            labels: [label],
            stroke: { lineCap: 'round' }
        };
    }

    function buildPieOptions(data, config, type) {
        const series = Array.isArray(data.series) ? data.series : [];
        const labels = Array.isArray(data.labels) ? data.labels : [];
        const strokeColor = getPieStrokeColor();
        const mobile = isMobile();

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: type === 'donut' ? 'donut' : 'pie', height: chartHeight(280, 240) },
            series: series,
            labels: labels,
            plotOptions: {
                pie: {
                    donut: { size: type === 'donut' ? '55%' : '0%' },
                    expandOnClick: false
                }
            },
            legend: {
                ...baseChartOptions().legend,
                position: mobile ? 'bottom' : 'right',
                fontSize: mobile ? '11px' : '12px'
            },
            dataLabels: {
                enabled: true,
                formatter: (val) => `${val.toFixed(1)}%`,
                style: { fontSize: mobile ? '10px' : '11px', fontWeight: 500 },
                dropShadow: { enabled: false }
            },
            stroke: { width: 1, colors: [strokeColor] }
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

        // On mobile, truncate long category labels
        const maxLabelLen = mobile ? 14 : 30;
        const displayCategories = categories.map(c =>
            typeof c === 'string' && c.length > maxLabelLen ? c.substring(0, maxLabelLen) + '...' : c
        );

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'bar', height: chartHeight(280, Math.max(220, categories.length * 40)) },
            series: series,
            plotOptions: {
                bar: {
                    horizontal: horizontal,
                    borderRadius: mobile ? 3 : 4,
                    columnWidth: mobile ? '65%' : '55%',
                    barHeight: mobile ? '60%' : '55%',
                    distributed: series.length === 1 && series[0].data.length <= 8
                }
            },
            xaxis: {
                categories: displayCategories,
                labels: {
                    style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' },
                    maxWidth: mobile ? 100 : 180,
                    trim: true
                },
                axisBorder: { color: gridColor },
                axisTicks: { color: gridColor }
            },
            yaxis: {
                labels: {
                    style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' },
                    maxWidth: mobile ? 90 : 160
                }
            },
            legend: {
                ...baseChartOptions().legend,
                fontSize: mobile ? '10px' : '12px',
                position: 'bottom'
            },
            dataLabels: { enabled: false }
        };
    }

    function buildStackedBarOptions(data, config) {
        const series = Array.isArray(data.series) ? data.series : [];
        const categories = data.categories || data.labels || [];
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();

        const maxLabelLen = mobile ? 14 : 30;
        const displayCategories = categories.map(c =>
            typeof c === 'string' && c.length > maxLabelLen ? c.substring(0, maxLabelLen) + '...' : c
        );

        return {
            ...baseChartOptions(),
            chart: {
                ...baseChartOptions().chart,
                type: 'bar',
                height: chartHeight(320, Math.max(260, categories.length * 44)),
                stacked: true,
                stackType: '100%'
            },
            series: series,
            plotOptions: {
                bar: {
                    horizontal: true,
                    borderRadius: 3,
                    barHeight: mobile ? '55%' : '50%'
                }
            },
            xaxis: {
                categories: displayCategories,
                labels: {
                    style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' },
                    formatter: (val) => `${val}%`
                },
                axisBorder: { color: gridColor }
            },
            yaxis: {
                labels: {
                    style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' },
                    maxWidth: mobile ? 90 : 160
                }
            },
            legend: {
                ...baseChartOptions().legend,
                fontSize: mobile ? '10px' : '12px',
                position: 'bottom'
            },
            dataLabels: {
                enabled: !mobile,
                formatter: (val) => val > 5 ? `${val.toFixed(0)}%` : '',
                style: { fontSize: '10px', fontWeight: 500 }
            },
            fill: { opacity: 0.9 }
        };
    }

    function buildLineOptions(data, config) {
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

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'line', height: chartHeight(300, 240) },
            series: series,
            xaxis: {
                categories: categories,
                labels: {
                    style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' },
                    rotate: mobile ? -45 : 0,
                    rotateAlways: mobile && categories.length > 4
                },
                axisBorder: { color: gridColor }
            },
            yaxis: {
                labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' } }
            },
            legend: {
                ...baseChartOptions().legend,
                fontSize: mobile ? '10px' : '12px',
                position: 'bottom'
            },
            stroke: { curve: 'smooth', width: mobile ? 2 : 2.5 },
            markers: { size: mobile ? 3 : 4, strokeWidth: 0 },
            dataLabels: { enabled: false }
        };
    }

    // ═══ NEW CHART BUILDERS ═══

    function buildAreaOptions(data, config) {
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

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'area', height: chartHeight(320, 260) },
            series: series,
            stroke: { curve: 'smooth', width: 2 },
            fill: {
                type: 'gradient',
                gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] }
            },
            xaxis: {
                categories: categories,
                labels: {
                    style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' },
                    rotate: mobile ? -45 : 0,
                    rotateAlways: mobile && categories.length > 4
                },
                axisBorder: { color: gridColor }
            },
            yaxis: {
                labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' } }
            },
            legend: {
                ...baseChartOptions().legend,
                fontSize: mobile ? '10px' : '12px',
                position: 'bottom'
            },
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
            series = data.series;
            categories = data.categories || data.labels || [];
        } else {
            series = [{ name: config.title || 'Value', data: data.series || [] }];
            categories = data.labels || data.categories || [];
        }

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'radar', height: chartHeight(380, 300) },
            series: series.map(s => ({ name: s.name, data: s.data })),
            xaxis: {
                categories: categories,
                labels: {
                    style: {
                        fontSize: mobile ? '9px' : '10px',
                        colors: Array(categories.length).fill(labelColor)
                    }
                }
            },
            yaxis: { show: false },
            stroke: { width: 2 },
            fill: { opacity: 0.15 },
            markers: { size: mobile ? 3 : 4, strokeWidth: 0, hover: { size: 6 } },
            plotOptions: {
                radar: {
                    polygons: {
                        strokeColors: polygonColor,
                        connectorColors: polygonColor,
                        fill: { colors: ['transparent'] }
                    }
                }
            },
            legend: {
                ...baseChartOptions().legend,
                fontSize: mobile ? '10px' : '12px',
                position: 'bottom'
            }
        };
    }

    function buildHeatmapOptions(data, config) {
        const series = Array.isArray(data.series) ? data.series : [];
        const categories = data.categories || data.labels || [];
        const mobile = isMobile();

        // Build heatmap series with {x, y} format
        const hmSeries = series.map(s => ({
            name: s.name,
            data: (s.data || []).map((v, i) => ({
                x: categories[i] || `Col ${i + 1}`,
                y: typeof v === 'number' ? v : 0
            }))
        }));

        // 5-range color scale for correlations (-1 to 1) or general use
        const colorRanges = [
            { from: -Infinity, to: -0.5, color: '#ef4444', name: 'Strong Negative' },
            { from: -0.5, to: -0.1, color: '#f59e0b', name: 'Weak Negative' },
            { from: -0.1, to: 0.1, color: '#94a3b8', name: 'Negligible' },
            { from: 0.1, to: 0.5, color: '#06b6d4', name: 'Weak Positive' },
            { from: 0.5, to: Infinity, color: '#10b981', name: 'Strong Positive' }
        ];

        return {
            ...baseChartOptions(),
            chart: {
                ...baseChartOptions().chart,
                type: 'heatmap',
                height: chartHeight(Math.max(300, series.length * 40), Math.max(260, series.length * 36))
            },
            series: hmSeries,
            plotOptions: {
                heatmap: {
                    radius: 2,
                    enableShades: false,
                    colorScale: { ranges: colorRanges }
                }
            },
            dataLabels: {
                enabled: true,
                style: { fontSize: mobile ? '9px' : '10px', colors: ['#fff'] }
            },
            stroke: { width: 1, colors: [isDark() ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.1)'] },
            legend: { show: false },
            xaxis: {
                labels: {
                    style: { fontSize: mobile ? '9px' : '10px', colors: getChartLabelColor() },
                    rotate: categories.length > 6 ? -45 : 0,
                    rotateAlways: categories.length > 6
                }
            }
        };
    }

    function buildScatterOptions(data, config) {
        const points = data.points || [];
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();

        const scSeries = points.map(s => ({
            name: s.name,
            data: (s.data || []).map(p => ({
                x: p.x,
                y: p.y,
                meta: p.label || ''
            }))
        }));
        const scColors = points.map((s, i) => s.color || CHART_COLORS[i % CHART_COLORS.length]);

        // Annotation lines (mean lines for importance-performance charts)
        const ann = data.annotations || {};
        const annOpts = { xaxis: [], yaxis: [] };
        const annLabelStyle = {
            color: isDark() ? '#fff' : '#000',
            background: isDark() ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)',
            fontSize: '10px',
            padding: { left: 4, right: 4, top: 2, bottom: 2 }
        };
        const annBorderColor = isDark() ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';

        if (ann.x_line != null) {
            annOpts.xaxis.push({
                x: ann.x_line, strokeDashArray: 4, borderColor: annBorderColor,
                label: { text: 'Mean', style: annLabelStyle, position: 'top' }
            });
        }
        if (ann.y_line != null) {
            annOpts.yaxis.push({
                y: ann.y_line, strokeDashArray: 4, borderColor: annBorderColor,
                label: { text: 'Mean', style: annLabelStyle, position: 'left' }
            });
        }

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'scatter', height: chartHeight(380, 300), zoom: { enabled: false } },
            series: scSeries,
            colors: scColors,
            markers: { size: mobile ? 6 : 8, strokeWidth: 1, strokeColors: 'rgba(0,0,0,0.3)', hover: { size: mobile ? 9 : 11 } },
            xaxis: {
                type: 'numeric',
                title: data.x_label ? { text: data.x_label, style: { color: labelColor, fontSize: '11px' } } : undefined,
                labels: { formatter: v => Number(v).toFixed(1), style: { fontSize: '10px', colors: labelColor } },
                tickAmount: 6
            },
            yaxis: {
                title: data.y_label ? { text: data.y_label, style: { color: labelColor, fontSize: '11px' } } : undefined,
                labels: { formatter: v => Number(v).toFixed(1), style: { fontSize: '10px', colors: labelColor } }
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
                    return `<div style="padding:8px 12px;font-size:12px;background:${bg};color:${fg};border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.2);"><strong>${esc(pt.meta || sn)}</strong><br>${data.x_label || 'X'}: ${Number(pt.x).toFixed(2)}<br>${data.y_label || 'Y'}: ${Number(pt.y).toFixed(2)}</div>`;
                }
            },
            legend: {
                ...baseChartOptions().legend,
                position: 'bottom'
            }
        };
    }

    function buildBubbleOptions(data, config) {
        const points = data.points || [];
        const labelColor = getChartLabelColor();
        const mobile = isMobile();

        const bSeries = points.map(s => ({
            name: s.name,
            data: (s.data || []).map(p => [p.x, p.y, p.z || 10])
        }));
        const bColors = points.map((s, i) => s.color || CHART_COLORS[i % CHART_COLORS.length]);

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'bubble', height: chartHeight(380, 300), zoom: { enabled: false } },
            series: bSeries,
            colors: bColors.length ? bColors : CHART_COLORS,
            fill: { opacity: 0.7 },
            xaxis: {
                type: 'numeric',
                title: data.x_label ? { text: data.x_label, style: { color: labelColor, fontSize: '11px' } } : undefined,
                labels: { style: { fontSize: '10px', colors: labelColor } },
                tickAmount: 6
            },
            yaxis: {
                title: data.y_label ? { text: data.y_label, style: { color: labelColor, fontSize: '11px' } } : undefined,
                labels: { style: { fontSize: '10px', colors: labelColor } }
            },
            legend: {
                ...baseChartOptions().legend,
                position: 'bottom'
            }
        };
    }

    function buildTreemapOptions(data, config) {
        const points = data.points || [];
        const mobile = isMobile();

        // Build treemap series from points or fallback to series/labels
        let tmSeries;
        if (points.length > 0) {
            tmSeries = points.map(s => ({
                name: s.name,
                data: (s.data || []).map(p => ({ x: p.label || p.x, y: p.y }))
            }));
        } else if (Array.isArray(data.series) && Array.isArray(data.labels)) {
            // Fallback: flat series + labels
            tmSeries = [{
                data: data.labels.map((label, i) => ({
                    x: label,
                    y: data.series[i] || 0
                }))
            }];
        } else {
            tmSeries = [];
        }

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'treemap', height: chartHeight(340, 280) },
            series: tmSeries,
            plotOptions: {
                treemap: {
                    enableShades: true,
                    shadeIntensity: 0.3,
                    distributed: tmSeries.length <= 1
                }
            },
            dataLabels: {
                enabled: true,
                style: { fontSize: mobile ? '10px' : '11px' },
                formatter: (text, op) => [text, op.value != null ? Math.round(op.value) + '%' : ''],
                offsetY: -2
            },
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

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'radialBar', height: chartHeight(340, 280) },
            series: series,
            labels: labels,
            plotOptions: {
                radialBar: {
                    hollow: { size: labels.length > 3 ? '30%' : '45%' },
                    track: { background: trackColor, strokeWidth: '100%' },
                    dataLabels: {
                        name: { fontSize: mobile ? '10px' : '12px', color: labelColor, offsetY: -10 },
                        value: {
                            fontSize: mobile ? '16px' : '18px',
                            fontWeight: 600,
                            color: valueColor,
                            formatter: v => Math.round(v) + '%'
                        },
                        total: {
                            show: labels.length > 1,
                            label: 'Average',
                            fontSize: '11px',
                            color: labelColor,
                            formatter: w => Math.round(w.globals.series.reduce((a, b) => a + b, 0) / w.globals.series.length) + '%'
                        }
                    }
                }
            },
            stroke: { lineCap: 'round' }
        };
    }

    function buildPolarAreaOptions(data, config) {
        const series = Array.isArray(data.series) ? data.series.map(v => Math.min(100, Math.max(0, v))) : [];
        const labels = Array.isArray(data.labels) ? data.labels : [];
        const strokeColor = getPieStrokeColor();
        const polygonColor = isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const mobile = isMobile();

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'polarArea', height: chartHeight(340, 280) },
            series: series,
            labels: labels,
            fill: { opacity: 0.8 },
            stroke: { width: 1, colors: [strokeColor] },
            plotOptions: {
                polarArea: {
                    rings: { strokeWidth: 1, strokeColor: polygonColor },
                    spokes: { strokeWidth: 1, connectorColors: polygonColor }
                }
            },
            yaxis: { show: false },
            legend: {
                ...baseChartOptions().legend,
                position: mobile ? 'bottom' : 'right',
                fontSize: mobile ? '10px' : '12px'
            },
            dataLabels: {
                enabled: true,
                formatter: v => Math.round(v) + '%',
                style: { fontSize: mobile ? '9px' : '10px' },
                dropShadow: { enabled: false }
            }
        };
    }

    function buildBoxPlotOptions(data, config) {
        const series = Array.isArray(data.series) ? data.series : [];
        const categories = data.categories || data.labels || [];
        const labelColor = getChartLabelColor();
        const gridColor = getChartGridColor();
        const mobile = isMobile();

        const bpSeries = series.map(s => ({
            name: s.name || 'Distribution',
            type: 'boxPlot',
            data: (s.data || []).map((d, i) => ({
                x: categories[i] || `Group ${i + 1}`,
                y: Array.isArray(d) ? d : [d, d, d, d, d]
            }))
        }));

        return {
            ...baseChartOptions(),
            chart: { ...baseChartOptions().chart, type: 'boxPlot', height: chartHeight(340, 280) },
            series: bpSeries,
            plotOptions: {
                boxPlot: {
                    colors: {
                        upper: isDark() ? '#3b82f6' : '#2563eb',
                        lower: isDark() ? '#10b981' : '#059669'
                    }
                }
            },
            xaxis: {
                labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' } }
            },
            yaxis: {
                labels: { style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' } }
            },
            grid: { borderColor: gridColor, strokeDashArray: 3 },
            legend: {
                ...baseChartOptions().legend,
                position: 'bottom'
            }
        };
    }

    // ═══ HELPERS ═══
    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /** Format text with bullet points. Splits on • or \n• and renders as styled list. */
    function formatBullets(str) {
        if (!str) return '';
        const escaped = esc(str);
        // Split on bullet character (with optional newline before it)
        const parts = escaped.split(/\n?•\s*/);
        // If no bullets found, just return escaped text
        if (parts.length <= 1) return `<p>${escaped}</p>`;
        const bullets = parts.filter(p => p.trim());
        return '<ul class="ins-bullet-list">' +
            bullets.map(b => {
                // Check for bold header like "KEY OPPORTUNITY:" or "NEXT STEPS:"
                const headerMatch = b.match(/^([A-Z][A-Z\s\/&]+):\s*(.*)/s);
                if (headerMatch) {
                    return `<li><strong>${headerMatch[1]}:</strong> ${headerMatch[2]}</li>`;
                }
                return `<li>${b}</li>`;
            }).join('') +
            '</ul>';
    }

    // ═══ GLOBAL FUNCTIONS ═══
    window.insToggleSummary = function () {
        const card = document.getElementById('insSummaryCard');
        if (card) card.classList.toggle('collapsed');
    };

    window.insToggleTabSummary = function (tabId) {
        const card = document.getElementById(`insTabSummary-${tabId}`);
        if (card) card.classList.toggle('collapsed');
    };

    window.insToggleMethodology = function (e) {
        e.stopPropagation();
        const popover = document.getElementById('insMethodologyPopover');
        if (!popover) return;
        const isVisible = popover.classList.toggle('visible');
        // On mobile, position fixed below the trigger icon
        if (isVisible && window.innerWidth <= 600) {
            const trigger = e.currentTarget || e.target.closest('.ins-info-trigger');
            if (trigger) {
                const r = trigger.getBoundingClientRect();
                popover.style.top = Math.min(r.bottom + 8, window.innerHeight - popover.offsetHeight - 16) + 'px';
            }
        }
    };

    // Close methodology popover when clicking outside
    document.addEventListener('click', function (e) {
        const popover = document.getElementById('insMethodologyPopover');
        if (popover && popover.classList.contains('visible') && !e.target.closest('.ins-info-trigger')) {
            popover.classList.remove('visible');
        }
    });

    window.insSwitchMiniTab = function (btn, panel) {
        btn.parentElement.querySelectorAll('.ins-mini-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const card = btn.closest('.ins-summary-card');
        card.querySelectorAll('.ins-mini-panel').forEach(p => p.classList.remove('active'));
        card.querySelector(`#insMini${panel === 'exec' ? 'Exec' : 'Key'}`).classList.add('active');
    };

    window.insSwitchTab = function (tabId) {
        // Handle both horizontal tabs and sidebar buttons
        document.querySelectorAll('.ins-tab-btn, .sidebar-btn[data-tab]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        document.querySelectorAll('.ins-tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `insPanel-${tabId}`);
        });

        // Update the header row active tab name (same as project-detail pattern)
        const activeBtn = document.querySelector(`.sidebar-btn[data-tab="${tabId}"]`);
        const headerTabName = document.getElementById('activeTabName');
        if (activeBtn && headerTabName) {
            headerTabName.textContent = activeBtn.querySelector('.nav-label')?.textContent || activeBtn.textContent.trim();
        }

        // On mobile, close sidebar after selecting tab. On desktop, keep it pinned.
        if (window.innerWidth <= 900) {
            insCloseSidebar();
        }
    };

    // ═══ SIDEBAR (uses sidebar-nav.css — same pattern as project-detail) ═══
    function buildSidebar(tabs) {
        // Remove existing sidebar if present
        const existing = document.getElementById('insSidebar');
        if (existing) existing.remove();

        const sidebar = document.createElement('aside');
        sidebar.className = 'sidebar-nav-panel';
        sidebar.id = 'insSidebar';

        let sidebarHtml = `
            <div class="sidebar-header"><h3>Sections</h3></div>
            <nav class="sidebar-nav">
                <div class="nav-group-items">`;

        tabs.forEach((tab, i) => {
            const label = tab.tab_label || tab.title || `Tab ${i + 1}`;
            const id = tab.tab_id || `tab-${i}`;
            sidebarHtml += `<button class="sidebar-btn${i === 0 ? ' active' : ''}" data-tab="${id}" onclick="insSwitchTab('${id}')">
                <span class="nav-number">${i + 1}</span>
                <span class="nav-label">${esc(label)}</span>
            </button>`;
        });

        sidebarHtml += '</div></nav>';
        sidebar.innerHTML = sidebarHtml;

        // Insert sidebar inside the container (same as project-detail) after the overlay
        const container = document.getElementById('insightsRoot');
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay && overlay.parentNode === container) {
            overlay.after(sidebar);
        } else {
            container.insertBefore(sidebar, container.firstChild);
        }

        // Setup overlay click
        if (overlay) {
            overlay.addEventListener('click', function () {
                insCloseSidebar();
            });
        }

        // Auto-open sidebar on desktop
        if (window.innerWidth > 900) {
            requestAnimationFrame(() => {
                sidebar.classList.add('open');
                if (container) container.classList.add('sidebar-open');
                const toggle = document.getElementById('insSidebarToggle');
                if (toggle) toggle.classList.add('active');
            });
        }
    }

    window.insToggleSidebar = function () {
        const sidebar = document.getElementById('insSidebar');
        const container = document.getElementById('insightsRoot');
        const toggle = document.getElementById('insSidebarToggle');
        const overlay = document.getElementById('sidebarOverlay');
        const isDesktop = window.innerWidth > 900;

        if (!sidebar) return;

        if (sidebar.classList.contains('open')) {
            // Close
            sidebar.classList.remove('open');
            if (container) container.classList.remove('sidebar-open');
            if (toggle) toggle.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
            document.body.style.overflow = '';
        } else {
            // Open
            sidebar.classList.add('open');
            if (isDesktop) {
                if (container) container.classList.add('sidebar-open');
            } else {
                if (overlay) overlay.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
            if (toggle) toggle.classList.add('active');
        }
        // After sidebar CSS transition (300ms), trigger resize so ApexCharts reflows
        setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
    };

    function insCloseSidebar() {
        const sidebar = document.getElementById('insSidebar');
        const container = document.getElementById('insightsRoot');
        const toggle = document.getElementById('insSidebarToggle');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (container) container.classList.remove('sidebar-open');
        if (toggle) toggle.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    window.insShareLink = function () {
        const btn = document.querySelector('.ins-menu-btn');
        if (!btn) return;

        const projectName = dashboardData?.project_name || 'Insights Dashboard';
        const sampleSize = dashboardData?.sample_size ? `N=${Number(dashboardData.sample_size).toLocaleString()}` : '';
        const description = dashboardData?.executive_summary
            ? dashboardData.executive_summary.substring(0, 160) + '...'
            : `Interactive insights dashboard${sampleSize ? ' (' + sampleSize + ')' : ''} powered by Ragenaizer Research.`;
        const url = window.location.href;

        if (typeof ShareWidget !== 'undefined') {
            const title = projectName + ' — Insights';
            const ogImage = window.location.origin + '/assets/og-insights.png';
            ShareWidget.openAt(btn, {
                url, title, description, ogImage,
                btnText: 'View Insights →',
                items: [
                    { icon: ShareWidget.ICONS.link, label: 'Copy Link', action: () => {
                        navigator.clipboard.writeText(url).then(() => ShareWidget.showToast('Link copied!')).catch(() => ShareWidget.showToast('Could not copy'));
                        ShareWidget.closePopover();
                    }},
                    { icon: ShareWidget.ICONS.mail, label: 'Email Card', action: () => {
                        const html = ShareWidget.buildEmailCard({ url, title, description, ogImage, btnText: 'View Insights →' });
                        navigator.clipboard.write([
                            new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([html], { type: 'text/plain' }) })
                        ]).then(() => ShareWidget.showToast('Email card copied — paste into Outlook or Gmail!'));
                        ShareWidget.closePopover();
                    }}
                ]
            });
        } else {
            navigator.clipboard.writeText(url).then(() => {
                showToast('Share link copied to clipboard');
            }).catch(() => {
                showToast('Copy this URL to share the dashboard');
            });
        }
    };

    window.insToggleMenu = function () {
        const dd = document.getElementById('insMenuDropdown');
        if (dd) dd.classList.toggle('open');
    };

    window.insCloseMenu = function () {
        const dd = document.getElementById('insMenuDropdown');
        if (dd) dd.classList.remove('open');
    };

    // Close menu on outside click
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.ins-menu-wrap')) {
            insCloseMenu();
        }
    });

    window.insPrintDashboard = function () {
        // Show all tab panels so ApexCharts can render into visible containers
        const panels = document.querySelectorAll('.ins-tab-panel');
        panels.forEach(p => p.style.display = 'block');

        // Re-render all charts now that all containers are visible
        if (dashboardData) {
            const tabs = dashboardData.tabs || dashboardData.sections || [];
            renderAllCharts(tabs);
            renderKpiGauges(dashboardData.kpi_cards || []);
        }

        // Wait for ApexCharts to finish rendering, then print
        setTimeout(() => {
            window.print();
            // Restore tab visibility after print
            panels.forEach(p => p.style.display = '');
        }, 600);
    };

    window.insToggleTheme = function () {
        const current = getTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('ins-theme', next);

        // Update theme label in dropdown menu
        const themeItem = document.querySelector('.ins-menu-dropdown button:first-child');
        if (themeItem) {
            const icon = next === 'dark'
                ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
                : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
            themeItem.innerHTML = `${icon}<span>${next === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>`;
        }

        // Re-render all charts with new theme colors
        if (dashboardData) {
            const tabs = dashboardData.tabs || dashboardData.sections || [];
            requestAnimationFrame(() => {
                renderAllCharts(tabs);
                renderKpiGauges(dashboardData.kpi_cards || []);
            });
        }
    };
})();
