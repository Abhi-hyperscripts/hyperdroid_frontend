// ============================================================
// Ragenaizer Service Worker
// Handles: Push Notifications (Firebase), Asset Caching, Version Updates
// ============================================================

// ── App Version (single source of truth: /js/sw-version.js) ──
importScripts('/js/sw-version.js');      // provides SW_VERSION
const APP_VERSION = SW_VERSION;
const CACHE_NAME = `ragenaizer-v${APP_VERSION}`;
const VERSION_CHECK_INTERVAL = 30 * 1000; // 30 seconds

// ── Notification debounce ──
// Prevents showing the same notification twice when both 'push' event
// and Firebase onBackgroundMessage fire for the same FCM message.
const NOTIFICATION_DEBOUNCE_MS = 2000;
let lastNotificationTime = 0;

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
// PUSH NOTIFICATIONS — Dual handler approach (matches OPRO pattern)
// ============================================================

// ── Shared notification display function with debounce ──
// Both the native 'push' handler and Firebase onBackgroundMessage call this.
// 2-second debounce prevents showing duplicate notifications.
function showPushNotification(notificationData) {
    const now = Date.now();

    // Debounce: skip if a notification was shown within the last 2 seconds
    if (now - lastNotificationTime < NOTIFICATION_DEBOUNCE_MS) {
        console.log('[SW] Debounced - notification already shown recently');
        return Promise.resolve();
    }
    lastNotificationTime = now;

    const title = notificationData.title || 'Ragenaizer';
    const body = notificationData.body || '';

    // Build absolute icon URLs
    const origin = self.location.origin;
    const icon = notificationData.icon || `${origin}/assets/notification-icon-v2.png`;
    const badge = `${origin}/assets/badge-icon.png`;

    const options = {
        body: body,
        icon: icon,
        badge: badge,
        tag: 'ragenaizer-' + now,  // Unique tag per notification
        renotify: true,
        requireInteraction: false,
        data: notificationData,
        vibrate: [200, 100, 200]
    };

    console.log('[SW] Showing notification:', title, '-', body);

    return self.registration.showNotification(title, options)
        .then(() => {
            console.log('[SW] Notification displayed successfully');
            // Clean up Chrome WebAPK phantom notifications
            return cleanupAutoNotification();
        })
        .catch((error) => {
            console.error('[SW] Error displaying notification:', error);
        });
}

// ── PRIMARY HANDLER: Native Web Push API ──
// Fires for ALL push events (FCM data-only and notification messages).
self.addEventListener('push', (event) => {
    console.log('[SW] Push event received');

    let notificationData = {};

    try {
        if (event.data) {
            const payload = event.data.json();
            console.log('[SW] Push payload:', JSON.stringify(payload));

            // FCM data-only messages: payload.data contains our custom fields
            const d = payload.data || {};
            // FCM notification messages: payload.notification has title/body
            const n = payload.notification || {};

            notificationData = {
                title: d.title || n.title || 'Ragenaizer',
                body: d.body || n.body || '',
                icon: d.icon || n.icon,
                ...d  // Include all data fields for notification click handling
            };
        }
    } catch (err) {
        console.warn('[SW] Failed to parse push data:', err);
        try {
            notificationData.body = event.data?.text() || '';
        } catch (_) {}
    }

    // CRITICAL: Use waitUntil to keep SW alive until notification is shown
    event.waitUntil(showPushNotification(notificationData));
});

// ── Chrome WebAPK phantom notification cleanup ──
async function cleanupAutoNotification() {
    // Check frequently for 10 seconds to catch late-created auto-notifications.
    // WebAPK's native push handler can create these at unpredictable times.
    const delays = [100, 200, 300, 500, 1000, 1000, 2000, 2000, 3000];
    for (const delay of delays) {
        await new Promise((r) => setTimeout(r, delay));
        const notifications = await self.registration.getNotifications();
        for (const n of notifications) {
            if (n.tag && n.tag.includes('user_visible_auto')) {
                console.log('[SW] Closing Chrome auto-notification:', n.tag);
                n.close();
            }
        }
    }
}

// ============================================================
// FIREBASE — Import SDK for proper Chrome WebAPK push integration
// ============================================================
// Firebase SDK in the SW ensures Chrome's WebAPK layer properly
// acknowledges push events, preventing "This site has been updated
// in the background" phantom notifications on Android.
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
firebase.initializeApp({
    apiKey: "AIzaSyD7hkVEbWubQaK8H1rEOEKFG3aDej_EcCs",
    authDomain: "ragenaizer.firebaseapp.com",
    projectId: "ragenaizer",
    storageBucket: "ragenaizer.firebasestorage.app",
    messagingSenderId: "888674952561",
    appId: "1:888674952561:web:944eea6556fdc87a5a82d0",
    measurementId: "G-60658KXB0N"
});

const messaging = firebase.messaging();

// ── SECONDARY HANDLER: Firebase onBackgroundMessage ──
// Fires when Firebase receives a data-only message while app is in background.
// Debounce prevents duplicate notification if push handler already showed one.
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Firebase onBackgroundMessage received:', JSON.stringify(payload));

    const d = payload.data || {};
    const n = payload.notification || {};

    const notificationData = {
        title: d.title || n.title || 'Ragenaizer',
        body: d.body || n.body || '',
        icon: d.icon || n.icon,
        ...d
    };

    return showPushNotification(notificationData);
});

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
