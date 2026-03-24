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

// ==================== RBAC State ====================
let isPmsAdmin = false;
let currentUserId = null;

// SearchableDropdown instances
let taskFilterStatusDropdown = null;
let taskFilterPriorityDropdown = null;
let taskSubProjectDropdown = null;
let taskAssigneeDropdown = null;
let taskStatusDropdown = null;
let taskPriorityDropdown = null;
let memberRoleDropdown = null;
let entryTaskDropdown = null;
let entrySubProjectDropdown = null;
let subProjectStatusDropdown = null;
let editProjectStatusDropdown = null;

// ==================== RBAC Functions ====================

async function loadUserRole() {
    try {
        const resp = await api.request('/pms/projects/user-role', { _skipSpinner: true });
        const data = resp.data || resp;
        isPmsAdmin = data.is_admin || data.is_super_admin || false;
        currentUserId = data.user_id || null;
        applyRoleBasedUI();
        // Re-apply tab button visibility now that RBAC is known
        const currentTab = document.querySelector('.sidebar-btn.active')?.dataset?.tab || 'overview';
        switchTab(currentTab);
    } catch (e) {
        console.error('Failed to load user role', e);
    }
}

function applyRoleBasedUI() {
    if (!isPmsAdmin) {
        // Hide all elements marked as admin-only
        document.querySelectorAll('[data-admin-only]').forEach(el => {
            el.style.display = 'none';
        });
    }
}

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
    loadUserRole();
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

    // Meeting room link
    if (project.vision_meeting_id) {
        const meetingUrl = `../vision/lobby.html?id=${project.vision_meeting_id}`;
        const meetingBtn = document.getElementById('joinMeetingBtn');
        const meetingWrap = document.getElementById('joinMeetingBtnWrap');
        if (meetingBtn) {
            meetingBtn.href = meetingUrl;
            if (meetingWrap) meetingWrap.style.display = '';
        }
        const overviewCard = document.getElementById('overviewMeetingCard');
        const overviewBtn = document.getElementById('overviewJoinMeetingBtn');
        if (overviewCard && overviewBtn) {
            overviewBtn.href = meetingUrl;
            overviewCard.style.display = '';
        }
        // Hide create card if meeting exists
        const createCard = document.getElementById('createMeetingCard');
        if (createCard) createCard.style.display = 'none';
    } else {
        // Show "Create Meeting Room" card when no meeting exists
        const createCard = document.getElementById('createMeetingCard');
        if (createCard) createCard.style.display = '';
    }
}

// ==================== Meeting Dropdown ====================
function toggleMeetingDropdown(e, menuId) {
    e.stopPropagation();
    const menu = document.getElementById(menuId);
    // Close any other open menus
    document.querySelectorAll('.pms-meeting-menu.active').forEach(m => {
        if (m.id !== menuId) m.classList.remove('active');
    });
    menu.classList.toggle('active');
}

function closeMeetingDropdowns() {
    document.querySelectorAll('.pms-meeting-menu.active').forEach(m => m.classList.remove('active'));
}

document.addEventListener('click', closeMeetingDropdowns);

function getMeetingLink(type) {
    if (!project?.vision_meeting_id) return '';
    return type === 'guest'
        ? `${window.location.origin}/pages/vision/guest-join.html?id=${project.vision_meeting_id}`
        : `${window.location.origin}/pages/vision/lobby.html?id=${project.vision_meeting_id}`;
}

function copyMeetingLink(type) {
    const link = getMeetingLink(type);
    if (!link) return;
    const label = type === 'guest' ? 'Guest link' : 'Meeting link';
    navigator.clipboard.writeText(link).then(() => {
        Toast.success(`${label} copied!`);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        Toast.success(`${label} copied!`);
    });
    closeMeetingDropdowns();
}

function copyEmailCard(type) {
    if (!project?.vision_meeting_id) return;
    const url = getMeetingLink(type);
    const title = project.project_name || 'Project Meeting';
    const description = 'Join this project meeting on Ragenaizer Vision.';
    const ogImage = `${window.location.origin}/assets/og-vision.png`;
    const btnText = type === 'guest' ? 'Join as Guest \u2192' : 'Join Meeting \u2192';

    const html = ShareWidget.buildEmailCard({ url, title, description, ogImage, btnText });
    const blob = new Blob([html], { type: 'text/html' });
    const plainBlob = new Blob([html], { type: 'text/plain' });
    navigator.clipboard.write([
        new ClipboardItem({ 'text/html': blob, 'text/plain': plainBlob })
    ]).then(() => {
        Toast.success('Email card copied \u2014 paste into Outlook or Gmail!');
    }).catch(() => {
        navigator.clipboard.writeText(html).then(() => {
            Toast.success('Email card copied!');
        }).catch(() => Toast.error('Could not copy'));
    });
    closeMeetingDropdowns();
}

async function createMeetingRoom() {
    if (!projectId) return;
    const btn = document.getElementById('createMeetingRoomBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/></svg> Creating...';
    }
    try {
        const result = await api.request(`/pms/projects/${projectId}/meeting-room`, { method: 'POST' });
        const updated = result.data || result;
        if (updated.vision_meeting_id) {
            project = updated;
            renderProjectHeader(project);
            Toast.success('Meeting room created!');
        } else {
            Toast.error('Failed to create meeting room');
        }
    } catch (err) {
        const msg = err?.error || err?.message || 'Failed to create meeting room';
        Toast.error(msg);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Create Meeting Room';
        }
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

    // Show Edit/Delete only on overview tab
    const editBtn = document.getElementById('editProjectBtn');
    const deleteBtn = document.getElementById('deleteProjectBtn');
    const isOverview = tabName === 'overview';
    if (editBtn) editBtn.style.display = isOverview ? '' : 'none';
    if (deleteBtn) deleteBtn.style.display = isOverview ? '' : 'none';

    // Show tab-specific action buttons in header
    const tabActionMap = {
        tasks: 'headerNewTaskBtn',
        members: 'headerAddMemberBtn',
        time: 'headerLogTimeBtn',
        subprojects: 'headerNewSubProjectBtn'
    };
    document.querySelectorAll('.tab-action-btn').forEach(b => b.style.display = 'none');
    const activeActionId = tabActionMap[tabName];
    if (activeActionId) {
        const btn = document.getElementById(activeActionId);
        if (btn) {
            // Respect admin-only for buttons that require it
            const needsAdmin = btn.hasAttribute('data-admin-action');
            btn.style.display = (!needsAdmin || isPmsAdmin) ? '' : 'none';
        }
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
            case 'issues': loadProjectIssues(); break;
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
                        ${isPmsAdmin ? `<button class="crm-action-btn action-delete" onclick="deleteTask('${task.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>` : ''}
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
            const cols = isPmsAdmin ? 5 : 4;
            tbody.innerHTML = `<tr><td colspan="${cols}" class="crm-empty-state"><div class="crm-empty-content"><p>No members yet</p>${isPmsAdmin ? '<button class="btn btn-sm btn-primary" onclick="openAddMemberModal()">Add first member</button>' : ''}</div></td></tr>`;
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
                ${isPmsAdmin ? `<td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="openSubProjectAssignModal('${m.id}', '${escapeHtml(m.user_name || m.user_email || '')}', '${m.user_id}')" title="Sub-Projects">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="removeMember('${m.id}')" title="Remove">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>` : ''}
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="${isPmsAdmin ? 5 : 4}" class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load members</p></div></td></tr>`;
    }
}

// ── Add Member multi-select state ──
let memberAllUsers = [];
let memberFilteredUsers = [];
let memberSelectedUserIds = [];
let memberDropdownOpen = false;

async function openAddMemberModal() {
    currentEditMemberId = null;
    document.getElementById('memberModalTitle').textContent = 'Add Members';
    document.getElementById('memberSubmitBtn').innerHTML = '<span class="btn-spinner" id="memberSubmitSpinner" style="display:none;"></span> Add Members';
    document.getElementById('memberRole').value = 'member';
    document.getElementById('memberBillingRate').value = '';
    memberSelectedUserIds = [];
    updateMemberSelectedCount();
    openModal('memberModal');
    loadAvailablePmsUsers();
}

async function loadAvailablePmsUsers() {
    const container = document.getElementById('memberUsersOptions');
    container.innerHTML = '<div class="dropdown-no-results">Loading users...</div>';

    try {
        const response = await api.request('/pms/project-members/available-users');
        const allPmsUsers = response.data || response || [];

        // Filter out users already in the project
        const existingUserIds = new Set(projectMembers.map(m => m.user_id));
        memberAllUsers = allPmsUsers.filter(u => !existingUserIds.has(u.user_id));
        memberFilteredUsers = [...memberAllUsers];
        renderMemberUsersOptions();
    } catch (error) {
        console.error('Error loading available users:', error);
        container.innerHTML = '<div class="dropdown-no-results">Failed to load users</div>';
    }
}

function toggleMemberUsersDropdown() {
    const selectedDiv = document.getElementById('memberUsersSelected');
    const menu = document.getElementById('memberUsersMenu');
    const searchInput = document.getElementById('memberUsersSearch');

    memberDropdownOpen = !memberDropdownOpen;

    if (memberDropdownOpen) {
        selectedDiv.classList.add('open');
        menu.classList.add('open');
        searchInput.value = '';
        memberFilteredUsers = [...memberAllUsers];
        renderMemberUsersOptions();
        setTimeout(() => searchInput.focus(), 50);
    } else {
        closeMemberUsersDropdown();
    }
}

function closeMemberUsersDropdown() {
    const selectedDiv = document.getElementById('memberUsersSelected');
    const menu = document.getElementById('memberUsersMenu');
    memberDropdownOpen = false;
    if (selectedDiv) selectedDiv.classList.remove('open');
    if (menu) menu.classList.remove('open');
}

function filterMemberUsersOptions() {
    const query = document.getElementById('memberUsersSearch').value.toLowerCase().trim();

    if (!query) {
        memberFilteredUsers = [...memberAllUsers];
    } else {
        memberFilteredUsers = memberAllUsers.filter(user => {
            const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
            const email = (user.email || '').toLowerCase();
            return fullName.includes(query) || email.includes(query);
        });
    }

    renderMemberUsersOptions();
}

function renderMemberUsersOptions() {
    const container = document.getElementById('memberUsersOptions');

    if (memberFilteredUsers.length === 0) {
        container.innerHTML = '<div class="dropdown-no-results">No users found</div>';
        return;
    }

    const sortedUsers = [...memberFilteredUsers].sort((a, b) => {
        const aSelected = memberSelectedUserIds.includes(a.user_id);
        const bSelected = memberSelectedUserIds.includes(b.user_id);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        const aName = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
        const bName = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
        return aName.localeCompare(bName);
    });

    container.innerHTML = sortedUsers.map(user => {
        const isSelected = memberSelectedUserIds.includes(user.user_id);
        const name = user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
        const roleLabel = (user.roles || []).join(', ');

        return `
            <div class="dropdown-option ${isSelected ? 'selected' : ''}" onclick="toggleMemberUserSelection(event, '${user.user_id}')">
                <div class="option-info">
                    <div class="option-name">${escapeHtml(name)}</div>
                    <div class="option-email">${escapeHtml(user.email)}${roleLabel ? ' &middot; ' + escapeHtml(roleLabel) : ''}</div>
                </div>
                <div class="option-toggle">
                    <div class="mini-toggle ${isSelected ? 'active' : ''}"></div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleMemberUserSelection(event, userId) {
    event.stopPropagation();
    if (!userId) return;

    const index = memberSelectedUserIds.indexOf(userId);
    if (index > -1) {
        memberSelectedUserIds.splice(index, 1);
    } else {
        memberSelectedUserIds.push(userId);
    }

    updateMemberSelectedCount();
    renderMemberUsersOptions();
}

function updateMemberSelectedCount() {
    const countEl = document.getElementById('selectedMembersCount');
    if (countEl) countEl.textContent = memberSelectedUserIds.length;
}

async function handleMemberSubmit() {
    if (memberSelectedUserIds.length === 0) {
        Toast.error('Please select at least one user');
        return;
    }

    const submitBtn = document.getElementById('memberSubmitBtn');
    const spinner = document.getElementById('memberSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const role = document.getElementById('memberRole').value;
    const billingRate = parseFloat(document.getElementById('memberBillingRate').value) || null;

    let successCount = 0;
    let failCount = 0;

    try {
        for (const userId of memberSelectedUserIds) {
            try {
                await api.request('/pms/project-members', {
                    method: 'POST',
                    body: JSON.stringify({
                        project_id: projectId,
                        user_id: userId,
                        role: role,
                        billing_rate: billingRate
                    })
                });
                successCount++;
            } catch (error) {
                failCount++;
                console.error(`Failed to add member ${userId}:`, error);
            }
        }

        if (successCount > 0) {
            Toast.success(`${successCount} member${successCount > 1 ? 's' : ''} added${failCount > 0 ? `, ${failCount} failed` : ''}`);
            closeMemberModal();
            loadProjectMembers();
            loadOverviewData();
        } else {
            Toast.error('Failed to add members');
        }
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

function closeMemberModal() {
    closeModal('memberModal');
    currentEditMemberId = null;
    closeMemberUsersDropdown();
    memberSelectedUserIds = [];
}

// ==================== TIME TRACKING TAB ====================

async function loadProjectTime() {
    const tbody = document.getElementById('projectTimeBody');
    try {
        const response = await api.request(`/pms/time-entries?projectId=${projectId}`);
        projectTimeEntries = response.data || response || [];

        if (!projectTimeEntries.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="crm-empty-state"><div class="crm-empty-content"><p>No time entries yet</p><button class="btn btn-sm btn-primary" onclick="openLogTimeModal()">Log first entry</button></div></td></tr>`;
            return;
        }

        // Sort by date descending
        projectTimeEntries.sort((a, b) => (b.log_date || '').localeCompare(a.log_date || ''));

        tbody.innerHTML = projectTimeEntries.map(entry => `
            <tr>
                <td><span class="crm-cell-secondary">${formatDate(entry.log_date)}</span></td>
                <td><span class="crm-cell-secondary">${escapeHtml(entry.sub_project_name || '-')}</span></td>
                <td><span class="crm-cell-secondary">${escapeHtml(entry.task_title || '-')}</span></td>
                <td><span class="crm-cell-secondary">${escapeHtml(entry.user_name || '-')}</span></td>
                <td><span class="crm-cell-primary">${parseInt(entry.hours) || 0}</span></td>
                <td><span class="crm-cell-primary">${parseInt(entry.minutes) || 0}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(entry.comment || '-')}</span></td>
                <td>
                    ${(isPmsAdmin || entry.user_id === currentUserId) ? `<div class="crm-actions">
                        <button class="crm-action-btn" onclick="editTimeEntry('${entry.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="deleteTimeEntry('${entry.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load time entries</p></div></td></tr>`;
    }
}

async function loadTimeEntrySubProjects() {
    const select = document.getElementById('entrySubProject');
    select.innerHTML = '<option value="">Loading...</option>';

    try {
        const response = await api.request(`/pms/sub-projects/member-assignments?projectId=${projectId}`, { _skipSpinner: true });
        const data = response.data || response;
        const subProjects = data.sub_projects || [];

        select.innerHTML = subProjects.length === 1
            ? `<option value="${subProjects[0].id}">${escapeHtml(subProjects[0].sub_project_name)}</option>`
            : '<option value="">Select sub-project</option>' + subProjects.map(sp =>
                `<option value="${sp.id}">${escapeHtml(sp.sub_project_name)}</option>`
              ).join('');

        // Auto-select if only one option
        if (subProjects.length === 1) {
            select.value = subProjects[0].id;
        }

        // Refresh searchable dropdown
        if (typeof convertSelectToSearchable === 'function') {
            if (entrySubProjectDropdown) entrySubProjectDropdown.destroy();
            entrySubProjectDropdown = convertSelectToSearchable('entrySubProject', { placeholder: 'Select sub-project', searchPlaceholder: 'Search sub-projects...' });
        }
    } catch (error) {
        console.error('Error loading sub-projects:', error);
        select.innerHTML = '<option value="">Failed to load</option>';
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

    // Populate sub-project dropdown
    loadTimeEntrySubProjects();

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

async function editTimeEntry(entryId) {
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

    // Populate and set sub-project
    await loadTimeEntrySubProjects();
    document.getElementById('entrySubProject').value = entry.sub_project_id || '';
    if (entrySubProjectDropdown) entrySubProjectDropdown.setValue(entry.sub_project_id || '');

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

    const subProjectId = document.getElementById('entrySubProject').value;
    if (!subProjectId) {
        Toast.error('Please select a sub-project');
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        return;
    }

    const comment = document.getElementById('entryComment').value.trim();
    if (comment.length < 150) {
        Toast.error(`Comment must be at least 150 characters (currently ${comment.length})`);
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        return;
    }

    const formData = {
        project_id: projectId,
        sub_project_id: subProjectId,
        task_id: document.getElementById('entryTask').value || null,
        log_date: document.getElementById('entryDate').value,
        hours: parseInt(document.getElementById('entryHours').value) || 0,
        minutes: parseInt(document.getElementById('entryMinutes').value) || 0,
        comment: comment
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
            const cols = isPmsAdmin ? 7 : 6;
            tbody.innerHTML = `<tr><td colspan="${cols}" class="crm-empty-state"><div class="crm-empty-content"><p>No sub-projects yet</p>${isPmsAdmin ? '<button class="btn btn-sm btn-primary" onclick="openNewSubProjectModal()">Create first sub-project</button>' : ''}</div></td></tr>`;
            return;
        }

        tbody.innerHTML = projectSubProjects.map(sp => `
            <tr>
                <td><div class="crm-cell-primary">${escapeHtml(sp.sub_project_name || sp.name || '')}</div></td>
                <td><span class="crm-status-badge status-${getStatusClass(sp.status)}">${formatStatus(sp.status)}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(truncate(sp.description || '', 80))}</span></td>
                <td><span class="crm-cell-secondary">${sp.member_count || 0}</span></td>
                <td><span class="crm-cell-secondary">${sp.task_count || 0}</span></td>
                <td><span class="crm-cell-secondary">${parseFloat(sp.total_hours_logged || 0).toFixed(1)}</span></td>
                ${isPmsAdmin ? `<td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="openEditSubProjectModal('${sp.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="deleteSubProject('${sp.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>` : ''}
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="${isPmsAdmin ? 7 : 6}" class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load sub-projects</p></div></td></tr>`;
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

// ==================== SUB-PROJECT ASSIGNMENT ====================

let assignMemberUserId = null;
let assignMemberProjectId = null;

async function openSubProjectAssignModal(memberId, userName, userId) {
    assignMemberUserId = userId;
    assignMemberProjectId = projectId;
    document.getElementById('subProjectAssignTitle').textContent = `Sub-Project Access: ${userName}`;
    openModal('subProjectAssignModal');
    await loadSubProjectAssignments(userId);
}

async function loadSubProjectAssignments(userId) {
    const container = document.getElementById('subProjectAssignList');
    container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-secondary);">Loading...</div>';

    try {
        // Get all sub-projects for this project
        const subProjectsResp = await api.request(`/pms/sub-projects?projectId=${projectId}`, { _skipSpinner: true });
        const subProjects = subProjectsResp.data || subProjectsResp || [];

        // Get this member's current assignments
        const assignResp = await api.request(`/pms/sub-projects/member-assignments?projectId=${projectId}&userId=${userId}`, { _skipSpinner: true });
        const assignData = assignResp.data || assignResp;
        const assignedIds = assignData.all_access ? [] : (assignData.sub_projects || []).map(sp => sp.id);
        const allAccess = assignData.all_access;

        if (subProjects.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-secondary);">No sub-projects found</div>';
            return;
        }

        container.innerHTML = subProjects.map(sp => {
            const isAssigned = allAccess || assignedIds.includes(sp.id);
            return `
                <div class="dropdown-option ${isAssigned && !allAccess ? 'selected' : ''}"
                     onclick="toggleSubProjectAssignment(event, '${sp.id}', '${escapeHtml(sp.sub_project_name)}')"
                     style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border-primary);">
                    <div class="option-info">
                        <div class="option-name">${escapeHtml(sp.sub_project_name)}</div>
                        <div class="option-email">${sp.member_count || 0} members</div>
                    </div>
                    <div class="option-toggle">
                        <div class="mini-toggle ${isAssigned && !allAccess ? 'active' : ''}" id="spToggle_${sp.id}"></div>
                    </div>
                </div>
            `;
        }).join('');

        if (allAccess) {
            container.insertAdjacentHTML('afterbegin',
                '<div style="padding: 8px 12px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 8px; font-size: 0.82rem; color: var(--text-secondary);">No specific assignments — member has access to all sub-projects. Toggle any to restrict access.</div>'
            );
        }
    } catch (error) {
        console.error('Error loading sub-project assignments:', error);
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--color-error);">Failed to load</div>';
    }
}

async function toggleSubProjectAssignment(event, subProjectId, subProjectName) {
    event.stopPropagation();
    const toggle = document.getElementById(`spToggle_${subProjectId}`);
    const isCurrentlyActive = toggle.classList.contains('active');

    try {
        if (isCurrentlyActive) {
            // Unassign
            await api.request('/pms/project-members/sub-project-unassign', {
                method: 'POST',
                body: JSON.stringify({
                    project_id: assignMemberProjectId,
                    sub_project_id: subProjectId,
                    user_id: assignMemberUserId
                })
            });
            toggle.classList.remove('active');
            toggle.closest('.dropdown-option').classList.remove('selected');
        } else {
            // Assign
            await api.request('/pms/project-members/sub-project-assign', {
                method: 'POST',
                body: JSON.stringify({
                    project_id: assignMemberProjectId,
                    sub_project_id: subProjectId,
                    user_id: assignMemberUserId
                })
            });
            toggle.classList.add('active');
            toggle.closest('.dropdown-option').classList.add('selected');
        }

        // Remove the "all access" banner if it exists
        const banner = document.querySelector('#subProjectAssignList > div[style*="bg-tertiary"]');
        if (banner) banner.remove();
    } catch (error) {
        Toast.error(error.message || 'Failed to update assignment');
    }
}

function closeSubProjectAssignModal() {
    closeModal('subProjectAssignModal');
    assignMemberUserId = null;
}

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

        container.innerHTML = projectActivity.map(a => {
            const action = (a.action || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const entity = (a.entity_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            let details = '';
            if (a.description || a.details) {
                try {
                    const data = JSON.parse(a.description || a.details);
                    const parts = [];
                    for (const [key, value] of Object.entries(data)) {
                        if (!value || key.endsWith('_id')) continue;
                        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        parts.push(`${label}: ${escapeHtml(String(value))}`);
                    }
                    if (parts.length) details = ` — ${parts.join(', ')}`;
                } catch {
                    details = ` — ${escapeHtml(a.description || a.details)}`;
                }
            }
            return `
            <div class="pms-activity-item">
                <div class="pms-activity-avatar">${getInitials(a.user_name || a.performed_by || 'U')}</div>
                <div class="pms-activity-content">
                    <div class="pms-activity-text">
                        <strong>${escapeHtml(a.user_name || a.performed_by || 'Unknown')}</strong>
                        ${action} ${entity}${details}
                    </div>
                    <div class="pms-activity-time">${formatDateTime(a.created_at || a.timestamp)}</div>
                </div>
            </div>`;
        }).join('');
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
    if (!entrySubProjectDropdown) {
        entrySubProjectDropdown = convertSelectToSearchable('entrySubProject', {
            placeholder: 'Select sub-project',
            searchPlaceholder: 'Search sub-projects...'
        });
    }
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

// ==================== ISSUES TAB ====================

let projectIssues = [];
let issueQuillSteps = null, issueQuillExpected = null, issueQuillActual = null, issueQuillDesc = null;

const ISSUE_QUILL_TOOLBAR = [
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    ['code-block'],
    ['link', 'image'],
    ['clean']
];

// Searchable dropdown instances for issues
let issueFilterSubProjectDD = null, issueFilterStatusDD = null, issueFilterSeverityDD = null;
let issueTypeDD = null, issueSeverityDD = null, issuePriorityDD = null, issueAssigneeDD = null;
let issueSubProjectDD = null, issueReproducibilityDD = null;

function initIssueSearchableDropdowns() {
    // Filter bar dropdowns
    issueFilterSubProjectDD = convertSelectToSearchable('issueFilterSubProject', { compact: true, placeholder: 'All Sub-Projects', onChange: () => loadProjectIssues() });
    issueFilterStatusDD = convertSelectToSearchable('issueFilterStatus', { compact: true, placeholder: 'All', onChange: () => loadProjectIssues() });
    issueFilterSeverityDD = convertSelectToSearchable('issueFilterSeverity', { compact: true, placeholder: 'All', onChange: () => loadProjectIssues() });
}

function initIssueModalDropdowns() {
    // Modal dropdowns — destroy and recreate each time
    issueTypeDD = convertSelectToSearchable('issueType', { placeholder: 'Bug' });
    issueSeverityDD = convertSelectToSearchable('issueSeverity', { placeholder: 'Medium' });
    issuePriorityDD = convertSelectToSearchable('issuePriority', { placeholder: 'P2' });
    issueAssigneeDD = convertSelectToSearchable('issueAssignee', { placeholder: 'Unassigned' });
    issueSubProjectDD = convertSelectToSearchable('issueSubProject', { placeholder: 'None' });
    issueReproducibilityDD = convertSelectToSearchable('issueReproducibility', { placeholder: 'Always' });
}

function destroyIssueModalDropdowns() {
    [issueTypeDD, issueSeverityDD, issuePriorityDD, issueAssigneeDD, issueSubProjectDD, issueReproducibilityDD].forEach(dd => {
        if (dd && dd.destroy) dd.destroy();
    });
    issueTypeDD = issueSeverityDD = issuePriorityDD = issueAssigneeDD = issueSubProjectDD = issueReproducibilityDD = null;
}

async function loadProjectIssues() {
    const tbody = document.getElementById('projectIssuesBody');
    try {
        // Populate sub-project filter if not already done
        const spFilter = document.getElementById('issueFilterSubProject');
        if (spFilter && spFilter.options.length <= 1) {
            try {
                const sps = await api.request(`/pms/sub-projects?projectId=${projectId}`);
                (sps || []).forEach(sp => {
                    spFilter.innerHTML += `<option value="${sp.id}">${sp.sub_project_name}</option>`;
                });
            } catch (_) {}
        }

        const params = new URLSearchParams();
        params.set('projectId', projectId);
        const subProjectId = document.getElementById('issueFilterSubProject')?.value;
        const status = document.getElementById('issueFilterStatus')?.value;
        const severity = document.getElementById('issueFilterSeverity')?.value;
        if (subProjectId) params.set('subProjectId', subProjectId);
        if (status) params.set('status', status);
        if (severity) params.set('severity', severity);

        projectIssues = await api.request(`/pms/issues?${params.toString()}`);
        renderProjectIssues(projectIssues);

        // Init searchable dropdowns on first load
        if (!issueFilterStatusDD) initIssueSearchableDropdowns();

        // Update tab count
        const countEl = document.getElementById('tabIssuesCount');
        if (countEl) countEl.textContent = projectIssues.length || '';
    } catch (e) {
        console.error('[Issues] Failed to load:', e);
        tbody.innerHTML = '<tr><td colspan="8"><div class="crm-empty-content"><p>Failed to load issues</p></div></td></tr>';
    }
}

function renderProjectIssues(issues) {
    const tbody = document.getElementById('projectIssuesBody');
    if (!issues || issues.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="crm-empty-content">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p>No issues found</p>
            <button class="btn btn-primary btn-sm" onclick="openIssueModal()">Report your first issue</button>
        </div></td></tr>`;
        return;
    }

    const statusLabels = { reported: 'Reported', in_progress: 'In Progress', qa_testing: 'QA Testing', closed: 'Closed', reopened: 'Reopened', wontfix: "Won't Fix" };

    tbody.innerHTML = issues.map(issue => {
        const code = issue.project_code || (project?.project_code) || (project?.project_name?.substring(0, 3).toUpperCase()) || 'PRJ';
        const ref = `${code}-${issue.issue_number}`;
        const created = new Date(issue.created_at).toLocaleString();
        const comp = issue.component ? `<span class="component-tag">${escapeHtml(issue.component)}</span>` : '';

        // Permission: Edit only for reporter or admin, Delete only for admin
        const isReporter = issue.reported_by === currentUserId;
        const canEdit = isReporter || isPmsAdmin;
        const canDelete = isPmsAdmin;
        const editBtn = canEdit ? `<button class="action-btn" onclick="editProjectIssue('${issue.id}')" data-tooltip="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>` : '';
        const deleteBtn = canDelete ? `<button class="action-btn action-btn-danger" onclick="deleteProjectIssue('${issue.id}')" data-tooltip="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>` : '';

        return `<tr>
            <td><span class="issue-number">${escapeHtml(ref)}</span></td>
            <td class="issue-title-cell">
                <span style="font-weight:500;font-size:0.82rem;">${escapeHtml(issue.title)}</span>
                ${comp}
            </td>
            <td><span class="severity-badge severity-${issue.severity}">${issue.severity}</span></td>
            <td><span class="priority-badge priority-${issue.priority}">${issue.priority}</span></td>
            <td><span class="issue-status-badge issue-status-${issue.status}">${statusLabels[issue.status] || issue.status}</span></td>
            <td style="font-size:0.8rem;">${escapeHtml(issue.reported_by_name || '—')}</td>
            <td style="font-size:0.8rem;">${escapeHtml(issue.assigned_to_name || 'Unassigned')}</td>
            <td style="font-size:0.8rem;text-align:center;">${issue.comment_count || 0}</td>
            <td style="font-size:0.75rem;white-space:nowrap;color:var(--text-secondary);">${created}</td>
            <td>
                <div class="action-btns">
                    <a class="action-btn" href="issue-detail.html?id=${issue.id}" data-tooltip="View">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </a>
                    ${editBtn}
                    ${deleteBtn}
                </div>
            </td>
        </tr>`;
    }).join('');
}

function issueAge(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d`;
    return `${Math.floor(days / 30)}mo`;
}

// ---- Issue Modal ----

async function openIssueModal() {
    document.getElementById('issueForm').reset();
    document.getElementById('issueModal').classList.add('active');

    // Populate assignee from project members (fetch if not loaded)
    if (!projectMembers || !projectMembers.length) {
        try {
            const resp = await api.request(`/pms/project-members?projectId=${projectId}`, { _skipSpinner: true });
            projectMembers = resp.data || resp || [];
        } catch (_) {}
    }
    const assigneeSelect = document.getElementById('issueAssignee');
    assigneeSelect.innerHTML = '<option value="">Unassigned</option>';
    projectMembers.forEach(m => {
        // Skip orphaned members with no resolved name
        if (!m.user_name && !m.user_email) return;
        const label = m.user_name || m.user_email;
        assigneeSelect.innerHTML += `<option value="${m.user_id}">${label}</option>`;
    });

    // Populate sub-project dropdown in modal
    const spSelect = document.getElementById('issueSubProject');
    if (spSelect) {
        spSelect.innerHTML = '<option value="">None</option>';
        try {
            const sps = await api.request(`/pms/sub-projects?projectId=${projectId}`);
            (sps || []).forEach(sp => {
                spSelect.innerHTML += `<option value="${sp.id}">${sp.sub_project_name}</option>`;
            });
        } catch (_) {}
    }

    // Init dropdowns + Quill editors after modal visible
    setTimeout(() => {
        initIssueModalDropdowns();
        initIssueQuillEditors();
    }, 100);
}

function closeIssueModal() {
    document.getElementById('issueModal').classList.remove('active');
    destroyIssueQuillEditors();
    destroyIssueModalDropdowns();
}

function initIssueQuillEditors() {
    destroyIssueQuillEditors();
    const opts = { theme: 'snow', modules: { toolbar: ISSUE_QUILL_TOOLBAR } };
    issueQuillSteps = new Quill('#issueEditorSteps', { ...opts, placeholder: '1. Go to...\n2. Click on...\n3. Observe...' });
    issueQuillExpected = new Quill('#issueEditorExpected', { ...opts, placeholder: 'What should happen' });
    issueQuillActual = new Quill('#issueEditorActual', { ...opts, placeholder: 'What actually happened (paste screenshots here)' });
    issueQuillDesc = new Quill('#issueEditorDesc', { ...opts, placeholder: 'Any additional context, notes, or screenshots...' });
}

function destroyIssueQuillEditors() {
    ['issueEditorSteps', 'issueEditorExpected', 'issueEditorActual', 'issueEditorDesc'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const parent = el.parentElement;
            const toolbar = parent?.querySelector('.ql-toolbar');
            if (toolbar) toolbar.remove();
            el.innerHTML = '';
            el.className = '';
        }
    });
    issueQuillSteps = issueQuillExpected = issueQuillActual = issueQuillDesc = null;
}

function switchIssueEditorTab(tab, btnEl) {
    document.querySelectorAll('#issueModal .issue-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#issueModal .issue-tab-panel').forEach(p => p.classList.remove('active'));
    btnEl.classList.add('active');
    const map = { steps: 'issueTabSteps', expected: 'issueTabExpected', actual: 'issueTabActual', desc: 'issueTabDesc' };
    document.getElementById(map[tab]).classList.add('active');
}

function getQuillHtml(q) {
    if (!q || !q.getText().trim()) return '';
    return q.root.innerHTML;
}

async function handleIssueSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('issueTitle').value.trim();
    if (!title) { Toast.error('Title is required'); return; }

    const stepsText = issueQuillSteps?.getText().trim();
    const expectedText = issueQuillExpected?.getText().trim();
    const actualText = issueQuillActual?.getText().trim();
    if (!stepsText) { Toast.error('Steps to Reproduce is required'); return; }
    if (!expectedText) { Toast.error('Expected Result is required'); return; }
    if (!actualText) { Toast.error('Actual Result is required'); return; }

    const btn = document.getElementById('issueSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const payload = {
            project_id: projectId,
            sub_project_id: document.getElementById('issueSubProject')?.value || null,
            title,
            steps_to_reproduce: getQuillHtml(issueQuillSteps),
            expected_result: getQuillHtml(issueQuillExpected),
            actual_result: getQuillHtml(issueQuillActual),
            description: getQuillHtml(issueQuillDesc) || null,
            component: document.getElementById('issueComponent').value.trim() || null,
            environment: document.getElementById('issueEnvironment').value.trim() || null,
            issue_type: document.getElementById('issueType').value,
            severity: document.getElementById('issueSeverity').value,
            priority: document.getElementById('issuePriority').value,
            reproducibility: document.getElementById('issueReproducibility').value,
            assigned_to: document.getElementById('issueAssignee').value || null
        };

        const result = await api.request('/pms/issues', { method: 'POST', body: JSON.stringify(payload) });
        Toast.success(`Issue #${result.issue_number} created`);
        closeIssueModal();
        loadedTabs.delete('issues');
        loadProjectIssues();
    } catch (err) {
        Toast.error(err.message || 'Failed to create issue');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Report Issue';
    }
}

async function editProjectIssue(issueId) {
    try {
        const issue = await api.request(`/pms/issues/${issueId}`);
        if (!issue) { Toast.error('Issue not found'); return; }

        document.getElementById('issueForm').reset();
        document.getElementById('issueModal').classList.add('active');
        document.getElementById('issueTitle').value = issue.title;

        // Populate dropdowns
        if (!projectMembers || !projectMembers.length) {
            try {
                const resp = await api.request(`/pms/project-members?projectId=${projectId}`, { _skipSpinner: true });
                projectMembers = resp.data || resp || [];
            } catch (_) {}
        }
        const assigneeSelect = document.getElementById('issueAssignee');
        assigneeSelect.innerHTML = '<option value="">Unassigned</option>';
        projectMembers.forEach(m => {
            if (!m.user_name && !m.user_email) return;
            const label = m.user_name || m.user_email;
            assigneeSelect.innerHTML += `<option value="${m.user_id}"${m.user_id === issue.assigned_to ? ' selected' : ''}>${label}</option>`;
        });

        // Sub-project
        const spSelect = document.getElementById('issueSubProject');
        spSelect.innerHTML = '<option value="">None</option>';
        try {
            const sps = await api.request(`/pms/sub-projects?projectId=${projectId}`);
            (sps || []).forEach(sp => {
                spSelect.innerHTML += `<option value="${sp.id}"${sp.id === issue.sub_project_id ? ' selected' : ''}>${sp.sub_project_name}</option>`;
            });
        } catch (_) {}

        // Set select values
        document.getElementById('issueType').value = issue.issue_type || 'bug';
        document.getElementById('issueSeverity').value = issue.severity || 'medium';
        document.getElementById('issuePriority').value = issue.priority || 'P2';
        document.getElementById('issueComponent').value = issue.component || '';
        document.getElementById('issueEnvironment').value = issue.environment || '';
        document.getElementById('issueReproducibility').value = issue.reproducibility || 'always';

        // Init dropdowns + Quill
        setTimeout(() => {
            initIssueModalDropdowns();
            initIssueQuillEditors();

            // Populate Quill editors with existing content
            setTimeout(() => {
                if (issueQuillSteps && issue.steps_to_reproduce) issueQuillSteps.root.innerHTML = issue.steps_to_reproduce;
                if (issueQuillExpected && issue.expected_result) issueQuillExpected.root.innerHTML = issue.expected_result;
                if (issueQuillActual && issue.actual_result) issueQuillActual.root.innerHTML = issue.actual_result;
                if (issueQuillDesc && issue.description) issueQuillDesc.root.innerHTML = issue.description;
            }, 50);
        }, 100);

        // Store edit mode
        document.getElementById('issueForm').dataset.editId = issueId;
        document.querySelector('#issueModal .modal-title').textContent = 'Edit Issue';
        document.getElementById('issueSubmitBtn').textContent = 'Update Issue';
    } catch (err) {
        Toast.error('Failed to load issue for editing');
        console.error(err);
    }
}

async function deleteProjectIssue(issueId) {
    const confirmed = await Confirm.danger('Are you sure you want to delete this issue? This action cannot be undone.', 'Delete Issue');
    if (!confirmed) return;
    try {
        await api.request(`/pms/issues/${issueId}`, { method: 'DELETE' });
        Toast.success('Issue deleted');
        loadedTabs.delete('issues');
        loadProjectIssues();
    } catch (err) {
        Toast.error('Failed to delete issue');
    }
}
