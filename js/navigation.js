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
        'hrms': 'HRMS'
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
     * Setup click outside listener to close dropdown
     */
    setupDropdownListeners() {
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('userDropdownMenu');
            const avatar = document.getElementById('userAvatar');
            if (dropdown && avatar && !dropdown.contains(e.target) && !avatar.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });
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
     * Display SW_VERSION from config.js in the nav dropdown.
     * config.js is loaded as a script tag on every page, so SW_VERSION is a global.
     */
    _showSwVersion() {
        const el = document.getElementById('navSwVersion');
        if (!el) return;
        if (typeof SW_VERSION !== 'undefined') {
            el.textContent = 'v' + SW_VERSION;
        }
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
        const savedMode = localStorage.getItem('theme-mode');
        if (savedMode) {
            return savedMode === 'dark';
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    /**
     * Toggle dark mode on/off
     */
    toggleDarkMode(event) {
        if (event) {
            event.stopPropagation();
        }

        const isDark = this.isDarkMode();
        const newMode = isDark ? 'light' : 'dark';

        // Save preference
        localStorage.setItem('theme-mode', newMode);

        // Apply theme
        document.documentElement.setAttribute('data-theme', newMode);

        // Update checkbox state
        const checkbox = document.getElementById('darkModeToggle');
        if (checkbox) {
            checkbox.checked = !isDark;
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

    if (path.includes('/hrms/')) {
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
