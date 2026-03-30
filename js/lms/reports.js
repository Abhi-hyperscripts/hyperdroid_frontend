// LMS Reports JavaScript

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('lms', '../');
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Check role access - only ADMIN and MANAGER
    lmsRoles.init();
    if (!lmsRoles.isAdmin() && !lmsRoles.isManager()) {
        showToast('You do not have access to reports', 'error');
        window.location.href = 'dashboard.html';
        return;
    }

    await loadPageData();
});

/**
 * Load all report data in parallel
 */
async function loadPageData() {
    try {
        await Promise.all([
            loadReports(),
            loadCompliance(),
            loadLeaderboard(),
            loadCourseDropdown(),
            loadTeamReport()
        ]);
    } catch (error) {
        console.error('Error loading reports:', error);
        showToast('Error loading report data', 'error');
    }
}

/**
 * Load overview stats
 */
async function loadReports() {
    try {
        const data = await api.request('/lms/lms-reports/overview');
        renderStats(data);
    } catch (error) {
        console.error('Error loading overview:', error);
    }
}

let overviewData = null;

/**
 * Render stats cards and charts
 */
function renderStats(data) {
    overviewData = data;
    document.getElementById('statTotalCourses').textContent = data.totalCourses ?? '-';
    document.getElementById('statTotalLearners').textContent = data.totalLearners ?? '-';
    document.getElementById('statCompletionRate').textContent =
        data.overallCompletionRate != null ? `${Math.round(data.overallCompletionRate)}%` : '-';
    document.getElementById('statAvgScore').textContent =
        data.averageScore != null ? `${Math.round(data.averageScore)}%` : '-';

    renderCharts(data);
}

/**
 * Render Chart.js charts from overview data
 */
function renderCharts(data) {
    if (typeof Chart === 'undefined') return;

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#94a3b8';
    const gridColor = 'rgba(148, 163, 184, 0.1)';

    // Enrollments breakdown (doughnut)
    const enrollCtx = document.getElementById('chartEnrollments');
    if (enrollCtx) {
        new Chart(enrollCtx, {
            type: 'doughnut',
            data: {
                labels: ['Active', 'Completed'],
                datasets: [{
                    data: [data.activeEnrollments || 0, data.completedEnrollments || 0],
                    backgroundColor: ['rgba(59, 130, 246, 0.8)', 'rgba(34, 197, 94, 0.8)'],
                    borderColor: ['rgba(59, 130, 246, 1)', 'rgba(34, 197, 94, 1)'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, padding: 16, font: { size: 12 } }
                    }
                }
            }
        });
    }

    // Course status breakdown (bar)
    const completionCtx = document.getElementById('chartCompletion');
    if (completionCtx) {
        const draft = (data.totalCourses || 0) - (data.publishedCourses || 0);
        new Chart(completionCtx, {
            type: 'bar',
            data: {
                labels: ['Published', 'Draft', 'Learners', 'Certificates'],
                datasets: [{
                    label: 'Count',
                    data: [data.publishedCourses || 0, draft, data.totalLearners || 0, data.certificatesIssued || 0],
                    backgroundColor: [
                        'rgba(34, 197, 94, 0.7)',
                        'rgba(234, 179, 8, 0.7)',
                        'rgba(59, 130, 246, 0.7)',
                        'rgba(168, 85, 247, 0.7)'
                    ],
                    borderRadius: 6,
                    barThickness: 40
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: textColor, stepSize: 1 },
                        grid: { color: gridColor }
                    },
                    x: {
                        ticks: { color: textColor },
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

/**
 * Load compliance training data
 */
async function loadCompliance() {
    const tbody = document.getElementById('complianceTableBody');
    try {
        const data = await api.request('/lms/lms-reports/compliance');
        const records = data.records || data || [];
        renderComplianceTable(records);
    } catch (error) {
        console.error('Error loading compliance:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Error loading compliance data</td></tr>';
    }
}

/**
 * Render compliance table
 */
function renderComplianceTable(records) {
    const tbody = document.getElementById('complianceTableBody');

    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No compliance training records</td></tr>';
        return;
    }

    tbody.innerHTML = records.map(r => {
        const statusClass = getStatusClass(r.status);
        const completedDate = r.completedAt
            ? new Date(r.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '-';
        const dueDate = r.dueDate
            ? new Date(r.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '-';

        return `
            <tr>
                <td>${escapeHtml(r.employeeName || '-')}</td>
                <td>${escapeHtml(r.courseTitle || '-')}</td>
                <td>${dueDate}</td>
                <td><span class="status-badge ${statusClass}">${escapeHtml(r.status || 'Pending')}</span></td>
                <td>${completedDate}</td>
            </tr>`;
    }).join('');
}

/**
 * Load leaderboard data
 */
async function loadLeaderboard() {
    const tbody = document.getElementById('leaderboardTableBody');
    try {
        const data = await api.request('/lms/lms-reports/leaderboard');
        const entries = data.entries || data || [];
        renderLeaderboard(entries);
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Error loading leaderboard</td></tr>';
    }
}

/**
 * Render leaderboard table
 */
function renderLeaderboard(entries) {
    const tbody = document.getElementById('leaderboardTableBody');

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No leaderboard data</td></tr>';
        return;
    }

    tbody.innerHTML = entries.map(entry => {
        const rank = entry.rank ?? 0;
        const rankIcon = rank <= 3 ? getMedalIcon(rank) : rank;
        return `
            <tr>
                <td class="rank-cell">${rankIcon}</td>
                <td>${escapeHtml(entry.userName || '-')}</td>
                <td>${entry.coursesCompleted ?? 0}</td>
                <td>${entry.averageScore != null ? `${Math.round(entry.averageScore)}%` : '-'}</td>
                <td>${entry.certificatesEarned ?? 0}</td>
            </tr>`;
    }).join('');
}

/**
 * Export all report data as CSV (fetches from API for complete dataset)
 */
async function exportCsv() {
    try {
        showToast('Generating export...', 'info');

        // Fetch all data from API for complete export
        const [overviewRes, complianceRes, leaderboardRes] = await Promise.all([
            api.request('/lms/lms-reports/overview').catch(() => null),
            api.request('/lms/lms-reports/compliance').catch(() => ({ records: [] })),
            api.request('/lms/lms-reports/leaderboard').catch(() => [])
        ]);

        const rows = [];

        // Overview section
        if (overviewRes) {
            rows.push('=== OVERVIEW ===');
            rows.push('Metric,Value');
            rows.push(`"Total Courses","${overviewRes.totalCourses ?? 0}"`);
            rows.push(`"Total Learners","${overviewRes.totalLearners ?? 0}"`);
            rows.push(`"Completion Rate","${overviewRes.overallCompletionRate != null ? Math.round(overviewRes.overallCompletionRate) + '%' : '-'}"`);
            rows.push(`"Average Score","${overviewRes.averageScore != null ? Math.round(overviewRes.averageScore) + '%' : '-'}"`);
            rows.push('');
        }

        // Compliance section
        const complianceData = complianceRes || {};
        const compliance = Array.isArray(complianceData) ? complianceData : (complianceData.records || []);
        rows.push('=== COMPLIANCE TRAINING ===');
        rows.push('Employee,Course,Due Date,Status,Completed On');
        compliance.forEach(r => {
            const dueDate = r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '-';
            const completedDate = r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '-';
            rows.push(`"${(r.employeeName || '-').replace(/"/g, '""')}","${(r.courseTitle || '-').replace(/"/g, '""')}","${dueDate}","${r.status || 'Pending'}","${completedDate}"`);
        });
        if (!compliance.length) rows.push('"No compliance records"');
        rows.push('');

        // Leaderboard section
        const lbData = leaderboardRes || [];
        const leaderboard = Array.isArray(lbData) ? lbData : (lbData.entries || []);
        rows.push('=== LEADERBOARD ===');
        rows.push('Rank,Learner,Courses Completed,Avg Score,Certificates');
        leaderboard.forEach(e => {
            rows.push(`${e.rank ?? 0},"${(e.userName || '-').replace(/"/g, '""')}",${e.coursesCompleted ?? 0},"${e.averageScore != null ? Math.round(e.averageScore) + '%' : '-'}",${e.certificatesEarned ?? 0}`);
        });
        if (!leaderboard.length) rows.push('"No leaderboard data"');

        const csv = rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lms-reports-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV exported successfully', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showToast('Error exporting CSV', 'error');
    }
}

// ==================== Team Report ====================

async function loadTeamReport() {
    // Only for managers/admins
    if (typeof lmsRoles !== 'undefined') {
        lmsRoles.init();
        if (!lmsRoles.isManager()) return;
    }

    const section = document.getElementById('teamReportSection');
    if (!section) return;
    section.style.display = '';

    try {
        const data = await api.request('/lms/lms-reports/team');
        document.getElementById('teamStatMembers').textContent = data.totalMembers ?? 0;
        document.getElementById('teamStatEnrollments').textContent = data.totalEnrollments ?? 0;
        document.getElementById('teamStatProgress').textContent =
            data.averageProgress != null ? Math.round(data.averageProgress) + '%' : '0%';

        const tbody = document.getElementById('teamReportBody');
        const members = data.members || [];

        if (members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No team members enrolled yet. Use Bulk Enroll to assign courses.</td></tr>';
            return;
        }

        tbody.innerHTML = members.map(m => `
            <tr>
                <td>${escapeHtml(m.userName || m.userId)}</td>
                <td>${m.coursesEnrolled ?? 0}</td>
                <td>${m.coursesCompleted ?? 0}</td>
                <td>${m.averageProgress != null ? Math.round(m.averageProgress) + '%' : '-'}</td>
                <td>${m.averageScore != null ? Math.round(m.averageScore) + '%' : '-'}</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Error loading team report:', e);
        if (section) section.style.display = 'none';
    }
}

// ==================== Course Dropdown ====================

async function loadCourseDropdown() {
    const select = document.getElementById('courseReportSelect');
    if (!select) return;
    try {
        const data = await api.request('/lms/courses');
        const courses = data.courses || data || [];
        courses.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.title;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Error loading courses for dropdown:', e);
    }
}

// ==================== Course Report ====================

async function loadCourseReport() {
    const courseId = document.getElementById('courseReportSelect').value;
    const panel = document.getElementById('courseReportPanel');
    if (!courseId) {
        if (panel) panel.style.display = 'none';
        return;
    }

    try {
        const stats = await api.request(`/lms/lms-reports/course/${courseId}`);
        if (panel) {
            panel.style.display = '';
            document.getElementById('crStatEnrollments').textContent = stats.totalEnrollments ?? 0;
            document.getElementById('crStatCompletion').textContent =
                stats.completionRate != null ? Math.round(stats.completionRate) + '%' : '0%';
            document.getElementById('crStatAvgScore').textContent =
                stats.averageScore != null ? Math.round(stats.averageScore) + '%' : '-';
            document.getElementById('crStatAvgProgress').textContent =
                stats.averageProgressPct != null ? Math.round(stats.averageProgressPct) + '%' : '-';
        }
    } catch (e) {
        console.error('Error loading course report:', e);
        if (panel) {
            panel.style.display = '';
            document.getElementById('crStatEnrollments').textContent = '-';
            document.getElementById('crStatCompletion').textContent = '-';
            document.getElementById('crStatAvgScore').textContent = '-';
            document.getElementById('crStatAvgProgress').textContent = '-';
        }
        showToast('Error loading course report', 'error');
    }
}

// ==================== Learner Report ====================

async function searchLearnerReport() {
    const userId = document.getElementById('learnerSearchInput').value.trim();
    const panel = document.getElementById('learnerReportPanel');

    if (!userId) {
        showToast('Please enter a user ID', 'warning');
        return;
    }

    try {
        const report = await api.request(`/lms/lms-reports/learner/${userId}`);
        if (panel) {
            panel.style.display = '';
            document.getElementById('learnerReportName').textContent = report.userName || report.user_name || userId;
            document.getElementById('lrStatEnrolled').textContent = report.coursesEnrolled ?? report.courses_enrolled ?? 0;
            document.getElementById('lrStatCompleted').textContent = report.coursesCompleted ?? report.courses_completed ?? 0;
            document.getElementById('lrStatAvgScore').textContent =
                (report.averageScore ?? report.average_score) != null ? Math.round(report.averageScore ?? report.average_score) + '%' : '-';
            document.getElementById('lrStatCerts').textContent = report.certificatesEarned ?? report.certificates_earned ?? 0;
        }
    } catch (e) {
        console.error('Error loading learner report:', e);
        if (panel) panel.style.display = 'none';
        showToast('Learner not found or error loading report', 'error');
    }
}

// ==================== Utility Functions ====================

function getStatusClass(status) {
    if (!status) return 'status-pending';
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'complete') return 'status-active';
    if (s === 'overdue' || s === 'expired') return 'status-rejected';
    if (s === 'in_progress' || s === 'in progress') return 'status-pending';
    return 'status-pending';
}

function getMedalIcon(rank) {
    const colors = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="${colors[rank]}" stroke="${colors[rank]}" stroke-width="1">
        <circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
    </svg>`;
}

function formatHours(h) {
    if (h == null) return '-';
    if (h < 1) return `${Math.round(h * 60)}m`;
    return `${Math.round(h * 10) / 10}h`;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
