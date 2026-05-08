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
    let _activityChips = {};   // { fieldCode: optionCode } — pending changes in the modal
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
        if (popoverOpen()) { closeAddFilterPopover(); return; }
        _addFilterPopover = null;     // clear stale ref
        const btn = document.getElementById('lfAddFilterBtn');
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
        document.body.appendChild(pop);
        _addFilterPopover = pop;
        positionPopoverFixed(pop, btn);
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

    // True only when there's an open popover currently in the DOM. Used by
    // the toggle paths so a stale reference (e.g. modal closed externally
    // while popover was open) doesn't block reopening on the next click.
    function popoverOpen() {
        return _addFilterPopover && document.body.contains(_addFilterPopover);
    }

    // Position a position:fixed popover relative to a trigger element,
    // clamping to the viewport so the popover never spills off-screen.
    // Default placement is below + left-aligned with the trigger; flips
    // to right-aligned when that would overflow right, and to above the
    // trigger when there's not enough room below.
    function positionPopoverFixed(pop, trigger) {
        if (!pop || !trigger) return;
        // Defer one frame so the browser has measured the popover content.
        requestAnimationFrame(() => {
            const t = trigger.getBoundingClientRect();
            const margin = 12;
            const gap = 6;
            const popW = Math.min(pop.offsetWidth || 280, window.innerWidth - margin * 2);
            const popH = Math.min(pop.offsetHeight || 320, window.innerHeight - margin * 2);

            // Horizontal: prefer left-aligning to trigger; flip to
            // right-aligning when overflow.
            let left = t.left;
            if (left + popW > window.innerWidth - margin) {
                left = Math.max(margin, t.right - popW);
            }
            left = Math.max(margin, Math.min(left, window.innerWidth - margin - popW));

            // Vertical: anchor below the trigger and let the popover scroll
            // internally. Hopping the popover way up to the top of the
            // viewport (when there's "more room above") visually disconnects
            // it from the trigger — users expect it next to where they
            // clicked, even if that means a shorter list with internal
            // scroll. Floor the height so 1-2 options always fit.
            const spaceBelow = window.innerHeight - t.bottom - margin - gap;
            const top = t.bottom + gap;
            const fitHeight = Math.max(180, Math.min(popH, spaceBelow));
            pop.style.maxHeight = `${fitHeight}px`;

            pop.style.left = `${left}px`;
            pop.style.top = `${top}px`;
        });
    }

    // Repositions all open popovers on resize/scroll so they stay glued
    // to their triggers. Listeners are wired once at init.
    let _scrollResizeHookInstalled = false;
    function installPopoverFollowHooks() {
        if (_scrollResizeHookInstalled) return;
        _scrollResizeHookInstalled = true;
        const reposition = () => {
            document.querySelectorAll('.lf-popover[data-trigger-id]').forEach(pop => {
                const trig = document.querySelector(`[data-popover-trigger-id="${pop.dataset.triggerId}"]`);
                if (trig) positionPopoverFixed(pop, trig);
            });
        };
        window.addEventListener('resize', reposition, { passive: true });
        window.addEventListener('scroll', reposition, { passive: true, capture: true });
    }

    // After picking a field from the +Add popover, anchor the value popover
    // to the +Add button (chip doesn't exist yet for this code).
    function openValuePopoverForCodeAtBtn(code) {
        const btn = document.getElementById('lfAddFilterBtn');
        if (!btn) return;
        openValuePopover(code, btn);
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
        document.body.appendChild(pop);
        _addFilterPopover = pop;   // reuse same singleton handle for outside-click closing
        positionPopoverFixed(pop, anchor);
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
        // Clicking any of these triggers re-toggles the popover; the trigger's
        // own handler decides what happens. Don't double-close from here.
        const triggerSelectors = [
            '#lfAddFilterBtn', '[data-chip-edit]',
            '#lfActivityAddBtn', '[data-act-chip-edit]',
        ];
        if (triggerSelectors.some(sel => e.target.closest(sel))) return;
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
            renderActivityChips(leadId, currentActivityFields());
        };

        window.submitLogActivity = async function () {
            const fields = currentActivityFields();
            const lead = readLead(_activityLeadId);
            const original = parseCustomFields(lead?.custom_fields);
            // Diff: only PATCH fields whose value changed (or was added/removed)
            // in this modal session. Activity-log doesn't currently support
            // un-setting a field — clearing a chip just won't write that key.
            const changed = {};
            for (const f of fields) {
                const wasSet = original[f.code];
                const nowSet = _activityChips[f.code];
                if (nowSet && nowSet !== wasSet) changed[f.code] = nowSet;
            }
            const leadId = _activityLeadId;
            await origSubmit();
            if (!leadId || Object.keys(changed).length === 0) return;
            await persistCustomFields(leadId, changed);
        };
    }

    function renderActivityChips(leadId, fields) {
        const wrap = document.getElementById('activityLeadFields');
        if (!wrap) return;
        if (fields.length === 0) { wrap.innerHTML = ''; return; }

        // Seed pending chips from the lead's existing values so the rep
        // sees what's already set without scrolling. New chips can be
        // added; existing values can be changed; on submit only diffs are
        // PATCHed.
        const lead = readLead(leadId);
        const current = parseCustomFields(lead?.custom_fields);
        _activityChips = {};
        for (const f of fields) {
            if (current[f.code]) _activityChips[f.code] = current[f.code];
        }

        wrap.innerHTML = `
            <div class="lf-activity-section-row">
                <div class="lf-activity-section-label">Custom fields</div>
                <div class="lf-activity-chips" id="lfActivityChips"></div>
                <div class="lf-add-wrap" style="position:relative;">
                    <button type="button" class="lf-add-btn" id="lfActivityAddBtn"
                            aria-label="Add custom field value" aria-haspopup="dialog">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        <span>Add field</span>
                    </button>
                </div>
            </div>
        `;
        document.getElementById('lfActivityAddBtn').addEventListener('click', e => {
            e.stopPropagation();
            toggleActivityAddPopover(fields);
        });
        renderActivityChipPills(fields);
    }

    function renderActivityChipPills(fields) {
        const wrap = document.getElementById('lfActivityChips');
        if (!wrap) return;
        const codes = Object.keys(_activityChips);
        if (codes.length === 0) {
            wrap.innerHTML = '';
            return;
        }
        wrap.innerHTML = codes.map(code => {
            const f = _allFieldsByCode.get(code);
            if (!f) return '';
            const v = _activityChips[code];
            const opt = (f.options || []).find(o => o.code === v);
            const swatch = opt && opt.color
                ? `<span class="lf-chip-swatch" style="background:${escapeAttr(opt.color)};"></span>`
                : '';
            return `
                <span class="lf-chip" data-act-chip-code="${escapeAttr(code)}">
                    <span class="lf-chip-body" data-act-chip-edit="${escapeAttr(code)}" tabindex="0" role="button">
                        ${swatch}<span class="lf-chip-label">${escapeHtml(f.label)}:</span>
                        <span class="lf-chip-value">${escapeHtml(opt ? opt.label : v)}</span>
                    </span>
                    <button type="button" class="lf-chip-x" data-act-chip-remove="${escapeAttr(code)}" aria-label="Remove field">×</button>
                </span>
            `;
        }).join('');

        wrap.querySelectorAll('[data-act-chip-remove]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                delete _activityChips[el.getAttribute('data-act-chip-remove')];
                renderActivityChipPills(fields);
            });
        });
        wrap.querySelectorAll('[data-act-chip-edit]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                openActivityValuePopover(el.getAttribute('data-act-chip-edit'), el.closest('.lf-chip'), fields);
            });
        });
    }

    function toggleActivityAddPopover(fields) {
        if (popoverOpen()) { closeAddFilterPopover(); return; }
        _addFilterPopover = null;     // clear stale ref
        const btn = document.getElementById('lfActivityAddBtn');
        const used = new Set(Object.keys(_activityChips));
        const available = fields.filter(f => !used.has(f.code));
        if (available.length === 0) {
            Toast?.info?.('All custom fields are already set');
            return;
        }
        const pop = document.createElement('div');
        pop.className = 'lf-popover lf-add-popover';
        pop.innerHTML = `
            <div class="lf-popover-header">
                <input type="text" class="lf-popover-search form-control form-control-sm" placeholder="Search fields…" aria-label="Search">
            </div>
            <div class="lf-popover-list">
                ${available.map(f => `
                    <button type="button" class="lf-popover-item" data-act-add-code="${escapeAttr(f.code)}">
                        <span class="lf-popover-item-label">${escapeHtml(f.label)}</span>
                        <span class="lf-popover-item-meta">${(f.options || []).filter(o => o.is_active).length} options</span>
                    </button>
                `).join('')}
            </div>
        `;
        document.body.appendChild(pop);
        _addFilterPopover = pop;
        positionPopoverFixed(pop, btn);
        const search = pop.querySelector('.lf-popover-search');
        search.focus();
        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            pop.querySelectorAll('.lf-popover-item').forEach(it => {
                const label = it.querySelector('.lf-popover-item-label').textContent.toLowerCase();
                it.style.display = label.includes(q) ? '' : 'none';
            });
        });
        pop.querySelectorAll('[data-act-add-code]').forEach(it => {
            it.addEventListener('click', e => {
                e.stopPropagation();
                const code = it.getAttribute('data-act-add-code');
                closeAddFilterPopover();
                // Seed an "empty" chip so its body element exists, then open
                // its value popover. This avoids a second popover-from-button
                // anchored to the +Add button when chips and button are on
                // separate rows after wrap.
                _activityChips[code] = '';
                renderActivityChipPills(fields);
                const newChip = document.querySelector(`[data-act-chip-edit="${cssEscape(code)}"]`);
                if (newChip) openActivityValuePopover(code, newChip.closest('.lf-chip'), fields);
            });
        });
    }

    function openActivityValuePopover(code, anchor, fields) {
        closeAddFilterPopover();
        document.querySelectorAll('.lf-value-popover').forEach(p => p.remove());
        const f = _allFieldsByCode.get(code);
        if (!f) return;
        const current = _activityChips[code] || '';
        const opts = (f.options || []).filter(o => o.is_active);

        const pop = document.createElement('div');
        pop.className = 'lf-popover lf-value-popover';
        pop.innerHTML = `
            <div class="lf-popover-header">
                <div style="font-size:0.78rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(f.label)}</div>
                <input type="text" class="lf-popover-search form-control form-control-sm" placeholder="Search options…" aria-label="Search">
            </div>
            <div class="lf-popover-list">
                ${opts.map(o => `
                    <button type="button" class="lf-popover-item ${o.code === current ? 'is-selected' : ''}" data-act-pick-code="${escapeAttr(o.code)}">
                        ${o.color ? `<span class="lf-chip-swatch" style="background:${escapeAttr(o.color)};"></span>` : ''}
                        <span class="lf-popover-item-label">${escapeHtml(o.label)}</span>
                    </button>
                `).join('')}
            </div>
        `;
        document.body.appendChild(pop);
        _addFilterPopover = pop;
        positionPopoverFixed(pop, anchor);
        pop.querySelector('.lf-popover-search').focus();
        pop.querySelector('.lf-popover-search').addEventListener('input', e => {
            const q = e.target.value.trim().toLowerCase();
            pop.querySelectorAll('[data-act-pick-code]').forEach(it => {
                const label = it.querySelector('.lf-popover-item-label').textContent.toLowerCase();
                it.style.display = label.includes(q) ? '' : 'none';
            });
        });
        pop.querySelectorAll('[data-act-pick-code]').forEach(it => {
            it.addEventListener('click', e => {
                e.stopPropagation();
                _activityChips[code] = it.getAttribute('data-act-pick-code');
                closeAddFilterPopover();
                renderActivityChipPills(fields);
            });
        });
    }

    // Lightweight CSS escape for selector usage on user-supplied codes
    // (lowercase a-z 0-9 _ already enforced server-side, so this is belt+
    // suspenders rather than a full implementation).
    function cssEscape(s) {
        if (window.CSS && CSS.escape) return CSS.escape(s);
        return String(s).replace(/[^\w-]/g, c => '\\' + c);
    }

    function optionHtml(o) {
        const swatch = o.color
            ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeAttr(o.color)};margin-right:8px;vertical-align:middle;"></span>`
            : '';
        return `${swatch}${escapeHtml(o.label)}`;
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
