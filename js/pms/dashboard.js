// PMS Dashboard JavaScript

// Initialize
async function pmsBoot() {
    Navigation.init('pms', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Show Admin (Danger Zone) link only for SUPERADMIN
    try {
        const tok = localStorage.getItem('ragenaizer_authToken') || '';
        if (tok) {
            const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const role = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
                || payload['role'] || payload['roles'] || [];
            const roles = Array.isArray(role) ? role : [role];
            if (roles.includes('SUPERADMIN')) {
                const adminLink = document.getElementById('pmsAdminLink');
                if (adminLink) adminLink.style.display = 'inline-flex';
            }
        }
    } catch { /* JWT parse fails are non-fatal */ }

    await loadDashboard();
}

/**
 * Load all dashboard data
 */
async function loadDashboard() {
    try {
        await Promise.all([
            loadStats(),
            loadRecentActivity(),
            renderPulse()          // independent: never gated on the stat tiles
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

// ── Delivery Pulse ──────────────────────────────────────────────────────────
// Same visual language as the CRM / HRMS / Accounts dashboards: a full-bleed
// wave of hours logged per day, three glass pulse-cards (project pipeline,
// attention inbox, hours by project) and mono stat chips.
const PULSE_STATUS = {
    not_started: { label: 'Not started', color: '#94a3b8' },
    in_progress: { label: 'In progress', color: '#3b82f6' },
    on_hold:     { label: 'On hold',     color: '#f59e0b' },
    completed:   { label: 'Completed',   color: '#10b981' },
    cancelled:   { label: 'Cancelled',   color: '#ef4444' }
};

function pulseBars(hostId, rows, fmt) {
    const host = document.getElementById(hostId);
    if (!host) return;
    if (!rows.length) { host.innerHTML = '<div class="pulse-empty">Nothing yet</div>'; return; }
    const max = Math.max(...rows.map(r => r.value)) || 1;
    host.innerHTML = rows.map(r => `
        <div class="pbar">
            <span class="lbl" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>
            <span class="track"><i class="fill" style="width:${Math.max((r.value / max) * 100, 2)}%;background:${r.color || 'var(--brand-primary)'}"></i></span>
            <span class="cnt">${fmt ? fmt(r.value) : r.value}${r.pct != null ? ` <small>${r.pct}%</small>` : ''}</span>
        </div>`).join('');
}


async function renderPulse() {
    const asList = r => Array.isArray(r) ? r : (r?.data ?? []);
    const sub = document.getElementById('pulseSubtitle');
    if (sub) {
        sub.textContent = new Date().toLocaleDateString('en-IN',
            { weekday: 'long', day: 'numeric', month: 'long' }) + ' · Delivery';
    }
    try {
        const today = new Date();
        const from = new Date(today.getTime() - 29 * 864e5).toISOString().slice(0, 10);
        const to = today.toISOString().slice(0, 10);
        const [projects, tasks] = await Promise.all([
            api.request('/pms/projects', { _skipSpinner: true }).then(asList).catch(() => []),
            api.request('/pms/tasks', { _skipSpinner: true }).then(asList).catch(() => [])
        ]);

        // Team-wide, not personal. Every other dashboard's wave is org-level
        // (all leads captured / all attendance / all invoiced), so charting only
        // the signed-in user's hours made PMS the odd one out — and rendered
        // nothing at all for a manager who logs no time himself.
        const entryChunks = await Promise.all(projects.slice(0, 12).map(pr =>
            api.request(`/pms/time-entries?projectId=${pr.id}&fromDate=${from}&toDate=${to}`, { _skipSpinner: true })
                .then(asList).catch(() => [])));
        const entries = entryChunks.flat();

        // ── project pipeline bars ──
        const byStatus = {};
        projects.forEach(p => { const k = p.status || 'not_started'; byStatus[k] = (byStatus[k] || 0) + 1; });
        const total = projects.length || 1;
        pulseBars('chartProjectStatus', Object.keys(PULSE_STATUS)
            .filter(k => byStatus[k])
            .map(k => ({ label: PULSE_STATUS[k].label, value: byStatus[k], color: PULSE_STATUS[k].color,
                         pct: Math.round((byStatus[k] / total) * 100) })));
        setTextContent('projTotalNote', `${projects.length} projects`);
        const done = byStatus.completed || 0, active = byStatus.in_progress || 0;
        const foot = document.getElementById('projFooter');
        if (foot) foot.innerHTML = `<span class="won"><b>${done}</b> completed</span><span><b>${active}</b> in flight</span>`;

        // ── hours by project bars ──
        const nameOf = {};
        projects.forEach(p => { nameOf[p.id] = p.project_name || p.name || 'Untitled'; });
        const byProject = {};
        let totalMins = 0;
        entries.forEach(e => {
            const k = nameOf[e.project_id] || 'Unassigned';
            byProject[k] = (byProject[k] || 0) + (e.total_minutes || 0);
            totalMins += e.total_minutes || 0;
        });
        const hrs = m => Math.round((m / 60) * 10) / 10;
        pulseBars('chartHoursByProject',
            Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 6)
                .map(([label, mins]) => ({ label, value: hrs(mins) })), v => `${v}h`);
        setTextContent('hoursTotalNote', `${hrs(totalMins)}h logged`);

        // ── attention inbox: overdue / due-today tasks ──
        const inbox = document.getElementById('attentionList');
        const todayISO = to;
        const open = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.due_date);
        const flagged = open.map(t => {
            const d = String(t.due_date).slice(0, 10);
            return { t, d, overdue: d < todayISO, due: d === todayISO };
        }).filter(x => x.overdue || x.due)
          .sort((a, b) => a.d.localeCompare(b.d));

        if (inbox) {
            if (!flagged.length) {
                inbox.innerHTML = '<div class="pulse-empty">Nothing overdue — you\'re clear.</div>';
            } else {
                inbox.innerHTML = flagged.slice(0, 5).map(x => `
                    <div class="pulse-task">
                        <div class="trow">
                            <div class="meta">
                                <div class="t1">${escapeHtml(x.t.title || 'Untitled task')}</div>
                                <div class="t2">${escapeHtml(nameOf[x.t.project_id] || 'Project')} · due ${new Date(x.d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                            </div>
                            <span class="pulse-tag ${x.overdue ? 'overdue' : 'due'}">${x.overdue ? 'OVERDUE' : 'DUE TODAY'}</span>
                        </div>
                    </div>`).join('');
            }
        }
        setTextContent('attnCount', flagged.length ? `${flagged.length} items` : '');

        // ── who logged time (team-wide) ──
        renderTeamHours(entries);

        // ── full-bleed wave: hours per day ──
        renderPulseWave(entries, from, to);
    } catch (e) {
        console.warn('[pms] pulse render failed:', e && e.message);
    }
}

// Team-wide hours by person. /time-entries/my is personal, so this walks the
// project time entries the user can see and groups by logger.
function renderTeamHours(rows) {
    const host = document.getElementById('chartTeamHours');
    if (!host) return;
    if (!rows || !rows.length) { host.innerHTML = '<div class="pulse-empty">No time logged in this window.</div>'; return; }
    const byUser = {};
    rows.forEach(e => {
        const k = e.user_name || e.user_display_name || 'Unknown';
        byUser[k] = (byUser[k] || 0) + (e.total_minutes || 0);
    });
    const ranked = Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const hrs = m => Math.round((m / 60) * 10) / 10;
    pulseBars('chartTeamHours', ranked.map(([label, mins]) => ({ label, value: hrs(mins) })), v => `${v}h`);
    setTextContent('teamHoursNote', `${hrs(rows.reduce((a, e) => a + (e.total_minutes || 0), 0))}h team total`);
}

// Monotone-cubic wave of hours logged per day (suite hero-wave pattern).
function renderPulseWave(entries, from, to) {
    const band = document.getElementById('pmsWave');
    const host = document.getElementById('pmsWaveChart');
    if (!band || !host) return;

    const start = new Date(from);
    const DAYS = Math.round((new Date(to) - start) / 864e5) + 1;
    const buckets = new Array(DAYS).fill(0);
    entries.forEach(e => {
        const d = new Date(String(e.log_date || e.created_at).slice(0, 10));
        const idx = Math.round((d - start) / 864e5);
        if (idx >= 0 && idx < DAYS) buckets[idx] += (e.total_minutes || 0) / 60;
    });
    if (buckets.every(v => v === 0)) { band.hidden = true; return; }

    const W = 1200, H = 150, padT = 30, padB = 20;
    const ih = H - padT - padB;
    const yMax = Math.max(...buckets) * 1.15 || 1;
    const x = i => (i / (DAYS - 1)) * W;
    const y = v => padT + ih - (v / yMax) * ih;
    const pts = buckets.map((v, i) => [x(i), y(v)]);
    const n = pts.length, dx = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
    const t = [m[0]];
    for (let i = 1; i < n - 1; i++) t.push((m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2);
    t.push(m[n - 2]);
    for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
        else {
            const a = t[i] / m[i], b = t[i + 1] / m[i], s2 = a * a + b * b;
            if (s2 > 9) { const tau = 3 / Math.sqrt(s2); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
        }
    }
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i];
        d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1) +
             ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1) +
             ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
    }
    const peak = buckets.indexOf(Math.max(...buckets));
    const lbl = i => { const dt = new Date(start); dt.setDate(start.getDate() + i);
                       return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
    let ticks = '';
    for (let i = 0; i < DAYS; i += 7) {
        ticks += `<text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9.5" fill="var(--text-muted)">${lbl(i)}</text>`;
    }
    host.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Hours logged per day, last 30 days">` +
        `<defs><linearGradient id="pmsWaveFill" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="var(--brand-primary)" stop-opacity="0.28"/>` +
        `<stop offset="1" stop-color="var(--brand-primary)" stop-opacity="0"/></linearGradient></defs>` +
        `<path d="${d} L${W},${H} L0,${H} Z" fill="url(#pmsWaveFill)" stroke="none"/>` +
        `<path class="draw-line" d="${d}" fill="none" stroke="var(--brand-primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${x(peak).toFixed(1)}" cy="${y(buckets[peak]).toFixed(1)}" r="3.5" fill="var(--brand-primary)"/>` +
        `<text x="${Math.min(Math.max(x(peak), 60), W - 80).toFixed(1)}" y="${Math.max(y(buckets[peak]) - 10, 14).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text-secondary)" font-family="var(--font-family-mono)">${Math.round(buckets[peak] * 10) / 10}h · ${lbl(peak)}</text>` +
        ticks + `</svg>`;
    band.hidden = false;

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const path = host.querySelector('.draw-line');
        const len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        path.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.15s';
        requestAnimationFrame(() => requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; }));
    }
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
    const host = document.getElementById('recentActivityFeed');
    if (!host) return;
    try {
        let activities = [];
        try {
            const projResponse = await api.request('/pms/projects', { _skipSpinner: true });
            const projects = Array.isArray(projResponse) ? projResponse : (projResponse?.data ?? []);
            if (projects.length > 0) {
                const actResponse = await api.request(`/pms/activity/project/${projects[0].id}`, { _skipSpinner: true });
                activities = Array.isArray(actResponse) ? actResponse : (actResponse?.data ?? []);
            }
        } catch { /* activity endpoint optional */ }

        // Collapse the bulk-import noise: consecutive rows from the same user
        // for the same action+entity become one line with a total count. The
        // old table listed every "Bulk Created · Time Entry · Count: 2" row.
        const rolled = [];
        activities.forEach(a => {
            const last = rolled[rolled.length - 1];
            const sameBucket = last
                && last.user_name === a.user_name
                && last.action === a.action
                && last.entity_type === a.entity_type;
            const n = Number((a.details && (a.details.count ?? a.details.Count)) || 1) || 1;
            if (sameBucket) { last.n += n; last.times += 1; }
            else rolled.push({ ...a, n, times: 1 });
        });

        if (!rolled.length) {
            host.innerHTML = '<div class="pulse-empty">No activity yet.</div>';
            return;
        }

        host.innerHTML = rolled.slice(0, 6).map(a => {
            const who = a.user_name || 'Someone';
            const what = capitalizeFirst(String(a.action || 'updated').replace(/_/g, ' '));
            const ent = String(a.entity_type || '').replace(/_/g, ' ');
            const qty = a.n > 1 ? ` <b>×${a.n}</b>` : '';
            return `
                <div class="pulse-task">
                    <div class="trow">
                        <div class="meta">
                            <div class="t1">${escapeHtml(who)} · ${escapeHtml(what)}${qty}</div>
                            <div class="t2">${escapeHtml(ent)}${a.created_at ? ' · ' + formatDate(a.created_at) : ''}</div>
                        </div>
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        host.innerHTML = '<div class="pulse-empty">Activity unavailable.</div>';
    }
}

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

// ── Bootstrap ───────────────────────────────────────────────────────────────
// Placed at the end of the file so every function above is defined. The page
// loads scripts via document.write and the CDN chart bundle can push this file
// past DOMContentLoaded, so a bare listener is not enough — check readyState.
(function bootPms() {
    const run = () => {
        window.__pmsBooted = 'running';
        Promise.resolve()
            .then(() => pmsBoot())
            .then(() => { window.__pmsBooted = 'ok'; })
            .catch(e => {
                window.__pmsBooted = 'error: ' + (e && e.message ? e.message : String(e));
                console.error('[pms] dashboard boot failed:', e);
            });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
