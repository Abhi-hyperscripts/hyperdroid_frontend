/**
 * Rail RBAC — hide left-rail items a user's role can't USE.
 * ========================================================
 * The intra-module CRM pulse-rail was rendered the same for everyone, so a plain
 * rep saw Settings, Sequences and Analytics they can't open. This gates each rail
 * item on the role needed to USE that section — the "hide unless they can fully
 * use it" rule — with a SUPERADMIN bypass.
 *
 * The cross-MODULE app launcher (which apps you can open) is already gated by
 * navigation.js. This is the per-module layer it never had.
 *
 * Roles come from the JWT (the source every module's own gater reads), falling
 * back to the stored user object.
 *
 * Rollout: add a module's { destination-filename → role } map to MODULE_MAPS
 * and include this script on that module's pages (after config.js, so
 * getStoredUser/getAuthToken exist). Destinations NOT listed need no role beyond
 * having reached the module. Only list the ADMIN/manager-gated sections.
 *
 * Modules covered:
 *   CRM      — this script (map below). Verified against the pages 2026-08:
 *              settings/sequences/sequence-builder/analytics/rep-scores/teams-setup
 *              are all CRM_ADMIN-only; the rep-usable sections stay visible.
 *   Accounts — this script. Only Setup is gated (see the accounts map note); the
 *              rest are intentionally read-only-viewable by every accounts role.
 *   HRMS     — NOT here. js/hrms/dashboard.js already gates its own pulse-rail
 *              (applyDashboardRBAC), so we don't add a second source of truth.
 *   Vision/Chat — no intra-module admin sections, BUT their left rail is a
 *              cross-app switcher (hardcoded links to CRM/HRMS/Accounts/PMS/…).
 *              Those are gated cross-module by the target module's access role
 *              (MODULE_ROLES, mirroring navigation.js serviceRoles).
 */
(function () {
    'use strict';

    // destination filename (lower-case) → role required to USE the section.
    const MODULE_MAPS = {
        crm: {
            'settings.html':          'CRM_ADMIN',
            'sequences.html':         'CRM_ADMIN',
            'sequence-builder.html':  'CRM_ADMIN',
            'analytics.html':         'CRM_ADMIN',
            'rep-scores.html':        'CRM_ADMIN',
            'teams-setup.html':       'CRM_ADMIN',
        },
        // Accounts is DELIBERATELY read-only for non-admins: every accounts role
        // reaches every page (accounts-common.js has no per-page hard guard — only
        // canAccess()), and admin-only ACTIONS are hidden per-button via
        // [data-admin-only], while the data stays viewable ("Non-admins see the
        // values read-only", admin.js). So Receivables/Payables/Banking/Ledger/
        // Reports/Taxation/Inventory/POS/Storefront/Parties all carry intended
        // read value and stay in the rail. The ONE rail section that is pure admin
        // configuration with no read purpose for a plain user is Setup (fiscal
        // years, chart-of-accounts templates, tax slabs — every action there is
        // admin-gated). That is the only Accounts rail item we hide.
        accounts: {
            'setup.html':             'ACCOUNTS_ADMIN',
        },
        // PMS: the rail's "Admin" item points at admin.html, which is
        // SUPERADMIN-only (js/pms/admin.js: non-superadmins get a "not superadmin"
        // dead page). Everything else on the rail is usable by any PMS user.
        pms: {
            'admin.html':             'SUPERADMIN',
        },
        // HRMS is intentionally NOT here: its dashboard is the only HRMS page with
        // a rail, and js/hrms/dashboard.js already gates every rail item by role
        // (applyDashboardRBAC → setElementVisibility('railEmployees',
        // canAccessEmployees()), railOrganization, railCompliance, railReports,
        // railPayroll — and redirects plain HRMS_USER to self-service outright).
        // Adding a second gater here would just duplicate that truth and risk
        // drift, so HRMS keeps owning its own rail.
    };

    // Cross-MODULE rail gating. Vision's and Chat's left rail is an app switcher
    // whose items jump to OTHER modules' dashboards (../crm/dashboard.html,
    // /pages/hrms/dashboard.html, …) — hardcoded in HTML, so navigation.js's
    // app-launcher gating never touched them and a Vision-only user saw CRM/HRMS/
    // Accounts/Projects icons that just bounce them. We gate any rail item whose
    // target lands in a DIFFERENT module on that module's access role. Mirrors
    // navigation.js `serviceRoles` (keep in sync).
    const MODULE_ROLES = {
        vision: 'VISION_USER',
        drive: 'DRIVE_USER',
        chat: 'CHAT_USER',
        hrms: 'HRMS_USER',
        crm: 'CRM_USER',
        research: 'RESEARCH_USER',
        pms: 'PMS_USER',
        lms: 'LMS_USER',
        procurement: 'PROCUREMENT_USER',
        accounts: 'ACCOUNTS_USER',
        email: 'EMAILSERVICE_USER',
        paymentplans: 'PAYMENTPLANS_USER',
    };

    function moduleFromPath() {
        const m = location.pathname.match(/\/pages\/([a-z-]+)\//);
        return m ? m[1] : null;
    }

    // The module a rail item's target lands in, e.g. "crm" from
    // "../crm/dashboard.html" or "/pages/crm/dashboard.html". Returns null for
    // targets not under a module folder (home.html, external, or same-page).
    function targetModuleOf(el) {
        const raw = el.getAttribute('onclick') || el.getAttribute('data-href')
            || (el.matches && el.matches('a[href]') ? el.getAttribute('href')
                : (el.querySelector && el.querySelector('a[href]') ? el.querySelector('a[href]').getAttribute('href') : ''))
            || '';
        // /pages/<mod>/...  or  ../<mod>/...  (a sibling-module hop)
        let m = raw.match(/\/pages\/([a-z-]+)\//i) || raw.match(/\.\.\/([a-z-]+)\//i);
        return m ? m[1].toLowerCase() : null;
    }

    // Roles: prefer the JWT, which is the authoritative source every module's own
    // gater reads (accounts-common.js, HRMS roleUtils.js both decode the token).
    // Fall back to the stored user object (CRM's path) if the token helpers aren't
    // present on the page.
    function rolesFromJwt() {
        try {
            if (typeof getAuthToken !== 'function' || typeof decodeJwtPayload !== 'function') return null;
            const token = getAuthToken();
            if (!token) return null;
            const payload = decodeJwtPayload(token);
            if (!payload) return null;
            const raw = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
                     || payload.role || [];
            return Array.isArray(raw) ? raw : [raw];
        } catch (_) { return null; }
    }
    function rolesFromStore() {
        let u = null;
        try {
            u = (typeof getStoredUser === 'function') ? getStoredUser()
                : (window.api && typeof api.getUser === 'function' ? api.getUser() : null);
        } catch (_) { /* not logged in / storage blocked */ }
        return (u && Array.isArray(u.roles)) ? u.roles : [];
    }
    function currentRoles() {
        const jwt = rolesFromJwt();
        if (jwt && jwt.length) return jwt;
        return rolesFromStore();
    }

    // The section a rail item points at. Rails are inconsistent — some use
    // onclick="window.location='x.html'", some onclick="location.href='x.html'",
    // some data-href, some an <a href>. Grab the first quoted *.html target in the
    // onclick rather than key on the exact assignment form. The active
    // (current-page) item has no target — it is the current file.
    function fileOf(s) {
        const m = (s || '').match(/([^'"\/?#\s]+\.html)/i);
        return m ? m[1].toLowerCase() : null;
    }
    function destinationOf(el, currentFile) {
        const fromOnclick = fileOf(el.getAttribute('onclick'));
        if (fromOnclick) return fromOnclick;
        const fromData = fileOf(el.getAttribute('data-href'));
        if (fromData) return fromData;
        const a = el.matches && el.matches('a[href]') ? el : (el.querySelector ? el.querySelector('a[href]') : null);
        const fromHref = a && fileOf(a.getAttribute('href'));
        if (fromHref) return fromHref;
        if (el.classList.contains('active')) return currentFile;
        return null;
    }

    // Role required to keep a rail item, or null to leave it visible. Two layers:
    // (1) cross-module — the item jumps to another module → that module's role;
    // (2) same-module — an ADMIN section listed in the module's map.
    function requiredRole(el, sameMap, currentModule, currentFile) {
        const tgtMod = targetModuleOf(el);
        if (tgtMod && tgtMod !== currentModule && MODULE_ROLES[tgtMod]) {
            return MODULE_ROLES[tgtMod];
        }
        const dest = destinationOf(el, currentFile);
        return (dest && sameMap[dest]) || null;
    }

    function apply(sameMap, roles, currentModule) {
        const isSuper = roles.includes('SUPERADMIN');
        const currentFile = (location.pathname.split('/').pop() || '').toLowerCase();
        document.querySelectorAll('.rail-item, .sidebar-btn').forEach(el => {
            if (el.dataset.railRbac === '1') return;   // already decided
            const req = requiredRole(el, sameMap, currentModule, currentFile);
            // Mark decided only once we could resolve a target (avoids locking in a
            // decision for an item whose href is injected a frame later).
            if (req === null && !targetModuleOf(el) && !destinationOf(el, currentFile)) return;
            el.dataset.railRbac = '1';
            if (req && !isSuper && !roles.includes(req)) {
                el.style.display = 'none';
                el.setAttribute('aria-hidden', 'true');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const mod = moduleFromPath();
        // Run whenever we're on a module page — even with no same-module map, the
        // cross-module app-switcher gating (Vision/Chat rails) still applies.
        if (!mod) return;
        const sameMap = MODULE_MAPS[mod] || {};
        const roles = currentRoles();

        apply(sameMap, roles, mod);
        // rail-drawer.js and JS-rendered sidebars append their items on their own
        // DOMContentLoaded / later; re-apply next frame and on body-child additions.
        requestAnimationFrame(() => apply(sameMap, roles, mod));
        const mo = new MutationObserver(() => apply(sameMap, roles, mod));
        mo.observe(document.body, { childList: true });
    });
})();
