// CRM Dashboard JavaScript

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadNavigation();

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Load dashboard data
    await loadDashboard();
});

/**
 * Load all dashboard data
 */
async function loadDashboard() {
    try {
        await Promise.all([
            loadStats(),
            loadLeadFunnel(),
            loadRecentLeads()
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
    try {
        const data = await api.request('/crm/dashboard');

        const totalLeadsEl = document.getElementById('totalLeads');
        const activeDealsEl = document.getElementById('activeDeals');
        const pipelineValueEl = document.getElementById('pipelineValue');
        const convertedLeadsEl = document.getElementById('convertedLeads');

        if (totalLeadsEl) totalLeadsEl.textContent = data.total_leads ?? 0;
        if (activeDealsEl) activeDealsEl.textContent = data.active_deals ?? 0;
        if (pipelineValueEl) pipelineValueEl.textContent = formatCurrency(data.pipeline_value ?? 0);
        if (convertedLeadsEl) convertedLeadsEl.textContent = data.converted_leads ?? 0;
    } catch (error) {
        console.error('Error loading stats:', error);
        document.getElementById('totalLeads').textContent = '0';
        document.getElementById('activeDeals').textContent = '0';
        document.getElementById('pipelineValue').textContent = '$0';
        document.getElementById('convertedLeads').textContent = '0';
    }
}

/**
 * Fetch and populate lead funnel visualization
 */
async function loadLeadFunnel() {
    try {
        const data = await api.request('/crm/dashboard/funnel');
        const funnel = data.funnel ?? data ?? {};

        const newCount = funnel.new ?? 0;
        const contactedCount = funnel.contacted ?? 0;
        const qualifiedCount = funnel.qualified ?? 0;
        const convertedCount = funnel.converted ?? 0;

        const total = newCount + contactedCount + qualifiedCount + convertedCount;

        // Update counts
        setTextContent('funnelNewCount', newCount);
        setTextContent('funnelContactedCount', contactedCount);
        setTextContent('funnelQualifiedCount', qualifiedCount);
        setTextContent('funnelConvertedCount', convertedCount);

        // Update bar widths
        if (total > 0) {
            setBarWidth('funnelNewFill', (newCount / total) * 100);
            setBarWidth('funnelContactedFill', (contactedCount / total) * 100);
            setBarWidth('funnelQualifiedFill', (qualifiedCount / total) * 100);
            setBarWidth('funnelConvertedFill', (convertedCount / total) * 100);
        }
    } catch (error) {
        console.error('Error loading lead funnel:', error);
    }
}

/**
 * Fetch and populate recent leads table
 */
async function loadRecentLeads() {
    const tbody = document.getElementById('recentLeadsBody');
    if (!tbody) return;

    try {
        const response = await api.request('/crm/leads?limit=10&sort=created_at&order=desc');
        const leads = Array.isArray(response) ? response : (response?.data ?? []);

        if (!leads || leads.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        <p>No leads found. Create your first lead to get started.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = leads.map(lead => `
            <tr>
                <td>
                    <div class="lead-info">
                        <div class="lead-avatar">${getInitials(lead.name || lead.first_name || 'L')}</div>
                        <div>
                            <div class="lead-name">${escapeHtml(lead.name || ((lead.first_name || '') + ' ' + (lead.last_name || '')).trim() || '-')}</div>
                        </div>
                    </div>
                </td>
                <td>${escapeHtml(lead.email || '-')}</td>
                <td>${escapeHtml(lead.source || '-')}</td>
                <td><span class="status-badge ${(lead.status || 'new').toLowerCase()}">${capitalizeFirst(lead.status || 'new')}</span></td>
                <td>${formatDate(lead.created_at)}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading recent leads:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <p>Unable to load recent leads</p>
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
 * Navigate to a CRM sub-page
 */
function navigateTo(page) {
    window.location.href = page;
}

// ============================================
// Utility Functions
// ============================================

function getInitials(name) {
    if (!name) return 'L';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatCurrency(value) {
    if (value === null || value === undefined) return '$0';
    const num = Number(value);
    if (isNaN(num)) return '$0';
    if (num >= 1000000) {
        return '$' + (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return '$' + (num / 1000).toFixed(1) + 'K';
    }
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

function setBarWidth(id, percent) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.max(percent, 2) + '%';
}
