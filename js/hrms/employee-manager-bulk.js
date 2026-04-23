// ── HRMS Employees → Reporting Manager tab ────────────────────────────
// Bulk reporting-manager reassignment. HR downloads an XLSX pre-filled
// with every active employee + their current reporting manager, fills in
// a new manager email (or the CLEAR sentinel to unassign), re-uploads.
// Employee email is the lookup key; rows with a blank new-manager cell
// are skipped (no change).

window.EmployeeManagerBulk = (function () {
    let initialized = false;
    let selectedFile = null;
    let listRows = [];          // full prefill payload, cached for the table
    let filteredRows = [];
    let pagination = null;

    const TEMPLATE_COLUMNS = [
        { key: 'full_name',            label: 'Name',                           readonly: true  },
        { key: 'employee_code',        label: 'Employee Code',                  readonly: true  },
        { key: 'email',                label: 'Employee Email',                 readonly: true  },
        { key: 'current_manager_name', label: 'Current Manager',                readonly: true  },
        { key: 'new_manager_email',    label: 'New Manager Email (or CLEAR)',   readonly: false },
        { key: 'change_reason',        label: 'Change Reason (optional)',       readonly: false },
    ];

    function ensureInit() {
        if (initialized) return;
        initialized = true;
        wire();
        loadList();
    }

    function wire() {
        document.getElementById('mgrDownloadBtn')?.addEventListener('click', downloadTemplate);

        const dropZone = document.getElementById('mgrDropZone');
        const fileInput = document.getElementById('mgrFileInput');
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

        document.getElementById('mgrClearFileBtn')?.addEventListener('click', clearFile);
        document.getElementById('mgrUploadBtn')?.addEventListener('click', doUpload);

        document.getElementById('mgrListSearch')?.addEventListener('input', applyFilters);
        document.getElementById('mgrListFilter')?.addEventListener('change', applyFilters);
        document.getElementById('mgrListRefreshBtn')?.addEventListener('click', () => loadList(true));
    }

    async function downloadTemplate() {
        const btn = document.getElementById('mgrDownloadBtn');
        const hint = document.getElementById('mgrDownloadHint');
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Preparing…';
        try {
            const res = await api.request('/hrms/employee-manager-bulk/prefill');
            const rows = (res && res.rows) || [];

            const headers = TEMPLATE_COLUMNS.map((c) => c.label);
            const aoa = [headers];
            rows.forEach((r) => {
                aoa.push(TEMPLATE_COLUMNS.map((c) => {
                    // Editable columns get blank cells so HR fills them in.
                    if (!c.readonly) return '';
                    return r[c.key] == null ? '' : String(r[c.key]);
                }));
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: c.key === 'email' || c.key === 'new_manager_email' ? 28 : 22 }));
            XLSX.utils.book_append_sheet(wb, ws, 'Reporting Manager');

            const stamp = new Date().toISOString().slice(0, 10);
            XLSX.writeFile(wb, `reporting-manager-${stamp}.xlsx`);
            if (hint) hint.textContent = `Downloaded ${rows.length} employee rows.`;
            Toast?.success?.(`Template downloaded (${rows.length} employees)`);
        } catch (err) {
            console.error('[MgrBulk] download failed', err);
            Toast?.error?.(err?.message || 'Failed to download template');
        } finally {
            btn.disabled = false;
            btn.innerHTML = orig;
        }
    }

    function pickFile(file) {
        if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
            Toast?.error?.('Please choose a .xlsx, .xls, or .csv file');
            return;
        }
        selectedFile = file;
        document.getElementById('mgrSelectedFile').textContent = file.name;
        document.getElementById('mgrSelectedFileCard').style.display = '';
        document.getElementById('mgrDropZone').style.display = 'none';
        document.getElementById('mgrUploadBtn').disabled = false;
    }

    function clearFile() {
        selectedFile = null;
        document.getElementById('mgrFileInput').value = '';
        document.getElementById('mgrSelectedFile').textContent = '';
        document.getElementById('mgrSelectedFileCard').style.display = 'none';
        document.getElementById('mgrDropZone').style.display = '';
        document.getElementById('mgrUploadBtn').disabled = true;
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
                    resolve(json);
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    function rowsFromMatrix(aoa) {
        if (!aoa || aoa.length < 2) return [];
        const header = aoa[0].map((h) => String(h || '').trim().toLowerCase());

        // Find column indices (tolerant to label variations: "New Manager Email" / "new_manager_email" / etc).
        const colIdx = {};
        const wanted = [
            { key: 'employee_email',    hints: ['employee email', 'email'] },
            { key: 'new_manager_email', hints: ['new manager email (or clear)', 'new manager email', 'manager email'] },
            { key: 'change_reason',     hints: ['change reason (optional)', 'change reason', 'reason'] },
        ];
        wanted.forEach((w) => {
            for (const h of w.hints) {
                const i = header.indexOf(h);
                if (i !== -1) { colIdx[w.key] = i; break; }
            }
        });

        const out = [];
        for (let i = 1; i < aoa.length; i++) {
            const r = aoa[i];
            if (!r || r.every((v) => v == null || String(v).trim() === '')) continue;
            out.push({
                employee_email: colIdx.employee_email    != null ? String(r[colIdx.employee_email]    || '').trim() : '',
                new_manager_email: colIdx.new_manager_email != null ? String(r[colIdx.new_manager_email] || '').trim() : '',
                change_reason: colIdx.change_reason      != null ? String(r[colIdx.change_reason]      || '').trim() : '',
            });
        }
        return out;
    }

    async function doUpload() {
        if (!selectedFile) return;
        const btn = document.getElementById('mgrUploadBtn');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Parsing…';
        try {
            const aoa = await readFile(selectedFile);
            const parsed = rowsFromMatrix(aoa);
            if (parsed.length === 0) {
                Toast?.error?.('No data rows found in the file');
                btn.disabled = false;
                btn.textContent = orig;
                return;
            }

            btn.textContent = `Uploading ${parsed.length} rows…`;
            const res = await api.request('/hrms/employee-manager-bulk/bulk-upload', {
                method: 'POST',
                body: JSON.stringify({ rows: parsed }),
            });

            renderResults(res);
            Toast?.success?.(`Processed ${res.total} rows — ${res.updated} updated, ${res.cleared} cleared`);
            if ((res.updated + res.cleared) > 0) loadList(true);
        } catch (err) {
            console.error('[MgrBulk] upload failed', err);
            Toast?.error?.(err?.message || 'Upload failed');
        } finally {
            btn.disabled = false;
            btn.textContent = orig;
        }
    }

    function renderResults(res) {
        const card = document.getElementById('mgrResultsCard');
        const summary = document.getElementById('mgrResultsSummary');
        const body = document.getElementById('mgrResultsBody');

        const stat = (label, n, cls) => `
            <div class="stat-item ${cls}">
                <span class="stat-value">${n}</span>
                <span class="stat-label">${label}</span>
            </div>`;
        summary.innerHTML = [
            stat('Total',    res.total,    'stat-total'),
            stat('Updated',  res.updated,  'stat-valid'),
            stat('Cleared',  res.cleared,  'stat-valid'),
            stat('Skipped',  res.skipped,  'stat-total'),
            stat('Errored',  res.errored,  'stat-error'),
        ].join('');

        const statusColor = {
            updated:  'var(--color-success, #10b981)',
            cleared:  'var(--brand-primary, #6366f1)',
            skipped:  'var(--text-secondary)',
            error:    'var(--color-error, #ef4444)',
        };

        body.innerHTML = (res.results || []).map((r) => `
            <tr>
                <td class="col-row">${r.row_number}</td>
                <td class="col-status"><span style="color:${statusColor[r.status] || 'inherit'}; text-transform:uppercase; font-size:0.78rem; font-weight:600;">${escapeHtml(r.status)}</span></td>
                <td style="font-family:monospace; font-size:0.85rem;">${escapeHtml(r.employee_email || '')}</td>
                <td style="color:var(--text-secondary); font-size:0.88rem;">${escapeHtml(r.message || '')}</td>
            </tr>
        `).join('');

        card.style.display = '';
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function loadList(fromRefresh) {
        const body = document.getElementById('mgrListBody');
        if (!body) return;
        if (fromRefresh) {
            body.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--text-secondary);">Refreshing…</td></tr>';
        }
        try {
            const res = await api.request('/hrms/employee-manager-bulk/prefill');
            listRows = (res && res.rows) || [];
            applyFilters();
        } catch (err) {
            console.error('[MgrBulk] list load failed', err);
            body.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--color-error, #ef4444);">Failed to load: ${escapeHtml(err?.message || 'unknown error')}</td></tr>`;
        }
    }

    function applyFilters() {
        const q = (document.getElementById('mgrListSearch')?.value || '').trim().toLowerCase();
        const filter = document.getElementById('mgrListFilter')?.value || '';

        filteredRows = listRows.filter((r) => {
            if (filter === 'has_manager' && r.reports_to_superadmin) return false;
            if (filter === 'reports_superadmin' && !r.reports_to_superadmin) return false;
            if (!q) return true;
            return [r.full_name, r.employee_code, r.email, r.current_manager_name, r.current_manager_email]
                .some((v) => String(v || '').toLowerCase().includes(q));
        });

        const stats = document.getElementById('mgrListStats');
        if (stats) {
            const withMgr = listRows.filter((r) => !r.reports_to_superadmin).length;
            const reportsSa = listRows.length - withMgr;
            stats.innerHTML = [
                `<div class="stat-item stat-total"><span class="stat-value">${listRows.length}</span><span class="stat-label">Total</span></div>`,
                `<div class="stat-item stat-valid"><span class="stat-value">${withMgr}</span><span class="stat-label">With Manager</span></div>`,
                `<div class="stat-item stat-total"><span class="stat-value">${reportsSa}</span><span class="stat-label">Reports to SUPERADMIN</span></div>`,
            ].join('');
        }

        if (!pagination && typeof createTablePagination !== 'undefined') {
            pagination = createTablePagination('mgrListPagination', {
                containerSelector: '#mgrListPagination',
                data: filteredRows,
                rowsPerPage: 25,
                rowsPerPageOptions: [10, 25, 50, 100],
                onPageChange: (pageData) => renderList(pageData),
            });
        } else if (pagination) {
            pagination.setData(filteredRows);
        } else {
            renderList(filteredRows);
        }
    }

    function renderList(pageData) {
        const body = document.getElementById('mgrListBody');
        if (!body) return;
        const rows = pageData || filteredRows;
        if (!rows || rows.length === 0) {
            body.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--text-secondary);">
                ${listRows.length === 0 ? 'No employees to show.' : 'No rows match the current filters.'}
            </td></tr>`;
            return;
        }
        body.innerHTML = rows.map((r) => {
            const mgrDisplay = r.reports_to_superadmin
                ? `<span style="color:var(--brand-primary, #6366f1); font-weight:600;">SUPERADMIN</span>
                   <span style="color:var(--text-secondary); font-size:0.78rem;"> (no explicit manager)</span>`
                : escapeHtml(r.current_manager_name || '—');
            const mgrEmail = r.reports_to_superadmin
                ? `<span style="color:var(--text-secondary);">—</span>`
                : `<span style="font-family:monospace; font-size:0.85rem;">${escapeHtml(r.current_manager_email || '—')}</span>`;
            return `
                <tr>
                    <td>
                        <div style="font-weight:600;">${escapeHtml(r.full_name || '—')}</div>
                        <div style="color:var(--text-secondary); font-size:0.78rem; font-family:monospace;">${escapeHtml(r.employee_code || '')}</div>
                    </td>
                    <td style="font-family:monospace; font-size:0.85rem;">${escapeHtml(r.email || '')}</td>
                    <td>${mgrDisplay}</td>
                    <td>${mgrEmail}</td>
                </tr>`;
        }).join('');
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
