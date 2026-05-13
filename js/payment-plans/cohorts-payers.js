// PaymentPlans — Cohorts & Payers tab
(function () {
    'use strict';

    window.loadCohortsPayersTab = async function (container) {
        if (!container) container = document.getElementById('tab-cohorts-payers');
        if (container.dataset.rendered === '1') { await refresh(container); return; }
        container.dataset.rendered = '1';
        const G = window.PP.groupLabel, GP = window.PP.groupPlural, P = window.PP.payerLabel, PP_ = window.PP.payerPlural;
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>${GP} are logical buckets (e.g. cohort, tier, project). ${PP_} are the individuals or
                    companies who actually owe money. Each ${P.toLowerCase()} can have one ${G.toLowerCase()} (optional).
                    Custom fields you've defined are rendered automatically.</p>
            </details>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div><h2 class="pp-section-title">${GP}</h2></div>
                    <div class="pp-toolbar-right"><button class="btn btn-primary" id="ppCohortAdd">+ Add ${G}</button></div>
                </div>
                <div id="ppCohortList"></div>
            </div>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div><h2 class="pp-section-title">${PP_}</h2></div>
                    <div class="pp-toolbar-right">
                        <select id="ppPayerFilter" class="form-control" style="min-width:160px;"><option value="">All ${GP}</option></select>
                        <button class="btn btn-primary" id="ppPayerAdd">+ Add ${P}</button>
                    </div>
                </div>
                <div id="ppPayerList"></div>
            </div>`;
        container.querySelector('#ppCohortAdd').addEventListener('click', () => openCohortModal(container, null));
        container.querySelector('#ppPayerAdd').addEventListener('click', () => openPayerModal(container, null));
        container.querySelector('#ppPayerFilter').addEventListener('change', () => refreshPayers(container));
        await refresh(container);
    };

    async function refresh(container) {
        await Promise.all([refreshCohorts(container), refreshPayers(container)]);
    }

    async function refreshCohorts(container) {
        const list = container.querySelector('#ppCohortList');
        list.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        try {
            const rows = await api.request(`/payment-plans/payer-groups?tenantId=${window.PP.tenantId}`);
            window.PP.cohorts = rows;
            // refresh filter dropdown
            const filt = container.querySelector('#ppPayerFilter');
            const cur = filt.value;
            filt.innerHTML = `<option value="">All ${window.PP.groupPlural}</option>` +
                rows.map(c => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
            if (!rows.length) { list.innerHTML = `<div class="pp-empty"><h3>No ${window.PP.groupPlural.toLowerCase()} yet</h3></div>`; return; }
            list.innerHTML = `
                <table class="table-cards-table">
                    <thead><tr><th>Name</th><th>Code</th><th>Start</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                    ${rows.map(c => `
                        <tr>
                            <td><b>${escapeHtml(c.name)}</b></td>
                            <td>${escapeHtml(c.code || '—')}</td>
                            <td>${c.start_date ? new Date(c.start_date).toLocaleDateString() : '—'}</td>
                            <td><span class="pp-status">${escapeHtml(c.status)}</span></td>
                            <td><button class="btn btn-link pp-cohort-edit" data-id="${c.id}">Edit</button>
                                <button class="btn btn-link pp-cohort-del" data-id="${c.id}" style="color:var(--color-error,#dc2626)">Delete</button></td>
                        </tr>`).join('')}
                    </tbody></table>`;
            list.querySelectorAll('.pp-cohort-edit').forEach(b => b.addEventListener('click', () => openCohortModal(container, rows.find(c => c.id === b.dataset.id))));
            list.querySelectorAll('.pp-cohort-del').forEach(b => b.addEventListener('click', async () => {
                if (!confirm('Delete this? Payers stay but become ungrouped.')) return;
                await api.request(`/payment-plans/payer-groups/${b.dataset.id}?tenantId=${window.PP.tenantId}`, { method: 'DELETE' });
                toast.success?.('Deleted'); refresh(container);
            }));
        } catch (e) { list.innerHTML = `<div class="pp-error">Failed: ${escapeHtml(e.message)}</div>`; }
    }

    async function refreshPayers(container) {
        const list = container.querySelector('#ppPayerList');
        const groupId = container.querySelector('#ppPayerFilter').value;
        list.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        try {
            const [payers, customFields] = await Promise.all([
                api.request(`/payment-plans/payers?tenantId=${window.PP.tenantId}${groupId ? `&groupId=${groupId}` : ''}&limit=200`),
                window.PP.loadCustomFields('payer')
            ]);
            window.PP.payersCache = payers;
            const cf = (customFields || []).filter(f => f.is_active).sort((a,b) => a.display_order - b.display_order);
            if (!payers.length) { list.innerHTML = `<div class="pp-empty"><h3>No ${window.PP.payerPlural.toLowerCase()} yet</h3><p>Click <b>+ Add ${window.PP.payerLabel}</b>.</p></div>`; return; }
            list.innerHTML = `
                <table class="table-cards-table">
                    <thead><tr>
                        <th>Name</th><th>Email</th><th>Phone</th><th>${window.PP.groupLabel}</th>
                        ${cf.map(f => `<th>${escapeHtml(f.label)}</th>`).join('')}
                        <th>Status</th><th></th>
                    </tr></thead>
                    <tbody>
                    ${payers.map(p => {
                        const cohort = (window.PP.cohorts || []).find(c => c.id === p.group_id);
                        return `<tr>
                            <td><b>${escapeHtml(p.display_name)}</b>${p.external_ref ? ` <small style="color:var(--text-secondary)">${escapeHtml(p.external_ref)}</small>` : ''}</td>
                            <td>${escapeHtml(p.email || '—')}</td>
                            <td>${escapeHtml(p.phone || '—')}</td>
                            <td>${escapeHtml(cohort?.name || '—')}</td>
                            ${cf.map(f => `<td>${escapeHtml(metaVal(p.metadata, f.field_key))}</td>`).join('')}
                            <td><span class="pp-status">${escapeHtml(p.status)}</span></td>
                            <td><button class="btn btn-link pp-payer-edit" data-id="${p.id}">Edit</button>
                                <button class="btn btn-link pp-payer-del" data-id="${p.id}" style="color:var(--color-error,#dc2626)">Delete</button></td>
                        </tr>`;
                    }).join('')}
                    </tbody></table>`;
            list.querySelectorAll('.pp-payer-edit').forEach(b => b.addEventListener('click', () => openPayerModal(container, payers.find(p => p.id === b.dataset.id))));
            list.querySelectorAll('.pp-payer-del').forEach(b => b.addEventListener('click', async () => {
                if (!confirm('Delete this payer? Their plans + installments + payments will also be removed.')) return;
                await api.request(`/payment-plans/payers/${b.dataset.id}?tenantId=${window.PP.tenantId}`, { method: 'DELETE' });
                toast.success?.('Deleted'); refresh(container);
            }));
        } catch (e) { list.innerHTML = `<div class="pp-error">Failed: ${escapeHtml(e.message)}</div>`; }
    }

    function metaVal(metadata, key) {
        if (!metadata || typeof metadata !== 'object') return '';
        const v = metadata[key];
        if (v == null) return '';
        if (Array.isArray(v)) return v.join(', ');
        return String(v);
    }

    function openCohortModal(container, c) {
        const isEdit = !!c;
        const modal = mkModal(`${isEdit ? 'Edit' : 'Add'} ${window.PP.groupLabel}`, `
            <form id="ppCForm">
                <div class="pp-form-row"><label>Name</label><div><input name="name" required></div></div>
                <div class="pp-form-row"><label>Code</label><div><input name="code"><div class="pp-hint">Optional short code (unique per tenant).</div></div></div>
                <div class="pp-form-row"><label>Start date</label><div><input type="date" name="start_date"></div></div>
                ${isEdit ? `<div class="pp-form-row"><label>Status</label><div><select name="status" id="ppCStatus"></select></div></div>` : ''}
            </form>`);
        if (isEdit) {
            modal.qs('input[name=name]').value = c.name;
            modal.qs('input[name=code]').value = c.code || '';
            if (c.start_date) modal.qs('input[name=start_date]').value = c.start_date.slice(0, 10);
            window.PP.loadStatusDefs('group').then(defs => {
                const sel = modal.qs('#ppCStatus');
                sel.innerHTML = (defs || []).filter(d => d.is_active).map(d => `<option value="${d.status_key}" ${d.status_key === c.status ? 'selected' : ''}>${escapeHtml(d.label)}</option>`).join('');
            });
        }
        modal.onSave(async () => {
            const f = modal.qs('#ppCForm');
            const body = {
                tenant_id: window.PP.tenantId,
                name: f.elements['name'].value.trim(),
                code: f.elements['code'].value.trim() || null,
                start_date: f.elements['start_date'].value || null,
                ...(isEdit ? { status: f.elements['status'].value } : {})
            };
            try {
                if (isEdit) await api.request(`/payment-plans/payer-groups/${c.id}`, { method: 'PUT', body: JSON.stringify(body) });
                else        await api.request('/payment-plans/payer-groups', { method: 'POST', body: JSON.stringify(body) });
                toast.success?.('Saved'); modal.close(); refresh(container);
            } catch (e) { toast.error?.(parseError(e)); }
        });
    }

    async function openPayerModal(container, p) {
        const isEdit = !!p;
        const cohorts = window.PP.cohorts || await api.request(`/payment-plans/payer-groups?tenantId=${window.PP.tenantId}`);
        const customFields = await window.PP.loadCustomFields('payer');
        const cf = (customFields || []).filter(f => f.is_active).sort((a,b) => a.display_order - b.display_order);
        let statusRow = '';
        if (isEdit) statusRow = `<div class="pp-form-row"><label>Status</label><div><select name="status" id="ppPStatus"></select></div></div>`;
        const modal = mkModal(`${isEdit ? 'Edit' : 'Add'} ${window.PP.payerLabel}`, `
            <form id="ppPForm">
                <div class="pp-form-row"><label>Display name</label><div><input name="display_name" required></div></div>
                <div class="pp-form-row"><label>External ref</label><div><input name="external_ref"><div class="pp-hint">Your internal ID (e.g. enrolment number)</div></div></div>
                <div class="pp-form-row"><label>${window.PP.groupLabel}</label>
                    <div><select name="group_id">
                        <option value="">— None —</option>
                        ${cohorts.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
                    </select></div></div>
                <div class="pp-form-row"><label>Email</label><div><input type="email" name="email"></div></div>
                <div class="pp-form-row"><label>Phone</label><div><input name="phone"></div></div>
                <div class="pp-form-row"><label>Owner user id</label><div><input name="owner_user_id"><div class="pp-hint">${window.PP.vocab('owner', 'Owner')} responsible.</div></div></div>
                ${statusRow}
                ${cf.length ? `<h4 style="font-size:13px;margin:20px 0 8px;">Custom fields</h4>` : ''}
                ${cf.map(f => renderCustomFieldInput(f, isEdit ? metaVal(p.metadata, f.field_key) : '')).join('')}
            </form>`);
        if (isEdit) {
            const fr = modal.qs('#ppPForm');
            fr.elements['display_name'].value = p.display_name;
            fr.elements['external_ref'].value = p.external_ref || '';
            fr.elements['group_id'].value = p.group_id || '';
            fr.elements['email'].value = p.email || '';
            fr.elements['phone'].value = p.phone || '';
            fr.elements['owner_user_id'].value = p.owner_user_id || '';
            window.PP.loadStatusDefs('payer').then(defs => {
                const sel = modal.qs('#ppPStatus');
                if (!sel) return;
                sel.innerHTML = (defs || []).filter(d => d.is_active).map(d => `<option value="${d.status_key}" ${d.status_key === p.status ? 'selected' : ''}>${escapeHtml(d.label)}</option>`).join('');
            });
        }
        modal.onSave(async () => {
            const f = modal.qs('#ppPForm');
            const metadata = {};
            cf.forEach(def => {
                const el = f.querySelector(`[name="cf_${def.field_key}"]`);
                if (!el) return;
                let v;
                if (def.field_type === 'boolean') v = el.checked;
                else if (def.field_type === 'multiselect') v = Array.from(el.selectedOptions || []).map(o => o.value);
                else if (def.field_type === 'number' && el.value !== '') v = parseFloat(el.value);
                else if (el.value !== '') v = el.value;
                if (v !== undefined) metadata[def.field_key] = v;
            });
            const body = {
                tenant_id: window.PP.tenantId,
                display_name: f.elements['display_name'].value.trim(),
                external_ref: f.elements['external_ref'].value.trim() || null,
                group_id: f.elements['group_id'].value || null,
                email: f.elements['email'].value.trim() || null,
                phone: f.elements['phone'].value.trim() || null,
                owner_user_id: f.elements['owner_user_id'].value.trim() || null,
                metadata: Object.keys(metadata).length ? metadata : null,
                ...(isEdit ? { status: f.elements['status'].value } : {})
            };
            try {
                if (isEdit) await api.request(`/payment-plans/payers/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
                else        await api.request('/payment-plans/payers', { method: 'POST', body: JSON.stringify(body) });
                toast.success?.('Saved'); modal.close(); refresh(container);
            } catch (e) { toast.error?.(parseError(e)); }
        });
    }

    function renderCustomFieldInput(f, value) {
        const req = f.is_required ? 'required' : '';
        const ph = f.placeholder ? ` placeholder="${escapeAttr(f.placeholder)}"` : '';
        const hint = f.help_text ? `<div class="pp-hint">${escapeHtml(f.help_text)}</div>` : '';
        const name = `cf_${f.field_key}`;
        let input = '';
        switch (f.field_type) {
            case 'textarea': input = `<textarea name="${name}" ${req}${ph} rows="3">${escapeHtml(value)}</textarea>`; break;
            case 'number':   input = `<input type="number" name="${name}" ${req}${ph} value="${escapeAttr(value)}">`; break;
            case 'date':     input = `<input type="date" name="${name}" ${req}${ph} value="${escapeAttr(value)}">`; break;
            case 'boolean':  input = `<label style="font-weight:400"><input type="checkbox" name="${name}" ${value === true || value === 'true' ? 'checked' : ''}> Yes</label>`; break;
            case 'email':    input = `<input type="email" name="${name}" ${req}${ph} value="${escapeAttr(value)}">`; break;
            case 'phone':    input = `<input name="${name}" ${req}${ph} value="${escapeAttr(value)}">`; break;
            case 'url':      input = `<input type="url" name="${name}" ${req}${ph} value="${escapeAttr(value)}">`; break;
            case 'dropdown': {
                const opts = (f.options || []).map(o => `<option value="${escapeAttr(o.value)}" ${o.value === value ? 'selected' : ''}>${escapeHtml(o.label || o.value)}</option>`).join('');
                input = `<select name="${name}" ${req}><option value="">— Pick —</option>${opts}</select>`; break;
            }
            case 'multiselect': {
                const vals = Array.isArray(value) ? value : (value ? [value] : []);
                const opts = (f.options || []).map(o => `<option value="${escapeAttr(o.value)}" ${vals.includes(o.value) ? 'selected' : ''}>${escapeHtml(o.label || o.value)}</option>`).join('');
                input = `<select name="${name}" ${req} multiple size="${Math.min(6, (f.options || []).length)}">${opts}</select>`; break;
            }
            default:         input = `<input name="${name}" ${req}${ph} value="${escapeAttr(value)}">`;
        }
        return `<div class="pp-form-row"><label>${escapeHtml(f.label)}${f.is_required ? ' *' : ''}</label><div>${input}${hint}</div></div>`;
    }

    function mkModal(title, body) {
        const modal = document.createElement('div');
        modal.className = 'gm-overlay active';
        modal.innerHTML = `<div class="gm-modal gm-lg" style="max-width:600px;">
            <div class="gm-header"><h3>${escapeHtml(title)}</h3><button class="gm-close">&times;</button></div>
            <div class="gm-body">${body}</div>
            <div class="gm-footer"><button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="save">Save</button></div>
        </div>`;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector('.gm-close').onclick = close;
        modal.querySelector('[data-act=cancel]').onclick = close;
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        return {
            qs: (s) => modal.querySelector(s),
            close,
            onSave: (cb) => modal.querySelector('[data-act=save]').onclick = cb
        };
    }

    function parseError(e) { try { const b = e.responseBody && JSON.parse(e.responseBody); return b?.errors?.join('; ') || b?.error || e.message; } catch(_) { return e.message; } }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function escapeAttr(s) { return escapeHtml(s); }
})();
