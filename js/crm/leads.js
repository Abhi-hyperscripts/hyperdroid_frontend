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
let myTeamRole = 'member'; // default to most restrictive
let reassigningLeadId = null;

// Searchable dropdown instances
let filterStatusDropdown = null;
let filterSourceDropdown = null;
let leadSourceDropdown = null;
let leadStatusDropdown = null;

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
    loadMyRole();
    loadLeads();
    loadLeadStats();
    loadSourceFilter();
    loadCampaignFilter();
    loadMyTeamsFilter();
    loadReassignQueueBadge();
    initSearchableDropdowns();
    setupLeadsRealtime();
    // Banner is hidden by default. Poll inbox once on load so users who
    // refresh mid-session don't lose their open requests until SignalR
    // delivers a new event.
    if (typeof window.refreshHelpInboxBanner === 'function') {
        window.refreshHelpInboxBanner();
    }
});

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
        if (count > 0) {
            badge.textContent = count;
            btn.style.display = '';
        } else {
            btn.style.display = 'none';
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
    if (!sel || !group) return;
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
        if (filterTeamDropdown && typeof filterTeamDropdown.rebuild === 'function') {
            filterTeamDropdown.rebuild();
        }
        // Owner filter: only shown to admins/managers/teamleads because
        // regular members can only see their own leads regardless.
        await refreshOwnerFilter();
    } catch (e) {
        console.warn('Failed to load team filter:', e?.message || e);
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
            } catch { _teamMembersCache[t.team_id] = []; }
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
    try {
        const params = buildFilterParams();
        params.set('page', currentPage);
        params.set('pageSize', pageSize);
        const queryString = params.toString();
        const endpoint = `/crm/leads${queryString ? '?' + queryString : ''}`;

        const response = await api.request(endpoint);
        allLeads = response.data || [];
        totalLeads = response.total || allLeads.length;
        // Cache every row we touch so bulk actions retain rich lead data
        // even if the user paginates away before acting on their selection.
        for (const l of allLeads) selectedLeadsData.set(l.id, l);
        renderLeadsTable(allLeads);
        renderPagination();
    } catch (error) {
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

async function loadLeadStats() {
    try {
        const params = buildFilterParams();
        // pageSize/page are list-only — strip from the stats query.
        params.delete('page'); params.delete('pageSize');
        const qs = params.toString();
        const stats = await api.request('/crm/leads/stats' + (qs ? '?' + qs : ''));
        document.getElementById('statTotalLeads').textContent = stats.total_leads ?? '-';
        document.getElementById('statNewLeads').textContent = stats.new_leads ?? '-';
        document.getElementById('statQualifiedLeads').textContent = stats.qualified ?? '-';
        document.getElementById('statConvertedLeads').textContent = stats.converted ?? '-';
    } catch (error) {
        console.error('Failed to load lead stats:', error);
    }
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
    if (!sel) return;
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

    if (filterSourceDropdown && typeof filterSourceDropdown.rebuild === 'function') {
        filterSourceDropdown.rebuild();
    }
}

// ==================== Filter Handling ====================

/**
 * Build query params from filter inputs
 */
function buildFilterParams() {
    const params = new URLSearchParams();
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
        if (source.startsWith('__legacy:')) params.set('source', source.slice('__legacy:'.length));
        else params.set('leadSourceId', source);
    }
    if (search) params.set('search', search);
    if (emailStatus) params.set('emailStatus', emailStatus);
    if (campaignId) params.set('campaignId', campaignId);

    // Multi-team scope: when the user has picked a specific team, backend
    // narrows leads to that team (manager/TL sees all, member sees own).
    const teamEl = document.getElementById('filterTeam');
    if (teamEl && teamEl.value) params.set('teamId', teamEl.value);

    // Owner filter: privileged caller (admin/manager/TL) can narrow to one
    // specific salesperson's leads — used to isolate a departing member's
    // pipeline before bulk-reassign.
    const ownerEl = document.getElementById('filterOwner');
    if (ownerEl && ownerEl.value) {
        // "Unassigned" sentinel → backend gets a special value that matches
        // owner_user_id IS NULL. For now we just skip sending — admin caller
        // would need a dedicated flag. Document as a later polish.
        if (ownerEl.value !== '__unassigned__') params.set('ownerUserId', ownerEl.value);
    }

    // Form-answer filter — owned by the shared FormAnswersFilter module.
    // Only meaningful when a single non-legacy source is picked (the
    // module also enforces this on the button-state side). Serialised
    // as JSON so AND-across-keys / IN-within-values survive the URL.
    if (source && !source.startsWith('__legacy:')) {
        const fa = (typeof FormAnswersFilter !== 'undefined') ? FormAnswersFilter.getFilter() : null;
        if (fa && Object.keys(fa).length > 0) params.set('customFields', JSON.stringify(fa));
    }

    return params;
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
    if (!sel) return;
    try {
        const resp = await api.request('/email-campaigns');
        const items = (resp && resp.items) || [];
        // Newest first — matches campaigns list ordering.
        items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        sel.innerHTML = '<option value="">All campaigns</option>' +
            items.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.status})</option>`).join('');
    } catch (_) { /* silent fallback */ }
}

/**
 * Apply filters and reload leads
 */
function applyFilters() {
    currentPage = 1;
    loadLeads();
    // Stats card mirrors the filtered list — kick a fresh stats load on every
    // filter change so KPIs reflect whatever the user is currently looking at.
    loadLeadStats();
}

// ==================== Table Rendering ====================

/**
 * Render the leads table
 */
function renderLeadsTable(leads) {
    const tbody = document.getElementById('leadsTableBody');

    if (!leads || leads.length === 0) {
        // Members can't create leads — they get assigned. Match the toolbar gating
        // applied in loadMyRole() so the empty state isn't a dead-end CTA.
        const isMember = myTeamRole === 'member' || myTeamRole === 'none';
        const cta = isMember
            ? `<p style="color:var(--text-secondary);font-size:0.85rem;margin-top:6px;">Leads will appear here once your team lead assigns them to you.</p>`
            : `<button class="btn btn-sm btn-primary" onclick="openNewLeadModal()">Add your first lead</button>`;
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <line x1="23" y1="11" x2="17" y2="11"/>
                            <line x1="20" y1="8" x2="20" y2="14"/>
                        </svg>
                        <p>No leads found</p>
                        ${cta}
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = leads.map(lead => {
        const isAssigned = !!(lead.team_id || lead.teamName || lead.team_name);
        const rowClass = isAssigned ? ' class="crm-lead-assigned"' : '';
        const cbTooltip = isAssigned
            ? 'title="Already assigned to a team — bulk-assign will skip, but the lead can still be included in campaigns or exports."'
            : '';
        return `
        <tr data-lead-id="${lead.id}"${rowClass}>
            <td class="td-checkbox">
                <input type="checkbox" class="lead-checkbox" value="${lead.id}"
                    onchange="toggleLeadSelection('${lead.id}', this.checked)"
                    ${selectedLeadIds.has(lead.id) ? 'checked' : ''}
                    ${cbTooltip}>
            </td>
            <td>
                <span class="crm-lead-number">${escapeHtml(lead.leadNumber || lead.lead_number || '-')}</span>
            </td>
            <td onclick="openLeadDetailPanel('${lead.id}')" style="cursor:pointer;">
                <div class="crm-cell-primary">
                    ${escapeHtml(lead.first_name || '')} ${escapeHtml(lead.last_name || '')}${getCustomFieldsBadge(lead.custom_fields)}
                </div>
                ${lead.company_name ? `<div class="crm-cell-secondary">${escapeHtml(lead.company_name)}</div>` : (lead.company ? `<div class="crm-cell-secondary">${escapeHtml(lead.company)}</div>` : '')}
            </td>
            <td>
                <span class="crm-cell-secondary">${escapeHtml(lead.email || '-')}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${escapeHtml(lead.phone || '-')}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-source-badge source-${lead.lead_source || 'manual'}">${formatSource(lead.lead_source)}</span>
            </td>
            <td>
                ${(lead.team_id || lead.team_name) ? `<span class="crm-status-badge status-${lead.status || 'new'}" onclick="openStatusChangeModal('${lead.id}')" style="cursor:pointer;" data-tooltip="Click to change status">${formatStatus(lead.status)}</span>` : `<span class="crm-status-badge status-new" data-tooltip="Assign to team first">${formatStatus(lead.status)}</span>`}
                ${lead.disposition ? `<span class="crm-disposition-badge disp-${lead.disposition}" title="${formatDisposition(lead.disposition)}">${formatDisposition(lead.disposition)}</span>` : ''}
                ${lead.next_followup_date ? formatFollowupIndicator(lead.next_followup_date) : ''}
                ${lead.has_pending_transfer ? '<span class="crm-transfer-pending-badge" data-tooltip="Transfer/Reassignment pending approval">⇄ Transfer Pending</span>' : ''}
            </td>
            <td class="hide-mobile">
                ${renderEmailEngagement(lead)}
            </td>
            <td class="hide-mobile">
                ${lead.teamName || lead.team_name ? `<span class="crm-team-badge ${teamColorClass(lead.teamName || lead.team_name)}">${escapeHtml(lead.teamName || lead.team_name)}</span>` : '<span class="crm-cell-secondary">—</span>'}
            </td>
            <td class="hide-mobile">
                ${renderOwnerCell(lead)}
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${formatDate(lead.created_at)}</span>
            </td>
            <td>
                <div class="crm-actions">
                    ${(lead.team_id || lead.team_name) ? `<button class="crm-action-btn" onclick="openLogActivityModal('${lead.id}')" data-tooltip="Log Activity">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                        </svg>
                    </button>` : ''}
                    <button class="crm-action-btn" onclick="editLead('${lead.id}')" data-tooltip="Edit Lead">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    ${canDeleteLead() && (lead.team_id || lead.team_name) ? `<button class="crm-action-btn" onclick="openReassignModal('${lead.id}')" data-tooltip="Reassign to Member">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="8.5" cy="7" r="4"/>
                            <polyline points="17 11 19 13 23 9"/>
                        </svg>
                    </button>` : ''}
                    ${lead.status === 'qualified' ? `
                    <button class="crm-action-btn action-convert" onclick="openConvertModal('${lead.id}')" data-tooltip="Convert to Contact + Deal">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                            <polyline points="17 6 23 6 23 12"/>
                        </svg>
                    </button>
                    ` : ''}
                    ${canDeleteLead() ? `<button class="crm-action-btn action-delete" onclick="deleteLead('${lead.id}')" data-tooltip="Delete Lead">
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

function teamColorClass(name) {
    if (!name) return '';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const colors = ['team-indigo', 'team-emerald', 'team-amber', 'team-rose', 'team-cyan', 'team-violet', 'team-orange', 'team-teal'];
    return colors[Math.abs(hash) % colors.length];
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
    return d.innerHTML;
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

        return ` <span class="crm-custom-fields-badge" title="${tooltipItems}${extra}">+${count} fields</span>`;
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
    return div.innerHTML;
}
