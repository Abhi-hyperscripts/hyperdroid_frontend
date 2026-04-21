/**
 * EmailService — Outlook-style inbox page.
 *
 * Layout:
 *   left rail    = account tree (all mailboxes, expandable per-account folder list)
 *   middle       = message list grouped by date (Today/Yesterday/Last Week/Earlier)
 *   reading pane = toolbar + selected message with chips, attachments, cid-image support
 *
 * Keyboard: j/k next/prev, r=reply, a=reply-all, f=forward, Esc=close, n=new, /=search
 */

// ==================== State ====================
const State = {
    mailboxes: [],
    accountCollapse: {},            // mailbox_id → bool
    selectedMailboxId: null,
    foldersByMailbox: {},           // mailbox_id → [folder]
    selectedFolderId: null,
    selectedFolderType: 'inbox',
    messages: [],
    selectedMessageId: null,
    searchQuery: '',
    filter: 'focused',              // focused | other — Outlook UX
    composeMode: null,              // null | 'new' | 'reply' | 'reply-all' | 'forward'
    composeAttachments: [],
    replyingTo: null,
    recipients: { to: [], cc: [], bcc: [] },
};

// ==================== Bootstrap ====================

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }
    Navigation.init('email', '../');

    document.getElementById('btnCompose').addEventListener('click', () => openCompose('new'));
    document.getElementById('btnRefresh').addEventListener('click', refreshMessages);
    document.getElementById('listSearch').addEventListener('input', e => {
        State.searchQuery = e.target.value.toLowerCase();
        renderMessages();
    });

    document.querySelectorAll('.email-filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.email-filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            State.filter = tab.dataset.filter;
            renderMessages();
        });
    });

    wireComposeModal();
    wireKeyboardShortcuts();

    await loadMailboxes();
});

// ==================== Keyboard shortcuts ====================

function wireKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        // Skip when typing in an input (unless it's Escape)
        const inInput = /^(input|textarea|select)$/i.test(e.target.tagName)
                       || e.target.isContentEditable;

        // Always-on keys
        if (e.key === 'Escape') {
            if (document.getElementById('composeOverlay').classList.contains('active')) {
                closeCompose();
                e.preventDefault();
            }
            return;
        }

        if (inInput) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        switch (e.key.toLowerCase()) {
            case 'j': moveSelection(1); e.preventDefault(); break;
            case 'k': moveSelection(-1); e.preventDefault(); break;
            case 'r': if (State.selectedMessageId) { const m = State.messages.find(x => x.id === State.selectedMessageId); if (m) openCompose('reply', m); } e.preventDefault(); break;
            case 'a': if (State.selectedMessageId) { const m = State.messages.find(x => x.id === State.selectedMessageId); if (m) openCompose('reply-all', m); } e.preventDefault(); break;
            case 'f': if (State.selectedMessageId) { const m = State.messages.find(x => x.id === State.selectedMessageId); if (m) openCompose('forward', m); } e.preventDefault(); break;
            case 'n': openCompose('new'); e.preventDefault(); break;
            case '/': document.getElementById('listSearch').focus(); e.preventDefault(); break;
        }
    });
}

function moveSelection(delta) {
    const rows = Array.from(document.querySelectorAll('.email-row'));
    if (rows.length === 0) return;
    const idx = rows.findIndex(r => r.classList.contains('active'));
    const next = rows[Math.max(0, Math.min(rows.length - 1, (idx < 0 ? 0 : idx + delta)))];
    if (next) next.click();
    next?.scrollIntoView({ block: 'nearest' });
}

// ==================== Mailboxes + account tree ====================

async function loadMailboxes() {
    try {
        const mailboxes = await api.request('/email/mailboxes');
        State.mailboxes = Array.isArray(mailboxes) ? mailboxes : [];

        // Populate compose "From" selector
        const composeFrom = document.getElementById('composeFrom');
        composeFrom.innerHTML = '';
        State.mailboxes.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.email_address;
            composeFrom.appendChild(opt);
        });

        // Empty state
        if (State.mailboxes.length === 0) {
            const tree = document.getElementById('accountsTree');
            tree.innerHTML = `
                <div class="email-empty" style="padding:40px 20px;">
                    <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    <h4>No mailboxes connected</h4>
                    <p>Connect your first IMAP/SMTP account in settings to start syncing mail.</p>
                    <a href="settings.html" style="color:var(--brand-primary); font-weight:600; font-size:13px;">Add mailbox →</a>
                </div>`;
            document.getElementById('emailRows').innerHTML =
                `<div class="email-empty" style="padding:40px 20px;"><p>No mailboxes yet.</p></div>`;
            return;
        }

        // Load folders for each mailbox in parallel
        await Promise.all(State.mailboxes.map(m => loadFolders(m.id)));

        // Select last-used mailbox + its inbox
        const last = localStorage.getItem('email_last_mailbox');
        const mbxId = State.mailboxes.some(m => m.id === last) ? last : State.mailboxes[0].id;
        State.selectedMailboxId = mbxId;
        document.getElementById('composeFrom').value = mbxId;

        renderAccountTree();

        const folders = State.foldersByMailbox[mbxId] || [];
        const inbox = folders.find(f => f.folder_type === 'inbox') || folders[0];
        if (inbox) selectFolder(mbxId, inbox.id, inbox.folder_type, inbox.folder_name);
    } catch (err) {
        console.error('loadMailboxes failed', err);
        Toast.error(`Could not load mailboxes: ${err.message}`);
    }
}

async function loadFolders(mailboxId) {
    try {
        const folders = await api.request(`/email/mailboxes/${mailboxId}/folders`);
        const list = Array.isArray(folders) ? folders : [];
        // Canonical order for standard folders, then custom alphabetical
        const order = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'custom'];
        list.sort((a, b) => {
            const ai = order.indexOf(a.folder_type);
            const bi = order.indexOf(b.folder_type);
            if (ai !== bi) return ai - bi;
            return (a.folder_name || '').localeCompare(b.folder_name || '');
        });
        State.foldersByMailbox[mailboxId] = list;
    } catch (err) {
        console.warn(`loadFolders(${mailboxId}) failed`, err);
        State.foldersByMailbox[mailboxId] = [];
    }
}

function renderAccountTree() {
    const tree = document.getElementById('accountsTree');
    tree.innerHTML = '';

    State.mailboxes.forEach(mbx => {
        const folders = State.foldersByMailbox[mbx.id] || [];
        const collapsed = State.accountCollapse[mbx.id] === true;
        const accountEl = document.createElement('div');
        accountEl.className = 'email-account' + (collapsed ? ' collapsed' : '');
        accountEl.dataset.mailboxId = mbx.id;

        const header = document.createElement('div');
        header.className = 'email-account-header';
        header.innerHTML = `
            <svg class="chev" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
            <span class="email-account-name">${escapeHtml(mbx.email_address)}</span>
        `;
        header.addEventListener('click', () => {
            State.accountCollapse[mbx.id] = !collapsed;
            renderAccountTree();
        });
        accountEl.appendChild(header);

        const foldersEl = document.createElement('div');
        foldersEl.className = 'email-folders';
        folders.forEach(f => {
            const row = document.createElement('div');
            row.className = 'email-folder-row';
            if (f.id === State.selectedFolderId && mbx.id === State.selectedMailboxId) {
                row.classList.add('active');
            }
            row.innerHTML = `
                ${folderIconSVG(f.folder_type)}
                <span class="folder-name">${escapeHtml(prettyFolderName(f.folder_name, f.folder_type))}</span>
                ${f.unread_count > 0 ? `<span class="folder-count">${f.unread_count}</span>` : ''}
            `;
            row.addEventListener('click', () => selectFolder(mbx.id, f.id, f.folder_type, f.folder_name));
            foldersEl.appendChild(row);
        });
        accountEl.appendChild(foldersEl);
        tree.appendChild(accountEl);
    });
}

function selectFolder(mailboxId, folderId, folderType, folderName) {
    State.selectedMailboxId = mailboxId;
    State.selectedFolderId = folderId;
    State.selectedFolderType = folderType;
    localStorage.setItem('email_last_mailbox', mailboxId);
    document.getElementById('composeFrom').value = mailboxId;

    document.getElementById('folderTitle').textContent = prettyFolderName(folderName, folderType);
    State.selectedMessageId = null;
    renderEmptyRead();
    renderAccountTree();
    loadMessages();
}

// ==================== Messages ====================

async function loadMessages() {
    if (!State.selectedMailboxId || !State.selectedFolderId) return;
    const rows = document.getElementById('emailRows');
    rows.innerHTML = skeletonRows(8);

    try {
        const url = `/email/messages?mailbox_id=${State.selectedMailboxId}&folder_id=${State.selectedFolderId}&limit=100&offset=0`;
        const resp = await api.request(url);
        State.messages = Array.isArray(resp?.items) ? resp.items : [];
        document.getElementById('folderCount').textContent =
            State.messages.length ? `${State.messages.length} of ${resp.total || State.messages.length}` : '';
        renderMessages();
    } catch (err) {
        console.error('loadMessages failed', err);
        rows.innerHTML = `<div class="email-empty" style="padding:32px;"><p style="color:var(--color-danger);">${escapeHtml(err.message)}</p></div>`;
    }
}

function refreshMessages() {
    Toast.info('Refreshing…');
    loadMessages();
}

function skeletonRows(n) {
    let html = '';
    const widths = [['60', '80', '40'], ['80', '60', '40'], ['40', '80', '60'], ['60', '40', '80']];
    for (let i = 0; i < n; i++) {
        const w = widths[i % widths.length];
        html += `
            <div class="email-skel-row">
                <div class="skel-avatar"></div>
                <div class="skel-lines">
                    <div class="skel-line w-${w[0]}"></div>
                    <div class="skel-line w-${w[1]}"></div>
                    <div class="skel-line w-${w[2]}"></div>
                </div>
            </div>`;
    }
    return html;
}

function renderMessages() {
    const container = document.getElementById('emailRows');
    const q = State.searchQuery.trim();
    let list = State.messages;

    // Focused vs. Other filter — heuristic: "Other" = Mail Delivery System,
    // noreply@, notifications@, newsletters, auto-reply, bounces. Good-enough
    // split matches Outlook's automated-vs-personal dichotomy without a
    // per-user model. Can evolve into a backend classifier later.
    list = list.filter(m => {
        const otherish = isOtherSender(m);
        return State.filter === 'focused' ? !otherish : otherish;
    });

    if (q) {
        list = list.filter(m =>
            (m.subject || '').toLowerCase().includes(q) ||
            (m.from_address || '').toLowerCase().includes(q) ||
            (m.from_name || '').toLowerCase().includes(q) ||
            (m.snippet || '').toLowerCase().includes(q));
    }

    if (list.length === 0) {
        container.innerHTML = `
            <div class="email-empty" style="padding:48px 20px;">
                <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <h4>${q ? 'No matches' : 'Nothing here'}</h4>
                <p>${q
                    ? 'Try a different search term or check the other tab.'
                    : State.filter === 'other'
                        ? 'No noisy messages. Check the Focused tab.'
                        : 'This folder is empty.'}</p>
            </div>`;
        return;
    }

    // Group by date bucket
    const buckets = groupByDate(list);
    let html = '';
    for (const [label, items] of buckets) {
        html += `
            <div class="email-date-separator">
                <svg class="chev" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                ${label}
            </div>`;
        for (const m of items) {
            html += renderRow(m);
        }
    }
    container.innerHTML = html;

    container.querySelectorAll('.email-row').forEach(row => {
        row.addEventListener('click', () => openMessage(row.dataset.messageId));
    });
}

function renderRow(m) {
    const senderName = m.from_name || m.from_address || '(unknown)';
    const initials = (senderName.trim()[0] || '?').toUpperCase();
    const avatarClass = 'ah-' + (hashStr(senderName) % 8);
    const isUnread = !m.is_read;
    const isActive = m.id === State.selectedMessageId;
    const date = m.received_at || m.sent_at || m.created_at;
    return `
        <div class="email-row ${isUnread ? 'unread' : ''} ${isActive ? 'active' : ''}" data-message-id="${m.id}">
            <div class="avatar ${avatarClass}">${escapeHtml(initials)}</div>
            <div class="row-top">
                <span class="row-sender">${escapeHtml(senderName)}</span>
                <span class="row-date">${formatShortDate(date)}</span>
            </div>
            ${m.has_attachments ? `<svg class="row-attach" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>` : ''}
            <div class="row-subject">${escapeHtml(m.subject || '(no subject)')}</div>
            <div class="row-snippet">${escapeHtml(m.snippet || '')}</div>
        </div>`;
}

function groupByDate(messages) {
    const buckets = new Map();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekAgo = today - 7 * 86400000;
    const monthAgo = today - 30 * 86400000;

    for (const m of messages) {
        const iso = m.received_at || m.sent_at || m.created_at;
        const d = iso ? new Date(iso).getTime() : 0;
        let label;
        if (d >= today)        label = 'Today';
        else if (d >= yesterday) label = 'Yesterday';
        else if (d >= weekAgo)   label = 'Last week';
        else if (d >= monthAgo)  label = 'This month';
        else                     label = 'Older';
        if (!buckets.has(label)) buckets.set(label, []);
        buckets.get(label).push(m);
    }
    // Preserve the canonical order
    const order = ['Today', 'Yesterday', 'Last week', 'This month', 'Older'];
    return order.filter(o => buckets.has(o)).map(o => [o, buckets.get(o)]);
}

function isOtherSender(m) {
    const sender = ((m.from_address || '') + ' ' + (m.from_name || '')).toLowerCase();
    const subject = (m.subject || '').toLowerCase();
    const markers = ['noreply', 'no-reply', 'no_reply', 'notifications@', 'notification@',
                     'mailer-daemon', 'mail delivery', 'postmaster', 'bounce', 'newsletter',
                     'digest', 'automated', 'unsubscribe'];
    return markers.some(k => sender.includes(k))
        || /undelivered|automatic reply|out of office/i.test(subject);
}

async function openMessage(messageId) {
    State.selectedMessageId = messageId;
    document.querySelectorAll('.email-row').forEach(r => {
        r.classList.toggle('active', r.dataset.messageId === messageId);
    });

    const readEmpty = document.getElementById('readEmpty');
    const readWrap = document.getElementById('readWrap');
    readEmpty.style.display = 'none';
    readWrap.style.display = 'flex';
    readWrap.innerHTML = `<div class="email-empty" style="padding:40px;"><p>Loading…</p></div>`;

    try {
        const [msg, attachments] = await Promise.all([
            api.request(`/email/messages/${messageId}`),
            api.request(`/email/messages/${messageId}/attachments`).catch(() => []),
        ]);
        renderMessage(msg, attachments || []);

        if (!msg.is_read) {
            api.request(`/email/messages/${messageId}/mark-read?read=true`, { method: 'POST' })
                .then(() => {
                    const row = document.querySelector(`.email-row[data-message-id="${messageId}"]`);
                    if (row) row.classList.remove('unread');
                    const local = State.messages.find(m => m.id === messageId);
                    if (local) local.is_read = true;
                })
                .catch(err => console.warn('mark-read failed', err));
        }
    } catch (err) {
        console.error('openMessage failed', err);
        readWrap.innerHTML = `<div class="email-empty" style="padding:40px;"><p style="color:var(--color-danger);">${escapeHtml(err.message)}</p></div>`;
    }
}

function renderMessage(msg, attachments) {
    const wrap = document.getElementById('readWrap');
    const senderName = msg.from_name || msg.from_address || '(unknown)';
    const fromDisplay = msg.from_name ? `${msg.from_name} <${msg.from_address || ''}>` : (msg.from_address || '(unknown)');
    const toDisplay = parseJsonList(msg.to_addresses).join(', ');
    const ccDisplay = parseJsonList(msg.cc_addresses).join(', ');
    const initials = (senderName.trim()[0] || '?').toUpperCase();
    const avatarClass = 'ah-' + (hashStr(senderName) % 8);

    let safeHtml = msg.body_html ? sanitizeHtml(msg.body_html) : null;
    const cidMap = buildCidMap(attachments);
    if (safeHtml && cidMap.size > 0) {
        safeHtml = safeHtml.replace(/\bsrc\s*=\s*["']cid:([^"']+)["']/gi, (match, raw) => {
            const cid = raw.trim().replace(/^<|>$/g, '').toLowerCase();
            const attId = cidMap.get(cid);
            return attId
                ? `src="" data-cid-attachment="${attId}" alt="[inline image]"`
                : match;
        });
    }

    const realAttachments = attachments.filter(a => !a.is_inline);

    wrap.innerHTML = `
        <div class="email-read-toolbar">
            <button id="btnReply" class="primary" title="Reply (r)">
                <svg viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                Reply
            </button>
            <button id="btnReplyAll" title="Reply all (a)">
                <svg viewBox="0 0 24 24"><polyline points="7 17 2 12 7 7"/><polyline points="12 17 7 12 12 7"/><path d="M22 18v-2a4 4 0 0 0-4-4H7"/></svg>
                Reply all
            </button>
            <button id="btnForward" title="Forward (f)">
                <svg viewBox="0 0 24 24"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
                Forward
            </button>
            <span class="sep"></span>
            <button id="btnMarkUnread" title="Mark as unread">
                <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Mark unread
            </button>
            <button id="btnHeaders" title="Show raw headers">
                <svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                Headers
            </button>
            <span class="sep"></span>
            <button id="btnDelete" title="Delete">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Delete
            </button>
        </div>
        <div class="email-read-body-wrap">
            <h2 class="email-read-subject">${escapeHtml(msg.subject || '(no subject)')}</h2>
            <div class="email-read-meta">
                <div class="avatar ${avatarClass}">${escapeHtml(initials)}</div>
                <div class="addr-block">
                    <div class="addr-from">${escapeHtml(fromDisplay)}</div>
                    ${toDisplay ? `<div class="addr-line"><span class="addr-label">To</span><span class="addr-value">${escapeHtml(toDisplay)}</span></div>` : ''}
                    ${ccDisplay ? `<div class="addr-line"><span class="addr-label">Cc</span><span class="addr-value">${escapeHtml(ccDisplay)}</span></div>` : ''}
                </div>
                <div class="read-date">${formatFullDate(msg.received_at || msg.sent_at || msg.created_at)}</div>
            </div>
            <div class="email-read-body ${safeHtml ? 'html-mode' : 'text-mode'}" id="readBody">${safeHtml || escapeHtml(msg.body_text || '(no body)')}</div>
            ${realAttachments.length ? renderAttachmentsBlock(realAttachments) : ''}
        </div>
    `;

    wrap.querySelector('#btnReply').addEventListener('click', () => openCompose('reply', msg));
    wrap.querySelector('#btnReplyAll').addEventListener('click', () => openCompose('reply-all', msg));
    wrap.querySelector('#btnForward').addEventListener('click', () => openCompose('forward', msg));
    wrap.querySelector('#btnHeaders').addEventListener('click', () => showHeaders(msg.id));
    wrap.querySelector('#btnDelete').addEventListener('click', () => deleteMessage(msg.id));
    wrap.querySelector('#btnMarkUnread').addEventListener('click', () => toggleRead(msg.id, false));

    wrap.querySelectorAll('.email-attachment').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault();
            downloadAttachment(el.dataset.attachmentId, el.dataset.filename);
        });
    });

    hydrateCidImages(wrap, cidMap);
}

function renderAttachmentsBlock(list) {
    const chips = list.map(a => `
        <a class="email-attachment" href="#" data-attachment-id="${a.id}" data-filename="${escapeHtml(a.filename || '')}" title="Download ${escapeHtml(a.filename || '')}">
            <div class="att-icon">
                <svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </div>
            <div class="att-meta">
                <span class="att-name">${escapeHtml(a.filename || 'attachment')}</span>
                <span class="att-size">${formatBytes(a.size_bytes)}</span>
            </div>
        </a>
    `).join('');
    return `<div class="email-read-attachments"><h4>Attachments · ${list.length}</h4>${chips}</div>`;
}

function renderEmptyRead() {
    document.getElementById('readEmpty').style.display = 'flex';
    document.getElementById('readWrap').style.display = 'none';
}

function buildCidMap(attachments) {
    const map = new Map();
    (attachments || []).forEach(a => {
        if (!a.content_id) return;
        const key = a.content_id.trim().replace(/^<|>$/g, '').toLowerCase();
        if (key) map.set(key, a.id);
    });
    return map;
}

async function hydrateCidImages(container, cidMap) {
    container.querySelectorAll('img[src^="cid:"], img[src^="CID:"]').forEach(img => {
        replaceWithPlaceholder(img, 'inline image not available');
    });
    if (!cidMap || cidMap.size === 0) return;
    container.querySelectorAll('img[data-cid-attachment]').forEach(async img => {
        const attId = img.getAttribute('data-cid-attachment');
        try {
            const resp = await fetch(`${CONFIG.emailApiBaseUrl}/attachments/${attId}/download`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            img.src = URL.createObjectURL(blob);
        } catch (err) {
            console.warn('cid hydrate failed', attId, err);
            replaceWithPlaceholder(img, 'inline image failed to load');
        }
    });
}

function replaceWithPlaceholder(img, label) {
    const span = document.createElement('span');
    span.style.cssText = 'display:inline-block;padding:2px 8px;background:var(--bg-card-hover);border:1px dashed var(--border-color);border-radius:4px;color:var(--text-muted);font-size:12px;font-style:italic;vertical-align:middle;';
    span.textContent = `[${label}]`;
    img.replaceWith(span);
}

async function downloadAttachment(attId, filename) {
    try {
        const resp = await fetch(`${CONFIG.emailApiBaseUrl}/attachments/${attId}/download`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'attachment';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
        Toast.error(`Download failed: ${err.message}`);
    }
}

async function showHeaders(messageId) {
    try {
        const headers = await api.request(`/email/messages/${messageId}/headers`);
        const overlay = document.createElement('div');
        overlay.className = 'email-modal-overlay active';
        overlay.innerHTML = `
            <div class="email-modal" style="width:820px;">
                <div class="email-modal-header">
                    <h3>Raw headers</h3>
                    <button class="email-modal-close">&times;</button>
                </div>
                <div class="email-modal-body" style="padding:16px 18px;">
                    <div class="email-headers-viewer">${escapeHtml(formatHeaders(headers))}</div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('.email-modal-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    } catch (err) {
        Toast.error(`Could not load headers: ${err.message}`);
    }
}

function formatHeaders(h) {
    if (!h || Object.keys(h).length === 0) return '(no headers recorded — this message was ingested before R13)';
    const lines = [];
    Object.keys(h).sort().forEach(name => {
        (h[name] || []).forEach(v => lines.push(`${name}: ${v}`));
    });
    return lines.join('\n');
}

async function toggleRead(messageId, isRead) {
    try {
        await api.request(`/email/messages/${messageId}/mark-read?read=${isRead}`, { method: 'POST' });
        Toast.success(isRead ? 'Marked as read' : 'Marked as unread');
        const local = State.messages.find(m => m.id === messageId);
        if (local) local.is_read = isRead;
        const row = document.querySelector(`.email-row[data-message-id="${messageId}"]`);
        if (row) row.classList.toggle('unread', !isRead);
    } catch (err) {
        Toast.error(`Failed: ${err.message}`);
    }
}

async function deleteMessage(messageId) {
    if (!confirm('Delete this message? (currently removes from local view only — backend DELETE endpoint pending)')) return;
    State.messages = State.messages.filter(m => m.id !== messageId);
    State.selectedMessageId = null;
    renderMessages();
    renderEmptyRead();
    Toast.info('Removed from local view');
}

// ==================== Compose ====================

function wireComposeModal() {
    document.getElementById('composeClose').addEventListener('click', closeCompose);
    document.getElementById('composeOverlay').addEventListener('click', e => {
        if (e.target.id === 'composeOverlay') closeCompose();
    });
    document.getElementById('toggleCc').addEventListener('click', () => {
        const cc = document.getElementById('composeCcRow');
        const bcc = document.getElementById('composeBccRow');
        const show = cc.style.display === 'none';
        cc.style.display = show ? 'flex' : 'none';
        bcc.style.display = show ? 'flex' : 'none';
    });
    document.getElementById('btnAttach').addEventListener('click', () => document.getElementById('composeFile').click());
    document.getElementById('composeFile').addEventListener('change', handleAttachFiles);
    document.getElementById('btnSend').addEventListener('click', sendCompose);

    wireChipField('to');
    wireChipField('cc');
    wireChipField('bcc');
}

function wireChipField(kind) {
    const input = document.getElementById('compose' + kind.charAt(0).toUpperCase() + kind.slice(1));
    const addChipsFromInput = () => {
        const raw = input.value;
        const tokens = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
        tokens.forEach(t => addRecipient(kind, t));
        input.value = '';
    };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
            e.preventDefault();
            addChipsFromInput();
        } else if (e.key === 'Backspace' && input.value === '' && State.recipients[kind].length > 0) {
            State.recipients[kind].pop();
            renderChips(kind);
        }
    });
    input.addEventListener('blur', () => {
        if (input.value.trim()) addChipsFromInput();
    });
}

function addRecipient(kind, addr) {
    addr = addr.trim();
    if (!addr) return;
    if (State.recipients[kind].some(a => a.toLowerCase() === addr.toLowerCase())) return; // dedup
    State.recipients[kind].push(addr);
    renderChips(kind);
}

function renderChips(kind) {
    const field = document.getElementById(kind + 'Chips');
    const input = field.querySelector('.chip-input');
    // Remove existing chip elements
    field.querySelectorAll('.recipient-chip').forEach(el => el.remove());
    const validRe = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
    State.recipients[kind].forEach((addr, idx) => {
        const chip = document.createElement('span');
        chip.className = 'recipient-chip' + (validRe.test(addr) ? '' : ' invalid');
        chip.innerHTML = `${escapeHtml(addr)}<button title="Remove">×</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            State.recipients[kind].splice(idx, 1);
            renderChips(kind);
        });
        field.insertBefore(chip, input);
    });
}

function openCompose(mode, replyTo) {
    State.composeMode = mode;
    State.replyingTo = replyTo || null;
    State.composeAttachments = [];
    State.recipients = { to: [], cc: [], bcc: [] };

    const subj = document.getElementById('composeSubject');
    const body = document.getElementById('composeBody');
    const title = document.getElementById('composeTitle');
    const composeFrom = document.getElementById('composeFrom');

    subj.value = '';
    body.value = '';
    document.getElementById('composeCcRow').style.display = 'none';
    document.getElementById('composeBccRow').style.display = 'none';
    document.getElementById('composeAttachChips').innerHTML = '';

    if (State.selectedMailboxId) composeFrom.value = State.selectedMailboxId;

    if (mode === 'new') {
        title.textContent = 'New message';
    } else if (replyTo) {
        const fromName = replyTo.from_name || replyTo.from_address;
        const toAddrs = parseJsonList(replyTo.to_addresses);
        const ccAddrs = parseJsonList(replyTo.cc_addresses);
        const myAddr = State.mailboxes.find(m => m.id === State.selectedMailboxId)?.email_address?.toLowerCase() || '';

        if (mode === 'reply') {
            title.textContent = 'Reply';
            if (replyTo.from_address) addRecipient('to', replyTo.from_address);
        } else if (mode === 'reply-all') {
            title.textContent = 'Reply all';
            if (replyTo.from_address) addRecipient('to', replyTo.from_address);
            [...toAddrs, ...ccAddrs]
                .filter(a => a && a.toLowerCase() !== myAddr)
                .forEach(a => addRecipient('cc', a));
            if (State.recipients.cc.length) {
                document.getElementById('composeCcRow').style.display = 'flex';
            }
        } else if (mode === 'forward') {
            title.textContent = 'Forward';
        }

        const prefix = mode === 'forward' ? 'Fwd: ' : 'Re: ';
        const base = (replyTo.subject || '').replace(/^(Re:|Fwd:)\s*/i, '');
        subj.value = prefix + base;

        const qDate = formatFullDate(replyTo.received_at || replyTo.sent_at || replyTo.created_at);
        const quoted = (replyTo.body_text || stripHtml(replyTo.body_html || '') || '')
            .split('\n').map(l => '> ' + l).join('\n');
        body.value = `\n\n\nOn ${qDate}, ${fromName} wrote:\n${quoted}`;
    }

    renderChips('to'); renderChips('cc'); renderChips('bcc');
    document.getElementById('composeOverlay').classList.add('active');
    setTimeout(() => {
        if (State.recipients.to.length === 0) document.getElementById('composeTo').focus();
        else document.getElementById('composeSubject').focus();
    }, 50);
}

function closeCompose() {
    document.getElementById('composeOverlay').classList.remove('active');
    State.composeMode = null;
    State.replyingTo = null;
    State.composeAttachments = [];
    State.recipients = { to: [], cc: [], bcc: [] };
    document.getElementById('composeFile').value = '';
}

function handleAttachFiles(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
        if (file.size > 25 * 1024 * 1024) return Toast.error(`${file.name} exceeds 25 MB`);
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1] || '';
            State.composeAttachments.push({
                filename: file.name,
                mime_type: file.type || 'application/octet-stream',
                content_base64: base64,
                is_inline: false,
            });
            renderComposeAttachChips();
        };
        reader.readAsDataURL(file);
    });
    e.target.value = '';
}

function renderComposeAttachChips() {
    const wrap = document.getElementById('composeAttachChips');
    wrap.innerHTML = '';
    State.composeAttachments.forEach((a, idx) => {
        const chip = document.createElement('div');
        chip.className = 'email-attach-chip';
        chip.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            <span>${escapeHtml(a.filename)}</span>
            <span class="size">${formatBytes(approxBase64Size(a.content_base64))}</span>
            <button title="Remove">×</button>
        `;
        chip.querySelector('button').addEventListener('click', () => {
            State.composeAttachments.splice(idx, 1);
            renderComposeAttachChips();
        });
        wrap.appendChild(chip);
    });
}

async function sendCompose() {
    const mailboxId = document.getElementById('composeFrom').value;
    if (!mailboxId) return Toast.error('Pick a mailbox to send from.');
    // Flush any pending input into chips
    ['to', 'cc', 'bcc'].forEach(k => {
        const el = document.getElementById('compose' + k.charAt(0).toUpperCase() + k.slice(1));
        if (el.value.trim()) {
            el.value.split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(a => addRecipient(k, a));
            el.value = '';
        }
    });

    const to = [...State.recipients.to];
    const cc = [...State.recipients.cc];
    const bcc = [...State.recipients.bcc];
    if (to.length === 0) return Toast.error('At least one recipient required.');

    const payload = {
        mailbox_id: mailboxId,
        to,
        subject: document.getElementById('composeSubject').value.trim(),
        body_text: document.getElementById('composeBody').value,
        idempotency_key: 'frontend-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
    };
    if (cc.length) payload.cc = cc;
    if (bcc.length) payload.bcc = bcc;
    if (State.composeAttachments.length) payload.attachments = State.composeAttachments;
    if (State.replyingTo?.message_id) payload.in_reply_to_message_id = State.replyingTo.message_id;

    const btn = document.getElementById('btnSend');
    btn.disabled = true;
    btn.innerHTML = '<span>Sending…</span>';
    try {
        await api.request('/email/compose/send', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        Toast.success('Sent.');
        closeCompose();
        if (State.selectedFolderType === 'sent' || State.replyingTo) {
            setTimeout(loadMessages, 1500);
        }
    } catch (err) {
        Toast.error(`Send failed: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send';
    }
}

// ==================== Utilities ====================

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, iframe, object, embed, link, meta, style').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(attr => {
            const n = attr.name.toLowerCase();
            const v = (attr.value || '').trim().toLowerCase();
            if (n.startsWith('on') || v.startsWith('javascript:') || v.startsWith('data:text/html')) {
                el.removeAttribute(attr.name);
            }
        });
        if (el.tagName === 'A') el.setAttribute('target', '_blank');
    });
    return doc.body.innerHTML;
}

function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent || '';
}

function parseJsonList(s) {
    if (!s) return [];
    try {
        const arr = JSON.parse(s);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function formatShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    const days = (now - d) / (1000 * 60 * 60 * 24);
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' });
}

function formatFullDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function approxBase64Size(b64) {
    return b64 ? Math.floor(b64.length * 3 / 4) : 0;
}

function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i), h |= 0;
    return Math.abs(h);
}

function prettyFolderName(name, type) {
    if (name) {
        const n = name.toLowerCase();
        if (n === 'inbox') return 'Inbox';
        if (n === 'sent' || n === 'sent items' || n === 'sent mail') return 'Sent';
        return name;
    }
    return type.charAt(0).toUpperCase() + type.slice(1);
}

function folderIconSVG(type) {
    const svgs = {
        inbox:   '<svg class="folder-icon" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
        sent:    '<svg class="folder-icon" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
        drafts:  '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        trash:   '<svg class="folder-icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        junk:    '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        archive: '<svg class="folder-icon" viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
        custom:  '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    };
    return svgs[type] || svgs.custom;
}
