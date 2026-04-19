// ─────────────────────────────────────────────────────────────────────────
// CRM Settings → Campaigns tab
//
// v1 UX:
//   - List campaigns with status + counters + progress bar.
//   - Create campaign = pick name + template + mailbox + paste/import lead
//     IDs (future: proper lead-picker launched from leads page).
//   - Start / pause / resume / cancel actions.
//
// Template and mailbox pickers are populated from existing API endpoints.
// ─────────────────────────────────────────────────────────────────────────

(function () {
    let campaigns = [];
    let templates = [];
    let mailboxes = [];
    // When the user initiates a campaign from the leads page we stash their
    // selection here so the modal pre-populates.
    let preselectedLeadIds = [];

    window.loadCampaignsTab = async function () {
        await Promise.all([
            loadCampaigns(),
            loadTemplatesForPicker(),
            loadMailboxesForPicker(),
        ]);
    };

    async function loadCampaigns() {
        try {
            const resp = await api.request('/email-campaigns');
            campaigns = (resp && resp.items) || [];
        } catch (e) {
            console.error('Failed to load campaigns:', e);
            campaigns = [];
        }
        renderCampaigns();
    }

    async function loadTemplatesForPicker() {
        try {
            const resp = await api.request('/email-templates');
            templates = (resp && resp.items) || [];
        } catch (e) { templates = []; }
    }

    async function loadMailboxesForPicker() {
        try {
            const resp = await api.request('/mailboxes');
            mailboxes = ((resp && resp.mailboxes) || []).filter(m => m.isActive);
        } catch (e) { mailboxes = []; }
    }

    function renderCampaigns() {
        const tbody = document.getElementById('campaignsTableBody');
        const wrap = document.getElementById('campaignsTableWrapper');
        const empty = document.getElementById('campaignsEmpty');
        if (!tbody) return;

        if (!campaigns.length) {
            if (wrap) wrap.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (wrap) wrap.style.display = '';
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = campaigns.map(c => {
            const total = c.total_leads || 1;
            const done = (c.sent_count || 0) + (c.failed_count || 0) + (c.unsubscribed_count || 0);
            const pct = Math.min(100, Math.round((done / total) * 100));
            return `
                <tr>
                    <td><strong>${escapeHtml(c.name)}</strong></td>
                    <td><span class="status-badge status-${c.status}">${c.status}</span></td>
                    <td class="hide-mobile">${c.sent_count || 0} / ${c.total_leads || 0}</td>
                    <td class="hide-mobile">
                        <span title="Opened">👁 ${c.opened_count || 0}</span> &nbsp;
                        <span title="Clicked">👆 ${c.clicked_count || 0}</span> &nbsp;
                        <span title="Replied">✉ ${c.replied_count || 0}</span> &nbsp;
                        <span title="Bounced">⚠ ${c.bounced_count || 0}</span>
                    </td>
                    <td class="hide-mobile">
                        <div class="progress-mini">
                            <div class="progress-mini-bar" style="width:${pct}%;"></div>
                        </div>
                        <span class="muted">${pct}%</span>
                    </td>
                    <td>${renderCampaignActions(c)}</td>
                </tr>`;
        }).join('');
    }

    function renderCampaignActions(c) {
        const btns = [];
        if (c.status === 'running') {
            btns.push(`<button class="btn btn-sm btn-outline-secondary" onclick="pauseCampaign('${c.id}')">Pause</button>`);
        }
        if (c.status === 'paused') {
            btns.push(`<button class="btn btn-sm btn-outline-primary" onclick="resumeCampaign('${c.id}')">Resume</button>`);
        }
        if (c.status !== 'completed' && c.status !== 'failed') {
            btns.push(`<button class="btn btn-sm btn-outline-danger" onclick="cancelCampaign('${c.id}')">Cancel</button>`);
        }
        return btns.join(' ') || '<span class="muted">—</span>';
    }

    // ─── Create modal ──────────────────────────────────────────────────────

    window.openCampaignModal = function (preselectedIds) {
        preselectedLeadIds = Array.isArray(preselectedIds) ? preselectedIds.slice() : [];

        // Populate selects
        const tSel = document.getElementById('campTemplate');
        tSel.innerHTML = '<option value="">— pick a template —</option>' +
            templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
        const mSel = document.getElementById('campMailbox');
        mSel.innerHTML = '<option value="">— pick a mailbox —</option>' +
            mailboxes.map(m =>
                `<option value="${m.id}">${escapeHtml(m.emailAddress)} (${m.connectionType})</option>`
            ).join('');

        document.getElementById('campName').value = '';
        document.getElementById('campLeadIds').value = preselectedLeadIds.join('\n');
        document.getElementById('campLeadCount').textContent = preselectedLeadIds.length
            ? `${preselectedLeadIds.length} lead(s) pre-selected from Leads page.`
            : 'Paste one lead UUID per line, or launch from the Leads page to pre-fill.';
        document.getElementById('campModalError').style.display = 'none';

        showModal('campaignModal');
    };

    window.closeCampaignModal = function () {
        hideModal('campaignModal');
    };

    window.saveCampaign = async function () {
        const name = document.getElementById('campName').value.trim();
        const templateId = document.getElementById('campTemplate').value;
        const mailboxId = document.getElementById('campMailbox').value;
        const leadIds = document.getElementById('campLeadIds').value
            .split(/[\s,]+/)
            .map(s => s.trim())
            .filter(s => /^[0-9a-f-]{36}$/i.test(s));

        if (!name) return showCampError('Name is required.');
        if (!templateId) return showCampError('Pick a template.');
        if (!mailboxId) return showCampError('Pick a mailbox.');
        if (leadIds.length === 0) return showCampError('At least one valid lead UUID required.');
        if (leadIds.length > 10000) return showCampError('Max 10,000 leads per campaign.');

        let campaignId;
        try {
            const resp = await api.request('/email-campaigns', {
                method: 'POST',
                body: JSON.stringify({
                    name, template_id: templateId, mailbox_id: mailboxId, lead_ids: leadIds
                }),
            });
            campaignId = resp.campaign_id;
        } catch (e) {
            return showCampError(e.message || String(e));
        }

        // Ask whether to start immediately
        const startNow = confirm(
            `Campaign created with ${leadIds.length} lead(s). Start sending now?`
        );
        if (startNow) {
            try {
                const startResp = await api.request(`/email-campaigns/${campaignId}/start`, {
                    method: 'POST',
                    body: JSON.stringify(leadIds),
                });
                alert(`Started: ${startResp.queued} queued, ${startResp.skipped_suppressed} suppressed, ${startResp.skipped_no_email} without email.`);
            } catch (e) {
                alert('Created but failed to start: ' + (e.message || e));
            }
        }

        hideModal('campaignModal');
        await loadCampaigns();
    };

    // ─── Transitions ───────────────────────────────────────────────────────

    window.pauseCampaign = async function (id) {
        try {
            await api.request(`/email-campaigns/${id}/pause`, { method: 'POST' });
            await loadCampaigns();
        } catch (e) { alert('Pause failed: ' + (e.message || e)); }
    };
    window.resumeCampaign = async function (id) {
        try {
            await api.request(`/email-campaigns/${id}/resume`, { method: 'POST' });
            await loadCampaigns();
        } catch (e) { alert('Resume failed: ' + (e.message || e)); }
    };
    window.cancelCampaign = async function (id) {
        if (!confirm('Cancel this campaign? Remaining queued sends will not be delivered.')) return;
        try {
            await api.request(`/email-campaigns/${id}/cancel`, { method: 'POST' });
            await loadCampaigns();
        } catch (e) { alert('Cancel failed: ' + (e.message || e)); }
    };

    // ─── helpers ───────────────────────────────────────────────────────────

    function showCampError(msg) {
        const el = document.getElementById('campModalError');
        el.textContent = msg;
        el.style.display = 'block';
    }
    function showModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.add('active');
    }
    function hideModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.remove('active');
    }
    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function initIfActive() {
        const tab = document.getElementById('tab-campaigns');
        if (tab && tab.classList.contains('active')) window.loadCampaignsTab();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIfActive);
    else initIfActive();
})();
