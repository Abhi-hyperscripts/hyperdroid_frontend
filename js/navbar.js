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
        <button class="nav-hamburger" onclick="NavbarComponent.toggleMobileMenu()" aria-label="Menu">
            <span></span><span></span><span></span>
        </button>
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
                    <a href="/pages/email.html" class="nav-dropdown-item" data-nav="email">Email <span>Unified Inbox</span></a>
                    <a href="/pages/drive.html" class="nav-dropdown-item" data-nav="drive">Drive <span>Cloud Storage</span></a>
                    <a href="/pages/hrms.html" class="nav-dropdown-item" data-nav="hrms">HRMS <span>HR & Payroll</span></a>
                    <a href="/pages/research.html" class="nav-dropdown-item" data-nav="research">Research <span>AI Analytics</span></a>
                    <a href="/pages/crm.html" class="nav-dropdown-item" data-nav="crm">CRM <span>Sales Pipeline</span></a>
                    <a href="/pages/pms.html" class="nav-dropdown-item" data-nav="pms">PMS <span>Project & Time Tracking</span></a>
                    <a href="/pages/accounts.html" class="nav-dropdown-item" data-nav="accounts">Accounts <span>Finance & Accounting</span></a>
                    <a href="/pages/lms.html" class="nav-dropdown-item" data-nav="lms">LMS <span>Learning & Training</span></a>
                    <a href="/pages/features/procurement.html" class="nav-dropdown-item" data-nav="procurement">Procurement <span>AI Vendor Management</span></a>
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
                    <a href="/pages/email.html" class="nav-dropdown-item" data-nav="email-unified">Unified Email Inbox <span>Any provider, one workspace</span></a>
                    <a href="/pages/features/cloud-storage.html" class="nav-dropdown-item" data-nav="cloud-storage">Cloud Storage <span>5GB files, secure sharing</span></a>
                    <a href="/pages/features/hrms-payroll.html" class="nav-dropdown-item" data-nav="hrms-payroll">HRMS & Payroll <span>Automated compliance</span></a>
                    <a href="/pages/research.html" class="nav-dropdown-item" data-nav="ai-research">AI Research <span>Agentic SPSS analytics</span></a>
                    <a href="/pages/crm.html" class="nav-dropdown-item" data-nav="sales-crm">Sales CRM <span>Pipeline & lead capture</span></a>
                    <a href="/pages/pms.html" class="nav-dropdown-item" data-nav="pms-tracking">Project Management <span>Time tracking & billing</span></a>
                    <a href="/pages/accounts.html" class="nav-dropdown-item" data-nav="accounts-finance">Accounts <span>Books, invoices, GST returns</span></a>
                    <a href="/pages/lms.html" class="nav-dropdown-item" data-nav="lms-training">Learning Management <span>Courses, certificates & compliance</span></a>
                    <a href="/pages/features/procurement.html" class="nav-dropdown-item" data-nav="procurement">Procurement <span>AI-powered vendor management</span></a>
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
                    <a href="/pages/use-cases/agencies.html" class="nav-dropdown-item" data-nav="agencies">Agencies <span>Client work, end to end</span></a>
                    <a href="/pages/use-cases/consulting.html" class="nav-dropdown-item" data-nav="consulting">Consulting <span>Projects, time &amp; billing</span></a>
                    <a href="/pages/use-cases/education.html" class="nav-dropdown-item" data-nav="education">Education <span>Training &amp; certification</span></a>
                    <a href="/pages/use-cases/market-research.html" class="nav-dropdown-item" data-nav="market-research">Market Research <span>AI insights in 10 minutes</span></a>
                    <a href="/pages/use-cases/manufacturing.html" class="nav-dropdown-item" data-nav="manufacturing">Manufacturing <span>Operations, books &amp; GST</span></a>
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
                    <!-- Communication -->
                    <div class="nav-submenu" data-nav="compare-communication">
                        <div class="nav-submenu-trigger">
                            Communication <span>Video, Chat & Email</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-zoom.html" class="nav-dropdown-item" data-nav="vs-zoom">vs Zoom <span>Video</span></a>
                            <a href="/pages/compare/ragenaizer-vs-slack.html" class="nav-dropdown-item" data-nav="vs-slack">vs Slack <span>Chat</span></a>
                            <a href="/pages/compare/ragenaizer-vs-teams.html" class="nav-dropdown-item" data-nav="vs-teams">vs Microsoft Teams</a>
                            <a href="/pages/compare/ragenaizer-vs-gmail.html" class="nav-dropdown-item" data-nav="vs-gmail">vs Gmail / Google Workspace Email <span>1/4 the cost</span></a>
                            <a href="/pages/compare/ragenaizer-vs-google-workspace.html" class="nav-dropdown-item" data-nav="vs-google">vs Google Workspace <span>Full platform</span></a>
                        </div>
                    </div>
                    <!-- Cloud Storage -->
                    <div class="nav-submenu" data-nav="compare-drive">
                        <div class="nav-submenu-trigger">
                            Cloud Storage <span>File Sharing</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-dropbox.html" class="nav-dropdown-item" data-nav="vs-dropbox">vs Dropbox</a>
                            <a href="/pages/compare/ragenaizer-vs-google-drive.html" class="nav-dropdown-item" data-nav="vs-gdrive">vs Google Drive</a>
                            <a href="/pages/compare/ragenaizer-vs-onedrive.html" class="nav-dropdown-item" data-nav="vs-onedrive">vs OneDrive</a>
                            <a href="/pages/compare/ragenaizer-vs-box.html" class="nav-dropdown-item" data-nav="vs-box">vs Box</a>
                        </div>
                    </div>
                    <!-- HRMS & Payroll -->
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
                    <!-- CRM -->
                    <div class="nav-submenu" data-nav="compare-crm">
                        <div class="nav-submenu-trigger">
                            CRM <span>Sales Pipeline</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-hubspot.html" class="nav-dropdown-item" data-nav="vs-hubspot">vs HubSpot</a>
                            <a href="/pages/compare/ragenaizer-vs-salesforce.html" class="nav-dropdown-item" data-nav="vs-salesforce">vs Salesforce</a>
                            <a href="/pages/compare/ragenaizer-vs-pipedrive.html" class="nav-dropdown-item" data-nav="vs-pipedrive">vs Pipedrive</a>
                            <a href="/pages/compare/ragenaizer-vs-zoho-crm.html" class="nav-dropdown-item" data-nav="vs-zoho-crm">vs Zoho CRM</a>
                        </div>
                    </div>
                    <!-- Project Management -->
                    <div class="nav-submenu" data-nav="compare-pms">
                        <div class="nav-submenu-trigger">
                            Project Management <span>Tasks &amp; Issues</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-jira.html" class="nav-dropdown-item" data-nav="vs-jira">vs Jira <span>Issue tracker</span></a>
                            <a href="/pages/compare/ragenaizer-vs-asana.html" class="nav-dropdown-item" data-nav="vs-asana">vs Asana</a>
                            <a href="/pages/compare/ragenaizer-vs-monday.html" class="nav-dropdown-item" data-nav="vs-monday">vs Monday.com</a>
                            <a href="/pages/compare/ragenaizer-vs-clickup.html" class="nav-dropdown-item" data-nav="vs-clickup">vs ClickUp</a>
                            <a href="/pages/compare/ragenaizer-vs-trello.html" class="nav-dropdown-item" data-nav="vs-trello">vs Trello</a>
                        </div>
                    </div>
                    <!-- Research & Analytics -->
                    <div class="nav-submenu" data-nav="compare-research">
                        <div class="nav-submenu-trigger">
                            Research &amp; Analytics <span>Survey Data</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-qualtrics.html" class="nav-dropdown-item" data-nav="vs-qualtrics">vs Qualtrics</a>
                            <a href="/pages/compare/ragenaizer-vs-surveymonkey.html" class="nav-dropdown-item" data-nav="vs-surveymonkey">vs SurveyMonkey</a>
                            <a href="/pages/compare/ragenaizer-vs-spss.html" class="nav-dropdown-item" data-nav="vs-spss">vs IBM SPSS</a>
                            <a href="/pages/compare/ragenaizer-vs-displayr.html" class="nav-dropdown-item" data-nav="vs-displayr">vs Displayr / Q</a>
                        </div>
                    </div>
                    <!-- Accounting -->
                    <div class="nav-submenu" data-nav="compare-accounts">
                        <div class="nav-submenu-trigger">
                            Accounting <span>Books &amp; Finance</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-quickbooks.html" class="nav-dropdown-item" data-nav="vs-quickbooks">vs QuickBooks</a>
                            <a href="/pages/compare/ragenaizer-vs-xero.html" class="nav-dropdown-item" data-nav="vs-xero">vs Xero</a>
                            <a href="/pages/compare/ragenaizer-vs-zoho-books.html" class="nav-dropdown-item" data-nav="vs-zoho-books">vs Zoho Books</a>
                            <a href="/pages/compare/ragenaizer-vs-tally.html" class="nav-dropdown-item" data-nav="vs-tally">vs Tally <span>India</span></a>
                        </div>
                    </div>
                    <!-- Learning (LMS) -->
                    <div class="nav-submenu" data-nav="compare-lms">
                        <div class="nav-submenu-trigger">
                            Learning (LMS) <span>Training</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <a href="/pages/compare/ragenaizer-vs-moodle.html" class="nav-dropdown-item" data-nav="vs-moodle">vs Moodle</a>
                            <a href="/pages/compare/ragenaizer-vs-talentlms.html" class="nav-dropdown-item" data-nav="vs-talentlms">vs TalentLMS</a>
                            <a href="/pages/compare/ragenaizer-vs-docebo.html" class="nav-dropdown-item" data-nav="vs-docebo">vs Docebo</a>
                            <a href="/pages/compare/ragenaizer-vs-cornerstone.html" class="nav-dropdown-item" data-nav="vs-cornerstone">vs Cornerstone</a>
                        </div>
                    </div>
                    <div class="nav-dropdown-divider"></div>
                    <a href="/pages/compare/" class="nav-dropdown-item" data-nav="compare-all"><strong>View All Comparisons →</strong></a>
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
                    <!-- Insights Submenu -->
                    <div class="nav-submenu" data-nav="insights">
                        <div class="nav-submenu-trigger">
                            Insights <span>Survey reports & dashboards</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <div class="nav-submenu-content">
                            <div class="nav-dropdown-label">Secondary Research</div>
                            <a href="/pages/insights/ai-impact-global-job-market-2026.html" class="nav-dropdown-item" data-nav="ai-job-market">AI Impact on Job Market 2026</a>
                            <a href="/pages/insights/us-israel-iran-conflict-impact-2025-2030.html" class="nav-dropdown-item" data-nav="us-israel-iran">US-Israel-Iran Conflict Analysis</a>
                            <a href="/pages/insights/world-2035-megatrends-global-economy.html" class="nav-dropdown-item" data-nav="world-2035">World in 2035: Global Megatrends</a>
                            <div class="nav-dropdown-divider"></div>
                            <div class="nav-dropdown-label">Primary Research</div>
                            <a href="/pages/insights/work-from-home-research.html" class="nav-dropdown-item" data-nav="wfh-research">Work From Home Research</a>
                            <div class="nav-dropdown-divider"></div>
                            <a href="/pages/insights/" class="nav-dropdown-item" data-nav="all-insights">View All Reports &rarr;</a>
                        </div>
                    </div>
                    <div class="nav-dropdown-divider"></div>
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
            <!-- Knowledge Base Dropdown -->
            <div class="nav-dropdown" data-nav="knowledge-base">
                <span class="nav-dropdown-trigger">
                    Knowledge Base
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </span>
                <div class="nav-dropdown-menu">
                    <div class="nav-dropdown-label">Setup Guides</div>
                    <a href="/KnowledgeBase/Accounts/Accounts-Setup-Guide.html" class="nav-dropdown-item" data-nav="kb-accounts">Accounts <span>Books, invoices, GST &mdash; from zero</span></a>
                    <a href="/KnowledgeBase/crm/CRM-Setup-Guide.html" class="nav-dropdown-item" data-nav="kb-crm">CRM <span>Pipeline, deals, promotion to Accounts</span></a>
                    <a href="/KnowledgeBase/crm/Facebook-Leads-Setup-Guide.html" class="nav-dropdown-item" data-nav="kb-fb-leads">Facebook Lead Ads <span>Connect Meta Page leads to your CRM</span></a>
                    <div class="nav-dropdown-divider"></div>
                    <div class="nav-dropdown-label">For Investors</div>
                    <a href="/pitch-deck/ragenaizer-pitch-deck.html" class="nav-dropdown-item" data-nav="kb-pitch-deck">Pitch Deck 2026 <span>The investor narrative &mdash; 11 slides</span></a>
                </div>
            </div>
            <a href="/pages/kip.html" class="nav-link" data-nav="kip">KIP</a>
            <a href="/pages/pricing.html" class="nav-link" data-nav="pricing">Pricing</a>
        </div>
        <div class="nav-cta">
            <a href="/pages/login.html" class="btn-secondary" data-nav="signin">Sign In</a>
            <a href="/pages/pricing.html" class="btn-primary" data-nav="getstarted">Get Started</a>
        </div>
    </nav>
    <div class="nav-mobile-overlay" onclick="NavbarComponent.toggleMobileMenu()"></div>
    <div class="nav-mobile-menu">
        <div class="nav-mobile-header">
            <img src="/assets/brand_logo.png" alt="Ragenaizer" class="nav-logo" style="filter:invert(1);">
            <button class="nav-mobile-close" onclick="NavbarComponent.toggleMobileMenu()">&times;</button>
        </div>
        <div class="nav-mobile-body">
            <div class="nav-mobile-section">Products</div>
            <a href="/pages/vision.html" class="nav-mobile-link" data-nav="vision">Vision <span>Video Conferencing</span></a>
            <a href="/pages/chat.html" class="nav-mobile-link" data-nav="chat">Chat <span>Team Messaging</span></a>
            <a href="/pages/email.html" class="nav-mobile-link" data-nav="email">Email <span>Unified Inbox</span></a>
            <a href="/pages/drive.html" class="nav-mobile-link" data-nav="drive">Drive <span>Cloud Storage</span></a>
            <a href="/pages/hrms.html" class="nav-mobile-link" data-nav="hrms">HRMS <span>HR & Payroll</span></a>
            <a href="/pages/research.html" class="nav-mobile-link" data-nav="research">Research <span>AI Analytics</span></a>
            <a href="/pages/crm.html" class="nav-mobile-link" data-nav="crm">CRM <span>Sales Pipeline</span></a>
            <a href="/pages/pms.html" class="nav-mobile-link" data-nav="pms">PMS <span>Project & Time</span></a>
            <a href="/pages/accounts.html" class="nav-mobile-link" data-nav="accounts">Accounts <span>Finance & Books</span></a>
            <a href="/pages/lms.html" class="nav-mobile-link" data-nav="lms">LMS <span>Training & Certificates</span></a>
            <a href="/pages/features/procurement.html" class="nav-mobile-link" data-nav="procurement">Procurement <span>AI Vendors</span></a>
            <div class="nav-mobile-divider"></div>
            <div class="nav-mobile-section">Solutions</div>
            <a href="/pages/use-cases/remote-teams.html" class="nav-mobile-link" data-nav="remote-teams">Remote Teams <span>Async-first collaboration</span></a>
            <a href="/pages/use-cases/startups.html" class="nav-mobile-link" data-nav="startups">Startups <span>Scale without complexity</span></a>
            <a href="/pages/use-cases/agencies.html" class="nav-mobile-link" data-nav="agencies">Agencies <span>Client work, end to end</span></a>
            <a href="/pages/use-cases/consulting.html" class="nav-mobile-link" data-nav="consulting">Consulting <span>Projects, time &amp; billing</span></a>
            <a href="/pages/use-cases/education.html" class="nav-mobile-link" data-nav="education">Education <span>Training &amp; certification</span></a>
            <a href="/pages/use-cases/market-research.html" class="nav-mobile-link" data-nav="market-research">Market Research <span>AI insights in 10 min</span></a>
            <a href="/pages/use-cases/manufacturing.html" class="nav-mobile-link" data-nav="manufacturing">Manufacturing <span>Operations &amp; GST</span></a>
            <div class="nav-mobile-divider"></div>
            <a href="/pages/compare/" class="nav-mobile-link" data-nav="compare-all">Compare <span>vs every alternative</span></a>
            <a href="/pages/kip.html" class="nav-mobile-link" data-nav="kip">KIP <span>News Intelligence</span></a>
            <a href="/pages/pricing.html" class="nav-mobile-link" data-nav="pricing">Pricing</a>
            <div class="nav-mobile-divider"></div>
            <div class="nav-mobile-section">Resources</div>
            <a href="/pages/insights/" class="nav-mobile-link" data-nav="all-insights">Insights & Reports</a>
            <a href="/pages/blog/" class="nav-mobile-link" data-nav="blog">Blog</a>
            <div class="nav-mobile-divider"></div>
            <div class="nav-mobile-section">Knowledge Base</div>
            <a href="/KnowledgeBase/Accounts/Accounts-Setup-Guide.html" class="nav-mobile-link" data-nav="kb-accounts">Accounts <span>Books, invoices, GST &mdash; from zero</span></a>
            <a href="/KnowledgeBase/crm/CRM-Setup-Guide.html" class="nav-mobile-link" data-nav="kb-crm">CRM <span>Pipeline, deals, promotion to Accounts</span></a>
            <a href="/KnowledgeBase/crm/Facebook-Leads-Setup-Guide.html" class="nav-mobile-link" data-nav="kb-fb-leads">Facebook Lead Ads <span>Connect Meta Page leads to your CRM</span></a>
            <a href="/pitch-deck/ragenaizer-pitch-deck.html" class="nav-mobile-link" data-nav="kb-pitch-deck">Pitch Deck 2026 <span>The investor narrative</span></a>
            <div class="nav-mobile-divider"></div>
            <div class="nav-mobile-cta">
                <a href="/pages/login.html" class="btn-secondary" data-nav="signin">Sign In</a>
                <a href="/pages/pricing.html" class="btn-primary" data-nav="getstarted">Get Started</a>
            </div>
        </div>
    </div>`;
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
    toggleMobileMenu: function() {
        var menu = document.querySelector('.nav-mobile-menu');
        var overlay = document.querySelector('.nav-mobile-overlay');
        var hamburger = document.querySelector('.nav-hamburger');
        if (!menu) return;
        var isOpen = menu.classList.contains('open');
        menu.classList.toggle('open');
        overlay.classList.toggle('open');
        if (hamburger) hamburger.classList.toggle('open');
        document.body.style.overflow = isOpen ? '' : 'hidden';
    },

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
