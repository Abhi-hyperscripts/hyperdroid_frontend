/**
 * Insights Brief Builder — UI module
 *
 * Opens BEFORE insights generation. Lets users specify:
 *   - Focus variables (key metrics the dashboard MUST analyze)
 *   - Mandatory cross-tabs (row × column combos)
 *   - Mandatory analyses (driver, cluster, correlation, trend)
 *   - Focus segments (filter expressions + labels)
 *   - Custom instructions (free text)
 *
 * Two exit paths:
 *   "Skip brief — let AI decide" → generates with no brief (fully autonomous)
 *   "Generate with brief"        → sends brief_json alongside the POST
 *
 * Public surface:
 *   openBriefBuilder(fileId, onGenerate)  — open the modal
 *   closeBriefBuilder()                   — close it
 */
(function () {
    'use strict';

    let _fileId = null;
    let _onGenerate = null;  // callback: (briefJson, useBaseline, briefStateJson) => void
    let _initialized = false;
    let _hasExistingDashboard = false;
    let _briefStateJson = null; // structured brief JSON to persist on backend

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    const state = {
        focusVariables: [],      // [{ variable, reason }]
        mandatoryCrossTabs: [],  // [{ row, column, note }]
        mandatoryAnalyses: {     // checkboxes
            trend: false,
            driver: false,
            cluster: false,
            correlation: false,
        },
        focusSegments: [],       // [{ expression, label, note }]
        customInstructions: '',
        waveVariable: '',        // wave/period identifier column name
    };

    // -----------------------------------------------------------------------
    // Open / close
    // -----------------------------------------------------------------------

    function resetBriefState() {
        state.focusVariables = [];
        state.mandatoryCrossTabs = [];
        state.mandatoryAnalyses = { trend: false, driver: false, cluster: false, correlation: false };
        state.focusSegments = [];
        state.customInstructions = '';
        state.waveVariable = '';
    }

    async function openBriefBuilder(fileId, onGenerate) {
        // Reset when switching files — state is module-scoped, so without this a brief filled
        // for file A would leak into file B (and B's own saved brief_json would never reload,
        // because the retained state makes isEmpty false below).
        if (_fileId !== fileId) resetBriefState();
        _fileId = fileId;
        _onGenerate = onGenerate;

        if (!_initialized) {
            _initialized = true;
            wireEventHandlers();
        }

        // Restore structured state from the backend's brief_json (persisted
        // in insights_dashboards). This works across browsers/devices since
        // it's stored server-side.
        const isEmpty = state.focusVariables.length === 0 &&
            state.mandatoryCrossTabs.length === 0 &&
            state.focusSegments.length === 0 &&
            !state.customInstructions &&
            !state.mandatoryAnalyses.trend &&
            !state.mandatoryAnalyses.driver &&
            !state.mandatoryAnalyses.cluster &&
            !state.mandatoryAnalyses.correlation;

        if (isEmpty && typeof api !== 'undefined' && typeof projectId !== 'undefined') {
            try {
                const insights = await api.request(
                    `/research/projects/${projectId}/files/${fileId}/insights`,
                    { _skipSpinner: true });
                // Load structured brief from brief_json
                if (insights?.brief_json) {
                    try {
                        const parsed = JSON.parse(insights.brief_json);
                        if (parsed.focusVariables) state.focusVariables = parsed.focusVariables;
                        if (parsed.mandatoryCrossTabs) state.mandatoryCrossTabs = parsed.mandatoryCrossTabs;
                        if (parsed.mandatoryAnalyses) state.mandatoryAnalyses = { ...state.mandatoryAnalyses, ...parsed.mandatoryAnalyses };
                        if (parsed.focusSegments) state.focusSegments = parsed.focusSegments;
                        if (parsed.customInstructions) state.customInstructions = parsed.customInstructions;
                        if (parsed.waveVariable) state.waveVariable = parsed.waveVariable;
                        console.info('[Brief] Restored structured state from backend brief_json');
                    } catch (e) {
                        console.warn('[Brief] Failed to parse brief_json:', e);
                    }
                }
                // Fallback: load from project's ai_instructions and parse
                // structured fields from the known format
                if (!state.customInstructions || state.focusVariables.length === 0) {
                    const proj = await api.request(`/research/projects/${projectId}`);
                    if (proj?.ai_instructions) {
                        parseInstructionsIntoState(proj.ai_instructions);
                    }
                }
            } catch (e) {
                // No existing insights — that's fine for first-time generation
                console.info('[Brief] No existing insights, starting fresh');
            }
        }

        // Check if an existing dashboard exists (for baseline/replay checkbox)
        _hasExistingDashboard = false;
        const baselineSection = document.getElementById('briefBaselineSection');
        const baselineSummary = document.getElementById('briefBaselineSummary');
        const baselineCheckbox = document.getElementById('briefUseBaseline');
        if (baselineSection && typeof api !== 'undefined' && typeof projectId !== 'undefined') {
            try {
                const insights = await api.request(`/research/projects/${projectId}/files/${fileId}/insights`, { _skipSpinner: true });
                if (insights?.status === 'ready' && insights?.dashboard_json) {
                    _hasExistingDashboard = true;
                    baselineSection.style.display = '';
                    // Show a summary of the existing dashboard
                    try {
                        const dash = JSON.parse(insights.dashboard_json);
                        const tabs = dash.tabs || [];
                        const chartCount = tabs.reduce((a, t) => a + (t.charts?.length || 0), 0);
                        const tabNames = tabs.map(t => t.tab_label || '?').join(', ');
                        if (baselineSummary) {
                            baselineSummary.style.display = '';
                            baselineSummary.textContent = `Existing: ${tabs.length} tabs, ${chartCount} charts — ${tabNames}`;
                        }
                    } catch { /* ignore parse errors */ }
                } else {
                    baselineSection.style.display = 'none';
                }
            } catch {
                baselineSection.style.display = 'none';
            }
        }

        render();

        // Populate wave variable dropdown from file's variables
        const waveSelect = document.getElementById('briefWaveVariable');
        if (waveSelect && typeof api !== 'undefined' && typeof projectId !== 'undefined') {
            try {
                const resp = await api.request(`/research/projects/${projectId}/files/${fileId}/variables`, { _skipSpinner: true });
                const vars = resp?.variables || resp;
                waveSelect.innerHTML = '<option value="">— Not set (no wave comparison) —</option>';
                if (vars && Array.isArray(vars)) {
                    vars.forEach(v => {
                        const opt = document.createElement('option');
                        const name = v.variable_name || v.variableName || v.name;
                        opt.value = name;
                        opt.textContent = `${name} — ${v.variable_label || v.variableLabel || v.label || ''}`;
                        waveSelect.appendChild(opt);
                    });
                }
                // Set selected value from state
                if (state.waveVariable) waveSelect.value = state.waveVariable;
                waveSelect.addEventListener('change', () => { state.waveVariable = waveSelect.value; });
            } catch (e) {
                console.warn('[Brief] Failed to load variables for wave selector:', e);
            }
        }

        document.getElementById('insightsBriefModal')?.classList.add('active');
    }

    function closeBriefBuilder() {
        document.getElementById('insightsBriefModal')?.classList.remove('active');
    }

    function wireEventHandlers() {
        // Custom instructions textarea
        const ta = document.getElementById('briefCustomInstructions');
        if (ta) {
            ta.addEventListener('input', () => {
                state.customInstructions = ta.value;
            });
        }

        // Analysis checkboxes
        document.querySelectorAll('.brief-analysis-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const key = cb.dataset.analysis;
                if (key) state.mandatoryAnalyses[key] = cb.checked;
            });
        });
    }

    // -----------------------------------------------------------------------
    // Build brief JSON
    // -----------------------------------------------------------------------

    function buildBriefJson() {
        const brief = { brief_version: 1 };

        if (state.focusVariables.length > 0)
            brief.focus_variables = state.focusVariables;

        if (state.mandatoryCrossTabs.length > 0)
            brief.mandatory_crosstabs = state.mandatoryCrossTabs;

        const activeAnalyses = Object.entries(state.mandatoryAnalyses)
            .filter(([_, v]) => v).map(([k]) => ({ type: k }));
        if (activeAnalyses.length > 0)
            brief.mandatory_analyses = activeAnalyses;

        if (state.focusSegments.length > 0)
            brief.focus_segments = state.focusSegments;

        if (state.customInstructions.trim())
            brief.custom_instructions = state.customInstructions.trim();

        if (state.waveVariable)
            brief.wave_variable = state.waveVariable;

        // If nothing was specified, return null (fully autonomous)
        const hasContent = (brief.focus_variables || brief.mandatory_crosstabs ||
            brief.mandatory_analyses || brief.focus_segments || brief.custom_instructions ||
            brief.wave_variable);
        return hasContent ? brief : null;
    }

    function briefToPromptText(brief) {
        if (!brief) return '';
        const lines = [];

        if (brief.wave_variable) {
            lines.push(`WAVE VARIABLE: "${brief.wave_variable}"`);
            lines.push('Use this variable to filter or cross-tabulate by wave/period for ALL trend analysis charts.');
            lines.push('For wave comparison tabs: run separate frequency/cross_tab calls filtered by each wave value, or use cross_tab with this variable as the banner.');
            lines.push('');
        }

        if (brief.focus_variables?.length > 0) {
            lines.push('FOCUS VARIABLES (must have dedicated analysis):');
            brief.focus_variables.forEach(f => {
                lines.push(`  - ${f.variable}${f.reason ? ` — ${f.reason}` : ''}`);
            });
            lines.push('');
        }

        if (brief.mandatory_crosstabs?.length > 0) {
            lines.push('MANDATORY CROSS-TABS (must appear as charts):');
            brief.mandatory_crosstabs.forEach(ct => {
                lines.push(`  - ${ct.row} x ${ct.column}${ct.note ? ` — ${ct.note}` : ''}`);
            });
            lines.push('');
        }

        if (brief.mandatory_analyses?.length > 0) {
            lines.push('MANDATORY ANALYSES:');
            const labels = { trend: 'Trend analysis across waves', driver: 'Key driver analysis (regression)',
                cluster: 'Customer segmentation (clustering)', correlation: 'Correlation matrix (heatmap)' };
            brief.mandatory_analyses.forEach(a => {
                lines.push(`  - ${labels[a.type] || a.type}`);
            });
            lines.push('');
        }

        if (brief.focus_segments?.length > 0) {
            lines.push('FOCUS SEGMENTS (must include in cross-tabs):');
            brief.focus_segments.forEach(s => {
                lines.push(`  - "${s.label}" (${s.expression})${s.note ? ` — ${s.note}` : ''}`);
            });
            lines.push('');
        }

        if (brief.custom_instructions) {
            lines.push('ADDITIONAL INSTRUCTIONS:');
            lines.push(brief.custom_instructions);
        }

        return lines.join('\n');
    }

    // -----------------------------------------------------------------------
    // Actions
    // -----------------------------------------------------------------------

    function handleSkipBrief() {
        closeBriefBuilder();
        if (_onGenerate) _onGenerate(null, false, null);
    }

    function handleGenerateWithBrief() {
        const brief = buildBriefJson();
        const promptText = briefToPromptText(brief);

        // Build brief_json for backend persistence (stored in insights_dashboards.brief_json)
        const briefStateJson = JSON.stringify({
            focusVariables: state.focusVariables,
            mandatoryCrossTabs: state.mandatoryCrossTabs,
            mandatoryAnalyses: state.mandatoryAnalyses,
            focusSegments: state.focusSegments,
            customInstructions: state.customInstructions,
            waveVariable: state.waveVariable
        });
        // Store on the _onGenerate call so the caller can include it in the POST
        _briefStateJson = briefStateJson;

        const useBaseline = _hasExistingDashboard && document.getElementById('briefUseBaseline')?.checked;

        closeBriefBuilder();
        if (_onGenerate) _onGenerate(promptText, useBaseline, briefStateJson);
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    function render() {
        renderFocusVariables();
        renderCrossTabs();
        renderSegments();
        renderCustomInstructions();
        renderAnalysisCheckboxes();
        // Sync wave variable dropdown
        const waveSelect = document.getElementById('briefWaveVariable');
        if (waveSelect && state.waveVariable) waveSelect.value = state.waveVariable;
    }

    function renderFocusVariables() {
        const host = document.getElementById('briefFocusVars');
        if (!host) return;
        let html = state.focusVariables.map((f, i) => `
            <div class="brief-item">
                <input type="text" class="brief-var-input" value="${escapeHtml(f.variable)}" placeholder="Variable name" data-idx="${i}" data-field="variable">
                <input type="text" class="brief-reason-input" value="${escapeHtml(f.reason || '')}" placeholder="Why important?" data-idx="${i}" data-field="reason">
                <button class="brief-remove-btn" data-section="focus" data-idx="${i}">&times;</button>
            </div>`).join('');
        html += `<button class="brief-add-btn" onclick="briefAddFocusVar()">+ Add focus variable</button>`;
        host.innerHTML = html;

        host.querySelectorAll('.brief-var-input, .brief-reason-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const idx = parseInt(inp.dataset.idx);
                state.focusVariables[idx][inp.dataset.field] = inp.value;
            });
        });
        host.querySelectorAll('.brief-remove-btn[data-section="focus"]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.focusVariables.splice(parseInt(btn.dataset.idx), 1);
                renderFocusVariables();
            });
        });
    }

    function renderCrossTabs() {
        const host = document.getElementById('briefCrossTabs');
        if (!host) return;
        let html = state.mandatoryCrossTabs.map((ct, i) => `
            <div class="brief-item">
                <input type="text" class="brief-ct-row" value="${escapeHtml(ct.row)}" placeholder="Row variable" data-idx="${i}">
                <span class="brief-ct-x">×</span>
                <input type="text" class="brief-ct-col" value="${escapeHtml(ct.column)}" placeholder="Column variable" data-idx="${i}">
                <input type="text" class="brief-ct-note" value="${escapeHtml(ct.note || '')}" placeholder="Note" data-idx="${i}">
                <button class="brief-remove-btn" data-section="ct" data-idx="${i}">&times;</button>
            </div>`).join('');
        html += `<button class="brief-add-btn" onclick="briefAddCrossTab()">+ Add cross-tab</button>`;
        host.innerHTML = html;

        host.querySelectorAll('.brief-ct-row').forEach(inp => {
            inp.addEventListener('input', () => { state.mandatoryCrossTabs[parseInt(inp.dataset.idx)].row = inp.value; });
        });
        host.querySelectorAll('.brief-ct-col').forEach(inp => {
            inp.addEventListener('input', () => { state.mandatoryCrossTabs[parseInt(inp.dataset.idx)].column = inp.value; });
        });
        host.querySelectorAll('.brief-ct-note').forEach(inp => {
            inp.addEventListener('input', () => { state.mandatoryCrossTabs[parseInt(inp.dataset.idx)].note = inp.value; });
        });
        host.querySelectorAll('.brief-remove-btn[data-section="ct"]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.mandatoryCrossTabs.splice(parseInt(btn.dataset.idx), 1);
                renderCrossTabs();
            });
        });
    }

    function renderSegments() {
        const host = document.getElementById('briefSegments');
        if (!host) return;
        let html = state.focusSegments.map((s, i) => `
            <div class="brief-item">
                <input type="text" class="brief-seg-label" value="${escapeHtml(s.label)}" placeholder="Segment label" data-idx="${i}">
                <input type="text" class="brief-seg-expr" value="${escapeHtml(s.expression)}" placeholder="e.g. AGE_GROUP IN (1,2)" data-idx="${i}">
                <button class="brief-remove-btn" data-section="seg" data-idx="${i}">&times;</button>
            </div>`).join('');
        html += `<button class="brief-add-btn" onclick="briefAddSegment()">+ Add segment</button>`;
        host.innerHTML = html;

        host.querySelectorAll('.brief-seg-label').forEach(inp => {
            inp.addEventListener('input', () => { state.focusSegments[parseInt(inp.dataset.idx)].label = inp.value; });
        });
        host.querySelectorAll('.brief-seg-expr').forEach(inp => {
            inp.addEventListener('input', () => { state.focusSegments[parseInt(inp.dataset.idx)].expression = inp.value; });
        });
        host.querySelectorAll('.brief-remove-btn[data-section="seg"]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.focusSegments.splice(parseInt(btn.dataset.idx), 1);
                renderSegments();
            });
        });
    }

    function renderCustomInstructions() {
        const ta = document.getElementById('briefCustomInstructions');
        if (ta && ta.value !== state.customInstructions) {
            ta.value = state.customInstructions;
        }
    }

    function renderAnalysisCheckboxes() {
        Object.entries(state.mandatoryAnalyses).forEach(([key, val]) => {
            const cb = document.querySelector(`.brief-analysis-check[data-analysis="${key}"]`);
            if (cb) cb.checked = val;
        });
    }

    // -----------------------------------------------------------------------
    // Add helpers (called from onclick)
    // -----------------------------------------------------------------------

    function briefAddFocusVar() {
        state.focusVariables.push({ variable: '', reason: '' });
        renderFocusVariables();
        // Focus the new input
        setTimeout(() => {
            const inputs = document.querySelectorAll('#briefFocusVars .brief-var-input');
            inputs[inputs.length - 1]?.focus();
        }, 0);
    }

    function briefAddCrossTab() {
        state.mandatoryCrossTabs.push({ row: '', column: '', note: '' });
        renderCrossTabs();
        setTimeout(() => {
            const inputs = document.querySelectorAll('#briefCrossTabs .brief-ct-row');
            inputs[inputs.length - 1]?.focus();
        }, 0);
    }

    function briefAddSegment() {
        state.focusSegments.push({ expression: '', label: '', note: '' });
        renderSegments();
        setTimeout(() => {
            const inputs = document.querySelectorAll('#briefSegments .brief-seg-label');
            inputs[inputs.length - 1]?.focus();
        }, 0);
    }

    // -----------------------------------------------------------------------
    // Parse ai_instructions text into structured state
    // -----------------------------------------------------------------------

    function parseInstructionsIntoState(text) {
        if (!text) return;
        const lines = text.split('\n');
        let section = null;
        let customLines = [];

        for (const line of lines) {
            const trimmed = line.trim();

            // Detect section headers
            if (/^WAVE VARIABLE:\s*"?([^"]+)"?/i.test(trimmed)) {
                const wvMatch = trimmed.match(/^WAVE VARIABLE:\s*"?([^"]+)"?/i);
                if (wvMatch) state.waveVariable = wvMatch[1].trim();
                continue;
            }
            if (/^FOCUS VARIABLES/i.test(trimmed)) { section = 'focus'; continue; }
            if (/^MANDATORY CROSS-TABS/i.test(trimmed)) { section = 'crosstab'; continue; }
            if (/^MANDATORY ANALYSES/i.test(trimmed)) { section = 'analyses'; continue; }
            if (/^FOCUS SEGMENTS/i.test(trimmed)) { section = 'segments'; continue; }
            if (/^ADDITIONAL INSTRUCTIONS/i.test(trimmed) || /^CRITICAL.*REQUIREMENTS/i.test(trimmed)) { section = 'custom'; continue; }
            if (/^WAVE COMPARISON/i.test(trimmed) || /^EXISTING CHARTS/i.test(trimmed)) { section = 'custom'; customLines.push(trimmed); continue; }

            if (!trimmed || trimmed === '') continue;

            if (section === 'focus' && /^-\s+/.test(trimmed)) {
                // "- Q11 — Overall Satisfaction — primary KPI"
                const content = trimmed.replace(/^-\s+/, '');
                const parts = content.split(/\s*[—–-]\s*/);
                const variable = (parts[0] || '').trim();
                const reason = parts.slice(1).join(' — ').trim();
                if (variable && state.focusVariables.every(f => f.variable !== variable)) {
                    state.focusVariables.push({ variable, reason });
                }
            }
            else if (section === 'crosstab' && /^-\s+/.test(trimmed)) {
                // "- Q11 x D1 — Satisfaction by country"
                const content = trimmed.replace(/^-\s+/, '');
                const dashParts = content.split(/\s*[—–]\s*/);
                const varPart = dashParts[0] || '';
                const note = dashParts.slice(1).join(' — ').trim();
                const xMatch = varPart.match(/^(\S+)\s*[x×]\s*(\S+)/i);
                if (xMatch) {
                    const row = xMatch[1].trim();
                    const column = xMatch[2].trim();
                    if (state.mandatoryCrossTabs.every(ct => !(ct.row === row && ct.column === column))) {
                        state.mandatoryCrossTabs.push({ row, column, note });
                    }
                }
            }
            else if (section === 'analyses' && /^-\s+/.test(trimmed)) {
                const content = trimmed.replace(/^-\s+/, '').toLowerCase();
                if (content.includes('driver') || content.includes('regression')) state.mandatoryAnalyses.driver = true;
                if (content.includes('cluster') || content.includes('segmentation')) state.mandatoryAnalyses.cluster = true;
                if (content.includes('correlation') || content.includes('heatmap')) state.mandatoryAnalyses.correlation = true;
                if (content.includes('trend')) state.mandatoryAnalyses.trend = true;
            }
            else if (section === 'segments' && /^-\s+/.test(trimmed)) {
                // '- "Young Adults" (D3R IN (1, 2)) — client target'
                const content = trimmed.replace(/^-\s+/, '');
                const labelMatch = content.match(/^"([^"]+)"\s*\(([^)]+)\)/);
                if (labelMatch) {
                    const label = labelMatch[1];
                    const expression = labelMatch[2];
                    const noteMatch = content.match(/\)\s*[—–-]\s*(.+)/);
                    const note = noteMatch ? noteMatch[1].trim() : '';
                    if (state.focusSegments.every(s => s.label !== label)) {
                        state.focusSegments.push({ expression, label, note });
                    }
                }
            }
            else if (section === 'custom') {
                customLines.push(trimmed);
            }
        }

        if (customLines.length > 0 && !state.customInstructions) {
            state.customInstructions = customLines.join('\n');
        } else if (!state.customInstructions) {
            // If no sections were detected, put everything in custom instructions
            state.customInstructions = text;
        }
    }

    // -----------------------------------------------------------------------
    // Public surface
    // -----------------------------------------------------------------------

    function briefSwitchTab(tabName) {
        document.querySelectorAll('#insightsBriefModal .brief-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabName);
        });
        document.getElementById('briefTabInstructions').style.display = tabName === 'instructions' ? '' : 'none';
        document.getElementById('briefTabAdvanced').style.display = tabName === 'advanced' ? '' : 'none';
    }

    window.openBriefBuilder = openBriefBuilder;
    window.closeBriefBuilder = closeBriefBuilder;
    window.briefHandleSkip = handleSkipBrief;
    window.briefHandleGenerate = handleGenerateWithBrief;
    window.briefAddFocusVar = briefAddFocusVar;
    window.briefAddCrossTab = briefAddCrossTab;
    window.briefAddSegment = briefAddSegment;
    window.briefSwitchTab = briefSwitchTab;
})();
