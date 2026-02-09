/**
 * Ragenaizer Frontend Configuration
 *
 * Centralized endpoint configuration for easy environment switching.
 * Auto-detects environment based on hostname.
 */

// SW_VERSION must stay here for backwards compatibility.
// Old service workers (v6 and earlier) fetch config.js every 30s and parse
// this line via regex to detect updates. Without it, they can NEVER update.
// The SW itself reads from /js/sw-version.js via importScripts.
// IMPORTANT: Keep this value in sync with /js/sw-version.js!
const SW_VERSION = 48;

// Environment configurations
const ENVIRONMENTS = {
    local: {
        auth: 'https://localhost:5098',
        vision: 'https://localhost:5099',
        drive: 'https://localhost:5100',
        chat: 'https://localhost:5102',
        hrms: 'https://localhost:5104',
        notification: 'http://localhost:5110'
    },
    production: {
        auth: 'https://auth.ragenaizer.com',
        vision: 'https://vision.ragenaizer.com',
        drive: 'https://drive.ragenaizer.com',
        chat: 'https://chat.ragenaizer.com',
        hrms: 'https://hrms.ragenaizer.com',
        notification: 'https://notification.ragenaizer.com'
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

    get notificationApiBaseUrl() {
        return `${this.endpoints.notification}/api`;
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
