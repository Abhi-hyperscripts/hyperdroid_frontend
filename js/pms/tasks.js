/**
 * PMS Tasks Management
 * Handles CRUD operations, filtering, and task management.
 */

// ==================== State ====================
let allTasks = [];
let allProjects = [];
let projectMembers = [];
let currentEditTaskId = null;

// Searchable dropdown instances
let filterStatusDropdown = null;
let filterPriorityDropdown = null;
let filterProjectDropdown = null;
let taskProjectDropdown = null;
let taskSubProjectDropdown = null;
let taskAssigneeDropdown = null;
let taskStatusDropdown = null;
let taskPriorityDropdown = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');
    loadTasks();
    loadProjects();
    initSearchableDropdowns();
});

// ==================== Data Loading ====================

/**
 * Load tasks from the API with optional filters
 */
async function loadTasks() {
    try {
        const params = buildFilterParams();
        const projectId = params.get('projectId');

        if (projectId) {
            // Fetch tasks for a specific project
            const queryString = params.toString();
            const endpoint = `/pms/tasks?${queryString}`;
            const response = await api.request(endpoint);
            allTasks = response.data || response || [];
        } else {
            // No project filter — aggregate tasks across all projects
            const projects = allProjects.length > 0 ? allProjects : await loadProjectsList();
            const status = params.get('status');
            const taskPromises = projects.map(p => {
                let url = `/pms/tasks?projectId=${p.id}`;
                if (status) url += `&status=${status}`;
                return api.request(url, { _skipSpinner: true }).then(r => r.data || r || []).catch(() => []);
            });
            const results = await Promise.all(taskPromises);
            allTasks = results.flat();

            // Client-side priority filter
            const priority = params.get('priority');
            if (priority) allTasks = allTasks.filter(t => t.priority === priority);
        }

        // Client-side search filter
        const search = params.get('search');
        if (search) {
            const q = search.toLowerCase();
            allTasks = allTasks.filter(t =>
                (t.title || '').toLowerCase().includes(q) ||
                (t.description || '').toLowerCase().includes(q)
            );
        }

        renderTasksTable(allTasks);
        updateStats(allTasks);
    } catch (error) {
        console.error('Failed to load tasks:', error);
        renderTasksTable([]);
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to load tasks');
        }
    }
}

/**
 * Helper to load projects list without populating dropdowns
 */
async function loadProjectsList() {
    try {
        const response = await api.request('/pms/projects', { _skipSpinner: true });
        const data = response.data || response || [];
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

/**
 * Load projects for dropdown filters and modal
 */
async function loadProjects() {
    try {
        const response = await api.request('/pms/projects');
        const data = response.data || response || [];
        allProjects = Array.isArray(data) ? data : [];
        populateProjectDropdowns();
    } catch (error) {
        console.error('Failed to load projects:', error);
    }
}

/**
 * Populate project dropdowns (filter bar + modal)
 */
function populateProjectDropdowns() {
    // Filter bar project dropdown
    const filterProjectEl = document.getElementById('filterProject');
    if (filterProjectEl) {
        const currentVal = filterProjectEl.value;
        filterProjectEl.innerHTML = '<option value="">All Projects</option>';
        allProjects.forEach(p => {
            filterProjectEl.innerHTML += `<option value="${p.id}">${escapeHtml(p.project_name || p.name || '')}</option>`;
        });
        filterProjectEl.value = currentVal;
        if (filterProjectDropdown) { filterProjectDropdown.destroy(); filterProjectDropdown = convertSelectToSearchable('filterProject', { compact: true, placeholder: 'All Projects', searchPlaceholder: 'Search projects...', onChange: () => applyFilters() }); }
    }

    // Modal project dropdown
    const taskProjectEl = document.getElementById('taskProject');
    if (taskProjectEl) {
        const currentVal = taskProjectEl.value;
        taskProjectEl.innerHTML = '<option value="">Select Project</option>';
        allProjects.forEach(p => {
            taskProjectEl.innerHTML += `<option value="${p.id}">${escapeHtml(p.project_name || p.name || '')}</option>`;
        });
        taskProjectEl.value = currentVal;
        if (taskProjectDropdown) { taskProjectDropdown.destroy(); taskProjectDropdown = convertSelectToSearchable('taskProject', { placeholder: 'Select project...', searchPlaceholder: 'Search projects...', onChange: () => onProjectChange() }); }
    }
}

/**
 * When project is selected in modal, load project members for assignee dropdown
 */
// Cached sub-project access map for the currently-selected project,
// keyed by user_id → list-of-accessible-sub-project-ids ([] = unrestricted).
// Populated in onProjectChange; consumed by refreshTaskAssigneeOptions
// so the assignee dropdown re-filters when the sub-project changes.
let taskSubProjectAccessMap = {};

async function onProjectChange() {
    const projectId = taskProjectDropdown ? taskProjectDropdown.getValue() : document.getElementById('taskProject').value;
    const assigneeEl = document.getElementById('taskAssignee');
    const subProjectEl = document.getElementById('taskSubProject');

    if (!projectId) {
        assigneeEl.innerHTML = '<option value="">Select project first</option>';
        projectMembers = [];
        taskSubProjectAccessMap = {};
        if (subProjectEl) subProjectEl.innerHTML = '<option value="">None</option>';
        if (taskSubProjectDropdown) { taskSubProjectDropdown.destroy(); taskSubProjectDropdown = convertSelectToSearchable('taskSubProject', { placeholder: 'None', searchPlaceholder: 'Search sub-projects...', onChange: () => refreshTaskAssigneeOptions() }); }
        if (taskAssigneeDropdown) { taskAssigneeDropdown.destroy(); taskAssigneeDropdown = convertSelectToSearchable('taskAssignee', { placeholder: 'Select assignee...', searchPlaceholder: 'Search members...' }); }
        return;
    }

    try {
        // Load members + sub-projects + access map in parallel.
        const [membersResp, subProjectsResp, accessResp] = await Promise.all([
            api.request(`/pms/project-members?projectId=${projectId}`),
            api.request(`/pms/sub-projects?projectId=${projectId}`).catch(() => []),
            api.request(`/pms/project-members/sub-project-access?projectId=${projectId}`).catch(() => ({ access: {} }))
        ]);
        projectMembers = membersResp.data || membersResp || [];
        const subProjects = Array.isArray(subProjectsResp) ? subProjectsResp : (subProjectsResp.data || []);
        taskSubProjectAccessMap = (accessResp && accessResp.access) ? accessResp.access : {};

        // Populate the sub-project dropdown for the selected project.
        if (subProjectEl) {
            subProjectEl.innerHTML = '<option value="">None</option>';
            subProjects.forEach(sp => {
                subProjectEl.innerHTML += `<option value="${sp.id}">${escapeHtml(sp.sub_project_name || sp.name || '')}</option>`;
            });
            if (taskSubProjectDropdown) {
                taskSubProjectDropdown.destroy();
                taskSubProjectDropdown = convertSelectToSearchable('taskSubProject', {
                    placeholder: 'None',
                    searchPlaceholder: 'Search sub-projects...',
                    onChange: () => refreshTaskAssigneeOptions()
                });
            }
        }

        refreshTaskAssigneeOptions();
    } catch (error) {
        console.error('Failed to load project members:', error);
        assigneeEl.innerHTML = '<option value="">Failed to load members</option>';
        if (taskAssigneeDropdown) { taskAssigneeDropdown.destroy(); taskAssigneeDropdown = convertSelectToSearchable('taskAssignee', { placeholder: 'Select assignee...', searchPlaceholder: 'Search members...' }); }
    }
}

/**
 * Re-populate the assignee dropdown based on the currently-selected
 * sub-project. Mirrors project-detail.js's implementation so the two
 * task-create surfaces (top-level Tasks page + project-detail Tasks
 * tab) enforce the same visibility rules. Backend rejects the same
 * combinations either way; this just keeps the UI honest.
 */
function refreshTaskAssigneeOptions() {
    const assigneeEl = document.getElementById('taskAssignee');
    if (!assigneeEl) return;
    const previousValue = taskAssigneeDropdown ? taskAssigneeDropdown.getValue() : assigneeEl.value;
    const selectedSubProjectId = taskSubProjectDropdown
        ? taskSubProjectDropdown.getValue()
        : (document.getElementById('taskSubProject') || { value: '' }).value;

    assigneeEl.innerHTML = '<option value="">Unassigned</option>';
    (projectMembers || []).forEach(m => {
        const uid = m.user_id || m.id;
        if (!uid) return;
        if (selectedSubProjectId) {
            const allowed = taskSubProjectAccessMap[uid];
            // Missing entry → not a root member (defensive); skip.
            // Empty array → unrestricted. Non-empty → allowlist.
            if (!allowed) return;
            if (allowed.length > 0 && !allowed.includes(selectedSubProjectId)) return;
        }
        const name = m.user_name || m.user_email || uid;
        assigneeEl.innerHTML += `<option value="${uid}">${escapeHtml(name)}</option>`;
    });

    const stillValid = Array.from(assigneeEl.options).some(o => o.value === previousValue);
    assigneeEl.value = stillValid ? previousValue : '';

    if (taskAssigneeDropdown) {
        taskAssigneeDropdown.destroy();
        taskAssigneeDropdown = convertSelectToSearchable('taskAssignee', {
            placeholder: 'Select assignee...',
            searchPlaceholder: 'Search members...'
        });
        if (assigneeEl.value) taskAssigneeDropdown.setValue(assigneeEl.value);
    }
}

// ==================== Stats ====================

/**
 * Update stats cards from loaded tasks
 */
function updateStats(tasks) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const total = tasks.length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'done').length;
    const overdue = tasks.filter(t => {
        if (!t.due_date || t.status === 'done') return false;
        const due = new Date(t.due_date);
        due.setHours(0, 0, 0, 0);
        return due < today;
    }).length;

    document.getElementById('statTotalTasks').textContent = total;
    document.getElementById('statInProgress').textContent = inProgress;
    document.getElementById('statCompleted').textContent = completed;
    document.getElementById('statOverdue').textContent = overdue;
}

// ==================== Filter Handling ====================

/**
 * Build query params from filter inputs
 */
function buildFilterParams() {
    const params = new URLSearchParams();
    const status = filterStatusDropdown ? filterStatusDropdown.getValue() : document.getElementById('filterStatus').value;
    const priority = filterPriorityDropdown ? filterPriorityDropdown.getValue() : document.getElementById('filterPriority').value;
    const projectId = filterProjectDropdown ? filterProjectDropdown.getValue() : document.getElementById('filterProject').value;
    const search = document.getElementById('filterSearch').value.trim();

    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    if (projectId) params.set('projectId', projectId);
    if (search) params.set('search', search);

    return params;
}

/**
 * Apply filters and reload tasks
 */
function applyFilters() {
    loadTasks();
}

// ==================== Table Rendering ====================

/**
 * Render the tasks table
 */
function renderTasksTable(tasks) {
    const tbody = document.getElementById('tasksTableBody');

    if (!tasks || tasks.length === 0) {
        // If the caller has zero accessible projects there's nothing they
        // could legitimately add a task against — backend will 403 either
        // way. Replace the misleading CTA with a hint pointing them at
        // their admin.
        const canCreate = Array.isArray(allProjects) && allProjects.length > 0;
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                            <rect x="9" y="3" width="6" height="4" rx="1"/>
                            <path d="M9 14l2 2 4-4"/>
                        </svg>
                        <p>No tasks found</p>
                        ${canCreate
                            ? '<button class="btn btn-sm btn-primary" onclick="openNewTaskModal()">Create your first task</button>'
                            : '<p style="color: var(--text-secondary); font-size: 0.85rem;">Ask a PMS administrator to add you to a project first.</p>'}
                    </div>
                </td>
            </tr>
        `;
        // Hide the header "+ New Task" button when there's nowhere to file
        // a task. Backend gates fire anyway, but the button is misleading.
        const headerBtn = document.getElementById('newTaskBtn');
        if (headerBtn) headerBtn.style.display = canCreate ? '' : 'none';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    tbody.innerHTML = tasks.map(task => {
        const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < today;
        const hoursLogged = formatHoursLogged(task.total_hours_logged);

        return `
        <tr data-task-id="${task.id}">
            <td>
                <div class="crm-cell-primary">${escapeHtml(task.title || '')}</div>
                ${task.description ? `<div class="crm-cell-secondary">${escapeHtml(task.description.substring(0, 60))}${task.description.length > 60 ? '...' : ''}</div>` : ''}
            </td>
            <td>
                <span class="crm-cell-secondary">${escapeHtml(task.project_name || '-')}</span>
            </td>
            <td class="hide-mobile">
                ${task.assigned_to_name ? `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--brand-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0;">
                        ${getInitials(task.assigned_to_name)}
                    </div>
                    <span class="crm-cell-secondary">${escapeHtml(task.assigned_to_name)}</span>
                </div>
                ` : '<span class="crm-cell-secondary">Unassigned</span>'}
            </td>
            <td>
                <span class="crm-status-badge status-${getStatusClass(task.status)}">${formatStatus(task.status)}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-status-badge status-${getPriorityClass(task.priority)}">${formatPriority(task.priority)}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary ${isOverdue ? 'text-danger' : ''}">${formatDate(task.due_date)}${isOverdue ? ' (Overdue)' : ''}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${hoursLogged}</span>
            </td>
            <td>
                <div class="crm-actions">
                    <button class="crm-action-btn" onclick="editTask('${task.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn action-delete" onclick="deleteTask('${task.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

// ==================== Status & Priority Formatting ====================

function formatStatus(status) {
    const labels = {
        'todo': 'To Do',
        'in_progress': 'In Progress',
        'in_review': 'In Review',
        'done': 'Done'
    };
    return labels[status] || status || 'To Do';
}

function getStatusClass(status) {
    const classes = {
        'todo': 'new',
        'in_progress': 'contacted',
        'in_review': 'qualified',
        'done': 'converted'
    };
    return classes[status] || 'new';
}

function formatPriority(priority) {
    const labels = {
        'low': 'Low',
        'medium': 'Medium',
        'high': 'High',
        'urgent': 'Urgent'
    };
    return labels[priority] || priority || 'Medium';
}

function getPriorityClass(priority) {
    const classes = {
        'low': 'new',
        'medium': 'contacted',
        'high': 'qualified',
        'urgent': 'converted'
    };
    return classes[priority] || 'new';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

function formatHoursLogged(totalHours) {
    if (!totalHours && totalHours !== 0) return '-';
    const hours = Math.floor(totalHours);
    const minutes = Math.round((totalHours - hours) * 60);
    if (hours === 0 && minutes === 0) return '0h';
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ==================== Modal Handling ====================

function openNewTaskModal() {
    // Defense in depth — empty-state CTA + header button are hidden when
    // the caller has no projects, but a stale page or dev-console call
    // could still reach here. Bail with a helpful toast instead of
    // opening a form the backend will 403.
    if (!Array.isArray(allProjects) || allProjects.length === 0) {
        if (typeof Toast !== 'undefined') {
            Toast.error('You need to be a member of at least one project before creating tasks. Ask your admin.');
        }
        return;
    }
    currentEditTaskId = null;
    document.getElementById('taskModalTitle').textContent = 'New Task';
    const submitBtn = document.getElementById('taskSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="taskSubmitSpinner" style="display:none;"></span> Create Task';
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';

    // Reset dropdowns
    if (taskProjectDropdown) taskProjectDropdown.setValue('');
    if (taskSubProjectDropdown) taskSubProjectDropdown.setValue('');
    if (taskAssigneeDropdown) taskAssigneeDropdown.setValue('');
    if (taskStatusDropdown) taskStatusDropdown.setValue('todo');
    if (taskPriorityDropdown) taskPriorityDropdown.setValue('medium');

    // Reset assignee dropdown
    const assigneeEl = document.getElementById('taskAssignee');
    if (assigneeEl) {
        assigneeEl.innerHTML = '<option value="">Select project first</option>';
        if (taskAssigneeDropdown) { taskAssigneeDropdown.destroy(); taskAssigneeDropdown = convertSelectToSearchable('taskAssignee', { placeholder: 'Select assignee...', searchPlaceholder: 'Search members...' }); }
    }

    openModal('taskModal');
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => {
            modal.classList.add('active');
        });
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.classList.remove('gm-animating');
        }, 200);
    }
}

function closeTaskModal() {
    closeModal('taskModal');
    currentEditTaskId = null;
}

// ==================== CRUD Operations ====================

async function handleTaskSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('taskSubmitBtn');
    const spinner = document.getElementById('taskSubmitSpinner');
    submitBtn.disabled = true;
    spinner.style.display = 'inline-block';

    const projectId = taskProjectDropdown ? taskProjectDropdown.getValue() : document.getElementById('taskProject').value;
    const subProjectId = taskSubProjectDropdown ? taskSubProjectDropdown.getValue() : document.getElementById('taskSubProject').value;
    const assignedTo = taskAssigneeDropdown ? taskAssigneeDropdown.getValue() : document.getElementById('taskAssignee').value;
    const status = taskStatusDropdown ? taskStatusDropdown.getValue() : document.getElementById('taskStatus').value;
    const priority = taskPriorityDropdown ? taskPriorityDropdown.getValue() : document.getElementById('taskPriority').value;

    const formData = {
        title: document.getElementById('taskTitle').value.trim(),
        description: document.getElementById('taskDescription').value.trim(),
        project_id: projectId || null,
        sub_project_id: subProjectId || null,
        assigned_to: assignedTo || null,
        status: status || 'todo',
        priority: priority || 'medium',
        due_date: document.getElementById('taskDueDate').value || null,
        estimated_hours: parseInt(document.getElementById('taskEstHours').value) || 0,
        estimated_minutes: parseInt(document.getElementById('taskEstMinutes').value) || 0
    };

    try {
        if (currentEditTaskId) {
            formData.id = currentEditTaskId;
            await api.request('/pms/tasks', {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Task updated successfully');
        } else {
            await api.request('/pms/tasks', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Task created successfully');
        }

        closeTaskModal();
        loadTasks();
    } catch (error) {
        console.error('Failed to save task:', error);
        Toast.error(error.message || 'Failed to save task');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function editTask(taskId) {
    try {
        // Find task from allTasks first
        let task = allTasks.find(t => t.id === taskId);
        if (!task) {
            // Fallback: fetch from API
            task = await api.request(`/pms/tasks/${taskId}`);
        }

        currentEditTaskId = taskId;

        document.getElementById('taskModalTitle').textContent = 'Edit Task';
        const editSubmitBtn = document.getElementById('taskSubmitBtn');
        editSubmitBtn.innerHTML = '<span class="btn-spinner" id="taskSubmitSpinner" style="display:none;"></span> Update Task';
        document.getElementById('taskId').value = taskId;
        document.getElementById('taskTitle').value = task.title || '';
        document.getElementById('taskDescription').value = task.description || '';
        document.getElementById('taskDueDate').value = task.due_date ? task.due_date.substring(0, 10) : '';
        document.getElementById('taskEstHours').value = task.estimated_hours || 0;
        document.getElementById('taskEstMinutes').value = task.estimated_minutes || 0;

        // Set project
        document.getElementById('taskProject').value = task.project_id || '';
        if (taskProjectDropdown) taskProjectDropdown.setValue(task.project_id || '');

        // Set sub-project
        document.getElementById('taskSubProject').value = task.sub_project_id || '';
        if (taskSubProjectDropdown) taskSubProjectDropdown.setValue(task.sub_project_id || '');

        // Set status and priority
        document.getElementById('taskStatus').value = task.status || 'todo';
        if (taskStatusDropdown) taskStatusDropdown.setValue(task.status || 'todo');
        document.getElementById('taskPriority').value = task.priority || 'medium';
        if (taskPriorityDropdown) taskPriorityDropdown.setValue(task.priority || 'medium');

        // Load project members then set assignee
        if (task.project_id) {
            await onProjectChange();
            document.getElementById('taskAssignee').value = task.assigned_to || '';
            if (taskAssigneeDropdown) taskAssigneeDropdown.setValue(task.assigned_to || '');
        }

        openModal('taskModal');
    } catch (error) {
        console.error('Failed to load task:', error);
        Toast.error('Failed to load task details');
    }
}

async function deleteTask(taskId) {
    const confirmed = await showConfirm('Are you sure you want to delete this task?', 'Delete Task', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/pms/tasks/${taskId}`, { method: 'DELETE' });
        Toast.success('Task deleted');
        loadTasks();
    } catch (error) {
        console.error('Failed to delete task:', error);
        Toast.error('Failed to delete task');
    }
}

// ==================== Searchable Dropdowns ====================

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    // Filter bar dropdowns (compact)
    if (!filterStatusDropdown) {
        filterStatusDropdown = convertSelectToSearchable('filterStatus', {
            compact: true,
            placeholder: 'All Statuses',
            searchPlaceholder: 'Search status...',
            onChange: () => applyFilters()
        });
    }

    if (!filterPriorityDropdown) {
        filterPriorityDropdown = convertSelectToSearchable('filterPriority', {
            compact: true,
            placeholder: 'All Priorities',
            searchPlaceholder: 'Search priority...',
            onChange: () => applyFilters()
        });
    }

    if (!filterProjectDropdown) {
        filterProjectDropdown = convertSelectToSearchable('filterProject', {
            compact: true,
            placeholder: 'All Projects',
            searchPlaceholder: 'Search projects...',
            onChange: () => applyFilters()
        });
    }

    // Modal form dropdowns
    if (!taskProjectDropdown) {
        taskProjectDropdown = convertSelectToSearchable('taskProject', {
            placeholder: 'Select project...',
            searchPlaceholder: 'Search projects...',
            onChange: () => onProjectChange()
        });
    }

    if (!taskSubProjectDropdown) {
        taskSubProjectDropdown = convertSelectToSearchable('taskSubProject', {
            placeholder: 'None',
            searchPlaceholder: 'Search sub-projects...',
            onChange: () => refreshTaskAssigneeOptions()
        });
    }

    if (!taskAssigneeDropdown) {
        taskAssigneeDropdown = convertSelectToSearchable('taskAssignee', {
            placeholder: 'Select assignee...',
            searchPlaceholder: 'Search members...'
        });
    }

    if (!taskStatusDropdown) {
        taskStatusDropdown = convertSelectToSearchable('taskStatus', {
            placeholder: 'Select status...',
            searchPlaceholder: 'Search status...'
        });
    }

    if (!taskPriorityDropdown) {
        taskPriorityDropdown = convertSelectToSearchable('taskPriority', {
            placeholder: 'Select priority...',
            searchPlaceholder: 'Search priority...'
        });
    }
}

// ==================== Utilities ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
