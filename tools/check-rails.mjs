#!/usr/bin/env node
/**
 * ⭐⭐⭐ EVERY RAIL GETS THE SAME TREATMENT, OR THIS FAILS.
 *
 * The rail is defined FIVE times — each app skin owns its own — and the scroll
 * treatment was applied to all five by hand. That is exactly the shape that
 * rots: someone adds a sixth app, copies a rail from before the change, and the
 * fleet quietly has two behaviours. Nobody notices, because a scrollbar in one
 * app looks like a scrollbar.
 *
 * So this enumerates the definitions from source rather than trusting a list,
 * and asserts the property across all of them.
 *
 * Run: node tools/check-rails.mjs      (exit 1 on drift)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cssDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'css');

// A floor. A scanner that matches nothing passes for free, and this one would
// go green the day someone renames the class.
//
// It is NINE, not five. The hand-count that preceded this file anchored its
// grep at line start and so missed four body-scoped definitions — crm-analytics,
// crm-contacts, crm-deals, crm-tasks — which this caught on its first run, with
// the treatment already applied to the other five. That is the whole argument
// for enumerating from source instead of keeping a list.
const KNOWN_RAILS = 9;

const REQUIRED = [
  { name: 'hidden scrollbar (firefox)', re: /scrollbar-width:\s*none/ },
  { name: 'hidden scrollbar (webkit)',  re: /nav\.pulse-rail::-webkit-scrollbar/ },
  { name: 'edge fade mask',             re: /mask-image:\s*linear-gradient/ },
  { name: 'tightened rail gap',         re: /nav\.pulse-rail\s*\{[^}]*gap:\s*3px/s },
  { name: 'tightened item padding',     re: /\.rail-item\s*\{[^}]*padding:\s*6px 0 5px/s },
];

const files = readdirSync(cssDir).filter((f) => f.endsWith('.css'));
const rails = files.filter((f) =>
  /^\s*nav\.pulse-rail\s*\{/m.test(readFileSync(join(cssDir, f), 'utf8')));

if (rails.length < KNOWN_RAILS) {
  console.error(
    `FAIL: found ${rails.length} rail definitions, expected at least ${KNOWN_RAILS}.\n` +
    `      Either a rail was removed, or this scan no longer matches how they are\n` +
    `      written — a guard that matches nothing passes for free.`);
  process.exit(1);
}

let bad = 0;
for (const f of rails) {
  const css = readFileSync(join(cssDir, f), 'utf8');
  const missing = REQUIRED.filter((r) => !r.re.test(css)).map((r) => r.name);
  if (missing.length) {
    bad++;
    console.error(`FAIL: css/${f} is missing: ${missing.join(', ')}`);
  }
}

if (bad) {
  console.error(
    `\n${bad} of ${rails.length} rails drifted. Every rail in the app must scroll the\n` +
    `same way: no visible bar, a fade at both ends carrying the cue instead, and the\n` +
    `tightened density that means most windows do not scroll at all.`);
  process.exit(1);
}

console.log(`OK: ${rails.length} rails, all carrying the same scroll treatment.`);
