/**
 * AI Assistant — Activity & Controls card (CRM Settings → Integrations).
 *
 * The control room for the WhatsApp AI auto-responder:
 *   - today's tenant-wide usage vs the daily ceiling
 *   - editable caps (per-contact + company-wide, stored in crm_settings)
 *   - per-thread conversation states with Pause / Resume
 *   - recent draft decisions (the learning-loop feed)
 *   - last-7-days escalation reasons (same data as the weekly digest push)
 */

(function () {
    'use strict';

    let aiOverview = null;

    async function loadAiAssistant() {
        try {
            aiOverview = await api.request('/crm/whatsapp/ai-overview');
            renderUsage();
            renderCaps();
            renderConversations();
            renderDraftsFeed();
            renderEscalations();
        } catch (err) {
            // Non-admins get 403 — hide the card rather than showing a broken one.
            if (err?.status === 403) {
                const card = document.getElementById('aiAssistantCard');
                if (card) card.style.display = 'none';
                return;
            }
            console.error('[ai-assistant] load failed:', err);
        }
    }

    function renderUsage() {
        const label = document.getElementById('aiUsageLabel');
        const bar = document.getElementById('aiUsageBar');
        if (!label || !bar || !aiOverview) return;
        const used = aiOverview.replies_today ?? 0;
        const cap = aiOverview.tenant_daily_cap ?? 300;
        const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
        label.textContent = `${used} of ${cap} (${pct}%)`;
        bar.style.width = `${pct}%`;
        bar.style.background = pct >= 90 ? 'var(--color-error, #dc2626)'
                            : pct >= 70 ? 'var(--color-warning, #d97706)'
                            : 'var(--brand-primary)';
    }

    function renderCaps() {
        const contact = document.getElementById('aiContactCapInput');
        const tenant = document.getElementById('aiTenantCapInput');
        const debounce = document.getElementById('aiDebounceInput');
        if (contact && aiOverview) contact.value = aiOverview.contact_daily_cap ?? 20;
        if (tenant && aiOverview) tenant.value = aiOverview.tenant_daily_cap ?? 300;
        if (debounce && aiOverview) debounce.value = aiOverview.debounce_seconds ?? 10;
    }

    async function saveAiCaps() {
        const contact = parseInt(document.getElementById('aiContactCapInput')?.value, 10);
        const tenant = parseInt(document.getElementById('aiTenantCapInput')?.value, 10);
        const debounce = parseInt(document.getElementById('aiDebounceInput')?.value, 10);
        if (!Number.isFinite(contact) || contact < 1 || !Number.isFinite(tenant) || tenant < 1) {
            if (typeof Toast !== 'undefined') Toast.error('Limits must be positive numbers');
            return;
        }
        if (!Number.isFinite(debounce) || debounce < 5 || debounce > 60) {
            if (typeof Toast !== 'undefined') Toast.error('Reply delay must be between 5 and 60 seconds');
            return;
        }
        try {
            await api.request('/crm/crm-settings/ai_reply_daily_cap', {
                method: 'PUT', body: JSON.stringify({ value: String(contact) })
            });
            await api.request('/crm/crm-settings/ai_reply_tenant_daily_cap', {
                method: 'PUT', body: JSON.stringify({ value: String(tenant) })
            });
            await api.request('/crm/crm-settings/ai_reply_debounce_seconds', {
                method: 'PUT', body: JSON.stringify({ value: String(debounce) })
            });
            if (typeof Toast !== 'undefined') Toast.success('AI limits saved');
            await loadAiAssistant();
        } catch (err) {
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to save limits');
        }
    }

    const STATUS_META = {
        active:           { label: 'Active',            cls: 'active' },
        paused_human:     { label: 'Paused — human',    cls: 'pending' },
        escalated:        { label: 'Escalated',         cls: 'pending' },
        stopped_lead:     { label: 'Became a lead',     cls: 'active' },
        stopped_cap:      { label: 'Daily cap',         cls: 'inactive' },
        stopped_offtopic: { label: 'Off-topic stop',    cls: 'inactive' },
    };

    function renderConversations() {
        const wrap = document.getElementById('aiConvosWrap');
        const empty = document.getElementById('aiConvosEmpty');
        const tbody = document.getElementById('aiConvosTableBody');
        if (!tbody || !aiOverview) return;
        const convos = aiOverview.conversations || [];
        if (convos.length === 0) {
            wrap.style.display = 'none';
            empty.style.display = '';
            return;
        }
        wrap.style.display = '';
        empty.style.display = 'none';
        // NOTE: the CRM API serializes with SnakeCaseLower — read snake_case keys.
        tbody.innerHTML = convos.map(c => {
            const meta = STATUS_META[c.status] || { label: c.status, cls: 'inactive' };
            const who = c.detected_name ? `${escapeHtml(c.detected_name)} · ${escapeHtml(c.customer_phone)}` : escapeHtml(c.customer_phone);
            const last = c.last_ai_reply_at || c.last_inbound_at;
            const lastLabel = last ? new Date(last).toLocaleString() : '—';
            const isActive = c.status === 'active';
            const reason = c.paused_reason ? ` data-tooltip="${escapeHtml(c.paused_reason)}"` : '';
            return `
                <tr>
                    <td>
                        <div style="font-weight:600;">${who}</div>
                        ${c.detected_interest ? `<div style="font-size:0.76rem; color:var(--text-secondary);">${escapeHtml(c.detected_interest)}</div>` : ''}
                    </td>
                    <td><span class="status-badge ${meta.cls}"${reason}><span class="status-dot"></span>${meta.label}</span></td>
                    <td>${c.ai_reply_count ?? 0}</td>
                    <td style="font-size:0.8rem;">${lastLabel}</td>
                    <td style="text-align:right;">
                        <button class="btn btn-outline" style="padding:2px 12px; font-size:0.78rem;"
                            onclick="${isActive ? 'pauseAiConversation' : 'resumeAiConversation'}('${escapeHtml(c.business_phone_number)}','${escapeHtml(c.customer_phone)}')">
                            ${isActive ? 'Pause AI' : 'Resume AI'}
                        </button>
                    </td>
                </tr>`;
        }).join('');
    }

    async function pauseAiConversation(businessPhone, customerPhone) {
        try {
            await api.request('/crm/whatsapp/ai-conversations/pause', {
                method: 'POST',
                body: JSON.stringify({ business_phone_number: businessPhone, customer_phone: customerPhone })
            });
            if (typeof Toast !== 'undefined') Toast.success('AI paused on this conversation');
            await loadAiAssistant();
        } catch (err) {
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to pause');
        }
    }

    async function resumeAiConversation(businessPhone, customerPhone) {
        try {
            await api.request('/crm/whatsapp/ai-conversations/resume', {
                method: 'POST',
                body: JSON.stringify({ business_phone_number: businessPhone, customer_phone: customerPhone })
            });
            if (typeof Toast !== 'undefined') Toast.success('AI resumed on this conversation');
            await loadAiAssistant();
        } catch (err) {
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to resume');
        }
    }

    const DRAFT_LABEL = {
        pending: '⏳ awaiting approval',
        approved: '✅ approved',
        rejected: '✖️ dismissed',
        expired: '⌛ expired',
        superseded: '↻ superseded',
    };

    function renderDraftsFeed() {
        const el = document.getElementById('aiDraftsFeed');
        if (!el || !aiOverview) return;
        const drafts = aiOverview.recent_drafts || [];
        if (drafts.length === 0) {
            el.textContent = 'No drafts yet — drafts appear when a number runs in Draft mode.';
            return;
        }
        el.innerHTML = drafts.slice(0, 8).map(d => {
            const label = d.edited ? '✏️ edited & sent' : (DRAFT_LABEL[d.status] || d.status);
            return `<div style="padding:6px 0; border-bottom:1px solid var(--border-color);">
                <span style="font-weight:600;">${label}</span>
                <span style="color:var(--text-secondary);"> · ${escapeHtml(d.customer_phone)}</span>
                <div style="margin-top:2px;">${escapeHtml(d.preview)}</div>
            </div>`;
        }).join('');
    }

    function renderEscalations() {
        const el = document.getElementById('aiEscalationsFeed');
        if (!el || !aiOverview) return;
        const reasons = aiOverview.escalation_reasons_7d || [];
        if (reasons.length === 0) {
            el.textContent = 'Nothing — the AI handled every conversation this week. 🎉';
            return;
        }
        el.innerHTML = reasons.map(r =>
            `<div style="padding:6px 0; border-bottom:1px solid var(--border-color);">
                ${escapeHtml(r.reason)}${r.count > 1 ? ` <span style="color:var(--text-secondary);">×${r.count}</span>` : ''}
            </div>`
        ).join('') +
        `<div style="padding-top:8px; color:var(--text-secondary);">Knowledge gaps? Upload a document covering these in the Knowledge Base above.</div>`;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ── Globals for onclick handlers ────────────────────────────────────
    window.loadAiAssistant = loadAiAssistant;
    window.saveAiCaps = saveAiCaps;
    window.pauseAiConversation = pauseAiConversation;
    window.resumeAiConversation = resumeAiConversation;
})();
