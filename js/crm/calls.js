// CRM Calls (telephony via Exotel BYOK).
//
// What this module owns on the frontend:
//   1. The "Call" button on the lead detail panel — opens a small modal
//      asking which phone to dial and which of the user's numbers should
//      ring first, then POSTs /api/calls/place. The provider rings the
//      agent's mobile, the agent picks up, the provider bridges to the
//      customer. No WebRTC in v1 — that's a follow-up once the in-browser
//      flow becomes a demo blocker.
//   2. Timeline rendering — call rows merge into the existing lead
//      timeline alongside activities, follow-ups, WhatsApp messages, etc.
//   3. SignalR listener for CallEventReceived — surfaces inbound calls as
//      a toast + auto-refreshes the lead detail panel if it's already
//      open on the matching lead.
//
// The frontend never touches the provider's HTTP API directly — the BYOK
// tokens stay encrypted on the backend and only the CRM API knows them.

(function () {
    'use strict';

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ─── Lead-detail "Call" button reveal ─────────────────────────────────
    // The button is in the DOM with display:none. We flip it on whenever
    // the open lead has a phone AND the tenant has Exotel configured (so we
    // don't tease the user with a button that errors on click).

    let _callsConfigured = null;

    async function refreshCallsConfigStatus() {
        if (_callsConfigured !== null) return _callsConfigured;
        try {
            const cfg = await api.request('/crm/calls/integration');
            _callsConfigured = !!cfg?.configured;
        } catch (_) {
            // 403 for non-admins is fine — they can still place calls if
            // the admin already configured it. Fall back to "show button,
            // let backend gate".
            _callsConfigured = true;
        }
        return _callsConfigured;
    }

    function shouldShowCallButton(lead) {
        const phone = (lead?.phone || lead?.alternate_phone || '').trim();
        return !!phone;
    }

    async function maybeShowLeadCallButton(lead) {
        const btn = document.getElementById('leadDetailCallBtn');
        if (!btn) return;
        if (!shouldShowCallButton(lead)) { btn.style.display = 'none'; return; }
        const configured = await refreshCallsConfigStatus();
        btn.style.display = configured ? '' : 'none';
    }

    // Hook into the lead-detail panel render. lead-journey.js doesn't emit a
    // formal event when it opens a lead — but it does write window._leadDetailId
    // and we can poll the matching DOM in the same way the Need-Help button
    // refresh does. To avoid a polling spin, we MutationObserve the lead
    // detail container for re-renders.
    document.addEventListener('DOMContentLoaded', () => {
        const target = document.getElementById('leadDetailInfo');
        if (!target) return;
        const observer = new MutationObserver(async () => {
            try {
                const id = window._leadDetailId;
                if (!id) return;
                // Re-fetch the lead minimally — the same shape lead-journey
                // already cached. Cheap because the panel was just rendered
                // from the same lead.
                const phoneTxt = document.querySelector('#leadDetailInfo .lead-detail-item .crm-phone-link, #leadDetailInfo a[href^="tel:"]');
                const phone = phoneTxt ? phoneTxt.textContent : '';
                await maybeShowLeadCallButton({ phone });
                renderCallTimelineEntries(id);
            } catch (_) { /* non-fatal */ }
        });
        observer.observe(target, { childList: true, subtree: false });
    });

    // ─── Outbound call modal ──────────────────────────────────────────────

    function openPlaceCallModal(leadId) {
        if (!leadId) return;
        // Build a minimal inline modal so we don't need extra HTML in
        // leads.html. Same pattern the WhatsApp-send modal uses.
        const existing = document.getElementById('placeCallModal');
        if (existing) existing.remove();

        const wrap = document.createElement('div');
        wrap.id = 'placeCallModal';
        wrap.className = 'modal active';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
        wrap.innerHTML = `
            <div class="gm-modal" style="background:var(--bg-card);border-radius:8px;max-width:480px;width:90%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <h3 style="margin:0;">Place call</h3>
                    <button onclick="document.getElementById('placeCallModal').remove()" style="background:none;border:0;font-size:24px;cursor:pointer;color:var(--text-secondary);">&times;</button>
                </div>
                <div style="display:grid;gap:12px;">
                    <div>
                        <label class="form-label">Customer number</label>
                        <input type="tel" id="pcCustomerPhone" class="form-control" placeholder="+91…">
                    </div>
                    <div>
                        <label class="form-label">Ring my number first</label>
                        <input type="tel" id="pcAgentPhone" class="form-control" placeholder="+91… (your mobile)">
                        <small style="color:var(--text-secondary);font-size:0.8em;">Provider rings this number; pick up, then it bridges to the customer.</small>
                    </div>
                    <label style="display:flex;gap:8px;align-items:center;font-size:0.9em;">
                        <input type="checkbox" id="pcRecord" checked> Record the call
                    </label>
                </div>
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
                    <button class="btn btn-outline-secondary" onclick="document.getElementById('placeCallModal').remove()">Cancel</button>
                    <button class="btn btn-success" id="pcPlaceBtn" onclick="window._submitPlaceCall('${esc(leadId)}')">Call</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        // Try to prefill from the open lead's phone.
        try {
            const phoneEl = document.querySelector('#leadDetailInfo a[href^="tel:"]');
            if (phoneEl) document.getElementById('pcCustomerPhone').value = phoneEl.textContent.trim();
        } catch (_) {}

        // Prefill agent phone from the user's auth claim if available.
        try {
            const u = (typeof api.getUser === 'function') ? api.getUser() : null;
            const phone = u?.phone || u?.phoneNumber || localStorage.getItem('ragenaizer_last_agent_phone');
            if (phone) document.getElementById('pcAgentPhone').value = phone;
        } catch (_) {}
    }

    async function _submitPlaceCall(leadId) {
        const btn = document.getElementById('pcPlaceBtn');
        const customer = document.getElementById('pcCustomerPhone').value.trim();
        const agent = document.getElementById('pcAgentPhone').value.trim();
        const record = document.getElementById('pcRecord').checked;
        if (!customer) { Toast.error('Customer number required'); return; }
        if (!agent) { Toast.error('Your number is required to ring you first'); return; }
        try { localStorage.setItem('ragenaizer_last_agent_phone', agent); } catch (_) {}
        btn.disabled = true; btn.textContent = 'Ringing…';
        try {
            const resp = await api.request('/crm/calls/place', {
                method: 'POST',
                body: JSON.stringify({
                    lead_id: leadId,
                    agent_phone: agent,
                    customer_phone: customer,
                    record,
                }),
            });
            Toast.success(`Call placed (SID ${resp.call_sid || 'pending'})`);
            const modal = document.getElementById('placeCallModal');
            if (modal) modal.remove();
            // Refresh the timeline so the optimistic 'initiated' row shows.
            setTimeout(() => renderCallTimelineEntries(leadId), 500);
        } catch (e) {
            Toast.error(e?.message || 'Failed to place call');
            btn.disabled = false; btn.textContent = 'Call';
        }
    }

    // ─── Timeline rendering ───────────────────────────────────────────────

    async function renderCallTimelineEntries(leadId) {
        const tl = document.getElementById('leadTimeline');
        if (!tl) return;
        let calls = [];
        try {
            calls = await api.request(`/crm/calls/for-lead/${leadId}?limit=200`);
        } catch (_) { return; }
        if (!Array.isArray(calls) || calls.length === 0) return;

        // Remove previously-rendered call rows so we don't duplicate on
        // re-render. Identified by a stable [data-call-row] attribute.
        tl.querySelectorAll('[data-call-row]').forEach(el => el.remove());

        // Prepend in chronological-descending order to match the rest of
        // the timeline rendering convention. Each call lands as a single
        // row regardless of how many lifecycle webhooks the provider sent
        // (they all upsert into one DB row by CallSid).
        const frag = document.createDocumentFragment();
        calls.forEach(c => frag.appendChild(buildCallRow(c)));
        // Insert at the top so it sits above activities. lead-journey
        // renders in descending order so prepend is the right insert point.
        tl.insertBefore(frag, tl.firstChild);
    }

    function buildCallRow(c) {
        const div = document.createElement('div');
        div.className = 'tl-row';
        div.setAttribute('data-call-row', c.id);
        const isIn = c.direction === 'inbound';
        const dirLabel = isIn ? 'Incoming call' : 'Outgoing call';
        const otherSide = isIn ? c.from_phone : c.to_phone;
        const statusLabel = ({
            'initiated': 'Initiated',
            'ringing': 'Ringing…',
            'in-progress': 'In progress',
            'completed': 'Completed',
            'failed': 'Failed',
            'busy': 'Busy',
            'no-answer': 'No answer',
            'canceled': 'Canceled',
        })[c.status] || c.status;
        const statusClass = c.status === 'completed' ? 'completed'
                          : (c.status === 'failed' || c.status === 'busy' || c.status === 'no-answer' || c.status === 'canceled') ? 'failed'
                          : 'pending';
        const dur = c.duration_seconds ? formatDuration(c.duration_seconds) : '';
        const when = c.initiated_at || c.created_at;

        let recordingHtml = '';
        if (c.recording_url) {
            recordingHtml = `
                <div style="margin-top:6px;">
                    <audio controls preload="none" style="height:32px;max-width:280px;">
                        <source src="${esc(c.recording_url)}" type="audio/mpeg">
                    </audio>
                </div>`;
        }

        let transcriptHtml = '';
        if (c.transcript) {
            transcriptHtml = `
                <details style="margin-top:6px;">
                    <summary style="cursor:pointer;color:var(--text-secondary);font-size:0.85em;">Transcript</summary>
                    <div style="margin-top:6px;padding:8px;background:var(--bg-secondary);border-radius:6px;font-size:0.88em;white-space:pre-wrap;">${esc(c.transcript)}</div>
                </details>`;
        }

        div.innerHTML = `
            <div class="tl-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${isIn
                        ? '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'
                        : '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/><polyline points="15 3 21 3 21 9"/><line x1="14" y1="10" x2="21" y2="3"/>'}
                </svg>
            </div>
            <div class="tl-body">
                <div class="tl-head">
                    <strong>${esc(dirLabel)}</strong>
                    <span class="tl-chip tl-chip-${statusClass}">${esc(statusLabel)}</span>
                    ${dur ? `<span class="tl-chip">${esc(dur)}</span>` : ''}
                </div>
                <div class="tl-detail">${esc(otherSide || '')}</div>
                ${recordingHtml}
                ${transcriptHtml}
                <div class="tl-meta">${when ? new Date(when).toLocaleString() : ''}</div>
            </div>
        `;
        return div;
    }

    function formatDuration(seconds) {
        if (seconds == null) return '';
        const s = Math.max(0, Math.floor(seconds));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return m > 0 ? `${m}m ${r}s` : `${r}s`;
    }

    // ─── SignalR listener — inbound call toast + lead-panel refresh ───────

    function attachCrmHubListener() {
        // CrmHub instance is wired in leads.js via setupLeadsRealtime; we
        // piggy-back on the same connection. leads.js stores it in
        // `_leadsHubConnection`, which is module-local — we look it up via
        // the explicit window getter it sets, falling back to a few likely
        // names so this works across pages (lead-journey embeds on
        // dashboard + leads).
        const conn = window._crmHubConnection
                  || window._leadsHubConnection
                  || (typeof _leadsHubConnection !== 'undefined' ? _leadsHubConnection : null);
        if (!conn) {
            setTimeout(attachCrmHubListener, 400);
            return;
        }
        // Idempotent — re-binding adds duplicate handlers in SignalR's
        // current SDK; guard with a flag.
        if (conn.__callsHandlerBound) return;
        conn.__callsHandlerBound = true;
        conn.on('CallEventReceived', evt => {
            try {
                // Refresh the open lead's timeline if it's the one this
                // call belongs to (or if it's the same phone — handles the
                // "incoming call from an unknown number" case).
                if (window._leadDetailId && evt.leadId === window._leadDetailId) {
                    renderCallTimelineEntries(window._leadDetailId);
                }
                // Inbound ringing → toast with click-to-open. Bypass the
                // toast for our own outbound updates to avoid noise.
                if (evt.direction === 'inbound' && (evt.eventKind === 'ringing' || evt.eventKind === 'initiated')) {
                    showIncomingCallToast(evt);
                }
            } catch (e) { console.warn('[calls] hub event handler failed', e); }
        });
    }
    document.addEventListener('DOMContentLoaded', attachCrmHubListener);

    function showIncomingCallToast(evt) {
        const id = 'incoming-call-toast-' + (evt.callSid || Date.now());
        if (document.getElementById(id)) return;
        const wrap = document.createElement('div');
        wrap.id = id;
        wrap.className = 'crm-incoming-call-toast';
        wrap.style.cssText = `
            position:fixed;right:20px;bottom:20px;z-index:9999;
            background:var(--bg-card);border:2px solid var(--brand-primary);border-radius:10px;
            padding:14px 18px;min-width:280px;max-width:360px;
            box-shadow:0 10px 30px rgba(0,0,0,0.25);
            animation:incomingCallPulse 1.2s ease-in-out infinite alternate;
        `;
        const phone = evt.fromPhone || 'Unknown number';
        const openLink = evt.leadId
            ? `<a href="javascript:void(0)" onclick="openLeadDetailPanel('${esc(evt.leadId)}'); document.getElementById('${id}').remove()" style="color:var(--brand-primary);font-weight:600;">Open lead →</a>`
            : '';
        wrap.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;">
                <div>
                    <div style="font-weight:700;font-size:0.88em;color:var(--brand-primary);text-transform:uppercase;letter-spacing:0.5px;">Incoming call</div>
                    <div style="font-size:1.1em;font-weight:600;margin:2px 0;">${esc(phone)}</div>
                    ${openLink}
                </div>
                <button onclick="document.getElementById('${id}').remove()" style="background:none;border:0;font-size:20px;cursor:pointer;color:var(--text-secondary);line-height:1;">&times;</button>
            </div>
        `;
        document.body.appendChild(wrap);
        // Auto-dismiss after 30s — call lifecycle will overwrite anyway.
        setTimeout(() => { const el = document.getElementById(id); if (el) el.remove(); }, 30000);
    }

    // CSS for the pulsing toast. Injected once.
    (function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes incomingCallPulse {
                from { box-shadow: 0 10px 30px rgba(37,99,235,0.25); }
                to   { box-shadow: 0 12px 40px rgba(37,99,235,0.55); }
            }
        `;
        document.head.appendChild(style);
    })();

    // Expose entry points.
    window.openPlaceCallModal = openPlaceCallModal;
    window._submitPlaceCall = _submitPlaceCall;
    window.renderCallTimelineEntries = renderCallTimelineEntries;
})();
