// LMS Discussions JavaScript

let courseId = null;
let currentThreadId = null;
let threads = [];

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('lms', '../');
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Get courseId from URL params
    const params = new URLSearchParams(window.location.search);
    courseId = params.get('courseId');

    if (!courseId) {
        showToast('No course specified', 'error');
        window.location.href = 'dashboard.html';
        return;
    }

    // Set breadcrumb link
    const breadcrumbCourse = document.getElementById('breadcrumbCourse');
    if (breadcrumbCourse) {
        breadcrumbCourse.href = `course-detail.html?id=${courseId}`;
    }

    await loadThreads();
});

/**
 * Load all discussion threads for the course
 */
async function loadThreads() {
    const threadsList = document.getElementById('threadsList');
    const pinnedList = document.getElementById('pinnedThreadsList');
    const pinnedSection = document.getElementById('pinnedThreadsSection');

    try {
        const data = await api.request(`/lms/discussions/course/${courseId}`);
        threads = data.threads || data || [];

        // Update course title if available
        if (data.course_title) {
            document.getElementById('courseTitle').textContent = data.course_title;
        }

        // Separate pinned and regular threads
        const pinned = threads.filter(t => t.is_pinned);
        const regular = threads.filter(t => !t.is_pinned);

        // Update thread count
        document.getElementById('threadCount').textContent = `${threads.length} thread${threads.length !== 1 ? 's' : ''}`;

        // Render pinned threads
        if (pinned.length > 0) {
            pinnedSection.style.display = '';
            pinnedList.innerHTML = pinned.map(renderThreadCard).join('');
        } else {
            pinnedSection.style.display = 'none';
        }

        // Render regular threads (sorted by date descending)
        regular.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (regular.length === 0 && pinned.length === 0) {
            threadsList.innerHTML = `
                <div class="empty-state">
                    <p>No discussions yet. Start the conversation!</p>
                </div>`;
        } else {
            threadsList.innerHTML = regular.map(renderThreadCard).join('');
        }
    } catch (error) {
        console.error('Error loading threads:', error);
        threadsList.innerHTML = `
            <div class="empty-state">
                <p>Error loading discussions</p>
            </div>`;
        showToast('Error loading discussions', 'error');
    }
}

/**
 * Render a single thread card
 */
function renderThreadCard(thread) {
    const date = formatDate(thread.created_at);
    const replyCount = thread.reply_count ?? 0;
    const hasSolution = thread.has_solution ? '<span class="solution-indicator">Solved</span>' : '';
    const pinnedIcon = thread.is_pinned ? `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="pinned-icon">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
        </svg>` : '';

    return `
        <div class="discussion-thread-card" onclick="showThread('${thread.id}')">
            <div class="thread-card-header">
                ${pinnedIcon}
                <h4 class="thread-card-title">${escapeHtml(thread.title)}</h4>
                ${hasSolution}
            </div>
            <div class="thread-card-meta">
                <span class="thread-author">${escapeHtml(thread.author_name || 'Unknown')}</span>
                <span class="thread-date">${date}</span>
                <span class="thread-replies">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                    </svg>
                    ${replyCount} repl${replyCount !== 1 ? 'ies' : 'y'}
                </span>
            </div>
            <div class="thread-card-preview">${escapeHtml(truncate(thread.body || '', 150))}</div>
        </div>`;
}

/**
 * Show thread detail view
 */
async function showThread(threadId) {
    currentThreadId = threadId;

    // Switch views
    document.getElementById('threadListView').style.display = 'none';
    document.getElementById('threadDetailView').style.display = '';

    const repliesList = document.getElementById('repliesList');
    repliesList.innerHTML = '<div class="lms-loading">Loading replies...</div>';

    try {
        const data = await api.request(`/lms/discussions/${threadId}`);
        const thread = data.thread || data;

        // Render thread content
        document.getElementById('threadTitle').textContent = thread.title || '';
        document.getElementById('threadMeta').innerHTML = `
            <span class="thread-author">${escapeHtml(thread.author_name || 'Unknown')}</span>
            <span class="thread-date">${formatDate(thread.created_at)}</span>`;
        document.getElementById('threadBody').innerHTML = formatBody(thread.body || '');

        // Render solution if present
        const solutionEl = document.getElementById('threadSolution');
        if (thread.solution) {
            solutionEl.style.display = '';
            document.getElementById('solutionContent').innerHTML = formatBody(thread.solution.body || '');
        } else {
            solutionEl.style.display = 'none';
        }

        // Render replies
        const replies = thread.replies || data.replies || [];
        document.getElementById('replyCount').textContent = `${replies.length} repl${replies.length !== 1 ? 'ies' : 'y'}`;

        if (replies.length === 0) {
            repliesList.innerHTML = `
                <div class="empty-state">
                    <p>No replies yet. Be the first to respond!</p>
                </div>`;
        } else {
            repliesList.innerHTML = replies.map(renderReply).join('');
        }
    } catch (error) {
        console.error('Error loading thread:', error);
        showToast('Error loading thread', 'error');
        repliesList.innerHTML = `
            <div class="empty-state">
                <p>Error loading thread details</p>
            </div>`;
    }
}

/**
 * Render a single reply
 */
function renderReply(reply) {
    const isSolution = reply.is_solution ? '<span class="solution-indicator">Solution</span>' : '';
    return `
        <div class="reply-card ${reply.is_solution ? 'reply-solution' : ''}">
            <div class="reply-header">
                <span class="reply-author">${escapeHtml(reply.author_name || 'Unknown')}</span>
                <span class="reply-date">${formatDate(reply.created_at)}</span>
                ${isSolution}
            </div>
            <div class="reply-body">${formatBody(reply.body || '')}</div>
        </div>`;
}

/**
 * Back to thread list
 */
function backToThreads() {
    currentThreadId = null;
    document.getElementById('threadDetailView').style.display = 'none';
    document.getElementById('threadListView').style.display = '';
}

/**
 * Show create thread modal
 */
function showCreateThreadModal() {
    document.getElementById('threadTitleInput').value = '';
    document.getElementById('threadBodyInput').value = '';
    document.getElementById('createThreadModal').style.display = 'flex';
}

/**
 * Close create thread modal
 */
function closeCreateThreadModal() {
    document.getElementById('createThreadModal').style.display = 'none';
}

/**
 * Create a new discussion thread
 */
async function createThread() {
    const title = document.getElementById('threadTitleInput').value.trim();
    const body = document.getElementById('threadBodyInput').value.trim();

    if (!title) {
        showToast('Please enter a thread title', 'error');
        return;
    }
    if (!body) {
        showToast('Please enter a thread body', 'error');
        return;
    }

    const btn = document.getElementById('btnSubmitThread');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        await api.request(`/lms/discussions/course/${courseId}`, {
            method: 'POST',
            body: JSON.stringify({ title, body })
        });
        showToast('Thread created successfully', 'success');
        closeCreateThreadModal();
        await loadThreads();
    } catch (error) {
        console.error('Error creating thread:', error);
        showToast('Error creating thread', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Thread';
    }
}

/**
 * Post a reply to the current thread
 */
async function postReply() {
    if (!currentThreadId) return;

    const body = document.getElementById('replyBody').value.trim();
    if (!body) {
        showToast('Please enter a reply', 'error');
        return;
    }

    const btn = document.getElementById('btnPostReply');
    btn.disabled = true;
    btn.textContent = 'Posting...';

    try {
        await api.request(`/lms/discussions/${currentThreadId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ body })
        });
        showToast('Reply posted successfully', 'success');
        document.getElementById('replyBody').value = '';
        await showThread(currentThreadId);
    } catch (error) {
        console.error('Error posting reply:', error);
        showToast('Error posting reply', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Post Reply';
    }
}

// ==================== Utility Functions ====================

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatBody(text) {
    // Basic: escape HTML then convert newlines to <br>
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function truncate(str, len) {
    if (!str || str.length <= len) return str;
    return str.substring(0, len) + '...';
}
