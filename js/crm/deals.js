/**
 * CRM Deals Pipeline Management
 * Handles pipeline visualization (Kanban & List), CRUD, stage changes, won/lost.
 */

// ==================== State ====================
let allDeals = [];
let dealStages = [];
let currentView = 'kanban'; // 'kanban' or 'list'
let currentEditDealId = null;
let pendingStageChange = null; // { dealId, action, data }
let stagePickerDealId = null;
let contactsList = [];
let companiesList = [];

// Default currency from CRM settings
let defaultCurrency = 'USD';

// Searchable dropdown instances
let dealCurrencyDropdown = null;
let dealStageDropdown = null;
let dealContactDropdown = null;
let dealCompanyDropdown = null;

// CRM team role: 'admin' | 'manager' | 'teamlead' | 'member' | 'none'.
// Members can edit basic fields on owned deals but not value/stage/won/lost/delete
// UNLESS the tenant-level `allow_member_deal_edits` setting is on.
let myTeamRole = 'member';
let allowMemberDealEdits = false;

async function loadMyRole() {
    try {
        const user = api.getUser();
        if (user?.roles?.includes('CRM_ADMIN') || user?.roles?.includes('SUPERADMIN')) {
            myTeamRole = 'admin';
            return;
        }
        const res = await api.request('/crm/leads/my-role');
        myTeamRole = res?.role || 'member';
    } catch { myTeamRole = 'member'; }
}

async function loadMemberDealEditsFlag() {
    try {
        const res = await api.request('/crm/crm-settings/allow_member_deal_edits');
        allowMemberDealEdits = String(res?.value ?? 'false').toLowerCase() === 'true';
    } catch { allowMemberDealEdits = false; }
}

function isMember() { return myTeamRole === 'member'; }
function canDeleteDeal() { return ['admin', 'manager', 'teamlead'].includes(myTeamRole); }
function canChangeDealStage() {
    if (['admin', 'manager', 'teamlead'].includes(myTeamRole)) return true;
    return myTeamRole === 'member' && allowMemberDealEdits;
}
function canEditDealFinancial() {
    if (['admin', 'manager', 'teamlead'].includes(myTeamRole)) return true;
    return myTeamRole === 'member' && allowMemberDealEdits;
}

// Currency symbols map
const CURRENCY_SYMBOLS = {
    'USD': '$', 'EUR': '\u20AC', 'GBP': '\u00A3', 'INR': '\u20B9',
    'AED': 'AED ', 'CAD': 'C$', 'AUD': 'A$', 'JPY': '\u00A5',
    'CNY': '\u00A5', 'KRW': '\u20A9', 'BRL': 'R$', 'ZAR': 'R'
};

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('crm', '../');
    // Resolve role + tenant toggle first so render() can hide member-blocked actions.
    await Promise.all([loadMyRole(), loadMemberDealEditsFlag()]);
    await loadDefaultCurrency();
    await loadDealStages();
    loadPipeline();
    loadContacts();
    loadCompanies();
    initSearchableDropdowns();
    // Keyboard shortcuts (/, s, f, c, Esc) + saved-views chips.
    window.addEventListener('keydown', dealKeyboardHandler);
    renderSavedViewsBar();

    // Deep link: ?deal=<id> opens that deal's panel. The related-records
    // panels on companies and contacts link here, and a link that only lands
    // you on the pipeline is a link that made you search again.
    const dealId = new URLSearchParams(window.location.search).get('deal');
    if (dealId) openDealDetailPanel(dealId);
});

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    // Fill the currency <select> BEFORE it is converted — the searchable
    // dropdown reads the options once, so anything added later is invisible to
    // it. The list lives in currencies.js so this page and the settings page
    // cannot drift from each other or from the backend again; the form used to
    // offer 7 currencies while the accounting service denominated 41.
    if (typeof populateCurrencySelect === 'function') populateCurrencySelect('dealCurrency', false);

    if (!dealCurrencyDropdown) {
        dealCurrencyDropdown = convertSelectToSearchable('dealCurrency', {
            placeholder: 'Select currency...',
            searchPlaceholder: 'Search currencies...'
        });
    }

    if (!dealStageDropdown) {
        dealStageDropdown = convertSelectToSearchable('dealStage', {
            placeholder: 'Select stage...',
            searchPlaceholder: 'Search stages...'
        });
    }

    if (!dealContactDropdown) {
        dealContactDropdown = convertSelectToSearchable('dealContact', {
            placeholder: 'Select contact...',
            searchPlaceholder: 'Search contacts...'
        });
    }

    if (!dealCompanyDropdown) {
        dealCompanyDropdown = convertSelectToSearchable('dealCompany', {
            placeholder: 'Select company...',
            searchPlaceholder: 'Search companies...'
        });
    }
}

// ==================== Data Loading ====================

/**
 * Load default currency from CRM settings
 */
async function loadDefaultCurrency() {
    try {
        const response = await api.request('/crm/crm-settings/default_currency');
        if (response && response.value) {
            defaultCurrency = response.value;
        }
    } catch (error) {
        console.error('Failed to load default currency, using USD:', error);
    }
}

/**
 * Load pipeline stages
 */
async function loadDealStages() {
    try {
        const response = await api.request('/crm/deal-stages?pipelineName=Default');
        dealStages = response.data || response || [];

        // Populate stage dropdown in deal form
        const stageSelect = document.getElementById('dealStage');
        if (stageSelect && dealStages.length > 0) {
            stageSelect.innerHTML = dealStages.map(stage =>
                `<option value="${stage.id}">${escapeHtml(stage.stage_name)}</option>`
            ).join('');
        }

        // Update searchable dropdown
        if (dealStageDropdown) {
            dealStageDropdown.setOptions(dealStages.map(s => ({ value: s.id, label: s.stage_name })));
        }
    } catch (error) {
        console.error('Failed to load deal stages:', error);
        // Fallback default stages
        dealStages = [
            { id: 'qualification', stage_name: 'Qualification', stage_order: 1, color: 'blue' },
            { id: 'proposal', stage_name: 'Proposal', stage_order: 2, color: 'purple' },
            { id: 'negotiation', stage_name: 'Negotiation', stage_order: 3, color: 'orange' },
            { id: 'won', stage_name: 'Won', stage_order: 4, color: 'green' },
            { id: 'lost', stage_name: 'Lost', stage_order: 5, color: 'red' }
        ];
    }
}

/**
 * Load pipeline deals (full deal objects for kanban/list rendering)
 *
 * ?kanban=true triggers the joined query — backend returns the same
 * Deal shape with extra fields populated: contact_name, company_name_resolved,
 * owner_name, days_in_current_stage, stage_win_probability,
 * stage_name_resolved, stage_type_resolved. Other consumers (copilot
 * tools, deal list view) still get the lean payload via the unflagged
 * route.
 */
async function loadPipeline() {
    try {
        const response = await api.request('/crm/deals?kanban=true');
        allDeals = response.data || response || [];
        // Owner dropdown options derive from the actual deal owners
        // present in the result — keeps the filter free of users who
        // have no deals on this pipeline.
        populateOwnerFilter();
        renderCurrentView();
        updatePipelineSummary();
        renderDealsHeroWave();
        renderStageFlowline();
    } catch (error) {
        console.error('Failed to load pipeline:', error);
        allDeals = [];
        renderCurrentView();
    }
}


// ── Stage-value hairline: pipeline value share by stage, stage colors ──
// Mirrors the Lead Desk flowline. Follows the FILTERED set like the strip.
function renderStageFlowline() {
    const bar = document.getElementById('dflFlow');
    if (!bar || !dealStages.length) return;
    const deals = getFilteredDeals();
    const per = dealStages.map(st => ({
        color: getStageColor(st),
        name: st.stage_name,
        value: deals.filter(d => d.stage_id === st.id)
                    .reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0)
    })).filter(x => x.value > 0);
    const total = per.reduce((a, x) => a + x.value, 0);
    if (!total) { bar.innerHTML = ''; return; }
    bar.innerHTML = per.map(x =>
        `<i style="flex-basis:${Math.max((x.value / total) * 100, 0.6)}%;background:${x.color}" title="${escapeHtml(x.name)}: ${formatCurrency(x.value, defaultCurrency)}"></i>`
    ).join('');
}

// ── Hero wave: deal value entering the pipeline per day (last 30-90d) ──
// Lead Desk hero pattern — ambient backdrop behind the title, no axes.
function renderDealsHeroWave() {
    const band = document.getElementById('dflWave');
    const capEl = document.getElementById('dflWaveCap');
    if (!band) return;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const countIn = days => {
        const from = new Date(today); from.setDate(today.getDate() - (days - 1));
        return allDeals.filter(d => d.created_at && new Date(d.created_at) >= from).length;
    };
    const DAYS = countIn(30) > 0 ? 30 : (countIn(90) > 0 ? 90 : 0);
    if (DAYS === 0) { band.hidden = true; if (capEl) capEl.textContent = ''; return; }

    const start = new Date(today); start.setDate(today.getDate() - (DAYS - 1));
    const buckets = new Array(DAYS).fill(0);
    allDeals.forEach(d => {
        if (!d.created_at) return;
        const dt = new Date(d.created_at); dt.setHours(0, 0, 0, 0);
        const idx = Math.round((dt - start) / 86400000);
        if (idx >= 0 && idx < DAYS) buckets[idx] += (parseFloat(d.deal_value) || 0);
    });
    if (buckets.every(v => v === 0)) { band.hidden = true; if (capEl) capEl.textContent = ''; return; }

    const W = 1200, H = 100, padT = 56, padB = 6;
    const ih = H - padT - padB;
    const yMax = Math.max(...buckets) * 1.15 || 1;
    const x = i => (i / (DAYS - 1)) * W;
    const y = v => padT + ih - (v / yMax) * ih;
    const pts = buckets.map((v, i) => [x(i), y(v)]);
    const n = pts.length;
    const dx = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
    const t = [m[0]];
    for (let i = 1; i < n - 1; i++) t.push((m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2);
    t.push(m[n - 2]);
    for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
        else {
            const a = t[i] / m[i], b = t[i + 1] / m[i];
            const s2 = a * a + b * b;
            if (s2 > 9) { const tau = 3 / Math.sqrt(s2); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
        }
    }
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i];
        d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1) +
             ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1) +
             ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
    }
    const area = d + ' L' + W + ',' + H + ' L0,' + H + ' Z';
    band.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs><linearGradient id="dflWaveFill" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="var(--brand-primary)" stop-opacity="0.22"/>' +
        '<stop offset="1" stop-color="var(--brand-primary)" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#dflWaveFill)" stroke="none"/>' +
        '<path d="' + d + '" fill="none" stroke="var(--brand-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>' +
        '</svg>';
    band.hidden = false;
    if (capEl) capEl.textContent = 'Deal value/day · ' + DAYS + 'd';
}

/**
 * Load contacts for the deal form dropdown
 */
async function loadContacts() {
    try {
        const response = await api.request('/crm/contacts');
        contactsList = response.data || response || [];
        const contactSelect = document.getElementById('dealContact');
        if (contactSelect) {
            const options = contactsList.map(c =>
                `<option value="${c.id}">${escapeHtml((c.first_name || '') + ' ' + (c.last_name || ''))}</option>`
            ).join('');
            contactSelect.innerHTML = '<option value="">Select contact...</option>' + options;
        }

        if (dealContactDropdown) {
            dealContactDropdown.setOptions([
                { value: '', label: 'Select contact...' },
                ...contactsList.map(c => ({ value: c.id, label: ((c.first_name || '') + ' ' + (c.last_name || '')).trim() }))
            ]);
        }
    } catch (error) {
        console.error('Failed to load contacts:', error);
    }
}

/**
 * Load companies for the deal form dropdown
 */
async function loadCompanies() {
    try {
        const response = await api.request('/crm/companies');
        companiesList = response.data || response || [];
        const companySelect = document.getElementById('dealCompany');
        if (companySelect) {
            const options = companiesList.map(c =>
                `<option value="${c.id}">${escapeHtml(c.company_name || '')}</option>`
            ).join('');
            companySelect.innerHTML = '<option value="">Select company...</option>' + options;
        }

        if (dealCompanyDropdown) {
            dealCompanyDropdown.setOptions([
                { value: '', label: 'Select company...' },
                ...companiesList.map(c => ({ value: c.id, label: c.company_name || '' }))
            ]);
        }
    } catch (error) {
        console.error('Failed to load companies:', error);
    }
}

// ==================== Pipeline Summary ====================
//
// Summary tiles operate on the FILTERED deal set so applying a filter
// re-scopes the Total / Forecast / Won numbers to the visible subset.
// The summary on the top of the page is supposed to answer "what am I
// looking at right now?", not "what's the global pipeline?".

function updatePipelineSummary() {
    const deals = getFilteredDeals();
    const totalValue = deals.reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0);
    const wonStageIds = dealStages.filter(s => s.stage_type === 'won').map(s => s.id);
    const lostStageIds = dealStages.filter(s => s.stage_type === 'lost').map(s => s.id);
    const wonDeals = deals.filter(d => wonStageIds.includes(d.stage_id));
    const lostDeals = deals.filter(d => lostStageIds.includes(d.stage_id));
    const wonValue = wonDeals.reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0);
    const lostValue = lostDeals.reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0);

    // Weighted forecast — Σ deal_value × stage.win_probability/100 for
    // OPEN deals, plus realised won revenue. Lost deals count zero.
    // Mirrors the C# helper BusinessLayer.ComputeWeightedForecast so
    // the frontend and backend agree on the math (the backend tests
    // pin this).
    const weighted = computeWeightedForecast(deals);

    document.getElementById('totalPipelineValue').textContent = formatCurrency(totalValue, defaultCurrency);
    document.getElementById('totalDealsCount').textContent = deals.length;
    document.getElementById('wonDealsValue').textContent = formatCurrency(wonValue, defaultCurrency);
    document.getElementById('lostDealsValue').textContent = formatCurrency(lostValue, defaultCurrency);
    const fcEl = document.getElementById('weightedForecastValue');
    if (fcEl) fcEl.textContent = formatCurrency(weighted, defaultCurrency);

    // Stale indicator — number of OPEN deals at ≥ 14d in current stage.
    // Surfaces on the toolbar so a sales lead can spot pipeline rot.
    const openIds = new Set(dealStages.filter(s => s.stage_type === 'open').map(s => s.id));
    const stale = deals.filter(d => openIds.has(d.stage_id) && (d.days_in_current_stage ?? 0) >= 14);
    const ind = document.getElementById('staleDealsIndicator');
    const cnt = document.getElementById('staleDealsCount');
    if (ind && cnt) {
        cnt.textContent = stale.length;
        ind.style.display = stale.length > 0 ? 'inline-flex' : 'none';
    }
}

function computeWeightedForecast(deals) {
    let sum = 0;
    for (const d of deals) {
        const type = (d.stage_type_resolved || '').toLowerCase();
        if (type === 'lost') continue;
        const value = parseFloat(d.deal_value) || 0;
        if (type === 'won') { sum += value; continue; }
        let p = parseFloat(d.stage_win_probability) || 0;
        if (p > 100) p = 100; if (p < 0) p = 0;
        sum += value * (p / 100);
    }
    return Math.round(sum * 100) / 100;
}

// ==================== Filter state ====================

let dealFilters = {
    search: '',
    ownerId: '',
    staleness: '',  // '', 'fresh', 'watch', 'stale'
    valueRange: '', // '', '0-50000', '50000-200000', ...
};

function getFilteredDeals() {
    const f = dealFilters;
    return allDeals.filter(d => {
        if (f.search) {
            const q = f.search.toLowerCase();
            const hay = [
                d.deal_name, d.contact_name, d.company_name_resolved,
                d.owner_name, d.utm_campaign, d.utm_source,
            ].filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        if (f.ownerId && d.owner_user_id !== f.ownerId) return false;
        if (f.staleness) {
            const days = d.days_in_current_stage;
            if (days == null) return false;
            if (f.staleness === 'fresh' && days >= 7) return false;
            if (f.staleness === 'watch' && (days < 7 || days >= 14)) return false;
            if (f.staleness === 'stale' && days < 14) return false;
        }
        if (f.valueRange) {
            const v = parseFloat(d.deal_value) || 0;
            const [lo, hi] = f.valueRange.split('-').map(x => x === '' ? null : parseFloat(x));
            if (lo != null && v < lo) return false;
            if (hi != null && v >= hi) return false;
        }
        return true;
    });
}

function applyDealFilters() {
    dealFilters.search = (document.getElementById('dealSearchInput')?.value || '').trim();
    dealFilters.ownerId = document.getElementById('filterOwner')?.value || '';
    dealFilters.staleness = document.getElementById('filterStaleness')?.value || '';
    dealFilters.valueRange = document.getElementById('filterValueRange')?.value || '';

    const anyActive = !!(dealFilters.search || dealFilters.ownerId
                      || dealFilters.staleness || dealFilters.valueRange);
    const clr = document.getElementById('clearFiltersBtn');
    if (clr) clr.style.display = anyActive ? '' : 'none';

    renderCurrentView();
    updatePipelineSummary();
    renderStageFlowline();
}

function clearDealFilters() {
    dealFilters = { search: '', ownerId: '', staleness: '', valueRange: '' };
    const ids = ['dealSearchInput', 'filterOwner', 'filterStaleness', 'filterValueRange'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }
    applyDealFilters();
}

function filterToStaleDeals() {
    document.getElementById('filterStaleness').value = 'stale';
    applyDealFilters();
}

function populateOwnerFilter() {
    const sel = document.getElementById('filterOwner');
    if (!sel) return;
    const seen = new Map();
    for (const d of allDeals) {
        if (d.owner_user_id && d.owner_name && !seen.has(d.owner_user_id)) {
            seen.set(d.owner_user_id, d.owner_name);
        }
    }
    const current = sel.value;
    sel.innerHTML = '<option value="">All owners</option>'
        + Array.from(seen.entries())
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
            .join('');
    sel.value = current;
}

// ==================== Bulk-select state ====================

let bulkSelectMode = false;
let bulkSelectedDealIds = new Set();

function toggleBulkSelect() {
    bulkSelectMode = !bulkSelectMode;
    bulkSelectedDealIds.clear();
    document.body.classList.toggle('bulk-select-active', bulkSelectMode);
    document.getElementById('bulkActionBar').style.display = bulkSelectMode ? 'flex' : 'none';
    const toggleBtn = document.getElementById('bulkSelectToggle');
    if (toggleBtn) toggleBtn.classList.toggle('active', bulkSelectMode);
    if (bulkSelectMode) populateBulkTargetStageDropdown();
    renderCurrentView();
    updateBulkSelectedCount();
}

function populateBulkTargetStageDropdown() {
    const sel = document.getElementById('bulkMoveTargetStage');
    if (!sel) return;
    sel.innerHTML = '<option value="">Move to…</option>'
        + dealStages
            .filter(s => s.is_active !== false)
            .map(s => `<option value="${s.id}">${escapeHtml(s.stage_name)}</option>`)
            .join('');
    sel.onchange = updateBulkSelectedCount;
}

function clearBulkSelection() {
    bulkSelectedDealIds.clear();
    renderCurrentView();
    updateBulkSelectedCount();
}

function updateBulkSelectedCount() {
    const cnt = document.getElementById('bulkSelectedCount');
    if (cnt) cnt.textContent = bulkSelectedDealIds.size;
    const btn = document.getElementById('bulkMoveBtn');
    const targetEl = document.getElementById('bulkMoveTargetStage');
    if (btn) {
        btn.disabled = bulkSelectedDealIds.size === 0
                    || !targetEl || !targetEl.value;
    }
}

function handleBulkCardClick(dealId) {
    if (bulkSelectedDealIds.has(dealId)) bulkSelectedDealIds.delete(dealId);
    else bulkSelectedDealIds.add(dealId);
    renderCurrentView();
    updateBulkSelectedCount();
}

async function confirmBulkMove() {
    const target = document.getElementById('bulkMoveTargetStage').value;
    if (!target || bulkSelectedDealIds.size === 0) return;
    const ids = Array.from(bulkSelectedDealIds);
    const targetStage = dealStages.find(s => s.id === target);
    const confirmed = await Confirm.show({
        title: 'Move deals',
        message: `Move ${ids.length} deal${ids.length === 1 ? '' : 's'} to "${targetStage?.stage_name || 'target stage'}"?`,
        confirmText: 'Move',
    });
    if (!confirmed) return;
    try {
        const res = await api.request('/crm/deals/bulk-move', {
            method: 'POST',
            body: JSON.stringify({ deal_ids: ids, target_stage_id: target }),
        });
        if (res.moved > 0) Toast.success(`Moved ${res.moved} deal${res.moved === 1 ? '' : 's'}.`);
        if (res.failed > 0) Toast.error(`${res.failed} deal${res.failed === 1 ? '' : 's'} couldn't be moved.`);
        bulkSelectedDealIds.clear();
        await loadPipeline();
    } catch (err) {
        console.error(err);
        Toast.error('Bulk move failed.');
    }
}

// ==================== Keyboard shortcuts ====================
//
// Hotkeys are scoped to the deals page via window listener installed
// at init. Skipped when focus is in an input/textarea/contenteditable
// so a rep typing in the search bar can't accidentally trip "s".

function isTypingInField(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
}

function dealKeyboardHandler(event) {
    // Don't hijack typing.
    if (isTypingInField(event.target)) {
        // Allow Esc to bail out of search even while typing.
        if (event.key === 'Escape') {
            const search = document.getElementById('dealSearchInput');
            if (search && document.activeElement === search) {
                search.value = ''; search.blur(); applyDealFilters();
            }
        }
        return;
    }
    // Don't trigger when a modal / side panel is open — those have
    // their own UX.
    if (document.querySelector('.gm-overlay.active, .deal-detail-panel.open, .modal.show')) return;

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
        case '/':
        case 's':
        case 'S': {
            // '/' focuses search; 's' toggles bulk-select mode.
            if (event.key === '/') {
                event.preventDefault();
                document.getElementById('dealSearchInput')?.focus();
            } else {
                event.preventDefault();
                toggleBulkSelect();
            }
            break;
        }
        case 'f':
        case 'F': {
            event.preventDefault();
            document.getElementById('filterOwner')?.focus();
            break;
        }
        case 'c':
        case 'C': {
            event.preventDefault();
            clearDealFilters();
            break;
        }
        case 'Escape': {
            if (bulkSelectMode) { event.preventDefault(); toggleBulkSelect(); }
            else if (
                dealFilters.search || dealFilters.ownerId
                || dealFilters.staleness || dealFilters.valueRange
            ) {
                event.preventDefault();
                clearDealFilters();
            }
            break;
        }
    }
}

// ==================== Saved views ====================
//
// Persisted in localStorage keyed by tenant id (when available). A
// view = a name + the current dealFilters snapshot. Lists are read on
// every page-load init; updates re-render the chips.
const SAVED_VIEWS_KEY = 'ragenaizer_deals_saved_views';

function tenantScopedSavedViewsKey() {
    // The tenant id isn't strictly required for correctness — it just
    // means a user toggling between tenants in the same browser
    // doesn't see the other tenant's views. Falls back to a global
    // key if tenant id isn't on the page.
    const tid = (window.api && api.getTenantId && api.getTenantId()) || 'default';
    return `${SAVED_VIEWS_KEY}::${tid}`;
}

function loadSavedViews() {
    try {
        const raw = localStorage.getItem(tenantScopedSavedViewsKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function persistSavedViews(views) {
    try {
        localStorage.setItem(tenantScopedSavedViewsKey(), JSON.stringify(views));
    } catch (e) {
        // localStorage quota, private mode, etc. — fail silent and
        // emit a toast so the user knows the save didn't stick.
        Toast.error('Could not save view (storage unavailable)');
    }
}

async function saveCurrentView() {
    // Theme-consistent prompt from toast.js (Prompt.show) — never the
    // native browser prompt() which (a) looks like phishing and (b)
    // breaks the brand theme on every dialog.
    const name = await Prompt.show({
        title: 'Save view',
        message: 'Name this view',
        placeholder: 'e.g. My hot deals',
        confirmText: 'Save',
    });
    if (!name || !String(name).trim()) return;
    const views = loadSavedViews();
    const trimmed = String(name).trim();
    views.push({
        id: 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: trimmed,
        filters: { ...dealFilters },
        created_at: new Date().toISOString(),
    });
    persistSavedViews(views);
    renderSavedViewsBar();
    Toast.success(`Saved view "${trimmed}"`);
}

function applySavedView(viewId) {
    const views = loadSavedViews();
    const view = views.find(v => v.id === viewId);
    if (!view) return;
    dealFilters = { ...view.filters };
    // Re-sync the DOM inputs so the user can see what's active.
    const map = {
        dealSearchInput: dealFilters.search,
        filterOwner: dealFilters.ownerId,
        filterStaleness: dealFilters.staleness,
        filterValueRange: dealFilters.valueRange,
    };
    for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    }
    applyDealFilters();
}

function deleteSavedView(viewId) {
    const views = loadSavedViews().filter(v => v.id !== viewId);
    persistSavedViews(views);
    renderSavedViewsBar();
}

function renderSavedViewsBar() {
    const host = document.getElementById('savedViewsBar');
    if (!host) return;
    const views = loadSavedViews();
    if (views.length === 0) {
        host.innerHTML = `
            <button type="button" class="saved-view-save" onclick="saveCurrentView()" title="Save current filters as a view">
                + Save view
            </button>
        `;
        host.style.display = 'flex';
        return;
    }
    host.innerHTML = views.map(v => `
        <span class="saved-view-chip" onclick="applySavedView('${v.id}')" title="Apply view">
            ${escapeHtml(v.name)}
            <button class="saved-view-delete" onclick="event.stopPropagation(); deleteSavedView('${v.id}')" title="Delete">×</button>
        </span>
    `).join('') + `
        <button type="button" class="saved-view-save" onclick="saveCurrentView()" title="Save current filters as a view">
            + Save view
        </button>
    `;
    host.style.display = 'flex';
}

// ==================== View Toggle ====================

function switchView(view) {
    currentView = view;

    // Update toggle buttons
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Show/hide views
    document.getElementById('kanbanView').style.display = view === 'kanban' ? 'block' : 'none';
    document.getElementById('listView').style.display = view === 'list' ? 'block' : 'none';

    renderCurrentView();
}

function renderCurrentView() {
    if (currentView === 'kanban') {
        renderKanbanBoard();
    } else {
        renderListView();
    }
}

// ==================== Kanban Board ====================

function renderKanbanBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    if (dealStages.length === 0) {
        board.innerHTML = `
            <div class="kanban-loading">
                <div class="crm-empty-content">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="7" height="7"/>
                        <rect x="14" y="3" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/>
                    </svg>
                    <p>No pipeline stages configured</p>
                </div>
            </div>
        `;
        return;
    }

    // Group deals by stage — using the FILTERED set so kanban columns
    // reflect the active filter chips (search, owner, age, value).
    // When filters are inactive getFilteredDeals returns allDeals
    // verbatim (no extra cost on the common path).
    const dealsToShow = getFilteredDeals();
    const dealsByStage = {};
    dealStages.forEach(stage => {
        dealsByStage[stage.id] = dealsToShow.filter(d => d.stage_id === stage.id);
    });

    board.innerHTML = dealStages.map(stage => {
        const stageDeals = dealsByStage[stage.id] || [];
        const stageValue = stageDeals.reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0);
        const stageColor = getStageColor(stage);

        return `
            <div class="kanban-column" data-stage-id="${stage.id}"
                 ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${stage.id}')">
                <div class="kanban-column-header" style="border-top-color: ${stageColor}; color: ${stageColor};">
                    <div class="kanban-column-title">
                        <span class="kanban-stage-dot" style="background: ${stageColor};"></span>
                        <span>${escapeHtml(stage.stage_name)}</span>
                        <span class="kanban-count">${stageDeals.length}</span>
                    </div>
                    <div class="kanban-column-value">${formatCurrency(stageValue, defaultCurrency)}</div>
                </div>
                <div class="kanban-column-body">
                    ${stageDeals.length === 0 ? `
                        <div class="kanban-empty">
                            <p>No deals</p>
                        </div>
                    ` : stageDeals.map(deal => renderDealCard(deal, stage)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// ─── Card-meta helpers ────────────────────────────────────────────
// Deterministic owner initials + color from user_id hash, so the same
// rep gets the same chip color across every card / every session
// without a server lookup. Hash is intentionally shallow (fast and
// stable across browsers) — collisions just mean two reps share a
// color, not a correctness issue.

function ownerInitials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
}

function ownerAvatarColor(userId) {
    // 8-color palette — wide enough that small teams almost always
    // get unique colors, tight enough that the kanban doesn't look
    // like Christmas lights at 50+ owners.
    const palette = [
        '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
        '#10b981', '#06b6d4', '#3b82f6', '#ef4444',
    ];
    if (!userId) return palette[0];
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = ((h << 5) - h + userId.charCodeAt(i)) | 0;
    return palette[Math.abs(h) % palette.length];
}

function daysInStageBadgeClass(days) {
    if (days == null) return '';
    if (days < 7) return 'days-fresh';
    if (days < 14) return 'days-watch';
    return 'days-stale';
}

function formatDaysInStage(days) {
    if (days == null) return '—';
    if (days === 0) return 'Today';
    if (days === 1) return '1d';
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return months === 1 ? '1mo' : `${months}mo`;
}

function renderDealCard(deal, stage) {
    const value = formatCurrency(parseFloat(deal.deal_value) || 0, deal.currency || defaultCurrency);
    // Backend snake_case mapping (JsonNamingPolicy.SnakeCaseLower):
    //   contact_name (joined from contacts)
    //   company_name_resolved (joined from companies — name suffix
    //     avoids clobbering the legacy nullable company_name field
    //     on the Deal POJO; the joined value is what we render)
    //   owner_name + owner_is_inactive (gRPC enriched in BL)
    //   days_in_current_stage (computed via LATERAL on deal_stage_history)
    const contactName = deal.contact_name || '';
    const companyName = deal.company_name_resolved || '';
    const ownerName = deal.owner_name || '';
    const ownerInactive = !!deal.owner_is_inactive;
    const days = deal.days_in_current_stage;
    const closeDate = deal.expected_close_date ? formatDate(deal.expected_close_date) : '—';
    const tags = Array.isArray(deal.tags) ? deal.tags.filter(t => t && String(t).trim()) : [];

    const isWon = stage && stage.stage_type === 'won';
    const isLost = stage && stage.stage_type === 'lost';

    // Members: no drag (would attempt stage change → 403), no won/lost buttons.
    const draggable = canChangeDealStage();
    const showQuickActions = !isWon && !isLost && canChangeDealStage();

    const avatarColor = ownerAvatarColor(deal.owner_user_id);
    const initials = ownerInitials(ownerName);
    const bulkSelected = bulkSelectMode && bulkSelectedDealIds.has(deal.id);

    return `
        <div class="kanban-deal-card ${bulkSelected ? 'bulk-selected' : ''}" ${draggable && !bulkSelectMode ? 'draggable="true"' : ''}
             data-deal-id="${deal.id}"
             ${draggable && !bulkSelectMode ? `ondragstart="handleDragStart(event, '${deal.id}')"` : ''}
             onclick="handleDealCardTap(event, '${deal.id}')">
            ${bulkSelectMode ? `
                <span class="bulk-select-checkbox ${bulkSelected ? 'checked' : ''}" aria-hidden="true">
                    ${bulkSelected ? '✓' : ''}
                </span>
            ` : ''}
            <div class="deal-card-header">
                <span class="deal-card-name">${escapeHtml(deal.deal_name || 'Untitled Deal')}</span>
                <div class="deal-card-actions">
                    <button class="crm-action-btn" onclick="event.stopPropagation(); editDeal('${deal.id}')" title="Edit">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="deal-card-value">${value}</div>
            ${(companyName || contactName) ? `
                <div class="deal-card-meta">
                    ${companyName ? `<span class="deal-card-company" title="Company">${escapeHtml(companyName)}</span>` : ''}
                    ${contactName ? `<span class="deal-card-contact" title="Contact">${escapeHtml(contactName)}</span>` : ''}
                </div>
            ` : ''}
            ${tags.length > 0 ? `
                <div class="deal-card-tags">
                    ${tags.slice(0, 3).map(t => `<span class="deal-tag">${escapeHtml(t)}</span>`).join('')}
                    ${tags.length > 3 ? `<span class="deal-tag deal-tag-more">+${tags.length - 3}</span>` : ''}
                </div>
            ` : ''}
            <div class="deal-card-status-row">
                <span class="deal-card-date" title="Expected close">📅 ${closeDate}</span>
                <span class="deal-card-days ${daysInStageBadgeClass(days)}" title="Days in current stage">${formatDaysInStage(days)}</span>
            </div>
            <div class="deal-card-footer">
                ${ownerName ? `
                    <span class="deal-card-owner ${ownerInactive ? 'owner-inactive' : ''}" title="Owner: ${escapeHtml(ownerName)}${ownerInactive ? ' (inactive)' : ''}">
                        <span class="deal-owner-avatar" style="background:${avatarColor}">${escapeHtml(initials)}</span>
                    </span>
                ` : '<span class="deal-card-owner deal-owner-unassigned" title="Unassigned">—</span>'}
                ${showQuickActions ? `
                    <div class="deal-card-quick-actions">
                        <button class="deal-quick-btn deal-won-btn" onclick="event.stopPropagation(); markDealWon('${deal.id}')" title="Mark as Won">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </button>
                        <button class="deal-quick-btn deal-lost-btn" onclick="event.stopPropagation(); markDealLost('${deal.id}')" title="Mark as Lost">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function getStageColor(stage) {
    // Use stage color if provided, otherwise map by name
    if (stage.color) {
        const colorMap = {
            'blue': 'var(--brand-primary)',
            'purple': 'var(--brand-secondary)',
            'orange': 'var(--color-warning)',
            'green': 'var(--color-success)',
            'red': 'var(--color-danger)',
            'cyan': 'var(--color-cyan)',
            'indigo': 'var(--brand-accent)'
        };
        return colorMap[stage.color] || stage.color;
    }

    // Default color mapping by stage name
    const nameMap = {
        'qualification': 'var(--brand-primary)',
        'proposal': 'var(--brand-secondary)',
        'negotiation': 'var(--color-warning)',
        'won': 'var(--color-success)',
        'lost': 'var(--color-danger)'
    };
    return nameMap[stage.stage_name?.toLowerCase()] || 'var(--brand-primary)';
}

// ==================== Drag & Drop ====================

function handleDragStart(event, dealId) {
    event.dataTransfer.setData('text/plain', dealId);
    event.dataTransfer.effectAllowed = 'move';
    event.target.classList.add('dragging');
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const column = event.currentTarget;
    column.classList.add('drag-over');
}

function handleDrop(event, stageId) {
    event.preventDefault();
    const dealId = event.dataTransfer.getData('text/plain');

    // Remove drag-over styling from all columns
    document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
    document.querySelectorAll('.kanban-deal-card').forEach(card => card.classList.remove('dragging'));

    if (dealId) {
        changeDealStage(dealId, stageId);
    }
}

// Remove drag-over on drag leave
document.addEventListener('dragleave', (event) => {
    const column = event.target.closest('.kanban-column');
    if (column && !column.contains(event.relatedTarget)) {
        column.classList.remove('drag-over');
    }
});

// ==================== List View ====================

function renderListView() {
    const tbody = document.getElementById('dealsTableBody');
    if (!tbody) return;

    if (!allDeals || getFilteredDeals().length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <line x1="12" y1="1" x2="12" y2="23"/>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                        <p>No deals found</p>
                        <button class="btn btn-sm btn-primary" onclick="openNewDealModal()">Create your first deal</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = getFilteredDeals().map(deal => {
        const stage = dealStages.find(s => s.id === deal.stage_id);
        const stageName = stage ? stage.stage_name : '-';
        const isWon = stage && stage.stage_type === 'won';
        const isLost = stage && stage.stage_type === 'lost';
        const stageClass = isWon ? 'stage-won' : isLost ? 'stage-lost' : '';

        return `
            <tr data-deal-id="${deal.id}">
                <td>
                    <div class="crm-cell-primary">${escapeHtml(deal.deal_name || 'Untitled')}</div>
                </td>
                <td>
                    <span class="deal-value-cell">${formatCurrency(parseFloat(deal.deal_value) || 0, deal.currency)}</span>
                </td>
                <td>
                    <span class="crm-stage-badge ${stageClass}">${escapeHtml(stageName)}</span>
                </td>
                <td class="hide-mobile">
                    <span class="crm-cell-secondary">${escapeHtml(deal.contact_name || '-')}</span>
                </td>
                <td class="hide-mobile">
                    <span class="crm-cell-secondary">${escapeHtml(deal.company_name || '-')}</span>
                </td>
                <td class="hide-mobile">
                    <span class="crm-cell-secondary">${deal.expected_close_date ? formatDate(deal.expected_close_date) : '-'}</span>
                </td>
                <td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="editDeal('${deal.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        ${!isWon && !isLost && canChangeDealStage() ? `
                        <button class="crm-action-btn action-convert" onclick="markDealWon('${deal.id}')" title="Mark Won">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="markDealLost('${deal.id}')" title="Mark Lost">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                        ` : ''}
                        ${canDeleteDeal() ? `
                        <button class="crm-action-btn action-delete" onclick="deleteDeal('${deal.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== Modal Handling ====================

function openNewDealModal() {
    currentEditDealId = null;
    document.getElementById('dealModalTitle').textContent = 'New Deal';
    document.getElementById('dealSubmitBtn').textContent = 'Create Deal';
    document.getElementById('dealForm').reset();
    document.getElementById('dealId').value = '';

    if (dealCurrencyDropdown) dealCurrencyDropdown.setValue(defaultCurrency);
    if (dealStageDropdown) dealStageDropdown.setValue('');
    if (dealContactDropdown) dealContactDropdown.setValue('');
    if (dealCompanyDropdown) dealCompanyDropdown.setValue('');

    // Remove stage readonly from previous edit
    const oldStageReadonly = document.getElementById('dealStageReadonly');
    if (oldStageReadonly) oldStageReadonly.remove();

    // Show dropdowns for new deal (not readonly) — show SearchableDropdown OR native select, not both
    function showDropdown(container, readonlyEl) {
        if (!container) return;
        if (readonlyEl) readonlyEl.style.display = 'none';
        const sd = container.querySelector('.searchable-dropdown');
        if (sd) {
            sd.style.display = '';
            container.querySelectorAll('select').forEach(el => el.style.display = 'none');
        } else {
            container.querySelectorAll('select').forEach(el => el.style.display = '');
        }
    }

    showDropdown(document.getElementById('dealContact')?.parentElement, document.getElementById('dealContactReadonly'));
    showDropdown(document.getElementById('dealCompany')?.parentElement, document.getElementById('dealCompanyReadonly'));
    showDropdown(document.getElementById('dealStage')?.parentElement, null);

    openModal('dealModal');
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

function closeDealModal() {
    closeModal('dealModal');
    currentEditDealId = null;
}

function closeStageChangeModal() {
    closeModal('stageChangeModal');
    pendingStageChange = null;
}

// ==================== CRUD Operations ====================

async function handleDealSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('dealSubmitBtn');
    const spinner = document.getElementById('dealSubmitSpinner');
    if (submitBtn) submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const noteText = document.getElementById('dealNotes').value.trim();
    const formData = {
        deal_name: document.getElementById('dealName').value.trim(),
        deal_value: parseFloat(document.getElementById('dealValue').value) || 0,
        currency: (dealCurrencyDropdown ? dealCurrencyDropdown.getValue() : document.getElementById('dealCurrency').value) || defaultCurrency,
        stage_id: dealStageDropdown ? dealStageDropdown.getValue() : document.getElementById('dealStage').value,
        expected_close_date: document.getElementById('dealExpectedClose').value || null,
        contact_id: (dealContactDropdown ? dealContactDropdown.getValue() : document.getElementById('dealContact').value) || null,
        company_id: (dealCompanyDropdown ? dealCompanyDropdown.getValue() : document.getElementById('dealCompany').value) || null
    };

    try {
        let dealId = currentEditDealId;
        if (currentEditDealId) {
            await api.request(`/crm/deals/${currentEditDealId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Deal updated successfully');
        } else {
            const created = await api.request('/crm/deals', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            dealId = created?.id;
            Toast.success('Deal created successfully');
        }

        if (noteText && dealId) {
            try {
                await api.request('/crm/notes', {
                    method: 'POST',
                    body: JSON.stringify({ content: noteText, entity_type: 'deal', entity_id: dealId })
                });
            } catch (e) { console.warn('Failed to save note:', e); }
        }

        closeDealModal();
        loadPipeline();
    } catch (error) {
        console.error('Failed to save deal:', error);
        Toast.error(error.message || 'Failed to save deal');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function editDeal(dealId) {
    try {
        const deal = await api.request(`/crm/deals/${dealId}`);
        currentEditDealId = dealId;

        document.getElementById('dealModalTitle').textContent = 'Edit Deal';
        document.getElementById('dealSubmitBtn').textContent = 'Update Deal';
        document.getElementById('dealId').value = dealId;
        document.getElementById('dealName').value = deal.deal_name || '';
        document.getElementById('dealValue').value = deal.deal_value || '';
        document.getElementById('dealCurrency').value = deal.currency || 'USD';
        document.getElementById('dealStage').value = deal.stage_id || '';
        document.getElementById('dealExpectedClose').value = deal.expected_close_date ? deal.expected_close_date.split('T')[0] : '';
        document.getElementById('dealNotes').value = '';
        document.getElementById('dealNotes').placeholder = 'Add a note about this deal (saved to timeline)';

        if (dealCurrencyDropdown) dealCurrencyDropdown.setValue(deal.currency || 'USD');

        // Members: lock financial fields. They can still rename / change close date,
        // but value, currency, and stage are forecast-critical and require teamlead+.
        // Backend mirrors this with a 403; the readonly state is purely UX.
        const lockFinancial = !canEditDealFinancial();
        const dealValueEl = document.getElementById('dealValue');
        const dealCurrencyEl = document.getElementById('dealCurrency');
        if (dealValueEl) {
            dealValueEl.readOnly = lockFinancial;
            dealValueEl.title = lockFinancial ? 'Only Team Leads, Managers, or Admins can change deal value' : '';
        }
        if (dealCurrencyEl) dealCurrencyEl.disabled = lockFinancial;
        if (dealCurrencyDropdown && lockFinancial) dealCurrencyDropdown.disable?.();

        // Stage: look up stage type from loaded dealStages array
        const stageSelect = document.getElementById('dealStage');
        const stageContainer = stageSelect?.parentElement;
        const currentStage = dealStages.find(s => s.id === deal.stage_id);
        const stageType = (currentStage?.stage_type || '').toLowerCase();
        const stageName = currentStage?.stage_name || 'Unknown';
        const isTerminal = stageType === 'won' || stageType === 'lost';

        // Remove old readonly element if exists
        const oldStageReadonly = document.getElementById('dealStageReadonly');
        if (oldStageReadonly) oldStageReadonly.remove();

        // Members: stage shown as read-only text (same treatment as terminal stages).
        if ((isTerminal || lockFinancial) && stageContainer) {
            const stageReadonly = document.createElement('div');
            stageReadonly.id = 'dealStageReadonly';
            const memberLockColor = 'var(--text-secondary)';
            stageReadonly.style.cssText = 'padding:6px 0;font-weight:600;font-size:0.9rem;color:' +
                (isTerminal ? (stageType === 'won' ? '#22c55e' : '#ef4444') : memberLockColor);
            stageReadonly.textContent = stageName + (isTerminal ? ' (final)' : ' (read-only)');
            stageContainer.querySelectorAll('select, .searchable-dropdown').forEach(el => el.style.display = 'none');
            stageContainer.appendChild(stageReadonly);
        } else {
            if (stageContainer) {
                const sd = stageContainer.querySelector('.searchable-dropdown');
                if (sd) {
                    sd.style.display = '';
                    stageContainer.querySelectorAll('select').forEach(el => el.style.display = 'none');
                } else {
                    stageContainer.querySelectorAll('select').forEach(el => el.style.display = '');
                }
            }
            if (dealStageDropdown) dealStageDropdown.setValue(deal.stage_id || '');
        }

        // Contact & Company: show as read-only text if set, dropdown if not
        const contactReadonly = document.getElementById('dealContactReadonly');
        const contactSelect = document.getElementById('dealContact');
        const contactContainer = contactSelect?.parentElement;
        const companyReadonly = document.getElementById('dealCompanyReadonly');
        const companySelect = document.getElementById('dealCompany');
        const companyContainer = companySelect?.parentElement;

        function hideAllDropdowns(container, readonly) {
            if (!container) return;
            container.querySelectorAll('select, .searchable-dropdown').forEach(el => el.style.display = 'none');
            if (readonly) readonly.style.display = '';
        }
        function showAllDropdowns(container, readonly) {
            if (!container) return;
            if (readonly) readonly.style.display = 'none';
            const sd = container.querySelector('.searchable-dropdown');
            if (sd) {
                sd.style.display = '';
                container.querySelectorAll('select').forEach(el => el.style.display = 'none');
            } else {
                container.querySelectorAll('select').forEach(el => el.style.display = '');
            }
        }

        if (deal.contact_id) {
            const c = contactsList.find(c => c.id === deal.contact_id);
            const contactName = deal.contact_name || (c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : deal.contact_id);
            contactReadonly.textContent = contactName;
            hideAllDropdowns(contactContainer, contactReadonly);
            contactSelect.value = deal.contact_id;
        } else {
            showAllDropdowns(contactContainer, contactReadonly);
            contactSelect.value = '';
            if (dealContactDropdown) dealContactDropdown.setValue('');
        }

        if (deal.company_id) {
            const co = companiesList.find(c => c.id === deal.company_id);
            const companyName = deal.company_name || co?.company_name || deal.company_id;
            companyReadonly.textContent = companyName;
            hideAllDropdowns(companyContainer, companyReadonly);
            companySelect.value = deal.company_id;
        } else {
            showAllDropdowns(companyContainer, companyReadonly);
            companySelect.value = '';
            if (dealCompanyDropdown) dealCompanyDropdown.setValue('');
        }

        openModal('dealModal');
    } catch (error) {
        console.error('Failed to load deal:', error);
        Toast.error('Failed to load deal details');
    }
}

async function deleteDeal(dealId) {
    const confirmed = await showConfirm('Are you sure you want to delete this deal?', 'Delete Deal', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/crm/deals/${dealId}`, { method: 'DELETE' });
        Toast.success('Deal deleted');
        loadPipeline();
    } catch (error) {
        console.error('Failed to delete deal:', error);
        Toast.error('Failed to delete deal');
    }
}

// ==================== Stage Changes ====================

async function changeDealStage(dealId, newStageId) {
    try {
        await api.request(`/crm/deals/${dealId}/stage`, {
            method: 'PUT',
            body: JSON.stringify({ stage_id: newStageId })
        });
        Toast.success('Deal stage updated');
        loadPipeline();
    } catch (error) {
        console.error('Failed to change deal stage:', error);
        Toast.error('Failed to update deal stage');
        renderCurrentView(); // Re-render to restore original position
    }
}

function markDealWon(dealId) {
    pendingStageChange = { dealId, action: 'won' };
    document.getElementById('stageChangeTitle').textContent = 'Mark Deal as Won';
    document.getElementById('stageChangeBody').innerHTML = `
        <p style="color: var(--text-secondary);">
            Are you sure you want to mark this deal as <strong style="color: var(--color-success);">Won</strong>?
        </p>
    `;
    document.getElementById('stageChangeConfirmBtn').className = 'btn btn-success';
    document.getElementById('stageChangeConfirmBtn').innerHTML = `
        <span class="btn-spinner" id="stageChangeSpinner" style="display:none;"></span>
        Mark as Won
    `;
    openModal('stageChangeModal');
}

function markDealLost(dealId) {
    pendingStageChange = { dealId, action: 'lost' };
    document.getElementById('stageChangeTitle').textContent = 'Mark Deal as Lost';
    document.getElementById('stageChangeBody').innerHTML = `
        <p style="color: var(--text-secondary);">
            Are you sure you want to mark this deal as <strong style="color: var(--color-danger);">Lost</strong>?
        </p>
        <div class="mb-3" style="margin-top: 12px;">
            <label for="lostReason" class="form-label">Reason (optional)</label>
            <textarea class="form-control" id="lostReason" rows="2" placeholder="Why was this deal lost?"></textarea>
        </div>
    `;
    document.getElementById('stageChangeConfirmBtn').className = 'btn btn-danger';
    document.getElementById('stageChangeConfirmBtn').innerHTML = `
        <span class="btn-spinner" id="stageChangeSpinner" style="display:none;"></span>
        Mark as Lost
    `;
    openModal('stageChangeModal');
}

async function confirmStageChange() {
    if (!pendingStageChange) return;

    const confirmBtn = document.getElementById('stageChangeConfirmBtn');
    const spinner = document.getElementById('stageChangeSpinner');
    confirmBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const { dealId, action } = pendingStageChange;

    try {
        if (action === 'won') {
            await api.request(`/crm/deals/${dealId}/won`, { method: 'POST' });
            Toast.success('Deal marked as Won!');
        } else if (action === 'lost') {
            const reason = document.getElementById('lostReason')?.value?.trim() || '';
            await api.request(`/crm/deals/${dealId}/lost`, {
                method: 'POST',
                body: JSON.stringify({ reason })
            });
            Toast.success('Deal marked as Lost');
        }

        closeStageChangeModal();
        loadPipeline();
    } catch (error) {
        console.error(`Failed to mark deal as ${action}:`, error);
        Toast.error(`Failed to mark deal as ${action}`);
    } finally {
        confirmBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== Stage Picker (Mobile-friendly) ====================

/**
 * Handle tap on deal card — open stage picker.
 * Ignores taps on buttons (edit, won, lost) via event target check.
 */
function handleDealCardTap(event, dealId) {
    // Bulk-select mode intercepts taps: a tap toggles the deal's
    // membership in the selection set instead of opening the side
    // panel. The opt-out is the same toggle button used to enter
    // bulk mode in the first place.
    if (bulkSelectMode) {
        // Still respect button clicks so the user can edit a card
        // mid-selection if needed.
        if (event.target.closest('button')) return;
        event.preventDefault();
        event.stopPropagation();
        handleBulkCardClick(dealId);
        return;
    }
    // Don't open picker if user clicked a button inside the card
    if (event.target.closest('button')) return;
    // Don't open on drag
    if (event.target.classList.contains('dragging')) return;

    openDealDetailPanel(dealId);
}

function openStagePicker(dealId) {
    const deal = allDeals.find(d => d.id === dealId);
    if (!deal) return;

    stagePickerDealId = dealId;

    // Populate deal info
    const infoEl = document.getElementById('stagePickerDealInfo');
    const value = formatCurrency(parseFloat(deal.deal_value) || 0, deal.currency || defaultCurrency);
    infoEl.innerHTML = `
        <span class="picker-deal-name">${escapeHtml(deal.deal_name || 'Untitled Deal')}</span>
        <span class="picker-deal-value">${value}</span>
    `;

    // Populate stage list
    const listEl = document.getElementById('stagePickerList');
    listEl.innerHTML = dealStages.map(stage => {
        const isCurrent = deal.stage_id === stage.id;
        const stageColor = getStageColor(stage);
        return `
            <button class="stage-picker-item ${isCurrent ? 'current-stage' : ''}"
                    onclick="selectStageFromPicker('${stage.id}')"
                    ${isCurrent ? 'disabled' : ''}>
                <span class="stage-picker-dot" style="background: ${stageColor};"></span>
                <span class="stage-picker-item-info">
                    <span class="stage-picker-item-name">${escapeHtml(stage.stage_name)}</span>
                    ${stage.stage_type && stage.stage_type !== 'open' ? `<span class="stage-picker-item-type">${escapeHtml(stage.stage_type)}</span>` : ''}
                </span>
                ${isCurrent ? `
                    <svg class="stage-picker-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                ` : ''}
            </button>
        `;
    }).join('');

    // Show overlay with animation
    const overlay = document.getElementById('stagePickerOverlay');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });
}

function closeStagePicker() {
    const overlay = document.getElementById('stagePickerOverlay');
    overlay.classList.remove('active');
    setTimeout(() => {
        overlay.style.display = 'none';
    }, 300);
    stagePickerDealId = null;
}

async function selectStageFromPicker(stageId) {
    if (!stagePickerDealId) return;

    const dealId = stagePickerDealId;
    closeStagePicker();
    await changeDealStage(dealId, stageId);
}

// ==================== Currency Formatting ====================

function formatCurrency(amount, currency = 'USD') {
    const symbol = CURRENCY_SYMBOLS[currency] || currency + ' ';

    if (amount >= 1000000) {
        return symbol + (amount / 1000000).toFixed(1) + 'M';
    } else if (amount >= 1000) {
        return symbol + (amount / 1000).toFixed(1) + 'K';
    }
    return symbol + amount.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

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

// ==================== Utilities ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== Deal Detail Slide Panel ====================

async function openDealDetailPanel(dealId) {
    document.getElementById('dealDetailOverlay').classList.add('active');
    document.getElementById('dealDetailPanel').classList.add('active');
    document.getElementById('dealTimeline').innerHTML = '<div class="import-loading">Loading timeline...</div>';
    document.getElementById('dealDetailInfo').innerHTML = '';
    document.getElementById('dealDetailName').textContent = 'Deal Details';

    // Notes written on the deal form were unreachable afterwards — nothing
    // listed them. Mount the panel that does.
    if (typeof NotesPanel !== 'undefined') {
        NotesPanel.mount(document.getElementById('dealNotesPanel'), 'deal', dealId);
    }
    // Activities could be logged and read but never corrected, completed or
    // removed — the timeline projection carries no activity id to act on.
    if (typeof ActivitiesPanel !== 'undefined') {
        ActivitiesPanel.mount(document.getElementById('dealActivitiesPanel'), 'deal', dealId);
    }

    try {
        const deal = await api.request(`/crm/deals/${dealId}`);
        document.getElementById('dealDetailName').textContent = deal.name || 'Unknown Deal';

        const esc = escapeHtml;
        const field = (label, value, html) => value ? `<div class="lead-detail-item"><span class="lead-detail-label">${label}</span><span>${html || esc(String(value))}</span></div>` : '';
        const currency = deal.value ? `₹${Number(deal.value).toLocaleString()}` : null;
        const dealName = deal.name || deal.deal_name || 'Untitled Deal';
        document.getElementById('dealDetailName').textContent = dealName;

        // Stage badge
        const stageHtml = deal.stage_name ? `<span class="tl-chip" style="background:rgba(168,85,247,0.15);color:#a855f7;font-size:0.82rem;">${esc(deal.stage_name)}</span>` : null;

        // Try to find source lead for richer data
        let lead = null;
        try {
            const leads = await api.request('/crm/leads?pageSize=200');
            const allLeads = leads.data || leads || [];
            lead = allLeads.find(l => l.converted_deal_id === dealId);
        } catch {}

        const teamBadge = lead?.team_name ? `<span class="crm-team-badge">${esc(lead.team_name)}</span>` : null;

        // Parse custom fields from lead
        let customHtml = '';
        try {
            const cf = typeof lead?.custom_fields === 'string' ? JSON.parse(lead.custom_fields || '{}') : (lead?.custom_fields || {});
            for (const [k, v] of Object.entries(cf)) {
                if (v) customHtml += field(k.replace(/_/g, ' '), v);
            }
        } catch {}

        document.getElementById('dealDetailInfo').innerHTML = `
            <div class="lead-detail-grid">
                ${field('Lead ID', lead?.lead_number, lead?.lead_number ? `<span class="crm-lead-number">${esc(lead.lead_number)}</span>` : null)}
                ${field('Deal Name', dealName)}
                ${field('Value', currency)}
                ${field('Stage', deal.stage_name, stageHtml)}
                ${field('Contact', deal.contact_name || (lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : null))}
                ${field('Company', deal.company_name || lead?.company_name)}
                ${field('Email', lead?.email)}
                ${field('Phone', lead?.phone, lead?.phone ? crmPhoneLink(lead.phone) : null)}
                ${field('Source', lead?.lead_source)}
                ${field('Team', lead?.team_name, teamBadge)}
                ${field('Owner', lead?.owner_name || deal.owner_name)}
                ${field('City', lead?.city)}
                ${field('Country', lead?.country)}
                ${customHtml}
                ${field('Expected Close', deal.expected_close_date ? new Date(deal.expected_close_date).toLocaleDateString() : null)}
                ${field('Won Reason', deal.won_reason)}
                ${field('Lost Reason', deal.lost_reason)}
                ${deal.notes ? `<div class="lead-detail-item" style="grid-column:1/-1"><span class="lead-detail-label">Notes</span><span>${esc(deal.notes)}</span></div>` : ''}
                <div class="lead-detail-item"><span class="lead-detail-label">Created</span><span>${new Date(deal.created_at).toLocaleString()}</span></div>
            </div>
        `;

        // Load timeline
        const timeline = await api.request(`/crm/deals/${dealId}/timeline`);
        renderDealTimeline(timeline);
    } catch (e) {
        document.getElementById('dealTimeline').innerHTML = `<p style="color:var(--color-error);">${escapeHtml(e.message || 'Failed to load')}</p>`;
    }
}

function printDealTimeline() {
    const name = document.getElementById('dealDetailName')?.textContent || 'Deal';
    const infoHtml = document.getElementById('dealDetailInfo')?.innerHTML || '';
    const timelineHtml = document.getElementById('dealTimeline')?.innerHTML || '';
    const logoUrl = window.location.origin + '/assets/logo-black.png';

    const printWin = window.open('', '_blank');
    printWin.document.write(`<!DOCTYPE html>
<html><head>
<title>${escapeHtml(name)} — Deal Report</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1a1a2e; max-width: 800px; margin: 0 auto; }
    .print-header { border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 16px; }
    .print-header img { height: 28px; margin-bottom: 8px; }
    .print-header h1 { font-size: 1.2rem; margin: 0; color: #1a1a2e; }
    .lead-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .lead-detail-item { display: flex; flex-direction: column; gap: 2px; font-size: 0.85rem; }
    .lead-detail-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
    .crm-status-badge, .crm-team-badge, .crm-lead-number { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: #e5e7eb; display: inline-block; }
    h2 { font-size: 1.1rem; margin: 20px 0 12px; color: #374151; }
    .tl-entry { display: flex; gap: 10px; padding: 8px 0; border-left: 2px solid #d1d5db; margin-left: 8px; padding-left: 16px; position: relative; page-break-inside: avoid; }
    .tl-icon { position: absolute; left: -9px; top: 10px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #fff; border: 2px solid #9ca3af; font-size: 10px; }
    .tl-title { font-weight: 600; font-size: 0.9rem; }
    .tl-desc { font-size: 0.82rem; color: #4b5563; margin-top: 2px; }
    .tl-meta { font-size: 0.75rem; color: #9ca3af; margin-top: 2px; }
    .tl-who { font-weight: 500; color: #374151; }
    .tl-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tl-chip { display: inline-flex; padding: 1px 7px; border-radius: 4px; font-size: 0.68rem; font-weight: 500; background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
    .tl-chip-type { background: #ede9fe; color: #7c3aed; text-transform: uppercase; }
    .tl-chip-outcome { background: #dcfce7; color: #16a34a; }
    .tl-chip-pending { background: #fef3c7; color: #d97706; }
    .print-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 0.7rem; color: #9ca3af; display: flex; justify-content: space-between; }
    @media print { body { padding: 0; } }
</style>
</head><body>
<div class="print-header">
    <img src="${logoUrl}" alt="Ragenaizer"><br>
    <h1>${escapeHtml(name)}</h1>
    <p style="margin:2px 0 0;font-size:0.85rem;color:#6b7280;">Deal Report</p>
</div>
<div class="lead-detail-grid">${infoHtml}</div>
<h2>Full Journey Timeline</h2>
<div>${timelineHtml}</div>
<div class="print-footer">
    <span>Generated ${new Date().toLocaleString()}</span>
    <span>Ragenaizer CRM</span>
</div>
</body></html>`);
    printWin.document.close();
    setTimeout(() => printWin.print(), 400);
}

function filterDealTimeline(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#dealTimeline .tl-entry').forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
}

function closeDealDetailPanel() {
    document.getElementById('dealDetailOverlay').classList.remove('active');
    document.getElementById('dealDetailPanel').classList.remove('active');
}

function renderDealTimeline(entries) {
    const container = document.getElementById('dealTimeline');
    if (!entries || entries.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:20px;">No activity yet</p>';
        return;
    }

    const esc = escapeHtml;
    const iconMap = {
        call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅',
        stage: '🏷️', status_change: '🔄', auto_assigned: '🔀', reassigned: '🔀',
        transferred: '↔️', converted: '🎯', followup: '⏰', transfer: '↔️'
    };

    function formatTimeAgo(date) {
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }

    container.innerHTML = entries.map(e => {
        const icon = iconMap[e.icon] || iconMap[e.type] || '⏳';
        const time = formatTimeAgo(new Date(e.timestamp));
        const desc = e.description ? `<div class="tl-desc">${esc(e.description)}</div>` : '';
        const typeClass = `tl-${e.type}`;
        const who = e.performed_by_name || '';
        const whoLine = who ? `<span class="tl-who">${esc(who)}</span>` : '';

        let chips = '';
        if (e.meta) {
            const c = [];
            if (e.meta.activity_type) c.push(`<span class="tl-chip tl-chip-type">${esc(e.meta.activity_type)}</span>`);
            if (e.meta.contact_outcome || e.outcome) c.push(`<span class="tl-chip tl-chip-outcome">${esc((e.meta.contact_outcome || e.outcome || '').replace(/_/g, ' '))}</span>`);
            if (e.meta.call_duration_seconds > 0) c.push(`<span class="tl-chip">Call: ${Math.floor(e.meta.call_duration_seconds/60)}m</span>`);
            if (e.meta.next_action_date) c.push(`<span class="tl-chip tl-chip-pending">Next: ${new Date(e.meta.next_action_date).toLocaleDateString()}</span>`);
            if (e.meta.to_stage_name) c.push(`<span class="tl-chip" style="background:rgba(168,85,247,0.15);color:#a855f7;">${esc(e.meta.to_stage_name)}</span>`);
            if (e.meta.time_in_stage_minutes) c.push(`<span class="tl-chip" style="background:rgba(99,102,241,0.1);color:#818cf8;">${e.meta.time_in_stage_minutes}m in prev stage</span>`);
            if (c.length) chips = `<div class="tl-chips">${c.join('')}</div>`;
        }

        return `
            <div class="tl-entry ${typeClass}">
                <div class="tl-icon">${icon}</div>
                <div class="tl-content">
                    <div class="tl-header">
                        <span class="tl-title">${esc(e.title)}</span>
                    </div>
                    ${chips}
                    ${desc}
                    <div class="tl-meta">${whoLine ? `${whoLine} · ` : ''}${time}</div>
                </div>
            </div>
        `;
    }).join('');
}
