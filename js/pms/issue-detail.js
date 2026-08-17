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
    { value: 'wontfix', label: "By Design" }
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
    { value: 'wontfix', label: "By Design" },
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

        // Show edit button when status is 'reported' or 'reopened'
        const editBtn = document.getElementById('editIssueBtn');
        const isEditable = issue.status === 'reported' || issue.status === 'reopened';
        if (editBtn) editBtn.style.display = isEditable ? '' : 'none';

        // Load and show attachments — upload/delete only when editable
        loadAttachments();
        const attachBtn = document.getElementById('attachUploadBtn');
        if (attachBtn) attachBtn.style.display = isEditable ? '' : 'none';
    } catch (e) {
        console.error('[IssueDetail] Failed to load issue:', e);
        // Parse error into a human-readable message with details
        let errorMsg = 'The issue content may be too large to display.';
        let errorDetails = '';
        try {
            const raw = e.message || '';
            if (raw.startsWith('{')) {
                const parsed = JSON.parse(raw);
                errorMsg = parsed.title || parsed.error || parsed.message || errorMsg;
                // Extract detailed validation errors
                if (parsed.errors) {
                    const details = [];
                    for (const [field, msgs] of Object.entries(parsed.errors)) {
                        const msgList = Array.isArray(msgs) ? msgs : [msgs];
                        details.push(...msgList.map(m => `<strong>${field}</strong>: ${m}`));
                    }
                    if (details.length) errorDetails = details.join('<br>');
                }
            } else if (raw.includes('Failed to fetch')) {
                errorMsg = 'Could not connect to the server. Please check your connection.';
            } else if (raw.length < 200) {
                errorMsg = raw;
            }
        } catch (_) { /* keep default message */ }

        const main = document.querySelector('.issue-detail-content') || document.querySelector('main') || document.body;
        main.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px;">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h3 style="color: var(--text-primary); margin-bottom: 8px;">Failed to load issue</h3>
                <p>${errorMsg}</p>
                ${errorDetails ? `<div style="margin-top: 12px; padding: 12px 20px; background: var(--bg-tertiary, rgba(255,255,255,0.05)); border-radius: 8px; display: inline-block; text-align: left; font-size: 0.85rem; line-height: 1.6;">${errorDetails}</div>` : ''}
                <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: center;">
                    <button onclick="loadIssueDetail()" class="btn btn-primary" style="padding: 8px 20px; cursor: pointer;">Retry</button>
                    <button onclick="goBack()" class="btn btn-outline" style="padding: 8px 20px; cursor: pointer;">Go Back</button>
                </div>
            </div>`;
        Toast.error('Failed to load issue');
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
        // Lazy-load embedded images to prevent memory issues with large base64 content
        const processed = html.replace(/<img\s+([^>]*?)src=["']([^"']+)["']/gi, (match, before, src) => {
            return `<img ${before}src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${src}" loading="lazy" style="max-width:100%;height:auto;"`;
        });
        el.innerHTML = processed;

        // Use IntersectionObserver to load images as they scroll into view
        const lazyImages = el.querySelectorAll('img[data-src]');
        if (lazyImages.length > 0) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        delete img.dataset.src;
                        observer.unobserve(img);
                    }
                });
            }, { rootMargin: '200px' });
            lazyImages.forEach(img => observer.observe(img));
        }
    } else {
        el.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No content provided</p>';
    }
}

function renderComments() {
    const userComments = comments.filter(c => !c.is_system);
    const systemComments = comments.filter(c => c.is_system);

    document.getElementById('commentCount').textContent = userComments.length;

    const list = document.getElementById('commentsList');

    // User comments
    if (userComments.length === 0) {
        list.innerHTML = '<div class="issue-comment-empty">No comments yet. Be the first to comment.</div>';
    } else {
        list.innerHTML = userComments.map(c => renderSingleComment(c)).join('');
    }

    // Activity log (system comments) — rendered in separate container at the end
    const activityContainer = document.getElementById('activityLogContainer');
    if (systemComments.length > 0) {
        activityContainer.innerHTML = `<div class="issue-activity-section">
            <div class="issue-activity-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                <span>Activity Log</span>
                <span class="issue-activity-count">${systemComments.length}</span>
            </div>
            <div class="issue-activity-list">
                ${systemComments.map(c => renderActivityItem(c)).join('')}
            </div>
        </div>`;
    } else {
        activityContainer.innerHTML = '';
    }
}

function renderActivityItem(c) {
    const name = c.user_name || 'Unknown';
    const initials = getInitials(name);
    const timeStr = formatRelativeTime(c.created_at);
    // Replace raw backend codes with human-readable labels in activity text
    const codeLabels = {
        'reported': 'Reported', 'in_progress': 'In Progress', 'qa_testing': 'QA Testing',
        'closed': 'Closed', 'verified': 'Verified', 'reopened': 'Reopened', 'wontfix': 'By Design',
        'fixed': 'Fixed', 'duplicate': 'Duplicate', 'cannot_reproduce': 'Cannot Reproduce'
    };
    let text = (c.comment || '').replace(/\*\*([a-z_]+)\*\*/g, (_, code) =>
        `<strong>${codeLabels[code] || code}</strong>`
    ).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'
    ).replace(/resolution: ([a-z_]+)/g, (_, code) =>
        `resolution: ${codeLabels[code] || code}`
    );
    return `
        <div class="issue-activity-item">
            <span class="issue-activity-dot"></span>
            <span class="issue-activity-text">${text}</span>
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
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
        wontfix: "By Design"
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

// ==================== Attachments ====================

let attachments = [];

async function loadAttachments() {
    try {
        const result = await api.request(`/pms/issue-attachments?issueId=${issueId}`);
        attachments = result.data || result || [];
        renderAttachments();
    } catch (e) {
        console.error('Failed to load attachments:', e);
        attachments = [];
        renderAttachments();
    }
}

function renderAttachments() {
    document.getElementById('attachmentCount').textContent = attachments.length;
    const list = document.getElementById('attachmentsList');

    if (!attachments || attachments.length === 0) {
        list.innerHTML = '<div class="issue-attachment-empty">No attachments</div>';
        return;
    }

    list.innerHTML = '<div class="issue-attachment-list">' + attachments.map(a => {
        const ext = (a.file_name || '').split('.').pop().toUpperCase().substring(0, 4) || 'FILE';
        const size = formatFileSize(a.file_size);
        const time = formatRelativeTime(a.created_at);
        return `
            <div class="issue-attachment-item">
                <div class="issue-attachment-icon">${escapeHtml(ext)}</div>
                <div class="issue-attachment-info">
                    <div class="issue-attachment-name" title="${escapeHtml(a.file_name)}">${escapeHtml(a.file_name)}</div>
                    <div class="issue-attachment-meta">${size} &middot; ${time}</div>
                </div>
                <div class="issue-attachment-actions">
                    <button onclick="previewAttachment('${a.id}','${escapeHtml(a.file_name)}','${escapeHtml(a.content_type || '')}')" title="Preview">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button onclick="downloadAttachment('${a.id}','${escapeHtml(a.file_name)}')" title="Download">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    ${(issue.status === 'reported' || issue.status === 'reopened') ? `<button class="delete-btn" onclick="deleteAttachment('${a.id}','${escapeHtml(a.file_name)}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>` : ''}
                </div>
            </div>`;
    }).join('') + '</div>';
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

async function handleAttachFiles(files) {
    if (!files || files.length === 0) return;
    const progress = document.getElementById('attachUploadProgress');

    for (const file of files) {
        if (file.size > 100 * 1024 * 1024) {
            Toast.error(`${file.name} exceeds 100MB limit`);
            continue;
        }

        progress.style.display = '';
        progress.innerHTML = `<div class="issue-upload-progress"><div class="spinner"></div> Uploading ${escapeHtml(file.name)}...</div>`;

        try {
            const formData = new FormData();
            formData.append('file', file);

            const token = getAuthToken();
            const baseUrl = CONFIG.pmsApiBaseUrl;
            const resp = await fetch(`${baseUrl}/issue-attachments/${issueId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const result = await resp.json();
            if (!resp.ok) throw new Error(result.error || 'Upload failed');

            Toast.success(`${file.name} attached`);
        } catch (e) {
            Toast.error(`Failed to upload ${file.name}: ${e.message}`);
        }
    }

    progress.style.display = 'none';
    document.getElementById('attachFileInput').value = '';
    loadAttachments();
}

async function previewAttachment(attachmentId, fileName, contentType) {
    try {
        const result = await api.request(`/pms/issue-attachments/${attachmentId}/download`);
        const url = result.url || result.data?.url;
        if (!url) { Toast.error('Failed to get URL'); return; }

        const ct = (contentType || '').toLowerCase();
        const isPreviewable = ct.startsWith('image/') || ct === 'application/pdf' ||
            ct.startsWith('video/') || ct.startsWith('audio/') || ct.startsWith('text/');
        const isOfficeDoc = /\.(docx?|xlsx?|pptx?)$/i.test(fileName || '');

        if (isPreviewable) {
            window.open(url, '_blank');
        } else if (isOfficeDoc) {
            window.open(`https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=false`, '_blank');
        } else {
            window.open(url, '_blank');
        }
    } catch (e) {
        Toast.error('Preview failed: ' + e.message);
    }
}

async function downloadAttachment(attachmentId, fileName) {
    try {
        const result = await api.request(`/pms/issue-attachments/${attachmentId}/download`);
        const url = result.url || result.data?.url;
        if (!url) { Toast.error('Failed to get download URL'); return; }

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (e) {
        Toast.error('Download failed: ' + e.message);
    }
}

async function deleteAttachment(attachmentId, fileName) {
    if (!confirm(`Delete attachment "${fileName}"?`)) return;
    try {
        await api.request(`/pms/issue-attachments/${attachmentId}`, { method: 'DELETE' });
        Toast.success('Attachment deleted');
        loadAttachments();
    } catch (e) {
        Toast.error('Delete failed: ' + e.message);
    }
}

// ==================== Inline Issue Editing ====================

let isEditMode = false;
let editQuills = {};

function toggleEditMode() {
    if (issue.status !== 'reported' && issue.status !== 'reopened') {
        Toast.error('Issues can only be edited while in Reported or Reopened status');
        return;
    }
    if (isEditMode) {
        cancelEditMode();
    } else {
        enterEditMode();
    }
}

function enterEditMode() {
    isEditMode = true;
    document.getElementById('editIssueBtn').title = 'Cancel Edit';

    const sections = [
        { id: 'contentActual', field: 'actual_result', label: 'Issue Description' },
        { id: 'contentExpected', field: 'expected_result', label: 'Expected Result' },
        { id: 'contentSteps', field: 'steps_to_reproduce', label: 'Steps to Reproduce' },
        { id: 'contentNotes', field: 'description', label: 'Notes' }
    ];

    sections.forEach(s => {
        const el = document.getElementById(s.id);
        const originalHtml = issue[s.field] || '';
        el.dataset.originalHtml = originalHtml;
        el.innerHTML = `<div id="editQuill_${s.field}"></div>`;
        const quill = new Quill(`#editQuill_${s.field}`, {
            theme: 'snow',
            modules: { toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link', 'image'], ['clean']] },
            placeholder: `Enter ${s.label.toLowerCase()}...`
        });
        quill.root.innerHTML = originalHtml;
        editQuills[s.field] = quill;
    });

    // Also make title editable
    const titleEl = document.getElementById('issueTitle');
    titleEl.contentEditable = true;
    titleEl.style.borderBottom = '2px solid var(--brand-primary)';
    titleEl.style.outline = 'none';
    titleEl.dataset.originalTitle = issue.title;

    // Add save/cancel bar
    const contentSections = document.getElementById('contentSections');
    const bar = document.createElement('div');
    bar.id = 'editActionsBar';
    bar.className = 'glass-card-sm';
    bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;margin-top:12px;';
    bar.innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="cancelEditMode()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="saveIssueBtn" onclick="saveIssueEdits()">Save Changes</button>
    `;
    contentSections.after(bar);
}

function cancelEditMode() {
    isEditMode = false;
    document.getElementById('editIssueBtn').title = 'Edit Issue';

    // Restore title
    const titleEl = document.getElementById('issueTitle');
    titleEl.contentEditable = false;
    titleEl.style.borderBottom = '';
    titleEl.textContent = issue.title;

    // Restore content sections
    renderContentTabs();

    // Destroy quills
    editQuills = {};

    // Remove save bar
    const bar = document.getElementById('editActionsBar');
    if (bar) bar.remove();
}

async function saveIssueEdits() {
    const btn = document.getElementById('saveIssueBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const titleEl = document.getElementById('issueTitle');
        const title = titleEl.textContent.trim();
        if (!title) { Toast.error('Title is required'); return; }

        const getHtml = (field) => {
            const q = editQuills[field];
            if (!q) return undefined;
            const text = q.getText().trim();
            return text ? q.root.innerHTML : '';
        };

        const payload = {
            title,
            actual_result: getHtml('actual_result'),
            expected_result: getHtml('expected_result'),
            steps_to_reproduce: getHtml('steps_to_reproduce'),
            description: getHtml('description')
        };

        await api.request(`/pms/issues/${issueId}`, { method: 'PUT', body: JSON.stringify(payload) });
        Toast.success('Issue updated');

        // Reload to get fresh data
        await loadIssueDetail();
        cancelEditMode();
    } catch (e) {
        Toast.error(e.message || 'Failed to update issue');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Changes';
    }
}
