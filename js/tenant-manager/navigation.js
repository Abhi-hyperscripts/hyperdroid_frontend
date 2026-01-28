// ============================================
// TenantManager Navigation Component
// Matches main Frontend navbar style
// ============================================

const TMNavigation = {
    /**
     * Initialize navigation
     * @param {string} currentPageId - Current page (dashboard, tenants, services, verify)
     */
    init(currentPageId) {
        const user = api.getUser();
        if (!user) return;

        this.renderNavbar(currentPageId, user);
        this.setupDropdownListeners();
    },

    /**
     * Navigation items for TenantManager
     */
    navItems: [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
            </svg>`,
            href: 'dashboard.html'
        },
        {
            id: 'tenants',
            label: 'Tenants',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>`,
            href: 'tenants.html'
        },
        {
            id: 'services',
            label: 'Services',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
            </svg>`,
            href: 'services.html'
        },
        {
            id: 'verify',
            label: 'Verify License',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>`,
            href: 'verify.html'
        }
    ],

    /**
     * Render the navbar
     */
    renderNavbar(currentPageId, user) {
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;

        const initials = this.getInitials(user);
        const displayName = user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;

        // Update navbar HTML to match main Frontend style
        navbar.innerHTML = `
            <div class="navbar-brand">
                <a href="dashboard.html">
                    <img src="../../assets/brand_logo.png" alt="HyperDroid Logo" class="navbar-logo">
                </a>
            </div>
            <div class="navbar-menu">
                <div class="user-avatar-container">
                    <div class="user-avatar" id="tmUserAvatar" onclick="TMNavigation.toggleDropdown()">
                        ${initials}
                    </div>
                </div>
            </div>
        `;

        // Remove any existing dropdown
        const existingDropdown = document.getElementById('tmNavDropdownPortal');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        // Create dropdown portal
        const dropdownPortal = document.createElement('div');
        dropdownPortal.id = 'tmNavDropdownPortal';
        dropdownPortal.innerHTML = `
            <div class="user-dropdown-menu" id="tmUserDropdownMenu">
                <div class="user-dropdown-header">
                    <span class="user-dropdown-org">TenantManager</span>
                    <span class="user-dropdown-name">${this.escapeHtml(displayName)}</span>
                    <span class="user-dropdown-email">${this.escapeHtml(user.email || '')}</span>
                </div>
                <div class="nav-links-section">
                    ${this.navItems.map(item => `
                        <a href="${item.href}"
                           class="nav-dropdown-link ${currentPageId === item.id ? 'active' : ''}"
                           data-nav-id="${item.id}">
                            <span class="nav-link-icon">${item.icon}</span>
                            <span class="nav-link-label">${item.label}</span>
                        </a>
                    `).join('')}
                </div>
                <div class="user-dropdown-divider"></div>
                <div class="user-dropdown-item dark-mode-toggle" onclick="TMNavigation.toggleDarkMode(event)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                    </svg>
                    <span class="dark-mode-label">Dark Mode</span>
                    <div class="toggle-switch">
                        <input type="checkbox" id="tmDarkModeToggle" ${this.isDarkMode() ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </div>
                </div>
                <div class="user-dropdown-divider"></div>
                <button class="user-dropdown-item logout-btn" onclick="TMNavigation.logout()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Logout
                </button>
            </div>
        `;
        document.body.appendChild(dropdownPortal);
    },

    /**
     * Get user initials
     */
    getInitials(user) {
        if (user.firstName && user.lastName) {
            return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
        }
        if (user.firstName) {
            return user.firstName.substring(0, 2).toUpperCase();
        }
        if (user.email) {
            return user.email.substring(0, 2).toUpperCase();
        }
        return 'TM';
    },

    /**
     * Toggle dropdown visibility
     */
    toggleDropdown() {
        const dropdown = document.getElementById('tmUserDropdownMenu');
        if (dropdown) {
            dropdown.classList.toggle('show');
        }
    },

    /**
     * Setup click outside listener
     */
    setupDropdownListeners() {
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('tmUserDropdownMenu');
            const avatar = document.getElementById('tmUserAvatar');
            if (dropdown && avatar && !dropdown.contains(e.target) && !avatar.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });
    },

    /**
     * Check if dark mode is enabled
     */
    isDarkMode() {
        const savedMode = localStorage.getItem('theme-mode');
        if (savedMode) {
            return savedMode === 'dark';
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    /**
     * Toggle dark mode
     */
    toggleDarkMode(event) {
        if (event) {
            event.stopPropagation();
        }

        const isDark = this.isDarkMode();
        const newMode = isDark ? 'light' : 'dark';

        localStorage.setItem('theme-mode', newMode);
        document.documentElement.setAttribute('data-theme', newMode);

        const checkbox = document.getElementById('tmDarkModeToggle');
        if (checkbox) {
            checkbox.checked = !isDark;
        }

        // Also update Theme if available
        if (typeof Theme !== 'undefined' && Theme.applyBrandTheme) {
            Theme.applyBrandTheme();
        }
    },

    /**
     * Logout handler
     */
    logout() {
        api.logout();
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};
