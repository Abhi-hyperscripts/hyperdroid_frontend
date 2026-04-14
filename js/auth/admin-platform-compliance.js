// ============================================================================
// Platform Statutory Compliance — SuperAdmin tab
// ============================================================================
// SaaS SuperAdmin uploads a country JSON (India, UK, UAE, …) here. Auth
// stores it as a platform master row and fires a fire-and-forget gRPC
// fan-out to every sub-tenant. Each sub-tenant's HRMS validates and stores
// the row exactly as if the tenant had uploaded it themselves. A tenant
// can still upload their own override through their HRMS UI — whichever
// row has the newer effective_from wins via HRMS's existing versioning.
// ============================================================================

// Resolve the base URL lazily. CONFIG is loaded via <script> in a sibling
// file; at module-load time it might not exist yet, so compute the URL on
// every call.
function _platformComplianceBaseUrl() {
    // CONFIG is declared as a global `const` in /js/config.js — it lives in
    // the page's global scope but is NOT attached to window. Probe via
    // typeof so we don't throw if the file hasn't loaded yet.
    try {
        if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.authApiBaseUrl) {
            return CONFIG.authApiBaseUrl + '/platform-statutory';
        }
    } catch { /* swallow ReferenceError */ }
    // Fallback when page is served from same host as Auth (dev-mode only).
    return '/api/platform-statutory';
}

// ------- Network helpers --------------------------------------------------

async function _platformComplianceFetch(path, options = {}) {
    const token = localStorage.getItem('ragenaizer_authToken') || '';
    const headers = Object.assign(
        { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        options.headers || {});
    const response = await fetch(_platformComplianceBaseUrl() + path, Object.assign({}, options, { headers }));
    if (!response.ok) {
        let errText = response.statusText;
        try {
            const body = await response.json();
            errText = body.error || body.message || errText;
        } catch { /* swallow */ }
        throw new Error(errText);
    }
    if (response.status === 204) return null;
    return response.json();
}

// ------- List ------------------------------------------------------------

async function loadPlatformComplianceConfigs() {
    const host = document.getElementById('platformComplianceList');
    if (!host) return;
    host.innerHTML = '<div class="empty-message" style="text-align:center; color: var(--ink-3); padding: 40px 0;">Loading platform configs&hellip;</div>';

    try {
        const rows = await _platformComplianceFetch('/configs');
        if (!Array.isArray(rows) || rows.length === 0) {
            host.innerHTML = `
                <div class="empty-message" style="text-align:center; padding:60px 0; color: var(--ink-3);">
                    <p>No platform configs uploaded yet.</p>
                    <p style="font-size:13px; margin-top:8px">Click <strong>Upload Country JSON</strong> to push a country's statutory rules to every sub-tenant.</p>
                </div>`;
            return;
        }
        host.innerHTML = _renderPlatformComplianceTable(rows);
    } catch (err) {
        console.error('Failed to load platform compliance configs:', err);
        host.innerHTML = `<div class="empty-message" style="text-align:center; padding:40px 0; color: var(--color-error, #c33)">Failed to load: ${_escapeHtml(err.message)}</div>`;
    }
}

function _renderPlatformComplianceTable(rows) {
    const rowsHtml = rows.map(r => {
        const summary = _parseSummary(r.last_distribution_summary);
        const distText = r.last_distributed_at
            ? (summary
                ? `<strong>${summary.Successes ?? summary.successes ?? 0}</strong>/<span>${summary.TenantCount ?? summary.tenant_count ?? 0}</span>`
                : '—')
            : '<em>pending</em>';
        const active = r.is_active
            ? '<span class="badge badge-success">Active</span>'
            : '<span class="badge badge-muted">Inactive</span>';
        return `
            <tr>
                <td><strong>${_escapeHtml(r.country_name || '')}</strong><br><span class="text-muted">${_escapeHtml(r.country_code || '')}</span></td>
                <td>${_escapeHtml(r.version)}${r.schema_version ? ' <span class="text-muted">(schema ' + _escapeHtml(r.schema_version) + ')</span>' : ''}</td>
                <td>${_formatDate(r.effective_from)}</td>
                <td>${active}</td>
                <td>${distText}</td>
                <td>${_formatDate(r.last_distributed_at) || '—'}</td>
                <td style="white-space:nowrap">
                    <button class="btn btn-sm btn-secondary" onclick="viewPlatformComplianceDetail('${r.id}')">Details</button>
                    <button class="btn btn-sm btn-secondary" onclick="redistributePlatformCompliance('${r.id}')" title="Re-run fan-out to all sub-tenants">Redistribute</button>
                    ${r.is_active ? `<button class="btn btn-sm btn-danger" onclick="deactivatePlatformCompliance('${r.id}')">Deactivate</button>` : ''}
                </td>
            </tr>`;
    }).join('');
    return `
        <div class="users-table-container">
            <table class="users-table">
                <thead>
                    <tr>
                        <th>Country</th>
                        <th>Version</th>
                        <th>Effective From</th>
                        <th>Status</th>
                        <th>Success / Total</th>
                        <th>Last Distributed</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;
}

// ------- Upload ----------------------------------------------------------

function openPlatformComplianceUploadModal() {
    const modal = document.getElementById('platformComplianceUploadModal');
    if (!modal) return;
    document.getElementById('platformComplianceDescription').value = '';
    document.getElementById('platformComplianceJson').value = '';
    // Match the existing admin.js modal show pattern (`gm-animating` + `active`).
    modal.classList.add('gm-animating');
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('active')));
}
function closePlatformComplianceUploadModal() {
    const modal = document.getElementById('platformComplianceUploadModal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => modal.classList.remove('gm-animating'), 200);
}

async function submitPlatformComplianceUpload() {
    const btn = document.getElementById('platformComplianceSubmitBtn');
    const json = (document.getElementById('platformComplianceJson').value || '').trim();
    const description = (document.getElementById('platformComplianceDescription').value || '').trim();
    if (!json) {
        if (typeof showToast === 'function') showToast('Paste the country JSON before saving.', 'error');
        return;
    }
    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = 'Saving…';
    try {
        const result = await _platformComplianceFetch('/configs', {
            method: 'POST',
            body: JSON.stringify({ JsonContent: json, Description: description || null }),
        });
        if (typeof showToast === 'function') {
            showToast(`Saved ${result.country_code} ${result.version}. Fan-out running in background.`, 'success');
        }
        closePlatformComplianceUploadModal();
        // Kick the list reload. The distribution summary starts blank and
        // fills in as tenants respond, so reload a couple of seconds later
        // to surface early results.
        loadPlatformComplianceConfigs();
        setTimeout(loadPlatformComplianceConfigs, 3000);
    } catch (err) {
        console.error('Platform compliance upload failed:', err);
        if (typeof showToast === 'function') showToast('Upload failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = prevText;
    }
}

// ------- Detail drawer ---------------------------------------------------

async function viewPlatformComplianceDetail(id) {
    const modal = document.getElementById('platformComplianceDetailModal');
    const body = document.getElementById('platformComplianceDetailBody');
    const title = document.getElementById('platformComplianceDetailTitle');
    if (!modal || !body) return;
    modal.classList.add('gm-animating');
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('active')));
    body.innerHTML = '<p>Loading…</p>';
    try {
        const row = await _platformComplianceFetch('/configs/' + encodeURIComponent(id));
        title.textContent = `${row.country_name} (${row.country_code}) — ${row.version}`;
        const summary = _parseSummary(row.last_distribution_summary);
        const failuresHtml = (summary && (summary.FailureDetails || summary.failure_details || []).length)
            ? `<h4 style="margin-top:16px">Per-tenant failures</h4>
               <ul style="font-size:13px; color: var(--color-error,#c33)">
                 ${(summary.FailureDetails || summary.failure_details).map(f =>
                    `<li><code>${_escapeHtml(f.TenantId || f.tenant_id)}</code>: ${_escapeHtml(f.Message || f.message)}</li>`
                 ).join('')}
               </ul>`
            : '';
        body.innerHTML = `
            <dl style="display:grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 13px;">
                <dt>Country</dt><dd>${_escapeHtml(row.country_name)} <span class="text-muted">(${_escapeHtml(row.country_code)})</span></dd>
                <dt>Version</dt><dd>${_escapeHtml(row.version)} ${row.schema_version ? '<span class="text-muted">schema ' + _escapeHtml(row.schema_version) + '</span>' : ''}</dd>
                <dt>Effective</dt><dd>${_formatDate(row.effective_from)} → ${_formatDate(row.effective_to) || '∞'}</dd>
                <dt>Status</dt><dd>${row.is_active ? 'Active' : 'Inactive'}</dd>
                <dt>Uploaded</dt><dd>${_formatDate(row.created_at)} by ${_escapeHtml(row.uploaded_by || '—')}</dd>
                <dt>Distributed</dt><dd>${_formatDate(row.last_distributed_at) || 'Not yet'}</dd>
                <dt>Tenants</dt><dd>${summary ? `${summary.Successes ?? 0} success / ${summary.Failures ?? 0} failure of ${summary.TenantCount ?? 0}` : '—'}</dd>
                <dt>Description</dt><dd>${_escapeHtml(row.description || '—')}</dd>
            </dl>
            ${failuresHtml}
            <details style="margin-top:16px">
                <summary>Raw JSON</summary>
                <pre style="max-height:360px; overflow:auto; background: var(--paper-2,#f3f1ea); padding:10px; font-size:11px; border-radius:6px;">${_escapeHtml(_prettyJson(row.config_data))}</pre>
            </details>`;
    } catch (err) {
        body.innerHTML = `<p style="color: var(--color-error,#c33)">Failed to load: ${_escapeHtml(err.message)}</p>`;
    }
}
function closePlatformComplianceDetailModal() {
    const modal = document.getElementById('platformComplianceDetailModal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => modal.classList.remove('gm-animating'), 200);
}

// ------- Row actions -----------------------------------------------------

async function redistributePlatformCompliance(id) {
    if (!confirm('Re-run the fan-out for this platform config? Every sub-tenant will get a fresh push in the background.')) return;
    try {
        await _platformComplianceFetch('/configs/' + encodeURIComponent(id) + '/redistribute', { method: 'POST' });
        if (typeof showToast === 'function') showToast('Redistribution started. Reload in a moment for updated results.', 'success');
        setTimeout(loadPlatformComplianceConfigs, 3000);
    } catch (err) {
        if (typeof showToast === 'function') showToast('Redistribute failed: ' + err.message, 'error');
    }
}

async function deactivatePlatformCompliance(id) {
    if (!confirm('Mark this platform config inactive? Already-distributed tenant rows are NOT touched (Finance can revoke tenant-side separately).')) return;
    try {
        await _platformComplianceFetch('/configs/' + encodeURIComponent(id), { method: 'DELETE' });
        if (typeof showToast === 'function') showToast('Deactivated.', 'success');
        loadPlatformComplianceConfigs();
    } catch (err) {
        if (typeof showToast === 'function') showToast('Deactivate failed: ' + err.message, 'error');
    }
}

// ------- Helpers ---------------------------------------------------------

function _escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return value;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function _parseSummary(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
}

function _prettyJson(raw) {
    if (!raw) return '';
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return JSON.stringify(parsed, null, 2);
    } catch {
        return typeof raw === 'string' ? raw : JSON.stringify(raw);
    }
}
