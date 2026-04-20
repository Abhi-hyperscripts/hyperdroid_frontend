// ─────────────────────────────────────────────────────────────────────────
// CRM setup guard
//
// Before we let a user land on a workflow page that hard-depends on the
// tenant being configured (functional groups + at least one team), check
// the state and bounce them to Settings → Functional Groups if anything
// is missing. Otherwise someone pastes /pages/crm/leads.html into the URL
// bar and lands on a page where every interaction (assign, bulk-assign,
// reassign, campaign) will fail server-side.
//
// Usage (top of a page-init script):
//    if (await CrmSetupGuard.ensureConfigured()) {
//        // guard redirected; bail so nothing else runs
//        return;
//    }
//
// The guard short-circuits:
//   - If the page already carries ?setup-bypass=1 (for deep-links from
//     Settings itself we don't want an infinite bounce).
//   - If the caller is on settings.html (that's where we're sending them).
//
// Target page after bounce: settings.html?tab=functional-groups&setup=1
// settings.js + teams-setup.js render a banner based on ?setup=1 so the
// user knows why they landed there.
// ─────────────────────────────────────────────────────────────────────────

window.CrmSetupGuard = (function () {
    async function fetchStatus() {
        try {
            const [fgs, teams] = await Promise.all([
                api.request('/crm/functional-areas'),
                api.request('/crm/teams'),
            ]);
            const fgArr = Array.isArray(fgs) ? fgs : (fgs && fgs.items) || [];
            const teamArr = Array.isArray(teams) ? teams : (teams && teams.items) || [];
            return {
                hasFunctionalGroups: fgArr.length > 0,
                hasTeams: teamArr.length > 0,
                functionalGroupCount: fgArr.length,
                teamCount: teamArr.length,
            };
        } catch (e) {
            // If the probe itself fails (auth expired, network) we fall
            // through — the page's own error handling will surface it.
            // Blocking the page for a network blip would be worse.
            console.warn('[setup-guard] probe failed, letting page load:', e);
            return null;
        }
    }

    async function ensureConfigured() {
        try {
            const path = (window.location.pathname || '').toLowerCase();
            const params = new URLSearchParams(window.location.search);
            if (params.get('setup-bypass') === '1') return false;
            if (path.endsWith('/settings.html')) return false;

            const status = await fetchStatus();
            if (!status) return false;                 // network hiccup — don't block
            if (status.hasFunctionalGroups && status.hasTeams) return false;

            // Prefer the functional-groups tab when *it* is the gap, else
            // drop the user on Teams setup directly.
            const tab = status.hasFunctionalGroups ? 'teams' : 'functional-groups';
            const target = `settings.html?tab=${tab}&setup=1&t=${Date.now()}`;
            // Use replace so the back button doesn't trap them in a bounce
            // loop between leads.html → settings.html → leads.html.
            window.location.replace(target);
            return true;
        } catch (e) {
            console.warn('[setup-guard] unexpected error, letting page load:', e);
            return false;
        }
    }

    return { ensureConfigured, fetchStatus };
})();
