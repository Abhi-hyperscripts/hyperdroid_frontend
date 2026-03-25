/**
 * Procurement Dashboard JavaScript
 */

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    await loadDashboard();
});

/**
 * Load all dashboard data
 */
async function loadDashboard() {
    try {
        await Promise.all([
            loadStats(),
            loadRecentActivity()
        ]);
    } catch (error) {
        console.error('Error loading dashboard:', error);
        Toast.error('Error loading dashboard data');
    }
}

/**
 * Fetch and populate stats cards
 */
async function loadStats() {
    try {
        const response = await api.request('/procurement/procurement-dashboard/summary', { _skipSpinner: true });
        const data = response.data || response || {};

        setTextContent('statVendors', data.vendors_total || 0);
        setTextContent('statItems', data.items_total || 0);
        setTextContent('statInquiries', (data.inquiries_draft || 0) + (data.inquiries_active || 0));
        setTextContent('statQuotes', data.quotes_pending || 0);
        setTextContent('statPOs', data.pos_total || 0);
        setTextContent('statPOAmount', formatCurrency(data.pos_total_amount || 0));
    } catch (error) {
        console.error('Error fetching stats:', error);
        setTextContent('statVendors', 0);
        setTextContent('statItems', 0);
        setTextContent('statInquiries', 0);
        setTextContent('statQuotes', 0);
        setTextContent('statPOs', 0);
        setTextContent('statPOAmount', formatCurrency(0));
    }
}

/**
 * Fetch and populate recent activity table
 */
async function loadRecentActivity() {
    const tbody = document.getElementById('recentActivityBody');
    if (!tbody) return;

    try {
        let activities = [];
        try {
            const response = await api.request('/procurement/procurement-dashboard/recent-activity', { _skipSpinner: true });
            activities = Array.isArray(response) ? response : (response?.data ?? []);
        } catch { /* endpoint may not be available */ }
        activities = activities.slice(0, 10);

        if (!activities || activities.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        <p>No recent activity found.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = activities.map(activity => `
            <tr>
                <td>
                    <div class="lead-info">
                        <div class="lead-avatar">${getInitials(activity.user_name || activity.performed_by || 'U')}</div>
                        <div>
                            <div class="lead-name">${escapeHtml(activity.user_name || activity.performed_by || '-')}</div>
                        </div>
                    </div>
                </td>
                <td><span class="status-badge ${(activity.action || '').toLowerCase().replace(/_/g, '-')}">${capitalizeFirst(activity.action || '-')}</span></td>
                <td>${capitalizeFirst(activity.entity_type || activity.entity || '-')}</td>
                <td>${formatActivityDetails(activity.description || activity.details, activity.action, activity.entity_type)}</td>
                <td>${formatDate(activity.created_at || activity.timestamp)}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading recent activity:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <p>Unable to load recent activity</p>
                </td>
            </tr>
        `;
    }
}

/**
 * Refresh dashboard data
 */
function refreshDashboard() {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('loading');
    loadDashboard().finally(() => {
        if (btn) btn.classList.remove('loading');
    });
}

/**
 * Navigate to a procurement sub-page
 */
function navigateTo(page) {
    window.location.href = page;
}

// ============================================
// Utility Functions
// ============================================

function getInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0);
}

function formatActivityDetails(details, action, entityType) {
    if (!details) return '-';
    try {
        const data = typeof details === 'string' ? JSON.parse(details) : details;
        const parts = [];
        for (const [key, value] of Object.entries(data)) {
            if (!value || key.endsWith('_id')) continue;
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            parts.push(`<strong>${label}:</strong> ${escapeHtml(String(value))}`);
        }
        return parts.length > 0 ? parts.join(' &middot; ') : '-';
    } catch {
        return escapeHtml(details);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function setTextContent(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}
