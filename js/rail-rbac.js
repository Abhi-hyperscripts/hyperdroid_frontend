/**
 * Rail RBAC — hide left-rail items a user's role can't USE.
 * ========================================================
 * The intra-module rails (CRM pulse-rail, Accounts sidebar, HRMS sidebar …)
 * were rendered the same for everyone, so a plain rep saw Settings, Sequences
 * and Analytics they can't open. This gates each rail item on the role needed
 * to USE that section — the "hide unless they can fully use it" rule — with a
 * SUPERADMIN bypass.
 *
 * The cross-MODULE app launcher (which apps you can open) is already gated by
 * navigation.js. This is the per-module layer it never had.
 *
 * Rollout: add a module's { destination-filename → role } map to MODULE_MAPS
 * and include this script on that module's pages (after config.js, so
 * getStoredUser exists). Destinations NOT listed need no role beyond having
 * reached the module. Only list the ADMIN/manager-gated sections.
 *
 * Source of the CRM map (verified against the pages themselves, 2026-08):
 *   settings.html    settings.js: "Only CRM_ADMIN or SUPERADMIN can access settings"
 *   sequences.html   create/manage is CRM_ADMIN (rep can only view — hidden under the strict rule)
 *   analytics.html   analytics.js: "CRM analytics dashboard — SUPERADMIN view"
 *   rep-scores.html  rep-scores.js: "Admin-only endpoint (CRM_ADMIN / SUPERADMIN)"
 *   teams-setup.html teams-setup.js: "Page is already gated to CRM_ADMIN/SUPERADMIN"
 *   dashboard/my-day/tasks/leads/deals/contacts/calls/whatsapp — rep-usable, left visible.
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
        // accounts: { ... }, hrms: { ... } added during rollout.
    };

    function moduleFromPath() {
        const m = location.pathname.match(/\/pages\/([a-z-]+)\//);
        return m ? m[1] : null;
    }

    function currentRoles() {
        let u = null;
        try {
            u = (typeof getStoredUser === 'function') ? getStoredUser()
                : (window.api && typeof api.getUser === 'function' ? api.getUser() : null);
        } catch (_) { /* not logged in / storage blocked */ }
        return (u && Array.isArray(u.roles)) ? u.roles : [];
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

    function apply(map, roles) {
        const isSuper = roles.includes('SUPERADMIN');
        const currentFile = (location.pathname.split('/').pop() || '').toLowerCase();
        document.querySelectorAll('.rail-item, .sidebar-btn').forEach(el => {
            if (el.dataset.railRbac === '1') return;   // already decided
            const dest = destinationOf(el, currentFile);
            if (!dest) return;
            el.dataset.railRbac = '1';
            const req = map[dest];
            if (req && !isSuper && !roles.includes(req)) {
                el.style.display = 'none';
                el.setAttribute('aria-hidden', 'true');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const mod = moduleFromPath();
        const map = mod && MODULE_MAPS[mod];
        if (!map) return;
        const roles = currentRoles();

        apply(map, roles);
        // rail-drawer.js and JS-rendered sidebars append their items on their own
        // DOMContentLoaded / later; re-apply next frame and on body-child additions.
        requestAnimationFrame(() => apply(map, roles));
        const mo = new MutationObserver(() => apply(map, roles));
        mo.observe(document.body, { childList: true });
    });
})();
