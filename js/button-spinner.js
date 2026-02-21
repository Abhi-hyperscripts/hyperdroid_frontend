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
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => ButtonSpinner.hide(), 100);
});
