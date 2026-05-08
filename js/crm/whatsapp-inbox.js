/**
 * CRM WhatsApp Inbox.
 *
 * Three layers:
 *  1) REST (CRM proxy → NotificationService gRPC) for the snapshot:
 *     numbers, conversations, thread, send.
 *  2) SignalR (CrmHub) for live deltas: subscribes via JoinWhatsApp,
 *     listens for WhatsAppMessageReceived and patches the open thread +
 *     reorders the conversation list.
 *  3) Local state cached in module scope (no Vuex needed for this page).
 *
 * Multi-number tenant support:
 *  - 0 numbers configured → show "connect a number" empty state.
 *  - 1 number → auto-pick, hide the picker.
 *  - 2+ numbers → SearchableDropdown to switch (also auto-picks the first
 *    active one). Switching number reloads the conversation list.
 *  - All sends carry the picked business_phone_number so NS routes via
 *    the right credential row.
 */
(function () {
    'use strict';

    // ─── State ──────────────────────────────────────────────────────────────
    let allNumbers = [];          // [{businessPhoneNumber, isActive, displayHint, createdAt}]
    let activeBusinessPhone = ''; // currently picked outbound number
    let conversations = [];       // [{customerPhone, customerName, lastMessageBody, lastMessageAtUtc, lastMessageDirection}]
    let activeCustomerPhone = ''; // currently open thread
    let threadMessages = [];      // messages for the active thread
    let connection = null;        // SignalR
    let numberDropdown = null;    // SearchableDropdown instance for the picker

    // Pending attachment in the composer. Holds the *uploaded* state so the
    // user can preview it, change the caption, and Send when ready. Cleared
    // on send / remove / thread switch.
    //   { fileId, mediaUrl, mediaType, fileName, contentType, fileSize, previewBlobUrl }
    let pendingAttachment = null;

    // Interakt limits per WhatsApp's BSP rules (in bytes). Audio caps at 16MB
    // but document caps at 100MB; the picker also restricts MIME.
    const MAX_FILE_BYTES = 100 * 1024 * 1024;

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        if (typeof Navigation !== 'undefined') Navigation.init();
        await ensureLoggedIn();
        wireDomEvents();
        await loadNumbers();
        await connectSignalR();
    }

    function ensureLoggedIn() {
        const tok = localStorage.getItem('ragenaizer_authToken') || localStorage.getItem('authToken');
        if (!tok) {
            window.location.href = '/pages/login.html';
            return new Promise(() => {});
        }
        return Promise.resolve();
    }

    function wireDomEvents() {
        const composer = document.getElementById('waComposer');
        if (composer) {
            composer.addEventListener('submit', handleSendSubmit);
        }
        const ta = document.getElementById('waComposerInput');
        if (ta) {
            // Auto-grow textarea up to max-height set in CSS.
            ta.addEventListener('input', () => autoSizeTextarea(ta));
            // Cmd/Ctrl + Enter or Enter (without Shift) submits.
            ta.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    composer.dispatchEvent(new Event('submit', { cancelable: true }));
                }
            });
        }
        const search = document.getElementById('waSearchInput');
        if (search) {
            search.addEventListener('input', () => renderConversationList(filterConversations(search.value)));
        }
        const back = document.getElementById('waBackBtn');
        if (back) {
            back.addEventListener('click', () => {
                document.getElementById('waShell')?.classList.remove('has-active-thread');
            });
        }
        const attachBtn = document.getElementById('waAttachBtn');
        const fileInput = document.getElementById('waFileInput');
        if (attachBtn && fileInput) {
            attachBtn.addEventListener('click', () => {
                if (!activeCustomerPhone) {
                    if (typeof Toast !== 'undefined') Toast.warning('Pick a conversation first');
                    return;
                }
                fileInput.value = '';   // allow re-picking the same file
                fileInput.click();
            });
            fileInput.addEventListener('change', handleFilePicked);
        }
    }

    function autoSizeTextarea(ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
    }

    // ─── Numbers ────────────────────────────────────────────────────────────

    async function loadNumbers() {
        const resp = await api.request('/whatsapp/numbers');
        // CRM serializes snake_case but we keep camelCase aliases on every
        // record so consumers downstream can read either shape unchanged.
        allNumbers = ((resp && resp.numbers) ? resp.numbers : []).map(n => ({
            businessPhoneNumber: n.business_phone_number ?? n.businessPhoneNumber ?? '',
            isActive: n.is_active ?? n.isActive ?? false,
            displayHint: n.display_hint ?? n.displayHint ?? '',
            createdAt: n.created_at ?? n.createdAt ?? '',
        }));
        const activeNumbers = allNumbers.filter(n => n.isActive);

        const picker = document.getElementById('waNumberPicker');
        const noNumbers = document.getElementById('waNoNumbers');
        const sidebarEmpty = document.getElementById('waSidebarEmpty');

        if (allNumbers.length === 0 || activeNumbers.length === 0) {
            // Show "connect a number" inside the sidebar
            noNumbers.style.display = '';
            sidebarEmpty.style.display = 'none';
            picker.style.display = 'none';
            return;
        }
        noNumbers.style.display = 'none';

        // Default = first active number; remember last pick if user has switched
        // before (per-tenant — tenantId in JWT). Cheap session storage.
        const remembered = sessionStorage.getItem('crm_wa_active_business_phone');
        const defaultPick = activeNumbers.find(n => n.businessPhoneNumber === remembered)?.businessPhoneNumber
                            || activeNumbers[0].businessPhoneNumber;
        activeBusinessPhone = defaultPick;

        if (activeNumbers.length === 1) {
            picker.style.display = 'none';
        } else {
            picker.style.display = '';
            buildNumberPicker(activeNumbers);
        }

        await loadConversations();
    }

    function buildNumberPicker(numbers) {
        const container = document.getElementById('waNumberPickerContainer');
        if (!container) return;
        // Re-build on each call so the option list is fresh.
        container.innerHTML = '';
        numberDropdown = new SearchableDropdown(container, {
            options: numbers.map(n => ({
                value: n.businessPhoneNumber,
                label: formatPhone(n.businessPhoneNumber),
                description: n.displayHint || ''
            })),
            placeholder: 'Pick a number',
            searchPlaceholder: 'Search numbers…',
            onChange: async (value) => {
                if (value && value !== activeBusinessPhone) {
                    activeBusinessPhone = value;
                    sessionStorage.setItem('crm_wa_active_business_phone', value);
                    await loadConversations();
                    // Switching number invalidates the open thread.
                    activeCustomerPhone = '';
                    threadMessages = [];
                    renderThreadHeader(null);
                    renderThread();
                }
            }
        });
        numberDropdown.setValue(activeBusinessPhone);
    }

    // ─── Conversations ──────────────────────────────────────────────────────

    async function loadConversations() {
        if (!activeBusinessPhone) return;
        try {
            const resp = await api.request(`/whatsapp/conversations?businessPhoneNumber=${encodeURIComponent(activeBusinessPhone)}`);
            const raw = (resp && resp.conversations) ? resp.conversations : [];
            conversations = raw.map(c => ({
                customerPhone: c.customer_phone ?? c.customerPhone ?? '',
                customerName: c.customer_name ?? c.customerName ?? '',
                lastMessageId: c.last_message_id ?? c.lastMessageId ?? '',
                lastMessageBody: c.last_message_body ?? c.lastMessageBody ?? '',
                lastMessageAtUtc: c.last_message_at_utc ?? c.lastMessageAtUtc ?? '',
                lastMessageDirection: c.last_message_direction ?? c.lastMessageDirection ?? '',
            }));
        } catch (err) {
            console.error('[wa-inbox] loadConversations failed:', err);
            conversations = [];
            if (typeof Toast !== 'undefined') Toast.error('Failed to load conversations');
        }
        renderConversationList(conversations);
    }

    function filterConversations(q) {
        const term = (q || '').toLowerCase().trim();
        if (!term) return conversations;
        return conversations.filter(c => {
            return (c.customerPhone || '').toLowerCase().includes(term)
                || (c.customerName || '').toLowerCase().includes(term)
                || (c.lastMessageBody || '').toLowerCase().includes(term);
        });
    }

    function renderConversationList(list) {
        const ul = document.getElementById('waConvList');
        const empty = document.getElementById('waSidebarEmpty');
        if (!ul) return;

        if (!list || list.length === 0) {
            ul.innerHTML = '';
            empty.style.display = '';
            return;
        }
        empty.style.display = 'none';
        ul.innerHTML = list.map(renderConvItem).join('');
        // Wire click handlers (delegation-free for clarity)
        ul.querySelectorAll('.wa-conv-item').forEach(li => {
            li.addEventListener('click', () => openConversation(li.dataset.phone, li.dataset.name || ''));
        });
    }

    function renderConvItem(c) {
        const escName = (c.customerName || '').replace(/"/g, '&quot;');
        const phone = c.customerPhone || '';
        const escPhone = phone.replace(/"/g, '&quot;');
        const isActive = phone === activeCustomerPhone ? ' active' : '';
        const display = c.customerName && c.customerName.trim()
            ? c.customerName
            : formatPhone(phone);
        const initial = (display || '?').trim().charAt(0).toUpperCase() || '?';
        const time = formatRelativeTime(c.lastMessageAtUtc);
        const previewRaw = c.lastMessageBody || '';
        const previewPrefix = c.lastMessageDirection === 'outbound' ? 'You: ' : '';
        const preview = escapeHtml(previewPrefix + (previewRaw.length > 80 ? previewRaw.slice(0, 80) + '…' : previewRaw))
                        || '<em style="color:var(--text-secondary);">(media or empty)</em>';
        return `
            <li class="wa-conv-item${isActive}" data-phone="${escPhone}" data-name="${escName}">
                <div class="wa-avatar">${initial}</div>
                <div class="wa-conv-meta">
                    <div class="wa-conv-name">
                        <span>${escapeHtml(display)}</span>
                        <span class="wa-conv-time">${time}</span>
                    </div>
                    <div class="wa-conv-preview">${preview}</div>
                </div>
            </li>
        `;
    }

    // ─── Thread ─────────────────────────────────────────────────────────────

    async function openConversation(customerPhone, customerName) {
        if (!customerPhone) return;
        // Switching threads invalidates any in-flight composer attachment.
        clearPendingAttachment();
        activeCustomerPhone = customerPhone;
        document.getElementById('waShell')?.classList.add('has-active-thread');
        renderThreadHeader({ customerPhone, customerName });

        const messagesDiv = document.getElementById('waMessages');
        if (messagesDiv) messagesDiv.innerHTML = '<div class="wa-loading">Loading…</div>';

        try {
            const resp = await api.request(
                `/whatsapp/thread?businessPhoneNumber=${encodeURIComponent(activeBusinessPhone)}`
                + `&customerPhone=${encodeURIComponent(customerPhone)}`);
            const raw = (resp && resp.messages) ? resp.messages : [];
            // Server returns newest-first; the inbox renders oldest-at-top so we reverse.
            threadMessages = raw.slice().reverse().map(m => ({
                id: m.id,
                direction: m.direction,
                messageType: m.message_type ?? m.messageType ?? 'text',
                body: m.body,
                mediaUrl: m.media_url ?? m.mediaUrl ?? '',
                status: m.status,
                receivedAtUtc: m.received_at_utc ?? m.receivedAtUtc ?? '',
                sentAtUtc: m.sent_at_utc ?? m.sentAtUtc ?? '',
                createdAtUtc: m.created_at_utc ?? m.createdAtUtc ?? '',
            }));
        } catch (err) {
            console.error('[wa-inbox] thread load failed:', err);
            threadMessages = [];
            if (typeof Toast !== 'undefined') Toast.error('Failed to load thread');
        }
        renderThread();
        renderConversationList(filterConversations(document.getElementById('waSearchInput')?.value));
        showComposer(true);
    }

    function renderThreadHeader(thread) {
        const titleEl = document.getElementById('waThreadTitle');
        const subEl = document.getElementById('waThreadSub');
        if (!titleEl || !subEl) return;
        if (!thread) {
            titleEl.textContent = 'Pick a conversation';
            subEl.textContent = '';
            return;
        }
        const display = (thread.customerName && thread.customerName.trim())
            ? thread.customerName
            : formatPhone(thread.customerPhone);
        titleEl.textContent = display;
        subEl.textContent = formatPhone(thread.customerPhone);
    }

    function renderThread() {
        const messagesDiv = document.getElementById('waMessages');
        const empty = document.getElementById('waThreadEmpty');
        if (!messagesDiv) return;

        if (!activeCustomerPhone) {
            messagesDiv.innerHTML = '';
            empty.style.display = '';
            messagesDiv.appendChild(empty);
            return;
        }
        if (threadMessages.length === 0) {
            messagesDiv.innerHTML = '<div class="wa-loading">No messages yet — send the first reply below.</div>';
            return;
        }
        messagesDiv.innerHTML = threadMessages.map(renderMessage).join('');
        // Scroll to bottom
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function renderMessage(m) {
        const dir = (m.direction || '').toLowerCase();
        const cls = dir === 'outbound' ? 'outbound' : 'inbound';
        const ts = m.receivedAtUtc || m.sentAtUtc || m.createdAtUtc;
        const status = dir === 'outbound' ? ` · ${escapeHtml(m.status || '')}` : '';
        const meta = `<span class="wa-msg-meta">${formatTimeOfDay(ts)}${status}</span>`;
        const type = (m.messageType || 'text').toLowerCase();

        // Caption goes BELOW the media (matches WhatsApp's own layout).
        const captionHtml = m.body
            ? `<span class="wa-bubble-caption">${escapeHtml(m.body)}</span>`
            : '';

        if (type === 'image' && m.mediaUrl) {
            return `
                <div class="wa-msg-row ${cls}">
                    <div class="wa-bubble wa-bubble-media">
                        <img src="${escapeAttr(m.mediaUrl)}" alt="image" loading="lazy"
                             onclick="window.open(this.src,'_blank')">
                        ${captionHtml}${meta}
                    </div>
                </div>`;
        }
        if (type === 'video' && m.mediaUrl) {
            return `
                <div class="wa-msg-row ${cls}">
                    <div class="wa-bubble wa-bubble-media">
                        <video src="${escapeAttr(m.mediaUrl)}" controls preload="metadata"></video>
                        ${captionHtml}${meta}
                    </div>
                </div>`;
        }
        if (type === 'audio' && m.mediaUrl) {
            return `
                <div class="wa-msg-row ${cls}">
                    <div class="wa-bubble wa-bubble-media">
                        <audio src="${escapeAttr(m.mediaUrl)}" controls preload="metadata"></audio>
                        ${meta}
                    </div>
                </div>`;
        }
        if (type === 'document' && m.mediaUrl) {
            const fileLabel = inferFileNameFromUrl(m.mediaUrl) || 'Document';
            return `
                <div class="wa-msg-row ${cls}">
                    <div class="wa-bubble wa-bubble-media">
                        <a class="wa-bubble-doc" href="${escapeAttr(m.mediaUrl)}" target="_blank" rel="noopener">
                            <span class="wa-bubble-doc-icon">📄</span>
                            <span class="wa-bubble-doc-name">${escapeHtml(fileLabel)}</span>
                        </a>
                        ${captionHtml}${meta}
                    </div>
                </div>`;
        }
        // Fallback: text (or media row with no URL)
        const body = m.body ? escapeHtml(m.body) : (m.mediaUrl ? '<em>(media)</em>' : '<em>(empty)</em>');
        return `
            <div class="wa-msg-row ${cls}">
                <div class="wa-bubble">
                    ${body}
                    ${meta}
                </div>
            </div>
        `;
    }

    function inferFileNameFromUrl(url) {
        try {
            const u = new URL(url);
            const last = decodeURIComponent(u.pathname.split('/').pop() || '');
            // Drive S3 keys look like "whatsapp/20260101_abc_filename.ext".
            // Strip the timestamp_id_ prefix for nicer display.
            const m = last.match(/^\d{6,}_[a-z0-9]+_(.+)$/i);
            return m ? m[1] : last;
        } catch {
            return '';
        }
    }

    function escapeAttr(s) {
        return String(s || '').replace(/"/g, '&quot;');
    }

    function showComposer(show) {
        document.getElementById('waComposer').style.display = show ? '' : 'none';
        document.getElementById('waComposerDisabledNote').style.display = show ? 'none' : '';
    }

    // ─── Attachments ────────────────────────────────────────────────────────

    // Map a MIME type to (mediaType for our API, isAllowed). Only WhatsApp-
    // supported MIMEs are allowed; everything else is rejected up front.
    function classifyAttachment(file) {
        const mime = (file.type || '').toLowerCase();
        const name = (file.name || '').toLowerCase();
        const ext  = name.includes('.') ? name.split('.').pop() : '';
        if (mime.startsWith('image/'))  return { mediaType: 'image',    ok: ['jpeg','png','webp'].some(t => mime === 'image/' + t) };
        if (mime.startsWith('video/'))  return { mediaType: 'video',    ok: ['mp4','3gpp'].some(t => mime === 'video/' + t) };
        if (mime.startsWith('audio/'))  return { mediaType: 'audio',    ok: ['mpeg','aac','ogg','amr'].some(t => mime === 'audio/' + t) };
        // documents — accept by extension since browsers don't always report MIME
        if (mime === 'application/pdf' || ext === 'pdf') return { mediaType: 'document', ok: true };
        const docExts = ['doc','docx','xls','xlsx','ppt','pptx','txt'];
        if (docExts.includes(ext)) return { mediaType: 'document', ok: true };
        return { mediaType: 'document', ok: false };
    }

    async function handleFilePicked(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const cls = classifyAttachment(file);
        if (!cls.ok) {
            if (typeof Toast !== 'undefined') Toast.error(`Unsupported file type for WhatsApp: ${file.type || 'unknown'}`);
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            if (typeof Toast !== 'undefined') Toast.error('File too large (limit 100MB).');
            return;
        }

        // Local preview using a blob URL — released when send/remove fires.
        const previewBlobUrl = URL.createObjectURL(file);
        pendingAttachment = {
            mediaType: cls.mediaType,
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            fileSize: file.size,
            previewBlobUrl,
            fileId: null,
            mediaUrl: null,
            uploading: true,
        };
        renderAttachPreview(0);

        try {
            // 1) Ask Drive for a presigned PUT
            const upResp = await api.request('/drive/whatsapp/upload-url', {
                method: 'POST',
                body: JSON.stringify({
                    file_name: file.name,
                    content_type: pendingAttachment.contentType,
                    file_size: file.size,
                    expiry_minutes: 30,
                })
            });
            if (!upResp || upResp.success === false || !upResp.upload_url) {
                throw new Error(upResp?.message || 'Failed to get upload URL');
            }
            // 2) PUT the bytes straight to S3 with progress
            await putWithProgress(upResp.upload_url, file, pct => renderAttachPreview(pct));
            pendingAttachment.fileId = upResp.file_id;

            // 3) Get a presigned GET URL for Interakt to fetch.
            //    The S3 key carries embedded slashes ("whatsapp/{tenantId}/...") which
            //    must remain real path separators for the catch-all route to bind —
            //    encode each segment without encoding the slashes themselves.
            const safeKey = String(upResp.file_id).split('/').map(encodeURIComponent).join('/');
            const dlResp = await api.request(
                `/drive/whatsapp/download/${safeKey}?expiry_minutes=30`,
                { method: 'GET' }
            );
            if (!dlResp || dlResp.success === false || !dlResp.url) {
                throw new Error(dlResp?.message || 'Failed to get download URL');
            }
            pendingAttachment.mediaUrl = dlResp.url;
            pendingAttachment.uploading = false;
            renderAttachPreview(100);
        } catch (err) {
            console.error('[wa-inbox] upload failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Upload failed');
            clearPendingAttachment();
        }
    }

    function putWithProgress(url, file, onPct) {
        // Use XHR (not fetch) because we need progress events.
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.upload.onprogress = e => {
                if (e.lengthComputable && onPct) onPct(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else reject(new Error(`S3 upload failed: HTTP ${xhr.status}`));
            };
            xhr.onerror = () => reject(new Error('S3 upload network error'));
            xhr.send(file);
        });
    }

    function renderAttachPreview(pct) {
        const el = document.getElementById('waAttachPreview');
        if (!el || !pendingAttachment) return;
        const a = pendingAttachment;
        let thumb = '';
        if (a.mediaType === 'image') {
            thumb = `<img src="${a.previewBlobUrl}" alt="">`;
        } else if (a.mediaType === 'video') {
            thumb = `<video src="${a.previewBlobUrl}" muted></video>`;
        } else {
            thumb = `<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:var(--bg-tertiary);border-radius:4px;">📎</div>`;
        }
        const sizeKb = Math.max(1, Math.round(a.fileSize / 1024));
        const progressBar = a.uploading
            ? `<div class="wa-attach-progress"><span style="width:${pct || 0}%;"></span></div>`
            : '';
        el.innerHTML = `
            ${thumb}
            <div class="wa-attach-preview-meta">
                <div class="wa-attach-preview-name">${escapeHtml(a.fileName)}</div>
                <div class="wa-attach-preview-info">${a.mediaType} · ${sizeKb} KB${a.uploading ? ` · uploading ${pct || 0}%` : ' · ready'}</div>
                ${progressBar}
            </div>
            <button type="button" class="wa-attach-preview-remove" id="waAttachRemove" title="Remove">×</button>
        `;
        el.style.display = '';
        document.getElementById('waAttachRemove')?.addEventListener('click', clearPendingAttachment);
    }

    function clearPendingAttachment() {
        if (pendingAttachment?.previewBlobUrl) URL.revokeObjectURL(pendingAttachment.previewBlobUrl);
        pendingAttachment = null;
        const el = document.getElementById('waAttachPreview');
        if (el) { el.innerHTML = ''; el.style.display = 'none'; }
        const fileInput = document.getElementById('waFileInput');
        if (fileInput) fileInput.value = '';
    }

    // ─── Send ───────────────────────────────────────────────────────────────

    async function handleSendSubmit(e) {
        e.preventDefault();
        const ta = document.getElementById('waComposerInput');
        const text = (ta?.value || '').trim();
        if (!activeCustomerPhone || !activeBusinessPhone) return;

        // Three send modes:
        //   1. Text-only (no attachment, body required)
        //   2. Media + caption (attachment uploaded, optional caption from text box)
        //   3. Media-only (attachment uploaded, empty text)
        const hasAttach = !!pendingAttachment && !pendingAttachment.uploading && !!pendingAttachment.mediaUrl;
        if (!hasAttach && !text) return;
        if (pendingAttachment && pendingAttachment.uploading) {
            if (typeof Toast !== 'undefined') Toast.warning('Wait for the upload to finish');
            return;
        }

        const sendBtn = document.getElementById('waSendBtn');
        if (sendBtn) sendBtn.disabled = true;

        const optimisticId = 'opt-' + Date.now();
        const optimistic = hasAttach ? {
            id: optimisticId,
            direction: 'outbound',
            messageType: pendingAttachment.mediaType,
            body: text,                           // caption
            mediaUrl: pendingAttachment.previewBlobUrl,   // local preview while sending
            status: 'sending',
            createdAtUtc: new Date().toISOString(),
        } : {
            id: optimisticId,
            direction: 'outbound',
            messageType: 'text',
            body: text,
            status: 'sending',
            createdAtUtc: new Date().toISOString(),
        };
        threadMessages.push(optimistic);
        renderThread();
        ta.value = '';
        autoSizeTextarea(ta);

        try {
            const cc = guessCountryCode(activeCustomerPhone);
            const local = activeCustomerPhone.startsWith(cc)
                ? activeCustomerPhone.slice(cc.length)
                : activeCustomerPhone;

            const payload = {
                business_phone_number: activeBusinessPhone,
                recipient_country_code: '+' + cc,
                recipient_phone: local,
                message_type: hasAttach ? pendingAttachment.mediaType : 'text',
                body: hasAttach ? '' : text,
                media_url: hasAttach ? pendingAttachment.mediaUrl : '',
                caption: hasAttach ? text : '',
            };
            const resp = await api.request('/whatsapp/send', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const wamId = resp.whatsapp_message_id ?? resp.whatsappMessageId ?? optimisticId;
            const status = resp.status || 'sent';
            const idx = threadMessages.findIndex(m => m.id === optimisticId);
            if (idx >= 0) {
                threadMessages[idx] = {
                    id: wamId,
                    direction: 'outbound',
                    messageType: payload.message_type,
                    body: hasAttach ? text : text,
                    mediaUrl: hasAttach ? pendingAttachment.mediaUrl : '',
                    status,
                    sentAtUtc: new Date().toISOString(),
                    createdAtUtc: optimistic.createdAtUtc,
                };
            }
            const previewLine = hasAttach
                ? (text || `(${pendingAttachment.mediaType})`)
                : text;
            // Drop the preview blob — the real S3 URL lives on the message now.
            if (hasAttach) clearPendingAttachment();
            renderThread();
            bumpConversationToTop(activeCustomerPhone, previewLine, 'outbound');
            renderConversationList(filterConversations(document.getElementById('waSearchInput')?.value));
            if (status !== 'sent' && typeof Toast !== 'undefined') {
                Toast.warning(resp.message || `Provider returned ${status}`);
            }
        } catch (err) {
            console.error('[wa-inbox] send failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Send failed');
            const idx = threadMessages.findIndex(m => m.id === optimisticId);
            if (idx >= 0) {
                threadMessages[idx].status = 'failed';
                renderThread();
            }
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    function bumpConversationToTop(customerPhone, lastBody, direction) {
        const idx = conversations.findIndex(c => c.customerPhone === customerPhone);
        let conv;
        if (idx >= 0) {
            conv = conversations[idx];
            conversations.splice(idx, 1);
        } else {
            conv = { customerPhone, customerName: '' };
        }
        conv.lastMessageBody = lastBody;
        conv.lastMessageDirection = direction;
        conv.lastMessageAtUtc = new Date().toISOString();
        conversations.unshift(conv);
    }

    // ITU-T E.164 country calling codes. NANP (`1`) and Russia/Kazakhstan (`7`)
    // are the only single-digit codes and don't collide with any 2/3-digit
    // prefix, so they short-circuit. Everything else uses longest-prefix match.
    const COUNTRY_CODES = new Set([
        // 3-digit
        '211','212','213','216','218',
        '220','221','222','223','224','225','226','227','228','229',
        '230','231','232','233','234','235','236','237','238','239',
        '240','241','242','243','244','245','246','247','248','249',
        '250','251','252','253','254','255','256','257','258','260',
        '261','262','263','264','265','266','267','268','269',
        '290','291','297','298','299',
        '350','351','352','353','354','355','356','357','358','359',
        '370','371','372','373','374','375','376','377','378','380',
        '381','382','383','385','386','387','389',
        '420','421','423',
        '500','501','502','503','504','505','506','507','508','509',
        '590','591','592','593','594','595','596','597','598','599',
        '670','672','673','674','675','676','677','678','679',
        '680','681','682','683','685','686','687','688','689',
        '690','691','692',
        '850','852','853','855','856','880','886',
        '960','961','962','963','964','965','966','967','968',
        '970','971','972','973','974','975','976','977',
        '992','993','994','995','996','998',
        // 2-digit
        '20','27','30','31','32','33','34','36','39',
        '40','41','43','44','45','46','47','48','49',
        '51','52','53','54','55','56','57','58',
        '60','61','62','63','64','65','66',
        '81','82','84','86',
        '90','91','92','93','94','95','98'
    ]);

    function guessCountryCode(digits) {
        if (!digits) return '';
        if (digits[0] === '1') return '1';
        if (digits[0] === '7') return '7';
        for (const len of [3, 2]) {
            const prefix = digits.slice(0, len);
            if (COUNTRY_CODES.has(prefix)) return prefix;
        }
        return digits.slice(0, 2);
    }

    // ─── SignalR ────────────────────────────────────────────────────────────

    async function connectSignalR() {
        try {
            const baseUrl = (CONFIG.endpoints && CONFIG.endpoints.crm) || 'https://localhost:5113';
            const tok = localStorage.getItem('ragenaizer_authToken') || localStorage.getItem('authToken');
            connection = new signalR.HubConnectionBuilder()
                .withUrl(`${baseUrl}/hubs/crm`, {
                    accessTokenFactory: () => tok || ''
                })
                .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
                .build();

            connection.on('WhatsAppMessageReceived', onWhatsAppMessageReceived);

            connection.onreconnected(async () => {
                try { await connection.invoke('JoinWhatsApp'); } catch {}
            });

            await connection.start();
            await connection.invoke('JoinWhatsApp');
        } catch (err) {
            console.warn('[wa-inbox] SignalR connect failed (live updates disabled):', err);
        }
    }

    function previewLineFor(body, mediaUrl, messageType) {
        if (body) return body;
        const t = (messageType || '').toLowerCase();
        if (t && t !== 'text') return `(${t})`;
        if (mediaUrl) return '(media)';
        return '';
    }

    function onWhatsAppMessageReceived(ev) {
        // Filter to the active business phone only — multi-number tenants get
        // events for ALL their numbers on the same hub group.
        if (!ev || ev.businessPhoneNumber !== activeBusinessPhone) return;

        // If this is for the open thread, append; else just bump the list.
        if (ev.customerPhone === activeCustomerPhone) {
            threadMessages.push({
                id: ev.id,
                direction: 'inbound',
                messageType: ev.messageType,
                body: ev.body,
                mediaUrl: ev.mediaUrl,
                status: 'received',
                receivedAtUtc: ev.receivedAtUtc,
                createdAtUtc: ev.receivedAtUtc,
            });
            renderThread();
        }
        // Update / bump the conversations list.
        const idx = conversations.findIndex(c => c.customerPhone === ev.customerPhone);
        let conv;
        if (idx >= 0) {
            conv = conversations[idx];
            conversations.splice(idx, 1);
        } else {
            conv = { customerPhone: ev.customerPhone, customerName: ev.customerName || '' };
        }
        conv.customerName = conv.customerName || ev.customerName || '';
        conv.lastMessageBody = previewLineFor(ev.body, ev.mediaUrl, ev.messageType);
        conv.lastMessageDirection = 'inbound';
        conv.lastMessageAtUtc = ev.receivedAtUtc || new Date().toISOString();
        conversations.unshift(conv);
        renderConversationList(filterConversations(document.getElementById('waSearchInput')?.value));
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function formatPhone(digits) {
        if (!digits) return '—';
        if (/^91\d{10}$/.test(digits)) {
            return `+${digits.slice(0, 2)} ${digits.slice(2, 7)} ${digits.slice(7)}`;
        }
        if (/^1\d{10}$/.test(digits)) {
            return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
        }
        return `+${digits}`;
    }

    function formatRelativeTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        if (sameDay) return formatTimeOfDay(iso);
        const diffMs = now.getTime() - d.getTime();
        const days = Math.floor(diffMs / 86_400_000);
        if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
        return d.toLocaleDateString();
    }

    function formatTimeOfDay(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
})();
