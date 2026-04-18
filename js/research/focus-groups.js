// Focus Groups Dashboard - Project List
if (!api.isAuthenticated()) window.location.href = '../login.html';

let projects = [];
let currentPage = 1;
const PAGE_SIZE = 20;
let searchTerm = '';

document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
    document.getElementById('createProjectForm').addEventListener('submit', handleCreateProject);
});

async function loadProjects() {
    const grid = document.getElementById('projectsGrid');
    try {
        const params = new URLSearchParams();
        params.set('page', currentPage);
        params.set('pageSize', PAGE_SIZE);
        params.set('project_type', 'focus-group');
        if (searchTerm) params.set('search', searchTerm);

        const response = await api.request(`/research/projects?${params}`);
        projects = response.data || response.projects || response || [];
        const total = response.total || response.totalCount || projects.length;

        if (projects.length === 0) {
            grid.innerHTML = `
                <div style="text-align:center; padding:60px 20px; color:var(--text-secondary);">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom:16px; opacity:0.3;">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    <h3 style="color:var(--text-primary); margin-bottom:8px;">No focus group projects yet</h3>
                    <p>Create your first project to upload audio recordings for speaker diarization.</p>
                    <button class="research-btn btn-primary" style="margin-top:16px;" onclick="showModal('createProjectModal')">
                        + New Project
                    </button>
                </div>`;
            return;
        }

        grid.innerHTML = `
            <div class="projects-table-container">
                <table class="projects-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Description</th>
                            <th>Created</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${projects.map(p => `
                            <tr class="projects-table-row" onclick="openProject('${p.id}')">
                                <td><span class="projects-table-name">${escapeHtml(p.name)}</span></td>
                                <td><span class="projects-table-desc">${escapeHtml(p.description || '-')}</span></td>
                                <td class="projects-table-date">${new Date(p.created_at).toLocaleDateString()}</td>
                                <td onclick="event.stopPropagation()">
                                    <div class="projects-table-actions">
                                        <button class="action-btn" onclick="openProject('${p.id}')" title="Open">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                        </button>
                                        <button class="action-btn danger" onclick="deleteProject('${p.id}', '${escapeHtml(p.name)}')" title="Delete">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;

    } catch (error) {
        grid.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-error);">Failed to load projects: ${error.message}</div>`;
    }
}

async function handleCreateProject(e) {
    e.preventDefault();
    const name = document.getElementById('projectName').value.trim();
    const description = document.getElementById('projectDescription').value.trim();
    if (!name) return;

    const btn = document.getElementById('createProjectBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        await api.request('/research/projects', {
            method: 'POST',
            body: JSON.stringify({ name, description: description || null, project_type: 'focus-group' })
        });
        closeModal('createProjectModal');
        document.getElementById('createProjectForm').reset();
        Toast.success('Project created');
        await loadProjects();
    } catch (error) {
        Toast.error('Failed to create project: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Project';
    }
}

function openProject(projectId) {
    window.location.href = `focus-group-detail.html?id=${projectId}`;
}

async function deleteProject(id, name) {
    const ok = await Confirm.show({
        title: 'Delete Project',
        message: `Delete "${name}"? All recordings, transcriptions, and associated data will be permanently removed. This cannot be undone.`,
        type: 'danger',
        confirmText: 'Delete'
    });
    if (!ok) return;
    try {
        await api.request(`/research/projects/${id}`, { method: 'DELETE' });
        Toast.success('Project deleted');
        await loadProjects();
    } catch (error) {
        Toast.error('Failed to delete project: ' + error.message);
    }
}

function handleProjectSearch() {
    searchTerm = document.getElementById('projectSearch').value.trim();
    currentPage = 1;
    loadProjects();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
