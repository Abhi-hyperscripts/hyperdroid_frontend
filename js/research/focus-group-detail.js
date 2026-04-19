// Focus Group Detail — Upload audio, view speaker-diarized transcriptions
if (!api.isAuthenticated()) window.location.href = '../login.html';

const SPEAKER_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316','#14b8a6','#e11d48'];
const projectId = new URLSearchParams(window.location.search).get('id');
let recordings = [];
let selectedFile = null;
let currentJsonData = null;
let pollTimers = {};
let recordingResults = {};

// Latest `done` report for this project, if any. Populated on load;
// drives the "View Dashboard" button visibility + click target.
let latestReportJobId = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!projectId) { window.location.href = 'focus-groups.html'; return; }
    await loadProject();
    await loadRecordings();
    await refreshLatestReport();
    setupDragDrop();
    // Reattach the progress panel to any in-flight analytics run so
    // the user picks up live progress after navigating back to this page.
    FgdProgressPanel.resumeIfRunning();
});

async function refreshLatestReport() {
    const btn = document.getElementById('viewDashboardBtn');
    if (!btn) return;
    try {
        const resp = await api.request(`/research/focus-group/projects/${projectId}/reports?limit=5`);
        const reports = (resp?.reports) || [];
        const done = reports.find(r => r.status === 'done');
        if (done) {
            latestReportJobId = done.job_id;
            btn.style.display = 'inline-flex';  // must match the .research-btn flex layout
        } else {
            latestReportJobId = null;
            btn.style.display = 'none';
        }
    } catch (e) {
        // Non-fatal — button just stays hidden if the endpoint errors.
        console.warn('[focus-group-detail] report list failed:', e.message);
    }
}

function openLatestDashboard() {
    if (!latestReportJobId) return;
    window.location.href = `fgd-report.html?job_id=${encodeURIComponent(latestReportJobId)}`;
}

async function loadProject() {
    try {
        const project = await api.request(`/research/projects/${projectId}`);
        const titleEl = document.getElementById('projectTitle');
        titleEl.textContent = project.name || 'Untitled';
        titleEl.style.cursor = 'pointer';
        titleEl.title = 'Click to rename';
        titleEl.onclick = renameProject;
        document.getElementById('projectDescription').textContent = project.description || '';
        document.title = `${project.name} - Focus Group`;
    } catch (error) {
        Toast.error('Failed to load project');
        window.location.href = 'focus-groups.html';
    }
}

async function renameProject() {
    const titleEl = document.getElementById('projectTitle');
    const current = titleEl.textContent;
    const next = await Prompt.show({
        title: 'Rename Project',
        message: 'Enter a new name for this project.',
        defaultValue: current,
        confirmText: 'Rename'
    });
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    if (!trimmed || trimmed === current) return;
    try {
        await api.request(`/research/projects/${projectId}`, {
            method: 'PUT',
            body: JSON.stringify({ name: trimmed })
        });
        titleEl.textContent = trimmed;
        document.title = `${trimmed} - Focus Group`;
        Toast.success('Project renamed');
    } catch (error) {
        Toast.error('Failed to rename project');
    }
}

// ============================================
// RECORDINGS LIST
// ============================================

async function loadRecordings() {
    try {
        recordings = await api.request(`/research/focus-group/recordings?projectId=${projectId}`);
        renderRecordings();
        // Start polling for any in-progress recordings
        recordings.filter(r => r.status !== 'done' && r.status !== 'failed').forEach(r => startPolling(r.id));
    } catch (error) {
        document.getElementById('recordingsList').innerHTML = `<div class="fg-empty"><p>Failed to load recordings</p></div>`;
    }
}

function renderRecordings() {
    const container = document.getElementById('recordingsList');
    const analyticsBtn = document.getElementById('runAnalyticsBtn');
    if (!recordings || recordings.length === 0) {
        if (analyticsBtn) analyticsBtn.style.display = 'none';
        container.innerHTML = `
            <div class="fg-empty">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <h3 style="color:var(--text-primary); margin-bottom:8px;">No recordings yet</h3>
                <p>Upload an audio file to start speaker diarization and transcription.</p>
            </div>`;
        return;
    }
    if (analyticsBtn) analyticsBtn.style.display = 'inline-flex';

    container.innerHTML = recordings.map(r => {
        const statusBadge = getStatusBadge(r);
        const meta = r.status === 'done'
            ? `${r.speakerCount} speakers | ${r.utteranceCount} utterances | ${formatDuration(r.audioDurationSeconds)}`
            : r.progressMessage || r.status;

        return `
        <div class="fg-recording" id="rec-${r.id}" data-id="${r.id}">
            <div class="fg-recording-header" onclick="toggleRecording('${r.id}')">
                <div class="fg-recording-title">
                    <span class="expand-arrow">&#9654;</span>
                    ${esc(r.title)}
                    ${statusBadge}
                </div>
                <div class="fg-recording-meta">
                    ${isProcessing(r)
                        ? `<span style="font-size:12px; color:var(--brand-primary);">${esc(r.progressMessage || r.status)}</span>
                           <div class="fg-progress-inline"><div class="fg-progress-bar"><div class="fg-progress-fill" style="width:${r.progress}%"></div></div><span style="font-size:11px;">${r.progress}%</span></div>`
                        : r.status === 'done'
                            ? `<span>${r.speakerCount || r.speaker_count || 0} speakers | ${r.utteranceCount || r.utterance_count || 0} utt | ${formatDuration(r.audioDurationSeconds || r.audio_duration_seconds)}</span>`
                            : ''}
                    <span>${esc(r.fileName)}</span>
                    <span>${(r.createdAt || r.created_at) ? new Date(r.createdAt || r.created_at).toLocaleDateString() : ''}</span>
                    <button class="fg-btn" onclick="event.stopPropagation(); renameRecording('${r.id}')">Rename</button>
                    <button class="fg-btn" onclick="event.stopPropagation(); moveRecording('${r.id}')" title="Move this session to another focus-group project">Move</button>
                    <button class="fg-btn fg-btn-danger" onclick="event.stopPropagation(); deleteRecording('${r.id}')">Delete</button>
                </div>
            </div>
            <div class="fg-recording-body" id="body-${r.id}"></div>
        </div>`;
    }).join('');
}

function getStatusBadge(r) {
    const map = {
        done: '<span class="fg-status-badge fg-status-done">Complete</span>',
        failed: '<span class="fg-status-badge fg-status-failed">Failed</span>',
        pending: '<span class="fg-status-badge fg-status-pending">Pending</span>',
    };
    if (map[r.status]) return map[r.status];
    return '<span class="fg-status-badge fg-status-processing">Processing</span>';
}

async function toggleRecording(id) {
    const el = document.getElementById('rec-' + id);
    if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
        return;
    }
    el.classList.add('expanded');

    const body = document.getElementById('body-' + id);
    const rec = recordings.find(r => r.id === id);

    if (rec.status !== 'done') {
        body.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-secondary);">${rec.status === 'failed' ? 'Transcription failed: ' + esc(rec.errorMessage || rec.error_message || 'Unknown error') : (rec.progressMessage || rec.progress_message || 'Transcription in progress...')}</div>`;
        return;
    }

    // Load full result
    body.innerHTML = '<div style="padding:20px; text-align:center;"><div class="spinner" style="width:24px; height:24px; border:2px solid var(--border-primary); border-top-color:var(--brand-primary); border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto;"></div></div>';

    try {
        const full = await api.request(`/research/focus-group/recordings/${id}`);
        if (full.result) full.result = norm(full.result);
        recordingResults[id] = full.result;
        renderRecordingBody(body, full, id);
    } catch (e) {
        body.innerHTML = `<div style="padding:20px; color:var(--color-error);">Failed to load: ${e.message}</div>`;
    }
}

function renderRecordingBody(container, data, recordingId) {
    const result = data.result;
    if (!result) { container.innerHTML = '<div style="padding:20px;">No result data</div>'; return; }

    // Handle both object and array speakers (Gladia returns dict keyed by index)
    let speakers = [];
    if (result.speakers) {
        speakers = Array.isArray(result.speakers) ? result.speakers : Object.values(result.speakers);
    }
    const utterances = result.utterances || [];
    const hasTranslation = utterances.some(u => u.translatedText);

    container.innerHTML = `
        <div class="fg-toolbar">
            <div class="fg-toolbar-left">
                ${hasTranslation ? `<select class="fg-select" onchange="switchTextMode('${recordingId}', this.value)">
                    <option value="transcription">Transcription (Original)</option>
                    <option value="translation">Translation</option>
                </select>` : '<span style="font-size:12px; color:var(--text-secondary);">Transcription</span>'}
                <span class="fg-billing">${utterances.length} utterances | ${formatDuration(result.audioDurationSeconds)}${result.billingTimeSeconds ? ' | Billed: ' + formatDuration(result.billingTimeSeconds) : ''}${result.transcriptionTimeSeconds ? ' | Processed in ' + result.transcriptionTimeSeconds.toFixed(1) + 's' : ''}</span>
            </div>
            <button class="fg-btn" onclick="openJsonForRecording('${recordingId}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                View JSON
            </button>
        </div>
        <div class="fg-speakers-bar">
            ${speakers.map((s, i) => `
                <div class="fg-speaker-badge">
                    <div class="fg-speaker-dot" style="background:${SPEAKER_COLORS[i % SPEAKER_COLORS.length]};"></div>
                    ${esc(s.label)} <span style="color:var(--text-secondary); margin-left:4px;">(${s.utteranceCount})</span>
                </div>
            `).join('')}
        </div>
        <table class="fg-table">
            <thead><tr><th style="width:70px;">Time</th><th style="width:120px;">Speaker</th><th>Text</th></tr></thead>
            <tbody id="tbody-${recordingId}">
                ${utterances.map((u, i) => {
                    const color = SPEAKER_COLORS[(u.speaker || 0) % SPEAKER_COLORS.length];
                    const spk = speakers.find(s => s.speakerIndex === u.speaker);
                    const name = spk ? spk.label : 'Speaker ' + u.speaker;
                    const prevSpeaker = i > 0 ? utterances[i - 1].speaker : u.speaker;
                    const speakerChanged = i > 0 && u.speaker !== prevSpeaker;
                    return `<tr class="${speakerChanged ? 'fg-speaker-break' : ''}">
                        <td class="fg-time">${formatTime(u.start)}</td>
                        <td style="color:${color}; font-weight:500; white-space:nowrap;">
                            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;"></span>${esc(name)}
                        </td>
                        <td>
                            <span class="utt-text">${esc(u.text)}</span>
                            <span class="utt-translated" style="display:none;">${esc(u.translatedText || u.text)}</span>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
}

function switchTextMode(recordingId, mode) {
    const tbody = document.getElementById('tbody-' + recordingId);
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(row => {
        const text = row.querySelector('.utt-text');
        const translated = row.querySelector('.utt-translated');
        if (text && translated) {
            text.style.display = mode === 'translation' ? 'none' : '';
            translated.style.display = mode === 'translation' ? '' : 'none';
        }
    });
}

// ============================================
// UPLOAD
// ============================================

function setupDragDrop() {
    const zone = document.getElementById('dropZone');
    if (!zone) return;
    zone.addEventListener('click', () => document.getElementById('audioFileInput').click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--brand-primary)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = 'var(--border-primary)'; });
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.style.borderColor = 'var(--border-primary)';
        if (e.dataTransfer.files.length) { selectedFile = e.dataTransfer.files[0]; updateDropZone(); }
    });
}

function onFileSelected(e) {
    if (e.target.files.length) { selectedFile = e.target.files[0]; updateDropZone(); }
}

function updateDropZone() {
    if (!selectedFile) return;
    const mb = (selectedFile.size / (1024 * 1024)).toFixed(1);
    document.getElementById('dropZoneText').textContent = `${selectedFile.name} (${mb} MB)`;
    document.getElementById('dropZone').style.borderColor = 'var(--color-success)';
}

async function submitUpload() {
    const title = document.getElementById('recordingTitle').value.trim();
    if (!title) { Toast.warning('Title is required'); return; }
    if (!selectedFile) { Toast.warning('Select an audio file'); return; }

    const btn = document.getElementById('uploadBtn');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    const sourceLanguage = document.getElementById('sourceLanguage').value;
    const targetLanguage = document.getElementById('targetLanguage').value;

    try {
        const formData = new FormData();
        formData.append('audio', selectedFile);

        const params = new URLSearchParams({ projectId, title });
        if (sourceLanguage) params.set('sourceLanguage', sourceLanguage);
        if (targetLanguage) params.set('targetLanguage', targetLanguage);

        const response = await api.request(`/research/focus-group/recordings/upload?${params}`, {
            method: 'POST',
            body: formData,
            headers: {} // Let browser set multipart headers
        });

        closeModal('uploadModal');
        resetUploadForm();
        Toast.success('Audio uploaded — transcription started');

        // Add to list and start polling
        await loadRecordings();
        if (response.id) startPolling(response.id);

    } catch (error) {
        Toast.error('Upload failed: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Upload & Transcribe';
    }
}

function resetUploadForm() {
    selectedFile = null;
    document.getElementById('recordingTitle').value = '';
    document.getElementById('audioFileInput').value = '';
    document.getElementById('dropZoneText').textContent = 'Click or drag audio file (MP3, WAV, M4A, max 500MB)';
    document.getElementById('dropZone').style.borderColor = 'var(--border-primary)';
    document.getElementById('sourceLanguage').value = '';
    document.getElementById('targetLanguage').value = '';
}

// ============================================
// POLLING
// ============================================

function startPolling(recordingId) {
    if (pollTimers[recordingId]) return;
    pollTimers[recordingId] = setInterval(async () => {
        try {
            // _skipSpinner: this runs every 3s while a recording is uploading/transcribing.
            // The page already shows inline status text + progress bar on the row, so the
            // global ButtonSpinner overlay would just flicker on every tick.
            const recs = await api.request(`/research/focus-group/recordings?projectId=${projectId}`, { _skipSpinner: true });
            const rec = recs.find(r => r.id === recordingId);
            if (!rec) { stopPolling(recordingId); return; }

            // Update in-memory
            const idx = recordings.findIndex(r => r.id === recordingId);
            if (idx >= 0) recordings[idx] = rec;

            // Update UI
            renderRecordings();

            if (rec.status === 'done' || rec.status === 'failed') {
                stopPolling(recordingId);
                if (rec.status === 'done') Toast.success(`"${rec.title}" transcription complete`);
                if (rec.status === 'failed') Toast.error(`"${rec.title}" failed: ${rec.errorMessage}`);
            }
        } catch (e) { /* ignore polling errors */ }
    }, 3000);
}

function stopPolling(recordingId) {
    if (pollTimers[recordingId]) { clearInterval(pollTimers[recordingId]); delete pollTimers[recordingId]; }
}

// ============================================
// JSON PANEL
// ============================================

function openJsonForRecording(recordingId) {
    const result = recordingResults[recordingId];
    if (!result) { Toast.warning('Load the recording first by expanding it'); return; }
    openJsonPanel(result);
}

function openJsonPanel(data) {
    currentJsonData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    try { currentJsonData = JSON.stringify(JSON.parse(currentJsonData), null, 2); } catch {}
    document.getElementById('jsonContent').textContent = currentJsonData;
    document.getElementById('jsonSlidePanel').classList.add('active');
    document.getElementById('jsonPanelOverlay').classList.add('active');
}

function closeJsonPanel() {
    document.getElementById('jsonSlidePanel').classList.remove('active');
    document.getElementById('jsonPanelOverlay').classList.remove('active');
}

function copyJson() {
    if (!currentJsonData) return;
    navigator.clipboard.writeText(currentJsonData);
    Toast.success('Copied to clipboard');
}

function downloadJson() {
    if (!currentJsonData) return;
    const blob = new Blob([currentJsonData], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `focus-group-result.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function deleteRecording(id) {
    const ok = await Confirm.show({
        title: 'Delete Recording',
        message: 'Delete this recording? The audio file and transcription will be permanently removed.',
        type: 'danger',
        confirmText: 'Delete'
    });
    if (!ok) return;
    try {
        await api.request(`/research/focus-group/recordings/${id}`, { method: 'DELETE' });
        stopPolling(id);
        await loadRecordings();
        Toast.success('Recording deleted');
    } catch (e) { Toast.error('Delete failed: ' + e.message); }
}

/**
 * Opens a picker to select one or more sessions (recordings) to run analytics on.
 * Backend wiring pending — submit currently just collects the selected IDs.
 */
function openAnalyticsModal() {
    const done = (recordings || []).filter(r => r.status === 'done');
    if (done.length === 0) {
        Toast.error('No completed sessions to analyze. Wait for transcription to finish.');
        return;
    }

    const showSearch = done.length > 8;
    const overlay = document.createElement('div');
    overlay.className = 'gm-overlay active';
    overlay.style.zIndex = 2000000;
    overlay.innerHTML = `
      <div class="gm-modal" style="max-width:600px;">
        <div class="gm-header">
          <h3>Run Analytics</h3>
          <button class="gm-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="gm-body">
          <p style="margin:0 0 10px 0; color:var(--text-secondary); font-size:13px;">
            Select the sessions to include. Analytics will run across all selected sessions combined.
          </p>
          ${showSearch ? `
          <input type="text" id="analyticsSearch" placeholder="Search sessions…"
            style="width:100%; padding:7px 10px; margin-bottom:8px; border:1px solid var(--border-primary); border-radius:6px; background:var(--bg-tertiary); color:var(--text-primary); font-size:13px;" />
          ` : ''}
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-radius:6px 6px 0 0; background:var(--bg-tertiary); border:1px solid var(--border-primary); border-bottom:none;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12px; font-weight:500;">
              <input type="checkbox" id="analyticsSelectAll" />
              <span>Select all</span>
            </label>
            <span id="analyticsSelectedCount" style="font-size:11px; color:var(--text-secondary);">0 of ${done.length} selected</span>
          </div>
          <div id="analyticsSessionList" style="max-height:55vh; overflow-y:auto; border:1px solid var(--border-primary); border-radius:0 0 6px 6px;">
            ${done.map(r => {
                const spk = r.speakerCount || r.speaker_count || 0;
                const utt = r.utteranceCount || r.utterance_count || 0;
                const dur = r.audioDurationSeconds || r.audio_duration_seconds;
                const meta = `${spk} spk · ${utt} utt · ${formatDuration(dur)}`;
                return `
                <label class="analytics-session-row" data-title="${esc(r.title).toLowerCase()}"
                  style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; border-bottom:1px solid var(--border-primary); font-size:12px;">
                  <input type="checkbox" class="analytics-session-cb" data-id="${r.id}" style="margin:0;" />
                  <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary); font-weight:500;">${esc(r.title)}</span>
                  <span style="color:var(--text-secondary); font-size:11px; white-space:nowrap; font-variant-numeric:tabular-nums;">${meta}</span>
                </label>`;
            }).join('')}
          </div>
        </div>
        <div class="gm-footer">
          <button class="gm-btn gm-btn-secondary" data-action="cancel" type="button">Cancel</button>
          <button class="gm-btn gm-btn-primary" data-action="run" type="button" disabled>Run</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.gm-close').onclick = close;
    overlay.querySelector('[data-action="cancel"]').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const selectAll = overlay.querySelector('#analyticsSelectAll');
    const rowCbs = () => Array.from(overlay.querySelectorAll('.analytics-session-cb'));
    const visibleRowCbs = () =>
        Array.from(overlay.querySelectorAll('.analytics-session-row'))
            .filter(row => row.style.display !== 'none')
            .map(row => row.querySelector('.analytics-session-cb'));
    const countEl = overlay.querySelector('#analyticsSelectedCount');
    const runBtn = overlay.querySelector('[data-action="run"]');

    const refresh = () => {
        const cbs = rowCbs();
        const checked = cbs.filter(c => c.checked);
        countEl.textContent = `${checked.length} of ${cbs.length} selected`;
        runBtn.disabled = checked.length === 0;
        // Tri-state reflects the VISIBLE subset so it still works while searching.
        const vis = visibleRowCbs();
        const visChecked = vis.filter(c => c.checked);
        selectAll.checked = vis.length > 0 && visChecked.length === vis.length;
        selectAll.indeterminate = visChecked.length > 0 && visChecked.length < vis.length;
    };

    selectAll.addEventListener('change', () => {
        // Select/deselect only the currently visible rows (respects search filter).
        visibleRowCbs().forEach(cb => { cb.checked = selectAll.checked; });
        refresh();
    });
    rowCbs().forEach(cb => cb.addEventListener('change', refresh));

    const searchInput = overlay.querySelector('#analyticsSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            overlay.querySelectorAll('.analytics-session-row').forEach(row => {
                row.style.display = !q || row.dataset.title.includes(q) ? '' : 'none';
            });
            refresh();
        });
    }

    // Drop the trailing divider on the last visible row for a cleaner edge.
    const allRows = overlay.querySelectorAll('.analytics-session-row');
    if (allRows.length) allRows[allRows.length - 1].style.borderBottom = 'none';

    runBtn.onclick = async () => {
        const ids = rowCbs().filter(c => c.checked).map(c => c.dataset.id);
        if (ids.length === 0) return;
        runBtn.disabled = true;
        runBtn.textContent = 'Queuing…';
        try {
            const resp = await api.request(`/research/focus-group/projects/${projectId}/reports`, {
                method: 'POST',
                body: JSON.stringify({ session_ids: ids, options: {} }),
            });
            if (!resp || !resp.job_id) {
                throw new Error('Backend did not return a job_id');
            }
            close();
            Toast.success(`Analytics queued for ${ids.length} session${ids.length === 1 ? '' : 's'}`);
            // Show the floating progress panel + subscribe to SignalR
            // instead of redirecting. User stays on the detail page and
            // can navigate freely while the pipeline runs.
            FgdProgressPanel.start(resp.job_id);
        } catch (e) {
            runBtn.disabled = false;
            runBtn.textContent = 'Run';
            Toast.error('Failed to queue analytics: ' + e.message);
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════
// FLOATING PROGRESS PANEL
// ═══════════════════════════════════════════════════════════════════════
// Non-blocking corner panel that mirrors the .file-progress-panel pattern
// from project-detail.html. Subscribes to ResearchHub's FgdReportProgress
// SignalR event and falls back to polling /reports/:job_id if the hub
// connection fails. Panel is shown on Run-Analytics click, and also
// auto-resumes on page load if an in-progress job exists for the project.
const FgdProgressPanel = (() => {
    const STAGE_LABEL = {
        queued: 'Queued',
        chunking: 'Preparing chunks',
        coding: 'Coding utterances',
        synthesizing: 'Building codeframe',
        recoding: 'Mapping to themes',
        writing: 'Writing theme summaries',
        rollup: 'Comparing sessions',
        summarizing: 'Writing executive summary',
        done: 'Complete',
        failed: 'Failed',
        cancelled: 'Cancelled',
    };

    let currentJobId = null;
    let conn = null;
    let pollTimer = null;
    let startedAt = 0;
    let elapsedTimer = null;

    function els() {
        return {
            panel:   document.getElementById('fgdProgressPanel'),
            title:   document.getElementById('fgdProgressTitle'),
            stage:   document.getElementById('fgdProgressStage'),
            msg:     document.getElementById('fgdProgressMsg'),
            fill:    document.getElementById('fgdProgressFill'),
            pct:     document.getElementById('fgdProgressPct'),
            elapsed: document.getElementById('fgdProgressElapsed'),
            actions: document.getElementById('fgdProgressActions'),
            viewBtn: document.getElementById('fgdProgressViewBtn'),
        };
    }

    function show() {
        const { panel } = els();
        if (panel) {
            panel.style.display = '';
            panel.classList.remove('minimized');
        }
    }
    function close() {
        const { panel } = els();
        if (panel) panel.style.display = 'none';
        teardown();
    }
    function toggle() {
        const { panel } = els();
        if (panel) panel.classList.toggle('minimized');
    }

    function render(evt) {
        const e = els();
        const stage = evt.stage || evt.status || 'queued';
        const pct = Math.max(0, Math.min(100, evt.progress ?? 0));
        const label = STAGE_LABEL[stage] || stage;
        e.stage.textContent = label;
        e.msg.textContent = evt.message || '';
        e.fill.style.width = pct + '%';
        e.pct.textContent = pct + '%';
        e.fill.classList.toggle('done',   stage === 'done');
        e.fill.classList.toggle('failed', stage === 'failed' || stage === 'cancelled');
        if (stage === 'done') {
            e.title.textContent = 'Analytics complete';
            e.actions.style.display = '';
            e.viewBtn.onclick = () => {
                window.location.href = `fgd-report.html?job_id=${encodeURIComponent(currentJobId)}`;
            };
            teardown();
            // Refresh the "View Dashboard" header button in place
            if (typeof refreshLatestReport === 'function') refreshLatestReport();
        } else if (stage === 'failed' || stage === 'cancelled') {
            e.title.textContent = stage === 'failed' ? 'Analytics failed' : 'Analytics cancelled';
            teardown();
        } else {
            e.title.textContent = 'Analytics running';
        }
    }

    function startElapsed() {
        stopElapsed();
        startedAt = Date.now();
        const tick = () => {
            const sec = Math.floor((Date.now() - startedAt) / 1000);
            const m = Math.floor(sec / 60), s = sec % 60;
            const el = els().elapsed;
            if (el) el.textContent = (m > 0 ? `${m}m ${s}s` : `${s}s`) + ' elapsed';
        };
        tick();
        elapsedTimer = setInterval(tick, 1000);
    }
    function stopElapsed() {
        if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    }

    async function connectHub() {
        if (typeof signalR === 'undefined') return false;
        const base = (CONFIG.researchApiBaseUrl || '').replace(/\/api$/, '');
        if (!base) return false;
        try {
            conn = new signalR.HubConnectionBuilder()
                .withUrl(`${base}/hubs/research`, {
                    accessTokenFactory: () => (api.getToken ? api.getToken() : ''),
                })
                .withAutomaticReconnect()
                .configureLogging(signalR.LogLevel.Warning)
                .build();
            conn.on('FgdReportProgress', (evt) => {
                if (!evt || evt.jobId !== currentJobId) return;
                render(evt);
            });
            await conn.start();
            await conn.invoke('JoinFgdReportProgress', currentJobId);
            return true;
        } catch (err) {
            console.warn('[fgd-progress] SignalR connect failed, falling back to polling', err);
            conn = null;
            return false;
        }
    }

    async function pollOnce() {
        try {
            // _skipSpinner: poll runs every few seconds; we already have
            // the progress panel as the visible status — the global
            // button spinner flashing every tick is UI noise.
            const job = await api.request(`/research/focus-group/reports/${currentJobId}`, { _skipSpinner: true });
            if (!job) return;
            render({
                jobId: currentJobId,
                stage: job.current_stage || job.status,
                progress: job.progress || 0,
                message: job.progress_message || '',
            });
            if (['done', 'failed', 'cancelled'].includes(job.status)) {
                if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            }
        } catch (err) {
            console.warn('[fgd-progress] poll failed', err.message);
        }
    }

    function teardown() {
        stopElapsed();
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (conn) { conn.stop().catch(() => {}); conn = null; }
    }

    // Detect the Ragenaizer Copilot FAB (same pattern across research pages)
    // and lift the panel above it so they don't overlap in the corner.
    function applyCopilotClearance() {
        const hasWidget = !!document.getElementById('ragenaizer-chat-widget');
        document.body.classList.toggle('has-copilot-fab', hasWidget);
    }

    async function start(jobId) {
        currentJobId = jobId;
        applyCopilotClearance();
        show();
        render({ stage: 'queued', progress: 0, message: 'Waiting for pipeline…' });
        startElapsed();
        const ok = await connectHub();
        // Always poll as fallback — SignalR may disconnect silently.
        await pollOnce();
        if (!ok) {
            pollTimer = setInterval(pollOnce, 3000);
        } else {
            // Belt-and-suspenders: low-frequency poll even when SignalR
            // is healthy, so stale messages get corrected.
            pollTimer = setInterval(pollOnce, 8000);
        }
    }

    // Re-apply copilot clearance when the widget mounts (it may load
    // after the panel if the embed script is slow on this page).
    const copilotObserver = new MutationObserver(() => applyCopilotClearance());
    copilotObserver.observe(document.body, { childList: true });

    // Resume on page load if any job is still running for this project.
    async function resumeIfRunning() {
        try {
            const resp = await api.request(`/research/focus-group/projects/${projectId}/reports?limit=5`);
            const reports = (resp?.reports) || [];
            const running = reports.find(r => !['done', 'failed', 'cancelled'].includes(r.status));
            if (running) await start(running.job_id);
        } catch (err) {
            // Non-fatal — panel stays closed if list endpoint errors.
        }
    }

    return { start, close, toggle, resumeIfRunning };
})();

// Expose the button handlers to inline onclick attributes in the HTML.
window.toggleFgdProgressPanel = () => FgdProgressPanel.toggle();
window.closeFgdProgressPanel  = () => FgdProgressPanel.close();

/**
 * Move a session (recording) to a different focus-group project in the same tenant.
 * Used to undo the common "one session per project" mistake — consolidates multiple
 * accidental projects into one study with multiple sessions.
 */
async function moveRecording(id) {
    const rec = recordings.find(r => r.id === id);
    if (!rec) return;

    let projects;
    try {
        const resp = await api.request('/research/projects?project_type=focus-group&pageSize=200');
        projects = (resp?.data || resp?.projects || resp || [])
            .filter(p => p.id !== projectId);
    } catch (e) {
        Toast.error('Failed to load projects: ' + e.message);
        return;
    }
    if (projects.length === 0) {
        Toast.error('No other focus-group projects to move into. Create one first.');
        return;
    }

    // Build a picker overlay. Kept inline (reuses gm-overlay styles) so we don't
    // need a dedicated static modal block in the HTML.
    const overlay = document.createElement('div');
    overlay.className = 'gm-overlay active';
    overlay.style.zIndex = 2000000;
    overlay.innerHTML = `
      <div class="gm-modal" style="max-width:480px;">
        <div class="gm-header">
          <h3>Move session</h3>
          <button class="gm-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="gm-body">
          <p style="margin:0 0 12px 0; color:var(--text-secondary); font-size:13px;">
            Moving <strong>${esc(rec.title)}</strong> — pick the destination project.
          </p>
          <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px;">Destination project</label>
          <div id="moveRecTargetDd" style="width:100%;"></div>
        </div>
        <div class="gm-footer">
          <button class="gm-btn gm-btn-secondary" data-action="cancel" type="button">Cancel</button>
          <button class="gm-btn gm-btn-primary" data-action="move" type="button" disabled>Move</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Wire close handlers FIRST. If the dropdown constructor throws (missing
    // script, cache race, etc.), we still want the user to be able to dismiss
    // the modal — otherwise they're stuck with a half-rendered overlay.
    let targetId = null;
    const moveBtn = overlay.querySelector('[data-action="move"]');
    const close = () => overlay.remove();
    overlay.querySelector('.gm-close').onclick = close;
    overlay.querySelector('[data-action="cancel"]').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Platform convention: never native <select>. Always SearchableDropdown so the
    // brand theme applies and the list is filterable even with many projects.
    if (typeof SearchableDropdown === 'undefined') {
        Toast.error('Dropdown component missing. Hard-refresh the page (Cmd+Shift+R).');
        overlay.querySelector('#moveRecTargetDd').innerHTML =
            '<div style="padding:8px; color:var(--color-error); font-size:13px;">SearchableDropdown not loaded — refresh.</div>';
    } else {
        try {
            // eslint-disable-next-line no-new
            new SearchableDropdown(overlay.querySelector('#moveRecTargetDd'), {
                options: projects.map(p => ({ value: p.id, label: p.name, description: p.description || '' })),
                placeholder: 'Select project…',
                onChange: (val) => { targetId = val; moveBtn.disabled = !val; },
            });
        } catch (err) {
            console.error('[moveRecording] SearchableDropdown init failed:', err);
            Toast.error('Dropdown failed to render. See console.');
        }
    }

    moveBtn.onclick = async () => {
        if (!targetId) return;
        try {
            const resp = await api.request(`/research/focus-group/recordings/${id}/move`, {
                method: 'PATCH',
                body: JSON.stringify({ target_project_id: targetId })
            });
            close();
            stopPolling(id);
            Toast.success('Session moved');
            // Backend auto-deletes the source project if it's now empty — if that
            // happened, this page is looking at a deleted project, so bounce back
            // to the project list instead of trying to reload a 404.
            if (resp && resp.source_project_deleted) {
                Toast.info('Source project was empty and has been deleted');
                setTimeout(() => { window.location.href = 'focus-groups.html'; }, 600);
            } else {
                await loadRecordings();
            }
        } catch (e) {
            Toast.error('Move failed: ' + e.message);
        }
    };
}

async function renameRecording(id) {
    const rec = recordings.find(r => r.id === id);
    if (!rec) return;
    const next = await Prompt.show({
        title: 'Rename Recording',
        message: 'Enter a new title for this recording.',
        defaultValue: rec.title || '',
        confirmText: 'Rename'
    });
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === rec.title) return;
    try {
        await api.request(`/research/focus-group/recordings/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: trimmed })
        });
        rec.title = trimmed;
        renderRecordings();
        Toast.success('Recording renamed');
    } catch (e) { Toast.error('Rename failed: ' + e.message); }
}

// ============================================
// HELPERS
// ============================================

function formatTime(sec) {
    if (!sec && sec !== 0) return '0:00';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDuration(sec) {
    if (!sec) return '0s';
    if (sec < 60) return `${Math.round(sec)}s`;
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function isProcessing(r) {
    return r.status !== 'done' && r.status !== 'failed' && r.status !== 'pending';
}

// Normalize PascalCase keys to camelCase (Gladia result stored from C#)
function norm(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(norm);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = k.charAt(0).toLowerCase() + k.slice(1);
        out[key] = norm(v);
    }
    return out;
}

function esc(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function showModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
