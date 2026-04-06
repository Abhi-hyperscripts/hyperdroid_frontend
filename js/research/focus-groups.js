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
            <div style="background:var(--bg-secondary); border:1px solid var(--border-primary); border-radius:12px; overflow:hidden;">
                <table class="projects-table" style="width:100%; border-collapse:collapse; font-size:14px;">
                    <thead>
                        <tr>
                            <th style="text-align:left; padding:12px 16px; border-bottom:2px solid var(--border-primary); color:var(--text-secondary); font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">Name</th>
                            <th style="text-align:left; padding:12px 16px; border-bottom:2px solid var(--border-primary); color:var(--text-secondary); font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">Description</th>
                            <th style="text-align:left; padding:12px 16px; border-bottom:2px solid var(--border-primary); color:var(--text-secondary); font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">Created</th>
                            <th style="text-align:right; padding:12px 16px; border-bottom:2px solid var(--border-primary); color:var(--text-secondary); font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${projects.map(p => `
                            <tr style="cursor:pointer;" onclick="openProject('${p.id}')">
                                <td style="padding:12px 16px; border-bottom:1px solid var(--border-primary); font-weight:500; color:var(--text-primary);">${escapeHtml(p.name)}</td>
                                <td style="padding:12px 16px; border-bottom:1px solid var(--border-primary); color:var(--text-secondary);">${escapeHtml(p.description || '-')}</td>
                                <td style="padding:12px 16px; border-bottom:1px solid var(--border-primary); color:var(--text-secondary); white-space:nowrap;">${new Date(p.created_at).toLocaleDateString()}</td>
                                <td style="padding:12px 16px; border-bottom:1px solid var(--border-primary); text-align:right;">
                                    <button class="research-btn" style="font-size:12px; padding:4px 10px;" onclick="event.stopPropagation(); deleteProject('${p.id}', '${escapeHtml(p.name)}')">Delete</button>
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
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
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
