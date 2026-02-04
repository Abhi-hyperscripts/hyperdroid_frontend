/**
 * Global Footer Component
 * Dynamically loads the footer on any page
 * Usage: Add <div id="footer"></div> where you want the footer, then include this script
 */

const FooterComponent = {
    // Footer HTML template
    getHTML: function() {
        return `
    <footer class="landing-footer">
        <div class="footer-brand">
            <img src="/assets/brand_logo.png" alt="Ragenaizer" class="footer-logo" id="footerLogo" style="cursor: pointer;">
            <span class="pronunciation-guide">(ray-gen-izer)</span>
        </div>
        <div class="footer-links">
            <a href="/pages/vision.html" class="footer-link">Vision</a>
            <a href="/pages/chat.html" class="footer-link">Chat</a>
            <a href="/pages/drive.html" class="footer-link">Drive</a>
            <a href="/pages/hrms.html" class="footer-link">HRMS</a>
            <a href="/pages/login.html" class="footer-link">Sign In</a>
            <a href="/pages/terms.html" class="footer-link">Terms</a>
            <a href="/pages/privacy.html" class="footer-link">Privacy</a>
            <a href="/pages/refund.html" class="footer-link">Refund Policy</a>
        </div>
        <p class="footer-copy">&copy; ${new Date().getFullYear()} Ragenaizer. All rights reserved.</p>
    </footer>`;
    },

    // Initialize footer
    init: function(containerId = 'footer') {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = this.getHTML();
        } else {
            // If no container, append at the end of body
            document.body.insertAdjacentHTML('beforeend', this.getHTML());
        }

        // Add hidden TenantManager access - double-click on footer logo
        setTimeout(() => {
            const footerLogo = document.getElementById('footerLogo');
            if (footerLogo) {
                footerLogo.addEventListener('dblclick', function() {
                    window.location.href = '/pages/tenant-manager/login.html';
                });
            }
        }, 100);
    }
};

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Only auto-init if there's a footer placeholder
    if (document.getElementById('footer')) {
        FooterComponent.init();
    }
});

// Export for manual use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FooterComponent;
}
