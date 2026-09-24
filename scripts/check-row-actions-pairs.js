#!/usr/bin/env node
/**
 * Every page that renders an `.actions-cell` must load all three parts of the
 * row-actions overflow menu, and `anchored-menu.js` must reach every page that
 * uses a menu built on it.
 *
 * WHY THIS EXISTS
 *
 * The column filter shipped to the wrong population twice — first by anchoring
 * on a sibling script instead of counting the thing itself, then by scanning
 * HTML only while most grids are built at runtime in JS. The user found both.
 * This guard is the same shape as check-table-filter-pairs.js and is written
 * BEFORE the same mistake can be made a third time.
 *
 * The dependency direction matters and is checked in both directions:
 *   - a page with row-actions.js or table-filter.js MUST have anchored-menu.js,
 *     or the menu throws ReferenceError the first time it is opened;
 *   - anchored-menu.js must come BEFORE nothing in particular at parse time,
 *     but shipping it without either consumer is dead weight and usually means
 *     a half-applied edit, so that is reported too.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// JS files that render an actions cell — the same runtime-rendering blind spot
// the table-filter guard had to learn about.
const jsBuilders = new Set();
for (const file of walk(path.join(ROOT, 'js'), '.js')) {
  if (fs.readFileSync(file, 'utf8').includes('actions-cell')) {
    jsBuilders.add(path.relative(ROOT, file));
  }
}
if (jsBuilders.size < 15) {
  console.error(`Only ${jsBuilders.size} JS files render an actions-cell — the scan is not measuring the codebase.`);
  process.exit(1);
}

const missingRowActions = [];
const missingAnchor = [];
const orphanAnchor = [];
let withActions = 0;

for (const file of walk(ROOT, '.html')) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const js = src.includes('row-actions.js');
  const css = src.includes('row-actions.css');
  const anchor = src.includes('anchored-menu.js');
  const filter = src.includes('table-filter.js');

  if ((js || filter) && !anchor) missingAnchor.push(rel);
  if (anchor && !js && !filter) orphanAnchor.push(rel);

  let reason = src.includes('actions-cell') ? 'markup' : null;
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
    withActions++;
    if (!js || !css) missingRowActions.push(`${rel}  (actions from ${reason})`);
  }
}

// ⭐ A floor. A scanner that finds nothing passes for free.
if (withActions < 15) {
  console.error(`Only ${withActions} pages with an actions cell found — the scan is not measuring the codebase.`);
  process.exit(1);
}

let bad = false;
if (missingRowActions.length) {
  bad = true;
  console.error('These pages render an actions cell without the overflow menu:\n  ' + missingRowActions.join('\n  '));
}
if (missingAnchor.length) {
  bad = true;
  console.error('\nThese load a menu module but not anchored-menu.js, so the menu throws when opened:\n  ' + missingAnchor.join('\n  '));
}
if (orphanAnchor.length) {
  bad = true;
  console.error('\nThese load anchored-menu.js with neither consumer:\n  ' + orphanAnchor.join('\n  '));
}
if (bad) process.exit(1);

console.log(`OK — all ${withActions} pages with an actions cell load the overflow menu, ` +
            `and anchored-menu.js reaches every page that needs it (${jsBuilders.size} JS builders).`);
