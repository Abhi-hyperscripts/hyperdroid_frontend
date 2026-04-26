// CRM Dashboard JavaScript

// Currency symbols map
const CURRENCY_SYMBOLS = {
    'USD': '$', 'EUR': '\u20AC', 'GBP': '\u00A3', 'INR': '\u20B9',
    'AED': 'AED ', 'CAD': 'C$', 'AUD': 'A$', 'JPY': '\u00A5',
    'CNY': '\u00A5', 'KRW': '\u20A9', 'BRL': 'R$', 'ZAR': 'R'
};

// Default currency from CRM settings
let dashboardCurrency = 'USD';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadNavigation();

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Hide settings card for non-admin users
    const user = api.getUser();
    const roles = user?.roles || [];
    const isAdmin = roles.includes('CRM_ADMIN') || roles.includes('SUPERADMIN');
    if (!isAdmin) {
        const settingsCard = document.getElementById('cardSettings');
        if (settingsCard) settingsCard.style.display = 'none';
    }

    // Setup gating — disable action cards until functional area + team + pipeline exist.
    // Settings card is always enabled (it's how users fix the setup).
    await applySetupGating(isAdmin);

    // Load default currency setting, then dashboard data
    await loadDashboardCurrency();
    await loadDashboard();

    // Live updates: when an inbound webhook (Google Sheets polling, Facebook
    // ingest, manual /webform POST) creates a new lead, the CRM tenant hub
    // emits NewLeadReceived. Mirror the leads.js pattern but refetch the
    // whole dashboard instead of buffering — the dashboard cards/charts are
    // aggregates, not a per-row table, so a single refetch is the cheapest
    // way to keep numbers correct.
    setupDashboardRealtime();
});

let _dashboardHubConnection = null;
let _dashboardRefreshTimer = null;

async function setupDashboardRealtime() {
    if (typeof signalR === 'undefined') return;
    const tokenFn = typeof getAuthToken === 'function' ? getAuthToken : () => null;
    if (!tokenFn()) return;
    const hubUrl = (typeof CONFIG !== 'undefined' && CONFIG.crmSignalRHubUrl)
        ? CONFIG.crmSignalRHubUrl
        : null;
    if (!hubUrl) return;

    _dashboardHubConnection = new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, { accessTokenFactory: tokenFn })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    // Debounced refetch — a polling cycle that ingests 30 leads will fire
    // 30 events in tight succession; collapse them into one reload.
    const scheduleRefresh = () => {
        if (_dashboardRefreshTimer) return;
        _dashboardRefreshTimer = setTimeout(() => {
            _dashboardRefreshTimer = null;
            loadDashboard().catch(e => console.warn('dashboard refresh failed:', e?.message || e));
        }, 800);
    };

    _dashboardHubConnection.on('NewLeadReceived', () => scheduleRefresh());

    try {
        await _dashboardHubConnection.start();
    } catch (e) {
        // Transient on page load. withAutomaticReconnect handles retries.
        console.warn('Dashboard SignalR: failed to connect', e?.message || e);
    }
}

async function applySetupGating(isAdmin) {
    let status;
    try {
        status = await api.request('/crm/dashboard/setup-status');
    } catch (e) {
        console.warn('setup-status check failed, leaving actions enabled', e);
        return;
    }
    if (status?.is_complete) return;

    const missing = [];
    if (!status.has_functional_area) missing.push('a functional area');
    if (!status.has_team)             missing.push('at least one team');
    if (!status.has_pipeline)         missing.push('a deals pipeline');

    // Gate the three data-entry cards, not Settings
    ['cardNewLead', 'cardContacts', 'cardDeals'].forEach(id => {
        const card = document.getElementById(id);
        if (!card) return;
        card.classList.add('action-card--disabled');
        card.removeAttribute('onclick');
        card.addEventListener('click', () => {
            const prefix = isAdmin ? 'Finish setup first — missing ' : 'Your admin needs to set up ';
            Toast.warning(prefix + missing.join(', ') + '.');
        });
    });

    // Inline hint under the header
    const header = document.querySelector('.quick-actions')?.previousElementSibling;
    if (header && !document.getElementById('setupHint')) {
        const hint = document.createElement('div');
        hint.id = 'setupHint';
        hint.style.cssText = 'margin-top:8px;padding:12px 16px;border-radius:8px;' +
            'background:rgba(245,158,11,0.08);border:1px solid var(--color-warning);' +
            'color:var(--text-secondary);font-size:0.9rem;';
        const who = isAdmin ? 'Go to Settings to add' : 'Ask your admin to set up';
        hint.innerHTML = `<strong style="color:var(--color-warning);">Setup incomplete —</strong> ` +
            `${who} ${missing.join(', ')} before creating leads, contacts, or deals.`;
        header.after(hint);
    }
}

/**
 * Load default currency from CRM settings
 */
async function loadDashboardCurrency() {
    try {
        const response = await api.request('/crm/crm-settings/default_currency');
        if (response && response.value) {
            dashboardCurrency = response.value;
        }
    } catch (error) {
        console.error('Failed to load default currency, using USD:', error);
    }
}

/**
 * Load all dashboard data
 */
async function loadDashboard() {
    try {
        await Promise.all([
            loadStats(),
            loadAnalytics(),
            loadNotifications(),
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

        const stats = data.lead_stats ?? {};
        const pipeline = data.pipeline_summary ?? {};
        const stages = pipeline.stages ?? [];
        const activeDeals = stages.reduce((sum, s) => sum + (s.deal_count ?? 0), 0);
        const pipelineValue = stages.reduce((sum, s) => sum + (parseFloat(s.total_value) || 0), 0);

        if (totalLeadsEl) totalLeadsEl.textContent = stats.total_leads ?? 0;
        if (activeDealsEl) activeDealsEl.textContent = activeDeals;
        if (pipelineValueEl) pipelineValueEl.textContent = formatCurrency(pipelineValue);
        if (convertedLeadsEl) convertedLeadsEl.textContent = stats.converted ?? 0;
    } catch (error) {
        console.error('Error loading stats:', error);
        document.getElementById('totalLeads').textContent = '0';
        document.getElementById('activeDeals').textContent = '0';
        document.getElementById('pipelineValue').textContent = formatCurrency(0);
        document.getElementById('convertedLeads').textContent = '0';
    }
}

/**
 * Fetch and populate lead funnel visualization
 */
async function loadLeadFunnel() {
    try {
        const data = await api.request('/crm/dashboard/lead-funnel');
        const funnel = data.funnel ?? data ?? {};

        const newCount = funnel.new_leads ?? 0;
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
                <td>${escapeHtml(lead.lead_source || '-')}</td>
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

function formatCurrency(value, currency) {
    const cur = currency || dashboardCurrency;
    const symbol = CURRENCY_SYMBOLS[cur] || cur + ' ';
    if (value === null || value === undefined) return symbol + '0';
    const num = Number(value);
    if (isNaN(num)) return symbol + '0';
    if (num >= 1000000) {
        return symbol + (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return symbol + (num / 1000).toFixed(1) + 'K';
    }
    return symbol + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

// ═══ Analytics (ApexCharts) ═══

const STATUS_ORDER = ['new', 'assigned', 'contacted', 'qualified', 'follow_up', 'opportunity', 'negotiation', 'won', 'lost', 'unqualified'];
const STATUS_LABELS = {
    new: 'New', assigned: 'Assigned', contacted: 'Contacted', qualified: 'Qualified',
    unqualified: 'Unqualified', follow_up: 'Follow Up', opportunity: 'Opportunity',
    negotiation: 'Negotiation', won: 'Won', lost: 'Lost'
};
const STATUS_COLORS = {
    new: '#3b82f6', assigned: '#6366f1', contacted: '#eab308', qualified: '#22c55e',
    unqualified: '#9ca3af', follow_up: '#f97316', opportunity: '#a855f7',
    negotiation: '#ec4899', won: '#10b981', lost: '#ef4444'
};
const DISP_LABELS = {
    not_responding: 'Not Responding', not_interested: 'Not Interested',
    callback_later: 'Callback Later', hot_lead: 'Hot Lead',
    wrong_number: 'Wrong Number', voicemail: 'Voicemail',
    email_sent: 'Email Sent', meeting_scheduled: 'Meeting Scheduled',
    proposal_sent: 'Proposal Sent', deal_in_progress: 'Deal In Progress'
};

let _charts = {};

async function loadAnalytics() {
    try {
        const data = await api.request('/crm/dashboard/analytics');
        renderPipelineChart(data.status_breakdown || {});
        renderConversionChart(data);
        renderSourceChart(data.leads_by_source || []);
        renderAgentPerformance(data.agent_stats || []);
        renderLostReasonsChart(data.lost_reasons || []);
        renderDispositionsChart(data.disposition_breakdown || {});
    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

function apexDarkTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        theme: { mode: isDark ? 'dark' : 'light' },
        chart: { background: 'transparent', foreColor: isDark ? '#94a3b8' : '#475569' },
        grid: { borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)' }
    };
}

function renderChart(id, options) {
    if (_charts[id]) { _charts[id].destroy(); }
    const el = document.getElementById(id);
    if (!el) return;
    const t = apexDarkTheme();
    options.chart = { ...options.chart, background: 'transparent', foreColor: t.chart.foreColor };
    options.theme = t.theme;
    if (options.grid) options.grid.borderColor = t.grid.borderColor;
    _charts[id] = new ApexCharts(el, options);
    _charts[id].render();
}

function renderPipelineChart(breakdown) {
    const statuses = STATUS_ORDER.filter(s => (breakdown[s] || 0) > 0);
    if (statuses.length === 0) {
        document.getElementById('chartPipeline').innerHTML = '<p class="empty-analytics">No leads yet</p>';
        return;
    }
    renderChart('chartPipeline', {
        chart: { type: 'bar', height: Math.max(statuses.length * 45, 180), toolbar: { show: false } },
        series: [{ name: 'Leads', data: statuses.map(s => breakdown[s] || 0) }],
        xaxis: { categories: statuses.map(s => STATUS_LABELS[s] || s) },
        colors: statuses.map(s => STATUS_COLORS[s] || '#6366f1'),
        plotOptions: { bar: { horizontal: true, borderRadius: 3, distributed: true, barHeight: '55%' } },
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 600 } },
        legend: { show: false },
        grid: { xaxis: { lines: { show: false } }, yaxis: { lines: { show: false } }, padding: { top: -10, bottom: -10 } },
        tooltip: { y: { formatter: v => v + ' leads' } }
    });
}

function renderConversionChart(data) {
    const won = data.won_leads || 0;
    const lost = data.lost_leads || 0;
    const other = Math.max(0, (data.total_leads || 0) - won - lost);

    renderChart('chartConversion', {
        chart: { type: 'polarArea', height: 320 },
        series: [won, lost, other],
        labels: ['Won', 'Lost', 'In Progress'],
        colors: ['#10b981', '#ef4444', '#6366f1'],
        stroke: { colors: ['transparent'] },
        fill: { opacity: 0.85 },
        plotOptions: { polarArea: { rings: { strokeWidth: 0 }, spokes: { strokeWidth: 0 } } },
        legend: { position: 'left', fontSize: '11px', offsetY: 20 },
        dataLabels: { enabled: false },
        yaxis: { show: false }
    });

    const stats = document.getElementById('conversionStats');
    if (stats) stats.innerHTML = `
        <span class="stat-won">${won} won</span>
        <span class="stat-lost">${lost} lost</span>
        <span>${data.total_leads} total</span>
        ${data.avg_closure_time_days > 0 ? `<span>Avg ${data.avg_closure_time_days}d to close</span>` : ''}
    `;
}

function renderSourceChart(sources) {
    if (sources.length === 0) {
        document.getElementById('chartSource').innerHTML = '<p class="empty-analytics">No data yet</p>';
        return;
    }
    const colors = ['#6366f1', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#eab308', '#a855f7', '#14b8a6'];
    renderChart('chartSource', {
        chart: { type: 'polarArea', height: 320 },
        series: sources.map(s => s.count),
        labels: sources.map(s => s.source),
        colors: colors.slice(0, sources.length),
        stroke: { colors: ['transparent'] },
        fill: { opacity: 0.85 },
        plotOptions: { polarArea: { rings: { strokeWidth: 0 }, spokes: { strokeWidth: 0 } } },
        legend: { position: 'right', fontSize: '11px', offsetY: 20 },
        dataLabels: { enabled: false },
        yaxis: { show: false }
    });
}

function renderAgentPerformance(agents) {
    const container = document.getElementById('agentPerformance');
    if (!container) return;
    if (agents.length === 0) {
        container.innerHTML = '<p class="empty-analytics">No assigned leads yet</p>';
        return;
    }
    container.innerHTML = `
        <table class="agent-table data-table">
            <thead><tr>
                <th>Agent</th><th>Total</th><th>Won</th><th>Lost</th><th>Active</th><th>Conv %</th>
            </tr></thead>
            <tbody>
                ${agents.map(a => `<tr>
                    <td>
                        <div class="agent-name">${escapeHtml(a.user_name || 'Unknown')}</div>
                        <div class="agent-email">${escapeHtml(a.email || '')}</div>
                    </td>
                    <td>${a.total_leads}</td>
                    <td style="color:#22c55e;font-weight:600;">${a.won_leads}</td>
                    <td style="color:#ef4444;font-weight:600;">${a.lost_leads}</td>
                    <td>${a.active_leads}</td>
                    <td style="font-weight:700;">${a.conversion_rate}%</td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
}

function renderLostReasonsChart(reasons) {
    if (reasons.length === 0) {
        document.getElementById('chartLostReasons').innerHTML = '<p class="empty-analytics">No lost leads yet</p>';
        return;
    }
    renderChart('chartLostReasons', {
        chart: { type: 'bar', height: Math.max(reasons.length * 45, 160), toolbar: { show: false } },
        series: [{ name: 'Count', data: reasons.map(r => r.count) }],
        xaxis: { categories: reasons.map(r => r.reason) },
        colors: ['#ef4444'],
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '65%' } },
        dataLabels: { enabled: true, style: { fontSize: '12px', fontWeight: 600 } },
        grid: { xaxis: { lines: { show: false } }, yaxis: { lines: { show: false } } },
        legend: { show: false }
    });
}

function renderDispositionsChart(breakdown) {
    const entries = Object.entries(breakdown);
    if (entries.length === 0) {
        document.getElementById('chartDispositions').innerHTML = '<p class="empty-analytics">No dispositions set</p>';
        return;
    }
    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#6366f1', '#14b8a6', '#9ca3af'];
    renderChart('chartDispositions', {
        chart: { type: 'bar', height: Math.max(entries.length * 45, 160), toolbar: { show: false } },
        series: [{ name: 'Count', data: entries.map(e => e[1]) }],
        xaxis: { categories: entries.map(e => DISP_LABELS[e[0]] || e[0]) },
        colors: colors.slice(0, entries.length),
        plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: true, barHeight: '65%' } },
        dataLabels: { enabled: true, style: { fontSize: '12px', fontWeight: 600 } },
        grid: { xaxis: { lines: { show: false } }, yaxis: { lines: { show: false } } },
        legend: { show: false }
    });
}

// ═══ Notifications ═══

async function loadNotifications() {
    try {
        const data = await api.request('/crm/dashboard/notifications');
        const banner = document.getElementById('notificationsBanner');
        const list = document.getElementById('notificationsList');
        const header = document.getElementById('notificationsHeader');
        if (!banner || !list) return;

        if (data.items.length === 0) {
            banner.style.display = 'none';
            if (header) header.style.display = 'none';
            return;
        }

        banner.style.display = '';
        if (header) header.style.display = '';
        list.innerHTML = data.items.slice(0, 3).map(n => {
            const cls = n.type.includes('overdue') ? 'notif-overdue'
                : n.type.includes('due') ? 'notif-due'
                : 'notif-transfer';
            const time = new Date(n.timestamp).toLocaleDateString();
            return `<div class="notif-item ${cls}" onclick="${n.entity_id ? `navigateTo('leads.html')` : ''}">
                <span class="notif-text">${escapeHtml(n.title)}${n.description ? ' — ' + escapeHtml(n.description).substring(0, 40) : ''}</span>
                <span class="notif-time">${time}</span>
            </div>`;
        }).join('') + (data.items.length > 3 ? `<div style="text-align:center;padding:4px;"><a href="leads.html" style="color:var(--brand-primary);font-size:0.78rem;">+${data.items.length - 3} more</a></div>` : '');
    } catch (e) {
        console.error('Failed to load notifications:', e);
    }
}
