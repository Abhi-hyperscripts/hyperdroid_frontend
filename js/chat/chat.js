// ============================================
// Chat Module - Main JavaScript
// ============================================

// Global State
let currentConversationId = null;
let conversations = [];
let currentMessages = [];
let selectedUsers = [];
let conversationType = 'direct';
let signalRConnection = null;
let typingTimeout = null;
let currentUser = null;

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

    // Handle responsive back button
    handleResponsive();
});

function initializeUserUI() {
    const initials = `${currentUser.firstName?.[0] || ''}${currentUser.lastName?.[0] || ''}`.toUpperCase() || 'U';
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('userDropdownName').textContent = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email;
}

// ============================================
// SignalR Connection
// ============================================

async function connectSignalR() {
    try {
        const hubUrl = CONFIG.chatSignalRHubUrl || `${CONFIG.endpoints.chat}/hubs/chat`;

        signalRConnection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl, {
                accessTokenFactory: () => localStorage.getItem('authToken')
            })
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
            .configureLogging(signalR.LogLevel.Warning)
            .build();

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

        signalRConnection.onreconnected(() => {
            console.log('SignalR reconnected');
            showToast('Connected', 'success');
            loadConversations();
        });

        signalRConnection.onclose(() => {
            console.log('SignalR disconnected');
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

    if (currentConversationId === conversation_id && user_id !== currentUser.id) {
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

    if (user_id === currentUser.id) {
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
            <div style="text-align: center; padding: 40px 20px; color: #666;">
                <p>No conversations yet</p>
                <p style="font-size: 13px;">Start a new chat to begin messaging</p>
            </div>
        `;
        return;
    }

    container.innerHTML = convos.map(conv => {
        const isGroup = conv.conversation_type === 'group';
        const displayName = isGroup ? conv.group_name : getOtherParticipantName(conv);
        const initials = getInitials(displayName);
        const preview = conv.last_message?.content || 'No messages yet';
        const time = conv.last_message ? formatTime(conv.last_message.created_at) : '';
        const unread = conv.unread_count || 0;

        return `
            <div class="conversation-item ${currentConversationId === conv.id ? 'active' : ''}"
                 onclick="selectConversation('${conv.id}')"
                 data-conversation-id="${conv.id}">
                <div class="conversation-avatar ${isGroup ? 'group' : ''}">
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

    // Load conversation details and messages
    await loadConversationDetails(conversationId);
    await loadMessages(conversationId);

    // Mark as read
    const conv = conversations.find(c => c.id === conversationId);
    if (conv && conv.last_message) {
        markAsRead(conversationId, conv.last_message.id);
    }

    // Handle mobile view
    if (window.innerWidth <= 768) {
        document.getElementById('chatSidebar').classList.add('hidden');
        document.querySelector('.back-btn').style.display = 'block';
    }

    // Focus input
    document.getElementById('messageInput').focus();
}

async function loadConversationDetails(conversationId) {
    try {
        const conv = conversations.find(c => c.id === conversationId);
        if (!conv) return;

        const isGroup = conv.conversation_type === 'group';
        const displayName = isGroup ? conv.group_name : getOtherParticipantName(conv);
        const initials = getInitials(displayName);

        document.getElementById('chatHeaderAvatar').textContent = initials;
        document.getElementById('chatHeaderAvatar').className = `chat-header-avatar ${isGroup ? 'group' : ''}`;
        document.getElementById('chatHeaderName').textContent = displayName;

        if (isGroup) {
            const memberCount = conv.participants?.length || 0;
            document.getElementById('chatHeaderStatus').textContent = `${memberCount} members`;
        } else {
            const otherUser = conv.participants?.find(p => p.user_id !== currentUser.id);
            document.getElementById('chatHeaderStatus').textContent = otherUser?.user_status || 'Offline';
        }
    } catch (error) {
        console.error('Error loading conversation details:', error);
    }
}

async function loadMessages(conversationId, beforeMessageId = null) {
    try {
        const response = await api.getMessages(conversationId, beforeMessageId);
        const messages = response.messages || [];

        if (!beforeMessageId) {
            currentMessages = messages;
            renderMessages(messages);
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
            <div style="text-align: center; padding: 40px; color: #999;">
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
    const isOwn = msg.sender_id === currentUser.id;
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

    return `
        <div class="message ${isOwn ? 'own' : ''}" data-message-id="${msg.id}">
            <div class="message-avatar">${initials}</div>
            <div class="message-content">
                <span class="message-sender">${escapeHtml(senderName)}</span>
                <div class="message-bubble">
                    ${escapeHtml(msg.content)}
                    ${msg.is_edited ? '<span class="edited-indicator" style="font-size: 11px; opacity: 0.7;"> (edited)</span>' : ''}
                </div>
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
    const html = messages.map(msg => renderMessage(msg)).join('');
    container.insertAdjacentHTML('afterbegin', html);
}

function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
}

// ============================================
// Send Message
// ============================================

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (!content || !currentConversationId) return;
    if (!signalRConnection || signalRConnection.state !== signalR.HubConnectionState.Connected) {
        showToast('Not connected to chat server', 'error');
        return;
    }

    try {
        input.value = '';
        autoResizeTextarea(input);

        // Send message via SignalR for real-time delivery
        await signalRConnection.invoke('SendMessage', currentConversationId, content, 'text', null, null, null, null, null);

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
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
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
    document.getElementById('newChatModal').classList.add('active');
    selectedUsers = [];
    conversationType = 'direct';
    document.getElementById('userSearch').value = '';
    document.getElementById('groupName').value = '';
    document.getElementById('selectedUsers').innerHTML = '';
    document.getElementById('userSearchResults').classList.remove('show');
    updateConversationTypeUI();
}

function closeNewChatModal() {
    document.getElementById('newChatModal').classList.remove('active');
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
            const results = await api.searchChatUsers(query);
            renderUserSearchResults(results);
        } catch (error) {
            console.error('Error searching users:', error);
        }
    }, 300);
}

function renderUserSearchResults(users) {
    const container = document.getElementById('userSearchResults');

    // Filter out already selected users and current user
    const filtered = users.filter(u =>
        u.user_id !== currentUser.id &&
        !selectedUsers.some(s => s.user_id === u.user_id)
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding: 16px; text-align: center; color: #666;">No users found</div>';
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
            response = await api.createGroupConversation(groupName, selectedUsers.map(u => u.user_id));
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
                <p style="color: #666; margin: 0;">${conv.participants?.length || 0} members</p>
            </div>
            <div style="margin-bottom: 16px;">
                <h4 style="font-size: 14px; color: #666; margin-bottom: 12px;">Members</h4>
                ${(conv.participants || []).map(p => `
                    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 0;">
                        <div class="conversation-avatar" style="width: 36px; height: 36px; min-width: 36px; font-size: 13px;">
                            ${getInitials(p.user_name || p.user_email)}
                        </div>
                        <div>
                            <div style="font-weight: 500;">${escapeHtml(p.user_name || p.user_email)}</div>
                            ${p.role === 'admin' ? '<span style="font-size: 11px; color: #666;">Admin</span>' : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        leaveBtn.style.display = 'block';
    } else {
        const otherUser = conv.participants?.find(p => p.user_id !== currentUser.id);
        content.innerHTML = `
            <div style="text-align: center;">
                <div class="chat-header-avatar" style="width: 80px; height: 80px; font-size: 28px; margin: 0 auto 16px;">
                    ${getInitials(otherUser?.user_name || otherUser?.user_email)}
                </div>
                <h3 style="margin: 0 0 4px;">${escapeHtml(otherUser?.user_name || otherUser?.user_email || 'Unknown')}</h3>
                <p style="color: #666; margin: 0;">${otherUser?.user_email || ''}</p>
            </div>
        `;
        leaveBtn.style.display = 'none';
    }

    document.getElementById('chatInfoModal').classList.add('active');
}

function closeChatInfoModal() {
    document.getElementById('chatInfoModal').classList.remove('active');
}

async function leaveConversation() {
    if (!currentConversationId) return;

    if (!confirm('Are you sure you want to leave this conversation?')) {
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
    const other = conversation.participants.find(p => p.user_id !== currentUser.id);
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

    // Update header if current conversation
    if (currentConversationId) {
        const conv = conversations.find(c => c.id === currentConversationId);
        if (conv && conv.conversation_type === 'direct') {
            const other = conv.participants?.find(p => p.user_id === userId);
            if (other) {
                document.getElementById('chatHeaderStatus').textContent = status;
            }
        }
    }
}

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
}

window.addEventListener('resize', handleResponsive);

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ============================================
// User Dropdown
// ============================================

window.toggleUserDropdown = function() {
    const dropdown = document.getElementById('userDropdownMenu');
    dropdown.classList.toggle('show');
};

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('userDropdownMenu');
    const avatar = document.getElementById('userAvatar');
    if (dropdown && avatar && !dropdown.contains(e.target) && !avatar.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    const searchResults = document.getElementById('userSearchResults');
    const searchInput = document.getElementById('userSearch');
    if (searchResults && searchInput && !searchResults.contains(e.target) && !searchInput.contains(e.target)) {
        searchResults.classList.remove('show');
    }
});
