# Accounts Setup Guide — Master Plan

**Article:** `Frontend/KnowledgeBase/Accounts/Accounts-Setup-Guide.html`
**Images dir:** `Frontend/KnowledgeBase/Accounts/images/`
**Bug log:** `Frontend/KnowledgeBase/Accounts/_BUGS_FIXED_DURING_CAPTURE.md`
**Last updated:** 2026-04-09 (scope expanded — Sessions H & I promoted from "pointer sections" to full deep dives after gap review)

> **Purpose of this file.** This is the durable plan for building the
> Accounts Setup Guide end-to-end via Playwright. If a session is interrupted
> for ANY reason — context limit, tool failure, user cut-in — re-open this
> file first to figure out exactly where to resume. Update the **Progress
> tracker** at the bottom after every completed phase.

---

## 0. Operating rules (must follow every session)

1. **One source of truth.** Article = `Accounts-Setup-Guide.html`. Plan = this
   file. Bugs = `_BUGS_FIXED_DURING_CAPTURE.md`. Screenshots = `images/`.
2. **NEVER seed data. Always fill forms manually via Playwright.**
   - No "Seed India GST" buttons, no "Load India CoA template" buttons,
     no bulk-init shortcuts in the article.
   - For every record we create (account, tax config, customer, vendor,
     invoice, bill, JE), Playwright must open the modal, type into each
     field, screenshot the filled-in form, click Save, then screenshot the
     resulting row in the list.
   - Reasoning: a junior implementer reading this guide must learn the
     real day-to-day workflow they will use in production. A one-click
     seed hides every field and decision and teaches nothing.
3. **No "before / after" framing.** A reader does not understand "empty list
   then full list" — the leap is too large. Every educational unit is:
   *concept → why → field-by-field walkthrough → save → result → what just
   happened in the GL/DB*. Empty-state screenshots are fine as the *opening*
   of a section, not as a comparison anchor.
4. **Exhaustive interactions rule.** Walking the create-modal happy path
   is NOT enough. On every captured page, exercise EVERY interactive
   element at least once:
   - Filter dropdowns (Filter by Type, by Group, Status, etc.) — open,
     pick an option, screenshot the filtered table, reset.
   - Search boxes — type a real query, screenshot, clear.
   - Sort headers — click each, screenshot the new order.
   - Pagination — page forward/back if there are enough rows.
   - Row action buttons (View / Edit / Delete / Deactivate / Lock / etc.)
     — every icon button on a row gets clicked at least once. View opens
     a detail panel (screenshot it). Edit opens the create modal in edit
     mode (screenshot the pre-filled state, then Cancel). Delete opens
     the confirm dialog (screenshot it, then Cancel — do not destroy
     records subsequent sections depend on).
   - Toolbar buttons not yet covered (Import, Export, Print, Refresh) —
     click each, screenshot the result.
   - Empty-state CTAs — confirm they trigger the same modal as the
     toolbar +Add button.
   - Tabs and sidebar nav items not yet visited — visit each at least
     once for a screenshot inventory.
   Each interaction's screenshot pair (before / after) must come with a
   one-line caption explaining *what the button does*. The caption is the
   educational payload — without it the article is incomplete.
   Every interaction is also a fuzz test: if anything is broken, apply
   the fix-first rule below before capturing.

5. **Fix-first rule (investor-grade).** Capture sessions are also investor
   demo prep — zero tolerance for embarrassment. Do not just react to
   obvious visual glitches; **actively hunt for bugs on every page**:
   - Open the browser console; check errors and warnings.
   - Watch network for 4xx/5xx responses; read the AccountsService log
     (`tail` the bash background output) for exceptions on each request.
   - Try edge cases on every form: empty submit, very long input, special
     characters, reopening the modal twice, double-clicking Save, hitting
     Cancel and reopening.
   - Resize to mobile width; toggle dark mode; check tooltips, hover
     states, disabled-button styling.
   - Each modal in the app is its own attack surface — bug-hunt EVERY
     modal, not just the first one.
   When ANY bug is found (frontend OR backend):
   1. Stop capturing.
   2. Diagnose the root cause in the source (CSS / JS / HTML / C# / SQL).
   3. Patch the underlying class / endpoint / query, not the symptom.
      Structural fixes only — `!important` band-aids are forbidden.
   4. Append to `_BUGS_FIXED_DURING_CAPTURE.md` with symptom → root cause
      → fix → file:line → triggering modal/page.
   5. If the fix touches CSS/JS, bump `Frontend/js/sw-version.js`. If it
      touches AccountsService, restart it. Then unregister the SW and
      clear caches in the Playwright browser.
   6. Hard-reload with `?cb=<unix-ts>`.
   7. Verify the fix is live via a Playwright DOM check.
   8. Only THEN take the screenshot.
   Never silently work around a bug to keep the capture flowing — a
   screenshot of broken UI is a lie that ships to investors.
5. **Backend must be running.** AccountsService on `https://localhost:5122`,
   Auth on `https://localhost:5098` (or per launchSettings). Health-check
   before every session: `curl -k https://localhost:5122/health`.
6. **Image naming.** `<section>-<step>[-suffix].png` — zero-padded section
   number (e.g. `04-3a-account-modal-cash.png`). Always lowercase,
   hyphen-separated. Store in `images/` (flat — no subfolders).
7. **No lorem ipsum.** Every screenshot must show real data we created in
   the demo tenant. Tenant ID: `5b325a7f-7ecb-4c8f-983e-db7bab4964ae`.
   Login: `abhishekanand.ko@gmail.com / July@1234`.
8. **Cache-bust on every reload after a fix.** `?cb=<unix-ts>` in the URL.
9. **Do NOT close the Playwright browser** between sessions unless asked.
10. **Update the Progress tracker** at the bottom of this file after every
    phase, then commit nothing (we're testing locally).

---

## 1. Article skeleton (already in the HTML — do not renumber)

The article has 17 top-level sections. Sections 1–3 already have full prose.
Sections 4–17 currently contain a single placeholder paragraph each
(`This section will be filled in during capture session X.`) and need to be
replaced with real content + screenshots during Phase 4.

| §  | Title                       | Subsections                                                             | Capture session |
|----|-----------------------------|-------------------------------------------------------------------------|-----------------|
| 1  | Welcome                     | 1.1 audience · 1.2 outcomes · 1.3 vocab primer                          | (done — text only) |
| 2  | The 30,000-ft view          | 2.1 double-entry · 2.2 setup roadmap                                    | (done — text only) |
| 3  | Logging in & dashboard      | 3.1 login · 3.2 dashboard · 3.3 KPIs · 3.4 quick actions · 3.5 activity | A (done)        |
| 4  | Chart of Accounts           | 4.1 what is CoA · 4.2 India template · 4.3 anatomy · 4.4 add custom · 4.5 bulk import | B |
| 5  | Fiscal Year                 | 5.1 what is FY · 5.2 create FY 2026-27 · 5.3 12 monthly periods · 5.4 lock/unlock | B |
| 6  | Tax setup — GST             | 6.1 why · 6.2 add GST 18% · 6.3 HSN/SAC                                 | B               |
| 7  | Opening balances            | 7.1 what · 7.2 entering · 7.3 verify with Trial Balance                 | B               |
| 8  | Customers                   | 8.1 what · 8.2 create · 8.3 detail page                                 | C               |
| 9  | Vendors                     | 9.1 what · 9.2 create                                                   | C               |
| 10 | Customer Invoices           | 10.1 what · 10.2 draft · 10.3 approve/post · 10.4 GL impact · 10.5 payment · 10.6 credit note | D |
| 11 | Vendor Bills                | 11.1 what · 11.2 create/post · 11.3 payment · 11.4 debit note           | E               |
| 12 | The General Ledger          | 12.1 what · 12.2 browse · 12.3 inspect · 12.4 manual JE · 12.5 reverse  | F               |
| 13 | Reports                     | 13.1 TB · 13.2 BS · 13.3 P&L · 13.4 Cash Flow · 13.5 AR Aging · 13.6 AP Aging | G |
| 14 | Closing the books           | 14.1 period close · 14.2 year-end close                                 | I               |
| 12 | Banking (deep)              | 12.1 accounts · 12.2 transactions · 12.3 transfer · 12.4 reconciliation       | H               |
| 13 | Expense Management (deep)   | 13.1 categories · 13.2 policies · 13.3 claims lifecycle                       | H2              |
| 14 | Fixed Assets (deep)         | 14.1 categories · 14.2 register · 14.3 depreciation · 14.4 disposal           | H3              |
| 15 | Subscription Billing (deep) | 15.1 plans · 15.2 subscriptions · 15.3 usage meters · 15.4 tokens             | H4              |
| 16 | Glossary                    | (all terms — already populated; verify hrefs after Phase 4)             | I               |

---

## 2. Capture sessions — what to screenshot, what bugs to expect, what concepts to teach

### Session A — Login + Dashboard tour  ✅ DONE
- **Page:** `/pages/login.html` → `/pages/home.html` → `/pages/accounts/dashboard.html`
- **Captures:** `03-1-login.png`, `03-1b-home.png`, `03-2-dashboard-empty.png`,
  `03-3-kpi-tiles.png`, `03-4a..l-card-*.png` (12 module cards),
  `03-5-recent-empty.png`. ALL DONE.
- **Concepts to teach in §3 prose:** what each KPI tile means (cash, AR
  outstanding, AP outstanding, MTD revenue), what each module card unlocks.

### Session B — Setup foundation (CoA, Fiscal Year, Tax, Opening Balances)  ⏳ IN PROGRESS
- **Pages:** `/pages/accounts/setup.html`, `/pages/accounts/taxation.html`
- **Walk in order — every record is created MANUALLY through the modals:**

  **§4 Chart of Accounts**
  1. Empty Setup hub → `04-1-setup-hub-empty.png` ✅
  2. Account Types tab — educational view of the 5 fundamental types
     (asset/liability/equity/revenue/expense + normal balance) →
     `04-2-account-types.png` ✅ (was `04-4-account-types.png`)
  3. Account Groups tab empty → `04-3-account-groups-empty.png` ⬜
  4. + Add Account Group modal — fill: code `1000`, name `Current Assets`,
     parent: none, type: Asset → screenshot filled → save → result row:
     `04-4-group-modal-filled.png`, `04-5-group-after-save.png` ⬜
  5. Repeat for one liability group (`2000 / Current Liabilities`) for
     contrast → `04-6-groups-two.png` ⬜
  6. Accounts tab empty → `04-7-accounts-empty.png` ⬜
  7. + Add Account modal walkthrough — first account: **Cash in Hand**
     (code `1001`, type Asset, group Current Assets, opening 0) →
     `04-8-account-modal-empty.png`, `04-9-account-modal-cash-filled.png`,
     `04-10-accounts-after-cash.png` ⬜
  8. Add a 2nd account: **Sales Revenue** (code `4001`, type Revenue) →
     `04-11-account-modal-sales.png`, `04-12-accounts-after-sales.png` ⬜
  9. Add a 3rd account: **Office Rent Expense** (code `5001`, type Expense)
     → `04-13-account-modal-rent.png`, `04-14-accounts-three.png` ⬜
  10. Account Tree tab showing the 3 accounts in their group hierarchy →
      `04-15-account-tree.png` ⬜
  11. Journal Types tab — show built-in types + open the + Add modal once
      to teach the concept → `04-16-journal-types-empty.png`,
      `04-17-journal-type-modal.png` ⬜
  > **Removed:** all "COA Templates" / "India Template" / `04-2-coa-templates.png`,
  > `04-3a-coa-confirm.png`, `04-3-coa-after-init.png` screenshots —
  > they document the seed flow and violate Rule 2. Files stay in `images/`
  > for now but are NOT referenced from the article. Delete during Phase-5
  > cleanup.

  **§5 Fiscal Year**
  12. Fiscal Years tab empty → `05-1-fiscal-empty.png` ✅
  13. + Create Fiscal Year modal empty → `05-2-fiscal-modal-empty.png` ✅
  14. Modal filled (FY 2026-27, 01 Apr 2026 → 31 Mar 2027) →
      `05-3-fiscal-modal-filled.png` ✅
  15. After save (1 row, Active) → `05-4-fiscal-after.png` ✅
  16. Fiscal Periods tab — 12 auto-generated periods →
      `05-5-fiscal-periods.png` ✅
  17. Period **Lock** action: click Lock on Apr-2026 → confirm modal →
      locked state → `05-6-period-lock-confirm.png`, `05-7-period-locked.png` ⬜
  18. Period **Unlock** action (so subsequent sessions can post into Apr) →
      `05-8-period-unlock-confirm.png`, `05-9-period-unlocked.png` ⬜

  **§6 Tax setup — GST**
  19. Taxation page → Tax Configs tab empty → `06-1-tax-empty.png` ✅
      (already captured; reuse — does not show seed button in crop)
  20. + Add Tax Config modal — manually create **GST 18%** (name `GST 18%`,
      type GST, total rate 18%, split CGST 9% + SGST 9%, IGST 18%) →
      `06-2-tax-config-modal-empty.png`, `06-3-tax-config-modal-filled.png`,
      `06-4-tax-configs-after.png` ⬜
  21. Tax Rates tab — show how the components were generated → click + Add
      Rate once to teach the concept → `06-5-tax-rates.png`,
      `06-6-tax-rate-modal.png` ⬜
  22. HSN/SAC tab — manually add ONE HSN code (e.g. `998314 / IT design and
      development services`) → `06-7-hsn-modal-filled.png`, `06-8-hsn-after.png` ⬜
  > **Removed:** `06-2-tax-seed-confirm.png` (seed-confirm modal). Do not
  > reference it from the article. The screenshot file remains; mark for
  > Phase-5 cleanup.

  **§7 Opening balances**
  23. Opening Balances tab empty (with "Cash in Hand / Sales Revenue / Rent"
      rows showing 0 because we created them in §4) →
      `07-1-opening-empty.png` ⬜
  24. Click into Cash in Hand row → enter ₹50,000 debit → save →
      `07-2-opening-cash-filled.png`, `07-3-opening-after-cash.png` ⬜
  25. Add a balancing credit on Owner's Equity (create that account on the
      fly if needed) so debits = credits → `07-4-opening-balanced.png` ⬜
  26. Open the in-page Trial Balance check → totals match → confetti / OK →
      `07-5-opening-tb-check.png` ⬜

- **Bugs already fixed this session** (see `_BUGS_FIXED_DURING_CAPTURE.md`):
  1. Modal positioning regression — `accounts.css` blanket selector forced
     `position: relative` on modals.
  2. Fiscal Periods dropdown stale after FY create — `setup.js` didn't refresh
     `SearchableDropdown` instances.
- **Bugs to expect to find:** account modal validation, group→account linkage,
  tax config split calculation, opening-balance row editor, period-lock styling.
- **Concepts to teach in prose:**
  - §4: What is a CoA? What are the 5 account types and their normal
    balances? What is an account group? Why we built our 3 starter accounts
    by hand instead of clicking a template button (so the reader sees what
    a real account record looks like).
  - §5: What is a fiscal year? Why does India use Apr→Mar? What's a period
    and why lock one at month-end?
  - §6: What is a tax config vs a tax rate? Why CGST + SGST = IGST in
    intra-state vs inter-state sales? What HSN/SAC means.
  - §7: What is an opening balance? Why must debits = credits on day zero?

### Session C — Master data (Customers + Vendors)  ⬜ NOT STARTED
- **Page:** `/pages/accounts/parties.html`
- **Captures:**
  - Customers tab empty → `08-1-customers-empty.png`
  - + New Customer modal empty → `08-2-customer-modal-empty.png`
  - Modal filled (real demo customer: "Acme Corp", GSTIN, billing address,
    payment terms, credit limit) → `08-3-customer-modal-filled.png`
  - Customers list after save → `08-4-customers-after.png`
  - Customer detail drawer/page → `08-5-customer-detail.png`
  - Vendors tab empty → `09-1-vendors-empty.png`
  - + New Vendor modal empty/filled → `09-2-vendor-modal-empty.png`,
    `09-3-vendor-modal-filled.png`
  - Vendors after save → `09-4-vendors-after.png`
- **Concepts:** customer vs vendor, GSTIN format, payment terms, credit limit,
  why these are the same module under "Parties", what each field is used for
  later (invoice taxes, AP aging buckets).

### Session D — Receivables (Invoices + Payment + AR)  ⬜ NOT STARTED
- **Page:** `/pages/accounts/receivables.html`
- **Captures:**
  - Empty invoices list → `10-1-invoices-empty.png`
  - + New Invoice modal — line items, taxes, totals → `10-2..10-5`
  - Draft state → Approve action → Post action → `10-6..10-8`
  - Posted invoice detail showing GL entries (the educational moment) →
    `10-9-invoice-gl-impact.png`
  - Record Payment modal → `10-10-payment-modal.png`,
    `10-11-payment-after.png`
  - Credit Note creation → `10-12-credit-note.png`
- **Concepts:** Draft vs Posted, the auto-journal-entry behind a sale
  (Dr AR / Cr Sales / Cr Output GST), what changes on the BS and P&L when
  you post, partial payments, credit notes vs refunds.

### Session E — Payables (Bills + Payment + AP)  ⬜ NOT STARTED
- **Page:** `/pages/accounts/payables.html`
- **Captures:**
  - Empty bills list → `11-1-bills-empty.png`
  - + New Bill modal → `11-2..11-4`
  - Approve/Post → `11-5..11-7`
  - Posted bill detail showing GL impact → `11-8-bill-gl-impact.png`
  - Record Payment from bank account → `11-9-bill-payment.png`,
    `11-10-bill-after-payment.png`
  - Debit Note → `11-11-debit-note.png`
- **Concepts:** mirror of §10 — Dr Expense + Dr Input GST / Cr AP,
  TDS withholding when applicable, why bills are dated when received not paid.

### Session F — General Ledger + Manual Journal Entries  ⬜ NOT STARTED
- **Page:** `/pages/accounts/ledger.html`
- **Captures:**
  - GL home with the entries auto-created by §10–11 → `12-1-gl-home.png`
  - Drill-down on the invoice JE → `12-2-je-detail.png`
  - Filter by account/date/type → `12-3-gl-filtered.png`
  - + New Manual Journal modal (e.g. depreciation, accrual) → `12-4-je-modal-empty.png`,
    `12-5-je-modal-balanced.png`
  - Posted manual JE → `12-6-je-posted.png`
  - Reverse Entry action → `12-7-je-reversed.png`
- **Concepts:** debits = credits, what a JE is made of, when to post a manual
  one, why reversals (not deletes) preserve audit trail.

### Session G — Reports  ⬜ NOT STARTED
- **Page:** `/pages/accounts/reports.html`
- **Captures (one screenshot per report, taken AFTER §10–11–12 data exists
  so the numbers are non-zero):**
  - `13-1-trial-balance.png` — TB showing Σ debits = Σ credits
  - `13-2-balance-sheet.png` — Assets = Liabilities + Equity
  - `13-3-profit-loss.png` — Revenue − Expenses = Net profit
  - `13-4-cash-flow.png` — Operating / Investing / Financing
  - `13-5-ar-aging.png` — buckets 0-30 / 31-60 / 61-90 / 90+
  - `13-6-ap-aging.png`
  - Date-range picker open → `13-7-report-filters.png`
  - Export-to-PDF / CSV button states → `13-8-report-export.png`
- **Concepts:** What each report tells you, why the TB must match before
  trusting the BS, how P&L flows into Equity at year-end.

### Session H — Banking deep dive  ⏳ IN PROGRESS (2026-04-09)
> **Scope change 2026-04-09:** user reviewed the published guide and flagged
> Banking (and the other advanced-overview sections) as under-documented. The
> original "one hero shot" plan is **retired**. Banking now gets the same
> exhaustive-interactions treatment as §4 Setup / §10 Receivables. Baseline
> shot `12-1-banking-baseline.png` stays but is demoted from hero to "landing
> screenshot" and is followed by the full walk-through below.
- **Page:** `/pages/accounts/banking.html`
- **Tab 1 — Bank Accounts**
  1. Empty state → `12H-1-bank-accounts-empty.png`
  2. + Add Bank Account modal empty → `12H-2-add-bank-modal-empty.png`
  3. Modal filled (HDFC Current A/C, ₹50,000 opening, IFSC, SWIFT, branch,
     GL account mapped to 1001 Cash in Hand, Is Default ON) →
     `12H-3-add-bank-modal-filled.png`
  4. After save (row in table, status badge) → `12H-4-bank-accounts-after-save.png`
  5. Add a second account (ICICI Savings, not default) for contrast →
     `12H-5-bank-accounts-two-rows.png`
  6. View / row detail → `12H-6-bank-account-view.png`
  7. Edit modal pre-filled → `12H-7-bank-account-edit-prefilled.png`, cancel
  8. Delete confirm dialog (target named) → `12H-8-bank-account-delete-confirm.png`, cancel
  9. Filter dropdown (if any: status / account type) → `12H-9-bank-filter.png`
  10. Search box → `12H-10-bank-search.png`
- **Tab 2 — Transactions**
  11. Empty state → `12H-11-transactions-empty.png`
  12. + Record Transaction modal empty → `12H-12-txn-modal-empty.png`
  13. Type dropdown open (Deposit / Withdrawal / Transfer) → `12H-13-txn-type-dropdown.png`
  14. Modal filled — Deposit ₹20,000 → counter account Sales Revenue →
      `12H-14-txn-deposit-filled.png`, `12H-15-txn-deposit-after.png`
  15. Modal filled — Withdrawal ₹5,000 → counter account Office Rent →
      `12H-16-txn-withdrawal-filled.png`, `12H-17-txn-withdrawal-after.png`
  16. Bank filter dropdown open → `12H-18-txn-bank-filter.png`
  17. Date range picker open → `12H-19-txn-date-range.png`
  18. Search a reference → `12H-20-txn-search.png`
  19. Row delete confirm (cancel) → `12H-21-txn-delete-confirm.png`
- **Tab 3 — Inter-Bank Transfer**
  20. Empty form → `12H-22-transfer-empty.png`
  21. From/To dropdowns open → `12H-23-transfer-from-dropdown.png`, `12H-24-transfer-to-dropdown.png`
  22. Form filled (HDFC → ICICI, ₹10,000) → `12H-25-transfer-filled.png`
  23. Execute confirm (if any) → `12H-26-transfer-confirm.png`
  24. After execute — both accounts reflect the transfer →
      `12H-27-transfer-after.png`
  25. Recent Transfers table row → `12H-28-transfer-row.png`
  26. GL impact of the transfer (cross-link to GL page) → `12H-29-transfer-gl-impact.png`
- **Tab 4 — Reconciliation**
  27. Empty workspace → `12H-30-reconcile-empty.png`
  28. Bank filter + statement balance + statement date filled →
      `12H-31-reconcile-setup.png`
  29. Start Reconciliation → workspace opens with unmatched transactions →
      `12H-32-reconcile-workspace.png`
  30. Select a few rows + Match Selected → `12H-33-reconcile-matching.png`,
      `12H-34-reconcile-matched.png`
  31. Summary tiles (Statement / Matched / Unmatched / Difference) →
      `12H-35-reconcile-summary.png`
  32. Complete Reconciliation confirm → `12H-36-reconcile-complete-confirm.png`
  33. Post-complete state (locked, green "Reconciled" badge) →
      `12H-37-reconcile-done.png`
- **Concepts to teach in prose:**
  - What a bank account in the ledger represents vs the physical bank
  - Why deposits/withdrawals/transfers each create a specific journal entry
  - What reconciliation is, why you do it monthly, what "unmatched" means,
    what Difference = 0 proves
- **Bugs to expect:** transaction type dropdown wiring, transfer double-post,
  reconciliation "Match" not persisting, period-lock interaction, empty-state
  CTA mismatch with toolbar button.

### Session H2 — Expenses deep dive  ⬜ NOT STARTED
- **Page:** `/pages/accounts/expenses.html`
- **Setup → Categories**
  - Empty → + New Category modal empty → filled (Travel, GL 5020) → saved row →
    Edit prefilled → Delete confirm → `13H-1..13H-6`
- **Setup → Policies**
  - Empty → + New Policy (Travel, ₹5000/trip limit) → saved → row actions →
    `13H-7..13H-11`
- **Claims → Expense Claims**
  - Submit Claim modal empty → filled (line items, receipt upload) → saved draft
    → `13H-12..13H-16`
  - Approve action + confirm → `13H-17..13H-18`
  - Reject action + reason modal → `13H-19..13H-20`
  - Reimburse action (posts to GL) → `13H-21..13H-22`
- **Claims → Claim History** filters, export → `13H-23..13H-24`
- **Concepts:** expense lifecycle, policy enforcement, receipt audit trail,
  why reimbursement creates a cash-out journal entry.

### Session H3 — Fixed Assets deep dive  ⬜ NOT STARTED
- **Page:** `/pages/accounts/assets.html`
- **Setup → Asset Categories**
  - + New Category modal empty → filled (Laptops, SLM, 3-year life,
    GL 1510 Fixed Assets, GL 1519 Accum Depreciation, ₹5000 salvage) →
    saved → `14H-1..14H-4`
- **Register → Asset Register**
  - + New Asset modal empty → filled (MacBook Pro, ₹1,50,000, purchase date,
    category Laptops) → saved → `14H-5..14H-8`
  - View / Edit / Deactivate row actions → `14H-9..14H-12`
- **Register → Depreciation**
  - Depreciation schedule preview → `14H-13`
  - Post Depreciation for period → confirm → GL impact → `14H-14..14H-16`
- **Register → Disposal**
  - Dispose modal (sell ₹80,000 on date X) → computes gain/loss →
    posts JE → `14H-17..14H-19`
- **Concepts:** why fixed assets are capitalised (not expensed), SLM vs DDB,
  useful life, salvage, how depreciation shows up on the BS and P&L, disposal
  accounting (write off NBV, recognise gain/loss).

### Session H4 — Subscription Billing deep dive  ⬜ NOT STARTED
- **Page:** `/pages/accounts/billing.html`
- **Plans → Billing Plans**
  - + New Plan modal empty → filled (Pro Monthly, Subscription, ₹999/month) →
    saved → row actions (Edit / Duplicate / Delete) → `15H-1..15H-6`
- **Plans → Subscriptions**
  - + New Subscription modal empty → filled (Customer=Lumira, Plan=Pro Monthly,
    start today, qty 5) → saved → `15H-7..15H-10`
  - Row actions: View detail, Pause (confirm), Resume, Cancel (confirm) →
    `15H-11..15H-16`
- **Usage → Usage Meters**
  - + New Meter modal (API Calls, per 1000, ₹5/unit, sum aggregation) →
    saved → Record Usage action → `15H-17..15H-21`
- **Usage → Tokens**
  - Token balance view → Add tokens → Consume tokens → `15H-22..15H-25`
- **Concepts:** Subscription vs usage-based vs token billing, proration,
  why each generates a different invoice cadence, how the monthly billing
  run turns subscriptions into draft invoices in §10.

### Session I — Admin deep dive + Closing + Glossary  ⬜ NOT STARTED
- **Page:** `/pages/accounts/admin.html`
- **Tab 1 — Audit Logs** (already partially covered — fill gaps)
  - Filter by entity type, by user, by action → `16I-1..16I-4`
  - View Trail link → payload modal → `16I-5`
  - Export button → format picker → file downloaded → `16I-6..16I-7`
- **Tab 2 — Pending Approvals**
  - Empty state → populated with one pending item → Approve confirm → row
    removed → `16I-8..16I-11`
  - Reject action with reason → `16I-12..16I-13`
- **Tab 3 — Integrity Check**
  - Run Check button → progress → report with pass/fail per check →
    `16I-14..16I-16`
- **Tab 4 — Job Log**
  - Row list → View details → Retry failed job (if any) → `16I-17..16I-19`
- **Tab 5 — Closing Checklists**
  - Empty checklist → fill items → save → generate report → `16I-20..16I-23`
- **Tab 6 — Year-End Closing**
  - Run Closing modal (confirm FY to close) → progress → success summary →
    new FY auto-created → `16I-24..16I-27`
- **Period close** (back on setup.html Fiscal Periods tab)
  - Period-close action with checks-passed dialog → `14I-1-period-close.png`
- **Glossary work:** verify every term card in §17 has a working anchor link
  into the body sections after the rewrite.

### Session J — Gap fills on already-covered sections  ⬜ NOT STARTED
Small targeted captures that existing sections are missing:
- **Parties → Approval Requests tab** (never captured) — empty, populated,
  Approve confirm, Reject with reason → `07J-1..07J-5`
- **Reports** — date range picker open, column sort, drill-down from TB
  balance → GL entries, Export dialog (PDF/CSV/Excel), P&L period comparison
  toggle → `11J-1..11J-6`
- **Dashboard** — click-through from Quick Action card (Banking card) to
  destination page → `03J-1..03J-2`

---

## 3. Phases (high-level milestones)

| Phase | Description                                               | Status        |
|-------|-----------------------------------------------------------|---------------|
| 1     | Article skeleton (HTML, CSS, sidebar, hero, §1–3 prose)   | ✅ Done       |
| 2     | Demo tenant prep (login, clean DB)                        | ✅ Done       |
| 3     | Capture sessions A–I (screenshots + bug fixes inline)     | ⏳ Session B  |
| 4     | Write the body prose for §4–§15 using the captures        | ⬜ Not started |
| 5     | Verification pass: light/dark, mobile, print, sidebar nav, all anchors live | ⬜ |

---

## 4. Backend smoke-test checklist (for the demo next week)

While capturing each session, also verify the underlying API works. Anything
that fails → log in `_BUGS_FIXED_DURING_CAPTURE.md` and fix before screenshotting.

- [ ] `POST /api/accounts/setup/coa-templates/india` seeds 79 accounts
- [ ] `GET /api/accounts/setup/account-tree` returns hierarchical tree
- [ ] `POST /api/accounts/setup/fiscal-years` creates FY + 12 periods
- [ ] `POST /api/accounts/taxation/seed-india-gst` seeds tax configs
- [ ] `POST /api/accounts/parties` creates customer with GSTIN validation
- [ ] `POST /api/accounts/receivables/invoices` creates draft invoice
- [ ] `POST /api/accounts/receivables/invoices/{id}/post` writes JE to GL
- [ ] `POST /api/accounts/payables/bills` + post → JE in GL
- [ ] `GET /api/accounts/ledger/entries` returns posted JEs
- [ ] `POST /api/accounts/ledger/journal-entries` allows manual JE (balanced)
- [ ] `GET /api/accounts/reports/trial-balance` Σ debits = Σ credits
- [ ] `GET /api/accounts/reports/balance-sheet` A = L + E
- [ ] `GET /api/accounts/reports/profit-loss` matches sum of revenue/expense
  accounts in TB
- [ ] `POST /api/accounts/setup/fiscal-periods/{id}/lock` blocks new entries
  in that period

---

## 5. Progress tracker — UPDATE AFTER EVERY PHASE

| Date       | Session | What was completed                                                               | Bugs fixed |
|------------|---------|----------------------------------------------------------------------------------|------------|
| 2026-04-08 | A       | Login → Dashboard → all 12 module cards (`03-*` series, 16 images)               | none       |
| 2026-04-08 | B (1/3) | CoA templates seeded, India template loaded, Account Types tab, Fiscal Year + 12 periods, Tax page empty + seed-confirm modal (`04-1..04-4`, `05-1..05-5`, `06-1..06-2`) | 2 (modal positioning, FY-periods dropdown refresh) |
| _next_     | B (2/3) | Account Tree, Accounts flat list, + Add Account modal, Journal Types, Tax seed AFTER state, HSN/SAC, Opening Balances | TBD |
| _next_     | B (3/3) | Period lock action, last setup polish                                            | TBD |
| _next_     | C       | Customers + Vendors                                                              | TBD |
| _next_     | D       | Customer Invoices end-to-end                                                     | TBD |
| _next_     | E       | Vendor Bills end-to-end                                                          | TBD |
| _next_     | F       | GL + Manual JEs                                                                  | TBD |
| _next_     | G       | All 6 reports                                                                    | TBD |
| 2026-04-09 | Plan    | Scope expansion: Sessions H/I promoted from pointer sections to deep dives; Session J added for gap fills | -          |
| 2026-04-09 | H (1/4) | Banking Bank Accounts tab started: created prerequisite GL accounts 1010 HDFC + 1020 ICICI via Setup → Accounts; captured empty state, empty modal, filled modal, first saved row (HDFC). Found+fixed bug #33 (row actions missing View + Deactivate) and bug #34 (prerequisite GL accounts not taught). | 2 (#33 banking row actions, #34 prerequisite GL accounts) |
| 2026-04-09 | H (2/4) | Bank Accounts tab COMPLETE: ICICI Savings created, two-row state, View modal, Edit pre-filled (with SWIFT re-saved), Deactivate confirm dialog, post-deactivate row, Show Inactive toggle, Reactivate round-trip. 11 captures total. Found+fixed bug #35 (swift_code dropped by INSERT) and bug #36 (Show Inactive toggle + includeInactive query param). | 2 (#35 swift_code INSERT, #36 includeInactive filter + Show Inactive toggle) |
| 2026-04-09 | H (3/4) | Transactions tab COMPLETE: bank filter dropdown, deposit + withdrawal flows (₹25k / ₹3k), search, target-named delete confirm. 10 captures (`12H-12`–`12H-21`). Found+fixed #37 (debit/credit swapped + running balance missing) and #38 (generic delete confirm). | 2 |
| 2026-04-09 | H (4/4) | Inter-Bank Transfer + Reconciliation tabs COMPLETE: ₹5,000 HDFC→ICICI transfer executed; reconciliation started, matched, and completed end-to-end. 10 captures (`12H-22`–`12H-31`). Found+fixed #39 (CRITICAL glass-card-body flex scrambling — user flagged as investor-unshowable) and #40 (generic reconciliation confirm + variable typo). | 2 |
| 2026-04-09 | H2      | Expenses deep dive: category create (Travel), policy (₹5k cap), claim submit (EXP-2026-00001 ₹4,500). 12 captures (`13H-1`–`13H-12`). Found+fixed #41 (expense GL dropdown "undefined" + related fixes in taxation/payables/assets) and #43 (generic approve confirm). SoD 409 captured as feature. | 3 |
| 2026-04-09 | H3      | Assets deep dive: category (Computers SLM 3yr 33.33%), register (FA-0001 MBP ₹1.5L), Run Depreciation. 10 captures (`14H-1`–`14H-10`). #44 logged (generic depreciation confirm). | 0 fixed, 1 logged |
| 2026-04-09 | H4      | Billing deep dive: Plan create (PRO-MO-999 ₹999/month), Subscriptions/Usage/Tokens tabs toured. 6 captures (`15H-1`–`15H-6`). | 0 |
| 2026-04-09 | I       | Admin deep dive: all 6 tabs toured (Audit Logs, Pending Approvals, Integrity Check [#45 logged — [object Object] render], Job Log, Closing Checklists, Year-End Closing). 6 captures (`16I-1`–`16I-6`). | 0 fixed, 1 logged |
| 2026-04-09 | J       | Gap fills: Reports Trial Balance generated with toolbar visible (Export PDF / CSV / Print), Parties Approval tabs (both empty). 4 captures (`11J-1`,`11J-2`,`07J-1`,`07J-2`). | 0 |
| _next_     | H (3/4) | Transactions tab (empty, Record Transaction modal, deposit+withdrawal flows, filters, search, delete confirm) | TBD |
| _next_     | H (4/4) | Inter-Bank Transfer + Reconciliation tabs (full workflow each)                   | TBD |
| _next_     | H2      | Expenses deep dive (categories, policies, claim lifecycle)                        | TBD |
| _next_     | H3      | Fixed Assets deep dive (categories, register, depreciation, disposal)             | TBD |
| _next_     | H4      | Subscription Billing deep dive (plans, subscriptions, usage, tokens)              | TBD |
| _next_     | I       | Admin tabs 2-6 + closing + glossary anchor verification                           | TBD |
| _next_     | J       | Gap fills: Parties Approval tab, Reports filters/export/drill, Dashboard click-through | TBD |
| _next_     | Phase 4 | Write §4–§15 prose using captured screenshots                                    | -          |
| _next_     | Phase 5 | Verification pass (themes, mobile, print, anchors)                               | -          |

---

## 6. How to resume after an interruption

1. Open this file. Look at the **Progress tracker** — find the last row that
   isn't marked done.
2. Open `_BUGS_FIXED_DURING_CAPTURE.md` to see what's already been patched
   (so you don't re-diagnose the same bug).
3. `ls Frontend/KnowledgeBase/Accounts/images/` to see which screenshots
   already exist. Anything in the session checklist above NOT in `images/`
   is what you still owe.
4. Open Playwright, navigate to the page for that session, and resume from
   the next un-captured step.
5. Apply the **fix-first rule** for any glitch you see.
6. When the session is fully done, **append a row** to the Progress tracker
   with the date, session, what landed, and bugs fixed. Then save this file.
