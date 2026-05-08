/**
 * Settings → Lead Fields tab.
 *
 * Tenant admins define dropdown attributes (Potential, Brochure Sent, etc.)
 * here. The same definitions drive three things in the rest of the app:
 *   1) the activity log modal (sales rep picks values when logging a call),
 *   2) the leads filter bar (managers slice the list by any combination),
 *   3) the leads table column (the value renders as a colored badge).
 *
 * Field code is permanent once set so backend lookups by JSONB key stay
 * stable across renames. Label and option colors can change any time.
 *
 * Soft-delete: if any leads currently use a field/option, the API
 * archives instead of hard-deleting, so historical values still resolve
 * to a label. The dialog warns when this is about to happen.
 */
(function () {
    'use strict';

    // Cached list, refreshed on every loadLeadFieldsTab() call.
    let _fields = [];
    // Used by the editor modal: the field being edited (null = create).
    let _editing = null;
    // Build-up of options inside the editor modal — separate from
    // _editing.options because we may add/remove rows before saving.
    let _draftOptions = [];

    // ─── Settings tab entry point ───────────────────────────────────────────

    window.loadLeadFieldsTab = async function () {
        const loadingEl = document.getElementById('leadFieldsLoading');
        const listEl = document.getElementById('leadFieldsList');
        const emptyEl = document.getElementById('leadFieldsEmptyState');
        if (!listEl) return;

        loadingEl && (loadingEl.style.display = '');
        listEl.innerHTML = '';
        emptyEl && (emptyEl.style.display = 'none');

        try {
            // Admin endpoint includes inactive rows so admins can re-enable
            // a field they previously archived.
            const resp = await api.request('/crm-admin/lead-fields?includeInactive=true');
            _fields = (resp && resp.fields) ? resp.fields : [];
        } catch (err) {
            console.error('[lead-fields] list failed:', err);
            if (typeof Toast !== 'undefined') Toast.error('Failed to load lead fields');
            _fields = [];
        }

        loadingEl && (loadingEl.style.display = 'none');
        if (_fields.length === 0) {
            emptyEl && (emptyEl.style.display = '');
            return;
        }
        renderLeadFields();
    };

    function renderLeadFields() {
        const listEl = document.getElementById('leadFieldsList');
        if (!listEl) return;
        listEl.innerHTML = _fields.map(renderLeadFieldRow).join('');
    }

    function renderLeadFieldRow(f) {
        const optionsHtml = (f.options || []).map(o => {
            const swatch = o.color
                ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeAttr(o.color)};margin-right:4px;vertical-align:middle;"></span>`
                : '';
            const dim = o.is_active ? '' : 'opacity:0.5;text-decoration:line-through;';
            return `<span class="lf-pill" style="${dim}">${swatch}${escapeHtml(o.label)}</span>`;
        }).join('');

        const visBadges = [
            f.show_in_activity_log ? 'Activity Log' : null,
            f.show_in_lead_filter  ? 'Filter'        : null,
            f.show_in_leads_table  ? 'Table'         : null,
        ].filter(Boolean).map(t => `<span class="lf-vis-badge">${t}</span>`).join('');

        const archived = !f.is_active
            ? `<span class="lf-archived-badge" title="Archived — historical values still resolve, but the dropdown is hidden everywhere">Archived</span>`
            : '';

        return `
            <div class="lf-card">
                <div class="lf-card-header">
                    <div>
                        <div class="lf-card-title">
                            ${escapeHtml(f.label)}
                            ${archived}
                            <span class="lf-code">${escapeHtml(f.code)}</span>
                        </div>
                        ${f.description ? `<div class="lf-card-desc">${escapeHtml(f.description)}</div>` : ''}
                        <div class="lf-vis-row">${visBadges}</div>
                    </div>
                    <div class="lf-card-actions">
                        <button class="btn btn-outline btn-sm" onclick="openEditLeadFieldModal('${f.id}')">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="askDeleteLeadField('${f.id}')">Delete</button>
                    </div>
                </div>
                <div class="lf-options-row">
                    ${optionsHtml || '<span style="color:var(--text-secondary); font-size:0.85rem;">No options yet.</span>'}
                </div>
            </div>
        `;
    }

    // ─── Modal: create / edit field ─────────────────────────────────────────

    window.openCreateLeadFieldModal = function () {
        _editing = null;
        _draftOptions = [];
        document.getElementById('leadFieldModalTitle').textContent = 'Add Field';
        const codeEl = document.getElementById('lfCode');
        codeEl.value = '';
        codeEl.disabled = false;
        document.getElementById('lfFieldId').value = '';
        document.getElementById('lfLabel').value = '';
        document.getElementById('lfDescription').value = '';
        document.getElementById('lfShowAct').checked = true;
        document.getElementById('lfShowFil').checked = true;
        document.getElementById('lfShowTab').checked = true;
        renderDraftOptions();
        if (typeof openModal === 'function') openModal('leadFieldModal');
        else document.getElementById('leadFieldModal').classList.add('active');
    };

    window.openEditLeadFieldModal = function (id) {
        const f = _fields.find(x => x.id === id);
        if (!f) return;
        _editing = f;
        _draftOptions = (f.options || []).map(o => ({ ...o, _existing: true }));
        document.getElementById('leadFieldModalTitle').textContent = 'Edit Field';
        const codeEl = document.getElementById('lfCode');
        codeEl.value = f.code;
        codeEl.disabled = true;   // immutable on edit
        document.getElementById('lfFieldId').value = f.id;
        document.getElementById('lfLabel').value = f.label;
        document.getElementById('lfDescription').value = f.description || '';
        document.getElementById('lfShowAct').checked = !!f.show_in_activity_log;
        document.getElementById('lfShowFil').checked = !!f.show_in_lead_filter;
        document.getElementById('lfShowTab').checked = !!f.show_in_leads_table;
        renderDraftOptions();
        if (typeof openModal === 'function') openModal('leadFieldModal');
        else document.getElementById('leadFieldModal').classList.add('active');
    };

    window.closeLeadFieldModal = function () {
        if (typeof closeModal === 'function') closeModal('leadFieldModal');
        else document.getElementById('leadFieldModal').classList.remove('active');
    };

    window.addOptionRow = function () {
        _draftOptions.push({
            id: null,
            code: '',
            label: '',
            color: '#10b981',
            is_active: true,
            is_default: false,
            sort_order: _draftOptions.length,
            _existing: false,
        });
        renderDraftOptions();
    };

    window.removeOptionRow = function (idx) {
        const opt = _draftOptions[idx];
        if (!opt) return;
        if (opt._existing) {
            // Existing option → mark inactive (server will soft-delete if any
            // leads use it, hard-delete otherwise). We still take it off the
            // visible draft so the user knows it'll be removed on save.
            opt._tombstone = true;
        }
        _draftOptions.splice(idx, 1);
        renderDraftOptions();
    };

    function renderDraftOptions() {
        const wrap = document.getElementById('lfOptionsList');
        if (!wrap) return;
        if (_draftOptions.length === 0) {
            wrap.innerHTML = `<div style="padding:12px; color:var(--text-secondary); font-size:0.88rem;">No options yet — click "Add option" to add one.</div>`;
            return;
        }
        wrap.innerHTML = _draftOptions.map((o, i) => `
            <div class="lf-opt-row">
                <input type="color" value="${escapeAttr(o.color || '#10b981')}"
                       data-i="${i}" data-k="color" class="lf-opt-color">
                <input type="text" placeholder="code (e.g. mid)"
                       value="${escapeAttr(o.code)}"
                       data-i="${i}" data-k="code"
                       class="form-control lf-opt-input"
                       ${o._existing ? 'readonly title="Code is permanent once saved"' : ''}>
                <input type="text" placeholder="label (e.g. Mid)"
                       value="${escapeAttr(o.label)}"
                       data-i="${i}" data-k="label"
                       class="form-control lf-opt-input">
                <label class="lf-opt-default">
                    <input type="checkbox" data-i="${i}" data-k="is_default" ${o.is_default ? 'checked' : ''}>
                    Default
                </label>
                <button type="button" class="btn btn-icon btn-danger btn-sm" onclick="removeOptionRow(${i})" title="Remove">×</button>
            </div>
        `).join('');

        // Wire change events for inputs (fewer event listeners than inline).
        wrap.querySelectorAll('input').forEach(el => {
            el.addEventListener(el.type === 'color' ? 'input' : 'change', e => {
                const i = parseInt(el.getAttribute('data-i'), 10);
                const k = el.getAttribute('data-k');
                if (Number.isNaN(i) || !_draftOptions[i]) return;
                if (el.type === 'checkbox') _draftOptions[i][k] = el.checked;
                else _draftOptions[i][k] = el.value;
            });
        });
    }

    window.saveLeadField = async function () {
        const code = document.getElementById('lfCode').value.trim();
        const label = document.getElementById('lfLabel').value.trim();
        const description = document.getElementById('lfDescription').value.trim();
        const showAct = document.getElementById('lfShowAct').checked;
        const showFil = document.getElementById('lfShowFil').checked;
        const showTab = document.getElementById('lfShowTab').checked;
        if (!label) { Toast?.error('Label is required'); return; }

        const saveBtn = document.getElementById('lfSaveBtn');
        saveBtn && (saveBtn.disabled = true);
        try {
            if (_editing) {
                // 1) Patch the field.
                await api.request(`/crm-admin/lead-fields/${_editing.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        label, description: description || null,
                        show_in_activity_log: showAct,
                        show_in_lead_filter: showFil,
                        show_in_leads_table: showTab,
                    }),
                });
                // 2) Sync options. Existing options that disappeared from
                // _draftOptions need explicit DELETE; new rows are POST;
                // mutated existing rows are PUT. We do this naively row by
                // row — fine for typical handfuls of options.
                const beforeIds = new Set((_editing.options || []).map(o => o.id));
                const keepIds = new Set();
                for (let i = 0; i < _draftOptions.length; i++) {
                    const o = _draftOptions[i];
                    if (!o.code || !o.label) continue;
                    if (o._existing && o.id) {
                        keepIds.add(o.id);
                        await api.request(`/crm-admin/lead-fields/${_editing.id}/options/${o.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({
                                label: o.label, color: o.color || null,
                                is_default: !!o.is_default,
                                sort_order: i,
                            }),
                        });
                    } else {
                        await api.request(`/crm-admin/lead-fields/${_editing.id}/options`, {
                            method: 'POST',
                            body: JSON.stringify({
                                code: o.code, label: o.label, color: o.color || null,
                                is_default: !!o.is_default,
                                sort_order: i,
                            }),
                        });
                    }
                }
                // Delete options removed from the draft.
                for (const oldId of beforeIds) {
                    if (!keepIds.has(oldId)) {
                        await api.request(`/crm-admin/lead-fields/${_editing.id}/options/${oldId}`, {
                            method: 'DELETE',
                        });
                    }
                }
            } else {
                if (!code) { Toast?.error('Code is required'); return; }
                await api.request('/crm-admin/lead-fields', {
                    method: 'POST',
                    body: JSON.stringify({
                        code, label, description: description || null,
                        is_multi_select: false,
                        show_in_activity_log: showAct,
                        show_in_lead_filter: showFil,
                        show_in_leads_table: showTab,
                        sort_order: _fields.length,
                        options: _draftOptions
                            .filter(o => o.code && o.label)
                            .map((o, i) => ({
                                code: o.code, label: o.label, color: o.color || null,
                                is_default: !!o.is_default,
                                sort_order: i,
                            })),
                    }),
                });
            }
            Toast?.success(_editing ? 'Field updated' : 'Field created');
            closeLeadFieldModal();
            await loadLeadFieldsTab();
        } catch (err) {
            console.error('[lead-fields] save failed:', err);
            Toast?.error(err?.message || 'Save failed');
        } finally {
            saveBtn && (saveBtn.disabled = false);
        }
    };

    // ─── Delete ──────────────────────────────────────────────────────────────

    let _pendingDeleteId = null;

    window.askDeleteLeadField = function (id) {
        const f = _fields.find(x => x.id === id);
        if (!f) return;
        _pendingDeleteId = id;
        document.getElementById('lfDeleteBody').textContent =
            `Remove "${f.label}"?`;
        document.getElementById('lfDeleteHint').textContent =
            `If any leads currently have a value for this field, it will be archived (hidden) instead of permanently deleted, so historical values still resolve to their label.`;
        if (typeof openModal === 'function') openModal('leadFieldDeleteModal');
        else document.getElementById('leadFieldDeleteModal').classList.add('active');
    };

    window.closeLeadFieldDeleteModal = function () {
        if (typeof closeModal === 'function') closeModal('leadFieldDeleteModal');
        else document.getElementById('leadFieldDeleteModal').classList.remove('active');
    };

    window.confirmDeleteLeadField = async function () {
        const id = _pendingDeleteId;
        _pendingDeleteId = null;
        if (!id) return;
        try {
            const resp = await api.request(`/crm-admin/lead-fields/${id}`, { method: 'DELETE' });
            if (resp?.archived) Toast?.warning(`Archived — ${resp.leads_affected} lead${resp.leads_affected === 1 ? '' : 's'} still reference this field.`);
            else Toast?.success('Field deleted');
            closeLeadFieldDeleteModal();
            await loadLeadFieldsTab();
        } catch (err) {
            console.error('[lead-fields] delete failed:', err);
            Toast?.error(err?.message || 'Delete failed');
        }
    };

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }
    function escapeAttr(s) {
        return String(s ?? '').replace(/"/g, '&quot;');
    }
})();
