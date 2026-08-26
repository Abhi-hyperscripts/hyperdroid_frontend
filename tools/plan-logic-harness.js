/**
 * BUILD-PLAN LOGIC HARNESS —  run with:  node tools/plan-logic-harness.js
 *
 * WHY THIS EXISTS. This repo has no test runner and no CI, so ~90 lines of arithmetic shipped having only
 * ever been syntax-checked. Executing it ONCE against three crafted payloads found three real defects that
 * reading the same code twice had missed:
 *
 *   1. `total` was clamped to Math.max(1, …) for the bar geometry and then reused for the message, so the
 *      "everything is in stock" branch was DEAD CODE — a fully stocked plan announced "Ready in 1 day".
 *   2. Date labels carried no year. Lead times run to 365 days, so a plan could land on the same
 *      day-and-month it started: "Ready in 365 days · Sep 01" read as though it were ready today.
 *   3. The 2% minimum bar width, applied to a bar starting at 100%, produced 102% and overflowed its track.
 *
 * It EXTRACTS the real planBom from inventory.js rather than reimplementing it — a copy would drift and
 * then prove nothing. Add a case whenever the plan learns a new rule; the assertions worth having are the
 * ones about geometry (a bar must stay inside its track) and about aggregation (a component appearing in
 * two branches must appear ONCE, at the LATER date).
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
// Resolve from THIS file, not the shell's cwd — the first version only worked from one directory.
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'accounts', 'inventory.js'), 'utf8');

// Pull the REAL planBom out of the file rather than reimplementing it — a copy would drift.
const start = src.indexOf('async function planBom()');
const end = src.indexOf('async function explodeBom()');
if (start < 0 || end < 0) { console.log('could not locate planBom'); process.exit(1); }
const fn = src.slice(start, end);

let captured = '';
function makeCtx(payload) {
  const el = { value: '2026-09-01', style: {}, set innerHTML(v) { captured = v; }, get innerHTML() { return captured; } };
  return vm.createContext({
    document: { getElementById: id => (id === 'bomItemId' ? { value: 'item-1' } : id === 'buildQty' ? { value: '10' } : id === 'buildDate' ? { value: '2026-09-01' } : el) },
    api: { request: async () => payload },
    AccountsCommon: { buildUrl: (p, q) => p },
    Toast: { error: m => console.log('  TOAST:', m) },
    esc: s => String(s ?? ''), num: n => String(n), fmtMoney: n => '₹' + n,
    console
  });
}
async function run(name, payload) {
  captured = '';
  const ctx = makeCtx(payload);
  vm.runInContext(fn + '\n; globalThis.__run = planBom;', ctx);
  await ctx.__run();
  const text = captured.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`\n── ${name}`);
  console.log('   ' + text.slice(0, 260));
  const bars = (captured.match(/left:([\d.]+)%;width:([\d.]+)%/g) || []);
  const bad = bars.filter(b => { const m = /left:([\d.]+)%;width:([\d.]+)%/.exec(b); return +m[1] + +m[2] > 100.5 || +m[1] < 0; });
  if (bad.length) console.log('   ⚠ BAR OVERFLOWS ITS TRACK:', bad.slice(0,3).join(' '));
  return text;
}
(async () => {
  // 1. everything in stock, nothing to wait for
  await run('all in stock (total_lead_days = 0)', {
    name: 'Widget', sku: 'W', build_qty: 10, total_lead_days: 0, max_depth: 1,
    tree: [{ item_id: 'a', sku: 'A', name: 'Part A', required_qty: 10, qty_on_hand: 50, lead_time_days: 7, available_after_days: 0, is_assembly: false, components: [] }]
  });
  // 2. a shared component in two branches at different times
  await run('shared component across branches', {
    name: 'Hamper', sku: 'H', build_qty: 10, total_lead_days: 12, max_depth: 2,
    tree: [
      { item_id: 's1', sku: 'S1', name: 'Sub One', required_qty: 10, qty_on_hand: 0, lead_time_days: 2, available_after_days: 9, is_assembly: true,
        components: [{ item_id: 'box', sku: 'BOX', name: 'Gift Box', required_qty: 10, qty_on_hand: 0, lead_time_days: 7, available_after_days: 7, is_assembly: false, components: [] }] },
      { item_id: 's2', sku: 'S2', name: 'Sub Two', required_qty: 10, qty_on_hand: 0, lead_time_days: 5, available_after_days: 6, is_assembly: true,
        components: [{ item_id: 'box', sku: 'BOX', name: 'Gift Box', required_qty: 10, qty_on_hand: 0, lead_time_days: 1, available_after_days: 1, is_assembly: false, components: [] }] }
    ]
  });
  // 3. a single very long lead time — bar must stay inside its track
  await run('one 365-day lead', {
    name: 'Slow', sku: 'S', build_qty: 1, total_lead_days: 365, max_depth: 1,
    tree: [{ item_id: 'x', sku: 'X', name: 'Slow Part', required_qty: 1, qty_on_hand: 0, lead_time_days: 365, available_after_days: 365, is_assembly: false, components: [] }]
  });
})();
