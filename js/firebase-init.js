/**
 * Firebase Cloud Messaging (FCM) initialization for web push notifications.
 *
 * Dependencies: config.js (FIREBASE_CONFIG, FIREBASE_VAPID_KEY, STORAGE_PREFIX), api.js (api instance)
 * Loaded after api.js on authenticated pages (login.html, home.html).
 * Other pages bootstrap FCM via navigation.js dynamic loading.
 */

// ==================== localStorage Keys ====================
const _FCM_KEYS = {
    token: `${STORAGE_PREFIX}fcm_token`,
    registered: `${STORAGE_PREFIX}fcm_registered`,
    permission: `${STORAGE_PREFIX}fcm_permission`,
    failCount: `${STORAGE_PREFIX}fcm_fail_count`,
    failTimestamp: `${STORAGE_PREFIX}fcm_fail_timestamp`
};

// ==================== Device/Browser Detection ====================
function _detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'web';
}

function _detectBrowser() {
    const ua = navigator.userAgent || '';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/Edg\//i.test(ua)) return 'edge';
    if (/Firefox/i.test(ua)) return 'firefox';
    if (/CriOS|Chrome/i.test(ua) && !/Edg/i.test(ua)) return 'chrome';
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'safari';
    return 'unknown';
}

// ==================== In-memory State ====================
let _firebaseApp = null;
let _messaging = null;
let _currentFcmToken = null;
let _fcmRegistrationInProgress = false;

// Restore cached token from localStorage on load
_currentFcmToken = localStorage.getItem(_FCM_KEYS.token) || null;

// When the SW controller changes (new SW takes over), the old push subscription
// and FCM token become invalid. Force re-registration on next opportunity.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[FCM] SW controller changed — clearing registration flag for re-registration');
        localStorage.removeItem(_FCM_KEYS.registered);
        _currentFcmToken = null;
        // Attempt re-registration after a short delay (let new SW settle)
        setTimeout(() => {
            if (!_fcmRegistrationInProgress) {
                ensureFcmTokenRegistered(true).catch(() => {});
            }
        }, 3000);
    });
}

/**
 * Load Firebase SDK scripts from CDN.
 * Returns a promise that resolves when both scripts are loaded.
 */
function _loadFirebaseScripts() {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (window.firebase && window.firebase.messaging) {
            resolve();
            return;
        }

        const appScript = document.createElement('script');
        appScript.src = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js';
        appScript.onload = () => {
            const msgScript = document.createElement('script');
            msgScript.src = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js';
            msgScript.onload = () => resolve();
            msgScript.onerror = () => reject(new Error('Failed to load firebase-messaging SDK'));
            document.head.appendChild(msgScript);
        };
        appScript.onerror = () => reject(new Error('Failed to load firebase-app SDK'));
        document.head.appendChild(appScript);
    });
}

/**
 * Initialize Firebase app and messaging.
 * Safe to call multiple times — only initializes once.
 */
async function _initFirebase() {
    if (_messaging) return _messaging;

    await _loadFirebaseScripts();

    if (!firebase.apps.length) {
        _firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
    } else {
        _firebaseApp = firebase.apps[0];
    }

    _messaging = firebase.messaging();
    return _messaging;
}

/**
 * Register the Firebase service worker.
 */
async function _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('[FCM] Service workers not supported');
        return null;
    }

    try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
            scope: '/',
            updateViaCache: 'none'  // Always check server for SW updates
        });
        console.log('[FCM] Service worker registered:', registration.scope);

        // Helper: wait for a SW to reach 'activated' state
        function waitForActivation(sw) {
            return new Promise((resolve) => {
                if (sw.state === 'activated') { resolve(); return; }
                sw.addEventListener('statechange', () => {
                    if (sw.state === 'activated') resolve();
                });
            });
        }

        // If a new SW is waiting, tell it to activate and wait
        if (registration.waiting) {
            console.log('[FCM] New service worker waiting, activating...');
            registration.waiting.postMessage('SKIP_WAITING');
            await waitForActivation(registration.waiting);
            console.log('[FCM] Waiting SW now active');
        }

        // If a new SW is installing, wait for it to finish
        if (registration.installing) {
            console.log('[FCM] New service worker installing, waiting...');
            const installingSW = registration.installing;
            await new Promise((resolve) => {
                installingSW.addEventListener('statechange', () => {
                    if (installingSW.state === 'installed') {
                        // Now it's installed and waiting — tell it to activate
                        installingSW.postMessage('SKIP_WAITING');
                    }
                    if (installingSW.state === 'activated') {
                        resolve();
                    }
                });
                if (installingSW.state === 'activated') resolve();
            });
            console.log('[FCM] Installing SW now active');
        }

        // Wait for any active SW (first install case)
        if (!registration.active) {
            const sw = registration.installing || registration.waiting;
            if (sw) {
                await waitForActivation(sw);
                console.log('[FCM] Service worker now active');
            }
        } else {
            console.log('[FCM] Service worker already active');
        }

        // Listen for future updates — if SW updates mid-session, re-register token
        registration.addEventListener('updatefound', () => {
            const newSW = registration.installing;
            if (newSW) {
                newSW.addEventListener('statechange', () => {
                    if (newSW.state === 'activated') {
                        console.log('[FCM] SW updated mid-session, scheduling re-registration');
                        // Clear registered flag so next ensureFcmTokenRegistered() does a full re-register
                        localStorage.removeItem(_FCM_KEYS.registered);
                    }
                });
            }
        });

        return registration;
    } catch (err) {
        console.error('[FCM] Service worker registration failed:', err);
        return null;
    }
}

// ==================== NEW: Split Functions ====================

/**
 * Request notification permission ONLY — no Firebase loading, no token.
 * This is fast enough to await during login (just a browser dialog).
 * @returns {string} 'granted', 'denied', or 'default'
 */
async function requestNotificationPermissionOnly() {
    try {
        if (!('Notification' in window)) {
            console.warn('[FCM] Notifications not supported in this browser');
            return 'denied';
        }

        // Check if VAPID key is configured
        if (!FIREBASE_VAPID_KEY || FIREBASE_VAPID_KEY === 'PASTE_YOUR_VAPID_KEY_HERE') {
            console.warn('[FCM] VAPID key not configured. Skipping notification permission.');
            return 'default';
        }

        // If already decided, return cached result without prompting
        const current = Notification.permission;
        if (current !== 'default') {
            localStorage.setItem(_FCM_KEYS.permission, current);
            console.log(`[FCM] Permission already ${current}`);
            return current;
        }

        // Show the browser permission dialog
        console.log('[FCM] Requesting notification permission...');
        const permission = await Notification.requestPermission();
        localStorage.setItem(_FCM_KEYS.permission, permission);
        console.log(`[FCM] Permission result: ${permission}`);
        return permission;
    } catch (err) {
        console.error('[FCM] Error requesting permission:', err);
        return 'default';
    }
}

/**
 * Ensure FCM token is registered with the backend.
 * Checks localStorage first — no-op if already registered (unless force=true).
 * Does NOT prompt for permission — only proceeds if permission is 'granted'.
 *
 * @param {boolean} [force=false] - Force re-registration even if already registered
 * @returns {string|null} The FCM token, or null if not registered
 */
async function ensureFcmTokenRegistered(force = false) {
    try {
        // Prevent concurrent registration attempts
        if (_fcmRegistrationInProgress) {
            console.log('[FCM] Registration already in progress, skipping');
            return _currentFcmToken;
        }

        // Check if browser supports notifications
        if (!('Notification' in window)) {
            console.warn('[FCM] Notifications not supported');
            return null;
        }

        // Check if VAPID key is configured
        if (!FIREBASE_VAPID_KEY || FIREBASE_VAPID_KEY === 'PASTE_YOUR_VAPID_KEY_HERE') {
            console.warn('[FCM] VAPID key not configured');
            return null;
        }

        // Force re-registration when SW version changes (ensures platform/browser info is updated)
        const lastRegisteredVersion = localStorage.getItem(`${STORAGE_PREFIX}fcm_version`);
        if (lastRegisteredVersion !== String(SW_VERSION)) {
            console.log(`[FCM] Version changed (${lastRegisteredVersion} → ${SW_VERSION}), forcing re-registration`);
            force = true;
        }

        // Check if already registered (fast path)
        if (!force && localStorage.getItem(_FCM_KEYS.registered) === 'true' && _currentFcmToken) {
            // Validate the actual push subscription is still valid
            // Catches scenarios where SW is cleared/updated but localStorage still has the old flag
            try {
                const reg = await navigator.serviceWorker.ready;
                const subscription = await reg.pushManager.getSubscription();
                if (!subscription) {
                    console.log('[FCM] Push subscription lost, forcing re-registration');
                    force = true;
                    // Fall through to full registration below
                } else {
                    console.log('[FCM] Already registered, subscription valid');
                    return _currentFcmToken;
                }
            } catch (e) {
                console.warn('[FCM] Could not check subscription, using cached token:', e);
                return _currentFcmToken;
            }
        }

        // Check permission — don't prompt from random pages
        const permission = Notification.permission;
        if (permission === 'default') {
            console.log('[FCM] Permission not yet requested, skipping (will prompt at login)');
            return null;
        }
        if (permission === 'denied') {
            console.log('[FCM] Permission denied, skipping');
            return null;
        }

        // Check if user is authenticated
        if (typeof api === 'undefined' || !api || !api.isAuthenticated()) {
            console.warn('[FCM] Not authenticated, skipping registration');
            return null;
        }

        // Check failure backoff (max 3 failures, auto-reset after 5 minutes)
        const failCount = parseInt(localStorage.getItem(_FCM_KEYS.failCount) || '0', 10);
        const failTimestamp = parseInt(localStorage.getItem(_FCM_KEYS.failTimestamp) || '0', 10);
        if (failCount >= 3 && !force) {
            // Auto-reset fail count after 5 minutes so PWA recovers from transient errors
            if (failTimestamp && (Date.now() - failTimestamp > 5 * 60 * 1000)) {
                console.log('[FCM] Fail backoff expired, resetting and retrying');
                localStorage.setItem(_FCM_KEYS.failCount, '0');
                localStorage.removeItem(_FCM_KEYS.failTimestamp);
            } else {
                console.warn(`[FCM] Too many failures (${failCount}), backing off`);
                return null;
            }
        }

        _fcmRegistrationInProgress = true;
        console.log('[FCM] Starting full token registration...');

        // Initialize Firebase
        const messaging = await _initFirebase();

        // Register service worker
        const swRegistration = await _registerServiceWorker();

        // Get FCM token
        const tokenOptions = { vapidKey: FIREBASE_VAPID_KEY };
        if (swRegistration) {
            tokenOptions.serviceWorkerRegistration = swRegistration;
        }

        const token = await messaging.getToken(tokenOptions);
        if (token) {
            console.log('[FCM] Token acquired:', token.substring(0, 20) + '...');
            _currentFcmToken = token;
            localStorage.setItem(_FCM_KEYS.token, token);

            // Register with backend
            await registerTokenWithBackend(token);

            // Mark as registered with current version
            localStorage.setItem(_FCM_KEYS.registered, 'true');
            localStorage.setItem(_FCM_KEYS.failCount, '0');
            localStorage.removeItem(_FCM_KEYS.failTimestamp);
            localStorage.setItem(`${STORAGE_PREFIX}fcm_version`, String(SW_VERSION));
            console.log('[FCM] Token registered successfully (v' + SW_VERSION + ')');
            return token;
        } else {
            console.warn('[FCM] No token received');
            _incrementFailCount();
            return null;
        }
    } catch (err) {
        console.error('[FCM] Error during token registration:', err);
        _incrementFailCount();
        return null;
    } finally {
        _fcmRegistrationInProgress = false;
    }
}

/**
 * Increment the failure counter in localStorage.
 */
function _incrementFailCount() {
    const current = parseInt(localStorage.getItem(_FCM_KEYS.failCount) || '0', 10);
    localStorage.setItem(_FCM_KEYS.failCount, String(current + 1));
    localStorage.setItem(_FCM_KEYS.failTimestamp, String(Date.now()));
}

/**
 * Request notification permission and get FCM token.
 * BACKWARD-COMPATIBLE wrapper — calls both new functions.
 * @returns {string|null} The FCM token, or null if permission denied or error.
 */
async function requestNotificationPermission() {
    const permission = await requestNotificationPermissionOnly();
    if (permission !== 'granted') {
        return null;
    }
    return await ensureFcmTokenRegistered(true);
}

/**
 * Register FCM token with the NotificationService backend.
 * @param {string} fcmToken
 */
async function registerTokenWithBackend(fcmToken) {
    try {
        if (!api || !api.isAuthenticated()) {
            console.warn('[FCM] Not authenticated, skipping token registration');
            return;
        }

        const platform = _detectPlatform();
        const browser = _detectBrowser();
        const version = typeof SW_VERSION !== 'undefined' ? SW_VERSION : 0;
        const result = await api.registerDeviceToken(fcmToken, platform, browser, version);
        console.log('[FCM] Token registered with backend:', result);
    } catch (err) {
        console.error('[FCM] Failed to register token with backend:', err);
        throw err; // Re-throw so ensureFcmTokenRegistered can track the failure
    }
}

/**
 * Set up foreground message handler.
 * Shows a toast notification when a message arrives while the app is in focus.
 * @param {function} [callback] - Optional callback with the message payload
 */
async function setupForegroundMessageHandler(callback) {
    try {
        const messaging = await _initFirebase();

        messaging.onMessage((payload) => {
            console.log('[FCM] Foreground message:', payload);

            const title = payload.notification?.title || payload.data?.title || 'Notification';
            const body = payload.notification?.body || payload.data?.body || '';

            // Don't show native Notification here - the service worker already
            // handles that via onBackgroundMessage / push event.  Showing one
            // here too causes DUPLICATE system notifications.

            // Show toast if Toast utility is available
            if (typeof Toast !== 'undefined' && Toast.info) {
                Toast.info(`${title}: ${body}`);
            }

            if (callback) {
                callback(payload);
            }
        });

        console.log('[FCM] Foreground message handler set up');
    } catch (err) {
        console.error('[FCM] Error setting up foreground handler:', err);
    }
}

/**
 * Deactivate the current FCM token on the backend (call before logout).
 * Also clears localStorage FCM state.
 */
async function deactivateCurrentFcmToken() {
    try {
        const tokenToDeactivate = _currentFcmToken || localStorage.getItem(_FCM_KEYS.token);
        if (tokenToDeactivate && api && api.isAuthenticated()) {
            await api.deactivateDeviceToken(tokenToDeactivate);
            console.log('[FCM] Token deactivated on backend');
        }
    } catch (err) {
        console.error('[FCM] Error deactivating token:', err);
    }
    _currentFcmToken = null;
    // Clear localStorage FCM state
    clearFcmState();
}

/**
 * Clear all FCM-related localStorage keys.
 * Called on logout so next login starts fresh.
 */
function clearFcmState() {
    localStorage.removeItem(_FCM_KEYS.token);
    localStorage.removeItem(_FCM_KEYS.registered);
    localStorage.removeItem(_FCM_KEYS.permission);
    localStorage.removeItem(_FCM_KEYS.failCount);
    localStorage.removeItem(_FCM_KEYS.failTimestamp);
    localStorage.removeItem('ragenaizer_fcm_prompt_dismissed');
    localStorage.removeItem(`${STORAGE_PREFIX}fcm_version`);
    _currentFcmToken = null;
    console.log('[FCM] State cleared');
}

/**
 * Clear the 'registered' flag so the next page load does a full FCM re-registration.
 * Call this after login to ensure the backend always has the freshest token.
 * Does NOT clear the token itself — the subscription check (ensureFcmTokenRegistered)
 * will detect truly invalid subscriptions.
 */
function forceRegistrationOnNextLoad() {
    localStorage.removeItem(_FCM_KEYS.registered);
    console.log('[FCM] Registration flag cleared — will re-register on next page load');
}

/**
 * Get the current FCM token (if previously acquired).
 * @returns {string|null}
 */
function getCurrentFcmToken() {
    return _currentFcmToken;
}
