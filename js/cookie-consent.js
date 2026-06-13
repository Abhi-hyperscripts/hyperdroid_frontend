/**
 * Cookie Consent Manager for Ragenaizer
 * GDPR/CCPA compliant cookie consent
 */

(function() {
    'use strict';

    const CONSENT_KEY = 'ragenaizer_cookie_consent';
    const CONSENT_VERSION = '1.0';

    // Check if consent was already given
    function getConsent() {
        try {
            const stored = localStorage.getItem(CONSENT_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                if (data.version === CONSENT_VERSION) {
                    return data;
                }
            }
        } catch (e) {
            console.error('Error reading cookie consent:', e);
        }
        return null;
    }

    // Save consent
    function saveConsent(analytics) {
        const data = {
            version: CONSENT_VERSION,
            analytics: analytics,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem(CONSENT_KEY, JSON.stringify(data));
    }

    // Meta Pixel ID — Wisetrack Web (Wisetrack Lead Gen BP)
    const META_PIXEL_ID = '1300543928289367';

    // GA4 Measurement IDs
    // Marketing pages (home, insights, calculators, signup/login, legal) → Ragenaizer Web stream
    // Product/app pages (signed-in workspace) → HyperDroid product telemetry stream
    const GA4_MARKETING = 'G-60658KXB0N';
    const GA4_PRODUCT   = 'G-LXVS357DCK';

    // URL-based router: product page == /pages/<product-area>/* OR /pages/home.html
    // Everything else (root, insights, calculators, blog, legal, auth) is marketing.
    function pickGA4Id() {
        const PRODUCT_AREAS = ['vision','drive','hrms','crm','admin','mail','email','chat','accounts','payment','procurement','lms','news','pms'];
        const path = (location.pathname || '').toLowerCase();
        if (path === '/pages/home.html') return GA4_PRODUCT;
        const m = path.match(/^\/pages\/([^/]+)\//);
        if (m && PRODUCT_AREAS.indexOf(m[1]) !== -1) return GA4_PRODUCT;
        return GA4_MARKETING;
    }

    // Load Google Analytics + Meta Pixel if consent given
    function loadAnalytics() {
        if (window.gaLoaded) return;

        const ga4Id = pickGA4Id();

        // Google Analytics 4
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + ga4Id;
        document.head.appendChild(script);

        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('js', new Date());
        gtag('config', ga4Id);

        // Meta Pixel — base + PageView
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
        document,'script','https://connect.facebook.net/en_US/fbevents.js');
        window.fbq('init', META_PIXEL_ID);
        window.fbq('track', 'PageView');

        // Fire any conversion events queued before consent was granted
        if (Array.isArray(window._rzFbqQueue)) {
            window._rzFbqQueue.forEach(function(args){ try { window.fbq.apply(null, args); } catch(e){} });
            window._rzFbqQueue = [];
        }

        window.gaLoaded = true;
    }

    // Public helper: track a Meta Pixel event, queue if consent not yet granted
    window.rzTrack = function() {
        const args = Array.prototype.slice.call(arguments);
        if (window.fbq) {
            window.fbq.apply(null, args);
        } else {
            window._rzFbqQueue = window._rzFbqQueue || [];
            window._rzFbqQueue.push(args);
        }
    };

    // Create and show the consent banner
    function showBanner() {
        // Don't show if already exists
        if (document.getElementById('cookie-consent-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'cookie-consent-banner';
        banner.innerHTML = `
            <div class="cookie-consent-content">
                <div class="cookie-consent-text">
                    <p>We use cookies to analyze site traffic and improve your experience.
                    By clicking "Accept", you consent to our use of analytics cookies.</p>
                    <a href="/pages/privacy.html" class="cookie-consent-link">Privacy Policy</a>
                </div>
                <div class="cookie-consent-actions">
                    <button id="cookie-decline" class="cookie-btn cookie-btn-secondary">Decline</button>
                    <button id="cookie-accept" class="cookie-btn cookie-btn-primary">Accept</button>
                </div>
            </div>
        `;

        // Add styles
        const styles = document.createElement('style');
        styles.textContent = `
            #cookie-consent-banner {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: linear-gradient(135deg, #0a1628 0%, #050810 100%);
                border-top: 1px solid rgba(139, 92, 246, 0.3);
                padding: 16px 24px;
                z-index: 999999;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                animation: slideUp 0.3s ease-out;
            }

            @keyframes slideUp {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }

            .cookie-consent-content {
                max-width: 1200px;
                margin: 0 auto;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 24px;
                flex-wrap: wrap;
            }

            .cookie-consent-text {
                flex: 1;
                min-width: 280px;
            }

            .cookie-consent-text p {
                color: rgba(255, 255, 255, 0.85);
                font-size: 14px;
                line-height: 1.5;
                margin: 0 0 4px 0;
            }

            .cookie-consent-link {
                color: #a78bfa;
                font-size: 13px;
                text-decoration: none;
            }

            .cookie-consent-link:hover {
                text-decoration: underline;
            }

            .cookie-consent-actions {
                display: flex;
                gap: 12px;
                flex-shrink: 0;
            }

            .cookie-btn {
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                border: none;
            }

            .cookie-btn-primary {
                background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
                color: #fff;
            }

            .cookie-btn-primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
            }

            .cookie-btn-secondary {
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.2);
            }

            .cookie-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.15);
            }

            @media (max-width: 600px) {
                #cookie-consent-banner {
                    padding: 16px;
                }
                .cookie-consent-content {
                    flex-direction: column;
                    text-align: center;
                }
                .cookie-consent-actions {
                    width: 100%;
                    justify-content: center;
                }
                .cookie-btn {
                    flex: 1;
                    max-width: 150px;
                }
            }
        `;

        document.head.appendChild(styles);
        document.body.appendChild(banner);

        // Expose the banner's measured height as a CSS variable so pages
        // that pin content to the bottom of the viewport (the WhatsApp
        // inbox composer is the motivating case) can subtract it from
        // their height calc and avoid being hidden behind the banner.
        // ResizeObserver re-measures on responsive reflow.
        const setBannerHeightVar = () => {
            const h = banner.getBoundingClientRect().height || 0;
            document.documentElement.style.setProperty('--cookie-banner-h', h + 'px');
        };
        setBannerHeightVar();
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(setBannerHeightVar).observe(banner);
        }

        // Event listeners
        document.getElementById('cookie-accept').addEventListener('click', function() {
            saveConsent(true);
            loadAnalytics();
            hideBanner();
        });

        document.getElementById('cookie-decline').addEventListener('click', function() {
            saveConsent(false);
            hideBanner();
        });
    }

    // Hide the banner
    function hideBanner() {
        const banner = document.getElementById('cookie-consent-banner');
        if (banner) {
            banner.style.animation = 'slideDown 0.3s ease-out forwards';
            setTimeout(() => {
                banner.remove();
                // Reclaim the reserved space — pages that subtracted the
                // banner height from their layout get their full viewport
                // back once it's dismissed.
                document.documentElement.style.setProperty('--cookie-banner-h', '0px');
            }, 300);
        }
    }

    // Add slideDown animation
    const slideDownStyle = document.createElement('style');
    slideDownStyle.textContent = `
        @keyframes slideDown {
            from { transform: translateY(0); opacity: 1; }
            to { transform: translateY(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(slideDownStyle);

    // ─── UTM first-touch attribution ─────────────────────────────
    // Runs on EVERY page load alongside cookie consent. UTM capture
    // is functional (it's how lead attribution works), not analytics
    // — no consent gate. The captured record is read by the embed
    // lead-form widget on submit and echoed back to the CRM as part
    // of the body.
    //
    // First-touch model: the FIRST page load with utm_* in the URL
    // wins, and we NEVER overwrite that on a subsequent landing.
    // Rationale: a visitor who landed via Teen Agency v1, browsed
    // for two days, then clicked a Meta CAPI v2 ad should still be
    // attributed to Teen Agency (the campaign that actually moved
    // them). Switching to last-touch is a one-line change here if
    // we ever revise that model.
    //
    // Storage shape (under ragenaizer_first_touch):
    //   { version, utm_source, utm_medium, utm_campaign, utm_content,
    //     utm_term, landing_page, referrer, captured_at }
    //
    // Companion CRM contract: BL_Leads.CreateLeadAsync + the public
    // /api/leads/capture/{webhookKey} webhook both accept these keys
    // case-insensitively; over-long values get capped at the DB
    // layer's VARCHAR widths (200 / 500). See CRM commit 9e79a60.
    const UTM_STORAGE_KEY = 'ragenaizer_first_touch';
    const UTM_STORAGE_VERSION = '1.0';
    const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

    function captureFirstTouch() {
        try {
            // First-touch wins. Existing record present → no re-stamp.
            const existing = localStorage.getItem(UTM_STORAGE_KEY);
            if (existing) {
                try {
                    const parsed = JSON.parse(existing);
                    if (parsed && parsed.version === UTM_STORAGE_VERSION) return parsed;
                    // Old / unknown version — fall through to re-capture.
                } catch (e) { /* malformed JSON — fall through to re-capture */ }
            }
            const params = new URLSearchParams(window.location.search || '');
            const utm = {};
            let anyUtm = false;
            for (const k of UTM_KEYS) {
                const v = params.get(k);
                if (v && v.trim()) { utm[k] = v.trim(); anyUtm = true; }
            }
            // No utm_* on URL → don't stamp anything. A visitor who lands
            // on /pages/apply.html directly (no campaign) shouldn't get a
            // bogus first-touch row from a later refresh that DOES carry
            // utm_*; that later refresh becomes their first-touch.
            if (!anyUtm) return null;
            const record = Object.assign({
                version: UTM_STORAGE_VERSION,
                landing_page: window.location.pathname + window.location.search,
                referrer: document.referrer || null,
                captured_at: new Date().toISOString()
            }, utm);
            localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(record));
            return record;
        } catch (e) {
            // localStorage unavailable (private browsing / quota / etc.) —
            // fail silent. A blocked stamp is worse-case "first-touch lost
            // for this visitor", which is acceptable degradation.
            console.warn('UTM first-touch capture failed:', e);
            return null;
        }
    }

    function getFirstTouch() {
        try {
            const stored = localStorage.getItem(UTM_STORAGE_KEY);
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            return parsed && parsed.version === UTM_STORAGE_VERSION ? parsed : null;
        } catch (e) { return null; }
    }

    // Public API for the embed widget + any other form on the site.
    // Idempotent — capture() is safe to call repeatedly; the
    // first-touch row is only written once per browser.
    window.UtmTracking = {
        capture: captureFirstTouch,
        getFirstTouch: getFirstTouch,
        // For tests / SPA route changes that want to reset attribution.
        // NOT exposed in the public docs.
        _clearForTesting: function() { try { localStorage.removeItem(UTM_STORAGE_KEY); } catch (e) {} }
    };

    // Initialize on DOM ready
    function init() {
        // UTM capture is intentionally outside the consent gate — it's
        // functional attribution, not analytics. Fire it immediately so
        // a tenant who clicks "Decline" still has their first-touch row
        // available for the apply / contact / demo form submit.
        captureFirstTouch();

        const consent = getConsent();

        if (consent === null) {
            // No consent yet - show banner, don't load analytics
            showBanner();
        } else if (consent.analytics === true) {
            // Consent given - load analytics
            loadAnalytics();
        }
        // If consent.analytics === false, do nothing (declined)
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose functions globally for settings page
    window.CookieConsent = {
        show: showBanner,
        reset: function() {
            localStorage.removeItem(CONSENT_KEY);
            showBanner();
        },
        getStatus: getConsent
    };
})();
