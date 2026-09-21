/**
 * LMS Quiz
 * Handles quiz taking: start, answer, navigate, submit, results, review.
 */

// ==================== State ====================
let quizId = null;
let attemptId = null;
let quizData = null;
let questions = [];
let answers = {};          // { questionIndex: selectedAnswer }
let currentIndex = 0;
let timerInterval = null;
let timeRemaining = 0;     // seconds
let totalTime = 0;         // seconds
let startTime = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('lms', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    quizId = params.get('id');

    if (!quizId) {
        showScreen('quizLoading');
        document.getElementById('quizLoading').innerHTML = '<p style="color:var(--color-error);">No quiz ID provided.</p>';
        return;
    }

    loadQuizInfo();
});

// ==================== Screen Management ====================

function showScreen(id) {
    ['quizLoading', 'quizStartScreen', 'quizInProgress', 'quizResults'].forEach(s => {
        document.getElementById(s).style.display = s === id ? '' : 'none';
    });
}

// ==================== Load Quiz Info ====================

async function loadQuizInfo() {
    try {
        const data = await api.request(`/lms/quizzes/${quizId}`);
        quizData = data;

        // camelCase first. The API has always answered in camelCase; reading only snake_case
        // meant every field on this screen rendered "-" even once the route existed.
        const questionCount = data.questionCount ?? data.question_count;
        const timeLimit = data.timeLimitMinutes ?? data.time_limit_minutes;
        const passing = data.passingScore ?? data.passing_score;
        const used = data.attemptsUsed ?? data.attempts_used;
        const maxAttempts = data.maxAttempts ?? data.max_attempts;

        document.getElementById('quizBreadcrumb').textContent = data.title || 'Quiz';
        document.getElementById('quizTitle').textContent = data.title || 'Quiz';
        document.getElementById('quizDescription').textContent = data.description || '';
        document.getElementById('quizQuestionCount').textContent = questionCount ?? '-';
        document.getElementById('quizTimeLimit').textContent = timeLimit ? timeLimit + ' min' : 'No limit';
        document.getElementById('quizPassingScore').textContent = passing != null ? passing + '%' : '-';
        // 0 is a real and important value here — a learner with no attempts left must see
        // "0 / 3", so this tests for null rather than for truthiness.
        document.getElementById('quizAttempts').textContent = used != null
            ? `${used} / ${maxAttempts || 'Unlimited'}`
            : '-';

        // Only offered once there is a history to look at.
        const pastBtn = document.getElementById('quizPastAttemptsBtn');
        if (pastBtn && used > 0) pastBtn.style.display = '';

        showScreen('quizStartScreen');
    } catch (err) {
        console.error('Failed to load quiz:', err);
        document.getElementById('quizLoading').innerHTML = '<p style="color:var(--color-error);">Failed to load quiz. Please try again.</p>';
    }
}

/**
 * One shape for a question, whatever the wire sends.
 *
 * options arrives as a JSONB string ("[\"Water\", \"CO2\"]"), not an array — calling .map on
 * it throws, so a question whose type WAS recognised would have taken the page down rather
 * than merely rendering blank.
 */
function normaliseQuestion(q) {
    let options = q.options;
    if (typeof options === 'string') {
        try { options = JSON.parse(options); } catch (e) { options = []; }
    }
    if (!Array.isArray(options)) options = [];

    return {
        ...q,
        question_text: q.questionText ?? q.question_text ?? '',
        question_type: q.questionType ?? q.question_type ?? '',
        options
    };
}

// ==================== Start Quiz ====================

async function startQuiz() {
    try {
        const response = await api.request(`/lms/quizzes/${quizId}/start`, { method: 'POST' });
        attemptId = response.attemptId ?? response.attempt_id;
        // Normalised ONCE, here, into the names the rest of this file reads. The API answers in
        // camelCase and stores options as a JSONB string, so the paper rendered "Q1. undefined"
        // and "Unknown question type: undefined" for every question — and the options mapping
        // would have thrown on a string the moment a type WAS recognised.
        questions = (response.questions || []).map(normaliseQuestion);
        totalTime = (response.timeLimitMinutes ?? response.time_limit_minutes
                     ?? quizData.timeLimitMinutes ?? quizData.time_limit_minutes ?? 0) * 60;
        timeRemaining = totalTime;
        answers = {};
        currentIndex = 0;
        startTime = Date.now();

        document.getElementById('totalQuestionNum').textContent = questions.length;
        renderQuestionDots();
        renderQuestion(0);

        if (totalTime > 0) {
            startTimer();
        } else {
            document.getElementById('timerDisplay').textContent = 'No limit';
            document.getElementById('timerProgressBar').style.width = '100%';
        }

        showScreen('quizInProgress');
    } catch (err) {
        console.error('Failed to start quiz:', err);
        if (typeof showToast === 'function') showToast('Failed to start quiz: ' + (err.message || 'Unknown error'), 'error');
    }
}

// ==================== Timer ====================

function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            autoSubmit();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(Math.max(0, timeRemaining) / 60);
    const seconds = Math.max(0, timeRemaining) % 60;
    const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    document.getElementById('timerDisplay').textContent = display;

    if (totalTime > 0) {
        const pct = (timeRemaining / totalTime) * 100;
        document.getElementById('timerProgressBar').style.width = pct + '%';

        if (timeRemaining <= 60) {
            document.getElementById('timerDisplay').style.color = 'var(--color-error)';
            document.getElementById('timerProgressBar').style.background = 'var(--color-error)';
        } else if (timeRemaining <= 300) {
            document.getElementById('timerDisplay').style.color = 'var(--color-warning)';
            document.getElementById('timerProgressBar').style.background = 'var(--color-warning)';
        }
    }
}

function autoSubmit() {
    if (typeof showToast === 'function') showToast('Time is up! Submitting quiz...', 'warning');
    submitQuiz();
}

// ==================== Question Navigation ====================

function renderQuestionDots() {
    const container = document.getElementById('questionDots');
    container.innerHTML = questions.map((_, i) => {
        return `<button class="quiz-dot${i === currentIndex ? ' active' : ''}${answers[i] != null ? ' answered' : ''}"
                    onclick="goToQuestion(${i})" title="Question ${i + 1}">${i + 1}</button>`;
    }).join('');
}

function goToQuestion(index) {
    if (index < 0 || index >= questions.length) return;
    currentIndex = index;
    renderQuestion(index);
    renderQuestionDots();
    updateNavButtons();
}

function previousQuestion() {
    if (currentIndex > 0) goToQuestion(currentIndex - 1);
}

function nextQuestion() {
    if (currentIndex < questions.length - 1) goToQuestion(currentIndex + 1);
}

function updateNavButtons() {
    document.getElementById('prevBtn').disabled = currentIndex === 0;
    document.getElementById('nextBtn').style.display = currentIndex === questions.length - 1 ? 'none' : '';
    document.getElementById('submitQuizBtn').style.display = currentIndex === questions.length - 1 ? '' : 'none';
    document.getElementById('currentQuestionNum').textContent = currentIndex + 1;
}

// ==================== Render Question ====================

function renderQuestion(index) {
    const q = questions[index];
    if (!q) return;

    document.getElementById('questionText').textContent = `Q${index + 1}. ${q.question_text}`;

    const area = document.getElementById('answerArea');
    const savedAnswer = answers[index];

    if (q.question_type === 'mcq' || q.question_type === 'multiple_choice') {
        area.innerHTML = (q.options || []).map((opt, oi) => `
            <label style="display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4);
                          border: 1px solid var(--border-primary); border-radius: var(--radius-md); margin-bottom: var(--space-2);
                          cursor: pointer; transition: border-color var(--transition-fast);"
                   class="quiz-option${savedAnswer === oi ? ' selected' : ''}"
                   onclick="selectAnswer(${index}, ${oi})">
                <input type="radio" name="q${index}" value="${oi}" ${savedAnswer === oi ? 'checked' : ''}
                       style="accent-color: var(--brand-primary); width: 18px; height: 18px;">
                <span style="color: var(--text-primary);">${opt}</span>
            </label>
        `).join('');
    } else if (q.question_type === 'true_false') {
        area.innerHTML = ['True', 'False'].map((opt, oi) => `
            <label style="display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4);
                          border: 1px solid var(--border-primary); border-radius: var(--radius-md); margin-bottom: var(--space-2);
                          cursor: pointer;"
                   class="quiz-option${savedAnswer === oi ? ' selected' : ''}"
                   onclick="selectAnswer(${index}, ${oi})">
                <input type="radio" name="q${index}" value="${oi}" ${savedAnswer === oi ? 'checked' : ''}
                       style="accent-color: var(--brand-primary); width: 18px; height: 18px;">
                <span style="color: var(--text-primary);">${opt}</span>
            </label>
        `).join('');
    } else if (q.question_type === 'fill_blank' || q.question_type === 'short_answer') {
        area.innerHTML = `
            <input type="text" id="fillBlankInput" class="form-control"
                   placeholder="Type your answer..."
                   value="${savedAnswer || ''}"
                   oninput="saveTextAnswer(${index}, this.value)"
                   style="max-width: 500px; background: var(--bg-secondary); color: var(--text-primary);
                          border: 1px solid var(--border-primary); padding: var(--space-3);">
        `;
    } else {
        area.innerHTML = `<p style="color: var(--text-muted);">Unknown question type: ${q.question_type}</p>`;
    }

    updateNavButtons();
}

// ==================== Save Answers ====================

function selectAnswer(questionIndex, optionIndex) {
    answers[questionIndex] = optionIndex;
    renderQuestion(questionIndex);
    renderQuestionDots();
}

function saveTextAnswer(questionIndex, value) {
    answers[questionIndex] = value.trim() || null;
    renderQuestionDots();
}

// ==================== Submit Quiz ====================

function confirmSubmitQuiz() {
    const answered = Object.keys(answers).filter(k => answers[k] != null).length;
    document.getElementById('answeredCount').textContent = answered;
    document.getElementById('totalCount').textContent = questions.length;

    const warning = document.getElementById('unansweredWarning');
    warning.style.display = answered < questions.length ? '' : 'none';

    document.getElementById('confirmSubmitModal').classList.add('active');
}

function closeConfirmSubmitModal() {
    document.getElementById('confirmSubmitModal').classList.remove('active');
}

async function submitQuiz() {
    closeConfirmSubmitModal();

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // camelCase. The endpoint binds QuestionId, and ASP.NET's case-insensitive matching does
    // NOT bridge snake_case — so "question_id" bound to Guid.Empty, matched no question, and
    // every answer was discarded. Measured: the same paper scored 0/8 sent as question_id and
    // 3/8 sent as questionId. Every quiz ever submitted from this page scored zero.
    //
    // attempt_id is not sent at all: the server finds the caller's own unsubmitted attempt,
    // which is the only one it will accept, and a client-supplied id was never read.
    const payload = {
        answers: questions.map((q, i) => ({
            questionId: q.id || q.question_id,
            answer: answerForWire(q, answers[i])
        }))
    };

    try {
        const result = await api.request(`/lms/quizzes/${quizId}/submit`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        renderResults(result);
    } catch (err) {
        console.error('Failed to submit quiz:', err);
        if (typeof showToast === 'function') showToast('Failed to submit quiz: ' + (err.message || 'Unknown error'), 'error');
    }
}

/**
 * The answer as the GRADER reads it.
 *
 * Choice questions are recorded here as the option's INDEX, because that is what the radio
 * group needs to re-select it. The grader compares the answer to the stored correct answer as
 * TEXT ("CO2"), case-insensitively — so sending the index would never match anything, and a
 * learner who picked every right answer would still score zero.
 */
function answerForWire(q, saved) {
    if (saved == null || saved === '') return null;

    if (q.question_type === 'mcq' || q.question_type === 'multiple_choice') {
        return typeof saved === 'number' ? (q.options[saved] ?? String(saved)) : String(saved);
    }
    if (q.question_type === 'true_false') {
        // 0 is True, matching the ['True', 'False'] order the page renders.
        return typeof saved === 'number' ? (saved === 0 ? 'True' : 'False') : String(saved);
    }
    return String(saved);
}

// ==================== Results ====================

/** Question types no grader can settle on its own — they wait for a person. */
const MANUALLY_GRADED = ['short_answer', 'essay'];


function renderResults(result) {
    // The attempt sheet is the source of truth for what was right. correct_count and
    // score_percentage have never been in this response — reading them showed "Correct 0"
    // next to two correct answers, and printed the raw POINTS as a percentage ("3%" for
    // 3 out of 8).
    let sheet = [];
    try {
        sheet = typeof result.answers === 'string' ? JSON.parse(result.answers || '[]')
              : (Array.isArray(result.answers) ? result.answers : []);
    } catch (e) { sheet = []; }

    const points = result.score ?? 0;
    const maxPoints = result.maxScore ?? result.max_score ?? 0;
    const pct = maxPoints > 0 ? (points / maxPoints) * 100 : 0;
    const correct = sheet.filter(e => e.is_correct === true).length;
    const total = sheet.length || result.total_questions || questions.length;

    // An attempt holding an unmarked answer is UNDECIDED, not failed. Saying "Not Passed"
    // to someone whose paper is still with a marker is both wrong and discouraging — and it
    // throws away the whole point of tracking requiresReview.
    const awaiting = result.requiresReview === true || result.requires_review === true;
    const passed = result.passed === true;

    const icon = awaiting
        ? '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
        : passed
        ? '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        : '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    document.getElementById('resultIcon').innerHTML = icon;

    const title = document.getElementById('resultTitle');
    title.textContent = awaiting ? 'Awaiting marking' : passed ? 'Congratulations!' : 'Not Passed';
    title.style.color = awaiting ? 'var(--color-warning)'
                      : passed ? 'var(--color-success)' : 'var(--color-error)';

    document.getElementById('resultSubtitle').textContent = awaiting
        ? 'One of your answers has to be marked by hand. Your result is not decided yet, and the points below do not include it.'
        : passed
        ? 'You passed the quiz successfully.'
        : 'You did not meet the passing score. You may retry if attempts remain.';

    // Points, not a bare percentage: "3 / 8" is what a learner can check against the paper.
    document.getElementById('resultScore').textContent =
        maxPoints > 0 ? `${points} / ${maxPoints}` : Math.round(pct) + '%';
    document.getElementById('resultCorrect').textContent = correct;
    document.getElementById('resultTotal').textContent = total;

    const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    document.getElementById('resultTimeTaken').textContent = `${mins}m ${secs}s`;

    // Store review data if available
    // The PARSED sheet, joined to the paper. result.answers is a JSON string, so assigning it
    // straight through made the review panel call .map on a string and throw — Review Answers
    // did nothing at all. The sheet carries no question text, so each entry is matched back to
    // the question it belongs to.
    window._quizReviewData = sheet.length === 0 ? null : sheet.map(e => {
        const q = questions.find(x => (x.id || x.question_id) === e.question_id) || {};
        return {
            question_text: q.question_text || '',
            question_type: q.question_type || '',
            options: q.options || [],
            your_answer: e.answer,
            correct_answer: e.correct_answer,
            // An answer still awaiting a marker is neither right nor wrong yet, and null is
            // what the renderer draws as "undecided". The grader writes is_correct false on a
            // manually-graded answer simply because nothing has marked it — drawing that as a
            // red "incorrect" stripe tells the learner they got it wrong before anyone looked.
            is_correct: (awaiting && MANUALLY_GRADED.includes(q.question_type))
                ? null
                : (e.is_correct === undefined ? null : e.is_correct)
        };
    });

    showScreen('quizResults');
}

function toggleReviewAnswers() {
    const container = document.getElementById('answerReview');
    if (container.style.display === 'none' || !container.style.display) {
        container.style.display = '';
        renderReviewAnswers(container);
    } else {
        container.style.display = 'none';
    }
}

function renderReviewAnswers(container) {
    const reviewData = window._quizReviewData;

    if (!reviewData && questions.length === 0) {
        container.innerHTML = '<div class="lms-card" style="padding:var(--space-5);"><p style="color:var(--text-muted);">Answer review is not available for this quiz.</p></div>';
        return;
    }

    // Defensive: a caller that hands a JSON string (as this code used to) gets it parsed
    // rather than throwing halfway down the render.
    let parsed = reviewData;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
    }
    if (!Array.isArray(parsed)) parsed = null;

    const items = parsed || questions.map((q, i) => ({
        question_text: q.question_text,
        your_answer: answers[i],
        correct_answer: q.correct_answer,
        is_correct: null,
        options: q.options,
        question_type: q.question_type
    }));

    container.innerHTML = items.map((item, i) => {
        const isCorrect = item.is_correct;
        const borderColor = isCorrect === true ? 'var(--color-success)' : isCorrect === false ? 'var(--color-error)' : 'var(--border-primary)';
        const yourAnswer = formatReviewAnswer(item);
        const correctAnswer = item.correct_answer != null ? formatAnswerValue(item, item.correct_answer) : '-';

        return `
            <div class="lms-card" style="margin-bottom: var(--space-3); border-left: 3px solid ${borderColor}; padding: var(--space-4);">
                <p style="font-weight: var(--font-weight-semibold); color: var(--text-primary); margin-bottom: var(--space-2);">
                    Q${i + 1}. ${item.question_text || ''}
                </p>
                <p style="color: var(--text-secondary); font-size: var(--font-size-sm);">
                    Your answer: <strong>${yourAnswer}</strong>
                </p>
                ${isCorrect === false ? `<p style="color: var(--color-success); font-size: var(--font-size-sm);">Correct answer: <strong>${correctAnswer}</strong></p>` : ''}
            </div>
        `;
    }).join('');
}

function formatReviewAnswer(item) {
    if (item.your_answer == null) return '<em>Not answered</em>';
    if (item.options && typeof item.your_answer === 'number') {
        return item.options[item.your_answer] || String(item.your_answer);
    }
    if (item.question_type === 'true_false' && typeof item.your_answer === 'number') {
        return item.your_answer === 0 ? 'True' : 'False';
    }
    return String(item.your_answer);
}

function formatAnswerValue(item, val) {
    if (item.options && typeof val === 'number') {
        return item.options[val] || String(val);
    }
    if (item.question_type === 'true_false' && typeof val === 'number') {
        return val === 0 ? 'True' : 'False';
    }
    return String(val);
}
