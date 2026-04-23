// ── HRMS Employees → Employee Banking tab ─────────────────────────────────
// Bulk banking upload for an entire tenant. HR downloads an XLSX pre-filled
// with every active employee (+ any existing primary/salary bank account),
// fills in the blanks, and re-uploads. Email is the server-side lookup key.

window.EmployeeBanking = (function () {
    let initialized = false;
    let selectedFile = null;
    let prefillCount = 0;
    let listRows = [];           // full prefill payload, cached for the table
    let filteredRows = [];       // after search + status filter
    let pagination = null;       // TablePagination instance
    const revealed = new Set();  // employee_ids whose sensitive fields are visible

    const TEMPLATE_COLUMNS = [
        { key: 'full_name',           label: 'Name',                 readonly: true  },
        { key: 'employee_code',       label: 'Employee Code',        readonly: true  },
        { key: 'email',               label: 'Email',                readonly: true  },
        { key: 'account_holder_name', label: 'Account Holder Name',  readonly: false },
        { key: 'bank_name',           label: 'Bank Name',            readonly: false },
        { key: 'branch_name',         label: 'Branch (optional)',    readonly: false },
        { key: 'account_number',      label: 'Account Number',       readonly: false },
        { key: 'ifsc_code',           label: 'IFSC Code',            readonly: false },
        { key: 'account_type',        label: 'Account Type (savings/current/salary)', readonly: false },
    ];

    function ensureInit() {
        if (initialized) return;
        initialized = true;
        wire();
        loadList();
    }

    function wire() {
        const downloadBtn = document.getElementById('bankingDownloadBtn');
        const dropZone    = document.getElementById('bankingDropZone');
        const fileInput   = document.getElementById('bankingFileInput');
        const uploadBtn   = document.getElementById('bankingUploadBtn');
        const clearBtn    = document.getElementById('bankingClearFileBtn');

        downloadBtn?.addEventListener('click', downloadTemplate);

        dropZone?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) pickFile(f);
        });

        ['dragenter', 'dragover'].forEach((ev) => dropZone?.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.add('drag-over');
        }));
        ['dragleave', 'drop'].forEach((ev) => dropZone?.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.remove('drag-over');
        }));
        dropZone?.addEventListener('drop', (e) => {
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) pickFile(f);
        });

        clearBtn?.addEventListener('click', clearFile);
        uploadBtn?.addEventListener('click', doUpload);

        document.getElementById('bankingListSearch')?.addEventListener('input', applyFilters);
        document.getElementById('bankingListStatusFilter')?.addEventListener('change', applyFilters);
        document.getElementById('bankingListRefreshBtn')?.addEventListener('click', () => loadList(true));

        // Row actions: reveal toggle + edit button.
        document.getElementById('bankingListBody')?.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('button[data-action="toggle-reveal"]');
            if (toggleBtn) {
                const id = toggleBtn.dataset.employeeId;
                if (revealed.has(id)) revealed.delete(id); else revealed.add(id);
                renderList();
                return;
            }
            const editBtn = e.target.closest('button[data-action="edit-banking"]');
            if (editBtn) {
                openEditModal(editBtn.dataset.employeeId);
                return;
            }
        });

        // Edit modal handlers.
        document.getElementById('bankingEditCloseBtn')?.addEventListener('click', closeEditModal);
        document.getElementById('bankingEditCancelBtn')?.addEventListener('click', closeEditModal);
        document.getElementById('bankingEditSaveBtn')?.addEventListener('click', saveEditModal);
        document.getElementById('bankingEditModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'bankingEditModal') closeEditModal();
        });
    }

    async function loadList(fromRefresh) {
        const body = document.getElementById('bankingListBody');
        if (!body) return;
        if (fromRefresh) {
            body.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--text-secondary);">Refreshing…</td></tr>';
        }
        try {
            const res = await api.request('/hrms/employee-banking/prefill');
            listRows = (res && res.rows) || [];
            prefillCount = listRows.length;
            applyFilters();
        } catch (err) {
            console.error('[Banking] list load failed', err);
            body.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--color-error, #ef4444);">Failed to load: ${escapeHtml(err?.message || 'unknown error')}</td></tr>`;
        }
    }

    function applyFilters() {
        const q = (document.getElementById('bankingListSearch')?.value || '').trim().toLowerCase();
        const statusFilter = document.getElementById('bankingListStatusFilter')?.value || '';

        filteredRows = listRows.filter((r) => {
            const hasBanking = !!r.account_number;
            if (statusFilter === 'configured' && !hasBanking) return false;
            if (statusFilter === 'missing' && hasBanking) return false;
            if (!q) return true;
            return [r.full_name, r.employee_code, r.email, r.bank_name]
                .some((v) => String(v || '').toLowerCase().includes(q));
        });

        // Update stat chips (reflect full dataset, not the current filter).
        const stats = document.getElementById('bankingListStats');
        if (stats) {
            const configured = listRows.filter((r) => !!r.account_number).length;
            const missing = listRows.length - configured;
            stats.innerHTML = [
                statChip('Total', listRows.length, 'stat-total'),
                statChip('Configured', configured, 'stat-valid'),
                statChip('Missing', missing, 'stat-error'),
            ].join('');
        }

        // Drive the shared TablePagination component.
        if (!pagination && typeof createTablePagination !== 'undefined') {
            pagination = createTablePagination('bankingListPagination', {
                containerSelector: '#bankingListPagination',
                data: filteredRows,
                rowsPerPage: 25,
                rowsPerPageOptions: [10, 25, 50, 100],
                onPageChange: (pageData) => renderList(pageData),
            });
        } else if (pagination) {
            pagination.setData(filteredRows);
        } else {
            // Fallback when TablePagination isn't loaded.
            renderList(filteredRows);
        }
    }

    function renderList(pageData) {
        const body = document.getElementById('bankingListBody');
        if (!body) return;

        const rows = pageData || filteredRows;
        if (!rows || rows.length === 0) {
            body.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--text-secondary);">
                ${listRows.length === 0 ? 'No employees to show.' : 'No rows match the current filters.'}
            </td></tr>`;
            return;
        }

        body.innerHTML = rows.map((r) => {
            const hasBanking = !!r.account_number;
            const showSensitive = revealed.has(r.employee_id);
            const statusBadge = hasBanking
                ? `<span class="status-badge status-active">Configured</span>`
                : `<span class="status-badge status-pending">Missing</span>`;
            const acct = hasBanking
                ? (showSensitive ? escapeHtml(r.account_number) : mask(r.account_number))
                : '<span style="color:var(--text-secondary);">—</span>';
            const ifsc = hasBanking
                ? (showSensitive ? escapeHtml(r.ifsc_code) : mask(r.ifsc_code, 3))
                : '<span style="color:var(--text-secondary);">—</span>';
            const revealBtn = hasBanking
                ? `<button type="button" class="btn btn-sm" data-action="toggle-reveal" data-employee-id="${escapeHtml(r.employee_id)}" title="${showSensitive ? 'Hide' : 'Reveal'} account & IFSC" style="padding:4px 8px;">
                        ${showSensitive ? eyeOffSvg() : eyeSvg()}
                   </button>`
                : '';
            return `
                <tr data-employee-id="${escapeHtml(r.employee_id)}">
                    <td>
                        <div style="font-weight:600;">${escapeHtml(r.full_name || '—')}</div>
                        <div style="color:var(--text-secondary); font-size:0.78rem; font-family:monospace;">${escapeHtml(r.employee_code || '')}</div>
                    </td>
                    <td style="font-family:monospace; font-size:0.85rem;">${escapeHtml(r.email || '')}</td>
                    <td>${escapeHtml(r.bank_name || '—')}</td>
                    <td>${escapeHtml(r.branch_name || '—')}</td>
                    <td style="font-family:monospace;">${acct}</td>
                    <td style="font-family:monospace;">${ifsc}</td>
                    <td>${escapeHtml(r.account_type || '—')}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            ${revealBtn}
                            <button type="button" class="btn btn-sm btn-primary" data-action="edit-banking" data-employee-id="${escapeHtml(r.employee_id)}" title="Edit banking" style="padding:4px 10px;">
                                ${editSvg()} Edit
                            </button>
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }

    function eyeSvg() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
    function eyeOffSvg() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.8 19.8 0 0 1 5.17-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.76 19.76 0 0 1-3.17 4.19M1 1l22 22M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>';
    }
    function editSvg() {
        return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    }

    // ── Edit modal ──────────────────────────────────────────────────────
    function openEditModal(employeeId) {
        const row = listRows.find((r) => r.employee_id === employeeId);
        if (!row) return;
        document.getElementById('bankingEditEmployeeId').value = row.employee_id;
        document.getElementById('bankingEditEmployeeName').textContent = row.full_name || '—';
        document.getElementById('bankingEditEmployeeCode').textContent = row.employee_code || '';
        document.getElementById('bankingEditEmployeeEmail').textContent = row.email || '';
        document.getElementById('bankingEditHolder').value = row.account_holder_name || '';
        document.getElementById('bankingEditBank').value = row.bank_name || '';
        document.getElementById('bankingEditBranch').value = row.branch_name || '';
        document.getElementById('bankingEditType').value = row.account_type || 'savings';
        document.getElementById('bankingEditAccount').value = row.account_number || '';
        document.getElementById('bankingEditIfsc').value = row.ifsc_code || '';

        const modal = document.getElementById('bankingEditModal');
        modal.hidden = false;
        modal.classList.add('active');
        setTimeout(() => document.getElementById('bankingEditHolder').focus(), 50);
    }

    function closeEditModal() {
        const modal = document.getElementById('bankingEditModal');
        modal.classList.remove('active');
        modal.hidden = true;
    }

    async function saveEditModal() {
        const btn = document.getElementById('bankingEditSaveBtn');
        const id = document.getElementById('bankingEditEmployeeId').value;
        if (!id) return;

        const payload = {
            account_holder_name: document.getElementById('bankingEditHolder').value.trim(),
            bank_name: document.getElementById('bankingEditBank').value.trim(),
            branch_name: document.getElementById('bankingEditBranch').value.trim() || null,
            account_type: document.getElementById('bankingEditType').value,
            account_number: document.getElementById('bankingEditAccount').value.trim(),
            ifsc_code: document.getElementById('bankingEditIfsc').value.trim().toUpperCase(),
        };

        const missing = [];
        if (!payload.account_holder_name) missing.push('Account Holder Name');
        if (!payload.bank_name) missing.push('Bank Name');
        if (!payload.account_number) missing.push('Account Number');
        if (!payload.ifsc_code) missing.push('IFSC Code');
        if (missing.length) {
            Toast?.error?.(`Required: ${missing.join(', ')}`);
            return;
        }

        const origLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
            const res = await api.request(`/hrms/employee-banking/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            Toast?.success?.(res?.action === 'inserted' ? 'Bank details added' : 'Bank details updated');
            closeEditModal();
            await loadList(true);
        } catch (err) {
            console.error('[Banking] edit save failed', err);
            Toast?.error?.(err?.message || 'Failed to save');
        } finally {
            btn.disabled = false;
            btn.textContent = origLabel;
        }
    }

    function statChip(label, n, cls) {
        return `<div class="stat-item ${cls}"><span class="stat-value">${n}</span><span class="stat-label">${label}</span></div>`;
    }

    function mask(value, keepLast) {
        const s = String(value || '');
        if (!s) return '—';
        const visible = keepLast == null ? 4 : keepLast;
        if (s.length <= visible) return '•'.repeat(s.length);
        return '•'.repeat(Math.min(s.length - visible, 10)) + s.slice(-visible);
    }

    async function downloadTemplate() {
        const btn = document.getElementById('bankingDownloadBtn');
        const hint = document.getElementById('bankingDownloadHint');
        const origLabel = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Preparing…';
        try {
            const res = await api.request('/hrms/employee-banking/prefill');
            const rows = (res && res.rows) || [];
            prefillCount = rows.length;

            const headers = TEMPLATE_COLUMNS.map((c) => c.label);
            const aoa = [headers];
            rows.forEach((r) => {
                aoa.push(TEMPLATE_COLUMNS.map((c) => r[c.key] == null ? '' : String(r[c.key])));
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: c.key === 'email' ? 28 : 22 }));
            XLSX.utils.book_append_sheet(wb, ws, 'Banking');

            const stamp = new Date().toISOString().slice(0, 10);
            XLSX.writeFile(wb, `employee-banking-${stamp}.xlsx`);
            if (hint) hint.textContent = `Downloaded ${rows.length} employee rows.`;
            Toast?.success?.(`Template downloaded (${rows.length} employees)`);
        } catch (err) {
            console.error('[Banking] download failed', err);
            Toast?.error?.(err?.message || 'Failed to download template');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origLabel;
        }
    }

    function pickFile(file) {
        const ok = /\.(xlsx|xls|csv)$/i.test(file.name);
        if (!ok) {
            Toast?.error?.('Please choose a .xlsx, .xls, or .csv file');
            return;
        }
        selectedFile = file;
        document.getElementById('bankingSelectedFile').textContent = file.name;
        document.getElementById('bankingSelectedFileCard').style.display = '';
        document.getElementById('bankingDropZone').style.display = 'none';
        document.getElementById('bankingUploadBtn').disabled = false;
    }

    function clearFile() {
        selectedFile = null;
        document.getElementById('bankingFileInput').value = '';
        document.getElementById('bankingSelectedFile').textContent = '';
        document.getElementById('bankingSelectedFileCard').style.display = 'none';
        document.getElementById('bankingDropZone').style.display = '';
        document.getElementById('bankingUploadBtn').disabled = true;
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    const sheetName = wb.SheetNames[0];
                    const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
                    resolve(json);
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    function rowsFromMatrix(aoa) {
        if (!aoa || aoa.length < 2) return [];
        const headerRow = aoa[0].map((h) => String(h || '').trim().toLowerCase());
        const colIndex = {};
        TEMPLATE_COLUMNS.forEach((c) => {
            const labelLower = c.label.toLowerCase();
            const keyLower = c.key.toLowerCase();
            let idx = headerRow.indexOf(labelLower);
            if (idx === -1) idx = headerRow.indexOf(keyLower);
            if (idx === -1) {
                // loose match (ignore punctuation)
                idx = headerRow.findIndex((h) => h.replace(/[^a-z0-9]/g, '') === keyLower.replace(/[^a-z0-9]/g, ''));
            }
            if (idx !== -1) colIndex[c.key] = idx;
        });

        const out = [];
        for (let i = 1; i < aoa.length; i++) {
            const r = aoa[i];
            if (!r || r.every((v) => v == null || String(v).trim() === '')) continue;
            const rec = {};
            TEMPLATE_COLUMNS.forEach((c) => {
                const idx = colIndex[c.key];
                rec[c.key] = idx != null ? String(r[idx] || '').trim() : '';
            });
            out.push(rec);
        }
        return out;
    }

    async function doUpload() {
        if (!selectedFile) return;
        const uploadBtn = document.getElementById('bankingUploadBtn');
        const origLabel = uploadBtn.textContent;
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Parsing…';
        try {
            const aoa = await readFile(selectedFile);
            const parsedRows = rowsFromMatrix(aoa);
            if (parsedRows.length === 0) {
                Toast?.error?.('No data rows found in the file');
                uploadBtn.disabled = false;
                uploadBtn.textContent = origLabel;
                return;
            }

            // Trim to only the fields the backend accepts
            const payload = {
                rows: parsedRows.map((r) => ({
                    email: r.email,
                    account_holder_name: r.account_holder_name,
                    bank_name: r.bank_name,
                    branch_name: r.branch_name,
                    account_number: r.account_number,
                    ifsc_code: r.ifsc_code,
                    account_type: r.account_type,
                })),
            };

            uploadBtn.textContent = `Uploading ${parsedRows.length} rows…`;
            const res = await api.request('/hrms/employee-banking/bulk-upload', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            renderResults(res);
            Toast?.success?.(`Processed ${res.total} rows — ${res.updated} updated, ${res.inserted} inserted`);
            // Refresh the table below so the new/updated rows show up immediately.
            if (res.updated > 0 || res.inserted > 0) loadList(true);
        } catch (err) {
            console.error('[Banking] upload failed', err);
            Toast?.error?.(err?.message || 'Upload failed');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = origLabel;
        }
    }

    function renderResults(res) {
        const card = document.getElementById('bankingResultsCard');
        const summary = document.getElementById('bankingResultsSummary');
        const body = document.getElementById('bankingResultsBody');

        // Reuse Bulk Import's preview-stats-bar chip styling.
        const stat = (label, n, cls) => `
            <div class="stat-item ${cls}">
                <span class="stat-value">${n}</span>
                <span class="stat-label">${label}</span>
            </div>`;
        summary.innerHTML = [
            stat('Total',    res.total,    'stat-total'),
            stat('Updated',  res.updated,  'stat-valid'),
            stat('Inserted', res.inserted, 'stat-valid'),
            stat('Skipped',  res.skipped,  'stat-total'),
            stat('Errored',  res.errored,  'stat-error'),
        ].join('');

        const statusColor = {
            updated:  'var(--color-success, #10b981)',
            inserted: 'var(--brand-primary, #6366f1)',
            skipped:  'var(--text-secondary)',
            error:    'var(--color-error, #ef4444)',
        };

        body.innerHTML = (res.results || []).map((r) => `
            <tr>
                <td class="col-row">${r.row_number}</td>
                <td class="col-status"><span style="color:${statusColor[r.status] || 'inherit'}; text-transform:uppercase; font-size:0.78rem; font-weight:600;">${escapeHtml(r.status)}</span></td>
                <td style="font-family:monospace; font-size:0.85rem;">${escapeHtml(r.email || '')}</td>
                <td style="color:var(--text-secondary); font-size:0.88rem;">${escapeHtml(r.message || '')}</td>
            </tr>
        `).join('');

        card.style.display = '';
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return { ensureInit };
})();
