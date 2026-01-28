// TenantManager Frontend Configuration
const CONFIG = {
    apiBaseUrl: 'http://localhost:5108',
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
