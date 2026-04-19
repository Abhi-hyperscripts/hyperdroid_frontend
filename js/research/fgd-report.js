// FGD report — dashboard layout (Sprint 7.5).
//   Left sidebar nav + tab-swap sections in the main pane. Reads
//   report_json v1.0 directly (schema locked in Sprint 5b). All data
//   flows through textContent / createElement — no innerHTML on
//   transcript data.
//
//   Sections (8):
//     1. Overview   — KPIs + exec summary + pull quote
//     2. Analytics  — prevalence, consensus, sentiment, heatmap
//     3. Themes     — accordion with prevalence + narrative + quotes
//     4. Cross-session — universals, divergences, narratives
//     5. Speaker dynamics — donuts + bars + sentiment flow
//     6. Moderator gaps — under-probed + missed signals
//     7. Verbatim — filterable quote grid
//     8. Appendix — codeframe + token audit

const jobId = new URLSearchParams(location.search).get('job_id');
if (!jobId) {
    document.body.innerHTML = '<div style="padding:40px; text-align:center; color:var(--color-error);">Missing job_id in URL.</div>';
    throw new Error('missing job_id');
}

const STAGE_LABEL = {
    queued:        'Queued',
    chunking:      'Assembling transcripts',
    coding:        'Coding chunks',
    synthesizing:  'Building codeframe',
    recoding:      'Applying codeframe',
    writing:       'Drafting theme writeups',
    rollup:        'Cross-session + moderator gaps',
    summarizing:   'Writing executive summary',
    done:          'Report ready',
    failed:        'Report failed',
    cancelled:     'Cancelled',
};

const SECTIONS = [
    { id: 'overview',  label: 'Overview',         num: '1' },
    { id: 'analytics', label: 'Analytics',        num: '2' },
    { id: 'themes',    label: 'Themes',           num: '3' },
    { id: 'cross',     label: 'Cross-session',    num: '4' },
    { id: 'speakers',  label: 'Speaker dynamics', num: '5' },
    { id: 'gaps',      label: 'Moderator gaps',   num: '6' },
    { id: 'verbatim',  label: 'Verbatim',         num: '7' },
    { id: 'appendix',  label: 'Codeframe',        num: '8' },
];

let currentReport = null;   // stored once loaded — used by share + PPT
let currentJob = null;

// ═══════════════════════════════════════════════════════════════════════
// DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════

function el(tag, opts = {}, ...children) {
    const e = document.createElement(tag);
    if (opts.className) e.className = opts.className;
    if (opts.id) e.id = opts.id;
    if (opts.text !== undefined) e.textContent = opts.text;
    if (opts.href) e.href = opts.href;
    if (opts.title) e.title = opts.title;
    if (opts.onclick) e.addEventListener('click', opts.onclick);
    if (opts.style) for (const [k, v] of Object.entries(opts.style)) e.style[k] = v;
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
    for (const child of children) {
        if (child === null || child === undefined) continue;
        e.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return e;
}
function card(...children) { return el('div', { className: 'dash-card' }, ...children); }

function fmtTime(ms) {
    const s = Math.floor((ms || 0) / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${ss.toString().padStart(2, '0')}`;
}
function formatTotalTime(sec) {
    const m = Math.floor((sec || 0) / 60);
    const s = Math.round((sec || 0) % 60);
    return `${m}m ${s}s`;
}
function sentimentClass(s) {
    return s === 'positive' ? 'pos' : s === 'negative' ? 'neg' : s === 'mixed' ? 'split' : 'neutral';
}
function stripQuoteIds(text) {
    if (!text) return '';
    return String(text)
        .replace(/\s*\(\s*q_[0-9a-f]+_\d+(?:\s*,\s*q_[0-9a-f]+_\d+)*\s*\)/gi, '')
        .replace(/\bq_[0-9a-f]+_\d+\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.;:])/g, '$1')
        .trim();
}

// ═══════════════════════════════════════════════════════════════════════
// PROGRESS VIEW (fullscreen overlay while job is in-flight)
// ═══════════════════════════════════════════════════════════════════════

function setStage(stage, progress, message) {
    const stageLabel = document.getElementById('stageLabel');
    if (!stageLabel) return;
    stageLabel.textContent = (stage || 'processing').toUpperCase();
    document.getElementById('stageTitle').textContent = STAGE_LABEL[stage] || 'Processing';
    const pct = Math.max(0, Math.min(100, Number(progress) || 0));
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPct').textContent = pct;
    document.getElementById('progressStatus').textContent = message || stage || '—';
}

function showError(msg) {
    const box = document.getElementById('errorBox');
    box.textContent = msg || 'Unknown error';
    box.style.display = 'block';
    document.getElementById('retryBtn').style.display = 'inline-flex';
}

function showDashboard() {
    document.getElementById('statusView').style.display = 'none';
    document.getElementById('dashShell').style.display = 'grid';
}

// ═══════════════════════════════════════════════════════════════════════
// CHART HELPERS (ApexCharts)
// ═══════════════════════════════════════════════════════════════════════

const CHART_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const CHART_BRAND = getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim() || '#6366f1';
const CHART_SUCCESS = '#10b981';
const CHART_ERROR = '#ef4444';
const CHART_WARNING = '#f59e0b';
const CHART_NEUTRAL = '#64748b';

function currentChartTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function baseChartOptions() {
    return {
        chart: {
            fontFamily: CHART_FONT, background: 'transparent',
            toolbar: { show: false },
            animations: { enabled: true, easing: 'easeinout', speed: 500 },
        },
        theme: { mode: currentChartTheme() },
        grid: { borderColor: 'rgba(128,128,128,0.12)', strokeDashArray: 3 },
        tooltip: { theme: currentChartTheme(), style: { fontSize: '12px' } },
        legend: { labels: { colors: 'var(--text-primary)' } },
    };
}
function mountChart(host, options) {
    if (typeof ApexCharts === 'undefined') {
        host.appendChild(el('div', { className: 'empty-note', text: 'Charts unavailable (offline).' }));
        return;
    }
    try { new ApexCharts(host, options).render(); }
    catch (e) {
        console.warn('[fgd-report] chart render failed', e);
        host.appendChild(el('div', { className: 'empty-note', text: 'Chart failed to render.' }));
    }
}
function shade(hex, pct) {
    let c = (hex || '#6366f1').replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    let r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const adj = (v) => Math.max(0, Math.min(255, Math.round(v + (pct * 2.55))));
    r = adj(r); g = adj(g); b = adj(b);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD SHELL SETUP
// ═══════════════════════════════════════════════════════════════════════

function buildDashboard(job) {
    currentReport = job.report_json;
    currentJob = job;
    showDashboard();

    const rj = job.report_json || {};
    const md = rj.study_metadata || {};

    // Sidebar header
    document.getElementById('dashProjectName').textContent = md.project_name || 'FGD Report';
    const metaBits = [];
    metaBits.push(`${md.sessions || 0} session${(md.sessions || 0) === 1 ? '' : 's'}`);
    metaBits.push(`${md.speakers || 0} speakers`);
    if (md.date_range && (md.date_range.start || md.date_range.end)) {
        metaBits.push(`${md.date_range.start || '?'} → ${md.date_range.end || '?'}`);
    }
    document.getElementById('dashProjectMeta').textContent = metaBits.join(' · ');
    document.getElementById('dashBack').href = `focus-group-detail.html?id=${encodeURIComponent(job.project_id)}`;
    document.getElementById('dashGenerated').textContent = rj.generated_at
        ? `Generated ${new Date(rj.generated_at).toLocaleString()}`
        : '';

    // Build sidebar nav
    const nav = document.getElementById('dashNav');
    nav.innerHTML = '';
    for (const s of SECTIONS) {
        const btn = el('button', {
            className: 'dash-nav-item',
            onclick: () => activateSection(s.id),
            attrs: { 'data-section': s.id },
        },
            el('span', { className: 'dash-nav-num', text: s.num }),
            el('span', { className: 'dash-nav-label', text: s.label }),
        );
        nav.appendChild(btn);
    }

    // Build all sections (hidden by default; activateSection toggles)
    const content = document.getElementById('dashContent');
    content.innerHTML = '';
    // Quote map (resolves representative_quote_ids + pull_quote_id)
    const quoteMap = {};
    for (const q of (rj.quotes || [])) quoteMap[q.quote_id] = q;

    // Builders return arrays of child nodes; spread into sectionShell so
    // each ends up as an actual child rather than an array wrapper.
    content.appendChild(sectionShell('overview',  ...buildOverviewSection(rj, quoteMap)));
    content.appendChild(sectionShell('analytics', ...buildAnalyticsSection(rj)));
    content.appendChild(sectionShell('themes',    ...buildThemesSection(rj, quoteMap)));
    content.appendChild(sectionShell('cross',     ...buildCrossSection(rj)));
    content.appendChild(sectionShell('speakers',  ...buildSpeakersSection(rj)));
    content.appendChild(sectionShell('gaps',      ...buildGapsSection(rj)));
    content.appendChild(sectionShell('verbatim',  ...buildVerbatimSection(rj, quoteMap)));
    content.appendChild(sectionShell('appendix',  ...buildAppendixSection(rj)));

    // Action buttons
    document.getElementById('btnShare').onclick = onShareClick;
    document.getElementById('btnDownloadPPT').onclick = onDownloadPPT;
    const btnTheme = document.getElementById('btnThemeToggle');
    if (btnTheme) {
        btnTheme.onclick = () => {
            const cur = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = cur === 'dark' ? 'light' : 'dark';
            if (typeof Theme !== 'undefined' && Theme.setMode) {
                Theme.setMode(next);
            } else {
                document.documentElement.setAttribute('data-theme', next);
                try { localStorage.setItem('theme-mode', next); } catch (e) {}
            }
            // Remount ApexCharts so they pick up new theme colors
            setTimeout(() => {
                if (currentJob && currentJob.report_json) {
                    buildDashboard(currentJob);
                }
            }, 0);
        };
    }

    // Hamburger toggle — sidebar state persists across desktop
    // reloads. On mobile we always start collapsed regardless of
    // stored preference so the content is visible first.
    const btnHam = document.getElementById('btnHamburger');
    const shell = document.getElementById('dashShell');
    const backdrop = document.getElementById('dashBackdrop');
    const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
    const storedCollapsed = localStorage.getItem('fgd-sidebar-collapsed') === '1';
    if (isMobile() || storedCollapsed) shell.classList.add('collapsed');

    const toggleSidebar = () => {
        shell.classList.toggle('collapsed');
        if (!isMobile()) {
            localStorage.setItem('fgd-sidebar-collapsed', shell.classList.contains('collapsed') ? '1' : '0');
        }
        // ApexCharts need a resize ping whenever layout width shifts
        setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
    };
    if (btnHam) btnHam.onclick = toggleSidebar;
    if (backdrop) backdrop.onclick = toggleSidebar;

    // When viewport crosses the 900px boundary, recompute default
    // state so the UX matches the form factor (desktop: sidebar in,
    // mobile: overlay closed).
    window.addEventListener('resize', () => {
        if (isMobile() && !shell.classList.contains('collapsed')) {
            shell.classList.add('collapsed');
        }
    });

    // On mobile, clicking a nav item should also close the overlay.
    for (const item of document.querySelectorAll('.dash-nav-item')) {
        item.addEventListener('click', () => {
            if (isMobile() && !shell.classList.contains('collapsed')) {
                shell.classList.add('collapsed');
            }
        });
    }

    // Respect #hash on first load, else default to overview
    const initial = (location.hash || '').replace('#', '') || 'overview';
    activateSection(SECTIONS.some(s => s.id === initial) ? initial : 'overview');
}

function sectionShell(id, ...children) {
    return el('div', { className: 'dash-section', id: `section-${id}` }, ...children);
}

function activateSection(id) {
    const section = SECTIONS.find(s => s.id === id) || SECTIONS[0];
    for (const btn of document.querySelectorAll('.dash-nav-item')) {
        btn.classList.toggle('active', btn.getAttribute('data-section') === section.id);
    }
    for (const sec of document.querySelectorAll('.dash-section')) {
        sec.classList.toggle('active', sec.id === `section-${section.id}`);
    }
    document.getElementById('sectionTitle').textContent = section.label;
    document.getElementById('sectionSub').textContent = sectionSub(section.id);
    history.replaceState(null, '', `#${section.id}`);
    // Scroll main content to top on section change
    document.getElementById('dashContent').scrollTop = 0;
    // Many ApexCharts need a resize ping after becoming visible
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

function sectionSub(id) {
    const rj = currentReport || {};
    const md = rj.study_metadata || {};
    switch (id) {
        case 'overview':  return `${rj.themes?.length || 0} themes · ${rj.quotes?.length || 0} quotes`;
        case 'analytics': return 'Visual summary across all themes';
        case 'themes':    return `${rj.themes?.length || 0} themes ranked by prevalence`;
        case 'cross':     return md.sessions > 1 ? `Comparing ${md.sessions} sessions` : 'Single-session — limited';
        case 'speakers':  return `${md.speakers || 0} participants across ${md.sessions || 0} sessions`;
        case 'gaps':      return 'What to probe next time';
        case 'verbatim':  return `${rj.quotes?.length || 0} quotes filterable by theme, sentiment, search`;
        case 'appendix':  return 'All themes with sub-themes and raw codes';
    }
    return '';
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION BUILDERS
// ═══════════════════════════════════════════════════════════════════════

// ── Overview — KPI row + exec/pull-quote two-column + theme preview ─
function buildOverviewSection(rj, quoteMap) {
    const md = rj.study_metadata || {};
    const audit = rj.token_audit || {};
    const es = rj.executive_summary || {};
    const themes = rj.themes || [];

    // Compute a few derived KPIs for richer dashboard feel.
    // Dominant sentiment = sentiment label with highest share across all themes.
    const sentTotals = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    let totalAssigns = 0;
    for (const t of themes) {
        const sb = t.sentiment_breakdown || {};
        for (const k of Object.keys(sentTotals)) sentTotals[k] += (sb[k] || 0) * (t.prevalence?.speakers || 1);
        totalAssigns += (t.prevalence?.speakers || 0);
    }
    const dominantSent = Object.entries(sentTotals).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
    const universalCount = themes.filter(t => t.consensus_level === 'universal').length;

    const kpiRow = el('div', { className: 'kpi-row' },
        kpi(md.sessions ?? 0,  'Sessions',          `${md.total_utterances ?? 0} utterances`),
        kpi(md.speakers ?? 0,  'Speakers',          `${(rj.speaker_dynamics || []).reduce((s, d) => s + (d.silent_voices || []).length, 0)} silent voices`),
        kpi(themes.length,     'Themes',            `${universalCount} universal · ${themes.filter(t => t.consensus_level === 'split').length} split`),
        kpi(rj.quotes?.length ?? 0, 'Quotes',       'materialised from transcripts'),
        kpi(titleCase(dominantSent[0]), 'Dominant sentiment', `${Math.round((dominantSent[1] / (totalAssigns || 1)) * 100)}% weighted`, sentimentKpiClass(dominantSent[0])),
    );

    // Exec summary bullets
    const bulletsUl = el('ul', { className: 'exec-bullets' });
    for (const b of (es.bullets || [])) {
        const li = el('li', {}, stripQuoteIds(b.text || ''));
        const wrap = el('span', { className: 'bullet-themes' });
        for (const tid of (b.supporting_theme_ids || [])) {
            wrap.appendChild(el('a', {
                className: 'badge', href: '#themes', text: tid,
                onclick: (e) => { e.preventDefault(); activateSection('themes'); scrollToTheme(tid); },
            }));
        }
        if ((b.supporting_theme_ids || []).length) li.appendChild(wrap);
        bulletsUl.appendChild(li);
    }

    const execCard = card(
        el('div', { className: 'dash-card-header' },
            el('div', { className: 'dash-card-title', text: 'Executive summary' }),
            el('div', { className: 'dash-card-sub', text: `${(es.bullets || []).length} findings` }),
        ),
        bulletsUl,
    );

    const pull = quoteMap[es.pull_quote_id];
    const sideCard = card(
        el('div', { className: 'dash-card-header' },
            el('div', { className: 'dash-card-title', text: 'Pull quote' }),
        ),
    );
    if (pull) {
        const pq = el('div', { className: 'pull-quote' });
        pq.appendChild(document.createTextNode('"' + (pull.text || '') + '"'));
        pq.appendChild(el('span', {
            className: 'pull-quote-attr',
            text: `— ${pull.speaker_id || 'unknown'} · ${pull.session_title || pull.session_id || ''}${pull.t_start_ms ? ' · ' + fmtTime(pull.t_start_ms) : ''}`,
        }));
        sideCard.appendChild(pq);
    } else {
        sideCard.appendChild(el('div', { className: 'empty-note', text: 'No pull quote selected.' }));
    }

    // Top 5 themes as a preview (click → themes tab)
    const topThemes = themes.slice(0, 5);
    const previewRows = el('div');
    for (const t of topThemes) {
        const p = t.prevalence || {};
        const prevPct = p.total_speakers > 0 ? (p.speakers / p.total_speakers) * 100 : 0;
        previewRows.appendChild(el('div', {
            style: { display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) 110px 110px', gap: '16px', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-primary)', cursor: 'pointer', fontSize: '13px' },
            onclick: () => { activateSection('themes'); scrollToTheme(t.theme_id); },
        },
            el('span', { className: 'badge', text: t.theme_id }),
            el('span', { text: t.name || '', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontWeight: '500' } }),
            el('span', { className: 'badge ' + (t.consensus_level || 'minority'), text: t.consensus_level || '—' }),
            el('span', { style: { color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' },
                text: `${p.speakers || 0}/${p.total_speakers || 0} spk` }),
        ));
    }
    const topCard = card(
        el('div', { className: 'dash-card-header' },
            el('div', { className: 'dash-card-title', text: 'Top themes' }),
            el('div', { className: 'dash-card-sub', text: 'by speaker prevalence' }),
        ),
        previewRows,
    );

    return [kpiRow, execCard, sideCard, topCard];
}

function kpi(val, lbl, sub, cls) {
    return el('div', { className: 'kpi' + (cls ? ' ' + cls : '') },
        el('div', { className: 'kpi-lbl', text: lbl }),
        el('div', { className: 'kpi-val', text: String(val) }),
        sub ? el('div', { className: 'kpi-sub', text: sub }) : null,
    );
}
function titleCase(s) { return (s || '').charAt(0).toUpperCase() + (s || '').slice(1); }
function sentimentKpiClass(s) { return s === 'positive' ? 'success' : s === 'negative' ? 'error' : s === 'mixed' ? 'warning' : ''; }

// ── Analytics ───────────────────────────────────────────────────────
function buildAnalyticsSection(rj) {
    const themes = (rj.themes || []).filter(t => (t.prevalence?.speakers ?? 0) > 0);
    if (themes.length === 0) {
        return [card(el('div', { className: 'empty-note', text: 'No theme data to visualise.' }))];
    }
    const children = [];
    const grid = el('div', { className: 'chart-grid' });

    // Prevalence bar — wide (7 cols)
    const prevCard = el('div', { className: 'chart-card span-7' },
        el('div', { className: 'chart-card-title', text: 'Theme prevalence (distinct speakers)' }),
    );
    const prevHost = el('div', { className: 'chart-host-tall' });
    prevCard.appendChild(prevHost);
    grid.appendChild(prevCard);
    setTimeout(() => mountPrevalenceChart(prevHost, themes), 0);

    // Consensus donut — narrow (5 cols)
    const conCard = el('div', { className: 'chart-card span-5' },
        el('div', { className: 'chart-card-title', text: 'Consensus level distribution' }),
    );
    const conHost = el('div', { className: 'chart-host-sm' });
    conCard.appendChild(conHost);
    grid.appendChild(conCard);
    setTimeout(() => mountConsensusDonut(conHost, themes), 0);

    // Sentiment stacked bar — full width
    const sentCard = el('div', { className: 'chart-card span-12' },
        el('div', { className: 'chart-card-title', text: 'Sentiment composition per theme' }),
    );
    const sentHost = el('div', { className: 'chart-host-tall' });
    sentCard.appendChild(sentHost);
    grid.appendChild(sentCard);
    setTimeout(() => mountSentimentStackedBar(sentHost, themes), 0);

    // Heatmap — full width, only for multi-session
    const sessions = rj.study_metadata?.session_titles || [];
    if (sessions.length >= 2) {
        const hmCard = el('div', { className: 'chart-card span-12' },
            el('div', { className: 'chart-card-title', text: 'Theme × session speaker coverage' }),
        );
        const hmHost = el('div', { className: 'chart-host-tall' });
        hmCard.appendChild(hmHost);
        grid.appendChild(hmCard);
        setTimeout(() => mountPrevalenceHeatmap(hmHost, themes, sessions), 0);
    }

    children.push(card(grid));
    return children;
}
function mountPrevalenceChart(host, themes) {
    const sorted = [...themes].sort((a, b) => (b.prevalence?.speakers ?? 0) - (a.prevalence?.speakers ?? 0));
    const maxTotal = Math.max(...sorted.map(t => t.prevalence?.total_speakers ?? 0), 1);
    const opts = Object.assign(baseChartOptions(), {
        chart: Object.assign(baseChartOptions().chart, { type: 'bar', height: Math.max(300, sorted.length * 24 + 40) }),
        series: [{ name: 'Speakers', data: sorted.map(t => ({
            x: `${t.theme_id} · ${t.name || ''}`, y: t.prevalence?.speakers ?? 0,
        })) }],
        plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: true } },
        dataLabels: {
            enabled: true, offsetX: 8,
            style: { colors: ['var(--text-primary)'], fontSize: '11px', fontWeight: 600 },
            formatter: (v, { dataPointIndex }) => `${v} / ${sorted[dataPointIndex].prevalence?.total_speakers ?? 0}`,
        },
        xaxis: { labels: { style: { colors: 'var(--text-secondary)', fontSize: '11px' } }, max: maxTotal },
        yaxis: { labels: { style: { colors: 'var(--text-primary)', fontSize: '11px' } } },
        legend: { show: false },
        colors: sorted.map((_, i) => shade(CHART_BRAND, -20 + (i * 5))),
        tooltip: Object.assign(baseChartOptions().tooltip, { y: { formatter: v => `${v} speakers` } }),
    });
    mountChart(host, opts);
}
function mountConsensusDonut(host, themes) {
    const counts = { universal: 0, majority: 0, split: 0, minority: 0 };
    for (const t of themes) { const k = t.consensus_level || 'minority'; if (counts[k] !== undefined) counts[k]++; }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) { host.appendChild(el('div', { className: 'empty-note', text: 'No consensus data.' })); return; }
    const opts = Object.assign(baseChartOptions(), {
        chart: Object.assign(baseChartOptions().chart, { type: 'donut', height: 300 }),
        series: Object.values(counts), labels: Object.keys(counts),
        colors: [CHART_SUCCESS, CHART_BRAND, CHART_WARNING, CHART_NEUTRAL],
        legend: { position: 'bottom', labels: { colors: 'var(--text-primary)' } },
        dataLabels: { enabled: true, style: { fontSize: '12px', fontWeight: 600 } },
        plotOptions: { pie: { donut: { size: '62%', labels: {
            show: true,
            total: { show: true, label: 'themes', color: 'var(--text-primary)', formatter: () => String(total) },
            value: { color: 'var(--text-primary)' }, name: { color: 'var(--text-secondary)' },
        } } } },
        tooltip: Object.assign(baseChartOptions().tooltip, { y: { formatter: v => `${v} themes` } }),
    });
    mountChart(host, opts);
}
function mountSentimentStackedBar(host, themes) {
    const sorted = [...themes].sort((a, b) => (b.prevalence?.speakers ?? 0) - (a.prevalence?.speakers ?? 0));
    const cats = sorted.map(t => `${t.theme_id} · ${(t.name || '').substring(0, 30)}`);
    const pct = (t, k) => Math.round(((t.sentiment_breakdown || {})[k] || 0) * 100);
    const opts = Object.assign(baseChartOptions(), {
        chart: Object.assign(baseChartOptions().chart, {
            type: 'bar', stacked: true, stackType: '100%',
            height: Math.max(320, sorted.length * 26 + 80),
        }),
        series: [
            { name: 'Positive', data: sorted.map(t => pct(t, 'positive')) },
            { name: 'Mixed',    data: sorted.map(t => pct(t, 'mixed')) },
            { name: 'Neutral',  data: sorted.map(t => pct(t, 'neutral')) },
            { name: 'Negative', data: sorted.map(t => pct(t, 'negative')) },
        ],
        plotOptions: { bar: { horizontal: true, borderRadius: 3 } },
        colors: [CHART_SUCCESS, CHART_WARNING, CHART_NEUTRAL, CHART_ERROR],
        xaxis: { categories: cats, labels: { style: { colors: 'var(--text-secondary)' }, formatter: v => `${v}%` } },
        yaxis: { labels: { style: { colors: 'var(--text-primary)', fontSize: '11px' } } },
        legend: { position: 'top', labels: { colors: 'var(--text-primary)' } },
        dataLabels: { enabled: false },
        tooltip: Object.assign(baseChartOptions().tooltip, { y: { formatter: v => `${v}%` } }),
    });
    mountChart(host, opts);
}
function mountPrevalenceHeatmap(host, themes, sessions) {
    const sorted = [...themes].sort((a, b) => (b.prevalence?.speakers ?? 0) - (a.prevalence?.speakers ?? 0));
    const series = sorted.map(t => {
        const bySession = new Map();
        for (const ps of (t.per_session || [])) bySession.set(ps.session_id, ps);
        return {
            name: `${t.theme_id} · ${(t.name || '').substring(0, 30)}`,
            data: sessions.map(s => {
                const ps = bySession.get(s.session_id);
                const pct = ps && ps.total_speakers > 0 ? Math.round((ps.speakers / ps.total_speakers) * 100) : 0;
                return { x: s.title || s.session_id.substring(0, 8), y: pct };
            }),
        };
    });
    const opts = Object.assign(baseChartOptions(), {
        chart: Object.assign(baseChartOptions().chart, { type: 'heatmap', height: Math.max(340, sorted.length * 28 + 80) }),
        series,
        dataLabels: { enabled: true, style: { colors: ['#ffffff'], fontSize: '11px' } },
        colors: [CHART_BRAND],
        plotOptions: { heatmap: {
            shadeIntensity: 0.6, radius: 4, useFillColorAsStroke: false,
            colorScale: {
                ranges: [
                    { from: 0,  to: 0,   color: 'rgba(100,116,139,0.12)', name: 'none' },
                    { from: 1,  to: 25,  color: 'rgba(99,102,241,0.25)',  name: 'low'  },
                    { from: 26, to: 50,  color: 'rgba(99,102,241,0.5)',   name: 'mid'  },
                    { from: 51, to: 75,  color: 'rgba(99,102,241,0.75)',  name: 'high' },
                    { from: 76, to: 100, color: 'rgba(99,102,241,1)',     name: 'dominant' },
                ],
            },
        } },
        yaxis: { labels: { style: { colors: 'var(--text-primary)', fontSize: '11px' } } },
        xaxis: { labels: { style: { colors: 'var(--text-secondary)', fontSize: '11px' } } },
        tooltip: Object.assign(baseChartOptions().tooltip, { y: { formatter: v => `${v}% speakers` } }),
    });
    mountChart(host, opts);
}

// ── Themes (dense table-like list with inline prevalence + sentiment) ─
function buildThemesSection(rj, quoteMap) {
    const themes = rj.themes || [];
    if (themes.length === 0) {
        return [card(el('div', { className: 'empty-note', text: 'No themes.' }))];
    }
    const list = el('div', { className: 'theme-list' });
    for (const theme of themes) {
        const acc = el('div', { className: 'theme-accordion', attrs: { 'data-theme-id': theme.theme_id } });
        const header = el('div', { className: 'theme-accordion-header', onclick: () => acc.classList.toggle('open') });
        header.appendChild(el('span', { className: 'theme-accordion-rank', text: String(theme.rank ?? '·') }));

        // Title + meta (consensus level)
        const titleWrap = el('div', { className: 'theme-accordion-title' });
        titleWrap.appendChild(el('div', { className: 'theme-accordion-name', text: theme.name || '(unnamed)' }));
        titleWrap.appendChild(el('div', { className: 'theme-accordion-meta',
            text: `${theme.theme_id} · ${theme.consensus_level || 'minority'}`,
        }));
        header.appendChild(titleWrap);

        // Prevalence bar
        const p = theme.prevalence || {};
        const prevPct = p.total_speakers > 0 ? (p.speakers / p.total_speakers) * 100 : 0;
        const prevCell = el('div', { className: 'theme-accordion-bar' });
        const prevBar = el('div', { className: 'theme-prev-bar' });
        prevBar.appendChild(el('span', { style: { width: prevPct + '%' } }));
        prevCell.appendChild(prevBar);
        prevCell.appendChild(el('span', { text: `${p.speakers || 0}/${p.total_speakers || 0}` }));
        header.appendChild(prevCell);

        // Sentiment mini-bar
        const sb = theme.sentiment_breakdown || {};
        const totalSent = (sb.positive || 0) + (sb.negative || 0) + (sb.neutral || 0) + (sb.mixed || 0);
        const sentCell = el('div', { className: 'theme-accordion-sentiment' });
        if (totalSent > 0) {
            const add = (cls, v) => { if (v) sentCell.appendChild(el('span', { className: cls, style: { width: (v * 100) + '%' } })); };
            add('pos', sb.positive || 0); add('mix', sb.mixed || 0); add('neu', sb.neutral || 0); add('neg', sb.negative || 0);
        }
        header.appendChild(sentCell);

        header.appendChild(el('span', { className: 'theme-accordion-arrow', text: '▶' }));
        acc.appendChild(header);

        const body = el('div', { className: 'theme-accordion-body' });

        // Sentiment legend only — the header already shows the mini-bar visualisation.
        if (totalSent > 0) {
            const legend = el('div', { className: 'sentiment-legend', style: { marginTop: '8px' } });
            const pctv = v => Math.round((v || 0) * 100) + '%';
            legend.appendChild(el('span', { text: `Positive ${pctv(sb.positive)}` }));
            legend.appendChild(el('span', { text: `Negative ${pctv(sb.negative)}` }));
            legend.appendChild(el('span', { text: `Neutral ${pctv(sb.neutral)}` }));
            legend.appendChild(el('span', { text: `Mixed ${pctv(sb.mixed)}` }));
            body.appendChild(legend);
        }

        body.appendChild(el('div', { style: { marginTop: '16px' } },
            el('div', { className: 'tensions-hdr', text: 'DEFINITION' }),
            el('p', { className: 'slide-body', text: stripQuoteIds(theme.definition || '') }),
        ));
        body.appendChild(el('div', { style: { marginTop: '14px' } },
            el('div', { className: 'tensions-hdr', text: 'SUMMARY' }),
            el('p', { className: 'slide-body', text: stripQuoteIds(theme.summary || '') }),
        ));
        if ((theme.tensions || []).length > 0) {
            const tWrap = el('div', { style: { marginTop: '14px' } });
            tWrap.appendChild(el('div', { className: 'tensions-hdr', text: 'TENSIONS' }));
            const ul = el('ul', { style: { margin: 0, paddingLeft: '18px' } });
            for (const t of theme.tensions) ul.appendChild(el('li', { text: stripQuoteIds(t) }));
            tWrap.appendChild(ul);
            body.appendChild(tWrap);
        }
        if ((theme.representative_quote_ids || []).length > 0) {
            const qWrap = el('div', { style: { marginTop: '14px' } });
            qWrap.appendChild(el('div', { className: 'tensions-hdr', text: `REPRESENTATIVE QUOTES (${theme.quote_count || theme.representative_quote_ids.length})` }));
            for (const qid of theme.representative_quote_ids) {
                const q = quoteMap[qid];
                qWrap.appendChild(q ? renderQuoteCard(q) : el('div', { className: 'empty-note', text: `[${qid} not resolved]` }));
            }
            body.appendChild(qWrap);
        }

        acc.appendChild(body);
        list.appendChild(acc);
    }
    return [list];
}
function renderQuoteCard(q) {
    return el('div', { className: 'quote-card' },
        el('div', { className: 'qtext', text: (q.text || '') }),
        el('div', { className: 'qmeta' },
            el('span', { className: 'qspeaker', text: q.speaker_id || 'unknown' }),
            el('span', { className: 'qsentiment ' + (q.sentiment || 'neutral'), text: q.sentiment || '—' }),
            el('span', { className: 'qtime', text: q.t_start_ms ? fmtTime(q.t_start_ms) : '' }),
            el('span', { text: q.session_title || q.session_id || '' }),
        ),
    );
}
function scrollToTheme(themeId) {
    setTimeout(() => {
        const acc = document.querySelector(`.theme-accordion[data-theme-id="${themeId}"]`);
        if (!acc) return;
        acc.classList.add('open');
        acc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
}

// ── Cross-session ───────────────────────────────────────────────────
function buildCrossSection(rj) {
    const cs = rj.cross_session;
    if (!cs) {
        return [card(el('div', { className: 'empty-note',
            text: 'Single-session report — cross-session analysis requires 2 or more sessions.' }))];
    }
    const children = [];

    if ((cs.universals || []).length > 0) {
        const row = el('div', { className: 'badge-row' });
        for (const tid of cs.universals) {
            row.appendChild(el('a', {
                className: 'badge universal', text: `${tid} · universal`,
                href: '#themes',
                onclick: (e) => { e.preventDefault(); activateSection('themes'); scrollToTheme(tid); },
            }));
        }
        children.push(card(
            el('div', { className: 'dash-card-header' },
                el('div', { className: 'dash-card-title', text: 'Universals' }),
                el('div', { className: 'dash-card-sub', text: `${cs.universals.length} theme${cs.universals.length === 1 ? '' : 's'} raised in every session` }),
            ),
            row,
        ));
    }

    if ((cs.divergences || []).length > 0) {
        const list = el('div');
        for (const d of cs.divergences) {
            const c = el('div', { className: 'quote-card warn' });
            const meta = el('div', { className: 'qmeta', style: { marginTop: 0, marginBottom: '6px' } });
            meta.appendChild(el('a', {
                className: 'badge', text: d.theme_id,
                href: '#themes',
                onclick: (e) => { e.preventDefault(); activateSection('themes'); scrollToTheme(d.theme_id); },
            }));
            for (const sid of (d.dominant_session_ids || [])) {
                const title = (rj.study_metadata?.session_titles || []).find(s => s.session_id === sid)?.title || sid;
                meta.appendChild(el('span', { className: 'badge neutral', text: 'dominant in ' + title }));
            }
            c.appendChild(meta);
            c.appendChild(el('div', { className: 'qtext', text: stripQuoteIds(d.pattern || '') }));
            list.appendChild(c);
        }
        children.push(card(
            el('div', { className: 'dash-card-header' },
                el('div', { className: 'dash-card-title', text: 'Divergences' }),
                el('div', { className: 'dash-card-sub', text: `${cs.divergences.length} theme${cs.divergences.length === 1 ? '' : 's'} notably stronger in some sessions` }),
            ),
            list,
        ));
    }

    if ((cs.session_narratives || []).length > 0) {
        const list = el('div');
        for (const n of cs.session_narratives) {
            const title = n.session_title || (rj.study_metadata?.session_titles || []).find(s => s.session_id === n.session_id)?.title || n.session_id;
            list.appendChild(el('div', { className: 'quote-card' },
                el('div', { className: 'qtext', text: stripQuoteIds(n.narrative || '') }),
                el('div', { className: 'qmeta' }, el('span', { text: title })),
            ));
        }
        children.push(card(
            el('div', { className: 'dash-card-header' },
                el('div', { className: 'dash-card-title', text: 'Session character' }),
                el('div', { className: 'dash-card-sub', text: 'One-paragraph take per session' }),
            ),
            list,
        ));
    }
    return children;
}

// ── Speaker dynamics ────────────────────────────────────────────────
function buildSpeakersSection(rj) {
    const dyn = rj.speaker_dynamics || [];
    if (dyn.length === 0) {
        return [card(el('div', { className: 'empty-note', text: 'No speaker-dynamics data.' }))];
    }
    const children = [];
    for (const d of dyn) {
        const inner = [
            el('div', { className: 'dash-card-header' },
                el('div', { className: 'dash-card-title', text: d.session_title || d.session_id }),
                el('div', { className: 'dash-card-sub',
                    text: `${d.participant_count} participants · ${formatTotalTime(d.total_talk_time_sec)} · dominance ${Math.round((d.dominance_index || 0) * 100)}%`,
                }),
            ),
        ];
        const grid = el('div', { className: 'chart-grid' });

        const donutCard = el('div', { className: 'chart-card span-5' }, el('div', { className: 'chart-card-title', text: 'Talk-time share' }));
        const donutHost = el('div', { className: 'chart-host-sm' });
        donutCard.appendChild(donutHost);
        grid.appendChild(donutCard);
        setTimeout(() => mountTalkTimeDonut(donutHost, d), 0);

        const turnsCard = el('div', { className: 'chart-card span-7' }, el('div', { className: 'chart-card-title', text: 'Turn count' }));
        const turnsHost = el('div', { className: 'chart-host-sm' });
        turnsCard.appendChild(turnsHost);
        grid.appendChild(turnsCard);
        setTimeout(() => mountTurnCountBars(turnsHost, d), 0);

        const sessionAssignments = (rj.assignments || []).filter(a => a.session_id === d.session_id);
        if (sessionAssignments.length >= 3) {
            const flowCard = el('div', { className: 'chart-card span-12' },
                el('div', { className: 'chart-card-title', text: 'Sentiment flow across the conversation' }),
            );
            const flowHost = el('div', { className: 'chart-host' });
            flowCard.appendChild(flowHost);
            grid.appendChild(flowCard);
            setTimeout(() => mountSentimentFlow(flowHost, rj, d.session_id), 0);
        }

        inner.push(grid);
        if ((d.silent_voices || []).length > 0) {
            inner.push(el('div', { style: { marginTop: '12px', fontSize: '12px', color: 'var(--color-warning)' },
                text: `⚠ Silent voices (<5% talk-time): ${d.silent_voices.join(', ')}` }));
        }
        children.push(card(...inner));
    }
    return children;
}
function mountTalkTimeDonut(host, d) {
    const entries = Object.entries(d.talk_time_pct || {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) { host.appendChild(el('div', { className: 'empty-note', text: 'No talk-time data.' })); return; }
    const series = entries.map(([_, v]) => Math.round((v || 0) * 100));
    const labels = entries.map(([k]) => k);
    const opts = Object.assign(baseChartOptions(), {
        chart: Object.assign(baseChartOptions().chart, { type: 'donut', height: 280 }),
        series, labels,
        colors: labels.map((_, i) => shade(CHART_BRAND, -30 + (i * 15))),
        legend: { position: 'bottom', fontSize: '11px', labels: { colors: 'var(--text-primary)' } },
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 600 }, formatter: v => `${Math.round(v)}%` },
        plotOptions: { pie: { donut: { size: '60%', labels: {
            show: true,
            total: { show: true, label: 'dominance', color: 'var(--text-primary)', formatter: () => `${Math.round((d.dominance_index || 0) * 100)}%` },
            value: { color: 'var(--text-primary)', formatter: v => `${v}%` },
            name: { color: 'var(--text-secondary)' },
        } } } },
        tooltip: Object.assign(baseChartOptions().tooltip, { y: { formatter: v => `${v}%` } }),
    });
    mountChart(host, opts);
}
function mountTurnCountBars(host, d) {
    const entries = Object.entries(d.turn_count || {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) { host.appendChild(el('div', { className: 'empty-note', text: 'No turn data.' })); return; }
    const opts = Object.assign(baseChartOptions(), {
        chart: Object.assign(baseChartOptions().chart, { type: 'bar', height: 280 }),
        series: [{ name: 'Turns', data: entries.map(e => e[1]) }],
        xaxis: { categories: entries.map(e => e[0]), labels: { style: { colors: 'var(--text-primary)', fontSize: '11px' } } },
        yaxis: { labels: { style: { colors: 'var(--text-secondary)', fontSize: '11px' } } },
        plotOptions: { bar: { borderRadius: 4, distributed: true } },
        colors: entries.map((_, i) => shade(CHART_BRAND, -20 + (i * 12))),
        legend: { show: false },
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 600, colors: ['var(--text-primary)'] } },
    });
    mountChart(host, opts);
}
function mountSentimentFlow(host, rj, sessionId) {
    const sentScore = s => s === 'positive' ? 1 : s === 'negative' ? -1 : 0;
    const quoteByKey = new Map();
    for (const q of (rj.quotes || [])) quoteByKey.set(`${q.session_id}#${q.utterance_index}`, q);
    const pts = (rj.assignments || [])
        .filter(a => a.session_id === sessionId)
        .map(a => {
            const q = quoteByKey.get(`${a.session_id}#${a.utterance_index}`);
            return { t: q?.t_start_ms ?? 0, score: sentScore(a.sentiment) };
        })
        .sort((a, b) => a.t - b.t);
    if (pts.length < 3) { host.appendChild(el('div', { className: 'empty-note', text: 'Not enough timestamped data.' })); return; }
    const window = Math.max(3, Math.floor(pts.length / 20));
    const smoothed = [];
    for (let i = 0; i < pts.length; i++) {
        const from = Math.max(0, i - Math.floor(window / 2));
        const to = Math.min(pts.length, i + Math.ceil(window / 2));
        const slice = pts.slice(from, to);
        smoothed.push([Math.round(pts[i].t / 1000), slice.reduce((s, p) => s + p.score, 0) / slice.length]);
    }
    const opts = Object.assign(baseChartOptions(), {
        chart: Object.assign(baseChartOptions().chart, { type: 'area', height: 240 }),
        series: [{ name: 'Sentiment', data: smoothed }],
        xaxis: { type: 'numeric',
            labels: { style: { colors: 'var(--text-secondary)', fontSize: '11px' },
                formatter: v => `${Math.floor(v / 60)}:${Math.round(v % 60).toString().padStart(2, '0')}` },
            title: { text: 'Time into session', style: { color: 'var(--text-secondary)', fontSize: '11px' } } },
        yaxis: { min: -1, max: 1, tickAmount: 4,
            labels: { style: { colors: 'var(--text-secondary)', fontSize: '11px' },
                formatter: v => v === 1 ? 'positive' : v === -1 ? 'negative' : v === 0 ? 'neutral' : '' } },
        stroke: { curve: 'smooth', width: 2 },
        fill: { type: 'gradient', gradient: { shade: currentChartTheme(), shadeIntensity: 0.3, type: 'vertical',
            colorStops: [
                { offset: 0, color: CHART_SUCCESS, opacity: 0.4 },
                { offset: 50, color: CHART_NEUTRAL, opacity: 0.2 },
                { offset: 100, color: CHART_ERROR, opacity: 0.4 },
            ],
        } },
        colors: [CHART_BRAND],
        markers: { size: 0 },
        dataLabels: { enabled: false },
        annotations: { yaxis: [{ y: 0, borderColor: 'rgba(128,128,128,0.3)', strokeDashArray: 4 }] },
        tooltip: Object.assign(baseChartOptions().tooltip, {
            y: { formatter: v => v > 0.33 ? 'positive' : v < -0.33 ? 'negative' : 'neutral' },
        }),
    });
    mountChart(host, opts);
}

// ── Moderator gaps ──────────────────────────────────────────────────
function buildGapsSection(rj) {
    const mg = rj.moderator_gaps;
    if (!mg || ((mg.gaps || []).length === 0 && (mg.missed_signals || []).length === 0)) {
        return [card(el('div', { className: 'empty-note',
            text: 'No moderator gaps flagged. Either the moderator probed every theme or the stage was skipped.' }))];
    }
    const children = [];

    if ((mg.gaps || []).length > 0) {
        const list = el('div');
        for (const g of mg.gaps) {
            const c = el('div', { className: 'quote-card warn' });
            c.appendChild(el('div', { className: 'qmeta', style: { marginTop: 0, marginBottom: '6px' } },
                el('a', { className: 'badge', text: g.theme_id,
                    href: '#themes',
                    onclick: (e) => { e.preventDefault(); activateSection('themes'); scrollToTheme(g.theme_id); } }),
            ));
            c.appendChild(el('div', { className: 'qtext', text: stripQuoteIds(g.why_gap || '') }));
            c.appendChild(el('div', { style: { marginTop: '8px', color: 'var(--brand-primary)', fontStyle: 'italic', fontSize: '13px' },
                text: '→ ' + (g.suggested_follow_up || '') }));
            list.appendChild(c);
        }
        children.push(card(
            el('div', { className: 'dash-card-header' },
                el('div', { className: 'dash-card-title', text: 'Under-probed themes' }),
                el('div', { className: 'dash-card-sub', text: `${mg.gaps.length} gap${mg.gaps.length === 1 ? '' : 's'}` }),
            ),
            list,
        ));
    }

    if ((mg.missed_signals || []).length > 0) {
        const list = el('div');
        for (const m of mg.missed_signals) {
            const c = el('div', { className: 'quote-card warn' });
            c.appendChild(el('div', { className: 'qtext', text: stripQuoteIds(m.description || '') }));
            const meta = el('div', { className: 'qmeta', style: { marginTop: '6px' } });
            if (m.related_theme_id) meta.appendChild(el('a', { className: 'badge', text: m.related_theme_id,
                href: '#themes',
                onclick: (e) => { e.preventDefault(); activateSection('themes'); scrollToTheme(m.related_theme_id); } }));
            c.appendChild(meta);
            c.appendChild(el('div', { style: { marginTop: '6px', color: 'var(--brand-primary)', fontStyle: 'italic', fontSize: '13px' },
                text: '→ ' + (m.suggested_follow_up || '') }));
            list.appendChild(c);
        }
        children.push(card(
            el('div', { className: 'dash-card-header' },
                el('div', { className: 'dash-card-title', text: 'Missed signals' }),
                el('div', { className: 'dash-card-sub', text: `${mg.missed_signals.length} single-speaker hint${mg.missed_signals.length === 1 ? '' : 's'}` }),
            ),
            list,
        ));
    }
    return children;
}

// ── Verbatim ────────────────────────────────────────────────────────
function buildVerbatimSection(rj, quoteMap) {
    const quotes = rj.quotes || [];
    const themes = rj.themes || [];
    const assignmentsByQid = {};
    for (const a of (rj.assignments || [])) {
        const qid = `q_${(a.session_id || '').replace(/-/g, '')}_${a.utterance_index}`;
        (assignmentsByQid[qid] ||= []).push(a.theme_id);
    }

    const state = { theme: '', sent: '', q: '' };

    const themeContainer = el('div', { className: 'searchable-dropdown-container' });
    const sentContainer = el('div', { className: 'searchable-dropdown-container' });
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search quotes…';
    const countLabel = el('div', { className: 'prev-line' });
    const grid = el('div', { className: 'gallery-grid' });

    const apply = () => {
        grid.innerHTML = '';
        let shown = 0;
        const qLower = (state.q || '').trim().toLowerCase();
        for (const qo of quotes) {
            const qThemes = assignmentsByQid[qo.quote_id] || [];
            if (state.theme && !qThemes.includes(state.theme)) continue;
            if (state.sent && qo.sentiment !== state.sent) continue;
            if (qLower && !(qo.text || '').toLowerCase().includes(qLower)) continue;
            grid.appendChild(renderQuoteCard(qo));
            shown++;
        }
        countLabel.textContent = `${shown} of ${quotes.length} quotes`;
        if (shown === 0) grid.appendChild(el('div', { className: 'empty-note', text: 'No quotes match the current filters.' }));
    };

    searchInput.addEventListener('input', () => { state.q = searchInput.value; apply(); });
    apply();

    setTimeout(() => {
        if (typeof SearchableDropdown === 'undefined') return;
        const themeOpts = [{ value: '', label: 'All themes' }].concat(
            themes.map(t => ({ value: t.theme_id, label: `${t.theme_id} · ${t.name || ''}` }))
        );
        new SearchableDropdown(themeContainer, {
            options: themeOpts,
            value: '',
            placeholder: 'All themes',
            searchPlaceholder: 'Filter themes…',
            onChange: v => { state.theme = v || ''; apply(); },
        });
        const sentOpts = [
            { value: '',         label: 'All sentiments' },
            { value: 'positive', label: 'Positive' },
            { value: 'negative', label: 'Negative' },
            { value: 'neutral',  label: 'Neutral' },
            { value: 'mixed',    label: 'Mixed' },
        ];
        new SearchableDropdown(sentContainer, {
            options: sentOpts,
            value: '',
            placeholder: 'All sentiments',
            searchPlaceholder: 'Filter sentiments…',
            onChange: v => { state.sent = v || ''; apply(); },
        });
    }, 0);

    return [card(
        el('div', { className: 'gallery-filters' }, themeContainer, sentContainer, searchInput, countLabel),
        grid,
    )];
}

// ── Appendix ────────────────────────────────────────────────────────
function buildAppendixSection(rj) {
    const audit = rj.token_audit || {};
    const cf = (rj.codeframe && rj.codeframe.themes) || [];
    const tree = el('div', { className: 'codeframe-tree' });
    for (const t of cf) {
        const head = el('div', { className: 'cf-head' },
            el('span', { className: 'cf-id', text: t.theme_id }),
            el('span', { className: 'cf-name', text: t.name || '' }),
        );
        const def = t.definition
            ? el('div', { className: 'cf-def', text: t.definition })
            : null;

        // Prefer sub_themes (Stage 7b output). Each sub-theme groups N raw
        // codes into one claim with a deterministic speaker count. Falls
        // back to the flat raw_code_labels list if the sub-theming stage
        // didn't run (legacy reports or a cluster_subthemes outage).
        let codesBlock = null;
        const subs = t.sub_themes || [];
        if (subs.length > 0) {
            const hdr = el('div', { className: 'cf-codes-label', text: `Sub-themes (${subs.length})` });
            const subList = el('div', { className: 'cf-subthemes' });
            for (const s of subs) {
                const pct = Math.round((s.coverage_pct || 0) * 100);
                const subCard = el('div', { className: 'cf-subtheme' },
                    el('div', { className: 'cf-subtheme-head' },
                        el('div', { className: 'cf-subtheme-label', text: s.label || '' }),
                        el('div', { className: 'cf-subtheme-stat' },
                            el('span', { className: 'cf-subtheme-count', text: `${s.speakers}/${s.total_speakers} spk` }),
                            el('span', { className: 'cf-subtheme-pct', text: `${pct}%` }),
                        ),
                    ),
                );
                if (s.description) {
                    subCard.appendChild(el('div', { className: 'cf-subtheme-desc', text: s.description }));
                }
                // Bar visualizes the coverage percentage
                const bar = el('div', { className: 'cf-subtheme-bar' },
                    el('span', { style: { width: `${pct}%` } }),
                );
                subCard.appendChild(bar);
                // Raw codes that rolled into this sub-theme
                if ((s.raw_code_labels || []).length) {
                    const chips = el('div', { className: 'cf-subtheme-chips' });
                    for (const c of s.raw_code_labels) {
                        chips.appendChild(el('span', { className: 'cf-code-chip', text: c }));
                    }
                    subCard.appendChild(chips);
                }
                subList.appendChild(subCard);
            }
            codesBlock = el('div', { className: 'cf-codes' }, hdr, subList);
        } else {
            // Legacy / fallback — raw codes as flat pill list
            const codes = t.raw_code_labels || [];
            if (codes.length) {
                const label = el('div', { className: 'cf-codes-label', text: `Codes (${codes.length})` });
                const list = el('div', { className: 'cf-codes-list' });
                for (const c of codes) list.appendChild(el('span', { className: 'cf-code-chip', text: c }));
                codesBlock = el('div', { className: 'cf-codes' }, label, list);
            }
        }
        tree.appendChild(el('div', { className: 'cf-theme' }, head, def, codesBlock));
    }

    return [
        card(
            el('div', { className: 'dash-card-header' },
                el('div', { className: 'dash-card-title', text: 'Codeframe' }),
                el('div', { className: 'dash-card-sub', text: `${cf.length} themes` }),
            ),
            tree,
        ),
    ];
}

// ═══════════════════════════════════════════════════════════════════════
// ACTIONS — Share + Download PPT
// ═══════════════════════════════════════════════════════════════════════

function onShareClick() {
    const url = location.href.split('#')[0];
    navigator.clipboard?.writeText(url).then(() => {
        const t = document.getElementById('copyToast');
        t.textContent = 'Dashboard link copied to clipboard';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2800);
    }).catch(() => {
        alert('Copy this link: ' + url);
    });
}

function onDownloadPPT() {
    if (typeof PptxGenJS === 'undefined') {
        alert('PowerPoint export library failed to load.');
        return;
    }
    if (!currentReport) return;
    const rj = currentReport;
    const md = rj.study_metadata || {};
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';  // 13.3" × 7.5"
    pptx.title = `${md.project_name || 'FGD Report'}`;

    // Design tokens — PPT-safe (no CSS vars)
    const C = {
        brand:     '6366F1',
        brandSoft: 'EEF2FF',
        ink:       '0F172A',
        body:      '334155',
        muted:     '64748B',
        line:      'E2E8F0',
        success:   '10B981',
        error:     'EF4444',
        warning:   'F59E0B',
        neutral:   '94A3B8',
    };
    const FONT = 'Calibri';

    // Quote map (resolves representative_quote_ids + pull_quote_id)
    const quoteMap = {};
    for (const q of (rj.quotes || [])) quoteMap[q.quote_id] = q;

    // Helper: add a consistent slide header (thin brand bar + title + kicker)
    function addHeader(slide, title, kicker) {
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.3, h: 0.12, fill: { color: C.brand }, line: { color: C.brand } });
        if (kicker) {
            slide.addText(kicker.toUpperCase(), {
                x: 0.6, y: 0.35, w: 12, h: 0.25,
                fontSize: 10, bold: true, color: C.brand, fontFace: FONT, charSpacing: 1,
            });
        }
        slide.addText(title, {
            x: 0.6, y: kicker ? 0.6 : 0.4, w: 12, h: 0.6,
            fontSize: 22, bold: true, color: C.ink, fontFace: FONT,
        });
        // Divider
        slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 1.25, w: 12.1, h: 0, line: { color: C.line, width: 0.75 } });
    }

    // Helper: add a subtle slide footer with project + page info
    function addFooter(slide, idx, total) {
        const label = `${md.project_name || 'FGD Report'} · ${idx} / ${total}`;
        slide.addText(label, {
            x: 0.6, y: 7.15, w: 12.1, h: 0.25,
            fontSize: 9, color: C.muted, fontFace: FONT, align: 'right',
        });
    }

    const slides = [];   // collect so we can back-stamp pg numbers

    // ── 1. Cover slide ────────────────────────────────────────────────
    {
        const s = pptx.addSlide();
        s.background = { color: 'FFFFFF' };
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.3, h: 0.6, fill: { color: C.brand }, line: { color: C.brand } });
        s.addText('FOCUS GROUP REPORT', {
            x: 0.6, y: 0.15, w: 10, h: 0.3, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONT, charSpacing: 2,
        });
        s.addText(md.project_name || 'FGD Report', {
            x: 0.6, y: 1.2, w: 12, h: 1.2, fontSize: 40, bold: true, color: C.ink, fontFace: FONT,
        });
        const metaBits = [
            `${md.sessions || 0} session${(md.sessions || 0) === 1 ? '' : 's'}`,
            `${md.speakers || 0} speakers`,
            `${(rj.themes || []).length} themes`,
            `${(rj.quotes || []).length} quotes`,
        ];
        if (md.date_range && (md.date_range.start || md.date_range.end))
            metaBits.push(`${md.date_range.start || '?'} → ${md.date_range.end || '?'}`);
        s.addText(metaBits.join('  ·  '), {
            x: 0.6, y: 2.6, w: 12, h: 0.35, fontSize: 13, color: C.muted, fontFace: FONT,
        });
        // Generated stamp
        s.addText(`Generated ${rj.generated_at ? new Date(rj.generated_at).toLocaleDateString() : ''}`, {
            x: 0.6, y: 6.9, w: 12, h: 0.25, fontSize: 9, color: C.muted, fontFace: FONT, italic: true,
        });
        slides.push(s);
    }

    // ── 2. Executive Summary ──────────────────────────────────────────
    const es = rj.executive_summary || {};
    if ((es.bullets || []).length > 0 || es.pull_quote_id) {
        const s = pptx.addSlide();
        addHeader(s, 'Executive summary', `${(es.bullets || []).length} headline finding${(es.bullets || []).length === 1 ? '' : 's'}`);
        const bullets = (es.bullets || []).map(b => ({
            text: stripQuoteIds(b.text || ''),
            options: { bullet: { type: 'bullet' }, paraSpaceAfter: 8 },
        }));
        s.addText(bullets, {
            x: 0.6, y: 1.45, w: 8.0, h: 4.8, fontSize: 13, color: C.body, fontFace: FONT, valign: 'top',
        });
        // Pull quote on the right
        const pull = quoteMap[es.pull_quote_id];
        if (pull) {
            s.addShape(pptx.ShapeType.rect, {
                x: 8.9, y: 1.45, w: 4.0, h: 4.8, fill: { color: C.brandSoft }, line: { color: C.brand, width: 0.75 },
            });
            s.addText('PULL QUOTE', {
                x: 9.1, y: 1.6, w: 3.6, h: 0.3, fontSize: 9, bold: true, color: C.brand, fontFace: FONT, charSpacing: 1,
            });
            s.addText(`"${pull.text || ''}"`, {
                x: 9.1, y: 2.0, w: 3.6, h: 3.2, fontSize: 13, italic: true, color: C.ink, fontFace: FONT, valign: 'top',
            });
            s.addText(`— ${pull.speaker_id || 'unknown'}  ·  ${pull.session_title || pull.session_id || ''}${pull.t_start_ms ? '  ·  ' + fmtTime(pull.t_start_ms) : ''}`, {
                x: 9.1, y: 5.5, w: 3.6, h: 0.6, fontSize: 10, color: C.muted, fontFace: FONT,
            });
        }
        slides.push(s);
    }

    // ── 3. Theme landscape (overview table) ───────────────────────────
    const allThemes = (rj.themes || []).filter(t => (t.prevalence?.speakers ?? 0) > 0);
    if (allThemes.length > 0) {
        const s = pptx.addSlide();
        addHeader(s, 'Theme landscape', `${allThemes.length} themes ranked by speaker prevalence`);
        const headerRow = [
            { text: '#',         options: { bold: true, color: 'FFFFFF', fill: { color: C.brand }, fontFace: FONT, fontSize: 10 } },
            { text: 'Theme',     options: { bold: true, color: 'FFFFFF', fill: { color: C.brand }, fontFace: FONT, fontSize: 10 } },
            { text: 'Speakers',  options: { bold: true, color: 'FFFFFF', fill: { color: C.brand }, fontFace: FONT, fontSize: 10, align: 'center' } },
            { text: '%',         options: { bold: true, color: 'FFFFFF', fill: { color: C.brand }, fontFace: FONT, fontSize: 10, align: 'center' } },
            { text: 'Consensus', options: { bold: true, color: 'FFFFFF', fill: { color: C.brand }, fontFace: FONT, fontSize: 10 } },
            { text: 'Sentiment', options: { bold: true, color: 'FFFFFF', fill: { color: C.brand }, fontFace: FONT, fontSize: 10 } },
        ];
        const dataRows = allThemes.map((t, i) => {
            const p = t.prevalence || {};
            const sb = t.sentiment_breakdown || {};
            const dom = Object.entries(sb).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
            const pct = p.total_speakers ? Math.round((p.speakers / p.total_speakers) * 100) : 0;
            const rowFill = i % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
            return [
                { text: `${i + 1}`,               options: { fontFace: FONT, fontSize: 10, color: C.muted,  fill: { color: rowFill } } },
                { text: t.name || '',             options: { fontFace: FONT, fontSize: 10, color: C.ink,    fill: { color: rowFill } } },
                { text: `${p.speakers || 0}/${p.total_speakers || 0}`, options: { fontFace: FONT, fontSize: 10, color: C.body,   fill: { color: rowFill }, align: 'center' } },
                { text: `${pct}%`,                options: { fontFace: FONT, fontSize: 10, color: C.brand,  fill: { color: rowFill }, align: 'center', bold: true } },
                { text: t.consensus_level || '—', options: { fontFace: FONT, fontSize: 10, color: C.body,   fill: { color: rowFill } } },
                { text: titleCase(dom[0]),        options: { fontFace: FONT, fontSize: 10, color: sentimentPptColor(dom[0], C), fill: { color: rowFill }, bold: true } },
            ];
        });
        s.addTable([headerRow, ...dataRows], {
            x: 0.6, y: 1.45, w: 12.1,
            colW: [0.5, 6.0, 1.3, 1.0, 1.5, 1.8],
            rowH: 0.32,
            border: { pt: 0.5, color: C.line },
            fontSize: 10,
        });
        slides.push(s);
    }

    // ── 4. Theme prevalence chart ─────────────────────────────────────
    if (allThemes.length >= 2) {
        const s = pptx.addSlide();
        addHeader(s, 'Theme prevalence', 'Distinct speakers per theme');
        const sorted = [...allThemes].sort((a, b) => (b.prevalence?.speakers ?? 0) - (a.prevalence?.speakers ?? 0));
        const chartData = [{
            name: 'Speakers',
            labels: sorted.map(t => (t.name || '').substring(0, 40)),
            values: sorted.map(t => t.prevalence?.speakers || 0),
        }];
        s.addChart(pptx.charts.BAR, chartData, {
            x: 0.6, y: 1.5, w: 12.1, h: 5.3,
            barDir: 'bar',
            chartColors: [C.brand],
            showValue: true,
            dataLabelPosition: 'outEnd',
            dataLabelFontSize: 9,
            dataLabelColor: C.body,
            dataLabelFontFace: FONT,
            catAxisLabelColor: C.body,
            catAxisLabelFontSize: 9,
            catAxisLabelFontFace: FONT,
            valAxisLabelColor: C.muted,
            valAxisLabelFontSize: 8,
            valAxisLabelFontFace: FONT,
            showLegend: false,
            catGridLine: { style: 'none' },
            valGridLine: { color: C.line, width: 0.3 },
        });
        slides.push(s);
    }

    // ── 5. Sentiment composition chart ────────────────────────────────
    if (allThemes.length >= 2) {
        const s = pptx.addSlide();
        addHeader(s, 'Sentiment composition', '% sentiment within each theme');
        const sorted = [...allThemes].sort((a, b) => (b.prevalence?.speakers ?? 0) - (a.prevalence?.speakers ?? 0));
        const labels = sorted.map(t => (t.name || '').substring(0, 36));
        const mkSeries = (key, name) => ({
            name,
            labels,
            values: sorted.map(t => Math.round(((t.sentiment_breakdown || {})[key] || 0) * 100)),
        });
        s.addChart(pptx.charts.BAR, [mkSeries('positive', 'Positive'), mkSeries('mixed', 'Mixed'), mkSeries('neutral', 'Neutral'), mkSeries('negative', 'Negative')], {
            x: 0.6, y: 1.5, w: 12.1, h: 5.3,
            barDir: 'bar',
            barGrouping: 'percentStacked',
            chartColors: [C.success, C.warning, C.neutral, C.error],
            showLegend: true,
            legendPos: 'b',
            legendFontSize: 9,
            legendFontFace: FONT,
            legendColor: C.body,
            showValue: false,
            catAxisLabelColor: C.body,
            catAxisLabelFontSize: 9,
            catAxisLabelFontFace: FONT,
            valAxisLabelColor: C.muted,
            valAxisLabelFontSize: 8,
            valAxisLabelFontFace: FONT,
            catGridLine: { style: 'none' },
            valGridLine: { color: C.line, width: 0.3 },
        });
        slides.push(s);
    }

    // ── 6. Per-theme slides (ALL themes, with sub-themes + quotes) ────
    for (const t of allThemes) {
        const s = pptx.addSlide();
        const rankLabel = t.rank ? `T${String(t.rank).padStart(3, '0')}` : (t.theme_id || '');
        addHeader(s, t.name || 'Untitled theme', `${rankLabel} · ${t.consensus_level || 'minority'} consensus`);

        const p = t.prevalence || {};
        const pct = p.total_speakers ? Math.round((p.speakers / p.total_speakers) * 100) : 0;

        // Stat strip
        const statStripY = 1.4;
        s.addShape(pptx.ShapeType.rect, { x: 0.6, y: statStripY, w: 12.1, h: 0.5, fill: { color: C.brandSoft }, line: { color: C.brandSoft } });
        s.addText([
            { text: `${p.speakers || 0}/${p.total_speakers || 0} speakers`, options: { bold: true, color: C.brand, fontSize: 11, fontFace: FONT } },
            { text: '   ·   ', options: { color: C.muted, fontSize: 11, fontFace: FONT } },
            { text: `${pct}%`, options: { bold: true, color: C.brand, fontSize: 11, fontFace: FONT } },
            { text: '   ·   ', options: { color: C.muted, fontSize: 11, fontFace: FONT } },
            { text: `${p.sessions || 0}/${p.total_sessions || 0} sessions`, options: { bold: true, color: C.brand, fontSize: 11, fontFace: FONT } },
            { text: '   ·   ', options: { color: C.muted, fontSize: 11, fontFace: FONT } },
            { text: `${(t.quote_count || (t.representative_quote_ids || []).length)} quotes`, options: { bold: true, color: C.brand, fontSize: 11, fontFace: FONT } },
        ], { x: 0.8, y: statStripY, w: 11.7, h: 0.5, valign: 'middle' });

        // Left column — definition + summary + tensions
        let leftY = 2.1;
        if (t.definition) {
            s.addText('DEFINITION', { x: 0.6, y: leftY, w: 6.3, h: 0.25, fontSize: 9, bold: true, color: C.muted, charSpacing: 1, fontFace: FONT });
            s.addText(t.definition, { x: 0.6, y: leftY + 0.25, w: 6.3, h: 0.8, fontSize: 11, color: C.body, italic: true, fontFace: FONT, valign: 'top' });
            leftY += 1.1;
        }
        if (t.summary) {
            s.addText('SUMMARY', { x: 0.6, y: leftY, w: 6.3, h: 0.25, fontSize: 9, bold: true, color: C.muted, charSpacing: 1, fontFace: FONT });
            s.addText(stripQuoteIds(t.summary), { x: 0.6, y: leftY + 0.25, w: 6.3, h: 2.4, fontSize: 11, color: C.body, fontFace: FONT, valign: 'top' });
            leftY += 2.7;
        }
        if ((t.tensions || []).length > 0 && leftY < 6.0) {
            const tensionBullets = t.tensions.slice(0, 3).map(x => ({
                text: stripQuoteIds(x), options: { bullet: { type: 'bullet' }, paraSpaceAfter: 4, color: C.warning },
            }));
            s.addText('TENSIONS / DISAGREEMENTS', { x: 0.6, y: leftY, w: 6.3, h: 0.25, fontSize: 9, bold: true, color: C.warning, charSpacing: 1, fontFace: FONT });
            s.addText(tensionBullets, { x: 0.6, y: leftY + 0.25, w: 6.3, h: 6.5 - leftY, fontSize: 10, color: C.body, fontFace: FONT, valign: 'top' });
        }

        // Right column — sub-themes with bars, then representative quotes
        const subThemes = (rj.codeframe?.themes || []).find(ct => ct.theme_id === t.theme_id)?.sub_themes || [];
        let rightY = 2.1;
        if (subThemes.length > 0) {
            s.addText('SUB-THEMES', { x: 7.1, y: rightY, w: 5.6, h: 0.25, fontSize: 9, bold: true, color: C.muted, charSpacing: 1, fontFace: FONT });
            rightY += 0.32;
            const subs = subThemes.slice(0, 5);
            for (const st of subs) {
                const spct = Math.round((st.coverage_pct || 0) * 100);
                s.addText(st.label || '', { x: 7.1, y: rightY, w: 4.3, h: 0.3, fontSize: 10, bold: true, color: C.ink, fontFace: FONT, valign: 'middle' });
                s.addText(`${st.speakers}/${st.total_speakers} · ${spct}%`, {
                    x: 11.4, y: rightY, w: 1.3, h: 0.3, fontSize: 9, bold: true, color: C.brand, fontFace: FONT, align: 'right', valign: 'middle',
                });
                // Bar
                s.addShape(pptx.ShapeType.rect, { x: 7.1, y: rightY + 0.3, w: 5.6, h: 0.08, fill: { color: C.line }, line: { color: C.line } });
                s.addShape(pptx.ShapeType.rect, { x: 7.1, y: rightY + 0.3, w: 5.6 * (spct / 100), h: 0.08, fill: { color: C.brand }, line: { color: C.brand } });
                rightY += 0.5;
            }
            rightY += 0.1;
        }

        // Representative quotes (up to 3) on right bottom
        const qs = (t.representative_quote_ids || []).slice(0, 3).map(id => quoteMap[id]).filter(Boolean);
        if (qs.length > 0 && rightY < 6.0) {
            s.addText('VOICES', { x: 7.1, y: rightY, w: 5.6, h: 0.25, fontSize: 9, bold: true, color: C.muted, charSpacing: 1, fontFace: FONT });
            rightY += 0.3;
            const quoteRowH = Math.min(0.8, (6.8 - rightY) / qs.length);
            for (const q of qs) {
                s.addText(`"${(q.text || '').substring(0, 200)}"`, {
                    x: 7.1, y: rightY, w: 5.6, h: quoteRowH - 0.2, fontSize: 10, italic: true, color: C.ink, fontFace: FONT, valign: 'top',
                });
                s.addText(`— ${q.speaker_id || 'unknown'}${q.session_title ? ' · ' + q.session_title : ''}`, {
                    x: 7.1, y: rightY + quoteRowH - 0.2, w: 5.6, h: 0.2, fontSize: 9, color: C.muted, fontFace: FONT,
                });
                rightY += quoteRowH;
                if (rightY > 6.9) break;
            }
        }
        slides.push(s);
    }

    // ── 7. Cross-session analysis (if multi-session) ──────────────────
    const cs = rj.cross_session;
    if (cs && md.sessions >= 2) {
        if ((cs.universals || []).length > 0) {
            const s = pptx.addSlide();
            addHeader(s, 'Universal themes', 'Claims that appear across ALL sessions');
            const rows = cs.universals.slice(0, 8).map((u, i) => ({
                text: `${(u.theme_name || u.theme_id)} — ${stripQuoteIds(u.description || u.pattern || '')}`,
                options: { bullet: { type: 'bullet' }, paraSpaceAfter: 8 },
            }));
            s.addText(rows, { x: 0.6, y: 1.45, w: 12.1, h: 5.3, fontSize: 12, color: C.body, fontFace: FONT, valign: 'top' });
            slides.push(s);
        }
        if ((cs.divergences || []).length > 0) {
            const s = pptx.addSlide();
            addHeader(s, 'Divergences', 'Where sessions disagreed');
            const rows = cs.divergences.slice(0, 6).map(d => ({
                text: `${d.theme_name || d.theme_id}: ${stripQuoteIds(d.pattern || '')}`,
                options: { bullet: { type: 'bullet' }, paraSpaceAfter: 10, color: C.error },
            }));
            s.addText(rows, { x: 0.6, y: 1.45, w: 12.1, h: 5.3, fontSize: 12, color: C.body, fontFace: FONT, valign: 'top' });
            slides.push(s);
        }
        if ((cs.narratives || []).length > 0) {
            const s = pptx.addSlide();
            addHeader(s, 'Narratives', 'Storylines threading across sessions');
            const rows = cs.narratives.slice(0, 4).map(n => ({
                text: `${n.title || ''} — ${stripQuoteIds(n.narrative || '')}`,
                options: { bullet: { type: 'bullet' }, paraSpaceAfter: 12 },
            }));
            s.addText(rows, { x: 0.6, y: 1.45, w: 12.1, h: 5.3, fontSize: 12, color: C.body, fontFace: FONT, valign: 'top' });
            slides.push(s);
        }
    }

    // ── 8. Speaker dynamics (per session) ─────────────────────────────
    for (const d of (rj.speaker_dynamics || [])) {
        const s = pptx.addSlide();
        addHeader(s, `Speaker dynamics — ${d.session_title || d.session_id || ''}`,
            `${d.participant_count || 0} participants · dominance ${Math.round((d.dominance_index || 0) * 100)}%`);
        const talkPct = d.talk_time_pct || {};
        const entries = Object.entries(talkPct).sort((a, b) => b[1] - a[1]);
        if (entries.length > 0) {
            const chartData = [{
                name: 'Talk time',
                labels: entries.map(e => e[0]),
                values: entries.map(e => Math.round(e[1] * 100)),
            }];
            s.addChart(pptx.charts.DOUGHNUT, chartData, {
                x: 0.6, y: 1.5, w: 5.5, h: 5.3,
                chartColors: entries.map((_, i) => shade(C.brand, -30 + i * 12).replace('#','')),
                showValue: true,
                dataLabelFormatCode: '0"%"',
                dataLabelFontSize: 10,
                dataLabelFontFace: FONT,
                dataLabelColor: 'FFFFFF',
                showLegend: true,
                legendPos: 'b',
                legendFontSize: 9,
                legendFontFace: FONT,
                legendColor: C.body,
                holeSize: 55,
            });
        }
        // Right side — turn counts + silent voices
        s.addText('TURN COUNT', { x: 6.5, y: 1.5, w: 6.2, h: 0.25, fontSize: 9, bold: true, color: C.muted, charSpacing: 1, fontFace: FONT });
        const turns = Object.entries(d.turn_count || {}).sort((a, b) => b[1] - a[1]);
        let tY = 1.85;
        for (const [spk, n] of turns.slice(0, 8)) {
            s.addText(spk, { x: 6.5, y: tY, w: 2.5, h: 0.3, fontSize: 11, color: C.ink, fontFace: FONT, valign: 'middle' });
            const max = turns[0][1] || 1;
            s.addShape(pptx.ShapeType.rect, { x: 9.0, y: tY + 0.08, w: 3.0, h: 0.14, fill: { color: C.line }, line: { color: C.line } });
            s.addShape(pptx.ShapeType.rect, { x: 9.0, y: tY + 0.08, w: 3.0 * (n / max), h: 0.14, fill: { color: C.brand }, line: { color: C.brand } });
            s.addText(String(n), { x: 12.1, y: tY, w: 0.6, h: 0.3, fontSize: 10, bold: true, color: C.brand, fontFace: FONT, align: 'right', valign: 'middle' });
            tY += 0.35;
            if (tY > 5.5) break;
        }
        if ((d.silent_voices || []).length > 0) {
            s.addText(`⚠ Silent voices (<5% talk-time): ${d.silent_voices.join(', ')}`, {
                x: 6.5, y: 6.2, w: 6.2, h: 0.4, fontSize: 11, color: C.warning, bold: true, fontFace: FONT, valign: 'top',
            });
        }
        slides.push(s);
    }

    // ── 9. Moderator gaps ─────────────────────────────────────────────
    const gaps = rj.moderator_gaps;
    if (gaps && ((gaps.gaps || []).length > 0 || (gaps.missed_signals || []).length > 0)) {
        const s = pptx.addSlide();
        addHeader(s, 'Moderator gaps', 'Under-probed themes and missed signals');
        let y = 1.45;
        if ((gaps.gaps || []).length > 0) {
            s.addText('UNDER-PROBED THEMES', { x: 0.6, y, w: 12.1, h: 0.3, fontSize: 10, bold: true, color: C.muted, charSpacing: 1, fontFace: FONT });
            y += 0.3;
            const rows = gaps.gaps.slice(0, 6).map(g => ({
                text: `${g.theme_id}: ${stripQuoteIds(g.why_gap || '')}\n→ ${stripQuoteIds(g.suggested_follow_up || '')}`,
                options: { bullet: { type: 'bullet' }, paraSpaceAfter: 8 },
            }));
            const estH = Math.min(3.5, rows.length * 0.85);
            s.addText(rows, { x: 0.6, y, w: 12.1, h: estH, fontSize: 10, color: C.body, fontFace: FONT, valign: 'top' });
            y += estH + 0.2;
        }
        if ((gaps.missed_signals || []).length > 0 && y < 6.5) {
            s.addText('MISSED SIGNALS', { x: 0.6, y, w: 12.1, h: 0.3, fontSize: 10, bold: true, color: C.muted, charSpacing: 1, fontFace: FONT });
            y += 0.3;
            const rows = gaps.missed_signals.slice(0, 5).map(m => ({
                text: stripQuoteIds(m.description || ''),
                options: { bullet: { type: 'bullet' }, paraSpaceAfter: 6 },
            }));
            s.addText(rows, { x: 0.6, y, w: 12.1, h: 7.0 - y, fontSize: 10, color: C.body, fontFace: FONT, valign: 'top' });
        }
        slides.push(s);
    }

    // ── 10. Codeframe appendix (sub-themes per theme) ─────────────────
    const cfThemes = rj.codeframe?.themes || [];
    if (cfThemes.length > 0) {
        // Split across slides — roughly 3 themes per page
        const chunkSize = 3;
        for (let i = 0; i < cfThemes.length; i += chunkSize) {
            const chunk = cfThemes.slice(i, i + chunkSize);
            const s = pptx.addSlide();
            addHeader(s, 'Codeframe', `Page ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(cfThemes.length / chunkSize)}`);
            let y = 1.4;
            const rowH = (7.0 - y) / chunk.length;
            for (const t of chunk) {
                s.addText(`${t.theme_id}  ·  ${t.name || ''}`, { x: 0.6, y, w: 12.1, h: 0.3, fontSize: 12, bold: true, color: C.brand, fontFace: FONT });
                if (t.definition) {
                    s.addText(t.definition, { x: 0.6, y: y + 0.3, w: 12.1, h: 0.4, fontSize: 9, color: C.muted, fontFace: FONT, italic: true, valign: 'top' });
                }
                const subs = t.sub_themes || [];
                if (subs.length > 0) {
                    const subBullets = subs.slice(0, 6).map(st => ({
                        text: `${st.label}  —  ${st.speakers}/${st.total_speakers} (${Math.round((st.coverage_pct || 0) * 100)}%)`,
                        options: { bullet: { type: 'bullet' }, paraSpaceAfter: 2 },
                    }));
                    s.addText(subBullets, { x: 0.6, y: y + 0.75, w: 12.1, h: rowH - 0.85, fontSize: 10, color: C.body, fontFace: FONT, valign: 'top' });
                }
                y += rowH;
            }
            slides.push(s);
        }
    }

    // ── 11. End slide ─────────────────────────────────────────────────
    {
        const s = pptx.addSlide();
        s.background = { color: C.brand };
        s.addText('Thank you', { x: 0.6, y: 2.8, w: 12, h: 1.0, fontSize: 48, bold: true, color: 'FFFFFF', fontFace: FONT });
        s.addText(`${md.project_name || 'FGD Report'}  ·  ${rj.generated_at ? new Date(rj.generated_at).toLocaleDateString() : ''}`, {
            x: 0.6, y: 4.0, w: 12, h: 0.4, fontSize: 14, color: 'FFFFFF', fontFace: FONT,
        });
        slides.push(s);
    }

    // Back-stamp footer with page numbers (skip cover + end)
    const total = slides.length;
    for (let i = 1; i < total - 1; i++) {
        addFooter(slides[i], i + 1, total);
    }

    const fname = (md.project_name || 'fgd-report').replace(/[^a-z0-9\-_]+/gi, '_').toLowerCase() + '.pptx';
    pptx.writeFile({ fileName: fname });
}

function sentimentPptColor(s, C) {
    if (s === 'positive') return C.success;
    if (s === 'negative') return C.error;
    if (s === 'mixed')    return C.warning;
    return C.muted;
}

// ═══════════════════════════════════════════════════════════════════════
// LOAD + SUBSCRIBE
// ═══════════════════════════════════════════════════════════════════════

async function loadJob() {
    try {
        const job = await api.request(`/research/focus-group/reports/${jobId}`);
        setStage(job.status || job.current_stage || 'processing', job.progress || 0, stageMessage(job));
        document.getElementById('backBtn').onclick = () => {
            window.location.href = `focus-group-detail.html?id=${encodeURIComponent(job.project_id)}`;
        };
        if (job.status === 'failed' || job.status === 'cancelled') {
            showError(job.error_message || 'Report failed with no error message.');
        } else if (job.status === 'done') {
            buildDashboard(job);
        }
        return job;
    } catch (e) {
        setStage('failed', 0, 'Unable to load report');
        showError(e.message || 'Request failed');
        return null;
    }
}

function stageMessage(job) {
    if (job.status === 'failed')  return job.error_message || 'Failed';
    if (job.status === 'done')    return 'Complete';
    return STAGE_LABEL[job.current_stage || job.status] || '…';
}

async function startSignalR() {
    const base = (CONFIG.researchApiBaseUrl || CONFIG.visionApiBaseUrl || '').replace(/\/api$/, '');
    const hubUrl = `${base}/hubs/research`;
    const conn = new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, { accessTokenFactory: () => api.getToken ? api.getToken() : (localStorage.getItem('token') || '') })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();
    conn.on('FgdReportProgress', async (evt) => {
        if (!evt || evt.jobId !== jobId) return;
        setStage(evt.stage, evt.progress, evt.message);
        if (evt.stage === 'failed') showError(evt.message || 'Report failed');
        else if (evt.stage === 'done') await loadJob();
    });
    try {
        await conn.start();
        await conn.invoke('JoinFgdReportProgress', jobId);
    } catch (err) {
        console.warn('[fgd-report] SignalR connect failed; polling fallback', err);
        pollLoop();
    }
}

async function pollLoop() {
    while (true) {
        const job = await loadJob();
        if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') break;
        await new Promise(r => setTimeout(r, 3000));
    }
}

document.getElementById('retryBtn').onclick = async () => {
    try {
        const job = await api.request(`/research/focus-group/reports/${jobId}`);
        window.location.href = `focus-group-detail.html?id=${encodeURIComponent(job.project_id)}`;
    } catch { window.location.href = 'focus-groups.html'; }
};

(async () => {
    const j = await loadJob();
    if (j && !['done','failed','cancelled'].includes(j.status)) {
        await startSignalR();
    }
})();
