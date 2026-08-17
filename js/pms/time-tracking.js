/**
 * PMS Time Tracking
 * Handles CRUD operations for time entries with weekly view.
 */

// ==================== State ====================
let timeEntries = [];
let allProjects = [];
let projectTasks = [];
let currentWeekStart = getMondayOfWeek(new Date());
let currentEditEntryId = null;

// SearchableDropdown instances
let entryProjectDropdown = null;
let entrySubProjectDropdown = null;
let entryTaskDropdown = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');

    const token = getAuthToken();
    if (!token) {
        window.location.href = '../login.html';
        return;
    }

    updateWeekDisplay();
    loadProjects();
    loadTimeEntries();
});

// ==================== Week Utilities ====================

/**
 * Get Monday of the week for a given date
 */
function getMondayOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Get Sunday (end) of the week from a Monday start
 */
function getSundayOfWeek(monday) {
    const d = new Date(monday);
    d.setDate(d.getDate() + 6);
    return d;
}

/**
 * Format date as YYYY-MM-DD for API calls
 */
function formatDateParam(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Format date for display (e.g., "Mar 3, 2026")
 */
function formatDateDisplay(date) {
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Format date for day headers (e.g., "Monday, Mar 3")
 */
function formatDayHeader(dateStr) {
    try {
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

/**
 * Format time as "Xh Ym"
 */
function formatTime(hours, minutes) {
    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    if (h === 0 && m === 0) return '0h 0m';
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

// ==================== Week Navigation ====================

function previousWeek() {
    currentWeekStart = new Date(currentWeekStart);
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    updateWeekDisplay();
    loadTimeEntries();
}

function nextWeek() {
    currentWeekStart = new Date(currentWeekStart);
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    updateWeekDisplay();
    loadTimeEntries();
}

function updateWeekDisplay() {
    const weekEnd = getSundayOfWeek(currentWeekStart);
    const display = `${formatDateDisplay(currentWeekStart)} - ${formatDateDisplay(weekEnd)}`;
    const el = document.getElementById('weekDisplay');
    if (el) el.textContent = display;
}

// ==================== Data Loading ====================

/**
 * Load time entries for the current week
 */
async function loadTimeEntries() {
    try {
        const fromDate = formatDateParam(currentWeekStart);
        const toDate = formatDateParam(getSundayOfWeek(currentWeekStart));
        const endpoint = `/pms/time-entries/my?fromDate=${fromDate}&toDate=${toDate}`;

        const response = await api.request(endpoint);
        timeEntries = response.data || response || [];
        renderTimeEntries();
        loadStats();
    } catch (error) {
        console.error('Failed to load time entries:', error);
        timeEntries = [];
        renderTimeEntries();
        loadStats();
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to load time entries');
        }
    }
}

/**
 * Load projects for dropdown
 */
async function loadProjects() {
    try {
        const response = await api.request('/pms/projects');
        allProjects = response.data || response || [];
        populateProjectDropdown();
    } catch (error) {
        console.error('Failed to load projects:', error);
        allProjects = [];
    }
}

/**
 * Populate project dropdown in modal
 */
function populateProjectDropdown() {
    const select = document.getElementById('entryProject');
    if (!select) return;

    select.innerHTML = '<option value="">Select Project</option>';
    allProjects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.project_name || project.name || '';
        select.appendChild(option);
    });
    if (typeof convertSelectToSearchable === 'function') {
        if (entryProjectDropdown) entryProjectDropdown.destroy();
        entryProjectDropdown = convertSelectToSearchable('entryProject', { placeholder: 'Select Project', searchPlaceholder: 'Search projects...', onChange: () => onProjectChange() });
    }
}

/**
 * Load tasks when project is selected
 */
async function onProjectChange() {
    const projectId = document.getElementById('entryProject').value;
    const taskSelect = document.getElementById('entryTask');
    const subSelect = document.getElementById('entrySubProject');
    taskSelect.innerHTML = '<option value="">Select Task</option>';
    projectTasks = [];

    if (!projectId) {
        if (subSelect) subSelect.innerHTML = '<option value="">Select project first</option>';
        if (typeof convertSelectToSearchable === 'function') {
            if (entryTaskDropdown) entryTaskDropdown.destroy();
            entryTaskDropdown = convertSelectToSearchable('entryTask', { placeholder: 'Select Task', searchPlaceholder: 'Search tasks...' });
            if (entrySubProjectDropdown) entrySubProjectDropdown.destroy();
            entrySubProjectDropdown = convertSelectToSearchable('entrySubProject', { placeholder: 'Select project first', searchPlaceholder: 'Search sub-projects...' });
        }
        return;
    }

    // Load tasks + the caller's accessible sub-projects in parallel. The
    // sub-project picker is sourced from /sub-projects/member-assignments
    // which already returns only the sub-projects the current user is
    // allowed to log against (empty allowlist ⇒ all sub-projects).
    try {
        const [tasksResp, subsResp] = await Promise.all([
            api.request(`/pms/tasks?projectId=${projectId}`).catch(() => []),
            api.request(`/pms/sub-projects/member-assignments?projectId=${projectId}`).catch(() => ({ sub_projects: [] }))
        ]);
        projectTasks = tasksResp.data || tasksResp || [];
        projectTasks.forEach(task => {
            const option = document.createElement('option');
            option.value = task.id;
            option.textContent = task.title || '';
            taskSelect.appendChild(option);
        });

        const subs = (subsResp && subsResp.sub_projects) || [];
        if (subSelect) {
            // Required only when sub-projects exist on this project. If none
            // exist the field stays optional and shows "(none)" placeholder.
            if (subs.length > 0) {
                subSelect.required = true;
                subSelect.innerHTML = '<option value="">Select sub-project</option>';
                subs.forEach(sp => {
                    subSelect.innerHTML += `<option value="${sp.id}">${(sp.sub_project_name || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</option>`;
                });
            } else {
                subSelect.required = false;
                subSelect.innerHTML = '<option value="">(none)</option>';
            }
        }
    } catch (error) {
        console.error('Failed to load tasks/sub-projects:', error);
    }
    if (typeof convertSelectToSearchable === 'function') {
        if (entryTaskDropdown) entryTaskDropdown.destroy();
        entryTaskDropdown = convertSelectToSearchable('entryTask', { placeholder: 'Select Task', searchPlaceholder: 'Search tasks...' });
        if (entrySubProjectDropdown) entrySubProjectDropdown.destroy();
        entrySubProjectDropdown = convertSelectToSearchable('entrySubProject', { placeholder: 'Select sub-project', searchPlaceholder: 'Search sub-projects...' });
    }
}

// ==================== Stats ====================

/**
 * Calculate and display stats from entries array
 */
function loadStats() {
    const today = formatDateParam(new Date());
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = formatDateParam(monthStart);

    let hoursToday = 0, minutesToday = 0;
    let hoursWeek = 0, minutesWeek = 0;
    let hoursMonth = 0, minutesMonth = 0;
    let totalEntries = 0;

    // For month calculation, we use the loaded entries (which are for the current week)
    // plus we note that month stats should ideally come from a wider range.
    // We'll calculate from the current week's entries for now.
    timeEntries.forEach(entry => {
        const h = parseInt(entry.hours) || 0;
        const m = parseInt(entry.minutes) || 0;
        const entryDate = (entry.log_date || '').substring(0, 10);

        // Week total (all loaded entries are for the current week)
        hoursWeek += h;
        minutesWeek += m;
        totalEntries++;

        // Today
        if (entryDate === today) {
            hoursToday += h;
            minutesToday += m;
        }

        // Month (entries within current month)
        if (entryDate >= monthStartStr) {
            hoursMonth += h;
            minutesMonth += m;
        }
    });

    // Normalize minutes to hours
    hoursToday += Math.floor(minutesToday / 60);
    minutesToday = minutesToday % 60;

    hoursWeek += Math.floor(minutesWeek / 60);
    minutesWeek = minutesWeek % 60;

    hoursMonth += Math.floor(minutesMonth / 60);
    minutesMonth = minutesMonth % 60;

    document.getElementById('statHoursToday').textContent = formatTime(hoursToday, minutesToday);
    document.getElementById('statHoursWeek').textContent = formatTime(hoursWeek, minutesWeek);
    document.getElementById('statHoursMonth').textContent = formatTime(hoursMonth, minutesMonth);
    document.getElementById('statBillableHours').textContent = totalEntries;
}

// ==================== Table Rendering ====================

/**
 * Render time entries grouped by date with day headers
 */
function renderTimeEntries() {
    const tbody = document.getElementById('timeEntriesTableBody');

    if (!timeEntries || timeEntries.length === 0) {
        const canLog = Array.isArray(allProjects) && allProjects.length > 0;
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        <p>No time entries for this week</p>
                        ${canLog
                            ? '<button class="btn btn-sm btn-primary" onclick="openLogTimeModal()">Log your first entry</button>'
                            : '<p style="color: var(--text-secondary); font-size: 0.85rem;">Ask a PMS administrator to add you to a project first.</p>'}
                    </div>
                </td>
            </tr>
        `;
        // Hide the header "+ Log Time" button when there's nowhere to log
        // against — backend will 403 anyway, button is misleading.
        const headerBtn = document.getElementById('logTimeBtn');
        if (headerBtn) headerBtn.style.display = canLog ? '' : 'none';
        return;
    }

    // Group entries by date
    const grouped = {};
    timeEntries.forEach(entry => {
        const dateKey = (entry.log_date || '').substring(0, 10);
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(entry);
    });

    // Sort dates descending (most recent first)
    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    let html = '';
    sortedDates.forEach(dateKey => {
        const entries = grouped[dateKey];

        // Calculate day subtotal
        let dayHours = 0, dayMinutes = 0;
        entries.forEach(e => {
            dayHours += parseInt(e.hours) || 0;
            dayMinutes += parseInt(e.minutes) || 0;
        });
        dayHours += Math.floor(dayMinutes / 60);
        dayMinutes = dayMinutes % 60;

        // Day header row
        html += `
            <tr class="crm-group-header">
                <td colspan="7" style="background: var(--bg-tertiary); font-weight: 600; color: var(--text-primary); padding: 8px 12px; border-bottom: 1px solid var(--border-primary);">
                    ${formatDayHeader(dateKey)}
                    <span style="float: right; color: var(--text-secondary); font-weight: 500;">Total: ${formatTime(dayHours, dayMinutes)}</span>
                </td>
            </tr>
        `;

        // Entry rows
        entries.forEach(entry => {
            const projectName = entry.project_name || getProjectName(entry.project_id);
            const taskName = getTaskName(entry);

            html += `
                <tr data-entry-id="${entry.id}">
                    <td>
                        <span class="crm-cell-secondary">${formatEntryDate(entry.log_date)}</span>
                    </td>
                    <td>
                        <div class="crm-cell-primary">${escapeHtml(projectName)}</div>
                    </td>
                    <td>
                        <span class="crm-cell-secondary">${escapeHtml(taskName)}</span>
                    </td>
                    <td>
                        <span class="crm-cell-primary">${parseInt(entry.hours) || 0}</span>
                    </td>
                    <td>
                        <span class="crm-cell-primary">${parseInt(entry.minutes) || 0}</span>
                    </td>
                    <td class="hide-mobile">
                        <span class="crm-cell-secondary">${escapeHtml(entry.comment || '-')}</span>
                    </td>
                    <td>
                        <div class="crm-actions">
                            <button class="crm-action-btn" onclick="editTimeEntry('${entry.id}')" title="Edit">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </button>
                            <button class="crm-action-btn action-delete" onclick="deleteTimeEntry('${entry.id}')" title="Delete">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
    });

    tbody.innerHTML = html;
}

/**
 * Get project name by ID from loaded projects
 */
function getProjectName(projectId) {
    if (!projectId) return '-';
    const project = allProjects.find(p => p.id === projectId);
    return project ? (project.project_name || project.name || '-') : '-';
}

/**
 * Get task name from entry
 */
function getTaskName(entry) {
    if (entry.task_title) return entry.task_title;
    if (!entry.task_id) return '-';
    return entry.task_id;
}

/**
 * Format entry date for table display
 */
function formatEntryDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

// ==================== Modal Handling ====================

function openLogTimeModal() {
    // Defense in depth — the header CTA + empty-state CTA are hidden when
    // the user has no projects, but stale page state could still call us.
    if (!Array.isArray(allProjects) || allProjects.length === 0) {
        if (typeof Toast !== 'undefined') {
            Toast.error('You need to be a member of at least one project before logging time. Ask your admin.');
        }
        return;
    }
    currentEditEntryId = null;
    document.getElementById('timeEntryModalTitle').textContent = 'Log Time';
    const submitBtn = document.getElementById('timeEntrySubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="timeEntrySubmitSpinner" style="display:none;"></span> Log Time';
    document.getElementById('timeEntryForm').reset();
    document.getElementById('timeEntryId').value = '';

    // Set default date to today
    document.getElementById('entryDate').value = formatDateParam(new Date());
    document.getElementById('entryHours').value = '0';
    document.getElementById('entryMinutes').value = '0';

    // Reset task dropdown
    document.getElementById('entryTask').innerHTML = '<option value="">Select Task</option>';
    if (typeof convertSelectToSearchable === 'function') {
        if (entryTaskDropdown) entryTaskDropdown.destroy();
        entryTaskDropdown = convertSelectToSearchable('entryTask', { placeholder: 'Select Task', searchPlaceholder: 'Search tasks...' });
    }

    openModal('timeEntryModal');
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

function closeTimeEntryModal() {
    closeModal('timeEntryModal');
    currentEditEntryId = null;
}

// ==================== CRUD Operations ====================

async function handleTimeEntrySubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('timeEntrySubmitBtn');
    const spinner = document.getElementById('timeEntrySubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        project_id: document.getElementById('entryProject').value,
        sub_project_id: document.getElementById('entrySubProject').value || null,
        task_id: document.getElementById('entryTask').value || null,
        log_date: document.getElementById('entryDate').value,
        hours: parseInt(document.getElementById('entryHours').value) || 0,
        minutes: parseInt(document.getElementById('entryMinutes').value) || 0,
        comment: document.getElementById('entryDescription').value.trim()
    };

    try {
        if (currentEditEntryId) {
            formData.id = currentEditEntryId;
            await api.request('/pms/time-entries', {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Time entry updated successfully');
        } else {
            await api.request('/pms/time-entries', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Time entry logged successfully');
        }

        closeTimeEntryModal();
        loadTimeEntries();
    } catch (error) {
        console.error('Failed to save time entry:', error);
        Toast.error(error.message || 'Failed to save time entry');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function editTimeEntry(entryId) {
    const entry = timeEntries.find(e => e.id === entryId);
    if (!entry) {
        Toast.error('Time entry not found');
        return;
    }

    currentEditEntryId = entryId;

    document.getElementById('timeEntryModalTitle').textContent = 'Edit Time Entry';
    const submitBtn = document.getElementById('timeEntrySubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="timeEntrySubmitSpinner" style="display:none;"></span> Update Entry';
    document.getElementById('timeEntryId').value = entryId;
    document.getElementById('entryProject').value = entry.project_id || '';
    if (entryProjectDropdown) entryProjectDropdown.setValue(entry.project_id || '');
    document.getElementById('entryDate').value = (entry.log_date || '').substring(0, 10);
    document.getElementById('entryHours').value = parseInt(entry.hours) || 0;
    document.getElementById('entryMinutes').value = parseInt(entry.minutes) || 0;
    document.getElementById('entryDescription').value = entry.comment || '';

    // Load tasks for the selected project, then set task value
    if (entry.project_id) {
        await onProjectChange();
        document.getElementById('entryTask').value = entry.task_id || '';
        if (entryTaskDropdown) entryTaskDropdown.setValue(entry.task_id || '');
    }

    openModal('timeEntryModal');
}

async function deleteTimeEntry(entryId) {
    const confirmed = await showConfirm('Are you sure you want to delete this time entry?', 'Delete Time Entry', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/pms/time-entries/${entryId}`, { method: 'DELETE' });
        Toast.success('Time entry deleted');
        loadTimeEntries();
    } catch (error) {
        console.error('Failed to delete time entry:', error);
        Toast.error('Failed to delete time entry');
    }
}

// ==================== Utilities ====================

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
