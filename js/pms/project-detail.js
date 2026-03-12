/**
 * PMS Project Detail
 * Tabbed detail view: Overview, Tasks, Members, Time Tracking, Sub-Projects, Activity
 */

// ==================== State ====================
let projectId = null;
let project = null;
let projectTasks = [];
let projectMembers = [];
let projectTimeEntries = [];
let projectSubProjects = [];
let projectActivity = [];
let currentEditTaskId = null;
let currentEditMemberId = null;
let currentEditTimeEntryId = null;
let currentEditSubProjectId = null;
const loadedTabs = new Set(['overview']);

// SearchableDropdown instances
let taskFilterStatusDropdown = null;
let taskFilterPriorityDropdown = null;
let taskSubProjectDropdown = null;
let taskAssigneeDropdown = null;
let taskStatusDropdown = null;
let taskPriorityDropdown = null;
let memberRoleDropdown = null;
let entryTaskDropdown = null;
let subProjectStatusDropdown = null;
let editProjectStatusDropdown = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');

    projectId = new URLSearchParams(window.location.search).get('id');
    if (!projectId) {
        window.location.href = 'projects.html';
        return;
    }

    setupSidebar();
    initSearchableDropdowns();
    loadProjectDetail();

    // Restore tab from hash
    const hash = window.location.hash.replace('#', '');
    if (hash && document.getElementById('tab-' + hash)) {
        switchTab(hash);
    }
});

// ==================== Sidebar Setup ====================

function setupSidebar() {
    const container = document.querySelector('.pms-container');
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('projectSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    // Sidebar tab buttons
    document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', function () {
            switchTab(this.dataset.tab);
            // Close sidebar on mobile after selecting
            if (window.innerWidth <= 1024 && sidebar.classList.contains('open')) {
                toggle.classList.remove('active');
                sidebar.classList.remove('open');
                container.classList.remove('sidebar-open');
                overlay?.classList.remove('active');
            }
        });
    });

    // Toggle button
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container.classList.toggle('sidebar-open');
        if (window.innerWidth <= 1024) {
            overlay?.classList.toggle('active');
        }
    });

    // Overlay click closes sidebar
    overlay?.addEventListener('click', () => {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container.classList.remove('sidebar-open');
        overlay.classList.remove('active');
    });

    // Open sidebar by default on desktop
    if (window.innerWidth > 1024) {
        toggle.classList.add('active');
        sidebar.classList.add('open');
        container.classList.add('sidebar-open');
    }
}

// ==================== Data Loading ====================

async function loadProjectDetail() {
    try {
        project = await api.request(`/pms/projects/${projectId}`);
        if (project.data) project = project.data;
        renderProjectHeader();
        loadOverviewData();
    } catch (error) {
        console.error('Failed to load project:', error);
        Toast.error('Failed to load project details');
        setTimeout(() => window.location.href = 'projects.html', 1500);
    }
}

function renderProjectHeader() {
    document.title = `${project.project_name} - PMS | Ragenaizer`;

    // Update sidebar header
    const sidebarName = document.getElementById('sidebarProjectName');
    if (sidebarName) sidebarName.textContent = project.project_name;

    // Breadcrumb
    const breadcrumbClient = document.getElementById('breadcrumbClient');
    if (project.client_id) {
        breadcrumbClient.href = `client-detail.html?id=${project.client_id}`;
        breadcrumbClient.textContent = project.client_name || 'Client';
    } else {
        breadcrumbClient.href = 'projects.html';
        breadcrumbClient.textContent = 'All Projects';
    }
    document.getElementById('breadcrumbProject').textContent = project.project_name;

    // Header row title and status badge
    document.getElementById('projectTitle').textContent = project.project_name;
    const badge = document.getElementById('projectStatusBadge');
    badge.textContent = formatStatus(project.status);
    badge.className = `crm-status-badge status-${getStatusClass(project.status)}`;

    // Meta
    const clientLink = document.getElementById('projectClientLink');
    if (project.client_id) {
        clientLink.href = `client-detail.html?id=${project.client_id}`;
        clientLink.textContent = project.client_name || '-';
    } else {
        clientLink.removeAttribute('href');
        clientLink.textContent = 'No client';
    }

    document.getElementById('projectBudget').textContent = project.budget ? `$${Number(project.budget).toLocaleString()}` : '-';
    document.getElementById('projectStartDate').textContent = formatDate(project.start_date);
    document.getElementById('projectEndDate').textContent = formatDate(project.end_date);
    document.getElementById('projectHours').textContent = (project.total_hours_logged || 0).toFixed(1);

    // Description
    const descEl = document.getElementById('projectDescription');
    if (project.description) {
        descEl.textContent = project.description;
        descEl.style.display = 'block';
    }
}

async function loadOverviewData() {
    try {
        const [tasks, members] = await Promise.all([
            api.request(`/pms/tasks?projectId=${projectId}`, { _skipSpinner: true }).then(r => r.data || r || []).catch(() => []),
            api.request(`/pms/project-members?projectId=${projectId}`, { _skipSpinner: true }).then(r => r.data || r || []).catch(() => [])
        ]);

        projectTasks = tasks;
        projectMembers = members;

        document.getElementById('overviewTotalTasks').textContent = tasks.length;
        document.getElementById('overviewInProgress').textContent = tasks.filter(t => t.status === 'in_progress').length;
        document.getElementById('overviewCompleted').textContent = tasks.filter(t => t.status === 'done').length;
        document.getElementById('overviewMembers').textContent = members.length;

        document.getElementById('tabTaskCount').textContent = tasks.length || '';
        document.getElementById('tabMemberCount').textContent = members.length || '';
    } catch (error) {
        console.error('Failed to load overview data:', error);
    }
}

// ==================== Tab Switching ====================

function switchTab(tabName) {
    // Update sidebar buttons
    document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.crm-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === 'tab-' + tabName);
    });

    // Update active tab title indicator
    const activeBtn = document.querySelector(`.sidebar-btn[data-tab="${tabName}"]`);
    const activeTabName = document.getElementById('activeTabName');
    if (activeBtn && activeTabName) {
        const label = activeBtn.querySelector('.nav-label');
        activeTabName.textContent = label ? label.textContent : tabName;
    }

    // Update URL hash
    history.replaceState(null, '', `#${tabName}`);

    // Lazy load tab data
    if (!loadedTabs.has(tabName)) {
        loadedTabs.add(tabName);
        switch (tabName) {
            case 'tasks': loadProjectTasks(); break;
            case 'members': loadProjectMembers(); break;
            case 'time': loadProjectTime(); break;
            case 'subprojects': loadProjectSubProjects(); break;
            case 'activity': loadProjectActivity(); break;
        }
    }
}

// ==================== TASKS TAB ====================

async function loadProjectTasks() {
    const tbody = document.getElementById('projectTasksBody');
    try {
        const status = document.getElementById('taskFilterStatus')?.value || '';
        let url = `/pms/tasks?projectId=${projectId}`;
        if (status) url += `&status=${status}`;

        const response = await api.request(url);
        projectTasks = response.data || response || [];

        // Client-side priority filter
        const priority = document.getElementById('taskFilterPriority')?.value || '';
        let filtered = projectTasks;
        if (priority) filtered = filtered.filter(t => t.priority === priority);

        document.getElementById('tabTaskCount').textContent = projectTasks.length || '';

        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="crm-empty-state"><div class="crm-empty-content"><p>No tasks yet</p><button class="btn btn-sm btn-primary" onclick="openNewTaskModal()">Create first task</button></div></td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(task => `
            <tr>
                <td>
                    <div class="crm-cell-primary">${escapeHtml(task.title || '')}</div>
                    ${task.description ? `<div class="crm-cell-secondary">${escapeHtml(truncate(task.description, 60))}</div>` : ''}
                </td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(task.assignee_name || 'Unassigned')}</span></td>
                <td><span class="crm-status-badge status-${getTaskStatusClass(task.status)}">${formatTaskStatus(task.status)}</span></td>
                <td class="hide-mobile"><span class="crm-status-badge status-${getPriorityClass(task.priority)}">${capitalize(task.priority || 'medium')}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${formatDate(task.due_date)}</span></td>
                <td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="openEditTaskModal('${task.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="deleteTask('${task.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Failed to load tasks:', error);
        tbody.innerHTML = `<tr><td colspan="6" class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load tasks</p></div></td></tr>`;
    }
}

function openNewTaskModal() {
    currentEditTaskId = null;
    document.getElementById('taskModalTitle').textContent = 'New Task';
    document.getElementById('taskSubmitBtn').innerHTML = '<span class="btn-spinner" id="taskSubmitSpinner" style="display:none;"></span> Create Task';
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
    populateTaskDropdowns();
    openModal('taskModal');
}

async function openEditTaskModal(taskId) {
    const task = projectTasks.find(t => t.id === taskId);
    if (!task) return;

    currentEditTaskId = taskId;
    document.getElementById('taskModalTitle').textContent = 'Edit Task';
    document.getElementById('taskSubmitBtn').innerHTML = '<span class="btn-spinner" id="taskSubmitSpinner" style="display:none;"></span> Update Task';
    document.getElementById('taskId').value = taskId;
    document.getElementById('taskTitle').value = task.title || '';
    document.getElementById('taskStatus').value = task.status || 'todo';
    if (taskStatusDropdown) taskStatusDropdown.setValue(task.status || 'todo');
    document.getElementById('taskPriority').value = task.priority || 'medium';
    if (taskPriorityDropdown) taskPriorityDropdown.setValue(task.priority || 'medium');
    document.getElementById('taskDueDate').value = task.due_date ? task.due_date.substring(0, 10) : '';
    document.getElementById('taskEstHours').value = task.estimated_hours || 0;
    document.getElementById('taskEstMinutes').value = task.estimated_minutes || 0;
    document.getElementById('taskDescription').value = task.description || '';

    await populateTaskDropdowns();
    document.getElementById('taskSubProject').value = task.sub_project_id || '';
    if (taskSubProjectDropdown) taskSubProjectDropdown.setValue(task.sub_project_id || '');
    document.getElementById('taskAssignee').value = task.assigned_to || '';
    if (taskAssigneeDropdown) taskAssigneeDropdown.setValue(task.assigned_to || '');

    openModal('taskModal');
}

async function populateTaskDropdowns() {
    // Sub-projects
    const spSelect = document.getElementById('taskSubProject');
    spSelect.innerHTML = '<option value="">None</option>';
    try {
        const sps = projectSubProjects.length ? projectSubProjects :
            await api.request(`/pms/sub-projects?projectId=${projectId}`, { _skipSpinner: true }).then(r => r.data || r || []).catch(() => []);
        projectSubProjects = sps;
        sps.forEach(sp => {
            const opt = document.createElement('option');
            opt.value = sp.id;
            opt.textContent = sp.sub_project_name || sp.name || '';
            spSelect.appendChild(opt);
        });
    } catch { /* ignore */ }
    // Refresh searchable dropdown
    if (typeof convertSelectToSearchable === 'function') {
        if (taskSubProjectDropdown) taskSubProjectDropdown.destroy();
        taskSubProjectDropdown = convertSelectToSearchable('taskSubProject', { placeholder: 'None', searchPlaceholder: 'Search sub-projects...' });
    }

    // Members
    const mSelect = document.getElementById('taskAssignee');
    mSelect.innerHTML = '<option value="">Unassigned</option>';
    const members = projectMembers.length ? projectMembers :
        await api.request(`/pms/project-members?projectId=${projectId}`, { _skipSpinner: true }).then(r => r.data || r || []).catch(() => []);
    projectMembers = members;
    members.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.user_id || m.id;
        opt.textContent = m.user_name || m.user_email || m.user_id || '';
        mSelect.appendChild(opt);
    });
    // Refresh searchable dropdown
    if (typeof convertSelectToSearchable === 'function') {
        if (taskAssigneeDropdown) taskAssigneeDropdown.destroy();
        taskAssigneeDropdown = convertSelectToSearchable('taskAssignee', { placeholder: 'Unassigned', searchPlaceholder: 'Search members...' });
    }
}

async function handleTaskSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('taskSubmitBtn');
    const spinner = document.getElementById('taskSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        project_id: projectId,
        sub_project_id: document.getElementById('taskSubProject').value || null,
        title: document.getElementById('taskTitle').value.trim(),
        description: document.getElementById('taskDescription').value.trim(),
        status: document.getElementById('taskStatus').value,
        priority: document.getElementById('taskPriority').value,
        assigned_to: document.getElementById('taskAssignee').value || null,
        due_date: document.getElementById('taskDueDate').value || null,
        estimated_hours: parseInt(document.getElementById('taskEstHours').value) || 0,
        estimated_minutes: parseInt(document.getElementById('taskEstMinutes').value) || 0
    };

    try {
        if (currentEditTaskId) {
            formData.id = currentEditTaskId;
            await api.request('/pms/tasks', { method: 'PUT', body: JSON.stringify(formData) });
            Toast.success('Task updated');
        } else {
            await api.request('/pms/tasks', { method: 'POST', body: JSON.stringify(formData) });
            Toast.success('Task created');
        }
        closeTaskModal();
        loadProjectTasks();
        loadOverviewData();
    } catch (error) {
        Toast.error(error.message || 'Failed to save task');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteTask(taskId) {
    if (!await showConfirm('Delete this task?', 'Delete Task', 'danger')) return;
    try {
        await api.request(`/pms/tasks/${taskId}`, { method: 'DELETE' });
        Toast.success('Task deleted');
        loadProjectTasks();
        loadOverviewData();
    } catch (error) {
        Toast.error('Failed to delete task');
    }
}

function closeTaskModal() { closeModal('taskModal'); currentEditTaskId = null; }

// ==================== MEMBERS TAB ====================

async function loadProjectMembers() {
    const tbody = document.getElementById('projectMembersBody');
    try {
        const response = await api.request(`/pms/project-members?projectId=${projectId}`);
        projectMembers = response.data || response || [];
        document.getElementById('tabMemberCount').textContent = projectMembers.length || '';

        if (!projectMembers.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="crm-empty-state"><div class="crm-empty-content"><p>No members yet</p><button class="btn btn-sm btn-primary" onclick="openAddMemberModal()">Add first member</button></div></td></tr>`;
            return;
        }

        tbody.innerHTML = projectMembers.map(m => `
            <tr>
                <td>
                    <div class="crm-cell-primary" style="display: flex; align-items: center; gap: 8px;">
                        <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--brand-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0;">${getInitials(m.user_name || m.user_email || '')}</div>
                        ${escapeHtml(m.user_name || m.user_id || '-')}
                    </div>
                </td>
                <td><span class="crm-cell-secondary">${escapeHtml(m.user_email || '-')}</span></td>
                <td class="hide-mobile"><span class="crm-source-badge">${capitalize(m.role || 'member')}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${m.billing_rate ? '$' + m.billing_rate + '/hr' : '-'}</span></td>
                <td>
                    <div class="crm-actions">
                        <button class="crm-action-btn action-delete" onclick="removeMember('${m.id}')" title="Remove">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load members</p></div></td></tr>`;
    }
}

function openAddMemberModal() {
    currentEditMemberId = null;
    document.getElementById('memberModalTitle').textContent = 'Add Member';
    document.getElementById('memberSubmitBtn').innerHTML = '<span class="btn-spinner" id="memberSubmitSpinner" style="display:none;"></span> Add Member';
    document.getElementById('memberForm').reset();
    document.getElementById('memberId').value = '';
    openModal('memberModal');
}

async function handleMemberSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('memberSubmitBtn');
    const spinner = document.getElementById('memberSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        project_id: projectId,
        user_id: document.getElementById('memberUserId').value.trim(),
        role: document.getElementById('memberRole').value,
        billing_rate: parseFloat(document.getElementById('memberBillingRate').value) || null
    };

    try {
        await api.request('/pms/project-members', { method: 'POST', body: JSON.stringify(formData) });
        Toast.success('Member added');
        closeMemberModal();
        loadProjectMembers();
        loadOverviewData();
    } catch (error) {
        Toast.error(error.message || 'Failed to add member');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function removeMember(memberId) {
    if (!await showConfirm('Remove this member?', 'Remove Member', 'danger')) return;
    try {
        await api.request(`/pms/project-members/${memberId}`, { method: 'DELETE' });
        Toast.success('Member removed');
        loadProjectMembers();
        loadOverviewData();
    } catch (error) {
        Toast.error('Failed to remove member');
    }
}

function closeMemberModal() { closeModal('memberModal'); currentEditMemberId = null; }

// ==================== TIME TRACKING TAB ====================

async function loadProjectTime() {
    const tbody = document.getElementById('projectTimeBody');
    try {
        const response = await api.request(`/pms/time-entries?projectId=${projectId}`);
        projectTimeEntries = response.data || response || [];

        if (!projectTimeEntries.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="crm-empty-state"><div class="crm-empty-content"><p>No time entries yet</p><button class="btn btn-sm btn-primary" onclick="openLogTimeModal()">Log first entry</button></div></td></tr>`;
            return;
        }

        // Sort by date descending
        projectTimeEntries.sort((a, b) => (b.log_date || '').localeCompare(a.log_date || ''));

        tbody.innerHTML = projectTimeEntries.map(entry => `
            <tr>
                <td><span class="crm-cell-secondary">${formatDate(entry.log_date)}</span></td>
                <td><span class="crm-cell-secondary">${escapeHtml(entry.task_title || '-')}</span></td>
                <td><span class="crm-cell-secondary">${escapeHtml(entry.user_name || '-')}</span></td>
                <td><span class="crm-cell-primary">${parseInt(entry.hours) || 0}</span></td>
                <td><span class="crm-cell-primary">${parseInt(entry.minutes) || 0}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(entry.comment || '-')}</span></td>
                <td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="editTimeEntry('${entry.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="deleteTimeEntry('${entry.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load time entries</p></div></td></tr>`;
    }
}

function openLogTimeModal() {
    currentEditTimeEntryId = null;
    document.getElementById('timeEntryModalTitle').textContent = 'Log Time';
    document.getElementById('timeEntrySubmitBtn').innerHTML = '<span class="btn-spinner" id="timeEntrySubmitSpinner" style="display:none;"></span> Log Time';
    document.getElementById('timeEntryForm').reset();
    document.getElementById('timeEntryId').value = '';
    document.getElementById('entryDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('entryHours').value = '0';
    document.getElementById('entryMinutes').value = '0';

    // Populate task dropdown
    const taskSelect = document.getElementById('entryTask');
    taskSelect.innerHTML = '<option value="">No Task</option>';
    projectTasks.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title || '';
        taskSelect.appendChild(opt);
    });
    if (typeof convertSelectToSearchable === 'function') {
        if (entryTaskDropdown) entryTaskDropdown.destroy();
        entryTaskDropdown = convertSelectToSearchable('entryTask', { placeholder: 'No Task', searchPlaceholder: 'Search tasks...' });
    }

    openModal('timeEntryModal');
}

function editTimeEntry(entryId) {
    const entry = projectTimeEntries.find(e => e.id === entryId);
    if (!entry) return;

    currentEditTimeEntryId = entryId;
    document.getElementById('timeEntryModalTitle').textContent = 'Edit Time Entry';
    document.getElementById('timeEntrySubmitBtn').innerHTML = '<span class="btn-spinner" id="timeEntrySubmitSpinner" style="display:none;"></span> Update Entry';
    document.getElementById('timeEntryId').value = entryId;
    document.getElementById('entryDate').value = (entry.log_date || '').substring(0, 10);
    document.getElementById('entryHours').value = parseInt(entry.hours) || 0;
    document.getElementById('entryMinutes').value = parseInt(entry.minutes) || 0;
    document.getElementById('entryComment').value = entry.comment || '';

    // Populate and set task
    const taskSelect = document.getElementById('entryTask');
    taskSelect.innerHTML = '<option value="">No Task</option>';
    projectTasks.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title || '';
        taskSelect.appendChild(opt);
    });
    taskSelect.value = entry.task_id || '';
    if (typeof convertSelectToSearchable === 'function') {
        if (entryTaskDropdown) entryTaskDropdown.destroy();
        entryTaskDropdown = convertSelectToSearchable('entryTask', { placeholder: 'No Task', searchPlaceholder: 'Search tasks...' });
    }

    openModal('timeEntryModal');
}

async function handleTimeEntrySubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('timeEntrySubmitBtn');
    const spinner = document.getElementById('timeEntrySubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        project_id: projectId,
        task_id: document.getElementById('entryTask').value || null,
        log_date: document.getElementById('entryDate').value,
        hours: parseInt(document.getElementById('entryHours').value) || 0,
        minutes: parseInt(document.getElementById('entryMinutes').value) || 0,
        comment: document.getElementById('entryComment').value.trim()
    };

    try {
        if (currentEditTimeEntryId) {
            formData.id = currentEditTimeEntryId;
            await api.request('/pms/time-entries', { method: 'PUT', body: JSON.stringify(formData) });
            Toast.success('Time entry updated');
        } else {
            await api.request('/pms/time-entries', { method: 'POST', body: JSON.stringify(formData) });
            Toast.success('Time entry logged');
        }
        closeTimeEntryModal();
        loadProjectTime();
    } catch (error) {
        Toast.error(error.message || 'Failed to save time entry');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteTimeEntry(entryId) {
    if (!await showConfirm('Delete this time entry?', 'Delete Entry', 'danger')) return;
    try {
        await api.request(`/pms/time-entries/${entryId}`, { method: 'DELETE' });
        Toast.success('Time entry deleted');
        loadProjectTime();
    } catch (error) {
        Toast.error('Failed to delete time entry');
    }
}

function closeTimeEntryModal() { closeModal('timeEntryModal'); currentEditTimeEntryId = null; }

// ==================== SUB-PROJECTS TAB ====================

async function loadProjectSubProjects() {
    const tbody = document.getElementById('projectSubProjectsBody');
    try {
        const response = await api.request(`/pms/sub-projects?projectId=${projectId}`);
        projectSubProjects = response.data || response || [];
        document.getElementById('tabSubProjectCount').textContent = projectSubProjects.length || '';

        if (!projectSubProjects.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="crm-empty-state"><div class="crm-empty-content"><p>No sub-projects yet</p><button class="btn btn-sm btn-primary" onclick="openNewSubProjectModal()">Create first sub-project</button></div></td></tr>`;
            return;
        }

        tbody.innerHTML = projectSubProjects.map(sp => `
            <tr>
                <td><div class="crm-cell-primary">${escapeHtml(sp.sub_project_name || sp.name || '')}</div></td>
                <td><span class="crm-status-badge status-${getStatusClass(sp.status)}">${formatStatus(sp.status)}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(truncate(sp.description || '', 80))}</span></td>
                <td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="openEditSubProjectModal('${sp.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="deleteSubProject('${sp.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="4" class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load sub-projects</p></div></td></tr>`;
    }
}

function openNewSubProjectModal() {
    currentEditSubProjectId = null;
    document.getElementById('subProjectModalTitle').textContent = 'New Sub-Project';
    document.getElementById('subProjectSubmitBtn').innerHTML = '<span class="btn-spinner" id="subProjectSubmitSpinner" style="display:none;"></span> Create Sub-Project';
    document.getElementById('subProjectForm').reset();
    document.getElementById('subProjectId').value = '';
    openModal('subProjectModal');
}

function openEditSubProjectModal(spId) {
    const sp = projectSubProjects.find(s => s.id === spId);
    if (!sp) return;
    currentEditSubProjectId = spId;
    document.getElementById('subProjectModalTitle').textContent = 'Edit Sub-Project';
    document.getElementById('subProjectSubmitBtn').innerHTML = '<span class="btn-spinner" id="subProjectSubmitSpinner" style="display:none;"></span> Update Sub-Project';
    document.getElementById('subProjectId').value = spId;
    document.getElementById('subProjectName').value = sp.sub_project_name || sp.name || '';
    document.getElementById('subProjectStatus').value = sp.status || 'not_started';
    if (subProjectStatusDropdown) subProjectStatusDropdown.setValue(sp.status || 'not_started');
    document.getElementById('subProjectDescription').value = sp.description || '';
    openModal('subProjectModal');
}

async function handleSubProjectSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('subProjectSubmitBtn');
    const spinner = document.getElementById('subProjectSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        project_id: projectId,
        sub_project_name: document.getElementById('subProjectName').value.trim(),
        status: document.getElementById('subProjectStatus').value,
        description: document.getElementById('subProjectDescription').value.trim()
    };

    try {
        if (currentEditSubProjectId) {
            formData.id = currentEditSubProjectId;
            await api.request('/pms/sub-projects', { method: 'PUT', body: JSON.stringify(formData) });
            Toast.success('Sub-project updated');
        } else {
            await api.request('/pms/sub-projects', { method: 'POST', body: JSON.stringify(formData) });
            Toast.success('Sub-project created');
        }
        closeSubProjectModal();
        loadProjectSubProjects();
    } catch (error) {
        Toast.error(error.message || 'Failed to save sub-project');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteSubProject(spId) {
    if (!await showConfirm('Delete this sub-project?', 'Delete Sub-Project', 'danger')) return;
    try {
        await api.request(`/pms/sub-projects/${spId}`, { method: 'DELETE' });
        Toast.success('Sub-project deleted');
        loadProjectSubProjects();
    } catch (error) {
        Toast.error('Failed to delete sub-project');
    }
}

function closeSubProjectModal() { closeModal('subProjectModal'); currentEditSubProjectId = null; }

// ==================== ACTIVITY TAB ====================

async function loadProjectActivity() {
    const container = document.getElementById('projectActivityTimeline');
    try {
        const response = await api.request(`/pms/activity/project/${projectId}?limit=50`);
        projectActivity = response.data || response || [];

        if (!projectActivity.length) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">No activity recorded yet</p>';
            return;
        }

        container.innerHTML = projectActivity.map(a => `
            <div class="pms-activity-item">
                <div class="pms-activity-avatar">${getInitials(a.user_name || a.performed_by || 'U')}</div>
                <div class="pms-activity-content">
                    <div class="pms-activity-text">
                        <strong>${escapeHtml(a.user_name || a.performed_by || 'Unknown')}</strong>
                        ${escapeHtml(a.action || '')} ${escapeHtml(a.entity_type || '')}
                        ${a.description ? ` — ${escapeHtml(a.description)}` : ''}
                    </div>
                    <div class="pms-activity-time">${formatDateTime(a.created_at || a.timestamp)}</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">Failed to load activity</p>';
    }
}

// ==================== EDIT PROJECT ====================

function openEditProjectModal() {
    document.getElementById('editProjectName').value = project.project_name || '';
    document.getElementById('editProjectStatus').value = project.status || 'not_started';
    if (editProjectStatusDropdown) editProjectStatusDropdown.setValue(project.status || 'not_started');
    document.getElementById('editProjectBudget').value = project.budget || '';
    document.getElementById('editProjectStartDate').value = project.start_date ? project.start_date.substring(0, 10) : '';
    document.getElementById('editProjectEndDate').value = project.end_date ? project.end_date.substring(0, 10) : '';
    document.getElementById('editProjectDescription').value = project.description || '';
    openModal('editProjectModal');
}

function closeEditProjectModal() { closeModal('editProjectModal'); }

async function handleEditProjectSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('editProjectSubmitBtn');
    const spinner = document.getElementById('editProjectSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        id: projectId,
        project_name: document.getElementById('editProjectName').value.trim(),
        status: document.getElementById('editProjectStatus').value,
        budget: parseFloat(document.getElementById('editProjectBudget').value) || null,
        start_date: document.getElementById('editProjectStartDate').value || null,
        end_date: document.getElementById('editProjectEndDate').value || null,
        description: document.getElementById('editProjectDescription').value.trim(),
        client_id: project.client_id || null
    };

    try {
        await api.request('/pms/projects', { method: 'PUT', body: JSON.stringify(formData) });
        Toast.success('Project updated');
        closeEditProjectModal();
        loadProjectDetail();
    } catch (error) {
        Toast.error(error.message || 'Failed to update project');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteCurrentProject() {
    if (!await showConfirm('Delete this project? This cannot be undone.', 'Delete Project', 'danger')) return;
    try {
        await api.request(`/pms/projects/${projectId}`, { method: 'DELETE' });
        Toast.success('Project deleted');
        if (project.client_id) {
            window.location.href = `client-detail.html?id=${project.client_id}`;
        } else {
            window.location.href = 'projects.html';
        }
    } catch (error) {
        Toast.error('Failed to delete project');
    }
}

// ==================== SearchableDropdown Init ====================

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    // Filter bar dropdowns (compact)
    if (!taskFilterStatusDropdown) {
        taskFilterStatusDropdown = convertSelectToSearchable('taskFilterStatus', {
            compact: true,
            placeholder: 'All Statuses',
            onChange: () => loadProjectTasks()
        });
    }
    if (!taskFilterPriorityDropdown) {
        taskFilterPriorityDropdown = convertSelectToSearchable('taskFilterPriority', {
            compact: true,
            placeholder: 'All Priorities',
            onChange: () => loadProjectTasks()
        });
    }

    // Task modal dropdowns
    if (!taskStatusDropdown) {
        taskStatusDropdown = convertSelectToSearchable('taskStatus', {
            placeholder: 'Select status...'
        });
    }
    if (!taskPriorityDropdown) {
        taskPriorityDropdown = convertSelectToSearchable('taskPriority', {
            placeholder: 'Select priority...'
        });
    }
    if (!taskSubProjectDropdown) {
        taskSubProjectDropdown = convertSelectToSearchable('taskSubProject', {
            placeholder: 'None',
            searchPlaceholder: 'Search sub-projects...'
        });
    }
    if (!taskAssigneeDropdown) {
        taskAssigneeDropdown = convertSelectToSearchable('taskAssignee', {
            placeholder: 'Unassigned',
            searchPlaceholder: 'Search members...'
        });
    }

    // Member modal
    if (!memberRoleDropdown) {
        memberRoleDropdown = convertSelectToSearchable('memberRole', {
            placeholder: 'Select role...'
        });
    }

    // Time entry modal
    if (!entryTaskDropdown) {
        entryTaskDropdown = convertSelectToSearchable('entryTask', {
            placeholder: 'No Task',
            searchPlaceholder: 'Search tasks...'
        });
    }

    // Sub-project modal
    if (!subProjectStatusDropdown) {
        subProjectStatusDropdown = convertSelectToSearchable('subProjectStatus', {
            placeholder: 'Select status...'
        });
    }

    // Edit project modal
    if (!editProjectStatusDropdown) {
        editProjectStatusDropdown = convertSelectToSearchable('editProjectStatus', {
            placeholder: 'Select status...'
        });
    }
}

// ==================== Shared Utilities ====================

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => modal.classList.add('active'));
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.classList.remove('gm-animating'), 200);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return dateStr; }
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
}

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
}

function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

function formatStatus(status) {
    const labels = { 'not_started': 'Not Started', 'in_progress': 'In Progress', 'on_hold': 'On Hold', 'completed': 'Completed', 'cancelled': 'Cancelled' };
    return labels[status] || status || 'Not Started';
}

function getStatusClass(status) {
    const map = { 'not_started': 'new', 'in_progress': 'qualified', 'on_hold': 'contacted', 'completed': 'converted', 'cancelled': 'lost' };
    return map[status] || 'new';
}

function formatTaskStatus(status) {
    const labels = { 'todo': 'To Do', 'in_progress': 'In Progress', 'in_review': 'In Review', 'done': 'Done', 'cancelled': 'Cancelled' };
    return labels[status] || status || 'To Do';
}

function getTaskStatusClass(status) {
    const map = { 'todo': 'new', 'in_progress': 'qualified', 'in_review': 'contacted', 'done': 'converted', 'cancelled': 'lost' };
    return map[status] || 'new';
}

function getPriorityClass(priority) {
    const map = { 'low': 'new', 'medium': 'contacted', 'high': 'qualified', 'urgent': 'lost' };
    return map[priority] || 'new';
}
