// Secondary Research Dashboard JavaScript
// Manages secondary research projects: create, generate, view dashboards

// ============================================
// State
// ============================================
let currentProjects = [];
let currentPage = 1;
let totalPages = 1;
let totalCount = 0;
const PAGE_SIZE = 25;
let activeGenerationProjectId = null;
let signalRConnection = null;
let pollingInterval = null;
let progressStartTime = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    const createForm = document.getElementById('createProjectForm');
    if (createForm) {
        createForm.addEventListener('submit', handleCreateProject);
    }

    await loadProjects();
});

// ============================================
// Modal helpers
// ============================================

function showModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ============================================
// Data Loading
// ============================================

async function loadProjects() {
    try {
        const grid = document.getElementById('projectsGrid');
        if (grid) grid.innerHTML = '<div class="research-loading"><div class="spinner"></div><p>Loading projects...</p></div>';

        const params = new URLSearchParams();
        params.set('page', currentPage);
        params.set('pageSize', PAGE_SIZE);
        params.set('project_type', 'secondary');

        const response = await api.request(`/research/projects?${params}`);

        if (response && response.data && Array.isArray(response.data)) {
            currentProjects = response.data;
            totalCount = response.total || response.data.length;
            totalPages = Math.ceil(totalCount / PAGE_SIZE);
        } else {
            currentProjects = Array.isArray(response) ? response.filter(p => p.project_type === 'secondary') : [];
            totalCount = currentProjects.length;
        }

        renderProjects();
    } catch (err) {
        console.error('Failed to load projects:', err);
        const grid = document.getElementById('projectsGrid');
        if (grid) grid.innerHTML = `<div class="research-empty-state"><p>Failed to load projects</p><button class="research-btn btn-primary" onclick="loadProjects()">Retry</button></div>`;
    }
}

function renderProjects() {
    const grid = document.getElementById('projectsGrid');
    if (!grid) return;

    if (currentProjects.length === 0) {
        grid.innerHTML = `
            <div class="research-empty-state" style="padding: 60px 20px; text-align: center;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" style="margin-bottom: 16px; opacity: 0.5;">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4"/>
                    <path d="M12 8h.01"/>
                </svg>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">No secondary research projects yet</p>
                <button class="research-btn btn-primary" onclick="showModal('createProjectModal')">Create Your First Research</button>
            </div>`;
        return;
    }

    // Table view — uses existing projects-table CSS classes
    let html = `
        <div class="projects-table-container">
            <table class="projects-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th>Sources</th>
                        <th>Visitors</th>
                        <th>Last Updated</th>
                        <th style="text-align:right">Actions</th>
                    </tr>
                </thead>
                <tbody>`;

    for (const project of currentProjects) {
        html += renderProjectRow(project);
    }

    html += '</tbody></table></div>';
    grid.innerHTML = html;

    // Render pagination
    renderPagination();

    // Load dashboard statuses asynchronously
    currentProjects.forEach(p => loadProjectStatus(p.id));
}

function renderPagination() {
    const container = document.getElementById('paginationContainer');
    if (!container) return;

    if (totalPages <= 1) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    let html = '';

    // Previous button
    html += `<button class="research-btn btn-sm" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
    </button>`;

    // Page numbers
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    for (let i = start; i <= end; i++) {
        html += `<button class="research-btn btn-sm ${i === currentPage ? 'btn-primary' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    // Next button
    html += `<button class="research-btn btn-sm" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

    // Total count
    html += `<span style="color: var(--text-muted); font-size: 12px; margin-left: 8px;">${totalCount} project${totalCount !== 1 ? 's' : ''}</span>`;

    container.innerHTML = html;
}

function goToPage(page) {
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    loadProjects();
}

function renderProjectRow(project) {
    const updatedAt = new Date(project.updated_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    });

    return `
        <tr class="projects-table-row" id="row-${project.id}" data-project-id="${project.id}">
            <td><span class="projects-table-name">${escapeHtml(project.name)}</span></td>
            <td><span class="projects-table-desc">${escapeHtml(project.description || '-')}</span></td>
            <td id="status-${project.id}">
                <span class="badge" style="background: var(--bg-tertiary); color: var(--text-secondary); padding: 4px 10px; border-radius: 12px; font-size: 11px;">Loading...</span>
            </td>
            <td id="sources-${project.id}" class="projects-table-num">-</td>
            <td id="visitors-${project.id}" class="projects-table-num">-</td>
            <td class="projects-table-date">${updatedAt}</td>
            <td style="text-align:right" id="actions-${project.id}">
                <div class="projects-table-actions">
                    <button class="action-btn" onclick="openGenerateModal('${project.id}')" title="Generate">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteProject('${project.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </td>
        </tr>`;
}

async function loadProjectStatus(projectId) {
    try {
        const status = await api.request(`/research/secondary-research/projects/${projectId}/status`, { _skipSpinner: true });

        const statusEl = document.getElementById(`status-${projectId}`);
        const sourcesEl = document.getElementById(`sources-${projectId}`);
        const actionsEl = document.getElementById(`actions-${projectId}`);

        if (!statusEl) return;

        if (status.status === 'none') {
            statusEl.innerHTML = '<span class="badge" style="background: var(--bg-tertiary); color: var(--text-secondary); padding: 4px 10px; border-radius: 12px; font-size: 11px;">Not Generated</span>';
            sourcesEl.textContent = '-';
        } else if (status.status === 'generating') {
            statusEl.innerHTML = '<span class="badge" style="background: rgba(59,130,246,0.15); color: var(--brand-primary); padding: 4px 10px; border-radius: 12px; font-size: 11px;">Generating...</span>';
            sourcesEl.textContent = '-';
            // Start watching progress
            startProgressTracking(projectId);
        } else if (status.status === 'ready') {
            statusEl.innerHTML = '<span class="badge" style="background: rgba(34,197,94,0.15); color: var(--color-success); padding: 4px 10px; border-radius: 12px; font-size: 11px;">Ready</span>';
            sourcesEl.textContent = status.source_count || '-';
            // Fetch unique visitor count
            const visitorsEl = document.getElementById(`visitors-${projectId}`);
            if (visitorsEl && status.share_token) {
                try {
                    const views = await api.request(`/research/insights/${status.share_token}/views`, { _skipSpinner: true });
                    visitorsEl.textContent = views.unique_visitors || '0';
                } catch (e) {
                    visitorsEl.textContent = '0';
                }
            }
            // Update actions to include View Dashboard button
            if (actionsEl) {
                actionsEl.innerHTML = `
                    <div class="projects-table-actions">
                        <button class="action-btn" onclick="viewDashboard('${status.share_token}')" title="View Dashboard" style="color: var(--color-success);">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        <button class="action-btn" onclick="openGenerateModal('${projectId}', '${escapeHtml(status.instruction || '')}')" title="Regenerate">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        </button>
                        <button class="action-btn danger" onclick="deleteProject('${projectId}')" title="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>`;
            }
        } else if (status.status === 'failed') {
            statusEl.innerHTML = `<span class="badge" style="background: rgba(239,68,68,0.15); color: var(--color-error); padding: 4px 10px; border-radius: 12px; font-size: 11px;" title="${escapeHtml(status.error_message || '')}">Failed</span>`;
            sourcesEl.textContent = '-';
        }
    } catch (err) {
        console.error('Failed to load status for', projectId, err);
    }
}

// ============================================
// CRUD Operations
// ============================================

async function handleCreateProject(e) {
    e.preventDefault();

    const name = document.getElementById('projectName').value.trim();
    const description = document.getElementById('projectDescription').value.trim();

    if (!name) return;

    try {
        const project = await api.request('/research/projects', {
            method: 'POST',
            body: JSON.stringify({
                name,
                description: description || null,
                project_type: 'secondary'
            })
        });

        closeModal('createProjectModal');
        document.getElementById('projectName').value = '';
        document.getElementById('projectDescription').value = '';

        await loadProjects();
        showToast('Project created successfully');
    } catch (err) {
        console.error('Failed to create project:', err);
        showToast('Failed to create project', 'error');
    }
}

async function deleteProject(projectId) {
    if (!confirm('Delete this project and all its research data?')) return;

    try {
        await api.request(`/research/projects/${projectId}`, { method: 'DELETE' });
        await loadProjects();
        showToast('Project deleted');
    } catch (err) {
        console.error('Failed to delete project:', err);
        showToast('Failed to delete project', 'error');
    }
}

// ============================================
// Generate Research
// ============================================

let generateProjectId = null;

function openGenerateModal(projectId, existingInstruction) {
    generateProjectId = projectId;
    const instructionEl = document.getElementById('researchInstruction');
    const titleEl = document.getElementById('generateModalTitle');

    if (existingInstruction) {
        instructionEl.value = existingInstruction;
        titleEl.textContent = 'Regenerate Research';
    } else {
        instructionEl.value = '';
        titleEl.textContent = 'Generate Research';
    }

    showModal('generateModal');
    instructionEl.focus();
}

async function handleGenerate() {
    const instruction = document.getElementById('researchInstruction').value.trim();
    if (!instruction) {
        showToast('Please enter a research instruction', 'error');
        return;
    }

    if (!generateProjectId) return;

    try {
        const result = await api.request(`/research/secondary-research/projects/${generateProjectId}/generate`, {
            method: 'POST',
            body: JSON.stringify({ instruction })
        });

        closeModal('generateModal');
        showToast('Research generation started');

        // Show progress
        activeGenerationProjectId = generateProjectId;
        showProgressPanel(generateProjectId);
        startProgressTracking(generateProjectId);

        // Refresh status
        await loadProjectStatus(generateProjectId);
    } catch (err) {
        console.error('Failed to start generation:', err);
        showToast(err.message || 'Failed to start generation', 'error');
    }
}

// ============================================
// Progress Tracking
// ============================================

function showProgressPanel(projectId) {
    const panel = document.getElementById('progressPanel');
    if (!panel) return;
    panel.style.display = 'block';
    progressStartTime = Date.now();

    const project = currentProjects.find(p => p.id === projectId);
    const nameEl = document.getElementById('progressProjectName');
    if (nameEl) nameEl.textContent = project?.name || 'Research';

    updateProgressMessage('Initializing...');
}

function hideProgressPanel() {
    const panel = document.getElementById('progressPanel');
    if (panel) panel.style.display = 'none';
}

function toggleProgressMinimize() {
    const list = document.getElementById('progressList');
    if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function updateProgressMessage(message) {
    const msgEl = document.getElementById('progressMessage');
    if (msgEl) msgEl.textContent = message;

    // Update elapsed time
    if (progressStartTime) {
        const elapsed = Math.floor((Date.now() - progressStartTime) / 1000);
        const statsEl = document.getElementById('progressStats');
        if (statsEl) statsEl.textContent = `${elapsed}s elapsed`;
    }
}

function startProgressTracking(projectId) {
    // Try SignalR first
    connectSignalR(projectId);

    // Elapsed time counter
    if (!progressStartTime) progressStartTime = Date.now();
    const elapsedTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - progressStartTime) / 1000);
        const statsEl = document.getElementById('progressStats');
        if (statsEl) statsEl.textContent = `${elapsed}s elapsed`;
    }, 1000);

    // Fallback polling every 5 seconds
    stopPolling();
    pollingInterval = setInterval(async () => {
        try {
            const status = await api.request(`/research/secondary-research/projects/${projectId}/status`, { _skipSpinner: true });

            if (status.status === 'generating') {
                // Show elapsed-based phase messages when SignalR is unavailable
                const elapsed = Math.floor((Date.now() - progressStartTime) / 1000);
                if (elapsed < 20) updateProgressMessage('Phase 1: Planning research queries...');
                else if (elapsed < 120) updateProgressMessage('Phase 1: Searching internet sources...');
                else if (elapsed < 300) updateProgressMessage('Phase 1: Extracting statistics from sources...');
                else if (elapsed < 360) updateProgressMessage('Clustering and validating statistics...');
                else if (elapsed < 540) updateProgressMessage('Phase 2: Synthesizing dashboard from verified data...');
                else updateProgressMessage('Phase 2: Finalizing dashboard JSON...');
            } else if (status.status === 'ready') {
                updateProgressMessage('Dashboard ready!');
                const bar = document.getElementById('progressBar');
                if (bar) {
                    bar.classList.remove('indeterminate');
                    bar.style.width = '100%';
                    bar.style.background = 'var(--color-success)';
                }
                clearInterval(elapsedTimer);
                setTimeout(() => {
                    hideProgressPanel();
                    loadProjectStatus(projectId);
                }, 2000);
                stopPolling();
                disconnectSignalR();
            } else if (status.status === 'failed') {
                updateProgressMessage('Failed: ' + (status.error_message || 'Unknown error'));
                const bar = document.getElementById('progressBar');
                if (bar) {
                    bar.classList.remove('indeterminate');
                    bar.style.width = '100%';
                    bar.style.background = 'var(--color-error)';
                }
                clearInterval(elapsedTimer);
                setTimeout(() => {
                    hideProgressPanel();
                    loadProjectStatus(projectId);
                }, 3000);
                stopPolling();
                disconnectSignalR();
            }
        } catch (err) {
            console.error('Polling error:', err);
        }
    }, 5000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// ============================================
// SignalR
// ============================================

async function connectSignalR(projectId) {
    if (signalRConnection) return;

    try {
        const token = api.token;
        const hubUrl = CONFIG.endpoints.research + '/hubs/research' + `?access_token=${encodeURIComponent(token)}`;

        signalRConnection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl)
            .withAutomaticReconnect()
            .build();

        signalRConnection.on('SecondaryResearchProgressUpdate', (data) => {
            if (data.project_id !== projectId && data.project_id !== activeGenerationProjectId) return;

            updateProgressMessage(data.message || 'Processing...');

            if (data.status === 'ready') {
                const bar = document.getElementById('progressBar');
                if (bar) {
                    bar.classList.remove('indeterminate');
                    bar.style.width = '100%';
                    bar.style.background = 'var(--color-success)';
                }
                setTimeout(() => {
                    hideProgressPanel();
                    loadProjectStatus(projectId);
                }, 2000);
                stopPolling();
            } else if (data.status === 'failed') {
                const bar = document.getElementById('progressBar');
                if (bar) {
                    bar.classList.remove('indeterminate');
                    bar.style.width = '100%';
                    bar.style.background = 'var(--color-error)';
                }
                setTimeout(() => {
                    hideProgressPanel();
                    loadProjectStatus(projectId);
                }, 3000);
                stopPolling();
            }
        });

        await signalRConnection.start();
        await signalRConnection.invoke('JoinSecondaryResearchProgress', projectId);
        console.log('[SignalR] Connected for secondary research progress');
    } catch (err) {
        console.error('[SignalR] Connection failed, using polling fallback:', err);
        signalRConnection = null;
    }
}

function disconnectSignalR() {
    if (signalRConnection) {
        try { signalRConnection.stop(); } catch {}
        signalRConnection = null;
    }
}

// ============================================
// View Dashboard
// ============================================

function viewDashboard(shareToken) {
    window.open(`insights.html?token=${shareToken}`, '_blank');
}

// ============================================
// Utilities
// ============================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        padding: 10px 20px; border-radius: 8px; font-size: 13px; z-index: 10000;
        color: #fff; backdrop-filter: blur(10px);
        background: ${type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(34,197,94,0.9)'};
        transition: opacity 0.3s; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}
