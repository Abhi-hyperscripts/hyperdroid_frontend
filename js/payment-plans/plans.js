// PaymentPlans — Plans tab
(function () {
    'use strict';

    window.loadPlansTab = async function (container) {
        if (!container) container = document.getElementById('tab-plans');
        if (container.dataset.rendered === '1') { await refresh(container); return; }
        container.dataset.rendered = '1';
        const L = window.PP.planLabel;
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>A ${L.toLowerCase()} is a payment schedule attached to one ${window.PP.payerLabel.toLowerCase()}.
                    It generates installments based on the rule (monthly / fixed schedule / milestone / per-invoice)
                    and fires reminders per the reminder rule.</p>
            </details>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div><h2 class="pp-section-title">${L}s</h2></div>
                    <div class="pp-toolbar-right">
                        <select id="ppPlStatus" class="form-control" style="min-width:140px;">
                            <option value="">All statuses</option>
                        </select>
                        <button class="btn btn-primary" id="ppPlAdd">+ Create ${L}</button>
                    </div>
                </div>
                <div id="ppPlList"></div>
            </div>`;
        container.querySelector('#ppPlAdd').addEventListener('click', () => openPlanModal(container));
        container.querySelector('#ppPlStatus').addEventListener('change', () => refresh(container));
        window.PP.loadStatusDefs('plan').then(defs => {
            const sel = container.querySelector('#ppPlStatus');
            sel.innerHTML = `<option value="">All statuses</option>` +
                (defs || []).filter(d => d.is_active).map(d => `<option value="${d.status_key}">${escapeHtml(d.label)}</option>`).join('');
        });
        await refresh(container);
    };

    async function refresh(container) {
        const list = container.querySelector('#ppPlList');
        const status = container.querySelector('#ppPlStatus').value;
        list.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        try {
            const url = `/payment-plans/plans?tenantId=${window.PP.tenantId}${status ? `&status=${status}` : ''}&limit=200`;
            const plans = await api.request(url);
            if (!plans.length) { list.innerHTML = `<div class="pp-empty"><h3>No ${window.PP.planLabel.toLowerCase()}s yet</h3></div>`; return; }
            const payers = window.PP.payersCache || await api.request(`/payment-plans/payers?tenantId=${window.PP.tenantId}&limit=500`);
            window.PP.payersCache = payers;
            const payerById = Object.fromEntries(payers.map(p => [p.id, p]));
            list.innerHTML = `
                <table class="table-cards-table">
                    <thead><tr><th>Name</th><th>${window.PP.payerLabel}</th><th>Total</th><th>Paid</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                    ${plans.map(p => `
                        <tr>
                            <td><b>${escapeHtml(p.name)}</b></td>
                            <td>${escapeHtml(payerById[p.payer_id]?.display_name || p.payer_id)}</td>
                            <td>${fmt(p.total_amount, p.currency)}</td>
                            <td>${fmt(p.paid_amount, p.currency)} <small style="color:var(--text-secondary)">(${pct(p.paid_amount, p.total_amount)}%)</small></td>
                            <td><span class="pp-status">${escapeHtml(p.status)}</span></td>
                            <td>
                                <button class="btn btn-link pp-pl-view" data-id="${p.id}">View</button>
                                <button class="btn btn-link pp-pl-edit" data-id="${p.id}">Edit</button>
                                <button class="btn btn-link pp-pl-del" data-id="${p.id}" style="color:var(--color-error,#dc2626)">Delete</button>
                            </td>
                        </tr>`).join('')}
                    </tbody></table>`;
            list.querySelectorAll('.pp-pl-view').forEach(b => b.addEventListener('click', () => openViewModal(b.dataset.id)));
            list.querySelectorAll('.pp-pl-edit').forEach(b => b.addEventListener('click', () => openEditModal(container, plans.find(p => p.id === b.dataset.id))));
            list.querySelectorAll('.pp-pl-del').forEach(b => b.addEventListener('click', async () => {
                if (!confirm('Delete this plan? Installments + payments will also be removed.')) return;
                await api.request(`/payment-plans/plans/${b.dataset.id}?tenantId=${window.PP.tenantId}`, { method: 'DELETE' });
                toast.success?.('Deleted'); refresh(container);
            }));
        } catch (e) { list.innerHTML = `<div class="pp-error">Failed: ${escapeHtml(e.message)}</div>`; }
    }

    async function openPlanModal(container) {
        const payers = window.PP.payersCache || await api.request(`/payment-plans/payers?tenantId=${window.PP.tenantId}&limit=500`);
        const templates = window.PP.planTemplates || await api.request(`/payment-plans/plan-templates?tenantId=${window.PP.tenantId}`);
        const customFields = (await window.PP.loadCustomFields('plan')).filter(f => f.is_active).sort((a,b) => a.display_order - b.display_order);
        const modal = mkModal(`Create ${window.PP.planLabel}`, `
            <form id="ppPlForm">
                <div class="pp-form-row"><label>${window.PP.payerLabel}</label>
                    <div><select name="payer_id" required>
                        <option value="">— Pick —</option>
                        ${payers.map(p => `<option value="${p.id}">${escapeHtml(p.display_name)}</option>`).join('')}
                    </select></div></div>
                <div class="pp-form-row"><label>Template (optional)</label>
                    <div><select name="template_id" id="ppTplSel">
                        <option value="">— None —</option>
                        ${templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
                    </select><div class="pp-hint">Pre-fill installment + reminder rules from a template.</div></div></div>
                <div class="pp-form-row"><label>Plan name</label><div><input name="name" placeholder="e.g. ${window.PP.planLabel} — Student name"></div></div>
                <div class="pp-form-row"><label>Currency</label><div><input name="currency" value="${window.PP.config?.default_currency || 'INR'}" maxlength="3"></div></div>
                <div class="pp-form-row"><label>Total amount</label><div><input type="number" name="total_amount" step="0.01" min="0.01" required></div></div>
                <div class="pp-form-row"><label>Start date</label><div><input type="date" name="plan_start_date"></div></div>
                <h4 style="font-size:13px;margin:20px 0 8px;">Installment rule</h4>
                <div class="pp-form-row"><label>Kind</label>
                    <div><select name="ir.kind">
                        <option value="monthly">Monthly equal</option>
                        <option value="fixed_schedule">Fixed schedule</option>
                    </select></div></div>
                <div class="pp-form-row ir-monthly"><label>Number of installments</label><div><input type="number" name="ir.count" min="1" value="3"></div></div>
                ${customFields.length ? `<h4 style="font-size:13px;margin:20px 0 8px;">Custom fields</h4>` : ''}
                ${customFields.map(f => renderCFInput(f)).join('')}
            </form>`);
        const showMonthly = () => {
            const isM = modal.qs('select[name="ir.kind"]').value === 'monthly';
            modal.root.querySelectorAll('.ir-monthly').forEach(r => r.style.display = isM ? '' : 'none');
        };
        modal.qs('select[name="ir.kind"]').addEventListener('change', showMonthly);
        showMonthly();
        modal.qs('#ppTplSel').addEventListener('change', (e) => {
            const t = templates.find(t => t.id === e.target.value);
            if (t) {
                modal.qs('input[name="total_amount"]').value = t.default_total_amount || '';
                modal.qs('select[name="ir.kind"]').value = t.installment_rule?.kind || 'monthly';
                modal.qs('input[name="ir.count"]').value = t.installment_rule?.count || 3;
                showMonthly();
            }
        });
        modal.onSave(async () => {
            const f = modal.qs('#ppPlForm');
            const metadata = {};
            customFields.forEach(def => {
                const el = f.querySelector(`[name="cf_${def.field_key}"]`);
                if (!el) return;
                let v;
                if (def.field_type === 'boolean') v = el.checked;
                else if (def.field_type === 'multiselect') v = Array.from(el.selectedOptions).map(o => o.value);
                else if (def.field_type === 'number' && el.value !== '') v = parseFloat(el.value);
                else if (el.value !== '') v = el.value;
                if (v !== undefined) metadata[def.field_key] = v;
            });
            const body = {
                tenant_id: window.PP.tenantId,
                payer_id: f.elements['payer_id'].value,
                template_id: f.elements['template_id'].value || null,
                name: f.elements['name'].value.trim() || null,
                currency: (f.elements['currency'].value || 'INR').toUpperCase().slice(0,3),
                total_amount: parseFloat(f.elements['total_amount'].value),
                plan_start_date: f.elements['plan_start_date'].value || null,
                metadata: Object.keys(metadata).length ? metadata : null,
                installment_rule: {
                    kind: f.elements['ir.kind'].value,
                    count: parseInt(f.elements['ir.count']?.value || '3', 10)
                },
                reminder_rule: { channels: window.PP.config?.default_channels || ['email'] }
            };
            try {
                await api.request('/payment-plans/plans', { method: 'POST', body: JSON.stringify(body) });
                toast.success?.('Plan created'); modal.close();
                window.PP.invalidate('payersCache');
                refresh(document.getElementById('tab-plans'));
            } catch (e) { toast.error?.(parseError(e)); }
        });
    }

    async function openEditModal(container, plan) {
        const modal = mkModal(`Edit ${window.PP.planLabel}`, `
            <form id="ppPlEditForm">
                <div class="pp-form-row"><label>Name</label><div><input name="name" value="${escapeAttr(plan.name)}"></div></div>
                <div class="pp-form-row"><label>Status</label><div><select name="status" id="ppPlEStatus"></select></div></div>
            </form>`);
        window.PP.loadStatusDefs('plan').then(defs => {
            const sel = modal.qs('#ppPlEStatus');
            sel.innerHTML = (defs || []).filter(d => d.is_active).map(d => `<option value="${d.status_key}" ${d.status_key === plan.status ? 'selected' : ''}>${escapeHtml(d.label)}</option>`).join('');
        });
        modal.onSave(async () => {
            const f = modal.qs('#ppPlEditForm');
            const body = {
                tenant_id: window.PP.tenantId,
                name: f.elements['name'].value.trim(),
                status: f.elements['status'].value
            };
            try {
                await api.request(`/payment-plans/plans/${plan.id}`, { method: 'PUT', body: JSON.stringify(body) });
                toast.success?.('Saved'); modal.close(); refresh(container);
            } catch (e) { toast.error?.(parseError(e)); }
        });
    }

    async function openViewModal(planId) {
        const modal = mkModal('Plan details', `<div id="ppPlView"><div class="pp-skeleton pp-skel-row"></div></div>`);
        try {
            const plan = await api.request(`/payment-plans/plans/${planId}?tenantId=${window.PP.tenantId}`);
            modal.qs('#ppPlView').innerHTML = `
                <h3 style="margin-top:0;">${escapeHtml(plan.name)}</h3>
                <p style="color:var(--text-secondary);font-size:13px;">Total ${fmt(plan.total_amount, plan.currency)} &middot; Paid ${fmt(plan.paid_amount, plan.currency)} &middot; ${escapeHtml(plan.status)}</p>
                <h4 style="font-size:13px;margin:14px 0 6px;">Installments</h4>
                <table class="table-cards-table">
                    <thead><tr><th>#</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Status</th></tr></thead>
                    <tbody>
                    ${(plan.installments || []).map(i => `
                        <tr><td>${i.sequence_no}</td><td>${(i.due_date || '').slice(0,10)}</td>
                        <td>${fmt(i.amount_due, plan.currency)}</td>
                        <td>${fmt(i.amount_paid, plan.currency)}</td>
                        <td><span class="pp-status">${escapeHtml(i.status)}</span></td></tr>`).join('')}
                    </tbody>
                </table>`;
        } catch (e) { modal.qs('#ppPlView').innerHTML = `<div class="pp-error">Failed: ${escapeHtml(e.message)}</div>`; }
    }

    function renderCFInput(f) {
        const req = f.is_required ? 'required' : '';
        const name = `cf_${f.field_key}`;
        let input;
        if (f.field_type === 'textarea') input = `<textarea name="${name}" ${req}></textarea>`;
        else if (f.field_type === 'number') input = `<input type="number" name="${name}" ${req}>`;
        else if (f.field_type === 'date') input = `<input type="date" name="${name}" ${req}>`;
        else if (f.field_type === 'boolean') input = `<label><input type="checkbox" name="${name}"> Yes</label>`;
        else if (f.field_type === 'dropdown') input = `<select name="${name}" ${req}><option value="">— Pick —</option>${(f.options || []).map(o => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label || o.value)}</option>`).join('')}</select>`;
        else if (f.field_type === 'multiselect') input = `<select name="${name}" ${req} multiple>${(f.options || []).map(o => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label || o.value)}</option>`).join('')}</select>`;
        else input = `<input name="${name}" ${req}>`;
        return `<div class="pp-form-row"><label>${escapeHtml(f.label)}${f.is_required ? ' *' : ''}</label><div>${input}${f.help_text ? `<div class="pp-hint">${escapeHtml(f.help_text)}</div>` : ''}</div></div>`;
    }

    function mkModal(title, body) {
        const m = document.createElement('div');
        m.className = 'gm-overlay active';
        m.innerHTML = `<div class="gm-modal gm-lg" style="max-width:640px;">
            <div class="gm-header"><h3>${escapeHtml(title)}</h3><button class="gm-close">&times;</button></div>
            <div class="gm-body">${body}</div>
            <div class="gm-footer"><button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="save">Save</button></div>
        </div>`;
        document.body.appendChild(m);
        const close = () => m.remove();
        m.querySelector('.gm-close').onclick = close;
        m.querySelector('[data-act=cancel]').onclick = close;
        m.addEventListener('click', e => { if (e.target === m) close(); });
        return { root: m, qs: s => m.querySelector(s), close, onSave: cb => m.querySelector('[data-act=save]').onclick = cb };
    }
    function pct(a, t) { if (!t) return 0; return Math.round((a/t) * 100); }
    function fmt(amt, cur) { const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[cur] || cur + ' '; return sym + Number(amt || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
    function parseError(e) { try { const b = e.responseBody && JSON.parse(e.responseBody); return b?.errors?.join('; ') || b?.error || e.message; } catch(_) { return e.message; } }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function escapeAttr(s) { return escapeHtml(s); }
})();
