/**
 * PWA Install Prompt - Ragenaizer
 * Self-contained IIFE that injects CSS + HTML + event handlers
 * Shows a bottom banner prompting users to install the PWA
 */
(function() {
    'use strict';

    if (typeof document === 'undefined') return;

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    var config = {
        title: 'Install Ragenaizer',
        subtitle: 'Get quick access from your home screen',
        installButtonText: 'Install',
        dismissalKey: 'ragenaizer_pwa_dismissed',
        showDelay: 2000,
        animationDuration: 300
    };

    // ========================================================================
    // CSS INJECTION
    // ========================================================================

    function injectStyles() {
        if (document.getElementById('pwa-install-prompt-styles')) return;

        var styles = `
            .pwa-install-prompt {
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(150%);
                z-index: 999999;
                max-width: 520px;
                width: calc(100% - 40px);
                background: rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(24px) saturate(180%);
                -webkit-backdrop-filter: blur(24px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 20px;
                padding: 6px;
                display: none;
                transition: transform ${config.animationDuration}ms cubic-bezier(0.34, 1.56, 0.64, 1);
                box-shadow:
                    0 8px 32px rgba(0, 0, 0, 0.25),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1),
                    0 0 0 1px rgba(255, 255, 255, 0.05);
            }

            .pwa-install-prompt.show {
                transform: translateX(-50%) translateY(0);
            }

            /* Bento grid layout */
            .pwa-install-content {
                display: grid;
                grid-template-columns: auto 1fr auto auto;
                grid-template-rows: 1fr;
                gap: 6px;
                align-items: stretch;
            }

            /* Icon cell */
            .pwa-install-icon-cell {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                padding: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s ease;
            }

            .pwa-install-icon-cell:hover {
                background: rgba(255, 255, 255, 0.1);
            }

            .pwa-install-icon {
                width: 40px;
                height: 40px;
                border-radius: 10px;
                flex-shrink: 0;
                object-fit: contain;
            }

            /* Text cell */
            .pwa-install-text-cell {
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 14px;
                padding: 10px 14px;
                display: flex;
                flex-direction: column;
                justify-content: center;
            }

            .pwa-install-text-cell strong {
                display: block;
                font-size: 14px;
                font-weight: 600;
                margin-bottom: 2px;
                color: white;
                line-height: 1.2;
                letter-spacing: -0.01em;
            }

            .pwa-install-text-cell p {
                margin: 0;
                font-size: 11px;
                color: rgba(255, 255, 255, 0.6);
                line-height: 1.3;
            }

            /* Install button cell */
            .pwa-install-btn {
                background: rgba(255, 255, 255, 0.12);
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.15);
                padding: 10px 18px;
                border-radius: 14px;
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s ease;
                flex-shrink: 0;
                white-space: nowrap;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                letter-spacing: 0.02em;
            }

            .pwa-install-btn:hover {
                background: rgba(255, 255, 255, 0.22);
                border-color: rgba(255, 255, 255, 0.3);
                transform: scale(1.03);
            }

            .pwa-install-btn:active {
                transform: scale(0.97);
                background: rgba(255, 255, 255, 0.18);
            }

            /* Dismiss button cell */
            .pwa-dismiss-btn {
                background: rgba(255, 255, 255, 0.05);
                color: rgba(255, 255, 255, 0.5);
                border: 1px solid rgba(255, 255, 255, 0.08);
                width: 44px;
                border-radius: 14px;
                font-size: 18px;
                line-height: 1;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                font-weight: 400;
            }

            .pwa-dismiss-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.8);
                border-color: rgba(255, 255, 255, 0.15);
            }

            .pwa-dismiss-btn:active {
                transform: scale(0.95);
            }

            /* Subtle shimmer on the outer border */
            .pwa-install-prompt::before {
                content: '';
                position: absolute;
                inset: -1px;
                border-radius: 21px;
                background: linear-gradient(
                    135deg,
                    rgba(255, 255, 255, 0.15) 0%,
                    rgba(255, 255, 255, 0) 40%,
                    rgba(255, 255, 255, 0) 60%,
                    rgba(255, 255, 255, 0.08) 100%
                );
                z-index: -1;
                pointer-events: none;
            }

            @media (max-width: 480px) {
                .pwa-install-prompt {
                    bottom: 10px;
                    width: calc(100% - 20px);
                    padding: 5px;
                    border-radius: 16px;
                }
                .pwa-install-prompt::before { border-radius: 17px; }
                .pwa-install-icon-cell,
                .pwa-install-text-cell,
                .pwa-install-btn,
                .pwa-dismiss-btn { border-radius: 12px; }
                .pwa-install-content { gap: 4px; }
                .pwa-install-icon { width: 34px; height: 34px; }
                .pwa-install-icon-cell { padding: 10px; }
                .pwa-install-text-cell strong { font-size: 13px; }
                .pwa-install-text-cell p { font-size: 10px; }
                .pwa-install-btn { padding: 8px 14px; font-size: 12px; }
                .pwa-dismiss-btn { width: 38px; }
            }

            @media (max-width: 400px) {
                .pwa-install-content {
                    grid-template-columns: auto 1fr;
                    grid-template-rows: auto auto;
                }
                .pwa-install-icon-cell {
                    grid-row: 1 / 3;
                }
                .pwa-install-text-cell {
                    grid-column: 2;
                }
                .pwa-install-btn {
                    grid-column: 2;
                    text-align: center;
                }
                .pwa-dismiss-btn {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    width: 28px;
                    height: 28px;
                    border-radius: 10px;
                    font-size: 14px;
                    background: rgba(0, 0, 0, 0.2);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
            }

            @supports (-webkit-touch-callout: none) {
                .pwa-install-prompt { bottom: 80px; }
            }
        `;

        var el = document.createElement('style');
        el.id = 'pwa-install-prompt-styles';
        el.textContent = styles;
        document.head.appendChild(el);
    }

    // ========================================================================
    // HTML INJECTION
    // ========================================================================

    function injectHTML() {
        if (document.getElementById('pwaInstallPrompt')) {
            return document.getElementById('pwaInstallPrompt');
        }

        var wrapper = document.createElement('div');
        wrapper.innerHTML = '<div class="pwa-install-prompt" id="pwaInstallPrompt">' +
            '<div class="pwa-install-content">' +
                '<div class="pwa-install-icon-cell">' +
                    '<img class="pwa-install-icon" src="/assets/android-chrome-192x192.png" alt="Ragenaizer">' +
                '</div>' +
                '<div class="pwa-install-text-cell">' +
                    '<strong>' + config.title + '</strong>' +
                    '<p>' + config.subtitle + '</p>' +
                '</div>' +
                '<button class="pwa-install-btn" id="pwaInstallBtn">' + config.installButtonText + '</button>' +
                '<button class="pwa-dismiss-btn" id="pwaDismissBtn">\u00d7</button>' +
            '</div>' +
        '</div>';

        var el = wrapper.firstElementChild;
        document.body.appendChild(el);
        return el;
    }

    // ========================================================================
    // LOGIC
    // ========================================================================

    var deferredPrompt = null;
    var promptElement = null;

    function isDismissed() {
        try { return sessionStorage.getItem(config.dismissalKey) === 'true'; }
        catch (e) { return false; }
    }

    function setDismissed() {
        try { sessionStorage.setItem(config.dismissalKey, 'true'); }
        catch (e) { /* ignore */ }
    }

    function showPrompt() {
        if (!promptElement) return;
        promptElement.style.display = 'block';
        promptElement.offsetHeight; // force reflow
        setTimeout(function() { promptElement.classList.add('show'); }, 10);
    }

    function hidePrompt() {
        if (!promptElement) return;
        promptElement.classList.remove('show');
        setTimeout(function() {
            if (promptElement) promptElement.style.display = 'none';
        }, config.animationDuration);
    }

    function handleInstall() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function(result) {
            hidePrompt();
            deferredPrompt = null;
        });
    }

    function handleDismiss() {
        hidePrompt();
        setDismissed();
    }

    // ========================================================================
    // EVENT LISTENERS
    // ========================================================================

    function setupListeners() {
        window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
            deferredPrompt = e;
            if (isDismissed()) return;
            setTimeout(showPrompt, config.showDelay);
        });

        window.addEventListener('appinstalled', function() {
            hidePrompt();
            deferredPrompt = null;
        });

        var installBtn = document.getElementById('pwaInstallBtn');
        var dismissBtn = document.getElementById('pwaDismissBtn');
        if (installBtn) installBtn.addEventListener('click', handleInstall);
        if (dismissBtn) dismissBtn.addEventListener('click', handleDismiss);
    }

    // ========================================================================
    // INIT
    // ========================================================================

    function init() {
        // Already installed as PWA
        if (window.matchMedia('(display-mode: standalone)').matches) return;
        if (window.navigator.standalone === true) return;

        injectStyles();
        promptElement = injectHTML();
        setupListeners();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API for manual control
    window.PWAInstallPrompt = {
        show: showPrompt,
        hide: hidePrompt,
        reset: function() {
            try { sessionStorage.removeItem(config.dismissalKey); } catch (e) { /* ignore */ }
        }
    };
})();
