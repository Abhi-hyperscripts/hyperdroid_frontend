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
let oeResultsCodeframeCodes = []; // cached codeframe codes for results matrix

// SearchableDropdown instances
let oeFileDropdown = null;
let oeVariableDropdown = null;
let oeCodeframeDropdown = null;
let oeMethodFilterDropdown = null;

const OE_STAGE_LABELS = {
    pending: 'Queued',
    trivial_filter: 'Filtering trivial responses',
    decomposing: 'Decomposing into atomic claims',
    generating_codeframe: 'Generating codeframe',
    embedding: 'Generating embeddings',
    clustering: 'Clustering claims',
    classifying_reps: 'Classifying claims',
    coding_representatives: 'AI coding representatives',
    propagating: 'Propagating to cluster members',
    verifying: 'Verifying borderline responses',
    validating: 'Validating assignments',
    reassembling: 'Reassembling responses',
    qa: 'Quality audit',
    exporting: 'Exporting to ClickHouse',
    complete: 'Complete',
    failed: 'Failed',
    cancelled: 'Cancelled',
    // Cost breakdown stage labels
    decompose: 'Decompose',
    classify_all: 'Classify All Claims',
    codeframe_mapping_positive: 'Codeframe (Positive)',
    codeframe_mapping_negative: 'Codeframe (Negative)',
    codeframe_mapping_neutral: 'Codeframe (Neutral)',
    codeframe_mapping_mixed: 'Codeframe (Mixed)',
    qa_audit: 'QA Audit',
    classify: 'Classify',
    verify: 'Verify'
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
        onChange: (value) => { onCodeframeChange(value); }
    });

    // Method filter removed — V5 uses single LLM classify for all responses

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

        return `
        <div class="oe-variable-card" onclick="oeSelectVariable('${escapeHtml(name)}')">
            <span class="oe-var-name">${escapeHtml(name)}</span>
            ${label ? `<span class="oe-var-label">${escapeHtml(label.length > 80 ? label.substring(0, 80) + '…' : label)}</span>` : ''}
            <span class="oe-var-fill">${nonEmpty} / ${total} (${fillPct}%)</span>
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
                file_id: fileId,
                variable_name: varName,
                sample_size: sampleSize,
                target_code_count: targetCodes,
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
// CODEFRAME VIEWER
// ============================================

function onCodeframeChange(value) {
    const btn = document.getElementById('oeViewCodeframeBtn');
    if (btn) btn.style.display = value ? '' : 'none';
}

async function toggleCodeframeViewer() {
    const panel = document.getElementById('cfSlidePanel');
    const overlay = document.getElementById('cfPanelOverlay');
    const body = document.getElementById('cfPanelBody');
    if (!panel || !body) return;

    const codeframeId = oeCodeframeDropdown ? oeCodeframeDropdown.getValue() : null;
    if (!codeframeId) return;

    panel.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    body.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

    try {
        const data = await api.request(`/research/projects/${projectId}/openend-coding/codeframes/${codeframeId}`);
        renderCodeframePanel(data.codeframe, data.codes || []);
    } catch (e) {
        body.innerHTML = `<div style="padding:16px;color:var(--color-danger);font-size:0.85rem;">${escapeHtml(e.message)}</div>`;
    }
}

function closeCodeframePanel() {
    document.getElementById('cfSlidePanel')?.classList.remove('active');
    document.getElementById('cfPanelOverlay')?.classList.remove('active');
    document.body.style.overflow = '';
}

const NET_COLORS = { positive: '#10b981', negative: '#ef4444', neutral: '#94a3b8', miscellaneous: '#8b5cf6' };
const NET_LABELS = { positive: 'Positive', negative: 'Negative', neutral: 'Neutral', miscellaneous: 'Miscellaneous' };

function renderCodeframePanel(codeframe, codes) {
    const body = document.getElementById('cfPanelBody');
    if (!body) return;

    const title = document.querySelector('#cfSlidePanel .panel-title');
    if (title) title.textContent = codeframe.name || 'Codeframe';

    let html = `<div style="padding:4px 0 12px;font-size:0.75rem;color:var(--text-muted);">${codes.length} codes &middot; ${codeframe.source || 'manual'} &middot; v${codeframe.version || 1}</div>`;

    // Group by net_type → theme → sub-themes
    const nets = ['positive', 'negative', 'neutral', 'miscellaneous'];
    const hasNets = codes.some(c => c.net_type || c.netType);

    if (hasNets) {
        nets.forEach(net => {
            const netCodes = codes.filter(c => (c.net_type || c.netType || 'miscellaneous') === net);
            if (netCodes.length === 0) return;

            const color = NET_COLORS[net] || '#94a3b8';
            html += `<div class="oe-cfp-net" style="border-left:3px solid ${color};padding-left:12px;margin-bottom:16px;">
                <div class="oe-cfp-net-label" style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${color};margin-bottom:8px;">${NET_LABELS[net] || net}</div>`;

            // Group by theme within this net
            const themes = [...new Set(netCodes.map(c => c.theme || c.Theme || 'General'))];
            themes.forEach(theme => {
                const themeCodes = netCodes.filter(c => (c.theme || c.Theme || 'General') === theme);
                html += `<div class="oe-cfp-theme" style="margin-bottom:10px;">
                    <div style="font-size:0.78rem;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">${escapeHtml(theme)}</div>`;

                themeCodes.forEach(code => {
                    const cv = code.code_value || code.codeValue || '';
                    const cl = code.code_label || code.codeLabel || '';
                    const def = code.definition || '';
                    const inc = code.includes || '';
                    const exc = code.excludes || '';
                    const isOther = code.is_other || code.isOther;

                    html += `<div class="oe-cfp-subtheme" style="display:flex;gap:8px;padding:3px 0 3px 8px;">
                        <span class="oe-cfp-code">${escapeHtml(cv)}</span>
                        <div style="flex:1;min-width:0;">
                            <span class="oe-cfp-label">${escapeHtml(cl)}${isOther ? ' <span class="oe-method-badge oe-method-trivial" style="font-size:0.6rem;">OTHER</span>' : ''}</span>
                            ${def ? `<div class="oe-cfp-def">${escapeHtml(def)}</div>` : ''}
                            ${inc ? `<div class="oe-cfp-tags"><span class="oe-cfp-tag-label">+</span> ${escapeHtml(inc)}</div>` : ''}
                            ${exc ? `<div class="oe-cfp-tags"><span class="oe-cfp-tag-label">-</span> ${escapeHtml(exc)}</div>` : ''}
                        </div>
                    </div>`;
                });
                html += `</div>`;
            });
            html += `</div>`;
        });
    } else {
        // Fallback for old codeframes without net_type — flat list
        codes.forEach(code => {
            const cv = code.code_value || code.codeValue || '';
            const cl = code.code_label || code.codeLabel || '';
            const def = code.definition || '';
            html += `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-color);">
                <span class="oe-cfp-code">${escapeHtml(cv)}</span>
                <div><span class="oe-cfp-label">${escapeHtml(cl)}</span>${def ? `<div class="oe-cfp-def">${escapeHtml(def)}</div>` : ''}</div>
            </div>`;
        });
    }

    body.innerHTML = html;
}

// ============================================
// CODING JOBS
// ============================================

let oeJobPollTimer = null;

async function loadOeJobs() {
    try {
        oeJobs = await api.request(`/research/projects/${projectId}/openend-coding/jobs`) || [];
        renderOeJobs();

        // Auto-join SignalR for running jobs + start polling
        const runningJobs = oeJobs.filter(j => j.status !== 'complete' && j.status !== 'failed' && j.status !== 'cancelled');
        if (runningJobs.length > 0) {
            // Join SignalR groups
            if (fileProgressConnected && fileProgressConnection) {
                for (const job of runningJobs) {
                    try { await fileProgressConnection.invoke('JoinOpenEndCodingProgress', job.id); } catch {}
                }
            }
            // Start polling every 5 seconds
            startJobPolling();
        } else {
            stopJobPolling();
        }
    } catch (e) {
        console.error('Failed to load coding jobs:', e);
    }
}

function startJobPolling() {
    if (oeJobPollTimer) return; // already polling
    oeJobPollTimer = setInterval(async () => {
        try {
            const jobs = await api.request(`/research/projects/${projectId}/openend-coding/jobs`) || [];
            const running = jobs.filter(j => j.status !== 'complete' && j.status !== 'failed' && j.status !== 'cancelled');
            if (running.length === 0) {
                stopJobPolling();
                oeJobs = jobs;
                renderOeJobs();
                return;
            }
            oeJobs = jobs;
            renderOeJobs();
        } catch {}
    }, 5000);
}

function stopJobPolling() {
    if (oeJobPollTimer) { clearInterval(oeJobPollTimer); oeJobPollTimer = null; }
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
    // Use status for human-readable label, fall back to current_stage for detail
    const stageKey = status || job.currentStage || job.current_stage || '';
    const stageDetail = job.currentStage || job.current_stage || '';
    const stage = OE_STAGE_LABELS[stageKey] || OE_STAGE_LABELS[stageDetail] || stageDetail || status;
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

    if (isFailed) {
        return `<div class="oe-job-row oe-job-row-failed" id="oe-job-${job.id}" data-job-id="${job.id}">
            <span class="oe-job-var">${escapeHtml(varName)}</span>
            <span class="status-badge failed">Failed</span>
            <span class="oe-job-row-err" title="${escapeHtml(job.errorMessage || job.error_message || '')}">${escapeHtml((job.errorMessage || job.error_message || 'Error').substring(0, 60))}</span>
        </div>`;
    }

    if (isRunning) {
        return `<div class="oe-job-row oe-job-row-running" id="oe-job-${job.id}" data-job-id="${job.id}">
            <span class="oe-job-var">${escapeHtml(varName)}</span>
            <span class="status-badge active">Processing</span>
            <span class="oe-job-row-stage">${escapeHtml(stage)}</span>
            <div class="oe-job-row-bar"><div class="file-progress-fill" style="width:${pct}%"></div></div>
            <span class="oe-job-row-pct">${Math.round(pct)}%</span>
            <button class="oe-btn oe-btn-danger oe-btn-xs" onclick="cancelOeJob('${job.id}')">Cancel</button>
        </div>`;
    }

    // Complete
    const coded = repsCoded + propagated + verified;
    return `<div class="oe-job-row" id="oe-job-${job.id}" data-job-id="${job.id}">
        <span class="oe-job-var">${escapeHtml(varName)}</span>
        <span class="status-badge ready">Complete</span>
        <span class="oe-job-row-info">${totalResp.toLocaleString()} responses &middot; ${clusters} clusters &middot; ${coded.toLocaleString()} coded</span>
        <span class="oe-job-row-info">${elapsed}</span>
        <button class="oe-btn oe-btn-primary oe-btn-xs" onclick="loadOeResults('${job.id}')">View Results</button>
        <button class="oe-btn oe-btn-ghost oe-btn-xs" onclick="openCostBreakdown('${job.id}')">Cost</button>
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

    try {
        const body = {
            file_id: fileId,
            variable_name: varName
        };
        if (codeframeId) body.codeframe_id = codeframeId;

        const result = await api.request(`/research/projects/${projectId}/openend-coding/jobs`, {
            method: 'POST',
            body: JSON.stringify(body)
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

function toggleOeSection(sectionId) {
    const body = document.getElementById(sectionId + 'Body');
    const arrow = document.getElementById(sectionId + 'Arrow');
    if (!body) return;
    const isCollapsed = body.classList.toggle('collapsed');
    if (arrow) arrow.classList.toggle('collapsed', isCollapsed);
}

function collapseOeSection(sectionId) {
    const body = document.getElementById(sectionId + 'Body');
    const arrow = document.getElementById(sectionId + 'Arrow');
    if (body) body.classList.add('collapsed');
    if (arrow) arrow.classList.add('collapsed');
}

function expandOeSection(sectionId) {
    const body = document.getElementById(sectionId + 'Body');
    const arrow = document.getElementById(sectionId + 'Arrow');
    if (body) body.classList.remove('collapsed');
    if (arrow) arrow.classList.remove('collapsed');
}

async function loadOeResults(jobId) {
    oeCurrentJobId = jobId;
    oeResultsPage = 1;
    oeResultsCodeframeCodes = [];

    // Show results section, collapse jobs, expand results
    const resultsSection = document.getElementById('oeResultsSection');
    if (resultsSection) resultsSection.style.display = 'flex';
    collapseOeSection('oeJobSection');
    expandOeSection('oeResultsSection');

    // Load codeframe codes for column headers
    const job = oeJobs.find(j => j.id === jobId);
    const cfId = job?.codeframe_id || job?.codeframeId;
    if (cfId) {
        try {
            const cfData = await api.request(`/research/projects/${projectId}/openend-coding/codeframes/${cfId}`);
            oeResultsCodeframeCodes = (cfData.codes || []).filter(c => !(c.is_other || c.isOther));
        } catch (e) { console.warn('Failed to load codeframe codes for matrix:', e); }
    }

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
    const cfCodes = oeResultsCodeframeCodes;
    window._oeTips = {}; // reset tooltip map
    let _tipIdx = 0;

    // Header
    let html = `<div class="oe-results-header">
        <div class="oe-results-summary">Showing ${items.length} of ${totalCount.toLocaleString()} (page ${oeResultsPage}/${totalPages})</div>
        <div style="display:flex;align-items:center;gap:8px;">
            <button class="oe-btn oe-btn-secondary oe-btn-xs" onclick="openCodeSummary()">Code Summary</button>
            <div class="oe-page-size"><label>Per page:</label>
                <select onchange="oeChangePageSize(this.value)">
                    <option value="25"${oeResultsPageSize===25?' selected':''}>25</option>
                    <option value="50"${oeResultsPageSize===50?' selected':''}>50</option>
                    <option value="100"${oeResultsPageSize===100?' selected':''}>100</option>
                </select>
            </div>
        </div>
    </div>`;

    // Find max codes assigned to any response on this page
    let maxCodes = 0;
    items.forEach(item => {
        try {
            const codes = JSON.parse(item.codesJson || item.codes_json || '[]');
            const unique = new Set(codes.map(c => c.code_value || c.codeValue || '')).size;
            if (unique > maxCodes) maxCodes = unique;
        } catch {}
    });
    maxCodes = Math.max(maxCodes, 1); // at least 1 column

    // Matrix table — compact N-column layout (N = max codes on any response)
    html += `<div class="oe-matrix-wrap"><table class="oe-matrix">
        <thead><tr>
            <th class="oe-matrix-th-row">#</th>
            <th class="oe-matrix-th-resp">Response</th>
            <th class="oe-matrix-th-meta">Method</th>`;

    for (let i = 0; i < maxCodes; i++) {
        html += `<th class="oe-matrix-th-code">Code ${i + 1}</th>`;
    }
    html += `</tr></thead><tbody>`;

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

        // Deduplicate codes into a map by code_value
        const codeMap = new Map();
        codes.forEach(c => {
            const cv = c.code_value || c.codeValue || '';
            const existing = codeMap.get(cv);
            if (!existing || (c.confidence || 0) > (existing.confidence || 0)) {
                codeMap.set(cv, c);
            }
        });

        const sentimentVal = sentiment != null ? parseFloat(sentiment) : null;
        const sentimentClass = sentimentVal != null ? (sentimentVal > 0.2 ? 'positive' : sentimentVal < -0.2 ? 'negative' : 'neutral') : 'neutral';

        const truncText = text.length > 100 ? text.substring(0, 100) + '…' : text;
        const sentimentStr = sentimentVal != null ? (sentimentVal > 0 ? '+' : '') + sentimentVal.toFixed(2) : '';
        const sBadgeCls = sentimentVal > 0.2 ? 'oe-tip-pos' : sentimentVal < -0.2 ? 'oe-tip-neg' : 'oe-tip-neu';
        const rTipId = 'r' + (++_tipIdx);
        window._oeTips[rTipId] = `<div class="oe-tip-text">${escapeHtml(text)}</div><hr><span class="oe-tip-label">Sentiment</span><span class="oe-tip-badge ${sBadgeCls}">${sentimentStr}</span> <span class="oe-tip-label" style="margin-left:8px">Confidence</span><span class="oe-tip-badge oe-tip-neu">${(confidence * 100).toFixed(0)}%</span> <span class="oe-tip-label" style="margin-left:8px">Method</span><span class="oe-tip-badge oe-tip-neu">${method}</span>`;

        // Build the code summary for the expandable detail row
        const codeList = Array.from(codeMap.values())
            .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
            .map(c => {
                const cv = c.code_value || c.codeValue || '';
                const cl = c.code_label || c.codeLabel || '';
                const s = parseFloat(c.sentiment || 0);
                const sIcon = s > 0.2 ? '&#9650;' : s < -0.2 ? '&#9660;' : '&#8226;';
                const sColor = s > 0.2 ? '#34d399' : s < -0.2 ? '#f87171' : '#94a3b8';
                const conf = c.confidence ? (c.confidence * 100).toFixed(0) + '%' : '';
                const claim = c.claim_text || c.claimText || '';
                return `<div class="oe-expand-code"><span class="oe-expand-cv" style="color:${sColor}">${sIcon} ${escapeHtml(cv)}</span> <span class="oe-expand-cl">${escapeHtml(cl)}</span>${conf ? `<span class="oe-expand-conf">${conf}</span>` : ''}${claim ? `<span class="oe-expand-claim">&ldquo;${escapeHtml(claim)}&rdquo;</span>` : ''}</div>`;
            }).join('');

        const expandId = `oe-exp-${rowId}`;
        const colSpan = maxCodes + 3; // # + Response + Method + code columns
        html += `<tr class="oe-matrix-row ${flagged ? 'oe-matrix-flagged' : ''}" onclick="document.getElementById('${expandId}').classList.toggle('oe-expand-show')" style="cursor:pointer">
            <td class="oe-matrix-rowid">${flagged ? '<span class="oe-flag-icon" data-tip="' + escapeHtml(flagReason) + '">&#9888;</span>' : ''}${rowId}</td>
            <td class="oe-matrix-resp" data-tip-id="${rTipId}">
                <span class="oe-matrix-text">${escapeHtml(truncText)}</span>
                <span class="oe-sentiment-badge ${sentimentClass}" style="font-size:0.62rem;padding:1px 4px;margin-left:4px;">${sentimentStr}</span>
                <span style="font-size:0.62rem;color:var(--text-muted)">${(confidence * 100).toFixed(0)}%</span>
                <span class="oe-expand-arrow">&#9662;</span>
                <a class="oe-matrix-edit" onclick="event.stopPropagation();editOeCoding('${oeCurrentJobId}', ${rowId})">&#9998;</a>
            </td>
            <td class="oe-matrix-method"><span class="oe-method-badge oe-method-${method}">${method}</span></td>`;

        // Compact code cells — fill N columns left-to-right with assigned codes
        const sortedCodes = Array.from(codeMap.values())
            .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

        for (let i = 0; i < maxCodes; i++) {
            if (i < sortedCodes.length) {
                const c = sortedCodes[i];
                const cv = c.code_value || c.codeValue || '';
                const cl = c.code_label || c.codeLabel || '';
                const s = parseFloat(c.sentiment || 0);
                const sClass = s > 0.2 ? 'positive' : s < -0.2 ? 'negative' : 'neutral';
                const conf = c.confidence ? (c.confidence * 100).toFixed(0) + '%' : '';
                const claimText = c.claim_text || c.claimText || '';
                const cSentStr = (s > 0 ? '+' : '') + s.toFixed(2);
                const cBadgeCls = s > 0.2 ? 'oe-tip-pos' : s < -0.2 ? 'oe-tip-neg' : 'oe-tip-neu';
                const cTipId = 'c' + (++_tipIdx);
                window._oeTips[cTipId] = `<strong>${escapeHtml(cv)}: ${escapeHtml(cl)}</strong>${claimText ? '<hr><div class="oe-tip-text" style="font-style:italic">&ldquo;' + escapeHtml(claimText) + '&rdquo;</div>' : ''}<hr><span class="oe-tip-label">Sentiment</span><span class="oe-tip-badge ${cBadgeCls}">${cSentStr}</span>${conf ? ' <span class="oe-tip-label" style="margin-left:8px">Confidence</span><span class="oe-tip-badge oe-tip-neu">' + conf + '</span>' : ''}`;
                // Show only code number — hover tooltip shows full label
                html += `<td class="oe-matrix-cell oe-matrix-hit ${sClass}" data-tip-id="${cTipId}">${escapeHtml(cv)}</td>`;
            } else {
                html += `<td class="oe-matrix-cell"></td>`;
            }
        }

        html += `</tr>`;

        // Parse claims for decomposition view
        let claimsData = [];
        try { claimsData = JSON.parse(item.claimsJson || item.claims_json || '[]'); } catch {}
        const claimsList = Array.isArray(claimsData) && claimsData.length > 0
            ? claimsData.map((cl, ci) => {
                const ct = cl.claim_text || cl.claimText || '';
                const clCodes = (cl.codes || []).map(cc => {
                    const ccv = cc.code_value || cc.codeValue || '';
                    const ccl = codes.find(x => (x.code_value || x.codeValue) === ccv);
                    return ccl ? (ccl.code_label || ccl.codeLabel || ccv) : ccv;
                }).join(', ');
                const s = cl.codes && cl.codes[0] ? (cl.codes[0].sentiment || 0) : 0;
                const sColor = s > 0.2 ? '#34d399' : s < -0.2 ? '#f87171' : '#94a3b8';
                return `<div class="oe-expand-claim-item"><span class="oe-expand-claim-num" style="color:${sColor}">${ci+1}.</span> <span class="oe-expand-claim-text">${escapeHtml(ct)}</span>${clCodes ? `<span class="oe-expand-claim-codes">${escapeHtml(clCodes)}</span>` : ''}</div>`;
            }).join('')
            : '';

        // Expandable detail row — hidden by default, shown on click
        html += `<tr id="${expandId}" class="oe-expand-row">
            <td colspan="${colSpan}" class="oe-expand-cell">
                <div class="oe-expand-fulltext">${escapeHtml(text)}</div>
                ${claimsList ? `<div class="oe-expand-codes-title">Decomposed Claims (${claimsData.length})</div><div class="oe-expand-claims">${claimsList}</div>` : ''}
                <div class="oe-expand-codes-title" style="margin-top:8px">Assigned Codes (${codeMap.size})</div>
                <div class="oe-expand-codes">${codeList || '<span style="color:var(--text-muted)">No codes assigned</span>'}</div>
            </td>
        </tr>`;
    });

    html += '</tbody></table></div>';

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

function oeChangePageSize(val) {
    oeResultsPageSize = parseInt(val) || 50;
    oeResultsPage = 1;
    fetchAndRenderResults();
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
    const modal = document.getElementById('responseEditModal');
    if (!modal) return;

    const body = document.getElementById('responseEditBody');
    if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';
    modal.dataset.jobId = jobId;
    modal.dataset.rowId = rowId;
    modal.classList.add('active');

    try {
        // Load response data and codeframe codes in parallel
        const job = oeJobs.find(j => j.id === jobId);
        const codeframeId = job?.codeframeId || job?.codeframe_id;

        const [resultsData, codeframeData] = await Promise.all([
            api.request(`/research/projects/${projectId}/openend-coding/jobs/${jobId}/results?page=1&pageSize=1&row_id=${rowId}`),
            codeframeId ? api.request(`/research/projects/${projectId}/openend-coding/codeframes/${codeframeId}`) : Promise.resolve(null)
        ]);

        const item = (resultsData.items || [])[0];
        if (!item) { body.innerHTML = '<div class="empty-state"><p>Response not found</p></div>'; return; }

        const responseText = item.responseText || item.response_text || '';
        const currentSentiment = item.overallSentiment ?? item.overall_sentiment ?? 0;
        let currentCodes = [];
        try { currentCodes = JSON.parse(item.codesJson || item.codes_json || '[]'); } catch {}

        const allCodes = codeframeData?.codes || [];
        const currentCodeValues = new Set(currentCodes.map(c => c.code_value || c.codeValue));

        // Build code-specific sentiment map
        const codeSentimentMap = {};
        currentCodes.forEach(c => { codeSentimentMap[c.code_value || c.codeValue] = c.sentiment || 0; });

        let html = `
        <div class="oe-edit-response"><strong>Response (row ${rowId}):</strong> ${escapeHtml(responseText)}</div>
        <div class="oe-edit-sentiment">
            <label>Overall Sentiment: <span id="oeEditSentimentVal">${currentSentiment >= 0 ? '+' : ''}${parseFloat(currentSentiment).toFixed(1)}</span></label>
            <input type="range" id="oeEditSentiment" min="-1" max="1" step="0.1" value="${currentSentiment}"
                oninput="document.getElementById('oeEditSentimentVal').textContent = (this.value >= 0 ? '+' : '') + parseFloat(this.value).toFixed(1)">
        </div>
        <h4 style="margin: 12px 0 8px; font-size: 0.85rem; color: var(--text-secondary);">Assign Codes</h4>
        <div class="oe-edit-codes-list">`;

        if (allCodes.length > 0) {
            allCodes.forEach(code => {
                const cv = code.codeValue || code.code_value;
                const cl = code.codeLabel || code.code_label;
                const checked = currentCodeValues.has(cv);
                const codeSent = codeSentimentMap[cv] ?? 0;
                html += `
                <div class="oe-edit-code-row">
                    <label class="oe-edit-code-check">
                        <input type="checkbox" value="${escapeHtml(cv)}" data-label="${escapeHtml(cl)}" ${checked ? 'checked' : ''}>
                        <span class="oe-code-badge">${escapeHtml(cv)}</span> ${escapeHtml(cl)}
                    </label>
                    <div class="oe-edit-code-sentiment">
                        <input type="range" min="-1" max="1" step="0.1" value="${codeSent}" data-code="${escapeHtml(cv)}"
                            title="Sentiment for ${escapeHtml(cv)}">
                    </div>
                </div>`;
            });
        } else {
            // No codeframe — allow freeform from current codes
            currentCodes.forEach(c => {
                const cv = c.code_value || c.codeValue;
                const cl = c.code_label || c.codeLabel;
                html += `
                <div class="oe-edit-code-row">
                    <label class="oe-edit-code-check">
                        <input type="checkbox" value="${escapeHtml(cv)}" data-label="${escapeHtml(cl)}" checked>
                        <span class="oe-code-badge">${escapeHtml(cv)}</span> ${escapeHtml(cl)}
                    </label>
                    <div class="oe-edit-code-sentiment">
                        <input type="range" min="-1" max="1" step="0.1" value="${c.sentiment || 0}" data-code="${escapeHtml(cv)}">
                    </div>
                </div>`;
            });
        }

        html += '</div>';
        if (body) body.innerHTML = html;
    } catch (e) {
        if (body) body.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

async function saveResponseEdit() {
    const modal = document.getElementById('responseEditModal');
    if (!modal) return;
    const jobId = modal.dataset.jobId;
    const rowId = modal.dataset.rowId;
    if (!jobId || !rowId) return;

    const checkboxes = modal.querySelectorAll('.oe-edit-codes-list input[type="checkbox"]:checked');
    const sentimentSliders = modal.querySelectorAll('.oe-edit-codes-list input[type="range"]');
    const overallSentiment = parseFloat(document.getElementById('oeEditSentiment')?.value || '0');

    // Build sentiment map from sliders
    const sentMap = {};
    sentimentSliders.forEach(s => { if (s.dataset.code) sentMap[s.dataset.code] = parseFloat(s.value); });

    const codes = Array.from(checkboxes).map(cb => ({
        code_value: cb.value,
        code_label: cb.dataset.label || '',
        confidence: 1.0,
        sentiment: sentMap[cb.value] || 0
    }));

    try {
        await api.request(`/research/projects/${projectId}/openend-coding/jobs/${jobId}/results/${rowId}`, {
            method: 'PUT',
            body: JSON.stringify({ codes, overall_sentiment: overallSentiment })
        });
        Toast.success('Coding updated');
        closeResponseEditModal();
        fetchAndRenderResults();
    } catch (e) {
        Toast.error('Failed to save: ' + e.message);
    }
}

function closeResponseEditModal() {
    document.getElementById('responseEditModal')?.classList.remove('active');
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
        const [cost, jobData] = await Promise.all([
            api.request(`/research/projects/${projectId}/openend-coding/jobs/${jobId}/cost`),
            api.request(`/research/projects/${projectId}/openend-coding/jobs/${jobId}`)
        ]);

        const totalCost = cost.totalCostUsd || cost.total_cost_usd || 0;
        const totalCalls = cost.totalLlmCalls || cost.total_llm_calls || 0;
        const totalIn = cost.totalInputTokens || cost.total_input_tokens || 0;
        const totalOut = cost.totalOutputTokens || cost.total_output_tokens || 0;
        const totalCache = cost.totalCacheReadTokens || cost.total_cache_read_tokens || 0;
        const stages = cost.byStage || cost.by_stage || [];

        // Calculate totals for responses coded
        const totalResponses = jobData?.totalResponses || jobData?.total_responses || 0;
        const totalClaims = jobData?.totalClaims || jobData?.total_claims || 0;
        const costPerResponse = totalResponses > 0 ? (totalCost / totalResponses) : 0;

        let html = `
        <div class="oe-cost-summary">
            <div class="oe-cost-stat"><span class="oe-stat-value">$${totalCost.toFixed(2)}</span><span class="oe-stat-label">Total Cost</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">${totalResponses.toLocaleString()}</span><span class="oe-stat-label">Responses</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">${totalClaims.toLocaleString()}</span><span class="oe-stat-label">Claims</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">${totalCalls.toLocaleString()}</span><span class="oe-stat-label">LLM Calls</span></div>
        </div>
        <div class="oe-cost-summary" style="margin-top:4px">
            <div class="oe-cost-stat"><span class="oe-stat-value">${formatTokens(totalIn)}</span><span class="oe-stat-label">Input Tokens</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">${formatTokens(totalOut)}</span><span class="oe-stat-label">Output Tokens</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">${formatTokens(totalCache)}</span><span class="oe-stat-label">Cache Hits</span></div>
            <div class="oe-cost-stat"><span class="oe-stat-value">$${costPerResponse.toFixed(4)}</span><span class="oe-stat-label">Per Response</span></div>
        </div>

        <h4 style="margin: 12px 0 6px; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">Cost by Stage</h4>
        <table class="oe-cost-table">
            <thead><tr><th>Stage</th><th>Model</th><th>Calls</th><th>Tokens (in/out)</th><th>Cost</th></tr></thead>
            <tbody>
                ${stages.map(s => {
                    const model = (s.model || '').includes('haiku') ? 'Haiku' : (s.model || '').includes('sonnet') ? 'Sonnet' : (s.model || '').split('-').pop();
                    const stageName = OE_STAGE_LABELS[s.stage] || s.stage;
                    const inTok = s.inputTokens || s.input_tokens || 0;
                    const outTok = s.outputTokens || s.output_tokens || 0;
                    const sCost = s.costUsd || s.cost_usd || 0;
                    return `<tr>
                    <td>${escapeHtml(stageName)}</td>
                    <td class="oe-cost-model">${escapeHtml(model)}</td>
                    <td>${s.calls}</td>
                    <td>${formatTokens(inTok)} / ${formatTokens(outTok)}</td>
                    <td>$${sCost.toFixed(2)}</td>
                </tr>`;
                }).join('')}
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

// ============================================
// INSTANT TOOLTIP (JS-positioned, contrast-safe)
// ============================================
(function() {
    let wrapper = null; // fixed container that can't affect body layout
    let tipEl = null;
    let currentTarget = null;

    function ensureTip() {
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:99999;pointer-events:none;';
            tipEl = document.createElement('div');
            tipEl.className = 'oe-tip';
            tipEl.style.display = 'none';
            wrapper.appendChild(tipEl);
            document.body.appendChild(wrapper);
        }
        return tipEl;
    }

    function show(target) {
        const tipId = target.getAttribute('data-tip-id');
        const text = target.getAttribute('data-tip');
        if (!tipId && !text) return;
        currentTarget = target;
        const tip = ensureTip();
        if (tipId && window._oeTips && window._oeTips[tipId]) {
            tip.innerHTML = window._oeTips[tipId];
        } else if (text) {
            tip.textContent = text;
        } else return;
        tip.style.display = 'block';
        tip.style.visibility = 'hidden'; // measure without showing

        const r = target.getBoundingClientRect();
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;

        let top = r.top - th - 8;
        let left = r.left + r.width / 2 - tw / 2;
        if (top < 4) top = r.bottom + 8;
        if (left < 4) left = 4;
        if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
        if (top + th > window.innerHeight - 4) top = window.innerHeight - th - 4;

        tip.style.top = top + 'px';
        tip.style.left = left + 'px';
        tip.style.visibility = 'visible';
    }

    function hide() {
        currentTarget = null;
        if (tipEl) { tipEl.style.display = 'none'; tipEl.style.visibility = 'hidden'; }
    }

    function findTipTarget(el) {
        return el?.closest('[data-tip-id]') || el?.closest('[data-tip]');
    }
    document.addEventListener('mouseover', e => {
        const t = findTipTarget(e.target);
        if (t && t !== currentTarget) show(t);
        else if (!t) hide();
    });
    document.addEventListener('mouseout', e => {
        const t = findTipTarget(e.target);
        if (t) {
            const related = findTipTarget(e.relatedTarget);
            if (related !== t) hide();
        }
    });
})();

// ============================================
// CODE SUMMARY — Theme/Sub-theme frequency popup
// ============================================

function closeCodeSummary() {
    const modal = document.getElementById('codeSummaryModal');
    if (modal) modal.remove();
}

function csFilterSummary(query) {
    const q = query.toLowerCase().trim();
    const body = document.getElementById('codeSummaryBody');
    if (!body) return;

    // Show all if empty
    if (!q) {
        body.querySelectorAll('.cs-net, .cs-theme, .cs-code').forEach(el => el.style.display = '');
        return;
    }

    // Hide/show code rows based on match
    body.querySelectorAll('.cs-code').forEach(el => {
        const label = el.dataset.csLabel || '';
        const value = el.dataset.csValue || '';
        el.style.display = (label.includes(q) || value.includes(q)) ? '' : 'none';
    });

    // Show theme if any child code is visible
    body.querySelectorAll('.cs-theme').forEach(theme => {
        const hasVisible = theme.querySelectorAll('.cs-code:not([style*="display: none"])').length > 0;
        theme.style.display = hasVisible ? '' : 'none';
        // Expand matched themes
        if (hasVisible) {
            const children = theme.querySelector('[onclick] + div');
            if (children) children.style.display = 'block';
        }
    });

    // Show net if any child theme is visible
    body.querySelectorAll('.cs-net').forEach(net => {
        const hasVisible = net.querySelectorAll('.cs-theme:not([style*="display: none"])').length > 0;
        net.style.display = hasVisible ? '' : 'none';
        // Expand matched nets
        if (hasVisible) {
            const children = net.querySelector('[onclick] + div');
            if (children) children.style.display = 'block';
        }
    });
}

async function openCodeSummary() {
    // Remove existing modal if any
    closeCodeSummary();

    // Create modal using existing gm-* glassmorphic modal classes
    const modal = document.createElement('div');
    modal.id = 'codeSummaryModal';
    modal.className = 'gm-overlay active';
    modal.innerHTML = `
        <div class="gm-modal gm-lg" style="width:740px;max-height:85vh;">
            <div class="gm-header">
                <div class="gm-header-left">
                    <div class="gm-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg></div>
                    <div class="gm-title-group">
                        <h3 class="gm-title">Code Summary</h3>
                        <p class="gm-subtitle">Theme and sub-theme frequencies</p>
                    </div>
                </div>
                <button class="gm-close" onclick="closeCodeSummary()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
            <div class="gm-body" id="codeSummaryBody">
                <div class="loading-state"><div class="spinner"></div><p>Calculating frequencies...</p></div>
            </div>
        </div>`;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeCodeSummary(); });
    document.body.appendChild(modal);

    const body = document.getElementById('codeSummaryBody');

    try {
        // Fetch ALL results (no pagination) to count code frequencies
        const data = await api.request(`/research/projects/${projectId}/openend-coding/jobs/${oeCurrentJobId}/results?page=1&pageSize=10000`);
        const items = data.items || [];
        const totalResponses = items.length;

        // Count: for each code_value, how many RESPONSES have it in any code slot
        // Also track which responses have codes in each net/theme for proper net-level counting
        const codeCounts = {};
        const codeToNet = {};   // code_value → net_type
        const codeToTheme = {}; // code_value → theme
        const netResponses = {};   // net_type → Set of response indices
        const themeResponses = {}; // "net|theme" → Set of response indices

        // Pre-build code→net/theme mapping from codeframe
        oeResultsCodeframeCodes.forEach(c => {
            const cv = c.code_value || c.codeValue || '';
            codeToNet[cv] = c.net_type || 'miscellaneous';
            codeToTheme[cv] = c.theme || 'Other';
        });
        // Add 997 and 999 mappings
        codeToNet['997'] = 'miscellaneous'; codeToTheme['997'] = 'Other';
        codeToNet['999'] = 'miscellaneous'; codeToTheme['999'] = 'Non-Substantive';

        items.forEach((item, idx) => {
            let codes = [];
            try { codes = JSON.parse(item.codesJson || item.codes_json || '[]'); } catch {}
            // Deduplicate code_values per response
            const uniqueCodes = new Set(codes.map(c => c.code_value || c.codeValue || ''));
            uniqueCodes.forEach(cv => {
                codeCounts[cv] = (codeCounts[cv] || 0) + 1;

                // Track response in net and theme groups
                const net = codeToNet[cv] || 'miscellaneous';
                const theme = codeToTheme[cv] || 'Other';
                if (!netResponses[net]) netResponses[net] = new Set();
                netResponses[net].add(idx);
                const themeKey = `${net}|${theme}`;
                if (!themeResponses[themeKey]) themeResponses[themeKey] = new Set();
                themeResponses[themeKey].add(idx);
            });
        });

        // Get all codeframe codes including OTHER (997) and 999
        const allCodes = [...oeResultsCodeframeCodes];
        // Add 997 (Other) if it exists in counts
        if (codeCounts['997']) {
            allCodes.push({ code_value: '997', code_label: 'Other', net_type: 'miscellaneous', theme: 'Other', is_other: true });
        }
        // Add 999 (Don't Know/NA) if it exists in counts
        if (codeCounts['999']) {
            allCodes.push({ code_value: '999', code_label: "Don't Know / NA / None", net_type: 'miscellaneous', theme: 'Non-Substantive', is_other: false });
        }

        // Group by net_type → theme → codes
        const netOrder = ['positive', 'negative', 'neutral', 'miscellaneous'];
        const netLabels = { positive: 'Positive', negative: 'Negative', neutral: 'Neutral', miscellaneous: 'Miscellaneous' };
        const netColors = { positive: '#34d399', negative: '#f87171', neutral: '#94a3b8', miscellaneous: '#a78bfa' };

        // Build hierarchy
        const hierarchy = {};
        allCodes.forEach(code => {
            const net = code.net_type || 'miscellaneous';
            const theme = code.theme || 'Other';
            if (!hierarchy[net]) hierarchy[net] = {};
            if (!hierarchy[net][theme]) hierarchy[net][theme] = [];
            const cv = code.code_value || code.codeValue || '';
            hierarchy[net][theme].push({
                codeValue: cv,
                codeLabel: code.code_label || code.codeLabel || '',
                count: codeCounts[cv] || 0,
                pct: totalResponses > 0 ? ((codeCounts[cv] || 0) / totalResponses * 100) : 0
            });
        });

        // Calculate net-level and theme-level totals (union of responses with any code in that group)
        // For display, sum of sub-theme counts (multi-coded responses counted once per code)

        // Render
        let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;">
            <span style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;">Base: ${totalResponses.toLocaleString()} responses</span>
            <input type="text" id="csSummarySearch" placeholder="Search codes..." oninput="csFilterSummary(this.value)"
                style="flex:1;max-width:260px;padding:5px 10px;font-size:0.74rem;border-radius:6px;border:1px solid var(--border-color);background:var(--glass-bg-strong, rgba(30,41,59,0.95));color:var(--text-primary);outline:none;" />
        </div>`;

        let netIdx = 0;
        netOrder.forEach(net => {
            if (!hierarchy[net]) return;
            const themes = hierarchy[net];
            const netId = `cs-net-${netIdx++}`;

            const netUniqueCount = netResponses[net] ? netResponses[net].size : 0;
            const netPct = totalResponses > 0 ? (netUniqueCount / totalResponses * 100).toFixed(1) : '0.0';

            // Net header — clickable to expand/collapse
            html += `<div class="cs-net" style="border-top:2px solid var(--glass-border, rgba(255,255,255,0.08));margin-top:4px;">
                <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.cs-arrow').classList.toggle('cs-collapsed')"
                     style="display:flex;align-items:center;justify-content:space-between;padding:7px 6px;cursor:pointer;background:var(--glass-bg-light, rgba(255,255,255,0.04));border-radius:4px;margin-bottom:1px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span class="cs-arrow" style="font-size:0.6rem;color:var(--text-muted);transition:transform 0.2s;display:inline-block;">&#9660;</span>
                        <span style="font-weight:700;color:${netColors[net]};font-size:0.8rem;">${netLabels[net] || net}</span>
                    </div>
                    <div style="display:flex;align-items:center;">
                        <span style="font-weight:700;color:var(--text-primary);font-size:0.78rem;min-width:44px;text-align:right;margin-right:8px;">${netUniqueCount.toLocaleString()}</span>
                        <span style="font-weight:700;color:var(--text-primary);font-size:0.78rem;min-width:50px;text-align:right;">${netPct}%</span>
                        <div style="width:70px;margin-left:8px;flex-shrink:0;">
                            <div style="background:var(--glass-border, rgba(255,255,255,0.06));border-radius:2px;height:10px;overflow:hidden;">
                                <div style="width:${totalResponses > 0 ? Math.max(1, parseFloat(netPct)) : 0}%;height:100%;background:${netColors[net]};border-radius:2px;"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div>`;

            let themeIdx = 0;
            Object.entries(themes).forEach(([theme, codes]) => {
                const themeKey = `${net}|${theme}`;
                const themeUniqueCount = themeResponses[themeKey] ? themeResponses[themeKey].size : 0;
                const themePct = totalResponses > 0 ? (themeUniqueCount / totalResponses * 100).toFixed(1) : '0.0';

                // Theme header — clickable to expand/collapse
                html += `<div class="cs-theme" style="margin-left:10px;">
                    <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.cs-arrow').classList.toggle('cs-collapsed')"
                         style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px 4px 8px;cursor:pointer;background:var(--bg-tertiary, rgba(255,255,255,0.02));border-radius:3px;margin-bottom:1px;">
                        <div style="display:flex;align-items:center;gap:5px;">
                            <span class="cs-arrow" style="font-size:0.55rem;color:var(--text-muted);transition:transform 0.2s;display:inline-block;">&#9660;</span>
                            <span style="font-weight:600;font-size:0.74rem;color:var(--text-secondary);">${escapeHtml(theme)}</span>
                        </div>
                        <div style="display:flex;align-items:center;">
                            <span style="font-weight:600;font-size:0.74rem;color:var(--text-secondary);min-width:44px;text-align:right;margin-right:8px;">${themeUniqueCount.toLocaleString()}</span>
                            <span style="font-weight:600;font-size:0.74rem;color:var(--text-secondary);min-width:50px;text-align:right;">${themePct}%</span>
                            <div style="width:70px;margin-left:8px;flex-shrink:0;">
                                <div style="background:var(--glass-border, rgba(255,255,255,0.06));border-radius:2px;height:10px;overflow:hidden;">
                                    <div style="width:${totalResponses > 0 ? Math.max(1, parseFloat(themePct)) : 0}%;height:100%;background:${netColors[net]};border-radius:2px;opacity:0.7;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div>`;

                codes.sort((a, b) => b.count - a.count);
                codes.forEach(code => {
                    const barWidth = totalResponses > 0 ? Math.max(1, code.pct) : 0;
                    html += `<div class="cs-code" data-cs-label="${escapeHtml(code.codeLabel.toLowerCase())}" data-cs-value="${escapeHtml(code.codeValue)}" style="display:flex;align-items:center;padding:3px 6px 3px 28px;border-bottom:1px solid var(--glass-border-light, rgba(255,255,255,0.04));">
                        <span style="width:28px;color:var(--text-muted);font-size:0.72rem;flex-shrink:0;">${escapeHtml(code.codeValue)}</span>
                        <span style="flex:1;font-size:0.74rem;color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(code.codeLabel)}</span>
                        <span style="font-size:0.74rem;color:var(--text-primary);min-width:44px;text-align:right;margin-right:8px;">${code.count.toLocaleString()}</span>
                        <span style="font-size:0.74rem;color:var(--text-primary);min-width:50px;text-align:right;">${code.pct.toFixed(1)}%</span>
                        <div style="width:70px;margin-left:8px;flex-shrink:0;">
                            <div style="background:var(--glass-border, rgba(255,255,255,0.06));border-radius:2px;height:10px;overflow:hidden;">
                                <div style="width:${barWidth}%;height:100%;background:${netColors[net]};border-radius:2px;"></div>
                            </div>
                        </div>
                    </div>`;
                });

                html += `</div></div>`; // close theme children + theme container
            });

            html += `</div></div>`; // close net children + net container
        });

        // Add CSS for arrow rotation
        html += `<style>.cs-arrow{transition:transform 0.2s;}.cs-collapsed{transform:rotate(-90deg) !important;}</style>`;
        body.innerHTML = html;

    } catch (e) {
        body.innerHTML = `<div class="empty-state"><p class="empty-title">Failed to load summary</p><p>${escapeHtml(e.message)}</p></div>`;
    }
}
