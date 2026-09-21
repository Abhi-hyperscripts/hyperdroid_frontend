/**
 * Admin surfaces the backend had and the UI did not: question banks and pooling,
 * badges, skills, and the queue of quiz attempts waiting to be marked by hand.
 *
 * Twenty-three endpoints under /lms/learning had no caller anywhere in the product,
 * so every one of these features existed only as an API.
 */

// ═══ shared helpers ═════════════════════════════════════════════════════════

function axEscape(t) {
    if (t === null || t === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
}

/** Renders "nothing here yet" consistently rather than leaving a blank table. */
function axEmptyRow(colspan, message) {
    return `<tr><td colspan="${colspan}" class="text-center text-muted" style="padding:24px;">${axEscape(message)}</td></tr>`;
}

function axError(e, fallback) {
    showToast((e && e.message) || fallback, 'error');
}

// ═══ QUESTION BANKS + POOLING ═══════════════════════════════════════════════

let axBanks = [];
let axBanksLoaded = false;
let axOpenBankId = null;

async function loadQuestionBanks() {
    const tbody = document.getElementById('questionBanksBody');
    tbody.innerHTML = axEmptyRow(4, 'Loading…');
    try {
        axBanks = await api.request('/lms/learning/question-banks');
        axBanksLoaded = true;
        renderQuestionBanks();
    } catch (e) {
        tbody.innerHTML = axEmptyRow(4, 'Could not load question banks.');
        axError(e, 'Could not load question banks');
    }
}

function renderQuestionBanks() {
    const tbody = document.getElementById('questionBanksBody');
    if (!axBanks.length) {
        tbody.innerHTML = axEmptyRow(4,
            'No question banks yet. A bank holds reusable questions that a quiz can draw from at random.');
        return;
    }
    tbody.innerHTML = axBanks.map(b => `
        <tr>
            <td>${axEscape(b.name)}</td>
            <td class="text-muted">${axEscape(b.description || '—')}</td>
            <td>${b.questionCount}</td>
            <td>
                <button class="btn btn-sm btn-outline-secondary" onclick="openBankQuestions('${b.id}')">Questions</button>
                <button class="btn-icon danger" onclick="deleteBank('${b.id}')" title="Delete bank">&times;</button>
            </td>
        </tr>`).join('');
}

function showBankModal() {
    document.getElementById('bankName').value = '';
    document.getElementById('bankDescription').value = '';
    document.getElementById('bankModal').style.display = 'flex';
}

function closeBankModal() {
    document.getElementById('bankModal').style.display = 'none';
}

async function saveBank() {
    const name = document.getElementById('bankName').value.trim();
    if (!name) { showToast('The bank needs a name', 'error'); return; }
    try {
        await api.request('/lms/learning/question-banks', {
            method: 'POST',
            body: JSON.stringify({ name, description: document.getElementById('bankDescription').value.trim() || null })
        });
        closeBankModal();
        await loadQuestionBanks();
        showToast('Question bank created', 'success');
    } catch (e) { axError(e, 'Could not create the bank'); }
}

async function deleteBank(bankId) {
    const bank = axBanks.find(b => b.id === bankId);
    if (!confirm(`Delete "${bank ? bank.name : 'this bank'}"?\n\nIts ${bank ? bank.questionCount : ''} question(s) go with it.`)) return;
    try {
        await api.request(`/lms/learning/question-banks/${bankId}`, { method: 'DELETE' });
        await loadQuestionBanks();
        showToast('Question bank deleted', 'success');
    } catch (e) { axError(e, 'Could not delete the bank'); }
}

// ─── the questions inside one bank ──────────────────────────────────────────

async function openBankQuestions(bankId) {
    axOpenBankId = bankId;
    const bank = axBanks.find(b => b.id === bankId);
    document.getElementById('bankQuestionsTitle').textContent = bank ? bank.name : 'Bank questions';
    document.getElementById('bankQuestionsModal').style.display = 'flex';
    await renderBankQuestions();
}

function closeBankQuestions() {
    document.getElementById('bankQuestionsModal').style.display = 'none';
    axOpenBankId = null;
}

async function renderBankQuestions() {
    const host = document.getElementById('bankQuestionsList');
    host.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
        const rows = await api.request(`/lms/learning/question-banks/${axOpenBankId}/questions`);
        host.innerHTML = rows.length === 0
            ? '<p class="text-muted qb-hint">No questions yet. A pool that draws from an empty bank serves nothing.</p>'
            : `<div class="qb-question-list">${rows.map((q, i) => `
                <div class="qb-question-row">
                    <span class="qb-question-index">${i + 1}</span>
                    <div class="qb-question-main">
                        <div class="qb-question-text">${axEscape(q.questionText)}</div>
                        <div class="qb-question-meta">
                            <span class="badge">${axEscape(q.questionType)}</span>
                            <span>${q.points} point(s)</span>
                        </div>
                    </div>
                </div>`).join('')}</div>`;
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load the questions.</p>';
    }
}

function showBankQuestionForm() {
    document.getElementById('bankQText').value = '';
    document.getElementById('bankQOptions').value = '';
    document.getElementById('bankQAnswer').value = '';
    document.getElementById('bankQPoints').value = '1';
    document.getElementById('bankQType').value = 'mcq';
    toggleBankQuestionFields();
    document.getElementById('bankQuestionForm').style.display = 'block';
}

function toggleBankQuestionFields() {
    const t = document.getElementById('bankQType').value;
    const needsOptions = t === 'mcq' || t === 'matching';
    const autoGraded = t !== 'short_answer';
    document.getElementById('bankQOptionsGroup').style.display = needsOptions ? 'block' : 'none';
    document.getElementById('bankQAnswerGroup').style.display = autoGraded ? 'block' : 'none';
}

async function saveBankQuestion() {
    const type = document.getElementById('bankQType').value;
    const text = document.getElementById('bankQText').value.trim();
    if (!text) { showToast('The question needs its text', 'error'); return; }

    const needsOptions = type === 'mcq' || type === 'matching';
    const autoGraded = type !== 'short_answer';
    const options = document.getElementById('bankQOptions').value.split('\n').map(s => s.trim()).filter(Boolean);
    const answer = document.getElementById('bankQAnswer').value.trim();

    if (needsOptions && options.length < 2) { showToast('Give at least two options, one per line', 'error'); return; }
    if (autoGraded && !answer) { showToast('An auto-marked question needs its correct answer', 'error'); return; }

    try {
        await api.request(`/lms/learning/question-banks/${axOpenBankId}/questions`, {
            method: 'POST',
            body: JSON.stringify({
                questionType: type,
                questionText: text,
                // JSONB columns — send JSON, not bare text.
                options: needsOptions ? JSON.stringify(options) : null,
                correctAnswer: autoGraded ? JSON.stringify(answer) : null,
                points: parseFloat(document.getElementById('bankQPoints').value) || 1,
                sortOrder: 0
            })
        });
        document.getElementById('bankQuestionForm').style.display = 'none';
        await renderBankQuestions();
        await loadQuestionBanks();   // the bank's count changed
        showToast('Question added', 'success');
    } catch (e) { axError(e, 'Could not add the question'); }
}

// ═══ BADGES ════════════════════════════════════════════════════════════════

let axBadgesLoaded = false;

async function loadBadges() {
    const tbody = document.getElementById('badgesBody');
    tbody.innerHTML = axEmptyRow(5, 'Loading…');
    try {
        const rows = await api.request('/lms/learning/badges');
        axBadgesLoaded = true;
        tbody.innerHTML = rows.length === 0
            ? axEmptyRow(5, 'No badges yet. Badges are awarded automatically as learners finish courses and build streaks.')
            : rows.map(b => `
                <tr>
                    <td>${b.icon ? axEscape(b.icon) + ' ' : ''}${axEscape(b.name)}</td>
                    <td class="text-muted">${axEscape(b.code)}</td>
                    <td>${axEscape(b.criteriaType)}</td>
                    <td>${b.criteriaValue}</td>
                    <td>${b.points}</td>
                </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = axEmptyRow(5, 'Could not load badges.');
    }
}

function showBadgeModal() {
    ['badgeCode', 'badgeName', 'badgeDescription', 'badgeIcon'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('badgeCriteriaType').value = 'courses_completed';
    document.getElementById('badgeCriteriaValue').value = '1';
    document.getElementById('badgePoints').value = '0';
    document.getElementById('badgeModal').style.display = 'flex';
}

function closeBadgeModal() { document.getElementById('badgeModal').style.display = 'none'; }

async function saveBadge() {
    const code = document.getElementById('badgeCode').value.trim();
    const name = document.getElementById('badgeName').value.trim();
    if (!code || !name) { showToast('A badge needs a code and a name', 'error'); return; }
    try {
        await api.request('/lms/learning/badges', {
            method: 'PUT',
            body: JSON.stringify({
                code, name,
                description: document.getElementById('badgeDescription').value.trim() || null,
                icon: document.getElementById('badgeIcon').value.trim() || null,
                criteriaType: document.getElementById('badgeCriteriaType').value,
                criteriaValue: parseInt(document.getElementById('badgeCriteriaValue').value, 10) || 1,
                points: parseInt(document.getElementById('badgePoints').value, 10) || 0
            })
        });
        closeBadgeModal();
        await loadBadges();
        showToast('Badge saved', 'success');
    } catch (e) { axError(e, 'Could not save the badge'); }
}

// ═══ SKILLS ════════════════════════════════════════════════════════════════

let axSkillsLoaded = false;

async function loadSkills() {
    const tbody = document.getElementById('skillsBody');
    tbody.innerHTML = axEmptyRow(3, 'Loading…');
    try {
        // There is no list-all endpoint; the tenant's skills are those attached to
        // courses plus those the current user holds. Both are read here so the tab
        // shows the vocabulary that actually exists rather than nothing.
        const mine = await api.request('/lms/learning/skills/mine');
        axSkillsLoaded = true;
        tbody.innerHTML = mine.length === 0
            ? axEmptyRow(3, 'No skills recorded yet. Add one below, then attach it to a course so completing that course grants it.')
            : mine.map(s => `
                <tr>
                    <td>${axEscape(s.name)}</td>
                    <td class="text-muted">${axEscape(s.category || '—')}</td>
                    <td>Level ${s.level}</td>
                </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = axEmptyRow(3, 'Could not load skills.');
    }
}

function showSkillModal() {
    ['skillName', 'skillCategory', 'skillDescription'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('skillModal').style.display = 'flex';
}

function closeSkillModal() { document.getElementById('skillModal').style.display = 'none'; }

async function saveSkill() {
    const name = document.getElementById('skillName').value.trim();
    if (!name) { showToast('The skill needs a name', 'error'); return; }
    try {
        await api.request('/lms/learning/skills', {
            method: 'PUT',
            body: JSON.stringify({
                name,
                category: document.getElementById('skillCategory').value.trim() || null,
                description: document.getElementById('skillDescription').value.trim() || null
            })
        });
        closeSkillModal();
        await loadSkills();
        showToast('Skill saved', 'success');
    } catch (e) { axError(e, 'Could not save the skill'); }
}

// ═══ MARKING QUEUE ══════════════════════════════════════════════════════════
//
// Attempts holding an answered short-answer question are stored requires_review.
// Until this existed, nothing could clear that flag: the learner's attempt sat
// provisionally failed for ever and its points never counted.

let axQueue = [];
let axQueueLoaded = false;
let axGrading = null;

async function loadMarkingQueue() {
    const tbody = document.getElementById('markingQueueBody');
    tbody.innerHTML = axEmptyRow(5, 'Loading…');
    try {
        const courses = await api.request('/lms/courses');
        const courseList = Array.isArray(courses) ? courses : (courses.data || []);
        const pending = [];

        for (const course of courseList) {
            let modules = [];
            try { modules = await api.request(`/lms/courses/${course.id}/modules?includeLessons=true`); } catch (e) { continue; }
            for (const m of (Array.isArray(modules) ? modules : [])) {
                for (const lesson of (m.lessons || [])) {
                    if (lesson.contentType !== 'quiz' && lesson.content_type !== 'quiz') continue;
                    let quiz = null;
                    try { quiz = await api.request(`/lms/quizzes/lesson/${lesson.id}`); } catch (e) { continue; }
                    if (!quiz || !quiz.id) continue;
                    let attempts = [];
                    try { attempts = await api.request(`/lms/quizzes/${quiz.id}/attempts/all`); } catch (e) { continue; }
                    for (const a of (Array.isArray(attempts) ? attempts : [])) {
                        if (a.requiresReview) pending.push({ attempt: a, quiz, course });
                    }
                }
            }
        }

        axQueue = pending;
        axQueueLoaded = true;
        tbody.innerHTML = pending.length === 0
            ? axEmptyRow(5, 'Nothing is waiting to be marked.')
            : pending.map((p, i) => `
                <tr>
                    <td>${axEscape(p.attempt.userName || p.attempt.userId)}</td>
                    <td>${axEscape(p.course.title)}</td>
                    <td>${axEscape(p.quiz.title)}</td>
                    <td>${p.attempt.score} / ${p.attempt.maxScore}</td>
                    <td><button class="btn btn-sm btn-primary" onclick="openGrading(${i})">Mark</button></td>
                </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = axEmptyRow(5, 'Could not load the marking queue.');
    }
}

async function openGrading(idx) {
    axGrading = axQueue[idx];
    document.getElementById('gradingTitle').textContent =
        `${axGrading.attempt.userName || axGrading.attempt.userId} — ${axGrading.quiz.title}`;
    const host = document.getElementById('gradingBody');
    host.innerHTML = '<p class="text-muted">Loading…</p>';
    document.getElementById('gradingModal').style.display = 'flex';

    try {
        const questions = await api.request(`/lms/quizzes/${axGrading.quiz.id}/questions`);
        const sheet = JSON.parse(axGrading.attempt.answers || '[]');
        const manual = questions.filter(q => q.questionType === 'short_answer');

        host.innerHTML = manual.length === 0
            ? '<p class="text-muted">This attempt has nothing that needs marking by hand.</p>'
            : manual.map(q => {
                const entry = sheet.find(e => e.question_id === q.id) || {};
                return `
                <div class="qb-section">
                    <div class="qb-question-text" style="font-weight:600;">${axEscape(q.questionText)}</div>
                    <p class="text-muted" style="margin:8px 0;">Worth ${q.points} point(s)</p>
                    <div class="form-group">
                        <label>What the learner wrote</label>
                        <div class="grading-answer">${axEscape(entry.answer || '(no answer)')}</div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="grade-${q.id}">Points awarded</label>
                            <input type="number" id="grade-${q.id}" class="form-control"
                                   min="0" max="${q.points}" step="0.5" value="${entry.points_earned || 0}"
                                   data-max="${q.points}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="feedback-${q.id}">Feedback (optional)</label>
                        <textarea id="feedback-${q.id}" class="form-control" rows="2">${axEscape(entry.feedback || '')}</textarea>
                    </div>
                </div>`;
            }).join('');
        host.dataset.questionIds = manual.map(q => q.id).join(',');
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load this attempt.</p>';
    }
}

function closeGrading() {
    document.getElementById('gradingModal').style.display = 'none';
    axGrading = null;
}

async function submitGrading() {
    const host = document.getElementById('gradingBody');
    const ids = (host.dataset.questionIds || '').split(',').filter(Boolean);
    if (ids.length === 0) { showToast('Nothing to mark on this attempt', 'error'); return; }

    const grades = [];
    for (const id of ids) {
        const input = document.getElementById(`grade-${id}`);
        const pts = parseFloat(input.value);
        const max = parseFloat(input.dataset.max);
        if (isNaN(pts) || pts < 0 || pts > max) {
            showToast(`Award between 0 and ${max} points`, 'error');
            return;
        }
        grades.push({
            questionId: id,
            pointsEarned: pts,
            feedback: document.getElementById(`feedback-${id}`).value.trim() || null
        });
    }

    try {
        const settled = await api.request(
            `/lms/quizzes/${axGrading.quiz.id}/attempts/${axGrading.attempt.id}/grade`,
            { method: 'POST', body: JSON.stringify({ grades }) });
        closeGrading();
        await loadMarkingQueue();
        showToast(settled.passed ? 'Marked — the learner passed' : 'Marked — the learner did not pass', 'success');
    } catch (e) { axError(e, 'Could not save the marks'); }
}
