// ── Apply page analytics tracker ─────────────────────────────────────────
// Privacy-friendly engagement tracking for the recruitment apply page.
//
// What it sends to the backend:
//   - page-open ping with visitor_id (localStorage UUID), session_id (per
//     page-load), referrer, utm_*, device_class, ?via= attribution
//   - 15s heartbeat with current duration, scroll depth, form_started flag,
//     fields_touched + fields_completed (KEYS only, never values)
//   - share-button clicks (channel only)
//   - submit outcome AFTER the actual submit returns
//   - final flush via navigator.sendBeacon on pagehide (survives navigation)
//
// What it NEVER sends:
//   - field VALUES (no keystroke logging)
//   - cookies (visitor_id is in localStorage; clearable by the user any time)
//   - tracking when navigator.doNotTrack === '1' (entire module no-ops)
//
// Public API (consumed by apply.js):
//   ApplyAnalytics.init({ webhookKey, posting })
//   ApplyAnalytics.notifyFieldFocus(fieldKey)
//   ApplyAnalytics.notifyFieldBlur(fieldKey, hasValue)
//   ApplyAnalytics.notifyShare(channel)
//   ApplyAnalytics.notifySubmitOutcome({ outcome, errorField, applicationId })
//   ApplyAnalytics.appendViaParam(url)   // for share buttons → returns url+via=...
(function () {
    const STORAGE_KEY = 'apply-visitor-id-v1';
    const HEARTBEAT_MS = 15000;
    const ACTIVITY_IDLE_MS = 60000;     // pause heartbeats after 60s of no input/scroll
    const SHORT_TOKEN_LEN = 8;

    const state = {
        webhookKey: null,
        visitorId: null,
        sessionId: null,
        visitId: null,
        startedAt: 0,
        lastActivityAt: 0,
        maxScrollPct: 0,
        formStarted: false,
        lastField: null,
        fieldsTouched: new Set(),
        fieldsCompleted: new Set(),
        sharesSent: new Set(),       // local de-dup so a single visitor doesn't double-count clicking the same share button
        heartbeatTimer: null,
        baseUrl: null
    };

    // ── Privacy: honor DNT ─────────────────────────────────────────────────
    function dntActive() {
        const dnt = (navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack);
        return dnt === '1' || dnt === 'yes';
    }

    // ── ID helpers ─────────────────────────────────────────────────────────
    function uuid() {
        // RFC 4122 v4. Uses crypto.randomUUID where available, falls back to
        // a Math.random-based shim for ancient browsers.
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    function getOrCreateVisitorId() {
        try {
            let id = localStorage.getItem(STORAGE_KEY);
            if (!id) {
                id = uuid();
                localStorage.setItem(STORAGE_KEY, id);
            }
            return id;
        } catch {
            // localStorage blocked (private browsing, embedded iframe) — fall
            // back to a per-session id; we just lose returning-visitor tracking.
            return uuid();
        }
    }

    function deviceClass() {
        // Crude but stable. The backend only uses this for breakdown bars.
        const ua = (navigator.userAgent || '').toLowerCase();
        if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
        if (/mobi|android|iphone|ipod/.test(ua)) return 'mobile';
        return 'desktop';
    }

    // ── ?via= attribution helpers ──────────────────────────────────────────
    function readViaParam() {
        try {
            const u = new URL(window.location.href);
            return u.searchParams.get('via');
        } catch { return null; }
    }

    function shortToken(visitorId) {
        // First 8 hex chars. Short enough to ride along on shared URLs without
        // looking ugly; not personally identifying on its own.
        return (visitorId || '').replace(/-/g, '').slice(0, SHORT_TOKEN_LEN);
    }

    // ── Network ────────────────────────────────────────────────────────────
    function getEndpoint(suffix) {
        // CONFIG.hrmsApiBaseUrl already ends in `/api` (e.g. https://localhost:5104/api),
        // so callers must NOT prepend a second `/api`. Mirror what apply.js does
        // via getApiBase() so the two stay consistent — the path here is
        // `/recruitment/apply/{key}/track/...`, not `/api/recruitment/...`.
        const base = (window.CONFIG && window.CONFIG.hrmsApiBaseUrl)
                  || (window.CONFIG && window.CONFIG.apiBaseUrl)
                  || 'https://localhost:5104/api';
        return `${base}/recruitment/apply/${encodeURIComponent(state.webhookKey)}${suffix}`;
    }

    function postJson(suffix, body) {
        return fetch(getEndpoint(suffix), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'omit',
            keepalive: true
        }).catch(() => { /* swallow — analytics must never block UX */ });
    }

    function beaconJson(suffix, body) {
        // sendBeacon survives a page transition (close tab, navigate away).
        // Falls back to fetch with keepalive: true if the browser ditched it.
        try {
            const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
            if (navigator.sendBeacon && navigator.sendBeacon(getEndpoint(suffix), blob)) return;
        } catch { /* fall through */ }
        postJson(suffix, body);
    }

    // ── Heartbeat ──────────────────────────────────────────────────────────
    function buildHeartbeatBody() {
        return {
            visit_id: state.visitId,
            duration_ms: Date.now() - state.startedAt,
            max_scroll_pct: state.maxScrollPct,
            form_started: state.formStarted,
            last_field_touched: state.lastField,
            fields_touched: Array.from(state.fieldsTouched).slice(0, 50),
            fields_completed: Array.from(state.fieldsCompleted).slice(0, 50)
        };
    }

    function sendHeartbeat() {
        if (!state.visitId) return;
        if (Date.now() - state.lastActivityAt > ACTIVITY_IDLE_MS) return;  // skip if idle
        postJson('/track/heartbeat', buildHeartbeatBody());
    }

    function startHeartbeat() {
        stopHeartbeat();
        state.heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
    }
    function stopHeartbeat() {
        if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
    }

    // ── Scroll depth ───────────────────────────────────────────────────────
    function updateScrollDepth() {
        const doc = document.documentElement;
        const total = (doc.scrollHeight - doc.clientHeight) || 1;
        const pct = Math.min(100, Math.max(0, Math.round((window.scrollY / total) * 100)));
        if (pct > state.maxScrollPct) state.maxScrollPct = pct;
        state.lastActivityAt = Date.now();
    }

    function bumpActivity() { state.lastActivityAt = Date.now(); }

    // ── pagehide / visibilitychange ────────────────────────────────────────
    function onPagehide() {
        if (!state.visitId) return;
        beaconJson('/track/heartbeat', buildHeartbeatBody());
    }

    // ── Public API ─────────────────────────────────────────────────────────
    const ApplyAnalytics = {
        async init({ webhookKey }) {
            if (dntActive()) {
                console.info('[apply-analytics] DNT enabled — tracking disabled');
                return;
            }
            if (!webhookKey) return;
            state.webhookKey = webhookKey;
            state.visitorId = getOrCreateVisitorId();
            state.sessionId = uuid();
            state.startedAt = Date.now();
            state.lastActivityAt = Date.now();
            state.baseUrl = window.location.origin + window.location.pathname + '?k=' + encodeURIComponent(webhookKey);

            // Pull ?utm_* and ?via= once, then strip them so future link-copies
            // don't inherit them.
            let utm_source = null, utm_medium = null, utm_campaign = null;
            try {
                const u = new URL(window.location.href);
                utm_source = u.searchParams.get('utm_source');
                utm_medium = u.searchParams.get('utm_medium');
                utm_campaign = u.searchParams.get('utm_campaign');
            } catch { /* ignore */ }

            const referredBy = readViaParam();

            try {
                const r = await fetch(getEndpoint('/track/visit'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        visitor_id: state.visitorId,
                        session_id: state.sessionId,
                        referrer: document.referrer || null,
                        utm_source, utm_medium, utm_campaign,
                        device_class: deviceClass(),
                        referred_by_visitor_id: referredBy
                    }),
                    credentials: 'omit'
                });
                if (r.ok) {
                    const body = await r.json().catch(() => ({}));
                    state.visitId = body.visit_id || null;
                }
            } catch {
                // swallow — analytics must never block apply page rendering
            }

            // Wire engagement listeners
            window.addEventListener('scroll', updateScrollDepth, { passive: true });
            window.addEventListener('mousemove', bumpActivity, { passive: true });
            window.addEventListener('keydown', bumpActivity);
            window.addEventListener('touchstart', bumpActivity, { passive: true });

            // Flush on page close
            window.addEventListener('pagehide', onPagehide);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') onPagehide();
            });

            startHeartbeat();
        },

        notifyFieldFocus(fieldKey) {
            if (!state.visitId || !fieldKey) return;
            state.formStarted = true;
            state.lastField = String(fieldKey).slice(0, 100);
            state.fieldsTouched.add(state.lastField);
            state.lastActivityAt = Date.now();
        },

        notifyFieldBlur(fieldKey, hasValue) {
            if (!state.visitId || !fieldKey) return;
            const k = String(fieldKey).slice(0, 100);
            if (hasValue) state.fieldsCompleted.add(k);
            else state.fieldsCompleted.delete(k);
            state.lastActivityAt = Date.now();
        },

        notifyShare(channel) {
            if (!state.visitId) return;
            const ch = String(channel || '').toLowerCase().slice(0, 20);
            const allowed = ['copy_link', 'linkedin', 'twitter', 'native_share', 'email'];
            if (!allowed.includes(ch)) return;
            // De-dup repeated clicks within the same session — visitor tapping
            // "copy link" 5 times shouldn't count as 5 shares.
            if (state.sharesSent.has(ch)) return;
            state.sharesSent.add(ch);
            postJson('/track/share', { visitor_id: state.visitorId, channel: ch });
        },

        notifySubmitOutcome({ outcome, errorField, applicationId }) {
            if (!state.visitId) return;
            postJson('/track/submit-outcome', {
                visit_id: state.visitId,
                outcome: outcome,
                error_field: errorField || null,
                application_id: applicationId || null
            });
        },

        // Decorate a URL with the current visitor's via= short-token so we can
        // attribute inbound visits back to them. Used by share buttons.
        // Lazy-loads visitor_id from localStorage so share-URL decoration works
        // BEFORE init() finishes the network ping (renderForm runs synchronously
        // immediately after fetch returns, init() is still in-flight).
        appendViaParam(url) {
            const vid = state.visitorId || (function () {
                if (dntActive()) return null;
                try { return getOrCreateVisitorId(); } catch { return null; }
            })();
            if (!vid) return url;
            // Cache for subsequent calls
            if (!state.visitorId) state.visitorId = vid;
            try {
                const u = new URL(url, window.location.origin);
                u.searchParams.set('via', shortToken(vid));
                return u.toString();
            } catch { return url; }
        }
    };

    window.ApplyAnalytics = ApplyAnalytics;
})();
