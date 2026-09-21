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
        // ONE call for the list. This used to walk every course, then every module, then
        // every lesson, asking each lesson for its assignment — and a lesson without one
        // answers 404, so the ordinary case wrote an error per lesson into the console and
        // buried anything real underneath it.
        const rows = await api.request('/lms/assignments');

        // Kept in the {assignment, course, lesson} shape the table and the editor already
        // read, so the server change stops here.
        aaAssignments = (Array.isArray(rows) ? rows : []).map(r => ({
            assignment: {
                id: r.id,
                title: r.title,
                description: r.description,
                instructions: r.instructions,
                maxScore: r.maxScore,
                dueDaysAfterEnroll: r.dueDaysAfterEnroll,
                allowLate: r.allowLate,
                isActive: r.isActive,
                submissionCount: r.submissionCount
            },
            course: { id: r.courseId, title: r.courseTitle },
            lesson: { id: r.lessonId, title: r.lessonTitle }
        }));
        aaLoaded = true;
        renderAuthoringTable();

        // The picker still needs the full lesson list to offer the ones NOT taken, and
        // there is no tenant-wide lesson route. It costs one request per course and, unlike
        // the crawl above, asks nothing that can legitimately answer 404.
        const courses = await api.request('/lms/courses');
        await populateLessonPicker(Array.isArray(courses) ? courses : (courses.data || []));
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

/** Names, resolved once per modal open, so the UI never shows a raw user id. */
let aaPeerNames = {};

/**
 * Instructor: ask a learner on this course to review this submission.
 *
 * Takes the course and the submission's author so the reviewer can be PICKED. It
 * used to be a free-text box labelled "Their user id" — an instructor does not know
 * anyone's UUID, so the feature was unusable in practice even though the endpoint
 * behind it worked.
 */
async function openPeerReviewAssign(submissionId, courseId, authorUserId) {
    aaPeerSubmissionId = submissionId;
    document.getElementById('peerAssignModal').style.display = 'flex';

    const picker = document.getElementById('peerReviewerId');
    picker.innerHTML = '<option value="">Loading the roster…</option>';
    aaPeerNames = {};

    renderPeerReviewsFor(submissionId);

    if (!courseId) {
        picker.innerHTML = '<option value="">No course on this row</option>';
        return;
    }

    try {
        const roster = await api.request(`/lms/enrollments/course/${courseId}`);
        const rows = Array.isArray(roster) ? roster : [];
        rows.forEach(r => { if (r.userName) aaPeerNames[r.userId] = r.userName; });

        // A learner cannot review their own submission, so the author is not offered.
        const options = rows
            .filter(r => r.userId !== authorUserId)
            .map(r => `<option value="${aaEsc(r.userId)}">${aaEsc(r.userName || r.userId)}</option>`);

        picker.innerHTML = options.length
            ? '<option value="">Choose a reviewer…</option>' + options.join('')
            : '<option value="">Nobody else is enrolled on this course</option>';

        // Redraw now that names are known — the first pass rendered ids.
        renderPeerReviewsFor(submissionId);
    } catch (e) {
        picker.innerHTML = '<option value="">Could not load the roster</option>';
    }
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
                        <div class="qb-question-text">${aaEsc(aaPeerNames[r.reviewerUserId] || r.reviewerUserId)}</div>
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
    const reviewer = document.getElementById('peerReviewerId').value;
    if (!reviewer) { showToast('Choose a reviewer', 'error'); return; }
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
        aaMyReviews = Array.isArray(rows) ? rows : [];

        // Name the work. This used to render "Submission a776ff15…" — the reviewer was shown a
        // truncated UUID and had no way to tell what they had been asked to read.
        host.innerHTML = aaMyReviews.length === 0
            ? '<p class="text-muted qb-hint">Nothing has been sent to you to review.</p>'
            : aaMyReviews.map(r => `
                <div class="qb-question-row" style="align-items:center;">
                    <div class="qb-question-main">
                        <div class="qb-question-text">${aaEsc(r.assignmentTitle || 'Submission')}</div>
                        <div class="qb-question-meta">
                            <span>${aaEsc(r.courseTitle || '')}</span>
                            <span class="badge">${aaEsc(r.status)}</span>
                            ${r.score !== null && r.score !== undefined ? `<span>${r.score} / ${r.maxScore}</span>` : ''}
                        </div>
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
let aaMyReviews = [];

/**
 * Show the WORK, then ask for the verdict. The modal used to open with nothing but a score
 * box and a feedback box — the reviewer was asked to mark something they could not read.
 */
function openMyReview(reviewId) {
    aaReviewingId = reviewId;
    const task = aaMyReviews.find(r => r.id === reviewId);

    document.getElementById('myReviewScore').value = '';
    document.getElementById('myReviewFeedback').value = '';

    const host = document.getElementById('myReviewSubject');
    if (host) {
        host.innerHTML = !task
            ? ''
            : `<div class="form-group">
                   <label>${aaEsc(task.assignmentTitle || 'Submission')}</label>
                   <p class="text-muted qb-hint" style="margin:2px 0 8px;">
                       ${aaEsc(task.courseTitle || '')}${task.maxScore ? ` — out of ${task.maxScore}` : ''}
                   </p>
                   <div class="grading-answer">${aaEsc(task.submissionText || '(this submission has no written text)')}</div>
               </div>`;
    }

    // Bound to the assignment's own maximum, so a reviewer cannot award more than the work is worth.
    const scoreEl = document.getElementById('myReviewScore');
    if (scoreEl && task && task.maxScore) scoreEl.max = task.maxScore;

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
