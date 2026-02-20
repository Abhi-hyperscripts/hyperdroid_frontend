/**
 * Global Navbar Component
 * Dynamically loads the navbar on any page
 * Usage: Add <div id="navbar"></div> where you want the navbar, then include this script
 */

const NavbarComponent = {
    // Navbar HTML template
    getHTML: function() {
        return `
    <nav class="landing-nav">
        <a href="/index.html">
            <img src="/assets/brand_logo.png" alt="Ragenaizer" class="nav-logo">
        </a>
        <div class="nav-links">
            <!-- Products Dropdown -->
            <div class="nav-dropdown">
                <span class="nav-dropdown-trigger">
                    Products
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <a href="/pages/vision.html" class="nav-dropdown-item">Vision <span>Video Conferencing</span></a>
                    <a href="/pages/chat.html" class="nav-dropdown-item">Chat <span>Team Messaging</span></a>
                    <a href="/pages/drive.html" class="nav-dropdown-item">Drive <span>Cloud Storage</span></a>
                    <a href="/pages/hrms.html" class="nav-dropdown-item">HRMS <span>HR & Payroll</span></a>
                    <a href="/pages/research.html" class="nav-dropdown-item">Research <span>AI Analytics</span></a>
                    <a href="/pages/crm.html" class="nav-dropdown-item">CRM <span>Sales Pipeline</span></a>
                </div>
            </div>
            <!-- Features Dropdown -->
            <div class="nav-dropdown">
                <span class="nav-dropdown-trigger">
                    Features
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <a href="/pages/features/video-conferencing.html" class="nav-dropdown-item">Video Conferencing <span>HD meetings & screen share</span></a>
                    <a href="/pages/features/team-chat.html" class="nav-dropdown-item">Team Chat <span>Real-time messaging</span></a>
                    <a href="/pages/features/cloud-storage.html" class="nav-dropdown-item">Cloud Storage <span>5GB files, secure sharing</span></a>
                    <a href="/pages/features/hrms-payroll.html" class="nav-dropdown-item">HRMS & Payroll <span>Automated compliance</span></a>
                    <a href="/pages/research.html" class="nav-dropdown-item">AI Research <span>Agentic SPSS analytics</span></a>
                    <a href="/pages/crm.html" class="nav-dropdown-item">Sales CRM <span>Pipeline & lead capture</span></a>
                </div>
            </div>
            <!-- Solutions Dropdown -->
            <div class="nav-dropdown">
                <span class="nav-dropdown-trigger">
                    Solutions
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <a href="/pages/use-cases/remote-teams.html" class="nav-dropdown-item">Remote Teams <span>Async-first collaboration</span></a>
                    <a href="/pages/use-cases/startups.html" class="nav-dropdown-item">Startups <span>Scale without complexity</span></a>
                    <a href="/pages/use-cases/agencies.html" class="nav-dropdown-item">Agencies <span>Client collaboration</span></a>
                </div>
            </div>
            <!-- Compare Dropdown -->
            <div class="nav-dropdown">
                <span class="nav-dropdown-trigger">
                    Compare
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <!-- Communication Submenu -->
                    <div class="nav-submenu">
                        <div class="nav-submenu-trigger">
                            Communication <span>Video & Chat</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-zoom.html" class="nav-dropdown-item">vs Zoom <span>Video</span></a>
                            <a href="/pages/compare/ragenaizer-vs-slack.html" class="nav-dropdown-item">vs Slack <span>Chat</span></a>
                            <a href="/pages/compare/ragenaizer-vs-teams.html" class="nav-dropdown-item">vs Microsoft Teams</a>
                            <a href="/pages/compare/ragenaizer-vs-google-workspace.html" class="nav-dropdown-item">vs Google Workspace</a>
                        </div>
                    </div>
                    <div class="nav-dropdown-divider"></div>
                    <!-- HRMS & Payroll Submenu -->
                    <div class="nav-submenu">
                        <div class="nav-submenu-trigger">
                            HRMS & Payroll <span>HR Software</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-enterprise.html" class="nav-dropdown-item">vs Enterprise <span>SAP, Oracle, Workday</span></a>
                            <a href="/pages/compare/ragenaizer-vs-deel.html" class="nav-dropdown-item">vs Deel <span>Global Payroll</span></a>
                            <a href="/pages/compare/ragenaizer-vs-zoho.html" class="nav-dropdown-item">vs Zoho People</a>
                            <a href="/pages/compare/ragenaizer-vs-greythr.html" class="nav-dropdown-item">vs greytHR</a>
                            <a href="/pages/compare/ragenaizer-vs-bamboohr.html" class="nav-dropdown-item">vs BambooHR</a>
                        </div>
                    </div>
                </div>
            </div>
            <!-- Resources Dropdown -->
            <div class="nav-dropdown">
                <span class="nav-dropdown-trigger">
                    Resources
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <!-- Blog Submenu -->
                    <div class="nav-submenu">
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
                    <div class="nav-dropdown-label">Calculators</div>
                    <a href="/pages/calculators/pf-calculator.html" class="nav-dropdown-item">PF Calculator <span>India Provident Fund</span></a>
                    <a href="/pages/calculators/esi-calculator.html" class="nav-dropdown-item">ESI Calculator <span>State Insurance</span></a>
                    <a href="/pages/calculators/tds-calculator.html" class="nav-dropdown-item">TDS Calculator <span>Income Tax Deducted</span></a>
                    <a href="/pages/calculators/hra-calculator.html" class="nav-dropdown-item">HRA Calculator <span>House Rent Allowance</span></a>
                    <a href="/pages/calculators/ctc-calculator.html" class="nav-dropdown-item">CTC Calculator <span>Cost to Company</span></a>
                    <a href="/pages/calculators/gratuity-calculator.html" class="nav-dropdown-item">Gratuity Calculator <span>Retirement benefit</span></a>
                    <a href="/pages/calculators/professional-tax-calculator.html" class="nav-dropdown-item">Professional Tax <span>State-wise PT</span></a>
                </div>
            </div>
            <a href="/pages/activate.html" class="nav-link">Pricing</a>
        </div>
        <div class="nav-cta">
            <a href="/pages/login.html" class="btn-secondary">Sign In</a>
            <a href="/pages/activate.html" class="btn-primary">Get Started</a>
        </div>
    </nav>`;
    },

    // Initialize navbar
    init: function(containerId = 'navbar') {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = this.getHTML();
        } else {
            // If no container, insert at the beginning of body
            document.body.insertAdjacentHTML('afterbegin', this.getHTML());
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
