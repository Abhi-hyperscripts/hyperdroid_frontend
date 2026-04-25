// Reassign Queue page — admins / managers reassign open leads orphaned by
// deactivated owners. Backend: GET /crm/leads/reassign-queue. Per-row and
// per-team bulk reassign route through PUT /crm/leads/{id}/assign so each
// move generates an assignment-history entry.
//
// UI rules followed (from CRM standards):
// - Native <select> is forbidden — uses SearchableDropdown for owner pickers.
// - Browser confirm() is forbidden — uses showConfirm() from toast.js.
// - Tables use the .crm-table / .crm-table-wrapper classes so styling
//   matches Leads / Deals / Contacts pages.

(function () {
    'use strict';

    let _groups = [];
    // Holds dropdown instances keyed by element id so we can read their value
    // when the user clicks Reassign / Apply to all.
    const _dropdowns = new Map();

    document.addEventListener('DOMContentLoaded', async () => {
        await loadQueue();
    });

    async function loadQueue() {
        const content = document.getElementById('rqContent');
        if (!content) return;
        // Tear down any pre-existing SearchableDropdowns first — re-rendering
        // would otherwise leak listeners (especially on bulk-reassign reload).
        _dropdowns.forEach(d => { try { d.destroy && d.destroy(); } catch {} });
        _dropdowns.clear();

        content.innerHTML = '<div class="crm-loading">Loading…</div>';
        let res;
        try {
            res = await api.request('/crm/leads/reassign-queue');
        } catch (e) {
            content.innerHTML = `<div class="crm-empty-state">
                <div class="crm-empty-content">
                    <h3>Couldn't load queue</h3>
                    <p>${esc(e?.message || 'Unknown error')}.<br>Sign in as an admin or team manager to use this page.</p>
                </div>
            </div>`;
            return;
        }
        _groups = (res && Array.isArray(res.groups)) ? res.groups : [];
        const total = (res && typeof res.total_count === 'number') ? res.total_count : 0;
        render(total);
    }

    function render(total) {
        const content = document.getElementById('rqContent');
        if (total === 0) {
            content.innerHTML = `
                <div class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <h3>All clear</h3>
                        <p>No leads are owned by deactivated users right now.</p>
                    </div>
                </div>`;
            return;
        }

        const summary = `<div class="rq-summary">
            <strong class="rq-summary-count">${total}</strong>
            lead${total===1?'':'s'} across
            <strong>${_groups.length}</strong> team${_groups.length===1?'':'s'} need a new owner.
        </div>`;

        const groupsHtml = _groups.map((g, gi) => renderGroup(g, gi)).join('');
        content.innerHTML = summary + groupsHtml;
        wireGroupDropdowns();
        wireGroupHandlers();
    }

    function renderGroup(g, gi) {
        const teamName = esc(g.team_name || '(no team)');
        const hasMembers = (g.available_members || []).length > 0;
        const noMembersWarning = hasMembers ? '' : `
            <div class="rq-warning">
                ⚠️ This team has no other active members. Add a member in Team Setup, or use "Leave unassigned".
            </div>`;

        const rows = (g.leads || []).map((l, li) => {
            const name = `${esc(l.first_name || '')} ${esc(l.last_name || '')}`.trim() || '(no name)';
            const formerOwner = esc(l.owner_name || l.owner_user_id || 'unknown');
            return `<tr data-lead-id="${esc(l.id)}" data-group-index="${gi}">
                <td><a href="leads.html?lead=${esc(l.id)}">${esc(l.lead_id || '')}</a></td>
                <td>
                    <div class="crm-cell-primary">${name}</div>
                    <div class="crm-cell-secondary">${esc(l.company || '')}</div>
                </td>
                <td class="hide-mobile">${esc(l.email || '')}</td>
                <td>
                    <span class="rq-inactive-pill">
                        <span class="rq-inactive-dot"></span>
                        ${formerOwner}
                    </span>
                </td>
                <td>
                    <div id="rq-row-pick-${gi}-${li}" class="rq-row-pick" data-no-members="${hasMembers ? 'false' : 'true'}"></div>
                </td>
                <td>
                    <button type="button" class="btn btn-primary btn-sm rq-row-apply">Reassign</button>
                </td>
            </tr>`;
        }).join('');

        return `<div class="rq-group" data-group-index="${gi}">
            <div class="rq-group-header">
                <div>
                    <div class="rq-group-title">${teamName}</div>
                    <div class="rq-group-subtitle">${g.count} lead${g.count===1?'':'s'} need a new owner</div>
                </div>
                <div class="rq-group-bulk">
                    <div id="rq-bulk-pick-${gi}" class="rq-bulk-pick"></div>
                    <button type="button" class="btn btn-primary btn-sm rq-bulk-apply">Apply to all</button>
                </div>
            </div>
            ${noMembersWarning}
            <div class="crm-table-wrapper data-table-container">
                <table class="crm-table data-table rq-table">
                    <thead>
                        <tr>
                            <th>Lead ID</th>
                            <th>Name</th>
                            <th class="hide-mobile">Email</th>
                            <th>Former Owner</th>
                            <th>New Owner</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
    }

    function buildOwnerOptions(group) {
        // SearchableDropdown options — value is a real user_id, except for the
        // sentinel "leave unassigned" which uses the literal __unassigned__.
        const opts = [{ value: '__unassigned__', label: 'Leave unassigned', description: 'Manager will reassign later' }];
        for (const m of (group.available_members || [])) {
            opts.push({
                value: m.user_id,
                label: m.name || m.user_id,
                description: m.role && m.role !== 'member' ? m.role : ''
            });
        }
        return opts;
    }

    function wireGroupDropdowns() {
        _groups.forEach((g, gi) => {
            const opts = buildOwnerOptions(g);

            // Bulk-pick at the group header.
            const bulkContainer = document.getElementById(`rq-bulk-pick-${gi}`);
            if (bulkContainer) {
                const dd = new SearchableDropdown(bulkContainer, {
                    options: opts,
                    placeholder: '— bulk reassign to —',
                    searchPlaceholder: 'Search team members…',
                    compact: true
                });
                _dropdowns.set(`bulk-${gi}`, dd);
            }

            // Per-row pick. Each row gets its own dropdown so the manager can
            // pick a different new owner per lead.
            (g.leads || []).forEach((_, li) => {
                const rowContainer = document.getElementById(`rq-row-pick-${gi}-${li}`);
                if (!rowContainer) return;
                const dd = new SearchableDropdown(rowContainer, {
                    options: opts,
                    placeholder: '— pick a new owner —',
                    searchPlaceholder: 'Search…',
                    compact: true
                });
                _dropdowns.set(`row-${gi}-${li}`, dd);
            });
        });
    }

    function wireGroupHandlers() {
        // Per-row Reassign button
        document.querySelectorAll('.rq-row-apply').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const tr = e.target.closest('tr');
                const leadId = tr?.getAttribute('data-lead-id');
                const gi = parseInt(tr?.getAttribute('data-group-index') || '-1', 10);
                const li = Array.from(tr.parentNode.children).indexOf(tr);
                const dd = _dropdowns.get(`row-${gi}-${li}`);
                const value = dd?.selectedValue || '';
                if (!leadId || !value) {
                    showToast('Pick a new owner for this lead first', 'error');
                    return;
                }
                btn.disabled = true; btn.textContent = '…';
                try {
                    await reassignLead(leadId, value);
                    showToast('Lead reassigned', 'success');
                    setTimeout(() => loadQueue(), 350);
                } catch (err) {
                    showToast(err?.message || 'Reassign failed', 'error');
                    btn.disabled = false; btn.textContent = 'Reassign';
                }
            });
        });

        // Bulk Apply to all
        document.querySelectorAll('.rq-bulk-apply').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const groupEl = btn.closest('.rq-group');
                const gi = parseInt(groupEl.getAttribute('data-group-index'), 10);
                const dd = _dropdowns.get(`bulk-${gi}`);
                const value = dd?.selectedValue || '';
                if (!value) {
                    showToast('Pick an owner for the bulk reassign first', 'error');
                    return;
                }
                const rows = groupEl.querySelectorAll('tr[data-lead-id]');
                if (rows.length === 0) return;

                // Brand-themed confirm — never window.confirm().
                const ok = await showConfirm(
                    `Reassign ${rows.length} lead${rows.length===1?'':'s'} to the selected owner?`,
                    'Bulk Reassign'
                );
                if (!ok) return;

                btn.disabled = true;
                const origText = btn.textContent;
                btn.textContent = `Reassigning… (0/${rows.length})`;
                let done = 0, failed = 0;
                for (const tr of rows) {
                    const leadId = tr.getAttribute('data-lead-id');
                    try {
                        await reassignLead(leadId, value);
                        done++;
                    } catch { failed++; }
                    btn.textContent = `Reassigning… (${done}/${rows.length})`;
                }
                if (failed > 0) {
                    showToast(`Reassigned ${done}, ${failed} failed`, 'error');
                } else {
                    showToast(`Reassigned ${done} lead${done===1?'':'s'}`, 'success');
                }
                btn.textContent = origText;
                btn.disabled = false;
                setTimeout(() => loadQueue(), 600);
            });
        });
    }

    async function reassignLead(leadId, value) {
        if (value === '__unassigned__') {
            // PUT /leads/{id} with owner_user_id=null nulls the owner. The
            // assignment-history table picks this up via the same code path
            // as a named-owner reassign (see BusinessLayer_Leads.AssignLead).
            await api.request(`/crm/leads/${leadId}`, {
                method: 'PUT',
                body: JSON.stringify({ owner_user_id: null }),
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            await api.request(`/crm/leads/${leadId}/assign`, {
                method: 'PUT',
                body: JSON.stringify({ owner_user_id: value }),
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    }
})();
