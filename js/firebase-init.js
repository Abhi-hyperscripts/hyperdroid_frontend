/**
 * Firebase Cloud Messaging (FCM) initialization for web push notifications.
 *
 * Dependencies: config.js (FIREBASE_CONFIG, FIREBASE_VAPID_KEY), api.js (api instance)
 * Loaded after api.js on authenticated pages.
 */

// State
let _firebaseApp = null;
let _messaging = null;
let _currentFcmToken = null;

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
            scope: '/'
        });
        console.log('[FCM] Service worker registered:', registration.scope);

        // Wait for a service worker to be active
        if (!registration.active) {
            const sw = registration.installing || registration.waiting;
            if (sw) {
                await new Promise((resolve) => {
                    sw.addEventListener('statechange', () => {
                        if (sw.state === 'activated') {
                            resolve();
                        }
                    });
                    if (sw.state === 'activated') {
                        resolve();
                    }
                });
                console.log('[FCM] Service worker now active');
            }
        } else {
            console.log('[FCM] Service worker already active');
        }

        return registration;
    } catch (err) {
        console.error('[FCM] Service worker registration failed:', err);
        return null;
    }
}

/**
 * Request notification permission and get FCM token.
 * Call this after login.
 * @returns {string|null} The FCM token, or null if permission denied or error.
 */
async function requestNotificationPermission() {
    try {
        // Check if browser supports notifications
        if (!('Notification' in window)) {
            console.warn('[FCM] Notifications not supported in this browser');
            return null;
        }

        // Check if VAPID key is configured
        if (!FIREBASE_VAPID_KEY || FIREBASE_VAPID_KEY === 'PASTE_YOUR_VAPID_KEY_HERE') {
            console.warn('[FCM] VAPID key not configured. Skipping push notification setup.');
            return null;
        }

        // Request permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('[FCM] Notification permission denied');
            return null;
        }

        console.log('[FCM] Notification permission granted');

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

            // Register with backend
            await registerTokenWithBackend(token);
            return token;
        } else {
            console.warn('[FCM] No token received');
            return null;
        }
    } catch (err) {
        console.error('[FCM] Error requesting notification permission:', err);
        return null;
    }
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

        const result = await api.registerDeviceToken(fcmToken, 'web');
        console.log('[FCM] Token registered with backend:', result);
    } catch (err) {
        console.error('[FCM] Failed to register token with backend:', err);
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

            // Show native browser notification (works even when page is focused)
            if (Notification.permission === 'granted') {
                new Notification(title, {
                    body: body,
                    icon: '/assets/notification-icon.png',
                    tag: 'ragenaizer-foreground',
                    data: payload.data || {}
                });
            }

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
 */
async function deactivateCurrentFcmToken() {
    try {
        if (_currentFcmToken && api && api.isAuthenticated()) {
            await api.deactivateDeviceToken(_currentFcmToken);
            console.log('[FCM] Token deactivated on backend');
        }
    } catch (err) {
        console.error('[FCM] Error deactivating token:', err);
    }
    _currentFcmToken = null;
}

/**
 * Get the current FCM token (if previously acquired).
 * @returns {string|null}
 */
function getCurrentFcmToken() {
    return _currentFcmToken;
}
