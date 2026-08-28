/**
 * ⭐ THE EXPLORE MENU — nine groups, and every section underneath them.
 *
 * The dashboard used to end in a flat strip of 18–20 tiles, one per PAGE. That
 * had two problems, and they compounded:
 *
 *  1. A flat list of twenty nouns has no shape. "Dept. spend" and "Batches &
 *     Expiry" sat side by side at equal weight, so nothing told a new user which
 *     of them was a daily job and which was a once-a-quarter one.
 *  2. It stopped at the page. The module has 111 SECTIONS across 22 pages — AR
 *     aging, Sales orders, Reorder report, GSTR-2B match, Serials & warranty — and
 *     every one of them was reachable only after you had already guessed which
 *     page it lived on and clicked through to its tab. Six of the 111 had a
 *     dashboard link. The rest were invisible from here.
 *
 * So: groups that say what they are FOR, each with a one-line description, each
 * expanding to the real sections inside it. The hrefs carry the tab anchor
 * (page.html#tab-id), which the pages already honour.
 *
 * ⭐⭐ ONE DEFINITION. This list is data, not markup, for the same reason the rail
 * is (see accounts-rail.js): the flat grid it replaces was hand-written HTML, and
 * hand-written navigation is how Quotes came to have exactly one entry point in
 * the whole product while every other document type had several.
 */
(function () {
    'use strict';

    const I = {
        sell:    '<path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3A1 1 0 0 0 5.4 17H17"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>',
        buy:     '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
        stock:   '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
        bank:    '<path d="M3 9l9-7 9 7"/><path d="M4 10v10h16V10"/><path d="M9 20v-6h6v6"/>',
        books:   '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
        reports: '<path d="M3 3v18h18"/><polyline points="7 14 11 10 14 13 21 6"/>',
        tax:     '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
        store:   '<path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M3 9h18"/>',
        setup:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
    };

    // Descriptions are written for someone with no accounting background — the same
    // audience js/accounts/accounts-help.js is written for. They say what the group
    // is for, not what it contains; the sub-links already say that.
    /**
     * ⭐ THE GATE IS COPIED FROM THE CONTROLLER, NOT GUESSED.
     *
     * <p>A menu that offers a door the server will slam is worse than one that hides
     * it: the user reads it as the product being broken. So each restricted link
     * carries the EXACT role list from its [Authorize(Roles=...)] attribute, named
     * after the controller it came from — which is also how the next person checks it
     * is still true.</p>
     *
     * <p>The three helpers on accountsRoles (isAdmin / isManager / isAuditor) were not
     * enough. BudgetsController allows ADMIN, MANAGER, AUDITOR and SUPERADMIN: isManager()
     * would wrongly hide it from an auditor who IS allowed, and isAuditor() would wrongly
     * hide it from a manager who IS allowed. Neither expresses "anyone but a plain user",
     * so the role list is spelled out per link instead of squeezed into a helper.</p>
     */
    const R = {
        // [Authorize(Roles = "ACCOUNTS_ADMIN,SUPERADMIN")] — Coupons, Bxgy, GiftCards,
        // AutomaticDiscounts, StorefrontKeys, Import, Mailboxes, Closing
        ADMIN: ['ACCOUNTS_ADMIN', 'SUPERADMIN'],
        // RecurringController
        MANAGER: ['ACCOUNTS_ADMIN', 'ACCOUNTS_MANAGER', 'SUPERADMIN'],
        // BudgetsController, AuditController — everyone except a plain ACCOUNTS_USER
        NOT_PLAIN_USER: ['ACCOUNTS_ADMIN', 'ACCOUNTS_MANAGER', 'ACCOUNTS_AUDITOR', 'SUPERADMIN'],
        // AdminController — integrity check, job log, danger zone
        SUPER: ['SUPERADMIN'],
    };

    /** Roles from the JWT. Read here rather than through accountsRoles, whose init()
     *  runs inside AccountsCommon.initPage — this module renders on DOMContentLoaded and
     *  must not depend on which listener registered first. */
    function myRoles() {
        try { return (typeof getUserRoles === 'function' ? getUserRoles() : []) || []; }
        catch (_) { return []; }
    }

    const allowed = (roles) => !roles || roles.some(r => myRoles().includes(r));

    const GROUPS = [
        { id: 'sell', name: 'Sell', color: '#22c55e', icon: I.sell,
          desc: 'Quote, invoice and get paid — everything on the money-coming-in side.',
          links: [
            ['Invoices',            'receivables.html#customer-invoices'],
            ['Quotes / Proforma',   'proforma-invoices.html#proforma-list'],
            ['Sales orders',        'receivables.html#sales-orders'],
            ['Delivery challans',   'receivables.html#delivery-challans'],
            ['Payments received',   'receivables.html#customer-payments'],
            ['Credit notes',        'receivables.html#credit-notes'],
            ['Counter sale (POS)',  'pos.html#pos-counter'],
            ['Recurring invoices',  'recurring.html#recurring-list', R.MANAGER],
            ['Who owes you (AR aging)', 'receivables.html#ar-aging'],
            ['Customer statements', 'receivables.html#customer-statements'],
            ['Overdue interest',    'receivables.html#overdue-interest'],
          ]},
        { id: 'buy', name: 'Buy & spend', color: '#f59e0b', icon: I.buy,
          desc: 'Order from suppliers, record their bills, pay them, and claim staff expenses.',
          links: [
            ['Purchase orders',     'purchase-orders.html#po-list'],
            ['Vendor bills',        'payables.html#vendor-bills'],
            ['Payments made',       'payables.html#vendor-payments'],
            ['Debit notes',         'payables.html#debit-notes'],
            ['What you owe (AP aging)', 'payables.html#ap-aging'],
            ['Vendor statements',   'payables.html#vendor-statements'],
            ['Expense claims',      'expenses.html#expense-claims'],
            ['Expense categories',  'expenses.html#expense-categories'],
            ['Expense policies',    'expenses.html#expense-policies'],
          ]},
        { id: 'stock', name: 'Stock', color: '#2DD4BF', icon: I.stock,
          desc: 'Your catalogue and what is physically on the shelf, per location and per batch.',
          links: [
            ['Items (catalogue)',   'inventory.html#inv-items'],
            ['Stock on hand',       'inventory.html#inv-stock'],
            ['Locations',           'inventory.html#inv-locations'],
            ['Batches & expiry',    'inventory.html#inv-batches'],
            ['Serials & warranty',  'inventory.html#inv-serials'],
            ['Movements',           'inventory.html#inv-movements'],
            ['Stock count',         'inventory.html#inv-count'],
            ['Reorder report',      'inventory.html#inv-reorder'],
            ['Work orders',         'inventory.html#inv-workorders'],
            ['Price lists',         'inventory.html#inv-pricelists'],
            ['Schemes',             'inventory.html#inv-schemes'],
            ['Brands & categories', 'inventory.html#inv-merch'],
            ['Bulk import',         'inventory.html#inv-import', R.ADMIN],
          ]},
        { id: 'bank', name: 'Banking & cash', color: '#3b82f6', icon: I.bank,
          desc: 'Where the money actually sits — accounts, transfers, cheques and reconciliation.',
          links: [
            ['Bank accounts',       'banking.html#bank-accounts'],
            ['Transactions',        'banking.html#bank-transactions'],
            ['Inter-bank transfer', 'banking.html#bank-transfers'],
            ['Cheques / PDC',       'banking.html#pdc-cheques'],
            ['Import statement',    'banking.html#statement-import'],
            ['Reconciliation',      'banking.html#reconciliation'],
            ['Loans',               'loans.html#loan-list'],
          ]},
        { id: 'books', name: 'The books', color: '#F472B6', icon: I.books,
          desc: 'The double-entry record underneath everything else, and the assets you own.',
          links: [
            ['GL entries',          'ledger.html#gl-entries'],
            ['Create entry',        'ledger.html#create-gl'],
            ['Journal entries',     'ledger.html#journal-entries'],
            ['Chart of accounts',   'setup.html#accounts'],
            ['Account tree',        'setup.html#account-tree'],
            ['Opening balances',    'setup.html#opening-balances'],
            ['Fixed asset register','assets.html#asset-register'],
            ['Depreciation',        'assets.html#depreciation'],
          ]},
        { id: 'reports', name: 'Reports & planning', color: '#8B5CF6', icon: I.reports,
          desc: 'Did we make money, where did it go, and are we on budget.',
          links: [
            ['Profit & Loss',       'reports.html#profit-loss'],
            ['Balance Sheet',       'reports.html#balance-sheet'],
            ['Cash Flow',           'reports.html#cash-flow'],
            ['Trial Balance',       'reports.html#trial-balance'],
            ['Account ledger',      'reports.html#account-ledger'],
            ['Day book',            'reports.html#day-book'],
            ['Cash book',           'reports.html#cash-book'],
            ['Budgets',             'budgets.html#budget-list', R.NOT_PLAIN_USER],
            ['Budget vs actual',    'budgets.html#budget-analysis', R.NOT_PLAIN_USER],
            ['Department spend',    'cost-centres.html#cc-spend'],
            ['Projects',            'projects.html#pr-list'],
            ['Project statement',   'projects.html#pr-stmt'],
          ]},
        { id: 'tax', name: 'Tax & compliance', color: '#FB923C', icon: I.tax,
          desc: 'GST and TDS — how it is charged, what it adds up to, and what gets filed.',
          links: [
            ['Tax configurations',  'taxation.html#tax-config'],
            ['Tax rates',           'taxation.html#tax-rates'],
            ['HSN / SAC codes',     'taxation.html#hsn-sac'],
            ['GSTR-1',              'taxation.html#gstr-1'],
            ['GSTR-3B',             'taxation.html#gstr-3b'],
            ['GSTR-2B match',       'taxation.html#gstr-2b'],
            ['TDS return',          'taxation.html#tds-return'],
            ['TDS receivable',      'receivables.html#tds-receivable'],
            ['Tax calculator',      'taxation.html#tax-calculator'],
            ['Tax ledger',          'taxation.html#tax-ledger'],
          ]},
        { id: 'store', name: 'Online store', color: '#14b8a6', icon: I.store,
          desc: 'The storefront API and the offers that run on it.',
          links: [
            ['API keys',            'storefront.html#sf-keys', R.ADMIN],
            ['Coupons',             'storefront.html#sf-coupons', R.ADMIN],
            ['Automatic discounts', 'storefront.html#sf-discounts', R.ADMIN],
            ['Buy X get Y',         'storefront.html#sf-bxgy', R.ADMIN],
            ['Gift cards',          'storefront.html#sf-giftcards', R.ADMIN],
          ]},
        { id: 'setup', name: 'Setup & admin', color: '#94A3B8', icon: I.setup,
          desc: 'Who you trade with, how the books are structured, and everything administrative.',
          links: [
            ['Customers',           'parties.html#customer-list'],
            ['Vendors',             'parties.html#vendor-list'],
            ['Account types',       'setup.html#account-types'],
            ['Account groups',      'setup.html#account-groups'],
            ['Fiscal years',        'setup.html#fiscal-years'],
            ['Fiscal periods',      'setup.html#fiscal-periods'],
            ['Journal types',       'setup.html#journal-types'],
            ['COA templates',       'setup.html#templates'],
            ['Tenant settings',     'admin.html#tenant-settings'],
            ['Custom fields',       'admin.html#custom-fields'],
            ['Email sending',       'admin.html#email-sending', R.ADMIN],
            ['Pending approvals',   'admin.html#pending-approvals', R.NOT_PLAIN_USER],  // audit/approvals/pending — AuditController
            ['Audit logs',          'admin.html#audit-logs', R.NOT_PLAIN_USER],
            ['Integrity check',     'admin.html#integrity-check', R.SUPER],
            ['Year-end closing',    'admin.html#year-end', R.ADMIN],
            ['Subscription & billing', 'billing.html#subscriptions'],
          ]},
    ];

    /**
     * ⭐ THE DESCRIPTIONS ARE NOT NEW COPY. accounts-help.js already carries 94
     * hand-written, plain-English explanations — one per section, for a reader with no
     * accounting background — and 82 of the 91 destinations below have one. Each panel
     * opens with a bolded lead sentence ("Lot & expiry control for pharma, food &
     * chemicals.") which is exactly the one-liner a menu wants, so this takes the first
     * sentence and strips the markup.
     *
     * Lives HERE, next to the destinations, rather than in the palette: the palette is
     * a consumer of this list, and a describe() that lived there would have to be
     * reimplemented by the next consumer.
     */
    function describe(href) {
        const [page, anchor] = String(href).split('#');
        const html = anchor && window.ACCOUNTS_HELP
            ? window.ACCOUNTS_HELP[`${page.replace('.html', '')}:${anchor}`] : null;
        if (!html) return '';
        const text = String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
                                 .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        const stop = text.search(/\.\s/);
        const first = stop > 0 ? text.slice(0, stop + 1) : text;
        return first.length > 170 ? first.slice(0, 167).trimEnd() + '…' : first;
    }

    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    /**
     * The groups as THIS user may see them. A group whose every link is gated away
     * disappears entirely rather than rendering an empty card with a count of 0 —
     * for a plain ACCOUNTS_USER that is the whole Online store group, since every one
     * of its five sections is ACCOUNTS_ADMIN only.
     */
    function visibleGroups() {
        return GROUPS
            .map(g => ({ ...g, links: g.links.filter(l => allowed(l[2])) }))
            .filter(g => g.links.length > 0);
    }

    function render(host) {
        if (!host) return;
        host.className = 'explore-groups';
        host.innerHTML = visibleGroups().map(g => `
            <section class="xg" data-group="${g.id}" style="--xg:${g.color}">
              <button type="button" class="xg-head" aria-expanded="false" aria-controls="xg-${g.id}">
                <span class="xg-ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${g.icon}</svg>
                </span>
                <span class="xg-txt">
                  <span class="xg-name">${esc(g.name)}</span>
                  <span class="xg-desc">${esc(g.desc)}</span>
                </span>
                <span class="xg-count">${g.links.length}</span>
                <svg class="xg-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="xg-body" id="xg-${g.id}" hidden>
                ${g.links.map(([label, href]) =>
                  `<a class="xg-link" href="${href}">${esc(label)}</a>`).join('')}
              </div>
            </section>`).join('');

        host.addEventListener('click', (e) => {
            const head = e.target.closest('.xg-head');
            if (!head) return;
            const open = head.getAttribute('aria-expanded') === 'true';
            head.setAttribute('aria-expanded', String(!open));
            head.parentElement.classList.toggle('open', !open);
            head.parentElement.querySelector('.xg-body').hidden = open;
            // Remember what the user had open. A dashboard is returned to many times a
            // day and re-opening the same group every time is the kind of small friction
            // that makes people stop using the menu at all.
            try {
                const st = JSON.parse(localStorage.getItem('acct_explore_open') || '[]');
                const id = head.parentElement.dataset.group;
                const next = open ? st.filter(x => x !== id) : [...new Set([...st, id])];
                localStorage.setItem('acct_explore_open', JSON.stringify(next));
            } catch (_) { /* private mode — the menu still works, it just forgets */ }
        });

        try {
            JSON.parse(localStorage.getItem('acct_explore_open') || '[]').forEach(id => {
                const sec = host.querySelector(`.xg[data-group="${id}"]`);
                if (!sec) return;
                sec.classList.add('open');
                sec.querySelector('.xg-head').setAttribute('aria-expanded', 'true');
                sec.querySelector('.xg-body').hidden = false;
            });
        } catch (_) { /* ignore */ }
    }

    /** Attach the written descriptions as tooltips. accounts-common.js lazy-loads
     *  accounts-help.js for its own help panels, so this waits for it rather than
     *  pulling a second 65KB copy — and gives up quietly if it never arrives. */
    function attachTooltips(host, tries) {
        if (!host) return;
        if (!window.ACCOUNTS_HELP) {
            if (tries > 0) setTimeout(() => attachTooltips(host, tries - 1), 400);
            return;
        }
        host.querySelectorAll('.xg-link').forEach(a => {
            const d = describe(a.getAttribute('href'));
            if (d) a.setAttribute('data-tooltip', d);
        });
    }

    window.AccountsExplore = { groups: GROUPS, visibleGroups, render, describe };
    document.addEventListener('DOMContentLoaded', () => {
        const host = document.getElementById('exploreGroups');
        render(host);
        attachTooltips(host, 20);
        // Deferred: the counts come from four endpoints and must never sit between the
        // user and a rendered menu. accounts-badges.js caches per session, so this is
        // one round of requests however many times the dashboard is revisited.
        setTimeout(() => window.AccountsBadges && window.AccountsBadges.applyToExplore(host), 900);
        // Deferred: the counts come from four endpoints and must never sit between the
        // user and a rendered menu. accounts-badges.js caches per session, so this is
        // one round of requests however many times the dashboard is revisited.
        setTimeout(() => window.AccountsBadges && window.AccountsBadges.applyToExplore(host), 900);
    });
})();
