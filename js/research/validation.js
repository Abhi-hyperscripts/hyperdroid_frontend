/**
 * Data QA (Validation) — inline Ace syntax editor with:
 *   • autocomplete: check names, per-check params, and the FILE's variable names
 *   • export: Copy for Excel / Download CSV of the flagged respondents
 *   • save/auto-save: drafts persist per project; named + starter templates
 * Results render in the shared "Function Results" popup (showFnPopup / #fnResultsContent).
 *
 * Globals used: projectId, files, api, getAuthToken, Toast, Prompt, Confirm, formatNumber, showFnPopup.
 * Backend serialises snake_case (total_blocks, bad_count, …).
 */

let _valChecksLoaded = false;
let _valAce = null;
let _valColumns = [];       // [{name, label}] for the selected file — powers variable autocomplete
let _valChecks = [];        // [{name, category, description, input_schema}]
let _valCheckParams = {};   // fn -> [param keys]
let _valLastResult = null;
let _valDraftTimer = null;
let _valPopupPositioned = false;

const VAL_VAR_KEYS = new Set(['variable', 'variables', 'id', 'ibvar', 'start', 'end', 'source', 'target']);

const VAL_STARTERS = [
    { name: 'Generic tracker QA', script: [
        'respid { "variable": "RESPID" }',
        'vc_dupe { "id": "RESPID" }',
        'vc_single { "variable": "GENDER", "values": "1,2" }',
        'vc_range { "variable": "AGE", "min": 18, "max": 99 }',
        'vc_speed { "variable": "DURATION_MIN", "method": "median_fraction", "fraction": 0.33 }',
        'vc_flatline { "variables": "QSAT_1:QSAT_10" }'
    ].join('\n') },
    { name: 'Full DQV suite (subset)', script: [
        '# Full DQV — logic/structure + fraud markers. Edit variable names to your dataset.',
        'respid { "variable": "RESPID" }',
        'vc_skip { "variable": "QOWN_MODEL", "asked_when": { "expression": "QOWN = 1" } }',
        'vc_multi { "variables": "QAW_1:QAW_8", "exclusive": "QAW_99" }',
        'vc_sum { "variables": "QALLOC_1:QALLOC_5", "total": 100 }',
        'vc_rule { "rule": { "expression": "country_code <> true_country_code" }, "label": "geo_spoof" }',
        'vc_outlier { "variable": "QSPEND", "method": "iqr" }'
    ].join('\n') },
    { name: 'Loops & if/else (example)', script: [
        '# Loops unroll {i}; if scopes the checks inside to matching respondents.',
        'for i = 1:10 {',
        '  vc_grid { "variables": "Q10_{i}", "values": "1:5" }',
        '}',
        '',
        'if WAVE = 1 {',
        '  for i = 1:5 { vc_single { "variable": "QAW_{i}", "values": "1,2" } }',
        '} else {',
        '  vc_single { "variable": "QAW_1", "values": "1,2,3" }',
        '}'
    ].join('\n') }
];

// ---- Ace editor + autocomplete ----------------------------------------------------------------

function ensureAceEditor() {
    if (_valAce) return _valAce;
    if (typeof ace === 'undefined') return null;
    const el = document.getElementById('valEditor');
    if (!el || el.tagName === 'TEXTAREA') return null;
    const req = ace.require || ace.acequire;

    if (!ace._dvsModeInstance && req) {
        try {
            const oop = req('ace/lib/oop');
            const TextMode = req('ace/mode/text').Mode;
            const TextHighlightRules = req('ace/mode/text_highlight_rules').TextHighlightRules;
            const Rules = function () {
                this.$rules = { start: [
                    { token: 'comment.line', regex: /#.*$/ },
                    { token: 'keyword.control', regex: /\b(?:for|if|else|then|in)\b/ },
                    { token: 'keyword', regex: /\b(?:respid|compute_variable|rim_weighting|csharp|vc_[a-z_]+)\b/ },
                    { token: 'variable.parameter', regex: /\{[A-Za-z_][A-Za-z0-9_]*(?:[+\-*]\d+)?\}/ },
                    { token: 'string', regex: /"(?:[^"\\]|\\.)*"/ },
                    { token: 'constant.language.boolean', regex: /\b(?:true|false|null)\b/ },
                    { token: 'constant.numeric', regex: /-?\b\d+(?:\.\d+)?\b/ },
                    { token: 'paren.lparen', regex: /[\[{]/ },
                    { token: 'paren.rparen', regex: /[\]}]/ },
                    { token: 'punctuation.operator', regex: /[:,]/ }
                ] };
            };
            oop.inherits(Rules, TextHighlightRules);
            const Mode = function () { this.HighlightRules = Rules; this.lineCommentStart = '#'; this.$id = 'ace/mode/dvs'; };
            oop.inherits(Mode, TextMode);
            ace._dvsModeInstance = new Mode();
        } catch (e) { ace._dvsModeInstance = null; }
    }

    const ed = ace.edit(el);
    ed.setOptions({
        fontFamily: "'JetBrains Mono', 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: '13px', showPrintMargin: false, tabSize: 2, useSoftTabs: true,
        wrap: false, highlightActiveLine: true, showGutter: true, displayIndentGuides: true,
        enableBasicAutocompletion: true, enableLiveAutocompletion: true, enableSnippets: true
    });
    if (ace._dvsModeInstance) ed.getSession().setMode(ace._dvsModeInstance);
    applyAceTheme(ed);
    ed.completers = [valCompleter()];
    ed.commands.addCommand({ name: 'runSel', bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' }, exec: () => runValidation(true) });
    ed.commands.addCommand({ name: 'runAll', bindKey: { win: 'Ctrl-Shift-Enter', mac: 'Command-Shift-Enter' }, exec: () => runValidation(false) });
    ed.on('change', () => {
        valScheduleDraft();
        ed.session.clearAnnotations();   // stale error markers clear as they start fixing
        clearTimeout(ed._valGutterT);
        ed._valGutterT = setTimeout(valRefreshGutter, 250);
    });
    // Click the ▶ glyph in the gutter to run just that block.
    ed.on('guttermousedown', (e) => {
        const row = e.getDocumentPosition().row;
        const blk = (_valBlocksParsed || []).find(b => b.startRow === row);
        if (blk) { e.stop(); valRunScript(blk.text); }
    });
    _valAce = ed;
    setTimeout(valRefreshGutter, 100);
    // Web font loads async — re-measure once it's ready so Ace's monospace metrics stay aligned.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => { if (_valAce) { _valAce.renderer.updateFontSize(); _valAce.resize(true); } });
    }
    return ed;
}

function applyAceTheme(ed) {
    const attr = document.documentElement.getAttribute('data-theme');
    const dark = attr === 'dark' || (!attr && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    ed.setTheme(dark ? 'ace/theme/tomorrow_night' : 'ace/theme/tomorrow');
}

/** Context-aware completer: variable names inside variable-keys, params inside a block, else checks. */
function valCompleter() {
    return {
        getCompletions: (editor, session, pos, prefix, callback) => {
            try {
                const doc = session.getDocument();
                const offset = doc.positionToIndex(pos);
                const before = session.getValue().slice(0, offset);
                const inString = ((before.match(/"/g) || []).length % 2) === 1;

                if (inString) {
                    const m = before.match(/"([a-z_]+)"\s*:\s*(?:\[[^\]]*)?"[^"]*$/);
                    const key = m ? m[1] : '';
                    if (VAL_VAR_KEYS.has(key) && _valColumns.length) {
                        callback(null, _valColumns.map(v => ({
                            caption: v.name, value: v.name,
                            // show the SPSS label when it adds info, else the variable type
                            meta: (v.label && v.label !== v.name) ? v.label.slice(0, 28) : (v.type || 'variable'),
                            score: 1000
                        })));
                        return;
                    }
                    callback(null, []); return;
                }
                const opens = (before.match(/{/g) || []).length, closes = (before.match(/}/g) || []).length;
                if (opens > closes) {
                    const fnMatch = before.match(/([a-z_]+)\s*{[^{}]*$/);
                    const params = (fnMatch && _valCheckParams[fnMatch[1]]) || [];
                    callback(null, params.map(p => ({ caption: p, value: '"' + p + '": ', meta: 'param', score: 900 })));
                    return;
                }
                callback(null, _valChecks.map(c => ({
                    caption: c.name, snippet: c.name + ' { ${1} }',
                    meta: c.category === 'validation' ? 'check' : 'derive',
                    docText: c.description, score: 800
                })));
            } catch (e) { callback(null, []); }
        }
    };
}

function valGetText() { return _valAce ? _valAce.getValue() : (document.getElementById('valEditor')?.value || ''); }
function valSetText(v) {
    if (_valAce) { _valAce.setValue(v, -1); _valAce.clearSelection(); }
    else { const t = document.getElementById('valEditor'); if (t) t.value = v; }
}

// ---- Init / data loading ----------------------------------------------------------------------

function initValidation() {
    populateValFileSelect();
    setTimeout(populateValFileSelect, 600);
    valLoadChecksData();
    valLoadColumns();
    const ed = ensureAceEditor();
    if (ed) {
        applyAceTheme(ed);
        if (!ed.getValue().trim()) {
            const draft = valReadDraft();
            if (draft) valSetText(draft); else loadValidationExample();
        }
        setTimeout(() => ed.resize(), 60);
    } else {
        const t = document.getElementById('valEditor');
        if (t && t.tagName === 'TEXTAREA' && !t._wired) {
            t._wired = true;
            const draft = valReadDraft();
            if (draft) t.value = draft; else if (!t.value.trim()) loadValidationExample();
            t.addEventListener('input', valScheduleDraft);
            t.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runValidation(true); }
            });
        }
    }
}

/** Load the selected file's variable names/labels for autocomplete. */
async function valLoadColumns() {
    const fileId = document.getElementById('valFileSelect')?.value;
    if (!fileId) { _valColumns = []; return; }
    try {
        const resp = await api.request(`/research/projects/${projectId}/files/${fileId}/variables`, { _skipSpinner: true });
        const vars = Array.isArray(resp) ? resp : (resp.variables || resp.data || []);
        _valColumns = vars.map(v => {
            // parse the value-label map (code -> label) when present, for auto-suggest
            let codes = [];
            const vlj = v.valueLabelsJson || v.value_labels_json || v.valueLabels || v.value_labels;
            try {
                const m = (typeof vlj === 'string') ? JSON.parse(vlj) : vlj;
                if (m && typeof m === 'object') codes = Object.keys(m);
            } catch { /* ignore malformed label json */ }
            return {
                name: v.variableName || v.variable_name || v.name || '',
                label: v.variableLabel || v.variable_label || v.label || '',
                type: v.variableType || v.variable_type || v.type || '',
                codes
            };
        }).filter(v => v.name);
    } catch (e) { _valColumns = []; }
}

async function valLoadChecksData() {
    if (_valChecks.length) return;
    try {
        const data = await api.request(`/research/projects/${projectId}/validation/checks`, { _skipSpinner: true });
        _valChecks = data.checks || [];
        _valChecks.forEach(c => { _valCheckParams[c.name] = c.input_schema ? Object.keys(c.input_schema) : []; });
    } catch (e) { /* autocomplete for checks/params just won't be available */ }
}

function populateValFileSelect() {
    const sel = document.getElementById('valFileSelect');
    if (!sel) return;
    const fid = f => f.id || f.fileId;
    const fname = f => f.file_name || f.fileName;
    const ready = (typeof files !== 'undefined' ? files : []).filter(f => f.status === 'ready');
    const prev = sel.value;
    sel.innerHTML = ready.length
        ? ready.map(f => `<option value="${vEsc(fid(f))}">${vEsc(fname(f))}</option>`).join('')
        : '<option value="">No ready files — upload one first</option>';
    if (prev && ready.some(f => String(fid(f)) === prev)) sel.value = prev;
    if (!_valColumns.length) valLoadColumns();
}

function loadValidationExample() {
    valSetText([
        '# Data QA script — blocks run top-to-bottom against the selected file.',
        '# Tip: select one or more blocks and hit "Run Selection" to run only those.',
        'respid { "variable": "RESPID" }',
        '',
        '# Single-response validity',
        'vc_single { "variable": "GENDER", "values": "1,2" }',
        '',
        '# Numeric range',
        'vc_range { "variable": "AGE", "min": 18, "max": 99 }',
        '',
        '# Duplicate respondents',
        'vc_dupe { "id": "RESPID" }'
    ].join('\n'));
}

// ---- Auto-save draft --------------------------------------------------------------------------

function valDraftKey() { return 'rz_dvs_draft_' + (typeof projectId !== 'undefined' ? projectId : ''); }
function valReadDraft() { try { return localStorage.getItem(valDraftKey()); } catch (e) { return null; } }
function valScheduleDraft() { clearTimeout(_valDraftTimer); _valDraftTimer = setTimeout(() => { try { localStorage.setItem(valDraftKey(), valGetText()); } catch (e) {} }, 700); }

// ---- Templates (save / load / delete + starters) ---------------------------------------------

function valGetSaved() { try { return JSON.parse(localStorage.getItem('rz_dvs_templates') || '[]'); } catch (e) { return []; } }
function valSetSaved(a) { try { localStorage.setItem('rz_dvs_templates', JSON.stringify(a)); } catch (e) {} }

async function valSaveTemplate() {
    const name = await Prompt.show('Save this QA script as a template:', 'My QA script');
    if (!name) return;
    const arr = valGetSaved();
    const idx = arr.findIndex(t => t.name === name);
    const entry = { name, script: valGetText() };
    if (idx >= 0) arr[idx] = entry; else arr.push(entry);
    valSetSaved(arr);
    Toast.success('Template saved: ' + name);
}

function valToggleTemplates(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('valTemplatesMenu');
    if (!menu) return;
    if (menu.style.display === 'block') { menu.style.display = 'none'; return; }
    const saved = valGetSaved();
    const heading = t => `<div style="padding:5px 8px 3px; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted);">${t}</div>`;
    const item = (label, onclick, del) => `<div class="val-tmpl-item" onclick="${onclick}"
        style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; border-radius:6px; cursor:pointer; font-size:0.85rem;"
        onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
        <span>${vEsc(label)}</span>${del || ''}</div>`;
    let html = heading('Starter templates');
    VAL_STARTERS.forEach((t, i) => html += item(t.name, `valLoadTemplate('starter',${i})`));
    html += `<div style="border-top:1px solid var(--border-color); margin-top:4px;"></div>` + heading('Saved');
    if (!saved.length) html += `<div style="padding:6px 8px; color:var(--text-muted); font-size:0.8rem;">No saved templates yet.</div>`;
    saved.forEach((t, i) => html += item(t.name, `valLoadTemplate('saved',${i})`,
        `<span title="Delete" onclick="event.stopPropagation(); valDeleteTemplate(${i})" style="color:var(--text-muted); padding:0 4px;">&times;</span>`));
    menu.innerHTML = html;
    menu.style.display = 'block';
    setTimeout(() => document.addEventListener('click', valCloseTemplatesOnce), 0);
}
function valCloseTemplatesOnce() {
    const m = document.getElementById('valTemplatesMenu');
    if (m) m.style.display = 'none';
    document.removeEventListener('click', valCloseTemplatesOnce);
}
function valLoadTemplate(kind, i) {
    const t = kind === 'starter' ? VAL_STARTERS[i] : valGetSaved()[i];
    if (t) valSetText(t.script);
    const m = document.getElementById('valTemplatesMenu'); if (m) m.style.display = 'none';
}
async function valDeleteTemplate(i) {
    const arr = valGetSaved();
    const t = arr[i]; if (!t) return;
    const ok = await Confirm.show(`Delete template "${t.name}"?`);
    if (!ok) { valToggleTemplates(null); return; }
    arr.splice(i, 1); valSetSaved(arr);
    const m = document.getElementById('valTemplatesMenu'); if (m) m.style.display = 'none';
    valToggleTemplates(null);
}

// ---- Run (all or selection) -------------------------------------------------------------------

function getScriptToRun(useSelection) {
    if (_valAce) {
        if (useSelection && !_valAce.selection.isEmpty()) {
            const r = _valAce.getSelectionRange();
            const lines = [];
            for (let i = r.start.row; i <= r.end.row; i++) lines.push(_valAce.session.getLine(i));
            return lines.join('\n').trim();
        }
        return _valAce.getValue().trim();
    }
    const ed = document.getElementById('valEditor');
    const full = ed ? ed.value : '';
    if (useSelection && ed && ed.selectionStart !== ed.selectionEnd) {
        let s = ed.selectionStart, e = ed.selectionEnd;
        s = full.lastIndexOf('\n', s - 1) + 1;
        const nl = full.indexOf('\n', e);
        e = nl === -1 ? full.length : nl;
        return full.slice(s, e).trim();
    }
    return full.trim();
}

async function runValidation(useSelection) {
    const script = getScriptToRun(useSelection);
    if (!script) {
        Toast.warning(useSelection ? 'Select a block to run, or use Run All.' : 'Write a script first.');
        return;
    }
    await valRunScript(script);
}

/** Run an explicit script text (used by Run All/Selection and the per-block gutter run). */
async function valRunScript(script) {
    if (!script || !script.trim()) return;
    const fileId = document.getElementById('valFileSelect')?.value || '';
    const runAll = document.getElementById('runValBtn');
    const runSel = document.getElementById('runSelBtn');
    const execInfo = document.getElementById('valExecInfo');

    [runAll, runSel].forEach(b => b && (b.disabled = true));
    if (execInfo) execInfo.textContent = 'Running…';

    try {
        const body = { script };
        if (fileId) body.file_id = fileId;

        // Go through the api client so a 401 auto-refreshes the token (and non-JSON / error
        // responses surface a clear message instead of "Unexpected end of JSON input").
        const result = await api.request(`/research/projects/${projectId}/validation/run`, {
            method: 'POST',
            body: JSON.stringify(body),
            _skipSpinner: true
        });

        if (!result || result.success === false) {
            _valLastResult = null;
            showValidationInPopup(`<div class="query-error" style="display:block;">${vEsc((result && (result.error || result.message)) || 'Validation failed to run.')}</div>`, '');
            if (execInfo) execInfo.textContent = 'failed';
            return;
        }

        renderValidationReport(result);
        if (execInfo) execInfo.textContent = `${formatNumber(result.total_blocks || 0)} block(s) · ${result.execution_time_ms || 0}ms`;
    } catch (err) {
        _valLastResult = null;
        const m = err?.message || String(err);
        const msg = /session expired/i.test(m) ? 'Your session expired — reload the page and sign in again.'
            : /failed to fetch|networkerror/i.test(m) ? 'Could not reach the validation service. Is the backend running?'
            : m;   // a 400 from a script/parse error carries the real reason here
        showValidationInPopup(`<div class="query-error" style="display:block;">${vEsc(msg)}</div>`, '');
        if (execInfo) execInfo.textContent = 'error';
    } finally {
        [runAll, runSel].forEach(b => b && (b.disabled = false));
    }
}

function showValidationInPopup(html, infoText) {
    const container = document.getElementById('fnResultsContent');
    if (container) container.innerHTML = html;
    if (typeof showFnPopup === 'function') showFnPopup(0, 0);
    // First time, dock the popup to the right so it never covers the editor's Run buttons.
    // showFnPopup restores the user's own position on later runs once they've dragged it.
    const popup = document.getElementById('fnPopup');
    if (popup && !_valPopupPositioned) {
        _valPopupPositioned = true;
        popup.style.left = 'auto';
        popup.style.right = '24px';
        popup.style.top = '96px';
        popup.style.width = 'min(680px, 48vw)';
        popup.style.height = 'min(720px, 76vh)';
    }
    const info = document.getElementById('fnPopupInfo');
    if (info) info.textContent = infoText || '';
}

/**
 * Unified, SPSS-style output: one section per block, each rendered by its kind
 * (check → flagged respondents, derive → new variable + frequency, weight → RIM
 * report, error → message). No single shape is imposed on every function.
 */
let _valTables = {};     // per-table export registry: id -> { name, columns, rows }
let _valFailsOnly = false;

function renderValidationReport(result) {
    _valLastResult = result;
    _valTables = {};
    _valFailsOnly = false;
    const blocks = result.summary || [];
    const flagged = result.bad_respondents || 0;
    const errBlocks = result.error_blocks || 0;
    const hasChecks = blocks.some(b => b.kind === 'check');
    const anyFlagged = (result.errors || []).length > 0;

    // group flagged respondents by their block seq so each check renders its own table
    const bySeq = {};
    (result.errors || []).forEach(e => { (bySeq[e.seq] = bySeq[e.seq] || []).push(e); });

    // ---- adaptive run bar: only the pills that make sense for what ran ----
    const pills = [
        `<span class="out-pill"><b>${formatNumber(blocks.length)}</b> block${blocks.length === 1 ? '' : 's'}</span>`,
        `<span class="out-pill"><b>${formatNumber(result.execution_time_ms || 0)}</b> ms</span>`
    ];
    if (errBlocks > 0) pills.push(`<span class="out-pill err"><b>${formatNumber(errBlocks)}</b> errored</span>`);
    if (hasChecks) pills.push(`<span class="out-pill ${flagged > 0 ? 'warn' : 'ok'}"><b>${formatNumber(flagged)}</b> flagged</span>`);
    pills.push(`<span style="margin-left:auto; display:inline-flex; gap:6px; align-items:center;">
        ${anyFlagged ? '<button class="out-mini-btn" onclick="valCopyExcel()">Copy flagged</button>' : ''}
        <button class="out-mini-btn" onclick="valExportRun()">Export run</button>
        <button class="out-mini-btn" id="valFailsBtn" onclick="valToggleFailsOnly()">Fails only</button>
        <button class="out-mini-btn" onclick="valCollapseAll()">Collapse all</button>
    </span>`);

    const nav = blocks.map(b => {
        const cls = b.status === 'fail' ? 'warn' : b.status === 'error' ? 'err' : 'ok';
        return `<div class="out-nav-item" onclick="valScrollToBlock(${b.seq})" title="${vEsc(b.function)}">
            <span class="dot ${cls}"></span><span class="nm">${vEsc(b.function)}</span></div>`;
    }).join('');

    const body = blocks.length
        ? blocks.map(b => valRenderBlock(b, bySeq[b.seq] || [])).join('')
        : '<div class="out-empty">Nothing ran.</div>';

    const html = `<div class="out">
        <div class="out-runbar">${pills.join('')}</div>
        <div class="out-split">
            ${blocks.length > 1 ? `<div class="out-nav">${nav}</div>` : ''}
            <div class="out-main" id="valOutMain">${body}</div>
        </div>
    </div>`;
    const info = `${formatNumber(blocks.length)} block(s) · ${result.execution_time_ms || 0}ms`;
    showValidationInPopup(html, info);
    valSetEditorMarkers(result);   // inline error/warning markers in the editor gutter
    valRecordRun(result);          // save to run history
}

const OUT_KIND_LABEL = { check: 'Check', script: 'Script', derive: 'Data prep', weight: 'Weighting', directive: 'Directive', error: 'Error' };
const OUT_STATUS_CLASS = { pass: 'ok', ok: 'ok', fail: 'warn', error: 'err' };

/** Render one collapsible block section, dispatched by its kind. */
function valRenderBlock(b, errs) {
    const kind = b.kind || (b.status === 'error' ? 'error' : 'check');
    const badge = `<span class="val-badge val-${OUT_STATUS_CLASS[b.status] || 'muted'}">${vEsc(b.status)}</span>`;
    const time = (b.execution_time_ms != null) ? `${formatNumber(b.execution_time_ms)} ms` : '';
    const head = `<div class="out-block-head" onclick="valToggleBlock(${b.seq})">
        <span class="out-caret">▾</span>
        <span class="out-seq">${b.seq}</span>
        <span class="out-fn">${vEsc(b.function)}</span>
        <span class="out-kind">${OUT_KIND_LABEL[kind] || ''}</span>
        ${badge}
        <span class="out-time">${time}</span>
    </div>`;
    let inner;
    if (kind === 'error') inner = `<div class="out-err-msg">${vEsc(b.message || 'This block failed.')}</div>`;
    else if (kind === 'weight') inner = valBlockWeight(b);
    else if (kind === 'derive') inner = valBlockDerive(b);
    else if (kind === 'script') inner = valBlockScript(b);
    else if (kind === 'directive') inner = `<p class="out-msg"><span class="ok-tick">✓</span> Respondent id set to <code>${vEsc(b.target || '')}</code>.</p>`;
    else inner = valBlockCheck(b, errs);
    inner += valOutputPanel(b);   // csharp Print(...) lines, if any
    return `<div class="out-block k-${kind}" id="outblk-${b.seq}" data-status="${vEsc(b.status)}">${head}<div class="out-body">${inner}</div></div>`;
}

/** Console-style panel of Print(...) lines emitted by a csharp block. Hidden when nothing was printed. */
function valOutputPanel(b) {
    const lines = b.output || [];
    if (!lines.length) return '';
    const body = lines.map(l => vEsc(l)).join('\n');
    return `<div class="out-console">
        <div class="out-console-head"><span class="out-console-dot"></span>Output · Print(${lines.length})</div>
        <pre class="out-console-body">${body}</pre>
    </div>`;
}

/** Validation check: pass line, or a per-block flagged-respondents table (rows drill into the record). */
function valBlockCheck(b, errs) {
    const base = `Base ${formatNumber(b.base_size || 0)}${b.target ? ` · ${vEsc(b.target)}` : ''}`;
    if (b.status !== 'fail') {
        return `<p class="out-msg"><span class="ok-tick">✓</span> Pass — no respondents flagged.</p><p class="out-sub">${base}</p>`;
    }
    const CAP = 500;
    const rows = errs.slice(0, CAP).map(e => `<tr>
        <td><span class="out-drill" onclick="valDrillResp(${Number(e.rid) || 0})">${vEsc(e.respid || e.rid)}</span></td>
        <td><span class="val-badge val-warn">${vEsc(e.type)}</span></td>
        <td>${vEsc(e.question)}</td>
        <td class="wrap" style="color:var(--text-secondary);">${vEsc(e.detail)}</td>
    </tr>`).join('');
    const more = errs.length > CAP ? `<p class="out-sub">Showing ${CAP} of ${formatNumber(errs.length)}.</p>` : '';
    const id = 'tbl-' + b.seq;
    valRegTable(id, `${b.function} — flagged respondents`, ['Respondent', 'Issue', 'Question', 'Detail'],
        errs.map(e => [e.respid || e.rid, e.type, e.question, e.detail]));
    return `<p class="out-msg">⚠ <b>${formatNumber(b.bad_count || errs.length)}</b> respondent(s) flagged.</p>
        <p class="out-sub">${base} · click a respondent to see their full record</p>
        ${valExportBar(id)}
        <div class="out-tbl-wrap"><table class="out-tbl">
            <thead><tr><th>Respondent</th><th>Issue</th><th>Question</th><th>Detail</th></tr></thead>
            <tbody>${rows}</tbody></table></div>${more}`;
}

/** csharp SCRIPT: the variable operations the script performed (create/update/delete), colour-coded. */
function valBlockScript(b) {
    const rows = b.rows || [];
    const msg = b.message ? vEsc(b.message) : 'Script ran.';
    if (!rows.length)
        return `<p class="out-msg"><span class="ok-tick">✓</span> ${msg}</p><p class="out-sub">No variable operations performed.</p>`;
    const cls = op => op === 'delete' ? 'val-err' : op === 'update' ? 'val-warn' : 'val-ok';
    const body = rows.map(r => `<tr>
        <td><span class="val-badge ${cls(String(r.operation))}">${vEsc(r.operation)}</span></td>
        <td><code>${vEsc(r.variable)}</code></td>
        <td class="wrap" style="color:var(--text-secondary);">${vEsc(r.detail)}</td>
    </tr>`).join('');
    return `<p class="out-msg"><span class="ok-tick">✓</span> ${msg}</p>
        <div class="out-tbl-wrap"><table class="out-tbl">
            <thead><tr><th>Operation</th><th>Variable</th><th>Detail</th></tr></thead>
            <tbody>${body}</tbody></table></div>`;
}

/** Data-prep: "created variable X" + a frequency table when the function returned one. */
function valBlockDerive(b) {
    const msg = b.message ? vEsc(b.message) : `Created ${b.target ? 'variable ' + vEsc(b.target) : 'a new variable'}.`;
    let html = `<p class="out-msg"><span class="ok-tick">✓</span> ${msg}</p>`;
    if (b.rows && b.rows.length) html += valFreqTable(b.rows, 'tbl-' + b.seq, `${b.target || b.function} — frequency`);
    return html;
}

/** RIM weighting: efficiency/convergence stats + target-vs-achieved report. */
function valBlockWeight(b) {
    const s = b.statistics || {};
    const chips = [];
    const push = (k, v) => { if (v != null && v !== '') chips.push(`<div class="out-stat"><span class="k">${k}</span><span class="v">${v}</span></div>`); };
    if (s.efficiency != null) push('Efficiency', valNum(s.efficiency, 1) + '%');
    if (s.n_rows != null) push('Base', formatNumber(s.n_rows));
    if (s.converged != null) push('Converged', s.converged ? 'Yes' : 'No');
    if (s.iterations != null) push('Iterations', formatNumber(s.iterations));
    if (s.sum != null) push('Σ weights', valNum(s.sum, 2));
    if (s.min != null) push('Min', valNum(s.min, 3));
    if (s.max != null) push('Max', valNum(s.max, 3));

    const msg = b.message ? '' : `<p class="out-msg"><span class="ok-tick">✓</span> Weight <code>${vEsc(b.target || '')}</code> created.</p>`;
    const src = b.rows || [];
    const rows = src.map(r => {
        const t = Number(r.target_pct) || 0, a = Number(r.achieved_pct) || 0, gap = a - t;
        const gcls = Math.abs(gap) < 0.05 ? '' : (gap > 0 ? 'out-gap-pos' : 'out-gap-neg');
        return `<tr>
            <td>${vEsc(r.variable)}</td>
            <td>${vEsc(r.code)}</td>
            <td class="num">${t.toFixed(1)}%</td>
            <td class="num">${a.toFixed(1)}%</td>
            <td class="num ${gcls}">${gap > 0 ? '+' : ''}${gap.toFixed(1)}</td>
        </tr>`;
    }).join('');
    let table = '';
    if (rows) {
        const id = 'tbl-' + b.seq;
        valRegTable(id, `${b.target || b.function} — weighting report`, ['Variable', 'Code', 'Target %', 'Achieved %', 'Gap'],
            src.map(r => [r.variable, r.code, (Number(r.target_pct) || 0).toFixed(1), (Number(r.achieved_pct) || 0).toFixed(1),
                ((Number(r.achieved_pct) || 0) - (Number(r.target_pct) || 0)).toFixed(1)]));
        table = `${valExportBar(id)}<div class="out-tbl-wrap"><table class="out-tbl">
            <thead><tr><th>Variable</th><th>Code</th><th class="num">Target</th><th class="num">Achieved</th><th class="num">Gap</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }
    return `${msg}<div class="out-stats">${chips.join('')}</div>${table}`;
}

/** A code/label/count frequency table (with % of total), for compute_variable etc. */
function valFreqTable(rows, id, name) {
    if (!rows.length || !('count' in rows[0])) return valGenericTable(rows);
    const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const body = rows.map(r => {
        const c = Number(r.count) || 0, pct = total ? (c / total * 100) : 0;
        const code = (r.code == null || r.code === '') ? '—' : r.code;
        return `<tr>
            <td>${vEsc(code)}</td>
            <td>${vEsc(r.label != null ? r.label : '')}</td>
            <td class="num">${formatNumber(c)}</td>
            <td class="num">${pct.toFixed(1)}%</td>
        </tr>`;
    }).join('');
    if (id) valRegTable(id, name || 'Frequency', ['Code', 'Label', 'Count', '%'],
        rows.map(r => { const c = Number(r.count) || 0; return [r.code, r.label, c, (total ? (c / total * 100) : 0).toFixed(1)]; }));
    return `${id ? valExportBar(id) : ''}<div class="out-tbl-wrap"><table class="out-tbl">
        <thead><tr><th>Code</th><th>Label</th><th class="num">Count</th><th class="num">%</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td></td><td style="color:var(--text-muted);">Total</td><td class="num"><b>${formatNumber(total)}</b></td><td class="num">100.0%</td></tr></tfoot>
    </table></div>`;
}

/** Fallback: render any rows[] as-is using their own keys as columns. */
function valGenericTable(rows) {
    if (!rows || !rows.length) return '';
    const cols = Object.keys(rows[0]);
    const head = cols.map(c => `<th>${vEsc(c)}</th>`).join('');
    const body = rows.map(r => `<tr>${cols.map(c => `<td>${vEsc(r[c] != null ? r[c] : '')}</td>`).join('')}</tr>`).join('');
    return `<div class="out-tbl-wrap"><table class="out-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Format a possibly-fractional number to n decimals, trimming trailing zeros. */
function valNum(v, n) {
    const x = Number(v);
    if (!isFinite(x)) return vEsc(String(v));
    return parseFloat(x.toFixed(n)).toString();
}

// ---- Output: collapse, outline nav, fails-only -----------------------------------------------

function valToggleBlock(seq) { const el = document.getElementById('outblk-' + seq); if (el) el.classList.toggle('collapsed'); }
function valScrollToBlock(seq) {
    const el = document.getElementById('outblk-' + seq);
    if (!el) return;
    el.classList.remove('collapsed'); el.style.display = '';
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function valCollapseAll() {
    const main = document.getElementById('valOutMain'); if (!main) return;
    const blocks = [...main.querySelectorAll('.out-block')];
    const anyOpen = blocks.some(b => !b.classList.contains('collapsed'));
    blocks.forEach(b => b.classList.toggle('collapsed', anyOpen));
}
function valToggleFailsOnly() {
    _valFailsOnly = !_valFailsOnly;
    const main = document.getElementById('valOutMain'); if (!main) return;
    main.querySelectorAll('.out-block').forEach(bl => {
        const st = bl.getAttribute('data-status');
        const clean = !(st === 'fail' || st === 'error');
        bl.style.display = (_valFailsOnly && clean) ? 'none' : '';
    });
    const btn = document.getElementById('valFailsBtn');
    if (btn) { btn.style.background = _valFailsOnly ? 'var(--brand-primary)' : ''; btn.style.color = _valFailsOnly ? '#fff' : ''; }
}

// ---- Per-table + whole-run export ------------------------------------------------------------

function valRegTable(id, name, columns, rows) {
    _valTables[id] = { name, columns, rows: rows.map(r => r.map(c => (c == null ? '' : c))) };
}
function valExportBar(id) {
    const t = _valTables[id]; if (!t) return '';
    return `<div class="out-tbl-bar"><span class="lbl">${vEsc(t.name)}</span>
        <button class="out-mini-btn" onclick="valCopyTbl('${id}')">Copy</button>
        <button class="out-mini-btn" onclick="valCsvTbl('${id}')">CSV</button></div>`;
}
function valCopyTbl(id) {
    const t = _valTables[id]; if (!t) return;
    const clean = c => String(c == null ? '' : c).replace(/[\t\n\r]/g, ' ');
    const tsv = [t.columns.join('\t')].concat(t.rows.map(r => r.map(clean).join('\t'))).join('\n');
    navigator.clipboard.writeText(tsv)
        .then(() => Toast.success(`Copied ${formatNumber(t.rows.length)} rows — paste into Excel`))
        .catch(() => Toast.error('Copy failed'));
}
function valCsvTbl(id) {
    const t = _valTables[id]; if (!t) return;
    valDownloadCsvFile(valToCsv(t.columns, t.rows), (t.name || 'table').replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.csv');
    Toast.success(`Downloaded ${formatNumber(t.rows.length)} rows`);
}
function valToCsv(columns, rows) {
    const esc = c => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [columns.map(esc).join(',')].concat(rows.map(r => r.map(esc).join(','))).join('\n');
}
function valDownloadCsvFile(csv, filename) {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/** Download the whole run as a standalone, self-contained HTML QA report. */
function valExportRun() {
    const r = _valLastResult; if (!r) { Toast.warning('Run a script first.'); return; }
    const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const tbl = t => `<table><thead><tr>${t.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${t.rows.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const parts = (r.summary || []).map(b => {
        let h = `<h2>#${b.seq} ${esc(b.function)} <small>[${esc(b.status)}]</small></h2>`;
        if (b.message) h += `<p>${esc(b.message)}</p>`;
        if (b.status === 'error') h += `<pre class="err">${esc(b.message || 'failed')}</pre>`;
        if (b.status === 'pass') h += `<p class="ok">Pass — no respondents flagged. Base ${b.base_size || 0}.</p>`;
        const t = _valTables['tbl-' + b.seq];
        if (t) h += tbl(t);
        return h;
    }).join('');
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Data QA report</title><style>
        body{font-family:system-ui,-apple-system,Arial,sans-serif;margin:32px;color:#111;max-width:900px}
        h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #e2e2e2;padding-bottom:4px}
        small{color:#999;font-weight:400} .sub{color:#666;font-size:13px;margin:0 0 8px}
        table{border-collapse:collapse;font-size:12px;margin:6px 0}
        th,td{border:1px solid #e2e2e2;padding:4px 9px;text-align:left} th{background:#f6f6f6}
        pre.err{background:#fdecec;color:#b91c1c;padding:8px 10px;border-radius:5px;font-size:12px;white-space:pre-wrap}
        p.ok{color:#0a7d43} p{font-size:13px}
      </style></head><body>
      <h1>Data QA report</h1>
      <p class="sub">${(r.summary || []).length} blocks · ${r.bad_respondents || 0} respondents flagged · ${r.error_blocks || 0} errored · generated ${esc(new Date().toLocaleString())}</p>
      ${parts}</body></html>`;
    const blob = new Blob([doc], { type: 'text/html;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'data_qa_report.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    Toast.success('QA report downloaded');
}

// ---- Export ALL flagged respondents (across every check) --------------------------------------

function valExportRows() {
    const errs = (_valLastResult && _valLastResult.errors) || [];
    return errs.map(e => [e.respid || e.rid, e.check, e.type, e.question, e.detail]);
}
function valCopyExcel() {
    const rows = valExportRows();
    const clean = c => String(c == null ? '' : c).replace(/[\t\n\r]/g, ' ');
    const tsv = [['Respondent', 'Check', 'Type', 'Question', 'Detail'].join('\t')]
        .concat(rows.map(r => r.map(clean).join('\t'))).join('\n');
    navigator.clipboard.writeText(tsv)
        .then(() => Toast.success(`Copied ${formatNumber(rows.length)} rows — paste into Excel`))
        .catch(() => Toast.error('Copy failed'));
}
function valDownloadCsv() {
    const rows = valExportRows();
    valDownloadCsvFile(valToCsv(['Respondent', 'Check', 'Type', 'Question', 'Detail'], rows), 'flagged_respondents.csv');
    Toast.success(`Downloaded ${formatNumber(rows.length)} rows`);
}

// ---- Inline editor markers + per-block gutter run --------------------------------------------

/** After a run, annotate the editor gutter: errors on errored block lines, warnings on failing ones. */
function valSetEditorMarkers(result) {
    if (!_valAce) return;
    const anns = [];
    (result.summary || []).forEach(b => {
        if (!b.line) return;
        if (b.status === 'error') anns.push({ row: b.line - 1, column: 0, type: 'error', text: b.message || 'This block failed.' });
        else if (b.status === 'fail') anns.push({ row: b.line - 1, column: 0, type: 'warning', text: `${b.bad_count || 0} respondent(s) flagged.` });
    });
    _valAce.session.setAnnotations(anns);
}

/**
 * Parse the editor text into top-level constructs (string-aware) for gutter run + outline.
 * A `for`/`if` construct is captured whole (header + body, incl. else / else-if chains), so the
 * gutter ▶ next to a `for`/`if` runs the entire loop / conditional.
 */
function valParseBlocks(text) {
    const blocks = []; const n = text.length; let i = 0;
    const rowAt = pos => { let r = 0; const end = Math.min(pos, n); for (let k = 0; k < end; k++) if (text[k] === '\n') r++; return r; };
    const skipTrivia = p => { while (p < n) { const c = text[p]; if (/\s/.test(c)) { p++; continue; } if (c === '#') { while (p < n && text[p] !== '\n') p++; continue; } break; } return p; };
    const isInterp = p => { // length of a {i}/{i+1} token at p, else 0
        if (text[p] !== '{') return 0; let j = p + 1;
        if (j >= n || !/[A-Za-z_]/.test(text[j])) return 0; j++;
        while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
        if (j < n && /[+\-*]/.test(text[j]) && j + 1 < n && /\d/.test(text[j + 1])) { j += 2; while (j < n && /\d/.test(text[j])) j++; }
        return (j < n && text[j] === '}') ? (j - p + 1) : 0;
    };
    const scanToBrace = p => { // next real body '{' (skip strings + interpolation), or -1
        let inStr = false;
        while (p < n) { const ch = text[p];
            if (inStr) { if (ch === '\\') { p += 2; continue; } if (ch === '"') inStr = false; p++; continue; }
            if (ch === '"') { inStr = true; p++; continue; }
            if (ch === '{') { const L = isInterp(p); if (L) { p += L; continue; } return p; }
            p++;
        }
        return -1;
    };
    const matchBrace = open => { let depth = 0, inStr = false;
        for (let j = open; j < n; j++) { const ch = text[j];
            if (inStr) { if (ch === '\\') { j++; continue; } if (ch === '"') inStr = false; continue; }
            if (ch === '"') { inStr = true; continue; }
            if (ch === '#') { while (j < n && text[j] !== '\n') j++; continue; }
            if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return j; }
        }
        return -1;
    };
    // C#-aware brace match for the raw csharp { … } body (skip strings, chars, // and /* */ comments).
    const matchBraceCs = open => { let depth = 0;
        for (let j = open; j < n; j++) { const ch = text[j];
            if (ch === '"') { for (j++; j < n; j++) { if (text[j] === '\\') { j++; continue; } if (text[j] === '"') break; } continue; }
            if (ch === "'") { for (j++; j < n; j++) { if (text[j] === '\\') { j++; continue; } if (text[j] === "'") break; } continue; }
            if (ch === '/' && text[j + 1] === '/') { while (j < n && text[j] !== '\n') j++; continue; }
            if (ch === '/' && text[j + 1] === '*') { j += 2; while (j + 1 < n && !(text[j] === '*' && text[j + 1] === '/')) j++; j++; continue; }
            if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return j; }
        }
        return -1;
    };
    const word = (p, w) => text.slice(p, p + w.length).toLowerCase() === w && !/[A-Za-z0-9_]/.test(text[p + w.length] || ' ');

    while (i < n) {
        i = skipTrivia(i);
        if (i >= n) break;
        const idStart = i;
        while (i < n && /[A-Za-z0-9_]/.test(text[i])) i++;
        if (i === idStart) { i++; continue; }
        const fn = text.slice(idStart, i).toLowerCase();

        if (fn === 'for' || fn === 'if') {
            const bp = scanToBrace(i); if (bp < 0) break;
            let end = matchBrace(bp); if (end < 0) break;
            if (fn === 'if') { // swallow else / else if chains
                let more = true;
                while (more) {
                    let k = skipTrivia(end + 1);
                    if (!word(k, 'else')) { more = false; break; }
                    k = skipTrivia(k + 4);
                    if (word(k, 'if')) { const b2 = scanToBrace(k + 2); if (b2 < 0) { more = false; break; } const e2 = matchBrace(b2); if (e2 < 0) { more = false; break; } end = e2; }
                    else { const b2 = scanToBrace(k); if (b2 < 0) { more = false; break; } const e2 = matchBrace(b2); if (e2 < 0) { more = false; break; } end = e2; more = false; }
                }
            }
            blocks.push({ fn, startRow: rowAt(idStart), endRow: rowAt(end), text: text.slice(idStart, end + 1) });
            i = end + 1;
            continue;
        }

        i = skipTrivia(i);
        if (i >= n || text[i] !== '{') continue;
        const end = (fn === 'csharp' ? matchBraceCs(i) : matchBrace(i)); if (end < 0) break;
        blocks.push({ fn, startRow: rowAt(idStart), endRow: rowAt(end), text: text.slice(idStart, end + 1) });
        i = end + 1;
    }
    return blocks;
}

let _valGutterRows = [];
let _valBlocksParsed = [];
/** Put a ▶ run glyph in the gutter at each block's first line. */
function valRefreshGutter() {
    if (!_valAce) return;
    const sess = _valAce.session;
    _valGutterRows.forEach(r => sess.removeGutterDecoration(r, 'val-runnable'));
    _valBlocksParsed = valParseBlocks(_valAce.getValue());
    _valGutterRows = _valBlocksParsed.map(b => b.startRow);
    _valGutterRows.forEach(r => { try { sess.addGutterDecoration(r, 'val-runnable'); } catch (e) { /* row gone */ } });
}

// ---- Checks reference panel -------------------------------------------------------------------

/** Show the checks reference in the app's shared Function Info slide panel (right side). */
async function toggleValidationChecks() {
    const panel = document.getElementById('fnInfoSlidePanel');
    const overlay = document.getElementById('fnInfoPanelOverlay');
    const body = document.getElementById('fnInfoPanelBody');
    if (!panel || !body) return;

    if (panel.classList.contains('active') && panel._showingChecks) {   // toggle closed
        panel.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        panel._showingChecks = false;
        return;
    }

    await valLoadChecksData();
    const titleEl = panel.querySelector('.panel-title');
    if (titleEl) titleEl.textContent = 'Syntax reference';

    const byCat = {};
    _valChecks.forEach(c => { (byCat[c.category] = byCat[c.category] || []).push(c); });
    const catLabel = k => k === 'validation' ? 'Validation checks'
        : k === 'data_manipulation' ? 'Data-prep / derive' : k;

    _valDocBlocks = [];   // registry of insertable syntax blocks, referenced by index

    let html = ''
        + '<div class="val-ref-hint">Each function below expands to show what it does, every parameter, '
        + 'and worked examples you can drop straight into the editor.</div>'
        + '<input class="val-ref-search" type="text" placeholder="Filter functions…" '
        + 'oninput="valFilterDocs(this.value)" autocomplete="off">'
        + valControlFlowDoc();

    Object.keys(byCat).sort().forEach(cat => {
        html += `<div class="val-ref-cat" data-cat="${vEsc(cat)}">${vEsc(catLabel(cat))}</div>`;
        byCat[cat].forEach(c => { html += valRenderFnDoc(c); });
    });

    body.innerHTML = html || '<div style="color:var(--text-muted);">No functions available.</div>';
    panel._showingChecks = true;
    panel.classList.add('active');
    if (overlay) overlay.classList.add('active');
}

// Registry of full "name { … }" blocks so example Insert buttons can reference them by index
// without embedding JSON (and its quotes) inside inline onclick handlers.
let _valDocBlocks = [];

/** Render one function as a collapsible <details> doc card. */
function valRenderFnDoc(c) {
    const desc = c.description || '';
    const lead = valFirstSentence(desc);
    const params = valSchemaParams(c.input_schema);
    const searchText = vEsc((c.name + ' ' + desc).toLowerCase());

    let body = `<div class="val-fn-body">`;
    if (desc && desc !== lead) body += `<p class="val-fn-desc">${vEsc(desc)}</p>`;

    if (params.length) {
        body += `<div class="val-sec-h">Parameters</div>`;
        params.forEach(p => {
            const badge = p.required === true
                ? '<span class="val-req req">required</span>'
                : p.required === false ? '<span class="val-req opt">optional</span>' : '';
            body += `<div class="val-param">
                <div class="val-param-name">${vEsc(p.name)}${badge}</div>
                <div class="val-param-desc">${vEsc(p.desc || '')}</div>
            </div>`;
        });
    }

    const examples = Array.isArray(c.examples) ? c.examples : [];
    if (examples.length) {
        body += `<div class="val-sec-h">Examples</div>`;
        examples.forEach(ex => {
            const use = ex.user_question || ex.description || '';
            const block = valSyntaxBlock(c.name, ex.input_params);
            const idx = _valDocBlocks.push(block) - 1;
            body += `<div class="val-ex">`;
            if (use) body += `<div class="val-ex-use">${vEsc(use)}</div>`;
            body += `<pre class="val-ex-code">${vEsc(block)}</pre>`;
            if (ex.expected_output) body += `<div class="val-ex-res"><b>Result:</b> ${vEsc(ex.expected_output)}</div>`;
            body += `<div class="val-ex-actions"><button class="val-ex-insert" onclick="valInsertBlock(${idx})">Insert this example</button></div>`;
            body += `</div>`;
        });
    }

    body += `<button class="val-fn-insert" onclick="event.preventDefault(); valInsertCheck('${vEsc(c.name)}')">Insert blank ${vEsc(c.name)} block</button>`;
    body += `</div>`;

    return `<details class="val-fn" data-search="${searchText}">
        <summary><span class="val-fn-name">${vEsc(c.name)}</span><span class="val-fn-lead">${vEsc(lead)}</span></summary>
        ${body}
    </details>`;
}

/** First sentence of a description (for the collapsed one-liner). */
function valFirstSentence(text) {
    if (!text) return '';
    const m = text.match(/^.*?[.!?](?=\s|$)/);
    return (m ? m[0] : text).trim();
}

/**
 * Normalize either input_schema shape into a flat param list:
 *  - JSON-Schema style:  { type:'object', properties:{ p:{ description, nullable } } }
 *  - flat style:         { p:'description', filter:{ expression:'…' } }
 * Returns [{ name, desc, required }] where required is true/false/null (unknown).
 */
function valSchemaParams(schema) {
    if (!schema || typeof schema !== 'object') return [];
    const out = [];

    if (schema.properties && typeof schema.properties === 'object') {
        const reqList = Array.isArray(schema.required) ? schema.required : null;
        Object.entries(schema.properties).forEach(([name, v]) => {
            let desc = (v && typeof v === 'object' ? (v.description || '') : String(v || ''));
            let required = null;
            if (/^\s*REQUIRED\b/i.test(desc)) required = true;
            else if ((v && v.nullable === true) || /^\s*Optional\b/i.test(desc)) required = false;
            else if (reqList) required = reqList.includes(name);
            desc = desc.replace(/^\s*(REQUIRED|Optional)\.?\s*/i, '').trim();
            out.push({ name, desc, required });
        });
        return out;
    }

    // flat shape
    Object.entries(schema).forEach(([name, v]) => {
        let desc;
        if (v && typeof v === 'object') desc = v.expression || v.description || JSON.stringify(v);
        else desc = String(v || '');
        const d = desc.trim();
        // Required params open with "Required."/"REQUIRED."; optional ones say
        // "Optional…", mention a default, or use "leave it…/a condition/for <mode>…".
        let required = null;
        if (/^\s*required\b/i.test(d)) required = true;
        else if (/\boptional\b/i.test(d) || /\bdefault\b/i.test(d) || /\bleave it\b/i.test(d)
                 || /^\s*(a condition|the base to judge|leave off|for )\b/i.test(d)) required = false;
        // drop a leading Required/Optional token now that a badge carries it
        desc = d.replace(/^\s*(REQUIRED|Required|Optional)[.,]?\s+/, '');
        out.push({ name, desc, required });
    });
    return out;
}

/** Build a valid "name { …json… }" block from an example's input_params. */
function valSyntaxBlock(name, params) {
    if (params === undefined || params === null) return name + ' {  }';
    let obj = params;
    if (typeof params === 'string') { try { obj = JSON.parse(params); } catch { return name + ' ' + params; } }
    // csharp is a RAW-body block: render the code directly (indented, multi-line), not as a JSON string.
    if (name === 'csharp' && obj && typeof obj.code === 'string') {
        const body = obj.code.split('\n').map(l => '    ' + l).join('\n');
        return `csharp {\n${body}\n}`;
    }
    const oneLine = JSON.stringify(obj);
    const inner = oneLine.length <= 58 ? oneLine : JSON.stringify(obj, null, 2);
    return name + ' ' + inner;
}

/** Insert a full example block (by registry index) into the editor and close the panel. */
function valInsertBlock(idx) {
    const block = _valDocBlocks[idx];
    if (block == null) return;
    valInsertText(block, true);
}

/** Filter the reference cards by a query; hide category headers with no matches. */
function valFilterDocs(q) {
    const body = document.getElementById('fnInfoPanelBody');
    if (!body) return;
    const needle = (q || '').trim().toLowerCase();
    body.querySelectorAll('.val-fn').forEach(el => {
        const hit = !needle || (el.getAttribute('data-search') || '').includes(needle);
        el.style.display = hit ? '' : 'none';
        if (needle && hit) el.setAttribute('open', ''); else if (needle) el.removeAttribute('open');
    });
    // hide a category header when every function under it is hidden
    body.querySelectorAll('.val-ref-cat').forEach(cat => {
        let n = cat.nextElementSibling, anyVisible = false;
        while (n && !n.classList.contains('val-ref-cat')) {
            if (n.classList.contains('val-fn') && n.style.display !== 'none') { anyVisible = true; break; }
            n = n.nextElementSibling;
        }
        cat.style.display = anyVisible ? '' : 'none';
    });
}

/** Insert arbitrary text at the editor cursor; optionally close the reference panel. */
function valInsertText(text, closePanel) {
    if (_valAce) {
        _valAce.focus();
        _valAce.insert((_valAce.getValue() && !/\n\s*$/.test(_valAce.getValue().slice(-2)) ? '\n' : '') + text + '\n');
    } else {
        const t = document.getElementById('valEditor');
        if (t) t.value += (t.value && !t.value.endsWith('\n') ? '\n' : '') + text + '\n';
    }
    if (closePanel) {
        const panel = document.getElementById('fnInfoSlidePanel');
        const overlay = document.getElementById('fnInfoPanelOverlay');
        if (panel) { panel.classList.remove('active'); panel._showingChecks = false; }
        if (overlay) overlay.classList.remove('active');
    }
}

/** Insert a check block at the editor cursor and close the panel. */
function valInsertCheck(name) {
    const snippet = name + ' {  }';
    if (_valAce) {
        _valAce.focus();
        _valAce.insert(snippet);
        const p = _valAce.getCursorPosition();           // drop cursor between the braces
        _valAce.moveCursorTo(p.row, Math.max(0, p.column - 2));
    } else {
        const t = document.getElementById('valEditor');
        if (t) t.value += (t.value && !t.value.endsWith('\n') ? '\n' : '') + snippet;
    }
    const panel = document.getElementById('fnInfoSlidePanel');
    const overlay = document.getElementById('fnInfoPanelOverlay');
    if (panel) { panel.classList.remove('active'); panel._showingChecks = false; }
    if (overlay) overlay.classList.remove('active');
}

function valChip(label, value, kind) {
    return `<div class="val-chip val-${kind}">
        <span style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">${vEsc(label)}</span>
        <span style="font-size:1.1rem; font-weight:700;">${vEsc(value)}</span>
    </div>`;
}

/** Quote-safe HTML escape (locally scoped to avoid clobbering other modules' escapeHtml). */
function vEsc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==== Click-to-build form ======================================================================

async function valOpenBuilder() {
    await valLoadChecksData();
    if (!_valColumns.length) await valLoadColumns();
    if (!_valChecks.length) { Toast.warning('No functions available.'); return; }
    const body = document.getElementById('valBuilderBody');
    const opts = _valChecks.map(c => `<option value="${vEsc(c.name)}">${vEsc(c.name)} — ${vEsc(valFirstSentence(c.description).slice(0, 54))}</option>`).join('');
    body.innerHTML = `
        <div class="vb-row"><label class="vb-label">Function</label>
            <select class="vb-select" id="vbFn" onchange="valBuilderRenderParams()">${opts}</select></div>
        <div id="vbParams"></div>
        <label class="vb-label">Generated block</label>
        <div class="vb-preview" id="vbPreview"></div>
        <div class="vb-actions">
            <button class="btn btn-secondary btn-sm" onclick="valCloseBuilder()">Cancel</button>
            <button class="btn btn-primary btn-sm" onclick="valBuilderInsert()">Insert block</button>
        </div>`;
    document.getElementById('valBuilderOverlay').classList.add('active');
    valBuilderRenderParams();
}
function valCloseBuilder() { document.getElementById('valBuilderOverlay').classList.remove('active'); }

function valBuilderRenderParams() {
    const fn = document.getElementById('vbFn')?.value;
    const check = _valChecks.find(c => c.name === fn);
    const cont = document.getElementById('vbParams');
    if (!check) { cont.innerHTML = ''; valBuilderPreview(); return; }
    const params = valSchemaParams(check.input_schema);
    const dl = _valColumns.length ? `<datalist id="vbCols">${_valColumns.map(c => `<option value="${vEsc(c.name)}"></option>`).join('')}</datalist>` : '';
    cont.innerHTML = dl + params.map(p => {
        const req = p.required === true ? '<span class="req">required</span>' : p.required === false ? '<span class="opt">optional</span>' : '';
        const isVar = VAL_VAR_KEYS.has(p.name);
        const listAttr = isVar ? 'list="vbCols"' : '';
        const ph = p.name === 'filter' || p.name === 'rule' || p.name === 'asked_when' ? 'e.g. QAWARE = 1'
            : isVar ? 'e.g. ' + ((_valColumns[0] || {}).name || 'GENDER') : '';
        return `<div class="vb-row">
            <label class="vb-label">${vEsc(p.name)}${req}</label>
            ${p.desc ? `<div class="vb-help">${vEsc(p.desc)}</div>` : ''}
            <input class="vb-input" data-p="${vEsc(p.name)}" ${listAttr} placeholder="${vEsc(ph)}" oninput="valBuilderPreview()">
        </div>`;
    }).join('');
    valBuilderPreview();
}

function valBuilderValue(name, raw) {
    if (raw === '') return undefined;
    if (name === 'filter' || name === 'rule' || name === 'asked_when') return { expression: raw };
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw[0] === '[' || raw[0] === '{') { try { return JSON.parse(raw); } catch { /* keep as text */ } }
    return raw;
}
function valBuilderPreview() {
    const fn = document.getElementById('vbFn')?.value || '';
    const obj = {};
    document.querySelectorAll('#vbParams input[data-p]').forEach(inp => {
        const v = valBuilderValue(inp.getAttribute('data-p'), inp.value.trim());
        if (v !== undefined) obj[inp.getAttribute('data-p')] = v;
    });
    const block = fn + ' ' + JSON.stringify(obj);
    const pv = document.getElementById('vbPreview'); if (pv) pv.textContent = block;
    return block;
}
function valBuilderInsert() {
    valInsertText(valBuilderPreview(), false);
    valCloseBuilder();
    valRefreshGutter();
    Toast.success('Block inserted');
}

// ==== Auto-suggest checks from the file's variables ============================================

async function valSuggestChecks() {
    if (!_valColumns.length) await valLoadColumns();
    if (!_valColumns.length) { Toast.warning('Pick a file with variables first.'); return; }
    const cols = _valColumns;
    const lines = ['# Suggested QA — review the codes/filters, then run.'];

    const idVar = cols.find(c => /^(resp_?id|respondent_?id|serial|record|uuid|id)$/i.test(c.name));
    if (idVar) { lines.push(`respid { "variable": "${idVar.name}" }`); lines.push(`vc_dupe { "id": "${idVar.name}" }`); }

    // single-punch: categorical variables with 2..12 numeric codes in the data map
    let singles = 0;
    for (const c of cols) {
        if (singles >= 20) break;
        if (c.codes && c.codes.length >= 2 && c.codes.length <= 12) {
            const nums = c.codes.filter(x => /^-?\d+$/.test(x));
            if (nums.length === c.codes.length) { lines.push(`vc_single { "variable": "${c.name}", "values": "${nums.join(',')}" }`); singles++; }
        }
    }

    // date/time pair — match whole tokens (so GENDER's "end" substring can't false-trigger)
    const dateWord = (s, words) => new RegExp(`(^|[_\\s])(${words})([_\\s]|time|date|stamp|unix|$)`, 'i').test(s || '');
    const start = cols.find(c => dateWord(c.name, 'start|begin|starttime') || dateWord(c.label, 'start time|start date'));
    const end = cols.find(c => dateWord(c.name, 'end|finish|submit|complete|endtime') || dateWord(c.label, 'end time|finish time'));
    if (start && end && start.name !== end.name) lines.push(`vc_dates { "start": "${start.name}", "end": "${end.name}" }`);

    const alloc = cols.filter(c => /(alloc|constsum|points|allocate)/i.test(c.name));
    if (alloc.length >= 2) lines.push(`vc_sum { "variables": "${alloc.map(a => a.name).join(',')}", "total": 100 }`);

    const oe = cols.filter(c => /(string|char|text)/i.test(c.type) || /(_oe$|verbatim|other|specify|comment)/i.test(c.name));
    if (oe.length) {
        const list = oe.slice(0, 8).map(o => o.name).join(',');
        lines.push(`vc_texteffort { "variables": "${list}" }`);
        lines.push(`vc_pii { "variables": "${list}" }`);
    }

    if (lines.length === 1) { Toast.warning('No obvious checks detected — use Build to add one.'); return; }
    valInsertText(lines.join('\n'), false);
    valRefreshGutter();
    Toast.success(`Added ${lines.length - 1} suggested block(s) — review before running`);
}

// ==== Drill into a flagged respondent's full record ===========================================

async function valDrillResp(rid) {
    const fileId = document.getElementById('valFileSelect')?.value || '';
    if (!fileId || !rid) return;
    const ov = document.getElementById('valRespOverlay');
    const body = document.getElementById('valRespBody');
    document.getElementById('valRespTitle').textContent = 'Respondent record';
    body.innerHTML = '<div class="out-empty">Loading…</div>';
    ov.classList.add('active');
    try {
        const rec = await api.request(`/research/projects/${projectId}/validation/respondent?fileId=${encodeURIComponent(fileId)}&rid=${encodeURIComponent(rid)}`, { _skipSpinner: true });
        const flaggedVars = new Set((_valLastResult?.errors || []).filter(e => Number(e.rid) === Number(rid))
            .map(e => String(e.question || '').toUpperCase()));
        const rows = (rec.fields || []).map(f => {
            const val = f.label ? `${vEsc(f.value)} <span style="color:var(--text-muted)">(${vEsc(f.label)})</span>` : (vEsc(f.value) || '—');
            const fl = flaggedVars.has(String(f.variable).toUpperCase()) ? ' class="flagged"' : '';
            return `<tr${fl}><td>${vEsc(f.variable)}</td><td style="color:var(--text-secondary)">${vEsc(f.variable_label || '')}</td><td class="v">${val}</td></tr>`;
        }).join('');
        document.getElementById('valRespTitle').textContent = `Respondent · row ${vEsc(rec.rid)}`;
        body.innerHTML = `<input class="vr-search" placeholder="Filter variables…" oninput="valRespFilter(this.value)">
            <div style="overflow:auto; max-height:60vh;"><table class="vr-tbl" id="vrTbl">
            <thead><tr><th>Variable</th><th>Question</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } catch (e) { body.innerHTML = '<div class="out-empty">Could not load this record.</div>'; }
}
function valCloseResp() { document.getElementById('valRespOverlay').classList.remove('active'); }
function valRespFilter(q) {
    const needle = (q || '').trim().toLowerCase();
    document.querySelectorAll('#vrTbl tbody tr').forEach(tr => {
        tr.style.display = (!needle || tr.textContent.toLowerCase().includes(needle)) ? '' : 'none';
    });
}

// ==== Run history + compare ====================================================================

function valRunsKey() { return 'rz_dvs_runs_' + (typeof projectId !== 'undefined' ? projectId : 'x'); }
function valRecordRun(result) {
    try {
        const key = valRunsKey();
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.unshift({
            ts: Date.now(),
            blocks: (result.summary || []).length,
            flagged: result.bad_respondents || 0,
            errBlocks: result.error_blocks || 0,
            fileId: document.getElementById('valFileSelect')?.value || '',
            script: valGetText().slice(0, 20000)
        });
        localStorage.setItem(key, JSON.stringify(arr.slice(0, 25)));
    } catch (e) { /* history is best-effort */ }
}
function valToggleHistory(e) { if (e) e.stopPropagation(); valRenderHistory(); document.getElementById('valHistoryOverlay').classList.add('active'); }
function valCloseHistory() { document.getElementById('valHistoryOverlay').classList.remove('active'); }
function valFmtTime(ts) { try { return new Date(ts).toLocaleString(); } catch { return String(ts); } }
function valRenderHistory() {
    const body = document.getElementById('valHistoryBody');
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(valRunsKey()) || '[]'); } catch { arr = []; }
    if (!arr.length) { body.innerHTML = '<div class="out-empty">No runs yet — run a script and it will appear here.</div>'; return; }
    const items = arr.map((r, i) => {
        const prev = arr[i + 1];
        let delta = '';
        if (prev) { const d = r.flagged - prev.flagged; if (d !== 0) delta = `<span class="vh-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${formatNumber(d)} vs prev</span>`; }
        return `<div class="vh-item">
            <span class="vh-when">${vEsc(valFmtTime(r.ts))}</span>
            <span class="vh-meta">
                <span>${formatNumber(r.blocks)} blocks</span>
                <span>${formatNumber(r.flagged)} flagged</span>
                ${r.errBlocks ? `<span style="color:var(--color-danger,#ef4444)">${formatNumber(r.errBlocks)} errored</span>` : ''}
                ${delta}
            </span>
            <button class="out-mini-btn vh-load" onclick="valLoadHistoryRun(${i})">Load script</button>
        </div>`;
    }).join('');
    body.innerHTML = `<button class="out-mini-btn" style="margin-bottom:12px" onclick="valClearHistory()">Clear history</button>${items}`;
}
function valLoadHistoryRun(i) {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(valRunsKey()) || '[]'); } catch { arr = []; }
    const run = arr[i]; if (!run) return;
    valSetText(run.script || '');
    valRefreshGutter();
    valCloseHistory();
    Toast.success('Script loaded from history');
}
function valClearHistory() {
    try { localStorage.removeItem(valRunsKey()); } catch { /* ignore */ }
    valRenderHistory();
}

// ==== Control-flow reference (rendered at the top of the Syntax reference) =====================

function valControlFlowDoc() {
    const items = [
        {
            name: 'for', lead: 'Repeat a block over a range or list — {i} substitutes into the params.',
            desc: 'Unrolls the body once per value; write {i} (or {i+1}, {i-1}, {i*2}) inside any string. Forms: '
                + 'for i = 1:10 (range), for i = 1:10:2 (step), for i = 1,3,5 (list), for q in AGE, GENDER (tokens). '
                + 'Loops nest, and an inner range can use the outer variable, e.g. for j = 1:{i}.',
            examples: [
                { use: 'Range — check a 10-item grid Q10_1 … Q10_10 in one line.', block: 'for i = 1:10 {\n  vc_grid { "variables": "Q10_{i}", "values": "1:5" }\n}' },
                { use: 'Step — every other item (1, 3, 5, 7, 9).', block: 'for i = 1:10:2 {\n  vc_single { "variable": "Q{i}", "values": "1,2" }\n}' },
                { use: 'Token list — bound-check several named variables.', block: 'for q in AGE, INCOME, SPEND {\n  vc_range { "variable": "{q}", "min": 0, "max": 999 }\n}' },
                { use: 'Nested loops — a full rows × columns grid Q1_1 … Q5_4.', block: 'for r = 1:5 {\n  for c = 1:4 {\n    vc_single { "variable": "Q{r}_{c}", "values": "1,2" }\n  }\n}' },
                { use: 'Inner range depends on the outer variable — rank 1..i per statement.', block: 'for i = 1:3 {\n  for j = 1:{i} {\n    vc_single { "variable": "RANK{i}_{j}", "values": "1:5" }\n  }\n}' },
                { use: 'Arithmetic {i+1} — check consecutive pairs (a funnel across stages).', block: 'for i = 1:9 {\n  vc_funnel { "source": "STAGE_{i}", "target": "STAGE_{i+1}" }\n}' }
            ]
        },
        {
            name: 'if / else if / else', lead: 'Run checks only for respondents who match a condition.',
            desc: 'The condition is a full logical expression — combine terms with AND / OR / NOT, use comparisons '
                + '(=, <>, >, >=, <, <=), lists with IN (1, 2, 3), ranges with BETWEEN … AND …, and parentheses to group. '
                + 'It becomes a filter AND-ed into every check inside; else adds NOT of the condition, else if chains more, '
                + 'and the final else catches the rest. if / else and for nest freely.',
            examples: [
                { use: 'Combine conditions with AND / OR and parentheses.', block: 'if (WAVE = 1 OR WAVE = 2) AND GENDER = 1 {\n  for i = 1:10 { vc_grid { "variables": "Q10_{i}", "values": "1:5" } }\n}' },
                { use: 'Comparisons + an IN list.', block: 'if AGE >= 18 AND REGION IN (1, 2, 3) {\n  vc_single { "variable": "Q1", "values": "1,2" }\n}' },
                { use: 'else if with BETWEEN ranges and a catch-all.', block: 'if AGE BETWEEN 18 AND 34 {\n  vc_range { "variable": "SPEND", "min": 0, "max": 500 }\n} else if AGE BETWEEN 35 AND 54 {\n  vc_range { "variable": "SPEND", "min": 0, "max": 1500 }\n} else {\n  vc_range { "variable": "SPEND", "min": 0, "max": 4000 }\n}' },
                { use: 'NOT / <> to exclude a group.', block: 'if QAWARE = 1 AND QUSED <> 1 {\n  vc_single { "variable": "QWHYNOT", "values": "1:6" }\n}' },
                { use: 'Conditional per loop item — only check usage for brands they know.', block: 'for i = 1:8 {\n  if QAW_{i} = 1 {\n    vc_single { "variable": "QUSE_{i}", "values": "1,2" }\n  }\n}' }
            ]
        }
    ];
    let html = '<div class="val-ref-cat">Control flow</div>';
    items.forEach(it => {
        let body = `<div class="val-fn-body"><p class="val-fn-desc">${vEsc(it.desc)}</p><div class="val-sec-h">Examples</div>`;
        it.examples.forEach(ex => {
            const idx = _valDocBlocks.push(ex.block) - 1;
            body += `<div class="val-ex"><div class="val-ex-use">${vEsc(ex.use)}</div>`
                + `<pre class="val-ex-code">${vEsc(ex.block)}</pre>`
                + `<div class="val-ex-actions"><button class="val-ex-insert" onclick="valInsertBlock(${idx})">Insert this example</button></div></div>`;
        });
        body += '</div>';
        html += `<details class="val-fn" data-search="${vEsc((it.name + ' ' + it.desc + ' loop condition').toLowerCase())}">`
            + `<summary><span class="val-fn-name">${vEsc(it.name)}</span><span class="val-fn-lead">${vEsc(it.lead)}</span></summary>${body}</details>`;
    });
    return html;
}
