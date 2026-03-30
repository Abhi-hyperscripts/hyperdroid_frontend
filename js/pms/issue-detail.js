/**
 * PMS Issue Detail
 * Displays full issue with metadata, content tabs, status management, and comments.
 */

// ==================== State ====================
let issueId = null;
let issue = null;
let comments = [];
let projectMembers = [];
let quillComment = null;
let currentUserId = null;
let isPmsAdmin = false;
let editingCommentId = null;

const STATUSES = [
    { value: 'reported', label: 'Reported' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'qa_testing', label: 'QA Testing' },
    { value: 'closed', label: 'Closed' },
    { value: 'verified', label: 'Verified' },
    { value: 'reopened', label: 'Reopened' },
    { value: 'wontfix', label: "Won't Fix" }
];

// Must match backend ValidIssueTransitions
const VALID_TRANSITIONS = {
    reported:    ['in_progress', 'wontfix'],
    in_progress: ['qa_testing', 'reported'],
    qa_testing:  ['closed', 'reopened'],
    closed:      ['reopened', 'verified'],
    verified:    ['reopened'],
    reopened:    ['in_progress', 'wontfix'],
    wontfix:     ['reopened']
};

const RESOLUTIONS = [
    { value: 'fixed', label: 'Fixed' },
    { value: 'wontfix', label: "Won't Fix" },
    { value: 'duplicate', label: 'Duplicate' },
    { value: 'cannot_reproduce', label: 'Cannot Reproduce' }
];

const QUILL_COMPACT_TOOLBAR = [
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    ['code-block'],
    ['link', 'image'],
    ['clean']
];

// ==================== Navigation ====================

function goBack() {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    const pid = params.get('projectId');
    if (from === 'project' && pid) {
        window.location.href = `project-detail.html?id=${pid}#issues`;
    } else if (document.referrer && document.referrer.includes(window.location.origin)) {
        history.back();
    } else {
        window.location.href = 'issues.html';
    }
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');

    issueId = new URLSearchParams(window.location.search).get('id');
    if (!issueId) {
        window.location.href = 'issues.html';
        return;
    }

    loadUserRole();
    loadIssueDetail();
    loadComments();
    initCommentEditor();

    // Close status dropdown on outside click
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('statusDropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            document.getElementById('statusMenu').classList.remove('open');
        }
    });
});

// ==================== RBAC ====================

async function loadUserRole() {
    try {
        const resp = await api.request('/pms/projects/user-role', { _skipSpinner: true });
        const data = resp.data || resp;
        isPmsAdmin = data.is_admin || data.is_super_admin || false;
        currentUserId = data.user_id || null;
    } catch (e) {
        console.error('[IssueDetail] Failed to load user role:', e);
        // Fallback: try to decode JWT
        try {
            const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
            if (token) {
                const payload = JSON.parse(atob(token.split('.')[1]));
                currentUserId = payload.sub || payload.nameid || payload.unique_name || null;
            }
        } catch (_) { /* ignore */ }
    }
}

// ==================== Data Loading ====================

async function loadIssueDetail() {
    try {
        const result = await api.request(`/pms/issues/${issueId}`);
        issue = result.data || result;
        renderHeader();
        renderMetadata();
        renderContentTabs();
        loadProjectMembers();
        document.title = `${getIssueRef()} - ${issue.title} | Ragenaizer`;
    } catch (e) {
        console.error('[IssueDetail] Failed to load issue:', e);
        Toast.error('Failed to load issue');
        setTimeout(() => window.location.href = 'issues.html', 1500);
    }
}

async function loadProjectMembers() {
    if (!issue || !issue.project_id) return;
    try {
        const members = await api.request(`/pms/project-members?projectId=${issue.project_id}`, { _skipSpinner: true });
        projectMembers = members || [];
    } catch (e) {
        console.error('[IssueDetail] Failed to load project members:', e);
    }
}

async function loadComments() {
    try {
        const result = await api.request(`/pms/issue-comments?issueId=${issueId}`, { _skipSpinner: true });
        comments = result || [];
        if (Array.isArray(result.data)) comments = result.data;
        // Sort newest first
        if (Array.isArray(comments)) {
            comments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        renderComments();
    } catch (e) {
        console.error('[IssueDetail] Failed to load comments:', e);
    }
}

// ==================== Rendering ====================

function getIssueRef() {
    if (!issue) return '---';
    const code = issue.project_code || '???';
    return `${code}-${issue.issue_number}`;
}

function renderHeader() {
    const ref = getIssueRef();
    document.getElementById('issueRef').textContent = ref;
    document.getElementById('issueTitle').textContent = issue.title;

    // Update breadcrumb based on origin context
    const params = new URLSearchParams(window.location.search);
    const breadcrumbNav = document.querySelector('.breadcrumb-nav');
    if (params.get('from') === 'project' && issue.project_name) {
        const pid = params.get('projectId');
        breadcrumbNav.innerHTML = `
            <a href="dashboard.html">PMS</a>
            <span class="separator">/</span>
            <a href="projects.html">Projects</a>
            <span class="separator">/</span>
            <a href="project-detail.html?id=${pid}#issues">${escapeHtml(issue.project_name)}</a>
            <span class="separator">/</span>
            <span class="current">${ref}</span>
        `;
    } else {
        document.getElementById('breadcrumbIssue').textContent = ref;
    }

    // Project / Sub-Project / Client subtitle
    const subtitleEl = document.getElementById('issueSubtitle');
    if (subtitleEl) {
        const parts = [];
        if (issue.client_name) parts.push(`<span class="issue-subtitle-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> ${escapeHtml(issue.client_name)}</span>`);
        if (issue.project_name) parts.push(`<span class="issue-subtitle-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg> ${escapeHtml(issue.project_name)}</span>`);
        if (issue.sub_project_name) parts.push(`<span class="issue-subtitle-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${escapeHtml(issue.sub_project_name)}</span>`);
        subtitleEl.innerHTML = parts.join('<span class="issue-subtitle-sep">/</span>');
    }

    // Status badge
    renderStatusBadge();

    // Assignee action
    const actionsEl = document.getElementById('headerActions');
    const assigneeLabel = issue.assigned_to_name || 'Unassigned';
    actionsEl.innerHTML = `
        <div class="issue-detail-assignee" id="assigneeSection">
            <span class="issue-detail-assignee-label">Assignee:</span>
            <button class="issue-detail-assignee-btn" onclick="toggleAssigneeDropdown()" title="Change assignee">
                <span class="issue-comment-avatar-sm">${getInitials(assigneeLabel)}</span>
                <span>${escapeHtml(assigneeLabel)}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <div class="issue-assignee-menu" id="assigneeMenu"></div>
        </div>
    `;
}

function renderStatusBadge() {
    const badge = document.getElementById('statusBadge');
    badge.className = `issue-status-badge issue-status-${issue.status}`;
    badge.textContent = formatStatus(issue.status);

    // Build status menu — only show valid transitions from current status
    const menu = document.getElementById('statusMenu');
    const allowed = VALID_TRANSITIONS[issue.status] || [];
    let html = '';
    allowed.forEach(statusValue => {
        const s = STATUSES.find(st => st.value === statusValue);
        if (!s) return;
        if (s.value === 'closed') {
            // Closed requires resolution — show sub-options directly
            html += `<div class="issue-status-option" data-status="closed" onclick="showResolutionOptions(event)">
                <span class="issue-status-dot issue-status-dot-closed"></span>
                Closed
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:auto"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </div>`;
            html += `<div class="issue-resolution-options" id="resolutionOptions">`;
            RESOLUTIONS.forEach(r => {
                html += `<div class="issue-status-option issue-resolution-option" onclick="changeStatus('closed', '${r.value}')">
                    <span class="issue-status-dot issue-status-dot-closed"></span>
                    ${r.label}
                </div>`;
            });
            html += `</div>`;
        } else {
            html += `<div class="issue-status-option" onclick="changeStatus('${s.value}')">
                <span class="issue-status-dot issue-status-dot-${s.value}"></span>
                ${s.label}
            </div>`;
        }
    });
    if (allowed.length === 0) {
        html = '<div style="padding:10px 12px;color:var(--text-secondary);font-size:0.8rem;">No transitions available</div>';
    }
    menu.innerHTML = html;
}

function renderMetadata() {
    const meta = document.getElementById('issueMeta');
    const items = [
        { label: 'Type', value: formatType(issue.issue_type) },
        { label: 'Severity', value: `<span class="severity-badge severity-${issue.severity}">${issue.severity}</span>` },
        { label: 'Priority', value: `<span class="priority-badge priority-${issue.priority}">${issue.priority}</span>` },
        { label: 'Reproducibility', value: formatReproducibility(issue.reproducibility) },
        { label: 'Project', value: escapeHtml(issue.project_name || '-') },
        { label: 'Sub-Project', value: escapeHtml(issue.sub_project_name || '-') },
        { label: 'Component', value: escapeHtml(issue.component || '-') },
        { label: 'Environment', value: escapeHtml(issue.environment || '-') },
        { label: 'Reporter', value: escapeHtml(issue.reported_by_name || '-') },
        { label: 'Resolution', value: issue.resolution ? `<span class="resolution-badge resolution-${issue.resolution}">${issue.resolution}</span>` : '-' },
        { label: 'Created', value: formatDateTime(issue.created_at) },
        { label: 'Updated', value: formatDateTime(issue.updated_at) },
    ];

    meta.innerHTML = items.map(item => `
        <div class="issue-detail-meta-item">
            <span class="issue-detail-meta-label">${item.label}</span>
            <span class="issue-detail-meta-value">${item.value}</span>
        </div>
    `).join('');
}

function renderContentTabs() {
    setContentHtml('contentActual', issue.actual_result);
    setContentHtml('contentExpected', issue.expected_result);
    setContentHtml('contentSteps', issue.steps_to_reproduce);
    setContentHtml('contentNotes', issue.description);
}

function setContentHtml(elementId, html) {
    const el = document.getElementById(elementId);
    if (html && html.trim()) {
        el.innerHTML = html;
    } else {
        el.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No content provided</p>';
    }
}

function renderComments() {
    const userComments = comments.filter(c => !c.is_system);
    const systemComments = comments.filter(c => c.is_system);

    document.getElementById('commentCount').textContent = userComments.length;

    const list = document.getElementById('commentsList');

    let html = '';

    // User comments
    if (userComments.length === 0) {
        html += '<div class="issue-comment-empty">No comments yet. Be the first to comment.</div>';
    } else {
        html += userComments.map(c => renderSingleComment(c)).join('');
    }

    // Activity log (system comments) — collapsible
    if (systemComments.length > 0) {
        html += `<div class="issue-activity-section">
            <div class="issue-activity-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                <span>Activity Log</span>
                <span class="issue-activity-count">${systemComments.length}</span>
            </div>
            <div class="issue-activity-list">
                ${systemComments.map(c => renderActivityItem(c)).join('')}
            </div>
        </div>`;
    }

    list.innerHTML = html;
}

function renderActivityItem(c) {
    const name = c.user_name || 'Unknown';
    const initials = getInitials(name);
    const timeStr = formatRelativeTime(c.created_at);
    return `
        <div class="issue-activity-item">
            <span class="issue-activity-dot"></span>
            <span class="issue-activity-text">${c.comment || ''}</span>
            <span class="issue-activity-meta">— ${escapeHtml(name)}, ${timeStr}</span>
        </div>`;
}

function renderSingleComment(c) {
    const isOwn = currentUserId && c.user_id === currentUserId;
    const isSystem = c.is_system;
    const name = c.user_name || 'Unknown';
    const initials = getInitials(name);
    const timeStr = formatRelativeTime(c.created_at);
    const editedStr = c.updated_at && c.updated_at !== c.created_at
        ? `<span class="issue-comment-edited">(edited)</span>` : '';

    const actions = isOwn && !isSystem ? `
        <div class="issue-comment-actions">
            <button class="issue-comment-action-btn" onclick="startEditComment('${c.id}')" title="Edit">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="issue-comment-action-btn action-btn-danger" onclick="deleteComment('${c.id}')" title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>
    ` : '';

    // Render replies if any
    let repliesHtml = '';
    if (c.replies && c.replies.length > 0) {
        repliesHtml = '<div class="issue-comment-replies">' +
            c.replies.map(r => renderSingleComment(r)).join('') +
            '</div>';
    }

    return `
        <div class="issue-comment ${isSystem ? 'system' : ''}" data-comment-id="${c.id}">
            <div class="issue-comment-header">
                <span class="issue-comment-avatar">${initials}</span>
                <span class="issue-comment-author">${escapeHtml(name)}</span>
                <span class="issue-comment-time">${timeStr} ${editedStr}</span>
                ${actions}
            </div>
            <div class="issue-comment-body" id="commentBody-${c.id}">${c.comment || ''}</div>
            ${repliesHtml}
        </div>
    `;
}

// ==================== Status Management ====================

function toggleStatusDropdown() {
    const menu = document.getElementById('statusMenu');
    menu.classList.toggle('open');
    // Hide resolution sub-options by default
    const resOpts = document.getElementById('resolutionOptions');
    if (resOpts) resOpts.classList.remove('open');
}

function showResolutionOptions(e) {
    e.stopPropagation();
    const resOpts = document.getElementById('resolutionOptions');
    if (resOpts) resOpts.classList.toggle('open');
}

async function changeStatus(status, resolution) {
    try {
        const body = { status };
        if (resolution) body.resolution = resolution;

        await api.request(`/pms/issues/${issueId}/status`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });

        issue.status = status;
        if (resolution) issue.resolution = resolution;

        renderStatusBadge();
        renderMetadata();
        document.getElementById('statusMenu').classList.remove('open');
        Toast.success(`Status updated to ${formatStatus(status)}${resolution ? ' (' + resolution + ')' : ''}`);

        // Reload to get updated timestamps
        loadComments();
    } catch (e) {
        Toast.error(e.message || 'Failed to update status');
    }
}

// ==================== Assignee Management ====================

function toggleAssigneeDropdown() {
    const menu = document.getElementById('assigneeMenu');
    if (menu.classList.contains('open')) {
        menu.classList.remove('open');
        return;
    }

    let html = `<div class="issue-status-option${!issue.assigned_to ? ' active' : ''}" onclick="changeAssignee('')">
        <span class="issue-comment-avatar-sm" style="background: var(--bg-tertiary); color: var(--text-secondary);">?</span>
        Unassigned
    </div>`;

    projectMembers.forEach(m => {
        const name = m.user_name || m.user_id;
        const active = m.user_id === issue.assigned_to ? ' active' : '';
        html += `<div class="issue-status-option${active}" onclick="changeAssignee('${m.user_id}')">
            <span class="issue-comment-avatar-sm">${getInitials(name)}</span>
            ${escapeHtml(name)}
        </div>`;
    });

    menu.innerHTML = html;
    menu.classList.add('open');

    // Close on outside click
    const closeHandler = (e) => {
        if (!menu.contains(e.target) && !e.target.closest('.issue-detail-assignee-btn')) {
            menu.classList.remove('open');
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

async function changeAssignee(userId) {
    try {
        await api.request(`/pms/issues/${issueId}/assign`, {
            method: 'PUT',
            body: JSON.stringify({ assigned_to: userId || null })
        });

        // Update local state
        issue.assigned_to = userId || null;
        const member = projectMembers.find(m => m.user_id === userId);
        issue.assigned_to_name = member ? (member.user_name || member.user_id) : null;

        renderHeader();
        document.getElementById('assigneeMenu').classList.remove('open');
        Toast.success(`Assignee updated to ${issue.assigned_to_name || 'Unassigned'}`);
        loadComments();
    } catch (e) {
        Toast.error(e.message || 'Failed to update assignee');
    }
}

// ==================== Comment Editor ====================

function initCommentEditor() {
    quillComment = new Quill('#commentEditor', {
        theme: 'snow',
        modules: {
            toolbar: QUILL_COMPACT_TOOLBAR
        },
        placeholder: 'Write a comment...'
    });

    // Image paste support - embed as base64
    quillComment.root.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData || !clipboardData.items) return;

        for (let i = 0; i < clipboardData.items.length; i++) {
            const item = clipboardData.items[i];
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file) continue;

                const reader = new FileReader();
                reader.onload = (evt) => {
                    const range = quillComment.getSelection(true);
                    quillComment.insertEmbed(range.index, 'image', evt.target.result);
                    quillComment.setSelection(range.index + 1);
                };
                reader.readAsDataURL(file);
                break;
            }
        }
    });
}

// ==================== Comment Actions ====================

async function submitComment() {
    const text = quillComment.getText().trim();
    if (!text) {
        Toast.warning('Comment cannot be empty');
        return;
    }

    const html = quillComment.root.innerHTML;
    const btn = document.getElementById('submitCommentBtn');
    btn.disabled = true;
    btn.textContent = 'Posting...';

    try {
        if (editingCommentId) {
            // Update existing comment
            await api.request(`/pms/issue-comments/${editingCommentId}`, {
                method: 'PUT',
                body: JSON.stringify({ comment: html })
            });
            Toast.success('Comment updated');
            cancelEditComment();
        } else {
            // Create new comment
            await api.request('/pms/issue-comments', {
                method: 'POST',
                body: JSON.stringify({
                    issue_id: issueId,
                    comment: html
                })
            });
            Toast.success('Comment added');
        }

        quillComment.setContents([]);
        await loadComments();
    } catch (e) {
        Toast.error(e.message || 'Failed to post comment');
    } finally {
        btn.disabled = false;
        btn.textContent = editingCommentId ? 'Update Comment' : 'Add Comment';
        editingCommentId = null;
    }
}

function startEditComment(commentId) {
    const comment = findComment(commentId);
    if (!comment) return;

    editingCommentId = commentId;
    quillComment.root.innerHTML = comment.comment || '';
    quillComment.focus();

    const btn = document.getElementById('submitCommentBtn');
    btn.textContent = 'Update Comment';

    // Show cancel button
    const footer = document.querySelector('.issue-comment-form-footer');
    if (!document.getElementById('cancelEditBtn')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'cancelEditBtn';
        cancelBtn.className = 'btn btn-secondary btn-sm';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = cancelEditComment;
        footer.insertBefore(cancelBtn, btn);
    }

    // Scroll to editor
    document.getElementById('commentForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditComment() {
    editingCommentId = null;
    quillComment.setContents([]);
    document.getElementById('submitCommentBtn').textContent = 'Add Comment';
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) cancelBtn.remove();
}

async function deleteComment(commentId) {
    if (!confirm('Delete this comment?')) return;

    try {
        await api.request(`/pms/issue-comments/${commentId}`, { method: 'DELETE' });
        Toast.success('Comment deleted');
        await loadComments();
    } catch (e) {
        Toast.error(e.message || 'Failed to delete comment');
    }
}

function findComment(id) {
    for (const c of comments) {
        if (c.id === id) return c;
        if (c.replies) {
            const found = c.replies.find(r => r.id === id);
            if (found) return found;
        }
    }
    return null;
}

// ==================== Content Sections ====================
// All sections are always visible (stacked layout for print support)

// ==================== Helpers ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
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

function formatType(type) {
    const badges = {
        bug: '<span class="issue-type-pill issue-type-bug">Bug</span>',
        improvement: '<span class="issue-type-pill issue-type-improvement">Improvement</span>',
        task: '<span class="issue-type-pill issue-type-task">Task</span>',
        question: '<span class="issue-type-pill issue-type-question">Question</span>'
    };
    return badges[type] || escapeHtml(type);
}

function formatReproducibility(val) {
    const labels = {
        always: 'Always',
        sometimes: 'Sometimes',
        rarely: 'Rarely',
        cannot_reproduce: 'Cannot Reproduce'
    };
    return labels[val] || val || '-';
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
