/**
 * Assignment authoring and peer review.
 *
 * Learners could submit and instructors could grade, but NOBODY could create an
 * assignment: POST/PUT/DELETE /api/assignments and GET /api/assignments/lesson/{id}
 * had no caller. And peer review could be assigned and written but never read back
 * on the submission it was about, so the feedback went into a table nobody queried.
 */

let aaAssignments = [];       // [{ assignment, course, lesson }]
let aaLoaded = false;
let aaEditingId = null;
let aaPeerSubmissionId = null;

function aaEsc(t) {
    if (t === null || t === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
}

// ═══ AUTHORING ══════════════════════════════════════════════════════════════

/**
 * Walks courses → modules → lessons and asks each lesson whether it carries an
 * assignment. There is no "list all assignments" endpoint; this is the shape the
 * API supports, and it is why the result is cached until something changes it.
 */
async function loadAssignmentAuthoring() {
    const tbody = document.getElementById('authoringTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">Loading…</td></tr>';

    try {
        const courses = await api.request('/lms/courses');
        const courseList = Array.isArray(courses) ? courses : (courses.data || []);
        const found = [];

        for (const course of courseList) {
            let modules = [];
            try { modules = await api.request(`/lms/courses/${course.id}/modules?includeLessons=true`); }
            catch (e) { continue; }
            for (const m of (Array.isArray(modules) ? modules : [])) {
                for (const lesson of (m.lessons || [])) {
                    try {
                        const a = await api.request(`/lms/assignments/lesson/${lesson.id}`);
                        if (a && a.id) found.push({ assignment: a, course, lesson });
                    } catch (e) { /* no assignment on this lesson */ }
                }
            }
        }

        aaAssignments = found;
        aaLoaded = true;
        renderAuthoringTable();
        await populateLessonPicker(courseList);
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">Could not load assignments.</td></tr>';
    }
}

function renderAuthoringTable() {
    const tbody = document.getElementById('authoringTableBody');
    if (!aaAssignments.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">'
            + 'No assignments yet. An assignment attaches to a lesson &mdash; one per lesson.</td></tr>';
        return;
    }
    tbody.innerHTML = aaAssignments.map(({ assignment: a, course, lesson }) => `
        <tr>
            <td>${aaEsc(a.title)}</td>
            <td class="text-muted">${aaEsc(course.title)}</td>
            <td class="text-muted">${aaEsc(lesson.title)}</td>
            <td>${a.maxScore ?? a.max_score ?? 0}</td>
            <td>
                <button class="btn btn-sm btn-outline-secondary" onclick="openAssignmentEditor('${a.id}')">Edit</button>
                <button class="btn-icon danger" onclick="deleteAssignment('${a.id}')" title="Delete">&times;</button>
            </td>
        </tr>`).join('');
}

/** Only lessons WITHOUT an assignment can take a new one — the database allows
 *  exactly one per lesson, so offering a taken lesson would only produce a 409. */
async function populateLessonPicker(courseList) {
    const picker = document.getElementById('assignmentLessonId');
    if (!picker) return;
    const taken = new Set(aaAssignments.map(x => x.lesson.id));
    const options = [];

    for (const course of courseList) {
        let modules = [];
        try { modules = await api.request(`/lms/courses/${course.id}/modules?includeLessons=true`); }
        catch (e) { continue; }
        for (const m of (Array.isArray(modules) ? modules : [])) {
            for (const lesson of (m.lessons || [])) {
                if (taken.has(lesson.id)) continue;
                options.push(`<option value="${lesson.id}">${aaEsc(course.title)} — ${aaEsc(lesson.title)}</option>`);
            }
        }
    }
    picker.innerHTML = options.length
        ? '<option value="">Choose a lesson…</option>' + options.join('')
        : '<option value="">Every lesson already has an assignment</option>';
}

function showAssignmentEditor() {
    aaEditingId = null;
    document.getElementById('assignmentEditorTitle').textContent = 'New Assignment';
    document.getElementById('assignmentLessonGroup').style.display = 'block';
    ['assignmentTitle', 'assignmentDescription', 'assignmentInstructions'].forEach(id =>
        document.getElementById(id).value = '');
    document.getElementById('assignmentMaxScore').value = '100';
    document.getElementById('assignmentDueDays').value = '';
    document.getElementById('assignmentAllowLate').checked = true;
    document.getElementById('assignmentEditorModal').style.display = 'flex';
}

function openAssignmentEditor(assignmentId) {
    const entry = aaAssignments.find(x => x.assignment.id === assignmentId);
    if (!entry) return;
    const a = entry.assignment;
    aaEditingId = assignmentId;
    document.getElementById('assignmentEditorTitle').textContent = 'Edit Assignment';
    // The lesson cannot move: an assignment belongs to the lesson it was created on.
    document.getElementById('assignmentLessonGroup').style.display = 'none';
    document.getElementById('assignmentTitle').value = a.title || '';
    document.getElementById('assignmentDescription').value = a.description || '';
    document.getElementById('assignmentInstructions').value = a.instructions || '';
    document.getElementById('assignmentMaxScore').value = a.maxScore ?? a.max_score ?? 100;
    document.getElementById('assignmentDueDays').value = a.dueDaysAfterEnroll ?? a.due_days_after_enroll ?? '';
    document.getElementById('assignmentAllowLate').checked = (a.allowLate ?? a.allow_late) !== false;
    document.getElementById('assignmentEditorModal').style.display = 'flex';
}

function closeAssignmentEditor() {
    document.getElementById('assignmentEditorModal').style.display = 'none';
    aaEditingId = null;
}

async function saveAssignment() {
    const title = document.getElementById('assignmentTitle').value.trim();
    if (!title) { showToast('The assignment needs a title', 'error'); return; }

    const dueRaw = document.getElementById('assignmentDueDays').value;
    const payload = {
        title,
        description: document.getElementById('assignmentDescription').value.trim() || null,
        instructions: document.getElementById('assignmentInstructions').value.trim() || null,
        maxScore: parseFloat(document.getElementById('assignmentMaxScore').value) || 100,
        dueDaysAfterEnroll: dueRaw === '' ? null : parseInt(dueRaw, 10),
        allowLate: document.getElementById('assignmentAllowLate').checked
    };

    try {
        if (aaEditingId) {
            await api.request(`/lms/assignments/${aaEditingId}`, {
                method: 'PUT', body: JSON.stringify({ id: aaEditingId, ...payload })
            });
        } else {
            const lessonId = document.getElementById('assignmentLessonId').value;
            if (!lessonId) { showToast('Choose the lesson this assignment belongs to', 'error'); return; }
            await api.request('/lms/assignments', {
                method: 'POST', body: JSON.stringify({ lessonId, ...payload })
            });
        }
        closeAssignmentEditor();
        await loadAssignmentAuthoring();
        showToast('Assignment saved', 'success');
    } catch (e) { showToast(e.message || 'Could not save the assignment', 'error'); }
}

async function deleteAssignment(assignmentId) {
    const entry = aaAssignments.find(x => x.assignment.id === assignmentId);
    if (!confirm(`Delete "${entry ? entry.assignment.title : 'this assignment'}"?\n\nEvery submission against it goes too.`)) return;
    try {
        await api.request(`/lms/assignments/${assignmentId}`, { method: 'DELETE' });
        await loadAssignmentAuthoring();
        showToast('Assignment deleted', 'success');
    } catch (e) { showToast(e.message || 'Could not delete the assignment', 'error'); }
}

// ═══ PEER REVIEW ════════════════════════════════════════════════════════════

/** Instructor: ask a named learner to review this submission. */
function openPeerReviewAssign(submissionId) {
    aaPeerSubmissionId = submissionId;
    document.getElementById('peerReviewerId').value = '';
    document.getElementById('peerAssignModal').style.display = 'flex';
    renderPeerReviewsFor(submissionId);
}

function closePeerAssign() {
    document.getElementById('peerAssignModal').style.display = 'none';
    aaPeerSubmissionId = null;
}

async function renderPeerReviewsFor(submissionId) {
    const host = document.getElementById('peerExistingReviews');
    host.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
        const rows = await api.request(`/lms/learning/submissions/${submissionId}/peer-reviews`);
        host.innerHTML = rows.length === 0
            ? '<p class="text-muted qb-hint">No peer reviews on this submission yet.</p>'
            : `<div class="qb-question-list">${rows.map(r => `
                <div class="qb-question-row">
                    <div class="qb-question-main">
                        <div class="qb-question-text">${aaEsc(r.reviewerUserId)}</div>
                        <div class="qb-question-meta">
                            <span class="badge">${aaEsc(r.status)}</span>
                            ${r.score !== null && r.score !== undefined ? `<span>${r.score} points</span>` : ''}
                        </div>
                        ${r.feedback ? `<div class="grading-answer" style="margin-top:8px;">${aaEsc(r.feedback)}</div>` : ''}
                    </div>
                </div>`).join('')}</div>`;
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load the reviews.</p>';
    }
}

async function assignPeerReviewer() {
    const reviewer = document.getElementById('peerReviewerId').value.trim();
    if (!reviewer) { showToast('Name the reviewer', 'error'); return; }
    try {
        await api.request(`/lms/learning/submissions/${aaPeerSubmissionId}/peer-reviews`, {
            method: 'POST', body: JSON.stringify({ reviewerUserId: reviewer })
        });
        document.getElementById('peerReviewerId').value = '';
        await renderPeerReviewsFor(aaPeerSubmissionId);
        showToast('Reviewer assigned', 'success');
    } catch (e) { showToast(e.message || 'Could not assign the reviewer', 'error'); }
}

// ─── the reviewer's own queue ───────────────────────────────────────────────

let aaMyReviewsLoaded = false;

async function loadMyPeerReviews() {
    const host = document.getElementById('myPeerReviewsList');
    host.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
        const rows = await api.request('/lms/learning/peer-reviews/mine');
        aaMyReviewsLoaded = true;
        host.innerHTML = rows.length === 0
            ? '<p class="text-muted qb-hint">Nothing has been sent to you to review.</p>'
            : rows.map(r => `
                <div class="qb-question-row" style="align-items:center;">
                    <div class="qb-question-main">
                        <div class="qb-question-text">Submission ${aaEsc(String(r.submissionId).slice(0, 8))}…</div>
                        <div class="qb-question-meta"><span class="badge">${aaEsc(r.status)}</span></div>
                    </div>
                    <div class="qb-question-actions">
                        ${r.status === 'completed'
                            ? '<span class="text-muted" style="font-size:12px;">Done</span>'
                            : `<button class="btn btn-sm btn-primary" onclick="openMyReview('${r.id}')">Review</button>`}
                    </div>
                </div>`).join('');
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load your review queue.</p>';
    }
}

let aaReviewingId = null;

function openMyReview(reviewId) {
    aaReviewingId = reviewId;
    document.getElementById('myReviewScore').value = '';
    document.getElementById('myReviewFeedback').value = '';
    document.getElementById('myReviewModal').style.display = 'flex';
}

function closeMyReview() {
    document.getElementById('myReviewModal').style.display = 'none';
    aaReviewingId = null;
}

async function submitMyReview() {
    const scoreRaw = document.getElementById('myReviewScore').value;
    const feedback = document.getElementById('myReviewFeedback').value.trim();
    if (!feedback && scoreRaw === '') {
        showToast('Give a score, feedback, or both', 'error');
        return;
    }
    try {
        await api.request(`/lms/learning/peer-reviews/${aaReviewingId}`, {
            method: 'PUT',
            body: JSON.stringify({
                score: scoreRaw === '' ? null : parseFloat(scoreRaw),
                feedback: feedback || null
            })
        });
        closeMyReview();
        await loadMyPeerReviews();
        showToast('Review submitted', 'success');
    } catch (e) { showToast(e.message || 'Could not submit the review', 'error'); }
}
