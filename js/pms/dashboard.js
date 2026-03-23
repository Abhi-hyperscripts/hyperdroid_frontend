// PMS Dashboard JavaScript

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('pms', '../');

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
        showToast('Error loading dashboard data', 'error');
    }
}

/**
 * Fetch and populate stats cards
 */
async function loadStats() {
    // Fetch all stats in parallel, each with its own try/catch
    const [clientCount, projectCount, taskCount, weeklyHours, pendingCount, memberCount] = await Promise.all([
        fetchClientCount(),
        fetchProjectCount(),
        fetchOpenTaskCount(),
        fetchWeeklyHours(),
        fetchPendingTimesheetCount(),
        fetchTeamMemberCount()
    ]);

    setTextContent('activeClients', clientCount);
    setTextContent('activeProjects', projectCount);
    setTextContent('openTasks', taskCount);
    setTextContent('hoursThisWeek', weeklyHours);
    setTextContent('pendingTimesheets', pendingCount);
    setTextContent('teamMembers', memberCount);
}

async function fetchClientCount() {
    try {
        const response = await api.request('/pms/clients', { _skipSpinner: true });
        const clients = Array.isArray(response) ? response : (response?.data ?? []);
        return clients.filter(c => c.is_active !== false).length;
    } catch (error) {
        console.error('Error fetching clients:', error);
        return 0;
    }
}

async function fetchProjectCount() {
    try {
        const response = await api.request('/pms/projects', { _skipSpinner: true });
        const projects = Array.isArray(response) ? response : (response?.data ?? []);
        return projects.filter(p => p.status === 'in_progress' || p.status === 'not_started' || !p.status || p.is_active !== false).length;
    } catch (error) {
        console.error('Error fetching projects:', error);
        return 0;
    }
}

async function fetchOpenTaskCount() {
    try {
        const response = await api.request('/pms/tasks', { _skipSpinner: true });
        const tasks = Array.isArray(response) ? response : (response?.data ?? []);
        return tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length;
    } catch (error) {
        console.error('Error fetching tasks:', error);
        return 0;
    }
}

async function fetchWeeklyHours() {
    try {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        const fromDate = monday.toISOString().split('T')[0];
        const toDate = now.toISOString().split('T')[0];

        const response = await api.request(`/pms/time-entries/my?fromDate=${fromDate}&toDate=${toDate}`, { _skipSpinner: true });
        const entries = Array.isArray(response) ? response : (response?.data ?? []);
        const totalMinutes = entries.reduce((sum, e) => sum + ((parseInt(e.hours) || 0) * 60 + (parseInt(e.minutes) || 0)), 0);
        return (totalMinutes / 60).toFixed(1);
    } catch (error) {
        console.error('Error fetching weekly hours:', error);
        return '0.0';
    }
}

async function fetchPendingTimesheetCount() {
    try {
        const response = await api.request('/pms/timesheets/my', { _skipSpinner: true });
        const timesheets = Array.isArray(response) ? response : (response?.data ?? []);
        return timesheets.filter(t => t.status === 'pending' || t.status === 'submitted').length;
    } catch (error) {
        console.error('Error fetching timesheets:', error);
        return 0;
    }
}

async function fetchTeamMemberCount() {
    try {
        // Get all projects first, then fetch members for each
        const projResponse = await api.request('/pms/projects', { _skipSpinner: true });
        const projects = Array.isArray(projResponse) ? projResponse : (projResponse?.data ?? []);
        if (projects.length === 0) return 0;

        const uniqueUserIds = new Set();
        // Fetch members for up to 10 projects to avoid too many requests
        const projectsToCheck = projects.slice(0, 10);
        await Promise.all(projectsToCheck.map(async (p) => {
            try {
                const response = await api.request(`/pms/project-members?projectId=${p.id}`, { _skipSpinner: true });
                const members = Array.isArray(response) ? response : (response?.data ?? []);
                members.forEach(m => uniqueUserIds.add(m.user_id || m.id));
            } catch { /* ignore individual project errors */ }
        }));
        return uniqueUserIds.size;
    } catch (error) {
        console.error('Error fetching team members:', error);
        return 0;
    }
}

/**
 * Fetch and populate recent activity table
 */
async function loadRecentActivity() {
    const tbody = document.getElementById('recentActivityBody');
    if (!tbody) return;

    try {
        // Fetch recent activity - try getting from recent projects
        let activities = [];
        try {
            const projResponse = await api.request('/pms/projects', { _skipSpinner: true });
            const projects = Array.isArray(projResponse) ? projResponse : (projResponse?.data ?? []);
            if (projects.length > 0) {
                // Fetch activity for the most recent project
                const recentProject = projects[0];
                const actResponse = await api.request(`/pms/activity/project/${recentProject.id}`, { _skipSpinner: true });
                activities = Array.isArray(actResponse) ? actResponse : (actResponse?.data ?? []);
            }
        } catch { /* activity endpoint may not be available */ }
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
 * Navigate to a PMS sub-page
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

function formatActivityDetails(details, action, entityType) {
    if (!details) return '-';
    try {
        const data = typeof details === 'string' ? JSON.parse(details) : details;
        const parts = [];
        // Show human-readable key-value pairs, skip IDs
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
