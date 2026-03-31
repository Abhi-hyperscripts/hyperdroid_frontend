// ============================================
// OPEN-END CODING — AI-powered verbatim coding
// ============================================

// State
let oeInitialized = false;
let oeFiles = [];
let oeSelectedFileId = null;
let oeSelectedVariable = null;
let oeDetectedVars = [];
let oeCodeframes = [];
let oeJobs = [];
let oeCurrentJobId = null;
let oeResultsPage = 1;
let oeResultsPageSize = 50;
let oeResultsFilter = { codingMethod: '', flaggedOnly: false };
let oeCodeframeEditCodes = []; // codes being edited in the modal
let oeCodeframeEditId = null; // null = creating new

// SearchableDropdown instances
let oeFileDropdown = null;
let oeVariableDropdown = null;
let oeCodeframeDropdown = null;
let oeMethodFilterDropdown = null;

const OE_STAGE_LABELS = {
    pending: 'Queued',
    trivial_filter: 'Filtering trivial responses',
    embedding: 'Generating embeddings',
    clustering: 'Clustering responses',
    coding_representatives: 'AI coding representatives',
    propagating: 'Propagating to cluster members',
    verifying: 'Verifying borderline responses',
    qa: 'Quality audit',
    exporting: 'Exporting to ClickHouse',
    complete: 'Complete',
    failed: 'Failed',
    cancelled: 'Cancelled'
};

// ============================================
// INIT
// ============================================

async function initOpenEndCoding() {
    // If already initialized AND dropdowns exist, skip
    if (oeInitialized && oeFileDropdown && document.querySelector('#oeFileSelectContainer .searchable-dropdown')) return;
    oeInitialized = true;

    // Create file dropdown
    const fileContainer = document.getElementById('oeFileSelectContainer');
    fileContainer.innerHTML = ''; // clear any stale content
    if (!fileContainer) return;

    oeFileDropdown = new SearchableDropdown(fileContainer, {
        id: 'oeFileSelect',
        options: [],
        placeholder: 'Select a file...',
        searchPlaceholder: 'Search files...',
        onChange: (value) => { oeOnFileChange(value); }
    });

    // Create variable dropdown (disabled until file selected)
    const varContainer = document.getElementById('oeVariableSelectContainer');
    varContainer.innerHTML = '';
    oeVariableDropdown = new SearchableDropdown(varContainer, {
        id: 'oeVariableSelect',
        options: [],
        placeholder: 'Select variable...',
        searchPlaceholder: 'Search variables...',
        onChange: (value) => { oeOnVariableChange(value); }
    });
    oeVariableDropdown.setDisabled(true);

    // Create codeframe dropdown
    const cfContainer = document.getElementById('oeCodeframeSelectContainer');
    cfContainer.innerHTML = '';
    oeCodeframeDropdown = new SearchableDropdown(cfContainer, {
        id: 'oeCodeframeSelect',
        options: [],
        placeholder: 'Select codeframe...',
        searchPlaceholder: 'Search codeframes...',
        onChange: () => {}
    });

    // Create method filter dropdown
    const methodContainer = document.getElementById('oeMethodFilterContainer');
    if (methodContainer) {
        oeMethodFilterDropdown = new SearchableDropdown(methodContainer, {
            id: 'oeMethodFilter',
            compact: true,
            options: [
                { value: '', label: 'All methods' },
                { value: 'direct', label: 'Direct (LLM)' },
                { value: 'propagated', label: 'Propagated' },
                { value: 'verified', label: 'Verified' },
                { value: 'trivial', label: 'Trivial' },
                { value: 'manual', label: 'Manual' }
            ],
            placeholder: 'All methods',
            onChange: () => { oeFilterChanged(); }
        });
    }

    // Load files
    try {
        const filesData = await api.request(`/research/projects/${projectId}/files`, { _skipSpinner: true });
        oeFiles = (filesData || []).filter(f => f.status === 'ready');
        const fileOptions = oeFiles.map(f => ({
            value: f.id,
            label: f.fileName || f.file_name,
            description: `${(f.rowCount || f.row_count || 0).toLocaleString()} rows`
        }));
        oeFileDropdown.setOptions(fileOptions);
    } catch (e) {
        console.error('Failed to load files for OE coding:', e);
    }

    await loadOeCodeframes();
    await loadOeJobs();
}

// ============================================
// DETECT OPEN-END VARIABLES
// ============================================

async function oeOnFileChange(fileId) {
    oeSelectedFileId = fileId || null;
    oeSelectedVariable = null;

    const container = document.getElementById('oeDetectedVars');
    if (!container) return;

    if (!fileId) {
        container.innerHTML = '';
        if (oeVariableDropdown) { oeVariableDropdown.setOptions([]); oeVariableDropdown.setDisabled(true); }
        return;
    }

    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Detecting open-end variables...</p></div>';

    try {
        const vars = await api.request(`/research/projects/${projectId}/openend-coding/detect/${fileId}`);
        oeDetectedVars = vars || [];

        // Update variable dropdown
        if (oeVariableDropdown) {
            const varOptions = oeDetectedVars.map(v => ({
                value: v.variableName || v.variable_name,
                label: v.variableName || v.variable_name,
                description: `${v.variableLabel || v.variable_label || 'No label'} (${(v.nonEmptyCount || v.non_empty_count || 0).toLocaleString()} responses)`
            }));
            oeVariableDropdown.setOptions(varOptions);
            oeVariableDropdown.setDisabled(false);
        }

        if (oeDetectedVars.length === 0) {
            container.innerHTML = '<div class="empty-state"><p class="empty-title">No open-end variables found</p><p>This file has no string/text variables with responses.</p></div>';
        } else {
            renderDetectedVars(oeDetectedVars);
        }
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p class="empty-title">Detection failed</p><p>${escapeHtml(e.message || 'Unknown error')}</p></div>`;
    }
}

function renderDetectedVars(vars) {
    const container = document.getElementById('oeDetectedVars');
    if (!container) return;

    container.innerHTML = vars.map(v => {
        const name = v.variableName || v.variable_name;
        const label = v.variableLabel || v.variable_label || '';
        const fillPct = Math.round((v.fillRate || v.fill_rate || 0) * 100);
        const nonEmpty = (v.nonEmptyCount || v.non_empty_count || 0).toLocaleString();
        const total = (v.totalRows || v.total_rows || 0).toLocaleString();
        const samples = (v.sampleResponses || v.sample_responses || []).slice(0, 3);

        return `
        <div class="oe-variable-card" onclick="oeSelectVariable('${escapeHtml(name)}')">
            <div class="oe-var-header">
                <span class="oe-var-name">${escapeHtml(name)}</span>
                <span class="oe-var-fill">${nonEmpty} / ${total} (${fillPct}%)</span>
            </div>
            ${label ? `<div class="oe-var-label">${escapeHtml(label)}</div>` : ''}
            <div class="oe-var-fill-bar"><div class="oe-var-fill-progress" style="width:${fillPct}%"></div></div>
            ${samples.length > 0 ? `<div class="oe-var-samples">${samples.map(s => `<div class="oe-var-sample">"${escapeHtml(s.length > 120 ? s.substring(0, 120) + '...' : s)}"</div>`).join('')}</div>` : ''}
        </div>`;
    }).join('');
}

function oeSelectVariable(varName) {
    oeSelectedVariable = varName;
    if (oeVariableDropdown) oeVariableDropdown.setValue(varName);

    // Highlight selected card
    document.querySelectorAll('.oe-variable-card').forEach(card => card.classList.remove('selected'));
    document.querySelectorAll('.oe-variable-card').forEach(card => {
        if (card.querySelector('.oe-var-name')?.textContent === varName) {
            card.classList.add('selected');
        }
    });

    // Show the job creation section
    const jobSection = document.getElementById('oeJobSection');
    if (jobSection) jobSection.style.display = '';
}

function oeOnVariableChange(varName) {
    if (varName) oeSelectVariable(varName);
}

// ============================================
// CODEFRAMES
// ============================================

async function loadOeCodeframes() {
    try {
        oeCodeframes = await api.request(`/research/projects/${projectId}/openend-coding/codeframes`) || [];
        renderCodeframeSelect();
    } catch (e) {
        console.error('Failed to load codeframes:', e);
    }
}

function renderCodeframeSelect() {
    if (!oeCodeframeDropdown) return;
    const cfOptions = oeCodeframes.map(cf => ({
        value: cf.id,
        label: cf.name,
        description: `${cf.source}, v${cf.version}`
    }));
    oeCodeframeDropdown.setOptions(cfOptions);
}

function openCodeframeModal(codeframeId = null) {
    oeCodeframeEditId = codeframeId;
    oeCodeframeEditCodes = [];

    document.getElementById('cfModalName').value = '';
    document.getElementById('cfModalDescription').value = '';
    document.getElementById('cfAutoGenSection').style.display = '';
    document.getElementById('cfCodesList').innerHTML = '';

    if (codeframeId) {
        // Load existing codeframe
        const cf = oeCodeframes.find(c => c.id === codeframeId);
        if (cf) {
            document.getElementById('cfModalName').value = cf.name;
            document.getElementById('cfModalDescription').value = cf.description || '';
        }
        loadCodeframeCodes(codeframeId);
    }

    document.getElementById('codeframeModal').classList.add('active');
}

async function loadCodeframeCodes(codeframeId) {
    try {
        const data = await api.request(`/research/projects/${projectId}/openend-coding/codeframes/${codeframeId}`);
        oeCodeframeEditCodes = data.codes || [];
        renderCodeframeCodesList();
    } catch (e) {
        Toast.error('Failed to load codeframe codes');
    }
}

function renderCodeframeCodesList() {
    const container = document.getElementById('cfCodesList');
    if (!container) return;

    if (oeCodeframeEditCodes.length === 0) {
        container.innerHTML = '<div class="oe-codes-empty">No codes yet. Add manually or auto-generate from responses.</div>';
        return;
    }

    container.innerHTML = oeCodeframeEditCodes.map((code, idx) => {
        const cv = code.codeValue || code.code_value || '';
        const cl = code.codeLabel || code.code_label || '';
        const def = code.definition || '';
        const isChild = cv.includes('.');
        const isOther = code.isOther || code.is_other;

        return `
        <div class="oe-code-item ${isChild ? 'oe-code-child' : ''} ${isOther ? 'oe-code-other' : ''}" data-idx="${idx}">
            <span class="oe-code-value">${escapeHtml(cv)}</span>
            <span class="oe-code-label">${escapeHtml(cl)}</span>
            ${def ? `<span class="oe-code-def">${escapeHtml(def.length > 60 ? def.substring(0, 60) + '...' : def)}</span>` : ''}
            ${isOther ? '<span class="oe-code-tag">OTHER</span>' : ''}
            <div class="oe-code-actions">
                <button class="oe-code-edit-btn" onclick="editCodeInModal(${idx})" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="oe-code-delete-btn" onclick="deleteCodeFromModal(${idx})" title="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>`;
    }).join('');
}

function editCodeInModal(idx) {
    const code = oeCodeframeEditCodes[idx];
    if (!code) return;

    document.getElementById('codeEditIdx').value = idx;
    document.getElementById('codeEditValue').value = code.codeValue || code.code_value || '';
    document.getElementById('codeEditLabel').value = code.codeLabel || code.code_label || '';
    document.getElementById('codeEditDefinition').value = code.definition || '';
    document.getElementById('codeEditIncludes').value = code.includes || '';
    document.getElementById('codeEditExcludes').value = code.excludes || '';
    document.getElementById('codeEditIsOther').checked = code.isOther || code.is_other || false;

    document.getElementById('codeEditModal').classList.add('active');
}

function saveCodeEdit() {
    const idx = parseInt(document.getElementById('codeEditIdx').value);
    const code = {
        codeValue: document.getElementById('codeEditValue').value.trim(),
        code_value: document.getElementById('codeEditValue').value.trim(),
        codeLabel: document.getElementById('codeEditLabel').value.trim(),
        code_label: document.getElementById('codeEditLabel').value.trim(),
        definition: document.getElementById('codeEditDefinition').value.trim(),
        includes: document.getElementById('codeEditIncludes').value.trim(),
        excludes: document.getElementById('codeEditExcludes').value.trim(),
        isOther: document.getElementById('codeEditIsOther').checked,
        is_other: document.getElementById('codeEditIsOther').checked,
    };

    if (!code.codeValue || !code.codeLabel) {
        Toast.error('Code value and label are required');
        return;
    }

    if (idx >= 0 && idx < oeCodeframeEditCodes.length) {
        oeCodeframeEditCodes[idx] = code;
    } else {
        oeCodeframeEditCodes.push(code);
    }

    document.getElementById('codeEditModal').classList.remove('active');
    renderCodeframeCodesList();
}

function addNewCode() {
    document.getElementById('codeEditIdx').value = -1;
    document.getElementById('codeEditValue').value = '';
    document.getElementById('codeEditLabel').value = '';
    document.getElementById('codeEditDefinition').value = '';
    document.getElementById('codeEditIncludes').value = '';
    document.getElementById('codeEditExcludes').value = '';
    document.getElementById('codeEditIsOther').checked = false;
    document.getElementById('codeEditModal').classList.add('active');
}

function deleteCodeFromModal(idx) {
    oeCodeframeEditCodes.splice(idx, 1);
    renderCodeframeCodesList();
}

async function autoGenerateCodeframe() {
    const fileId = oeSelectedFileId || (oeFileDropdown ? oeFileDropdown.getValue() : null);
    const varName = oeSelectedVariable || (oeVariableDropdown ? oeVariableDropdown.getValue() : null);

    if (!fileId || !varName) {
        Toast.error('Select a file and variable first');
        return;
    }

    const sampleSize = parseInt(document.getElementById('cfAutoSampleSize')?.value) || 200;
    const targetCodes = parseInt(document.getElementById('cfAutoTargetCodes')?.value) || 20;
    const context = document.getElementById('cfAutoContext')?.value || '';

    const btn = document.getElementById('cfAutoGenerateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    try {
        const data = await api.request(`/research/projects/${projectId}/openend-coding/codeframes/auto-generate`, {
            method: 'POST',
            body: JSON.stringify({
                fileId: fileId,
                variableName: varName,
                sampleSize: sampleSize,
                targetCodeCount: targetCodes,
                context: context
            })
        });

        oeCodeframeEditId = data.codeframe?.id || null;
        oeCodeframeEditCodes = data.codes || [];
        document.getElementById('cfModalName').value = data.codeframe?.name || 'Auto-generated codeframe';
        document.getElementById('cfModalDescription').value = data.codeframe?.description || '';
        renderCodeframeCodesList();

        Toast.success(`Generated ${oeCodeframeEditCodes.length} codes from ${sampleSize} sample responses`);
        await loadOeCodeframes();
    } catch (e) {
        Toast.error(`Auto-generation failed: ${e.message || 'Unknown error'}`);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
    }
}

async function saveCodeframe() {
    const name = document.getElementById('cfModalName')?.value?.trim();
    if (!name) { Toast.error('Codeframe name is required'); return; }
    if (oeCodeframeEditCodes.length === 0) { Toast.error('Add at least one code'); return; }

    const payload = {
        name,
        description: document.getElementById('cfModalDescription')?.value?.trim() || null,
        codes: oeCodeframeEditCodes.map((c, i) => ({
            codeValue: c.codeValue || c.code_value,
            code_value: c.codeValue || c.code_value,
            codeLabel: c.codeLabel || c.code_label,
            code_label: c.codeLabel || c.code_label,
            definition: c.definition || null,
            includes: c.includes || null,
            excludes: c.excludes || null,
            isOther: c.isOther || c.is_other || false,
            is_other: c.isOther || c.is_other || false,
        }))
    };

    try {
        if (oeCodeframeEditId) {
            // Already saved via auto-generate, just close
            document.getElementById('codeframeModal').classList.remove('active');
            Toast.success('Codeframe saved');
        } else {
            await api.request(`/research/projects/${projectId}/openend-coding/codeframes`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            Toast.success('Codeframe created');
        }
        await loadOeCodeframes();
        document.getElementById('codeframeModal').classList.remove('active');
    } catch (e) {
        Toast.error(`Failed to save: ${e.message}`);
    }
}

function closeCodeframeModal() {
    document.getElementById('codeframeModal').classList.remove('active');
}

function closeCodeEditModal() {
    document.getElementById('codeEditModal').classList.remove('active');
}

// ============================================
// CODING JOBS
// ============================================

async function loadOeJobs() {
    try {
        oeJobs = await api.request(`/research/projects/${projectId}/openend-coding/jobs`) || [];
        renderOeJobs();
    } catch (e) {
        console.error('Failed to load coding jobs:', e);
    }
}

function renderOeJobs() {
    const container = document.getElementById('oeJobsList');
    if (!container) return;

    if (oeJobs.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = oeJobs.map(job => renderJobCard(job)).join('');
}

function renderJobCard(job) {
    const status = job.status;
    const isComplete = status === 'complete';
    const isFailed = status === 'failed';
    const isRunning = !isComplete && !isFailed && status !== 'cancelled';
    const pct = job.progressPct || job.progress_pct || 0;
    const stage = OE_STAGE_LABELS[job.currentStage || job.current_stage || status] || status;
    const varName = job.variableName || job.variable_name;
    const totalResp = job.totalResponses || job.total_responses || 0;
    const trivial = job.trivialFiltered || job.trivial_filtered || 0;
    const repsCoded = job.representativesCoded || job.representatives_coded || 0;
    const propagated = job.propagatedCoded || job.propagated_coded || 0;
    const verified = job.verifiedCoded || job.verified_coded || 0;
    const clusters = job.clustersFormed || job.clusters_formed || 0;
    const failed = job.failedCount || job.failed_count || 0;

    let statsJson = {};
    try { statsJson = JSON.parse(job.statsJson || job.stats_json || '{}'); } catch {}
    const totalCost = statsJson?.token_usage?.cost_breakdown_usd?.total || 0;
    const totalCalls = statsJson?.total_llm_calls || 0;

    const badgeClass = isComplete ? 'ready' : isFailed ? 'failed' : status === 'cancelled' ? 'failed' : 'active';
    const badgeText = isComplete ? 'Complete' : isFailed ? 'Failed' : status === 'cancelled' ? 'Cancelled' : 'Processing';

    const elapsed = job.completedAt || job.completed_at
        ? formatDuration(new Date(job.completedAt || job.completed_at) - new Date(job.createdAt || job.created_at))
        : '';

    return `
    <div class="oe-job-card" id="oe-job-${job.id}" data-job-id="${job.id}">
        <div class="oe-job-header">
            <div class="oe-job-title">
                <span class="oe-job-var">${escapeHtml(varName)}</span>
                <span class="status-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="oe-job-time">${elapsed ? `${elapsed}` : ''}</div>
        </div>

        ${isRunning ? `
        <div class="oe-job-progress">
            <div class="oe-job-progress-label">${escapeHtml(stage)}</div>
            <div class="file-progress-bar"><div class="file-progress-fill" style="width:${pct}%"></div></div>
            <div class="oe-job-progress-pct">${Math.round(pct)}%</div>
        </div>` : ''}

        ${isFailed ? `<div class="oe-job-error">${escapeHtml(job.errorMessage || job.error_message || 'Unknown error')}</div>` : ''}

        <div class="oe-job-stats">
            <div class="oe-job-stat"><span class="oe-stat-value">${totalResp.toLocaleString()}</span><span class="oe-stat-label">Responses</span></div>
            <div class="oe-job-stat"><span class="oe-stat-value">${clusters}</span><span class="oe-stat-label">Clusters</span></div>
            <div class="oe-job-stat"><span class="oe-stat-value">${(repsCoded + propagated + verified).toLocaleString()}</span><span class="oe-stat-label">Coded</span></div>
            ${isComplete ? `<div class="oe-job-stat"><span class="oe-stat-value">$${totalCost.toFixed(2)}</span><span class="oe-stat-label">Cost</span></div>` : ''}
        </div>

        ${isComplete ? `
        <div class="oe-job-actions">
            <button class="oe-btn oe-btn-primary" onclick="loadOeResults('${job.id}')">View Results</button>
            <button class="oe-btn oe-btn-secondary" onclick="openCostBreakdown('${job.id}')">Cost Breakdown</button>
        </div>` : ''}

        ${isRunning ? `
        <div class="oe-job-actions">
            <button class="oe-btn oe-btn-danger" onclick="cancelOeJob('${job.id}')">Cancel</button>
        </div>` : ''}
    </div>`;
}

function formatDuration(ms) {
    if (!ms || ms < 0) return '';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}m ${rem}s`;
}

async function startCodingJob() {
    const fileId = oeSelectedFileId || (oeFileDropdown ? oeFileDropdown.getValue() : null);
    const varName = oeSelectedVariable || (oeVariableDropdown ? oeVariableDropdown.getValue() : null);
    const codeframeId = oeCodeframeDropdown ? oeCodeframeDropdown.getValue() : null;

    if (!fileId) { Toast.error('Select a file'); return; }
    if (!varName) { Toast.error('Select a variable'); return; }
    if (!codeframeId) { Toast.error('Select or create a codeframe first'); return; }

    try {
        const result = await api.request(`/research/projects/${projectId}/openend-coding/jobs`, {
            method: 'POST',
            body: JSON.stringify({
                fileId: fileId,
                variableName: varName,
                codeframeId: codeframeId
            })
        });

        Toast.success('Coding job started');

        // Join SignalR progress group
        if (fileProgressConnected && fileProgressConnection) {
            try {
                await fileProgressConnection.invoke('JoinOpenEndCodingProgress', result.job_id);
            } catch (e) {
                console.warn('Failed to join OE coding progress group:', e);
            }
        }

        await loadOeJobs();
    } catch (e) {
        Toast.error(`Failed to start job: ${e.message}`);
    }
}

async function cancelOeJob(jobId) {
    try {
        await api.request(`/research/projects/${projectId}/openend-coding/jobs/${jobId}/cancel`, { method: 'POST' });
        Toast.info('Job cancelled');
        await loadOeJobs();
    } catch (e) {
        Toast.error(`Failed to cancel: ${e.message}`);
    }
}

// ============================================
// SignalR PROGRESS HANDLER
// ============================================

function handleOeCodingProgress(data) {
    const jobId = data.job_id;
    const status = data.status;

    // Update job card in-place
    const card = document.getElementById(`oe-job-${jobId}`);
    if (card) {
        // Find or update the job in our list
        const jobIdx = oeJobs.findIndex(j => j.id === jobId);
        if (jobIdx >= 0) {
            oeJobs[jobIdx] = { ...oeJobs[jobIdx], ...data, status };
            card.outerHTML = renderJobCard(oeJobs[jobIdx]);
        }
    }

    if (status === 'complete') {
        Toast.success(`Coding complete for job`);
        loadOeJobs();
    } else if (status === 'failed') {
        Toast.error(`Coding failed: ${data.message || 'Unknown error'}`);
        loadOeJobs();
    }
}

// ============================================
// RESULTS
// ============================================

async function loadOeResults(jobId) {
    oeCurrentJobId = jobId;
    oeResultsPage = 1;

    const resultsSection = document.getElementById('oeResultsSection');
    if (resultsSection) resultsSection.style.display = '';

    await fetchAndRenderResults();
}

async function fetchAndRenderResults() {
    if (!oeCurrentJobId) return;

    const container = document.getElementById('oeResultsContainer');
    if (!container) return;
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading results...</p></div>';

    try {
        const params = new URLSearchParams({
            page: oeResultsPage,
            pageSize: oeResultsPageSize
        });
        if (oeResultsFilter.codingMethod) params.append('coding_method', oeResultsFilter.codingMethod);
        if (oeResultsFilter.flaggedOnly) params.append('flagged_only', 'true');

        const data = await api.request(`/research/projects/${projectId}/openend-coding/jobs/${oeCurrentJobId}/results?${params}`);
        renderResultsTable(data.items || [], data.total_count || 0);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p class="empty-title">Failed to load results</p><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function renderResultsTable(items, totalCount) {
    const container = document.getElementById('oeResultsContainer');
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state"><p class="empty-title">No results found</p><p>Try adjusting your filters.</p></div>';
        return;
    }

    const totalPages = Math.ceil(totalCount / oeResultsPageSize);

    let html = `
    <div class="oe-results-summary">Showing ${items.length} of ${totalCount.toLocaleString()} coded responses (page ${oeResultsPage}/${totalPages})</div>
    <table class="oe-results-table">
        <thead>
            <tr>
                <th style="width:60px">Row</th>
                <th>Response</th>
                <th style="width:180px">Codes</th>
                <th style="width:100px">Sentiment</th>
                <th style="width:80px">Method</th>
                <th style="width:70px">Conf.</th>
            </tr>
        </thead>
        <tbody>`;

    items.forEach(item => {
        const rowId = item.rowId || item.row_id;
        const text = item.responseText || item.response_text || '';
        const method = item.codingMethod || item.coding_method || '';
        const confidence = item.confidence || 0;
        const sentiment = item.overallSentiment || item.overall_sentiment;
        const flagged = item.isFlagged || item.is_flagged;
        const flagReason = item.flagReason || item.flag_reason || '';

        let codes = [];
        try { codes = JSON.parse(item.codesJson || item.codes_json || '[]'); } catch {}
        let claims = [];
        try { claims = JSON.parse(item.claimsJson || item.claims_json || '[]'); } catch {}

        const truncText = text.length > 100 ? text.substring(0, 100) + '...' : text;
        const codeBadges = codes.slice(0, 3).map(c =>
            `<span class="oe-code-badge">${escapeHtml(c.code_value || c.codeValue || '')}</span>`
        ).join(' ');
        const moreCount = codes.length > 3 ? `<span class="oe-code-more">+${codes.length - 3}</span>` : '';

        const sentimentVal = sentiment != null ? parseFloat(sentiment) : null;
        const sentimentClass = sentimentVal != null ? (sentimentVal > 0.2 ? 'positive' : sentimentVal < -0.2 ? 'negative' : 'neutral') : 'neutral';
        const sentimentText = sentimentVal != null ? (sentimentVal > 0 ? '+' : '') + sentimentVal.toFixed(2) : '-';

        const methodBadge = `<span class="oe-method-badge oe-method-${method}">${method}</span>`;

        html += `
        <tr class="oe-results-row ${flagged ? 'oe-flagged' : ''}" data-row-id="${rowId}" onclick="toggleOeResultRow(${rowId})">
            <td>${flagged ? '<span class="oe-flag-icon" title="' + escapeHtml(flagReason) + '">&#9888;</span>' : ''}${rowId}</td>
            <td class="oe-response-cell">${escapeHtml(truncText)}</td>
            <td>${codeBadges}${moreCount}</td>
            <td><span class="oe-sentiment-badge ${sentimentClass}">${sentimentText}</span></td>
            <td>${methodBadge}</td>
            <td>${(confidence * 100).toFixed(0)}%</td>
        </tr>
        <tr class="oe-expanded-row" id="oe-expand-${rowId}" style="display:none">
            <td colspan="6">
                <div class="oe-claims-panel">
                    <div class="oe-full-response"><strong>Full response:</strong> ${escapeHtml(text)}</div>
                    ${claims.length > 0 ? `
                    <div class="oe-claims-list">
                        <strong>Atomic Claims:</strong>
                        ${claims.map((claim, ci) => {
                            const claimText = claim.claim_text || claim.claimText || '';
                            const claimCodes = claim.codes || [];
                            return `
                            <div class="oe-claim-item">
                                <span class="oe-claim-num">${ci + 1}.</span>
                                <span class="oe-claim-text">${escapeHtml(claimText)}</span>
                                <div class="oe-claim-codes">
                                    ${claimCodes.map(cc => {
                                        const s = cc.sentiment || 0;
                                        const sClass = s > 0.2 ? 'positive' : s < -0.2 ? 'negative' : 'neutral';
                                        return `<span class="oe-code-badge">${escapeHtml(cc.code_value || cc.codeValue || '')}</span><span class="oe-sentiment-badge ${sClass} small">${s > 0 ? '+' : ''}${s.toFixed(1)}</span>`;
                                    }).join(' ')}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>` : `
                    <div class="oe-claims-list">
                        <strong>Codes:</strong>
                        ${codes.map(c => {
                            const s = c.sentiment || 0;
                            const sClass = s > 0.2 ? 'positive' : s < -0.2 ? 'negative' : 'neutral';
                            return `<span class="oe-code-badge">${escapeHtml(c.code_value || c.codeValue || '')} — ${escapeHtml(c.code_label || c.codeLabel || '')}</span> <span class="oe-sentiment-badge ${sClass} small">${s > 0 ? '+' : ''}${parseFloat(s).toFixed(1)}</span>`;
                        }).join('<br>')}
                    </div>`}
                    ${flagged ? `<div class="oe-flag-reason">Flagged: ${escapeHtml(flagReason)}</div>` : ''}
                    <div class="oe-claim-actions">
                        <button class="oe-btn oe-btn-sm" onclick="event.stopPropagation(); editOeCoding('${oeCurrentJobId}', ${rowId})">Edit Codes</button>
                    </div>
                </div>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';

    // Pagination
    if (totalPages > 1) {
        html += '<div class="oe-pagination">';
        if (oeResultsPage > 1) html += `<button class="oe-btn oe-btn-sm" onclick="oeGoToPage(${oeResultsPage - 1})">Previous</button>`;
        html += `<span class="oe-page-info">Page ${oeResultsPage} of ${totalPages}</span>`;
        if (oeResultsPage < totalPages) html += `<button class="oe-btn oe-btn-sm" onclick="oeGoToPage(${oeResultsPage + 1})">Next</button>`;
        html += '</div>';
    }

    container.innerHTML = html;
}

function toggleOeResultRow(rowId) {
    const expandRow = document.getElementById(`oe-expand-${rowId}`);
    if (!expandRow) return;
    const isVisible = expandRow.style.display !== 'none';
    expandRow.style.display = isVisible ? 'none' : 'table-row';
}

function oeGoToPage(page) {
    oeResultsPage = page;
    fetchAndRenderResults();
}

function oeFilterChanged() {
    oeResultsFilter.codingMethod = oeMethodFilterDropdown ? (oeMethodFilterDropdown.getValue() || '') : '';
    oeResultsFilter.flaggedOnly = document.getElementById('oeFlaggedFilter')?.checked || false;
    oeResultsPage = 1;
    fetchAndRenderResults();
}

async function editOeCoding(jobId, rowId) {
    // Simple prompt-based editing for now
    const response = await api.request(`/research/projects/${projectId}/openend-coding/jobs/${jobId}/results?page=1&pageSize=1&row_id=${rowId}`);
    // TODO: Open edit modal with code selection
    Toast.info('Edit functionality - coming soon');
}

// ============================================
// COST BREAKDOWN
// ============================================

async function openCostBreakdown(jobId) {
    const modal = document.getElementById('costBreakdownModal');
    if (!modal) return;

    const content = document.getElementById('costBreakdownContent');
    if (content) content.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading cost data...</p></div>';
    modal.classList.add('active');

    try {
        const cost = await api.request(`/research/projects/${projectId}/openend-coding/jobs/${jobId}/cost`);

        let html = `
        <div class="oe-cost-summary">
            <div class="oe-cost-stat"><span class="oe-stat-value">$${cost.totalCostUsd?.toFixed(4) || cost.total_cost_usd?.toFixed(4) || '0'}</span><span class="oe-stat-label">Total Cost</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">${(cost.totalLlmCalls || cost.total_llm_calls || 0).toLocaleString()}</span><span class="oe-stat-label">LLM Calls</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">${formatTokens(cost.totalInputTokens || cost.total_input_tokens || 0)}</span><span class="oe-stat-label">Input Tokens</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">${formatTokens(cost.totalOutputTokens || cost.total_output_tokens || 0)}</span><span class="oe-stat-label">Output Tokens</span></div>
        </div>

        <h4 style="margin: 16px 0 8px; font-size: 0.85rem; color: var(--text-secondary);">Cost by Stage</h4>
        <table class="oe-cost-table">
            <thead><tr><th>Stage</th><th>Model</th><th>Calls</th><th>Tokens (in/out)</th><th>Cost</th></tr></thead>
            <tbody>
                ${(cost.byStage || cost.by_stage || []).map(s => `
                <tr>
                    <td>${escapeHtml(OE_STAGE_LABELS[s.stage] || s.stage)}</td>
                    <td class="oe-cost-model">${escapeHtml((s.model || '').split('-').pop() || s.model)}</td>
                    <td>${s.calls}</td>
                    <td>${formatTokens(s.inputTokens || s.input_tokens)} / ${formatTokens(s.outputTokens || s.output_tokens)}</td>
                    <td>$${(s.costUsd || s.cost_usd || 0).toFixed(4)}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;

        if (content) content.innerHTML = html;
    } catch (e) {
        if (content) content.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function formatTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

function closeCostBreakdownModal() {
    document.getElementById('costBreakdownModal')?.classList.remove('active');
}

// ============================================
// HELPERS
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
