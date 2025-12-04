// Admin Dashboard JavaScript

// State
let allUsers = [];
let allRoles = [];
let allServices = [];
let currentUserRoles = [];
let adminHubConnection = null;
let showDeactivatedUsers = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    if (!api.isAuthenticated()) {
        window.location.href = '/pages/login.html';
        return;
    }

    // Check if user is SUPERADMIN
    const user = api.getUser();
    if (!user || !user.roles || !user.roles.includes('SUPERADMIN')) {
        showToast('Access denied. SUPERADMIN role required.', 'error');
        setTimeout(() => {
            window.location.href = '/pages/home.html';
        }, 2000);
        return;
    }

    initializeUser();
    await loadAllData();

    // Initialize SignalR for real-time updates
    initializeSignalR();
});

// ==================== SignalR Real-time Updates ====================

function initializeSignalR() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        console.warn('No auth token for SignalR connection');
        return;
    }

    try {
        // Build connection to Admin hub (use endpoints.auth, not authApiBaseUrl which includes /api)
        adminHubConnection = new signalR.HubConnectionBuilder()
            .withUrl(`${CONFIG.endpoints.auth}/hubs/admin`, {
                accessTokenFactory: () => token
            })
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
            .configureLogging(signalR.LogLevel.Information)
            .build();

        // Handle service status changes
        adminHubConnection.on('ServiceStatusChanged', (data) => {
            console.log('Service status changed:', data);
            handleServiceStatusChange(data.serviceName, data.status, data.lastSeen);
        });

        // Handle all services updated
        adminHubConnection.on('AllServicesUpdated', (data) => {
            console.log('All services updated:', data);
            loadServices(); // Refresh services list
        });

        // Handle user updated
        adminHubConnection.on('UserUpdated', (data) => {
            console.log('User updated:', data);
            loadUsers(); // Refresh users list
        });

        // Handle roles updated
        adminHubConnection.on('RolesUpdated', (data) => {
            console.log('Roles updated:', data);
            loadRoles(); // Refresh roles list
        });

        // Connection state handlers
        adminHubConnection.onreconnecting((error) => {
            console.log('SignalR reconnecting...', error);
            showConnectionStatus('reconnecting');
        });

        adminHubConnection.onreconnected((connectionId) => {
            console.log('SignalR reconnected:', connectionId);
            showConnectionStatus('connected');
            showToast('Reconnected to real-time updates', 'success');
        });

        adminHubConnection.onclose((error) => {
            console.log('SignalR connection closed:', error);
            showConnectionStatus('disconnected');
        });

        // Start connection
        startSignalRConnection();
    } catch (error) {
        console.error('Failed to initialize SignalR:', error);
    }
}

async function startSignalRConnection() {
    try {
        await adminHubConnection.start();
        console.log('SignalR connected to Admin hub');
        showConnectionStatus('connected');
    } catch (error) {
        console.error('SignalR connection error:', error);
        showConnectionStatus('disconnected');

        // Retry connection after 5 seconds
        setTimeout(startSignalRConnection, 5000);
    }
}

function showConnectionStatus(status) {
    // Update refresh button to show connection status
    const refreshBtn = document.getElementById('refreshBtn');
    if (!refreshBtn) return;

    if (status === 'connected') {
        refreshBtn.style.borderColor = 'rgba(39, 174, 96, 0.3)';
        refreshBtn.title = 'Connected - Real-time updates active';
    } else if (status === 'reconnecting') {
        refreshBtn.style.borderColor = 'rgba(241, 196, 15, 0.5)';
        refreshBtn.title = 'Reconnecting...';
    } else {
        refreshBtn.style.borderColor = 'rgba(231, 76, 60, 0.3)';
        refreshBtn.title = 'Disconnected - Click to refresh manually';
    }
}

function handleServiceStatusChange(serviceName, newStatus, lastSeen) {
    // Find and update the service card in the UI
    const serviceIndex = allServices.findIndex(s => s.name === serviceName || s.service_name === serviceName);

    if (serviceIndex !== -1) {
        // Update local state
        allServices[serviceIndex].status = newStatus;
        allServices[serviceIndex].last_seen = lastSeen;

        // Re-render services grid
        const grid = document.getElementById('servicesGrid');
        if (grid) {
            grid.innerHTML = allServices.map(service => renderServiceCard(service)).join('');
        }

        // Update summary counts
        const running = allServices.filter(s => s.status === 'running').length;
        const offline = allServices.filter(s => s.status === 'not_connected').length;

        document.getElementById('runningServices').textContent = running;
        document.getElementById('offlineServices').textContent = offline;

        // Show toast notification for status change
        const statusLabel = newStatus === 'running' ? 'online' : 'offline';
        const toastType = newStatus === 'running' ? 'success' : 'error';
        showToast(`${serviceName} is now ${statusLabel}`, toastType);
    } else {
        // Service not in list, reload all services
        loadServices();
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (adminHubConnection) {
        adminHubConnection.stop();
    }
});

function initializeUser() {
    const user = api.getUser();
    if (user) {
        const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'SA';
        document.getElementById('userAvatar').textContent = initials;
        document.getElementById('userDropdownName').textContent = `${user.firstName} ${user.lastName}`;
    }
}

async function loadAllData() {
    await Promise.all([
        loadServices(),
        loadUsers(),
        loadRoles()
    ]);
}

async function refreshAll() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('loading');

    await loadAllData();

    btn.classList.remove('loading');
    showToast('Data refreshed successfully', 'success');
}

// ==================== Services Health ====================

async function loadServices() {
    const grid = document.getElementById('servicesGrid');

    try {
        // Use getAllServices() to get full details including endpoint, ports, description
        const services = await api.getAllServices();
        allServices = services || [];

        // Calculate counts
        const total = allServices.length;
        const running = allServices.filter(s => s.status === 'running').length;
        const offline = allServices.filter(s => s.status === 'not_connected').length;

        // Update summary
        document.getElementById('totalServices').textContent = total;
        document.getElementById('runningServices').textContent = running;
        document.getElementById('offlineServices').textContent = offline;
        document.getElementById('servicesCount').textContent = total;

        // Render services grid
        if (allServices.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                        <line x1="8" y1="21" x2="16" y2="21"/>
                        <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                    <h3>No Services Registered</h3>
                    <p>Services will appear here once they register with the system.</p>
                </div>
            `;
        } else {
            grid.innerHTML = allServices.map(service => renderServiceCard(service)).join('');
        }
    } catch (error) {
        console.error('Failed to load services:', error);
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h3>Failed to Load Services</h3>
                <p>${error.message}</p>
            </div>
        `;
    }
}

function renderServiceCard(service) {
    const statusClass = service.status || 'unknown';
    const statusLabel = {
        'running': 'Running',
        'not_connected': 'Offline',
        'unknown': 'Unknown'
    }[statusClass] || 'Unknown';

    const lastSeen = service.last_seen ? formatRelativeTime(new Date(service.last_seen)) : 'Never';

    return `
        <div class="service-card">
            <div class="service-header">
                <div>
                    <h3 class="service-name">${service.name || 'Unknown Service'}</h3>
                    <p class="service-description">${service.description || 'No description'}</p>
                </div>
                <div class="service-status ${statusClass}">
                    <span class="status-dot"></span>
                    ${statusLabel}
                </div>
            </div>
            <div class="service-details">
                <div class="service-detail">
                    <span class="service-detail-label">Endpoint</span>
                    <span class="service-detail-value">${service.endpoint || '-'}</span>
                </div>
                <div class="service-detail">
                    <span class="service-detail-label">gRPC Port</span>
                    <span class="service-detail-value">${service.grpc_port || '-'}</span>
                </div>
                <div class="service-detail">
                    <span class="service-detail-label">HTTP Port</span>
                    <span class="service-detail-value">${service.http_port || '-'}</span>
                </div>
                <div class="service-detail">
                    <span class="service-detail-label">Last Seen</span>
                    <span class="service-detail-value last-seen">${lastSeen}</span>
                </div>
            </div>
        </div>
    `;
}

// ==================== Users Management ====================

async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');

    try {
        const users = await api.getAllUsersAdmin();
        allUsers = users || [];

        // Show total active users count in tab
        const activeUsers = allUsers.filter(u => u.isActive !== false);
        document.getElementById('usersCount').textContent = activeUsers.length;

        // Update deactivated count badge
        updateDeactivatedCount();

        // Apply current filter and render
        filterUsers();
    } catch (error) {
        console.error('Failed to load users:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <h3>Failed to Load Users</h3>
                        <p>${error.message}</p>
                    </div>
                </td>
            </tr>
        `;
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');

    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                        </svg>
                        <h3>No Users Found</h3>
                        <p>Create a new user to get started.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = users.map(user => {
        const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'U';
        const roles = user.roles || [];
        const isActive = user.isActive !== false;
        const currentUser = api.getUser();
        const isSelf = currentUser && currentUser.userId === user.userId;

        // Smart role display - show first 2 roles, then expandable "more"
        const maxVisibleRoles = 2;
        const visibleRoles = roles.slice(0, maxVisibleRoles);
        const hiddenRoles = roles.slice(maxVisibleRoles);
        const hasMoreRoles = hiddenRoles.length > 0;

        // Escape user name for use in onclick attributes
        const escapedName = `${user.firstName || ''} ${user.lastName || ''}`.replace(/'/g, "\\'");

        return `
            <tr class="${!isActive ? 'deactivated-row' : ''}">
                <td>
                    <div class="user-info">
                        <div class="user-avatar-small">${initials}</div>
                        <div>
                            <div class="user-name">${user.firstName || ''} ${user.lastName || ''}</div>
                            <div class="user-email">${user.email || ''}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="roles-container" id="roles-${user.userId}">
                        ${visibleRoles.map(role => `<span class="role-badge ${getRoleBadgeClass(role)}">${formatRoleName(role)}</span>`).join('')}
                        ${hasMoreRoles ? `
                            <button class="role-badge more-roles expand-btn" id="expand-btn-${user.userId}" onclick="toggleMoreRoles('${user.userId}')">
                                +${hiddenRoles.length} more
                            </button>
                            <span class="hidden-roles" id="hidden-roles-${user.userId}" style="display: none;">
                                ${hiddenRoles.map(role => `<span class="role-badge ${getRoleBadgeClass(role)}">${formatRoleName(role)}</span>`).join('')}
                            </span>
                            <button class="role-badge more-roles collapse-btn" id="collapse-btn-${user.userId}" onclick="toggleMoreRoles('${user.userId}')" style="display: none;">
                                Show less
                            </button>
                        ` : ''}
                    </div>
                </td>
                <td>
                    <span class="status-badge ${isActive ? 'active' : 'inactive'}">
                        <span class="status-dot"></span>
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td class="date-cell">${user.createDate ? formatDate(user.createDate) : '-'}</td>
                <td>
                    <div class="action-buttons">
                        ${isActive ? `
                            <button class="action-btn" onclick="openEditRolesModal('${user.userId}', '${escapedName}', ${JSON.stringify(roles).replace(/"/g, '&quot;')})" title="Manage Roles">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                </svg>
                            </button>
                            <button class="action-btn" onclick="openResetPasswordModal('${user.userId}', '${escapedName}')" title="Reset Password">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                            </button>
                            ${!isSelf ? `
                                <button class="action-btn danger" onclick="openDeleteModal('${user.userId}', '${escapedName}', false)" title="Deactivate">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <line x1="15" y1="9" x2="9" y2="15"/>
                                        <line x1="9" y1="9" x2="15" y2="15"/>
                                    </svg>
                                </button>
                            ` : ''}
                        ` : `
                            <button class="action-btn success" onclick="openReactivateModal('${user.userId}', '${escapedName}')" title="Reactivate">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"/>
                                </svg>
                            </button>
                            <button class="action-btn danger" onclick="openDeleteModal('${user.userId}', '${escapedName}', true)" title="Delete Permanently">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    <line x1="10" y1="11" x2="10" y2="17"/>
                                    <line x1="14" y1="11" x2="14" y2="17"/>
                                </svg>
                            </button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterUsers() {
    const searchTerm = document.getElementById('userSearch').value.toLowerCase();

    const filtered = allUsers.filter(user => {
        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase();
        const email = (user.email || '').toLowerCase();
        const matchesSearch = fullName.includes(searchTerm) || email.includes(searchTerm);

        // Filter by active status based on toggle
        const isActive = user.isActive !== false;
        if (showDeactivatedUsers) {
            // When toggle is ON, show ONLY deactivated users
            if (isActive) return false;
        } else {
            // When toggle is OFF, show ONLY active users
            if (!isActive) return false;
        }

        return matchesSearch;
    });

    renderUsersTable(filtered);
}

function toggleShowDeactivated() {
    showDeactivatedUsers = !showDeactivatedUsers;

    const btn = document.getElementById('toggleDeactivatedBtn');
    const text = document.getElementById('toggleDeactivatedText');

    if (showDeactivatedUsers) {
        btn.classList.add('active');
        text.textContent = 'Hide Deactivated';
    } else {
        btn.classList.remove('active');
        text.textContent = 'Show Deactivated';
    }

    filterUsers();
}

function updateDeactivatedCount() {
    const deactivatedUsers = allUsers.filter(u => u.isActive === false);
    const countEl = document.getElementById('deactivatedCount');
    const count = deactivatedUsers.length;

    if (count > 0) {
        countEl.textContent = count;
        countEl.style.display = 'inline';
    } else {
        countEl.style.display = 'none';
    }
}

function getRoleBadgeClass(role) {
    if (role === 'SUPERADMIN') return 'superadmin';
    if (role.startsWith('VISION_')) return 'vision';
    if (role.startsWith('DRIVE_')) return 'drive';
    return 'default';
}

function formatRoleName(role) {
    // Format role names for display: VISION_USER -> VISION:USER, DRIVE_USER -> DRIVE:USER
    if (role === 'SUPERADMIN') return 'ADMIN';
    // Replace underscore with colon for service-prefixed roles
    if (role.includes('_')) {
        return role.replace('_', ':');
    }
    return role;
}

function toggleMoreRoles(userId) {
    const hiddenRoles = document.getElementById(`hidden-roles-${userId}`);
    const expandBtn = document.getElementById(`expand-btn-${userId}`);
    const collapseBtn = document.getElementById(`collapse-btn-${userId}`);

    if (hiddenRoles.style.display === 'none') {
        // Expand: show hidden roles and "Show less" button, hide "+X more" button
        hiddenRoles.style.display = 'inline';
        expandBtn.style.display = 'none';
        collapseBtn.style.display = 'inline-block';
    } else {
        // Collapse: hide hidden roles and "Show less" button, show "+X more" button
        hiddenRoles.style.display = 'none';
        expandBtn.style.display = 'inline-block';
        collapseBtn.style.display = 'none';
    }
}

// ==================== Roles ====================

async function loadRoles() {
    const grid = document.getElementById('rolesGrid');

    try {
        const roles = await api.getAllRoles();
        allRoles = roles || [];

        document.getElementById('rolesCount').textContent = allRoles.length;

        if (allRoles.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    <h3>No Roles Found</h3>
                    <p>Roles will be created when services register.</p>
                </div>
            `;
        } else {
            // Group roles by service
            const roleGroups = {
                'System': [],
                'Vision': [],
                'Drive': [],
                'Other': []
            };

            allRoles.forEach(role => {
                if (role === 'SUPERADMIN') {
                    roleGroups['System'].push(role);
                } else if (role.startsWith('VISION_')) {
                    roleGroups['Vision'].push(role);
                } else if (role.startsWith('DRIVE_')) {
                    roleGroups['Drive'].push(role);
                } else {
                    roleGroups['Other'].push(role);
                }
            });

            grid.innerHTML = Object.entries(roleGroups)
                .filter(([_, roles]) => roles.length > 0)
                .map(([group, roles]) => `
                    <div class="service-card">
                        <div class="service-header">
                            <h3 class="service-name">${group} Roles</h3>
                            <span class="tab-badge">${roles.length}</span>
                        </div>
                        <div style="margin-top: 16px;">
                            ${roles.map(role => `<span class="role-badge ${getRoleBadgeClass(role)}" style="margin: 4px 4px 4px 0;">${role}</span>`).join('')}
                        </div>
                    </div>
                `).join('');
        }

        // Also update role checkboxes in modals
        updateRoleCheckboxes();
    } catch (error) {
        console.error('Failed to load roles:', error);
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h3>Failed to Load Roles</h3>
                <p>${error.message}</p>
            </div>
        `;
    }
}

function updateRoleCheckboxes() {
    // Role checkboxes removed from Create User modal
    // Roles are assigned separately via Manage Roles after user creation
}

// ==================== Modals ====================

function openCreateUserModal() {
    // Reset form
    document.getElementById('createUserForm').reset();
    openModal('createUserModal');
}

async function createUser() {
    const email = document.getElementById('newUserEmail').value;
    const password = document.getElementById('newUserPassword').value;
    const firstName = document.getElementById('newUserFirstName').value;
    const lastName = document.getElementById('newUserLastName').value;

    if (!email || !password || !firstName || !lastName) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        // Create user without any roles - roles are assigned separately via Manage Roles
        await api.createUserAdmin(email, password, firstName, lastName, []);
        closeModal('createUserModal');
        showToast('User created successfully. Assign roles via Manage Roles.', 'success');
        await loadUsers();
    } catch (error) {
        showToast(error.message || 'Failed to create user', 'error');
    }
}

// Roles modal state
let rolesModalUserId = null;
let expandedServices = new Set(); // Services collapsed by default

function openEditRolesModal(userId, userName, currentRoles) {
    rolesModalUserId = userId;
    document.getElementById('editRolesUserId').value = userId;
    document.getElementById('editRolesUserName').textContent = `Editing roles for: ${userName}`;
    currentUserRoles = currentRoles || [];

    // Reset search
    document.getElementById('rolesSearchInput').value = '';

    // Reset expanded state - all services start collapsed
    expandedServices.clear();

    // Render hierarchical roles
    renderHierarchicalRolesModal();

    openModal('editRolesModal');
}

function getServiceGroups() {
    // Group roles by service
    const groups = {
        'Vision': [],
        'Drive': [],
        'System': []
    };

    allRoles.forEach(role => {
        if (role === 'SUPERADMIN') {
            groups['System'].push(role);
        } else if (role.startsWith('VISION_')) {
            groups['Vision'].push(role);
        } else if (role.startsWith('DRIVE_')) {
            groups['Drive'].push(role);
        }
    });

    return groups;
}

function getServiceToggleState(serviceName, roles) {
    // Returns: 'all' (all roles on), 'partial' (some on), 'none' (all off)
    const assignedCount = roles.filter(r => currentUserRoles.includes(r)).length;
    if (assignedCount === 0) return 'none';
    if (assignedCount === roles.length) return 'all';
    return 'partial';
}

function renderHierarchicalRolesModal() {
    const rolesDiv = document.getElementById('editUserRoles');
    const searchTerm = document.getElementById('rolesSearchInput').value.toLowerCase();
    const groups = getServiceGroups();

    // Update count
    const countEl = document.getElementById('rolesModalCount');
    const totalRoles = allRoles.length;
    const assignedCount = allRoles.filter(r => currentUserRoles.includes(r)).length;
    countEl.textContent = `${totalRoles} roles (${assignedCount} assigned)`;

    let html = '';

    // Render Vision group
    if (groups['Vision'].length > 0) {
        const filteredRoles = searchTerm
            ? groups['Vision'].filter(r => r.toLowerCase().includes(searchTerm))
            : groups['Vision'];

        if (filteredRoles.length > 0 || !searchTerm) {
            html += renderServiceGroup('Vision', filteredRoles.length > 0 ? filteredRoles : groups['Vision']);
        }
    }

    // Render Drive group
    if (groups['Drive'].length > 0) {
        const filteredRoles = searchTerm
            ? groups['Drive'].filter(r => r.toLowerCase().includes(searchTerm))
            : groups['Drive'];

        if (filteredRoles.length > 0 || !searchTerm) {
            html += renderServiceGroup('Drive', filteredRoles.length > 0 ? filteredRoles : groups['Drive']);
        }
    }

    // Render SUPERADMIN as standalone
    if (groups['System'].length > 0) {
        const showSuperAdmin = !searchTerm || 'superadmin'.includes(searchTerm);
        if (showSuperAdmin) {
            const isChecked = currentUserRoles.includes('SUPERADMIN');
            html += `
                <div class="standalone-role">
                    <div class="standalone-role-info">
                        <span class="standalone-role-name">SUPERADMIN</span>
                        <span class="standalone-role-badge">System</span>
                    </div>
                    <label class="toggle-switch-role">
                        <input type="checkbox"
                               value="SUPERADMIN"
                               ${isChecked ? 'checked' : ''}
                               onchange="toggleSingleRole('SUPERADMIN', this)">
                        <span class="toggle-slider-role"></span>
                    </label>
                </div>
            `;
        }
    }

    if (!html) {
        html = '<div class="roles-empty">No roles found</div>';
    }

    rolesDiv.innerHTML = html;
}

function renderServiceGroup(serviceName, roles) {
    const isExpanded = expandedServices.has(serviceName);
    const state = getServiceToggleState(serviceName, roles);
    const isChecked = state !== 'none';
    const isPartial = state === 'partial';
    const assignedCount = roles.filter(r => currentUserRoles.includes(r)).length;

    return `
        <div class="service-role-group ${isExpanded ? 'expanded' : ''}" id="group-${serviceName}">
            <div class="service-role-header" onclick="toggleServiceExpand('${serviceName}')">
                <div class="service-role-header-left">
                    <div class="service-role-expand">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </div>
                    <span class="service-role-name">${serviceName}</span>
                    <span class="service-role-count">${assignedCount}/${roles.length}</span>
                </div>
                <label class="toggle-switch-role ${isPartial ? 'partial' : ''}" onclick="event.stopPropagation()">
                    <input type="checkbox"
                           ${isChecked ? 'checked' : ''}
                           onchange="toggleServiceRoles('${serviceName}', this)">
                    <span class="toggle-slider-role"></span>
                </label>
            </div>
            <div class="service-role-children">
                ${roles.map(role => {
                    const isRoleChecked = currentUserRoles.includes(role);
                    const roleName = role.replace(`${serviceName.toUpperCase()}_`, '');
                    return `
                        <div class="service-role-child ${isRoleChecked ? 'active' : ''}" id="child-${role.replace(/[^a-zA-Z0-9]/g, '_')}">
                            <span class="service-role-child-name">${roleName}</span>
                            <label class="toggle-switch-role">
                                <input type="checkbox"
                                       value="${role}"
                                       ${isRoleChecked ? 'checked' : ''}
                                       onchange="toggleChildRole('${serviceName}', '${role}', this)">
                                <span class="toggle-slider-role"></span>
                            </label>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function toggleServiceExpand(serviceName) {
    const group = document.getElementById(`group-${serviceName}`);
    if (expandedServices.has(serviceName)) {
        expandedServices.delete(serviceName);
        group.classList.remove('expanded');
    } else {
        expandedServices.add(serviceName);
        group.classList.add('expanded');
    }
}

async function toggleServiceRoles(serviceName, checkbox) {
    const isAdding = checkbox.checked;
    const groups = getServiceGroups();
    const roles = groups[serviceName] || [];

    if (roles.length === 0) return;

    const toggleSwitch = checkbox.closest('.toggle-switch-role');
    toggleSwitch.classList.add('loading');
    checkbox.disabled = true;

    try {
        if (isAdding) {
            // Add all roles for this service
            const rolesToAdd = roles.filter(r => !currentUserRoles.includes(r));
            if (rolesToAdd.length > 0) {
                await api.addUserRoles(rolesModalUserId, rolesToAdd);
                rolesToAdd.forEach(r => currentUserRoles.push(r));
            }
            showToast(`All ${serviceName} roles enabled`, 'success');
        } else {
            // Remove all roles for this service
            const rolesToRemove = roles.filter(r => currentUserRoles.includes(r));
            if (rolesToRemove.length > 0) {
                await api.removeUserRoles(rolesModalUserId, rolesToRemove);
                currentUserRoles = currentUserRoles.filter(r => !rolesToRemove.includes(r));
            }
            showToast(`All ${serviceName} roles disabled`, 'success');
        }

        // Update UI without full re-render for smoothness
        updateServiceGroupUI(serviceName, roles);
        updateRolesModalCount();
        loadUsers(); // Refresh user table in background
    } catch (error) {
        checkbox.checked = !isAdding;
        showToast(error.message || 'Failed to update roles', 'error');
    } finally {
        toggleSwitch.classList.remove('loading');
        checkbox.disabled = false;
    }
}

async function toggleChildRole(serviceName, role, checkbox) {
    const isAdding = checkbox.checked;
    const toggleSwitch = checkbox.closest('.toggle-switch-role');
    const childItem = checkbox.closest('.service-role-child');

    toggleSwitch.classList.add('loading');
    checkbox.disabled = true;

    try {
        if (isAdding) {
            await api.addUserRoles(rolesModalUserId, [role]);
            currentUserRoles.push(role);
            childItem.classList.add('active');
        } else {
            await api.removeUserRoles(rolesModalUserId, [role]);
            currentUserRoles = currentUserRoles.filter(r => r !== role);
            childItem.classList.remove('active');
        }

        // Update parent toggle state and count
        const groups = getServiceGroups();
        const roles = groups[serviceName] || [];
        const assignedCount = roles.filter(r => currentUserRoles.includes(r)).length;
        const countEl = document.querySelector(`#group-${serviceName} .service-role-count`);
        if (countEl) countEl.textContent = `${assignedCount}/${roles.length}`;

        updateServiceToggleState(serviceName);
        updateRolesModalCount();
        loadUsers(); // Refresh user table in background
    } catch (error) {
        checkbox.checked = !isAdding;
        if (isAdding) {
            childItem.classList.remove('active');
        } else {
            childItem.classList.add('active');
        }
        showToast(error.message || 'Failed to update role', 'error');
    } finally {
        toggleSwitch.classList.remove('loading');
        checkbox.disabled = false;
    }
}

function updateServiceToggleState(serviceName) {
    const groups = getServiceGroups();
    const roles = groups[serviceName] || [];
    const state = getServiceToggleState(serviceName, roles);

    const group = document.getElementById(`group-${serviceName}`);
    if (!group) return;

    const headerToggle = group.querySelector('.service-role-header .toggle-switch-role');
    const headerCheckbox = headerToggle.querySelector('input');

    if (state === 'none') {
        headerCheckbox.checked = false;
        headerToggle.classList.remove('partial');
    } else if (state === 'all') {
        headerCheckbox.checked = true;
        headerToggle.classList.remove('partial');
    } else {
        headerCheckbox.checked = true;
        headerToggle.classList.add('partial');
    }
}

// Update service group UI without full re-render
function updateServiceGroupUI(serviceName, roles) {
    const group = document.getElementById(`group-${serviceName}`);
    if (!group) return;

    // Update count badge
    const assignedCount = roles.filter(r => currentUserRoles.includes(r)).length;
    const countEl = group.querySelector('.service-role-count');
    if (countEl) countEl.textContent = `${assignedCount}/${roles.length}`;

    // Update parent toggle state
    updateServiceToggleState(serviceName);

    // Update each child toggle and styling
    roles.forEach(role => {
        const isChecked = currentUserRoles.includes(role);
        const safeRoleId = role.replace(/[^a-zA-Z0-9]/g, '_');
        const childItem = document.getElementById(`child-${safeRoleId}`);

        if (childItem) {
            const childCheckbox = childItem.querySelector('input[type="checkbox"]');
            if (childCheckbox) {
                childCheckbox.checked = isChecked;
            }
            if (isChecked) {
                childItem.classList.add('active');
            } else {
                childItem.classList.remove('active');
            }
        }
    });
}

// Update the modal count display
function updateRolesModalCount() {
    const totalAssigned = allRoles.filter(r => currentUserRoles.includes(r)).length;
    const countEl = document.getElementById('rolesModalCount');
    if (countEl) {
        countEl.textContent = `${allRoles.length} roles (${totalAssigned} assigned)`;
    }
}

async function toggleSingleRole(role, checkbox) {
    const isAdding = checkbox.checked;
    const toggleSwitch = checkbox.closest('.toggle-switch-role');

    toggleSwitch.classList.add('loading');
    checkbox.disabled = true;

    try {
        if (isAdding) {
            await api.addUserRoles(rolesModalUserId, [role]);
            currentUserRoles.push(role);
            showToast(`${role} role added`, 'success');
        } else {
            await api.removeUserRoles(rolesModalUserId, [role]);
            currentUserRoles = currentUserRoles.filter(r => r !== role);
            showToast(`${role} role removed`, 'success');
        }

        updateRolesModalCount();
        loadUsers(); // Refresh user table in background
    } catch (error) {
        checkbox.checked = !isAdding;
        showToast(error.message || 'Failed to update role', 'error');
    } finally {
        toggleSwitch.classList.remove('loading');
        checkbox.disabled = false;
    }
}

function filterRolesModal() {
    renderHierarchicalRolesModal();
}

// Keep for backward compatibility with user table
function getRoleServiceName(role) {
    if (role === 'SUPERADMIN') return 'System';
    if (role.startsWith('VISION_')) return 'Vision';
    if (role.startsWith('DRIVE_')) return 'Drive';
    return null;
}

// Legacy function kept for backward compatibility (no longer used)
async function saveUserRoles() {
    closeModal('editRolesModal');
}

function openResetPasswordModal(userId, userName) {
    document.getElementById('resetPasswordUserId').value = userId;
    document.getElementById('resetPasswordUserName').textContent = `Reset password for: ${userName}`;
    document.getElementById('newPassword').value = '';

    openModal('resetPasswordModal');
}

async function resetPassword() {
    const userId = document.getElementById('resetPasswordUserId').value;
    const newPassword = document.getElementById('newPassword').value;

    if (!newPassword) {
        showToast('Please enter a new password', 'error');
        return;
    }

    try {
        await api.resetUserPassword(userId, newPassword);
        closeModal('resetPasswordModal');
        showToast('Password reset successfully', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to reset password', 'error');
    }
}

function openDeleteModal(userId, userName, permanent) {
    document.getElementById('deleteUserId').value = userId;
    document.getElementById('deletePermanent').value = permanent;
    document.getElementById('deleteConfirmMessage').textContent = permanent
        ? `Are you sure you want to permanently delete ${userName}? This action cannot be undone.`
        : `Are you sure you want to deactivate ${userName}? The user will not be able to log in.`;

    openModal('confirmDeleteModal');
}

async function confirmDeleteUser() {
    const userId = document.getElementById('deleteUserId').value;
    const permanent = document.getElementById('deletePermanent').value === 'true';

    try {
        if (permanent) {
            await api.deleteUserPermanently(userId);
        } else {
            await api.deactivateUser(userId);
        }
        closeModal('confirmDeleteModal');
        showToast(permanent ? 'User deleted permanently' : 'User deactivated', 'success');
        await loadUsers();
    } catch (error) {
        showToast(error.message || 'Failed to delete user', 'error');
    }
}

function openReactivateModal(userId, userName) {
    document.getElementById('reactivateUserId').value = userId;
    document.getElementById('reactivateConfirmMessage').textContent = `Are you sure you want to reactivate ${userName}? The user will be able to log in again.`;
    openModal('confirmReactivateModal');
}

async function confirmReactivateUser() {
    const userId = document.getElementById('reactivateUserId').value;

    try {
        await api.reactivateUser(userId);
        closeModal('confirmReactivateModal');
        showToast('User reactivated successfully', 'success');
        await loadUsers();
    } catch (error) {
        showToast(error.message || 'Failed to reactivate user', 'error');
    }
}

// ==================== Tab Navigation ====================

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}Tab`);
    });

    // Clear search input and reset filter when switching to users tab
    if (tabName === 'users') {
        const userSearch = document.getElementById('userSearch');
        if (userSearch) {
            userSearch.value = '';
            filterUsers();
        }
    }
}

// ==================== Modal Helpers ====================

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// ==================== Toast Notifications ====================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${type === 'success'
                ? '<polyline points="20 6 9 17 4 12"/>'
                : type === 'error'
                    ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
                    : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
            }
        </svg>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Display toast for 5 seconds before fading out
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// ==================== Utility Functions ====================

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatRelativeTime(date) {
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });
}

// ==================== User Dropdown ====================

function toggleUserDropdown() {
    const dropdown = document.getElementById('userDropdownMenu');
    dropdown.classList.toggle('show');
}

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('userDropdownMenu');
    const avatar = document.getElementById('userAvatar');
    if (dropdown && avatar && !dropdown.contains(e.target) && !avatar.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});
