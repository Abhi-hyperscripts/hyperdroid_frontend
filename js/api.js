class API {
    constructor() {
        this.token = localStorage.getItem('authToken');
    }

    // Helper to determine which service to use based on endpoint
    // Each microservice is independent - if one is down, others still work
    _getBaseUrl(endpoint) {
        // Auth endpoints go to Authentication service
        if (endpoint.startsWith('/auth/')) {
            return CONFIG.authApiBaseUrl;
        }
        // Services and Users endpoints go to Authentication service (admin APIs)
        if (endpoint.startsWith('/services') || endpoint.startsWith('/users')) {
            return CONFIG.authApiBaseUrl;
        }
        // Drive endpoints go directly to Drive service (independent microservice)
        if (endpoint.startsWith('/drive/')) {
            return CONFIG.driveApiBaseUrl;
        }
        // Chat endpoints go to Chat service (independent microservice)
        if (endpoint.startsWith('/chat/')) {
            return CONFIG.chatApiBaseUrl;
        }
        // Vision endpoints (projects, meetings) go to Vision service
        return CONFIG.visionApiBaseUrl;
    }

    async request(endpoint, options = {}) {
        const baseUrl = this._getBaseUrl(endpoint);
        const url = `${baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(this.token && { 'Authorization': `Bearer ${this.token}` })
        };

        const config = {
            ...options,
            headers: {
                ...headers,
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, config);

            // Handle non-JSON responses gracefully
            const contentType = response.headers.get('content-type');
            let data;

            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                // Handle plain text or other response types
                const text = await response.text();
                data = { message: text };
            }

            if (!response.ok) {
                throw new Error(data.message || data.title || data.errors?.join(', ') || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    // Auth
    async register(email, password, firstName, lastName) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, password, firstName, lastName })
        });
    }

    async login(email, password) {
        const data = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (data.success && data.token) {
            this.token = data.token;
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
        }

        return data;
    }

    logout() {
        this.token = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        window.location.href = '/index.html';
    }

    getUser() {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    }

    isAuthenticated() {
        return !!this.token;
    }

    async getAllUsers() {
        return this.request('/auth/users');
    }

    // ==================== ADMIN API (SUPERADMIN Only) ====================

    // Services Health
    async getServicesHealthSummary() {
        return this.request('/services/health/summary');
    }

    async getAllServices() {
        return this.request('/services');
    }

    async getServiceByName(name) {
        return this.request(`/services/${name}`);
    }

    // User Management (SUPERADMIN)
    async getAllUsersAdmin() {
        return this.request('/users');
    }

    async getUserById(userId) {
        return this.request(`/users/${userId}`);
    }

    async createUserAdmin(email, password, firstName, lastName, roles = []) {
        return this.request('/users', {
            method: 'POST',
            body: JSON.stringify({
                email,
                password,
                firstName,
                lastName,
                roles
            })
        });
    }

    async deactivateUser(userId) {
        return this.request(`/users/${userId}`, {
            method: 'DELETE'
        });
    }

    async deleteUserPermanently(userId) {
        return this.request(`/users/${userId}/permanent`, {
            method: 'DELETE'
        });
    }

    async reactivateUser(userId) {
        return this.request(`/users/${userId}/reactivate`, {
            method: 'POST'
        });
    }

    async addUserRoles(userId, roles) {
        return this.request(`/users/${userId}/roles`, {
            method: 'POST',
            body: JSON.stringify({ roles })
        });
    }

    async removeUserRoles(userId, roles) {
        return this.request(`/users/${userId}/roles`, {
            method: 'DELETE',
            body: JSON.stringify({ roles })
        });
    }

    async getAllRoles() {
        return this.request('/users/roles');
    }

    async resetUserPassword(userId, newPassword) {
        return this.request(`/users/${userId}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ newPassword })
        });
    }

    // Projects
    async getProjects() {
        return this.request('/projects/list');
    }

    async createProject(projectName, description) {
        return this.request('/projects/create', {
            method: 'POST',
            body: JSON.stringify({ project_name: projectName, description })
        });
    }

    async updateProject(id, projectName, description, isActive) {
        return this.request('/projects/update', {
            method: 'PUT',
            body: JSON.stringify({ id, project_name: projectName, description, is_active: isActive })
        });
    }

    async deleteProject(id) {
        return this.request(`/projects/${id}`, {
            method: 'DELETE'
        });
    }

    // Meetings
    async getProjectMeetings(projectId) {
        return this.request(`/meetings/project/${projectId}`);
    }

    async getHostedMeetings() {
        return this.request('/meetings/hosted');
    }

    async createMeeting(projectId, meetingName, startTime, endTime, notes, allowGuests = false, meetingType = 'regular', autoRecording = true, hostUserId = null) {
        return this.request('/meetings/create', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                meeting_name: meetingName,
                start_time: startTime,
                end_time: endTime,
                notes,
                allow_guests: allowGuests,
                meeting_type: meetingType,
                auto_recording: autoRecording,
                host_user_id: hostUserId
            })
        });
    }

    async updateMeeting(id, meetingName, startTime, endTime, notes, isActive) {
        return this.request('/meetings/update', {
            method: 'PUT',
            body: JSON.stringify({
                id,
                meeting_name: meetingName,
                start_time: startTime,
                end_time: endTime,
                notes,
                is_active: isActive
            })
        });
    }

    async deleteMeeting(id) {
        return this.request(`/meetings/${id}`, {
            method: 'DELETE'
        });
    }

    async permanentDeleteMeeting(id) {
        return this.request(`/meetings/${id}/permanent`, {
            method: 'DELETE'
        });
    }

    async getLiveKitToken(meetingId, participantName) {
        return this.request('/meetings/token', {
            method: 'POST',
            body: JSON.stringify({ meeting_id: meetingId, participant_name: participantName })
        });
    }

    async getChatHistory(meetingId, limit = 100) {
        return this.request(`/meetings/${meetingId}/chat?limit=${limit}`);
    }

    // Upload a file to chat conversation (max 100MB)
    // Routes to Chat microservice: /api/chat/conversations/{conversationId}/upload
    async uploadChatFile(conversationId, file, onProgress = null) {
        const baseUrl = CONFIG.chatApiBaseUrl;
        const url = `${baseUrl}/chat/conversations/${conversationId}/upload`;

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Progress handler
            if (onProgress) {
                xhr.upload.addEventListener('progress', (event) => {
                    if (event.lengthComputable) {
                        const percent = Math.round((event.loaded / event.total) * 100);
                        onProgress(percent);
                    }
                });
            }

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch (e) {
                        reject(new Error('Invalid response from server'));
                    }
                } else {
                    try {
                        const error = JSON.parse(xhr.responseText);
                        reject(new Error(error.message || error.error || 'Upload failed'));
                    } catch (e) {
                        reject(new Error(`Upload failed with status ${xhr.status}`));
                    }
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Network error during upload'));
            });

            xhr.open('POST', url);
            if (this.token) {
                xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
            }

            const formData = new FormData();
            formData.append('file', file);
            xhr.send(formData);
        });
    }

    // Get download URL for a chat file
    // Routes to Chat microservice: /api/chat/conversations/{conversationId}/file-url
    async getChatFileDownloadUrl(conversationId, s3Key, expiryMinutes = 10080) {
        return this.request(`/chat/conversations/${conversationId}/file-url?s3_key=${encodeURIComponent(s3Key)}&expiry_minutes=${expiryMinutes}`);
    }

    async getLiveParticipants(meetingId) {
        return this.request(`/meetings/${meetingId}/live-participants`);
    }

    async toggleAllowGuests(meetingId, value) {
        return this.request(`/meetings/${meetingId}/toggle-guests`, {
            method: 'POST',
            body: JSON.stringify({
                meeting_id: meetingId,
                value: value
            })
        });
    }

    async toggleAutoRecording(meetingId, value) {
        return this.request(`/meetings/${meetingId}/toggle-recording`, {
            method: 'POST',
            body: JSON.stringify({
                meeting_id: meetingId,
                value: value
            })
        });
    }

    async updateMeetingHost(meetingId, hostUserId) {
        return this.request(`/meetings/${meetingId}/update-host`, {
            method: 'POST',
            body: JSON.stringify({
                meeting_id: meetingId,
                host_user_id: hostUserId
            })
        });
    }

    async getMeetingStatus(meetingId) {
        const response = await fetch(`${CONFIG.apiBaseUrl}/meetings/${meetingId}/status`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to get meeting status');
        }

        return response.json();
    }

    async startMeeting(meetingId) {
        return this.request(`/meetings/${meetingId}/start`, {
            method: 'POST',
            body: JSON.stringify({})
        });
    }

    async checkMeetingAccess(meetingId) {
        return this.request(`/meetings/${meetingId}/check-access`);
    }

    // Guest join (no authentication required)
    async guestJoinMeeting(meetingId, firstName, lastName) {
        const response = await fetch(`${CONFIG.apiBaseUrl}/meetings/guest-join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                meeting_id: meetingId,
                first_name: firstName,
                last_name: lastName
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to join meeting');
        }

        return response.json();
    }

    // Allowed Participants (for participant-controlled meetings)
    async addAllowedParticipant(meetingId, userEmail) {
        return this.request(`/meetings/${meetingId}/allowed-participants`, {
            method: 'POST',
            body: JSON.stringify({
                meeting_id: meetingId,
                user_email: userEmail
            })
        });
    }

    async addMultipleAllowedParticipants(meetingId, userEmails) {
        return this.request(`/meetings/${meetingId}/allowed-participants/bulk`, {
            method: 'POST',
            body: JSON.stringify({
                meeting_id: meetingId,
                user_emails: userEmails
            })
        });
    }

    async getAllowedParticipants(meetingId) {
        return this.request(`/meetings/${meetingId}/allowed-participants`);
    }

    async removeAllowedParticipant(meetingId, userEmail) {
        return this.request(`/meetings/${meetingId}/allowed-participants/${encodeURIComponent(userEmail)}`, {
            method: 'DELETE'
        });
    }

    async getMeetingRecordings(meetingId) {
        return this.request(`/meetings/recordings/${meetingId}`);
    }

    // ==================== DRIVE API ====================

    // Folder operations
    async createFolder(folderName, description = null, parentFolderId = null) {
        return this.request('/drive/folders', {
            method: 'POST',
            body: JSON.stringify({
                folder_name: folderName,
                description: description,
                parent_folder_id: parentFolderId
            })
        });
    }

    async updateFolder(folderId, folderName, description = null) {
        return this.request(`/drive/folders/${folderId}`, {
            method: 'PUT',
            body: JSON.stringify({
                folder_name: folderName,
                description: description
            })
        });
    }

    async deleteFolder(folderId, recursive = true) {
        return this.request(`/drive/folders/${folderId}?recursive=${recursive}`, {
            method: 'DELETE'
        });
    }

    async listFolders(parentFolderId = null) {
        const query = parentFolderId ? `?parent_folder_id=${parentFolderId}` : '';
        return this.request(`/drive/folders${query}`);
    }

    async getFolderInfo(folderId) {
        return this.request(`/drive/folders/${folderId}`);
    }

    // File operations
    async listFiles(folderId = null, pageSize = 100) {
        let query = `?page_size=${pageSize}`;
        if (folderId) query += `&folder_id=${folderId}`;
        return this.request(`/drive/files${query}`);
    }

    async getFileInfo(fileId) {
        return this.request(`/drive/files/${fileId}`);
    }

    async deleteFile(fileId) {
        return this.request(`/drive/files/${fileId}`, {
            method: 'DELETE'
        });
    }

    async renameFile(fileId, fileName) {
        return this.request(`/drive/files/${fileId}`, {
            method: 'PUT',
            body: JSON.stringify({
                file_name: fileName
            })
        });
    }

    async getUploadUrl(fileName, contentType, folderId = null, fileSize = 0, expiryMinutes = 60) {
        return this.request('/drive/upload-url', {
            method: 'POST',
            body: JSON.stringify({
                file_name: fileName,
                content_type: contentType,
                folder_id: folderId,
                file_size: fileSize,
                expiry_minutes: expiryMinutes
            })
        });
    }

    async completeUpload(fileId, uploadId, parts) {
        return this.request('/drive/complete-upload', {
            method: 'POST',
            body: JSON.stringify({
                file_id: fileId,
                upload_id: uploadId,
                parts: parts
            })
        });
    }

    async getDownloadUrl(fileId, expiryMinutes = 60) {
        return this.request(`/drive/download/${fileId}?expiry_minutes=${expiryMinutes}`);
    }

    // Browse (combined folders + files)
    async browseDrive(folderId = null) {
        const query = folderId ? `?folder_id=${folderId}` : '';
        return this.request(`/drive/browse${query}`);
    }

    // Sharing operations
    async createShareLink(itemId, itemType, accessType = 'download', expiryHours = 0, password = null, allowAnonymous = true, maxDownloads = 0) {
        return this.request('/drive/share', {
            method: 'POST',
            body: JSON.stringify({
                item_id: itemId,
                item_type: itemType,
                access_type: accessType,
                expiry_hours: expiryHours,
                password: password,
                allow_anonymous: allowAnonymous,
                max_downloads: maxDownloads
            })
        });
    }

    async revokeShareLink(shareId) {
        return this.request(`/drive/share/${shareId}`, {
            method: 'DELETE'
        });
    }

    async updateShareLink(shareId, accessType = null, expiryHours = 0, password = null, removePassword = false, maxDownloads = 0) {
        return this.request(`/drive/share/${shareId}`, {
            method: 'PUT',
            body: JSON.stringify({
                access_type: accessType,
                expiry_hours: expiryHours,
                password: password,
                remove_password: removePassword,
                max_downloads: maxDownloads
            })
        });
    }

    async getSharedByMe(pageSize = 100) {
        return this.request(`/drive/shared?page_size=${pageSize}`);
    }

    async accessSharedItem(shareToken, password = null) {
        const baseUrl = this._getBaseUrl('/drive/access-shared');
        const response = await fetch(`${baseUrl}/drive/access-shared`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                share_token: shareToken,
                password: password
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to access shared item');
        }
        return data;
    }

    // ==================== CHAT API ====================

    // Conversations
    async getConversations(limit = 50, offset = 0) {
        return this.request(`/chat/conversations?limit=${limit}&offset=${offset}`);
    }

    async getConversation(conversationId) {
        return this.request(`/chat/conversations/${conversationId}`);
    }

    async createDirectConversation(targetUserId) {
        return this.request('/chat/conversations/direct', {
            method: 'POST',
            body: JSON.stringify({ target_user_id: targetUserId })
        });
    }

    async createGroupConversation(name, description = null, memberUserIds = []) {
        return this.request('/chat/conversations/group', {
            method: 'POST',
            body: JSON.stringify({
                name: name,
                description: description,
                member_user_ids: memberUserIds
            })
        });
    }

    async updateConversation(conversationId, name, description = null, avatarUrl = null) {
        return this.request(`/chat/conversations/${conversationId}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: name,
                description: description,
                avatar_url: avatarUrl
            })
        });
    }

    async leaveConversation(conversationId) {
        return this.request(`/chat/conversations/${conversationId}`, {
            method: 'DELETE'
        });
    }

    async archiveConversation(conversationId) {
        return this.request(`/chat/conversations/${conversationId}/archive`, {
            method: 'POST'
        });
    }

    async unarchiveConversation(conversationId) {
        return this.request(`/chat/conversations/${conversationId}/unarchive`, {
            method: 'POST'
        });
    }

    async deleteConversationForUser(conversationId) {
        return this.request(`/chat/conversations/${conversationId}/delete`, {
            method: 'DELETE'
        });
    }

    async getArchivedConversations(limit = 50, offset = 0) {
        return this.request(`/chat/conversations/archived?limit=${limit}&offset=${offset}`);
    }

    // Messages
    async getMessages(conversationId, beforeMessageId = null, limit = 50) {
        let query = `?limit=${limit}`;
        if (beforeMessageId) query += `&before_message_id=${beforeMessageId}`;
        return this.request(`/chat/conversations/${conversationId}/messages${query}`);
    }

    async sendMessage(conversationId, content, messageType = 'text', fileId = null, fileName = null, fileSize = null, fileContentType = null, replyToMessageId = null) {
        return this.request(`/chat/conversations/${conversationId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: content,
                message_type: messageType,
                file_id: fileId,
                file_name: fileName,
                file_size: fileSize,
                file_content_type: fileContentType,
                reply_to_message_id: replyToMessageId
            })
        });
    }

    async editMessage(messageId, content) {
        return this.request(`/chat/messages/${messageId}`, {
            method: 'PUT',
            body: JSON.stringify({ content: content })
        });
    }

    async deleteMessage(messageId) {
        return this.request(`/chat/messages/${messageId}`, {
            method: 'DELETE'
        });
    }

    async markAsRead(conversationId, messageId) {
        return this.request(`/chat/conversations/${conversationId}/read`, {
            method: 'POST',
            body: JSON.stringify({ message_id: messageId })
        });
    }

    // Participants
    async getParticipants(conversationId) {
        return this.request(`/chat/conversations/${conversationId}/participants`);
    }

    async addParticipant(conversationId, userId) {
        return this.request(`/chat/conversations/${conversationId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId })
        });
    }

    async addMultipleParticipants(conversationId, userIds) {
        return this.request(`/chat/conversations/${conversationId}/participants/bulk`, {
            method: 'POST',
            body: JSON.stringify({ user_ids: userIds })
        });
    }

    async removeParticipant(conversationId, targetUserId) {
        return this.request(`/chat/conversations/${conversationId}/participants/${targetUserId}`, {
            method: 'DELETE'
        });
    }

    // Users & Status
    async searchChatUsers(query, limit = 20) {
        return this.request(`/chat/users/search?query=${encodeURIComponent(query)}&limit=${limit}`);
    }

    async getUnreadCounts() {
        return this.request('/chat/unread');
    }

    async updateChatStatus(status) {
        return this.request('/chat/status', {
            method: 'PUT',
            body: JSON.stringify({ status: status })
        });
    }

    async getChatStatus() {
        return this.request('/chat/status');
    }
}

// Export singleton instance
const api = new API();
