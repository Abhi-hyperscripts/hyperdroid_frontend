// PaymentPlans — Bulk Import tab. CSV / XLSX → Payers + Plans.
(function () {
    'use strict';

    const TARGET_FIELDS = [
        { k: 'display_name', l: 'Display name *', required: true },
        { k: 'email',        l: 'Email' },
        { k: 'phone',        l: 'Phone' },
        { k: 'external_ref', l: 'External ref / enrolment no.' },
        { k: 'group_code',   l: 'Group / cohort code' },
        { k: 'plan_name',    l: 'Plan name' },
        { k: 'total_amount', l: 'Plan total amount' },
        { k: 'plan_start_date', l: 'Plan start date (YYYY-MM-DD)' },
        { k: 'installment_count', l: 'Installment count' }
    ];

    window.loadBulkImportTab = async function (container) {
        if (!container) container = document.getElementById('tab-bulk-import');
        if (container.dataset.rendered === '1') return;
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Upload a CSV or Excel file with one row per ${window.PP.payerLabel.toLowerCase()}.
                    Map your columns to system fields and any custom fields you've defined, preview
                    what will happen, then commit. Rows that fail validation are reported per-row.</p>
            </details>
            <div class="pp-section">
                <h2 class="pp-section-title">Step 1 — upload file</h2>
                <input type="file" id="ppBIFile" accept=".csv,.xlsx,.xls" class="form-control">
                <div class="pp-hint" style="margin-top:8px;">Max ~5000 rows. Supports CSV, XLSX.</div>
            </div>
            <div class="pp-section" id="ppBIMapSection" style="display:none;">
                <h2 class="pp-section-title">Step 2 — map columns</h2>
                <div id="ppBIMap"></div>
            </div>
            <div class="pp-section" id="ppBIPreviewSection" style="display:none;">
                <div class="pp-section-header">
                    <h2 class="pp-section-title">Step 3 — preview &amp; commit</h2>
                    <div class="pp-btn-group"><button class="btn btn-primary" id="ppBICommit">Commit Import</button></div>
                </div>
                <div id="ppBIPreview"></div>
            </div>`;

        container.querySelector('#ppBIFile').addEventListener('change', (e) => handleFile(container, e.target.files[0]));
    };

    let _rows = null, _headers = null, _customFields = [];

    async function handleFile(container, file) {
        if (!file) return;
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
        if (!json.length) { toast.error?.('Empty file'); return; }
        _rows = json;
        _headers = Object.keys(json[0]);
        _customFields = (await window.PP.loadCustomFields('payer')).filter(f => f.is_active);
        renderMap(container);
    }

    function renderMap(container) {
        const target = container.querySelector('#ppBIMap');
        const allTargets = [...TARGET_FIELDS, ..._customFields.map(f => ({ k: `cf_${f.field_key}`, l: f.label + ' (custom)', cf: f }))];
        target.innerHTML = `
            <p style="font-size:13px;color:var(--text-secondary);">${_rows.length} rows detected. Map each system field to a column from your file (or leave blank).</p>
            <table class="table-cards-table">
                <thead><tr><th>System field</th><th>File column</th><th>Sample (row 1)</th></tr></thead>
                <tbody>
                ${allTargets.map(t => `
                    <tr>
                        <td><b>${escapeHtml(t.l)}</b></td>
                        <td><select class="pp-bi-col form-control" data-key="${t.k}">
                            <option value="">— None —</option>
                            ${_headers.map(h => `<option value="${escapeAttr(h)}" ${guessMatch(h, t.k) ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
                        </select></td>
                        <td><code class="pp-bi-sample" data-key="${t.k}">${escapeHtml(getSample(t.k))}</code></td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div class="pp-btn-group" style="margin-top:12px;"><button class="btn btn-primary" id="ppBIPreviewBtn">Preview</button></div>`;
        container.querySelector('#ppBIMapSection').style.display = '';
        target.querySelectorAll('.pp-bi-col').forEach(sel => sel.addEventListener('change', () => {
            const key = sel.dataset.key;
            target.querySelector(`.pp-bi-sample[data-key="${CSS.escape(key)}"]`).textContent = sel.value ? (_rows[0]?.[sel.value] || '') : '';
        }));
        container.querySelector('#ppBIPreviewBtn').addEventListener('click', () => renderPreview(container));
    }

    function guessMatch(header, key) {
        const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
        const k = key.toLowerCase().replace(/^cf_/, '');
        return h === k || h.includes(k);
    }
    function getSample(k) {
        const sel = document.querySelector(`.pp-bi-col[data-key="${CSS.escape(k)}"]`);
        if (sel?.value) return _rows[0]?.[sel.value] || '';
        return '';
    }

    function readMapping(container) {
        const map = {};
        container.querySelectorAll('.pp-bi-col').forEach(sel => { if (sel.value) map[sel.dataset.key] = sel.value; });
        return map;
    }

    function renderPreview(container) {
        const map = readMapping(container);
        if (!map.display_name) { toast.error?.('Map the Display name column'); return; }
        const target = container.querySelector('#ppBIPreview');
        const preview = _rows.slice(0, 5).map(r => buildPayerRecord(r, map));
        target.innerHTML = `
            <p style="font-size:13px;color:var(--text-secondary);">Showing first 5 of ${_rows.length} rows. We'll create one ${window.PP.payerLabel.toLowerCase()} per row (and a plan if amount is mapped).</p>
            <pre style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:12px;max-height:300px;overflow:auto;font-size:11px;">${escapeHtml(JSON.stringify(preview, null, 2))}</pre>`;
        container.querySelector('#ppBIPreviewSection').style.display = '';
    }

    function buildPayerRecord(row, map) {
        const metadata = {};
        _customFields.forEach(f => {
            const col = map[`cf_${f.field_key}`];
            if (col && row[col] !== '') metadata[f.field_key] = row[col];
        });
        const payer = {
            tenant_id: window.PP.tenantId,
            display_name: row[map.display_name] || '',
            email: row[map.email] || null,
            phone: row[map.phone] || null,
            external_ref: row[map.external_ref] || null,
            metadata: Object.keys(metadata).length ? metadata : null
        };
        const planFields = {};
        if (map.plan_name) planFields.name = row[map.plan_name];
        if (map.total_amount) planFields.total_amount = parseFloat(row[map.total_amount]);
        if (map.plan_start_date) planFields.plan_start_date = row[map.plan_start_date];
        if (map.installment_count) planFields.installment_count = parseInt(row[map.installment_count], 10);
        return { payer, plan: Object.keys(planFields).length ? planFields : null, groupCode: row[map.group_code] || null };
    }

    async function commit(container) {
        const map = readMapping(container);
        if (!map.display_name) { toast.error?.('Map Display name first'); return; }
        const results = [];
        const groupCache = {};
        if (window.PP.cohorts) (window.PP.cohorts || []).forEach(c => { if (c.code) groupCache[c.code] = c.id; });
        for (let i = 0; i < _rows.length; i++) {
            const rec = buildPayerRecord(_rows[i], map);
            try {
                if (rec.groupCode && !groupCache[rec.groupCode]) {
                    const g = await api.request('/payment-plans/payer-groups', {
                        method: 'POST',
                        body: JSON.stringify({ tenant_id: window.PP.tenantId, name: rec.groupCode, code: rec.groupCode })
                    });
                    groupCache[rec.groupCode] = g.id;
                }
                if (rec.groupCode) rec.payer.group_id = groupCache[rec.groupCode];
                const p = await api.request('/payment-plans/payers', { method: 'POST', body: JSON.stringify(rec.payer) });
                if (rec.plan && rec.plan.total_amount > 0) {
                    await api.request('/payment-plans/plans', {
                        method: 'POST',
                        body: JSON.stringify({
                            tenant_id: window.PP.tenantId, payer_id: p.id,
                            name: rec.plan.name || `Plan — ${rec.payer.display_name}`,
                            total_amount: rec.plan.total_amount,
                            plan_start_date: rec.plan.plan_start_date || null,
                            installment_rule: { kind: 'monthly', count: rec.plan.installment_count || 1 },
                            reminder_rule: {}
                        })
                    });
                }
                results.push({ row: i + 1, success: true });
            } catch (e) {
                results.push({ row: i + 1, success: false, error: parseError(e) });
            }
        }
        const ok = results.filter(r => r.success).length;
        const fail = results.length - ok;
        toast.success?.(`Imported ${ok}/${results.length}${fail ? `, ${fail} failed` : ''}`);
        const target = container.querySelector('#ppBIPreview');
        target.innerHTML = `<table class="table-cards-table"><thead><tr><th>Row</th><th>Status</th><th>Error</th></tr></thead><tbody>
            ${results.map(r => `<tr><td>${r.row}</td><td>${r.success ? '✓' : '✗'}</td><td>${escapeHtml(r.error || '')}</td></tr>`).join('')}
        </tbody></table>`;
    }

    // Wire commit on render
    document.addEventListener('click', (e) => {
        if (e.target.id === 'ppBICommit') commit(document.getElementById('tab-bulk-import'));
    });

    function parseError(e) { try { const b = e.responseBody && JSON.parse(e.responseBody); return b?.errors?.join('; ') || b?.error || e.message; } catch(_) { return e.message; } }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function escapeAttr(s) { return escapeHtml(s); }
})();
