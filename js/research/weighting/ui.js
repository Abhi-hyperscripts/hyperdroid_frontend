/**
 * RIM Weighting — UI module
 *
 * SPSS-style modal that lets the user generate respondent weights via RIM
 * (Random Iterative Method). Mirrors the Custom Tables modal layout:
 *
 *     [palette] | [Factors slot]   →  per-code target % editor
 *               | [Filter slot]    →  optional SQL WHERE expression
 *               | [Preview pane]   →  marginal check + statistics
 *     ----------+--------------------------------------------------------
 *     [target variable name input]  [Reset] [Cancel] [Generate Weights]
 *
 * Calls the backend `rim_weighting` function (DataManipulation category, not
 * exposed to the LLM tool list). The backend writes the weight column to
 * ClickHouse AND registers it in `variable_definitions`, so after a
 * successful run the new column appears automatically in the Variables tab
 * on the next refresh.
 *
 * Public surface (wired via onclick attributes in HTML):
 *   openRimWeightingModal()   — populate + show
 *   closeRimWeightingModal()  — hide
 *   rwReset()                 — clear factors / filter / preview
 *   rwRun()                   — build request and execute
 */
(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    const state = {
        initialized: false,
        fileId: null,
        // factors: [{ name, label, targets: { code: pct }, codeLabels: { code: label } }]
        factors: [],
        filterExpression: '',
        targetVariable: '',
        searchTerm: '',
        lastResult: null,
    };

    // Variable lookups for the active file
    let currentVariables = [];
    let variablesByName = {};

    // Cached codes per variable (same shape as custom-table's codesCache)
    const codesCache = new Map();
    const pendingCodeFetches = new Map();

    // -----------------------------------------------------------------------
    // Open / close
    // -----------------------------------------------------------------------

    async function openRimWeightingModal() {
        if (typeof variablesLoaded !== 'undefined' && !variablesLoaded
            && typeof loadVariables === 'function') {
            await loadVariables();
        }
        await refreshFromActiveFile();

        if (!state.initialized) {
            state.initialized = true;
            wireSearch();
            wireDropZones();
            wireFooter();
        }

        render();
        document.getElementById('rimWeightingModal')?.classList.add('active');
    }

    function closeRimWeightingModal() {
        document.getElementById('rimWeightingModal')?.classList.remove('active');
    }

    async function refreshFromActiveFile() {
        let fileId = (typeof getFileFilterValue === 'function' ? getFileFilterValue() : '') || '';
        if (!fileId && Array.isArray(allVariables) && allVariables.length > 0) {
            fileId = allVariables[0].fileId;
        }
        if (fileId !== state.fileId) {
            codesCache.clear();
            pendingCodeFetches.clear();
            state.factors = [];
            state.filterExpression = '';
            state.targetVariable = '';
            state.lastResult = null;
        }
        state.fileId = fileId;

        const group = (allVariables || []).find(g => g.fileId === fileId);
        currentVariables = group?.variables || [];
        variablesByName = {};
        for (const v of currentVariables) {
            const name = (v.variableName || v.variable_name || '').toUpperCase();
            if (name) variablesByName[name] = v;
        }

        const label = document.getElementById('rwActiveFile');
        if (label) {
            if (group) {
                label.innerHTML = `File: <strong>${escapeHtml(group.fileName || '')}</strong> · ${currentVariables.length} variables`;
            } else {
                label.textContent = 'No file selected — open the Variables tab and pick one.';
            }
        }
    }

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    function wireSearch() {
        const input = document.getElementById('rwSearch');
        if (!input) return;
        input.addEventListener('input', () => {
            state.searchTerm = input.value.trim().toLowerCase();
            renderPalette();
        });
    }

    // Drag-and-drop is wired on the .rw-drop-zone element, which is always
    // the LAST child of the slot. We re-wire on each render() call because
    // the slot's innerHTML is replaced and the drop zone is a fresh node.
    function wireDropZones() {
        // Initial wire happens via wireDropZoneOnce called from renderFactors,
        // not here. Kept for symmetry with the old API.
    }

    function wireDropZoneOnce() {
        const dropZone = document.querySelector('#rwSlotFactors .rw-drop-zone');
        if (!dropZone) return;

        const allow = (e) => {
            const types = e.dataTransfer?.types;
            if (!types || !Array.from(types).includes('text/variable')) return;
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        };
        dropZone.addEventListener('dragenter', allow);
        dropZone.addEventListener('dragover',  allow);
        dropZone.addEventListener('dragleave', (e) => {
            if (!dropZone.contains(e.relatedTarget)) {
                dropZone.classList.remove('drag-over');
            }
        });
        dropZone.addEventListener('drop', async (e) => {
            const varName = e.dataTransfer?.getData('text/variable');
            if (!varName) return;
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
            await addFactor(varName);
        });
    }

    function wireFooter() {
        const nameInput = document.getElementById('rwTargetName');
        if (nameInput) {
            nameInput.addEventListener('input', () => {
                state.targetVariable = nameInput.value.trim();
                renderRunButton();
            });
        }
        const filterInput = document.getElementById('rwFilterExpression');
        if (filterInput) {
            filterInput.addEventListener('input', () => {
                state.filterExpression = filterInput.value;
                updateFilterSummary();
                renderRunButton();
            });
        }
        // (i) help button — popover with educational filter syntax examples.
        // The popover MUST live outside the modal: .gm-modal has a transform
        // applied which creates a new containing block, breaking position:fixed.
        // We move the popover to document.body and position it via JS each time
        // it opens.
        const helpEl = document.getElementById('rwFilterHelp');
        const helpBtn = helpEl?.querySelector('.rw-filter-help-btn');
        let popover = helpEl?.querySelector('.rw-filter-popover');
        if (popover && popover.parentElement !== document.body) {
            document.body.appendChild(popover);
        }

        function positionPopover() {
            if (!helpBtn || !popover) return;
            // Force a reflow to read accurate dimensions
            popover.style.visibility = 'hidden';
            popover.style.display = 'flex';
            const popWidth = popover.offsetWidth || 360;
            const popHeight = popover.offsetHeight || 380;
            popover.style.display = '';
            popover.style.visibility = '';

            const r = helpBtn.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const margin = 12;

            // Right-align with the (i) button by default
            let left = r.right - popWidth;
            if (left < margin) left = margin;
            if (left + popWidth > vw - margin) left = vw - popWidth - margin;

            // Below the button by default; flip above if it would overflow
            let top = r.bottom + 8;
            if (top + popHeight > vh - margin) {
                top = r.top - popHeight - 8;
                if (top < margin) top = margin;
            }

            popover.style.top = `${top}px`;
            popover.style.left = `${left}px`;
        }

        // Show/hide functions — driven by either hover on the (i) button or
        // explicit click toggle. Because the popover is now in document.body,
        // we control display via direct style instead of the .open class on
        // .rw-filter-help (which no longer contains the popover).
        let isOpen = false;
        function showPopover() { if (popover) { positionPopover(); popover.style.display = 'flex'; isOpen = true; } }
        function hidePopover() { if (popover) { popover.style.display = 'none'; isOpen = false; } }

        if (helpBtn && popover) {
            helpBtn.addEventListener('mouseenter', showPopover);
            helpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isOpen) hidePopover(); else showPopover();
            });
            // Hide when leaving both the button and the popover
            helpBtn.addEventListener('mouseleave', (e) => {
                // If the cursor moved into the popover, keep it open
                if (e.relatedTarget && popover.contains(e.relatedTarget)) return;
                setTimeout(() => {
                    // Don't close if user is still hovering popover
                    if (!popover.matches(':hover') && !helpBtn.matches(':hover')) hidePopover();
                }, 100);
            });
            popover.addEventListener('mouseleave', () => {
                setTimeout(() => {
                    if (!popover.matches(':hover') && !helpBtn.matches(':hover')) hidePopover();
                }, 100);
            });
            window.addEventListener('scroll', () => { if (isOpen) positionPopover(); }, true);
            window.addEventListener('resize', () => { if (isOpen) positionPopover(); });
            document.addEventListener('click', (e) => {
                if (!helpBtn.contains(e.target) && !popover.contains(e.target)) hidePopover();
            });
        }
    }

    function rwToggleFilter() {
        const toggle = document.getElementById('rwFilterToggle');
        const body = document.getElementById('rwFilterBody');
        if (!toggle || !body) return;
        const isOpen = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!isOpen));
        body.hidden = isOpen;
        if (!isOpen) {
            // Just opened — focus the input for immediate typing
            setTimeout(() => document.getElementById('rwFilterExpression')?.focus(), 0);
        }
    }

    function updateFilterSummary() {
        const summary = document.getElementById('rwFilterSummary');
        if (!summary) return;
        const expr = (state.filterExpression || '').trim();
        summary.textContent = expr ? expr : '';
    }

    // -----------------------------------------------------------------------
    // Variable classification (mirrors custom-table for visual consistency)
    // -----------------------------------------------------------------------

    function classifyVariable(v) {
        const type = (v.variableType || v.variable_type || '').toLowerCase();
        const fmt = (v.spssFormat || v.spss_format || '').toUpperCase();
        const raw = v.valueLabelsJson || v.valueLabelJson || v.value_labels_json;
        const hasLabels = raw && raw !== '{}' && raw !== 'null';

        if (/DATE|TIME/.test(fmt)) return 'datetime';
        if (hasLabels) return 'categorical';
        if (type === 'string') return 'text';
        return 'numeric';
    }

    const GROUP_META = {
        categorical: { title: 'Categorical (labeled)', icon: 'C', cls: 'nominal' },
        numeric:     { title: 'Numeric',                icon: '#', cls: 'scale' },
        text:        { title: 'Text',                   icon: 'A', cls: 'string' },
        datetime:    { title: 'Date / time',            icon: 'D', cls: 'ordinal' },
    };

    // -----------------------------------------------------------------------
    // Codes fetching
    // -----------------------------------------------------------------------

    async function fetchVariableCodes(variableName) {
        const key = variableName.toUpperCase();
        if (codesCache.has(key)) return codesCache.get(key);
        if (pendingCodeFetches.has(key)) return pendingCodeFetches.get(key);
        if (!state.fileId) return null;

        const promise = (async () => {
            try {
                const url = `${CONFIG.researchApiBaseUrl}/projects/${projectId}/files/${state.fileId}/variables/${encodeURIComponent(variableName)}/codes`;
                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${getAuthToken()}` },
                });
                if (!res.ok) return null;
                const body = await res.json();
                const codes = body?.codes || [];
                codesCache.set(key, codes);
                return codes;
            } catch (err) {
                console.warn('[rw fetchVariableCodes]', variableName, err);
                return null;
            } finally {
                pendingCodeFetches.delete(key);
            }
        })();
        pendingCodeFetches.set(key, promise);
        return promise;
    }

    // -----------------------------------------------------------------------
    // Add / remove factor
    // -----------------------------------------------------------------------

    async function addFactor(varName) {
        const upper = varName.toUpperCase();
        if (state.factors.some(f => f.name === upper)) {
            Toast.error(`${upper} is already a factor`);
            return;
        }
        const def = variablesByName[upper];
        if (!def) {
            Toast.error(`${upper} not found in this file`);
            return;
        }
        if (classifyVariable(def) !== 'categorical') {
            Toast.error(`${upper} isn't a labeled categorical variable — RIM factors must have value labels`);
            return;
        }

        // Show a placeholder card while we fetch codes
        const factor = {
            name: upper,
            label: def.variableLabel || def.variable_label || '',
            targets: {},
            codeLabels: {},
            loading: true,
        };
        state.factors.push(factor);
        render();

        const allCodes = await fetchVariableCodes(upper);
        if (!allCodes || allCodes.length === 0) {
            Toast.error(`No codes found for ${upper}`);
            state.factors = state.factors.filter(f => f !== factor);
            render();
            return;
        }

        // Only data-present codes can be RIM targets — the algorithm has nothing
        // to weight for codes with zero respondents and the backend rejects them.
        // value_labels_json typically lists codes that don't appear in the data
        // (e.g. SPSS questionnaire defines "Non-binary" but no one picked it).
        const codes = allCodes.filter(c => Number(c.count) > 0);
        if (codes.length === 0) {
            Toast.error(`${upper} has no data — every label code has zero respondents`);
            state.factors = state.factors.filter(f => f !== factor);
            render();
            return;
        }
        if (codes.length < allCodes.length) {
            const dropped = allCodes.length - codes.length;
            console.info(`[rim_weighting] ${upper}: dropped ${dropped} zero-count code${dropped === 1 ? '' : 's'} from target editor`);
        }

        // Compute the actual data distribution per code from the count
        // returned by /codes — this is what users compare against when
        // setting targets.
        let totalCount = 0;
        for (const c of codes) totalCount += Number(c.count) || 0;
        factor.actualPct = {};
        for (const c of codes) {
            const codeStr = String(c.code);
            factor.actualPct[codeStr] = totalCount > 0 ? (Number(c.count) || 0) / totalCount : 0;
        }
        // Default targets to the actual distribution rather than equal split
        // — most users start by tweaking the existing distribution, so this
        // matches the typical workflow and the sum is always exactly 1.
        for (const c of codes) {
            const codeStr = String(c.code);
            factor.targets[codeStr] = factor.actualPct[codeStr];
            factor.codeLabels[codeStr] = c.label || '';
        }
        // Round-trip floats almost never sum to exactly 1.0 — nudge the last
        // cell so the user starts in a valid state.
        const sum = Object.values(factor.targets).reduce((a, b) => a + b, 0);
        const lastKey = Object.keys(factor.targets).pop();
        if (lastKey != null) {
            factor.targets[lastKey] = +(factor.targets[lastKey] + (1 - sum)).toFixed(10);
        }
        factor.loading = false;
        render();
    }

    function removeFactor(name) {
        state.factors = state.factors.filter(f => f.name !== name);
        render();
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    function render() {
        renderPalette();
        renderFactors();
        renderRunButton();
    }

    function renderPalette() {
        const host = document.getElementById('rwPaletteList');
        if (!host) return;
        if (!currentVariables || currentVariables.length === 0) {
            host.innerHTML = `<div class="ct-empty-palette">No variables available. Upload a file and wait for parsing to finish.</div>`;
            return;
        }

        const needle = state.searchTerm;
        // Only categorical variables can be RIM factors — filter those out of
        // the palette entirely so the user doesn't try to drop a continuous or
        // string variable. We still surface the others in a disabled section
        // so people understand why their numeric variable isn't there.
        const filtered = currentVariables.filter(v => {
            if (!needle) return true;
            const name = (v.variableName || v.variable_name || '').toLowerCase();
            const label = (v.variableLabel || v.variable_label || '').toLowerCase();
            return name.includes(needle) || label.includes(needle);
        });

        const groups = { categorical: [], numeric: [], text: [], datetime: [] };
        for (const v of filtered) groups[classifyVariable(v)].push(v);

        let html = '';
        // Categorical first — only this section is draggable.
        if (groups.categorical.length > 0) {
            const meta = GROUP_META.categorical;
            html += `<div class="ct-palette-group"><div class="ct-palette-group-title">${escapeHtml(meta.title)} · ${groups.categorical.length}</div>`;
            for (const v of groups.categorical) html += renderVariableItem(v, 'categorical', true);
            html += `</div>`;
        }

        const others = ['numeric', 'text', 'datetime']
            .map(k => ({ key: k, list: groups[k] }))
            .filter(o => o.list.length > 0);
        if (others.length > 0) {
            html += `<div class="ct-palette-group"><div class="ct-palette-group-title rw-palette-disabled-title">Not available as RIM factors</div>`;
            for (const o of others) {
                for (const v of o.list) html += renderVariableItem(v, o.key, false);
            }
            html += `</div>`;
        }

        if (!html) {
            html = `<div class="ct-palette-empty-hint">No matches for "${escapeHtml(needle)}"</div>`;
        }
        host.innerHTML = html;

        host.querySelectorAll('.ct-var-item').forEach(el => {
            const draggable = el.dataset.draggable === '1';
            if (!draggable) return;
            el.addEventListener('dragstart', e => {
                el.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/variable', el.dataset.variableName);
            });
            el.addEventListener('dragend', () => el.classList.remove('dragging'));
            el.addEventListener('click', () => addFactor(el.dataset.variableName));
        });
    }

    function renderVariableItem(v, groupKey, draggable) {
        const name = v.variableName || v.variable_name || '';
        const label = v.variableLabel || v.variable_label || '';
        const meta = GROUP_META[groupKey] || { icon: '?', cls: 'scale' };
        return `
            <div class="ct-var-item ${draggable ? '' : 'rw-var-disabled'}" ${draggable ? 'draggable="true"' : ''}
                 data-variable-name="${escapeHtml(name)}" data-draggable="${draggable ? '1' : '0'}"
                 title="${escapeHtml(label || name)}">
                <span class="ct-var-icon ${meta.cls}">${meta.icon}</span>
                <div class="ct-var-text">
                    <div class="ct-var-name">${escapeHtml(name)}</div>
                    ${label ? `<div class="ct-var-label">${escapeHtml(label)}</div>` : ''}
                </div>
            </div>`;
    }

    function renderFactors() {
        const host = document.getElementById('rwSlotFactors');
        if (!host) return;
        const countEl = document.getElementById('rwSlotCountFactors');
        if (countEl) countEl.textContent = state.factors.length > 0 ? ` · ${state.factors.length}` : '';

        // ALWAYS render: factor cards (zero or more) + a single compact
        // drop zone as the last child. The zone is the only drag target —
        // the cards are static. After each successful drop, render() runs
        // again and a fresh drop zone is appended below the new card.
        const cardsHtml = state.factors.map(f => renderFactorCard(f)).join('');
        const isFirst = state.factors.length === 0;
        const dropZoneHtml = `
            <div class="rw-drop-zone">
                <div class="rw-drop-zone-icon">+</div>
                <div class="rw-drop-zone-text">${isFirst ? 'Drag a categorical variable here' : 'Drag another categorical variable here'}</div>
                <div class="rw-drop-zone-sub">${isFirst ? 'or click one in the palette' : 'or click another in the palette'}</div>
            </div>`;
        host.innerHTML = cardsHtml + dropZoneHtml;
        wireDropZoneOnce();

        // Wire input handlers, remove buttons, equalize buttons
        host.querySelectorAll('.rw-target-input').forEach(input => {
            input.addEventListener('input', () => {
                const factorName = input.dataset.factor;
                const code = input.dataset.code;
                const factor = state.factors.find(f => f.name === factorName);
                if (!factor) return;
                const v = parseFloat(input.value);
                factor.targets[code] = isNaN(v) ? 0 : v / 100;  // user types %, we store fraction
                updateFactorSumDisplay(factorName);
                renderRunButton();
            });
        });
        host.querySelectorAll('.rw-factor-remove').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                removeFactor(btn.dataset.factor);
            });
        });
        host.querySelectorAll('.rw-factor-equalize').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const factor = state.factors.find(f => f.name === btn.dataset.factor);
                if (!factor) return;
                const codes = Object.keys(factor.targets);
                if (codes.length === 0) return;
                // Reset target % back to the actual data distribution.
                for (const c of codes) factor.targets[c] = factor.actualPct?.[c] || 0;
                // Nudge last so it sums to exactly 1 (rounding safety).
                let s = 0;
                for (let i = 0; i < codes.length - 1; i++) s += factor.targets[codes[i]];
                factor.targets[codes[codes.length - 1]] = +(1 - s).toFixed(10);
                renderFactors();
                renderRunButton();
            });
        });
    }

    function renderFactorCard(factor) {
        if (factor.loading) {
            return `<div class="rw-factor-card rw-factor-loading">
                <div class="rw-factor-header">
                    <div class="rw-factor-title">${escapeHtml(factor.name)}</div>
                    <div class="rw-factor-loading-text">Loading codes…</div>
                </div>
            </div>`;
        }

        const codes = Object.keys(factor.targets);
        const sum = codes.reduce((a, c) => a + (factor.targets[c] || 0), 0);
        const sumPct = sum * 100;
        const valid = Math.abs(sum - 1) < 1e-4;

        const rowsHtml = codes.map(code => {
            const label = factor.codeLabels[code] || '';
            const pct = ((factor.targets[code] || 0) * 100).toFixed(2);
            const actualPct = ((factor.actualPct?.[code] || 0) * 100).toFixed(2);
            return `
                <tr>
                    <td class="rw-code-cell">${escapeHtml(code)}</td>
                    <td class="rw-code-label-cell" title="${escapeHtml(label)}">${escapeHtml(label)}</td>
                    <td class="rw-actual-cell">${actualPct}<span class="rw-pct-inline">%</span></td>
                    <td class="rw-code-input-cell">
                        <span class="rw-target-input-wrap">
                            <input type="number" class="rw-target-input"
                                   data-factor="${escapeHtml(factor.name)}"
                                   data-code="${escapeHtml(code)}"
                                   value="${pct}" min="0" max="100" step="0.01"
                                   inputmode="decimal" aria-label="Target percentage for code ${escapeHtml(code)}">
                            <span class="rw-pct-suffix">%</span>
                        </span>
                    </td>
                </tr>`;
        }).join('');

        return `
            <div class="rw-factor-card">
                <div class="rw-factor-header">
                    <div class="rw-factor-title">
                        <span class="rw-factor-name">${escapeHtml(factor.name)}</span>
                        ${factor.label ? `<span class="rw-factor-label">${escapeHtml(factor.label)}</span>` : ''}
                    </div>
                    <div class="rw-factor-actions">
                        <button class="rw-factor-equalize" data-factor="${escapeHtml(factor.name)}" title="Reset target % to actual data distribution">↺</button>
                        <button class="rw-factor-remove" data-factor="${escapeHtml(factor.name)}" title="Remove">&times;</button>
                    </div>
                </div>
                <table class="rw-factor-table">
                    <colgroup>
                        <col class="rw-col-code">
                        <col class="rw-col-label">
                        <col class="rw-col-actual">
                        <col class="rw-col-target">
                    </colgroup>
                    <thead>
                        <tr><th>Code</th><th>Label</th><th class="rw-th-actual">Actual %</th><th class="rw-th-target">Target %</th></tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
                <div class="rw-factor-sum ${valid ? 'rw-sum-valid' : 'rw-sum-invalid'}" data-factor="${escapeHtml(factor.name)}">
                    Σ = <span class="rw-sum-value">${sumPct.toFixed(2)}</span>%
                    ${valid ? '<span class="rw-sum-icon">✓</span>' : '<span class="rw-sum-icon">⚠</span> must equal 100%'}
                </div>
            </div>`;
    }

    function updateFactorSumDisplay(factorName) {
        const factor = state.factors.find(f => f.name === factorName);
        if (!factor) return;
        const sum = Object.values(factor.targets).reduce((a, b) => a + b, 0);
        const valid = Math.abs(sum - 1) < 1e-4;
        const el = document.querySelector(`.rw-factor-sum[data-factor="${cssEscape(factorName)}"]`);
        if (!el) return;
        el.classList.toggle('rw-sum-valid', valid);
        el.classList.toggle('rw-sum-invalid', !valid);
        const valEl = el.querySelector('.rw-sum-value');
        if (valEl) valEl.textContent = (sum * 100).toFixed(2);
        const iconEl = el.querySelector('.rw-sum-icon');
        if (iconEl) iconEl.textContent = valid ? '✓' : '⚠';
        // The trailing helper text is part of the static markup; toggle via class.
    }

    function renderRunButton() {
        const btn = document.getElementById('rwRunBtn');
        if (!btn) return;
        const valid = isStateRunnable();
        btn.disabled = !valid.ok;
        btn.title = valid.ok ? 'Generate weights and write to ClickHouse' : valid.reason;
    }

    function isStateRunnable() {
        if (!state.fileId) return { ok: false, reason: 'No file selected' };
        if (state.factors.length === 0) return { ok: false, reason: 'Add at least one factor' };
        for (const f of state.factors) {
            if (f.loading) return { ok: false, reason: `${f.name}: still loading codes` };
            const sum = Object.values(f.targets).reduce((a, b) => a + b, 0);
            if (Math.abs(sum - 1) > 1e-4) {
                return { ok: false, reason: `${f.name}: targets must sum to 100%` };
            }
        }
        const name = (state.targetVariable || '').trim();
        if (!name) return { ok: false, reason: 'Target variable name required' };
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            return { ok: false, reason: 'Target name must be a valid identifier (letters, digits, underscores; cannot start with a digit)' };
        }
        return { ok: true };
    }

    function showResultModal(result) {
        const host = document.getElementById('rwResultBody');
        const subtitle = document.getElementById('rwResultSubtitle');
        const titleEl = document.querySelector('#rimWeightingResultModal .gm-title');
        const iconEl = document.querySelector('#rimWeightingResultModal .gm-icon');
        if (!host) return;
        host.innerHTML = renderResultHtml(result);
        const ok = !!result?.success;
        if (titleEl) titleEl.textContent = ok ? 'Weights Generated' : 'Generation Failed';
        if (iconEl) {
            iconEl.innerHTML = ok
                ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                       <path d="M9 11l3 3L22 4"/>
                       <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                   </svg>`
                : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                       <circle cx="12" cy="12" r="10"/>
                       <line x1="12" y1="8" x2="12" y2="12"/>
                       <line x1="12" y1="16" x2="12.01" y2="16"/>
                   </svg>`;
            iconEl.style.color = ok ? '#3b82f6' : '#ef4444';
        }
        if (subtitle) {
            if (ok && result.statistics) {
                const tv = result.statistics.target_variable || state.targetVariable;
                subtitle.textContent = `${tv} · n=${result.statistics.n_rows ?? '—'} · efficiency ${result.statistics.efficiency ?? '—'}%`;
            } else {
                subtitle.textContent = 'Fix the issue below and try again';
            }
        }
        document.getElementById('rimWeightingResultModal')?.classList.add('active');
    }

    function closeRimWeightingResultModal() {
        document.getElementById('rimWeightingResultModal')?.classList.remove('active');
    }

    function renderResultHtml(result) {
        if (!result.success) {
            return `<div class="rw-error-block">
                <div class="rw-error-icon">⚠</div>
                <div class="rw-error-content">
                    <div class="rw-error-title">Could not generate weights</div>
                    <div class="rw-error-message">${escapeHtml(result.error || 'RIM run failed')}</div>
                    <div class="rw-error-hint">Check your filter expression, factor variables, and target percentages, then try again.</div>
                </div>
            </div>`;
        }
        const stats = result.statistics || {};
        const rows = result.rows || [];
        const colorClass = stats.converged ? 'rw-stat-good' : 'rw-stat-warn';

        const statsHtml = `
            <div class="rw-result-stats">
                <div class="rw-stat-pill ${colorClass}">
                    ${stats.converged ? '✓ Converged' : '⚠ Did not converge'}
                </div>
                <div class="rw-stat-pill">Iterations: <strong>${escapeHtml(String(stats.iterations ?? '—'))}</strong></div>
                <div class="rw-stat-pill">Efficiency: <strong>${escapeHtml(String(stats.efficiency ?? '—'))}%</strong></div>
                <div class="rw-stat-pill">N: <strong>${formatNum(stats.n_rows)}</strong></div>
                <div class="rw-stat-pill">Σ: <strong>${formatNum(stats.sum)}</strong></div>
                <div class="rw-stat-pill">Min: <strong>${formatFloat(stats.min)}</strong></div>
                <div class="rw-stat-pill">Max: <strong>${formatFloat(stats.max)}</strong></div>
                <div class="rw-stat-pill">Catalog: <strong>${stats.catalog_registered ? '✓ registered' : '✗ not registered'}</strong></div>
            </div>`;

        const tableHtml = `
            <table class="rw-result-table">
                <thead><tr>
                    <th>Variable</th>
                    <th>Code</th>
                    <th class="rw-num">Target&nbsp;%</th>
                    <th class="rw-num">Achieved&nbsp;%</th>
                    <th class="rw-num">Δ</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => {
                        const t = parseFloat(r.target_pct) || 0;
                        const a = parseFloat(r.achieved_pct) || 0;
                        const delta = (a - t).toFixed(2);
                        const ok = Math.abs(a - t) < 0.01;
                        return `<tr class="${ok ? 'rw-row-ok' : 'rw-row-warn'}">
                            <td>${escapeHtml(String(r.variable))}</td>
                            <td>${escapeHtml(String(r.code))}</td>
                            <td class="rw-num">${escapeHtml(String(r.target_pct))}</td>
                            <td class="rw-num">${escapeHtml(String(r.achieved_pct))}</td>
                            <td class="rw-num">${delta}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;

        const summary = result.summary
            ? `<div class="rw-result-summary">${escapeHtml(result.summary)}</div>` : '';

        return `<div class="rw-result-wrap">${summary}${statsHtml}${tableHtml}</div>`;
    }

    // -----------------------------------------------------------------------
    // Run / Reset
    // -----------------------------------------------------------------------

    async function rwRun() {
        const valid = isStateRunnable();
        if (!valid.ok) {
            Toast.error(valid.reason);
            return;
        }

        const factors = state.factors.map(f => ({
            variable: f.name,
            targets: f.targets,
        }));
        const inputParams = { target_variable: state.targetVariable, factors };
        const filterExpr = (state.filterExpression || '').trim();
        if (filterExpr) inputParams.filter = { expression: filterExpr };

        // Show inline loading state on the Run button so the user has feedback
        // without needing a result panel inside the builder modal.
        const runBtn = document.getElementById('rwRunBtn');
        const originalText = runBtn?.textContent;
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.textContent = 'Generating…';
        }

        try {
            const url = `${CONFIG.researchApiBaseUrl}/projects/${projectId}/functions/execute`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    function_name: 'rim_weighting',
                    file_id: state.fileId,
                    input_params: inputParams,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                state.lastResult = { success: false, error: body.error || `Request failed (${res.status})` };
            } else {
                state.lastResult = body;
            }
        } catch (err) {
            console.error('[rim_weighting]', err);
            state.lastResult = { success: false, error: err.message || 'Request failed' };
        } finally {
            if (runBtn) {
                runBtn.textContent = originalText || 'Generate Weights';
                renderRunButton();  // re-evaluate disabled state
            }
        }

        // On success, refresh the variables catalog FIRST (so the new column
        // appears in the Variables tab) — then open the result modal. Doing
        // it in this order avoids loadVariables's render passes from
        // accidentally clobbering the just-opened overlay.
        if (state.lastResult?.success) {
            Toast.success(`Weight column ${state.targetVariable} created`);
            if (typeof loadVariables === 'function') {
                try { await loadVariables(); } catch (e) { /* non-fatal */ }
            }
        }

        // Always pop the result modal — success shows the marginal table,
        // failure shows the error so it's clearly visible (toasts can be missed).
        showResultModal(state.lastResult);
    }

    function rwReset() {
        state.factors = [];
        state.filterExpression = '';
        state.targetVariable = '';
        state.lastResult = null;
        const nameInput = document.getElementById('rwTargetName');
        if (nameInput) nameInput.value = '';
        const filterInput = document.getElementById('rwFilterExpression');
        if (filterInput) filterInput.value = '';
        render();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function formatNum(n) {
        if (n === null || n === undefined || n === '') return '—';
        const v = Number(n);
        if (isNaN(v)) return String(n);
        return v.toLocaleString();
    }
    function formatFloat(n) {
        if (n === null || n === undefined || n === '') return '—';
        const v = Number(n);
        if (isNaN(v)) return String(n);
        return v.toFixed(4);
    }
    function cssEscape(s) {
        return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    // -----------------------------------------------------------------------
    // Public surface
    // -----------------------------------------------------------------------

    window.openRimWeightingModal = openRimWeightingModal;
    window.closeRimWeightingModal = closeRimWeightingModal;
    window.closeRimWeightingResultModal = closeRimWeightingResultModal;
    window.rwReset = rwReset;
    window.rwRun = rwRun;
    window.rwToggleFilter = rwToggleFilter;
})();
