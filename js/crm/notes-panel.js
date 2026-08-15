/**
 * Notes panel — reusable across leads, deals, contacts and companies
 * ----------------------------------------------------------------------------
 * A note could be written (the deal form posts one on save) and then never seen
 * again: nothing in the app listed, edited, pinned or deleted them. This mounts
 * a full notes panel onto any entity detail view.
 *
 *   GET    /api/Notes?entityType=&entityId=   list
 *   POST   /api/Notes                          add
 *   PUT    /api/Notes/{id}                     edit
 *   POST   /api/Notes/{id}/pin                 toggle pin
 *   DELETE /api/Notes/{id}                     remove
 *
 * Usage:  NotesPanel.mount(document.getElementById('dealNotesPanel'), 'deal', dealId);
 *
 * Responses are snake_case (the API's SnakeCaseLower policy), so fields are read
 * as is_pinned / created_at / created_by_user_id.
 */
const NotesPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // one state object per mounted container
    const mounted = new WeakMap();

    function relativeTime(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const mins = Math.round((Date.now() - d.getTime()) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.round(hrs / 24);
        if (days < 30) return `${days}d ago`;
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function shell(state) {
        return `
        <div class="ntp">
            <div class="ntp-head">
                <h4 class="ntp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    Notes
                </h4>
                <span class="ntp-count" data-ntp="count"></span>
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Notes</summary>
                <div class="crm-help-body">
                    <p>Free-text notes attached to this record — what was agreed on a call, why a
                       price changed, anything the next person needs. Everyone on the team sees them.</p>
                    <p><em>Tip: pin the one note that matters most and it stays at the top.</em></p>
                </div>
            </details>

            <div class="ntp-compose">
                <textarea data-ntp="input" rows="2" placeholder="Add a note…"></textarea>
                <div class="ntp-compose-actions">
                    <span class="ntp-hint">Saved to this ${esc(state.entityLabel)} for the whole team.</span>
                    <button type="button" class="btn btn-sm btn-primary" data-ntp="add">Add note</button>
                </div>
            </div>

            <div data-ntp="list" class="ntp-list"></div>
        </div>`;
    }

    function noteMarkup(n) {
        const id = esc(n.id);
        const pinned = !!n.is_pinned;
        return `
        <article class="ntp-item${pinned ? ' is-pinned' : ''}" data-note-id="${id}">
            <div class="ntp-item-body" data-ntp-view="${id}">${esc(n.content)}</div>
            <textarea class="ntp-item-edit" data-ntp-edit="${id}" hidden>${esc(n.content)}</textarea>
            <div class="ntp-item-foot">
                <span class="ntp-meta">
                    ${pinned ? '<span class="ntp-pinned-flag">Pinned</span>' : ''}
                    ${esc(relativeTime(n.created_at))}
                    ${n.updated_at && n.updated_at !== n.created_at ? ' · edited' : ''}
                </span>
                <span class="ntp-item-actions">
                    <button type="button" class="ntp-act" data-act="pin" data-id="${id}"
                            title="${pinned ? 'Unpin this note' : 'Pin to the top'}">
                        <svg viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.7-5.1a2 2 0 0 1 .3-1.9l1.4-1.7A2 2 0 0 0 17.4 5H6.6a2 2 0 0 0-1.6 3.3l1.4 1.7a2 2 0 0 1 .3 1.9L5 17z"/></svg>
                    </button>
                    <button type="button" class="ntp-act" data-act="edit" data-id="${id}" title="Edit note">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button type="button" class="ntp-act ntp-act-danger" data-act="delete" data-id="${id}" title="Delete note">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </span>
            </div>
            <div class="ntp-edit-actions" data-ntp-editactions="${id}" hidden>
                <button type="button" class="btn btn-sm btn-secondary" data-act="cancel-edit" data-id="${id}">Cancel</button>
                <button type="button" class="btn btn-sm btn-primary" data-act="save-edit" data-id="${id}">Save</button>
            </div>
        </article>`;
    }

    function render(container) {
        const st = mounted.get(container);
        if (!st) return;
        const list = container.querySelector('[data-ntp="list"]');
        const count = container.querySelector('[data-ntp="count"]');

        // pinned first, then newest
        const items = st.notes.slice().sort((a, b) => {
            if (!!b.is_pinned !== !!a.is_pinned) return b.is_pinned ? 1 : -1;
            return new Date(b.created_at) - new Date(a.created_at);
        });

        count.textContent = items.length === 1 ? '1 note' : `${items.length} notes`;
        list.innerHTML = items.length
            ? items.map(noteMarkup).join('')
            : `<p class="ntp-empty">No notes yet. The first one is usually the most useful —
                 what was agreed, and what happens next.</p>`;
    }

    async function load(container) {
        const st = mounted.get(container);
        try {
            const res = await api.request(
                `/crm/notes?entityType=${encodeURIComponent(st.entityType)}&entityId=${encodeURIComponent(st.entityId)}`);
            st.notes = Array.isArray(res) ? res : (res?.notes || []);
        } catch (e) {
            console.error('Failed to load notes:', e);
            st.notes = [];
            Toast.error(e.message || 'Could not load notes');
        }
        render(container);
    }

    async function add(container) {
        const st = mounted.get(container);
        const input = container.querySelector('[data-ntp="input"]');
        const content = input.value.trim();
        if (!content) { Toast.error('Write something first'); return; }
        try {
            await api.request('/crm/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, entity_type: st.entityType, entity_id: st.entityId })
            });
            input.value = '';
            Toast.success('Note added');
            await load(container);
        } catch (e) {
            console.error('Failed to add note:', e);
            Toast.error(e.message || 'Could not add the note');
        }
    }

    function beginEdit(container, id) {
        const item = container.querySelector(`[data-note-id="${CSS.escape(id)}"]`);
        if (!item) return;
        item.querySelector(`[data-ntp-view="${CSS.escape(id)}"]`).hidden = true;
        item.querySelector(`[data-ntp-edit="${CSS.escape(id)}"]`).hidden = false;
        item.querySelector(`[data-ntp-editactions="${CSS.escape(id)}"]`).hidden = false;
        item.querySelector(`[data-ntp-edit="${CSS.escape(id)}"]`).focus();
    }

    function cancelEdit(container, id) {
        const item = container.querySelector(`[data-note-id="${CSS.escape(id)}"]`);
        if (!item) return;
        const st = mounted.get(container);
        const original = st.notes.find(n => n.id === id);
        const ta = item.querySelector(`[data-ntp-edit="${CSS.escape(id)}"]`);
        if (original) ta.value = original.content;
        item.querySelector(`[data-ntp-view="${CSS.escape(id)}"]`).hidden = false;
        ta.hidden = true;
        item.querySelector(`[data-ntp-editactions="${CSS.escape(id)}"]`).hidden = true;
    }

    async function saveEdit(container, id) {
        const item = container.querySelector(`[data-note-id="${CSS.escape(id)}"]`);
        const content = item.querySelector(`[data-ntp-edit="${CSS.escape(id)}"]`).value.trim();
        if (!content) { Toast.error('A note cannot be empty'); return; }
        try {
            await api.request(`/crm/notes/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            Toast.success('Note updated');
            await load(container);
        } catch (e) {
            console.error('Failed to update note:', e);
            Toast.error(e.message || 'Could not save the note');
        }
    }

    async function togglePin(container, id) {
        try {
            await api.request(`/crm/notes/${encodeURIComponent(id)}/pin`, { method: 'POST' });
            await load(container);
        } catch (e) {
            console.error('Failed to pin note:', e);
            Toast.error(e.message || 'Could not pin the note');
        }
    }

    async function remove(container, id) {
        const ok = await showConfirm('Delete this note? This cannot be undone.', 'Delete note', 'danger');
        if (!ok) return;
        try {
            await api.request(`/crm/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
            Toast.success('Note deleted');
            await load(container);
        } catch (e) {
            console.error('Failed to delete note:', e);
            Toast.error(e.message || 'Could not delete the note');
        }
    }

    function mount(container, entityType, entityId) {
        if (!container) return;
        const labels = { lead: 'lead', deal: 'deal', contact: 'contact', company: 'company' };
        const prev = mounted.get(container);
        mounted.set(container, {
            entityType, entityId, notes: [],
            entityLabel: labels[entityType] || 'record',
            bound: prev ? prev.bound : false
        });
        container.innerHTML = shell(mounted.get(container));

        // Bind ONCE per container. A detail panel re-mounts this on every open,
        // and re-adding the listener each time made one "Add note" click fire
        // as many POSTs as the panel had been opened — three identical notes
        // from a single click.
        if (mounted.get(container).bound) {
            load(container);
            return;
        }
        mounted.get(container).bound = true;

        // Delegated: note content never goes into an inline handler, so a note
        // containing a quote cannot break out of one.
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-act], [data-ntp="add"]');
            if (!btn) return;
            if (btn.dataset.ntp === 'add') return add(container);
            const id = btn.getAttribute('data-id');
            switch (btn.getAttribute('data-act')) {
                case 'pin': return togglePin(container, id);
                case 'edit': return beginEdit(container, id);
                case 'cancel-edit': return cancelEdit(container, id);
                case 'save-edit': return saveEdit(container, id);
                case 'delete': return remove(container, id);
            }
        });

        load(container);
    }

    return { mount, reload: load };
})();
