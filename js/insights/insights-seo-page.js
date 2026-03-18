/**
 * Insights SEO Page Renderer
 * Fetches dashboard JSON from the research API and renders:
 *   1. SEO header (breadcrumb, title, KPIs) — crawlable text for Google
 *   2. Full interactive dashboard (iframe) — showcases product capabilities
 *   3. Article content (exec summary, findings, methodology) — SEO body text
 *   4. Dark/Light theme toggle with localStorage persistence
 */
(function () {
    'use strict';

    const API_BASE = (function () {
        const h = window.location.hostname;
        if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.'))
            return window.location.origin.replace(':5501', ':5114').replace('http://', 'https://');
        return 'https://research.ragenaizer.com';
    })();

    const MANIFEST_URL = '/pages/insights/manifest.json';
    const THEME_KEY = '_rz_insights_theme';

    // ─── Theme Management ───
    function initTheme() {
        const saved = localStorage.getItem(THEME_KEY);
        const theme = saved || 'light'; // default light for insights pages
        applyTheme(theme);
        // Toggle button injected later after report HTML is rendered
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-insights-theme', theme);
        document.body.classList.add('insights-page');
        localStorage.setItem(THEME_KEY, theme);
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-insights-theme');
        applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    function injectThemeToggle() {
        if (document.querySelector('.seo-theme-toggle')) return;
        const btn = document.createElement('button');
        btn.className = 'seo-theme-toggle';
        btn.setAttribute('aria-label', 'Toggle dark/light mode');
        btn.setAttribute('title', 'Toggle dark/light mode');
        btn.innerHTML = `
            <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>`;
        btn.addEventListener('click', toggleTheme);
        // Try to place in header meta area, fallback to body
        const header = document.querySelector('.seo-report-header');
        if (header) {
            header.appendChild(btn);
        } else {
            document.body.appendChild(btn);
        }
    }

    // ─── Entry Point ───
    function init() {
        initTheme();

        const container = document.getElementById('insights-report');
        if (!container) return;

        const token = container.getAttribute('data-token');
        const slug = container.getAttribute('data-slug');
        if (!token) {
            container.innerHTML = '<div class="seo-error"><p>Missing report token.</p></div>';
            return;
        }

        // Show loading state
        container.innerHTML = `
            <div class="seo-report">
                <div class="seo-loading">
                    <div class="seo-loading-spinner"></div>
                    <p>Loading report...</p>
                </div>
            </div>`;

        // Log view (fire-and-forget)
        try {
            var vid = localStorage.getItem('_rz_vid');
            if (!vid) {
                vid = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36));
                localStorage.setItem('_rz_vid', vid);
            }
            fetch(API_BASE + '/api/insights/' + token + '/view', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitor_id: vid, referrer: document.referrer || null })
            }).catch(function () {});
        } catch (e) {}

        // Fetch dashboard JSON and manifest in parallel
        Promise.all([
            fetch(API_BASE + '/api/insights/' + token).then(r => r.ok ? r.json() : Promise.reject('API error')),
            fetch(MANIFEST_URL).then(r => r.ok ? r.json() : { reports: [] }).catch(() => ({ reports: [] }))
        ])
        .then(function ([data, manifest]) {
            renderReport(container, data, slug, manifest.reports || []);
        })
        .catch(function (err) {
            console.error('Failed to load insights:', err);
            container.innerHTML = `
                <div class="seo-report">
                    <div class="seo-error">
                        <p>Unable to load this report. Please try again later.</p>
                    </div>
                </div>`;
        });
    }

    // ─── Render Full Report ───
    function renderReport(container, data, slug, allReports) {
        // API returns { dashboard_json: "...(JSON string)..." }
        let d;
        if (typeof data.dashboard_json === 'string') {
            d = JSON.parse(data.dashboard_json);
        } else {
            d = data.dashboard_json || data.dashboard || data;
        }
        const projectName = data.project_name || d.project_name || d.title || 'Research Report';
        const execSummary = toBulletArray(d.executive_summary);
        const kpiCards = d.kpi_cards || [];
        const keyTakeaways = toBulletArray(d.key_takeaways);
        const overallInsights = toBulletArray(d.overall_insights);
        const tabs = d.tabs || [];
        const methodNote = (d.methodology_note || '').replace('references cited below', 'references cited above');
        const sampleSize = d.sample_size || d.total_responses || '';
        const sources = d.sources || [];
        const isSecondary = d.research_type === 'secondary';
        const token = container.getAttribute('data-token');

        // Find this report's manifest entry for date/category
        const manifestEntry = allReports.find(function (r) { return r.slug === slug; });
        const category = manifestEntry ? manifestEntry.category : '';
        const datePublished = manifestEntry ? manifestEntry.date_published : '';

        let html = '';

        // ═══ PART 1: SEO Header (narrow container) ═══
        html += '<div class="seo-report">';

        // Breadcrumb
        html += `
            <nav class="seo-breadcrumb" aria-label="Breadcrumb">
                <a href="/">Home</a>
                <span class="seo-breadcrumb-sep">/</span>
                <a href="/pages/insights/">Insights</a>
                <span class="seo-breadcrumb-sep">/</span>
                <span>${escHtml(projectName)}</span>
            </nav>`;

        // Header
        html += `
            <header class="seo-report-header">
                <h1>${escHtml(projectName)}</h1>
                <div class="seo-report-meta">
                    ${isSecondary && sources.length ? `<span><svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>${sources.length} Sources</span>` : ''}
                    ${sampleSize ? `<span><svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>N = ${escHtml(String(sampleSize))}</span>` : ''}
                    ${category ? `<span><svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${escHtml(category)}</span>` : ''}
                    ${datePublished ? `<span><svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${escHtml(datePublished)}</span>` : ''}
                </div>
            </header>`;

        // KPI Cards (above dashboard as a visual hook)
        if (kpiCards.length) {
            html += `
                <section class="seo-section seo-section-kpis">
                    <div class="seo-kpi-grid">${kpiCards.map(function (kpi) {
                        const rawVal = kpi.value != null ? String(kpi.value) : '';
                        const suffix = kpi.suffix || '';
                        const val = suffix ? rawVal + ' ' + suffix : rawVal;
                        const label = kpi.kpi_label || kpi.label || kpi.title || '';
                        const insight = kpi.insight || '';
                        return `
                            <div class="seo-kpi-card">
                                <div class="seo-kpi-value">${escHtml(String(val))}</div>
                                <div class="seo-kpi-label">${escHtml(label)}</div>
                                ${insight ? `<div class="seo-kpi-insight">${escHtml(insight)}</div>` : ''}
                            </div>`;
                    }).join('')}</div>
                </section>`;
        }

        html += '</div>'; // close .seo-report

        // ═══ PART 2: Full-width Interactive Dashboard ═══
        html += `
            <section class="seo-dashboard-showcase">
                <div class="seo-dashboard-header">
                    <h2>Interactive Dashboard</h2>
                    <p>Explore the full interactive dashboard — charts, filters, segment profiles, and detailed breakdowns. Built with <a href="https://ragenaizer.com/pages/research.html">Ragenaizer Research</a>.</p>
                    <a href="/pages/research/insights.html?token=${encodeURIComponent(token)}" target="_blank" rel="noopener" class="seo-dashboard-open-btn">Open Full Dashboard <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
                </div>
                <div class="seo-dashboard-frame">
                    <iframe src="/pages/research/insights.html?token=${encodeURIComponent(token)}&embed=true"
                            title="${escAttr(projectName)} — Interactive Dashboard"
                            allowfullscreen>
                    </iframe>
                </div>
            </section>`;

        // ═══ PART 3: SEO Article Content (narrow container) ═══
        html += '<article class="seo-report">';

        // Executive Summary
        if (execSummary.length) {
            html += `
                <section class="seo-section">
                    <h2>Executive Summary</h2>
                    <ul>${execSummary.map(function (item) {
                        const text = typeof item === 'string' ? item : (item.text || item.point || '');
                        return '<li>' + escHtml(text) + '</li>';
                    }).join('')}</ul>
                </section>`;
        }

        // Key Takeaways (secondary research)
        if (keyTakeaways.length) {
            html += `
                <section class="seo-section">
                    <h2>Key Takeaways</h2>
                    <ol>${keyTakeaways.map(function (item) {
                        const text = typeof item === 'string' ? item : (item.text || item.point || '');
                        return '<li>' + escHtml(text) + '</li>';
                    }).join('')}</ol>
                </section>`;
        }

        // Key Findings & Recommendations
        if (overallInsights.length) {
            html += `
                <section class="seo-section">
                    <h2>Key Findings & Recommendations</h2>
                    <ul>${overallInsights.map(function (item) {
                        const text = typeof item === 'string' ? item : (item.text || item.insight || '');
                        return '<li>' + escHtml(text) + '</li>';
                    }).join('')}</ul>
                </section>`;
        }

        // Detailed Analysis (tabs)
        if (tabs.length) {
            html += '<section class="seo-section"><h2>Detailed Analysis</h2>';
            tabs.forEach(function (tab) {
                const tabLabel = tab.title || tab.label || tab.tab_label || tab.name || '';
                const tabSummary = toBulletArray(tab.tab_summary || tab.summary);
                const charts = tab.charts || [];

                if (tabLabel) {
                    html += '<h3>' + escHtml(tabLabel) + '</h3>';
                }
                if (tabSummary.length) {
                    html += '<ul>' + tabSummary.map(function (s) {
                        const text = typeof s === 'string' ? s : (s.text || s.point || '');
                        return '<li>' + escHtml(text) + '</li>';
                    }).join('') + '</ul>';
                }
                charts.forEach(function (chart) {
                    const title = chart.title || '';
                    const insight = chart.insight || chart.description || '';
                    if (title && insight) {
                        html += '<p><strong>' + escHtml(title) + ':</strong> ' + escHtml(insight) + '</p>';
                    }
                });
            });
            html += '</section>';
        }

        // Sources (secondary research)
        if (sources.length) {
            html += `
                <section class="seo-section">
                    <h2>Sources & References</h2>
                    <ol class="seo-sources-list">${sources.map(function (src) {
                        const title = src.title || src.domain || 'Source';
                        const url = src.url || '';
                        const tier = src.tier ? ' (Tier ' + src.tier + ')' : '';
                        return '<li>' + (url ? '<a href="' + escAttr(url) + '" target="_blank" rel="noopener nofollow">' + escHtml(title) + '</a>' : escHtml(title)) + escHtml(tier) + '</li>';
                    }).join('')}</ol>
                </section>`;
        }

        // Methodology
        if (methodNote) {
            html += `
                <section class="seo-section">
                    <h2>Methodology</h2>
                    <div class="seo-methodology">
                        ${methodNote ? '<p>' + escHtml(methodNote) + '</p>' : ''}
                        ${sampleSize ? '<p><strong>Sample size:</strong> ' + escHtml(String(sampleSize)) + ' respondents</p>' : ''}
                    </div>
                </section>`;
        }

        // Related Insights
        const related = allReports.filter(function (r) { return r.slug !== slug; });
        if (related.length) {
            html += `
                <section class="seo-section">
                    <h2>Related Insights</h2>
                    <div class="seo-related-grid">${related.map(function (r) {
                        return `
                            <a href="/pages/insights/${r.slug}.html" class="seo-related-card">
                                <h3>${escHtml(r.title)}</h3>
                                <p>${escHtml(r.meta_description || '')}</p>
                            </a>`;
                    }).join('')}</div>
                </section>`;
        }

        html += '</article>';
        container.innerHTML = html;

        // Inject theme toggle into the rendered header
        injectThemeToggle();
    }

    // ─── Helpers ───

    /** Convert bullet-point string or array to array of strings */
    function toBulletArray(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') {
            return val.split(/\n[•\-]\s*|\n(?=\d+\.\s)/)
                .map(function (s) { return s.replace(/^[•\-]\s*/, '').trim(); })
                .filter(Boolean);
        }
        return [];
    }

    function escHtml(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function escAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ─── Init ───
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
