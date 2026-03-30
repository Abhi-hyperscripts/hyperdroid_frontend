/**
 * LMS Course Detail Page
 */

let courseId = null;
let courseData = null;
let modulesData = [];
let reviewsData = [];
let discussionsData = [];

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('lms', '../');
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    courseId = new URLSearchParams(window.location.search).get('id');
    if (!courseId) {
        showToast('No course ID specified', 'error');
        return;
    }

    initTabs();
    await loadCourseDetail(courseId);
});

// ─── Tabs ──────────────────────────────────────────────────────────────────

function initTabs() {
    const tabs = document.querySelectorAll('#courseTabs .lms-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.getAttribute('data-tab');
            document.querySelectorAll('.lms-tab-pane').forEach(p => p.classList.remove('active'));
            const pane = document.getElementById('tab-' + target);
            if (pane) pane.classList.add('active');

            if (target === 'modules' && modulesData.length === 0) loadModules();
            if (target === 'reviews' && reviewsData.length === 0) loadReviews();
            if (target === 'discussions' && discussionsData.length === 0) loadDiscussions();
        });
    });
}

// ─── Load Course ───────────────────────────────────────────────────────────

async function loadCourseDetail(id) {
    try {
        courseData = await api.request(`/lms/courses/${id}`);
        renderHeader();
        renderStats();
        renderOverview();
        renderEnrollmentActions();
        applyRBAC();
        await loadModules();
    } catch (error) {
        console.error('Error loading course:', error);
        showToast('Failed to load course details', 'error');
    }
}

// ─── RBAC ─────────────────────────────────────────────────────────────────

function applyRBAC() {
    if (typeof lmsRoles === 'undefined') return;
    lmsRoles.init();

    // Admin actions: duplicate, edit
    if (lmsRoles.isAdmin()) {
        const actionsEl = document.getElementById('courseActions');
        if (actionsEl) {
            const adminBtns = document.createElement('div');
            adminBtns.style.cssText = 'display:flex;gap:8px;margin-left:8px';
            adminBtns.innerHTML = `
                <button class="btn-outline-sm" onclick="handleDuplicate()" title="Duplicate course">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Duplicate
                </button>
                <button class="btn-outline-sm" onclick="window.location.href='course-builder.html?id=${courseId}'" title="Edit course">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit
                </button>
            `;
            actionsEl.appendChild(adminBtns);
        }
    }

    // Instructor/Admin stats panel
    if (lmsRoles.isInstructor()) {
        loadInstructorStats();
    }
}

async function handleDuplicate() {
    if (!confirm('Duplicate this course as a new draft?')) return;
    try {
        const result = await api.request(`/lms/courses/${courseId}/duplicate`, { method: 'POST' });
        const newId = result.id || result;
        showToast('Course duplicated!', 'success');
        window.location.href = `course-builder.html?id=${newId}`;
    } catch (error) {
        console.error('Duplicate failed:', error);
        showToast(error.message || 'Failed to duplicate course', 'error');
    }
}

async function loadInstructorStats() {
    try {
        const stats = await api.request(`/lms/courses/${courseId}/stats`);
        const panel = document.getElementById('instructorStatsPanel');
        if (panel) {
            panel.style.display = '';
            document.getElementById('instrStatEnrollments').textContent = stats.totalEnrollments ?? 0;
            document.getElementById('instrStatCompletion').textContent =
                stats.completionRate != null ? `${Math.round(stats.completionRate)}%` : '0%';
            document.getElementById('instrStatAvgScore').textContent =
                stats.averageScore != null ? `${Math.round(stats.averageScore)}%` : '-';
            document.getElementById('instrStatActive').textContent = stats.activeEnrollments ?? 0;
        }
    } catch (error) {
        console.error('Error loading instructor stats:', error);
    }
}

// ─── Header ────────────────────────────────────────────────────────────────

function renderHeader() {
    const c = courseData;
    if (!c) return;

    document.title = `${c.title} - LMS | Ragenaizer`;
    document.getElementById('courseTitle').textContent = c.title || 'Untitled';
    document.getElementById('breadcrumbTitle').textContent = c.title || 'Course';

    const difficulty = (c.difficultyLevel || 'beginner');
    const instructor = c.instructorName || '';
    const subtitle = [difficulty.charAt(0).toUpperCase() + difficulty.slice(1), instructor].filter(Boolean).join(' · ');
    document.getElementById('courseSubtitle').textContent = subtitle;
}

// ─── Stats ─────────────────────────────────────────────────────────────────

function renderStats() {
    const c = courseData;
    if (!c) return;

    const diff = (c.difficultyLevel || 'beginner');
    document.getElementById('statDifficulty').textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
    document.getElementById('statLessons').textContent = c.lessonCount || 0;

    const mins = c.estimatedDurationMinutes || 0;
    document.getElementById('statDuration').textContent = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
    document.getElementById('statEnrolled').textContent = c.enrollmentCount || 0;
}

// ─── Enrollment Actions ────────────────────────────────────────────────────

function renderEnrollmentActions() {
    const el = document.getElementById('courseActions');
    if (!el) return;

    if (courseData.enrollmentStatus === 'active') {
        const pct = courseData.userProgress || 0;
        el.innerHTML = `
            <span style="font-size:0.8rem;color:var(--text-secondary);margin-right:8px">${Math.round(pct)}% complete</span>
            <button class="btn-enroll" onclick="handleContinue()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Continue
            </button>
        `;
    } else if (courseData.enrollmentStatus === 'completed') {
        el.innerHTML = `<span class="lms-badge completed">Completed</span>`;
    } else {
        el.innerHTML = `
            <button class="btn-enroll" onclick="handleEnroll()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Enroll Now
            </button>
        `;
    }
}

async function handleEnroll() {
    try {
        await api.request('/lms/enrollments', {
            method: 'POST',
            body: JSON.stringify({ courseId: courseId })
        });
        showToast('Enrolled successfully!', 'success');
        courseData.enrollmentStatus = 'active';
        courseData.userProgress = 0;
        renderEnrollmentActions();
    } catch (error) {
        console.error('Enrollment failed:', error);
        showToast(error.message || 'Failed to enroll', 'error');
    }
}

function handleContinue() {
    if (modulesData.length > 0 && modulesData[0].lessons && modulesData[0].lessons.length > 0) {
        window.location.href = `lesson-viewer.html?courseId=${courseId}&lessonId=${modulesData[0].lessons[0].id}`;
    } else {
        showToast('No lessons available yet', 'warning');
    }
}

// ─── Overview ──────────────────────────────────────────────────────────────

function renderOverview() {
    const c = courseData;
    if (!c) return;

    document.getElementById('courseDescription').innerHTML = c.description
        ? escapeHtml(c.description).replace(/\n/g, '<br>')
        : '<em style="color:var(--text-muted)">No description provided.</em>';

    document.getElementById('courseInstructor').textContent = c.instructorName || 'Not assigned';

    // Prerequisites - show from data if available, otherwise "None"
    const prereqs = c.prerequisites || [];
    if (prereqs.length > 0) {
        document.getElementById('coursePrerequisites').innerHTML = prereqs
            .map(p => `<a href="course-detail.html?id=${p.prerequisiteCourseId}" style="color:var(--brand-primary)">${escapeHtml(p.courseTitle || 'Course')}</a>`)
            .join(', ');
    } else {
        document.getElementById('coursePrerequisites').textContent = 'None';
    }
}

// ─── Modules ───────────────────────────────────────────────────────────────

async function loadModules() {
    try {
        const response = await api.request(`/lms/courses/${courseId}/modules?includeLessons=true`);
        modulesData = Array.isArray(response) ? response : (response.modules || []);
        renderModules();
    } catch (error) {
        console.error('Error loading modules:', error);
        document.getElementById('modulesList').innerHTML = '<div class="glass-card" style="text-align:center;padding:30px;color:var(--text-secondary)"><p style="margin:0">Failed to load modules.</p></div>';
    }
}

function renderModules() {
    const container = document.getElementById('modulesList');
    if (!modulesData || modulesData.length === 0) {
        container.innerHTML = '<div class="glass-card" style="text-align:center;padding:30px;color:var(--text-secondary)"><p style="margin:0">No modules available for this course.</p></div>';
        return;
    }

    container.innerHTML = modulesData.map((mod, idx) => {
        const lessons = mod.lessons || [];
        return `
            <div class="glass-card" style="margin-bottom:10px;padding:0;overflow:hidden">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;cursor:pointer" onclick="toggleModule('${mod.id}')">
                    <div style="display:flex;align-items:center;gap:10px">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" id="arrow-${mod.id}" style="transition:transform 0.2s"><polyline points="6 9 12 15 18 9"/></svg>
                        <span style="font-size:0.7rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Module ${idx + 1}</span>
                        <span style="font-size:0.85rem;font-weight:600;color:var(--text-primary)">${escapeHtml(mod.title)}</span>
                    </div>
                    <span style="font-size:0.72rem;color:var(--text-secondary)">${lessons.length} lesson${lessons.length !== 1 ? 's' : ''}</span>
                </div>
                <div id="moduleBody-${mod.id}" style="display:none;border-top:1px solid var(--border-color-light)">
                    ${lessons.length === 0
                        ? '<p style="padding:12px 16px;margin:0;color:var(--text-muted);font-size:0.8rem">No lessons in this module.</p>'
                        : lessons.map(lesson => `
                            <a href="lesson-viewer.html?courseId=${courseId}&lessonId=${lesson.id}" style="display:flex;align-items:center;gap:10px;padding:10px 16px;text-decoration:none;color:var(--text-primary);border-bottom:1px solid var(--border-color-light);transition:background 0.2s" onmouseover="this.style.background='rgba(var(--brand-primary-rgb),0.04)'" onmouseout="this.style.background='transparent'">
                                <span style="color:var(--text-secondary)">${getLessonIcon(lesson.contentType)}</span>
                                <span style="flex:1;font-size:0.82rem">${escapeHtml(lesson.title)}</span>
                                <span style="font-size:0.72rem;color:var(--text-muted)">${lesson.durationMinutes ? lesson.durationMinutes + 'min' : ''}</span>
                            </a>
                        `).join('')
                    }
                </div>
            </div>
        `;
    }).join('');
}

function getLessonIcon(type) {
    const icons = {
        video: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        document: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        quiz: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/></svg>',
    };
    return icons[type] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
}

function toggleModule(moduleId) {
    const body = document.getElementById(`moduleBody-${moduleId}`);
    const arrow = document.getElementById(`arrow-${moduleId}`);
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// ─── Reviews ───────────────────────────────────────────────────────────────

async function loadReviews() {
    try {
        const response = await api.request(`/lms/reviews/course/${courseId}`);
        reviewsData = Array.isArray(response) ? response : [];
        renderReviews();
    } catch (error) {
        console.error('Error loading reviews:', error);
    }
}

function renderReviews() {
    document.getElementById('reviewsAvgValue').textContent = (courseData?.averageRating || 0).toFixed(1);
    document.getElementById('reviewsTotal').textContent = `${reviewsData.length} review${reviewsData.length !== 1 ? 's' : ''}`;

    const listEl = document.getElementById('reviewsList');
    if (reviewsData.length === 0) {
        listEl.innerHTML = '<p style="text-align:center;color:var(--text-secondary);font-size:0.85rem">No reviews yet. Be the first to review!</p>';
        return;
    }

    listEl.innerHTML = reviewsData.map(r => `
        <div style="padding:12px 0;border-bottom:1px solid var(--border-color-light)">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary)">${escapeHtml(r.userName || 'Anonymous')}</span>
                <span style="font-size:0.72rem;color:var(--text-muted)">${formatDate(r.createdAt)}</span>
            </div>
            <div style="color:var(--color-warning);margin-bottom:4px">${renderStars(r.rating || 0)}</div>
            <p style="font-size:0.82rem;color:var(--text-secondary);margin:0;line-height:1.5">${escapeHtml(r.reviewText || '')}</p>
        </div>
    `).join('');
}

function renderStars(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
        const color = i <= Math.round(rating) ? 'var(--color-warning)' : 'var(--text-tertiary, #555)';
        html += `<svg width="13" height="13" viewBox="0 0 24 24" fill="${color}" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    }
    return html;
}

// ─── Discussions ───────────────────────────────────────────────────────────

async function loadDiscussions() {
    try {
        const response = await api.request(`/lms/discussions/course/${courseId}`);
        discussionsData = Array.isArray(response) ? response : [];
        renderDiscussions();
    } catch (error) {
        console.error('Error loading discussions:', error);
    }
}

function renderDiscussions() {
    const listEl = document.getElementById('discussionsList');
    if (discussionsData.length === 0) {
        listEl.innerHTML = '<div class="glass-card" style="text-align:center;padding:30px;color:var(--text-secondary)"><p style="margin:0;font-size:0.85rem">No discussions yet. Start the conversation!</p></div>';
        return;
    }

    listEl.innerHTML = discussionsData.map(d => `
        <div class="glass-card" style="margin-bottom:8px;cursor:pointer" onclick="window.location.href='discussions.html?courseId=${courseId}'">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary)">${escapeHtml(d.title)}</span>
                <span style="font-size:0.72rem;color:var(--text-muted)">${formatDate(d.createdAt)}</span>
            </div>
            <p style="font-size:0.8rem;color:var(--text-secondary);margin:0">${escapeHtml((d.body || '').substring(0, 120))}${(d.body || '').length > 120 ? '...' : ''}</p>
            <span style="font-size:0.72rem;color:var(--text-muted);margin-top:6px;display:block">${d.replyCount || 0} replies</span>
        </div>
    `).join('');
}

function openNewDiscussion() {
    window.location.href = `discussions.html?courseId=${courseId}`;
}
