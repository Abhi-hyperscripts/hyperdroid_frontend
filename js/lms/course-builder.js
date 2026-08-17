/**
 * LMS Course Builder JavaScript
 * Handles course creation/editing, module/lesson management, draft/publish workflow
 */

let courseId = null;
let isEditMode = false;
let categories = [];
let builderModules = []; // local state of modules with lessons

/**
 * Show a prompt modal with an input field, returns Promise<string|null>
 */
function showPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';

        const card = document.createElement('div');
        card.style.cssText = 'background:var(--glass-bg-strong);border:1px solid var(--border-color-light);border-radius:14px;padding:24px;min-width:340px;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.3);';

        const label = document.createElement('label');
        label.textContent = message;
        label.style.cssText = 'display:block;margin-bottom:12px;color:var(--text-primary);font-size:14px;font-weight:500;';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue;
        input.style.cssText = 'width:100%;padding:10px 12px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-color-light);border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.style.cssText = 'padding:8px 16px;border-radius:8px;cursor:pointer;';

        const okBtn = document.createElement('button');
        okBtn.textContent = 'OK';
        okBtn.className = 'btn btn-primary';
        okBtn.style.cssText = 'padding:8px 16px;border-radius:8px;cursor:pointer;';

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        card.appendChild(label);
        card.appendChild(input);
        card.appendChild(btnRow);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        input.focus();
        input.select();

        function cleanup(value) {
            document.body.removeChild(overlay);
            resolve(value);
        }

        cancelBtn.addEventListener('click', () => cleanup(null));
        okBtn.addEventListener('click', () => cleanup(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') cleanup(input.value);
            if (e.key === 'Escape') cleanup(null);
        });
    });
}

// Utility: escape HTML
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Initialization ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    Navigation.init('lms', '../');

    initBuilderTabs();
    await loadCategories();

    courseId = new URLSearchParams(window.location.search).get('id');
    if (courseId) {
        isEditMode = true;
        document.getElementById('builderTitle').textContent = 'Edit Course';
        await loadCourseForEdit(courseId);
    } else {
        initForm();
    }
});

// ─── Tabs ───────────────────────────────────────────────────────────────────

function initBuilderTabs() {
    const tabs = document.querySelectorAll('#builderTabs .lms-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.getAttribute('data-tab');
            document.querySelectorAll('.lms-tab-pane').forEach(pane => pane.classList.remove('active'));
            const targetPane = document.getElementById('tab-' + target);
            if (targetPane) targetPane.classList.add('active');

            // Render preview when switching to preview tab
            if (target === 'preview') renderPreview();
        });
    });
}

// ─── Load Categories ────────────────────────────────────────────────────────

async function loadCategories() {
    try {
        const response = await api.request('/lms/categories');
        categories = response.categories || response || [];
        const select = document.getElementById('courseCategory');
        if (!select) return;

        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            select.appendChild(opt);
        });
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// ─── Init Form (new course) ─────────────────────────────────────────────────

function initForm() {
    // Default values already set in HTML
    builderModules = [];
    renderModulesList();
}

// ─── Load Course for Edit ───────────────────────────────────────────────────

async function loadCourseForEdit(id) {
    try {
        const course = await api.request(`/lms/courses/${id}`);

        // Populate form (handle both camelCase and snake_case from API)
        document.getElementById('courseTitle').value = course.title || '';
        document.getElementById('courseDescription').value = course.description || '';
        document.getElementById('courseThumbnail').value = course.thumbnailUrl || course.thumbnail_url || '';
        const durationMins = course.estimatedDurationMinutes || course.estimated_duration_minutes || 0;
        document.getElementById('courseDuration').value = durationMins > 0 ? (durationMins / 60) : '';
        document.getElementById('coursePassingScore').value = course.passingScore || course.passing_score || 70;
        document.getElementById('courseTags').value = (course.tags || []).join(', ');

        // Category
        const catId = course.categoryId || course.category_id;
        if (catId) {
            document.getElementById('courseCategory').value = catId;
        }

        // Difficulty
        const diffLevel = course.difficultyLevel || course.difficulty_level;
        if (diffLevel) {
            document.getElementById('courseDifficulty').value = diffLevel;
        }

        // Enrollment type
        const enrollType = course.enrollmentType || course.enrollment_type;
        if (enrollType) {
            const radio = document.querySelector(`input[name="enrollmentType"][value="${enrollType}"]`);
            if (radio) radio.checked = true;
        }

        // Load modules
        const modResponse = await api.request(`/lms/courses/${id}/modules?includeLessons=true`);
        builderModules = (modResponse.modules || modResponse || []).map(mod => ({
            id: mod.id,
            title: mod.title,
            sort_order: mod.sortOrder || mod.sort_order,
            lessons: (mod.lessons || []).map(les => ({
                id: les.id,
                title: les.title,
                content_type: les.contentType || les.content_type,
                content_url: les.contentUrl || les.content_url,
                content_text: les.contentText || les.content_text,
                duration_minutes: les.durationMinutes || les.duration_minutes,
                is_mandatory: (les.isMandatory ?? les.is_mandatory) !== false,
                sort_order: les.sortOrder || les.sort_order
            }))
        }));

        renderModulesList();
    } catch (error) {
        console.error('Error loading course for edit:', error);
        showToast('Failed to load course', 'error');
    }
}

// ─── Module Management ──────────────────────────────────────────────────────

async function addModule() {
    const moduleTitle = await showPrompt('Enter module title:');
    if (!moduleTitle || !moduleTitle.trim()) return;

    builderModules.push({
        id: null, // will be assigned by server
        title: moduleTitle.trim(),
        sort_order: builderModules.length + 1,
        lessons: []
    });

    renderModulesList();
}

async function removeModule(idx) {
    if (!await showConfirm('Remove this module and all its lessons?', 'Remove Module', 'danger')) return;
    builderModules.splice(idx, 1);
    // Re-order
    builderModules.forEach((m, i) => m.sort_order = i + 1);
    renderModulesList();
}

async function editModuleTitle(idx) {
    const newTitle = await showPrompt('Enter module title:', builderModules[idx].title);
    if (!newTitle || !newTitle.trim()) return;
    builderModules[idx].title = newTitle.trim();
    renderModulesList();
}

function moveModule(idx, direction) {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= builderModules.length) return;
    [builderModules[idx], builderModules[targetIdx]] = [builderModules[targetIdx], builderModules[idx]];
    builderModules.forEach((m, i) => m.sort_order = i + 1);
    renderModulesList();
}

// ─── Lesson Management ──────────────────────────────────────────────────────

function addLesson(moduleIdx) {
    openLessonEditor(null, moduleIdx);
}

function editLesson(moduleIdx, lessonIdx) {
    openLessonEditor(builderModules[moduleIdx].lessons[lessonIdx], moduleIdx, lessonIdx);
}

async function removeLesson(moduleIdx, lessonIdx) {
    if (!await showConfirm('Remove this lesson?', 'Remove Lesson', 'danger')) return;
    builderModules[moduleIdx].lessons.splice(lessonIdx, 1);
    builderModules[moduleIdx].lessons.forEach((l, i) => l.sort_order = i + 1);
    renderModulesList();
}

function moveLesson(moduleIdx, lessonIdx, direction) {
    const lessons = builderModules[moduleIdx].lessons;
    const targetIdx = direction === 'up' ? lessonIdx - 1 : lessonIdx + 1;
    if (targetIdx < 0 || targetIdx >= lessons.length) return;
    [lessons[lessonIdx], lessons[targetIdx]] = [lessons[targetIdx], lessons[lessonIdx]];
    lessons.forEach((l, i) => l.sort_order = i + 1);
    renderModulesList();
}

// ─── Lesson Editor Modal ────────────────────────────────────────────────────

let editingModuleIdx = null;
let editingLessonIdx = null;

function openLessonEditor(lesson, moduleIdx, lessonIdx) {
    editingModuleIdx = moduleIdx;
    editingLessonIdx = lessonIdx !== undefined ? lessonIdx : null;

    const modal = document.getElementById('lessonEditorModal');
    document.getElementById('lessonEditorTitle').textContent = lesson ? 'Edit Lesson' : 'Add Lesson';

    // Reset form
    document.getElementById('lessonEditTitle').value = lesson ? lesson.title : '';
    document.getElementById('lessonEditContentUrl').value = lesson ? (lesson.content_url || '') : '';
    document.getElementById('lessonEditContentText').value = lesson ? (lesson.content_text || '') : '';
    document.getElementById('lessonEditDuration').value = lesson ? (lesson.duration_minutes || '') : '';
    document.getElementById('lessonEditMandatory').checked = lesson ? (lesson.is_mandatory !== false) : true;

    // Content type
    const contentType = lesson ? (lesson.content_type || 'video') : 'video';
    const radio = document.querySelector(`input[name="lessonContentType"][value="${contentType}"]`);
    if (radio) radio.checked = true;
    toggleLessonContentField();

    modal.style.display = 'flex';
}

function closeLessonEditor() {
    document.getElementById('lessonEditorModal').style.display = 'none';
    editingModuleIdx = null;
    editingLessonIdx = null;
}

function toggleLessonContentField() {
    const contentType = document.querySelector('input[name="lessonContentType"]:checked')?.value || 'video';
    const urlGroup = document.getElementById('lessonContentUrlGroup');
    const textGroup = document.getElementById('lessonContentTextGroup');

    if (contentType === 'text') {
        urlGroup.style.display = 'none';
        textGroup.style.display = 'block';
    } else {
        urlGroup.style.display = 'block';
        textGroup.style.display = 'none';
    }
}

function saveLessonEditor() {
    const title = document.getElementById('lessonEditTitle').value.trim();
    if (!title) {
        showToast('Lesson title is required', 'error');
        return;
    }

    const contentType = document.querySelector('input[name="lessonContentType"]:checked')?.value || 'video';
    const lessonData = {
        id: null,
        title: title,
        content_type: contentType,
        content_url: contentType !== 'text' ? document.getElementById('lessonEditContentUrl').value.trim() : '',
        content_text: contentType === 'text' ? document.getElementById('lessonEditContentText').value : '',
        duration_minutes: parseInt(document.getElementById('lessonEditDuration').value) || null,
        is_mandatory: document.getElementById('lessonEditMandatory').checked,
        sort_order: 1
    };

    const lessons = builderModules[editingModuleIdx].lessons;

    if (editingLessonIdx !== null) {
        // Edit existing
        lessonData.id = lessons[editingLessonIdx].id;
        lessonData.sort_order = lessons[editingLessonIdx].sort_order;
        lessons[editingLessonIdx] = lessonData;
    } else {
        // Add new
        lessonData.sort_order = lessons.length + 1;
        lessons.push(lessonData);
    }

    closeLessonEditor();
    renderModulesList();
}

// ─── Render Modules List ────────────────────────────────────────────────────

function renderModulesList() {
    const container = document.getElementById('builderModulesList');
    if (!builderModules || builderModules.length === 0) {
        container.innerHTML = `
            <div class="builder-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="7" height="7"/>
                    <rect x="14" y="3" width="7" height="7"/>
                    <rect x="14" y="14" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/>
                </svg>
                <p>No modules yet. Click "Add Module" to start building your course.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = builderModules.map((mod, idx) => `
        <div class="builder-module-card" data-module-idx="${idx}">
            <div class="builder-module-header">
                <div class="builder-module-drag">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
                        <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
                    </svg>
                </div>
                <span class="builder-module-title">Module ${idx + 1}: ${escapeHtml(mod.title)}</span>
                <div class="builder-module-actions">
                    <button class="btn btn-sm btn-outline-secondary" onclick="moveModule(${idx}, 'up')" title="Move up" ${idx === 0 ? 'disabled' : ''}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="moveModule(${idx}, 'down')" title="Move down" ${idx === builderModules.length - 1 ? 'disabled' : ''}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="editModuleTitle(${idx})" title="Edit title">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-icon danger" onclick="removeModule(${idx})" title="Remove module">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
            <div class="builder-module-lessons">
                ${renderBuilderLessons(mod.lessons || [], idx)}
                <button class="btn-add-lesson" onclick="addLesson(${idx})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add Lesson
                </button>
            </div>
        </div>
    `).join('');
}

function renderBuilderLessons(lessons, moduleIdx) {
    if (!lessons || lessons.length === 0) return '';

    return lessons.map((lesson, lessonIdx) => `
        <div class="builder-lesson-item">
            <span class="builder-lesson-type-icon">${getBuilderLessonTypeIcon(lesson.content_type)}</span>
            <span class="builder-lesson-title">${escapeHtml(lesson.title)}</span>
            <span class="builder-lesson-duration">${lesson.duration_minutes ? lesson.duration_minutes + ' min' : ''}</span>
            <div class="builder-lesson-actions">
                <button class="btn btn-sm btn-outline-secondary" onclick="moveLesson(${moduleIdx}, ${lessonIdx}, 'up')" title="Move up" ${lessonIdx === 0 ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <button class="btn btn-sm btn-outline-secondary" onclick="moveLesson(${moduleIdx}, ${lessonIdx}, 'down')" title="Move down" ${lessonIdx === lessons.length - 1 ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <button class="btn btn-sm btn-outline-secondary" onclick="editLesson(${moduleIdx}, ${lessonIdx})" title="Edit">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-icon danger" onclick="removeLesson(${moduleIdx}, ${lessonIdx})" title="Remove">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

function getBuilderLessonTypeIcon(type) {
    switch (type) {
        case 'video':
            return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        case 'document':
            return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        case 'text':
            return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
        case 'quiz':
            return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        default:
            return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
    }
}

// ─── Preview ────────────────────────────────────────────────────────────────

function renderPreview() {
    const container = document.getElementById('builderPreview');
    const title = document.getElementById('courseTitle').value.trim();
    const desc = document.getElementById('courseDescription').value.trim();
    const difficulty = document.getElementById('courseDifficulty').value;
    const totalLessons = builderModules.reduce((sum, m) => sum + (m.lessons || []).length, 0);

    if (!title && builderModules.length === 0) {
        container.innerHTML = `
            <div class="builder-preview-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
                <p>Save your course settings and add modules to see a preview.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="builder-preview-card">
            <h2>${escapeHtml(title || 'Untitled Course')}</h2>
            <div class="builder-preview-meta">
                <span class="course-difficulty-badge difficulty-${difficulty}">${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}</span>
                <span>${totalLessons} lesson${totalLessons !== 1 ? 's' : ''}</span>
                <span>${builderModules.length} module${builderModules.length !== 1 ? 's' : ''}</span>
            </div>
            ${desc ? `<p class="builder-preview-desc">${escapeHtml(desc).replace(/\n/g, '<br>')}</p>` : ''}
            <div class="builder-preview-modules">
                ${builderModules.map((mod, idx) => `
                    <div class="builder-preview-module">
                        <h4>Module ${idx + 1}: ${escapeHtml(mod.title)}</h4>
                        <ul>
                            ${(mod.lessons || []).map(l => `<li>${getBuilderLessonTypeIcon(l.content_type)} ${escapeHtml(l.title)}</li>`).join('')}
                        </ul>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ─── Save Draft ─────────────────────────────────────────────────────────────

async function saveDraft() {
    const btn = document.getElementById('saveDraftBtn');
    if (btn) btn.disabled = true;

    try {
        const coursePayload = gatherCoursePayload('draft');
        let savedCourse;

        if (isEditMode && courseId) {
            savedCourse = await api.request(`/lms/courses/${courseId}`, {
                method: 'PUT',
                body: JSON.stringify(coursePayload)
            });
        } else {
            savedCourse = await api.request('/lms/courses', {
                method: 'POST',
                body: JSON.stringify(coursePayload)
            });
            courseId = savedCourse.id;
            isEditMode = true;
            // Update URL without reload
            window.history.replaceState({}, '', `course-builder.html?id=${courseId}`);
        }

        // Save modules and lessons
        await saveModulesAndLessons();

        showToast('Draft saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving draft:', error);
        showToast('Failed to save draft', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ─── Publish ────────────────────────────────────────────────────────────────

async function publishCourse() {
    const title = document.getElementById('courseTitle').value.trim();
    if (!title) {
        showToast('Course title is required', 'error');
        return;
    }

    const btn = document.getElementById('publishBtn');
    if (btn) btn.disabled = true;

    try {
        const coursePayload = gatherCoursePayload('published');
        let savedCourse;

        if (isEditMode && courseId) {
            savedCourse = await api.request(`/lms/courses/${courseId}`, {
                method: 'PUT',
                body: JSON.stringify(coursePayload)
            });
        } else {
            savedCourse = await api.request('/lms/courses', {
                method: 'POST',
                body: JSON.stringify(coursePayload)
            });
            courseId = savedCourse.id;
            isEditMode = true;
        }

        // Save modules and lessons
        await saveModulesAndLessons();

        // Call the dedicated publish endpoint
        await api.request(`/lms/courses/${courseId}/publish`, { method: 'PUT' });

        showToast('Course published successfully!', 'success');
        // Redirect to course detail
        setTimeout(() => {
            window.location.href = `course-detail.html?id=${courseId}`;
        }, 1000);
    } catch (error) {
        console.error('Error publishing course:', error);
        showToast('Failed to publish course', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function gatherCoursePayload(status) {
    const enrollmentType = document.querySelector('input[name="enrollmentType"]:checked')?.value || 'open';
    const tags = document.getElementById('courseTags').value
        .split(',')
        .map(t => t.trim())
        .filter(t => t);

    const durationHours = parseFloat(document.getElementById('courseDuration').value) || 0;

    return {
        title: document.getElementById('courseTitle').value.trim(),
        description: document.getElementById('courseDescription').value.trim(),
        categoryId: document.getElementById('courseCategory').value || null,
        difficultyLevel: document.getElementById('courseDifficulty').value,
        thumbnailUrl: document.getElementById('courseThumbnail').value.trim() || null,
        estimatedDurationMinutes: Math.round(durationHours * 60),
        enrollmentType: enrollmentType,
        passingScore: parseInt(document.getElementById('coursePassingScore').value) || 70,
        tags: tags,
        status: status
    };
}

async function saveModulesAndLessons() {
    if (!courseId) return;

    for (const mod of builderModules) {
        let savedModule;
        if (mod.id) {
            savedModule = await api.request(`/lms/courses/${courseId}/modules/${mod.id}`, {
                method: 'PUT',
                body: JSON.stringify({ title: mod.title, sortOrder: mod.sort_order })
            });
        } else {
            savedModule = await api.request(`/lms/courses/${courseId}/modules`, {
                method: 'POST',
                body: JSON.stringify({ title: mod.title, sortOrder: mod.sort_order })
            });
            mod.id = savedModule.id;
        }

        // Save lessons
        for (const lesson of mod.lessons || []) {
            const lessonPayload = {
                title: lesson.title,
                contentType: lesson.content_type,
                contentUrl: lesson.content_url || null,
                contentText: lesson.content_text || null,
                durationMinutes: lesson.duration_minutes || 0,
                isMandatory: lesson.is_mandatory !== false,
                sortOrder: lesson.sort_order || 0
            };
            if (lesson.id) {
                await api.request(`/lms/lessons/${lesson.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(lessonPayload)
                });
            } else {
                const savedLesson = await api.request(`/lms/modules/${mod.id}/lessons`, {
                    method: 'POST',
                    body: JSON.stringify(lessonPayload)
                });
                lesson.id = savedLesson.id;
            }
        }
    }
}
