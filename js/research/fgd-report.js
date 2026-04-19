// FGD report viewer.
//   Processing states: live progress via SignalR (or polling fallback).
//   Done state: slide-style renderer building from report_json v1.0.
//
// XSS RULE — this file NEVER uses innerHTML on transcript-derived data.
// Every quote, theme name, bullet, and summary is inserted via textContent
// or DOM createElement. Server delivers strings, we render strings.

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
    rollup:        'Cross-session analysis',
    summarizing:   'Writing executive summary',
    done:          'Report ready',
    failed:        'Report failed',
    cancelled:     'Cancelled',
};

// ═══════════════════════════════════════════════════════════════════════
// PROGRESS UI (unchanged from Sprint 1)
// ═══════════════════════════════════════════════════════════════════════

function setStage(stage, progress, message) {
    document.getElementById('stageLabel').textContent = (stage || 'processing').toUpperCase();
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
    document.getElementById('actionsRow').style.display = 'flex';
    document.getElementById('retryBtn').style.display = 'inline-flex';
}

function hideProgressPanel() {
    // Once we render the final report, collapse the progress shell so the
    // page flows straight into slides. Keep breadcrumb + back button.
    const progressPanel = document.querySelector('.report-panel');
    if (progressPanel) progressPanel.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════
// DOM HELPERS — createElement-only; no innerHTML with data.
// ═══════════════════════════════════════════════════════════════════════

function el(tag, opts = {}, ...children) {
    const e = document.createElement(tag);
    if (opts.className) e.className = opts.className;
    if (opts.id) e.id = opts.id;
    if (opts.text !== undefined) e.textContent = opts.text;   // safe by design
    if (opts.href) e.href = opts.href;
    if (opts.title) e.title = opts.title;
    if (opts.onclick) e.addEventListener('click', opts.onclick);
    if (opts.style) {
        for (const [k, v] of Object.entries(opts.style)) e.style[k] = v;
    }
    if (opts.attrs) {
        for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
    }
    for (const child of children) {
        if (child === null || child === undefined) continue;
        e.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return e;
}

function panel(...children) {
    return el('div', { className: 'report-panel', style: { marginBottom: '20px' } }, ...children);
}

function fmtTime(ms) {
    const s = Math.floor((ms || 0) / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${ss.toString().padStart(2, '0')}`;
}

// Sanitize analyst prose: strip inline quote_ids that the LLM sometimes
// leaks into `summary` or `tensions` despite the prompt forbidding it.
// Patterns removed:
//   (q_abcdef_123)                         → ''
//   (q_abcdef_1, q_abcdef_2, q_abcdef_3)   → ''
//   — q_abcdef_1                           → '—'   (dangling at end)
//   ,  q_abcdef_1                          → ','   (dangling inside)
// Defensive — the real fix is in the write_theme prompt.
function stripQuoteIds(text) {
    if (!text) return '';
    return String(text)
        // Parenthesised groups: "(q_x, q_y, q_z)" → ""
        .replace(/\s*\(\s*q_[0-9a-f]+_\d+(?:\s*,\s*q_[0-9a-f]+_\d+)*\s*\)/gi, '')
        // Any stray ids anywhere else
        .replace(/\bq_[0-9a-f]+_\d+\b/gi, '')
        // Clean up doubled spaces / dangling punctuation left behind
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.;:])/g, '$1')
        .trim();
}

function sentimentClass(s) {
    return s === 'positive' ? 'pos'
         : s === 'negative' ? 'neg'
         : s === 'mixed'    ? 'split'
         : 'neutral';
}

// ═══════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════

function showDone(job) {
    const rj = job.report_json || {};
    const audit = job.token_audit || {};
    if (!rj.themes || !Array.isArray(rj.themes)) {
        // Edge case — backend returned a shape we don't understand.
        renderUnknownShape(job);
        return;
    }
    hideProgressPanel();
    const host = document.getElementById('reportContent');
    host.style.display = 'block';
    host.innerHTML = ''; // controlled — we just emptied a panel we own

    // Build a quote_id -> quote map up front. Every theme card and
    // exec bullet resolves ids through this. If an id is missing we
    // render a [missing] marker rather than silently dropping.
    const quoteMap = {};
    for (const q of (rj.quotes || [])) quoteMap[q.quote_id] = q;

    host.appendChild(renderCoverSlide(rj, audit, quoteMap));
    host.appendChild(renderTocStrip(rj.themes));
    for (const theme of rj.themes) {
        host.appendChild(renderThemeSlide(theme, quoteMap));
    }
    host.appendChild(renderVerbatimGallery(rj, quoteMap));
    host.appendChild(renderAppendix(rj, audit, job));
}

function renderUnknownShape(job) {
    hideProgressPanel();
    const host = document.getElementById('reportContent');
    host.style.display = 'block';
    host.innerHTML = '';
    host.appendChild(panel(
        el('div', { className: 'slide-title-kicker', text: 'REPORT' }),
        el('h1', { className: 'slide-title', text: 'Report ready (legacy shape)' }),
        el('p', { className: 'slide-body', text: 'This job was generated by an older pipeline build. The v1.0 slide renderer expects report_json.themes[]; falling back to raw JSON dump.' }),
        (() => {
            const pre = document.createElement('pre');
            pre.className = 'report-dump';
            pre.style.marginTop = '14px';
            pre.textContent = JSON.stringify(job.report_json || {}, null, 2);
            return pre;
        })(),
    ));
}

// ─────────────────────────────────────────────────────────────────────
// Cover slide: study metadata + exec summary bullets + pull quote.
// ─────────────────────────────────────────────────────────────────────

function renderCoverSlide(rj, audit, quoteMap) {
    const md = rj.study_metadata || {};
    const es = rj.executive_summary || {};
    const bullets = es.bullets || [];
    const pullQuote = quoteMap[es.pull_quote_id];

    const metrics = el('div', { className: 'metric-row' });
    metrics.appendChild(metricTile(md.sessions ?? 0, 'Sessions'));
    metrics.appendChild(metricTile(md.speakers ?? 0, 'Speakers'));
    metrics.appendChild(metricTile(md.total_utterances ?? 0, 'Utterances'));
    metrics.appendChild(metricTile((rj.themes || []).length, 'Themes'));

    const bulletsUl = el('ul', { className: 'exec-bullets' });
    for (const b of bullets) {
        const li = el('li', {}, stripQuoteIds(b.text || ''));
        const wrap = el('span', { className: 'bullet-themes' });
        for (const tid of (b.supporting_theme_ids || [])) {
            wrap.appendChild(el('a', {
                className: 'badge',
                href: '#' + tid,
                text: tid,
                title: 'Jump to theme ' + tid,
            }));
        }
        if ((b.supporting_theme_ids || []).length) li.appendChild(wrap);
        bulletsUl.appendChild(li);
    }

    const children = [
        el('div', { className: 'slide-title-kicker', text: 'EXECUTIVE SUMMARY' }),
        el('h1', { className: 'slide-title', text: 'Headline findings' }),
        metrics,
        bulletsUl,
    ];
    if (pullQuote) {
        const pq = el('div', { className: 'pull-quote' });
        pq.appendChild(document.createTextNode('"' + (pullQuote.text || '') + '"'));
        pq.appendChild(el('span', {
            className: 'pull-quote-attr',
            text: `— ${pullQuote.speaker_id || 'unknown'} · ${pullQuote.session_title || pullQuote.session_id || ''}${pullQuote.t_start_ms ? ' · ' + fmtTime(pullQuote.t_start_ms) : ''}`,
        }));
        children.push(pq);
    } else if (es.pull_quote_id) {
        children.push(el('div', { className: 'empty-note', text: `[pull quote ${es.pull_quote_id} not resolved]` }));
    }
    return panel(...children);
}

function metricTile(val, lbl) {
    return el('div', { className: 'metric' },
        el('div', { className: 'metric-val', text: String(val) }),
        el('div', { className: 'metric-lbl', text: lbl }),
    );
}

// ─────────────────────────────────────────────────────────────────────
// Sticky theme TOC.
// ─────────────────────────────────────────────────────────────────────

function renderTocStrip(themes) {
    const nav = el('div', { className: 'theme-toc' });
    for (const t of themes) {
        nav.appendChild(el('a', {
            href: '#' + t.theme_id,
            text: `${t.theme_id} · ${t.name || ''}`,
        }));
    }
    return nav;
}

// ─────────────────────────────────────────────────────────────────────
// Per-theme slide.
// ─────────────────────────────────────────────────────────────────────

function renderThemeSlide(theme, quoteMap) {
    const p = theme.prevalence || {};
    const sb = theme.sentiment_breakdown || {};

    const badges = el('div', { className: 'badge-row' });
    badges.appendChild(el('span', { className: 'badge', text: theme.theme_id }));
    if (theme.consensus_level) {
        badges.appendChild(el('span', {
            className: 'badge ' + theme.consensus_level,
            text: theme.consensus_level,
        }));
    }

    const prev = el('div', { className: 'prev-line',
        text: `${p.speakers || 0} of ${p.total_speakers || 0} speakers · ${p.sessions || 0} of ${p.total_sessions || 0} sessions`,
    });

    // Sentiment bar only if we have any signal
    const totalSent = (sb.positive || 0) + (sb.negative || 0) + (sb.neutral || 0) + (sb.mixed || 0);
    const sentBar = el('div', { className: 'sentiment-bar' });
    if (totalSent > 0) {
        const add = (cls, v) => {
            if (!v) return;
            sentBar.appendChild(el('span', { className: cls, style: { width: (v * 100) + '%' } }));
        };
        add('pos', sb.positive || 0);
        add('mix', sb.mixed || 0);
        add('neu', sb.neutral || 0);
        add('neg', sb.negative || 0);
    }
    const sentLegend = el('div', { className: 'sentiment-legend' });
    if (totalSent > 0) {
        const pct = (v) => Math.round((v || 0) * 100) + '%';
        sentLegend.appendChild(el('span', { text: `Positive ${pct(sb.positive)}` }));
        sentLegend.appendChild(el('span', { text: `Negative ${pct(sb.negative)}` }));
        sentLegend.appendChild(el('span', { text: `Neutral ${pct(sb.neutral)}` }));
        sentLegend.appendChild(el('span', { text: `Mixed ${pct(sb.mixed)}` }));
    }

    const summary = el('p', { className: 'slide-body', text: stripQuoteIds(theme.summary || '') });

    const tensions = el('div', { className: 'tensions' });
    if ((theme.tensions || []).length > 0) {
        tensions.appendChild(el('div', { className: 'tensions-hdr', text: 'TENSIONS' }));
        const ul = el('ul');
        for (const t of theme.tensions) ul.appendChild(el('li', { text: stripQuoteIds(t) }));
        tensions.appendChild(ul);
    }

    const quotes = el('div', { className: 'theme-quotes' });
    for (const qid of (theme.representative_quote_ids || [])) {
        const q = quoteMap[qid];
        quotes.appendChild(q ? renderQuoteCard(q) : el('div', { className: 'empty-note', text: `[${qid} not resolved]` }));
    }

    const kickerTxt = theme.parent_theme_id ? `SUB-THEME · under ${theme.parent_theme_id}` : 'THEME';
    return panel(
        el('div', { attrs: { id: theme.theme_id } }),  // anchor target
        el('div', { className: 'slide-title-kicker', text: kickerTxt }),
        el('h1', { className: 'slide-title', text: theme.name || '(unnamed)' }),
        badges,
        prev,
        (totalSent > 0 ? sentBar : null),
        (totalSent > 0 ? sentLegend : null),
        el('div', { style: { marginTop: '16px' } },
            el('div', { className: 'tensions-hdr', text: 'DEFINITION' }),
            el('p', { className: 'slide-body', style: { marginTop: '4px' }, text: stripQuoteIds(theme.definition || '') }),
        ),
        el('div', { style: { marginTop: '16px' } },
            el('div', { className: 'tensions-hdr', text: 'SUMMARY' }),
            summary,
        ),
        ((theme.tensions || []).length > 0 ? tensions : null),
        ((theme.representative_quote_ids || []).length > 0
            ? el('div', { style: { marginTop: '16px' } },
                el('div', { className: 'tensions-hdr', text: 'REPRESENTATIVE QUOTES' }),
                quotes)
            : null),
    );
}

function renderQuoteCard(q) {
    return el('div', { className: 'quote-card' },
        el('div', { className: 'qtext', text: '"' + (q.text || '') + '"' }),
        el('div', { className: 'qmeta' },
            el('span', { text: q.speaker_id || 'unknown' }),
            el('span', { className: 'badge ' + sentimentClass(q.sentiment), text: q.sentiment || '—' }),
            el('span', { className: 'qtime', text: q.t_start_ms ? fmtTime(q.t_start_ms) : '' }),
            el('span', { text: q.session_title || q.session_id || '' }),
        ),
    );
}

// ─────────────────────────────────────────────────────────────────────
// Verbatim gallery with filters.
// ─────────────────────────────────────────────────────────────────────

function renderVerbatimGallery(rj, quoteMap) {
    const quotes = rj.quotes || [];
    const themes = rj.themes || [];
    const assignmentsByQid = {};
    for (const a of (rj.assignments || [])) {
        const qid = `q_${(a.session_id || '').replace(/-/g, '')}_${a.utterance_index}`;
        (assignmentsByQid[qid] ||= []).push(a.theme_id);
    }

    const host = el('div');
    const pnl = panel(
        el('div', { className: 'slide-title-kicker', text: 'VERBATIM GALLERY' }),
        el('h1', { className: 'slide-title', text: 'Filterable quotes' }),
        host,
    );

    // Filter bar
    const themeSelect = el('select', {});
    themeSelect.appendChild(el('option', { text: 'All themes', attrs: { value: '' } }));
    for (const t of themes) {
        themeSelect.appendChild(el('option', { text: `${t.theme_id} · ${t.name || ''}`, attrs: { value: t.theme_id } }));
    }
    const sentSelect = el('select', {});
    sentSelect.appendChild(el('option', { text: 'All sentiments', attrs: { value: '' } }));
    for (const s of ['positive', 'negative', 'neutral', 'mixed']) {
        sentSelect.appendChild(el('option', { text: s, attrs: { value: s } }));
    }
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search quotes…';
    const countLabel = el('div', { className: 'prev-line', style: { marginLeft: 'auto', marginBottom: '0' } });

    host.appendChild(el('div', { className: 'gallery-filters' },
        themeSelect, sentSelect, searchInput, countLabel));

    const grid = el('div', { className: 'gallery-grid' });
    host.appendChild(grid);

    const applyFilters = () => {
        const tFilter = themeSelect.value;
        const sFilter = sentSelect.value;
        const q = (searchInput.value || '').trim().toLowerCase();
        grid.innerHTML = '';
        let shown = 0;
        for (const qo of quotes) {
            const qThemes = assignmentsByQid[qo.quote_id] || [];
            if (tFilter && !qThemes.includes(tFilter)) continue;
            if (sFilter && qo.sentiment !== sFilter) continue;
            if (q && !(qo.text || '').toLowerCase().includes(q)) continue;
            grid.appendChild(renderQuoteCard(qo));
            shown++;
        }
        countLabel.textContent = `${shown} of ${quotes.length} quotes`;
        if (shown === 0) {
            grid.appendChild(el('div', { className: 'empty-note', text: 'No quotes match the current filters.' }));
        }
    };
    themeSelect.addEventListener('change', applyFilters);
    sentSelect.addEventListener('change', applyFilters);
    searchInput.addEventListener('input', applyFilters);
    applyFilters();

    return pnl;
}

// ─────────────────────────────────────────────────────────────────────
// Appendix — codeframe tree + token audit.
// ─────────────────────────────────────────────────────────────────────

function renderAppendix(rj, audit, job) {
    const cf = (rj.codeframe && rj.codeframe.themes) || [];
    const tree = el('div', { className: 'codeframe-tree' });
    for (const t of cf) {
        tree.appendChild(el('div', { className: 'cf-theme' },
            el('span', { className: 'cf-id', text: t.theme_id + ' ' }),
            el('span', { className: 'cf-name', text: t.name || '' }),
            el('span', { className: 'cf-def', text: t.definition ? ' — ' + t.definition : '' }),
            (t.raw_code_labels || []).length
                ? el('div', { className: 'cf-labels', text: 'codes: ' + (t.raw_code_labels || []).join('; ') })
                : null,
        ));
    }

    const auditGrid = el('div', { className: 'audit-grid' });
    const rows = [
        ['Haiku input tokens',  audit.HaikuInputTokens ?? audit.haiku_input_tokens ?? '—'],
        ['Haiku output tokens', audit.HaikuOutputTokens ?? audit.haiku_output_tokens ?? '—'],
        ['Sonnet input tokens', audit.SonnetInputTokens ?? audit.sonnet_input_tokens ?? '—'],
        ['Sonnet output tokens',audit.SonnetOutputTokens ?? audit.sonnet_output_tokens ?? '—'],
        ['Cost (USD)',          (audit.CostUsd ?? audit.cost_usd ?? 0).toString ? ('$' + Number(audit.CostUsd ?? audit.cost_usd ?? 0).toFixed(4)) : '—'],
        ['Job id',              job.job_id || jobId],
        ['Report version',      rj.version || '—'],
    ];
    for (const [k, v] of rows) {
        auditGrid.appendChild(el('div', {}, el('div', { className: 'k', text: k }), el('div', { className: 'v', text: String(v) })));
    }

    return panel(
        el('div', { className: 'slide-title-kicker', text: 'APPENDIX' }),
        el('h1', { className: 'slide-title', text: 'Codeframe & audit' }),
        el('h2', { className: 'slide-h2', text: 'Codeframe' }),
        tree,
        el('h2', { className: 'slide-h2', style: { marginTop: '20px' }, text: 'Token audit' }),
        auditGrid,
    );
}

// ═══════════════════════════════════════════════════════════════════════
// LOAD + SUBSCRIBE (unchanged-ish from Sprint 1)
// ═══════════════════════════════════════════════════════════════════════

async function loadJob() {
    try {
        const job = await api.request(`/research/focus-group/reports/${jobId}`);
        setStage(job.status || job.current_stage || 'processing', job.progress || 0, stageMessage(job));
        document.getElementById('backToProject').href = `focus-group-detail.html?id=${encodeURIComponent(job.project_id)}`;
        document.getElementById('backBtn').onclick = () => {
            window.location.href = `focus-group-detail.html?id=${encodeURIComponent(job.project_id)}`;
        };
        if (job.status === 'failed' || job.status === 'cancelled') {
            showError(job.error_message || 'Report failed with no error message.');
        } else if (job.status === 'done') {
            showDone(job);
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
        if (evt.stage === 'failed') {
            showError(evt.message || 'Report failed');
        } else if (evt.stage === 'done') {
            await loadJob();
        }
    });

    try {
        await conn.start();
        await conn.invoke('JoinFgdReportProgress', jobId);
    } catch (err) {
        console.warn('[fgd-report] SignalR connect failed; falling back to polling', err);
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
    } catch {
        window.location.href = 'focus-groups.html';
    }
};

(async () => {
    const j = await loadJob();
    // Only subscribe to progress if the job is still in-flight
    if (j && !['done','failed','cancelled'].includes(j.status)) {
        await startSignalR();
    }
})();
