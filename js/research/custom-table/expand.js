/**
 * Custom Tables — expansion layer (PR A1)
 *
 * Converts the user's drag-drop state into a `custom_table` input_params JSON.
 * The function is pure: given the same inputs it always returns the same JSON,
 * so it's trivially unit-testable from the browser console without a network
 * round-trip.
 *
 * Nominal / ordinal variables expand into one entry per value label:
 *   Q4 (gender) with {1:"Male", 2:"Female"}
 *   -> [{label:"Male", expression:"Q4 = 1"}, {label:"Female", expression:"Q4 = 2"}]
 *
 * Scale / numeric variables that have no labels become a single "all non-null"
 * entry. Binning + mean/median measures are PR A3.
 *
 * Filter tokens collapse into a single SQL WHERE fragment joined by AND.
 *
 * Empty Rows or Columns falls through to the function's default {label:"Total",
 * expression:"1=1"} so the grid still renders a single row/column.
 */

// Expose as globals so legacy page scripts (no module system on this page) can call it.
(function () {
    'use strict';

    /** Parse the JSONB value_labels into an ordered [code, label] array. */
    function parseValueLabels(variable) {
        const raw = variable?.valueLabelsJson ?? variable?.value_labels_json;
        if (!raw) return [];
        try {
            const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
            // Stable order by numeric code when possible, otherwise by string
            const entries = Object.entries(obj);
            entries.sort(([a], [b]) => {
                const na = Number(a), nb = Number(b);
                if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
                return String(a).localeCompare(String(b));
            });
            return entries;
        } catch {
            return [];
        }
    }

    function isStringType(variable) {
        const t = variable?.variableType || variable?.variable_type;
        return t === 'string';
    }

    /**
     * Build a single row/column entry array for one dropped variable.
     * Returns an array that callers concat — one variable may produce many entries.
     *
     * @param {string} variableName
     * @param {Object} variablesByName    keyed by UPPERCASE variable name
     * @param {Map<string,Array>} [codesCache]  optional Map<varName, [{code,label,count}]>
     *     returned by /api/files/{id}/variables/{name}/codes. When present, we expand
     *     from the real data codes instead of the potentially-stale value_labels_json.
     *     This fixes the "all zeros" crosstab when a .sav file's labels don't match
     *     the actual column contents.
     */
    /**
     * @param {string} variableName
     * @param {Object} variablesByName
     * @param {Map} codesCache
     * @param {Array<string>|null} [includedCodes]  Optional whitelist of code values
     *     (as strings) to keep. `null` / omitted = include all. Used by the
     *     code-include popover so the user can exclude specific categories
     *     without removing the variable itself.
     */
    function expandVariable(variableName, variablesByName, codesCache, includedCodes) {
        const def = variablesByName[variableName];
        if (!def) {
            return [{ label: variableName, expression: `${variableName} IS NOT NULL` }];
        }

        const stringType = isStringType(def);
        const literalFor = (code) => stringType
            ? `'${String(code).replace(/'/g, "''")}'`
            : String(code);

        const includeAll = !includedCodes || includedCodes.length === 0;
        const includeSet = includeAll ? null : new Set(includedCodes.map(String));
        const keep = (code) => includeAll || includeSet.has(String(code));

        // Preferred source: real data codes from the backend lookup.
        const fetched = codesCache?.get?.(variableName.toUpperCase());
        if (Array.isArray(fetched) && fetched.length > 0) {
            return fetched
                // Drop zero-count orphan codes ONLY when the user hasn't
                // explicitly selected a subset. When `includeAll` is false
                // the user picked codes via the popover — respect that
                // choice even if some selected codes have zero rows (they
                // deserve a column that renders as all-zero).
                .filter(e => includeAll ? (e.count || 0) > 0 : keep(e.code))
                .map(e => ({
                    label: e.label ? `${e.code} - ${e.label}` : `${variableName} (code ${e.code})`,
                    expression: `${variableName} = ${literalFor(e.code)}`,
                }));
        }

        // Fallback: the stored value_labels_json (works when labels match data).
        const labels = parseValueLabels(def);
        if (labels.length > 0) {
            return labels
                .filter(([code]) => keep(code))
                .map(([code, label]) => ({
                    label: label ? `${code} - ${label}` : `${variableName} (code ${code})`,
                    expression: `${variableName} = ${literalFor(code)}`,
                }));
        }

        // No labels at all: single bucket covering all non-null rows.
        return [{
            label: def.variableLabel || def.variable_label || variableName,
            expression: `${variableName} IS NOT NULL`,
        }];
    }

    /**
     * Expand a single group into nested entries. A group is { id, vars:[name,...] }.
     * One variable → that variable's entries. Two vars → Cartesian product.
     * N vars → every N-tuple. Labels join with " / ", expressions AND together.
     */
    function expandGroup(group, variablesByName, codesCache) {
        if (!group || !group.vars || group.vars.length === 0) return [];
        const expansions = group.vars.map(v =>
            expandVariable(v.name, variablesByName, codesCache, v.includedCodes)
        );
        let current = expansions[0];
        for (let i = 1; i < expansions.length; i++) {
            const next = [];
            for (const outer of current) {
                for (const inner of expansions[i]) {
                    next.push({
                        label: `${outer.label} / ${inner.label}`,
                        expression: `(${outer.expression}) AND (${inner.expression})`,
                    });
                }
            }
            current = next;
        }
        return current;
    }

    /**
     * Filter groups: within a group, each variable's labels OR together and
     * variables AND across; across groups, everything ANDs together.
     *
     *   Filter groups: [{vars:[Q4]}, {vars:[Q5]}]
     *     -> "(Q4 = 1 OR Q4 = 2) AND (Q5 = 1 OR Q5 = 2 OR Q5 = 3)"
     */
    function buildFilterExpression(filterGroups, variablesByName, codesCache) {
        if (!filterGroups || filterGroups.length === 0) return null;
        const parts = [];
        for (const group of filterGroups) {
            const groupVars = group?.vars || [];
            for (const v of groupVars) {
                const entries = expandVariable(v.name, variablesByName, codesCache, v.includedCodes);
                if (entries.length === 0) continue;
                const or = entries.map(e => `(${e.expression})`).join(' OR ');
                parts.push(`(${or})`);
            }
        }
        if (parts.length === 0) return null;
        return parts.join(' AND ');
    }

    /**
     * Build the columns list from column groups. Each group is a nested
     * Cartesian expansion; groups concatenate side-by-side (mixed nest+stack).
     *
     * Returns `undefined` when empty so the caller can omit the `columns` key
     * and let the backend default to a single Total column.
     */
    function buildNestedColumns(columnGroups, variablesByName, codesCache) {
        if (!columnGroups || columnGroups.length === 0) return undefined;
        const out = [];
        for (const group of columnGroups) {
            const entries = expandGroup(group, variablesByName, codesCache);
            out.push(...entries);
        }
        return out.length > 0 ? out : undefined;
    }

    /**
     * Top-level: produce the exact POST body for /projects/{id}/functions/execute.
     *
     * @param {Object} state              { rows:[], columns:[], filter:[] }
     * @param {Object} variablesByName    key = variable name (upper case), value = variable def
     * @param {string} fileId             target file id
     * @returns {Object} { function_name, input_params }
     */
    function buildCustomTableRequest(state, variablesByName, fileId, codesCache) {
        // Rows can stack multiple groups. Each group is a nested Cartesian
        // expansion; we insert a section-header row between groups so the
        // table reads SPSS-style.
        const rows = [];
        const rowGroups = state.rows || [];
        if (rowGroups.length === 0) {
            rows.push({ label: 'Total', expression: '1=1' });
        } else {
            const showHeaders = rowGroups.length > 1;
            for (const group of rowGroups) {
                const groupLabel = group.vars
                    .map(v => {
                        const d = variablesByName[v.name];
                        return d?.variableLabel || d?.variable_label || v.name;
                    })
                    .join(' × ');
                const expanded = expandGroup(group, variablesByName, codesCache);
                if (showHeaders) {
                    // Section header matches all non-null rows of every var
                    // in the group so the count reflects the group base.
                    const headerExpr = group.vars
                        .map(v => `${v.name} IS NOT NULL`)
                        .join(' AND ') || '1=1';
                    rows.push({ label: `— ${groupLabel} —`, expression: headerExpr });
                    for (const e of expanded) {
                        rows.push({ label: `  ${e.label}`, expression: e.expression });
                    }
                } else {
                    rows.push(...expanded);
                }
            }
        }

        // Columns: each group nests via Cartesian product; groups concatenate.
        // Labels are slash-separated ("Male / North") within a group; groups
        // stack flat beside each other on the same axis.
        const columns = buildNestedColumns(state.columns || [], variablesByName, codesCache);

        const filterExpr = buildFilterExpression(state.filter || [], variablesByName, codesCache);

        const input = {
            file_id: fileId,
            rows,
            measure: { type: 'count' },
            show: 'both',
        };
        if (columns) input.columns = columns;
        if (filterExpr) input.filter = { expression: filterExpr };

        return {
            function_name: 'custom_table',
            input_params: input,
        };
    }

    // Expose
    window.CustomTable = window.CustomTable || {};
    window.CustomTable.expandVariable = expandVariable;
    window.CustomTable.expandGroup = expandGroup;
    window.CustomTable.buildFilterExpression = buildFilterExpression;
    window.CustomTable.buildNestedColumns = buildNestedColumns;
    window.CustomTable.buildCustomTableRequest = buildCustomTableRequest;
    window.CustomTable.parseValueLabels = parseValueLabels;
})();
