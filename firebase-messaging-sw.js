// ============================================================
// Ragenaizer Service Worker  [BUILD 39 — PUSH ONLY]
//
// Scope: web push notifications + click handling, NOTHING ELSE.
//
// Explicitly NOT here (and must stay out):
//   - fetch event handler
//   - cache pre-population
//   - asset caching (HTTP cache + ETag does this for free)
//
// Why: BUILD 35's fetch interception had a Request-constructor bug that
// took the entire site down for hours today. We replaced that SW with a
// kill switch (BUILD 38) that unregistered itself. This BUILD 39 brings
// back ONLY the push capability so FCM still works. If the day comes we
// want asset caching back, gate it behind staging tests and a feature
// flag. Never again add a fetch handler to this file without that.
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

// (PRECACHE_ASSETS and NO_CACHE_PATTERNS removed — no fetch handler uses them.)

// ── Version check timer ──
let versionCheckTimer = null;

// ============================================================
// INSTALL — minimal: take over immediately, no precaching.
// ============================================================
self.addEventListener('install', (event) => {
    console.log(`[SW] Installing push-only v${APP_VERSION}`);
    event.waitUntil(self.skipWaiting());
});

// ============================================================
// ACTIVATE — minimal: claim clients, start version-check loop.
// We don't manage any caches, so nothing to clean up.
// ============================================================
self.addEventListener('activate', (event) => {
    console.log(`[SW] Activating push-only v${APP_VERSION}`);
    event.waitUntil((async () => {
        try { await self.clients.claim(); } catch (err) { console.warn('[SW] claim failed:', err); }
        try { startVersionCheckLoop(); } catch (err) { console.warn('[SW] version check loop failed:', err); }
    })());
});

// ============================================================
// FETCH — intentionally NOT registered. See file header.
// Browser handles every request natively. Do not add a fetch
// listener here without staging tests; BUILD 35 took the site
// down by getting this exact thing wrong.
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
