// ============================================================
// Ragenaizer Service Worker
// Handles: Push Notifications (Firebase), Asset Caching, Version Updates
// ============================================================

// ── App Version (single source of truth: /js/sw-version.js) ──
importScripts('/js/sw-version.js');      // provides SW_VERSION
const APP_VERSION = SW_VERSION;
const CACHE_NAME = `ragenaizer-v${APP_VERSION}`;
const VERSION_CHECK_INTERVAL = 30 * 1000; // 30 seconds

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
// FETCH — Network-first for HTML, Stale-while-revalidate for JS/CSS/assets
// ============================================================
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip requests that should never be cached
    if (NO_CACHE_PATTERNS.some((pattern) => pattern.test(event.request.url))) return;

    // Skip cross-origin requests (CDNs, APIs, etc.)
    if (url.origin !== self.location.origin) return;

    // HTML pages — Network first, fall back to cache
    if (event.request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html')) {
        event.respondWith(networkFirstStrategy(event.request));
        return;
    }

    // JS, CSS, images — Stale-while-revalidate
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp)$/.test(url.pathname)) {
        event.respondWith(staleWhileRevalidateStrategy(event.request));
        return;
    }
});

// ── Network First (HTML) ──
// Try network, cache the response, fall back to cache if offline
async function networkFirstStrategy(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log(`[SW] Serving from cache (offline): ${request.url}`);
            return cachedResponse;
        }
        throw err;
    }
}

// ── Stale While Revalidate (JS/CSS/assets) ──
// Return cached version immediately, update cache in background
async function staleWhileRevalidateStrategy(request) {
    const cache = await caches.open(CACHE_NAME);

    // Strip ?v= query params for cache matching (we version via SW, not query strings)
    const cacheKey = stripVersionQuery(request);

    const cachedResponse = await cache.match(cacheKey);

    // Fetch fresh copy in background
    const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse.ok) {
            cache.put(cacheKey, networkResponse.clone());
        }
        return networkResponse;
    }).catch(() => null);

    // Return cached version if available, otherwise wait for network
    if (cachedResponse) {
        return cachedResponse;
    }
    return fetchPromise;
}

// Strip ?v=timestamp query param for consistent cache keys
function stripVersionQuery(request) {
    const url = new URL(request.url);
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
});

// ============================================================
// PUSH NOTIFICATIONS — Standard Web Push handler
// ============================================================
// CRITICAL: This listener MUST be registered BEFORE Firebase imports.
// firebase.messaging() registers its own internal push handler. For
// data-only messages it does nothing (no notification shown). iOS Safari
// counts that as a "silent push" and revokes the push subscription
// after 3 silent pushes. By registering our handler first, we guarantee
// showNotification() is called via event.waitUntil() before Firebase's
// handler runs, so iOS never considers it silent.
self.addEventListener('push', (event) => {
    console.log('[SW] Push event received');

    let title = 'Ragenaizer';
    let body = '';
    let icon = '/assets/notification-icon-v2.png';
    let badge = '/assets/favicon-32x32.png';
    let tag = 'ragenaizer-notification';
    let data = {};

    try {
        if (event.data) {
            const payload = event.data.json();
            console.log('[SW] Push payload:', JSON.stringify(payload));

            // FCM data-only messages: payload.data contains our custom fields
            const d = payload.data || {};
            // FCM notification messages: payload.notification has title/body
            const n = payload.notification || {};

            title = d.title || n.title || title;
            body  = d.body  || n.body  || body;
            icon  = d.icon  || n.icon  || icon;
            tag   = d.tag   || tag;
            data  = d;
        }
    } catch (err) {
        console.warn('[SW] Failed to parse push data:', err);
        try { body = event.data?.text() || ''; } catch (_) {}
    }

    event.waitUntil(
        self.registration.showNotification(title, { body, icon, badge, tag, data })
            .then(() => cleanupAutoNotification())
    );
});

// Chrome WebAPK sometimes generates a phantom "This site has been updated in
// the background" notification (tag: user_visible_auto_notification) alongside
// our real notification. Proactively close it.
async function cleanupAutoNotification() {
    // Short delay to let Chrome create the auto-notification first
    await new Promise((r) => setTimeout(r, 100));
    const notifications = await self.registration.getNotifications();
    for (const n of notifications) {
        if (n.tag && n.tag.includes('user_visible_auto')) {
            console.log('[SW] Closing Chrome auto-notification:', n.tag);
            n.close();
        }
    }
}

// ============================================================
// FIREBASE — Intentionally NOT imported in Service Worker
// ============================================================
// firebase-messaging-compat.js registers its own internal 'push' handler.
// For data-only FCM messages that handler does nothing visible, causing
// Chrome/Samsung Internet to show "This site has been updated in the
// background".  All push handling is done by our listener above.
//
// getToken() on the main page works without firebase.messaging() in the
// SW — it only needs the SW registration's pushManager.subscribe().
// Token management (subscribe/unsubscribe) is handled by the main page.

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
