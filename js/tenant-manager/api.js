// TenantManager API Client
class TenantManagerAPI {
    constructor() {
        this.baseUrl = CONFIG.apiBaseUrl;
        this.storagePrefix = CONFIG.storagePrefix;
        this.token = localStorage.getItem(`${this.storagePrefix}authToken`);
    }

    // ==================== Authentication ====================

    async login(email, password) {
        const response = await fetch(`${this.baseUrl}${CONFIG.endpoints.login}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Login failed');
        }

        const data = await response.json();
        this.token = data.token;
        localStorage.setItem(`${this.storagePrefix}authToken`, data.token);
        localStorage.setItem(`${this.storagePrefix}user`, JSON.stringify(data.user));
        return data;
    }

    async validateToken() {
        if (!this.token) return null;

        try {
            const response = await fetch(`${this.baseUrl}${CONFIG.endpoints.validate}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!response.ok) {
                this.logout();
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('Token validation error:', error);
            return null;
        }
    }

    logout() {
        this.token = null;
        localStorage.removeItem(`${this.storagePrefix}authToken`);
        localStorage.removeItem(`${this.storagePrefix}user`);
        window.location.href = 'login.html';
    }

    isAuthenticated() {
        return !!this.token;
    }

    getUser() {
        const userStr = localStorage.getItem(`${this.storagePrefix}user`);
        return userStr ? JSON.parse(userStr) : null;
    }

    // ==================== Tenants ====================

    async getTenants(includeInactive = false) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}?includeInactive=${includeInactive}`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch tenants');
        return await response.json();
    }

    async getTenant(tenantId) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch tenant');
        return await response.json();
    }

    async getTenantDetails(tenantId) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/details`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch tenant details');
        return await response.json();
    }

    async getSubTenants(parentTenantId, includeInactive = false) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${parentTenantId}/sub-tenants?includeInactive=${includeInactive}`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch sub-tenants');
        return await response.json();
    }

    async createTenant(tenantData) {
        const response = await fetch(`${this.baseUrl}${CONFIG.endpoints.tenants}`, {
            method: 'POST',
            headers: this._getHeaders(),
            body: JSON.stringify(tenantData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create tenant');
        }
        return await response.json();
    }

    async updateTenant(tenantId, tenantData) {
        const response = await fetch(`${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}`, {
            method: 'PUT',
            headers: this._getHeaders(),
            body: JSON.stringify(tenantData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update tenant');
        }
        return await response.json();
    }

    async deleteTenant(tenantId) {
        const response = await fetch(`${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}`, {
            method: 'DELETE',
            headers: this._getHeaders()
        });

        if (!response.ok) throw new Error('Failed to delete tenant');
        return await response.json();
    }

    // ==================== Services ====================

    async getTenantServices(tenantId) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/services`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch tenant services');
        return await response.json();
    }

    async addService(tenantId, serviceData) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/services`,
            {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify(serviceData)
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to add service');
        }
        return await response.json();
    }

    async removeService(tenantId, serviceName) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/services/${encodeURIComponent(serviceName)}`,
            { method: 'DELETE', headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to remove service');
        return await response.json();
    }

    // ==================== Features ====================

    async getTenantFeatures(tenantId) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/features`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch tenant features');
        return await response.json();
    }

    async addFeature(tenantId, featureName) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/features`,
            {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify({ featureName })
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to add feature');
        }
        return await response.json();
    }

    async removeFeature(tenantId, featureName) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/features/${encodeURIComponent(featureName)}`,
            { method: 'DELETE', headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to remove feature');
        return await response.json();
    }

    // ==================== Master Services ====================

    async getServices(includeInactive = false) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.services}?includeInactive=${includeInactive}`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch services');
        return await response.json();
    }

    async getService(serviceId) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.services}/${serviceId}`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch service');
        return await response.json();
    }

    async createService(serviceData) {
        const response = await fetch(`${this.baseUrl}${CONFIG.endpoints.services}`, {
            method: 'POST',
            headers: this._getHeaders(),
            body: JSON.stringify(serviceData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create service');
        }
        return await response.json();
    }

    async updateService(serviceId, serviceData) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.services}/${serviceId}`,
            {
                method: 'PUT',
                headers: this._getHeaders(),
                body: JSON.stringify(serviceData)
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update service');
        }
        return await response.json();
    }

    async deleteService(serviceId) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.services}/${serviceId}`,
            { method: 'DELETE', headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to deactivate service');
        return await response.json();
    }

    // ==================== Service Features ====================

    async getServiceFeatures(serviceId, includeInactive = false) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.services}/${serviceId}/features?includeInactive=${includeInactive}`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch service features');
        return await response.json();
    }

    async createServiceFeature(serviceId, featureData) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.services}/${serviceId}/features`,
            {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify(featureData)
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create feature');
        }
        return await response.json();
    }

    async updateServiceFeature(featureId, featureData) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.services}/features/${featureId}`,
            {
                method: 'PUT',
                headers: this._getHeaders(),
                body: JSON.stringify(featureData)
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update feature');
        }
        return await response.json();
    }

    async deleteServiceFeature(featureId) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.services}/features/${featureId}`,
            { method: 'DELETE', headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to deactivate feature');
        return await response.json();
    }

    // ==================== Licenses ====================

    async getTenantLicenses(tenantId) {
        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/licenses`,
            { headers: this._getHeaders() }
        );

        if (!response.ok) throw new Error('Failed to fetch tenant licenses');
        return await response.json();
    }

    async generateLicense(tenantId, startDate, expiryDate, notes = '', selectedServiceIds = null, keyType = 'on-premise', platformId = null) {
        const body = { startDate, expiryDate, notes, keyType };
        if (selectedServiceIds && selectedServiceIds.length > 0) {
            body.selectedServiceIds = selectedServiceIds;
        }
        if (platformId) {
            body.platformId = platformId;
        }

        const response = await fetch(
            `${this.baseUrl}${CONFIG.endpoints.tenants}/${tenantId}/licenses`,
            {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify(body)
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to generate license');
        }
        return await response.json();
    }

    async verifyLicense(encryptedToken) {
        const response = await fetch(`${this.baseUrl}${CONFIG.endpoints.verifyLicense}`, {
            method: 'POST',
            headers: this._getHeaders(),
            body: JSON.stringify({ encryptedToken })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to verify license');
        }
        return await response.json();
    }

    // ==================== Helpers ====================

    _getHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
        };
    }
}

// Create global API instance
const api = new TenantManagerAPI();
