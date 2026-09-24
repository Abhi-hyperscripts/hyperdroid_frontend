/**
 * ANCHORED POPUP MENUS — ONE IMPLEMENTATION
 * =========================================
 * A small dropdown pinned to an element, living in <body> so no table's
 * overflow can clip it. Used by the column filter (table-filter.js) and the
 * row-actions overflow menu (row-actions.js).
 *
 * ⭐⭐⭐ WHY THIS IS SHARED RATHER THAN WRITTEN TWICE.
 *
 * Every hard-won rule below came from a defect the user reported, and each one
 * is invisible until a specific sequence happens. Copy the code and the second
 * copy will be the one missing a rule:
 *
 *   1. A `position: fixed` menu does NOT move with its anchor. Placing it once
 *      at open time looks correct until anything scrolls, then it floats away
 *      from the column it belongs to. It must TRACK, and it must listen in the
 *      CAPTURE phase, because the anchor is usually inside a table's own
 *      horizontal scroller and those scroll events do not bubble to window.
 *
 *   2. EVERY listener the menu adds must die with the menu. The first version's
 *      click-outside handler removed itself only on the path where it actually
 *      fired. Close the menu any other way — a Done button, Escape, or opening
 *      a different menu — and it stayed on `document` forever holding a stale
 *      reference. The NEXT menu's first click then hit it, found the target was
 *      not inside the OLD menu, and closed the live one. Reported as "the mouse
 *      clicks don't check/uncheck the checkboxes", because the first open of a
 *      page always worked and every open after it died on its first click.
 *
 *   3. Size to the space BEFORE placing. A menu placed below an anchor near the
 *      fold pushes its own footer off-screen, where it cannot be clicked and
 *      cannot be scrolled to (the menu is fixed; the page scrolls behind it).
 *      And the floor belongs on a USABLE height, not an arbitrary one — a 180px
 *      floor left the filter's value list 21 pixels tall: on screen, footer
 *      clickable, completely unusable.
 *
 * Fixed positioning is not optional here: the menu must escape `overflow` on
 * every table wrapper, and body.dashboard's ~25-entry :not() chain forces
 * position:relative and z-index:1 on anything left in the flow.
 */
const AnchoredMenu = (() => {
    'use strict';

    const GAP = 4, EDGE = 8;

    let current = null;   // { el, anchor, place, away, onKey, onClose }

    function close() {
        if (!current) return;
        const c = current;
        current = null;                      // first, so handlers re-entering are inert
        window.removeEventListener('scroll', c.place, true);
        window.removeEventListener('resize', c.place);
        document.removeEventListener('keydown', c.onKey, true);
        if (c.away) document.removeEventListener('click', c.away);
        c.el.remove();
        if (c.onClose) c.onClose();
    }

    const isOpen = (el) => !!current && (!el || current.el === el);

    /**
     * Show `el` anchored to `anchor`.
     *   minHeight — the smallest height at which this menu is still usable.
     *   onClose   — called after the menu is torn down.
     */
    function show(anchor, el, { minHeight = 300, onClose = null } = {}) {
        close();
        document.body.appendChild(el);

        const place = () => {
            const r = anchor.getBoundingClientRect();

            // Anchor scrolled out of sight: nothing to point at, so hide rather
            // than leave a menu hovering over unrelated content.
            if (r.bottom < 0 || r.top > window.innerHeight ||
                r.right < 0 || r.left > window.innerWidth) {
                el.style.visibility = 'hidden';
                return;
            }
            el.style.visibility = '';

            const below = window.innerHeight - r.bottom - GAP - EDGE;
            const above = r.top - GAP - EDGE;
            const wanted = el.scrollHeight;
            const flip = below < Math.min(wanted, 360) && above > below;
            const needed = Math.min(minHeight, window.innerHeight - 2 * EDGE);
            const room = Math.max(needed, flip ? above : below);

            el.style.maxHeight = `${Math.round(room)}px`;
            const h = Math.min(el.offsetHeight, room);
            const w = el.offsetWidth;

            let top = flip ? r.top - GAP - h : r.bottom + GAP;
            top = Math.max(EDGE, Math.min(top, window.innerHeight - h - EDGE));
            const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - w - 12));
            el.style.top = `${Math.round(top)}px`;
            el.style.left = `${Math.round(left)}px`;
        };
        place();

        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

        current = { el, anchor, place, onKey, onClose, away: null };
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        document.addEventListener('keydown', onKey, true);

        // Deferred so the click that opened the menu does not immediately shut
        // it. Registration is skipped if the menu has already gone, which would
        // otherwise leak exactly the handler rule 2 above is about.
        setTimeout(() => {
            if (!current || current.el !== el) return;
            current.away = (e) => { if (!el.contains(e.target)) close(); };
            document.addEventListener('click', current.away);
        }, 0);

        return { close, reposition: place };
    }

    return { show, close, isOpen };
})();
