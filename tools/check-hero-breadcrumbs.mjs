#!/usr/bin/env node
/**
 * ⭐⭐⭐ EVERY HERO WITH A BREADCRUMB MUST BE LIFTED ABOVE ITS WAVE.
 *
 * The CRM heroes paint a decorative chart across the whole header with
 * `position: absolute; inset: 0`. A breadcrumb that is a plain in-flow child of
 * that header therefore ends up UNDERNEATH it: the chart swallows the hover and
 * the click, and the "CRM" crumb stops working. css/crm.css fixes this by
 * lifting the breadcrumb with `position: relative; z-index: 10` — for a
 * hand-maintained list of hero classes.
 *
 * A hand-maintained list of N things is the shape that rots, and it did:
 * building the Companies hero added an eighth member, `.cmp-hero`, and nobody
 * added it to the list. Playwright refused to click the crumb —
 * "svg from div#cmpWave subtree intercepts pointer events" — and the bug is
 * invisible on an empty tenant, because the wave only renders once there is
 * data to draw. Every real tenant has data.
 *
 * So: enumerate the heroes from the PAGES, and assert each is in the list.
 *
 * Run: node tools/check-hero-breadcrumbs.mjs      (exit 1 on drift)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A floor. A scanner that matches nothing passes for free.
const KNOWN_HEROES = 12;

const crmCss = readFileSync(join(root, 'css', 'crm.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');          // never let the prose satisfy the scan

/**
 * ⭐⭐⭐ MATCH THE RULE BY WHAT IT DOES, NOT BY ITS SELECTOR TEXT.
 *
 * The lift is FOUR parallel selector lists in crm.css, and three of them are
 * spelled identically — `.x-hero > .breadcrumb-nav`. A regex for that string
 * cannot tell which list it found. The first version of this guard did exactly
 * that and was FALSE-GREEN on the defect it exists for: delete a hero from the
 * z-index lift list only, leave it in the other two, and the tool still printed
 * "all lifted above their wave" while the breadcrumb sat back under the chart.
 *
 * So parse crm.css into rules and identify each list by its DECLARATIONS —
 * the lift is the one that sets z-index, the child list the one that restores
 * pointer-events. Then ask whether the hero is in that specific selector list.
 */
function ruleSelectors(css, predicate) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (predicate(m[2])) out.push(m[1]);
  }
  return out;
}

const liftLists = ruleSelectors(crmCss,
  (body) => /z-index:\s*10/.test(body) && /position:\s*relative/.test(body));
const childLists = ruleSelectors(crmCss,
  (body) => /pointer-events:\s*auto/.test(body));
// The third list is what keeps the crumb bar from spanning the whole hero and
// swallowing the wave's tooltip everywhere except on the crumb text. Not the
// click-blocking defect this guard exists for, but the same hand-maintained
// family, and a member missing from it is the same kind of silent omission.
const barLists = ruleSelectors(crmCss,
  (body) => /pointer-events:\s*none/.test(body) && /width:\s*fit-content/.test(body));
// The fourth and last member of the family: the mobile gutter reset. Omitting a
// hero here leaves it with a stale 24px indent on phones rather than a dead
// link, so it is the mildest of the four — but it is the same hand-maintained
// list, and "three of four guarded" is how a family starts drifting again.
const gutterLists = ruleSelectors(crmCss,
  (body) => /padding-left:\s*0/.test(body) && !/z-index/.test(body));

const lifted = (cls) => {
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const base = new RegExp(String.raw`\.${esc}\s*>\s*\.breadcrumb-nav\s*(?:,|$)`, 'm');
  const child = new RegExp(String.raw`\.${esc}\s*>\s*\.breadcrumb-nav\s*>\s*\*\s*(?:,|$)`, 'm');
  return {
    base: liftLists.some((sel) => base.test(sel.trim() + ',')),
    child: childLists.some((sel) => child.test(sel.trim() + ',')),
    bar: barLists.some((sel) => base.test(sel.trim() + ',')),
    gutter: gutterLists.some((sel) => base.test(sel.trim() + ',')),
  };
};

const pagesDir = join(root, 'pages', 'crm');

// ⭐⭐⭐ THE ENUMERATION HAS BEEN TOO NARROW THREE TIMES. IT IS KEYED ON THE
//     PROPERTY NOW, NOT ON HOW THE MARKUP HAPPENS TO BE WRITTEN TODAY.
//
// It started as `<header class="([a-z-]+)"` and each pass found another way for
// real markup to slip past it:
//   · a multi-class attribute      — `class="sqx-hero seqb-hero"`
//   · a <div> instead of <header>  — leads / calendar / properties
//   · and, still latent: any other tag, an attribute before `class`, an extra
//     class on the nav, or the breadcrumb not being the FIRST element child.
//
// That last one matters most: whether a wave covers a breadcrumb has nothing to
// do with their DOM order — both are decided by positioning and stacking — so a
// guard that keys on order is asking a question unrelated to the defect.
//
// So: match ANY element carrying a hero-ish class, then look for a breadcrumb
// anywhere inside a bounded window after it, and do the class filtering in code
// where it can be read.
// The family is the Pulse heroes — every one is named `*-hero` — plus Tasks,
// the single header-named member. A blanket `-header$` was tried and pulled in
// `.crm-header` on settings.html and reassign-queue.html: plain page-title
// wrappers with no overlay of any kind, which need no lift and would have been
// reported as defects forever. Anything genuinely new will be `*-hero` and be
// caught; a future header-named hero must be added here, which is a deliberate
// one-line edit rather than a silent omission.
const HEADER_NAMED_MEMBERS = new Set(['rlx-header']);
const HERO_CLASS = (cls) => /hero/i.test(cls) || HEADER_NAMED_MEMBERS.has(cls);

// Bounded because a regex cannot match a closing tag by nesting, so the window
// is the stand-in for "inside this element".
//
// MEASURED rather than guessed: across all 12 heroes the breadcrumb sits 9–13
// characters after the opening tag, and the worst realistic case — a wave div
// declared before the crumb — is under 50. 400 leaves an order of magnitude of
// headroom while staying far short of unrelated markup. It matters that this is
// not larger because the window is what stands in for containment: a hero with
// no breadcrumb of its own — pages/crm/dashboard.html has one, `.pulse-hero` —
// must not reach a LATER element's crumb and be reported as an unlifted hero
// that does not exist. (That page happens to contain no breadcrumb at all, so
// it is not itself at risk; the next such hero on a page that does would be.)
const WINDOW = 400;

const headers = [];
for (const f of readdirSync(pagesDir).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(pagesDir, f), 'utf8');
  const open = /<([a-z][\w-]*)\b([^>]*)>/g;
  let m;
  while ((m = open.exec(html))) {
    const attrs = m[2];
    // Both quote styles: `class='cmp-hero'` would otherwise drop the hero, and
    // the floor only catches that while the count happens to fall — a NEW hero
    // written with single quotes keeps the count at 12 and passes silently.
    // Quoted either way, or not at all. The single-quote gap was closed one
    // round ago and the unquoted one was left — the same shape, one round later.
    const cm = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/);
    if (!cm) continue;
    // ?? not ||: `class=""` is a legitimate empty match that || would skip past.
    const classes = (cm[1] ?? cm[2] ?? cm[3]).trim().split(/\s+/);
    if (!classes.some(HERO_CLASS)) continue;
    const win = html.slice(m.index + m[0].length, m.index + m[0].length + WINDOW);
    // the nav may carry extra classes, so match the token, not the whole value
    if (!/<nav\b[^>]*\bclass\s*=\s*["']?[^"'>]*\bbreadcrumb-nav\b/.test(win)) continue;
    headers.push({ file: f, tag: m[1], classes });
  }
}

if (headers.length < KNOWN_HEROES) {
  console.error(
    `FAIL: found ${headers.length} heroes with a breadcrumb, expected at least ${KNOWN_HEROES}.\n` +
    `      Either one was removed, or this scan no longer matches how they are\n` +
    `      written — a guard that matches nothing passes for free.`);
  process.exit(1);
}

let bad = 0;
for (const { file, tag, classes } of headers) {
  const results = classes.map(lifted);
  const base = results.some((r) => r.base);
  const child = results.some((r) => r.child);
  const bar = results.some((r) => r.bar);
  const gutter = results.some((r) => r.gutter);
  if (base && child && bar && gutter) continue;
  bad++;
  const missing = [!base && 'the z-index lift list',
                   !child && 'the > * pointer-events list',
                   !bar && 'the pointer-events:none crumb-bar list',
                   !gutter && 'the mobile padding-left:0 list'].filter(Boolean).join(' and ');
  console.error(
    `FAIL: <${tag} class="${classes.join(' ')}"> in ${file} is missing from ${missing} in css/crm.css`);
}

if (bad) {
  console.error(
    `\n${bad} of ${headers.length} heroes sit under their own wave. The breadcrumb link is\n` +
    `unclickable on any tenant with enough data for the wave to render.`);
  process.exit(1);
}

console.log(`OK: ${headers.length} heroes with a breadcrumb, all lifted above their wave.`);
