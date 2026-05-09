// ─────────────────────────────────────────────────────────────────────────
// CRM Settings → Email Templates tab
//
// Reusable template library. Each template has a name, subject, and HTML
// body. Variables use {{snake_case}} — {{first_name}}, {{company}}, etc.
// The backend extracts declared variables automatically.
// ─────────────────────────────────────────────────────────────────────────

(function () {
    let templates = [];
    let editingId = null;

    let _mailboxIndex = {}; // id → email_address, for quick "Sends from" lookup

    window.loadTemplatesTab = async function () {
        try {
            const [tplResp, mbResp] = await Promise.all([
                api.request('/email-templates'),
                api.request('/crm/mailbox-attachments/shared-mailboxes').catch(() => ({ mailboxes: [] })),
            ]);
            templates = (tplResp && tplResp.items) || [];
            _mailboxIndex = {};
            ((mbResp && mbResp.mailboxes) || []).forEach(m => {
                _mailboxIndex[m.id] = m.email_address;
            });
        } catch (e) {
            console.error('Failed to load templates:', e);
            templates = [];
        }
        renderTemplates();
    };

    function renderTemplates() {
        const tbody = document.getElementById('templatesTableBody');
        const wrap = document.getElementById('templatesTableWrapper');
        const empty = document.getElementById('templatesEmpty');
        if (!tbody) return;

        if (!templates.length) {
            if (wrap) wrap.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (wrap) wrap.style.display = '';
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = templates.map(t => {
            const vars = (t.variables_declared || []).map(v =>
                `<span class="tmpl-chip">${escapeHtml(v)}</span>`).join(' ');
            // Sends-from line: shows the picked mailbox, or a muted hint that
            // the template falls back to the tenant default at fire time.
            const mailboxId = t.mailbox_id || t.MailboxId;
            const mailboxLabel = mailboxId
                ? (_mailboxIndex[mailboxId] || '(deleted mailbox)')
                : 'Tenant default';
            const mailboxHint = mailboxId
                ? `<span class="muted" style="font-size:0.78rem;">Sends from <strong>${escapeHtml(mailboxLabel)}</strong></span>`
                : `<span class="muted" style="font-size:0.78rem; font-style:italic;">Sends from tenant default</span>`;
            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(t.name)}</strong><br>
                        ${mailboxHint}
                    </td>
                    <td class="hide-mobile">${escapeHtml(t.subject || '—')}</td>
                    <td class="hide-mobile">${vars || '<span class="muted">—</span>'}</td>
                    <td>${new Date(t.updated_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary" onclick="openTemplateModal('${t.id}')">Edit</button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="previewTemplate('${t.id}')">Preview</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteTemplate('${t.id}')">Delete</button>
                    </td>
                </tr>`;
        }).join('');
    }

    // ─── Create / edit modal ───────────────────────────────────────────────

    // TinyMCE 7 replaces Quill: Quill stripped inline `style` attrs from
    // pasted HTML (Outlook unfurls, Drive share cards), TinyMCE preserves
    // the source verbatim when configured with valid_elements:'*[*]' +
    // paste_remove_styles:false. Lazy-init once per page; the editor
    // attaches to the <textarea id="tmplBodyHtmlEditor"> in settings.html.
    const TMCE_ID = 'tmplBodyHtmlEditor';
    let _tmceReady = null;

    function ensureTmce() {
        if (_tmceReady) return _tmceReady;
        if (typeof tinymce === 'undefined') {
            console.error('TinyMCE script not loaded');
            return Promise.resolve(null);
        }
        _tmceReady = tinymce.init({
            selector: '#' + TMCE_ID,
            license_key: 'gpl',
            height: 380,
            menubar: false,
            promotion: false,
            branding: false,
            statusbar: false,
            plugins: 'lists link image table code preview anchor autolink',
            toolbar: 'blocks | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright | bullist numlist | link image table | code preview',
            // 'wrap' makes overflow buttons spill onto a second toolbar row.
            // The default 'floating' shows them in a popup that detaches
            // from its trigger when the modal has any scroll — the visible
            // bug. 'wrap' keeps every button in DOM flow so there's nothing
            // to mis-position.
            toolbar_mode: 'wrap',
            // The whole point of the swap: keep every tag + attribute that
            // came in via paste. valid_elements/extended_valid_elements both
            // set to wildcard, paste_*_styles disabled. With these, an
            // Outlook unfurl card, a Drive share button, or a Mailchimp
            // template paste all survive untouched.
            valid_elements: '*[*]',
            extended_valid_elements: '*[*]',
            paste_remove_styles: false,
            paste_remove_styles_if_webkit: false,
            paste_webkit_styles: 'all',
            paste_data_images: true,
            paste_as_text: false,
            // Gmail/Outlook-style paste — no prompt, no floating "Link…"
            // button, native browser right-click menu.
            smart_paste: false,
            link_context_toolbar: false,
            contextmenu: '',
            link_default_target: '_blank',
            link_default_protocol: 'https',
            link_assume_external_targets: 'https',
            keep_styles: true,
            forced_root_block: 'p',
            element_format: 'html',
            // Disable TinyMCE's content sanitization that would otherwise
            // re-flow our table-based unfurl card.
            verify_html: false,
            cleanup: false,
            convert_urls: false,
            entity_encoding: 'raw',
            content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
            placeholder: 'Write the email body here. Use {{first_name}}, {{company}}, etc.',
            // When the editor sits inside a scrollable modal, TinyMCE's
            // body-level popup container (.tox-tinymce-aux) stays anchored
            // to the trigger's INITIAL screen position. Scrolling the modal
            // moves the trigger but the popup hangs in space. Close any
            // open popups on modal scroll — same pattern Notion uses.
            setup: function (editor) {
                editor.on('init', function () {
                    const modalBody = document.querySelector('#templateModal .gm-body');
                    if (!modalBody) return;
                    modalBody.addEventListener('scroll', function () {
                        // Force TinyMCE to drop any open menu/popup. Easiest
                        // path is dispatching a click outside the editor —
                        // TinyMCE's outside-click watcher closes every aux
                        // popup. Fall back to manually hiding the aux
                        // container if the synthetic click doesn't catch it.
                        try { editor.focus(); editor.selection.collapse(true); } catch (_) {}
                        document.querySelectorAll('.tox-tinymce-aux .tox-pop, .tox-tinymce-aux .tox-menu, .tox-tinymce-aux .tox-collection')
                            .forEach(function (el) { el.style.display = 'none'; });
                    }, { passive: true });
                });
            }
        }).then(eds => (eds && eds[0]) || tinymce.get(TMCE_ID));
        return _tmceReady;
    }

    function getEditorContent() {
        const ed = tinymce.get(TMCE_ID);
        return ed ? (ed.getContent() || '').trim() : (document.getElementById(TMCE_ID)?.value || '').trim();
    }
    function setEditorContent(html) {
        const ed = tinymce.get(TMCE_ID);
        if (ed) ed.setContent(html || '');
        else {
            const ta = document.getElementById(TMCE_ID);
            if (ta) ta.value = html || '';
        }
    }
    function insertIntoEditor(html) {
        const ed = tinymce.get(TMCE_ID);
        if (ed) ed.insertContent(html);
        else {
            const ta = document.getElementById(TMCE_ID);
            if (ta) ta.value = (ta.value || '') + html;
        }
    }

    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
        }[c]));
    }

    // Build the inline-styled card HTML that the email renders. Mirrors
    // Outlook's link-preview look (used as the visual reference): hero
    // image, blue bold title, blue description, rounded blue "View File →"
    // CTA. <table> layout because Outlook eats margin/padding on <div>s.
    function buildUnfurlCardHtml(meta) {
        const url   = escHtml(meta.url || '#');
        const title = escHtml(meta.og_title || meta.url || 'Open link');
        const desc  = escHtml(meta.og_description || '');
        const img   = meta.og_image ? escHtml(meta.og_image) : null;

        // Border + radius live on the outer <div> wrapper rather than the
        // <table> — table border-radius+overflow:hidden is unreliable across
        // browsers and bleeds a 1-2px dark line around the hero image. The
        // image gets its own top corners rounded so it clips cleanly.
        const heroRow = img
            ? `<tr><td style="padding:0;font-size:0;line-height:0;"><img src="${img}" alt="" style="display:block;width:100%;max-width:600px;border:0;outline:none;text-decoration:none;border-top-left-radius:10px;border-top-right-radius:10px;"/></td></tr>`
            : '';

        return [
            `<div style="max-width:600px;margin:12px 0;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">`,
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;background:#ffffff;">`,
            heroRow,
            `<tr><td style="padding:16px 20px 4px;font-size:15px;font-weight:600;color:#1d4ed8;line-height:1.35;">${title}</td></tr>`,
            desc ? `<tr><td style="padding:0 20px 12px;font-size:13px;color:#1d4ed8;line-height:1.5;">${desc}</td></tr>` : '',
            `<tr><td style="padding:0 20px 20px;"><a href="${url}" style="display:inline-block;padding:10px 22px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">View File &rarr;</a></td></tr>`,
            `</table>`,
            `</div>`
        ].join('');
    }

    // Pull the LAST http(s) URL out of an arbitrary block of text, plus
    // whatever comes before it. Lets the user paste a 2-line "filename —
    // Shared via X / URL" block and have the filename used as the card
    // title rather than the generic og:title.
    function parseLinkBlock(raw) {
        const text = (raw || '').trim();
        if (!text) return null;
        const urlRx = /(https?:\/\/[^\s<>"']+)/g;
        const matches = [...text.matchAll(urlRx)];
        if (matches.length === 0) return null;
        const last = matches[matches.length - 1];
        const url = last[1];
        // Strip the URL from the text, then split the remainder into title
        // and description on the first em/en/double-dash separator.
        let context = (text.slice(0, last.index) + text.slice(last.index + url.length))
            .replace(/[\r\n]+/g, '\n').trim();
        let title = '', desc = '';
        if (context) {
            const firstLine = context.split('\n')[0].trim();
            const sep = firstLine.match(/^(.*?)\s+(?:—|–|--|-)\s+(.*)$/);
            if (sep) { title = sep[1].trim(); desc = sep[2].trim(); }
            else      { title = firstLine; }
            // Lines after the first roll into description.
            const rest = context.split('\n').slice(1).join(' ').trim();
            if (rest) desc = (desc ? desc + ' ' : '') + rest;
        }
        return { url, userTitle: title, userDesc: desc };
    }

    function showInsertLinkModal() {
        // Build a tiny modal once and reuse. Native prompt() can't do
        // multi-line, and a real modal lets us preview parsed title /
        // description before committing.
        let modal = document.getElementById('tmplInsertLinkModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'tmplInsertLinkModal';
            modal.className = 'gm-overlay';
            modal.innerHTML = `
                <div class="gm-modal" style="max-width:560px;">
                    <div class="gm-header">
                        <h3 style="margin:0;">Insert link preview</h3>
                        <button class="gm-close" onclick="document.getElementById('tmplInsertLinkModal').classList.remove('active')">&times;</button>
                    </div>
                    <div class="gm-body">
                        <p class="form-help-text" style="color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 10px;">
                            Paste the file name + URL exactly as you want it to appear. The first line becomes the card title, anything after a dash becomes the subtitle, and the last URL is the View-File button. The hero image is auto-fetched from the URL's Open Graph tags.
                        </p>
                        <textarea id="tmplInsertLinkText" class="form-control" rows="5" spellcheck="false" placeholder="103240 wave 3 SPIRITS final report 09022026 short.pptx — Shared via Ragenaizer Drive
https://ragenaizer.com/pages/drive/shared.html?token=..." style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem;"></textarea>
                        <div id="tmplInsertLinkPreview" style="margin-top:10px; font-size:0.82rem; color:var(--text-secondary);"></div>
                    </div>
                    <div class="gm-footer">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('tmplInsertLinkModal').classList.remove('active')">Cancel</button>
                        <button type="button" class="btn btn-primary" id="tmplInsertLinkSubmit">Insert</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const input = modal.querySelector('#tmplInsertLinkText');
            const previewEl = modal.querySelector('#tmplInsertLinkPreview');
            const submit = modal.querySelector('#tmplInsertLinkSubmit');
            input.addEventListener('input', () => {
                const parsed = parseLinkBlock(input.value);
                if (!parsed) { previewEl.textContent = ''; return; }
                previewEl.innerHTML =
                    `<div><strong>URL:</strong> ${escHtml(parsed.url)}</div>` +
                    (parsed.userTitle ? `<div><strong>Title:</strong> ${escHtml(parsed.userTitle)}</div>` : '') +
                    (parsed.userDesc  ? `<div><strong>Subtitle:</strong> ${escHtml(parsed.userDesc)}</div>` : '');
            });
            submit.addEventListener('click', () => doInsertLinkCard(input.value));
        }
        modal.querySelector('#tmplInsertLinkText').value = '';
        modal.querySelector('#tmplInsertLinkPreview').innerHTML = '';
        modal.classList.add('active');
        setTimeout(() => modal.querySelector('#tmplInsertLinkText').focus(), 50);
    }

    async function doInsertLinkCard(rawText) {
        const parsed = parseLinkBlock(rawText);
        if (!parsed) {
            Toast.error('Paste at least one URL to insert a link preview.');
            return;
        }
        try {
            const meta = await api.request('/email-templates/unfurl?url=' + encodeURIComponent(parsed.url));
            if (!meta || meta.success === false) {
                Toast.error('Couldn\'t fetch link preview: ' + (meta && meta.error || 'unknown error'));
                return;
            }
            // User-supplied title / description WIN over og: defaults — the
            // generic "Shared File - Ragenaizer Drive" is useless when the
            // user already typed the actual filename.
            const merged = {
                url: parsed.url,
                og_title:       parsed.userTitle || meta.og_title,
                og_description: parsed.userDesc  || meta.og_description,
                og_image:       meta.og_image,
                og_site_name:   meta.og_site_name
            };
            const cardHtml = buildUnfurlCardHtml(merged);
            insertIntoEditor(cardHtml);
            const modal = document.getElementById('tmplInsertLinkModal');
            if (modal) modal.classList.remove('active');
            Toast.success('Link preview inserted.');
        } catch (e) {
            console.error(e);
            Toast.error('Couldn\'t fetch link preview: ' + (e.message || e));
        }
    }

    window.insertLinkPreviewCard = function () {
        showInsertLinkModal();
    };

    window.openTemplateModal = async function (id) {
        editingId = id || null;
        document.getElementById('templateModalTitle').textContent =
            id ? 'Edit template' : 'New template';

        let t = { name: '', subject: '', body_html: '', body_text: '', mailbox_id: null };
        if (id) {
            try {
                const resp = await api.request(`/email-templates/${id}`);
                if (resp && resp.template) t = resp.template;
            } catch (e) {
                Toast.error('Failed to load template: ' + (e.message || e));
                return;
            }
        }
        document.getElementById('tmplName').value = t.name || '';
        document.getElementById('tmplSubject').value = t.subject || '';
        document.getElementById('tmplBodyHtml').value = t.body_html || '';
        document.getElementById('tmplBodyText').value = t.body_text || '';
        document.getElementById('tmplModalError').style.display = 'none';

        // Phase 5: populate mailbox picker with shared mailboxes for this
        // tenant. Selecting empty = use tenant default at fire time.
        await populateMailboxOptions(t.mailbox_id || t.MailboxId || '');

        showModal('templateModal');

        // TinyMCE init MUST happen after the modal becomes visible — the
        // editor measures its host element on init and would compute zero
        // height if the parent is display:none. We resolve the lazy init
        // promise then push the body HTML in.
        ensureTmce().then(ed => {
            if (ed) ed.setContent(t.body_html || '');
            else setEditorContent(t.body_html || '');
        });
    };

    async function populateMailboxOptions(selectedId) {
        const sel = document.getElementById('tmplMailbox');
        if (!sel) return;
        // Reset to just the default option, then append CONFIGURED mailboxes.
        // The /shared-mailboxes catalog lists every shared mailbox the user
        // can see across the workspace; we want only the ones this tenant
        // has actually opted in to (tenant-default + per-flow attachments).
        sel.innerHTML = '<option value="">Tenant default mailbox</option>';
        try {
            const [defResp, attResp] = await Promise.all([
                api.request('/crm/mailbox-attachments/tenant-default').catch(() => ({})),
                api.request('/crm/mailbox-attachments/attachments').catch(() => ({})),
            ]);
            const seen = new Set();
            const list = [];
            const def = defResp?.mailbox;
            if (def && def.id) {
                list.push({ id: def.id, email_address: def.email_address, is_active: def.is_active !== false });
                seen.add(def.id);
            }
            for (const a of (attResp?.attachments || [])) {
                const id = a.mailbox_id || a.id;
                if (!id || seen.has(id)) continue;
                list.push({
                    id,
                    email_address: a.mailbox_email || a.email_address,
                    is_active: a.mailbox_is_active !== false
                });
                seen.add(id);
            }
            list.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                const inactive = m.is_active === false ? ' (inactive)' : '';
                opt.textContent = `${m.email_address}${inactive}`;
                if (m.is_active === false) opt.disabled = true;
                sel.appendChild(opt);
            });
        } catch (e) {
            console.warn('Failed to load configured mailboxes for template picker:', e);
        }
        sel.value = selectedId || '';
    }

    window.closeTemplateModal = function () {
        // Don't destroy the TinyMCE instance — keep it warm so reopening
        // the modal is instant and we don't pay a reinit cost each time.
        hideModal('templateModal');
    };

    window.saveTemplate = async function () {
        // TinyMCE owns the body HTML — getContent() returns the editor's
        // current source verbatim, including any inline styles preserved
        // through paste. Source view (the </> toolbar button) writes
        // straight back into the editor, so getContent() always reflects
        // whatever the user last saw.
        const bodyHtml = getEditorContent();
        document.getElementById('tmplBodyHtml').value = bodyHtml;
        const mailboxValue = document.getElementById('tmplMailbox').value.trim();
        const payload = {
            name: document.getElementById('tmplName').value.trim(),
            subject: document.getElementById('tmplSubject').value,
            body_html: bodyHtml,
            body_text: document.getElementById('tmplBodyText').value,
            // Empty string in the <select> means "use tenant default" → null.
            mailbox_id: mailboxValue ? mailboxValue : null,
        };
        if (!payload.name) {
            showTmplError('Name is required.');
            return;
        }
        if (!payload.body_html && !payload.body_text) {
            showTmplError('Provide at least HTML or plain-text body.');
            return;
        }
        try {
            if (editingId) {
                await api.request(`/email-templates/${editingId}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload),
                });
            } else {
                await api.request('/email-templates', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
            }
            hideModal('templateModal');
            await loadTemplatesTab();
        } catch (e) {
            showTmplError(e.message || String(e));
        }
    };

    window.deleteTemplate = async function (id) {
        const ok = await showConfirm(
            'Deactivate this template? Existing campaigns keep working; you just won\'t see it in the picker.',
            'Deactivate template',
            'warning'
        );
        if (!ok) return;
        try {
            await api.request(`/email-templates/${id}`, { method: 'DELETE' });
            Toast.success('Template deactivated');
            await loadTemplatesTab();
        } catch (e) {
            Toast.error('Delete failed: ' + (e.message || e));
        }
    };

    // ─── Preview ───────────────────────────────────────────────────────────

    window.previewTemplate = async function (id) {
        // Sample context — hardcoded representative values so templaters can
        // sanity-check rendering without hand-crafting sample data.
        const sample_context = {
            first_name: 'Jane',
            last_name: 'Doe',
            full_name: 'Jane Doe',
            company: 'Acme Corp',
            company_name: 'Acme Corp',
            job_title: 'Head of Marketing',
            city: 'Austin',
            country: 'USA',
            email: 'jane@acme.com',
        };
        try {
            const resp = await api.request(`/email-templates/${id}/preview`, {
                method: 'POST',
                body: JSON.stringify({ sample_context }),
            });
            document.getElementById('tmplPreviewSubject').textContent = resp.subject || '(no subject)';
            const frame = document.getElementById('tmplPreviewFrame');
            // Use srcdoc so template HTML is rendered in its own sandbox; no
            // stylesheet leak between preview and host page.
            frame.srcdoc = resp.body_html || `<pre>${escapeHtml(resp.body_text || '(empty)')}</pre>`;
            showModal('templatePreviewModal');
        } catch (e) {
            Toast.error('Preview failed: ' + (e.message || e));
        }
    };

    window.closeTemplatePreview = function () {
        hideModal('templatePreviewModal');
    };

    // ─── helpers ───────────────────────────────────────────────────────────

    function showTmplError(msg) {
        const el = document.getElementById('tmplModalError');
        el.textContent = msg;
        el.style.display = 'block';
    }
    function showModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.add('active');
    }
    function hideModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.remove('active');
    }
    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Auto-load if tab already active when script parses (handles SPA-ish
    // navigation race where settings.js fires DOMContentLoaded before us).
    function initIfActive() {
        const tab = document.getElementById('tab-templates');
        if (tab && tab.classList.contains('active')) window.loadTemplatesTab();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIfActive);
    else initIfActive();
})();
