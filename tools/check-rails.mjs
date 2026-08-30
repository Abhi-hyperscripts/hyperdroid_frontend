#!/usr/bin/env node
/**
 * ⭐⭐⭐ EVERY RAIL GETS THE SAME TREATMENT, OR THIS FAILS.
 *
 * The rail is defined once per app skin — twenty times — and the scroll
 * treatment has to hold across all of them. That is exactly the shape that
 * rots: someone adds a skin, copies a rail from before the change, and the
 * fleet quietly has two behaviours. Nobody notices, because a scrollbar in one
 * app looks like a scrollbar.
 *
 * So this enumerates the definitions from source rather than trusting a list,
 * and asserts the property across all of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⭐⭐⭐ THIS FILE SHIPPED GREEN WHILE HALF THE RAILS WERE UNTREATED.
 *
 * Three separate ways, all worth keeping written down, because each is a
 * general failure and not a typo:
 *
 *  1. DETECTOR TOO NARROW. It looked for a bare `nav.pulse-rail {` at the start
 *     of a line. Almost no skin writes that — they write
 *     `body.crm-my-day-page nav.pulse-rail {`. It found 9 files and missed 9 of 18,
 *     then printed "OK: 9 rails, all carrying the same scroll treatment."
 *
 *  2. IT COUNTED FILES IT WAS NOT CHECKING. Of the 9 it did find, several
 *     matched only on their mobile `nav.pulse-rail { display: none }` kill —
 *     not on a rail definition at all. A `display:none` rule is not a rail.
 *
 *  3. IT MATCHED ITS OWN PROSE. Widening the detector immediately flagged
 *     rail-drawer.css because the phrase "the pulse-rail as an overlay drawer"
 *     in its header comment ran into the next block's `position: fixed`.
 *
 * A detector narrower than the property it guards is worse than no detector,
 * because it is green. The fixes: key detection on what makes something a rail
 * (a block that POSITIONS it), strip comments first, and check box properties
 * INSIDE the box — an earlier draft passed rail-drawer.css on `gap: 3px`
 * because a descendant `.rail-item` block happened to have it.
 *
 * Run: node tools/check-rails.mjs      (exit 1 on drift)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cssDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'css');

// A floor. A scanner that matches nothing passes for free, and this one would
// go green the day someone renames the class.
const KNOWN_RAILS = 20;

// Both spellings of the same control: the fixed rail, and the overlay drawer
// used by pages whose left column is already spoken for.
// The trailing boundary is load-bearing: without it `rail-drawer` also matches
// `.rail-drawer-handle` and `.rail-drawer-scrim`, and the block matcher then
// reads the HANDLE's declarations while believing they are the rail's.
const RAIL = String.raw`(?:pulse-rail|rail-drawer)(?![\w-])`;

// A scan satisfied by the prose ABOUT a rule stays green after the rule is
// deleted. Strip before matching anything.
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The rail's DEFINITIONS — every block that positions one, not a display:none.
 *
 * ⭐ PLURAL. A non-global `css.match()` here returned only the FIRST rail in a
 * file, so a second untreated rail added to an existing skin was invisible —
 * and crm.css already scopes its rail to `body.crm-leads-page` while being
 * loaded by every CRM page, which makes "add another body-scoped rail to a file
 * that has one" the realistic next edit.
 */
function railBlocks(css) {
  const re = new RegExp(String.raw`([^\n{}]*` + RAIL + String.raw`[^{}]*)\{([^}]*position:\s*fixed[^}]*)\}`, 'gs');
  return [...css.matchAll(re)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
    index: m.index,
  }));
}

/**
 * Depth of a match: 0 = top level, >0 = nested inside a media query.
 *
 * ⭐ EXISTENCE IS NOT APPLICABILITY. The webkit rule cannot live inside the rail
 * block, so it is checked file-wide — and a file-wide existence test passed
 * crm-calendar.css, whose rule the codemod had parked INSIDE
 * `@media (max-width: 900px)`, next to the very rule that sets the rail to
 * display:none. It could never apply at any width where the rail is visible,
 * and the guard called it green. Three more files had the same shape.
 */
function depthOf(css, index) {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    const c = css[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return depth;
}

/**
 * ⭐⭐ A HIDE RULE THAT LOSES IS NOT A HIDE RULE.
 *
 * Every skin hides its rail below a breakpoint. The hide and the definition are
 * usually the identical selector string, so they have EQUAL specificity and
 * source order decides — and a hide written ABOVE the definition, without
 * !important, silently does nothing.
 *
 * css/crm-calendar.css had exactly that. Measured at 880px: the rail rendered
 * over the week grid, all 13 items unreachable, its icons showing through the
 * calendar as ghost marks. Four other skins have a same-shaped dead rule and
 * get away with it only because a later rule also hides the rail — which is
 * luck, not design, so this asks the real question: does ANY hide win?
 */
/**
 * The @media conditions wrapping a position in the stylesheet, outermost first.
 * Needed because "does this hide win?" is three questions, not one, and the
 * first version of this check only asked two of them.
 */
function enclosingMedia(css, index) {
  const conds = [];
  const stack = [];
  const re = /@media([^{]*)\{|\{|\}/g;
  let m;
  while ((m = re.exec(css)) && m.index < index) {
    if (m[0].startsWith('@media')) stack.push({ cond: m[1].trim(), depth: 1 });
    else if (m[0] === '{') { if (stack.length) stack[stack.length - 1].depth++; }
    else if (stack.length && --stack[stack.length - 1].depth === 0) stack.pop();
  }
  for (const f of stack) conds.push(f.cond);
  return conds;
}

/**
 * ⭐ ASKED PER RAIL, NOT PER FILE.
 *
 * This started life in IN_FILE, returning one verdict for the whole stylesheet
 * against the FIRST definition it found. railBlocks() had already been made
 * plural for exactly this reason, so the two disagreed: add a second rail to a
 * file that has one, give it no hide at all, and the first rail's hide set
 * `wins` for both. Measured — `OK: 21 rails in 20 files`, exit 0, with a rail
 * that never hides at any width.
 */
function railHideWins(css, rail) {
  // Page rails only. The overlay drawer is not hidden by a breakpoint at all —
  // js/rail-drawer.js toggles `body.rail-drawer-off` when the page's own rail is
  // showing, at any width — so demanding a max-width query of it would be
  // demanding the wrong mechanism.
  const PAGE_RAIL = String.raw`pulse-rail(?![\w-])`;
  if (!new RegExp(PAGE_RAIL).test(rail.selector)) return true;
  const def = rail.index;
  const re = new RegExp(String.raw`([^\n{}]*` + PAGE_RAIL + String.raw`[^{}]*)\{([^}]*display:\s*none[^}]*)\}`, 'g');
  let m, wins = false;
  while ((m = re.exec(css))) {
    // Skip ONLY a rule whose every selector is the scrollbar pseudo — that one
    // is meant to be display:none. A looser skip lets a real hide be merged
    // into such a selector list and vanish from the count entirely, and then
    // `hides === 0` hands the file a free pass.
    const selectors = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    if (selectors.length && selectors.every((sel) => sel.includes('::-webkit-scrollbar'))) continue;

    // Does this hide actually target THIS rail? A skin hides its own rail either
    // with the identical selector or with a less-specific one that still matches
    // it (`nav.pulse-rail` covers `body.x-page nav.pulse-rail`), so a hide counts
    // when its selector is a suffix of the definition's.
    // Equal, or the hide is LESS specific and therefore still matches this rail
    // (`nav.pulse-rail` covers `body.x-page nav.pulse-rail`). Deliberately NOT
    // the reverse: a narrower hide does not cover a broader definition. That
    // third clause was there, was load-bearing for nothing, and let a rail
    // defined bare — pms-pulse.css, which applies on every PMS page — be
    // "hidden" by a rule scoped to a single page.
    const targetsThisRail = selectors.some((sel) =>
      rail.selector === sel || rail.selector.endsWith(' ' + sel));
    if (!targetsThisRail) continue;

    // ⭐ THREE conditions, not two. The first version asked only about position
    // and !important, so a hide sitting in a `min-width` query — or in no query
    // at all — counted as a win. Flipping one `max-width` to `min-width` in
    // crm-analytics.css put the rail back over the content at 900px and the
    // guard still printed OK.
    // The !important must be on `display`, not merely somewhere in the block.
    // Tested against the whole body, `{ display: none; width: 0 !important; }`
    // counted as a win — and on crm-calendar, the one file whose hide depends on
    // !important, that puts the rail back over the week grid with the guard green.
    const beatsDefinition = m.index > def || /display:\s*none\s*!important/.test(m[2]);
    // A max-width alone is not enough: `(min-width: 769px) and (max-width: 1023px)`
    // contains one and still does not hide on a phone. Require a max-width and
    // no min-width anywhere in the enclosing conditions. No file has a banded
    // hide today — this is latent, closed while it is cheap.
    const conds = enclosingMedia(css, m.index);
    const isMobileScoped = conds.some((c) => /max-width/.test(c))
                        && !conds.some((c) => /min-width/.test(c));
    if (beatsDefinition && isMobileScoped) wins = true;
  }
  // ⭐ NO FREE PASS FOR "NO HIDE AT ALL".
  //
  // That exemption made sense while this was a per-FILE question — a stylesheet
  // with no hide might simply not own a rail. Per RAIL it is the defect itself:
  // a page rail with nothing hiding it stays on screen at every width, and the
  // second-rail red-proof stayed green on precisely that. Measured before
  // removing it: all 19 page rails already have a hide aimed at them, so nothing
  // legitimate depended on the pass.
  return wins;
}

/** The part of a rail's selector before the rail token — its page scope. */
function scopeOf(railSelector) {
  return railSelector.replace(new RegExp(String.raw`(?:nav)?\.?` + RAIL + '$'), '').trim();
}

/**
 * ⭐ ASKED PER RAIL. Both of these were left in IN_FILE when railHideWins moved
 * out, which is the same shape it moved out of: a second rail added to a file
 * that already has one was covered by the FIRST rail's webkit rule and item
 * padding, and the tool printed the same "OK: 21 rails in 20 files" sentence
 * that motivated the move.
 */
function hasTopLevelWebkitRule(css, rail) {
  const re = new RegExp(RAIL + '::-webkit-scrollbar', 'g');
  return [...css.matchAll(re)].some((m) => {
    if (depthOf(css, m.index) !== 0) return false;

    // The whole selector LIST of the enclosing rule, not the current line.
    // Slicing from the last newline made the check depend on how the author
    // happened to wrap: a rule sharing a line with another, or a selector split
    // across two lines, made correct CSS fail. Loud rather than silent, but
    // still wrong. Everything since the previous rule's `}` is the selector.
    const ruleStart = Math.max(css.lastIndexOf('}', m.index), css.lastIndexOf('{', m.index)) + 1;
    const selectors = css.slice(ruleStart, m.index + '::-webkit-scrollbar'.length)
      .split(',').map((x) => x.trim()).filter(Boolean);

    // ⭐ EXACTLY THIS RAIL — no scope fallback.
    //
    // A `scope` fallback lived here for two rounds and was wrong both times.
    // First it used `startsWith(scopeOf(...))`, and scopeOf returns "" for the
    // six rails written bare, so `startsWith("")` made the restriction inert on
    // precisely those. Guarding the empty case then left a PREFIX test where a
    // containment test was needed: `body.crm-tasks-page-v2 nav.pulse-rail…`
    // starts with `body.crm-tasks-page` and can never match it, and
    // `body.x-page .drawer nav.pulse-rail…` starts with `body.x-page` and
    // cannot match a rail that is a body child.
    //
    // Measured before deleting it: the fallback is dormant — every one of the
    // 20 rails is still found by the exact test alone, and every plant still
    // fails. It bought nothing and widened the hole twice.
    return selectors.some((sel) => sel.startsWith(rail.selector));
  });
}

function hasTightItemPadding(css, rail) {
  const scope = scopeOf(rail.selector);
  const re = /([^\n{}]*\.rail-item)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (!/padding:\s*6px 0 5px/.test(m[2])) continue;
    const itemScope = m[1].replace(/\.rail-item$/, '').trim();
    // bare items belong to a bare rail; scoped items must share the rail's scope
    if (itemScope === scope || itemScope === rail.selector) return true;
  }
  return false;
}

// Properties of the BOX, asserted inside the box. Checking these file-wide is
// how a descendant block's `gap: 3px` silently satisfied the rail's own.
const IN_BLOCK = [
  { name: 'scrolls rather than clips', re: /overflow-y:\s*auto/ },
  { name: 'hidden scrollbar (firefox)', re: /scrollbar-width:\s*none/ },
  // Anchored at a declaration boundary. Unanchored, `mask-image:` also matches
  // inside `-webkit-mask-image:`, so deleting the standard property left the
  // guard green while the fade was gone in Firefox and every non-WebKit engine.
  { name: 'edge fade mask',             re: /(?:^|[\s;{])mask-image:\s*linear-gradient/ },
  { name: 'edge fade mask (webkit)',    re: /-webkit-mask-image:\s*linear-gradient/ },
  { name: 'tightened rail gap',         re: /gap:\s*3px/ },
];

// These necessarily live outside the block.
// Nothing is asked per FILE any more: every property of a rail belongs to that
// rail, and a file may hold more than one.
const IN_FILE = [];

// Checked per rail, with both the file and that rail's own definition in hand.
const PER_RAIL = [
  { name: 'hidden scrollbar (webkit), at top level', test: hasTopLevelWebkitRule },
  { name: 'tightened item padding',                  test: hasTightItemPadding },
  { name: 'a mobile hide that actually wins',        test: railHideWins },
];

const files = readdirSync(cssDir).filter((f) => f.endsWith('.css'));
const rails = files
  .map((f) => ({ f, css: strip(readFileSync(join(cssDir, f), 'utf8')) }))
  .map((r) => ({ ...r, blocks: railBlocks(r.css) }))
  .filter((r) => r.blocks.length > 0);

// Floored on the number of RAILS, not of files. `rails.length` counts files with
// at least one, so deleting one of two rails in a single file left the count
// unchanged — the very multi-rail-per-file case the plural railBlocks() added.
const totalRails = rails.reduce((n, r) => n + r.blocks.length, 0);
if (totalRails < KNOWN_RAILS) {
  console.error(
    `FAIL: found ${totalRails} rail definitions, expected at least ${KNOWN_RAILS}.\n` +
    `      Either a rail was removed, or this scan no longer matches how they are\n` +
    `      written — a guard that matches nothing passes for free.`);
  process.exit(1);
}

let bad = 0;
let blockCount = 0;
for (const { f, css, blocks } of rails) {
  blockCount += blocks.length;
  blocks.forEach((rail, i) => {
    const where = blocks.length > 1 ? ` (rail ${i + 1} of ${blocks.length})` : '';
    const missing = [
      ...IN_BLOCK.filter((r) => !r.re.test(rail.body)),
      ...IN_FILE.filter((r) => !r.test(css)),
      ...PER_RAIL.filter((r) => !r.test(css, rail)),
    ].map((r) => r.name);
    if (missing.length) {
      bad++;
      console.error(`FAIL: css/${f}${where} is missing: ${missing.join(', ')}`);
    }
  });
}

if (bad) {
  console.error(
    `\n${bad} of ${blockCount} rails drifted. Every rail in the app must scroll the\n` +
    `same way: no visible bar, a fade at both ends carrying the cue instead, and the\n` +
    `tightened density that means most windows do not scroll at all.`);
  process.exit(1);
}

console.log(`OK: ${blockCount} rails in ${rails.length} files, all carrying the same scroll treatment.`);
