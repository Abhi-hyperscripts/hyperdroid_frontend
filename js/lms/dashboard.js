// LMS Dashboard JavaScript

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('lms', '../');
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }
    await loadPageData();
    applyRBAC();
});

function applyRBAC() {
    lmsRoles.init();
    // Instructor/Admin actions
    if (lmsRoles.isInstructor()) {
        const el1 = document.getElementById('actionCourseBuilder');
        if (el1) el1.style.display = '';
        const el2 = document.getElementById('actionLiveSessions');
        if (el2) el2.style.display = '';
    }
    // Manager/Admin actions
    if (lmsRoles.isManager()) {
        const el = document.getElementById('actionReports');
        if (el) el.style.display = '';
    }
    // Admin actions
    if (lmsRoles.isAdmin()) {
        const el = document.getElementById('actionAdmin');
        if (el) el.style.display = '';
    }
}

async function loadPageData() {
    try {
        // Set welcome message
        const user = getStoredUser();
        const welcomeEl = document.getElementById('welcomeMessage');
        if (welcomeEl && user) {
            const firstName = (user.firstName || user.email || 'Learner').split(' ')[0];
            welcomeEl.textContent = `Welcome back, ${firstName}!`;
        }

        await Promise.all([
            loadMyEnrollments(),
            loadLiveSessions(),
            loadAnnouncements()
        ]);
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Error loading dashboard data', 'error');
    }
}

let allEnrollments = [];

async function loadMyEnrollments() {
    try {
        const data = await api.request('/lms/enrollments/my');
        allEnrollments = Array.isArray(data) ? data : [];

        // Stats
        const enrolled = allEnrollments.filter(e => e.status === 'active').length;
        const completed = allEnrollments.filter(e => e.status === 'completed').length;
        document.getElementById('statEnrolled').textContent = enrolled;
        document.getElementById('statCompleted').textContent = completed;
        document.getElementById('statCertificates').textContent = completed; // approximate

        // Calculate hours spent from course durations weighted by progress
        const totalMinutes = allEnrollments.reduce((sum, e) => {
            const duration = e.courseDurationMinutes || 0;
            const progress = (e.progressPct || 0) / 100;
            return sum + (duration * progress);
        }, 0);
        const hours = Math.round(totalMinutes / 60);
        document.getElementById('statHoursSpent').textContent = hours >= 1 ? `${hours}h` : totalMinutes > 0 ? `${Math.round(totalMinutes)}m` : '0h';

        // Continue learning - active enrollments
        renderContinueLearning(allEnrollments.filter(e => e.status === 'active').slice(0, 3));

        // Deadlines - enrollments with due dates
        renderDeadlines(allEnrollments.filter(e => e.status === 'active' && e.dueDate));
    } catch (error) {
        console.error('Error loading enrollments:', error);
        document.getElementById('statEnrolled').textContent = '0';
        document.getElementById('statCompleted').textContent = '0';
        document.getElementById('statCertificates').textContent = '0';
        document.getElementById('statHoursSpent').textContent = '0h';
        renderContinueLearning([]);
        renderDeadlines([]);
    }
}

function renderContinueLearning(courses) {
    const container = document.getElementById('continueLearningGrid');
    if (!container) return;

    if (!courses.length) {
        container.innerHTML = `
            <div class="lms-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                </svg>
                <p>No courses in progress. <a href="catalog.html">Browse the catalog</a> to get started!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = courses.map(enrollment => {
        const progress = enrollment.progressPct ?? 0;
        return `
            <div class="lms-continue-card" onclick="window.location.href='course-detail.html?id=${enrollment.courseId}'">
                <div class="card-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                    </svg>
                </div>
                <h4>${escapeHtml(enrollment.courseTitle || 'Untitled Course')}</h4>
                <div class="progress-row">
                    <div class="lms-progress-bar">
                        <div class="lms-progress-fill" style="width:${progress}%"></div>
                    </div>
                    <span class="pct">${Math.round(progress)}%</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderDeadlines(enrollments) {
    const panel = document.getElementById('deadlinesPanel');
    if (!panel) return;

    if (!enrollments.length) {
        panel.innerHTML = `<div class="lms-empty-state"><p>No upcoming deadlines</p></div>`;
        return;
    }

    panel.innerHTML = enrollments.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).map(e => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-color-light)">
            <span style="font-size:0.8rem;color:var(--text-primary)">${escapeHtml(e.courseTitle || 'Course')}</span>
            <span class="lms-badge ${new Date(e.dueDate) < new Date() ? 'dropped' : 'active'}">${formatDate(e.dueDate)}</span>
        </div>
    `).join('');
}

async function loadLiveSessions() {
    const container = document.getElementById('liveSessionsList');
    if (!container) return;

    try {
        const data = await api.request('/lms/live-sessions');
        const sessions = Array.isArray(data) ? data : [];

        if (!sessions.length) {
            container.innerHTML = `<div class="lms-empty-state"><p>No upcoming live sessions</p></div>`;
            return;
        }

        container.innerHTML = sessions.slice(0, 3).map(session => `
            <div class="lms-continue-card" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center" onclick="window.location.href='live-sessions.html'">
                <div>
                    <h4 style="margin:0 0 4px">${escapeHtml(session.title)}</h4>
                    <span style="font-size:0.75rem;color:var(--text-secondary)">${escapeHtml(session.instructorName || '')} &middot; ${formatDateTime(session.scheduledAt)}</span>
                </div>
                <span class="lms-badge active">View</span>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading sessions:', error);
        container.innerHTML = `<div class="lms-empty-state"><p>No upcoming live sessions</p></div>`;
    }
}

async function loadAnnouncements() {
    const panel = document.getElementById('announcementsPanel');
    if (!panel) return;

    try {
        const data = await api.request('/lms/announcements');
        const announcements = (data.announcements || data || []).filter(a => a.isPublished);

        if (!announcements.length) {
            panel.innerHTML = `<div class="lms-empty-state"><p>No announcements</p></div>`;
            return;
        }

        panel.innerHTML = announcements.slice(0, 5).map(a => `
            <div style="padding:10px 0;border-bottom:1px solid var(--border-color-light)">
                <h4 style="margin:0 0 4px;font-size:0.85rem;color:var(--text-primary)">${escapeHtml(a.title)}</h4>
                <p style="margin:0;font-size:0.75rem;color:var(--text-secondary);line-height:1.4">${escapeHtml((a.body || '').substring(0, 120))}${(a.body || '').length > 120 ? '...' : ''}</p>
                <span style="font-size:0.7rem;color:var(--text-muted)">${formatDate(a.publishedAt || a.createdAt)}</span>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading announcements:', error);
        panel.innerHTML = `<div class="lms-empty-state"><p>No announcements</p></div>`;
    }
}

function refreshDashboard() {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('loading');
    loadPageData().finally(() => {
        if (btn) btn.classList.remove('loading');
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
