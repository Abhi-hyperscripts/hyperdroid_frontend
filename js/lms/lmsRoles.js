/**
 * LMS Role-Based Access Control Utility
 *
 * Roles:
 * - LMS_USER: Basic learner access
 * - LMS_INSTRUCTOR: Can create/manage courses, schedule sessions
 * - LMS_MANAGER: Can view team reports, assign training
 * - LMS_ADMIN: Full administrative access
 * - SUPERADMIN: Global superadmin (always has access)
 */

const lmsRoles = {
    _roles: [],
    _initialized: false,

    /**
     * Initialize roles from JWT token
     */
    init() {
        if (this._initialized) return this;

        const token = getAuthToken();
        if (!token) return this;

        const payload = decodeJwtPayload(token);
        // JWT may use 'role' or the full .NET claim URI
        this._roles = payload?.role
            || payload?.['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
            || [];
        if (typeof this._roles === 'string') {
            this._roles = [this._roles];
        }

        this._initialized = true;
        return this;
    },

    /**
     * Force re-initialization
     */
    refresh() {
        this._initialized = false;
        this._roles = [];
        return this.init();
    },

    /**
     * Check if user has a specific role
     */
    hasRole(role) {
        this.init();
        return this._roles.includes(role) || this._roles.includes('SUPERADMIN');
    },

    /**
     * Check if user has any of the specified roles
     */
    hasAnyRole(roles) {
        this.init();
        return this._roles.includes('SUPERADMIN') || roles.some(r => this._roles.includes(r));
    },

    /**
     * Check if user is LMS Admin
     */
    isAdmin() {
        return this.hasRole('LMS_ADMIN');
    },

    /**
     * Check if user is LMS Instructor (or Admin)
     */
    isInstructor() {
        return this.hasRole('LMS_INSTRUCTOR') || this.isAdmin();
    },

    /**
     * Check if user is LMS Manager (or Admin)
     */
    isManager() {
        return this.hasRole('LMS_MANAGER') || this.isAdmin();
    },

    /**
     * Check if user has basic LMS access
     */
    isUser() {
        return this.hasRole('LMS_USER') || this.isInstructor() || this.isManager();
    },

    /**
     * Show or hide an element by ID based on visibility flag
     */
    setElementVisibility(elementId, visible) {
        const el = document.getElementById(elementId);
        if (el) el.style.display = visible ? '' : 'none';
    },

    /**
     * Show element if user has role
     */
    showIfRole(elementId, role) {
        this.setElementVisibility(elementId, this.hasRole(role));
    },

    /**
     * Show element if user is admin
     */
    showIfAdmin(elementId) {
        this.setElementVisibility(elementId, this.isAdmin());
    },

    /**
     * Show element if user is instructor or admin
     */
    showIfInstructor(elementId) {
        this.setElementVisibility(elementId, this.isInstructor());
    },

    /**
     * Show element if user is manager or admin
     */
    showIfManager(elementId) {
        this.setElementVisibility(elementId, this.isManager());
    },

    /**
     * Get display name for a role
     */
    getRoleDisplayName(role) {
        const names = {
            'SUPERADMIN': 'Super Admin',
            'LMS_ADMIN': 'LMS Admin',
            'LMS_INSTRUCTOR': 'Instructor',
            'LMS_MANAGER': 'Manager',
            'LMS_USER': 'Learner'
        };
        return names[role] || role;
    },

    /**
     * Get all LMS roles the current user has
     */
    getLmsRoles() {
        this.init();
        return this._roles.filter(r => r.startsWith('LMS_') || r === 'SUPERADMIN');
    },

    /**
     * Debug info
     */
    getDebugInfo() {
        this.init();
        return {
            roles: this._roles,
            lmsRoles: this.getLmsRoles(),
            isAdmin: this.isAdmin(),
            isInstructor: this.isInstructor(),
            isManager: this.isManager(),
            isUser: this.isUser()
        };
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.lmsRoles = lmsRoles;
}
