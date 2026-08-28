/**
 * ⭐ THE ACCOUNTS RAIL — ONE DEFINITION, TWO RENDERERS.
 *
 * This list used to exist in 23 places: hand-written into the dashboard's fixed
 * <nav class="pulse-rail">, and copy-pasted as an inline window.RAIL_DRAWER_ITEMS
 * into each of the other 22 pages. rail-drawer.js's own header already warned that
 * a second definition of one navigation "silently fell three modules behind" in
 * CRM. The Accounts copies had drifted too, in BOTH directions:
 *
 *   · the dashboard rail carried Purchase orders; the drawer did not
 *   · the drawer carried Storefront and Ledger; the dashboard rail did not
 *   · the same two destinations were labelled "Money in" / "Money out" on the
 *     dashboard and "Receivables" / "Payables" on every other page
 *
 * So a user learned one vocabulary and one set of destinations on the landing
 * page and met a different set everywhere else. Reconciled here to the UNION,
 * with the drawer's nouns — a rail is a list of places, not of tasks.
 *
 * Load this BEFORE js/rail-drawer.js: it publishes window.RAIL_DRAWER_ITEMS,
 * which is what that script reads. The dashboard additionally calls
 * AccountsRail.renderInto(el) to fill its own fixed rail from the same array,
 * which is the whole point — there is now no way to add a destination to one
 * surface and forget the other.
 */
(function () {
    'use strict';

    const ITEMS = [
        { href: 'dashboard.html',   title: 'Dashboard',   color: '#60A5FA', svg: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
        { href: 'receivables.html', title: 'Receivables', color: '#22c55e', svg: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>' },
        { href: 'payables.html',    title: 'Payables',    color: '#ef4444', svg: '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>' },
        { href: 'banking.html',     title: 'Banking',     color: '#4CC9F0', svg: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>' },
        { href: 'inventory.html',   title: 'Inventory',   color: '#FB923C', svg: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>' },
        { href: 'pos.html',         title: 'POS',         color: '#A78BFA', svg: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
        { href: 'purchase-orders.html', title: 'Purchase orders', color: '#A78BFA', svg: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>' },
        { href: 'storefront.html',  title: 'Storefront',  color: '#14b8a6', svg: '<path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M3 9h18"/>' },
        { href: 'ledger.html',      title: 'Ledger',      color: '#F472B6', svg: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
        { href: 'reports.html',     title: 'Reports',     color: '#34d399', svg: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
        { href: 'taxation.html',    title: 'Taxation',    color: '#eab308', svg: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>' },
        { href: 'parties.html',     title: 'Parties',     color: '#2DD4BF', svg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
        { href: 'setup.html',       title: 'Setup',       color: 'var(--text-muted)', svg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
    ];

    // Consumed by js/rail-drawer.js on the 22 non-dashboard pages.
    window.ACCOUNTS_RAIL_ITEMS = ITEMS;
    window.RAIL_DRAWER_ITEMS = ITEMS;

    /**
     * Render the same items into the dashboard's fixed rail. The markup matches
     * rail-drawer.js exactly (.rail-item > .ric > svg, then a label span), so both
     * surfaces are styled by one set of CSS rules and cannot drift visually either.
     *
     * The active item is derived from the filename, so the dashboard's own entry
     * highlights itself without a hand-maintained `active` class.
     */
    function renderInto(el) {
        if (!el) return;
        const here = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
        el.innerHTML = ITEMS.map(it => {
            const active = it.href.toLowerCase() === here;
            return '<button type="button" class="rail-item' + (active ? ' active' : '') + '"' +
                   ' title="' + it.title + '"' + (active ? '' : ' data-href="' + it.href + '"') + '>' +
                   '<div class="ric" style="color:' + it.color + '">' +
                   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + it.svg + '</svg>' +
                   '</div><span>' + it.title + '</span></button>';
        }).join('');
        el.addEventListener('click', (e) => {
            const btn = e.target.closest('.rail-item[data-href]');
            if (btn) window.location = btn.getAttribute('data-href');
        });
    }

    window.AccountsRail = { items: ITEMS, renderInto };

    document.addEventListener('DOMContentLoaded', () => renderInto(document.getElementById('pulseRail')));
})();
