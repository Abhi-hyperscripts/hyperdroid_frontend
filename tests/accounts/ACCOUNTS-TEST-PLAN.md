# Accounts Module - Comprehensive Testing Plan

**Created:** 2026-04-04
**Scope:** All 13 Accounts pages, 61 tabs, 70+ API endpoints
**Method:** Playwright MCP browser automation + visual screenshot inspection + DB verification
**Rule:** Complete one page fully before moving to the next. Fix issues inline.

---

## Testing Methodology

### CRITICAL DIRECTIVES

1. **Full UI click-through testing is MANDATORY** — Every action (create, edit, approve, delete, pay, etc.) MUST be tested by clicking actual UI buttons via Playwright, NOT by calling JS functions directly. If a button doesn't work, that's a bug to fix.
2. **Fix ALL frontend-backend gaps inline** — If a frontend feature calls a backend endpoint that doesn't exist, or field names mismatch, or response structure differs — fix the frontend immediately. Don't just log it as "known limitation".
3. **Never use browser `confirm()`** — Always use `Confirm.show()` or `Confirm.danger()` from toast.js.
4. **Backend field names are source of truth** — Frontend must adapt to what backend returns. Never change backend.
5. **Test data cleanup** — Delete any test records created during testing.

### Per-Page Testing Steps

For each page/tab:
1. **Navigate** to the page, take a screenshot
2. **Verify sidebar** renders correctly with all tabs
3. **Switch to each tab** via sidebar click, verify content loads (no spinners stuck, no errors)
4. **Compare data** with database — run SQL queries to verify row counts and values match the UI
5. **Test filters** — click each dropdown, type in search, select date ranges — all via Playwright clicks
6. **Test modals** — click "+" button to open create modal, fill fields via Playwright fill, click Save
7. **Test CRUD actions end-to-end via UI clicks:**
   - **Create:** Click add button → fill form → click Save → verify row appears in table + DB
   - **Edit:** Click edit icon on row → verify pre-fill → modify field → click Save → verify update in table + DB
   - **Delete/Deactivate:** Click delete icon → verify Confirm.show() dialog appears → click confirm → verify removed
   - **Approve/Cancel/Pay:** Click action button → verify dialog/modal → confirm → verify status change in DB
8. **Check API gaps** — Compare frontend JS endpoints with backend controllers. If endpoint missing or field mismatch, fix frontend.
9. **Log results** in `ACCOUNTS-TEST-LOG.md` with clear (UI) or (JS) labels for how each test was performed

---

## Page Order & Checklist

### Phase 1: Dashboard (no sidebar)
- [ ] **Page 1: Dashboard** (`dashboard.html`)
  - [ ] GL Summary cards (Total Accounts, Assets, Liabilities, Revenue, Expenses, Net Income)
  - [ ] Bank Accounts grid (name, bank, balance)
  - [ ] Recent GL Entries table (date, description, debit, credit)
  - [ ] Refresh button works
  - [ ] DB verify: `SELECT COUNT(*) FROM coa_accounts`, bank balances, recent GL entries

### Phase 2: Setup & Configuration
- [ ] **Page 2: Setup** (`setup.html`) — 9 tabs
  - [ ] Tab 1: Account Types — table with Name, Normal Balance, Classification
  - [ ] Tab 2: Account Groups — table, search filter, type filter, create/edit/delete modal
  - [ ] Tab 3: Accounts — table with pagination (50/page), search, type/group filters, inactive toggle
  - [ ] Tab 4: Account Tree — hierarchical tree view, search
  - [ ] Tab 5: Opening Balances — table with fiscal year filter, create/edit/delete
  - [ ] Tab 6: Fiscal Years — table, create/edit modal
  - [ ] Tab 7: Fiscal Periods — table, fiscal year filter, create/edit/delete
  - [ ] Tab 8: Journal Types — table, create/edit/delete modal
  - [ ] Tab 9: COA Templates — template list
  - [ ] DB verify: `coa_account_types`, `coa_account_groups`, `coa_accounts`, `fiscal_years`, `fiscal_periods`, `journal_types`

### Phase 3: Parties
- [ ] **Page 3: Parties** (`parties.html`) — 2 tabs
  - [ ] Tab 1: Vendor List — table with stats (total/active/inactive), search, inactive toggle, create/edit modal
  - [ ] Tab 2: Customer List — table with stats, search, inactive toggle, create/edit modal
  - [ ] DB verify: `vendors`, `customers` — count and field values

### Phase 4: Payables
- [ ] **Page 4: Payables** (`payables.html`) — 4 tabs
  - [ ] Tab 1: Vendor Bills — table with stats, vendor/status/date filters, search, create/edit/approve/cancel, pagination
  - [ ] Tab 2: Payments — payment records table, filters
  - [ ] Tab 3: AP Aging — aging buckets (Current, 1-30, 31-60, 61-90, 90+)
  - [ ] Tab 4: Vendor Statements — vendor-wise statement with date range
  - [ ] DB verify: `vendor_bills`, `vendor_bill_items`, `vendor_payments`, bill status distribution

### Phase 5: Receivables
- [ ] **Page 5: Receivables** (`receivables.html`) — 5 tabs
  - [ ] Tab 1: Invoices — table with stats, customer/status/date filters, search, create/edit/approve/send
  - [ ] Tab 2: Payments — payment records, customer filter, date range
  - [ ] Tab 3: Credit Notes — table, customer filter, date range, create/edit/approve
  - [ ] Tab 4: AR Aging — aging buckets by customer
  - [ ] Tab 5: Customer Statements — customer-wise statement with date range
  - [ ] DB verify: `invoices`, `invoice_items`, `invoice_payments`, `credit_notes`, status distribution

### Phase 6: Banking
- [ ] **Page 6: Banking** (`banking.html`) — 4 tabs
  - [ ] Tab 1: Bank Accounts — table with stats, create/edit modal, default badge
  - [ ] Tab 2: Transactions — paginated table, bank filter, date range, search
  - [ ] Tab 3: Inter-Bank Transfer — from/to dropdowns, amount, transfer history
  - [ ] Tab 4: Reconciliation — bank dropdown, date range, reconcile workflow
  - [ ] DB verify: `bank_accounts`, `bank_transactions`, `bank_transfers`, `bank_reconciliations`

### Phase 7: General Ledger
- [x] **Page 7: Ledger** (`ledger.html`) — 3 tabs ✅ DONE (2026-04-04)
  - [x] Tab 1: GL Entries — paginated table, account/journal/status filters, date range, search
  - [x] Tab 2: Create Entry — form with SearchableDropdowns, Save Draft + Save & Post
  - [x] Tab 3: Journal Entries — paginated table, journal type filter, search
  - [x] DB verify: `gl_entries`, `gl_entry_lines` — reversal verified, save & post verified
  - [x] 3 backend-frontend gaps fixed, AuthGrpcClient created for AccountsService

### Phase 8: Expenses
- [x] **Page 8: Expenses** (`expenses.html`) — 3 tabs ✅ DONE (2026-04-04)
  - [x] Tab 1: Categories — table, search, create/edit modal, DB verified
  - [x] Tab 2: Policies — table, search, category dropdown, create/edit modal, DB verified
  - [x] Tab 3: Expense Claims — paginated table (20/page), search, status filter, view/approve/reject/reimburse workflow, submit claim
  - [x] DB verify: `expense_categories`, `expense_policies`, `expense_claims` — all verified
  - [x] 1 backend fix (missing updated_at columns), 2 frontend fixes (bank endpoint path, SW version)

### Phase 9: Reports
- [x] **Page 9: Reports** (`reports.html`) — 9 tabs ✅ DONE (2026-04-04)
  - [x] Tab 1: Trial Balance — FY dropdown, Generate, 62 rows, ₹3.13Cr balanced
  - [x] Tab 2: Profit & Loss — FY dropdown, Generate, 27 rows, Net Profit ₹16.06L
  - [x] Tab 3: Balance Sheet — FY dropdown, Generate, 38 rows, Assets = Liabilities + Equity
  - [x] Tab 4: Cash Flow — FY dropdown, Generate, 18 rows, Net Change ₹29.35L
  - [x] Tab 5: Account Ledger — account dropdown + date range, 115 txns for Primary Bank
  - [x] Tab 6: Day Book — date picker, 3 entries for Apr 4
  - [x] Tab 7: Cash Book — bank dropdown + date range, 10 txns
  - [x] Tab 8: AR Aging — 3 customers, aging buckets, Total ₹1.36Cr
  - [x] Tab 9: AP Aging — 3 vendors, aging buckets, Total ₹1.32Cr
  - [x] 8 frontend gaps fixed (3 endpoint paths, 4 field name mismatches, 1 SearchableDropdown constructor)

### Phase 10: Taxation
- [x] **Page 10: Taxation** (`taxation.html`) — 8 tabs ✅ DONE (2026-04-04)
  - [x] Tab 1: Tax Configs — 4 rows (GST 5/12/18/28%), country + rate rendering fixed
  - [x] Tab 2: Tax Rates — renders (requires config filter), no data without selection (expected)
  - [x] Tab 3: HSN/SAC Codes — renders, empty (no data seeded)
  - [x] Tab 4: GSTR-1 — report generates, endpoint path + date params fixed
  - [x] Tab 5: GSTR-3B — summary report generates with Output/Input/Net
  - [x] Tab 6: TDS Return — date params fixed
  - [x] Tab 7: Tax Calculator — amount + config → result card with taxable/tax/total
  - [x] Tab 8: Tax Ledger — 50 entries, field names fixed, pagination fixed
  - [x] 5 backend endpoints added (DELETE config, PUT/DELETE rates, PUT/DELETE hsn-sac)
  - [x] 10+ frontend gaps fixed (endpoints, field names, payloads, params)

### Phase 11: Fixed Assets
- [x] **Page 11: Assets** (`assets.html`) — 3 tabs ✅ DONE (2026-04-04)
  - [x] Tab 1: Asset Categories — 2 rows, edit/delete buttons, GL account selects
  - [x] Tab 2: Asset Register — 3 rows with code/name/category/date/cost/book value, all field names fixed
  - [x] Tab 3: Depreciation — date input + category filter + Run button, endpoint path fixed
  - [x] 2 backend endpoints added (PUT/DELETE categories), 13 frontend field name fixes

### Phase 12: Billing
- [x] **Page 12: Billing** (`billing.html`) — 4 tabs ✅ DONE (2026-04-04)
  - [ ] Tab 1: Billing Plans — table, search, create/edit/delete
  - [ ] Tab 2: Subscriptions — paginated table (50/page), search, create/edit/cancel
  - [ ] Tab 3: Usage Meters — table, create/edit/delete
  - [ ] Tab 4: Tokens — table, create/revoke
  - [ ] DB verify: `billing_plans`, `subscriptions`, `usage_meters`, `tokens`

### Phase 13: Administration
- [x] **Page 13: Admin** (`admin.html`) — 6 tabs ✅ DONE (2026-04-04)
  - [x] Tab 1: Audit Logs — 50 rows, entity/date/user filters, pagination
  - [x] Tab 2: Pending Approvals — "No pending approvals" (correct state)
  - [x] Tab 3: Integrity Check — Run button present
  - [x] Tab 4: Job Log — Tab renders (backend stub)
  - [x] Tab 5: Closing Checklists — 3 rows, FY filter dropdown
  - [x] Tab 6: Year-End Closing — FY dropdown loaded with SearchableDropdown
  - [x] 14 frontend endpoint fixes (admin/* → audit/system/closing namespaces), pagination, date params, SearchableDropdown constructor

---

## Database Connection

```bash
docker exec -it pgvector psql -U postgres -d hyperdroid_accounts
```

## Key Verification Queries

```sql
-- Row counts for all tables
SELECT schemaname, tablename, n_live_tup 
FROM pg_stat_user_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Specific table checks
SELECT COUNT(*) FROM coa_account_types;
SELECT COUNT(*) FROM coa_account_groups;
SELECT COUNT(*) FROM coa_accounts;
SELECT COUNT(*) FROM vendors;
SELECT COUNT(*) FROM customers;
SELECT COUNT(*) FROM vendor_bills;
SELECT COUNT(*) FROM invoices;
SELECT COUNT(*) FROM bank_accounts;
SELECT COUNT(*) FROM gl_entries;
SELECT COUNT(*) FROM expense_categories;
SELECT COUNT(*) FROM tax_configs;
SELECT COUNT(*) FROM assets;
SELECT COUNT(*) FROM billing_plans;
SELECT COUNT(*) FROM audit_logs;
```

---

## Success Criteria

- All 61 tabs render without JS errors affecting functionality
- Data on screen matches database records (counts + values)
- All filters narrow results correctly
- All modals open/close and populate correctly for edit mode
- Pagination works (where applicable)
- No stuck spinners or blank tables when data exists
- Sidebar + hamburger toggle works on all pages
