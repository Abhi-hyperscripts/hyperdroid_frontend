/**
 * Activities panel — reusable across leads, deals, contacts and companies
 * ----------------------------------------------------------------------------
 * Activities could be logged and read (they appear in the journey timeline) but
 * never corrected, completed or removed: a mis-logged call stayed wrong forever.
 * The timeline is built from a projection that carries no activity id, so it
 * cannot act on one — this panel uses the activities list, which returns the
 * full records.
 *
 *   GET    /api/Activities?entityType=&entityId=   list (ids included)
 *   PUT    /api/Activities/{id}                     edit
 *   POST   /api/Activities/{id}/complete            mark complete
 *   DELETE /api/Activities/{id}                     remove
 *
 * Usage:  ActivitiesPanel.mount(el, 'lead', leadId);
 *
 * Responses are snake_case, so fields read as activity_type / performed_at /
 * is_completed / contact_outcome.
 */
const ActivitiesPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    const TYPES = ['call', 'email', 'meeting', 'note', 'task'];
    const TYPE_LABEL = { call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note', task: 'Task' };
    const TYPE_ICON = {
        call: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
        email: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
        meeting: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
        note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        task: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'
    };

    function when(iso) {
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

    function shell() {
        return `
        <div class="acp">
            <div class="acp-head">
                <h4 class="acp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Logged activity
                </h4>
                <span class="acp-count" data-acp="count"></span>
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Logged activity</summary>
                <div class="crm-help-body">
                    <p>Every call, email and meeting recorded against this record. The journey
                       timeline above shows them in context; this list is where you
                       <strong>correct</strong> one that was logged wrong, mark an open one
                       <strong>complete</strong>, or <strong>remove</strong> a duplicate.</p>
                    <p><em>Tip: log new activity with the "Log Activity" button — this panel is for
                       fixing what is already there.</em></p>
                </div>
            </details>

            <div data-acp="list" class="acp-list"></div>
        </div>`;
    }

    function itemMarkup(a) {
        const id = esc(a.id);
        const type = TYPES.includes(a.activity_type) ? a.activity_type : 'note';
        const done = !!a.is_completed;

        return `
        <article class="acp-item${done ? ' is-done' : ''}" data-act-id="${id}">
            <div class="acp-item-main">
                <span class="acp-icon acp-icon-${esc(type)}" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${TYPE_ICON[type]}</svg>
                </span>
                <div class="acp-item-text">
                    <div class="acp-subject" data-acp-view="${id}">${esc(a.subject || TYPE_LABEL[type])}</div>
                    ${a.description ? `<p class="acp-desc">${esc(a.description)}</p>` : ''}
                    <div class="acp-meta">
                        <span class="acp-type">${esc(TYPE_LABEL[type])}</span>
                        <span>${esc(when(a.performed_at))}</span>
                        ${a.contact_outcome ? `<span class="acp-outcome">${esc(String(a.contact_outcome).replace(/_/g, ' '))}</span>` : ''}
                        ${done ? '<span class="acp-done-flag">Completed</span>' : ''}
                    </div>
                </div>
            </div>

            <div class="acp-edit" data-acp-editrow="${id}" hidden>
                <label class="acp-lbl" for="acp-subj-${id}">Subject</label>
                <input id="acp-subj-${id}" type="text" data-acp-subject="${id}" value="${esc(a.subject || '')}" maxlength="200">
                <label class="acp-lbl" for="acp-desc-${id}">Details</label>
                <textarea id="acp-desc-${id}" rows="2" data-acp-description="${id}">${esc(a.description || '')}</textarea>
                <span class="acp-hint">Correcting what was logged — this does not send anything.</span>
                <div class="acp-edit-actions">
                    <button type="button" class="btn btn-sm btn-secondary" data-act="cancel-edit" data-id="${id}">Cancel</button>
                    <button type="button" class="btn btn-sm btn-primary" data-act="save-edit" data-id="${id}">Save</button>
                </div>
            </div>

            <div class="acp-actions">
                ${done ? '' : `<button type="button" class="acp-act" data-act="complete" data-id="${id}" title="Mark complete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>
                </button>`}
                <button type="button" class="acp-act" data-act="edit" data-id="${id}" title="Correct this entry">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button type="button" class="acp-act acp-act-danger" data-act="delete" data-id="${id}" title="Delete entry">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </article>`;
    }

    function render(container) {
        const st = mounted.get(container);
        if (!st) return;
        const list = container.querySelector('[data-acp="list"]');
        const count = container.querySelector('[data-acp="count"]');

        const items = st.items.slice()
            .sort((a, b) => new Date(b.performed_at) - new Date(a.performed_at));

        count.textContent = items.length === 1 ? '1 entry' : `${items.length} entries`;
        list.innerHTML = items.length
            ? items.map(itemMarkup).join('')
            : `<p class="acp-empty">Nothing logged yet. Calls, emails and meetings recorded
                 against this record show up here.</p>`;
    }

    async function load(container) {
        const st = mounted.get(container);
        try {
            const res = await api.request(
                `/crm/activities?entityType=${encodeURIComponent(st.entityType)}&entityId=${encodeURIComponent(st.entityId)}`);
            st.items = Array.isArray(res) ? res : (res?.activities || []);
        } catch (e) {
            console.error('Failed to load activities:', e);
            st.items = [];
            Toast.error(e.message || 'Could not load activity');
        }
        render(container);
    }

    function beginEdit(container, id) {
        const item = container.querySelector(`[data-act-id="${CSS.escape(id)}"]`);
        if (!item) return;
        item.querySelector(`[data-acp-editrow="${CSS.escape(id)}"]`).hidden = false;
        item.querySelector(`[data-acp-subject="${CSS.escape(id)}"]`).focus();
    }

    function cancelEdit(container, id) {
        const item = container.querySelector(`[data-act-id="${CSS.escape(id)}"]`);
        if (!item) return;
        const st = mounted.get(container);
        const orig = st.items.find(a => a.id === id);
        if (orig) {
            item.querySelector(`[data-acp-subject="${CSS.escape(id)}"]`).value = orig.subject || '';
            item.querySelector(`[data-acp-description="${CSS.escape(id)}"]`).value = orig.description || '';
        }
        item.querySelector(`[data-acp-editrow="${CSS.escape(id)}"]`).hidden = true;
    }

    async function saveEdit(container, id) {
        const item = container.querySelector(`[data-act-id="${CSS.escape(id)}"]`);
        const subject = item.querySelector(`[data-acp-subject="${CSS.escape(id)}"]`).value.trim();
        const description = item.querySelector(`[data-acp-description="${CSS.escape(id)}"]`).value.trim();
        if (!subject) { Toast.error('Give the entry a subject'); return; }
        try {
            await api.request(`/crm/activities/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject, description: description || null })
            });
            Toast.success('Activity updated');
            await load(container);
        } catch (e) {
            console.error('Failed to update activity:', e);
            Toast.error(e.message || 'Could not save the change');
        }
    }

    async function complete(container, id) {
        try {
            await api.request(`/crm/activities/${encodeURIComponent(id)}/complete`, { method: 'POST' });
            Toast.success('Marked complete');
            await load(container);
        } catch (e) {
            console.error('Failed to complete activity:', e);
            Toast.error(e.message || 'Could not mark it complete');
        }
    }

    async function remove(container, id) {
        const ok = await showConfirm(
            'Delete this activity? The record of it disappears from the timeline too.',
            'Delete activity', 'danger');
        if (!ok) return;
        try {
            await api.request(`/crm/activities/${encodeURIComponent(id)}`, { method: 'DELETE' });
            Toast.success('Activity deleted');
            await load(container);
        } catch (e) {
            console.error('Failed to delete activity:', e);
            Toast.error(e.message || 'Could not delete it');
        }
    }

    function mount(container, entityType, entityId) {
        if (!container) return;
        const prev = mounted.get(container);
        mounted.set(container, {
            entityType, entityId, items: [], bound: prev ? prev.bound : false
        });
        container.innerHTML = shell();

        // Bound once per container: a detail panel re-mounts on every open, and
        // re-binding would fire one click as many times as it had been opened.
        if (mounted.get(container).bound) { load(container); return; }
        mounted.get(container).bound = true;

        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const id = btn.getAttribute('data-id');
            switch (btn.getAttribute('data-act')) {
                case 'complete': return complete(container, id);
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
