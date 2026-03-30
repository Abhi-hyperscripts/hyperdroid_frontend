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

        document.getElementById('quizBreadcrumb').textContent = data.title || 'Quiz';
        document.getElementById('quizTitle').textContent = data.title || 'Quiz';
        document.getElementById('quizDescription').textContent = data.description || '';
        document.getElementById('quizQuestionCount').textContent = data.question_count || '-';
        document.getElementById('quizTimeLimit').textContent = data.time_limit_minutes ? data.time_limit_minutes + ' min' : 'No limit';
        document.getElementById('quizPassingScore').textContent = data.passing_score != null ? data.passing_score + '%' : '-';
        document.getElementById('quizAttempts').textContent = data.attempts_used != null
            ? `${data.attempts_used} / ${data.max_attempts || 'Unlimited'}`
            : '-';

        showScreen('quizStartScreen');
    } catch (err) {
        console.error('Failed to load quiz:', err);
        document.getElementById('quizLoading').innerHTML = '<p style="color:var(--color-error);">Failed to load quiz. Please try again.</p>';
    }
}

// ==================== Start Quiz ====================

async function startQuiz() {
    try {
        const response = await api.request(`/lms/quizzes/${quizId}/start`, { method: 'POST' });
        attemptId = response.attempt_id;
        questions = response.questions || [];
        totalTime = (response.time_limit_minutes || quizData.time_limit_minutes || 0) * 60;
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

    const payload = {
        attempt_id: attemptId,
        answers: questions.map((q, i) => ({
            question_id: q.id || q.question_id,
            answer: answers[i] != null ? answers[i] : null
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

// ==================== Results ====================

function renderResults(result) {
    const passed = result.passed;
    const score = result.score_percentage ?? result.score ?? 0;
    const correct = result.correct_count ?? 0;
    const total = result.total_questions ?? questions.length;

    document.getElementById('resultIcon').innerHTML = passed
        ? '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        : '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

    document.getElementById('resultTitle').textContent = passed ? 'Congratulations!' : 'Not Passed';
    document.getElementById('resultTitle').style.color = passed ? 'var(--color-success)' : 'var(--color-error)';
    document.getElementById('resultSubtitle').textContent = passed
        ? 'You passed the quiz successfully.'
        : 'You did not meet the passing score. You may retry if attempts remain.';

    document.getElementById('resultScore').textContent = Math.round(score) + '%';
    document.getElementById('resultCorrect').textContent = correct;
    document.getElementById('resultTotal').textContent = total;

    const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    document.getElementById('resultTimeTaken').textContent = `${mins}m ${secs}s`;

    // Store review data if available
    window._quizReviewData = result.review || result.answers || null;

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

    const items = reviewData || questions.map((q, i) => ({
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
