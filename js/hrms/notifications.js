/**
 * HRMS Notifications Page
 */

let allNotifications = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    if (typeof Navigation !== 'undefined') Navigation.init();
    await loadNotifications();
});

async function loadNotifications() {
    const container = document.getElementById('notificationsList');

    try {
        allNotifications = await api.getHrmsNotifications(false, 100) || [];
        renderNotifications();
    } catch (error) {
        console.error('Error loading notifications:', error);
        container.innerHTML = '<div class="ess-error-state"><p>Failed to load notifications</p></div>';
    }
}

function renderNotifications() {
    const container = document.getElementById('notificationsList');
    let filtered = [...allNotifications];

    if (currentFilter === 'unread') {
        filtered = filtered.filter(n => !n.is_read);
    }

    // Sort by date, newest first
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="ess-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <p>No notifications</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(n => `
        <div class="notification-item ${n.is_read ? '' : 'unread'}" onclick="markAsRead('${n.id}')">
            <div class="notification-icon">
                ${getNotificationIcon(n.notification_type)}
            </div>
            <div class="notification-content">
                <h4 class="notification-title">${escapeHtml(n.title)}</h4>
                <p class="notification-message">${escapeHtml(n.message)}</p>
                <span class="notification-time">${formatTimeAgo(n.created_at)}</span>
            </div>
        </div>
    `).join('');
}

function filterNotifications(filter) {
    currentFilter = filter;
    document.querySelectorAll('.announcement-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderNotifications();
}

async function markAsRead(id) {
    const notif = allNotifications.find(n => n.id === id);
    if (notif && !notif.is_read) {
        try {
            await api.markHrmsNotificationAsRead(id);
            notif.is_read = true;
            renderNotifications();
        } catch (e) {
            console.error('Error marking as read:', e);
        }
    }
}

async function markAllRead() {
    try {
        await api.markAllHrmsNotificationsAsRead();
        allNotifications.forEach(n => n.is_read = true);
        renderNotifications();
        showToast('All notifications marked as read', 'success');
    } catch (error) {
        console.error('Error marking all as read:', error);
        showToast('Failed to mark all as read', 'error');
    }
}

function getNotificationIcon(type) {
    const styles = getComputedStyle(document.documentElement);
    const successColor = styles.getPropertyValue('--color-success').trim() || '#10b981';
    const dangerColor = styles.getPropertyValue('--color-danger').trim() || '#ef4444';
    const primaryColor = styles.getPropertyValue('--brand-primary').trim() || '#3b82f6';
    const accentColor = styles.getPropertyValue('--brand-accent').trim() || '#8b5cf6';
    const warningColor = styles.getPropertyValue('--color-warning').trim() || '#f59e0b';
    const mutedColor = styles.getPropertyValue('--gray-500').trim() || '#64748b';

    const icons = {
        'leave_approved': `<svg viewBox="0 0 24 24" fill="none" stroke="${successColor}" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
        'leave_rejected': `<svg viewBox="0 0 24 24" fill="none" stroke="${dangerColor}" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
        'regularization': `<svg viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        'payslip': `<svg viewBox="0 0 24 24" fill="none" stroke="${successColor}" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
        'profile_update': `<svg viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
        'loan': `<svg viewBox="0 0 24 24" fill="none" stroke="${warningColor}" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`
    };
    return icons[type] || `<svg viewBox="0 0 24 24" fill="none" stroke="${mutedColor}" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
}

function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Local showToast removed - using unified toast.js instead
