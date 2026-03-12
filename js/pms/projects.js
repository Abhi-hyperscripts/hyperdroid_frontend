/**
 * PMS Projects Management
 * Handles CRUD operations, filtering, and project listing.
 */

// ==================== State ====================
let allProjects = [];
let allClients = [];
let currentEditProjectId = null;

// Searchable dropdown instances
let filterStatusDropdown = null;
let filterClientDropdown = null;
let projectClientDropdown = null;
let projectStatusDropdown = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');
    loadProjects();
    loadClients();
    loadProjectStats();
    initSearchableDropdowns();
});

// ==================== Data Loading ====================

/**
 * Load projects from the API with optional filters
 */
async function loadProjects() {
    try {
        const params = buildFilterParams();
        const queryString = params.toString();
        const endpoint = `/pms/projects${queryString ? '?' + queryString : ''}`;

        const response = await api.request(endpoint);
        allProjects = response.data || response || [];
        renderProjectsTable(allProjects);
    } catch (error) {
        console.error('Failed to load projects:', error);
        renderProjectsTable([]);
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to load projects');
        }
    }
}

/**
 * Load clients for dropdown filters and modal
 */
async function loadClients() {
    try {
        const response = await api.request('/pms/clients');
        allClients = response.data || response || [];
        populateClientDropdowns();
    } catch (error) {
        console.error('Failed to load clients:', error);
    }
}

/**
 * Populate client dropdowns (filter bar + modal form)
 */
function populateClientDropdowns() {
    const filterSelect = document.getElementById('filterClient');
    const modalSelect = document.getElementById('projectClient');

    // Filter dropdown
    if (filterSelect) {
        const currentFilterVal = filterSelect.value;
        filterSelect.innerHTML = '<option value="">All Clients</option>';
        allClients.forEach(client => {
            const opt = document.createElement('option');
            opt.value = client.id;
            opt.textContent = client.client_name || client.company_name || '';
            filterSelect.appendChild(opt);
        });
        filterSelect.value = currentFilterVal;
    }

    // Modal dropdown
    if (modalSelect) {
        const currentModalVal = modalSelect.value;
        modalSelect.innerHTML = '<option value="">No Client</option>';
        allClients.forEach(client => {
            const opt = document.createElement('option');
            opt.value = client.id;
            opt.textContent = client.client_name || client.company_name || '';
            modalSelect.appendChild(opt);
        });
        modalSelect.value = currentModalVal;
    }

    // Reinitialize searchable dropdowns if clients loaded after init
    if (filterClientDropdown) {
        filterClientDropdown.destroy();
        filterClientDropdown = convertSelectToSearchable('filterClient', {
            compact: true,
            placeholder: 'All Clients',
            searchPlaceholder: 'Search clients...',
            onChange: () => applyFilters()
        });
    }
    if (projectClientDropdown) {
        projectClientDropdown.destroy();
        projectClientDropdown = convertSelectToSearchable('projectClient', {
            placeholder: 'Select client...',
            searchPlaceholder: 'Search clients...'
        });
    }
}

/**
 * Load project statistics (computed client-side from loaded projects)
 */
async function loadProjectStats() {
    try {
        const response = await api.request('/pms/projects');
        const projects = response.data || response || [];

        const total = projects.length;
        const active = projects.filter(p => p.status === 'in_progress').length;
        const completed = projects.filter(p => p.status === 'completed').length;
        const totalHours = projects.reduce((sum, p) => sum + (p.total_hours_logged || 0), 0);

        document.getElementById('statTotalProjects').textContent = total;
        document.getElementById('statActiveProjects').textContent = active;
        document.getElementById('statCompletedProjects').textContent = completed;
        document.getElementById('statTotalHours').textContent = totalHours.toFixed(1);
    } catch (error) {
        console.error('Failed to load project stats:', error);
    }
}

// ==================== Filter Handling ====================

/**
 * Build query params from filter inputs
 */
function buildFilterParams() {
    const params = new URLSearchParams();
    const status = filterStatusDropdown ? filterStatusDropdown.getValue() : document.getElementById('filterStatus').value;
    const clientId = filterClientDropdown ? filterClientDropdown.getValue() : document.getElementById('filterClient').value;
    const search = document.getElementById('filterSearch').value.trim();

    if (status) params.set('status', status);
    if (clientId) params.set('clientId', clientId);
    if (search) params.set('search', search);

    return params;
}

/**
 * Apply filters and reload projects
 */
function applyFilters() {
    loadProjects();
}

// ==================== Table Rendering ====================

/**
 * Render the projects table
 */
function renderProjectsTable(projects) {
    const tbody = document.getElementById('projectsTableBody');

    if (!projects || projects.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        <p>No projects found</p>
                        <button class="btn btn-sm btn-primary" onclick="openNewProjectModal()">Create your first project</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = projects.map(project => `
        <tr data-project-id="${project.id}" data-clickable onclick="window.location.href='project-detail.html?id=${project.id}'" style="cursor: pointer;">
            <td>
                <div class="crm-cell-primary" style="color: var(--brand-primary);">${escapeHtml(project.project_name || '')}</div>
                ${project.description ? `<div class="crm-cell-secondary">${escapeHtml(truncate(project.description, 50))}</div>` : ''}
            </td>
            <td>
                <span class="crm-cell-secondary">${escapeHtml(project.client_name || '-')}</span>
            </td>
            <td>
                <span class="crm-status-badge status-${getStatusClass(project.status)}">${formatStatus(project.status)}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${project.member_count ?? 0}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${project.task_count ?? 0}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${(project.total_hours_logged ?? 0).toFixed(1)}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${formatDate(project.start_date)}</span>
            </td>
            <td>
                <div class="crm-actions" onclick="event.stopPropagation();">
                    <button class="crm-action-btn" onclick="openEditProjectModal('${project.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn action-delete" onclick="deleteProject('${project.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ==================== Status Formatting ====================

function formatStatus(status) {
    const labels = {
        'not_started': 'Not Started',
        'in_progress': 'In Progress',
        'on_hold': 'On Hold',
        'completed': 'Completed',
        'cancelled': 'Cancelled'
    };
    return labels[status] || status || 'Not Started';
}

/**
 * Map status to CRM badge CSS class
 * planning=info, active=success, on_hold=warning, completed=primary, cancelled=danger
 */
function getStatusClass(status) {
    const classMap = {
        'not_started': 'new',        // uses stat-info / blue styling
        'in_progress': 'qualified',  // uses stat-success / green styling
        'on_hold': 'contacted',      // uses stat-warning / yellow styling
        'completed': 'converted',    // uses stat-primary / purple styling
        'cancelled': 'lost'          // uses stat-danger / red styling
    };
    return classMap[status] || 'new';
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

function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// ==================== Modal Handling ====================

function openNewProjectModal() {
    currentEditProjectId = null;
    document.getElementById('projectModalTitle').textContent = 'New Project';
    const submitBtn = document.getElementById('projectSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="projectSubmitSpinner" style="display:none;"></span> Create Project';
    document.getElementById('projectForm').reset();
    document.getElementById('projectId').value = '';
    if (projectClientDropdown) projectClientDropdown.setValue('');
    if (projectStatusDropdown) projectStatusDropdown.setValue('not_started');
    openModal('projectModal');
}

async function openEditProjectModal(projectId) {
    try {
        // Find project in loaded data or fetch fresh
        let project = allProjects.find(p => p.id === projectId);
        if (!project) {
            project = await api.request(`/pms/projects/${projectId}`);
        }
        currentEditProjectId = projectId;

        document.getElementById('projectModalTitle').textContent = 'Edit Project';
        const submitBtn = document.getElementById('projectSubmitBtn');
        submitBtn.innerHTML = '<span class="btn-spinner" id="projectSubmitSpinner" style="display:none;"></span> Update Project';
        document.getElementById('projectId').value = projectId;
        document.getElementById('projectName').value = project.project_name || '';
        document.getElementById('projectDescription').value = project.description || '';
        document.getElementById('projectClient').value = project.client_id || '';
        document.getElementById('projectStatus').value = project.status || 'not_started';
        document.getElementById('projectStartDate').value = project.start_date ? project.start_date.substring(0, 10) : '';
        document.getElementById('projectEndDate').value = project.end_date ? project.end_date.substring(0, 10) : '';
        document.getElementById('projectBudget').value = project.budget || '';

        if (projectClientDropdown) projectClientDropdown.setValue(project.client_id || '');
        if (projectStatusDropdown) projectStatusDropdown.setValue(project.status || 'not_started');

        openModal('projectModal');
    } catch (error) {
        console.error('Failed to load project:', error);
        if (typeof Toast !== 'undefined') Toast.error('Failed to load project details');
    }
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

function closeProjectModal() {
    closeModal('projectModal');
    currentEditProjectId = null;
}

// ==================== CRUD Operations ====================

async function handleProjectSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('projectSubmitBtn');
    const spinner = document.getElementById('projectSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        project_name: document.getElementById('projectName').value.trim(),
        description: document.getElementById('projectDescription').value.trim(),
        client_id: (projectClientDropdown ? projectClientDropdown.getValue() : document.getElementById('projectClient').value) || null,
        status: projectStatusDropdown ? (projectStatusDropdown.getValue() || 'not_started') : document.getElementById('projectStatus').value,
        start_date: document.getElementById('projectStartDate').value || null,
        end_date: document.getElementById('projectEndDate').value || null,
        budget: parseFloat(document.getElementById('projectBudget').value) || null
    };

    try {
        if (currentEditProjectId) {
            formData.id = currentEditProjectId;
            await api.request('/pms/projects', {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Project updated successfully');
        } else {
            await api.request('/pms/projects', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Project created successfully');
        }

        closeProjectModal();
        loadProjects();
        loadProjectStats();
    } catch (error) {
        console.error('Failed to save project:', error);
        if (typeof Toast !== 'undefined') Toast.error(error.message || 'Failed to save project');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteProject(projectId) {
    const confirmed = await showConfirm('Are you sure you want to delete this project?', 'Delete Project', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/pms/projects/${projectId}`, { method: 'DELETE' });
        Toast.success('Project deleted');
        loadProjects();
        loadProjectStats();
    } catch (error) {
        console.error('Failed to delete project:', error);
        if (typeof Toast !== 'undefined') Toast.error('Failed to delete project');
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

    if (!filterClientDropdown) {
        filterClientDropdown = convertSelectToSearchable('filterClient', {
            compact: true,
            placeholder: 'All Clients',
            searchPlaceholder: 'Search clients...',
            onChange: () => applyFilters()
        });
    }

    // Modal form dropdowns
    if (!projectClientDropdown) {
        projectClientDropdown = convertSelectToSearchable('projectClient', {
            placeholder: 'Select client...',
            searchPlaceholder: 'Search clients...'
        });
    }

    if (!projectStatusDropdown) {
        projectStatusDropdown = convertSelectToSearchable('projectStatus', {
            placeholder: 'Select status...',
            searchPlaceholder: 'Search status...'
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
