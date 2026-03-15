/**
 * Insights SEO Page Renderer
 * Fetches dashboard JSON from the research API and renders:
 *   1. SEO header (breadcrumb, title, KPIs) — crawlable text for Google
 *   2. Full interactive dashboard (iframe) — showcases product capabilities
 *   3. Article content (exec summary, findings, methodology) — SEO body text
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

    // ─── Entry Point ───
    function init() {
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
        const projectName = d.project_name || d.title || 'Research Report';
        const execSummary = toBulletArray(d.executive_summary);
        const kpiCards = d.kpi_cards || [];
        const keyTakeaways = toBulletArray(d.key_takeaways);
        const overallInsights = toBulletArray(d.overall_insights);
        const tabs = d.tabs || [];
        const methodNote = d.methodology_note || '';
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
                        const val = (kpi.value != null ? kpi.value : '') + (kpi.suffix || '');
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
                    <ul>${keyTakeaways.map(function (item) {
                        const text = typeof item === 'string' ? item : (item.text || item.point || '');
                        return '<li>' + escHtml(text) + '</li>';
                    }).join('')}</ul>
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
