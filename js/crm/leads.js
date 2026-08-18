/**
 * CRM Leads Management
 * Handles CRUD operations, filtering, and lead conversion.
 */

// ==================== State ====================
let allLeads = [];
let selectedLeadIds = new Set();
// Cross-page cache: when a user selects a lead on page 1, navigates to
// page 2, then clicks Send Campaign, we still need the original lead's
// name / email / company. allLeads gets replaced on each loadLeads() call
// so we mirror every row we've rendered into this Map keyed by lead.id.
// Entries are only evicted when the user explicitly clears their selection.
let selectedLeadsData = new Map();
let currentEditLeadId = null;
let convertingLeadId = null;
let currentPage = 1;
let pageSize = 50;
const PAGE_SIZE_OPTIONS = [10, 50, 100, 500, 1000, 5000];
let totalLeads = 0;
// Monotonic token so only the LATEST loadLeads() render wins. On page
// load we fire an unfiltered loadLeads() immediately, then a second,
// filtered one once persisted filters (e.g. the saved Source) finish
// restoring after their options load async. The unfiltered query returns
// more rows, so it resolved LAST and clobbered the filtered view — the
// dropdown showed the saved Source but the list was unfiltered. Each call
// claims a token; a response only renders if its token is still current.
let _loadLeadsSeq = 0;
let myTeamRole = 'member'; // default to most restrictive
let reassigningLeadId = null;

// Searchable dropdown instances
let filterStatusDropdown = null;
let filterSourceDropdown = null;
let leadSourceDropdown = null;
let leadStatusDropdown = null;

// ==================== Filter persistence ====================
// Real complaint (Subhi @ VBF, 2026-05-14): "auto-refresh removes all our
// existing filters". Reps were losing their filter setup on every reload —
// or whenever any code path triggered loadLeads() after the page mounted.
// Persisted to localStorage, tenant-scoped so two tenants on the same
// browser can't see each other's saved view.
const _FILTER_STORAGE_KEY_BASE = 'crm.leads.filters.v1';
const _PERSISTED_FILTER_IDS = [
    'filterStatus', 'filterSource', 'filterSearch',
    'filterEmailStatus', 'filterCampaign',
    'filterDateFrom', 'filterDateTo', 'filterDateMode',
    'filterTeam', 'filterOwner'
];

function _filterStorageKey() {
    const u = (typeof getStoredUser === 'function') ? getStoredUser() : null;
    return `${_FILTER_STORAGE_KEY_BASE}:${u?.tenantId || 'anon'}`;
}

// ==================== Search scope toggle ====================
// Tenant-scoped flag controlling whether the search box runs WITHIN the
// current filter set (default — what reps expect when narrowing a view)
// or ACROSS every lead they can see (escape hatch for "I know this lead
// exists somewhere"). Stored alongside the filter snapshot under its own
// key so toggling doesn't churn the larger blob.
const _SEARCH_SCOPE_KEY_BASE = 'crm.leads.searchScope.v1';
function _searchScopeStorageKey() {
    const u = (typeof getStoredUser === 'function') ? getStoredUser() : null;
    return `${_SEARCH_SCOPE_KEY_BASE}:${u?.tenantId || 'anon'}`;
}
function _isSearchScopeAll() {
    const btn = document.getElementById('searchScopeToggle');
    return btn?.dataset?.scope === 'all';
}
function _applySearchScopeUI(scope) {
    const btn = document.getElementById('searchScopeToggle');
    const input = document.getElementById('filterSearch');
    if (!btn) return;
    btn.dataset.scope = scope;
    if (scope === 'all') {
        // "All" still respects the caller's role gate (admin: tenant-wide,
        // manager/TL: their teams, member: their assigned leads) — only
        // the user-applied filter widgets are bypassed. Tooltip says
        // "everything you can see" rather than literally "ALL" so a rep
        // isn't surprised when their teammate's leads still don't appear.
        btn.setAttribute('data-tooltip', 'Searching everything you can see (filters ignored). Click to search within your filters.');
        if (input) input.placeholder = 'Search everything you can see…';
    } else {
        btn.setAttribute('data-tooltip', 'Searching within your filters. Click to search across everything you can see.');
        if (input) input.placeholder = 'Search leads...';
    }
}
function toggleSearchScope() {
    const next = _isSearchScopeAll() ? 'filtered' : 'all';
    _applySearchScopeUI(next);
    try { localStorage.setItem(_searchScopeStorageKey(), next); } catch (_) {}
    applyFilters();
}

// "Search everything" mode ignores every narrowing filter — so the moment the
// user explicitly interacts with a filter (view tab, popover widget), flip
// back to filtered mode. Otherwise the tab highlights but the list silently
// doesn't change, which reads as a broken page.
function _exitSearchScopeAll() {
    if (!_isSearchScopeAll()) return;
    _applySearchScopeUI('filtered');
    try { localStorage.setItem(_searchScopeStorageKey(), 'filtered'); } catch (_) {}
}
function _restoreSearchScope() {
    let scope = 'filtered';
    try { scope = localStorage.getItem(_searchScopeStorageKey()) || 'filtered'; } catch (_) {}
    _applySearchScopeUI(scope === 'all' ? 'all' : 'filtered');
}

// Page-init gate for filter persistence. While false, _persistFilters
// returns without writing — protects the saved snapshot from being
// clobbered by async loaders that fire applyFilters() before all
// dropdown options have been populated.
//
// The bug this fixes: lead-fields-runtime fires `leadfields:ready` as soon
// as it loads tenant field definitions (~100ms). That triggers
// _restoreLeadFieldsChips → applyFilters → _persistFilters. At that
// moment, loadSourceFilter / loadCampaignFilter / loadMyTeamsFilter
// haven't returned yet, so their <select>s only contain the placeholder.
// _persistFilters reads `el.value === ''` for those and writes a snapshot
// MISSING filterSource/filterCampaign/filterTeam keys. The async loader
// then finishes, reads the (now-incomplete) snapshot, finds no key to
// restore, and the dropdown sits at its placeholder label even though
// the user's filter is still intended.
//
// The flag flips to true once every initial-restore source has reported
// in — see _markRestoreSourceDone() below.
let _initialRestoreDone = false;
const _PENDING_RESTORE_SOURCES = new Set(['source', 'campaign', 'teams', 'leadfields']);
function _markRestoreSourceDone(name) {
    _PENDING_RESTORE_SOURCES.delete(name);
    if (_PENDING_RESTORE_SOURCES.size === 0 && !_initialRestoreDone) {
        _initialRestoreDone = true;
        // Re-apply every persisted widget now that all options exist, then
        // do an UNCONDITIONAL authoritative reload. The async Source restore
        // settles its dropdown wrapper AFTER the early loadLeads() calls
        // already fired during init, so gating this on "did anything change"
        // (the old _restoreAndApplyIfChanged) reported no-change and SKIPPED
        // the reload — leaving the stale unfiltered list even though the
        // Source dropdown showed the saved value. Always reload here; the
        // stale-response guard in loadLeads() makes this final, fully-
        // restored load win over any earlier in-flight one.
        _restorePersistedFilters();
        _restoreLeadFieldsChips();
        _restoreFormAnswers();
        loadLeads();
        loadLeadStats();
    }
}
// Safety net: if something goes wrong with one of the loaders and it
// never marks done, unblock persistence after 5s so the user isn't
// permanently unable to save filter changes. 5s is long enough that all
// healthy loaders finish first, short enough that a stuck one doesn't
// block the user indefinitely.
setTimeout(() => {
    if (!_initialRestoreDone) {
        _initialRestoreDone = true;
        _PENDING_RESTORE_SOURCES.clear();
    }
}, 5000);

function _persistFilters() {
    // Block writes during the initial restore window — async loaders
    // haven't returned yet so the current widget state is partial. See
    // the comment on _initialRestoreDone above for the failure mode.
    if (!_initialRestoreDone) return;
    try {
        const out = {};
        for (const id of _PERSISTED_FILTER_IDS) {
            const el = document.getElementById(id);
            if (el && el.value) out[id] = el.value;
        }
        // Custom-dropdown + built-in pseudo-filter chips owned by
        // lead-fields-runtime.js. Stored as the raw {code: optionCode} map
        // since that's exactly what setLeadFieldsFilterValues consumes.
        if (typeof window.getAllLeadFieldsFilterValues === 'function') {
            const lf = window.getAllLeadFieldsFilterValues();
            if (lf && Object.keys(lf).length > 0) out.customFilters = lf;
        }
        // Form-answers filter is source-scoped — different sources have
        // different questions, so we tag the snapshot with the source it
        // was applied to. Restore only re-applies if the current source
        // still matches.
        if (typeof FormAnswersFilter !== 'undefined' &&
            typeof FormAnswersFilter.getFilter === 'function') {
            const fa = FormAnswersFilter.getFilter() || {};
            if (Object.keys(fa).length > 0) {
                const src = document.getElementById('filterSource')?.value;
                if (src && !src.startsWith('__')) {
                    out.formAnswers = { sourceId: src, filter: fa };
                }
            }
        }
        const key = _filterStorageKey();
        if (Object.keys(out).length === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(out));
    } catch (_) { /* quota / disabled — silent */ }
}

// Restore the lead-fields-runtime chips from the saved snapshot. No-op if
// the runtime hasn't fired its `leadfields:ready` event yet. Returns true
// when anything actually changed (caller refetches).
function _restoreLeadFieldsChips() {
    if (window.location.search) {
        const urlParams = new URLSearchParams(window.location.search);
        if ([...urlParams.keys()].length > 0) return false;
    }
    if (typeof window.setLeadFieldsFilterValues !== 'function') return false;
    const saved = _loadPersistedFilters();
    if (!saved.customFilters) return false;
    return window.setLeadFieldsFilterValues(saved.customFilters) === true;
}

// Restore the form-answers selection — only if the saved snapshot is for
// the currently-selected source (different sources have different
// questions, so a cross-source restore would be nonsensical). Returns
// true when anything actually changed.
function _restoreFormAnswers() {
    if (window.location.search) {
        const urlParams = new URLSearchParams(window.location.search);
        if ([...urlParams.keys()].length > 0) return false;
    }
    if (typeof FormAnswersFilter === 'undefined' ||
        typeof FormAnswersFilter.setFilter !== 'function') return false;
    const saved = _loadPersistedFilters();
    if (!saved.formAnswers) return false;
    const currentSource = document.getElementById('filterSource')?.value;
    if (!currentSource || currentSource !== saved.formAnswers.sourceId) return false;
    return FormAnswersFilter.setFilter(saved.formAnswers.filter || {}) === true;
}

function _loadPersistedFilters() {
    try {
        const raw = localStorage.getItem(_filterStorageKey());
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) { return {}; }
}

// SearchableDropdown wrappers keep their own `selectedValue` separate from
// the underlying <select>.value. buildFilterParams reads the WRAPPER's
// value (line 690), so a restore that only writes to the native select
// silently fails to filter (Playwright caught this 2026-05-14: source
// filter restored visually but rows stayed unfiltered). Map of widget
// id → wrapper-getter so the restore path can sync the wrapper too.
function _sdWrapperFor(id) {
    switch (id) {
        case 'filterStatus': return typeof filterStatusDropdown !== 'undefined' ? filterStatusDropdown : null;
        case 'filterSource': return typeof filterSourceDropdown !== 'undefined' ? filterSourceDropdown : null;
        case 'filterTeam':   return typeof filterTeamDropdown   !== 'undefined' ? filterTeamDropdown   : null;
        case 'filterOwner':  return typeof filterOwnerDropdown  !== 'undefined' ? filterOwnerDropdown  : null;
    }
    return null;
}

// Idempotent: safe to call repeatedly after the async option-populating
// loaders (source / campaign / team) finish. A saved <select> value is
// only applied once the matching option exists; otherwise we skip and try
// again on the next loader callback. Deep-link URL params always win —
// when any are present, we don't restore at all.
// Returns true when any DOM input was actually changed, so the caller can
// decide whether to re-run applyFilters() (e.g. async loaders that restored
// a value AFTER the initial loadLeads already fired).
function _restorePersistedFilters() {
    if (window.location.search) {
        const urlParams = new URLSearchParams(window.location.search);
        if ([...urlParams.keys()].length > 0) return false;
    }
    const saved = _loadPersistedFilters();
    let changed = false;
    for (const id of _PERSISTED_FILTER_IDS) {
        const want = saved[id];
        if (!want) continue;
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.tagName === 'SELECT') {
            const hit = Array.from(el.options).some(o => o.value === want);
            if (!hit) continue;
        }
        if (el.value !== want) { el.value = want; changed = true; }
        // Flatpickr-managed date inputs draw their visible "alt input"
        // separately from the underlying hidden <input>. Setting el.value
        // updates the hidden input but leaves the visible alt-input
        // showing the placeholder — so the filter is applied to the
        // backend but the user can't see WHICH date is active.
        // setDate(value, false) syncs both without firing onChange.
        if (el._flatpickr && typeof el._flatpickr.setDate === 'function') {
            el._flatpickr.setDate(want, /*triggerChange=*/false);
        }
        // Sync the SearchableDropdown wrapper if there is one — without
        // this the wrapper's internal selectedValue stays empty and
        // buildFilterParams reads '' instead of the restored value. We
        // ALSO re-snapshot the wrapper's options from el.options first
        // because the wrapper's own MutationObserver sync is async and
        // hasn't run yet when this loader callback fires synchronously
        // right after innerHTML is rewritten (Playwright caught this
        // 2026-05-14: source value would silently drop to null).
        const wrapper = _sdWrapperFor(id);
        if (wrapper && typeof wrapper.setValue === 'function') {
            if (typeof wrapper.setOptions === 'function') {
                const opts = Array.from(el.options).map(o => ({
                    value: o.value,
                    label: o.textContent.trim(),
                    description: o.dataset?.description || ''
                }));
                wrapper.setOptions(opts, /*preserveValue=*/true);
            }
            if (String(wrapper.getValue?.() ?? '') !== String(want)) {
                wrapper.setValue(want, /*triggerChange=*/false);
                changed = true;
            }
        }
    }
    return changed;
}

// Wipe every persisted filter widget back to its empty default and clear
// the localStorage snapshot — exposed via the gear menu so a rep who can't
// remember which filter is hiding their leads has a one-click escape hatch.
// Persisted filters can confuse a rep into thinking "leads are missing":
// the snapshot survives reloads, logouts, even browser-restarts, so a
// filter set in March is still hiding rows in May with no visible chip.
function clearAllFilters() {
    try { localStorage.removeItem(_filterStorageKey()); } catch (_) {}
    // Also reset the search scope — if a rep had toggled to "all leads"
    // and then hit Clear, they'd expect the page to look clean, not stay
    // in escape-hatch mode.
    try { localStorage.removeItem(_searchScopeStorageKey()); } catch (_) {}
    _applySearchScopeUI('filtered');
    for (const id of _PERSISTED_FILTER_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        // Flatpickr-managed date inputs keep their visible "alt input" out
        // of band — clearing `el.value` on the hidden input leaves the
        // alt-input still showing the old date, so the user sees a date
        // they can't tell isn't applied. _flatpickr.clear() syncs both.
        if (el._flatpickr && typeof el._flatpickr.clear === 'function') {
            el._flatpickr.clear();
        } else {
            el.value = '';
        }
        // SearchableDropdown wrappers keep their own selectedValue —
        // buildFilterParams reads the wrapper, so resetting just the
        // native <select> would silently leave the wrapper still filtered.
        const wrapper = _sdWrapperFor(id);
        if (wrapper && typeof wrapper.setValue === 'function') {
            wrapper.setValue('', /*triggerChange=*/false);
        }
    }
    // Date-mode dropdown isn't in the persisted-IDs list (it's a UX toggle,
    // not a narrowing filter), but a non-default value still skews the
    // date range. Reset to 'created' so the date inputs do what their label
    // says again.
    const dateMode = document.getElementById('filterDateMode');
    if (dateMode) dateMode.value = 'created';
    // Custom-field chips (lead-fields-runtime) and Form-answers selections
    // are owned by separate modules — give each its own reset hook so the
    // chips, labels and pill counters all clear in lockstep.
    if (typeof window.setLeadFieldsFilterValues === 'function') {
        window.setLeadFieldsFilterValues({});
    }
    if (typeof FormAnswersFilter !== 'undefined' && typeof FormAnswersFilter.reset === 'function') {
        FormAnswersFilter.reset();
    }
    closeFilterMenu();
    applyFilters();
}

// Open/close the gear-icon dropdown that hosts "Clear all filters". Same
// mobile-anchor maths as the columns picker so the menu doesn't fling off
// the right edge of a narrow viewport.
function toggleFilterMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('filterMenu');
    const btn = document.getElementById('filterMenuBtn');
    if (!menu) return;
    if (menu.hidden) {
        menu.hidden = false;
        if (btn && window.matchMedia('(max-width: 768px)').matches) {
            const parent = btn.offsetParent || btn.parentElement;
            const parentRect = parent.getBoundingClientRect();
            const inset = 16;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
            menu.style.left = (inset - parentRect.left) + 'px';
            menu.style.right = 'auto';
            menu.style.width = (viewportWidth - inset * 2) + 'px';
        } else {
            // Right-anchor on desktop so the menu doesn't hang off the
            // viewport when the gear sits flush with the right edge.
            menu.style.left = 'auto';
            menu.style.right = '0';
            menu.style.width = '';
        }
        setTimeout(() => {
            document.addEventListener('click', closeFilterMenuOnOutside, { once: true });
        }, 0);
    } else {
        menu.hidden = true;
    }
}

function closeFilterMenu() {
    const menu = document.getElementById('filterMenu');
    if (menu) menu.hidden = true;
}

function closeFilterMenuOnOutside(e) {
    const menu = document.getElementById('filterMenu');
    const btn = document.getElementById('filterMenuBtn');
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target) || (btn && btn.contains(e.target))) {
        document.addEventListener('click', closeFilterMenuOnOutside, { once: true });
        return;
    }
    menu.hidden = true;
}

// Called from async option-populating loaders AFTER they restore a saved
// value — kicks a re-fetch so the table reflects the restored filter
// (initial loadLeads fired before the options existed). Lazy: only if a
// restore actually changed a value, so the common no-saved-filter case
// stays single-fetch.
// Folds basic-widget, custom-chip and form-answer restores into a single
// refetch so we don't trigger three back-to-back loadLeads requests when
// the user reloads a heavily-filtered view.
function _restoreAndApplyIfChanged() {
    const a = _restorePersistedFilters();
    const b = _restoreLeadFieldsChips();
    const c = _restoreFormAnswers();
    if (a || b || c) applyFilters();
}

// lead-fields-runtime.js loads its field definitions asynchronously. If
// its init wins the race vs our initial loadLeads, the chips restore can
// piggyback on the source/team loader callbacks. If it loses (more
// common — async fetch is slower than localStorage read), we need a
// separate trigger. The `leadfields:ready` event covers both cases. We
// also check the sticky `__leadFieldsReady` flag so a listener attached
// AFTER the event still kicks the restore on next tick.
function _wireLeadFieldsReadyRestore() {
    const tryRestore = () => {
        if (_restoreLeadFieldsChips()) applyFilters();
        _markRestoreSourceDone('leadfields');
    };
    if (window.__leadFieldsReady) {
        // Already initialised — restore on next tick so the source dropdown
        // has time to also be in place.
        setTimeout(tryRestore, 0);
    } else {
        window.addEventListener('leadfields:ready', tryRestore, { once: true });
    }
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('crm', '../');
    // Nothing on this page works without functional groups + teams
    // configured for the tenant. Probe first; if the tenant isn't ready,
    // the guard redirects to Settings and we bail out of init so we don't
    // fire a bunch of doomed requests behind the redirect.
    if (window.CrmSetupGuard && await window.CrmSetupGuard.ensureConfigured()) {
        return;
    }
    _restoreFiltersPanelState();
    // Any filter interaction inside the popover exits "search everything"
    // mode first (capture phase → runs before the widget's own onchange).
    const _fpanel = document.getElementById('leadsFiltersPanel');
    if (_fpanel) _fpanel.addEventListener('change', () => _exitSearchScopeAll(), true);
    // Split view: opening a lead also highlights its row in the list pane.
    // lead-journey.js has defined openLeadDetailPanel by DOM-ready (script
    // order), so wrapping here is safe.
    const _origOpenLead = window.openLeadDetailPanel;
    if (typeof _origOpenLead === 'function') {
        window.openLeadDetailPanel = function (id) {
            ldkHighlightRow(id);
            const switching = window._leadDetailId !== id;
            const result = _origOpenLead(id);
            // Opening a different lead resets the workspace scroll — otherwise
            // the pane stays wherever the previous lead's timeline left it.
            if (switching) {
                Promise.resolve(result).then(() => {
                    const body = document.querySelector('#leadDetailPanel .panel-body');
                    if (body) body.scrollTop = 0;
                });
            }
            return result;
        };
    }
    loadMyRole();
    // Probe whether the tenant has any configured shared mailbox. The
    // result gates the inline "send email" buttons in the leads table and
    // lead detail panel — no point offering Send Email when the backend
    // can't actually send. Cached on window so renderLeadsTable +
    // openLeadDetailPanel can read it synchronously.
    loadTenantMailboxFlag();
    // Restore filter widgets from localStorage BEFORE the first loadLeads()
    // call so the user picks up where they left off. Async-populated
    // dropdowns (source / campaign / team) re-apply their saved value once
    // their options finish loading. The custom-dropdown chips owned by
    // lead-fields-runtime.js restore on its own ready event (registered
    // here so it fires regardless of script-load order).
    _restoreSearchScope();
    _restorePersistedFilters();
    _wireLeadFieldsReadyRestore();
    // Deep-link from My Day: /pages/crm/leads.html?ownerUserId=<uuid>
    // pre-fills the Owner filter dropdown and triggers loadLeads so the
    // rep lands on a page already narrowed to their own pipeline. A
    // sessionStorage handoff key ('crm_openLeadId') opens the detail panel
    // for a specific lead AFTER loadLeads completes — sessionStorage avoids
    // the URL-param race condition where openLeadDetailPanel fired before
    // the table state was ready and got the user logged out.
    applyDeepLinkFilters();
    loadLeads().then(() => {
        // ?lead=<id> is accepted as an equivalent source. It is read HERE,
        // inside the post-loadLeads callback, and not in applyDeepLinkFilters
        // — that is what avoids the race the comment above describes. Links
        // from the dashboard activity feed and the related-records panels use
        // the URL form because a plain <a href> is a real, copyable link.
        // The URL wins over the sessionStorage handoff, and the handoff key is
        // consumed either way.
        //
        // The setter writes crm_openLeadId and then navigates, so the key only
        // clears if the destination actually reaches this callback. Anything
        // that interrupts that — navigating elsewhere first, a failed load —
        // leaves it in sessionStorage for the life of the tab. Read
        // handoff-first, that stale id then silently overrode every later
        // ?lead=<id> link: you click through to one lead and the panel opens a
        // different one. Observed exactly that.
        //
        // A URL parameter is the caller's explicit, current intent; the handoff
        // is a fallback for callers that cannot put it in the URL.
        const params = new URLSearchParams(window.location.search);
        const handoffId = sessionStorage.getItem('crm_openLeadId');
        sessionStorage.removeItem('crm_openLeadId');   // consume unconditionally
        const openId = params.get('lead') || handoffId;

        if (openId && typeof window.openLeadDetailPanel === 'function') {
            try { window.openLeadDetailPanel(decodeURIComponent(openId)); }
            catch (e) { console.warn('[leads] deep-link auto-open failed', e); }
        }
    }).catch(() => {});
    loadLeadStats();
    loadLeadsWave();
    loadSourceFilter();
    loadCampaignFilter();
    loadMyTeamsFilter();
    loadReassignQueueBadge();
    initSearchableDropdowns();
    setupLeadsRealtime();
    _initLeadsTableColumnResize();
    // Banner is hidden by default. Poll inbox once on load so users who
    // refresh mid-session don't lose their open requests until SignalR
    // delivers a new event.
    if (typeof window.refreshHelpInboxBanner === 'function') {
        window.refreshHelpInboxBanner();
    }
});

// Excel-style column resize for the leads table. Mount once on init, then
// re-mount whenever lead-fields-runtime injects custom-field <th>s so the
// freshly-added columns also get a drag handle and any saved width.
function _initLeadsTableColumnResize() {
    if (typeof window.mountColumnResize !== 'function') return;
    const table = document.getElementById('leadsTable');
    if (!table) return;
    const u = (typeof getStoredUser === 'function') ? getStoredUser() : null;
    const tenantId = u?.tenantId || 'anon';
    const opts = { resizeKey: `leads:${tenantId}` };

    window.mountColumnResize(table, opts);

    // Re-mount on header mutations (custom-field columns arrive late,
    // column-picker may reorder/inject). Idempotent — existing handles
    // are skipped and only new <th>s pick up the handle.
    const thead = table.querySelector('thead');
    if (thead && typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver(() => window.mountColumnResize(table, opts));
        obs.observe(thead, { childList: true, subtree: true });
    }
}

// My Day deep-link: read URL params and pre-fill the matching filter widgets.
// Supported today: ?ownerUserId=<uuid|me>, ?status=<csv>, ?hasFollowup=true.
// If 'me', resolve to the current authenticated user's id via the JWT claim.
// Pre-filling the <select> + dispatching 'change' lets the existing filter
// pipeline (applyFilters → loadLeads) do its job without any backend changes.
function applyDeepLinkFilters() {
    const params = new URLSearchParams(window.location.search);
    if (![...params.keys()].length) return;

    let ownerUserId = params.get('ownerUserId');
    if (ownerUserId === 'me' && typeof api !== 'undefined' && typeof api.getUser === 'function') {
        ownerUserId = api.getUser()?.id || api.getUser()?.userId || null;
    }

    // Wait one tick — the filter dropdowns are SearchableDropdown wrappers
    // that initialize after DOMContentLoaded. Setting before they're ready
    // is a no-op.
    setTimeout(() => {
        if (ownerUserId) {
            const ownerEl = document.getElementById('filterOwner');
            if (ownerEl) {
                ownerEl.value = ownerUserId;
                ownerEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            // SearchableDropdown wrappers carry their own display state.
            // We trigger applyFilters explicitly in case the change handler
            // didn't propagate (some wrappers swallow it).
        }
        if (typeof applyFilters === 'function') applyFilters();
    }, 250);
}

// Polls the reassign-queue count endpoint. The button + badge stay hidden
// when count is 0 (regular tenants never see them) and pop in red the
// moment a lead's owner gets deactivated. Backend rejects non-managers
// with 403, so the regular-member case naturally results in count=0
// without leaking that the endpoint exists.
async function loadReassignQueueBadge() {
    const btn = document.getElementById('reassignQueueBtn');
    const badge = document.getElementById('reassignQueueBadge');
    if (!btn || !badge) return;
    try {
        const res = await api.request('/crm/leads/reassign-queue/count');
        const count = (res && typeof res.count === 'number') ? res.count : 0;
        badge.textContent = count;
        // Permanently visible for admins/managers (any caller the
        // backend doesn't 403). Hiding it behind count > 0 made the
        // page un-discoverable — a tenant with 207 unassigned leads
        // had no way to find this page until the queue's predicate
        // was widened on 2026-06-12 to surface them. Now it shows
        // even at zero so the manager knows the option exists.
        btn.style.display = '';
        // Soften the red when nothing's wrong; keep the loud red
        // when leads are actually stuck.
        if (count === 0) {
            btn.style.borderColor = 'var(--border-color)';
            btn.style.color = 'var(--text-secondary)';
            badge.style.background = 'var(--bg-secondary)';
            badge.style.color = 'var(--text-secondary)';
        } else {
            btn.style.borderColor = 'rgba(239,68,68,0.4)';
            btn.style.color = 'var(--color-error, #ef4444)';
            badge.style.background = 'var(--color-error, #ef4444)';
            badge.style.color = '#fff';
        }
    } catch {
        // 403 (non-manager) or transient — stay hidden.
        btn.style.display = 'none';
    }
}

// ==================== Team + Owner filters (multi-team support) =============
// Populates the "Team" filter with every team the caller is a member of
// (or every team in the tenant if they're CRM admin). Only shown when the
// user is on 2+ teams — no point cluttering the bar for single-team users.
// The "Owner" filter is populated from the selected team's members so a
// manager can isolate one salesperson's pipeline (use case: someone leaves,
// manager needs to bulk-reassign all their leads to another team member).
let filterTeamDropdown = null;
let filterOwnerDropdown = null;
let _myTeamsCache = []; // [{ team_id, team_name, role, is_admin }]
let _teamMembersCache = {}; // { team_id: [{ user_id, user_name, role }] }

async function loadMyTeamsFilter() {
    const sel = document.getElementById('filterTeam');
    const group = document.getElementById('filterTeamGroup');
    if (!sel || !group) { _markRestoreSourceDone('teams'); return; }
    try {
        const teams = await api.request('/crm/leads/my-teams');
        const list = Array.isArray(teams) ? teams : [];
        _myTeamsCache = list;
        const allOpt = sel.querySelector('option[value=""]');
        sel.innerHTML = '';
        if (allOpt) sel.appendChild(allOpt);
        else {
            const o = document.createElement('option');
            o.value = ''; o.textContent = 'All my teams';
            sel.appendChild(o);
        }
        list.forEach(t => {
            if (!t?.team_id || !t?.team_name) return;
            const o = document.createElement('option');
            o.value = t.team_id;
            o.textContent = t.role && t.role !== 'admin'
                ? `${t.team_name} (${t.role})`
                : t.team_name;
            sel.appendChild(o);
        });
        // Hide the team filter if the user is only on one team (or none) —
        // keeps the filter bar lean for single-team tenants.
        if (list.length >= 2) group.style.display = '';
        // Restore saved Team selection now options exist; do NOT re-fetch
        // here because refreshOwnerFilter() below depends on the team value
        // and will run a second restore + refetch pass.
        _restorePersistedFilters();
        if (filterTeamDropdown && typeof filterTeamDropdown.rebuild === 'function') {
            filterTeamDropdown.rebuild();
        }
        // Owner filter: only shown to admins/managers/teamleads because
        // regular members can only see their own leads regardless.
        await refreshOwnerFilter();
        // refreshOwnerFilter populates the owner <select> options — re-apply
        // saved owner now that they exist, and trigger a single refetch if
        // either team or owner was restored.
        _restoreAndApplyIfChanged();
    } catch (e) {
        console.warn('Failed to load team filter:', e?.message || e);
    } finally {
        _markRestoreSourceDone('teams');
    }
}

// Reacts to the team dropdown changing: re-populates the Owner filter
// with the selected team's members, then re-fetches leads.
async function onTeamFilterChanged() {
    await refreshOwnerFilter();
    applyFilters();
}

async function refreshOwnerFilter() {
    const ownerSel = document.getElementById('filterOwner');
    const ownerGroup = document.getElementById('filterOwnerGroup');
    const teamSel = document.getElementById('filterTeam');
    if (!ownerSel || !ownerGroup || !teamSel) return;

    const selectedTeamId = teamSel.value;
    const userIsPrivileged = _myTeamsCache.some(t => t.role === 'admin' || t.role === 'manager' || t.role === 'teamlead');
    if (!userIsPrivileged) {
        ownerGroup.style.display = 'none';
        return;
    }

    // Build the member set from the selected team (or all user's teams).
    // Dedupe by user_id: the same salesperson on 2 teams should only show once.
    const memberMap = new Map();
    const teamsToScan = selectedTeamId
        ? _myTeamsCache.filter(t => t.team_id === selectedTeamId)
        : _myTeamsCache;
    for (const t of teamsToScan) {
        if (!_teamMembersCache[t.team_id]) {
            try {
                const team = await api.request(`/crm/teams/${t.team_id}`);
                _teamMembersCache[t.team_id] = (team?.members || team?.Members || []).filter(m => m.is_active !== false);
            } catch {
                // Don't cache [] on failure — caching an empty array would hide this
                // team's members for the rest of the session and read as "empty team".
                // Skip it this pass so a later open can retry the fetch.
                continue;
            }
        }
        for (const m of _teamMembersCache[t.team_id]) {
            if (m.user_id && !memberMap.has(m.user_id)) {
                const name = m.user_name || m.display_name || m.email || m.user_id;
                memberMap.set(m.user_id, { userId: m.user_id, name, role: m.role });
            }
        }
    }

    // Rebuild the dropdown, preserving the current selection if still valid.
    const current = ownerSel.value;
    ownerSel.innerHTML = '<option value="">Any owner</option><option value="__unassigned__">Unassigned</option>';
    for (const m of memberMap.values()) {
        const o = document.createElement('option');
        o.value = m.userId;
        o.textContent = m.role && m.role !== 'member' ? `${m.name} (${m.role})` : m.name;
        ownerSel.appendChild(o);
    }
    // Reselect the prior choice if it's still in the list; otherwise clear.
    if ([...ownerSel.options].some(o => o.value === current)) ownerSel.value = current;
    else ownerSel.value = '';
    ownerGroup.style.display = '';
    if (filterOwnerDropdown && typeof filterOwnerDropdown.rebuild === 'function') {
        filterOwnerDropdown.rebuild();
    }
}

// ==================== Real-time updates ====================

// Subscribes to the tenant-scoped CRM SignalR hub so newly-ingested leads
// (Facebook webhooks, Google Sheets polling, webform POSTs, AI discovery)
// appear without a manual refresh.
//
// We deliberately DO NOT auto-refresh the table. A user might be mid-edit
// in the slide panel, have the convert modal open, or have a partial bulk
// selection — any of that would be wiped by loadLeads(). Instead, we buffer
// new-lead events into a counter and surface a click-to-refresh banner
// (same pattern as Gmail/Twitter). User refreshes when they're ready.
let _leadsHubConnection = null;
let _pendingNewLeadCount = 0;

async function setupLeadsRealtime() {
    if (typeof signalR === 'undefined') return;
    // Use the project-standard token accessor (config.js → getAuthToken()),
    // NOT localStorage.getItem('token') — this repo stores the JWT under a
    // tenant-prefixed key (`<slug>_authToken`), so the naive lookup returns
    // null and the hub negotiate returns 401.
    const tokenFn = typeof getAuthToken === 'function' ? getAuthToken : () => null;
    if (!tokenFn()) return;
    const hubUrl = (typeof CONFIG !== 'undefined' && CONFIG.crmSignalRHubUrl)
        ? CONFIG.crmSignalRHubUrl
        : null;
    if (!hubUrl) return;

    _leadsHubConnection = new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, { accessTokenFactory: tokenFn })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    _leadsHubConnection.on('NewLeadReceived', (lead) => {
        _pendingNewLeadCount++;
        renderPendingLeadsBanner(lead);
    });

    // Help-request banner — driven by per-user events. The hub adds the
    // current user to a `user_<tenantId>_<userId>` group on connect, so only
    // the chosen recipient sees Raised; only the original requester sees
    // Resolved/Cancelled. We refresh the banner count on any of them, and
    // ALSO re-run the list+stats query when the user is currently sitting
    // on the "Help requested" pseudo-filter — otherwise the row that just
    // resolved/cancelled would linger as a stale entry until the user
    // toggles the filter or hits refresh.
    const refresh = () => {
        if (typeof window.refreshHelpInboxBanner === 'function') {
            window.refreshHelpInboxBanner();
        }
        const currentStatus = filterStatusDropdown
            ? filterStatusDropdown.getValue()
            : document.getElementById('filterStatus')?.value;
        if (currentStatus === 'help_requested') {
            loadLeads();
            loadLeadStats();
        }
    };
    _leadsHubConnection.on('HelpRequestRaised', refresh);
    _leadsHubConnection.on('HelpRequestResolved', refresh);
    _leadsHubConnection.on('HelpRequestCancelled', refresh);

    // Expose the connection on the window so sibling modules (calls.js,
    // future telephony) can subscribe to CrmHub events without duplicating
    // the SignalR setup. Each module guards itself with a one-shot bound
    // flag so re-subscriptions don't fan out.
    window._crmHubConnection = _leadsHubConnection;

    try {
        await _leadsHubConnection.start();
    } catch (e) {
        // Transient on page load or if hub is down; withAutomaticReconnect handles retries.
        console.warn('Leads SignalR: failed to connect', e?.message || e);
    }
}

function renderPendingLeadsBanner(sampleLead) {
    const banner = document.getElementById('leadsRealtimeBanner');
    const text = document.getElementById('leadsRealtimeBannerText');
    if (!banner || !text) return;
    const n = _pendingNewLeadCount;
    if (n === 1) {
        const name = `${sampleLead?.first_name || ''} ${sampleLead?.last_name || ''}`.trim();
        text.textContent = name
            ? `New lead: ${name} — click to refresh`
            : `1 new lead — click to refresh`;
    } else {
        text.textContent = `${n} new leads — click to refresh`;
    }
    banner.hidden = false;
}

// Invoked when the user clicks the banner. Safe because it's their opt-in.
// Bound from HTML onclick=, so it must be a plain (non-module) function.
function applyPendingLeads() {
    _pendingNewLeadCount = 0;
    const banner = document.getElementById('leadsRealtimeBanner');
    if (banner) banner.hidden = true;
    loadLeads();
    loadLeadStats();
}

async function loadMyRole() {
    try {
        const user = api.getUser();
        if (user?.roles?.includes('CRM_ADMIN') || user?.roles?.includes('SUPERADMIN')) {
            myTeamRole = 'admin';
        } else {
            const res = await api.request('/crm/leads/my-role');
            myTeamRole = res.role || 'member';
        }
    } catch { myTeamRole = 'member'; }
    // Other modules (e.g. lead-journey.js help-request flow) read this to
    // decide whether to show role-gated affordances. Re-export on each load
    // so the value reflects the current login.
    window.myTeamRole = myTeamRole;
    // Hide admin-only buttons for members
    if (!canDeleteLead()) {
        const bulkDelBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDelBtn) bulkDelBtn.style.display = 'none';
    }
    if (myTeamRole === 'member') {
        ['discoverLeadsBtn', 'importLeadsBtn', 'newLeadBtn', 'pendingTransfersBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }
}

function canDeleteLead() {
    return ['admin', 'manager', 'teamlead'].includes(myTeamRole);
}

// ==================== Data Loading ====================

/**
 * Load leads from the API with optional filters
 */
async function loadLeads(page) {
    if (page) currentPage = page;
    const seq = ++_loadLeadsSeq;
    try {
        const params = buildFilterParams();
        params.set('page', currentPage);
        params.set('pageSize', pageSize);
        const queryString = params.toString();
        const endpoint = `/crm/leads${queryString ? '?' + queryString : ''}`;

        const response = await api.request(endpoint);
        // A newer loadLeads() superseded this one while we were awaiting —
        // discard this (stale) response so it can't clobber the latest view.
        if (seq !== _loadLeadsSeq) return;
        allLeads = response.data || [];
        totalLeads = response.total || allLeads.length;
        // Cache every row we touch so bulk actions retain rich lead data
        // even if the user paginates away before acting on their selection.
        for (const l of allLeads) selectedLeadsData.set(l.id, l);
        renderLeadsTable(allLeads);
        renderPagination();
    } catch (error) {
        if (seq !== _loadLeadsSeq) return; // stale failure — don't blank the latest view
        console.error('Failed to load leads:', error);
        allLeads = [];
        totalLeads = 0;
        renderLeadsTable([]);
        renderPagination();
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to load leads');
        }
    }
}

// ==================== Excel export ====================
//
// One-click .xlsx of every lead matching the *currently applied filters*
// (search, source, date range, status, engagement, campaign, team, owner,
// plus tenant-defined custom-field filters). Columns are the visible table
// columns plus a column for every tenant-defined lead-field that's either
// in `show_in_leads_table` OR has a value selected in the filter bar — so
// the spreadsheet stays self-describing when a client opens it later
// without remembering which filter they ran.
//
// SheetJS loads lazily on first click so the leads page doesn't pay for
// the 100kb library on every cold load.

let _xlsxLoading = null;
function ensureSheetJsLoaded() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    if (_xlsxLoading) return _xlsxLoading;
    _xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
        s.onload = () => resolve();
        s.onerror = () => { _xlsxLoading = null; reject(new Error('Failed to load XLSX library')); };
        document.head.appendChild(s);
    });
    return _xlsxLoading;
}

function _parseLeadCustomFields(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; }
    catch { return {}; }
}

function _resolveCustomFieldLabel(fieldCode, rawValue) {
    if (rawValue == null || rawValue === '') return '';
    const def = (typeof window.getLeadFieldDef === 'function') ? window.getLeadFieldDef(fieldCode) : null;
    if (!def || !Array.isArray(def.options)) return String(rawValue);
    const opt = def.options.find(o => o.code === rawValue || o.code === String(rawValue));
    return opt ? opt.label : String(rawValue);
}

function _fmtCsvDate(s) {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

async function exportLeadsToExcel() {
    const btn = document.getElementById('exportLeadsBtn');
    const label = document.getElementById('exportLeadsBtnLabel');
    const origText = label ? label.textContent : '';
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Preparing…';

    try {
        await ensureSheetJsLoaded();

        // 1. Reuse the live filter state — list endpoint already supports
        //    every filter the UI exposes, so the export shows EXACTLY the
        //    same rows the table is currently showing (just unpaginated).
        const baseParams = buildFilterParams();
        baseParams.delete('page');
        baseParams.delete('pageSize');

        // 2. Pull every matching row. Pull in chunks rather than one giant
        //    query so a tenant with 50k leads doesn't time out the request.
        const CHUNK = 500;
        const allRows = [];
        let page = 1;
        let total = Infinity;
        while (allRows.length < total) {
            const p = new URLSearchParams(baseParams);
            p.set('page', String(page));
            p.set('pageSize', String(CHUNK));
            const resp = await api.request('/crm/leads?' + p.toString());
            const rows = resp?.data || [];
            total = resp?.total || allRows.length + rows.length;
            if (rows.length === 0) break;
            allRows.push(...rows);
            if (label) label.textContent = `Preparing… ${allRows.length}/${total}`;
            page += 1;
            if (page > 200) break;  // hard ceiling — 100k rows is way past Excel friendly anyway
        }

        if (allRows.length === 0) {
            if (typeof Toast !== 'undefined') Toast.warning('No rows to export with the current filters');
            return;
        }

        // 3. Decide which custom-field columns to include. Two sources:
        //    (a) lead-fields the tenant has marked show_in_leads_table — same
        //        columns visible in the table (so what you see is what you
        //        get); (b) any lead-field the user is currently FILTERING by
        //        — even if it's not in the table, the filter context belongs
        //        in the sheet so the export remains self-describing.
        const tableFields = (typeof window.getLeadFieldColumnDefs === 'function')
            ? window.getLeadFieldColumnDefs() : [];
        const tableFieldCodes = tableFields.map(f => f.id.replace(/^lf_/, ''));
        const filterValues = (typeof window.getLeadFieldsFilter === 'function')
            ? (window.getLeadFieldsFilter() || {}) : {};
        const filteredCodes = Object.keys(filterValues);
        const customCodes = Array.from(new Set([...tableFieldCodes, ...filteredCodes]));
        const customDefs = customCodes
            .map(code => ({ code, def: (typeof window.getLeadFieldDef === 'function') ? window.getLeadFieldDef(code) : null }))
            .filter(x => x.def)
            .map(x => ({ code: x.code, label: x.def.label || x.code }));

        // 3.5. Bulk-fetch all activity summaries for the exported leads so
        // the sheet carries the FULL call/note history per lead, not just
        // the most recent one — reps were copying summaries into the
        // exported sheet by hand, then asking "why doesn't the export
        // include all of them?". Batched at the backend's 500-id cap.
        if (label) label.textContent = `Preparing… summaries 0/${allRows.length}`;
        const summariesById = new Map();
        const ALL_IDS = allRows.map(l => l.id).filter(Boolean);
        const SUMMARY_BATCH = 500;
        for (let i = 0; i < ALL_IDS.length; i += SUMMARY_BATCH) {
            const slice = ALL_IDS.slice(i, i + SUMMARY_BATCH);
            try {
                const resp = await api.request('/crm/leads/all-summaries', {
                    method: 'POST',
                    body: JSON.stringify({ lead_ids: slice })
                });
                const map = resp?.summaries || {};
                for (const [leadId, text] of Object.entries(map)) {
                    if (typeof text === 'string' && text.length > 0) summariesById.set(leadId, text);
                }
            } catch (e) {
                // Summary fetch shouldn't kill the whole export — log and
                // continue so the rep still gets the basic columns. The
                // affected leads will just have an empty Call Summaries cell.
                console.warn('[leads-export] summaries batch failed', e);
            }
            if (label) label.textContent = `Preparing… summaries ${Math.min(i + SUMMARY_BATCH, ALL_IDS.length)}/${ALL_IDS.length}`;
        }

        // 4. Header row.
        const headers = [
            'Lead ID', 'Created', 'First Name', 'Last Name', 'Email', 'Phone',
            'Company', 'Job Title', 'Source', 'Team', 'Owner', 'Status',
            'City', 'State', 'Country', 'Tags',
            ...customDefs.map(c => c.label),
            'Call Summaries'
        ];

        // 5. Body rows.
        const body = allRows.map(lead => {
            const cf = _parseLeadCustomFields(lead.custom_fields);
            const base = [
                lead.lead_number || lead.leadNumber || '',
                _fmtCsvDate(lead.created_at || lead.createdAt),
                lead.first_name || lead.firstName || '',
                lead.last_name || lead.lastName || '',
                lead.email || '',
                lead.phone || '',
                lead.company_name || lead.companyName || lead.company || '',
                lead.job_title || lead.jobTitle || '',
                lead.lead_source || lead.leadSource || '',
                lead.team_name || lead.teamName || '',
                lead.ownerName || lead.owner_name || '',
                lead.status || '',
                lead.city || '',
                lead.state || '',
                lead.country || '',
                Array.isArray(lead.tags) ? lead.tags.join(', ') : ''
            ];
            for (const c of customDefs) base.push(_resolveCustomFieldLabel(c.code, cf[c.code]));
            // Call Summaries — full chronology, newest first, date-prefixed.
            // Empty string when the lead has no call/note rows yet.
            base.push(summariesById.get(lead.id) || '');
            return base;
        });

        // 6. Build workbook with sensible column widths. The Call Summaries
        // column (last one) carries multi-line text — bump its width to 80
        // chars so it stays readable when the user enables wrap-text.
        const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
        const SUMMARIES_COL_IDX = headers.length - 1;
        ws['!cols'] = headers.map((h, i) => {
            if (i === SUMMARIES_COL_IDX) return { wch: 80 };
            return { wch: Math.max(12, Math.min(40, h.length + 4)) };
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Leads');

        const today = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `leads-${today}.xlsx`);

        if (typeof Toast !== 'undefined') Toast.success(`Exported ${allRows.length} lead${allRows.length === 1 ? '' : 's'}`);
    } catch (err) {
        console.error('[leads-export] failed:', err);
        if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to export leads');
    } finally {
        if (btn) btn.disabled = false;
        if (label) label.textContent = origText || 'Export Excel';
    }
}
window.exportLeadsToExcel = exportLeadsToExcel;

/**
 * Load lead statistics. Mirrors the same filter set the leads list sends so
 * the KPI cards (Total / New / Qualified / Converted) stay in sync with the
 * filtered table — previously cards stayed frozen at tenant-wide totals
 * regardless of which filter was applied.
 */
/**
 * Single helper every mutation handler calls so the table + KPI cards
 * always reload in lockstep. Without this, every new mutation site has a
 * fresh chance to forget the stats reload (which is exactly how we ended
 * up with KPIs frozen at the pre-mutation totals after bulk-assign).
 */
function refreshLeadView() {
    loadLeads();
    loadLeadStats();
}

// ── Pipeline Flow band ──────────────────────────────────────────────────────
// The stats endpoint honours the current filter set, so the flow bar is a live
// picture of exactly the universe the table is showing. Clicking a segment
// filters the list to that status; clicking the active segment clears it.
const _LP_FLOW_STAGES = [
    { key: 'new_leads', status: 'new', label: 'New', color: '#3b82f6' },
    { key: 'assigned', status: 'assigned', label: 'Assigned', color: '#6366f1' },
    { key: 'contacted', status: 'contacted', label: 'Contacted', color: '#eab308' },
    { key: 'qualified', status: 'qualified', label: 'Qualified', color: '#22c55e' },
    { key: 'unqualified', status: 'unqualified', label: 'Unqualified', color: '#9ca3af' },
    { key: 'converted', status: 'converted', label: 'Converted', color: '#8b5cf6' },
];

function lpFilterByStatus(status) {
    const el = document.getElementById('filterStatus');
    if (!el) return;
    _exitSearchScopeAll();
    const wrapper = (typeof _sdWrapperFor === 'function') ? _sdWrapperFor('filterStatus') : null;
    const current = wrapper && typeof wrapper.getValue === 'function' ? wrapper.getValue() : el.value;
    const next = current === status ? '' : status;   // toggle off when re-clicked
    el.value = next;
    if (wrapper && typeof wrapper.setValue === 'function') wrapper.setValue(next, false);
    applyFilters();
}

async function loadLeadStats() {
    try {
        // Tabs, hairline and the appbar total always show the GLOBAL universe —
        // never the filtered one. Otherwise activating any tab collapses every
        // other tab's count to 0 and the page reads as "no data anywhere".
        const stats = await api.request('/crm/leads/stats');
        renderPipelineFlow(stats);
    } catch (error) {
        console.error('Failed to load lead stats:', error);
    }
}

const _LDK_TABS = [
    { label: 'All', status: '', key: 'total_leads' },
    { label: 'Unworked new', status: 'new', key: 'new_leads' },
    { label: 'My follow-ups', status: 'follow_up_scheduled', key: null, flame: true },
    { label: 'Contacted', status: 'contacted', key: 'contacted' },
    { label: 'Qualified', status: 'qualified', key: 'qualified' },
    { label: 'Converted', status: 'converted', key: 'converted' },
];

function renderPipelineFlow(stats) {
    const numEl = document.getElementById('lpTotalNum');
    const bar = document.getElementById('lpFlowBar');
    const tabsEl = document.getElementById('ldkTabs');

    const total = stats.total_leads ?? 0;
    if (numEl) numEl.textContent = total.toLocaleString('en-IN');

    const statusEl = document.getElementById('filterStatus');
    const wrapper = (typeof _sdWrapperFor === 'function') ? _sdWrapperFor('filterStatus') : null;
    const activeStatus = wrapper && typeof wrapper.getValue === 'function' ? wrapper.getValue() : (statusEl?.value || '');

    if (tabsEl) {
        tabsEl.innerHTML = _LDK_TABS.map(t => {
            const active = (activeStatus || '') === t.status ? ' active' : '';
            const count = t.key != null ? (stats[t.key] ?? 0) : null;
            return `<button type="button" class="ldk-vtab${active}" onclick="lpFilterByStatus('${t.status}')">` +
                   `${t.flame ? '<span class="ldk-flame">⚑</span>' : ''}${t.label}` +
                   `${count != null ? ` <b>${count}</b>` : ''}</button>`;
        }).join('');
    }

    if (bar) {
        const stages = _LP_FLOW_STAGES.map(s => ({ ...s, count: stats[s.key] ?? 0 })).filter(s => s.count > 0);
        const sum = stages.reduce((a, s) => a + s.count, 0);
        bar.classList.toggle('has-active', !!activeStatus);
        bar.innerHTML = stages.map(s => {
            const pct = Math.max((s.count / sum) * 100, 0.6);
            const active = activeStatus === s.status ? ' active' : '';
            return `<i class="lp-flow-seg${active}" style="flex-basis:${pct}%;background:${s.color}"
                        title="${s.label}: ${s.count}"></i>`;
        }).join('');
    }
}

// 14-day capture skyline in the hero's total block. Unfiltered on purpose —
// it answers "is the top of the funnel flowing?", not "what am I looking at".
async function loadCaptureSkyline() {
    const host = document.getElementById('lpCapture');
    if (!host) return;
    try {
        const resp = await api.request('/crm/leads?page=1&pageSize=50&sortBy=created&sortDir=desc');
        const rows = Array.isArray(resp) ? resp : (resp?.data ?? []);
        const DAYS = 14;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const start = new Date(today); start.setDate(today.getDate() - (DAYS - 1));
        const buckets = new Array(DAYS).fill(0);
        let week = 0;
        rows.forEach(l => {
            if (!l.created_at) return;
            const d = new Date(l.created_at); d.setHours(0, 0, 0, 0);
            const idx = Math.round((d - start) / 86400000);
            if (idx >= 0 && idx < DAYS) buckets[idx]++;
            if ((today - d) / 86400000 < 7) week++;
        });
        const max = Math.max(...buckets, 1);
        host.innerHTML = buckets.map(v =>
            `<i style="height:${Math.max((v / max) * 100, 6)}%" class="${v > 0 ? 'on' : ''}"></i>`).join('') +
            `<span>${week > 0 ? '+' + week + ' this week' : 'none this week'}</span>`;
    } catch (e) { host.innerHTML = ''; }
}

/**
 * Load distinct lead sources from API and populate the source filter dropdown
 */
async function loadSourceFilter() {
    // Prefer the tenant's named lead_source rows — tenants connecting
    // multiple ad sheets/forms want to slice by specific campaign
    // ("Software Dev Q2") rather than the coarse source_type string
    // ("google_sheets"). Each <option value> is a lead_source UUID;
    // buildFilterParams sends it as `leadSourceId`. Falls back to the
    // distinct-strings endpoint if /lead-sources is unavailable so the
    // filter never silently breaks.
    const sel = document.getElementById('filterSource');
    if (!sel) { _markRestoreSourceDone('source'); return; }
    const allOpt = sel.querySelector('option[value=""]');
    sel.innerHTML = '';
    if (allOpt) sel.appendChild(allOpt);
    else {
        const o = document.createElement('option');
        o.value = ''; o.textContent = 'All Sources';
        sel.appendChild(o);
    }

    try {
        // api.js strips the `/crm` prefix and routes to crmApiBaseUrl (which
        // already includes `/api`), so this hits `<crm>/api/lead-sources`.
        const resp = await api.request('/crm/lead-sources');
        const rows = (resp?.items || resp?.data || resp || []);
        const list = Array.isArray(rows) ? rows : [];
        // Newest first — same as the Settings card ordering.
        list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        list.forEach(s => {
            if (!s?.id || !s?.source_name) return;
            const o = document.createElement('option');
            o.value = s.id;
            const type = s.source_type ? ` · ${s.source_type}` : '';
            o.textContent = `${s.source_name}${type}`;
            sel.appendChild(o);
        });

        // Append Manual / Bulk-Import pseudo-options — only when the tenant
        // actually has rows in those buckets. Sentinels `__manual__` /
        // `__imported__` are translated by buildFilterParams into the
        // noSourceBucket query param.
        try {
            const buckets = await api.request('/crm/leads/no-source-bucket-counts');
            if (buckets?.manual > 0) {
                const o = document.createElement('option');
                o.value = '__manual__';
                o.textContent = `Manual (${buckets.manual})`;
                sel.appendChild(o);
            }
            if (buckets?.imported > 0) {
                const o = document.createElement('option');
                o.value = '__imported__';
                o.textContent = `Bulk Import (${buckets.imported})`;
                sel.appendChild(o);
            }
        } catch (bucketErr) {
            // Bucket-counts endpoint failure shouldn't break the whole filter —
            // the named-source list above is still valid. Just log and move on.
            console.warn('no-source-bucket-counts unavailable:', bucketErr?.message || bucketErr);
        }
    } catch (e) {
        // Graceful fallback: the old /leads/sources endpoint returns distinct
        // source_type strings. Worse filter but keeps the page usable.
        try {
            const legacy = await api.request('/crm/leads/sources');
            (legacy || []).forEach(s => {
                const o = document.createElement('option');
                o.value = '__legacy:' + s;
                o.textContent = s;
                sel.appendChild(o);
            });
        } catch { /* silent */ }
        console.warn('Using legacy source filter:', e?.message || e);
    }

    // Re-apply any saved Source selection now that the options exist, then
    // re-fetch leads if the restore actually changed the value. Rebuild
    // the SearchableDropdown wrapper afterwards so its visible label
    // matches the restored value.
    _restoreAndApplyIfChanged();
    if (filterSourceDropdown && typeof filterSourceDropdown.rebuild === 'function') {
        filterSourceDropdown.rebuild();
    }
    _markRestoreSourceDone('source');
}

// ==================== Filter Handling ====================

/**
 * Build query params from filter inputs
 */
function buildFilterParams() {
    const params = new URLSearchParams();
    // Search-scope escape hatch: when the search-box toggle is set to
    // "all leads", strip every narrowing filter so the rep can find a
    // specific lead they know exists without first having to clear
    // whatever filters their view is in. The filter widgets still hold
    // their values (they'll resume on toggle-off) — we just don't send
    // them this round. Search text itself is the ONLY narrowing the
    // backend receives in this mode.
    if (_isSearchScopeAll()) {
        const search = document.getElementById('filterSearch')?.value?.trim();
        if (search) params.set('search', search);
        return params;
    }
    const status = filterStatusDropdown ? filterStatusDropdown.getValue() : document.getElementById('filterStatus').value;
    const source = filterSourceDropdown ? filterSourceDropdown.getValue() : document.getElementById('filterSource').value;
    const search = document.getElementById('filterSearch').value.trim();
    const emailStatusEl = document.getElementById('filterEmailStatus');
    const emailStatus = emailStatusEl ? emailStatusEl.value : '';
    const campaignEl = document.getElementById('filterCampaign');
    const campaignId = campaignEl ? campaignEl.value : '';

    // The dropdown's "Follow up scheduled" option is a pseudo-status — it's
    // really a date filter on next_followup_date. Translate it here instead
    // of sending status=follow_up_scheduled (the DB constraint would reject
    // any matching write, and the WHERE clause would always return zero
    // rows). The visible follow-up indicator on each lead row is also
    // driven by next_followup_date, so this matches what users see.
    if (status === 'follow_up_scheduled') {
        params.set('hasFollowup', 'true');
    } else if (status === 'help_requested') {
        // Pseudo-status: backend filters via WHERE EXISTS lead_help_requests.
        // 'me' is the friendly token; controller resolves it to the caller's
        // user id so the same filter works for both requester and recipient.
        params.set('hasHelp', 'me');
    } else if (status) {
        params.set('status', status);
    }
    if (source) {
        // New filter: option values are lead_source UUIDs. Legacy filter
        // (fallback when /lead-sources is down) prefixes with "__legacy:"
        // so we can still send the old source= string param.
        // Pseudo-buckets `__manual__` / `__imported__` map to the
        // backend's noSourceBucket param — narrow to leads that have no
        // tenant-named source row but were entered manually or imported
        // via CSV. Mutually exclusive with leadSourceId.
        if (source.startsWith('__legacy:'))      params.set('source', source.slice('__legacy:'.length));
        else if (source === '__manual__')        params.set('noSourceBucket', 'manual');
        else if (source === '__imported__')      params.set('noSourceBucket', 'imported');
        else                                      params.set('leadSourceId', source);
    }
    if (search) params.set('search', search);
    if (emailStatus) params.set('emailStatus', emailStatus);
    if (campaignId) params.set('campaignId', campaignId);

    // Created-date range. Either endpoint optional — empty = no bound.
    // Format: YYYY-MM-DD (date input native value). Backend converts to a
    // half-open interval [from 00:00, to+1day 00:00) so a same-day filter
    // (from=to=2026-05-09) matches leads created any time on that day.
    const dateFromEl = document.getElementById('filterDateFrom');
    const dateToEl = document.getElementById('filterDateTo');
    if (dateFromEl && dateFromEl.value) params.set('createdFrom', dateFromEl.value);
    if (dateToEl && dateToEl.value) params.set('createdTo', dateToEl.value);
    // dateMode: which column the from/to range filters on. 'created' (default)
    // = lead.created_at; 'activity' = activities.performed_at; 'followup' =
    // lead.next_followup_date (pair with Follow-up scheduled); 'ai_summary' =
    // lead_call_transcripts.summarized_at (pair with AI summary); 'help' =
    // lead_help_requests.created_at (pair with Help requested); 'email_engagement' =
    // email_engagement_events.event_at (pair with an emailStatus pick).
    const dateModeEl = document.getElementById('filterDateMode');
    const ALLOWED_DATE_MODES = ['activity', 'followup', 'ai_summary', 'help', 'email_engagement'];
    let dateModeWire = dateModeEl && ALLOWED_DATE_MODES.includes(dateModeEl.value) ? dateModeEl.value : null;
    // Quality-of-life auto-coerce: when a pseudo-status toggle is active AND
    // a date range is set AND the user left the mode on the default 'created'
    // pick, route the date to the timestamp that matches the toggle. Without
    // this the date silently lands on lead.created_at and usually returns 0.
    const dateRangeActive = !!((dateFromEl && dateFromEl.value) || (dateToEl && dateToEl.value));
    if (!dateModeWire && dateRangeActive && (!dateModeEl || dateModeEl.value === 'created' || !dateModeEl.value)) {
        if (status === 'follow_up_scheduled') dateModeWire = 'followup';
        else if (status === 'help_requested') dateModeWire = 'help';
        else if (status === 'ai_summary') dateModeWire = 'ai_summary';
        else if (emailStatus) dateModeWire = 'email_engagement';
    }
    if (dateModeWire) params.set('dateMode', dateModeWire);
    // Keep the "<x> to" label in sync with the mode dropdown so both ends of
    // the range tell the same story.
    const toLabel = document.getElementById('filterDateModeLabelTo');
    if (toLabel && dateModeEl) {
        const labels = {
            activity: 'Activity', followup: 'Follow-up', ai_summary: 'AI summary',
            help: 'Help request', email_engagement: 'Email event',
        };
        toLabel.textContent = labels[dateModeEl.value] || 'Created';
    }

    // Multi-team scope: when the user has picked a specific team, backend
    // narrows leads to that team (manager/TL sees all, member sees own).
    const teamEl = document.getElementById('filterTeam');
    if (teamEl && teamEl.value) params.set('teamId', teamEl.value);

    // Owner filter: privileged caller (admin/manager/TL) can narrow to one
    // specific salesperson's leads — used to isolate a departing member's
    // pipeline before bulk-reassign.
    const ownerEl = document.getElementById('filterOwner');
    if (ownerEl && ownerEl.value) {
        // "Unassigned" sentinel maps to backend's owner_user_id IS NULL
        // predicate (DatabaseLayer_Leads.GetLeadsPagedAsync handles the
        // sentinel directly). Previously this branch silently dropped the
        // filter, making "Unassigned" behave like "Any owner" — same lead
        // would show under both, which is the bug we're closing here.
        params.set('ownerUserId', ownerEl.value);
    }

    // Form-answer filter — owned by the shared FormAnswersFilter module.
    // Only meaningful when a single non-legacy source is picked (the
    // module also enforces this on the button-state side). Serialised
    // as JSON so AND-across-keys / IN-within-values survive the URL.
    //
    // Tenant-defined dropdown filters (Settings → Lead Fields) merge into
    // the same customFields param. They're tenant-wide so they apply
    // regardless of source. Backend allows keys from either allowlist.
    const merged = {};
    if (source && !source.startsWith('__legacy:')) {
        const fa = (typeof FormAnswersFilter !== 'undefined') ? FormAnswersFilter.getFilter() : null;
        if (fa) Object.assign(merged, fa);
    }
    if (typeof window.getLeadFieldsFilter === 'function') {
        const lf = window.getLeadFieldsFilter();
        if (lf) Object.assign(merged, lf);
    }
    if (Object.keys(merged).length > 0) params.set('customFields', JSON.stringify(merged));

    // Built-in pseudo-filters (Type / Outcome / Disposition) added via the
    // +Add filter popover. Each maps to a dedicated query param the backend
    // resolves with an EXISTS against `activities` (type/outcome) or a direct
    // column read (`leads.disposition`).
    if (typeof window.getLeadFieldsBuiltinFilters === 'function') {
        const builtins = window.getLeadFieldsBuiltinFilters();
        for (const [key, val] of Object.entries(builtins)) {
            if (val) params.set(key, val);
        }
    }

    // Header sort (Created column). Backend: sortBy=created|activity,
    // sortDir=asc|desc; ignored server-side when hasFollowup=true.
    if (_leadsSortDir) { params.set('sortBy', _leadsSortBy); params.set('sortDir', _leadsSortDir); }

    _updateFiltersActiveCount(params);
    return params;
}

// ==================== Header sort + collapsible filter rows ====================
let _leadsSortBy = 'created';
let _leadsSortDir = '';   // '' = backend default (created desc)

function toggleLeadsSort(col) {
    _leadsSortBy = col;
    _leadsSortDir = _leadsSortDir === '' ? 'asc' : (_leadsSortDir === 'asc' ? 'desc' : '');
    const ind = document.getElementById('sortIndCreated');
    if (ind) ind.textContent = _leadsSortDir === 'asc' ? '▲' : (_leadsSortDir === 'desc' ? '▼' : '');
    loadLeads(1);
}

// The widget panel is a summoned popover — closed by default; the chip strip
// in the toolbar carries the filter state at a glance.
function toggleLeadsFiltersPanel() {
    const panel = document.getElementById('leadsFiltersPanel');
    if (!panel) return;
    const open = panel.classList.toggle('open');
    const btn = document.getElementById('filtersToggleBtn');
    if (btn) btn.classList.toggle('active', open);
}

function _restoreFiltersPanelState() {
    // Escape closes the panel (portal'd date/select popovers make an
    // outside-click closer unreliable, so Esc + Done + toggle are the exits).
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('leadsFiltersPanel')?.classList.remove('open');
            document.getElementById('filtersToggleBtn')?.classList.remove('active');
        }
    });
}

// Badge on the Filters button = how many narrowing params are active, so a
// closed panel can never silently hide why the list looks short.
function _updateFiltersActiveCount(params) {
    const el = document.getElementById('filtersActiveCount');
    if (el) {
        const ignore = new Set(['page', 'pageSize', 'search', 'sortBy', 'sortDir', 'dateMode']);
        let n = 0;
        for (const [k] of params.entries()) { if (!ignore.has(k)) n++; }
        el.textContent = n;
        el.style.display = n > 0 ? '' : 'none';
    }
    renderActiveFilterChips();
}

// ── Active-filter chips: each narrowing widget with a value becomes a
// removable "Label · Value ×" token in the toolbar. Removal reuses the exact
// clearAllFilters per-widget recipe (flatpickr.clear / wrapper.setValue).
const _LP_CHIP_SELECTS = [
    { id: 'filterSource', label: 'Source' },
    { id: 'filterStatus', label: 'Status' },
    { id: 'filterTeam', label: 'Team' },
    { id: 'filterOwner', label: 'Owner' },
    { id: 'filterEmailStatus', label: 'Email' },
    { id: 'filterCampaign', label: 'Campaign' },
];

function _lpSelectedText(el, value) {
    const opt = [...el.options].find(o => o.value === value);
    return opt ? opt.textContent.trim() : value;
}

function clearOneLeadFilter(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el._flatpickr && typeof el._flatpickr.clear === 'function') el._flatpickr.clear();
    else el.value = '';
    const wrapper = (typeof _sdWrapperFor === 'function') ? _sdWrapperFor(id) : null;
    if (wrapper && typeof wrapper.setValue === 'function') wrapper.setValue('', false);
    applyFilters();
}

function clearLeadDateFilter() {
    ['filterDateFrom', 'filterDateTo'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el._flatpickr && typeof el._flatpickr.clear === 'function') el._flatpickr.clear();
        else el.value = '';
    });
    applyFilters();
}

function clearLeadCustomFilters() {
    if (typeof window.setLeadFieldsFilterValues === 'function') window.setLeadFieldsFilterValues({});
    if (typeof FormAnswersFilter !== 'undefined' && typeof FormAnswersFilter.reset === 'function') FormAnswersFilter.reset();
    applyFilters();
}

function renderActiveFilterChips() {
    const host = document.getElementById('lpActiveChips');
    if (!host) return;
    if (_isSearchScopeAll()) { host.innerHTML = ''; return; }

    const chips = [];
    const chip = (label, valueText, clearCall) =>
        `<span class="lp-chip"><i>${escapeHtml(label)}</i>${escapeHtml(valueText)}` +
        `<button type="button" onclick="${clearCall}" aria-label="Remove ${escapeHtml(label)} filter">×</button></span>`;

    for (const def of _LP_CHIP_SELECTS) {
        const el = document.getElementById(def.id);
        if (!el) continue;
        const wrapper = (typeof _sdWrapperFor === 'function') ? _sdWrapperFor(def.id) : null;
        const value = wrapper && typeof wrapper.getValue === 'function' ? wrapper.getValue() : el.value;
        if (value) chips.push(chip(def.label, _lpSelectedText(el, value), `clearOneLeadFilter('${def.id}')`));
    }

    const from = document.getElementById('filterDateFrom')?.value;
    const to = document.getElementById('filterDateTo')?.value;
    if (from || to) {
        const modeEl = document.getElementById('filterDateMode');
        const mode = modeEl ? _lpSelectedText(modeEl, modeEl.value) : 'Created';
        chips.push(chip(mode, [from || '…', to || '…'].join(' → '), 'clearLeadDateFilter()'));
    }

    let customN = 0;
    if (typeof window.getLeadFieldsFilter === 'function') {
        customN += Object.keys(window.getLeadFieldsFilter() || {}).length;
    }
    if (typeof window.getLeadFieldsBuiltinFilters === 'function') {
        customN += Object.values(window.getLeadFieldsBuiltinFilters() || {}).filter(Boolean).length;
    }
    if (typeof FormAnswersFilter !== 'undefined' && typeof FormAnswersFilter.getFilter === 'function') {
        customN += Object.keys(FormAnswersFilter.getFilter() || {}).length;
    }
    if (customN > 0) {
        chips.push(chip('Custom', customN + ' filter' + (customN > 1 ? 's' : ''), 'clearLeadCustomFilters()'));
    }

    host.innerHTML = chips.join('');
}

// ==================== Filter by form answers ====================
//
// All the heavy lifting (state model, lazy loading of question summaries +
// per-question values, sidebar/values-pane rendering, search, pills,
// Cancel-reverts-Apply-commits semantics) lives in the shared module
// js/crm/form-answers-filter.js. This page just wires its hooks into the
// shared controller. The analytics dashboard reuses the same module —
// changing the modal in one place updates both pages.
// Initialise the shared Form-answers controller with this page's hooks.
// Source resolution + apply callback are page-specific; everything else
// is owned by the module.
document.addEventListener('DOMContentLoaded', () => {
    FormAnswersFilter.init({
        getSourceId: () => filterSourceDropdown ? filterSourceDropdown.getValue() : document.getElementById('filterSource')?.value,
        onApply: () => applyFilters()
    });
});

function refreshFormAnswersButtonState() { FormAnswersFilter.refreshButtonState(); }

function onSourceFilterChanged() {
    FormAnswersFilter.reset();
    applyFilters();
}

window.onSourceFilterChanged = onSourceFilterChanged;

// Populate the Campaign filter with the tenant's campaigns. Called once
// on page load; cheap enough that we don't bother caching. Fails soft if
// the API is down — filter just stays with a single "All campaigns" option.
async function loadCampaignFilter() {
    const sel = document.getElementById('filterCampaign');
    if (!sel) { _markRestoreSourceDone('campaign'); return; }
    try {
        const resp = await api.request('/email-campaigns');
        const items = (resp && resp.items) || [];
        // Newest first — matches campaigns list ordering.
        items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        sel.innerHTML = '<option value="">All campaigns</option>' +
            items.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.status})</option>`).join('');
        _restoreAndApplyIfChanged();
    } catch (_) { /* silent fallback */ }
    finally { _markRestoreSourceDone('campaign'); }
}

/**
 * Apply filters and reload leads
 */
function applyFilters() {
    currentPage = 1;
    // Snapshot the current filter widgets to localStorage so a reload or any
    // refresh-triggering action restores the same view. See _persistFilters.
    _persistFilters();
    loadLeads();
    // Re-render tabs/hairline so the active-tab highlight tracks the filter;
    // counts themselves stay global (see loadLeadStats).
    loadLeadStats();
}

// ==================== Table Rendering ====================

/**
 * Render the leads table
 */
function renderLeadsTable(leads) {
    const host = document.getElementById('leadsTableBody');
    if (!host) return;

    const countEl = document.getElementById('ldkListCount');
    if (countEl) countEl.textContent = totalLeads > 0
        ? totalLeads.toLocaleString('en-IN') + ' lead' + (totalLeads !== 1 ? 's' : '')
        : (leads && leads.length ? leads.length + ' leads' : '0 leads');

    if (!leads || leads.length === 0) {
        // Context-aware empty state: a filtered view that came up empty offers
        // "Clear filters"; a genuinely empty book offers the create path.
        // Members can't create leads — they get assigned (matches loadMyRole()).
        const fp = buildFilterParams();
        ['page', 'pageSize', 'sortBy', 'sortDir'].forEach(k => fp.delete(k));
        const hasFilters = [...fp.keys()].length > 0;
        const isMember = myTeamRole === 'member' || myTeamRole === 'none';
        const msg = hasFilters ? 'No leads match this view' : 'No leads yet';
        const cta = hasFilters
            ? `<button class="btn btn-sm btn-secondary" onclick="clearAllFilters()">Clear filters</button>`
            : (isMember
                ? `<p>Leads will appear here once your team lead assigns them to you.</p>`
                : `<button class="btn btn-sm btn-primary" onclick="openNewLeadModal()">Add your first lead</button>`);
        host.innerHTML = `
            <div class="ldk-empty">
                <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/>
                </svg>
                <p>${msg}</p>
                ${cta}
            </div>`;
        return;
    }

    host.innerHTML = leads.map(lead => ldkRow(lead)).join('');

    // Keep the workspace anchored: re-highlight the open lead, or open the
    // first row so the right pane is never a dead placeholder on desktop.
    if (window._leadDetailId) {
        ldkHighlightRow(window._leadDetailId);
    } else if (window.innerWidth > 1023 && !sessionStorage.getItem('crm_openLeadId')) {
        const first = host.querySelector('.ldk-row[data-lead-id]');
        if (first) openLeadDetailPanel(first.getAttribute('data-lead-id'));
    }
}

// One lead = one story row: identity, a computed narrative line, status, age.
function ldkRow(lead) {
    const name = ([lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                  lead.company_name || lead.company || '—');
    const flame = lead.next_followup_date ? '<span class="ldk-flame" title="Follow-up scheduled">⚑</span>' : '';
    const xfer = lead.has_pending_transfer ? '<span class="ldk-xfer" title="Transfer pending approval">⇄</span>' : '';
    const checked = selectedLeadIds.has(lead.id) ? 'checked' : '';
    const sel = window._leadDetailId === lead.id ? ' sel' : '';
    return `
        <div class="ldk-row${sel}" data-lead-id="${lead.id}" onclick="openLeadDetailPanel('${lead.id}')">
            <input type="checkbox" class="lead-checkbox ldk-cb" value="${lead.id}" ${checked}
                onclick="event.stopPropagation()"
                onchange="toggleLeadSelection('${lead.id}', this.checked)">
            <span class="lav" style="background:${leadAvatarBg(lead)}">${escapeHtml(leadInitials(lead))}</span>
            <div class="lmid">
                <div class="lname"><span class="lname-t">${escapeHtml(name)}</span>${flame}${xfer}</div>
                <div class="lsub">${ldkStory(lead)}</div>
            </div>
            <div class="lright">
                <span class="ldk-pill p-${lead.status || 'new'}">${formatStatus(lead.status)}</span>
                <span class="ltime" title="${formatDate(lead.created_at)}">${leadTimeAgo(lead.created_at)}</span>
            </div>
        </div>`;
}

// The narrative line: the most decision-relevant fact about this lead, in
// priority order — due follow-up > disposition + recency > fresh capture >
// ownership recency. Data all comes from the list payload; no extra calls.
function ldkStory(lead) {
    const bits = [];
    if (lead.next_followup_date) {
        const due = new Date(lead.next_followup_date);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dueDay = new Date(due); dueDay.setHours(0, 0, 0, 0);
        const diff = Math.round((dueDay - today) / 86400000);
        const when = diff < 0 ? `overdue ${-diff}d` : diff === 0 ? 'due today' : diff === 1 ? 'due tomorrow' : `due in ${diff}d`;
        bits.push(`<span class="ldk-due${diff <= 0 ? ' hot' : ''}">follow-up ${when}</span>`);
    }
    if (lead.disposition) bits.push(`<span class="ldk-disp">${escapeHtml(formatDisposition(lead.disposition))}</span>`);
    if (bits.length === 0) {
        if ((lead.status || 'new') === 'new') {
            bits.push(`New from ${escapeHtml(formatSource(lead.lead_source))} · never contacted`);
        } else if (lead.status === 'converted') {
            bits.push(`Converted${lead.won_deal_value ? ' · ₹' + Number(lead.won_deal_value).toLocaleString('en-IN') : ''}`);
        } else if (lead.owner_name || lead.ownerName) {
            const owner = lead.owner_name || lead.ownerName;
            const touch = lead.last_interaction_at ? `touched ${leadTimeAgo(lead.last_interaction_at)}` : `untouched since ${leadTimeAgo(lead.created_at)}`;
            bits.push(`With ${escapeHtml(owner.split(' ')[0])} · ${touch}`);
        } else {
            bits.push(`${escapeHtml(formatSource(lead.lead_source))}${lead.last_interaction_at ? ' · touched ' + leadTimeAgo(lead.last_interaction_at) : ''}`);
        }
    } else if (lead.last_interaction_at) {
        bits.push(`touched ${leadTimeAgo(lead.last_interaction_at)}`);
    }
    if (lead.company_name && bits.length < 3) bits.push(escapeHtml(lead.company_name));
    return bits.join(' · ');
}

function ldkHighlightRow(leadId) {
    document.querySelectorAll('.ldk-row.sel').forEach(r => r.classList.remove('sel'));
    document.querySelector(`.ldk-row[data-lead-id="${leadId}"]`)?.classList.add('sel');
}

function ldkToggleMore(ev) {
    ev?.stopPropagation();
    const menu = document.getElementById('ldkMoreMenu');
    if (menu) menu.hidden = !menu.hidden;
}
document.addEventListener('click', (e) => {
    const menu = document.getElementById('ldkMoreMenu');
    if (!menu || menu.hidden) return;
    // Close on outside click AND after choosing any menu item — a menu that
    // stays open floats above whatever modal the item just launched.
    if (!e.target.closest('.ldk-more-wrap') || e.target.closest('#ldkMoreMenu button, #ldkMoreMenu a')) {
        menu.hidden = true;
    }
});

// ==================== Row identity helpers ====================
// Deterministic avatar hue per lead so the same lead always wears the same
// colour across pages and sessions.
const _LEAD_AVATAR_HUES = [212, 262, 158, 24, 330, 190, 48, 288];

function leadInitials(lead) {
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                 lead.company_name || lead.company || '?';
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function leadAvatarBg(lead) {
    const key = String(lead.id || lead.email || lead.phone || 'x');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const hue = _LEAD_AVATAR_HUES[h % _LEAD_AVATAR_HUES.length];
    return `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 28) % 360} 60% 30%))`;
}

function leadTimeAgo(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d)) return '-';
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    const months = Math.floor(days / 30);
    if (months < 12) return months + 'mo ago';
    return Math.floor(months / 12) + 'y ago';
}

// ==================== Column Visibility ====================
// Lets the user hide CRM-table columns they don't care about. Selection
// persists in localStorage so it survives reloads. Five columns stay
// always-on (checkbox, Lead ID, Name, Status, Actions) — hiding them
// would break the core lead workflow (no way to identify a lead, click
// into the detail panel, or take action), so they're absent from the
// picker entirely.

// Single localStorage key for ALL column prefs — hidden + order together.
// `{ hidden: [...colIds], order: { builtin: [...], custom: [...] } }`
// Old keys ('crm_leads_hidden_cols', 'crm_leads_col_order') are read once
// on first load + migrated into the new shape, then we never touch them
// again. Lets us add new prefs (column-width, sticky-cols) without
// proliferating localStorage keys per concern.
const COLUMN_PREFS_KEY = 'crm_leads_columns_v1';
const LEGACY_HIDDEN_KEY = 'crm_leads_hidden_cols';
const LEGACY_ORDER_KEY = 'crm_leads_col_order';
const COLUMN_PICKER_DEFS = [
    { id: 'email',         label: 'Email' },
    { id: 'phone',         label: 'Phone' },
    { id: 'source',        label: 'Source' },
    { id: 'status',        label: 'Status' },
    { id: 'engagement',    label: 'Email engagement' },
    { id: 'team',          label: 'Team' },
    { id: 'owner',         label: 'Owner' },
    { id: 'created',       label: 'Created' },
    { id: 'latestSummary', label: 'Summary' },
];
const TOGGLEABLE_COLS = new Set(COLUMN_PICKER_DEFS.map(c => c.id));

// Read the unified prefs blob, migrating from legacy single-purpose keys
// on first load. Always returns a well-formed { hidden, order } object
// even if storage is empty / corrupt.
function _getColumnPrefs() {
    try {
        const raw = localStorage.getItem(COLUMN_PREFS_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') {
                if (!Array.isArray(obj.hidden)) obj.hidden = [];
                if (!obj.order || typeof obj.order !== 'object') obj.order = {};
                if (!Array.isArray(obj.order.builtin)) obj.order.builtin = [];
                if (!Array.isArray(obj.order.custom))  obj.order.custom = [];
                return obj;
            }
        }
        // Migrate from the two legacy keys used before unification.
        const legacyHidden = (() => {
            try { const r = localStorage.getItem(LEGACY_HIDDEN_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; }
        })();
        const legacyOrder = (() => {
            try { const r = localStorage.getItem(LEGACY_ORDER_KEY); const a = r ? JSON.parse(r) : null; return (a && typeof a === 'object') ? a : { builtin: [], custom: [] }; } catch { return { builtin: [], custom: [] }; }
        })();
        const migrated = {
            hidden: legacyHidden,
            order: {
                builtin: Array.isArray(legacyOrder.builtin) ? legacyOrder.builtin : [],
                custom: Array.isArray(legacyOrder.custom) ? legacyOrder.custom : [],
            },
        };
        localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(migrated));
        try { localStorage.removeItem(LEGACY_HIDDEN_KEY); } catch {}
        try { localStorage.removeItem(LEGACY_ORDER_KEY);  } catch {}
        return migrated;
    } catch {
        return { hidden: [], order: { builtin: [], custom: [] } };
    }
}

function _saveColumnPrefs(prefs) {
    try { localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function getHiddenColumns() {
    const prefs = _getColumnPrefs();
    // Strip non-toggleable cols so a stale entry from an earlier version of
    // the picker can't keep Lead ID/Name hidden. Custom-dropdown columns
    // use the `lf_<fieldcode>` data-col convention and are toggleable too.
    return (prefs.hidden || []).filter(id =>
        TOGGLEABLE_COLS.has(id) || (typeof id === 'string' && id.startsWith('lf_')));
}

function setHiddenColumns(arr) {
    const prefs = _getColumnPrefs();
    prefs.hidden = Array.isArray(arr) ? arr : [];
    _saveColumnPrefs(prefs);
}

function applyColumnVisibility() {
    const hidden = new Set(getHiddenColumns());
    document.querySelectorAll('#leadsTable [data-col]').forEach(el => {
        el.style.display = hidden.has(el.dataset.col) ? 'none' : '';
    });
}

// ─── Column ordering ────────────────────────────────────────────────────
// Reps drag rows in the columns picker to set their preferred order; we
// persist the resulting id array and physically reorder <th>/<td>
// elements after every render. Built-ins and custom fields stay in their
// own sections (the picker UI doesn't allow cross-section drags) but
// inside each group the user's order wins.

function _allOrderableIds() {
    const customDefs = (typeof window.getLeadFieldColumnDefs === 'function')
        ? window.getLeadFieldColumnDefs() : [];
    return {
        builtin: COLUMN_PICKER_DEFS.map(c => c.id),
        custom: customDefs.map(c => c.id),
    };
}

function getColumnOrder() {
    const stored = _getColumnPrefs().order;
    const all = _allOrderableIds();
    // Merge stored order with current defaults so newly-added columns (e.g.
    // tenant just created a custom field) show up at the end of their
    // section instead of vanishing from the picker.
    const merge = (defaults, kind) => {
        const storedKind = Array.isArray(stored[kind]) ? stored[kind] : [];
        const seen = new Set();
        const out = [];
        for (const id of storedKind) {
            if (defaults.includes(id) && !seen.has(id)) { out.push(id); seen.add(id); }
        }
        for (const id of defaults) {
            if (!seen.has(id)) { out.push(id); seen.add(id); }
        }
        return out;
    };
    return {
        builtin: merge(all.builtin, 'builtin'),
        custom:  merge(all.custom,  'custom'),
    };
}

function setColumnOrder(order) {
    const prefs = _getColumnPrefs();
    prefs.order = {
        builtin: Array.isArray(order?.builtin) ? order.builtin : [],
        custom:  Array.isArray(order?.custom)  ? order.custom  : [],
    };
    _saveColumnPrefs(prefs);
}

// Reorder <th> in thead AND every <td> in tbody so the user's preferred
// column order takes effect. Lead-id / Name / Status / Actions columns
// stay where they are (no data-col on Actions; the others stay put because
// we only move the ids that are in the order list).
function applyColumnOrder() {
    const order = getColumnOrder();
    const desired = [...order.builtin, ...order.custom];
    if (!desired.length) return;
    const idIndex = new Map(desired.map((id, i) => [id, i]));

    const reorderRow = (rowEl) => {
        // Collect the cells we control (only those whose data-col is in
        // the desired list). Insert them back in `desired` order, immediately
        // after the LAST cell that's NOT under our control AND whose original
        // position was before the orderable cluster — i.e. anchor after the
        // last unmanaged cell that came before any managed cell.
        const cells = Array.from(rowEl.children);
        const managed = cells.filter(c => c.dataset && c.dataset.col && idIndex.has(c.dataset.col));
        if (managed.length < 2) return;
        const firstManagedIdx = cells.indexOf(managed[0]);
        const lastManagedIdx = cells.indexOf(managed[managed.length - 1]);
        // Sort managed by desired order and re-insert sequentially after
        // the cell immediately before firstManagedIdx (i.e. preserving any
        // unmanaged cell that sits between managed ones — none today, but
        // future-proofs against e.g. a static "score" column wedged in).
        managed.sort((a, b) => idIndex.get(a.dataset.col) - idIndex.get(b.dataset.col));
        const anchor = cells[firstManagedIdx - 1] || null;
        for (let i = managed.length - 1; i >= 0; i--) {
            if (anchor && anchor.nextSibling !== managed[i]) {
                rowEl.insertBefore(managed[i], anchor.nextSibling);
            } else if (!anchor && rowEl.firstChild !== managed[i]) {
                rowEl.insertBefore(managed[i], rowEl.firstChild);
            }
        }
        // Place each subsequent managed cell right after the previous one.
        for (let i = 1; i < managed.length; i++) {
            if (managed[i - 1].nextSibling !== managed[i]) {
                rowEl.insertBefore(managed[i], managed[i - 1].nextSibling);
            }
        }
        void lastManagedIdx; // referenced only for debug intent
    };

    document.querySelectorAll('#leadsTable thead tr').forEach(reorderRow);
    document.querySelectorAll('#leadsTableBody tr[data-lead-id]').forEach(reorderRow);
}

function renderColumnsPickerMenu() {
    const menu = document.getElementById('columnsPickerMenu');
    if (!menu) return;
    const hidden = new Set(getHiddenColumns());
    const order = getColumnOrder();
    const customDefs = (typeof window.getLeadFieldColumnDefs === 'function')
        ? window.getLeadFieldColumnDefs()
        : [];
    const builtinById = Object.fromEntries(COLUMN_PICKER_DEFS.map(c => [c.id, c]));
    const customById  = Object.fromEntries(customDefs.map(c => [c.id, c]));

    // Render in the saved order. Each row is draggable within its section;
    // the data-col-section attribute scopes the drag (built-ins can't be
    // mixed with custom fields).
    const renderItem = (c, section) => `
        <label class="crm-columns-menu-item" draggable="true"
               data-col-id="${c.id}" data-col-section="${section}">
            <span class="crm-columns-drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
            <input type="checkbox" data-col-toggle="${c.id}" ${hidden.has(c.id) ? '' : 'checked'}>
            <span>${c.label}</span>
        </label>
    `;
    const builtinHtml = order.builtin
        .filter(id => builtinById[id])
        .map(id => renderItem(builtinById[id], 'builtin')).join('');
    const customHtml = order.custom
        .filter(id => customById[id])
        .map(id => renderItem(customById[id], 'custom')).join('');

    menu.innerHTML = `
        <div class="crm-columns-menu-header">Visible columns</div>
        ${builtinHtml}
        ${customHtml ? `
            <div class="crm-columns-menu-divider" aria-hidden="true"></div>
            <div class="crm-columns-menu-subhead">Custom fields</div>
            ${customHtml}
        ` : ''}
        <div class="crm-columns-menu-footer" style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:0.7rem; color:var(--text-secondary);">Drag rows to reorder</span>
            <button type="button" class="btn btn-sm btn-link" onclick="resetColumnsPicker()">Reset</button>
        </div>
    `;
    menu.querySelectorAll('input[data-col-toggle]').forEach(cb => {
        cb.addEventListener('change', (e) => {
            // Stop the change from bubbling — without it, the outside-click
            // listener treats the click on the checkbox as "outside the
            // menu" once the drag handler has eaten propagation.
            e.stopPropagation();
            const id = cb.dataset.colToggle;
            const list = getHiddenColumns().filter(x => x !== id);
            if (!cb.checked) list.push(id);
            setHiddenColumns(list);
            applyColumnVisibility();
        });
    });
    _bindColumnsPickerDragDrop(menu);
}

let _draggedColRow = null;
function _bindColumnsPickerDragDrop(menu) {
    menu.querySelectorAll('.crm-columns-menu-item[draggable]').forEach(row => {
        row.addEventListener('dragstart', (e) => {
            _draggedColRow = row;
            row.style.opacity = '0.4';
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.colId); } catch {}
        });
        row.addEventListener('dragend', () => {
            row.style.opacity = '';
            _draggedColRow = null;
            menu.querySelectorAll('.crm-columns-menu-item').forEach(r => r.style.borderTop = '');
        });
        row.addEventListener('dragover', (e) => {
            if (!_draggedColRow || _draggedColRow === row) return;
            // Only allow drop within the same section so the picker UI keeps
            // its built-ins / custom-fields grouping intact.
            if (_draggedColRow.dataset.colSection !== row.dataset.colSection) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // Visual indicator — top-border line on the hovered row.
            menu.querySelectorAll('.crm-columns-menu-item').forEach(r => r.style.borderTop = '');
            row.style.borderTop = '2px solid var(--brand-primary)';
        });
        row.addEventListener('drop', (e) => {
            if (!_draggedColRow || _draggedColRow === row) return;
            if (_draggedColRow.dataset.colSection !== row.dataset.colSection) return;
            e.preventDefault();
            row.parentNode.insertBefore(_draggedColRow, row);
            // Persist the new order from the DOM.
            const section = row.dataset.colSection;
            const order = getColumnOrder();
            const newOrder = Array.from(menu.querySelectorAll(`.crm-columns-menu-item[data-col-section="${section}"]`))
                .map(el => el.dataset.colId);
            order[section] = newOrder;
            setColumnOrder(order);
            applyColumnOrder();
        });
    });
}

function toggleColumnsPicker(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('columnsPickerMenu');
    const btn = document.getElementById('columnsPickerBtn');
    if (!menu) return;
    if (menu.hidden) {
        renderColumnsPickerMenu();
        menu.hidden = false;

        // On mobile the menu's parent (the column-picker filter-group) is
        // only as wide as the button, so CSS-only positioning either flings
        // the menu off-screen or clips it. The menu stays `position:absolute`
        // (so it scrolls with its parent / button — what users expect) but
        // we set inline left/width here so the menu spans the viewport with
        // a 12px inset on each side. Anchor maths: menu.left is in the
        // parent's coordinate space → translate viewport-x=12px back to
        // parent-relative by subtracting the parent's screen-x.
        if (btn && window.matchMedia('(max-width: 768px)').matches) {
            const parent = btn.offsetParent || btn.parentElement;
            const parentRect = parent.getBoundingClientRect();
            // Use documentElement.clientWidth so an OS scrollbar doesn't
            // sneak into the inset calculation. 16px gutter on each side
            // matches the page's container padding so the menu sits inside
            // the same "safe area" as the cards below.
            const inset = 16;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
            menu.style.left = (inset - parentRect.left) + 'px';
            menu.style.right = 'auto';
            menu.style.width = (viewportWidth - inset * 2) + 'px';
            menu.style.top = '';   // CSS handles top via `calc(100% + 6px)`
        } else {
            menu.style.left = '';
            menu.style.right = '';
            menu.style.width = '';
            menu.style.top = '';
        }

        // Close on outside click — bind once per open so we don't pile up listeners.
        setTimeout(() => {
            document.addEventListener('click', closeColumnsPickerOnOutside, { once: true });
        }, 0);
    } else {
        menu.hidden = true;
    }
}

function closeColumnsPickerOnOutside(e) {
    const menu = document.getElementById('columnsPickerMenu');
    const btn = document.getElementById('columnsPickerBtn');
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target) || (btn && btn.contains(e.target))) {
        // Click inside — re-arm the outside-click listener for the next click.
        document.addEventListener('click', closeColumnsPickerOnOutside, { once: true });
        return;
    }
    menu.hidden = true;
}

function resetColumnsPicker() {
    try { localStorage.removeItem(COLUMN_PREFS_KEY); } catch {}
    applyColumnVisibility();
    applyColumnOrder();
    renderColumnsPickerMenu();
}

// Run once on script load so headers reflect saved prefs even before
// the first lead row is rendered.
document.addEventListener('DOMContentLoaded', () => {
    applyColumnVisibility();
    applyColumnOrder();
});

// ==================== Status & Source Formatting ====================

// Pick the FURTHEST engagement stage a lead has reached — replies imply
// clicks imply opens imply sent. Suppressed / bounced are terminal, shown
// even if the lead also had earlier positive signals, because it's the
// most important state to know about for future campaigns.
// Owner column: name + an "inactive" pill when the backend marks
// owner_is_inactive (Auth user is no longer active). The pill is the cue
// for managers to head to the Reassign Queue.
function renderOwnerCell(lead) {
    const hasTeam = lead.team_id || lead.team_name;
    if (!hasTeam) return '<span class="crm-cell-secondary">-</span>';
    const ownerName = lead.ownerName || lead.owner_name;
    const inactive = lead.ownerIsInactive || lead.owner_is_inactive;
    const nameSpan = `<span class="crm-cell-secondary">${escapeHtml(ownerName || '-')}</span>`;
    if (!inactive || !ownerName) return nameSpan;
    return `<div style="display:flex;flex-direction:column;gap:2px;">
        ${nameSpan}
        <span title="This user has been deactivated. Reassign in the Reassign Queue."
              style="display:inline-flex;align-items:center;gap:4px;padding:1px 6px;background:rgba(239,68,68,0.1);color:var(--color-error,#ef4444);border-radius:9999px;font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;align-self:flex-start;">
            <span style="width:5px;height:5px;background:currentColor;border-radius:50%;"></span>
            inactive
        </span>
    </div>`;
}

function renderEmailEngagement(l) {
    const sent = l.emailSentCount ?? l.email_sent_count ?? 0;
    const opened = l.emailOpenedCount ?? l.email_opened_count ?? 0;
    const clicked = l.emailClickedCount ?? l.email_clicked_count ?? 0;
    const replied = l.emailRepliedCount ?? l.email_replied_count ?? 0;
    const bounced = l.emailBouncedCount ?? l.email_bounced_count ?? 0;
    const suppressed = l.isEmailSuppressed ?? l.is_email_suppressed ?? false;

    if (suppressed)   return `<span class="crm-email-engagement stage-unsubscribed"><span class="chip-icon">🚫</span> Unsubscribed</span>`;
    if (bounced > 0)  return `<span class="crm-email-engagement stage-bounced"><span class="chip-icon">⚠</span> Bounced</span>`;
    if (replied > 0)  return `<span class="crm-email-engagement stage-replied"><span class="chip-icon">✉</span> Replied${replied > 1 ? ` ×${replied}` : ''}</span>`;
    if (clicked > 0)  return `<span class="crm-email-engagement stage-clicked"><span class="chip-icon">👆</span> Clicked</span>`;
    if (opened > 0)   return `<span class="crm-email-engagement stage-opened"><span class="chip-icon">👁</span> Opened</span>`;
    if (sent > 0)     return `<span class="crm-email-engagement stage-sent"><span class="chip-icon">📤</span> Sent${sent > 1 ? ` ×${sent}` : ''}</span>`;
    return `<span class="crm-cell-secondary">—</span>`;
}

function formatStatus(status) {
    const labels = {
        'new': 'New',
        'assigned': 'Assigned',
        'contacted': 'Contacted',
        'qualified': 'Qualified',
        'unqualified': 'Unqualified',
        'converted': 'Converted'
    };
    return labels[status] || status || 'New';
}

function formatFollowupIndicator(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fuDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((fuDay - today) / 86400000);

    let cls, label;
    if (diffDays < 0) {
        cls = 'followup-overdue';
        label = `Overdue ${Math.abs(diffDays)}d`;
    } else if (diffDays === 0) {
        cls = 'followup-today';
        label = 'Follow-up today';
    } else if (diffDays === 1) {
        cls = 'followup-soon';
        label = 'Follow-up tomorrow';
    } else {
        cls = 'followup-future';
        label = `Follow-up ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    }
    return `<div class="crm-followup-indicator ${cls}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${label}</div>`;
}

function formatDisposition(disp) {
    const labels = {
        'not_responding': 'Not Responding',
        'not_interested': 'Not Interested',
        'callback_later': 'Callback Later',
        'hot_lead': 'Hot Lead',
        'wrong_number': 'Wrong Number',
        'voicemail': 'Voicemail',
        'email_sent': 'Email Sent',
        'meeting_scheduled': 'Meeting Scheduled',
        'proposal_sent': 'Proposal Sent',
        'deal_in_progress': 'Deal In Progress'
    };
    return labels[disp] || disp || '';
}

function formatSource(source) {
    const labels = {
        'manual': 'Manual',
        'website': 'Website',
        'facebook': 'Facebook',
        'linkedin': 'LinkedIn',
        'referral': 'Referral',
        'google_ads': 'Google Ads',
        'landing_page': 'Landing Page',
        'api': 'API',
        'import': 'Import',
        'other': 'Other'
    };
    return labels[source] || source || 'Manual';
}

function renderPagination() {
    let container = document.getElementById('leadsPagination');
    if (!container) {
        container = document.createElement('div');
        container.id = 'leadsPagination';
        container.className = 'crm-pagination';
        const table = document.getElementById('leadsTableBody')?.closest('table');
        if (table) table.after(container);
    }

    // Row-count selector: always shown so users with >50 leads can switch
    // to 500/1000/5000 per page without re-importing or paging 100 times.
    const sizeOptions = PAGE_SIZE_OPTIONS.map(n =>
        `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n}</option>`
    ).join('');
    const sizeSelector = `
        <label class="crm-pagesize">Rows
            <select onchange="changePageSize(this.value)" class="form-control crm-pagesize-select">
                ${sizeOptions}
            </select>
        </label>`;

    const totalPages = Math.ceil(totalLeads / pageSize);
    if (totalPages <= 1) {
        container.innerHTML = `
            ${sizeSelector}
            <div class="crm-pagination-center">
                <span class="crm-pagination-info">Showing ${totalLeads} lead${totalLeads !== 1 ? 's' : ''}</span>
            </div>
            <span class="crm-pagination-spacer"></span>`;
        return;
    }

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalLeads);

    let buttons = '';
    buttons += `<button class="crm-page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="loadLeads(${currentPage - 1})">‹</button>`;

    // Show at most 7 page buttons
    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages = [1];
        if (currentPage > 3) pages.push('...');
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
        if (currentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
    }

    for (const p of pages) {
        if (p === '...') {
            buttons += `<span class="crm-page-ellipsis">…</span>`;
        } else {
            buttons += `<button class="crm-page-btn ${p === currentPage ? 'active' : ''}" onclick="loadLeads(${p})">${p}</button>`;
        }
    }

    buttons += `<button class="crm-page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="loadLeads(${currentPage + 1})">›</button>`;

    container.innerHTML = `
        ${sizeSelector}
        <div class="crm-pagination-center">
            <span class="crm-pagination-info">${start}–${end} of ${totalLeads}</span>
            <div class="crm-pagination-buttons">${buttons}</div>
        </div>
        <span class="crm-pagination-spacer"></span>
    `;
}

// Switching page size always jumps back to page 1 — otherwise the current
// offset might point past the end of the result set after shrinking.
window.changePageSize = function (n) {
    const next = Number(n) || 50;
    if (!PAGE_SIZE_OPTIONS.includes(next)) return;
    pageSize = next;
    currentPage = 1;
    refreshLeadView();
};

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        }) + ' ' + date.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    } catch {
        return dateStr;
    }
}

// Probe whether the tenant has CONFIGURED a sending mailbox in CRM —
// i.e. has set a tenant-default mailbox or attached one to a flow. We
// deliberately don't count `shared-mailboxes` (the EmailService catalog),
// because the catalog lists every shared mailbox the user has access to
// across the workspace; the tenant has only "opted in" to send-from for
// the ones explicitly attached. Result + the actual mailbox list both
// live on window so the compose modal can populate its From dropdown
// from the same cached set without a second round-trip.
async function loadTenantMailboxFlag() {
    try {
        const [defaultMb, attachments] = await Promise.all([
            api.request('/crm/mailbox-attachments/tenant-default').catch(() => ({})),
            api.request('/crm/mailbox-attachments/attachments').catch(() => ({})),
        ]);
        // Build a deduped list of configured mailboxes. Tenant-default
        // first (so it shows up at the top of the From picker), then any
        // flow-specific overrides not already covered by the default.
        const seen = new Set();
        const list = [];
        const def = defaultMb?.mailbox;
        if (def && def.id) {
            list.push({ id: def.id, email_address: def.email_address, is_active: def.is_active !== false });
            seen.add(def.id);
        }
        for (const a of (attachments?.attachments || [])) {
            const id = a.mailbox_id || a.id;
            if (!id || seen.has(id)) continue;
            list.push({ id, email_address: a.mailbox_email || a.email_address, is_active: a.mailbox_is_active !== false });
            seen.add(id);
        }
        window._tenantConfiguredMailboxes = list;
        window._tenantHasMailbox = list.length > 0;
    } catch (_) {
        window._tenantConfiguredMailboxes = [];
        window._tenantHasMailbox = false;
    }
    // If the table already rendered before we resolved, redraw the email
    // column so the buttons appear without a manual refresh.
    if (typeof renderLeadsTable === 'function' && Array.isArray(allLeads) && allLeads.length) {
        try { renderLeadsTable(allLeads); } catch (_) {}
    }
}

// Triggered by the inline mail icon on each row of the leads table. Sets
// the same window globals that openLeadDetailPanel populates so
// openComposeForLead can read the lead's email/name without re-fetching.
window.openComposeForLeadFromTable = function (leadId, email, name) {
    window._leadDetailId = leadId;
    window._leadDetailEmail = email || '';
    window._leadDetailName  = name || '';
    if (typeof window.openComposeForLead === 'function') {
        window.openComposeForLead(leadId);
    } else {
        Toast.error('Composer not loaded yet — refresh and retry.');
    }
};

function teamColorClass(name) {
    if (!name) return '';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const colors = ['team-indigo', 'team-emerald', 'team-amber', 'team-rose', 'team-cyan', 'team-violet', 'team-orange', 'team-teal'];
    return colors[Math.abs(hash) % colors.length];
}

// Renders the team badge on a leads-table row. Prefers the explicit
// per-team colour (lead.team_color from crm_teams.color) and falls back
// to the deterministic name-hash class for any pre-migration row whose
// team color is null/blank.
function renderTeamBadge(lead) {
    const name = lead.teamName || lead.team_name || '';
    const explicit = lead.team_color || lead.teamColor;
    if (explicit && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(explicit)) {
        const fg = pickReadableTextColor(explicit);
        return `<span class="crm-team-badge" style="background:${escapeAttr(explicit)};color:${fg};">${escapeHtml(name)}</span>`;
    }
    return `<span class="crm-team-badge ${teamColorClass(name)}">${escapeHtml(name)}</span>`;
}

function pickReadableTextColor(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#fff';
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    const luma = 0.299*r + 0.587*g + 0.114*b;
    return luma > 165 ? '#0f172a' : '#fff';
}

function escapeAttr(s) {
    return escapeHtml(s);
}

// ==================== Selection & Bulk Actions ====================

function toggleSelectAll(checkbox) {
    const checkboxes = document.querySelectorAll('.lead-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
        if (checkbox.checked) {
            selectedLeadIds.add(cb.value);
        } else {
            selectedLeadIds.delete(cb.value);
        }
    });
    updateBulkActionsBar();
}

function toggleLeadSelection(leadId, checked) {
    if (checked) {
        selectedLeadIds.add(leadId);
    } else {
        selectedLeadIds.delete(leadId);
    }
    updateBulkActionsBar();

    // Update "select all" checkbox state
    const allCheckboxes = document.querySelectorAll('.lead-checkbox');
    const selectAll = document.getElementById('selectAll');
    if (selectAll) {
        selectAll.checked = allCheckboxes.length > 0 && selectedLeadIds.size === allCheckboxes.length;
    }
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const countEl = document.getElementById('selectedCount');
    if (selectedLeadIds.size > 0) {
        bar.style.display = 'flex';
        countEl.textContent = selectedLeadIds.size;
    } else {
        bar.style.display = 'none';
    }
}

// Hand selected leads off to the campaigns modal by stashing them in
// sessionStorage and bouncing through the settings page. email-campaigns.js
// picks them up on the other side and pre-populates the selection.
// We serialise name + email + lead-number alongside the UUID so the modal
// can show a human-readable list instead of raw GUIDs.
function bulkSendCampaign() {
    if (selectedLeadIds.size === 0) {
        Toast.info('Select at least one lead first');
        return;
    }
    // selectedLeadsData is our cross-page cache: it holds every lead row
    // we've ever rendered this session, so selections survive pagination.
    // Fall back to allLeads, then to a bare-id payload if the lead was
    // selected on a page we haven't re-visited since a filter change.
    const payload = Array.from(selectedLeadIds).map(id => {
        const l = selectedLeadsData.get(id) || allLeads.find(x => x.id === id);
        if (!l) return { id };
        return {
            id,
            leadNumber: l.leadNumber || l.lead_number || null,
            firstName: l.firstName || l.first_name || null,
            lastName: l.lastName || l.last_name || null,
            email: l.email || null,
            companyName: l.companyName || l.company_name || null,
        };
    });
    try {
        sessionStorage.setItem('crm.campaign.prefillLeads', JSON.stringify(payload));
    } catch (_) { /* quota / disabled — modal handles empty */ }
    // Append a cachebust param so the browser doesn't serve a stale copy of
    // settings.html — otherwise the modal HTML the user sees lags the JS by a
    // cycle and `openCampaignModal` blows up on missing elements.
    window.location.href = 'settings.html?tab=campaigns&prefill=1&t=' + Date.now();
}

async function bulkAssign() {
    if (selectedLeadIds.size === 0) {
        Toast.info('Select at least one lead first');
        return;
    }
    try {
        // Load teams
        const teams = await api.request('/crm/teams');
        if (!teams || teams.length === 0) {
            Toast.error('No teams found. Create a team in Settings first.');
            return;
        }
        // Build a simple picker
        const items = teams.map(t =>
            `<div class="assign-team-option" data-team-id="${t.id}" onclick="confirmBulkAssign('${t.id}', '${(t.team_name || '').replace(/'/g, "\\'")}')">
                <strong>${escHtml(t.team_name)}</strong>
                <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:8px;">${t.team_code || ''}</span>
            </div>`
        ).join('');
        const html = `<div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">${items}</div>`;
        // Use a confirm-style dialog
        const modal = document.createElement('div');
        modal.className = 'gm-overlay active';
        modal.id = 'bulkAssignOverlay';
        modal.innerHTML = `
            <div class="gm-modal gm-sm">
                <div class="gm-header">
                    <div class="gm-header-left">
                        <div class="gm-title-group">
                            <h3 class="gm-title">Assign ${selectedLeadIds.size} lead(s) to team</h3>
                            <p class="gm-subtitle">Pick a team below</p>
                        </div>
                    </div>
                    <button class="gm-close" onclick="document.getElementById('bulkAssignOverlay').remove()">&times;</button>
                </div>
                <div class="gm-body">${html}</div>
                <div class="gm-footer" style="display:flex;justify-content:flex-end;">
                    <button class="btn btn-outline-secondary" onclick="document.getElementById('bulkAssignOverlay').remove()">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    } catch (e) {
        Toast.error('Failed to load teams');
        console.error(e);
    }
}

function escHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function confirmBulkAssign(teamId, teamName) {
    try {
        // Filter out leads already assigned to a team (client-side check)
        const allIds = Array.from(selectedLeadIds);
        const alreadyAssigned = allIds.filter(id => {
            const row = document.querySelector(`tr[data-lead-id="${id}"]`);
            if (!row) return false;
            const teamCell = row.querySelector('.crm-team-badge');
            return !!teamCell;
        });
        const ids = allIds.filter(id => !alreadyAssigned.includes(id));

        if (ids.length === 0) {
            Toast.warning('All selected leads are already assigned to a team.');
            return;
        }
        if (alreadyAssigned.length > 0) {
            Toast.info(`${alreadyAssigned.length} lead(s) skipped — already assigned to a team.`);
        }

        await api.request('/crm/leads/bulk-assign-team', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_ids: ids, team_id: teamId })
        });
        Toast.success(`${ids.length} lead(s) assigned to ${teamName}`);
        document.getElementById('bulkAssignOverlay')?.remove();
        selectedLeadIds.clear();
        updateBulkActionsBar();
        loadLeads();
        // Bulk-assign flips lead status from 'new' → 'assigned' on the
        // backend, so the KPI cards have to refresh to stay in sync with
        // the table. Without this they stayed frozen at the pre-assign
        // totals (e.g. New=275 even after 50 leads moved to Assigned).
        loadLeadStats();
    } catch (e) {
        Toast.error(e.message || 'Assignment failed');
    }
}

async function bulkDelete() {
    const confirmed = await showConfirm(`Delete ${selectedLeadIds.size} selected lead(s)?`, 'Delete Leads', 'danger');
    if (!confirmed) return;

    try {
        const promises = Array.from(selectedLeadIds).map(id =>
            api.request(`/crm/leads/${id}`, { method: 'DELETE' })
        );
        await Promise.all(promises);
        Toast.success(`Deleted ${selectedLeadIds.size} lead(s)`);
        selectedLeadIds.clear();
        updateBulkActionsBar();
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Bulk delete failed:', error);
        Toast.error('Failed to delete some leads');
    }
}

// ==================== Modal Handling ====================

function openNewLeadModal() {
    currentEditLeadId = null;
    document.getElementById('leadModalTitle').textContent = 'New Lead';
    const submitBtn = document.getElementById('leadSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="leadSubmitSpinner" style="display:none;"></span> Create Lead';
    document.getElementById('leadForm').reset();
    if (leadSourceDropdown) leadSourceDropdown.setValue('');
    if (leadStatusDropdown) leadStatusDropdown.setValue('');
    document.getElementById('leadId').value = '';
    // Clear new fields
    ['leadCity','leadState','leadCountry','leadPincode','leadAddress','leadAltPhone','leadWebsite','leadCampaign','leadProductInterest','leadEstimatedValue'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    clearCustomFieldRows();
    clearCapturedData();
    openModal('leadModal');
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => {
            modal.classList.add('active');
        });
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.classList.remove('gm-animating');
        }, 200);
    }
}

function closeLeadModal() {
    closeModal('leadModal');
    currentEditLeadId = null;
}

// ==================== CRUD Operations ====================

async function handleLeadSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('leadSubmitBtn');
    const spinner = document.getElementById('leadSubmitSpinner');
    submitBtn.disabled = true;
    spinner.style.display = 'inline-block';

    const customFields = getCustomFieldsFromForm();

    const formData = {
        first_name: document.getElementById('leadFirstName').value.trim(),
        last_name: document.getElementById('leadLastName').value.trim(),
        email: document.getElementById('leadEmail').value.trim(),
        phone: document.getElementById('leadPhone').value.trim(),
        company_name: document.getElementById('leadCompany').value.trim(),
        job_title: document.getElementById('leadJobTitle').value.trim(),
        lead_source: leadSourceDropdown ? (leadSourceDropdown.getValue() || '') : document.getElementById('leadSource').value,
        status: leadStatusDropdown ? (leadStatusDropdown.getValue() || '') : document.getElementById('leadStatus').value,
        city: document.getElementById('leadCity').value.trim(),
        state: document.getElementById('leadState').value.trim(),
        country: document.getElementById('leadCountry').value.trim(),
        pincode: document.getElementById('leadPincode').value.trim(),
        address: document.getElementById('leadAddress').value.trim(),
        alternate_phone: document.getElementById('leadAltPhone').value.trim(),
        website: document.getElementById('leadWebsite').value.trim(),
        campaign_name: document.getElementById('leadCampaign').value.trim(),
        product_interest: document.getElementById('leadProductInterest').value.trim(),
        estimated_value: document.getElementById('leadEstimatedValue').value ? parseFloat(document.getElementById('leadEstimatedValue').value) : null,
        notes: document.getElementById('leadNotes').value.trim(),
        custom_fields: Object.keys(customFields).length > 0 ? JSON.stringify(customFields) : null
    };

    try {
        if (currentEditLeadId) {
            await api.request(`/crm/leads/${currentEditLeadId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Lead updated successfully');
        } else {
            await api.request('/crm/leads', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Lead created successfully');
        }

        closeLeadModal();
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Failed to save lead:', error);
        Toast.error(error.message || 'Failed to save lead');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function editLead(leadId) {
    try {
        const lead = await api.request(`/crm/leads/${leadId}`);
        currentEditLeadId = leadId;

        document.getElementById('leadModalTitle').textContent = 'Edit Lead';
        const editSubmitBtn = document.getElementById('leadSubmitBtn');
        editSubmitBtn.innerHTML = '<span class="btn-spinner" id="leadSubmitSpinner" style="display:none;"></span> Update Lead';
        document.getElementById('leadId').value = leadId;
        document.getElementById('leadFirstName').value = lead.first_name || '';
        document.getElementById('leadLastName').value = lead.last_name || '';
        document.getElementById('leadEmail').value = lead.email || '';
        document.getElementById('leadPhone').value = lead.phone || '';
        document.getElementById('leadCompany').value = lead.company_name || lead.company || '';
        document.getElementById('leadJobTitle').value = lead.job_title || '';
        document.getElementById('leadSource').value = lead.lead_source || 'manual';
        document.getElementById('leadStatus').value = lead.status || 'new';
        if (leadSourceDropdown) leadSourceDropdown.setValue(lead.lead_source || 'manual');
        if (leadStatusDropdown) leadStatusDropdown.setValue(lead.status || 'new');
        document.getElementById('leadCity').value = lead.city || '';
        document.getElementById('leadState').value = lead.state || '';
        document.getElementById('leadCountry').value = lead.country || '';
        document.getElementById('leadPincode').value = lead.pincode || '';
        document.getElementById('leadAddress').value = lead.address || '';
        document.getElementById('leadAltPhone').value = lead.alternate_phone || '';
        document.getElementById('leadWebsite').value = lead.website || '';
        document.getElementById('leadCampaign').value = lead.campaign_name || '';
        document.getElementById('leadProductInterest').value = lead.product_interest || '';
        document.getElementById('leadEstimatedValue').value = lead.estimated_value || '';
        document.getElementById('leadNotes').value = lead.notes || '';

        // Populate custom fields
        populateCustomFieldRows(lead.custom_fields);

        // Populate captured data from source_raw_data
        populateCapturedData(lead.source_raw_data);

        openModal('leadModal');
    } catch (error) {
        console.error('Failed to load lead:', error);
        Toast.error('Failed to load lead details');
    }
}

async function deleteLead(leadId) {
    const confirmed = await showConfirm('Are you sure you want to delete this lead?', 'Delete Lead', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/crm/leads/${leadId}`, { method: 'DELETE' });
        Toast.success('Lead deleted');
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Failed to delete lead:', error);
        Toast.error('Failed to delete lead');
    }
}

// ==================== Status Update ====================

async function updateLeadStatus(leadId, newStatus) {
    try {
        await api.request(`/crm/leads/${leadId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        Toast.success(`Lead status updated to ${formatStatus(newStatus)}`);
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Failed to update status:', error);
        Toast.error('Failed to update lead status');
    }
}

// ==================== Lead Assignment ====================

async function assignLead(leadId, ownerId) {
    try {
        await api.request(`/crm/leads/${leadId}/assign`, {
            method: 'PUT',
            body: JSON.stringify({ owner_id: ownerId })
        });
        Toast.success('Lead assigned successfully');
        refreshLeadView();
    } catch (error) {
        console.error('Failed to assign lead:', error);
        Toast.error('Failed to assign lead');
    }
}

// ==================== Lead Conversion ====================

// ==================== Reassign Lead ====================

async function openReassignModal(leadId) {
    reassigningLeadId = leadId;
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
    document.getElementById('reassignLeadName').textContent = `${name} (${lead.lead_number || ''})`;

    const sel = document.getElementById('reassignTargetMember');
    sel.innerHTML = '<option value="">Loading...</option>';
    document.getElementById('reassignLeadOverlay').classList.add('active');

    try {
        const teamId = lead.team_id;
        if (!teamId) { Toast.error('Lead has no team'); closeReassignModal(); return; }

        const teamDetail = await api.request(`/crm/teams/${teamId}`);
        const members = (teamDetail.members || []).filter(m => m.is_active && m.user_id !== lead.owner_user_id);

        sel.innerHTML = '<option value="">— Select team member —</option>' +
            members.map(m => `<option value="${m.user_id}">${escapeHtml(m.display_name || m.user_id)} (${m.role})</option>`).join('');
    } catch (e) {
        sel.innerHTML = '<option value="">Failed to load members</option>';
    }
}

function closeReassignModal() {
    document.getElementById('reassignLeadOverlay').classList.remove('active');
    reassigningLeadId = null;
}

async function confirmReassign() {
    if (!reassigningLeadId) return;
    const sel = document.getElementById('reassignTargetMember');
    const newOwnerId = sel.value;
    if (!newOwnerId) { Toast.warning('Please select a team member'); return; }

    try {
        await api.request(`/crm/leads/${reassigningLeadId}/assign`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner_user_id: newOwnerId })
        });
        Toast.success('Lead reassigned successfully');
        closeReassignModal();
        refreshLeadView();
    } catch (e) {
        Toast.error(e.message || 'Failed to reassign');
    }
}

// ==================== Convert Lead ====================

function openConvertModal(leadId) {
    convertingLeadId = leadId;
    const lead = allLeads.find(l => l.id === leadId);
    if (lead) {
        document.getElementById('convertDealName').value = `${lead.first_name || ''} ${lead.last_name || ''} - Deal`.trim();
    }
    document.getElementById('convertDealValue').value = '';
    openModal('convertLeadModal');
}

function closeConvertModal() {
    closeModal('convertLeadModal');
    convertingLeadId = null;
}

async function confirmConvertLead() {
    if (!convertingLeadId) return;

    const dealName = document.getElementById('convertDealName').value.trim();
    const dealValueRaw = document.getElementById('convertDealValue').value;

    if (!dealName) {
        Toast.error('Deal name is required');
        return;
    }
    if (dealValueRaw === '' || dealValueRaw === null) {
        Toast.error('Deal value is required');
        return;
    }
    const dealValue = parseFloat(dealValueRaw);
    if (isNaN(dealValue) || dealValue < 0) {
        Toast.error('Deal value must be a number greater than or equal to 0');
        return;
    }

    const convertBtn = document.getElementById('convertLeadBtn');
    const spinner = document.getElementById('convertSpinner');
    convertBtn.disabled = true;
    spinner.style.display = 'inline-block';

    try {
        const payload = {
            create_contact: true,
            create_deal: true,
            deal_name: dealName,
            deal_value: dealValue
        };

        await api.request(`/crm/leads/${convertingLeadId}/convert`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        Toast.success('Lead converted successfully');
        closeConvertModal();
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Failed to convert lead:', error);
        Toast.error(error.message || 'Failed to convert lead');
    } finally {
        convertBtn.disabled = false;
        spinner.style.display = 'none';
    }
}

// ==================== Searchable Dropdowns ====================

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    // Filter bar dropdowns (compact)
    if (!filterStatusDropdown) {
        filterStatusDropdown = convertSelectToSearchable('filterStatus', {
            compact: true,
            placeholder: 'All Statuses',
            searchPlaceholder: 'Search status...',
            onChange: () => applyFilters()
        });
    }

    if (!filterSourceDropdown) {
        filterSourceDropdown = convertSelectToSearchable('filterSource', {
            compact: true,
            placeholder: 'All Sources',
            searchPlaceholder: 'Search sources...',
            // Source change resets the form-answer state — different forms ask
            // different questions, so carrying picks across is meaningless.
            onChange: () => onSourceFilterChanged()
        });
    }

    // Modal form dropdowns
    if (!leadSourceDropdown) {
        leadSourceDropdown = convertSelectToSearchable('leadSource', {
            placeholder: 'Select source...',
            searchPlaceholder: 'Search sources...'
        });
    }

    if (!leadStatusDropdown) {
        leadStatusDropdown = convertSelectToSearchable('leadStatus', {
            placeholder: 'Select status...',
            searchPlaceholder: 'Search status...'
        });
    }
}

// ==================== Latest Summary Cell + Modal ====================
//
// Column shows a 1-line preview of the most recent activity summary; clicking
// opens a popup with every summary on this lead, newest first, with a live
// search filter. Hidden by default through the column-picker if a tenant
// doesn't want it.

function renderLatestSummaryCell(lead) {
    // Prefer the rep's most recent counselor note over auto-generated
    // EMAIL SENT rows — reps complained their hand-typed comment was
    // being hidden behind the latest email-sent entry. Fall back to the
    // raw latest activity only if no non-email summary exists yet.
    const note = (lead.latest_note_summary || '').trim();
    const fallback = (lead.latest_activity_summary || '').trim();
    const useNote = note.length > 0;
    const summary = useNote ? note : fallback;
    if (!summary) {
        return '<span class="crm-cell-secondary">—</span>';
    }
    const preview = summary.length > 120 ? summary.slice(0, 120) + '…' : summary;
    const ts = useNote
        ? (lead.latest_note_at ? formatDate(lead.latest_note_at) : '')
        : (lead.latest_activity_at ? formatDate(lead.latest_activity_at) : '');
    const rawType = useNote ? (lead.latest_note_type || 'note') : (lead.latest_activity_type || '');
    const typeLabel = formatSummaryTypeLabel(rawType);
    const typePillClass = rawType === 'email' ? 'crm-summary-type-pill type-email' : 'crm-summary-type-pill';
    const typePill = typeLabel ? `<span class="${typePillClass}">${escapeHtml(typeLabel)}</span>` : '';
    const safeName = escapeHtml(`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || (lead.lead_number || 'this lead'));
    // Wrap long descriptions across 2 lines instead of letting an unbroken
    // 500-char string blow out the column width. word-break:break-word keeps
    // CJK / no-space text from overflowing; -webkit-line-clamp limits to 2
    // visible lines so row heights stay consistent — full text is in the
    // click-through modal that opens via data-tooltip's affordance.
    // No inline max-width here — the parent <td>'s column width (CSS
    // min-width + any user-dragged width from table-resize.js) is the
    // sole authority. Hard-coding 260px here was overriding the user's
    // column-resize drag, keeping text wrapped at the old size even
    // after they widened the column.
    return `
        <div class="crm-summary-cell" style="cursor:pointer; line-height:1.3;"
              data-tooltip="Click to see all summaries on this lead"
              data-tooltip-position="top"
              onclick="event.stopPropagation(); openLeadSummariesModal('${escapeHtmlJsAttr(lead.id)}', '${safeName.replace(/'/g, '&#39;')}')">
            <div style="font-size:0.82rem; color:var(--text-primary);
                        word-break:break-word; overflow-wrap:anywhere;
                        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${typePill}${escapeHtml(preview)}</div>
            ${ts ? `<div style="font-size:0.7rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(ts)}</div>` : ''}
        </div>`;
}

function formatSummaryTypeLabel(type) {
    switch ((type || '').toLowerCase()) {
        case 'call':    return 'Call';
        case 'email':   return 'Email';
        case 'meeting': return 'Meeting';
        case 'note':    return 'Note';
        case 'task':    return 'Task';
        default:        return '';
    }
}

let _leadSummariesAll = [];     // full unfiltered list — search filter runs client-side
let _leadSummariesCurrentLeadId = null;
// 'all' | 'notes' (call/note/meeting/task) | 'email' | 'other'
let _leadSummariesTypeFilter = 'all';

async function openLeadSummariesModal(leadId, leadName) {
    _leadSummariesCurrentLeadId = leadId;
    const subtitle = document.getElementById('leadSummariesSubtitle');
    if (subtitle) subtitle.textContent = leadName || '—';
    const search = document.getElementById('leadSummariesSearch');
    if (search) search.value = '';
    // Reset to "All" each time the modal opens so the user starts from
    // a known state instead of inheriting the last lead's filter.
    _leadSummariesTypeFilter = 'all';
    _syncLeadSummariesChipsActive();
    document.getElementById('leadSummariesOverlay').classList.add('active');

    const loadingEl = document.getElementById('leadSummariesLoading');
    const emptyEl = document.getElementById('leadSummariesEmpty');
    const listEl = document.getElementById('leadSummariesList');
    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.innerHTML = '';
    _leadSummariesAll = [];

    try {
        // Use the lead timeline endpoint instead of /api/activities — the
        // timeline already enriches each row with performed_by_name and
        // performed_by_email, so the modal can show "Abhishek Anand" instead
        // of a raw user UUID. Activities with non-empty descriptions are
        // exactly the rep "Summary" entries we want; status changes and
        // other system events have type !== 'activity' and get filtered out.
        const data = await api.request(`/crm/leads/${encodeURIComponent(leadId)}/timeline`);
        const items = Array.isArray(data) ? data : (data?.items || data?.entries || []);
        items.sort((a, b) => {
            const aT = new Date(a.timestamp || a.performed_at || a.created_at || 0).getTime();
            const bT = new Date(b.timestamp || b.performed_at || b.created_at || 0).getTime();
            return bT - aT;
        });
        // Map timeline shape → activity shape used by the renderer; keep
        // only activity entries with a real description.
        _leadSummariesAll = items
            .filter(e => e.type === 'activity' && e.description && String(e.description).trim())
            .map(e => ({
                description: e.description,
                performed_at: e.timestamp,
                performed_by_name: e.performed_by_name,
                performed_by_email: e.performed_by_email,
                activity_type: e.meta?.activity_type || e.icon,
                contact_outcome: e.meta?.contact_outcome,
            }));
        if (loadingEl) loadingEl.style.display = 'none';
        renderLeadSummariesList(_leadSummariesAll);
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.textContent = 'Failed to load summaries: ' + (e.message || 'unknown error');
        }
    }
}

function closeLeadSummariesModal() {
    document.getElementById('leadSummariesOverlay').classList.remove('active');
    _leadSummariesCurrentLeadId = null;
    _leadSummariesAll = [];
}

function filterLeadSummaries() {
    const q = (document.getElementById('leadSummariesSearch')?.value || '').trim().toLowerCase();
    const typeFilter = _leadSummariesTypeFilter;
    const filtered = _leadSummariesAll.filter(a => {
        if (q && !(a.description || '').toLowerCase().includes(q)) return false;
        if (typeFilter === 'all') return true;
        const t = (a.activity_type || '').toLowerCase();
        if (typeFilter === 'notes') return t === 'call' || t === 'note' || t === 'meeting' || t === 'task';
        if (typeFilter === 'email') return t === 'email';
        if (typeFilter === 'other') return !(t === 'call' || t === 'note' || t === 'meeting' || t === 'task' || t === 'email');
        return true;
    });
    renderLeadSummariesList(filtered);
}

function setLeadSummariesFilter(type) {
    _leadSummariesTypeFilter = type;
    _syncLeadSummariesChipsActive();
    filterLeadSummaries();
}

function _syncLeadSummariesChipsActive() {
    document.querySelectorAll('#leadSummariesTypeFilter .crm-summary-chip').forEach(btn => {
        const isActive = btn.dataset.summaryFilter === _leadSummariesTypeFilter;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function renderLeadSummariesList(items) {
    const listEl = document.getElementById('leadSummariesList');
    const emptyEl = document.getElementById('leadSummariesEmpty');
    if (!listEl) return;
    if (!items.length) {
        listEl.innerHTML = '';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.textContent = (_leadSummariesAll.length === 0)
                ? 'No summaries logged yet.'
                : 'No summaries match your search.';
        }
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    listEl.innerHTML = items.map(a => {
        const when = a.performed_at ? new Date(a.performed_at).toLocaleString() : '—';
        // Only show a user-friendly identity. The /api/activities endpoint
        // doesn't always enrich performed_by_name/email — falling back to
        // the raw `performed_by` GUID was printing UUIDs like
        // 1f2f4d09-fb45-… which are useless to a sales rep. Skip the line
        // entirely if we don't have a name or email.
        const who = a.performed_by_name || a.performed_by_email || '';
        const type = a.activity_type ? `<span class="tl-chip tl-chip-type">${escapeHtml(a.activity_type)}</span>` : '';
        const outcome = a.contact_outcome ? `<span class="tl-chip tl-chip-outcome">${escapeHtml(String(a.contact_outcome).replace(/_/g, ' '))}</span>` : '';
        return `
            <div style="border:1px solid var(--border-color); border-radius:6px; padding:10px 12px; background:var(--bg-secondary);">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:6px;">
                    ${type}${outcome}
                    <span style="margin-left:auto; font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(when)}</span>
                </div>
                <div style="white-space:pre-wrap; word-break:break-word;">${escapeHtml(a.description)}</div>
                ${who ? `<div style="margin-top:6px; font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(who)}</div>` : ''}
            </div>`;
    }).join('');
}

// ==================== Custom Fields ====================

function getCustomFieldsBadge(customFieldsJson) {
    if (!customFieldsJson || customFieldsJson === '{}') return '';
    try {
        const fields = typeof customFieldsJson === 'string' ? JSON.parse(customFieldsJson) : customFieldsJson;
        const count = Object.keys(fields).length;
        if (count === 0) return '';

        const tooltipItems = Object.entries(fields)
            .slice(0, 5)
            .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v).substring(0, 30))}`)
            .join('&#10;');
        const extra = count > 5 ? `&#10;...and ${count - 5} more` : '';

        return `<span class="crm-custom-fields-badge" title="${tooltipItems}${extra}">+${count} fields</span> `;
    } catch {
        return '';
    }
}

function addCustomFieldRow(key, value) {
    const list = document.getElementById('customFieldsList');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'custom-field-row';
    row.innerHTML = `
        <input type="text" class="form-control form-control-sm custom-field-key" placeholder="Field name" value="${escapeHtml(key || '')}">
        <input type="text" class="form-control form-control-sm custom-field-value" placeholder="Value" value="${escapeHtml(value || '')}">
        <button type="button" class="btn btn-sm btn-outline-danger custom-field-remove" onclick="this.parentElement.remove()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;
    list.appendChild(row);
}

function clearCustomFieldRows() {
    const list = document.getElementById('customFieldsList');
    if (list) list.innerHTML = '';
}

function populateCustomFieldRows(customFieldsJson) {
    clearCustomFieldRows();
    if (!customFieldsJson || customFieldsJson === '{}') return;
    try {
        const fields = typeof customFieldsJson === 'string' ? JSON.parse(customFieldsJson) : customFieldsJson;
        for (const [key, value] of Object.entries(fields)) {
            addCustomFieldRow(key, String(value));
        }
    } catch (e) {
        console.error('Error parsing custom fields:', e);
    }
}

function getCustomFieldsFromForm() {
    const list = document.getElementById('customFieldsList');
    if (!list) return {};

    const fields = {};
    const rows = list.querySelectorAll('.custom-field-row');
    rows.forEach(row => {
        const key = row.querySelector('.custom-field-key')?.value?.trim();
        const value = row.querySelector('.custom-field-value')?.value?.trim();
        if (key) {
            fields[key] = value || '';
        }
    });
    return fields;
}

// ==================== Captured Data (Source Raw Data) ====================

const CORE_LEAD_FIELDS = new Set([
    'first_name', 'last_name', 'full_name', 'email', 'phone', 'company_name', 'company', 'job_title',
    'lead_source', 'status', 'notes'
]);

function populateCapturedData(sourceRawData) {
    const section = document.getElementById('capturedDataSection');
    const list = document.getElementById('capturedDataList');
    if (!section || !list) return;

    list.innerHTML = '';

    if (!sourceRawData || sourceRawData === '{}') {
        section.style.display = 'none';
        return;
    }

    try {
        const data = typeof sourceRawData === 'string' ? JSON.parse(sourceRawData) : sourceRawData;
        const entries = Object.entries(data).filter(([key]) => !CORE_LEAD_FIELDS.has(key));

        if (entries.length === 0) {
            section.style.display = 'none';
            return;
        }

        entries.forEach(([key, value]) => {
            const item = document.createElement('div');
            item.className = 'captured-data-item';
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            item.innerHTML = `
                <span class="captured-data-label">${escapeHtml(label)}</span>
                <span class="captured-data-value">${escapeHtml(String(value || '-'))}</span>
            `;
            list.appendChild(item);
        });

        section.style.display = 'block';
    } catch (e) {
        console.error('Error parsing source_raw_data:', e);
        section.style.display = 'none';
    }
}

function clearCapturedData() {
    const section = document.getElementById('capturedDataSection');
    const list = document.getElementById('capturedDataList');
    if (section) section.style.display = 'none';
    if (list) list.innerHTML = '';
}

function toggleCapturedData() {
    const list = document.getElementById('capturedDataList');
    const chevron = document.getElementById('capturedDataChevron');
    if (!list) return;
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? '' : 'none';
    if (chevron) chevron.style.transform = isHidden ? '' : 'rotate(-90deg)';
}

// ==================== Utilities ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A value going into a JS STRING inside an inline handler needs BOTH
// escapings, and HTML-escaping alone cannot do it. The parser decodes
// entities in an attribute BEFORE the JS is parsed, so &#39; becomes a
// real quote again and `');alert(1);//` still breaks out — verified in a
// browser, see tests/security/escaper-quote-safety.spec.js.
//
// JS-escape first, then HTML-escape: the backslash survives as \&#39;,
// decodes to \' and reaches JS as an escaped quote. It also fixes an
// ordinary bug — a lead called O'Brien currently breaks these handlers
// outright with a syntax error.
function escapeHtmlJsAttr(s) {
    return escapeHtml(String(s ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n'));
}

// Lead Desk: the quick-actions bar is rendered inside the scrolling panel-body by
// lead-journey.js; relocate it to be the workspace pane's footer (direct child of
// #leadDetailPanel) so it sits outside the scroll flow. Observer keeps this true
// across every re-render (status change, refresh, lead switch).
document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('leadDetailPanel');
    if (!panel) return;
    const relocateActionsBar = () => {
        const bar = panel.querySelector('.panel-body .lead-detail-actions');
        if (!bar) return;
        panel.querySelectorAll(':scope > .lead-detail-actions').forEach(el => el.remove());
        panel.appendChild(bar);
    };
    new MutationObserver(relocateActionsBar).observe(panel, { childList: true, subtree: true });
    relocateActionsBar();
});

// ═══ Grand capture wave (dashboard parity, multi-series) ════════════════════
// Three series of events/day over the same window: leads captured (created),
// first contacted, converted. One y-axis (counts), legend top-right, shared
// crosshair tooltip.
async function loadLeadsWave() {
    const band = document.getElementById('ldkWave');
    const host = document.getElementById('ldkWaveChart');
    if (!band || !host) return;

    const MAX_WINDOW = 90;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const oldestNeeded = new Date(today); oldestNeeded.setDate(today.getDate() - (MAX_WINDOW - 1));

    const rows = [];
    try {
        for (let page = 1; page <= 8; page++) {
            const resp = await api.request(`/crm/leads?page=${page}&pageSize=50&sort=created_at&order=desc`);
            const batch = Array.isArray(resp) ? resp : (resp?.data ?? []);
            if (!batch.length) break;
            rows.push(...batch);
            const oldest = batch[batch.length - 1]?.created_at;
            if (oldest && new Date(oldest) < oldestNeeded) break;
            if (batch.length < 50) break;
        }
    } catch (e) { return; } // decoration-with-data — stay hidden on failure

    const SERIES = [
        { key: 'created_at',         label: 'Captured',  color: 'var(--brand-primary)', fill: true  },
        { key: 'first_contact_date', label: 'Contacted', color: 'var(--wave-s2, #16a34a)', fill: false },
        { key: 'converted_at',       label: 'Converted', color: 'var(--wave-s3, #7c3aed)', fill: false },
    ];

    const inWindow = (dateStr, days) => {
        if (!dateStr) return false;
        const from = new Date(today); from.setDate(today.getDate() - (days - 1));
        return new Date(dateStr) >= from;
    };
    const countIn = days => rows.reduce((n, l) =>
        n + (SERIES.some(s => inWindow(l[s.key], days)) ? 1 : 0), 0);
    const DAYS = countIn(30) > 0 ? 30 : (countIn(90) > 0 ? 90 : 0);
    if (DAYS === 0) return;

    const capText = 'Lead flow · ' + DAYS + 'd';

    const start = new Date(today); start.setDate(today.getDate() - (DAYS - 1));
    SERIES.forEach(s => {
        s.buckets = new Array(DAYS).fill(0);
        rows.forEach(l => {
            const v = l[s.key];
            if (!v) return;
            const d = new Date(v); d.setHours(0, 0, 0, 0);
            const idx = Math.round((d - start) / 86400000);
            if (idx >= 0 && idx < DAYS) s.buckets[idx]++;
        });
    });

    const W = 1200, H = 104, padT = 46, padB = 8;
    const ih = H - padT - padB;
    const yMax = Math.max(...SERIES.flatMap(s => s.buckets)) * 1.15 || 1;
    const x = i => (i / (DAYS - 1)) * W;
    const y = v => padT + ih - (v / yMax) * ih;

    // monotone-cubic smoothing (no overshoot on spikes)
    function smoothPath(buckets) {
        const pts = buckets.map((v, i) => [x(i), y(v)]);
        const n = pts.length;
        const dx = [], m = [];
        for (let i = 0; i < n - 1; i++) {
            dx.push(pts[i + 1][0] - pts[i][0]);
            m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
        }
        const t = [m[0]];
        for (let i = 1; i < n - 1; i++) t.push((m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2);
        t.push(m[n - 2]);
        for (let i = 0; i < n - 1; i++) {
            if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
            else {
                const a = t[i] / m[i], b = t[i + 1] / m[i];
                const s = a * a + b * b;
                if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
            }
        }
        let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
        for (let i = 0; i < n - 1; i++) {
            const h = dx[i];
            d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1) +
                 ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1) +
                 ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
        }
        return d;
    }

    const dayLabel = i => {
        const d = new Date(start); d.setDate(start.getDate() + i);
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    // peak marker on the busiest captured day
    const capBuckets = SERIES[0].buckets;
    let peak = 0;
    capBuckets.forEach((v, i) => { if (v > capBuckets[peak]) peak = i; });
    const marker =
        `<circle cx="${x(peak).toFixed(1)}" cy="${y(capBuckets[peak]).toFixed(1)}" r="3.5" fill="var(--brand-primary)"/>`;

    const ticks = '';

    const paths = SERIES.map(s => {
        const line = smoothPath(s.buckets);
        const fill = s.fill
            ? `<path d="${line} L${W},${H} L0,${H} Z" fill="url(#ldkWaveFill)" stroke="none"/>`
            : '';
        return fill +
            `<path class="draw-line" d="${line}" fill="none" stroke="${s.color}" stroke-width="2.2" ` +
            `stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>`;
    }).join('');

    host.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" ` +
        `aria-label="Leads captured, contacted and converted per day, last ${DAYS} days">` +
        `<defs><linearGradient id="ldkWaveFill" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="var(--brand-primary)" stop-opacity="0.26"/>` +
        `<stop offset="1" stop-color="var(--brand-primary)" stop-opacity="0"/>` +
        `</linearGradient></defs>` +
        paths + marker +
        `<line id="ldkWaveCross" x1="0" y1="${padT}" x2="0" y2="${padT + ih}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>` +
        ticks +
        `</svg>`;

    // legend — identity is never color-alone: dot + label per series
    const legend = document.querySelector('.ldk-hero .ldk-wavelegend');
    if (legend) legend.innerHTML = `<span class="wl-cap">${capText}</span>` + SERIES.map(s =>
        `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');

    band.hidden = false;

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        host.querySelectorAll('.draw-line').forEach((p, i) => {
            const len = p.getTotalLength();
            p.style.strokeDasharray = len;
            p.style.strokeDashoffset = len;
            p.style.transition = `stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1) ${0.15 + i * 0.12}s`;
        });
        requestAnimationFrame(() => requestAnimationFrame(() => {
            host.querySelectorAll('.draw-line').forEach(p => { p.style.strokeDashoffset = '0'; });
        }));
    }

    const svg = host.querySelector('svg');
    const cross = host.querySelector('#ldkWaveCross');
    const tip = document.getElementById('ldkWaveTip');
    svg.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width * W;
        const idx = Math.min(DAYS - 1, Math.max(0, Math.round((relX / W) * (DAYS - 1))));
        cross.style.display = '';
        cross.setAttribute('x1', x(idx));
        cross.setAttribute('x2', x(idx));
        tip.style.display = 'block';
        tip.style.left = Math.min(Math.max(x(idx) / W * rect.width, 70), rect.width - 70) + 'px';
        tip.style.top = '50px';
        tip.innerHTML = `<b>${dayLabel(idx)}</b>` + SERIES.map(s =>
            `<span class="tr"><i style="background:${s.color}"></i>${s.label} <b class="tv">${s.buckets[idx]}</b></span>`).join('');
    });
    svg.addEventListener('mouseleave', () => {
        cross.style.display = 'none';
        tip.style.display = 'none';
    });
}
