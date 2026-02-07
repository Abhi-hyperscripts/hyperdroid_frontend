// Firebase Messaging Service Worker
// This runs in the background and handles push notifications when the app is not focused.
// Must be at the root of the domain for proper scope.

// Skip waiting so new service worker activates immediately
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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

// Handle background messages (when page is not focused or closed)
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Background message received:', payload);

    const notificationTitle = payload.notification?.title || payload.data?.title || 'Ragenaizer';
    const notificationOptions = {
        body: payload.notification?.body || payload.data?.body || '',
        icon: '/assets/notification-icon.png',
        badge: '/assets/favicon-32x32.png',
        tag: payload.data?.tag || 'ragenaizer-notification',
        data: payload.data || {}
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked:', event.notification);
    event.notification.close();

    // Navigate to the app or specific page based on notification data
    const urlToOpen = event.notification.data?.url || '/pages/home.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // If a window is already open, focus it
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new window
            return clients.openWindow(urlToOpen);
        })
    );
});
