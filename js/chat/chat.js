// ============================================
// Chat Module - Main JavaScript
// ============================================

// Global State
let currentConversationId = null;
let conversations = [];
let archivedConversations = [];
let currentMessages = [];
let selectedUsers = [];
let conversationType = 'direct';
let signalRConnection = null;
let typingTimeout = null;
let currentUser = null;
let showingArchived = false;
let pendingFileAttachment = null; // Stores file info while uploading/pending send
let hasMoreMessages = false;
let oldestMessageId = null;
let isLoadingMore = false;
const INITIAL_MESSAGE_LIMIT = 15;

// Video Call from Chat
const MEETING_CARD_PREFIX = '::meeting_card::';

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Auth check
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Get current user
    currentUser = api.getUser();
    if (!currentUser) {
        window.location.href = '../login.html';
        return;
    }

    // Initialize UI
    initializeUserUI();

    // Load conversations
    await loadConversations();

    // Connect to SignalR
    await connectSignalR();

    // Auto-select conversation from URL parameter (e.g., from push notification click)
    const urlParams = new URLSearchParams(window.location.search);
    const conversationParam = urlParams.get('conversation');
    if (conversationParam) {
        await selectConversation(conversationParam);
        // Clean up URL without reloading
        window.history.replaceState({}, '', window.location.pathname);
    }

    // Handle responsive back button
    handleResponsive();

    // Fix iOS keyboard viewport shift
    setupIOSKeyboardFix();
});

function initializeUserUI() {
    // Navigation is now handled by Navigation.init() in navigation.js
    // Dynamically measure navbar height and set CSS custom property
    // so chat container positions correctly on all devices
    adjustChatForNavbar();
    window.addEventListener('resize', adjustChatForNavbar);
}

function adjustChatForNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    // If navbar is hidden (display:none), height is 0 — chat gets full screen
    const navbarHeight = navbar.offsetHeight;
    document.documentElement.style.setProperty('--chat-navbar-height', navbarHeight + 'px');
}

// ============================================
// SignalR Connection
// ============================================

async function connectSignalR() {
    try {
        const hubUrl = CONFIG.chatSignalRHubUrl || `${CONFIG.endpoints.chat}/hubs/chat`;

        signalRConnection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl, {
                accessTokenFactory: () => getAuthToken(),
                // Allow fallback to Long Polling when WebSocket is killed (iOS PWA)
                transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling
            })
            .withAutomaticReconnect([0, 1000, 2000, 5000, 5000, 10000, 10000, 30000])
            .configureLogging(signalR.LogLevel.Warning)
            .build();

        // Lower timeouts so dead connections are detected faster (defaults: 30s/15s)
        signalRConnection.serverTimeoutInMilliseconds = 15000;
        signalRConnection.keepAliveIntervalInMilliseconds = 5000;

        // Event handlers
        signalRConnection.on('MessageReceived', handleMessageReceived);
        signalRConnection.on('MessageEdited', handleMessageEdited);
        signalRConnection.on('MessageDeleted', handleMessageDeleted);
        signalRConnection.on('UserTyping', handleUserTyping);
        signalRConnection.on('UserStatusChanged', handleUserStatusChanged);
        signalRConnection.on('ConversationUpdated', handleConversationUpdated);
        signalRConnection.on('ParticipantAdded', handleParticipantAdded);
        signalRConnection.on('ParticipantRemoved', handleParticipantRemoved);
        signalRConnection.on('ReadReceipt', handleReadReceipt);

        signalRConnection.onreconnecting(() => {
            console.log('SignalR reconnecting...');
            showToast('Reconnecting...', 'info');
        });

        signalRConnection.onreconnected(async () => {
            console.log('SignalR reconnected');
            showToast('Connected', 'success');
            hideDisconnectedBanner();
            await loadConversations();
            // Rejoin the active conversation group so messages are delivered
            if (currentConversationId) {
                try {
                    await signalRConnection.invoke('JoinConversation', currentConversationId);
                    console.log('Rejoined conversation group:', currentConversationId);
                    // Reload messages to catch any missed while disconnected
                    await loadMessages(currentConversationId);
                } catch (err) {
                    console.error('Error rejoining conversation after reconnect:', err);
                }
            }
        });

        signalRConnection.onclose(async () => {
            console.log('SignalR connection closed');
            showDisconnectedBanner();
            // Attempt manual reconnect quickly (auto-reconnect already exhausted)
            setTimeout(() => {
                if (!signalRConnection || signalRConnection.state === signalR.HubConnectionState.Disconnected) {
                    console.log('Attempting manual SignalR reconnect...');
                    reconnectSignalR();
                }
            }, 1000);
        });

        await signalRConnection.start();
        console.log('SignalR connected');

    } catch (error) {
        console.error('SignalR connection error:', error);
        showToast('Chat connection failed', 'error');
    }
}

// ============================================
// SignalR Event Handlers
// ============================================

function handleMessageReceived(event) {
    const { message, conversation_id } = event;

    // Update conversation list
    updateConversationPreview(conversation_id, message);

    // If this conversation is open, add the message
    if (currentConversationId === conversation_id) {
        appendMessage(message);
        markAsRead(conversation_id, message.id);
    } else {
        // Increment unread count
        incrementUnreadCount(conversation_id);
    }
}

function handleMessageEdited(event) {
    const { message_id, conversation_id, new_content, edited_at } = event;

    if (currentConversationId === conversation_id) {
        const messageEl = document.querySelector(`[data-message-id="${message_id}"]`);
        if (messageEl) {
            const bubbleEl = messageEl.querySelector('.message-bubble');
            if (bubbleEl) {
                bubbleEl.textContent = new_content;
                // Add edited indicator if not present
                if (!messageEl.querySelector('.edited-indicator')) {
                    const editedSpan = document.createElement('span');
                    editedSpan.className = 'edited-indicator';
                    editedSpan.textContent = ' (edited)';
                    editedSpan.style.fontSize = '11px';
                    editedSpan.style.opacity = '0.7';
                    bubbleEl.appendChild(editedSpan);
                }
            }
        }
    }
}

function handleMessageDeleted(event) {
    const { message_id, conversation_id } = event;

    if (currentConversationId === conversation_id) {
        const messageEl = document.querySelector(`[data-message-id="${message_id}"]`);
        if (messageEl) {
            messageEl.remove();
        }
    }
}

function handleUserTyping(event) {
    const { conversation_id, user_id, user_name, is_typing } = event;

    if (currentConversationId === conversation_id && user_id !== currentUser.userId) {
        const indicator = document.getElementById('typingIndicator');
        const typingText = document.getElementById('typingText');

        if (is_typing) {
            typingText.textContent = `${user_name} is typing...`;
            indicator.style.display = 'flex';
        } else {
            indicator.style.display = 'none';
        }
    }
}

function handleUserStatusChanged(event) {
    const { user_id, status } = event;
    // Update UI for user status changes
    updateUserStatusUI(user_id, status);
}

function handleConversationUpdated(event) {
    loadConversations();
}

function handleParticipantAdded(event) {
    if (currentConversationId === event.conversation_id) {
        loadConversationDetails(currentConversationId);
    }
}

function handleParticipantRemoved(event) {
    const { conversation_id, user_id } = event;

    if (user_id === currentUser.userId) {
        // Current user was removed
        if (currentConversationId === conversation_id) {
            currentConversationId = null;
            showEmptyState();
        }
        loadConversations();
    } else if (currentConversationId === conversation_id) {
        loadConversationDetails(currentConversationId);
    }
}

function handleReadReceipt(event) {
    // Update read receipt UI if needed
}

// ============================================
// Conversations
// ============================================

async function loadConversations() {
    try {
        const response = await api.getConversations();
        conversations = response.conversations || [];
        renderConversations(conversations);
    } catch (error) {
        console.error('Error loading conversations:', error);
        showToast('Failed to load conversations', 'error');
    }
}

function renderConversations(convos) {
    const container = document.getElementById('conversationsList');

    if (!convos || convos.length === 0) {
        container.innerHTML = `
            <div class="text-secondary" style="text-align: center; padding: 40px 20px;">
                <p>${showingArchived ? 'No archived conversations' : 'No conversations yet'}</p>
                <p style="font-size: 13px;">${showingArchived ? 'Archived chats will appear here' : 'Start a new chat to begin messaging'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = convos.map(conv => {
        const isGroup = conv.conversation_type === 'group';
        const displayName = isGroup ? conv.group_name : getOtherParticipantName(conv);
        const initials = getInitials(displayName);
        let preview = conv.last_message?.content || 'No messages yet';
        if (conv.last_message?.message_type === 'file') {
            preview = conv.last_message.file_name || 'Sent a file';
        } else if (preview.startsWith(MEETING_CARD_PREFIX)) {
            preview = '';
        }
        const time = conv.last_message ? formatTime(conv.last_message.created_at) : '';
        const unread = conv.unread_count || 0;

        // Presence status for direct chats
        let statusAttr = '';
        if (!isGroup) {
            const otherUser = conv.participants?.find(p => p.user_id !== currentUser.userId);
            const status = otherUser?.user_status?.toLowerCase() || 'offline';
            statusAttr = ` data-status="${status}"`;
        }

        return `
            <div class="conversation-item ${currentConversationId === conv.id ? 'active' : ''}"
                 onclick="selectConversation('${conv.id}')"
                 data-conversation-id="${conv.id}">
                <div class="conversation-avatar ${isGroup ? 'group' : ''}"${statusAttr}>
                    ${initials}
                </div>
                <div class="conversation-info">
                    <div class="conversation-name">${escapeHtml(displayName)}</div>
                    <div class="conversation-preview">${escapeHtml(truncate(preview, 40))}</div>
                </div>
                <div class="conversation-meta">
                    ${time ? `<span class="conversation-time">${time}</span>` : ''}
                    ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
                </div>
                <button class="conversation-menu-btn" onclick="event.stopPropagation(); toggleConversationMenu('${conv.id}')" title="More options">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="5" r="1"/>
                        <circle cx="12" cy="12" r="1"/>
                        <circle cx="12" cy="19" r="1"/>
                    </svg>
                </button>
                <div class="conversation-menu" id="convMenu-${conv.id}">
                    ${showingArchived ? `
                        <button class="conversation-menu-item" onclick="event.stopPropagation(); unarchiveChat('${conv.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 9 3 4 9 4"/>
                                <path d="M3 4L14 15"/>
                                <path d="M21 3v7h-7"/>
                            </svg>
                            Unarchive
                        </button>
                    ` : `
                        <button class="conversation-menu-item" onclick="event.stopPropagation(); archiveChat('${conv.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="21 8 21 21 3 21 3 8"/>
                                <rect x="1" y="3" width="22" height="5"/>
                                <line x1="10" y1="12" x2="14" y2="12"/>
                            </svg>
                            Archive
                        </button>
                    `}
                    <button class="conversation-menu-item danger" onclick="event.stopPropagation(); deleteChat('${conv.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-2 14H7L5 6"/>
                            <path d="M10 11v6"/>
                            <path d="M14 11v6"/>
                            <path d="M9 6V4h6v2"/>
                        </svg>
                        Delete
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function filterConversations(query) {
    if (!query.trim()) {
        renderConversations(conversations);
        return;
    }

    const filtered = conversations.filter(conv => {
        const name = conv.conversation_type === 'group'
            ? conv.group_name
            : getOtherParticipantName(conv);
        return name.toLowerCase().includes(query.toLowerCase());
    });

    renderConversations(filtered);
}

async function selectConversation(conversationId) {
    currentConversationId = conversationId;

    // Update active state in list
    document.querySelectorAll('.conversation-item').forEach(el => {
        el.classList.toggle('active', el.dataset.conversationId === conversationId);
    });

    // Show chat area
    document.getElementById('chatEmptyState').style.display = 'none';
    document.getElementById('chatActive').style.display = 'flex';

    // Ensure we're in the SignalR group for this conversation
    if (signalRConnection && signalRConnection.state === signalR.HubConnectionState.Connected) {
        signalRConnection.invoke('JoinConversation', conversationId).catch(err => {
            console.error('Error joining conversation group:', err);
        });
    }

    // Load conversation details and messages
    await loadConversationDetails(conversationId);
    await loadMessages(conversationId);

    // Mark as read
    const conv = conversations.find(c => c.id === conversationId);
    if (conv && conv.last_message) {
        markAsRead(conversationId, conv.last_message.id);
    }

    // Handle mobile view — hide sidebar and navbar to maximize chat space
    if (window.innerWidth <= 768) {
        document.getElementById('chatSidebar').classList.add('hidden');
        document.querySelector('.back-btn').style.display = 'block';
        const navbar = document.querySelector('.navbar');
        if (navbar) navbar.style.display = 'none';
        adjustChatForNavbar();
    }

    // Focus input
    document.getElementById('messageInput').focus();
}

async function loadConversationDetails(conversationId) {
    try {
        // Fetch full conversation details including participants
        const fullConv = await api.getConversation(conversationId);
        if (!fullConv) return;

        // Update the cached conversation with full details
        const convIndex = conversations.findIndex(c => c.id === conversationId);
        if (convIndex !== -1) {
            conversations[convIndex] = { ...conversations[convIndex], ...fullConv };
        }

        const conv = fullConv;
        const isGroup = conv.conversation_type === 'group';
        const displayName = isGroup ? conv.group_name : getOtherParticipantName(conv);
        const initials = getInitials(displayName);

        document.getElementById('chatHeaderAvatar').textContent = initials;
        document.getElementById('chatHeaderAvatar').className = `chat-header-avatar ${isGroup ? 'group' : ''}`;
        document.getElementById('chatHeaderName').textContent = displayName;

        if (isGroup) {
            const memberCount = conv.participants?.length || 0;
            document.getElementById('chatHeaderStatus').innerHTML = `${memberCount} members`;
        } else {
            const otherUser = conv.participants?.find(p => p.user_id !== currentUser.userId);
            const status = otherUser?.user_status || 'Offline';
            const statusClass = status.toLowerCase() === 'online' ? 'online' : status.toLowerCase() === 'away' ? 'away' : '';
            document.getElementById('chatHeaderStatus').innerHTML = `<span class="status-dot ${statusClass}"></span>${escapeHtml(status)}`;
        }
    } catch (error) {
        console.error('Error loading conversation details:', error);
    }
}

async function loadMessages(conversationId, beforeMessageId = null) {
    try {
        const limit = beforeMessageId ? 20 : INITIAL_MESSAGE_LIMIT;
        const response = await api.getMessages(conversationId, beforeMessageId, limit);
        const messages = response.messages || [];
        hasMoreMessages = response.has_more || false;
        oldestMessageId = response.oldest_message_id || null;

        if (!beforeMessageId) {
            currentMessages = messages;
            renderMessages(messages);
            setupScrollPagination();
        } else {
            currentMessages = [...messages, ...currentMessages];
            prependMessages(messages);
        }
    } catch (error) {
        console.error('Error loading messages:', error);
        showToast('Failed to load messages', 'error');
    }
}

function renderMessages(messages) {
    const container = document.getElementById('chatMessages');

    if (!messages || messages.length === 0) {
        container.innerHTML = `
            <div class="text-muted" style="text-align: center; padding: 40px;">
                <p>No messages yet</p>
                <p style="font-size: 13px;">Send a message to start the conversation</p>
            </div>
        `;
        return;
    }

    container.innerHTML = messages.map(msg => renderMessage(msg)).join('');
    scrollToBottom();
}

function renderMessage(msg) {
    const isOwn = msg.sender_id === currentUser.userId;
    const senderName = msg.sender_name || msg.sender_email || 'Unknown';
    const initials = getInitials(senderName);
    const time = formatTime(msg.created_at);

    if (msg.message_type === 'system') {
        return `
            <div class="system-message">
                <span>${escapeHtml(msg.content)}</span>
            </div>
        `;
    }

    // Detect meeting card messages
    if (msg.content && msg.content.startsWith(MEETING_CARD_PREFIX)) {
        try {
            const cardJson = msg.content.substring(MEETING_CARD_PREFIX.length);
            const cardData = JSON.parse(cardJson);
            return renderMeetingCard(msg, cardData, isOwn, senderName, time);
        } catch (e) {
            // Parse failed — fall through to normal text rendering
        }
    }

    // Render file attachment if present
    let fileHtml = '';
    if (msg.message_type === 'file' && msg.file_s3_key) {
        const fileName = msg.file_name || 'Attachment';
        const fileSize = formatFileSize(msg.file_size || 0);
        const fileIcon = getFileIcon(msg.file_content_type);
        const isImage = msg.file_content_type?.startsWith('image/');

        // If it's an image and has a valid URL, show image preview
        // Otherwise, show as a downloadable file attachment
        const showAsImage = isImage && msg.file_download_url;

        fileHtml = `
            <div class="message-file-attachment" data-s3-key="${escapeHtml(msg.file_s3_key)}">
                ${showAsImage ? `
                    <div class="message-image-preview" onclick="openFilePreview('${escapeHtml(msg.file_s3_key)}', '${escapeHtml(fileName)}', true)">
                        <img src="${msg.file_download_url}" alt="${escapeHtml(fileName)}"
                             onerror="this.onerror=null; this.parentElement.innerHTML='<div class=image-load-error>Click to view image</div>';"
                             onload="scrollToBottom()">
                    </div>
                ` : `
                    <div class="message-file" onclick="downloadFile('${escapeHtml(msg.file_s3_key)}', '${escapeHtml(fileName)}')">
                        <span class="file-icon">${fileIcon}</span>
                        <div class="file-info">
                            <span class="file-name">${escapeHtml(fileName)}</span>
                            <span class="file-size">${fileSize}</span>
                        </div>
                        <svg class="download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </div>
                `}
            </div>
        `;
    }

    // Render text content if present
    let textHtml = '';
    if (msg.content && msg.content.trim()) {
        textHtml = `
            <div class="message-bubble">
                ${escapeHtml(msg.content)}
                ${msg.is_edited ? '<span class="edited-indicator" style="font-size: 11px; opacity: 0.7;"> (edited)</span>' : ''}
            </div>
        `;
    }

    return `
        <div class="message ${isOwn ? 'own' : ''}" data-message-id="${msg.id}">
            <div class="message-avatar">${initials}</div>
            <div class="message-content">
                <span class="message-sender">${escapeHtml(senderName)}</span>
                ${fileHtml}
                ${textHtml}
                <span class="message-time">${time}</span>
            </div>
        </div>
    `;
}

function appendMessage(msg) {
    const container = document.getElementById('chatMessages');

    // Remove empty state if present
    const emptyState = container.querySelector('div[style*="text-align: center"]');
    if (emptyState) {
        emptyState.remove();
    }

    container.insertAdjacentHTML('beforeend', renderMessage(msg));
    scrollToBottom();
}

function prependMessages(messages) {
    const container = document.getElementById('chatMessages');
    const prevScrollHeight = container.scrollHeight;
    const html = messages.map(msg => renderMessage(msg)).join('');
    container.insertAdjacentHTML('afterbegin', html);
    // Maintain scroll position after prepending
    container.scrollTop = container.scrollHeight - prevScrollHeight;
}

function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
}

function setupScrollPagination() {
    const container = document.getElementById('chatMessages');
    // Remove previous listener by replacing element trick (avoids duplicate listeners)
    container.removeEventListener('scroll', handleMessagesScroll);
    container.addEventListener('scroll', handleMessagesScroll);
}

async function handleMessagesScroll() {
    const container = document.getElementById('chatMessages');
    if (container.scrollTop < 100 && hasMoreMessages && !isLoadingMore && oldestMessageId) {
        isLoadingMore = true;
        try {
            await loadMessages(currentConversationId, oldestMessageId);
        } finally {
            isLoadingMore = false;
        }
    }
}

// ============================================
// Send Message
// ============================================

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    // Must have either content or file attachment
    if (!content && !pendingFileAttachment) return;
    if (!currentConversationId) return;
    if (!signalRConnection || signalRConnection.state !== signalR.HubConnectionState.Connected) {
        showToast('Not connected to chat server', 'error');
        return;
    }

    try {
        input.value = '';
        autoResizeTextarea(input);

        if (pendingFileAttachment) {
            // Send file message via SignalR
            const messageType = 'file';
            const { s3_key, file_name, file_size, content_type } = pendingFileAttachment;

            await signalRConnection.invoke('SendMessage',
                currentConversationId,
                content || null,      // Optional text content with file
                messageType,
                s3_key,
                file_name,
                file_size,
                content_type,
                null                  // reply_to_message_id
            );

            // Clear file attachment
            removeFileAttachment();
        } else {
            // Send text message via SignalR
            await signalRConnection.invoke('SendMessage', currentConversationId, content, 'text', null, null, null, null, null);
        }

        // Message will be added via SignalR MessageReceived event
    } catch (error) {
        console.error('Error sending message:', error);
        showToast('Failed to send message', 'error');
        input.value = content; // Restore message
    }
}

function handleMessageKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

function handleTyping() {
    if (!currentConversationId || !signalRConnection) return;

    // Clear previous timeout
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }

    // Send start typing indicator
    signalRConnection.invoke('StartTyping', currentConversationId).catch(err => {
        console.error('Error sending typing indicator:', err);
    });

    // Stop typing after 3 seconds of inactivity
    typingTimeout = setTimeout(() => {
        signalRConnection.invoke('StopTyping', currentConversationId).catch(err => {
            console.error('Error sending typing indicator:', err);
        });
    }, 3000);
}

// ============================================
// New Chat Modal
// ============================================

function showNewChatModal() {
    const el = document.getElementById('newChatModal');
    if (!el) return;
    el.classList.add('gm-animating');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('active'));
    });
    selectedUsers = [];
    conversationType = 'direct';
    document.getElementById('userSearch').value = '';
    document.getElementById('groupName').value = '';
    document.getElementById('selectedUsers').innerHTML = '';
    document.getElementById('userSearchResults').classList.remove('show');
    updateConversationTypeUI();
}

function closeNewChatModal() {
    const el = document.getElementById('newChatModal');
    if (!el) return;
    el.classList.remove('active');
    setTimeout(() => el.classList.remove('gm-animating'), 200);
}

function setConversationType(type) {
    conversationType = type;
    updateConversationTypeUI();
}

function updateConversationTypeUI() {
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === conversationType);
    });

    const groupNameField = document.getElementById('groupNameField');
    const userSearchLabel = document.getElementById('userSearchLabel');

    if (conversationType === 'group') {
        groupNameField.style.display = 'block';
        userSearchLabel.textContent = 'Add Members';
    } else {
        groupNameField.style.display = 'none';
        userSearchLabel.textContent = 'Search User';
        // Clear extra users for direct chat
        if (selectedUsers.length > 1) {
            selectedUsers = [selectedUsers[0]];
            renderSelectedUsers();
        }
    }
}

let searchTimeout = null;

async function searchUsers(query) {
    if (!query || query.length < 2) {
        document.getElementById('userSearchResults').classList.remove('show');
        return;
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            const response = await api.searchChatUsers(query);
            // Handle both array and object response formats
            const users = Array.isArray(response) ? response : (response.users || response.data || []);
            console.log('Search results for:', query, users);
            renderUserSearchResults(users);
        } catch (error) {
            console.error('Error searching users:', error);
            renderUserSearchResults([]);
        }
    }, 300);
}

function renderUserSearchResults(users) {
    const container = document.getElementById('userSearchResults');

    // Filter out already selected users and current user
    const filtered = users.filter(u =>
        u.user_id !== currentUser.userId &&
        !selectedUsers.some(s => s.user_id === u.user_id)
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-secondary" style="padding: 16px; text-align: center;">No users found</div>';
    } else {
        container.innerHTML = filtered.map(user => {
            const displayName = user.display_name || user.email;
            const initials = getInitials(displayName);
            return `
                <div class="user-search-item" onclick="selectUser('${user.user_id}', '${escapeHtml(displayName)}', '${escapeHtml(user.email)}')">
                    <div class="user-search-item-avatar">${initials}</div>
                    <div class="user-search-item-info">
                        <div class="user-search-item-name">${escapeHtml(displayName)}</div>
                        <div class="user-search-item-email">${escapeHtml(user.email)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    container.classList.add('show');
}

function selectUser(userId, displayName, email) {
    // For direct chat, only allow one user
    if (conversationType === 'direct') {
        selectedUsers = [{ user_id: userId, display_name: displayName, email: email }];
    } else {
        // For group, allow multiple
        if (!selectedUsers.some(u => u.user_id === userId)) {
            selectedUsers.push({ user_id: userId, display_name: displayName, email: email });
        }
    }

    renderSelectedUsers();
    document.getElementById('userSearch').value = '';
    document.getElementById('userSearchResults').classList.remove('show');
}

function renderSelectedUsers() {
    const container = document.getElementById('selectedUsers');
    container.innerHTML = selectedUsers.map(user => `
        <div class="selected-user-chip">
            <span>${escapeHtml(user.display_name)}</span>
            <button onclick="removeSelectedUser('${user.user_id}')">&times;</button>
        </div>
    `).join('');
}

function removeSelectedUser(userId) {
    selectedUsers = selectedUsers.filter(u => u.user_id !== userId);
    renderSelectedUsers();
}

async function createConversation() {
    if (selectedUsers.length === 0) {
        showToast('Please select at least one user', 'error');
        return;
    }

    // Prevent self-chat
    if (conversationType === 'direct' && selectedUsers[0].user_id === currentUser.userId) {
        showToast('You cannot start a conversation with yourself', 'error');
        return;
    }

    try {
        let response;

        if (conversationType === 'direct') {
            response = await api.createDirectConversation(selectedUsers[0].user_id);
        } else {
            const groupName = document.getElementById('groupName').value.trim();
            if (!groupName) {
                showToast('Please enter a group name', 'error');
                return;
            }
            response = await api.createGroupConversation(groupName, null, selectedUsers.map(u => u.user_id));
        }

        closeNewChatModal();
        await loadConversations();

        // Select the new conversation
        if (response && response.id) {
            selectConversation(response.id);
        }

        showToast('Conversation created', 'success');
    } catch (error) {
        console.error('Error creating conversation:', error);
        showToast(error.message || 'Failed to create conversation', 'error');
    }
}

// ============================================
// Archive/Delete Functions
// ============================================

function toggleConversationMenu(conversationId) {
    // Close all other menus first
    document.querySelectorAll('.conversation-menu.show').forEach(menu => {
        if (menu.id !== `convMenu-${conversationId}`) {
            menu.classList.remove('show');
        }
    });

    const menu = document.getElementById(`convMenu-${conversationId}`);
    if (menu) {
        menu.classList.toggle('show');
    }
}

// Close conversation menus when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.conversation-menu-btn') && !e.target.closest('.conversation-menu')) {
        document.querySelectorAll('.conversation-menu.show').forEach(menu => {
            menu.classList.remove('show');
        });
    }
});

async function archiveChat(conversationId) {
    try {
        await api.archiveConversation(conversationId);

        // Remove from current list
        conversations = conversations.filter(c => c.id !== conversationId);

        // Clear current conversation if it was archived
        if (currentConversationId === conversationId) {
            currentConversationId = null;
            showEmptyState();
        }

        renderConversations(conversations);
        showToast('Conversation archived', 'success');
    } catch (error) {
        console.error('Error archiving conversation:', error);
        showToast('Failed to archive conversation', 'error');
    }
}

async function unarchiveChat(conversationId) {
    try {
        await api.unarchiveConversation(conversationId);

        // Remove from archived list
        archivedConversations = archivedConversations.filter(c => c.id !== conversationId);

        // Clear current conversation if it was unarchived
        if (currentConversationId === conversationId) {
            currentConversationId = null;
            showEmptyState();
        }

        renderConversations(archivedConversations);
        showToast('Conversation restored', 'success');
    } catch (error) {
        console.error('Error unarchiving conversation:', error);
        showToast('Failed to restore conversation', 'error');
    }
}

async function deleteChat(conversationId) {
    const confirmed = await Confirm.show({
        title: 'Delete Conversation',
        message: 'Are you sure you want to delete this conversation? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });

    if (!confirmed) {
        return;
    }

    try {
        await api.deleteConversationForUser(conversationId);

        // Remove from current list
        if (showingArchived) {
            archivedConversations = archivedConversations.filter(c => c.id !== conversationId);
            renderConversations(archivedConversations);
        } else {
            conversations = conversations.filter(c => c.id !== conversationId);
            renderConversations(conversations);
        }

        // Clear current conversation if it was deleted
        if (currentConversationId === conversationId) {
            currentConversationId = null;
            showEmptyState();
        }

        showToast('Conversation deleted', 'success');
    } catch (error) {
        console.error('Error deleting conversation:', error);
        showToast('Failed to delete conversation', 'error');
    }
}

async function loadArchivedConversations() {
    try {
        const response = await api.getArchivedConversations();
        archivedConversations = response.conversations || [];
        showingArchived = true;
        updateSidebarHeader();
        renderConversations(archivedConversations);
    } catch (error) {
        console.error('Error loading archived conversations:', error);
        showToast('Failed to load archived conversations', 'error');
    }
}

async function showActiveConversations() {
    showingArchived = false;
    updateSidebarHeader();
    // Reload conversations to include any recently unarchived ones
    await loadConversations();
}

function updateSidebarHeader() {
    const headerTitle = document.querySelector('.chat-sidebar-header h2');
    if (headerTitle) {
        headerTitle.textContent = showingArchived ? 'Archived' : 'Messages';
    }

    // Update the new chat button to toggle between archived/active
    const newChatBtn = document.querySelector('.new-chat-btn');
    if (newChatBtn) {
        if (showingArchived) {
            newChatBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
            `;
            newChatBtn.setAttribute('onclick', 'showActiveConversations()');
            newChatBtn.setAttribute('title', 'Back to Messages');
        } else {
            newChatBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            `;
            newChatBtn.setAttribute('onclick', 'showNewChatModal()');
            newChatBtn.setAttribute('title', 'New Chat');
        }
    }
}

// ============================================
// Chat Info Modal
// ============================================

function showChatInfo() {
    if (!currentConversationId) return;

    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;

    const isGroup = conv.conversation_type === 'group';
    const content = document.getElementById('chatInfoContent');
    const leaveBtn = document.getElementById('leaveConversationBtn');

    if (isGroup) {
        content.innerHTML = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div class="chat-header-avatar group" style="width: 80px; height: 80px; font-size: 28px; margin: 0 auto 16px;">
                    ${getInitials(conv.group_name)}
                </div>
                <h3 style="margin: 0 0 4px;">${escapeHtml(conv.group_name)}</h3>
                <p class="text-secondary" style="margin: 0;">${conv.participants?.length || 0} members</p>
            </div>
            <div style="margin-bottom: 16px;">
                <h4 class="text-secondary" style="font-size: 14px; margin-bottom: 12px;">Members</h4>
                ${(conv.participants || []).map(p => `
                    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 0;">
                        <div class="conversation-avatar" style="width: 36px; height: 36px; min-width: 36px; font-size: 13px;">
                            ${getInitials(p.user_name || p.user_email)}
                        </div>
                        <div>
                            <div style="font-weight: 500;">${escapeHtml(p.user_name || p.user_email)}</div>
                            ${p.role === 'admin' ? '<span class="text-secondary" style="font-size: 11px;">Admin</span>' : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        leaveBtn.style.display = 'block';
        leaveBtn.closest('.chat-modal-footer').style.display = '';
    } else {
        const otherUser = conv.participants?.find(p => p.user_id !== currentUser.userId);
        content.innerHTML = `
            <div style="text-align: center;">
                <div class="chat-header-avatar" style="width: 80px; height: 80px; font-size: 28px; margin: 0 auto 16px;">
                    ${getInitials(otherUser?.user_name || otherUser?.user_email)}
                </div>
                <h3 style="margin: 0 0 4px;">${escapeHtml(otherUser?.user_name || otherUser?.user_email || 'Unknown')}</h3>
                <p class="text-secondary" style="margin: 0;">${otherUser?.user_email || ''}</p>
            </div>
        `;
        leaveBtn.style.display = 'none';
        leaveBtn.closest('.chat-modal-footer').style.display = 'none';
    }

    const infoEl = document.getElementById('chatInfoModal');
    if (infoEl) {
        infoEl.classList.add('gm-animating');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => infoEl.classList.add('active'));
        });
    }
}

function closeChatInfoModal() {
    const el = document.getElementById('chatInfoModal');
    if (!el) return;
    el.classList.remove('active');
    setTimeout(() => el.classList.remove('gm-animating'), 200);
}

async function leaveConversation() {
    if (!currentConversationId) return;

    const confirmed = await Confirm.show({
        title: 'Leave Conversation',
        message: 'Are you sure you want to leave this conversation?',
        type: 'warning',
        confirmText: 'Leave',
        cancelText: 'Cancel'
    });

    if (!confirmed) {
        return;
    }

    try {
        await api.leaveConversation(currentConversationId);
        closeChatInfoModal();
        currentConversationId = null;
        showEmptyState();
        await loadConversations();
        showToast('Left conversation', 'success');
    } catch (error) {
        console.error('Error leaving conversation:', error);
        showToast('Failed to leave conversation', 'error');
    }
}

// ============================================
// Utilities
// ============================================

function showEmptyState() {
    document.getElementById('chatEmptyState').style.display = 'flex';
    document.getElementById('chatActive').style.display = 'none';
}

function getOtherParticipantName(conversation) {
    if (!conversation.participants) return 'Unknown';
    const other = conversation.participants.find(p => p.user_id !== currentUser.userId);
    return other?.user_name || other?.user_email || 'Unknown';
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    // Today
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    }

    // Within a week
    if (diff < 7 * 24 * 60 * 60 * 1000) {
        return date.toLocaleDateString([], { weekday: 'short' });
    }

    // Older
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function truncate(str, length) {
    if (!str) return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function updateConversationPreview(conversationId, message) {
    const conv = conversations.find(c => c.id === conversationId);
    if (conv) {
        conv.last_message = message;
        conv.updated_at = message.created_at;

        // Re-sort and render
        conversations.sort((a, b) => {
            const aTime = a.last_message?.created_at || a.created_at;
            const bTime = b.last_message?.created_at || b.created_at;
            return new Date(bTime) - new Date(aTime);
        });

        renderConversations(conversations);
    }
}

function incrementUnreadCount(conversationId) {
    const conv = conversations.find(c => c.id === conversationId);
    if (conv) {
        conv.unread_count = (conv.unread_count || 0) + 1;
        renderConversations(conversations);
    }
}

async function markAsRead(conversationId, messageId) {
    try {
        await api.markAsRead(conversationId, messageId);
        const conv = conversations.find(c => c.id === conversationId);
        if (conv) {
            conv.unread_count = 0;
            renderConversations(conversations);
        }
    } catch (error) {
        console.error('Error marking as read:', error);
    }
}

function updateUserStatusUI(userId, status) {
    // Update status indicators in UI
    conversations.forEach(conv => {
        if (conv.participants) {
            const participant = conv.participants.find(p => p.user_id === userId);
            if (participant) {
                participant.user_status = status;
            }
        }
    });

    // Re-render conversation list to update presence dots
    renderConversations(showingArchived ? archivedConversations : conversations);

    // Update header if current conversation
    if (currentConversationId) {
        const conv = conversations.find(c => c.id === currentConversationId);
        if (conv && conv.conversation_type === 'direct') {
            const other = conv.participants?.find(p => p.user_id === userId);
            if (other) {
                const statusClass = status.toLowerCase() === 'online' ? 'online' : status.toLowerCase() === 'away' ? 'away' : '';
                document.getElementById('chatHeaderStatus').innerHTML = `<span class="status-dot ${statusClass}"></span>${escapeHtml(status)}`;
            }
        }
    }
}

// ============================================
// SignalR Reconnection & Visibility Handling
// ============================================

async function reconnectSignalR() {
    if (signalRConnection && signalRConnection.state !== signalR.HubConnectionState.Disconnected) {
        return; // Already connected or connecting
    }

    try {
        console.log('Reconnecting SignalR...');
        showToast('Reconnecting...', 'info');
        await signalRConnection.start();
        console.log('SignalR manually reconnected');
        showToast('Connected', 'success');
        hideDisconnectedBanner();

        // Reload conversations and rejoin active group
        await loadConversations();
        if (currentConversationId) {
            try {
                await signalRConnection.invoke('JoinConversation', currentConversationId);
                await loadMessages(currentConversationId);
                await loadConversationDetails(currentConversationId);
            } catch (err) {
                console.error('Error rejoining after manual reconnect:', err);
            }
        }
    } catch (error) {
        console.error('Manual reconnect failed:', error);
        setTimeout(() => reconnectSignalR(), 5000);
    }
}

function showDisconnectedBanner() {
    let banner = document.getElementById('chatDisconnectedBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'chatDisconnectedBanner';
        banner.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;background:var(--color-error,#ef4444);color:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
        banner.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#fff;opacity:0.7;animation:pulse 1.5s infinite;"></span> Disconnected — trying to reconnect...';
        document.body.appendChild(banner);
    }
    banner.style.display = 'flex';
}

function hideDisconnectedBanner() {
    const banner = document.getElementById('chatDisconnectedBanner');
    if (banner) banner.style.display = 'none';
}

// Handle mobile browser tab backgrounding / foregrounding
// iOS Safari aggressively kills WebSocket connections when PWA is backgrounded.
// The connection state may still report "Connected" even though the socket is dead.
// We must actively probe the connection to detect this.
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;

    console.log('[Chat] Page became visible — checking SignalR state');

    if (!signalRConnection) return;

    const state = signalRConnection.state;
    if (state === signalR.HubConnectionState.Disconnected) {
        await reconnectSignalR();
        return;
    }

    if (state === signalR.HubConnectionState.Connected) {
        // Probe the connection — if the socket is dead this will fail fast
        try {
            await Promise.race([
                signalRConnection.invoke('Ping'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 3000))
            ]);
            // Connection is alive — just refresh data we may have missed
            await loadConversations();
            if (currentConversationId) {
                await signalRConnection.invoke('JoinConversation', currentConversationId);
                await loadMessages(currentConversationId);
                await loadConversationDetails(currentConversationId);
            }
        } catch (err) {
            console.warn('[Chat] Connection appears dead after background, forcing reconnect:', err.message);
            // Stop the dead connection and reconnect
            try { await signalRConnection.stop(); } catch (_) {}
            await reconnectSignalR();
        }
    }
    // If Connecting or Reconnecting, let the built-in handlers deal with it
});

// ============================================
// Responsive Handling
// ============================================

function handleResponsive() {
    const backBtn = document.querySelector('.back-btn');
    if (window.innerWidth <= 768) {
        if (backBtn) backBtn.style.display = currentConversationId ? 'block' : 'none';
    } else {
        if (backBtn) backBtn.style.display = 'none';
        document.getElementById('chatSidebar').classList.remove('hidden');
    }
}

function goBackToList() {
    document.getElementById('chatSidebar').classList.remove('hidden');
    document.querySelector('.back-btn').style.display = 'none';
    currentConversationId = null;
    document.querySelectorAll('.conversation-item').forEach(el => el.classList.remove('active'));
    // Restore navbar on conversation list view
    if (window.innerWidth <= 768) {
        const navbar = document.querySelector('.navbar');
        if (navbar) navbar.style.display = '';
        adjustChatForNavbar();
    }
}

window.addEventListener('resize', handleResponsive);

// ============================================
// iOS Keyboard Viewport Fix
// ============================================
// iOS Safari/PWA shifts the page up when the virtual keyboard opens.
// When the keyboard closes, it doesn't always restore scroll position,
// leaving the UI clipped at the top (navbar hidden).

function setupIOSKeyboardFix() {
    // Add class to html element for CSS targeting on mobile
    if (window.innerWidth <= 768) {
        document.documentElement.classList.add('chat-page-html');
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (!isIOS) return;

    function resetScroll() {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
    }

    // When any input/textarea loses focus (keyboard closing), reset scroll
    document.addEventListener('focusout', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            // Multiple resets at different timings to catch iOS animation
            resetScroll();
            setTimeout(resetScroll, 50);
            setTimeout(resetScroll, 150);
            setTimeout(resetScroll, 300);
        }
    });

    // Catch any scroll on the window itself and force it back
    window.addEventListener('scroll', () => {
        if (window.scrollY !== 0 || window.scrollX !== 0) {
            resetScroll();
        }
    });

    // Use visualViewport API to detect keyboard dismiss
    if (window.visualViewport) {
        let lastHeight = window.visualViewport.height;
        window.visualViewport.addEventListener('resize', () => {
            const currentHeight = window.visualViewport.height;
            // Keyboard closing = viewport getting larger
            if (currentHeight > lastHeight) {
                resetScroll();
                setTimeout(resetScroll, 100);
                setTimeout(resetScroll, 300);
            }
            lastHeight = currentHeight;
        });
    }
}

// Local showToast removed - using unified toast.js instead

// ============================================
// Video Call from Chat
// ============================================

async function startVideoCall() {
    if (!currentConversationId) {
        showToast('Select a conversation first', 'error');
        return;
    }

    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv || !conv.participants || conv.participants.length === 0) {
        showToast('Conversation not loaded yet', 'error');
        return;
    }

    if (!signalRConnection || signalRConnection.state !== signalR.HubConnectionState.Connected) {
        showToast('Not connected to chat server', 'error');
        return;
    }

    const btn = document.getElementById('startVideoCallBtn');
    if (!btn || btn.classList.contains('loading')) return;

    btn.classList.add('loading');
    btn.disabled = true;

    try {
        // Call Chat backend to create meeting via Vision gRPC
        const result = await api.request(`/chat/conversations/${currentConversationId}/video-call`, {
            method: 'POST'
        });

        if (!result.success || !result.meeting_id) {
            throw new Error(result.error || 'Failed to create video call');
        }

        // Build full join link and send meeting card via SignalR
        const meetingLink = `${window.location.origin}${result.meeting_link}`;

        const cardData = {
            meetingId: result.meeting_id,
            meetingName: result.meeting_name,
            meetingLink: meetingLink,
            createdByName: currentUser.firstName
                ? `${currentUser.firstName} ${currentUser.lastName || ''}`.trim()
                : currentUser.email
        };

        const messageContent = MEETING_CARD_PREFIX + JSON.stringify(cardData);
        await signalRConnection.invoke('SendMessage', currentConversationId, messageContent, 'text', null, null, null, null, null);

    } catch (error) {
        console.error('Error starting video call:', error);
        if (error.status === 403) {
            showToast('You don\'t have access to video calls', 'error');
        } else {
            showToast('Failed to start video call', 'error');
        }
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}

function renderMeetingCard(msg, cardData, isOwn, senderName, time) {
    const initials = getInitials(senderName);
    const meetingLink = escapeHtml(cardData.meetingLink || '#');
    const meetingName = escapeHtml(cardData.meetingName || 'Video Call');
    const createdBy = escapeHtml(cardData.createdByName || senderName);

    return `
        <div class="message meeting-card-message ${isOwn ? 'own' : ''}" data-message-id="${msg.id}">
            <div class="message-avatar">${initials}</div>
            <div class="message-content">
                <span class="message-sender">${escapeHtml(senderName)}</span>
                <a href="${meetingLink}" target="_blank" rel="noopener noreferrer" class="meeting-card">
                    <div class="meeting-card-banner">
                        <img src="/assets/og-vision.png" alt="Ragenaizer Video Call" class="meeting-card-banner-img">
                    </div>
                    <div class="meeting-card-join-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                            <polygon points="23 7 16 12 23 17 23 7"/>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                        </svg>
                        Join Meeting
                    </div>
                </a>
                <span class="message-time">${time}</span>
            </div>
        </div>
    `;
}

// ============================================
// File Attachment Handling
// ============================================

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

function triggerFileInput() {
    if (!currentConversationId) {
        showToast('Select a conversation first', 'error');
        return;
    }
    document.getElementById('fileInput').click();
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset input for re-selection
    event.target.value = '';

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
        showToast('File size exceeds 100MB limit', 'error');
        return;
    }

    // Show preview
    showFilePreview(file);

    // Upload file
    await uploadFile(file);
}

function showFilePreview(file) {
    const preview = document.getElementById('fileUploadPreview');
    const nameEl = document.getElementById('filePreviewName');
    const sizeEl = document.getElementById('filePreviewSize');

    nameEl.textContent = file.name;
    sizeEl.textContent = formatFileSize(file.size);
    preview.style.display = 'block';
}

async function uploadFile(file) {
    const progressContainer = document.getElementById('fileUploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');

    try {
        progressContainer.style.display = 'flex';
        progressFill.style.width = '0%';
        progressText.textContent = 'Uploading...';

        // Upload via API
        const result = await api.uploadChatFile(currentConversationId, file, (percent) => {
            progressFill.style.width = `${percent}%`;
            progressText.textContent = `Uploading... ${percent}%`;
        });

        if (result.success) {
            progressFill.style.width = '100%';
            progressText.textContent = 'Ready to send';

            // Store file info and auto-send
            pendingFileAttachment = {
                s3_key: result.s3_key,
                file_name: result.file_name,
                file_size: result.file_size,
                content_type: result.content_type,
                download_url: result.download_url
            };

            // Auto-send file message after successful upload
            progressContainer.style.display = 'none';
            await sendMessage();
            return;
        } else {
            showToast(`Upload failed: ${result.error || 'Unknown error'}`, 'error');
            removeFileAttachment();
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        showToast('Failed to upload file', 'error');
        removeFileAttachment();
    } finally {
        progressContainer.style.display = 'none';
    }
}

function removeFileAttachment() {
    pendingFileAttachment = null;
    document.getElementById('fileUploadPreview').style.display = 'none';
    document.getElementById('fileInput').value = '';
}

async function downloadFile(s3Key, fileName) {
    try {
        showToast('Getting download link...', 'info');

        const result = await api.getChatFileDownloadUrl(currentConversationId, s3Key);
        if (result.success && result.url) {
            // Open in new tab or trigger download
            const link = document.createElement('a');
            link.href = result.url;
            link.download = fileName;
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            showToast('Failed to get download URL', 'error');
        }
    } catch (error) {
        console.error('Error downloading file:', error);
        showToast('Failed to download file', 'error');
    }
}

async function openFilePreview(s3Key, fileName, isImage) {
    try {
        const result = await api.getChatFileDownloadUrl(currentConversationId, s3Key);
        if (result.success && result.url) {
            window.open(result.url, '_blank');
        } else {
            showToast('Failed to get file URL', 'error');
        }
    } catch (error) {
        console.error('Error opening file preview:', error);
        showToast('Failed to open file', 'error');
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(contentType) {
    // Return SVG icons instead of emojis for consistent cross-platform display
    const defaultIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
    </svg>`;

    if (!contentType) return defaultIcon;

    if (contentType.startsWith('image/')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg>`;
    }
    if (contentType.startsWith('video/')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>`;
    }
    if (contentType.startsWith('audio/')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
        </svg>`;
    }
    if (contentType.includes('pdf')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>`;
    }
    if (contentType.includes('word') || contentType.includes('document')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <line x1="10" y1="9" x2="8" y2="9"/>
        </svg>`;
    }
    if (contentType.includes('sheet') || contentType.includes('excel')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="8" y1="13" x2="16" y2="13"/>
            <line x1="8" y1="17" x2="16" y2="17"/>
            <line x1="12" y1="9" x2="12" y2="21"/>
        </svg>`;
    }
    if (contentType.includes('zip') || contentType.includes('archive') || contentType.includes('compressed')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>`;
    }

    return defaultIcon;
}

// ============================================
// User Dropdown - handled by navigation.js
// ============================================

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    const searchResults = document.getElementById('userSearchResults');
    const searchInput = document.getElementById('userSearch');
    if (searchResults && searchInput && !searchResults.contains(e.target) && !searchInput.contains(e.target)) {
        searchResults.classList.remove('show');
    }
});

// ============================================
// Drag & Drop File Upload
// ============================================

(function initDragDrop() {
    const chatMain = document.getElementById('chatMain');
    const overlay = document.getElementById('chatDragOverlay');
    if (!chatMain || !overlay) return;

    let dragCounter = 0;

    chatMain.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        if (currentConversationId) {
            overlay.classList.add('active');
        }
    });

    chatMain.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            overlay.classList.remove('active');
        }
    });

    chatMain.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    chatMain.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        overlay.classList.remove('active');

        if (!currentConversationId) {
            showToast('Select a conversation first', 'error');
            return;
        }

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.size > MAX_FILE_SIZE) {
                showToast('File size exceeds 100MB limit', 'error');
                return;
            }
            showFilePreview(file);
            uploadFile(file);
        }
    });
})();
