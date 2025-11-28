/**
 * HyperVision Frontend Configuration
 *
 * Centralized endpoint configuration for easy environment switching.
 * Update these values when deploying to different environments (home/office/production).
 */

const CONFIG = {
    // Service Endpoints - Each microservice runs independently
    endpoints: {
        // Authentication Service (handles /api/auth/* endpoints)
        auth: 'http://localhost:5098',

        // Vision Service (handles /api/projects/*, /api/meetings/*, SignalR hubs)
        vision: 'http://localhost:5099',

        // Drive Service (handles /api/drive/* endpoints) - Independent microservice
        drive: 'http://localhost:5100'

        // LiveKit WebSocket URL (obtained from backend token endpoint)
        // TURN/STUN servers (fetched from backend at runtime)
    },

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
