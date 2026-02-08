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
    // Cache-buster query param forces Chrome Android to bypass V8 bytecode cache.
    // Chrome aggressively caches compiled SW code and reuses it even after unregister+reregister.
    // Changing the script URL is the ONLY reliable way to force fresh code on Android.
    var swUrl = '/firebase-messaging-sw.js?cb=2';
    navigator.serviceWorker.register(swUrl, {
        scope: '/',
        updateViaCache: 'none'
    }).then((reg) => {
        console.log('[SW] Registered, scope:', reg.scope);

        // If a new SW is already waiting, activate it
        if (reg.waiting) {
            reg.waiting.postMessage('SKIP_WAITING');
        }

        // Verify the active SW is actually running the expected version code.
        // Chrome Android can cache old SW code even when the file changes on the server.
        // This detects stale SW code and forces a full unregister+reregister.
        verifySwVersion(reg);

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
     * Verify the active SW is running the expected version.
     * If the SW reports a different version than what sw-version.js says,
     * force unregister + re-register to get fresh code.
     * This fixes Chrome Android caching stale SW code.
     */
    function verifySwVersion(registration) {
        var activeSW = registration.active;
        if (!activeSW) return;

        // SW_VERSION is defined in config.js (loaded before sw-update.js)
        var expectedVersion = (typeof SW_VERSION !== 'undefined') ? SW_VERSION : null;
        if (!expectedVersion) return;

        try {
            var channel = new MessageChannel();
            channel.port1.onmessage = function (event) {
                if (event.data && event.data.type === 'SW_VERSION_RESPONSE') {
                    var swVersion = event.data.version;
                    if (swVersion !== expectedVersion) {
                        console.log('[Update] SW running stale code v' + swVersion + ', expected v' + expectedVersion + '. Force re-registering...');
                        registration.unregister().then(function () {
                            console.log('[Update] Old SW unregistered, re-registering fresh...');
                            return navigator.serviceWorker.register(swUrl, {
                                scope: '/',
                                updateViaCache: 'none'
                            });
                        }).then(function () {
                            console.log('[Update] Fresh SW registered, reloading...');
                            if (!reloading) {
                                reloading = true;
                                window.location.reload();
                            }
                        }).catch(function (err) {
                            console.warn('[Update] Force re-register failed:', err);
                        });
                    } else {
                        console.log('[Update] SW version verified: v' + swVersion);
                    }
                }
            };

            // Timeout: if SW doesn't respond in 3s, it's an old version without GET_VERSION handler
            setTimeout(function () {
                // Close the port to avoid leaks
                channel.port1.close();
            }, 3000);

            // Old SWs (before GET_VERSION was added) won't respond — that also means stale code
            var responded = false;
            var origHandler = channel.port1.onmessage;
            channel.port1.onmessage = function (event) {
                responded = true;
                origHandler(event);
            };

            setTimeout(function () {
                if (!responded && !reloading) {
                    console.log('[Update] SW did not respond to GET_VERSION — stale code. Force re-registering...');
                    registration.unregister().then(function () {
                        return navigator.serviceWorker.register(swUrl, {
                            scope: '/',
                            updateViaCache: 'none'
                        });
                    }).then(function () {
                        reloading = true;
                        window.location.reload();
                    }).catch(function (err) {
                        console.warn('[Update] Force re-register failed:', err);
                    });
                }
            }, 3000);

            activeSW.postMessage('GET_VERSION', [channel.port2]);
        } catch (e) {
            console.warn('[Update] Version verification failed:', e);
        }
    }

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
