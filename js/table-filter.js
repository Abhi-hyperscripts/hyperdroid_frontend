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

    /**
     * ⭐⭐⭐ HIDE WITH A CLASS, NOT WITH `style.display`.
     *
     * The first cut wrote `tr.style.display` directly. That property is not
     * ours: nine page scripts here already write it on table rows
     * (auth/admin.js, crm/settings.js, hrms/payroll.js, procurement/items.js,
     * accounts/budgets.js, three research pages). Two owners of one property
     * means the column filter silently UNHIDES rows the page deliberately hid,
     * and the page's own filter silently un-hides ours. A class we own cannot
     * collide with a page that owns the inline style.
     */
    const HIDE_CLASS = 'tfil-hide';

    const adapters = new WeakMap();   // table element → { rows, valueOf, apply }
    const state = new WeakMap();      // table element → { [colIndex]: Set(values) }
    const bars = new WeakMap();       // table element → its "filters active" bar
    let applying = false;             // re-entrancy guard for the observer
    let openMenu = null;              // the menu element, for re-entrancy checks

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

    /**
     * Positioning, scroll-tracking and dismissal all live in anchored-menu.js.
     * They used to live here, and the rules they encode — track the anchor in
     * the capture phase, size before placing, and remove EVERY listener the
     * menu added — were each learned from a defect. Keeping one implementation
     * is the only way the row-actions menu cannot rediscover them.
     */
    function closeMenu() { AnchoredMenu.close(); }

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

        openMenu = menu;
        AnchoredMenu.show(th, menu, {
            minHeight: 300,                       // chrome + a usable value list
            onClose: () => { if (openMenu === menu) openMenu = null; }
        });
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

        applying = true;
        try {
            let shown = 0, total = 0;
            if (ad) {
                ad.apply(active ? (row => matches(table, i => ad.valueOf(row, i))) : null);
            } else {
                for (const tr of dataRows(table)) {
                    total++;
                    const ok = matches(table, i => cellText(tr, i));
                    if (ok) shown++;
                    tr.classList.toggle(HIDE_CLASS, !ok);
                }
            }

            headerCells(table).forEach((th, i) => th.classList.toggle('tfil-on', !!st[i]));
            table.classList.toggle('tfil-any', active > 0);
            syncBar(table, st, shown, total);
        } finally {
            // Release after the observer has drained this batch of mutations.
            setTimeout(() => { applying = false; }, 0);
        }
    }

    /**
     * ⭐ THE BAR EXISTS BECAUSE A FILTER YOU CANNOT SEE READS AS A BROKEN ONE.
     *
     * Measured on the receivables grid: STATUS and CUSTOMER were both
     * filtering, and only STATUS had been opened. Two filters AND together, so
     * ticking values in one of them barely changes the table — reported,
     * entirely fairly, as "check/uncheck does nothing". The funnel does turn
     * blue on a filtering column, but that column can be scrolled off to the
     * right, which makes the only evidence invisible.
     *
     * So an active filter now announces itself above the table, names every
     * column involved, says how many rows survive, and offers one click to
     * undo all of it.
     */
    function syncBar(table, st, shown, total) {
        const cols = Object.keys(st);
        let bar = bars.get(table);

        if (!cols.length) {
            if (bar) { bar.remove(); bars.delete(table); }
            return;
        }
        if (!bar || !bar.isConnected) {
            bar = document.createElement('div');
            bar.className = 'tfil-bar';
            bar.innerHTML = '<span class="tfil-bar-txt"></span>' +
                '<button type="button" class="tfil-bar-clear">Clear all filters</button>';
            bar.querySelector('.tfil-bar-clear').addEventListener('click', () => clear(table));
            bars.set(table, bar);
        }
        if (bar.parentNode !== table.parentNode || bar.nextElementSibling !== table) {
            table.parentNode.insertBefore(bar, table);
        }

        const ths = headerCells(table);
        const names = cols.map(i => (ths[i]?.innerText || `Column ${+i + 1}`).trim()).join(', ');
        const adapted = adapters.has(table);
        bar.querySelector('.tfil-bar-txt').innerHTML =
            `Filtered by <b>${esc(names)}</b>` +
            (adapted ? '' : ` &middot; showing ${shown} of ${total} rows`);
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
        closeMenu();
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
    /**
     * ⭐ A RE-RENDER MUST NOT SILENTLY DROP THE FILTER.
     *
     * Pages here rebuild a tbody whenever data refreshes. The new rows carry
     * none of our marking, so without this the table quietly shows everything
     * while the header still says it is filtering — a filtered-looking grid
     * with unfiltered data, which is the worst of the three possible states.
     */
    function reapplyAll(root) {
        (root || document).querySelectorAll(GRID_SELECTOR).forEach(t => {
            const st = state.get(t);
            if (st && Object.keys(st).length) apply(t);
        });
    }

    function start() {
        enhanceAll();
        new MutationObserver(() => {
            if (applying) return;           // our own writes, not a page render
            enhanceAll();
            reapplyAll();
        }).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    return { enhance, enhanceAll, register, clear, apply, GRID_CLASSES, HIDE_CLASS };
})();
