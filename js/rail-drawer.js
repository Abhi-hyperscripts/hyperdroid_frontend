/**
 * Rail Drawer — the pulse-rail as an overlay drawer for pages whose left
 * column is owned by the system-wide settings sidebar.
 *
 * Drop-in: include css/rail-drawer.css + this file, nothing else. It injects
 * a slim always-visible handle on the left edge; clicking it slides the rail
 * OVER the page (scrim behind). Esc or click-away closes. The page layout
 * never moves — safe on any sidebar-layout page.
 *
 * Items default to the CRM module set with the active item derived from the
 * current filename. That default must stay in step with the rail written by
 * hand into the CRM pages: it is a SECOND definition of the same navigation,
 * and it silently fell three modules behind — Tasks, Properties and Calendar
 * were added to every page's rail and not to this list, so CRM Settings (the
 * only page in the repo that uses this default) offered nine destinations
 * where every other CRM page offered twelve.
 *
 * WhatsApp is deliberately absent: it is conditional on the tenant having the
 * integration, and the only markup and reveal logic for it live on the CRM
 * dashboard. Adding it here without that logic would show a dead link to
 * every tenant that has not enabled it. A page can override by defining window.RAIL_DRAWER_ITEMS
 * = [{ href, title, color, svg }] BEFORE this script loads.
 */
(function () {
    'use strict';

    const DEFAULT_ITEMS = [
        { href: 'dashboard.html', title: 'Today', color: 'var(--color-warning)',
          svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 15h3"/>' },
        { href: 'my-day.html', title: 'My Day', color: '#4CC9F0',
          svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
        { href: 'tasks.html', title: 'Tasks', color: '#A78BFA',
          svg: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
        { href: 'leads.html', title: 'Leads', color: '#60A5FA',
          svg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/>' },
        { href: 'deals.html', title: 'Deals', color: '#A78BFA',
          svg: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>' },
        { href: 'contacts.html', title: 'Contacts', color: '#F472B6',
          svg: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
        { href: 'companies.html', title: 'Companies', color: '#93C5FD',
          svg: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h2M9 13h2M13 9h2M13 13h2M9 17h6"/>' },
        { href: 'properties.html', title: 'Properties', color: '#34D399',
          svg: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
        { href: 'calendar.html', title: 'Calendar', color: '#38BDF8',
          svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
        { href: 'calls.html', title: 'Calls', color: '#2DD4BF',
          svg: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' },
        { href: 'analytics.html', title: 'Analytics', color: '#34d399',
          svg: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
        { href: 'sequences.html', title: 'Sequences', color: '#FB923C',
          svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
        { href: 'settings.html', title: 'Settings', color: 'var(--text-muted)',
          svg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>' }
    ];

    document.addEventListener('DOMContentLoaded', () => {
        const items = window.RAIL_DRAWER_ITEMS || DEFAULT_ITEMS;
        const current = (location.pathname.split('/').pop() || '').toLowerCase();

        const drawer = document.createElement('nav');
        drawer.className = 'rail-drawer';
        drawer.setAttribute('aria-label', 'CRM sections');
        drawer.innerHTML = items.map(it => {
            const active = current === it.href.toLowerCase();
            return `<button type="button" class="rail-item${active ? ' active' : ''}" title="${it.title}"` +
                   `${active ? '' : ` data-href="${it.href}"`}>` +
                   `<div class="ric" style="color:${it.color}">` +
                   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${it.svg}</svg>` +
                   `</div><span>${it.title}</span></button>`;
        }).join('');

        const scrim = document.createElement('div');
        scrim.className = 'rail-drawer-scrim';

        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'rail-drawer-handle';
        handle.setAttribute('aria-label', 'Open CRM sections');
        handle.setAttribute('aria-expanded', 'false');
        handle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

        document.body.append(scrim, drawer, handle);

        const setOpen = (open) => {
            drawer.classList.toggle('open', open);
            scrim.classList.toggle('open', open);
            handle.setAttribute('aria-expanded', String(open));
            handle.setAttribute('aria-label', open ? 'Close CRM sections' : 'Open CRM sections');
        };

        handle.addEventListener('click', () => setOpen(!drawer.classList.contains('open')));
        scrim.addEventListener('click', () => setOpen(false));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && drawer.classList.contains('open')) setOpen(false);
        });
        drawer.addEventListener('click', (e) => {
            const btn = e.target.closest('.rail-item[data-href]');
            if (btn) window.location = btn.getAttribute('data-href');
        });
    });
})();
