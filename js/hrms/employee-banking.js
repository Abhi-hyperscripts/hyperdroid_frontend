// ── HRMS Employees → Employee Banking tab ─────────────────────────────────
// Bulk banking upload for an entire tenant. HR downloads an XLSX pre-filled
// with every active employee (+ any existing primary/salary bank account),
// fills in the blanks, and re-uploads. Email is the server-side lookup key.

window.EmployeeBanking = (function () {
    let initialized = false;
    let selectedFile = null;
    let prefillCount = 0;

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
