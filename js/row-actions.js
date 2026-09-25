/**
 * ROW ACTIONS → TWO ICONS AND AN OVERFLOW MENU
 * ============================================
 * A grid row here can carry eight controls. Measured on the live receivables
 * grid: 31 of 50 rows rendered
 *
 *   View | Download PDF | Apply advance | Write off | Cancel invoice |
 *   Send | Send Reminder | Pay
 *
 * as a row of unlabelled 14px glyphs, and the ACTIONS column came out 250px —
 * the second-widest column on the table, wider than TOTAL, BALANCE or STATUS.
 *
 * ⭐ THE REAL PROBLEM IS NOT THAT IT LOOKS BUSY.
 *
 * "Write off" posts the balance to Bad Debt. "Cancel invoice" reverses the GL
 * entry and any stock issued. Both sat as anonymous icons immediately beside
 * View and Download, at the same size, in the same colour. The cost of picking
 * the wrong glyph is a ledger posting, and nothing on screen said which was
 * which until you hovered.
 *
 * So: the two safe, high-frequency actions stay inline, everything else moves
 * into a ⋯ menu where each item has a NAME, and the destructive ones are
 * separated and coloured.
 *
 * ⭐⭐⭐ IT READS THE BUTTONS, IT DOES NOT REDEFINE THEM.
 *
 * Twenty-one files build these cells, each with its own per-status branching
 * (draft gets Edit/Approve/Delete, overdue gets Pay/Remind, and so on).
 * Rewriting twenty-one render functions is twenty-one chances to silently drop
 * an action for one status nobody tested. This module instead enhances what was
 * already rendered, and it never moves the original control: the menu item
 * forwards to `button.click()`, so whatever inline onclick the page attached
 * runs exactly as before.
 */
const RowActions = (() => {
    'use strict';

    // How many controls stay visible in the cell.
    const KEEP_INLINE = 2;
    // Below this there is nothing to gain — collapsing 3 into 2 + a menu button
    // saves no width and costs a click.
    const MIN_TO_COLLAPSE = 4;

    // Labels whose action changes money or destroys a document. These are
    // separated in the menu and coloured, in addition to the page's own
    // `btn-icon-danger` marking, because not every page marks them.
    const DANGER = /\b(delete|remove|cancel|void|reverse|write.?off|discard|deactivate|archive|reject)\b/i;

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    /** The name this control should carry in the menu. */
    function labelOf(el) {
        return (el.getAttribute('data-tooltip') || el.getAttribute('aria-label') ||
                el.getAttribute('title') || el.textContent || '').trim();
    }

    const isDanger = (el, label) =>
        el.classList.contains('btn-icon-danger') ||
        el.classList.contains('btn-danger') ||
        DANGER.test(label);

    /** Controls in a cell, in render order. Ignores anything already ours. */
    const controlsIn = (cell) => [...cell.children].filter(el =>
        (el.tagName === 'BUTTON' || el.tagName === 'A') &&
        !el.classList.contains('rowact-more'));

    function openMenu(cell, moreBtn) {
        const stash = cell.querySelector('.rowact-stash');
        if (!stash) return;
        const items = [...stash.children];
        if (!items.length) return;

        const rows = items.map(el => {
            const label = labelOf(el) || 'Action';
            return { el, label, danger: isDanger(el, label) };
        });
        const safe = rows.filter(r => !r.danger);
        const risky = rows.filter(r => r.danger);

        const menu = document.createElement('div');
        menu.className = 'rowact-menu';
        menu.setAttribute('role', 'menu');
        const render = (r, i) => `<button type="button" role="menuitem" data-i="${i}"` +
            ` class="rowact-item${r.danger ? ' rowact-danger' : ''}">` +
            `<span class="rowact-ico">${r.el.innerHTML.includes('<svg') ? r.el.innerHTML : ''}</span>` +
            `<span class="rowact-label">${esc(r.label)}</span></button>`;

        const ordered = [...safe, ...risky];
        menu.innerHTML =
            safe.map((r) => render(r, ordered.indexOf(r))).join('') +
            (risky.length && safe.length ? '<div class="rowact-sep"></div>' : '') +
            risky.map((r) => render(r, ordered.indexOf(r))).join('');

        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.rowact-item');
            if (!item) return;
            const target = ordered[+item.dataset.i];
            AnchoredMenu.close();
            // Forward to the ORIGINAL control so the page's own handler runs.
            if (target) target.el.click();
        });

        moreBtn.setAttribute('aria-expanded', 'true');
        AnchoredMenu.show(moreBtn, menu, {
            minHeight: 160,
            align: 'end',        // Actions is the last column: hang it leftward.
            onClose: () => moreBtn.setAttribute('aria-expanded', 'false')
        });
    }

    function enhanceCell(cell) {
        if (!cell || cell.dataset.rowact === '1') return;
        const controls = controlsIn(cell);
        if (controls.length < MIN_TO_COLLAPSE) {
            // Mark it so we do not re-measure this cell on every mutation, but
            // leave it exactly as the page rendered it.
            cell.dataset.rowact = '1';
            return;
        }
        cell.dataset.rowact = '1';

        const overflow = controls.slice(KEEP_INLINE);
        const stash = document.createElement('div');
        stash.className = 'rowact-stash';
        // Move, don't clone: a clone would lose nothing visible but WOULD lose
        // any listener the page attached with addEventListener rather than an
        // inline onclick, and the two are mixed across these 21 files.
        overflow.forEach(el => stash.appendChild(el));

        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'btn-icon rowact-more';
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        more.setAttribute('aria-label', `${overflow.length} more actions`);
        more.setAttribute('data-tooltip', 'More actions');
        more.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
            '<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            if (AnchoredMenu.isOpen()) { AnchoredMenu.close(); return; }
            openMenu(cell, more);
        });

        cell.appendChild(stash);
        cell.appendChild(more);
    }

    function enhanceAll(root) {
        (root || document).querySelectorAll('td.actions-cell').forEach(enhanceCell);
    }

    function start() {
        enhanceAll();
        new MutationObserver(() => enhanceAll())
            .observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    return { enhanceAll, enhanceCell, KEEP_INLINE, MIN_TO_COLLAPSE };
})();
