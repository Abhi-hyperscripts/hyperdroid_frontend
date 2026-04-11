/**
 * Custom Tables — UI module (PR A1)
 *
 * State, palette renderer, drag-drop, Run button, response grid.
 * Lives inside the #customTableModal gm-overlay. Opened from the
 * "Analyze → Custom Tables" dropdown in the project header.
 *
 * Uses the existing project-detail.js `allVariables` list +
 * `getFileFilterValue()` for the active file, so there's no separate file
 * picker — whatever's selected on the Variables tab is the one that gets
 * tabulated.
 *
 * Public surface (wired via onclick attributes in HTML):
 *   openCustomTableModal()   — populate + show the modal
 *   closeCustomTableModal()  — hide it
 *   toggleAnalyzeDropdown()  — show/hide the Analyze dropdown menu
 *   closeAnalyzeDropdown()   — hide the Analyze dropdown
 *   ctReset()                — clear drop slots + preview
 *   ctRun()                  — build request and execute
 */

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /**
     * Drop-slot state — each axis holds an array of GROUPS, not a flat list
     * of variable names. A group is { id, vars: [variableName, ...] } where
     * vars inside one group nest as Cartesian product and multiple groups on
     * the same axis concatenate side-by-side (mixed nest + stack). This is
     * how SPSS Custom Tables models banner breaks.
     */
    /**
     * Row groups support per-group summary stats. Count + % are always shown.
     * Toggleable stats render as extra sub-rows under each category cell.
     * Each stat runs as its own backend query (same rows/columns/filter but
     * with a different `measure` clause) and is merged client-side.
     */
    const AGG_STATS = ['mean', 'median', 'std_dev', 'variance', 'min', 'max', 'sum'];
    const AGG_LABELS = {
        mean: 'Mean',
        median: 'Median',
        std_dev: 'Std dev',
        variance: 'Variance',
        min: 'Min',
        max: 'Max',
        sum: 'Sum',
    };

    const state = {
        initialized: false,
        fileId: null,
        rows: [],        // [{id, vars:[...], stats:[...], statsTarget?}, ...]
        columns: [],
        filter: [],
        weight: [],      // same shape as other slots; max 1 group / 1 var
        searchTerm: '',
    };

    /** Return true if the variable def represents a true numeric value (no
     *  categorical labels attached). Used to gate the Weight drop zone. */
    function isUnlabeledNumeric(varDef) {
        if (!varDef) return false;
        const t = (varDef.variableType || varDef.variable_type || '').toLowerCase();
        const isNum = t === 'integer' || t === 'double' || t === 'float' || t === 'numeric';
        if (!isNum) return false;
        const raw = varDef.valueLabelsJson || varDef.valueLabelJson || varDef.value_labels_json;
        const hasLabels = raw && raw !== '{}' && raw !== 'null';
        return !hasLabels;
    }

    let _groupIdCounter = 0;
    function nextGroupId() { return `g${++_groupIdCounter}`; }

    /** Return true if the variable is already placed anywhere in the slot's groups. */
    function slotContainsVar(slotKey, varName) {
        return (state[slotKey] || []).some(g => g.vars.some(v => v.name === varName));
    }

    /** Factory for a new var entry inside a group. `includedCodes: null` = include all. */
    function newVarEntry(name) {
        return { name, includedCodes: null };
    }

    /** variablesByName lookup for the currently selected file. Rebuilt on init/file change. */
    let currentVariables = [];          // array of variable defs for the active file
    let variablesByName = {};           // { NAME: def }

    /** Cache of real data codes per variable, populated lazily when the user
     *  drops a variable into a slot. Keyed by UPPERCASE variable name.
     *  Each value is the [{code, label, count}] array returned by
     *  GET /api/files/{id}/variables/{name}/codes. Survives within the same
     *  modal session; cleared on reset or file change. */
    const codesCache = new Map();
    const pendingCodeFetches = new Map();  // variableName -> Promise for in-flight fetches

    // -----------------------------------------------------------------------
    // Open / close (modal lifecycle)
    // -----------------------------------------------------------------------

    async function openCustomTableModal() {
        // Reuse the Variables tab data so we don't duplicate fetches. If the
        // user hasn't visited the Variables tab yet, trigger the load now.
        if (typeof variablesLoaded !== 'undefined' && !variablesLoaded
            && typeof loadVariables === 'function') {
            await loadVariables();
        }

        await refreshFromActiveFile();

        // Wire once; open and close don't teardown state, so ongoing work
        // survives a close/reopen round trip.
        if (!state.initialized) {
            state.initialized = true;
            wireSearch();
            wireDropZones();
        }

        render();
        document.getElementById('customTableModal')?.classList.add('active');
    }

    function closeCustomTableModal() {
        document.getElementById('customTableModal')?.classList.remove('active');
    }

    // -----------------------------------------------------------------------
    // Analyze dropdown (sibling of the Actions dropdown in the header)
    // -----------------------------------------------------------------------

    function toggleAnalyzeDropdown() {
        const trigger = document.getElementById('analyzeTrigger');
        const menu = document.getElementById('analyzeMenu');
        if (!trigger || !menu) return;
        const isOpen = menu.classList.contains('open');
        if (isOpen) {
            closeAnalyzeDropdown();
        } else {
            trigger.classList.add('open');
            menu.classList.add('open');
            setTimeout(() => {
                document.addEventListener('click', _closeAnalyzeOnOutside);
            }, 0);
        }
    }

    function closeAnalyzeDropdown() {
        const trigger = document.getElementById('analyzeTrigger');
        const menu = document.getElementById('analyzeMenu');
        trigger?.classList.remove('open');
        menu?.classList.remove('open');
        document.removeEventListener('click', _closeAnalyzeOnOutside);
    }

    function _closeAnalyzeOnOutside(e) {
        const drop = document.getElementById('analyzeDropdown');
        if (drop && !drop.contains(e.target)) closeAnalyzeDropdown();
    }

    async function refreshFromActiveFile() {
        // Prefer the Variables tab's file filter. If nothing selected there
        // (first load), pick the first ready file from allVariables.
        let fileId = (typeof getFileFilterValue === 'function' ? getFileFilterValue() : '') || '';
        if (!fileId && Array.isArray(allVariables) && allVariables.length > 0) {
            fileId = allVariables[0].fileId;
        }
        if (fileId !== state.fileId) {
            // File changed — invalidate the codes cache so stale labels from
            // a different file never leak across.
            codesCache.clear();
            pendingCodeFetches.clear();
        }
        state.fileId = fileId;

        const group = (allVariables || []).find(g => g.fileId === fileId);
        currentVariables = group?.variables || [];
        variablesByName = {};
        for (const v of currentVariables) {
            const name = (v.variableName || v.variable_name || '').toUpperCase();
            if (name) variablesByName[name] = v;
        }

        const label = document.getElementById('ctActiveFile');
        if (label) {
            if (group) {
                label.innerHTML = `File: <strong>${escapeHtml(group.fileName || '')}</strong> &middot; ${currentVariables.length} variables`;
            } else {
                label.textContent = 'No file selected — open the Variables tab and pick one.';
            }
        }
    }

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    function wireSearch() {
        const input = document.getElementById('ctSearch');
        if (!input) return;
        input.addEventListener('input', () => {
            state.searchTerm = input.value.trim().toLowerCase();
            renderPalette();
        });
    }

    function wireDropZones() {
        document.querySelectorAll('#customTableModal .ct-slot-body').forEach(body => {
            body.addEventListener('dragover', e => {
                e.preventDefault();
                // Highlight the closest group if the pointer is over one,
                // otherwise the whole body (= will create a new group).
                const group = e.target.closest('.ct-group');
                body.querySelectorAll('.ct-group.drop-target').forEach(el => el.classList.remove('drop-target'));
                if (group) {
                    group.classList.add('drop-target');
                    body.classList.remove('drag-over');
                } else {
                    body.classList.add('drag-over');
                }
            });
            body.addEventListener('dragleave', () => {
                body.classList.remove('drag-over');
                body.querySelectorAll('.ct-group.drop-target').forEach(el => el.classList.remove('drop-target'));
            });
            body.addEventListener('drop', e => {
                e.preventDefault();
                body.classList.remove('drag-over');
                body.querySelectorAll('.ct-group.drop-target').forEach(el => el.classList.remove('drop-target'));
                const varName = e.dataTransfer.getData('text/variable');
                if (!varName) return;
                const slot = body.id === 'ctSlotRows' ? 'rows'
                    : body.id === 'ctSlotColumns' ? 'columns'
                    : body.id === 'ctSlotFilter' ? 'filter'
                    : body.id === 'ctSlotWeight' ? 'weight'
                    : null;
                if (!slot) return;

                // Weight slot: only numeric (unlabeled) variables are valid.
                // Replace any existing weight — one weight per table.
                if (slot === 'weight') {
                    const def = variablesByName[varName];
                    if (!isUnlabeledNumeric(def)) {
                        Toast.error(`${varName} isn't a numeric variable — Weight only accepts integer/double columns without value labels.`);
                        return;
                    }
                    state.weight = [{ id: nextGroupId(), vars: [newVarEntry(varName)] }];
                    render();
                    return;
                }

                if (slotContainsVar(slot, varName)) return;

                // Drop onto an existing group = nest (append to that group's
                // vars). Drop onto empty space = new group (= stack).
                const groupEl = e.target.closest('.ct-group');
                if (groupEl) {
                    const id = groupEl.dataset.groupId;
                    const group = state[slot].find(g => g.id === id);
                    if (group) group.vars.push(newVarEntry(varName));
                } else {
                    state[slot].push({ id: nextGroupId(), vars: [newVarEntry(varName)] });
                }
                fetchVariableCodes(varName);
                render();
            });
        });
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    function render() {
        renderPalette();
        renderSlots();
        renderRunButton();
    }

    /**
     * Bucket a variable into one of four groups based on what's *actually*
     * true in the datamap, not the unreliable SPSS measurementType field.
     * Qualtrics (and several other tools) mislabel everything as "scale" even
     * when there are value labels, so we go by evidence:
     *
     *   categorical = has value labels (nominal or ordinal — either way it's
     *                 a code with a label the user can pick from)
     *   numeric     = integer / double with no labels → use in mean/median
     *   text        = string type → open-end, only valid as filter or rows
     *                 (drag-onto-column won't produce useful buckets)
     *   datetime    = spss_format starts with DATE / TIME / DATETIME
     */
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
        const host = document.getElementById('ctPaletteList');
        if (!host) return;
        if (!currentVariables || currentVariables.length === 0) {
            host.innerHTML = `<div class="ct-empty-palette">No variables available. Upload a file and wait for parsing to finish.</div>`;
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

        // Categorical first — that's what you'll put in Rows/Columns.
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

        // Wire drag + click handlers on every rendered item.
        host.querySelectorAll('.ct-var-item').forEach(el => {
            el.addEventListener('dragstart', e => {
                el.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/variable', el.dataset.variableName);
            });
            el.addEventListener('dragend', () => el.classList.remove('dragging'));
            // Click-to-assign fallback for users who don't realise it's draggable
            // or can't drag (touch, accessibility). Click cycles through the
            // first empty slot in this order: columns → rows → filter.
            el.addEventListener('click', () => {
                // Click-to-assign: first click creates the first Columns group
                // (single variable). Subsequent clicks stack a new Rows group.
                // Filter is never added via click — drag it there explicitly.
                const varName = el.dataset.variableName;
                const placed = slotContainsVar('columns', varName)
                    || slotContainsVar('rows', varName)
                    || slotContainsVar('filter', varName);
                if (placed) return;
                if (state.columns.length === 0) {
                    state.columns.push({ id: nextGroupId(), vars: [newVarEntry(varName)] });
                } else {
                    state.rows.push({ id: nextGroupId(), vars: [newVarEntry(varName)] });
                }
                fetchVariableCodes(varName);
                render();
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

    function renderSlots() {
        renderSlot('ctSlotRows', state.rows, 'rows');
        renderSlot('ctSlotColumns', state.columns, 'columns');
        renderSlot('ctSlotFilter', state.filter, 'filter');
        renderSlot('ctSlotWeight', state.weight, 'weight');
    }

    /**
     * Render a slot's groups. Each group is a card showing its variables
     * stacked with "×" joiners (nesting visual); multiple groups appear
     * side-by-side to indicate axis stacking.
     */
    function renderSlot(elId, groups, slotKey) {
        const host = document.getElementById(elId);
        if (!host) return;
        // Count badge in the header shows total var count across groups.
        const totalVars = (groups || []).reduce((acc, g) => acc + (g.vars?.length || 0), 0);
        const countEl = document.getElementById(`ctSlotCount${slotKey.charAt(0).toUpperCase()}${slotKey.slice(1)}`);
        if (countEl) countEl.textContent = totalVars > 0 ? ` · ${totalVars}` : '';

        if (!groups || groups.length === 0) {
            const emptyText = slotKey === 'weight' ? 'Drag a weight variable here' : 'Drag a variable here';
            host.innerHTML = `<div class="ct-slot-empty">${emptyText}</div>`;
            return;
        }

        host.innerHTML = groups.map(group => {
            const isRows = slotKey === 'rows';
            const statsBtnHtml = isRows
                ? `<button class="ct-group-stats-btn" data-group-id="${escapeHtml(group.id)}" title="Summary stats (mean, median, …)" aria-label="Stats">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="4" width="3" height="14"/></svg>
                        ${(group.stats && group.stats.length > 0) ? `<span class="ct-group-stats-count">${group.stats.length}</span>` : ''}
                    </button>`
                : '';
            const varsHtml = group.vars.map((v, i) => {
                const def = variablesByName[v.name];
                const label = def ? (def.variableLabel || def.variable_label || '') : '';
                const joiner = i > 0
                    ? `<span class="ct-group-joiner" title="Nested (Cartesian)">×</span>`
                    : '';
                // Badge appears when includedCodes is set and the user has
                // excluded some categories — a visual hint that the var is
                // filtered.
                const codesBadge = (Array.isArray(v.includedCodes) && v.includedCodes.length > 0)
                    ? `<span class="ct-group-var-badge" title="${v.includedCodes.length} codes kept">${v.includedCodes.length}</span>`
                    : '';
                return `${joiner}<div class="ct-group-var" data-variable-name="${escapeHtml(v.name)}" data-slot="${slotKey}" data-group-id="${escapeHtml(group.id)}" title="Click to choose which codes to keep">
                    <span class="ct-group-var-name">${escapeHtml(v.name)}</span>
                    ${label ? `<span class="ct-group-var-label">${escapeHtml(label)}</span>` : ''}
                    ${codesBadge}
                    <button class="ct-group-var-remove" data-slot="${slotKey}" data-group-id="${escapeHtml(group.id)}" data-variable-name="${escapeHtml(v.name)}" title="Remove">&times;</button>
                </div>`;
            }).join('');
            return `<div class="ct-group" data-slot="${slotKey}" data-group-id="${escapeHtml(group.id)}">
                ${varsHtml}
                ${statsBtnHtml}
            </div>`;
        }).join('');

        host.querySelectorAll('.ct-group-stats-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openStatsPopover(btn);
            });
        });

        host.querySelectorAll('.ct-group-var-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slot = btn.dataset.slot;
                const groupId = btn.dataset.groupId;
                const name = btn.dataset.variableName;
                const group = state[slot].find(g => g.id === groupId);
                if (!group) return;
                group.vars = group.vars.filter(v => v.name !== name);
                if (group.vars.length === 0) {
                    state[slot] = state[slot].filter(g => g.id !== groupId);
                }
                render();
            });
        });

        // Click the var chip (but not its remove button) to open the
        // include/exclude popover for that variable.
        host.querySelectorAll('.ct-group-var').forEach(chip => {
            chip.addEventListener('click', (e) => {
                if (e.target.closest('.ct-group-var-remove')) return;
                e.stopPropagation();
                openCodesPopover(chip);
            });
            // Dragging the chip into another group = move / nest — draggable
            // within the builder isn't implemented yet but we mark it
            // draggable: false so the browser's default text-drag doesn't
            // interfere with the click.
            chip.setAttribute('draggable', 'false');
        });
    }

    // Safety rails. The backend GROUP BY rewrite (PR A5) removed the old 256KB
    // SQL cliff, so we can push these much higher — the only remaining ceiling
    // is the browser rendering the flat HTML grid. 20k cells is sluggish but
    // usable; anything bigger is almost certainly meant for Excel export.
    const MAX_COLUMNS = 300;
    const MAX_ROWS    = 1000;
    const MAX_CELLS   = 20000;

    function estimateTableSize() {
        if (!state.fileId) return { rows: 0, cols: 0, cells: 0 };
        try {
            const req = window.CustomTable.buildCustomTableRequest(state, variablesByName, state.fileId, codesCache);
            const rowN = (req.input_params.rows || []).length;
            const colN = (req.input_params.columns || []).length || 1;  // fallback Total col
            return { rows: rowN, cols: colN, cells: rowN * colN };
        } catch {
            return { rows: 0, cols: 0, cells: 0 };
        }
    }

    /**
     * Fetch real data codes for a variable and cache them. Idempotent;
     * concurrent calls for the same variable share one in-flight promise.
     * Swallows network errors so the UI falls back to value_labels_json.
     */
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
                console.warn('[ct fetchVariableCodes]', variableName, err);
                return null;
            } finally {
                pendingCodeFetches.delete(key);
            }
        })();
        pendingCodeFetches.set(key, promise);
        return promise;
    }

    /**
     * Kick off a code fetch for every variable currently in the drop slots.
     * Awaited by ctRun before building the request so the codes cache is warm.
     */
    async function prefetchAllDroppedCodes() {
        const names = new Set();
        for (const axis of [state.rows, state.columns, state.filter]) {
            for (const group of axis) for (const v of group.vars) names.add(v.name);
        }
        await Promise.all(Array.from(names).map(n => fetchVariableCodes(n)));
    }

    function renderRunButton() {
        const btn = document.getElementById('ctRunBtn');
        if (!btn) return;
        const totalGroupVars = (axis) => axis.reduce((a, g) => a + (g.vars?.length || 0), 0);
        const hasSomething = totalGroupVars(state.rows) > 0 || totalGroupVars(state.columns) > 0;

        const size = estimateTableSize();
        const over = size.cols > MAX_COLUMNS || size.rows > MAX_ROWS || size.cells > MAX_CELLS;

        btn.disabled = !hasSomething || !state.fileId || over;

        // Live size chip below the Layout panel (NOT inside it — inserting
        // into .ct-layout wastes space that the panel can't reclaim when
        // collapsed). Sits between Layout and Preview in .ct-builder.
        let hint = document.getElementById('ctSizeHint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'ctSizeHint';
            hint.className = 'ct-size-hint';
            const layout = document.getElementById('ctLayoutPanel');
            layout?.parentElement?.insertBefore(hint, layout.nextSibling);
        }
        if (!hasSomething) {
            hint.textContent = '';
            hint.classList.remove('warn');
        } else if (over) {
            let reason = '';
            if (size.cols > MAX_COLUMNS) reason = `${size.cols} columns exceeds ${MAX_COLUMNS}. Remove a variable from Columns.`;
            else if (size.rows > MAX_ROWS) reason = `${size.rows} rows exceeds ${MAX_ROWS}. Remove a variable from Rows.`;
            else reason = `${size.cells.toLocaleString()} cells exceeds ${MAX_CELLS.toLocaleString()}. Reduce Rows or Columns.`;
            hint.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${escapeHtml(reason)}`;
            hint.classList.add('warn');
        } else {
            hint.textContent = `${size.rows} rows × ${size.cols} cols = ${size.cells.toLocaleString()} cells`;
            hint.classList.remove('warn');
        }
    }

    // -----------------------------------------------------------------------
    // Reset + Run
    // -----------------------------------------------------------------------

    function ctReset() {
        state.rows = [];
        state.columns = [];
        state.filter = [];
        state.weight = [];
        document.getElementById('ctPreview').innerHTML =
            `<div class="ct-preview-empty">Drop a variable on Rows or Columns and press Run to see results.</div>`;
        render();
    }

    async function ctRun() {
        if (!state.fileId) {
            Toast.error('No file selected. Open the Variables tab and pick a file first.');
            return;
        }

        // Make sure we have fresh variablesByName for the currently active file
        await refreshFromActiveFile();
        // Warm the codes cache for every dropped variable so the expansion
        // uses real data values instead of potentially-stale labels.
        await prefetchAllDroppedCodes();

        // Sanity-check that every dropped variable expands to ≥1 entry. If a
        // user filtered a variable down to codes with zero data, the group's
        // cartesian product collapses to empty and the backend would silently
        // fall back to a Total column/row — very confusing. Warn instead.
        for (const [axis, groups] of [['Columns', state.columns], ['Rows', state.rows]]) {
            for (const g of groups || []) {
                const entries = window.CustomTable.expandGroup(g, variablesByName, codesCache);
                if (entries.length === 0) {
                    const names = g.vars.map(v => v.name).join(' × ');
                    Toast.error(`${axis} group [${names}] has no matching codes after filtering — uncheck fewer codes or add another variable.`);
                    return;
                }
            }
        }

        // Single request. The backend supports a `statistics` parameter that
        // appends descriptive-stat rows below the data rows, computed across
        // the row values in each column. Deduplicate the union of enabled
        // stats across all row groups.
        const baseRequest = window.CustomTable.buildCustomTableRequest(state, variablesByName, state.fileId, codesCache);
        baseRequest.input_params.measure = { type: 'count' };
        const weightVar = state.weight?.[0]?.vars?.[0]?.name;
        if (weightVar) baseRequest.input_params.weight = { variable: weightVar };

        // Assemble the atomic unit list: the base table plus one variant per
        // row group that has stats enabled. The backend runs each in sequence
        // via /execute-batch so the whole table renders from a single round
        // trip rather than N parallel HTTP calls.
        const statVariants = buildStatVariantRequests(baseRequest);
        const batchVariants = [baseRequest.input_params, ...statVariants.map(v => v.request.input_params)];

        const preview = document.getElementById('ctPreview');
        preview.innerHTML = `
            <div class="ct-preview-loading">
                <div class="spinner"></div>
                <div>Running custom table…</div>
            </div>`;

        try {
            const url = `${CONFIG.researchApiBaseUrl}/projects/${projectId}/functions/execute-batch`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    function_name: 'custom_table',
                    variants: batchVariants,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || body.message || `Request failed (${res.status})`);
            const results = body.results || [];
            if (results.length === 0 || results[0].success === false) {
                throw new Error(results[0]?.error || 'Base table query failed');
            }
            const baseResult = results[0];
            const variantResults = statVariants.map((v, i) => ({
                ok: results[i + 1]?.success !== false,
                body: results[i + 1],
                groupId: v.groupId,
            }));
            renderResult(mergeVariantStatsIntoBase(baseResult, variantResults.filter(v => v.ok)));
        } catch (err) {
            console.error('[customtable run]', err);
            preview.innerHTML = `<div class="ct-preview-error">${escapeHtml(err.message || 'Request failed')}</div>`;
        }
    }

    /**
     * For every row group that has stats enabled, produce a cloned request
     * where `rows` is replaced by JUST that group's expansion and where
     * `statistics` carries the group's enabled stat list.
     */
    function buildStatVariantRequests(baseRequest) {
        const variants = [];
        for (const group of state.rows || []) {
            if (!group.stats || group.stats.length === 0) continue;
            const expanded = window.CustomTable.expandGroup(group, variablesByName, codesCache);
            if (expanded.length === 0) continue;
            const req = JSON.parse(JSON.stringify(baseRequest));
            // Keep a Base row first so backend stat skip-list still excludes it.
            req.input_params.rows = [
                { label: 'Base', expression: '1=1' },
                ...expanded,
            ];
            req.input_params.statistics = [...group.stats];
            variants.push({ groupId: group.id, request: req });
        }
        return variants;
    }

    /**
     * Merge per-group stat rows from the variant responses into the base
     * result. For each group we locate the last category row that belongs
     * to it, then insert the variant's stat rows (Mean/Std Dev/…) right
     * after it — so each group's stats sit at the end of its own section.
     */
    function mergeVariantStatsIntoBase(baseBody, variantResponses) {
        const base = baseBody.result || baseBody;
        if (!base?.rows || variantResponses.length === 0) return baseBody;

        const cols = base.columns || [];
        const rowLabelKey = cols[0];
        if (!rowLabelKey) return baseBody;

        // Label → groupId map so we can find each group's last row index.
        const labelToGroupId = new Map();
        for (const g of state.rows || []) {
            const expanded = window.CustomTable.expandGroup(g, variablesByName, codesCache);
            for (const e of expanded) {
                labelToGroupId.set(e.label, g.id);
                // Backend may indent labels when there are multiple groups.
                labelToGroupId.set('  ' + e.label, g.id);
            }
        }

        // Extract stat-row labels ('Mean', 'Median', 'Std Dev', …) from each
        // variant response. These are the rows the backend appended.
        const STAT_LABELS = new Set(['Mean', 'Median', 'Std Dev', 'Variance', 'Min', 'Max', 'Sum']);
        const statRowsByGroup = new Map();
        for (const v of variantResponses) {
            const vResult = v.body.result || v.body;
            const vRows = (vResult.rows || []).filter(r => {
                const lbl = String(r[rowLabelKey] ?? '').trim();
                return STAT_LABELS.has(lbl);
            });
            // Mark them so renderResult styles them as ct-row-stat.
            for (const r of vRows) r.__ct_stat_sub = true;
            statRowsByGroup.set(v.groupId, vRows);
        }

        // Walk base rows. For each row that belongs to a group, remember it as
        // the current group's "last row". When the group changes (or we reach
        // the end), flush that group's stat rows into the output.
        const newRows = [];
        let currentGroup = null;
        for (let i = 0; i < base.rows.length; i++) {
            const row = base.rows[i];
            const lbl = String(row[rowLabelKey] ?? '');
            const gid = labelToGroupId.get(lbl) || null;

            if (currentGroup && gid !== currentGroup) {
                // Flush stats for the group we're leaving.
                const stats = statRowsByGroup.get(currentGroup) || [];
                for (const s of stats) newRows.push(s);
                currentGroup = null;
            }
            newRows.push(row);
            if (gid) currentGroup = gid;
        }
        // End of table — flush the last seen group if any.
        if (currentGroup) {
            const stats = statRowsByGroup.get(currentGroup) || [];
            for (const s of stats) newRows.push(s);
        }

        return { result: { ...base, rows: newRows } };
    }

    // -----------------------------------------------------------------------
    // Result renderer
    // -----------------------------------------------------------------------

    /** Last rendered result kept so the CSV export can re-serialize without a refetch. */
    let lastResult = null;

    function renderResult(body) {
        // The function's response unwraps into body.result OR body directly
        // depending on the controller. Handle both.
        const result = body.result || body;
        if (!result || !result.rows || !result.columns) {
            document.getElementById('ctPreview').innerHTML =
                `<div class="ct-preview-error">Unexpected response shape: ${escapeHtml(JSON.stringify(result).slice(0, 200))}</div>`;
            return;
        }
        lastResult = result;

        const cols = result.columns;
        const rows = result.rows;
        const cellCount = (cols.length - 1) * rows.length;

        // Toolbar: summary + export. Always visible for every result.
        const toolbarHtml = `
            <div class="ct-result-toolbar">
                <div class="ct-result-summary">
                    ${escapeHtml(result.summary || '')}
                    <span class="ct-result-size">${rows.length} rows × ${cols.length - 1} cols (${cellCount.toLocaleString()} cells)</span>
                </div>
                <button class="ct-btn ct-btn-ghost ct-btn-sm" onclick="ctExportCsv()">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Export CSV
                </button>
            </div>`;

        // Build a hierarchical thead. Columns are named like
        // "Male / Metro / Yes / Couple with dependent children" when the
        // request nests 4 variables. We split on " / " and render one thead
        // row per segment, merging consecutive identical values into colspans
        // so the grouping reads SPSS-style top-to-bottom.
        const headerHtml = buildHierarchicalHeader(cols);
        const baseLabels = new Set(['Unweighted Base', 'Weighted Base', 'Effective Base', 'Base']);

        // content-visibility: auto on every row tells the browser to skip
        // layout + paint for rows outside the viewport. Flat HTML + zero JS
        // virtualization — the browser does the work. Pairs with
        // contain-intrinsic-size so the scrollbar still reflects true height.
        //
        // Section detection: rows whose label starts with "— " are
        // per-group headers (emitted when there are multiple row variables).
        // Inject a blank separator row before each section (except the first)
        // so grouped row variables visually break apart.
        const isSectionLabel = (s) => /^[—–]\s/.test(String(s || '').trim());
        const STAT_LABELS = new Set(['Mean', 'Median', 'Std Dev', 'Variance', 'Min', 'Max', 'Sum']);
        const colCount = cols.length;
        const parts = [];
        let seenSection = false;
        for (const row of rows) {
            const rowLabel = String(row[cols[0]] ?? '');
            const labelTrim = rowLabel.trim();
            const isBase = baseLabels.has(labelTrim);
            const isSection = isSectionLabel(rowLabel);
            const isStatSub = row.__ct_stat_sub === true || STAT_LABELS.has(labelTrim);
            // Skip empty separator row the backend emits before stats — our
            // CSS styles .ct-row-stat with a top border that reads as a natural
            // divider, no dedicated separator tr needed.
            if (labelTrim === '' && cols.slice(1).every(c => String(row[c] ?? '').trim() === '')) {
                parts.push(`<tr class="ct-row-separator"><td colspan="${colCount}"></td></tr>`);
                continue;
            }
            if (isSection) {
                if (seenSection) {
                    parts.push(`<tr class="ct-row-separator"><td colspan="${colCount}"></td></tr>`);
                }
                seenSection = true;
            }
            const rowClass = isBase
                ? 'ct-row-base'
                : isSection
                    ? 'ct-row-section'
                    : isStatSub
                        ? 'ct-row-stat'
                        : '';
            const tds = cols.map((c, i) =>
                `<td class="${i === 0 ? 'ct-col-sticky' : ''}" title="${escapeHtml(String(row[c] ?? ''))}">${escapeHtml(String(row[c] ?? ''))}</td>`
            ).join('');
            parts.push(`<tr class="${rowClass}">${tds}</tr>`);
        }
        const bodyHtml = parts.join('');

        document.getElementById('ctPreview').innerHTML = `
            ${toolbarHtml}
            <div class="ct-result-scroll">
                <table class="ct-result-table${cellCount > 2000 ? ' ct-result-virtualized' : ''}">
                    <thead>${headerHtml}</thead>
                    <tbody>${bodyHtml}</tbody>
                </table>
            </div>
        `;
    }

    /**
     * Turn a flat columns[] list into a hierarchical multi-row <thead>.
     * Column 0 is the row-label column (kept in its own rowspan=all leftmost cell).
     * Every data column's label is split on " / " to recover the nesting levels.
     * Consecutive columns with the same prefix at level L merge into a colspan.
     *
     * Example input (flat):
     *   ["row", "Male / Metro / Yes", "Male / Metro / No", "Male / Regional / Yes",
     *    "Male / Regional / No", "Female / Metro / Yes", ...]
     *
     * Output (3-row thead):
     *   <tr> <th rowspan=3>row</th> <th colspan=4>Male</th> <th colspan=4>Female</th> </tr>
     *   <tr> <th colspan=2>Metro</th> <th colspan=2>Regional</th> <th colspan=2>Metro</th> ... </tr>
     *   <tr> <th>Yes</th> <th>No</th> <th>Yes</th> <th>No</th> ... </tr>
     */
    function buildHierarchicalHeader(cols) {
        const rowLabel = cols[0];
        const dataCols = cols.slice(1);
        if (dataCols.length === 0) {
            return `<tr><th class="ct-col-sticky">${escapeHtml(rowLabel)}</th></tr>`;
        }

        // Split every column label into its segments; find the deepest nesting.
        const segments = dataCols.map(c => String(c).split(' / '));
        const maxDepth = Math.max(...segments.map(s => s.length));
        // Pad shorter labels so every column has maxDepth rows (uses "" for padding
        // so empty slots render as a blank cell — keeps alignment intact when some
        // column groups are shallower than others).
        for (const s of segments) while (s.length < maxDepth) s.push('');

        const rows = [];
        for (let level = 0; level < maxDepth; level++) {
            const parts = [];
            if (level === 0) {
                parts.push(`<th class="ct-col-sticky" rowspan="${maxDepth}">${escapeHtml(rowLabel)}</th>`);
            }
            let i = 0;
            while (i < segments.length) {
                const value = segments[i][level];
                // How far does this value extend at this level? Must ALSO share
                // the parent path so we don't accidentally merge cells that just
                // happen to share a leaf name under different parents.
                let span = 1;
                while (i + span < segments.length
                    && segments[i + span][level] === value
                    && parentPathEquals(segments[i], segments[i + span], level))
                {
                    span++;
                }
                parts.push(
                    `<th colspan="${span}" title="${escapeHtml(value)}">${escapeHtml(value)}</th>`
                );
                i += span;
            }
            rows.push(`<tr>${parts.join('')}</tr>`);
        }
        return rows.join('');
    }

    /** Two column paths share the same prefix up to (but not including) `level`. */
    function parentPathEquals(a, b, level) {
        for (let k = 0; k < level; k++) {
            if (a[k] !== b[k]) return false;
        }
        return true;
    }

    // -----------------------------------------------------------------------
    // CSV export
    // -----------------------------------------------------------------------

    function ctExportCsv() {
        if (!lastResult) return;
        const cols = lastResult.columns;
        const rows = lastResult.rows;
        const escape = (v) => {
            const s = String(v ?? '');
            // RFC 4180 — quote if it contains comma, quote, or newline
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [cols.map(escape).join(',')];
        for (const row of rows) {
            lines.push(cols.map(c => escape(row[c])).join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `custom_table_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.csv`;
        (document.getElementById('customTableModal') || document.body).appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(url);
            a.remove();
        }, 100);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // -----------------------------------------------------------------------
    // Row-group stats picker
    // -----------------------------------------------------------------------

    /**
     * Open the stats picker for a row group. Lets the user toggle extra
     * aggregate stats (mean / median / …) on top of the always-on count + %.
     * Stats are computed across the row-cell-count distribution within each
     * column — the "aggregated values" of the cartesian product — so no
     * target variable is needed.
     */
    function openStatsPopover(anchor) {
        closeCodesPopover();  // reuse popover infra for dismiss cleanup

        const groupId = anchor.dataset.groupId;
        const group = state.rows.find(g => g.id === groupId);
        if (!group) return;
        if (!group.stats) group.stats = [];

        const pop = document.createElement('div');
        pop.className = 'ct-codes-popover';

        const rowsHtml = AGG_STATS.map(stat => {
            const checked = group.stats.includes(stat) ? 'checked' : '';
            return `<label class="ct-codes-row">
                <input type="checkbox" data-stat="${stat}" ${checked}>
                <span class="ct-codes-label">${AGG_LABELS[stat]}</span>
            </label>`;
        }).join('');

        pop.innerHTML = `
            <div class="ct-codes-header">
                <div class="ct-codes-title">Summary stats</div>
                <button class="ct-codes-close" title="Close">&times;</button>
            </div>
            <div class="ct-codes-sub">Count and % are always shown. Extra stats compute across the row-cell counts in each column.</div>
            <div class="ct-codes-list">${rowsHtml}</div>
            <div class="ct-codes-footer">
                <span class="ct-codes-selected"></span>
                <button class="ct-codes-apply">Apply</button>
            </div>
        `;
        (document.getElementById('customTableModal') || document.body).appendChild(pop);
        positionPopover(pop, anchor);

        pop.querySelector('.ct-codes-close').addEventListener('click', closeCodesPopover);
        pop.querySelector('.ct-codes-apply').addEventListener('click', () => {
            const kept = [];
            pop.querySelectorAll('.ct-codes-list input[type="checkbox"]').forEach(cb => {
                if (cb.checked) kept.push(cb.dataset.stat);
            });
            group.stats = kept;
            closeCodesPopover();
            render();
        });

        _openPopoverCleanup = wirePopoverDismiss(pop);
    }

    // -----------------------------------------------------------------------
    // Code include/exclude popover (A8.3)
    // -----------------------------------------------------------------------

    let _openPopoverCleanup = null;

    /**
     * Open the code picker popover anchored to a .ct-group-var chip.
     * Shows checkboxes for every code the backend returned, with quick
     * "All / None / Invert" actions. Changes write back to the var's
     * `includedCodes` array in state (`null` means keep all).
     */
    async function openCodesPopover(anchor) {
        closeCodesPopover();

        const slotKey = anchor.dataset.slot;
        const groupId = anchor.dataset.groupId;
        const varName = anchor.dataset.variableName;
        const group = state[slotKey]?.find(g => g.id === groupId);
        if (!group) return;
        const varEntry = group.vars.find(v => v.name === varName);
        if (!varEntry) return;

        // Ensure the backend codes are loaded before we render checkboxes.
        // Show a lightweight loading popover while we wait.
        const loading = document.createElement('div');
        loading.className = 'ct-codes-popover';
        loading.innerHTML = `<div class="ct-codes-loading">Loading codes…</div>`;
        (document.getElementById('customTableModal') || document.body).appendChild(loading);
        positionPopover(loading, anchor);

        await fetchVariableCodes(varName);
        loading.remove();

        const codes = codesCache.get(varName.toUpperCase()) || [];
        if (!codes.length) {
            // Nothing to filter on — fall back to a hint popover.
            const hint = document.createElement('div');
            hint.className = 'ct-codes-popover';
            hint.innerHTML = `<div class="ct-codes-empty">This variable has no labeled codes — nothing to include or exclude.</div>`;
            (document.getElementById('customTableModal') || document.body).appendChild(hint);
            positionPopover(hint, anchor);
            _openPopoverCleanup = wirePopoverDismiss(hint);
            return;
        }

        const pop = document.createElement('div');
        pop.className = 'ct-codes-popover';

        // `null` = all included (default). Convert to explicit list when user
        // first unchecks something; keep it `null` while everything is checked
        // so the state stays minimal.
        const isAllIncluded = !Array.isArray(varEntry.includedCodes);
        const checkedSet = new Set(
            isAllIncluded
                ? codes.map(c => String(c.code))
                : varEntry.includedCodes.map(String)
        );

        const rowsHtml = codes.map(c => {
            const checked = checkedSet.has(String(c.code)) ? 'checked' : '';
            return `<label class="ct-codes-row">
                <input type="checkbox" data-code="${escapeHtml(String(c.code))}" ${checked}>
                <span class="ct-codes-label">${escapeHtml(c.label || `${varName}=${c.code}`)}</span>
                <span class="ct-codes-count">${(c.count || 0).toLocaleString()}</span>
            </label>`;
        }).join('');

        pop.innerHTML = `
            <div class="ct-codes-header">
                <div class="ct-codes-title">${escapeHtml(varName)} codes</div>
                <button class="ct-codes-close" title="Close">&times;</button>
            </div>
            <div class="ct-codes-actions">
                <button class="ct-codes-action" data-action="all">Select all</button>
                <button class="ct-codes-action" data-action="none">Select none</button>
                <button class="ct-codes-action" data-action="invert">Invert</button>
            </div>
            <div class="ct-codes-list">${rowsHtml}</div>
            <div class="ct-codes-footer">
                <span class="ct-codes-selected"></span>
                <button class="ct-codes-apply">Apply</button>
            </div>
        `;
        (document.getElementById('customTableModal') || document.body).appendChild(pop);
        positionPopover(pop, anchor);

        const updateSelectedHint = () => {
            const checked = pop.querySelectorAll('.ct-codes-list input[type="checkbox"]:checked').length;
            pop.querySelector('.ct-codes-selected').textContent =
                `${checked} of ${codes.length} codes kept`;
        };
        updateSelectedHint();

        pop.querySelectorAll('.ct-codes-action').forEach(btn => {
            btn.addEventListener('click', () => {
                const a = btn.dataset.action;
                pop.querySelectorAll('.ct-codes-list input[type="checkbox"]').forEach(cb => {
                    if (a === 'all') cb.checked = true;
                    else if (a === 'none') cb.checked = false;
                    else if (a === 'invert') cb.checked = !cb.checked;
                });
                updateSelectedHint();
            });
        });

        pop.querySelectorAll('.ct-codes-list input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', updateSelectedHint);
        });

        pop.querySelector('.ct-codes-close').addEventListener('click', closeCodesPopover);

        pop.querySelector('.ct-codes-apply').addEventListener('click', () => {
            const kept = [];
            pop.querySelectorAll('.ct-codes-list input[type="checkbox"]').forEach(cb => {
                if (cb.checked) kept.push(cb.dataset.code);
            });
            if (kept.length === codes.length) {
                // All selected — drop back to the null "include all" default
                // so the state stays clean and new codes auto-include.
                varEntry.includedCodes = null;
            } else {
                varEntry.includedCodes = kept;
            }
            closeCodesPopover();
            render();
        });

        _openPopoverCleanup = wirePopoverDismiss(pop);
    }

    function wirePopoverDismiss(pop) {
        const outsideClick = (e) => {
            if (!pop.contains(e.target)) closeCodesPopover();
        };
        const onKey = (e) => { if (e.key === 'Escape') closeCodesPopover(); };
        setTimeout(() => {
            document.addEventListener('click', outsideClick);
            document.addEventListener('keydown', onKey);
        }, 0);
        return () => {
            document.removeEventListener('click', outsideClick);
            document.removeEventListener('keydown', onKey);
        };
    }

    function closeCodesPopover() {
        document.querySelectorAll('.ct-codes-popover').forEach(el => el.remove());
        if (_openPopoverCleanup) { _openPopoverCleanup(); _openPopoverCleanup = null; }
    }

    /** Position a popover anchored under its trigger chip, clamped to viewport. */
    function positionPopover(pop, anchor) {
        const r = anchor.getBoundingClientRect();
        // Estimate size (actual size is known after append).
        const popRect = pop.getBoundingClientRect();
        const popW = popRect.width || 280;
        const popH = popRect.height || 320;
        let left = r.left;
        let top = r.bottom + 6;
        if (left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;
        if (left < 10) left = 10;
        if (top + popH > window.innerHeight - 10) top = r.top - popH - 6;
        if (top < 10) top = 10;
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
    }

    // -----------------------------------------------------------------------
    // Collapse toggles (palette + slot panes)
    // -----------------------------------------------------------------------

    function ctTogglePalette() {
        document.querySelector('#customTableModal .ct-workbench')
            ?.classList.toggle('ct-palette-collapsed');
    }

    function ctToggleSlot(slotKey) {
        const slot = document.querySelector(`#customTableModal .ct-slot[data-slot="${slotKey}"]`);
        slot?.classList.toggle('collapsed');
    }

    /** Collapse / expand the whole Layout panel (Columns + Rows + Filter together). */
    function ctToggleLayout() {
        document.getElementById('ctLayoutPanel')?.classList.toggle('collapsed');
    }

    // Expose
    window.openCustomTableModal = openCustomTableModal;
    window.closeCustomTableModal = closeCustomTableModal;
    window.toggleAnalyzeDropdown = toggleAnalyzeDropdown;
    window.closeAnalyzeDropdown = closeAnalyzeDropdown;
    window.ctExportCsv = ctExportCsv;
    window.ctReset = ctReset;
    window.ctRun = ctRun;
    window.ctTogglePalette = ctTogglePalette;
    window.ctToggleSlot = ctToggleSlot;
    window.ctToggleLayout = ctToggleLayout;
    window._ctDebugState = () => JSON.parse(JSON.stringify(state));
})();
