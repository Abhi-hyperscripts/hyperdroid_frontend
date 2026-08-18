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
        } catch (e) {
            templates = [];
            // Don't let a failed load look like "no templates exist" — the compose
            // validation would then demand a template the user can't pick.
            if (typeof Toast !== 'undefined') Toast.error('Could not load templates — please retry.');
        }
    }

    async function loadMailboxesForPicker() {
        try {
            const resp = await api.request('/mailboxes');
            mailboxes = ((resp && resp.mailboxes) || []).filter(m => m.isActive);
        } catch (e) {
            mailboxes = [];
            if (typeof Toast !== 'undefined') Toast.error('Could not load mailboxes — please retry.');
        }
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
            // "Done" means a recipient this campaign will not act on again:
            // sent, failed, or skipped because they were already on the
            // suppression list. It is deliberately NOT unsubscribed_count —
            // that column carries BOTH "skipped, already suppressed" and
            // "unsubscribed because of this campaign", and counting the second
            // as progress would let real unsubscribes push the bar towards
            // 100% while sends were still outstanding.
            //
            // Falls back to unsubscribed_count so an older backend, which has
            // no skipped_suppressed_count, keeps behaving exactly as before.
            const skipped = c.skipped_suppressed_count ?? c.unsubscribed_count ?? 0;
            const done = (c.sent_count || 0) + (c.failed_count || 0) + skipped;
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
                        <span title="Bounced">⚠ ${c.bounced_count || 0}</span> &nbsp;
                        <span title="Unsubscribed from this campaign">🚫 ${Math.max(0, (c.unsubscribed_count || 0) - (c.skipped_suppressed_count || 0))}</span>
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
        if (c.status === 'draft') {
            btns.push(`<button class="btn btn-sm btn-primary" onclick="startCampaign('${c.id}')">Start</button>`);
        }
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

    // Current modal mode: 'existing' = append to a campaign the user picks from
    // the dropdown; 'new' = current create-from-scratch flow. Defaults to
    // 'existing' when any draft/running/paused campaigns exist, so the common
    // case (re-using an active outreach) is one click instead of three.
    let campaignMode = 'new';

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

        // Existing-campaign picker: only campaigns still accepting new leads
        // (draft / running / paused). Completed or failed campaigns can't grow.
        const appendable = campaigns.filter(c =>
            c.status === 'draft' || c.status === 'running' || c.status === 'paused'
        );
        const eSel = document.getElementById('campExisting');
        if (appendable.length === 0) {
            eSel.innerHTML = '<option value="">No open campaigns — create a new one</option>';
        } else {
            eSel.innerHTML = '<option value="">— pick a campaign —</option>' +
                appendable.map(c =>
                    `<option value="${c.id}">${escapeHtml(c.name)} (${c.status} · ${c.sent_count || 0}/${c.total_leads || 0})</option>`
                ).join('');
        }
        const existingBtn = document.getElementById('campModeExistingBtn');
        if (existingBtn) existingBtn.disabled = appendable.length === 0;

        document.getElementById('campName').value = '';
        renderCampaignLeadList();
        document.getElementById('campModalError').style.display = 'none';

        // Default to 'existing' only when the user arrived with leads already
        // picked (bulk-select from Leads page) AND there's a campaign to attach
        // them to. Clicking "+ New Campaign" from the list should still start on
        // the create-new tab — that's what the button's name promises.
        const defaultMode = (preselectedLeads.length > 0 && appendable.length > 0)
            ? 'existing' : 'new';
        setCampaignMode(defaultMode);

        showModal('campaignModal');
    };

    window.setCampaignMode = function (mode) {
        campaignMode = mode === 'existing' ? 'existing' : 'new';
        const existingBtn = document.getElementById('campModeExistingBtn');
        const newBtn = document.getElementById('campModeNewBtn');
        if (existingBtn) {
            existingBtn.classList.toggle('active', campaignMode === 'existing');
            existingBtn.setAttribute('aria-selected', campaignMode === 'existing');
        }
        if (newBtn) {
            newBtn.classList.toggle('active', campaignMode === 'new');
            newBtn.setAttribute('aria-selected', campaignMode === 'new');
        }
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? '' : 'none';
        };
        show('campExistingGroup', campaignMode === 'existing');
        show('campNameGroup', campaignMode === 'new');
        show('campTemplateGroup', campaignMode === 'new');
        show('campMailboxGroup', campaignMode === 'new');

        const btn = document.getElementById('campSaveBtn');
        if (btn) btn.textContent = campaignMode === 'existing' ? 'Add leads to campaign' : 'Create & start';

        const hint = document.getElementById('campExistingHint');
        if (hint) {
            hint.textContent = campaignMode === 'existing'
                ? 'Draft campaigns stay as drafts — start them manually. Running campaigns pick up new leads automatically.'
                : '';
        }
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
                <button class="camp-lead-remove" title="Remove" onclick="removePreselectedLead('${escapeHtmlJsAttr(l.id)}')">&times;</button>
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
        const leadIds = preselectedLeads
            .map(l => l.id)
            .filter(s => /^[0-9a-f-]{36}$/i.test(s));
        if (leadIds.length === 0) return showCampError('Select at least one lead from the Leads page.');
        if (leadIds.length > 10000) return showCampError('Max 10,000 leads per campaign.');

        if (campaignMode === 'existing') {
            const existingId = document.getElementById('campExisting').value;
            if (!existingId) return showCampError('Pick a campaign to add these leads to.');
            const existingCampaign = campaigns.find(c => c.id === existingId);
            try {
                const resp = await api.request(`/email-campaigns/${existingId}/append-leads`, {
                    method: 'POST',
                    body: JSON.stringify(leadIds),
                });
                Toast.success(
                    `Added — ${resp.queued} queued` +
                    (resp.skipped_suppressed ? `, ${resp.skipped_suppressed} suppressed` : '') +
                    (resp.skipped_no_email ? `, ${resp.skipped_no_email} without email` : '')
                );
                // If the target campaign is still a draft, the executor won't
                // touch it until the user flips it to running. Offer to start
                // right here instead of forcing a second round-trip to the
                // campaigns list just to click "Start".
                if (existingCampaign && existingCampaign.status === 'draft' && resp.queued > 0) {
                    const startNow = await showConfirm(
                        `${resp.queued} lead(s) queued on draft campaign "${existingCampaign.name}". Start sending now?`,
                        'Start campaign?',
                        'info'
                    );
                    if (startNow) {
                        try {
                            await api.request(`/email-campaigns/${existingId}/start`, {
                                method: 'POST',
                                body: JSON.stringify([]),
                            });
                            Toast.success('Campaign started — sending will begin shortly');
                        } catch (e) {
                            Toast.error('Start failed: ' + (e.message || e));
                        }
                    }
                }
            } catch (e) {
                return showCampError(e.message || String(e));
            }
            hideModal('campaignModal');
            await loadCampaigns();
            return;
        }

        const name = document.getElementById('campName').value.trim();
        const templateId = document.getElementById('campTemplate').value;
        const mailboxId = document.getElementById('campMailbox').value;

        if (!name) return showCampError('Name is required.');
        if (!templateId) return showCampError('Pick a template.');
        if (!mailboxId) return showCampError('Pick a mailbox.');

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
        const startNow = await showConfirm(
            `Campaign created with ${leadIds.length} lead(s). Start sending now?`,
            'Start campaign?',
            'info'
        );
        if (startNow) {
            try {
                const startResp = await api.request(`/email-campaigns/${campaignId}/start`, {
                    method: 'POST',
                    body: JSON.stringify(leadIds),
                });
                Toast.success(
                    `Started — ${startResp.queued} queued` +
                    (startResp.skipped_suppressed ? `, ${startResp.skipped_suppressed} suppressed` : '') +
                    (startResp.skipped_no_email ? `, ${startResp.skipped_no_email} without email` : '')
                );
            } catch (e) {
                Toast.error('Created but failed to start: ' + (e.message || e));
            }
        } else {
            Toast.success('Draft campaign saved');
        }

        hideModal('campaignModal');
        await loadCampaigns();
    };

    // ─── Transitions ───────────────────────────────────────────────────────

    // Flip a draft campaign to running without re-queuing the leads it
    // already holds. The append-leads flow pre-queues sends, so /start with
    // an empty body just needs to transition state.
    window.startCampaign = async function (id) {
        const ok = await showConfirm(
            'Start sending emails for this campaign? Queued recipients will begin receiving emails immediately, respecting per-mailbox rate caps.',
            'Start campaign',
            'info'
        );
        if (!ok) return;
        try {
            const resp = await api.request(`/email-campaigns/${id}/start`, {
                method: 'POST',
                body: JSON.stringify([]),
            });
            Toast.success('Campaign started — sending will begin shortly');
            await loadCampaigns();
        } catch (e) {
            Toast.error('Start failed: ' + (e.message || e));
        }
    };

    window.pauseCampaign = async function (id) {
        try {
            await api.request(`/email-campaigns/${id}/pause`, { method: 'POST' });
            Toast.success('Campaign paused');
            await loadCampaigns();
        } catch (e) { Toast.error('Pause failed: ' + (e.message || e)); }
    };
    window.resumeCampaign = async function (id) {
        try {
            await api.request(`/email-campaigns/${id}/resume`, { method: 'POST' });
            Toast.success('Campaign resumed');
            await loadCampaigns();
        } catch (e) { Toast.error('Resume failed: ' + (e.message || e)); }
    };
    window.cancelCampaign = async function (id) {
        const ok = await showConfirm(
            'Cancel this campaign? Remaining queued sends will not be delivered.',
            'Cancel campaign',
            'warning'
        );
        if (!ok) return;
        try {
            await api.request(`/email-campaigns/${id}/cancel`, { method: 'POST' });
            Toast.success('Campaign cancelled');
            await loadCampaigns();
        } catch (e) { Toast.error('Cancel failed: ' + (e.message || e)); }
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
