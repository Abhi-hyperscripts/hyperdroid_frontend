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
 * Visual layer is delegated to /js/shared/whatsapp-ui.js (WhatsappUI.*).
 * That module emits all the markup with WA-Web-look classes; this file
 * stays focused on data flow + state. To change a colour or rearrange
 * a bubble, edit whatsapp-ui.css / whatsapp-ui.js — NOT this file.
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
    let conversations = [];       // [{customerPhone, customerName, lastMessageBody, lastMessageAtUtc, lastMessageDirection, lastMessageStatus, lastMessageType}]
    let activeCustomerPhone = ''; // currently open thread
    let threadMessages = [];      // messages for the active thread (raw — UI module groups them on render)
    let connection = null;        // SignalR
    let numberDropdown = null;    // SearchableDropdown instance for the picker
    let activeFilter = 'all';     // pill filter (all|unread|me)

    // Pending attachments in the composer. Now an ARRAY so the user can
    // attach multiple files at once and we render them as a WA-style album
    // when sent. Each entry holds the *uploaded* state so the user can
    // preview, caption, and Send when every upload completes. Cleared on
    // send / remove / thread switch.
    //   [{ fileId, mediaUrl, mediaType, fileName, contentType, fileSize, previewBlobUrl, uploading }]
    let pendingAttachments = [];

    // Interakt limits per WhatsApp's BSP rules (in bytes). Audio caps at 16MB
    // but document caps at 100MB; the picker also restricts MIME.
    const MAX_FILE_BYTES = 100 * 1024 * 1024;

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        if (typeof Navigation !== 'undefined') Navigation.init();
        await ensureLoggedIn();
        wireDomEvents();
        wireMobileBackHandler();
        // Single delegator for image/video tile clicks — opens the lightbox
        // and reads video durations as their metadata loads. The context
        // callback resolves sender + timestamp from the bubble row, and
        // collects ALL media in the thread for the lightbox's thumb strip
        // so the user can navigate across albums.
        WhatsappUI.wireMediaClicks(document.getElementById('waMessages'), {
            context: (row) => {
                const senderRaw = row.dataset.msgSender || '';
                // For outbound rows we get "You". For inbound we get '' (1:1
                // chats — fall back to the active customer's display name).
                const customerName = document.getElementById('waThreadTitle')?.textContent || '';
                const senderName = senderRaw && senderRaw !== 'You'
                    ? senderRaw
                    : (senderRaw === 'You' ? 'You' : customerName);
                const timestamp = row.dataset.msgTime || '';
                const allMedia = collectThreadMedia();
                return { senderName, timestamp, allMedia };
            },
            // Called by the lightbox's in-place reply form. The lightbox
            // renders its own quote chip + text input; we just need to take
            // the typed text and send it as a reply to the active thread.
            onReply: ({ text, replyTo }) => {
                if (!text || !activeCustomerPhone || !activeBusinessPhone) return;
                const cc = guessCountryCode(activeCustomerPhone);
                const local = activeCustomerPhone.startsWith(cc)
                    ? activeCustomerPhone.slice(cc.length)
                    : activeCustomerPhone;
                // Send as plain text — the recipient sees just the text. The
                // backend doesn't yet support per-message replyTo refs over
                // the Interakt template channel, but we already render the
                // local optimistic bubble with the quote so the operator
                // sees the context they replied to.
                sendOne({
                    business_phone_number: activeBusinessPhone,
                    recipient_country_code: '+' + cc,
                    recipient_phone: local,
                }, {
                    message_type: 'text', body: text, media_url: '', caption: '',
                }, {
                    messageType: 'text',
                    body: text,
                    replyTo: replyTo ? {
                        senderName: replyTo.senderName,
                        snippet: replyTo.kindLabel || (replyTo.kind === 'video' ? 'Video' : 'Photo'),
                        mediaType: replyTo.kind,
                    } : undefined,
                }).catch(err => console.warn('[wa-inbox] reply send failed:', err));
            }
        });
        if (pageMode === 'compact') {
            // Compact-mode init: skip the full-inbox bootstrap entirely. The
            // lead-detail modal already knows which lead this is and which
            // business number it was chatting on, so it passes both in URL
            // params and we drive the single thread directly.
            await loadCompactThread();
        } else {
            await loadNumbers();
        }
        await connectSignalR();
        // Tick the 24-h gate every minute so the template button reappears
        // automatically once the customer's last inbound ages past 24h —
        // no manual reload required.
        setInterval(updateTemplateButtonVisibility, 60 * 1000);
    }

    async function loadCompactThread() {
        // Both params are required — the caller (lead-journey.js) populates
        // them from the timeline entry's meta.customer_phone /
        // meta.business_phone fields. Missing → fall back to the SUPERADMIN
        // inbox bootstrap so a manual ?compact=1 url-paste still does
        // something useful for admins.
        const params = new URLSearchParams(window.location.search);
        const phone = (params.get('phone') || '').replace(/\D/g, '');
        const businessPhone = (params.get('business') || '').replace(/\D/g, '');
        if (!phone || !businessPhone) {
            console.warn('[wa-inbox] compact mode missing phone/business param — falling back to full-inbox bootstrap');
            await loadNumbers();
            return;
        }
        activeBusinessPhone = businessPhone;
        // Hide the inbox sidebar + picker — we have no conversation list in
        // compact mode, just the open thread.
        document.getElementById('waNumberPicker')?.style?.setProperty('display', 'none');
        document.getElementById('waSidebarEmpty')?.style?.setProperty('display', 'none');
        const convList = document.getElementById('waConvList');
        if (convList) convList.innerHTML = '';
        // Open the thread directly — openConversation calls /whatsapp/thread
        // which the backend authorizes via CrmScope ownership check.
        await openConversation(phone, params.get('name') || '');
    }

    // Per-page mode. 'full' = standalone inbox (SUPERADMIN-only). 'compact'
    // = single-thread iframe embedded in the lead-detail modal (any CRM user
    // who can access the lead). Set inside ensureLoggedIn from URL params so
    // every downstream branch can check one flag instead of re-parsing.
    let pageMode = 'full';

    function ensureLoggedIn() {
        const tok = localStorage.getItem('ragenaizer_authToken') || localStorage.getItem('authToken');
        if (!tok) {
            window.location.href = '/pages/login.html';
            return new Promise(() => {});
        }
        // Compact-mode iframe (?compact=1&phone=...) is the per-lead chat
        // view: backend's GET /thread + POST /send now allow CRM_USER when
        // CrmScope.CanAccess(lead.ownerUserId, lead.teamId) passes. The
        // SUPERADMIN-only inbox endpoints (/numbers, /conversations) are
        // skipped in compact mode — the caller passes ?business=<digits>
        // so we don't need to enumerate the tenant's numbers.
        const params = new URLSearchParams(window.location.search);
        const isCompact = params.get('compact') === '1' && !!params.get('phone');
        pageMode = isCompact ? 'compact' : 'full';

        const user = (typeof api !== 'undefined' && api.getUser) ? api.getUser() : null;
        const roles = user?.roles || [];
        if (!roles.includes('SUPERADMIN') && pageMode === 'full') {
            if (typeof Toast !== 'undefined') Toast.error('WhatsApp Inbox is restricted to administrators.');
            window.location.href = '/pages/crm/dashboard.html';
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
            search.addEventListener('input', () => {
                renderConversationList();
            });
        }
        // Filter pills (All / Unread / Outbound)
        document.querySelectorAll('#waFilters .wa-filter-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#waFilters .wa-filter-pill').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                activeFilter = btn.dataset.filter || 'all';
                renderConversationList();
            });
        });
        const refreshBtn = document.getElementById('waRefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => loadConversations());

        const emojiBtn = document.getElementById('waEmojiBtn');
        if (emojiBtn) {
            emojiBtn.addEventListener('click', () => {
                WhatsappUI.EmojiPicker.open(emojiBtn, emoji => {
                    const ta = document.getElementById('waComposerInput');
                    if (!ta) return;
                    // Insert at the cursor position (or append if no selection).
                    const start = ta.selectionStart ?? ta.value.length;
                    const end = ta.selectionEnd ?? ta.value.length;
                    ta.value = ta.value.slice(0, start) + emoji + ta.value.slice(end);
                    const caret = start + emoji.length;
                    ta.focus();
                    ta.setSelectionRange(caret, caret);
                    autoSizeTextarea(ta);
                });
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

        // Template picker — the canonical path for messaging outside Meta's
        // 24h reply window. The modal handles its own picker / preview /
        // send; we just give it the active number + recipient.
        const tplBtn = document.getElementById('waTemplateBtn');
        if (tplBtn && typeof WhatsAppTemplatePicker !== 'undefined') {
            tplBtn.addEventListener('click', () => {
                if (!activeCustomerPhone) {
                    if (typeof Toast !== 'undefined') Toast.warning('Pick a conversation first');
                    return;
                }
                WhatsAppTemplatePicker.open({
                    businessPhone: activeBusinessPhone,
                    recipientPhone: activeCustomerPhone,
                    onSent: () => {
                        // Refresh the thread so the new outbound row from
                        // /whatsapp/send shows up next to existing
                        // messages. SignalR also broadcasts the outbound
                        // row, but re-opening guarantees ordering for the
                        // immediate send case. The picker already called
                        // Toast.success.
                        const customerName = document.getElementById('waThreadTitle')?.textContent || '';
                        if (activeCustomerPhone) openConversation(activeCustomerPhone, customerName);
                    },
                });
            });
        }
    }

    function wireMobileBackHandler() {
        const app = document.getElementById('waApp');
        WhatsappUI.installMobileBackHandler({
            app,
            onBack: () => {
                app.classList.remove('has-active-thread');
                activeCustomerPhone = '';
                threadMessages = [];
                renderThread();
                renderThreadHeader(null);
                renderConversationList();
            }
        });
    }

    // Collect ALL image/video URLs in the open thread, in chronological
    // order — feeds the lightbox's thumb strip so the user can scrub the
    // entire thread's media without closing.
    function collectThreadMedia() {
        const out = [];
        for (const m of threadMessages) {
            const t = (m.messageType || '').toLowerCase();
            if ((t === 'image' || t === 'video') && m.mediaUrl) {
                out.push({ kind: t, url: m.mediaUrl });
            }
        }
        return out;
    }

    function autoSizeTextarea(ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
        // Toggle send/mic button visibility — WA Web pattern: empty composer
        // shows the mic, non-empty composer shows the send.
        const text = (ta.value || '').trim();
        const sendBtn = document.getElementById('waSendBtn');
        const micBtn = document.getElementById('waMicBtn');
        const hasAttach = pendingAttachments.length > 0;
        if (sendBtn) sendBtn.hidden = !(text || hasAttach);
        if (micBtn)  micBtn.hidden  = !!(text || hasAttach);
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
        const convList = document.getElementById('waConvList');

        if (allNumbers.length === 0 || activeNumbers.length === 0) {
            // Show "connect a number" inside the list pane
            noNumbers.style.display = '';
            sidebarEmpty.style.display = 'none';
            picker.style.display = 'none';
            if (convList) convList.innerHTML = '';
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
                    activeCustomerPhone = '';
                    threadMessages = [];
                    document.getElementById('waApp')?.classList.remove('has-active-thread');
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
                lastMessageStatus: c.last_message_status ?? c.lastMessageStatus ?? '',
                lastMessageType: c.last_message_type ?? c.lastMessageType ?? 'text',
                unreadCount: c.unread_count ?? c.unreadCount ?? 0,
                // Drives the "Lead" badge + the kebab menu's
                // "Open Lead in CRM" vs "Convert to Lead" branching.
                leadId: c.lead_id ?? c.leadId ?? '',
            }));
        } catch (err) {
            console.error('[wa-inbox] loadConversations failed:', err);
            conversations = [];
            if (typeof Toast !== 'undefined') Toast.error('Failed to load conversations');
        }
        renderConversationList();
    }

    function visibleConversations() {
        const search = document.getElementById('waSearchInput');
        const term = (search?.value || '').toLowerCase().trim();

        return conversations.filter(c => {
            // Search filter
            if (term) {
                const hit = (c.customerPhone || '').toLowerCase().includes(term)
                    || (c.customerName || '').toLowerCase().includes(term)
                    || (c.lastMessageBody || '').toLowerCase().includes(term);
                if (!hit) return false;
            }
            // Pill filter
            if (activeFilter === 'unread' && !(c.unreadCount > 0)) return false;
            if (activeFilter === 'me' && c.lastMessageDirection !== 'outbound') return false;
            return true;
        });
    }

    function renderConversationList() {
        const ul = document.getElementById('waConvList');
        const empty = document.getElementById('waSidebarEmpty');
        if (!ul) return;

        const list = visibleConversations();
        if (!list || list.length === 0) {
            ul.innerHTML = '';
            empty.style.display = '';
            return;
        }
        empty.style.display = 'none';
        ul.innerHTML = list.map(c => WhatsappUI.renderConversationRow(c, {
            active: c.customerPhone === activeCustomerPhone,
            unread: c.unreadCount > 0
        })).join('');
        // Wire row clicks (open thread) — but ignore clicks on the kebab.
        ul.querySelectorAll('.wa-conv-row').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('.wa-conv-menu-btn')) return;   // menu has its own handler
                openConversation(row.dataset.phone, row.dataset.name || '');
            });
        });
        // Wire kebab menus
        ul.querySelectorAll('.wa-conv-menu-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                openRowKebabMenu(btn);
            });
        });
    }

    // Build the kebab-menu items based on whether the row is already a lead.
    // This is the per-row workflow:
    //   • If not a lead → "Convert to Lead" + "Convert to Lead and Assign Team…"
    //   • If already a lead → "Open Lead in CRM" + "Assign Team…" (so an
    //     operator can attach a team after the fact without leaving WA inbox)
    function openRowKebabMenu(btn) {
        const phone = btn.dataset.phone;
        const name  = btn.dataset.name || '';
        const leadId = btn.dataset.leadId || '';

        const ICON_LEAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`;
        const ICON_TEAM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
        const ICON_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

        const items = [];
        if (leadId) {
            items.push({
                label: 'Open Lead in CRM',
                icon: ICON_OPEN,
                // Lead detail lives inside the leads page via ?lead= deeplink,
                // matching how `reassign-queue.js` and other CRM modules link.
                onClick: () => window.location.href = `leads.html?lead=${encodeURIComponent(leadId)}`
            });
            items.push({
                label: 'Assign Team…',
                icon: ICON_TEAM,
                onClick: () => pickTeamThenConvert(phone, name, leadId)
            });
        } else {
            items.push({
                label: 'Convert to Lead',
                icon: ICON_LEAD,
                onClick: () => convertToLead(phone, name, /*teamId*/ null)
            });
            items.push({
                label: 'Convert to Lead and Assign Team…',
                icon: ICON_TEAM,
                onClick: () => pickTeamThenConvert(phone, name, /*existingLeadId*/ null)
            });
        }
        WhatsappUI.RowMenu.open(btn, items);
    }

    async function convertToLead(customerPhone, customerName, teamId) {
        try {
            const resp = await api.request('/whatsapp/convert-to-lead', {
                method: 'POST',
                body: JSON.stringify({
                    customer_phone: customerPhone,
                    customer_name: customerName,
                    team_id: teamId,
                })
            });
            if (!resp || resp.success === false) {
                throw new Error(resp?.message || 'Convert failed');
            }
            const msg = resp.alreadyExisted
                ? (resp.assigned ? 'Already a lead — team assigned' : 'Already a lead')
                : (resp.assigned ? 'Converted to lead and assigned to team' : 'Converted to lead');
            if (typeof Toast !== 'undefined') Toast.success(msg);
            // Refresh conversations so the lead-id badge shows up.
            await loadConversations();
        } catch (err) {
            console.error('[wa-inbox] convert failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Convert failed');
        }
    }

    // Open the team picker, then call convert-to-lead with the chosen teamId.
    async function pickTeamThenConvert(customerPhone, customerName, existingLeadId) {
        let teams = [];
        try {
            // CRM service path — `/teams` alone routes to Vision via api.js's
            // default-prefix rule. The `/crm/` prefix is what every other
            // CRM page uses for the same endpoint.
            const resp = await api.request('/crm/teams');
            const raw = (resp && resp.teams) ? resp.teams : (Array.isArray(resp) ? resp : []);
            teams = raw.map(t => ({
                id: t.id ?? t.teamId ?? t.team_id,
                name: t.team_name ?? t.teamName ?? t.name ?? '(unnamed team)',
                meta: t.member_count != null ? `${t.member_count} member${t.member_count === 1 ? '' : 's'}` : '',
            })).filter(t => t.id);
        } catch (err) {
            console.warn('[wa-inbox] team list failed:', err);
            if (typeof Toast !== 'undefined') Toast.error('Could not load teams');
            return;
        }
        WhatsappUI.TeamPicker.open({
            title: existingLeadId ? 'Assign team to lead' : 'Convert to lead and assign team',
            teams,
            onPick: (teamId) => convertToLead(customerPhone, customerName, teamId),
        });
    }

    // ─── Thread ─────────────────────────────────────────────────────────────

    async function openConversation(customerPhone, customerName) {
        if (!customerPhone) return;
        // Switching threads invalidates any in-flight composer attachment.
        clearPendingAttachment();
        activeCustomerPhone = customerPhone;
        document.getElementById('waApp')?.classList.add('has-active-thread');
        renderThreadHeader({ customerPhone, customerName });

        const messagesDiv = document.getElementById('waMessages');
        const empty = document.getElementById('waThreadEmpty');
        if (empty) empty.style.display = 'none';
        if (messagesDiv) {
            messagesDiv.style.display = '';
            messagesDiv.innerHTML = '<div class="wa-loading">Loading messages…</div>';
        }

        let loadStatus = 'ok';
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
                fileName: m.file_name ?? m.fileName ?? '',
                status: m.status,
                receivedAtUtc: m.received_at_utc ?? m.receivedAtUtc ?? '',
                sentAtUtc: m.sent_at_utc ?? m.sentAtUtc ?? '',
                createdAtUtc: m.created_at_utc ?? m.createdAtUtc ?? '',
            }));
        } catch (err) {
            console.error('[wa-inbox] thread load failed:', err);
            threadMessages = [];
            // Distinguish 403 (you can't see this conversation) from generic
            // failure so the UI doesn't lie. api.request attaches the HTTP
            // status to the thrown Error (see js/api.js). Hide the composer
            // so the rep doesn't type a reply that the backend will also
            // reject on send.
            const isForbidden = err?.status === 403;
            loadStatus = isForbidden ? 'forbidden' : 'error';
            if (typeof Toast !== 'undefined') {
                Toast.error(isForbidden
                    ? "You don't have access to this conversation"
                    : 'Failed to load thread');
            }
        }
        if (loadStatus === 'forbidden') {
            // Show a clear "no access" state in the messages pane and keep
            // the composer hidden — replying would also 403.
            const messagesDiv = document.getElementById('waMessages');
            if (messagesDiv) {
                messagesDiv.innerHTML = '<div class="wa-loading" style="text-align:center;padding:32px 16px;color:var(--text-secondary);">This conversation belongs to a lead you don\'t own. Ask an admin to reassign it if you need access.</div>';
            }
            showComposer(false);
            renderConversationList();
            return;
        }
        renderThread();
        renderConversationList();
        showComposer(true);
    }

    function renderThreadHeader(thread) {
        const header = document.getElementById('waThreadHeader');
        const titleEl = document.getElementById('waThreadTitle');
        const subEl = document.getElementById('waThreadSub');
        const avatarSlot = document.getElementById('waThreadAvatarSlot');
        if (!header || !titleEl || !subEl) return;
        if (!thread) {
            header.style.display = 'none';
            titleEl.textContent = 'Pick a conversation';
            subEl.textContent = '';
            if (avatarSlot) avatarSlot.innerHTML = '';
            return;
        }
        const display = (thread.customerName && thread.customerName.trim())
            ? thread.customerName
            : formatPhone(thread.customerPhone);
        header.style.display = '';
        titleEl.textContent = display;
        subEl.textContent = formatPhone(thread.customerPhone);
        if (avatarSlot) avatarSlot.innerHTML = WhatsappUI.renderAvatar(display);
    }

    // Wraps renderThread + updateTemplateButtonVisibility so every entry
    // point that mutates threadMessages (initial load, SignalR inbound,
    // optimistic outbound, status update) re-evaluates the 24-h gate.
    function renderThread() {
        updateTemplateButtonVisibility();
        return renderThreadImpl();
    }
    function renderThreadImpl() {
        const messagesDiv = document.getElementById('waMessages');
        const empty = document.getElementById('waThreadEmpty');
        const composer = document.getElementById('waComposer');
        const composerNote = document.getElementById('waComposerDisabledNote');
        if (!messagesDiv) return;

        if (!activeCustomerPhone) {
            messagesDiv.innerHTML = '';
            messagesDiv.style.display = 'none';
            if (empty) empty.style.display = 'flex';
            if (composer) composer.style.display = 'none';
            if (composerNote) composerNote.style.display = 'none';
            return;
        }

        if (empty) empty.style.display = 'none';
        messagesDiv.style.display = '';

        if (threadMessages.length === 0) {
            messagesDiv.innerHTML = '<div class="wa-loading">No messages yet — send the first reply below.</div>';
            return;
        }

        // First collapse runs of media into albums (multi-tile bubbles), then
        // group with first-of-group / first-of-day flags. The renderer drops
        // any entry tagged `_collapsed: true` since its media has already been
        // rolled up into the leader's album.
        const collapsed = WhatsappUI.collapseAlbums(threadMessages, 60);
        const grouped = WhatsappUI.groupMessages(collapsed);
        const html = grouped.map(m => {
            if (m._collapsed) return '';
            const datePill = m._firstOfDay
                ? WhatsappUI.renderDatePill(m._dateLabel)
                : '';
            const bubble = WhatsappUI.renderBubble(m, {
                firstOfGroup: m._firstOfGroup,
                showSender: false   // 1:1 chat — no sender names needed
            });
            return datePill + bubble;
        }).join('');
        messagesDiv.innerHTML = html;
        // Scroll to bottom — three-pass to survive async layout shifts.
        // 1. Sync: lands close enough that the user doesn't see a flash mid-thread.
        // 2. RAF: after the next paint, when text/font metrics have settled.
        // 3. Image-load: each <img> in the new content scrolls again as it loads,
        //    since image loads happen well after innerHTML and would otherwise
        //    push the latest bubble off-screen.
        const scrollDown = () => { messagesDiv.scrollTop = messagesDiv.scrollHeight; };
        scrollDown();
        requestAnimationFrame(scrollDown);
        messagesDiv.querySelectorAll('img').forEach(img => {
            if (!img.complete) img.addEventListener('load', scrollDown, { once: true });
        });
    }

    function showComposer(show) {
        const composer = document.getElementById('waComposer');
        const note = document.getElementById('waComposerDisabledNote');
        if (composer) composer.style.display = show ? '' : 'none';
        if (note) note.style.display = show ? 'none' : '';
        // Re-evaluate send/mic button visibility after composer (re)appears.
        const ta = document.getElementById('waComposerInput');
        if (ta) autoSizeTextarea(ta);
        // The template-send button is INR-per-message via Meta. When the
        // customer has replied within the last 24 hours, free-form text
        // is free — hide the template button to nudge reps toward the
        // cheaper path. Re-evaluated when (a) a thread opens,
        // (b) an inbound message arrives via SignalR, (c) the rep sends
        // an outbound row (outbound doesn't reset the window).
        updateTemplateButtonVisibility();
    }

    function getLastInboundAtMs() {
        // Walk thread newest-first and return the timestamp of the most
        // recent inbound. Returns 0 when there's never been any inbound
        // (cold lead) — caller treats 0 as "outside the window".
        for (let i = threadMessages.length - 1; i >= 0; i--) {
            const m = threadMessages[i];
            if (m.direction !== 'inbound') continue;
            const t = m.receivedAtUtc || m.createdAtUtc || m.sentAtUtc;
            if (!t) continue;
            const ms = new Date(t).getTime();
            if (!Number.isNaN(ms)) return ms;
        }
        return 0;
    }

    function updateTemplateButtonVisibility() {
        const btn = document.getElementById('waTemplateBtn');
        if (!btn) return;
        const lastInboundMs = getLastInboundAtMs();
        const withinWindow = lastInboundMs > 0
            && (Date.now() - lastInboundMs) < (24 * 60 * 60 * 1000);
        // Inside the window: free-form is free, hide the paid template
        // button. Outside the window (or never replied): show it because
        // free-form would be rejected by Meta with a "outside session"
        // error anyway.
        btn.style.display = withinWindow ? 'none' : '';
    }

    // ─── Attachments ────────────────────────────────────────────────────────

    function classifyAttachment(file) {
        const mime = (file.type || '').toLowerCase();
        const name = (file.name || '').toLowerCase();
        const ext  = name.includes('.') ? name.split('.').pop() : '';
        if (mime.startsWith('image/'))  return { mediaType: 'image',    ok: ['jpeg','png','webp'].some(t => mime === 'image/' + t) };
        if (mime.startsWith('video/'))  return { mediaType: 'video',    ok: ['mp4','3gpp'].some(t => mime === 'video/' + t) };
        if (mime.startsWith('audio/'))  return { mediaType: 'audio',    ok: ['mpeg','aac','ogg','amr'].some(t => mime === 'audio/' + t) };
        if (mime === 'application/pdf' || ext === 'pdf') return { mediaType: 'document', ok: true };
        const docExts = ['doc','docx','xls','xlsx','ppt','pptx','txt'];
        if (docExts.includes(ext)) return { mediaType: 'document', ok: true };
        return { mediaType: 'document', ok: false };
    }

    async function handleFilePicked(e) {
        const files = e.target.files ? Array.from(e.target.files) : [];
        if (files.length === 0) return;
        // Allow incremental adds — preserve any pending attachments already
        // uploaded (e.g. user picks a file, then picks more without sending).
        const startIdx = pendingAttachments.length;
        for (const file of files) {
            const cls = classifyAttachment(file);
            if (!cls.ok) {
                if (typeof Toast !== 'undefined') Toast.error(`Skipped ${file.name}: unsupported file type`);
                continue;
            }
            if (file.size > MAX_FILE_BYTES) {
                if (typeof Toast !== 'undefined') Toast.error(`Skipped ${file.name}: too large (limit 100MB)`);
                continue;
            }
            const previewBlobUrl = URL.createObjectURL(file);
            pendingAttachments.push({
                mediaType: cls.mediaType,
                fileName: file.name,
                contentType: file.type || 'application/octet-stream',
                fileSize: file.size,
                previewBlobUrl,
                fileId: null,
                mediaUrl: null,
                uploading: true,
                uploadPct: 0,
                _file: file,   // hold the File object for the upload step
            });
        }
        renderAttachPreview();
        autoSizeTextarea(document.getElementById('waComposerInput'));

        // Upload the newly-added entries in parallel.
        const newOnes = pendingAttachments.slice(startIdx);
        await Promise.all(newOnes.map(att => uploadOneAttachment(att)));
    }

    async function uploadOneAttachment(att) {
        try {
            const upResp = await api.request('/drive/whatsapp/upload-url', {
                method: 'POST',
                body: JSON.stringify({
                    file_name: att.fileName,
                    content_type: att.contentType,
                    file_size: att.fileSize,
                    expiry_minutes: 30,
                })
            });
            if (!upResp || upResp.success === false || !upResp.upload_url) {
                throw new Error(upResp?.message || 'Failed to get upload URL');
            }
            await putWithProgress(upResp.upload_url, att._file, pct => {
                att.uploadPct = pct;
                renderAttachPreview();
            });
            att.fileId = upResp.file_id;

            const safeKey = String(upResp.file_id).split('/').map(encodeURIComponent).join('/');
            const dlResp = await api.request(
                `/drive/whatsapp/download/${safeKey}?expiry_minutes=30`,
                { method: 'GET' }
            );
            if (!dlResp || dlResp.success === false || !dlResp.url) {
                throw new Error(dlResp?.message || 'Failed to get download URL');
            }
            att.mediaUrl = dlResp.url;
            att.uploading = false;
            att.uploadPct = 100;
            renderAttachPreview();
            autoSizeTextarea(document.getElementById('waComposerInput'));
        } catch (err) {
            console.error('[wa-inbox] upload failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(`${att.fileName}: ${err.message || 'Upload failed'}`);
            // Remove the failed entry; keep other pending ones.
            const idx = pendingAttachments.indexOf(att);
            if (idx >= 0) pendingAttachments.splice(idx, 1);
            if (att.previewBlobUrl) URL.revokeObjectURL(att.previewBlobUrl);
            renderAttachPreview();
            autoSizeTextarea(document.getElementById('waComposerInput'));
        }
    }

    function putWithProgress(url, file, onPct) {
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

    function renderAttachPreview() {
        const el = document.getElementById('waAttachPreview');
        if (!el) return;
        if (pendingAttachments.length === 0) {
            el.innerHTML = '';
            el.style.display = 'none';
            return;
        }
        // Render one chip per pending attachment, with a thumb + name + size +
        // per-item progress bar + remove ×. The wrapper itself stays a flex
        // row, so we wrap chips in a flex column so multiple stack vertically.
        const chips = pendingAttachments.map((a, i) => {
            let thumb = '';
            if (a.mediaType === 'image') {
                thumb = `<img src="${a.previewBlobUrl}" alt="">`;
            } else if (a.mediaType === 'video') {
                thumb = `<video src="${a.previewBlobUrl}" muted></video>`;
            } else {
                thumb = `<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.06);border-radius:6px;">📎</div>`;
            }
            const sizeKb = Math.max(1, Math.round(a.fileSize / 1024));
            const progressBar = a.uploading
                ? `<div class="wa-attach-progress"><span style="width:${a.uploadPct || 0}%;"></span></div>`
                : '';
            return `
                <div style="display:flex;gap:12px;align-items:center;width:100%;${i > 0 ? 'border-top:1px solid var(--wa-divider);padding-top:8px;margin-top:8px;' : ''}">
                    ${thumb}
                    <div class="wa-attach-preview-meta">
                        <div class="wa-attach-preview-name">${WhatsappUI.escapeHtml(a.fileName)}</div>
                        <div class="wa-attach-preview-info">${a.mediaType} · ${sizeKb} KB${a.uploading ? ` · uploading ${a.uploadPct || 0}%` : ' · ready'}</div>
                        ${progressBar}
                    </div>
                    <button type="button" class="wa-attach-preview-remove" data-attach-idx="${i}" title="Remove">×</button>
                </div>`;
        }).join('');
        el.innerHTML = `<div style="display:flex;flex-direction:column;width:100%;">${chips}</div>`;
        el.style.display = '';
        el.querySelectorAll('.wa-attach-preview-remove').forEach(btn => {
            btn.addEventListener('click', () => removeAttachment(Number(btn.dataset.attachIdx)));
        });
    }

    function removeAttachment(idx) {
        if (idx < 0 || idx >= pendingAttachments.length) return;
        const a = pendingAttachments[idx];
        if (a.previewBlobUrl) URL.revokeObjectURL(a.previewBlobUrl);
        pendingAttachments.splice(idx, 1);
        renderAttachPreview();
        autoSizeTextarea(document.getElementById('waComposerInput'));
    }

    function clearPendingAttachment() {
        for (const a of pendingAttachments) {
            if (a.previewBlobUrl) URL.revokeObjectURL(a.previewBlobUrl);
        }
        pendingAttachments = [];
        const el = document.getElementById('waAttachPreview');
        if (el) { el.innerHTML = ''; el.style.display = 'none'; }
        const fileInput = document.getElementById('waFileInput');
        if (fileInput) fileInput.value = '';
        autoSizeTextarea(document.getElementById('waComposerInput'));
    }

    // ─── Send ───────────────────────────────────────────────────────────────

    async function handleSendSubmit(e) {
        e.preventDefault();
        const ta = document.getElementById('waComposerInput');
        const text = (ta?.value || '').trim();
        if (!activeCustomerPhone || !activeBusinessPhone) return;

        const readyAttachments = pendingAttachments.filter(a => !a.uploading && !!a.mediaUrl);
        const stillUploading = pendingAttachments.some(a => a.uploading);
        if (stillUploading) {
            if (typeof Toast !== 'undefined') Toast.warning('Wait for uploads to finish');
            return;
        }
        if (readyAttachments.length === 0 && !text) return;

        const sendBtn = document.getElementById('waSendBtn');
        if (sendBtn) sendBtn.disabled = true;

        // Take a snapshot of what we're about to send and clear the composer
        // immediately so the user can start typing the next message.
        const attachmentsToSend = readyAttachments.slice();
        const captionText = text;
        ta.value = '';
        clearPendingAttachment();
        autoSizeTextarea(ta);

        try {
            const cc = guessCountryCode(activeCustomerPhone);
            const local = activeCustomerPhone.startsWith(cc)
                ? activeCustomerPhone.slice(cc.length)
                : activeCustomerPhone;
            const baseRecipient = {
                business_phone_number: activeBusinessPhone,
                recipient_country_code: '+' + cc,
                recipient_phone: local,
            };

            if (attachmentsToSend.length === 0) {
                // Plain text only — single send.
                await sendOne(baseRecipient, {
                    message_type: 'text', body: captionText, media_url: '', caption: '',
                }, { messageType: 'text', body: captionText });
            } else {
                // One /whatsapp/send call per media. Caption travels with the
                // FIRST one (matches WA Web album behavior). All sends fire in
                // sequence so they keep their album-grouping order.
                for (let i = 0; i < attachmentsToSend.length; i++) {
                    const att = attachmentsToSend[i];
                    const isFirst = (i === 0);
                    await sendOne(baseRecipient, {
                        message_type: att.mediaType,
                        body: '',
                        media_url: att.mediaUrl,
                        caption: isFirst ? captionText : '',
                    }, {
                        messageType: att.mediaType,
                        body: isFirst ? captionText : '',
                        mediaUrl: att.mediaUrl,   // already uploaded — use the S3 URL directly
                        fileName: att.fileName,
                    });
                }
            }
        } catch (err) {
            console.error('[wa-inbox] send failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Send failed');
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    // Single-message send + optimistic update + rebump. Pulled out of
    // handleSendSubmit so multi-attachment sends share the same path.
    async function sendOne(baseRecipient, payload, optimisticInfo) {
        const optimisticId = 'opt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        const optimistic = {
            id: optimisticId,
            direction: 'outbound',
            messageType: optimisticInfo.messageType || 'text',
            body: optimisticInfo.body || '',
            mediaUrl: optimisticInfo.previewBlobUrl || optimisticInfo.mediaUrl || '',
            fileName: optimisticInfo.fileName || '',
            replyTo: optimisticInfo.replyTo,   // inline reply quote (from lightbox Reply)
            status: 'sending',
            createdAtUtc: new Date().toISOString(),
        };
        threadMessages.push(optimistic);
        renderThread();

        try {
            const resp = await api.request('/whatsapp/send', {
                method: 'POST',
                body: JSON.stringify(Object.assign({}, baseRecipient, payload)),
            });
            const wamId = resp.whatsapp_message_id ?? resp.whatsappMessageId ?? optimisticId;
            const providerMessageId = resp.provider_message_id ?? resp.providerMessageId ?? null;
            const status = resp.status || 'sent';
            const idx = threadMessages.findIndex(m => m.id === optimisticId);
            if (idx >= 0) {
                threadMessages[idx] = {
                    id: wamId,
                    providerMessageId,
                    direction: 'outbound',
                    messageType: payload.message_type,
                    body: optimisticInfo.body || '',
                    mediaUrl: optimisticInfo.mediaUrl || '',
                    fileName: optimisticInfo.fileName || '',
                    status,
                    sentAtUtc: new Date().toISOString(),
                    createdAtUtc: optimistic.createdAtUtc,
                };
            }
            renderThread();

            const previewLine = (optimisticInfo.body || '').trim()
                || `(${payload.message_type})`;
            bumpConversationToTop(activeCustomerPhone, previewLine, 'outbound', payload.message_type, status, wamId, providerMessageId);
            renderConversationList();
            if (status !== 'sent' && typeof Toast !== 'undefined') {
                Toast.warning(resp.message || `Provider returned ${status}`);
            }
        } catch (err) {
            const idx = threadMessages.findIndex(m => m.id === optimisticId);
            if (idx >= 0) {
                threadMessages[idx].status = 'failed';
                renderThread();
            }
            throw err;
        }
    }

    function bumpConversationToTop(customerPhone, lastBody, direction, messageType, status, lastMessageId, lastProviderMessageId) {
        const idx = conversations.findIndex(c => c.customerPhone === customerPhone);
        let conv;
        if (idx >= 0) {
            // Mutate the existing object in place to preserve customerName,
            // unreadCount, and any other fields the row renderer reads.
            conv = conversations[idx];
            conversations.splice(idx, 1);
        } else {
            conv = { customerPhone, customerName: '' };
        }
        conv.lastMessageBody = lastBody;
        conv.lastMessageDirection = direction;
        conv.lastMessageType = messageType || 'text';
        conv.lastMessageStatus = status || '';
        conv.lastMessageAtUtc = new Date().toISOString();
        // Stash the ids so the SignalR status_update handler can patch the
        // tick on the conversation-list preview without needing a refresh.
        if (lastMessageId) conv.lastMessageId = lastMessageId;
        if (lastProviderMessageId) conv.lastMessageProviderMessageId = lastProviderMessageId;
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

        // Status receipts (sent / delivered / read / failed) come through
        // the same event with eventKind="status_update". Patch the existing
        // row in place instead of appending — that's what re-renders the
        // ✓ → ✓✓ → blue-✓✓ tick on the outbound bubble.
        //
        // Belt-and-braces detection: the status branch fires if eventKind
        // says so OR direction is outbound. Outbound bubbles are written
        // by /whatsapp/send → optimistic update; SignalR never *adds* one,
        // it only ever *updates* its status. Treating any outbound payload
        // as a status patch means a missing/stale eventKind field can't
        // cause a phantom-inbound to be appended (the bug we shipped on
        // the first deploy).
        const isStatusUpdate = ev.eventKind === 'status_update' || ev.direction === 'outbound';
        if (isStatusUpdate) {
            // Match by id first, then by providerMessageId — depending on
            // whether the local message came from the optimistic-replace
            // (id = CRM row id) or an older send-flow (id = NS transient
            // guid; providerMessageId = Interakt's id).
            let idx = threadMessages.findIndex(m => m.id === ev.id);
            if (idx < 0 && ev.providerMessageId) {
                idx = threadMessages.findIndex(m => m.providerMessageId === ev.providerMessageId);
            }
            if (idx >= 0) {
                threadMessages[idx].status = ev.status || threadMessages[idx].status;
                threadMessages[idx].providerMessageId = threadMessages[idx].providerMessageId || ev.providerMessageId;
                renderThread();
            }
            // Also patch the conversation list's lastMessageStatus so the
            // little tick next to "You: ..." in the list reflects the latest.
            // Match by id, then providerMessageId, then customerPhone — the
            // last is the catch-all for rows where the conversation row was
            // populated before we started stashing ids on it.
            let convIdx = conversations.findIndex(c => c.lastMessageId === ev.id);
            if (convIdx < 0 && ev.providerMessageId) {
                convIdx = conversations.findIndex(c => c.lastMessageProviderMessageId === ev.providerMessageId);
            }
            if (convIdx < 0 && ev.customerPhone) {
                convIdx = conversations.findIndex(c =>
                    c.customerPhone === ev.customerPhone &&
                    c.lastMessageDirection === 'outbound');
            }
            if (convIdx >= 0) {
                conversations[convIdx].lastMessageStatus = ev.status;
                if (!conversations[convIdx].lastMessageId && ev.id) conversations[convIdx].lastMessageId = ev.id;
                if (!conversations[convIdx].lastMessageProviderMessageId && ev.providerMessageId) {
                    conversations[convIdx].lastMessageProviderMessageId = ev.providerMessageId;
                }
                renderConversationList();
            }
            return;
        }

        // If this is for the open thread, append; else just bump the list.
        if (ev.customerPhone === activeCustomerPhone) {
            threadMessages.push({
                id: ev.id,
                direction: ev.direction || 'inbound',
                messageType: ev.messageType,
                body: ev.body,
                mediaUrl: ev.mediaUrl,
                status: ev.status || 'received',
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
            conv = {
                customerPhone: ev.customerPhone,
                customerName: ev.customerName || '',
                unreadCount: 0
            };
        }
        conv.customerName = conv.customerName || ev.customerName || '';
        conv.lastMessageBody = previewLineFor(ev.body, ev.mediaUrl, ev.messageType);
        conv.lastMessageDirection = 'inbound';
        conv.lastMessageType = ev.messageType || 'text';
        conv.lastMessageAtUtc = ev.receivedAtUtc || new Date().toISOString();
        // Bump unread if this isn't the open thread
        if (ev.customerPhone !== activeCustomerPhone) {
            conv.unreadCount = (conv.unreadCount || 0) + 1;
        }
        conversations.unshift(conv);
        renderConversationList();
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
})();
