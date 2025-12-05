/**
 * HyperVision Frontend Configuration
 *
 * Centralized endpoint configuration for easy environment switching.
 * Auto-detects environment based on hostname.
 */

// Environment configurations
const ENVIRONMENTS = {
    local: {
        auth: 'http://localhost:5098',
        vision: 'http://localhost:5099',
        drive: 'http://localhost:5100',
        chat: 'http://localhost:5102'
    },
    production: {
        auth: 'https://auth.hyperdroid.io',
        vision: 'https://vision.hyperdroid.io',
        drive: 'https://drive.hyperdroid.io',
        chat: 'https://chat.hyperdroid.io'
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

const CONFIG = {
    // Current environment
    environment: currentEnv,

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
