/**
 * Research Project Detail Page
 *
 * Manages project detail view including files, variables, and query console.
 * Reads project ID from URL: ?id={projectId}
 *
 * API routes use /research/projects/... prefix which auto-routes
 * to the Research backend via api._getBaseUrl().
 */

// ============================================
// STATE
// ============================================
let projectId = null;
let project = null;
let files = [];
let allVariables = []; // { fileId, fileName, variables: [...] }
let activeTab = 'files';
let variablesLoaded = false;
let queryResultsData = null;

// Variables pagination state
let varCurrentPage = 1;
let varPageSize = 50;
let varFilteredVars = [];

// AI Assistant state
let aiAvailable = null;  // null = not checked, true/false = cached
let aiChatVisible = false;
let aiSessionId = null;
let aiSignalRConnection = null;
let aiProcessing = false;
let aiStreamingEl = null;       // current streaming assistant bubble element
let aiStreamingText = '';       // full text received so far
let aiDisplayedText = '';       // text currently displayed (revealed progressively)
let aiStreamBuffer = '';        // pending text waiting to be revealed
let aiStreamRevealTimer = null; // interval timer for smooth text reveal
let aiStreamFinalized = false;  // true when final response received (but reveal still running)
let aiStreamMetadata = null;    // metadata to apply when reveal completes
let aiVisualizationsData = null; // chart data from create_visualization tool calls
let aiResponseRendered = false; // true once a response has been rendered (guards against REST/SignalR race)

// Polling timers (fallback only)
let fileStatusPollers = {}; // fileId -> intervalId

// File progress SignalR connection
let fileProgressConnection = null;
let fileProgressConnected = false;
let activeProgressFiles = {}; // fileId -> { fileName, status, message, ... }

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    // Parse project ID from URL
    const params = new URLSearchParams(window.location.search);
    projectId = params.get('id');

    if (!projectId) {
        showPageError('No project ID specified. Redirecting...');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
        return;
    }

    // Initialize
    loadProject();

    // Keyboard shortcut: Ctrl+Enter to run query
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const sqlEditor = document.getElementById('sqlEditor');
            if (document.activeElement === sqlEditor || activeTab === 'query') {
                e.preventDefault();
                executeQuery();
            }
        }
    });
});

// Cleanup pollers and SignalR on page unload
window.addEventListener('beforeunload', () => {
    Object.values(fileStatusPollers).forEach(id => clearInterval(id));
    if (fileProgressConnection) {
        fileProgressConnection.stop().catch(() => {});
    }
});

// ============================================
// PROJECT LOADING
// ============================================

async function loadProject() {
    try {
        const response = await api.request(`/research/projects/${projectId}`);
        project = response;

        // Update page title
        document.title = `${project.name} - Research | Ragenaizer`;

        // Render project header
        renderProjectHeader();

        // Hide loading, show content
        document.getElementById('pageLoading').style.display = 'none';
        document.getElementById('projectContent').style.display = 'block';

        // Load files (default tab)
        loadFiles();
    } catch (error) {
        console.error('Failed to load project:', error);
        document.getElementById('pageLoading').innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <p class="empty-title">Project not found</p>
                <p>${escapeHtml(error.message || 'The project could not be loaded.')}</p>
                <p style="margin-top: 12px;"><a href="dashboard.html" style="color: var(--brand-primary);">Back to Research Dashboard</a></p>
            </div>
        `;
    }
}

function renderProjectHeader() {
    document.getElementById('breadcrumbProjectName').textContent = project.name;
    document.getElementById('projectName').textContent = project.name;

    const descEl = document.getElementById('projectDescription');
    if (project.description) {
        descEl.textContent = project.description;
        descEl.style.display = 'block';
    } else {
        descEl.style.display = 'none';
    }

    // Status badge
    const statusEl = document.getElementById('projectStatus');
    statusEl.innerHTML = `<span class="status-badge ${project.status}">${project.status}</span>`;

    // Created date
    const createdSpan = document.getElementById('projectCreated').querySelector('span:last-child');
    createdSpan.textContent = formatDate(project.createdAt || project.created_at);

    // File count
    const filesSpan = document.getElementById('projectFiles').querySelector('span:last-child');
    const fileCount = project.fileCount ?? project.file_count ?? 0;
    filesSpan.textContent = `${fileCount} file${fileCount !== 1 ? 's' : ''}`;

    // Total rows
    const rowsSpan = document.getElementById('projectRows').querySelector('span:last-child');
    const totalRows = project.totalRows ?? project.total_rows ?? 0;
    rowsSpan.textContent = `${formatNumber(totalRows)} rows`;
}

// ============================================
// FILES TAB
// ============================================

async function loadFiles() {
    const loadingEl = document.getElementById('filesLoading');
    const contentEl = document.getElementById('filesContent');
    const emptyEl = document.getElementById('filesEmpty');

    loadingEl.style.display = 'block';
    contentEl.innerHTML = '';
    emptyEl.style.display = 'none';

    try {
        const response = await api.request(`/research/projects/${projectId}/files`);
        files = Array.isArray(response) ? response : [];

        loadingEl.style.display = 'none';

        if (files.length === 0) {
            emptyEl.style.display = 'block';
            return;
        }

        renderFilesTable();
        startFilePolling();
        // Check AI availability once files are loaded (enables AI button + SignalR)
        if (files.some(f => f.status === 'ready')) checkAiAvailability();
    } catch (error) {
        loadingEl.style.display = 'none';
        contentEl.innerHTML = `<div class="query-error">Failed to load files: ${escapeHtml(error.message)}</div>`;
        console.error('Failed to load files:', error);
    }
}

function renderFilesTable() {
    const contentEl = document.getElementById('filesContent');

    let html = `
        <div class="files-table-wrapper">
            <table class="files-table">
                <thead>
                    <tr>
                        <th>File Name</th>
                        <th>Size</th>
                        <th>Status</th>
                        <th>Variables</th>
                        <th>Rows</th>
                        <th>Uploaded</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="filesTableBody">
    `;

    for (const file of files) {
        html += renderFileRow(file);
    }

    html += `
                </tbody>
            </table>
        </div>
    `;

    contentEl.innerHTML = html;
}

function renderFileRow(file) {
    const fileId = file.id;
    const fileName = file.fileName || file.file_name || 'Unknown';
    const fileSize = formatFileSize(file.fileSizeBytes || file.file_size_bytes || 0);
    const status = file.status || 'unknown';
    const displayStatus = status === 'loading_data' ? 'loading data' : status;
    const variableCount = file.variableCount ?? file.variable_count ?? 0;
    const rowCount = file.rowCount ?? file.row_count ?? 0;
    const uploadedAt = file.uploadedAt || file.uploaded_at;
    const processingTimeMs = file.processingTimeMs ?? file.processing_time_ms ?? 0;
    const timeInfo = (status === 'ready' && processingTimeMs > 0) ? ` (${(processingTimeMs / 1000).toFixed(1)}s)` : '';

    return `
        <tr id="file-row-${fileId}" data-file-id="${fileId}" data-status="${status}">
            <td>
                <div class="file-name-cell">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    ${escapeHtml(fileName)}
                </div>
            </td>
            <td>${fileSize}</td>
            <td><span class="status-badge ${status}">${displayStatus}${timeInfo}</span></td>
            <td>${status === 'ready' ? formatNumber(variableCount) : '-'}</td>
            <td>${status === 'ready' ? formatNumber(rowCount) : '-'}</td>
            <td>${uploadedAt ? formatDate(uploadedAt) : '-'}</td>
            <td style="display: flex; gap: 4px;">
                ${status === 'ready' ? `<button class="btn-icon" onclick="openFileMetadataModal('${fileId}')" title="Edit file context & weights" style="color: var(--text-secondary);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>` : ''}
                <button class="btn-icon-danger" onclick="deleteFile('${fileId}', '${escapeHtml(fileName)}')" title="${['uploading','parsing','loading_data'].includes(status) ? 'Cannot delete while processing' : 'Delete file'}"${['uploading','parsing','loading_data'].includes(status) ? ' disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </td>
        </tr>
    `;
}

// ============================================
// FILE PROGRESS — SignalR + Fallback Polling
// ============================================

async function connectFileProgressSignalR() {
    if (fileProgressConnection) return;
    try {
        const token = api.token;
        const hubUrl = CONFIG.endpoints.research + '/hubs/research' + `?access_token=${encodeURIComponent(token)}`;

        fileProgressConnection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl)
            .withAutomaticReconnect()
            .build();

        fileProgressConnection.on('FileProgressUpdate', (data) => {
            handleFileProgressUpdate(data);
        });

        fileProgressConnection.onreconnected(async () => {
            console.log('[FileProgress] SignalR reconnected, rejoining groups');
            fileProgressConnected = true;
            await joinFileProgressGroups();
        });

        fileProgressConnection.onclose(() => {
            console.log('[FileProgress] SignalR connection closed');
            fileProgressConnected = false;
        });

        await fileProgressConnection.start();
        fileProgressConnected = true;
        console.log('[FileProgress] SignalR connected');
    } catch (error) {
        console.warn('[FileProgress] SignalR connection failed, falling back to polling:', error);
        fileProgressConnection = null;
        fileProgressConnected = false;
    }
}

async function joinFileProgressGroups() {
    if (!fileProgressConnection || !fileProgressConnected) return;
    for (const file of files) {
        if (['uploading', 'parsing', 'loading_data'].includes(file.status)) {
            try {
                await fileProgressConnection.invoke('JoinFileProgress', file.id);
            } catch (e) {
                console.warn(`Failed to join progress group for file ${file.id}:`, e);
            }
        }
    }
}

async function leaveFileProgressGroup(fileId) {
    if (!fileProgressConnection || !fileProgressConnected) return;
    try {
        await fileProgressConnection.invoke('LeaveFileProgress', fileId);
    } catch (e) {
        // ignore — may already be disconnected
    }
}

function handleFileProgressUpdate(data) {
    const fileId = data.file_id;
    const status = data.status;
    let message = data.message;

    // Show queue position for queued files
    if (status === 'queued' && data.queue_position > 0) {
        message = `In queue (position ${data.queue_position})`;
    }

    // Track in active progress
    if (status === 'ready' || status === 'failed') {
        // Terminal state — remove from progress panel after brief delay
        if (activeProgressFiles[fileId]) {
            activeProgressFiles[fileId] = { ...activeProgressFiles[fileId], ...data };
            updateProgressPanelItem(fileId, data);
        }

        // Handle completion
        if (status === 'ready') {
            const fileName = activeProgressFiles[fileId]?.fileName || data.file_name || 'File';
            const timeSec = data.elapsed_ms ? (data.elapsed_ms / 1000).toFixed(1) : '?';
            Toast.success(`"${fileName}" is ready. ${data.rows_loaded?.toLocaleString() || ''} rows in ${timeSec}s`);
            refreshProjectHeader();
            if (variablesLoaded) loadVariables();
        } else if (status === 'failed') {
            Toast.error(`File processing failed: ${message}`);
        }

        // Update the table row from the server
        refreshFileRow(fileId);

        // Clean up after a moment
        setTimeout(() => {
            delete activeProgressFiles[fileId];
            removeProgressPanelItem(fileId);
            leaveFileProgressGroup(fileId);

            // Stop fallback poller if any
            if (fileStatusPollers[fileId]) {
                clearInterval(fileStatusPollers[fileId]);
                delete fileStatusPollers[fileId];
            }
        }, 2000);
    } else {
        // In-progress update
        if (!activeProgressFiles[fileId]) {
            // Find file name from local files array
            const file = files.find(f => f.id === fileId);
            activeProgressFiles[fileId] = {
                fileName: file?.file_name || file?.fileName || 'Processing...',
                fileId
            };
        }
        activeProgressFiles[fileId] = { ...activeProgressFiles[fileId], ...data };
        updateProgressPanelItem(fileId, data);
        showProgressPanel();

        // Also update the table row status badge
        const row = document.getElementById(`file-row-${fileId}`);
        if (row) {
            const statusCell = row.querySelector('td:nth-child(3)');
            const displaySt = status === 'loading_data' ? 'loading data' : status;
            if (statusCell) {
                statusCell.innerHTML = `<span class="status-badge ${status}">${displaySt}</span>`;
            }
            row.setAttribute('data-status', status);
        }
    }
}

async function refreshFileRow(fileId) {
    try {
        const file = await api.request(`/research/projects/${projectId}/files/${fileId}`);
        updateFileRowStatus(file);
    } catch (e) {
        console.warn('Failed to refresh file row:', e);
    }
}

function startFilePolling() {
    // Clear existing pollers
    Object.values(fileStatusPollers).forEach(id => clearInterval(id));
    fileStatusPollers = {};

    const processingFiles = files.filter(f => ['uploading', 'parsing', 'loading_data'].includes(f.status));
    if (processingFiles.length === 0) return;

    // Try SignalR first
    connectFileProgressSignalR().then(() => {
        joinFileProgressGroups();

        // Track processing files in progress panel
        for (const file of processingFiles) {
            const fileName = file.fileName || file.file_name || 'Unknown';
            const statusMsg = file.status === 'queued' ? 'Waiting in queue...' :
                              file.status === 'loading_data' ? 'Loading rows...' : 'Processing...';
            activeProgressFiles[file.id] = {
                fileName,
                fileId: file.id,
                status: file.status,
                message: statusMsg
            };
            updateProgressPanelItem(file.id, {
                status: file.status,
                message: statusMsg,
                rows_loaded: 0,
                elapsed_ms: 0,
                rows_per_sec: 0,
                queue_position: 0
            });
        }
        if (processingFiles.length > 0) showProgressPanel();

        // Start fallback polling only if SignalR failed
        if (!fileProgressConnected) {
            for (const file of processingFiles) {
                startPollingFile(file.id);
            }
        }
    });
}

function startPollingFile(fileId) {
    if (fileStatusPollers[fileId]) return;

    fileStatusPollers[fileId] = setInterval(async () => {
        try {
            const file = await api.request(`/research/projects/${projectId}/files/${fileId}`);
            updateFileRowStatus(file);

            // Stop polling if terminal state
            if (file.status === 'ready' || file.status === 'failed') {
                clearInterval(fileStatusPollers[fileId]);
                delete fileStatusPollers[fileId];

                if (file.status === 'ready') {
                    Toast.success(`File "${file.fileName || file.file_name}" is ready.`);
                    refreshProjectHeader();
                    if (variablesLoaded) loadVariables();
                } else if (file.status === 'failed') {
                    const errorMsg = file.errorMessage || file.error_message || 'Unknown error';
                    Toast.error(`File parsing failed: ${errorMsg}`);
                }

                // Remove from progress panel
                delete activeProgressFiles[fileId];
                removeProgressPanelItem(fileId);
            }
        } catch (error) {
            console.warn(`Polling failed for file ${fileId}:`, error);
        }
    }, 3000);
}

// ============================================
// FLOATING PROGRESS PANEL
// ============================================

function showProgressPanel() {
    const panel = document.getElementById('fileProgressPanel');
    if (panel) panel.style.display = '';
}

function hideProgressPanel() {
    const panel = document.getElementById('fileProgressPanel');
    if (panel) panel.style.display = 'none';
}

function toggleProgressPanel() {
    const panel = document.getElementById('fileProgressPanel');
    if (panel) panel.classList.toggle('minimized');
}

function updateProgressPanelItem(fileId, data) {
    const list = document.getElementById('fileProgressList');
    if (!list) return;

    let item = document.getElementById(`progress-${fileId}`);
    const info = activeProgressFiles[fileId] || {};
    const fileName = info.fileName || data.file_name || 'Processing...';
    const status = data.status || 'parsing';
    const message = data.message || 'Processing...';
    const rowsLoaded = data.rows_loaded || 0;
    const elapsedMs = data.elapsed_ms || 0;
    const rowsPerSec = data.rows_per_sec || 0;
    const queuePosition = data.queue_position || 0;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);

    // Determine progress bar state
    let barClass = '';
    let barWidth = '0%';
    if (status === 'ready') {
        barWidth = '100%';
    } else if (status === 'failed') {
        barWidth = '100%';
        barClass = 'style="background: var(--color-danger, #ef4444);"';
    } else if (status === 'loading_data' && rowsLoaded > 0) {
        barWidth = '60%';
        barClass = '';
    } else if (status === 'queued') {
        barClass = '';
    } else {
        barClass = '';
    }

    const isIndeterminate = (status === 'queued' || status === 'parsing' || (status === 'loading_data' && rowsLoaded === 0));

    const statsText = (status === 'queued' && queuePosition > 0)
        ? `Position ${queuePosition} in queue`
        : rowsLoaded > 0
            ? `${rowsLoaded.toLocaleString()} rows | ${elapsedSec}s${rowsPerSec > 0 ? ` | ${rowsPerSec.toLocaleString()} rows/sec` : ''}`
            : elapsedMs > 0 ? `${elapsedSec}s elapsed` : '';

    const html = `
        <div class="file-progress-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
        <div class="file-progress-status">${escapeHtml(message)}</div>
        <div class="file-progress-bar">
            <div class="file-progress-fill ${isIndeterminate ? 'indeterminate' : ''}" style="width: ${barWidth};" ${barClass}></div>
        </div>
        ${statsText ? `<div class="file-progress-stats">${statsText}</div>` : ''}
    `;

    if (!item) {
        item = document.createElement('div');
        item.className = 'file-progress-item';
        item.id = `progress-${fileId}`;
        list.appendChild(item);
    }
    item.innerHTML = html;

    // Update panel title
    const count = Object.keys(activeProgressFiles).length;
    const titleEl = document.getElementById('fileProgressTitle');
    if (titleEl) titleEl.textContent = count === 1 ? 'Processing File' : `Processing ${count} Files`;
}

function removeProgressPanelItem(fileId) {
    const item = document.getElementById(`progress-${fileId}`);
    if (item) item.remove();

    // Hide panel if empty
    if (Object.keys(activeProgressFiles).length === 0) {
        hideProgressPanel();
    } else {
        // Update count
        const count = Object.keys(activeProgressFiles).length;
        const titleEl = document.getElementById('fileProgressTitle');
        if (titleEl) titleEl.textContent = count === 1 ? 'Processing File' : `Processing ${count} Files`;
    }
}

function updateFileRowStatus(file) {
    const fileId = file.id;
    const row = document.getElementById(`file-row-${fileId}`);
    if (!row) return;

    const status = file.status;
    const variableCount = file.variableCount ?? file.variable_count ?? 0;
    const rowCount = file.rowCount ?? file.row_count ?? 0;
    const displayStatus = status === 'loading_data' ? 'loading data' : status;

    // Update status badge
    const statusCell = row.querySelector('td:nth-child(3)');
    statusCell.innerHTML = `<span class="status-badge ${status}">${displayStatus}</span>`;

    // Update variables column
    const varsCell = row.querySelector('td:nth-child(4)');
    varsCell.textContent = status === 'ready' ? formatNumber(variableCount) : '-';

    // Update rows column
    const rowsCell = row.querySelector('td:nth-child(5)');
    rowsCell.textContent = status === 'ready' ? formatNumber(rowCount) : '-';

    // Update data attribute
    row.setAttribute('data-status', status);

    // Enable/disable delete button based on processing state
    const deleteBtn = row.querySelector('.btn-icon-danger');
    if (deleteBtn) {
        const isProcessing = ['queued', 'uploading', 'parsing', 'loading_data'].includes(status);
        deleteBtn.disabled = isProcessing;
        deleteBtn.style.opacity = isProcessing ? '0.3' : '';
        deleteBtn.style.cursor = isProcessing ? 'not-allowed' : '';
        deleteBtn.title = isProcessing ? 'Cannot delete while processing' : 'Delete file';
    }

    // Update local files array
    const idx = files.findIndex(f => f.id === fileId);
    if (idx !== -1) {
        files[idx] = file;
    }
}

async function refreshProjectHeader() {
    try {
        const response = await api.request(`/research/projects/${projectId}`);
        project = response;
        renderProjectHeader();
    } catch (error) {
        console.warn('Failed to refresh project header:', error);
    }
}

// ============================================
// TAB SWITCHING
// ============================================

function switchTab(tabName) {
    activeTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}Tab`);
    });

    // Lazy-load data on first tab click
    if (tabName === 'variables') {
        if (!variablesLoaded) loadVariables();
        if (aiAvailable === null) checkAiAvailability();
    }
    if (tabName === 'query') {
        updateAvailableTables();
    }
    if (tabName === 'ailogs') {
        if (!document.getElementById('aiLogsContent').innerHTML) loadAiLogs();
    }
}

// ============================================
// VARIABLES TAB
// ============================================

async function loadVariables() {
    const loadingEl = document.getElementById('variablesLoading');
    const gridEl = document.getElementById('variablesGrid');
    const emptyEl = document.getElementById('variablesEmpty');
    const toolbarEl = document.getElementById('variablesToolbar');

    loadingEl.style.display = 'block';
    gridEl.innerHTML = '';
    emptyEl.style.display = 'none';
    toolbarEl.style.display = 'none';

    allVariables = [];

    try {
        // Get files if not loaded
        if (files.length === 0) {
            const filesResponse = await api.request(`/research/projects/${projectId}/files`);
            files = Array.isArray(filesResponse) ? filesResponse : [];
        }

        // Load variables for each ready file
        const readyFiles = files.filter(f => f.status === 'ready');

        if (readyFiles.length === 0) {
            loadingEl.style.display = 'none';
            emptyEl.style.display = 'block';
            variablesLoaded = true;
            return;
        }

        const variablePromises = readyFiles.map(async (file) => {
            try {
                const fileId = file.id;
                const response = await api.request(`/research/projects/${projectId}/files/${fileId}/variables`);
                return {
                    fileId: fileId,
                    fileName: response.file_name || file.fileName || file.file_name,
                    variables: response.variables || []
                };
            } catch (error) {
                console.warn(`Failed to load variables for file ${file.id}:`, error);
                return { fileId: file.id, fileName: file.fileName || file.file_name, variables: [] };
            }
        });

        const results = await Promise.all(variablePromises);
        allVariables = results;
        variablesLoaded = true;

        loadingEl.style.display = 'none';

        // Populate file filter dropdown
        populateFileFilter();

        // Count total variables
        const totalVars = allVariables.reduce((sum, f) => sum + f.variables.length, 0);

        if (totalVars === 0) {
            emptyEl.style.display = 'block';
            return;
        }

        toolbarEl.style.display = 'flex';
        renderVariables();
    } catch (error) {
        loadingEl.style.display = 'none';
        gridEl.innerHTML = `<div class="query-error">Failed to load variables: ${escapeHtml(error.message)}</div>`;
        console.error('Failed to load variables:', error);
    }
}

let fileFilterDropdown = null;

function populateFileFilter() {
    const select = document.getElementById('variableFileFilter');
    select.innerHTML = '<option value="">All files</option>';

    for (const fileGroup of allVariables) {
        const opt = document.createElement('option');
        opt.value = fileGroup.fileId;
        opt.textContent = fileGroup.fileName;
        select.appendChild(opt);
    }

    // Convert to searchable dropdown
    if (typeof convertSelectToSearchable === 'function') {
        if (fileFilterDropdown) fileFilterDropdown.destroy();
        fileFilterDropdown = convertSelectToSearchable('variableFileFilter', {
            placeholder: 'All files',
            searchPlaceholder: 'Search files...',
            onChange: () => filterVariables()
        });
    }
}

function getFileFilterValue() {
    if (fileFilterDropdown) return fileFilterDropdown.getValue() || '';
    return document.getElementById('variableFileFilter').value;
}

function renderVariables() {
    const gridEl = document.getElementById('variablesGrid');
    const countLabel = document.getElementById('variableCountLabel');
    const searchTerm = (document.getElementById('variableSearch').value || '').toLowerCase();
    const fileFilter = getFileFilterValue();

    varFilteredVars = [];

    for (const fileGroup of allVariables) {
        if (fileFilter && fileGroup.fileId !== fileFilter) continue;

        for (const v of fileGroup.variables) {
            const name = (v.variableName || v.variable_name || '').toLowerCase();
            const label = (v.variableLabel || v.variable_label || '').toLowerCase();

            if (searchTerm && !name.includes(searchTerm) && !label.includes(searchTerm)) continue;

            varFilteredVars.push({
                ...v,
                _fileId: fileGroup.fileId,
                _fileName: fileGroup.fileName
            });
        }
    }

    const totalAll = allVariables.reduce((sum, f) => sum + f.variables.length, 0);
    countLabel.textContent = varFilteredVars.length === totalAll
        ? `${totalAll} variable${totalAll !== 1 ? 's' : ''}`
        : `${varFilteredVars.length} of ${totalAll} variables`;

    if (varFilteredVars.length === 0) {
        gridEl.innerHTML = `<div class="empty-state"><p>No variables match your search.</p></div>`;
        return;
    }

    // Pagination
    const totalPages = Math.ceil(varFilteredVars.length / varPageSize);
    if (varCurrentPage > totalPages) varCurrentPage = totalPages;
    if (varCurrentPage < 1) varCurrentPage = 1;
    const startIdx = (varCurrentPage - 1) * varPageSize;
    const pageVars = varFilteredVars.slice(startIdx, startIdx + varPageSize);
    const showFile = allVariables.length > 1;

    // Desktop table
    const tableHtml = `
        <div class="variables-table-container">
            <table class="variables-table">
                <thead><tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Label</th>
                    <th>Type</th>
                    <th>Measure</th>
                    <th>Value Labels</th>
                    ${showFile ? '<th>File</th>' : ''}
                </tr></thead>
                <tbody>
                    ${pageVars.map((v, i) => {
                        const varName = v.variableName || v.variable_name || '';
                        const varLabel = v.variableLabel || v.variable_label || '';
                        const varType = v.variableType || v.variable_type || 'unknown';
                        const measure = v.measurementType || v.measurement_type || '-';
                        const vlCount = getValueLabelCount(v);
                        const rowIdx = startIdx + i;
                        return `<tr>
                            <td style="color:var(--text-muted);font-size:0.72rem;">${startIdx + i + 1}</td>
                            <td><span class="var-name-cell">${escapeHtml(varName)}</span></td>
                            <td><span class="var-label-cell" title="${escapeHtml(varLabel)}">${escapeHtml(truncate(varLabel, 60)) || '-'}</span></td>
                            <td><span class="type-badge ${escapeHtml(varType)}">${escapeHtml(varType)}</span></td>
                            <td><span class="measurement-badge">${escapeHtml(measure)}</span></td>
                            <td>${vlCount > 0
                                ? `<button class="value-labels-link" onclick="openVarPanel(${rowIdx})">View (${vlCount})</button>`
                                : '<span style="color:var(--text-muted);font-size:0.75rem;">-</span>'
                            }</td>
                            ${showFile ? `<td><span class="measurement-badge">${escapeHtml(truncate(v._fileName, 25))}</span></td>` : ''}
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;

    // Mobile cards
    const cardsHtml = `
        <div class="variables-cards-mobile">
            ${pageVars.map((v, i) => renderVariableCard(v, startIdx + i)).join('')}
        </div>`;

    // Pagination controls
    const paginationHtml = renderPagination(varFilteredVars.length, varCurrentPage, varPageSize, totalPages);

    gridEl.innerHTML = tableHtml + cardsHtml + paginationHtml;
}

function getValueLabelCount(v) {
    const valueLabelsJson = v.valueLabelJson || v.valueLabelsJson || v.value_labels_json || v.value_labels || null;
    if (!valueLabelsJson) return 0;
    try {
        const labels = typeof valueLabelsJson === 'string' ? JSON.parse(valueLabelsJson) : valueLabelsJson;
        return (labels && typeof labels === 'object') ? Object.keys(labels).length : 0;
    } catch (e) {
        return 0;
    }
}

function renderVariableCard(v, globalIdx) {
    const varName = v.variableName || v.variable_name || '';
    const varLabel = v.variableLabel || v.variable_label || '';
    const varType = v.variableType || v.variable_type || 'unknown';
    const measurementType = v.measurementType || v.measurement_type || '';
    const vlCount = getValueLabelCount(v);

    return `
        <div class="variable-card">
            <div class="variable-card-header">
                <span class="variable-name">${escapeHtml(varName)}</span>
                <span class="type-badge ${escapeHtml(varType)}">${escapeHtml(varType)}</span>
            </div>
            ${varLabel ? `<div class="variable-label">${escapeHtml(varLabel)}</div>` : ''}
            <div class="variable-meta">
                ${measurementType ? `<span class="measurement-badge">${escapeHtml(measurementType)}</span>` : ''}
            </div>
            ${vlCount > 0 ? `<button class="value-labels-link" onclick="openVarPanel(${globalIdx})" style="margin-top:8px;">Value labels (${vlCount})</button>` : ''}
        </div>
    `;
}

function renderPagination(totalItems, currentPage, pageSize, totalPages) {
    if (totalItems <= pageSize) return '';
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    // Build page buttons
    let pageButtons = '';
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

    if (startPage > 1) {
        pageButtons += `<button class="pagination-btn" onclick="goToVarPage(1)">1</button>`;
        if (startPage > 2) pageButtons += `<span style="color:var(--text-muted);padding:0 4px;">...</span>`;
    }
    for (let p = startPage; p <= endPage; p++) {
        pageButtons += `<button class="pagination-btn ${p === currentPage ? 'active' : ''}" onclick="goToVarPage(${p})">${p}</button>`;
    }
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) pageButtons += `<span style="color:var(--text-muted);padding:0 4px;">...</span>`;
        pageButtons += `<button class="pagination-btn" onclick="goToVarPage(${totalPages})">${totalPages}</button>`;
    }

    return `
        <div class="pagination-container">
            <div class="pagination-info">Showing ${startItem}-${endItem} of ${totalItems} variables</div>
            <div class="pagination-controls">
                <button class="pagination-btn" onclick="goToVarPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                ${pageButtons}
                <button class="pagination-btn" onclick="goToVarPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
            <div class="pagination-per-page">
                <span style="font-size:0.75rem;color:var(--text-muted);">Per page:</span>
                <select onchange="changeVarPageSize(this.value)">
                    <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
                    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                </select>
            </div>
        </div>`;
}

function goToVarPage(page) {
    varCurrentPage = page;
    renderVariables();
    // Scroll to top of variables section
    const el = document.getElementById('variablesGrid');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changeVarPageSize(size) {
    varPageSize = parseInt(size, 10);
    varCurrentPage = 1;
    renderVariables();
}

function filterVariables() {
    varCurrentPage = 1;
    renderVariables();
}

// ── Variable Slide Panel ──

function openVarPanel(idx) {
    const v = varFilteredVars[idx];
    if (!v) return;

    const panel = document.getElementById('varSlidePanel');
    const overlay = document.getElementById('varPanelOverlay');
    const body = document.getElementById('varPanelBody');

    const varName = v.variableName || v.variable_name || '';
    const varLabel = v.variableLabel || v.variable_label || '';
    const varType = v.variableType || v.variable_type || 'unknown';
    const measure = v.measurementType || v.measurement_type || '-';
    const fileName = v._fileName || '-';
    const valueLabelsJson = v.valueLabelJson || v.valueLabelsJson || v.value_labels_json || v.value_labels || null;

    let labelsTableHtml = '';
    if (valueLabelsJson) {
        let labels = null;
        try {
            labels = typeof valueLabelsJson === 'string' ? JSON.parse(valueLabelsJson) : valueLabelsJson;
        } catch (e) {
            labels = null;
        }
        if (labels && typeof labels === 'object' && Object.keys(labels).length > 0) {
            const entries = Object.entries(labels);
            labelsTableHtml = `
                <div class="var-panel-labels-header">
                    Value Labels
                    <span class="var-panel-labels-count">${entries.length}</span>
                </div>
                <div class="var-panel-info-card" style="padding:0; overflow:hidden;">
                    <table class="var-panel-labels-table">
                        <thead><tr><th>Code</th><th>Label</th></tr></thead>
                        <tbody>
                            ${entries.map(([key, val]) => `
                                <tr>
                                    <td class="vl-code">${escapeHtml(key)}</td>
                                    <td>${escapeHtml(String(val))}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    body.innerHTML = `
        <div class="var-panel-info-card">
            <div class="var-panel-var-name">${escapeHtml(varName)}</div>
            ${varLabel ? `<div class="var-panel-var-label">${escapeHtml(varLabel)}</div>` : ''}
            <div class="var-panel-meta-grid">
                <div class="var-panel-meta-item">
                    <span class="var-panel-meta-label">Data Type</span>
                    <span class="var-panel-meta-value"><span class="type-badge ${escapeHtml(varType)}">${escapeHtml(varType)}</span></span>
                </div>
                <div class="var-panel-meta-item">
                    <span class="var-panel-meta-label">Measure</span>
                    <span class="var-panel-meta-value">${escapeHtml(measure)}</span>
                </div>
                <div class="var-panel-meta-item">
                    <span class="var-panel-meta-label">Source File</span>
                    <span class="var-panel-meta-value" style="font-size:0.75rem;">${escapeHtml(truncate(fileName, 40))}</span>
                </div>
                <div class="var-panel-meta-item">
                    <span class="var-panel-meta-label">Value Labels</span>
                    <span class="var-panel-meta-value">${getValueLabelCount(v) || 'None'}</span>
                </div>
            </div>
        </div>
        ${labelsTableHtml}
    `;

    panel.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeVarPanel() {
    const panel = document.getElementById('varSlidePanel');
    const overlay = document.getElementById('varPanelOverlay');
    panel.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================
// QUERY CONSOLE
// ============================================

function updateAvailableTables() {
    const listEl = document.getElementById('tableRefList');

    const readyFiles = files.filter(f => f.status === 'ready');

    if (readyFiles.length === 0) {
        listEl.innerHTML = '<li style="color: var(--text-muted); font-size: 0.8rem;">No tables available. Upload and parse a file first.</li>';
        return;
    }

    listEl.innerHTML = readyFiles.map(file => {
        const tableName = file.click_house_table || file.clickHouseTable || file.clickhouse_table || '';
        const fileName = file.fileName || file.file_name || '';
        const rowCount = file.rowCount ?? file.row_count ?? 0;
        const varCount = file.variableCount ?? file.variable_count ?? 0;

        return `
            <li>
                <span class="table-name" onclick="insertTableName('${escapeHtml(tableName)}')" title="Click to insert into query">${escapeHtml(tableName)}</span>
                <span style="color: var(--text-muted);">${escapeHtml(fileName)} (${formatNumber(rowCount)} rows, ${varCount} cols)</span>
            </li>
        `;
    }).join('');
}

function insertTableName(tableName) {
    const editor = document.getElementById('sqlEditor');
    const fullName = 'research.' + tableName;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;

    // If editor is empty, insert a SELECT template
    if (!text.trim()) {
        editor.value = `SELECT * FROM ${fullName} LIMIT 100`;
        editor.focus();
        editor.setSelectionRange(7, 8); // Select the '*' so user can replace
    } else {
        editor.value = text.substring(0, start) + fullName + text.substring(end);
        editor.focus();
        editor.setSelectionRange(start + fullName.length, start + fullName.length);
    }
}

async function executeQuery() {
    const editor = document.getElementById('sqlEditor');
    const sql = editor.value.trim();

    if (!sql) {
        Toast.warning('Please enter a SQL query.');
        return;
    }

    const btn = document.getElementById('runQueryBtn');
    const resultsDiv = document.getElementById('queryResults');
    const resultsContentDiv = document.getElementById('queryResultsContent');
    const rowCountDiv = document.getElementById('queryRowCount');
    const errorDiv = document.getElementById('queryError');
    const execInfo = document.getElementById('queryExecutionInfo');

    // Set loading state
    btn.disabled = true;
    btn.innerHTML = `
        <div class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin: 0;"></div>
        Running...
    `;
    resultsDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    execInfo.textContent = '';

    try {
        // Use direct fetch to preserve structured error response body
        const baseUrl = api._getBaseUrl('/research/');
        const token = api.token || getAuthToken();
        const fetchResponse = await fetch(`${baseUrl}/projects/${projectId}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ sql })
        });

        const response = await fetchResponse.json();

        if (!fetchResponse.ok || response.success === false) {
            // Check for structured validation error
            if (response.error_type) {
                renderValidationError(errorDiv, response);
            } else {
                errorDiv.innerHTML = '';
                errorDiv.textContent = response.error || response.message || 'Query execution failed';
                errorDiv.className = 'query-error';
            }
            errorDiv.style.display = 'block';
            execInfo.textContent = '';
            return;
        }

        const columns = response.columns || [];
        const rows = response.rows || [];
        const rowCount = response.row_count ?? rows.length;
        const execTimeMs = response.execution_time_ms ?? 0;

        queryResultsData = { columns, rows };

        // Show execution info
        execInfo.textContent = `${formatNumber(rowCount)} rows in ${execTimeMs}ms`;

        if (rows.length === 0) {
            resultsContentDiv.innerHTML = `
                <div class="empty-state" style="padding: 24px;">
                    <p class="empty-title">Query returned no results</p>
                </div>
            `;
            rowCountDiv.textContent = '';
        } else {
            // Build results table
            let tableHtml = `
                <div class="query-results-wrapper">
                    <table class="query-results-table">
                        <thead>
                            <tr>${columns.map(c => `<th>${escapeHtml(String(c))}</th>`).join('')}</tr>
                        </thead>
                        <tbody>
            `;

            const displayRows = rows.slice(0, 1000);
            for (const row of displayRows) {
                tableHtml += '<tr>';
                if (Array.isArray(row)) {
                    for (const cell of row) {
                        tableHtml += `<td>${escapeHtml(formatCellValue(cell))}</td>`;
                    }
                } else if (typeof row === 'object' && row !== null) {
                    for (const col of columns) {
                        tableHtml += `<td>${escapeHtml(formatCellValue(row[col]))}</td>`;
                    }
                }
                tableHtml += '</tr>';
            }

            tableHtml += '</tbody></table></div>';
            resultsContentDiv.innerHTML = tableHtml;

            rowCountDiv.textContent = rows.length >= 1000
                ? `Showing 1,000 of ${formatNumber(rowCount)} rows`
                : `${formatNumber(rowCount)} row${rowCount !== 1 ? 's' : ''} returned`;
        }

        resultsDiv.style.display = 'block';

    } catch (error) {
        console.error('Query execution failed:', error);
        errorDiv.innerHTML = '';
        errorDiv.textContent = error.message || 'Query execution failed';
        errorDiv.className = 'query-error';
        errorDiv.style.display = 'block';
        execInfo.textContent = '';
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px;">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Run Query
        `;
    }
}

// ============================================
// VALIDATION ERROR DISPLAY
// ============================================

function renderValidationError(container, errorData) {
    const errorType = errorData.error_type || 'error';
    const errorMessage = errorData.error || 'Query validation failed';
    const suggestions = errorData.suggestions || {};
    const unknownColumns = errorData.unknown_columns || [];

    const typeLabels = {
        'forbidden_operation': 'FORBIDDEN',
        'access_denied': 'ACCESS DENIED',
        'syntax_error': 'SYNTAX ERROR',
        'unknown_column': 'UNKNOWN COLUMN'
    };
    const typeLabel = typeLabels[errorType] || errorType.toUpperCase().replace(/_/g, ' ');

    let html = `
        <div class="query-validation-error">
            <div class="validation-error-header">
                <span class="validation-error-type ${errorType}">${escapeHtml(typeLabel)}</span>
            </div>
            <div class="validation-error-message">${escapeHtml(errorMessage)}</div>
    `;

    // "Did you mean?" suggestions with clickable links
    if (Object.keys(suggestions).length > 0) {
        html += `<div class="validation-suggestions">`;
        html += `<span class="validation-suggestions-label">Did you mean?</span>`;
        for (const [unknown, suggested] of Object.entries(suggestions)) {
            html += `<button class="validation-suggestion-btn" onclick="applySuggestion('${escapeHtml(unknown)}', '${escapeHtml(suggested)}')">${escapeHtml(unknown)} &rarr; <strong>${escapeHtml(suggested)}</strong></button>`;
        }
        html += `</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
    container.className = ''; // Clear default query-error class since we use our own styling
}

function applySuggestion(unknown, suggested) {
    const editor = document.getElementById('sqlEditor');
    if (!editor) return;

    // Replace the unknown column name with the suggestion (case-insensitive, whole word)
    const regex = new RegExp('\\b' + unknown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    editor.value = editor.value.replace(regex, suggested);

    // Flash the editor to indicate change
    editor.style.borderColor = 'var(--color-success, #10b981)';
    setTimeout(() => { editor.style.borderColor = ''; }, 1500);

    // Auto-run the corrected query
    executeQuery();
}

// ============================================
// FILE UPLOAD
// ============================================

function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    modal.classList.add('active');

    // Reset upload state
    document.getElementById('uploadProgress').style.display = 'none';
    document.getElementById('uploadProgressBar').style.width = '0%';
    document.getElementById('uploadProgressText').textContent = 'Uploading...';
    document.getElementById('uploadFileInput').value = '';

    // Setup dropzone events
    setupDropzone();
}

function closeUploadModal() {
    document.getElementById('uploadModal').classList.remove('active');
}

function setupDropzone() {
    const dropzone = document.getElementById('uploadDropzone');
    const fileInput = document.getElementById('uploadFileInput');

    // Remove old listeners by cloning
    const newDropzone = dropzone.cloneNode(true);
    dropzone.parentNode.replaceChild(newDropzone, dropzone);

    const newFileInput = newDropzone.querySelector('#uploadFileInput') || document.getElementById('uploadFileInput');

    // Click to select
    newDropzone.addEventListener('click', (e) => {
        if (e.target !== newFileInput) {
            newFileInput.click();
        }
    });

    // File selected
    newFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFileUpload(file);
    });

    // Drag events
    newDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        newDropzone.classList.add('drag-over');
    });

    newDropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        newDropzone.classList.remove('drag-over');
    });

    newDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        newDropzone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFileUpload(file);
    });
}

async function handleFileUpload(file) {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.zip')) {
        Toast.error('Only ZIP files are accepted. Please compress your .sav file into a ZIP archive.');
        return;
    }

    const progressDiv = document.getElementById('uploadProgress');
    const progressBar = document.getElementById('uploadProgressBar');
    const progressText = document.getElementById('uploadProgressText');

    progressDiv.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = `Uploading ${file.name}...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const token = getAuthToken();

        // Use XMLHttpRequest for upload progress tracking
        const result = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    progressBar.style.width = percent + '%';
                    progressText.textContent = `Uploading ${file.name}... ${percent}%`;
                }
            });

            xhr.addEventListener('load', () => {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(response);
                    } else {
                        reject(new Error(response.error || `Upload failed with status ${xhr.status}`));
                    }
                } catch (e) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve({ message: 'Upload accepted' });
                    } else {
                        reject(new Error(`Upload failed with status ${xhr.status}`));
                    }
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
            xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

            xhr.open('POST', `${CONFIG.researchApiBaseUrl}/projects/${projectId}/files/upload`);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);
        });

        // Upload accepted
        progressBar.style.width = '100%';
        progressText.textContent = 'Upload complete. Parsing file...';

        Toast.success('File uploaded successfully. Parsing in progress...');

        // Close modal after short delay
        setTimeout(() => {
            closeUploadModal();
        }, 1000);

        // Reload files and start SignalR progress tracking
        await loadFiles();

        // If the upload response has a file_id, join its progress group
        if (result.file_id) {
            const fid = result.file_id;

            // Track in progress panel immediately
            const queuePos = result.queue_position || 0;
            const queueMsg = queuePos > 0 ? `In queue (position ${queuePos})` : 'Queued for processing...';
            activeProgressFiles[fid] = {
                fileName: file.name.replace('.zip', '.sav'),
                fileId: fid,
                status: 'queued',
                message: queueMsg
            };
            updateProgressPanelItem(fid, {
                status: 'queued',
                message: queueMsg,
                rows_loaded: 0,
                elapsed_ms: 0,
                rows_per_sec: 0,
                queue_position: queuePos
            });
            showProgressPanel();

            // Connect SignalR if not already and join group
            if (!fileProgressConnected) {
                await connectFileProgressSignalR();
            }
            if (fileProgressConnected) {
                try {
                    await fileProgressConnection.invoke('JoinFileProgress', fid);
                } catch (e) {
                    console.warn('Failed to join progress group:', e);
                }
            }

            // Fallback: poll if SignalR isn't connected
            if (!fileProgressConnected) {
                startPollingFile(fid);
            }
        }

    } catch (error) {
        console.error('Upload failed:', error);
        progressText.textContent = `Upload failed: ${error.message}`;
        progressBar.style.width = '0%';
        Toast.error(error.message || 'File upload failed');
    }
}

// ============================================
// FILE DELETE
// ============================================

async function deleteFile(fileId, fileName) {
    const confirmed = await Confirm.danger(
        `This will permanently delete "${fileName}" and all its associated data. This action cannot be undone.`,
        'Delete File'
    );

    if (!confirmed) return;

    try {
        await api.request(`/research/projects/${projectId}/files/${fileId}`, {
            method: 'DELETE'
        });

        Toast.success(`File "${fileName}" deleted successfully.`);

        // Stop polling for this file if active
        if (fileStatusPollers[fileId]) {
            clearInterval(fileStatusPollers[fileId]);
            delete fileStatusPollers[fileId];
        }

        // Refresh files and project header
        await loadFiles();
        refreshProjectHeader();

        // Reset variables if they were loaded
        if (variablesLoaded) {
            variablesLoaded = false;
            if (activeTab === 'variables') {
                loadVariables();
            }
        }
    } catch (error) {
        console.error('Delete file failed:', error);
        Toast.error(error.message || 'Failed to delete file');
    }
}

// ============================================
// PROJECT EDIT / DELETE
// ============================================

function openEditProjectModal() {
    document.getElementById('editProjectName').value = project.name || '';
    document.getElementById('editProjectDescription').value = project.description || '';
    document.getElementById('editProjectStatus').value = project.status || 'active';
    const aiInstrEl = document.getElementById('editProjectAiInstructions');
    if (aiInstrEl) aiInstrEl.value = project.ai_instructions || project.aiInstructions || '';
    document.getElementById('editProjectModal').classList.add('active');
}

async function handleEditProject(event) {
    event.preventDefault();

    const name = document.getElementById('editProjectName').value.trim();
    const description = document.getElementById('editProjectDescription').value.trim();
    const status = document.getElementById('editProjectStatus').value;
    const aiInstrEl = document.getElementById('editProjectAiInstructions');
    const aiInstructions = aiInstrEl ? aiInstrEl.value.trim() : null;

    if (!name) {
        Toast.warning('Project name is required.');
        return;
    }

    try {
        const body = { name, description: description || null, status };
        if (aiInstructions !== null) body.aiInstructions = aiInstructions;

        await api.request(`/research/projects/${projectId}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });

        Toast.success('Project updated successfully.');
        closeModal('editProjectModal');

        // Refresh project data
        project.name = name;
        project.description = description;
        project.status = status;
        if (aiInstructions !== null) project.ai_instructions = aiInstructions;
        renderProjectHeader();
    } catch (error) {
        console.error('Update project failed:', error);
        Toast.error(error.message || 'Failed to update project');
    }
}

async function deleteProject() {
    const confirmed = await Confirm.danger(
        `This will permanently delete "${project.name}" and ALL its files, variables, and data. This action cannot be undone.`,
        'Delete Project'
    );

    if (!confirmed) return;

    try {
        await api.request(`/research/projects/${projectId}`, {
            method: 'DELETE'
        });

        Toast.success('Project deleted successfully.');

        // Redirect to dashboard
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 1000);
    } catch (error) {
        console.error('Delete project failed:', error);
        Toast.error(error.message || 'Failed to delete project');
    }
}

// ============================================
// MODAL HELPERS
// ============================================

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

// Close modals on backdrop click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal') && e.target.classList.contains('active')) {
        e.target.classList.remove('active');
    }
});

// Close modals / AI HUD on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // Close AI HUD first if open
        if (aiChatVisible) {
            toggleAiChat();
            return;
        }
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
    }
});

// ============================================
// AI ASSISTANT
// ============================================

async function checkAiAvailability() {
    if (aiAvailable !== null) return;
    try {
        const response = await api.request('/research/ai/status');
        aiAvailable = response.available === true;
    } catch (error) {
        console.warn('AI availability check failed:', error);
        aiAvailable = false;
    }

    const btn = document.getElementById('aiChatToggleBtn');
    if (btn) {
        btn.style.display = aiAvailable ? 'inline-flex' : 'none';
    }

    // Connect SignalR if AI is available
    if (aiAvailable) connectAiSignalR();
}

function setAiConnectionStatus(status) {
    // status: 'disconnected' | 'connecting' | 'connected'
    const dots = [document.getElementById('aiBtnReticle'), document.getElementById('aiHudReticle')];
    for (const dot of dots) {
        if (!dot) continue;
        dot.classList.remove('connected', 'connecting');
        if (status === 'connected') dot.classList.add('connected');
        else if (status === 'connecting') dot.classList.add('connecting');
    }
}

async function connectAiSignalR() {
    if (aiSignalRConnection) return;
    setAiConnectionStatus('connecting');
    try {
        const token = api.token;
        // Connect to ResearchBackend's SignalR hub (not AIEngine)
        const hubUrl = CONFIG.endpoints.research + '/hubs/research' + `?access_token=${encodeURIComponent(token)}`;
        aiSignalRConnection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl)
            .withAutomaticReconnect()
            .build();

        // Listen for AI responses
        aiSignalRConnection.on('ResearchChatResponse', (data) => {
            removeTypingIndicator();
            aiProcessing = false;
            if (data.session_id) aiSessionId = data.session_id;
            // Guard: if response was already rendered (REST beat SignalR), skip
            if (aiResponseRendered) {
                enableAiInput(true);
                return;
            }
            // Parse visualization data if present
            if (data.visualizations_json) {
                try { aiVisualizationsData = JSON.parse(data.visualizations_json); }
                catch (e) { aiVisualizationsData = null; }
            }
            // If we were streaming, DON'T finalize immediately — let the reveal timer
            // drain the buffer so text appears progressively. Store metadata for later.
            if (aiStreamingEl) {
                aiStreamFinalized = true;
                aiStreamMetadata = {
                    sqlExecuted: data.sql_executed,
                    queryTimeMs: data.query_time_ms,
                    inputTokens: data.input_tokens,
                    outputTokens: data.output_tokens
                };
                // If buffer is already empty (edge case), finalize now
                if (aiStreamBuffer.length === 0 && aiDisplayedText === aiStreamingText) {
                    completeStreamReveal();
                }
            } else {
                appendAiMessage(data.response, data.sql_executed, data.query_time_ms, data.input_tokens, data.output_tokens);
            }
            aiResponseRendered = true;
            enableAiInput(true);
        });

        // Streaming text chunks from Haiku formatting pass
        aiSignalRConnection.on('ResearchChatChunk', (data) => {
            removeTypingIndicator();
            appendStreamChunk(data.chunk);
        });

        aiSignalRConnection.on('ResearchChatProgress', (data) => {
            updateTypingIndicator(data.tools_called);
        });

        aiSignalRConnection.on('ResearchChatProcessing', () => {
            // Processing started
        });

        aiSignalRConnection.on('ResearchChatError', (data) => {
            removeTypingIndicator();
            aiProcessing = false;
            if (aiStreamingEl) finalizeStreamingMessage();
            appendSystemMessage(data.error || 'An error occurred.');
            enableAiInput(true);
        });

        // Re-join group on reconnect (auto-reconnect drops group membership)
        const user = api.getUser();
        const userId = user ? user.userId : '';
        aiSignalRConnection.onreconnecting(() => {
            console.log('[AI] SignalR reconnecting...');
            setAiConnectionStatus('connecting');
        });
        aiSignalRConnection.onreconnected(async () => {
            console.log('[AI] SignalR reconnected, re-joining group');
            setAiConnectionStatus('connected');
            if (userId) {
                try { await aiSignalRConnection.invoke('JoinResearchChat', userId); }
                catch (e) { console.warn('[AI] Failed to rejoin group:', e); }
            }
        });
        aiSignalRConnection.onclose(() => {
            console.log('[AI] SignalR disconnected');
            setAiConnectionStatus('disconnected');
        });

        await aiSignalRConnection.start();

        // Join user-specific group
        if (userId) {
            await aiSignalRConnection.invoke('JoinResearchChat', userId);
        }

        setAiConnectionStatus('connected');
        console.log('[AI] SignalR connected to AIEngine hub');
    } catch (error) {
        console.warn('[AI] SignalR connection failed:', error);
        setAiConnectionStatus('disconnected');
        aiSignalRConnection = null;
    }
}

function toggleAiChat() {
    const overlay = document.getElementById('aiHudOverlay');
    const backdrop = document.getElementById('aiChatBackdrop');
    const btn = document.getElementById('aiChatToggleBtn');
    if (!overlay) return;

    aiChatVisible = !aiChatVisible;

    if (aiChatVisible) {
        // Ensure SignalR connection is established for streaming
        if (!aiSignalRConnection) {
            aiAvailable = true;
            connectAiSignalR();
        }
        overlay.style.display = 'flex';
        overlay.offsetHeight; // force reflow for transition
        overlay.classList.add('visible');
        if (backdrop) backdrop.classList.add('visible');
        if (btn) btn.classList.add('active');
        const input = document.getElementById('aiHudInput');
        if (input) setTimeout(() => input.focus(), 200);
    } else {
        overlay.classList.remove('visible');
        if (backdrop) backdrop.classList.remove('visible');
        if (btn) btn.classList.remove('active');
        setTimeout(() => {
            if (!aiChatVisible) overlay.style.display = 'none';
        }, 400);
    }
}

function handleAiInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendAiMessage();
    }
    if (event.key === 'Escape') {
        toggleAiChat();
    }
}

async function sendAiMessage() {
    const input = document.getElementById('aiHudInput');
    const messagesEl = document.getElementById('aiHudMessages');
    if (!input || !messagesEl) return;

    const text = input.value.trim();
    if (!text || aiProcessing) return;

    // Append user message
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-msg user';
    userMsg.textContent = text;
    messagesEl.appendChild(userMsg);

    input.value = '';
    input.style.height = 'auto';
    input.style.height = '48px';
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Show typing indicator
    aiProcessing = true;
    aiResponseRendered = false;
    enableAiInput(false);
    showTypingIndicator();

    try {
        // Get active file ID if a specific file is selected
        const fileFilter = document.getElementById('varFileFilter');
        let fileId = null;
        if (fileFilter && fileFilter.value) {
            fileId = fileFilter.value;
        }

        const response = await api.request('/research/ai/chat/message', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                file_id: fileId,
                message: text,
                session_id: aiSessionId
            })
        });

        // If SignalR already handled the response, skip REST rendering.
        // Guard against REST/SignalR race condition that causes duplicate messages.
        if (aiProcessing && !aiResponseRendered) {
            removeTypingIndicator();
            aiProcessing = false;
            if (response.session_id) aiSessionId = response.session_id;
            // Parse visualization data from REST response
            if (response.visualizations_json && !aiVisualizationsData) {
                try { aiVisualizationsData = JSON.parse(response.visualizations_json); }
                catch (e) { aiVisualizationsData = null; }
            }
            if (aiStreamingEl) {
                // Streaming chunks arrived but no final SignalR event — force finalize
                finalizeStreamingMessage(response.sql_executed, response.query_time_ms,
                    response.total_input_tokens, response.total_output_tokens);
            } else if (!aiStreamFinalized) {
                // No streaming at all — render full response
                appendAiMessage(response.response, response.sql_executed, response.query_time_ms,
                    response.total_input_tokens, response.total_output_tokens);
            }
            aiResponseRendered = true;
            enableAiInput(true);
        }
    } catch (error) {
        removeTypingIndicator();
        aiProcessing = false;
        if (aiStreamingEl) finalizeStreamingMessage();
        console.error('[AI] Error sending message:', error);
        appendSystemMessage('Failed to process your question. Please try again.');
        enableAiInput(true);
    }
}

function appendAiMessage(content, sqlExecuted, queryTimeMs, inputTokens, outputTokens, vizData) {
    const messagesEl = document.getElementById('aiHudMessages');
    if (!messagesEl) return;

    const aiMsg = document.createElement('div');
    aiMsg.className = 'ai-msg assistant';

    // Render markdown-like content (strip orphan chart markers if no viz data)
    const charts = vizData || aiVisualizationsData;
    const hasViz = charts && charts.length > 0;
    aiMsg.innerHTML = renderAiContent(content, !hasViz);

    // Render inline charts if visualization data is present
    if (hasViz) {
        renderInlineCharts(aiMsg, charts);
        aiVisualizationsData = null;
    }

    // Add metadata footer if we have stats
    if (sqlExecuted || queryTimeMs || inputTokens) {
        const meta = document.createElement('div');
        meta.className = 'ai-msg-meta';
        const parts = [];
        if (queryTimeMs) parts.push(`Query: ${queryTimeMs}ms`);
        if (inputTokens || outputTokens) parts.push(`Tokens: ${(inputTokens || 0) + (outputTokens || 0)}`);
        meta.textContent = parts.join(' · ');
        aiMsg.appendChild(meta);
    }

    messagesEl.appendChild(aiMsg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendStreamChunk(chunk) {
    const messagesEl = document.getElementById('aiHudMessages');
    if (!messagesEl) return;

    // Create the assistant bubble on first chunk
    if (!aiStreamingEl) {
        aiStreamingText = '';
        aiDisplayedText = '';
        aiStreamBuffer = '';
        aiStreamingEl = document.createElement('div');
        aiStreamingEl.className = 'ai-msg assistant';
        aiStreamingEl.innerHTML = '<span class="streaming-cursor"></span>';
        messagesEl.appendChild(aiStreamingEl);

        // Start the smooth reveal interval — reveals text progressively
        startStreamReveal(messagesEl);
    }

    // Add incoming chunk to both full text and pending buffer
    aiStreamingText += chunk;
    aiStreamBuffer += chunk;
}

function startStreamReveal(messagesEl) {
    if (aiStreamRevealTimer) return;

    const REVEAL_INTERVAL = 25;  // ms between reveals
    const BASE_CHARS = 2;        // chars per tick (slow, visible typing)
    const MED_CHARS = 8;         // medium catch-up speed
    const FAST_CHARS = 20;       // fast catch-up for large buffers

    aiStreamRevealTimer = setInterval(() => {
        if (!aiStreamingEl) {
            clearInterval(aiStreamRevealTimer);
            aiStreamRevealTimer = null;
            return;
        }

        // Buffer empty — check if we should finalize
        if (aiStreamBuffer.length === 0) {
            if (aiStreamFinalized) {
                completeStreamReveal();
            }
            return;
        }

        // Adaptive speed: reveal more chars when buffer is large (catch up)
        const bufferLen = aiStreamBuffer.length;
        const charsToReveal = bufferLen > 500 ? FAST_CHARS
                            : bufferLen > 100 ? MED_CHARS
                            : BASE_CHARS;

        // Move chars from buffer to displayed text
        const reveal = aiStreamBuffer.substring(0, charsToReveal);
        aiStreamBuffer = aiStreamBuffer.substring(charsToReveal);
        aiDisplayedText += reveal;

        // Re-render markdown with what's been revealed so far
        aiStreamingEl.innerHTML = renderAiContent(aiDisplayedText) + '<span class="streaming-cursor"></span>';
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }, REVEAL_INTERVAL);
}

// Called when the reveal timer has drained the buffer after final response received
function completeStreamReveal() {
    if (aiStreamRevealTimer) {
        clearInterval(aiStreamRevealTimer);
        aiStreamRevealTimer = null;
    }

    if (aiStreamingEl) {
        const hasViz = aiVisualizationsData && aiVisualizationsData.length > 0;
        // Final render of the COMPLETE text (strip orphan chart markers if no viz data)
        aiStreamingEl.innerHTML = renderAiContent(aiStreamingText, !hasViz);

        // Render inline charts if visualization data is present
        if (hasViz) {
            renderInlineCharts(aiStreamingEl, aiVisualizationsData);
        }

        // Add metadata footer
        const m = aiStreamMetadata || {};
        if (m.sqlExecuted || m.queryTimeMs || m.inputTokens) {
            const meta = document.createElement('div');
            meta.className = 'ai-msg-meta';
            const parts = [];
            if (m.queryTimeMs) parts.push(`Query: ${m.queryTimeMs}ms`);
            if (m.inputTokens || m.outputTokens) parts.push(`Tokens: ${(m.inputTokens || 0) + (m.outputTokens || 0)}`);
            meta.textContent = parts.join(' · ');
            aiStreamingEl.appendChild(meta);
        }

        const messagesEl = document.getElementById('aiHudMessages');
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Reset all streaming state
    aiStreamingEl = null;
    aiStreamingText = '';
    aiDisplayedText = '';
    aiStreamBuffer = '';
    aiStreamFinalized = false;
    aiStreamMetadata = null;
    aiVisualizationsData = null;
}

// Legacy wrapper — used by error handlers and REST fallback
function finalizeStreamingMessage(sqlExecuted, queryTimeMs, inputTokens, outputTokens) {
    aiStreamFinalized = true;
    aiStreamMetadata = { sqlExecuted, queryTimeMs, inputTokens, outputTokens };
    // Force immediate completion (skip remaining reveal)
    completeStreamReveal();
}

function appendSystemMessage(text) {
    const messagesEl = document.getElementById('aiHudMessages');
    if (!messagesEl) return;

    const msg = document.createElement('div');
    msg.className = 'ai-msg system';
    msg.textContent = text;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTypingIndicator() {
    const messagesEl = document.getElementById('aiHudMessages');
    if (!messagesEl) return;

    const indicator = document.createElement('div');
    indicator.className = 'ai-msg assistant ai-typing';
    indicator.id = 'aiTypingIndicator';
    indicator.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span> Analyzing data';
    messagesEl.appendChild(indicator);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateTypingIndicator(toolsCalled) {
    const indicator = document.getElementById('aiTypingIndicator');
    if (!indicator) return;
    const toolText = toolsCalled && toolsCalled.length > 0
        ? toolsCalled.map(t => t === 'execute_query' ? 'Running query' : 'Reading metadata').join(', ')
        : 'Analyzing data';
    indicator.innerHTML = `<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span> ${toolText}`;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('aiTypingIndicator');
    if (indicator) indicator.remove();
}

function enableAiInput(enabled) {
    const input = document.getElementById('aiHudInput');
    const btn = document.querySelector('.ai-hud-send');
    if (input) {
        input.disabled = !enabled;
        if (enabled) {
            input.focus();
            input.style.height = 'auto';
            input.style.height = '48px';
        }
    }
    if (btn) btn.disabled = !enabled;
}

function renderAiContent(text, stripChartMarkers = false) {
    if (!text) return '';
    // Strip orphan [CHART:N] markers if no visualization data
    if (stripChartMarkers) {
        text = text.replace(/\[CHART:\d+\]\n?/g, '');
    }
    // Use marked.js library for proper markdown rendering
    if (typeof marked !== 'undefined') {
        return marked.parse(text);
    }
    // Fallback: basic text with line breaks if marked.js not loaded
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// ============================================
// INLINE CHART RENDERING (ApexCharts)
// ============================================

const AI_CHART_COLORS = ['#00d4ff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#20c997', '#ff922b', '#748ffc'];

/**
 * Find [CHART:N] markers in rendered HTML and replace with chart containers,
 * then render ApexCharts into them. Charts render EXACTLY where markers are placed.
 * If no markers found, insert charts after the first paragraph or heading.
 */
function renderInlineCharts(msgEl, charts) {
    if (!charts || charts.length === 0 || typeof ApexCharts === 'undefined') return;

    const ts = Date.now();
    const html = msgEl.innerHTML;

    // Check if any markers exist in the HTML
    const hasMarkers = /\[CHART:\d+\]/.test(html);

    if (hasMarkers) {
        // Replace [CHART:N] markers with chart containers.
        // Markers may be wrapped in <p> tags by markdown — handle both cases.
        // First, replace <p>[CHART:N]</p> with chart divs (clean block replacement)
        let newHtml = html.replace(/<p>\s*\[CHART:(\d+)\]\s*<\/p>/g, (match, idx) => {
            const i = parseInt(idx);
            if (i >= charts.length) return '';
            return `<div class="ai-chart-container" data-chart-index="${i}"><div class="ai-chart-title">${escapeHtml(charts[i].title || '')}</div><div id="ai-chart-${ts}-${i}" class="ai-chart-render"></div></div>`;
        });
        // Then handle any remaining inline [CHART:N] (not wrapped in <p>)
        newHtml = newHtml.replace(/\[CHART:(\d+)\]/g, (match, idx) => {
            const i = parseInt(idx);
            if (i >= charts.length) return '';
            return `</p><div class="ai-chart-container" data-chart-index="${i}"><div class="ai-chart-title">${escapeHtml(charts[i].title || '')}</div><div id="ai-chart-${ts}-${i}" class="ai-chart-render"></div></div><p>`;
        });
        // Clean up empty <p></p> tags left over
        newHtml = newHtml.replace(/<p>\s*<\/p>/g, '');
        msgEl.innerHTML = newHtml;
    } else {
        // No markers — insert charts after the first heading or paragraph
        // to keep them contextual rather than dumping at the very end
        const firstBlock = msgEl.querySelector('h1, h2, h3, p');
        if (firstBlock) {
            let chartsHtml = '';
            charts.forEach((chart, i) => {
                chartsHtml += `<div class="ai-chart-container" data-chart-index="${i}"><div class="ai-chart-title">${escapeHtml(chart.title || '')}</div><div id="ai-chart-${ts}-${i}" class="ai-chart-render"></div></div>`;
            });
            firstBlock.insertAdjacentHTML('afterend', chartsHtml);
        } else {
            // Fallback: append at end
            let chartsHtml = '';
            charts.forEach((chart, i) => {
                chartsHtml += `<div class="ai-chart-container" data-chart-index="${i}"><div class="ai-chart-title">${escapeHtml(chart.title || '')}</div><div id="ai-chart-${ts}-${i}" class="ai-chart-render"></div></div>`;
            });
            msgEl.innerHTML += chartsHtml;
        }
    }

    // Render each chart using requestAnimationFrame for non-blocking
    requestAnimationFrame(() => {
        const containers = msgEl.querySelectorAll('.ai-chart-render');
        containers.forEach(container => {
            const idx = parseInt(container.parentElement.dataset.chartIndex);
            if (idx < charts.length) {
                createApexChart(container, charts[idx]);
            }
        });
        // Scroll to show charts
        const messagesEl = document.getElementById('aiHudMessages');
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Create an ApexCharts instance based on chart data from the AI.
 * Chart data: { title, chart_type, categories, series: [{ name, data }] }
 */
function createApexChart(container, chartData) {
    const { chart_type, categories, series } = chartData;
    if (!categories || !series || series.length === 0) return;

    const colors = AI_CHART_COLORS.slice(0, Math.max(series.length, categories.length));

    // Common chart options
    const baseOptions = {
        chart: {
            background: 'transparent',
            toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } },
            fontFamily: 'inherit',
            foreColor: 'rgba(255, 255, 255, 0.65)',
            redrawOnParentResize: true,
            animations: { enabled: true, easing: 'easeinout', speed: 600 }
        },
        colors: colors,
        grid: {
            borderColor: 'rgba(0, 212, 255, 0.06)',
            strokeDashArray: 3,
            xaxis: { lines: { show: false } },
            yaxis: { lines: { show: true } }
        },
        tooltip: {
            theme: 'dark',
            style: { fontSize: '11px' }
        },
        legend: {
            position: 'bottom',
            fontSize: '11px',
            labels: { colors: 'rgba(255, 255, 255, 0.6)' },
            markers: { size: 6, offsetX: -3 }
        },
        dataLabels: { enabled: false }
    };

    let options;

    switch (chart_type) {
        case 'bar_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'bar', height: Math.max(280, categories.length * 32) },
                series: series.map(s => ({ name: s.name, data: s.data })),
                plotOptions: {
                    bar: {
                        horizontal: true,
                        borderRadius: 4,
                        barHeight: '65%',
                        dataLabels: { position: 'right' }
                    }
                },
                dataLabels: {
                    enabled: true,
                    textAnchor: 'start',
                    offsetX: 8,
                    style: { fontSize: '10px', fontWeight: 400, colors: ['rgba(255,255,255,0.7)'] },
                    formatter: (val) => '\u2003' + formatChartNumber(val)
                },
                xaxis: { categories: categories, labels: { style: { fontSize: '10px' } } },
                yaxis: { labels: { style: { fontSize: '10px' }, maxWidth: 160 } }
            };
            break;

        case 'column_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'bar', height: 320 },
                series: series.map(s => ({ name: s.name, data: s.data })),
                plotOptions: {
                    bar: {
                        horizontal: false,
                        columnWidth: series.length > 1 ? '75%' : '55%',
                        borderRadius: 4,
                        borderRadiusApplication: 'end'
                    }
                },
                dataLabels: {
                    enabled: categories.length <= 8,
                    offsetY: -8,
                    style: { fontSize: '10px', colors: ['rgba(255,255,255,0.7)'] },
                    formatter: (val) => formatChartNumber(val)
                },
                xaxis: {
                    categories: categories,
                    labels: { rotate: categories.length > 6 ? -45 : 0, rotateAlways: categories.length > 6, style: { fontSize: '10px' } }
                },
                yaxis: { labels: { style: { fontSize: '10px' }, formatter: (val) => formatChartNumber(val) } }
            };
            break;

        case 'line_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'line', height: 320 },
                series: series.map(s => ({ name: s.name, data: s.data })),
                stroke: { curve: 'smooth', width: 2.5 },
                markers: {
                    size: 5,
                    strokeWidth: 0,
                    hover: { size: 7 }
                },
                xaxis: {
                    categories: categories,
                    labels: { rotate: categories.length > 8 ? -45 : 0, rotateAlways: categories.length > 8, style: { fontSize: '10px' } }
                },
                yaxis: { labels: { style: { fontSize: '10px' }, formatter: (val) => formatChartNumber(val) } }
            };
            break;

        case 'pie_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'pie', height: 320 },
                series: series[0].data,
                labels: categories,
                dataLabels: {
                    enabled: true,
                    formatter: (val) => Math.round(val) + '%',
                    style: { fontSize: '11px', fontWeight: 500 },
                    dropShadow: { enabled: false }
                },
                plotOptions: { pie: { expandOnClick: true } },
                stroke: { width: 1, colors: ['rgba(0,0,0,0.2)'] }
            };
            break;

        case 'donut_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'donut', height: 320 },
                series: series[0].data,
                labels: categories,
                dataLabels: {
                    enabled: true,
                    formatter: (val) => Math.round(val) + '%',
                    style: { fontSize: '11px', fontWeight: 500 },
                    dropShadow: { enabled: false }
                },
                plotOptions: {
                    pie: {
                        donut: {
                            size: '62%',
                            labels: {
                                show: true,
                                name: { show: true, fontSize: '12px', color: 'rgba(255,255,255,0.7)' },
                                value: { show: true, fontSize: '16px', fontWeight: 600, color: '#00d4ff', formatter: (val) => formatChartNumber(parseFloat(val)) },
                                total: { show: true, label: 'Total', fontSize: '11px', color: 'rgba(255,255,255,0.5)',
                                    formatter: (w) => formatChartNumber(w.globals.spikeWidth ? 0 : w.globals.series.reduce((a, b) => a + b, 0))
                                }
                            }
                        }
                    }
                },
                stroke: { width: 1, colors: ['rgba(0,0,0,0.2)'] }
            };
            break;

        default:
            return;
    }

    try {
        const chart = new ApexCharts(container, options);
        chart.render();
    } catch (e) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.75rem; padding: 20px; text-align: center;">Chart rendering failed</div>';
    }
}

function formatChartNumber(val) {
    if (val === null || val === undefined) return '';
    if (Math.abs(val) >= 1000000) return (val / 1000000).toFixed(1) + 'M';
    if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + 'K';
    return Number.isInteger(val) ? val.toString() : val.toFixed(1);
}

// ============================================
// FILE METADATA EDITOR
// ============================================

let fileMetadataWeightRules = [];
let fileMetadataVariables = [];

async function openFileMetadataModal(fileId) {
    const file = files.find(f => f.id === fileId);
    if (!file) return;

    document.getElementById('fileMetadataFileId').value = fileId;
    document.getElementById('fileMetadataDescription').value = file.description || file.Description || '';

    // Parse existing weight rules
    fileMetadataWeightRules = [];
    const wc = file.weightConfigJson || file.weight_config_json || file.WeightConfigJson;
    if (wc) {
        try {
            const parsed = JSON.parse(wc);
            if (parsed.rules) fileMetadataWeightRules = parsed.rules;
        } catch (e) { }
    }

    // Load variables for this file (for weight variable dropdown)
    try {
        const resp = await api.request(`/research/projects/${projectId}/files/${fileId}/variables`);
        fileMetadataVariables = resp.variables || [];
    } catch (e) {
        fileMetadataVariables = [];
    }

    renderWeightRules();
    document.getElementById('fileMetadataModal').classList.add('active');
}

let weightRuleDropdowns = [];

function renderWeightRules() {
    const container = document.getElementById('weightRulesContainer');
    if (!container) return;

    // Destroy previous SearchableDropdown instances
    weightRuleDropdowns.forEach(d => { try { d.destroy(); } catch(e) {} });
    weightRuleDropdowns = [];

    if (fileMetadataWeightRules.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">No weight rules configured.</p>';
        return;
    }

    const varOptions = fileMetadataVariables
        .filter(v => v.variableType !== 'string' && v.variable_type !== 'string')
        .map(v => {
            const name = v.variableName || v.variable_name;
            const label = v.variableLabel || v.variable_label || '';
            return { value: name, label: `${name}${label ? ' — ' + truncate(label, 30) : ''}` };
        });

    container.innerHTML = fileMetadataWeightRules.map((rule, i) => `
        <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 8px; background: var(--bg-secondary);">
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <input type="text" value="${escapeHtml(rule.name || '')}" placeholder="Rule name"
                    onchange="fileMetadataWeightRules[${i}].name = this.value"
                    style="flex: 1; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); font-size: 0.8rem;">
                <button type="button" onclick="removeWeightRule(${i})" style="color: var(--color-error); background: none; border: none; cursor: pointer; font-size: 0.8rem;">Remove</button>
            </div>
            <div id="weightVarDropdown_${i}" style="margin-bottom: 8px;"></div>
            <input type="text" value="${escapeHtml(rule.description || '')}" placeholder="Description (e.g., 'Apply for India respondents')"
                onchange="fileMetadataWeightRules[${i}].description = this.value"
                style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); font-size: 0.8rem;">
        </div>
    `).join('');

    // Initialize SearchableDropdown for each weight rule
    fileMetadataWeightRules.forEach((rule, i) => {
        const dropdownContainer = document.getElementById(`weightVarDropdown_${i}`);
        if (dropdownContainer && typeof SearchableDropdown !== 'undefined') {
            const dropdown = new SearchableDropdown(dropdownContainer, {
                options: varOptions,
                value: rule.weight_variable || null,
                placeholder: 'Select weight variable',
                searchPlaceholder: 'Search variables...',
                virtualScroll: varOptions.length > 50,
                compact: true,
                onChange: (value) => {
                    fileMetadataWeightRules[i].weight_variable = value;
                }
            });
            weightRuleDropdowns.push(dropdown);
        }
    });
}

function addWeightRule() {
    fileMetadataWeightRules.push({ name: '', weight_variable: '', conditions: {}, description: '' });
    renderWeightRules();
}

function removeWeightRule(index) {
    fileMetadataWeightRules.splice(index, 1);
    renderWeightRules();
}

async function saveFileMetadata() {
    const fileId = document.getElementById('fileMetadataFileId').value;
    const description = document.getElementById('fileMetadataDescription').value.trim();

    // Build weight_config JSON
    const validRules = fileMetadataWeightRules.filter(r => r.name && r.weight_variable);
    const weightConfigJson = validRules.length > 0 ? JSON.stringify({ rules: validRules }) : null;

    try {
        await api.request(`/research/projects/${projectId}/files/${fileId}/metadata`, {
            method: 'PUT',
            body: JSON.stringify({
                description: description || null,
                weightConfigJson: weightConfigJson
            })
        });

        Toast.success('File metadata saved.');
        closeModal('fileMetadataModal');

        // Update local file data
        const file = files.find(f => f.id === fileId);
        if (file) {
            file.description = description;
            file.weightConfigJson = weightConfigJson;
        }
    } catch (error) {
        console.error('Save file metadata failed:', error);
        Toast.error(error.message || 'Failed to save file metadata');
    }
}

// ============================================
// AI LOGS TAB
// ============================================

let aiLogsPage = 1;
const aiLogsPageSize = 20;

async function loadAiLogs(page) {
    if (page) aiLogsPage = page;

    const loadingEl = document.getElementById('aiLogsLoading');
    const contentEl = document.getElementById('aiLogsContent');
    const emptyEl = document.getElementById('aiLogsEmpty');
    const countEl = document.getElementById('aiLogsCount');
    const paginationEl = document.getElementById('aiLogsPagination');

    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'none';
    if (paginationEl) paginationEl.style.display = 'none';

    try {
        const response = await api.request(`/research/ai/chat/logs/${projectId}?page=${aiLogsPage}&pageSize=${aiLogsPageSize}`);
        const messages = response.data || [];
        const total = response.total || 0;

        if (loadingEl) loadingEl.style.display = 'none';

        if (messages.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }

        if (countEl) countEl.textContent = `${total} messages`;

        // Group messages into user/assistant pairs
        let html = '<div class="ai-logs-list">';
        for (const msg of messages) {
            const isUser = msg.role === 'user';
            const isAssistant = msg.role === 'assistant';
            const time = msg.created_at ? new Date(msg.created_at).toLocaleString() : '';

            html += `<div class="ai-log-entry" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 8px; background: var(--bg-secondary);">`;
            html += `<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">`;
            html += `<span class="status-badge ${isUser ? 'active' : 'ready'}" style="font-size: 0.7rem;">${escapeHtml(msg.role)}</span>`;
            html += `<span style="color: var(--text-secondary); font-size: 0.75rem;">${time}</span>`;
            html += `</div>`;

            // Content preview
            const preview = msg.content ? msg.content.substring(0, 200) : '';
            html += `<div style="color: var(--text-primary); font-size: 0.85rem; margin-bottom: 6px; white-space: pre-wrap; word-break: break-word;">${escapeHtml(preview)}${msg.content && msg.content.length > 200 ? '...' : ''}</div>`;

            // Metadata for assistant messages
            if (isAssistant) {
                const parts = [];
                if (msg.input_tokens || msg.output_tokens) parts.push(`Tokens: ${(msg.input_tokens || 0) + (msg.output_tokens || 0)}`);
                if (msg.model_used) parts.push(`Model: ${msg.model_used}`);
                if (parts.length > 0) {
                    html += `<div style="color: var(--text-secondary); font-size: 0.75rem;">${parts.join(' · ')}</div>`;
                }

                // Tool calls
                if (msg.tool_calls_json) {
                    try {
                        const toolCalls = JSON.parse(msg.tool_calls_json);
                        if (toolCalls.length > 0) {
                            html += `<details style="margin-top: 6px;"><summary style="color: var(--brand-primary); cursor: pointer; font-size: 0.8rem;">Tool calls (${toolCalls.length})</summary>`;
                            html += `<div style="margin-top: 4px; padding: 8px; background: var(--bg-tertiary); border-radius: 6px; font-size: 0.75rem; font-family: monospace; max-height: 300px; overflow: auto;">`;
                            for (const tc of toolCalls) {
                                html += `<div style="margin-bottom: 6px;">`;
                                html += `<strong>Round ${tc.round}: ${escapeHtml(tc.tool)}</strong> ${tc.success ? '<span style="color:var(--color-success);">OK</span>' : '<span style="color:var(--color-error);">FAIL</span>'}`;
                                if (tc.tool === 'execute_query') {
                                    try {
                                        const input = JSON.parse(tc.input);
                                        if (input.sql) html += `<div style="color: var(--text-secondary); margin-top: 2px;">SQL: ${escapeHtml(input.sql.substring(0, 200))}</div>`;
                                    } catch (e) {}
                                }
                                html += `</div>`;
                            }
                            html += `</div></details>`;
                        }
                    } catch (e) {}
                }
            }

            html += `</div>`;
        }
        html += '</div>';
        if (contentEl) contentEl.innerHTML = html;

        // Pagination
        const totalPages = Math.ceil(total / aiLogsPageSize);
        if (totalPages > 1 && paginationEl) {
            paginationEl.style.display = 'flex';
            let pagHtml = '';
            if (aiLogsPage > 1) pagHtml += `<button class="btn btn-secondary" onclick="loadAiLogs(${aiLogsPage - 1})" style="font-size:0.8rem;">Prev</button>`;
            pagHtml += `<span style="color: var(--text-secondary); font-size: 0.85rem; padding: 4px 8px;">Page ${aiLogsPage} of ${totalPages}</span>`;
            if (aiLogsPage < totalPages) pagHtml += `<button class="btn btn-secondary" onclick="loadAiLogs(${aiLogsPage + 1})" style="font-size:0.8rem;">Next</button>`;
            paginationEl.innerHTML = pagHtml;
        }
    } catch (error) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.innerHTML = `<div class="query-error">Failed to load AI logs: ${escapeHtml(error.message)}</div>`;
        console.error('Failed to load AI logs:', error);
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        return dateStr;
    }
}

function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return Number(num).toLocaleString();
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatCellValue(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function truncate(str, maxLen) {
    if (!str) return '';
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
}

function showPageError(message) {
    document.getElementById('pageLoading').innerHTML = `
        <div class="query-error">${escapeHtml(message)}</div>
    `;
}
