class API {
    constructor() {
        // Safely get auth token - config.js must be loaded first
        this.token = typeof getAuthToken === 'function' ? getAuthToken() : null;
        this._isRefreshing = false;
        this._refreshPromise = null;
        this._refreshTimer = null;
        this._visibilityHandler = null;

        // Start background refresh timer if we have a token
        if (this.token) {
            this._startBackgroundRefresh();
        }
    }

    // ==================== Background Token Refresh ====================

    /**
     * Start the background token refresh timer.
     * Checks every 5 minutes and refreshes when token has <10 minutes remaining.
     */
    _startBackgroundRefresh() {
        // Clear any existing timer
        this._stopBackgroundRefresh();

        // Check every 5 minutes (300000 ms)
        const CHECK_INTERVAL = 5 * 60 * 1000;
        // Refresh when less than 10 minutes remaining
        const REFRESH_THRESHOLD = 10 * 60 * 1000;

        console.log('[API] Starting background token refresh timer');

        this._refreshTimer = setInterval(async () => {
            await this._checkAndRefreshToken(REFRESH_THRESHOLD);
        }, CHECK_INTERVAL);

        // Also handle page visibility changes
        this._visibilityHandler = async () => {
            if (document.visibilityState === 'visible') {
                console.log('[API] Page became visible, checking token...');
                await this._checkAndRefreshToken(REFRESH_THRESHOLD);
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // Do an initial check
        this._checkAndRefreshToken(REFRESH_THRESHOLD);
    }

    /**
     * Stop the background token refresh timer.
     */
    _stopBackgroundRefresh() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
            console.log('[API] Stopped background token refresh timer');
        }
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
    }

    /**
     * Check if token needs refresh and refresh it proactively.
     * @param {number} threshold - Refresh if less than this many ms remaining
     */
    async _checkAndRefreshToken(threshold) {
        const accessExpiry = getAccessTokenExpiry();
        if (!accessExpiry) return;

        const timeRemaining = accessExpiry - Date.now();

        if (timeRemaining < threshold && timeRemaining > 0) {
            console.log(`[API] Token expires in ${Math.round(timeRemaining / 60000)} minutes, refreshing proactively...`);
            await this._refreshTokenIfNeeded();
        } else if (timeRemaining <= 0) {
            console.log('[API] Token already expired, refreshing...');
            const success = await this._refreshTokenIfNeeded();
            if (!success) {
                console.log('[API] Background refresh failed, user session expired');
                this._stopBackgroundRefresh();
            }
        }
    }

    // Helper to determine which service to use based on endpoint
    // Each microservice is independent - if one is down, others still work
    _getBaseUrl(endpoint) {
        // Auth endpoints go to Authentication service
        if (endpoint.startsWith('/auth/')) {
            return CONFIG.authApiBaseUrl;
        }
        // Services, Users, Admin, and Tenants endpoints go to Authentication service (admin APIs)
        if (endpoint.startsWith('/services') || endpoint.startsWith('/users') || endpoint.startsWith('/admin/') || endpoint.startsWith('/tenants')) {
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
        // HRMS endpoints go to HRMS service (independent microservice)
        if (endpoint.startsWith('/hrms/')) {
            return CONFIG.hrmsApiBaseUrl;
        }
        // Vision endpoints (projects, meetings) go to Vision service
        return CONFIG.visionApiBaseUrl;
    }

    async request(endpoint, options = {}) {
        // Check if token needs refresh before making request (except for auth endpoints)
        if (!endpoint.startsWith('/auth/') && this.token && isAccessTokenExpired()) {
            console.log('[API] Access token expired, attempting refresh...');
            const refreshed = await this._refreshTokenIfNeeded();
            if (!refreshed) {
                // Refresh failed, redirect to login
                console.log('[API] Token refresh failed, redirecting to login');
                this.logout();
                throw new Error('Session expired. Please log in again.');
            }
        }

        const baseUrl = this._getBaseUrl(endpoint);
        // For HRMS endpoints, strip /hrms prefix since baseUrl already has /api
        // e.g., /hrms/offices -> /offices (baseUrl has /api, so final is /api/offices)
        let actualEndpoint = endpoint;
        if (endpoint.startsWith('/hrms/')) {
            actualEndpoint = endpoint.substring(5); // Remove '/hrms' prefix, keep the rest
        }
        const url = `${baseUrl}${actualEndpoint}`;
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
                // If we get 401 and it's not a refresh request, try to refresh token
                if (response.status === 401 && !endpoint.includes('/auth/refresh')) {
                    console.log('[API] Got 401, attempting token refresh...');
                    const refreshed = await this._refreshTokenIfNeeded();
                    if (refreshed) {
                        // Retry the original request with new token
                        config.headers['Authorization'] = `Bearer ${this.token}`;
                        const retryResponse = await fetch(url, config);
                        if (retryResponse.ok) {
                            const retryContentType = retryResponse.headers.get('content-type');
                            if (retryContentType && retryContentType.includes('application/json')) {
                                return await retryResponse.json();
                            }
                            return { message: await retryResponse.text() };
                        }
                    }
                    // If refresh failed, logout
                    this.logout();
                    throw new Error('Session expired. Please log in again.');
                }
                throw new Error(data.message || data.error || data.title || data.errors?.join(', ') || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    /**
     * Attempt to refresh the access token using the stored refresh token.
     * Uses a lock to prevent multiple simultaneous refresh requests.
     * @returns {Promise<boolean>} True if refresh succeeded, false otherwise
     */
    async _refreshTokenIfNeeded() {
        // If refresh token is also expired, can't refresh
        if (isRefreshTokenExpired()) {
            console.log('[API] Refresh token expired');
            return false;
        }

        const refreshToken = getRefreshToken();
        if (!refreshToken) {
            console.log('[API] No refresh token available');
            return false;
        }

        // If already refreshing, wait for the existing promise
        if (this._isRefreshing) {
            console.log('[API] Already refreshing, waiting...');
            return this._refreshPromise;
        }

        // Start refresh process
        this._isRefreshing = true;
        this._refreshPromise = this._doRefresh(refreshToken);

        try {
            const result = await this._refreshPromise;
            return result;
        } finally {
            this._isRefreshing = false;
            this._refreshPromise = null;
        }
    }

    /**
     * Actually perform the token refresh
     */
    async _doRefresh(refreshToken) {
        try {
            const response = await fetch(`${CONFIG.authApiBaseUrl}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: refreshToken })
            });

            if (!response.ok) {
                console.log('[API] Refresh request failed with status:', response.status);
                return false;
            }

            const data = await response.json();
            if (data.success && data.accessToken && data.refreshToken) {
                // Store new tokens
                this.token = data.accessToken;
                storeAuthToken(data.accessToken);
                storeRefreshToken(data.refreshToken);
                storeTokenExpiry(data.accessTokenExpiresIn, data.refreshTokenExpiresIn);
                console.log('[API] Token refreshed successfully');
                return true;
            }

            console.log('[API] Refresh response missing tokens');
            return false;
        } catch (error) {
            console.error('[API] Error during token refresh:', error);
            return false;
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

        if (data.success) {
            // Handle new dual-token response format
            const accessToken = data.accessToken || data.token;
            if (accessToken) {
                this.token = accessToken;
                storeAuthToken(accessToken);

                // Store refresh token if available
                if (data.refreshToken) {
                    storeRefreshToken(data.refreshToken);
                }

                // Store token expiry times if available
                if (data.accessTokenExpiresIn && data.refreshTokenExpiresIn) {
                    storeTokenExpiry(data.accessTokenExpiresIn, data.refreshTokenExpiresIn);
                }

                if (data.user) {
                    storeUser(data.user);
                }

                // Start background refresh timer
                this._startBackgroundRefresh();
            }
        }

        return data;
    }

    /**
     * Logout the user - revokes refresh token on server and clears local storage.
     * @param {boolean} redirectToHome - Whether to redirect to login page (default: true)
     */
    async logout(redirectToHome = true) {
        // Stop background refresh timer
        this._stopBackgroundRefresh();

        // Try to revoke the refresh token on the server
        const refreshToken = getRefreshToken();
        if (refreshToken) {
            try {
                await fetch(`${CONFIG.authApiBaseUrl}/auth/revoke`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: refreshToken })
                });
            } catch (error) {
                console.warn('[API] Failed to revoke token on server:', error);
                // Continue with local logout even if server revocation fails
            }
        }

        this.token = null;
        clearAuthData();
        if (redirectToHome) {
            window.location.href = '/index.html';
        }
    }

    /**
     * Logout from all devices - revokes all refresh tokens for the user.
     */
    async logoutAllDevices() {
        // Stop background refresh timer
        this._stopBackgroundRefresh();

        try {
            await this.request('/auth/revoke-all', { method: 'POST' });
        } catch (error) {
            console.warn('[API] Failed to revoke all tokens:', error);
        }
        this.token = null;
        clearAuthData();
        window.location.href = '/index.html';
    }

    getUser() {
        return getStoredUser();
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

    // License Info (SUPERADMIN)
    async getLicenseInfo() {
        return this.request('/admin/license');
    }

    // Update License (SUPERADMIN) - For on-premise and SaaS sub-tenants
    async updateLicense(tenantId, encryptedToken) {
        return this.request(`/tenants/${tenantId}/license`, {
            method: 'PUT',
            body: JSON.stringify({ encryptedToken })
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

    // ==================== HRMS API ====================

    // ==================== HRMS Self-Service (ESS) ====================

    // Self-Service Dashboard
    async getHrmsDashboard() {
        return this.request('/hrms/self-service/dashboard');
    }

    // --- My Profile (ESS) ---
    async getMyHrmsProfile() {
        return this.request('/hrms/self-service/my-profile');
    }

    async getMyHrmsProfilePersonal() {
        return this.request('/hrms/self-service/my-profile/personal');
    }

    async getMyHrmsProfileBankAccounts() {
        return this.request('/hrms/self-service/my-profile/bank-accounts');
    }

    async getMyHrmsProfileStatutory() {
        return this.request('/hrms/self-service/my-profile/statutory');
    }

    async getMyHrmsProfileDocuments() {
        return this.request('/hrms/self-service/my-profile/documents');
    }

    // --- Profile Update Requests (ESS) ---
    async createProfileUpdateRequest(request) {
        return this.request('/hrms/self-service/profile/requests', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getMyProfileUpdateRequests(status = null) {
        const query = status ? `?status=${status}` : '';
        return this.request(`/hrms/self-service/profile/requests${query}`);
    }

    async cancelProfileUpdateRequest(requestId) {
        return this.request(`/hrms/self-service/profile/requests/${requestId}`, {
            method: 'DELETE'
        });
    }

    async getPendingProfileUpdateRequests() {
        return this.request('/hrms/self-service/profile/requests/pending');
    }

    async reviewProfileUpdateRequest(requestId, approve, rejectionReason = null) {
        return this.request(`/hrms/self-service/profile/requests/${requestId}/review`, {
            method: 'POST',
            body: JSON.stringify({ approve, rejection_reason: rejectionReason })
        });
    }

    // --- Announcements (ESS) ---
    async getHrmsAnnouncements(unreadOnly = false, limit = 20) {
        return this.request(`/hrms/self-service/announcements?unreadOnly=${unreadOnly}&limit=${limit}`);
    }

    async getHrmsAnnouncement(announcementId) {
        return this.request(`/hrms/self-service/announcements/${announcementId}`);
    }

    async markAnnouncementAsRead(announcementId) {
        return this.request(`/hrms/self-service/announcements/${announcementId}/read`, {
            method: 'POST'
        });
    }

    async createHrmsAnnouncement(announcement) {
        return this.request('/hrms/self-service/announcements', {
            method: 'POST',
            body: JSON.stringify(announcement)
        });
    }

    async updateHrmsAnnouncement(announcementId, announcement) {
        return this.request(`/hrms/self-service/announcements/${announcementId}`, {
            method: 'PUT',
            body: JSON.stringify(announcement)
        });
    }

    async deleteHrmsAnnouncement(announcementId) {
        return this.request(`/hrms/self-service/announcements/${announcementId}`, {
            method: 'DELETE'
        });
    }

    // --- Notifications (ESS) ---
    async getHrmsNotifications(unreadOnly = false, limit = 20) {
        return this.request(`/hrms/self-service/notifications?unreadOnly=${unreadOnly}&limit=${limit}`);
    }

    async getHrmsUnreadNotificationCount() {
        return this.request('/hrms/self-service/notifications/unread-count');
    }

    async markHrmsNotificationAsRead(notificationId) {
        return this.request(`/hrms/self-service/notifications/${notificationId}/read`, {
            method: 'POST'
        });
    }

    async markAllHrmsNotificationsAsRead() {
        return this.request('/hrms/self-service/notifications/read-all', {
            method: 'POST'
        });
    }

    // --- Team Directory (ESS) ---
    async getTeamDirectory(departmentId = null, officeId = null, search = null) {
        const params = new URLSearchParams();
        if (departmentId) params.append('departmentId', departmentId);
        if (officeId) params.append('officeId', officeId);
        if (search) params.append('search', search);
        const query = params.toString() ? `?${params.toString()}` : '';
        return this.request(`/hrms/self-service/directory${query}`);
    }

    // --- Organization Chart (ESS) ---
    async getOrgChart(rootEmployeeId = null) {
        const query = rootEmployeeId ? `?rootEmployeeId=${rootEmployeeId}` : '';
        return this.request(`/hrms/self-service/org-chart${query}`);
    }

    // --- Attendance Clock In/Out (ESS) ---
    async hrmsClockIn(data = {}) {
        return this.request('/hrms/attendance/clock-in', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async hrmsClockOut(data = {}) {
        return this.request('/hrms/attendance/clock-out', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async getMyTodayAttendance() {
        return this.request('/hrms/attendance/today');
    }

    // --- Dashboard Widgets (ESS) ---
    async getUpcomingHolidays(count = 5) {
        return this.request(`/hrms/holidays/upcoming?count=${count}`);
    }

    async getDashboardBirthdays(days = 30) {
        return this.request(`/hrms/reports/dashboard/birthdays?days=${days}`);
    }

    async getDashboardAnniversaries(days = 30) {
        return this.request(`/hrms/reports/dashboard/anniversaries?days=${days}`);
    }

    async getDashboardQuickStats() {
        return this.request('/hrms/reports/dashboard/quick-stats');
    }

    async getDashboardProbationEnding(days = 30) {
        return this.request(`/hrms/reports/dashboard/probation-ending?days=${days}`);
    }

    async getDashboardNewJoiners(days = 30) {
        return this.request(`/hrms/reports/dashboard/new-joiners?days=${days}`);
    }

    async getDashboardExits(days = 30) {
        return this.request(`/hrms/reports/dashboard/exits?days=${days}`);
    }

    // ==================== HRMS Admin/Manager APIs ====================

    // --- Offices ---
    async getHrmsOffices() {
        return this.request('/hrms/offices');
    }

    async getHrmsOffice(id) {
        return this.request(`/hrms/offices/${id}`);
    }

    async createHrmsOffice(office) {
        return this.request('/hrms/offices', {
            method: 'POST',
            body: JSON.stringify(office)
        });
    }

    async updateHrmsOffice(id, office) {
        return this.request(`/hrms/offices/${id}`, {
            method: 'PUT',
            body: JSON.stringify(office)
        });
    }

    async deleteHrmsOffice(id) {
        return this.request(`/hrms/offices/${id}`, {
            method: 'DELETE'
        });
    }

    async getOfficeByCode(code) {
        return this.request(`/hrms/offices/by-code/${encodeURIComponent(code)}`);
    }

    // --- Departments ---
    async getHrmsDepartments() {
        return this.request('/hrms/departments');
    }

    async getHrmsDepartment(id) {
        return this.request(`/hrms/departments/${id}`);
    }

    async createHrmsDepartment(department) {
        return this.request('/hrms/departments', {
            method: 'POST',
            body: JSON.stringify(department)
        });
    }

    async updateHrmsDepartment(id, department) {
        return this.request(`/hrms/departments/${id}`, {
            method: 'PUT',
            body: JSON.stringify(department)
        });
    }

    async deleteHrmsDepartment(id) {
        return this.request(`/hrms/departments/${id}`, {
            method: 'DELETE'
        });
    }

    async getDepartmentByCode(code) {
        return this.request(`/hrms/departments/by-code/${encodeURIComponent(code)}`);
    }

    async getDepartmentHierarchy(officeId = null) {
        const query = officeId ? `?officeId=${officeId}` : '';
        return this.request(`/hrms/departments/hierarchy${query}`);
    }

    async getSubDepartments(departmentId) {
        return this.request(`/hrms/departments/${departmentId}/sub-departments`);
    }

    // --- Designations ---
    async getHrmsDesignations() {
        return this.request('/hrms/designations');
    }

    async getHrmsDesignation(id) {
        return this.request(`/hrms/designations/${id}`);
    }

    async createHrmsDesignation(designation) {
        return this.request('/hrms/designations', {
            method: 'POST',
            body: JSON.stringify(designation)
        });
    }

    async updateHrmsDesignation(id, designation) {
        return this.request(`/hrms/designations/${id}`, {
            method: 'PUT',
            body: JSON.stringify(designation)
        });
    }

    async deleteHrmsDesignation(id) {
        return this.request(`/hrms/designations/${id}`, {
            method: 'DELETE'
        });
    }

    async getDesignationByCode(code) {
        return this.request(`/hrms/designations/by-code/${encodeURIComponent(code)}`);
    }

    // --- Shifts ---
    async getHrmsShifts() {
        return this.request('/hrms/shifts');
    }

    async getHrmsShift(id) {
        return this.request(`/hrms/shifts/${id}`);
    }

    async createHrmsShift(shift) {
        return this.request('/hrms/shifts', {
            method: 'POST',
            body: JSON.stringify(shift)
        });
    }

    async updateHrmsShift(id, shift) {
        return this.request(`/hrms/shifts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(shift)
        });
    }

    async deleteHrmsShift(id) {
        return this.request(`/hrms/shifts/${id}`, {
            method: 'DELETE'
        });
    }

    async getShiftByCode(code) {
        return this.request(`/hrms/shifts/by-code/${encodeURIComponent(code)}`);
    }

    // --- Employee Shift Rosters ---
    async getEmployeeShiftRosters(employeeId = null, officeId = null, shiftId = null) {
        const params = new URLSearchParams();
        if (employeeId) params.append('employeeId', employeeId);
        if (officeId) params.append('officeId', officeId);
        if (shiftId) params.append('shiftId', shiftId);
        const query = params.toString() ? `?${params.toString()}` : '';
        return this.request(`/hrms/shift-rosters${query}`);
    }

    async getEmployeeShiftRoster(id) {
        return this.request(`/hrms/shift-rosters/${id}`);
    }

    async createEmployeeShiftRoster(roster) {
        return this.request('/hrms/shift-rosters', {
            method: 'POST',
            body: JSON.stringify(roster)
        });
    }

    async updateEmployeeShiftRoster(id, roster) {
        return this.request(`/hrms/shift-rosters/${id}`, {
            method: 'PUT',
            body: JSON.stringify(roster)
        });
    }

    async deleteEmployeeShiftRoster(id) {
        return this.request(`/hrms/shift-rosters/${id}`, {
            method: 'DELETE'
        });
    }

    async createBulkShiftRosters(rosters) {
        return this.request('/hrms/shift-rosters/bulk', {
            method: 'POST',
            body: JSON.stringify(rosters)
        });
    }

    // --- Holidays ---
    async getHrmsHolidays(year = null) {
        const query = year ? `?year=${year}` : '';
        return this.request(`/hrms/holidays${query}`);
    }

    async getHrmsHoliday(id) {
        return this.request(`/hrms/holidays/${id}`);
    }

    async createHrmsHoliday(holiday) {
        return this.request('/hrms/holidays', {
            method: 'POST',
            body: JSON.stringify(holiday)
        });
    }

    async updateHrmsHoliday(id, holiday) {
        return this.request(`/hrms/holidays/${id}`, {
            method: 'PUT',
            body: JSON.stringify(holiday)
        });
    }

    async deleteHrmsHoliday(id) {
        return this.request(`/hrms/holidays/${id}`, {
            method: 'DELETE'
        });
    }

    async createBulkHolidays(holidays) {
        return this.request('/hrms/holidays/bulk', {
            method: 'POST',
            body: JSON.stringify(holidays)
        });
    }

    // --- Employees ---
    async getHrmsEmployees(includeInactive = false) {
        return this.request(`/hrms/employees?includeInactive=${includeInactive}`);
    }

    async getHrmsEmployee(id) {
        return this.request(`/hrms/employees/${id}`);
    }

    async getHrmsEmployeeByUserId(userId) {
        return this.request(`/hrms/employees/by-user/${userId}`);
    }

    async createHrmsEmployee(employee) {
        return this.request('/hrms/employees', {
            method: 'POST',
            body: JSON.stringify(employee)
        });
    }

    async updateHrmsEmployee(id, employee) {
        return this.request(`/hrms/employees/${id}`, {
            method: 'PUT',
            body: JSON.stringify(employee)
        });
    }

    async deleteHrmsEmployee(id) {
        return this.request(`/hrms/employees/${id}`, {
            method: 'DELETE'
        });
    }

    async terminateEmployee(id, terminationData) {
        return this.request(`/hrms/employees/${id}/terminate`, {
            method: 'POST',
            body: JSON.stringify(terminationData)
        });
    }

    async getAvailableUsersForEmployee() {
        return this.request('/hrms/employees/available-users');
    }

    // --- Employee Bank Accounts ---
    async getEmployeeBankAccounts(employeeId) {
        return this.request(`/hrms/employees/${employeeId}/bank-accounts`);
    }

    async getEmployeeBankAccount(employeeId, accountId) {
        return this.request(`/hrms/employees/${employeeId}/bank-accounts/${accountId}`);
    }

    async createEmployeeBankAccount(employeeId, data) {
        return this.request(`/hrms/employees/${employeeId}/bank-accounts`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateEmployeeBankAccount(employeeId, accountId, data) {
        return this.request(`/hrms/employees/${employeeId}/bank-accounts/${accountId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteEmployeeBankAccount(employeeId, accountId) {
        return this.request(`/hrms/employees/${employeeId}/bank-accounts/${accountId}`, {
            method: 'DELETE'
        });
    }

    async setPrimaryBankAccount(employeeId, accountId) {
        return this.request(`/hrms/employees/${employeeId}/bank-accounts/${accountId}/set-primary`, {
            method: 'PUT'
        });
    }

    // --- Employee Documents ---
    async getEmployeeDocuments(employeeId) {
        return this.request(`/hrms/employees/${employeeId}/documents`);
    }

    async getEmployeeDocument(employeeId, documentId) {
        return this.request(`/hrms/employees/${employeeId}/documents/${documentId}`);
    }

    async uploadEmployeeDocument(employeeId, formData) {
        // Special handling for multipart form data - don't set Content-Type header
        const token = getAuthToken();
        const response = await fetch(`${this._getBaseUrl('/hrms/')}/employees/${employeeId}/documents`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || errorText;
            } catch {
                errorMessage = errorText;
            }
            throw new Error(errorMessage);
        }

        return response.json();
    }

    async getEmployeeDocumentDownloadUrl(employeeId, documentId) {
        return this.request(`/hrms/employees/${employeeId}/documents/${documentId}/download`);
    }

    async deleteEmployeeDocument(employeeId, documentId) {
        return this.request(`/hrms/employees/${employeeId}/documents/${documentId}`, {
            method: 'DELETE'
        });
    }

    async verifyEmployeeDocument(employeeId, documentId, approve, rejectionReason = null) {
        return this.request(`/hrms/employees/${employeeId}/documents/${documentId}/verify`, {
            method: 'POST',
            body: JSON.stringify({ approve, rejection_reason: rejectionReason })
        });
    }

    // --- Attendance ---
    async checkIn(request) {
        return this.request('/hrms/attendance/check-in', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async checkOut(request) {
        return this.request('/hrms/attendance/check-out', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getMyAttendance(startDate, endDate) {
        return this.request(`/hrms/attendance/history?startDate=${startDate}&endDate=${endDate}`);
    }

    async getEmployeeAttendance(employeeId, startDate, endDate) {
        return this.request(`/hrms/attendance/employee/${employeeId}?startDate=${startDate}&endDate=${endDate}`);
    }

    async getAttendanceStatus() {
        return this.request('/hrms/attendance/status');
    }

    async requestAttendanceRegularization(request) {
        return this.request('/hrms/attendance/regularization', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getRegularizationRequests(status = null) {
        const query = status ? `?status=${status}` : '';
        return this.request(`/hrms/attendance/regularization${query}`);
    }

    async getPendingRegularizations(all = false) {
        const query = all ? '?all=true' : '';
        return this.request(`/hrms/attendance/regularization/pending${query}`);
    }

    async approveRegularization(id, rejection_reason = null) {
        return this.request(`/hrms/attendance/regularization/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ approve: true, rejection_reason })
        });
    }

    async rejectRegularization(id, rejection_reason = null) {
        return this.request(`/hrms/attendance/regularization/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ approve: false, rejection_reason })
        });
    }

    // --- Leave Management ---
    async getLeaveTypes() {
        return this.request('/hrms/leave/types');
    }

    async createLeaveType(leaveType) {
        return this.request('/hrms/leave/types', {
            method: 'POST',
            body: JSON.stringify(leaveType)
        });
    }

    async updateLeaveType(id, leaveType) {
        return this.request(`/hrms/leave/types/${id}`, {
            method: 'PUT',
            body: JSON.stringify(leaveType)
        });
    }

    async deleteLeaveType(id) {
        return this.request(`/hrms/leave/types/${id}`, {
            method: 'DELETE'
        });
    }

    async getMyLeaveBalance() {
        return this.request('/hrms/leave/balance');
    }

    async getEmployeeLeaveBalance(employeeId) {
        return this.request(`/hrms/leave/balance/${employeeId}`);
    }

    async applyLeave(request) {
        return this.request('/hrms/leave/apply', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getMyLeaveRequests() {
        return this.request('/hrms/leave/my-requests');
    }

    async getPendingLeaveApprovals() {
        return this.request('/hrms/leave/pending-approvals');
    }

    async approveLeave(id, comments = null) {
        return this.request(`/hrms/leave/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ comments })
        });
    }

    async rejectLeave(id, comments = null) {
        return this.request(`/hrms/leave/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ comments })
        });
    }

    async cancelLeave(id) {
        return this.request(`/hrms/leave/${id}/cancel`, {
            method: 'POST'
        });
    }

    // --- Leave Encashment ---
    async encashLeave(request) {
        return this.request('/hrms/leave/encash', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getEncashableLeaveBalance(employeeId = null) {
        const query = employeeId ? `?employeeId=${employeeId}` : '';
        return this.request(`/hrms/leave/encashable-balance${query}`);
    }

    async getEncashmentHistory(employeeId = null) {
        const query = employeeId ? `?employeeId=${employeeId}` : '';
        return this.request(`/hrms/leave/encashment-history${query}`);
    }

    // --- Team Calendar ---
    async getTeamLeaveCalendar(startDate, endDate, departmentId = null) {
        let query = `startDate=${startDate}&endDate=${endDate}`;
        if (departmentId) query += `&departmentId=${departmentId}`;
        return this.request(`/hrms/leave/team-calendar?${query}`);
    }

    // --- Salary Structures ---
    async getSalaryStructures() {
        return this.request('/hrms/salary-structures');
    }

    async getSalaryStructure(id) {
        return this.request(`/hrms/salary-structures/${id}`);
    }

    async getHrmsSalaryStructures(officeId) {
        if (officeId) {
            return this.request(`/hrms/payroll/structures/office/${officeId}`);
        }
        return this.request('/hrms/payroll/structures');
    }

    async createSalaryStructure(structure) {
        return this.request('/hrms/salary-structures', {
            method: 'POST',
            body: JSON.stringify(structure)
        });
    }

    async updateSalaryStructure(id, structure) {
        return this.request(`/hrms/salary-structures/${id}`, {
            method: 'PUT',
            body: JSON.stringify(structure)
        });
    }

    async deleteSalaryStructure(id) {
        return this.request(`/hrms/salary-structures/${id}`, {
            method: 'DELETE'
        });
    }

    // --- Salary Components ---
    async getSalaryComponents() {
        return this.request('/hrms/salary-components');
    }

    async createSalaryComponent(component) {
        return this.request('/hrms/salary-components', {
            method: 'POST',
            body: JSON.stringify(component)
        });
    }

    async updateSalaryComponent(id, component) {
        return this.request(`/hrms/salary-components/${id}`, {
            method: 'PUT',
            body: JSON.stringify(component)
        });
    }

    async deleteSalaryComponent(id) {
        return this.request(`/hrms/salary-components/${id}`, {
            method: 'DELETE'
        });
    }

    // --- Employee Salary ---
    async getEmployeeSalary(employeeId) {
        return this.request(`/hrms/payroll/employee/${employeeId}/salary`);
    }

    async assignEmployeeSalary(salaryData) {
        // Backend expects: POST /api/payroll/employee/{employeeId}/salary
        const employeeId = salaryData.employee_id;
        return this.request(`/hrms/payroll/employee/${employeeId}/salary`, {
            method: 'POST',
            body: JSON.stringify(salaryData)
        });
    }

    async updateEmployeeSalary(employeeId, salaryData) {
        // Backend expects: POST /api/payroll/employee/{employeeId}/salary/revise
        return this.request(`/hrms/payroll/employee/${employeeId}/salary/revise`, {
            method: 'POST',
            body: JSON.stringify(salaryData)
        });
    }

    async calculateSalaryBreakdown(request) {
        // Backend expects: POST /api/payroll/calculate
        return this.request('/hrms/payroll/calculate', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getEmployeeSalaryHistory(employeeId) {
        return this.request(`/hrms/payroll/employee/${employeeId}/salary/history`);
    }

    async getEmployeeSalaryRevisions(employeeId) {
        return this.request(`/hrms/payroll/employee/${employeeId}/salary/revisions`);
    }

    // --- Salary Entry Management (Edit/Delete scheduled entries) ---
    async canDeleteSalaryEntry(salaryId) {
        return this.request(`/hrms/payroll/salary/${salaryId}/can-delete`);
    }

    async deleteSalaryEntry(salaryId) {
        return this.request(`/hrms/payroll/salary/${salaryId}`, {
            method: 'DELETE'
        });
    }

    async updateScheduledSalaryEntry(salaryId, data) {
        return this.request(`/hrms/payroll/salary/${salaryId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    // --- Payroll Runs ---
    async getPayrollRuns(year = null, month = null) {
        let query = '';
        if (year) query += `year=${year}`;
        if (month) query += `${query ? '&' : ''}month=${month}`;
        return this.request(`/hrms/payroll/runs${query ? '?' + query : ''}`);
    }

    async getPayrollRun(id) {
        return this.request(`/hrms/payroll/runs/${id}`);
    }

    /**
     * @deprecated Direct payroll run creation is blocked.
     * Use the draft workflow instead: createPayrollDraft() → processDraft() → finalizeDraft()
     */
    async createPayrollRun(request) {
        console.warn('[DEPRECATED] createPayrollRun is not allowed. Use draft workflow: createPayrollDraft → processDraft → finalizeDraft');
        throw new Error('Direct payroll run creation is not allowed. Please use the draft workflow.');
    }

    async processPayrollRun(id) {
        return this.request(`/hrms/payroll/runs/${id}/process`, {
            method: 'POST'
        });
    }

    async approvePayrollRun(id) {
        return this.request(`/hrms/payroll/runs/${id}/approve`, {
            method: 'POST'
        });
    }

    async rejectPayrollRun(id, reason) {
        return this.request(`/hrms/payroll/runs/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
    }

    // --- Payslips ---
    async getPayslips(runId) {
        return this.request(`/hrms/payroll/runs/${runId}/payslips`);
    }

    async getPayslip(id) {
        return this.request(`/hrms/payroll/payslips/${id}`);
    }

    async getMyPayslips() {
        return this.request('/hrms/payroll/my-payslips');
    }

    async downloadPayslip(id) {
        return this.request(`/hrms/payroll/payslips/${id}/download`);
    }

    // --- Loans ---
    async getLoans(employeeId = null) {
        const query = employeeId ? `?employeeId=${employeeId}` : '';
        return this.request(`/hrms/payroll-processing/loans${query}`);
    }

    async getLoan(id) {
        return this.request(`/hrms/payroll-processing/loans/${id}`);
    }

    async applyLoan(request) {
        return this.request('/hrms/payroll-processing/loans', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async approveLoan(id) {
        return this.request(`/hrms/payroll-processing/loans/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ approved: true })
        });
    }

    async rejectLoan(id, reason) {
        return this.request(`/hrms/payroll-processing/loans/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ approved: false, rejection_reason: reason })
        });
    }

    async disburseLoan(id, disbursementMode, referenceNumber) {
        return this.request(`/hrms/payroll-processing/loans/${id}/disburse`, {
            method: 'POST',
            body: JSON.stringify({
                disbursement_mode: disbursementMode,
                reference_number: referenceNumber
            })
        });
    }

    async getPendingLoans() {
        return this.request('/hrms/payroll-processing/loans?status=pending');
    }

    async getActiveLoans() {
        return this.request('/hrms/payroll-processing/loans?status=active');
    }

    async getLoanRepayments(loanId) {
        return this.request(`/hrms/payroll-processing/loans/${loanId}/repayments`);
    }

    async getMyLoans() {
        return this.request('/hrms/payroll-processing/loans/my-loans');
    }

    // --- Payroll Adjustments ---
    async getPayrollAdjustments(employeeId = null, month = null, year = null) {
        let query = [];
        if (employeeId) query.push(`employeeId=${employeeId}`);
        if (month) query.push(`month=${month}`);
        if (year) query.push(`year=${year}`);
        return this.request(`/hrms/payroll-adjustments${query.length ? '?' + query.join('&') : ''}`);
    }

    async createPayrollAdjustment(adjustment) {
        return this.request('/hrms/payroll-adjustments', {
            method: 'POST',
            body: JSON.stringify(adjustment)
        });
    }

    async deletePayrollAdjustment(id) {
        return this.request(`/hrms/payroll-adjustments/${id}`, {
            method: 'DELETE'
        });
    }

    // --- Self-Service ---
    async updateMyProfile(request) {
        return this.request('/hrms/self-service/profile', {
            method: 'PUT',
            body: JSON.stringify(request)
        });
    }

    async getProfileUpdateRequests() {
        return this.request('/hrms/self-service/profile/requests');
    }

    async approveProfileUpdate(id) {
        return this.request(`/hrms/self-service/profile/requests/${id}/approve`, {
            method: 'POST'
        });
    }

    async rejectProfileUpdate(id, reason) {
        return this.request(`/hrms/self-service/profile/requests/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
    }

    // --- Announcements ---
    async getAnnouncements() {
        return this.request('/hrms/announcements');
    }

    async getAnnouncement(id) {
        return this.request(`/hrms/announcements/${id}`);
    }

    async createAnnouncement(announcement) {
        return this.request('/hrms/announcements', {
            method: 'POST',
            body: JSON.stringify(announcement)
        });
    }

    async updateAnnouncement(id, announcement) {
        return this.request(`/hrms/announcements/${id}`, {
            method: 'PUT',
            body: JSON.stringify(announcement)
        });
    }

    async deleteAnnouncement(id) {
        return this.request(`/hrms/announcements/${id}`, {
            method: 'DELETE'
        });
    }

    // --- Notifications ---
    async getMyNotifications() {
        return this.request('/hrms/notifications');
    }

    async markNotificationAsRead(id) {
        return this.request(`/hrms/notifications/${id}/read`, {
            method: 'POST'
        });
    }

    async markAllNotificationsAsRead() {
        return this.request('/hrms/notifications/read-all', {
            method: 'POST'
        });
    }

    // --- Reports ---
    async getHeadcountReport(asOfDate = null) {
        const query = asOfDate ? `?asOfDate=${asOfDate}` : '';
        return this.request(`/hrms/reports/headcount${query}`);
    }

    async getAttritionReport(startDate, endDate) {
        return this.request(`/hrms/reports/attrition?startDate=${startDate}&endDate=${endDate}`);
    }

    async getAttendanceReport(startDate, endDate, departmentId = null) {
        let query = `startDate=${startDate}&endDate=${endDate}`;
        if (departmentId) query += `&departmentId=${departmentId}`;
        return this.request(`/hrms/reports/attendance?${query}`);
    }

    async getLeaveReport(startDate, endDate, departmentId = null) {
        let query = `startDate=${startDate}&endDate=${endDate}`;
        if (departmentId) query += `&departmentId=${departmentId}`;
        return this.request(`/hrms/reports/leave?${query}`);
    }

    async getPayrollReport(year, month) {
        return this.request(`/hrms/reports/payroll?year=${year}&month=${month}`);
    }

    async getCostCenterReport(year, month) {
        return this.request(`/hrms/reports/cost-center?year=${year}&month=${month}`);
    }

    // --- Employee Transfers (Multi-Location) ---
    async transferEmployee(request) {
        return this.request('/hrms/employee-transfers', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getEmployeeOfficeHistory(employeeId) {
        return this.request(`/hrms/employee-transfers/${employeeId}/history`);
    }

    async getCurrentOfficeAssignment(employeeId) {
        return this.request(`/hrms/employee-transfers/${employeeId}/current`);
    }

    async getOfficeAssignmentsForPeriod(employeeId, startDate, endDate) {
        return this.request(`/hrms/employee-transfers/${employeeId}/period?startDate=${startDate}&endDate=${endDate}`);
    }

    async getEmployeeTransferSummary(employeeId) {
        return this.request(`/hrms/employee-transfers/${employeeId}/summary`);
    }

    async initializeEmployeeOfficeHistory(employeeId, officeId, effectiveFrom) {
        return this.request(`/hrms/employee-transfers/${employeeId}/initialize`, {
            method: 'POST',
            body: JSON.stringify({ office_id: officeId, effective_from: effectiveFrom })
        });
    }

    async getTransfersByOffice(officeId, startDate = null, endDate = null) {
        let query = '';
        if (startDate) query += `startDate=${startDate}`;
        if (endDate) query += `${query ? '&' : ''}endDate=${endDate}`;
        return this.request(`/hrms/employee-transfers/by-office/${officeId}${query ? '?' + query : ''}`);
    }

    // --- Department Transfers ---
    async changeDepartment(request) {
        return this.request('/hrms/employee-transfers/department', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getEmployeeDepartmentHistory(employeeId) {
        return this.request(`/hrms/employee-transfers/${employeeId}/department-history`);
    }

    async getCurrentDepartmentAssignment(employeeId) {
        return this.request(`/hrms/employee-transfers/${employeeId}/current-department`);
    }

    // --- Manager Changes ---
    async changeManager(request) {
        return this.request('/hrms/employee-transfers/manager', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getEmployeeManagerHistory(employeeId) {
        return this.request(`/hrms/employee-transfers/${employeeId}/manager-history`);
    }

    async getCurrentManagerAssignment(employeeId) {
        return this.request(`/hrms/employee-transfers/${employeeId}/current-manager`);
    }

    // --- Comprehensive Transfers ---
    async getEmployeeFullTransferHistory(employeeId) {
        return this.request(`/hrms/employee-transfers/${employeeId}/full-history`);
    }

    async comprehensiveTransfer(request) {
        return this.request('/hrms/employee-transfers/comprehensive', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    // --- Leave Approval (with all parameter for admin) ---
    async getPendingLeaveApprovalsAll(all = false) {
        const query = all ? '?all=true' : '';
        return this.request(`/hrms/leave/pending-approvals${query}`);
    }

    // --- Regularization Approval (with all parameter for admin) ---
    async getPendingRegularizationsAll(all = false) {
        const query = all ? '?all=true' : '';
        return this.request(`/hrms/attendance/regularization/pending${query}`);
    }

    // --- Overtime Management ---
    async getMyOvertimeRequests() {
        return this.request('/hrms/attendance/overtime/my');
    }

    async createOvertimeRequest(request) {
        return this.request('/hrms/attendance/overtime', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async getPendingOvertimeRequests() {
        return this.request('/hrms/attendance/overtime/pending');
    }

    async getPendingOvertimeRequestsAll(all = false) {
        const query = all ? '?all=true' : '';
        return this.request(`/hrms/attendance/overtime/pending${query}`);
    }

    async approveOvertimeRequest(id) {
        return this.request(`/hrms/attendance/overtime/${id}/approve`, {
            method: 'POST'
        });
    }

    async rejectOvertimeRequest(id, reason) {
        return this.request(`/hrms/attendance/overtime/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
    }

    async completeOvertime(id, actualStartTime, actualEndTime, notes) {
        return this.request(`/hrms/attendance/overtime/${id}/complete`, {
            method: 'POST',
            body: JSON.stringify({
                actual_start_time: actualStartTime,
                actual_end_time: actualEndTime,
                notes
            })
        });
    }

    // --- Location Tax Rules ---
    async getLocationTaxTypes(includeInactive = false) {
        return this.request(`/hrms/location-taxes/types?includeInactive=${includeInactive}`);
    }

    async getLocationTaxType(id) {
        return this.request(`/hrms/location-taxes/types/${id}`);
    }

    async createLocationTaxType(taxType) {
        return this.request('/hrms/location-taxes/types', {
            method: 'POST',
            body: JSON.stringify(taxType)
        });
    }

    async updateLocationTaxType(id, taxType) {
        return this.request(`/hrms/location-taxes/types/${id}`, {
            method: 'PUT',
            body: JSON.stringify(taxType)
        });
    }

    async deleteLocationTaxType(id) {
        return this.request(`/hrms/location-taxes/types/${id}`, {
            method: 'DELETE'
        });
    }

    async getOfficeTaxRules(officeId, includeInactive = false) {
        return this.request(`/hrms/location-taxes/rules/office/${officeId}?includeInactive=${includeInactive}`);
    }

    async createOfficeTaxRule(rule) {
        return this.request('/hrms/location-taxes/rules', {
            method: 'POST',
            body: JSON.stringify(rule)
        });
    }

    async updateOfficeTaxRule(id, rule) {
        return this.request(`/hrms/location-taxes/rules/${id}`, {
            method: 'PUT',
            body: JSON.stringify(rule)
        });
    }

    async deleteOfficeTaxRule(id) {
        return this.request(`/hrms/location-taxes/rules/${id}`, {
            method: 'DELETE'
        });
    }

    async calculateTaxPreview(request) {
        return this.request('/hrms/location-taxes/calculate-preview', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async copyOfficeTaxRules(sourceOfficeId, targetOfficeId) {
        return this.request('/hrms/location-taxes/rules/copy', {
            method: 'POST',
            body: JSON.stringify({
                source_office_id: sourceOfficeId,
                target_office_id: targetOfficeId
            })
        });
    }

    // --- Salary Structure Versioning ---
    async getStructureVersions(structureId) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions`);
    }

    async getStructureVersion(structureId, versionNumber) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions/${versionNumber}`);
    }

    async getStructureVersionById(versionId) {
        return this.request(`/hrms/payroll/structures/versions/${versionId}`);
    }

    async getCurrentStructureVersion(structureId) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions/current`);
    }

    async getEffectiveStructureVersion(structureId, date) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions/effective?date=${date}`);
    }

    async createStructureVersion(structureId, versionData) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions`, {
            method: 'POST',
            body: JSON.stringify(versionData)
        });
    }

    async updateStructureVersion(structureId, versionNumber, versionData) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions/${versionNumber}`, {
            method: 'PUT',
            body: JSON.stringify(versionData)
        });
    }

    async deleteStructureVersion(structureId, versionNumber) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions/${versionNumber}`, {
            method: 'DELETE'
        });
    }

    async activateStructureVersion(structureId, versionNumber) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions/${versionNumber}/activate`, {
            method: 'POST'
        });
    }

    async calculateVersionedSalary(structureId, versionNumber, request) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions/${versionNumber}/calculate`, {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    // --- Version Arrears ---
    async calculateVersionArrears(versionId, autoApply = false) {
        return this.request(`/hrms/payroll/structures/versions/${versionId}/calculate-arrears?autoApply=${autoApply}`, {
            method: 'POST'
        });
    }

    async getPendingArrears(versionId = null) {
        const query = versionId ? `?versionId=${versionId}` : '';
        return this.request(`/hrms/payroll/structures/arrears/pending${query}`);
    }

    async getEmployeeArrears(employeeId) {
        return this.request(`/hrms/payroll/structures/arrears/employee/${employeeId}`);
    }

    async applyArrears(arrearsId) {
        return this.request(`/hrms/payroll/structures/arrears/${arrearsId}/apply`, {
            method: 'POST'
        });
    }

    async cancelArrears(arrearsId) {
        return this.request(`/hrms/payroll/structures/arrears/${arrearsId}/cancel`, {
            method: 'POST'
        });
    }

    // --- Bulk Version Assignment ---
    async bulkAssignVersion(structureId, versionNumber, request) {
        return this.request(`/hrms/payroll/structures/${structureId}/versions/${versionNumber}/bulk-assign`, {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    // --- Version Snapshot & Comparison ---
    async getVersionSnapshot(versionId) {
        return this.request(`/hrms/payroll/structures/versions/${versionId}/snapshot`);
    }

    async compareVersionSnapshots(fromVersionId, toVersionId) {
        return this.request(`/hrms/payroll/structures/versions/compare-snapshots?fromVersionId=${fromVersionId}&toVersionId=${toVersionId}`);
    }

    // --- Report Export ---
    async exportReport(reportType, format, filters = {}) {
        const params = new URLSearchParams(filters);
        params.append('format', format);
        return this.request(`/hrms/reports/export/${reportType}?${params.toString()}`, {
            responseType: format === 'pdf' ? 'blob' : 'text'
        });
    }

    async generateBankFile(runId) {
        return this.request(`/hrms/payroll/runs/${runId}/bank-file`);
    }

    // --- Trend Reports ---
    async getHeadcountTrend(year) {
        return this.request(`/hrms/reports/trends/headcount?year=${year}`);
    }

    async getAttritionTrend(year) {
        return this.request(`/hrms/reports/trends/attrition?year=${year}`);
    }

    async getAttendanceTrend(year, officeId = null) {
        let query = `year=${year}`;
        if (officeId) query += `&officeId=${officeId}`;
        return this.request(`/hrms/reports/trends/attendance?${query}`);
    }

    async getLeaveTrend(year) {
        return this.request(`/hrms/reports/trends/leave?year=${year}`);
    }

    async getPayrollTrend(year) {
        return this.request(`/hrms/reports/trends/payroll?year=${year}`);
    }

    async getCostCenterTrend(year) {
        return this.request(`/hrms/reports/trends/cost-center?year=${year}`);
    }

    // --- Payslip Management ---
    async getPayslipsForRun(runId) {
        return this.request(`/hrms/payroll/runs/${runId}/payslips`);
    }

    async getPayslip(payslipId, includeItems = true) {
        return this.request(`/hrms/payroll/payslips/${payslipId}?includeItems=${includeItems}`);
    }

    async getPayslipByNumber(payslipNumber) {
        return this.request(`/hrms/payroll/payslips/by-number/${payslipNumber}`);
    }

    async finalizePayslip(payslipId) {
        return this.request(`/hrms/payroll/payslips/${payslipId}/finalize`, {
            method: 'POST'
        });
    }

    async deletePayslip(payslipId) {
        return this.request(`/hrms/payroll/payslips/${payslipId}`, {
            method: 'DELETE'
        });
    }

    async downloadPayslip(payslipId) {
        return this.request(`/hrms/payroll/payslips/${payslipId}/download`);
    }
}

// Export singleton instance
const api = new API();
