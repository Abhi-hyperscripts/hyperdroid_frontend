/**
 * TenantManager Frontend Configuration
 *
 * Centralized endpoint configuration for easy environment switching.
 * Auto-detects environment based on hostname.
 */

// Environment configurations
const TM_ENVIRONMENTS = {
    local: {
        tenantManager: 'http://localhost:5108'
    },
    production: {
        tenantManager: 'https://tenant.ragenaizer.com'
    }
};

// Auto-detect environment based on hostname
function detectTMEnvironment() {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
        return 'local';
    }
    return 'production';
}

const currentTMEnv = detectTMEnvironment();
console.log(`[TenantManager CONFIG] Environment: ${currentTMEnv}`);

// Storage key prefix to match main app pattern
const TM_STORAGE_PREFIX = 'ragenaizer_tm_';

const CONFIG = {
    // Current environment
    environment: currentTMEnv,

    // Storage prefix for localStorage keys
    storagePrefix: TM_STORAGE_PREFIX,

    // Base URLs - Auto-selected based on environment
    baseUrls: TM_ENVIRONMENTS[currentTMEnv],

    // Derived URLs (computed from base endpoints)
    get apiBaseUrl() {
        return this.baseUrls.tenantManager;
    },

    // Full API endpoint URLs (for convenience)
    get authApiUrl() {
        return `${this.baseUrls.tenantManager}/api/auth`;
    },

    get tenantsApiUrl() {
        return `${this.baseUrls.tenantManager}/api/tenants`;
    },

    get servicesApiUrl() {
        return `${this.baseUrls.tenantManager}/api/services`;
    },

    // Specific endpoint paths (relative) - used by api.js
    endpoints: {
        login: '/api/auth/login',
        validate: '/api/auth/validate',
        changePassword: '/api/auth/change-password',
        health: '/api/auth/health',
        tenants: '/api/tenants',
        services: '/api/services',
        verifyLicense: '/api/tenants/verify-license'
    }
};

// Freeze config to prevent accidental modifications
// Note: Object.freeze is shallow, so nested objects need separate freezing
Object.freeze(CONFIG.baseUrls);
Object.freeze(CONFIG.endpoints);
Object.freeze(TM_ENVIRONMENTS);
