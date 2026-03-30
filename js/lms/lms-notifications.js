/**
 * LMS Notifications Module
 * Adds a notification bell to the navbar with dropdown panel.
 * Auto-injects into .navbar-menu before the user avatar.
 */

const LmsNotifications = {
    _notifications: [],
    _unreadCount: 0,
    _isOpen: false,
    _pollInterval: null,

    async init() {
        // Only init on LMS pages and if authenticated
        if (typeof api === 'undefined' || !api.isAuthenticated()) return;

        this._injectBellUI();
        await this._fetchUnreadCount();

        // Poll for unread count every 60 seconds
        this._pollInterval = setInterval(() => this._fetchUnreadCount(), 60000);

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (this._isOpen && !e.target.closest('.lms-notif-container')) {
                this._closeDropdown();
            }
        });
    },

    _injectBellUI() {
        const navbarMenu = document.querySelector('.navbar-menu');
        if (!navbarMenu) return;

        // Don't double-inject
        if (document.getElementById('lmsNotifBell')) return;

        const container = document.createElement('div');
        container.className = 'lms-notif-container';
        container.id = 'lmsNotifBell';
        container.innerHTML = `
            <button class="lms-notif-bell" onclick="LmsNotifications.toggle()" title="Notifications">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <span class="lms-notif-badge" id="lmsNotifBadge" style="display:none">0</span>
            </button>
        `;

        // Insert before the avatar container
        const avatar = navbarMenu.querySelector('.user-avatar-container');
        if (avatar) {
            navbarMenu.insertBefore(container, avatar);
        } else {
            navbarMenu.appendChild(container);
        }

        // Create dropdown portal (appended to body to avoid stacking context issues)
        const portal = document.createElement('div');
        portal.id = 'lmsNotifDropdownPortal';
        portal.innerHTML = `
            <div class="lms-notif-dropdown" id="lmsNotifDropdown" style="display:none">
                <div class="lms-notif-header">
                    <span>Notifications</span>
                    <button class="lms-notif-mark-all" onclick="LmsNotifications.markAllRead()">Mark all read</button>
                </div>
                <div class="lms-notif-list" id="lmsNotifList">
                    <div class="lms-notif-empty">No notifications</div>
                </div>
            </div>
        `;
        document.body.appendChild(portal);
    },

    async toggle() {
        if (this._isOpen) {
            this._closeDropdown();
        } else {
            await this._openDropdown();
        }
    },

    async _openDropdown() {
        const dropdown = document.getElementById('lmsNotifDropdown');
        if (!dropdown) return;

        // Position dropdown relative to bell
        const bell = document.querySelector('.lms-notif-bell');
        if (bell) {
            const rect = bell.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 8) + 'px';
            dropdown.style.right = (window.innerWidth - rect.right) + 'px';
        }

        dropdown.style.display = 'block';
        this._isOpen = true;

        await this._fetchNotifications();
    },

    _closeDropdown() {
        const dropdown = document.getElementById('lmsNotifDropdown');
        if (dropdown) dropdown.style.display = 'none';
        this._isOpen = false;
    },

    async _fetchUnreadCount() {
        try {
            const data = await api.request('/lms/lms-notifications/unread-count');
            this._unreadCount = data.unread_count || 0;
            this._updateBadge();
        } catch (e) {
            // Silently fail - notifications are non-critical
        }
    },

    async _fetchNotifications() {
        const list = document.getElementById('lmsNotifList');
        if (!list) return;

        list.innerHTML = '<div class="lms-notif-empty">Loading...</div>';

        try {
            const data = await api.request('/lms/lms-notifications?limit=20');
            this._notifications = Array.isArray(data) ? data : (data.notifications || []);
            this._renderList();
        } catch (e) {
            list.innerHTML = '<div class="lms-notif-empty">Failed to load</div>';
        }
    },

    _renderList() {
        const list = document.getElementById('lmsNotifList');
        if (!list) return;

        if (!this._notifications.length) {
            list.innerHTML = '<div class="lms-notif-empty">No notifications yet</div>';
            return;
        }

        list.innerHTML = this._notifications.map(n => {
            const icon = this._getIcon(n.type);
            const timeAgo = this._timeAgo(n.createdAt);
            const unreadClass = n.isRead ? '' : 'unread';
            const href = this._getLink(n);

            return `
                <div class="lms-notif-item ${unreadClass}" onclick="LmsNotifications._handleClick('${n.id}', '${href}')">
                    <div class="lms-notif-icon">${icon}</div>
                    <div class="lms-notif-content">
                        <div class="lms-notif-title">${this._escapeHtml(n.title)}</div>
                        ${n.message ? `<div class="lms-notif-msg">${this._escapeHtml(n.message).substring(0, 80)}</div>` : ''}
                        <div class="lms-notif-time">${timeAgo}</div>
                    </div>
                    ${!n.isRead ? '<div class="lms-notif-dot"></div>' : ''}
                </div>
            `;
        }).join('');
    },

    async _handleClick(id, href) {
        // Mark as read
        try {
            await api.request(`/lms/lms-notifications/${id}/read`, { method: 'PUT' });
            this._unreadCount = Math.max(0, this._unreadCount - 1);
            this._updateBadge();

            const item = this._notifications.find(n => n.id === id);
            if (item) item.isRead = true;
            this._renderList();
        } catch (e) { /* ignore */ }

        // Navigate if link
        if (href && href !== '#') {
            this._closeDropdown();
            window.location.href = href;
        }
    },

    async markAllRead() {
        try {
            await api.request('/lms/lms-notifications/read-all', { method: 'PUT' });
            this._unreadCount = 0;
            this._updateBadge();
            this._notifications.forEach(n => n.isRead = true);
            this._renderList();
            if (typeof showToast === 'function') showToast('All notifications marked as read', 'success');
        } catch (e) {
            if (typeof showToast === 'function') showToast('Failed to mark notifications', 'error');
        }
    },

    _updateBadge() {
        const badge = document.getElementById('lmsNotifBadge');
        if (!badge) return;
        if (this._unreadCount > 0) {
            badge.style.display = '';
            badge.textContent = this._unreadCount > 99 ? '99+' : this._unreadCount;
        } else {
            badge.style.display = 'none';
        }
    },

    _getIcon(type) {
        const icons = {
            enrollment: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
            completion: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            grade: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg>',
            due: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            session: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>',
        };
        return icons[type] || icons.enrollment;
    },

    _getLink(n) {
        if (!n.referenceType || !n.referenceId) return '#';
        const links = {
            course: `course-detail.html?id=${n.referenceId}`,
            quiz: `quiz.html?id=${n.referenceId}`,
            assignment: `assignments.html`,
            path: `learning-paths.html`,
            session: `live-sessions.html`,
        };
        return links[n.referenceType] || '#';
    },

    _timeAgo(dateStr) {
        if (!dateStr) return '';
        const now = new Date();
        const date = new Date(dateStr);
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

// Auto-init after a short delay to ensure Navigation has rendered the navbar
setTimeout(() => LmsNotifications.init(), 500);
