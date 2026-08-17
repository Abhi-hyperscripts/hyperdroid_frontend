// Every module's pages must BOOT — no syntax error, no missing symbol.
//
// Written alongside the escaper-quote-safety fix, which rewrote 72 escaper
// definitions and 59 call sites across 66 files in eight modules. `node --check`
// proves each file parses standalone; it cannot prove the page that loads it
// comes up, and a rewrite that swaps a call site but misses a helper definition
// fails only at render time with a ReferenceError. That happened once during
// the rewrite (js/crm/settings.js) and was caught by a source check; this is
// the runtime half.
//
// Deliberately shallow: it asserts the page boots, not what it shows. These
// pages redirect to login without a session, and asserting content would need
// the whole backend up. A boot check needs nothing but the static server and
// catches the entire class of "the bundle is broken" — which is what a
// mechanical source rewrite risks.
//
// Run: npm run serve   (in another shell), then npx playwright test tests/security

const { test, expect } = require('@playwright/test');

const PAGES = [
    // CRM — the module whose inline handlers were rewritten
    '/pages/crm/leads.html',
    '/pages/crm/settings.html',
    '/pages/crm/deals.html',
    '/pages/crm/contacts.html',
    '/pages/crm/companies.html',
    // the other modules whose escapers changed
    '/pages/hrms/employees.html',
    '/pages/hrms/payroll.html',
    '/pages/pms/projects.html',
    '/pages/accounts/dashboard.html',
    '/pages/drive/drive.html',
];

// Only failures that mean the JS is broken. A page without a session logs
// plenty of 401s and failed fetches, and none of that is what this guards.
const FATAL = /SyntaxError|ReferenceError|is not defined|Unexpected token|Invalid or unexpected/;

for (const p of PAGES) {
    test(`boots without a script error: ${p}`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

        const res = await page.goto(p, { waitUntil: 'domcontentloaded' });

        // Floor: if the static server is not up, every assertion below is
        // vacuous — an empty error list would "pass" for a page never loaded.
        expect(res, `no response for ${p} — is the static server running? (npm run serve)`).not.toBeNull();
        expect(res.status(), `${p} did not load`).toBeLessThan(400);

        await page.waitForTimeout(1200);

        const fatal = errors.filter(e => FATAL.test(e));
        expect(fatal, `${p} raised a fatal script error`).toEqual([]);
    });
}
