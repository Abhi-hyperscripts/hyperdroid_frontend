// PaymentPlans — Plan Templates tab
// Reusable plan shapes: installment_rule + reminder_rule defaults.
(function () {
    'use strict';

    window.loadPlanTemplatesTab = async function (container) {
        if (!container) container = document.getElementById('tab-plan-templates');
        if (container.dataset.rendered === '1') { await refresh(container); return; }
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Templates let you stamp out the same plan shape for many payers.
                    Define the installment cadence and reminder rules once, then bulk-instantiate
                    for an entire cohort.</p>
            </details>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div><h2 class="pp-section-title">Plan Templates</h2></div>
                    <button class="btn btn-primary" id="ppPTAdd">+ Add Template</button>
                </div>
                <div id="ppPTList"></div>
            </div>`;
        container.querySelector('#ppPTAdd').addEventListener('click', () => openModal(container, null));
        await refresh(container);
    };

    async function refresh(container) {
        const list = container.querySelector('#ppPTList');
        list.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        try {
            const tpls = await api.request(`/payment-plans/plan-templates?tenantId=${window.PP.tenantId}`);
            if (!tpls.length) { list.innerHTML = `<div class="pp-empty"><h3>No templates yet</h3></div>`; window.PP.planTemplates = []; return; }
            window.PP.planTemplates = tpls;
            list.innerHTML = `
                <table class="table-cards-table">
                    <thead><tr><th>Name</th><th>Currency</th><th>Default Total</th><th>Installments</th><th>Channels</th><th></th></tr></thead>
                    <tbody>
                    ${tpls.map(t => `
                        <tr data-id="${t.id}">
                            <td><b>${escapeHtml(t.name)}</b></td>
                            <td>${t.currency}</td>
                            <td>${fmt(t.default_total_amount, t.currency)}</td>
                            <td>${describeRule(t.installment_rule)}</td>
                            <td>${(t.reminder_rule?.channels || []).join(', ') || '—'}</td>
                            <td>
                                <button class="btn btn-link pp-pt-edit" data-id="${t.id}">Edit</button>
                                <button class="btn btn-link pp-pt-inst" data-id="${t.id}">Instantiate</button>
                                <button class="btn btn-link pp-pt-del" data-id="${t.id}" style="color:var(--color-error,#dc2626)">Delete</button>
                            </td>
                        </tr>`).join('')}
                    </tbody></table>`;
            list.querySelectorAll('.pp-pt-edit').forEach(b => b.addEventListener('click', () => openModal(container, tpls.find(t => t.id === b.dataset.id))));
            list.querySelectorAll('.pp-pt-inst').forEach(b => b.addEventListener('click', () => openInstantiate(container, tpls.find(t => t.id === b.dataset.id))));
            list.querySelectorAll('.pp-pt-del').forEach(b => b.addEventListener('click', async () => {
                if (!confirm('Delete this template? Existing plans linked to it stay.')) return;
                await api.request(`/payment-plans/plan-templates/${b.dataset.id}?tenantId=${window.PP.tenantId}`, { method: 'DELETE' });
                toast.success?.('Deleted'); refresh(container);
            }));
        } catch (e) {
            list.innerHTML = `<div class="pp-error">Failed: ${escapeHtml(e.message)}</div>`;
        }
    }

    function openModal(container, t) {
        const isEdit = !!t;
        const modal = document.createElement('div');
        modal.className = 'gm-overlay active';
        modal.innerHTML = `
            <div class="gm-modal gm-lg" style="max-width:640px;">
                <div class="gm-header"><h3>${isEdit ? 'Edit' : 'Add'} Template</h3><button class="gm-close">&times;</button></div>
                <div class="gm-body">
                    <form id="ppPTForm">
                        <div class="pp-form-row"><label>Name</label><div><input name="name" required></div></div>
                        <div class="pp-form-row"><label>Currency</label><div><input name="currency" value="INR" maxlength="3"></div></div>
                        <div class="pp-form-row"><label>Default total</label><div><input type="number" name="default_total_amount" step="0.01" min="0" value="0"></div></div>
                        <h4 style="font-size:13px;margin:20px 0 8px;">Installment rule</h4>
                        <div class="pp-form-row"><label>Cadence</label>
                            <div>
                                <select name="ir.kind">
                                    <option value="monthly">Monthly equal installments</option>
                                    <option value="fixed_schedule">Fixed schedule (per-payer dates)</option>
                                    <option value="milestone">Milestone (manual)</option>
                                    <option value="per_invoice">Per invoice (Net-N)</option>
                                </select>
                            </div>
                        </div>
                        <div class="pp-form-row ir-monthly"><label>Number of installments</label><div><input type="number" name="ir.count" min="1" value="3"></div></div>
                        <div class="pp-form-row ir-monthly"><label>Day of month</label><div><input type="number" name="ir.day_of_month" min="1" max="31" value="1"></div></div>
                        <h4 style="font-size:13px;margin:20px 0 8px;">Reminder rule</h4>
                        <div class="pp-form-row"><label>Pre-due offsets (days)</label><div><input name="rr.pre_due" value="10,3,0" placeholder="e.g. 10,3,0"><div class="pp-hint">Days before due to send a reminder.</div></div></div>
                        <div class="pp-form-row"><label>Post-due cadence</label>
                            <div><select name="rr.post_due_mode">
                                <option value="none">None</option>
                                <option value="daily_until_paid">Daily until paid</option>
                                <option value="every_n_days">Every N days</option>
                                <option value="after_n_days">Once after N days</option>
                            </select></div>
                        </div>
                        <div class="pp-form-row"><label>Post-due horizon</label><div><input type="number" name="rr.horizon" value="60"><div class="pp-hint">Stop firing after this many days past due.</div></div></div>
                        <div class="pp-form-row"><label>Escalation offsets</label><div><input name="rr.escalation" placeholder="10,15,20"><div class="pp-hint">Days after due to escalate (different template / channel).</div></div></div>
                        <div class="pp-form-row"><label>Local time</label><div><input name="rr.local_time" value="09:00"></div></div>
                        <div class="pp-form-row"><label>Channels</label>
                            <div style="display:flex;gap:14px;flex-wrap:wrap;">
                                <label style="font-weight:400"><input type="checkbox" name="rr.ch.email" checked> Email</label>
                                <label style="font-weight:400"><input type="checkbox" name="rr.ch.whatsapp"> WhatsApp</label>
                                <label style="font-weight:400"><input type="checkbox" name="rr.ch.sms"> SMS</label>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="gm-footer">
                    <button class="btn btn-secondary" id="ppPTCancel">Cancel</button>
                    <button class="btn btn-primary" id="ppPTSave">${isEdit ? 'Save' : 'Add'}</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const form = modal.querySelector('#ppPTForm');
        if (isEdit) {
            form.elements['name'].value = t.name;
            form.elements['currency'].value = t.currency;
            form.elements['default_total_amount'].value = t.default_total_amount;
            form.elements['ir.kind'].value = t.installment_rule?.kind || 'monthly';
            form.elements['ir.count'].value = t.installment_rule?.count || 3;
            form.elements['ir.day_of_month'].value = t.installment_rule?.day_of_month || 1;
            form.elements['rr.pre_due'].value = (t.reminder_rule?.pre_due_offsets_days || []).join(',');
            form.elements['rr.post_due_mode'].value = t.reminder_rule?.post_due_mode || 'daily_until_paid';
            form.elements['rr.horizon'].value = t.reminder_rule?.post_due_horizon_days || 60;
            form.elements['rr.escalation'].value = (t.reminder_rule?.escalation_offsets_days || []).join(',');
            form.elements['rr.local_time'].value = t.reminder_rule?.local_time || '09:00';
            const ch = t.reminder_rule?.channels || [];
            form.elements['rr.ch.email'].checked = ch.includes('email');
            form.elements['rr.ch.whatsapp'].checked = ch.includes('whatsapp');
            form.elements['rr.ch.sms'].checked = ch.includes('sms');
        }
        const showMonthly = () => {
            const isMonthly = form.elements['ir.kind'].value === 'monthly';
            modal.querySelectorAll('.ir-monthly').forEach(r => r.style.display = isMonthly ? '' : 'none');
        };
        form.elements['ir.kind'].addEventListener('change', showMonthly); showMonthly();

        const close = () => modal.remove();
        modal.querySelector('.gm-close').onclick = close;
        modal.querySelector('#ppPTCancel').onclick = close;
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#ppPTSave').addEventListener('click', async () => {
            const ch = [];
            if (form.elements['rr.ch.email'].checked) ch.push('email');
            if (form.elements['rr.ch.whatsapp'].checked) ch.push('whatsapp');
            if (form.elements['rr.ch.sms'].checked) ch.push('sms');
            const body = {
                tenant_id: window.PP.tenantId,
                name: form.elements['name'].value.trim(),
                currency: (form.elements['currency'].value || 'INR').toUpperCase().slice(0,3),
                default_total_amount: parseFloat(form.elements['default_total_amount'].value || '0'),
                installment_rule: {
                    kind: form.elements['ir.kind'].value,
                    count: parseInt(form.elements['ir.count'].value || '3', 10),
                    day_of_month: parseInt(form.elements['ir.day_of_month'].value || '1', 10)
                },
                reminder_rule: {
                    pre_due_offsets_days: parseList(form.elements['rr.pre_due'].value, true),
                    post_due_mode: form.elements['rr.post_due_mode'].value,
                    post_due_horizon_days: parseInt(form.elements['rr.horizon'].value || '60', 10),
                    escalation_offsets_days: parseList(form.elements['rr.escalation'].value, true),
                    local_time: form.elements['rr.local_time'].value,
                    timezone: window.PP.config?.default_timezone || 'Asia/Kolkata',
                    channels: ch
                }
            };
            try {
                if (isEdit) await api.request(`/payment-plans/plan-templates/${t.id}`, { method: 'PUT', body: JSON.stringify(body) });
                else        await api.request('/payment-plans/plan-templates', { method: 'POST', body: JSON.stringify(body) });
                toast.success?.('Saved'); close(); refresh(container);
            } catch (e) { toast.error?.(parseError(e)); }
        });
    }

    function openInstantiate(container, t) {
        const modal = document.createElement('div');
        modal.className = 'gm-overlay active';
        modal.innerHTML = `
            <div class="gm-modal gm-lg" style="max-width:560px;">
                <div class="gm-header"><h3>Instantiate plans from <i>${escapeHtml(t.name)}</i></h3><button class="gm-close">&times;</button></div>
                <div class="gm-body">
                    <details class="pp-helper"><summary>How does this work?</summary>
                        <p>Pick the payers and we'll create one plan for each, using the template's defaults.</p></details>
                    <div id="ppPTInstPayers"><div class="pp-skeleton pp-skel-row"></div></div>
                </div>
                <div class="gm-footer">
                    <button class="btn btn-secondary" id="ppInstCancel">Cancel</button>
                    <button class="btn btn-primary" id="ppInstGo">Create plans</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector('.gm-close').onclick = close;
        modal.querySelector('#ppInstCancel').onclick = close;

        api.request(`/payment-plans/payers?tenantId=${window.PP.tenantId}&limit=200`).then(payers => {
            const target = modal.querySelector('#ppPTInstPayers');
            if (!payers.length) { target.innerHTML = `<div class="pp-empty"><p>No payers yet. Create some first under <b>Cohorts & Payers</b>.</p></div>`; return; }
            target.innerHTML = `
                <p style="font-size:13px;color:var(--text-secondary);">Select payers (${payers.length}):</p>
                <div style="max-height:300px;overflow:auto;border:1px solid var(--border-color);border-radius:8px;padding:8px;">
                    ${payers.map(p => `<label style="display:flex;gap:8px;padding:4px 6px;font-weight:400;">
                        <input type="checkbox" class="pp-inst-payer" value="${p.id}">
                        <span>${escapeHtml(p.display_name)} <small style="color:var(--text-secondary)">${escapeHtml(p.email || '')}</small></span>
                    </label>`).join('')}
                </div>`;
        });

        modal.querySelector('#ppInstGo').addEventListener('click', async () => {
            const ids = Array.from(modal.querySelectorAll('.pp-inst-payer:checked')).map(i => i.value);
            if (!ids.length) { toast.error?.('Pick at least one payer'); return; }
            try {
                const r = await api.request(`/payment-plans/plan-templates/${t.id}/instantiate`, {
                    method: 'POST',
                    body: JSON.stringify({ tenant_id: window.PP.tenantId, template_id: t.id, payer_ids: ids })
                });
                const ok = (r.outcomes || []).filter(o => o.success).length;
                const fail = (r.outcomes || []).filter(o => !o.success);
                toast.success?.(`Created ${ok} plan${ok === 1 ? '' : 's'}${fail.length ? `, ${fail.length} failed` : ''}`);
                close();
            } catch (e) { toast.error?.(parseError(e)); }
        });
    }

    function describeRule(r) {
        if (!r) return '—';
        if (r.kind === 'monthly') return `${r.count || '?'} × monthly`;
        if (r.kind === 'fixed_schedule') return `Fixed schedule`;
        if (r.kind === 'milestone') return `Milestone-driven`;
        if (r.kind === 'per_invoice') return `Per invoice (Net-N)`;
        return r.kind;
    }
    function parseList(s, num) {
        return (s || '').split(',').map(x => x.trim()).filter(Boolean).map(x => num ? parseInt(x, 10) : x).filter(x => !isNaN(x));
    }
    function fmt(amt, cur) {
        const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[cur] || cur + ' ';
        return sym + Number(amt || 0).toLocaleString();
    }
    function parseError(e) { try { const b = e.responseBody && JSON.parse(e.responseBody); return b?.errors?.join('; ') || b?.error || e.message; } catch(_) { return e.message; } }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
})();
