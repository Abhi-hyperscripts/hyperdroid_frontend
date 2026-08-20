/* ═══ Lead Journey — Status Change, Activity Logging, Disposition ═══ */
(function () {
    'use strict';

    let _statusChangeLeadId = null;
    let _statusChangeSelected = null;
    let _logActivityLeadId = null;

    // ─── Status Change Modal ────────────────────────────────────────────

    async function openStatusChangeModal(leadId) {
        _statusChangeLeadId = leadId;
        _statusChangeSelected = null;
        document.getElementById('statusChangeConfirmBtn').disabled = true;
        document.getElementById('lostReasonSection').style.display = 'none';
        document.getElementById('wonValueSection').style.display = 'none';
        // Reset reason/value inputs — they'd otherwise carry state from a
        // prior open. A rep could pick "Other" + type custom text, cancel,
        // then re-open on a different lead and the stale value would
        // silently slip through (Confirm enables on truthy custom even
        // before the user re-opens the dropdown).
        const lostSelect = document.getElementById('lostReasonSelect');
        const lostCustom = document.getElementById('lostReasonCustom');
        const wonValue  = document.getElementById('wonDealValue');
        if (lostSelect)  lostSelect.value = '';
        if (lostCustom) { lostCustom.value = ''; lostCustom.style.display = 'none'; }
        if (wonValue)    wonValue.value = '';

        try {
            // Fetch the lead + transitions in parallel so the modal can show
            // which lead we're editing (id + name) alongside the status picker.
            const [lead, data] = await Promise.all([
                api.request(`/crm/leads/${leadId}`),
                api.request(`/crm/leads/${leadId}/transitions`)
            ]);
            const currentLabel = formatStatus(data.current_status);
            document.getElementById('statusCurrentLabel').innerHTML =
                `Current: <span class="crm-status-badge status-${data.current_status}">${currentLabel}</span>`;

            const allowed = data.allowed_transitions || [];
            if (allowed.length === 0) {
                document.getElementById('statusOptions').innerHTML =
                    '<p style="color:var(--text-secondary);font-size:0.85rem;">This lead is in a terminal state and cannot be moved further.</p>';
            } else {
                document.getElementById('statusOptions').innerHTML = allowed.map(s =>
                    `<button class="status-option-btn status-${s}" data-status="${s}" onclick="selectStatusOption('${s}')">
                        ${formatStatus(s)}
                    </button>`
                ).join('');
            }

            const fullName = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || '(no name)';
            const leadNumber = lead?.lead_number || '';
            const who = leadNumber ? `${leadNumber} · ${fullName}` : fullName;
            document.getElementById('statusChangeSubtitle').innerHTML =
                `<span style="color:var(--text-primary);font-weight:500;">${who}</span>` +
                `<span style="color:var(--text-muted);margin-left:8px;">${currentLabel} → ?</span>`;
            document.getElementById('statusChangeOverlay').classList.add('active');
        } catch (e) {
            Toast.error(e.message || 'Failed to load transitions');
        }
    }

    function selectStatusOption(status) {
        _statusChangeSelected = status;
        document.querySelectorAll('.status-option-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.status === status);
        });

        // 'lost' is a deal status; on the lead modal only 'unqualified'
        // currently demands a reason. Treat both the same so a future
        // deal-lost reuse of this modal still works.
        const needsReason = status === 'lost' || status === 'unqualified';
        const reasonSection = document.getElementById('lostReasonSection');
        reasonSection.style.display = needsReason ? '' : 'none';
        document.getElementById('wonValueSection').style.display = status === 'won' ? '' : 'none';

        // Status-aware label. "Reason for marking unqualified *" reads more
        // naturally for the false-positive downgrade than "Reason for losing".
        const reasonLabel = reasonSection.querySelector('label');
        if (reasonLabel) {
            reasonLabel.textContent = status === 'unqualified'
                ? 'Reason for marking unqualified *'
                : 'Reason for losing this lead *';
        }

        // Confirm is disabled until the user has done what's required.
        // For reason-needing transitions, that's "picked a reason (and
        // typed the custom one if they chose Other)"; otherwise the
        // status pick itself is enough.
        const confirmBtn = document.getElementById('statusChangeConfirmBtn');
        const updateConfirmGate = () => {
            if (!needsReason) { confirmBtn.disabled = false; return; }
            const sel = document.getElementById('lostReasonSelect').value;
            const custom = document.getElementById('lostReasonCustom').value.trim();
            confirmBtn.disabled = !sel || (sel === 'Other' && !custom);
        };
        confirmBtn.disabled = needsReason;  // start locked when reason needed

        const lostSelect = document.getElementById('lostReasonSelect');
        const lostCustom = document.getElementById('lostReasonCustom');
        lostSelect.onchange = function () {
            lostCustom.style.display = this.value === 'Other' ? '' : 'none';
            updateConfirmGate();
        };
        lostCustom.oninput = updateConfirmGate;
    }

    async function confirmStatusChange() {
        if (!_statusChangeLeadId || !_statusChangeSelected) return;

        const body = { status: _statusChangeSelected };

        // 'unqualified' downgrades + (future) deal-style 'lost' both require
        // a reason. Same UI block, same payload key (`lost_reason`) — the
        // backend stores it on lead_assignment_history.reason for audit.
        if (_statusChangeSelected === 'lost' || _statusChangeSelected === 'unqualified') {
            const sel = document.getElementById('lostReasonSelect').value;
            if (!sel) { Toast.error('Please select a reason'); return; }
            body.lost_reason = sel === 'Other'
                ? document.getElementById('lostReasonCustom').value.trim()
                : sel;
            if (!body.lost_reason) { Toast.error('Please specify the reason'); return; }
        }

        if (_statusChangeSelected === 'won') {
            const val = document.getElementById('wonDealValue').value;
            if (val) body.won_deal_value = parseFloat(val);
        }

        try {
            await api.request(`/crm/leads/${_statusChangeLeadId}/journey-status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const changedLeadId = _statusChangeLeadId;
            const panelWasOpen = window._leadDetailId === changedLeadId;
            Toast.success(`Status changed to ${formatStatus(_statusChangeSelected)}`);
            closeStatusChangeModal();
            loadLeads();
            loadLeadStats();
            if (changedLeadId && panelWasOpen) openLeadDetailPanel(changedLeadId);
        } catch (e) {
            Toast.error(e.message || 'Failed to change status');
        }
    }

    function closeStatusChangeModal() {
        document.getElementById('statusChangeOverlay').classList.remove('active');
        _statusChangeLeadId = null;
        _statusChangeSelected = null;
    }

    // ─── Log Activity Modal ─────────────────────────────────────────────

    async function openLogActivityModal(leadId) {
        _logActivityLeadId = leadId;
        document.getElementById('activityType').value = 'call';
        document.getElementById('activityOutcome').value = '';
        document.getElementById('activitySummary').value = '';
        // Pre-fill the Disposition dropdown with whatever the lead currently
        // shows — so the rep sees the existing value and can choose to keep
        // / override it instead of leaving the field blank (which used to
        // leave a stale value silently sticky on the lead).
        let currentDisp = '';
        try {
            const lead = await api.request(`/crm/leads/${leadId}`);
            currentDisp = lead?.disposition || '';
        } catch (_) { /* best-effort */ }
        const dispSel = document.getElementById('activityDisposition');
        if (dispSel) {
            dispSel.value = currentDisp;
            // Trigger change so SearchableDropdown wrapper picks it up.
            dispSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Stash so the outcome-change handler can decide whether to
        // auto-suggest (only when the current disposition is empty or stale).
        _logActivityInitialDisposition = currentDisp;
        // activityNextFollowup is a Flatpickr-managed input — use the helper
        // so the visible altInput clears too.
        HRMSDatePicker.setDateTimeValue('activityNextFollowup', '');
        document.getElementById('activityCallDuration').value = '';
        // Idempotent: attach the outcome→disposition auto-suggest listener
        // once. Multiple opens of the same modal won't stack handlers because
        // _onActivityOutcomeChanged is a stable function reference.
        const outSel = document.getElementById('activityOutcome');
        if (outSel && !outSel.__autoSuggestWired) {
            outSel.addEventListener('change', _onActivityOutcomeChanged);
            outSel.__autoSuggestWired = true;
        }
        document.getElementById('logActivityOverlay').classList.add('active');
    }

    // Tracks the disposition value the lead had when the modal was opened.
    // The outcome-change handler uses this to know whether the dropdown is
    // showing a fresh empty state (auto-suggest is welcome) or carrying the
    // rep's recently-picked value (don't clobber).
    let _logActivityInitialDisposition = '';

    // When the rep picks an Outcome, suggest a matching Disposition — but only
    // when the field is empty or still shows the stale value the lead had on
    // modal open. The rep can always change/clear the suggestion before
    // submitting; their explicit pick wins both client- and server-side.
    function _onActivityOutcomeChanged() {
        const outSel  = document.getElementById('activityOutcome');
        const dispSel = document.getElementById('activityDisposition');
        if (!outSel || !dispSel) return;
        const outcome = outSel.value;
        const current = dispSel.value;
        // Suggest disposition based on outcome — mirrors the backend
        // DispositionFromOutcome mapping (BusinessLayer_Activities.cs).
        const map = {
            'callback_requested': 'callback_later',
            'meeting_set':        'meeting_scheduled',
            'wrong_number':       'wrong_number',
            'not_reachable':      'not_responding',
            'busy':               'not_responding',
            'voicemail':          'not_responding'
        };
        const suggested = map[outcome];
        if (!suggested) return;
        // Don't overwrite a higher-commitment disposition the rep already
        // explicitly chose during THIS session.
        const stronger = ['hot_lead','proposal_sent','deal_in_progress','meeting_scheduled'];
        if (current && stronger.includes(current) && current !== _logActivityInitialDisposition) return;
        // Only fill in when the field is blank OR still holds the initial
        // stale value (rep hasn't touched it yet).
        if (!current || current === _logActivityInitialDisposition) {
            dispSel.value = suggested;
            dispSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function closeLogActivityModal() {
        document.getElementById('logActivityOverlay').classList.remove('active');
        _logActivityLeadId = null;
    }

    async function submitLogActivity() {
        if (!_logActivityLeadId) return;

        const summary = document.getElementById('activitySummary').value.trim();
        if (!summary) { Toast.error('Summary is required'); return; }

        // Reject "time picked but date empty" (or vice versa) — backend would
        // silently drop a half-set follow-up, leaving the user thinking they
        // scheduled one when they didn't.
        const followupErr = HRMSDatePicker.validateDateTimePair('activityNextFollowup', 'Next follow-up');
        if (followupErr) { Toast.error(followupErr); return; }

        const actType = document.getElementById('activityType').value;
        const outcome = document.getElementById('activityOutcome').value;
        const disposition = document.getElementById('activityDisposition').value;

        // Disposition is required for call/meeting activities (parity with
        // mobile v1.0.48 + backend ArgumentException). Outcome stays
        // optional — backend auto-derives it from disposition. Toast
        // tells the rep exactly what's missing instead of letting the
        // POST fall through to a 400 modal.
        if ((actType === 'call' || actType === 'meeting') && !disposition) {
            Toast.error(`Pick a Disposition to log this ${actType}`);
            return;
        }
        // Flatpickr stores values as "YYYY-MM-DD HH:mm"; helper returns the
        // datetime-local-shaped "YYYY-MM-DDTHH:mm" string the backend expects.
        const nextFollowup = HRMSDatePicker.getDateTimeValue('activityNextFollowup');
        const callDuration = document.getElementById('activityCallDuration').value;

        try {
            // 1. Log the activity. Disposition rides INSIDE the activity body
            // now — backend gates call/meeting on its presence and applies
            // it to the lead in the same transaction. Previously this code
            // did a separate PUT /disposition AFTER the activity, which (a)
            // started failing once the backend required disposition on the
            // activity itself, and (b) silently lost the disposition update
            // when activity creation 400-ed. Single request, single source
            // of truth — same wiring as the mobile app.
            await api.request('/crm/activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    activity_type: actType,
                    subject: `${actType.charAt(0).toUpperCase() + actType.slice(1)} - ${outcome || 'logged'}`,
                    description: summary,
                    entity_type: 'lead',
                    entity_id: _logActivityLeadId,
                    performed_at: new Date().toISOString(),
                    is_completed: true,
                    contact_outcome: outcome || undefined,
                    disposition: disposition || undefined,
                    call_duration_seconds: callDuration ? parseInt(callDuration) * 60 : undefined,
                    next_action: nextFollowup ? 'Follow up' : undefined,
                    next_action_date: nextFollowup ? new Date(nextFollowup).toISOString() : undefined
                })
            });

            // 3. If next follow-up date set, update the lead's follow-up date (no separate follow-up record)
            // The activity already stores next_action + next_action_date, shown in timeline via chips.

            const loggedLeadId = _logActivityLeadId;
            const panelWasOpen = window._leadDetailId === loggedLeadId;
            Toast.success('Activity logged');
            closeLogActivityModal();
            loadLeads();
            if (loggedLeadId && panelWasOpen) openLeadDetailPanel(loggedLeadId);
        } catch (e) {
            Toast.error(e.message || 'Failed to log activity');
        }
    }

    // ─── Lead Detail Panel + Timeline ──────────────────────────────────

    async function openLeadDetailPanel(leadId) {
        window._leadDetailId = leadId;
        // Remember which lead the rep is on so a reload (SW update mid-call,
        // crash, browser-back from a tel: handoff) lands them back on this
        // same lead instead of a fresh list. The leads.html init reads this
        // sessionStorage key after loadLeads() and re-opens the panel.
        try { sessionStorage.setItem('crm_openLeadId', encodeURIComponent(leadId)); } catch (_) {}

        // KYC / supporting documents. canReview is presentation only — the API
        // refuses a plain member's verify or reject regardless, because a
        // control the server does not enforce is not a control.
        if (typeof DocumentsPanel !== 'undefined') {
            DocumentsPanel.mount(
                document.getElementById('leadDocumentsPanel'), 'lead', leadId,
                { canReview: ['admin', 'manager', 'teamlead'].includes(window.myTeamRole) });
        }

        // Notes on a lead had no UI at all — the API listed, edited, pinned and
        // deleted them and nothing called it.
        if (typeof NotesPanel !== 'undefined') {
            NotesPanel.mount(document.getElementById('leadNotesPanel'), 'lead', leadId);
        }
        // Activities could be logged and read but never corrected, completed or
        // removed — the timeline projection carries no activity id to act on.
        if (typeof ActivitiesPanel !== 'undefined') {
            ActivitiesPanel.mount(document.getElementById('leadActivitiesPanel'), 'lead', leadId);
        }

        // Follow-ups, email engagement and ownership history were all recorded
        // and none of them had anywhere to show.
        if (typeof LeadHistoryPanel !== 'undefined') {
            LeadHistoryPanel.mount(document.getElementById('leadHistoryPanel'), leadId);
        }

        // Open panel
        document.getElementById('leadDetailOverlay').classList.add('active');
        document.getElementById('leadDetailPanel').classList.add('active');
        document.getElementById('leadTimeline').innerHTML = '<div class="import-loading">Loading timeline...</div>';
        document.getElementById('leadDetailInfo').innerHTML = '';
        document.getElementById('leadDetailName').textContent = 'Lead Details';

        try {
            // Load lead details
            const lead = await api.request(`/crm/leads/${leadId}`);
            const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';
            document.getElementById('leadDetailName').textContent = name;

            // Parse custom fields. Resolve codes against the tenant's
            // schema (active or archived — `getLeadFieldDef` uses the
            // _allFieldsByCode map populated by lead-fields-runtime.js so
            // historical values still render with their human label even
            // after the field is soft-deleted from Settings).
            let customFieldsHtml = '';
            try {
                const cf = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields || '{}') : (lead.custom_fields || {});
                const resolveDef = typeof window.getLeadFieldDef === 'function' ? window.getLeadFieldDef : null;
                for (const [k, v] of Object.entries(cf)) {
                    if (!v) continue;
                    const def = resolveDef ? resolveDef(k) : null;
                    const fieldLabel = def ? def.label : k.replace(/_/g, ' ');
                    const renderValue = (val) => {
                        if (!def) return esc(String(val));
                        const opt = (def.options || []).find(o => o.code === val);
                        if (!opt) return esc(String(val));
                        const sw = opt.color
                            ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(opt.color)};margin-right:6px;vertical-align:middle;"></span>`
                            : '';
                        return `${sw}${esc(opt.label)}`;
                    };
                    const valueHtml = Array.isArray(v) ? v.map(renderValue).join(', ') : renderValue(v);
                    customFieldsHtml += `<div class="lead-detail-item"><span class="lead-detail-label">${esc(fieldLabel)}</span><span>${valueHtml}</span></div>`;
                }
            } catch {}

            // Hero: identity + live badges + one-tap contact. Everything else
            // groups into labelled sections below (empty sections vanish).
            const avBg = (typeof leadAvatarBg === 'function')
                ? leadAvatarBg(lead) : 'linear-gradient(135deg,#2563eb,#7c3aed)';
            const avTxt = (typeof leadInitials === 'function') ? leadInitials(lead) : '?';
            const emailBtn = window._tenantHasMailbox && lead.email
                ? `<button type="button" onclick="openComposeForLead(window._leadDetailId)" class="lead-email-send-btn" data-tooltip="Send email" aria-label="Send email"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></button>`
                : '';
            const item = (label, valueHtml, extraCls = '') => valueHtml
                ? `<div class="lead-detail-item ${extraCls}"><span class="lead-detail-label">${label}</span><span>${valueHtml}</span></div>`
                : '';
            const dateOnly = (v) => v ? new Date(v).toLocaleDateString() : '';
            const section = (title, rows) => rows.join('')
                ? `<div class="ld-sect">${title}</div><div class="lead-detail-grid">${rows.join('')}</div>`
                : '';

            // Convert-to-deal action: hide it once the lead is already converted
            // (there's nothing left to convert). Shown for every other status.
            const _convBtn = document.getElementById('leadDetailConvertBtn');
            if (_convBtn) _convBtn.style.display = (lead.status === 'converted') ? 'none' : '';

            document.getElementById('leadDetailInfo').innerHTML = `
                <div class="ld-hero">
                    <span class="lead-avatar ld-avatar" style="background:${avBg}">${esc(avTxt)}</span>
                    <div class="ld-hero-main">
                        <div class="ld-hero-badges">
                            <span class="crm-status-badge status-${lead.status}">${formatStatus(lead.status)}</span>
                            ${lead.disposition ? `<span class="crm-disposition-badge disp-${lead.disposition}">${formatDisposition(lead.disposition)}</span>` : ''}
                            ${lead.team_name ? `<span class="crm-team-badge">${esc(lead.team_name)}</span>` : ''}
                            ${lead.lead_number ? `<span class="crm-lead-number">${esc(lead.lead_number)}</span>` : ''}
                        </div>
                        <div class="ld-hero-contact">
                            ${lead.phone ? `<span class="ld-contact-chip">${crmPhoneLink(lead.phone)}</span>` : ''}
                            ${lead.email ? `<span class="ld-contact-chip">${esc(lead.email)}${emailBtn}</span>` : ''}
                            ${[lead.city, lead.state].filter(Boolean).length ? `<span class="ld-contact-chip ld-muted">${esc([lead.city, lead.state].filter(Boolean).join(', '))}</span>` : ''}
                            ${lead.owner_name ? `<span class="ld-contact-chip ld-muted">Owner · ${esc(lead.owner_name)}</span>` : ''}
                        </div>
                    </div>
                </div>
                ${section('About', [
                    item('Company', lead.company_name ? esc(lead.company_name) : ''),
                    item('Job title', lead.job_title ? esc(lead.job_title) : ''),
                    item('Source', lead.lead_source ? esc(lead.lead_source) : ''),
                    item('Campaign', lead.campaign_name ? esc(lead.campaign_name) : ''),
                    item('Alt. phone', lead.alternate_phone ? crmPhoneLink(lead.alternate_phone) : ''),
                    item('Website', lead.website ? esc(lead.website) : ''),
                    item('Address', lead.address ? esc(lead.address) : ''),
                    item('Country', lead.country ? esc(lead.country) : ''),
                    item('Pincode', lead.pincode ? esc(lead.pincode) : ''),
                ])}
                ${section('Deal', [
                    item('Interest', lead.product_interest ? esc(lead.product_interest) : ''),
                    item('Est. value', lead.estimated_value ? '₹' + Number(lead.estimated_value).toLocaleString() : ''),
                    item('Deal value', lead.won_deal_value ? '₹' + Number(lead.won_deal_value).toLocaleString() : ''),
                    item('Expected close', dateOnly(lead.expected_closure_date)),
                    item('Lost reason', lead.lost_reason ? `<span style="color:var(--color-error);">${esc(lead.lost_reason)}</span>` : ''),
                ])}
                ${customFieldsHtml ? `<div class="ld-sect">Custom fields</div><div class="lead-detail-grid">${customFieldsHtml}</div>` : ''}
                ${section('Activity', [
                    item('Next follow-up', dateOnly(lead.next_followup_date)),
                    item('Follow-ups', lead.followup_count > 0 ? String(lead.followup_count) : ''),
                    item('First contact', dateOnly(lead.first_contact_date)),
                    item('Last interaction', dateOnly(lead.last_interaction_at)),
                    item('Created', lead.created_at ? new Date(lead.created_at).toLocaleString() : ''),
                ])}
                ${lead.notes ? `<div class="ld-sect">Notes</div><div class="lead-detail-grid"><div class="lead-detail-item" style="grid-column:1/-1"><span>${esc(lead.notes)}</span></div></div>` : ''}
            `;

            // Load timeline
            const timeline = await api.request(`/crm/leads/${leadId}/timeline`);
            renderTimeline(timeline);

            // Calls live in a separate table and aren't part of /timeline.
            // calls.js prepends rows under [data-call-row] so re-renders of
            // the journey timeline don't trample them.
            if (typeof window.renderCallTimelineEntries === 'function') {
                window.renderCallTimelineEntries(leadId);
            }

            // Refresh the Need-Help / Cancel-Help button state. The requester
            // gets a single button that flips between "Need Help" (no open
            // request) and "Cancel pending help" (open request raised by them).
            // Fire-and-forget — failure here just leaves the default Need-Help
            // button visible, which is correct for the no-existing-request case.
            refreshHelpButtonForLead(leadId);

            // Render "In sequence: …" badge if the lead is mid-cadence.
            // Fire-and-forget — silently no-ops on 404 or error so the panel
            // still works for tenants that never use sequences.
            refreshSequenceBadgeForLead(leadId);

            // Cache the lead's email + display name on a hidden node so
            // openComposeForLead() can read it without re-fetching. The
            // small mail-icon button next to the email field uses these.
            window._leadDetailEmail = lead.email || '';
            window._leadDetailName  = name || '';
        } catch (e) {
            // 404 = lead is gone (typically wiped by an admin between when
            // the user last opened it and now). The sessionStorage anchor
            // re-triggered a fetch on page reload; we don't want to keep
            // re-failing every time the page is opened.
            // Surface a friendly toast, close the broken panel, and clear
            // the anchor so the next reload lands the user on the list.
            const msg = e?.message || '';
            const isMissing = /not found|404/i.test(msg);
            if (isMissing) {
                try { sessionStorage.removeItem('crm_openLeadId'); } catch (_) {}
                closeLeadDetailPanel();
                if (typeof Toast !== 'undefined') {
                    Toast.info('That lead no longer exists. It may have been deleted or wiped.');
                }
                return;
            }
            // Other errors (network blip, server 500): leave the panel up
            // so the user can retry by re-clicking the row, and show the
            // raw error in the timeline area.
            document.getElementById('leadTimeline').innerHTML = `<p style="color:var(--color-error);">${esc(msg || 'Failed to load')}</p>`;
        }
    }

    // Looks up whether the current user has an open help request on this lead
    // (as the requester) and swaps the panel's Need-Help button accordingly.
    // Stores the request id on the button so the cancel handler can find it
    // without a second round-trip.
    async function refreshHelpButtonForLead(leadId) {
        const btn = document.getElementById('leadDetailNeedHelpBtn');
        if (!btn) return;
        // Only members and team-leads have anyone to escalate TO. Admins/
        // SUPERADMINs and managers sit at (or above) the top of the team
        // and the affordance would be dead UX for them — hide the button.
        // myTeamRole is set by leads.js loadMyRole() and re-exported on
        // window so this module can read it without a circular dep.
        const role = window.myTeamRole || 'member';
        if (role === 'admin' || role === 'manager') {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = '';
        try {
            const me = (typeof api?.getUser === 'function' && api.getUser()?.userId) || null;
            const list = await api.request(`/crm/leads/${leadId}/help-requests`);
            const myOpen = (list || []).find(r => r.status === 'open' && me && r.requester_user_id === me);
            if (myOpen) {
                btn.textContent = 'Cancel Help';
                btn.classList.remove('btn-outline-warning');
                btn.classList.add('btn-outline-danger');
                btn.setAttribute('data-help-id', myOpen.id);
                btn.setAttribute('onclick', `cancelMyHelpRequest('${myOpen.id}')`);
                btn.title = `Pending with ${myOpen.recipient_name || 'recipient'} — click to cancel.`;
            } else {
                btn.textContent = 'Need Help';
                btn.classList.remove('btn-outline-danger');
                btn.classList.add('btn-outline-warning');
                btn.removeAttribute('data-help-id');
                btn.setAttribute('onclick', `openHelpRequestModal(window._leadDetailId)`);
                btn.title = '';
            }
        } catch {
            // Non-critical — leave the default Need-Help button.
        }
    }

    async function cancelMyHelpRequest(helpId) {
        if (!helpId) return;
        // Themed confirmation modal — guards against accidental clicks on
        // what is otherwise a single-press destructive action.
        const ok = await Confirm.show({
            title: 'Cancel help request?',
            message: 'The recipient will be notified that you no longer need help on this lead. The request will move to "cancelled" on the lead\'s timeline.',
            type: 'danger',
            confirmText: 'Yes, cancel it',
            cancelText: 'Keep request'
        });
        if (!ok) return;
        try {
            await api.request(`/crm/leads/help-requests/${helpId}/cancel`, { method: 'POST' });
            Toast.success('Help request cancelled');
            const lid = window._leadDetailId;
            if (lid) openLeadDetailPanel(lid);   // refreshes timeline + button
            if (typeof window.refreshHelpInboxBanner === 'function') window.refreshHelpInboxBanner();
        } catch (e) {
            Toast.error(e?.message || 'Failed to cancel');
        }
    }

    function closeLeadDetailPanel() {
        document.getElementById('leadDetailOverlay').classList.remove('active');
        document.getElementById('leadDetailPanel').classList.remove('active');
        window._leadDetailId = null;
        // Explicit close = the rep is done with this lead. Clear the
        // sessionStorage anchor so a subsequent reload lands on the list,
        // not back on the lead they just dismissed.
        try { sessionStorage.removeItem('crm_openLeadId'); } catch (_) {}
    }

    // ─── Sequence enrollment badge + modal ──────────────────────────────────

    // Polls the active enrollment for this lead and renders an "In sequence"
    // badge with an Unenroll button. No-ops silently when no enrollment exists
    // OR when the sequences endpoint isn't available (e.g. tenant never used it).
    async function refreshSequenceBadgeForLead(leadId) {
        const slot = document.getElementById('leadSeqBadgeSlot');
        if (!slot) return;
        slot.innerHTML = '';
        try {
            const enrollment = await api.request(`/sequences/by-lead/${leadId}/active`);
            if (!enrollment || !enrollment.id) return;     // no active enrollment
            const stepLabel = `Step ${enrollment.current_step_order} of ${enrollment.total_steps}`;
            const nextStr = enrollment.next_fire_at
                ? `, next ${formatTimeAgo(new Date(enrollment.next_fire_at))}`
                : '';
            slot.innerHTML = `
                <div class="lead-seq-badge">
                    <span class="lead-seq-badge-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>
                        </svg>
                    </span>
                    <div class="lead-seq-badge-body">
                        <strong>${esc(enrollment.sequence_name || 'Sequence')}</strong>
                        <span>${stepLabel}${esc(nextStr)}</span>
                    </div>
                    <div class="lead-seq-badge-actions">
                        <button class="btn btn-sm btn-outline-danger" onclick="unenrollFromSequence('${enrollment.id}')">Unenroll</button>
                    </div>
                </div>
            `;
        } catch (e) {
            // Endpoint not available / 404 / tenant unlicensed for sequences —
            // silently leave the slot empty so existing flows aren't disturbed.
        }
    }

    window.unenrollFromSequence = async function (enrollmentId) {
        if (!enrollmentId) return;
        const ok = await Confirm.show({
            title: 'Unenroll lead from sequence?',
            message: 'Future steps will stop firing. Activity already logged on this lead stays.',
            type: 'danger',
            confirmText: 'Yes, unenroll',
            cancelText: 'Keep enrolled',
        });
        if (!ok) return;
        const lid = window._leadDetailId;
        try {
            await api.request(`/sequences/enrollments/${enrollmentId}/unenroll`, {
                method: 'POST',
                body: JSON.stringify({ reason: 'Unenrolled from lead detail panel' }),
            });
            Toast.success('Unenrolled');
        } catch (e) {
            // 404 here usually means the enrollment auto-completed (e.g. a
            // trivial 1-step sequence with delay=0) between the badge load
            // and the click. Refresh the badge in finally so the now-empty
            // state replaces the stale chip — user sees the truth.
            if (e?.message?.includes('Not Found') || e?.status === 404) {
                Toast.info('This enrollment already ended — refreshed.');
            } else {
                Toast.error(e?.message || 'Failed to unenroll');
            }
        } finally {
            if (lid) refreshSequenceBadgeForLead(lid);
        }
    };

    // Modal: picks a sequence and enrolls the current lead.
    window.openSequenceEnrollModal = async function (leadId) {
        if (!leadId) return;
        let sequences = [];
        try {
            sequences = await api.request('/sequences?active_only=true');
        } catch (e) {
            Toast.error(e?.message || 'Could not load sequences');
            return;
        }
        if (!Array.isArray(sequences) || sequences.length === 0) {
            Toast.error('No active sequences yet. Create one on the Sequences page first.');
            return;
        }

        // Build a themed modal using the gm-overlay/gm-modal pattern so
        // it visually matches the rest of the app (same backdrop, blur,
        // brand-accent border-glow, scale transform).
        const overlay = document.createElement('div');
        overlay.className = 'gm-overlay active';
        overlay.id = 'enrollSeqOverlay';
        overlay.innerHTML = `
            <div class="gm-modal" style="width:min(440px,90vw);">
                <div class="gm-header">
                    <div class="gm-header-left">
                        <h2>Enroll in sequence</h2>
                    </div>
                    <button class="gm-close" onclick="closeEnrollSeqModal()" aria-label="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div class="gm-body">
                    <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:12px;">
                        Pick a sequence. The first step fires according to its delay setting.
                    </p>
                    <div id="enrollSeqList" class="seq-list"></div>
                </div>
                <div class="gm-footer">
                    <button class="btn btn-outline" onclick="closeEnrollSeqModal()">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const list = overlay.querySelector('#enrollSeqList');
        list.innerHTML = sequences.map(s => `
            <div class="seq-row" style="cursor:pointer;" data-seq-id="${esc(s.id)}">
                <div class="seq-row-main">
                    <div class="seq-row-title">
                        <h3>${esc(s.name)}</h3>
                    </div>
                    ${s.description ? `<p class="seq-row-desc">${esc(s.description)}</p>` : ''}
                </div>
                <button class="btn btn-sm btn-primary">Enroll</button>
            </div>
        `).join('');
        list.querySelectorAll('.seq-row').forEach(row => {
            row.addEventListener('click', async () => {
                const sid = row.getAttribute('data-seq-id');
                try {
                    await api.request('/sequences/enroll', {
                        method: 'POST',
                        body: JSON.stringify({ lead_id: leadId, sequence_id: sid }),
                    });
                    Toast.success('Lead enrolled');
                    closeEnrollSeqModal();
                    refreshSequenceBadgeForLead(leadId);
                } catch (e) {
                    Toast.error(e?.message || 'Enroll failed');
                }
            });
        });
    };

    window.closeEnrollSeqModal = function () {
        const o = document.getElementById('enrollSeqOverlay');
        if (o) o.remove();
    };

    function renderTimeline(entries) {
        const container = document.getElementById('leadTimeline');
        if (!entries || entries.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">No activity yet</p>';
            return;
        }

        container.innerHTML = entries.map(e => {
            const icon = getTimelineIcon(e.icon || e.type);
            const time = formatTimeAgo(new Date(e.timestamp));
            // For email replies the description is the actual recipient's
            // message — preserve line breaks so "Thanks,\nAbhi" doesn't
            // collapse into a single run-on sentence. Everything else stays
            // compact (one-line activity titles, status changes, etc.).
            const preserveBreaks = e.type === 'email_replied' || e.type === 'note';
            const desc = e.description
                ? `<div class="tl-desc${preserveBreaks ? ' tl-desc-pre' : ''}">${esc(e.description)}</div>`
                : '';
            const outcome = e.outcome ? `<span class="tl-outcome">${esc(e.outcome)}</span>` : '';
            const typeClass = `tl-${e.type}`;
            const whoName = e.performed_by_name || '';
            const whoEmail = e.performed_by_email || '';
            const whoLine = whoName
                ? (whoEmail ? `<span class="tl-who">${esc(whoName)}</span> <span class="tl-who-email">(${esc(whoEmail)})</span>` : `<span class="tl-who">${esc(whoName)}</span>`)
                : '';

            // Build structured detail chips for activities
            let detailChips = '';
            let callExtras = '';
            if (e.type === 'activity' && e.meta) {
                const chips = [];
                const aType = e.meta.activity_type;
                if (aType) chips.push(`<span class="tl-chip tl-chip-type">${esc(aType)}</span>`);
                const outcome = e.meta.contact_outcome || e.outcome;
                if (outcome) chips.push(`<span class="tl-chip tl-chip-outcome">${esc(outcome.replace(/_/g, ' '))}</span>`);
                const dur = e.meta.duration_minutes;
                if (dur && dur > 0) chips.push(`<span class="tl-chip">${dur} min</span>`);
                const callSec = e.meta.call_duration_seconds;
                if (callSec && callSec > 0) {
                    const m = Math.floor(callSec / 60);
                    const s = callSec % 60;
                    chips.push(`<span class="tl-chip">Call: ${m}m ${s}s</span>`);
                }
                const nextAction = e.meta.next_action;
                const nextDate = e.meta.next_action_date;
                if (nextAction || nextDate) {
                    const dateStr = nextDate ? new Date(nextDate).toLocaleDateString() : '';
                    chips.push(`<span class="tl-chip tl-chip-pending">Next: ${esc(nextAction || 'Follow up')}${dateStr ? ' · ' + dateStr : ''}</span>`);
                }
                if (chips.length) detailChips = `<div class="tl-chips">${chips.join('')}</div>`;

                // Call activity extras: audio player + transcript + summary.
                // The backend (BL_LeadJourney) joins the activity to its
                // matching lead_call_events row via the [companion:<sid>]
                // marker; the controller post-stamps a signed playback URL.
                if (aType === 'call') {
                    callExtras = renderCallExtras(e.meta);
                }
            }
            if (e.type === 'followup' && e.meta) {
                const chips = [];
                const fType = e.meta.followup_type;
                if (fType) chips.push(`<span class="tl-chip tl-chip-type">${esc(fType)}</span>`);
                const fStatus = e.meta.followup_status;
                if (fStatus) chips.push(`<span class="tl-chip tl-chip-${fStatus}">${esc(fStatus)}</span>`);
                const schedAt = e.meta.scheduled_at;
                if (schedAt) chips.push(`<span class="tl-chip">Scheduled: ${new Date(schedAt).toLocaleDateString()}</span>`);
                if (chips.length) detailChips = `<div class="tl-chips">${chips.join('')}</div>`;
            }
            if (e.type === 'transfer' && e.meta) {
                const chips = [];
                const tStatus = e.meta.transfer_status;
                if (tStatus === 'pending') chips.push(`<span class="tl-chip tl-chip-pending">PENDING</span>`);
                else if (tStatus === 'approved') chips.push(`<span class="tl-chip tl-chip-completed">APPROVED</span>`);
                else if (tStatus === 'rejected') chips.push(`<span class="tl-chip tl-chip-missed">REJECTED</span>`);
                const from = e.meta.from_team;
                const to = e.meta.to_team;
                if (from && to) chips.push(`<span class="tl-chip">${esc(from)} → ${esc(to)}</span>`);
                if (chips.length) detailChips = `<div class="tl-chips">${chips.join('')}</div>`;
            }
            if (e.type && e.type.startsWith('email_') && e.meta) {
                const chips = [];
                // Subject is the key signal on email rows — it's already the
                // description, but pinning the recipient on every row makes
                // cross-reading the timeline easier.
                if (e.meta.to_email) {
                    chips.push(`<span class="tl-chip">${esc(e.meta.to_email)}</span>`);
                }
                if (e.meta.campaign_id) {
                    chips.push(`<span class="tl-chip tl-chip-type">campaign</span>`);
                }
                if (e.type === 'email_clicked' && e.meta.click_url) {
                    // Don't escape as an href in case the URL is garbage —
                    // just show it as text. The description already has it
                    // rendered, so this is redundant for now; kept for future
                    // multi-url display.
                }
                if (e.type === 'email_replied' && e.meta.from_address) {
                    chips.push(`<span class="tl-chip">from ${esc(e.meta.from_address)}</span>`);
                }
                if (chips.length) detailChips = `<div class="tl-chips">${chips.join('')}</div>`;
            }

            // Reply CTA — only on replied events that carry the routing info
            // we need to send back via the same mailbox with proper threading.
            let replyBtn = '';
            if (e.type === 'email_replied' && e.meta && e.meta.mailbox_id && e.meta.from_address) {
                const meta = e.meta;
                const payload = {
                    mailboxId: meta.mailbox_id,
                    toEmail: meta.from_address,
                    subject: meta.subject || '',
                    inReplyTo: meta.reply_message_id || '',
                    replySnippet: e.description || '',
                };
                // The payload's snippet often contains apostrophes (e.g.
                // "we've", "don't"). esc() doesn't escape ' — and the
                // attribute uses single-quote delimiters — so the first
                // apostrophe in the body would terminate the attribute and
                // truncate the JSON. Base64-encode to side-step every HTML
                // attribute escaping concern; decode in openReplyModalFromBtn.
                const payloadAttr = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
                replyBtn = `<div class="tl-actions"><button class="btn btn-sm btn-outline-primary tl-reply-btn" data-reply="${payloadAttr}" onclick="openReplyModalFromBtn(this)">Reply</button></div>`;
            }

            // Mark-complete CTA on PENDING follow-ups inside the lead timeline.
            // Mirrors the dashboard Mark Done button so users can clear an
            // overdue follow-up from whichever surface they're already on.
            let followupCompleteBtn = '';
            if (e.type === 'followup' && e.meta && e.meta.followup_status === 'pending' && e.meta.followup_id) {
                followupCompleteBtn = `<div class="tl-actions"><button class="btn btn-sm btn-outline-primary tl-followup-complete-btn" data-followup-id="${esc(e.meta.followup_id)}" onclick="completeFollowupFromTimeline(this)">Mark complete</button></div>`;
            }

            // WhatsApp timeline rows open the chat thread in a modal on
            // click (icon OR title). The whole row is clickable so users
            // don't have to aim at the 14×14 icon. Phone digits come from
            // the entry's meta (set by the backend in
            // AddWhatsAppMessagesToTimelineAsync); business_phone too so
            // the iframe doesn't need to enumerate the tenant's numbers
            // (a SUPERADMIN-only endpoint).
            const isWa = e.type === 'whatsapp';
            const waPhone = isWa && e.meta ? (e.meta.customer_phone || '') : '';
            const waBiz = isWa && e.meta ? (e.meta.business_phone || '') : '';
            const waOpenAttrs = isWa && waPhone
                ? ` style="cursor:pointer" onclick="openWhatsAppThreadModal('${escJsAttr(waPhone)}', '${escJsAttr(waBiz)}')" title="Open this conversation"`
                : '';

            // Stamp the entry's UTC ISO timestamp on the DOM so the call
            // renderer (calls.js) can find the right slot when interleaving
            // call rows from a separate endpoint. Without this, calls.js
            // ends up prepending blindly and a yesterday's call lands above
            // a 1-minute-old status change.
            const tsAttr = e.timestamp ? ` data-ts="${esc(e.timestamp)}"` : '';

            return `
                <div class="tl-entry ${typeClass}"${tsAttr}${waOpenAttrs}>
                    <div class="tl-icon">${icon}</div>
                    <div class="tl-content">
                        <div class="tl-header">
                            <span class="tl-title">${esc(e.title)}</span>
                        </div>
                        ${detailChips}
                        ${desc}
                        ${callExtras}
                        ${replyBtn}
                        ${followupCompleteBtn}
                        <div class="tl-meta">${whoLine ? `${whoLine} · ` : ''}${time}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Render audio player + transcript <details> + AI summary panel for
    // a call activity. All blocks are guarded — we render whatever's
    // available and a tiny status badge for pending/failed states so
    // the user can tell "alive but empty" from "broken".
    function renderCallExtras(meta) {
        const parts = [];

        // Audio player. Backend stamps a signed URL that proxies to
        // either the provider CDN (Exotel) or Drive S3 (companion).
        const playback = meta.recording_playback_url;
        if (playback) {
            parts.push(`
                <div class="tl-audio">
                    <audio controls preload="none" src="${esc(playback)}" style="width:100%;"></audio>
                </div>
            `);
        }

        // Transcript. Show content if landed; otherwise a status hint
        // (transcribing / failed). 'skipped' is silent — it's the
        // tenant's choice (AI disabled, short call, no key) and not
        // worth a UI message. Failed states get a Retry button that
        // re-submits via the new durable pipeline.
        const tStatus = meta.transcript_status;
        const tText = meta.transcript_text;
        const tLang = meta.transcript_language;
        const callEventId = meta.call_event_id;
        if (tText) {
            const langChip = tLang ? ` <span class="tl-lang-chip">${esc(tLang)}</span>` : '';
            // Build a diarized bubble view from whatever source is best:
            //   1. meta.segments_json  — structured, with role + timestamps (Phase 1.5)
            //   2. meta.transcript_text  — Speaker-N tokens, regex-parsed (today)
            // The renderer guards against malformed JSON and falls back
            // to the old <pre> blob if we can't extract anything useful.
            const bubbles = renderTranscriptBubbles(meta);
            const body = bubbles || `<pre class="tl-transcript-text">${esc(tText)}</pre>`;
            parts.push(`
                <details class="tl-transcript" open>
                    <summary>Transcript${langChip}</summary>
                    ${body}
                </details>
            `);
        } else if (tStatus === 'pending' || tStatus === 'transcribing' || tStatus === 'submitted') {
            parts.push(`<div class="tl-pending">Transcribing…</div>`);
        } else if (tStatus === 'failed' && callEventId) {
            parts.push(`
                <div class="tl-error-row">
                    <div class="tl-error">Transcription failed</div>
                    <button class="btn btn-sm btn-outline-primary tl-retry-btn"
                            data-call-event-id="${esc(callEventId)}"
                            onclick="retryTranscriptionFromBtn(this)">Retry transcription</button>
                </div>
            `);
        } else if (tStatus === 'failed') {
            parts.push(`<div class="tl-error">Transcription failed</div>`);
        }

        // AI summary (Haiku tool_use output).
        const sStatus = meta.summary_status;
        const sJson = meta.summary_json;
        if (sJson) {
            let s = null;
            try { s = typeof sJson === 'string' ? JSON.parse(sJson) : sJson; } catch (_) {}
            if (s) parts.push(renderCallSummary(s));
        } else if (sStatus === 'pending' || sStatus === 'summarizing') {
            parts.push(`<div class="tl-pending">Summarizing…</div>`);
        } else if (sStatus === 'failed' && callEventId) {
            // Summary-only failure: retry triggers the transcription
            // pipeline (which re-fires summary). Same endpoint.
            parts.push(`
                <div class="tl-error-row">
                    <div class="tl-error">Summary failed</div>
                    <button class="btn btn-sm btn-outline-primary tl-retry-btn"
                            data-call-event-id="${esc(callEventId)}"
                            onclick="retryTranscriptionFromBtn(this)">Retry</button>
                </div>
            `);
        } else if (sStatus === 'failed') {
            parts.push(`<div class="tl-error">Summary failed</div>`);
        }

        // Quality score panel — rendered after the summary so the
        // user reads "what was said" first, then "how it scored".
        // Driven off meta.score_json (Phase 1 of the call-quality
        // pipeline). Null when scoring hasn't fired yet or was
        // skipped (no google/llm key).
        const scoreJson = meta.score_json;
        if (scoreJson) {
            try {
                const s = typeof scoreJson === 'string' ? JSON.parse(scoreJson) : scoreJson;
                if (s) parts.push(renderCallScorecard(s, meta.total_score, meta.letter_grade));
            } catch (_) { /* malformed JSON — skip the panel rather than break the timeline */ }
        }

        if (!parts.length) return '';
        return `<div class="tl-call-extras">${parts.join('')}</div>`;
    }

    // ─── Sales-rep quality scorecard ──────────────────────────────────
    //
    // Renders the structured output from CallScoringJob (AIEngine
    // ScoreCallQuality):
    //   - Letter grade + total score badge
    //   - One-line verdict
    //   - 4 dimension bars (Discovery / Value / Objections / Closing)
    //     with weights and inline evidence chips
    //   - Playbook violations chip row
    //   - Top 3 coaching suggestions
    function renderCallScorecard(s, totalFromColumn, letterFromColumn) {
        ensureBubbleStylesheet(); // shared CSS file holds both styles
        const total = (typeof totalFromColumn === 'number' && totalFromColumn >= 0)
            ? totalFromColumn
            : (s.total_weighted_score ?? 0);
        const grade = letterFromColumn || s.letter_grade || '?';
        const verdict = s.one_line_verdict || '';

        const dimWeights = { discovery: 30, value_prop: 25, objection_handling: 25, closing: 20 };
        const dimLabels = {
            discovery: 'Discovery',
            value_prop: 'Value prop',
            objection_handling: 'Objections',
            closing: 'Closing'
        };
        const dimRows = Object.entries(s.dimension_scores || {}).map(([k, v]) => {
            const raw = v.raw_score ?? 0;
            const weight = dimWeights[k] ?? 0;
            const weighted = Math.round(raw * weight / 10);
            const evList = Array.isArray(v.evidence)
                ? v.evidence.slice(0, 2).map(e => `<li>${esc(e)}</li>`).join('')
                : '';
            return `
                <div class="tl-score-row">
                    <div class="tl-score-row-head">
                        <span class="tl-score-name">${esc(dimLabels[k] || k)}</span>
                        <span class="tl-score-weight">×${weight}%</span>
                        <span class="tl-score-bar">
                            <span class="tl-score-bar-fill" style="width:${raw * 10}%"></span>
                        </span>
                        <span class="tl-score-num">${raw}/10 → ${weighted}</span>
                    </div>
                    ${evList ? `<ul class="tl-score-evidence">${evList}</ul>` : ''}
                </div>
            `;
        }).join('');

        const violations = Array.isArray(s.playbook_violations)
            ? s.playbook_violations.filter(v => v.violated).map(v => `
                <span class="tl-score-violation" title="${esc(v.evidence || '')}">
                    ${esc(v.id.replace(/_/g, ' '))}
                </span>
            `).join('')
            : '';

        const suggestions = Array.isArray(s.top_3_coaching_suggestions)
            ? s.top_3_coaching_suggestions.map(t => `<li>${esc(t)}</li>`).join('')
            : '';

        return `
            <details class="tl-scorecard tl-score-grade-${esc(grade).toLowerCase()}" open>
                <summary>
                    <span class="tl-score-grade">${esc(grade)}</span>
                    <span class="tl-score-total">${total}/100</span>
                    <span class="tl-score-title">Call quality</span>
                </summary>
                <div class="tl-scorecard-body">
                    ${verdict ? `<div class="tl-score-verdict">${esc(verdict)}</div>` : ''}
                    <div class="tl-score-dims">${dimRows}</div>
                    ${violations ? `
                        <div class="tl-score-violations-row">
                            <span class="tl-score-violations-label">Playbook violations</span>
                            <div class="tl-score-violations">${violations}</div>
                        </div>` : ''}
                    ${suggestions ? `
                        <div class="tl-score-coaching">
                            <div class="tl-score-coaching-head">Coaching</div>
                            <ol class="tl-score-coaching-list">${suggestions}</ol>
                        </div>` : ''}
                </div>
            </details>
        `;
    }

    // ─── Diarized transcript renderer ─────────────────────────────────
    //
    // Two input shapes we handle:
    //   1. meta.segments_json (preferred, when CRM exposes it) — array
    //      of { speaker, text, start_ms, end_ms, language } from AIEngine.
    //      Click on a bubble seeks the audio to that timestamp.
    //   2. meta.transcript_text (always present) — single string with
    //      "Speaker N: …" tokens (English) or "स्पीकर N: …" (Devanagari).
    //      Regex-split into segments. No timestamps but proper speaker
    //      alternation gets us a usable bubble UI.
    //
    // Speaker → side mapping defaults to "Speaker 0 right (agent), all
    // others left (customer)". Outbound calls put the rep first so this
    // is correct in practice; on inbound we still default the same and
    // accept a one-side-only swap if it ever matters.
    // Lazy CSS injection — keeps us from having to touch any HTML
    // file (avoids stepping on parallel UI work). Idempotent via the
    // dataset flag so multiple renderCallExtras calls don't duplicate.
    function ensureBubbleStylesheet() {
        if (document.head.querySelector('link[data-bubble-styles]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        const v = (typeof window !== 'undefined' && window.SW_VERSION) ? window.SW_VERSION : Date.now();
        link.href = `/css/call-bubbles.css?v=${v}`;
        link.dataset.bubbleStyles = '1';
        document.head.appendChild(link);
    }

    function renderTranscriptBubbles(meta) {
        ensureBubbleStylesheet();
        const cid = meta && meta.call_event_id;

        let segments = [];
        let speakerRoles = {}; // speaker_id → "agent"|"customer"|"unknown"

        // Source 1: structured segments_json (when CRM surfaces it).
        if (meta && meta.segments_json) {
            try {
                const raw = typeof meta.segments_json === 'string'
                    ? JSON.parse(meta.segments_json) : meta.segments_json;
                if (Array.isArray(raw)) {
                    segments = raw.map(s => ({
                        speaker: Number(s.speaker ?? s.speaker_id ?? 0),
                        text: String(s.text || '').trim(),
                        startMs: Number(s.start_ms ?? (s.start * 1000) ?? 0),
                        endMs: Number(s.end_ms ?? (s.end * 1000) ?? 0),
                        language: s.language || ''
                    })).filter(s => s.text);
                }
            } catch (_) { /* fall through to text parsing */ }
        }

        // Source 1.5: speakers_json (role mapping). Gemini-only.
        if (meta && meta.speakers_json) {
            try {
                const raw = typeof meta.speakers_json === 'string'
                    ? JSON.parse(meta.speakers_json) : meta.speakers_json;
                if (Array.isArray(raw)) {
                    raw.forEach(s => {
                        if (s && (s.speaker_id != null || s.speaker != null)) {
                            speakerRoles[Number(s.speaker_id ?? s.speaker)] = s.role || 'unknown';
                        }
                    });
                }
            } catch (_) {}
        }

        // Source 2: parse transcript_text via regex.
        if (segments.length === 0 && meta && meta.transcript_text) {
            segments = parseTranscriptTextToSegments(meta.transcript_text);
        }

        if (segments.length === 0) return null;

        // Default speaker labels. If role mapping is present use it,
        // else use heuristic: speaker 0 = Sales rep, others = Customer.
        function labelFor(speakerId) {
            const role = speakerRoles[speakerId];
            if (role === 'agent') return 'Sales rep';
            if (role === 'customer') return 'Customer';
            if (speakerId === 0) return 'Sales rep';
            return 'Customer';
        }
        function sideFor(speakerId) {
            const role = speakerRoles[speakerId];
            if (role === 'agent') return 'right';
            if (role === 'customer') return 'left';
            return speakerId === 0 ? 'right' : 'left';
        }

        // Build bubble HTML.
        const bubbleRows = segments.map(seg => {
            const side = sideFor(seg.speaker);
            const label = labelFor(seg.speaker);
            const ts = seg.startMs > 0 ? formatTimestamp(seg.startMs) : '';
            const seekAttr = (seg.startMs > 0 && cid)
                ? ` data-seek-ms="${seg.startMs}" data-call-event-id="${esc(cid)}" onclick="seekCallAudio(this)"`
                : '';
            const tsHtml = ts ? `<span class="tl-bubble-ts">${ts}</span>` : '';
            const langHtml = seg.language ? `<span class="tl-bubble-lang">${esc(seg.language.toUpperCase())}</span>` : '';
            return `
                <div class="tl-bubble-row tl-bubble-${side}">
                    <div class="tl-bubble tl-bubble-${side}" data-speaker="${seg.speaker}"${seekAttr}>
                        <div class="tl-bubble-header">
                            <span class="tl-bubble-name">${esc(label)}</span>
                            ${langHtml}
                            ${tsHtml}
                        </div>
                        <div class="tl-bubble-body">${esc(seg.text)}</div>
                    </div>
                </div>
            `;
        }).join('');

        return `<div class="tl-bubbles">${bubbleRows}</div>`;
    }

    // Regex-parse "Speaker 0: …Speaker 1: …" or "स्पीकर 0: …" tokens
    // into {speaker, text} segments. Tolerant of mixed-script labels —
    // Gemini sometimes emits the label in Devanagari mid-transcript.
    function parseTranscriptTextToSegments(text) {
        if (!text || typeof text !== 'string') return [];
        const TOKEN = /(?:Speaker|स्पीकर|स्पिकर|वक्ता)\s*(\d+)\s*[:.：]\s*/gi;
        const segments = [];
        let lastIdx = 0;
        let lastSpeaker = null;
        let m;
        while ((m = TOKEN.exec(text)) !== null) {
            if (lastSpeaker !== null) {
                const chunk = text.slice(lastIdx, m.index).trim();
                if (chunk) segments.push({ speaker: lastSpeaker, text: chunk, startMs: 0, endMs: 0, language: '' });
            }
            lastSpeaker = parseInt(m[1], 10);
            lastIdx = TOKEN.lastIndex;
        }
        if (lastSpeaker !== null && lastIdx < text.length) {
            const tail = text.slice(lastIdx).trim();
            if (tail) segments.push({ speaker: lastSpeaker, text: tail, startMs: 0, endMs: 0, language: '' });
        }
        // If we never matched a token, return single-segment fallback so
        // the bubble UI still renders something rather than blanking out.
        if (segments.length === 0) {
            const trimmed = text.trim();
            if (trimmed) segments.push({ speaker: 0, text: trimmed, startMs: 0, endMs: 0, language: '' });
        }
        return segments;
    }

    function formatTimestamp(ms) {
        if (!ms || ms <= 0) return '';
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    // Click-handler for bubble timestamps — seeks the closest audio
    // element in the same call extras block to the bubble's startMs.
    // Exported as a window global at the bottom of the module so the
    // onclick attribute can find it.
    function seekCallAudioImpl(el) {
        if (!el) return;
        const ms = parseInt(el.dataset.seekMs || '0', 10);
        if (!ms) return;
        const extras = el.closest('.tl-call-extras');
        const audio = extras ? extras.querySelector('audio') : null;
        if (!audio) return;
        try {
            audio.currentTime = ms / 1000;
            audio.play().catch(() => {});
        } catch (_) {}
    }

    // Render a Haiku-shape sales-call summary. Schema matches the
    // tool defined in AIEngine.LlmGrpcService.SummarizeCallTranscript.
    function renderCallSummary(s) {
        const rows = [];
        if (s.intent) {
            rows.push(`<div class="tl-summary-row"><span class="tl-summary-label">Intent</span><span class="tl-summary-val">${esc(s.intent)}</span></div>`);
        }
        const pills = [];
        if (s.sentiment) pills.push(`<span class="tl-pill tl-pill-sentiment-${esc(s.sentiment)}">${esc(s.sentiment)}</span>`);
        if (s.urgency) pills.push(`<span class="tl-pill tl-pill-urgency-${esc(s.urgency)}">urgency: ${esc(s.urgency)}</span>`);
        if (s.follow_up_required === true) pills.push(`<span class="tl-pill tl-pill-followup">follow-up</span>`);
        if (pills.length) {
            rows.push(`<div class="tl-summary-row"><span class="tl-summary-label">Read</span><span class="tl-summary-val">${pills.join(' ')}</span></div>`);
        }
        if (Array.isArray(s.customer_pain) && s.customer_pain.length) {
            rows.push(`<div class="tl-summary-row"><span class="tl-summary-label">Pain points</span><ul class="tl-summary-list">${s.customer_pain.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
        }
        if (Array.isArray(s.next_steps) && s.next_steps.length) {
            rows.push(`<div class="tl-summary-row"><span class="tl-summary-label">Next steps</span><ul class="tl-summary-list">${s.next_steps.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
        }
        if (Array.isArray(s.key_quotes) && s.key_quotes.length) {
            rows.push(`<div class="tl-summary-row"><span class="tl-summary-label">Key quotes</span><ul class="tl-summary-list tl-summary-quotes">${s.key_quotes.map(x => `<li>"${esc(x)}"</li>`).join('')}</ul></div>`);
        }
        if (s.agent_notes) {
            rows.push(`<div class="tl-summary-row"><span class="tl-summary-label">Coaching</span><span class="tl-summary-val tl-summary-coach">${esc(s.agent_notes)}</span></div>`);
        }
        return `
            <details class="tl-summary" open>
                <summary>AI summary</summary>
                <div class="tl-summary-body">${rows.join('')}</div>
            </details>
        `;
    }

    // Modal that embeds the existing whatsapp-inbox.html page in compact
    // mode — same component as the standalone inbox so live ticks, SignalR
    // updates, emoji, attachments, status receipts etc. all work without
    // re-implementing anything. The iframe loads with ?phone=&compact=1;
    // the page's own JS auto-opens the conversation and the CSS hides
    // the sidebar / navbar / breadcrumb.
    window.openWhatsAppThreadModal = function (phoneDigits, businessDigits) {
        if (!phoneDigits) return;
        // businessDigits flows into the iframe URL so the inbox JS can skip
        // /api/whatsapp/numbers (SUPERADMIN-only). Optional for backward
        // compatibility — older callers that only pass phoneDigits still
        // work for SUPERADMINs (the inbox falls back to its full bootstrap).
        businessDigits = (businessDigits || '').replace(/\D/g, '');
        // Close the lead-detail slide panel first — the modal is full-width
        // and the panel would otherwise sit half-covered underneath it. The
        // panel's data is preserved; it re-opens via the same row click.
        try { if (typeof closeLeadDetailPanel === 'function') closeLeadDetailPanel(); } catch (_) {}
        // De-dupe — re-clicking should focus the existing modal instead
        // of stacking another iframe on top.
        let modal = document.getElementById('waThreadModal');
        if (modal) {
            modal.querySelector('iframe')?.contentWindow?.focus?.();
            return;
        }
        modal = document.createElement('div');
        modal.id = 'waThreadModal';
        // Floats below the navbar — no dim overlay (the user found the dark
        // wash distracting; an iframe modal that already takes the eye-line
        // doesn't need a backdrop). pointer-events:none on the wrapper so
        // clicks on the leads page underneath still work; the card itself
        // re-enables pointer-events.
        modal.style.cssText = 'position:fixed;top:80px;left:24px;right:24px;bottom:24px;z-index:1000000;display:flex;align-items:center;justify-content:center;pointer-events:none;';

        const card = document.createElement('div');
        card.style.cssText = 'background:var(--bg-card);border-radius:12px;width:min(1000px,100%);height:100%;box-shadow:0 24px 64px rgba(0,0,0,0.45);overflow:hidden;display:flex;flex-direction:column;pointer-events:auto;border:1px solid var(--border-color);';

        const headerBar = document.createElement('div');
        headerBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-secondary);border-bottom:1px solid var(--border-color);font-size:0.9rem;color:var(--text-secondary);';
        headerBar.innerHTML = '<span>WhatsApp conversation</span>';
        const close = document.createElement('button');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.style.cssText = 'background:transparent;border:none;font-size:1.4rem;line-height:1;cursor:pointer;color:var(--text-secondary);padding:2px 8px;';
        close.textContent = '×';
        close.addEventListener('click', () => modal.remove());
        headerBar.appendChild(close);

        const iframe = document.createElement('iframe');
        const businessParam = businessDigits ? `&business=${encodeURIComponent(businessDigits)}` : '';
        iframe.src = `/pages/crm/whatsapp-inbox.html?phone=${encodeURIComponent(phoneDigits)}${businessParam}&compact=1`;
        iframe.style.cssText = 'border:0;flex:1;width:100%;background:#efeae2;';
        iframe.setAttribute('title', 'WhatsApp conversation');

        card.appendChild(headerBar);
        card.appendChild(iframe);
        modal.appendChild(card);

        // No click-outside-to-close — pointer-events:none on the wrapper
        // lets clicks pass through to the underlying page, which is the
        // desired UX (no backdrop means no implicit "click outside" zone).
        // ESC + the X button remain.
        document.addEventListener('keydown', function escHandler(ev) {
            if (ev.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        });
        document.body.appendChild(modal);
    };

    window.retryTranscriptionFromBtn = async function(btn) {
        const cid = btn.getAttribute('data-call-event-id');
        if (!cid) return;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '…';
        try {
            await api.request(`/crm/calls/${cid}/retry-transcription`, {
                method: 'POST'
            });
            Toast.success('Re-submitted for transcription');
            // Reload the lead-detail panel so the timeline shows the
            // new "Transcribing…" placeholder. The SignalR event will
            // refresh it again when the pipeline completes.
            if (window._leadDetailId) openLeadDetailPanel(window._leadDetailId);
        } catch (e) {
            btn.disabled = false;
            btn.textContent = originalText;
            const msg = (e && e.message) ? e.message : 'Failed to re-submit';
            Toast.error(msg);
        }
    };

    window.completeFollowupFromTimeline = async function(btn) {
        const fid = btn.getAttribute('data-followup-id');
        if (!fid) return;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '…';
        try {
            await api.request(`/crm/leads/followups/${fid}/complete`, {
                method: 'PUT',
                body: JSON.stringify({ completed_notes: 'Marked complete from lead timeline' })
            });
            if (window._leadDetailId) openLeadDetailPanel(window._leadDetailId);
            // The leads list behind the panel caches next_followup_date; without
            // a reload the "Follow-up today" badge keeps showing after the user
            // marks today's only pending follow-up complete (real complaint,
            // Subhi @ VBF, 2026-05-14). Refresh so the badge reflects the
            // recomputed value.
            if (typeof window.loadLeads === 'function') window.loadLeads();
        } catch (e) {
            btn.disabled = false;
            btn.textContent = originalText;
            Toast.error(e.message || 'Failed to mark complete');
        }
    };

    function getTimelineIcon(type) {
        const icons = {
            call: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
            email: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
            meeting: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
            note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
            status: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>',
            followup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            transfer: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/><polyline points="9 21 3 21 3 15"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
            'email-sent':         '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
            'email-opened':       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
            'email-clicked':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11.5a3.5 3.5 0 1 0 5.9-2.5"/><path d="M14 7l5 5-5 5"/><path d="M5 12h14"/></svg>',
            'email-replied':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
            'email-bounced':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
            'email-unsubscribed': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
            // WhatsApp speech-bubble glyph (filled), matches the brand mark
            // recognisable in a timeline at 14×14. Used by both the umbrella
            // type='whatsapp' and the per-direction subtypes the backend emits.
            whatsapp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.85 9.85 0 0 0 12.04 2zm5.69 14.07c-.24.67-1.19 1.28-1.74 1.36-.45.07-1 .1-1.61-.1-.37-.12-.85-.28-1.46-.55-2.57-1.11-4.25-3.7-4.38-3.87-.13-.17-1.05-1.4-1.05-2.66 0-1.27.66-1.89.9-2.15.24-.26.52-.32.69-.32h.5c.16 0 .38-.06.59.45.21.52.72 1.79.78 1.92.06.13.1.28.02.45-.08.17-.12.27-.24.42-.12.14-.25.32-.36.43-.12.12-.24.25-.1.49.14.24.62 1.02 1.33 1.65.91.81 1.68 1.06 1.92 1.18.24.12.38.1.52-.06.14-.16.6-.7.76-.94.16-.24.32-.2.54-.12.22.08 1.4.66 1.64.78.24.12.4.18.46.28.06.1.06.58-.18 1.25z"/></svg>',
            'whatsapp-inbound':  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.85 9.85 0 0 0 12.04 2zm5.69 14.07c-.24.67-1.19 1.28-1.74 1.36-.45.07-1 .1-1.61-.1-.37-.12-.85-.28-1.46-.55-2.57-1.11-4.25-3.7-4.38-3.87-.13-.17-1.05-1.4-1.05-2.66 0-1.27.66-1.89.9-2.15.24-.26.52-.32.69-.32h.5c.16 0 .38-.06.59.45.21.52.72 1.79.78 1.92.06.13.1.28.02.45-.08.17-.12.27-.24.42-.12.14-.25.32-.36.43-.12.12-.24.25-.1.49.14.24.62 1.02 1.33 1.65.91.81 1.68 1.06 1.92 1.18.24.12.38.1.52-.06.14-.16.6-.7.76-.94.16-.24.32-.2.54-.12.22.08 1.4.66 1.64.78.24.12.4.18.46.28.06.1.06.58-.18 1.25z"/></svg>',
            'whatsapp-outbound': '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.85 9.85 0 0 0 12.04 2zm5.69 14.07c-.24.67-1.19 1.28-1.74 1.36-.45.07-1 .1-1.61-.1-.37-.12-.85-.28-1.46-.55-2.57-1.11-4.25-3.7-4.38-3.87-.13-.17-1.05-1.4-1.05-2.66 0-1.27.66-1.89.9-2.15.24-.26.52-.32.69-.32h.5c.16 0 .38-.06.59.45.21.52.72 1.79.78 1.92.06.13.1.28.02.45-.08.17-.12.27-.24.42-.12.14-.25.32-.36.43-.12.12-.24.25-.1.49.14.24.62 1.02 1.33 1.65.91.81 1.68 1.06 1.92 1.18.24.12.38.1.52-.06.14-.16.6-.7.76-.94.16-.24.32-.2.54-.12.22.08 1.4.66 1.64.78.24.12.4.18.46.28.06.1.06.58-.18 1.25z"/></svg>',
        };
        return icons[type] || icons.note;
    }

    function formatTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    }

    function esc(s) {
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
    function escJsAttr(s) {
        return esc(String(s ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, '\\n'));
    }

    // ─── Transfer Request ─────────────────────────────────────────────────

    let _transferLeadId = null;

    async function openTransferRequestModal(leadId) {
        _transferLeadId = leadId;
        document.getElementById('transferReason').value = '';

        // Load teams for the dropdown
        try {
            const teams = await api.request('/crm/teams');
            const sel = document.getElementById('transferTargetTeam');
            sel.innerHTML = '<option value="">Select team...</option>' +
                (teams || []).map(t => `<option value="${t.id}">${esc(t.team_name)} (${esc(t.team_code)})</option>`).join('');
        } catch (e) {
            Toast.error('Failed to load teams');
            return;
        }

        document.getElementById('transferRequestOverlay').classList.add('active');
    }

    function closeTransferRequestModal() {
        document.getElementById('transferRequestOverlay').classList.remove('active');
        _transferLeadId = null;
    }

    async function submitTransferRequest() {
        if (!_transferLeadId) return;
        const teamId = document.getElementById('transferTargetTeam').value;
        const reason = document.getElementById('transferReason').value.trim();

        if (!teamId) { Toast.error('Please select a team'); return; }
        if (!reason) { Toast.error('Reason is required'); return; }

        try {
            await api.request(`/crm/leads/${_transferLeadId}/transfer-request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to_team_id: teamId, reason: reason })
            });
            const transferredLeadId = _transferLeadId;
            const panelWasOpen = window._leadDetailId === transferredLeadId;
            Toast.success('Transfer request submitted for approval');
            closeTransferRequestModal();
            loadLeads();
            if (transferredLeadId && panelWasOpen) openLeadDetailPanel(transferredLeadId);
        } catch (e) {
            Toast.error(e.message || 'Failed to submit transfer request');
        }
    }

    // ─── Pending Transfers (TL/Manager view) ─────────────────────────────

    async function openPendingTransfersModal() {
        document.getElementById('pendingTransfersList').innerHTML = '<p style="color:var(--text-secondary);">Loading...</p>';
        document.getElementById('pendingTransfersOverlay').classList.add('active');

        try {
            const transfers = await api.request('/crm/leads/transfer-requests');
            renderPendingTransfers(transfers || []);
        } catch (e) {
            document.getElementById('pendingTransfersList').innerHTML = `<p style="color:var(--color-error);">${esc(e.message)}</p>`;
        }
    }

    function closePendingTransfersModal() {
        document.getElementById('pendingTransfersOverlay').classList.remove('active');
    }

    async function renderPendingTransfers(transfers) {
        const container = document.getElementById('pendingTransfersList');
        if (transfers.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No pending transfer requests</p>';
            return;
        }

        // Load team members for same-team reassignment picker
        let teamMembersByTeam = {};
        try {
            const teams = await api.request('/crm/teams');
            for (const team of teams) {
                if (transfers.some(tr => tr.from_team_id === team.id)) {
                    const detail = await api.request(`/crm/teams/${team.id}`);
                    teamMembersByTeam[team.id] = (detail.members || []).filter(m => m.is_active);
                }
            }
        } catch {}

        container.innerHTML = transfers.map(t => {
            const isSameTeam = t.from_team_id === t.to_team_id;
            const members = teamMembersByTeam[t.from_team_id] || [];
            // Exclude the requester from the picker (they're asking to be relieved)
            const availableMembers = members.filter(m => m.user_id !== t.requested_by);

            if (isSameTeam) {
                // ── Same-team reassignment card ──
                return `
                <div class="transfer-card transfer-card-reassign">
                    <div class="transfer-card-header">
                        <div>
                            <strong style="font-size:0.95rem;">${esc(t.lead_name || 'Unknown Lead')}</strong>
                            <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;">
                                Requested by <strong style="color:var(--text-primary);">${esc(t.requested_by_name || 'Unknown')}</strong>
                            </div>
                        </div>
                        <span class="transfer-card-date">${new Date(t.created_at).toLocaleDateString()}</span>
                    </div>
                    <div class="transfer-card-type-badge" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:6px;font-size:0.72rem;font-weight:600;background:rgba(249,115,22,0.12);color:#fb923c;border:1px solid rgba(249,115,22,0.2);margin-bottom:8px;">
                        ⇄ Reassignment Request
                    </div>
                    <div class="transfer-card-reason" style="margin-bottom:10px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:0.5;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        "${esc(t.reason)}"
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="font-size:0.78rem;color:var(--text-secondary);display:block;margin-bottom:4px;">Reassign this lead to:</label>
                        <select id="reassignTo_${t.id}" class="form-control" style="height:34px;font-size:0.82rem;">
                            <option value="">— Select team member —</option>
                            ${availableMembers.map(m => `<option value="${m.user_id}">${esc(m.display_name || m.user_id)} (${m.role})</option>`).join('')}
                        </select>
                    </div>
                    <div class="transfer-card-actions">
                        <button class="btn btn-sm btn-success" onclick="approveTransfer('${t.id}', true, '${t.lead_id}')">Approve & Reassign</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="rejectTransfer('${t.id}')">Reject</button>
                    </div>
                </div>`;
            } else {
                // ── Cross-team transfer card ──
                return `
                <div class="transfer-card">
                    <div class="transfer-card-header">
                        <div>
                            <strong style="font-size:0.95rem;">${esc(t.lead_name || 'Unknown Lead')}</strong>
                            <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;">
                                Requested by <strong style="color:var(--text-primary);">${esc(t.requested_by_name || 'Unknown')}</strong>
                            </div>
                        </div>
                        <span class="transfer-card-date">${new Date(t.created_at).toLocaleDateString()}</span>
                    </div>
                    <div class="transfer-card-route">
                        <span class="transfer-team-from">${esc(t.from_team_name || '?')}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                        <span class="transfer-team-to">${esc(t.to_team_name || '?')}</span>
                    </div>
                    <div class="transfer-card-reason">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:0.5;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        "${esc(t.reason)}"
                    </div>
                    <div class="transfer-card-actions">
                        <button class="btn btn-sm btn-success" onclick="approveTransfer('${t.id}', false, '${t.lead_id}')">Approve Transfer</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="rejectTransfer('${t.id}')">Reject</button>
                    </div>
                </div>`;
            }
        }).join('');
    }

    async function approveTransfer(transferId, isSameTeam, leadId) {
        try {
            // For same-team reassignment, get selected member
            let reassignTo = null;
            if (isSameTeam) {
                const sel = document.getElementById(`reassignTo_${transferId}`);
                if (!sel || !sel.value) {
                    Toast.warning('Please select a team member to reassign to');
                    return;
                }
                reassignTo = sel.value;
            }

            await api.request(`/crm/leads/transfer-requests/${transferId}/approve`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reassign_to: reassignTo })
            });

            // If same-team, also reassign the lead owner
            if (isSameTeam && reassignTo && leadId) {
                await api.request(`/crm/leads/${leadId}/assign`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ owner_user_id: reassignTo })
                });
            }

            Toast.success(isSameTeam ? 'Lead reassigned to team member' : 'Transfer approved — lead moved to new team');
            openPendingTransfersModal();
            loadLeads();
            loadLeadStats();
            checkPendingTransfers();
        } catch (e) {
            Toast.error(e.message || 'Failed to approve');
        }
    }

    async function rejectTransfer(transferId) {
        const notes = await showPrompt('Reason for rejection (optional):', '', 'Reject Transfer');
        if (notes === null) return; // cancelled
        try {
            await api.request(`/crm/leads/transfer-requests/${transferId}/reject`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ review_notes: notes || undefined })
            });
            Toast.success('Transfer rejected');
            openPendingTransfersModal(); // refresh list
            checkPendingTransfers();
        } catch (e) {
            Toast.error(e.message || 'Failed to reject');
        }
    }

    // Check for pending transfers on page load (show badge for TL/managers)
    async function checkPendingTransfers() {
        try {
            // Members don't see the transfers button
            if (typeof myTeamRole !== 'undefined' && myTeamRole === 'member') {
                document.getElementById('pendingTransfersBtn').style.display = 'none';
                return;
            }

            const transfers = await api.request('/crm/leads/transfer-requests');
            const count = (transfers || []).length;
            const btn = document.getElementById('pendingTransfersBtn');
            const badge = document.getElementById('pendingTransfersBadge');

            if (count > 0) {
                btn.style.display = '';
                badge.style.display = '';
                badge.textContent = count;
            } else {
                badge.style.display = 'none';
                btn.style.display = '';
            }
        } catch (e) {
            document.getElementById('pendingTransfersBtn').style.display = 'none';
        }
    }

    // Run on page load
    document.addEventListener('DOMContentLoaded', () => {
        checkPendingTransfers();
    });

    // ─── Schedule Follow-up Modal ────────────────────────────────────────

    let _followupLeadId = null;

    function openScheduleFollowupModal(leadId) {
        _followupLeadId = leadId;
        document.getElementById('followupType').value = 'call';
        HRMSDatePicker.setDateTimeValue('followupDateTime', '');
        document.getElementById('followupNotes').value = '';
        document.getElementById('scheduleFollowupOverlay').classList.add('active');
    }

    function closeScheduleFollowupModal() {
        document.getElementById('scheduleFollowupOverlay').classList.remove('active');
        _followupLeadId = null;
    }

    async function submitScheduleFollowup() {
        if (!_followupLeadId) return;
        const followupErr2 = HRMSDatePicker.validateDateTimePair('followupDateTime', 'Date & time');
        if (followupErr2) { Toast.error(followupErr2); return; }
        const dt = HRMSDatePicker.getDateTimeValue('followupDateTime');
        if (!dt) { Toast.error('Date & time is required'); return; }
        const fType = document.getElementById('followupType').value;
        const notes = document.getElementById('followupNotes').value.trim();

        try {
            await api.request('/crm/leads/followups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lead_id: _followupLeadId,
                    scheduled_at: new Date(dt).toISOString(),
                    followup_type: fType,
                    notes: notes || undefined
                })
            });
            Toast.success('Follow-up scheduled');
            closeScheduleFollowupModal();
            // Refresh detail panel if open
            if (window._leadDetailId === _followupLeadId) {
                openLeadDetailPanel(_followupLeadId);
            }
            loadLeads();
        } catch (e) {
            Toast.error(e.message || 'Failed to schedule follow-up');
        }
    }

    // ─── Timeline Search ───────────────────────────────────────────────

    function filterTimeline(query) {
        const q = (query || '').toLowerCase();
        document.querySelectorAll('#leadTimeline .tl-entry').forEach(el => {
            const text = el.textContent.toLowerCase();
            el.style.display = q && !text.includes(q) ? 'none' : '';
        });
    }

    // ─── Print Timeline ─────────────────────────────────────────────────

    function printLeadTimeline() {
        const panel = document.getElementById('leadDetailPanel');
        if (!panel) return;

        const name = document.getElementById('leadDetailName')?.textContent || 'Lead';
        const info = document.getElementById('leadDetailInfo')?.innerHTML || '';
        const timeline = document.getElementById('leadTimeline')?.innerHTML || '';

        const logoUrl = window.location.origin + '/assets/logo-name-blue.png';

        const printWin = window.open('', '_blank');
        printWin.document.write(`<!DOCTYPE html>
<html><head>
<title>${name} — Activity Timeline</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1a1a2e; max-width: 800px; margin: 0 auto; }
    .print-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 16px; }
    .print-header img { height: 32px; }
    .print-header h1 { font-size: 1.3rem; margin: 0; }
    .lead-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .lead-detail-item { display: flex; flex-direction: column; gap: 2px; }
    .lead-detail-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
    .crm-status-badge, .crm-disposition-badge { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: #e5e7eb; display: inline-block; }
    h2 { font-size: 1.1rem; margin: 20px 0 12px; color: #374151; }
    .tl-entry { display: flex; gap: 10px; padding: 8px 0; border-left: 2px solid #d1d5db; margin-left: 8px; padding-left: 16px; position: relative; page-break-inside: avoid; }
    .tl-icon { position: absolute; left: -9px; top: 10px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #fff; border: 2px solid #9ca3af; font-size: 10px; }
    .tl-title { font-weight: 600; font-size: 0.9rem; }
    .tl-desc { font-size: 0.82rem; color: #4b5563; margin-top: 2px; }
    .tl-meta { font-size: 0.75rem; color: #9ca3af; margin-top: 2px; }
    .tl-who { font-weight: 500; color: #374151; }
    .tl-who-email { color: #6b7280; font-size: 0.72rem; }
    .tl-outcome { font-size: 0.72rem; padding: 1px 6px; border-radius: 4px; background: #ede9fe; color: #7c3aed; }
    .tl-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tl-chip { display: inline-flex; padding: 1px 7px; border-radius: 4px; font-size: 0.68rem; font-weight: 500; background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
    .tl-chip-type { background: #ede9fe; color: #7c3aed; text-transform: uppercase; }
    .tl-chip-outcome { background: #dcfce7; color: #16a34a; }
    .tl-chip-completed { background: #dcfce7; color: #16a34a; }
    .tl-chip-pending { background: #fef3c7; color: #d97706; }
    .tl-chip-missed { background: #fee2e2; color: #dc2626; }
    .print-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 0.7rem; color: #9ca3af; display: flex; justify-content: space-between; }
    @media print { body { padding: 0; } }
</style>
</head><body>
<div class="print-header">
    <img src="${logoUrl}" alt="Ragenaizer">
    <h1>${name} — Lead Report</h1>
</div>
<div class="lead-detail-grid">${info}</div>
<h2>Activity Timeline</h2>
<div>${timeline}</div>
<div class="print-footer">
    <span>Generated ${new Date().toLocaleString()}</span>
    <span>Ragenaizer CRM</span>
</div>
</body></html>`);
        printWin.document.close();
        setTimeout(() => { printWin.print(); }, 300);
    }

    // ─── Reply composer ─────────────────────────────────────────────────
    //
    // Opens a modal pre-filled from a timeline reply row. Sends via the same
    // mailbox that received the reply and sets In-Reply-To on the outbound so
    // the thread stays threaded in the recipient's client. The send carries
    // lead_id so the row appears on this lead's timeline automatically (no
    // manual timeline merge needed — GetEmailTimelineForLeadAsync already
    // picks up email_sends WHERE lead_id = lead).

    let _replyCtx = null;
    let _replyTmceReady = null;          // Promise<editor> from tinymce.init
    const REPLY_TMCE_ID = 'replyBodyEditor';
    let _replyAttachments = []; // [{name, size, type, base64}]

    // TinyMCE replaces Quill in this composer for the same reason as the
    // template editor: Quill's clipboard strips inline `style` attributes,
    // breaking pasted Outlook / Drive share-link cards. valid_elements +
    // paste_remove_styles config below preserves source verbatim.
    function ensureReplyTmce() {
        if (_replyTmceReady) return _replyTmceReady;
        if (typeof tinymce === 'undefined') {
            console.error('TinyMCE script not loaded');
            return Promise.resolve(null);
        }
        _replyTmceReady = tinymce.init({
            selector: '#' + REPLY_TMCE_ID,
            license_key: 'gpl',
            height: 320,
            menubar: false,
            promotion: false,
            branding: false,
            statusbar: false,
            plugins: 'lists link image table code preview anchor autolink',
            toolbar: 'blocks | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright | bullist numlist | link image table | code preview',
            toolbar_mode: 'wrap',
            valid_elements: '*[*]',
            extended_valid_elements: '*[*]',
            paste_remove_styles: false,
            paste_remove_styles_if_webkit: false,
            paste_webkit_styles: 'all',
            paste_data_images: true,
            paste_as_text: false,
            keep_styles: true,
            forced_root_block: 'p',
            element_format: 'html',
            verify_html: false,
            cleanup: false,
            convert_urls: false,
            entity_encoding: 'raw',
            content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
            placeholder: 'Type your reply…',
            setup: function (editor) {
                editor.on('init', function () {
                    const modalBody = document.querySelector('#replyEmailModal .reply-modal-body');
                    if (!modalBody) return;
                    // Same scroll-closes-popup pattern as the templates editor
                    // (TinyMCE doesn't reposition body-level dropdowns when the
                    // modal scrolls, so close them outright).
                    modalBody.addEventListener('scroll', function () {
                        document.querySelectorAll('.tox-tinymce-aux .tox-pop, .tox-tinymce-aux .tox-menu, .tox-tinymce-aux .tox-collection')
                            .forEach(function (el) { el.style.display = 'none'; });
                    }, { passive: true });
                });
            }
        }).then(eds => (eds && eds[0]) || tinymce.get(REPLY_TMCE_ID));
        return _replyTmceReady;
    }

    function getReplyHtml() {
        const ed = (typeof tinymce !== 'undefined') ? tinymce.get(REPLY_TMCE_ID) : null;
        return ed ? (ed.getContent() || '') : '';
    }
    function getReplyText() {
        const ed = (typeof tinymce !== 'undefined') ? tinymce.get(REPLY_TMCE_ID) : null;
        if (!ed) return '';
        return (ed.getContent({ format: 'text' }) || '').trim();
    }
    function setReplyContent(html) {
        const ed = (typeof tinymce !== 'undefined') ? tinymce.get(REPLY_TMCE_ID) : null;
        if (ed) ed.setContent(html || '');
    }
    const REPLY_MAX_ATTACH_COUNT = 20;
    const REPLY_MAX_PER_FILE = 10 * 1024 * 1024;   // 10 MB — matches MailboxController cap
    const REPLY_MAX_TOTAL = 20 * 1024 * 1024;      // 20 MB total — matches MailboxController cap
    // Mirrors the server-side ForbiddenExtensions set so we fail fast with a
    // clear message before wasting a round-trip.
    const REPLY_FORBIDDEN_EXT = new Set([
        '.ade','.adp','.apk','.appx','.appxbundle','.bat','.cab','.chm','.cmd','.com',
        '.cpl','.dll','.dmg','.ex','.ex_','.exe','.hta','.ins','.isp','.iso','.jar',
        '.js','.jse','.lib','.lnk','.mde','.msc','.msi','.msix','.msixbundle','.msp',
        '.mst','.nsh','.pif','.ps1','.scr','.sct','.shb','.sys','.vb','.vbe','.vbs',
        '.vxd','.wsc','.wsf','.wsh'
    ]);

    // "Abhi Anand" <abhi@example.com>  →  { email: 'abhi@example.com', name: 'Abhi Anand' }
    // abhi@example.com                  →  { email: 'abhi@example.com', name: null }
    // Handles the RFC 5322 name-addr form our reply poller stores. Backend
    // validation is strict (bare email only), so we strip the display part
    // before submitting.
    function parseEmailAddress(raw) {
        if (!raw) return { email: '', name: null };
        const s = String(raw).trim();
        const m = s.match(/^\s*(?:"?([^"<>]*?)"?\s*)?<\s*([^<>\s]+)\s*>\s*$/);
        if (m) return { email: (m[2] || '').trim(), name: (m[1] || '').trim() || null };
        return { email: s, name: null };
    }

    function openReplyModalFromBtn(btn) {
        try {
            const raw = btn.getAttribute('data-reply');
            // Decode the base64-utf8 payload written by the timeline renderer.
            const json = decodeURIComponent(escape(atob(raw)));
            const payload = JSON.parse(json);
            openReplyModal(payload);
        } catch (e) {
            console.error('reply payload decode failed:', e);
            Toast.error('Failed to open reply composer');
        }
    }

    async function openReplyModal(ctx) {
        const parsed = parseEmailAddress(ctx.toEmail);
        const subj = ctx.subject && ctx.subject.toLowerCase().startsWith('re:')
            ? ctx.subject
            : (ctx.subject ? `Re: ${ctx.subject}` : '');

        // Mailbox the original message was sent through — Reply must use
        // the same mailbox so the threading is consistent. Fall back to
        // tenant-default if ctx.mailboxId is missing.
        let mailboxes = [];
        if (Array.isArray(window._tenantConfiguredMailboxes) &&
            window._tenantConfiguredMailboxes.length > 0) {
            mailboxes = window._tenantConfiguredMailboxes
                .filter(m => m && m.id && m.is_active !== false)
                .map(m => ({ id: m.id, email: m.email_address }));
        } else {
            try {
                const [defResp, attResp] = await Promise.all([
                    api.request('/crm/mailbox-attachments/tenant-default').catch(() => ({})),
                    api.request('/crm/mailbox-attachments/attachments').catch(() => ({})),
                ]);
                const seen = new Set();
                if (defResp?.mailbox?.id) {
                    mailboxes.push({ id: defResp.mailbox.id, email: defResp.mailbox.email_address });
                    seen.add(defResp.mailbox.id);
                }
                for (const a of (attResp?.attachments || [])) {
                    const id = a.mailbox_id || a.id;
                    if (!id || seen.has(id)) continue;
                    mailboxes.push({ id, email: a.mailbox_email || a.email_address });
                    seen.add(id);
                }
            } catch (_) {}
        }
        if (mailboxes.length === 0) {
            Toast.error('No mailbox configured. Open Settings → Mailboxes to add one.');
            return;
        }
        // Prefer ctx.mailboxId (the mailbox the original landed in) if it
        // matches a configured mailbox; else first.
        const selectedId = (ctx.mailboxId && mailboxes.find(m => m.id === ctx.mailboxId))
            ? ctx.mailboxId
            : mailboxes[0].id;

        if (typeof window.EmailComposer === 'undefined') {
            Toast.error('Email composer not loaded — refresh and retry.');
            return;
        }

        window.EmailComposer.open({
            title: 'Reply',
            fromMailboxes: mailboxes,
            selectedFromId: selectedId,
            to: parsed.name ? `${parsed.name} <${parsed.email}>` : parsed.email,
            subject: subj,
            initialBodyHtml: '',
            leadId: window._leadDetailId,
            inReplyTo: ctx.inReplyTo || null,
            onSend: async (payload) => {
                // Stitch quoted original so recipients have context in
                // clients that don't collapse threads. We add to the HTML
                // via <blockquote>, and to the text body with the classic
                // "> " prefix.
                let finalHtml = payload.html;
                let finalText = payload.text;
                if (ctx.replySnippet) {
                    const who = parsed.name
                        ? `${parsed.name} &lt;${esc(parsed.email)}&gt;`
                        : esc(parsed.email);
                    const snippetEscHtml = esc(ctx.replySnippet).replace(/\n/g, '<br>');
                    finalHtml += `<br><hr><p style="color:#6b7280;font-size:0.9em;">On earlier reply, ${who} wrote:</p><blockquote style="border-left:3px solid #e5e7eb;padding-left:10px;color:#6b7280;">${snippetEscHtml}</blockquote>`;
                    const quoteTxt = String(ctx.replySnippet).replace(/\n/g, '\n> ');
                    finalText += `\n\n-----\n> ${quoteTxt}`;
                }
                const attachments = (payload.attachments || []).map(a => ({
                    file_name: a.name,
                    mime_type: a.type || 'application/octet-stream',
                    content_base64: a.base64
                }));
                const wrap = arr => (arr || []).map(e => ({ email: e, name: null }));
                await api.request(`/mailbox-send/${payload.fromId}/send`, {
                    method: 'POST',
                    body: JSON.stringify({
                        to_email: payload.to,
                        to_name: payload.toName || undefined,
                        cc: payload.cc && payload.cc.length ? wrap(payload.cc) : undefined,
                        bcc: payload.bcc && payload.bcc.length ? wrap(payload.bcc) : undefined,
                        subject: payload.subject || 'Re:',
                        body_html: finalHtml,
                        body_text: finalText,
                        in_reply_to: payload.inReplyTo || undefined,
                        lead_id: payload.leadId || undefined,
                        attachments: attachments.length ? attachments : undefined,
                    }),
                });
                Toast.success('Reply sent');
                if (payload.leadId) openLeadDetailPanel(payload.leadId);
            }
        });
    }

    function closeReplyModal() {
        const modal = document.getElementById('replyEmailModal');
        if (modal) modal.classList.remove('active');
        _replyCtx = null;
        _replyAttachments = [];
    }

    function buildReplyModal() {
        const overlay = document.createElement('div');
        overlay.id = 'replyEmailModal';
        overlay.className = 'gm-overlay';
        overlay.innerHTML = `
            <div class="gm-modal reply-modal">
                <div class="gm-header">
                    <h3>Reply</h3>
                    <button class="gm-close" onclick="closeReplyModal()">&times;</button>
                </div>
                <div class="gm-body reply-modal-body">
                    <div class="crm-alert crm-alert-error" id="replyModalError" style="display:none;"></div>
                    <div class="crm-form-group">
                        <label for="replyToEmail">To</label>
                        <input type="text" class="form-control" id="replyToEmail" readonly>
                    </div>
                    <div class="crm-form-group">
                        <label for="replySubject">Subject</label>
                        <input type="text" class="form-control" id="replySubject">
                    </div>
                    <div class="crm-form-group reply-editor">
                        <label>Message</label>
                        <textarea id="replyBodyEditor"></textarea>
                    </div>
                    <div class="crm-form-group">
                        <label>Attachments <span class="reply-attach-hint">(max 20 files, 10 MB each, 20 MB total)</span></label>
                        <div class="reply-attach-row">
                            <label class="btn btn-sm btn-secondary reply-attach-btn">
                                <input type="file" id="replyAttachInput" multiple style="display:none;" onchange="onReplyAttachChange(event)">
                                + Add files
                            </label>
                            <span id="replyAttachSummary" class="reply-attach-summary"></span>
                        </div>
                        <div id="replyAttachList" class="reply-attach-list"></div>
                    </div>
                    <details class="reply-quoted-details">
                        <summary>Show quoted original</summary>
                        <pre id="replyQuotedPreview" class="reply-quoted-pre"></pre>
                    </details>
                </div>
                <div class="gm-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeReplyModal()">Cancel</button>
                    <button type="button" class="btn btn-primary" id="replySendBtn" onclick="submitReply()">Send</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }

    function renderReplyQuotedPreview(ctx) {
        const pre = document.getElementById('replyQuotedPreview');
        if (!pre) return;
        if (!ctx.replySnippet) {
            pre.textContent = '';
            return;
        }
        const who = ctx._toName
            ? `${ctx._toName} <${ctx._toEmailPure}>`
            : ctx._toEmailPure;
        pre.textContent = `On earlier reply, ${who} wrote:\n> ${String(ctx.replySnippet).replace(/\n/g, '\n> ')}`;
    }

    function onReplyAttachChange(ev) {
        const files = Array.from(ev.target.files || []);
        const errs = [];
        const totalExisting = _replyAttachments.reduce((n, a) => n + a.size, 0);
        let runningTotal = totalExisting;

        // Promise per-file so base64 encoding happens off the main thread
        const promises = [];
        for (const f of files) {
            if (_replyAttachments.length + promises.length >= REPLY_MAX_ATTACH_COUNT) {
                errs.push(`Max ${REPLY_MAX_ATTACH_COUNT} files total`);
                break;
            }
            const extMatch = f.name.match(/\.[^./\\]+$/);
            const ext = extMatch ? extMatch[0].toLowerCase() : '';
            if (REPLY_FORBIDDEN_EXT.has(ext)) {
                errs.push(`"${f.name}": extension ${ext} is blocked by Gmail/M365`);
                continue;
            }
            if (f.size > REPLY_MAX_PER_FILE) {
                errs.push(`"${f.name}": ${(f.size/1024/1024).toFixed(1)} MB exceeds 10 MB per-file cap`);
                continue;
            }
            runningTotal += f.size;
            if (runningTotal > REPLY_MAX_TOTAL) {
                errs.push(`"${f.name}": would exceed 20 MB total cap`);
                runningTotal -= f.size;
                continue;
            }
            promises.push(new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    // FileReader.result is a data: URL; strip the prefix.
                    const dataUrl = String(reader.result || '');
                    const comma = dataUrl.indexOf(',');
                    const base64 = comma >= 0 ? dataUrl.substring(comma + 1) : '';
                    resolve({ name: f.name, size: f.size, type: f.type || 'application/octet-stream', base64 });
                };
                reader.onerror = () => reject(reader.error || new Error('read failed'));
                reader.readAsDataURL(f);
            }));
        }

        // Reset the input so the same file can be re-selected after removal
        ev.target.value = '';

        Promise.all(promises).then(list => {
            _replyAttachments.push(...list);
            renderReplyAttachments();
            if (errs.length) {
                const el = document.getElementById('replyModalError');
                el.textContent = errs.join(' · ');
                el.style.display = 'block';
            }
        }).catch(err => {
            const el = document.getElementById('replyModalError');
            el.textContent = 'Attachment read failed: ' + (err.message || err);
            el.style.display = 'block';
        });
    }

    function removeReplyAttachment(idx) {
        _replyAttachments.splice(idx, 1);
        renderReplyAttachments();
    }

    function renderReplyAttachments() {
        const list = document.getElementById('replyAttachList');
        const summary = document.getElementById('replyAttachSummary');
        if (!list || !summary) return;
        if (_replyAttachments.length === 0) {
            list.innerHTML = '';
            summary.textContent = 'No files attached';
            return;
        }
        const total = _replyAttachments.reduce((n, a) => n + a.size, 0);
        summary.textContent = `${_replyAttachments.length} file${_replyAttachments.length === 1 ? '' : 's'} · ${(total/1024/1024).toFixed(2)} MB`;
        list.innerHTML = _replyAttachments.map((a, i) => `
            <div class="reply-attach-item">
                <span class="reply-attach-name" title="${esc(a.name)}">${esc(a.name)}</span>
                <span class="reply-attach-size">${(a.size/1024).toFixed(0)} KB</span>
                <button class="reply-attach-remove" onclick="removeReplyAttachment(${i})" title="Remove">&times;</button>
            </div>
        `).join('');
    }

    async function submitReply() {
        if (!_replyCtx) return;
        const btn = document.getElementById('replySendBtn');
        const errEl = document.getElementById('replyModalError');
        errEl.style.display = 'none';

        const subject = document.getElementById('replySubject').value.trim();
        const toEmail = _replyCtx._toEmailPure;
        if (!toEmail) {
            errEl.textContent = 'Recipient email is missing.';
            errEl.style.display = 'block';
            return;
        }

        // Extract both HTML and plain text from TinyMCE. Backend sends as
        // multipart/alternative so recipient clients that can't render HTML
        // still see something readable.
        const bodyHtml = getReplyHtml();
        const bodyText = getReplyText();
        if (!bodyText) {
            errEl.textContent = 'Message body is required.';
            errEl.style.display = 'block';
            return;
        }

        // Stitch quoted original so recipients have context in clients that
        // don't collapse threads. We add to the HTML via <blockquote>, and to
        // the text body with the classic "> " prefix.
        let finalHtml = bodyHtml;
        let finalText = bodyText;
        if (_replyCtx.replySnippet) {
            const who = _replyCtx._toName
                ? `${_replyCtx._toName} &lt;${esc(_replyCtx._toEmailPure)}&gt;`
                : esc(_replyCtx._toEmailPure);
            const snippetEscHtml = esc(_replyCtx.replySnippet).replace(/\n/g, '<br>');
            finalHtml += `<br><hr><p style="color:#6b7280;font-size:0.9em;">On earlier reply, ${who} wrote:</p><blockquote style="border-left:3px solid #e5e7eb;padding-left:10px;color:#6b7280;">${snippetEscHtml}</blockquote>`;
            const quoteTxt = String(_replyCtx.replySnippet).replace(/\n/g, '\n> ');
            finalText += `\n\n-----\n> ${quoteTxt}`;
        }

        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
            const leadId = window._leadDetailId;
            const attachments = _replyAttachments.map(a => ({
                file_name: a.name,
                mime_type: a.type || 'application/octet-stream',
                content_base64: a.base64
            }));
            await api.request(`/mailbox-send/${_replyCtx.mailboxId}/send`, {
                method: 'POST',
                body: JSON.stringify({
                    to_email: toEmail,
                    to_name: _replyCtx._toName || undefined,
                    subject: subject || 'Re:',
                    body_html: finalHtml,
                    body_text: finalText,
                    in_reply_to: _replyCtx.inReplyTo || undefined,
                    lead_id: leadId || undefined,
                    attachments: attachments.length ? attachments : undefined,
                }),
            });
            Toast.success('Reply sent');
            closeReplyModal();
            if (leadId) openLeadDetailPanel(leadId); // refresh timeline
        } catch (e) {
            errEl.textContent = (e && e.message) ? e.message : 'Send failed';
            errEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Send';
        }
    }

    // ─── New Email Composer (lead detail panel) ──────────────────────────
    //
    // Reuses the reply modal's TinyMCE editor (ensureReplyTmce) but lives
    // in a separate gm-overlay so the two flows can co-exist (e.g. the rep
    // could be replying to one thread and decide to start a fresh email to
    // a different lead). Send target: /mailbox-send/{mailboxId}/send — same
    // backend endpoint that handles replies, just without in_reply_to.

    let _composeMailboxes = [];
    let _composeLeadId = null;
    let _composeAttachments = [];
    const COMPOSE_LEAD_TMCE_ID = 'composeLeadBodyEditor';
    let _composeLeadTmceReady = null;

    function ensureComposeLeadTmce() {
        if (_composeLeadTmceReady) return _composeLeadTmceReady;
        if (typeof tinymce === 'undefined') return Promise.resolve(null);
        _composeLeadTmceReady = tinymce.init({
            selector: '#' + COMPOSE_LEAD_TMCE_ID,
            license_key: 'gpl',
            height: 320,
            menubar: false, promotion: false, branding: false, statusbar: false,
            plugins: 'lists link image table code preview anchor autolink',
            toolbar: 'blocks | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright | bullist numlist | link image table | code preview',
            toolbar_mode: 'wrap',
            valid_elements: '*[*]', extended_valid_elements: '*[*]',
            paste_remove_styles: false, paste_remove_styles_if_webkit: false,
            paste_webkit_styles: 'all', paste_data_images: true, paste_as_text: false,
            keep_styles: true, forced_root_block: 'p', element_format: 'html',
            verify_html: false, cleanup: false, convert_urls: false, entity_encoding: 'raw',
            content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
            placeholder: 'Write your message…',
            setup: function (editor) {
                editor.on('init', function () {
                    const modalBody = document.querySelector('#composeEmailModal .reply-modal-body');
                    if (!modalBody) return;
                    modalBody.addEventListener('scroll', function () {
                        document.querySelectorAll('.tox-tinymce-aux .tox-pop, .tox-tinymce-aux .tox-menu, .tox-tinymce-aux .tox-collection')
                            .forEach(function (el) { el.style.display = 'none'; });
                    }, { passive: true });
                });
            }
        }).then(eds => (eds && eds[0]) || tinymce.get(COMPOSE_LEAD_TMCE_ID));
        return _composeLeadTmceReady;
    }
    function getComposeLeadHtml() {
        const ed = (typeof tinymce !== 'undefined') ? tinymce.get(COMPOSE_LEAD_TMCE_ID) : null;
        return ed ? (ed.getContent() || '') : '';
    }
    function getComposeLeadText() {
        const ed = (typeof tinymce !== 'undefined') ? tinymce.get(COMPOSE_LEAD_TMCE_ID) : null;
        if (!ed) return '';
        return (ed.getContent({ format: 'text' }) || '').trim();
    }

    async function openComposeForLead(leadId) {
        if (!leadId) return;
        const leadEmail = window._leadDetailEmail || '';
        const leadName  = window._leadDetailName  || '';
        if (!leadEmail) {
            Toast.error('This lead has no email on file.');
            return;
        }

        // Use the configured-mailbox list cached by leads.js
        // (loadTenantMailboxFlag). Fresh-fetch fallback for deep links.
        let mailboxes = [];
        if (Array.isArray(window._tenantConfiguredMailboxes) &&
            window._tenantConfiguredMailboxes.length > 0) {
            mailboxes = window._tenantConfiguredMailboxes
                .filter(m => m && m.id && m.is_active !== false);
        } else {
            try {
                const [defResp, attResp] = await Promise.all([
                    api.request('/crm/mailbox-attachments/tenant-default').catch(() => ({})),
                    api.request('/crm/mailbox-attachments/attachments').catch(() => ({})),
                ]);
                const seen = new Set();
                const def = defResp?.mailbox;
                if (def && def.id && def.is_active !== false) {
                    mailboxes.push({ id: def.id, email_address: def.email_address });
                    seen.add(def.id);
                }
                for (const a of (attResp?.attachments || [])) {
                    const id = a.mailbox_id || a.id;
                    if (!id || seen.has(id)) continue;
                    if (a.mailbox_is_active === false) continue;
                    mailboxes.push({ id, email_address: a.mailbox_email || a.email_address });
                    seen.add(id);
                }
            } catch (e) {
                console.error(e);
                Toast.error('Failed to load mailboxes.');
                return;
            }
        }
        if (mailboxes.length === 0) {
            Toast.error('No mailbox configured. Open Settings → Mailboxes to add one.');
            return;
        }

        if (typeof window.EmailComposer === 'undefined') {
            Toast.error('Email composer not loaded — refresh and retry.');
            return;
        }

        window.EmailComposer.open({
            title: 'New Email',
            fromMailboxes: mailboxes.map(m => ({ id: m.id, email: m.email_address })),
            selectedFromId: mailboxes[0].id,
            to: leadName ? `${leadName} <${leadEmail}>` : leadEmail,
            subject: '',
            initialBodyHtml: '',
            leadId,
            onSend: async (payload) => {
                const attachments = (payload.attachments || []).map(a => ({
                    file_name: a.name,
                    mime_type: a.type || 'application/octet-stream',
                    content_base64: a.base64
                }));
                // Backend expects cc/bcc as [{email, name}] objects, not
                // bare strings. Wrap each chip into the EmailAddressDto shape.
                const wrap = arr => (arr || []).map(e => ({ email: e, name: null }));
                await api.request(`/mailbox-send/${payload.fromId}/send`, {
                    method: 'POST',
                    body: JSON.stringify({
                        to_email: payload.to,
                        to_name: payload.toName || undefined,
                        cc: payload.cc && payload.cc.length ? wrap(payload.cc) : undefined,
                        bcc: payload.bcc && payload.bcc.length ? wrap(payload.bcc) : undefined,
                        subject: payload.subject,
                        body_html: payload.html,
                        body_text: payload.text,
                        lead_id: payload.leadId || undefined,
                        attachments: attachments.length ? attachments : undefined,
                    }),
                });
                Toast.success('Email sent');
                if (payload.leadId) openLeadDetailPanel(payload.leadId);  // refresh timeline
            }
        });
    }

    function closeComposeModal() {
        const modal = document.getElementById('composeEmailModal');
        if (modal) modal.classList.remove('active');
        _composeLeadId = null;
        _composeAttachments = [];
    }

    function buildComposeModal() {
        const overlay = document.createElement('div');
        overlay.id = 'composeEmailModal';
        overlay.className = 'gm-overlay';
        overlay.innerHTML = `
            <div class="gm-modal reply-modal">
                <div class="gm-header">
                    <h3 style="font-size:1rem;font-weight:600;">New Email</h3>
                    <button class="gm-close" onclick="closeComposeModal()">&times;</button>
                </div>
                <div class="gm-body reply-modal-body">
                    <div class="crm-alert crm-alert-error" id="composeModalError" style="display:none;"></div>
                    <div class="crm-form-group">
                        <label for="composeFromMailbox">From</label>
                        <select class="form-control" id="composeFromMailbox"></select>
                    </div>
                    <div class="crm-form-group">
                        <label for="composeToEmail">To</label>
                        <input type="text" class="form-control" id="composeToEmail">
                    </div>
                    <div class="crm-form-group">
                        <label for="composeSubjectInput">Subject</label>
                        <input type="text" class="form-control" id="composeSubjectInput" placeholder="">
                    </div>
                    <div class="crm-form-group reply-editor">
                        <label>Message</label>
                        <textarea id="composeLeadBodyEditor"></textarea>
                    </div>
                    <div class="crm-form-group">
                        <label>Attachments <span class="reply-attach-hint">(max 20 files, 10 MB each, 20 MB total)</span></label>
                        <div class="reply-attach-row">
                            <label class="btn btn-sm btn-secondary reply-attach-btn">
                                <input type="file" id="composeAttachInput" multiple style="display:none;" onchange="onComposeAttachChange(event)">
                                + Add files
                            </label>
                            <span id="composeAttachSummary" class="reply-attach-summary"></span>
                        </div>
                        <div id="composeAttachList" class="reply-attach-list"></div>
                    </div>
                </div>
                <div class="gm-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeComposeModal()">Cancel</button>
                    <button type="button" class="btn btn-primary" id="composeSendBtn" onclick="submitCompose()">Send</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }

    function renderComposeAttachments() {
        const list = document.getElementById('composeAttachList');
        const summary = document.getElementById('composeAttachSummary');
        if (!list || !summary) return;
        list.innerHTML = '';
        if (_composeAttachments.length === 0) {
            summary.textContent = 'No files attached';
            return;
        }
        const totalKb = _composeAttachments.reduce((n, a) => n + a.size, 0) / 1024;
        summary.textContent = `${_composeAttachments.length} file(s), ${totalKb.toFixed(1)} KB total`;
        _composeAttachments.forEach((a, i) => {
            const item = document.createElement('div');
            item.className = 'reply-attach-item';
            item.innerHTML = `
                <span class="reply-attach-name">${esc(a.name)}</span>
                <span class="reply-attach-size">${(a.size/1024).toFixed(1)} KB</span>
                <button type="button" class="btn btn-sm btn-secondary" onclick="removeComposeAttachment(${i})">×</button>`;
            list.appendChild(item);
        });
    }

    function onComposeAttachChange(ev) {
        const files = Array.from(ev.target.files || []);
        const promises = files.map(f => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
                name: f.name, size: f.size, type: f.type || 'application/octet-stream',
                base64: String(reader.result).split(',')[1] || ''
            });
            reader.onerror = reject;
            reader.readAsDataURL(f);
        }));
        Promise.all(promises).then(items => {
            _composeAttachments = _composeAttachments.concat(items);
            renderComposeAttachments();
        }).catch(e => Toast.error('Failed to read file: ' + (e.message || e)));
        ev.target.value = '';
    }

    function removeComposeAttachment(i) {
        _composeAttachments.splice(i, 1);
        renderComposeAttachments();
    }

    async function submitCompose() {
        const btn = document.getElementById('composeSendBtn');
        const errEl = document.getElementById('composeModalError');
        errEl.style.display = 'none';

        const mailboxId = document.getElementById('composeFromMailbox').value;
        if (!mailboxId) { errEl.textContent = 'Select a sending mailbox.'; errEl.style.display = 'block'; return; }

        const toRaw = document.getElementById('composeToEmail').value.trim();
        const parsed = parseEmailAddress(toRaw);
        if (!parsed.email) { errEl.textContent = 'Recipient email is required.'; errEl.style.display = 'block'; return; }

        const subject = document.getElementById('composeSubjectInput').value.trim();
        if (!subject) { errEl.textContent = 'Subject is required.'; errEl.style.display = 'block'; return; }

        const bodyHtml = getComposeLeadHtml();
        const bodyText = getComposeLeadText();
        if (!bodyText) { errEl.textContent = 'Message body is required.'; errEl.style.display = 'block'; return; }

        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
            const attachments = _composeAttachments.map(a => ({
                file_name: a.name,
                mime_type: a.type || 'application/octet-stream',
                content_base64: a.base64
            }));
            await api.request(`/mailbox-send/${mailboxId}/send`, {
                method: 'POST',
                body: JSON.stringify({
                    to_email: parsed.email,
                    to_name: parsed.name || undefined,
                    subject,
                    body_html: bodyHtml,
                    body_text: bodyText,
                    lead_id: _composeLeadId || undefined,
                    attachments: attachments.length ? attachments : undefined,
                }),
            });
            Toast.success('Email sent');
            const lid = _composeLeadId;
            closeComposeModal();
            if (lid) openLeadDetailPanel(lid);  // refresh timeline
        } catch (e) {
            errEl.textContent = (e && e.message) ? e.message : 'Send failed';
            errEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Send';
        }
    }

    // ─── Help Request ─────────────────────────────────────────────────────

    let _helpLeadId = null;
    let _helpResolveId = null;

    async function openHelpRequestModal(leadId) {
        _helpLeadId = leadId;
        document.getElementById('helpReasonInput').value = '';
        const sel = document.getElementById('helpRecipientSelect');
        sel.innerHTML = '<option value="">Loading…</option>';
        const hint = document.getElementById('helpRecipientHint');
        hint.textContent = '';

        document.getElementById('helpRequestOverlay').classList.add('active');

        try {
            const list = await api.request(`/crm/leads/${leadId}/help-requests/eligible-recipients`);
            if (!Array.isArray(list) || list.length === 0) {
                sel.innerHTML = '<option value="">No manager or team lead available</option>';
                hint.textContent = "This team has no manager or team lead — there's no one to escalate to. Ask an admin to assign one.";
                document.getElementById('helpRequestSubmitBtn').disabled = true;
                return;
            }
            const labelFor = r => `${esc(r.name)} — ${r.role === 'manager' ? 'Manager' : 'Team Lead'}`;
            sel.innerHTML = '<option value="">Select recipient…</option>' +
                list.map(r => `<option value="${esc(r.user_id)}">${labelFor(r)}</option>`).join('');
            document.getElementById('helpRequestSubmitBtn').disabled = false;
        } catch (e) {
            sel.innerHTML = '<option value="">Failed to load</option>';
            hint.textContent = e?.message || 'Could not load recipients.';
        }
    }

    function closeHelpRequestModal() {
        document.getElementById('helpRequestOverlay').classList.remove('active');
        _helpLeadId = null;
    }

    async function submitHelpRequest() {
        if (!_helpLeadId) return;
        const recipient = document.getElementById('helpRecipientSelect').value;
        const reason = document.getElementById('helpReasonInput').value.trim();
        if (!recipient) { Toast.error('Pick a recipient'); return; }
        if (!reason) { Toast.error('A short reason is required'); return; }

        const btn = document.getElementById('helpRequestSubmitBtn');
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
            await api.request(`/crm/leads/${_helpLeadId}/help-requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipient_user_id: recipient, reason })
            });
            Toast.success('Help request sent');
            const wasOpen = window._leadDetailId === _helpLeadId;
            const lid = _helpLeadId;
            closeHelpRequestModal();
            if (wasOpen && typeof openLeadDetailPanel === 'function') openLeadDetailPanel(lid);
        } catch (e) {
            Toast.error(e?.message || 'Failed to send help request');
        } finally {
            btn.disabled = false; btn.textContent = 'Send help request';
        }
    }

    // ─── Help Inbox (recipient view) ──────────────────────────────────────

    // Which side of the feature the modal is showing: 'inbox' = requests for
    // me to answer, 'mine' = requests I raised and am waiting on.
    let _helpTab = 'inbox';

    async function openHelpInboxModal() {
        document.getElementById('helpInboxOverlay').classList.add('active');
        await loadHelpTab(_helpTab);
    }

    async function switchHelpTab(tab) {
        _helpTab = tab;
        document.querySelectorAll('.help-tab').forEach(b =>
            b.classList.toggle('active', b.getAttribute('data-help-tab') === tab));
        const sub = document.getElementById('helpInboxSubtitle');
        if (sub) {
            sub.textContent = tab === 'mine'
                ? "Requests you raised that nobody has answered yet. Cancel one if it is no longer needed."
                : "Teammates waiting on a decision or input. Click into a lead to read the full timeline; resolve here when you're done.";
        }
        await loadHelpTab(tab);
    }

    async function loadHelpTab(tab) {
        const list = document.getElementById('helpInboxList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Loading…</p>';
        const url = tab === 'mine'
            ? '/crm/leads/help-requests/raised-by-me'
            : '/crm/leads/help-requests/inbox';
        try {
            const reqs = await api.request(url);
            // A slow tab must not paint over one the user has since clicked.
            if (_helpTab !== tab) return;
            if (tab === 'mine') renderHelpRaisedByMe(reqs || []);
            else renderHelpInbox(reqs || []);
        } catch (e) {
            if (_helpTab !== tab) return;
            list.innerHTML = `<p style="color:var(--color-error);">${esc(e?.message || 'Failed to load')}</p>`;
        }
    }

    // Requester's view. Deliberately NOT resolvable from here — you do not
    // close your own request, the person you asked does. Cancel is the only
    // action that is yours.
    function renderHelpRaisedByMe(reqs) {
        const list = document.getElementById('helpInboxList');
        if (!reqs.length) {
            list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">' +
                'You have no open requests. Ask for help from a lead when you need a decision from someone else.</p>';
            return;
        }
        const fmtDate = ts => { try { return new Date(ts).toLocaleString(); } catch { return ''; } };
        list.innerHTML = reqs.map(r => `
            <div class="help-inbox-row" style="border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-card);">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <strong style="color:var(--text-primary);">${esc(r.lead_name || '(unnamed lead)')}</strong>
                            ${r.lead_number ? `<span style="font-size:11px;color:var(--text-secondary);">${esc(r.lead_number)}</span>` : ''}
                            <span style="font-size:11px;color:var(--text-secondary);">•</span>
                            <span style="font-size:12px;color:var(--text-secondary);">waiting on ${esc(r.recipient_name || r.recipient_user_id || 'teammate')}</span>
                        </div>
                        <div style="margin-top:6px;color:var(--text-primary);font-size:13px;white-space:pre-wrap;word-break:break-word;">${esc(r.reason)}</div>
                        <div style="margin-top:6px;font-size:11px;color:var(--text-secondary);">Asked ${fmtDate(r.created_at)}${r.team_name ? ` · team ${esc(r.team_name)}` : ''}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        <button class="btn btn-sm btn-outline-primary" onclick="openLeadDetailPanel('${escJsAttr(r.lead_id)}'); closeHelpInboxModal();">Open lead</button>
                        <!-- btn-outline-danger, not btn-outline: this page loads
                             Bootstrap, which defines the -danger/-primary
                             variants but has no bare .btn-outline, so that
                             class renders as an unstyled empty box. -->
                        <button class="btn btn-sm btn-outline-danger" onclick="cancelHelpRequestFromInbox('${escJsAttr(r.id)}')">Cancel</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async function cancelHelpRequestFromInbox(id) {
        const ok = await showConfirm(
            'Cancel this help request? The person you asked will stop seeing it.',
            'Cancel request', 'danger');
        if (!ok) return;
        try {
            await api.request(`/crm/leads/help-requests/${id}/cancel`, { method: 'POST' });
            Toast.success('Request cancelled');
            await loadHelpTab('mine');
        } catch (e) {
            Toast.error(e?.message || 'Could not cancel the request');
        }
    }

    function closeHelpInboxModal() {
        document.getElementById('helpInboxOverlay').classList.remove('active');
    }

    function renderHelpInbox(reqs) {
        const list = document.getElementById('helpInboxList');
        if (reqs.length === 0) {
            list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No open help requests. 🎉</p>';
            // Banner can drop too — there's nothing left.
            const banner = document.getElementById('helpInboxBanner');
            if (banner) banner.hidden = true;
            return;
        }
        const fmtDate = ts => {
            try { return new Date(ts).toLocaleString(); } catch { return ''; }
        };
        list.innerHTML = reqs.map(r => `
            <div class="help-inbox-row" style="border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-card);">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <strong style="color:var(--text-primary);">${esc(r.lead_name || '(unnamed lead)')}</strong>
                            ${r.lead_number ? `<span style="font-size:11px;color:var(--text-secondary);">${esc(r.lead_number)}</span>` : ''}
                            <span style="font-size:11px;color:var(--text-secondary);">•</span>
                            <span style="font-size:12px;color:var(--text-secondary);">from ${esc(r.requester_name || r.requester_user_id || 'teammate')}</span>
                        </div>
                        <div style="margin-top:6px;color:var(--text-primary);font-size:13px;white-space:pre-wrap;word-break:break-word;">${esc(r.reason)}</div>
                        <div style="margin-top:6px;font-size:11px;color:var(--text-secondary);">${fmtDate(r.created_at)} · team ${esc(r.team_name || '')}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        <button class="btn btn-sm btn-outline-primary" onclick="openLeadDetailPanel('${escJsAttr(r.lead_id)}'); closeHelpInboxModal();">Open lead</button>
                        <button class="btn btn-sm btn-primary" onclick="openHelpResolveModal('${escJsAttr(r.id)}', '${escJsAttr(r.lead_name || '')}')">Resolve</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    function openHelpResolveModal(id, leadName) {
        _helpResolveId = id;
        document.getElementById('helpResolveComment').value = '';
        if (leadName) {
            document.getElementById('helpResolveSubtitle').textContent =
                `Lead: ${leadName}. Add a comment so the requester knows what you decided.`;
        }
        document.getElementById('helpResolveOverlay').classList.add('active');
    }

    function closeHelpResolveModal() {
        document.getElementById('helpResolveOverlay').classList.remove('active');
        _helpResolveId = null;
    }

    async function submitHelpResolve() {
        if (!_helpResolveId) return;
        const comment = document.getElementById('helpResolveComment').value.trim();
        if (!comment) { Toast.error('A short comment is required'); return; }
        const btn = document.getElementById('helpResolveSubmitBtn');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            await api.request(`/crm/leads/help-requests/${_helpResolveId}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolution_comment: comment })
            });
            Toast.success('Marked resolved');
            closeHelpResolveModal();
            // Re-load inbox so the resolved row drops out + banner re-counts.
            await refreshHelpInboxBanner();
            if (document.getElementById('helpInboxOverlay')?.classList.contains('active')) {
                openHelpInboxModal();
            }
        } catch (e) {
            Toast.error(e?.message || 'Failed to resolve');
        } finally {
            btn.disabled = false; btn.textContent = 'Mark resolved';
        }
    }

    // ─── Inbox banner — polled once on load + driven live by SignalR ───────

    async function refreshHelpInboxBanner() {
        const banner = document.getElementById('helpInboxBanner');
        const text = document.getElementById('helpInboxBannerText');
        if (!banner || !text) return;
        try {
            const reqs = await api.request('/crm/leads/help-requests/inbox');
            const n = (reqs || []).length;
            if (n === 0) { banner.hidden = true; return; }
            text.textContent = n === 1 ? '1 help request waiting for you' : `${n} help requests waiting for you`;
            banner.hidden = false;
        } catch {
            // Silent — non-critical, banner just won't show.
        }
    }

    // ─── Expose to window ───────────────────────────────────────────────

    window.openLeadDetailPanel = openLeadDetailPanel;
    window.closeLeadDetailPanel = closeLeadDetailPanel;
    window.filterTimeline = filterTimeline;
    window.printLeadTimeline = printLeadTimeline;
    window.openScheduleFollowupModal = openScheduleFollowupModal;
    window.closeScheduleFollowupModal = closeScheduleFollowupModal;
    window.submitScheduleFollowup = submitScheduleFollowup;
    window.openTransferRequestModal = openTransferRequestModal;
    window.closeTransferRequestModal = closeTransferRequestModal;
    window.submitTransferRequest = submitTransferRequest;
    window.openPendingTransfersModal = openPendingTransfersModal;
    window.closePendingTransfersModal = closePendingTransfersModal;
    window.approveTransfer = approveTransfer;
    window.rejectTransfer = rejectTransfer;
    window.openStatusChangeModal = openStatusChangeModal;
    window.selectStatusOption = selectStatusOption;
    window.confirmStatusChange = confirmStatusChange;
    window.closeStatusChangeModal = closeStatusChangeModal;
    window.openLogActivityModal = openLogActivityModal;
    window.closeLogActivityModal = closeLogActivityModal;
    window.submitLogActivity = submitLogActivity;
    window.openReplyModalFromBtn = openReplyModalFromBtn;
    // Exported so calls.js (and any other timeline surface that
    // renders call rows directly from /api/calls/for-lead) can
    // reuse the same audio + transcript + summary rendering as the
    // lead-journey activity timeline. Single source of truth for
    // the call-extras DOM shape.
    window.renderCallExtras = renderCallExtras;
    window.renderCallSummary = renderCallSummary;
    window.seekCallAudio = seekCallAudioImpl;
    window.openReplyModal = openReplyModal;
    window.closeReplyModal = closeReplyModal;
    window.submitReply = submitReply;
    window.onReplyAttachChange = onReplyAttachChange;
    window.removeReplyAttachment = removeReplyAttachment;
    window.openComposeForLead = openComposeForLead;
    window.closeComposeModal = closeComposeModal;
    window.submitCompose = submitCompose;
    window.onComposeAttachChange = onComposeAttachChange;
    window.removeComposeAttachment = removeComposeAttachment;
    window.openHelpRequestModal = openHelpRequestModal;
    window.closeHelpRequestModal = closeHelpRequestModal;
    window.submitHelpRequest = submitHelpRequest;
    window.openHelpInboxModal = openHelpInboxModal;
    window.closeHelpInboxModal = closeHelpInboxModal;
    window.switchHelpTab = switchHelpTab;
    window.cancelHelpRequestFromInbox = cancelHelpRequestFromInbox;
    window.openHelpResolveModal = openHelpResolveModal;
    window.closeHelpResolveModal = closeHelpResolveModal;
    window.submitHelpResolve = submitHelpResolve;
    window.refreshHelpInboxBanner = refreshHelpInboxBanner;
    window.cancelMyHelpRequest = cancelMyHelpRequest;
    window.refreshHelpButtonForLead = refreshHelpButtonForLead;
})();
