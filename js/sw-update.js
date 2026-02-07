/**
 * Service Worker Auto-Update Handler
 *
 * Listens for version update messages from the service worker
 * and automatically reloads the page to apply the new version.
 *
 * Dependencies: None (standalone, loaded early on all pages)
 */

(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) return;

    let reloading = false;

    // Listen for messages from the service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'APP_UPDATE_AVAILABLE' && !reloading) {
            reloading = true;
            console.log(`[Update] Auto-updating: ${event.data.currentVersion} → ${event.data.newVersion}`);

            // Tell the waiting SW to skip waiting and take over
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
            }

            // Reload to get fresh assets
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
