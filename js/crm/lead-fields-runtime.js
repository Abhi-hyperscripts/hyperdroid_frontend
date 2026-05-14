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

    // Built-in pseudo-fields surfaced in the leads filter bar's "+Add filter"
    // popover alongside tenant-defined custom dropdowns. Codes start with `__`
    // so they never collide with user-defined codes (server validator rejects
    // `__` prefixes). getLeadFieldsFilter() routes them to dedicated query
    // params (activityType / activityOutcome / disposition) instead of folding
    // them into the customFields JSON the way custom dropdowns are.
    const LEAD_BUILTIN_FILTER_FIELDS = [
        {
            code: '__type', label: 'Type',
            is_active: true, show_in_lead_filter: true, show_in_leads_table: false,
            options: [
                { code: 'call',    label: 'Call',    is_active: true },
                { code: 'email',   label: 'Email',   is_active: true },
                { code: 'meeting', label: 'Meeting', is_active: true },
                { code: 'note',    label: 'Note',    is_active: true },
            ],
        },
        {
            code: '__outcome', label: 'Outcome',
            is_active: true, show_in_lead_filter: true, show_in_leads_table: false,
            options: [
                { code: 'connected',          label: 'Connected',          is_active: true },
                { code: 'call_disconnected',  label: 'Call Disconnected',  is_active: true },
                { code: 'not_reachable',      label: 'Not Reachable',      is_active: true },
                { code: 'wrong_number',       label: 'Wrong Number',       is_active: true },
                { code: 'voicemail',          label: 'Voicemail',          is_active: true },
                { code: 'busy',               label: 'Busy',               is_active: true },
                { code: 'callback_requested', label: 'Callback Requested', is_active: true },
                { code: 'meeting_set',        label: 'Meeting Set',        is_active: true },
                { code: 'email_bounced',      label: 'Email Bounced',      is_active: true },
            ],
        },
        {
            code: '__disposition', label: 'Disposition',
            is_active: true, show_in_lead_filter: true, show_in_leads_table: false,
            options: [
                { code: 'hot_lead',          label: 'Hot Lead',          is_active: true },
                { code: 'callback_later',    label: 'Callback Later',    is_active: true },
                { code: 'not_responding',    label: 'Not Responding',    is_active: true },
                { code: 'not_interested',    label: 'Not Interested',    is_active: true },
                { code: 'meeting_scheduled', label: 'Meeting Scheduled', is_active: true },
                { code: 'proposal_sent',     label: 'Proposal Sent',     is_active: true },
                { code: 'deal_in_progress',  label: 'Deal In Progress',  is_active: true },
            ],
        },
    ];
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
            // Built-ins go FIRST so the popover surfaces them above tenant
            // custom dropdowns and the chip-render label lookup hits them.
            const merged = [...LEAD_BUILTIN_FILTER_FIELDS, ...allFields];
            _allFieldsByCode = new Map(merged.map(f => [f.code, f]));
            _fields = merged.filter(f => f.is_active);
            return true;
        } catch (err) {
            console.warn('[lead-fields] load failed:', err);
            _fields = [...LEAD_BUILTIN_FILTER_FIELDS];
            _allFieldsByCode = new Map(LEAD_BUILTIN_FILTER_FIELDS.map(f => [f.code, f]));
            return true; // built-ins still usable even if API failed
        }
    }

    async function init() {
        if (!await loadFields()) return;
        if (_fields.length === 0) return;
        renderFilterBar();
        addTableHeaders();
        const tbody = document.getElementById('leadsTableBody');
        if (tbody) {
            _renderObserver = new MutationObserver(() => {
                injectTableCells();
                // Newly-injected <td>s must inherit the user's hidden-column
                // + reorder preferences, otherwise headers and rows desync
                // when a standard column is hidden or the user has dragged
                // columns into a custom order.
                if (typeof window.applyColumnVisibility === 'function') {
                    window.applyColumnVisibility();
                }
                if (typeof window.applyColumnOrder === 'function') {
                    window.applyColumnOrder();
                }
            });
            _renderObserver.observe(tbody, { childList: true });
            // Tbody may already be populated (loadLeads() finished before us);
            // the observer won't fire retroactively, so seed it manually.
            injectTableCells();
        }
        // Apply visibility + order to the headers we just added + any cells
        // we just back-filled, so the column-picker state takes effect
        // immediately.
        if (typeof window.applyColumnVisibility === 'function') {
            window.applyColumnVisibility();
        }
        if (typeof window.applyColumnOrder === 'function') {
            window.applyColumnOrder();
        }
        wrapActivityModal();
        // Close any open popover on outside click / esc.
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAddFilterPopover(); });
        // Tell late-binding consumers (filter-persistence in leads.js) that
        // the field definitions are loaded and setLeadFieldsFilterValues is
        // now safe to call. Includes a sticky flag so a listener that
        // attaches AFTER this event still finds out — leads.js doesn't
        // control script-load order.
        window.__leadFieldsReady = true;
        window.dispatchEvent(new CustomEvent('leadfields:ready'));
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
                // No stopPropagation: removing a chip reflows the +Add
                // button left, so we WANT the document outside-click hook
                // to close any open popover (otherwise it dangles where
                // the trigger used to be — see Img #219 user report).
                const code = el.getAttribute('data-chip-remove');
                delete _filterValues[code];
                closeAddFilterPopover();
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
        // Cache the trigger reference on the popover so the scroll/resize
        // hook below can re-anchor on every scroll without needing the
        // caller to wire data-trigger-id attributes (the previous design
        // required that and was easy to forget — popovers then drifted on
        // scroll because the rehook couldn't find their trigger).
        pop.__lfTrigger = trigger;
        installPopoverFollowHooks();
        // Defer one frame so the browser has measured the popover content.
        requestAnimationFrame(() => {
            const t = trigger.getBoundingClientRect();
            const margin = 12;
            const gap = 6;
            const popW = Math.min(pop.offsetWidth || 280, window.innerWidth - margin * 2);
            const popH = Math.min(pop.offsetHeight || 320, window.innerHeight - margin * 2);

            // Horizontal anchor: keep the popover next to the trigger
            // without spilling past its visual context. Triggers in the
            // right half of the viewport right-align (popover's right edge
            // = trigger's right edge) so the popover extends leftward and
            // stays under the trigger's column. Triggers in the left half
            // left-align as the natural reading direction.
            const triggerCenter = (t.left + t.right) / 2;
            let left = (triggerCenter > window.innerWidth / 2)
                ? t.right - popW
                : t.left;
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
    // to their triggers. Listeners are wired lazily the first time any
    // popover is shown — `pop.__lfTrigger` is set in positionPopoverFixed
    // so the loop below can re-anchor without any per-popover data-attr
    // wiring (which the previous version required and which was never
    // hooked up by the call-sites, so popovers drifted on every scroll).
    let _scrollResizeHookInstalled = false;
    function installPopoverFollowHooks() {
        if (_scrollResizeHookInstalled) return;
        _scrollResizeHookInstalled = true;
        const reposition = () => {
            document.querySelectorAll('.lf-popover').forEach(pop => {
                const trig = pop.__lfTrigger;
                // Trigger may have been removed from DOM (modal closed,
                // table re-rendered). Skip silently — popover will close
                // on the next outside-click pass.
                if (trig && document.body.contains(trig)) {
                    positionPopoverFixed(pop, trig);
                }
            });
        };
        window.addEventListener('resize',  reposition, { passive: true });
        // capture:true catches scrolls inside any nested overflow
        // container (modal bodies, lead-detail panel, etc), not just the
        // window — important here because the leads page lives inside a
        // .gradient-bg-ambient wrapper and the lead-detail side panel
        // both scroll independently.
        window.addEventListener('scroll',  reposition, { passive: true, capture: true });
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

    // Exposed so buildFilterParams in leads.js can fold custom-dropdown
    // selections into the customFields JSON. Built-in pseudo-fields
    // (codes prefixed `__`) are filtered out — leads.js reads them via
    // getLeadFieldsBuiltinFilters() and routes them to dedicated query
    // params instead of customFields.
    window.getLeadFieldsFilter = function () {
        const out = {};
        for (const [code, val] of Object.entries(_filterValues)) {
            if (!val) continue;
            if (code.startsWith('__')) continue;
            out[code] = [val];
        }
        return Object.keys(out).length > 0 ? out : null;
    };

    /**
     * Built-in filter chips (Type / Outcome / Disposition) currently
     * selected in the +Add filter popover. Returns a plain object the
     * caller can spread onto its query-param builder:
     *   { activityType: 'call', activityOutcome: 'connected', disposition: 'hot_lead' }
     * Empty when none are picked. leads.js merges this into the URL.
     */
    window.getLeadFieldsBuiltinFilters = function () {
        const out = {};
        const map = { '__type': 'activityType', '__outcome': 'activityOutcome', '__disposition': 'disposition' };
        for (const [code, val] of Object.entries(_filterValues)) {
            if (!val) continue;
            const key = map[code];
            if (key) out[key] = val;
        }
        return out;
    };

    // Exposed for the leads-page filter persistence layer (localStorage).
    // Returns the raw _filterValues map ({code: optionCode}) — covers BOTH
    // tenant custom dropdowns and the built-in __type/__outcome/__disposition
    // pseudo-filters in a single shape, which is what we want for round-trip
    // storage (the getLeadFieldsFilter / getLeadFieldsBuiltinFilters splits
    // are for the URL-param shape only).
    window.getAllLeadFieldsFilterValues = function () {
        return { ..._filterValues };
    };

    // Programmatically replace the active filter chips. Used by the leads-page
    // localStorage restore path on reload. Codes whose field definition is
    // not in _allFieldsByCode (archived / unknown) are skipped silently so a
    // stale storage entry can never wedge the page. Returns true if any
    // value actually changed, so the caller can decide whether to re-fetch.
    // No-op (returns false) before init has populated the field map — caller
    // should retry on the `leadfields:ready` event.
    window.setLeadFieldsFilterValues = function (values) {
        if (!values || typeof values !== 'object') return false;
        if (_allFieldsByCode.size === 0) return false;
        let changed = false;
        const wanted = {};
        for (const [code, val] of Object.entries(values)) {
            if (!val) continue;
            const f = _allFieldsByCode.get(code);
            if (!f) continue;
            // Validate the option still exists on the field, otherwise the
            // chip would render its raw code instead of the human label.
            const opt = (f.options || []).find(o => o.code === val);
            if (!opt) continue;
            wanted[code] = val;
        }
        // Diff vs current; replace wholesale if different.
        if (JSON.stringify(wanted) !== JSON.stringify(_filterValues)) {
            _filterValues = wanted;
            changed = true;
            renderActiveChips();
        }
        return changed;
    };

    // Exposed so the columns-picker in leads.js can include tenant-defined
    // table columns alongside the built-in ones.
    window.getLeadFieldColumnDefs = function () {
        return _fields
            .filter(f => f.show_in_leads_table)
            .map(f => ({ id: `lf_${f.code}`, label: f.label }));
    };

    // Exposed so the lead detail panel in lead-journey.js can resolve a
    // raw `custom_fields` code (e.g. "potential") to its full definition
    // (label + options + colors). Returns archived fields too — historical
    // values must still render with their label after soft-delete.
    window.getLeadFieldDef = function (code) {
        return _allFieldsByCode.get(code) || null;
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

    // Built-in dropdowns the rep is choosing between — same shape as a
    // custom field so the picker treats them identically. selectId is the
    // hidden <select> that submitLogActivity reads on save.
    const ACTIVITY_BUILTIN_FIELDS = [
        { code: '__type', label: 'Type', required: true, selectId: 'activityType', options: [
            { code: 'call', label: 'Call' },
            { code: 'email', label: 'Email' },
            { code: 'meeting', label: 'Meeting' },
            { code: 'note', label: 'Note' },
        ] },
        { code: '__outcome', label: 'Outcome', selectId: 'activityOutcome', options: [
            { code: 'connected', label: 'Connected' },
            { code: 'call_disconnected', label: 'Call Disconnected' },
            { code: 'not_reachable', label: 'Not Reachable' },
            { code: 'wrong_number', label: 'Wrong Number' },
            { code: 'voicemail', label: 'Voicemail' },
            { code: 'busy', label: 'Busy' },
            { code: 'callback_requested', label: 'Callback Requested' },
            { code: 'meeting_set', label: 'Meeting Set' },
            { code: 'email_bounced', label: 'Email Bounced' },
        ] },
        { code: '__disposition', label: 'Disposition', selectId: 'activityDisposition', options: [
            { code: 'hot_lead', label: 'Hot Lead' },
            { code: 'callback_later', label: 'Callback Later' },
            { code: 'not_responding', label: 'Not Responding' },
            { code: 'not_interested', label: 'Not Interested' },
            { code: 'meeting_scheduled', label: 'Meeting Scheduled' },
            { code: 'proposal_sent', label: 'Proposal Sent' },
            { code: 'deal_in_progress', label: 'Deal In Progress' },
        ] },
    ];

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
            renderActivityPicker(leadId, currentActivityFields());
        };

        window.submitLogActivity = async function () {
            const fields = currentActivityFields();
            const lead = readLead(_activityLeadId);
            const original = parseCustomFields(lead?.custom_fields);
            // Diff: PATCH fields whose value changed in this modal session.
            // Removing a chip via × explicitly clears the field — we track
            // those separately so persistCustomFields can drop them from
            // the merged JSONB.
            const changed = {};
            const removed = [];
            const changeNotes = [];
            for (const f of fields) {
                const wasSet = original[f.code];
                const nowSet = _activityChips[f.code];
                if (nowSet && nowSet !== wasSet) {
                    changed[f.code] = nowSet;
                    const wasOpt = (f.options || []).find(o => o.code === wasSet);
                    const nowOpt = (f.options || []).find(o => o.code === nowSet);
                    const nowLabel = nowOpt ? nowOpt.label : nowSet;
                    if (wasSet) {
                        const wasLabel = wasOpt ? wasOpt.label : wasSet;
                        changeNotes.push(`${f.label}: ${wasLabel} → ${nowLabel}`);
                    } else {
                        changeNotes.push(`${f.label}: ${nowLabel}`);
                    }
                } else if (wasSet && !nowSet) {
                    removed.push(f.code);
                    const wasOpt = (f.options || []).find(o => o.code === wasSet);
                    const wasLabel = wasOpt ? wasOpt.label : wasSet;
                    changeNotes.push(`${f.label}: ${wasLabel} → (cleared)`);
                }
            }
            const leadId = _activityLeadId;
            // Append the field-change summary to the activity description so
            // the timeline records what was marked alongside the call/email
            // note. Restore the textarea afterwards so a failed submit + retry
            // doesn't double-stamp.
            const ta = document.getElementById('activitySummary');
            const originalSummary = ta ? ta.value : null;
            if (ta && changeNotes.length > 0 && ta.value.trim()) {
                ta.value = `${ta.value.trim()}\n\nField updates: ${changeNotes.join('; ')}`;
            }
            try {
                await origSubmit();
            } finally {
                if (ta && originalSummary !== null) ta.value = originalSummary;
            }
            if (!leadId || (Object.keys(changed).length === 0 && removed.length === 0)) return;
            await persistCustomFields(leadId, changed, removed);
            // origSubmit fires `loadLeads()` before our PUT lands, so the
            // refreshed `allLeads` still shows the old custom_fields.
            // Re-load now that the PUT has committed so the next time the
            // user opens the modal the chips reflect the new values.
            if (typeof window.loadLeads === 'function') window.loadLeads();
        };
    }

    /**
     * Form-answers-style unified picker for the Log Activity modal. Renders
     * three coordinated regions (markup is in leads.html):
     *   #laPillsBar  — chips for currently-set built-ins + custom fields
     *   #laQList     — left-rail list of every dropdown field in the modal
     *   #laQValues   — right pane showing options for the active field
     *
     * Built-in dropdowns (Type/Outcome/Disposition) round-trip through the
     * hidden <select id="activity*"> elements so submitLogActivity's existing
     * .value reads keep working unchanged. Custom fields stay in the
     * _activityChips object that the submit-wrapper diffs against the lead.
     */
    function renderActivityPicker(leadId, customFields) {
        const list     = document.getElementById('laQList');
        const valsPane = document.getElementById('laQValues');
        const pillsBar = document.getElementById('laPillsBar');
        if (!list || !valsPane || !pillsBar) return;

        const allFields = [...ACTIVITY_BUILTIN_FIELDS, ...customFields];

        // Seed lead's saved custom values into the in-flight chip state.
        const lead = readLead(leadId);
        const savedCustom = parseCustomFields(lead?.custom_fields);
        _activityChips = {};
        for (const f of customFields) {
            if (savedCustom[f.code]) _activityChips[f.code] = savedCustom[f.code];
        }

        // Reset built-in selects to defaults each open: Type=call (required),
        // Outcome/Disposition='' (no chip until rep picks one).
        const typeSel = document.getElementById('activityType');
        const outSel  = document.getElementById('activityOutcome');
        const dispSel = document.getElementById('activityDisposition');
        if (typeSel)  typeSel.value  = 'call';
        if (outSel)   outSel.value   = '';
        if (dispSel)  dispSel.value  = '';

        // Activity-log textareas/date pickers reset to empty on each open.
        const summaryTa = document.getElementById('activitySummary');
        if (summaryTa) summaryTa.value = '';
        const callDur = document.getElementById('activityCallDuration');
        if (callDur) callDur.value = '';
        if (typeof HRMSDatePicker?.clearDateTimePair === 'function') {
            HRMSDatePicker.clearDateTimePair('activityNextFollowup');
        }

        let activeCode = '__type';

        const getVal = (f) => f.selectId
            ? (document.getElementById(f.selectId)?.value || '')
            : (_activityChips[f.code] || '');
        const setVal = (f, v) => {
            if (f.selectId) {
                const sel = document.getElementById(f.selectId);
                if (sel) sel.value = v || '';
            } else {
                if (v) _activityChips[f.code] = v;
                else delete _activityChips[f.code];
            }
        };

        function renderList() {
            list.innerHTML = allFields.map(f => `
                <button type="button" role="tab"
                        class="la-q-item ${f.code === activeCode ? 'is-active' : ''} ${getVal(f) ? 'is-set' : ''}"
                        data-la-field="${escapeAttr(f.code)}">
                    <span class="la-q-label">${escapeHtml(f.label)}${f.required ? '<span class="la-q-required">*</span>' : ''}</span>
                </button>
            `).join('');
            list.querySelectorAll('[data-la-field]').forEach(btn => {
                btn.addEventListener('click', () => {
                    activeCode = btn.getAttribute('data-la-field');
                    renderList();
                    renderValues();
                });
            });
        }

        function renderValues() {
            const f = allFields.find(x => x.code === activeCode);
            if (!f) { valsPane.innerHTML = ''; return; }
            const current = getVal(f);
            const opts = (f.options || []).filter(o => o.code !== '');
            valsPane.innerHTML = `
                <div class="la-q-title">${escapeHtml(f.label)}${f.required ? '<span class="la-q-required">*</span>' : ''}</div>
                ${opts.length === 0
                    ? '<div class="la-q-empty">No options configured.</div>'
                    : `<div class="la-option-grid">${opts.map(o => {
                        const swatch = o.color
                            ? `<span class="la-option-swatch" style="background:${escapeAttr(o.color)};"></span>`
                            : '';
                        return `<button type="button" class="la-option ${o.code === current ? 'is-on' : ''}" data-la-option="${escapeAttr(o.code)}">${swatch}${escapeHtml(o.label)}</button>`;
                    }).join('')}</div>`}
            `;
            valsPane.querySelectorAll('[data-la-option]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const code = btn.getAttribute('data-la-option');
                    const wasOn = code === getVal(f);
                    // Required field (Type) can't be cleared by re-clicking — only swapped.
                    setVal(f, (f.required || !wasOn) ? code : '');
                    renderList();
                    renderValues();
                    renderPills();
                });
            });
        }

        function renderPills() {
            const set = allFields.filter(f => getVal(f));
            if (set.length === 0) {
                pillsBar.innerHTML = '<span class="la-pills-empty">No values picked yet — click a field on the left to set one.</span>';
                return;
            }
            pillsBar.innerHTML = set.map(f => {
                const v = getVal(f);
                const opt = (f.options || []).find(o => o.code === v);
                const label = opt ? opt.label : v;
                const swatch = opt && opt.color
                    ? `<span class="la-option-swatch" style="background:${escapeAttr(opt.color)};margin-right:2px;"></span>`
                    : '';
                return `
                    <span class="la-pill" data-la-pill="${escapeAttr(f.code)}" ${f.required ? 'data-required="true"' : ''}>
                        ${swatch}<span class="la-pill-q">${escapeHtml(f.label)}:</span><span class="la-pill-v">${escapeHtml(label)}</span>
                        ${f.required ? '' : `<button type="button" class="la-pill-x" data-la-pill-x="${escapeAttr(f.code)}" aria-label="Clear ${escapeAttr(f.label)}">×</button>`}
                    </span>
                `;
            }).join('');
            pillsBar.querySelectorAll('[data-la-pill-x]').forEach(b => {
                b.addEventListener('click', e => {
                    e.stopPropagation();
                    const code = b.getAttribute('data-la-pill-x');
                    const f = allFields.find(x => x.code === code);
                    setVal(f, '');
                    renderList();
                    if (activeCode === code) renderValues();
                    renderPills();
                });
            });
            pillsBar.querySelectorAll('.la-pill').forEach(p => {
                p.addEventListener('click', e => {
                    if (e.target.closest('[data-la-pill-x]')) return;
                    activeCode = p.getAttribute('data-la-pill');
                    renderList();
                    renderValues();
                });
            });
        }

        renderList();
        renderValues();
        renderPills();
    }

    // Legacy chip renderer kept for callers other than the Log Activity modal
    // (none today; left intact to avoid silent breakage if a tenant page
    // still references it). New entry point is renderActivityPicker above.
    function renderActivityChips(leadId, fields) {
        const wrap = document.getElementById('activityLeadFields');
        if (!wrap) return;
        if (fields.length === 0) { wrap.innerHTML = ''; return; }

        const lead = readLead(leadId);
        const current = parseCustomFields(lead?.custom_fields);
        _activityChips = {};
        for (const f of fields) {
            if (current[f.code]) _activityChips[f.code] = current[f.code];
        }

        wrap.innerHTML = `
            <div class="lf-activity-chip-row">
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

    async function persistCustomFields(leadId, picks, removed = []) {
        try {
            const lead = readLead(leadId);
            const existing = parseCustomFields(lead?.custom_fields);
            const merged = { ...existing, ...picks };
            for (const code of removed) delete merged[code];
            // CRM's JSON binder uses SnakeCaseLower (Program.cs), so the body
            // key must be `custom_fields` — `customFields` silently binds to
            // null, leaving the lead untouched.
            await api.request(`/crm/leads/${leadId}`, {
                method: 'PUT',
                body: JSON.stringify({ custom_fields: JSON.stringify(merged) }),
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
