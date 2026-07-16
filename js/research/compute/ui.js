/**
 * Compute Variable — UI module
 *
 * SPSS-style modal that creates a new integer column from a list of
 * IF / ELSE IF / ELSE branches via the backend `compute_variable` function.
 * Lives next to the RIM Weighting modal under Analyze → Transform.
 *
 * Branch model: an ordered array. The first branch is "IF", subsequent
 * branches are "ELSE IF". An optional terminal ELSE assigns a default
 * code/label to all rows that didn't match any branch.
 *
 * Drag a variable from the palette into a focused condition input → its
 * name gets inserted at the cursor. This is the SPSS Compute Variable UX
 * touch — saves typing column names exactly.
 *
 * Public surface (wired via onclick attributes in HTML):
 *   openComputeVariableModal()    — populate + show
 *   closeComputeVariableModal()   — hide
 *   cvReset()                     — clear branches + name
 *   cvRun()                       — build request and execute
 *   closeComputeVariableResultModal() — close result popup
 */
(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    const state = {
        initialized: false,
        fileId: null,
        // branches: [{ id, condition, code, label }]
        branches: [],
        // Optional terminal else: { code, label } | null
        elseBranch: null,
        targetVariable: '',
        targetLabel: '',
        searchTerm: '',
        lastResult: null,
    };

    let _branchIdCounter = 0;
    function nextBranchId() { return `cvb${++_branchIdCounter}`; }

    // The condition input the user last interacted with — drag-and-drop
    // from the palette inserts the variable name at this input's cursor.
    let lastFocusedInput = null;

    let currentVariables = [];
    let variablesByName = {};

    // -----------------------------------------------------------------------
    // Open / close
    // -----------------------------------------------------------------------

    async function openComputeVariableModal() {
        if (typeof variablesLoaded !== 'undefined' && !variablesLoaded
            && typeof loadVariables === 'function') {
            await loadVariables();
        }
        await refreshFromActiveFile();

        // Seed with a single empty IF branch whenever there are none — on first open, or
        // after refreshFromActiveFile cleared them on a file change (the old `!initialized`
        // gate meant a post-file-switch open showed zero branches and a disabled Run).
        if (state.branches.length === 0) {
            state.branches.push({ id: nextBranchId(), condition: '', code: 1, label: '' });
        }

        if (!state.initialized) {
            state.initialized = true;
            wireSearch();
            wireFooter();
        }

        render();
        document.getElementById('computeVariableModal')?.classList.add('active');
    }

    function closeComputeVariableModal() {
        document.getElementById('computeVariableModal')?.classList.remove('active');
    }

    function closeComputeVariableResultModal() {
        document.getElementById('computeVariableResultModal')?.classList.remove('active');
    }

    async function refreshFromActiveFile() {
        let fileId = (typeof getFileFilterValue === 'function' ? getFileFilterValue() : '') || '';
        if (!fileId && Array.isArray(allVariables) && allVariables.length > 0) {
            fileId = allVariables[0].fileId;
        }
        if (fileId !== state.fileId) {
            // File changed — reset branches since they might reference variables
            // that don't exist in the new file.
            state.branches = [];
            state.elseBranch = null;
            state.targetVariable = '';
            state.targetLabel = '';
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

        const label = document.getElementById('cvActiveFile');
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
        const input = document.getElementById('cvSearch');
        if (!input) return;
        input.addEventListener('input', () => {
            state.searchTerm = input.value.trim().toLowerCase();
            renderPalette();
        });
    }

    function wireFooter() {
        const nameInput = document.getElementById('cvTargetName');
        if (nameInput) {
            nameInput.addEventListener('input', () => {
                state.targetVariable = nameInput.value.trim();
                renderRunButton();
            });
        }
        const labelInput = document.getElementById('cvTargetLabel');
        if (labelInput) {
            labelInput.addEventListener('input', () => {
                state.targetLabel = labelInput.value;
            });
        }
    }

    // -----------------------------------------------------------------------
    // Variable palette — show ALL variables (compute can use any column)
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

    function renderPalette() {
        const host = document.getElementById('cvPaletteList');
        if (!host) return;
        if (!currentVariables || currentVariables.length === 0) {
            host.innerHTML = `<div class="ct-empty-palette">No variables available.</div>`;
            return;
        }

        const needle = state.searchTerm;
        const filtered = currentVariables.filter(v => {
            if (!needle) return true;
            const name = (v.variableName || v.variable_name || '').toLowerCase();
            const label = (v.variableLabel || v.variable_label || '').toLowerCase();
            return name.includes(needle) || label.includes(needle);
        });

        const groups = { categorical: [], numeric: [], text: [], datetime: [] };
        for (const v of filtered) groups[classifyVariable(v)].push(v);

        const order = ['categorical', 'numeric', 'text', 'datetime'];
        let html = '';
        for (const key of order) {
            const list = groups[key];
            if (list.length === 0) continue;
            const meta = GROUP_META[key];
            html += `<div class="ct-palette-group"><div class="ct-palette-group-title">${escapeHtml(meta.title)} · ${list.length}</div>`;
            for (const v of list) html += renderVariableItem(v, key);
            html += `</div>`;
        }
        if (!html) {
            html = `<div class="ct-palette-empty-hint">No matches for "${escapeHtml(needle)}"</div>`;
        }
        host.innerHTML = html;

        host.querySelectorAll('.ct-var-item').forEach(el => {
            el.addEventListener('dragstart', e => {
                el.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/variable', el.dataset.variableName);
            });
            el.addEventListener('dragend', () => el.classList.remove('dragging'));
            // Click-to-insert: append the variable name into the last focused
            // condition input. If none is focused, insert into the FIRST empty
            // condition; otherwise into the FIRST condition.
            el.addEventListener('click', () => {
                insertVariableName(el.dataset.variableName);
            });
        });
    }

    function renderVariableItem(v, groupKey) {
        const name = v.variableName || v.variable_name || '';
        const label = v.variableLabel || v.variable_label || '';
        const meta = GROUP_META[groupKey] || { icon: '?', cls: 'scale' };
        return `
            <div class="ct-var-item" draggable="true" data-variable-name="${escapeHtml(name)}" title="${escapeHtml(label || name)}">
                <span class="ct-var-icon ${meta.cls}">${meta.icon}</span>
                <div class="ct-var-text">
                    <div class="ct-var-name">${escapeHtml(name)}</div>
                    ${label ? `<div class="ct-var-label">${escapeHtml(label)}</div>` : ''}
                </div>
            </div>`;
    }

    function insertVariableName(varName) {
        // Find an input to insert into
        let target = lastFocusedInput;
        if (!target || !document.body.contains(target)) {
            // Fallback: first empty condition input, then first condition input
            const inputs = document.querySelectorAll('.cv-condition-input');
            target = Array.from(inputs).find(i => i.value === '') || inputs[0];
        }
        if (!target) return;

        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        const before = target.value.substring(0, start);
        const after = target.value.substring(end);
        const newValue = before + varName + after;

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(target, newValue);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
        const cursorPos = start + varName.length;
        target.setSelectionRange(cursorPos, cursorPos);
        lastFocusedInput = target;
    }

    // -----------------------------------------------------------------------
    // Branch rendering
    // -----------------------------------------------------------------------

    function render() {
        renderPalette();
        renderBranches();
        renderRunButton();
    }

    function renderBranches() {
        const host = document.getElementById('cvBranches');
        if (!host) return;

        const branchCount = state.branches.length;
        const html = state.branches.map((b, i) => renderBranchCard(b, i, branchCount))
            .join('') + renderElseSection();
        host.innerHTML = html;

        // Wire input handlers
        host.querySelectorAll('.cv-condition-input').forEach(input => {
            input.addEventListener('focus', () => { lastFocusedInput = input; });
            input.addEventListener('input', () => {
                const branch = state.branches.find(b => b.id === input.dataset.branchId);
                if (!branch) return;
                branch.condition = input.value;
                renderRunButton();
            });
            // Drag-drop: allow dropping a variable from the palette directly into this input
            input.addEventListener('dragover', (e) => {
                if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('text/variable')) {
                    e.preventDefault();
                    input.classList.add('cv-drag-over');
                }
            });
            input.addEventListener('dragleave', () => input.classList.remove('cv-drag-over'));
            input.addEventListener('drop', (e) => {
                const varName = e.dataTransfer?.getData('text/variable');
                if (!varName) return;
                e.preventDefault();
                input.classList.remove('cv-drag-over');
                lastFocusedInput = input;
                input.focus();
                insertVariableName(varName);
            });
        });

        host.querySelectorAll('.cv-code-input').forEach(input => {
            input.addEventListener('input', () => {
                const branch = state.branches.find(b => b.id === input.dataset.branchId);
                const isElse = input.dataset.elseInput === '1';
                // Empty input → null (invalid). Non-empty → parsed integer or
                // null if it can't be parsed. The runnable check rejects null.
                const raw = input.value.trim();
                const v = raw === '' ? null : (/^-?\d+$/.test(raw) ? parseInt(raw, 10) : null);
                if (isElse) {
                    if (state.elseBranch) state.elseBranch.code = v;
                } else if (branch) {
                    branch.code = v;
                }
                renderRunButton();
            });
        });

        host.querySelectorAll('.cv-label-input').forEach(input => {
            input.addEventListener('input', () => {
                const branch = state.branches.find(b => b.id === input.dataset.branchId);
                const isElse = input.dataset.elseInput === '1';
                if (isElse) {
                    if (state.elseBranch) state.elseBranch.label = input.value;
                } else if (branch) {
                    branch.label = input.value;
                }
            });
        });

        host.querySelectorAll('.cv-branch-remove').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = btn.dataset.branchId;
                state.branches = state.branches.filter(b => b.id !== id);
                if (state.branches.length === 0) {
                    state.branches.push({ id: nextBranchId(), condition: '', code: 1, label: '' });
                }
                render();
            });
        });

        const addBtn = document.getElementById('cvAddBranchBtn');
        if (addBtn) {
            addBtn.onclick = () => {
                // Next code = 1 + highest existing code, so removing a middle branch and
                // adding again can't mint a duplicate code (which would silently overwrite
                // a value label, since the backend keys labels by code).
                const nextCode = Math.max(state.branches.reduce((mx, b) => Math.max(mx, Number(b.code) || 0), 0), Number(state.elseBranch?.code) || 0) + 1;
                state.branches.push({ id: nextBranchId(), condition: '', code: nextCode, label: '' });
                render();
            };
        }
        const addElseBtn = document.getElementById('cvAddElseBtn');
        if (addElseBtn) {
            addElseBtn.onclick = () => {
                // 1 + highest existing branch code (same as the Add-branch path) so the ELSE
                // code can't collide with a branch code after a middle branch was removed.
                const nextCode = Math.max(state.branches.reduce((mx, b) => Math.max(mx, Number(b.code) || 0), 0), Number(state.elseBranch?.code) || 0) + 1;
                state.elseBranch = { code: nextCode, label: '' };
                render();
            };
        }
        const removeElseBtn = document.querySelector('.cv-else-remove');
        if (removeElseBtn) {
            removeElseBtn.onclick = () => {
                state.elseBranch = null;
                render();
            };
        }
    }

    function renderBranchCard(branch, index, total) {
        const isFirst = index === 0;
        const labelText = isFirst ? 'IF' : 'ELSE IF';
        return `
            <div class="cv-branch-card">
                <div class="cv-branch-header">
                    <div class="cv-branch-label">${labelText}</div>
                    ${total > 1 ? `<button class="cv-branch-remove" data-branch-id="${escapeHtml(branch.id)}" title="Remove this branch">&times;</button>` : ''}
                </div>
                <div class="cv-branch-row">
                    <input type="text" class="cv-condition-input"
                           data-branch-id="${escapeHtml(branch.id)}"
                           value="${escapeHtml(branch.condition)}"
                           placeholder="e.g. Q1 = 1 AND Q3 IN (3, 4)"
                           autocomplete="off" spellcheck="false">
                </div>
                <div class="cv-branch-then">
                    <span class="cv-then-label">THEN code</span>
                    <input type="number" class="cv-code-input"
                           data-branch-id="${escapeHtml(branch.id)}"
                           value="${branch.code ?? ''}" step="1"
                           inputmode="numeric">
                    <span class="cv-then-label">label</span>
                    <input type="text" class="cv-label-input"
                           data-branch-id="${escapeHtml(branch.id)}"
                           value="${escapeHtml(branch.label || '')}"
                           placeholder="optional"
                           autocomplete="off">
                </div>
            </div>`;
    }

    function renderElseSection() {
        if (!state.elseBranch) {
            return `
                <div class="cv-add-row">
                    <button id="cvAddBranchBtn" class="cv-add-btn">+ Add another branch</button>
                    <button id="cvAddElseBtn" class="cv-add-btn cv-add-btn-secondary">+ Add ELSE</button>
                </div>`;
        }
        return `
            <div class="cv-add-row">
                <button id="cvAddBranchBtn" class="cv-add-btn">+ Add another branch</button>
            </div>
            <div class="cv-branch-card cv-else-card">
                <div class="cv-branch-header">
                    <div class="cv-branch-label cv-else-label">ELSE</div>
                    <button class="cv-branch-remove cv-else-remove" title="Remove ELSE">&times;</button>
                </div>
                <div class="cv-branch-row">
                    <span class="cv-else-hint">All rows that didn't match any branch above</span>
                </div>
                <div class="cv-branch-then">
                    <span class="cv-then-label">THEN code</span>
                    <input type="number" class="cv-code-input"
                           data-else-input="1"
                           value="${state.elseBranch.code ?? ''}" step="1"
                           inputmode="numeric">
                    <span class="cv-then-label">label</span>
                    <input type="text" class="cv-label-input"
                           data-else-input="1"
                           value="${escapeHtml(state.elseBranch.label || '')}"
                           placeholder="optional"
                           autocomplete="off">
                </div>
            </div>`;
    }

    function renderRunButton() {
        const btn = document.getElementById('cvRunBtn');
        if (!btn) return;
        const valid = isStateRunnable();
        btn.disabled = !valid.ok;
        btn.title = valid.ok ? 'Compute the new variable and write to ClickHouse' : valid.reason;
    }

    function isStateRunnable() {
        if (!state.fileId) return { ok: false, reason: 'No file selected' };
        if (state.branches.length === 0) return { ok: false, reason: 'Add at least one branch' };
        for (let i = 0; i < state.branches.length; i++) {
            const b = state.branches[i];
            if (!b.condition || !b.condition.trim()) {
                return { ok: false, reason: `Branch ${i + 1}: condition is empty` };
            }
            if (!Number.isInteger(b.code)) {
                return { ok: false, reason: `Branch ${i + 1}: code must be an integer` };
            }
        }
        if (state.elseBranch && !Number.isInteger(state.elseBranch.code)) {
            return { ok: false, reason: 'ELSE: code must be an integer' };
        }
        const name = (state.targetVariable || '').trim();
        if (!name) return { ok: false, reason: 'Target variable name required' };
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            return { ok: false, reason: 'Target name must be a valid identifier' };
        }
        return { ok: true };
    }

    // -----------------------------------------------------------------------
    // Run / Reset
    // -----------------------------------------------------------------------

    async function cvRun() {
        const valid = isStateRunnable();
        if (!valid.ok) {
            Toast.error(valid.reason);
            return;
        }

        const inputParams = {
            target_variable: state.targetVariable,
            branches: state.branches.map(b => ({
                condition: b.condition.trim(),
                code: b.code,
                label: b.label || undefined,
            })),
        };
        if (state.targetLabel.trim()) inputParams.target_label = state.targetLabel.trim();
        if (state.elseBranch) {
            inputParams.else = {
                code: state.elseBranch.code,
                label: state.elseBranch.label || undefined,
            };
        }

        const runBtn = document.getElementById('cvRunBtn');
        const originalText = runBtn?.textContent;
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.textContent = 'Computing…';
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
                    function_name: 'compute_variable',
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
            console.error('[compute_variable]', err);
            state.lastResult = { success: false, error: err.message || 'Request failed' };
        } finally {
            if (runBtn) {
                runBtn.textContent = originalText || 'Compute Variable';
                renderRunButton();
            }
        }

        if (state.lastResult?.success) {
            Toast.success(`Column ${state.targetVariable} computed`);
            if (typeof loadVariables === 'function') {
                try { await loadVariables(); } catch (e) { /* non-fatal */ }
            }
        }

        showResultModal(state.lastResult);
    }

    function cvReset() {
        state.branches = [{ id: nextBranchId(), condition: '', code: 1, label: '' }];
        state.elseBranch = null;
        state.targetVariable = '';
        state.targetLabel = '';
        state.lastResult = null;
        const nameInput = document.getElementById('cvTargetName');
        if (nameInput) nameInput.value = '';
        const labelInput = document.getElementById('cvTargetLabel');
        if (labelInput) labelInput.value = '';
        render();
    }

    // -----------------------------------------------------------------------
    // Result modal
    // -----------------------------------------------------------------------

    function showResultModal(result) {
        const host = document.getElementById('cvResultBody');
        const subtitle = document.getElementById('cvResultSubtitle');
        const titleEl = document.querySelector('#computeVariableResultModal .gm-title');
        const iconEl = document.querySelector('#computeVariableResultModal .gm-icon');
        if (!host) return;
        host.innerHTML = renderResultHtml(result);
        const ok = !!result?.success;
        if (titleEl) titleEl.textContent = ok ? 'Variable Computed' : 'Computation Failed';
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
                subtitle.textContent = `${tv} · ${formatNum(result.statistics.assigned)} rows assigned`;
            } else {
                subtitle.textContent = 'Fix the issue below and try again';
            }
        }
        document.getElementById('computeVariableResultModal')?.classList.add('active');
    }

    function renderResultHtml(result) {
        if (!result.success) {
            return `<div class="rw-error-block">
                <div class="rw-error-icon">⚠</div>
                <div class="rw-error-content">
                    <div class="rw-error-title">Could not compute variable</div>
                    <div class="rw-error-message">${escapeHtml(result.error || 'Compute variable failed')}</div>
                    <div class="rw-error-hint">Check your branch conditions, code values, and target name, then try again.</div>
                </div>
            </div>`;
        }
        const stats = result.statistics || {};
        const rows = result.rows || [];

        const statsHtml = `
            <div class="rw-result-stats">
                <div class="rw-stat-pill rw-stat-good">✓ Computed</div>
                <div class="rw-stat-pill">Branches: <strong>${escapeHtml(String(stats.branches ?? '—'))}</strong></div>
                <div class="rw-stat-pill">Assigned: <strong>${formatNum(stats.assigned)}</strong></div>
                ${stats.null_count > 0 ? `<div class="rw-stat-pill">Unmatched: <strong>${formatNum(stats.null_count)}</strong></div>` : ''}
                <div class="rw-stat-pill">Catalog: <strong>${stats.catalog_registered ? '✓ registered' : '✗ not registered'}</strong></div>
            </div>`;

        const tableHtml = `
            <table class="rw-result-table">
                <thead><tr>
                    <th>Branch</th>
                    <th>Code</th>
                    <th>Label</th>
                    <th class="rw-num">Count</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td><span class="cv-result-branch">${escapeHtml(String(r.branch))}</span></td>
                        <td>${escapeHtml(String(r.code))}</td>
                        <td>${escapeHtml(String(r.label || ''))}</td>
                        <td class="rw-num">${formatNum(r.count)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;

        const summary = result.summary
            ? `<div class="rw-result-summary">${escapeHtml(result.summary)}</div>` : '';

        return `<div class="rw-result-wrap">${summary}${statsHtml}${tableHtml}</div>`;
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

    // -----------------------------------------------------------------------
    // Public surface
    // -----------------------------------------------------------------------

    window.openComputeVariableModal = openComputeVariableModal;
    window.closeComputeVariableModal = closeComputeVariableModal;
    window.closeComputeVariableResultModal = closeComputeVariableResultModal;
    window.cvReset = cvReset;
    window.cvRun = cvRun;
})();
