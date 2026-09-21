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
            const authoringTab = document.createElement('button');
            authoringTab.className = 'lms-tab';
            authoringTab.dataset.tab = 'authoring';
            authoringTab.textContent = 'Manage';
            authoringTab.onclick = () => switchTab('authoring');
            document.getElementById('assignmentTabs').appendChild(authoringTab);

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
    const authoringPanel = document.getElementById('assignmentAuthoringPanel');
    const peerPanel = document.getElementById('myPeerReviewsPanel');
    // By id, not by class. document.querySelector('.glass-card') returned whichever
    // card happened to come first in the markup, and the detail view carries that class
    // too — so this was one reordering away from hiding the wrong panel.
    const listCard = document.getElementById('assignmentListCard');

    // Every panel off, then exactly one on. Toggling them individually is how a
    // third tab ends up showing two panels at once.
    [gradingPanel, authoringPanel, peerPanel].forEach(p => { if (p) p.style.display = 'none'; });
    if (listCard) listCard.style.display = 'none';

    if (tab === 'grading') {
        if (gradingPanel) gradingPanel.style.display = '';
        loadGradingSubmissions();
    } else if (tab === 'authoring') {
        if (authoringPanel) authoringPanel.style.display = '';
        if (!aaLoaded) loadAssignmentAuthoring();
    } else if (tab === 'peer-reviews') {
        if (peerPanel) peerPanel.style.display = '';
        if (!aaMyReviewsLoaded) loadMyPeerReviews();
    } else {
        if (listCard) listCard.style.display = '';
        renderAssignmentList();
    }
}

// ==================== Load Assignments ====================

async function loadAssignments() {
    try {
        // ONE call. This used to ask GET /lms/courses/{id}/assignments once per enrolled
        // course — a route that has never existed. It answered 404, the catch below swallowed
        // it as "no assignments", and so the Pending, Submitted and Graded tabs were empty for
        // every learner since this page was written. It also passed the ENROLMENT id where a
        // course id belongs, so it asked the wrong question as well as the wrong route.
        const rows = await api.request('/lms/assignments/my');

        // Mapped once, here, into the names the list and the detail view already read. Those
        // renderers expected snake_case and a _submission shaped like {text, files, grade},
        // none of which the API has ever returned — so the grade line rendered "undefined / 20"
        // and the submitted text rendered "No text submitted." even when both existed.
        allAssignments = (Array.isArray(rows) ? rows : []).map(r => ({
            id: r.id,
            title: r.title,
            description: r.description,
            instructions: r.instructions,
            max_score: r.maxScore,
            due_date: r.dueDate,
            allow_late: r.allowLate,
            course_id: r.courseId,
            course_title: r.courseTitle,
            lesson_title: r.lessonTitle,
            _status: r.status,
            _submission: r.submissionId ? {
                id: r.submissionId,
                text: r.submissionText,
                grade: r.score,
                feedback: r.feedback,
                submitted_at: r.submittedAt,
                graded_at: r.gradedAt,
                // file_urls is a plain array of URLs; the renderer wants something with a name.
                files: (r.fileUrls || []).map(u => ({ name: String(u).split('/').pop(), url: u }))
            } : null
        }));

        renderAssignmentList();
    } catch (err) {
        console.error('Failed to load assignments:', err);
        document.getElementById('assignmentLoading').innerHTML =
            '<p style="color: var(--color-error);">Failed to load assignments.</p>';
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

    renderPeerFeedback(assignment);

    // Reset file selection
    selectedFiles = [];
    document.getElementById('fileList').innerHTML = '';
    document.getElementById('submissionText').value = '';

    // The WRAPPER, not the inner list. Hiding only the inner list left the card's
    // padding behind as an empty bar floating above the assignment detail.
    document.getElementById('assignmentListCard').style.display = 'none';
    document.getElementById('assignmentTabs').style.display = 'none';
    document.getElementById('assignmentDetail').style.display = '';
}

/**
 * Peer feedback on the learner's OWN submission.
 *
 * Until this existed the loop was open at the end: an instructor could assign a reviewer, the
 * reviewer could read the work and write a considered response, and the person it was written
 * for never saw a word of it. The whole point of peer review is the last hop.
 *
 * Reviewers are not named. Peer review is conventionally blind to the author, and the endpoint
 * returns an opaque user id anyway — printing that would be worse than useless.
 */
async function renderPeerFeedback(assignment) {
    const block = document.getElementById('peerFeedbackBlock');
    const list = document.getElementById('peerFeedbackList');
    if (!block || !list) return;

    const submissionId = assignment._submission && assignment._submission.id;
    if (!submissionId) { block.style.display = 'none'; return; }

    try {
        const rows = await api.request(`/lms/learning/submissions/${submissionId}/peer-reviews`);
        // Only COMPLETED reviews are shown. An assigned-but-unwritten review is not feedback,
        // and rendering it as an empty card reads as a reviewer who had nothing to say.
        const done = (Array.isArray(rows) ? rows : []).filter(r => r.status === 'completed');

        if (done.length === 0) { block.style.display = 'none'; return; }

        block.style.display = '';
        list.innerHTML = done.map((r, i) => `
            <div style="background: var(--bg-tertiary); border-radius: var(--radius-md); padding: var(--space-4); margin-bottom: var(--space-2);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: var(--space-2);">
                    <span style="color: var(--text-muted); font-size: var(--font-size-sm);">Reviewer ${i + 1}</span>
                    ${r.score !== null && r.score !== undefined
                        ? `<span style="color: var(--text-primary); font-weight: var(--font-weight-medium);">${r.score} / ${assignment.max_score || 100}</span>`
                        : ''}
                </div>
                <p style="color: var(--text-secondary); margin: 0;">${escapeHtml(r.feedback || 'No written feedback.')}</p>
            </div>`).join('');
    } catch (e) {
        // A learner who cannot read the reviews is not an error worth shouting about on the
        // page — the grade above is the part they came for.
        block.style.display = 'none';
    }
}

function backToList() {
    document.getElementById('assignmentDetail').style.display = 'none';
    document.getElementById('assignmentListCard').style.display = '';
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

    const btn = document.querySelector('#submissionForm button');
    const originalLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
        // JSON, not multipart. This used to POST a FormData of {text, files} and the
        // endpoint answered 415 every time: it takes a JSON body of
        // {submissionText, fileUrls}, and LMS stores no files of its own — an attachment
        // is a Drive object referenced by URL. So submitting an assignment had never
        // worked, for anyone, by any route through this page.
        const fileUrls = [];
        for (const f of selectedFiles) {
            const result = await api.uploadDriveFileDirect(f);
            // Drive has answered with several spellings over time; take the first that
            // is actually present rather than assuming one and silently storing undefined.
            const url = result.url || result.fileUrl || result.file_url
                     || result.s3_key || result.s3Key || result.key;
            if (!url) throw new Error(`Drive accepted "${f.name}" but returned no reference to it.`);
            fileUrls.push(url);
        }

        await api.request(`/lms/assignments/${currentAssignment.id}/submit`, {
            method: 'POST',
            body: JSON.stringify({
                submissionText: text || null,
                fileUrls: fileUrls.length ? fileUrls : null
            })
        });

        if (typeof showToast === 'function') showToast('Assignment submitted successfully!', 'success');

        selectedFiles = [];
        backToList();
        await loadAssignments();
    } catch (err) {
        console.error('Failed to submit assignment:', err);
        if (typeof showToast === 'function') showToast('Failed to submit: ' + (err.message || 'Unknown error'), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
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

        // Assignments come from the tenant-wide list, not from a per-course route. The
        // per-course route this used to call (/lms/courses/{id}/assignments) does not exist,
        // so the catch below swallowed a 404 for every course and this table was always empty
        // — instructors could never grade an assignment from the UI at all.
        allSubmissions = [];
        const assignments = await api.request('/lms/assignments');

        for (const assignment of (Array.isArray(assignments) ? assignments : [])) {
            try {
                const subs = await api.request(`/lms/assignments/${assignment.id}/submissions`);
                const subList = Array.isArray(subs) ? subs : (subs.submissions || []);
                subList.forEach(s => {
                    s._assignmentTitle = assignment.title;
                    s._courseTitle = assignment.courseTitle;
                    s._courseId = assignment.courseId;
                    s._maxScore = assignment.maxScore ?? 100;
                });
                allSubmissions.push(...subList);
            } catch { /* no submissions on this assignment */ }
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
                    <button class="btn btn-sm btn-outline-secondary" onclick="openPeerReviewAssign('${s.id}', '${s._courseId}', '${escapeHtml(s.userId || s.user_id || '')}')" title="Peer review">Peer</button>
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
        // Refresh BOTH lists. The learner-facing list is held in memory from page load,
        // so refreshing only the grading table left the Graded tab empty immediately
        // after grading — the mark was saved, and the screen said it had not been.
        await Promise.all([loadGradingSubmissions(), loadAssignments()]);
    } catch (err) {
        console.error('Grading failed:', err);
        showToast(err.message || 'Failed to grade submission', 'error');
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
