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

// Polling timers
let fileStatusPollers = {}; // fileId -> intervalId

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

// Cleanup pollers on page unload
window.addEventListener('beforeunload', () => {
    Object.values(fileStatusPollers).forEach(id => clearInterval(id));
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
    const variableCount = file.variableCount ?? file.variable_count ?? 0;
    const rowCount = file.rowCount ?? file.row_count ?? 0;
    const uploadedAt = file.uploadedAt || file.uploaded_at;

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
            <td><span class="status-badge ${status}">${status}</span></td>
            <td>${status === 'ready' ? formatNumber(variableCount) : '-'}</td>
            <td>${status === 'ready' ? formatNumber(rowCount) : '-'}</td>
            <td>${uploadedAt ? formatDate(uploadedAt) : '-'}</td>
            <td>
                <button class="btn-icon-danger" onclick="deleteFile('${fileId}', '${escapeHtml(fileName)}')" title="Delete file">
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
// FILE STATUS POLLING
// ============================================

function startFilePolling() {
    // Clear existing pollers
    Object.values(fileStatusPollers).forEach(id => clearInterval(id));
    fileStatusPollers = {};

    // Start polling for files that are not in a terminal state
    for (const file of files) {
        const status = file.status;
        if (status === 'uploading' || status === 'parsing') {
            startPollingFile(file.id);
        }
    }
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
                    // Refresh project header (file count / row count may have changed)
                    refreshProjectHeader();
                    // If variables tab was loaded, refresh it
                    if (variablesLoaded) {
                        loadVariables();
                    }
                } else if (file.status === 'failed') {
                    const errorMsg = file.errorMessage || file.error_message || 'Unknown error';
                    Toast.error(`File parsing failed: ${errorMsg}`);
                }
            }
        } catch (error) {
            console.warn(`Polling failed for file ${fileId}:`, error);
        }
    }, 3000);
}

function updateFileRowStatus(file) {
    const fileId = file.id;
    const row = document.getElementById(`file-row-${fileId}`);
    if (!row) return;

    const status = file.status;
    const variableCount = file.variableCount ?? file.variable_count ?? 0;
    const rowCount = file.rowCount ?? file.row_count ?? 0;

    // Update status badge
    const statusCell = row.querySelector('td:nth-child(3)');
    statusCell.innerHTML = `<span class="status-badge ${status}">${status}</span>`;

    // Update variables column
    const varsCell = row.querySelector('td:nth-child(4)');
    varsCell.textContent = status === 'ready' ? formatNumber(variableCount) : '-';

    // Update rows column
    const rowsCell = row.querySelector('td:nth-child(5)');
    rowsCell.textContent = status === 'ready' ? formatNumber(rowCount) : '-';

    // Update data attribute
    row.setAttribute('data-status', status);

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
        const response = await api.request(`/research/projects/${projectId}/query`, {
            method: 'POST',
            body: JSON.stringify({ sql })
        });

        if (response.success === false && response.error) {
            throw new Error(response.error);
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
        errorDiv.textContent = error.message || 'Query execution failed';
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

        // Reload files and start polling
        await loadFiles();

        // If the upload response has a file_id, start polling it specifically
        if (result.file_id) {
            startPollingFile(result.file_id);
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
        `This will permanently delete "${fileName}" and all its data from ClickHouse. This action cannot be undone.`,
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
    document.getElementById('editProjectModal').classList.add('active');
}

async function handleEditProject(event) {
    event.preventDefault();

    const name = document.getElementById('editProjectName').value.trim();
    const description = document.getElementById('editProjectDescription').value.trim();
    const status = document.getElementById('editProjectStatus').value;

    if (!name) {
        Toast.warning('Project name is required.');
        return;
    }

    try {
        await api.request(`/research/projects/${projectId}`, {
            method: 'PUT',
            body: JSON.stringify({ name, description: description || null, status })
        });

        Toast.success('Project updated successfully.');
        closeModal('editProjectModal');

        // Refresh project data
        project.name = name;
        project.description = description;
        project.status = status;
        renderProjectHeader();
    } catch (error) {
        console.error('Update project failed:', error);
        Toast.error(error.message || 'Failed to update project');
    }
}

async function deleteProject() {
    const confirmed = await Confirm.danger(
        `This will permanently delete "${project.name}" and ALL its files, variables, and ClickHouse data. This action cannot be undone.`,
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

async function connectAiSignalR() {
    if (aiSignalRConnection) return;
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
            appendAiMessage(data.response, data.sql_executed, data.query_time_ms, data.input_tokens, data.output_tokens);
            enableAiInput(true);
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
            appendSystemMessage(data.error || 'An error occurred.');
            enableAiInput(true);
        });

        await aiSignalRConnection.start();

        // Join user-specific group
        const user = api.getUser();
        const userId = user ? user.userId : '';
        if (userId) {
            await aiSignalRConnection.invoke('JoinResearchChat', userId);
        }

        console.log('[AI] SignalR connected to AIEngine hub');
    } catch (error) {
        console.warn('[AI] SignalR connection failed:', error);
        aiSignalRConnection = null;
    }
}

function toggleAiChat() {
    const overlay = document.getElementById('aiHudOverlay');
    const btn = document.getElementById('aiChatToggleBtn');
    if (!overlay) return;

    aiChatVisible = !aiChatVisible;

    if (aiChatVisible) {
        overlay.style.display = 'flex';
        overlay.offsetHeight;
        overlay.classList.add('visible');
        btn.classList.add('active');
        const input = document.getElementById('aiHudInput');
        if (input) setTimeout(() => input.focus(), 100);
    } else {
        overlay.classList.remove('visible');
        btn.classList.remove('active');
        setTimeout(() => {
            if (!aiChatVisible) overlay.style.display = 'none';
        }, 250);
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
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Show typing indicator
    aiProcessing = true;
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

        // If SignalR didn't deliver the response, use REST response
        if (aiProcessing) {
            removeTypingIndicator();
            aiProcessing = false;
            if (response.session_id) aiSessionId = response.session_id;
            appendAiMessage(response.response, response.sql_executed, response.query_time_ms,
                response.total_input_tokens, response.total_output_tokens);
            enableAiInput(true);
        }
    } catch (error) {
        removeTypingIndicator();
        aiProcessing = false;
        console.error('[AI] Error sending message:', error);
        appendSystemMessage('Failed to process your question. Please try again.');
        enableAiInput(true);
    }
}

function appendAiMessage(content, sqlExecuted, queryTimeMs, inputTokens, outputTokens) {
    const messagesEl = document.getElementById('aiHudMessages');
    if (!messagesEl) return;

    const aiMsg = document.createElement('div');
    aiMsg.className = 'ai-msg assistant';

    // Render markdown-like content (basic: tables, bold, code blocks)
    aiMsg.innerHTML = renderAiContent(content);

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
    const btn = document.querySelector('.ai-hud-send-btn');
    if (input) { input.disabled = !enabled; if (enabled) input.focus(); }
    if (btn) btn.disabled = !enabled;
}

function renderAiContent(text) {
    if (!text) return '';
    // Use marked.js library for proper markdown rendering
    if (typeof marked !== 'undefined') {
        return marked.parse(text);
    }
    // Fallback: basic text with line breaks if marked.js not loaded
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
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
