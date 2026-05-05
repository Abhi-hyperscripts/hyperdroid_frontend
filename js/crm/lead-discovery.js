/**
 * CRM Lead Discovery — AI-powered prospect finding
 * Uses SignalR for real-time progress updates from AIEngine pipeline.
 */

// ==================== State ====================
let currentDiscoveryJobId = null;
let discoverySignalRConnection = null;
let discoveryLeadsCount = 0;
let discoveryStages = [];
let discoveryPollingInterval = null;
let discoverySignalRConnected = false;

// ==================== Panel Management ====================

function openDiscoveryPanel() {
    document.getElementById('discoveryPanel').classList.add('active');
    document.getElementById('discoveryOverlay').classList.add('active');
    loadDiscoveryJobs();
    ensureDiscoverySignalR();
}

function closeDiscoveryPanel() {
    document.getElementById('discoveryPanel').classList.remove('active');
    document.getElementById('discoveryOverlay').classList.remove('active');
}

// ==================== Discovery Flow ====================

async function startLeadDiscovery() {
    const instruction = document.getElementById('discoveryInstruction').value.trim();
    if (!instruction) {
        Toast.error('Please describe what leads you are looking for');
        return;
    }

    const maxLeads = parseInt(document.getElementById('maxLeadsSlider').value) || 25;

    // Show progress, hide input
    document.getElementById('discoveryInputSection').style.display = 'none';
    document.getElementById('discoveryProgressSection').style.display = 'block';
    document.getElementById('discoveryResultsSection').style.display = 'block';
    document.getElementById('discoveryResultsSummary').innerHTML = '';
    document.getElementById('discoveryLeadsList').innerHTML = '';
    document.getElementById('discoveryProgressBar').style.width = '5%';
    discoveryLeadsCount = 0;
    discoveryStages = [];

    // Initialize stage log
    addStageEntry('init', 'Initializing lead discovery...', 'active');

    try {
        const response = await api.request('/crm/lead-discovery/start', {
            method: 'POST',
            body: JSON.stringify({ instruction, max_leads: maxLeads }),
            _skipSpinner: true
        });

        const job = response.data || response;
        currentDiscoveryJobId = job.id;
        updateStageEntry('init', 'Job created — waiting for AI Engine', 'done');
        addStageEntry('planning', 'Phase 0: Planning search queries...', 'active');
        Toast.success('Lead discovery started');

        // Start polling as fallback (works alongside SignalR)
        startPolling();
    } catch (error) {
        console.error('Failed to start lead discovery:', error);
        updateStageEntry('init', 'Failed to start discovery', 'error');
        Toast.error('Failed to start lead discovery');
        resetDiscoveryUI();
    }
}

async function cancelLeadDiscovery() {
    if (!currentDiscoveryJobId) return;

    try {
        await api.request(`/crm/lead-discovery/jobs/${currentDiscoveryJobId}/cancel`, {
            method: 'POST',
            _skipSpinner: true
        });
        addStageEntry('cancel', 'Discovery cancelled by user', 'error');
        Toast.info('Discovery cancelled');
        setTimeout(() => resetDiscoveryUI(), 2000);
    } catch (error) {
        console.error('Failed to cancel discovery:', error);
        Toast.error('Failed to cancel');
    }
}

function resetDiscoveryUI() {
    document.getElementById('discoveryInputSection').style.display = 'block';
    document.getElementById('discoveryProgressSection').style.display = 'none';
    currentDiscoveryJobId = null;
    stopPolling();
    loadDiscoveryJobs();
}

// ==================== Polling Fallback ====================

function startPolling() {
    stopPolling();
    discoveryPollingInterval = setInterval(pollJobStatus, 3000);
    console.log('[Discovery] Polling started (fallback for SignalR)');
}

function stopPolling() {
    if (discoveryPollingInterval) {
        clearInterval(discoveryPollingInterval);
        discoveryPollingInterval = null;
    }
}

async function pollJobStatus() {
    if (!currentDiscoveryJobId) { stopPolling(); return; }

    try {
        const response = await api.request(`/crm/lead-discovery/jobs/${currentDiscoveryJobId}`, { _skipSpinner: true });
        const job = response.data || response;
        if (!job) return;

        // Update progress text from polling
        if (job.progress_message || job.progressMessage) {
            const msg = job.progress_message || job.progressMessage;
            document.getElementById('discoveryProgressText').textContent = msg;

            // Update stage log if no SignalR updates
            if (!discoverySignalRConnected) {
                const activeStage = discoveryStages.find(s => s.status === 'active');
                if (activeStage) {
                    activeStage.message = msg;
                } else {
                    addStageEntry('poll-' + Date.now(), msg, 'active');
                }
                renderStageLog();
            }
        }

        // Animate progress based on status and message content
        const bar = document.getElementById('discoveryProgressBar');
        const msg = job.progress_message || job.progressMessage || '';
        if (msg.includes('Enriching') || msg.includes('Finding contacts')) {
            bar.style.width = '80%';
        } else if (job.status === 'searching') {
            bar.style.width = '30%';
        } else if (job.status === 'extracting') {
            bar.style.width = '60%';
        }

        // Update lead count from polling
        const polledCreated = job.leads_created || job.leadsCreated || 0;
        if (polledCreated > 0 && polledCreated > discoveryLeadsCount) {
            document.getElementById('discoveryResultsSummary').innerHTML =
                `<span class="discovery-count">${polledCreated}</span> leads discovered so far...`;
        }

        // Terminal states
        if (job.status === 'completed') {
            discoveryStages.forEach(s => { if (s.status === 'active') s.status = 'done'; });
            addStageEntry('complete', `Complete: ${polledCreated} leads created`, 'done');
            renderStageLog();

            bar.style.width = '100%';
            document.getElementById('discoveryResultsSummary').innerHTML =
                `<div class="discovery-complete-summary">
                    <span class="discovery-complete-icon">&#10003;</span>
                    Discovery complete: <strong>${polledCreated}</strong> new leads created
                </div>`;
            Toast.success(`Found ${polledCreated} new leads`);
            setTimeout(() => resetDiscoveryUI(), 3000);
            if (typeof loadLeads === 'function') loadLeads();
            if (typeof loadLeadStats === 'function') loadLeadStats();
        } else if (job.status === 'failed' || job.status === 'cancelled') {
            discoveryStages.forEach(s => { if (s.status === 'active') s.status = 'error'; });
            addStageEntry('failed', `${job.status}: ${job.error_message || job.errorMessage || 'Unknown'}`, 'error');
            renderStageLog();

            document.getElementById('discoveryResultsSummary').innerHTML =
                `<div class="discovery-error-summary">${escapeHtml(job.error_message || job.errorMessage || job.status)}</div>`;
            Toast.error('Lead discovery ' + job.status);
            setTimeout(() => resetDiscoveryUI(), 3000);
        }
    } catch (err) {
        console.error('[Discovery] Poll failed:', err);
    }
}

// ==================== Stage Log ====================

function addStageEntry(id, message, status) {
    discoveryStages.push({ id, message, status, time: new Date() });
    renderStageLog();
}

function updateStageEntry(id, message, status) {
    const stage = discoveryStages.find(s => s.id === id);
    if (stage) {
        stage.message = message;
        stage.status = status;
    }
    renderStageLog();
}

function renderStageLog() {
    const container = document.getElementById('discoveryStageLog');
    if (!container) return;

    container.innerHTML = discoveryStages.map(stage => {
        const icon = stage.status === 'done' ? '&#10003;'
            : stage.status === 'active' ? '<span class="stage-spinner"></span>'
            : stage.status === 'error' ? '&#10007;'
            : '&#8226;';
        const cls = `stage-${stage.status}`;
        const time = stage.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return `<div class="discovery-stage-entry ${cls}">
            <span class="stage-icon">${icon}</span>
            <span class="stage-msg">${escapeHtml(stage.message)}</span>
            <span class="stage-time">${time}</span>
        </div>`;
    }).join('');

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// ==================== SignalR Connection ====================

async function ensureDiscoverySignalR() {
    if (discoverySignalRConnection && discoverySignalRConnection.state === signalR.HubConnectionState.Connected) {
        return;
    }

    const token = localStorage.getItem('token');
    if (!token) return;

    const hubUrl = (typeof CONFIG !== 'undefined' && CONFIG.crmApiBaseUrl)
        ? CONFIG.crmApiBaseUrl.replace(/\/api$/, '').replace(/\/api\//, '/') + '/hubs/crm'
        : 'http://localhost:5112/hubs/crm';

    discoverySignalRConnection = new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, { accessTokenFactory: () => token })
        .withAutomaticReconnect()
        .build();

    // Progress updates
    discoverySignalRConnection.on('LeadDiscoveryProgress', (data) => {
        if (data.jobId !== currentDiscoveryJobId) return;
        const msg = data.message || 'Working...';

        // Determine stage from message content
        if (msg.includes('Planning') || msg.includes('plan')) {
            updateStageEntry('planning', msg, 'active');
        } else if (msg.includes('Search plan ready') || msg.includes('queries')) {
            updateStageEntry('planning', msg, 'done');
            if (!discoveryStages.find(s => s.id === 'searching')) {
                addStageEntry('searching', 'Phase 1: Searching the web...', 'active');
            }
        } else if (msg.includes('Searching:')) {
            updateStageEntry('searching', msg, 'active');
        } else if (msg.includes('Analyzing')) {
            updateStageEntry('searching', 'Web searches complete', 'done');
            // Add or update extraction stage
            const extractId = 'extract-' + discoveryStages.filter(s => s.id.startsWith('extract')).length;
            addStageEntry(extractId, msg, 'active');
        } else if (msg.includes('Enriching') || msg.includes('Finding contacts')) {
            // Phase 2: Contact enrichment
            if (!discoveryStages.find(s => s.id === 'enrichment')) {
                // Mark any active extraction/search stages as done
                discoveryStages.forEach(s => {
                    if ((s.id.startsWith('extract') || s.id === 'searching') && s.status === 'active') s.status = 'done';
                });
                addStageEntry('enrichment', 'Phase 2: Enriching leads with contact info...', 'active');
            }
            updateStageEntry('enrichment', msg, 'active');
        } else {
            // Generic progress
            const activeStage = discoveryStages.find(s => s.status === 'active');
            if (activeStage) {
                activeStage.message = msg;
            } else {
                addStageEntry('progress-' + Date.now(), msg, 'active');
            }
        }
        renderStageLog();

        // Animate progress bar
        const bar = document.getElementById('discoveryProgressBar');
        const currentWidth = parseFloat(bar.style.width) || 5;
        bar.style.width = Math.min(currentWidth + 6, 90) + '%';
    });

    // Lead found or enriched
    discoverySignalRConnection.on('LeadDiscoveryLeadFound', (data) => {
        if (data.jobId !== currentDiscoveryJobId) return;

        const company = data.lead?.companyName || data.lead?.CompanyName || 'Unknown';
        const signal = data.lead?.signal || '';
        const score = data.lead?.qualityScore || 0;

        if (data.enriched) {
            // Phase 2: Lead was enriched with contact info — update stage log
            const email = data.lead?.email || data.lead?.Email || '';
            const name = ((data.lead?.firstName || data.lead?.FirstName || '') + ' ' + (data.lead?.lastName || data.lead?.LastName || '')).trim();
            addStageEntry(`enriched-${company}`,
                `Enriched ${company}: ${name}${email ? ' (' + email + ')' : ''}`, 'done');

            // Update the existing lead card if present
            updateDiscoveredLeadCard(data.lead);
        } else {
            // Phase 1: New lead discovered
            discoveryLeadsCount++;

            // Mark any active extraction as done, add lead entry
            discoveryStages.forEach(s => {
                if (s.id.startsWith('extract') && s.status === 'active') s.status = 'done';
            });

            addStageEntry(`lead-${discoveryLeadsCount}`,
                `Lead #${discoveryLeadsCount}: ${company} (${signal}, score: ${score})`, 'done');

            appendDiscoveredLead(data.lead);
        }

        // Update summary
        document.getElementById('discoveryResultsSummary').innerHTML =
            `<span class="discovery-count">${discoveryLeadsCount}</span> leads discovered so far...`;
    });

    // Completed
    discoverySignalRConnection.on('LeadDiscoveryCompleted', (data) => {
        if (data.jobId !== currentDiscoveryJobId) return;

        // Mark all active stages done
        discoveryStages.forEach(s => { if (s.status === 'active') s.status = 'done'; });
        addStageEntry('complete', `Complete: ${data.totalCreated} leads created, ${data.totalDuplicate || 0} duplicates`, 'done');
        renderStageLog();

        document.getElementById('discoveryProgressBar').style.width = '100%';
        document.getElementById('discoveryResultsSummary').innerHTML =
            `<div class="discovery-complete-summary">
                <span class="discovery-complete-icon">&#10003;</span>
                Discovery complete: <strong>${data.totalCreated}</strong> new leads created
                ${data.totalDuplicate > 0 ? `, <span class="text-muted">${data.totalDuplicate} duplicates skipped</span>` : ''}
            </div>`;

        Toast.success(`Found ${data.totalCreated} new leads`);

        // Keep progress visible for 3s then reset
        setTimeout(() => {
            document.getElementById('discoveryProgressSection').style.display = 'none';
            document.getElementById('discoveryInputSection').style.display = 'block';
            currentDiscoveryJobId = null;
            loadDiscoveryJobs();
        }, 3000);

        // Refresh the main leads table
        if (typeof loadLeads === 'function') loadLeads();
        if (typeof loadLeadStats === 'function') loadLeadStats();
    });

    // Failed
    discoverySignalRConnection.on('LeadDiscoveryFailed', (data) => {
        if (data.jobId !== currentDiscoveryJobId) return;

        discoveryStages.forEach(s => { if (s.status === 'active') s.status = 'error'; });
        addStageEntry('failed', `Failed: ${data.error || 'Unknown error'}`, 'error');
        renderStageLog();

        document.getElementById('discoveryResultsSummary').innerHTML =
            `<div class="discovery-error-summary">Discovery failed: ${escapeHtml(data.error || 'Unknown error')}</div>`;

        Toast.error('Lead discovery failed');
        setTimeout(() => resetDiscoveryUI(), 3000);
    });

    try {
        await discoverySignalRConnection.start();
        discoverySignalRConnected = true;
        console.log('[Discovery] SignalR connected to', hubUrl);
    } catch (err) {
        discoverySignalRConnected = false;
        console.error('[Discovery] SignalR connection failed (polling will handle updates):', err);
    }
}

// ==================== UI Rendering ====================

function buildLeadCardHTML(lead) {
    const companyName = lead.companyName || lead.CompanyName || '';
    const firstName = lead.firstName || lead.FirstName || '';
    const lastName = lead.lastName || lead.LastName || '';
    const jobTitle = lead.jobTitle || lead.JobTitle || '';
    const email = lead.email || lead.Email || '';
    const phone = lead.phone || lead.Phone || '';
    const score = lead.qualityScore || 0;
    const signal = lead.signal || '';
    const signalStrength = lead.signalStrength || 'medium';

    const signalBadge = signal
        ? `<span class="discovery-signal-badge signal-${signalStrength}">${escapeHtml(signal)}</span>`
        : '';

    const scoreBadge = score
        ? `<span class="discovery-score-badge score-${score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low'}">${score}</span>`
        : '';

    const contactName = (firstName + ' ' + lastName).trim();

    return `
        <div class="discovery-lead-header">
            <div class="discovery-lead-name">
                <strong>${escapeHtml(companyName)}</strong>
                ${scoreBadge}
                ${signalBadge}
            </div>
        </div>
        ${contactName ? `<div class="discovery-lead-contact">${escapeHtml(contactName)}${jobTitle ? ' — ' + escapeHtml(jobTitle) : ''}</div>` : ''}
        ${email ? `<div class="discovery-lead-email">${escapeHtml(email)}</div>` : '<div class="discovery-lead-email discovery-pending">Enriching contact info...</div>'}
        ${phone ? `<div class="discovery-lead-phone">${crmPhoneLink(phone)}</div>` : ''}
        ${lead.reasonToContact ? `<div class="discovery-lead-reason">${escapeHtml(lead.reasonToContact)}</div>` : ''}
        ${lead.pitchAngle ? `<div class="discovery-lead-pitch"><em>${escapeHtml(lead.pitchAngle)}</em></div>` : ''}
    `;
}

function appendDiscoveredLead(lead) {
    const list = document.getElementById('discoveryLeadsList');
    const companyName = lead.companyName || lead.CompanyName || '';

    const item = document.createElement('div');
    item.className = 'discovery-lead-item';
    item.setAttribute('data-company', companyName.toLowerCase());
    item.innerHTML = buildLeadCardHTML(lead);

    list.prepend(item);
}

function updateDiscoveredLeadCard(lead) {
    const list = document.getElementById('discoveryLeadsList');
    const companyName = (lead.companyName || lead.CompanyName || '').toLowerCase();
    const existing = list.querySelector(`[data-company="${CSS.escape(companyName)}"]`);

    if (existing) {
        existing.innerHTML = buildLeadCardHTML(lead);
        existing.classList.add('discovery-lead-enriched');
        // Brief flash animation
        existing.style.borderColor = 'var(--color-success)';
        setTimeout(() => { existing.style.borderColor = ''; }, 2000);
    }

    // Also refresh the main leads table
    if (typeof loadLeads === 'function') loadLeads();
}

// ==================== Recent Jobs ====================

async function loadDiscoveryJobs() {
    try {
        const response = await api.request('/crm/lead-discovery/jobs', { _skipSpinner: true });
        const jobs = response.data || response || [];
        renderDiscoveryJobs(jobs);
    } catch (error) {
        console.error('Failed to load discovery jobs:', error);
    }
}

function renderDiscoveryJobs(jobs) {
    const container = document.getElementById('discoveryJobsList');

    if (!jobs || jobs.length === 0) {
        container.innerHTML = '<p class="discovery-empty">No previous discoveries yet.</p>';
        return;
    }

    container.innerHTML = jobs.slice(0, 10).map(job => {
        const statusClass = `job-status-${job.status}`;
        const instruction = (job.instruction || '').length > 60
            ? job.instruction.substring(0, 60) + '...'
            : job.instruction;

        return `
            <div class="discovery-job-item">
                <div class="discovery-job-row">
                    <span class="discovery-job-instruction">${escapeHtml(instruction)}</span>
                    <span class="discovery-job-status ${statusClass}">${job.status}</span>
                </div>
                <div class="discovery-job-meta">
                    ${job.leads_created || job.leadsCreated ? `<span>${job.leads_created || job.leadsCreated} leads</span>` : ''}
                    <span>${formatDate(job.created_at || job.createdAt)}</span>
                </div>
            </div>
        `;
    }).join('');
}
