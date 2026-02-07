// ============================================================
// Ragenaizer Service Worker
// Handles: Push Notifications (Firebase), Asset Caching, Version Updates
// ============================================================

// ── App Version ──
// This MUST match SW_VERSION in /js/config.js.
// When you deploy, increment SW_VERSION in config.js AND here.
// The SW fetches config.js every 30s to detect mismatches.
// SW_VERSION_MARKER: v5
const APP_VERSION = 5;
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
// VERSION CHECK — Fetch /js/config.js every 30 seconds, parse SW_VERSION
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
        const response = await fetch('/js/config.js?_=' + Date.now(), {
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
// FIREBASE CLOUD MESSAGING
// ============================================================
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Firebase config — must match Frontend/js/config.js FIREBASE_CONFIG
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

// Handle background push notifications.
// IMPORTANT: FCM messages MUST be sent as data-only (no "notification" field).
// If "notification" field is present, the browser auto-displays it AND this
// handler fires, causing DUPLICATE notifications. Data-only messages only
// trigger this handler.
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Background message received:', payload);

    const notificationTitle = payload.data?.title || 'Ragenaizer';
    const notificationOptions = {
        body: payload.data?.body || '',
        icon: payload.data?.icon || '/assets/notification-icon-v2.png',
        badge: '/assets/favicon-32x32.png',
        tag: payload.data?.tag || 'ragenaizer-notification',
        data: payload.data || {}
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
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
