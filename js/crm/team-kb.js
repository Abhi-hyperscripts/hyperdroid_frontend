/**
 * AI Knowledge Base card — CRM Settings → Integrations.
 *
 * Per-team documents that ground the WhatsApp AI auto-replies. Talks to
 * CRM's /api/team-documents (upload runs text-extraction inline and
 * enforces the tenant token budget synchronously — an over-budget upload
 * is rejected with a human-readable message from the backend).
 *
 * The usage meter shows effective tokens (compacted docs count small)
 * against the tenant's kb_token_budget.
 */

(function () {
    'use strict';

    let kbTeams = [];              // [{id, name}]
    let kbSelectedTeamId = null;   // team for uploads (list shows ALL teams)
    let kbTeamDropdown = null;     // SearchableDropdown instance
    let kbLoaded = false;

    async function apiUpload(path, formData) {
        return api.request(`/crm${path}`, { method: 'POST', body: formData });
    }

    // ─── Entry point (called when the Integrations tab shows) ──────────────

    async function loadKnowledgeBase() {
        try {
            await Promise.all([loadKbTeams(), refreshKbDocs()]);
            kbLoaded = true;
        } catch (err) {
            console.error('[team-kb] load failed:', err);
            if (typeof Toast !== 'undefined') Toast.error('Failed to load Knowledge Base');
        }
    }

    async function loadKbTeams() {
        const container = document.getElementById('kbTeamDropdown');
        if (!container) return;
        const resp = await api.request('/crm/teams');
        const teams = (resp?.teams || resp || []).filter(t => (t.status || 'active') !== 'archived');
        kbTeams = teams.map(t => ({ id: t.id, name: t.team_name || t.teamName || t.name || 'Unnamed team' }));

        if (kbTeams.length === 0) {
            container.innerHTML = '<span style="font-size:0.85rem; color:var(--text-secondary);">Create a team first (Settings → Teams) to upload documents.</span>';
            const btn = document.getElementById('kbUploadBtn');
            if (btn) btn.disabled = true;
            return;
        }

        if (typeof SearchableDropdown !== 'undefined') {
            container.innerHTML = '';
            kbTeamDropdown = new SearchableDropdown(container, {
                options: kbTeams.map(t => ({ value: t.id, label: t.name })),
                placeholder: 'Select team for upload…',
                searchPlaceholder: 'Search teams…',
                onChange: (value) => {
                    kbSelectedTeamId = value;
                    const btn = document.getElementById('kbUploadBtn');
                    if (btn) btn.disabled = !value;
                }
            });
        }
    }

    async function refreshKbDocs() {
        const wrap = document.getElementById('kbDocsWrap');
        const empty = document.getElementById('kbEmptyState');
        const tbody = document.getElementById('kbDocsTableBody');
        if (!tbody) return;

        const resp = await api.request('/crm/team-documents');
        const docs = resp?.documents || [];
        renderKbUsage(resp?.used_tokens ?? 0, resp?.budget_tokens ?? 100000);

        if (docs.length === 0) {
            tbody.innerHTML = '';
            wrap.style.display = 'none';
            empty.style.display = '';
            return;
        }
        wrap.style.display = '';
        empty.style.display = 'none';
        tbody.innerHTML = docs.map(renderKbRow).join('');
    }

    function renderKbUsage(used, budget) {
        const label = document.getElementById('kbUsageLabel');
        const bar = document.getElementById('kbUsageBar');
        if (!label || !bar) return;
        const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
        label.textContent = `${fmtTokens(used)} of ${fmtTokens(budget)} tokens (${pct}%)`;
        bar.style.width = `${pct}%`;
        bar.style.background = pct >= 90 ? 'var(--color-error, #dc2626)'
                            : pct >= 70 ? 'var(--color-warning, #d97706)'
                            : 'var(--brand-primary)';
    }

    function renderKbRow(d) {
        const statusChip =
            d.status === 'ready' ? '<span class="status-badge active"><span class="status-dot"></span>Ready</span>'
          : d.status === 'compacting' ? '<span class="status-badge pending"><span class="status-dot"></span>Compacting…</span>'
          : d.status === 'processing' ? '<span class="status-badge pending"><span class="status-dot"></span>Processing…</span>'
          : `<span class="status-badge inactive" data-tooltip="${escapeHtml(d.error_message || d.errorMessage || 'Failed')}"><span class="status-dot"></span>Failed</span>`;

        const tokens = d.effective_token_estimate ?? d.effectiveTokenEstimate ?? d.token_estimate ?? d.tokenEstimate ?? 0;
        const rawTokens = d.token_estimate ?? d.tokenEstimate ?? 0;
        const compacted = d.use_compacted ?? d.useCompacted;
        const canCompact = d.status === 'ready' && !compacted && rawTokens > 3000;
        const note = d.error_message || d.errorMessage;

        return `
            <tr>
                <td>
                    <div style="font-weight:600;">${escapeHtml(d.file_name || d.fileName || '')}</div>
                    <div style="font-size:0.76rem; color:var(--text-secondary);">${fmtBytes(d.file_size_bytes ?? d.fileSizeBytes ?? 0)}${compacted ? ' · compacted by AI' : ''}${note && d.status === 'ready' ? ` · ${escapeHtml(note)}` : ''}</div>
                </td>
                <td>${escapeHtml(d.team_name || d.teamName || '')}</td>
                <td><span data-tooltip="${compacted ? `Compacted from ~${fmtTokens(rawTokens)}` : 'Estimated reading size'}">${fmtTokens(tokens)}</span></td>
                <td>${statusChip}</td>
                <td style="text-align:right;">
                    <div class="action-buttons" style="justify-content:flex-end;">
                        ${canCompact ? `
                        <button class="action-btn" data-tooltip="Compact with AI — squeeze into a smaller fact sheet" onclick="kbCompactDoc('${d.id}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="4 14 10 14 10 20"/>
                                <polyline points="20 10 14 10 14 4"/>
                                <line x1="14" y1="10" x2="21" y2="3"/>
                                <line x1="3" y1="21" x2="10" y2="14"/>
                            </svg>
                        </button>` : ''}
                        <button class="action-btn danger" data-tooltip="Delete document" onclick="kbDeleteDoc('${d.id}', '${escapeHtml((d.file_name || d.fileName || '').replace(/'/g, ''))}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>`;
    }

    // ─── Upload flow ────────────────────────────────────────────────────────

    function kbPickFile() {
        if (!kbSelectedTeamId) {
            if (typeof Toast !== 'undefined') Toast.warning('Pick a team first');
            return;
        }
        document.getElementById('kbFileInput')?.click();
    }

    async function kbFileChosen(input) {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file || !kbSelectedTeamId) return;

        const spinner = document.getElementById('kbUploadSpinner');
        const btn = document.getElementById('kbUploadBtn');
        if (spinner) spinner.style.display = '';
        if (btn) btn.disabled = true;
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('team_id', kbSelectedTeamId);
            const uploaded = await apiUpload('/team-documents/upload', formData);
            if (typeof Toast !== 'undefined') Toast.success(`'${file.name}' added to the knowledge base`);
            // Data-hygiene warnings: same SKU priced differently in another
            // doc — surface each conflict so the admin fixes the stale file.
            const warnings = uploaded?.warnings || [];
            if (warnings.length && typeof Toast !== 'undefined') {
                warnings.slice(0, 3).forEach(w => Toast.warning(`⚠️ Price conflict: ${w}`, { duration: 12000 }));
                if (warnings.length > 3) Toast.warning(`…and ${warnings.length - 3} more price conflicts — review your documents.`);
            }
            await refreshKbDocs();
        } catch (err) {
            console.error('[team-kb] upload failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Upload failed');
        } finally {
            if (spinner) spinner.style.display = 'none';
            if (btn) btn.disabled = !kbSelectedTeamId;
        }
    }

    // ─── Row actions ────────────────────────────────────────────────────────

    async function kbDeleteDoc(id, name) {
        const doDelete = async () => {
            try {
                await api.request(`/crm/team-documents/${id}`, { method: 'DELETE' });
                if (typeof Toast !== 'undefined') Toast.success('Document removed');
                await refreshKbDocs();
            } catch (err) {
                if (typeof Toast !== 'undefined') Toast.error(err.message || 'Delete failed');
            }
        };
        if (typeof Confirm !== 'undefined' && Confirm.show) {
            Confirm.show({
                title: 'Remove document?',
                message: `'${name}' will be removed from the AI's knowledge base. Conversations already answered are unaffected.`,
                confirmText: 'Remove',
                danger: true,
                onConfirm: doDelete,
            });
        } else {
            await doDelete();
        }
    }

    async function kbCompactDoc(id) {
        try {
            await api.request(`/crm/team-documents/${id}/compact`, { method: 'POST' });
            if (typeof Toast !== 'undefined') Toast.success('Compaction started — this takes a minute for big documents');
            await refreshKbDocs();
            // Poll until it leaves 'compacting' (bounded).
            let tries = 0;
            const poll = setInterval(async () => {
                tries++;
                const resp = await api.request('/crm/team-documents').catch(() => null);
                const doc = resp?.documents?.find(d => d.id === id);
                if (!doc || doc.status !== 'compacting' || tries > 40) {
                    clearInterval(poll);
                    await refreshKbDocs();
                }
            }, 5000);
        } catch (err) {
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Compaction failed to start');
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function fmtTokens(n) {
        if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
        return String(n);
    }
    function fmtBytes(n) {
        if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
        if (n >= 1024) return `${Math.round(n / 1024)} KB`;
        return `${n} B`;
    }
    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ─── Expose globals for onclick handlers ────────────────────────────────
    window.loadKnowledgeBase = loadKnowledgeBase;
    window.kbPickFile = kbPickFile;
    window.kbFileChosen = kbFileChosen;
    window.kbDeleteDoc = kbDeleteDoc;
    window.kbCompactDoc = kbCompactDoc;
})();
