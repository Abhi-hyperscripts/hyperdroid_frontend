// ============================================================================
// EmailComposer — shared "send email" modal used everywhere we need to
// compose an email. Mirrors the Email-service compose modal exactly so
// CRM/Accounts/anywhere-else feel identical:
//
//   • FROM dropdown row
//   • TO chip field with Cc/Bcc toggle on the right
//   • CC chip field (collapsed by default)
//   • BCC chip field (collapsed by default)
//   • SUBJECT row
//   • TinyMCE editor (paste-preserving config)
//   • Attach button bottom-left, Send button bottom-right
//
// Pages need to include:
//   <script src="https://cdn.jsdelivr.net/npm/tinymce@7/tinymce.min.js" referrerpolicy="origin"></script>
//   <link rel=stylesheet href=email-composer.css>
//   <script src=js/shared/email-composer.js></script>
//
// API:
//   EmailComposer.open({
//       title: 'New message' | 'Reply',
//       fromMailboxes: [{id, email}],        // populates FROM dropdown
//       selectedFromId: 'mb-id',
//       to: 'a@x.com' | ['a@x.com', 'b@y.com'],   // pre-populated chips
//       cc: [],                              // pre-populated chips (auto-expands the row)
//       bcc: [],
//       subject: 'Re: …',
//       initialBodyHtml: '<p>…</p>',
//       leadId: 'guid', inReplyTo: 'msg-id', // forwarded to onSend payload
//       onSend: async (payload) => {…}
//          payload: { fromId, to[], cc[], bcc[], subject, html, text,
//                     attachments[], leadId, inReplyTo }
//   });
// ============================================================================

(function (window, document) {
    'use strict';

    const TMCE_ID = 'emailComposerEditor';
    const MODAL_ID = 'emailComposerModal';
    const VALID_EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
    let _tmceReady = null;
    let _state = null;   // { onSend, leadId, inReplyTo, attachments[], recipients: {to[], cc[], bcc[]} }

    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // ─── Link-preview unfurl ───────────────────────────────────────────
    // Pulls the LAST URL out of an arbitrary block, plus user-supplied
    // title/description text above it. Mirrors the Settings → Templates
    // "Insert link preview" flow.
    function parseLinkBlock(raw) {
        const text = (raw || '').trim();
        if (!text) return null;
        const urlRx = /(https?:\/\/[^\s<>"']+)/g;
        const matches = [...text.matchAll(urlRx)];
        if (matches.length === 0) return null;
        const last = matches[matches.length - 1];
        const url = last[1];
        let context = (text.slice(0, last.index) + text.slice(last.index + url.length))
            .replace(/[\r\n]+/g, '\n').trim();
        let title = '', desc = '';
        if (context) {
            const firstLine = context.split('\n')[0].trim();
            const sep = firstLine.match(/^(.*?)\s+(?:—|–|--|-)\s+(.*)$/);
            if (sep) { title = sep[1].trim(); desc = sep[2].trim(); }
            else      { title = firstLine; }
            const rest = context.split('\n').slice(1).join(' ').trim();
            if (rest) desc = (desc ? desc + ' ' : '') + rest;
        }
        return { url, userTitle: title, userDesc: desc };
    }

    function buildUnfurlCardHtml(meta) {
        const url   = escHtml(meta.url || '#');
        const title = escHtml(meta.og_title || meta.url || 'Open link');
        const desc  = escHtml(meta.og_description || '');
        const img   = meta.og_image ? escHtml(meta.og_image) : null;
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

    async function openLinkPreviewPrompt(editor) {
        // Pre-seed the textarea with whatever's currently selected in the
        // editor — typical flow is the user pastes "filename — Shared via X /
        // URL" then clicks the toolbar button.
        let initial = '';
        try {
            const sel = editor.selection.getContent({ format: 'text' });
            if (sel && sel.trim()) initial = sel.trim();
        } catch (_) {}

        // Use TinyMCE's built-in dialog so we don't fight z-index with the
        // overlay. Returns a Promise<urlBlock> via dialog confirm.
        editor.windowManager.open({
            title: 'Insert link preview',
            size: 'normal',
            body: {
                type: 'panel',
                items: [
                    {
                        type: 'htmlpanel',
                        html: '<p style="margin:0 0 8px;font-size:13px;color:#475569;">Paste the file name + URL exactly as you want them to appear. The first line becomes the card title, anything after a dash becomes the subtitle, and the last URL is the View File button.</p>'
                    },
                    {
                        type: 'textarea',
                        name: 'block',
                        label: 'Content',
                        maximized: false
                    }
                ]
            },
            buttons: [
                { type: 'cancel', text: 'Cancel' },
                { type: 'submit', text: 'Insert', primary: true }
            ],
            initialData: { block: initial },
            onSubmit: async (api) => {
                const data = api.getData();
                const parsed = parseLinkBlock(data.block);
                if (!parsed) {
                    if (window.Toast) Toast.error('Paste at least one URL.');
                    return;
                }
                api.close();
                try {
                    const meta = await (window.api || (typeof api !== 'undefined' ? api : null)).request('/email-templates/unfurl?url=' + encodeURIComponent(parsed.url));
                    if (!meta || meta.success === false) {
                        if (window.Toast) Toast.error('Couldn\'t fetch link preview: ' + (meta && meta.error || 'unknown'));
                        return;
                    }
                    const merged = {
                        url: parsed.url,
                        og_title:       parsed.userTitle || meta.og_title,
                        og_description: parsed.userDesc  || meta.og_description,
                        og_image:       meta.og_image
                    };
                    editor.insertContent(buildUnfurlCardHtml(merged));
                    if (window.Toast) Toast.success('Link preview inserted');
                } catch (e) {
                    console.error(e);
                    if (window.Toast) Toast.error('Failed to fetch link preview: ' + (e.message || e));
                }
            }
        });
    }
    // ─────────────────────────────────────────────────────────────────────

    function buildModal() {
        const overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.className = 'email-cmp-overlay';
        overlay.innerHTML = `
            <div class="email-cmp-modal">
                <div class="email-cmp-header">
                    <h3 id="emailComposerTitle">New message</h3>
                    <button class="email-cmp-close" aria-label="Close">&times;</button>
                </div>
                <div class="email-cmp-body">
                    <div class="email-cmp-error" id="emailComposerError" style="display:none;"></div>

                    <div class="email-cmp-row">
                        <label>FROM</label>
                        <select class="email-cmp-input email-cmp-from" id="emailComposerFrom"></select>
                    </div>

                    <div class="email-cmp-row">
                        <label>TO</label>
                        <div class="email-cmp-chip-field" id="emailComposerToChips">
                            <input type="text" class="email-cmp-chip-input" id="emailComposerToInput" placeholder="Recipients (press Enter or comma)">
                        </div>
                        <button type="button" class="email-cmp-cc-toggle" id="emailComposerCcToggle">Cc/Bcc</button>
                    </div>

                    <div class="email-cmp-row" id="emailComposerCcRow" style="display:none;">
                        <label>CC</label>
                        <div class="email-cmp-chip-field" id="emailComposerCcChips">
                            <input type="text" class="email-cmp-chip-input" id="emailComposerCcInput" placeholder="Cc recipients">
                        </div>
                    </div>

                    <div class="email-cmp-row" id="emailComposerBccRow" style="display:none;">
                        <label>BCC</label>
                        <div class="email-cmp-chip-field" id="emailComposerBccChips">
                            <input type="text" class="email-cmp-chip-input" id="emailComposerBccInput" placeholder="Bcc recipients">
                        </div>
                    </div>

                    <div class="email-cmp-row">
                        <label>SUBJECT</label>
                        <input type="text" class="email-cmp-input" id="emailComposerSubject" placeholder="Add a subject">
                    </div>

                    <div class="email-cmp-editor-wrap">
                        <textarea id="${TMCE_ID}"></textarea>
                    </div>

                    <div class="email-cmp-attach-strip" id="emailComposerAttachStrip"></div>
                </div>
                <div class="email-cmp-footer">
                    <div class="footer-left">
                        <input type="file" id="emailComposerFileInput" multiple style="display:none;">
                        <button type="button" class="btn-attach" id="emailComposerAttachBtn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                            Attach
                        </button>
                    </div>
                    <button type="button" class="btn btn-secondary" id="emailComposerCancelBtn">Cancel</button>
                    <button type="button" class="btn-send" id="emailComposerSendBtn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        Send
                    </button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        // Close handlers
        overlay.querySelector('.email-cmp-close').addEventListener('click', close);
        overlay.querySelector('#emailComposerCancelBtn').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        // Send / attach
        overlay.querySelector('#emailComposerSendBtn').addEventListener('click', submit);
        overlay.querySelector('#emailComposerAttachBtn').addEventListener('click', () => {
            overlay.querySelector('#emailComposerFileInput').click();
        });
        overlay.querySelector('#emailComposerFileInput').addEventListener('change', onFiles);
        // Cc/Bcc toggle — first reveal Cc, second reveal Bcc (Gmail pattern)
        overlay.querySelector('#emailComposerCcToggle').addEventListener('click', () => {
            const ccRow = overlay.querySelector('#emailComposerCcRow');
            const bccRow = overlay.querySelector('#emailComposerBccRow');
            const tgl = overlay.querySelector('#emailComposerCcToggle');
            if (ccRow.style.display === 'none') {
                ccRow.style.display = '';
                tgl.textContent = 'Bcc';
                overlay.querySelector('#emailComposerCcInput').focus();
            } else if (bccRow.style.display === 'none') {
                bccRow.style.display = '';
                tgl.style.display = 'none';
                overlay.querySelector('#emailComposerBccInput').focus();
            }
        });
        // Wire chip fields
        wireChipField(overlay, 'to');
        wireChipField(overlay, 'cc');
        wireChipField(overlay, 'bcc');
        return overlay;
    }

    function wireChipField(overlay, kind) {
        const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
        const input = overlay.querySelector(`#emailComposer${cap}Input`);
        const addFromInput = () => {
            const raw = input.value;
            const tokens = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
            tokens.forEach(t => addRecipient(kind, t));
            input.value = '';
        };
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                e.preventDefault();
                addFromInput();
            } else if (e.key === 'Backspace' && input.value === '' && _state && _state.recipients[kind].length > 0) {
                _state.recipients[kind].pop();
                renderChips(kind);
            }
        });
        input.addEventListener('blur', () => {
            if (input.value.trim()) addFromInput();
        });
    }

    function addRecipient(kind, raw) {
        if (!_state) return;
        const parsed = parseEmailAddress(raw);
        const addr = parsed.email;
        if (!addr) return;
        if (_state.recipients[kind].some(a => a.toLowerCase() === addr.toLowerCase())) return;
        _state.recipients[kind].push(addr);
        renderChips(kind);
    }

    function renderChips(kind) {
        const field = document.getElementById(`emailComposer${kind.charAt(0).toUpperCase() + kind.slice(1)}Chips`);
        if (!field || !_state) return;
        const input = field.querySelector('.email-cmp-chip-input');
        field.querySelectorAll('.email-cmp-recipient-chip').forEach(el => el.remove());
        _state.recipients[kind].forEach((addr, idx) => {
            const chip = document.createElement('span');
            chip.className = 'email-cmp-recipient-chip' + (VALID_EMAIL_RE.test(addr) ? '' : ' invalid');
            chip.innerHTML = `${escHtml(addr)}<button type="button" aria-label="Remove">&times;</button>`;
            chip.querySelector('button').addEventListener('click', () => {
                _state.recipients[kind].splice(idx, 1);
                renderChips(kind);
            });
            field.insertBefore(chip, input);
        });
    }

    function ensureTmce() {
        if (_tmceReady) return _tmceReady;
        if (typeof window.tinymce === 'undefined') {
            console.error('TinyMCE script not loaded — include https://cdn.jsdelivr.net/npm/tinymce@7/tinymce.min.js');
            return Promise.resolve(null);
        }
        _tmceReady = window.tinymce.init({
            selector: '#' + TMCE_ID,
            license_key: 'gpl',
            height: 360,
            menubar: false, promotion: false, branding: false, statusbar: false,
            plugins: 'lists link image table code preview anchor autolink',
            toolbar: 'blocks | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright | bullist numlist | link image table | linkpreview unfurltoggle | code preview',
            toolbar_mode: 'wrap',
            valid_elements: '*[*]', extended_valid_elements: '*[*]',
            paste_remove_styles: false, paste_remove_styles_if_webkit: false,
            paste_webkit_styles: 'all', paste_data_images: true, paste_as_text: false,
            // Make paste behave like Gmail / Outlook:
            //   smart_paste:false       → no "Insert as link?" prompt on URL paste
            //   link_context_toolbar:false → no floating "Link…" button when a
            //                                pasted URL is auto-linked
            //   contextmenu:''          → use the native browser right-click
            //                             menu (Paste / Copy / etc.) instead
            //                             of TinyMCE's stripped-down replacement
            //   link_default_target / link_default_protocol → silently mark
            //                             pasted bare URLs as https links.
            smart_paste: false,
            link_context_toolbar: false,
            contextmenu: '',
            link_default_target: '_blank',
            link_default_protocol: 'https',
            link_assume_external_targets: 'https',
            keep_styles: true, forced_root_block: 'p', element_format: 'html',
            verify_html: false, cleanup: false, convert_urls: false, entity_encoding: 'raw',
            content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
            placeholder: 'Write your message…',
            setup: editor => {
                // Toolbar link-preview button + paste auto-unfurl come
                // from the shared helpers below — same code path the
                // Settings → Templates editor uses.
                attachLinkPreviewButton(editor);
                attachUnfurlToggle(editor);
                attachAutoUnfurl(editor);
                editor.on('init', () => {
                    const body = document.querySelector('#' + MODAL_ID + ' .email-cmp-body');
                    if (!body) return;
                    body.addEventListener('scroll', () => {
                        document.querySelectorAll('.tox-tinymce-aux .tox-pop, .tox-tinymce-aux .tox-menu, .tox-tinymce-aux .tox-collection')
                            .forEach(el => { el.style.display = 'none'; });
                    }, { passive: true });
                });
            }
        }).then(eds => (eds && eds[0]) || window.tinymce.get(TMCE_ID));
        return _tmceReady;
    }

    function getEditor() {
        return (typeof window.tinymce !== 'undefined') ? window.tinymce.get(TMCE_ID) : null;
    }

    function renderAttachments() {
        const strip = document.getElementById('emailComposerAttachStrip');
        if (!strip || !_state) return;
        strip.innerHTML = (_state.attachments || []).map((a, i) => `
            <span class="email-cmp-attach-chip">
                ${escHtml(a.name)}
                <span class="size">${(a.size/1024).toFixed(1)} KB</span>
                <button type="button" data-idx="${i}" aria-label="Remove">&times;</button>
            </span>`).join('');
        strip.querySelectorAll('button[data-idx]').forEach(btn => {
            btn.addEventListener('click', () => {
                _state.attachments.splice(+btn.dataset.idx, 1);
                renderAttachments();
            });
        });
    }

    function onFiles(ev) {
        const files = Array.from(ev.target.files || []);
        const promises = files.map(f => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
                name: f.name, size: f.size, type: f.type || 'application/octet-stream',
                base64: String(reader.result).split(',')[1] || ''
            });
            reader.onerror = reject;
            reader.readAsDataURL(f);
        }));
        Promise.all(promises).then(items => {
            _state.attachments = (_state.attachments || []).concat(items);
            renderAttachments();
        }).catch(e => {
            const err = document.getElementById('emailComposerError');
            if (err) {
                err.textContent = 'Failed to read file: ' + (e.message || e);
                err.style.display = 'block';
            }
        });
        ev.target.value = '';
    }

    function parseEmailAddress(raw) {
        if (!raw) return { email: '', name: null };
        const s = String(raw).trim();
        const m = s.match(/^\s*(?:"?([^"<>]*?)"?\s*)?<\s*([^<>\s]+)\s*>\s*$/);
        if (m) return { email: (m[2] || '').trim(), name: (m[1] || '').trim() || null };
        return { email: s, name: null };
    }

    function flushPendingChipInputs() {
        // If the user typed into a chip-input but didn't press Enter,
        // submit() should still treat that text as a recipient.
        ['to', 'cc', 'bcc'].forEach(kind => {
            const input = document.getElementById(`emailComposer${kind.charAt(0).toUpperCase() + kind.slice(1)}Input`);
            if (input && input.value.trim()) {
                input.value.split(/[,;]/).map(s => s.trim()).filter(Boolean)
                    .forEach(t => addRecipient(kind, t));
                input.value = '';
            }
        });
    }

    async function submit() {
        if (!_state) return;
        const errEl = document.getElementById('emailComposerError');
        errEl.style.display = 'none';
        const sendBtn = document.getElementById('emailComposerSendBtn');
        const originalLabel = sendBtn.innerHTML;

        flushPendingChipInputs();

        const fromId   = document.getElementById('emailComposerFrom').value;
        const subject  = document.getElementById('emailComposerSubject').value.trim();
        const ed       = getEditor();
        const html     = ed ? (ed.getContent() || '') : '';
        const text     = ed ? (ed.getContent({ format: 'text' }) || '').trim() : '';

        const showErr = (msg) => {
            errEl.textContent = msg;
            errEl.style.display = 'block';
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalLabel;
        };

        if (!fromId)  return showErr('Pick a sending mailbox.');
        if (_state.recipients.to.length === 0) return showErr('At least one recipient required.');
        if (!subject) return showErr('Subject is required.');
        if (!text)    return showErr('Message body is required.');

        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending…';
        try {
            await _state.onSend({
                fromId,
                to: _state.recipients.to[0],          // primary recipient (string)
                toAll: [..._state.recipients.to],     // full list (array)
                cc: [..._state.recipients.cc],
                bcc: [..._state.recipients.bcc],
                subject,
                html,
                text,
                attachments: _state.attachments || [],
                leadId: _state.leadId,
                inReplyTo: _state.inReplyTo
            });
            close();
        } catch (e) {
            showErr((e && e.message) ? e.message : 'Send failed');
        } finally {
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalLabel;
        }
    }

    function open(options) {
        _state = {
            attachments: [],
            recipients: { to: [], cc: [], bcc: [] },
            onSend: options.onSend,
            leadId: options.leadId,
            inReplyTo: options.inReplyTo
        };

        let modal = document.getElementById(MODAL_ID);
        if (!modal) modal = buildModal();

        document.getElementById('emailComposerTitle').textContent = options.title || 'New message';

        const fromSel = document.getElementById('emailComposerFrom');
        fromSel.innerHTML = '';
        (options.fromMailboxes || []).forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.email || m.email_address || '';
            fromSel.appendChild(opt);
        });
        if (options.selectedFromId) fromSel.value = options.selectedFromId;

        // Seed recipients
        const seed = (kind, val) => {
            if (!val) return;
            const arr = Array.isArray(val) ? val : [val];
            arr.forEach(v => addRecipient(kind, v));
        };
        seed('to', options.to);
        seed('cc', options.cc);
        seed('bcc', options.bcc);

        // Auto-expand CC/BCC if pre-populated
        const ccRow  = document.getElementById('emailComposerCcRow');
        const bccRow = document.getElementById('emailComposerBccRow');
        const tgl    = document.getElementById('emailComposerCcToggle');
        const hasCc  = _state.recipients.cc.length > 0;
        const hasBcc = _state.recipients.bcc.length > 0;
        ccRow.style.display  = hasCc  ? '' : 'none';
        bccRow.style.display = hasBcc ? '' : 'none';
        tgl.style.display    = (hasCc && hasBcc) ? 'none' : '';
        tgl.textContent      = hasCc ? 'Bcc' : 'Cc/Bcc';

        document.getElementById('emailComposerSubject').value = options.subject || '';
        document.getElementById('emailComposerError').style.display = 'none';

        renderAttachments();

        modal.classList.add('active');

        // TinyMCE init MUST happen after the modal becomes visible; it
        // measures the host's height on init and gets zeroed if hidden.
        ensureTmce().then(ed => {
            if (ed) {
                ed.setContent(options.initialBodyHtml || '');
                try { ed.focus(); } catch (_) {}
            }
        });
    }

    function close() {
        const modal = document.getElementById(MODAL_ID);
        if (modal) modal.classList.remove('active');
        _state = null;
    }

    // Public helpers — let other TinyMCE editors (e.g. Settings →
    // Templates body editor) reuse the same auto-unfurl + toolbar button
    // without re-implementing parseLinkBlock + the og:image fetch + DOM
    // swap. Call once inside TinyMCE init's setup callback.
    function attachAutoUnfurl(editor) {
        const tryOnPaste = (text) => {
            // Respect the per-compose link-preview toggle — the user can
            // turn auto-unfurl off via the toolbar paperclip icon when the
            // recipient prefers a plain hyperlink (some clients dislike
            // Outlook-style hero cards). The toolbar toggle in
            // attachUnfurlToggle flips editor.linkPreviewEnabled on the
            // editor instance so this check picks it up without state
            // plumbing through the composer wrapper.
            if (editor.linkPreviewEnabled === false) return;
            if (!text || !/https?:\/\//i.test(text)) return;
            setTimeout(() => unfurlAndReplaceInEditor(editor, text), 120);
        };
        editor.on('paste', evt => {
            const cd = evt.clipboardData || (evt.event && evt.event.clipboardData);
            tryOnPaste(cd && cd.getData ? cd.getData('text/plain') : '');
        });
        editor.on('PastePostProcess', e => {
            tryOnPaste((e.node && e.node.textContent) || '');
        });
        editor.on('init', () => {
            const doc = editor.getDoc();
            if (!doc) return;
            doc.addEventListener('paste', evt => {
                try {
                    const cd = evt.clipboardData;
                    tryOnPaste(cd && cd.getData ? cd.getData('text/plain') : '');
                } catch (e) { /* best-effort */ }
            }, true);
        });
    }

    function attachLinkPreviewButton(editor) {
        editor.ui.registry.addButton('linkpreview', {
            icon: 'browse',
            tooltip: 'Insert link preview (Outlook/Slack-style card)',
            onAction: () => openLinkPreviewPrompt(editor)
        });
    }

    // Per-compose toggle that controls whether pasted URLs auto-unfurl into
    // Outlook-style hero cards. Default ON (preserves the existing behaviour
    // and is what most recipients prefer). When OFF, pastes drop in as plain
    // hyperlinks and the user can still insert a card on demand via the
    // "linkpreview" button beside this toggle.
    function attachUnfurlToggle(editor) {
        // Default state lives on the editor instance — survives between
        // toolbar interactions without touching the composer's _state
        // (which is scoped to one open/close cycle).
        editor.linkPreviewEnabled = true;
        editor.ui.registry.addToggleButton('unfurltoggle', {
            icon: 'preview',
            tooltip: 'Auto-render link previews when pasting URLs',
            onAction: (api) => {
                editor.linkPreviewEnabled = !editor.linkPreviewEnabled;
                api.setActive(editor.linkPreviewEnabled);
            },
            onSetup: (api) => {
                api.setActive(editor.linkPreviewEnabled);
                return () => {};
            }
        });
    }

    async function unfurlAndReplaceInEditor(editor, text) {
        const parsed = parseLinkBlock(text);
        if (!parsed) return;
        const apiClient = (window.api || (typeof api !== 'undefined' ? api : null));
        if (!apiClient) return;
        try {
            const meta = await apiClient.request('/email-templates/unfurl?url=' + encodeURIComponent(parsed.url));
            if (!meta || meta.success === false) return;
            const merged = {
                url: parsed.url,
                og_title:       parsed.userTitle || meta.og_title,
                og_description: parsed.userDesc  || meta.og_description,
                og_image:       meta.og_image
            };
            const cardHtml = buildUnfurlCardHtml(merged);
            const body = editor.getBody();
            const escapedUrl = parsed.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const urlRx = new RegExp(escapedUrl);
            const blocks = body.querySelectorAll('p, div');
            for (const blk of blocks) {
                if (urlRx.test(blk.textContent || '')) {
                    const wrapper = editor.getDoc().createElement('div');
                    wrapper.innerHTML = cardHtml;
                    blk.parentNode.replaceChild(wrapper.firstChild, blk);
                    editor.fire('change');
                    break;
                }
            }
        } catch (err) { console.warn('[email-composer] auto-unfurl failed:', err); }
    }

    window.EmailComposer = {
        open, close,
        attachAutoUnfurl,
        attachLinkPreviewButton,
        // Lower-level helpers — exported so callers can build their own
        // toolbar dialogs / one-shot insertions.
        parseLinkBlock,
        buildUnfurlCardHtml
    };
})(window, document);
