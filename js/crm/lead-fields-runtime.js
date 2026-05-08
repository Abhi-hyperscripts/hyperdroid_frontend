/**
 * Renders tenant-defined custom dropdowns on the leads page.
 *
 *   • Loads /api/lead-fields once on page load (active fields + options).
 *   • Builds a SearchableDropdown per show_in_lead_filter field, parked in
 *     the #leadFieldsFilterGroup placeholder in leads.html.
 *   • Adds a `<th>` per show_in_leads_table field to the leads thead, and
 *     after every `renderLeadsTable` run injects the matching `<td>` per
 *     row with a colored badge.
 *   • Exposes the current filter selections as a {code: [optionCode]} dict
 *     that buildFilterParams in leads.js merges into the customFields query
 *     param. Backend filters via the existing JSONB `?` / `->>` operators.
 *
 * Field code is permanent so the JSONB key on every lead stays valid even
 * if the admin renames the label or rewires colors. Soft-deleted fields
 * still resolve to their last known label so historical badges don't go
 * blank — we read the full list (including is_active=false) just for that.
 */
(function () {
    'use strict';

    let _fields = [];                    // active filter / table fields
    let _allFieldsByCode = new Map();    // include archived, for label fallback
    let _filterValues = {};              // { fieldCode: [optionCode, ...] }
    const _dropdowns = new Map();        // fieldCode → SearchableDropdown instance
    let _renderObserver = null;          // MutationObserver for leadsTableBody

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        try {
            // Pull the *full* list (active + archived) so badges keep
            // resolving labels even after a field is hidden.
            const fullResp = await api.request('/lead-fields?includeInactive=true').catch(() => null);
            const allFields = (fullResp && fullResp.fields) ? fullResp.fields : [];
            _allFieldsByCode = new Map(allFields.map(f => [f.code, f]));
            _fields = allFields.filter(f => f.is_active);
        } catch (err) {
            console.warn('[lead-fields] init failed:', err);
            _fields = [];
            return;
        }
        if (_fields.length === 0) return;
        renderFilterBar();
        addTableHeaders();
        // After each render of the leads table, inject the per-row cells.
        // The leads.js code rewrites tbody.innerHTML so a MutationObserver is
        // simpler than monkey-patching renderLeadsTable.
        const tbody = document.getElementById('leadsTableBody');
        if (tbody) {
            _renderObserver = new MutationObserver(() => injectTableCells());
            _renderObserver.observe(tbody, { childList: true });
        }
        wrapActivityModal();
    }

    // ─── Filter bar ──────────────────────────────────────────────────────────

    function renderFilterBar() {
        const group = document.getElementById('leadFieldsFilterGroup');
        if (!group) return;
        const filterFields = _fields.filter(f => f.show_in_lead_filter && (f.options || []).length > 0);
        if (filterFields.length === 0) return;

        group.innerHTML = filterFields.map(f => `
            <div class="crm-filter-group" data-lead-field-code="${escapeAttr(f.code)}">
                <label>${escapeHtml(f.label)}</label>
                <div id="ldFilter_${escapeAttr(f.code)}" data-field="${escapeAttr(f.code)}"></div>
            </div>
        `).join('');

        // SearchableDropdown is the project standard (memory: never native select).
        for (const f of filterFields) {
            const container = document.getElementById(`ldFilter_${f.code}`);
            if (!container || typeof SearchableDropdown === 'undefined') continue;
            const dd = new SearchableDropdown(container, {
                placeholder: `All ${f.label.toLowerCase()}`,
                searchPlaceholder: 'Search…',
                options: [
                    { value: '', label: `All ${f.label.toLowerCase()}` },
                    ...f.options
                        .filter(o => o.is_active)
                        .map(o => ({
                            value: o.code,
                            label: o.label,
                            description: o.color ? '' : '',
                            // Color rendered as a leading swatch in the option row.
                            // SearchableDropdown supports custom html via `html` field.
                            html: optionHtml(o),
                        })),
                ],
                onChange: (val) => onFilterChange(f.code, val),
            });
            _dropdowns.set(f.code, dd);
        }
    }

    function optionHtml(o) {
        const swatch = o.color
            ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeAttr(o.color)};margin-right:8px;vertical-align:middle;"></span>`
            : '';
        return `${swatch}${escapeHtml(o.label)}`;
    }

    function onFilterChange(code, value) {
        if (!value) delete _filterValues[code];
        else _filterValues[code] = [value];
        // leads.js reads window.getLeadFieldsFilter() inside buildFilterParams
        // — see the patch in that file.
        if (typeof window.applyFilters === 'function') window.applyFilters();
    }

    // Exposed so buildFilterParams in leads.js can fold these into customFields.
    window.getLeadFieldsFilter = function () {
        return Object.keys(_filterValues).length > 0 ? { ..._filterValues } : null;
    };

    // ─── Table column headers ────────────────────────────────────────────────

    function addTableHeaders() {
        const thead = document.querySelector('.crm-leads-table thead tr')
                   || document.querySelector('table.crm-table thead tr')
                   || document.querySelector('table thead tr');
        if (!thead) return;
        // Insert before the last <th> (the actions column).
        const lastTh = thead.lastElementChild;
        for (const f of _fields.filter(x => x.show_in_leads_table)) {
            const th = document.createElement('th');
            th.dataset.col = `lf_${f.code}`;
            th.dataset.leadFieldHeader = f.code;
            th.className = 'hide-mobile';
            th.textContent = f.label;
            thead.insertBefore(th, lastTh);
        }
    }

    // ─── Per-row badges ──────────────────────────────────────────────────────

    function injectTableCells() {
        const rows = document.querySelectorAll('#leadsTableBody tr[data-lead-id]');
        if (rows.length === 0) return;

        rows.forEach(row => {
            // Already injected? (MutationObserver fires after every full
            // tbody innerHTML overwrite, so freshly-rendered rows have none.)
            if (row.querySelector('[data-lead-field-cell]')) return;

            const leadId = row.getAttribute('data-lead-id');
            const customFields = readLeadCustomFields(leadId);
            const lastTd = row.lastElementChild;
            for (const f of _fields.filter(x => x.show_in_leads_table)) {
                const td = document.createElement('td');
                td.setAttribute('data-lead-field-cell', f.code);
                td.dataset.col = `lf_${f.code}`;
                td.className = 'hide-mobile';
                td.innerHTML = renderBadge(f, customFields[f.code]);
                row.insertBefore(td, lastTd);
            }
        });
    }

    function readLeadCustomFields(leadId) {
        // leads.js keeps the array in `allLeads` (page-scope global).
        // Fall back to empty if a future refactor renames it.
        const list = (typeof allLeads !== 'undefined' && Array.isArray(allLeads)) ? allLeads : [];
        const lead = list.find(l => l.id === leadId);
        if (!lead) return {};
        return parseCustomFields(lead.custom_fields);
    }

    function parseCustomFields(raw) {
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw) || {}; } catch { return {}; }
    }

    function renderBadge(field, value) {
        if (value == null || value === '') return '<span class="crm-cell-secondary">—</span>';
        // Multi-select renders as a row of pills (v1 only single-select; this
        // is here for forward-compat once we flip the flag).
        if (Array.isArray(value)) return value.map(v => onePill(field, v)).join(' ');
        return onePill(field, String(value));
    }

    function onePill(field, code) {
        const opt = (field.options || []).find(o => o.code === code);
        const label = opt ? opt.label : code;          // stale value falls back to code
        const color = opt && opt.color ? opt.color : null;
        const style = color
            ? `background: color-mix(in srgb, ${escapeAttr(color)} 18%, transparent); color: ${escapeAttr(color)}; border:1px solid color-mix(in srgb, ${escapeAttr(color)} 35%, transparent);`
            : `background: var(--bg-tertiary); color: var(--text-primary); border:1px solid var(--border-color);`;
        return `<span class="lf-badge" style="${style}; padding:3px 9px; border-radius:999px; font-size:0.78rem; font-weight:500; white-space:nowrap;">${escapeHtml(label)}</span>`;
    }

    // ─── Activity log modal integration ─────────────────────────────────────

    // Wraps the global openLogActivityModal / submitLogActivity hooks so the
    // leads.html / lead-journey.js code stays unchanged. Uses a per-lead
    // pending state because the user may cancel after picking values, in
    // which case nothing should be PATCHed.
    let _activityDropdowns = new Map();        // fieldCode → SearchableDropdown
    let _activityLeadId = null;

    function wrapActivityModal() {
        const activityFields = _fields.filter(f => f.show_in_activity_log && (f.options || []).length > 0);
        if (activityFields.length === 0) return;

        const origOpen = window.openLogActivityModal;
        const origSubmit = window.submitLogActivity;
        if (typeof origOpen !== 'function' || typeof origSubmit !== 'function') return;

        window.openLogActivityModal = function (leadId) {
            origOpen(leadId);
            _activityLeadId = leadId;
            renderActivityFields(leadId, activityFields);
        };

        window.submitLogActivity = async function () {
            // Collect picks BEFORE the original function (which closes the
            // modal and might null out leadId). We attempt the PATCH after
            // the original succeeds; failures are non-fatal — the activity
            // is already logged, the dropdown values just won't update.
            const picks = collectActivityPicks(activityFields);
            const leadId = _activityLeadId;
            await origSubmit();
            if (!leadId || Object.keys(picks).length === 0) return;
            await persistCustomFields(leadId, picks);
        };
    }

    function renderActivityFields(leadId, fields) {
        const wrap = document.getElementById('activityLeadFields');
        if (!wrap) return;
        const lead = readLead(leadId);
        const current = parseCustomFields(lead?.custom_fields);

        wrap.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${
            fields.map(f => `
                <div>
                    <label class="form-label">${escapeHtml(f.label)}</label>
                    <div id="actLF_${escapeAttr(f.code)}"></div>
                </div>
            `).join('')
        }</div>`;

        _activityDropdowns.clear();
        for (const f of fields) {
            const container = document.getElementById(`actLF_${f.code}`);
            if (!container || typeof SearchableDropdown === 'undefined') continue;
            const dd = new SearchableDropdown(container, {
                placeholder: 'No change',
                searchPlaceholder: 'Search…',
                options: [
                    { value: '', label: 'No change' },
                    ...f.options
                        .filter(o => o.is_active)
                        .map(o => ({ value: o.code, label: o.label, html: optionHtml(o) })),
                ],
            });
            const cur = current[f.code];
            if (cur != null && cur !== '') dd.setValue(String(cur));
            _activityDropdowns.set(f.code, dd);
        }
    }

    function collectActivityPicks(fields) {
        const out = {};
        for (const f of fields) {
            const dd = _activityDropdowns.get(f.code);
            if (!dd) continue;
            const v = dd.getValue();
            // Empty string → user left "No change"; skip so we don't clobber.
            if (v && v !== '') out[f.code] = v;
        }
        return out;
    }

    async function persistCustomFields(leadId, picks) {
        try {
            const lead = readLead(leadId);
            const existing = parseCustomFields(lead?.custom_fields);
            const merged = { ...existing, ...picks };
            await api.request(`/crm/leads/${leadId}`, {
                method: 'PUT',
                body: JSON.stringify({ customFields: JSON.stringify(merged) }),
            });
            // Reflect locally so the badge in the leads table updates without
            // a full refresh — leads.js rerenders on the next loadLeads tick
            // anyway, but we want the immediate cell update too.
            if (lead) lead.custom_fields = merged;
            injectTableCells();
        } catch (err) {
            console.warn('[lead-fields] persist after activity failed:', err);
            // Don't toast — the activity itself succeeded. A follow-up on the
            // table would surface stale values; loadLeads at the end of
            // submitLogActivity normally repopulates from server-of-truth.
        }
    }

    function readLead(leadId) {
        const list = (typeof allLeads !== 'undefined' && Array.isArray(allLeads)) ? allLeads : [];
        return list.find(l => l.id === leadId) || null;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }
    function escapeAttr(s) {
        return String(s ?? '').replace(/"/g, '&quot;');
    }
})();
