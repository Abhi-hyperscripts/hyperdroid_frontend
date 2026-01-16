/**
 * HRMS Role-Based Access Control (RBAC) Utility Module
 *
 * Centralized role and permission management for HRMS frontend.
 * All HRMS pages should use this module for consistent role checking.
 *
 * Roles (6 total):
 * - Organizational: HRMS_USER, HRMS_MANAGER, HRMS_ADMIN
 * - HR Department: HRMS_HR_USER, HRMS_HR_ADMIN, HRMS_HR_MANAGER
 */

// Role Constants
const HRMS_ROLES = {
    SUPERADMIN: 'SUPERADMIN',
    HRMS_ADMIN: 'HRMS_ADMIN',
    HRMS_MANAGER: 'HRMS_MANAGER',
    HRMS_USER: 'HRMS_USER',
    HRMS_HR_USER: 'HRMS_HR_USER',
    HRMS_HR_ADMIN: 'HRMS_HR_ADMIN',
    HRMS_HR_MANAGER: 'HRMS_HR_MANAGER'
};

// Permission Constants
const PERMISSIONS = {
    // Dashboard
    VIEW_OWN_STATS: 'VIEW_OWN_STATS',
    VIEW_TEAM_STATS: 'VIEW_TEAM_STATS',
    VIEW_ORG_STATS: 'VIEW_ORG_STATS',

    // Organization
    VIEW_ORGANIZATION: 'VIEW_ORGANIZATION',
    EDIT_ORGANIZATION: 'EDIT_ORGANIZATION',

    // Employees
    VIEW_ALL_EMPLOYEES: 'VIEW_ALL_EMPLOYEES',
    VIEW_TEAM_EMPLOYEES: 'VIEW_TEAM_EMPLOYEES',
    CREATE_EMPLOYEE: 'CREATE_EMPLOYEE',
    EDIT_EMPLOYEE: 'EDIT_EMPLOYEE',
    DELETE_EMPLOYEE: 'DELETE_EMPLOYEE',
    MANAGE_SALARY: 'MANAGE_SALARY',
    TRANSFER_EMPLOYEE: 'TRANSFER_EMPLOYEE',

    // Attendance
    VIEW_OWN_ATTENDANCE: 'VIEW_OWN_ATTENDANCE',
    VIEW_TEAM_ATTENDANCE: 'VIEW_TEAM_ATTENDANCE',
    VIEW_ALL_ATTENDANCE: 'VIEW_ALL_ATTENDANCE',
    APPROVE_TEAM_ATTENDANCE: 'APPROVE_TEAM_ATTENDANCE',
    APPROVE_ALL_ATTENDANCE: 'APPROVE_ALL_ATTENDANCE',

    // Leave
    VIEW_OWN_LEAVE: 'VIEW_OWN_LEAVE',
    VIEW_TEAM_LEAVE: 'VIEW_TEAM_LEAVE',
    VIEW_ALL_LEAVE: 'VIEW_ALL_LEAVE',
    APPROVE_TEAM_LEAVE: 'APPROVE_TEAM_LEAVE',
    APPROVE_ALL_LEAVE: 'APPROVE_ALL_LEAVE',
    MANAGE_LEAVE_TYPES: 'MANAGE_LEAVE_TYPES',
    ALLOCATE_LEAVE: 'ALLOCATE_LEAVE',

    // Payroll
    VIEW_OWN_PAYSLIPS: 'VIEW_OWN_PAYSLIPS',
    VIEW_ALL_PAYROLL: 'VIEW_ALL_PAYROLL',
    PROCESS_PAYROLL: 'PROCESS_PAYROLL',
    APPROVE_LOANS: 'APPROVE_LOANS',
    MANAGE_SALARY_STRUCTURES: 'MANAGE_SALARY_STRUCTURES',
    MANAGE_COMPONENTS: 'MANAGE_COMPONENTS',

    // Reports
    VIEW_TEAM_REPORTS: 'VIEW_TEAM_REPORTS',
    VIEW_ALL_REPORTS: 'VIEW_ALL_REPORTS',
    EXPORT_REPORTS: 'EXPORT_REPORTS'
};

// Role-Permission Mapping
const ROLE_PERMISSIONS = {
    [HRMS_ROLES.SUPERADMIN]: Object.values(PERMISSIONS), // All permissions

    [HRMS_ROLES.HRMS_ADMIN]: Object.values(PERMISSIONS), // All permissions

    [HRMS_ROLES.HRMS_HR_ADMIN]: [
        // Dashboard
        PERMISSIONS.VIEW_OWN_STATS,
        PERMISSIONS.VIEW_TEAM_STATS,
        PERMISSIONS.VIEW_ORG_STATS,
        // Organization
        PERMISSIONS.VIEW_ORGANIZATION,
        PERMISSIONS.EDIT_ORGANIZATION,
        // Employees
        PERMISSIONS.VIEW_ALL_EMPLOYEES,
        PERMISSIONS.VIEW_TEAM_EMPLOYEES,
        PERMISSIONS.CREATE_EMPLOYEE,
        PERMISSIONS.EDIT_EMPLOYEE,
        PERMISSIONS.DELETE_EMPLOYEE,
        PERMISSIONS.MANAGE_SALARY,
        PERMISSIONS.TRANSFER_EMPLOYEE,
        // Attendance
        PERMISSIONS.VIEW_OWN_ATTENDANCE,
        PERMISSIONS.VIEW_TEAM_ATTENDANCE,
        PERMISSIONS.VIEW_ALL_ATTENDANCE,
        PERMISSIONS.APPROVE_TEAM_ATTENDANCE,
        PERMISSIONS.APPROVE_ALL_ATTENDANCE,
        // Leave
        PERMISSIONS.VIEW_OWN_LEAVE,
        PERMISSIONS.VIEW_TEAM_LEAVE,
        PERMISSIONS.VIEW_ALL_LEAVE,
        PERMISSIONS.APPROVE_TEAM_LEAVE,
        PERMISSIONS.APPROVE_ALL_LEAVE,
        PERMISSIONS.MANAGE_LEAVE_TYPES,
        PERMISSIONS.ALLOCATE_LEAVE,
        // Payroll
        PERMISSIONS.VIEW_OWN_PAYSLIPS,
        PERMISSIONS.VIEW_ALL_PAYROLL,
        PERMISSIONS.PROCESS_PAYROLL,
        PERMISSIONS.APPROVE_LOANS,
        PERMISSIONS.MANAGE_SALARY_STRUCTURES,
        PERMISSIONS.MANAGE_COMPONENTS,
        // Reports
        PERMISSIONS.VIEW_TEAM_REPORTS,
        PERMISSIONS.VIEW_ALL_REPORTS,
        PERMISSIONS.EXPORT_REPORTS
    ],

    [HRMS_ROLES.HRMS_HR_MANAGER]: [
        // Dashboard
        PERMISSIONS.VIEW_OWN_STATS,
        PERMISSIONS.VIEW_TEAM_STATS,
        PERMISSIONS.VIEW_ORG_STATS,
        // Organization
        PERMISSIONS.VIEW_ORGANIZATION,
        PERMISSIONS.EDIT_ORGANIZATION,
        // Employees
        PERMISSIONS.VIEW_ALL_EMPLOYEES,
        PERMISSIONS.VIEW_TEAM_EMPLOYEES,
        PERMISSIONS.CREATE_EMPLOYEE,
        PERMISSIONS.EDIT_EMPLOYEE,
        PERMISSIONS.MANAGE_SALARY,
        PERMISSIONS.TRANSFER_EMPLOYEE,
        // Attendance
        PERMISSIONS.VIEW_OWN_ATTENDANCE,
        PERMISSIONS.VIEW_TEAM_ATTENDANCE,
        PERMISSIONS.VIEW_ALL_ATTENDANCE,
        PERMISSIONS.APPROVE_TEAM_ATTENDANCE,
        PERMISSIONS.APPROVE_ALL_ATTENDANCE,
        // Leave
        PERMISSIONS.VIEW_OWN_LEAVE,
        PERMISSIONS.VIEW_TEAM_LEAVE,
        PERMISSIONS.VIEW_ALL_LEAVE,
        PERMISSIONS.APPROVE_TEAM_LEAVE,
        PERMISSIONS.APPROVE_ALL_LEAVE,
        // Payroll
        PERMISSIONS.VIEW_OWN_PAYSLIPS,
        PERMISSIONS.VIEW_ALL_PAYROLL,
        PERMISSIONS.PROCESS_PAYROLL,
        PERMISSIONS.APPROVE_LOANS,
        // Reports
        PERMISSIONS.VIEW_TEAM_REPORTS,
        PERMISSIONS.VIEW_ALL_REPORTS,
        PERMISSIONS.EXPORT_REPORTS
    ],

    [HRMS_ROLES.HRMS_HR_USER]: [
        // Dashboard
        PERMISSIONS.VIEW_OWN_STATS,
        PERMISSIONS.VIEW_TEAM_STATS,
        PERMISSIONS.VIEW_ORG_STATS,
        // Organization (read-only)
        PERMISSIONS.VIEW_ORGANIZATION,
        // Employees (read-only)
        PERMISSIONS.VIEW_ALL_EMPLOYEES,
        PERMISSIONS.VIEW_TEAM_EMPLOYEES,
        // Attendance (read-only)
        PERMISSIONS.VIEW_OWN_ATTENDANCE,
        PERMISSIONS.VIEW_TEAM_ATTENDANCE,
        PERMISSIONS.VIEW_ALL_ATTENDANCE,
        // Leave (read-only)
        PERMISSIONS.VIEW_OWN_LEAVE,
        PERMISSIONS.VIEW_TEAM_LEAVE,
        PERMISSIONS.VIEW_ALL_LEAVE,
        // Payroll (read-only)
        PERMISSIONS.VIEW_OWN_PAYSLIPS,
        PERMISSIONS.VIEW_ALL_PAYROLL,
        // Reports (read-only)
        PERMISSIONS.VIEW_TEAM_REPORTS,
        PERMISSIONS.VIEW_ALL_REPORTS
    ],

    [HRMS_ROLES.HRMS_MANAGER]: [
        // Dashboard
        PERMISSIONS.VIEW_OWN_STATS,
        PERMISSIONS.VIEW_TEAM_STATS,
        // Employees (team only)
        PERMISSIONS.VIEW_TEAM_EMPLOYEES,
        // Attendance (team approval)
        PERMISSIONS.VIEW_OWN_ATTENDANCE,
        PERMISSIONS.VIEW_TEAM_ATTENDANCE,
        PERMISSIONS.APPROVE_TEAM_ATTENDANCE,
        // Leave (team approval)
        PERMISSIONS.VIEW_OWN_LEAVE,
        PERMISSIONS.VIEW_TEAM_LEAVE,
        PERMISSIONS.APPROVE_TEAM_LEAVE,
        // Payroll (own only)
        PERMISSIONS.VIEW_OWN_PAYSLIPS,
        // Reports (team only)
        PERMISSIONS.VIEW_TEAM_REPORTS
    ],

    [HRMS_ROLES.HRMS_USER]: [
        // Dashboard (own only)
        PERMISSIONS.VIEW_OWN_STATS,
        // Attendance (own only)
        PERMISSIONS.VIEW_OWN_ATTENDANCE,
        // Leave (own only)
        PERMISSIONS.VIEW_OWN_LEAVE,
        // Payroll (own only)
        PERMISSIONS.VIEW_OWN_PAYSLIPS
    ]
};

/**
 * HRMS Role Utility Class
 * Provides role and permission checking functionality
 */
class HRMSRoleUtils {
    constructor() {
        this.user = null;
        this.userRoles = [];
        this.userPermissions = new Set();
        this._initialized = false;
    }

    /**
     * Initialize the utility with current user data
     * Call this on page load or when user data changes
     */
    init() {
        if (this._initialized) return this;

        const user = getStoredUser();
        if (user) {
            try {
                this.user = user;
                this.userRoles = this.user?.roles || [];
                this._computePermissions();
            } catch (e) {
                console.error('Failed to parse user data:', e);
                this.user = null;
                this.userRoles = [];
            }
        }
        this._initialized = true;
        return this;
    }

    /**
     * Force re-initialization (useful after login/logout)
     */
    refresh() {
        this._initialized = false;
        this.userPermissions.clear();
        return this.init();
    }

    /**
     * Compute all permissions based on user roles
     */
    _computePermissions() {
        this.userPermissions.clear();
        for (const role of this.userRoles) {
            const perms = ROLE_PERMISSIONS[role] || [];
            perms.forEach(p => this.userPermissions.add(p));
        }
    }

    // ==================== Role Checks ====================

    /**
     * Check if user has a specific role
     */
    hasRole(role) {
        this.init();
        return this.userRoles.includes(role);
    }

    /**
     * Check if user has any of the specified roles
     */
    hasAnyRole(roles) {
        this.init();
        return roles.some(r => this.userRoles.includes(r));
    }

    /**
     * Check if user has all of the specified roles
     */
    hasAllRoles(roles) {
        this.init();
        return roles.every(r => this.userRoles.includes(r));
    }

    // ==================== Permission Checks ====================

    /**
     * Check if user has a specific permission
     */
    hasPermission(permission) {
        this.init();
        return this.userPermissions.has(permission);
    }

    /**
     * Check if user has any of the specified permissions
     */
    hasAnyPermission(permissions) {
        this.init();
        return permissions.some(p => this.userPermissions.has(p));
    }

    // ==================== Convenience Role Methods ====================

    isSuperAdmin() {
        return this.hasRole(HRMS_ROLES.SUPERADMIN);
    }

    isHRMSAdmin() {
        return this.hasRole(HRMS_ROLES.HRMS_ADMIN);
    }

    /**
     * Check if user is HR Admin (can do all HR operations)
     * Includes: SUPERADMIN, HRMS_ADMIN, HRMS_HR_ADMIN
     */
    isHRAdmin() {
        return this.hasAnyRole([
            HRMS_ROLES.SUPERADMIN,
            HRMS_ROLES.HRMS_ADMIN,
            HRMS_ROLES.HRMS_HR_ADMIN
        ]);
    }

    /**
     * Check if user is any HR role (can view HR data)
     * Includes: HRMS_HR_USER, HRMS_HR_MANAGER, HRMS_HR_ADMIN, HRMS_ADMIN, SUPERADMIN
     */
    isHRUser() {
        return this.hasAnyRole([
            HRMS_ROLES.SUPERADMIN,
            HRMS_ROLES.HRMS_ADMIN,
            HRMS_ROLES.HRMS_HR_USER,
            HRMS_ROLES.HRMS_HR_MANAGER,
            HRMS_ROLES.HRMS_HR_ADMIN
        ]);
    }

    /**
     * Check if user is HR Manager
     * Includes: HRMS_HR_MANAGER, HRMS_HR_ADMIN, HRMS_ADMIN, SUPERADMIN
     */
    isHRManager() {
        return this.hasAnyRole([
            HRMS_ROLES.SUPERADMIN,
            HRMS_ROLES.HRMS_ADMIN,
            HRMS_ROLES.HRMS_HR_MANAGER,
            HRMS_ROLES.HRMS_HR_ADMIN
        ]);
    }

    /**
     * Check if user is a team manager (non-HR)
     */
    isManager() {
        return this.hasRole(HRMS_ROLES.HRMS_MANAGER);
    }

    /**
     * Check if user can approve team requests (either HR or Manager)
     */
    canApproveTeamRequests() {
        return this.isHRAdmin() || this.isHRManager() || this.isManager();
    }

    /**
     * Check if user is basic HRMS user only (no special permissions)
     */
    isBasicUser() {
        return this.hasRole(HRMS_ROLES.HRMS_USER) &&
               !this.isHRUser() &&
               !this.isManager();
    }

    // ==================== Page Access Checks ====================

    canAccessDashboard() {
        // All HRMS users can access dashboard
        return this.hasAnyRole([
            HRMS_ROLES.SUPERADMIN,
            HRMS_ROLES.HRMS_ADMIN,
            HRMS_ROLES.HRMS_USER,
            HRMS_ROLES.HRMS_MANAGER,
            HRMS_ROLES.HRMS_HR_USER,
            HRMS_ROLES.HRMS_HR_MANAGER,
            HRMS_ROLES.HRMS_HR_ADMIN
        ]);
    }

    canAccessOrganization() {
        return this.hasPermission(PERMISSIONS.VIEW_ORGANIZATION);
    }

    canEditOrganization() {
        return this.hasPermission(PERMISSIONS.EDIT_ORGANIZATION);
    }

    canAccessEmployees() {
        return this.hasAnyPermission([
            PERMISSIONS.VIEW_ALL_EMPLOYEES,
            PERMISSIONS.VIEW_TEAM_EMPLOYEES
        ]);
    }

    canViewAllEmployees() {
        return this.hasPermission(PERMISSIONS.VIEW_ALL_EMPLOYEES);
    }

    canCreateEmployee() {
        return this.hasPermission(PERMISSIONS.CREATE_EMPLOYEE);
    }

    canEditEmployee() {
        return this.hasPermission(PERMISSIONS.EDIT_EMPLOYEE);
    }

    canDeleteEmployee() {
        return this.hasPermission(PERMISSIONS.DELETE_EMPLOYEE);
    }

    canManageSalary() {
        return this.hasPermission(PERMISSIONS.MANAGE_SALARY);
    }

    canTransferEmployee() {
        return this.hasPermission(PERMISSIONS.TRANSFER_EMPLOYEE);
    }

    canAccessAttendance() {
        return this.hasAnyPermission([
            PERMISSIONS.VIEW_OWN_ATTENDANCE,
            PERMISSIONS.VIEW_TEAM_ATTENDANCE,
            PERMISSIONS.VIEW_ALL_ATTENDANCE
        ]);
    }

    canViewAllAttendance() {
        return this.hasPermission(PERMISSIONS.VIEW_ALL_ATTENDANCE);
    }

    canViewTeamAttendance() {
        return this.hasAnyPermission([
            PERMISSIONS.VIEW_TEAM_ATTENDANCE,
            PERMISSIONS.VIEW_ALL_ATTENDANCE
        ]);
    }

    canApproveAttendance() {
        return this.hasAnyPermission([
            PERMISSIONS.APPROVE_TEAM_ATTENDANCE,
            PERMISSIONS.APPROVE_ALL_ATTENDANCE
        ]);
    }

    canAccessLeave() {
        return this.hasAnyPermission([
            PERMISSIONS.VIEW_OWN_LEAVE,
            PERMISSIONS.VIEW_TEAM_LEAVE,
            PERMISSIONS.VIEW_ALL_LEAVE
        ]);
    }

    canViewAllLeave() {
        return this.hasPermission(PERMISSIONS.VIEW_ALL_LEAVE);
    }

    canViewTeamLeave() {
        return this.hasAnyPermission([
            PERMISSIONS.VIEW_TEAM_LEAVE,
            PERMISSIONS.VIEW_ALL_LEAVE
        ]);
    }

    canApproveLeave() {
        return this.hasAnyPermission([
            PERMISSIONS.APPROVE_TEAM_LEAVE,
            PERMISSIONS.APPROVE_ALL_LEAVE
        ]);
    }

    canManageLeaveTypes() {
        return this.hasPermission(PERMISSIONS.MANAGE_LEAVE_TYPES);
    }

    canAllocateLeave() {
        return this.hasPermission(PERMISSIONS.ALLOCATE_LEAVE);
    }

    canAccessPayroll() {
        return this.hasAnyPermission([
            PERMISSIONS.VIEW_OWN_PAYSLIPS,
            PERMISSIONS.VIEW_ALL_PAYROLL
        ]);
    }

    canViewAllPayroll() {
        return this.hasPermission(PERMISSIONS.VIEW_ALL_PAYROLL);
    }

    canProcessPayroll() {
        return this.hasPermission(PERMISSIONS.PROCESS_PAYROLL);
    }

    canApproveLoans() {
        return this.hasPermission(PERMISSIONS.APPROVE_LOANS);
    }

    canManageSalaryStructures() {
        return this.hasPermission(PERMISSIONS.MANAGE_SALARY_STRUCTURES);
    }

    canManageComponents() {
        return this.hasPermission(PERMISSIONS.MANAGE_COMPONENTS);
    }

    canAccessReports() {
        return this.hasAnyPermission([
            PERMISSIONS.VIEW_TEAM_REPORTS,
            PERMISSIONS.VIEW_ALL_REPORTS
        ]);
    }

    canViewAllReports() {
        return this.hasPermission(PERMISSIONS.VIEW_ALL_REPORTS);
    }

    canExportReports() {
        return this.hasPermission(PERMISSIONS.EXPORT_REPORTS);
    }

    // ==================== UI Visibility Helpers ====================

    /**
     * Show an element by ID
     */
    showElement(elementId) {
        const el = document.getElementById(elementId);
        if (el) {
            el.style.display = '';
            el.classList.remove('rbac-hidden');
        }
    }

    /**
     * Hide an element by ID
     */
    hideElement(elementId) {
        const el = document.getElementById(elementId);
        if (el) {
            el.style.display = 'none';
            el.classList.add('rbac-hidden');
        }
    }

    /**
     * Set element visibility by ID
     */
    setElementVisibility(elementId, visible) {
        if (visible) {
            this.showElement(elementId);
        } else {
            this.hideElement(elementId);
        }
    }

    /**
     * Show/hide element based on permission
     */
    showElementIfPermission(elementId, permission) {
        this.setElementVisibility(elementId, this.hasPermission(permission));
    }

    /**
     * Show/hide element based on any permission
     */
    showElementIfAnyPermission(elementId, permissions) {
        this.setElementVisibility(elementId, this.hasAnyPermission(permissions));
    }

    /**
     * Apply RBAC visibility to multiple elements
     * @param {Object} config - Map of elementId to permission
     */
    applyPageRBAC(config) {
        for (const [elementId, permission] of Object.entries(config)) {
            if (Array.isArray(permission)) {
                this.showElementIfAnyPermission(elementId, permission);
            } else {
                this.showElementIfPermission(elementId, permission);
            }
        }
    }

    /**
     * Hide all elements with a specific data attribute for non-admins
     */
    hideActionButtons(selector, permission) {
        const elements = document.querySelectorAll(selector);
        const hasPermission = this.hasPermission(permission);
        elements.forEach(el => {
            if (!hasPermission) {
                el.style.display = 'none';
                el.classList.add('rbac-hidden');
            }
        });
    }

    /**
     * Disable (but show) elements for users without permission
     */
    disableElementIfNoPermission(elementId, permission) {
        const el = document.getElementById(elementId);
        if (el && !this.hasPermission(permission)) {
            el.disabled = true;
            el.classList.add('rbac-disabled');
        }
    }

    /**
     * Redirect to dashboard if user doesn't have permission
     */
    requirePermission(permission, redirectUrl = '/pages/hrms/dashboard.html') {
        this.init();
        if (!this.hasPermission(permission)) {
            window.location.href = redirectUrl;
            return false;
        }
        return true;
    }

    /**
     * Redirect to dashboard if user doesn't have any of the permissions
     */
    requireAnyPermission(permissions, redirectUrl = '/pages/hrms/dashboard.html') {
        this.init();
        if (!this.hasAnyPermission(permissions)) {
            window.location.href = redirectUrl;
            return false;
        }
        return true;
    }

    // ==================== Role Formatting Helpers ====================

    /**
     * Get display name for a role
     * @param {string} role - Role constant
     * @returns {string} Human-readable role name
     */
    getRoleDisplayName(role) {
        const displayNames = {
            [HRMS_ROLES.SUPERADMIN]: 'Super Admin',
            [HRMS_ROLES.HRMS_ADMIN]: 'Admin',
            [HRMS_ROLES.HRMS_MANAGER]: 'Manager',
            [HRMS_ROLES.HRMS_USER]: 'User',
            [HRMS_ROLES.HRMS_HR_USER]: 'HR User',
            [HRMS_ROLES.HRMS_HR_ADMIN]: 'HR Admin',
            [HRMS_ROLES.HRMS_HR_MANAGER]: 'HR Manager'
        };
        return displayNames[role] || role;
    }

    /**
     * Get short name for a role (for tags/badges)
     * @param {string} role - Role constant
     * @returns {string} Short role name
     */
    getRoleShortName(role) {
        const shortNames = {
            [HRMS_ROLES.SUPERADMIN]: 'SUPER',
            [HRMS_ROLES.HRMS_ADMIN]: 'ADMIN',
            [HRMS_ROLES.HRMS_MANAGER]: 'MGR',
            [HRMS_ROLES.HRMS_USER]: 'USER',
            [HRMS_ROLES.HRMS_HR_USER]: 'HR',
            [HRMS_ROLES.HRMS_HR_ADMIN]: 'HR_ADMIN',
            [HRMS_ROLES.HRMS_HR_MANAGER]: 'HR_MGR'
        };
        return shortNames[role] || role.replace('HRMS_', '');
    }

    /**
     * Get CSS class for role tag styling
     * @param {string} role - Role constant
     * @returns {string} CSS class name
     */
    getRoleClass(role) {
        const classes = {
            [HRMS_ROLES.SUPERADMIN]: 'role-superadmin',
            [HRMS_ROLES.HRMS_ADMIN]: 'role-admin',
            [HRMS_ROLES.HRMS_MANAGER]: 'role-manager',
            [HRMS_ROLES.HRMS_USER]: 'role-user',
            [HRMS_ROLES.HRMS_HR_USER]: 'role-hr',
            [HRMS_ROLES.HRMS_HR_ADMIN]: 'role-hr-admin',
            [HRMS_ROLES.HRMS_HR_MANAGER]: 'role-hr-manager'
        };
        return classes[role] || 'role-default';
    }

    /**
     * Format roles array as HTML tags
     * @param {string[]} roles - Array of role names
     * @returns {string} HTML string with role tags
     */
    formatRoleTags(roles) {
        if (!roles || roles.length === 0) {
            return '<span class="role-tag role-user">USER</span>';
        }
        return roles.map(role => {
            const shortName = this.getRoleShortName(role);
            const cssClass = this.getRoleClass(role);
            return `<span class="role-tag ${cssClass}">${shortName}</span>`;
        }).join(' ');
    }

    // ==================== Debug Helper ====================

    /**
     * Get debug info about current user's roles and permissions
     */
    getDebugInfo() {
        this.init();
        return {
            user: this.user?.email || 'Not logged in',
            roles: this.userRoles,
            permissions: Array.from(this.userPermissions),
            isHRAdmin: this.isHRAdmin(),
            isHRUser: this.isHRUser(),
            isManager: this.isManager(),
            isBasicUser: this.isBasicUser()
        };
    }

    // ==================== Setup Validation ====================

    /**
     * Cached setup status to avoid repeated API calls on the same page
     */
    _setupStatus = null;
    _setupStatusPromise = null;

    /**
     * Fetch setup status from backend (with caching)
     * @returns {Promise<Object>} Setup status object
     */
    async getSetupStatus() {
        // Return cached status if available
        if (this._setupStatus) {
            return this._setupStatus;
        }

        // Return existing promise if already fetching
        if (this._setupStatusPromise) {
            return this._setupStatusPromise;
        }

        // Fetch and cache
        this._setupStatusPromise = (async () => {
            try {
                // Check if api is available
                if (typeof api === 'undefined' || !api.request) {
                    console.warn('[RBAC] API not available for setup check');
                    return null;
                }

                const status = await api.request('/hrms/dashboard/setup-status');
                this._setupStatus = status;
                return status;
            } catch (error) {
                console.error('[RBAC] Error fetching setup status:', error);
                return null;
            } finally {
                this._setupStatusPromise = null;
            }
        })();

        return this._setupStatusPromise;
    }

    /**
     * Clear cached setup status (call after setup changes)
     */
    clearSetupStatusCache() {
        this._setupStatus = null;
        this._setupStatusPromise = null;
    }

    /**
     * Require compliance setup to be complete before accessing the page.
     * Redirects to compliance.html with error message if not complete.
     *
     * @param {Object} options - Configuration options
     * @param {boolean} options.showToast - Whether to show toast message (default: true)
     * @param {string} options.redirectUrl - URL to redirect to (default: compliance.html)
     * @returns {Promise<boolean>} True if compliance is complete, false if redirecting
     */
    async requireComplianceSetup(options = {}) {
        const { showToast = true, redirectUrl = 'compliance.html' } = options;

        const status = await this.getSetupStatus();

        if (!status) {
            // If we can't fetch status, allow access (fail open) but log warning
            console.warn('[RBAC] Could not verify setup status, allowing access');
            return true;
        }

        if (!status.is_compliance_complete) {
            if (showToast && typeof window.showToast === 'function') {
                window.showToast('Please complete Compliance setup first', 'error');
            }
            window.location.href = redirectUrl;
            return false;
        }

        return true;
    }

    /**
     * Require organization setup to be complete before accessing the page.
     * This includes: at least one office, department, designation, and shift.
     * Redirects to organization.html with error message if not complete.
     *
     * Note: This also implicitly requires compliance setup.
     *
     * @param {Object} options - Configuration options
     * @param {boolean} options.showToast - Whether to show toast message (default: true)
     * @param {string} options.redirectUrl - URL to redirect to (default: organization.html)
     * @param {boolean} options.requireBasicOnly - Only require basic setup (office, dept, desig, shift)
     * @returns {Promise<boolean>} True if setup is complete, false if redirecting
     */
    async requireOrganizationSetup(options = {}) {
        const {
            showToast = true,
            redirectUrl = 'organization.html',
            requireBasicOnly = false
        } = options;

        const status = await this.getSetupStatus();

        if (!status) {
            console.warn('[RBAC] Could not verify setup status, allowing access');
            return true;
        }

        // First check compliance
        if (!status.is_compliance_complete) {
            if (showToast && typeof window.showToast === 'function') {
                window.showToast('Please complete Compliance setup first', 'error');
            }
            window.location.href = 'compliance.html';
            return false;
        }

        // Check basic setup (office, department, designation, shift)
        const hasBasicSetup = status.has_office && status.has_department &&
                             status.has_designation && status.has_shift;

        if (requireBasicOnly) {
            if (!hasBasicSetup) {
                if (showToast && typeof window.showToast === 'function') {
                    window.showToast('Please complete Organization setup first (Office, Department, Designation, Shift)', 'error');
                }
                window.location.href = redirectUrl;
                return false;
            }
            return true;
        }

        // Full setup check
        if (!status.is_setup_complete) {
            if (showToast && typeof window.showToast === 'function') {
                window.showToast('Please complete Organization setup first', 'error');
            }
            window.location.href = redirectUrl;
            return false;
        }

        return true;
    }

    /**
     * Require full setup (compliance + organization) before accessing the page.
     * Convenience method that combines both checks.
     *
     * @param {Object} options - Configuration options
     * @param {boolean} options.showToast - Whether to show toast message (default: true)
     * @returns {Promise<boolean>} True if all setup is complete, false if redirecting
     */
    async requireFullSetup(options = {}) {
        return this.requireOrganizationSetup(options);
    }

    /**
     * Check if setup is complete without redirecting.
     * Useful for conditionally showing/hiding UI elements.
     *
     * @returns {Promise<Object>} Object with is_compliance_complete, is_setup_complete, has_basic_setup
     */
    async checkSetupComplete() {
        const status = await this.getSetupStatus();

        if (!status) {
            return {
                is_compliance_complete: false,
                is_setup_complete: false,
                has_basic_setup: false,
                error: true
            };
        }

        const hasBasicSetup = status.has_office && status.has_department &&
                             status.has_designation && status.has_shift;

        return {
            is_compliance_complete: status.is_compliance_complete || false,
            is_setup_complete: status.is_setup_complete || false,
            has_basic_setup: hasBasicSetup,
            error: false
        };
    }
}

// Create singleton instance
const hrmsRoles = new HRMSRoleUtils();

// Export for module usage (if using ES modules)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { hrmsRoles, HRMS_ROLES, PERMISSIONS, ROLE_PERMISSIONS };
}

// Make available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.hrmsRoles = hrmsRoles;
    window.HRMS_ROLES = HRMS_ROLES;
    window.PERMISSIONS = PERMISSIONS;
    window.ROLE_PERMISSIONS = ROLE_PERMISSIONS;
}
