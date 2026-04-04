# Accounts Module — Visual Inspection Issues

**Inspected:** 2026-04-04
**Pages Inspected:** 13 pages, 61 tabs
**Issues Found:** 17 (10 critical, 4 medium, 3 low)
**Pages Clean:** Dashboard, Parties, Banking, Ledger, Expenses, Reports, Assets, Billing (8/13)

---

## CRITICAL ISSUES (10) — Data not displayed or wrong numbers

### Issue #1: Payables — Bill "Total" and "Balance" columns show "-"
- **Page:** payables.html, Tab: Vendor Bills
- **Shows:** "-" in Total and Balance columns for ALL 50 rows
- **Root cause:** `b.total` and `b.balance` — API returns `total_amount` and `balance_due`
- **Fix:** `payables.js` lines 174-175: `b.total` → `b.total_amount`, `b.balance` → `b.balance_due`
- **Status:** FIXED

### Issue #2: Payables — "Total Outstanding" stat shows "0.00"
- **Page:** payables.html, Tab: Vendor Bills
- **Shows:** ₹0.00
- **Root cause:** Stat computed from `b.balance` (undefined) → NaN → 0. Should use `b.balance_due`
- **Fix:** `payables.js` line 133: `b.balance` → `b.balance_due`
- **Status:** FIXED

### Issue #3: Receivables — Invoice "Balance" column shows "-"
- **Page:** receivables.html, Tab: Invoices
- **Shows:** "-" for ALL 50 rows
- **Root cause:** `inv.balance` — API returns `balance_due`
- **Fix:** `receivables.js` line 209: `inv.balance` → `inv.balance_due`
- **Status:** FIXED

### Issue #4: Receivables — 3 stat cards show "-"
- **Page:** receivables.html, Tab: Invoices
- **Shows:** Draft="-", Approved="-", Total Receivable="-"
- **Root cause:** Expects `res.stats` wrapper but API returns flat array. No client-side fallback.
- **Fix:** Compute stats from loaded items: `items.filter(i => i.status === 'draft').length`, sum `balance_due` for total receivable
- **Status:** FIXED

### Issue #5: Payables & Receivables — Payment "Bank Account" shows "-"
- **Pages:** payables.html + receivables.html, Tab: Payments
- **Shows:** "-" for all rows
- **Root cause:** Bank account lookup uses COA IDs, but `bank_account_id` references banking module. Need to load from `bank/accounts` endpoint.
- **Fix:** Load bank accounts from `bank/accounts` instead of `coa`, build `_bankAccountMap` for name lookup
- **Status:** FIXED — Payables shows "HDFC Current", Receivables shows "HDFC Current"

### Issue #6: Receivables — Payment "Reference" shows "-"
- **Page:** receivables.html, Tab: Payments
- **Shows:** "-" for all rows
- **Root cause:** `p.reference` — API returns `reference_number`
- **Fix:** `receivables.js`: `p.reference` → `p.reference_number || p.reference`
- **Status:** FIXED

### Issue #7: Admin — Checklist "Name" column empty
- **Page:** admin.html, Tab: Closing Checklists
- **Shows:** Empty cell
- **Root cause:** `c.name` — API has no `name`, returns `closing_type`
- **Fix:** `admin.js`: Use `c.closing_type` formatted as label (e.g., "Month End")
- **Status:** FIXED

### Issue #8: Admin — Checklist "Fiscal Year" shows "-"
- **Page:** admin.html, Tab: Closing Checklists
- **Shows:** "-" for all rows
- **Root cause:** `c.fiscal_year_id` — API returns `fiscal_period_id` and `period_name`
- **Fix:** `admin.js`: Use `c.period_name || c.fiscal_period_id`
- **Status:** FIXED

### Issue #9: Admin — Checklist "Progress" shows "-"
- **Page:** admin.html, Tab: Closing Checklists
- **Shows:** "-" for all rows
- **Root cause:** `c.progress` — API has no `progress`, has `items` array
- **Fix:** Compute from items: `completed / total items`
- **Status:** FIXED

### Issue #10: Setup — Fiscal Years "Closed" stat shows 0
- **Page:** setup.html, Tab: Fiscal Years
- **Shows:** 0 (should be 1)
- **Root cause:** `fy.status === 'closed'` but API returns boolean `is_closed`
- **Fix:** `setup.js`: `fiscalYears.filter(fy => fy.is_closed).length`
- **Status:** FIXED

---

## MEDIUM ISSUES (4) — Badge/display cosmetic issues

### Issue #11: "Partially_paid" badge shows underscore
- **Pages:** payables.html, receivables.html, admin.html
- **Shows:** "Partially_paid", "In_progress", "Not_started"
- **Root cause:** Status badge only capitalizes first char, doesn't replace underscores
- **Fix:** `accounts-common.js` statusBadge: add `.replace(/_/g, ' ')` before capitalize
- **Status:** FIXED

### Issue #12: Admin — Audit action badges all same color
- **Page:** admin.html, Tab: Audit Logs
- **Shows:** All actions yellow/amber
- **Root cause:** Only `create` and `delete` mapped, missing submitted/approved/rejected/etc.
- **Fix:** Add mappings: approved/submitted/reimbursed → green, rejected/cancelled → red
- **Status:** FIXED

### Issue #13: Admin — Audit "User" column shows UUID
- **Page:** admin.html, Tab: Audit Logs
- **Shows:** Raw UUID `1f2f4d09-...`
- **Root cause:** No user name resolution. Would need AuthGrpcClient or frontend user cache.
- **Fix:** Show shortened UUID with tooltip for now: `l.performed_by?.substring(0, 8) + '...'`
- **Status:** NOTED (would need backend enrichment for full fix)

### Issue #14: Taxation — HSN/SAC badge shows "-"
- **Page:** taxation.html, Tab: HSN/SAC Codes
- **Shows:** Badge with "-" text
- **Root cause:** `h.type || '-'` inside badge span when type is null
- **Fix:** Use `h.code_type || h.type || 'N/A'` and don't render badge for null
- **Status:** FIXED

---

## LOW ISSUES (3) — Missing optional data

### Issue #15: Setup — Account Types "Classification" shows "-"
- **Page:** setup.html, Tab: Account Types
- **Root cause:** `classification` field not in API response. Column shouldn't exist or should use `normal_balance`.
- **Fix:** Replace "Classification" column with "Normal Balance" using `t.normal_balance`
- **Status:** FIXED

### Issue #16: Setup — Opening Balances "Type" shows "-"
- **Page:** setup.html, Tab: Opening Balances
- **Root cause:** `account_type_id` not in opening balance response
- **Fix:** Use `ob.account_type_name || ob.account_type || '-'` or remove column
- **Status:** FIXED

### Issue #17: Setup — Fiscal Year status logic wrong
- **Page:** setup.html, Tab: Fiscal Years
- **Shows:** Non-active/non-closed FYs show "Closed" instead of "Inactive"
- **Root cause:** `is_active ? 'active' : 'closed'` — should check `is_closed` separately
- **Fix:** `fy.is_closed ? 'closed' : (fy.is_active ? 'active' : 'inactive')`
- **Status:** FIXED
