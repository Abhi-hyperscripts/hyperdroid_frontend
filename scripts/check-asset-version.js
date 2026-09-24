#!/usr/bin/env node
/**
 * Fails a push where a page's static `?v=` asset version has drifted from
 * SW_VERSION in js/sw-version.js.
 *
 * WHY THIS EXISTS
 *
 * Pages historically wrote every stylesheet and script through
 * `document.write('<link href="…?v=' + CACHE_VERSION + '">')`, with
 * CACHE_VERSION = Date.now(). That guaranteed freshness and cost the browser's
 * preload scanner: a URL built inside a JavaScript string is invisible to it,
 * so nothing could be fetched ahead of time and the assets loaded in a strict
 * serial chain — one file, then the next, each waiting on the last.
 *
 * Measured on prod (accounts/inventory.html, 2026-09-24): 19 serial hops at
 * ~270ms each. The HTML arrived at 338ms and the page did not issue its FIRST
 * API call until 4,940ms. Gaps between one file ending and the next starting
 * were 0-2ms — the definition of a serial chain.
 *
 * Static tags fix that: the scanner sees them immediately and fetches them in
 * parallel, while document order still governs execution. The cost is that the
 * version can no longer be computed at runtime, so it is a literal — and a
 * literal that must be bumped by hand is a literal that will be forgotten.
 * Hence this guard. SW_VERSION is already mandatory to bump on every frontend
 * change, so pinning to it adds no new ritual.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function swVersion() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'sw-version.js'), 'utf8');
  const m = src.match(/const\s+SW_VERSION\s*=\s*(\d+)/);
  if (!m) {
    console.error('Could not read SW_VERSION from js/sw-version.js');
    process.exit(1);
  }
  return m[1];
}

function htmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const expected = swVersion();
const offenders = [];
let scanned = 0;
let versionedTags = 0;

for (const file of htmlFiles(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  scanned++;
  // ⭐ .css AND .js ONLY, AND THAT NARROWNESS IS MEASURED.
  //
  // The first draft matched any `?v=<digits>` and flagged 250 pages, because
  // nearly every one carries `/assets/apple-touch-icon.png?v=2` — a deliberate
  // icon revision that has nothing to do with asset versioning and must not be
  // dragged along on every SW bump. A guard that fires on 250 innocent files is
  // a guard that gets switched off.
  //
  // Only STATIC tags: `?v=' + CACHE_VERSION` inside a document.write is the old
  // runtime form and is not this guard's business.
  for (const m of src.matchAll(/(?:src|href)="[^"]+\.(?:css|js)\?v=(\d+)"/g)) {
    versionedTags++;
    if (m[1] !== expected) {
      offenders.push(`${path.relative(ROOT, file)}  ?v=${m[1]}`);
    }
  }
}

// ⭐ A FLOOR. A scanner that matches nothing passes for free, which is how a
// guard becomes decorative without anyone noticing.
if (versionedTags < 30) {
  console.error(
    `Only ${versionedTags} statically versioned asset tags found across ${scanned} pages — ` +
    'the scan is not measuring the codebase.');
  process.exit(1);
}

if (offenders.length) {
  console.error(
    `These pages pin an asset version that is not SW_VERSION (${expected}).\n` +
    'Bump js/sw-version.js and the ?v= literals together — they are one number:\n  ' +
    [...new Set(offenders)].join('\n  '));
  process.exit(1);
}

console.log(`OK — ${versionedTags} versioned asset tags across ${scanned} pages all pinned to SW_VERSION ${expected}.`);
