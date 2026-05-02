// ============================================================
// Ragenaizer Service Worker  [BUILD 38 — KILL SWITCH]
//
// ⚠️ This is an EMERGENCY recovery build. Earlier BUILD 35 broke the
// Request constructor for navigate-mode page loads, leaving live users
// with a SW that prevented every ragenaizer.com page from rendering
// (Safari "Can't Open the Page", Chrome hung-spinner). Even after the
// fixed BUILD 36/37 was deployed, browsers still controlled by an old
// broken SW couldn't recover automatically — the broken SW kept
// intercepting requests.
//
// This build is a kill switch:
//   - NO fetch interception (browser handles all requests natively)
//   - On activate: delete every ragenaizer-* cache, unregister itself,
//     and reload every controlled tab so they bypass the dead SW.
//
// Push handler is preserved so FCM still delivers.
//
// Re-introduce a real caching SW only after live users have recovered
// (~24-48h to be safe), and roll any future fetch-interception change
// out behind a feature flag with a tested staging deploy first.
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
// INSTALL — Skip pre-caching. The SW is about to die anyway.
// ============================================================
self.addEventListener('install', (event) => {
    console.log(`[SW] [KILL SWITCH] Installing v${APP_VERSION}`);
    event.waitUntil(self.skipWaiting());
});

// ============================================================
// ACTIVATE — Wipe all caches, unregister self, reload every tab.
//
// This is the recovery path: existing browsers' SW.update() polling
// fetches this SW, which then removes itself and forces affected tabs
// to reload without any SW interception.
// ============================================================
self.addEventListener('activate', (event) => {
    console.log(`[SW] [KILL SWITCH] Activating v${APP_VERSION} — wiping caches and unregistering`);
    event.waitUntil((async () => {
        // 1. Wipe every cache we own. Removes the broken-SW-era entries.
        try {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames
                    .filter((name) => name.startsWith('ragenaizer-'))
                    .map((name) => {
                        console.log(`[SW] Deleting cache: ${name}`);
                        return caches.delete(name);
                    })
            );
        } catch (err) {
            console.warn('[SW] Cache wipe failed:', err);
        }

        // 2. Take control of any existing client so we can navigate them.
        try {
            await self.clients.claim();
        } catch (err) {
            console.warn('[SW] clients.claim failed:', err);
        }

        // 3. Reload every controlled tab. After reload they request the
        //    page natively (we have no fetch handler) and load fresh.
        try {
            const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const client of allClients) {
                try {
                    await client.navigate(client.url);
                } catch (navErr) {
                    // navigate() may fail across-origin or for cross-process clients.
                    // Fall back to a postMessage; sw-update.js handles RELOAD_NOW.
                    try { client.postMessage({ type: 'RELOAD_NOW', reason: 'sw-kill-switch' }); } catch (_) {}
                }
            }
        } catch (err) {
            console.warn('[SW] Client reload failed:', err);
        }

        // 4. Unregister self so no SW intercepts ragenaizer.com any more.
        try {
            await self.registration.unregister();
            console.log('[SW] Unregistered. Site will run without a SW until a new one is registered.');
        } catch (err) {
            console.warn('[SW] Self-unregister failed:', err);
        }
    })());
});

// ============================================================
// FETCH — Intentionally NOT registered.
// With no fetch handler, the browser handles every request natively
// (no SW interception, no caching, no broken-SW failure mode).
// ============================================================
// (no listener)

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
