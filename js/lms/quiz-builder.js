/**
 * Quiz authoring.
 *
 * The backend has had quizzes, questions, pooling and manual grading for some time and the UI
 * had none of it: `quiz` existed only as a lesson-type icon, so a quiz could not be created at
 * all from the product. Everything downstream — question banks, surveys, the review queue for
 * short answers — was unreachable as a result.
 *
 * Quizzes attach to a SAVED lesson, so the entry point is disabled until the lesson has an id.
 */

let qbLesson = null;         // { id, title }
let qbQuiz = null;           // the quiz row, or null when the lesson has none yet
let qbQuestions = [];
let qbEditingQuestionIdx = null;

/**
 * The question types the database actually accepts for a graded quiz.
 * These mirror chk_question_type; offering anything else produces a 400 the author cannot act on.
 */
const QB_TYPES = [
    { value: 'mcq',          label: 'Multiple choice',  needsOptions: true,  autoGraded: true  },
    { value: 'true_false',   label: 'True / false',     needsOptions: false, autoGraded: true  },
    { value: 'fill_blank',   label: 'Fill in the blank',needsOptions: false, autoGraded: true  },
    { value: 'matching',     label: 'Matching',         needsOptions: true,  autoGraded: true  },
    { value: 'short_answer', label: 'Short answer',     needsOptions: false, autoGraded: false }
];

function qbEscape(t) {
    if (t === null || t === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
}

// ─── open / close ───────────────────────────────────────────────────────────

async function openQuizBuilder(lessonId, lessonTitle) {
    if (!lessonId) {
        showToast('Save the course first — a quiz attaches to a saved lesson.', 'error');
        return;
    }
    qbLesson = { id: lessonId, title: lessonTitle };
    qbQuiz = null;
    qbQuestions = [];

    document.getElementById('quizBuilderModal').style.display = 'flex';
    document.getElementById('quizBuilderLessonName').textContent = lessonTitle || '';
    document.getElementById('quizBuilderBody').innerHTML = '<p class="text-muted">Loading…</p>';

    try {
        const quiz = await api.request(`/lms/quizzes/lesson/${lessonId}`);
        qbQuiz = quiz && quiz.id ? quiz : null;
    } catch (e) {
        // 404 simply means this lesson has no quiz yet — that is the create path, not an error.
        qbQuiz = null;
    }

    if (qbQuiz) await qbLoadQuestions();
    qbRender();
}

function closeQuizBuilder() {
    document.getElementById('quizBuilderModal').style.display = 'none';
    qbLesson = null; qbQuiz = null; qbQuestions = []; qbEditingQuestionIdx = null;
}

async function qbLoadQuestions() {
    try {
        const rows = await api.request(`/lms/quizzes/${qbQuiz.id}/questions`);
        qbQuestions = Array.isArray(rows) ? rows : (rows.data || []);
    } catch (e) {
        qbQuestions = [];
    }
}

// ─── render ─────────────────────────────────────────────────────────────────

function qbRender() {
    const body = document.getElementById('quizBuilderBody');

    const settings = `
        <div class="qb-section">
            <h4 class="qb-section-title">Quiz settings</h4>
            <div class="form-row">
                <div class="form-group">
                    <label for="qbTitle">Title <span class="required">*</span></label>
                    <input type="text" id="qbTitle" class="form-control"
                           value="${qbEscape(qbQuiz ? qbQuiz.title : (qbLesson.title || 'Quiz'))}">
                </div>
                <div class="form-group">
                    <label for="qbPassing">Pass mark (%)</label>
                    <input type="number" id="qbPassing" class="form-control" min="0" max="100"
                           value="${qbQuiz ? (qbQuiz.passingScore ?? qbQuiz.passing_score ?? 70) : 70}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="qbAttempts">Attempts allowed <span class="text-muted">(0 = unlimited)</span></label>
                    <input type="number" id="qbAttempts" class="form-control" min="0"
                           value="${qbQuiz ? (qbQuiz.maxAttempts ?? qbQuiz.max_attempts ?? 1) : 1}">
                </div>
                <div class="form-group">
                    <label for="qbTimeLimit">Time limit (minutes, blank = none)</label>
                    <input type="number" id="qbTimeLimit" class="form-control" min="1"
                           value="${qbQuiz && (qbQuiz.timeLimitMinutes ?? qbQuiz.time_limit_minutes) ? (qbQuiz.timeLimitMinutes ?? qbQuiz.time_limit_minutes) : ''}">
                </div>
            </div>
            <div class="form-row">
                <label class="checkbox-label">
                    <input type="checkbox" id="qbShuffle" ${qbQuiz && (qbQuiz.shuffleQuestions ?? qbQuiz.shuffle_questions) ? 'checked' : ''}>
                    <span>Shuffle questions</span>
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" id="qbShowAnswers" ${qbQuiz && (qbQuiz.showAnswers ?? qbQuiz.show_answers) ? 'checked' : ''}>
                    <span>Show correct answers afterwards</span>
                </label>
            </div>
            <button class="btn btn-primary" onclick="qbSaveQuiz()">
                ${qbQuiz ? 'Save settings' : 'Create quiz'}
            </button>
        </div>`;

    const questions = !qbQuiz ? `
        <p class="text-muted qb-hint">Create the quiz above, then add its questions.</p>` : `
        <div class="qb-section">
            <div class="qb-section-head">
                <h4 class="qb-section-title">Questions (${qbQuestions.length})</h4>
                <button class="btn btn-sm btn-primary" onclick="qbOpenQuestion()">Add question</button>
            </div>
            ${qbQuestions.length === 0
                ? '<p class="text-muted qb-hint">No questions yet. A quiz with no questions cannot be passed.</p>'
                : `<div class="qb-question-list">${qbQuestions.map(qbRenderQuestionRow).join('')}</div>`}
        </div>`;

    body.innerHTML = settings + questions;
}

function qbRenderQuestionRow(q, idx) {
    const type = QB_TYPES.find(t => t.value === (q.questionType || q.question_type));
    const manual = type && !type.autoGraded;
    return `
        <div class="qb-question-row">
            <span class="qb-question-index">${idx + 1}</span>
            <div class="qb-question-main">
                <div class="qb-question-text">${qbEscape(q.questionText || q.question_text)}</div>
                <div class="qb-question-meta">
                    <span class="badge">${qbEscape(type ? type.label : (q.questionType || q.question_type))}</span>
                    <span>${q.points ?? 1} point(s)</span>
                    ${manual ? '<span class="badge badge-warning" title="Someone must mark this by hand before the attempt can pass">marked by hand</span>' : ''}
                </div>
            </div>
            <div class="qb-question-actions">
                <button class="btn btn-sm btn-outline-secondary" onclick="qbOpenQuestion(${idx})">Edit</button>
                <button class="btn-icon danger" onclick="qbDeleteQuestion(${idx})" title="Delete">&times;</button>
            </div>
        </div>`;
}

// ─── quiz create / update ───────────────────────────────────────────────────

async function qbSaveQuiz() {
    const title = document.getElementById('qbTitle').value.trim();
    if (!title) { showToast('The quiz needs a title', 'error'); return; }

    const timeLimitRaw = document.getElementById('qbTimeLimit').value;
    const payload = {
        lessonId: qbLesson.id,
        title,
        passingScore: parseFloat(document.getElementById('qbPassing').value) || 0,
        maxAttempts: parseInt(document.getElementById('qbAttempts').value, 10) || 0,
        timeLimitMinutes: timeLimitRaw === '' ? null : parseInt(timeLimitRaw, 10),
        shuffleQuestions: document.getElementById('qbShuffle').checked,
        showAnswers: document.getElementById('qbShowAnswers').checked
    };

    try {
        if (qbQuiz) {
            await api.request(`/lms/quizzes/${qbQuiz.id}`, {
                method: 'PUT', body: JSON.stringify({ id: qbQuiz.id, ...payload })
            });
            Object.assign(qbQuiz, payload);
            showToast('Quiz settings saved', 'success');
        } else {
            const created = await api.request('/lms/quizzes', {
                method: 'POST', body: JSON.stringify(payload)
            });
            qbQuiz = { id: created.id || created.quizId || created, ...payload };
            showToast('Quiz created', 'success');
        }
        qbRender();
    } catch (e) {
        showToast(e.message || 'Could not save the quiz', 'error');
    }
}

// ─── questions ──────────────────────────────────────────────────────────────

function qbOpenQuestion(idx) {
    qbEditingQuestionIdx = (idx === undefined || idx === null) ? null : idx;
    const q = qbEditingQuestionIdx !== null ? qbQuestions[qbEditingQuestionIdx] : null;

    document.getElementById('qbQuestionModalTitle').textContent = q ? 'Edit question' : 'Add question';
    document.getElementById('qbQType').innerHTML =
        QB_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
    document.getElementById('qbQType').value = q ? (q.questionType || q.question_type) : 'mcq';
    document.getElementById('qbQText').value = q ? (q.questionText || q.question_text) : '';
    document.getElementById('qbQPoints').value = q ? (q.points ?? 1) : 1;

    let opts = q ? (q.options || '') : '';
    try { const parsed = JSON.parse(opts); if (Array.isArray(parsed)) opts = parsed.join('\n'); } catch (e) { /* plain text */ }
    document.getElementById('qbQOptions').value = opts;

    let ans = q ? (q.correctAnswer || q.correct_answer || '') : '';
    try { ans = JSON.parse(ans); } catch (e) { /* already plain */ }
    document.getElementById('qbQAnswer').value = ans ?? '';
    document.getElementById('qbQExplanation').value = q ? (q.explanation || '') : '';

    qbToggleQuestionFields();
    document.getElementById('qbQuestionModal').style.display = 'flex';
}

function qbCloseQuestion() {
    document.getElementById('qbQuestionModal').style.display = 'none';
    qbEditingQuestionIdx = null;
}

/** Show only the fields the chosen type actually uses, and say when marking is manual. */
function qbToggleQuestionFields() {
    const type = QB_TYPES.find(t => t.value === document.getElementById('qbQType').value);
    document.getElementById('qbQOptionsGroup').style.display = type && type.needsOptions ? 'block' : 'none';
    document.getElementById('qbQAnswerGroup').style.display = type && type.autoGraded ? 'block' : 'none';
    document.getElementById('qbQManualNote').style.display = type && !type.autoGraded ? 'block' : 'none';
}

async function qbSaveQuestion() {
    const type = document.getElementById('qbQType').value;
    const text = document.getElementById('qbQText').value.trim();
    if (!text) { showToast('The question needs its text', 'error'); return; }

    const meta = QB_TYPES.find(t => t.value === type);
    const optionLines = document.getElementById('qbQOptions').value
        .split('\n').map(s => s.trim()).filter(Boolean);
    const answer = document.getElementById('qbQAnswer').value.trim();

    if (meta.autoGraded && !answer) {
        showToast('An auto-marked question needs its correct answer', 'error');
        return;
    }
    if (meta.needsOptions && optionLines.length < 2) {
        showToast('Give at least two options, one per line', 'error');
        return;
    }

    const payload = {
        questionType: type,
        questionText: text,
        // options and correct_answer are JSONB columns — send JSON, not bare text.
        options: meta.needsOptions ? JSON.stringify(optionLines) : null,
        correctAnswer: meta.autoGraded ? JSON.stringify(answer) : null,
        explanation: document.getElementById('qbQExplanation').value.trim() || null,
        points: parseFloat(document.getElementById('qbQPoints').value) || 1,
        sortOrder: qbEditingQuestionIdx !== null
            ? (qbQuestions[qbEditingQuestionIdx].sortOrder ?? qbQuestions[qbEditingQuestionIdx].sort_order ?? 0)
            : qbQuestions.length
    };

    try {
        if (qbEditingQuestionIdx !== null) {
            const id = qbQuestions[qbEditingQuestionIdx].id;
            await api.request(`/lms/quizzes/questions/${id}`, {
                method: 'PUT', body: JSON.stringify({ id, ...payload })
            });
        } else {
            await api.request(`/lms/quizzes/questions/${qbQuiz.id}`, {
                method: 'POST', body: JSON.stringify(payload)
            });
        }
        qbCloseQuestion();
        await qbLoadQuestions();
        qbRender();
        showToast('Question saved', 'success');
    } catch (e) {
        showToast(e.message || 'Could not save the question', 'error');
    }
}

async function qbDeleteQuestion(idx) {
    const q = qbQuestions[idx];
    if (!confirm(`Delete this question?\n\n${q.questionText || q.question_text}`)) return;
    try {
        await api.request(`/lms/quizzes/questions/${q.id}`, { method: 'DELETE' });
        await qbLoadQuestions();
        qbRender();
        showToast('Question deleted', 'success');
    } catch (e) {
        showToast(e.message || 'Could not delete the question', 'error');
    }
}
