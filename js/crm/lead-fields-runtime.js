/**
 * Renders tenant-defined custom dropdowns on the leads page using a
 * chip-based filter pattern that scales to dozens of fields without
 * eating vertical space:
 *
 *   • Default state — just an "+ Add filter" button. The 16-dropdown wall
 *     of UI is gone.
 *   • Active state — each picked filter shows as a removable chip with
 *     `Field: Value ×`. Clicking the chip reopens the value picker.
 *   • Add picker — a popover with a searchable list of all available
 *     custom dropdown fields. Picking one immediately surfaces the
 *     value picker for that field.
 *
 * Activity log modal:
 *   • Custom fields collapse into a `<details>` "Custom fields" section,
 *     auto-expanded when the lead already has any custom values set.
 *
 * Leads table:
 *   • show_in_leads_table fields render as colored badge columns,
 *     toggleable via the existing columns picker.
 *
 * All UI tested at narrow viewports (≤480px); chips wrap, popover sizes
 * to viewport, and the modal stays scrollable.
 */
(function () {
    'use strict';

    let _fields = [];                      // active filter / table fields (latest fetch)
    let _allFieldsByCode = new Map();      // includes archived — for label fallback
    let _filterValues = {};                // { fieldCode: optionCode }
    let _renderObserver = null;
    let _activityLeadId = null;
    let _activityDropdowns = new Map();
    let _addFilterPopover = null;          // the +Add filter popup, if open
    let _editChipFieldCode = null;         // chip currently in edit mode

    document.addEventListener('DOMContentLoaded', init);

    async function loadFields() {
        try {
            const fullResp = await api.request('/lead-fields?includeInactive=true').catch(() => null);
            const allFields = (fullResp && fullResp.fields) ? fullResp.fields : [];
            _allFieldsByCode = new Map(allFields.map(f => [f.code, f]));
            _fields = allFields.filter(f => f.is_active);
            return true;
        } catch (err) {
            console.warn('[lead-fields] load failed:', err);
            _fields = [];
            return false;
        }
    }

    async function init() {
        if (!await loadFields()) return;
        if (_fields.length === 0) return;
        renderFilterBar();
        addTableHeaders();
        const tbody = document.getElementById('leadsTableBody');
        if (tbody) {
            _renderObserver = new MutationObserver(() => injectTableCells());
            _renderObserver.observe(tbody, { childList: true });
        }
        wrapActivityModal();
        // Close any open popover on outside click / esc.
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAddFilterPopover(); });
    }

    // ─── Filter bar (chip pattern) ──────────────────────────────────────────

    function renderFilterBar() {
        const bar = document.getElementById('leadFieldsFilterBar');
        if (!bar) return;
        const filterFields = _fields.filter(f => f.show_in_lead_filter && (f.options || []).length > 0);
        if (filterFields.length === 0) { bar.style.display = 'none'; return; }

        bar.innerHTML = `
            <div class="crm-filter-bar-label">Custom filters</div>
            <div class="lf-chips" id="lfChipsRow">
                <div id="lfActiveChips" class="lf-chips-active"></div>
                <div class="lf-add-wrap" style="position:relative;">
                    <button type="button" class="lf-add-btn" id="lfAddFilterBtn"
                            aria-label="Add custom filter" aria-haspopup="dialog">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        <span>Add filter</span>
                    </button>
                </div>
            </div>
        `;
        bar.style.display = '';
        document.getElementById('lfAddFilterBtn').addEventListener('click', toggleAddFilterPopover);
        renderActiveChips();
    }

    function renderActiveChips() {
        const wrap = document.getElementById('lfActiveChips');
        if (!wrap) return;
        const codes = Object.keys(_filterValues);
        if (codes.length === 0) { wrap.innerHTML = ''; return; }

        wrap.innerHTML = codes.map(code => {
            const f = _allFieldsByCode.get(code);
            if (!f) return '';
            const v = _filterValues[code];
            const opt = (f.options || []).find(o => o.code === v);
            const swatch = opt && opt.color
                ? `<span class="lf-chip-swatch" style="background:${escapeAttr(opt.color)};"></span>`
                : '';
            return `
                <span class="lf-chip" data-chip-code="${escapeAttr(code)}">
                    <span class="lf-chip-body" data-chip-edit="${escapeAttr(code)}" tabindex="0" role="button">
                        ${swatch}<span class="lf-chip-label">${escapeHtml(f.label)}:</span>
                        <span class="lf-chip-value">${escapeHtml(opt ? opt.label : v)}</span>
                    </span>
                    <button type="button" class="lf-chip-x" data-chip-remove="${escapeAttr(code)}" aria-label="Remove filter">×</button>
                </span>
            `;
        }).join('');

        wrap.querySelectorAll('[data-chip-remove]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                const code = el.getAttribute('data-chip-remove');
                delete _filterValues[code];
                renderActiveChips();
                if (typeof window.applyFilters === 'function') window.applyFilters();
            });
        });
        wrap.querySelectorAll('[data-chip-edit]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                openValuePopoverFor(el.getAttribute('data-chip-edit'), el);
            });
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openValuePopoverFor(el.getAttribute('data-chip-edit'), el);
                }
            });
        });
    }

    function toggleAddFilterPopover() {
        if (_addFilterPopover) { closeAddFilterPopover(); return; }
        const btn = document.getElementById('lfAddFilterBtn');
        const wrap = btn.parentElement;
        const usedCodes = new Set(Object.keys(_filterValues));
        const available = _fields
            .filter(f => f.show_in_lead_filter && (f.options || []).length > 0 && !usedCodes.has(f.code));
        if (available.length === 0) {
            Toast?.info?.('All custom filters are already active');
            return;
        }

        const pop = document.createElement('div');
        pop.className = 'lf-popover lf-add-popover';
        pop.setAttribute('role', 'dialog');
        pop.innerHTML = `
            <div class="lf-popover-header">
                <input type="text" class="lf-popover-search form-control form-control-sm"
                       placeholder="Search filters…" aria-label="Search">
            </div>
            <div class="lf-popover-list" id="lfAddList">
                ${available.map(f => `
                    <button type="button" class="lf-popover-item" data-add-code="${escapeAttr(f.code)}">
                        <span class="lf-popover-item-label">${escapeHtml(f.label)}</span>
                        <span class="lf-popover-item-meta">${(f.options || []).filter(o => o.is_active).length} options</span>
                    </button>
                `).join('')}
            </div>
        `;
        wrap.appendChild(pop);
        _addFilterPopover = pop;
        const search = pop.querySelector('.lf-popover-search');
        search.focus();
        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            pop.querySelectorAll('.lf-popover-item').forEach(it => {
                const label = it.querySelector('.lf-popover-item-label').textContent.toLowerCase();
                it.style.display = label.includes(q) ? '' : 'none';
            });
        });
        pop.querySelectorAll('[data-add-code]').forEach(it => {
            it.addEventListener('click', e => {
                e.stopPropagation();
                const code = it.getAttribute('data-add-code');
                closeAddFilterPopover();
                openValuePopoverForCodeAtBtn(code);
            });
        });
    }

    function closeAddFilterPopover() {
        _addFilterPopover?.remove();
        _addFilterPopover = null;
    }

    // After picking a field from the +Add popover, anchor the value popover
    // to the +Add button (chip doesn't exist yet for this code).
    function openValuePopoverForCodeAtBtn(code) {
        const btn = document.getElementById('lfAddFilterBtn');
        const wrap = btn?.parentElement;
        if (!wrap) return;
        openValuePopover(code, wrap);
    }

    function openValuePopoverFor(code, anchor) {
        // Anchor to the chip's wrapping element so the popover sits below it.
        openValuePopover(code, anchor.closest('.lf-chip') || anchor);
    }

    function openValuePopover(code, anchor) {
        closeAddFilterPopover();
        document.querySelectorAll('.lf-value-popover').forEach(p => p.remove());
        const f = _allFieldsByCode.get(code);
        if (!f) return;
        const current = _filterValues[code] || '';
        const opts = (f.options || []).filter(o => o.is_active);

        // Anchor must be position:relative for absolute popover. Use the
        // shared add-wrap as anchor; chips are siblings inside lf-chips, so
        // we promote the anchor's display via inline style if needed.
        const host = anchor.closest('.lf-add-wrap') || anchor;
        host.style.position ||= 'relative';

        const pop = document.createElement('div');
        pop.className = 'lf-popover lf-value-popover';
        pop.setAttribute('role', 'dialog');
        pop.innerHTML = `
            <div class="lf-popover-header">
                <div style="font-size:0.78rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(f.label)}</div>
                <input type="text" class="lf-popover-search form-control form-control-sm" placeholder="Search options…" aria-label="Search">
            </div>
            <div class="lf-popover-list">
                ${current ? `<button type="button" class="lf-popover-item lf-popover-item-clear" data-pick-clear>Clear filter</button>` : ''}
                ${opts.map(o => `
                    <button type="button" class="lf-popover-item ${o.code === current ? 'is-selected' : ''}" data-pick-code="${escapeAttr(o.code)}">
                        ${o.color ? `<span class="lf-chip-swatch" style="background:${escapeAttr(o.color)};"></span>` : ''}
                        <span class="lf-popover-item-label">${escapeHtml(o.label)}</span>
                    </button>
                `).join('')}
            </div>
        `;
        host.appendChild(pop);
        _addFilterPopover = pop;   // reuse same singleton handle for outside-click closing
        pop.querySelector('.lf-popover-search').focus();
        pop.querySelector('.lf-popover-search').addEventListener('input', e => {
            const q = e.target.value.trim().toLowerCase();
            pop.querySelectorAll('.lf-popover-item').forEach(it => {
                if (it.hasAttribute('data-pick-clear')) return;
                const label = it.querySelector('.lf-popover-item-label').textContent.toLowerCase();
                it.style.display = label.includes(q) ? '' : 'none';
            });
        });
        pop.querySelectorAll('[data-pick-code]').forEach(it => {
            it.addEventListener('click', e => {
                e.stopPropagation();
                _filterValues[code] = it.getAttribute('data-pick-code');
                closeAddFilterPopover();
                renderActiveChips();
                if (typeof window.applyFilters === 'function') window.applyFilters();
            });
        });
        pop.querySelector('[data-pick-clear]')?.addEventListener('click', e => {
            e.stopPropagation();
            delete _filterValues[code];
            closeAddFilterPopover();
            renderActiveChips();
            if (typeof window.applyFilters === 'function') window.applyFilters();
        });
    }

    function onDocClick(e) {
        if (!_addFilterPopover) return;
        if (_addFilterPopover.contains(e.target)) return;
        // Clicking the trigger toggles, so don't double-close.
        if (e.target.closest('#lfAddFilterBtn') || e.target.closest('[data-chip-edit]')) return;
        closeAddFilterPopover();
    }

    // Exposed so buildFilterParams in leads.js can fold these into customFields.
    window.getLeadFieldsFilter = function () {
        const out = {};
        for (const [code, val] of Object.entries(_filterValues)) {
            if (val) out[code] = [val];
        }
        return Object.keys(out).length > 0 ? out : null;
    };

    // Exposed so the columns-picker in leads.js can include tenant-defined
    // table columns alongside the built-in ones.
    window.getLeadFieldColumnDefs = function () {
        return _fields
            .filter(f => f.show_in_leads_table)
            .map(f => ({ id: `lf_${f.code}`, label: f.label }));
    };

    // ─── Table column headers ────────────────────────────────────────────────

    function addTableHeaders() {
        const thead = document.querySelector('.crm-leads-table thead tr')
                   || document.querySelector('table.crm-table thead tr')
                   || document.querySelector('table thead tr');
        if (!thead) return;
        // Remove any previously injected lf-* headers (re-run after settings tweaks).
        thead.querySelectorAll('[data-lead-field-header]').forEach(el => el.remove());
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
        if (Array.isArray(value)) return value.map(v => onePill(field, v)).join(' ');
        return onePill(field, String(value));
    }

    function onePill(field, code) {
        const opt = (field.options || []).find(o => o.code === code);
        const label = opt ? opt.label : code;
        const color = opt && opt.color ? opt.color : null;
        const style = color
            ? `background: color-mix(in srgb, ${escapeAttr(color)} 18%, transparent); color: ${escapeAttr(color)}; border:1px solid color-mix(in srgb, ${escapeAttr(color)} 35%, transparent);`
            : `background: var(--bg-tertiary); color: var(--text-primary); border:1px solid var(--border-color);`;
        return `<span class="lf-badge" style="${style}; padding:3px 9px; border-radius:999px; font-size:0.78rem; font-weight:500; white-space:nowrap;">${escapeHtml(label)}</span>`;
    }

    // ─── Activity log modal integration ─────────────────────────────────────

    function wrapActivityModal() {
        const origOpen = window.openLogActivityModal;
        const origSubmit = window.submitLogActivity;
        if (typeof origOpen !== 'function' || typeof origSubmit !== 'function') return;

        const currentActivityFields = () => _fields.filter(
            f => f.show_in_activity_log && (f.options || []).length > 0);

        window.openLogActivityModal = async function (leadId) {
            origOpen(leadId);
            _activityLeadId = leadId;
            await loadFields();
            renderActivityFields(leadId, currentActivityFields());
        };

        window.submitLogActivity = async function () {
            const picks = collectActivityPicks(currentActivityFields());
            const leadId = _activityLeadId;
            await origSubmit();
            if (!leadId || Object.keys(picks).length === 0) return;
            await persistCustomFields(leadId, picks);
        };
    }

    function renderActivityFields(leadId, fields) {
        const wrap = document.getElementById('activityLeadFields');
        if (!wrap) return;
        if (fields.length === 0) { wrap.innerHTML = ''; return; }

        const lead = readLead(leadId);
        const current = parseCustomFields(lead?.custom_fields);
        const setCount = fields.reduce((n, f) => n + (current[f.code] ? 1 : 0), 0);
        // Auto-expand if the lead already has values set (so the rep can see
        // them at a glance) OR if the tenant has only a handful (≤4) of
        // fields total — at that count, hiding them is more friction than
        // showing them inline.
        const autoOpen = setCount > 0 || fields.length <= 4;

        wrap.innerHTML = `
            <details class="lf-activity-section" ${autoOpen ? 'open' : ''}>
                <summary>
                    <span class="lf-activity-summary-text">Custom fields</span>
                    <span class="lf-activity-summary-meta">${setCount > 0 ? `${setCount} set · ` : ''}${fields.length} available</span>
                </summary>
                <div class="lf-activity-grid">
                    ${fields.map(f => `
                        <div class="lf-activity-row">
                            <label class="form-label">${escapeHtml(f.label)}</label>
                            <div id="actLF_${escapeAttr(f.code)}"></div>
                        </div>
                    `).join('')}
                </div>
            </details>
        `;

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

    function optionHtml(o) {
        const swatch = o.color
            ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeAttr(o.color)};margin-right:8px;vertical-align:middle;"></span>`
            : '';
        return `${swatch}${escapeHtml(o.label)}`;
    }

    function collectActivityPicks(fields) {
        const out = {};
        for (const f of fields) {
            const dd = _activityDropdowns.get(f.code);
            if (!dd) continue;
            const v = dd.getValue();
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
            if (lead) lead.custom_fields = merged;
            injectTableCells();
        } catch (err) {
            console.warn('[lead-fields] persist after activity failed:', err);
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
