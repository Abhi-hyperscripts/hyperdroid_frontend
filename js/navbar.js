/**
 * Global Navbar Component
 * Dynamically loads the navbar on any page
 *
 * Usage:
 *   <div id="navbar"></div>                              — full navbar (default)
 *   <div id="navbar" data-hide="compare,resources"></div> — hide specific menus
 *
 * Hideable items (case-insensitive, comma-separated):
 *   Top-level menus:  products, features, solutions, compare, resources, pricing
 *   CTA buttons:      signin, getstarted
 *   Any submenu item: vision, chat, drive, hrms, research, crm, etc.
 */

const NavbarComponent = {
    // Navbar HTML template — each hideable element gets a data-nav attribute
    getHTML: function() {
        return `
    <nav class="landing-nav">
        <a href="/index.html">
            <img src="/assets/brand_logo.png" alt="Ragenaizer" class="nav-logo">
        </a>
        <div class="nav-links">
            <!-- Products Dropdown -->
            <div class="nav-dropdown" data-nav="products">
                <span class="nav-dropdown-trigger">
                    Products
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <a href="/pages/vision.html" class="nav-dropdown-item" data-nav="vision">Vision <span>Video Conferencing</span></a>
                    <a href="/pages/chat.html" class="nav-dropdown-item" data-nav="chat">Chat <span>Team Messaging</span></a>
                    <a href="/pages/drive.html" class="nav-dropdown-item" data-nav="drive">Drive <span>Cloud Storage</span></a>
                    <a href="/pages/hrms.html" class="nav-dropdown-item" data-nav="hrms">HRMS <span>HR & Payroll</span></a>
                    <a href="/pages/research.html" class="nav-dropdown-item" data-nav="research">Research <span>AI Analytics</span></a>
                    <a href="/pages/crm.html" class="nav-dropdown-item" data-nav="crm">CRM <span>Sales Pipeline</span></a>
                </div>
            </div>
            <!-- Features Dropdown -->
            <div class="nav-dropdown" data-nav="features">
                <span class="nav-dropdown-trigger">
                    Features
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <a href="/pages/features/video-conferencing.html" class="nav-dropdown-item" data-nav="video-conferencing">Video Conferencing <span>HD meetings & screen share</span></a>
                    <a href="/pages/features/team-chat.html" class="nav-dropdown-item" data-nav="team-chat">Team Chat <span>Real-time messaging</span></a>
                    <a href="/pages/features/cloud-storage.html" class="nav-dropdown-item" data-nav="cloud-storage">Cloud Storage <span>5GB files, secure sharing</span></a>
                    <a href="/pages/features/hrms-payroll.html" class="nav-dropdown-item" data-nav="hrms-payroll">HRMS & Payroll <span>Automated compliance</span></a>
                    <a href="/pages/research.html" class="nav-dropdown-item" data-nav="ai-research">AI Research <span>Agentic SPSS analytics</span></a>
                    <a href="/pages/crm.html" class="nav-dropdown-item" data-nav="sales-crm">Sales CRM <span>Pipeline & lead capture</span></a>
                </div>
            </div>
            <!-- Solutions Dropdown -->
            <div class="nav-dropdown" data-nav="solutions">
                <span class="nav-dropdown-trigger">
                    Solutions
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <a href="/pages/use-cases/remote-teams.html" class="nav-dropdown-item" data-nav="remote-teams">Remote Teams <span>Async-first collaboration</span></a>
                    <a href="/pages/use-cases/startups.html" class="nav-dropdown-item" data-nav="startups">Startups <span>Scale without complexity</span></a>
                    <a href="/pages/use-cases/agencies.html" class="nav-dropdown-item" data-nav="agencies">Agencies <span>Client collaboration</span></a>
                </div>
            </div>
            <!-- Compare Dropdown -->
            <div class="nav-dropdown" data-nav="compare">
                <span class="nav-dropdown-trigger">
                    Compare
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <!-- Communication Submenu -->
                    <div class="nav-submenu" data-nav="compare-communication">
                        <div class="nav-submenu-trigger">
                            Communication <span>Video & Chat</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-zoom.html" class="nav-dropdown-item" data-nav="vs-zoom">vs Zoom <span>Video</span></a>
                            <a href="/pages/compare/ragenaizer-vs-slack.html" class="nav-dropdown-item" data-nav="vs-slack">vs Slack <span>Chat</span></a>
                            <a href="/pages/compare/ragenaizer-vs-teams.html" class="nav-dropdown-item" data-nav="vs-teams">vs Microsoft Teams</a>
                            <a href="/pages/compare/ragenaizer-vs-google-workspace.html" class="nav-dropdown-item" data-nav="vs-google">vs Google Workspace</a>
                        </div>
                    </div>
                    <div class="nav-dropdown-divider"></div>
                    <!-- HRMS & Payroll Submenu -->
                    <div class="nav-submenu" data-nav="compare-hrms">
                        <div class="nav-submenu-trigger">
                            HRMS & Payroll <span>HR Software</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-enterprise.html" class="nav-dropdown-item" data-nav="vs-enterprise">vs Enterprise <span>SAP, Oracle, Workday</span></a>
                            <a href="/pages/compare/ragenaizer-vs-deel.html" class="nav-dropdown-item" data-nav="vs-deel">vs Deel <span>Global Payroll</span></a>
                            <a href="/pages/compare/ragenaizer-vs-zoho.html" class="nav-dropdown-item" data-nav="vs-zoho">vs Zoho People</a>
                            <a href="/pages/compare/ragenaizer-vs-greythr.html" class="nav-dropdown-item" data-nav="vs-greythr">vs greytHR</a>
                            <a href="/pages/compare/ragenaizer-vs-bamboohr.html" class="nav-dropdown-item" data-nav="vs-bamboohr">vs BambooHR</a>
                        </div>
                    </div>
                </div>
            </div>
            <!-- Resources Dropdown -->
            <div class="nav-dropdown" data-nav="resources">
                <span class="nav-dropdown-trigger">
                    Resources
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <!-- Blog Submenu -->
                    <div class="nav-submenu" data-nav="blog">
                        <div class="nav-submenu-trigger">
                            Blog <span>Guides & insights</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <div class="nav-dropdown-label">Communications</div>
                            <a href="/pages/blog/video-conferencing-technology.html" class="nav-dropdown-item">Video Conferencing Tech</a>
                            <div class="nav-dropdown-divider"></div>
                            <div class="nav-dropdown-label">HRMS & Payroll</div>
                            <a href="/pages/blog/pf-complete-guide.html" class="nav-dropdown-item">PF Complete Guide</a>
                            <a href="/pages/blog/esi-complete-guide.html" class="nav-dropdown-item">ESI Complete Guide</a>
                            <div class="nav-dropdown-divider"></div>
                            <a href="/pages/blog/" class="nav-dropdown-item">View All Articles →</a>
                        </div>
                    </div>
                    <div class="nav-dropdown-divider"></div>
                    <div class="nav-dropdown-label" data-nav="calculators-label">Calculators</div>
                    <a href="/pages/calculators/pf-calculator.html" class="nav-dropdown-item" data-nav="pf-calculator">PF Calculator <span>India Provident Fund</span></a>
                    <a href="/pages/calculators/esi-calculator.html" class="nav-dropdown-item" data-nav="esi-calculator">ESI Calculator <span>State Insurance</span></a>
                    <a href="/pages/calculators/tds-calculator.html" class="nav-dropdown-item" data-nav="tds-calculator">TDS Calculator <span>Income Tax Deducted</span></a>
                    <a href="/pages/calculators/hra-calculator.html" class="nav-dropdown-item" data-nav="hra-calculator">HRA Calculator <span>House Rent Allowance</span></a>
                    <a href="/pages/calculators/ctc-calculator.html" class="nav-dropdown-item" data-nav="ctc-calculator">CTC Calculator <span>Cost to Company</span></a>
                    <a href="/pages/calculators/gratuity-calculator.html" class="nav-dropdown-item" data-nav="gratuity-calculator">Gratuity Calculator <span>Retirement benefit</span></a>
                    <a href="/pages/calculators/professional-tax-calculator.html" class="nav-dropdown-item" data-nav="professional-tax">Professional Tax <span>State-wise PT</span></a>
                </div>
            </div>
            <a href="/pages/activate.html" class="nav-link" data-nav="pricing">Pricing</a>
        </div>
        <div class="nav-cta">
            <a href="/pages/login.html" class="btn-secondary" data-nav="signin">Sign In</a>
            <a href="/pages/activate.html" class="btn-primary" data-nav="getstarted">Get Started</a>
        </div>
    </nav>`;
    },

    /**
     * Remove elements matching the hide list.
     * @param {HTMLElement} nav - The rendered nav element
     * @param {string[]} hideList - Lowercase array of data-nav values to remove
     */
    applyHide: function(nav, hideList) {
        if (!hideList || !hideList.length) return;
        hideList.forEach(function(key) {
            nav.querySelectorAll('[data-nav="' + key + '"]').forEach(function(el) {
                // If removing a submenu inside a dropdown-menu, also remove adjacent dividers
                const prev = el.previousElementSibling;
                const next = el.nextElementSibling;
                if (prev && prev.classList.contains('nav-dropdown-divider')) prev.remove();
                else if (next && next.classList.contains('nav-dropdown-divider')) next.remove();
                el.remove();
            });
        });
    },

    /**
     * Initialize navbar into a container.
     * Reads data-hide attribute for items to remove.
     * @param {string} containerId - ID of the placeholder div (default: 'navbar')
     */
    init: function(containerId = 'navbar') {
        const container = document.getElementById(containerId);
        const html = this.getHTML();

        if (container) {
            container.innerHTML = html;
            // Parse data-hide attribute
            const hideAttr = container.getAttribute('data-hide');
            if (hideAttr) {
                const hideList = hideAttr.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
                const nav = container.querySelector('.landing-nav');
                if (nav) this.applyHide(nav, hideList);
            }
        } else {
            document.body.insertAdjacentHTML('afterbegin', html);
        }
    }
};

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Only auto-init if there's a navbar placeholder
    if (document.getElementById('navbar')) {
        NavbarComponent.init();
    }
});

// Export for manual use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavbarComponent;
}
