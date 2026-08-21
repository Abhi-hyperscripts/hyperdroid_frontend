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

    // Header subtitle: today's date + org name
    const subtitle = document.getElementById('pulseSubtitle');
    if (subtitle) {
        const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
        const orgInfo = (typeof getOrganizationInfo === 'function') ? getOrganizationInfo() : null;
        const orgName = orgInfo && (orgInfo.organizationName || orgInfo.tenantName);
        subtitle.textContent = dateStr + (orgName ? ' · ' + orgName : '');
    }

    // Hide settings card + rail item for non-admin users
    const user = api.getUser();
    const roles = user?.roles || [];
    const isAdmin = roles.includes('CRM_ADMIN') || roles.includes('SUPERADMIN');
    const isSuperadmin = roles.includes('SUPERADMIN');
    if (!isAdmin) {
        const settingsCard = document.getElementById('cardSettings');
        if (settingsCard) settingsCard.style.display = 'none';
        const railSettings = document.getElementById('railSettings');
        if (railSettings) railSettings.style.display = 'none';
    }
    // Analytics is SUPERADMIN-only — backend endpoint is gated the
    // same way, but we hide the entry points so others don't see a 403.
    if (isSuperadmin) {
        const analyticsCard = document.getElementById('cardAnalytics');
        if (analyticsCard) analyticsCard.style.display = '';
        const railAnalytics = document.getElementById('railAnalytics');
        if (railAnalytics) railAnalytics.style.display = '';
    }

    // WhatsApp Inbox card — shown only when WhatsApp is actually configured.
    //
    // This used to derive that from /whatsapp/numbers behind an isSuperadmin
    // check, which meant a rep on a tenant WITH WhatsApp connected never saw
    // the inbox at all — the gate was hiding a working feature from the people
    // who use it. /whatsapp/feature-status exists for exactly this question,
    // is open to CRM_USER, and returns only { enabled, active_numbers_count }
    // — no numbers, no credentials — so reading it here leaks nothing.
    try {
        const status = await api.request('/whatsapp/feature-status');
        if (status && status.enabled) {
            const waCard = document.getElementById('cardWhatsappInbox');
            if (waCard) waCard.style.display = '';
            const railWa = document.getElementById('railWhatsapp');
            if (railWa) railWa.style.display = '';
        }
    } catch (err) {
        // The endpoint already treats a backing-service failure as "disabled",
        // so anything reaching here is a network blip — stay hidden.
        console.warn('[Dashboard] WhatsApp feature-status check failed (card stays hidden):', err);
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
            loadRecentLeads(),
            loadLeadsWave(),
            loadRecentActivity(),
            loadTodaySchedule(),
            loadInventory(),
            loadMoneyPanel()
        ]);
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Error loading dashboard data', 'error');
    }
}

// ═══ Full-bleed leads wave: leads captured per day over the last 30 days ═══
async function loadLeadsWave() {
    const band = document.getElementById('crmWave');
    const host = document.getElementById('crmWaveChart');
    if (!band || !host) return;

    // Server caps pageSize at 50 — walk pages (newest first) until we're past
    // the widest window we might draw, or run out of leads. Max 8 pages keeps
    // the cost bounded for huge tenants.
    const MAX_WINDOW = 90;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const oldestNeeded = new Date(today); oldestNeeded.setDate(today.getDate() - (MAX_WINDOW - 1));

    const leads = [];
    try {
        for (let page = 1; page <= 8; page++) {
            const resp = await api.request(`/crm/leads?page=${page}&pageSize=50&sort=created_at&order=desc`);
            const batch = Array.isArray(resp) ? resp : (resp?.data ?? []);
            if (!batch.length) break;
            leads.push(...batch);
            const oldest = batch[batch.length - 1]?.created_at;
            if (oldest && new Date(oldest) < oldestNeeded) break;
            if (batch.length < 50) break;
        }
    } catch (e) { return; } // wave is decoration-with-data — stay hidden on failure

    // Adaptive window: prefer the last 30 days; if that's empty, widen to 90.
    const countIn = days => {
        const from = new Date(today); from.setDate(today.getDate() - (days - 1));
        return leads.filter(l => l.created_at && new Date(l.created_at) >= from).length;
    };
    const DAYS = countIn(30) > 0 ? 30 : (countIn(90) > 0 ? 90 : 0);
    if (DAYS === 0) return; // nothing in the last 90 days — no band

    const cap = band.querySelector('.wave-cap');
    if (cap) cap.textContent = 'Leads captured · last ' + DAYS + ' days';

    const start = new Date(today); start.setDate(today.getDate() - (DAYS - 1));
    const buckets = new Array(DAYS).fill(0);
    leads.forEach(l => {
        if (!l.created_at) return;
        const d = new Date(l.created_at); d.setHours(0, 0, 0, 0);
        const idx = Math.round((d - start) / 86400000);
        if (idx >= 0 && idx < DAYS) buckets[idx]++;
    });

    const W = 1200, H = 150, padT = 26, padB = 18;
    const ih = H - padT - padB;
    const yMax = Math.max(...buckets) * 1.15 || 1;
    const x = i => (i / (DAYS - 1)) * W;
    const y = v => padT + ih - (v / yMax) * ih;

    // monotone-cubic smoothing (no overshoot on spikes)
    function smoothPath() {
        const pts = buckets.map((v, i) => [x(i), y(v)]);
        const n = pts.length;
        const dx = [], m = [];
        for (let i = 0; i < n - 1; i++) {
            dx.push(pts[i + 1][0] - pts[i][0]);
            m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
        }
        const t = [m[0]];
        for (let i = 1; i < n - 1; i++) t.push((m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2);
        t.push(m[n - 2]);
        for (let i = 0; i < n - 1; i++) {
            if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
            else {
                const a = t[i] / m[i], b = t[i + 1] / m[i];
                const s = a * a + b * b;
                if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
            }
        }
        let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
        for (let i = 0; i < n - 1; i++) {
            const h = dx[i];
            d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1) +
                 ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1) +
                 ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
        }
        return d;
    }

    const line = smoothPath();
    const area = line + ' L' + W + ',' + H + ' L0,' + H + ' Z';
    const dayLabel = i => {
        const d = new Date(start); d.setDate(start.getDate() + i);
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    // peak marker on the busiest day
    let peak = 0;
    buckets.forEach((v, i) => { if (v > buckets[peak]) peak = i; });
    const px2 = Math.min(Math.max(x(peak), 60), W - 80);
    const marker =
        `<circle cx="${x(peak).toFixed(1)}" cy="${y(buckets[peak]).toFixed(1)}" r="3.5" fill="var(--brand-primary)"/>` +
        `<text x="${px2.toFixed(1)}" y="${Math.max(y(buckets[peak]) - 10, 14).toFixed(1)}" text-anchor="middle" ` +
        `font-size="12" font-weight="600" fill="var(--text-secondary)" font-family="var(--font-family-mono)">` +
        `${buckets[peak]} · ${dayLabel(peak)}</text>`;

    // sparse date ticks
    const tickStep = DAYS <= 30 ? 7 : 15;
    let ticks = '';
    for (let i = 0; i < DAYS; i += tickStep) {
        ticks += `<text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9.5" ` +
                 `fill="var(--text-muted)" font-family="var(--font-family)">${dayLabel(i)}</text>`;
    }

    host.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Leads captured per day, last 30 days">` +
        `<defs><linearGradient id="crmWaveFill" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="var(--brand-primary)" stop-opacity="0.28"/>` +
        `<stop offset="1" stop-color="var(--brand-primary)" stop-opacity="0"/>` +
        `</linearGradient></defs>` +
        `<path d="${area}" fill="url(#crmWaveFill)" stroke="none"/>` +
        `<path class="draw-line" d="${line}" fill="none" stroke="var(--brand-primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
        marker +
        `<line id="crmWaveCross" x1="0" y1="${padT}" x2="0" y2="${padT + ih}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>` +
        ticks +
        `</svg>`;

    band.hidden = false;

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const p = host.querySelector('.draw-line');
        const len = p.getTotalLength();
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        p.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.15s';
        requestAnimationFrame(() => requestAnimationFrame(() => { p.style.strokeDashoffset = '0'; }));
    }

    const svg = host.querySelector('svg');
    const cross = host.querySelector('#crmWaveCross');
    const tip = document.getElementById('crmWaveTip');
    svg.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width * W;
        const idx = Math.min(DAYS - 1, Math.max(0, Math.round((relX / W) * (DAYS - 1))));
        cross.style.display = '';
        cross.setAttribute('x1', x(idx));
        cross.setAttribute('x2', x(idx));
        tip.style.display = 'block';
        tip.style.left = (x(idx) / W * rect.width) + 'px';
        tip.style.top = '38px';
        tip.innerHTML = '<b></b><br>Leads <b class="tv"></b>';
        tip.querySelector('b').textContent = dayLabel(idx);
        tip.querySelector('.tv').textContent = buckets[idx];
    });
    svg.addEventListener('mouseleave', () => {
        cross.style.display = 'none';
        tip.style.display = 'none';
    });
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

        // These stages were already on the wire and only ever collapsed into
        // the two chips above — the page showed where LEADS were but never
        // where the DEALS sat. Rendered from the payload in hand rather than
        // re-fetching /dashboard/pipeline-summary, which returns this same
        // object for the only pipeline that exists.
        renderDealPipelineChart(stages);
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
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setTextContent(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setBarWidth(id, percent) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.max(percent, 2) + '%';
}

// ═══ Analytics (DOM bar renderers — no chart library) ═══

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

async function loadAnalytics() {
    try {
        const data = await api.request('/crm/dashboard/analytics');
        renderPipelineChart(data.status_breakdown || {}, data.total_leads || 0);
        renderConversionFooter(data);
        renderSourceChart(data.leads_by_source || []);
        renderAgentPerformance(data.agent_stats || []);
        renderLostReasonsChart(data.lost_reasons || []);
        renderDispositionsChart(data.disposition_breakdown || {});
    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

// One horizontal DOM bar row: label | track+fill | count (+ optional %)
function pulseBar(label, count, max, color, pct) {
    const width = max > 0 ? Math.max((count / max) * 100, 2) : 2;
    return `<div class="pbar">
        <span class="lbl" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <span class="track"><span class="fill" style="width:${width}%;background:${color}"></span></span>
        <span class="cnt">${count}${pct != null ? ` <small>${pct}%</small>` : ''}</span>
    </div>`;
}

function renderPipelineChart(breakdown, totalLeads) {
    const el = document.getElementById('chartPipeline');
    if (!el) return;
    const statuses = STATUS_ORDER.filter(s => (breakdown[s] || 0) > 0);
    // include any statuses the backend returns that STATUS_ORDER doesn't know
    Object.keys(breakdown).forEach(s => {
        if ((breakdown[s] || 0) > 0 && !statuses.includes(s)) statuses.push(s);
    });
    if (statuses.length === 0) {
        el.innerHTML = '<div class="pulse-empty">No leads yet — capture your first lead to see the pipeline.</div>';
        return;
    }
    const max = Math.max(...statuses.map(s => breakdown[s] || 0));
    const total = totalLeads || statuses.reduce((sum, s) => sum + (breakdown[s] || 0), 0);
    el.innerHTML = statuses.map(s => pulseBar(
        STATUS_LABELS[s] || capitalizeFirst(s.replace(/_/g, ' ')),
        breakdown[s] || 0,
        max,
        STATUS_COLORS[s] || 'var(--brand-primary)',
        total > 0 ? Math.round(((breakdown[s] || 0) / total) * 100) : null
    )).join('');
    const totalEl = document.getElementById('funnelTotal');
    if (totalEl) totalEl.textContent = total + ' leads';
}

// Deal pipeline — one bar per stage, sized by VALUE rather than count, because
// "six deals in Negotiation" says much less than "₹25.5L sitting in
// Negotiation". Count rides along in the label.
function renderDealPipelineChart(stages) {
    const el = document.getElementById('chartDealPipeline');
    if (!el) return;
    const rows = (stages || []).filter(s => (s.deal_count || 0) > 0);
    if (!rows.length) {
        el.innerHTML = '<div class="pulse-empty">No deals yet — qualify a lead to open one.</div>';
        const note = document.getElementById('dealPipelineTotal');
        if (note) note.textContent = '';
        return;
    }
    rows.sort((a, b) => (a.stage_order || 0) - (b.stage_order || 0));
    const max = Math.max(...rows.map(s => parseFloat(s.total_value) || 0));
    const STAGE_COLOR = {
        won: 'var(--color-success, #2ea043)',
        lost: 'var(--color-error, #f85149)',
        open: 'var(--brand-primary)'
    };
    el.innerHTML = rows.map(s => {
        const value = parseFloat(s.total_value) || 0;
        const width = max > 0 ? Math.max((value / max) * 100, 2) : 2;
        const color = STAGE_COLOR[String(s.stage_type || 'open').toLowerCase()] || STAGE_COLOR.open;
        const label = `${s.stage_name} · ${s.deal_count}`;
        return `<div class="pbar">
            <span class="lbl" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <span class="track"><span class="fill" style="width:${width}%;background:${color}"></span></span>
            <span class="cnt">${escapeHtml(formatCurrency(value))}</span>
        </div>`;
    }).join('');

    // "Open" excludes won and lost — the number a manager actually forecasts on.
    const openValue = rows
        .filter(s => String(s.stage_type || 'open').toLowerCase() === 'open')
        .reduce((sum, s) => sum + (parseFloat(s.total_value) || 0), 0);
    const note = document.getElementById('dealPipelineTotal');
    if (note) note.textContent = `${formatCurrency(openValue)} open`;
}

// Recent activity — GET /api/Activities/recent. Backend already scopes this to
// what the caller may see, so nothing is filtered here.
const ACTIVITY_ICON = {
    call: '📞', email: '✉️', meeting: '📅', note: '📝', whatsapp: '💬', task: '✅'
};

async function loadRecentActivity() {
    const el = document.getElementById('recentActivityList');
    if (!el) return;
    try {
        const res = await api.request('/crm/activities/recent?limit=12');
        const items = Array.isArray(res) ? res : (res?.items || []);
        const note = document.getElementById('recentActivityNote');

        if (!items.length) {
            el.innerHTML = '<div class="pulse-empty">Nothing logged yet. Calls, emails and meetings show up here as your team works.</div>';
            if (note) note.textContent = '';
            return;
        }
        if (note) note.textContent = `last ${items.length}`;

        el.innerHTML = items.map(a => {
            const type = String(a.activity_type || '').toLowerCase();
            const icon = ACTIVITY_ICON[type] || '•';
            const title = a.subject || `${capitalizeFirst(type || 'activity')} logged`;
            const when = timeAgo(a.performed_at || a.created_at);
            // Links to the owning record — a feed you cannot act from is a
            // feed you stop reading.
            const href = a.entity_type === 'lead' ? `leads.html?lead=${encodeURIComponent(a.entity_id)}`
                       : a.entity_type === 'deal' ? `deals.html?deal=${encodeURIComponent(a.entity_id)}`
                       : a.entity_type === 'contact' ? `contacts.html?contact=${encodeURIComponent(a.entity_id)}`
                       : null;
            const body = `
                <span class="ra-icon">${icon}</span>
                <span class="ra-text">
                    <span class="ra-title">${escapeHtml(title)}</span>
                    <span class="ra-meta">${escapeHtml(capitalizeFirst(a.entity_type || ''))} · ${escapeHtml(when)}</span>
                </span>`;
            return href
                ? `<a class="ra-row" href="${href}">${body}</a>`
                : `<div class="ra-row">${body}</div>`;
        }).join('');
    } catch (e) {
        console.error('Failed to load recent activity:', e);
        el.innerHTML = '<div class="pulse-empty">Could not load recent activity.</div>';
    }
}

// Relative time for the activity feed. Kept local so the feed does not depend
// on a helper defined in another page's script.
function timeAgo(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderConversionFooter(data) {
    const stats = document.getElementById('conversionStats');
    if (stats) {
        const total = data.total_leads || 0;
        const convRate = total > 0 ? Math.round(((data.won_leads || 0) / total) * 100) : 0;
        stats.innerHTML = `
            <span class="won"><b>${data.won_leads || 0}</b> won</span>
            <span class="lost"><b>${data.lost_leads || 0}</b> lost</span>
            <span><b>${convRate}%</b> conversion</span>
        `;
    }
    const chip = document.getElementById('avgCloseChip');
    if (chip && data.avg_closure_time_days > 0) {
        document.getElementById('avgCloseVal').textContent = data.avg_closure_time_days;
        chip.style.display = '';
    }
}

// Merge sources case-insensitively (manual/Manual were two slices before)
// and prettify snake_case machine names for humans.
const SOURCE_LABELS = {
    google_sheets: 'Google Sheets', landing_page: 'Landing page', facebook: 'Facebook',
    whatsapp: 'WhatsApp', manual: 'Manual', webform: 'Web form', csv_import: 'CSV import'
};

function renderSourceChart(sources) {
    const el = document.getElementById('chartSource');
    if (!el) return;
    if (!sources.length) {
        el.innerHTML = '<div class="pulse-empty">No sources recorded yet.</div>';
        return;
    }
    const merged = {};
    sources.forEach(s => {
        const key = (s.source || 'unknown').trim().toLowerCase() || 'unknown';
        merged[key] = (merged[key] || 0) + (s.count || 0);
    });
    const rows = Object.entries(merged).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = Math.max(...rows.map(r => r[1]));
    const colors = ['#6366f1', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#eab308'];
    el.innerHTML = rows.map(([key, count], i) => pulseBar(
        SOURCE_LABELS[key] || capitalizeFirst(key.replace(/_/g, ' ')),
        count, max, colors[i % colors.length]
    )).join('');
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
    const card = document.getElementById('lostReasonsCard');
    const el = document.getElementById('chartLostReasons');
    if (!card || !el) return;
    // No lost leads → no card at all (an empty box teaches nothing)
    if (!reasons.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const max = Math.max(...reasons.map(r => r.count));
    el.innerHTML = reasons.map(r =>
        pulseBar(r.reason || 'Unspecified', r.count, max, 'var(--color-danger)')).join('');
}

function renderDispositionsChart(breakdown) {
    const el = document.getElementById('chartDispositions');
    if (!el) return;
    const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        el.innerHTML = '<div class="pulse-empty">No call outcomes recorded yet.</div>';
        return;
    }
    const max = Math.max(...entries.map(e => e[1]));
    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#6366f1', '#14b8a6', '#9ca3af'];
    el.innerHTML = entries.slice(0, 8).map(([key, count], i) => pulseBar(
        DISP_LABELS[key] || capitalizeFirst(key.replace(/_/g, ' ')),
        count, max, colors[i % colors.length]
    )).join('');
}


// ═══ Tier 1-3 modules on the dashboard ═══
//
// Appointments, property inventory, commission and renewals all shipped with
// their own pages and NO presence here, so the dashboard still described a
// business that only had leads. Each of these reads an endpoint that was
// already live.

async function loadTodaySchedule() {
    const list = document.getElementById('todayScheduleList');
    const note = document.getElementById('scheduleNote');
    if (!list) return;
    try {
        // Local midnight to local midnight, sent as instants. The server
        // compares timestamptz, so the RANGE must be absolute — building it
        // from the reader's own day is what makes 'today' mean their today.
        const from = new Date(); from.setHours(0, 0, 0, 0);
        const to = new Date(from); to.setDate(to.getDate() + 1);
        const rows = await api.request(
            `/crm/appointments/calendar?from=${encodeURIComponent(from.toISOString())}`
            + `&to=${encodeURIComponent(to.toISOString())}`);

        const live = (rows || []).filter(a => a.status !== 'cancelled');
        if (!live.length) {
            list.innerHTML = '<div class="pulse-empty">Nothing booked today.</div>';
            if (note) note.textContent = '';
            return;
        }
        if (note) note.textContent = live.length + (live.length > 1 ? ' meetings' : ' meeting');

        list.innerHTML = live.slice(0, 6).map(a => {
            const start = new Date(a.starts_at);
            const clock = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
            const who = a.customer_name ? escapeHtml(a.customer_name) : escapeHtml(a.title || 'Meeting');
            const what = a.customer_name ? escapeHtml(a.title || '') : '';
            // Only ever an http(s) link, and only as an anchor. The server
            // allow-lists the scheme on write; this is the second gate, because
            // a javascript: URL that reached storage must still not become a
            // clickable button on the dashboard.
            const url = typeof a.meeting_url === 'string' ? a.meeting_url : '';
            const joinable = /^https?:\/\//i.test(url);
            const right = joinable
                ? `<a class="pulse-mini yes" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Join</a>`
                : (a.location ? `<span class="pulse-tag info">${escapeHtml(a.location).substring(0, 24)}</span>` : '');
            return `<div class="pulse-task">
                <div class="trow">
                    <div class="meta">
                        <div class="t1">${clock} \u00b7 ${who}</div>
                        <div class="t2">${what}</div>
                    </div>
                    ${right}
                </div>
            </div>`;
        }).join('') + (live.length > 6
            ? `<a href="calendar.html" style="color:var(--brand-primary);font-size:12px;text-align:center;display:block;padding:4px;">+${live.length - 6} more in Calendar</a>`
            : '');
    } catch (e) {
        console.error('Failed to load today\u2019s schedule:', e);
        list.innerHTML = '<div class="pulse-empty">Could not load today\u2019s schedule.</div>';
    }
}

async function loadInventory() {
    const panel = document.getElementById('inventoryPanel');
    const note = document.getElementById('inventoryNote');
    if (!panel) return;
    try {
        const s = await api.request('/crm/properties/summary');
        if (!s || !s.total) {
            panel.innerHTML = '<div class="pulse-empty">No units listed yet.</div>';
            if (note) note.textContent = '';
            return;
        }
        if (note) note.textContent = s.total + (s.total > 1 ? ' units' : ' unit');

        const cells = [
            ['Available', s.available, 'status-available'],
            ['Held', s.held, 'status-held'],
            ['Booked', s.booked, 'status-booked'],
            ['Sold', s.sold, 'status-sold'],
        ].map(([label, n, cls]) =>
            `<div class="inv-cell ${cls}"><b>${Number(n || 0)}</b><span>${label}</span></div>`).join('');

        // The value is stated WITH its currency and flagged when the book
        // spans several, because a single figure summed across currencies is
        // a wrong number that looks right.
        const value = s.available_value
            ? `<div class="inv-value">${escapeHtml(formatCurrency(s.available_value, s.currency))} available`
              + (s.mixed_currency ? ' <span class="inv-partial">(' + escapeHtml(s.currency || '') + ' only)</span>' : '')
              + '</div>'
            : '';
        const expired = s.expired_holds
            ? `<div class="inv-warn">${s.expired_holds} hold${s.expired_holds > 1 ? 's have' : ' has'} expired</div>`
            : '';
        panel.innerHTML = `<div class="inv-grid">${cells}</div>${value}${expired}`;
    } catch (e) {
        console.error('Failed to load inventory:', e);
        panel.innerHTML = '<div class="pulse-empty">Could not load inventory.</div>';
    }
}

async function loadMoneyPanel() {
    const panel = document.getElementById('moneyPanel');
    const note = document.getElementById('moneyNote');
    if (!panel) return;
    try {
        // Independently settled: a tenant without renewals should still see
        // its commission, and one endpoint failing must not blank the card.
        const [commissionRes, renewalsRes] = await Promise.allSettled([
            api.request('/crm/deals/commission-summary'),
            api.request('/crm/deals/renewals-due?within_days=60&limit=100')
        ]);

        const parts = [];
        if (commissionRes.status === 'fulfilled' && commissionRes.value) {
            const rows = commissionRes.value.rows || [];
            // ⭐ SUM WITHIN ONE CURRENCY, NEVER ACROSS.
            //
            // The rows are per owner PER CURRENCY, so reducing over all of
            // them adds rupees to dollars and prints the result under whichever
            // symbol happened to come first — a number wrong by roughly ninety
            // times that looks entirely ordinary on a card.
            const cur = (commissionRes.value.currencies || [])[0] || (rows[0] && rows[0].currency);
            const mine = rows.filter(r => !cur || r.currency === cur);
            const outstanding = mine.reduce((sum, r) => sum + Number(r.outstanding || 0), 0);
            const earned = mine.reduce((sum, r) => sum + Number(r.earned || 0), 0);
            const mixed = new Set(rows.map(r => r.currency).filter(Boolean)).size > 1;
            if (earned || outstanding) {
                parts.push(`<div class="money-row"><span>Commission earned</span>
                    <b>${escapeHtml(formatCurrency(earned, cur))}</b></div>`);
                parts.push(`<div class="money-row"><span>Still outstanding</span>
                    <b class="money-warn">${escapeHtml(formatCurrency(outstanding, cur))}</b></div>`);
                if (mixed) parts.push('<div class="inv-partial">Several currencies in play — shown in ' + escapeHtml(cur || '') + '.</div>');
            }
        }

        if (renewalsRes.status === 'fulfilled' && Array.isArray(renewalsRes.value)) {
            const due = renewalsRes.value;
            const overdue = due.filter(r => Number(r.days_until_renewal) < 0).length;
            if (due.length) {
                parts.push(`<div class="money-row"><span>Renewals in 60 days</span><b>${due.length}</b></div>`);
                if (overdue) parts.push(`<div class="inv-warn">${overdue} already past its renewal date</div>`);
                const next = due.slice().sort((a, b) => Number(a.days_until_renewal) - Number(b.days_until_renewal))[0];
                if (next) {
                    const d = new Date(next.renewal_date);
                    const when = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
                    parts.push(`<div class="money-next">Next: ${escapeHtml(next.deal_name || '')} \u00b7 ${when}</div>`);
                }
            }
        }

        if (!parts.length) {
            panel.innerHTML = '<div class="pulse-empty">No commission or renewals recorded.</div>';
            if (note) note.textContent = '';
            return;
        }
        if (note) note.textContent = 'this month';
        panel.innerHTML = parts.join('');
    } catch (e) {
        console.error('Failed to load commission/renewals:', e);
        panel.innerHTML = '<div class="pulse-empty">Could not load commission or renewals.</div>';
    }
}
// ═══ Notifications ═══

// Single delegated listener for the notifications card. Set once after the
// first render; subsequent re-renders don't re-bind. Two click targets:
//   • Mark Done button → POST complete + optimistic remove from card
//   • Anywhere else on the row → navigate to the lead's detail page
let _notificationsHandlersBound = false;
function bindNotificationsHandlers() {
    if (_notificationsHandlersBound) return;
    const list = document.getElementById('notificationsList');
    if (!list) return;
    list.addEventListener('click', async (ev) => {
        const doneBtn = ev.target.closest('.notif-mark-done');
        if (doneBtn) {
            ev.stopPropagation();  // don't also trigger row navigation
            const fid = doneBtn.getAttribute('data-followup-id');
            if (!fid) return;
            const row = doneBtn.closest('.notif-item');
            doneBtn.disabled = true;
            doneBtn.textContent = '…';
            try {
                await api.request(`/crm/leads/followups/${fid}/complete`, {
                    method: 'PUT',
                    body: JSON.stringify({ completed_notes: 'Marked done from dashboard' })
                });
                // Optimistic UI: fade + remove the row, then refresh counts.
                if (row) {
                    row.style.transition = 'opacity 200ms ease, max-height 250ms ease';
                    row.style.opacity = '0';
                    row.style.maxHeight = '0';
                    setTimeout(() => { try { row.remove(); } catch {} loadNotifications(); }, 260);
                } else {
                    loadNotifications();
                }
            } catch (e) {
                doneBtn.disabled = false;
                doneBtn.textContent = 'Mark done';
                Toast.error(e.message || 'Failed to mark complete');
            }
            return;
        }
        const navRow = ev.target.closest('.notif-item[data-lead-id]');
        if (navRow) {
            // TO THE LEAD, not to the list. This row names one customer and
            // the rep clicked it to open that customer; dropping them on the
            // full leads table made them search for the name they had just
            // been shown. The deep link is the same one the activity feed
            // below already uses.
            const lid = navRow.getAttribute('data-lead-id');
            navigateTo(lid ? `leads.html?lead=${encodeURIComponent(lid)}` : 'leads.html');
        }
    });
    _notificationsHandlersBound = true;
}

// Whole calendar days between two instants, in the READER'S timezone.
//
// Differencing the raw milliseconds and dividing answers a different
// question — 23:30 last night is '0 days ago' by that maths and 'yesterday'
// to the person reading it. Comparing midnights is what makes 'overdue by 3
// days' agree with the calendar on the wall.
function calendarDaysBetween(from, to) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
}

// The one line that says WHEN, and what that when MEANS.
//
// ⭐⭐ THIS CARD USED TO PRINT A BARE DATE — '18 Aug' — for two different
// facts. On a follow-up it was the moment the work is DUE; on a pending
// transfer it was the moment somebody REQUESTED it. Same slot, no label, no
// time of day, on work that is scheduled to the minute. Clients read it as
// 'the time doesn't match', and they were right that it was unreadable even
// though the instant itself was correct.
function attentionWhen(n) {
    const at = new Date(n.timestamp);
    if (isNaN(at.getTime())) return '';

    const now = new Date();
    const days = calendarDaysBetween(at, now);   // >0 = in the past
    // hour12 EXPLICITLY. Left to the locale this rendered a bare "9:51",
    // which is the ambiguity being complained about: a rep cannot tell a
    // 9:51 morning call from a 21:51 evening one, and half the follow-ups on
    // this card are evening call-backs.
    const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const day = days === 0 ? 'today'
        : days === 1 ? 'yesterday'
        : days === -1 ? 'tomorrow'
        : at.toLocaleDateString([], { day: 'numeric', month: 'short' });

    // A transfer was RAISED at its timestamp; nothing is due at it.
    if (n.when_kind === 'requested') {
        return `Requested ${day}, ${clock}`;
    }

    if (days > 0) {
        const overdue = days === 1 ? '1 day overdue' : `${days} days overdue`;
        return `Due ${day}, ${clock} \u00b7 ${overdue}`;
    }
    return `Due ${day}, ${clock}`;
}

// Initials for the avatar chip. Two letters at most, and never an empty
// circle: a lead with only a company name still has to look like something.
function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// A stable colour per name, so the same customer keeps the same chip between
// renders. Derived from the name rather than the row index, which would
// reshuffle every time an item is marked done.
function avatarTint(name) {
    let hash = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `background: hsl(${hue} 62% 22%); color: hsl(${hue} 85% 76%);`;
}

// The type, minus the status word the chip already carries. "Overdue: call
// follow-up" becomes "call follow-up" — repeating OVERDUE beside an OVERDUE
// badge spends the widest part of the row saying nothing.
function shortenNotificationTitle(title) {
    return String(title || '').replace(/^(Overdue|Due today|Pending)\s*:\s*/i, '');
}

// The chip text: how late, not what kind. "3d overdue" in the corner is the
// thing a rep triages on, and it fits where a repeated OVERDUE did not.
function shortUrgency(n, whenText) {
    const m = /(\d+)\s*days? overdue/.exec(whenText || '');
    if (m) return m[1] + 'd late';
    if (/overdue/i.test(whenText || '')) return 'late';
    if (n.when_kind === 'requested') return 'pending';
    return 'due';
}

async function loadNotifications() {
    try {
        const data = await api.request('/crm/dashboard/notifications');
        const list = document.getElementById('notificationsList');
        const count = document.getElementById('attnCount');
        if (!list) return;

        if (data.items.length === 0) {
            list.innerHTML = '<div class="pulse-empty">All clear — no overdue follow-ups or pending transfers.</div>';
            if (count) count.textContent = '';
            return;
        }

        if (count) count.textContent = data.items.length + ' item' + (data.items.length > 1 ? 's' : '');
        list.innerHTML = data.items.slice(0, 5).map(n => {
            const tag = n.type.includes('overdue') ? ['overdue', 'OVERDUE']
                : n.type.includes('due') ? ['due', 'DUE TODAY']
                : ['info', 'PENDING'];
            const time = attentionWhen(n);
            // Mark Done only for follow-up notifications (n.followup_id present).
            // Wired via delegation in bindNotificationsHandlers so optimistic
            // removal works without re-rendering the list.
            const markDoneBtn = n.followup_id
                ? `<div class="pulse-acts"><button type="button" class="pulse-mini yes notif-mark-done" data-followup-id="${escapeHtml(n.followup_id)}" title="Mark this follow-up complete">Mark done</button></div>`
                : '';
            const onClickAttr = n.entity_id ? `data-lead-id="${escapeHtml(n.entity_id)}"` : '';
            // ── the row ────────────────────────────────────────────────
            // Two lines, not three. Leading with the customer and folding the
            // due-time onto the meta line keeps the card short enough that it
            // stops dictating the height of the whole row of cards.
            const name = n.entity_name || n.title || "";
            const who = escapeHtml(name);
            const kind = n.entity_name ? escapeHtml(shortenNotificationTitle(n.title)) : "";
            // The chip already says how late it is, so the meta line drops the
            // trailing "· 3 days overdue". Saying it twice on one row spends
            // the widest column repeating the narrowest one.
            const whenShort = String(time).replace(/\s*\u00b7\s*\d+\s*days? overdue$/, '')
                                          .replace(/\s*\u00b7\s*1 day overdue$/, '');
            const meta = [kind, escapeHtml(whenShort)].filter(Boolean).join(' \u00b7 ');
            const urgency = n.type && n.type.includes('overdue') ? 'is-overdue'
                : n.type && n.type.includes('due') ? 'is-due' : 'is-info';
            return `<div class="pulse-task notif-item notif-row ${urgency}" ${onClickAttr}>
                <span class="notif-avatar" style="${avatarTint(name)}">${escapeHtml(initialsOf(name))}</span>
                <div class="notif-body">
                    <div class="notif-top">
                        <span class="notif-name">${who}</span>
                        <span class="pulse-tag ${tag[0]} notif-chip">${escapeHtml(shortUrgency(n, time))}</span>
                    </div>
                    <div class="notif-meta">${meta}</div>
                </div>
                ${markDoneBtn}
            </div>`;
        }).join('') + (data.items.length > 5 ? `<a href="leads.html" style="color:var(--brand-primary);font-size:12px;text-align:center;display:block;padding:4px;">+${data.items.length - 5} more in Leads</a>` : '');

        bindNotificationsHandlers();
    } catch (e) {
        console.error('Failed to load notifications:', e);
    }
}
