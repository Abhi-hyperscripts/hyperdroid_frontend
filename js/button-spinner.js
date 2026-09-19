/**
 * Global Spinner Overlay Utility
 *
 * Full-screen doodle-style spinner with theme-aware brand logo + backdrop.
 * Uses reference counting so concurrent API calls keep the spinner visible
 * until ALL of them complete.
 *
 * Usage:
 *   ButtonSpinner.show();   // increment ref count, show overlay
 *   ButtonSpinner.hide();   // decrement ref count, hide when 0
 *
 *   // With button disable:
 *   ButtonSpinner.start(btn, 'Creating...');   // disable btn + show overlay
 *   ButtonSpinner.stop(btn);                    // restore btn + hide overlay
 */
const ButtonSpinner = (() => {
    let overlayEl = null;
    let activeBtn = null;
    let _count = 0;

    function isDarkTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function getOrCreateOverlay() {
        if (overlayEl && document.body.contains(overlayEl)) return overlayEl;

        overlayEl = document.createElement('div');
        overlayEl.className = 'spinner-overlay';
        overlayEl.innerHTML = `
            <div class="doodle-spinner">
                <svg viewBox="0 0 120 120" class="doodle-svg">
                    <circle class="doodle-ring doodle-ring-outer" cx="60" cy="60" r="54"/>
                    <circle class="doodle-ring doodle-ring-mid" cx="60" cy="60" r="44"/>
                    <circle class="doodle-ring doodle-ring-inner" cx="60" cy="60" r="34"/>
                    <circle class="doodle-orb doodle-orb-1" cx="60" cy="6" r="3"/>
                    <circle class="doodle-orb doodle-orb-2" cx="60" cy="16" r="2.5"/>
                    <circle class="doodle-orb doodle-orb-3" cx="60" cy="114" r="2"/>
                </svg>
                <img alt="" class="doodle-logo">
            </div>
        `;
        document.body.appendChild(overlayEl);
        return overlayEl;
    }

    function showOverlay() {
        if (!document.body) return;
        const overlay = getOrCreateOverlay();
        const logo = overlay.querySelector('.doodle-logo');
        logo.src = isDarkTheme()
            ? '/assets/logo-icon-blue.png'
            : '/assets/logo-icon-black.png';
        overlay.classList.add('visible');
    }

    function hideOverlay() {
        if (overlayEl) {
            overlayEl.classList.remove('visible');
        }
    }

    return {
        show() {
            _count++;
            if (_count > 0) showOverlay();
        },

        hide() {
            _count = Math.max(0, _count - 1);
            if (_count === 0) hideOverlay();
        },

        /**
         * Force the count to zero and take the overlay down.
         *
         * For the watchdog, and for anyone recovering from a leaked show(). Deliberately public:
         * without it there is no way back from a wedged page short of a reload.
         */
        reset() {
            _count = 0;
            hideOverlay();
        },

        /** Disable button + show overlay (legacy) */
        start(btn, loadingText = 'Please wait...') {
            if (btn) {
                if (btn.dataset.bsLoading === 'true') return;
                btn.dataset.bsLoading = 'true';
                btn.dataset.bsOriginalHtml = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
                activeBtn = btn;
            }
            this.show();
        },

        /** Restore button + hide overlay (legacy) */
        stop(btn) {
            const target = btn || activeBtn;
            if (target) {
                target.disabled = false;
                target.innerHTML = target.dataset.bsOriginalHtml || target.innerHTML;
                delete target.dataset.bsLoading;
                delete target.dataset.bsOriginalHtml;
            }
            activeBtn = null;
            this.hide();
        }
    };
})();

// ── Auto-show spinner on page load ──
// Shows immediately (body exists since this script loads at top of <body>).
// A balancing hide() fires after DOMContentLoaded + 100ms grace period
// to let initial API calls register their own show()/hide() refs.
ButtonSpinner.show();

// The balancing hide MUST still happen when this script evaluates after DOMContentLoaded has
// already fired — which it can, because these pages inject their scripts with document.write and
// a cache-busting query, so evaluation order varies with the cache and the service worker.
//
// Registering the listener unconditionally was a permanent leak in exactly that case: the event
// never fires again, the ref count never returns to zero, and the overlay sits over the page
// intercepting EVERY click for the life of the tab. The page looks loaded and is completely dead —
// observed on a cold load of the leads page, where it swallowed clicks on the filter controls and
// read as "the custom field filter does nothing".
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => ButtonSpinner.hide(), 100);
    });
} else {
    setTimeout(() => ButtonSpinner.hide(), 100);
}

// Last-resort watchdog. Any future unbalanced show() — a caller returning early, a throw between
// show() and its hide() — wedges the whole page silently, and a blocked page is a far worse
// outcome than a spinner that disappears while something is still loading. The content still
// arrives; the user simply is not held hostage while it does.
setInterval(() => {
    const el = document.querySelector('.spinner-overlay.visible');
    if (!el) { ButtonSpinner._stuckSince = 0; return; }
    const now = Date.now();
    if (!ButtonSpinner._stuckSince) { ButtonSpinner._stuckSince = now; return; }
    if (now - ButtonSpinner._stuckSince > 20000) {
        console.warn('[ButtonSpinner] Overlay visible for 20s — forcing it down. '
            + 'Something called show() without a matching hide().');
        ButtonSpinner.reset();
        ButtonSpinner._stuckSince = 0;
    }
}, 5000);
