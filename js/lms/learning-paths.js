/**
 * LMS Learning Paths
 * Browse learning paths, view details with course sequence, enroll.
 */

// ==================== State ====================
let allPaths = [];
let currentPath = null;
let currentPathDetail = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('lms', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Check if a path ID is in the URL
    const params = new URLSearchParams(window.location.search);
    const pathId = params.get('id');

    if (pathId) {
        showPathDetail(pathId);
    } else {
        loadPaths();
    }
});

// ==================== Load Paths ====================

async function loadPaths() {
    try {
        const response = await api.request('/lms/learning-paths');
        allPaths = response.data || response || [];
        renderPathCards();
    } catch (err) {
        console.error('Failed to load learning paths:', err);
        document.getElementById('pathGrid').innerHTML =
            '<div class="lms-empty-state"><p style="color:var(--color-error);">Failed to load learning paths.</p></div>';
    }
}

// ==================== Render Path Cards ====================

function renderPathCards() {
    const container = document.getElementById('pathGrid');

    if (allPaths.length === 0) {
        container.innerHTML = `
            <div class="lms-empty-state" style="grid-column: 1 / -1;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                <h3 style="margin-top: var(--space-3);">No Learning Paths Available</h3>
                <p>Check back later for curated learning paths.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = allPaths.map(path => {
        const courseCount = path.course_count || path.courses?.length || 0;
        const difficulty = path.difficulty || path.level || 'all';
        const progress = path.progress_percentage ?? path.progress ?? null;
        const isEnrolled = progress != null;
        const thumbnail = path.thumbnail_url || path.image_url || '';

        return `
            <div class="lms-course-card" onclick="showPathDetail('${path.id}')" style="cursor: pointer;">
                <!-- Thumbnail -->
                <div style="height: 140px; background: var(--bg-tertiary); overflow: hidden; position: relative;">
                    ${thumbnail
                        ? `<img src="${thumbnail}" alt="${path.title}" style="width:100%;height:100%;object-fit:cover;">`
                        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
                               <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
                                   <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                               </svg>
                           </div>`
                    }
                    <span class="lms-difficulty-badge" style="position:absolute;top:var(--space-2);right:var(--space-2);">${difficulty}</span>
                </div>

                <!-- Card Body -->
                <div style="padding: var(--space-4);">
                    <h4 style="color: var(--text-primary); margin: 0 0 var(--space-2) 0; font-size: var(--font-size-base);">
                        ${path.title || 'Untitled Path'}
                    </h4>
                    <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin-bottom: var(--space-3);
                              display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                        ${path.description || ''}
                    </p>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: var(--text-muted); font-size: var(--font-size-sm);">
                            ${courseCount} course${courseCount !== 1 ? 's' : ''}
                        </span>
                        ${path.estimated_duration ? `<span style="color:var(--text-muted);font-size:var(--font-size-sm);">${path.estimated_duration}</span>` : ''}
                    </div>

                    ${isEnrolled ? `
                        <div style="margin-top: var(--space-3);">
                            <div class="lms-progress-bar" style="margin-bottom: var(--space-1);">
                                <div class="lms-progress-fill" style="width: ${Math.round(progress)}%;"></div>
                            </div>
                            <span class="lms-progress-label">${Math.round(progress)}% complete</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ==================== Path Detail ====================

async function showPathDetail(pathId) {
    // Hide list, show detail
    document.getElementById('pathGrid').style.display = 'none';
    document.getElementById('pathListHeader').style.display = 'none';
    document.getElementById('pathDetail').style.display = '';
    document.getElementById('pathBreadcrumb').textContent = 'Loading...';

    try {
        const data = await api.request(`/lms/learning-paths/${pathId}`);
        currentPathDetail = data;

        document.getElementById('pathBreadcrumb').textContent = data.title || 'Learning Path';
        document.getElementById('pathTitle').textContent = data.title || 'Learning Path';
        document.getElementById('pathDescription').textContent = data.description || '';
        document.getElementById('pathDifficulty').textContent = data.difficulty || data.level || 'All Levels';
        document.getElementById('pathCourseCount').textContent =
            `${data.courses?.length || data.course_count || 0} courses`;
        document.getElementById('pathDuration').textContent = data.estimated_duration || '';

        // Thumbnail
        const thumbImg = document.getElementById('pathThumbnail');
        const thumbPlaceholder = document.getElementById('pathThumbnailPlaceholder');
        if (data.thumbnail_url || data.image_url) {
            thumbImg.src = data.thumbnail_url || data.image_url;
            thumbImg.style.display = '';
            thumbPlaceholder.style.display = 'none';
        } else {
            thumbImg.style.display = 'none';
            thumbPlaceholder.style.display = '';
        }

        // Progress
        const progress = data.progress_percentage ?? data.progress ?? null;
        const isEnrolled = data.is_enrolled || progress != null;
        const progressSection = document.getElementById('pathProgressSection');
        const enrollSection = document.getElementById('pathEnrollSection');

        if (isEnrolled) {
            progressSection.style.display = '';
            document.getElementById('pathProgressPct').textContent = Math.round(progress || 0) + '%';
            document.getElementById('pathProgressFill').style.width = Math.round(progress || 0) + '%';
            enrollSection.innerHTML = '<span class="lms-badge badge-success">Enrolled</span>';
        } else {
            progressSection.style.display = 'none';
            enrollSection.innerHTML = '<button class="btn btn-primary" id="enrollBtn" onclick="enrollInPath()">Enroll in Path</button>';
        }

        // Course sequence
        renderCourseSequence(data.courses || []);

        // Admin/Instructor: show enrolled users
        if (typeof lmsRoles !== 'undefined') {
            lmsRoles.init();
            if (lmsRoles.isInstructor()) {
                loadPathEnrollments(pathId);
            }
        }

        // Update URL without reload
        const url = new URL(window.location);
        url.searchParams.set('id', pathId);
        window.history.pushState({}, '', url);
    } catch (err) {
        console.error('Failed to load path detail:', err);
        document.getElementById('pathBreadcrumb').textContent = 'Error';
        document.getElementById('courseSequence').innerHTML =
            '<div class="lms-empty-state"><p style="color:var(--color-error);">Failed to load learning path details.</p></div>';
    }
}

function renderCourseSequence(courses) {
    const container = document.getElementById('courseSequence');

    if (!courses || courses.length === 0) {
        container.innerHTML = '<div class="lms-empty-state"><p>No courses in this path yet.</p></div>';
        return;
    }

    container.innerHTML = courses.map((course, i) => {
        const isCompleted = course.is_completed || course.status === 'completed';
        const isInProgress = course.status === 'in_progress';
        const statusColor = isCompleted ? 'var(--color-success)' : isInProgress ? 'var(--brand-primary)' : 'var(--text-muted)';
        const statusIcon = isCompleted
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            : `<span style="width:28px;height:28px;border-radius:50%;border:2px solid ${statusColor};display:inline-flex;align-items:center;justify-content:center;font-size:var(--font-size-sm);font-weight:var(--font-weight-semibold);color:${statusColor};">${i + 1}</span>`;

        const courseLink = course.course_id || course.id
            ? `onclick="window.location.href='course-detail.html?id=${course.course_id || course.id}'" style="cursor:pointer;"`
            : '';

        return `
            <div class="lms-card" style="margin-bottom: var(--space-3); ${isCompleted ? 'opacity: 0.8;' : ''}" ${courseLink}>
                <div style="padding: var(--space-4); display: flex; align-items: center; gap: var(--space-4);">
                    <!-- Step Number / Check -->
                    <div style="flex-shrink: 0;">
                        ${statusIcon}
                    </div>

                    <!-- Course Info -->
                    <div style="flex: 1; min-width: 0;">
                        <h4 style="color: var(--text-primary); margin: 0 0 var(--space-1) 0; font-size: var(--font-size-base);">
                            ${course.title || course.course_title || 'Course'}
                        </h4>
                        <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin: 0;">
                            ${course.description ? course.description.substring(0, 100) + (course.description.length > 100 ? '...' : '') : ''}
                        </p>
                    </div>

                    <!-- Status -->
                    <div style="flex-shrink: 0;">
                        ${isCompleted
                            ? '<span class="lms-badge badge-success">Completed</span>'
                            : isInProgress
                                ? '<span class="lms-badge badge-info">In Progress</span>'
                                : '<span class="lms-badge badge-muted">Not Started</span>'
                        }
                    </div>

                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                </div>
            </div>

            ${i < courses.length - 1 ? `
                <div style="display:flex;justify-content:flex-start;padding-left:30px;margin-bottom:var(--space-3);">
                    <div style="width:2px;height:20px;background:${isCompleted ? 'var(--color-success)' : 'var(--border-primary)'};"></div>
                </div>
            ` : ''}
        `;
    }).join('');
}

// ==================== Enroll ====================

async function enrollInPath() {
    if (!currentPathDetail) return;

    const btn = document.getElementById('enrollBtn');
    if (btn) btn.disabled = true;

    try {
        await api.request(`/lms/learning-paths/${currentPathDetail.id}/enroll`, { method: 'POST' });
        if (typeof showToast === 'function') showToast('Enrolled in learning path!', 'success');

        // Refresh detail
        await showPathDetail(currentPathDetail.id);
    } catch (err) {
        console.error('Failed to enroll:', err);
        if (typeof showToast === 'function') showToast('Failed to enroll: ' + (err.message || 'Unknown error'), 'error');
        if (btn) btn.disabled = false;
    }
}

// ==================== Navigation ====================

function backToPathList() {
    document.getElementById('pathDetail').style.display = 'none';
    document.getElementById('pathGrid').style.display = '';
    document.getElementById('pathListHeader').style.display = '';
    document.getElementById('pathBreadcrumb').textContent = 'Learning Paths';
    currentPathDetail = null;

    // Clean URL
    const url = new URL(window.location);
    url.searchParams.delete('id');
    window.history.pushState({}, '', url);

    // Reload if we haven't loaded paths yet
    if (allPaths.length === 0) {
        loadPaths();
    }
}

// ==================== Admin: Path Enrollments ====================

async function loadPathEnrollments(pathId) {
    const section = document.getElementById('pathEnrollmentsSection');
    const tbody = document.getElementById('pathEnrollmentsBody');
    if (!section || !tbody) return;

    section.style.display = '';
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Loading enrollments...</td></tr>';

    try {
        const data = await api.request(`/lms/learning-paths/${pathId}/enrollments`);
        const enrollments = Array.isArray(data) ? data : (data.enrollments || []);

        if (enrollments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">No enrollments yet</td></tr>';
            return;
        }

        tbody.innerHTML = enrollments.map(e => {
            const progress = e.progressPct ?? e.progress_pct ?? 0;
            const status = e.status || 'active';
            const statusBadge = status === 'completed'
                ? '<span class="status-badge status-active">Completed</span>'
                : '<span class="status-badge status-pending">Active</span>';
            const enrolledDate = e.createdAt || e.created_at;
            const dateStr = enrolledDate ? new Date(enrolledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

            return `
                <tr>
                    <td>${escapeHtml(e.userName || e.user_name || e.userId || '-')}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div class="lms-progress-bar" style="width:80px;height:6px;">
                                <div class="lms-progress-fill" style="width:${Math.round(progress)}%"></div>
                            </div>
                            <span style="font-size:0.75rem;color:var(--text-secondary)">${Math.round(progress)}%</span>
                        </div>
                    </td>
                    <td>${dateStr}</td>
                </tr>`;
        }).join('');
    } catch (err) {
        console.error('Error loading path enrollments:', err);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Error loading enrollments</td></tr>';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Handle browser back
window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const pathId = params.get('id');
    if (pathId) {
        showPathDetail(pathId);
    } else {
        backToPathList();
    }
});
