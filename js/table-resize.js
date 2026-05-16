// ──────────────────────────────────────────────────────────────────────────
// Reusable column-resize handles for HTML tables.
//
// Mount once per table; the utility adds a thin drag handle to every <th>
// right edge (Excel-style), persists per-column widths to localStorage
// under the caller's resizeKey, and tears down cleanly on viewport shrink
// past the mobile breakpoint where table-cards.css folds rows into cards.
//
// Usage:
//   window.mountColumnResize(document.getElementById('leadsTable'), {
//       resizeKey: `leads:${tenantId}`,
//       // optional: how to identify columns; defaults to data-col attribute
//       columnId: (th) => th.dataset.col,
//   });
//
// Idempotent — calling again on the same table re-uses existing handles
// and just applies any newly-saved widths or adds handles to any new
// <th>s (e.g. when lead-fields-runtime injects custom-field headers).
//
// Double-click a handle to clear that column's persisted width (auto-fit).
// ──────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const STORAGE_PREFIX = 'crm.tableColumnWidths.v1:';
    const MIN_WIDTH = 60;
    const MOBILE_BREAKPOINT = 768;

    function loadWidths(key) {
        try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
        catch { return {}; }
    }

    function saveWidths(key, widths) {
        try { localStorage.setItem(key, JSON.stringify(widths)); } catch (_) { /* quota */ }
    }

    function applyWidth(th, w) {
        const px = w + 'px';
        // Pin all three so the column behaves the same under table-layout:
        // auto (default) and fixed — auto otherwise grows the column to fit
        // its widest cell, undoing the user's narrow drag.
        th.style.width = px;
        th.style.minWidth = px;
        th.style.maxWidth = px;
    }

    function clearWidth(th) {
        th.style.width = '';
        th.style.minWidth = '';
        th.style.maxWidth = '';
    }

    function defaultColumnId(th) {
        return th.dataset.col || th.dataset.column || null;
    }

    function mountColumnResize(table, options) {
        if (!table || !options || !options.resizeKey) return;
        if (window.innerWidth <= MOBILE_BREAKPOINT) return; // table-cards layout

        const storageKey = STORAGE_PREFIX + options.resizeKey;
        const columnId = options.columnId || defaultColumnId;
        const saved = loadWidths(storageKey);

        const ths = table.querySelectorAll('thead th');
        ths.forEach(th => {
            const id = columnId(th);
            if (!id) return; // column not addressable — skip

            // Apply any saved width — runs every mount so newly-injected
            // headers (lead-fields-runtime) inherit the saved value too.
            if (saved[id]) applyWidth(th, saved[id]);

            // Idempotent: don't double-attach the handle.
            if (th.querySelector('.crm-th-resizer')) return;
            // The <th> must be a positioning context for the handle.
            const cs = window.getComputedStyle(th);
            if (cs.position === 'static') th.style.position = 'relative';

            const handle = document.createElement('div');
            handle.className = 'crm-th-resizer';
            handle.setAttribute('role', 'separator');
            handle.setAttribute('aria-label', 'Resize column');
            handle.setAttribute('aria-orientation', 'vertical');
            // Custom-tooltip (js/tooltip.js) — instant, themed, no native
            // browser delay. Position above so it doesn't clip behind the
            // table-wrapper scroll bounds when the cursor sits at the
            // header's right edge.
            handle.setAttribute('data-tooltip', 'Drag to resize • Double-click to reset');
            handle.setAttribute('data-tooltip-position', 'top');
            th.appendChild(handle);

            handle.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();

                const startX = e.clientX;
                const startWidth = th.getBoundingClientRect().width;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                handle.classList.add('is-dragging');

                let latestWidth = startWidth;

                function onMove(ev) {
                    latestWidth = Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX));
                    applyWidth(th, latestWidth);
                }

                function onUp() {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    handle.classList.remove('is-dragging');
                    saved[id] = Math.round(latestWidth);
                    saveWidths(storageKey, saved);
                }

                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp, { once: true });
            });

            handle.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                clearWidth(th);
                delete saved[id];
                saveWidths(storageKey, saved);
            });

            // Suppress click bubbling so a future sortable-header wiring
            // doesn't fire when the user just wanted to grab the handle.
            handle.addEventListener('click', (e) => e.stopPropagation());
        });
    }

    // Strip handles + clear inline widths so the table can fall back to
    // its responsive card layout when the viewport crosses the breakpoint.
    function teardownColumnResize(table) {
        if (!table) return;
        table.querySelectorAll('thead th').forEach(th => {
            const handle = th.querySelector('.crm-th-resizer');
            if (handle) handle.remove();
            clearWidth(th);
        });
    }

    window.mountColumnResize = mountColumnResize;
    window.teardownColumnResize = teardownColumnResize;
})();
