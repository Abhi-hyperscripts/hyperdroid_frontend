/**
 * PMS Activity Log
 * Displays tenant-wide activity with entity type and project filters.
 */

// ==================== State ====================
let allActivities = [];
let allProjects = [];

// SearchableDropdown instances
let filterEntityTypeDropdown = null;
let filterProjectDropdown = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    initSearchableDropdowns();
    loadProjects();
    loadActivity();
});

// ==================== Data Loading ====================

async function loadActivity() {
    const tbody = document.getElementById('activityTableBody');
    const entityType = document.getElementById('filterEntityType')?.value || '';
    const projectId = document.getElementById('filterProject')?.value || '';

    try {
        let activities = [];

        if (projectId) {
            const response = await api.request(`/pms/activity/project/${projectId}?limit=100`);
            activities = Array.isArray(response) ? response : (response?.data ?? []);
        } else {
            let url = '/pms/activity/recent?limit=100';
            if (entityType) {
                url += `&entityType=${encodeURIComponent(entityType)}`;
            }
            const response = await api.request(url);
            activities = Array.isArray(response) ? response : (response?.data ?? []);
        }

        // Apply entity type filter client-side when using project endpoint
        if (projectId && entityType) {
            activities = activities.filter(a => a.entity_type === entityType);
        }

        allActivities = activities;
        renderActivityTable(activities);
    } catch (error) {
        console.error('Error loading activity:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <p>Failed to load activity</p>
                    </div>
                </td>
            </tr>
        `;
    }
}

async function loadProjects() {
    try {
        const response = await api.request('/pms/projects', { _skipSpinner: true });
        allProjects = Array.isArray(response) ? response : (response?.data ?? []);
        populateProjectFilter();
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

// ==================== Rendering ====================

function renderActivityTable(activities) {
    const tbody = document.getElementById('activityTableBody');

    if (!activities || activities.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                        </svg>
                        <p>No activity found</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = activities.map(activity => {
        const userName = activity.user_name || 'Unknown';
        const initials = getInitials(userName);
        const actionBadge = getActionBadgeClass(activity.action);
        const details = formatDetails(activity);

        return `
        <tr>
            <td>
                <div class="lead-info">
                    <div class="lead-avatar">${initials}</div>
                    <div>
                        <div class="lead-name">${escapeHtml(userName)}</div>
                    </div>
                </div>
            </td>
            <td>
                <span class="crm-status-badge ${actionBadge}">${capitalizeFirst(activity.action || '-')}</span>
            </td>
            <td>
                <span class="crm-status-badge status-new">${formatEntityType(activity.entity_type)}</span>
            </td>
            <td>
                <span class="crm-cell-secondary">${escapeHtml(details)}</span>
            </td>
            <td>
                <span class="crm-cell-secondary">${formatDateTime(activity.created_at)}</span>
            </td>
        </tr>
        `;
    }).join('');
}

// ==================== Filters ====================

function populateProjectFilter() {
    const select = document.getElementById('filterProject');
    if (!select) return;

    // Keep "All Projects" option, add project options
    let html = '<option value="">All Projects</option>';
    allProjects.forEach(p => {
        const name = escapeHtml(p.project_name || p.name || '');
        html += `<option value="${p.id}">${name}</option>`;
    });
    select.innerHTML = html;

    // Refresh searchable dropdown
    if (filterProjectDropdown) {
        filterProjectDropdown.destroy();
        filterProjectDropdown = convertSelectToSearchable('filterProject', {
            compact: true,
            placeholder: 'All Projects',
            searchPlaceholder: 'Search projects...',
            onChange: () => applyFilters()
        });
    }
}

function applyFilters() {
    loadActivity();
}

// ==================== Searchable Dropdowns ====================

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    if (!filterEntityTypeDropdown) {
        filterEntityTypeDropdown = convertSelectToSearchable('filterEntityType', {
            compact: true,
            placeholder: 'All Types',
            searchPlaceholder: 'Search types...',
            onChange: () => applyFilters()
        });
    }

    if (!filterProjectDropdown) {
        filterProjectDropdown = convertSelectToSearchable('filterProject', {
            compact: true,
            placeholder: 'All Projects',
            searchPlaceholder: 'Search projects...',
            onChange: () => applyFilters()
        });
    }
}

// ==================== Formatting Helpers ====================

function formatEntityType(type) {
    const labels = {
        'client': 'Client',
        'project': 'Project',
        'sub_project': 'Sub-Project',
        'task': 'Task',
        'member': 'Member',
        'time_entry': 'Time Entry',
        'timesheet': 'Timesheet',
        'tag': 'Tag',
        'contact': 'Contact'
    };
    return labels[type] || capitalizeFirst(type || 'Unknown');
}

function getActionBadgeClass(action) {
    const classes = {
        'created': 'status-new',
        'updated': 'status-contacted',
        'deleted': 'status-converted',
        'submitted': 'status-qualified',
        'approved': 'status-converted',
        'rejected': 'status-converted',
        'bulk_created': 'status-new',
        'added': 'status-new',
        'removed': 'status-converted'
    };
    return classes[action] || 'status-new';
}

function formatDetails(activity) {
    if (!activity.details) return '-';
    try {
        const details = JSON.parse(activity.details);
        const parts = [];
        for (const [key, value] of Object.entries(details)) {
            if (value === null || value === undefined) continue;
            // Hide raw UUID-bearing keys — they aren't useful to end users
            if (key === 'id' || /(_id|_uuid)$/i.test(key)) continue;
            const label = key.replace(/_/g, ' ');
            parts.push(`${label}: ${value}`);
        }
        return parts.join(', ') || '-';
    } catch {
        return activity.details;
    }
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
}

function getInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
