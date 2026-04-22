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
const PAGE_SIZE = 30;

const State = {
    mailboxes: [],
    accountCollapse: {},            // mailbox_id → bool
    folderCollapse: {},             // folder_id → bool (true == collapsed, hide descendants)
    dateGroupCollapse: {},          // date-bucket label → bool (true == collapsed)
    selectedMailboxId: null,
    foldersByMailbox: {},           // mailbox_id → [folder]
    selectedFolderId: null,
    selectedFolderType: 'inbox',
    messages: [],
    totalCount: 0,                  // total on server
    hasMore: false,                 // more pages remain
    isLoadingMore: false,           // guard against duplicate fetches
    selectedMessageId: null,
    // Set of message IDs the user has ticked for bulk operations. Cleared on
    // folder-change, refresh, and explicit Cancel.
    selectedMessageIds: new Set(),
    searchQuery: '',
    filter: 'focused',              // focused | other — Outlook UX
    composeMode: null,              // null | 'new' | 'reply' | 'reply-all' | 'forward'
    composeAttachments: [],
    replyingTo: null,
    recipients: { to: [], cc: [], bcc: [] },
};

// Lives outside State so we can disconnect/reconnect the observer on each
// render without serialization noise.
let loadMoreObserver = null;

// Quill rich-text editor instance for the compose modal. Lazy-init on
// first openCompose() so the page paint isn't delayed by editor setup.
let _composeQuill = null;

// ==================== Bootstrap ====================

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }
    Navigation.init('email', '../');
    loadFolderCollapse();
    try {
        const raw = localStorage.getItem('email_date_group_collapse');
        if (raw) State.dateGroupCollapse = JSON.parse(raw) || {};
    } catch { /* ignore */ }

    document.getElementById('btnCompose').addEventListener('click', () => openCompose('new'));
    wireComposeSplitMenu();
    document.getElementById('btnRefresh').addEventListener('click', refreshMessages);
    wireSearchInput();

    document.querySelectorAll('.email-filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.email-filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            State.filter = tab.dataset.filter;
            renderMessages();
        });
    });

    wireComposeModal();
    wireNewFolderModal();
    wireScheduleMeetingModal();
    wireKeyboardShortcuts();
    wireMobileNav();
    wireBulkBar();

    // Re-parent the compose modal to <body> so no ancestor with transform/
    // filter/overflow can reposition it. Without this, styles.css's
    // `main { position: relative }` rule can trap the overlay inside the
    // scroll container and drop it below the visible viewport.
    const overlay = document.getElementById('composeOverlay');
    if (overlay && overlay.parentElement !== document.body) {
        document.body.appendChild(overlay);
    }

    await loadMailboxes();
    connectEmailHub();
});

// ==================== SignalR live push ====================

let _emailHub = null;

async function connectEmailHub() {
    if (typeof signalR === 'undefined' || !CONFIG.emailSignalRHubUrl) return;
    try {
        _emailHub = new signalR.HubConnectionBuilder()
            .withUrl(CONFIG.emailSignalRHubUrl, {
                accessTokenFactory: () => localStorage.getItem('ragenaizer_authToken') || '',
            })
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
            .build();

        _emailHub.on('MessageReceived', onHubMessageReceived);
        await _emailHub.start();
        console.log('[EmailHub] connected');
    } catch (err) {
        console.warn('[EmailHub] connect failed — falling back to manual refresh', err);
    }
}

/**
 * Server push: a new message landed in one of the user's mailboxes. If they're
 * currently viewing that mailbox + inbox, slide the list down and append (or
 * just reload the first page). Always nudge the unread badge up regardless of
 * the active folder so the account tree reflects reality.
 */
function onHubMessageReceived(payload) {
    if (!payload) return;
    const { mailbox_id, folder_id, folder_type, from_name, from_address, subject } = payload;

    // Toast so the user notices even if the browser tab isn't focused on the
    // message list. Clicking reloads — cheap for now; a deeper impl would jump
    // straight to the message.
    try {
        Toast.info(`New mail from ${from_name || from_address || '(unknown)'}: ${subject || '(no subject)'}`);
    } catch { /* Toast might not be loaded on settings page */ }

    // Bump the folder's unread count in the sidebar. Works even if the user is
    // not viewing that mailbox right now.
    if (mailbox_id && folder_id) {
        adjustFolderUnreadCount(mailbox_id, folder_id, +1);
    }

    // If the viewed folder matches, reload its first page so the new row
    // appears at top without a click. If not, the user will see the bump in
    // the sidebar badge and load when they switch.
    if (State.selectedMailboxId === mailbox_id && State.selectedFolderId === folder_id) {
        loadMessages();
    }
}

// ==================== Mobile nav ====================

function wireMobileNav() {
    const shell = document.getElementById('emailShell');
    const backdrop = document.getElementById('railBackdrop');

    // Rail drawer toggle (menu button on list header)
    const openRail = document.getElementById('btnOpenRail');
    if (openRail) openRail.addEventListener('click', () => shell.classList.add('show-rail'));
    if (backdrop) backdrop.addEventListener('click', () => shell.classList.remove('show-rail'));

    // Close rail when a folder is picked (handled inside selectFolder below).

    // New-email shortcut in mobile header
    const compM = document.getElementById('btnComposeMobile');
    if (compM) compM.addEventListener('click', () => openCompose('new'));
}

function isPhoneView() {
    return window.matchMedia('(max-width: 720px)').matches;
}

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
        // Ask the server to re-run IMAP folder discovery before we list — this
        // picks up any folders the user created (or deleted) on webmail /
        // another client since our last 25-min IDLE reconnect cycle. The
        // endpoint returns the refreshed folder list directly so we don't
        // need a second GET.
        let folders;
        try {
            folders = await api.request(`/email/mailboxes/${mailboxId}/folders/refresh`, {
                method: 'POST',
                _skipSpinner: true
            });
        } catch (refreshErr) {
            // Refresh is best-effort — if the IMAP call fails we still want
            // to show whatever folders we already have in the DB.
            console.warn('Folder refresh failed, falling back to cached list', refreshErr);
            folders = await api.request(`/email/mailboxes/${mailboxId}/folders`);
        }
        const list = Array.isArray(folders) ? folders : [];
        // Canonical order for standard folders; custom folders sorted by path
        // so nested children appear right after their parent (tree order).
        const order = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'custom'];
        list.sort((a, b) => {
            const ai = order.indexOf(a.folder_type);
            const bi = order.indexOf(b.folder_type);
            if (ai !== bi) return ai - bi;
            if (a.folder_type === 'custom') {
                return (a.folder_path || '').localeCompare(b.folder_path || '');
            }
            return (a.folder_name || '').localeCompare(b.folder_name || '');
        });
        State.foldersByMailbox[mailboxId] = list;
    } catch (err) {
        console.warn(`loadFolders(${mailboxId}) failed`, err);
        State.foldersByMailbox[mailboxId] = [];
    }
}

/**
 * Compute per-folder nesting depth so we can indent custom folders under
 * their parent in the sidebar. IMAP servers use either `.` (Cyrus/Dovecot,
 * which is what Hostinger runs) or `/` (Gmail-style) as the path delimiter;
 * we sniff whichever shows up in the current folder set and derive depth
 * from how many ancestor paths exist in the same custom-folder list.
 * Returns a map keyed by folder id -> integer depth (0 for top-level).
 */
function computeFolderDepths(folders) {
    const customs = folders.filter(f => f.folder_type === 'custom');
    if (customs.length === 0) return {};
    // Sniff delimiter: prefer `/` if any custom path uses it, else `.`
    const delim = customs.some(f => (f.folder_path || '').includes('/')) ? '/' : '.';
    const paths = new Set(customs.map(f => f.folder_path));
    const depthOf = (f) => {
        let depth = 0;
        let path = f.folder_path || '';
        while (true) {
            const idx = path.lastIndexOf(delim);
            if (idx === -1) break;
            path = path.substring(0, idx);
            if (paths.has(path)) depth++;
            else break;
        }
        return depth;
    };
    const map = {};
    customs.forEach(f => { map[f.id] = depthOf(f); });
    return map;
}

/**
 * Returns a lookup table of which folders have child folders — used to
 * decide whether to render a chevron toggle in the sidebar. Keyed by
 * folder id -> true.
 */
function computeFoldersWithChildren(folders) {
    const customs = folders.filter(f => f.folder_type === 'custom');
    if (customs.length === 0) return {};
    const delim = customs.some(f => (f.folder_path || '').includes('/')) ? '/' : '.';
    const result = {};
    for (const f of customs) {
        const prefix = (f.folder_path || '') + delim;
        if (customs.some(o => o.id !== f.id && (o.folder_path || '').startsWith(prefix))) {
            result[f.id] = true;
        }
    }
    return result;
}

/**
 * Returns a Set of folder ids that should be HIDDEN because at least one
 * ancestor folder is currently collapsed. Walks the path chain for each
 * custom folder and checks the collapse state of every parent-in-tree.
 */
function computeHiddenFolderIds(folders) {
    const customs = folders.filter(f => f.folder_type === 'custom');
    if (customs.length === 0) return new Set();
    const delim = customs.some(f => (f.folder_path || '').includes('/')) ? '/' : '.';
    const byPath = new Map();
    customs.forEach(f => byPath.set(f.folder_path, f));
    const hidden = new Set();
    for (const f of customs) {
        let path = f.folder_path || '';
        while (true) {
            const idx = path.lastIndexOf(delim);
            if (idx === -1) break;
            path = path.substring(0, idx);
            const parent = byPath.get(path);
            if (!parent) break;
            if (State.folderCollapse[parent.id]) { hidden.add(f.id); break; }
        }
    }
    return hidden;
}

function persistFolderCollapse() {
    try { localStorage.setItem('email_folder_collapse', JSON.stringify(State.folderCollapse)); }
    catch { /* quota / private mode — fine */ }
}

function loadFolderCollapse() {
    try {
        const raw = localStorage.getItem('email_folder_collapse');
        if (raw) State.folderCollapse = JSON.parse(raw) || {};
    } catch { /* ignore */ }
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
            <button class="email-sync-folders-btn" title="Sync folders from server" aria-label="Sync folders from server">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
            </button>
            <button class="email-new-folder-btn" title="Create folder" aria-label="Create folder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
        `;
        header.addEventListener('click', (e) => {
            // Ignore clicks on the action buttons — they have their own handlers.
            if (e.target.closest('.email-new-folder-btn') || e.target.closest('.email-sync-folders-btn')) return;
            State.accountCollapse[mbx.id] = !collapsed;
            renderAccountTree();
        });
        header.querySelector('.email-new-folder-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openNewFolderModal(mbx.id);
        });
        header.querySelector('.email-sync-folders-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            handleSyncFolders(mbx.id, e.currentTarget);
        });
        accountEl.appendChild(header);

        const foldersEl = document.createElement('div');
        foldersEl.className = 'email-folders';
        const depths = computeFolderDepths(folders);
        const hasChildren = computeFoldersWithChildren(folders);
        const hiddenIds = computeHiddenFolderIds(folders);
        folders.forEach(f => {
            if (hiddenIds.has(f.id)) return;  // any ancestor is collapsed
            const row = document.createElement('div');
            row.className = 'email-folder-row';
            row.dataset.mailboxId = mbx.id;
            row.dataset.folderId = f.id;
            const depth = depths[f.id] || 0;
            // Always stamp paddingLeft so depth 1 clears the 30px base the
            // CSS rule sets. 14px per level gives clean stepping that lines
            // up with the folder icon of the row above. Chevron gets a
            // -20px nudge so it sits just to the LEFT of the folder icon
            // instead of pushing the whole row right by another 20px.
            row.style.paddingLeft = `${30 + depth * 14}px`;
            if (f.id === State.selectedFolderId && mbx.id === State.selectedMailboxId) {
                row.classList.add('active');
            }
            const isCollapsed = !!State.folderCollapse[f.id];
            const chevronHtml = hasChildren[f.id]
                ? `<button class="folder-chev ${isCollapsed ? 'collapsed' : ''}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'}" title="${isCollapsed ? 'Expand' : 'Collapse'}">
                       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>
                   </button>`
                : '<span class="folder-chev-placeholder"></span>';
            // ⋯ menu only on custom folders — system folders (Inbox/Sent/
            // Drafts/Trash/Junk) can't be renamed or deleted on most IMAP
            // servers, so no menu for them.
            const moreBtnHtml = f.folder_type === 'custom'
                ? `<button class="folder-more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Folder options" title="Folder options" data-folder-id="${f.id}">
                       <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                   </button>`
                : '';
            row.innerHTML = `
                ${chevronHtml}
                ${folderIconSVG(f.folder_type)}
                <span class="folder-name">${escapeHtml(prettyFolderName(f.folder_name, f.folder_type))}</span>
                ${f.unread_count > 0 ? `<span class="folder-count">${f.unread_count}</span>` : ''}
                ${moreBtnHtml}
            `;
            const chev = row.querySelector('.folder-chev');
            if (chev) {
                chev.addEventListener('click', (e) => {
                    e.stopPropagation();
                    State.folderCollapse[f.id] = !State.folderCollapse[f.id];
                    persistFolderCollapse();
                    renderAccountTree();
                });
            }
            const moreBtn = row.querySelector('.folder-more-btn');
            if (moreBtn) {
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Toggle: clicking again closes, clicking another row opens fresh
                    const menu = document.getElementById('folderMenu');
                    if (menu && menu.classList.contains('open') && menu.dataset.trigger === f.id) {
                        closeFolderMenu();
                    } else {
                        openFolderMenu(mbx.id, f.id, moreBtn);
                    }
                });
            }
            row.addEventListener('click', () => selectFolder(mbx.id, f.id, f.folder_type, f.folder_name));

            // Drag-and-drop target — messages can be dropped here to move.
            row.addEventListener('dragover', (e) => {
                if (!e.dataTransfer?.types.includes('application/x-email-ids')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                row.classList.add('drag-over');
            });
            row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
            row.addEventListener('drop', (e) => {
                row.classList.remove('drag-over');
                const raw = e.dataTransfer?.getData('application/x-email-ids');
                if (!raw) return;
                e.preventDefault();
                let ids;
                try { ids = JSON.parse(raw); } catch { return; }
                if (!Array.isArray(ids) || ids.length === 0) return;
                performBulkMove(ids, mbx.id, f.id, prettyFolderName(f.folder_name, f.folder_type));
            });

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

    const pretty = prettyFolderName(folderName, folderType);
    document.getElementById('folderTitle').textContent = pretty;
    const mobileTitle = document.getElementById('mobileListTitle');
    if (mobileTitle) mobileTitle.textContent = pretty;
    State.selectedMessageId = null;
    clearBulkSelection();
    renderEmptyRead();
    renderAccountTree();
    loadMessages();

    // INBOX is kept live via IMAP IDLE. Other folders (Sent/Drafts/Trash/Junk/
    // Archive) only sync on the 25-min IDLE reconnect cycle, so trigger a
    // one-shot fetch in the background and reload if new messages landed.
    if (folderType && folderType !== 'inbox') {
        syncFolderInBackground(mailboxId, folderId);
    }

    // Close the mobile drawer + go back to list view on phone
    const shell = document.getElementById('emailShell');
    shell.classList.remove('show-rail');
    shell.classList.remove('show-read');
}

async function syncFolderInBackground(mailboxId, folderId) {
    try {
        const resp = await api.request(
            `/email/mailboxes/${mailboxId}/folders/${folderId}/sync`,
            { method: 'POST', _skipSpinner: true }
        );
        // Reload if the folder changed state AND we're still viewing it.
        // `inserted` → new arrivals we didn't have yet.
        // `pruned`   → rows reconcile deleted (user removed the message on
        //              another client). Without this we'd keep rendering the
        //              stale list until the user navigates away and back.
        const changed = (resp?.inserted || 0) + (resp?.pruned || 0) > 0;
        if (changed
            && State.selectedMailboxId === mailboxId
            && State.selectedFolderId === folderId) {
            loadMessages();
        }
    } catch (err) {
        // Non-fatal — stale cached messages are still shown.
        console.warn('Folder sync failed', err);
    }
}

// ==================== Messages ====================

async function loadMessages() {
    if (!State.selectedMailboxId || !State.selectedFolderId) return;

    // Reset pagination state whenever we load a new folder/search.
    State.messages = [];
    State.totalCount = 0;
    State.hasMore = false;
    State.isLoadingMore = false;
    if (loadMoreObserver) { loadMoreObserver.disconnect(); loadMoreObserver = null; }

    const rows = document.getElementById('emailRows');
    rows.innerHTML = skeletonRows(6);

    try {
        const resp = await fetchMessagesPage(0, PAGE_SIZE);
        State.messages = Array.isArray(resp?.items) ? resp.items : [];
        State.totalCount = resp?.total || State.messages.length;
        State.hasMore = State.messages.length < State.totalCount;
        updateFolderCount();
        renderMessages();
    } catch (err) {
        console.error('loadMessages failed', err);
        rows.innerHTML = `<div class="email-empty" style="padding:32px;"><p style="color:var(--color-danger);">${escapeHtml(err.message)}</p></div>`;
    }
}

async function loadMoreMessages() {
    if (State.isLoadingMore || !State.hasMore) return;
    State.isLoadingMore = true;
    try {
        const resp = await fetchMessagesPage(State.messages.length, PAGE_SIZE);
        const items = Array.isArray(resp?.items) ? resp.items : [];
        if (items.length > 0) State.messages = State.messages.concat(items);
        State.totalCount = resp?.total || State.totalCount;
        State.hasMore = State.messages.length < State.totalCount && items.length > 0;
        updateFolderCount();
        renderMessages();
    } catch (err) {
        console.error('loadMoreMessages failed', err);
        // Disable further attempts this session so we don't hammer on failure.
        State.hasMore = false;
    } finally {
        State.isLoadingMore = false;
    }
}

async function fetchMessagesPage(offset, limit) {
    // When the search box has a query, route to the server-side full-text
    // search endpoint so results span more than the currently-loaded page
    // and benefit from Postgres tsvector ranking. Falls back to per-folder
    // listing when the search box is empty.
    const q = (State.searchQuery || '').trim();
    if (q.length > 0) {
        const params = new URLSearchParams({
            q,
            limit: String(limit),
            offset: String(offset),
        });
        // Scope to current mailbox so one account's results don't mix with
        // another's. Folder scoping is opt-in; most people expect Gmail-style
        // "search everywhere in this account" when they type.
        if (State.selectedMailboxId) params.set('mailbox_id', State.selectedMailboxId);
        return await api.request(`/email/messages/search?${params}`, { _skipSpinner: true });
    }
    const url = `/email/messages?mailbox_id=${State.selectedMailboxId}`
        + `&folder_id=${State.selectedFolderId}`
        + `&limit=${limit}&offset=${offset}`;
    // _skipSpinner: the list already shows its own skeleton (initial) or streams
    // in silently (lazy scroll) — the global full-screen overlay would block UI
    // for no reason and make the list feel sluggish on every scroll page.
    return await api.request(url, { _skipSpinner: true });
}

function updateFolderCount() {
    const el = document.getElementById('folderCount');
    if (!el) return;
    el.textContent = State.totalCount
        ? `${State.messages.length} of ${State.totalCount}`
        : '';
}

// Debounced server-side search — hooked up to the #listSearch input. Short
// inputs (<2 chars) fall back to a no-op list so the user isn't spammed with
// results after the very first keystroke. Queries clearing to empty restore
// the normal folder listing.
let _searchTimer = null;
function wireSearchInput() {
    const input = document.getElementById('listSearch');
    if (!input) return;
    input.addEventListener('input', (e) => {
        const raw = e.target.value || '';
        State.searchQuery = raw;
        if (_searchTimer) clearTimeout(_searchTimer);
        const trimmed = raw.trim();
        // Empty query → reload the current folder list synchronously so the
        // user never stares at a stale search-hits view after clearing.
        if (trimmed.length === 0) {
            loadMessages();
            return;
        }
        // Very short queries are usually typos in progress — wait one extra
        // beat before hitting the server. 2+ chars fires the normal 250ms
        // debounce.
        const delay = trimmed.length < 2 ? 500 : 250;
        _searchTimer = setTimeout(() => { loadMessages(); }, delay);
    });
}

function refreshMessages() {
    Toast.info('Refreshing…');
    loadMessages();
    if (State.selectedFolderType && State.selectedFolderType !== 'inbox'
        && State.selectedMailboxId && State.selectedFolderId) {
        syncFolderInBackground(State.selectedMailboxId, State.selectedFolderId);
    }
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
    const q = (State.searchQuery || '').trim();
    let list = State.messages;

    // When a query is active, the server already filtered + ranked the list
    // via the tsvector search endpoint — re-filtering here would drop hits
    // that tsvector matched via stemming or tokenization the client regex
    // doesn't understand. Also skip the Focused/Other split on search results
    // so the user actually sees their query hits regardless of sender.
    if (!q) {
        // Focused vs. Other filter — heuristic: "Other" = Mail Delivery System,
        // noreply@, notifications@, newsletters, auto-reply, bounces. Good-enough
        // split matches Outlook's automated-vs-personal dichotomy without a
        // per-user model. Can evolve into a backend classifier later.
        list = list.filter(m => {
            const otherish = isOtherSender(m);
            return State.filter === 'focused' ? !otherish : otherish;
        });
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
        const collapsed = !!State.dateGroupCollapse[label];
        html += `
            <div class="email-date-separator ${collapsed ? 'collapsed' : ''}" data-bucket="${escapeHtml(label)}" role="button" aria-expanded="${!collapsed}" title="${collapsed ? 'Expand' : 'Collapse'} ${label}">
                <svg class="chev" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                ${label}
                <span class="email-date-count">${items.length}</span>
            </div>`;
        if (!collapsed) {
            for (const m of items) html += renderRow(m);
        }
    }

    // Sentinel at the bottom — triggers the next page via IntersectionObserver
    // when it enters view. Search pagination is server-side too (tsvector
    // rank + offset), so infinite scroll works there the same way as normal
    // listing. Skip only when user is on the Other tab (client-side filter).
    const serverSideList = q || State.filter === 'focused';
    if (State.hasMore && serverSideList) {
        html += `
            <div class="email-load-more" id="emailLoadMore">
                <div class="email-skel-row" style="opacity:0.55;">
                    <div class="skel-avatar"></div>
                    <div class="skel-lines">
                        <div class="skel-line w-60"></div>
                        <div class="skel-line w-80"></div>
                    </div>
                </div>
            </div>`;
    }

    container.innerHTML = html;

    container.querySelectorAll('.email-row').forEach(row => {
        // Click the checkbox → toggle selection; click the row elsewhere →
        // open the message. stopPropagation on the checkbox so it doesn't
        // double as an "open message" click.
        const cb = row.querySelector('.row-checkbox');
        if (cb) {
            cb.addEventListener('click', (e) => e.stopPropagation());
            cb.addEventListener('change', (e) => {
                toggleMessageSelection(row.dataset.messageId, e.target.checked);
            });
        }
        row.addEventListener('click', () => openMessage(row.dataset.messageId));

        // Drag-and-drop: user drags message row onto a folder in the sidebar.
        row.addEventListener('dragstart', (e) => {
            // If the row the user grabbed isn't in the selection, treat the
            // drag as a single-message move. Otherwise move everything in the
            // current selection set (Gmail-style multi-drag).
            const id = row.dataset.messageId;
            if (!State.selectedMessageIds.has(id)) {
                State.selectedMessageIds.clear();
                State.selectedMessageIds.add(id);
                renderBulkBar();
            }
            row.classList.add('dragging');
            const ids = Array.from(State.selectedMessageIds);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-email-ids', JSON.stringify(ids));
            e.dataTransfer.setData('text/plain', ids.join(','));
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.querySelectorAll('.email-folder-row.drag-over').forEach(f => f.classList.remove('drag-over'));
        });
    });

    // Date-bucket collapse/expand — click the separator to fold the group.
    container.querySelectorAll('.email-date-separator').forEach(sep => {
        sep.addEventListener('click', () => {
            const label = sep.dataset.bucket;
            if (!label) return;
            State.dateGroupCollapse[label] = !State.dateGroupCollapse[label];
            try { localStorage.setItem('email_date_group_collapse', JSON.stringify(State.dateGroupCollapse)); }
            catch { /* quota / private mode — non-fatal */ }
            renderMessages();
        });
    });

    attachLoadMoreObserver(container);
}

function attachLoadMoreObserver(container) {
    if (loadMoreObserver) { loadMoreObserver.disconnect(); loadMoreObserver = null; }
    const sentinel = document.getElementById('emailLoadMore');
    if (!sentinel) return;

    loadMoreObserver = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (e.isIntersecting) {
                loadMoreMessages();
                break;
            }
        }
    }, {
        root: container,
        // Pre-fetch: start loading ~400px before the sentinel scrolls into view
        // so the next page is ready by the time the user gets there.
        rootMargin: '400px 0px',
        threshold: 0,
    });
    loadMoreObserver.observe(sentinel);
}

function renderRow(m) {
    const senderName = m.from_name || m.from_address || '(unknown)';
    const initials = (senderName.trim()[0] || '?').toUpperCase();
    const avatarClass = 'ah-' + (hashStr(senderName) % 8);
    const isUnread = !m.is_read;
    const isActive = m.id === State.selectedMessageId;
    const isSelected = State.selectedMessageIds.has(m.id);
    const date = m.received_at || m.sent_at || m.created_at;
    return `
        <div class="email-row ${isUnread ? 'unread' : ''} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-message-id="${m.id}" draggable="true">
            <input type="checkbox" class="row-checkbox" aria-label="Select message" ${isSelected ? 'checked' : ''}>
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

    // On phone, swap to the reading pane (single-pane layout)
    document.getElementById('emailShell').classList.add('show-read');

    const readEmpty = document.getElementById('readEmpty');
    const readWrap = document.getElementById('readWrap');
    readEmpty.style.display = 'none';
    readWrap.style.display = 'flex';
    readWrap.innerHTML = `<div class="email-empty" style="padding:40px;"><p>Loading…</p></div>`;

    try {
        const [msg, attachments] = await Promise.all([
            api.request(`/email/messages/${messageId}`, { _skipSpinner: true }),
            api.request(`/email/messages/${messageId}/attachments`, { _skipSpinner: true }).catch(() => []),
        ]);
        renderMessage(msg, attachments || []);

        if (!msg.is_read) {
            api.request(`/email/messages/${messageId}/mark-read?read=true`, { method: 'POST', _skipSpinner: true })
                .then(() => {
                    const row = document.querySelector(`.email-row[data-message-id="${messageId}"]`);
                    if (row) row.classList.remove('unread');
                    const local = State.messages.find(m => m.id === messageId);
                    if (local) local.is_read = true;
                    adjustFolderUnreadCount(State.selectedMailboxId, State.selectedFolderId, -1);
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
        <!-- Phone-only back bar: returns the shell to list view -->
        <div class="email-mobile-header">
            <button id="btnBackToList" title="Back to list" aria-label="Back to list">
                <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="title">${escapeHtml(msg.subject || '(no subject)')}</span>
        </div>
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

    const backBtn = wrap.querySelector('#btnBackToList');
    if (backBtn) backBtn.addEventListener('click', () => {
        document.getElementById('emailShell').classList.remove('show-read');
        State.selectedMessageId = null;
        document.querySelectorAll('.email-row').forEach(r => r.classList.remove('active'));
    });
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
        const headers = await api.request(`/email/messages/${messageId}/headers`, { _skipSpinner: true });
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
        const local = State.messages.find(m => m.id === messageId);
        const wasRead = !!local?.is_read;
        await api.request(`/email/messages/${messageId}/mark-read?read=${isRead}`, { method: 'POST', _skipSpinner: true });
        Toast.success(isRead ? 'Marked as read' : 'Marked as unread');
        if (local) local.is_read = isRead;
        const row = document.querySelector(`.email-row[data-message-id="${messageId}"]`);
        if (row) row.classList.toggle('unread', !isRead);
        if (wasRead !== isRead) {
            adjustFolderUnreadCount(State.selectedMailboxId, State.selectedFolderId, isRead ? -1 : +1);
        }
    } catch (err) {
        Toast.error(`Failed: ${err.message}`);
    }
}

/**
 * Keep the sidebar unread badge in sync with reality as the user reads/flags
 * messages. Server STATUS updates only land on the 25-min reconnect cycle, so
 * without this optimistic update the badge lags behind visible state.
 */
function adjustFolderUnreadCount(mailboxId, folderId, delta) {
    if (!mailboxId || !folderId || !delta) return;
    const folders = State.foldersByMailbox[mailboxId];
    if (!folders) return;
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;
    folder.unread_count = Math.max(0, (folder.unread_count || 0) + delta);

    // Patch the DOM in place — rerendering the whole tree would collapse accounts
    // and lose scroll position. Look up the row via data attributes.
    const row = document.querySelector(
        `.email-folder-row[data-mailbox-id="${mailboxId}"][data-folder-id="${folderId}"]`
    );
    if (!row) return;
    let badge = row.querySelector('.folder-count');
    if (folder.unread_count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'folder-count';
            row.appendChild(badge);
        }
        badge.textContent = folder.unread_count;
    } else if (badge) {
        badge.remove();
    }
}

async function deleteMessage(messageId) {
    const ok = await Confirm.danger(
        'Delete this message? It will be moved to Trash on your mail server (or permanently expunged if the server has no Trash folder).',
        'Delete message');
    if (!ok) return;
    try {
        const res = await api.request(`/email/messages/${messageId}`, { method: 'DELETE' });
        State.messages = State.messages.filter(m => m.id !== messageId);
        State.selectedMessageId = null;
        renderMessages();
        renderEmptyRead();
        Toast.success(res?.outcome === 'expunged' ? 'Permanently deleted.' : 'Moved to Trash.');
    } catch (err) {
        Toast.error(`Delete failed: ${err.message}`);
    }
}

// ==================== Folder management (create / rename / delete) ====================
//
// All three operations hit IMAP first, then update our DB. Failure modes
// propagate back as the mail server's actual error text via our API client.
// UI uses the canonical glassmorphic .modal-* classes so these popovers
// look identical to HRMS/CRM modals.

const NewFolderState = { mailboxId: null };
const RenameFolderState = { mailboxId: null, folderId: null };

function openNewFolderModal(mailboxId, preselectedParentId = null) {
    closeFolderMenu();  // Always close the context menu when a modal opens
    NewFolderState.mailboxId = mailboxId;
    const overlay = document.getElementById('newFolderOverlay');
    const nameInput = document.getElementById('newFolderName');
    const parentSelect = document.getElementById('newFolderParent');
    const errorEl = document.getElementById('newFolderError');

    nameInput.value = '';
    errorEl.style.display = 'none';
    errorEl.textContent = '';

    parentSelect.innerHTML = '<option value="">No parent folder (top level)</option>';
    const folders = (State.foldersByMailbox[mailboxId] || []).filter(f => f.folder_type === 'custom');
    const depths = computeFolderDepths(folders);
    folders.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        const indent = '\u00A0\u00A0'.repeat(depths[f.id] || 0);
        opt.textContent = `${indent}${f.folder_name}`;
        parentSelect.appendChild(opt);
    });
    if (preselectedParentId) parentSelect.value = preselectedParentId;

    overlay.classList.add('active');
    setTimeout(() => nameInput.focus(), 50);
}

function closeNewFolderModal() {
    document.getElementById('newFolderOverlay').classList.remove('active');
    NewFolderState.mailboxId = null;
}

async function submitNewFolder() {
    const name = (document.getElementById('newFolderName').value || '').trim();
    const parentId = document.getElementById('newFolderParent').value || null;
    const errorEl = document.getElementById('newFolderError');
    const createBtn = document.getElementById('newFolderCreate');
    errorEl.style.display = 'none';

    if (!name) { errorEl.textContent = 'Folder name is required'; errorEl.style.display = 'block'; return; }
    if (/[\/\\\."]/.test(name)) {
        errorEl.textContent = "Folder name can't contain / \\ . or quote characters";
        errorEl.style.display = 'block';
        return;
    }

    const mailboxId = NewFolderState.mailboxId;
    if (!mailboxId) return;

    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
        await api.request(`/email/mailboxes/${mailboxId}/folders`, {
            method: 'POST',
            body: JSON.stringify({ name, parent_folder_id: parentId }),
            _skipSpinner: true,
        });
        Toast.success(`Created "${name}" on your mail server.`);
        closeNewFolderModal();
        await loadFolders(mailboxId);
        renderAccountTree();
    } catch (err) {
        errorEl.textContent = err.message || 'Could not create folder. The mail server may have rejected it.';
        errorEl.style.display = 'block';
    } finally {
        createBtn.disabled = false;
        createBtn.textContent = 'Create folder';
    }
}

function openRenameFolderModal(mailboxId, folderId) {
    closeFolderMenu();  // Always close the context menu when a modal opens
    const folder = (State.foldersByMailbox[mailboxId] || []).find(f => f.id === folderId);
    if (!folder) return;
    RenameFolderState.mailboxId = mailboxId;
    RenameFolderState.folderId = folderId;

    const overlay = document.getElementById('renameFolderOverlay');
    const nameInput = document.getElementById('renameFolderName');
    const errorEl = document.getElementById('renameFolderError');

    nameInput.value = folder.folder_name;
    errorEl.style.display = 'none';
    errorEl.textContent = '';

    overlay.classList.add('active');
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
}

function closeRenameFolderModal() {
    document.getElementById('renameFolderOverlay').classList.remove('active');
    RenameFolderState.mailboxId = null;
    RenameFolderState.folderId = null;
}

async function submitRenameFolder() {
    const name = (document.getElementById('renameFolderName').value || '').trim();
    const errorEl = document.getElementById('renameFolderError');
    const saveBtn = document.getElementById('renameFolderSubmit');
    errorEl.style.display = 'none';

    if (!name) { errorEl.textContent = 'Folder name is required'; errorEl.style.display = 'block'; return; }
    if (/[\/\\\."]/.test(name)) {
        errorEl.textContent = "Folder name can't contain / \\ . or quote characters";
        errorEl.style.display = 'block';
        return;
    }

    const { mailboxId, folderId } = RenameFolderState;
    if (!mailboxId || !folderId) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
        await api.request(`/email/mailboxes/${mailboxId}/folders/${folderId}`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
            _skipSpinner: true,
        });
        Toast.success(`Renamed to "${name}".`);
        closeRenameFolderModal();
        await loadFolders(mailboxId);
        renderAccountTree();
    } catch (err) {
        errorEl.textContent = err.message || 'Could not rename folder. The mail server may have rejected it.';
        errorEl.style.display = 'block';
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }
}

async function handleSyncFolders(mailboxId, btn) {
    // Tags the button as spinning, re-runs the same refresh+render path that
    // fires on initial load (POST /folders/refresh re-lists against IMAP and
    // prunes our DB against the server's truth). Safe to double-click — the
    // spin class is re-set each time, and the endpoint is idempotent.
    if (btn && btn.classList.contains('is-syncing')) return;
    if (btn) btn.classList.add('is-syncing');
    try {
        await loadFolders(mailboxId);
        renderAccountTree();
        if (window.Toast) Toast.success('Folder tree synced with server');
    } catch (err) {
        if (window.Toast) Toast.error(err?.message || 'Could not sync folders');
    } finally {
        if (btn) btn.classList.remove('is-syncing');
    }
}

async function handleDeleteFolder(mailboxId, folderId) {
    const all = State.foldersByMailbox[mailboxId] || [];
    const folder = all.find(f => f.id === folderId);
    if (!folder) return;

    // Count descendants by folder_path prefix so the confirm message is
    // truthful. IMAP hierarchy delimiter is '.' for Dovecot/Cyrus and '/'
    // for Gmail — check both. Uses a proper separator check to avoid
    // matching siblings whose names start with the folder name.
    const prefixDot = folder.folder_path + '.';
    const prefixSlash = folder.folder_path + '/';
    const descendants = all.filter(f =>
        f.id !== folderId &&
        (f.folder_path.startsWith(prefixDot) || f.folder_path.startsWith(prefixSlash))
    );
    const n = descendants.length;

    const msg = n === 0
        ? `Delete "${folder.folder_name}" from your mail server? Messages inside stay accessible in the thread list.`
        : `Delete "${folder.folder_name}" and its ${n} sub-folder${n === 1 ? '' : 's'} from your mail server? Messages inside stay accessible in the thread list.`;

    const ok = await Confirm.danger(msg, 'Delete folder');
    if (!ok) return;
    try {
        await api.request(`/email/mailboxes/${mailboxId}/folders/${folderId}`, {
            method: 'DELETE',
            _skipSpinner: true,
        });
        Toast.success(`Deleted "${folder.folder_name}".`);
        // If the deleted folder was selected, bounce the view back to inbox.
        if (State.selectedFolderId === folderId) {
            const inbox = (State.foldersByMailbox[mailboxId] || []).find(f => f.folder_type === 'inbox');
            if (inbox) selectFolder(mailboxId, inbox.id, 'inbox', inbox.folder_name);
        }
        await loadFolders(mailboxId);
        renderAccountTree();
    } catch (err) {
        Toast.error(err.message || 'Could not delete folder.');
    }
}

// ---- Folder context menu ----------------------------------------

const FolderMenuState = { mailboxId: null, folderId: null };

function openFolderMenu(mailboxId, folderId, triggerBtn) {
    FolderMenuState.mailboxId = mailboxId;
    FolderMenuState.folderId = folderId;

    const menu = document.getElementById('folderMenu');
    const rect = triggerBtn.getBoundingClientRect();

    // Position: aligned to the ⋯ button, slightly below. Clamp to viewport.
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;
    menu.classList.add('open');
    triggerBtn.setAttribute('aria-expanded', 'true');
    menu.dataset.trigger = triggerBtn.dataset.folderId;
}

function closeFolderMenu() {
    const menu = document.getElementById('folderMenu');
    if (!menu) return;
    menu.classList.remove('open');
    FolderMenuState.mailboxId = null;
    FolderMenuState.folderId = null;
    // Reset every ⋯ button's aria-expanded
    document.querySelectorAll('.folder-more-btn[aria-expanded="true"]')
        .forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function wireFolderMenu() {
    const menu = document.getElementById('folderMenu');
    if (!menu) return;
    // Route item clicks to the three actions.
    menu.querySelectorAll('.folder-menu-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const { mailboxId, folderId } = FolderMenuState;
            closeFolderMenu();
            if (!mailboxId || !folderId) return;
            if (action === 'new-child') openNewFolderModal(mailboxId, folderId);
            else if (action === 'rename') openRenameFolderModal(mailboxId, folderId);
            else if (action === 'delete') handleDeleteFolder(mailboxId, folderId);
        });
    });
    // Close on outside click / Escape. Using mousedown in the CAPTURE
    // phase so this fires BEFORE any downstream click handler that calls
    // stopPropagation (like the "+" button on the mailbox header which
    // opens the Create-folder modal). Without capture, stopPropagation
    // prevented the menu from closing when the user clicked other UI.
    document.addEventListener('mousedown', (e) => {
        if (!menu.classList.contains('open')) return;
        if (e.target.closest('.folder-menu')) return;
        if (e.target.closest('.folder-more-btn')) return;
        closeFolderMenu();
    }, { capture: true });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menu.classList.contains('open')) closeFolderMenu();
    });
    // Close on scroll (the popup is anchored to its trigger — scrolling
    // would leave it dangling).
    document.addEventListener('scroll', () => {
        if (menu.classList.contains('open')) closeFolderMenu();
    }, { capture: true, passive: true });
}

function wireNewFolderModal() {
    const overlay = document.getElementById('newFolderOverlay');
    if (!overlay) return;
    document.getElementById('newFolderClose').addEventListener('click', closeNewFolderModal);
    document.getElementById('newFolderCancel').addEventListener('click', closeNewFolderModal);
    document.getElementById('newFolderCreate').addEventListener('click', submitNewFolder);
    document.getElementById('newFolderBackdrop')?.addEventListener('click', closeNewFolderModal);
    document.getElementById('newFolderName').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitNewFolder(); }
        if (e.key === 'Escape') { e.preventDefault(); closeNewFolderModal(); }
    });
    // Rename modal
    const renameOverlay = document.getElementById('renameFolderOverlay');
    if (renameOverlay) {
        document.getElementById('renameFolderClose').addEventListener('click', closeRenameFolderModal);
        document.getElementById('renameFolderCancel').addEventListener('click', closeRenameFolderModal);
        document.getElementById('renameFolderSubmit').addEventListener('click', submitRenameFolder);
        document.getElementById('renameFolderBackdrop')?.addEventListener('click', closeRenameFolderModal);
        document.getElementById('renameFolderName').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); submitRenameFolder(); }
            if (e.key === 'Escape') { e.preventDefault(); closeRenameFolderModal(); }
        });
    }
    // Re-parent overlays to <body> so no ancestor transform traps them.
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
    if (renameOverlay && renameOverlay.parentElement !== document.body) document.body.appendChild(renameOverlay);
    const menu = document.getElementById('folderMenu');
    if (menu && menu.parentElement !== document.body) document.body.appendChild(menu);
    wireFolderMenu();
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

    // Lazy-init Quill on first open — same config CRM uses for parity.
    // Subsequent opens just clear the contents so drafts don't leak.
    const editorHost = document.getElementById('composeBodyEditor');
    if (editorHost && typeof Quill !== 'undefined') {
        if (!_composeQuill) {
            _composeQuill = new Quill(editorHost, {
                theme: 'snow',
                placeholder: 'Write your message…',
                modules: {
                    toolbar: [
                        [{ header: [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        [{ color: [] }, { background: [] }],
                        ['link', 'blockquote', 'code-block'],
                        ['clean']
                    ]
                }
            });
        }
        _composeQuill.setContents([]);
    }

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
        // Seed Quill with the quoted preamble so rich-text replies keep
        // the "> Original message" context visible while the user types
        // above it. Three empty paragraphs at the top so the caret starts
        // with room to breathe.
        if (_composeQuill) {
            const preamble = `<p><br></p><p><br></p><p><br></p><p>On ${formatFullDate(replyTo.received_at || replyTo.sent_at || replyTo.created_at)}, ${escapeHtml(fromName)} wrote:</p><blockquote>${escapeHtml(quoted).replace(/\n/g, '<br>')}</blockquote>`;
            _composeQuill.root.innerHTML = preamble;
        }
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

    // Pull both HTML (from Quill) and plain text for the multipart message.
    // Backend's MimeKit BodyBuilder needs both — recipients on text-only
    // clients (e.g. Mutt) still see a readable version.
    const bodyHtml = _composeQuill ? _composeQuill.root.innerHTML : '';
    const bodyText = _composeQuill
        ? _composeQuill.getText().replace(/\n+$/, '')
        : document.getElementById('composeBody').value;

    const payload = {
        mailbox_id: mailboxId,
        to,
        subject: document.getElementById('composeSubject').value.trim(),
        body_text: bodyText,
        body_html: bodyHtml,
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

/* ------------------------------------------------------------------
 * Schedule Meeting modal
 * ------------------------------------------------------------------ */
const ScheduleState = {
    participants: [],   // list of email strings
};

function wireScheduleMeetingModal() {
    const overlay = document.getElementById('scheduleMeetingOverlay');
    if (!overlay) return;

    // Re-parent to <body> so the dashboard's position:relative main doesn't
    // trap the position:fixed overlay (same issue as compose modal).
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);

    document.getElementById('scheduleMeetingClose').addEventListener('click', closeScheduleMeetingModal);
    document.getElementById('scheduleMeetingCancel').addEventListener('click', closeScheduleMeetingModal);
    document.getElementById('scheduleMeetingBackdrop').addEventListener('click', closeScheduleMeetingModal);

    document.getElementById('scheduleMeetingSubmit').addEventListener('click', submitScheduleMeeting);

    const chipInput = document.getElementById('meetingParticipantsInput');
    const field = document.getElementById('meetingParticipantsField');
    field.addEventListener('click', () => chipInput.focus());

    chipInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
            const v = chipInput.value.trim().replace(/,$/, '');
            if (v) { e.preventDefault(); addMeetingParticipant(v); chipInput.value = ''; }
        } else if (e.key === 'Backspace' && !chipInput.value && ScheduleState.participants.length > 0) {
            ScheduleState.participants.pop();
            renderMeetingParticipants();
        }
    });
    chipInput.addEventListener('blur', () => {
        const v = chipInput.value.trim();
        if (v) { addMeetingParticipant(v); chipInput.value = ''; }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeScheduleMeetingModal();
    });
}

function openScheduleMeetingModal() {
    ScheduleState.participants = [];
    renderMeetingParticipants();

    document.getElementById('meetingTitle').value = '';
    document.getElementById('meetingAgenda').value = '';
    document.getElementById('scheduleMeetingError').style.display = 'none';
    document.getElementById('scheduleMeetingError').textContent = '';

    // Default date = today, start = nearest next 30-minute slot, end = start + 30.
    const now = new Date();
    const roundedMin = Math.ceil((now.getMinutes() + 5) / 30) * 30;
    const start = new Date(now);
    start.setMinutes(roundedMin, 0, 0);
    const end = new Date(start.getTime() + 30 * 60000);

    document.getElementById('meetingDate').value = fmtLocalDate(start);
    document.getElementById('meetingStartTime').value = fmtLocalTime(start);
    document.getElementById('meetingEndTime').value = fmtLocalTime(end);

    const overlay = document.getElementById('scheduleMeetingOverlay');
    overlay.classList.add('active');
    setTimeout(() => document.getElementById('meetingTitle').focus(), 50);
}

function closeScheduleMeetingModal() {
    document.getElementById('scheduleMeetingOverlay').classList.remove('active');
}

function addMeetingParticipant(raw) {
    const parts = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    for (const email of parts) {
        if (!isValidEmail(email)) {
            showScheduleMeetingError(`'${email}' is not a valid email address`);
            continue;
        }
        if (ScheduleState.participants.some(p => p.toLowerCase() === email.toLowerCase())) continue;
        ScheduleState.participants.push(email);
    }
    renderMeetingParticipants();
}

function renderMeetingParticipants() {
    const wrap = document.getElementById('meetingParticipantsList');
    wrap.innerHTML = ScheduleState.participants.map((p, i) => `
        <span class="chip" data-idx="${i}">
            ${escapeHtml(p)}
            <button type="button" class="chip-remove" data-idx="${i}" aria-label="Remove">&times;</button>
        </span>
    `).join('');
    wrap.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            ScheduleState.participants.splice(+btn.dataset.idx, 1);
            renderMeetingParticipants();
        });
    });
}

function isValidEmail(s) {
    return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(s);
}

function showScheduleMeetingError(msg) {
    const el = document.getElementById('scheduleMeetingError');
    el.textContent = msg;
    el.style.display = '';
}

function clearScheduleMeetingError() {
    const el = document.getElementById('scheduleMeetingError');
    el.textContent = '';
    el.style.display = 'none';
}

async function submitScheduleMeeting() {
    clearScheduleMeetingError();

    const title = document.getElementById('meetingTitle').value.trim();
    const agenda = document.getElementById('meetingAgenda').value.trim();
    const dateStr = document.getElementById('meetingDate').value;
    const startStr = document.getElementById('meetingStartTime').value;
    const endStr = document.getElementById('meetingEndTime').value;

    // Flush any email still sitting in the chip input.
    const chipInput = document.getElementById('meetingParticipantsInput');
    if (chipInput.value.trim()) { addMeetingParticipant(chipInput.value); chipInput.value = ''; }

    if (!title) return showScheduleMeetingError('Title is required');
    if (!dateStr || !startStr || !endStr) return showScheduleMeetingError('Date, start and end time are required');
    if (ScheduleState.participants.length === 0) return showScheduleMeetingError('Add at least one participant');

    const start = new Date(`${dateStr}T${startStr}:00`);
    const end = new Date(`${dateStr}T${endStr}:00`);
    if (isNaN(start) || isNaN(end)) return showScheduleMeetingError('Invalid date/time');
    if (end <= start) return showScheduleMeetingError('End time must be after start time');

    const submitBtn = document.getElementById('scheduleMeetingSubmit');
    submitBtn.disabled = true;
    const origHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = 'Creating...';

    try {
        const body = {
            title,
            agenda: agenda || null,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            participants: ScheduleState.participants
        };
        const res = await api.request('/email/meetings', { method: 'POST', body: JSON.stringify(body) });
        closeScheduleMeetingModal();
        if (window.Toast) Toast.success('Meeting scheduled — invites sent');
        // Jump to the calendar so the user sees the new event.
        setTimeout(() => { window.location.href = 'calendar.html'; }, 400);
    } catch (err) {
        const msg = (err && (err.message || err.error)) || 'Failed to create meeting';
        showScheduleMeetingError(msg);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origHtml;
    }
}

function fmtLocalDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtLocalTime(d) {
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ------------------------------------------------------------------
 * Split-button dropdown (Schedule meeting / My calendar)
 * The chevron lives next to "+ New email". Clicking it toggles a
 * menu to the right; clicking outside closes it. Outside-click uses
 * mousedown capture-phase because the chevron's own click handler
 * calls stopPropagation to prevent the menu from closing itself on
 * the same click event.
 * ------------------------------------------------------------------ */
function wireComposeSplitMenu() {
    const chevron = document.getElementById('btnComposeMenu');
    const menu = document.getElementById('composeMenu');
    if (!chevron || !menu) return;

    // Re-parent the menu to <body> so it escapes the rail's overflow:hidden.
    // Without this the dropdown gets clipped by the rail and renders behind
    // the message-list pane.
    if (menu.parentElement !== document.body) document.body.appendChild(menu);

    const positionMenu = () => {
        const rect = chevron.getBoundingClientRect();
        // Open to the right by default, but fall back to "below" if it would
        // overflow the viewport horizontally.
        const menuWidth = Math.max(menu.offsetWidth, 210);
        const wouldOverflowRight = rect.right + 6 + menuWidth > window.innerWidth;
        if (wouldOverflowRight) {
            menu.style.top  = `${rect.bottom + 6}px`;
            menu.style.left = `${Math.max(8, rect.right - menuWidth)}px`;
        } else {
            menu.style.top  = `${rect.top}px`;
            menu.style.left = `${rect.right + 6}px`;
        }
    };

    const openMenu = () => {
        menu.hidden = false;
        positionMenu();
        chevron.setAttribute('aria-expanded', 'true');
    };
    const closeMenu = () => {
        menu.hidden = true;
        chevron.setAttribute('aria-expanded', 'false');
    };

    window.addEventListener('resize', () => { if (!menu.hidden) positionMenu(); });
    window.addEventListener('scroll', () => { if (!menu.hidden) positionMenu(); }, true);

    chevron.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        (chevron.getAttribute('aria-expanded') === 'true') ? closeMenu() : openMenu();
    });

    menu.addEventListener('click', (e) => {
        const btn = e.target.closest('button[role="menuitem"]');
        if (!btn) return;
        const action = btn.dataset.action;
        closeMenu();
        if (action === 'schedule-meeting') {
            openScheduleMeetingModal();
        } else if (action === 'my-calendar') {
            window.location.href = 'calendar.html';
        }
    });

    // Close on outside click — capture phase so the chevron's own
    // stopPropagation doesn't prevent closes from elsewhere.
    document.addEventListener('mousedown', (e) => {
        if (menu.hidden) return;
        if (menu.contains(e.target) || chevron.contains(e.target)) return;
        closeMenu();
    }, true);

    // Escape key closes the menu for keyboard users.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) closeMenu();
    });
}

// ==================== Bulk selection + bulk actions ====================

function wireBulkBar() {
    const selectAll = document.getElementById('emailBulkSelectAll');
    if (selectAll) selectAll.addEventListener('change', (e) => {
        if (e.target.checked) selectAllVisible();
        else clearBulkSelection();
    });
    // Hostinger-style always-visible select-all in the filter row — same
    // behavior, just a second entry point.
    const selectAllTop = document.getElementById('emailSelectAllTop');
    if (selectAllTop) selectAllTop.addEventListener('change', (e) => {
        if (e.target.checked) selectAllVisible();
        else clearBulkSelection();
    });
    const clearBtn = document.getElementById('emailBulkClear');
    if (clearBtn) clearBtn.addEventListener('click', () => clearBulkSelection());
    const markReadBtn = document.getElementById('emailBulkMarkRead');
    if (markReadBtn) markReadBtn.addEventListener('click', () => bulkMarkRead(true));
    const markUnreadBtn = document.getElementById('emailBulkMarkUnread');
    if (markUnreadBtn) markUnreadBtn.addEventListener('click', () => bulkMarkRead(false));
    const delBtn = document.getElementById('emailBulkDelete');
    if (delBtn) delBtn.addEventListener('click', bulkDelete);
    const moveBtn = document.getElementById('emailBulkMove');
    if (moveBtn) moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMoveMenu(moveBtn);
    });

    // Close the move menu on outside click / Escape.
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('emailMoveMenu');
        if (menu && !menu.hidden && !menu.contains(e.target) && !e.target.closest('#emailBulkMove')) {
            menu.hidden = true;
        }
    });
    document.addEventListener('keydown', (e) => {
        const menu = document.getElementById('emailMoveMenu');
        if (e.key === 'Escape' && menu && !menu.hidden) menu.hidden = true;
    });
}

function toggleMessageSelection(messageId, checked) {
    if (!messageId) return;
    if (checked) State.selectedMessageIds.add(messageId);
    else State.selectedMessageIds.delete(messageId);
    const row = document.querySelector(`.email-row[data-message-id="${messageId}"]`);
    if (row) row.classList.toggle('selected', checked);
    renderBulkBar();
}

function selectAllVisible() {
    State.selectedMessageIds.clear();
    document.querySelectorAll('#emailRows .email-row').forEach(row => {
        const id = row.dataset.messageId;
        if (!id) return;
        State.selectedMessageIds.add(id);
        row.classList.add('selected');
        const cb = row.querySelector('.row-checkbox');
        if (cb) cb.checked = true;
    });
    renderBulkBar();
}

function clearBulkSelection() {
    State.selectedMessageIds.clear();
    document.querySelectorAll('.email-row.selected').forEach(r => r.classList.remove('selected'));
    document.querySelectorAll('.email-row .row-checkbox:checked').forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('emailBulkSelectAll');
    if (selectAll) selectAll.checked = false;
    renderBulkBar();
}

function renderBulkBar() {
    const n = State.selectedMessageIds.size;
    const bar = document.getElementById('emailBulkBar');
    const list = document.getElementById('emailList');
    if (!bar || !list) return;
    if (n > 0) {
        bar.hidden = false;
        list.classList.add('has-selection');
    } else {
        bar.hidden = true;
        list.classList.remove('has-selection');
    }
    const count = document.getElementById('emailBulkCount');
    if (count) count.textContent = `${n} selected`;
    // Sync both select-all checkboxes (bulk-bar one + always-visible top one)
    // to reflect full/partial/empty selection state.
    const visible = document.querySelectorAll('#emailRows .email-row').length;
    const full = n > 0 && n === visible;
    const partial = n > 0 && n < visible;
    for (const selectAll of [document.getElementById('emailBulkSelectAll'), document.getElementById('emailSelectAllTop')]) {
        if (!selectAll) continue;
        selectAll.checked = full;
        selectAll.indeterminate = partial;
    }
}

async function bulkMarkRead(isRead) {
    const ids = Array.from(State.selectedMessageIds);
    if (ids.length === 0) return;
    try {
        await api.request('/email/messages/bulk/mark-read', {
            method: 'POST',
            body: JSON.stringify({ message_ids: ids, read: isRead }),
        });
        // Optimistic UI: flip local flags and badges so the change is instant.
        for (const id of ids) {
            const m = State.messages.find(x => x.id === id);
            if (!m) continue;
            if (m.is_read === isRead) continue;
            m.is_read = isRead;
            adjustFolderUnreadCount(State.selectedMailboxId, State.selectedFolderId, isRead ? -1 : +1);
        }
        clearBulkSelection();
        renderMessages();
        Toast.success(`Marked ${ids.length} as ${isRead ? 'read' : 'unread'}`);
    } catch (err) {
        Toast.error(`Failed: ${err.message || err}`);
    }
}

async function bulkDelete() {
    const ids = Array.from(State.selectedMessageIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} message${ids.length === 1 ? '' : 's'}?`)) return;
    try {
        const resp = await api.request('/email/messages/bulk/delete', {
            method: 'POST',
            body: JSON.stringify({ message_ids: ids }),
        });
        const deleted = resp?.deleted || 0;
        // Drop the deleted rows locally.
        State.messages = State.messages.filter(m => !ids.includes(m.id));
        clearBulkSelection();
        renderMessages();
        Toast.success(`${deleted} deleted`);
    } catch (err) {
        Toast.error(`Delete failed: ${err.message || err}`);
    }
}

async function performBulkMove(messageIds, mailboxId, targetFolderId, folderLabel) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;
    try {
        const resp = await api.request('/email/messages/bulk/move', {
            method: 'POST',
            body: JSON.stringify({ message_ids: messageIds, target_folder_id: targetFolderId }),
        });
        const moved = resp?.moved || 0;
        // Drop the moved rows from the CURRENT folder view and clear selection.
        State.messages = State.messages.filter(m => !messageIds.includes(m.id));
        clearBulkSelection();
        renderMessages();
        Toast.success(`Moved ${moved} to ${folderLabel || 'folder'}`);
        // Ask the target folder to refresh its count badge on the next poll.
        if (mailboxId && targetFolderId)
            syncFolderInBackground(mailboxId, targetFolderId);
    } catch (err) {
        Toast.error(`Move failed: ${err.message || err}`);
    }
}

function openMoveMenu(trigger) {
    const menu = document.getElementById('emailMoveMenu');
    if (!menu) return;
    // Re-parent to <body> so ancestor overflow/transform can't clip the flyout
    // behind the reading pane. `position: fixed` in CSS handles positioning
    // against the viewport.
    if (menu.parentElement !== document.body) {
        document.body.appendChild(menu);
    }
    const mailboxId = State.selectedMailboxId;
    if (!mailboxId) return;
    const folders = State.foldersByMailbox[mailboxId] || [];
    // Exclude the current folder from the target list — moving into the same
    // folder is a no-op and we shouldn't clutter the menu with it.
    const targets = folders.filter(f => f.id !== State.selectedFolderId);
    if (targets.length === 0) {
        Toast.info('No other folder to move to');
        return;
    }

    let html = '<div class="email-move-menu-group">Move to</div>';
    for (const f of targets) {
        const label = prettyFolderName(f.folder_name, f.folder_type);
        html += `
            <button type="button" class="email-move-menu-item" data-folder-id="${f.id}" role="menuitem">
                ${folderIconSVG(f.folder_type)}
                <span>${escapeHtml(label)}</span>
            </button>`;
    }
    menu.innerHTML = html;

    // Position just below the Move button.
    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 260)}px`;
    menu.hidden = false;

    menu.querySelectorAll('.email-move-menu-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const fid = btn.dataset.folderId;
            const label = btn.querySelector('span')?.textContent;
            menu.hidden = true;
            const ids = Array.from(State.selectedMessageIds);
            performBulkMove(ids, mailboxId, fid, label);
        });
    });
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
