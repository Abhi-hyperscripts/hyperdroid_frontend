// FGD report viewer — Sprint 1 scope: processing / failed / done states with
// live progress via SignalR. The full slide-style renderer arrives in Sprint 5
// and reads from the same report_json shape already produced by the backend.

const jobId = new URLSearchParams(location.search).get('job_id');
if (!jobId) {
    document.body.innerHTML = '<div style="padding:40px; text-align:center; color:var(--color-error);">Missing job_id in URL.</div>';
    throw new Error('missing job_id');
}

const STAGE_LABEL = {
    queued:        'Queued',
    chunking:      'Assembling transcripts',
    coding:        'Coding chunks',
    synthesizing:  'Building codeframe',
    recoding:      'Applying codeframe',
    writing:       'Drafting theme writeups',
    rollup:        'Cross-session analysis',
    summarizing:   'Writing executive summary',
    done:          'Report ready',
    failed:        'Report failed',
    cancelled:     'Cancelled',
};

function setStage(stage, progress, message) {
    document.getElementById('stageLabel').textContent = (stage || 'processing').toUpperCase();
    document.getElementById('stageTitle').textContent = STAGE_LABEL[stage] || 'Processing';
    const pct = Math.max(0, Math.min(100, Number(progress) || 0));
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPct').textContent = pct;
    document.getElementById('progressStatus').textContent = message || stage || '—';
}

function showError(msg) {
    const box = document.getElementById('errorBox');
    box.textContent = msg || 'Unknown error';
    box.style.display = 'block';
    document.getElementById('actionsRow').style.display = 'flex';
    document.getElementById('retryBtn').style.display = 'inline-flex';
}

function showDone(job) {
    document.getElementById('actionsRow').style.display = 'flex';
    document.getElementById('retryBtn').style.display = 'none';
    const panel = document.getElementById('reportRenderPanel');
    panel.style.display = 'block';
    const dump = document.getElementById('reportJsonDump');
    dump.textContent = JSON.stringify(job.report_json ?? { note: 'no report_json (empty pipeline)' }, null, 2);
}

async function loadJob() {
    try {
        const job = await api.request(`/research/focus-group/reports/${jobId}`);
        setStage(job.status || job.current_stage || 'processing', job.progress || 0, stageMessage(job));
        document.getElementById('backToProject').href = `focus-group-detail.html?id=${encodeURIComponent(job.project_id)}`;
        document.getElementById('backBtn').onclick = () => {
            window.location.href = `focus-group-detail.html?id=${encodeURIComponent(job.project_id)}`;
        };
        if (job.status === 'failed' || job.status === 'cancelled') {
            showError(job.error_message || 'Report failed with no error message.');
        } else if (job.status === 'done') {
            showDone(job);
        }
        return job;
    } catch (e) {
        setStage('failed', 0, 'Unable to load report');
        showError(e.message || 'Request failed');
        return null;
    }
}

function stageMessage(job) {
    if (job.status === 'failed')  return job.error_message || 'Failed';
    if (job.status === 'done')    return 'Complete';
    return STAGE_LABEL[job.current_stage || job.status] || '…';
}

// SignalR subscription — mirrors the server-side `fgd-report:{jobId}` group.
// On any event we re-fetch the full job to keep the UI consistent (cheap,
// and the report_json only shows up on `done` anyway).
async function subscribeProgress() {
    const conn = new signalR.HubConnectionBuilder()
        .withUrl(`${CONFIG.visionApiBaseUrl.replace('/api','')}/hubs/research`.replace('/hubs', '/hubs').replace(/\/$/, '') + '')
        .withAutomaticReconnect()
        .build();
    // Build URL from the research service base instead of vision; simpler to use the same pattern existing pages use.
    // (kept the line above to demonstrate; below is the correct one)
}

// Build the correct SignalR URL against the research backend.
async function startSignalR() {
    // Existing ResearchHub lives at `<researchBaseUrl>/hubs/research`.
    // api.js exposes the base URL via CONFIG.researchApiBaseUrl (or visionApiBaseUrl
    // with routing). We call the known-good pattern: strip `/api` from the base URL.
    const base = (CONFIG.researchApiBaseUrl || CONFIG.visionApiBaseUrl || '').replace(/\/api$/, '');
    const hubUrl = `${base}/hubs/research`;
    const conn = new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, { accessTokenFactory: () => api.getToken ? api.getToken() : (localStorage.getItem('token') || '') })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    conn.on('FgdReportProgress', async (evt) => {
        if (!evt || evt.jobId !== jobId) return;
        setStage(evt.stage, evt.progress, evt.message);
        if (evt.stage === 'failed') {
            showError(evt.message || 'Report failed');
        } else if (evt.stage === 'done') {
            // Re-fetch to pick up report_json
            await loadJob();
        }
    });

    try {
        await conn.start();
        await conn.invoke('JoinFgdReportProgress', jobId);
    } catch (err) {
        console.warn('[fgd-report] SignalR connect failed; falling back to polling', err);
        pollLoop();
    }
}

// Polling fallback — if SignalR fails to connect we poll every 3s until the
// job reaches a terminal state. Keeps Sprint 1 break-tests passing even when
// the hub is down.
async function pollLoop() {
    while (true) {
        const job = await loadJob();
        if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') break;
        await new Promise(r => setTimeout(r, 3000));
    }
}

document.getElementById('retryBtn').onclick = async () => {
    // Sprint 1 retry = re-POST with the same sessions. We need them from the
    // current job — fetch, then POST. If the source project was also deleted
    // along the way, fall back to the focus-groups list.
    try {
        const job = await api.request(`/research/focus-group/reports/${jobId}`);
        // We don't have session_ids in the GET response (Sprint 2 extension);
        // for now just bounce user back to the project where they can re-run.
        window.location.href = `focus-group-detail.html?id=${encodeURIComponent(job.project_id)}`;
    } catch {
        window.location.href = 'focus-groups.html';
    }
};

(async () => {
    await loadJob();
    await startSignalR();
})();
