// Focus Group Detail — Upload audio, view speaker-diarized transcriptions
if (!api.isAuthenticated()) window.location.href = '../login.html';

const SPEAKER_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316','#14b8a6','#e11d48'];
const projectId = new URLSearchParams(window.location.search).get('id');
let recordings = [];
let selectedFile = null;
let currentJsonData = null;
let pollTimers = {};
let recordingResults = {};

document.addEventListener('DOMContentLoaded', async () => {
    if (!projectId) { window.location.href = 'focus-groups.html'; return; }
    await loadProject();
    await loadRecordings();
    setupDragDrop();
});

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
    if (!recordings || recordings.length === 0) {
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
