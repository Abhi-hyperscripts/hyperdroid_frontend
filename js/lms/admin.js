// LMS Admin JavaScript

let categories = [];
let trainingRules = [];
let certTemplates = [];
let announcements = [];
let currentTab = 'categories';

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('lms', '../');
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Admin only
    lmsRoles.init();
    if (!lmsRoles.isAdmin()) {
        showToast('Admin access required', 'error');
        window.location.href = 'dashboard.html';
        return;
    }

    await loadAllData();
});

/**
 * Load all tab data
 */
async function loadAllData() {
    await Promise.all([
        loadCategories(),
        loadTrainingRules(),
        loadCertTemplates(),
        loadAnnouncements()
    ]);
}

// ==================== Tab Switching ====================

function switchTab(tabName) {
    currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.lms-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content - use lms-tab-pane which uses CSS display toggle
    document.querySelectorAll('.lms-tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    const activeContent = document.getElementById(`tab-${tabName}`);
    if (activeContent) {
        activeContent.classList.add('active');
    }

    // Load data for specific tabs on demand
    if (tabName === 'quiz-attempts' && !quizAttemptsLoaded) {
        loadQuizAttempts();
    }
    if (tabName === 'reviews' && !reviewsLoaded) {
        loadReviewsForModeration();
    }
    if (tabName === 'bulk-enroll' && !bulkEnrollCoursesLoaded) {
        loadBulkEnrollCourses();
    }
}

// ==================== Categories ====================

async function loadCategories() {
    const tbody = document.getElementById('categoriesTableBody');
    try {
        const data = await api.request('/lms/categories');
        categories = data.categories || data || [];
        renderCategoriesTable();
    } catch (error) {
        console.error('Error loading categories:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Error loading categories</td></tr>';
    }
}

function renderCategoriesTable() {
    const tbody = document.getElementById('categoriesTableBody');
    if (categories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No categories found</td></tr>';
        return;
    }

    tbody.innerHTML = categories.map(c => {
        const parent = c.parent_id ? categories.find(p => p.id === c.parent_id) : null;
        return `
            <tr>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.description || '-')}</td>
                <td>${parent ? escapeHtml(parent.name) : '-'}</td>
                <td>${c.course_count ?? 0}</td>
                <td>
                    <button class="btn btn-sm btn-outline-secondary" onclick="editCategory('${c.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteCategory('${c.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </td>
            </tr>`;
    }).join('');
}

function showCategoryModal(id = null) {
    document.getElementById('categoryId').value = id || '';
    document.getElementById('categoryModalTitle').textContent = id ? 'Edit Category' : 'Add Category';

    // Populate parent dropdown
    const parentSelect = document.getElementById('categoryParent');
    parentSelect.innerHTML = '<option value="">None (top-level)</option>';
    categories.filter(c => c.id !== id).forEach(c => {
        parentSelect.innerHTML += `<option value="${c.id}">${escapeHtml(c.name)}</option>`;
    });

    if (id) {
        const cat = categories.find(c => c.id === id);
        if (cat) {
            document.getElementById('categoryName').value = cat.name || '';
            document.getElementById('categoryDescription').value = cat.description || '';
            parentSelect.value = cat.parent_id || '';
        }
    } else {
        document.getElementById('categoryName').value = '';
        document.getElementById('categoryDescription').value = '';
    }

    document.getElementById('categoryModal').style.display = 'flex';
}

function closeCategoryModal() {
    document.getElementById('categoryModal').style.display = 'none';
}

function editCategory(id) {
    showCategoryModal(id);
}

async function saveCategory() {
    const id = document.getElementById('categoryId').value;
    const name = document.getElementById('categoryName').value.trim();
    const description = document.getElementById('categoryDescription').value.trim();
    const parentId = document.getElementById('categoryParent').value || null;

    if (!name) { showToast('Please enter a category name', 'error'); return; }

    const btn = document.getElementById('btnSaveCategory');
    btn.disabled = true;

    try {
        const payload = { name, description: description || null, parent_id: parentId };
        if (id) {
            await api.request(`/lms/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('Category updated', 'success');
        } else {
            await api.request('/lms/categories', { method: 'POST', body: JSON.stringify(payload) });
            showToast('Category created', 'success');
        }
        closeCategoryModal();
        await loadCategories();
    } catch (error) {
        console.error('Error saving category:', error);
        showToast('Error saving category', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function deleteCategory(id) {
    if (!await showConfirm('Are you sure you want to delete this category?', 'Delete Category', 'danger')) return;
    try {
        await api.request(`/lms/categories/${id}`, { method: 'DELETE' });
        showToast('Category deleted', 'success');
        await loadCategories();
    } catch (error) {
        console.error('Error deleting category:', error);
        showToast('Error deleting category', 'error');
    }
}

// ==================== Training Rules ====================

async function loadTrainingRules() {
    const tbody = document.getElementById('trainingRulesTableBody');
    try {
        const data = await api.request('/lms/training-rules');
        trainingRules = data.rules || data || [];
        renderTrainingRulesTable();
    } catch (error) {
        console.error('Error loading training rules:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Error loading rules</td></tr>';
    }
}

function renderTrainingRulesTable() {
    const tbody = document.getElementById('trainingRulesTableBody');
    if (trainingRules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No training rules configured</td></tr>';
        return;
    }

    tbody.innerHTML = trainingRules.map(r => `
        <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.course_title || r.learning_path_title || '-')}</td>
            <td>${escapeHtml(formatTargetType(r.target_type))}</td>
            <td>${escapeHtml(formatTrigger(r.trigger))}</td>
            <td>
                <button class="btn btn-sm btn-outline-secondary" onclick="editTrainingRule('${r.id}')" title="Edit">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteTrainingRule('${r.id}')" title="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
                <button class="btn btn-sm btn-outline-primary" onclick="executeTrainingRule('${r.id}')" title="Run Now">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                </button>
            </td>
        </tr>`).join('');
}

function showTrainingRuleModal(id = null) {
    document.getElementById('trainingRuleId').value = id || '';
    document.getElementById('trainingRuleModalTitle').textContent = id ? 'Edit Training Rule' : 'Add Training Rule';

    if (id) {
        const rule = trainingRules.find(r => r.id === id);
        if (rule) {
            document.getElementById('trainingRuleName').value = rule.name || '';
            document.getElementById('trainingRuleCourse').value = rule.course_id || rule.learning_path_id || '';
            document.getElementById('trainingRuleTargetType').value = rule.target_type || 'all';
            document.getElementById('trainingRuleTrigger').value = rule.trigger || 'manual';
        }
    } else {
        document.getElementById('trainingRuleName').value = '';
        document.getElementById('trainingRuleTargetType').value = 'all';
        document.getElementById('trainingRuleTrigger').value = 'on_join';
    }

    loadCourseOptionsForRules();
    document.getElementById('trainingRuleModal').style.display = 'flex';
}

function closeTrainingRuleModal() {
    document.getElementById('trainingRuleModal').style.display = 'none';
}

function editTrainingRule(id) {
    showTrainingRuleModal(id);
}

async function loadCourseOptionsForRules() {
    const select = document.getElementById('trainingRuleCourse');
    try {
        const data = await api.request('/lms/courses');
        const courses = data.courses || data || [];
        const currentVal = select.value;
        select.innerHTML = '<option value="">Select course or path</option>';
        courses.forEach(c => {
            select.innerHTML += `<option value="${c.id}">${escapeHtml(c.title)}</option>`;
        });
        if (currentVal) select.value = currentVal;
    } catch (error) {
        console.error('Error loading courses for rules:', error);
    }
}

async function saveTrainingRule() {
    const id = document.getElementById('trainingRuleId').value;
    const name = document.getElementById('trainingRuleName').value.trim();
    const courseId = document.getElementById('trainingRuleCourse').value || null;
    const targetType = document.getElementById('trainingRuleTargetType').value;
    const trigger = document.getElementById('trainingRuleTrigger').value;

    if (!name) { showToast('Please enter a rule name', 'error'); return; }

    const btn = document.getElementById('btnSaveTrainingRule');
    btn.disabled = true;

    try {
        const payload = { name, course_id: courseId, target_type: targetType, trigger };
        if (id) {
            await api.request(`/lms/training-rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('Training rule updated', 'success');
        } else {
            await api.request('/lms/training-rules', { method: 'POST', body: JSON.stringify(payload) });
            showToast('Training rule created', 'success');
        }
        closeTrainingRuleModal();
        await loadTrainingRules();
    } catch (error) {
        console.error('Error saving training rule:', error);
        showToast('Error saving training rule', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function deleteTrainingRule(id) {
    if (!await showConfirm('Are you sure you want to delete this training rule?', 'Delete Training Rule', 'danger')) return;
    try {
        await api.request(`/lms/training-rules/${id}`, { method: 'DELETE' });
        showToast('Training rule deleted', 'success');
        await loadTrainingRules();
    } catch (error) {
        console.error('Error deleting training rule:', error);
        showToast('Error deleting training rule', 'error');
    }
}

async function executeTrainingRule(id) {
    if (!confirm('Execute this training rule now? This will enroll matching users.')) return;
    try {
        const result = await api.request(`/lms/training-rules/${id}/execute`, { method: 'POST' });
        const count = result.enrolledCount ?? result.enrolled_count ?? 'some';
        showToast(`Rule executed! ${count} user(s) enrolled.`, 'success');
    } catch (error) {
        console.error('Error executing training rule:', error);
        showToast(error.message || 'Error executing training rule', 'error');
    }
}

// ==================== Certificate Templates ====================

async function loadCertTemplates() {
    const tbody = document.getElementById('certTemplatesTableBody');
    try {
        const data = await api.request('/lms/certificates/templates');
        certTemplates = data.templates || data || [];
        renderCertTemplatesTable();
    } catch (error) {
        console.error('Error loading cert templates:', error);
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">Error loading templates</td></tr>';
    }
}

function renderCertTemplatesTable() {
    const tbody = document.getElementById('certTemplatesTableBody');
    if (certTemplates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">No certificate templates</td></tr>';
        return;
    }

    tbody.innerHTML = certTemplates.map(t => {
        const created = t.created_at
            ? new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '-';
        return `
            <tr>
                <td>${escapeHtml(t.name)}</td>
                <td>${created}</td>
                <td>
                    <button class="btn btn-sm btn-outline-secondary" onclick="editCertTemplate('${t.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteCertTemplate('${t.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </td>
            </tr>`;
    }).join('');
}

function showCertTemplateModal(id = null) {
    document.getElementById('certTemplateId').value = id || '';
    document.getElementById('certTemplateModalTitle').textContent = id ? 'Edit Certificate Template' : 'Add Certificate Template';

    if (id) {
        const tmpl = certTemplates.find(t => t.id === id);
        if (tmpl) {
            document.getElementById('certTemplateName').value = tmpl.name || '';
            document.getElementById('certTemplateHtml').value = tmpl.html_template || '';
        }
    } else {
        document.getElementById('certTemplateName').value = '';
        document.getElementById('certTemplateHtml').value = '';
    }

    document.getElementById('certTemplateModal').style.display = 'flex';
}

function closeCertTemplateModal() {
    document.getElementById('certTemplateModal').style.display = 'none';
}

function editCertTemplate(id) {
    showCertTemplateModal(id);
}

async function saveCertTemplate() {
    const id = document.getElementById('certTemplateId').value;
    const name = document.getElementById('certTemplateName').value.trim();
    const htmlTemplate = document.getElementById('certTemplateHtml').value.trim();

    if (!name) { showToast('Please enter a template name', 'error'); return; }

    const btn = document.getElementById('btnSaveCertTemplate');
    btn.disabled = true;

    try {
        const payload = { name, html_template: htmlTemplate };
        if (id) {
            await api.request(`/lms/certificates/templates/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('Template updated', 'success');
        } else {
            await api.request('/lms/certificates/templates', { method: 'POST', body: JSON.stringify(payload) });
            showToast('Template created', 'success');
        }
        closeCertTemplateModal();
        await loadCertTemplates();
    } catch (error) {
        console.error('Error saving cert template:', error);
        showToast('Error saving template', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function deleteCertTemplate(id) {
    if (!await showConfirm('Are you sure you want to delete this certificate template?', 'Delete Certificate Template', 'danger')) return;
    try {
        await api.request(`/lms/certificates/templates/${id}`, { method: 'DELETE' });
        showToast('Template deleted', 'success');
        await loadCertTemplates();
    } catch (error) {
        console.error('Error deleting cert template:', error);
        showToast('Error deleting template', 'error');
    }
}

// ==================== Announcements ====================

async function loadAnnouncements() {
    const tbody = document.getElementById('announcementsTableBody');
    try {
        const data = await api.request('/lms/announcements');
        announcements = data.announcements || data || [];
        renderAnnouncementsTable();
    } catch (error) {
        console.error('Error loading announcements:', error);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Error loading announcements</td></tr>';
    }
}

function renderAnnouncementsTable() {
    const tbody = document.getElementById('announcementsTableBody');
    if (announcements.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No announcements</td></tr>';
        return;
    }

    tbody.innerHTML = announcements.map(a => {
        const createdDate = a.created_at || a.createdAt;
        const created = createdDate
            ? new Date(createdDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '-';
        const publishedBadge = (a.is_published || a.isPublished)
            ? '<span class="status-badge status-active">Published</span>'
            : '<span class="status-badge status-pending">Draft</span>';
        return `
            <tr>
                <td>${escapeHtml(a.title)}</td>
                <td>${publishedBadge}</td>
                <td>${created}</td>
                <td>
                    <button class="btn btn-sm btn-outline-secondary" onclick="editAnnouncement('${a.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteAnnouncement('${a.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </td>
            </tr>`;
    }).join('');
}

function showAnnouncementModal(id = null) {
    document.getElementById('announcementId').value = id || '';
    document.getElementById('announcementModalTitle').textContent = id ? 'Edit Announcement' : 'Add Announcement';

    if (id) {
        const ann = announcements.find(a => a.id === id);
        if (ann) {
            document.getElementById('announcementTitle').value = ann.title || '';
            document.getElementById('announcementBody').value = ann.body || '';
            document.getElementById('announcementPublished').checked = (ann.is_published || ann.isPublished) !== false;
        }
    } else {
        document.getElementById('announcementTitle').value = '';
        document.getElementById('announcementBody').value = '';
        document.getElementById('announcementPublished').checked = true;
    }

    document.getElementById('announcementModal').style.display = 'flex';
}

function closeAnnouncementModal() {
    document.getElementById('announcementModal').style.display = 'none';
}

function editAnnouncement(id) {
    showAnnouncementModal(id);
}

async function saveAnnouncement() {
    const id = document.getElementById('announcementId').value;
    const title = document.getElementById('announcementTitle').value.trim();
    const body = document.getElementById('announcementBody').value.trim();
    const isPublished = document.getElementById('announcementPublished').checked;

    if (!title) { showToast('Please enter an announcement title', 'error'); return; }

    const btn = document.getElementById('btnSaveAnnouncement');
    btn.disabled = true;

    try {
        const payload = { title, body: body || null, is_published: isPublished };
        if (id) {
            await api.request(`/lms/announcements/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('Announcement updated', 'success');
        } else {
            await api.request('/lms/announcements', { method: 'POST', body: JSON.stringify(payload) });
            showToast('Announcement created', 'success');
        }
        closeAnnouncementModal();
        await loadAnnouncements();
    } catch (error) {
        console.error('Error saving announcement:', error);
        showToast('Error saving announcement', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function deleteAnnouncement(id) {
    if (!await showConfirm('Are you sure you want to delete this announcement?', 'Delete Announcement', 'danger')) return;
    try {
        await api.request(`/lms/announcements/${id}`, { method: 'DELETE' });
        showToast('Announcement deleted', 'success');
        await loadAnnouncements();
    } catch (error) {
        console.error('Error deleting announcement:', error);
        showToast('Error deleting announcement', 'error');
    }
}

// ==================== Utility Functions ====================

function formatTargetType(type) {
    const map = { all: 'All Employees', department: 'Department', role: 'Role', individual: 'Individual' };
    return map[type] || type || '-';
}

function formatTrigger(trigger) {
    const map = { on_join: 'On Join', recurring: 'Recurring', manual: 'Manual', date: 'Specific Date' };
    return map[trigger] || trigger || '-';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== Quiz Attempts (Instructor/Admin) ====================

let allQuizAttempts = [];
let quizAttemptsLoaded = false;
let quizCourseFilterValue = '';

async function loadQuizAttempts() {
    const tbody = document.getElementById('quizAttemptsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading quiz attempts...</td></tr>';

    try {
        const coursesResp = await api.request('/lms/courses');
        const courses = coursesResp.courses || coursesResp || [];

        // Populate filter
        const filterEl = document.getElementById('quizCourseFilter');
        if (filterEl && filterEl.options.length <= 1) {
            courses.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.title;
                filterEl.appendChild(opt);
            });
        }

        allQuizAttempts = [];

        for (const course of courses) {
            try {
                // Get modules, then lessons with quizzes
                const modules = await api.request(`/lms/courses/${course.id}/modules?includeLessons=true`);
                const moduleList = Array.isArray(modules) ? modules : (modules.modules || []);

                for (const mod of moduleList) {
                    const lessons = mod.lessons || [];
                    for (const lesson of lessons) {
                        if (lesson.content_type === 'quiz' || lesson.contentType === 'quiz') {
                            try {
                                // Get quiz for this lesson
                                const quiz = await api.request(`/lms/quizzes/lesson/${lesson.id}`);
                                if (quiz && quiz.id) {
                                    // Get all attempts
                                    const attemptsResp = await api.request(`/lms/quizzes/${quiz.id}/attempts/all`);
                                    const attempts = Array.isArray(attemptsResp) ? attemptsResp : (attemptsResp.attempts || []);
                                    attempts.forEach(a => {
                                        a._quizTitle = quiz.title || lesson.title;
                                        a._courseTitle = course.title;
                                        a._courseId = course.id;
                                    });
                                    allQuizAttempts.push(...attempts);
                                }
                            } catch { /* no quiz for this lesson */ }
                        }
                    }
                }
            } catch { /* error loading modules */ }
        }

        quizAttemptsLoaded = true;
        renderQuizAttemptsTable();
    } catch (err) {
        console.error('Error loading quiz attempts:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error loading quiz attempts</td></tr>';
    }
}

function filterQuizCourse() {
    quizCourseFilterValue = document.getElementById('quizCourseFilter').value;
    renderQuizAttemptsTable();
}

function renderQuizAttemptsTable() {
    const tbody = document.getElementById('quizAttemptsTableBody');
    if (!tbody) return;

    let filtered = allQuizAttempts;
    if (quizCourseFilterValue) {
        filtered = filtered.filter(a => a._courseId === quizCourseFilterValue);
    }

    // Sort by submission date desc
    filtered.sort((a, b) => new Date(b.submittedAt || b.submitted_at || 0) - new Date(a.submittedAt || a.submitted_at || 0));

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No quiz attempts found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(a => {
        const score = a.score != null ? `${Math.round(a.score)}%` : '-';
        const maxScore = a.maxScore || a.max_score;
        const scoreDisplay = maxScore ? `${a.score ?? '-'} / ${maxScore}` : score;
        const passed = a.passed;
        const passedBadge = passed === true
            ? '<span class="status-badge status-active">Passed</span>'
            : passed === false
                ? '<span class="status-badge status-rejected">Failed</span>'
                : '-';
        const submittedDate = a.submittedAt || a.submitted_at;
        const dateStr = submittedDate ? new Date(submittedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-';
        const timeTaken = a.timeTakenSeconds || a.time_taken_seconds;
        const timeStr = timeTaken ? `${Math.floor(timeTaken / 60)}m ${timeTaken % 60}s` : '-';

        return `
            <tr>
                <td>${escapeHtml(a.userName || a.user_name || 'Unknown')}</td>
                <td>${escapeHtml(a._quizTitle || '-')}</td>
                <td>${escapeHtml(a._courseTitle || '-')}</td>
                <td>${scoreDisplay}</td>
                <td>${passedBadge}</td>
                <td>${dateStr}</td>
                <td>${timeStr}</td>
            </tr>`;
    }).join('');
}

// ==================== Review Moderation ====================

let allReviews = [];
let reviewsLoaded = false;
let reviewStatusFilterValue = '';

async function loadReviewsForModeration() {
    const tbody = document.getElementById('reviewsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading reviews...</td></tr>';

    try {
        const coursesResp = await api.request('/lms/courses');
        const courses = coursesResp.courses || coursesResp || [];
        allReviews = [];

        for (const course of courses) {
            try {
                const reviews = await api.request(`/lms/reviews/course/${course.id}`);
                const list = Array.isArray(reviews) ? reviews : (reviews.reviews || []);
                list.forEach(r => {
                    r._courseTitle = course.title;
                    r._courseId = course.id;
                });
                allReviews.push(...list);
            } catch { /* no reviews */ }
        }

        reviewsLoaded = true;
        renderReviewsTable();
    } catch (err) {
        console.error('Error loading reviews:', err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Error loading reviews</td></tr>';
    }
}

function filterReviewStatus() {
    reviewStatusFilterValue = document.getElementById('reviewStatusFilter').value;
    renderReviewsTable();
}

function renderReviewsTable() {
    const tbody = document.getElementById('reviewsTableBody');
    if (!tbody) return;

    let filtered = allReviews;
    if (reviewStatusFilterValue === 'pending') {
        filtered = filtered.filter(r => r.isApproved == null && r.is_approved == null);
    } else if (reviewStatusFilterValue === 'approved') {
        filtered = filtered.filter(r => r.isApproved === true || r.is_approved === true);
    } else if (reviewStatusFilterValue === 'rejected') {
        filtered = filtered.filter(r => r.isApproved === false || r.is_approved === false);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No reviews found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(r => {
        const approved = r.isApproved ?? r.is_approved;
        const statusBadge = approved === true
            ? '<span class="status-badge status-active">Approved</span>'
            : approved === false
                ? '<span class="status-badge status-rejected">Rejected</span>'
                : '<span class="status-badge status-pending">Pending</span>';

        const stars = '\u2605'.repeat(r.rating || 0) + '\u2606'.repeat(5 - (r.rating || 0));
        const reviewText = (r.reviewText || r.review_text || '').substring(0, 80);

        return `
            <tr>
                <td>${escapeHtml(r.userName || r.user_name || 'Unknown')}</td>
                <td>${escapeHtml(r._courseTitle || '-')}</td>
                <td style="color:var(--color-warning)">${stars}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.reviewText || r.review_text || '')}">${escapeHtml(reviewText)}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="moderateReview('${r.id}', true)" title="Approve" style="margin-right:4px;">\u2713</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="moderateReview('${r.id}', false)" title="Reject">\u2715</button>
                </td>
            </tr>`;
    }).join('');
}

async function moderateReview(id, approved) {
    try {
        await api.request(`/lms/reviews/${id}/approve`, {
            method: 'PUT',
            body: JSON.stringify({ approved })
        });
        showToast(approved ? 'Review approved' : 'Review rejected', 'success');
        const review = allReviews.find(r => r.id === id);
        if (review) {
            review.isApproved = approved;
            review.is_approved = approved;
        }
        renderReviewsTable();
    } catch (err) {
        console.error('Error moderating review:', err);
        showToast('Error moderating review', 'error');
    }
}

// ==================== Bulk Enrollment ====================

let bulkEnrollCoursesLoaded = false;

async function loadBulkEnrollCourses() {
    const select = document.getElementById('bulkEnrollCourse');
    if (!select) return;

    try {
        const data = await api.request('/lms/courses');
        const courses = data.courses || data || [];
        select.innerHTML = '<option value="">Select a course...</option>';
        courses.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.title + ' (' + (c.status || 'draft') + ')';
            select.appendChild(opt);
        });
        bulkEnrollCoursesLoaded = true;
    } catch (err) {
        console.error('Error loading courses for bulk enroll:', err);
    }
}

async function executeBulkEnroll() {
    const courseId = document.getElementById('bulkEnrollCourse').value;
    const userIdsText = document.getElementById('bulkEnrollUserIds').value.trim();
    const dueDate = document.getElementById('bulkEnrollDueDate').value;
    const resultDiv = document.getElementById('bulkEnrollResult');

    if (!courseId) { showToast('Please select a course', 'warning'); return; }
    if (!userIdsText) { showToast('Please enter user IDs', 'warning'); return; }

    const userIds = userIdsText.split(/[\n,\s]+/).map(id => id.trim()).filter(id => id.length > 0);
    if (userIds.length === 0) { showToast('No valid user IDs provided', 'warning'); return; }

    try {
        const result = await api.request('/lms/enrollments/bulk', {
            method: 'POST',
            body: JSON.stringify({ courseId, userIds, dueDate: dueDate || null })
        });
        const count = result.enrollment_ids?.length || userIds.length;
        resultDiv.style.display = '';
        resultDiv.innerHTML = '<div style="padding:10px;background:rgba(34,197,94,0.1);border-radius:6px;color:var(--color-success);font-size:0.85rem;">Successfully enrolled ' + count + ' user(s)!</div>';
        showToast(count + ' user(s) enrolled successfully!', 'success');
        document.getElementById('bulkEnrollUserIds').value = '';
        document.getElementById('bulkEnrollDueDate').value = '';
    } catch (err) {
        console.error('Bulk enrollment failed:', err);
        resultDiv.style.display = '';
        resultDiv.innerHTML = '<div style="padding:10px;background:rgba(239,68,68,0.1);border-radius:6px;color:var(--color-error);font-size:0.85rem;">Error: ' + escapeHtml(err.message || 'Failed to enroll users') + '</div>';
        showToast('Bulk enrollment failed', 'error');
    }
}
