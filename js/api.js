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
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || data.title || 'Request failed');
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

    async getLiveKitToken(meetingId, participantName) {
        return this.request('/meetings/token', {
            method: 'POST',
            body: JSON.stringify({ meeting_id: meetingId, participant_name: participantName })
        });
    }

    async getChatHistory(meetingId, limit = 100) {
        return this.request(`/meetings/${meetingId}/chat?limit=${limit}`);
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
}

// Export singleton instance
const api = new API();
