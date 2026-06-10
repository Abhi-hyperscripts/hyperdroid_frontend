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
    // True when this tenant has at least one ACTIVE telephony number
    // registered. Gates the "Receives inbound calls" toggle on each team
    // card — pointless to surface when there's no provider to route from.
    let _telephonyConfigured = false;

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
        const ok = await Confirm.show({
            title: `Delete functional group "${name}"?`,
            message: 'It must not be assigned to any team. If it is, the server will reject this and list the affected teams.',
            type: 'danger',
            confirmText: 'Delete group'
        });
        if (!ok) return;
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
            const [teams, fgs, users, numbers] = await Promise.all([
                apiGet('/teams'),
                apiGet('/functional-areas'),
                apiGet('/teams/users'),
                // Treat any non-2xx (404, 403, etc.) as "not configured" — we
                // never want a transient calls-endpoint failure to wipe the
                // toggle from tenants who have actually wired up telephony.
                apiGet('/calls/numbers').catch(() => [])
            ]);
            _teams = Array.isArray(teams) ? teams : [];
            _functionalGroups = Array.isArray(fgs) ? fgs : [];
            _users = Array.isArray(users) ? users : [];
            _telephonyConfigured = Array.isArray(numbers) && numbers.some(n => n && n.is_active);

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
                    ${_telephonyConfigured ? `
                    <label class="team-card-inbound" onclick="event.stopPropagation()" data-tooltip="When ON, this team's members are rung when a customer calls our number">
                        <input type="checkbox" ${t.receives_inbound_calls ? 'checked' : ''}
                               onchange="toggleTeamInbound('${esc(t.id)}', this.checked, this)">
                        <span class="team-card-inbound-label">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>
                            </svg>
                            Receives inbound calls
                        </span>
                    </label>` : ''}
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
                            <button class="team-card-iconbtn" onclick="event.stopPropagation(); window.openTriggersModal && window.openTriggersModal('${esc(t.id)}', '${esc(t.team_name)}')" aria-label="Email triggers" data-tooltip="Email automations — fire a template when a lead enters a status">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                            </button>
                            <button class="team-card-iconbtn team-card-iconbtn--danger" onclick="event.stopPropagation(); deleteTeam('${esc(t.id)}', '${esc(t.team_name)}')" aria-label="Delete" data-tooltip="Delete this team">
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
        // New teams default to brand-primary indigo until the admin picks
        // something brand-specific. setTeamColor seeds the swatch + preview.
        setTeamColor('#6366f1');
        // Playbook fields default to empty → recording-only mode.
        setPlaybookFields(null);
        renderFaPicker();
        renderManagerSlot();
        renderTeamleadSlots();
        renderMemberSlots();
        openGmOverlay('teamModal');
        setTimeout(() => document.getElementById('teamNameInput').focus(), 50);
    }

    // Playbook dropdowns are real SearchableDropdown instances (per the
    // "never use native <select>" rule). We rebuild them every modal
    // open so they pick up the team's current value cleanly.
    const MOTION_OPTIONS = [
        { value: '',                        label: '— No motion (score against universal sales fundamentals) —' },
        { value: 'cold_outbound',           label: 'Cold outbound — rep plants pain, locks callback' },
        { value: 'inbound_qual',            label: 'Inbound qualification — prospect raised hand, rep qualifies fit + timing' },
        { value: 'warm_followup',           label: 'Warm follow-up — advance an engaged lead' },
        { value: 'enterprise_consultative', label: 'Enterprise consultative — multi-stakeholder discovery' },
    ];
    const LANG_REGISTER_OPTIONS = [
        { value: '',         label: 'Auto-detect from the call' },
        { value: 'hinglish', label: 'Hinglish' },
        { value: 'english',  label: 'English' },
        { value: 'hindi',    label: 'Hindi' },
    ];

    function setPlaybookFields(team) {
        const motionHost = document.getElementById('teamMotionDropdown');
        const langHost   = document.getElementById('teamLanguageRegisterDropdown');
        const icp        = document.getElementById('teamIcpInput');
        const vp         = document.getElementById('teamValuePropInput');
        const obj        = document.getElementById('teamCallObjectiveInput');
        const pbJson     = document.getElementById('teamPlaybookJsonInput');
        const err        = document.getElementById('teamPlaybookJsonError');
        if (!motionHost || !window.SearchableDropdown) return; // section/lib missing — older cache

        // (re)build motion dropdown
        _teamModal.motionDropdown = new window.SearchableDropdown(motionHost, {
            options:           MOTION_OPTIONS,
            value:             (team && team.motion) || '',
            placeholder:       '— No motion (score against universal sales fundamentals) —',
            searchPlaceholder: 'Search motion...',
        });
        _teamModal.langDropdown = new window.SearchableDropdown(langHost, {
            options:           LANG_REGISTER_OPTIONS,
            value:             (team && team.language_register) || '',
            placeholder:       'Auto-detect from the call',
            searchPlaceholder: 'Search language...',
        });

        // (See team-modal-scroll CSS in crm-teams-setup.css for the
        // internal-scroll override that makes SearchableDropdown's
        // portal-to-body branch kick in. Without that, the motion menu
        // opens upward and visually overlaps the Functional groups
        // section above.)

        icp.value    = (team && team.icp_description) || '';
        vp.value     = (team && team.value_prop)      || '';
        obj.value    = (team && team.call_objective)  || '';
        pbJson.value = (team && (team.playbook_json || ''));
        if (err) { err.style.display = 'none'; err.textContent = ''; }

        // Wire the "Download sample rubric" button. Each modal open
        // re-wires the handler so it always reflects the currently
        // selected motion in the dropdown above (motion changes →
        // different sample template). Capture-clone to avoid stacking
        // listeners on repeated opens.
        const dlBtn = document.getElementById('teamPlaybookDownloadSampleBtn');
        if (dlBtn) {
            const fresh = dlBtn.cloneNode(true);
            dlBtn.parentNode.replaceChild(fresh, dlBtn);
            fresh.addEventListener('click', () => {
                const motion = (_teamModal.motionDropdown?.getValue() || '') || 'cold_outbound';
                downloadSamplePlaybookJson(motion, (team && team.team_name) || 'team');
            });
        }
    }

    // Power-user starter rubric — mirrors CRM/Services/Calls/CallRubricBuilder.cs
    // (ColdOutbound template). The user is meant to edit this then paste
    // into the textarea; we include all 4 fixed dimension keys + a few
    // playbook flags so weights already sum to 100 and the file is
    // ready to drop in.
    function downloadSamplePlaybookJson(motion, teamName) {
        const sample = SAMPLE_PLAYBOOKS[motion] || SAMPLE_PLAYBOOKS.cold_outbound;
        const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const slug = String(teamName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
        const a = document.createElement('a');
        a.href = url;
        a.download = `playbook-${slug}-${motion}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Defer revoke so the browser still has time to start the
        // download — common foot-gun is revoking immediately.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const SAMPLE_PLAYBOOKS = {
        cold_outbound: {
            dimensions: {
                discovery: {
                    weight: 30,
                    description: "Did the rep uncover the prospect's workflow + pain through open questions, mirroring, and follow-up probes?",
                    good_signals: [
                        "Asked 'how do you handle X today?' style open questions",
                        "Mirrored a customer answer back as a question to dig deeper",
                        "Got the customer to name a specific tool / process they use today",
                        "Got the customer to acknowledge a downside of their current setup"
                    ],
                    bad_signals: [
                        "Asked 'do you have any requirement?' (closed yes/no in the cold-call killer pattern)",
                        "Did not ask any open discovery question",
                        "Accepted the first customer answer at face value, no probing"
                    ]
                },
                value_prop: {
                    weight: 25,
                    description: "Did the rep tailor their explanation to the specific pain the customer shared?",
                    good_signals: [
                        "Connected solution to a pain the customer named, not a generic feature list",
                        "Cited a peer company that solved the same problem",
                        "Quantified the outcome (% improvement, time saved)"
                    ],
                    bad_signals: [
                        "Listed product features without tying to a stated pain",
                        "Pitched everything they offer before establishing any customer need"
                    ]
                },
                objection_handling: {
                    weight: 25,
                    description: "When the prospect pushed back, did the rep reframe with a question that earned more time?",
                    good_signals: [
                        "After 'no requirement', asked a future-state question (6 months out)",
                        "After 'busy', locked a specific callback time, not a vague 'whenever'",
                        "After 'send email', asked who the decision-maker is",
                        "After 'using competitor X', asked what's broken about it"
                    ],
                    bad_signals: [
                        "Said 'OK thank you' and hung up on a 'no'",
                        "Accepted a vague callback time like 'whenever'",
                        "Started bashing the competitor instead of probing the gap"
                    ]
                },
                closing: {
                    weight: 20,
                    description: "Did the rep secure a concrete next step with mutual commitment (specific channel + time confirmed)?",
                    good_signals: [
                        "Confirmed the customer's WhatsApp or preferred channel on the way out",
                        "Set a specific follow-up date/time (not 'will call later')",
                        "Got permission to send a video / one-pager / deck",
                        "Identified the decision-maker for the next conversation"
                    ],
                    bad_signals: [
                        "Ended call without any next step",
                        "Said 'OK thank you' alone on a no-requirement response",
                        "Did not confirm any channel for follow-up"
                    ]
                }
            },
            playbook_flags: [
                { id: "asked_requirement_too_early", label: "Asked 'do you have any requirement?' early in the call", description: "Flag whenever this (or its Hinglish equivalent 'kya requirement hai?') appears in the first half of the call — it gives the prospect a polite exit before any pain is planted." },
                { id: "no_warmup",                  label: "Did not warm up before pitching",                      description: "Jumped straight into pitch without a 'kaise hain' / 'how have you been' / weather / location warm-up." },
                { id: "no_next_step",               label: "Did not secure any next step",                         description: "Hung up without confirming WhatsApp, callback time, or any follow-up channel." },
                { id: "feature_dump",               label: "Listed product features before establishing pain",     description: "Pitched the catalog before learning what the customer's actual workflow looks like." },
                { id: "thank_you_on_no",            label: "Closed with 'OK thank you' on a 'no requirement' response", description: "Did not run the recovery move (future-state question or content micro-ask)." }
            ]
        },
        inbound_qual: {
            dimensions: {
                discovery: {
                    weight: 30,
                    description: "Did the rep qualify the inbound prospect — what brought them in, what they've tried, urgency, decision-makers?",
                    good_signals: [
                        "Asked what specifically prompted the inquiry",
                        "Asked what they've already tried / evaluated",
                        "Confirmed urgency (timeline / deadline)",
                        "Identified all stakeholders / decision-makers"
                    ],
                    bad_signals: [
                        "Jumped to pricing without qualifying need",
                        "Did not ask why-now",
                        "Treated inbound as if it were a cold opportunity"
                    ]
                },
                value_prop: {
                    weight: 25,
                    description: "Did the rep explain how the offering fits THIS prospect's specific situation, including budget fit?",
                    good_signals: [
                        "Mapped solution back to the specific reason they reached out",
                        "Asked about budget range or signaled fit",
                        "Set expectations on what comes next in the sales process"
                    ],
                    bad_signals: [
                        "Generic walkthrough of the product, untied to the inquiry",
                        "Avoided budget conversation entirely"
                    ]
                },
                objection_handling: {
                    weight: 25,
                    description: "When concerns were raised (price, timing, fit), did the rep address them with specifics that earned trust?",
                    good_signals: [
                        "Acknowledged the concern before responding",
                        "Reframed price as ROI / time saved",
                        "Offered a concrete proof point or reference"
                    ],
                    bad_signals: [
                        "Defensive or dismissive on price",
                        "Generic reassurance without proof"
                    ]
                },
                closing: {
                    weight: 20,
                    description: "Did the rep advance the deal — booking a demo, sending a tailored proposal, looping in the right stakeholder?",
                    good_signals: [
                        "Booked a specific time for next step on the call",
                        "Confirmed which stakeholders join the next meeting",
                        "Set expectations on what materials go out before the next call"
                    ],
                    bad_signals: [
                        "Left the next step vague ('we will be in touch')",
                        "Did not secure stakeholder names for next call"
                    ]
                }
            },
            playbook_flags: [
                { id: "no_why_now",            label: "Did not ask why-now",                description: "Failed to learn what triggered the inbound — without this the rep can't prioritise urgency." },
                { id: "skipped_budget",        label: "Did not surface budget fit",         description: "Even a soft 'is this in your budget range' is missing." },
                { id: "no_next_step",          label: "Did not book a concrete next step",  description: "Ended with vague 'will get back to you' instead of a specific calendar slot." },
                { id: "no_stakeholder_mapping",label: "Did not ask who else is involved",   description: "Inbound where only one person is on the call but a real decision requires multiple is a hand-off risk." }
            ]
        },
        warm_followup: {
            dimensions: {
                discovery: {
                    weight: 30,
                    description: "Did the rep pick up where the last conversation left off and surface what's changed?",
                    good_signals: [
                        "Recapped specific points from the last conversation",
                        "Asked what has changed on their side since",
                        "Identified new stakeholders or shifts in priority"
                    ],
                    bad_signals: [
                        "Treated the call as if it were the first one",
                        "Did not reference any prior context",
                        "Re-pitched the same generic pitch"
                    ]
                },
                value_prop: {
                    weight: 25,
                    description: "Did the rep tie the next step to what the prospect specifically asked for or to a new insight?",
                    good_signals: [
                        "Delivered on something promised in the last call (data, demo, intro)",
                        "Brought new information the prospect didn't have",
                        "Quantified value against the prospect's stated metric"
                    ],
                    bad_signals: [
                        "Showed up empty-handed against a prior promise",
                        "Re-pitched without advancing the conversation"
                    ]
                },
                objection_handling: {
                    weight: 25,
                    description: "Did the rep address the prior concern and surface any new objections?",
                    good_signals: [
                        "Pre-emptively addressed the prior concern",
                        "Asked 'what else might hold this back'",
                        "Brought a peer reference to defuse a specific risk"
                    ],
                    bad_signals: [
                        "Ignored the prior objection",
                        "Did not probe for new concerns"
                    ]
                },
                closing: {
                    weight: 20,
                    description: "Did the rep advance to a concrete commitment (decision date, contract, paid pilot, sign-off owner)?",
                    good_signals: [
                        "Got mutual agreement on the next gate (e.g. decision by date X)",
                        "Confirmed who signs off and what they need to see",
                        "Booked the final-decision meeting before hanging up"
                    ],
                    bad_signals: [
                        "Ended on 'we will think about it'",
                        "Did not name the next milestone"
                    ]
                }
            },
            playbook_flags: [
                { id: "ignored_prior_context", label: "Did not reference the previous conversation", description: "Warm follow-up requires showing memory; treating it like a cold call wastes built-up trust." },
                { id: "broken_promise",        label: "Did not deliver on something promised",       description: "Showed up without the material/data/intro committed in the last call." },
                { id: "no_next_milestone",     label: "No next milestone named",                     description: "Failed to advance to a specific gate (demo, pilot, contract, decision date)." }
            ]
        },
        enterprise_consultative: {
            dimensions: {
                discovery: {
                    weight: 30,
                    description: "Did the rep map stakeholders, business process, and the underlying business case behind the inquiry?",
                    good_signals: [
                        "Mapped at least 3 stakeholder roles + their concerns",
                        "Connected pain to a measurable business metric",
                        "Asked about current procurement/legal process",
                        "Drew out the alternative being evaluated"
                    ],
                    bad_signals: [
                        "Talked only to the user-buyer, did not surface economic buyer",
                        "Did not connect pain to a dollar figure or business outcome",
                        "Skipped the procurement / legal process question"
                    ]
                },
                value_prop: {
                    weight: 25,
                    description: "Did the rep articulate value in terms of business outcome and ROI, not just product features?",
                    good_signals: [
                        "Tied solution to a quantified business metric",
                        "Brought a similar-industry case study or ROI proof point",
                        "Tailored ROI math to the prospect's stated scale"
                    ],
                    bad_signals: [
                        "Feature-led pitch with no ROI framing",
                        "Generic case study mismatched to the prospect's industry"
                    ]
                },
                objection_handling: {
                    weight: 25,
                    description: "Did the rep handle multi-stakeholder objections (security, procurement, integration, change-management) with concrete answers?",
                    good_signals: [
                        "Anticipated security/compliance questions before they were asked",
                        "Offered a concrete integration plan or timeline",
                        "Addressed change-management with examples of similar rollouts"
                    ],
                    bad_signals: [
                        "Vague on security/compliance specifics",
                        "Did not offer a deployment plan"
                    ]
                },
                closing: {
                    weight: 20,
                    description: "Did the rep secure a concrete next step that advances the buying process (mutual action plan, exec sponsor intro, paid POC)?",
                    good_signals: [
                        "Proposed and got agreement on a mutual action plan",
                        "Secured intro to economic buyer or executive sponsor",
                        "Agreed on POC criteria + timeline"
                    ],
                    bad_signals: [
                        "No mutual action plan",
                        "Did not get a path to the economic buyer"
                    ]
                }
            },
            playbook_flags: [
                { id: "no_econ_buyer",       label: "Did not surface the economic buyer",      description: "Enterprise deals stall when the rep only talks to user-buyers. The economic buyer must be on the radar." },
                { id: "no_business_metric",  label: "Did not connect pain to a business metric",description: "Without a quantified business outcome the deal slides on price." },
                { id: "no_action_plan",      label: "No mutual action plan agreed",            description: "Enterprise cycles need a written, mutually-owned plan. Verbal 'we'll be in touch' kills momentum." },
                { id: "weak_security_answer",label: "Vague on security or compliance",         description: "Even softly-vague answers signal the rep isn't enabled — kills trust with IT/InfoSec." }
            ]
        }
    };

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
            setTeamColor(team.color || '#6366f1');
            setPlaybookFields(team);
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
            return await Confirm.show({
                title: "Couldn't verify open leads",
                message: "We hit an error checking how many open leads this person owns. Remove them anyway?",
                type: 'warning',
                confirmText: 'Remove anyway'
            });
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

    // Mirror of CRM/Services/Calls/PlaybookJsonValidator.cs so the
    // power-user gets instant feedback inside the modal instead of
    // a round-trip 400. Backend is the authoritative gate; this is
    // belt-and-suspenders UX only.
    const REQUIRED_DIM_KEYS = ['discovery', 'value_prop', 'objection_handling', 'closing'];
    function validatePlaybookJson(jsonText) {
        let root;
        try { root = JSON.parse(jsonText); }
        catch (e) { return { ok: false, error: `Not parseable JSON: ${e.message}` }; }
        if (!root || typeof root !== 'object' || Array.isArray(root)) {
            return { ok: false, error: 'Top-level value must be a JSON object.' };
        }
        // dimensions
        if (root.dimensions !== undefined) {
            const dims = root.dimensions;
            if (!dims || typeof dims !== 'object' || Array.isArray(dims)) {
                return { ok: false, error: "'dimensions' must be a JSON object." };
            }
            for (const k of REQUIRED_DIM_KEYS) {
                if (!(k in dims)) return { ok: false, error: `'dimensions' is missing required key '${k}'. The 4 fixed dimensions are: ${REQUIRED_DIM_KEYS.join(', ')}.` };
            }
            for (const k of Object.keys(dims)) {
                if (!REQUIRED_DIM_KEYS.includes(k)) return { ok: false, error: `'dimensions' has unknown key '${k}'. Allowed: ${REQUIRED_DIM_KEYS.join(', ')}.` };
            }
            let weightSum = 0;
            for (const k of REQUIRED_DIM_KEYS) {
                const d = dims[k];
                if (!d || typeof d !== 'object' || Array.isArray(d)) {
                    return { ok: false, error: `'dimensions.${k}' must be a JSON object.` };
                }
                if (!Number.isInteger(d.weight))                       return { ok: false, error: `'dimensions.${k}.weight' must be an integer.` };
                if (d.weight < 1 || d.weight > 100)                    return { ok: false, error: `'dimensions.${k}.weight' must be between 1 and 100 (got ${d.weight}).` };
                weightSum += d.weight;
                if (typeof d.description !== 'string' || !d.description.trim()) return { ok: false, error: `'dimensions.${k}.description' must be a non-empty string.` };
                for (const arrKey of ['good_signals', 'bad_signals']) {
                    const arr = d[arrKey];
                    if (!Array.isArray(arr)) return { ok: false, error: `'dimensions.${k}.${arrKey}' must be an array of strings.` };
                    for (let i = 0; i < arr.length; i++) {
                        if (typeof arr[i] !== 'string' || !arr[i].trim()) return { ok: false, error: `'dimensions.${k}.${arrKey}[${i}]' must be a non-empty string.` };
                    }
                }
            }
            if (weightSum !== 100) return { ok: false, error: `Sum of dimension weights must equal 100 (got ${weightSum}). Adjust the four weights so they total 100.` };
        }
        // playbook_flags
        if (root.playbook_flags !== undefined) {
            const flags = root.playbook_flags;
            if (!Array.isArray(flags)) return { ok: false, error: "'playbook_flags' must be a JSON array." };
            const seen = new Set();
            for (let i = 0; i < flags.length; i++) {
                const f = flags[i];
                if (!f || typeof f !== 'object' || Array.isArray(f)) return { ok: false, error: `'playbook_flags[${i}]' must be an object.` };
                for (const req of ['id', 'label', 'description']) {
                    if (typeof f[req] !== 'string' || !f[req].trim()) return { ok: false, error: `'playbook_flags[${i}].${req}' must be a non-empty string.` };
                }
                const idKey = f.id.trim().toLowerCase();
                if (seen.has(idKey)) return { ok: false, error: `'playbook_flags' contains duplicate id '${f.id}'. Each flag id must be unique.` };
                seen.add(idKey);
            }
        }
        // string metadata fields
        for (const name of ['motion', 'icp_description', 'value_prop', 'call_objective', 'language_register']) {
            if (name in root && root[name] !== null && typeof root[name] !== 'string') {
                return { ok: false, error: `'${name}' must be a string (or omitted).` };
            }
        }
        return { ok: true };
    }

    // Read the playbook section from the form. Returns a body suitable
    // for PUT /api/teams/{id}/playbook, or null when no playbook input
    // exists (older HTML cache) so the save path stays a no-op for those.
    // Validates the JSON locally so the user gets immediate feedback
    // instead of a generic 500.
    function readPlaybookBody() {
        const motionHost = document.getElementById('teamMotionDropdown');
        if (!motionHost) return null;
        const motion = _teamModal.motionDropdown ? (_teamModal.motionDropdown.getValue() || '') : '';
        const lang   = _teamModal.langDropdown   ? (_teamModal.langDropdown.getValue()   || '') : '';
        const icp    = document.getElementById('teamIcpInput')?.value || '';
        const vp     = document.getElementById('teamValuePropInput')?.value || '';
        const obj    = document.getElementById('teamCallObjectiveInput')?.value || '';
        const pbJson = document.getElementById('teamPlaybookJsonInput')?.value || '';
        const err    = document.getElementById('teamPlaybookJsonError');

        // Empty-string convention: explicit clear. Whitespace-only also clears.
        const trimmed = pbJson.trim();
        if (trimmed) {
            const v = validatePlaybookJson(trimmed);
            if (!v.ok) {
                if (err) {
                    err.textContent = `Custom rubric JSON is invalid: ${v.error}`;
                    err.style.display = 'block';
                }
                throw new Error('Invalid playbook JSON');
            }
        }
        if (err) { err.style.display = 'none'; err.textContent = ''; }

        return {
            motion:            motion,
            icp_description:   icp.trim(),
            value_prop:        vp.trim(),
            call_objective:    obj.trim(),
            language_register: lang,
            playbook_json:     trimmed,
        };
    }

    async function saveTeam() {
        const name = document.getElementById('teamNameInput').value.trim();
        const team_code = document.getElementById('teamCodeInput').value.trim() || null;
        const description = document.getElementById('teamDescInput').value.trim() || null;
        const functional_area_ids = [..._teamModal.selectedFaIds];
        const color = document.getElementById('teamColorPicker')?.value || '#6366f1';

        // Client-side validation mirrors the backend rules for a nicer UX —
        // the server still enforces them if this code is tampered with.
        if (!name) return toastErr(null, 'Team name is required');
        if (functional_area_ids.length === 0) return toastErr(null, 'Pick at least one functional group');
        if (!_teamModal.manager) return toastErr(null, 'A manager is required');

        // Read the playbook fields BEFORE the network call so we can
        // surface JSON errors without bouncing the user back to a
        // half-saved team.
        let playbookBody;
        try { playbookBody = readPlaybookBody(); }
        catch (_) { return; /* readPlaybookBody already showed the error */ }

        const btn = document.getElementById('teamSaveBtn');
        btn.disabled = true;
        try {
            let teamId = _teamModal.teamId;
            if (_teamModal.mode === 'create') {
                // 1. Create the team (server requires ≥1 FA, creates as 'draft')
                const team = await apiPost('/teams', { team_name: name, team_code, description, functional_area_ids, color });
                teamId = team.id;
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
                await apiPut(`/teams/${teamId}`, {
                    team_name: name, team_code, description, functional_area_ids, color
                });
                await syncMembersDiff();
                toastOk(`Team "${name}" updated`);
            }
            // Playbook PATCH runs after the main save in both modes. If any
            // playbook field changed (relative to "all empty" for create
            // mode, or relative to original for edit), send the PATCH. We
            // always send in edit mode so explicit "clear" propagates.
            if (playbookBody && teamId) {
                try { await apiPut(`/teams/${teamId}/playbook`, playbookBody); }
                catch (pe) { toastErr(pe, 'Team saved, but failed to save playbook'); }
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
        const ok = await Confirm.show({
            title: `Delete team "${teamName}"?`,
            message: "If the team has assigned leads, you'll be asked to pick another team — the leads will be round-robin distributed across that team's Members + Team Leads before this team is archived.\n\nManager, Team Leads, and Members are automatically removed from this team. Their accounts and access to other teams are not affected.",
            type: 'danger',
            confirmText: 'Delete team'
        });
        if (!ok) return;
        try {
            await apiDelete(`/teams/${teamId}`);
            toastOk('Team deleted');
            await loadTeamsTab();
        } catch (e) {
            // Backend refuses with "still has N leads" when the team has open
            // leads. Promote that case to the reassign-and-delete modal
            // instead of just toasting the error.
            const msg = (e && e.message) ? String(e.message) : '';
            if (/\d+\s*lead/i.test(msg)) {
                openReassignDeleteModal(teamId, teamName, msg);
            } else {
                toastErr(e, 'Failed to delete team');
            }
        }
    }

    // ─── Reassign + delete modal ───────────────────────────────────────────
    //
    // Triggered when DELETE /teams/{id} responds with "still has N leads".
    // We render a small overlay that lets the admin pick a target team; on
    // confirm we hit POST /teams/{id}/delete-with-reassign which round-robin
    // distributes leads across the target's Members + Team Leads, then
    // archives the source team.

    function ensureReassignDeleteModalHtml() {
        if (document.getElementById('reassignDeleteTeamModal')) return;
        const overlay = document.createElement('div');
        overlay.className = 'gm-overlay';
        overlay.id = 'reassignDeleteTeamModal';
        overlay.innerHTML = `
          <div class="gm-modal gm-sm" style="max-width: 520px;">
            <div class="gm-header">
              <div class="gm-header-left">
                <div class="gm-icon" style="background: rgba(239, 68, 68, 0.12); color: var(--color-danger);">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </div>
                <div class="gm-title-group">
                  <h3 class="gm-title" id="rdtTitle">Reassign leads & delete team</h3>
                  <p class="gm-subtitle" id="rdtSubtitle">Pick a team to absorb this team's leads</p>
                </div>
              </div>
              <button class="gm-close" onclick="closeReassignDeleteModal()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="gm-body">
              <p id="rdtServerMessage" style="margin: 0 0 12px; color: var(--text-secondary); font-size: 0.8rem;"></p>
              <div class="crm-form-group">
                <label for="rdtTargetTeam">Move leads to *</label>
                <select id="rdtTargetTeam"></select>
                <p class="form-help-text" style="color: var(--text-secondary); font-size: 0.72rem; margin-top: 6px;">
                  Leads will be round-robin assigned across the target team's <strong>Members</strong> and <strong>Team Leads</strong>. Managers don't pick up leads. The source team must have no remaining human members for the archive step to succeed.
                </p>
              </div>
            </div>
            <div class="gm-footer" style="padding: 16px 20px; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color-light);">
              <button type="button" class="btn btn-secondary" onclick="closeReassignDeleteModal()">Cancel</button>
              <button type="button" class="btn btn-danger" id="rdtConfirmBtn" onclick="confirmReassignDelete()">Reassign & delete</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
    }

    let _rdtSourceTeamId = null;

    function openReassignDeleteModal(sourceTeamId, sourceTeamName, serverMessage) {
        ensureReassignDeleteModalHtml();
        _rdtSourceTeamId = sourceTeamId;

        document.getElementById('rdtTitle').textContent = `Reassign leads & delete "${sourceTeamName}"`;
        document.getElementById('rdtServerMessage').textContent = serverMessage || '';

        // Populate the target-team picker with every OTHER active team. The
        // cached _teams list already excludes archived ones (loadTeamsTab
        // calls /teams without includeArchived).
        const select = document.getElementById('rdtTargetTeam');
        const others = (_teams || []).filter(t => t.id !== sourceTeamId);
        if (others.length === 0) {
            select.innerHTML = '<option value="">— no other team available —</option>';
            document.getElementById('rdtConfirmBtn').disabled = true;
        } else {
            select.innerHTML = '<option value="">— pick a team —</option>' +
                others.map(t => `<option value="${t.id}">${escapeHtml(t.team_name)}</option>`).join('');
            document.getElementById('rdtConfirmBtn').disabled = false;
        }

        openGmOverlay('reassignDeleteTeamModal');
    }

    function closeReassignDeleteModal() {
        closeGmOverlay('reassignDeleteTeamModal');
        _rdtSourceTeamId = null;
    }

    async function confirmReassignDelete() {
        const targetTeamId = document.getElementById('rdtTargetTeam').value;
        if (!_rdtSourceTeamId || !targetTeamId) {
            toastErr(new Error('Pick a target team first'));
            return;
        }
        const btn = document.getElementById('rdtConfirmBtn');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Working…';
        try {
            const result = await apiPost(`/teams/${_rdtSourceTeamId}/delete-with-reassign`, {
                target_team_id: targetTeamId
            });
            const moved = result?.moved_leads ?? 0;
            toastOk(`Moved ${moved} lead${moved === 1 ? '' : 's'} and deleted the team`);
            closeReassignDeleteModal();
            await loadTeamsTab();
        } catch (e) {
            toastErr(e, 'Failed to reassign + delete');
            btn.disabled = false;
            btn.textContent = orig;
        }
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

    // ─── Team colour swatch picker ─────────────────────────────────────────
    // Mirrors the lead-field option colour-picker UX: a small grid of curated
    // swatches (covers ~95% of brand-pick needs in one click) plus a freeform
    // hex input as the escape hatch. setTeamColor seeds the picker on modal
    // open; clicking a swatch syncs the hex input + preview.
    const TEAM_COLOR_PALETTE = [
        '#6366f1', // indigo (default)
        '#3b82f6', // blue
        '#0ea5e9', // sky
        '#22c55e', // green
        '#84cc16', // lime
        '#eab308', // yellow
        '#f97316', // orange
        '#ef4444', // red
        '#ec4899', // pink
        '#a855f7', // violet
        '#14b8a6', // teal
        '#64748b'  // slate
    ];
    function setTeamColor(hex) {
        const value = (hex || '#6366f1').toLowerCase();
        const picker = document.getElementById('teamColorPicker');
        const preview = document.getElementById('teamColorPreview');
        const host = document.getElementById('teamColorSwatches');
        if (picker) picker.value = value;
        if (preview) {
            preview.style.background = value;
            preview.style.color = pickReadableTextColor(value);
        }
        if (host) {
            host.innerHTML = TEAM_COLOR_PALETTE.map(c => `
                <button type="button" class="team-color-swatch ${c.toLowerCase() === value ? 'is-on' : ''}"
                        data-color="${c}" style="background:${c};"
                        aria-label="Pick ${c}" role="radio" aria-checked="${c.toLowerCase() === value}"></button>
            `).join('');
            host.querySelectorAll('.team-color-swatch').forEach(b => {
                b.addEventListener('click', () => setTeamColor(b.dataset.color));
            });
        }
    }
    // Wire the freeform <input type="color"> once.
    document.addEventListener('DOMContentLoaded', () => {
        const picker = document.getElementById('teamColorPicker');
        if (picker) picker.addEventListener('input', () => setTeamColor(picker.value));
    });
    // Pick black/white text colour for a given background — keeps the
    // swatch preview chip readable on both light + dark hex values.
    function pickReadableTextColor(hex) {
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#fff';
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        const luma = 0.299*r + 0.587*g + 0.114*b;
        return luma > 165 ? '#0f172a' : '#fff';
    }

    // Flip a team's inbound-calls toggle. Fires from the team card checkbox;
    // we update the local cache so a re-render doesn't snap the checkbox
    // back if the user clicks twice quickly.
    async function toggleTeamInbound(teamId, checked, checkboxEl) {
        // Optimistic UI: reflect the new state immediately. On server error
        // we roll back the checkbox so it matches what was actually saved.
        try {
            await apiPut(`/teams/${teamId}/inbound`, { receives_inbound_calls: !!checked });
            const t = _teams.find(t => t.id === teamId);
            if (t) t.receives_inbound_calls = !!checked;
            Toast.success(checked ? 'Inbound calls ON for this team' : 'Inbound calls OFF for this team');
        } catch (e) {
            if (checkboxEl) checkboxEl.checked = !checked;  // revert
            toastErr(e, 'Failed to update inbound calls setting');
        }
    }

    window.loadTeamsTab         = loadTeamsTab;
    window.openCreateTeamModal  = openCreateTeamModal;
    window.openEditTeamModal    = openEditTeamModal;
    window.closeTeamModal       = closeTeamModal;
    window.saveTeam             = saveTeam;
    window.deleteTeam                = deleteTeam;
    window.toggleTeamInbound         = toggleTeamInbound;
    window.closeReassignDeleteModal  = closeReassignDeleteModal;
    window.confirmReassignDelete     = confirmReassignDelete;
    window._addManager          = _addManager;
    window._removeManager       = _removeManager;
    window._addRoleUser         = _addRoleUser;
    window._removeRoleUser      = _removeRoleUser;
})();
