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
    // Rich pre-selection from the Leads page: [{id, leadNumber, firstName,
    // lastName, email, companyName}, ...]. Falls back to a plain list of
    // UUIDs when the caller doesn't have the richer payload.
    let preselectedLeads = [];

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

    // Accepts either ['<uuid>', ...] (legacy) or [{id, leadNumber, firstName,
    // lastName, email, companyName}, ...]. Both normalise into preselectedLeads.
    window.openCampaignModal = function (preselection) {
        preselectedLeads = (preselection || []).map(l =>
            typeof l === 'string' ? { id: l } : l
        );

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
        renderCampaignLeadList();
        document.getElementById('campModalError').style.display = 'none';

        showModal('campaignModal');
    };

    // Compact selected-leads list. Shows first N rows with name + email +
    // LD-XXXX, collapses the rest behind a count chip. For 1000 leads we
    // never DOM-render more than DISPLAY_LIMIT rows so the modal stays fast.
    const DISPLAY_LIMIT = 50;
    let campLeadSearchQuery = '';
    function bindCampLeadSearch() {
        const box = document.getElementById('campLeadSearch');
        if (!box || box._bound) return;
        box._bound = true;
        box.addEventListener('input', e => {
            campLeadSearchQuery = e.target.value.trim().toLowerCase();
            renderCampaignLeadList();
        });
    }
    function filterPreselected() {
        if (!campLeadSearchQuery) return preselectedLeads;
        const q = campLeadSearchQuery;
        return preselectedLeads.filter(l => {
            const hay = [
                l.leadNumber, l.firstName, l.lastName, l.email, l.companyName
            ].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
        });
    }
    function renderCampaignLeadList() {
        const summary = document.getElementById('campLeadSummary');
        const listEl = document.getElementById('campLeadList');
        const emptyEl = document.getElementById('campLeadEmpty');
        const searchEl = document.getElementById('campLeadSearch');
        if (!summary || !listEl || !emptyEl) return;

        bindCampLeadSearch();

        const n = preselectedLeads.length;
        emptyEl.style.display = n === 0 ? 'block' : 'none';
        listEl.style.display = n === 0 ? 'none' : 'block';
        if (searchEl) searchEl.style.display = n > DISPLAY_LIMIT ? 'block' : 'none';

        if (n === 0) {
            summary.textContent = 'No leads selected.';
            listEl.innerHTML = '';
            return;
        }

        const filtered = filterPreselected();
        summary.textContent = campLeadSearchQuery
            ? `${filtered.length} of ${n} match “${campLeadSearchQuery}”`
            : `${n} lead${n === 1 ? '' : 's'} selected`;

        const visible = filtered.slice(0, DISPLAY_LIMIT);
        const rest = Math.max(0, filtered.length - DISPLAY_LIMIT);
        listEl.innerHTML = visible.map(l => {
            // Every row emits all 5 grid cells — missing fields become a muted
            // dash so columns stay aligned even when email / company / lead
            // number are absent.
            const nm = [l.firstName, l.lastName].filter(Boolean).join(' ') || '(unnamed)';
            return `<div class="camp-lead-row" data-id="${escapeHtml(l.id)}">
                <span class="camp-lead-number">${escapeHtml(l.leadNumber || '—')}</span>
                <span class="camp-lead-name" title="${escapeHtml(nm)}">${escapeHtml(nm)}</span>
                <span class="camp-lead-email ${l.email ? '' : 'muted'}" title="${escapeHtml(l.email || '')}">${escapeHtml(l.email || '(no email)')}</span>
                <span class="camp-lead-company" title="${escapeHtml(l.companyName || '')}">${escapeHtml(l.companyName || '')}</span>
                <button class="camp-lead-remove" title="Remove" onclick="removePreselectedLead('${escapeHtml(l.id)}')">&times;</button>
            </div>`;
        }).join('') + (rest > 0
            ? `<div class="camp-lead-more">…and <strong>${rest}</strong> more</div>`
            : '');
    }

    // Let the user drop a lead from the selection before creating the
    // campaign — useful when they bulk-selected 1000 but want to exclude 2.
    window.removePreselectedLead = function (id) {
        preselectedLeads = preselectedLeads.filter(l => l.id !== id);
        renderCampaignLeadList();
    };

    window.closeCampaignModal = function () {
        hideModal('campaignModal');
    };

    window.saveCampaign = async function () {
        const name = document.getElementById('campName').value.trim();
        const templateId = document.getElementById('campTemplate').value;
        const mailboxId = document.getElementById('campMailbox').value;
        const leadIds = preselectedLeads
            .map(l => l.id)
            .filter(s => /^[0-9a-f-]{36}$/i.test(s));

        if (!name) return showCampError('Name is required.');
        if (!templateId) return showCampError('Pick a template.');
        if (!mailboxId) return showCampError('Pick a mailbox.');
        if (leadIds.length === 0) return showCampError('Select at least one lead from the Leads page.');
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

    // Auto-open the New Campaign modal when the Leads page sends us here
    // with ?tab=campaigns&prefill=1. Selected lead IDs travel via
    // sessionStorage so the URL stays short + doesn't leak IDs into history.
    async function handlePrefill() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('tab') !== 'campaigns' || params.get('prefill') !== '1') return;

        if (typeof window.switchSettingsTab === 'function') window.switchSettingsTab('campaigns');
        // Give the tab-switch + API loads (templates + mailboxes) a moment
        // to finish before popping the modal — otherwise the dropdowns are
        // empty when it opens.
        await new Promise(r => setTimeout(r, 400));

        let preselection = [];
        try {
            // New rich payload (name + email + lead number + UUID)
            const rich = sessionStorage.getItem('crm.campaign.prefillLeads');
            if (rich) {
                preselection = JSON.parse(rich) || [];
                sessionStorage.removeItem('crm.campaign.prefillLeads');
            } else {
                // Legacy UUID-only payload — kept for backwards compatibility
                // during rolling deploys.
                const raw = sessionStorage.getItem('crm.campaign.prefillLeadIds');
                if (raw) preselection = JSON.parse(raw) || [];
                sessionStorage.removeItem('crm.campaign.prefillLeadIds');
            }
        } catch (_) { /* malformed → ignore, open modal empty */ }

        if (typeof window.openCampaignModal === 'function') window.openCampaignModal(preselection);

        // Strip the query params so a refresh doesn't re-fire the modal.
        const clean = window.location.pathname + '#campaigns';
        window.history.replaceState({}, '', clean);
    }

    function initIfActive() {
        const tab = document.getElementById('tab-campaigns');
        const params = new URLSearchParams(window.location.search);
        if (params.get('tab') === 'campaigns') {
            // Explicit deep link — load the tab even if not currently active
            // so handlePrefill() has templates+mailboxes ready when it fires.
            if (typeof window.switchSettingsTab === 'function') window.switchSettingsTab('campaigns');
            handlePrefill();
        } else if (tab && tab.classList.contains('active')) {
            window.loadCampaignsTab();
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIfActive);
    else initIfActive();
})();
