// ============================================
// Shared Navigation Component
// Role-based navigation with dynamic links
// ============================================

const Navigation = {
    // Cached organization info
    _organizationInfo: null,

    // Service to role mapping
    serviceRoles: {
        vision: 'VISION_USER',
        drive: 'DRIVE_USER',
        chat: 'CHAT_USER',
        hrms: 'HRMS_USER',
        crm: 'CRM_USER',
        research: 'RESEARCH_USER',
        pms: 'PMS_USER',
        lms: 'LMS_USER',
        procurement: 'PROCUREMENT_USER',
        accounts: 'ACCOUNTS_USER',
        admin: 'SUPERADMIN'
    },

    // Navigation items configuration
    navItems: [
        {
            id: 'home',
            label: 'Home',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>`,
            href: 'home.html',
            requiresRole: null // Always visible
        },
        {
            id: 'vision',
            label: 'Meetings',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>`,
            href: 'vision/dashboard.html',
            requiresRole: 'VISION_USER'
        },
        {
            id: 'drive',
            label: 'Drive',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>`,
            href: 'drive/drive.html',
            requiresRole: 'DRIVE_USER'
        },
        {
            id: 'chat',
            label: 'Chat',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>`,
            href: 'chat/chat.html',
            requiresRole: 'CHAT_USER'
        },
        {
            id: 'hrms',
            label: 'HRMS',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>`,
            href: 'hrms/dashboard.html',
            requiresRole: 'HRMS_USER'
        },
        {
            id: 'crm',
            label: 'CRM',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
            </svg>`,
            href: 'crm/dashboard.html',
            requiresRole: 'CRM_USER'
        },
        {
            id: 'research',
            label: 'Research',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>`,
            href: 'research/dashboard.html',
            requiresRole: 'RESEARCH_USER'
        },
        {
            id: 'pms',
            label: 'Projects',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
                <path d="M9 14l2 2 4-4"/>
            </svg>`,
            href: 'pms/dashboard.html',
            requiresRole: 'PMS_USER'
        },
        {
            id: 'lms',
            label: 'Learning',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                <path d="M8 7h8"/>
                <path d="M8 11h6"/>
            </svg>`,
            href: 'lms/dashboard.html',
            requiresRole: 'LMS_USER'
        },
        {
            id: 'procurement',
            label: 'Procurement',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>`,
            href: 'procurement/dashboard.html',
            requiresRole: 'PROCUREMENT_USER'
        },
        {
            id: 'accounts',
            label: 'Accounts',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/>
                <path d="M8 10h8"/>
                <path d="M8 14h4"/>
            </svg>`,
            href: 'accounts/dashboard.html',
            requiresRole: 'ACCOUNTS_USER'
        },
        {
            id: 'news',
            label: 'KIP',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1m2 13a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2z"/>
                <line x1="7" y1="8" x2="13" y2="8"/>
                <line x1="7" y1="12" x2="11" y2="12"/>
                <line x1="7" y1="16" x2="13" y2="16"/>
            </svg>`,
            href: 'news/admin.html',
            requiresRole: 'SUPERADMIN'
        },
        {
            id: 'admin',
            label: 'Admin',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
            </svg>`,
            href: 'auth/dashboard.html',
            requiresRole: 'SUPERADMIN'
        }
    ],

    /**
     * Initialize navigation - call this on DOMContentLoaded
     * @param {string} currentPageId - The ID of the current page (home, vision, drive, chat, admin)
     * @param {string} basePath - Base path for links (e.g., '../' for pages in subfolders)
     */
    init(currentPageId, basePath = '') {
        const user = this.getUser();
        if (!user) return;

        this.renderNavbar(currentPageId, basePath, user);
        this.setupDropdownListeners();

        // Fetch organization info asynchronously and update display
        this.getOrganizationInfo().then(orgInfo => {
            if (orgInfo) {
                this.updateOrganizationDisplay(orgInfo);
            }
        });

        // Show SW version in dropdown
        this._showSwVersion();

        // Bootstrap FCM on all authenticated pages
        this._ensureFcmInitialized(basePath);

        // Fetch chat unread count (skip if already on the chat page)
        if (currentPageId !== 'chat') {
            this._fetchChatUnreadCount();
        }

        // Start global chat SignalR listener for in-app notifications
        // Skip on chat page — chat.js manages its own connection
        this._currentPageId = currentPageId;
        if (currentPageId !== 'chat') {
            this._initGlobalChatListener();
        }
    },

    /**
     * Get user from localStorage
     */
    getUser() {
        return getStoredUser();
    },

    /**
     * Get organization info from cache (populated at login from JWT token)
     */
    async getOrganizationInfo() {
        // Check memory cache first
        if (this._organizationInfo) {
            return this._organizationInfo;
        }

        // Check localStorage cache (populated at login from JWT token)
        const cached = localStorage.getItem('organization_info');
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                this._organizationInfo = parsed;
                return parsed;
            } catch (e) {
                console.warn('Error parsing cached organization info:', e);
            }
        }

        // If not in cache, try to extract from current JWT token
        if (typeof getAuthToken === 'function' && typeof storeOrganizationInfoFromToken === 'function') {
            const token = getAuthToken();
            if (token) {
                const orgInfo = storeOrganizationInfoFromToken(token);
                if (orgInfo) {
                    this._organizationInfo = orgInfo;
                    return orgInfo;
                }
            }
        }

        return null;
    },

    // Service name mapping for nav items
    navServiceMapping: {
        'vision': 'Vision',
        'drive': 'Drive',
        'chat': 'Chat',
        'hrms': 'HRMS',
        'crm': 'CRM',
        'research': 'Research',
        'pms': 'PMS',
        'lms': 'LMS',
        'procurement': 'Procurement'
        // 'admin' and 'home' don't require service licensing
    },

    /**
     * Update the organization name in dropdown and filter nav items based on licensed services
     */
    updateOrganizationDisplay(orgInfo) {
        const orgNameEl = document.getElementById('navOrgName');
        if (orgNameEl && orgInfo) {
            const displayName = orgInfo.organizationName || orgInfo.tenantName;
            if (displayName) {
                orgNameEl.textContent = displayName;
                orgNameEl.style.display = 'block';
            }
        }

        // Filter nav items based on licensed services
        if (orgInfo && orgInfo.licensedServices) {
            const navLinks = document.querySelectorAll('.nav-dropdown-link[data-nav-id]');
            navLinks.forEach(link => {
                const navId = link.getAttribute('data-nav-id');
                const serviceName = this.navServiceMapping[navId];

                // If service requires licensing and is not in the licensed list, hide it
                if (serviceName && !orgInfo.licensedServices.includes(serviceName)) {
                    link.style.display = 'none';
                }
            });
        }
    },

    /**
     * Check if user has a specific role or is SUPERADMIN
     */
    hasRole(user, requiredRole) {
        if (!requiredRole) return true;
        if (!user || !user.roles) return false;
        // SUPERADMIN has access to everything
        if (user.roles.includes('SUPERADMIN')) return true;
        return user.roles.includes(requiredRole);
    },

    /**
     * Get filtered nav items based on user roles
     */
    getAccessibleNavItems(user) {
        return this.navItems.filter(item => this.hasRole(user, item.requiresRole));
    },

    /**
     * Render the navbar
     */
    renderNavbar(currentPageId, basePath, user) {
        const navbarMenu = document.querySelector('.navbar-menu');
        if (!navbarMenu) return;

        const accessibleItems = this.getAccessibleNavItems(user);
        const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'U';
        const displayName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;

        // Build navbar HTML - only avatar in navbar
        navbarMenu.innerHTML = `
            <div class="user-avatar-container">
                <div class="user-avatar" id="userAvatar" onclick="Navigation.toggleDropdown()">
                    ${initials}
                </div>
            </div>
        `;

        // Remove any existing dropdown from body
        const existingDropdown = document.getElementById('navDropdownPortal');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        // Create dropdown as a portal appended directly to body
        // This bypasses all stacking context issues from backdrop-filter
        const dropdownPortal = document.createElement('div');
        dropdownPortal.id = 'navDropdownPortal';
        dropdownPortal.innerHTML = `
            <div class="user-dropdown-menu" id="userDropdownMenu">
                <div class="user-dropdown-header">
                    <div class="user-dropdown-header-content">
                        <div class="tenant-badge" id="navOrgName">Ragenaizer</div>
                        <span class="user-name">${this.escapeHtml(displayName)}</span>
                        <span class="user-email">${this.escapeHtml(user.email || '')}</span>
                    </div>
                </div>
                <div class="nav-links-section">
                    ${accessibleItems.map(item => `
                        <a href="${basePath}${item.href}"
                           class="nav-dropdown-link ${currentPageId === item.id ? 'active' : ''}"
                           data-nav-id="${item.id}">
                            <span class="nav-link-icon">${item.icon}</span>
                            <span class="nav-link-label">${item.label}</span>
                            ${item.id === 'chat' ? '<span class="nav-unread-badge" id="chatUnreadBadge" style="display:none;"></span>' : ''}
                        </a>
                    `).join('')}
                </div>
                <div class="user-dropdown-divider"></div>
                <div class="user-dropdown-item dark-mode-toggle" onclick="Navigation.toggleDarkMode(event)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                    </svg>
                    <span class="dark-mode-label">Dark Mode</span>
                    <div class="toggle-switch">
                        <input type="checkbox" id="darkModeToggle" ${this.isDarkMode() ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </div>
                </div>
                <div class="user-dropdown-item" onclick="Navigation.showChangePasswordModal(event)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    Change Password
                </div>
                <div class="user-dropdown-divider"></div>
                <button class="user-dropdown-item logout-btn" onclick="Navigation.logout()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Logout
                </button>
                <div class="nav-version-label" id="navSwVersion">v--</div>
            </div>
        `;
        document.body.appendChild(dropdownPortal);
    },

    /**
     * Toggle dropdown visibility
     */
    toggleDropdown() {
        const dropdown = document.getElementById('userDropdownMenu');
        if (dropdown) {
            dropdown.classList.toggle('show');
        }
    },

    /**
     * Setup listeners to close dropdown on outside interaction (click, scroll, touch)
     */
    setupDropdownListeners() {
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('userDropdownMenu');
            const avatar = document.getElementById('userAvatar');
            if (dropdown && avatar && !dropdown.contains(e.target) && !avatar.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });

        // Close on any scroll/touch interaction outside the dropdown
        const closeIfOpen = (e) => {
            const dropdown = document.getElementById('userDropdownMenu');
            if (dropdown && dropdown.classList.contains('show')) {
                // Don't close if scrolling inside the dropdown itself
                if (e && dropdown.contains(e.target)) return;
                dropdown.classList.remove('show');
            }
        };
        // Capture-phase scroll catches nested scrollable containers
        document.addEventListener('scroll', closeIfOpen, { passive: true, capture: true });
        // Wheel covers desktop mouse/trackpad scroll before scroll event fires
        document.addEventListener('wheel', closeIfOpen, { passive: true });
        // Touchmove covers mobile finger-drag scrolling on any element
        document.addEventListener('touchmove', closeIfOpen, { passive: true });
    },

    /**
     * Logout handler - uses API to revoke token on server
     */
    async logout() {
        // Use api.logout() if available to properly revoke token on server
        if (typeof api !== 'undefined' && api.logout) {
            await api.logout(true);
        } else {
            // Fallback for pages that don't have api loaded
            clearAuthData();
            window.location.href = '/index.html';
        }
    },

    /**
     * Show change password modal
     */
    showChangePasswordModal(event) {
        if (event) event.stopPropagation();

        // Close dropdown (hide, don't remove — removing destroys the portal permanently)
        const dropdown = document.getElementById('userDropdownMenu');
        if (dropdown) dropdown.classList.remove('show');

        // Remove existing modal if any
        let modal = document.getElementById('changePasswordModal');
        if (modal) modal.remove();

        // Create modal - inline critical styles to prevent CSS caching/specificity issues
        modal = document.createElement('div');
        modal.id = 'changePasswordModal';
        modal.className = 'nav-modal-overlay';
        Object.assign(modal.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '2147483647',
            background: 'rgba(0, 0, 0, 0.5)',
            padding: '16px'
        });
        modal.innerHTML = `
            <div class="nav-modal-content">
                <div class="nav-modal-header">
                    <h3>Change Password</h3>
                    <button class="nav-modal-close" onclick="Navigation.closeChangePasswordModal()">&times;</button>
                </div>
                <div class="nav-modal-body">
                    <form id="changePasswordForm" onsubmit="Navigation.submitChangePassword(event)">
                        <div class="nav-form-group">
                            <label for="navCurrentPassword">Current Password</label>
                            <div class="nav-password-wrapper">
                                <input type="password" id="navCurrentPassword" required autocomplete="current-password">
                                <button type="button" class="nav-toggle-pw" onclick="Navigation.togglePasswordVisibility('navCurrentPassword', this)">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                </button>
                            </div>
                        </div>
                        <div class="nav-form-group">
                            <label for="navNewPassword">New Password</label>
                            <div class="nav-password-wrapper">
                                <input type="password" id="navNewPassword" required autocomplete="new-password" minlength="8">
                                <button type="button" class="nav-toggle-pw" onclick="Navigation.togglePasswordVisibility('navNewPassword', this)">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                </button>
                            </div>
                            <small class="nav-pw-hint">Min 8 chars: upper, lower, digit, special</small>
                        </div>
                        <div class="nav-form-group">
                            <label for="navConfirmPassword">Confirm Password</label>
                            <div class="nav-password-wrapper">
                                <input type="password" id="navConfirmPassword" required autocomplete="new-password">
                                <button type="button" class="nav-toggle-pw" onclick="Navigation.togglePasswordVisibility('navConfirmPassword', this)">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                </button>
                            </div>
                        </div>
                        <div id="navPwError" class="nav-pw-error" style="display:none;"></div>
                        <button type="submit" class="nav-pw-submit" id="navPwSubmitBtn">Change Password</button>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) Navigation.closeChangePasswordModal();
        });

        // Focus first input
        setTimeout(() => document.getElementById('navCurrentPassword')?.focus(), 100);
    },

    closeChangePasswordModal() {
        const modal = document.getElementById('changePasswordModal');
        if (modal) modal.remove();
    },

    togglePasswordVisibility(inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.innerHTML = isPassword
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    },

    async submitChangePassword(event) {
        event.preventDefault();
        const errorEl = document.getElementById('navPwError');
        const submitBtn = document.getElementById('navPwSubmitBtn');
        const currentPassword = document.getElementById('navCurrentPassword').value;
        const newPassword = document.getElementById('navNewPassword').value;
        const confirmPassword = document.getElementById('navConfirmPassword').value;

        errorEl.style.display = 'none';

        if (newPassword !== confirmPassword) {
            errorEl.textContent = 'New password and confirmation do not match.';
            errorEl.style.display = 'block';
            return;
        }

        if (newPassword.length < 8) {
            errorEl.textContent = 'Password must be at least 8 characters.';
            errorEl.style.display = 'block';
            return;
        }

        // Validate password strength
        const hasUpper = /[A-Z]/.test(newPassword);
        const hasLower = /[a-z]/.test(newPassword);
        const hasDigit = /[0-9]/.test(newPassword);
        const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
        if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
            errorEl.textContent = 'Password needs uppercase, lowercase, digit, and special character.';
            errorEl.style.display = 'block';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Changing...';

        try {
            await api.request('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            });

            Navigation.closeChangePasswordModal();

            // Show success via Toast if available, else alert
            if (typeof Toast !== 'undefined' && Toast.success) {
                Toast.success('Password changed successfully. Please log in again.');
            } else if (typeof showToast === 'function') {
                showToast('Password changed successfully. Please log in again.', 'success');
            } else {
                alert('Password changed successfully. Please log in again.');
            }

            // Log out after password change since JWT is invalidated
            setTimeout(() => Navigation.logout(), 2000);
        } catch (error) {
            errorEl.textContent = error.message || 'Failed to change password. Check your current password.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Change Password';
        }
    },

    /**
     * Display SW_VERSION in the nav dropdown.
     * Reads from /js/sw-version.js (single source of truth).
     */
    /**
     * Fetch total unread chat message count and display badge on Chat nav link.
     */
    async _fetchChatUnreadCount() {
        try {
            if (typeof api === 'undefined') return;
            const conversations = await api.getConversations(100, 0);
            const list = conversations.conversations || conversations || [];
            const total = list.reduce((sum, c) => sum + (c.unread_count || 0), 0);
            this._chatUnreadCount = total;
            this._updateChatBadge(total);
        } catch (e) {
            // Silently ignore — chat service may be unavailable
        }
    },

    /**
     * Update the chat unread badge in the nav dropdown.
     * Also adds a dot indicator on the user avatar trigger.
     */
    _updateChatBadge(count) {
        const badge = document.getElementById('chatUnreadBadge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        }

        // Also show/hide a small dot on the user avatar
        const avatar = document.getElementById('userAvatar');
        if (avatar) {
            let dot = avatar.querySelector('.nav-chat-dot');
            if (count > 0) {
                if (!dot) {
                    dot = document.createElement('span');
                    dot.className = 'nav-chat-dot';
                    dot.style.cssText = 'position:absolute;top:2px;right:2px;width:10px;height:10px;border-radius:50%;background:var(--color-error,#ef4444);border:2px solid var(--bg-primary,#0f172a);pointer-events:none;';
                    avatar.style.position = 'relative';
                    avatar.appendChild(dot);
                }
            } else if (dot) {
                dot.remove();
            }
        }
    },

    // ── Global Chat SignalR Listener ──
    // Connects to chat hub on all non-chat pages to show toast notifications
    // and update the unread badge in real-time when messages arrive.
    _chatConnection: null,
    _chatUnreadCount: 0,

    async _initGlobalChatListener() {
        try {
            // Check prerequisites
            if (typeof CONFIG === 'undefined' || typeof getAuthToken !== 'function') return;
            const token = getAuthToken();
            if (!token) return;

            // Check if user has CHAT_USER role
            const user = getStoredUser();
            if (!user) return;
            const roles = user.roles || [];
            if (!roles.includes('CHAT_USER') && !roles.includes('SUPERADMIN')) return;

            // Load SignalR library if not already loaded
            if (typeof signalR === 'undefined') {
                await this._loadScript('https://cdn.jsdelivr.net/npm/@microsoft/signalr@8.0.0/dist/browser/signalr.min.js');
                // Wait a tick for the script to initialize
                await new Promise(r => setTimeout(r, 50));
                if (typeof signalR === 'undefined') return;
            }

            // Build connection
            this._chatConnection = new signalR.HubConnectionBuilder()
                .withUrl(CONFIG.chatSignalRHubUrl, {
                    accessTokenFactory: () => getAuthToken(),
                    transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling
                })
                .withAutomaticReconnect([2000, 5000, 10000, 30000, 60000])
                .configureLogging(signalR.LogLevel.Warning)
                .build();

            // Listen for new messages
            this._chatConnection.on('MessageReceived', (event) => {
                this._handleGlobalMessageReceived(event);
            });

            // Start connection (non-blocking)
            await this._chatConnection.start();
            console.log('[Nav/Chat] Global chat listener connected');
        } catch (err) {
            // Non-blocking — chat notification failure should never break page
            console.warn('[Nav/Chat] Failed to initialize global chat listener:', err.message);
        }
    },

    _handleGlobalMessageReceived(event) {
        const { message, conversation_id } = event;
        if (!message) return;

        // Don't toast for own messages
        const user = getStoredUser();
        if (user && message.sender_id === user.userId) return;

        // Update unread badge
        this._chatUnreadCount++;
        this._updateChatBadge(this._chatUnreadCount);

        // Show toast notification
        const senderName = message.sender_name || 'Someone';
        const preview = message.content
            ? (message.content.length > 60 ? message.content.substring(0, 60) + '...' : message.content)
            : (message.message_type === 'file' ? 'sent a file' : 'sent a message');

        if (typeof showToast === 'function') {
            showToast(`${senderName}: ${preview}`, 'info', 4000);
        } else if (typeof Toast !== 'undefined') {
            Toast.info(`${senderName}: ${preview}`);
        }
    },

    _showSwVersion() {
        const el = document.getElementById('navSwVersion');
        if (!el) return;

        // If already loaded as a global (e.g. via script tag), use it directly
        if (typeof SW_VERSION !== 'undefined') {
            el.textContent = 'v' + SW_VERSION;
            return;
        }

        // Otherwise fetch the tiny version file
        fetch('/js/sw-version.js?_=' + Date.now(), { cache: 'no-store' })
            .then(r => r.text())
            .then(text => {
                const m = text.match(/SW_VERSION\s*=\s*(\d+)/);
                if (m) el.textContent = 'v' + m[1];
            })
            .catch(() => {});
    },

    /**
     * Bootstrap FCM token registration on any authenticated page.
     * If firebase-init.js is already loaded (login.html, home.html), uses it directly.
     * Otherwise dynamically loads the script first.
     * Calls ensureFcmTokenRegistered() which is a no-op if already registered (localStorage check).
     * If permission is still 'default', shows the in-app notification card.
     * @param {string} basePath - Base path for script URLs
     */
    async _ensureFcmInitialized(basePath = '') {
        try {
            // Ensure firebase-init.js is loaded
            if (typeof ensureFcmTokenRegistered !== 'function') {
                if (typeof FIREBASE_CONFIG === 'undefined' || typeof api === 'undefined') {
                    console.log('[Nav/FCM] Prerequisites not loaded, skipping FCM init');
                    return;
                }
                await this._loadScript('/js/firebase-init.js');
            }

            // Try to register token (no-op if already registered or permission not granted)
            if (typeof ensureFcmTokenRegistered === 'function') {
                await ensureFcmTokenRegistered();
                if (typeof setupForegroundMessageHandler === 'function') {
                    setupForegroundMessageHandler();
                }
            }

            // If permission is still 'default', show the in-app card
            if ('Notification' in window && Notification.permission === 'default') {
                this._showNotificationCard();
            }
        } catch (err) {
            // Non-blocking — FCM failure should never break page functionality
            console.warn('[Nav/FCM] Failed to initialize FCM:', err);
        }
    },

    /**
     * Show a glassy bento-style card prompting the user to enable notifications.
     * The "Enable" button tap is a genuine user gesture so Mobile Chrome will
     * show the native permission prompt.
     */
    _showNotificationCard() {
        // Don't show if card already exists
        if (document.getElementById('fcmPermissionCard')) return;

        // Check dismiss timestamp — re-show after 7 days
        const dismissedAt = localStorage.getItem('ragenaizer_fcm_prompt_dismissed');
        if (dismissedAt) {
            const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
            if (Date.now() - parseInt(dismissedAt, 10) < SEVEN_DAYS) return;
        }

        const card = document.createElement('div');
        card.id = 'fcmPermissionCard';
        card.className = 'fcm-permission-card';
        card.innerHTML = `
            <div class="fcm-permission-card-header">
                <div class="fcm-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                </div>
                <div class="fcm-content">
                    <p class="fcm-content-title">Stay in the loop</p>
                    <p class="fcm-content-subtitle">Enable notifications to get alerts for messages and meetings.</p>
                </div>
                <button class="fcm-dismiss-btn" id="fcmDismissBtn" aria-label="Dismiss">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <button class="fcm-enable-btn" id="fcmEnableBtn">Enable Notifications</button>
        `;

        document.body.appendChild(card);

        // Enable button — user gesture triggers native prompt
        document.getElementById('fcmEnableBtn').addEventListener('click', async () => {
            const btn = document.getElementById('fcmEnableBtn');
            btn.textContent = 'Requesting...';
            btn.disabled = true;

            try {
                if (typeof requestNotificationPermissionOnly === 'function') {
                    const permission = await requestNotificationPermissionOnly();
                    if (permission === 'granted') {
                        // Register token now that permission is granted
                        if (typeof ensureFcmTokenRegistered === 'function') {
                            await ensureFcmTokenRegistered(true);
                        }
                        if (typeof Toast !== 'undefined' && Toast.success) {
                            Toast.success('Notifications enabled!');
                        }
                    }
                }
            } catch (err) {
                console.warn('[Nav/FCM] Permission request error:', err);
            }

            Navigation._removeNotificationCard();
        });

        // Dismiss button — store timestamp, hide card
        document.getElementById('fcmDismissBtn').addEventListener('click', () => {
            localStorage.setItem('ragenaizer_fcm_prompt_dismissed', String(Date.now()));
            Navigation._removeNotificationCard();
        });
    },

    /**
     * Remove the notification permission card with a fade-out animation.
     */
    _removeNotificationCard() {
        const card = document.getElementById('fcmPermissionCard');
        if (!card) return;

        card.classList.add('fcm-removing');
        card.addEventListener('animationend', () => card.remove(), { once: true });
        // Fallback removal in case animationend doesn't fire
        setTimeout(() => { if (card.parentNode) card.remove(); }, 400);
    },

    /**
     * Dynamically load a script and return a promise that resolves when loaded.
     * @param {string} src - Script URL
     * @returns {Promise<void>}
     */
    _loadScript(src) {
        return new Promise((resolve, reject) => {
            // Avoid loading the same script twice
            const existing = document.querySelector(`script[src*="${src.split('?')[0]}"]`);
            if (existing) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            // Append cache buster if available
            script.src = window.CACHE_VERSION ? `${src}?v=${CACHE_VERSION}` : src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /**
     * Check if dark mode is currently enabled
     */
    isDarkMode() {
        // Use Theme system as source of truth if available
        if (typeof Theme !== 'undefined' && Theme.isDarkMode) {
            return Theme.isDarkMode();
        }
        const savedMode = localStorage.getItem('theme-mode');
        if (savedMode) {
            return savedMode === 'dark';
        }
        // Default to dark (matches Theme.getSystemPreference())
        return true;
    },

    /**
     * Toggle dark mode on/off
     */
    toggleDarkMode(event) {
        if (event) {
            event.stopPropagation();
        }

        const newMode = this.isDarkMode() ? 'light' : 'dark';

        // Use Theme system if available (handles CSS variables, localStorage, data-theme)
        if (typeof Theme !== 'undefined' && Theme.setMode) {
            Theme.setMode(newMode);
        } else {
            // Fallback
            localStorage.setItem('theme-mode', newMode);
            document.documentElement.setAttribute('data-theme', newMode);
        }

        // Update checkbox state
        const checkbox = document.getElementById('darkModeToggle');
        if (checkbox) {
            checkbox.checked = newMode === 'dark';
        }
    }
};

// Also expose toggleUserDropdown for backward compatibility
function toggleUserDropdown() {
    Navigation.toggleDropdown();
}

/**
 * Load navigation - backward compatible wrapper for Navigation.init()
 * Detects current page and base path automatically
 */
async function loadNavigation() {
    // Detect current page based on URL path
    const path = window.location.pathname;
    let currentPageId = 'home';
    let basePath = '';

    if (path.includes('/crm/')) {
        currentPageId = 'crm';
        basePath = '../';
    } else if (path.includes('/hrms/')) {
        currentPageId = 'hrms';
        basePath = '../';
    } else if (path.includes('/vision/')) {
        currentPageId = 'vision';
        basePath = '../';
    } else if (path.includes('/drive/')) {
        currentPageId = 'drive';
        basePath = '../';
    } else if (path.includes('/chat/')) {
        currentPageId = 'chat';
        basePath = '../';
    } else if (path.includes('/research/')) {
        currentPageId = 'research';
        basePath = '../';
    } else if (path.includes('/pms/')) {
        currentPageId = 'pms';
        basePath = '../';
    } else if (path.includes('/lms/')) {
        currentPageId = 'lms';
        basePath = '../';
    } else if (path.includes('/procurement/')) {
        currentPageId = 'procurement';
        basePath = '../';
    } else if (path.includes('/auth/')) {
        currentPageId = 'admin';
        basePath = '../';
    }

    // Initialize navigation
    Navigation.init(currentPageId, basePath);
}

// Export for ES6 modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Navigation;
}
