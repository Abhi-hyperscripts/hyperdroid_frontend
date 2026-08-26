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
/**
 * The import help text is the ONLY thing telling a user what the fixed-column CSV expects, and the parser
 * is the only thing that reads it. They drifted the moment lead_time_days was appended at index 11 and the
 * help text still listed eleven columns — a capability nobody could reach, with no error to notice.
 */
function checkCsvColumnsMatchTheHelpText() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'accounts', 'inventory.html'), 'utf8');
  const doc = /<code>(sku, name, sale_price[^<]*)<\/code>/.exec(html);
  if (!doc) { console.log('\n── CSV columns\n   ⚠ help text not found — this check is watching nothing'); return; }
  const documented = doc[1].split(',').map(s => s.trim());
  const body = src.slice(src.indexOf('sku: c[0]'), src.indexOf("item_type: 'goods'"));
  const highest = Math.max(...[...body.matchAll(/c\[(\d+)\]/g)].map(m => +m[1]));
  const ok = documented.length === highest + 1;
  console.log(`\n── CSV columns\n   help text lists ${documented.length}, parser reads ${highest + 1}  ->  ${ok ? 'match' : '⚠ OUT OF SYNC'}`);
}

(async () => {
  checkCsvColumnsMatchTheHelpText();
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
  // 3. ⭐ A SUB-ASSEMBLY IN STOCK WHOSE OWN COMPONENTS ARE SHORT.
  // The parent needs nothing (ready 0) but its child still reports a lead, so a CHILD's ready exceeds its
  // PARENT's — and the finished row's lead is computed as totalDays MINUS the max over ALL flattened rows.
  // If that max comes from the deep child, the finished bar gets a NEGATIVE length.
  await run('in-stock parent over a short child', {
    name: 'Top', sku: 'T', build_qty: 1, total_lead_days: 2, max_depth: 2,
    tree: [{ item_id: 'sub', sku: 'SUB', name: 'Sub In Stock', required_qty: 1, qty_on_hand: 99, lead_time_days: 1, available_after_days: 0, is_assembly: true,
      components: [{ item_id: 'raw', sku: 'RAW', name: 'Short Raw', required_qty: 1, qty_on_hand: 0, lead_time_days: 30, available_after_days: 30, is_assembly: false, components: [] }] }]
  });

  // 4. a single very long lead time — bar must stay inside its track
  await run('one 365-day lead', {
    name: 'Slow', sku: 'S', build_qty: 1, total_lead_days: 365, max_depth: 1,
    tree: [{ item_id: 'x', sku: 'X', name: 'Slow Part', required_qty: 1, qty_on_hand: 0, lead_time_days: 365, available_after_days: 365, is_assembly: false, components: [] }]
  });

  // ───────────────────────── MRP NETTING ─────────────────────────
  let failures = 0;
  const expect = (name, cond, detail) => {
    if (!cond) { failures++; console.log(`   ✗ ${name} — ${detail}`); } else console.log(`   ✓ ${name}`);
  };

  // 5. ⭐ PARTIAL sub-assembly stock. 6 of the 10 gearboxes exist, so 4 must be built and only those 4
  // pull gears (4 × 4 = 16). The plan must show the NET quantities, not the gross explosion — quoting 10
  // gearboxes and 40 gears is exactly the over-ordering this netting exists to stop. And it must still
  // DESCEND: a "skip the subtree if any stock exists" shortcut would drop the gears entirely.
  const t5 = await run('partial sub-assembly stock nets proportionally', {
    name: 'Machine', sku: 'M', build_qty: 10, total_lead_days: 9, max_depth: 2, net_material_cost: 80, total_cost: 200,
    tree: [{ item_id: 'box', sku: 'BOX', name: 'Gearbox', required_qty: 10, net_required_qty: 4, qty_on_hand: 6,
             lead_time_days: 2, available_after_days: 9, is_assembly: true,
      components: [{ item_id: 'gear', sku: 'GEAR', name: 'Gear', required_qty: 40, net_required_qty: 16, qty_on_hand: 0,
                     lead_time_days: 7, available_after_days: 7, is_assembly: false, components: [] }] }]
  });
  // NOTE: this first one does NOT discriminate net from gross-minus-on-hand — at the TOP level they are
  // the same number by construction (nothing above it to net against). Verified by planting: it stays green
  // when netting is removed. The gear assertion below is the one that carries this case; keep it that way.
  expect('builds the NET 4 gearboxes, not the gross 10', /BUILD 4 × Gearbox/.test(t5), t5.slice(0, 200));
  expect('buys the NET 16 gears, not the gross 40', /BUY 16 × Gear\b/.test(t5), t5.slice(0, 200));
  expect('still descends into a partially-stocked assembly', /Gear\b/.test(t5), 'gears vanished from the plan');

  // 6. A FULLY stocked sub-assembly absorbs its whole subtree: nothing beneath it is ordered.
  const t6 = await run('fully stocked sub-assembly absorbs its subtree', {
    name: 'Machine', sku: 'M', build_qty: 10, total_lead_days: 3, max_depth: 2, net_material_cost: 0, total_cost: 200,
    tree: [{ item_id: 'box', sku: 'BOX', name: 'Gearbox', required_qty: 10, net_required_qty: 0, qty_on_hand: 10,
             lead_time_days: 2, available_after_days: 0, is_assembly: true,
      components: [{ item_id: 'gear', sku: 'GEAR', name: 'Gear', required_qty: 40, net_required_qty: 0, qty_on_hand: 0,
                     lead_time_days: 30, available_after_days: 30, is_assembly: false, components: [] }] }]
  });
  expect('no gear is ordered under an in-stock gearbox', !/BUY .* Gear\b/.test(t6), t6.slice(0, 200));

  // 7. ⚠️ VERSION SKEW — the same payload with net_required_qty STRIPPED, as an older API returns it.
  // Pages deploy in ~1 min and the backend in ~5, so this response shape is live during every release.
  // `Number(undefined || 0)` is 0, which without a fallback reads as "nothing to obtain" and renders a
  // plan with NO WORK IN IT — a confident, wrong, silent answer. The fallback must keep the old behaviour.
  const strip = ns => ns.map(n => { const { net_required_qty, ...rest } = n; return { ...rest, components: strip(n.components || []) }; });
  const t7 = await run('SKEW: old API response with no net_required_qty', {
    name: 'Machine', sku: 'M', build_qty: 10, total_lead_days: 9, max_depth: 2,
    tree: strip([{ item_id: 'box', sku: 'BOX', name: 'Gearbox', required_qty: 10, net_required_qty: 10, qty_on_hand: 0,
             lead_time_days: 2, available_after_days: 9, is_assembly: true,
      components: [{ item_id: 'gear', sku: 'GEAR', name: 'Gear', required_qty: 40, net_required_qty: 40, qty_on_hand: 0,
                     lead_time_days: 7, available_after_days: 7, is_assembly: false, components: [] }] }])
  });
  expect('falls back to gross netting instead of showing an empty plan', /BUY 40 × Gear\b/.test(t7), t7.slice(0, 200));
  expect('and still builds the gearbox', /BUILD 10 × Gearbox/.test(t7), t7.slice(0, 200));

  // 8. ⭐⭐ SKEW + a component in TWO branches. This is the case that caught a real defect in the fallback
  // itself: netting PER NODE and summing re-commits the double-count the backend allocation prevents —
  // 10 wanted by each of two branches with 10 on hand came out 0, i.e. "order nothing", silently.
  // The pre-netting code netted ONCE on the merged row, and the fallback must reproduce that exactly.
  const t8 = await run('SKEW: shared component across two branches nets once, not per branch', {
    name: 'Machine', sku: 'M', build_qty: 1, total_lead_days: 9, max_depth: 2,
    tree: strip([
      { item_id: 'l', sku: 'L', name: 'Left', required_qty: 1, net_required_qty: 1, qty_on_hand: 0, lead_time_days: 2, available_after_days: 9, is_assembly: true,
        components: [{ item_id: 'sh', sku: 'SH', name: 'Shared', required_qty: 10, net_required_qty: 0, qty_on_hand: 10, lead_time_days: 7, available_after_days: 7, is_assembly: false, components: [] }] },
      { item_id: 'r', sku: 'R', name: 'Right', required_qty: 1, net_required_qty: 1, qty_on_hand: 0, lead_time_days: 2, available_after_days: 9, is_assembly: true,
        components: [{ item_id: 'sh', sku: 'SH', name: 'Shared', required_qty: 10, net_required_qty: 10, qty_on_hand: 10, lead_time_days: 7, available_after_days: 7, is_assembly: false, components: [] }] }
    ])
  });
  expect('shared component orders the 10 it is genuinely short, not 0',
         /BUY 10 × Shared/.test(t8), t8.slice(0, 240));

  // 9. The same shape WITH netting present — the backend already allocated, so the page must simply add
  // the per-node figures up (0 + 10) and must NOT re-net against on-hand a second time.
  const t9 = await run('shared component across two branches, netting present', {
    name: 'Machine', sku: 'M', build_qty: 1, total_lead_days: 9, max_depth: 2, net_material_cost: 20,
    tree: [
      { item_id: 'l', sku: 'L', name: 'Left', required_qty: 1, net_required_qty: 1, qty_on_hand: 0, lead_time_days: 2, available_after_days: 9, is_assembly: true,
        components: [{ item_id: 'sh', sku: 'SH', name: 'Shared', required_qty: 10, net_required_qty: 0, qty_on_hand: 10, lead_time_days: 7, available_after_days: 7, is_assembly: false, components: [] }] },
      { item_id: 'r', sku: 'R', name: 'Right', required_qty: 1, net_required_qty: 1, qty_on_hand: 0, lead_time_days: 2, available_after_days: 9, is_assembly: true,
        components: [{ item_id: 'sh', sku: 'SH', name: 'Shared', required_qty: 10, net_required_qty: 10, qty_on_hand: 10, lead_time_days: 7, available_after_days: 7, is_assembly: false, components: [] }] }
    ]
  });
  expect('allocated per-branch figures are summed, not re-netted', /BUY 10 × Shared/.test(t9), t9.slice(0, 240));

  console.log(failures ? `\n✗ ${failures} assertion(s) FAILED` : '\n✓ all netting assertions passed');
  process.exit(failures ? 1 : 0);
})();
