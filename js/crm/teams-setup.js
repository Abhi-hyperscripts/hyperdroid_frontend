// ============================================================================
//  CRM Settings — Functional Groups + Teams Setup tabs
//
//  Policy recap (enforced on both sides, repeated here for readers):
//    - A team MUST have at least one functional group at create-time.
//    - A team MUST have exactly one active manager (create-time picks one).
//    - Team Leads and Members are optional — a one-person team = just manager.
//    - A user can only be on ONE team at a time (backend returns 409 otherwise).
//    - Functional groups in use by a team can't be deleted (backend 409s).
// ============================================================================

(function () {
    'use strict';

    // ─── State ─────────────────────────────────────────────────────────────

    // Caches. Reloaded on tab entry + after mutations.
    let _functionalGroups = [];
    let _teams = [];
    let _users = [];    // all tenant users with their current team (if any)

    // Edit state for the FG modal.
    let _editingFgId = null;

    // Edit state for the Team modal — see the state-machine comment in the
    // file header.
    const TEAM_ROLES = { MANAGER: 'manager', TEAMLEAD: 'teamlead', MEMBER: 'member' };
    let _teamModal = resetTeamModalState();

    function resetTeamModalState() {
        return {
            mode: 'create',
            teamId: null,
            original: null,              // server team object when editing
            selectedFaIds: new Set(),
            manager: null,               // { user_id, email, display_name }
            teamleads: [],               // [{...}, ...]
            members: [],                 // [{...}, ...]
            // Map<userId, { replacementUserId: string|null, unassign: bool }>
            // Captured when the user clicks × on a member who owns open
            // leads — used by syncMembersDiff to attach reassign params to
            // the eventual DELETE call.
            pendingRemovals: new Map()
        };
    }

    // ─── API helpers ───────────────────────────────────────────────────────

    function apiGet(path)           { return api.request(`/crm${path}`); }
    function apiPost(path, body)    { return api.request(`/crm${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }); }
    function apiPut(path, body)     { return api.request(`/crm${path}`, { method: 'PUT',  body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }); }
    function apiDelete(path)        { return api.request(`/crm${path}`, { method: 'DELETE' }); }

    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    }

    function toastErr(e, fallback) {
        const msg = (e && e.message) || fallback || 'Something went wrong';
        if (typeof Toast !== 'undefined') Toast.error(msg);
        else alert(msg);
        console.error(e);
    }

    function toastOk(msg) {
        if (typeof Toast !== 'undefined') Toast.success(msg);
    }

    // ============================================================================
    //  FUNCTIONAL GROUPS tab
    // ============================================================================

    async function loadFunctionalGroups() {
        const loading = document.getElementById('fgLoading');
        const table   = document.getElementById('fgTableWrapper');
        const empty   = document.getElementById('fgEmptyState');

        loading.style.display = 'block';
        table.style.display = 'none';
        empty.style.display = 'none';

        try {
            // Fetch FAs AND teams-using counts derived from the teams list.
            // (Backend doesn't expose a "count teams per FA" aggregate, but the
            // teams list already returns each team's FA list, so we can count
            // client-side with zero extra round-trips.)
            const [fgs, teams] = await Promise.all([
                apiGet('/functional-areas'),
                apiGet('/teams')
            ]);
            _functionalGroups = Array.isArray(fgs) ? fgs : [];
            _teams = Array.isArray(teams) ? teams : [];

            // Build fa_id → teams-using count
            const usage = new Map();
            for (const t of _teams) {
                for (const fa of (t.functional_areas || [])) {
                    usage.set(fa.id, (usage.get(fa.id) || 0) + 1);
                }
            }

            loading.style.display = 'none';
            if (_functionalGroups.length === 0) {
                empty.style.display = 'block';
                if (typeof refreshSetupProgress === 'function') refreshSetupProgress();
                return;
            }
            renderFunctionalGroupsTable(_functionalGroups, usage);
            table.style.display = 'block';
            if (typeof refreshSetupProgress === 'function') refreshSetupProgress();
        } catch (e) {
            loading.style.display = 'none';
            toastErr(e, 'Failed to load functional groups');
        }
    }

    function renderFunctionalGroupsTable(list, usage) {
        const tbody = document.getElementById('fgTableBody');
        tbody.innerHTML = list.map(fg => {
            const count = usage.get(fg.id) || 0;
            const badgeClass = count > 0 ? 'fg-teams-badge fg-teams-badge--inuse' : 'fg-teams-badge';
            return `
                <tr>
                    <td><strong>${esc(fg.name)}</strong></td>
                    <td><span style="color: var(--text-secondary);">${esc(fg.description || '—')}</span></td>
                    <td><span class="${badgeClass}">${count} team${count === 1 ? '' : 's'}</span></td>
                    <td style="text-align: right;">
                        <button class="team-card-iconbtn" onclick="openEditFunctionalGroupModal('${esc(fg.id)}')" aria-label="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="team-card-iconbtn team-card-iconbtn--danger" onclick="deleteFunctionalGroup('${esc(fg.id)}', '${esc(fg.name)}')" aria-label="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </td>
                </tr>`;
        }).join('');
    }

    function openCreateFunctionalGroupModal() {
        _editingFgId = null;
        document.getElementById('fgModalTitle').textContent = 'Add Functional Group';
        document.getElementById('fgNameInput').value = '';
        document.getElementById('fgDescInput').value = '';
        document.getElementById('fgOrderInput').value = '0';
        openGmOverlay('fgModal');
        setTimeout(() => document.getElementById('fgNameInput').focus(), 50);
    }

    function openEditFunctionalGroupModal(id) {
        const fg = _functionalGroups.find(f => f.id === id);
        if (!fg) return toastErr(null, 'Functional group not found');
        _editingFgId = id;
        document.getElementById('fgModalTitle').textContent = 'Edit Functional Group';
        document.getElementById('fgNameInput').value = fg.name || '';
        document.getElementById('fgDescInput').value = fg.description || '';
        document.getElementById('fgOrderInput').value = fg.display_order ?? 0;
        openGmOverlay('fgModal');
        setTimeout(() => document.getElementById('fgNameInput').focus(), 50);
    }

    function closeFunctionalGroupModal() { closeGmOverlay('fgModal'); }

    async function saveFunctionalGroup() {
        const name = document.getElementById('fgNameInput').value.trim();
        const description = document.getElementById('fgDescInput').value.trim();
        const display_order = parseInt(document.getElementById('fgOrderInput').value, 10) || 0;

        if (!name) return toastErr(null, 'Name is required');

        const btn = document.getElementById('fgSaveBtn');
        btn.disabled = true;
        try {
            if (_editingFgId) {
                await apiPut(`/functional-areas/${_editingFgId}`, { name, description: description || null, display_order });
                toastOk('Functional group updated');
            } else {
                await apiPost('/functional-areas', { name, description: description || null, display_order });
                toastOk('Functional group created');
            }
            closeFunctionalGroupModal();
            await loadFunctionalGroups();
        } catch (e) {
            toastErr(e, 'Failed to save functional group');
        } finally {
            btn.disabled = false;
        }
    }

    async function deleteFunctionalGroup(id, name) {
        if (!confirm(`Delete functional group "${name}"?\n\nIt must not be assigned to any team.`)) return;
        try {
            await apiDelete(`/functional-areas/${id}`);
            toastOk('Functional group deleted');
            await loadFunctionalGroups();
        } catch (e) {
            toastErr(e, 'Failed to delete functional group');
        }
    }

    // ============================================================================
    //  TEAMS SETUP tab
    // ============================================================================

    // ── Allow-Member-Deal-Edits toggle ─────────────────────────────────────
    const MEMBER_DEAL_EDITS_KEY = 'allow_member_deal_edits';
    let _memberDealEditsWired = false;

    function setMemberDealEditsLabel(enabled) {
        const label = document.getElementById('toggleMemberDealEditsLabel');
        const track = document.getElementById('toggleMemberDealEditsTrack');
        const knob  = document.getElementById('toggleMemberDealEditsKnob');
        if (label) label.textContent = enabled ? 'Enabled' : 'Disabled';
        if (track) track.style.background = enabled
            ? 'var(--brand-primary, #6366f1)'
            : 'var(--border-color, #d1d5db)';
        if (knob)  knob.style.transform = enabled ? 'translateX(18px)' : 'translateX(0)';
    }

    async function loadMemberDealEditsToggle() {
        const cb    = document.getElementById('toggleMemberDealEdits');
        const label = document.getElementById('toggleMemberDealEditsLabel');
        const hint  = document.getElementById('memberDealEditsHint');
        if (!cb) return;

        try {
            const res = await apiGet(`/crm-settings/${MEMBER_DEAL_EDITS_KEY}`);
            const enabled = String(res?.value ?? 'false').toLowerCase() === 'true';
            cb.checked = enabled;
            setMemberDealEditsLabel(enabled);

            // Page is already gated to CRM_ADMIN/SUPERADMIN; enable control.
            cb.disabled = false;
            if (hint) hint.style.display = 'none';

            if (!_memberDealEditsWired) {
                _memberDealEditsWired = true;
                cb.addEventListener('change', async () => {
                    const desired = cb.checked;
                    cb.disabled = true;
                    if (label) label.textContent = 'Saving…';
                    try {
                        await apiPut(`/crm-settings/${MEMBER_DEAL_EDITS_KEY}`, { Value: desired ? 'true' : 'false' });
                        setMemberDealEditsLabel(desired);
                        toastOk(desired
                            ? 'Team members can now move deals and edit deal fields.'
                            : 'Only Team Leads, Managers, and Admins can move/edit deals now.');
                    } catch (e) {
                        // Roll back on failure.
                        cb.checked = !desired;
                        setMemberDealEditsLabel(!desired);
                        toastErr(e, 'Failed to update setting');
                    } finally {
                        cb.disabled = false;
                    }
                });
            }
        } catch (e) {
            if (label) label.textContent = 'Unavailable';
            cb.disabled = true;
            if (hint) {
                hint.style.display = 'block';
                hint.textContent = 'Could not load this setting. Check your connection or reload the page.';
            }
            console.error('Failed to load member-deal-edits toggle', e);
        }
    }

    async function loadTeamsTab() {
        const loading = document.getElementById('teamsLoading');
        const grid    = document.getElementById('teamsGrid');
        const empty   = document.getElementById('teamsEmptyState');
        const hint    = document.getElementById('teamsNoFaHint');

        loading.style.display = 'block';
        grid.style.display = 'none';
        empty.style.display = 'none';
        hint.style.display = 'none';

        // Kick off the Member-Deal-Edits toggle load in parallel (non-blocking).
        loadMemberDealEditsToggle();

        try {
            const [teams, fgs, users] = await Promise.all([
                apiGet('/teams'),
                apiGet('/functional-areas'),
                apiGet('/teams/users')
            ]);
            _teams = Array.isArray(teams) ? teams : [];
            _functionalGroups = Array.isArray(fgs) ? fgs : [];
            _users = Array.isArray(users) ? users : [];

            loading.style.display = 'none';

            // Disable Create Team button if there are no FAs yet; show hint.
            const createBtn = document.getElementById('createTeamBtn');
            if (_functionalGroups.length === 0) {
                createBtn.disabled = true;
                createBtn.title = 'Create a functional group first';
                hint.style.display = 'flex';
            } else {
                createBtn.disabled = false;
                createBtn.title = '';
            }

            if (_teams.length === 0) {
                empty.style.display = 'block';
                if (typeof refreshSetupProgress === 'function') refreshSetupProgress();
                return;
            }

            renderTeamsGrid(_teams);
            grid.style.display = 'grid';
            if (typeof refreshSetupProgress === 'function') refreshSetupProgress();
        } catch (e) {
            loading.style.display = 'none';
            toastErr(e, 'Failed to load teams');
        }
    }

    function renderTeamsGrid(teams) {
        const grid = document.getElementById('teamsGrid');
        grid.innerHTML = teams.map(t => {
            const members = t.members || [];
            const manager = members.find(m => m.role === TEAM_ROLES.MANAGER);
            const teamleadCount = members.filter(m => m.role === TEAM_ROLES.TEAMLEAD).length;
            const memberCount   = members.filter(m => m.role === TEAM_ROLES.MEMBER).length;
            const fas = (t.functional_areas || []);
            const statusClass = `team-card-status--${t.status}`;
            return `
                <div class="team-card" onclick="openEditTeamModal('${esc(t.id)}')">
                    <div class="team-card-head">
                        <div style="min-width: 0;">
                            <h4 class="team-card-title">${esc(t.team_name)}</h4>
                            <div class="team-card-code">${esc(t.team_code)}</div>
                        </div>
                        <span class="team-card-status ${statusClass}">${esc(t.status)}</span>
                    </div>
                    ${t.description ? `<p class="team-card-desc">${esc(t.description)}</p>` : ''}
                    <div class="team-card-fa-row">
                        ${fas.length === 0
                            ? `<span style="color: var(--text-muted); font-size: 0.78rem; font-style: italic;">No functional groups</span>`
                            : fas.map(f => `<span class="fa-chip">${esc(f.name)}</span>`).join('')}
                    </div>
                    <div class="team-card-foot">
                        <span class="team-card-stat" title="Manager">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            ${manager ? esc(manager.display_name || manager.email || 'Manager') : 'No manager'}
                        </span>
                        <span class="team-card-stat" title="Team leads">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                            ${teamleadCount} TL
                        </span>
                        <span class="team-card-stat" title="Members">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                            ${memberCount}
                        </span>
                        <div class="team-card-actions">
                            <button class="team-card-iconbtn" onclick="event.stopPropagation(); window.openTriggersModal && window.openTriggersModal('${esc(t.id)}', '${esc(t.team_name)}')" aria-label="Email triggers" title="Email triggers">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                            </button>
                            <button class="team-card-iconbtn team-card-iconbtn--danger" onclick="event.stopPropagation(); deleteTeam('${esc(t.id)}', '${esc(t.team_name)}')" aria-label="Delete">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('');
    }

    function openCreateTeamModal() {
        if (_functionalGroups.length === 0) {
            return toastErr(null, 'Please create at least one Functional Group first.');
        }
        _teamModal = resetTeamModalState();
        document.getElementById('teamModalTitle').textContent = 'Create Team';
        document.getElementById('teamSaveBtn').textContent = 'Create Team';
        document.getElementById('teamNameInput').value = '';
        document.getElementById('teamCodeInput').value = '';
        document.getElementById('teamDescInput').value = '';
        renderFaPicker();
        renderManagerSlot();
        renderTeamleadSlots();
        renderMemberSlots();
        openGmOverlay('teamModal');
        setTimeout(() => document.getElementById('teamNameInput').focus(), 50);
    }

    async function openEditTeamModal(teamId) {
        try {
            const team = await apiGet(`/teams/${teamId}`);
            _teamModal = resetTeamModalState();
            _teamModal.mode = 'edit';
            _teamModal.teamId = teamId;
            _teamModal.original = team;

            (team.functional_areas || []).forEach(f => _teamModal.selectedFaIds.add(f.id));

            const members = team.members || [];
            _teamModal.manager   = members.find(m => m.role === TEAM_ROLES.MANAGER)  || null;
            _teamModal.teamleads = members.filter(m => m.role === TEAM_ROLES.TEAMLEAD);
            _teamModal.members   = members.filter(m => m.role === TEAM_ROLES.MEMBER);

            document.getElementById('teamModalTitle').textContent = `Edit Team — ${team.team_name}`;
            document.getElementById('teamSaveBtn').textContent = 'Save Changes';
            document.getElementById('teamNameInput').value = team.team_name || '';
            document.getElementById('teamCodeInput').value = team.team_code || '';
            document.getElementById('teamDescInput').value = team.description || '';
            renderFaPicker();
            renderManagerSlot();
            renderTeamleadSlots();
            renderMemberSlots();
            openGmOverlay('teamModal');
        } catch (e) {
            toastErr(e, 'Failed to load team');
        }
    }

    function closeTeamModal() { closeGmOverlay('teamModal'); }

    // ─── FA chip picker inside Team modal ──────────────────────────────────

    function renderFaPicker() {
        const host = document.getElementById('teamFaPicker');
        if (_functionalGroups.length === 0) { host.innerHTML = ''; return; }
        host.innerHTML = _functionalGroups.map(fg => {
            const selected = _teamModal.selectedFaIds.has(fg.id);
            return `<button type="button" class="fa-chip-option ${selected ? 'selected' : ''}" data-fa-id="${esc(fg.id)}">${esc(fg.name)}</button>`;
        }).join('');
        host.querySelectorAll('.fa-chip-option').forEach(el => {
            el.onclick = () => {
                const id = el.dataset.faId;
                if (_teamModal.selectedFaIds.has(id)) _teamModal.selectedFaIds.delete(id);
                else _teamModal.selectedFaIds.add(id);
                el.classList.toggle('selected');
            };
        });
    }

    // ─── Manager / Team Lead / Member slots ────────────────────────────────
    //
    // Picking a user uses a native <select> surfaced through the project's
    // auto-searchable-select pattern isn't suitable here because we want an
    // "add multiple" button, so I'm using SearchableDropdown directly.

    function getAvailableUsersExcluding(excludeIds) {
        const exclude = new Set(excludeIds);
        // Only active users, and not already assigned to a slot in THIS modal.
        // Multi-team is allowed now: a user can be on multiple teams (the
        // client use-case is the same sales team working 3–4 campaigns; each
        // campaign lives in its own team so the manager gets a per-campaign
        // dashboard). The DB still enforces "no duplicate (team, user)" so
        // editing this team can't accidentally double-add someone.
        return _users.filter(u => {
            if (!u.is_active) return false;
            if (exclude.has(u.user_id)) return false;
            return true;
        });
    }

    function renderManagerSlot() {
        const host = document.getElementById('teamManagerPicker');
        if (_teamModal.manager) {
            host.innerHTML = `
                <div class="team-role-user">
                    <div class="team-role-user-name">
                        ${esc(_teamModal.manager.display_name || _teamModal.manager.email || 'Manager')}
                        ${_teamModal.manager.email ? `<span class="team-role-user-email" style="display: block;">${esc(_teamModal.manager.email)}</span>` : ''}
                    </div>
                    <button type="button" class="team-role-user-remove" aria-label="Remove manager" onclick="_removeManager()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`;
        } else {
            host.innerHTML = `
                <button type="button" class="team-role-add-btn" onclick="_addManager()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Select manager
                </button>
                <div class="team-role-empty" style="margin-top: 4px;">A team needs a manager to go active.</div>`;
        }
    }

    function renderTeamleadSlots() { renderMultiRoleSlots('teamTeamleadList', _teamModal.teamleads, 'teamlead', 'Add team lead'); }
    function renderMemberSlots()   { renderMultiRoleSlots('teamMemberList',   _teamModal.members,   'member',   'Add member'); }

    function renderMultiRoleSlots(hostId, list, roleKey, addLabel) {
        const host = document.getElementById(hostId);
        let html = list.map((u, i) => `
            <div class="team-role-user">
                <div class="team-role-user-name">
                    ${esc(u.display_name || u.email || u.user_id)}
                    ${u.email ? `<span class="team-role-user-email" style="display: block;">${esc(u.email)}</span>` : ''}
                </div>
                <button type="button" class="team-role-user-remove" aria-label="Remove" onclick="_removeRoleUser('${roleKey}', ${i})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>`).join('');
        html += `<button type="button" class="team-role-add-btn" onclick="_addRoleUser('${roleKey}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${addLabel}
        </button>`;
        host.innerHTML = html;
    }

    // Inline "add user" uses a simple prompt-style picker: open a temporary
    // overlay with a searchable list. Keeps the modal simple — no nested
    // dropdowns.

    /**
     * @param {string} title
     * @param {string[]} excludeIds
     * @param {Function} onPick - single-select: called with one user. multi: called with array.
     * @param {boolean} multi - if true, show checkboxes + "Add Selected" button
     */
    function openUserPicker(title, excludeIds, onPick, multi = false) {
        const existing = document.getElementById('_userPickerOverlay');
        if (existing) existing.remove();

        const candidates = getAvailableUsersExcluding(excludeIds);
        const selected = new Set();
        const overlay = document.createElement('div');
        overlay.id = '_userPickerOverlay';
        overlay.className = 'gm-overlay active';
        overlay.style.zIndex = '10050';
        overlay.innerHTML = `
            <div class="gm-modal" style="max-width: 460px; width: 92vw;">
                <div class="gm-header">
                    <h3>${esc(title)}</h3>
                    <button type="button" class="gm-close" aria-label="Close">&times;</button>
                </div>
                <div class="gm-body" style="padding: 16px 20px;">
                    <input type="text" class="form-control" placeholder="Search by name or email…" id="_userPickerSearch" autocomplete="off">
                    <div id="_userPickerList" style="margin-top: 10px; max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;"></div>
                </div>
                ${multi ? `<div class="gm-footer" style="display:flex;justify-content:space-between;align-items:center;">
                    <span id="_userPickerCount" style="font-size:0.82rem;color:var(--text-secondary);">0 selected</span>
                    <button type="button" class="btn btn-primary btn-sm" id="_userPickerDone">Add Selected</button>
                </div>` : ''}
            </div>`;
        document.body.appendChild(overlay);

        const render = (q) => {
            const list = document.getElementById('_userPickerList');
            const qLower = (q || '').toLowerCase();
            const filtered = !qLower ? candidates : candidates.filter(u =>
                (u.email || '').toLowerCase().includes(qLower) ||
                (u.first_name || '').toLowerCase().includes(qLower) ||
                (u.last_name || '').toLowerCase().includes(qLower));
            if (filtered.length === 0) {
                list.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; padding: 12px; text-align: center;">${candidates.length === 0 ? 'No available users — everyone else is already on another team.' : 'No match'}</div>`;
                return;
            }
            list.innerHTML = filtered.map(u => {
                const isSelected = selected.has(u.user_id);
                return `
                <button type="button" class="team-role-user" style="cursor: pointer; text-align: left; width: 100%; border: 1px solid ${isSelected ? 'var(--brand-primary)' : 'var(--border-color)'}; ${isSelected ? 'background: rgba(var(--brand-primary-rgb),0.08);' : ''}" data-user-id="${esc(u.user_id)}">
                    <div class="team-role-user-name" style="display:flex;align-items:center;gap:8px;">
                        ${multi ? `<span style="width:18px;height:18px;border-radius:4px;border:2px solid ${isSelected ? 'var(--brand-primary)' : 'var(--border-color)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;${isSelected ? 'background:var(--brand-primary);' : ''}">${isSelected ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</span>` : ''}
                        <div>
                            ${esc(u.display_name || (u.first_name + ' ' + (u.last_name || '')).trim() || u.email)}
                            ${u.email ? `<span class="team-role-user-email" style="display: block;">${esc(u.email)}</span>` : ''}
                        </div>
                    </div>
                </button>`;
            }).join('');
            list.querySelectorAll('[data-user-id]').forEach(btn => {
                btn.onclick = () => {
                    const uid = btn.dataset.userId;
                    if (multi) {
                        if (selected.has(uid)) selected.delete(uid); else selected.add(uid);
                        render(document.getElementById('_userPickerSearch').value);
                        const countEl = document.getElementById('_userPickerCount');
                        if (countEl) countEl.textContent = `${selected.size} selected`;
                    } else {
                        const u = candidates.find(x => x.user_id === uid);
                        overlay.remove();
                        onPick(u);
                    }
                };
            });
        };
        render('');
        document.getElementById('_userPickerSearch').oninput = e => render(e.target.value);
        overlay.querySelector('.gm-close').onclick = () => overlay.remove();
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        if (multi) {
            document.getElementById('_userPickerDone').onclick = () => {
                const picked = candidates.filter(u => selected.has(u.user_id));
                overlay.remove();
                onPick(picked);
            };
        }
        setTimeout(() => document.getElementById('_userPickerSearch').focus(), 60);
    }

    function _addManager() {
        const exclude = [
            ..._teamModal.teamleads.map(u => u.user_id),
            ..._teamModal.members.map(u => u.user_id)
        ];
        openUserPicker('Select manager', exclude, (user) => {
            _teamModal.manager = {
                user_id: user.user_id,
                email: user.email,
                display_name: user.display_name || ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || user.email
            };
            renderManagerSlot();
        });
    }

    async function _removeManager() {
        if (!_teamModal.manager) return;
        const ok = await _gateRemoval(_teamModal.manager);
        if (!ok) return;
        _teamModal.manager = null;
        renderManagerSlot();
    }

    function _addRoleUser(roleKey) {
        const list = (roleKey === 'teamlead') ? _teamModal.teamleads : _teamModal.members;
        const exclude = [
            ...(_teamModal.manager ? [_teamModal.manager.user_id] : []),
            ..._teamModal.teamleads.map(u => u.user_id),
            ..._teamModal.members.map(u => u.user_id)
        ];
        const label = roleKey === 'teamlead' ? 'Select team lead(s)' : 'Select member(s)';
        openUserPicker(label, exclude, (users) => {
            // multi-select returns array
            const picked = Array.isArray(users) ? users : [users];
            for (const user of picked) {
                list.push({
                    user_id: user.user_id,
                    email: user.email,
                    display_name: user.display_name || ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || user.email,
                    role: roleKey
                });
            }
            if (roleKey === 'teamlead') renderTeamleadSlots(); else renderMemberSlots();
        }, true);  // multi = true
    }

    async function _removeRoleUser(roleKey, index) {
        const list = (roleKey === 'teamlead') ? _teamModal.teamleads : _teamModal.members;
        const target = list[index];
        if (!target) return;
        const ok = await _gateRemoval(target);
        if (!ok) return;
        list.splice(index, 1);
        if (roleKey === 'teamlead') renderTeamleadSlots(); else renderMemberSlots();
    }

    // Gate a member-remove click: if the user owns open leads on this team,
    // pop the reassign-or-unassign modal. Returns true when the caller may
    // proceed with the local splice (either the user had no leads, or the
    // operator made a reassignment plan that's been recorded in
    // _teamModal.pendingRemovals). Returns false when the operator cancels.
    async function _gateRemoval(userObj) {
        // Only edit-mode and only for users who were on the team server-side.
        // Unsaved adds (user added in this session, not yet POSTed) can't have
        // leads, so skip the API roundtrip.
        if (_teamModal.mode !== 'edit' || !_teamModal.teamId) return true;
        const original = _teamModal.original;
        const wasOriginalMember = original && (original.members || [])
            .some(m => m.user_id === userObj.user_id && m.is_active !== false);
        if (!wasOriginalMember) return true;

        let res;
        try {
            res = await apiGet(`/teams/${_teamModal.teamId}/members/${userObj.user_id}/open-leads-count`);
        } catch (e) {
            console.warn('open-leads-count check failed', e);
            return confirm('Could not verify open leads. Remove anyway?');
        }
        const count = (res && typeof res.count === 'number') ? res.count : 0;
        if (count === 0) return true;

        // Build the picker pool: every other current team member (still in
        // the modal's working set), excluding the user being removed and
        // anyone else queued for removal in this session.
        const pool = [];
        if (_teamModal.manager && _teamModal.manager.user_id !== userObj.user_id
            && !_teamModal.pendingRemovals.has(_teamModal.manager.user_id)) {
            pool.push({ ..._teamModal.manager, role: 'manager' });
        }
        for (const u of _teamModal.teamleads) {
            if (u.user_id !== userObj.user_id && !_teamModal.pendingRemovals.has(u.user_id))
                pool.push({ ...u, role: 'teamlead' });
        }
        for (const u of _teamModal.members) {
            if (u.user_id !== userObj.user_id && !_teamModal.pendingRemovals.has(u.user_id))
                pool.push({ ...u, role: 'member' });
        }

        const plan = await openReassignModal(userObj, count, pool);
        if (!plan) return false;
        _teamModal.pendingRemovals.set(userObj.user_id, plan);
        return true;
    }

    // Returns a Promise<{replacementUserId: string|null, unassign: bool} | null>.
    // null = operator cancelled.
    function openReassignModal(userObj, count, pool) {
        return new Promise(resolve => {
            const id = '_reassignOverlay';
            const existing = document.getElementById(id);
            if (existing) existing.remove();

            const userName = esc(userObj.display_name || userObj.email || userObj.user_id);
            // Compact single-row item: name on left, role badge pill on right,
            // 36px tall — 20 members fit comfortably in the scrollable region.
            const poolItemStyle =
                'display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;'
                + 'padding:7px 12px;min-height:36px;'
                + 'background:var(--bg-card,#fff);border:1px solid var(--border-color,#e5e7eb);'
                + 'border-radius:8px;cursor:pointer;text-align:left;'
                + 'transition:border-color .12s,background-color .12s;';
            const poolNameStyle = 'flex:1;min-width:0;font-weight:500;color:var(--text-primary,#0f172a);font-size:13px;'
                + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            // Role rendered as a small pill so it visually scans as metadata,
            // not a competing primary action.
            const poolRoleStyle = 'flex:0 0 auto;font-size:10px;letter-spacing:.04em;color:var(--text-secondary,#64748b);'
                + 'text-transform:uppercase;background:var(--bg-secondary,#f1f5f9);padding:2px 7px;border-radius:9999px;';
            const poolHtml = pool.map(u => {
                const label = esc(u.display_name || u.email || u.user_id);
                const role = esc(u.role);
                return `<button type="button" class="reassign-pool-item" data-user-id="${esc(u.user_id)}" style="${poolItemStyle}"
                    onmouseover="this.style.borderColor='var(--brand-primary,#3b82f6)';this.style.background='var(--bg-hover,#f8fafc)'"
                    onmouseout="this.style.borderColor='var(--border-color,#e5e7eb)';this.style.background='var(--bg-card,#fff)'">
                    <span style="${poolNameStyle}" title="${label}">${label}</span>
                    <span style="${poolRoleStyle}">${role}</span>
                </button>`;
            }).join('');

            const unassignBtnStyle =
                'width:100%;padding:9px 12px;min-height:36px;background:var(--bg-secondary,#f8fafc);'
                + 'border:1px dashed var(--border-color,#e5e7eb);border-radius:8px;cursor:pointer;'
                + 'font-size:13px;color:var(--text-primary,#0f172a);'
                + 'transition:border-color .12s,background-color .12s;';

            // Scroll the pool box; cap height so 20-member teams get a tidy
            // scrollbar instead of the modal growing past the viewport.
            const poolBoxStyle =
                'display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;'
                + 'margin-bottom:12px;padding-right:4px;';

            const overlay = document.createElement('div');
            overlay.id = id;
            overlay.className = 'gm-overlay active';
            overlay.innerHTML = `
                <div class="gm-modal" style="max-width:480px;">
                    <div class="gm-header">
                        <div>
                            <h3 class="gm-title">Reassign open leads</h3>
                            <p class="gm-subtitle">${userName} owns <strong>${count}</strong> open lead${count===1?'':'s'} on this team. Pick a replacement, or leave the leads unassigned.</p>
                        </div>
                        <button type="button" class="gm-close" aria-label="Close">&times;</button>
                    </div>
                    <div class="gm-body">
                        <div style="${poolBoxStyle}">
                            ${pool.length ? poolHtml : '<div style="color:var(--text-secondary,#64748b);font-style:italic;padding:8px 0;font-size:13px;">No other team members available — use "Leave unassigned" below.</div>'}
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;color:var(--text-secondary,#64748b);font-size:11px;margin:6px 0 10px;text-transform:uppercase;letter-spacing:.05em;">
                            <span style="flex:1;height:1px;background:var(--border-color,#e5e7eb);"></span>
                            <span>or</span>
                            <span style="flex:1;height:1px;background:var(--border-color,#e5e7eb);"></span>
                        </div>
                        <button type="button" id="_reassignUnassignBtn" style="${unassignBtnStyle}"
                            onmouseover="this.style.borderColor='var(--brand-primary,#3b82f6)';this.style.background='var(--bg-hover,#eef2ff)'"
                            onmouseout="this.style.borderColor='var(--border-color,#e5e7eb)';this.style.background='var(--bg-secondary,#f8fafc)'">
                            Leave unassigned (manager will reassign later)
                        </button>
                    </div>
                    <div class="gm-footer" style="display:flex;justify-content:flex-end;gap:8px;">
                        <button type="button" id="_reassignCancelBtn" class="btn btn-secondary">Cancel</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const finish = (plan) => { overlay.remove(); resolve(plan); };

            overlay.querySelector('.gm-close').onclick = () => finish(null);
            overlay.querySelector('#_reassignCancelBtn').onclick = () => finish(null);
            overlay.onclick = e => { if (e.target === overlay) finish(null); };
            overlay.querySelector('#_reassignUnassignBtn').onclick =
                () => finish({ replacementUserId: null, unassign: true });
            overlay.querySelectorAll('.reassign-pool-item').forEach(btn => {
                btn.onclick = () => finish({
                    replacementUserId: btn.getAttribute('data-user-id'),
                    unassign: false
                });
            });
        });
    }

    // ─── Save team ─────────────────────────────────────────────────────────

    async function saveTeam() {
        const name = document.getElementById('teamNameInput').value.trim();
        const team_code = document.getElementById('teamCodeInput').value.trim() || null;
        const description = document.getElementById('teamDescInput').value.trim() || null;
        const functional_area_ids = [..._teamModal.selectedFaIds];

        // Client-side validation mirrors the backend rules for a nicer UX —
        // the server still enforces them if this code is tampered with.
        if (!name) return toastErr(null, 'Team name is required');
        if (functional_area_ids.length === 0) return toastErr(null, 'Pick at least one functional group');
        if (!_teamModal.manager) return toastErr(null, 'A manager is required');

        const btn = document.getElementById('teamSaveBtn');
        btn.disabled = true;
        try {
            if (_teamModal.mode === 'create') {
                // 1. Create the team (server requires ≥1 FA, creates as 'draft')
                const team = await apiPost('/teams', { team_name: name, team_code, description, functional_area_ids });
                const teamId = team.id;
                // 2. Manager (activates team to 'active')
                await apiPost(`/teams/${teamId}/members`, { user_id: _teamModal.manager.user_id, role: TEAM_ROLES.MANAGER });
                // 3. Team leads (optional)
                for (const tl of _teamModal.teamleads) {
                    await apiPost(`/teams/${teamId}/members`, { user_id: tl.user_id, role: TEAM_ROLES.TEAMLEAD });
                }
                // 4. Members (optional)
                for (const m of _teamModal.members) {
                    await apiPost(`/teams/${teamId}/members`, { user_id: m.user_id, role: TEAM_ROLES.MEMBER });
                }
                toastOk(`Team "${name}" created`);
            } else {
                // EDIT mode — update team metadata + FA set, then diff members.
                await apiPut(`/teams/${_teamModal.teamId}`, {
                    team_name: name, team_code, description, functional_area_ids
                });
                await syncMembersDiff();
                toastOk(`Team "${name}" updated`);
            }
            closeTeamModal();
            await loadTeamsTab();
        } catch (e) {
            toastErr(e, 'Failed to save team');
        } finally {
            btn.disabled = false;
        }
    }

    async function syncMembersDiff() {
        const teamId = _teamModal.teamId;
        const origMembers = (_teamModal.original && _teamModal.original.members) || [];
        const origById = new Map(origMembers.map(m => [m.user_id, m]));

        // Current intended state
        const desired = [];
        if (_teamModal.manager) desired.push({ user_id: _teamModal.manager.user_id, role: TEAM_ROLES.MANAGER });
        _teamModal.teamleads.forEach(u => desired.push({ user_id: u.user_id, role: TEAM_ROLES.TEAMLEAD }));
        _teamModal.members.forEach(u => desired.push({ user_id: u.user_id, role: TEAM_ROLES.MEMBER }));
        const desiredById = new Map(desired.map(d => [d.user_id, d]));

        // 1. Users in original but NOT in desired → remove
        //    (Do removes BEFORE role changes/adds so we free up slots like
        //    "only one manager per team".)
        //    If the user owned open leads, _gateRemoval has already captured a
        //    plan in pendingRemovals; pass it as query params so the backend
        //    can reassign + remove atomically.
        for (const [userId, m] of origById) {
            if (!desiredById.has(userId)) {
                const plan = _teamModal.pendingRemovals.get(userId);
                let path = `/teams/${teamId}/members/${userId}`;
                if (plan) {
                    if (plan.unassign) path += '?unassign=true';
                    else if (plan.replacementUserId) path += `?replacement_user_id=${encodeURIComponent(plan.replacementUserId)}`;
                }
                await apiDelete(path);
            }
        }

        // 2. Users whose ROLE changed → PUT new role. Ordering still matters:
        //    if someone is being demoted FROM manager and another person is
        //    being promoted TO manager, we must demote first. PUT applies a
        //    role, and backend re-sync logic inside AddTeamMemberAsync handles
        //    "already on team, just flip the role".
        //    Simplest: do all demotions (manager → other) first, then
        //    promotions-or-same, then adds. AddTeamMemberAsync / the PUT
        //    handle idempotency.
        const demotions = [];
        const promotionsOrSame = [];
        for (const d of desired) {
            const orig = origById.get(d.user_id);
            if (!orig) continue;  // handled in step 3
            if (orig.role === d.role) continue;  // no change
            if (orig.role === TEAM_ROLES.MANAGER && d.role !== TEAM_ROLES.MANAGER) {
                demotions.push(d);
            } else {
                promotionsOrSame.push(d);
            }
        }
        for (const d of demotions) {
            await apiPut(`/teams/${teamId}/members/${d.user_id}`, { role: d.role });
        }
        for (const d of promotionsOrSame) {
            await apiPut(`/teams/${teamId}/members/${d.user_id}`, { role: d.role });
        }

        // 3. Users in desired but NOT in original → add
        for (const d of desired) {
            if (!origById.has(d.user_id)) {
                await apiPost(`/teams/${teamId}/members`, { user_id: d.user_id, role: d.role });
            }
        }
    }

    async function deleteTeam(teamId, teamName) {
        if (!confirm(`Delete team "${teamName}"?\n\nThe team must have no active members and no assigned leads. If it does, the server will reject and list what to clean up first.`)) return;
        try {
            await apiDelete(`/teams/${teamId}`);
            toastOk('Team deleted');
            await loadTeamsTab();
        } catch (e) {
            toastErr(e, 'Failed to delete team');
        }
    }

    // ─── Modal helpers — reuse project's glassmorphic modal style ──────────

    function openGmOverlay(id) {
        // Project convention: `.gm-overlay` is always `display: flex !important`
        // (see css/glassmorphic-modal.css). Visibility + click intercept are
        // toggled via the `.active` class — opacity 0→1 and pointer-events
        // none→auto (see css/crm.css override).
        document.getElementById(id).classList.add('active');
    }
    function closeGmOverlay(id) {
        document.getElementById(id).classList.remove('active');
    }

    // ─── Expose to window for onclick handlers ─────────────────────────────

    window.loadFunctionalGroups          = loadFunctionalGroups;
    window.openCreateFunctionalGroupModal = openCreateFunctionalGroupModal;
    window.openEditFunctionalGroupModal   = openEditFunctionalGroupModal;
    window.closeFunctionalGroupModal      = closeFunctionalGroupModal;
    window.saveFunctionalGroup            = saveFunctionalGroup;
    window.deleteFunctionalGroup          = deleteFunctionalGroup;

    window.loadTeamsTab         = loadTeamsTab;
    window.openCreateTeamModal  = openCreateTeamModal;
    window.openEditTeamModal    = openEditTeamModal;
    window.closeTeamModal       = closeTeamModal;
    window.saveTeam             = saveTeam;
    window.deleteTeam           = deleteTeam;
    window._addManager          = _addManager;
    window._removeManager       = _removeManager;
    window._addRoleUser         = _addRoleUser;
    window._removeRoleUser      = _removeRoleUser;
})();
