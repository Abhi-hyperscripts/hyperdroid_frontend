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

    // WhatsApp Inbox card — SUPERADMIN-only AND only when WhatsApp is
    // actually configured (i.e. /whatsapp/numbers returns at least one
    // active number). Without this gate, the card would 404-ish into an
    // empty inbox for tenants who haven't connected Interakt yet.
    if (isSuperadmin) {
        try {
            const resp = await api.request('/whatsapp/numbers');
            const numbers = (resp && resp.numbers) ? resp.numbers : [];
            const hasActive = numbers.some(n => n.is_active ?? n.isActive);
            if (hasActive) {
                const waCard = document.getElementById('cardWhatsappInbox');
                if (waCard) waCard.style.display = '';
                const railWa = document.getElementById('railWhatsapp');
                if (railWa) railWa.style.display = '';
            }
        } catch (err) {
            // Endpoint missing / 403 / network blip — leave the card hidden.
            console.warn('[Dashboard] WhatsApp numbers check failed (card stays hidden):', err);
        }
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
            loadRecentActivity()
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
            navigateTo('leads.html');
        }
    });
    _notificationsHandlersBound = true;
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
            const time = new Date(n.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            // Mark Done only for follow-up notifications (n.followup_id present).
            // Wired via delegation in bindNotificationsHandlers so optimistic
            // removal works without re-rendering the list.
            const markDoneBtn = n.followup_id
                ? `<div class="pulse-acts"><button type="button" class="pulse-mini yes notif-mark-done" data-followup-id="${escapeHtml(n.followup_id)}" title="Mark this follow-up complete">Mark done</button></div>`
                : '';
            const onClickAttr = n.entity_id ? `data-lead-id="${escapeHtml(n.entity_id)}"` : '';
            return `<div class="pulse-task notif-item" ${onClickAttr}>
                <div class="trow">
                    <div class="meta">
                        <div class="t1">${escapeHtml(n.title)}</div>
                        <div class="t2">${n.description ? escapeHtml(n.description).substring(0, 60) + ' · ' : ''}${time}</div>
                    </div>
                    <span class="pulse-tag ${tag[0]}">${tag[1]}</span>
                </div>
                ${markDoneBtn}
            </div>`;
        }).join('') + (data.items.length > 5 ? `<a href="leads.html" style="color:var(--brand-primary);font-size:12px;text-align:center;display:block;padding:4px;">+${data.items.length - 5} more in Leads</a>` : '');

        bindNotificationsHandlers();
    } catch (e) {
        console.error('Failed to load notifications:', e);
    }
}
