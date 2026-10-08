#!/usr/bin/env node
/**
 * A page that CALLS a shared helper must also LOAD it, before the caller.
 *
 * WHY THIS EXISTS
 *
 * These helpers exist because the same rule was being copied per site and
 * reaching only some of them: the person/company naming chain reached 3 of ~10
 * display sites, so one lead rendered as "Digital Ultras" in the list and
 * "UNKNOWN" in the detail header beside it. Consolidating fixes that class and
 * buys a new one — a page that calls the helper without loading it throws
 * ReferenceError at render or click time, which in this codebase has repeatedly
 * meant a feature that silently does nothing rather than an obvious failure.
 *
 * This file started as check-lead-name-pairs.js, for one helper. The second
 * helper (the Mark-complete prompt, shared by My Day and the lead timeline)
 * would have meant copying eighty lines to change two strings — the exact
 * duplication these helpers exist to remove. So the guard is a TABLE: a new
 * shared helper adds a row, and is guarded from the first commit.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// helper file  →  how a call to it looks in a caller's source
const PAIRS = [
  { helper: 'js/crm/lead-name.js',         call: /\b(leadDisplayName|leadNameInitials)\s*\(/ },
  { helper: 'js/crm/followup-complete.js', call: /\bCrmFollowupComplete\s*\./ },
  // The quote panel. Shared by the Deals page, the full-page quote screen and — since the
  // lead Quotation tab (2026-10-06) — the lead detail pane. Three callers on three pages is
  // exactly the population this guard exists for: the panel is mounted behind
  // `typeof LineItemsPanel !== 'undefined'`, so a page that forgets the script does not throw.
  // It silently renders no Quotation tab content at all, which is the quietest possible
  // failure for the one panel that puts a price in front of a customer.
  { helper: 'js/crm/line-items-panel.js',  call: /\bLineItemsPanel\s*\./ },
  // The Quotation tab's panel. One caller today (the lead detail pane), and it is
  // in the table from the first commit for the reason in the header: a page that
  // calls it without loading it throws ReferenceError at render time, which in
  // this codebase has repeatedly meant a tab that silently stays blank.
  { helper: 'js/crm/quotation-panel.js',   call: /\bQuotationPanel\s*\./ },
];

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const jsFiles = walk(path.join(ROOT, 'js'), '.js');
const pages = walk(path.join(ROOT, 'pages'), '.html');
const problems = [];
let pairsChecked = 0;

for (const { helper, call } of PAIRS) {
  if (!fs.existsSync(path.join(ROOT, helper))) {
    problems.push(`${helper}\n    listed in this guard but does not exist`);
    continue;
  }

  // Which JS files call it? Strip comments first, so prose naming the helper
  // neither satisfies the scan nor drags an unrelated page into the population.
  const callers = new Set();
  for (const file of jsFiles) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel === helper) continue;
    const src = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (call.test(src)) callers.add(rel);
  }

  if (callers.size === 0) {
    problems.push(`${helper}\n    nothing calls it — the scan matched nothing, so this row asserts coverage of nothing`);
    continue;
  }

  let pagesForThisHelper = 0;
  for (const page of pages) {
    const rel = path.relative(ROOT, page).split(path.sep).join('/');
    const html = fs.readFileSync(page, 'utf8');

    // Resolve each <script src> against THIS page, so two directories owning a
    // same-named file cannot be confused for one another.
    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m =>
      path.relative(ROOT, path.resolve(path.dirname(page), m[1].split('?')[0]))
        .split(path.sep).join('/'));

    const used = srcs.filter(s => callers.has(s));
    if (used.length === 0) continue;
    pagesForThisHelper++;

    const at = srcs.indexOf(helper);
    if (at === -1) {
      problems.push(`${rel}\n    loads ${used.join(', ')}\n    but NOT ${helper} — the call throws at run time`);
      continue;
    }
    const firstCaller = Math.min(...used.map(u => srcs.indexOf(u)));
    if (at > firstCaller) {
      problems.push(`${rel}\n    loads ${helper} AFTER ${srcs[firstCaller]} — too late for top-level calls`);
    }
  }

  if (pagesForThisHelper === 0) {
    problems.push(`${helper}\n    has callers but no page loads any of them — the page scan proves nothing`);
    continue;
  }
  pairsChecked++;
}

if (problems.length) {
  console.error('Shared helper not paired with its callers:\n');
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}

console.log(`OK: ${pairsChecked}/${PAIRS.length} shared helper(s) loaded before every page that calls them`);
