// ============================================================================
// WhatsappUI — shared "WhatsApp Web look-alike" rendering helpers.
//
// The CRM inbox uses these. Any future page that wants the same WA-Web feel
// (e.g. Vision DM-style chat, NotificationService mass-WA preview, etc.)
// can `<script src=js/shared/whatsapp-ui.js>` and call into this module
// rather than copy-pasting markup from whatsapp-inbox.js.
//
// Page expectations:
//   <link rel=stylesheet href=/css/whatsapp-ui.css>
//   <div class=wa-app>
//     <aside class=wa-rail>... icons ...</aside>      ← optional on mobile
//     <section class=wa-list-pane>                    ← chat list
//       <header class=wa-list-header>...</header>
//       <ul class=wa-conv-list></ul>                  ← rows go here
//     </section>
//     <section class=wa-thread-pane>                  ← active thread
//       <header class=wa-thread-header>...</header>
//       <div class=wa-messages></div>                 ← bubbles go here
//       <form class=wa-composer>...</form>
//     </section>
//   </div>
//
// API surface:
//   WhatsappUI.renderConversationRow(conv, { active, unread })  → HTML string
//   WhatsappUI.renderBubble(msg, { firstOfGroup, showSender })   → HTML string
//   WhatsappUI.renderDatePill(label)                             → HTML string
//   WhatsappUI.tickSvg(status)                                   → HTML string
//   WhatsappUI.senderColor(name)                                 → "#hex"
//   WhatsappUI.formatTime(iso)                                   → "10:42"
//   WhatsappUI.formatRelative(iso)                               → "Today" | "Yesterday" | weekday | dd/mm/yyyy
//   WhatsappUI.dateLabel(iso)                                    → "TODAY" | "YESTERDAY" | "5 May 2026"
//   WhatsappUI.escapeHtml(s)                                     → safe string
//   WhatsappUI.linkify(s)                                        → autolinked HTML
//   WhatsappUI.installMobileBackHandler({app, onBack})           → wires history.back() / Esc
//   WhatsappUI.groupMessages(messages)                           → tags first-of-group + first-of-day
// ============================================================================

(function (window) {
    'use strict';

    // ── Escape / linkify ────────────────────────────────────────────────────
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
        }[c]));
    }
    function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

    // Detect URLs in a (already-escaped) string and wrap them in <a>.
    // Run AFTER escapeHtml so we don't open an XSS hole.
    function linkify(safeText) {
        // The protocol-prefixed pattern below matches what Chrome's URLify
        // does, minus footnotes. Trailing punctuation is excluded so
        // "see https://x.com." doesn't capture the period.
        return safeText.replace(
            /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g,
            url => `<a href="${url}" target="_blank" rel="noopener" class="wa-bubble-link">${url}</a>`
        );
    }

    // ── Sender color (mirrors WhatsApp Web's per-person color hash) ─────────
    // WA Web rotates 18 colors keyed off the participant id. We do the same
    // off the display name so the same name always renders in the same color.
    const SENDER_COLORS = [
        '#e8385f', '#d96e22', '#1f7aec', '#1da855', '#7d23a8',
        '#0c8a8a', '#9c5d04', '#cb2c8e', '#3f51b5', '#0077b5',
        '#ad1457', '#5d4037', '#33691e', '#bf360c', '#0277bd',
        '#4527a0', '#00838f', '#558b2f'
    ];
    function senderColor(name) {
        if (!name) return SENDER_COLORS[0];
        let h = 0;
        for (let i = 0; i < name.length; i++) {
            h = (h << 5) - h + name.charCodeAt(i);
            h |= 0;
        }
        return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length];
    }

    // ── Time / date formatters ──────────────────────────────────────────────
    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    // "cold_intro_v1" → "Cold intro v1" — readable label for a template
    // name when a (body-less) template row has no rendered text to show.
    function humanizeTemplate(name) {
        if (!name) return 'Template message';
        const s = String(name).replace(/_/g, ' ').trim();
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Template message';
    }

    function formatTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        // 24h locale-independent (matches WA Web default).
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function formatRelative(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        if (sameDay) return formatTime(iso);
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        const diffMs = now.getTime() - d.getTime();
        const days = Math.floor(diffMs / 86_400_000);
        if (days < 7 && days >= 0) return d.toLocaleDateString(undefined, { weekday: 'short' });
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    }

    function dateLabel(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        if (sameDay) return 'TODAY';
        const y = new Date(now); y.setDate(now.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return 'YESTERDAY';
        const diffMs = now.getTime() - d.getTime();
        const days = Math.floor(diffMs / 86_400_000);
        if (days < 7 && days >= 0) return d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    }

    // ── Tick SVGs (sent → delivered → read) ─────────────────────────────────
    // Inline so we never hit a 404 — these are in every outbound bubble.
    const TICK_SVGS = {
        // Single check (queued / sent to BSP)
        sent: `<svg viewBox="0 0 16 11" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M11.071.653a.5.5 0 01.064.704l-7.5 9a.5.5 0 01-.745.043L.207 7.18a.5.5 0 11.708-.706l2.265 2.262 7.187-8.62a.5.5 0 01.704-.064z"/></svg>`,
        // Double check (delivered)
        delivered: `<svg viewBox="0 0 16 11" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M11.071.653a.5.5 0 01.064.704l-5 6a.5.5 0 01-.745.043L3.207 5.18a.5.5 0 11.708-.706l1.762 1.76 4.69-5.516a.5.5 0 01.704-.064zM15.071.653a.5.5 0 01.064.704l-7.5 9a.5.5 0 01-.745.043L4.207 7.18a.5.5 0 11.708-.706l2.265 2.262 7.187-8.62a.5.5 0 01.704-.064z"/></svg>`,
        // Double check, blue (read)
        read: `<svg viewBox="0 0 16 11" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M11.071.653a.5.5 0 01.064.704l-5 6a.5.5 0 01-.745.043L3.207 5.18a.5.5 0 11.708-.706l1.762 1.76 4.69-5.516a.5.5 0 01.704-.064zM15.071.653a.5.5 0 01.064.704l-7.5 9a.5.5 0 01-.745.043L4.207 7.18a.5.5 0 11.708-.706l2.265 2.262 7.187-8.62a.5.5 0 01.704-.064z"/></svg>`,
        // Clock (still pending — rare; only seen during optimistic UI)
        sending: `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor"/><path d="M8 4v4l2.5 1.5" fill="none" stroke="currentColor" stroke-linecap="round"/></svg>`,
        // ! (failed)
        failed: `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" fill="#d32f2f"/><path d="M8 4v5M8 11v.5" stroke="#fff" stroke-linecap="round" stroke-width="1.6"/></svg>`,
    };
    function tickSvg(status) {
        const s = (status || '').toLowerCase();
        if (s === 'failed' || s === 'error')              return wrapTick(TICK_SVGS.failed, '');
        if (s === 'sending' || s === 'queued' || s === '') return wrapTick(TICK_SVGS.sending, '');
        if (s === 'sent' || s === 'submitted')             return wrapTick(TICK_SVGS.sent, '');
        if (s === 'delivered')                             return wrapTick(TICK_SVGS.delivered, '');
        if (s === 'read' || s === 'seen')                  return wrapTick(TICK_SVGS.read, ' is-read');
        return wrapTick(TICK_SVGS.sent, '');
    }
    function wrapTick(svg, extraCls) {
        return `<span class="wa-bubble-meta-tick${extraCls}">${svg}</span>`;
    }

    // ── Avatar HTML ─────────────────────────────────────────────────────────
    function renderAvatar(displayName, photoUrl) {
        const initial = (displayName || '?').trim().charAt(0).toUpperCase() || '?';
        if (photoUrl) {
            return `<div class="wa-avatar"><img src="${escapeAttr(photoUrl)}" alt=""></div>`;
        }
        const bg = senderColor(displayName || '');
        return `<div class="wa-avatar" style="background:${bg};">${escapeHtml(initial)}</div>`;
    }

    // ── Conversation row ────────────────────────────────────────────────────
    // conv shape (caller normalizes to whatever they have):
    //   {
    //     id, customerPhone, customerName, photoUrl,
    //     lastMessageBody, lastMessageAtUtc,
    //     lastMessageDirection ('inbound'|'outbound'),
    //     lastMessageStatus, lastMessageType ('text'|'image'|...),
    //     unreadCount, isMuted, isPinned
    //   }
    // opts: { active: bool, unread: bool }
    function renderConversationRow(conv, opts) {
        opts = opts || {};
        const phone = conv.customerPhone || '';
        const display = (conv.customerName && conv.customerName.trim())
            ? conv.customerName
            : (conv.displayName || phone || '?');
        const time = formatRelative(conv.lastMessageAtUtc);

        // Build the "preview" line. WA Web shows:
        //   • outbound icon (tick) before "You: …"
        //   • media-type icon for non-text messages
        let prefixIconHtml = '';
        if (conv.lastMessageDirection === 'outbound') {
            prefixIconHtml = tickSvg(conv.lastMessageStatus || 'sent');
        }

        let mediaIconHtml = '';
        const mt = (conv.lastMessageType || 'text').toLowerCase();
        if (mt === 'image')      mediaIconHtml = mediaIcon('camera');
        else if (mt === 'video') mediaIconHtml = mediaIcon('video');
        else if (mt === 'audio') mediaIconHtml = mediaIcon('mic');
        else if (mt === 'document') mediaIconHtml = mediaIcon('document');

        let previewText = conv.lastMessageBody || '';
        if (!previewText && mt !== 'text') {
            previewText = mt.charAt(0).toUpperCase() + mt.slice(1); // "Image", "Audio"
        }
        const preview = escapeHtml(previewText.length > 80
            ? previewText.slice(0, 80) + '…'
            : previewText);

        const unreadBadge = (opts.unread && conv.unreadCount)
            ? `<span class="wa-conv-badge">${conv.unreadCount}</span>`
            : '';

        // "→ Lead" badge for already-converted contacts. The backend's
        // /whatsapp/conversations response sets conv.leadId when this
        // phone matches an active lead in the tenant, so the operator
        // can see at a glance which contacts are already in the pipeline
        // (and the kebab menu morphs Convert → Open Lead for them).
        const leadBadge = conv.leadId
            ? `<span class="wa-conv-lead-badge" title="Already a CRM lead">Lead</span>`
            : '';

        const cls = [
            'wa-conv-row',
            opts.active ? 'is-active' : '',
            opts.unread ? 'is-unread' : ''
        ].filter(Boolean).join(' ');

        // Kebab menu — always rendered; CSS hides it until row-hover. The
        // host page wires it to WhatsappUI.RowMenu.open with whatever
        // actions make sense (Convert / Open Lead / etc.). We carry the
        // lead-id on the button so the host doesn't have to re-resolve it.
        const kebab = `
            <button type="button" class="wa-conv-menu-btn"
                    data-phone="${escapeAttr(phone)}"
                    data-name="${escapeAttr(display)}"
                    data-lead-id="${escapeAttr(conv.leadId || '')}"
                    aria-label="More options">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>
              </svg>
            </button>`;

        return `
            <li>
              <div class="${cls}"
                   data-phone="${escapeAttr(phone)}"
                   data-name="${escapeAttr(display)}"
                   data-conv-id="${escapeAttr(conv.id || '')}"
                   data-lead-id="${escapeAttr(conv.leadId || '')}">
                ${renderAvatar(display, conv.photoUrl)}
                <div class="wa-conv-meta">
                  <div class="wa-conv-line1">
                    <span class="wa-conv-name">${escapeHtml(display)}</span>
                    <span class="wa-conv-time">${escapeHtml(time)}</span>
                  </div>
                  <div class="wa-conv-line2">
                    <span class="wa-conv-preview">${prefixIconHtml}${mediaIconHtml}${preview || '<em style="opacity:.6;">No messages yet</em>'}</span>
                    ${leadBadge}
                    ${unreadBadge}
                  </div>
                </div>
                ${kebab}
              </div>
            </li>`;
    }

    // ── Media preview icons (for the conversation list preview line) ────────
    function mediaIcon(kind) {
        const PATHS = {
            camera:   `<path fill="currentColor" d="M9 4l-1.5 2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5L15 4H9zm3 4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"/>`,
            video:    `<path fill="currentColor" d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4V6.5l-4 4z"/>`,
            mic:      `<path fill="currentColor" d="M12 2a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3zm6 9a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-3.07A8 8 0 0 0 20 11h-2z"/>`,
            document: `<path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>`,
        };
        return `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[kind] || ''}</svg>`;
    }

    // ── Date / unread separator pills ───────────────────────────────────────
    function renderDatePill(label) {
        return `<div class="wa-date-pill">${escapeHtml(label || '')}</div>`;
    }
    function renderUnreadPill(count) {
        const txt = count === 1 ? '1 UNREAD MESSAGE' : `${count} UNREAD MESSAGES`;
        return `<div class="wa-unread-pill">${escapeHtml(txt)}</div>`;
    }

    // ── Group messages: tag first-of-group / first-of-day ───────────────────
    // Returns the *same* array with extra flags so the renderer doesn't have
    // to remember whether the prior message was from the same direction +
    // same calendar day. WA's bubble tail only renders on first-of-group.
    function groupMessages(messages) {
        if (!messages || messages.length === 0) return [];
        let prev = null;
        return messages.map(m => {
            const ts = m.timestamp || m.receivedAtUtc || m.sentAtUtc || m.createdAtUtc;
            const day = ts ? new Date(ts).toDateString() : '';
            const sameDay = !!prev && prev._day === day;
            const sameDir = !!prev && prev.direction === m.direction;
            const sameAuthor = !!prev && (prev.senderId || '') === (m.senderId || '');
            const closeInTime = !!prev && prev._tsMs && (new Date(ts).getTime() - prev._tsMs) < 60 * 1000;
            const firstOfGroup = !sameDay || !sameDir || !sameAuthor || !closeInTime;
            const firstOfDay = !sameDay;
            const tagged = Object.assign({}, m, {
                _day: day,
                _tsMs: ts ? new Date(ts).getTime() : 0,
                _firstOfGroup: firstOfGroup,
                _firstOfDay: firstOfDay,
                _dateLabel: firstOfDay ? dateLabel(ts) : ''
            });
            prev = tagged;
            return tagged;
        });
    }

    // ── Bubble ──────────────────────────────────────────────────────────────
    // msg shape (caller normalizes):
    //   {
    //     id, direction ('inbound'|'outbound'),
    //     messageType ('text'|'image'|'video'|'audio'|'document'),
    //     body, mediaUrl, fileName, status,
    //     senderName, senderId,                      ← optional, only for groups
    //     replyTo: { senderName, snippet, mediaType } ← optional
    //     reactions: [{emoji, count}]                ← optional
    //     forwarded: bool                            ← optional
    //     timestamp / receivedAtUtc / sentAtUtc
    //   }
    // opts: { firstOfGroup, showSender }
    function renderBubble(m, opts) {
        opts = opts || {};
        const dir = (m.direction || '').toLowerCase() === 'outbound' ? 'outbound' : 'inbound';
        const ts = m.timestamp || m.receivedAtUtc || m.sentAtUtc || m.createdAtUtc;
        const time = formatTime(ts);
        const isOut = dir === 'outbound';

        const tickHtml = isOut
            ? tickSvg(m.status || 'sent')
            : '';

        const meta = `
            <span class="wa-bubble-meta">
              <span class="wa-bubble-meta-time">${escapeHtml(time)}</span>
              ${tickHtml}
            </span>`;

        const senderHtml = (opts.showSender && !isOut && m.senderName)
            ? `<span class="wa-bubble-sender" style="color:${senderColor(m.senderName)};">${escapeHtml(m.senderName)}</span>`
            : '';

        const forwardedHtml = m.forwarded
            ? `<div class="wa-bubble-forwarded">↪ Forwarded</div>`
            : '';

        const replyHtml = m.replyTo
            ? `<div class="wa-bubble-reply">
                 <span class="wa-bubble-reply-name">${escapeHtml(m.replyTo.senderName || '')}</span>
                 <span class="wa-bubble-reply-snippet">${escapeHtml(m.replyTo.snippet || '')}</span>
               </div>`
            : '';

        const type = (m.messageType || 'text').toLowerCase();
        const captionRaw = m.body ? linkify(escapeHtml(m.body)) : '';
        const captionHtml = captionRaw ? `<span class="wa-bubble-caption">${captionRaw}</span>` : '';

        const baseRowCls = ['wa-msg-row', dir, opts.firstOfGroup ? 'first-of-group' : ''].filter(Boolean).join(' ');
        // Stash the message timestamp + sender on the row so the lightbox
        // delegator can read them without needing to be passed the original
        // message object. Sender for outbound is "You" by convention; the
        // caller can override it via opts.youLabel.
        const youLabel = opts.youLabel || 'You';
        const rowSender = m.senderName || (isOut ? youLabel : '');
        const rowTime = ts || '';

        let mediaInner = '';
        let bubbleExtra = '';

        // Albums (multi-media bubble) take precedence over single-media render.
        if (Array.isArray(m.album) && m.album.length > 1) {
            bubbleExtra = ' wa-bubble-media';
            mediaInner = renderAlbum(m.album) + captionHtml;
        } else if (type === 'image' && m.mediaUrl) {
            bubbleExtra = ' wa-bubble-media';
            mediaInner = `<img src="${escapeAttr(m.mediaUrl)}" alt="image" loading="lazy" data-media-kind="image" data-media-src="${escapeAttr(m.mediaUrl)}">${captionHtml}`;
        } else if (type === 'video' && m.mediaUrl) {
            bubbleExtra = ' wa-bubble-media';
            mediaInner = renderVideoFrame(m.mediaUrl) + captionHtml;
        } else if (type === 'audio' && m.mediaUrl) {
            bubbleExtra = ' wa-bubble-media';
            mediaInner = `<audio src="${escapeAttr(m.mediaUrl)}" controls preload="metadata"></audio>`;
        } else if (type === 'document' && m.mediaUrl) {
            const fileLabel = m.fileName || inferFileNameFromUrl(m.mediaUrl) || 'Document';
            mediaInner = `
                <a class="wa-bubble-doc" href="${escapeAttr(m.mediaUrl)}" target="_blank" rel="noopener">
                  <span class="wa-bubble-doc-icon">${mediaIcon('document')}</span>
                  <span class="wa-bubble-doc-name">${escapeHtml(fileLabel)}</span>
                </a>${captionHtml}`;
        } else if (!captionHtml && type === 'template') {
            // Body-less template row (historical bulk send stored only the
            // template name, not the rendered text). Show the template
            // instead of a bare "(empty)" so the slot is meaningful.
            const tname = humanizeTemplate(m.templateName);
            mediaInner = `<span class="wa-bubble-caption" style="opacity:.85;font-style:italic;">📄 ${escapeHtml(tname)}</span>`;
        } else {
            // Plain text fallback. Empty bodies show a placeholder so the
            // user can still see the message slot exists (rare for inbound,
            // common for accidental empty optimistic sends).
            mediaInner = captionHtml || `<span class="wa-bubble-caption" style="opacity:.6;"><em>(empty)</em></span>`;
        }

        return `
            <div class="${baseRowCls}" data-msg-id="${escapeAttr(m.id || '')}" data-msg-sender="${escapeAttr(rowSender)}" data-msg-time="${escapeAttr(rowTime)}">
              <div class="wa-bubble${bubbleExtra}">
                ${senderHtml}
                ${forwardedHtml}
                ${replyHtml}
                ${mediaInner}
                ${meta}
              </div>
            </div>`;
    }

    // ── Video frame (poster + play overlay + duration badge) ───────────────
    // Layout matches WA Web: a `<video preload=metadata muted>` provides the
    // first-frame poster (browsers paint frame 0 once metadata loads), with
    // a centered play button and bottom-left duration badge layered on top.
    // The whole frame is a click target — the embedded JS file's lightbox
    // delegator (see openMediaLightbox + wireMediaClicks below) opens the
    // full-screen viewer when any of these tiles is clicked.
    function renderVideoFrame(url) {
        const safe = escapeAttr(url);
        return `
            <span class="wa-video-frame" data-media-kind="video" data-media-src="${safe}">
              <video src="${safe}" preload="metadata" muted playsinline></video>
              <span class="wa-video-duration" data-video-duration><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>0:00</span></span>
              <button type="button" class="wa-video-play" tabindex="-1" aria-label="Play">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </button>
            </span>`;
    }

    // ── Album grid (multiple media in one bubble) ──────────────────────────
    function renderAlbum(items) {
        const n = items.length;
        const cls = n === 2 ? 'count-2' : n === 3 ? 'count-3' : (n === 4 ? 'count-4' : 'count-many');
        const visible = n > 4 ? items.slice(0, 4) : items;
        const overflow = n > 4 ? n - 4 : 0;
        const tilesHtml = visible.map((it, idx) => {
            const isVideo = (it.messageType || '').toLowerCase() === 'video';
            const safe = escapeAttr(it.mediaUrl || '');
            const inner = isVideo
                ? `<video src="${safe}" preload="metadata" muted playsinline></video>
                   <span class="wa-video-duration" data-video-duration><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>0:00</span></span>
                   <button type="button" class="wa-video-play" tabindex="-1" aria-label="Play">
                     <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                   </button>`
                : `<img src="${safe}" alt="" loading="lazy">`;
            const overlay = (overflow > 0 && idx === visible.length - 1)
                ? `<span class="wa-album-overflow">+${overflow}</span>`
                : '';
            return `<span class="wa-album-tile" data-media-kind="${isVideo ? 'video' : 'image'}" data-media-src="${safe}" data-album-index="${idx}">${inner}${overlay}</span>`;
        }).join('');
        return `<div class="wa-album ${cls}">${tilesHtml}</div>`;
    }

    // ── Wire media clicks → open lightbox + read video durations ───────────
    // Call this once on page load. It uses event delegation so it works for
    // any future bubbles rendered into the page.
    //
    // `opts.context` is an optional callback `(row) => { sender, timestamp }`
    //   that maps a `.wa-msg-row` element to header metadata. Inboxes that
    //   know the customer name (from the thread header) should pass this so
    //   the lightbox header reads "Vasu Vastu Test · 12:39 PM" instead of
    //   nothing.
    // `opts.onReply` — invoked when the user clicks Reply in the lightbox.
    //   Receives `{kind, url, row}` and should close the lightbox itself.
    function wireMediaClicks(rootSelector, opts) {
        opts = opts || {};
        const root = (typeof rootSelector === 'string') ? document.querySelector(rootSelector) : (rootSelector || document.body);
        if (!root || root._waMediaWired) return;
        root._waMediaWired = true;

        root.addEventListener('click', e => {
            // Find the nearest media-bearing element that should open lightbox.
            const target = e.target.closest('[data-media-kind][data-media-src]');
            if (!target) return;
            // Walk up to the bubble row so we can read sender + time from it.
            const row = target.closest('.wa-msg-row');
            const ctx = (typeof opts.context === 'function' && row) ? opts.context(row) : {};
            // If this tile is part of an album, collect siblings for nav.
            const albumParent = target.closest('.wa-album');
            let group;
            if (albumParent) {
                group = Array.from(albumParent.querySelectorAll('[data-media-src]'))
                    .map(el => ({ kind: el.dataset.mediaKind, url: el.dataset.mediaSrc }));
            } else {
                group = [{ kind: target.dataset.mediaKind, url: target.dataset.mediaSrc }];
            }
            const startIdx = group.findIndex(g => g.url === target.dataset.mediaSrc);
            openMediaLightbox(group, Math.max(0, startIdx), {
                senderName: ctx.senderName,
                timestamp: ctx.timestamp,
                allMedia: ctx.allMedia,
                // Pass the host's onReply through verbatim — the lightbox
                // calls it with { text, replyTo } when the user submits.
                // Wrapping it here would clobber that payload.
                onReply: opts.onReply || null,
            });
            e.preventDefault();
            e.stopPropagation();
        });

        // Read video durations as metadata loads (for both single and album
        // tiles). The badge SVG and span sit inside `[data-video-duration]`.
        root.addEventListener('loadedmetadata', e => {
            const v = e.target;
            if (!(v instanceof HTMLVideoElement)) return;
            const wrap = v.parentElement;
            if (!wrap) return;
            const badge = wrap.querySelector('[data-video-duration] span');
            if (!badge) return;
            const sec = Math.round(v.duration || 0);
            badge.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        }, true);   // capture so we catch them as they fire
    }

    // ── Lightbox (full-screen media viewer, WA-Web style) ──────────────────
    // opts shape:
    //   { senderName, timestamp, allMedia: [{kind,url}], onReply, onDownload }
    // The footer's thumb strip uses `allMedia` if provided (full thread),
    // otherwise falls back to the `items` array passed in (album group).
    let _lightbox = null;
    function openMediaLightbox(items, startIdx, opts) {
        if (!items || !items.length) return;
        opts = opts || {};
        closeMediaLightbox();
        let idx = Math.max(0, Math.min(startIdx || 0, items.length - 1));
        const stripItems = (opts.allMedia && opts.allMedia.length) ? opts.allMedia : items;

        const lb = document.createElement('div');
        lb.className = 'wa-lightbox';
        // Defensive inline style — some host pages have global CSS that wins
        // over our `.wa-lightbox { position: fixed }` rule (we've seen this
        // with the emoji picker too). Setting it inline guarantees the
        // overlay covers the viewport regardless of cascade.
        lb.style.cssText = 'position:fixed;inset:0;z-index:1000000;';

        const senderInitial = (opts.senderName || '?').trim().charAt(0).toUpperCase() || '?';
        const senderColor_ = senderColor(opts.senderName || '');
        const tsText = opts.timestamp ? formatLightboxTimestamp(opts.timestamp) : '';

        lb.innerHTML = `
          <header class="wa-lightbox-header">
            <div class="wa-avatar" style="background:${senderColor_};">${escapeHtml(senderInitial)}</div>
            <div class="wa-lightbox-sender">
              <div class="wa-lightbox-sender-name">${escapeHtml(opts.senderName || 'Media')}</div>
              <div class="wa-lightbox-sender-time">${escapeHtml(tsText)}</div>
            </div>
            <div class="wa-lightbox-actions">
              <button type="button" class="wa-lightbox-action" data-act="download" title="Download">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button type="button" class="wa-lightbox-action" data-act="forward" title="Forward">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
              </button>
              <button type="button" class="wa-lightbox-action" data-act="star" title="Star">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              <button type="button" class="wa-lightbox-action" data-act="delete" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
              </button>
              <button type="button" class="wa-lightbox-action" data-act="more" title="More">
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
              </button>
            </div>
          </header>
          <div class="wa-lightbox-stage">
            ${items.length > 1 ? `
              <button type="button" class="wa-lightbox-nav prev" aria-label="Previous">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button type="button" class="wa-lightbox-nav next" aria-label="Next">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>` : ''}
          </div>
          <footer class="wa-lightbox-footer">
            <button type="button" class="wa-lightbox-allmedia" data-act="allmedia">All media</button>
            <div class="wa-lightbox-thumbstrip">
              ${stripItems.map((it, i) => `
                <button type="button" class="wa-lightbox-thumb" data-thumb-idx="${i}">
                  ${it.kind === 'video'
                    ? `<video src="${escapeAttr(it.url)}" muted preload="metadata"></video>
                       <svg class="wa-lightbox-thumb-video-badge" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
                    : `<img src="${escapeAttr(it.url)}" alt="">`}
                </button>`).join('')}
            </div>
            <div class="wa-lightbox-actions-right">
              ${opts.onReply ? `<button type="button" class="wa-lightbox-btn" data-act="reply">Reply</button>` : ''}
              <button type="button" class="wa-lightbox-btn primary" data-act="done">Done</button>
            </div>
            <div class="wa-lightbox-replybar"></div>
          </footer>
        `;

        document.body.appendChild(lb);
        _lightbox = lb;

        const stage = lb.querySelector('.wa-lightbox-stage');

        function paint() {
            const it = items[idx];
            // Strip any existing media nodes; keep nav arrows.
            stage.querySelectorAll('img, video').forEach(n => n.remove());
            const media = it.kind === 'video'
                ? Object.assign(document.createElement('video'), { src: it.url, controls: true, autoplay: true, playsInline: true })
                : Object.assign(document.createElement('img'), { src: it.url, alt: '' });
            stage.insertBefore(media, stage.firstChild);
            // Highlight active thumb
            lb.querySelectorAll('.wa-lightbox-thumb').forEach((t, i) => {
                const url = stripItems[i] && stripItems[i].url;
                t.classList.toggle('is-active', url === it.url);
            });
        }
        function step(delta) { idx = (idx + delta + items.length) % items.length; paint(); }

        paint();

        // Build the reply-bar lazily when first invoked.
        function showReplyBar() {
            const bar = lb.querySelector('.wa-lightbox-replybar');
            if (!bar) return;
            const cur = items[idx];
            const kindLabel = cur.kind === 'video' ? 'Video' : 'Photo';
            const kindIcon = cur.kind === 'video'
                ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4V6.5l-4 4z"/></svg>`
                : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 4l-1.5 2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5L15 4H9zm3 4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"/></svg>`;
            const thumbHtml = cur.kind === 'video'
                ? `<video src="${escapeAttr(cur.url)}" muted preload="metadata"></video>`
                : `<img src="${escapeAttr(cur.url)}" alt="">`;
            bar.innerHTML = `
                <div class="wa-lightbox-quote">
                  <div class="wa-lightbox-quote-thumb">${thumbHtml}</div>
                  <div class="wa-lightbox-quote-meta">
                    <span class="wa-lightbox-quote-name">${escapeHtml(opts.senderName || 'Media')}</span>
                    <span class="wa-lightbox-quote-kind">${kindIcon}${kindLabel}</span>
                  </div>
                  <button type="button" class="wa-lightbox-quote-close" data-replybar="cancel" title="Cancel reply" aria-label="Cancel reply">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <form>
                  <input type="text" placeholder="Type a reply" autocomplete="off" />
                  <button type="button" class="wa-lightbox-replybar-icon" data-replybar="emoji" title="Emoji">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                  </button>
                  <button type="submit" class="wa-lightbox-replybar-icon wa-lightbox-replybar-send" title="Send">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/></svg>
                  </button>
                </form>`;
            lb.classList.add('is-replying');
            const input = bar.querySelector('input[type=text]');
            const form  = bar.querySelector('form');
            const emojiBtn = bar.querySelector('[data-replybar="emoji"]');
            input.focus();
            form.addEventListener('submit', ev => {
                ev.preventDefault();
                const text = (input.value || '').trim();
                if (!text) return;
                try {
                    opts.onReply && opts.onReply({
                        text,
                        replyTo: { kind: cur.kind, url: cur.url, senderName: opts.senderName, kindLabel }
                    });
                } catch (err) { console.warn('[wa-ui] reply submit threw:', err); }
                closeMediaLightbox();
            });
            // Wire the emoji picker in the replybar to use the SAME picker
            // module the inbox uses, so shortcuts/recents are shared.
            if (emojiBtn && window.WhatsappUI && window.WhatsappUI.EmojiPicker) {
                emojiBtn.addEventListener('click', ev => {
                    ev.preventDefault();
                    window.WhatsappUI.EmojiPicker.open(emojiBtn, emoji => {
                        const start = input.selectionStart ?? input.value.length;
                        const end   = input.selectionEnd   ?? input.value.length;
                        input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
                        const caret = start + emoji.length;
                        input.focus();
                        input.setSelectionRange(caret, caret);
                    });
                });
            }
            // Cancel reply (× on the quote chip) — drops the reply bar but
            // keeps the lightbox open. Escape does the same when the input
            // is focused (handled in the global onKey below).
            const cancelBtn = bar.querySelector('[data-replybar="cancel"]');
            if (cancelBtn) cancelBtn.addEventListener('click', ev => {
                ev.preventDefault();
                hideReplyBar();
            });
        }

        function hideReplyBar() {
            const bar = lb.querySelector('.wa-lightbox-replybar');
            if (bar) bar.innerHTML = '';
            lb.classList.remove('is-replying');
        }

        // Event wiring
        lb.addEventListener('click', e => {
            const actBtn = e.target.closest('[data-act]');
            if (actBtn) {
                const act = actBtn.dataset.act;
                if (act === 'done')      { closeMediaLightbox(); }
                else if (act === 'reply'){
                    // Open the in-lightbox reply bar instead of closing.
                    showReplyBar();
                }
                else if (act === 'download') { triggerDownload(items[idx].url); }
                else if (act === 'forward'  ) { /* TODO: forward */ }
                else if (act === 'star'     ) { /* TODO: star    */ }
                else if (act === 'delete'   ) { /* TODO: delete  */ }
                else if (act === 'more'     ) { /* TODO: menu    */ }
                else if (act === 'allmedia' ) { /* TODO: All media drawer */ }
                e.stopPropagation();
                return;
            }
            const thumb = e.target.closest('.wa-lightbox-thumb');
            if (thumb) {
                const tIdx = Number(thumb.dataset.thumbIdx);
                // Find the equivalent in `items` (the active group). If not
                // present, swap items to allMedia subset.
                const url = stripItems[tIdx] && stripItems[tIdx].url;
                const inItems = items.findIndex(it => it.url === url);
                if (inItems >= 0) { idx = inItems; paint(); }
                else { items = stripItems.slice(); idx = tIdx; paint(); }
                e.stopPropagation();
                return;
            }
            // Click on the dim background closes.
            if (e.target === lb || e.target === stage) closeMediaLightbox();
        });

        const prev = lb.querySelector('.wa-lightbox-nav.prev');
        const next = lb.querySelector('.wa-lightbox-nav.next');
        if (prev) prev.addEventListener('click', e => { e.stopPropagation(); step(-1); });
        if (next) next.addEventListener('click', e => { e.stopPropagation(); step(+1); });

        const onKey = e => {
            if (e.key === 'Escape') {
                // First Esc exits reply mode if active; second Esc closes.
                if (lb.classList.contains('is-replying')) hideReplyBar();
                else closeMediaLightbox();
            }
            else if (e.key === 'ArrowLeft' && items.length > 1 && !lb.classList.contains('is-replying')) step(-1);
            else if (e.key === 'ArrowRight' && items.length > 1 && !lb.classList.contains('is-replying')) step(+1);
        };
        document.addEventListener('keydown', onKey, true);
        lb._cleanup = () => document.removeEventListener('keydown', onKey, true);
    }

    function formatLightboxTimestamp(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        // "12/05/26, 12:39 PM" — matches WA Web's lightbox header.
        const dd = pad(d.getDate());
        const mm = pad(d.getMonth() + 1);
        const yy = String(d.getFullYear()).slice(-2);
        let h = d.getHours();
        const m = pad(d.getMinutes());
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${dd}/${mm}/${yy}, ${h}:${m} ${ampm}`;
    }

    function triggerDownload(url) {
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = '';   // hint to download rather than navigate
            a.target = '_blank';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e) { window.open(url, '_blank'); }
    }
    function closeMediaLightbox() {
        if (!_lightbox) return;
        try { _lightbox._cleanup && _lightbox._cleanup(); } catch {}
        _lightbox.remove();
        _lightbox = null;
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

    // ── Mobile back-handler ─────────────────────────────────────────────────
    // When `.wa-app.has-active-thread` is set on mobile, the user expects
    // hardware-back / browser-back / the in-page back arrow to all collapse
    // back to the conversation list (NOT navigate the browser away). This
    // helper wires all three.
    //
    // Caller passes the .wa-app element and an `onBack` callback that
    // should clear `has-active-thread` and reset its own state.
    function installMobileBackHandler(opts) {
        const app = opts.app;
        const onBack = opts.onBack;
        if (!app || typeof onBack !== 'function') return;

        // 1. In-page back arrow click — caller's existing wiring still
        //    works, but we proxy it through onBack for consistency.
        const back = app.querySelector('.wa-thread-back');
        if (back) back.addEventListener('click', () => onBack());

        // 2. Escape key (laptop / external keyboard).
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && app.classList.contains('has-active-thread')) {
                onBack();
            }
        });

        // 3. Browser/hardware back. Push a sentinel state when a thread
        //    opens; on popstate, if our sentinel is gone, treat it as back.
        // We do NOT patch History globally — only when our pane opens.
        const observer = new MutationObserver(() => {
            const open = app.classList.contains('has-active-thread');
            if (open && history.state?.waThread !== true) {
                history.pushState({ waThread: true }, '');
            }
        });
        observer.observe(app, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('popstate', () => {
            if (app.classList.contains('has-active-thread')) onBack();
        });
    }

    // ── Album collapsing — merge runs of media messages into one bubble ────
    // Collapses consecutive image/video messages from the same sender, sent
    // within `windowSec` of each other, into a single message with an
    // `album` array. The original messages are returned with `_collapsed:
    // true` for any non-leader entry, and the leader (first) gets the album.
    // Callers should drop entries with `_collapsed: true` from rendering.
    function collapseAlbums(messages, windowSec) {
        if (!messages || messages.length === 0) return [];
        const win = (windowSec || 60) * 1000;
        const out = [];
        let leader = null;
        for (const m of messages) {
            const t = (m.messageType || 'text').toLowerCase();
            const isMedia = (t === 'image' || t === 'video') && !!m.mediaUrl;
            const ts = m.timestamp || m.receivedAtUtc || m.sentAtUtc || m.createdAtUtc;
            const tsMs = ts ? new Date(ts).getTime() : 0;
            if (
                isMedia
                && leader
                && leader.direction === m.direction
                && (leader.senderId || '') === (m.senderId || '')
                && tsMs - leader._tsMs < win
            ) {
                // Append to current leader's album.
                leader.album.push({ messageType: t, mediaUrl: m.mediaUrl, fileName: m.fileName });
                // Carry the latest body / status / timestamp forward — WA shows
                // a single timestamp on the album, taken from the LAST message.
                leader.status = m.status || leader.status;
                leader._tsMs = tsMs;
                leader.timestamp = ts;
                // First non-empty caption wins (WA only shows one caption per album).
                if (!leader.body && m.body) leader.body = m.body;
                out.push(Object.assign({}, m, { _collapsed: true }));
            } else if (isMedia) {
                // Start a new album leader.
                leader = Object.assign({}, m, {
                    album: [{ messageType: t, mediaUrl: m.mediaUrl, fileName: m.fileName }],
                    _tsMs: tsMs,
                });
                out.push(leader);
            } else {
                // Non-media message — close any open album.
                leader = null;
                out.push(m);
            }
        }
        return out;
    }

    // ── Row kebab menu (Convert to Lead / Open Lead / Assign Team) ─────────
    // Host page calls `WhatsappUI.RowMenu.open(anchorBtn, items)` with an
    // array of `{ label, icon, onClick, disabled? }`. The menu auto-closes
    // on outside-click or Escape. Items are rendered in order; pass `null`
    // anywhere in the array to draw a divider.
    let _rowMenu = null;
    function openRowMenu(anchor, items) {
        closeRowMenu();
        const m = document.createElement('div');
        m.className = 'wa-rowmenu';
        m.style.cssText = 'position:fixed;z-index:1000001;';
        m.innerHTML = items.map((it, i) => {
            if (it === null) return '<hr/>';
            const iconHtml = it.icon ? `<span class="wa-rowmenu-icon">${it.icon}</span>` : '';
            return `<button type="button" data-idx="${i}"${it.disabled ? ' disabled' : ''}>${iconHtml}<span>${escapeHtml(it.label)}</span></button>`;
        }).join('');
        document.body.appendChild(m);

        // Position below the anchor, right-aligned to it. Flip up if no room.
        const rect = anchor.getBoundingClientRect();
        const mh = m.offsetHeight, mw = m.offsetWidth;
        const vh = document.documentElement.clientHeight;
        const vw = document.documentElement.clientWidth;
        let top = rect.bottom + 4;
        if (top + mh > vh - 8) top = Math.max(8, rect.top - mh - 4);
        let left = rect.right - mw;
        if (left < 8) left = 8;
        if (left + mw > vw - 8) left = vw - mw - 8;
        m.style.top = top + 'px';
        m.style.left = left + 'px';

        anchor.classList.add('is-open');
        _rowMenu = { el: m, anchor };

        m.addEventListener('click', e => {
            const btn = e.target.closest('button[data-idx]');
            if (!btn) return;
            const idx = Number(btn.dataset.idx);
            const it = items[idx];
            closeRowMenu();
            if (it && typeof it.onClick === 'function') {
                try { it.onClick(); } catch (err) { console.warn('[wa-ui] menu action threw:', err); }
            }
        });

        const onOutside = ev => {
            if (!_rowMenu) return;
            if (m.contains(ev.target) || anchor.contains(ev.target)) return;
            closeRowMenu();
        };
        const onEsc = ev => { if (ev.key === 'Escape') closeRowMenu(); };
        document.addEventListener('mousedown', onOutside, true);
        document.addEventListener('keydown', onEsc, true);
        m._cleanup = () => {
            document.removeEventListener('mousedown', onOutside, true);
            document.removeEventListener('keydown', onEsc, true);
        };
    }
    function closeRowMenu() {
        if (!_rowMenu) return;
        try { _rowMenu.el._cleanup && _rowMenu.el._cleanup(); } catch {}
        _rowMenu.anchor?.classList.remove('is-open');
        _rowMenu.el.remove();
        _rowMenu = null;
    }

    // ── Team picker modal ──────────────────────────────────────────────────
    // Standalone overlay listing teams; calls `onPick(teamId, teamName)`.
    // Caller fetches the team list (with member counts etc.) and passes it
    // in — keeps this module independent of any specific REST endpoint.
    function openTeamPicker(opts) {
        opts = opts || {};
        closeTeamPicker();
        const teams = opts.teams || [];
        const overlay = document.createElement('div');
        overlay.className = 'wa-teampicker-overlay';
        // Defensive inline style — same cascade quirk that caused our
        // lightbox + emoji picker to render at `position: relative` on
        // some host pages. Forcing fixed inline beats any cascade.
        overlay.style.cssText = 'position:fixed;inset:0;z-index:1000002;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
        overlay.innerHTML = `
            <div class="wa-teampicker">
              <div class="wa-teampicker-header">
                <h3>${escapeHtml(opts.title || 'Pick a team')}</h3>
                <button type="button" class="wa-teampicker-close" aria-label="Close">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div class="wa-teampicker-body">
                ${teams.length === 0
                    ? `<div class="wa-teampicker-empty">No teams yet. Create one in Settings → Teams.</div>`
                    : teams.map(t => `
                      <button type="button" class="wa-teampicker-team" data-team-id="${escapeAttr(t.id)}" data-team-name="${escapeAttr(t.name)}">
                        <span class="wa-teampicker-team-name">${escapeHtml(t.name)}</span>
                        <span class="wa-teampicker-team-meta">${escapeHtml(t.meta || '')}</span>
                      </button>`).join('')}
              </div>
            </div>`;
        document.body.appendChild(overlay);
        _teamPicker = overlay;

        overlay.addEventListener('click', e => {
            const team = e.target.closest('.wa-teampicker-team');
            if (team) {
                const id = team.dataset.teamId;
                const name = team.dataset.teamName;
                closeTeamPicker();
                if (opts.onPick) opts.onPick(id, name);
                return;
            }
            if (e.target.closest('.wa-teampicker-close') || e.target === overlay) {
                closeTeamPicker();
            }
        });
        const onEsc = ev => { if (ev.key === 'Escape') closeTeamPicker(); };
        document.addEventListener('keydown', onEsc, true);
        overlay._cleanup = () => document.removeEventListener('keydown', onEsc, true);
    }
    let _teamPicker = null;
    function closeTeamPicker() {
        if (!_teamPicker) return;
        try { _teamPicker._cleanup && _teamPicker._cleanup(); } catch {}
        _teamPicker.remove();
        _teamPicker = null;
    }

    // ── Public API ──────────────────────────────────────────────────────────
    window.WhatsappUI = {
        renderConversationRow,
        renderBubble,
        renderDatePill,
        renderUnreadPill,
        renderAvatar,
        groupMessages,
        collapseAlbums,
        wireMediaClicks,
        openMediaLightbox,
        closeMediaLightbox,
        senderColor,
        tickSvg,
        formatTime,
        formatRelative,
        dateLabel,
        escapeHtml,
        escapeAttr,
        linkify,
        installMobileBackHandler,
        RowMenu: { open: openRowMenu, close: closeRowMenu },
        TeamPicker: { open: openTeamPicker, close: closeTeamPicker },
    };
})(window);
