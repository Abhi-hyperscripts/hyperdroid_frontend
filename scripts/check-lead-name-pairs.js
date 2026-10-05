#!/usr/bin/env node
/**
 * Any page whose scripts call leadDisplayName()/leadNameInitials() must also
 * load js/crm/lead-name.js, and must load it BEFORE the caller.
 *
 * WHY THIS EXISTS
 *
 * The chain "person name, else company, else fallback" was previously copied
 * into each site by hand. It reached three of about ten, which is how one lead
 * rendered as "Digital Ultras" with a "DU" avatar in the LeadDesk list and as
 * "UNKNOWN" in the detail header beside it — plus a convert-to-deal modal that
 * named the deal "- Deal". Consolidating into one helper fixes that class, and
 * trades it for a new one: a page that calls the helper without loading it
 * throws ReferenceError at render time, which in this codebase has repeatedly
 * meant a feature that silently does nothing rather than an obvious failure.
 *
 * Order is checked too. These are plain <script> tags, so a helper that loads
 * after its consumer is defined too late for any call made during that
 * consumer's own top-level execution.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const HELPER = 'js/crm/lead-name.js';
const CALL = /\b(leadDisplayName|leadNameInitials)\s*\(/;

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// Which JS files call the helper (the helper itself defines them, not a call).
const callers = new Set();
for (const file of walk(path.join(ROOT, 'js'), '.js')) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === HELPER) continue;
  // Strip comments first: prose naming the helper must not satisfy the scan,
  // and must not drag an unrelated page into the population either.
  const src = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (CALL.test(src)) callers.add(rel);
}

if (callers.size === 0) {
  console.error('FAIL: no file calls leadDisplayName() — the scan matched nothing,');
  console.error('      which means this guard is asserting coverage of nothing.');
  process.exit(1);
}

const problems = [];
let checked = 0;

for (const page of walk(path.join(ROOT, 'pages'), '.html')) {
  const rel = path.relative(ROOT, page).split(path.sep).join('/');
  const html = fs.readFileSync(page, 'utf8');

  // Resolve every <script src> against THIS page, so two directories owning a
  // same-named file can't be confused for one another.
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => {
    const raw = m[1].split('?')[0];
    return path.relative(ROOT, path.resolve(path.dirname(page), raw))
      .split(path.sep).join('/');
  });

  const used = srcs.filter(s => callers.has(s));
  if (used.length === 0) continue;
  checked++;

  const helperAt = srcs.indexOf(HELPER);
  if (helperAt === -1) {
    problems.push(`${rel}\n    loads ${used.join(', ')}\n    but NOT ${HELPER} — leadDisplayName() is undefined at render time`);
    continue;
  }
  const firstCallerAt = Math.min(...used.map(u => srcs.indexOf(u)));
  if (helperAt > firstCallerAt) {
    problems.push(`${rel}\n    loads ${HELPER} AFTER ${srcs[firstCallerAt]} — too late for top-level calls`);
  }
}

if (checked === 0) {
  console.error('FAIL: found callers but no page loads any of them —');
  console.error('      the page scan matched nothing, so this guard proves nothing.');
  process.exit(1);
}

if (problems.length) {
  console.error('Lead-name helper not paired with its callers:\n');
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}

console.log(`OK: ${checked} page(s) call the lead-name helper, all load ${HELPER} first`);
console.log(`    callers: ${[...callers].join(', ')}`);
