/**
 * ⭐ THE COMMAND PALETTE — every section in Accounts, from any page, in two keystrokes.
 *
 * <p>This exists because of a measured gap. The module has 111 sections across 22
 * pages. The rail reaches 13 destinations and has to stay short to work as a rail;
 * the grouped Explore menu reaches 91, but it lives on the DASHBOARD ONLY — so from
 * Receivables you could not get to Quotes, Projects or Loans without navigating home
 * first. Ten pages had exactly one inbound link in the whole product, all of them on
 * the dashboard.</p>
 *
 * <p>A palette closes that without growing the rail: it ships on every page and reads
 * the SAME list the Explore menu renders (accounts-explore.js), so a destination
 * added there is searchable here with no second edit. That is the same
 * one-definition rule accounts-rail.js exists to enforce — a navigation written
 * twice is a navigation that drifts.</p>
 *
 * <p>⭐ THE DESCRIPTIONS ARE NOT NEW COPY. accounts-help.js already carries 94
 * hand-written, plain-English explanations — one per section, aimed at a reader with
 * no accounting background. 82 of the 91 destinations have one. Showing the first
 * sentence under each result means the palette teaches while it navigates, and it
 * cost nothing to write. That file is already lazy-loaded by accounts-common.js on
 * every accounts page; if the palette opens before it lands, it loads it itself.</p>
 *
 * Keys: ⌘K / Ctrl+K anywhere · "/" when not typing · ↑ ↓ Enter Esc.
 */
(function () {
    'use strict';

    let INDEX = null, el = null, listEl = null, inputEl = null, rows = [], cursor = 0;
    const RECENT_KEY = 'acct_palette_recent';

    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    /** Delegates to accounts-explore.js, which owns both the destinations and the
     *  help lookup. Two implementations of "what does this section do" would drift. */
    const helpFor = (href) => (window.AccountsExplore ? window.AccountsExplore.describe(href) : '');

    function build() {
        const groups = (window.AccountsExplore && window.AccountsExplore.groups) || [];
        const out = [];
        groups.forEach(g => g.links.forEach(([label, href]) =>
            out.push({ label, href, group: g.name, color: g.color, desc: helpFor(href) })));
        // The rail's own destinations, for anything the groups do not already cover
        // (the Dashboard itself, chiefly). Deduped by page so "Inventory" does not
        // appear twice with two different labels.
        const seen = new Set(out.map(r => r.href.split('#')[0]));
        ((window.ACCOUNTS_RAIL_ITEMS) || []).forEach(it => {
            if (seen.has(it.href)) return;
            out.push({ label: it.title, href: it.href, group: 'Go to', color: it.color, desc: '' });
        });
        return out;
    }

    /** Subsequence match with a score: a prefix beats a word start beats a scattered
     *  match, so typing "gst" puts GSTR-1 above "Adjust stock". Returns -1 for no match. */
    function score(needle, hay) {
        const h = hay.toLowerCase();
        if (!needle) return 0;
        const at = h.indexOf(needle);
        if (at === 0) return 1000;
        if (at > 0) return (/[\s(/&-]/.test(h[at - 1]) ? 700 : 400) - at;
        let i = 0, hits = 0, last = -1, gap = 0;
        for (let j = 0; j < h.length && i < needle.length; j++) {
            if (h[j] === needle[i]) { if (last >= 0) gap += j - last - 1; last = j; i++; hits++; }
        }
        return i === needle.length ? Math.max(1, 200 - gap) : -1;
    }

    function search(q) {
        const needle = q.trim().toLowerCase();
        if (!needle) {
            let recent = [];
            try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) {}
            const byHref = new Map(INDEX.map(r => [r.href, r]));
            const picks = recent.map(h => byHref.get(h)).filter(Boolean);
            return { heading: picks.length ? 'Recent' : 'Jump to', rows: picks.length ? picks : INDEX.slice(0, 8) };
        }
        const scored = [];
        for (const r of INDEX) {
            const s = Math.max(score(needle, r.label), score(needle, r.group) - 250,
                               r.desc ? score(needle, r.desc) - 350 : -1);
            if (s > 0) scored.push([s, r]);
        }
        scored.sort((a, b) => b[0] - a[0] || a[1].label.length - b[1].label.length);
        return { heading: `${scored.length} result${scored.length === 1 ? '' : 's'}`, rows: scored.slice(0, 40).map(x => x[1]) };
    }

    function paint(q) {
        const { heading, rows: found } = search(q);
        rows = found;
        cursor = 0;
        listEl.innerHTML = found.length
            ? `<div class="cp-head">${esc(heading)}</div>` + found.map((r, i) => `
                <a class="cp-row${i === 0 ? ' on' : ''}" href="${r.href}" data-i="${i}">
                  <span class="cp-dot" style="background:${r.color}"></span>
                  <span class="cp-main">
                    <span class="cp-label">${esc(r.label)}</span>
                    ${r.desc ? `<span class="cp-desc">${esc(r.desc)}</span>` : ''}
                  </span>
                  <span class="cp-group">${esc(r.group)}</span>
                </a>`).join('')
            : `<div class="cp-empty">Nothing matches “${esc(q)}”.</div>`;
    }

    function move(step) {
        if (!rows.length) return;
        const items = listEl.querySelectorAll('.cp-row');
        items[cursor] && items[cursor].classList.remove('on');
        cursor = (cursor + step + rows.length) % rows.length;
        items[cursor].classList.add('on');
        items[cursor].scrollIntoView({ block: 'nearest' });
    }

    function go(row) {
        if (!row) return;
        try {
            const prev = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
            localStorage.setItem(RECENT_KEY, JSON.stringify([row.href, ...prev.filter(h => h !== row.href)].slice(0, 6)));
        } catch (_) { /* private mode — navigation still works, it just forgets */ }
        window.location = row.href;
    }

    function close() { if (el) { el.remove(); el = null; } }

    function open() {
        if (el) { inputEl.focus(); inputEl.select(); return; }
        // ACCOUNTS_HELP is normally already loaded by accounts-common's help panels.
        // If the user hits ⌘K before that lands, open immediately WITHOUT descriptions
        // and fill them in when it arrives — an empty palette waiting on a 65KB file
        // would defeat the point of a keyboard shortcut.
        if (!window.ACCOUNTS_HELP && !document.querySelector('script[data-cp-help]')) {
            const s = document.createElement('script');
            s.dataset.cpHelp = '1';
            s.src = `../../js/accounts/accounts-help.js?v=${typeof CACHE_VERSION !== 'undefined' ? CACHE_VERSION : Date.now()}`;
            s.onload = () => { INDEX = build(); if (el) paint(inputEl.value); };
            document.head.appendChild(s);
        }
        INDEX = build();

        el = document.createElement('div');
        el.className = 'cp-scrim';
        el.innerHTML = `
            <div class="cp" role="dialog" aria-modal="true" aria-label="Search Accounts">
              <div class="cp-bar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" placeholder="Search invoices, GSTR-1, stock on hand…" autocomplete="off" spellcheck="false">
                <kbd>esc</kbd>
              </div>
              <div class="cp-list"></div>
            </div>`;
        document.body.appendChild(el);
        listEl = el.querySelector('.cp-list');
        inputEl = el.querySelector('input');
        paint('');
        inputEl.focus();

        inputEl.addEventListener('input', () => paint(inputEl.value));
        el.addEventListener('click', (e) => { if (e.target === el) close(); });
        listEl.addEventListener('mousemove', (e) => {
            const r = e.target.closest('.cp-row');
            if (!r || r.classList.contains('on')) return;
            listEl.querySelectorAll('.cp-row.on').forEach(x => x.classList.remove('on'));
            r.classList.add('on');
            cursor = +r.dataset.i;
        });
        listEl.addEventListener('click', (e) => {
            const r = e.target.closest('.cp-row');
            if (r) { e.preventDefault(); go(rows[+r.dataset.i]); }
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); go(rows[cursor]); }
        });
    }

    document.addEventListener('keydown', (e) => {
        const k = (e.key || '').toLowerCase();
        if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); open(); return; }
        if (el) return;
        // "/" is a shortcut only when the user is not already typing somewhere.
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (k === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); open(); }
    });

    window.AccountsPalette = { open, close };
})();
