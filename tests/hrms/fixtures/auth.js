/**
 * Authentication fixtures for HRMS Playwright tests
 * Provides login helpers and test user management
 */

const AUTH_API_URL = 'http://localhost:5098';

/**
 * Test users with different role combinations
 */
const TEST_USERS = {
    superAdmin: {
        email: 'admin@hypervision.app',
        password: 'SuperAdmin@123',
        roles: ['SUPERADMIN'],
        description: 'Super admin with full access'
    },
    hrAdmin: {
        email: 'hr.admin@test.com',
        password: 'HrAdmin@123',
        roles: ['HRMS_USER', 'HRMS_HR_ADMIN'],
        description: 'HR Admin - can manage employees, designations'
    },
    hrUser: {
        email: 'hr.user@test.com',
        password: 'HrUser@123',
        roles: ['HRMS_USER', 'HRMS_HR_USER'],
        description: 'HR User - basic HR read access'
    },
    manager: {
        email: 'manager@test.com',
        password: 'Manager@123',
        roles: ['HRMS_USER', 'HRMS_MANAGER'],
        description: 'Manager - can approve team leaves'
    },
    employee: {
        email: 'employee@test.com',
        password: 'Employee@123',
        roles: ['HRMS_USER'],
        description: 'Basic employee - self-service only'
    }
};

/**
 * Login via API and get JWT token
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<{token: string, user: object}>}
 */
async function loginAndGetToken(email, password) {
    const response = await fetch(`${AUTH_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
        throw new Error(`Login failed for ${email}: ${response.status}`);
    }

    const data = await response.json();
    return {
        token: data.token,
        user: {
            id: data.userId,
            email: data.email,
            displayName: data.displayName,
            roles: data.roles || []
        }
    };
}

/**
 * Create a test user with specified roles via API
 * @param {object} page - Playwright page (for token)
 * @param {string} adminToken - Admin JWT token
 * @param {object} userData - User data
 * @returns {Promise<object>} Created user
 */
async function createTestUser(adminToken, userData) {
    const response = await fetch(`${AUTH_API_URL}/api/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            email: userData.email,
            password: userData.password,
            firstName: userData.firstName || 'Test',
            lastName: userData.lastName || 'User',
            roles: userData.roles || ['HRMS_USER']
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create user ${userData.email}: ${error}`);
    }

    return await response.json();
}

/**
 * Login via browser UI and set localStorage token
 * @param {object} page - Playwright page
 * @param {string} email - User email
 * @param {string} password - User password
 */
async function loginViaUI(page, email, password) {
    await page.goto('/pages/login.html');
    await page.waitForLoadState('networkidle');

    // Fill login form
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);

    // Click login button (swipe button)
    const loginBtn = page.locator('.swipe-btn-container');
    await loginBtn.click();

    // Wait for redirect to home or dashboard
    await page.waitForURL(/\/(home|dashboard)\.html/, { timeout: 10000 });
}

/**
 * Set auth token directly in localStorage (faster than UI login)
 * @param {object} page - Playwright page
 * @param {string} token - JWT token
 */
async function setAuthToken(page, token) {
    await page.goto('/');
    await page.evaluate((t) => {
        localStorage.setItem('authToken', t);
    }, token);
}

/**
 * Clear auth token and storage
 * @param {object} page - Playwright page
 */
async function clearAuth(page) {
    await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
}

/**
 * Get user roles from localStorage token
 * @param {object} page - Playwright page
 * @returns {Promise<string[]>} Array of role names
 */
async function getUserRoles(page) {
    return await page.evaluate(() => {
        const token = localStorage.getItem('authToken');
        if (!token) return [];

        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const rolesClaim = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
            return Array.isArray(rolesClaim) ? rolesClaim : [rolesClaim];
        } catch {
            return [];
        }
    });
}

/**
 * Delete test user by email
 * @param {string} adminToken - Admin JWT token
 * @param {string} userId - User ID to delete
 */
async function deleteTestUser(adminToken, userId) {
    await fetch(`${AUTH_API_URL}/api/users/${userId}/permanent`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
}

module.exports = {
    TEST_USERS,
    AUTH_API_URL,
    loginAndGetToken,
    createTestUser,
    loginViaUI,
    setAuthToken,
    clearAuth,
    getUserRoles,
    deleteTestUser
};
