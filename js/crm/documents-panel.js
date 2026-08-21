/**
 * Documents panel — KYC and supporting files attached to a lead or a deal
 * ----------------------------------------------------------------------------
 * A loan DSA, an insurance agency or a financial advisor cannot close without
 * collecting documents: PAN, Aadhaar, a bank statement, a cancelled cheque.
 * Before this panel the CRM had no way to attach a file to a record at all —
 * the documents lived in a WhatsApp thread and the record of what had been
 * received lived in the rep's head.
 *
 *   GET    /crm/entity-documents?lead_id=|deal_id=      list
 *   GET    /crm/entity-documents/checklist?lead_id=…    what is still missing
 *   GET    /crm/entity-documents/types                  the picker's vocabulary
 *   POST   /crm/entity-documents/upload                 multipart attach
 *   PATCH  /crm/entity-documents/{id}/review            verify / reject
 *   DELETE /crm/entity-documents/{id}                   remove
 *
 * Usage:  DocumentsPanel.mount(document.getElementById('leadDocumentsPanel'), 'lead', leadId);
 *
 * Responses are snake_case (the API's SnakeCaseLower policy).
 */
const DocumentsPanel = (() => {
    'use strict';

    // QUOTE-SAFE on purpose: escaped values are interpolated into
    // double-quoted attributes (data-id="…", title="…"), and an escaper that
    // leaves " and ' alone lets a file name break out of one.
    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    // Filled once per page from GET /types, so the picker and the labels come
    // from the server's vocabulary rather than a copy that can drift from it.
    let typeCache = null;
    // The tenant's REQUIRED types. Separate from the vocabulary on purpose —
    // see buildTypePicker for why the picker offers more than the checklist.
    let requiredCache = null;

    const STATUS_LABEL = { received: 'Awaiting review', verified: 'Verified', rejected: 'Rejected' };

    function humanSize(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
        return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

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

    function labelFor(code) {
        const hit = (typeCache || []).find(t => t.code === code);
        return hit ? hit.label : code;
    }

    async function loadTypes() {
        if (typeCache) return typeCache;
        try {
            const res = await api.request('/crm/entity-documents/types');
            typeCache = Array.isArray(res) ? res : [];
        } catch (e) {
            console.error('Failed to load document types:', e);
            // Not fatal: the list still renders, the picker just falls back to
            // raw codes. A panel that refuses to open because a dropdown could
            // not populate is a worse outcome than an unpolished label.
            typeCache = [];
        }
        return typeCache;
    }

    async function loadRequired() {
        if (requiredCache) return requiredCache;
        try {
            const res = await api.request('/crm/entity-documents/required');
            requiredCache = (res && res.required) || [];
        } catch (e) {
            // Not fatal — without it the picker is simply unsorted.
            console.error('Failed to load required document types:', e);
            requiredCache = [];
        }
        return requiredCache;
    }

    function shell(state) {
        const what = state.entityType === 'deal' ? 'deal' : 'lead';
        return `
        <div class="docp">
            <div class="docp-head">
                <h4 class="docp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    Documents
                </h4>
                <span class="docp-count" data-docp="count"></span>
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Documents</summary>
                <div class="crm-help-body">
                    <p>Files collected against this ${esc(what)} — PAN, Aadhaar, bank statements,
                       a signed application. Upload one, pick what it is, and a Team Lead or
                       Manager marks it verified or rejected.</p>
                    <p><em>A rejected document stays on the record with the reason, so you know
                       exactly what to collect again.</em></p>
                </div>
            </details>

            <div data-docp="checklist" class="docp-checklist" hidden></div>

            <div class="docp-upload">
                <div class="docp-upload-row">
                    <div class="docp-type" data-docp="typePicker"></div>
                    <label class="docp-file">
                        <input type="file" data-docp="file" hidden
                               accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,.xlsx,.txt">
                        <span data-docp="fileLabel">Choose a file…</span>
                    </label>
                    <button type="button" class="btn btn-sm btn-primary" data-docp="upload">Attach</button>
                </div>
                <span class="docp-hint">PDF, image, DOCX, XLSX or TXT — up to 25 MB.</span>
            </div>

            <div data-docp="list" class="docp-list"></div>
        </div>`;
    }

    function docMarkup(d, canReview) {
        const id = esc(d.id);
        const status = String(d.status || 'received');
        const reviewer = d.reviewed_by_name || d.reviewed_by_user_id;
        return `
        <article class="docp-item is-${esc(status)}" data-doc-id="${id}">
            <div class="docp-item-main">
                <span class="docp-item-name" title="${esc(d.file_name)}">${esc(d.file_name)}</span>
                <span class="docp-item-type">${esc(labelFor(d.doc_type))}</span>
            </div>
            <div class="docp-item-meta">
                <span class="docp-status docp-status-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>
                <span>${esc(humanSize(d.file_size_bytes))}</span>
                <span>${esc(relativeTime(d.created_at))}</span>
                ${d.uploaded_by_name ? `<span>by ${esc(d.uploaded_by_name)}</span>` : ''}
            </div>
            ${d.review_note ? `<p class="docp-item-note">${esc(d.review_note)}${reviewer ? ` — ${esc(reviewer)}` : ''}</p>` : ''}
            <div class="docp-item-actions">
                <button type="button" class="docp-act" data-act="download" data-id="${id}" title="Download">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                ${canReview ? `
                <button type="button" class="docp-act docp-act-ok" data-act="verify" data-id="${id}" title="Mark verified">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <button type="button" class="docp-act docp-act-warn" data-act="reject" data-id="${id}" title="Reject with a reason">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>` : ''}
                <button type="button" class="docp-act docp-act-danger" data-act="delete" data-id="${id}" title="Remove">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </article>`;
    }

    function renderChecklist(container) {
        const st = mounted.get(container);
        const box = container.querySelector('[data-docp="checklist"]');
        const cl = st.checklist;

        // No configured requirements means this tenant does not run a document
        // checklist at all. Rendering an empty "0 of 0 collected" strip on every
        // record would be noise, so the whole block stays hidden.
        if (!cl || !cl.required_count) { box.hidden = true; box.innerHTML = ''; return; }

        box.hidden = false;
        const rows = (cl.items || []).map(i => `
            <li class="docp-cl-item${i.satisfied ? ' is-done' : ''}">
                <span class="docp-cl-mark">${i.satisfied ? '✓' : '○'}</span>
                <span class="docp-cl-label">${esc(i.label)}</span>
                <span class="docp-cl-state">${i.status ? esc(STATUS_LABEL[i.status] || i.status) : 'Not collected'}</span>
            </li>`).join('');

        box.innerHTML = `
            <div class="docp-cl-head">
                <strong>${cl.satisfied_count} of ${cl.required_count} collected</strong>
                ${cl.complete ? '<span class="docp-cl-done">File complete</span>' : ''}
            </div>
            <ul class="docp-cl-list">${rows}</ul>`;
    }

    function render(container) {
        const st = mounted.get(container);
        if (!st) return;
        const list = container.querySelector('[data-docp="list"]');
        const count = container.querySelector('[data-docp="count"]');

        count.textContent = st.docs.length === 1 ? '1 document' : `${st.docs.length} documents`;
        list.innerHTML = st.docs.length
            ? st.docs.map(d => docMarkup(d, st.canReview)).join('')
            : `<p class="docp-empty">Nothing collected yet. Attach the first document and pick
                 what it is — the checklist above then tracks the rest.</p>`;
        renderChecklist(container);
    }

    function query(st) {
        return st.entityType === 'deal'
            ? `deal_id=${encodeURIComponent(st.entityId)}`
            : `lead_id=${encodeURIComponent(st.entityId)}`;
    }

    async function load(container) {
        const st = mounted.get(container);
        try {
            const res = await api.request(`/crm/entity-documents?${query(st)}`);
            st.docs = Array.isArray(res) ? res : [];
        } catch (e) {
            console.error('Failed to load documents:', e);
            st.docs = [];
            Toast.error(e.message || 'Could not load documents');
        }
        try {
            st.checklist = await api.request(`/crm/entity-documents/checklist?${query(st)}`);
        } catch (e) {
            // The checklist is a summary OF the list. Losing it must not blank
            // the documents themselves, which are the thing the rep came for.
            console.error('Failed to load document checklist:', e);
            st.checklist = null;
        }
        render(container);
    }

    async function upload(container) {
        const st = mounted.get(container);
        const input = container.querySelector('[data-docp="file"]');
        const file = input.files && input.files[0];

        if (!file) { Toast.error('Choose a file first'); return; }
        if (!st.docType) { Toast.error('Pick what this document is'); return; }

        const form = new FormData();
        form.append('file', file, file.name);
        form.append('doc_type', st.docType);
        if (st.entityType === 'deal') form.append('deal_id', st.entityId);
        else form.append('lead_id', st.entityId);

        const btn = container.querySelector('[data-docp="upload"]');
        btn.disabled = true;
        try {
            await api.request('/crm/entity-documents/upload', { method: 'POST', body: form });
            input.value = '';
            container.querySelector('[data-docp="fileLabel"]').textContent = 'Choose a file…';

            // ⭐ CLEAR THE TYPE TOO, not just the file.
            //
            // Leaving the previous type selected is how an Aadhaar gets filed
            // as a PAN card: the rep picks the next file, the picker still says
            // "PAN card" from the last upload, and nothing asks. The checklist
            // then reports PAN collected twice and Aadhaar missing, which is
            // worse than no checklist because it is confidently wrong.
            st.docType = null;
            if (st.typeDropdown && typeof st.typeDropdown.setValue === 'function') {
                st.typeDropdown.setValue(null, false);
            }

            Toast.success('Document attached');
            await load(container);
        } catch (e) {
            console.error('Failed to upload document:', e);
            Toast.error(e.message || 'Could not attach the document');
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * Fetch through the authenticated proxy and hand the browser a blob.
     *
     * The endpoint is NOT a public URL — it requires the bearer token — so an
     * <a href> or a window.open cannot reach it, and that is the point: a
     * presigned S3 URL handed to the browser would be a shareable credential
     * for somebody's PAN card that outlives the session.
     */
    async function download(container, id) {
        const st = mounted.get(container);
        const doc = st.docs.find(d => d.id === id);
        try {
            const base = (typeof CONFIG !== 'undefined' && CONFIG.crmApiBaseUrl) || '/api';
            const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
            const res = await fetch(`${base}/entity-documents/${encodeURIComponent(id)}/download`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (!res.ok) throw new Error(res.status === 404 ? 'That document is no longer available' : 'Download failed');

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (doc && doc.file_name) || 'document';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Failed to download document:', e);
            Toast.error(e.message || 'Could not download the document');
        }
    }

    async function review(container, id, status) {
        let note = null;
        if (status === 'rejected') {
            // A rejection with no reason leaves the rep with a refused document
            // and no idea what to collect instead. The API refuses it too; this
            // just asks before spending a round trip.
            note = await Prompt.show({
                title: 'Reject document',
                message: 'Why is this document being rejected? The rep sees this.',
                placeholder: 'e.g. Page 2 is blurred — re-scan',
                confirmText: 'Reject'
            });
            if (note === null) return;
            if (!String(note).trim()) { Toast.error('A rejection needs a reason'); return; }
        }
        try {
            await api.request(`/crm/entity-documents/${encodeURIComponent(id)}/review`, {
                method: 'PATCH',
                body: JSON.stringify({ status, note })
            });
            Toast.success(status === 'verified' ? 'Document verified' : 'Document rejected');
            await load(container);
        } catch (e) {
            console.error('Failed to review document:', e);
            Toast.error(e.message || 'Could not save the review');
        }
    }

    async function remove(container, id) {
        const st = mounted.get(container);
        const doc = st.docs.find(d => d.id === id);
        const ok = await showConfirm(
            `Remove "${(doc && doc.file_name) || 'this document'}"? The file is deleted and cannot be recovered.`,
            'Remove document', 'danger');
        if (!ok) return;
        try {
            await api.request(`/crm/entity-documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
            Toast.success('Document removed');
            await load(container);
        } catch (e) {
            console.error('Failed to delete document:', e);
            Toast.error(e.message || 'Could not remove the document');
        }
    }

    /**
     * ⭐ THE PICKER OFFERS MORE TYPES THAN THE CHECKLIST REQUIRES, ON PURPOSE.
     *
     * They answer two different questions. The checklist is what a file MUST
     * have before it counts as complete; the vocabulary is what a document can
     * be TAGGED as. A rep handed a passport on a file that only requires PAN
     * and a bank statement still has to be able to file it as a passport —
     * restricting the picker to the required list would force them to tag it
     * "Other", and "Other" is where a document goes to become unfindable.
     *
     * What was genuinely wrong was the ORDER: eighteen undifferentiated options
     * when the tenant cares about two. Required types now come first and say
     * so, and the rest stay reachable underneath.
     */
    async function buildTypePicker(container) {
        const st = mounted.get(container);
        const host = container.querySelector('[data-docp="typePicker"]');
        const [types, required] = await Promise.all([loadTypes(), loadRequired()]);
        if (!host) return;

        const req = new Set(required);
        const ordered = [
            ...types.filter(t => req.has(t.code)),
            ...types.filter(t => !req.has(t.code)),
        ];

        // Never a native <select> (codebase convention).
        // SearchableDropdown IS the Dropdown class (see the bottom of
        // js/searchable-dropdown.js) — it is constructed, not called through a
        // factory, and the convertSelectToSearchable helper only applies when
        // there is an existing <select> to wrap. There is not one here on
        // purpose: this picker's options come from the server.
        if (typeof SearchableDropdown === 'function' && types.length) {
            st.typeDropdown = new SearchableDropdown(host, {
                options: ordered.map(t => ({
                    value: t.code,
                    label: t.label,
                    // The dropdown renders this under the label, so the split
                    // between "on this tenant's checklist" and "everything
                    // else" is visible without a second control.
                    description: req.has(t.code) ? 'Required on every record' : ''
                })),
                placeholder: 'What is this document?',
                searchPlaceholder: 'Search document types…',
                compact: true,
                onChange: (value) => { st.docType = value; }
            });
        } else {
            // The dropdown component or the vocabulary is unavailable. Degrade
            // to a text input rather than leaving the panel unusable — the API
            // validates the code either way.
            host.innerHTML = '<input type="text" class="docp-type-fallback" placeholder="Document type code">';
            host.querySelector('input').addEventListener('input', (e) => { st.docType = e.target.value.trim(); });
        }
    }

    /**
     * @param {HTMLElement} container
     * @param {'lead'|'deal'} entityType
     * @param {string} entityId
     * @param {{canReview?: boolean}} [opts] canReview gates the verify/reject
     *        buttons. It is presentation only — the API refuses a plain member's
     *        review regardless, because a control the server does not enforce is
     *        not a control.
     */
    function mount(container, entityType, entityId, opts) {
        if (!container) return;
        // Re-read the checklist config on every mount: an admin can change it
        // in another tab, and a picker ordered by a stale list is worse than an
        // unordered one because it looks authoritative.
        requiredCache = null;
        const prev = mounted.get(container);

        // ⭐ TEAR DOWN THE PREVIOUS DROPDOWN BEFORE REPLACING THE CONTAINER.
        //
        // SearchableDropdown PORTALS its open menu to <body> to escape
        // transformed ancestors, and puts it back on close(). Blowing away the
        // container while a menu is portaled orphans that menu in the body: it
        // is no longer reachable from the panel, nothing will ever close it,
        // and the next open adds another. Measured on the third open of the
        // lead panel — two live menus for one picker, and a click resolved to
        // both.
        //
        // destroy() also un-registers the document click handler and the
        // reposition listeners, which otherwise accumulate one set per open.
        if (prev && prev.typeDropdown) {
            try { prev.typeDropdown.close(); prev.typeDropdown.destroy(); }
            catch (e) { console.error('Failed to tear down the document type picker:', e); }
        }

        mounted.set(container, {
            entityType, entityId,
            docs: [], checklist: null, docType: null,
            canReview: !!(opts && opts.canReview),
            bound: prev ? prev.bound : false
        });
        container.innerHTML = shell(mounted.get(container));
        buildTypePicker(container);

        // Bind ONCE per container. A detail panel re-mounts on every open, and
        // re-adding the listener each time makes one Attach click fire as many
        // uploads as the panel has been opened.
        if (mounted.get(container).bound) { load(container); return; }
        mounted.get(container).bound = true;

        container.addEventListener('change', (e) => {
            if (e.target.matches('[data-docp="file"]')) {
                const f = e.target.files && e.target.files[0];
                container.querySelector('[data-docp="fileLabel"]').textContent = f ? f.name : 'Choose a file…';
            }
        });

        // Delegated: a file name never goes into an inline handler, so a name
        // containing a quote cannot break out of one.
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-act], [data-docp="upload"]');
            if (!btn) return;
            if (btn.dataset.docp === 'upload') return upload(container);
            const id = btn.getAttribute('data-id');
            switch (btn.getAttribute('data-act')) {
                case 'download': return download(container, id);
                case 'verify': return review(container, id, 'verified');
                case 'reject': return review(container, id, 'rejected');
                case 'delete': return remove(container, id);
            }
        });

        load(container);
    }

    return { mount, reload: load };
})();
