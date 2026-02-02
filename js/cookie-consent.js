/**
 * Cookie Consent Manager for HyperDroid
 * GDPR/CCPA compliant cookie consent
 */

(function() {
    'use strict';

    const CONSENT_KEY = 'hyperdroid_cookie_consent';
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

    // Load Google Analytics if consent given
    function loadAnalytics() {
        if (window.gaLoaded) return;

        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=G-LXVS357DCK';
        document.head.appendChild(script);

        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('js', new Date());
        gtag('config', 'G-LXVS357DCK');

        window.gaLoaded = true;
    }

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
            setTimeout(() => banner.remove(), 300);
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

    // Initialize on DOM ready
    function init() {
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
