#!/usr/bin/env node
/**
 * Every page that renders a data grid must load BOTH halves of the column
 * filter, and neither half alone.
 *
 * WHY THIS EXISTS — three mistakes, each measured.
 *
 * 1. THE WRONG POPULATION. The filter was rolled out by anchoring the new
 *    <script> next to the existing `table-cards.js` tag, on the assumption that
 *    the two populations were the same. They are not: 67 pages load
 *    table-cards.js, only 32 render a .data-table, and EIGHT pages have a table
 *    and no table-cards.js — including accounts/inventory.html, the page the
 *    filter's data adapter was written for. The rollout reported "67 pages
 *    done" and the one that mattered had nothing. That is the per-file census
 *    of a per-call rule: I counted the sibling instead of counting the thing.
 *
 * 2. THE WRONG CLASS. `.data-table` is the house style but not the only one —
 *    HRMS self-service, CRM analytics and the HRMS bulk-import preview each
 *    grew their own. The user found that gap, asking "why don't those tables
 *    have this filter?". So the guard no longer hardcodes a class: it READS THE
 *    LIST OUT OF js/table-filter.js, and a new grid class therefore cannot ship
 *    without either joining the module's list or failing this check.
 *
 * 3. THE TABLE THAT ISN'T IN THE HTML. Most grids here are built at runtime by
 *    a template literal in a JS file, so a page can render a grid while its own
 *    markup contains no table at all. Scanning HTML alone said drive.html was
 *    fine; it renders two. This guard resolves each page's <script src> and
 *    follows it into the JS.
 *
 * It also catches the half-pair — js without css or css without js — which is
 * the failure mode that renders a working control invisible, or an invisible
 * control's styles with no control.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// ─── the grid classes, read from the module that defines them ───────────────
const MODULE = path.join(ROOT, 'js', 'table-filter.js');
const moduleSrc = fs.readFileSync(MODULE, 'utf8');
const listMatch = moduleSrc.match(/const GRID_CLASSES = \[([^\]]*)\]/);
if (!listMatch) {
  console.error('Could not read GRID_CLASSES out of js/table-filter.js — the guard and the module have drifted apart.');
  process.exit(1);
}
const GRID_CLASSES = [...listMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
if (GRID_CLASSES.length < 4) {
  console.error(`Only ${GRID_CLASSES.length} grid classes parsed — the guard is measuring almost nothing.`);
  process.exit(1);
}

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/**
 * ⭐ AN EXACT CLASS TOKEN, NOT A SUBSTRING. `\bdata-table\b` also matches
 * `data-table-container` — the wrapper div, which is on far more pages than the
 * table itself and pushed the count from 32 to 54. A guard that over-reports is
 * a guard people start ignoring.
 *
 * In JS the class must be on a <table> specifically: a JS file mentioning the
 * name in a selector or a comment builds nothing.
 */
const hasGridMarkup = (src) =>
  [...src.matchAll(/class=["'`]([^"'`]*)["'`]/g)]
    .some(m => m[1].split(/\s+/).some(t => GRID_CLASSES.includes(t)));

const buildsGrid = (src) =>
  [...src.matchAll(/<table\b([^>]*)>/g)].some(m => {
    const cls = /class=["'`]([^"'`]*)/.exec(m[1]);
    return cls && cls[1].split(/\s+/).some(t => GRID_CLASSES.includes(t));
  });

// ─── which JS files build a grid ────────────────────────────────────────────
const jsBuilders = new Set();
for (const file of walk(path.join(ROOT, 'js'), '.js')) {
  if (buildsGrid(fs.readFileSync(file, 'utf8'))) jsBuilders.add(path.relative(ROOT, file));
}
if (jsBuilders.size < 15) {
  console.error(`Only ${jsBuilders.size} JS files build a grid — the JS scan is not measuring the codebase.`);
  process.exit(1);
}

// ─── the pages ──────────────────────────────────────────────────────────────
const missing = [];
const halfPaired = [];
let withGrid = 0;

for (const file of walk(ROOT, '.html')) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const js = src.includes('table-filter.js');
  const css = src.includes('table-filter.css');

  if (js !== css) halfPaired.push(`${rel}  (js:${js} css:${css})`);

  // A grid in this page's own markup…
  let reason = hasGridMarkup(src) ? 'markup' : null;

  // …or one built by a script it loads. Resolve the src RELATIVE TO THE PAGE:
  // matching on the bare filename says `pages/research/primary-dashboard.html`
  // loads `js/crm/dashboard.js`, and four directories own a `dashboard.js`.
  if (!reason) {
    for (const m of src.matchAll(/<script\s+[^>]*src=["']([^"'?]+)/g)) {
      const s = m[1];
      if (/^https?:|^\/\//.test(s)) continue;
      const full = s.startsWith('/')
        ? path.join(ROOT, s.slice(1))
        : path.resolve(path.dirname(file), s);
      const r = path.relative(ROOT, full);
      if (jsBuilders.has(r)) { reason = r; break; }
    }
  }

  if (reason) {
    withGrid++;
    if (!js || !css) missing.push(`${rel}  (grid from ${reason})`);
  }
}

// ⭐ A floor. A scanner that finds no tables passes for free.
if (withGrid < 20) {
  console.error(`Only ${withGrid} pages with a grid found — the scan is not measuring the codebase.`);
  process.exit(1);
}

let bad = false;
if (missing.length) {
  bad = true;
  console.error('These pages render a data grid without the column filter:\n  ' + missing.join('\n  '));
}
if (halfPaired.length) {
  bad = true;
  console.error('\nThese load one half of the filter and not the other:\n  ' + halfPaired.join('\n  '));
}
if (bad) process.exit(1);

console.log(
  `OK — all ${withGrid} pages with a grid (${GRID_CLASSES.join(', ')}; ` +
  `${jsBuilders.size} JS builders) load both halves of the column filter.`);
