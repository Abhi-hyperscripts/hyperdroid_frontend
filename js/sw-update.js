/**
 * Service Worker Auto-Update Handler
 *
 * Registers the service worker on every page load (independent of FCM/notifications)
 * and automatically reloads the page when a new version is detected.
 * Uses aggressive polling (every 30s for 5 minutes, then every 60s) to ensure
 * users get updates quickly after deploy.
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
                        console.log('[Update] New SW installed, sending SKIP_WAITING');
                        newSW.postMessage('SKIP_WAITING');
                    }
                });
            }
        });

        // Aggressive update polling (like workwise-pwa pattern)
        setupAutoUpdate(reg);

    }).catch((err) => {
        console.warn('[SW] Registration failed:', err);
    });

    // Listen for version update messages from the SW
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'APP_UPDATE_AVAILABLE' && !reloading) {
            reloading = true;
            console.log(`[Update] Auto-updating: v${event.data.currentVersion} → v${event.data.newVersion}`);

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
            console.log('[Update] New SW activated, reloading page...');
            window.location.reload();
        }
    });

    /**
     * Aggressive update polling:
     * - Check immediately on page load
     * - Every 30s for the first 5 minutes (10 checks)
     * - Every 60s after that
     */
    function setupAutoUpdate(registration) {
        // Immediate check
        registration.update().catch(() => {});

        var checkCount = 0;
        var maxAggressiveChecks = 10;

        // Aggressive: every 30 seconds for 5 minutes
        var aggressiveTimer = setInterval(function () {
            checkCount++;
            registration.update().catch(() => {});

            if (checkCount >= maxAggressiveChecks) {
                clearInterval(aggressiveTimer);
                // Switch to normal: every 60 seconds
                setInterval(function () {
                    registration.update().catch(() => {});
                }, 60000);
            }
        }, 30000);
    }
})();
