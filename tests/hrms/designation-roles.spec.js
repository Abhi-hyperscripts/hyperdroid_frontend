/**
 * HRMS Designation Roles Tests
 * Tests the new default_hrms_roles feature for designations
 *
 * Run with: npx playwright test tests/hrms/designation-roles.spec.js
 */

const { test, expect } = require('@playwright/test');
const {
    TEST_USERS,
    loginAndGetToken,
    setAuthToken,
    clearAuth
} = require('./fixtures/auth');

const HRMS_API_URL = 'http://localhost:5104';
const BASE_URL = 'http://localhost:5501';

// Test data
let adminToken = null;
let testDepartmentId = null;
let testDesignationId = null;

test.describe('HRMS Designation Roles', () => {

    test.beforeAll(async () => {
        // Get admin token for API calls
        const auth = await loginAndGetToken(
            TEST_USERS.superAdmin.email,
            TEST_USERS.superAdmin.password
        );
        adminToken = auth.token;

        // Create a test department for designations
        const deptResponse = await fetch(`${HRMS_API_URL}/api/departments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                department_name: 'Test Department for Roles',
                department_code: 'TEST-ROLE-DEPT',
                description: 'Test department for designation role tests'
            })
        });

        if (deptResponse.ok) {
            const dept = await deptResponse.json();
            testDepartmentId = dept.id;
        }
    });

    test.afterAll(async () => {
        // Cleanup: delete test designation
        if (testDesignationId && adminToken) {
            await fetch(`${HRMS_API_URL}/api/designations/${testDesignationId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
        }

        // Cleanup: delete test department
        if (testDepartmentId && adminToken) {
            await fetch(`${HRMS_API_URL}/api/departments/${testDepartmentId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
        }
    });

    test.beforeEach(async ({ page }) => {
        await clearAuth(page);
    });

    test('API: Create designation with multiple roles', async ({ request }) => {
        const response = await request.post(`${HRMS_API_URL}/api/designations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'Test Manager Designation',
                designation_code: 'TEST-MGR',
                department_id: testDepartmentId,
                level: 3,
                default_hrms_roles: ['HRMS_USER', 'HRMS_MANAGER', 'HRMS_HR_USER']
            }
        });

        expect(response.ok()).toBeTruthy();

        const designation = await response.json();
        testDesignationId = designation.id;

        // Verify roles are saved correctly
        expect(designation.default_hrms_roles).toContain('HRMS_USER');
        expect(designation.default_hrms_roles).toContain('HRMS_MANAGER');
        expect(designation.default_hrms_roles).toContain('HRMS_HR_USER');
        expect(designation.default_hrms_roles).toHaveLength(3);

        // Verify backwards compatibility - is_manager should be true
        expect(designation.is_manager).toBe(true);
    });

    test('API: HRMS_USER is always included in roles', async ({ request }) => {
        // Create designation with only HRMS_MANAGER (no HRMS_USER specified)
        const response = await request.post(`${HRMS_API_URL}/api/designations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'Test Auto User Role',
                designation_code: 'TEST-AUTO',
                department_id: testDepartmentId,
                level: 2,
                default_hrms_roles: ['HRMS_MANAGER']  // Only manager, no HRMS_USER
            }
        });

        expect(response.ok()).toBeTruthy();

        const designation = await response.json();

        // HRMS_USER should be automatically included
        expect(designation.default_hrms_roles).toContain('HRMS_USER');
        expect(designation.default_hrms_roles).toContain('HRMS_MANAGER');

        // Cleanup
        await request.delete(`${HRMS_API_URL}/api/designations/${designation.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
    });

    test('API: Create HR Admin designation', async ({ request }) => {
        const response = await request.post(`${HRMS_API_URL}/api/designations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'HR Administrator',
                designation_code: 'HR-ADMIN',
                department_id: testDepartmentId,
                level: 5,
                default_hrms_roles: ['HRMS_USER', 'HRMS_HR_ADMIN']
            }
        });

        expect(response.ok()).toBeTruthy();

        const designation = await response.json();

        expect(designation.default_hrms_roles).toContain('HRMS_USER');
        expect(designation.default_hrms_roles).toContain('HRMS_HR_ADMIN');
        // Should NOT have HRMS_MANAGER
        expect(designation.default_hrms_roles).not.toContain('HRMS_MANAGER');
        // is_manager should be false since no HRMS_MANAGER role
        expect(designation.is_manager).toBe(false);

        // Cleanup
        await request.delete(`${HRMS_API_URL}/api/designations/${designation.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
    });

    test('API: Get designation returns roles array', async ({ request }) => {
        // First create a designation
        const createResponse = await request.post(`${HRMS_API_URL}/api/designations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'Full Access Role',
                designation_code: 'FULL-ACCESS',
                department_id: testDepartmentId,
                level: 10,
                default_hrms_roles: ['HRMS_USER', 'HRMS_MANAGER', 'HRMS_ADMIN', 'HRMS_HR_ADMIN']
            }
        });

        expect(createResponse.ok()).toBeTruthy();
        const created = await createResponse.json();

        // Get the designation
        const getResponse = await request.get(`${HRMS_API_URL}/api/designations/${created.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        expect(getResponse.ok()).toBeTruthy();
        const designation = await getResponse.json();

        expect(designation.default_hrms_roles).toHaveLength(4);
        expect(designation.default_hrms_roles).toEqual(
            expect.arrayContaining(['HRMS_USER', 'HRMS_MANAGER', 'HRMS_ADMIN', 'HRMS_HR_ADMIN'])
        );

        // Cleanup
        await request.delete(`${HRMS_API_URL}/api/designations/${created.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
    });

    test('API: Update designation roles', async ({ request }) => {
        // First create a designation
        const createResponse = await request.post(`${HRMS_API_URL}/api/designations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'Updatable Designation',
                designation_code: 'UPDATE-TEST',
                department_id: testDepartmentId,
                level: 1,
                default_hrms_roles: ['HRMS_USER']
            }
        });

        const created = await createResponse.json();
        expect(created.default_hrms_roles).toEqual(['HRMS_USER']);
        expect(created.is_manager).toBe(false);

        // Update to add manager role
        const updateResponse = await request.put(`${HRMS_API_URL}/api/designations/${created.id}`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'Updatable Designation',
                designation_code: 'UPDATE-TEST',
                department_id: testDepartmentId,
                level: 3,
                default_hrms_roles: ['HRMS_USER', 'HRMS_MANAGER', 'HRMS_HR_USER']
            }
        });

        expect(updateResponse.ok()).toBeTruthy();
        const updated = await updateResponse.json();

        expect(updated.default_hrms_roles).toHaveLength(3);
        expect(updated.default_hrms_roles).toContain('HRMS_MANAGER');
        expect(updated.is_manager).toBe(true);

        // Cleanup
        await request.delete(`${HRMS_API_URL}/api/designations/${created.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
    });

    test('UI: Organization page shows role checkboxes in designation form', async ({ page }) => {
        // Login as admin
        await setAuthToken(page, adminToken);
        await page.goto(`${BASE_URL}/pages/hrms/organization.html`);
        await page.waitForLoadState('networkidle');

        // Click Designations tab
        await page.click('text=Designations');
        await page.waitForTimeout(500);

        // Click Add Designation button
        await page.click('button:has-text("Add Designation")');
        await page.waitForTimeout(500);

        // Verify role checkboxes exist
        const hrmsUserCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_USER"]');
        const hrmsManagerCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_MANAGER"]');
        const hrmsAdminCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_ADMIN"]');
        const hrmsHrUserCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_HR_USER"]');
        const hrmsHrAdminCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_HR_ADMIN"]');
        const hrmsHrManagerCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_HR_MANAGER"]');

        // All 6 role checkboxes should exist
        await expect(hrmsUserCheckbox).toBeVisible();
        await expect(hrmsManagerCheckbox).toBeVisible();
        await expect(hrmsAdminCheckbox).toBeVisible();
        await expect(hrmsHrUserCheckbox).toBeVisible();
        await expect(hrmsHrAdminCheckbox).toBeVisible();
        await expect(hrmsHrManagerCheckbox).toBeVisible();

        // HRMS_USER should be checked and disabled by default
        await expect(hrmsUserCheckbox).toBeChecked();
        await expect(hrmsUserCheckbox).toBeDisabled();
    });

    test('UI: Create designation with selected roles', async ({ page }) => {
        // Login as admin
        await setAuthToken(page, adminToken);
        await page.goto(`${BASE_URL}/pages/hrms/organization.html`);
        await page.waitForLoadState('networkidle');

        // Click Designations tab
        await page.click('text=Designations');
        await page.waitForTimeout(500);

        // Click Add Designation button
        await page.click('button:has-text("Add Designation")');
        await page.waitForTimeout(500);

        // Fill form
        await page.fill('#designationName', 'UI Test Designation');
        await page.fill('#designationCode', 'UI-TEST');

        // Select department from dropdown
        const deptSelect = page.locator('#designationDept');
        await deptSelect.selectOption({ index: 1 });  // Select first department

        await page.fill('#designationLevel', '5');

        // Select additional roles
        await page.check('input[name="hrmsRoles"][value="HRMS_MANAGER"]');
        await page.check('input[name="hrmsRoles"][value="HRMS_HR_USER"]');

        // Submit form
        await page.click('button:has-text("Save Designation")');
        await page.waitForTimeout(1000);

        // Verify designation appears in table with role tags
        const roleTagManager = page.locator('td:has-text("MGR")');
        const roleTagHr = page.locator('td:has-text("HR")');

        // At least one row should show the roles
        await expect(roleTagManager.first()).toBeVisible({ timeout: 5000 });
    });

    test('UI: Edit designation shows existing roles', async ({ page }) => {
        // First create a designation via API
        const createResponse = await fetch(`${HRMS_API_URL}/api/designations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                designation_name: 'Edit Test Designation',
                designation_code: 'EDIT-TEST',
                department_id: testDepartmentId,
                level: 4,
                default_hrms_roles: ['HRMS_USER', 'HRMS_MANAGER', 'HRMS_HR_ADMIN']
            })
        });
        const created = await createResponse.json();

        // Login and go to organization page
        await setAuthToken(page, adminToken);
        await page.goto(`${BASE_URL}/pages/hrms/organization.html`);
        await page.waitForLoadState('networkidle');

        // Click Designations tab
        await page.click('text=Designations');
        await page.waitForTimeout(500);

        // Find and click edit button for our test designation
        const row = page.locator(`tr:has-text("Edit Test Designation")`);
        await row.locator('button:has(.fa-edit)').click();
        await page.waitForTimeout(500);

        // Verify checkboxes are correctly set
        const hrmsUserCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_USER"]');
        const hrmsManagerCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_MANAGER"]');
        const hrmsHrAdminCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_HR_ADMIN"]');
        const hrmsAdminCheckbox = page.locator('input[name="hrmsRoles"][value="HRMS_ADMIN"]');

        await expect(hrmsUserCheckbox).toBeChecked();
        await expect(hrmsManagerCheckbox).toBeChecked();
        await expect(hrmsHrAdminCheckbox).toBeChecked();
        await expect(hrmsAdminCheckbox).not.toBeChecked();

        // Cleanup
        await fetch(`${HRMS_API_URL}/api/designations/${created.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
    });

    test('UI: Designations table shows role tags', async ({ page }) => {
        // Login as admin
        await setAuthToken(page, adminToken);
        await page.goto(`${BASE_URL}/pages/hrms/organization.html`);
        await page.waitForLoadState('networkidle');

        // Click Designations tab
        await page.click('text=Designations');
        await page.waitForTimeout(1000);

        // Check that the Roles column exists
        const rolesHeader = page.locator('th:has-text("Roles")');
        await expect(rolesHeader).toBeVisible();

        // Check that role tags are displayed (at least USER tag should exist)
        const userTags = page.locator('.role-tag.role-user');
        const tagCount = await userTags.count();
        expect(tagCount).toBeGreaterThan(0);
    });
});

test.describe('HRMS Role Validation', () => {
    let adminToken = null;

    test.beforeAll(async () => {
        const auth = await loginAndGetToken(
            TEST_USERS.superAdmin.email,
            TEST_USERS.superAdmin.password
        );
        adminToken = auth.token;
    });

    test('API: Invalid role name returns error', async ({ request }) => {
        const response = await request.post(`${HRMS_API_URL}/api/designations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'Invalid Role Test',
                designation_code: 'INVALID-ROLE',
                level: 1,
                default_hrms_roles: ['HRMS_USER', 'INVALID_ROLE']
            }
        });

        // Should fail with bad request
        expect(response.status()).toBe(400);
    });

    test('API: Empty roles array defaults to HRMS_USER', async ({ request }) => {
        const response = await request.post(`${HRMS_API_URL}/api/designations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'Empty Roles Test',
                designation_code: 'EMPTY-ROLES',
                level: 1,
                default_hrms_roles: []
            }
        });

        if (response.ok()) {
            const designation = await response.json();
            // Should default to HRMS_USER
            expect(designation.default_hrms_roles).toContain('HRMS_USER');

            // Cleanup
            await request.delete(`${HRMS_API_URL}/api/designations/${designation.id}`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
        }
    });

    test('API: Null roles defaults to HRMS_USER', async ({ request }) => {
        const response = await request.post(`${HRMS_API_URL}/api/designations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            data: {
                designation_name: 'Null Roles Test',
                designation_code: 'NULL-ROLES',
                level: 1
                // default_hrms_roles not specified
            }
        });

        if (response.ok()) {
            const designation = await response.json();
            // Should default to HRMS_USER
            expect(designation.default_hrms_roles).toContain('HRMS_USER');

            // Cleanup
            await request.delete(`${HRMS_API_URL}/api/designations/${designation.id}`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
        }
    });
});
