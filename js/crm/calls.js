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

    function openPlaceCallModal(leadId, opts) {
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

        // Pinned-number metadata flows through from openCallMethodPicker
        // so the rep sees which number they picked, and the submit sends
        // instance_key (binding the call to that specific provider row).
        const lockedInstance = (typeof opts === 'object' && opts) ? (opts.instanceKey || '') : '';
        const lockedSlug = (typeof opts === 'object' && opts) ? (opts.providerSlug || '') : '';
        const pal = providerPalette(lockedSlug);
        const pinnedBadgeHtml = lockedInstance ? `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);margin-bottom:8px;">
                <span style="padding:2px 10px;border-radius:999px;font-size:0.72rem;font-weight:600;color:#fff;background:${pal.bg};">${esc(pal.name)}</span>
                <code style="flex:1;font-size:0.92rem;">${esc(lockedInstance)}</code>
                <span style="font-size:0.75em;color:var(--text-secondary);">Dialing from</span>
            </div>
        ` : '';

        // Auth-stored phone is the caller_id we ring first. BYOK calling
        // requires it — without a number on the rep's profile, the provider
        // has nothing to call. Short-circuit straight to the OS dialer so
        // the rep can still place the call manually. (The picker has the
        // same guard, but this path is also reachable from the lead-detail
        // Call button, which bypasses the picker entirely.) Admins fix
        // this under Settings → CRM Users.
        let authPhone = '';
        try {
            const u = (typeof api.getUser === 'function') ? api.getUser() : null;
            authPhone = (u?.phoneNumber || u?.phone || '').trim();
        } catch (_) {}
        if (!authPhone) {
            const digits = (prefilledCustomer || '').replace(/[^\d+]/g, '');
            if (digits) {
                try { window.location.href = 'tel:' + digits; } catch (_) {}
            } else if (typeof Toast !== 'undefined' && Toast.warning) {
                Toast.warning('Ask an admin to save your phone under Settings → CRM Users so you can place calls.');
            }
            return;
        }
        const authPhoneBadgeHtml = `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">
                <span style="font-size:0.78em;color:var(--text-secondary);">Calling as</span>
                <code style="flex:1;font-size:0.9rem;color:var(--text-primary);">${esc(authPhone)}</code>
            </div>
            <input type="hidden" id="pcAgentPhone" value="${esc(authPhone)}">
        `;
        const agentPhoneInputHtml = authPhoneBadgeHtml;

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
                    ${pinnedBadgeHtml}
                    <input type="hidden" id="pcInstanceKey" value="${esc(lockedInstance)}">
                    <input type="hidden" id="pcProviderSlug" value="${esc(lockedSlug)}">
                    <div class="crm-form-group">
                        <label for="pcCustomerPhone">Customer number</label>
                        <input type="tel" id="pcCustomerPhone" class="form-control" placeholder="+91…">
                    </div>
                    ${agentPhoneInputHtml}
                </div>
                <div class="gm-footer" style="padding:16px 20px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border-color-light);">
                    <button class="btn btn-secondary" onclick="document.getElementById('placeCallModal').remove()">Cancel</button>
                    <button class="btn btn-primary" id="pcPlaceBtn" onclick="window._submitPlaceCall('${esc(leadId)}')">Call</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        if (prefilledCustomer) document.getElementById('pcCustomerPhone').value = prefilledCustomer;
    }

    async function _submitPlaceCall(leadId) {
        const btn = document.getElementById('pcPlaceBtn');
        const customer = document.getElementById('pcCustomerPhone').value.trim();
        const agent = document.getElementById('pcAgentPhone').value.trim();
        const instanceKey = (document.getElementById('pcInstanceKey')?.value || '').trim();
        if (!customer) { Toast.error('Customer number required'); return; }
        if (!agent) { Toast.error('Your number is required to ring you first'); return; }
        try { localStorage.setItem('ragenaizer_last_agent_phone', agent); } catch (_) {}
        btn.disabled = true; btn.textContent = 'Ringing…';
        try {
            // Recording is forced on by the backend — every call is recorded
            // for audit / compliance, no per-call opt-out.
            const body = {
                lead_id: leadId,
                agent_phone: agent,
                customer_phone: customer,
            };
            // Pin the call to a specific provider row when the picker
            // selected one. Empty string = backend falls back to
            // ResolveDefault (first active row across all providers).
            if (instanceKey) body.instance_key = instanceKey;
            const resp = await api.request('/crm/calls/place', {
                method: 'POST',
                body: JSON.stringify(body),
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
        // Mirror the lead-journey timeline classes (.tl-entry / .tl-content /
        // .tl-header / .tl-title / .tl-desc / .tl-meta) so call rows inherit
        // the same flex layout, absolute-positioned icon dot, and typography
        // as activities, status changes, etc. Without these classes the row
        // falls back to default block layout and the icon overlaps the text.
        div.className = 'tl-entry tl-call';
        div.setAttribute('data-call-row', c.id);
        const isIn = c.direction === 'inbound';
        const dirLabel = isIn ? 'Incoming call' : 'Outgoing call';
        const otherSide = isIn ? c.from_phone : c.to_phone;
        // "Completed" + duration > 0 means a human actually picked up.
        // Rename to "Connected" so the rep can tell at a glance which calls
        // reached someone vs. which technically "completed" with 0s (e.g.
        // hung up immediately, voicemail-only). Same colour, clearer label.
        const isConnected = c.status === 'completed' && (c.duration_seconds || 0) > 0;
        const statusLabel = isConnected ? 'Connected' : ({
            'initiated': 'Initiated',
            'ringing': 'Ringing…',
            'in-progress': 'In progress',
            'completed': 'Completed',
            'failed': 'Failed',
            'busy': 'Busy',
            'no-answer': 'No answer',
            'canceled': 'Canceled',
        })[c.status] || c.status;
        const statusChip = c.status === 'completed' ? 'tl-chip-completed'
                          : (c.status === 'failed' || c.status === 'busy' || c.status === 'no-answer' || c.status === 'canceled') ? 'tl-chip-missed'
                          : 'tl-chip-pending';
        const dur = c.duration_seconds ? formatDuration(c.duration_seconds) : '';
        const when = c.initiated_at || c.created_at;

        let recordingHtml = '';
        // Prefer the same-origin signed proxy URL — the raw provider CDN
        // (Exotel especially) is Basic-auth protected and would prompt the
        // browser for credentials if we used it directly.
        const playbackUrl = c.recording_playback_url || c.recording_url;
        if (playbackUrl) {
            recordingHtml = `
                <div style="margin-top:6px;">
                    <audio controls preload="none" style="height:32px;max-width:280px;">
                        <source src="${esc(playbackUrl)}" type="audio/mpeg">
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
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    ${isIn
                        ? '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'
                        : '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/><polyline points="15 3 21 3 21 9"/><line x1="14" y1="10" x2="21" y2="3"/>'}
                </svg>
            </div>
            <div class="tl-content">
                <div class="tl-header">
                    <span class="tl-title">${esc(dirLabel)}</span>
                    <span class="tl-chip ${statusChip}">${esc(statusLabel)}</span>
                    ${dur ? `<span class="tl-chip">${esc(dur)}</span>` : ''}
                </div>
                ${otherSide ? `<div class="tl-desc">${esc(otherSide)}</div>` : ''}
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

    // ─── Tap-to-call picker — provider × number × dialer ──────────────────
    // Every `.crm-tel-link` on the CRM is a `<a href="tel:…">`. On its own
    // that opens whatever OS dialer is registered (great on mobile, useless
    // on desktop). When the tenant has telephony configured we surface a
    // picker so the rep can choose:
    //   - any active provider-backed number (Exotel / MyOperator / …)
    //   - or fall back to the device dialer.
    // Adapters live in CRM; the rep just picks a number and the backend
    // dispatches via the correct ICallProvider (basic-auth XML vs OBD JSON).
    function providerPalette(slug) {
        const s = (slug || '').toLowerCase();
        if (s === 'exotel') return { name: 'Exotel', bg: '#2563eb' };
        if (s === 'myoperator') return { name: 'MyOperator', bg: '#9333ea' };
        return { name: slug || 'Unknown', bg: '#6b7280' };
    }

    async function openCallMethodPicker({ phone, telHref, leadId }) {
        const existing = document.getElementById('callMethodPickerModal');
        if (existing) existing.remove();

        // Pull the live number list (skip cache to reflect any toggle the
        // rep just flipped in Settings → Calling without page reload).
        let numbers = [];
        try {
            numbers = await api.request('/crm/calls/numbers') || [];
        } catch (_) { numbers = []; }
        const active = numbers.filter(n => n.is_active);

        // Zero active providers → behave like no BYOK was ever set up: skip
        // the picker entirely and hand off to the OS dialer. Also bust the
        // stale "configured" cache so the lead-detail Call button hides on
        // the next decorate pass. Otherwise a tenant who just turned every
        // number off would see a picker with only "Direct dialer" — one
        // extra click for no gain.
        if (active.length === 0) {
            _callsConfiguredCache = { value: false, at: Date.now() };
            if (telHref) window.location.href = telHref;
            return;
        }

        // No caller_id on the rep's Auth profile → BYOK calling is unusable
        // (every provider needs a number to ring first). Don't show the
        // picker at all — it would either ask the rep to retype their
        // mobile every call, or silently fall back to typing-it-in. Hand
        // off to the OS dialer so the rep can still place the call manually.
        // Admins can fix this under Settings → CRM Users.
        let _authPhone = '';
        try {
            const u = (typeof api.getUser === 'function') ? api.getUser() : null;
            _authPhone = (u?.phoneNumber || u?.phone || '').trim();
        } catch (_) {}
        if (!_authPhone) {
            if (telHref) window.location.href = telHref;
            return;
        }

        const safePhone = esc(phone || '');

        // Build one tile per active number. Reps see provider + DID up
        // front; backend resolves credentials by (tenant, provider,
        // instance_key) — they don't need to know the dispatch path.
        const numberTilesHtml = active.map((n, idx) => {
            const p = providerPalette(n.provider);
            return `
                <button type="button" class="cm-number-tile" data-action="dial-number" data-idx="${idx}">
                    <span class="cm-tile-badge" style="background:${p.bg};">${esc(p.name)}</span>
                    <span style="display:flex;flex-direction:column;flex:1;min-width:0;">
                        <span class="cm-tile-name">${esc(n.instance_key)}</span>
                        <span class="cm-tile-meta">Logged · recorded · rings you</span>
                    </span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>`;
        }).join('');

        // Detect whether the agent has registered the Ragenaizer Companion
        // Android app. We hit NS's per-user list endpoint; if non-empty we
        // render a 3rd tile that pushes an FCM call-trigger to their phone
        // via /api/Calls/companion-initiate. Failing fetch (NS down or no
        // route) → tile is hidden, picker still works for Exotel + dialer.
        let _companionAvailable = false;
        try {
            const tokens = await api.request('/notifications/companion-device-tokens');
            _companionAvailable = Array.isArray(tokens) && tokens.length > 0;
        } catch (_) { _companionAvailable = false; }

        const companionTileHtml = _companionAvailable ? `
            <button type="button" class="cm-number-tile" data-action="companion" style="background:transparent;">
                <span class="cm-tile-badge" style="background:#5b4fd8;">Ragenaizer</span>
                <span style="display:flex;flex-direction:column;flex:1;min-width:0;">
                    <span class="cm-tile-name">Companion app</span>
                    <span class="cm-tile-meta">Push to your phone · logged · timeline</span>
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>` : '';

        const dialerTileHtml = `
            <button type="button" class="cm-number-tile" data-action="dialer" style="background:transparent;">
                <span class="cm-tile-badge" style="background:#6b7280;">Device</span>
                <span style="display:flex;flex-direction:column;flex:1;min-width:0;">
                    <span class="cm-tile-name">Direct dialer</span>
                    <span class="cm-tile-meta">OS dialer · not logged</span>
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>`;

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
                            <p class="gm-subtitle">Pick the number to dial from${active.length ? '' : ' — no provider configured yet'}</p>
                        </div>
                    </div>
                    <button class="gm-close" data-action="close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="gm-body" style="gap:6px;display:flex;flex-direction:column;">
                    ${numberTilesHtml}
                    ${companionTileHtml}
                    ${dialerTileHtml}
                </div>
                <div class="gm-footer" style="padding:12px 20px;display:flex;justify-content:flex-end;border-top:1px solid var(--border-color-light);">
                    <button class="btn btn-secondary" data-action="close">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        const close = () => wrap.remove();
        wrap.querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', close));
        wrap.querySelectorAll('[data-action="dial-number"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-idx'), 10);
                const picked = active[idx];
                close();
                try {
                    openPlaceCallModal(leadId || window._leadDetailId || '', {
                        instanceKey: picked.instance_key,
                        providerSlug: picked.provider,
                    });
                    const el = document.getElementById('pcCustomerPhone');
                    if (el && phone) el.value = phone;
                } catch (e) { console.warn('[calls] openPlaceCallModal failed', e); }
            });
        });
        const dialerBtn = wrap.querySelector('[data-action="dialer"]');
        if (dialerBtn) dialerBtn.addEventListener('click', () => {
            close();
            if (telHref) window.location.href = telHref;
        });
        // Companion tile — fires an FCM push to the agent's phone via
        // CRM → NS gRPC SendCompanionCallTrigger. The companion app opens
        // pre-filled and the agent taps the green call button once. The
        // call event lands in the lead timeline via /api/Calls/log after
        // the call ends (~3s post-IDLE).
        const companionBtn = wrap.querySelector('[data-action="companion"]');
        if (companionBtn) companionBtn.addEventListener('click', async () => {
            const lid = leadId || window._leadDetailId || '';
            if (!lid) {
                if (typeof Toast !== 'undefined') Toast.error('No lead selected for this call');
                return;
            }
            companionBtn.disabled = true;
            companionBtn.querySelector('.cm-tile-meta').textContent = 'Sending…';
            try {
                const resp = await api.request('/crm/calls/companion-initiate', {
                    method: 'POST',
                    body: JSON.stringify({ lead_id: lid })
                });
                close();
                if (resp && resp.success && resp.devices_succeeded > 0) {
                    if (typeof Toast !== 'undefined')
                        Toast.success(`Sent to ${resp.devices_succeeded} companion device${resp.devices_succeeded === 1 ? '' : 's'} — tap the green Call button on your phone.`);
                } else if (resp && resp.devices_targeted === 0) {
                    if (typeof Toast !== 'undefined')
                        Toast.warning('No companion devices registered yet. Install & sign into the Ragenaizer Companion Android app.');
                } else {
                    if (typeof Toast !== 'undefined')
                        Toast.error(resp?.message || 'Failed to reach your phone');
                }
            } catch (e) {
                close();
                if (typeof Toast !== 'undefined') Toast.error(e?.message || 'Network error');
            }
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

    // Wrapper that the lead-detail-panel Call button uses. Pulls the
    // customer phone out of the panel's DOM, then opens the same number
    // picker as a `.crm-tel-link` click — so reps get the provider+number
    // choice instead of jumping straight to the place-call form.
    function openLeadCallPicker(leadId) {
        leadId = leadId || window._leadDetailId || '';
        let phone = '';
        try {
            const phoneEl = document.querySelector('#leadDetailInfo a[href^="tel:"]');
            if (phoneEl) phone = (phoneEl.textContent || '').replace(/^\s*📞\s*/, '').trim();
        } catch (_) {}
        const telHref = phone ? `tel:${phone.replace(/\s+/g, '')}` : '';
        openCallMethodPicker({ phone, telHref, leadId });
    }

    // Expose entry points.
    window.openPlaceCallModal = openPlaceCallModal;
    window.openLeadCallPicker = openLeadCallPicker;
    window._submitPlaceCall = _submitPlaceCall;
    window.renderCallTimelineEntries = renderCallTimelineEntries;
    // Settings → Calling toggles need a way to invalidate the 30s
    // "is anything configured" cache immediately, so the lead-page Call
    // button hides/shows on the next decorate without a stale-data lag.
    window.bustCallsConfigCache = () => { _callsConfiguredCache = { value: null, at: 0 }; };
})();
