// PaymentPlans — Status Definitions tab
// Per-entity status sets + transition graph. Seeded with defaults on first load.
(function () {
    'use strict';

    const ENTITY_TYPES = ['payer', 'plan', 'group', 'installment'];

    window.loadStatusDefinitionsTab = async function (container) {
        if (!container) container = document.getElementById('tab-status-definitions');
        if (container.dataset.rendered === '1') { await refresh(container); return; }
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Define the statuses each entity can have, plus the allowed transitions between them.
                    Education tenants might add <code>scholarship_granted</code>; gyms might add
                    <code>suspended</code>; B2B might add <code>under_review</code>.</p>
                <ul>
                    <li><strong>Terminal</strong> = cannot transition out.</li>
                    <li><strong>Default</strong> = used for newly created entities.</li>
                    <li><strong>Allowed transitions</strong> = empty means any move is allowed (unrestricted).</li>
                </ul>
            </details>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div>
                        <h2 class="pp-section-title">Status Definitions</h2>
                        <p class="pp-section-subtitle">Defaults are seeded automatically; customise per entity.</p>
                    </div>
                    <div class="pp-toolbar-right">
                        <select id="ppSDEntity" class="form-control" style="min-width:160px;">
                            ${ENTITY_TYPES.map(e => `<option value="${e}">${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}
                        </select>
                        <button class="btn btn-primary" id="ppSDAdd">+ Add Status</button>
                    </div>
                </div>
                <div id="ppSDList"></div>
            </div>
        `;
        container.querySelector('#ppSDEntity').addEventListener('change', () => refresh(container));
        container.querySelector('#ppSDAdd').addEventListener('click', () => openModal(container, null));
        await refresh(container);
    };

    async function refresh(container) {
        const entity = container.querySelector('#ppSDEntity').value;
        const list = container.querySelector('#ppSDList');
        list.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        try {
            const defs = await api.request(`/payment-plans/status-definitions?tenantId=${window.PP.tenantId}&entityType=${entity}&activeOnly=false`);
            if (!defs.length) {
                list.innerHTML = `<div class="pp-empty"><h3>No statuses defined</h3><p>Click <b>+ Add Status</b>.</p></div>`;
                return;
            }
            list.innerHTML = `
                <table class="table-cards-table">
                    <thead><tr><th>Order</th><th>Key</th><th>Label</th><th>Color</th><th>Terminal</th><th>Default</th><th>Transitions</th><th></th></tr></thead>
                    <tbody>
                    ${defs.map(d => `
                        <tr data-id="${d.id}">
                            <td>${d.display_order}</td>
                            <td><code>${escapeHtml(d.status_key)}</code></td>
                            <td><span class="pp-status" style="background:${d.color_hex}22;color:${d.color_hex};">${escapeHtml(d.label)}</span></td>
                            <td><span style="display:inline-block;width:18px;height:18px;background:${d.color_hex};border-radius:4px;vertical-align:middle;"></span> <code style="font-size:11px;">${d.color_hex}</code></td>
                            <td>${d.is_terminal ? '✓' : '—'}</td>
                            <td>${d.is_default ? '✓' : '—'}</td>
                            <td style="font-size:12px;">${(d.allowed_transitions || []).map(t => `<code>${escapeHtml(t)}</code>`).join(', ') || '<i style="color:var(--text-secondary)">unrestricted</i>'}</td>
                            <td>
                                <button class="btn btn-link pp-sd-edit" data-id="${d.id}">Edit</button>
                                <button class="btn btn-link pp-sd-del" data-id="${d.id}" style="color:var(--color-error,#dc2626)">Delete</button>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
            list.querySelectorAll('.pp-sd-edit').forEach(b => b.addEventListener('click', () => openModal(container, defs.find(d => d.id === b.dataset.id))));
            list.querySelectorAll('.pp-sd-del').forEach(b => b.addEventListener('click', async () => {
                if (!confirm('Delete this status? Existing rows using it will keep the key but bypass validation.')) return;
                try {
                    await api.request(`/payment-plans/status-definitions/${b.dataset.id}?tenantId=${window.PP.tenantId}`, { method: 'DELETE' });
                    toast.success?.('Deleted'); refresh(container);
                } catch (e) { toast.error?.(e.message); }
            }));
        } catch (e) {
            list.innerHTML = `<div class="pp-error">Failed: ${escapeHtml(e.message)}</div>`;
        }
    }

    function openModal(container, def) {
        const isEdit = !!def;
        const entity = container.querySelector('#ppSDEntity').value;
        const modal = document.createElement('div');
        modal.className = 'gm-overlay active';
        modal.innerHTML = `
            <div class="gm-modal gm-lg" style="max-width:520px;">
                <div class="gm-header"><h3>${isEdit ? 'Edit' : 'Add'} Status</h3><button class="gm-close">&times;</button></div>
                <div class="gm-body">
                    <form id="ppSDForm">
                        <div class="pp-form-row">
                            <label>Status key</label>
                            <div><input name="status_key" pattern="^[a-z][a-z0-9_]*$" required ${isEdit ? 'readonly' : ''}>
                                <div class="pp-hint">lowercase snake_case; immutable after creation.</div></div>
                        </div>
                        <div class="pp-form-row"><label>Label</label><div><input name="label" required></div></div>
                        <div class="pp-form-row">
                            <label>Color</label>
                            <div><input type="color" name="color_hex" value="#6b7280"></div>
                        </div>
                        <div class="pp-form-row">
                            <label>Terminal</label>
                            <div><label><input type="checkbox" name="is_terminal"> Cannot transition out of this</label></div>
                        </div>
                        <div class="pp-form-row">
                            <label>Default</label>
                            <div><label><input type="checkbox" name="is_default"> Used for new ${entity}s</label></div>
                        </div>
                        <div class="pp-form-row">
                            <label>Allowed transitions</label>
                            <div><input name="allowed_transitions" placeholder="active,inactive,dropped">
                                <div class="pp-hint">Comma-separated <code>status_key</code>s. Leave empty for unrestricted.</div></div>
                        </div>
                        <div class="pp-form-row"><label>Display order</label><div><input type="number" name="display_order" value="0"></div></div>
                        <div class="pp-form-row"><label>Active</label><div><label><input type="checkbox" name="is_active" checked> Use this status</label></div></div>
                    </form>
                </div>
                <div class="gm-footer">
                    <button class="btn btn-secondary" id="ppSDCancel">Cancel</button>
                    <button class="btn btn-primary" id="ppSDSave">${isEdit ? 'Save' : 'Add'}</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const form = modal.querySelector('#ppSDForm');
        if (isEdit) {
            form.elements['status_key'].value = def.status_key;
            form.elements['label'].value = def.label;
            form.elements['color_hex'].value = def.color_hex;
            form.elements['is_terminal'].checked = def.is_terminal;
            form.elements['is_default'].checked = def.is_default;
            form.elements['allowed_transitions'].value = (def.allowed_transitions || []).join(',');
            form.elements['display_order'].value = def.display_order;
            form.elements['is_active'].checked = def.is_active;
        }
        const close = () => modal.remove();
        modal.querySelector('.gm-close').onclick = close;
        modal.querySelector('#ppSDCancel').onclick = close;
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#ppSDSave').addEventListener('click', async () => {
            const body = {
                tenant_id: window.PP.tenantId,
                entity_type: entity,
                status_key: form.elements['status_key'].value.trim(),
                label: form.elements['label'].value.trim(),
                color_hex: form.elements['color_hex'].value,
                is_terminal: form.elements['is_terminal'].checked,
                is_default: form.elements['is_default'].checked,
                allowed_transitions: form.elements['allowed_transitions'].value.split(',').map(s => s.trim()).filter(Boolean),
                display_order: parseInt(form.elements['display_order'].value || '0', 10),
                is_active: form.elements['is_active'].checked
            };
            try {
                if (isEdit) await api.request(`/payment-plans/status-definitions/${def.id}`, { method: 'PUT', body: JSON.stringify(body) });
                else        await api.request('/payment-plans/status-definitions', { method: 'POST', body: JSON.stringify(body) });
                toast.success?.('Saved');
                close();
                refresh(container);
            } catch (e) {
                toast.error?.(parseError(e));
            }
        });
    }

    function parseError(e) {
        try { const b = e.responseBody && JSON.parse(e.responseBody); return b?.errors?.join('; ') || b?.error || e.message; }
        catch (_) { return e.message; }
    }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
})();
