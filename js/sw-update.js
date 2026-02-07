/**
 * Service Worker Auto-Update Handler
 *
 * Registers the service worker on every page load (independent of FCM/notifications)
 * and automatically reloads the page when a new version is detected.
 *
 * Dependencies: None (standalone, loaded early on all pages)
 */

(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) return;

    let reloading = false;

    // Register the service worker immediately on every page
    navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/',
        updateViaCache: 'none'
    }).then((reg) => {
        console.log('[SW] Registered, scope:', reg.scope);

        // If a new SW is already waiting, activate it
        if (reg.waiting) {
            reg.waiting.postMessage('SKIP_WAITING');
        }

        // Detect when a new SW is installed
        reg.addEventListener('updatefound', () => {
            const newSW = reg.installing;
            if (newSW) {
                newSW.addEventListener('statechange', () => {
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        // New SW ready — tell it to take over
                        newSW.postMessage('SKIP_WAITING');
                    }
                });
            }
        });
    }).catch((err) => {
        console.warn('[SW] Registration failed:', err);
    });

    // Listen for version update messages from the SW
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'APP_UPDATE_AVAILABLE' && !reloading) {
            reloading = true;
            console.log(`[Update] Auto-updating: ${event.data.currentVersion} → ${event.data.newVersion}`);

            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
            }

            window.location.reload();
        }
    });

    // When a new SW takes control, reload to use its cache
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloading) {
            reloading = true;
            window.location.reload();
        }
    });
})();
