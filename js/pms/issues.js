/**
 * PMS Issues (Bug Tracker)
 * Handles issue listing, filtering, creating with Quill rich text editors.
 */

// ==================== State ====================
let allIssues = [];
let allProjects = [];
let searchTimeout = null;
let quillSteps = null;
let quillExpected = null;
let quillActual = null;
let quillDescription = null;

const QUILL_TOOLBAR = [
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    ['code-block'],
    ['link', 'image'],
    ['clean']
];

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');
    loadProjects();
    loadIssues();
    loadStats();
});

// ==================== Data Loading ====================

async function loadProjects() {
    try {
        const projects = await api.request('/pms/projects');
        allProjects = projects || [];
        const filterSelect = document.getElementById('filterProject');
        const modalSelect = document.getElementById('issueProject');
        allProjects.forEach(p => {
            const code = p.project_code ? `${p.project_code} - ` : '';
            filterSelect.innerHTML += `<option value="${p.id}">${code}${p.project_name}</option>`;
            modalSelect.innerHTML += `<option value="${p.id}">${code}${p.project_name}</option>`;
        });
    } catch (e) {
        console.error('[Issues] Failed to load projects:', e);
    }
}

async function onIssueProjectChange() {
    const projectId = document.getElementById('issueProject').value;
    const subProjectSelect = document.getElementById('issueSubProject');
    subProjectSelect.innerHTML = '<option value="">None</option>';

    if (!projectId) return;

    try {
        const subProjects = await api.request(`/pms/sub-projects?projectId=${projectId}`);
        if (subProjects && subProjects.length > 0) {
            subProjects.forEach(sp => {
                subProjectSelect.innerHTML += `<option value="${sp.id}">${sp.sub_project_name}</option>`;
            });
        }

        // Also load project members for assignee dropdown
        const members = await api.request(`/pms/project-members?projectId=${projectId}`);
        const assigneeSelect = document.getElementById('issueAssignee');
        assigneeSelect.innerHTML = '<option value="">Unassigned</option>';
        if (members && members.length > 0) {
            members.forEach(m => {
                assigneeSelect.innerHTML += `<option value="${m.user_id}">${m.user_name || m.user_id}</option>`;
            });
        }
    } catch (e) {
        console.error('[Issues] Failed to load sub-projects/members:', e);
    }
}

async function loadIssues() {
    try {
        const params = new URLSearchParams();
        const project = document.getElementById('filterProject').value;
        const status = document.getElementById('filterStatus').value;
        const severity = document.getElementById('filterSeverity').value;
        const priority = document.getElementById('filterPriority').value;
        const search = document.getElementById('filterSearch').value;

        const fromDate = document.getElementById('filterFromDate').value;
        const toDate = document.getElementById('filterToDate').value;

        if (project) params.set('projectId', project);
        if (status) params.set('status', status);
        if (severity) params.set('severity', severity);
        if (priority) params.set('priority', priority);
        if (search) params.set('search', search);
        if (fromDate) params.set('fromDate', fromDate);
        if (toDate) params.set('toDate', toDate);

        const qs = params.toString();
        allIssues = await api.request(`/pms/issues${qs ? '?' + qs : ''}`);
        renderIssuesTable(allIssues);
    } catch (e) {
        console.error('[Issues] Failed to load issues:', e);
        document.getElementById('issuesTableBody').innerHTML =
            '<tr><td colspan="10"><div class="empty-state"><p>Failed to load issues</p></div></td></tr>';
    }
}

async function loadStats() {
    try {
        const stats = await api.request('/pms/issues/stats');
        document.getElementById('statTotal').textContent = stats.total || 0;
        document.getElementById('statReported').textContent = stats.reported || 0;
        document.getElementById('statInProgress').textContent = stats.in_progress || 0;
        document.getElementById('statClosed').textContent = stats.closed || 0;
    } catch (e) {
        console.error('[Issues] Failed to load stats:', e);
    }
}

function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadIssues(), 400);
}

// ==================== Rendering ====================

function renderIssuesTable(issues) {
    const tbody = document.getElementById('issuesTableBody');

    if (!issues || issues.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="10">
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <p>No issues found</p>
                    <button class="btn btn-primary btn-sm" onclick="openNewIssueModal()">Report your first issue</button>
                </div>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = issues.map(issue => {
        const projectCode = issue.project_code || '???';
        const issueRef = `${projectCode}-${issue.issue_number}`;
        const age = getAge(issue.created_at);
        const typeIcon = getTypeIcon(issue.issue_type);
        const componentTag = issue.component ? `<span class="component-tag">${escapeHtml(issue.component)}</span>` : '';
        const subProjectTag = issue.sub_project_name ? `<span class="component-tag">${escapeHtml(issue.sub_project_name)}</span>` : '';
        const resolutionBadge = issue.resolution ? `<span class="resolution-badge resolution-${issue.resolution}">${issue.resolution}</span>` : '';

        return `
            <tr>
                <td><span class="issue-number">${escapeHtml(issueRef)}</span></td>
                <td class="issue-title-cell">
                    <a href="issue-detail.html?id=${issue.id}" title="${escapeHtml(issue.title)}">${escapeHtml(issue.title)}</a>
                    ${subProjectTag}${componentTag}
                </td>
                <td><span class="issue-type-badge">${typeIcon} ${issue.issue_type}</span></td>
                <td><span class="severity-badge severity-${issue.severity}">${issue.severity}</span></td>
                <td><span class="priority-badge priority-${issue.priority}">${issue.priority}</span></td>
                <td>
                    <span class="issue-status-badge issue-status-${issue.status}">${formatStatus(issue.status)}</span>
                    ${resolutionBadge}
                </td>
                <td>${escapeHtml(issue.assigned_to_name || 'Unassigned')}</td>
                <td>${escapeHtml(issue.reported_by_name || '—')}</td>
                <td class="issue-age">${age}</td>
                <td>
                    <div class="action-btns">
                        <a href="issue-detail.html?id=${issue.id}" class="action-btn" data-tooltip="View">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </a>
                        <button class="action-btn action-btn-danger" onclick="deleteIssue('${issue.id}')" data-tooltip="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

// ==================== Helpers ====================

function getTypeIcon(type) {
    const icons = {
        bug: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        improvement: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>',
        task: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-info, #3b82f6)" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>',
        question: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };
    return icons[type] || icons.bug;
}

function formatStatus(status) {
    const labels = {
        reported: 'Reported',
        in_progress: 'In Progress',
        qa_testing: 'QA Testing',
        closed: 'Closed',
        reopened: 'Reopened',
        wontfix: "Won't Fix"
    };
    return labels[status] || status;
}

function getAge(dateStr) {
    const created = new Date(dateStr);
    const now = new Date();
    const diffMs = now - created;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getQuillText(quillInstance) {
    if (!quillInstance) return '';
    return quillInstance.getText().trim();
}

function getQuillHtml(quillInstance) {
    if (!quillInstance) return '';
    const text = quillInstance.getText().trim();
    if (!text) return '';
    return quillInstance.root.innerHTML;
}

// ==================== Quill Editors ====================

function initQuillEditors() {
    // Destroy existing instances
    destroyQuillEditors();

    const opts = {
        theme: 'snow',
        modules: { toolbar: QUILL_TOOLBAR },
    };

    quillSteps = new Quill('#editorSteps', {
        ...opts,
        placeholder: '1. Go to...\n2. Click on...\n3. Observe...'
    });
    quillExpected = new Quill('#editorExpected', {
        ...opts,
        placeholder: 'What should happen'
    });
    quillActual = new Quill('#editorActual', {
        ...opts,
        placeholder: 'What actually happened (paste screenshots here)'
    });
    quillDescription = new Quill('#editorDescription', {
        ...opts,
        placeholder: 'Any additional context, notes, or screenshots...'
    });
}

function destroyQuillEditors() {
    // Quill doesn't have a native destroy — clear containers
    ['editorSteps', 'editorExpected', 'editorActual', 'editorDescription'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            // Remove Quill toolbar + editor, recreate empty div
            const parent = el.parentElement;
            const toolbar = parent.querySelector('.ql-toolbar');
            if (toolbar) toolbar.remove();
            el.innerHTML = '';
            el.className = '';
        }
    });
    quillSteps = quillExpected = quillActual = quillDescription = null;
}

// ==================== Editor Tabs ====================

function switchEditorTab(tab, btnEl) {
    // Deactivate all tabs
    document.querySelectorAll('.issue-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.issue-tab-panel').forEach(p => p.classList.remove('active'));

    // Activate selected
    btnEl.classList.add('active');
    const panelMap = { steps: 'tabSteps', expected: 'tabExpected', actual: 'tabActual', description: 'tabDescription' };
    document.getElementById(panelMap[tab]).classList.add('active');
}

// ==================== Modal ====================

function openNewIssueModal() {
    document.getElementById('issueForm').reset();
    document.getElementById('issueModalTitle').textContent = 'Report Issue';
    document.getElementById('issueSubmitBtn').textContent = 'Report Issue';
    document.getElementById('issueSubProject').innerHTML = '<option value="">Select project first</option>';
    document.getElementById('issueAssignee').innerHTML = '<option value="">Unassigned</option>';

    const modal = document.getElementById('issueModal');
    modal.classList.add('active');

    // Init Quill after modal is visible (needs rendered DOM)
    setTimeout(() => initQuillEditors(), 100);
}

function closeIssueModal() {
    document.getElementById('issueModal').classList.remove('active');
    destroyQuillEditors();
}

async function handleIssueSubmit(e) {
    e.preventDefault();

    const title = document.getElementById('issueTitle').value.trim();
    const projectId = document.getElementById('issueProject').value;
    const stepsText = getQuillText(quillSteps);
    const expectedText = getQuillText(quillExpected);
    const actualText = getQuillText(quillActual);

    if (!title) { Toast.error('Title is required'); return; }
    if (!projectId) { Toast.error('Project is required'); return; }
    if (!stepsText) { Toast.error('Steps to Reproduce is required'); return; }
    if (!expectedText) { Toast.error('Expected Result is required'); return; }
    if (!actualText) { Toast.error('Actual Result is required'); return; }

    const btn = document.getElementById('issueSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const subProjectId = document.getElementById('issueSubProject').value || null;

        const payload = {
            project_id: projectId,
            sub_project_id: subProjectId,
            title: title,
            steps_to_reproduce: getQuillHtml(quillSteps),
            expected_result: getQuillHtml(quillExpected),
            actual_result: getQuillHtml(quillActual),
            description: getQuillHtml(quillDescription) || null,
            environment: document.getElementById('issueEnvironment').value.trim() || null,
            component: document.getElementById('issueComponent').value.trim() || null,
            issue_type: document.getElementById('issueType').value,
            severity: document.getElementById('issueSeverity').value,
            priority: document.getElementById('issuePriority').value,
            reproducibility: document.getElementById('issueReproducibility').value,
            assigned_to: document.getElementById('issueAssignee').value || null
        };

        const result = await api.request('/pms/issues', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        Toast.success(`Issue #${result.issue_number} created`);
        closeIssueModal();
        loadIssues();
        loadStats();
    } catch (err) {
        Toast.error(err.message || 'Failed to create issue');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Report Issue';
    }
}

// ==================== Actions ====================

async function deleteIssue(issueId) {
    const confirmed = await Confirm.danger('Are you sure you want to delete this issue? This action cannot be undone.', 'Delete Issue');
    if (!confirmed) return;
    try {
        await api.request(`/pms/issues/${issueId}`, { method: 'DELETE' });
        Toast.success('Issue deleted');
        loadIssues();
        loadStats();
    } catch (err) {
        Toast.error('Failed to delete issue');
    }
}
