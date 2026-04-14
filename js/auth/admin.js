// Admin Dashboard JavaScript

// State
let allUsers = [];
let allRoles = [];
let allServices = [];
let currentUserRoles = [];
let adminHubConnection = null;
let showDeactivatedUsers = false;
let licenseData = null;
let allApiKeys = [];
let apiKeyEditMode = false;

// ==================== License-Based Filtering ====================

/**
 * Get licensed services from JWT token (stored in localStorage by config.js)
 * Returns array of service names like ["Authentication", "Chat", "Drive", "Vision"]
 */
function getLicensedServices() {
    const orgInfo = getOrganizationInfo();
    if (orgInfo && orgInfo.licensedServices) {
        return orgInfo.licensedServices;
    }
    // Fallback: return empty array (will show nothing if no license info)
    return [];
}

/**
 * Check if a service name is licensed for the current tenant
 * @param {string} serviceName - Service name to check (e.g., "Vision", "HRMS", "Drive")
 */
function isServiceLicensed(serviceName) {
    const licensed = getLicensedServices();
    // Case-insensitive comparison
    const serviceNameLower = (serviceName || '').toLowerCase();
    return licensed.some(s => (s || '').toLowerCase() === serviceNameLower);
}

/**
 * Filter roles to only include roles for licensed services
 * @param {Array} roles - Array of role names
 * @returns {Array} Filtered roles for licensed services only
 */
function filterRolesByLicense(roles) {
    const licensed = getLicensedServices();
    const licensedLower = licensed.map(s => (s || '').toLowerCase());

    return roles.filter(role => {
        // SUPERADMIN is always allowed
        if (role === 'SUPERADMIN') return true;

        // For prefixed roles (e.g., VISION_USER, HRMS_ADMIN), extract service name
        if (role.includes('_')) {
            const serviceName = role.split('_')[0].toLowerCase();

            // Map role prefixes to service names
            // Most are direct matches, but some might need mapping
            const serviceMapping = {
                'vision': 'vision',
                'drive': 'drive',
                'hrms': 'hrms',
                'chat': 'chat',
                'auth': 'authentication',
                'authentication': 'authentication'
            };

            const mappedService = serviceMapping[serviceName] || serviceName;
            return licensedLower.includes(mappedService);
        }

        // Other roles without prefix - allow by default
        return true;
    });
}

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
    initializeSidebar();
    await loadAllData();

    // Initialize SignalR for real-time updates
    initializeSignalR();
});

// ==================== Sidebar Navigation ====================

function initializeSidebar() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const container = document.querySelector('.admin-container');

    // Sidebar toggle button click
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Overlay click to close sidebar
    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }

    // Sidebar button clicks
    document.querySelectorAll('.sidebar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = btn.dataset.tab;
            if (tab) {
                switchTab(tab);
                // Close sidebar on mobile after tab switch
                if (window.innerWidth <= 992) {
                    closeSidebar();
                }
            }
        });
    });

    // Nav group header clicks (expand/collapse)
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', (e) => {
            const group = header.closest('.nav-group');
            if (group) {
                group.classList.toggle('collapsed');
            }
        });
    });

    // Open sidebar by default on desktop
    if (window.innerWidth > 992) {
        if (sidebar) {
            sidebar.classList.add('open');
        }
        if (container) {
            container.classList.add('sidebar-open');
        }
        if (sidebarToggle) {
            sidebarToggle.classList.add('active');
        }
    }
}

function toggleSidebar() {
    const container = document.querySelector('.admin-container');
    const sidebar = document.getElementById('adminSidebar');
    const toggle = document.getElementById('sidebarToggle');

    if (sidebar) {
        const isOpen = sidebar.classList.toggle('open');

        // Toggle container class for content shifting
        if (container) {
            container.classList.toggle('sidebar-open', isOpen);
        }

        // Toggle button active state (changes hamburger to arrow)
        if (toggle) {
            toggle.classList.toggle('active', isOpen);
        }
    }
}

function closeSidebar() {
    const container = document.querySelector('.admin-container');
    const sidebar = document.getElementById('adminSidebar');
    const toggle = document.getElementById('sidebarToggle');

    if (sidebar) {
        sidebar.classList.remove('open');
    }
    if (container) {
        container.classList.remove('sidebar-open');
    }
    if (toggle) {
        toggle.classList.remove('active');
    }
}

// ==================== SignalR Real-time Updates ====================

function initializeSignalR() {
    const token = getAuthToken();
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
        refreshBtn.style.borderColor = 'var(--success-alpha-30)';
        refreshBtn.title = 'Connected - Real-time updates active';
    } else if (status === 'reconnecting') {
        refreshBtn.style.borderColor = 'var(--warning-transparent-strong)';
        refreshBtn.title = 'Reconnecting...';
    } else {
        refreshBtn.style.borderColor = 'var(--danger-alpha-30)';
        refreshBtn.title = 'Disconnected - Click to refresh manually';
    }
}

function handleServiceStatusChange(serviceName, newStatus, lastSeen) {
    // Check if this service is licensed - if not, ignore the update
    if (!isServiceLicensed(serviceName)) {
        console.log(`[LICENSE] Ignoring status change for unlicensed service: ${serviceName}`);
        return;
    }

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
        // Service not in list, reload all services (will apply license filtering)
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
    // Navigation is now handled by Navigation.init() in navigation.js
}

async function loadAllData() {
    // checkSubTenantsVisibility must run first to set isSaaSPlatformAdmin
    // before loadServices renders cards (which conditionally show infra details)
    await checkSubTenantsVisibility();
    await Promise.all([
        loadServices(),
        loadUsers(),
        loadRoles(),
        loadLicense(),
        loadApiKeys()
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
        const allRegisteredServices = services || [];

        // Filter services by license - only show services that are licensed for this tenant
        allServices = allRegisteredServices.filter(service => {
            const serviceName = service.name || '';
            return isServiceLicensed(serviceName);
        });

        // Log filtered services for debugging
        const licensedList = getLicensedServices();
        console.log('[LICENSE] Licensed services:', licensedList);
        console.log('[LICENSE] Registered services:', allRegisteredServices.map(s => s.name));
        console.log('[LICENSE] Filtered services (shown):', allServices.map(s => s.name));

        // Calculate counts (only for licensed services)
        const total = allServices.length;
        const running = allServices.filter(s => s.status === 'running').length;
        const offline = allServices.filter(s => s.status === 'not_connected').length;

        // Update summary (with null checks for optional elements)
        const totalEl = document.getElementById('totalServices');
        const runningEl = document.getElementById('runningServices');
        const offlineEl = document.getElementById('offlineServices');
        const countEl = document.getElementById('servicesCount');

        if (totalEl) totalEl.textContent = total;
        if (runningEl) runningEl.textContent = running;
        if (offlineEl) offlineEl.textContent = offline;
        if (countEl) countEl.textContent = total;

        // Render services grid
        if (allServices.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                        <line x1="8" y1="21" x2="16" y2="21"/>
                        <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                    <h3>No Licensed Services</h3>
                    <p>No services are licensed for your organization.</p>
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

function getServiceIcon(serviceName) {
    const name = (serviceName || '').toLowerCase();
    const icons = {
        'vision': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
        'drive': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
        'hrms': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        'chat': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
        'authentication': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        'auth': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
    };
    return icons[name] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
}

function renderServiceCard(service) {
    const statusClass = service.status || 'unknown';
    const statusLabel = {
        'running': 'Running',
        'not_connected': 'Offline',
        'unknown': 'Unknown'
    }[statusClass] || 'Unknown';

    const lastSeen = service.last_seen ? formatRelativeTime(new Date(service.last_seen)) : 'Never';
    const serviceIcon = getServiceIcon(service.name);

    // Only show infrastructure details (endpoint, ports) for platform admins
    // Sub-tenant admins only see service name, status, and last seen
    const showInfraDetails = isSaaSPlatformAdmin;

    return `
        <div class="service-card ${statusClass}">
            <div class="service-card-accent"></div>
            <div class="service-card-body">
                <div class="service-header">
                    <div class="service-header-left">
                        <div class="service-icon">
                            ${serviceIcon}
                        </div>
                        <div>
                            <h3 class="service-name">${service.name || 'Unknown Service'}</h3>
                            <p class="service-description">${service.description || 'No description'}</p>
                        </div>
                    </div>
                    <div class="service-status ${statusClass}">
                        <span class="status-dot"></span>
                        ${statusLabel}
                    </div>
                </div>
                <div class="service-details">
                    ${showInfraDetails ? `
                    <div class="service-detail service-detail-full">
                        <span class="service-detail-label">Endpoint</span>
                        <span class="service-detail-value service-detail-endpoint">${service.endpoint || '-'}</span>
                    </div>
                    <div class="service-detail">
                        <span class="service-detail-label">gRPC Port</span>
                        <span class="service-detail-value">${service.grpc_port || '-'}</span>
                    </div>
                    <div class="service-detail">
                        <span class="service-detail-label">HTTP Port</span>
                        <span class="service-detail-value">${service.http_port || '-'}</span>
                    </div>
                    ` : ''}
                    <div class="service-detail">
                        <span class="service-detail-label">Last Seen</span>
                        <span class="service-detail-value last-seen">${lastSeen}</span>
                    </div>
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

        // Show total active users count in tab (with null check)
        const activeUsers = allUsers.filter(u => u.isActive !== false);
        const usersCountEl = document.getElementById('usersCount');
        if (usersCountEl) usersCountEl.textContent = activeUsers.length;

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
                            <button class="action-btn" onclick="openEditUserModal('${user.userId}', '${user.firstName?.replace(/'/g, "\\'")}', '${user.lastName?.replace(/'/g, "\\'")}')" data-tooltip="Edit User">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </button>
                            <button class="action-btn" onclick="openEditRolesModal('${user.userId}', '${escapedName}', ${JSON.stringify(roles).replace(/"/g, '&quot;')})" data-tooltip="Manage Roles">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                </svg>
                            </button>
                            <button class="action-btn" onclick="openResetPasswordModal('${user.userId}', '${escapedName}')" data-tooltip="Reset Password">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                            </button>
                            ${!isSelf ? `
                                <button class="action-btn danger" onclick="openDeleteModal('${user.userId}', '${escapedName}', false)" data-tooltip="Deactivate">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <line x1="15" y1="9" x2="9" y2="15"/>
                                        <line x1="9" y1="9" x2="15" y2="15"/>
                                    </svg>
                                </button>
                            ` : ''}
                        ` : `
                            <button class="action-btn success" onclick="openReactivateModal('${user.userId}', '${escapedName}')" data-tooltip="Reactivate">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"/>
                                </svg>
                            </button>
                            <button class="action-btn danger" onclick="openDeleteModal('${user.userId}', '${escapedName}', true)" data-tooltip="Delete Permanently">
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
    if (role.startsWith('HRMS_')) return 'hrms';
    if (role.startsWith('CHAT_')) return 'chat';
    return 'default';
}

function getRoleCategoryIcon(category) {
    const icons = {
        'System': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
        </svg>`,
        'Vision': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>`,
        'Drive': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>`,
        'Hrms': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
        </svg>`,
        'Chat': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>`,
        'Other': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
        </svg>`
    };
    return icons[category] || icons['Other'];
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
        const allRegisteredRoles = roles || [];

        // Filter roles by license - only show roles for licensed services
        allRoles = filterRolesByLicense(allRegisteredRoles);

        // Log filtered roles for debugging
        console.log('[LICENSE] All registered roles:', allRegisteredRoles);
        console.log('[LICENSE] Filtered roles (shown):', allRoles);

        // Update count with null check for optional element
        const rolesCountEl = document.getElementById('rolesCount');
        if (rolesCountEl) rolesCountEl.textContent = allRoles.length;

        if (allRoles.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    <h3>No Roles Available</h3>
                    <p>No roles available for your licensed services.</p>
                </div>
            `;
        } else {
            // Group roles dynamically by service prefix
            const roleGroups = {
                'System': []
            };

            allRoles.forEach(role => {
                if (role === 'SUPERADMIN') {
                    roleGroups['System'].push(role);
                } else if (role.includes('_')) {
                    // Extract service name from role (e.g., VISION_USER -> Vision)
                    const serviceName = role.split('_')[0];
                    const displayName = serviceName.charAt(0).toUpperCase() + serviceName.slice(1).toLowerCase();
                    if (!roleGroups[displayName]) {
                        roleGroups[displayName] = [];
                    }
                    roleGroups[displayName].push(role);
                } else {
                    // Roles without underscore go to Other
                    if (!roleGroups['Other']) {
                        roleGroups['Other'] = [];
                    }
                    roleGroups['Other'].push(role);
                }
            });

            grid.innerHTML = Object.entries(roleGroups)
                .filter(([_, roles]) => roles.length > 0)
                .map(([group, roles]) => `
                    <div class="role-category-card">
                        <div class="role-category-header">
                            <div class="role-category-icon ${group.toLowerCase()}">${getRoleCategoryIcon(group)}</div>
                            <div class="role-category-info">
                                <h3 class="role-category-name">${group} Roles</h3>
                                <span class="role-category-count">${roles.length} role${roles.length !== 1 ? 's' : ''}</span>
                            </div>
                        </div>
                        <div class="role-badges-container">
                            ${roles.map(role => `<span class="role-badge ${getRoleBadgeClass(role)}">${formatRoleName(role)}</span>`).join('')}
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
    // Reset password strength indicator
    resetPasswordStrength();
    openModal('createUserModal');
}

// Password strength validation
function checkPasswordStrength() {
    const password = document.getElementById('newUserPassword').value;
    const strengthFill = document.getElementById('passwordStrengthFill');
    const strengthText = document.getElementById('passwordStrengthText');

    // Check each requirement
    const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[!@#$%^&*]/.test(password)
    };

    // Update requirement indicators
    updateRequirement('req-length', requirements.length);
    updateRequirement('req-uppercase', requirements.uppercase);
    updateRequirement('req-lowercase', requirements.lowercase);
    updateRequirement('req-number', requirements.number);
    updateRequirement('req-special', requirements.special);

    // Calculate strength score (0-5)
    const score = Object.values(requirements).filter(Boolean).length;

    // Remove all classes
    strengthFill.className = 'password-strength-fill';
    strengthText.className = 'password-strength-text';

    if (password.length === 0) {
        strengthText.textContent = '';
        return;
    }

    // Set strength level
    if (score <= 1) {
        strengthFill.classList.add('weak');
        strengthText.classList.add('weak');
        strengthText.textContent = 'Weak';
    } else if (score <= 2) {
        strengthFill.classList.add('fair');
        strengthText.classList.add('fair');
        strengthText.textContent = 'Fair';
    } else if (score <= 4) {
        strengthFill.classList.add('good');
        strengthText.classList.add('good');
        strengthText.textContent = 'Good';
    } else {
        strengthFill.classList.add('strong');
        strengthText.classList.add('strong');
        strengthText.textContent = 'Strong';
    }
}

function updateRequirement(reqId, isMet) {
    const reqElement = document.getElementById(reqId);
    if (reqElement) {
        if (isMet) {
            reqElement.classList.add('met');
        } else {
            reqElement.classList.remove('met');
        }
    }
}

function resetPasswordStrength() {
    const strengthFill = document.getElementById('passwordStrengthFill');
    const strengthText = document.getElementById('passwordStrengthText');

    if (strengthFill) {
        strengthFill.className = 'password-strength-fill';
    }
    if (strengthText) {
        strengthText.className = 'password-strength-text';
        strengthText.textContent = '';
    }

    // Reset all requirements
    ['req-length', 'req-uppercase', 'req-lowercase', 'req-number', 'req-special'].forEach(reqId => {
        const reqElement = document.getElementById(reqId);
        if (reqElement) {
            reqElement.classList.remove('met');
        }
    });
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
    // Group roles dynamically by service prefix
    const groups = {
        'System': []
    };

    allRoles.forEach(role => {
        if (role === 'SUPERADMIN') {
            groups['System'].push(role);
        } else if (role.includes('_')) {
            // Extract service name from role (e.g., VISION_USER -> Vision)
            const serviceName = role.split('_')[0];
            const displayName = serviceName.charAt(0).toUpperCase() + serviceName.slice(1).toLowerCase();
            if (!groups[displayName]) {
                groups[displayName] = [];
            }
            groups[displayName].push(role);
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

    // Render all service groups dynamically (excluding System which is rendered separately)
    Object.entries(groups).forEach(([groupName, roles]) => {
        if (groupName === 'System') return; // Handle System separately
        if (roles.length === 0) return;

        const filteredRoles = searchTerm
            ? roles.filter(r => r.toLowerCase().includes(searchTerm))
            : roles;

        if (filteredRoles.length > 0 || !searchTerm) {
            html += renderServiceGroup(groupName, filteredRoles.length > 0 ? filteredRoles : roles);
        }
    });

    // Render SUPERADMIN as standalone
    if (groups['System'] && groups['System'].length > 0) {
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

function openEditUserModal(userId, firstName, lastName) {
    document.getElementById('editUserUserId').value = userId;
    document.getElementById('editUserFirstName').value = firstName || '';
    document.getElementById('editUserLastName').value = lastName || '';

    openModal('editUserModal');
}

async function saveEditUser() {
    const userId = document.getElementById('editUserUserId').value;
    const firstName = document.getElementById('editUserFirstName').value.trim();
    const lastName = document.getElementById('editUserLastName').value.trim();

    if (!firstName || !lastName) {
        showToast('Please fill in both first name and last name', 'error');
        return;
    }

    try {
        await api.updateUserAdmin(userId, firstName, lastName);
        closeModal('editUserModal');
        showToast('User updated successfully', 'success');
        await loadUsers();
    } catch (error) {
        showToast(error.message || 'Failed to update user', 'error');
    }
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

    // Update modal title, message, and button text based on action type
    const modalTitle = document.querySelector('#confirmDeleteModal .modal-header h3');
    const confirmBtn = document.querySelector('#confirmDeleteModal .btn-danger');

    if (permanent) {
        modalTitle.textContent = 'Delete User Permanently';
        document.getElementById('deleteConfirmMessage').textContent =
            `Are you sure you want to permanently delete ${userName}? This action cannot be undone.`;
        confirmBtn.textContent = 'Delete Permanently';
    } else {
        modalTitle.textContent = 'Deactivate User';
        document.getElementById('deleteConfirmMessage').textContent =
            `Are you sure you want to deactivate ${userName}? The user will not be able to log in but can be reactivated later.`;
        confirmBtn.textContent = 'Deactivate';
    }

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
    // Tab names for display
    const tabDisplayNames = {
        'services': 'Services',
        'users': 'Users',
        'roles': 'Roles',
        'license': 'License',
        'apikeys': 'API Keys',
        'subtenants': 'Sub-Tenants',
        'profile': 'Company Profile',
        'platform-compliance': 'Platform Compliance'
    };

    // Update sidebar buttons
    document.querySelectorAll('.sidebar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content (tab ID matches data-tab value directly)
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabName);
    });

    // Update active tab title
    const activeTabName = document.getElementById('activeTabName');
    if (activeTabName) {
        activeTabName.textContent = tabDisplayNames[tabName] || tabName;
    }

    // Clear search input and reset filter when switching to users tab
    if (tabName === 'users') {
        const userSearch = document.getElementById('userSearch');
        if (userSearch) {
            userSearch.value = '';
            filterUsers();
        }
    }

    // Load sub-tenants when switching to that tab
    if (tabName === 'subtenants') {
        loadSubTenants();
    }

    // Load tenant profile when switching to that tab
    if (tabName === 'profile') {
        loadTenantProfile();
    }

    // Load platform compliance configs when switching to that tab
    if (tabName === 'platform-compliance' && typeof loadPlatformComplianceConfigs === 'function') {
        loadPlatformComplianceConfigs();
    }
}

// ==================== Tenant Profile ====================
let _tenantProfileSnapshot = null;

async function loadTenantProfile() {
    try {
        const data = await api.getTenantProfile();
        const p = data.profile || {};
        _tenantProfileSnapshot = p;
        applyTenantProfileToForm(p);
    } catch (e) {
        console.error('Failed to load tenant profile:', e);
        if (typeof showToast === 'function') showToast('Failed to load company profile', 'error');
    }
}

function applyTenantProfileToForm(p) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('profileCompanyName',         p.companyName ?? p.company_name);
    set('profileLegalName',           p.legalName ?? p.legal_name);
    set('profileTagline',             p.tagline);
    set('profileAddressLine1',        p.addressLine1 ?? p.address_line1);
    set('profileAddressLine2',        p.addressLine2 ?? p.address_line2);
    set('profileCity',                p.city);
    set('profileState',               p.state);
    set('profilePostalCode',          p.postalCode ?? p.postal_code);
    set('profileCountry',             p.country);
    set('profilePhone',               p.phone);
    set('profileEmail',               p.email);
    set('profileWebsite',             p.website);
    set('profileTaxId',               p.taxId ?? p.tax_id);
    set('profileRegistrationNumber',  p.registrationNumber ?? p.registration_number);
    set('profileBankDetails',         p.bankDetailsJson ?? p.bank_details_json);
    set('profileFooterText',          p.footerText ?? p.footer_text);

    const logoKey = p.logoDriveKey ?? p.logo_drive_key ?? '';
    const sigKey  = p.signatureDriveKey ?? p.signature_drive_key ?? '';
    document.getElementById('profileLogoDriveKey').value = logoKey;
    document.getElementById('profileSignatureDriveKey').value = sigKey;
    renderTenantAssetPreview('logo', logoKey);
    renderTenantAssetPreview('signature', sigKey);
}

function resetTenantProfileForm() {
    if (_tenantProfileSnapshot) applyTenantProfileToForm(_tenantProfileSnapshot);
}

function readTenantProfileForm() {
    const get = (id) => (document.getElementById(id)?.value ?? '').trim() || null;
    return {
        companyName:         get('profileCompanyName'),
        legalName:           get('profileLegalName'),
        tagline:             get('profileTagline'),
        addressLine1:        get('profileAddressLine1'),
        addressLine2:        get('profileAddressLine2'),
        city:                get('profileCity'),
        state:               get('profileState'),
        postalCode:          get('profilePostalCode'),
        country:             get('profileCountry'),
        phone:               get('profilePhone'),
        email:               get('profileEmail'),
        website:             get('profileWebsite'),
        taxId:               get('profileTaxId'),
        registrationNumber:  get('profileRegistrationNumber'),
        bankDetailsJson:     get('profileBankDetails'),
        footerText:          get('profileFooterText'),
        logoDriveKey:        get('profileLogoDriveKey'),
        signatureDriveKey:   get('profileSignatureDriveKey')
    };
}

async function saveTenantProfile() {
    const btn = document.getElementById('profileSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        const payload = readTenantProfileForm();
        // Validate JSON if present
        if (payload.bankDetailsJson) {
            try { JSON.parse(payload.bankDetailsJson); }
            catch (e) {
                if (typeof showToast === 'function') showToast('Bank details must be valid JSON', 'error');
                return;
            }
        }
        const res = await api.updateTenantProfile(payload);
        _tenantProfileSnapshot = res.profile || payload;
        applyTenantProfileToForm(_tenantProfileSnapshot);
        if (typeof showToast === 'function') showToast('Company profile saved', 'success');
    } catch (e) {
        console.error('Failed to save profile:', e);
        if (typeof showToast === 'function') showToast('Failed to save company profile', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
}

// Cache the lazily-created "Tenant Branding" folder ID for the session.
let _brandingFolderIdCache = null;

async function ensureTenantBrandingFolder() {
    if (_brandingFolderIdCache) return _brandingFolderIdCache;
    const FOLDER_NAME = 'Tenant Branding';
    try {
        const list = await api.listFolders(null);
        const folders = list.folders || list || [];
        const found = folders.find(f => (f.name || f.folderName) === FOLDER_NAME);
        if (found) {
            _brandingFolderIdCache = found.id || found.folderId;
            return _brandingFolderIdCache;
        }
    } catch (e) {
        console.warn('listFolders failed, will try to create:', e);
    }
    // Not found — create
    const created = await api.createFolder(FOLDER_NAME, 'Auto-created folder for tenant logo & signature uploads');
    _brandingFolderIdCache = created.id || created.folderId || created.folder?.id;
    if (!_brandingFolderIdCache) throw new Error('Failed to create branding folder');
    return _brandingFolderIdCache;
}

async function uploadTenantProfileAsset(kind, inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;
    try {
        if (typeof showToast === 'function') showToast(`Uploading ${kind}…`, 'info');
        const folderId = await ensureTenantBrandingFolder();
        const result = await api.uploadDriveFileDirect(file, folderId);
        const driveKey = result.s3_key || result.s3Key || result.key || result.fileId || result.file_id;
        if (!driveKey) throw new Error('Upload returned no key');
        const targetId = kind === 'logo' ? 'profileLogoDriveKey' : 'profileSignatureDriveKey';
        document.getElementById(targetId).value = driveKey;
        renderTenantAssetPreview(kind, driveKey, file);
        if (typeof showToast === 'function') showToast(`${kind === 'logo' ? 'Logo' : 'Signature'} uploaded — click Save Changes to persist`, 'success');
    } catch (e) {
        console.error('Asset upload failed:', e);
        if (typeof showToast === 'function') showToast(`Upload failed: ${e.message}`, 'error');
    } finally {
        inputEl.value = '';
    }
}

function clearTenantProfileAsset(kind) {
    const targetId = kind === 'logo' ? 'profileLogoDriveKey' : 'profileSignatureDriveKey';
    document.getElementById(targetId).value = '';
    renderTenantAssetPreview(kind, '');
}

function renderTenantAssetPreview(kind, driveKey, fileObj) {
    const previewId = kind === 'logo' ? 'profileLogoPreview' : 'profileSignaturePreview';
    const clearBtnId = kind === 'logo' ? 'profileLogoClearBtn' : 'profileSignatureClearBtn';
    const previewEl = document.getElementById(previewId);
    const clearBtn = document.getElementById(clearBtnId);
    if (!previewEl) return;

    if (!driveKey && !fileObj) {
        previewEl.innerHTML = `<span class="profile-asset-empty">No ${kind} uploaded</span>`;
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }
    if (clearBtn) clearBtn.style.display = '';

    // If we have the file in hand (fresh upload), show it from a blob URL — instant preview.
    if (fileObj) {
        const url = URL.createObjectURL(fileObj);
        previewEl.innerHTML = `<img src="${url}" alt="${kind}">`;
        return;
    }

    // Otherwise fetch a presigned download URL from Drive (best-effort; degrades to label).
    previewEl.innerHTML = `<span class="profile-asset-empty">${driveKey.split('/').pop()}</span>`;
    (async () => {
        try {
            const dl = await api.getDownloadUrl(driveKey, 60);
            const url = dl.url || dl.downloadUrl || dl.download_url;
            if (url) previewEl.innerHTML = `<img src="${url}" alt="${kind}">`;
        } catch { /* leave label */ }
    })();
}

// ==================== Modal Helpers ====================

function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.add('gm-animating');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('active'));
    });
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.remove('active');
    setTimeout(() => el.classList.remove('gm-animating'), 200);
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        closeModal(e.target.id);
    }
});

// Local showToast removed - using unified toast.js instead

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

// ==================== License Management ====================

async function loadLicense() {
    const statusCard = document.getElementById('licenseStatusCard');
    const servicesGrid = document.getElementById('licenseServicesGrid');
    const noLicenseCard = document.getElementById('licenseNoLicense');

    try {
        const response = await api.getLicenseInfo();

        if (!response || !response.isValid) {
            // No valid license
            if (statusCard) statusCard.style.display = 'none';
            document.querySelector('.license-services-card').style.display = 'none';
            if (noLicenseCard) noLicenseCard.style.display = 'block';
            return;
        }

        licenseData = response;

        // Show license cards, hide no-license message
        if (statusCard) statusCard.style.display = 'block';
        document.querySelector('.license-services-card').style.display = 'block';
        if (noLicenseCard) noLicenseCard.style.display = 'none';

        // Update tenant info
        document.getElementById('licenseTenantName').textContent = response.tenantName || 'Unknown Tenant';
        document.getElementById('licenseTenantId').textContent = response.tenantId || '-';
        document.getElementById('licenseDeploymentType').textContent = formatDeploymentType(response.deploymentType);
        document.getElementById('licenseStartDate').textContent = formatLicenseDate(response.startDate);
        document.getElementById('licenseExpiryDate').textContent = formatLicenseDate(response.expiryDate);
        document.getElementById('licenseMaxUsers').textContent = response.maxUsers === -1 ? 'Unlimited' : (response.maxUsers || '-');

        // Sub-tenants display logic:
        // - On-premise: N/A (sub-tenants not applicable)
        // - SaaS Platform admin (canCreateSubTenants=true): show actual count or Unlimited
        // - SaaS Sub-tenant (canCreateSubTenants=false): show 0 (they can't create sub-tenants)
        const deploymentType = (response.deploymentType || '').toLowerCase();
        if (deploymentType === 'on-premise' || deploymentType === 'on_premise') {
            document.getElementById('licenseMaxSubTenants').textContent = 'N/A';
        } else if (response.canCreateSubTenants === false) {
            document.getElementById('licenseMaxSubTenants').textContent = '0';
        } else {
            document.getElementById('licenseMaxSubTenants').textContent = response.maxSubTenants === -1 ? 'Unlimited' : (response.maxSubTenants || '0');
        }

        // Show Update License button for on-premise and SaaS sub-tenant deployments
        // SaaS Platform licenses require server restart with new key in config
        const updateLicenseBtn = document.getElementById('updateLicenseBtn');
        if (updateLicenseBtn) {
            const isOnPremise = deploymentType === 'on-premise' || deploymentType === 'on_premise';
            // SaaS sub-tenants have canCreateSubTenants=false (only SaaS Platform has it true)
            const isSaaSSubTenant = deploymentType === 'saas' && response.canCreateSubTenants === false;

            if (isOnPremise || isSaaSSubTenant) {
                updateLicenseBtn.style.display = 'inline-flex';
            } else {
                updateLicenseBtn.style.display = 'none';
            }
        }

        // Update badge status
        const badge = document.getElementById('licenseBadge');
        const daysRemaining = calculateDaysRemaining(response.expiryDate);

        if (daysRemaining < 0) {
            badge.textContent = 'Expired';
            badge.className = 'license-badge expired';
        } else if (daysRemaining <= 30) {
            badge.textContent = `Expiring in ${daysRemaining} days`;
            badge.className = 'license-badge expiring';
        } else {
            badge.textContent = 'Active';
            badge.className = 'license-badge active';
        }

        // Update services count badge
        const servicesCountBadge = document.getElementById('servicesCountBadge');
        const serviceCount = response.services?.length || 0;
        if (servicesCountBadge) {
            servicesCountBadge.textContent = `${serviceCount} Service${serviceCount !== 1 ? 's' : ''}`;
        }

        // Render services grid
        if (response.services && response.services.length > 0) {
            servicesGrid.innerHTML = response.services.map(service => renderLicenseServiceCard(service)).join('');
        } else {
            servicesGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                        <line x1="8" y1="21" x2="16" y2="21"/>
                        <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                    <h3>No Services Licensed</h3>
                    <p>This license does not include any services.</p>
                </div>
            `;
        }

    } catch (error) {
        console.error('Failed to load license:', error);
        // Show error state
        if (statusCard) statusCard.style.display = 'none';
        document.querySelector('.license-services-card').style.display = 'none';
        if (noLicenseCard) {
            noLicenseCard.style.display = 'block';
            noLicenseCard.querySelector('h3').textContent = 'Failed to Load License';
            noLicenseCard.querySelector('p').textContent = error.message || 'Unable to retrieve license information.';
        }
    }
}

function renderLicenseServiceCard(service) {
    const permissions = [];
    if (service.read) permissions.push('Read');
    if (service.write) permissions.push('Write');

    // Get service icon
    const serviceIcon = getServiceIcon(service.name);

    return `
        <div class="license-service-item">
            <div class="license-service-header">
                <div class="license-service-header-left">
                    <div class="license-service-icon">${serviceIcon}</div>
                    <span class="license-service-name">${service.name}</span>
                </div>
                <span class="license-service-status active">Enabled</span>
            </div>
            <div class="license-service-details">
                <div class="license-service-detail">
                    <span class="detail-label">Permissions</span>
                    <span class="detail-value">${permissions.join(', ') || 'None'}</span>
                </div>
                ${service.maxUsers !== undefined && service.maxUsers !== null ? `
                    <div class="license-service-detail">
                        <span class="detail-label">Max Users</span>
                        <span class="detail-value">${service.maxUsers === 0 ? 'Unlimited' : service.maxUsers}</span>
                    </div>
                ` : ''}
                ${service.storageLimitBytes ? `
                    <div class="license-service-detail">
                        <span class="detail-label">Storage</span>
                        <span class="detail-value">${formatBytes(service.storageLimitBytes)}</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function formatDeploymentType(type) {
    if (!type) return '-';
    const types = {
        'on-premise': 'On-Premise',
        'saas': 'SaaS (Cloud)',
        'hybrid': 'Hybrid'
    };
    return types[type.toLowerCase()] || type;
}

function formatLicenseDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function calculateDaysRemaining(expiryDate) {
    if (!expiryDate) return -1;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const diff = expiry - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return 'Unlimited';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== License Update ====================

function openUpdateLicenseModal() {
    // Clear previous input
    document.getElementById('newLicenseKey').value = '';
    openModal('updateLicenseModal');
}

async function updateLicense() {
    const licenseKey = document.getElementById('newLicenseKey').value.trim();

    if (!licenseKey) {
        showToast('Please enter a license key', 'error');
        return;
    }

    // Get current tenant ID from loaded license data
    if (!licenseData || !licenseData.tenantId) {
        showToast('Unable to determine tenant ID. Please refresh the page.', 'error');
        return;
    }

    const submitBtn = document.getElementById('updateLicenseSubmitBtn');
    const spinner = document.getElementById('updateLicenseSpinner');

    try {
        // Show loading state
        submitBtn.disabled = true;
        spinner.style.display = 'inline-block';

        const response = await api.updateLicense(licenseData.tenantId, licenseKey);

        if (response.success) {
            showToast('License updated successfully', 'success');
            closeModal('updateLicenseModal');

            // Reload license info to show updated data
            await loadLicense();
        } else {
            showToast(response.message || 'Failed to update license', 'error');
        }
    } catch (error) {
        console.error('Error updating license:', error);
        showToast(error.message || 'Failed to update license', 'error');
    } finally {
        // Reset loading state
        submitBtn.disabled = false;
        spinner.style.display = 'none';
    }
}

// ==================== User Dropdown ====================
// Handled by navigation.js

// ==================== Sub-Tenants Management ====================

let subTenantsData = null;
let isSaaSPlatformAdmin = false;

// ==================== API Keys Management ====================

// Per-tenant per-service copilot toggle state, loaded alongside API keys.
// Fallback list mirrors the Auth controller's CopilotCapableServices so the
// expandable panel still renders something useful while the Auth backend is
// still deploying or transiently unreachable.
const COPILOT_SERVICES_FALLBACK = [
    { serviceName: 'PMS',         displayName: 'Project Management',              enabled: true },
    { serviceName: 'HRMS',        displayName: 'HR Management',                   enabled: true },
    { serviceName: 'CRM',         displayName: 'Customer Relations',              enabled: true },
    { serviceName: 'Accounts',    displayName: 'Accounts & Finance',              enabled: true },
    { serviceName: 'LMS',         displayName: 'Learning Management',             enabled: true },
    { serviceName: 'Procurement', displayName: 'Procurement',                     enabled: true },
    { serviceName: 'Drive',       displayName: 'File Storage (Drive)',            enabled: true },
    { serviceName: 'Vision',      displayName: 'Meetings & Transcripts (Vision)', enabled: true },
    { serviceName: 'Research',    displayName: 'Market Research',                 enabled: true }
];
let copilotSettings = { hasLlmApiKey: false, services: COPILOT_SERVICES_FALLBACK.slice() };

async function loadCopilotSettings() {
    try {
        const data = await api.getCopilotSettings();
        const services = data.services || [];
        copilotSettings = {
            hasLlmApiKey: data.hasLlmApiKey ?? data.has_llm_api_key ?? false,
            // If Auth returns an empty services array (e.g., during a partial deploy), keep the
            // fallback so the UI is never blank. Real toggle state still wins when present.
            services: services.length > 0 ? services : COPILOT_SERVICES_FALLBACK.slice()
        };
    } catch (e) {
        console.warn('Failed to load copilot settings (using fallback list):', e);
        copilotSettings = { hasLlmApiKey: false, services: COPILOT_SERVICES_FALLBACK.slice() };
    }
}

async function loadApiKeys() {
    const tbody = document.getElementById('apiKeysTableBody');
    if (!tbody) return;

    try {
        // Load API keys and copilot toggle state in parallel
        const [response] = await Promise.all([
            api.getApiKeys(),
            loadCopilotSettings()
        ]);
        allApiKeys = response.keys || response || [];
        filterApiKeys();
    } catch (error) {
        console.error('Failed to load API keys:', error);
        allApiKeys = [];
        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <h3>Failed to Load API Keys</h3>
                        <p>${error.message}</p>
                    </div>
                </td>
            </tr>
        `;
    }
}

function filterApiKeys() {
    const searchInput = document.getElementById('apiKeySearch');
    const searchTerm = (searchInput ? searchInput.value : '').toLowerCase();

    const filtered = allApiKeys.filter(key => {
        const provider = (key.provider || '').toLowerCase();
        const serviceType = (key.serviceType || key.service_type || '').toLowerCase();
        return provider.includes(searchTerm) || serviceType.includes(searchTerm);
    });

    renderApiKeysTable(filtered);
}

function renderApiKeysTable(keys) {
    const tbody = document.getElementById('apiKeysTableBody');
    if (!tbody) return;

    if (keys.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        <h3>No API Keys</h3>
                        <p>Add an API key for your AI service providers.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const llmProviders = new Set(['anthropic', 'openai']);

    tbody.innerHTML = keys.map((key, idx) => {
        const provider = key.provider || '';
        const serviceType = key.serviceType || key.service_type || '';
        const displayHint = key.displayHint || key.display_hint || '****';
        const isActive = key.isActive !== undefined ? key.isActive : (key.is_active !== undefined ? key.is_active : true);
        const createdAt = key.createdAt || key.created_at;
        const createdDate = createdAt ? formatDate(createdAt) : '-';

        const escapedProvider = provider.replace(/'/g, "\\'");
        const escapedServiceType = serviceType.replace(/'/g, "\\'");

        // Show the expandable copilot row only when this is an active LLM provider
        const isLlmRow = isActive && llmProviders.has(provider.toLowerCase()) && (serviceType.toLowerCase() === 'llm');
        const rowId = `apikey-row-${idx}`;
        const expandToggleHtml = isLlmRow
            ? `<button class="action-btn copilot-expand-btn" data-tooltip="Configure Copilot" data-row-id="${rowId}" onclick="toggleCopilotExpand('${rowId}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>`
            : '';

        const mainRow = `
            <tr>
                <td>
                    <div class="apikey-provider">
                        <span class="apikey-provider-icon">${getProviderIcon(provider)}</span>
                        <span class="apikey-provider-name">${provider}</span>
                    </div>
                </td>
                <td>
                    <span class="apikey-service-badge ${serviceType.toLowerCase()}">${formatServiceType(serviceType)}</span>
                </td>
                <td>
                    <code class="apikey-hint">${displayHint}</code>
                </td>
                <td>
                    <span class="status-badge ${isActive ? 'active' : 'inactive'}">
                        <span class="status-dot"></span>
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td class="date-cell">${createdDate}</td>
                <td>
                    <div class="action-buttons">
                        ${expandToggleHtml}
                        <button class="action-btn" data-tooltip="${isActive ? 'Deactivate' : 'Activate'}" onclick="toggleApiKeyStatus('${escapedProvider}', '${escapedServiceType}', ${!isActive})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                ${isActive
                                    ? '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>'
                                    : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
                            </svg>
                        </button>
                        <button class="action-btn" data-tooltip="Rotate Key" onclick="openEditApiKeyModal('${escapedProvider}', '${escapedServiceType}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="23 4 23 10 17 10"/>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                        </button>
                        <button class="action-btn danger" data-tooltip="Delete" onclick="openDeleteApiKeyModal('${escapedProvider}', '${escapedServiceType}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;

        // Hidden expandable child row with per-service copilot toggles
        let copilotRow = '';
        if (isLlmRow) {
            const services = copilotSettings.services || [];
            const togglesHtml = services.map(s => {
                const svcName = (s.serviceName || s.service_name || '').replace(/'/g, "\\'");
                const display = s.displayName || s.display_name || svcName;
                const enabled = s.enabled === true;
                return `
                    <div class="copilot-toggle-row">
                        <div class="copilot-toggle-meta">
                            <div class="copilot-toggle-name">${display}</div>
                            <div class="copilot-toggle-sub">${svcName}</div>
                        </div>
                        <label class="copilot-switch">
                            <input type="checkbox" ${enabled ? 'checked' : ''}
                                onchange="toggleCopilotService('${svcName}', this.checked, this)">
                            <span class="copilot-switch-slider"></span>
                        </label>
                    </div>
                `;
            }).join('');

            copilotRow = `
                <tr class="copilot-expand-row" id="${rowId}-expand" style="display:none;">
                    <td colspan="6">
                        <div class="copilot-expand-panel">
                            <div class="copilot-expand-header">
                                <div>
                                    <div class="copilot-expand-title">RaZer Copilot — per-service control</div>
                                    <div class="copilot-expand-sub">Enable or disable the AI assistant for individual backends. Disabled services will not load the chat widget for any user in this tenant.</div>
                                </div>
                            </div>
                            <div class="copilot-toggle-list">
                                ${togglesHtml || '<div class="copilot-empty">No copilot-capable services available.</div>'}
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }

        return mainRow + copilotRow;
    }).join('');
}

function toggleCopilotExpand(rowId) {
    const row = document.getElementById(`${rowId}-expand`);
    if (!row) return;
    const isHidden = row.style.display === 'none' || !row.style.display;
    row.style.display = isHidden ? 'table-row' : 'none';
    // Rotate the chevron
    const btn = document.querySelector(`button.copilot-expand-btn[data-row-id="${rowId}"] svg`);
    if (btn) btn.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

async function toggleCopilotService(serviceName, enabled, inputEl) {
    try {
        await api.setCopilotServiceEnabled(serviceName, enabled);
        // Update local state
        const svc = copilotSettings.services.find(s => (s.serviceName || s.service_name) === serviceName);
        if (svc) svc.enabled = enabled;
        if (typeof showToast === 'function') {
            showToast(`Copilot ${enabled ? 'enabled' : 'disabled'} for ${serviceName}`, 'success');
        }
    } catch (e) {
        console.error('Failed to toggle copilot service:', e);
        // Revert UI
        if (inputEl) inputEl.checked = !enabled;
        if (typeof showToast === 'function') {
            showToast(`Failed to update copilot setting for ${serviceName}`, 'error');
        }
    }
}

function openAddApiKeyModal() {
    apiKeyEditMode = false;
    document.getElementById('apiKeyModalTitle').textContent = 'Add API Key';
    document.getElementById('apiKeyProvider').value = '';
    document.getElementById('apiKeyProvider').disabled = false;
    document.getElementById('apiKeyServiceType').value = '';
    document.getElementById('apiKeyServiceType').disabled = false;
    document.getElementById('apiKeyValue').value = '';
    document.getElementById('apiKeyValue').type = 'password';
    // Reset Razorpay-specific fields
    const rpKeyId = document.getElementById('razorpayKeyId');
    const rpKeySecret = document.getElementById('razorpayKeySecret');
    const rpWebhook = document.getElementById('razorpayWebhookSecret');
    if (rpKeyId) rpKeyId.value = '';
    if (rpKeySecret) { rpKeySecret.value = ''; rpKeySecret.type = 'password'; }
    if (rpWebhook) { rpWebhook.value = ''; rpWebhook.type = 'password'; }
    onApiKeyProviderChange();
    document.getElementById('apiKeySaveBtn').textContent = 'Save';
    openModal('apiKeyModal');
}

/**
 * Swap the form UI between the default single-value key input and the
 * Razorpay-specific 3-field block (key_id + key_secret + webhook_secret).
 * Razorpay stores all three values as a JSON blob in the single api_key
 * column of the tenant_api_keys table so Auth itself needs no changes.
 */
function onApiKeyProviderChange() {
    const provider = document.getElementById('apiKeyProvider').value;
    const isRazorpay = provider === 'Razorpay';
    const singleGroup = document.getElementById('apiKeySingleGroup');
    const razorpayGroup = document.getElementById('apiKeyRazorpayGroup');
    const serviceTypeSelect = document.getElementById('apiKeyServiceType');

    if (singleGroup) singleGroup.style.display = isRazorpay ? 'none' : '';
    if (razorpayGroup) razorpayGroup.style.display = isRazorpay ? '' : 'none';

    // For Razorpay, force service type to payment_gateway and lock it
    if (isRazorpay && serviceTypeSelect) {
        serviceTypeSelect.value = 'payment_gateway';
        serviceTypeSelect.disabled = true;
    } else if (!apiKeyEditMode && serviceTypeSelect) {
        serviceTypeSelect.disabled = false;
    }
}

/** Toggle visibility of a specific password-type input by id. */
function toggleFieldVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
}

function openEditApiKeyModal(provider, serviceType) {
    apiKeyEditMode = true;
    document.getElementById('apiKeyModalTitle').textContent = 'Rotate API Key';
    // Match provider option case-insensitively
    const providerSelect = document.getElementById('apiKeyProvider');
    const providerLower = provider.toLowerCase();
    for (const opt of providerSelect.options) {
        if (opt.value.toLowerCase() === providerLower) {
            providerSelect.value = opt.value;
            break;
        }
    }
    providerSelect.disabled = true;
    document.getElementById('apiKeyServiceType').value = serviceType;
    document.getElementById('apiKeyServiceType').disabled = true;
    document.getElementById('apiKeyValue').value = '';
    document.getElementById('apiKeyValue').type = 'password';
    document.getElementById('apiKeyValue').placeholder = 'Enter new API key...';
    document.getElementById('apiKeySaveBtn').textContent = 'Update Key';
    openModal('apiKeyModal');
}

async function saveApiKey() {
    const provider = document.getElementById('apiKeyProvider').value;
    const serviceType = document.getElementById('apiKeyServiceType').value;

    // Razorpay stores all 3 credential fields as a JSON blob in the single
    // api_key column. Other providers use the plain single-value input.
    let apiKeyVal;
    if (provider === 'Razorpay') {
        const keyId = document.getElementById('razorpayKeyId').value.trim();
        const keySecret = document.getElementById('razorpayKeySecret').value;
        const webhookSecret = document.getElementById('razorpayWebhookSecret').value;
        if (!keyId || !keySecret) {
            showToast('Razorpay requires Key ID and Key Secret', 'error');
            return;
        }
        apiKeyVal = JSON.stringify({
            key_id: keyId,
            key_secret: keySecret,
            webhook_secret: webhookSecret || ''
        });
    } else {
        apiKeyVal = document.getElementById('apiKeyValue').value;
    }

    if (!provider || !serviceType || !apiKeyVal) {
        showToast('Please fill in all fields', 'error');
        return;
    }

    const btn = document.getElementById('apiKeySaveBtn');
    btn.disabled = true;
    btn.textContent = apiKeyEditMode ? 'Updating...' : 'Saving...';

    try {
        if (apiKeyEditMode) {
            await api.updateApiKey(provider, serviceType, { apiKey: apiKeyVal });
            showToast(`API key for ${provider}/${formatServiceType(serviceType)} rotated successfully`, 'success');
        } else {
            await api.saveApiKey(provider, serviceType, apiKeyVal);
            showToast(`API key for ${provider}/${formatServiceType(serviceType)} added successfully`, 'success');
        }
        closeModal('apiKeyModal');
        await loadApiKeys();
    } catch (error) {
        showToast(error.message || 'Failed to save API key', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = apiKeyEditMode ? 'Update Key' : 'Save';
    }
}

function toggleApiKeyStatus(provider, serviceType, isActive) {
    document.getElementById('toggleApiKeyProvider').value = provider;
    document.getElementById('toggleApiKeyServiceType').value = serviceType;
    document.getElementById('toggleApiKeyNewState').value = isActive;
    document.getElementById('toggleApiKeyModalTitle').textContent = isActive ? 'Activate API Key' : 'Deactivate API Key';
    document.getElementById('toggleApiKeyMessage').textContent =
        `Are you sure you want to ${isActive ? 'activate' : 'deactivate'} the ${provider} / ${formatServiceType(serviceType)} API key?`;
    const confirmBtn = document.getElementById('confirmToggleApiKeyBtn');
    confirmBtn.className = isActive ? 'btn btn-primary' : 'btn btn-danger';
    confirmBtn.textContent = isActive ? 'Activate' : 'Deactivate';
    openModal('confirmToggleApiKeyModal');
}

async function confirmToggleApiKey() {
    const provider = document.getElementById('toggleApiKeyProvider').value;
    const serviceType = document.getElementById('toggleApiKeyServiceType').value;
    const isActive = document.getElementById('toggleApiKeyNewState').value === 'true';
    try {
        await api.updateApiKey(provider, serviceType, { isActive });
        closeModal('confirmToggleApiKeyModal');
        showToast(`API key ${isActive ? 'activated' : 'deactivated'}`, 'success');
        await loadApiKeys();
    } catch (error) {
        closeModal('confirmToggleApiKeyModal');
        showToast(error.message || 'Failed to update API key status', 'error');
    }
}

function openDeleteApiKeyModal(provider, serviceType) {
    document.getElementById('deleteApiKeyProvider').value = provider;
    document.getElementById('deleteApiKeyServiceType').value = serviceType;
    document.getElementById('deleteApiKeyMessage').textContent =
        `Are you sure you want to delete the ${provider} / ${formatServiceType(serviceType)} API key? This action cannot be undone.`;
    openModal('confirmDeleteApiKeyModal');
}

async function confirmDeleteApiKey() {
    const provider = document.getElementById('deleteApiKeyProvider').value;
    const serviceType = document.getElementById('deleteApiKeyServiceType').value;

    try {
        await api.deleteApiKey(provider, serviceType);
        showToast(`API key for ${provider}/${formatServiceType(serviceType)} deleted`, 'success');
        closeModal('confirmDeleteApiKeyModal');
        await loadApiKeys();
    } catch (error) {
        showToast(error.message || 'Failed to delete API key', 'error');
    }
}

function toggleApiKeyVisibility() {
    const input = document.getElementById('apiKeyValue');
    const icon = document.getElementById('apiKeyEyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
        input.type = 'password';
        icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
}

function getProviderIcon(provider) {
    const name = (provider || '').toLowerCase();
    const icons = {
        'deepgram': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
        'anthropic': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2L2 19h20L12 2z"/></svg>',
        'openai': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>',
        'google': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
        'azure': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M2 20L10 4l4 12 6-4-18 8z"/></svg>'
    };
    return icons[name] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
}

function formatServiceType(type) {
    const typeMap = {
        'stt': 'STT',
        'llm': 'LLM',
        'tts': 'TTS',
        'vision': 'Vision',
        'embedding': 'Embedding'
    };
    return typeMap[(type || '').toLowerCase()] || type;
}

// ==================== Sub-Tenants Management ====================

async function checkSubTenantsVisibility() {
    // Check if we should show platform-only tabs.
    // Only visible to SaaS platform admin (not sub-tenant admins):
    //   - Sub-Tenants
    //   - Platform Compliance (country-pack fan-out)
    const subtenantsTab = document.getElementById('subtenantsSidebarTab');
    const platformComplianceTab = document.getElementById('platformComplianceSidebarTab');

    const showPlatformOnly = (visible) => {
        const action = visible ? 'remove' : 'add';
        if (subtenantsTab) subtenantsTab.classList[action]('hidden-tab');
        if (platformComplianceTab) platformComplianceTab.classList[action]('hidden-tab');
    };

    try {
        const response = await api.getSubTenants();

        if (response && response.success && response.isSaaSPlatform) {
            showPlatformOnly(true);
            isSaaSPlatformAdmin = true;
            subTenantsData = response;
        } else {
            showPlatformOnly(false);
            isSaaSPlatformAdmin = false;
        }
    } catch (error) {
        console.log('Not a SaaS platform admin or error checking sub-tenants:', error.message);
        showPlatformOnly(false);
        isSaaSPlatformAdmin = false;
    }
}

async function loadSubTenants() {
    const tableBody = document.getElementById('subtenantsTableBody');
    const notSaaSCard = document.getElementById('subtenantsNotSaaS');
    const tableContainer = document.querySelector('.subtenants-table-container');
    const summarySection = document.querySelector('.subtenants-summary');

    try {
        // If we already have data from visibility check, use it
        if (!subTenantsData) {
            const response = await api.getSubTenants();
            subTenantsData = response;
        }

        if (!subTenantsData || !subTenantsData.success) {
            // Show not SaaS or unauthorized message
            if (tableContainer) tableContainer.style.display = 'none';
            if (summarySection) summarySection.style.display = 'none';
            if (notSaaSCard) {
                notSaaSCard.style.display = 'block';
                notSaaSCard.querySelector('h3').textContent = 'Access Denied';
                notSaaSCard.querySelector('p').textContent = subTenantsData?.message || 'Sub-tenants are only visible to SaaS platform administrators.';
            }
            return;
        }

        // Show table and summary
        if (tableContainer) tableContainer.style.display = 'block';
        if (summarySection) summarySection.style.display = 'flex';
        if (notSaaSCard) notSaaSCard.style.display = 'none';

        const subTenants = subTenantsData.subTenants || [];

        // Update summary stats
        const total = subTenants.length;
        const active = subTenants.filter(t => t.isActive && !t.isExpired).length;
        const expired = subTenants.filter(t => t.isExpired).length;

        const totalEl = document.getElementById('totalSubtenants');
        const activeEl = document.getElementById('activeSubtenants');
        const expiredEl = document.getElementById('expiredSubtenants');

        if (totalEl) totalEl.textContent = total;
        if (activeEl) activeEl.textContent = active;
        if (expiredEl) expiredEl.textContent = expired;

        // Render table
        if (subTenants.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state" style="padding: 40px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 48px; height: 48px; margin-bottom: 16px; color: var(--text-muted);">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                <circle cx="9" cy="7" r="4"/>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                            </svg>
                            <h3 style="margin: 0 0 8px; color: var(--text-primary);">No Sub-Tenants Yet</h3>
                            <p style="color: var(--text-secondary); margin: 0;">Sub-tenants will appear here once they activate their licenses.</p>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            tableBody.innerHTML = subTenants.map(tenant => renderSubTenantRow(tenant)).join('');
        }

    } catch (error) {
        console.error('Failed to load sub-tenants:', error);

        if (tableContainer) tableContainer.style.display = 'none';
        if (summarySection) summarySection.style.display = 'none';
        if (notSaaSCard) {
            notSaaSCard.style.display = 'block';
            notSaaSCard.querySelector('h3').textContent = 'Error Loading Sub-Tenants';
            notSaaSCard.querySelector('p').textContent = error.message || 'Failed to retrieve sub-tenant information.';
        }
    }
}

function renderSubTenantRow(tenant) {
    // Format dates
    const startDate = tenant.startDate ? formatDate(tenant.startDate) : '-';
    const expiryDate = tenant.expiryDate ? formatDate(tenant.expiryDate) : '-';

    // Determine status
    let statusClass = 'active';
    let statusText = 'Active';

    if (!tenant.isActive) {
        statusClass = 'inactive';
        statusText = 'Inactive';
    } else if (tenant.isExpired) {
        statusClass = 'expired';
        statusText = 'Expired';
    } else if (tenant.daysUntilExpiry <= 30) {
        statusClass = 'expiring-soon';
        statusText = 'Expiring Soon';
    }

    // Format services
    const servicesHtml = (tenant.services || []).slice(0, 3).map(
        s => `<span class="subtenant-service-badge">${s}</span>`
    ).join('');
    const moreServices = (tenant.services || []).length > 3
        ? `<span class="subtenant-service-badge">+${tenant.services.length - 3}</span>`
        : '';

    const tid = tenant.tenantId;

    return `
        <tr style="cursor:pointer;" onclick="toggleSubTenantDetails('${tid}')">
            <td>
                <div class="subtenant-org">
                    <span class="subtenant-org-name">${tenant.organizationName || tenant.tenantName}</span>
                    ${tenant.organizationName ? `<span class="subtenant-tenant-name">${tenant.tenantName}</span>` : ''}
                </div>
            </td>
            <td>
                <span class="subtenant-admin-email">${tenant.superAdminEmail || '-'}</span>
            </td>
            <td>
                <div class="subtenant-users">
                    <span class="subtenant-users-count">${tenant.currentUsers}</span>
                    <span class="subtenant-users-limit">/ ${tenant.maxUsers === -1 ? '∞' : tenant.maxUsers}</span>
                </div>
            </td>
            <td>
                <div class="subtenant-services">
                    ${servicesHtml}${moreServices}
                </div>
            </td>
            <td>
                <span class="subtenant-date">${startDate}</span>
            </td>
            <td>
                <div>
                    <span class="subtenant-date">${expiryDate}</span>
                    ${tenant.daysUntilExpiry > 0 ? `<div class="days-until-expiry">${tenant.daysUntilExpiry} days left</div>` : ''}
                </div>
            </td>
            <td>
                <span class="subtenant-status ${statusClass}">
                    <span class="status-dot"></span>
                    ${statusText}
                </span>
            </td>
        </tr>
        <tr id="subtenant-details-${tid}" style="display:none;">
            <td colspan="7" style="padding:0;">
                <div id="subtenant-details-content-${tid}" style="padding:16px 20px;background:var(--bg-secondary);border-top:1px solid var(--border-primary);">
                    <span style="color:var(--text-secondary);font-size:12px;">Loading...</span>
                </div>
            </td>
        </tr>
    `;
}

async function toggleSubTenantDetails(tenantId) {
    const detailsRow = document.getElementById(`subtenant-details-${tenantId}`);
    if (!detailsRow) return;

    if (detailsRow.style.display === 'none') {
        detailsRow.style.display = '';
        const contentDiv = document.getElementById(`subtenant-details-content-${tenantId}`);

        try {
            const data = await api.getTenantInfo(tenantId);
            const lic = data?.tenant?.license;
            if (!lic || !lic.services) {
                contentDiv.innerHTML = '<span style="color:var(--text-secondary);font-size:12px;">No license details available</span>';
                return;
            }

            const formatBytes = (bytes) => {
                if (!bytes) return 'Unlimited';
                if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
                if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
                return bytes + ' bytes';
            };

            let html = '<div style="display:flex;gap:16px;flex-wrap:wrap;">';
            for (const svc of lic.services) {
                const features = svc.enabledFeatures || [];
                const hasStorage = svc.storageLimitBytes != null;
                const hasCustom = svc.customLimits && Object.keys(svc.customLimits).length > 0;
                const hasFeatures = features.length > 0;

                html += `<div style="flex:1;min-width:200px;padding:12px;border:1px solid var(--border-primary);border-radius:8px;background:var(--bg-tertiary);">`;
                html += `<div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--text-primary);">${svc.name}</div>`;

                if (hasFeatures) {
                    html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;font-weight:600;">Features</div>`;
                    html += features.map(f => {
                        const icon = f === 'recording' ? '🎥' : f === 'captions' ? '💬' : f === 'screen_sharing' ? '🖥' : f === 'sharing' ? '🔗' : f === 'chunked_upload' ? '📦' : '✓';
                        return `<span style="display:inline-block;font-size:11px;padding:2px 8px;margin:2px;border-radius:4px;background:var(--bg-primary);color:var(--color-success);">${icon} ${f}</span>`;
                    }).join('');
                }

                if (hasStorage || hasCustom) {
                    html += `<div style="font-size:11px;color:var(--text-secondary);margin-top:8px;margin-bottom:4px;font-weight:600;">Limits</div>`;
                    if (hasStorage) {
                        html += `<div style="font-size:12px;color:var(--text-primary);">Storage: <strong>${formatBytes(svc.storageLimitBytes)}</strong></div>`;
                    }
                    if (hasCustom) {
                        for (const [k, v] of Object.entries(svc.customLimits)) {
                            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            html += `<div style="font-size:12px;color:var(--text-primary);">${label}: <strong>${v}</strong></div>`;
                        }
                    }
                }

                if (!hasFeatures && !hasStorage && !hasCustom) {
                    html += `<span style="font-size:11px;color:var(--text-secondary);">No restrictions</span>`;
                }

                html += '</div>';
            }
            html += '</div>';
            contentDiv.innerHTML = html;
        } catch (err) {
            contentDiv.innerHTML = `<span style="color:var(--color-error);font-size:12px;">Failed to load: ${err.message}</span>`;
        }
    } else {
        detailsRow.style.display = 'none';
    }
}

// ==================== Activate Sub-Tenant ====================

async function activateSubTenant() {
    const licenseKey = document.getElementById('activateTenantLicenseKey').value.trim();
    const resultDiv = document.getElementById('activateTenantResult');
    const btn = document.getElementById('activateTenantBtn');

    if (!licenseKey) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'var(--bg-error, rgba(239,68,68,0.1))';
        resultDiv.style.color = 'var(--color-error, #ef4444)';
        resultDiv.textContent = 'Please paste a license key';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Activating...';
    resultDiv.style.display = 'none';

    try {
        const response = await fetch(`${CONFIG.authApiBaseUrl}/auth/activate-tenant`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ licenseKey })
        });

        const data = await response.json();

        resultDiv.style.display = 'block';

        if (data.success) {
            resultDiv.style.background = 'var(--bg-success, rgba(34,197,94,0.1))';
            resultDiv.style.color = 'var(--color-success, #22c55e)';
            resultDiv.innerHTML = `
                <strong>Tenant activated successfully!</strong><br>
                <span style="color:var(--text-secondary);">
                    Organization: ${data.tenantName || '-'}<br>
                    Admin: ${data.superAdminEmail || '-'}<br>
                    Password: <code style="background:var(--bg-tertiary);padding:2px 6px;border-radius:3px;user-select:all;">${data.generatedPassword || '-'}</code><br>
                    <small style="color:var(--color-warning);">Save this password — it will not be shown again.</small>
                </span>
            `;

            // Refresh sub-tenants list
            subTenantsData = null;
            loadSubTenants();
        } else {
            resultDiv.style.background = 'var(--bg-error, rgba(239,68,68,0.1))';
            resultDiv.style.color = 'var(--color-error, #ef4444)';
            resultDiv.textContent = data.message || 'Activation failed';
        }
    } catch (error) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'var(--bg-error, rgba(239,68,68,0.1))';
        resultDiv.style.color = 'var(--color-error, #ef4444)';
        resultDiv.textContent = 'Error: ' + error.message;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Activate';
    }
}
