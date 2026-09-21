/**
 * The read-only views the backend had and the UI did not: who is enrolled on a
 * course, a manager's team, a learner's lesson-by-lesson progress, a learner's
 * quiz attempt history, and one certificate in detail.
 *
 * All of it was queryable and none of it reachable.
 */

function ivEsc(t) {
    if (t === null || t === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
}

function ivDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function ivEmpty(cols, msg) {
    return `<tr><td colspan="${cols}" class="text-center text-muted" style="padding:24px;">${ivEsc(msg)}</td></tr>`;
}

// ═══ WHO IS ON THIS COURSE ══════════════════════════════════════════════════

async function openCourseRoster(courseIdArg) {
    const id = courseIdArg || (typeof courseId !== 'undefined' ? courseId : null);
    if (!id) return;
    document.getElementById('rosterModal').style.display = 'flex';
    const tbody = document.getElementById('rosterBody');
    tbody.innerHTML = ivEmpty(5, 'Loading…');

    try {
        const rows = await api.request(`/lms/enrollments/course/${id}`);
        const list = Array.isArray(rows) ? rows : (rows.data || []);
        tbody.innerHTML = list.length === 0
            ? ivEmpty(5, 'Nobody is enrolled on this course yet.')
            : list.map(e => `
                <tr>
                    <td>${ivEsc(e.userName || e.userId)}</td>
                    <td><span class="badge">${ivEsc(e.status)}</span></td>
                    <td>${Math.round(e.progressPct ?? 0)}%</td>
                    <td>${ivDate(e.createdAt)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary"
                                onclick="openLearnerProgress('${id}', '${ivEsc(e.userId)}', '${ivEsc(e.userName || e.userId)}')">
                            Progress
                        </button>
                    </td>
                </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = ivEmpty(5, 'Could not load the enrolment list.');
    }
}

function closeRoster() { document.getElementById('rosterModal').style.display = 'none'; }

// ═══ ONE LEARNER'S PROGRESS THROUGH A COURSE ════════════════════════════════

/**
 * Without a userId this reads the CALLER's own progress; with one it reads that
 * learner's, which the endpoint restricts to instructors and above.
 */
async function openLearnerProgress(courseIdArg, userId, displayName) {
    document.getElementById('progressModal').style.display = 'flex';
    document.getElementById('progressModalWho').textContent = displayName || 'Your progress';
    const host = document.getElementById('progressModalBody');
    host.innerHTML = '<p class="text-muted">Loading…</p>';

    const url = userId
        ? `/lms/progress/course/${courseIdArg}/user/${encodeURIComponent(userId)}`
        : `/lms/progress/course/${courseIdArg}`;

    try {
        // The progress rows carry a lessonId and NO title, and only exist for
        // lessons already started — so the course outline is read alongside them.
        // Joining here is what makes the view useful: every lesson is listed, and
        // the ones not started show as such rather than being invisible.
        const [rows, modules] = await Promise.all([
            api.request(url),
            api.request(`/lms/courses/${courseIdArg}/modules?includeLessons=true`)
        ]);

        const progress = new Map(
            (Array.isArray(rows) ? rows : (rows.lessons || rows.data || []))
                .map(r => [r.lessonId, r]));

        const outline = (Array.isArray(modules) ? modules : []).flatMap(m =>
            (m.lessons || []).map(l => ({ moduleTitle: m.title, lesson: l })));

        if (outline.length === 0) {
            host.innerHTML = '<p class="text-muted qb-hint">This course has no lessons yet.</p>';
            return;
        }

        const done = outline.filter(o => progress.get(o.lesson.id)?.status === 'completed').length;

        host.innerHTML = `
            <p class="text-muted qb-hint">${done} of ${outline.length} lesson(s) complete.</p>
            <div class="qb-question-list">${outline.map(({ moduleTitle, lesson }) => {
                const pr = progress.get(lesson.id);
                const status = pr?.status || 'not started';
                const isDone = status === 'completed';
                return `
                <div class="qb-question-row">
                    <span class="qb-question-index ${isDone ? '' : 'pending'}">${isDone ? '✓' : '·'}</span>
                    <div class="qb-question-main">
                        <div class="qb-question-text">${ivEsc(lesson.title)}</div>
                        <div class="qb-question-meta">
                            <span>${ivEsc(moduleTitle)}</span>
                            <span class="badge ${isDone ? 'badge-success' : ''}">${ivEsc(status)}</span>
                            ${pr?.timeSpentSeconds ? `<span>${Math.round(pr.timeSpentSeconds / 60)} min</span>` : ''}
                            ${pr?.completedAt ? `<span>${ivDate(pr.completedAt)}</span>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('')}</div>`;
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load this progress.</p>';
    }
}

function closeProgressModal() { document.getElementById('progressModal').style.display = 'none'; }

// ═══ A MANAGER'S TEAM ═══════════════════════════════════════════════════════

let ivTeamLoaded = false;

async function loadTeamEnrollments() {
    const tbody = document.getElementById('teamBody');
    if (!tbody) return;
    tbody.innerHTML = ivEmpty(5, 'Loading…');
    try {
        const rows = await api.request('/lms/enrollments/team');
        const list = Array.isArray(rows) ? rows : (rows.data || []);
        ivTeamLoaded = true;
        tbody.innerHTML = list.length === 0
            ? ivEmpty(5, 'Nobody reports to you, or your reports have no enrolments yet.')
            : list.map(e => `
                <tr>
                    <td>${ivEsc(e.userName || e.userId)}</td>
                    <td>${ivEsc(e.courseTitle || '—')}</td>
                    <td><span class="badge">${ivEsc(e.status)}</span></td>
                    <td>${Math.round(e.progressPct ?? 0)}%</td>
                    <td>${e.dueDate ? ivDate(e.dueDate) : '—'}</td>
                </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = ivEmpty(5, 'Could not load your team.');
    }
}

// ═══ A LEARNER'S QUIZ ATTEMPT HISTORY ═══════════════════════════════════════

async function openMyAttempts(quizId, quizTitle) {
    document.getElementById('attemptsModal').style.display = 'flex';
    document.getElementById('attemptsModalTitle').textContent = quizTitle || 'Your attempts';
    const host = document.getElementById('attemptsModalBody');
    host.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
        const rows = await api.request(`/lms/quizzes/${quizId}/attempts`);
        const list = Array.isArray(rows) ? rows : (rows.data || []);
        host.innerHTML = list.length === 0
            ? '<p class="text-muted qb-hint">You have not attempted this quiz yet.</p>'
            : `<div class="qb-question-list">${list.map((a, i) => {
                // An attempt awaiting marking is NOT a fail — it is undecided.
                const state = a.requiresReview ? 'awaiting marking'
                            : a.passed ? 'passed' : 'not passed';
                const cls = a.requiresReview ? 'badge-warning' : (a.passed ? 'badge-success' : '');
                return `
                <div class="qb-question-row">
                    <span class="qb-question-index">${list.length - i}</span>
                    <div class="qb-question-main">
                        <div class="qb-question-text">${a.score} / ${a.maxScore}</div>
                        <div class="qb-question-meta">
                            <span class="badge ${cls}">${state}</span>
                            <span>${ivDate(a.submittedAt || a.startedAt)}</span>
                            ${a.timeTakenSeconds ? `<span>${Math.round(a.timeTakenSeconds / 60)} min</span>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('')}</div>`;
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load your attempts.</p>';
    }
}

function closeAttemptsModal() { document.getElementById('attemptsModal').style.display = 'none'; }

// ═══ ONE CERTIFICATE ════════════════════════════════════════════════════════

async function openCertificateDetail(certId) {
    document.getElementById('certDetailModal').style.display = 'flex';
    const host = document.getElementById('certDetailBody');
    host.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
        const c = await api.request(`/lms/certificates/${certId}`);
        const status = c.status || (c.isValid ? 'valid' : 'not valid');
        host.innerHTML = `
            <div class="cert-detail">
                <div class="cert-detail-number">${ivEsc(c.certificateNumber)}</div>
                <span class="badge ${status === 'valid' ? 'badge-success' : 'badge-warning'}">${ivEsc(status)}</span>
                <dl class="cert-detail-fields">
                    <dt>Course</dt><dd>${ivEsc(c.courseTitle || '—')}</dd>
                    <dt>Issued to</dt><dd>${ivEsc(c.userName || c.userId)}</dd>
                    <dt>Issued</dt><dd>${ivDate(c.issuedAt)}</dd>
                    <dt>Valid until</dt><dd>${c.validUntil ? ivDate(c.validUntil) : 'Does not expire'}</dd>
                    ${c.revokedAt ? `<dt>Revoked</dt><dd>${ivDate(c.revokedAt)}</dd>` : ''}
                    ${c.supersededBy ? '<dt>Superseded</dt><dd>Replaced by a newer certificate</dd>' : ''}
                </dl>
            </div>`;
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load this certificate.</p>';
    }
}

function closeCertDetail() { document.getElementById('certDetailModal').style.display = 'none'; }

// ═══ WHO ATTENDED A LIVE SESSION ════════════════════════════════════════════

/** Distinct from the REGISTRATION list: this is who actually turned up. */
async function openSessionAttendance(sessionId) {
    document.getElementById('attendanceModal').style.display = 'flex';
    const host = document.getElementById('attendanceBody');
    host.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
        const rows = await api.request(`/lms/live-sessions/${sessionId}/attendees`);
        const list = Array.isArray(rows) ? rows : (rows.data || []);
        host.innerHTML = list.length === 0
            ? '<p class="text-muted qb-hint">Nobody has joined this session.</p>'
            : `<div class="qb-question-list">${list.map(a => `
                <div class="qb-question-row">
                    <div class="qb-question-main">
                        <div class="qb-question-text">${ivEsc(a.userName || a.userId)}</div>
                        <div class="qb-question-meta">
                            <span class="badge">${ivEsc(a.status || 'attended')}</span>
                            ${a.joinedAt ? `<span>joined ${new Date(a.joinedAt).toLocaleTimeString()}</span>` : ''}
                            ${a.durationMinutes ? `<span>${a.durationMinutes} min</span>` : ''}
                        </div>
                    </div>
                </div>`).join('')}</div>`;
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load the attendance list.</p>';
    }
}

function closeAttendance() { document.getElementById('attendanceModal').style.display = 'none'; }
