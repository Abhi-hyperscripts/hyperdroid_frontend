/**
 * PMS Timesheets
 * Weekly timesheet view, submission, and history.
 */

// ==================== State ====================
let currentWeekStart = getMondayOfWeek(new Date());
let weeklyView = null;
let timesheetHistory = [];
let pendingTimesheets = [];
let reviewSubmitting = false;

// ==================== Role detection ====================

/**
 * True when the logged-in user can review (approve/reject) team timesheets.
 * The backend gates POST /timesheets/review and GET /timesheets/pending on
 * PMS_ADMIN/SUPERADMIN, so we use the same allowlist client-side to decide
 * whether the Pending Approvals section renders.
 */
function isTimesheetReviewer() {
    try {
        const user = JSON.parse(localStorage.getItem('ragenaizer_user') || '{}');
        const roles = user.roles || [];
        return roles.includes('PMS_ADMIN') || roles.includes('SUPERADMIN');
    } catch { return false; }
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    updateWeekDisplay();
    loadWeeklyView();
    loadTimesheetHistory();

    // Reviewer-only: show pending approvals section + load it.
    if (isTimesheetReviewer()) {
        const section = document.getElementById('pendingApprovalsSection');
        if (section) section.style.display = '';
        loadPendingTimesheets();
    }
});

// ==================== Week Navigation ====================

function getMondayOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function formatDateParam(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function updateWeekDisplay() {
    const el = document.getElementById('weekDisplay');
    if (!el) return;
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 6);
    const opts = { month: 'short', day: 'numeric' };
    const startStr = currentWeekStart.toLocaleDateString('en-US', opts);
    const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
    el.textContent = `${startStr} - ${endStr}`;
}

function previousWeek() {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    updateWeekDisplay();
    loadWeeklyView();
}

function nextWeek() {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    updateWeekDisplay();
    loadWeeklyView();
}

// ==================== Data Loading ====================

async function loadWeeklyView() {
    const tbody = document.getElementById('timesheetTableBody');
    try {
        const weekOf = formatDateParam(currentWeekStart);
        const response = await api.request(`/pms/timesheets/my/weekly?weekOf=${weekOf}`);
        weeklyView = response;

        updateStats();
        renderWeeklyTable();
        updateSubmitButton();
    } catch (error) {
        console.error('Error loading weekly view:', error);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="crm-empty-state">
                        <div class="crm-empty-content"><p>Failed to load timesheet</p></div>
                    </td>
                </tr>`;
        }
    }
}

async function loadTimesheetHistory() {
    const tbody = document.getElementById('timesheetHistoryBody');
    try {
        const response = await api.request('/pms/timesheets/my');
        timesheetHistory = Array.isArray(response) ? response : (response?.data ?? []);
        renderHistoryTable();
    } catch (error) {
        console.error('Error loading timesheet history:', error);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="crm-empty-state">
                        <div class="crm-empty-content"><p>Failed to load history</p></div>
                    </td>
                </tr>`;
        }
    }
}

// ==================== Stats ====================

function updateStats() {
    if (!weeklyView) return;

    const totalMinutes = weeklyView.total_minutes || 0;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    setTextContent('statWeekHours', mins > 0 ? `${hours}h ${mins}m` : `${hours}h`);

    const status = weeklyView.timesheet_status || 'draft';
    setTextContent('statWeekStatus', capitalizeFirst(status));

    // Count from history
    const submitted = timesheetHistory.filter(t => t.status === 'submitted' || t.status === 'approved').length;
    const approved = timesheetHistory.filter(t => t.status === 'approved').length;
    setTextContent('statTotalSubmitted', submitted);
    setTextContent('statTotalApproved', approved);
}

// ==================== Rendering ====================

function renderWeeklyTable() {
    const tbody = document.getElementById('timesheetTableBody');
    if (!tbody || !weeklyView || !weeklyView.days) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="crm-empty-state"><div class="crm-empty-content"><p>No data for this week</p></div></td></tr>';
        return;
    }

    const days = weeklyView.days;

    if (days.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="crm-empty-state"><div class="crm-empty-content"><p>No entries this week</p></div></td></tr>';
        return;
    }

    tbody.innerHTML = days.map(day => {
        const date = new Date(day.date);
        const isToday = isSameDay(date, new Date());
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const totalMins = day.total_minutes || 0;
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const hoursStr = totalMins === 0 ? '-' : (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`);

        // Get unique project names from entries
        const projects = [...new Set((day.entries || []).map(e => e.project_name || 'Unknown'))];
        const projectStr = projects.length > 0 ? projects.join(', ') : '-';
        const entryCount = (day.entries || []).length;

        const rowClass = isToday ? 'style="background: var(--bg-tertiary);"' : (isWeekend ? 'style="opacity: 0.7;"' : '');

        return `
        <tr ${rowClass}>
            <td>
                <span class="crm-cell-primary">${day.day_name || date.toLocaleDateString('en-US', { weekday: 'long' })}${isToday ? ' (Today)' : ''}</span>
            </td>
            <td>
                <span class="crm-cell-secondary">${formatDate(day.date)}</span>
            </td>
            <td>
                <span class="crm-cell-secondary">${escapeHtml(projectStr)}</span>
            </td>
            <td>
                <span class="crm-cell-primary" style="font-weight: 600; ${totalMins > 0 ? 'color: var(--brand-primary);' : ''}">${hoursStr}</span>
            </td>
            <td>
                <span class="crm-cell-secondary">${entryCount > 0 ? entryCount : '-'}</span>
            </td>
        </tr>
        `;
    }).join('');

    // Add total row
    const totalMins = weeklyView.total_minutes || 0;
    const totalHours = Math.floor(totalMins / 60);
    const totalRemainder = totalMins % 60;
    const totalStr = totalMins === 0 ? '0h' : (totalRemainder > 0 ? `${totalHours}h ${totalRemainder}m` : `${totalHours}h`);

    tbody.innerHTML += `
        <tr style="font-weight: 700; border-top: 2px solid var(--border-primary);">
            <td colspan="3" style="text-align: right; padding-right: 16px;">Weekly Total</td>
            <td style="color: var(--brand-primary);">${totalStr}</td>
            <td></td>
        </tr>
    `;
}

function renderHistoryTable() {
    const tbody = document.getElementById('timesheetHistoryBody');
    if (!tbody) return;

    if (!timesheetHistory || timesheetHistory.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="crm-empty-state">
                    <div class="crm-empty-content"><p>No timesheet history</p></div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = timesheetHistory.map(ts => {
        const weekStart = new Date(ts.week_start);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekStr = `${formatDate(ts.week_start)} - ${formatDate(weekEnd.toISOString())}`;

        const totalMins = ts.total_minutes || 0;
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const hoursStr = totalMins === 0 ? '0h' : (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`);

        const statusClass = getStatusClass(ts.status);
        const submittedDate = ts.submitted_at ? formatDate(ts.submitted_at) : '-';
        const reviewerName = ts.reviewer_name || '-';

        return `
        <tr>
            <td><span class="crm-cell-primary">${weekStr}</span></td>
            <td><span class="crm-cell-secondary">${hoursStr}</span></td>
            <td><span class="crm-status-badge ${statusClass}">${capitalizeFirst(ts.status || 'draft')}</span></td>
            <td><span class="crm-cell-secondary">${submittedDate}</span></td>
            <td><span class="crm-cell-secondary">${escapeHtml(reviewerName)}</span></td>
        </tr>
        `;
    }).join('');
}

// ==================== Submit ====================

function updateSubmitButton() {
    const btn = document.getElementById('submitTimesheetBtn');
    if (!btn) return;

    const status = weeklyView?.timesheet_status;
    if (status === 'submitted') {
        btn.disabled = true;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Already Submitted';
    } else if (status === 'approved') {
        btn.disabled = true;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Approved';
    } else {
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9z"/></svg> Submit This Week';
    }
}

async function submitCurrentWeekTimesheet() {
    const totalMins = weeklyView?.total_minutes || 0;
    if (totalMins === 0) {
        if (typeof Toast !== 'undefined') {
            Toast.error('No time entries for this week to submit');
        }
        return;
    }

    const btn = document.getElementById('submitTimesheetBtn');
    if (btn) btn.disabled = true;

    try {
        const weekStart = formatDateParam(currentWeekStart);
        await api.request('/pms/timesheets/submit', {
            method: 'POST',
            body: JSON.stringify({ week_start: weekStart })
        });

        if (typeof Toast !== 'undefined') {
            Toast.success('Timesheet submitted successfully');
        }

        // Reload
        await Promise.all([loadWeeklyView(), loadTimesheetHistory()]);
    } catch (error) {
        console.error('Error submitting timesheet:', error);
        if (typeof Toast !== 'undefined') {
            Toast.error(error.message || 'Failed to submit timesheet');
        }
        if (btn) btn.disabled = false;
    }
}

// ==================== Utilities ====================

function getStatusClass(status) {
    const classes = {
        'draft': 'status-new',
        'submitted': 'status-qualified',
        'approved': 'status-converted',
        'rejected': 'status-converted'
    };
    return classes[status] || 'status-new';
}

function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
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

function getInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

// ==================== Pending Approvals (admin) ====================

async function loadPendingTimesheets() {
    const tbody = document.getElementById('pendingTimesheetsBody');
    try {
        const response = await api.request('/pms/timesheets/pending');
        pendingTimesheets = Array.isArray(response) ? response : (response?.data ?? []);
        renderPendingTable();
    } catch (error) {
        console.error('Error loading pending timesheets:', error);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="crm-empty-state">
                        <div class="crm-empty-content"><p>Failed to load pending timesheets</p></div>
                    </td>
                </tr>`;
        }
    }
}

function renderPendingTable() {
    const tbody = document.getElementById('pendingTimesheetsBody');
    const badge = document.getElementById('pendingCountBadge');
    if (!tbody) return;

    if (badge) badge.textContent = String(pendingTimesheets.length);

    if (!pendingTimesheets || pendingTimesheets.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="crm-empty-state">
                    <div class="crm-empty-content"><p>No timesheets awaiting review</p></div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = pendingTimesheets.map(ts => {
        const weekEnd = new Date(ts.week_start);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekStr = `${formatDate(ts.week_start)} - ${formatDate(weekEnd.toISOString())}`;
        const totalMins = ts.total_minutes || 0;
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const hoursStr = totalMins === 0 ? '0h' : (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`);
        const submittedDate = ts.submitted_at ? formatDate(ts.submitted_at) : '-';
        const userName = ts.user_name || ts.user_id || 'Unknown';

        return `
        <tr>
            <td><span class="crm-cell-primary">${escapeHtml(userName)}</span></td>
            <td><span class="crm-cell-secondary">${weekStr}</span></td>
            <td><span class="crm-cell-primary" style="font-weight: 600; color: var(--brand-primary);">${hoursStr}</span></td>
            <td><span class="crm-cell-secondary">${submittedDate}</span></td>
            <td style="text-align: right;">
                <button class="btn btn-sm btn-primary" onclick="openReviewModal('${ts.id}')">Review</button>
            </td>
        </tr>
        `;
    }).join('');
}

// ==================== Review Modal ====================

async function openReviewModal(timesheetId) {
    const modal = document.getElementById('reviewTimesheetModal');
    if (!modal) return;
    document.getElementById('reviewTimesheetId').value = timesheetId;
    document.getElementById('reviewComment').value = '';
    document.getElementById('reviewSummary').innerHTML = '<p style="margin:0;">Loading...</p>';
    document.getElementById('reviewEntriesBody').innerHTML =
        '<tr><td colspan="5" class="crm-empty-state"><div class="crm-empty-content"><p>Loading entries...</p></div></td></tr>';
    modal.classList.add('gm-animating');
    requestAnimationFrame(() => modal.classList.add('active'));

    try {
        const ts = await api.request(`/pms/timesheets/${timesheetId}`);
        if (!ts) throw new Error('Timesheet not found');

        const weekEnd = new Date(ts.week_start);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const totalMins = ts.total_minutes || 0;
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        const totalStr = totalMins === 0 ? '0h' : (m > 0 ? `${h}h ${m}m` : `${h}h`);

        document.getElementById('reviewSummary').innerHTML = `
            <div style="display:flex; gap:1.5rem; flex-wrap:wrap;">
                <div><strong>Submitted by:</strong> ${escapeHtml(ts.user_name || ts.user_id)}</div>
                <div><strong>Week:</strong> ${formatDate(ts.week_start)} – ${formatDate(weekEnd.toISOString())}</div>
                <div><strong>Total:</strong> <span style="color: var(--brand-primary); font-weight: 600;">${totalStr}</span></div>
            </div>
        `;

        // Fetch the linked entries via admin-scoped list endpoint
        const fromDate = formatDateParam(new Date(ts.week_start));
        const toDate = formatDateParam(weekEnd);
        const entries = await api.request(
            `/pms/time-entries?userId=${encodeURIComponent(ts.user_id)}&fromDate=${fromDate}&toDate=${toDate}`
        );
        renderReviewEntries(Array.isArray(entries) ? entries : []);
    } catch (error) {
        console.error('Error loading timesheet detail:', error);
        document.getElementById('reviewSummary').innerHTML =
            `<p style="margin:0; color: var(--color-error);">Failed to load timesheet: ${escapeHtml(error.message || 'unknown error')}</p>`;
    }
}

function renderReviewEntries(entries) {
    const tbody = document.getElementById('reviewEntriesBody');
    if (!tbody) return;

    if (!entries || entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="crm-empty-state"><div class="crm-empty-content"><p>No entries on this timesheet</p></div></td></tr>';
        return;
    }

    // Order chronologically.
    const sorted = [...entries].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));

    tbody.innerHTML = sorted.map(e => {
        const date = new Date(e.log_date);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const totalMins = e.total_minutes || ((e.hours || 0) * 60 + (e.minutes || 0));
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        const hoursStr = m > 0 ? `${h}h ${m}m` : `${h}h`;
        return `
        <tr>
            <td>${dayName}</td>
            <td>${formatDate(e.log_date)}</td>
            <td>${escapeHtml(e.project_name || '-')}</td>
            <td>${hoursStr}</td>
            <td>${escapeHtml(e.comment || '-')}</td>
        </tr>
        `;
    }).join('');
}

function closeReviewModal() {
    const modal = document.getElementById('reviewTimesheetModal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => modal.classList.remove('gm-animating'), 200);
}

async function reviewTimesheet(action) {
    if (reviewSubmitting) return;
    if (action !== 'approve' && action !== 'reject') return;

    const tsId = document.getElementById('reviewTimesheetId').value;
    const comment = (document.getElementById('reviewComment').value || '').trim();

    if (action === 'reject' && comment.length === 0) {
        if (typeof Toast !== 'undefined') Toast.error('Please add a comment so the team member knows what to fix.');
        document.getElementById('reviewComment').focus();
        return;
    }

    const btn = document.getElementById(action === 'approve' ? 'reviewApproveBtn' : 'reviewRejectBtn');
    const spinner = document.getElementById(action === 'approve' ? 'reviewApproveSpinner' : 'reviewRejectSpinner');
    reviewSubmitting = true;
    if (btn) btn.disabled = true;
    if (spinner) spinner.style.display = '';

    try {
        await api.request('/pms/timesheets/review', {
            method: 'POST',
            body: JSON.stringify({ timesheet_id: tsId, action, comment: comment || null })
        });
        if (typeof Toast !== 'undefined') {
            Toast.success(action === 'approve' ? 'Timesheet approved' : 'Timesheet rejected');
        }
        closeReviewModal();
        await loadPendingTimesheets();
    } catch (error) {
        console.error('Review failed:', error);
        if (typeof Toast !== 'undefined') Toast.error(error.message || 'Failed to review timesheet');
    } finally {
        reviewSubmitting = false;
        if (btn) btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}
