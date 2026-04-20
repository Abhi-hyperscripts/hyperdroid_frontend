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
        document.getElementById('statusChangeConfirmBtn').disabled = false;

        // Show/hide lost reason
        document.getElementById('lostReasonSection').style.display = status === 'lost' ? '' : 'none';
        document.getElementById('wonValueSection').style.display = status === 'won' ? '' : 'none';

        // Lost reason custom field toggle
        const lostSelect = document.getElementById('lostReasonSelect');
        lostSelect.onchange = function () {
            document.getElementById('lostReasonCustom').style.display =
                this.value === 'Other' ? '' : 'none';
        };
    }

    async function confirmStatusChange() {
        if (!_statusChangeLeadId || !_statusChangeSelected) return;

        const body = { status: _statusChangeSelected };

        if (_statusChangeSelected === 'lost') {
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

    function openLogActivityModal(leadId) {
        _logActivityLeadId = leadId;
        document.getElementById('activityType').value = 'call';
        document.getElementById('activityOutcome').value = '';
        document.getElementById('activitySummary').value = '';
        document.getElementById('activityDisposition').value = '';
        document.getElementById('activityNextFollowup').value = '';
        document.getElementById('activityCallDuration').value = '';
        document.getElementById('logActivityOverlay').classList.add('active');
    }

    function closeLogActivityModal() {
        document.getElementById('logActivityOverlay').classList.remove('active');
        _logActivityLeadId = null;
    }

    async function submitLogActivity() {
        if (!_logActivityLeadId) return;

        const summary = document.getElementById('activitySummary').value.trim();
        if (!summary) { Toast.error('Summary is required'); return; }

        const actType = document.getElementById('activityType').value;
        const outcome = document.getElementById('activityOutcome').value;
        const disposition = document.getElementById('activityDisposition').value;
        const nextFollowup = document.getElementById('activityNextFollowup').value;
        const callDuration = document.getElementById('activityCallDuration').value;

        try {
            // 1. Log the activity
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
                    call_duration_seconds: callDuration ? parseInt(callDuration) * 60 : undefined,
                    next_action: nextFollowup ? 'Follow up' : undefined,
                    next_action_date: nextFollowup ? new Date(nextFollowup).toISOString() : undefined
                })
            });

            // 2. Update disposition if set
            if (disposition) {
                await api.request(`/crm/leads/${_logActivityLeadId}/disposition`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ disposition: disposition, notes: summary })
                });
            }

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

            // Parse custom fields
            let customFieldsHtml = '';
            try {
                const cf = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields || '{}') : (lead.custom_fields || {});
                for (const [k, v] of Object.entries(cf)) {
                    if (v) customFieldsHtml += `<div class="lead-detail-item"><span class="lead-detail-label">${esc(k.replace(/_/g, ' '))}</span><span>${esc(v)}</span></div>`;
                }
            } catch {}

            document.getElementById('leadDetailInfo').innerHTML = `
                <div class="lead-detail-grid">
                    ${lead.lead_number ? `<div class="lead-detail-item"><span class="lead-detail-label">Lead ID</span><span class="crm-lead-number">${esc(lead.lead_number)}</span></div>` : ''}
                    ${lead.email ? `<div class="lead-detail-item"><span class="lead-detail-label">Email</span><span>${esc(lead.email)}</span></div>` : ''}
                    ${lead.phone ? `<div class="lead-detail-item"><span class="lead-detail-label">Phone</span><span>${esc(lead.phone)}</span></div>` : ''}
                    ${lead.alternate_phone ? `<div class="lead-detail-item"><span class="lead-detail-label">Alt. Phone</span><span>${esc(lead.alternate_phone)}</span></div>` : ''}
                    ${lead.company_name ? `<div class="lead-detail-item"><span class="lead-detail-label">Company</span><span>${esc(lead.company_name)}</span></div>` : ''}
                    ${lead.job_title ? `<div class="lead-detail-item"><span class="lead-detail-label">Job Title</span><span>${esc(lead.job_title)}</span></div>` : ''}
                    ${lead.lead_source ? `<div class="lead-detail-item"><span class="lead-detail-label">Source</span><span>${esc(lead.lead_source)}</span></div>` : ''}
                    <div class="lead-detail-item"><span class="lead-detail-label">Status</span><span class="crm-status-badge status-${lead.status}" style="width:fit-content">${formatStatus(lead.status)}</span></div>
                    ${lead.disposition ? `<div class="lead-detail-item"><span class="lead-detail-label">Disposition</span><span class="crm-disposition-badge disp-${lead.disposition}" style="width:fit-content">${formatDisposition(lead.disposition)}</span></div>` : ''}
                    ${lead.city ? `<div class="lead-detail-item"><span class="lead-detail-label">City</span><span>${esc(lead.city)}</span></div>` : ''}
                    ${lead.state ? `<div class="lead-detail-item"><span class="lead-detail-label">State</span><span>${esc(lead.state)}</span></div>` : ''}
                    ${lead.country ? `<div class="lead-detail-item"><span class="lead-detail-label">Country</span><span>${esc(lead.country)}</span></div>` : ''}
                    ${lead.address ? `<div class="lead-detail-item"><span class="lead-detail-label">Address</span><span>${esc(lead.address)}</span></div>` : ''}
                    ${lead.pincode ? `<div class="lead-detail-item"><span class="lead-detail-label">Pincode</span><span>${esc(lead.pincode)}</span></div>` : ''}
                    ${lead.website ? `<div class="lead-detail-item"><span class="lead-detail-label">Website</span><span>${esc(lead.website)}</span></div>` : ''}
                    ${lead.product_interest ? `<div class="lead-detail-item"><span class="lead-detail-label">Interest</span><span>${esc(lead.product_interest)}</span></div>` : ''}
                    ${lead.estimated_value ? `<div class="lead-detail-item"><span class="lead-detail-label">Est. Value</span><span>₹${Number(lead.estimated_value).toLocaleString()}</span></div>` : ''}
                    ${lead.campaign_name ? `<div class="lead-detail-item"><span class="lead-detail-label">Campaign</span><span>${esc(lead.campaign_name)}</span></div>` : ''}
                    ${lead.team_name ? `<div class="lead-detail-item"><span class="lead-detail-label">Team</span><span class="crm-team-badge">${esc(lead.team_name)}</span></div>` : ''}
                    ${lead.owner_name ? `<div class="lead-detail-item"><span class="lead-detail-label">Owner</span><span>${esc(lead.owner_name)}</span></div>` : ''}
                    ${lead.notes ? `<div class="lead-detail-item" style="grid-column:1/-1"><span class="lead-detail-label">Notes</span><span>${esc(lead.notes)}</span></div>` : ''}
                    ${customFieldsHtml}
                    ${lead.lost_reason ? `<div class="lead-detail-item"><span class="lead-detail-label">Lost Reason</span><span style="color:var(--color-error);">${esc(lead.lost_reason)}</span></div>` : ''}
                    ${lead.next_followup_date ? `<div class="lead-detail-item"><span class="lead-detail-label">Next Follow-up</span><span>${new Date(lead.next_followup_date).toLocaleDateString()}</span></div>` : ''}
                    ${lead.first_contact_date ? `<div class="lead-detail-item"><span class="lead-detail-label">First Contact</span><span>${new Date(lead.first_contact_date).toLocaleDateString()}</span></div>` : ''}
                    ${lead.last_interaction_at ? `<div class="lead-detail-item"><span class="lead-detail-label">Last Interaction</span><span>${new Date(lead.last_interaction_at).toLocaleDateString()}</span></div>` : ''}
                    ${lead.followup_count > 0 ? `<div class="lead-detail-item"><span class="lead-detail-label">Follow-ups</span><span>${lead.followup_count}</span></div>` : ''}
                    ${lead.expected_closure_date ? `<div class="lead-detail-item"><span class="lead-detail-label">Expected Close</span><span>${new Date(lead.expected_closure_date).toLocaleDateString()}</span></div>` : ''}
                    ${lead.won_deal_value ? `<div class="lead-detail-item"><span class="lead-detail-label">Deal Value</span><span>₹${Number(lead.won_deal_value).toLocaleString()}</span></div>` : ''}
                    <div class="lead-detail-item"><span class="lead-detail-label">Created</span><span>${new Date(lead.created_at).toLocaleString()}</span></div>
                </div>
            `;

            // Load timeline
            const timeline = await api.request(`/crm/leads/${leadId}/timeline`);
            renderTimeline(timeline);
        } catch (e) {
            document.getElementById('leadTimeline').innerHTML = `<p style="color:var(--color-error);">${esc(e.message || 'Failed to load')}</p>`;
        }
    }

    function closeLeadDetailPanel() {
        document.getElementById('leadDetailOverlay').classList.remove('active');
        document.getElementById('leadDetailPanel').classList.remove('active');
        window._leadDetailId = null;
    }

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
                const payloadAttr = esc(JSON.stringify(payload));
                replyBtn = `<div class="tl-actions"><button class="btn btn-sm btn-outline-primary tl-reply-btn" data-reply='${payloadAttr}' onclick="openReplyModalFromBtn(this)">Reply</button></div>`;
            }

            return `
                <div class="tl-entry ${typeClass}">
                    <div class="tl-icon">${icon}</div>
                    <div class="tl-content">
                        <div class="tl-header">
                            <span class="tl-title">${esc(e.title)}</span>
                        </div>
                        ${detailChips}
                        ${desc}
                        ${replyBtn}
                        <div class="tl-meta">${whoLine ? `${whoLine} · ` : ''}${time}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

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
        return d.innerHTML;
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
        document.getElementById('followupDateTime').value = '';
        document.getElementById('followupNotes').value = '';
        document.getElementById('scheduleFollowupOverlay').classList.add('active');
    }

    function closeScheduleFollowupModal() {
        document.getElementById('scheduleFollowupOverlay').classList.remove('active');
        _followupLeadId = null;
    }

    async function submitScheduleFollowup() {
        if (!_followupLeadId) return;
        const dt = document.getElementById('followupDateTime').value;
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

    function openReplyModalFromBtn(btn) {
        try {
            const payload = JSON.parse(btn.getAttribute('data-reply'));
            openReplyModal(payload);
        } catch (e) {
            Toast.error('Failed to open reply composer');
        }
    }

    function openReplyModal(ctx) {
        _replyCtx = ctx;
        const modal = document.getElementById('replyEmailModal');
        if (!modal) {
            buildReplyModal();
        }
        const subj = ctx.subject && ctx.subject.toLowerCase().startsWith('re:')
            ? ctx.subject
            : (ctx.subject ? `Re: ${ctx.subject}` : '');
        document.getElementById('replyToEmail').value = ctx.toEmail || '';
        document.getElementById('replySubject').value = subj;
        document.getElementById('replyBody').value = '';
        const quote = ctx.replySnippet
            ? `\n\n-----\nOn earlier reply, ${ctx.toEmail} wrote:\n> ${ctx.replySnippet.replace(/\n/g, '\n> ')}`
            : '';
        document.getElementById('replyQuotedPreview').textContent = quote.trim();
        document.getElementById('replyEmailModal').classList.add('active');
        setTimeout(() => document.getElementById('replyBody').focus(), 50);
    }

    function closeReplyModal() {
        const modal = document.getElementById('replyEmailModal');
        if (modal) modal.classList.remove('active');
        _replyCtx = null;
    }

    function buildReplyModal() {
        // Reuse the glassmorphic-modal + gm-overlay style used across CRM
        // settings modals. Built lazily on first open so this file doesn't
        // inflate the HTML templates of every page that includes it.
        const overlay = document.createElement('div');
        overlay.id = 'replyEmailModal';
        overlay.className = 'gm-overlay';
        overlay.innerHTML = `
            <div class="gm-modal" style="max-width:640px;width:92vw;">
                <div class="gm-header">
                    <h3>Reply</h3>
                    <button class="gm-close" onclick="closeReplyModal()">&times;</button>
                </div>
                <div class="gm-body">
                    <div class="crm-alert crm-alert-error" id="replyModalError" style="display:none;"></div>
                    <div class="crm-form-group">
                        <label for="replyToEmail">To</label>
                        <input type="email" class="form-control" id="replyToEmail" readonly>
                    </div>
                    <div class="crm-form-group">
                        <label for="replySubject">Subject</label>
                        <input type="text" class="form-control" id="replySubject">
                    </div>
                    <div class="crm-form-group">
                        <label for="replyBody">Message</label>
                        <textarea class="form-control" id="replyBody" rows="8" placeholder="Type your reply…"></textarea>
                    </div>
                    <pre id="replyQuotedPreview" style="font-size:0.75rem;color:var(--text-secondary);white-space:pre-wrap;margin:0;max-height:120px;overflow:auto;"></pre>
                </div>
                <div class="gm-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeReplyModal()">Cancel</button>
                    <button type="button" class="btn btn-primary" id="replySendBtn" onclick="submitReply()">Send</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }

    async function submitReply() {
        if (!_replyCtx) return;
        const btn = document.getElementById('replySendBtn');
        const errEl = document.getElementById('replyModalError');
        errEl.style.display = 'none';

        const subject = document.getElementById('replySubject').value.trim();
        const body = document.getElementById('replyBody').value.trim();
        if (!body) {
            errEl.textContent = 'Message body is required.';
            errEl.style.display = 'block';
            return;
        }

        // Stitch the user's new message with a quoted snippet of the prior
        // reply so recipients can see context even in mail clients that
        // don't collapse threads.
        const quote = _replyCtx.replySnippet
            ? `\n\n-----\n> ${String(_replyCtx.replySnippet).replace(/\n/g, '\n> ')}`
            : '';

        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
            const leadId = window._leadDetailId;
            await api.request(`/mailbox-send/${_replyCtx.mailboxId}/send`, {
                method: 'POST',
                body: JSON.stringify({
                    to_email: _replyCtx.toEmail,
                    subject: subject || 'Re:',
                    body_text: body + quote,
                    in_reply_to: _replyCtx.inReplyTo || undefined,
                    lead_id: leadId || undefined,
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
    window.openReplyModal = openReplyModal;
    window.closeReplyModal = closeReplyModal;
    window.submitReply = submitReply;
})();
