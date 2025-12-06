// ============================================
// Shared Navigation Component
// Role-based navigation with dynamic links
// ============================================

const Navigation = {
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
    },

    /**
     * Get user from localStorage
     */
    getUser() {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
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
                    <span class="user-dropdown-name">${this.escapeHtml(displayName)}</span>
                    <span class="user-dropdown-email">${this.escapeHtml(user.email || '')}</span>
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
                <button class="user-dropdown-item logout-btn" onclick="Navigation.logout()">
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
     * Logout handler
     */
    logout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        window.location.href = '/index.html';
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

// Also expose toggleUserDropdown for backward compatibility
function toggleUserDropdown() {
    Navigation.toggleDropdown();
}

// Export for ES6 modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Navigation;
}
