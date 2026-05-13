// PaymentPlans — Custom Fields tab
// Define tenant-specific fields for payer / plan / installment / group.
(function () {
    'use strict';

    const ENTITY_TYPES = [
        { key: 'payer', label: 'Payer' },
        { key: 'plan',  label: 'Plan' },
        { key: 'group', label: 'Group' },
        { key: 'installment', label: 'Installment' }
    ];

    const FIELD_TYPES = [
        { v: 'text', l: 'Short text' },
        { v: 'textarea', l: 'Long text' },
        { v: 'number', l: 'Number' },
        { v: 'date', l: 'Date' },
        { v: 'boolean', l: 'Yes / No' },
        { v: 'dropdown', l: 'Dropdown (single)' },
        { v: 'multiselect', l: 'Multi-select' },
        { v: 'email', l: 'Email' },
        { v: 'phone', l: 'Phone' },
        { v: 'url', l: 'URL' }
    ];

    window.loadCustomFieldsTab = async function (container) {
        if (!container) container = document.getElementById('tab-custom-fields');
        if (container.dataset.rendered === '1') {
            await refresh(container);
            return;
        }
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Add your own fields to any entity. Education tenants typically add fields like
                    <code>course_code</code>, <code>batch_no</code>, <code>scholarship_pct</code>;
                    gyms add <code>membership_type</code>; construction adds <code>milestone_phase</code>.</p>
                <ul>
                    <li>Values are stored on the row's <code>metadata</code> JSON.</li>
                    <li>The frontend renders inputs based on these definitions automatically.</li>
                    <li>The backend validates incoming values against type + required + options.</li>
                </ul>
            </details>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div>
                        <h2 class="pp-section-title">Custom Fields</h2>
                        <p class="pp-section-subtitle">One set of definitions per entity, applied to all rows.</p>
                    </div>
                    <div class="pp-toolbar-right">
                        <select id="ppCFEntity" class="form-control" style="min-width:160px;">
                            ${ENTITY_TYPES.map(t => `<option value="${t.key}">${t.label}</option>`).join('')}
                        </select>
                        <button class="btn btn-primary" id="ppCFAdd">+ Add Field</button>
                    </div>
                </div>
                <div id="ppCFList"></div>
            </div>
        `;
        container.querySelector('#ppCFEntity').addEventListener('change', () => refresh(container));
        container.querySelector('#ppCFAdd').addEventListener('click', () => openModal(container, null));
        await refresh(container);
    };

    async function refresh(container) {
        const entity = container.querySelector('#ppCFEntity').value;
        const list = container.querySelector('#ppCFList');
        list.innerHTML = '<div class="pp-skeleton pp-skel-row"></div><div class="pp-skeleton pp-skel-row" style="width:70%"></div>';
        try {
            const defs = await api.request(
                `/payment-plans/custom-fields?tenantId=${window.PP.tenantId}&entityType=${entity}&activeOnly=false`);
            if (!defs.length) {
                list.innerHTML = `<div class="pp-empty">
                    <h3>No custom fields yet for ${entity}</h3>
                    <p>Click <b>+ Add Field</b> to add your first one.</p>
                </div>`;
                window.PP.invalidate('customFields');
                return;
            }
            list.innerHTML = `
                <table class="table-cards-table">
                    <thead><tr>
                        <th>Order</th><th>Key</th><th>Label</th><th>Type</th><th>Required</th><th>Active</th><th></th>
                    </tr></thead>
                    <tbody>
                    ${defs.map(d => `
                        <tr data-id="${d.id}">
                            <td>${d.display_order}</td>
                            <td><code>${escapeHtml(d.field_key)}</code></td>
                            <td>${escapeHtml(d.label)}</td>
                            <td>${FIELD_TYPES.find(t => t.v === d.field_type)?.l || d.field_type}</td>
                            <td>${d.is_required ? '✓' : '—'}</td>
                            <td>${d.is_active ? '✓' : '—'}</td>
                            <td>
                                <button class="btn btn-link pp-cf-edit" data-id="${d.id}">Edit</button>
                                <button class="btn btn-link pp-cf-del" data-id="${d.id}" style="color:var(--color-error,#dc2626)">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            `;
            list.querySelectorAll('.pp-cf-edit').forEach(b => b.addEventListener('click', () => {
                openModal(container, defs.find(d => d.id === b.dataset.id));
            }));
            list.querySelectorAll('.pp-cf-del').forEach(b => b.addEventListener('click', async () => {
                if (!confirm('Delete this field? Existing values stay on rows but won\'t be validated/displayed.')) return;
                try {
                    await api.request(`/payment-plans/custom-fields/${b.dataset.id}?tenantId=${window.PP.tenantId}`, { method: 'DELETE' });
                    toast.success?.('Deleted');
                    window.PP.invalidate('customFields');
                    refresh(container);
                } catch (e) { toast.error?.(e.message); }
            }));
            window.PP.invalidate('customFields');
        } catch (e) {
            list.innerHTML = `<div class="pp-error">Failed to load: ${escapeHtml(e.message)}</div>`;
        }
    }

    function openModal(container, def) {
        const isEdit = !!def;
        const entity = container.querySelector('#ppCFEntity').value;
        const modal = document.createElement('div');
        modal.className = 'gm-overlay active';
        modal.innerHTML = `
            <div class="gm-modal gm-lg" style="max-width:560px;">
                <div class="gm-header">
                    <h3>${isEdit ? 'Edit' : 'Add'} Custom Field</h3>
                    <button class="gm-close" type="button">&times;</button>
                </div>
                <div class="gm-body">
                    <details class="pp-helper">
                        <summary>How does this work?</summary>
                        <p><strong>Field key</strong> is the JSON key stored on metadata (snake_case only).
                            It can't change after creation. <strong>Label</strong> is what users see.</p>
                    </details>
                    <form id="ppCFForm">
                        <div class="pp-form-row">
                            <label>Field key</label>
                            <div>
                                <input name="field_key" placeholder="course_code" pattern="^[a-z][a-z0-9_]*$" required ${isEdit ? 'readonly' : ''}>
                                <div class="pp-hint">lowercase letters, digits, underscores; must start with a letter.</div>
                            </div>
                        </div>
                        <div class="pp-form-row">
                            <label>Label</label>
                            <div><input name="label" required placeholder="Course Code"></div>
                        </div>
                        <div class="pp-form-row">
                            <label>Field type</label>
                            <div>
                                <select name="field_type">
                                    ${FIELD_TYPES.map(t => `<option value="${t.v}">${t.l}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="pp-form-row" id="ppCFOptionsRow" style="display:none;">
                            <label>Options</label>
                            <div>
                                <textarea name="options" rows="4" placeholder="one per line:&#10;cs=Computer Science&#10;ee=Electrical"></textarea>
                                <div class="pp-hint">Format: <code>value=label</code>, one per line.</div>
                            </div>
                        </div>
                        <div class="pp-form-row">
                            <label>Required</label>
                            <div><label><input type="checkbox" name="is_required"> Field must be set on create</label></div>
                        </div>
                        <div class="pp-form-row">
                            <label>Placeholder</label>
                            <div><input name="placeholder" placeholder="e.g. CC-B1"></div>
                        </div>
                        <div class="pp-form-row">
                            <label>Help text</label>
                            <div><input name="help_text" placeholder="Shown below the input"></div>
                        </div>
                        <div class="pp-form-row">
                            <label>Display order</label>
                            <div><input type="number" name="display_order" value="0"></div>
                        </div>
                        <div class="pp-form-row">
                            <label>Active</label>
                            <div><label><input type="checkbox" name="is_active" checked> Use this field</label></div>
                        </div>
                    </form>
                </div>
                <div class="gm-footer">
                    <button class="btn btn-secondary" type="button" id="ppCFCancel">Cancel</button>
                    <button class="btn btn-primary" type="button" id="ppCFSave">${isEdit ? 'Save' : 'Add'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const form = modal.querySelector('#ppCFForm');
        if (isEdit) {
            form.elements['field_key'].value = def.field_key;
            form.elements['label'].value = def.label;
            form.elements['field_type'].value = def.field_type;
            form.elements['is_required'].checked = def.is_required;
            form.elements['placeholder'].value = def.placeholder || '';
            form.elements['help_text'].value = def.help_text || '';
            form.elements['display_order'].value = def.display_order;
            form.elements['is_active'].checked = def.is_active;
            if (def.options) {
                form.elements['options'].value = (def.options || [])
                    .map(o => `${o.value}=${o.label || o.value}`).join('\n');
            }
        }
        const updateOpts = () => {
            const ft = form.elements['field_type'].value;
            modal.querySelector('#ppCFOptionsRow').style.display =
                (ft === 'dropdown' || ft === 'multiselect') ? '' : 'none';
        };
        form.elements['field_type'].addEventListener('change', updateOpts);
        updateOpts();

        const close = () => modal.remove();
        modal.querySelector('.gm-close').onclick = close;
        modal.querySelector('#ppCFCancel').onclick = close;
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        modal.querySelector('#ppCFSave').addEventListener('click', async () => {
            const body = {
                tenant_id: window.PP.tenantId,
                entity_type: entity,
                field_key: form.elements['field_key'].value.trim(),
                label: form.elements['label'].value.trim(),
                field_type: form.elements['field_type'].value,
                is_required: form.elements['is_required'].checked,
                placeholder: form.elements['placeholder'].value.trim() || null,
                help_text: form.elements['help_text'].value.trim() || null,
                display_order: parseInt(form.elements['display_order'].value || '0', 10),
                is_active: form.elements['is_active'].checked
            };
            const optsRaw = (form.elements['options'].value || '').trim();
            if (body.field_type === 'dropdown' || body.field_type === 'multiselect') {
                body.options = optsRaw.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
                    const [v, ...rest] = line.split('=');
                    return { value: v.trim(), label: (rest.join('=') || v).trim() };
                });
                if (!body.options.length) { toast.error?.('Add at least one option'); return; }
            }
            try {
                if (isEdit) {
                    await api.request(`/payment-plans/custom-fields/${def.id}`, { method: 'PUT', body: JSON.stringify(body) });
                } else {
                    await api.request('/payment-plans/custom-fields', { method: 'POST', body: JSON.stringify(body) });
                }
                toast.success?.('Saved');
                close();
                refresh(container);
            } catch (e) {
                toast.error?.(parseError(e));
            }
        });
    }

    function parseError(e) {
        try {
            const body = e.responseBody && JSON.parse(e.responseBody);
            if (body?.errors?.length) return body.errors.join('; ');
            if (body?.error) return body.error;
        } catch (_) {}
        return e.message || 'Failed';
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
})();
