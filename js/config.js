/**
 * Ragenaizer Frontend Configuration
 *
 * Centralized endpoint configuration for easy environment switching.
 * Auto-detects environment based on hostname.
 */

// Environment configurations
const ENVIRONMENTS = {
    local: {
        auth: 'https://localhost:5098',
        vision: 'https://localhost:5099',
        drive: 'https://localhost:5100',
        chat: 'https://localhost:5102',
        hrms: 'https://localhost:5104',
        crm: 'https://localhost:5112',
        research: 'https://localhost:5114',
        notification: 'https://localhost:5110',
        pms: 'https://localhost:5116',
        news: 'https://localhost:5120',
        procurement: 'https://localhost:5124',
        lms: 'https://localhost:5126',
        accounts: 'https://localhost:5122',
        email: 'https://localhost:5128',
        paymentplans: 'https://localhost:5132'
    },
    production: {
        auth: 'https://auth.ragenaizer.com',
        vision: 'https://vision.ragenaizer.com',
        drive: 'https://drive.ragenaizer.com',
        chat: 'https://chat.ragenaizer.com',
        hrms: 'https://hrms.ragenaizer.com',
        crm: 'https://crm.ragenaizer.com',
        research: 'https://research.ragenaizer.com',
        notification: 'https://notification.ragenaizer.com',
        pms: 'https://pms.ragenaizer.com',
        news: 'https://news.ragenaizer.com',
        procurement: 'https://procurement.ragenaizer.com',
        lms: 'https://lms.ragenaizer.com',
        accounts: 'https://accounts.ragenaizer.com',
        email: 'https://emails.ragenaizer.com',
        paymentplans: 'https://paymentplan.ragenaizer.com'
    }
};

// Auto-detect environment based on hostname
function detectEnvironment() {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
        return 'local';
    }
    return 'production';
}

const currentEnv = detectEnvironment();
console.log(`[CONFIG] Environment: ${currentEnv}`);

// Storage key prefix to avoid conflicts with other apps
const STORAGE_PREFIX = 'ragenaizer_';

const CONFIG = {
    // Current environment
    environment: currentEnv,

    // Storage prefix for localStorage keys
    storagePrefix: STORAGE_PREFIX,

    // Service Endpoints - Auto-selected based on environment
    endpoints: ENVIRONMENTS[currentEnv],

    // Cached ICE servers from backend
    _cachedIceServers: null,

    // Feature flag — GST e-invoicing (IRP/IRN). Keep FALSE until a GST Suvidha Provider
    // (GSP) is configured server-side (AccountsService `EInvoice:Enabled` + Provider/BaseUrl/ApiKey)
    // AND validated with a sandbox round-trip. While false, the invoice view hides the
    // "Generate IRN" action so nothing half-working reaches end users; "Preview payload"
    // stays available (it builds the INV-01 JSON locally, no GSP call). Flip to true at
    // deploy time in lockstep with the server config.
    eInvoiceEnabled: false,

    // Derived URLs (computed from base endpoints)
    get authApiBaseUrl() {
        return `${this.endpoints.auth}/api`;
    },

    get visionApiBaseUrl() {
        return `${this.endpoints.vision}/api`;
    },

    get driveApiBaseUrl() {
        return `${this.endpoints.drive}/api`;
    },

    get chatApiBaseUrl() {
        return `${this.endpoints.chat}/api`;
    },

    get hrmsApiBaseUrl() {
        return `${this.endpoints.hrms}/api`;
    },

    get crmApiBaseUrl() {
        return `${this.endpoints.crm}/api`;
    },

    get crmSignalRHubUrl() {
        return `${this.endpoints.crm}/hubs/crm`;
    },

    get researchApiBaseUrl() {
        return `${this.endpoints.research}/api`;
    },

    get notificationApiBaseUrl() {
        return `${this.endpoints.notification}/api`;
    },

    get pmsApiBaseUrl() {
        return `${this.endpoints.pms}/api`;
    },

    get newsApiBaseUrl() {
        return `${this.endpoints.news}/api`;
    },

    get procurementApiBaseUrl() {
        return `${this.endpoints.procurement}/api`;
    },

    get lmsApiBaseUrl() {
        return `${this.endpoints.lms}/api`;
    },

    get accountsApiBaseUrl() {
        return `${this.endpoints.accounts}/api`;
    },

    get emailApiBaseUrl() {
        return `${this.endpoints.email}/api`;
    },

    get paymentplansApiBaseUrl() {
        return `${this.endpoints.paymentplans}/api`;
    },

    // Legacy alias for backwards compatibility
    get apiBaseUrl() {
        return this.visionApiBaseUrl;
    },

    get signalRHubUrl() {
        return `${this.endpoints.vision}/hubs/chat`;
    },

    get driveSignalRHubUrl() {
        return `${this.endpoints.drive}/hubs/drive`;
    },

    get chatSignalRHubUrl() {
        return `${this.endpoints.chat}/hubs/chat`;
    },

    get emailSignalRHubUrl() {
        return `${this.endpoints.email}/hubs/email`;
    },

    get hrmsSignalRHubUrl() {
        return `${this.endpoints.hrms}/hubs/hrms`;
    },

    // Fetch ICE servers from backend
    async fetchIceServers() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/meetings/ice-servers`);
            if (!response.ok) {
                throw new Error(`Failed to fetch ICE servers: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();

            // Convert backend format to WebRTC ICE server format
            this._cachedIceServers = [
                {
                    urls: data.stun
                }
            ];

            // Add TURN servers if provided (for production with public TURN server)
            if (data.turn && data.turn.urls) {
                this._cachedIceServers.push({
                    urls: data.turn.urls,
                    username: data.turn.username,
                    credential: data.turn.credential
                });
            }

            return this._cachedIceServers;
        } catch (error) {
            console.error('FATAL: Failed to fetch ICE servers from backend:', error);
            throw error;
        }
    },

    // WebRTC ICE server configuration (cached only, no fallback)
    get iceServers() {
        if (this._cachedIceServers) {
            return this._cachedIceServers;
        }

        console.error('ICE servers not loaded. Call fetchIceServers() first.');
        return null;
    }
};

// Freeze the configuration to prevent accidental modifications
// Object.freeze(CONFIG); // Commented out - prevents caching ICE servers
Object.freeze(CONFIG.endpoints);

// Firebase Web App Configuration
// Get these values from Firebase Console → Project Settings → General → Your apps → Web app
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD7hkVEbWubQaK8H1rEOEKFG3aDej_EcCs",
    authDomain: "ragenaizer.firebaseapp.com",
    projectId: "ragenaizer",
    storageBucket: "ragenaizer.firebasestorage.app",
    messagingSenderId: "888674952561",
    appId: "1:888674952561:web:944eea6556fdc87a5a82d0",
    measurementId: "G-60658KXB0N"
};

// Firebase VAPID key for Web Push
// Get from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
const FIREBASE_VAPID_KEY = "BFEO3Txnc6bct_Z_fM_zVvZgZDYrMj-uTCcMwCIIaBrUtk4X2TRoG8mQCaHheN1TBIgmPlVAIXTEPwopjhX1SoM";

Object.freeze(FIREBASE_CONFIG);

// ==================== JWT Storage Utilities ====================
// Centralized functions for JWT token management to avoid key conflicts

/**
 * Store JWT token in localStorage
 * @param {string} token - The JWT token to store
 */
function storeAuthToken(token) {
    localStorage.setItem(`${STORAGE_PREFIX}authToken`, token);
}

/**
 * Retrieve JWT token from localStorage
 * @returns {string|null} The stored JWT token or null if not found
 */
function getAuthToken() {
    return localStorage.getItem(`${STORAGE_PREFIX}authToken`);
}

/**
 * Remove JWT token from localStorage (used during logout)
 */
function removeAuthToken() {
    localStorage.removeItem(`${STORAGE_PREFIX}authToken`);
}

/**
 * Store refresh token in localStorage
 * @param {string} token - The refresh token to store
 */
function storeRefreshToken(token) {
    localStorage.setItem(`${STORAGE_PREFIX}refreshToken`, token);
}

/**
 * Retrieve refresh token from localStorage
 * @returns {string|null} The stored refresh token or null if not found
 */
function getRefreshToken() {
    return localStorage.getItem(`${STORAGE_PREFIX}refreshToken`);
}

/**
 * Remove refresh token from localStorage
 */
function removeRefreshToken() {
    localStorage.removeItem(`${STORAGE_PREFIX}refreshToken`);
}

/**
 * Store token expiry times in localStorage
 * @param {number} accessExpiresIn - Access token expiry time in seconds
 * @param {number} refreshExpiresIn - Refresh token expiry time in seconds
 */
function storeTokenExpiry(accessExpiresIn, refreshExpiresIn) {
    const now = Date.now();
    localStorage.setItem(`${STORAGE_PREFIX}accessTokenExpiry`, (now + accessExpiresIn * 1000).toString());
    localStorage.setItem(`${STORAGE_PREFIX}refreshTokenExpiry`, (now + refreshExpiresIn * 1000).toString());
}

/**
 * Get access token expiry time
 * @returns {number|null} The expiry timestamp in milliseconds or null
 */
function getAccessTokenExpiry() {
    const expiry = localStorage.getItem(`${STORAGE_PREFIX}accessTokenExpiry`);
    return expiry ? parseInt(expiry, 10) : null;
}

/**
 * Get refresh token expiry time
 * @returns {number|null} The expiry timestamp in milliseconds or null
 */
function getRefreshTokenExpiry() {
    const expiry = localStorage.getItem(`${STORAGE_PREFIX}refreshTokenExpiry`);
    return expiry ? parseInt(expiry, 10) : null;
}

/**
 * Check if access token is expired or about to expire (within 5 minutes)
 * @returns {boolean} True if token needs refresh
 */
function isAccessTokenExpired() {
    const expiry = getAccessTokenExpiry();
    if (!expiry) return true;
    // Consider expired if less than 5 minutes remaining
    return Date.now() > (expiry - 5 * 60 * 1000);
}

/**
 * Check if refresh token is expired
 * @returns {boolean} True if refresh token is expired
 */
function isRefreshTokenExpired() {
    const expiry = getRefreshTokenExpiry();
    if (!expiry) return true;
    return Date.now() > expiry;
}

/**
 * Remove token expiry times from localStorage
 */
function removeTokenExpiry() {
    localStorage.removeItem(`${STORAGE_PREFIX}accessTokenExpiry`);
    localStorage.removeItem(`${STORAGE_PREFIX}refreshTokenExpiry`);
}

/**
 * Store user data in localStorage
 * @param {object} user - The user object to store
 */
function storeUser(user) {
    localStorage.setItem(`${STORAGE_PREFIX}user`, JSON.stringify(user));
}

/**
 * Retrieve user data from localStorage
 * @returns {object|null} The stored user object or null if not found
 */
function getStoredUser() {
    const userStr = localStorage.getItem(`${STORAGE_PREFIX}user`);
    return userStr ? JSON.parse(userStr) : null;
}

/**
 * Roles for the current user, preferring the JWT (the authoritative, always-fresh
 * source that every service validates against) and falling back to the stored user
 * object. The stored user is a secondary copy written once at login, so it can be
 * STALE after a role grant or MISSING its roles array — guarding on it fails closed
 * and locks legitimate admins out until they re-login. Decode the token instead.
 */
function getUserRoles() {
    try {
        const token = (typeof getAuthToken === 'function') ? getAuthToken() : null;
        if (token && typeof decodeJwtPayload === 'function') {
            const p = decodeJwtPayload(token);
            if (p) {
                const raw = p['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] || p.role;
                if (raw) return Array.isArray(raw) ? raw : [raw];
            }
        }
    } catch (_) { /* fall through to stored user */ }
    const u = getStoredUser();
    return (u && Array.isArray(u.roles)) ? u.roles : [];
}

/**
 * Remove user data from localStorage (used during logout)
 */
function removeStoredUser() {
    localStorage.removeItem(`${STORAGE_PREFIX}user`);
}

/**
 * Clear all auth data (tokens + user + expiry + organization info) - used for logout
 */
function clearAuthData() {
    // Deactivate FCM token on the backend before clearing auth
    if (typeof deactivateCurrentFcmToken === 'function') {
        deactivateCurrentFcmToken().catch(() => {});
    }
    // Clear FCM localStorage state so next login starts fresh
    if (typeof clearFcmState === 'function') {
        clearFcmState();
    }
    removeAuthToken();
    removeRefreshToken();
    removeTokenExpiry();
    removeStoredUser();
    // Also clear organization/license info cache
    localStorage.removeItem('organization_info');
    localStorage.removeItem(`${STORAGE_PREFIX}tenant_features`);
}

// ==================== Tenant Feature Gating (JWT-based) ====================

/**
 * Get license features from the JWT token's license_features claim.
 * Format: { u: bool (unlocked), k: string (keyType), svc: { Vision: { f: [...], s: bytes, l: {...} } } }
 * Returns null if no token or no features claim.
 */
function getLicenseFeatures() {
    try {
        const token = getAuthToken();
        if (!token) return null;
        const payload = decodeJwtPayload(token);
        if (!payload || !payload.license_features) return null;
        return typeof payload.license_features === 'string'
            ? JSON.parse(payload.license_features)
            : payload.license_features;
    } catch { return null; }
}

/**
 * Check if a feature is enabled for a service.
 * Reads directly from JWT — no API call needed.
 * Returns true for on-premise/SaaS platform (u=true) or if feature is in the list.
 * Returns true if no license data (fail-open).
 * @param {string} serviceName - e.g., 'Vision', 'Drive'
 * @param {string} featureName - e.g., 'recording', 'captions'
 * @returns {boolean}
 */
function isFeatureEnabled(serviceName, featureName) {
    const lf = getLicenseFeatures();
    if (!lf || lf.u) return true; // No data or unlocked = allow all
    const svc = lf.svc?.[serviceName];
    if (!svc) return false; // Service not in license
    const features = svc.f || [];
    return features.includes(featureName);
}

/**
 * Get storage limit for a service (in bytes).
 * Returns null if unlimited or not available.
 * @param {string} serviceName - e.g., 'Drive'
 * @returns {number|null} Storage limit in bytes, or null if unlimited
 */
function getStorageLimit(serviceName) {
    const lf = getLicenseFeatures();
    if (!lf || lf.u) return null; // Unlimited
    const svc = lf.svc?.[serviceName];
    return svc?.s || null;
}

/**
 * Fetch tenant features via API (for usage data which isn't in JWT).
 * Still useful for Drive storage bar showing current usage.
 */
async function fetchAndStoreTenantFeatures() {
    try {
        const token = getAuthToken();
        if (!token) return null;
        const response = await fetch(`${CONFIG.authApiBaseUrl}/tenants/my-features`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data.success) {
            localStorage.setItem(`${STORAGE_PREFIX}tenant_features`, JSON.stringify(data));
            return data;
        }
    } catch (e) {
        console.warn('[Config] Failed to fetch tenant features:', e.message);
    }
    return null;
}

/**
 * Get storage usage info for a service (needs API data, not JWT)
 * @param {string} serviceName - e.g., 'Drive'
 * @returns {object|null} { used, limit, percentage } or null if unlimited/unavailable
 */
function getStorageUsage(serviceName) {
    try {
        const cached = localStorage.getItem(`${STORAGE_PREFIX}tenant_features`);
        if (!cached) return null;
        const features = JSON.parse(cached);
        if (!features || features.isUnlocked) return null;
        const svc = features.services?.[serviceName];
        if (!svc) return null;
        const limit = svc.limits?.storage_bytes;
        if (!limit || limit <= 0) return null;
        const used = svc.usage?.storage_bytes || 0;
        return { used, limit, percentage: Math.round((used / limit) * 100) };
    } catch { return null; }
}

/**
 * Decode JWT token payload (base64 decode, no verification)
 * @param {string} token - The JWT token
 * @returns {object|null} The decoded payload or null if invalid
 */
function decodeJwtPayload(token) {
    try {
        if (!token) return null;
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        // Base64url decode the payload
        const payload = parts[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(padded);
        return JSON.parse(decoded);
    } catch (e) {
        console.warn('Failed to decode JWT:', e);
        return null;
    }
}

/**
 * Extract and store organization info from JWT token
 * @param {string} token - The JWT token containing organization_name and licensed_services claims
 */
function storeOrganizationInfoFromToken(token) {
    const payload = decodeJwtPayload(token);
    if (!payload) return;

    // Parse licensed_services JSON: { "serviceId": "serviceName", ... }
    let licensedServicesMap = {};
    try {
        if (payload.licensed_services) {
            licensedServicesMap = JSON.parse(payload.licensed_services);
        }
    } catch (e) {
        console.warn('Failed to parse licensed_services JSON:', e);
    }

    const orgInfo = {
        organizationName: payload.organization_name || '',
        tenantName: payload.organization_name || '', // Same as org name
        tenantId: payload.tenant_id || null,
        // Full map of serviceId -> serviceName
        licensedServicesMap: licensedServicesMap,
        // Array of service names (for easy filtering/display)
        licensedServices: Object.values(licensedServicesMap),
        // Array of service IDs (for programmatic use)
        licensedServiceIds: Object.keys(licensedServicesMap),
        cachedAt: Date.now()
    };

    localStorage.setItem('organization_info', JSON.stringify(orgInfo));
    return orgInfo;
}

/**
 * Get cached organization info
 * @returns {object|null} The organization info or null
 */
function getOrganizationInfo() {
    const cached = localStorage.getItem('organization_info');
    return cached ? JSON.parse(cached) : null;
}

// Expose globals on window so non-module consumers (e.g., embed/widget.js) can
// read them. Top-level `const` in classic <script> tags goes to script scope,
// not the window object — without these explicit assignments, code that does
// `window.CONFIG?.authApiBaseUrl` silently falls back to localhost in prod.
window.CONFIG = CONFIG;
window.FIREBASE_CONFIG = FIREBASE_CONFIG;
window.FIREBASE_VAPID_KEY = FIREBASE_VAPID_KEY;
