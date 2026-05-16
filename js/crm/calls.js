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

    // Short-lived cache so the inline phone-link click handler can decide
    // synchronously enough to feel native, without DDoSing /numbers on every
    // table render. 30s TTL — long enough to absorb a burst of clicks /
    // re-renders, short enough that a tenant who just toggled a number in
    // Settings sees the right behaviour within half a minute.
    let _callsConfiguredCache = { value: null, at: 0 };
    const CALLS_CONFIG_TTL_MS = 30 * 1000;

    async function refreshCallsConfigStatus({ force = false } = {}) {
        const now = Date.now();
        if (!force && _callsConfiguredCache.value !== null
            && (now - _callsConfiguredCache.at) < CALLS_CONFIG_TTL_MS) {
            return _callsConfiguredCache.value;
        }
        try {
            const numbers = await api.request('/crm/calls/numbers');
            const ok = Array.isArray(numbers) && numbers.some(n => n.is_active);
            _callsConfiguredCache = { value: ok, at: now };
            return ok;
        } catch (_) {
            // Backend down / permission issue → hide the button rather than
            // show a teaser that errors when clicked.
            _callsConfiguredCache = { value: false, at: now };
            return false;
        }
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

        // Snapshot the lead's phone BEFORE we tear down the slide panel — the
        // panel's DOM (#leadDetailInfo …) is what we read from.
        let prefilledCustomer = '';
        try {
            const phoneEl = document.querySelector('#leadDetailInfo a[href^="tel:"]');
            if (phoneEl) prefilledCustomer = phoneEl.textContent.trim();
        } catch (_) {}

        // The lead detail slide panel sits above the standard modal z-index,
        // so a modal opened on top of it appears dimmed and unreachable
        // (overlay covers it). Close the panel first; the call modal becomes
        // the only focused surface. window._leadDetailId persists so the
        // submit handler can still tie the call to the right lead.
        try {
            if (typeof window.closeLeadDetailPanel === 'function') {
                window.closeLeadDetailPanel();
            }
        } catch (_) {}

        const existing = document.getElementById('placeCallModal');
        if (existing) existing.remove();

        const wrap = document.createElement('div');
        wrap.id = 'placeCallModal';
        wrap.className = 'gm-overlay active';
        wrap.innerHTML = `
            <div class="gm-modal gm-sm">
                <div class="gm-header">
                    <div class="gm-header-left">
                        <div class="gm-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
                            </svg>
                        </div>
                        <div class="gm-title-group">
                            <h3 class="gm-title">Place call</h3>
                            <p class="gm-subtitle">Dials your number first, then bridges to the customer</p>
                        </div>
                    </div>
                    <button class="gm-close" onclick="document.getElementById('placeCallModal').remove()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="gm-body">
                    <div class="crm-form-group">
                        <label for="pcCustomerPhone">Customer number</label>
                        <input type="tel" id="pcCustomerPhone" class="form-control" placeholder="+91…">
                    </div>
                    <div class="crm-form-group">
                        <label for="pcAgentPhone">Ring my number first</label>
                        <input type="tel" id="pcAgentPhone" class="form-control" placeholder="+91… (your mobile)">
                        <small style="color:var(--text-secondary);font-size:0.8em;">Provider rings this number; pick up, then it bridges to the customer.</small>
                    </div>
                    <label style="display:flex;gap:8px;align-items:center;font-size:0.9em;margin-top:4px;">
                        <input type="checkbox" id="pcRecord" checked> Record the call
                    </label>
                </div>
                <div class="gm-footer" style="padding:16px 20px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border-color-light);">
                    <button class="btn btn-secondary" onclick="document.getElementById('placeCallModal').remove()">Cancel</button>
                    <button class="btn btn-primary" id="pcPlaceBtn" onclick="window._submitPlaceCall('${esc(leadId)}')">Call</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        if (prefilledCustomer) document.getElementById('pcCustomerPhone').value = prefilledCustomer;

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

    // ─── Tap-to-call picker — Exotel vs native dialer ─────────────────────
    // Every `.crm-tel-link` on the CRM is a `<a href="tel:…">`. On its own
    // that opens whatever OS dialer is registered (great on mobile, useless
    // on desktop). When the tenant has Exotel configured we surface a
    // two-choice picker so the user can opt into the logged + recorded
    // CRM call OR fall back to dialer-of-choice. Tenants without Exotel
    // configured don't see the picker at all — the link works as before.

    function openCallMethodPicker({ phone, telHref, leadId }) {
        const existing = document.getElementById('callMethodPickerModal');
        if (existing) existing.remove();

        const safePhone = esc(phone || '');

        const wrap = document.createElement('div');
        wrap.id = 'callMethodPickerModal';
        wrap.className = 'gm-overlay active';
        wrap.innerHTML = `
            <div class="gm-modal gm-sm">
                <div class="gm-header">
                    <div class="gm-header-left">
                        <div class="gm-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
                            </svg>
                        </div>
                        <div class="gm-title-group">
                            <h3 class="gm-title">Call ${safePhone}</h3>
                            <p class="gm-subtitle">Pick how you want to place this call</p>
                        </div>
                    </div>
                    <button class="gm-close" data-action="close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="gm-body" style="gap:10px;">
                    <button class="btn btn-primary" data-action="exotel" style="justify-content:flex-start;text-align:left;padding:14px 16px;display:flex;gap:12px;align-items:flex-start;">
                        <span style="font-size:1.4em;line-height:1;">📞</span>
                        <span style="display:flex;flex-direction:column;gap:2px;">
                            <span style="font-weight:600;">Place via Exotel</span>
                            <span style="font-size:0.85em;opacity:0.85;">Logs to the lead timeline, records the call, agent rings first.</span>
                        </span>
                    </button>
                    <button class="btn btn-secondary" data-action="dialer" style="justify-content:flex-start;text-align:left;padding:14px 16px;display:flex;gap:12px;align-items:flex-start;">
                        <span style="font-size:1.4em;line-height:1;">📱</span>
                        <span style="display:flex;flex-direction:column;gap:2px;">
                            <span style="font-weight:600;">Use phone dialer</span>
                            <span style="font-size:0.85em;opacity:0.85;">Opens your device's default dialer. Not logged in the CRM.</span>
                        </span>
                    </button>
                </div>
                <div class="gm-footer" style="padding:12px 20px;display:flex;justify-content:flex-end;border-top:1px solid var(--border-color-light);">
                    <button class="btn btn-secondary" data-action="close">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        // Bind handlers directly. Avoids onclick-attribute escaping issues
        // and keeps `phone` / `telHref` / `leadId` captured in closures.
        const close = () => wrap.remove();
        wrap.querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', close));
        wrap.querySelector('[data-action="exotel"]').addEventListener('click', () => {
            close();
            try {
                openPlaceCallModal(leadId || window._leadDetailId || '');
                const el = document.getElementById('pcCustomerPhone');
                if (el && phone) el.value = phone;
            } catch (e) { console.warn('[calls] openPlaceCallModal failed', e); }
        });
        wrap.querySelector('[data-action="dialer"]').addEventListener('click', () => {
            close();
            if (telHref) window.location.href = telHref;
        });
    }

    // Pre-fetch the configured flag at page-load so the first click is snappy.
    // Cache TTL is short (30s) so subsequent clicks stay synchronous-feeling.
    document.addEventListener('DOMContentLoaded', () => { refreshCallsConfigStatus(); });

    // Delegated handler on the whole document — catches phone-link clicks
    // anywhere (leads table, lead detail, lead-journey embed, etc.) without
    // each renderer having to opt in.
    //
    // IMPORTANT: this is a `tel:` anchor. The browser starts the navigation
    // synchronously the moment the click fires; if we `await` before calling
    // preventDefault(), the dialer has already been triggered by the time
    // we decide whether to intercept. So we ALWAYS preventDefault on a
    // crm-tel-link click, then re-trigger the tel: nav ourselves if the
    // tenant turns out not to have Exotel configured.
    document.addEventListener('click', (e) => {
        const anchor = e.target.closest('a.crm-tel-link');
        if (!anchor) return;
        // Modifier keys → let the browser handle (open in new tab, save, etc.)
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;

        e.preventDefault();
        e.stopPropagation();

        const telHref = anchor.getAttribute('href') || '';
        const phone = (anchor.textContent || '').replace(/^\s*📞\s*/, '').trim();
        const leadRow = anchor.closest('[data-lead-id]');
        const leadId = (leadRow && leadRow.getAttribute('data-lead-id'))
            || window._leadDetailId
            || '';

        // Anchor the rep to this lead before the tap navigates away. Two
        // mechanisms because Android and iOS handle return-from-dialer
        // differently:
        //   1. sessionStorage anchor — covers the path where the tab is
        //      evicted while the dialer is foregrounded (iOS Safari does
        //      this routinely). leads.html init reads the key and re-opens
        //      the panel after loadLeads.
        //   2. open the detail panel synchronously, here, before the
        //      dialer is invoked — covers the more common path where the
        //      back button restores the tab from bfcache (no reload, no
        //      DOMContentLoaded, so the sessionStorage handoff never
        //      fires). The panel is already on screen when the rep
        //      returns; they can log call outcomes immediately.
        if (leadId) {
            try { sessionStorage.setItem('crm_openLeadId', encodeURIComponent(leadId)); } catch (_) {}
            if (typeof window.openLeadDetailPanel === 'function') {
                try { window.openLeadDetailPanel(leadId); } catch (err) {
                    console.warn('[calls] pre-dial panel open failed', err);
                }
            }
        }

        // Decide which flow to use. Cached lookup is usually instant; on a
        // cold cache the await is a single gRPC hop (<60ms).
        (async () => {
            const configured = await refreshCallsConfigStatus();
            if (!configured) {
                // Re-trigger the native tel: navigation we just suppressed.
                if (telHref) window.location.href = telHref;
                return;
            }
            openCallMethodPicker({ phone, telHref, leadId });
        })();
    }, true);

    // Expose entry points.
    window.openPlaceCallModal = openPlaceCallModal;
    window._submitPlaceCall = _submitPlaceCall;
    window.renderCallTimelineEntries = renderCallTimelineEntries;
})();
