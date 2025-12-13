// Playwright configuration for HRMS frontend tests
// Run with: npx playwright test

module.exports = {
    testDir: './tests',
    timeout: 60000,
    retries: 1,
    use: {
        baseURL: 'http://localhost:5501',
        headless: true,
        viewport: { width: 1280, height: 720 },
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
    webServer: {
        command: 'python3 -m http.server 5501',
        port: 5501,
        timeout: 120000,
        reuseExistingServer: true,
    },
};
