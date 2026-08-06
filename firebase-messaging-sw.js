// ============================================================
// Ragenaizer Service Worker  [BUILD 40 — PUSH + STATIC ASSET CACHE]
//
// Scope: web push notifications, click handling, AND a tightly-scoped
// stale-while-revalidate cache for static assets.
//
// The fetch handler here was deliberately absent from BUILD 39 because
// BUILD 35's broken fetch handler took the site down for hours. BUILD 40
// reintroduces it with the safety harness that was missing from BUILD 35:
//
//   1. Same-origin GETs only — third-party + non-GET request the network.
//   2. Allow-list path prefixes only (/css/, /js/, /assets/, /pages/...).
//   3. Hard-deny pattern list (/api/*, /hubs/*, *.html) — even if those
//      ever land under an allowed prefix they're never cached.
//   4. Every cache touch wrapped in try/catch — any error falls THROUGH
//      to plain fetch() so a logic bug = "no caching", not "site down".
//   5. Kill switch: visiting any page with ?nosw=1 unregisters the SW
//      from the client side (firebase-messaging-sw.js is HTML's friend,
//      this is the user's-out).
//   6. Cache name embeds SW_VERSION → bumping the version purges old
//      caches in the activate event below.
//
// If anything visibly slow / broken: bump SW_VERSION (forces a fresh
// install which clears the old cache entries) OR ship a build that
// removes the fetch listener entirely (the BUILD 39 layout).
// ============================================================

// ── App Version (single source of truth: /js/sw-version.js) ──
importScripts('/js/sw-version.js');      // provides SW_VERSION
const APP_VERSION = SW_VERSION;
const VERSION_CHECK_INTERVAL = 30 * 1000; // 30 seconds

// NOTE: Firebase SDK is intentionally NOT loaded in this service worker.
// FCM data-only messages are delivered via the standard Web Push API.
// The native 'push' event handler below receives them without Firebase SDK.
// Loading Firebase SDK here caused interference — its internal push handler
// called event.waitUntil() with a promise that didn't include showNotification(),
// causing Chrome Android to show "This site has been updated in the background".

// ── Static asset cache (Track B, BUILD 40) ────────────────────────────
// Per-version cache name: bumping SW_VERSION naturally purges old caches
// in the activate event below.
const STATIC_CACHE = `ragenaizer-static-v${SW_VERSION}`;

// The one page we deliberately keep a copy of. Page HTML is never cached —
// see NEVER_CACHE_PATTERNS below — because a stale ledger or payslip is worse
// than no page at all. This shell is the exception: it holds no data, so it
// can never be stale, and it turns a dead browser error page into ours.
const OFFLINE_URL = '/offline.html';

// Same-origin path prefixes we're willing to serve from cache.
// Anything OUTSIDE this list (including HTML, API, SignalR) goes to network
// untouched, regardless of any allow logic above.
const CACHEABLE_PREFIXES = ['/css/', '/js/', '/assets/'];

// Hard exclusions inside the cacheable prefixes — defence in depth.
// We never cache anything that could change per-request or per-user.
const NEVER_CACHE_PATTERNS = [
    /\/api\//i,
    /\/hubs\//i,
    /\.html(?:\?|$)/i,
    /\/sw-version\.js/i,   // version probe — must always be fresh
    /\/js\/accounts\/scanner\.js/i,   // phone-scanner logic — tiny file, phones must never run a stale copy
];

// Strip cache-buster query so SW_VERSION is the only invalidation knob.
// Without this, every page-load's `?v=Date.now()` would miss the cache.
function stableCacheKey(urlString) {
    try {
        const u = new URL(urlString);
        u.searchParams.delete('v');
        u.searchParams.delete('_');
        return u.toString();
    } catch (_) {
        return urlString;
    }
}

function isCacheable(url) {
    if (url.origin !== self.location.origin) return false;
    if (!CACHEABLE_PREFIXES.some(p => url.pathname.startsWith(p))) return false;
    if (NEVER_CACHE_PATTERNS.some(rx => rx.test(url.pathname))) return false;
    return true;
}

// Stale-while-revalidate: cached copy answers immediately (fast); a
// background fetch refreshes the cache for next time. ALL paths wrapped
// in try/catch — any error falls through to a plain fetch() so a buggy
// strategy can't take the site down.
async function staleWhileRevalidate(request) {
    try {
        const cache = await caches.open(STATIC_CACHE);
        const cacheKey = stableCacheKey(request.url);
        const cached = await cache.match(cacheKey);

        const refresh = (async () => {
            try {
                const fresh = await fetch(request);
                if (fresh && fresh.ok && fresh.status === 200) {
                    try { await cache.put(cacheKey, fresh.clone()); } catch (_) {}
                }
                return fresh;
            } catch (_) { return null; }
        })();

        if (cached) {
            // Don't await — let it update in the background.
            refresh.catch(() => {});
            return cached;
        }
        const fresh = await refresh;
        return fresh || new Response('', { status: 504, statusText: 'SW: offline' });
    } catch (err) {
        console.warn('[SW] cache fault, falling through to network:', err);
        return fetch(request);
    }
}

self.addEventListener('fetch', (event) => {
    try {
        if (event.request.method !== 'GET') return;
        const url = new URL(event.request.url);

        // Navigations stay network-FIRST — always the live page, never a cached
        // one — and fall back to the offline shell only when the fetch itself
        // fails. A 404 or a 500 is a real answer from the server and is passed
        // through untouched.
        if (event.request.mode === 'navigate') {
            event.respondWith((async () => {
                try {
                    return await fetch(event.request);
                } catch (_) {
                    const cache = await caches.open(STATIC_CACHE);
                    const shell = await cache.match(OFFLINE_URL);
                    return shell || new Response('Offline', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain' }
                    });
                }
            })());
            return;
        }

        if (!isCacheable(url)) return;
        event.respondWith(staleWhileRevalidate(event.request));
    } catch (err) {
        console.warn('[SW] fetch listener error, fall-through:', err);
        // Don't call respondWith — browser handles natively.
    }
});

// ── Version check timer ──
let versionCheckTimer = null;

// ============================================================
// INSTALL — minimal: take over immediately, no precaching.
// ============================================================
self.addEventListener('install', (event) => {
    console.log(`[SW] Installing push-only v${APP_VERSION}`);
    event.waitUntil((async () => {
        // The offline shell is the only thing precached, and a failure to fetch
        // it must never block the install — the site works fine without it.
        try {
            const cache = await caches.open(STATIC_CACHE);
            await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
        } catch (err) {
            console.warn('[SW] offline shell not precached:', err);
        }
        await self.skipWaiting();
    })());
});

// ============================================================
// ACTIVATE — claim clients, prune stale per-version caches, start
// the version-check loop.
// ============================================================
self.addEventListener('activate', (event) => {
    console.log(`[SW] Activating v${APP_VERSION} (cache=${STATIC_CACHE})`);
    event.waitUntil((async () => {
        try { await self.clients.claim(); } catch (err) { console.warn('[SW] claim failed:', err); }
        // Purge any old per-version caches from previous SW_VERSIONs.
        try {
            const names = await caches.keys();
            await Promise.all(
                names
                    .filter(n => n.startsWith('ragenaizer-static-v') && n !== STATIC_CACHE)
                    .map(n => caches.delete(n))
            );
        } catch (err) { console.warn('[SW] cache prune failed:', err); }
        try { startVersionCheckLoop(); } catch (err) { console.warn('[SW] version check loop failed:', err); }
    })());
});

// ============================================================
// FETCH — registered above (BUILD 40). See header for the safety
// invariants that must NEVER be removed without staging tests.
// ============================================================

// ============================================================
// VERSION CHECK — Fetch /js/sw-version.js every 30 seconds, parse SW_VERSION
// ============================================================
function startVersionCheckLoop() {
    if (versionCheckTimer) clearInterval(versionCheckTimer);

    // Initial check after 5 seconds (let things settle)
    setTimeout(checkForUpdate, 5000);

    // Then check every 30 seconds
    versionCheckTimer = setInterval(checkForUpdate, VERSION_CHECK_INTERVAL);
    console.log(`[SW] Version check loop started (every ${VERSION_CHECK_INTERVAL / 1000}s)`);
}

async function checkForUpdate() {
    try {
        const response = await fetch('/js/sw-version.js?_=' + Date.now(), {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' }
        });

        if (!response.ok) return;

        const text = await response.text();
        const match = text.match(/const\s+SW_VERSION\s*=\s*(\d+)/);
        if (!match) return;

        const serverVersion = parseInt(match[1], 10);

        if (serverVersion && serverVersion !== APP_VERSION) {
            console.log(`[SW] New version detected! Current: ${APP_VERSION}, Server: ${serverVersion}`);

            // Notify all clients about the update
            const allClients = await self.clients.matchAll({ type: 'window' });
            allClients.forEach((client) => {
                client.postMessage({
                    type: 'APP_UPDATE_AVAILABLE',
                    currentVersion: APP_VERSION,
                    newVersion: serverVersion
                });
            });

            // Stop checking — the new SW will take over after refresh
            if (versionCheckTimer) {
                clearInterval(versionCheckTimer);
                versionCheckTimer = null;
            }

            // Trigger the browser to check for a new SW file
            self.registration.update();
        }
    } catch (err) {
        // Silently fail — user might be offline
    }
}

// ── Handle messages from clients ──
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data === 'CHECK_UPDATE') {
        checkForUpdate();
    }

    // Respond with actual running version so the page can detect stale SW code
    if (event.data === 'GET_VERSION') {
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ type: 'SW_VERSION_RESPONSE', version: APP_VERSION });
        }
    }

    // Kill switch: client can ask us to wipe the static cache without
    // forcing an unregister + reinstall cycle. Used by ?nosw=1 escape hatch.
    if (event.data === 'KILL_STATIC_CACHE') {
        event.waitUntil((async () => {
            try {
                const names = await caches.keys();
                await Promise.all(
                    names.filter(n => n.startsWith('ragenaizer-static-')).map(n => caches.delete(n))
                );
                console.log('[SW] static cache wiped on client request');
            } catch (err) { console.warn('[SW] kill-static-cache failed:', err); }
        })());
    }
});

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================

// ── Push handler (v32) ──
// Chrome Android WebAPK has a KNOWN BUG (Chromium #378103918):
// After event.waitUntil() resolves, Chrome counts visible notifications via
// an async DB query. If showNotification()'s write hasn't been committed yet,
// count=0 → Chrome creates a phantom "updated in background" notification.
//
// Strategy: Show notification immediately, then run MULTIPLE cleanup passes
// to catch the phantom regardless of Chrome's internal timing.
self.addEventListener('push', (event) => {
    let title = 'Ragenaizer';
    let body = '';
    let icon = null;
    let data = {};

    try {
        if (event.data) {
            const payload = event.data.json();
            const d = payload.data || {};
            title = d.title || 'Ragenaizer';
            body = d.body || '';
            icon = d.icon || null;
            data = { ...d, title, body };
        }
    } catch (_) {
        try { body = event.data?.text() || ''; } catch (__) {}
    }

    const origin = self.location.origin;

    // Helper: scan notifications and close any Chrome phantom
    function closePhantoms() {
        return self.registration.getNotifications().then(function (notifications) {
            for (var i = 0; i < notifications.length; i++) {
                var n = notifications[i];
                // Chrome phantom: no data (or empty data) AND body mentions "updated in the background"
                var hasNoData = !n.data || Object.keys(n.data).length === 0;
                var isPhantom = hasNoData && n.body && n.body.indexOf('updated in the background') !== -1;
                if (isPhantom) {
                    n.close();
                }
            }
        }).catch(function () {});
    }

    // Lock-screen / Doze visibility on Android Chrome WebAPK is gated by the
    // notification channel's importance, which Chrome creates from the FIRST
    // notification's options. requireInteraction:true registers the channel as
    // IMPORTANCE_HIGH — wakes the device, shows on lock screen, doesn't get
    // batched in Doze mode. Without it, the SW's showNotification() runs but
    // Android sits on the toast until the user unlocks (the symptom we hit
    // 2026-04-27 with FB Lead Ads pushes).
    //
    // Chat is high-frequency / lower-signal — let it auto-dismiss so the
    // tray doesn't fill up. Everything else (leads, deals, help-requests,
    // task assignments, etc.) is sticky until tapped.
    var isHighFrequency = data && data.notification_type === 'chat_message';

    // Per-service badge (option G, web): the backend sends `source_icon` — the
    // per-service icon URL (ragenaizer.com/assets/notif/<service>.png). Show it
    // as the notification `image` so the tray shows which app produced it, the
    // same way Android/iOS do — which is why the "[CRM]" text tag was dropped.
    var sourceIcon = (data && data.source_icon) || null;
    var notifOptions = {
        body: body,
        icon: icon || origin + '/assets/notification-icon-v2.png',
        badge: origin + '/assets/badge-icon.png',
        tag: 'ragenaizer-' + Date.now(),
        renotify: true,
        requireInteraction: !isHighFrequency,
        silent: false,
        data: data,
        vibrate: [200, 100, 200]
    };
    if (sourceIcon) notifOptions.image = sourceIcon;

    event.waitUntil(
        self.registration.showNotification(title, notifOptions).then(function () {
            // Multiple cleanup passes to catch Chrome's phantom regardless of timing.
            // Chrome creates phantom 15-200ms after showNotification resolves,
            // but sometimes later on slow devices.
            return new Promise(function (resolve) {
                var passes = [150, 400, 800, 1500];
                var done = 0;
                for (var i = 0; i < passes.length; i++) {
                    (function (delay) {
                        setTimeout(function () {
                            closePhantoms().then(function () {
                                done++;
                                if (done === passes.length) resolve();
                            });
                        }, delay);
                    })(passes[i]);
                }
            });
        }).catch(function () {})
    );
});

// ============================================================
// NOTIFICATION CLICK
// ============================================================

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked:', event.notification);
    event.notification.close();

    const urlToOpen = event.notification.data?.url || '/pages/home.html';
    const isChatNotification = event.notification.data?.notification_type === 'chat_message';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (isChatNotification) {
                for (const client of clientList) {
                    if (client.url.includes('/pages/chat/chat.html') && 'focus' in client) {
                        client.navigate(self.location.origin + urlToOpen);
                        return client.focus();
                    }
                }
            }

            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(self.location.origin + urlToOpen);
                    return client.focus();
                }
            }

            return clients.openWindow(urlToOpen);
        })
    );
});
