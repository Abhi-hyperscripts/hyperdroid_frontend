// TenantManager Frontend Configuration
// Auto-detect environment based on hostname
const isProduction = window.location.hostname !== 'localhost' &&
                     window.location.hostname !== '127.0.0.1';

const CONFIG = {
    apiBaseUrl: isProduction ? 'https://tenant.hyperdroid.io' : 'http://localhost:5108',
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
Object.freeze(CONFIG);
Object.freeze(CONFIG.endpoints);
