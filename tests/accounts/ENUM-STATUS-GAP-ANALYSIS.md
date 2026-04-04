# Accounts Module — Database Enum vs Frontend Dropdown Gap Analysis

**Generated:** 2026-04-04
**Database:** 52 tables, 36 CHECK constraints
**Scope:** Every status, type, method, and enum-like column cross-referenced against frontend dropdowns

---

## GAPS FOUND: 15 mismatches where frontend dropdowns don't match database constraints

---

### GAP 1: Expense Claim Status — MISSING `draft` and `cancelled`

| | Database CHECK (`chk_claim_status`) | Frontend Dropdown (`#claimStatusFilter`) |
|---|---|---|
| draft | YES | **NO** |
| submitted | YES | YES |
| approved | YES | YES |
| rejected | YES | YES |
| reimbursed | YES | YES |
| cancelled | YES | **NO** |

**Files:** `expenses.html:261-267`, `expenses.js`
**Impact:** Users cannot filter by draft or cancelled claims. If a claim is saved as draft or cancelled, it won't appear in filtered views.

---

### GAP 2: Customer Invoice Status — `partial` vs `partially_paid`

| | Database CHECK (`chk_invoice_status`) | Frontend Dropdown (`#invoiceStatusFilter`) |
|---|---|---|
| draft | YES | YES |
| approved | YES | YES |
| sent | YES | YES |
| partially_paid | YES | **`partial`** (MISMATCH) |
| paid | YES | YES |
| overdue | YES | YES |
| cancelled | YES | YES |
| written_off | YES | **NO** |

**Files:** `receivables.html:167-175`
**Impact:** Frontend sends `partial` but DB stores `partially_paid`. Filter won't match. Also `written_off` status is missing entirely.

---

### GAP 3: Bank Account Type — MISSING `petty_cash` and `payment_gateway`

| | Database CHECK (`chk_bank_acct_type`) | Frontend Dropdown (`#accountType`) |
|---|---|---|
| bank | YES | YES |
| cash | YES | YES |
| petty_cash | YES | **NO** |
| payment_gateway | YES | **NO** |

**Files:** `banking.html:486-490`
**Impact:** Cannot create bank accounts of type petty_cash or payment_gateway from the UI.

---

### GAP 4: Bank Transaction Type — MISSING 5 types

| | Database CHECK (`chk_bank_txn_type`) | Frontend Dropdown (`#txnType`) |
|---|---|---|
| deposit | YES | YES |
| withdrawal | YES | YES |
| transfer_in | YES | **NO** |
| transfer_out | YES | **NO** |
| interest | YES | **NO** |
| charges | YES | **NO** |
| payment_gateway | YES | **NO** |

**Files:** `banking.html:549-553`
**Impact:** Cannot manually record interest income, bank charges, or gateway transactions. Transfer types are created programmatically but not selectable in dropdown.

---

### GAP 5: Depreciation Method — `written_down` vs `written_down_value`

| | Database CHECK (`chk_dep_method`) | Frontend Dropdown (`#categoryMethod`) |
|---|---|---|
| straight_line | YES | YES |
| written_down | YES | **`written_down_value`** (MISMATCH) |
| units_of_production | YES | YES |

**Files:** `assets.html:338-343`
**Impact:** Frontend sends `written_down_value` but DB constraint expects `written_down`. Creating a WDV category will fail with constraint violation.

---

### GAP 6: Billing Plan Type — MISSING in billing plan form

| | Database CHECK (`chk_billing_type`) | Frontend Dropdown (`#planInterval`) |
|---|---|---|
| subscription | YES | **NO** (mapped as interval, not type) |
| usage | YES | **NO** |
| token | YES | **NO** |
| one_time | YES | YES (as interval option) |

**Files:** `billing.html:430-437`
**Impact:** The `planInterval` dropdown conflates `billing_type` and `billing_cycle`. The DB has separate `billing_type` (subscription/usage/token/one_time) and `billing_cycle` (monthly/quarterly/semi_annual/annual) columns. Frontend only has one dropdown that mixes both concepts.

---

### GAP 7: Subscription Status — MISSING 3 statuses

| | Database CHECK (`chk_sub_status`) | Frontend Status Badge |
|---|---|---|
| trial | YES | **NO** |
| active | YES | YES |
| past_due | YES | **NO** |
| cancelled | YES | YES |
| expired | YES | **NO** |

**Files:** `billing.js` (status badge rendering)
**Impact:** `trial`, `past_due`, and `expired` subscriptions will show with incorrect/generic badge styling.

---

### GAP 8: Tax Ledger Transaction Type — Frontend values don't match DB

| | Database CHECK (`chk_tax_txn_type`) | Frontend Dropdown (`#ledgerTxnTypeFilter`) |
|---|---|---|
| sales | YES | **NO** (has `invoice` instead) |
| purchase | YES | **NO** (has `payment` instead) |
| tds_deducted | YES | **NO** |
| tds_collected | YES | **NO** |
| tcs_collected | YES | **NO** |
| invoice | **NO** | YES (not in DB) |
| payment | **NO** | YES (not in DB) |
| credit_note | **NO** | YES (not in DB) |
| debit_note | **NO** | YES (not in DB) |

**Files:** `taxation.html:484-490`
**Impact:** COMPLETE MISMATCH. Frontend filter values (`invoice`, `payment`, `credit_note`, `debit_note`) don't match any DB values (`sales`, `purchase`, `tds_deducted`, `tds_collected`, `tcs_collected`). Tax ledger filtering is completely broken.

---

### GAP 9: Vendor Payment Method — MISSING 5 methods

| | Database CHECK (`chk_payment_method`) | Frontend Payment Form |
|---|---|---|
| bank_transfer | YES | YES (default/only option) |
| cheque | YES | **NO** |
| cash | YES | **NO** |
| upi | YES | **NO** |
| card | YES | **NO** |
| other | YES | **NO** |

**Files:** `payables.js` (record payment form)
**Impact:** All vendor payments are created as bank_transfer. No dropdown to select cheque, cash, UPI, or card payments.

---

### GAP 10: Customer Payment Method — MISSING 6 methods

| | Database CHECK (`chk_cust_payment_method`) | Frontend Payment Form |
|---|---|---|
| bank_transfer | YES | YES (default/only option) |
| cheque | YES | **NO** |
| cash | YES | **NO** |
| upi | YES | **NO** |
| card | YES | **NO** |
| payment_gateway | YES | **NO** |
| other | YES | **NO** |

**Files:** `receivables.js` (record payment form)
**Impact:** Same as vendor payments — all customer payments forced to bank_transfer.

---

### GAP 11: Credit Note Status — MISSING from filter/UI

| | Database CHECK (`chk_cn_status`) | Frontend |
|---|---|---|
| draft | YES | **NO filter** |
| approved | YES | **NO filter** |
| applied | YES | **NO filter** |
| cancelled | YES | **NO filter** |

**Files:** `receivables.html` (credit notes tab)
**Impact:** No status filter dropdown for credit notes tab. Users cannot filter by draft/approved/applied/cancelled.

---

### GAP 12: Closing Checklist Type — MISSING from create form

| | Database CHECK (`chk_closing_type`) | Frontend Create Form |
|---|---|---|
| month_end | YES | **NO dropdown** |
| quarter_end | YES | **NO dropdown** |
| year_end | YES | **NO dropdown** |

**Files:** `admin.html`, `admin.js`
**Impact:** When creating a closing checklist, there's no dropdown to select the closing type. The type must be sent in the payload but the frontend doesn't have a field for it.

---

### GAP 13: Audit Log Entity Type — MISSING 20+ entity types from filter

| | Database (27 distinct values) | Frontend Dropdown (`#auditEntityFilter`, 7 options) |
|---|---|---|
| account | YES | YES |
| journal | **NO** (DB uses `gl_entry`, `journal_type`) | YES |
| invoice | **NO** (DB uses `customer_invoice`) | YES |
| payment | **NO** (DB uses `vendor_payment`, `customer_payment`) | YES |
| expense | **NO** (DB uses `expense_claim`, `expense_policy`) | YES |
| asset | **NO** (DB uses `fixed_asset`) | YES |
| tax | **NO** (not in DB) | YES |
| account_group | YES | **NO** |
| bank_account | YES | **NO** |
| bank_reconciliation | YES | **NO** |
| bank_transaction | YES | **NO** |
| bank_transfer | YES | **NO** |
| billing_plan | YES | **NO** |
| closing_checklist | YES | **NO** |
| coa_template | YES | **NO** |
| credit_note | YES | **NO** |
| customer | YES | **NO** |
| customer_invoice | YES | **NO** |
| customer_payment | YES | **NO** |
| depreciation | YES | **NO** |
| expense_claim | YES | **NO** |
| expense_policy | YES | **NO** |
| fiscal_period | YES | **NO** |
| fiscal_year | YES | **NO** |
| fixed_asset | YES | **NO** |
| gl_entry | YES | **NO** |
| journal_type | YES | **NO** |
| subscription | YES | **NO** |
| system | YES | **NO** |
| token_balance | YES | **NO** |
| vendor | YES | **NO** |
| vendor_bill | YES | **NO** |
| vendor_payment | YES | **NO** |

**Files:** `admin.html:166-175`
**Impact:** Frontend filter options don't match actual DB entity_type values. Filtering by "journal" won't find anything (DB stores "gl_entry"). Need to either use actual DB values or map frontend labels to DB values.

---

### GAP 14: Status Badge — MISSING status mappings

| Status Value | In Database | Badge Mapping | Badge Color |
|---|---|---|---|
| submitted | YES (expense_claims) | **MISSING** | Will show as `status-pending` (default) |
| sent | YES (invoices) | **MISSING** | Will show as `status-pending` (default) |
| partially_paid | YES (invoices, bills) | **MISSING** | Will show as `status-pending` (default) |
| reimbursed | YES (expense_claims) | **MISSING** | Will show as `status-pending` (default) |
| disposed | YES (assets) | **MISSING** | Will show as `status-pending` (default) |
| written_off | YES (assets, invoices) | **MISSING** | Will show as `status-pending` (default) |
| trial | YES (subscriptions) | **MISSING** | Will show as `status-pending` (default) |
| past_due | YES (subscriptions) | **MISSING** | Will show as `status-pending` (default) |
| expired | YES (subscriptions) | **MISSING** | Will show as `status-pending` (default) |
| reversed | YES (gl_entries) | **MISSING** | Will show as `status-pending` (default) |
| in_progress | YES (reconciliations, checklists) | **MISSING** | Will show as `status-pending` (default) |
| completed | YES (reconciliations, checklists) | **MISSING** | Will show as `status-pending` (default) |
| not_started | YES (checklists) | **MISSING** | Will show as `status-pending` (default) |
| written_down | YES (depreciation) | **MISSING** | Will show as `status-pending` (default) |

**Files:** `accounts-common.js:422-434` (statusBadge function)
**Impact:** Many valid statuses render with generic yellow "pending" badge instead of semantic colors.

---

### GAP 15: GL Reference Type — Not exposed in UI filter

| | Database CHECK (`chk_gl_ref_type`, 14 values) | Frontend Filter |
|---|---|---|
| manual, vendor_bill, customer_invoice, vendor_payment, customer_payment, credit_note, payroll, expense, depreciation, disposal, transfer, closing, opening_balance, reversal | YES | **NO FILTER** |

**Files:** `ledger.html`
**Impact:** No dropdown to filter GL entries by reference type (source). Users can't filter to see only vendor bill entries, payment entries, etc.

---

## SUMMARY: Fix Priority

| Priority | Gap | Impact |
|----------|-----|--------|
| **CRITICAL** | Gap 8: Tax ledger filter values completely wrong | Filtering broken |
| **CRITICAL** | Gap 5: Depreciation method `written_down_value` vs `written_down` | DB constraint violation |
| **CRITICAL** | Gap 2: Invoice `partial` vs `partially_paid` | Filter broken |
| **HIGH** | Gap 13: Audit entity types don't match DB values | Filter broken |
| **HIGH** | Gap 9+10: Payment method dropdowns missing | All payments forced to bank_transfer |
| **HIGH** | Gap 14: Status badge missing 14 status values | Wrong colors |
| **MEDIUM** | Gap 1: Expense claim missing draft/cancelled | Incomplete filter |
| **MEDIUM** | Gap 3: Bank account type missing petty_cash/payment_gateway | Can't create these types |
| **MEDIUM** | Gap 4: Bank transaction type missing 5 types | Can't record interest/charges |
| **MEDIUM** | Gap 6: Billing type vs cycle conflated | Wrong data model |
| **MEDIUM** | Gap 7: Subscription status missing trial/past_due/expired | Badge display |
| **MEDIUM** | Gap 11: Credit note status filter missing | No filtering |
| **MEDIUM** | Gap 12: Closing checklist type missing from form | Can't set type |
| **LOW** | Gap 15: GL reference type not filterable | Missing convenience filter |
