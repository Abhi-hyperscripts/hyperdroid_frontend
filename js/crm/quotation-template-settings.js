/**
 * SETTINGS → QUOTATION TEMPLATE. Upload your own quotation layout.
 *
 *   GET    /crm/quotation-templates                 the list (no html)
 *   GET    /crm/quotation-templates/placeholders    the documented contract
 *   POST   /crm/quotation-templates                 upload
 *   PUT    /crm/quotation-templates/{id}            replace the file, or rename
 *   POST   /crm/quotation-templates/{id}/activate
 *   DELETE /crm/quotation-templates/{id}
 *   GET    /crm/quotation-templates/{id}/preview    rendered with sample data
 *
 * ⭐⭐⭐ THE LOOP THIS SCREEN EXISTS FOR, in the owner's own words (2026-10-08):
 * "upload their own template, preview, fix if something is broken, again
 * upload (this will replace old template), preview and done."
 *
 * So the preview is not a nicety bolted on the side — it is the middle of the
 * loop, and the thing it has to surface is what the engine did NOT understand.
 * A preview that rendered a plausible page with a blank where the GSTIN should
 * be would send the tenant away confident, and they would find out when a
 * customer did.
 *
 * ⭐ THE PLACEHOLDER LIST IS FETCHED, NOT HARD-CODED HERE. It is a published
 * interface — a tenant pastes it into a brief for their developer or into a
 * prompt — so it is served by the code that implements it and cannot drift from
 * what the renderer actually offers.
 *
 * ⭐ The preview iframe carries the same exact sandbox as the lead's Quotation
 * tab: `allow-same-origin allow-modals`, and deliberately NOT allow-scripts.
 * See the long note in quotation-panel.js for why that combination is the safe
 * one. An uploaded template is arbitrary HTML and is not sanitised.
 */
(function (global) {
    'use strict';

    let templates = [];
    let placeholders = null;
    let preview = null;           // { id, html, unknown_placeholders }
    let pendingHtml = null;       // a file read but not yet uploaded
    let pendingName = '';

    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function $(id) { return document.getElementById(id); }

    // ── Loading ─────────────────────────────────────────────────────────────

    async function load() {
        try {
            templates = await api.request('/crm/quotation-templates');
        } catch (e) {
            console.error('Could not list quotation templates:', e);
            templates = [];
        }
        if (!placeholders) {
            try { placeholders = await api.request('/crm/quotation-templates/placeholders'); }
            catch (e) { console.error('Could not load the placeholder list:', e); placeholders = []; }
        }
        render();
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    function render() {
        const host = $('quotationTemplateTab');
        if (!host) return;

        host.innerHTML = `
            <div class="qts-intro">
                <p>Your quotation goes out on <strong>your</strong> letterhead. Upload a
                   self-contained HTML file with placeholders where this quote's details belong —
                   hand your existing quotation to a developer or an AI and ask for exactly that.</p>
                <p class="qts-hint">This is separate from the <strong>Proforma</strong>, which
                   Accounts owns because it becomes a tax invoice. Both price the same lines.</p>
            </div>

            <div class="qts-upload">
                <label class="qts-field">
                    <span>Name</span>
                    <input type="text" id="qtsName" class="form-control" maxlength="150"
                           placeholder="e.g. Standard quotation 2026" value="${esc(pendingName)}">
                </label>
                <div class="qts-file-row">
                    <input type="file" id="qtsFile" accept=".html,.htm,text/html" class="form-control">
                    <button type="button" class="btn btn-sm btn-secondary" id="qtsStarter">Start from our template</button>
                    <!-- A PLAIN ANCHOR, NOT A FETCH-AND-BLOB. The sample is a static
                         same-origin file, so the download attribute saves it with no
                         JavaScript at all - which also means it keeps working if this
                         script throws, and the browser shows its real size and type in
                         the download shelf. (No backticks in here: this comment sits
                         inside a template literal, and one terminates the string.) -->
                    <a class="btn btn-sm btn-secondary"
                       href="../../quotation-templates/starter.html"
                       download="quotation-template-sample.html">Download sample</a>
                </div>
                <p class="qts-hint">Send the sample to whoever converts your quotation — it is a
                   working template with every placeholder in it and comments explaining how to
                   change it.</p>
                ${pendingHtml ? `
                    <p class="qts-ready">A file is ready to upload
                       (${(new Blob([pendingHtml]).size / 1024).toFixed(1)} KB).</p>` : ''}
                <button type="button" class="btn btn-primary" id="qtsUpload"${pendingHtml ? '' : ' disabled'}>
                    Upload template
                </button>
            </div>

            ${templates.length ? `
            <table class="qts-table">
                <thead><tr><th>Name</th><th>Status</th><th>Updated</th><th></th></tr></thead>
                <tbody>
                    ${templates.map(t => `
                    <tr data-qts-id="${esc(t.id)}">
                        <td>${esc(t.name)}</td>
                        <td>${t.is_active
                            ? '<span class="qts-badge qts-badge-active">In use</span>'
                            : '<span class="qts-badge">Not in use</span>'}</td>
                        <td>${esc(new Date(t.updated_at).toLocaleDateString())}</td>
                        <td class="qts-row-actions">
                            <button type="button" class="btn btn-sm btn-secondary" data-qts="preview">Preview</button>
                            <button type="button" class="btn btn-sm btn-secondary" data-qts="download">Download</button>
                            ${t.is_active ? '' :
                              '<button type="button" class="btn btn-sm btn-secondary" data-qts="activate">Use this</button>'}
                            <button type="button" class="btn btn-sm btn-danger" data-qts="delete">Delete</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>` : `
            <p class="qts-empty">No template uploaded yet. Until one is, the Quotation tab on a
               lead will say so — the Proforma tab keeps working either way.</p>`}

            ${preview ? previewBlock() : ''}

            ${placeholderBlock()}`;

        const frame = host.querySelector('.qts-frame');
        if (frame && preview) frame.srcdoc = preview.html || '';
    }

    function previewBlock() {
        const unknown = preview.unknown_placeholders || [];
        return `
            <div class="qts-preview">
                <div class="qts-preview-head">
                    <h4>Preview <span class="qts-sample">sample data</span></h4>
                    <button type="button" class="btn btn-sm btn-secondary" data-qts="close-preview">Close</button>
                </div>

                ${unknown.length ? `
                <div class="qts-unresolved">
                    <strong>${unknown.length} placeholder${unknown.length === 1 ? '' : 's'}
                    not recognised</strong> — ${unknown.map(esc).join(', ')}.
                    ${unknown.length === 1 ? 'It is' : 'They are'} highlighted in the preview.
                    Check the spelling against the list below, fix the file, and upload it again.
                </div>` : `
                <div class="qts-ok">Every placeholder in this template was recognised.</div>`}

                <!-- Same sandbox as the lead's Quotation tab. No allow-scripts. -->
                <iframe class="qts-frame" title="Template preview"
                        sandbox="allow-same-origin allow-modals"></iframe>
            </div>`;
    }

    function placeholderBlock() {
        if (!placeholders || !placeholders.length) return '';
        return `
            <details class="qts-placeholders">
                <summary>Placeholders you can use (${placeholders.length})</summary>
                <p class="qts-hint">Copy this list into the brief for whoever converts your
                   quotation. Anything not on it is left visible on the preview rather than
                   silently dropped.</p>
                <table class="qts-table">
                    <thead><tr><th>Write this</th><th>You get</th><th>Example</th></tr></thead>
                    <tbody>
                        ${placeholders.map(p => `
                        <tr>
                            <td><code>${p.token.startsWith('#')
                                ? esc('{{' + p.token + '}} … {{/' + p.token.slice(1) + '}}')
                                : esc('{{' + p.token + '}}')}</code></td>
                            <td>${esc(p.meaning)}</td>
                            <td class="qts-example">${esc(p.example)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </details>`;
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    async function readFile(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        pendingHtml = await file.text();
        // Offer the file's own name, so the common case needs no typing.
        if (!pendingName) pendingName = file.name.replace(/\.html?$/i, '');
        render();
    }

    /**
     * Load the starter template that ships with the product.
     *
     * ⭐ FETCHED FROM THE SITE, NOT EMBEDDED IN THIS FILE. It is a 10 KB document
     * that a tenant then edits; inlining it here would mean every page that
     * loads this script downloads a document most of them never use, and it
     * would stop being readable as HTML in the repo.
     */
    async function loadStarter() {
        try {
            const res = await fetch('../../quotation-templates/starter.html');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            pendingHtml = await res.text();
            if (!pendingName) pendingName = 'Our quotation';
            render();
            Toast.info('Starter template loaded — upload it, then preview and edit from there.');
        } catch (e) {
            console.error('Could not load the starter template:', e);
            Toast.error('Could not load the starter template.');
        }
    }

    async function upload() {
        const name = ($('qtsName') ? $('qtsName').value : pendingName).trim();
        if (!name) { Toast.error('Give the template a name.'); return; }
        if (!pendingHtml) { Toast.error('Choose an HTML file first.'); return; }

        try {
            const created = await api.request('/crm/quotation-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, html: pendingHtml, activate: templates.length === 0 }),
            });
            pendingHtml = null;
            pendingName = '';
            Toast.success(`"${name}" uploaded`);
            await load();
            // Straight into the middle of the loop: upload, then SEE it.
            if (created && created.id) await showPreview(created.id);
        } catch (e) {
            console.error('Could not upload the template:', e);
            Toast.error(e.message || 'Could not upload the template.');
        }
    }

    /**
     * Download a template that is already uploaded.
     *
     * ⭐⭐ WITHOUT THIS THE LOOP ONLY RUNS ONCE. "Preview, fix if something is
     * broken, upload again" assumes the tenant still has the file — and the
     * person who needs to fix it is often not the person who uploaded it, weeks
     * later, on a different machine. The list read omits the html deliberately
     * (a settings page would ship a megabyte to draw ten rows), so the single
     * read is fetched on demand here.
     *
     * A blob rather than an anchor to the API, because the endpoint answers JSON
     * with an auth header — a bare <a href> to it would download the wrapper, or
     * a 401.
     */
    async function download(id) {
        try {
            const t = await api.request(`/crm/quotation-templates/${encodeURIComponent(id)}`);
            if (!t || !t.html) { Toast.error('That template has no file to download.'); return; }

            const safe = (t.name || 'quotation-template')
                .replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();

            const url = URL.createObjectURL(new Blob([t.html], { type: 'text/html' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${safe || 'quotation-template'}.html`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Revoked on the next tick: revoking synchronously races the
            // download in some browsers and silently produces an empty file.
            setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (e) {
            console.error('Could not download the template:', e);
            Toast.error(e.message || 'Could not download the template.');
        }
    }

    async function showPreview(id) {
        try {
            const res = await api.request(
                `/crm/quotation-templates/${encodeURIComponent(id)}/preview`);
            preview = { id, html: res.html, unknown_placeholders: res.unknown_placeholders };
            render();
            const el = document.querySelector('.qts-preview');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
            console.error('Could not preview the template:', e);
            Toast.error(e.message || 'Could not preview the template.');
        }
    }

    async function activate(id) {
        try {
            await api.request(`/crm/quotation-templates/${encodeURIComponent(id)}/activate`,
                { method: 'POST' });
            Toast.success('That template is now in use');
            await load();
        } catch (e) {
            console.error('Could not activate the template:', e);
            Toast.error(e.message || 'Could not switch template.');
        }
    }

    async function remove(id) {
        const t = templates.find(x => x.id === id);
        // ⭐ DELETING THE ONE IN USE IS WORTH A DIFFERENT SENTENCE. It leaves the
        // Quotation tab with nothing to render on every lead, which is a bigger
        // consequence than removing a spare and deserves to be said out loud.
        const warning = t && t.is_active
            ? `"${t.name}" is the template in use. Deleting it leaves the Quotation tab with `
              + 'nothing to render until you upload another. Delete it?'
            : `Delete "${t ? t.name : 'this template'}"?`;

        const ok = typeof showConfirm === 'function'
            ? await showConfirm(warning, 'Delete template')
            : true;
        if (!ok) return;

        try {
            await api.request(`/crm/quotation-templates/${encodeURIComponent(id)}`,
                { method: 'DELETE' });
            if (preview && preview.id === id) preview = null;
            Toast.success('Template deleted');
            await load();
        } catch (e) {
            console.error('Could not delete the template:', e);
            Toast.error(e.message || 'Could not delete the template.');
        }
    }

    // ── Wiring ──────────────────────────────────────────────────────────────

    function bind() {
        const host = $('quotationTemplateTab');
        if (!host || host.dataset.qtsBound === '1') return;
        host.dataset.qtsBound = '1';

        host.addEventListener('change', (e) => {
            if (e.target.id === 'qtsFile') return readFile(e.target);
            if (e.target.id === 'qtsName') pendingName = e.target.value;
        });

        host.addEventListener('click', (e) => {
            if (e.target.closest('#qtsStarter')) return loadStarter();
            if (e.target.closest('#qtsUpload')) return upload();
            if (e.target.closest('[data-qts="close-preview"]')) { preview = null; render(); return; }

            const row = e.target.closest('[data-qts-id]');
            if (!row) return;
            const id = row.getAttribute('data-qts-id');

            if (e.target.closest('[data-qts="preview"]')) return showPreview(id);
            if (e.target.closest('[data-qts="download"]')) return download(id);
            if (e.target.closest('[data-qts="activate"]')) return activate(id);
            if (e.target.closest('[data-qts="delete"]')) return remove(id);
        });
    }

    global.loadQuotationTemplateTab = function () { bind(); return load(); };
})(window);
