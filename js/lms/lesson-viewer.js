/**
 * LMS Lesson Viewer JavaScript
 * Handles lesson content display, TOC sidebar, progress tracking, navigation
 */

let courseId = null;
let lessonId = null;
let courseData = null;
let modulesData = [];
let currentLesson = null;
let flatLessons = []; // flat ordered list of all lesson IDs for prev/next
let autoSaveInterval = null;
let sidebarOpen = true;

// Utility: escape HTML
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Initialization ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // No main navigation in lesson viewer — it's full-width

    const params = new URLSearchParams(window.location.search);
    courseId = params.get('courseId');
    lessonId = params.get('lessonId');

    if (!courseId || !lessonId) {
        showToast('Missing course or lesson ID', 'error');
        return;
    }

    // Set back link
    const backLink = document.getElementById('backToCourse');
    if (backLink) backLink.href = `course-detail.html?id=${courseId}`;

    await loadCourseTOC();
    await loadLesson(lessonId);

    // Start auto-save progress every 30 seconds
    autoSaveInterval = setInterval(() => autoSaveProgress(), 30000);
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
});

// ─── Load Course TOC ────────────────────────────────────────────────────────

async function loadCourseTOC() {
    try {
        // Fetch course info
        courseData = await api.request(`/lms/courses/${courseId}`);
        document.getElementById('sidebarCourseTitle').textContent = courseData.title || 'Course';

        // Fetch modules with lessons
        const response = await api.request(`/lms/courses/${courseId}/modules?includeLessons=true`);
        modulesData = response.modules || response || [];

        renderTOC();
        buildFlatLessonList();
        updateProgress();
    } catch (error) {
        console.error('Error loading course TOC:', error);
        document.getElementById('lessonToc').innerHTML = '<div class="lms-empty-state">Failed to load course outline.</div>';
    }
}

function renderTOC() {
    const tocEl = document.getElementById('lessonToc');
    if (!modulesData || modulesData.length === 0) {
        tocEl.innerHTML = '<div class="lms-empty-state">No modules found.</div>';
        return;
    }

    tocEl.innerHTML = modulesData.map((mod, idx) => `
        <div class="toc-module">
            <div class="toc-module-header" onclick="toggleTocModule(this)">
                <svg class="toc-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span class="toc-module-title">Module ${idx + 1}: ${escapeHtml(mod.title)}</span>
            </div>
            <div class="toc-module-lessons open">
                ${(mod.lessons || []).map(lesson => `
                    <a href="lesson-viewer.html?courseId=${courseId}&lessonId=${lesson.id}"
                       class="toc-lesson ${lesson.id === lessonId ? 'active' : ''} ${lesson.is_completed ? 'completed' : ''}">
                        <span class="toc-lesson-status">
                            ${lesson.is_completed
                                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
                                : '<span class="toc-lesson-dot"></span>'
                            }
                        </span>
                        <span class="toc-lesson-title">${escapeHtml(lesson.title)}</span>
                    </a>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function toggleTocModule(headerEl) {
    const lessonsEl = headerEl.nextElementSibling;
    lessonsEl.classList.toggle('open');
    headerEl.classList.toggle('collapsed');
}

function buildFlatLessonList() {
    flatLessons = [];
    modulesData.forEach(mod => {
        (mod.lessons || []).forEach(lesson => {
            flatLessons.push(lesson.id);
        });
    });
    updateNavButtons();
}

// ─── Load Lesson ────────────────────────────────────────────────────────────

async function loadLesson(id) {
    try {
        currentLesson = await api.request(`/lms/lessons/${id}`);
        document.title = `${escapeHtml(currentLesson.title)} - LMS | Ragenaizer`;
        renderContent();
        updateNavButtons();
        updateMarkCompleteButton();
    } catch (error) {
        console.error('Error loading lesson:', error);
        showToast('Failed to load lesson', 'error');
        document.getElementById('lessonPlaceholder').innerHTML = '<div class="lms-empty-state">Failed to load lesson content.</div>';
    }
}

// ─── Render Content ─────────────────────────────────────────────────────────

function renderContent() {
    if (!currentLesson) return;

    // Hide all content wrappers
    document.getElementById('videoWrapper').style.display = 'none';
    document.getElementById('documentWrapper').style.display = 'none';
    document.getElementById('textContentWrapper').style.display = 'none';
    document.getElementById('lessonPlaceholder').style.display = 'none';

    const type = currentLesson.content_type || 'text';

    switch (type) {
        case 'video':
            initVideoPlayer();
            break;
        case 'document':
            renderDocumentViewer();
            break;
        case 'text':
        default:
            renderTextContent();
            break;
    }
}

function initVideoPlayer() {
    const wrapper = document.getElementById('videoWrapper');
    const video = document.getElementById('lessonVideo');
    wrapper.style.display = 'block';

    if (currentLesson.content_url) {
        video.src = currentLesson.content_url;
        video.load();
    } else {
        wrapper.innerHTML = '<div class="lms-empty-state">No video URL provided.</div>';
    }
}

function renderDocumentViewer() {
    const wrapper = document.getElementById('documentWrapper');
    const iframe = document.getElementById('lessonDocument');
    wrapper.style.display = 'block';

    if (currentLesson.content_url) {
        iframe.src = currentLesson.content_url;
    } else {
        wrapper.innerHTML = '<div class="lms-empty-state">No document URL provided.</div>';
    }
}

function renderTextContent() {
    const wrapper = document.getElementById('textContentWrapper');
    const contentEl = document.getElementById('lessonTextContent');
    wrapper.style.display = 'block';

    if (currentLesson.content_text) {
        // Render as HTML (assumes sanitized from backend)
        contentEl.innerHTML = currentLesson.content_text;
    } else if (currentLesson.content_url) {
        contentEl.innerHTML = `<p>View content: <a href="${escapeHtml(currentLesson.content_url)}" target="_blank">${escapeHtml(currentLesson.content_url)}</a></p>`;
    } else {
        contentEl.innerHTML = '<p>No content available for this lesson.</p>';
    }
}

// ─── Navigation ─────────────────────────────────────────────────────────────

function updateNavButtons() {
    if (!flatLessons.length || !lessonId) return;

    const currentIdx = flatLessons.indexOf(lessonId);
    const prevBtn = document.getElementById('prevLessonBtn');
    const nextBtn = document.getElementById('nextLessonBtn');

    if (prevBtn) prevBtn.disabled = currentIdx <= 0;
    if (nextBtn) nextBtn.disabled = currentIdx >= flatLessons.length - 1;
}

function navigateLesson(direction) {
    if (!flatLessons.length || !lessonId) return;

    const currentIdx = flatLessons.indexOf(lessonId);
    let targetIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;

    if (targetIdx < 0 || targetIdx >= flatLessons.length) return;

    const targetLessonId = flatLessons[targetIdx];
    window.location.href = `lesson-viewer.html?courseId=${courseId}&lessonId=${targetLessonId}`;
}

// ─── Mark Complete ──────────────────────────────────────────────────────────

function updateMarkCompleteButton() {
    const btn = document.getElementById('markCompleteBtn');
    if (!btn || !currentLesson) return;

    if (currentLesson.is_completed) {
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            Completed
        `;
        btn.classList.add('completed');
        btn.disabled = true;
    }
}

async function markComplete() {
    if (!lessonId) return;

    const btn = document.getElementById('markCompleteBtn');
    if (btn) btn.disabled = true;

    try {
        await api.request(`/lms/progress/lesson/${lessonId}/complete`, {
            method: 'POST'
        });
        showToast('Lesson marked as complete!', 'success');

        // Update local state
        if (currentLesson) currentLesson.is_completed = true;
        updateMarkCompleteButton();

        // Update TOC to show checkmark
        const tocLesson = document.querySelector(`.toc-lesson.active`);
        if (tocLesson) tocLesson.classList.add('completed');

        // Refresh progress
        await updateProgress();
    } catch (error) {
        console.error('Error marking complete:', error);
        showToast('Failed to mark as complete', 'error');
        if (btn) btn.disabled = false;
    }
}

// ─── Auto-Save Progress ────────────────────────────────────────────────────

async function autoSaveProgress() {
    if (!lessonId) return;

    try {
        const payload = {};

        // If video, track current time
        const video = document.getElementById('lessonVideo');
        if (video && !video.paused && video.currentTime > 0) {
            payload.video_position = Math.floor(video.currentTime);
        }

        await api.request(`/lms/progress/lesson/${lessonId}`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    } catch (error) {
        // Silent fail for auto-save
        console.debug('Auto-save progress failed:', error);
    }
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

async function updateProgress() {
    try {
        const status = await api.request(`/lms/enrollments/course/${courseId}/status`);
        const pct = status.progress_percentage || 0;
        document.getElementById('courseProgressFill').style.width = `${pct}%`;
        document.getElementById('courseProgressText').textContent = `${Math.round(pct)}% complete`;
    } catch (error) {
        // Ignore — user may not be enrolled
    }
}

// ─── Sidebar Toggle ─────────────────────────────────────────────────────────

function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    const sidebar = document.getElementById('lessonSidebar');
    const main = document.getElementById('lessonMain');

    if (sidebarOpen) {
        sidebar.classList.remove('collapsed');
        main.classList.remove('sidebar-collapsed');
    } else {
        sidebar.classList.add('collapsed');
        main.classList.add('sidebar-collapsed');
    }
}
