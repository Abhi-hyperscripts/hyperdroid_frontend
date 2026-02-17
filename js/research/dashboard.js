// Research Dashboard JavaScript
// Manages project listing, creation, editing, and deletion
// Supports server-side pagination for thousands of projects

// ============================================
// State
// ============================================

let currentProjects = [];
let searchTerm = '';
let currentPage = 1;
let totalPages = 1;
let totalCount = 0;
const PAGE_SIZE = 25;
let searchDebounceTimer = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Bind search input with debounce
    const searchInput = document.getElementById('projectSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchTerm = e.target.value.trim().toLowerCase();
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                currentPage = 1;
                loadProjects();
            }, 300);
        });
    }

    // Bind create project form submission
    const createForm = document.getElementById('createProjectForm');
    if (createForm) {
        createForm.addEventListener('submit', handleCreateProject);
    }

    // Load projects
    await loadProjects();
});

// ============================================
// Data Loading
// ============================================

/**
 * Load projects from the Research backend with pagination
 */
async function loadProjects() {
    try {
        const projectsGrid = document.getElementById('projectsGrid');
        if (projectsGrid) {
            projectsGrid.innerHTML = '<div class="research-loading"><div class="spinner"></div><p>Loading projects...</p></div>';
        }

        // Build query params for server-side pagination + search
        const params = new URLSearchParams();
        params.set('page', currentPage);
        params.set('pageSize', PAGE_SIZE);
        if (searchTerm) params.set('search', searchTerm);

        const response = await api.request(`/research/projects?${params}`);

        // Handle both paginated response {data, total, page, pageSize} and flat array
        if (response && response.data && Array.isArray(response.data)) {
            currentProjects = response.data;
            totalCount = response.total || response.data.length;
            totalPages = Math.ceil(totalCount / PAGE_SIZE);
        } else {
            // Fallback: API returns flat array — do client-side pagination
            const allProjects = Array.isArray(response) ? response : [];
            totalCount = allProjects.length;
            totalPages = Math.ceil(totalCount / PAGE_SIZE);

            // Client-side search
            let filtered = allProjects;
            if (searchTerm) {
                filtered = allProjects.filter(p =>
                    (p.name || '').toLowerCase().includes(searchTerm) ||
                    (p.description || '').toLowerCase().includes(searchTerm)
                );
                totalCount = filtered.length;
                totalPages = Math.ceil(totalCount / PAGE_SIZE);
            }

            const start = (currentPage - 1) * PAGE_SIZE;
            currentProjects = filtered.slice(start, start + PAGE_SIZE);
        }

        renderStats();
        renderProjects(currentProjects);
        renderPagination();
    } catch (error) {
        console.error('Error loading projects:', error);
        showToast('Failed to load projects', 'error');

        const projectsGrid = document.getElementById('projectsGrid');
        if (projectsGrid) {
            projectsGrid.innerHTML = `
                <div class="research-empty-state">
                    <div class="research-empty-state-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                    </div>
                    <h3>Unable to load projects</h3>
                    <p>Please check your connection and try again.</p>
                    <button class="research-btn btn-primary" onclick="loadProjects()">Retry</button>
                </div>
            `;
        }
    }
}

// ============================================
// Stats Rendering
// ============================================

/**
 * Update the stats grid with aggregate data
 * Uses totalCount for projects (accounts for all pages), sums files/rows from current page as approximation
 * For accurate global stats, a dedicated /stats endpoint would be ideal
 */
function renderStats() {
    const totalProjectsEl = document.getElementById('totalProjects');
    const totalFilesEl = document.getElementById('totalFiles');
    const totalRowsEl = document.getElementById('totalRows');

    // Use totalCount from pagination for project count
    if (totalProjectsEl) totalProjectsEl.textContent = formatNumber(totalCount);

    // For files/rows, sum what we have on this page (best effort without a dedicated stats endpoint)
    const totalFiles = currentProjects.reduce((sum, p) => sum + (p.file_count || 0), 0);
    const totalRows = currentProjects.reduce((sum, p) => sum + (p.total_rows || 0), 0);

    if (totalFilesEl) totalFilesEl.textContent = formatNumber(totalFiles);
    if (totalRowsEl) totalRowsEl.textContent = formatNumber(totalRows);
}

// ============================================
// Project Rendering
// ============================================

/**
 * Render projects as a table (desktop) and cards (mobile)
 * @param {Array} projects - Array of project objects to render
 */
function renderProjects(projects) {
    const grid = document.getElementById('projectsGrid');
    if (!grid) return;

    if (!projects || projects.length === 0) {
        const message = searchTerm
            ? 'No projects match your search.'
            : 'No projects yet. Create your first research project to get started.';

        grid.innerHTML = `
            <div class="research-empty-state">
                <div class="research-empty-state-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                    </svg>
                </div>
                <h3>${searchTerm ? 'No results found' : 'No projects yet'}</h3>
                <p>${escapeHtml(message)}</p>
                ${!searchTerm ? '<button class="research-btn btn-primary" onclick="showModal(\'createProjectModal\')">Create Project</button>' : ''}
            </div>
        `;
        return;
    }

    // Table view (desktop)
    const tableHtml = `
        <div class="projects-table-container">
            <table class="projects-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th>Files</th>
                        <th>Rows</th>
                        <th>Created</th>
                        <th style="text-align:right;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${projects.map(project => `
                        <tr class="projects-table-row" onclick="navigateToProject('${escapeHtml(project.id)}')">
                            <td>
                                <span class="projects-table-name">${escapeHtml(project.name || 'Untitled Project')}</span>
                            </td>
                            <td>
                                <span class="projects-table-desc">${escapeHtml(truncateText(project.description || '-', 80))}</span>
                            </td>
                            <td>
                                <span class="status-badge ${escapeHtml((project.status || 'active').toLowerCase())}">${capitalizeFirst(project.status || 'active')}</span>
                            </td>
                            <td class="projects-table-num">${formatNumber(project.file_count || 0)}</td>
                            <td class="projects-table-num">${formatNumber(project.total_rows || 0)}</td>
                            <td class="projects-table-date">${formatDate(project.created_at)}</td>
                            <td onclick="event.stopPropagation()">
                                <div class="projects-table-actions">
                                    <button class="action-btn" onclick="navigateToProject('${escapeHtml(project.id)}')" title="Open">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                    </button>
                                    <button class="action-btn" onclick="showEditProjectModal('${escapeHtml(project.id)}')" title="Edit">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                    <button class="action-btn danger" onclick="deleteProject('${escapeHtml(project.id)}')" title="Delete">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    // Card view (mobile only)
    const cardsHtml = `
        <div class="projects-cards-mobile">
            ${projects.map(project => `
                <div class="project-card" onclick="navigateToProject('${escapeHtml(project.id)}')">
                    <div class="project-card-header">
                        <h3 class="project-card-name" title="${escapeHtml(project.name || '')}">
                            ${escapeHtml(project.name || 'Untitled Project')}
                        </h3>
                        <div class="project-card-actions" onclick="event.stopPropagation()">
                            <button class="action-btn" onclick="showEditProjectModal('${escapeHtml(project.id)}')" title="Edit">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button class="action-btn danger" onclick="deleteProject('${escapeHtml(project.id)}')" title="Delete">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                    <p class="project-card-description">${escapeHtml(truncateText(project.description || 'No description', 120))}</p>
                    <div class="project-card-meta">
                        <div class="project-card-meta-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span class="meta-value">${formatNumber(project.file_count || 0)}</span> files
                        </div>
                        <div class="project-card-meta-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                <line x1="3" y1="9" x2="21" y2="9"/>
                                <line x1="9" y1="21" x2="9" y2="9"/>
                            </svg>
                            <span class="meta-value">${formatNumber(project.total_rows || 0)}</span> rows
                        </div>
                        <div class="project-card-meta-item">
                            ${formatDate(project.created_at)}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    grid.innerHTML = tableHtml + cardsHtml;
}

/**
 * Render pagination controls below the projects grid
 */
function renderPagination() {
    let paginationEl = document.getElementById('projectsPagination');
    if (!paginationEl) {
        // Create pagination container after projects grid
        const grid = document.getElementById('projectsGrid');
        if (!grid) return;
        paginationEl = document.createElement('div');
        paginationEl.id = 'projectsPagination';
        paginationEl.className = 'research-pagination';
        grid.parentNode.insertBefore(paginationEl, grid.nextSibling);
    }

    if (totalPages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }

    const startItem = (currentPage - 1) * PAGE_SIZE + 1;
    const endItem = Math.min(currentPage * PAGE_SIZE, totalCount);

    let buttonsHtml = '';

    // Previous button
    buttonsHtml += `<button class="research-pagination-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
    </button>`;

    // Page numbers — show max 7 buttons with ellipsis
    const maxButtons = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    if (startPage > 1) {
        buttonsHtml += `<button class="research-pagination-btn" onclick="goToPage(1)">1</button>`;
        if (startPage > 2) buttonsHtml += `<span style="color: var(--text-muted); padding: 0 4px;">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        buttonsHtml += `<button class="research-pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) buttonsHtml += `<span style="color: var(--text-muted); padding: 0 4px;">...</span>`;
        buttonsHtml += `<button class="research-pagination-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }

    // Next button
    buttonsHtml += `<button class="research-pagination-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

    paginationEl.innerHTML = `
        <div class="research-pagination-info">Showing ${startItem}-${endItem} of ${formatNumber(totalCount)} projects</div>
        <div class="research-pagination-controls">${buttonsHtml}</div>
    `;
}

/**
 * Navigate to a specific page
 */
function goToPage(page) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    currentPage = page;
    loadProjects();
    // Scroll to top of projects section
    document.getElementById('projectsGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================
// Project Actions
// ============================================

/**
 * Navigate to the project detail page
 * @param {string} projectId - The project ID
 */
function navigateToProject(projectId) {
    window.location.href = 'project-detail.html?id=' + projectId;
}

/**
 * Handle create/edit project form submission
 * @param {Event} e - Form submit event
 */
async function handleCreateProject(e) {
    e.preventDefault();

    const nameInput = document.getElementById('projectName');
    const descInput = document.getElementById('projectDescription');
    const submitBtn = document.getElementById('projectSubmitBtn');
    const isEditing = !!window._editingProjectId;

    const name = (nameInput?.value || '').trim();
    const description = (descInput?.value || '').trim();

    if (!name) {
        showToast('Project name is required', 'error');
        nameInput?.focus();
        return;
    }

    if (name.length > 255) {
        showToast('Project name must be 255 characters or less', 'error');
        nameInput?.focus();
        return;
    }

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = isEditing ? 'Saving...' : 'Creating...';
        }

        if (isEditing) {
            await api.request(`/research/projects/${window._editingProjectId}`, {
                method: 'PUT',
                body: JSON.stringify({ name, description })
            });
            showToast('Project updated successfully', 'success');
        } else {
            await api.request('/research/projects', {
                method: 'POST',
                body: JSON.stringify({ name, description })
            });
            showToast('Project created successfully', 'success');
        }

        closeModal('createProjectModal');
        resetCreateModal();
        await loadProjects();
    } catch (error) {
        console.error('Error saving project:', error);
        showToast(error.message || 'Failed to save project', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = isEditing ? 'Save Changes' : 'Create Project';
        }
    }
}

/**
 * Reset the create/edit modal to its default state
 */
function resetCreateModal() {
    window._editingProjectId = null;
    const nameInput = document.getElementById('projectName');
    const descInput = document.getElementById('projectDescription');
    const modalTitle = document.getElementById('projectModalTitle');
    const modalSubtitle = document.querySelector('#createProjectModal .gm-subtitle');
    const submitBtn = document.getElementById('projectSubmitBtn');

    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (modalTitle) modalTitle.textContent = 'Create New Project';
    if (modalSubtitle) modalSubtitle.textContent = 'Add a new research project';
    if (submitBtn) submitBtn.textContent = 'Create Project';
}

/**
 * Show the edit project modal populated with project data
 * Uses the same create modal with modified title/button
 * @param {string} projectId - The project ID to edit
 */
function showEditProjectModal(projectId) {
    const project = currentProjects.find(p => p.id === projectId);
    if (!project) {
        showToast('Project not found', 'error');
        return;
    }

    // Store editing state
    window._editingProjectId = projectId;

    const nameInput = document.getElementById('projectName');
    const descInput = document.getElementById('projectDescription');
    const modalTitle = document.getElementById('projectModalTitle');
    const modalSubtitle = document.querySelector('#createProjectModal .gm-subtitle');
    const submitBtn = document.getElementById('projectSubmitBtn');

    if (nameInput) nameInput.value = project.name || '';
    if (descInput) descInput.value = project.description || '';
    if (modalTitle) modalTitle.textContent = 'Edit Project';
    if (modalSubtitle) modalSubtitle.textContent = 'Update project details';
    if (submitBtn) submitBtn.textContent = 'Save Changes';

    showModal('createProjectModal');
}

/**
 * Delete a project after confirmation
 * @param {string} projectId - The project ID to delete
 */
async function deleteProject(projectId) {
    const project = currentProjects.find(p => p.id === projectId);
    if (!project) {
        showToast('Project not found', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Delete Project',
        message: `Are you sure you want to delete "${escapeHtml(project.name)}"? This will permanently remove the project and all its files. This action cannot be undone.`,
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
        await api.request(`/research/projects/${projectId}`, {
            method: 'DELETE'
        });

        showToast('Project deleted successfully', 'success');
        await loadProjects();
    } catch (error) {
        console.error('Error deleting project:', error);
        showToast(error.message || 'Failed to delete project', 'error');
    }
}

// ============================================
// Refresh
// ============================================

/**
 * Refresh the dashboard data
 */
function refreshDashboard() {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('loading');
    loadProjects().finally(() => {
        if (btn) btn.classList.remove('loading');
    });
}

// ============================================
// Modal Helpers
// ============================================

/**
 * Show a modal by ID
 * @param {string} modalId - The modal element ID
 */
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Focus first input in the modal
        const firstInput = modal.querySelector('input:not([type="hidden"]), textarea');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
    }
}

/**
 * Close a modal by ID and reset form state
 * @param {string} modalId - The modal element ID
 */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
    if (modalId === 'createProjectModal') {
        resetCreateModal();
    }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Escape HTML to prevent XSS
 * @param {string} str - The string to escape
 * @returns {string} Escaped HTML string
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Format a date string into a readable format (e.g. "Feb 17, 2026")
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date string
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a number with thousands separators (e.g. 1,234,567)
 * @param {number} n - The number to format
 * @returns {string} Formatted number string
 */
function formatNumber(n) {
    if (n === null || n === undefined) return '0';
    return Number(n).toLocaleString('en-US');
}

/**
 * Format a file size in bytes to a human-readable string (e.g. "701.9 MB")
 * @param {number} bytes - The file size in bytes
 * @returns {string} Formatted file size string
 */
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Truncate text to a given length with ellipsis
 * @param {string} text - The text to truncate
 * @param {number} maxLength - Maximum characters before truncation
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trimEnd() + '...';
}

/**
 * Capitalize the first letter of a string
 * @param {string} str - The string to capitalize
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
