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

// Functions tab state
let fnFunctions = [];     // cached function metadata from backend
let fnLoaded = false;
let fnBlocks = [];         // { id, fnName }
let fnBlockIdCounter = 0;
const fnBlockDropdowns = new Map(); // blockId -> SearchableDropdown instance

// Questions tab state
let questionsData = [];    // raw question groups from API
let questionsLoaded = false;
let filteredQuestions = [];

// Variables pagination state
let varCurrentPage = 1;
let varPageSize = 50;
let varFilteredVars = [];

// Questions pagination state
let qCurrentPage = 1;
let qPageSize = 50;

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
    setupSidebar();

    // Keyboard shortcut: Ctrl+Enter to run query or function
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const sqlEditor = document.getElementById('sqlEditor');
            const fnEditor = document.getElementById('fnEditor');
            if (document.activeElement === fnEditor || activeTab === 'functions') {
                e.preventDefault();
                executeFn();
                return;
            }
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
        document.getElementById('projectContent').style.display = 'flex';

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
        const response = await api.request(`/research/projects/${projectId}/files`, { _skipSpinner: true });
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

    // Desktop table (hidden on mobile via CSS)
    let tableHtml = `
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
        tableHtml += renderFileRow(file);
    }

    tableHtml += `
                </tbody>
            </table>
        </div>
    `;

    // Mobile cards (hidden on desktop, shown on mobile via CSS)
    const cardsHtml = `
        <div class="files-cards-mobile">
            ${files.map(f => renderFileCard(f)).join('')}
        </div>
    `;

    contentEl.innerHTML = tableHtml + cardsHtml;
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

function renderFileCard(file) {
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
    const isProcessing = ['uploading', 'parsing', 'loading_data'].includes(status);

    return `
        <div class="file-card" id="file-card-${fileId}" data-file-id="${fileId}" data-status="${status}">
            <div class="file-card-header">
                <div class="file-card-name">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    ${escapeHtml(fileName)}
                </div>
                <span class="status-badge ${status}">${displayStatus}${timeInfo}</span>
            </div>
            <div class="file-card-meta">
                <span>${fileSize}</span>
                ${status === 'ready' ? `<span>${formatNumber(variableCount)} vars</span>` : ''}
                ${status === 'ready' ? `<span>${formatNumber(rowCount)} rows</span>` : ''}
                ${uploadedAt ? `<span>${formatDate(uploadedAt)}</span>` : ''}
            </div>
            <div class="file-card-actions">
                ${status === 'ready' ? `<button class="btn-icon" onclick="openFileMetadataModal('${fileId}')" title="Edit file context & weights" style="color: var(--text-secondary);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>` : ''}
                <button class="btn-icon-danger" onclick="deleteFile('${fileId}', '${escapeHtml(fileName)}')" title="${isProcessing ? 'Cannot delete while processing' : 'Delete file'}"${isProcessing ? ' disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
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
            fileProgressConnection = null;

            // Start fallback polling for any files still actively processing
            const activeIds = Object.keys(activeProgressFiles);
            if (activeIds.length > 0) {
                console.log(`[FileProgress] Starting fallback polling for ${activeIds.length} active file(s)`);
                for (const fileId of activeIds) {
                    startPollingFile(fileId);
                }
            }
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
            const displaySt = status === 'loading_data' ? 'loading data'
                             : status === 'grouping' ? 'grouping variables'
                             : status === 'embedding' ? 'generating embeddings'
                             : status;
            if (statusCell) {
                statusCell.innerHTML = `<span class="status-badge ${status}">${displaySt}</span>`;
            }
            row.setAttribute('data-status', status);
        }
    }
}

async function refreshFileRow(fileId) {
    try {
        const file = await api.request(`/research/projects/${projectId}/files/${fileId}`, { _skipSpinner: true });
        updateFileRowStatus(file);
    } catch (e) {
        console.warn('Failed to refresh file row:', e);
    }
}

function startFilePolling() {
    // Clear existing pollers
    Object.values(fileStatusPollers).forEach(id => clearInterval(id));
    fileStatusPollers = {};

    const processingFiles = files.filter(f => ['uploading', 'parsing', 'loading_data', 'grouping', 'embedding'].includes(f.status));
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
            const file = await api.request(`/research/projects/${projectId}/files/${fileId}`, { _skipSpinner: true });
            updateFileRowStatus(file);

            // Update progress panel for in-progress states
            if (activeProgressFiles[fileId] && !['ready', 'failed'].includes(file.status)) {
                const statusMsg = file.status === 'loading_data' ? `Loaded ${(file.row_count || 0).toLocaleString()} rows` :
                                  file.status === 'parsing' ? 'Parsing file...' :
                                  file.status === 'grouping' ? 'Grouping variables...' :
                                  file.status === 'embedding' ? 'Generating embeddings...' : 'Processing...';
                updateProgressPanelItem(fileId, {
                    status: file.status,
                    message: statusMsg,
                    rows_loaded: file.row_count || 0,
                    elapsed_ms: file.processing_time_ms || 0
                });
            }

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
    } else if (status === 'grouping') {
        barWidth = '80%';
    } else if (status === 'embedding') {
        barWidth = '90%';
    }

    const isIndeterminate = (status === 'queued' || status === 'parsing' || status === 'grouping' || status === 'embedding' || (status === 'loading_data' && rowsLoaded === 0));

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
        const response = await api.request(`/research/projects/${projectId}`, { _skipSpinner: true });
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

    // Update sidebar buttons
    document.querySelectorAll('#researchSidebar .sidebar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update active tab title
    const nameEl = document.getElementById('activeTabName');
    const tabDisplayNames = { files:'Files', variables:'Variables', questions:'Questions', query:'Query', functions:'Functions', ailogs:'AI Logs' };
    if (nameEl && tabDisplayNames[tabName]) nameEl.textContent = tabDisplayNames[tabName];

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}Tab`);
    });

    // Lazy-load data on first tab click
    if (tabName === 'variables') {
        if (!variablesLoaded) loadVariables();
        if (aiAvailable === null) checkAiAvailability();
    }
    if (tabName === 'questions') {
        if (!questionsLoaded) {
            populateQuestionFileFilter();
            loadQuestions();
        }
    }
    if (tabName === 'query') {
        updateAvailableTables();
    }
    if (tabName === 'functions') {
        if (!fnLoaded) loadFunctions();
        updateFnFileSelector();
    }
    if (tabName === 'ailogs') {
        if (!document.getElementById('aiLogsContent').innerHTML) loadAiLogs();
        if (!eaLoaded) loadEmbedAnalytics('');
        updateAiLogsBadges();
    }
}

// ============================================
// ACTIONS DROPDOWN
// ============================================

function toggleActionsDropdown() {
    const trigger = document.getElementById('actionsTrigger');
    const menu = document.getElementById('actionsMenu');
    if (!trigger || !menu) return;
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
        closeActionsDropdown();
    } else {
        trigger.classList.add('open');
        menu.classList.add('open');
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeActionsOnOutsideClick);
        }, 0);
    }
}

function closeActionsDropdown() {
    const trigger = document.getElementById('actionsTrigger');
    const menu = document.getElementById('actionsMenu');
    trigger?.classList.remove('open');
    menu?.classList.remove('open');
    document.removeEventListener('click', closeActionsOnOutsideClick);
}

function closeActionsOnOutsideClick(e) {
    const dropdown = document.getElementById('projectActionsDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        closeActionsDropdown();
    }
}

// ============================================
// QUESTION ACTIONS DROPDOWN
// ============================================

function toggleQuestionActionsDropdown() {
    const trigger = document.querySelector('.question-actions-trigger');
    const menu = document.getElementById('questionActionsMenu');
    if (!trigger || !menu) return;
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
        closeQuestionActionsDropdown();
    } else {
        trigger.classList.add('open');
        menu.classList.add('open');
        setTimeout(() => {
            document.addEventListener('click', closeQuestionActionsOnOutsideClick);
        }, 0);
    }
}

function closeQuestionActionsDropdown() {
    const trigger = document.querySelector('.question-actions-trigger');
    const menu = document.getElementById('questionActionsMenu');
    trigger?.classList.remove('open');
    menu?.classList.remove('open');
    document.removeEventListener('click', closeQuestionActionsOnOutsideClick);
}

function closeQuestionActionsOnOutsideClick(e) {
    const dropdown = document.getElementById('questionActionsDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        closeQuestionActionsDropdown();
    }
}

async function regenerateQuestions() {
    const fileId = getQuestionFileFilterValue();
    if (!fileId) { Toast.error('No file selected'); return; }

    const confirmed = await Confirm.show({
        title: 'Regenerate Questions',
        message: 'This will regenerate all question groupings and embeddings for this file. Any manual edits will be lost.',
        type: 'warning',
        confirmText: 'Regenerate',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    Toast.info('Regenerating question groupings...');
    try {
        const resp = await api.request(`/research/projects/${projectId}/files/${fileId}/regroup`, {
            method: 'POST'
        });
        if (resp.success) {
            Toast.success(resp.message || 'Questions regenerated successfully');
            questionsLoaded = false;
            await loadQuestions();
        } else {
            Toast.error(resp.message || 'Regrouping failed');
        }
    } catch (err) {
        Toast.error('Failed to regenerate: ' + (err.message || err));
    }
}

function downloadQuestionsJson() {
    if (!questionsData || questionsData.length === 0) {
        Toast.error('No questions to download');
        return;
    }
    const blob = new Blob([JSON.stringify(questionsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    let fileName = 'questions';
    if (questionFileDropdown) {
        const fileId = questionFileDropdown.getValue();
        const opt = questionFileDropdown.options.find(o => String(o.value) === String(fileId));
        if (opt) fileName = opt.label;
    } else {
        const fileSelect = document.getElementById('questionFileFilter');
        fileName = fileSelect?.options[fileSelect.selectedIndex]?.text || 'questions';
    }
    a.href = url;
    a.download = `${fileName.replace(/\.[^.]+$/, '')}_questions.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function uploadQuestionsJson() {
    const fileId = getQuestionFileFilterValue();
    if (!fileId) { Toast.error('No file selected'); return; }
    document.getElementById('questionJsonUpload').click();
}

async function handleQuestionJsonUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset input so same file can be re-uploaded
    event.target.value = '';

    const fileId = getQuestionFileFilterValue();
    if (!fileId) { Toast.error('No file selected'); return; }

    let parsed;
    try {
        const text = await file.text();
        parsed = JSON.parse(text);
    } catch (e) {
        Toast.error('Invalid JSON file: ' + e.message);
        return;
    }

    // Client-side pre-validation
    if (!Array.isArray(parsed) || parsed.length === 0) {
        Toast.error('JSON must be a non-empty array of questions');
        return;
    }
    const clientErrors = [];
    for (let i = 0; i < parsed.length; i++) {
        const q = parsed[i];
        if (!q.question_id) clientErrors.push(`Question[${i}]: missing question_id`);
        if (!q.variable_names || !Array.isArray(q.variable_names) || q.variable_names.length === 0)
            clientErrors.push(`Question[${i}]: must have at least 1 variable_name`);
    }
    if (clientErrors.length > 0) {
        Toast.error('Validation errors:\n' + clientErrors.join('\n'));
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Upload Question Groupings',
        message: 'This will replace all current question groupings with the uploaded JSON. This cannot be undone.',
        type: 'warning',
        confirmText: 'Upload & Replace',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    // Backend uses snake_case_lower JSON policy, so send as-is (download format is already snake_case)
    // Just strip _fileName if present and ensure shared_value_labels is a string
    const questions = parsed.map(q => {
        const obj = {
            question_id: q.question_id,
            question_label: q.question_label || '',
            question_type: q.question_type || 'single',
            variable_names: q.variable_names || [],
            attribute_labels: q.attribute_labels || [],
        };
        if (q.shared_value_labels) {
            obj.shared_value_labels = typeof q.shared_value_labels === 'string' ? q.shared_value_labels : JSON.stringify(q.shared_value_labels);
        }
        if (q.variable_attribute_map) {
            obj.variable_attribute_map = q.variable_attribute_map;
        }
        return obj;
    });

    Toast.info('Uploading question groupings...');
    try {
        const resp = await api.request(`/research/projects/${projectId}/files/${fileId}/upload-questions`, {
            method: 'POST',
            body: JSON.stringify({ questions: questions })
        });
        if (resp.success) {
            Toast.success(resp.message || 'Questions uploaded successfully');
            questionsLoaded = false;
            await loadQuestions();
        } else {
            const errMsg = resp.errors ? resp.errors.join('\n') : (resp.message || 'Upload failed');
            Toast.error(errMsg);
        }
    } catch (err) {
        const errData = err.data || err;
        const errMsg = errData.errors ? errData.errors.join('\n') : (err.message || 'Upload failed');
        Toast.error('Failed to upload: ' + errMsg);
    }
}

// ============================================
// COLLAPSIBLE SIDEBAR NAVIGATION
// ============================================

function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('researchSidebar');
    const container = document.querySelector('.research-container');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    // Desktop: open by default; Mobile/Tablet: closed
    if (window.innerWidth > 1024) {
        toggle.classList.add('active');
        sidebar.classList.add('open');
        container?.classList.add('sidebar-open');
    } else {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
        overlay?.classList.remove('active');
    }

    // Toggle button click
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
        if (window.innerWidth <= 1024) {
            overlay?.classList.toggle('active');
        }
    });

    // Overlay click (mobile close)
    overlay?.addEventListener('click', () => {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
        overlay?.classList.remove('active');
    });

    // Sidebar button clicks → call switchTab + on mobile close sidebar
    document.querySelectorAll('#researchSidebar .sidebar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
            // On mobile, close sidebar after selection
            if (window.innerWidth <= 1024) {
                toggle.classList.remove('active');
                sidebar.classList.remove('open');
                container?.classList.remove('sidebar-open');
                overlay?.classList.remove('active');
            }
        });
    });

    // Escape key closes sidebar
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
            overlay?.classList.remove('active');
        }
    });

    // Sync overlay state on resize (desktop↔mobile transitions)
    window.addEventListener('resize', () => {
        if (sidebar.classList.contains('open')) {
            if (window.innerWidth <= 1024) {
                overlay?.classList.add('active');
            } else {
                overlay?.classList.remove('active');
            }
        }
    });
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
let questionFileDropdown = null;
let questionTypeDropdown = null;
let eaEmbedKeyDropdown = null;
let fnFileDropdown = null;

function populateFileFilter() {
    const select = document.getElementById('variableFileFilter');
    select.innerHTML = '';

    for (const fileGroup of allVariables) {
        const opt = document.createElement('option');
        opt.value = fileGroup.fileId;
        opt.textContent = fileGroup.fileName;
        select.appendChild(opt);
    }

    // Auto-select the first file
    if (allVariables.length > 0) {
        select.value = allVariables[0].fileId;
    }

    // Convert to searchable dropdown
    if (typeof convertSelectToSearchable === 'function') {
        if (fileFilterDropdown) fileFilterDropdown.destroy();
        fileFilterDropdown = convertSelectToSearchable('variableFileFilter', {
            placeholder: 'Select file...',
            searchPlaceholder: 'Search files...',
            onChange: () => filterVariables()
        });
        // Set the first file in the searchable dropdown too
        if (allVariables.length > 0) {
            fileFilterDropdown.setValue(allVariables[0].fileId);
        }
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
                    <th style="width:28px;"></th>
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
                        const isString = varType === 'string';
                        return `<tr>
                            <td style="padding:4px;">
                                <div class="var-ctx-wrapper">
                                    <button class="var-ctx-btn" onclick="toggleVarCtxMenu(event, ${rowIdx})" title="Actions">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                                    </button>
                                    <div class="var-ctx-menu" id="varCtx_${rowIdx}">
                                        <button class="var-ctx-menu-item" onclick="copyVarName('${escapeHtml(varName)}')">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                            Copy Name
                                        </button>
                                        <button class="var-ctx-menu-item" onclick="runVarFrequency(${rowIdx})">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="12" width="4" height="9"/><rect x="10" y="6" width="4" height="15"/><rect x="17" y="2" width="4" height="19"/></svg>
                                            Frequency
                                        </button>
                                        ${!isString ? `<button class="var-ctx-menu-item" onclick="runVarDescriptive(${rowIdx})">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="13" y2="12"/><line x1="7" y1="16" x2="10" y2="16"/></svg>
                                            Descriptive Stats
                                        </button>` : ''}
                                    </div>
                                </div>
                            </td>
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
    const isString = varType === 'string';

    return `
        <div class="variable-card">
            <div class="variable-card-header">
                <span class="variable-name">${escapeHtml(varName)}</span>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span class="type-badge ${escapeHtml(varType)}">${escapeHtml(varType)}</span>
                    <div class="var-ctx-wrapper">
                        <button class="var-ctx-btn" onclick="toggleVarCtxMenu(event, ${globalIdx})" title="Actions">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                        </button>
                        <div class="var-ctx-menu" id="varCtxCard_${globalIdx}">
                            <button class="var-ctx-menu-item" onclick="copyVarName('${escapeHtml(varName)}')">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                Copy Name
                            </button>
                            <button class="var-ctx-menu-item" onclick="runVarFrequency(${globalIdx})">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="12" width="4" height="9"/><rect x="10" y="6" width="4" height="15"/><rect x="17" y="2" width="4" height="19"/></svg>
                                Frequency
                            </button>
                            ${!isString ? `<button class="var-ctx-menu-item" onclick="runVarDescriptive(${globalIdx})">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="13" y2="12"/><line x1="7" y1="16" x2="10" y2="16"/></svg>
                                Descriptive Stats
                            </button>` : ''}
                        </div>
                    </div>
                </div>
            </div>
            ${varLabel ? `<div class="variable-label">${escapeHtml(varLabel)}</div>` : ''}
            <div class="variable-meta">
                ${measurementType ? `<span class="measurement-badge">${escapeHtml(measurementType)}</span>` : ''}
            </div>
            ${vlCount > 0 ? `<button class="value-labels-link" onclick="openVarPanel(${globalIdx})" style="margin-top:8px;">Value labels (${vlCount})</button>` : ''}
        </div>
    `;
}

// ── Variable context menu handlers ──

function toggleVarCtxMenu(event, rowIdx) {
    event.stopPropagation();
    // Close any open menu first and restore portaled menus
    document.querySelectorAll('.var-ctx-menu.open').forEach(m => {
        m.classList.remove('open');
        if (m._origParent) {
            m._origParent.appendChild(m);
            m.style.cssText = '';
            delete m._origParent;
        }
    });
    const menu = document.getElementById(`varCtx_${rowIdx}`) || document.getElementById(`varCtxCard_${rowIdx}`);
    if (!menu) return;

    // On mobile, portal menu to body to escape overflow clip + backdrop-filter containing block
    if (window.innerWidth <= 768) {
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        menu._origParent = menu.parentElement;
        document.body.appendChild(menu);
        menu.style.position = 'fixed';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.style.left = 'auto';
        menu.style.zIndex = '10000';
    }

    menu.classList.add('open');
    // Close on outside click
    setTimeout(() => {
        const closer = (e) => {
            if (!menu.contains(e.target)) {
                menu.classList.remove('open');
                if (menu._origParent) {
                    menu._origParent.appendChild(menu);
                    menu.style.cssText = '';
                    delete menu._origParent;
                }
                document.removeEventListener('click', closer);
            }
        };
        document.addEventListener('click', closer);
    }, 0);
}

function copyVarName(name) {
    document.querySelectorAll('.var-ctx-menu.open').forEach(m => m.classList.remove('open'));
    navigator.clipboard.writeText(name).then(() => {
        Toast.success(`Copied "${name}" to clipboard`);
    }).catch(() => {
        Toast.error('Failed to copy to clipboard');
    });
}

async function runVarFrequency(rowIdx) {
    document.querySelectorAll('.var-ctx-menu.open').forEach(m => m.classList.remove('open'));
    const v = varFilteredVars[rowIdx];
    if (!v) return;
    const varName = v.variableName || v.variable_name || '';
    const varLabel = v.variableLabel || v.variable_label || '';
    const fileId = v._fileId;
    await _executeVarFunction('frequency', varName, fileId, varLabel);
}

async function runVarDescriptive(rowIdx) {
    document.querySelectorAll('.var-ctx-menu.open').forEach(m => m.classList.remove('open'));
    const v = varFilteredVars[rowIdx];
    if (!v) return;
    const varName = v.variableName || v.variable_name || '';
    const varLabel = v.variableLabel || v.variable_label || '';
    const fileId = v._fileId;
    await _executeVarFunction('descriptive_stats', varName, fileId, varLabel);
}

async function _executeVarFunction(funcName, varName, fileId, varLabel) {
    const payload = {
        file_id: fileId,
        function_name: funcName,
        input_params: { variable: varName }
    };

    // Show popup immediately with loading spinner (appended, not replacing)
    const container = document.getElementById('fnResultsContent');
    if (container) {
        // Add separator if there's existing content
        if (container.children.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'fn-result-separator';
            sep.style.cssText = 'height: 3px; background: var(--border-color, #334155); margin: 0;';
            container.appendChild(sep);
        }
        const spinnerDiv = document.createElement('div');
        spinnerDiv.className = 'fn-loading-spinner';
        spinnerDiv.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px;';
        spinnerDiv.innerHTML = `
            <div class="spinner" style="width:32px;height:32px;border-width:3px;"></div>
            <div style="font-size:0.85rem;color:var(--text-secondary);">Running ${escapeHtml(funcName.replace(/_/g, ' '))} for <strong>${escapeHtml(varName)}</strong>...</div>`;
        container.appendChild(spinnerDiv);
        spinnerDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const infoEl = document.getElementById('fnPopupInfo');
    if (infoEl) infoEl.textContent = '';
    showFnPopup(0, 0);

    try {
        const baseUrl = api._getBaseUrl('/research/');
        const token = api.token || getAuthToken();
        const fetchResponse = await fetch(`${baseUrl}/projects/${projectId}/functions/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const response = await fetchResponse.json();

        if (!fetchResponse.ok || response.success === false) {
            renderFnError(response.error || response.message || 'Function execution failed');
            showFnPopup(0, 0);
            return;
        }

        const execTime = response.execution_time_ms ?? 0;
        const rowCount = response.rows ? response.rows.length : 0;

        renderFnResults(response, funcName, varName, varLabel);
        showFnPopup(execTime, rowCount);
    } catch (error) {
        renderFnError(`Request failed: ${error.message}`);
        showFnPopup(0, 0);
        console.error(`${funcName} execution failed:`, error);
    }
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

        resultsDiv.style.display = 'flex';

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
// COPY QUERY RESULTS (Tab-separated for Excel)
// ============================================

function copyQueryResults() {
    if (!queryResultsData || !queryResultsData.columns || !queryResultsData.rows.length) {
        Toast.warning('No results to copy.');
        return;
    }

    const { columns, rows } = queryResultsData;
    const lines = [];

    // Header row
    lines.push(columns.join('\t'));

    // Data rows
    const displayRows = rows.slice(0, 1000);
    for (const row of displayRows) {
        if (Array.isArray(row)) {
            lines.push(row.map(cell => formatCellValue(cell)).join('\t'));
        } else if (typeof row === 'object' && row !== null) {
            lines.push(columns.map(col => formatCellValue(row[col])).join('\t'));
        }
    }

    const tsv = lines.join('\n');

    navigator.clipboard.writeText(tsv).then(() => {
        const btn = document.querySelector('.query-copy-btn');
        if (btn) {
            const originalHtml = btn.innerHTML;
            btn.classList.add('copied');
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px;">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Copied!
            `;
            setTimeout(() => {
                btn.classList.remove('copied');
                btn.innerHTML = originalHtml;
            }, 2000);
        }
        Toast.success(`Copied ${formatNumber(displayRows.length)} rows to clipboard`);
    }).catch(() => {
        Toast.error('Failed to copy to clipboard');
    });
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
        const response = await api.request('/research/ai/status', { _skipSpinner: true });
        aiAvailable = response.available === true;
    } catch (error) {
        console.warn('AI availability check failed:', error);
        aiAvailable = false;
    }

    const btn = document.getElementById('aiChatToggleBtn');
    if (btn) {
        btn.style.display = aiAvailable ? 'inline-flex' : 'none';
    }

    // Show/hide Embed button based on AI availability (requires LLM API key)
    const embedBtn = document.getElementById('embedSettingsBtn');
    if (embedBtn) {
        embedBtn.style.display = aiAvailable ? 'inline-flex' : 'none';
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
            updateTypingIndicator(data.tools_called, data.step_description, data.round);
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
            }),
            _skipSpinner: true
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

function updateTypingIndicator(toolsCalled, stepDescription, round) {
    const indicator = document.getElementById('aiTypingIndicator');
    if (!indicator) return;

    let statusText;
    if (stepDescription) {
        // Use the agentic step description from the backend
        statusText = stepDescription;
        if (round > 0) statusText = `Step ${round}: ${statusText}`;
    } else if (toolsCalled && toolsCalled.length > 0) {
        const toolLabels = {
            'execute_query': 'Running query',
            'execute_function': 'Running analysis',
            'search_questions': 'Searching questions',
            'get_variable_details': 'Looking up metadata',
            'create_visualization': 'Creating chart'
        };
        statusText = toolsCalled.map(t => toolLabels[t] || t).join(', ');
    } else {
        statusText = 'Analyzing data';
    }

    indicator.innerHTML = `<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span> ${statusText}`;
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
                console.log(`[AI Chart ${idx}]`, JSON.stringify(charts[idx]).substring(0, 1500));
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
    const { chart_type, categories, series, points } = chartData;
    // scatter/bubble/treemap use 'points' instead of categories/series
    const usesPoints = ['scatter_chart', 'bubble_chart', 'treemap_chart'].includes(chart_type);
    if (!usesPoints && (!categories || !series || series.length === 0)) return;
    if (usesPoints && (!points || points.length === 0) && (!series || series.length === 0)) return;

    const colors = AI_CHART_COLORS.slice(0, Math.max((series||[]).length, (categories||[]).length, (points||[]).length));

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

        case 'scatter_chart': {
            const pts = chartData.points || [];
            const scatterSeries = pts.map(s => ({
                name: s.name,
                data: (s.data || []).map(p => ({ x: p.x, y: p.y, meta: p.label || '' }))
            }));
            const scatterColors = pts.map(s => s.color || '#00d4ff');
            const ann = chartData.annotations || {};
            const annOpts = { xaxis: [], yaxis: [] };
            if (ann.x_line != null) {
                annOpts.xaxis.push({
                    x: ann.x_line,
                    strokeDashArray: 4,
                    borderColor: 'rgba(255,255,255,0.25)',
                    label: { text: 'Mean', style: { color: '#fff', background: 'rgba(0,0,0,0.5)', fontSize: '10px', padding: { left: 4, right: 4, top: 2, bottom: 2 } }, position: 'top' }
                });
            }
            if (ann.y_line != null) {
                annOpts.yaxis.push({
                    y: ann.y_line,
                    strokeDashArray: 4,
                    borderColor: 'rgba(255,255,255,0.25)',
                    label: { text: 'Mean', style: { color: '#fff', background: 'rgba(0,0,0,0.5)', fontSize: '10px', padding: { left: 4, right: 4, top: 2, bottom: 2 } }, position: 'left' }
                });
            }
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'scatter', height: 380, zoom: { enabled: false } },
                series: scatterSeries,
                colors: scatterColors,
                markers: { size: 8, strokeWidth: 1, strokeColors: 'rgba(0,0,0,0.3)', hover: { size: 11 } },
                xaxis: {
                    type: 'numeric',
                    title: { text: chartData.x_label || '', style: { color: 'rgba(255,255,255,0.5)', fontSize: '11px' } },
                    labels: { style: { fontSize: '10px' }, formatter: (v) => Number(v).toFixed(1) },
                    tickAmount: 6
                },
                yaxis: {
                    title: { text: chartData.y_label || '', style: { color: 'rgba(255,255,255,0.5)', fontSize: '11px' } },
                    labels: { style: { fontSize: '10px' }, formatter: (v) => Number(v).toFixed(1) }
                },
                annotations: annOpts,
                tooltip: {
                    theme: 'dark',
                    custom: function({ series, seriesIndex, dataPointIndex, w }) {
                        const pt = w.config.series[seriesIndex].data[dataPointIndex];
                        const sName = w.config.series[seriesIndex].name || '';
                        const lbl = pt.meta || '';
                        return `<div style="padding:8px 12px;font-size:0.78rem;line-height:1.6;background:#1e293b;color:#e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.35);">` +
                            `<strong>${lbl || sName}</strong><br>` +
                            `${chartData.x_label || 'X'}: ${Number(pt.x).toFixed(1)}<br>` +
                            `${chartData.y_label || 'Y'}: ${Number(pt.y).toFixed(1)}<br>` +
                            `<span style="color:${scatterColors[seriesIndex] || '#00d4ff'}">${sName}</span></div>`;
                    }
                },
                legend: { ...baseOptions.legend, position: 'bottom', fontSize: '11px' },
                grid: { ...baseOptions.grid, xaxis: { lines: { show: true } } }
            };
            break;
        }

        case 'bubble_chart': {
            const bPts = chartData.points || [];
            const bubbleSeries = bPts.map(s => ({
                name: s.name,
                data: (s.data || []).map(p => [p.x, p.y, p.z || 10])
            }));
            const bubbleColors = bPts.map(s => s.color || '#00d4ff');
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'bubble', height: 380, zoom: { enabled: false } },
                series: bubbleSeries,
                colors: bubbleColors.length ? bubbleColors : colors,
                fill: { opacity: 0.7 },
                xaxis: {
                    type: 'numeric',
                    title: { text: chartData.x_label || '', style: { color: 'rgba(255,255,255,0.5)', fontSize: '11px' } },
                    labels: { style: { fontSize: '10px' } },
                    tickAmount: 6
                },
                yaxis: {
                    title: { text: chartData.y_label || '', style: { color: 'rgba(255,255,255,0.5)', fontSize: '11px' } },
                    labels: { style: { fontSize: '10px' } }
                },
                tooltip: { theme: 'dark', style: { fontSize: '11px' } }
            };
            break;
        }

        case 'radar_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'radar', height: 380 },
                series: series.map(s => ({ name: s.name, data: s.data })),
                xaxis: {
                    categories: categories,
                    labels: { style: { fontSize: '10px', colors: Array(categories.length).fill('rgba(255,255,255,0.65)') } }
                },
                yaxis: { show: false },
                stroke: { width: 2 },
                fill: { opacity: 0.15 },
                markers: { size: 4, strokeWidth: 0, hover: { size: 6 } },
                plotOptions: {
                    radar: {
                        polygons: {
                            strokeColors: 'rgba(255,255,255,0.08)',
                            connectorColors: 'rgba(255,255,255,0.08)',
                            fill: { colors: ['transparent'] }
                        }
                    }
                }
            };
            break;

        case 'heatmap_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'heatmap', height: Math.max(280, (series.length || 5) * 38) },
                series: series.map(s => ({ name: s.name, data: s.data.map((v, i) => ({ x: categories[i] || `Col ${i+1}`, y: v })) })),
                plotOptions: {
                    heatmap: {
                        radius: 2,
                        enableShades: true,
                        shadeIntensity: 0.5,
                        colorScale: {
                            ranges: [
                                { from: -Infinity, to: 0, color: '#ef4444', name: 'Low' },
                                { from: 0, to: 50, color: '#f59e0b', name: 'Medium' },
                                { from: 50, to: Infinity, color: '#22c55e', name: 'High' }
                            ]
                        }
                    }
                },
                dataLabels: {
                    enabled: true,
                    style: { fontSize: '10px', colors: ['#fff'] }
                },
                xaxis: { labels: { style: { fontSize: '10px' } } },
                yaxis: { labels: { style: { fontSize: '10px' } } },
                stroke: { width: 1, colors: ['rgba(0,0,0,0.15)'] }
            };
            break;

        case 'treemap_chart': {
            const tmPts = chartData.points || [];
            const tmSeries = tmPts.length > 0
                ? tmPts.map(s => ({ name: s.name, data: (s.data || []).map(p => ({ x: p.label || p.x, y: p.y })) }))
                : (series.length > 0 ? [{ data: categories.map((c, i) => ({ x: c, y: series[0].data[i] || 0 })) }] : []);
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'treemap', height: 340 },
                series: tmSeries,
                plotOptions: {
                    treemap: {
                        enableShades: true,
                        shadeIntensity: 0.3,
                        distributed: tmSeries.length <= 1,
                        colorScale: { ranges: [] }
                    }
                },
                dataLabels: {
                    enabled: true,
                    style: { fontSize: '11px' },
                    formatter: (text, op) => [text, formatChartNumber(op.value)],
                    offsetY: -2
                }
            };
            break;
        }

        case 'radialBar_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'radialBar', height: 340 },
                series: series.length > 0 ? series[0].data : [],
                labels: categories,
                plotOptions: {
                    radialBar: {
                        hollow: { size: categories.length > 3 ? '30%' : '45%' },
                        track: { background: 'rgba(255,255,255,0.06)', strokeWidth: '100%' },
                        dataLabels: {
                            name: { fontSize: '12px', color: 'rgba(255,255,255,0.7)', offsetY: -10 },
                            value: { fontSize: '18px', fontWeight: 600, color: '#00d4ff', formatter: (val) => Math.round(val) + '%' },
                            total: {
                                show: categories.length > 1,
                                label: 'Average',
                                fontSize: '11px',
                                color: 'rgba(255,255,255,0.5)',
                                formatter: (w) => Math.round(w.globals.series.reduce((a, b) => a + b, 0) / w.globals.series.length) + '%'
                            }
                        }
                    }
                },
                stroke: { lineCap: 'round' }
            };
            break;

        case 'polarArea_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'polarArea', height: 340 },
                series: series.length > 0 ? series[0].data : [],
                labels: categories,
                fill: { opacity: 0.8 },
                stroke: { width: 1, colors: ['rgba(0,0,0,0.2)'] },
                plotOptions: { polarArea: { rings: { strokeWidth: 1, strokeColor: 'rgba(255,255,255,0.08)' }, spokes: { strokeWidth: 1, connectorColors: 'rgba(255,255,255,0.08)' } } },
                yaxis: { show: false },
                dataLabels: {
                    enabled: true,
                    formatter: (val) => Math.round(val) + '%',
                    style: { fontSize: '10px' },
                    dropShadow: { enabled: false }
                }
            };
            break;

        case 'boxPlot_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'boxPlot', height: 340 },
                series: series.map(s => ({
                    name: s.name || 'Distribution',
                    type: 'boxPlot',
                    data: s.data.map((d, i) => ({
                        x: categories[i] || `Group ${i + 1}`,
                        y: Array.isArray(d) ? d : [d, d, d, d, d]
                    }))
                })),
                plotOptions: {
                    boxPlot: {
                        colors: { upper: '#00d4ff', lower: '#22c55e' }
                    }
                },
                xaxis: { labels: { style: { fontSize: '10px' } } },
                yaxis: { labels: { style: { fontSize: '10px' } } }
            };
            break;

        case 'area_chart':
            options = {
                ...baseOptions,
                chart: { ...baseOptions.chart, type: 'area', height: 320 },
                series: series.map(s => ({ name: s.name, data: s.data })),
                stroke: { curve: 'smooth', width: 2 },
                fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] } },
                xaxis: {
                    categories: categories,
                    labels: { rotate: categories.length > 8 ? -45 : 0, rotateAlways: categories.length > 8, style: { fontSize: '10px' } }
                },
                yaxis: { labels: { style: { fontSize: '10px' }, formatter: (val) => formatChartNumber(val) } },
                markers: { size: 4, strokeWidth: 0, hover: { size: 6 } }
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
let _toolCallStore = [];
let _aiLogMessages = [];

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

        _toolCallStore = [];
        _aiLogMessages = messages; // store for lazy response viewing

        // Load stats from backend API
        loadInternalAiStats();
        loadToolUsageStats();

        // Build a map of response times: for each assistant message, find the preceding user message
        const responseTimeMap = new Map();
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'assistant' && i + 1 < messages.length && messages[i + 1].role === 'user') {
                const assistantTime = new Date(messages[i].created_at).getTime();
                const userTime = new Date(messages[i + 1].created_at).getTime();
                if (assistantTime > userTime) {
                    const diffSec = ((assistantTime - userTime) / 1000).toFixed(1);
                    responseTimeMap.set(i, diffSec);
                }
            }
        }

        // Group messages into user/assistant pairs
        let html = '<div class="ai-logs-list">';
        for (let mi = 0; mi < messages.length; mi++) {
            const msg = messages[mi];
            const isUser = msg.role === 'user';
            const isAssistant = msg.role === 'assistant';
            const time = msg.created_at ? new Date(msg.created_at).toLocaleString() : '';

            html += `<div class="ai-log-entry" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 8px; background: var(--bg-secondary);">`;
            html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: ${isAssistant ? '8px' : '6px'};">`;
            html += `<span class="status-badge ${isUser ? 'active' : 'ready'}" style="font-size: 0.7rem;">${escapeHtml(msg.role)}</span>`;
            html += `<span style="color: var(--text-secondary); font-size: 0.75rem;">`;
            if (isAssistant && responseTimeMap.has(mi)) {
                const sec = responseTimeMap.get(mi);
                const label = sec >= 60 ? `${(sec / 60).toFixed(1)}m` : `${sec}s`;
                html += `<span style="color: var(--brand-primary); margin-right: 8px;" title="Response generation time">&#9201; ${label}</span>`;
            }
            html += `${time}</span>`;
            html += `</div>`;

            if (isUser) {
                // User messages show full content inline (they're short)
                html += `<div style="color: var(--text-primary); font-size: 0.85rem; white-space: pre-wrap; word-break: break-word;">${escapeHtml(msg.content || '')}</div>`;
            }

            if (isAssistant) {
                // Extract first heading or first line as title preview
                const titleMatch = (msg.content || '').match(/^#\s+(.+)/m);
                const titlePreview = titleMatch ? titleMatch[1] : (msg.content || '').split('\n')[0].substring(0, 80);

                // Compact: title preview + View Response button + metadata row
                html += `<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">`;
                html += `<span class="ai-log-title-preview">${escapeHtml(titlePreview)}</span>`;
                html += `<button class="ai-log-view-btn" onclick="showLlmResponse(${mi})" title="View full AI response">`;
                html += `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
                html += `View Response</button>`;
                html += `</div>`;

                // Metadata row: tokens, model, tool calls — all inline
                const metaParts = [];
                if (msg.input_tokens || msg.output_tokens) metaParts.push(`Tokens: ${(msg.input_tokens || 0) + (msg.output_tokens || 0)}`);
                if (msg.model_used) metaParts.push(`Model: ${msg.model_used}`);

                let toolCallCount = 0;
                if (msg.tool_calls_json) {
                    try { toolCallCount = JSON.parse(msg.tool_calls_json).length; } catch (e) {}
                }

                html += `<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">`;
                if (metaParts.length > 0) {
                    html += `<span style="color: var(--text-secondary); font-size: 0.75rem;">${metaParts.join(' · ')}</span>`;
                }

                // Tool calls
                if (msg.tool_calls_json) {
                    try {
                        const toolCalls = JSON.parse(msg.tool_calls_json);
                        if (toolCalls.length > 0) {
                            html += `<details style="display: inline;"><summary style="color: var(--brand-primary); cursor: pointer; font-size: 0.78rem; display: inline; list-style: none;">&#9654; Tool calls (${toolCalls.length})</summary>`;
                            html += `<div style="margin-top: 4px; padding: 8px; background: var(--bg-tertiary); border-radius: 6px; font-size: 0.75rem; font-family: monospace; max-height: 300px; overflow: auto;">`;
                            for (let tci = 0; tci < toolCalls.length; tci++) {
                                const tc = toolCalls[tci];
                                const storeIdx = _toolCallStore.length;
                                _toolCallStore.push(tc);
                                html += `<div style="margin-bottom: 6px; cursor: pointer; padding: 4px 6px; border-radius: 4px; transition: background 0.15s;" class="tool-call-row" onclick="showToolCallDetail(${storeIdx})" title="Click to view full details">`;
                                html += `<strong>Round ${tc.round}: ${escapeHtml(tc.tool)}</strong> ${tc.success ? '<span style="color:var(--color-success);">OK</span>' : '<span style="color:var(--color-error);">FAIL</span>'}`;
                                try {
                                    const input = JSON.parse(tc.input);
                                    if (tc.tool === 'execute_function' && input.function_name) {
                                        html += `<div style="color: var(--text-secondary); margin-top: 2px;">Function: <strong>${escapeHtml(input.function_name)}</strong>`;
                                        if (input.input_params) html += ` — Params: ${escapeHtml(JSON.stringify(input.input_params).substring(0, 200))}`;
                                        html += `</div>`;
                                    } else if (tc.tool === 'execute_query' && input.sql) {
                                        html += `<div style="color: var(--text-secondary); margin-top: 2px;">SQL: ${escapeHtml(input.sql.substring(0, 200))}</div>`;
                                    } else if (tc.tool === 'get_variable_details' && input.variable_names) {
                                        html += `<div style="color: var(--text-secondary); margin-top: 2px;">Variables: ${escapeHtml(input.variable_names.join(', '))}</div>`;
                                    } else if (tc.tool === 'create_visualization' && input.charts) {
                                        const types = input.charts.map(c => c.chart_type || 'chart').join(', ');
                                        html += `<div style="color: var(--text-secondary); margin-top: 2px;">Charts: ${escapeHtml(types)}</div>`;
                                    }
                                } catch (e) {}
                                html += `</div>`;
                            }
                            html += `</div></details>`;
                        }
                    } catch (e) {}
                }
                html += `</div>`;
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

        updateAiLogsBadges();
    } catch (error) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.innerHTML = `<div class="query-error">Failed to load AI logs: ${escapeHtml(error.message)}</div>`;
        console.error('Failed to load AI logs:', error);
    }
}

async function loadInternalAiStats() {
    const cardsEl = document.getElementById('internalAiStatsCards');
    if (!cardsEl) return;

    try {
        const stats = await api.request(`/research/ai/chat/stats/${projectId}`);
        document.getElementById('iasSessions').textContent = stats.sessions || 0;
        document.getElementById('iasMessages').textContent = stats.messages || 0;
        document.getElementById('iasTokens').textContent = formatTokenCount((stats.input_tokens || 0) + (stats.output_tokens || 0));
        document.getElementById('iasToolCalls').textContent = stats.tool_calls || 0;
        cardsEl.style.display = 'grid';
    } catch (e) {
        console.error('Failed to load AI stats:', e);
    }
}

async function loadToolUsageStats() {
    const section = document.getElementById('toolUsageSection');
    const body = document.getElementById('toolUsageBody');
    if (!section || !body) return;

    try {
        const raw = await api.request(`/research/ai/chat/tool-usage/${projectId}`);
        if (!raw || raw.length === 0) {
            section.style.display = 'none';
            return;
        }

        // Group: aggregate execute_function sub-rows into a parent, keep others flat
        const grouped = [];
        const fnChildren = [];
        let fnParent = { tool: 'execute_function', internal_count: 0, widget_count: 0, total: 0, success: 0, fail: 0 };

        for (const s of raw) {
            if (s.tool === 'execute_function' && s.function_name) {
                fnParent.internal_count += s.internal_count;
                fnParent.widget_count += s.widget_count;
                fnParent.total += s.total;
                fnParent.success += s.success;
                fnParent.fail += s.fail;
                fnChildren.push(s);
            } else {
                grouped.push(s);
            }
        }
        // Sort: grouped by total DESC, then insert execute_function parent + children
        grouped.sort((a, b) => b.total - a.total);
        if (fnChildren.length > 0) {
            // Insert parent at position based on its total
            let insertIdx = grouped.findIndex(g => g.total < fnParent.total);
            if (insertIdx === -1) insertIdx = grouped.length;
            fnChildren.sort((a, b) => b.total - a.total);
            grouped.splice(insertIdx, 0, { ...fnParent, _children: fnChildren });
        }

        const maxCount = Math.max(...grouped.map(g => g.total));
        const INITIAL_SHOW = 5; // show top N functions initially

        let html = `<table class="tool-usage-table">
            <thead><tr>
                <th>Tool</th>
                <th class="tool-usage-bar-cell">Usage</th>
                <th>Internal</th>
                <th>Widget</th>
                <th>Success</th>
                <th>Fail</th>
            </tr></thead><tbody>`;

        for (const s of grouped) {
            const pct = maxCount > 0 ? (s.total / maxCount * 100) : 0;
            const failHtml = s.fail > 0 ? `<span class="tu-fail">${s.fail}</span>` : '<span style="color:var(--text-secondary)">0</span>';
            const hasChildren = s._children && s._children.length > 0;
            const expandAttr = hasChildren ? `onclick="toggleFnChildren(this)" style="cursor:pointer;"` : '';
            const expandIcon = hasChildren ? `<span class="tu-expand-icon" style="font-size:0.65rem;margin-right:4px;display:inline-block;transition:transform 0.2s;">&#9654;</span>` : '';

            html += `<tr ${expandAttr}>
                <td>${expandIcon}<span class="tool-usage-name">${escapeHtml(s.tool)}</span>${hasChildren ? ` <span style="color:var(--text-secondary);font-size:0.68rem;">(${s._children.length} functions)</span>` : ''}</td>
                <td class="tool-usage-bar-cell">
                    <div class="tool-usage-bar-wrap">
                        <div class="tool-usage-bar"><div class="tool-usage-bar-fill" style="width: ${pct}%"></div></div>
                        <span class="tool-usage-bar-count">${s.total}</span>
                    </div>
                </td>
                <td>${s.internal_count}</td>
                <td>${s.widget_count}</td>
                <td><span class="tu-success">${s.success}</span></td>
                <td>${failHtml}</td>
            </tr>`;

            // Render children for execute_function — hidden by default
            if (hasChildren) {
                const children = s._children;
                const hasMore = children.length > INITIAL_SHOW;

                // Search bar row (hidden until expanded)
                if (children.length > INITIAL_SHOW) {
                    html += `<tr class="tu-fn-child tu-fn-search" style="display:none;background:var(--bg-secondary);">
                        <td colspan="6" style="padding:6px 28px;">
                            <input type="text" placeholder="Search ${children.length} functions..." oninput="filterFnChildren(this)" style="width:100%;padding:5px 10px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-tertiary);color:var(--text-primary);font-size:0.76rem;outline:none;">
                        </td>
                    </tr>`;
                }

                for (let ci = 0; ci < children.length; ci++) {
                    const c = children[ci];
                    const cpct = maxCount > 0 ? (c.total / maxCount * 100) : 0;
                    const cfailHtml = c.fail > 0 ? `<span class="tu-fail">${c.fail}</span>` : '<span style="color:var(--text-secondary)">0</span>';
                    const hiddenClass = (hasMore && ci >= INITIAL_SHOW) ? ' tu-fn-extra' : '';
                    html += `<tr class="tu-fn-child${hiddenClass}" style="display:none;background:var(--bg-secondary);" data-fn="${escapeHtml(c.function_name).toLowerCase()}">
                        <td style="padding-left: 28px;"><span class="tool-usage-name" style="color: var(--text-primary);">&#8627; ${escapeHtml(c.function_name)}</span></td>
                        <td class="tool-usage-bar-cell">
                            <div class="tool-usage-bar-wrap">
                                <div class="tool-usage-bar"><div class="tool-usage-bar-fill" style="width: ${cpct}%; background: var(--color-success);"></div></div>
                                <span class="tool-usage-bar-count">${c.total}</span>
                            </div>
                        </td>
                        <td>${c.internal_count}</td>
                        <td>${c.widget_count}</td>
                        <td><span class="tu-success">${c.success}</span></td>
                        <td>${cfailHtml}</td>
                    </tr>`;
                }

                // "Show all" row
                if (hasMore) {
                    html += `<tr class="tu-fn-child tu-fn-show-all" style="display:none;background:var(--bg-secondary);">
                        <td colspan="6" style="padding:4px 28px;">
                            <button onclick="showAllFnChildren(this)" style="background:none;border:none;color:var(--brand-primary);cursor:pointer;font-size:0.76rem;padding:2px 0;">Show all ${children.length} functions</button>
                        </td>
                    </tr>`;
                }
            }
        }

        html += `</tbody></table>`;
        body.innerHTML = html;
        section.style.display = 'block';
    } catch (e) {
        console.error('Failed to load tool usage stats:', e);
    }
}

function toggleToolUsage() {
    const section = document.getElementById('toolUsageSection');
    if (section) section.classList.toggle('open');
}

function toggleFnChildren(parentRow) {
    const isExpanding = !parentRow.classList.contains('tu-expanded');
    parentRow.classList.toggle('tu-expanded');

    // Rotate expand icon
    const icon = parentRow.querySelector('.tu-expand-icon');
    if (icon) icon.style.transform = isExpanding ? 'rotate(90deg)' : '';

    // Toggle child rows
    let row = parentRow.nextElementSibling;
    while (row && row.classList.contains('tu-fn-child')) {
        if (isExpanding) {
            // Show non-extra rows and search/show-all
            if (!row.classList.contains('tu-fn-extra')) {
                row.style.display = '';
            }
        } else {
            row.style.display = 'none';
        }
        row = row.nextElementSibling;
    }
}

function showAllFnChildren(btn) {
    const showAllRow = btn.closest('tr');
    let row = showAllRow.parentElement.firstElementChild;
    // Find the parent group by walking from the show-all row backwards
    let sibling = showAllRow.previousElementSibling;
    while (sibling) {
        if (sibling.classList.contains('tu-fn-extra')) {
            sibling.style.display = '';
            sibling.classList.remove('tu-fn-extra');
        }
        if (!sibling.classList.contains('tu-fn-child')) break;
        sibling = sibling.previousElementSibling;
    }
    showAllRow.style.display = 'none';
}

function filterFnChildren(input) {
    const query = input.value.toLowerCase().trim();
    const searchRow = input.closest('tr');
    let row = searchRow.nextElementSibling;
    while (row && row.classList.contains('tu-fn-child')) {
        if (row.classList.contains('tu-fn-search') || row.classList.contains('tu-fn-show-all')) {
            row = row.nextElementSibling;
            continue;
        }
        const fn = row.getAttribute('data-fn') || '';
        row.style.display = (!query || fn.includes(query)) ? '' : 'none';
        row.classList.remove('tu-fn-extra'); // remove extra class during search
        row = row.nextElementSibling;
    }
    // Hide "show all" when searching
    let next = searchRow.nextElementSibling;
    while (next && next.classList.contains('tu-fn-child')) {
        if (next.classList.contains('tu-fn-show-all')) {
            next.style.display = query ? 'none' : '';
        }
        next = next.nextElementSibling;
    }
}

function showToolCallDetail(storeIdx) {
    try {
        const tc = _toolCallStore[storeIdx];
        if (!tc) return;
        let parsedInput = {};
        try { parsedInput = JSON.parse(tc.input); } catch(e) {}

        const titleEl = document.getElementById('toolCallModalTitle');
        const bodyEl = document.getElementById('toolCallModalBody');
        if (!titleEl || !bodyEl) return;

        // Title
        const statusLabel = tc.success ? '<span style="color:var(--color-success);">OK</span>' : '<span style="color:var(--color-error);">FAIL</span>';
        titleEl.innerHTML = `Round ${tc.round}: ${escapeHtml(tc.tool)} ${statusLabel}`;

        // Body
        let html = '';

        // Timestamp
        if (tc.timestamp) {
            html += `<div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 12px;">${new Date(tc.timestamp).toLocaleString()}</div>`;
        }

        // Input section
        html += `<div style="margin-bottom: 16px;">`;
        html += `<div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 6px; color: var(--brand-primary);">Input</div>`;
        html += `<pre style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; font-size: 0.78rem; overflow: auto; max-height: 40vh; white-space: pre-wrap; word-break: break-word; color: var(--text-primary); margin: 0;">${escapeHtml(JSON.stringify(parsedInput, null, 2))}</pre>`;
        html += `</div>`;

        // Result preview section
        if (tc.result_preview) {
            html += `<div style="margin-bottom: 16px;">`;
            html += `<div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 6px; color: var(--color-success);">Result Preview</div>`;
            html += `<pre style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; font-size: 0.78rem; overflow: auto; max-height: 30vh; white-space: pre-wrap; word-break: break-word; color: var(--text-primary); margin: 0;">${escapeHtml(tc.result_preview)}</pre>`;
            html += `</div>`;
        }

        bodyEl.innerHTML = html;
        document.getElementById('toolCallModal').classList.add('active');
    } catch (e) {
        console.error('Failed to show tool call detail:', e);
    }
}

function showLlmResponse(msgIndex, messageSource) {
    const messages = messageSource || _aiLogMessages;
    const msg = messages[msgIndex];
    if (!msg) return;

    const titleEl = document.getElementById('llmResponseModalTitle');
    const bodyEl = document.getElementById('llmResponseModalBody');
    if (!titleEl || !bodyEl) return;

    // Title from first heading
    const titleMatch = (msg.content || '').match(/^#\s+(.+)/m);
    titleEl.textContent = titleMatch ? titleMatch[1] : 'AI Response';

    // Metadata bar
    const time = msg.created_at ? new Date(msg.created_at).toLocaleString() : '';
    let metaHtml = `<div class="llm-response-meta">`;
    metaHtml += `<span>${time}</span>`;
    if (msg.input_tokens || msg.output_tokens) {
        metaHtml += `<span>Input: ${(msg.input_tokens || 0).toLocaleString()} tokens</span>`;
        metaHtml += `<span>Output: ${(msg.output_tokens || 0).toLocaleString()} tokens</span>`;
    }
    if (msg.model_used) metaHtml += `<span>Model: ${msg.model_used}</span>`;
    metaHtml += `</div>`;

    // Render markdown content
    let rendered = '';
    if (typeof marked !== 'undefined') {
        try {
            rendered = marked.parse(msg.content || '');
        } catch (e) {
            rendered = `<pre style="white-space:pre-wrap;">${escapeHtml(msg.content || '')}</pre>`;
        }
    } else {
        rendered = `<pre style="white-space:pre-wrap;">${escapeHtml(msg.content || '')}</pre>`;
    }

    bodyEl.innerHTML = metaHtml + `<div class="llm-response-rendered">${rendered}</div>`;
    document.getElementById('llmResponseModal').classList.add('active');

    // Extract chart data from tool_calls_json and render charts
    let charts = [];
    if (msg.tool_calls_json) {
        try {
            const toolCalls = JSON.parse(msg.tool_calls_json);
            for (const tc of toolCalls) {
                if (tc.tool === 'create_visualization' && tc.success) {
                    try {
                        const input = JSON.parse(tc.input);
                        if (input.charts && Array.isArray(input.charts)) {
                            charts = charts.concat(input.charts);
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}
    }

    if (charts.length > 0) {
        const renderedEl = bodyEl.querySelector('.llm-response-rendered');
        if (renderedEl) {
            renderInlineCharts(renderedEl, charts);
        }
    }
}

// ============================================
// FUNCTIONS TAB
// ============================================

async function loadFunctions() {
    const container = document.getElementById('fnBlocksContainer');
    if (!container) return;

    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 20px;">Loading functions...</div>';

    try {
        const baseUrl = api._getBaseUrl('/research/');
        const token = api.token || getAuthToken();
        const resp = await fetch(`${baseUrl}/projects/${projectId}/functions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        fnFunctions = Array.isArray(data) ? data : (data.functions || []);
        fnFunctions.sort((a, b) => ((a.name || a.function_name) || '').localeCompare((b.name || b.function_name) || ''));
        fnLoaded = true;

        // Clear and add one initial empty block
        container.innerHTML = '';
        fnBlocks = [];
        fnBlockIdCounter = 0;
        addFnBlock();
    } catch (error) {
        container.innerHTML = `<div style="color: var(--color-danger, #ef4444); font-size: 0.8rem; text-align: center; padding: 20px;">Failed to load functions</div>`;
        console.error('Failed to load functions:', error);
    }
}

function addFnBlock() {
    const container = document.getElementById('fnBlocksContainer');
    if (!container) return;

    const blockId = ++fnBlockIdCounter;
    fnBlocks.push({ id: blockId, fnName: '' });

    const blockEl = document.createElement('div');
    blockEl.className = 'fn-block';
    blockEl.id = `fnBlock-${blockId}`;
    blockEl.dataset.blockId = blockId;

    // Build dropdown options
    const optionsHtml = fnFunctions.map(fn => {
        const name = fn.name || fn.function_name || '';
        return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    }).join('');

    blockEl.innerHTML = `
        <div class="fn-block-header">
            <div class="fn-block-num">${fnBlocks.length}</div>
            <select class="fn-block-select" id="fnBlockSelect-${blockId}" data-block-id="${blockId}" onchange="onBlockFnChange(${blockId})">
                <option value="">Select a function...</option>
                ${optionsHtml}
            </select>
            <div class="fn-block-actions">
                <button class="fn-block-btn fn-block-info-btn" title="Function info" data-block-id="${blockId}" onclick="openFnInfoPanel(${blockId})" style="display:none;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                </button>
                <button class="fn-block-btn fn-block-run-btn" title="Run (Ctrl+Enter)" data-block-id="${blockId}" onclick="executeFnBlock(${blockId})" disabled>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                <button class="fn-block-btn fn-block-delete-btn" title="Delete block" data-block-id="${blockId}" onclick="deleteFnBlock(${blockId})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>
        <div class="fn-block-body" id="fnBlockBody-${blockId}">
            <textarea class="fn-block-editor" id="fnBlockEditor-${blockId}"
                placeholder='Select a function above to auto-fill template...'
                rows="4"></textarea>
        </div>
    `;

    container.appendChild(blockEl);

    // Convert select to searchable dropdown
    if (typeof convertSelectToSearchable === 'function') {
        const blockDropdown = convertSelectToSearchable(`fnBlockSelect-${blockId}`, {
            placeholder: 'Select a function...',
            searchPlaceholder: 'Search functions...',
            onChange: (value) => onBlockFnChange(blockId)
        });
        if (blockDropdown) fnBlockDropdowns.set(blockId, blockDropdown);
    }

    // Add Ctrl+Enter handler + auto-resize on input
    const editor = blockEl.querySelector('.fn-block-editor');
    editor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            executeFnBlock(blockId);
        }
    });
    editor.addEventListener('input', () => autoSizeFnEditor(editor));

    // Scroll into view
    blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onBlockFnChange(blockId) {
    const dropdown = fnBlockDropdowns.get(blockId);
    const name = dropdown ? (dropdown.getValue() || '') : (document.querySelector(`select.fn-block-select[data-block-id="${blockId}"]`)?.value || '');
    const block = fnBlocks.find(b => b.id === blockId);
    if (block) block.fnName = name;

    const body = document.getElementById(`fnBlockBody-${blockId}`);
    const infoBtn = document.querySelector(`.fn-block-info-btn[data-block-id="${blockId}"]`);
    const runBtn = document.querySelector(`.fn-block-run-btn[data-block-id="${blockId}"]`);
    const editor = document.getElementById(`fnBlockEditor-${blockId}`);

    if (!name) {
        if (body) body.classList.remove('visible');
        if (infoBtn) infoBtn.style.display = 'none';
        if (runBtn) runBtn.disabled = true;
        return;
    }

    // Show body, info btn, enable run
    if (body) body.classList.add('visible');
    if (infoBtn) infoBtn.style.display = '';
    if (runBtn) runBtn.disabled = false;

    // Fill template
    const fn = fnFunctions.find(f => (f.name || f.function_name) === name);
    if (!fn || !editor) return;

    let templateObj;
    const examples = fn.examples || [];
    if (examples.length > 0 && examples[0].input_params) {
        templateObj = {
            function_name: fn.name || fn.function_name,
            input_params: examples[0].input_params
        };
    } else {
        const params = {};
        const schema = fn.input_schema;
        if (schema && schema.properties) {
            for (const pName of (schema.required || [])) {
                const pDef = schema.properties[pName];
                if (pDef) {
                    params[pName] = pDef.type === 'number' || pDef.type === 'integer' ? 0
                        : pDef.type === 'array' ? []
                        : pDef.type === 'object' ? {}
                        : '';
                }
            }
        }
        templateObj = {
            function_name: fn.name || fn.function_name,
            input_params: params
        };
    }
    editor.value = compactJsonStringify(templateObj);
    autoSizeFnEditor(editor);
}

/**
 * Compact JSON formatter: always expands top 2 levels (the wrapper object
 * and input_params keys). At depth 2+ puts small objects/arrays on one
 * line when they fit within lineWidth.
 */
function compactJsonStringify(obj, indent = 2, lineWidth = 100) {
    function serialize(val, depth) {
        const pad = ' '.repeat(depth * indent);
        const childPad = ' '.repeat((depth + 1) * indent);

        if (val === null || val === undefined) return 'null';
        if (typeof val === 'boolean' || typeof val === 'number') return String(val);
        if (typeof val === 'string') return JSON.stringify(val);

        // At depth >= 2, try inline if it fits
        if (depth >= 2) {
            const inline = JSON.stringify(val);
            if (inline.length <= lineWidth - depth * indent) return inline;
        }

        if (Array.isArray(val)) {
            if (val.length === 0) return '[]';
            const items = val.map(v => serialize(v, depth + 1));
            const expanded = items.map(s => childPad + s).join(',\n');
            return '[\n' + expanded + '\n' + pad + ']';
        }

        if (typeof val === 'object') {
            const keys = Object.keys(val);
            if (keys.length === 0) return '{}';
            const entries = keys.map(k => {
                const v = serialize(val[k], depth + 1);
                return childPad + JSON.stringify(k) + ': ' + v;
            });
            return '{\n' + entries.join(',\n') + '\n' + pad + '}';
        }

        return String(val);
    }
    return serialize(obj, 0);
}

/** Auto-size a textarea to fit its content without scrollbar */
function autoSizeFnEditor(editor) {
    if (!editor) return;
    editor.style.height = 'auto';
    editor.style.height = editor.scrollHeight + 'px';
}

function deleteFnBlock(blockId) {
    if (fnBlocks.length <= 1) {
        Toast.warning('Cannot delete the last block.');
        return;
    }

    const blockEl = document.getElementById(`fnBlock-${blockId}`);
    if (blockEl) blockEl.remove();

    // Clean up searchable dropdown instance
    const dd = fnBlockDropdowns.get(blockId);
    if (dd) { dd.destroy(); fnBlockDropdowns.delete(blockId); }

    fnBlocks = fnBlocks.filter(b => b.id !== blockId);

    // Re-number remaining blocks
    document.querySelectorAll('.fn-block').forEach((el, idx) => {
        const numEl = el.querySelector('.fn-block-num');
        if (numEl) numEl.textContent = idx + 1;
    });
}

async function executeFnBlock(blockId) {
    const editor = document.getElementById(`fnBlockEditor-${blockId}`);
    const editorValue = (editor ? editor.value : '').trim();

    if (!editorValue) {
        Toast.warning('Please select a function and fill in parameters.');
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(editorValue);
    } catch (e) {
        renderFnError(`Invalid JSON: ${e.message}`);
        showFnPopup(0, 0);
        return;
    }

    // Inject file_id from shared selector
    const fnFileVal = getFnFileSelectValue();
    if (fnFileVal && !parsed.file_id) {
        parsed.file_id = fnFileVal;
    }

    const blockEl = document.getElementById(`fnBlock-${blockId}`);
    const runBtn = document.querySelector(`.fn-block-run-btn[data-block-id="${blockId}"]`);

    // Loading state
    if (blockEl) blockEl.classList.add('running');
    if (runBtn) {
        runBtn.disabled = true;
        runBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div>';
    }

    try {
        const baseUrl = api._getBaseUrl('/research/');
        const token = api.token || getAuthToken();
        const fetchResponse = await fetch(`${baseUrl}/projects/${projectId}/functions/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(parsed)
        });

        const response = await fetchResponse.json();

        if (!fetchResponse.ok || response.success === false) {
            renderFnError(response.error || response.message || 'Function execution failed');
            showFnPopup(0, 0);
            return;
        }

        const execTime = response.execution_time_ms ?? 0;
        const rowCount = response.rows ? response.rows.length : 0;

        const funcName = parsed.function_name || '';
        renderFnResults(response, funcName);
        showFnPopup(execTime, rowCount);
    } catch (error) {
        renderFnError(`Request failed: ${error.message}`);
        showFnPopup(0, 0);
        console.error('Function execution failed:', error);
    } finally {
        if (blockEl) blockEl.classList.remove('running');
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        }
    }
}

/**
 * Formats a function description string into structured HTML.
 * Recognizes: section headings (ALL CAPS with colon), bullet lists (- item),
 * numbered lists (1. item), and paragraph breaks (double newline).
 */
function formatFnDescription(text) {
    if (!text) return '<p>No description available.</p>';

    const lines = text.split('\n');
    let html = '';
    let inList = false;   // currently inside a <ul>
    let inOl = false;     // currently inside an <ol>
    let paragraph = '';

    function flushParagraph() {
        const trimmed = paragraph.trim();
        if (trimmed) {
            html += `<p>${escapeHtml(trimmed)}</p>`;
        }
        paragraph = '';
    }

    function closeList() {
        if (inList) { html += '</ul>'; inList = false; }
        if (inOl) { html += '</ol>'; inOl = false; }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Empty line = paragraph break
        if (trimmed === '') {
            closeList();
            flushParagraph();
            continue;
        }

        // Section heading: ALL CAPS line ending with colon (e.g. "KEY CAPABILITIES:")
        if (/^[A-Z][A-Z\s_\/&()-]+:$/.test(trimmed)) {
            closeList();
            flushParagraph();
            const headingText = trimmed.replace(/:$/, '');
            html += `<h4 class="fn-desc-heading">${escapeHtml(headingText)}</h4>`;
            continue;
        }

        // Bullet list item: starts with "- " or "– "
        if (/^[-–]\s+/.test(trimmed)) {
            flushParagraph();
            if (inOl) { html += '</ol>'; inOl = false; }
            if (!inList) { html += '<ul>'; inList = true; }
            const itemText = trimmed.replace(/^[-–]\s+/, '');
            html += `<li>${escapeHtml(itemText)}</li>`;
            continue;
        }

        // Numbered list item: starts with "1. ", "2. ", etc.
        if (/^\d+\.\s+/.test(trimmed)) {
            flushParagraph();
            if (inList) { html += '</ul>'; inList = false; }
            if (!inOl) { html += '<ol>'; inOl = true; }
            const itemText = trimmed.replace(/^\d+\.\s+/, '');
            html += `<li>${escapeHtml(itemText)}</li>`;
            continue;
        }

        // Regular text — accumulate into paragraph
        closeList();
        if (paragraph) paragraph += ' ';
        paragraph += trimmed;
    }

    closeList();
    flushParagraph();

    return html || '<p>No description available.</p>';
}

function openFnInfoPanel(blockId) {
    const dropdown = fnBlockDropdowns.get(blockId);
    const fnName = dropdown ? (dropdown.getValue() || '') : (document.querySelector(`select.fn-block-select[data-block-id="${blockId}"]`)?.value || '');
    if (!fnName) return;

    const fn = fnFunctions.find(f => (f.name || f.function_name) === fnName);
    if (!fn) return;

    const panel = document.getElementById('fnInfoSlidePanel');
    const overlay = document.getElementById('fnInfoPanelOverlay');
    const body = document.getElementById('fnInfoPanelBody');
    if (!panel || !body) return;

    const name = fn.name || fn.function_name || '';
    const category = fn.category || '';
    const description = fn.description || 'No description available.';
    const schema = fn.input_schema;
    const examples = fn.examples || [];

    let html = '';

    // Name + category
    html += `<div class="fn-info-panel-name">${escapeHtml(name)}</div>`;
    if (category) {
        html += `<div class="fn-info-panel-category">${escapeHtml(category)}</div>`;
    }

    // Description — formatted with paragraphs, headings, and lists
    html += `<div class="fn-info-panel-desc">${formatFnDescription(description)}</div>`;

    // Parameters table
    if (schema && schema.properties && Object.keys(schema.properties).length > 0) {
        const required = schema.required || [];
        html += `<div class="fn-info-panel-section-title">Parameters</div>`;
        html += `<table class="fn-info-param-table"><thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead><tbody>`;
        for (const [pName, pDef] of Object.entries(schema.properties)) {
            const isReq = required.includes(pName);
            const reqMark = isReq ? ' <span class="fn-info-param-required">*</span>' : '';
            const typeStr = pDef.type || 'any';
            let descStr = pDef.description ? escapeHtml(pDef.description) : '';
            // Enum values
            if (pDef.enum && pDef.enum.length > 0) {
                descStr += '<div class="fn-info-param-enum">';
                for (const v of pDef.enum) {
                    descStr += `<span class="fn-info-param-enum-val">${escapeHtml(String(v))}</span>`;
                }
                descStr += '</div>';
            }
            html += `<tr>
                <td><code style="font-family:var(--font-mono,monospace);font-size:0.75rem;">${escapeHtml(pName)}</code>${reqMark}</td>
                <td><span class="fn-info-param-type">${escapeHtml(typeStr)}</span></td>
                <td>${descStr}</td>
            </tr>`;
        }
        html += `</tbody></table>`;
    }

    // Examples
    if (examples.length > 0) {
        html += `<div class="fn-info-panel-section-title">Examples</div>`;
        examples.forEach((ex, i) => {
            const label = ex.label || ex.description || `Example ${i + 1}`;
            const code = JSON.stringify({ function_name: name, input_params: ex.input_params || {} }, null, 2);
            html += `<div class="fn-info-example-card">
                <div class="fn-info-example-label">${escapeHtml(label)}</div>
                <div class="fn-info-example-code">${escapeHtml(code)}</div>
            </div>`;
        });
    }

    body.innerHTML = html;

    // Open panel
    panel.classList.add('active');
    if (overlay) overlay.classList.add('active');
}

function closeFnInfoPanel() {
    const panel = document.getElementById('fnInfoSlidePanel');
    const overlay = document.getElementById('fnInfoPanelOverlay');
    if (panel) panel.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function updateFnFileSelector() {
    const select = document.getElementById('fnFileSelect');
    if (!select) return;

    const currentValue = fnFileDropdown ? fnFileDropdown.getValue() : select.value;
    select.innerHTML = '';

    const readyFiles = files.filter(f => f.status === 'ready');
    for (const f of readyFiles) {
        const fileName = f.fileName || f.file_name || 'Unknown';
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = fileName;
        select.appendChild(opt);
    }

    // Restore selection if still valid, otherwise select first file
    if (currentValue && readyFiles.some(f => f.id === currentValue)) {
        select.value = currentValue;
    } else if (readyFiles.length > 0) {
        select.value = readyFiles[0].id;
    }

    // Convert to searchable dropdown
    if (typeof convertSelectToSearchable === 'function') {
        if (fnFileDropdown) fnFileDropdown.destroy();
        fnFileDropdown = convertSelectToSearchable('fnFileSelect', {
            placeholder: 'Select file...',
            searchPlaceholder: 'Search files...',
            compact: true
        });
        const selectedVal = select.value;
        if (selectedVal) {
            fnFileDropdown.setValue(selectedVal);
        }
    }
}

function getFnFileSelectValue() {
    if (fnFileDropdown) return fnFileDropdown.getValue() || '';
    return document.getElementById('fnFileSelect')?.value || '';
}

/**
 * Render driver regression results with professional ApexCharts visualizations.
 * Layout: Model summary pills → Bar chart + Scatter side-by-side → Collapsible coefficient table.
 * Comparison mode retains per-group tables with delta table.
 */
function _renderDriverRegression(rows, stats) {
    const esc = s => escapeHtml(String(s ?? ''));
    const fmtN = n => Number(n).toLocaleString();
    const fmtD = (n, d = 4) => {
        if (n === null || n === undefined) return '-';
        const v = Number(n);
        return isNaN(v) ? String(n) : v.toFixed(d);
    };
    const fmtP = p => {
        if (p === null || p === undefined) return '-';
        const v = Number(p);
        if (isNaN(v)) return String(p);
        if (v < 0.001) return '<.001';
        return v.toFixed(3);
    };
    const bc = 'var(--border-color, #334155)';
    const depVar = stats.dependent_variable || '?';
    const isComparison = !!stats.groups;

    // Generate unique ID for this render
    const uid = 'drv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    let h = `<div class="drv-regression-output">`;

    // ── Title ──
    h += `<div class="drv-title">Driver Regression \u2014 ${esc(depVar)}${stats.dependent_variable_label ? ' <span class="drv-dep-label">(' + esc(stats.dependent_variable_label) + ')</span>' : ''}</div>`;

    if (!isComparison) {
        // ── Single regression output ──
        h += _buildModelSummaryBox(stats, bc, fmtD, fmtP, fmtN);

        // Chart containers (rendered after DOM insertion)
        h += `<div class="drv-chart-row">`;
        h += `<div class="drv-chart-panel"><div class="drv-chart-title">Relative Importance</div><div id="${uid}_bar"></div></div>`;
        h += `<div class="drv-chart-panel"><div class="drv-chart-title">Importance \u2013 Performance Quadrant</div><div id="${uid}_scatter"></div></div>`;
        h += `</div>`;

        // Collapsible coefficient table
        h += `<button class="drv-collapse-toggle" onclick="this.classList.toggle('expanded'); this.nextElementSibling.classList.toggle('expanded');">`;
        h += `<span class="drv-chevron">\u25B6</span> Coefficient Details</button>`;
        h += `<div class="drv-collapse-body">`;
        h += _buildCoefficientTable(rows, bc, fmtD, fmtP, fmtN, esc);
        h += `</div>`;

        // Stash chart data for deferred rendering
        if (!window._drvChartQueue) window._drvChartQueue = {};
        window._drvChartQueue[uid] = { rows, stats };

        // Schedule chart rendering after DOM insertion
        requestAnimationFrame(() => requestAnimationFrame(() => _renderDriverCharts(uid)));

    } else {
        // ── Comparison mode (compare_by) ──
        const groups = stats.groups || [];
        const deltas = stats.deltas || [];

        // Per-group model summaries
        h += `<div style="font-weight:600; margin-bottom:4px;">Model Summary by Group</div>`;
        h += `<table style="border-collapse:collapse; margin-bottom:14px; font-size:0.78rem; width:100%;">
            <thead><tr>
                <th style="border:1px solid ${bc}; padding:4px 10px;">Group</th>
                <th style="border:1px solid ${bc}; padding:4px 10px;">R\u00B2</th>
                <th style="border:1px solid ${bc}; padding:4px 10px;">Adj. R\u00B2</th>
                <th style="border:1px solid ${bc}; padding:4px 10px;">F</th>
                <th style="border:1px solid ${bc}; padding:4px 10px;">Sig.</th>
                <th style="border:1px solid ${bc}; padding:4px 10px;">N</th>
            </tr></thead><tbody>`;
        for (const g of groups) {
            h += `<tr>
                <td style="border:1px solid ${bc}; padding:4px 10px; font-weight:600;">${esc(g.group_label || g.group_value || g.group)}</td>
                <td style="border:1px solid ${bc}; padding:4px 10px; text-align:right;">${fmtD(g.r_squared, 4)}</td>
                <td style="border:1px solid ${bc}; padding:4px 10px; text-align:right;">${fmtD(g.adjusted_r_squared, 4)}</td>
                <td style="border:1px solid ${bc}; padding:4px 10px; text-align:right;">${fmtN(Number(g.f_statistic || 0).toFixed(2))}</td>
                <td style="border:1px solid ${bc}; padding:4px 10px; text-align:right;">${fmtP(g.f_p_value)}</td>
                <td style="border:1px solid ${bc}; padding:4px 10px; text-align:right;">${fmtN(Number(g.n || 0))}</td>
            </tr>`;
        }
        h += `</tbody></table>`;

        // Per-group coefficient tables (collapsible)
        const groupValues = [...new Set(rows.map(r => String(r.group ?? '')))];
        for (const gv of groupValues) {
            const groupRows = rows.filter(r => String(r.group ?? '') === gv);
            const groupMeta = groups.find(g => String(g.group_value ?? g.group) === gv);
            const label = groupMeta?.group_label || groupMeta?.group || gv;
            h += `<button class="drv-collapse-toggle" onclick="this.classList.toggle('expanded'); this.nextElementSibling.classList.toggle('expanded');">`;
            h += `<span class="drv-chevron">\u25B6</span> Coefficients \u2014 ${esc(label)}</button>`;
            h += `<div class="drv-collapse-body">`;
            h += _buildCoefficientTable(groupRows, bc, fmtD, fmtP, fmtN, esc);
            h += `</div>`;
        }

        // Delta importance table
        if (deltas.length > 0) {
            h += `<div style="font-weight:600; margin:12px 0 4px;">Change in Drivers (${esc(stats.delta_from || 'First')} \u2192 ${esc(stats.delta_to || 'Last')})</div>`;
            h += `<table style="border-collapse:collapse; width:100%; font-size:0.78rem; margin-bottom:10px;">
                <thead><tr>
                    <th style="border:1px solid ${bc}; padding:4px 8px; text-align:left;">Variable</th>
                    <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">\u0394 Std. Beta</th>
                    <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">\u0394 Importance</th>
                    <th style="border:1px solid ${bc}; padding:4px 8px; text-align:center;">Direction</th>
                </tr></thead><tbody>`;
            const sortedDeltas = [...deltas].sort((a, b) => Math.abs(b.delta_importance || 0) - Math.abs(a.delta_importance || 0));
            for (const d of sortedDeltas) {
                const dImp = Number(d.delta_importance || 0);
                const dBeta = Number(d.delta_std_beta || 0);
                const dir = d.direction || '';
                const dirColor = dir === 'strengthened' ? 'var(--color-success, #22c55e)' :
                                 dir === 'weakened' ? 'var(--color-error, #ef4444)' :
                                 'var(--text-secondary)';
                const dirSymbol = dir === 'strengthened' ? '\u25B2' : dir === 'weakened' ? '\u25BC' : '\u25CF';
                h += `<tr>
                    <td style="border:1px solid ${bc}; padding:4px 8px;">${esc(d.variable_label || d.variable)}</td>
                    <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${dBeta >= 0 ? '+' : ''}${fmtD(dBeta, 4)}</td>
                    <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${dImp >= 0 ? '+' : ''}${fmtD(dImp, 1)}%</td>
                    <td style="border:1px solid ${bc}; padding:4px 8px; text-align:center; color:${dirColor};">${dirSymbol} ${esc(dir)}</td>
                </tr>`;
            }
            h += `</tbody></table>`;
        }
    }

    h += `</div>`;
    return h;
}

/**
 * Build compact model summary pill row for driver regression.
 */
function _buildModelSummaryBox(stats, bc, fmtD, fmtP, fmtN) {
    const r2 = Number(stats.r_squared || 0);
    const adjR2 = Number(stats.adjusted_r_squared || 0);
    const fStat = Number(stats.f_statistic || 0);
    const fP = stats.f_p_value;
    const n = Number(stats.n || 0);
    const k = Number(stats.predictors_count || 0);
    const df2 = Number(stats.f_df2 || 0);
    const r2Pct = (r2 * 100).toFixed(1);

    // Color-code R² — green ≥30%, yellow ≥10%, red <10%
    const r2Color = r2 >= 0.30 ? 'var(--color-success, #22c55e)' :
                    r2 >= 0.10 ? 'var(--color-warning, #f59e0b)' :
                    'var(--color-error, #ef4444)';

    let h = `<div class="drv-model-summary">`;
    h += `<span class="drv-pill"><span class="pill-label">R\u00B2</span><span class="pill-value" style="color:${r2Color}">${r2Pct}%</span></span>`;
    h += `<span class="drv-pill"><span class="pill-label">Adj. R\u00B2</span><span class="pill-value">${fmtD(adjR2, 4)}</span></span>`;
    h += `<span class="drv-pill"><span class="pill-label">F(${k},${fmtN(df2)})</span><span class="pill-value">${fmtN(fStat.toFixed(2))}</span></span>`;
    h += `<span class="drv-pill"><span class="pill-label">Sig.</span><span class="pill-value">${fmtP(fP)}</span></span>`;
    h += `<span class="drv-pill"><span class="pill-label">N</span><span class="pill-value">${fmtN(n)}</span></span>`;
    h += `</div>`;
    return h;
}

/**
 * Deferred chart rendering — called after DOM insertion via rAF.
 */
function _renderDriverCharts(uid) {
    const q = window._drvChartQueue?.[uid];
    if (!q) return;
    const { rows, stats } = q;
    delete window._drvChartQueue[uid];

    // Sort rows by relative importance descending
    const sorted = [...rows].sort((a, b) => Number(b.relative_importance || 0) - Number(a.relative_importance || 0));

    _renderImportanceBarChart(`${uid}_bar`, sorted, stats);
    _renderQuadrantScatter(`${uid}_scatter`, sorted, stats);
}

/**
 * ApexCharts horizontal bar chart — relative importance by predictor.
 */
function _renderImportanceBarChart(containerId, sortedRows, stats) {
    const el = document.getElementById(containerId);
    if (!el || typeof ApexCharts === 'undefined') return;

    // Reverse for bottom-to-top display (ApexCharts renders categories bottom-up)
    const displayRows = [...sortedRows].reverse();
    const categories = displayRows.map(r => {
        const lbl = r.variable_label || r.variable || '';
        return lbl.length > 28 ? lbl.slice(0, 26) + '\u2026' : lbl;
    });
    const values = displayRows.map(r => Number(r.relative_importance || 0));
    const isSig = displayRows.map(r => r.significant === true || r.significant === 'true');

    const brandPrimary = getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim() || '#00d4ff';
    const chartHeight = Math.max(240, sortedRows.length * 34);

    const options = {
        chart: {
            type: 'bar',
            height: chartHeight,
            background: 'transparent',
            toolbar: { show: false },
            fontFamily: 'inherit'
        },
        series: [{
            name: 'Relative Importance',
            data: values
        }],
        plotOptions: {
            bar: {
                horizontal: true,
                barHeight: '65%',
                borderRadius: 3,
                distributed: true,
                dataLabels: { position: 'top' }
            }
        },
        colors: displayRows.map((_, i) => isSig[i] ? brandPrimary : '#64748b'),
        dataLabels: {
            enabled: true,
            formatter: v => v.toFixed(1) + '%',
            offsetX: 28,
            style: {
                fontSize: '11px',
                fontWeight: 600,
                colors: ['var(--text-secondary, #94a3b8)']
            }
        },
        xaxis: {
            categories,
            max: Math.ceil(Math.max(...values) * 1.25),
            labels: {
                formatter: v => v.toFixed(0) + '%',
                style: { colors: 'var(--text-secondary, #94a3b8)', fontSize: '11px' }
            },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: 'var(--text-secondary, #94a3b8)', fontSize: '11px' },
                maxWidth: 180
            }
        },
        grid: {
            borderColor: 'var(--border-color, #334155)',
            strokeDashArray: 3,
            xaxis: { lines: { show: true } },
            yaxis: { lines: { show: false } },
            padding: { right: 40 }
        },
        tooltip: {
            theme: 'dark',
            y: { formatter: v => v.toFixed(1) + '%' }
        },
        legend: { show: false },
        states: {
            hover: { filter: { type: 'darken', value: 0.85 } }
        }
    };

    try {
        const chart = new ApexCharts(el, options);
        chart.render();
    } catch (e) {
        console.warn('Driver bar chart render failed:', e);
    }
}

/**
 * ApexCharts scatter — Importance vs Performance quadrant map.
 */
function _renderQuadrantScatter(containerId, sortedRows, stats) {
    const el = document.getElementById(containerId);
    if (!el || typeof ApexCharts === 'undefined') return;

    const meanImp = Number(stats.mean_importance_split || 0);
    const meanPerf = Number(stats.mean_performance_split || 0);

    // Classify each point into a quadrant
    const quadrants = {
        'Priority': { color: '#ef4444', data: [] },         // high imp, low perf
        'Maintain': { color: '#22c55e', data: [] },          // high imp, high perf
        'Monitor': { color: '#f59e0b', data: [] },           // low imp, high perf
        'Low Priority': { color: '#64748b', data: [] }       // low imp, low perf
    };

    // Find common prefix among all labels to strip for short labels
    const allLabels = sortedRows.map(r => r.variable_label || r.variable || '');
    let commonPfx = allLabels[0] || '';
    for (let i = 1; i < allLabels.length; i++) {
        while (commonPfx && !allLabels[i].startsWith(commonPfx)) {
            commonPfx = commonPfx.slice(0, -1);
        }
    }
    // Only strip if prefix is substantial and ends at a word boundary
    const stripPfx = commonPfx.length > 8 ? commonPfx : '';

    // Scale mean_score to percentage (*100) so ApexCharts handles the axis properly
    const perfScale = 100;
    const meanPerfScaled = meanPerf * perfScale;

    for (const r of sortedRows) {
        const imp = Number(r.relative_importance || 0);
        const perf = Number(r.mean_score || 0) * perfScale;
        const lbl = r.variable_label || r.variable || '';
        let shortLbl = stripPfx ? lbl.slice(stripPfx.length).trim() : lbl;
        if (shortLbl.startsWith('- ')) shortLbl = shortLbl.slice(2);
        if (shortLbl.length > 18) shortLbl = shortLbl.slice(0, 16) + '\u2026';
        const point = { x: perf, y: imp, meta: { label: lbl, shortLabel: shortLbl, beta: r.std_beta, pValue: r.p_value, sig: r.significant, rawPerf: Number(r.mean_score || 0) } };

        const highImp = imp >= meanImp;
        const highPerf = perf >= meanPerfScaled;

        if (highImp && !highPerf) quadrants['Priority'].data.push(point);
        else if (highImp && highPerf) quadrants['Maintain'].data.push(point);
        else if (!highImp && highPerf) quadrants['Monitor'].data.push(point);
        else quadrants['Low Priority'].data.push(point);
    }

    const series = Object.entries(quadrants)
        .filter(([_, q]) => q.data.length > 0)
        .map(([name, q]) => ({ name, data: q.data, color: q.color }));

    // Calculate axis range with padding
    const allPerf = sortedRows.map(r => Number(r.mean_score || 0) * perfScale);
    const allImp = sortedRows.map(r => Number(r.relative_importance || 0));
    const perfMin = Math.min(...allPerf);
    const perfMax = Math.max(...allPerf);
    const impMax = Math.max(...allImp);
    const perfPad = (perfMax - perfMin) * 0.15 || 5;
    const impPad = impMax * 0.15 || 5;

    const options = {
        chart: {
            type: 'scatter',
            height: 340,
            background: 'transparent',
            toolbar: { show: false },
            fontFamily: 'inherit',
            zoom: { enabled: false }
        },
        series,
        markers: {
            size: 8,
            strokeWidth: 2,
            strokeColors: '#0f172a',
            hover: { sizeOffset: 3 }
        },
        xaxis: {
            type: 'numeric',
            min: Math.floor(perfMin - perfPad),
            max: Math.ceil(perfMax + perfPad),
            title: { text: 'Performance (Mean Score %)', style: { color: 'var(--text-secondary, #94a3b8)', fontSize: '11px' } },
            labels: {
                formatter: v => Math.round(v) + '%',
                style: { colors: 'var(--text-secondary, #94a3b8)', fontSize: '11px' }
            },
            axisBorder: { show: false },
            axisTicks: { show: false },
            tickAmount: 5
        },
        yaxis: {
            min: 0,
            max: impMax + impPad,
            title: { text: 'Relative Importance %', style: { color: 'var(--text-secondary, #94a3b8)', fontSize: '11px' } },
            labels: {
                formatter: v => Number(v).toFixed(0) + '%',
                style: { colors: 'var(--text-secondary, #94a3b8)', fontSize: '11px' }
            },
            tickAmount: 5
        },
        annotations: {
            xaxis: [{
                x: meanPerfScaled,
                borderColor: 'var(--text-muted, #475569)',
                strokeDashArray: 4,
                label: { text: 'Mean', style: { color: 'var(--text-secondary)', background: 'transparent', fontSize: '10px' } }
            }],
            yaxis: [{
                y: meanImp,
                borderColor: 'var(--text-muted, #475569)',
                strokeDashArray: 4,
                label: { text: 'Mean', style: { color: 'var(--text-secondary)', background: 'transparent', fontSize: '10px' } }
            }]
        },
        dataLabels: {
            enabled: true,
            formatter: (val, opts) => {
                const pt = opts.w.config.series[opts.seriesIndex]?.data[opts.dataPointIndex];
                return pt?.meta?.shortLabel || '';
            },
            offsetY: -10,
            style: {
                fontSize: '10px',
                fontWeight: 400,
                colors: ['var(--text-secondary, #94a3b8)']
            },
            background: { enabled: false }
        },
        tooltip: {
            custom: ({ seriesIndex, dataPointIndex, w }) => {
                const pt = w.config.series[seriesIndex]?.data[dataPointIndex];
                if (!pt?.meta) return '';
                const m = pt.meta;
                const sigBadge = (m.sig === true || m.sig === 'true')
                    ? '<span style="color:#22c55e;">Significant</span>'
                    : '<span style="color:#64748b;">Not significant</span>';
                return `<div style="padding:8px 12px; font-size:0.78rem; line-height:1.6; background:#1e293b; color:#e2e8f0; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,.35);">
                    <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(m.label)}</div>
                    <div>\u03B2 = ${Number(m.beta).toFixed(4)}</div>
                    <div>Importance: ${pt.y.toFixed(1)}%</div>
                    <div>Mean Score: ${(m.rawPerf != null ? m.rawPerf : pt.x / 100).toFixed(3)}</div>
                    <div>p = ${Number(m.pValue) < 0.001 ? '<.001' : Number(m.pValue).toFixed(3)}</div>
                    <div>${sigBadge}</div>
                </div>`;
            }
        },
        legend: {
            position: 'bottom',
            fontSize: '11px',
            labels: { colors: 'var(--text-secondary, #94a3b8)' },
            markers: { size: 6 }
        },
        grid: {
            borderColor: 'var(--border-color, #334155)',
            strokeDashArray: 3,
            padding: { top: 0, right: 10, bottom: 0, left: 10 }
        }
    };

    try {
        const chart = new ApexCharts(el, options);
        chart.render();
    } catch (e) {
        console.warn('Driver scatter chart render failed:', e);
    }
}

/**
 * Build a coefficient table with inline importance bars.
 */
function _buildCoefficientTable(rows, bc, fmtD, fmtP, fmtN, esc) {
    // Find max importance for bar scaling
    const maxImp = Math.max(...rows.map(r => Math.abs(Number(r.relative_importance || 0))), 1);

    let h = `<table style="border-collapse:collapse; width:100%; font-size:0.78rem; margin-bottom:10px;">
        <thead><tr>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:left;">Variable</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Std. Beta</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Beta</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Std. Error</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">t</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Sig.</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">VIF</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">r</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Mean</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:left;">Relative Importance</th>
        </tr></thead><tbody>`;

    for (const r of rows) {
        const varName = esc(r.variable_label || r.variable);
        const imp = Number(r.relative_importance || 0);
        const impPct = Math.max(0, (imp / maxImp) * 100);
        const isSig = r.significant === true || r.significant === 'true';
        const vif = Number(r.vif || 0);
        const vifWarn = vif > 10 ? 'color:var(--color-error, #ef4444);font-weight:600;' :
                        vif > 5 ? 'color:var(--color-warning, #f59e0b);font-weight:600;' : '';
        const sigStyle = isSig ? '' : 'opacity:0.5;';

        h += `<tr style="${sigStyle}">
            <td style="border:1px solid ${bc}; padding:4px 8px; white-space:nowrap;">${varName}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right; font-weight:600;">${fmtD(r.std_beta, 4)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${fmtD(r.beta, 4)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${fmtD(r.std_error, 4)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${fmtD(r.t_value, 3)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${fmtP(r.p_value)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right; ${vifWarn}">${fmtD(vif, 2)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${fmtD(r.zero_order_r, 4)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${fmtD(r.mean_score, 3)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; min-width:160px;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <div style="flex:1; height:14px; background:var(--bg-tertiary, #1e293b); border-radius:3px; overflow:hidden;">
                        <div style="height:100%; width:${impPct.toFixed(1)}%; background:var(--brand-primary, #00d4ff); border-radius:3px; transition:width 0.3s;"></div>
                    </div>
                    <span style="font-size:0.72rem; min-width:32px; text-align:right;">${fmtD(imp, 1)}%</span>
                </div>
            </td>
        </tr>`;
    }

    h += `</tbody></table>`;
    return h;
}

/**
 * Render SPSS-style output for frequency / descriptive stats.
 */
function _renderSpssStyle(funcName, varName, varLabel, rows, stats) {
    const esc = s => escapeHtml(String(s ?? ''));
    const fmtN = n => Number(n).toLocaleString();
    const title = `${esc(varName)}${varLabel ? ' ' + esc(varLabel) : ''}`;
    const totalCount = stats.total_count ?? rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const bc = 'var(--border-color, #334155)';

    let h = `<div class="spss-output" style="padding: 14px; font-size: 0.8rem;">`;

    // ── Title ──
    h += `<div style="font-weight:600; margin-bottom:8px;">${title}</div>`;

    if (funcName === 'frequency') {
        // ── N statistics box ──
        h += `<table class="spss-stats" style="border-collapse:collapse; margin-bottom:14px; font-size:0.78rem;">
            <tr><td style="border:1px solid ${bc}; padding:3px 10px; font-weight:600;">N</td>
                <td style="border:1px solid ${bc}; padding:3px 10px;">Valid</td>
                <td style="border:1px solid ${bc}; padding:3px 10px; text-align:right;">${fmtN(totalCount)}</td></tr>
            <tr><td style="border:1px solid ${bc}; padding:3px 10px;"></td>
                <td style="border:1px solid ${bc}; padding:3px 10px;">Missing</td>
                <td style="border:1px solid ${bc}; padding:3px 10px; text-align:right;">0</td></tr>
        </table>`;

        // ── Centered title above frequency table ──
        h += `<div style="text-align:center; font-weight:700; margin-bottom:6px;">${title}</div>`;

        // ── Frequency table ──
        h += `<table class="spss-freq" style="border-collapse:collapse; width:100%; font-size:0.78rem;">`;
        h += `<thead><tr>
            <th style="border:1px solid ${bc}; padding:4px 8px;"></th>
            <th style="border:1px solid ${bc}; padding:4px 8px;"></th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Frequency</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Percent</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Valid Percent</th>
            <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Cumulative Percent</th>
        </tr></thead><tbody>`;

        let cumPercent = 0;
        rows.forEach((r, i) => {
            const count = Number(r.count) || 0;
            const pct = Number(r.percent) || 0;
            cumPercent += pct;
            const valLabel = esc(r.value);
            const firstCol = i === 0 ? `<td style="border:1px solid ${bc}; padding:4px 8px; font-weight:600; vertical-align:top;" rowspan="${rows.length + 1}">Valid</td>` : '';
            h += `<tr>${firstCol}
                <td style="border:1px solid ${bc}; padding:4px 8px;">${valLabel}</td>
                <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${fmtN(count)}</td>
                <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${pct.toFixed(1)}</td>
                <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${pct.toFixed(1)}</td>
                <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${cumPercent.toFixed(1)}</td>
            </tr>`;
        });

        // Total row
        h += `<tr>
            <td style="border:1px solid ${bc}; padding:4px 8px; font-weight:600;">Total</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right; font-weight:600;">${fmtN(totalCount)}</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right; font-weight:600;">100.0</td>
            <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right; font-weight:600;">100.0</td>
            <td style="border:1px solid ${bc}; padding:4px 8px;"></td>
        </tr>`;
        h += `</tbody></table>`;

    } else if (funcName === 'descriptive_stats') {
        // ── Descriptive Statistics table (SPSS style) ──
        // Backend returns one row per group with stats as columns:
        // { n, mean, median_val, std_dev, variance, min_val, max_val, sum_val, p25, p75, ... }
        // We pivot these into Statistic / Value rows.
        const statLabels = {
            n: 'N', mean: 'Mean', median_val: 'Median', std_dev: 'Std. Deviation',
            variance: 'Variance', min_val: 'Minimum', max_val: 'Maximum',
            sum_val: 'Sum', p25: 'Percentile 25', p75: 'Percentile 75'
        };
        const fmtStat = v => {
            if (v === null || v === undefined) return '-';
            const n = Number(v);
            return isNaN(n) ? esc(String(v)) : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
        };

        for (let ri = 0; ri < rows.length; ri++) {
            const r = rows[ri];
            // If grouped, show group header
            const groupKeys = Object.keys(r).filter(k => !statLabels[k] && !k.endsWith('_label'));
            if (groupKeys.length > 0 && rows.length > 1) {
                const groupVal = groupKeys.map(k => esc(String(r[k] ?? ''))).join(', ');
                h += `<div style="font-weight:600; margin:10px 0 4px;">${groupVal}</div>`;
            }

            h += `<table class="spss-desc" style="border-collapse:collapse; width:100%; font-size:0.78rem; margin-bottom:10px;">`;
            h += `<thead><tr>
                <th style="border:1px solid ${bc}; padding:4px 8px; text-align:left;">Statistic</th>
                <th style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">Value</th>
            </tr></thead><tbody>`;

            for (const [key, label] of Object.entries(statLabels)) {
                if (r[key] === undefined) continue;
                const valStr = fmtStat(r[key]);
                const lblKey = key + '_label';
                const valLabel = r[lblKey] ? ` <span style="color:var(--text-secondary);font-size:0.75rem;">(${esc(String(r[lblKey]))})</span>` : '';
                h += `<tr>
                    <td style="border:1px solid ${bc}; padding:4px 8px;">${label}</td>
                    <td style="border:1px solid ${bc}; padding:4px 8px; text-align:right;">${valStr}${valLabel}</td>
                </tr>`;
            }
            h += `</tbody></table>`;
        }
    }

    h += `</div>`;
    return h;
}

function renderFnResults(response, funcName, varName, varLabel) {
    const container = document.getElementById('fnResultsContent');
    if (!container) return;

    const columns = response.columns || [];
    const rows = response.rows || [];
    const stats = response.statistics || {};
    const sigLetters = Array.isArray(stats.column_letters)
        ? stats.column_letters.map(c => c.letter) : [];
    const isTableFunc = (columns.length > 0 && columns[0] === 'row') || sigLetters.length > 0;
    const isVarFunction = (funcName === 'frequency' || funcName === 'descriptive_stats');
    const isRegressionFunc = (funcName === 'driver_regression');

    let html = '';

    // ── SPSS-style rendering for frequency/descriptive ──
    if (isVarFunction && rows.length > 0) {
        html = _renderSpssStyle(funcName, varName, varLabel, rows, stats);
    } else if (isRegressionFunc && rows.length > 0) {
        html = _renderDriverRegression(rows, stats);
    } else {
        // ── Generic markdown rendering for other functions ──
        let md = '';

        // Summary
        if (response.summary) {
            md += `### Summary\n${response.summary}\n\n`;
        }

        // Statistics as markdown table
        if (stats && Object.keys(stats).length > 0) {
            md += `### Statistics\n| Metric | Value |\n|---|---|\n`;
            for (const [key, val] of Object.entries(stats)) {
                let displayVal;
                if (typeof val === 'number') {
                    displayVal = val.toLocaleString(undefined, { maximumFractionDigits: 4 });
                } else if (Array.isArray(val)) {
                    if (val.length > 0 && val[0] && val[0].letter !== undefined) {
                        displayVal = val.map(v => `**${v.letter}**=${v.label || v.value || ''}`).join(', ');
                    } else {
                        displayVal = val.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ');
                    }
                } else if (typeof val === 'object' && val !== null) {
                    displayVal = Object.entries(val).map(([k, v]) => `${k}=${v}`).join(', ');
                } else {
                    displayVal = String(val);
                }
                md += `| ${key} | ${displayVal} |\n`;
            }
            md += '\n';
        }

        // Data table as markdown table with stacked cells
        if (columns.length > 0 && rows.length > 0) {
            md += `### Data (${formatNumber(rows.length)} rows)\n`;
            md += '| ' + columns.map(c => `**${c}**`).join(' | ') + ' |\n';
            md += '|' + columns.map(() => '---').join('|') + '|\n';
            const displayRows = rows.slice(0, 1000);
            for (const row of displayRows) {
                if (Array.isArray(row)) {
                    md += '| ' + row.map(cell => formatCellValue(cell)).join(' | ') + ' |\n';
                } else if (typeof row === 'object' && row !== null) {
                    const cells = [];
                    let colIdx = 0;
                    for (const col of columns) {
                        const val = row[col];
                        const labelKey = col + '_label';
                        const label = row[labelKey];
                        let cellStr = formatCellValue(val);
                        const isRowCol = colIdx === 0;

                        if (isRowCol && isTableFunc) {
                            const trimmed = cellStr.replace(/^ +/, '');
                            if (!trimmed) { cells.push(''); colIdx++; continue; }
                            const indent = cellStr.length - trimmed.length;
                            const prefix = indent > 0 ? '&emsp;'.repeat(indent) : '';
                            const statLabels = ['Mean', 'Median', 'Std Dev', 'Min', 'Max'];
                            const isBold = trimmed === 'Base' || trimmed === 'Total' || indent === 0 || statLabels.includes(trimmed);
                            cells.push(isBold ? `${prefix}**${trimmed}**` : `${prefix}${trimmed}`);
                        } else if (label !== undefined && label !== null) {
                            cells.push(`${cellStr} *${label}*`);
                        } else if (isTableFunc) {
                            cells.push(_formatCellStacked(cellStr, sigLetters));
                        } else {
                            cells.push(cellStr);
                        }
                        colIdx++;
                    }
                    md += '| ' + cells.join(' | ') + ' |\n';
                }
            }
            md += '\n';
        }

        // Render markdown
        if (md) {
            try {
                html = `<div class="fn-summary fn-summary-md" style="padding: 14px;">${(typeof marked !== 'undefined' && marked.parse) ? marked.parse(md) : escapeHtml(md)}</div>`;
            } catch(e) {
                html = `<div class="fn-summary" style="padding: 14px;">${escapeHtml(md)}</div>`;
            }
        }
    }

    if (!html) {
        html = '<div class="fn-results-placeholder">Function returned no data</div>';
    }

    // Remove any loading spinner before appending
    const spinner = container.querySelector('.fn-loading-spinner');
    if (spinner) spinner.remove();

    // Add separator if there's existing content and last child isn't already a separator
    const lastChild = container.lastElementChild;
    if (container.children.length > 0 && (!lastChild || !lastChild.classList.contains('fn-result-separator'))) {
        const sep = document.createElement('div');
        sep.className = 'fn-result-separator';
        sep.style.cssText = 'height: 3px; background: var(--border-color, #334155); margin: 0;';
        container.appendChild(sep);
    }

    // Append new result
    const resultBlock = document.createElement('div');
    resultBlock.innerHTML = html;
    container.appendChild(resultBlock);

    // Lock content width so nothing reflows when popup is resized.
    // Block divs fill container, so temporarily switch to inline-block to measure natural content width.
    resultBlock.style.display = 'inline-block';
    resultBlock.style.minWidth = '100%';
    const contentWidth = resultBlock.offsetWidth;
    resultBlock.style.display = '';
    resultBlock.style.minWidth = contentWidth + 'px';

    // Scroll to the new result
    resultBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Auto-widen popup for driver regression charts
    if (resultBlock.querySelector('.drv-regression-output')) {
        const popup = document.getElementById('fnPopup');
        if (popup && !_fnPopupState.lastWidth) {
            popup.style.width = '960px';
            popup.style.height = '680px';
        }
    }
}

/**
 * Format a table cell value into stacked lines: count, percentage, sig letter.
 * Input: "37,810 (35.1%) A" → "37,810<br>35.1%<br>**A**"
 * Input: "1,07,870 (24.8%)" → "1,07,870<br>24.8%"
 * Input: "4,35,814" → "4,35,814"
 */
function _formatCellStacked(cellStr, sigLetters) {
    if (!cellStr) return '';
    const s = String(cellStr).trim();

    // Pattern: "count (pct%) [letters]"
    const match = s.match(/^(.+?)\s+\(([^)]+%)\)\s*([A-Z]*)$/);
    if (match) {
        const count = match[1].trim();
        const pct = match[2].trim();
        const letters = match[3].trim();
        let result = `${count}<br>${pct}`;
        if (letters) {
            result += `<br>**${letters}**`;
        }
        return result;
    }

    // Just count with possible trailing sig letters
    if (sigLetters.length > 0) {
        const letterMatch = s.match(/^(.+?)\s+([A-Z]+)$/);
        if (letterMatch) {
            return `${letterMatch[1].trim()}<br>**${letterMatch[2]}**`;
        }
    }

    return s;
}

/**
 * Parse a table cell like "37,810 (35.1%) A" into stacked HTML lines:
 *   count on line 1, percentage on line 2, sig letter(s) on line 3.
 * Falls back to plain escaped text if no pattern matches.
 */
function formatTableCellStacked(cellStr, sigLetters) {
    if (cellStr === null || cellStr === undefined || cellStr === '') return '';
    const s = String(cellStr).trim();
    if (!s) return '';

    // Pattern: "count (pct%) [letters]" or "count (pct%)" or just "count"
    // Examples: "37,810 (35.1%) A", "1,07,870 (24.8%)", "4,35,814"
    const match = s.match(/^(.+?)\s+\(([^)]+%)\)\s*([A-Z]*)$/);
    if (match) {
        const count = match[1].trim();
        const pct = match[2].trim();
        const letters = match[3].trim();
        let html = `<span class="fn-cell-count">${escapeHtml(count)}</span>`;
        html += `<span class="fn-cell-pct">${escapeHtml(pct)}</span>`;
        if (letters) {
            html += `<span class="fn-cell-sig">${escapeHtml(letters)}</span>`;
        }
        return html;
    }

    // No percentage — just a count possibly with sig letters (e.g. base row "4,35,814")
    // Check for trailing sig letters
    if (sigLetters.length > 0) {
        const letterMatch = s.match(/^(.+?)\s+([A-Z]+)$/);
        if (letterMatch) {
            return `<span class="fn-cell-count">${escapeHtml(letterMatch[1].trim())}</span><span class="fn-cell-sig">${escapeHtml(letterMatch[2])}</span>`;
        }
    }

    return `<span class="fn-cell-count">${escapeHtml(s)}</span>`;
}

/**
 * Format a cell value with significance letters highlighted (fallback for non-stacked rendering).
 */
function formatCellWithSig(cellStr, sigLetters) {
    if (!sigLetters || sigLetters.length === 0) return escapeHtml(cellStr);
    const s = String(cellStr);
    // Check for trailing sig letters like " A" or " AB"
    const match = s.match(/^(.+?)\s+([A-Z]+)$/);
    if (match) {
        return `${escapeHtml(match[1])} <span class="fn-sig-letter">${escapeHtml(match[2])}</span>`;
    }
    return escapeHtml(s);
}

function renderFnError(message) {
    const container = document.getElementById('fnResultsContent');
    if (!container) return;
    // Remove any loading spinner before appending error
    const spinner = container.querySelector('.fn-loading-spinner');
    if (spinner) spinner.remove();
    const errDiv = document.createElement('div');
    errDiv.innerHTML = `<div class="query-error" style="margin: 12px;">${escapeHtml(message)}</div>`;
    container.appendChild(errDiv);
}

function clearFnResults() {
    const container = document.getElementById('fnResultsContent');
    if (container) {
        container.innerHTML = '';
    }
    const execInfo = document.getElementById('fnExecInfo');
    if (execInfo) execInfo.textContent = '';
    closeFnPopup();
}

// ============================================
// FLOATING RESULTS POPUP
// ============================================

let _fnPopupState = { lastTop: null, lastLeft: null, lastWidth: null, lastHeight: null };

function showFnPopup(execTimeMs, rowCount) {
    const popup = document.getElementById('fnPopup');
    const pill = document.getElementById('fnPopupPill');
    const info = document.getElementById('fnPopupInfo');
    if (!popup) return;

    // Restore last position/size if we have one
    if (_fnPopupState.lastTop !== null) {
        popup.style.top = _fnPopupState.lastTop;
        popup.style.left = _fnPopupState.lastLeft;
        popup.style.right = 'auto';
        popup.style.width = _fnPopupState.lastWidth;
        popup.style.height = _fnPopupState.lastHeight;
    }

    popup.classList.add('visible');
    if (pill) pill.classList.remove('visible');

    // Show info
    if (info) {
        if (execTimeMs || rowCount) {
            info.textContent = `${formatNumber(rowCount)} rows in ${execTimeMs}ms`;
        } else {
            info.textContent = '';
        }
    }
}

function closeFnPopup() {
    const popup = document.getElementById('fnPopup');
    const pill = document.getElementById('fnPopupPill');
    if (popup) popup.classList.remove('visible');
    if (pill) pill.classList.remove('visible');
    // Clear all results when window is closed
    const container = document.getElementById('fnResultsContent');
    if (container) container.innerHTML = '';
    const info = document.getElementById('fnPopupInfo');
    if (info) info.textContent = '';
}

function minimizeFnPopup() {
    const popup = document.getElementById('fnPopup');
    const pill = document.getElementById('fnPopupPill');
    const pillInfo = document.getElementById('fnPillInfo');
    const popupInfo = document.getElementById('fnPopupInfo');

    if (!popup) return;

    // Save current position/size before hiding
    _fnPopupState.lastTop = popup.style.top || popup.offsetTop + 'px';
    _fnPopupState.lastLeft = popup.style.left || null;
    _fnPopupState.lastWidth = popup.style.width || popup.offsetWidth + 'px';
    _fnPopupState.lastHeight = popup.style.height || popup.offsetHeight + 'px';

    popup.classList.remove('visible');
    if (pill) pill.classList.add('visible');
    if (pillInfo && popupInfo) pillInfo.textContent = popupInfo.textContent;
}

function restoreFnPopup() {
    const popup = document.getElementById('fnPopup');
    const pill = document.getElementById('fnPopupPill');
    if (!popup) return;

    // Restore saved position/size
    if (_fnPopupState.lastTop !== null) {
        popup.style.top = _fnPopupState.lastTop;
        popup.style.left = _fnPopupState.lastLeft;
        popup.style.right = _fnPopupState.lastLeft ? 'auto' : '';
        popup.style.width = _fnPopupState.lastWidth;
        popup.style.height = _fnPopupState.lastHeight;
    }

    popup.classList.add('visible');
    if (pill) pill.classList.remove('visible');
}

// Drag logic for popup header
(function initFnPopupDrag() {
    document.addEventListener('DOMContentLoaded', () => {
        const header = document.getElementById('fnPopupHeader');
        const popup = document.getElementById('fnPopup');
        if (!header || !popup) return;

        let isDragging = false, offsetX = 0, offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            // Don't drag if clicking a button
            if (e.target.closest('.fn-popup-btn') || e.target.closest('.fn-popup-actions')) return;
            isDragging = true;
            const rect = popup.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            // Immediately convert to left-based positioning
            popup.style.left = rect.left + 'px';
            popup.style.top = rect.top + 'px';
            popup.style.right = 'auto';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const navbarH = 70; // navbar height — popup must stay below it
            let newTop = e.clientY - offsetY;
            let newLeft = e.clientX - offsetX;
            // Clamp: never above navbar, never off-screen edges
            newTop = Math.max(navbarH, Math.min(newTop, window.innerHeight - 40));
            newLeft = Math.max(-popup.offsetWidth + 100, Math.min(newLeft, window.innerWidth - 100));
            popup.style.left = newLeft + 'px';
            popup.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                // Save position
                _fnPopupState.lastTop = popup.style.top;
                _fnPopupState.lastLeft = popup.style.left;
            }
        });
    });
})();

// Resize logic for bottom-right handle
(function initFnPopupResize() {
    document.addEventListener('DOMContentLoaded', () => {
        const handle = document.getElementById('fnPopupResizeHandle');
        const popup = document.getElementById('fnPopup');
        if (!handle || !popup) return;

        let isResizing = false, startX, startY, startW, startH;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startW = popup.offsetWidth;
            startH = popup.offsetHeight;
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newW = Math.max(400, startW + (e.clientX - startX));
            const newH = Math.max(300, startH + (e.clientY - startY));
            popup.style.width = newW + 'px';
            popup.style.height = newH + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                // Save size
                _fnPopupState.lastWidth = popup.style.width;
                _fnPopupState.lastHeight = popup.style.height;
            }
        });
    });
})();

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

// ============================================
// QUESTIONS TAB
// ============================================

function populateQuestionFileFilter() {
    const sel = document.getElementById('questionFileFilter');
    if (!sel) return;
    sel.innerHTML = '';
    const readyFiles = files.filter(f => f.status === 'ready');
    readyFiles.forEach(f => {
        sel.innerHTML += `<option value="${f.id}">${escapeHtml(f.file_name || f.fileName)}</option>`;
    });
    // Auto-select first ready file
    if (readyFiles.length > 0) {
        sel.value = readyFiles[0].id;
    }

    // Convert to searchable dropdown
    if (typeof convertSelectToSearchable === 'function') {
        if (questionFileDropdown) questionFileDropdown.destroy();
        questionFileDropdown = convertSelectToSearchable('questionFileFilter', {
            placeholder: 'Select file...',
            searchPlaceholder: 'Search files...',
            onChange: () => loadQuestions()
        });
        if (readyFiles.length > 0) {
            questionFileDropdown.setValue(readyFiles[0].id);
        }
    }

    // Convert question type filter once
    if (!questionTypeDropdown && typeof convertSelectToSearchable === 'function') {
        questionTypeDropdown = convertSelectToSearchable('questionTypeFilter', {
            placeholder: 'All types',
            searchPlaceholder: 'Search types...',
            onChange: () => filterQuestions()
        });
    }
}

function getQuestionFileFilterValue() {
    if (questionFileDropdown) return questionFileDropdown.getValue() || '';
    return document.getElementById('questionFileFilter')?.value || '';
}

function getQuestionTypeFilterValue() {
    if (questionTypeDropdown) return questionTypeDropdown.getValue() || '';
    return document.getElementById('questionTypeFilter')?.value || '';
}

async function loadQuestions() {
    const fileId = getQuestionFileFilterValue();
    if (!fileId) {
        document.getElementById('questionsEmpty').style.display = 'flex';
        document.getElementById('questionsContent').innerHTML = '';
        document.getElementById('questionsToolbar').style.display = 'none';
        return;
    }

    const loadingEl = document.getElementById('questionsLoading');
    const contentEl = document.getElementById('questionsContent');
    const emptyEl = document.getElementById('questionsEmpty');
    const toolbarEl = document.getElementById('questionsToolbar');

    loadingEl.style.display = 'flex';
    contentEl.innerHTML = '';
    emptyEl.style.display = 'none';

    try {
        const resp = await api.request(`/research/projects/${projectId}/files/${fileId}/questions`);
        loadingEl.style.display = 'none';

        if (!resp.success || !resp.questions || resp.questions.length === 0) {
            emptyEl.style.display = 'flex';
            toolbarEl.style.display = 'none';
            questionsLoaded = true;
            return;
        }

        // Attach file name for panel display
        let selectedFileName = '-';
        if (questionFileDropdown) {
            const opt = questionFileDropdown.options.find(o => String(o.value) === String(fileId));
            selectedFileName = opt ? opt.label : '-';
        } else {
            const fileSelect = document.getElementById('questionFileFilter');
            selectedFileName = fileSelect?.options[fileSelect.selectedIndex]?.text || '-';
        }
        questionsData = resp.questions.map(q => ({ ...q, _fileName: selectedFileName }));
        filteredQuestions = [...questionsData];
        qCurrentPage = 1;
        questionsLoaded = true;
        toolbarEl.style.display = 'flex';
        renderQuestions();
    } catch (err) {
        loadingEl.style.display = 'none';
        contentEl.innerHTML = `<div class="query-error">Failed to load questions: ${escapeHtml(err.message)}</div>`;
    }
}

function filterQuestions() {
    qCurrentPage = 1;
    const search = (document.getElementById('questionSearch')?.value || '').toLowerCase();
    const typeFilter = getQuestionTypeFilterValue();

    filteredQuestions = questionsData.filter(q => {
        if (typeFilter && q.question_type !== typeFilter) return false;
        if (search) {
            const matchLabel = (q.question_label || '').toLowerCase().includes(search);
            const matchId = (q.question_id || '').toLowerCase().includes(search);
            const matchVars = (q.variable_names || []).some(v => v.toLowerCase().includes(search));
            const matchAttrs = (q.attribute_labels || []).some(a => a.toLowerCase().includes(search));
            if (!matchLabel && !matchId && !matchVars && !matchAttrs) return false;
        }
        return true;
    });

    renderQuestions();
}

function renderQuestions() {
    const contentEl = document.getElementById('questionsContent');
    const countLabel = document.getElementById('questionCountLabel');

    if (filteredQuestions.length === 0) {
        contentEl.innerHTML = '<div class="empty-state"><p>No matching questions</p></div>';
        if (countLabel) countLabel.textContent = '';
        return;
    }

    if (countLabel) {
        countLabel.textContent = `${filteredQuestions.length} of ${questionsData.length} questions`;
    }

    // Pagination
    const totalPages = Math.ceil(filteredQuestions.length / qPageSize);
    if (qCurrentPage > totalPages) qCurrentPage = totalPages;
    if (qCurrentPage < 1) qCurrentPage = 1;
    const startIdx = (qCurrentPage - 1) * qPageSize;
    const pageQuestions = filteredQuestions.slice(startIdx, startIdx + qPageSize);

    // Desktop table
    const tableHtml = `
        <div class="questions-table-container">
            <table class="questions-table">
                <thead><tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>Question ID</th>
                    <th>Label</th>
                    <th>Variables</th>
                    <th>Confidence</th>
                    <th>Details</th>
                </tr></thead>
                <tbody>
                    ${pageQuestions.map((q, i) => {
                        const conf = q.confidence || 0;
                        const confClass = conf >= 0.7 ? 'high' : conf >= 0.4 ? 'medium' : 'low';
                        const confPct = Math.round(conf * 100);
                        const rowIdx = startIdx + i;
                        const qLabel = q.question_label || q.question_id || '';
                        return `<tr>
                            <td style="color:var(--text-muted);font-size:0.72rem;">${rowIdx + 1}</td>
                            <td><span class="question-type-badge ${q.question_type || 'unknown'}">${(q.question_type || 'unknown').replace(/_/g, ' ')}</span></td>
                            <td><span class="question-id-cell">${escapeHtml(q.question_id || '-')}</span></td>
                            <td><span class="question-label-cell" title="${escapeHtml(qLabel)}">${escapeHtml(truncate(qLabel, 60)) || '-'}</span></td>
                            <td style="text-align:center;">${q.variable_count || 0}</td>
                            <td>
                                <span class="question-confidence">
                                    <span class="confidence-dot ${confClass}"></span>
                                    ${confPct}%
                                </span>
                            </td>
                            <td><button class="question-view-btn" onclick="openQuestionPanel(${rowIdx})">View</button></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;

    // Mobile cards
    const cardsHtml = `
        <div class="questions-cards-mobile">
            ${pageQuestions.map((q, i) => {
                const conf = q.confidence || 0;
                const confClass = conf >= 0.7 ? 'high' : conf >= 0.4 ? 'medium' : 'low';
                const confPct = Math.round(conf * 100);
                const rowIdx = startIdx + i;
                const qLabel = q.question_label || q.question_id || '';
                return `<div class="question-card-mobile">
                    <div class="question-card-mobile-header">
                        <span class="question-type-badge ${q.question_type || 'unknown'}">${(q.question_type || 'unknown').replace(/_/g, ' ')}</span>
                        <span class="question-card-mobile-label">${escapeHtml(qLabel)}</span>
                    </div>
                    <div class="question-card-mobile-meta">
                        <div class="question-card-mobile-meta-left">
                            <span>${q.variable_count || 0} vars</span>
                            <span class="question-confidence">
                                <span class="confidence-dot ${confClass}"></span>
                                ${confPct}%
                            </span>
                        </div>
                        <button class="question-view-btn" onclick="openQuestionPanel(${rowIdx})">View</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;

    // Pagination controls
    const paginationHtml = renderQPagination(filteredQuestions.length, qCurrentPage, qPageSize, totalPages);

    contentEl.innerHTML = tableHtml + cardsHtml + paginationHtml;
}

function renderQPagination(totalItems, currentPage, pageSize, totalPages) {
    if (totalItems <= pageSize) return '';
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    let pageButtons = '';
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

    if (startPage > 1) {
        pageButtons += `<button class="pagination-btn" onclick="goToQPage(1)">1</button>`;
        if (startPage > 2) pageButtons += `<span style="color:var(--text-muted);padding:0 4px;">...</span>`;
    }
    for (let p = startPage; p <= endPage; p++) {
        pageButtons += `<button class="pagination-btn ${p === currentPage ? 'active' : ''}" onclick="goToQPage(${p})">${p}</button>`;
    }
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) pageButtons += `<span style="color:var(--text-muted);padding:0 4px;">...</span>`;
        pageButtons += `<button class="pagination-btn" onclick="goToQPage(${totalPages})">${totalPages}</button>`;
    }

    return `
        <div class="pagination-container">
            <div class="pagination-info">Showing ${startItem}-${endItem} of ${totalItems} questions</div>
            <div class="pagination-controls">
                <button class="pagination-btn" onclick="goToQPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                ${pageButtons}
                <button class="pagination-btn" onclick="goToQPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
            <div class="pagination-per-page">
                <span style="font-size:0.75rem;color:var(--text-muted);">Per page:</span>
                <select onchange="changeQPageSize(this.value)">
                    <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
                    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                </select>
            </div>
        </div>`;
}

function goToQPage(page) {
    qCurrentPage = page;
    renderQuestions();
    const el = document.getElementById('questionsContent');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changeQPageSize(size) {
    qPageSize = parseInt(size, 10);
    qCurrentPage = 1;
    renderQuestions();
}

function openQuestionPanel(idx) {
    const q = filteredQuestions[idx];
    if (!q) return;

    const panel = document.getElementById('questionSlidePanel');
    const overlay = document.getElementById('questionPanelOverlay');
    const body = document.getElementById('questionPanelBody');

    const qId = q.question_id || '-';
    const qLabel = q.question_label || q.question_id || '';
    const qType = q.question_type || 'unknown';
    const conf = q.confidence || 0;
    const confClass = conf >= 0.7 ? 'high' : conf >= 0.4 ? 'medium' : 'low';
    const confPct = Math.round(conf * 100);
    const varCount = q.variable_count || 0;

    // Build variable-attribute mapping table
    let varAttrMap = {};
    if (q.variable_attribute_map) {
        q.variable_attribute_map.split(',').forEach(pair => {
            const [varName, attr] = pair.split('=').map(s => s.trim());
            if (varName && attr) varAttrMap[varName] = attr;
        });
    }

    let varTableHtml = '';
    const varNames = q.variable_names || [];
    if (varNames.length > 0) {
        const varRows = varNames.map((v, vi) => {
            const attr = varAttrMap[v] || (q.attribute_labels && q.attribute_labels[vi]) || '-';
            return `<tr><td class="qv-name">${escapeHtml(v)}</td><td>${escapeHtml(attr)}</td></tr>`;
        }).join('');

        varTableHtml = `
            <div class="q-panel-section-header">
                Variable Mapping
                <span class="q-panel-section-count">${varNames.length}</span>
            </div>
            <div class="q-panel-info-card" style="padding:0; overflow:hidden;">
                <table class="q-panel-var-table">
                    <thead><tr><th>Variable Name</th><th>Attribute Label</th></tr></thead>
                    <tbody>${varRows}</tbody>
                </table>
            </div>`;
    }

    // Value labels section — parse JSON into Code/Label table (mirrors var panel)
    let valueLabelsHtml = '';
    if (q.shared_value_labels) {
        let parsedLabels = null;
        try {
            parsedLabels = typeof q.shared_value_labels === 'string'
                ? JSON.parse(q.shared_value_labels)
                : q.shared_value_labels;
        } catch (e) {
            parsedLabels = null;
        }
        if (parsedLabels && typeof parsedLabels === 'object' && Object.keys(parsedLabels).length > 0) {
            const entries = Object.entries(parsedLabels);
            valueLabelsHtml = `
                <div class="q-panel-section-header">
                    Value Labels
                    <span class="q-panel-section-count">${entries.length}</span>
                </div>
                <div class="q-panel-info-card" style="padding:0; overflow:hidden;">
                    <table class="q-panel-var-table">
                        <thead><tr><th>Code</th><th>Label</th></tr></thead>
                        <tbody>
                            ${entries.map(([key, val]) => `
                                <tr>
                                    <td class="qv-name">${escapeHtml(key)}</td>
                                    <td>${escapeHtml(String(val))}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else {
            // Fallback: show raw string if not valid JSON
            valueLabelsHtml = `
                <div class="q-panel-section-header">Value Labels</div>
                <div class="q-panel-info-card">
                    <div class="q-panel-value-labels">${escapeHtml(q.shared_value_labels)}</div>
                </div>`;
        }
    }

    body.innerHTML = `
        <div class="q-panel-info-card">
            <div class="q-panel-question-label">${escapeHtml(qLabel)}</div>
            <div class="q-panel-question-id">${escapeHtml(qId)}</div>
            <div class="q-panel-meta-grid">
                <div class="q-panel-meta-item">
                    <span class="q-panel-meta-label">Type</span>
                    <span class="q-panel-meta-value"><span class="question-type-badge ${qType}">${qType.replace(/_/g, ' ')}</span></span>
                </div>
                <div class="q-panel-meta-item">
                    <span class="q-panel-meta-label">Confidence</span>
                    <span class="q-panel-meta-value">
                        <span class="question-confidence">
                            <span class="confidence-dot ${confClass}"></span>
                            ${confPct}%
                        </span>
                    </span>
                </div>
                <div class="q-panel-meta-item">
                    <span class="q-panel-meta-label">Variables</span>
                    <span class="q-panel-meta-value">${varCount}</span>
                </div>
                <div class="q-panel-meta-item">
                    <span class="q-panel-meta-label">Source File</span>
                    <span class="q-panel-meta-value" style="font-size:0.75rem;">${escapeHtml(q._fileName || '-')}</span>
                </div>
            </div>
        </div>
        ${varTableHtml}
        ${valueLabelsHtml}
    `;

    panel.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeQuestionPanel() {
    const panel = document.getElementById('questionSlidePanel');
    const overlay = document.getElementById('questionPanelOverlay');
    panel.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================
// EMBED SETTINGS — Multiple Embeds per Project
// ============================================
let embedConfigs = [];
let editingEmbedConfig = null;   // null = creating new
let embedSelectedFileIds = new Set();
let embedFilesDropdownOpen = false;

// ---- Modal open: list view ----
async function openEmbedSettingsModal() {
    const modal = document.getElementById('embedSettingsModal');
    if (!modal) return;
    modal.classList.add('active');

    // Always start on list view
    showEmbedListView();

    // Fetch all configs for this project
    try {
        embedConfigs = await api.request(`/research/embed/configs/${projectId}`);
    } catch (err) {
        embedConfigs = [];
    }
    renderEmbedList();
}

function showEmbedListView() {
    const listView = document.getElementById('embedListView');
    const detailView = document.getElementById('embedDetailView');
    const backBtn = document.getElementById('embedBackBtn');
    const title = document.getElementById('embedModalTitle');
    if (listView) listView.style.display = '';
    if (detailView) detailView.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';
    if (title) title.textContent = 'Embed Links';
}

function showEmbedDetailView(label) {
    const listView = document.getElementById('embedListView');
    const detailView = document.getElementById('embedDetailView');
    const backBtn = document.getElementById('embedBackBtn');
    const title = document.getElementById('embedModalTitle');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';
    if (backBtn) backBtn.style.display = '';
    if (title) title.textContent = label;
}

// ---- List rendering ----
function renderEmbedList() {
    const container = document.getElementById('embedListContainer');
    if (!container) return;

    if (embedConfigs.length === 0) {
        container.innerHTML = '<div class="embed-list-empty">No embed links yet. Create one to get started.</div>';
        return;
    }

    container.innerHTML = embedConfigs.map(c => {
        const fileCount = (c.FileIds || c.file_ids || []).length;
        const keyShort = (c.EmbedKey || c.embed_key || '').substring(0, 10) + '...';
        const enabled = c.IsEnabled ?? c.is_enabled ?? false;
        const name = c.Name || c.name || 'Default';
        const id = c.Id || c.id;
        return `<div class="embed-list-card">
            <div class="embed-list-info">
                <div class="embed-list-name">${escapeHtml(name)}</div>
                <div class="embed-list-meta">${fileCount} file${fileCount !== 1 ? 's' : ''} · ${keyShort}</div>
            </div>
            <span class="embed-list-badge ${enabled ? 'enabled' : 'disabled'}">${enabled ? 'Enabled' : 'Disabled'}</span>
            <div class="embed-list-actions">
                <button onclick="openEmbedDetail('${id}')">Edit</button>
                <button class="delete-btn" onclick="deleteEmbedConfig('${id}', '${escapeHtml(name)}')">Delete</button>
            </div>
        </div>`;
    }).join('');
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

// ---- Detail view (edit / create) ----
function openEmbedDetail(configId) {
    if (configId) {
        // Normalise keys — API may return PascalCase or snake_case
        editingEmbedConfig = embedConfigs.find(c => (c.Id || c.id) === configId) || null;
        if (!editingEmbedConfig) { showToast('Config not found', 'error'); return; }
        showEmbedDetailView('Edit: "' + (editingEmbedConfig.Name || editingEmbedConfig.name || 'Default') + '"');
    } else {
        editingEmbedConfig = null;
        showEmbedDetailView('New Embed');
    }

    const cfg = editingEmbedConfig;
    const g = (pascal, snake) => cfg ? (cfg[pascal] ?? cfg[snake] ?? null) : null;

    // Name
    const nameInput = document.getElementById('embedName');
    if (nameInput) nameInput.value = g('Name', 'name') || '';

    // Toggle
    const isEnabled = g('IsEnabled', 'is_enabled') || false;
    const toggle = document.getElementById('embedEnabled');
    if (toggle) toggle.checked = isEnabled;
    const track = document.getElementById('embedToggleTrack');
    if (track) track.classList.toggle('active', isEnabled);

    // Files
    const fids = g('FileIds', 'file_ids') || [];
    embedSelectedFileIds = new Set(fids.map(id => id.toString()));
    populateEmbedFileDropdown();

    // Domains
    const domainsInput = document.getElementById('embedDomains');
    if (domainsInput) domainsInput.value = (g('AllowedDomains', 'allowed_domains') || []).join(', ');

    // Theme
    const hc = g('HeaderColor', 'header_color') || '';
    const ac = g('AccentColor', 'accent_color') || '';
    const headerColorInput = document.getElementById('embedHeaderColor');
    if (headerColorInput) headerColorInput.value = hc;
    const accentColorInput = document.getElementById('embedAccentColor');
    if (accentColorInput) accentColorInput.value = ac;
    const logoUrlInput = document.getElementById('embedLogoUrl');
    if (logoUrlInput) logoUrlInput.value = g('LogoUrl', 'logo_url') || '';

    // Font color
    const fc = g('FontColor', 'font_color') || '';
    const fontColorInput = document.getElementById('embedFontColor');
    if (fontColorInput) fontColorInput.value = fc;
    const fPicker = document.getElementById('embedFontColorPicker');
    const fSwatch = document.getElementById('embedFontSwatch');
    if (fPicker && fc) { fPicker.value = fc; if (fSwatch) fSwatch.style.background = fc; }
    else if (fSwatch) fSwatch.style.background = '';

    // Widget mode (dark/light)
    const theme = g('Theme', 'theme') || 'light';
    setEmbedTheme(theme, false);

    // Sync color swatches
    const hPicker = document.getElementById('embedHeaderColorPicker');
    const hSwatch = document.getElementById('embedHeaderSwatch');
    if (hPicker && hc) { hPicker.value = hc; if (hSwatch) hSwatch.style.background = hc; }
    else if (hSwatch) hSwatch.style.background = '';
    const aPicker = document.getElementById('embedAccentColorPicker');
    const aSwatch = document.getElementById('embedAccentSwatch');
    if (aPicker && ac) { aPicker.value = ac; if (aSwatch) aSwatch.style.background = ac; }
    else if (aSwatch) aSwatch.style.background = '';

    // Embed code + regen — only for existing configs
    const codeSection = document.getElementById('embedCodeSection');
    const regenBtn = document.getElementById('embedRegenBtn');
    if (cfg) {
        if (codeSection) codeSection.style.display = '';
        if (regenBtn) regenBtn.style.display = '';
        updateEmbedCodeSnippet();
    } else {
        if (codeSection) codeSection.style.display = 'none';
        if (regenBtn) regenBtn.style.display = 'none';
    }

    // Close files dropdown
    closeEmbedFilesDropdown();
}

function backToEmbedList() {
    editingEmbedConfig = null;
    closeEmbedFilesDropdown();
    showEmbedListView();
    renderEmbedList();
}

// ---- Multi-select file dropdown ----
function populateEmbedFileDropdown() {
    renderEmbedFileOptions();
    updateEmbedFileCount();
}

function toggleEmbedFilesDropdown() {
    embedFilesDropdownOpen = !embedFilesDropdownOpen;
    const trigger = document.getElementById('embedFilesTrigger');
    const menu = document.getElementById('embedFilesMenu');
    if (trigger) trigger.classList.toggle('open', embedFilesDropdownOpen);
    if (menu) menu.classList.toggle('open', embedFilesDropdownOpen);
    if (embedFilesDropdownOpen) {
        const searchInput = document.getElementById('embedFileSearch');
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        renderEmbedFileOptions();
    }
}

function closeEmbedFilesDropdown() {
    embedFilesDropdownOpen = false;
    const trigger = document.getElementById('embedFilesTrigger');
    const menu = document.getElementById('embedFilesMenu');
    if (trigger) trigger.classList.remove('open');
    if (menu) menu.classList.remove('open');
}

function filterEmbedFileOptions(query) {
    renderEmbedFileOptions(query);
}

function renderEmbedFileOptions(query) {
    const container = document.getElementById('embedFileOptions');
    if (!container) return;

    const q = (query || '').toLowerCase().trim();
    const readyFiles = files.filter(f => f.status === 'ready');

    if (readyFiles.length === 0) {
        container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:0.8rem;">No ready files</div>';
        return;
    }

    // Sort: selected first, then alphabetical
    const sorted = [...readyFiles].sort((a, b) => {
        const aOn = embedSelectedFileIds.has(a.id.toString()) ? 0 : 1;
        const bOn = embedSelectedFileIds.has(b.id.toString()) ? 0 : 1;
        if (aOn !== bOn) return aOn - bOn;
        return a.file_name.localeCompare(b.file_name);
    });

    const filtered = q ? sorted.filter(f => f.file_name.toLowerCase().includes(q)) : sorted;

    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:0.8rem;">No matching files</div>';
        return;
    }

    container.innerHTML = filtered.map(f => {
        const isOn = embedSelectedFileIds.has(f.id.toString());
        return `<div class="embed-files-option" onclick="toggleEmbedFileSelection(event, '${f.id}')">
            <span class="embed-files-option-name">${escapeHtml(f.file_name)}</span>
            <span class="embed-file-mini-toggle ${isOn ? 'on' : ''}"></span>
        </div>`;
    }).join('');
}

function toggleEmbedFileSelection(event, fileId) {
    event.stopPropagation();
    const idStr = fileId.toString();
    if (embedSelectedFileIds.has(idStr)) {
        embedSelectedFileIds.delete(idStr);
    } else {
        embedSelectedFileIds.add(idStr);
    }
    // Update toggle in-place
    const opt = event.currentTarget;
    const tog = opt?.querySelector('.embed-file-mini-toggle');
    if (tog) tog.classList.toggle('on', embedSelectedFileIds.has(idStr));
    updateEmbedFileCount();
}

function updateEmbedFileCount() {
    const el = document.getElementById('embedFilesCount');
    if (el) {
        const n = embedSelectedFileIds.size;
        el.textContent = `${n} file${n !== 1 ? 's' : ''} selected`;
    }
}

function embedSelectAllFiles() {
    const readyFiles = files.filter(f => f.status === 'ready');
    readyFiles.forEach(f => embedSelectedFileIds.add(f.id.toString()));
    renderEmbedFileOptions();
    updateEmbedFileCount();
}

function embedDeselectAllFiles() {
    embedSelectedFileIds.clear();
    renderEmbedFileOptions();
    updateEmbedFileCount();
}

// ---- Toggle, color, code helpers ----
function toggleEmbed() {
    const toggle = document.getElementById('embedEnabled');
    const track = document.getElementById('embedToggleTrack');
    if (!toggle || !track) return;
    toggle.checked = !toggle.checked;
    track.classList.toggle('active', toggle.checked);
}

function setEmbedTheme(theme, updateSnippet = true) {
    const lightBtn = document.getElementById('embedThemeLight');
    const darkBtn = document.getElementById('embedThemeDark');
    if (lightBtn) lightBtn.classList.toggle('active', theme === 'light');
    if (darkBtn) darkBtn.classList.toggle('active', theme === 'dark');
    // Store on a data attribute for save
    const switcher = document.querySelector('.embed-theme-switcher');
    if (switcher) switcher.dataset.theme = theme;
    if (updateSnippet) updateEmbedCodeSnippet();
}

function getSelectedEmbedTheme() {
    const switcher = document.querySelector('.embed-theme-switcher');
    return switcher?.dataset.theme || 'light';
}

function syncColorSwatch(hexInput, pickerId, swatchId) {
    const val = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        const picker = document.getElementById(pickerId);
        const swatch = document.getElementById(swatchId);
        if (picker) picker.value = val;
        if (swatch) swatch.style.background = val;
    }
}

function getEmbedWidgetUrl() {
    const frontendBase = window.location.origin;
    return `${frontendBase}/embed/widget.js`;
}

function getResearchApiUrl() {
    return CONFIG.endpoints.research || 'https://localhost:5114';
}

function updateEmbedCodeSnippet() {
    const snippet = document.getElementById('embedCodeSnippet');
    if (!snippet) return;
    const cfg = editingEmbedConfig;
    const key = cfg ? (cfg.EmbedKey || cfg.embed_key) : null;
    if (!key) {
        snippet.value = 'Save settings first to generate an embed key.';
        return;
    }
    const widgetUrl = getEmbedWidgetUrl();
    const apiUrl = getResearchApiUrl();
    snippet.value = `<script src="${widgetUrl}" data-key="${key}" data-api="${apiUrl}"><\/script>`;
}

function copyEmbedCode() {
    const snippet = document.getElementById('embedCodeSnippet');
    if (!snippet) return;
    navigator.clipboard.writeText(snippet.value).then(() => {
        const btn = snippet.parentElement.querySelector('button');
        if (btn) {
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = original; }, 1500);
        }
    }).catch(() => {
        snippet.select();
        document.execCommand('copy');
    });
}

// ---- Save (create or update) ----
async function saveEmbedConfig() {
    const name = document.getElementById('embedName')?.value?.trim() || 'Default';
    const isEnabled = document.getElementById('embedEnabled')?.checked || false;
    const fileIds = Array.from(embedSelectedFileIds);

    const domainsRaw = document.getElementById('embedDomains')?.value || '';
    const allowedDomains = domainsRaw.split(',').map(d => d.trim()).filter(d => d.length > 0);

    // Send empty string "" to explicitly clear a field; null would keep existing value
    const headerColor = document.getElementById('embedHeaderColor')?.value?.trim() ?? '';
    const accentColor = document.getElementById('embedAccentColor')?.value?.trim() ?? '';
    const fontColor = document.getElementById('embedFontColor')?.value?.trim() ?? '';
    const logoUrl = document.getElementById('embedLogoUrl')?.value?.trim() ?? '';

    const theme = getSelectedEmbedTheme();

    const body = {
        name,
        is_enabled: isEnabled,
        file_ids: fileIds,
        allowed_domains: allowedDomains.length > 0 ? allowedDomains : null,
        header_color: headerColor,
        accent_color: accentColor,
        font_color: fontColor,
        logo_url: logoUrl,
        theme
    };

    try {
        let res;
        if (editingEmbedConfig) {
            // Update existing
            const configId = editingEmbedConfig.Id || editingEmbedConfig.id;
            res = await api.request(`/research/embed/config/${configId}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
        } else {
            // Create new
            res = await api.request(`/research/embed/configs/${projectId}`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
        }

        // Refresh list
        try { embedConfigs = await api.request(`/research/embed/configs/${projectId}`); } catch {}

        if (editingEmbedConfig) {
            // Stay on detail with updated data
            const configId = res.Id || res.id;
            editingEmbedConfig = embedConfigs.find(c => (c.Id || c.id) === configId) || res;
            updateEmbedCodeSnippet();
            // Show code & regen now that config exists
            const codeSection = document.getElementById('embedCodeSection');
            const regenBtn = document.getElementById('embedRegenBtn');
            if (codeSection) codeSection.style.display = '';
            if (regenBtn) regenBtn.style.display = '';
        } else {
            // New config created — switch to editing it
            const configId = res.Id || res.id;
            editingEmbedConfig = embedConfigs.find(c => (c.Id || c.id) === configId) || res;
            showEmbedDetailView('Edit: "' + name + '"');
            updateEmbedCodeSnippet();
            const codeSection = document.getElementById('embedCodeSection');
            const regenBtn = document.getElementById('embedRegenBtn');
            if (codeSection) codeSection.style.display = '';
            if (regenBtn) regenBtn.style.display = '';
        }

        showToast('Embed settings saved', 'success');
    } catch (err) {
        showToast('Failed to save embed settings: ' + (err.message || err), 'error');
    }
}

// ---- Delete ----
async function deleteEmbedConfig(configId, name) {
    const confirmed = await showConfirm(`Delete embed "${name}"? This will break any widgets using this embed key.`, 'Delete Embed', 'danger');
    if (!confirmed) return;
    try {
        await api.request(`/research/embed/config/${configId}`, { method: 'DELETE' });
        embedConfigs = embedConfigs.filter(c => (c.Id || c.id) !== configId);
        renderEmbedList();
        showToast('Embed deleted', 'success');
    } catch (err) {
        showToast('Failed to delete: ' + (err.message || err), 'error');
    }
}

// ---- Regenerate key ----
async function regenerateEmbedKey() {
    if (!editingEmbedConfig) { showToast('Save embed settings first', 'error'); return; }

    const confirmed = await showConfirm('Regenerate the embed key? This will break any existing widgets using this key.', 'Regenerate Key', 'danger');
    if (!confirmed) return;

    const configId = editingEmbedConfig.Id || editingEmbedConfig.id;
    try {
        const res = await api.request(`/research/embed/config/${configId}/regenerate-key`, { method: 'POST' });
        // Update in local state
        const newKey = res.embed_key;
        if (editingEmbedConfig.EmbedKey !== undefined) editingEmbedConfig.EmbedKey = newKey;
        if (editingEmbedConfig.embed_key !== undefined) editingEmbedConfig.embed_key = newKey;
        // Also update in list
        const inList = embedConfigs.find(c => (c.Id || c.id) === configId);
        if (inList) {
            if (inList.EmbedKey !== undefined) inList.EmbedKey = newKey;
            if (inList.embed_key !== undefined) inList.embed_key = newKey;
        }
        updateEmbedCodeSnippet();
        showToast('Embed key regenerated', 'success');
    } catch (err) {
        showToast('Failed to regenerate key: ' + (err.message || err), 'error');
    }
}

// Close files dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!embedFilesDropdownOpen) return;
    const dropdown = document.getElementById('embedFilesDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        closeEmbedFilesDropdown();
    }
});

// ============================================
// EMBED ANALYTICS (in AI Logs tab)
// ============================================
let eaSessionsPage = 1;
const eaPageSize = 10;
let eaExpandedSessionId = null;
let eaAnalyticsData = null; // cached analytics summary per embed key
let eaLoaded = false;

async function loadEmbedAnalytics(selectedEmbedKey) {
    try {
        // Load overall analytics summary (all embed keys)
        const analytics = await api.request(`/research/embed/analytics/${projectId}`);
        eaAnalyticsData = analytics || [];

        // Populate embed key filter dropdown
        const filterEl = document.getElementById('eaEmbedKeyFilter');
        if (filterEl && !eaLoaded) {
            // Only populate once
            filterEl.innerHTML = '<option value="">All embed keys</option>';
            // Get embed config names for friendly display
            let configNames = {};
            try {
                const configs = await api.request(`/research/embed/configs/${projectId}`);
                (configs || []).forEach(c => {
                    const key = c.EmbedKey || c.embed_key;
                    const name = c.Name || c.name || key.substring(0, 10) + '...';
                    configNames[key] = name;
                });
            } catch {}

            eaAnalyticsData.forEach(a => {
                const label = configNames[a.embed_key] || (a.embed_key.substring(0, 12) + '...');
                filterEl.innerHTML += `<option value="${escapeHtml(a.embed_key)}">${escapeHtml(label)}</option>`;
            });

            // Convert to searchable dropdown
            if (typeof convertSelectToSearchable === 'function') {
                if (eaEmbedKeyDropdown) eaEmbedKeyDropdown.destroy();
                eaEmbedKeyDropdown = convertSelectToSearchable('eaEmbedKeyFilter', {
                    placeholder: 'All embed keys',
                    searchPlaceholder: 'Search keys...',
                    compact: true,
                    onChange: (value) => onEaEmbedKeyFilterChange()
                });
            }
        }
        eaLoaded = true;

        // Compute totals for the selected key (or all keys)
        const filtered = selectedEmbedKey
            ? eaAnalyticsData.filter(a => a.embed_key === selectedEmbedKey)
            : eaAnalyticsData;

        const totals = filtered.reduce((acc, a) => ({
            sessions: acc.sessions + (a.session_count || 0),
            ips: acc.ips + (a.unique_ips || 0),
            messages: acc.messages + (a.total_messages || 0),
            tokens: acc.tokens + (a.total_input_tokens || 0) + (a.total_output_tokens || 0)
        }), { sessions: 0, ips: 0, messages: 0, tokens: 0 });

        setAnalyticsCards(totals.sessions, totals.ips, totals.messages, totals.tokens);

        // Load sessions list
        const keyParam = selectedEmbedKey ? `&embedKey=${encodeURIComponent(selectedEmbedKey)}` : '';
        const data = await api.request(`/research/embed/analytics/${projectId}/sessions?page=${eaSessionsPage}&pageSize=${eaPageSize}${keyParam}`);
        renderEmbedSessionsTable(data.sessions || [], data.total || 0);

        updateAiLogsBadges();

    } catch (err) {
        console.error('Failed to load embed analytics:', err);
    }
}

function onEaEmbedKeyFilterChange() {
    const key = eaEmbedKeyDropdown ? (eaEmbedKeyDropdown.getValue() || '') : (document.getElementById('eaEmbedKeyFilter')?.value || '');
    eaSessionsPage = 1;
    eaExpandedSessionId = null;
    loadEmbedAnalytics(key);
}

function switchAiLogsSubtab(sub) {
    const internalBtn = document.getElementById('ailogsSubtabInternal');
    const widgetBtn = document.getElementById('ailogsSubtabWidget');
    const internalPanel = document.getElementById('ailogsInternalPanel');
    const widgetPanel = document.getElementById('ailogsWidgetPanel');

    if (sub === 'internal') {
        internalBtn.classList.add('active');
        widgetBtn.classList.remove('active');
        internalPanel.style.display = '';
        widgetPanel.style.display = 'none';
    } else {
        internalBtn.classList.remove('active');
        widgetBtn.classList.add('active');
        internalPanel.style.display = 'none';
        widgetPanel.style.display = '';
        if (!eaLoaded) loadEmbedAnalytics('');
    }
}

function updateAiLogsBadges() {
    const internalBadge = document.getElementById('ailogsInternalBadge');
    const widgetBadge = document.getElementById('ailogsWidgetBadge');
    const countEl = document.getElementById('aiLogsCount');
    if (internalBadge && countEl) {
        const match = (countEl.textContent || '').match(/(\d+)/);
        internalBadge.textContent = match ? match[1] : '';
    }
    if (widgetBadge && eaAnalyticsData) {
        const total = eaAnalyticsData.reduce((sum, a) => sum + (a.session_count || 0), 0);
        widgetBadge.textContent = total > 0 ? total : '';
    }
}

function setAnalyticsCards(sessions, ips, messages, tokens) {
    document.getElementById('eaSessions').textContent = sessions;
    document.getElementById('eaUniqueIps').textContent = ips;
    document.getElementById('eaMessages').textContent = messages;
    document.getElementById('eaTokens').textContent = formatTokenCount(tokens);
}

function formatTokenCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

function renderEmbedSessionsTable(sessions, total) {
    const container = document.getElementById('embedSessionsList');
    if (!container) return;

    if (sessions.length === 0) {
        container.innerHTML = '<div class="ea-empty">No embed sessions yet</div>';
        return;
    }

    const totalPages = Math.ceil(total / eaPageSize);

    let html = `<table class="ea-sessions-table">
        <thead><tr>
            <th>IP Address</th>
            <th>Messages</th>
            <th>Tokens</th>
            <th>Last Active</th>
        </tr></thead><tbody>`;

    sessions.forEach(s => {
        const tokens = (s.input_tokens || 0) + (s.output_tokens || 0);
        const timeAgo = formatTimeAgo(s.updated_at);
        const isExpanded = eaExpandedSessionId === s.id;

        html += `<tr class="ea-session-row" onclick="toggleEmbedSessionExpand('${s.id}')">
            <td><span class="ea-ip">${escapeHtml(s.ip_address || 'Unknown')}</span></td>
            <td>${s.message_count || 0} <span style="color:var(--text-secondary);font-size:0.68rem">(${s.user_messages || 0} user)</span></td>
            <td><span class="ea-token-badge">${formatTokenCount(tokens)}</span></td>
            <td style="font-size:0.74rem;color:var(--text-secondary)">${timeAgo}</td>
        </tr>`;

        if (isExpanded) {
            html += `<tr class="ea-expand-row"><td colspan="4"><div id="eaSessionMessages_${s.id}" class="ea-messages-wrap">
                <div style="text-align:center;color:var(--text-secondary);font-size:0.78rem;padding:12px">Loading messages...</div>
            </div></td></tr>`;
        }
    });

    html += '</tbody></table>';

    // Pagination
    if (totalPages > 1) {
        html += `<div class="ea-pagination">
            <button ${eaSessionsPage <= 1 ? 'disabled' : ''} onclick="changeEaPage(${eaSessionsPage - 1})">Prev</button>
            <span class="ea-page-info">Page ${eaSessionsPage} of ${totalPages}</span>
            <button ${eaSessionsPage >= totalPages ? 'disabled' : ''} onclick="changeEaPage(${eaSessionsPage + 1})">Next</button>
        </div>`;
    }

    container.innerHTML = html;

    // If a session is expanded, load its messages
    if (eaExpandedSessionId) {
        loadEmbedSessionMessages(eaExpandedSessionId);
    }
}

function changeEaPage(page) {
    eaSessionsPage = page;
    eaExpandedSessionId = null;
    const filterEl = document.getElementById('eaEmbedKeyFilter');
    loadEmbedAnalytics(filterEl ? filterEl.value : '');
}

async function toggleEmbedSessionExpand(sessionId) {
    if (eaExpandedSessionId === sessionId) {
        eaExpandedSessionId = null;
    } else {
        eaExpandedSessionId = sessionId;
    }
    const filterEl = document.getElementById('eaEmbedKeyFilter');
    loadEmbedAnalytics(filterEl ? filterEl.value : '');
}

let _eaSessionMessages = {}; // { sessionId: messages[] } for lazy modal

async function loadEmbedSessionMessages(sessionId) {
    const container = document.getElementById(`eaSessionMessages_${sessionId}`);
    if (!container) return;

    try {
        const messages = await api.request(`/research/embed/analytics/session/${sessionId}/messages`);
        if (!messages || messages.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:0.78rem;padding:12px">No messages found</div>';
            return;
        }

        _eaSessionMessages[sessionId] = messages;

        container.innerHTML = messages.map((m, mi) => {
            const roleClass = m.role === 'user' ? 'user' : 'assistant';
            const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let toolCallsHtml = '';
            if (m.tool_calls_json) {
                try {
                    const toolCalls = JSON.parse(m.tool_calls_json);
                    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                        toolCallsHtml = '<div class="ea-tool-calls">' + toolCalls.map(tc => {
                            const dotClass = tc.success !== false ? 'ok' : 'fail';
                            const dur = tc.duration_ms != null ? ` ${tc.duration_ms}ms` : '';
                            return `<span class="ea-tool-chip"><span class="ea-dot ${dotClass}"></span>${escapeHtml(tc.tool || 'unknown')}${dur}</span>`;
                        }).join('') + '</div>';
                    }
                } catch {}
            }

            let tokenHtml = '';
            if (m.role === 'assistant' && (m.input_tokens || m.output_tokens)) {
                tokenHtml = `<span class="ea-token-badge" style="margin-left:auto">${m.input_tokens} IN / ${m.output_tokens} OUT</span>`;
            }

            // Content: user shows inline, assistant shows title + View Response button
            let contentHtml = '';
            if (m.role === 'user') {
                contentHtml = `<div class="ea-msg-content">${escapeHtml(m.content || '')}</div>`;
            } else {
                const titleMatch = (m.content || '').match(/^#\s+(.+)/m);
                const titlePreview = titleMatch ? titleMatch[1] : (m.content || '').split('\n')[0].substring(0, 80);
                contentHtml = `<div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
                    <span class="ai-log-title-preview" style="font-size:0.78rem;">${escapeHtml(titlePreview)}</span>
                    <button class="ai-log-view-btn" onclick="showEaLlmResponse('${sessionId}',${mi})" style="font-size:0.7rem;padding:2px 8px;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        View</button>
                </div>`;
            }

            return `<div class="ea-msg">
                <div class="ea-msg-header">
                    <span class="ea-msg-role ${roleClass}">${m.role}</span>
                    <span class="ea-msg-time">${time}</span>
                    ${tokenHtml}
                </div>
                ${contentHtml}
                ${toolCallsHtml}
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = `<div style="text-align:center;color:var(--color-error);font-size:0.78rem;padding:12px">Failed to load messages</div>`;
    }
}

function showEaLlmResponse(sessionId, msgIndex) {
    const messages = _eaSessionMessages[sessionId];
    if (!messages) return;
    showLlmResponse(msgIndex, messages);
}

function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString();
}
