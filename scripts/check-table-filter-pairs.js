#!/usr/bin/env node
/**
 * Every page that renders a `.data-table` must load BOTH halves of the column
 * filter, and neither half alone.
 *
 * WHY THIS EXISTS — a mistake, measured.
 *
 * The filter was rolled out by anchoring the new <script> next to the existing
 * `table-cards.js` tag, on the assumption that the two populations were the
 * same. They are not: 67 pages load table-cards.js, only 32 render a
 * .data-table, and EIGHT pages have a table and no table-cards.js — including
 * accounts/inventory.html, the page the filter's data adapter was written for.
 * The rollout reported "67 pages done" and the one that mattered had nothing.
 *
 * That is the per-file census of a per-call rule: I counted the sibling instead
 * of counting the thing. This guard counts the thing.
 *
 * It also catches the half-pair — js without css or css without js — which is
 * the failure mode that renders a working control invisible, or an invisible
 * control's styles with no control.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(full, out);
    else if (e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const missing = [];
const halfPaired = [];
let withTable = 0;

for (const file of htmlFiles(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const js = src.includes('table-filter.js');
  const css = src.includes('table-filter.css');

  if (js !== css) halfPaired.push(`${rel}  (js:${js} css:${css})`);

  // ⭐ AN EXACT CLASS TOKEN, NOT A SUBSTRING. `\bdata-table\b` also matches
  // `data-table-container` — the wrapper div, which is on far more pages than
  // the table itself and pushed the count from 32 to 54. A guard that
  // over-reports is a guard people start ignoring.
  const classLists = [...src.matchAll(/class=["']([^"']*)["']/g)].map(m => m[1].split(/\s+/));
  if (classLists.some(tokens => tokens.includes('data-table'))) {
    withTable++;
    if (!js || !css) missing.push(rel);
  }
}

// ⭐ A floor. A scanner that finds no tables passes for free.
if (withTable < 20) {
  console.error(`Only ${withTable} pages with a .data-table found — the scan is not measuring the codebase.`);
  process.exit(1);
}

let bad = false;
if (missing.length) {
  bad = true;
  console.error(
    'These pages render a .data-table without the column filter:\n  ' + missing.join('\n  '));
}
if (halfPaired.length) {
  bad = true;
  console.error(
    '\nThese load one half of the filter and not the other:\n  ' + halfPaired.join('\n  '));
}
if (bad) process.exit(1);

console.log(`OK — all ${withTable} pages with a .data-table load both halves of the column filter.`);
