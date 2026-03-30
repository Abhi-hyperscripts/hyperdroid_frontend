/**
 * LMS Assignments
 * Lists assignments across enrolled courses, view details, submit, view grades.
 */

// ==================== State ====================
let allAssignments = [];
let currentTab = 'pending';
let currentAssignment = null;
let selectedFiles = [];

// ==================== Initialization ====================

let isInstructor = false;
let allSubmissions = [];
let gradingCourseFilter = '';

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('lms', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Check if instructor/admin — show grading tab
    if (typeof lmsRoles !== 'undefined') {
        lmsRoles.init();
        isInstructor = lmsRoles.isInstructor();
    }

    if (isInstructor) {
        // Add "Grading" tab
        const tabs = document.getElementById('assignmentTabs');
        if (tabs) {
            const gradingTab = document.createElement('button');
            gradingTab.className = 'lms-tab';
            gradingTab.dataset.tab = 'grading';
            gradingTab.textContent = 'Grading';
            gradingTab.onclick = () => switchTab('grading');
            tabs.appendChild(gradingTab);
        }
    }

    loadAssignments();
});

// ==================== Tabs ====================

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#assignmentTabs .lms-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const gradingPanel = document.getElementById('instructorGradingPanel');
    const listCard = document.querySelector('.glass-card');

    if (tab === 'grading') {
        if (gradingPanel) gradingPanel.style.display = '';
        if (listCard) listCard.style.display = 'none';
        loadGradingSubmissions();
    } else {
        if (gradingPanel) gradingPanel.style.display = 'none';
        if (listCard) listCard.style.display = '';
        renderAssignmentList();
    }
}

// ==================== Load Assignments ====================

async function loadAssignments() {
    try {
        // Get enrolled courses first
        const enrollments = await api.request('/lms/enrollments/my');
        const courses = enrollments.data || enrollments || [];

        // Fetch assignments for each enrolled course
        const assignmentPromises = courses.map(async (course) => {
            try {
                const courseId = course.course_id || course.id;
                const resp = await api.request(`/lms/courses/${courseId}/assignments`);
                const items = resp.data || resp || [];
                return items.map(a => ({ ...a, course_title: course.course_title || course.title }));
            } catch {
                return [];
            }
        });

        const results = await Promise.all(assignmentPromises);
        allAssignments = results.flat();

        // Fetch submission status for each assignment
        await loadSubmissionStatuses();

        renderAssignmentList();
    } catch (err) {
        console.error('Failed to load assignments:', err);
        document.getElementById('assignmentLoading').innerHTML =
            '<p style="color: var(--color-error);">Failed to load assignments.</p>';
    }
}

async function loadSubmissionStatuses() {
    const promises = allAssignments.map(async (assignment) => {
        try {
            const sub = await getMySubmission(assignment.id);
            assignment._submission = sub;
            if (sub && sub.grade != null) {
                assignment._status = 'graded';
            } else if (sub && sub.submitted_at) {
                assignment._status = 'submitted';
            } else {
                assignment._status = 'pending';
            }
        } catch {
            assignment._status = 'pending';
            assignment._submission = null;
        }
    });
    await Promise.all(promises);
}

async function getMySubmission(assignmentId) {
    try {
        return await api.request(`/lms/assignments/${assignmentId}/my-submission`);
    } catch {
        return null;
    }
}

// ==================== Render List ====================

function renderAssignmentList() {
    const container = document.getElementById('assignmentList');
    const filtered = allAssignments.filter(a => a._status === currentTab);

    if (filtered.length === 0) {
        const messages = {
            pending: 'No pending assignments.',
            submitted: 'No submitted assignments.',
            graded: 'No graded assignments yet.'
        };
        container.innerHTML = `<div class="lms-empty-state"><p>${messages[currentTab]}</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(a => {
        const dueDate = a.due_date ? new Date(a.due_date).toLocaleDateString() : 'No deadline';
        const isOverdue = a.due_date && new Date(a.due_date) < new Date() && a._status === 'pending';
        const gradeText = a._submission && a._submission.grade != null
            ? `${a._submission.grade} / ${a.max_score || 100}`
            : '';

        return `
            <div class="lms-card" style="margin-bottom: var(--space-3); cursor: pointer; transition: border-color var(--transition-fast);"
                 onclick="showAssignmentDetail('${a.id}')">
                <div style="padding: var(--space-4); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3);">
                    <div style="flex: 1; min-width: 200px;">
                        <h4 style="color: var(--text-primary); margin: 0 0 var(--space-1) 0;">${a.title || 'Untitled Assignment'}</h4>
                        <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin: 0;">
                            ${a.course_title || ''}
                        </p>
                    </div>
                    <div style="display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap;">
                        <span style="color: ${isOverdue ? 'var(--color-error)' : 'var(--text-muted)'}; font-size: var(--font-size-sm);">
                            ${isOverdue ? 'Overdue - ' : ''}${dueDate}
                        </span>
                        ${gradeText ? `<span class="lms-badge badge-success">${gradeText}</span>` : ''}
                        ${a._status === 'submitted' ? '<span class="lms-badge badge-info">Submitted</span>' : ''}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ==================== Assignment Detail ====================

function showAssignmentDetail(id) {
    const assignment = allAssignments.find(a => a.id === id);
    if (!assignment) return;

    currentAssignment = assignment;

    document.getElementById('detailTitle').textContent = assignment.title || 'Assignment';
    document.getElementById('detailCourse').textContent = assignment.course_title || '-';
    document.getElementById('detailDueDate').textContent = assignment.due_date
        ? new Date(assignment.due_date).toLocaleDateString()
        : 'No deadline';
    document.getElementById('detailMaxScore').textContent = assignment.max_score || '-';
    document.getElementById('detailInstructions').innerHTML = assignment.instructions || assignment.description || '<em>No instructions provided.</em>';

    // Status badge
    const statusEl = document.getElementById('detailStatus');
    if (assignment._status === 'graded') {
        statusEl.className = 'lms-badge badge-success';
        statusEl.textContent = 'Graded';
    } else if (assignment._status === 'submitted') {
        statusEl.className = 'lms-badge badge-info';
        statusEl.textContent = 'Submitted';
    } else {
        statusEl.className = 'lms-badge badge-warning';
        statusEl.textContent = 'Pending';
    }

    // Show/hide sections based on status
    const showForm = assignment._status === 'pending';
    const showSubmitted = assignment._status === 'submitted' || assignment._status === 'graded';
    const showGrade = assignment._status === 'graded';

    document.getElementById('submissionForm').style.display = showForm ? '' : 'none';
    document.getElementById('submittedView').style.display = showSubmitted ? '' : 'none';
    document.getElementById('gradeDisplay').style.display = showGrade ? '' : 'none';

    if (showSubmitted && assignment._submission) {
        document.getElementById('submittedText').textContent = assignment._submission.text || 'No text submitted.';
        renderSubmittedFiles(assignment._submission.files || []);
    }

    if (showGrade && assignment._submission) {
        document.getElementById('gradeScore').textContent =
            `${assignment._submission.grade} / ${assignment.max_score || 100}`;
        document.getElementById('gradeFeedback').textContent =
            assignment._submission.feedback || 'No feedback provided.';
    }

    // Reset file selection
    selectedFiles = [];
    document.getElementById('fileList').innerHTML = '';
    document.getElementById('submissionText').value = '';

    document.getElementById('assignmentList').style.display = 'none';
    document.getElementById('assignmentTabs').style.display = 'none';
    document.getElementById('assignmentDetail').style.display = '';
}

function backToList() {
    document.getElementById('assignmentDetail').style.display = 'none';
    document.getElementById('assignmentList').style.display = '';
    document.getElementById('assignmentTabs').style.display = '';
    currentAssignment = null;
}

function renderSubmittedFiles(files) {
    const container = document.getElementById('submittedFiles');
    if (!files || files.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = '<p style="color:var(--text-muted);font-size:var(--font-size-sm);margin-bottom:var(--space-2);">Attached Files:</p>' +
        files.map(f => `
            <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);background:var(--bg-secondary);border-radius:var(--radius-sm);margin-bottom:var(--space-1);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                <span style="color:var(--text-secondary);font-size:var(--font-size-sm);">${f.name || f.file_name || 'File'}</span>
            </div>
        `).join('');
}

// ==================== File Handling ====================

function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    files.forEach(f => selectedFiles.push(f));
    renderSelectedFiles();
}

function handleFileDrop(event) {
    event.preventDefault();
    event.currentTarget.style.borderColor = 'var(--border-primary)';
    const files = Array.from(event.dataTransfer.files);
    files.forEach(f => selectedFiles.push(f));
    renderSelectedFiles();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderSelectedFiles();
}

function renderSelectedFiles() {
    const container = document.getElementById('fileList');
    if (selectedFiles.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = selectedFiles.map((f, i) => `
        <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);background:var(--bg-tertiary);border-radius:var(--radius-sm);margin-bottom:var(--space-1);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
            <span style="color:var(--text-secondary);font-size:var(--font-size-sm);flex:1;">${f.name}</span>
            <button onclick="removeFile(${i})" style="background:none;border:none;color:var(--color-error);cursor:pointer;padding:2px;">&times;</button>
        </div>
    `).join('');
}

// ==================== Submit Assignment ====================

async function submitAssignment() {
    if (!currentAssignment) return;

    const text = document.getElementById('submissionText').value.trim();
    if (!text && selectedFiles.length === 0) {
        if (typeof showToast === 'function') showToast('Please enter text or attach files.', 'warning');
        return;
    }

    try {
        const formData = new FormData();
        if (text) formData.append('text', text);
        selectedFiles.forEach(f => formData.append('files', f));

        await api.request(`/lms/assignments/${currentAssignment.id}/submit`, {
            method: 'POST',
            body: formData,
            skipContentType: true
        });

        if (typeof showToast === 'function') showToast('Assignment submitted successfully!', 'success');

        // Refresh
        backToList();
        await loadAssignments();
    } catch (err) {
        console.error('Failed to submit assignment:', err);
        if (typeof showToast === 'function') showToast('Failed to submit: ' + (err.message || 'Unknown error'), 'error');
    }
}

// ==================== Instructor Grading ====================

async function loadGradingSubmissions() {
    const tbody = document.getElementById('gradingTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading submissions...</td></tr>';

    try {
        // Get all courses (instructor's)
        const coursesResp = await api.request('/lms/courses');
        const courses = coursesResp.courses || coursesResp || [];

        // Populate course filter
        const filterEl = document.getElementById('gradingCourseFilter');
        if (filterEl && filterEl.options.length <= 1) {
            courses.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.title;
                filterEl.appendChild(opt);
            });
        }

        // For each course, get assignments then submissions
        allSubmissions = [];
        for (const course of courses) {
            try {
                const assignmentsResp = await api.request(`/lms/courses/${course.id}/assignments`);
                const assignments = assignmentsResp.data || assignmentsResp || [];

                for (const assignment of assignments) {
                    try {
                        const subs = await api.request(`/lms/assignments/${assignment.id}/submissions`);
                        const subList = Array.isArray(subs) ? subs : (subs.submissions || []);
                        subList.forEach(s => {
                            s._assignmentTitle = assignment.title;
                            s._courseTitle = course.title;
                            s._courseId = course.id;
                            s._maxScore = assignment.max_score || 100;
                        });
                        allSubmissions.push(...subList);
                    } catch { /* no submissions */ }
                }
            } catch { /* no assignments for this course */ }
        }

        renderGradingTable();
    } catch (err) {
        console.error('Error loading grading data:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error loading submissions</td></tr>';
    }
}

function filterGradingCourse() {
    gradingCourseFilter = document.getElementById('gradingCourseFilter').value;
    renderGradingTable();
}

function renderGradingTable() {
    const tbody = document.getElementById('gradingTableBody');
    if (!tbody) return;

    let filtered = allSubmissions;
    if (gradingCourseFilter) {
        filtered = filtered.filter(s => s._courseId === gradingCourseFilter);
    }

    // Sort: ungraded first, then by submission date desc
    filtered.sort((a, b) => {
        if (a.status === 'submitted' && b.status !== 'submitted') return -1;
        if (b.status === 'submitted' && a.status !== 'submitted') return 1;
        return new Date(b.submittedAt || b.submitted_at) - new Date(a.submittedAt || a.submitted_at);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No submissions found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(s => {
        const submittedDate = s.submittedAt || s.submitted_at;
        const dateStr = submittedDate ? new Date(submittedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-';
        const isGraded = s.status === 'graded' || s.score != null;
        const statusBadge = isGraded
            ? '<span class="status-badge status-active">Graded</span>'
            : '<span class="status-badge status-pending">Pending</span>';
        const scoreText = s.score != null ? `${s.score}/${s._maxScore}` : '-';
        const escapedName = escapeHtml(s.userName || s.user_name || 'Unknown');

        return `
            <tr>
                <td>${escapedName}</td>
                <td>${escapeHtml(s._assignmentTitle || '-')}</td>
                <td>${escapeHtml(s._courseTitle || '-')}</td>
                <td>${dateStr}</td>
                <td>${statusBadge}</td>
                <td>${scoreText}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="openGradeModal('${s.id}', '${s._maxScore}')" title="${isGraded ? 'Re-grade' : 'Grade'}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </td>
            </tr>`;
    }).join('');
}

function openGradeModal(submissionId, maxScore) {
    const sub = allSubmissions.find(s => s.id === submissionId);
    if (!sub) return;

    document.getElementById('gradeSubmissionId').value = submissionId;
    document.getElementById('gradeModalTitle').textContent = `Grade: ${sub._assignmentTitle || 'Assignment'}`;
    document.getElementById('gradeModalLearner').textContent = sub.userName || sub.user_name || 'Unknown';
    document.getElementById('gradeModalSubmissionText').textContent = sub.submissionText || sub.submission_text || 'No text submitted';
    document.getElementById('gradeModalMaxScore').textContent = `(out of ${maxScore})`;
    document.getElementById('gradeScoreInput').max = maxScore;
    document.getElementById('gradeScoreInput').value = sub.score != null ? sub.score : '';
    document.getElementById('gradeFeedbackInput').value = sub.feedback || '';
    document.getElementById('gradeModal').style.display = 'flex';
}

function closeGradeModal() {
    document.getElementById('gradeModal').style.display = 'none';
}

async function submitGrade() {
    const submissionId = document.getElementById('gradeSubmissionId').value;
    const score = parseFloat(document.getElementById('gradeScoreInput').value);
    const feedback = document.getElementById('gradeFeedbackInput').value.trim();

    if (isNaN(score) || score < 0) {
        showToast('Please enter a valid score', 'warning');
        return;
    }

    try {
        await api.request(`/lms/assignments/submissions/${submissionId}/grade`, {
            method: 'PUT',
            body: JSON.stringify({ score, feedback: feedback || null })
        });
        showToast('Submission graded successfully!', 'success');
        closeGradeModal();
        await loadGradingSubmissions();
    } catch (err) {
        console.error('Grading failed:', err);
        showToast(err.message || 'Failed to grade submission', 'error');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
