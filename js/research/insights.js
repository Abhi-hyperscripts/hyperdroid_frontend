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
    // Each entry: { instance: ApexCharts, tabId: string, idx: number, config: object }
    let chartInstances = [];
    let kpiChartInstances = [];
    let dashboardData = null;
    let selectedCharts = new Set(); // For multi-chart download

    // ═══ FORMAT SETTINGS (localStorage-backed) ═══
    const FORMAT_DEFAULTS = { decimals: 1, showPercent: true, meansDecimals: 2 };

    function getFormatSettings() {
        try {
            const saved = localStorage.getItem('ins-format-settings');
            return saved ? { ...FORMAT_DEFAULTS, ...JSON.parse(saved) } : { ...FORMAT_DEFAULTS };
        } catch { return { ...FORMAT_DEFAULTS }; }
    }

    function saveFormatSettings(s) {
        localStorage.setItem('ins-format-settings', JSON.stringify(s));
    }

    /** Format a percentage value according to user settings */
    function fmtPct(val) {
        if (val == null || isNaN(val)) return '';
        const s = getFormatSettings();
        const num = Number(val);
        const formatted = s.decimals === 0 ? Math.round(num).toString() : num.toFixed(s.decimals);
        return s.showPercent ? formatted + '%' : formatted;
    }

    /** Format a raw percentage number (no suffix) */
    function fmtPctNum(val) {
        if (val == null || isNaN(val)) return '';
        const s = getFormatSettings();
        return s.decimals === 0 ? Math.round(Number(val)).toString() : Number(val).toFixed(s.decimals);
    }

    /** Format a mean/median/score value — always 2 decimal places */
    function fmtMean(val) {
        if (val == null || isNaN(val)) return '';
        const s = getFormatSettings();
        return Number(val).toFixed(s.meansDecimals);
    }

    /** Smart formatter — detects if value is a stat/mean or percentage */
    function fmtVal(val, config) {
        if (val == null || isNaN(val)) return String(val);
        const title = (config?.title || '').toLowerCase();
        const statsKeywords = ['mean', 'median', 'index', 'score', 'coefficient', 'correlation', 'count', 'average', 'ratio'];
        if (statsKeywords.some(k => title.includes(k))) return fmtMean(val);
        return fmtPctNum(val);
    }


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

    /**
     * Determine the suffix for data labels.
     * Uses explicit data.suffix if present; otherwise if all values
     * are in 0-100 range, treats them as percentages.
     * Skips % for titles containing stats keywords (mean, median, index, score, coefficient, correlation).
     */
    function detectValueSuffix(data, config) {
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
    const isEmbed = params.get('embed') === 'true';

    // Embed mode: strip padding/chrome for seamless iframe embedding
    if (isEmbed) {
        document.body.classList.add('ins-embed-mode');
    }

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
        script.src = `${widgetBase}/embed/widget.js?v=${Date.now()}`;
        script.setAttribute('data-key', embedKey);
        script.setAttribute('data-api', apiBase);
        script.setAttribute('data-share-token', token);
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
                        <button onclick="insOpenFormatSettings(); insCloseMenu()">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                            <span>Format Settings</span>
                        </button>
                        <button onclick="insToggleSelectMode(); insCloseMenu()">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            <span>Download Charts</span>
                        </button>
                        <button onclick="insDownloadPPT(); insCloseMenu()">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                            <span>Download PPT</span>
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

        // Overview section — KPI cards + Executive Summary, collapsible
        const hasKpis = d.kpi_cards && d.kpi_cards.length > 0;
        const hasExec = !!d.executive_summary;
        const keyTakeaways = d.key_takeaways || d.overall_insights;
        const hasKey = !!(keyTakeaways && (Array.isArray(keyTakeaways) ? keyTakeaways.length : keyTakeaways));
        if (hasKpis || hasExec || hasKey) {
            html += `<div class="ins-overview-section" id="insOverviewSection">`;
            html += `<div class="ins-overview-header" onclick="insToggleOverview()">
                <svg class="ins-summary-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                <span class="ins-summary-label">Overview</span>
            </div>`;
            html += `<div class="ins-overview-body">`;

            // KPI Cards
            if (hasKpis) {
                html += '<div class="ins-kpi-row">';
                d.kpi_cards.forEach((kpi, i) => {
                    const accent = i % 4;
                    const kpiSourceCite = kpi.source_id ? renderSourceCitation(kpi.source_id, `insKpiSrc-${i}`) : '';
                    html += `
                    <div class="ins-kpi-card ins-kpi-accent-${accent}">
                        <div class="ins-kpi-label">${esc(kpi.kpi_label || '')}${kpiSourceCite}</div>
                        <div class="ins-kpi-gauge" id="insKpiGauge-${i}"></div>
                        ${kpi.benchmark ? `<div class="ins-kpi-insight" style="font-style:normal;opacity:0.7;">${esc(kpi.benchmark)}</div>` : ''}
                        ${kpi.insight ? `<div class="ins-kpi-insight">${esc(kpi.insight)}</div>` : ''}
                    </div>`;
                });
                html += '</div>';
            }

            // Executive Summary & Key Takeaways
            if (hasExec || hasKey) {
                const headerLabel = hasExec ? 'Executive Summary' : 'Key Takeaways';
                html += `<div class="ins-summary-card" id="insSummaryCard">`;
                html += `<div class="ins-summary-header" onclick="insToggleSummary()">
                    <span class="ins-summary-label">${headerLabel}</span>
                    <svg class="ins-summary-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>`;
                html += `<div class="ins-summary-body">`;
                if (hasExec && hasKey) {
                    html += `<div class="ins-mini-tabs">
                        <button class="ins-mini-tab active" onclick="event.stopPropagation(); insSwitchMiniTab(this, 'exec')">Executive Summary</button>
                        <button class="ins-mini-tab" onclick="event.stopPropagation(); insSwitchMiniTab(this, 'key')">Key Takeaways</button>
                    </div>`;
                }
                if (hasExec) {
                    html += `<div class="ins-mini-panel active" id="insMiniExec">
                        <div class="ins-summary-text">${formatBullets(d.executive_summary)}</div>
                    </div>`;
                }
                if (hasKey) {
                    html += `<div class="ins-mini-panel${!hasExec ? ' active' : ''}" id="insMiniKey">
                        <div class="ins-summary-text">${formatBullets(keyTakeaways)}</div>
                    </div>`;
                }
                html += `</div></div>`; // close ins-summary-body + ins-summary-card
            }

            html += `</div></div>`; // close ins-overview-body + ins-overview-section
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
                    const chartSegNames = getChartSegmentNames(chart);
                    const matchingProfiles = [];
                    if (dashboardData.segment_profiles) {
                        for (const name of Object.keys(dashboardData.segment_profiles)) {
                            if (chartSegNames.has(name)) matchingProfiles.push(name);
                        }
                    }
                    const chartBase = chart.data?.base ?? chart.data?.n ?? chart.base ?? null;
                    const displayBase = chartBase != null ? chartBase : (d.sample_size || null);
                    html += `
                    <div class="ins-chart-card${fullWidth ? ' full-width' : ''}" data-chart-tab="${id}" data-chart-idx="${ci}">
                        <div class="ins-chart-select-wrap" style="display:none">
                            <label class="ins-chart-checkbox">
                                <input type="checkbox" onchange="insToggleChartSelect('${id}',${ci},this.checked)">
                                <span class="ins-chart-checkbox-mark"></span>
                            </label>
                        </div>
                        <div class="ins-chart-header-row">
                            <div class="ins-chart-title-wrap">
                                <div class="ins-chart-title">${chart.question_id ? `<span class="ins-qid-icon" data-qid="${esc(chart.question_id)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><span class="ins-qid-tooltip">${esc(chart.question_id)}</span></span>` : ''}${esc(chart.title || chart.question_label || '')}</div>
                                ${displayBase != null ? `<span class="ins-chart-base" title="Sample size for this chart">N=${Number(displayBase).toLocaleString()}</span>` : ''}
                            </div>
                            ${chart.data?.source_ids ? renderMultiSourceCitation(chart.data.source_ids, `insChartSrc-${id}-${ci}`) : ''}
                            ${matchingProfiles.length > 0 ? `
                            <button class="ins-segment-badge"
                                    data-segments='${JSON.stringify(matchingProfiles).replace(/'/g, "&#39;")}'
                                    onclick="insToggleSegmentDropdown(event, '${id}', ${ci})"
                                    title="Explore segment profiles">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                Segments
                            </button>` : ''}
                            <div class="ins-chart-actions">
                                <button class="ins-chart-action-btn" onclick="insToggleDataTable('${id}',${ci})" title="View data table">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                                </button>
                                <button class="ins-chart-action-btn" onclick="insOpenFullscreen('${id}',${ci})" title="Expand chart">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                                </button>
                            </div>
                        </div>
                        <div class="ins-chart-area" id="insChart-${id}-${ci}"></div>
                        <div class="ins-data-table-wrap" id="insTable-${id}-${ci}" style="display:none"></div>
                        ${chart.significance_markers?.length ? `<div class="ins-sig-legend">
                            <span class="ins-sig-high">▲ Significantly higher</span>
                            <span class="ins-sig-low">▼ Significantly lower</span>
                            <span class="ins-sig-ci">95% confidence</span>
                        </div>` : ''}
                        ${chart.insight ? `<div class="ins-chart-insight">${esc(chart.insight)}</div>` : ''}
                        ${chart.significance_notes ? `<div class="ins-chart-sig-note">${esc(chart.significance_notes)}</div>` : ''}
                    </div>`;
                });
                html += '</div></div>'; // close ins-chart-grid + ins-tab-panel
            });
        }

        // Secondary Research section (rendered as a proper tab panel)
        if (d.secondary_research && d.secondary_research.items && d.secondary_research.items.length > 0) {
            const sr = d.secondary_research;
            html += `<div class="ins-tab-panel" id="insPanel-secondary-research"><div class="ins-secondary-research" id="insSecondaryResearch">
                <div class="ins-sr-header">
                    <div class="ins-sr-title-row">
                        <svg class="ins-sr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                        </svg>
                        <h2 class="ins-sr-title">${esc(sr.section_title || 'Secondary Research — Market Context')}</h2>
                    </div>
                    ${sr.methodology_note ? `<div class="ins-sr-methodology">${esc(sr.methodology_note)}</div>` : ''}
                </div>
                <div class="ins-sr-items">`;

            sr.items.forEach((item, idx) => {
                const typeIcons = {
                    benchmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>',
                    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
                    competitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
                };
                const typeLabels = { benchmark: 'Industry Benchmark', trend: 'Market Trend', competitor: 'Competitor Context' };
                const icon = typeIcons[item.type] || typeIcons.benchmark;
                const typeLabel = typeLabels[item.type] || item.type || 'Research';

                html += `<div class="ins-sr-item">
                    <div class="ins-sr-item-header">
                        <span class="ins-sr-type-badge ins-sr-type-${item.type || 'benchmark'}">
                            ${icon}
                            ${esc(typeLabel)}
                        </span>
                        <h3 class="ins-sr-item-title">${esc(item.title || '')}</h3>
                    </div>
                    <div class="ins-sr-item-finding">${esc(item.finding || '')}</div>
                    ${item.chart ? `<div class="ins-sr-chart" id="insSrChart-${idx}"></div>` : ''}
                    ${item.sources && item.sources.length > 0 ? `
                        <div class="ins-sr-sources">
                            ${item.sources.map(s => `<a href="${esc(s.url || '#')}" target="_blank" rel="noopener noreferrer" class="ins-sr-source">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                ${esc(s.title || s.url || 'Source')}
                            </a>`).join('')}
                        </div>` : ''}
                </div>`;
            });

            html += '</div></div></div>'; // close ins-sr-items + ins-secondary-research + ins-tab-panel
        }

        // Sources & References panel (secondary research only)
        if (d.research_type === 'secondary' && Array.isArray(d.sources) && d.sources.length > 0) {
            const tierLabels = { 1: 'Government & Academic', 2: 'Major Research Firms', 3: 'Reputable Media', 4: 'Industry & Corporate' };
            const tierColors = { 1: '#10b981', 2: '#3b82f6', 3: '#a855f7', 4: '#f59e0b' };
            // Group sources by tier
            const byTier = {};
            d.sources.forEach(s => {
                const t = s.tier || 4;
                if (!byTier[t]) byTier[t] = [];
                byTier[t].push(s);
            });
            html += `<div class="ins-sources-panel">
                <div class="ins-sources-header" onclick="this.parentElement.classList.toggle('ins-sources-expanded')" style="cursor:pointer;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                    <h2>Sources & References</h2>
                    <span class="ins-sources-count">${d.sources.length} sources cited</span>
                    <svg class="ins-sources-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <div class="ins-sources-tiers">`;
            [1, 2, 3, 4].forEach(tier => {
                if (!byTier[tier] || !byTier[tier].length) return;
                html += `<div class="ins-sources-tier-group">
                    <div class="ins-sources-tier-label">
                        <span class="ins-tier-badge" style="background:${tierColors[tier]}20;color:${tierColors[tier]};border:1px solid ${tierColors[tier]}40;">Tier ${tier}</span>
                        <span class="ins-tier-desc">${esc(tierLabels[tier] || '')}</span>
                    </div>
                    <div class="ins-sources-list">`;
                byTier[tier].forEach(s => {
                    html += `<a href="${esc(s.url || '#')}" target="_blank" rel="noopener nofollow" class="ins-source-item">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        <span>${esc(s.title || s.domain || s.url || 'Source')}</span>
                        ${s.accessed_at ? `<span class="ins-source-date">${esc(s.accessed_at)}</span>` : ''}
                    </a>`;
                });
                html += `</div></div>`;
            });
            html += `</div></div>`;
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
            renderSecondaryResearchCharts(d.secondary_research);
            initScrollAnimations();
            initStickyHeader(tabs);
            // Trigger resize so ApexCharts reflows to container width
            setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
            // Force-render charts in hidden tabs (width=0) so they print correctly
            setTimeout(() => {
                const insts = window.__insChartInstances;
                if (!insts || !insts.length) return;
                const hiddenPanels = [];
                document.querySelectorAll('.ins-tab-panel').forEach(p => {
                    if (getComputedStyle(p).display === 'none') {
                        hiddenPanels.push(p);
                        p.style.display = 'block';
                    }
                });
                insts.forEach(ci => {
                    const el = ci.instance.el;
                    const svg = el?.querySelector('svg');
                    if (svg && parseFloat(svg.getAttribute('width')) === 0) {
                        const w = el.offsetWidth || el.parentElement?.offsetWidth || 700;
                        ci.instance.updateOptions({ chart: { width: w } }, false, false);
                    }
                });
                hiddenPanels.forEach(p => { p.style.display = ''; });
            }, 300);
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
                const scaledValue = rawValue <= 10 ? rawValue * 10 : rawValue;
                gaugePercent = Math.min(100, Math.max(0, scaledValue));
                displayValue = fmtMean(rawValue);
            } else if (suffix === '/5' || suffix.toLowerCase().includes('/5')) {
                const scaledValue = rawValue <= 5 ? rawValue * 20 : rawValue;
                gaugePercent = Math.min(100, Math.max(0, scaledValue));
                displayValue = fmtMean(rawValue);
            } else {
                // Percentage or raw number — treat as 0-100
                gaugePercent = Math.min(100, Math.max(0, rawValue));
                displayValue = fmtPctNum(rawValue);
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
                            name: {
                                show: suffix !== '%',
                                fontSize: '13px',
                                fontWeight: 500,
                                fontFamily: CHART_FONT,
                                color: valueColor,
                                offsetY: 24
                            },
                            value: {
                                show: true,
                                fontSize: '22px',
                                fontWeight: 700,
                                fontFamily: CHART_FONT,
                                color: valueColor,
                                offsetY: suffix !== '%' ? -4 : 8,
                                formatter: () => {
                                    if (suffix === '%') return fmtPct(rawValue);
                                    return displayValue;
                                }
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
                labels: [suffix !== '%' ? suffix : ''],
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

    // ═══ RENDER SECONDARY RESEARCH CHARTS ═══
    function renderSecondaryResearchCharts(sr) {
        if (!sr || !sr.items || !sr.items.length) return;

        sr.items.forEach((item, idx) => {
            if (!item.chart) return;
            const elId = `insSrChart-${idx}`;
            const el = document.getElementById(elId);
            if (!el) return;

            const chart = item.chart;
            const data = chart.data || {};
            const type = chart.chart_type || 'column';
            let options = null;

            try {
                switch (type) {
                    case 'pie':
                    case 'donut':
                        options = buildPieOptions(data, chart, type);
                        break;
                    case 'bar':
                        options = buildBarOptions(data, chart, true);
                        break;
                    case 'column':
                        options = buildBarOptions(data, chart, false);
                        break;
                    case 'stacked_bar':
                        options = buildStackedBarOptions(data, chart);
                        break;
                    case 'line':
                        options = buildLineOptions(data, chart);
                        break;
                    case 'area':
                        options = buildAreaOptions(data, chart);
                        break;
                    case 'radar':
                        options = buildRadarOptions(data, chart);
                        break;
                    case 'scatter':
                        options = buildScatterOptions(data, chart);
                        break;
                    default:
                        options = buildBarOptions(data, chart, false);
                }

                if (options) {
                    // Override height for secondary research charts (compact)
                    options.chart = { ...(options.chart || {}), height: 280 };
                    el.innerHTML = '';
                    const c = new ApexCharts(el, options);
                    c.render();
                    chartInstances.push({ instance: c, tabId: 'secondary_research', idx: idx });
                }
            } catch (e) {
                el.innerHTML = `<div style="text-align:center;padding:16px;opacity:0.5">Chart unavailable</div>`;
            }
        });
    }

    // ═══ RENDER ALL CHARTS ═══
    function renderAllCharts(tabs) {
        // Destroy previous chart instances
        chartInstances.forEach(c => {
            try { c.instance.destroy(); } catch (e) { /* ignore */ }
        });
        chartInstances = [];

        tabs.forEach((tab, i) => {
            const id = tab.tab_id || `tab-${i}`;
            (tab.charts || []).forEach((chart, ci) => {
                renderChart(`insChart-${id}-${ci}`, chart, id, ci);
            });
        });
        window.__insChartInstances = chartInstances;

        // Listen for resize (fires on window resize AND sidebar toggle) to reflow all charts
        if (!window.__insResizeListenerAdded) {
            window.__insResizeListenerAdded = true;
            let resizeTimer;
            window.addEventListener('resize', function () {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function () {
                    const insts = window.__insChartInstances;
                    if (!insts || !insts.length) return;
                    insts.forEach(function (ci) {
                        const el = ci.instance.el;
                        if (!el) return;
                        const w = el.offsetWidth || el.parentElement?.offsetWidth;
                        if (w && w > 0) {
                            ci.instance.updateOptions({ chart: { width: w } }, false, false);
                        }
                    });
                    // Also reflow KPI gauges
                    kpiChartInstances.forEach(function (c) {
                        const el = c.el;
                        if (!el) return;
                        const w = el.offsetWidth || el.parentElement?.offsetWidth;
                        if (w && w > 0) {
                            c.updateOptions({ chart: { width: w } }, false, false);
                        }
                    });
                }, 200);
            });
        }
    }

    // ═══ CHART RENDERING ═══
    function renderChart(elId, chartConfig, tabId, chartIdx) {
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
                // Add segment click handlers if segment_profiles exist
                if (hasSegmentProfiles() && tabId != null) {
                    addSegmentClickHandlers(options, chartConfig, tabId);
                }

                el.innerHTML = '';
                const chart = new ApexCharts(el, options);
                chart.render();
                chartInstances.push({
                    instance: chart,
                    tabId: tabId,
                    idx: chartIdx,
                    config: chartConfig
                });
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
                width: '100%',
                toolbar: { show: false, export: { png: { background: 'transparent' }, svg: { background: 'transparent' } } },
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
                            formatter: (val) => {
                                const suffix = config.suffix || '%';
                                if (suffix === '%') return fmtPct(val);
                                return fmtMean(val) + suffix;
                            }
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
                position: 'bottom',
                fontSize: mobile ? '11px' : '12px',
                horizontalAlign: 'center'
            },
            dataLabels: {
                enabled: true,
                formatter: (val) => fmtPct(val),
                style: { fontSize: mobile ? '10px' : '12px', fontWeight: 600, colors: ['#ffffff'] },
                dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.4 }
            },
            stroke: { width: 1, colors: [strokeColor] },
            tooltip: {
                ...baseChartOptions().tooltip,
                y: {
                    formatter: (val, opts) => {
                        let label = fmtPct(val);
                        const count = resolveCount(data, 0, opts?.dataPointIndex ?? 0, val);
                        if (count != null) {
                            label += ` <span style="opacity:0.7">(n=${count.toLocaleString()})</span>`;
                        }
                        return label;
                    }
                }
            }
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

    /** Resolve actual count from data.counts (real) or compute from base+percentage (fallback) */
    function resolveCount(chartData, seriesIndex, dataPointIndex, pctValue) {
        const counts = chartData?.counts;
        if (counts) {
            // Multi-series: counts is array of {name, data}
            if (Array.isArray(counts) && counts[seriesIndex]?.data) {
                const c = counts[seriesIndex].data[dataPointIndex];
                if (c != null) return c;
            }
            // Flat series: counts is array of numbers
            if (Array.isArray(counts) && typeof counts[0] === 'number') {
                const c = counts[dataPointIndex];
                if (c != null) return c;
            }
        }
        // Fallback: compute from base + percentage
        const base = chartData?.base ?? chartData?.n ?? dashboardData?.sample_size;
        if (base && typeof pctValue === 'number') {
            return Math.round(pctValue * base / 100);
        }
        return null;
    }

    function buildSigTooltip(sigLookup, categories, chartData, config) {
        return {
            y: {
                formatter: (val, opts) => {
                    let label = typeof val === 'number' ? fmtPct(val) : String(val);
                    // Add count (real from data.counts or computed from base)
                    const count = resolveCount(chartData, opts.seriesIndex, opts.dataPointIndex, val);
                    if (count != null) {
                        label += ` <span style="opacity:0.7">(n=${count.toLocaleString()})</span>`;
                    }
                    // Add significance
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

        const opts = {
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

        const sigLookup = buildSignificanceLookup(config);
        const valSuffix = detectValueSuffix(data, config);

        // Always show data labels on desktop
        if (!mobile) {
            opts.dataLabels = {
                enabled: true,
                formatter: (val, o) => {
                    let label = valSuffix === '%' ? fmtPct(val) : fmtVal(val, config);
                    if (sigLookup) {
                        const cat = categories[o.dataPointIndex];
                        const sName = series[o.seriesIndex]?.name;
                        const dir = getSigDirection(sigLookup, cat, sName);
                        if (dir) label += dir === 'high' ? ' ▲' : ' ▼';
                    }
                    return label;
                },
                style: { fontSize: '11px', fontWeight: 600, colors: horizontal ? ['#ffffff'] : [getChartValueColor()] },
                offsetY: horizontal ? 0 : -8,
                dropShadow: horizontal ? { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.35 } : { enabled: false }
            };
            if (sigLookup) {
                opts.chart.events = {
                    animationEnd: colorizeSignificanceLabels,
                    mounted: colorizeSignificanceLabels
                };
            }
        }

        // Rich tooltips with percentage + count + significance
        const sigTip = buildSigTooltip(sigLookup, categories, data, config);
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

        const maxLabelLen = mobile ? 14 : 30;
        const displayCategories = categories.map(c =>
            typeof c === 'string' && c.length > maxLabelLen ? c.substring(0, maxLabelLen) + '...' : c
        );

        // Only use 100% stackType when there are multiple series (otherwise single series always shows 100%)
        const usePercentStack = series.length > 1;

        const opts = {
            ...baseChartOptions(),
            chart: {
                ...baseChartOptions().chart,
                type: 'bar',
                height: chartHeight(320, Math.max(260, categories.length * 44)),
                stacked: true,
                ...(usePercentStack ? { stackType: '100%' } : {}),
                events: sigLookup ? {
                    animationEnd: colorizeSignificanceLabels,
                    mounted: colorizeSignificanceLabels
                } : {}
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
                    formatter: (val) => usePercentStack ? fmtPct(val) : (val != null ? Number(val).toLocaleString() : '')
                },
                axisBorder: { color: gridColor }
            },
            yaxis: {
                labels: {
                    style: { colors: labelColor, fontSize: mobile ? '10px' : '11px' },
                    maxWidth: mobile ? 90 : 160
                }
            },
            tooltip: {
                y: {
                    formatter: (val) => usePercentStack ? fmtPct(val) : (val != null ? Number(val).toLocaleString() : '')
                }
            },
            legend: {
                ...baseChartOptions().legend,
                fontSize: mobile ? '10px' : '12px',
                position: 'bottom'
            },
            dataLabels: {
                enabled: !mobile,
                formatter: (val, o) => {
                    if (usePercentStack && val <= 5) return '';
                    let label = usePercentStack ? fmtPct(val) : (val != null ? Number(val).toLocaleString() : '');
                    if (sigLookup) {
                        const cat = categories[o.dataPointIndex];
                        const sName = series[o.seriesIndex]?.name;
                        const dir = getSigDirection(sigLookup, cat, sName);
                        if (dir) label += dir === 'high' ? ' ▲' : ' ▼';
                    }
                    return label;
                },
                style: { fontSize: '11px', fontWeight: 600, colors: ['#ffffff'] },
                dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.35 }
            },
            fill: { opacity: 0.9 }
        };

        // Rich tooltips with percentage + count + significance
        const sigTip = buildSigTooltip(sigLookup, categories, data, config);
        if (sigTip.y) opts.tooltip = { ...opts.tooltip, ...sigTip };

        return opts;
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
                style: { fontSize: mobile ? '10px' : '11px', fontWeight: 600, colors: ['#ffffff'] },
                formatter: (text, op) => [text, op.value != null ? fmtPct(op.value) : ''],
                offsetY: -2,
                dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.35 }
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
                            formatter: v => fmtPct(v)
                        },
                        total: {
                            show: labels.length > 1,
                            label: 'Average',
                            fontSize: '11px',
                            color: labelColor,
                            formatter: w => fmtPct(w.globals.series.reduce((a, b) => a + b, 0) / w.globals.series.length)
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
                formatter: v => fmtPct(v),
                style: { fontSize: mobile ? '9px' : '11px', fontWeight: 600, colors: ['#ffffff'] },
                dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.35 }
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

    /** Format text with bullet points. Splits on • or \n• and renders as styled list. Also handles arrays. */
    function formatBullets(str) {
        if (!str) return '';
        // Handle arrays — join into bullet string
        if (Array.isArray(str)) {
            if (str.length === 0) return '';
            const bullets = str.filter(s => s && s.trim());
            return '<ul class="ins-bullet-list">' +
                bullets.map(b => {
                    const escaped = esc(b);
                    const headerMatch = escaped.match(/^([A-Z][A-Z\s\/&]+):\s*(.*)/s);
                    if (headerMatch) return `<li><strong>${headerMatch[1]}:</strong> ${headerMatch[2]}</li>`;
                    return `<li>${escaped}</li>`;
                }).join('') + '</ul>';
        }
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
    window.insToggleOverview = function () {
        const section = document.getElementById('insOverviewSection');
        if (section) section.classList.toggle('collapsed');
    };

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

    // ═══ SOURCE CITATION POPOVERS ═══

    /** Build lookup map from top-level sources array (keyed by id) */
    function buildSourceLookup(d) {
        const map = {};
        if (d && Array.isArray(d.sources)) {
            d.sources.forEach(s => { if (s.id) map[s.id] = s; });
        }
        return map;
    }

    /** Render a small source citation icon + popover HTML for a single source_id */
    function renderSourceCitation(sourceId, popoverId) {
        if (!sourceId || !dashboardData) return '';
        const lookup = buildSourceLookup(dashboardData);
        const src = lookup[sourceId];
        if (!src) return '';
        return `<span class="ins-info-trigger ins-source-cite" onclick="insToggleSourcePopover(event, '${popoverId}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <div class="ins-info-popover ins-source-popover" id="${popoverId}">
                <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--ins-text-secondary);">Source</div>
                <a href="${esc(src.url || '#')}" target="_blank" rel="noopener" style="color:var(--ins-accent);text-decoration:none;font-size:12px;word-break:break-all;">${esc(src.title || src.domain || src.url || 'Source')}</a>
                ${src.tier ? `<div style="margin-top:4px;font-size:10px;color:var(--ins-text-muted);">Tier ${src.tier} source${src.accessed_at ? ' · Accessed ' + esc(src.accessed_at) : ''}</div>` : ''}
            </div>
        </span>`;
    }

    /** Render source citations for multiple source_ids (used on charts) */
    function renderMultiSourceCitation(sourceIds, popoverId) {
        if (!Array.isArray(sourceIds) || sourceIds.length === 0 || !dashboardData) return '';
        const lookup = buildSourceLookup(dashboardData);
        const validSources = sourceIds.map(id => lookup[id]).filter(Boolean);
        if (validSources.length === 0) return '';
        const sourcesHtml = validSources.map(s =>
            `<div style="margin-bottom:6px;">
                <a href="${esc(s.url || '#')}" target="_blank" rel="noopener" style="color:var(--ins-accent);text-decoration:none;font-size:12px;word-break:break-all;">${esc(s.title || s.domain || s.url || 'Source')}</a>
                ${s.tier ? `<div style="font-size:10px;color:var(--ins-text-muted);">Tier ${s.tier}${s.accessed_at ? ' · ' + esc(s.accessed_at) : ''}</div>` : ''}
            </div>`
        ).join('');
        return `<span class="ins-info-trigger ins-source-cite" onclick="insToggleSourcePopover(event, '${popoverId}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span style="font-size:10px;margin-left:2px;">${validSources.length}</span>
            <div class="ins-info-popover ins-source-popover" id="${popoverId}" style="min-width:220px;">
                <div style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--ins-text-secondary);">Sources (${validSources.length})</div>
                ${sourcesHtml}
            </div>
        </span>`;
    }

    window.insToggleSourcePopover = function (e, popoverId) {
        e.stopPropagation();
        // Close all other source popovers and move them back
        document.querySelectorAll('.ins-source-popover.visible').forEach(p => {
            if (p.id !== popoverId) {
                p.classList.remove('visible');
                if (p._originalParent) { p._originalParent.appendChild(p); p._originalParent = null; }
            }
        });
        const popover = document.getElementById(popoverId);
        if (!popover) return;
        const trigger = popover.closest('.ins-info-trigger') || e.currentTarget;
        const isVisible = !popover.classList.contains('visible');
        if (isVisible) {
            // Move to body to escape all overflow/transform contexts
            const rect = trigger.getBoundingClientRect();
            popover._originalParent = popover.parentElement;
            document.body.appendChild(popover);
            popover.classList.add('visible');
            // Compute position — prefer below trigger, flip above if not enough space
            const popH = popover.offsetHeight || 150;
            let top = rect.bottom + 8;
            if (top + popH > window.innerHeight - 8) top = rect.top - popH - 8;
            popover.style.top = Math.max(8, top) + 'px';
            popover.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 380)) + 'px';
        } else {
            popover.classList.remove('visible');
            if (popover._originalParent) { popover._originalParent.appendChild(popover); popover._originalParent = null; }
        }
    };

    // Close methodology + source popovers when clicking outside
    document.addEventListener('click', function (e) {
        const popover = document.getElementById('insMethodologyPopover');
        if (popover && popover.classList.contains('visible') && !e.target.closest('.ins-info-trigger')) {
            popover.classList.remove('visible');
        }
        // Close any open source popovers and move them back
        if (!e.target.closest('.ins-info-trigger') && !e.target.closest('.ins-source-popover')) {
            document.querySelectorAll('.ins-source-popover.visible').forEach(p => {
                p.classList.remove('visible');
                if (p._originalParent) { p._originalParent.appendChild(p); p._originalParent = null; }
            });
        }
    });

    // Close source popovers on scroll
    window.addEventListener('scroll', function () {
        document.querySelectorAll('.ins-source-popover.visible').forEach(p => {
            p.classList.remove('visible');
            if (p._originalParent) { p._originalParent.appendChild(p); p._originalParent = null; }
        });
    }, true);

    window.insSwitchMiniTab = function (btn, panel) {
        btn.parentElement.querySelectorAll('.ins-mini-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const card = btn.closest('.ins-summary-card');
        card.querySelectorAll('.ins-mini-panel').forEach(p => p.classList.remove('active'));
        card.querySelector(`#insMini${panel === 'exec' ? 'Exec' : 'Key'}`).classList.add('active');
    };

    window.insSwitchTab = function (tabId) {
        // Scroll to top so new tab content starts from the beginning
        window.scrollTo({ top: 0, behavior: 'instant' });

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

        // Also try horizontal tab button for label
        if (!activeBtn) {
            const hTab = document.querySelector(`.ins-tab-btn[data-tab="${tabId}"]`);
            if (hTab && headerTabName) {
                headerTabName.textContent = hTab.textContent.trim();
            }
        }

        // Update sticky header
        const stickyLabel = document.getElementById('insStickyTabLabel');
        if (stickyLabel) {
            const label = (activeBtn && activeBtn.querySelector('.nav-label')?.textContent) ||
                          document.querySelector(`.ins-tab-btn[data-tab="${tabId}"]`)?.textContent?.trim() || tabId;
            stickyLabel.textContent = label;
        }
        updateStickyNavButtons();

        // Re-init scroll animations for newly visible cards
        requestAnimationFrame(() => initScrollAnimations());

        // Trigger resize so ApexCharts reflows to container width
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);

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

        // Add Secondary Research sidebar entry if dashboard has secondary_research data
        if (dashboardData && dashboardData.secondary_research && dashboardData.secondary_research.items && dashboardData.secondary_research.items.length > 0) {
            sidebarHtml += `<div class="sidebar-divider"></div>
            <button class="sidebar-btn ins-sr-sidebar-btn" data-tab="secondary-research" onclick="insSwitchTab('secondary-research')">
                <span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
                <span class="nav-label">Secondary Research</span>
            </button>`;
        }

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

    window.insScrollToSecondaryResearch = function () {
        const el = document.getElementById('insSecondaryResearch');
        if (!el) return;

        // Deactivate all tab buttons and highlight the secondary research button
        document.querySelectorAll('.ins-tab-btn, .sidebar-btn[data-tab]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === 'secondary-research');
        });

        // Show all tab panels (so user sees the secondary research section below)
        // Actually just scroll to it — it's always visible below the tabs
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Update header tab name
        const headerTabName = document.getElementById('activeTabName');
        if (headerTabName) headerTabName.textContent = 'Secondary Research';

        // On mobile, close sidebar
        if (window.innerWidth <= 900) insCloseSidebar();
    };

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
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
            syncStickyOffset();
        }, 350);
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
        setTimeout(() => syncStickyOffset(), 350);
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
        window.print();
    };

    // ═══ FEATURE 1: SCROLL ANIMATIONS ═══
    let scrollObserver = null;

    function initScrollAnimations() {
        // Disconnect previous observer
        if (scrollObserver) scrollObserver.disconnect();

        scrollObserver = new IntersectionObserver((entries) => {
            const visible = entries.filter(e => e.isIntersecting);
            visible.forEach((entry, i) => {
                setTimeout(() => {
                    entry.target.classList.add('ins-visible');
                    scrollObserver.unobserve(entry.target);
                }, i * 80);
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

        document.querySelectorAll('.ins-chart-card, .ins-kpi-card, .ins-summary-card').forEach(card => {
            // Only observe cards that aren't already visible
            if (!card.classList.contains('ins-visible')) {
                scrollObserver.observe(card);
            }
        });
    }

    // ═══ FEATURE 2: CHART FULLSCREEN ═══
    let fullscreenChartInstance = null;

    function getChartConfig(tabId, chartIdx) {
        if (!dashboardData) return null;
        const tabs = dashboardData.tabs || dashboardData.sections || [];
        const tab = tabs.find(t => (t.tab_id || `tab-${tabs.indexOf(t)}`) === tabId);
        if (!tab || !tab.charts) return null;
        return tab.charts[chartIdx] || null;
    }

    window.insOpenFullscreen = function (tabId, chartIdx) {
        const config = getChartConfig(tabId, chartIdx);
        if (!config) return;

        const overlay = document.getElementById('insFullscreenOverlay');
        const titleEl = document.getElementById('insFullscreenTitle');
        const chartArea = document.getElementById('insFullscreenChart');
        const insightEl = document.getElementById('insFullscreenInsight');

        titleEl.textContent = config.title || config.question_label || '';

        // Store current tab/idx for theme re-render
        overlay.dataset.tab = tabId;
        overlay.dataset.idx = chartIdx;

        // Show insight if available
        if (config.insight) {
            insightEl.textContent = config.insight;
            insightEl.style.display = 'block';
        } else {
            insightEl.style.display = 'none';
        }

        // Render chart at full size
        chartArea.innerHTML = '';
        if (fullscreenChartInstance) {
            try { fullscreenChartInstance.destroy(); } catch (e) {}
            fullscreenChartInstance = null;
        }

        overlay.classList.add('open');

        // Slight delay to let modal animate in before rendering chart
        requestAnimationFrame(() => {
            const type = config.chart_type || 'bar';
            const data = config.data || {};
            let options = null;

            try {
                switch (type) {
                    case 'gauge': options = buildGaugeOptions(data, config); break;
                    case 'pie': case 'donut': options = buildPieOptions(data, config, type); break;
                    case 'bar': options = buildBarOptions(data, config, true); break;
                    case 'column': options = buildBarOptions(data, config, false); break;
                    case 'stacked_bar': options = buildStackedBarOptions(data, config); break;
                    case 'line': options = buildLineOptions(data, config); break;
                    case 'area': options = buildAreaOptions(data, config); break;
                    case 'radar': options = buildRadarOptions(data, config); break;
                    case 'heatmap': options = buildHeatmapOptions(data, config); break;
                    case 'scatter': options = buildScatterOptions(data, config); break;
                    case 'bubble': options = buildBubbleOptions(data, config); break;
                    case 'treemap': options = buildTreemapOptions(data, config); break;
                    case 'radialBar': options = buildRadialBarOptions(data, config); break;
                    case 'polarArea': options = buildPolarAreaOptions(data, config); break;
                    case 'boxPlot': options = buildBoxPlotOptions(data, config); break;
                    default: options = buildBarOptions(data, config, false);
                }

                if (options) {
                    // Override height for fullscreen
                    if (options.chart) options.chart.height = 450;
                    fullscreenChartInstance = new ApexCharts(chartArea, options);
                    fullscreenChartInstance.render();
                }
            } catch (err) {
                chartArea.innerHTML = '<div style="color:var(--ins-text-muted);padding:40px;text-align:center;">Chart could not be rendered</div>';
            }
        });
    };

    window.insCloseFullscreen = function () {
        const overlay = document.getElementById('insFullscreenOverlay');
        overlay.classList.remove('open');
        if (fullscreenChartInstance) {
            try { fullscreenChartInstance.destroy(); } catch (e) {}
            fullscreenChartInstance = null;
        }
    };

    // ═══ SEGMENT PROFILES — Panel, Click Handlers, Cross-Chart Highlighting ═══

    function hasSegmentProfiles() {
        return dashboardData && dashboardData.segment_profiles && Object.keys(dashboardData.segment_profiles).length > 0;
    }

    /** Collect all segment names (series names, labels, categories) from a chart config */
    function getChartSegmentNames(config) {
        const names = new Set();
        const data = config.data || {};
        const type = config.chart_type || 'bar';
        // Series names
        if (Array.isArray(data.series)) {
            data.series.forEach(s => {
                if (s && typeof s === 'object' && s.name) names.add(s.name);
            });
        }
        // Labels / categories
        (data.labels || data.categories || []).forEach(l => { if (l) names.add(String(l)); });
        // Points series names
        if (Array.isArray(data.points)) {
            data.points.forEach(p => { if (p && p.name) names.add(p.name); });
        }
        return names;
    }

    /** Resolve segment name from a chart click event */
    function resolveSegmentFromClick(chartConfig, seriesIndex, dataPointIndex) {
        const data = chartConfig.data || {};
        const type = chartConfig.chart_type || 'bar';

        switch (type) {
            case 'pie':
            case 'donut':
            case 'polarArea':
                return (data.labels || [])[dataPointIndex] || null;
            case 'stacked_bar':
            case 'radar':
            case 'line':
            case 'area':
                return (Array.isArray(data.series) && data.series[seriesIndex])
                    ? data.series[seriesIndex].name || null : null;
            case 'bar':
            case 'column': {
                // Multi-series: use series name. Single-series: use category
                if (Array.isArray(data.series) && data.series.length > 0 && typeof data.series[0] === 'object' && data.series[0].data) {
                    return data.series[seriesIndex]?.name || null;
                }
                return (data.labels || data.categories || [])[dataPointIndex] || null;
            }
            default:
                return null;
        }
    }

    /** Add click handlers to ApexCharts options for segment interaction */
    function addSegmentClickHandlers(options, chartConfig, tabId) {
        if (!options.chart) options.chart = {};
        if (!options.chart.events) options.chart.events = {};

        const existingMounted = options.chart.events.mounted;
        const existingAnimEnd = options.chart.events.animationEnd;

        // Legend click — open segment panel if matching profile exists
        options.chart.events.legendClick = function (chartContext, seriesIndex, config) {
            const type = chartConfig.chart_type || 'bar';
            let segName = null;
            if (['pie', 'donut', 'polarArea'].includes(type)) {
                segName = (chartConfig.data?.labels || [])[seriesIndex] || null;
            } else if (Array.isArray(chartConfig.data?.series) && chartConfig.data.series[seriesIndex]) {
                segName = chartConfig.data.series[seriesIndex].name || null;
            }
            if (segName && dashboardData.segment_profiles?.[segName]) {
                insOpenSegmentPanel(segName);
            }
        };

        // Data point click — resolve segment + open panel
        options.chart.events.dataPointSelection = function (event, chartContext, config) {
            const segName = resolveSegmentFromClick(chartConfig, config.seriesIndex, config.dataPointIndex);
            if (segName && dashboardData.segment_profiles?.[segName]) {
                insOpenSegmentPanel(segName);
            }
        };

        // Preserve existing event handlers (significance colorize)
        if (existingMounted) {
            const newMounted = options.chart.events.mounted;
            options.chart.events.mounted = function (ctx) {
                existingMounted(ctx);
                if (newMounted) newMounted(ctx);
            };
        }
        if (existingAnimEnd) {
            const newAnimEnd = options.chart.events.animationEnd;
            options.chart.events.animationEnd = function (ctx) {
                existingAnimEnd(ctx);
                if (newAnimEnd) newAnimEnd(ctx);
            };
        }
    }

    /** Open the segment profile panel */
    window.insOpenSegmentPanel = function (segmentName) {
        if (!dashboardData?.segment_profiles) return;
        const profile = dashboardData.segment_profiles[segmentName];
        if (!profile) return;

        const panel = document.getElementById('insSegmentPanel');
        const overlay = document.getElementById('insSegmentPanelOverlay');
        const titleEl = document.getElementById('insSegmentPanelTitle');
        const bodyEl = document.getElementById('insSegmentPanelBody');

        titleEl.textContent = segmentName;

        let html = '';

        // Size cards
        html += '<div class="ins-seg-size-row">';
        if (profile.n != null) {
            html += `<div class="ins-seg-size-card">
                <div class="ins-seg-size-value">${Number(profile.n).toLocaleString()}</div>
                <div class="ins-seg-size-label">Respondents</div>
            </div>`;
        }
        if (profile.pct != null) {
            html += `<div class="ins-seg-size-card">
                <div class="ins-seg-size-value">${profile.pct}%</div>
                <div class="ins-seg-size-label">Of Total</div>
            </div>`;
        }
        html += '</div>';

        // Stats rows
        if (Array.isArray(profile.stats) && profile.stats.length > 0) {
            html += '<div class="ins-seg-stats-section">';
            html += '<div class="ins-seg-stats-title">Key Metrics</div>';
            profile.stats.forEach(stat => {
                const vsAvg = stat.vs_avg || '0';
                const numericVs = parseFloat(vsAvg);
                let vsClass = 'neutral';
                if (numericVs > 0) vsClass = 'positive';
                else if (numericVs < 0) vsClass = 'negative';
                const vsDisplay = numericVs > 0 ? `+${vsAvg}` : vsAvg;

                html += `<div class="ins-seg-stat-row">
                    <span class="ins-seg-stat-label">${esc(stat.label || '')}</span>
                    <span class="ins-seg-stat-right">
                        <span class="ins-seg-stat-value">${esc(stat.value || '')}</span>
                        <span class="ins-seg-vs-avg ${vsClass}">${esc(String(vsDisplay))} vs avg</span>
                    </span>
                </div>`;
            });
            html += '</div>';
        }

        // Traits card
        if (profile.traits) {
            html += `<div class="ins-seg-traits-card">
                <div class="ins-seg-traits-title">Profile</div>
                <div class="ins-seg-traits-text">${esc(profile.traits)}</div>
            </div>`;
        }

        // Top group
        if (profile.top_group) {
            html += `<div class="ins-seg-top-group">Top sub-group: <strong>${esc(profile.top_group)}</strong></div>`;
        }

        bodyEl.innerHTML = html;

        panel.classList.add('open');
        overlay.classList.add('open');
    };

    /** Close the segment profile panel */
    window.insCloseSegmentPanel = function () {
        const panel = document.getElementById('insSegmentPanel');
        const overlay = document.getElementById('insSegmentPanelOverlay');
        if (panel) panel.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
    };

    // Close segment panel when clicking outside it (non-blocking overlay approach)
    document.addEventListener('click', function (e) {
        const panel = document.getElementById('insSegmentPanel');
        if (!panel || !panel.classList.contains('open')) return;
        // Don't close if click is inside the panel itself
        if (panel.contains(e.target)) return;
        // Don't close if click is on a chart legend/data point (those open the panel)
        if (e.target.closest('.apexcharts-legend-series, .apexcharts-series')) return;
        insCloseSegmentPanel();
    }, true);

    // Close segment dropdown when clicking outside or scrolling
    document.addEventListener('click', function (e) {
        if (e.target.closest('.ins-segment-badge, .ins-segment-dropdown')) return;
        document.querySelectorAll('.ins-segment-dropdown').forEach(d => d.remove());
    });
    /** Toggle segment dropdown on badge click */
    window.insToggleSegmentDropdown = function (event, tabId, chartIdx) {
        event.stopPropagation();
        const btn = event.currentTarget;
        const wasOpen = btn.querySelector('.ins-segment-dropdown');

        // Close any open dropdown globally
        document.querySelectorAll('.ins-segment-dropdown').forEach(d => d.remove());

        if (wasOpen) return; // Was open → toggled off

        const segments = JSON.parse(btn.getAttribute('data-segments') || '[]');
        if (!segments.length) return;

        const dd = document.createElement('div');
        dd.className = 'ins-segment-dropdown';
        segments.forEach(name => {
            const item = document.createElement('button');
            item.className = 'ins-segment-dropdown-item';
            item.textContent = name;
            item.onclick = function (e) {
                e.stopPropagation();
                dd.remove();
                insOpenSegmentPanel(name);
            };
            dd.appendChild(item);
        });

        // Append inside the badge — scrolls naturally with content
        btn.appendChild(dd);
    };

    // Escape key: priority order — segment panel → fullscreen
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            // 1. Close segment panel if open
            const segPanel = document.getElementById('insSegmentPanel');
            if (segPanel && segPanel.classList.contains('open')) {
                insCloseSegmentPanel();
                return;
            }
            // 2. Close fullscreen if open
            const overlay = document.getElementById('insFullscreenOverlay');
            if (overlay && overlay.classList.contains('open')) {
                insCloseFullscreen();
            }
        }
    });

    // ═══ FEATURE 3: DATA TABLE TOGGLE ═══
    function sigBadge(dir) {
        if (dir === 'high') return ' <span style="color:#10b981;font-weight:700" title="Significantly higher (95% CI)">▲</span>';
        if (dir === 'low') return ' <span style="color:#ef4444;font-weight:700" title="Significantly lower (95% CI)">▼</span>';
        return '';
    }

    function buildDataTableHtml(chartConfig) {
        const type = chartConfig.chart_type || 'bar';
        const data = chartConfig.data || {};
        const sigLookup = buildSignificanceLookup(chartConfig);
        let headers = [];
        let rows = [];

        switch (type) {
            case 'pie':
            case 'donut':
            case 'radialBar':
            case 'polarArea': {
                const labels = data.labels || [];
                const series = data.series || [];
                headers = ['Label', 'Value'];
                rows = labels.map((l, i) => [esc(l), `<span class="num">${series[i] != null ? series[i] : ''}</span>`]);
                break;
            }
            case 'gauge': {
                const val = data.series ? data.series[0] : (chartConfig.value || 0);
                headers = ['Metric', 'Value'];
                rows = [[esc(chartConfig.title || 'Value'), `<span class="num">${val}${chartConfig.suffix || '%'}</span>`]];
                break;
            }
            case 'bar':
            case 'column': {
                const categories = data.labels || data.categories || [];
                if (Array.isArray(data.series) && data.series.length > 0 && typeof data.series[0] === 'object' && data.series[0].data) {
                    headers = ['Category', ...data.series.map(s => s.name || 'Value')];
                    rows = categories.map((c, i) => [
                        esc(c),
                        ...data.series.map(s => {
                            const v = s.data[i] != null ? s.data[i] : '';
                            const dir = sigLookup ? getSigDirection(sigLookup, c, s.name) : null;
                            return `<span class="num">${v}${sigBadge(dir)}</span>`;
                        })
                    ]);
                } else {
                    headers = ['Category', 'Value'];
                    const vals = data.series || [];
                    rows = categories.map((c, i) => {
                        const dir = sigLookup ? getSigDirection(sigLookup, c, null) : null;
                        return [esc(c), `<span class="num">${vals[i] != null ? vals[i] : ''}${sigBadge(dir)}</span>`];
                    });
                }
                break;
            }
            case 'stacked_bar': {
                const categories = data.categories || data.labels || [];
                const series = Array.isArray(data.series) ? data.series : [];
                headers = ['Category', ...series.map(s => s.name || 'Series')];
                rows = categories.map((c, i) => [
                    esc(c),
                    ...series.map(s => {
                        const v = (s.data || [])[i] != null ? (s.data || [])[i] : '';
                        const dir = sigLookup ? getSigDirection(sigLookup, c, s.name) : null;
                        return `<span class="num">${v}${sigBadge(dir)}</span>`;
                    })
                ]);
                break;
            }
            case 'line':
            case 'area':
            case 'radar': {
                const categories = data.categories || data.labels || [];
                if (Array.isArray(data.series) && data.series.length > 0 && typeof data.series[0] === 'object' && data.series[0].data) {
                    headers = ['X', ...data.series.map(s => s.name || 'Value')];
                    rows = categories.map((c, i) => [
                        esc(c),
                        ...data.series.map(s => `<span class="num">${(s.data || [])[i] != null ? (s.data || [])[i] : ''}</span>`)
                    ]);
                } else {
                    headers = ['X', 'Value'];
                    const vals = data.series || [];
                    rows = categories.map((c, i) => [esc(c), `<span class="num">${vals[i] != null ? vals[i] : ''}</span>`]);
                }
                break;
            }
            case 'scatter':
            case 'bubble': {
                const points = data.points || [];
                const hasBubble = type === 'bubble';
                headers = ['Series', 'X', 'Y'];
                if (hasBubble) headers.push('Size');
                points.forEach(s => {
                    (s.data || []).forEach(p => {
                        const row = [esc(s.name || ''), `<span class="num">${p.x}</span>`, `<span class="num">${p.y}</span>`];
                        if (hasBubble) row.push(`<span class="num">${p.z || ''}</span>`);
                        rows.push(row);
                    });
                });
                break;
            }
            case 'heatmap': {
                const series = Array.isArray(data.series) ? data.series : [];
                const categories = data.categories || data.labels || [];
                headers = ['Row', ...categories];
                series.forEach(s => {
                    rows.push([
                        esc(s.name || ''),
                        ...(s.data || []).map(v => `<span class="num">${typeof v === 'number' ? v : ''}</span>`)
                    ]);
                });
                break;
            }
            case 'boxPlot': {
                const series = Array.isArray(data.series) ? data.series : [];
                const categories = data.categories || data.labels || [];
                headers = ['Group', 'Min', 'Q1', 'Median', 'Q3', 'Max'];
                series.forEach(s => {
                    (s.data || []).forEach((d, i) => {
                        const vals = Array.isArray(d) ? d : [d, d, d, d, d];
                        rows.push([
                            esc(categories[i] || `Group ${i + 1}`),
                            ...vals.map(v => `<span class="num">${v}</span>`)
                        ]);
                    });
                });
                break;
            }
            case 'treemap': {
                const points = data.points || [];
                headers = ['Label', 'Value'];
                if (points.length > 0) {
                    points.forEach(s => {
                        (s.data || []).forEach(p => {
                            rows.push([esc(p.label || p.x || ''), `<span class="num">${p.y}</span>`]);
                        });
                    });
                } else if (Array.isArray(data.series) && Array.isArray(data.labels)) {
                    data.labels.forEach((l, i) => {
                        rows.push([esc(l), `<span class="num">${data.series[i] || 0}</span>`]);
                    });
                }
                break;
            }
            default: {
                const categories = data.labels || data.categories || [];
                const vals = Array.isArray(data.series) ? data.series : [];
                headers = ['Label', 'Value'];
                rows = categories.map((c, i) => [esc(c), `<span class="num">${vals[i] != null ? vals[i] : ''}</span>`]);
            }
        }

        if (rows.length === 0) return '<div style="padding:12px;color:var(--ins-text-muted);font-size:12px;">No data available</div>';

        let html = '<table class="ins-data-table"><thead><tr>';
        headers.forEach((h, i) => {
            html += `<th${i > 0 ? ' class="num"' : ''}>${esc(h)}</th>`;
        });
        html += '</tr></thead><tbody>';
        rows.forEach(row => {
            html += '<tr>';
            row.forEach((cell, i) => {
                html += `<td${i > 0 ? ' class="num"' : ''}>${cell}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    window.insToggleDataTable = function (tabId, chartIdx) {
        const wrap = document.getElementById(`insTable-${tabId}-${chartIdx}`);
        if (!wrap) return;

        const card = wrap.closest('.ins-chart-card');
        const btn = card ? card.querySelector('.ins-chart-action-btn') : null;

        if (wrap.style.display === 'none') {
            // Lazy build table on first open
            if (!wrap.innerHTML) {
                const config = getChartConfig(tabId, chartIdx);
                if (config) wrap.innerHTML = buildDataTableHtml(config);
            }
            wrap.style.display = 'block';
            if (btn) btn.classList.add('active');
        } else {
            wrap.style.display = 'none';
            if (btn) btn.classList.remove('active');
        }
    };

    // ═══ FEATURE 4: STICKY TAB HEADER ═══
    let stickyTabs = [];

    function initStickyHeader(tabs) {
        stickyTabs = tabs;
        if (tabs.length <= 1) return; // No need for sticky nav with 0-1 tabs

        const stickyEl = document.getElementById('insStickyHeader');
        const stickyLabel = document.getElementById('insStickyTabLabel');
        if (!stickyEl || !stickyLabel) return;

        // Set initial label
        const firstLabel = tabs[0].tab_label || tabs[0].title || 'Overview';
        stickyLabel.textContent = firstLabel;
        updateStickyNavButtons();

        // Scroll listener
        let ticking = false;
        window.addEventListener('scroll', function () {
            if (!ticking) {
                requestAnimationFrame(() => {
                    // Show sticky header after minimal scroll (100px)
                    stickyEl.classList.toggle('visible', window.scrollY > 100);
                    ticking = false;
                });
                ticking = true;
            }
        });

        // Sync sidebar offset
        syncStickyOffset();
    }

    function syncStickyOffset() {
        const stickyEl = document.getElementById('insStickyHeader');
        const sidebar = document.getElementById('insSidebar');
        if (!stickyEl) return;
        const isOpen = sidebar && sidebar.classList.contains('open') && window.innerWidth > 900;
        stickyEl.classList.toggle('sidebar-offset', isOpen);
    }

    function getCurrentTabIndex() {
        if (!stickyTabs.length) return 0;
        const activePanel = document.querySelector('.ins-tab-panel.active');
        if (!activePanel) return 0;
        const activeId = activePanel.id.replace('insPanel-', '');
        return stickyTabs.findIndex((t, i) => (t.tab_id || `tab-${i}`) === activeId);
    }

    function updateStickyNavButtons() {
        const idx = getCurrentTabIndex();
        const prevBtn = document.getElementById('insStickyPrev');
        const nextBtn = document.getElementById('insStickyNext');
        if (prevBtn) prevBtn.disabled = idx <= 0;
        if (nextBtn) nextBtn.disabled = idx >= stickyTabs.length - 1;
    }

    window.insStickyPrevTab = function () {
        const idx = getCurrentTabIndex();
        if (idx > 0) {
            const prevTab = stickyTabs[idx - 1];
            const id = prevTab.tab_id || `tab-${idx - 1}`;
            insSwitchTab(id);
        }
    };

    window.insStickyNextTab = function () {
        const idx = getCurrentTabIndex();
        if (idx < stickyTabs.length - 1) {
            const nextTab = stickyTabs[idx + 1];
            const id = nextTab.tab_id || `tab-${idx + 1}`;
            insSwitchTab(id);
        }
    };

    // ═══ FORMAT SETTINGS MODAL ═══
    window.insOpenFormatSettings = function () {
        // Remove existing modal if any
        let modal = document.getElementById('insFormatModal');
        if (modal) modal.remove();

        const s = getFormatSettings();
        modal = document.createElement('div');
        modal.id = 'insFormatModal';
        modal.className = 'ins-format-modal-overlay';
        modal.innerHTML = `
            <div class="ins-format-modal">
                <div class="ins-format-modal-header">
                    <h3>Format Settings</h3>
                    <button onclick="insCloseFormatSettings()" class="ins-format-close">&times;</button>
                </div>
                <div class="ins-format-modal-body">
                    <div class="ins-format-group" data-fmt-group="decimals">
                        <label class="ins-format-label">Percentage Decimals</label>
                        <div class="ins-format-options">
                            <button class="ins-format-opt${s.decimals === 0 ? ' active' : ''}" data-val="0" onclick="insSetDecimal(0)">Whole numbers <span class="ins-format-example">e.g. 79%</span></button>
                            <button class="ins-format-opt${s.decimals === 1 ? ' active' : ''}" data-val="1" onclick="insSetDecimal(1)">1 decimal <span class="ins-format-example">e.g. 79.5%</span></button>
                            <button class="ins-format-opt${s.decimals === 2 ? ' active' : ''}" data-val="2" onclick="insSetDecimal(2)">2 decimals <span class="ins-format-example">e.g. 79.52%</span></button>
                        </div>
                    </div>
                    <div class="ins-format-group" data-fmt-group="showpct">
                        <label class="ins-format-label">Show % Sign</label>
                        <div class="ins-format-options">
                            <button class="ins-format-opt${s.showPercent ? ' active' : ''}" data-val="true" onclick="insSetShowPercent(true)">Show % <span class="ins-format-example">e.g. 79%</span></button>
                            <button class="ins-format-opt${!s.showPercent ? ' active' : ''}" data-val="false" onclick="insSetShowPercent(false)">Hide % <span class="ins-format-example">e.g. 79</span></button>
                        </div>
                    </div>
                    <div class="ins-format-group" data-fmt-group="means">
                        <label class="ins-format-label">Means / Scores Decimals</label>
                        <div class="ins-format-options">
                            <button class="ins-format-opt${s.meansDecimals === 1 ? ' active' : ''}" data-val="1" onclick="insSetMeansDecimal(1)">1 decimal <span class="ins-format-example">e.g. 3.5</span></button>
                            <button class="ins-format-opt${s.meansDecimals === 2 ? ' active' : ''}" data-val="2" onclick="insSetMeansDecimal(2)">2 decimals <span class="ins-format-example">e.g. 3.45</span></button>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('open'));
    };

    window.insCloseFormatSettings = function () {
        const modal = document.getElementById('insFormatModal');
        if (modal) {
            modal.classList.remove('open');
            setTimeout(() => modal.remove(), 200);
        }
    };

    function applyFormatAndRerender() {
        if (dashboardData) {
            const tabs = dashboardData.tabs || dashboardData.sections || [];
            renderAllCharts(tabs);
            renderKpiGauges(dashboardData.kpi_cards || []);
        }
        // Re-render fullscreen if open
        const overlay = document.getElementById('insFullscreenOverlay');
        if (overlay && overlay.classList.contains('open') && overlay.dataset.tab) {
            insOpenFullscreen(overlay.dataset.tab, parseInt(overlay.dataset.idx));
        }
    }

    window.insSetDecimal = function (val) {
        const s = getFormatSettings();
        s.decimals = val;
        saveFormatSettings(s);
        document.querySelectorAll('[data-fmt-group="decimals"] .ins-format-opt').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.val) === val);
        });
        applyFormatAndRerender();
    };

    window.insSetShowPercent = function (val) {
        const s = getFormatSettings();
        s.showPercent = val;
        saveFormatSettings(s);
        document.querySelectorAll('[data-fmt-group="showpct"] .ins-format-opt').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val === String(val));
        });
        applyFormatAndRerender();
    };

    window.insSetMeansDecimal = function (val) {
        const s = getFormatSettings();
        s.meansDecimals = val;
        saveFormatSettings(s);
        document.querySelectorAll('[data-fmt-group="means"] .ins-format-opt').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.val) === val);
        });
        applyFormatAndRerender();
    };

    // ═══ MULTI-CHART DOWNLOAD ═══
    let selectModeActive = false;

    window.insToggleSelectMode = function () {
        selectModeActive = !selectModeActive;
        selectedCharts.clear();

        // Show/hide checkboxes on all chart cards
        document.querySelectorAll('.ins-chart-select-wrap').forEach(w => {
            w.style.display = selectModeActive ? 'block' : 'none';
            const cb = w.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = false;
        });

        // Show/hide floating action bar
        let bar = document.getElementById('insDownloadBar');
        if (selectModeActive) {
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'insDownloadBar';
                bar.className = 'ins-download-bar';
                bar.innerHTML = `
                    <span class="ins-download-bar-count"><span id="insSelectedCount">0</span> charts selected</span>
                    <button class="ins-download-bar-btn" onclick="insDownloadSelected()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download Selected
                    </button>
                    <button class="ins-download-bar-cancel" onclick="insToggleSelectMode()">Cancel</button>`;
                document.body.appendChild(bar);
            }
            requestAnimationFrame(() => bar.classList.add('visible'));
        } else {
            if (bar) {
                bar.classList.remove('visible');
                setTimeout(() => bar.remove(), 200);
            }
            // Remove selected state from cards
            document.querySelectorAll('.ins-chart-card.selected').forEach(c => c.classList.remove('selected'));
        }
    };

    window.insToggleChartSelect = function (tabId, chartIdx, checked) {
        const key = `${tabId}-${chartIdx}`;
        if (checked) {
            selectedCharts.add(key);
        } else {
            selectedCharts.delete(key);
        }
        // Update card visual
        const card = document.querySelector(`.ins-chart-card[data-chart-tab="${tabId}"][data-chart-idx="${chartIdx}"]`);
        if (card) card.classList.toggle('selected', checked);

        // Update count
        const countEl = document.getElementById('insSelectedCount');
        if (countEl) countEl.textContent = selectedCharts.size;
    };

    window.insDownloadSelected = async function () {
        if (selectedCharts.size === 0) {
            showToast('No charts selected');
            return;
        }

        const bar = document.getElementById('insDownloadBar');
        const btn = bar?.querySelector('.ins-download-bar-btn');
        if (btn) btn.textContent = 'Downloading...';

        let downloaded = 0;
        for (const key of selectedCharts) {
            const entry = chartInstances.find(c => `${c.tabId}-${c.idx}` === key);
            if (!entry) continue;

            try {
                const { imgURI } = await entry.instance.dataURI({ scale: 2, background: 'transparent' });
                const link = document.createElement('a');
                const config = entry.config;
                const name = (config.title || config.question_label || `chart-${key}`).replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-').substring(0, 50);
                link.href = imgURI;
                link.download = `${name}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                downloaded++;
                // Small delay between downloads to avoid browser blocking
                await new Promise(r => setTimeout(r, 300));
            } catch (err) {
                console.warn(`Failed to export chart ${key}:`, err);
            }
        }

        showToast(`Downloaded ${downloaded} chart${downloaded !== 1 ? 's' : ''}`);
        if (btn) btn.textContent = 'Download Selected';
        insToggleSelectMode();
    };

    // ═══ DOWNLOAD PPT ═══
    window.insDownloadPPT = function () {
        if (!dashboardData) {
            showToast('No dashboard data loaded', 'error');
            return;
        }
        if (typeof generateInsightsPPT !== 'function') {
            showToast('PPT generator not loaded', 'error');
            return;
        }
        showToast('Generating PPT...', 'info');
        // Small delay to let toast render before heavy sync work
        setTimeout(() => {
            generateInsightsPPT(dashboardData, {
                projectName: dashboardData.project_name || document.title.split('—')[0].trim(),
                sampleSize: dashboardData.sample_size,
            });
        }, 100);
    };

    // Expose showToast so PPT generator can use it
    window.showInsToast = showToast;

    // ═══ THEME TOGGLE (updated with fullscreen re-render) ═══
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

        // Re-render fullscreen chart if open
        const overlay = document.getElementById('insFullscreenOverlay');
        if (overlay && overlay.classList.contains('open') && overlay.dataset.tab) {
            requestAnimationFrame(() => {
                insOpenFullscreen(overlay.dataset.tab, parseInt(overlay.dataset.idx));
            });
        }
    };
})();
