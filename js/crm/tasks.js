/**
 * CRM Tasks
 * ----------------------------------------------------------------------------
 * The task API shipped with no screen behind it, so tasks created by the AI
 * assistant (create_crm_task) landed in a table nobody could open. This is that
 * screen.
 *
 * Covers every endpoint the controller serves:
 *   GET    /api/crm-tasks               list + status / assignee filters
 *   GET    /api/crm-tasks/my            assigned to me
 *   GET    /api/crm-tasks/overdue       past due and not finished
 *   GET    /api/crm-tasks/{id}          single (opened for edit)
 *   POST   /api/crm-tasks               create
 *   PUT    /api/crm-tasks/{id}          edit
 *   POST   /api/crm-tasks/{id}/complete mark done
 *   DELETE /api/crm-tasks/{id}          remove
 *
 * The API serialises snake_case (SnakeCaseLower policy), so every field read
 * off a response uses snake_case. Reading camelCase here silently yields
 * undefined and renders an empty card.
 */

// ── State ───────────────────────────────────────────────────────────────
let _tasks = [];
let _view = 'my';            // 'my' | 'overdue' | 'all'
let _statusFilter = '';
let _editingId = null;
let _myUserId = null;
let _teamMembers = [];

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_LABEL = {
    pending: 'Pending',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled'
};
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

// ── Escaping ────────────────────────────────────────────────────────────
// Quote-safe: the textContent/innerHTML trick escapes only & < > and leaves
// values placed inside quoted attributes open to breakout.
function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── Boot ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof Navigation !== 'undefined' && Navigation.init) Navigation.init();
    _myUserId = readUserIdFromToken();
    await loadTeamMembers();
    await loadTasks();
});

function readUserIdFromToken() {
    // The app stores the signed-in user under ragenaizer_user and the JWT under
    // ragenaizer_authToken — not 'accessToken'/'token'. Reading the wrong key
    // leaves the assignee picker with no "Me" option, which is the common case.
    try {
        const u = JSON.parse(localStorage.getItem('ragenaizer_user') || '{}');
        if (u.userId || u.id) return u.userId || u.id;
    } catch { /* fall through to the token */ }
    try {
        const raw = localStorage.getItem('ragenaizer_authToken');
        if (!raw) return null;
        const payload = JSON.parse(atob(raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.sub
            || payload.nameid
            || payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']
            || null;
    } catch { return null; }
}

async function loadTeamMembers() {
    // Used to turn an assigned_to_user_id into a name, and to populate the
    // assignee picker. A failure here must not stop tasks rendering.
    try {
        const res = await api.request('/crm/crm-admin/users');
        _teamMembers = Array.isArray(res) ? res : (res?.users || []);
    } catch {
        _teamMembers = [];
    }
}

function memberName(userId) {
    if (!userId) return 'Unassigned';
    const m = _teamMembers.find(x => (x.user_id || x.id) === userId);
    if (!m) return userId === _myUserId ? 'Me' : 'Someone else';
    return m.full_name || m.name || m.email || userId;
}

// ── Load ────────────────────────────────────────────────────────────────
async function loadTasks() {
    showLoading(true);
    try {
        let endpoint;
        if (_view === 'my') endpoint = '/crm/crm-tasks/my';
        else if (_view === 'overdue') endpoint = '/crm/crm-tasks/overdue';
        else endpoint = '/crm/crm-tasks' + (_statusFilter ? `?status=${encodeURIComponent(_statusFilter)}` : '');

        const res = await api.request(endpoint);
        _tasks = Array.isArray(res) ? res : (res?.tasks || []);
        renderTasks();
        renderCounts();
    } catch (e) {
        console.error('Failed to load tasks:', e);
        Toast.error(e.message || 'Could not load tasks');
        _tasks = [];
        renderTasks();
    } finally {
        showLoading(false);
    }
}

// ── Render ──────────────────────────────────────────────────────────────
function renderTasks() {
    const grid = document.getElementById('tasksGrid');
    const empty = document.getElementById('emptyState');
    const search = (document.getElementById('taskSearch')?.value || '').toLowerCase().trim();

    let list = _tasks.slice();
    if (search) {
        list = list.filter(t =>
            (t.title || '').toLowerCase().includes(search) ||
            (t.description || '').toLowerCase().includes(search));
    }

    list.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 9;
        const pb = PRIORITY_ORDER[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return da - db;
    });

    renderCounts(list.length);

    if (!list.length) {
        grid.innerHTML = '';
        empty.style.display = '';
        setEmptyCopy(!!search);
        return;
    }
    empty.style.display = 'none';
    grid.innerHTML = list.map(renderTaskCard).join('');
}

function setEmptyCopy(isSearching) {
    const h = document.getElementById('emptyTitle');
    const p = document.getElementById('emptyBody');
    if (!h || !p) return;
    if (isSearching) {
        h.textContent = 'Nothing matches that search';
        p.textContent = 'No task in this view has those words in its title or details. '
            + 'Clear the search box, or try another tab.';
        return;
    }
    if (_view === 'my') {
        h.textContent = 'Nothing assigned to you';
        p.innerHTML = 'Tasks assigned to you appear here. Create one with <strong>New task</strong>, '
            + 'or ask the Sales Assistant to add one for you.';
    } else if (_view === 'overdue') {
        h.textContent = 'Nothing overdue';
        p.textContent = 'Every task with a due date is still within it. This list fills up on its own.';
    } else {
        h.textContent = 'No tasks yet';
        p.innerHTML = 'Tasks track follow-up work that is not a call or an email — paperwork, '
            + 'internal checks, anything with a due date. Start with <strong>New task</strong>.';
    }
}

// ─── Ageing ─────────────────────────────────────────────────────────────────
// Same language as My Day's arrears ledger: overdue work buckets like
// receivable debt (1–30 / 31–60 / 61–90 / 90+), the day count is the figure,
// and a gauge places it on a 0→90 scale.
const AGE_CAP = 90;

function overdueDays(t) {
    if (!isOverdue(t)) return null;
    const days = Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000);
    return days >= 1 ? days : null;
}

function ageBucket(days) {
    if (days == null) return 'clear';
    if (days > 60) return '90';
    if (days > 30) return '60';
    return '30';
}

// The follow-up generator stamps every task it creates with the same sentence.
// Rendered, it is a line of identical grey text on every card in the grid that
// tells the reader nothing they cannot see from the title. Only the generator's
// exact boilerplate is suppressed — anything a person actually typed is shown.
const TASK_BOILERPLATE = new Set(['auto-created follow-up', 'auto created follow-up']);
function isBoilerplate(desc) {
    const d = String(desc ?? '').trim();
    return !d || TASK_BOILERPLATE.has(d.toLowerCase());
}

function renderTaskCard(t) {
    const overdue = isOverdue(t);
    const done = t.status === 'completed';
    const id = escapeHtml(t.id);
    const days = overdueDays(t);
    const bucket = ageBucket(days);
    const fill = days == null ? 0 : Math.max(4, Math.min(100, (days / AGE_CAP) * 100));

    // A work queue is scanned, not browsed. One row per task at ~60px beats a
    // 4-across grid of 220px cards: the same 30 tasks fit in a third of the
    // scroll, and the ageing figures line up in a single column so the list
    // reads top-to-bottom as a ranked queue.
    const pri = escapeHtml(t.priority || 'medium');
    const meta = [
        { text: memberName(t.assigned_to_user_id) },
        t.entity_type ? { text: String(t.entity_type), cls: 'tsk-row-entity' } : null,
        isBoilerplate(t.description) ? null : { text: t.description }
    ].filter(Boolean);

    return `
    <article class="tsk-row pri-${pri}${done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}"
             data-id="${id}" data-age="${bucket}" style="--age-fill:${fill}%">
        <span class="tsk-row-dot" title="${escapeHtml(PRIORITY_LABEL[t.priority] || 'Medium')} priority"></span>

        <div class="tsk-row-main">
            <h3 class="tsk-row-title">${escapeHtml(t.title)}</h3>
            <p class="tsk-row-meta">
                <span class="tsk-row-pri">${escapeHtml(PRIORITY_LABEL[t.priority] || t.priority || 'Medium')}</span>
                ${meta.map(m => `<span${m.cls ? ` class="${m.cls}"` : ''}>${escapeHtml(m.text)}</span>`).join('')}
                ${done || t.status === 'cancelled' || t.status === 'in_progress'
                    ? `<span class="tsk-row-status tsk-status-${escapeHtml(t.status)}">${escapeHtml(STATUS_LABEL[t.status] || t.status)}</span>`
                    : ''}
            </p>
        </div>

        <div class="tsk-row-age">
            ${days != null
                ? `<span class="tsk-age-num">${days}<em>d</em></span>
                   <span class="tsk-age-word">overdue</span>`
                : `<span class="tsk-age-due">${t.due_date ? escapeHtml(formatDue(t.due_date)) : 'No due date'}</span>`}
        </div>

        <div class="tsk-row-actions">
            ${done ? '' : `<button class="tsk-act tsk-act-done" data-act="complete" data-id="${id}"
                    title="Mark done" aria-label="Mark done">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </button>`}
            <button class="tsk-act" data-act="edit" data-id="${id}" title="Edit task" aria-label="Edit task">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="tsk-act tsk-act-del" data-act="delete" data-id="${id}" title="Delete task" aria-label="Delete task">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>

        <!-- Always rendered, even at zero fill: the track is also the row
             divider, so a not-yet-overdue row would otherwise merge into its
             neighbour with no separation at all. -->
        <span class="tsk-row-gauge" aria-hidden="true"></span>
    </article>`;
}

// Event delegation — no data in inline handlers, so a task title containing a
// quote can never break out into the handler.
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    if (act === 'complete') completeTask(id);
    else if (act === 'edit') openEditTaskModal(id);
    else if (act === 'delete') deleteTask(id);
});

function renderCounts(shown) {
    const el = document.getElementById('taskCount');
    if (!el) return;
    const total = _tasks.length;
    const n = (shown === undefined) ? total : shown;
    // While a search narrows the list, saying "30 tasks" over an empty grid is
    // a lie — show both numbers.
    el.textContent = (n === total)
        ? (total === 1 ? '1 task' : `${total} tasks`)
        : `${n} of ${total} tasks`;
}

function isOverdue(t) {
    if (!t.due_date) return false;
    if (t.status === 'completed' || t.status === 'cancelled') return false;
    return new Date(t.due_date).getTime() < Date.now();
}

function formatDue(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(d); target.setHours(0, 0, 0, 0);
    const days = Math.round((target - today) / 86400000);
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    if (days === -1) return '1 day overdue';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days <= 7) return `Due in ${days} days`;
    return 'Due ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── View switching ──────────────────────────────────────────────────────
function switchView(view, el) {
    _view = view;
    // A search typed in one tab silently emptying the next one is the kind of
    // thing that reads as a broken page.
    const search = document.getElementById('taskSearch');
    if (search) search.value = '';
    document.querySelectorAll('.tsk-tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    document.getElementById('statusFilterWrap').style.display = view === 'all' ? '' : 'none';
    loadTasks();
}

function onStatusFilterChange() {
    _statusFilter = document.getElementById('statusFilter').value;
    loadTasks();
}

function filterTasks() { renderTasks(); }

// ── Create / Edit ───────────────────────────────────────────────────────
function openCreateTaskModal() {
    _editingId = null;
    document.getElementById('taskModalTitle').textContent = 'New task';
    document.getElementById('taskSubmitBtn').textContent = 'Create task';
    document.getElementById('taskForm').reset();
    document.getElementById('taskStatusRow').style.display = 'none';
    // Default to yourself: a task created from My Tasks that defaults to
    // unassigned vanishes from the view you created it in.
    populateAssigneeOptions(_myUserId);
    openModal('taskModal');
}

async function openEditTaskModal(id) {
    try {
        const t = await api.request(`/crm/crm-tasks/${encodeURIComponent(id)}`);
        _editingId = id;
        document.getElementById('taskModalTitle').textContent = 'Edit task';
        document.getElementById('taskSubmitBtn').textContent = 'Save changes';
        document.getElementById('taskTitle').value = t.title || '';
        document.getElementById('taskDescription').value = t.description || '';
        document.getElementById('taskDueDate').value = t.due_date ? String(t.due_date).slice(0, 10) : '';
        document.getElementById('taskPriority').value = t.priority || 'medium';
        document.getElementById('taskStatus').value = t.status || 'pending';
        document.getElementById('taskStatusRow').style.display = '';
        populateAssigneeOptions(t.assigned_to_user_id);
        openModal('taskModal');
    } catch (e) {
        console.error('Failed to open task:', e);
        Toast.error(e.message || 'Could not open that task');
    }
}

function populateAssigneeOptions(selected) {
    const sel = document.getElementById('taskAssignee');
    if (!sel) return;
    const opts = ['<option value="">Unassigned</option>'];
    if (_myUserId) {
        opts.push(`<option value="${escapeHtml(_myUserId)}">Me</option>`);
    }
    _teamMembers.forEach(m => {
        const uid = m.user_id || m.id;
        if (!uid || uid === _myUserId) return;
        opts.push(`<option value="${escapeHtml(uid)}">${escapeHtml(m.full_name || m.name || m.email || uid)}</option>`);
    });
    sel.innerHTML = opts.join('');
    sel.value = selected || '';
    // auto-searchable-select re-reads the option list on change.
    sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function closeTaskModal() { closeModal('taskModal'); _editingId = null; }

let _taskSaveInFlight = false;
async function handleTaskSubmit(event) {
    event.preventDefault();
    // Re-entrancy guard on the FUNCTION, not just the button: a disabled button blocks a second real
    // click, but this also stops any other double-entry path (Enter+click race, programmatic re-call)
    // from firing a second POST and creating a duplicate task.
    if (_taskSaveInFlight) return;
    const title = document.getElementById('taskTitle').value.trim();
    if (!title) { Toast.error('Give the task a title'); return; }

    const due = document.getElementById('taskDueDate').value;
    const body = {
        title,
        description: document.getElementById('taskDescription').value.trim() || null,
        due_date: due ? new Date(due + 'T00:00:00').toISOString() : null,
        priority: document.getElementById('taskPriority').value || 'medium',
        assigned_to_user_id: document.getElementById('taskAssignee').value || null
    };
    if (_editingId) body.status = document.getElementById('taskStatus').value;

    // Disable Save while the request is in flight — without this a double-click fired two POSTs and
    // created duplicate tasks (the sibling deal/company/lead-field handlers all guard this way).
    const submitBtn = document.getElementById('taskSubmitBtn');
    const originalText = submitBtn ? submitBtn.textContent : '';
    _taskSaveInFlight = true;
    if (submitBtn) submitBtn.disabled = true;
    try {
        if (_editingId) {
            await api.request(`/crm/crm-tasks/${encodeURIComponent(_editingId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            Toast.success('Task updated');
        } else {
            await api.request('/crm/crm-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            Toast.success('Task created');
        }
        closeTaskModal();
        await loadTasks();
    } catch (e) {
        console.error('Failed to save task:', e);
        Toast.error(e.message || 'Could not save the task');
    } finally {
        _taskSaveInFlight = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
    }
}

// ── Complete / Delete ───────────────────────────────────────────────────
async function completeTask(id) {
    try {
        await api.request(`/crm/crm-tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' });
        Toast.success('Task completed');
        loadTasks();
    } catch (e) {
        console.error('Failed to complete task:', e);
        Toast.error(e.message || 'Could not complete the task');
    }
}

async function deleteTask(id) {
    const t = _tasks.find(x => x.id === id);
    const label = t ? `“${t.title}”` : 'this task';
    const ok = await showConfirm(`Delete ${label}? This cannot be undone.`, 'Delete task', 'danger');
    if (!ok) return;
    try {
        await api.request(`/crm/crm-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        Toast.success('Task deleted');
        loadTasks();
    } catch (e) {
        console.error('Failed to delete task:', e);
        Toast.error(e.message || 'Could not delete the task');
    }
}

// ── Modal / loading plumbing ────────────────────────────────────────────
function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('active');
}
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('active');
}
function showLoading(show) {
    const el = document.getElementById('loadingState');
    if (el) el.style.display = show ? '' : 'none';
}
