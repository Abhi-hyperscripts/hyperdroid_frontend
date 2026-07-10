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
    // Test-harness bypass: navigating with ?nosw=1 (or storing __nosw flag)
    // skips SW registration entirely so headless browsers don't get caught in
    // the install/controllerchange/reload cycle when running E2E tests.
    // ALSO serves as the operator-rollback path for BUILD 40+ — unregister
    // the SW AND wipe the static-asset cache so a buggy fetch handler can
    // be backed out without redeploying.
    if (location.search.includes('nosw=1') || sessionStorage.getItem('__nosw') === '1') {
        sessionStorage.setItem('__nosw', '1');
        navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister().catch(() => {})));
        if (window.caches && caches.keys) {
            caches.keys().then(names => Promise.all(
                names.filter(n => n.startsWith('ragenaizer-static-')).map(n => caches.delete(n))
            )).catch(() => {});
        }
        return;
    }

    let reloading = false;

    // SW registration is ENABLED again, pointing at BUILD 39 (push-only).
    // BUILD 39 has NO fetch handler — it can never repeat the BUILD 35 outage.
    // The kill-switch (BUILD 38) already self-unregistered, so we register a
    // fresh push-only SW from a clean slate.
    //
    // If you ever add fetch interception back here, MANDATORY checklist:
    //   1. Test the new SW with `request.mode === 'navigate'` requests in
    //      Playwright against a real deployed staging URL (not curl).
    //   2. Wrap respondWith in a try/catch that falls through to native fetch.
    //   3. Stage behind a feature flag, roll forward gradually.
    //
    // cb=N forces Chrome to fetch fresh SW source (Chrome aggressively
    // caches compiled SW V8 bytecode by URL).
    listenForSwMessages();
    var swUrl = '/firebase-messaging-sw.js?cb=8';
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

    // Listen for version update messages from the SW.
    // Pulled into a function so the disabled-registration early-return path
    // can still install this handler — kill-switch SW posts RELOAD_NOW.
    function listenForSwMessages() {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'APP_UPDATE_AVAILABLE' && !reloading) {
                // Never auto-reload a LIVE meeting — being yanked out of a
                // call is worse than running one deploy behind. meeting.js
                // sets/clears this flag; its join-time version gate ensures
                // freshness at the next join instead.
                if (window.__meetingLive) {
                    console.log('[Update] New version available but a meeting is live — deferring reload');
                    return;
                }
                reloading = true;
                console.log(`[Update] Auto-updating: v${event.data.currentVersion} → v${event.data.newVersion}`);

                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
                }

                window.location.reload();
            }

            // Kill-switch SW (BUILD 38) sends this after unregistering itself.
            // Force a reload so the page bypasses any leftover broken SW state.
            if (event.data?.type === 'RELOAD_NOW' && !reloading) {
                reloading = true;
                console.log('[Update] SW kill switch fired:', event.data.reason);
                window.location.reload();
            }
        });
    }
    listenForSwMessages();

    // controllerchange used to auto-reload the page so a new SW could take
    // over. With BUILD 39+ the SW has NO fetch handler — there's nothing for
    // a "fresh cache" to pick up. Reloading here only created an infinite
    // loop: first page load → SW installs → SKIP_WAITING → controllerchange
    // → reload → first install again on the new tab session → repeat. Push
    // handler logic still updates organically (the new SW handles future
    // pushes from the moment it activates). Ship updates the user-noticeable
    // way: APP_UPDATE_AVAILABLE messages from the SW, which we still honor
    // above. No automatic reload here.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[Update] New SW activated (no auto-reload — push handler active immediately).');
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

            // Close the port after 3s to avoid leaks. Previously this also
            // triggered a force-unregister + reload if no response arrived,
            // but on some browsers (Safari, some Chrome on Mac configs) the
            // SW is still installing during this 3s window and never replies
            // — every page load then unregistered + reloaded the SW, which
            // produces an infinite reload loop indistinguishable from a real
            // bug. Stale SW code is annoying; an infinite reload loop breaks
            // the app entirely. We keep the version-mismatch reload above
            // (which fires only when the SW DOES respond with a wrong
            // version), and ride out the stale case until the user's next
            // navigation triggers an organic update.
            setTimeout(function () { channel.port1.close(); }, 3000);

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
     *
     * Also polls /js/sw-version.js directly from the page so an updated
     * SW_VERSION on the server reloads the page even if the SW's own
     * APP_UPDATE_AVAILABLE message was lost. Without this, the race
     * window we hit on 2026-05-10 leaves the tab stuck on the old version
     * forever: old SW broadcasts APP_UPDATE_AVAILABLE then immediately
     * triggers self.registration.update(); the new SW activates with the
     * correct version baked in and never broadcasts again, so a missed
     * message is unrecoverable. The page-side check closes that gap by
     * comparing window.SW_VERSION (frozen at script-tag-load) against the
     * live /js/sw-version.js content.
     */
    function setupAutoUpdate(registration) {
        // Immediate check
        registration.update().catch(() => {});
        checkPageVersionAgainstServer();

        var checkCount = 0;
        var maxAggressiveChecks = 10;

        // Aggressive: every 30 seconds for 5 minutes
        var aggressiveTimer = setInterval(function () {
            checkCount++;
            registration.update().catch(() => {});
            checkPageVersionAgainstServer();

            if (checkCount >= maxAggressiveChecks) {
                clearInterval(aggressiveTimer);
                // Switch to normal: every 60 seconds
                setInterval(function () {
                    registration.update().catch(() => {});
                    checkPageVersionAgainstServer();
                }, 60000);
            }
        }, 30000);
    }

    /**
     * Compare the page's frozen window.SW_VERSION against the live
     * /js/sw-version.js on the server. Reload if the server is ahead.
     *
     * `cache: 'no-store'` plus a Date.now() bust skips both the browser's
     * HTTP cache AND any CDN edge cache that might honour query strings.
     * The SW's NEVER_CACHE_PATTERNS already excludes /sw-version.js from
     * the static cache, so this fetch always reaches origin.
     */
    function checkPageVersionAgainstServer() {
        if (reloading) return;
        var pageVersion = (typeof SW_VERSION !== 'undefined') ? SW_VERSION : null;
        if (pageVersion == null) return;
        fetch('/js/sw-version.js?_=' + Date.now(), {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' }
        })
            .then(function (r) { return r.ok ? r.text() : null; })
            .then(function (text) {
                if (!text) return;
                var match = text.match(/SW_VERSION\s*=\s*(\d+)/);
                if (!match) return;
                var serverVersion = parseInt(match[1], 10);
                if (serverVersion && serverVersion > pageVersion && !reloading) {
                    if (window.__meetingLive) {
                        console.log('[Update] v' + serverVersion + ' available but a meeting is live — deferring reload');
                        return;
                    }
                    reloading = true;
                    console.log('[Update] Page-side detected v' + pageVersion + ' < server v' + serverVersion + ' — reloading');
                    window.location.reload();
                }
            })
            .catch(function () { /* offline — try again next tick */ });
    }
})();
