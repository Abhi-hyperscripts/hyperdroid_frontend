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
        // HRMS endpoints go to HRMS service (independent microservice)
        if (endpoint.startsWith('/hrms/')) {
            return CONFIG.hrmsApiBaseUrl;
        }
        // Vision endpoints (projects, meetings) go to Vision service
        return CONFIG.visionApiBaseUrl;
    }

    async request(endpoint, options = {}) {
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

    // ==================== HRMS API ====================

    // Self-Service Dashboard
    async getHrmsDashboard() {
        return this.request('/hrms/self-service/dashboard');
    }

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
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${this._getBaseUrl('/hrms/')}/hrms/employees/${employeeId}/documents`, {
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
        return this.request(`/hrms/attendance/my?startDate=${startDate}&endDate=${endDate}`);
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

    async approveRegularization(id, comments = null) {
        return this.request(`/hrms/attendance/regularization/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ comments })
        });
    }

    async rejectRegularization(id, comments = null) {
        return this.request(`/hrms/attendance/regularization/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ comments })
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

    // --- Salary Structures ---
    async getSalaryStructures() {
        return this.request('/hrms/salary-structures');
    }

    async getSalaryStructure(id) {
        return this.request(`/hrms/salary-structures/${id}`);
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
        return this.request(`/hrms/employee-salary/${employeeId}`);
    }

    async assignEmployeeSalary(salaryData) {
        return this.request('/hrms/employee-salary', {
            method: 'POST',
            body: JSON.stringify(salaryData)
        });
    }

    async updateEmployeeSalary(id, salaryData) {
        return this.request(`/hrms/employee-salary/${id}`, {
            method: 'PUT',
            body: JSON.stringify(salaryData)
        });
    }

    async calculateSalaryBreakdown(request) {
        return this.request('/hrms/employee-salary/calculate-breakdown', {
            method: 'POST',
            body: JSON.stringify(request)
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

    async createPayrollRun(request) {
        return this.request('/hrms/payroll/runs', {
            method: 'POST',
            body: JSON.stringify(request)
        });
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
        return this.request(`/hrms/loans${query}`);
    }

    async getLoan(id) {
        return this.request(`/hrms/loans/${id}`);
    }

    async applyLoan(request) {
        return this.request('/hrms/loans', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    async approveLoan(id) {
        return this.request(`/hrms/loans/${id}/approve`, {
            method: 'POST'
        });
    }

    async rejectLoan(id, reason) {
        return this.request(`/hrms/loans/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
    }

    async getMyLoans() {
        return this.request('/hrms/loans/my-loans');
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
}

// Export singleton instance
const api = new API();
