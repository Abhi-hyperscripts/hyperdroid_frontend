// ─── Settings → Automations tab ──────────────────────────────────────────
// Tenant-wide view of every status-email trigger across every team. Pulls
// from /status-email-triggers/all (single round-trip with team / template /
// source labels resolved server-side) and groups rows by team. Each team
// section has a "Manage" button that opens the existing per-team modal in
// js/crm/team-email-triggers.js — so all editing still happens through the
// already-tested modal, this tab is purely a discovery/read aggregator.
//
// Why this tab exists: the only entry point used to be the envelope icon on
// each team card under Teams Setup, which was hard to find. Surface it
// here too so admins can see the full automation picture in one place.

(function () {
    'use strict';

    const STATUS_LABELS = {
        new:         'New',
        assigned:    'Assigned',
        contacted:   'Contacted',
        qualified:   'Qualified',
        unqualified: 'Unqualified',
        converted:   'Converted',
        lost:        'Lost'
    };

    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
        }[c]));
    }

    function statusBadge(status) {
        const label = STATUS_LABELS[status] || status;
        return `<span class="trigger-status-pill">${esc(label)}</span>`;
    }

    function pickReadableTextColor(hex) {
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#fff';
        const r = parseInt(hex.slice(1,3),16),
              g = parseInt(hex.slice(3,5),16),
              b = parseInt(hex.slice(5,7),16);
        const luma = 0.299*r + 0.587*g + 0.114*b;
        return luma > 165 ? '#0f172a' : '#fff';
    }

    // Real team badge — same look as leads-table .crm-team-badge so colours
    // are consistent across the app.
    function teamBadge(color, name) {
        const safeName = esc(name || '');
        if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
            const fg = pickReadableTextColor(color);
            return `<span class="crm-team-badge" style="background:${esc(color)};color:${fg};">${safeName}</span>`;
        }
        return `<span class="crm-team-badge">${safeName}</span>`;
    }

    // Merge all-teams (so empty teams still show with a Manage button) with
    // the triggers list. Sort: teams with triggers first, then alphabetically.
    function buildGroups(allTeams, rows) {
        const map = new Map();
        for (const t of allTeams) {
            if (!t || !t.id) continue;
            map.set(t.id, {
                teamId: t.id,
                teamName: t.team_name,
                teamColor: t.color,
                triggers: []
            });
        }
        for (const r of rows) {
            if (!map.has(r.team_id)) {
                // Trigger references a team we didn't get back from /teams (e.g.
                // archived). Surface it anyway so admins can clean up.
                map.set(r.team_id, {
                    teamId: r.team_id,
                    teamName: r.team_name,
                    teamColor: r.team_color,
                    triggers: []
                });
            }
            map.get(r.team_id).triggers.push(r);
        }
        return Array.from(map.values()).sort((a, b) => {
            const ac = a.triggers.length === 0 ? 1 : 0;
            const bc = b.triggers.length === 0 ? 1 : 0;
            if (ac !== bc) return ac - bc;
            return (a.teamName || '').localeCompare(b.teamName || '');
        });
    }

    function renderTeamSection(group) {
        if (group.triggers.length === 0) {
            return `
                <div class="automation-team-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px 18px; margin-bottom: 14px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                        <div style="font-weight:600; font-size: 0.98rem; color: var(--text-primary);">
                            ${teamBadge(group.teamColor, group.teamName)}
                            <span style="margin-left:10px; color: var(--text-tertiary); font-size: 0.82rem; font-weight: 400;">
                                No triggers configured
                            </span>
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="openTriggersModalFromAutomations('${esc(group.teamId)}', '${esc(group.teamName).replace(/'/g, "\\'")}')">
                            Add triggers
                        </button>
                    </div>
                </div>
            `;
        }

        const rowsHtml = group.triggers.map(t => {
            const sourceCell = t.lead_source_name
                ? esc(t.lead_source_name)
                : '<span style="color: var(--text-tertiary); font-style: italic;">All sources</span>';
            const tplCell = t.template_is_active
                ? esc(t.template_name)
                : `<span style="color: var(--color-warning);">${esc(t.template_name)} <small>(inactive)</small></span>`;
            const activeCell = t.is_active
                ? '<span style="color: var(--color-success); font-size: 0.85rem;">Active</span>'
                : '<span style="color: var(--text-tertiary); font-size: 0.85rem;">Disabled</span>';
            return `
                <tr>
                    <td>${statusBadge(t.status)}</td>
                    <td>${sourceCell}</td>
                    <td>${tplCell}</td>
                    <td style="text-align:center;">${esc(t.fire_order)}</td>
                    <td>${activeCell}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="automation-team-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px 18px; margin-bottom: 14px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 12px;">
                    <div style="font-weight:600; font-size: 0.98rem; color: var(--text-primary);">
                        ${teamBadge(group.teamColor, group.teamName)}
                        <span style="margin-left:10px; color: var(--text-tertiary); font-size: 0.82rem; font-weight: 400;">
                            ${group.triggers.length} trigger${group.triggers.length === 1 ? '' : 's'}
                        </span>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="openTriggersModalFromAutomations('${esc(group.teamId)}', '${esc(group.teamName).replace(/'/g, "\\'")}')">
                        Manage
                    </button>
                </div>
                <div class="crm-table-wrapper" style="overflow-x:auto;">
                    <table class="crm-table" style="margin:0;">
                        <thead>
                            <tr>
                                <th style="width: 130px;">Status</th>
                                <th>Lead source</th>
                                <th>Template fired</th>
                                <th style="width: 80px; text-align:center;">Fire order</th>
                                <th style="width: 110px;">State</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderEmpty() {
        return `
            <div class="empty-state-card" style="background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: 10px; padding: 32px 24px; text-align: center;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-tertiary); margin-bottom: 10px;">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                <h4 style="margin: 0 0 6px; color: var(--text-primary); font-weight: 600;">No automations configured yet</h4>
                <p style="margin: 0 0 16px; color: var(--text-secondary); font-size: 0.9rem;">
                    Open <strong>Teams Setup</strong>, click the envelope icon on any team card and pick a status → template pairing to start firing emails automatically.
                </p>
                <button class="btn btn-primary btn-sm" onclick="switchSettingsTab('teams')">
                    Go to Teams Setup
                </button>
            </div>
        `;
    }

    async function loadAutomationsTab() {
        const container = document.getElementById('automationsContainer');
        if (!container) return;

        try {
            const [trigResp, teamsResp] = await Promise.all([
                api.request('/status-email-triggers/all'),
                api.request('/crm/teams').catch(() => [])
            ]);
            const rows = (trigResp && trigResp.triggers) || [];
            const allTeams = Array.isArray(teamsResp) ? teamsResp.filter(t => t.is_active !== false) : [];

            if (rows.length === 0 && allTeams.length === 0) {
                container.innerHTML = renderEmpty();
                return;
            }

            const groups = buildGroups(allTeams, rows);
            container.innerHTML = groups.map(renderTeamSection).join('');
        } catch (err) {
            console.error('Failed to load automations:', err);
            container.innerHTML = `
                <div class="empty-state-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 24px; text-align: center; color: var(--color-danger);">
                    Failed to load automations. ${esc(err && err.message || '')}
                </div>
            `;
        }
    }

    // After the per-team modal closes, refresh this tab so any newly-added
    // trigger shows up without a full page reload. We wrap closeTriggersModal
    // for this single open; the original is restored on next close.
    window.openTriggersModalFromAutomations = function (teamId, teamName) {
        if (typeof window.openTriggersModal !== 'function') {
            console.warn('openTriggersModal not loaded');
            return;
        }
        const originalClose = window.closeTriggersModal;
        window.closeTriggersModal = function () {
            if (typeof originalClose === 'function') originalClose();
            window.closeTriggersModal = originalClose;
            loadAutomationsTab();
        };
        window.openTriggersModal(teamId, teamName);
    };

    window.loadAutomationsTab = loadAutomationsTab;
})();
