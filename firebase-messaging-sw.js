// ============================================================
// Ragenaizer Service Worker  [BUILD 36]
// Handles: Push Notifications (Firebase), Asset Caching, Version Updates
// ============================================================

// ── App Version (single source of truth: /js/sw-version.js) ──
importScripts('/js/sw-version.js');      // provides SW_VERSION
const APP_VERSION = SW_VERSION;
const CACHE_NAME = `ragenaizer-v${APP_VERSION}`;
const VERSION_CHECK_INTERVAL = 30 * 1000; // 30 seconds

// NOTE: Firebase SDK is intentionally NOT loaded in this service worker.
// FCM data-only messages are delivered via the standard Web Push API.
// The native 'push' event handler below receives them without Firebase SDK.
// Loading Firebase SDK here caused interference — its internal push handler
// called event.waitUntil() with a promise that didn't include showNotification(),
// causing Chrome Android to show "This site has been updated in the background".

// ── Assets to pre-cache on install ──
const PRECACHE_ASSETS = [
    '/',
    '/pages/login.html',
    '/pages/home.html',
    '/css/theme.css',
    '/css/styles.css',
    '/js/config.js',
    '/js/api.js',
    '/js/theme.js',
    '/js/navigation.js',
    '/js/toast.js',
    '/js/navbar.js',
    '/js/footer.js',
    '/js/cache-buster.js',
    '/js/firebase-init.js',
    '/js/cookie-consent.js',
    '/js/sw-update.js',
    '/js/pwa-install-prompt.js',
    '/assets/brand_logo.png',
    '/assets/notification-icon-v2.png',
    '/assets/badge-icon.png',
    '/assets/favicon-32x32.png',
    '/assets/favicon-16x16.png',
    '/manifest.json'
];

// ── Patterns that should NEVER be cached ──
const NO_CACHE_PATTERNS = [
    /\/api\//,           // API calls
    /sw-version\.js/,    // Version file must always be fresh
    /firebasestorage/,   // Firebase storage
    /googleapis\.com/,   // Google APIs
    /gstatic\.com/,      // Firebase SDK (let browser handle)
    /cdn\.jsdelivr/,     // CDN resources (let browser handle)
    /chrome-extension/,  // Browser extensions
    /\/js\/research\/insights\.js/,  // Public insights page — always fresh
    /\/pages\/research\/insights\.html/,  // Public insights page — always fresh
];

// ── Version check timer ──
let versionCheckTimer = null;

// ============================================================
// INSTALL — Pre-cache core assets, activate immediately
// ============================================================
self.addEventListener('install', (event) => {
    console.log(`[SW] Installing v${APP_VERSION}`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log(`[SW] Pre-caching ${PRECACHE_ASSETS.length} assets`);
                // Use addAll but don't fail install if some assets 404
                return Promise.allSettled(
                    PRECACHE_ASSETS.map((url) =>
                        cache.add(url).catch((err) => {
                            console.warn(`[SW] Failed to pre-cache: ${url}`, err.message);
                        })
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ============================================================
// ACTIVATE — Clean old caches, claim clients, start version check
// ============================================================
self.addEventListener('activate', (event) => {
    console.log(`[SW] Activating v${APP_VERSION}`);
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name.startsWith('ragenaizer-') && name !== CACHE_NAME)
                        .map((name) => {
                            console.log(`[SW] Deleting old cache: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
            .then(() => startVersionCheckLoop())
    );
});

// ============================================================
// FETCH — Network-first for everything (HTML, CSS, JS, images).
// Cache is purely an offline fallback.
//
// Why not stale-while-revalidate (the previous strategy for CSS/JS)?
//
//   SWR returned the cached file immediately and refreshed it in the
//   background — so the page rendered with the OLD content, and only
//   the NEXT reload picked up the new file. Combined with stripping
//   the ?v= query for cache matching, this meant every CSS/JS deploy
//   reached users one reload late, even when SW_VERSION was bumped.
//   Users in a long-running meeting tab could see stale UI for hours.
//
//   Network-first eliminates the race: every reload pulls fresh
//   content. The HTTP layer (ETag / Last-Modified / 304) keeps the
//   cost ~free for unchanged files. Cache only kicks in when the
//   network is actually unreachable (true offline).
// ============================================================
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip requests that should never be cached
    if (NO_CACHE_PATTERNS.some((pattern) => pattern.test(event.request.url))) return;

    // Skip cross-origin requests (CDNs, APIs, etc.)
    if (url.origin !== self.location.origin) return;

    // HTML pages
    if (event.request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html')) {
        event.respondWith(networkFirstStrategy(event.request));
        return;
    }

    // JS, CSS, images, fonts — same network-first strategy as HTML.
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp)$/.test(url.pathname)) {
        event.respondWith(networkFirstStrategy(event.request));
        return;
    }
});

// ── Network First ──
// Always try network. Cache the result under a query-stripped key so
// cache entries are reused across `?v=` cache-busts and serve offline.
async function networkFirstStrategy(request) {
    const cacheKey = stripVersionQuery(request);
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            // Use the stripped key so the next ?v= load can find this entry offline.
            cache.put(cacheKey, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        const cachedResponse = await caches.match(cacheKey);
        if (cachedResponse) {
            console.log(`[SW] Serving from cache (offline): ${request.url}`);
            return cachedResponse;
        }
        throw err;
    }
}

// Strip ?v=timestamp query param for consistent cache keys.
//
// CRITICAL: Top-level page navigations have request.mode === 'navigate', and
// per the Fetch spec the Request() constructor REJECTS that mode (only the
// browser can create navigate-mode Requests). Copying it through here throws
// TypeError, which propagates out of FetchEvent.respondWith and makes Safari
// (and Chrome) refuse to render ANY page — full-site outage.
//
// For navigate requests we return the original Request unchanged; the cache
// key just becomes the full URL. That's fine because navigations don't carry
// ?v= cache-bust queries anyway (only assets loaded by versioned <link>/
// <script> tags do).
function stripVersionQuery(request) {
    if (request.mode === 'navigate') {
        return request;
    }
    const url = new URL(request.url);
    if (!url.searchParams.has('v')) {
        return request; // No-op fast path — most requests don't carry ?v=
    }
    url.searchParams.delete('v');
    return new Request(url.toString(), {
        method: request.method,
        headers: request.headers,
        mode: request.mode,
        credentials: request.credentials,
        redirect: request.redirect,
    });
}

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

    event.waitUntil(
        self.registration.showNotification(title, {
            body: body,
            icon: icon || origin + '/assets/notification-icon-v2.png',
            badge: origin + '/assets/badge-icon.png',
            tag: 'ragenaizer-' + Date.now(),
            renotify: true,
            requireInteraction: !isHighFrequency,
            silent: false,
            data: data,
            vibrate: [200, 100, 200]
        }).then(function () {
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
