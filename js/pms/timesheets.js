/**
 * PMS Timesheets
 * Weekly timesheet view, submission, and history.
 */

// ==================== State ====================
let currentWeekStart = getMondayOfWeek(new Date());
let weeklyView = null;
let timesheetHistory = [];

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
    return div.innerHTML;
}

function setTextContent(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function getInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}
