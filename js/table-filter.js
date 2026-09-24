/**
 * EXCEL-STYLE COLUMN FILTERS FOR EVERY DATA GRID
 * ==============================================
 * Click a column header's funnel: a checkbox list of that column's distinct
 * values, a search box over them, Select all / Clear, and sort A→Z / Z→A.
 * Several columns combine with AND, exactly as a spreadsheet does.
 *
 * Attaches itself to every grid on the page and needs no per-page wiring — the
 * same approach table-cards.js uses, and for the same reason: there are 67
 * pages and a change that has to be made 67 times is a change that will be
 * made 60 times.
 *
 * ⭐ "EVERY GRID" IS A LIST, AND THE LIST IS THE BUG.
 *
 * `.data-table` is the house style, but it is not the only one: HRMS
 * self-service, CRM analytics and the HRMS bulk-import preview each grew their
 * own class, and asking "why don't those tables have the filter?" is how the
 * gap was found — by the user, not by me. So the classes are enumerated here
 * ONCE and `scripts/check-table-filter-pairs.js` reads this same list back out
 * of this file, which means a new grid class cannot be added to the product
 * without either joining the list or failing the build.
 *
 * ⭐⭐⭐ THE ONE THING THIS MUST NEVER DO IS FILTER THE WRONG SET.
 *
 * A DOM filter can only see rendered rows. The inventory grid renders 150 of
 * 7,834 — so "filter by category = Edible Oils" read off the DOM would hide
 * rows in the window and quietly ignore the other 7,684. It would look like it
 * worked. That is the same failure as a dropped filter: a confident answer to
 * a narrower question than the one asked.
 *
 * So a table whose DOM is a WINDOW onto a bigger set must say so, and there are
 * two ways it can:
 *
 *   1. Register an adapter (TableFilter.register) giving the full row data and
 *      a re-render callback. The filter then works on the data, not the DOM.
 *   2. Do nothing — in which case the module DETECTS the window (a row whose
 *      text reads "Showing N of M" with M > N, which is how these tables
 *      already announce themselves) and refuses to offer filters rather than
 *      offering broken ones.
 *
 * Refusing is the important half. An absent control is a feature someone asks
 * for; a control that silently filters 2% of the data is a wrong number on a
 * stock report.
 */
const TableFilter = (() => {
    'use strict';

    // The grid classes in this product. Keep in sync with the guard — it parses
    // this array literal, so keep it a plain list of string literals.
    const GRID_CLASSES = ['data-table', 'ess-table', 'ana-table', 'bulk-import-table'];

    // Columns that are controls rather than data. Same keywords table-cards.js
    // uses to find the actions column, so the two agree about what a column is.
    const SKIP_HEADERS = ['actions', 'action', ''];

    // Below this a dropdown is noise — the user can see every value already.
    const MIN_ROWS = 3;
    // A column that is almost entirely distinct (an id, a timestamp) is a list
    // of everything, which is not a filter. Searchable, but not offered as tick
    // boxes by default.
    const MAX_DISTINCT = 300;

    const adapters = new WeakMap();   // table element → { rows, valueOf, apply }
    const state = new WeakMap();      // table element → { [colIndex]: Set(values) }
    let openMenu = null;
    let placeMenu = null;             // the open menu's re-position callback

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const headerCells = (table) => [...(table.tHead?.rows?.[0]?.cells || [])];
    const bodyRows = (table) => [...(table.tBodies?.[0]?.rows || [])];

    /** The text a cell contributes to filtering — what the reader sees, trimmed. */
    const cellText = (tr, i) => (tr.cells[i]?.innerText || '').trim();

    /**
     * Is this tbody a WINDOW onto a larger set?
     *
     * The windowed tables in this app already print their own honesty line —
     * "Showing 150 of 7,834" — so that line is the signal. Cheap, and it cannot
     * be fooled by a table that merely has many rows.
     */
    function windowedTotal(table) {
        for (const tr of bodyRows(table)) {
            const m = (tr.innerText || '').match(/Showing\s+([\d,]+)\s+of\s+([\d,]+)/i);
            if (m) {
                const shown = +m[1].replace(/,/g, '');
                const total = +m[2].replace(/,/g, '');
                if (total > shown) return total;
            }
        }
        return 0;
    }

    /** Rows that carry data, as opposed to the "Showing N of M" / empty-state rows. */
    const dataRows = (table) => bodyRows(table).filter(tr =>
        tr.cells.length > 1 && !/Showing\s+[\d,]+\s+of\s+[\d,]+/i.test(tr.innerText || ''));

    // ─── the dropdown ───────────────────────────────────────────────────────

    function closeMenu() {
        if (!openMenu) return;
        openMenu.remove();
        openMenu = null;
        document.removeEventListener('keydown', onKey, true);
        if (placeMenu) {
            // Capture phase on BOTH, to match how they were added.
            window.removeEventListener('scroll', placeMenu, true);
            window.removeEventListener('resize', placeMenu);
            placeMenu = null;
        }
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }

    function distinctValues(table, colIndex) {
        const ad = adapters.get(table);
        const values = ad
            ? ad.rows().map(r => ad.valueOf(r, colIndex))
            : dataRows(table).map(tr => cellText(tr, colIndex));
        const counts = new Map();
        for (const v of values) {
            const key = v === '' || v == null ? '(blank)' : String(v);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return [...counts.entries()].sort((a, b) =>
            a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
    }

    function openFor(table, th, colIndex) {
        closeMenu();
        const st = state.get(table) || {};
        const chosen = st[colIndex];                 // Set, or undefined = no filter
        const pairs = distinctValues(table, colIndex);

        // ⭐⭐⭐ THE TICKED SET LIVES HERE, NOT IN THE CHECKBOXES.
        //
        // Two bugs came from reading state off the DOM. Typing in the value
        // search REDRAWS the list, so ticks made before the search were thrown
        // away and silently restored to the committed set — the user watched
        // their choices undo themselves. And reading only the drawn boxes on
        // apply treated every value scrolled past as unticked.
        //
        // One Set, owned by the menu, is the answer to both: the checkboxes
        // render it, they never define it.
        const working = new Set(chosen ? [...chosen] : pairs.map(([v]) => v));

        const menu = document.createElement('div');
        menu.className = 'tfil-menu';
        menu.innerHTML = `
            <div class="tfil-sort">
                <button type="button" data-sort="asc">Sort A → Z</button>
                <button type="button" data-sort="desc">Sort Z → A</button>
            </div>
            <input type="text" class="tfil-search" placeholder="Search values…" aria-label="Search values">
            <div class="tfil-tools">
                <button type="button" data-all>Select all</button>
                <button type="button" data-none>Clear</button>
                <span class="tfil-count"></span>
            </div>
            <div class="tfil-list" role="group"></div>
            <div class="tfil-foot">
                <button type="button" class="tfil-done" data-done>Done</button>
            </div>`;
        document.body.appendChild(menu);

        const list = menu.querySelector('.tfil-list');
        const countEl = menu.querySelector('.tfil-count');

        /**
         * ⭐ APPLIED ON EVERY TICK, NOT ON A BUTTON.
         *
         * The first cut only filtered when Apply was pressed, so ticking a box
         * changed the box and nothing else — reported, fairly, as "check/uncheck
         * doesn't work". The table now answers immediately and Done just closes
         * the menu, which is also what makes the counts worth reading: you can
         * see the effect of each value as you go.
         */
        const commit = () => {
            const next = state.get(table) || {};
            if (working.size === pairs.length) delete next[colIndex];   // all = no filter
            else next[colIndex] = new Set(working);
            state.set(table, next);
            apply(table);
        };

        const draw = (needle) => {
            const n = (needle || '').toLowerCase();
            const shown = pairs.filter(([v]) => !n || v.toLowerCase().includes(n));
            list.innerHTML = shown.map(([v, c]) => `<label class="tfil-opt">
                    <input type="checkbox" value="${esc(v)}"${working.has(v) ? ' checked' : ''}>
                    <span class="tfil-v">${esc(v)}</span><span class="tfil-n">${c}</span>
                </label>`).join('') || '<p class="tfil-empty">No value matches.</p>';
            countEl.textContent = `${working.size} of ${pairs.length}`;
        };
        draw('');

        // Delegated, because draw() replaces these nodes on every search.
        list.addEventListener('change', (e) => {
            const cb = e.target.closest('input[type="checkbox"]');
            if (!cb) return;
            if (cb.checked) working.add(cb.value); else working.delete(cb.value);
            countEl.textContent = `${working.size} of ${pairs.length}`;
            commit();
        });

        menu.querySelector('.tfil-search').addEventListener('input', (e) => draw(e.target.value));

        // Select all / Clear act on EVERY value, not just the drawn ones —
        // otherwise "Clear" during a search would leave the hidden ones ticked
        // while saying it had cleared them.
        menu.querySelector('[data-all]').addEventListener('click', () => {
            pairs.forEach(([v]) => working.add(v));
            draw(menu.querySelector('.tfil-search').value);
            commit();
        });
        menu.querySelector('[data-none]').addEventListener('click', () => {
            working.clear();
            draw(menu.querySelector('.tfil-search').value);
            commit();
        });

        menu.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
            sortBy(table, colIndex, b.getAttribute('data-sort'));
            closeMenu();
        }));

        menu.querySelector('[data-done]').addEventListener('click', closeMenu);

        /**
         * ⭐ THE MENU IS `position: fixed`, SO IT DOES NOT SCROLL WITH ITS HEADER.
         *
         * Placing it once at open time looks right for exactly as long as
         * nothing moves. Scroll the page — or the table's own horizontal
         * scroller, which is why this listens in the CAPTURE phase rather than
         * only on window — and the dropdown stays welded to the viewport while
         * the column slides out from under it. Reported as "the dropdown is
         * detached from its parent when the mouse is scrolled", which is
         * precisely what it is.
         *
         * Fixed positioning is still the right call: the menu has to escape the
         * `overflow` on every table wrapper here, and `body.dashboard`'s
         * exclusion chain forces `position: relative` on anything left inside
         * the flow. So it stays fixed and TRACKS the header instead.
         */
        const place = () => {
            const r = th.getBoundingClientRect();

            // Header scrolled out of sight: there is nothing to point at, so
            // hide rather than leave a menu hovering over unrelated rows.
            if (r.bottom < 0 || r.top > window.innerHeight ||
                r.right < 0 || r.left > window.innerWidth) {
                menu.style.visibility = 'hidden';
                return;
            }
            menu.style.visibility = '';

            // ⭐ SIZE IT TO THE SPACE, THEN PLACE IT — in that order.
            //
            // Placing a fixed-height menu below a header near the fold pushes
            // Done off the bottom of the screen, where it cannot be clicked and
            // cannot be scrolled to (the menu is fixed; the page scrolls behind
            // it). So the menu gets a max-height first and its value list
            // shrinks to fit, which is what keeps the footer reachable at any
            // viewport height.
            const GAP = 4, EDGE = 8;
            const below = window.innerHeight - r.bottom - GAP - EDGE;
            const above = r.top - GAP - EDGE;
            const wanted = menu.scrollHeight;
            const flip = below < Math.min(wanted, 360) && above > below;

            // ⭐ THE FLOOR IS ON THE MENU, BUT THE THING THAT MUST STAY USABLE
            // IS THE LIST. A 180px floor sounds generous until you subtract the
            // sort row, the search box, the tools row and the footer — measured
            // at 300px viewport height it left the value list 21 pixels tall:
            // in the viewport, footer clickable, and completely unusable. So
            // the floor is the height a menu actually needs, and if neither
            // side has that much the menu is clamped into the viewport and
            // allowed to overlap its own header rather than shrink to a sliver.
            const NEEDED = Math.min(300, window.innerHeight - 2 * EDGE);
            const room = Math.max(NEEDED, flip ? above : below);

            menu.style.maxHeight = `${Math.round(room)}px`;
            const h = Math.min(menu.offsetHeight, room);
            const w = menu.offsetWidth;

            let top = flip ? r.top - GAP - h : r.bottom + GAP;
            top = Math.max(EDGE, Math.min(top, window.innerHeight - h - EDGE));
            const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - w - 12));
            menu.style.top = `${Math.round(top)}px`;
            menu.style.left = `${Math.round(left)}px`;
        };
        place();
        placeMenu = place;
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);

        openMenu = menu;
        setTimeout(() => {
            document.addEventListener('click', function away(e) {
                if (menu.contains(e.target)) return;
                document.removeEventListener('click', away);
                closeMenu();
            });
        }, 0);
        document.addEventListener('keydown', onKey, true);
        menu.querySelector('.tfil-search').focus();
    }

    // ─── applying ───────────────────────────────────────────────────────────

    function matches(table, get) {
        const st = state.get(table) || {};
        for (const key of Object.keys(st)) {
            const v = get(+key);
            if (!st[key].has(v === '' || v == null ? '(blank)' : String(v))) return false;
        }
        return true;
    }

    function apply(table) {
        const st = state.get(table) || {};
        const active = Object.keys(st).length;
        const ad = adapters.get(table);

        if (ad) {
            ad.apply(active ? (row => matches(table, i => ad.valueOf(row, i))) : null);
        } else {
            for (const tr of dataRows(table)) {
                tr.style.display = matches(table, i => cellText(tr, i)) ? '' : 'none';
            }
        }

        headerCells(table).forEach((th, i) => th.classList.toggle('tfil-on', !!st[i]));
        table.classList.toggle('tfil-any', active > 0);
    }

    function sortBy(table, colIndex, dir) {
        const ad = adapters.get(table);
        const cmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
        if (ad && ad.sort) { ad.sort(colIndex, dir); return; }
        const tb = table.tBodies[0];
        const rows = dataRows(table).sort((x, y) => {
            const r = cmp(cellText(x, colIndex), cellText(y, colIndex));
            return dir === 'desc' ? -r : r;
        });
        rows.forEach(tr => tb.appendChild(tr));
    }

    /** Remove every filter on a table and repaint it. */
    function clear(table) {
        state.set(table, {});
        apply(table);
    }

    // ─── attaching ──────────────────────────────────────────────────────────

    function enhance(table) {
        if (!table || table.dataset.tfil === '1') return;
        const ths = headerCells(table);
        if (!ths.length) return;

        const rows = dataRows(table);
        const hasAdapter = adapters.has(table);
        if (!hasAdapter) {
            if (rows.length < MIN_ROWS) return;               // nothing worth filtering yet
            // ⭐ THE REFUSAL. See the header comment — a windowed table without
            // an adapter gets NO filter rather than one that lies.
            if (windowedTotal(table)) { table.dataset.tfilWindowed = '1'; return; }
        }

        table.dataset.tfil = '1';
        ths.forEach((th, i) => {
            const label = (th.innerText || '').trim().toLowerCase();
            if (SKIP_HEADERS.includes(label)) return;
            if (th.querySelector('.tfil-btn')) return;
            if (!hasAdapter && distinctValues(table, i).length > MAX_DISTINCT) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tfil-btn';
            btn.setAttribute('aria-label', `Filter by ${(th.innerText || '').trim()}`);
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
            btn.addEventListener('click', (e) => { e.stopPropagation(); openFor(table, th, i); });
            th.appendChild(btn);
            th.classList.add('tfil-th');
        });
    }

    const GRID_SELECTOR = GRID_CLASSES.map(c => `table.${c}`).join(',');

    function enhanceAll(root) {
        (root || document).querySelectorAll(GRID_SELECTOR).forEach(enhance);
    }

    /**
     * Give a windowed or paged table its real data.
     *   rows()            → the FULL array
     *   valueOf(row, i)   → the value in column i for that row
     *   apply(predicate)  → re-render with the predicate (null = no filter)
     *   sort(i, dir)      → optional; falls back to DOM sorting
     */
    function register(table, adapter) {
        const el = typeof table === 'string' ? document.querySelector(table) : table;
        if (!el) return;
        adapters.set(el, adapter);
        delete el.dataset.tfil;          // re-enhance now that it has real data
        delete el.dataset.tfilWindowed;
        enhance(el);
    }

    // Tables are rendered asynchronously on nearly every page here, so watch for
    // them the way table-cards.js does rather than betting on DOMContentLoaded.
    function start() {
        enhanceAll();
        new MutationObserver(() => enhanceAll()).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    return { enhance, enhanceAll, register, clear, apply, GRID_CLASSES };
})();
