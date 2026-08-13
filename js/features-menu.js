/**
 * Features mega-menu.
 *
 * Upgrades the "Features" item in the desk nav into a two-level menu:
 *
 *     Features  ▸  Accounts   ▸  Invoicing, Inventory, GST returns, …
 *                  CRM
 *                  Mail
 *                  …
 *
 * Clicking an app name goes to that app's page, exactly as it did before.
 * The second level is an extra route to the detail pages, not a replacement
 * for the first — someone who just wants "Accounts" should never be forced
 * through a submenu to reach it.
 *
 * WHY A COMPONENT. This sits on ~123 pages. Injecting the markup into each
 * one would mean 123 copies to keep in step, and the last time a nav element
 * was duplicated across pages (the tenant-manager shortcut, bound to an id
 * that the redesign removed) it silently rotted on every one of them. One
 * file, upgraded at runtime, cannot drift.
 *
 * WITHOUT JAVASCRIPT the "Features" link still works and still goes to the
 * features index. The menu is an enhancement on top of a link that already
 * did its job.
 */
(function () {
  'use strict';

  /* Level 1 is the apps. `href` is where clicking the app itself goes.
     `pages` is the optional second level.

     Accounts carries most of it because most of the product is Accounts.
     Apps with no detail pages are still listed — a menu that showed only the
     apps with sub-pages would read as though the others do not exist. */
  var APPS = [
    { name: 'Accounts', href: 'accounts.html', tag: 'Selling, stock &amp; books', pages: [
        ['Invoicing', 'features/invoicing.html'],
        ['Recurring billing', 'features/recurring-billing.html'],
        ['Receivables', 'features/receivables.html'],
        ['Vendor bills', 'features/vendor-bills.html'],
        ['Purchase orders', 'features/purchase-orders.html'],
        ['Expenses', 'features/expenses.html'],
        ['Inventory', 'features/inventory.html'],
        ['Stock counts', 'features/stock-counts.html'],
        ['Manufacturing', 'features/manufacturing.html'],
        ['POS billing', 'features/pos-billing.html'],
        ['Wholesale', 'features/wholesale.html'],
        ['Ecommerce API', 'features/ecommerce-api.html'],
        ['GST returns', 'features/gst-filing.html'],
        ['GSTR-2B reconciliation', 'features/gstr-2b.html'],
        ['General ledger', 'features/general-ledger.html'],
        ['Banking', 'features/banking.html'],
        ['Fixed assets', 'features/fixed-assets.html'],
        ['Financial reports', 'features/financial-reports.html'],
        ['Period close', 'features/year-end-close.html'],
        ['Budgets &amp; cost centres', 'features/budgets-cost-centres.html'],
        ['Multi-currency', 'features/multi-currency.html'],
        ['Data import', 'features/data-import.html'],
        /* Pharma is a VERTICAL of Accounts, not a peer app. Its own page says
           "This is Accounts, with the parts a chemist and a distributor need
           already in it" — listing it top-level implied a separate product. */
        ['Pharma distribution', 'pharma.html']
      ] },
    { name: 'CRM', href: 'crm.html', tag: 'Sales &amp; leads' },
    { name: 'HRMS', href: 'hrms.html', tag: 'People &amp; payroll', pages: [
        ['Payroll, attendance and leave', 'features/hrms-payroll.html']
      ] },
    { name: 'Projects', href: 'pms.html', tag: 'Delivery &amp; billing' },
    { name: 'Procurement', href: 'procurement.html', tag: 'Buying &amp; vendors', pages: [
        ['RFQs, comparison and awards', 'features/procurement.html']
      ] },
    { name: 'Mail', href: 'email.html', tag: 'One inbox' },
    { name: 'Meetings', href: 'vision.html', tag: 'HD video and captions', pages: [
        ['Meetings, captions and recordings', 'features/video-conferencing.html']
      ] },
    { name: 'Chat', href: 'chat.html', tag: 'Direct and group', pages: [
        ['Messaging, groups and presence', 'features/team-chat.html']
      ] },
    { name: 'Drive', href: 'drive.html', tag: 'Files &amp; sharing', pages: [
        ['Uploads, links and the audit log', 'features/cloud-storage.html']
      ] },
    { name: 'Merch', href: 'merch.html', tag: 'Free self-hosted store', pages: [
        ['Storefront API reference', 'merch-api.html']
      ] },
    { name: 'Learning', href: 'lms.html', tag: 'Courses &amp; training' },
    { name: 'Research', href: 'research.html', tag: 'Survey analysis' },
    { name: 'AI', href: 'ai.html', tag: 'Agentic AI' }
  ];

  /* Found by LABEL, scoped to the nav.

     Matching on href$="features/index.html" missed every page inside
     /pages/features/, where the link is a bare "index.html" — so the menu was
     absent from all 28 feature pages, the ones where it is most useful. The
     label is the same everywhere the item exists; the href is not. */
  var trigger = null;
  var navLinks = document.querySelectorAll('.dk-navlinks a');
  for (var n = 0; n < navLinks.length; n++) {
    if (navLinks[n].textContent.trim() === 'Features') { trigger = navLinks[n]; break; }
  }
  if (!trigger) return;

  /* Every href in APPS is written relative to /pages/, so work out the prefix
     from where this page sits:
         pages/features/index.html  (root)              -> "pages/"
         features/index.html        (inside /pages/)    -> ""
         index.html                 (inside /features/) -> "../"  */
  var href = trigger.getAttribute('href') || '';
  var base = /features\/index\.html$/.test(href)
    ? href.replace(/features\/index\.html$/, '')
    : '../';

  var wrap = document.createElement('div');
  wrap.className = 'fx-menu';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fx-trigger';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-haspopup', 'true');
  btn.innerHTML = 'Features <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

  var panel = document.createElement('div');
  panel.className = 'fx-panel';
  panel.hidden = true;

  var appList = document.createElement('div');
  appList.className = 'fx-apps';
  appList.setAttribute('role', 'menu');

  var detail = document.createElement('div');
  detail.className = 'fx-detail';

  APPS.forEach(function (app, i) {
    var row = document.createElement('a');
    row.className = 'fx-app';
    row.href = base + app.href;
    row.setAttribute('role', 'menuitem');
    row.dataset.i = String(i);
    row.innerHTML =
      '<span class="fx-appname">' + app.name + '</span>' +
      '<span class="fx-apptag">' + app.tag + '</span>' +
      (app.pages ? '<span class="fx-more" aria-hidden="true">&rsaquo;</span>' : '');
    appList.appendChild(row);

    /* Pointer and keyboard both change the detail pane. Deliberately NOT on
       click: clicking an app must navigate to it, which is the behaviour the
       nav had before this menu existed. */
    ['mouseenter', 'focus'].forEach(function (ev) {
      row.addEventListener(ev, function () { show(i); });
    });
  });

  function show(i) {
    var app = APPS[i];
    [].forEach.call(appList.children, function (c, n) {
      c.classList.toggle('is-on', n === i);
    });
    if (!app.pages) {
      detail.innerHTML =
        '<p class="fx-dhead">' + app.name + '</p>' +
        '<p class="fx-dnote">' + app.tag + '. <a href="' + base + app.href + '">Open the ' +
        app.name + ' page &rarr;</a></p>';
      return;
    }
    /* One column when there are only a few — two columns of three items reads
       as a broken grid rather than a deliberate one. */
    var short = app.pages.length <= 4 ? ' is-short' : '';
    detail.innerHTML =
      '<p class="fx-dhead">' + app.name + '</p>' +
      '<div class="fx-dlist' + short + '">' +
        app.pages.map(function (p) {
          return '<a href="' + base + p[1] + '">' + p[0] + '</a>';
        }).join('') +
      '</div>';
  }

  show(0);

  panel.appendChild(appList);
  panel.appendChild(detail);
  wrap.appendChild(btn);
  wrap.appendChild(panel);
  trigger.parentNode.replaceChild(wrap, trigger);

  var open = false;
  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    btn.setAttribute('aria-expanded', String(v));
    wrap.classList.toggle('is-open', v);
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(!open);
  });

  /* Hover opens it on a device that has hover. A touch device fires no
     mouseenter, so the click above is the route there — which is why the
     trigger is a button rather than a link. */
  if (window.matchMedia('(hover: hover)').matches) {
    wrap.addEventListener('mouseenter', function () { setOpen(true); });
    wrap.addEventListener('mouseleave', function () { setOpen(false); });
  }

  document.addEventListener('click', function (e) {
    if (open && !wrap.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) {
      setOpen(false);
      btn.focus();
    }
  });

  /* Tab out of the panel closes it, so the menu cannot be left hanging open
     behind the rest of the page for a keyboard user. */
  wrap.addEventListener('focusout', function (e) {
    if (open && !wrap.contains(e.relatedTarget)) setOpen(false);
  });
})();
