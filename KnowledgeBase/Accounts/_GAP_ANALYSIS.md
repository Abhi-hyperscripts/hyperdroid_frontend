# Accounts Gap Analysis — Backend ↔ Frontend ↔ Guide

> **Persistent worksheet.** This file is the source of truth for the gap-analysis effort.
> If a Claude session crashes, the next session reads this file end-to-end and resumes from the
> first row whose **Status** column is not `✓ done`. Do **not** delete rows — only update status.

## Scope

| | |
|---|---|
| Backend service | `AccountsService` (port 5122) |
| Backend controllers | **24** (`Controllers/*.cs`, excluding `BaseController.cs`) |
| Backend HTTP endpoints | **204** (counted from `[Http*]` attributes) |
| Frontend module | `Frontend/js/accounts/*.js` + `Frontend/pages/accounts/*.html` |
| Frontend pages | **13** |
| Frontend JS modules | **14** (one per page + `accounts-common.js`) |
| Knowledge-base guide | `Frontend/KnowledgeBase/Accounts/Accounts-Setup-Guide.html` |

## Goal

Produce a per-endpoint mapping that proves, for **every one of the 204 endpoints**:

1. **Is it called from the frontend?** Which JS file, which line, via which `api.*` helper.
2. **Does the request payload match the C# DTO field names** the controller expects?
3. **When the backend responds, does the frontend bind the right field names** off the response?
4. **Is the user-facing flow documented in the how-to guide?** Which `Accounts-Setup-Guide.html` figure/section?

Then close every gap:

- **Backend-only endpoints** (no frontend caller) → either build the UI for it or, if it is internal/copilot/system-only, mark as **N/A** with a justification.
- **Field-name mismatches** → fix the smaller side (usually frontend), retest in Playwright.
- **Frontend calls a non-existent endpoint** → fix the JS to use the real route.
- **Working flows missing from the guide** → add a figure + prose to the guide and recapture.

---

## Methodology

Five phases. Each phase has a clear exit criterion. Each row in the audit table below has a
Status column with one of: `pending` / `in-progress` / `✓ done` / `gap` / `N/A`.

### Phase 1 — Backend inventory  *(no code changes)*

For each of the 24 controllers, walk every method and record:

- HTTP verb + route template (combined with `[Route]` on the class)
- Method name
- `[Authorize(Roles=...)]` (if any)
- Input parameters: route params, `[FromQuery]` params, `[FromBody]` model name **and field list**
- Return type / response DTO **field list** (look at the model and at any `Ok(new {...})` projection)
- Side effects (audit-log, GL post, balance update) — one short sentence

Output: the **Controller Audit Tables** section below, fully populated.

Each controller becomes one subsection. Each endpoint becomes one row. Field lists are inlined as
short comma-separated strings, not nested tables — readability over ceremony.

**Exit criterion:** every one of the 204 endpoints has a row in this file.

### Phase 2 — Frontend inventory  *(no code changes)*

Walk the 14 JS modules. For every `api.get/post/put/delete/patch` call:

- Which page calls it
- Which line in which file
- The endpoint string (literal)
- The request body shape passed in
- Which response fields the caller reads

Then **join** to the Phase 1 table: fill in the **Frontend caller** and **Field-binding** columns
on each row. Endpoints with no caller get a `gap` status. Frontend calls that don't match any
backend route get listed in a separate **Orphan calls** section.

**Exit criterion:** every backend row has either a frontend caller or a `gap` mark; every
frontend `api.*` call resolves to a backend row or appears in Orphan calls.

### Phase 3 — Guide coverage  *(no code changes)*

For each backend row that has a frontend caller, find whether the user-facing flow is captured
in `Accounts-Setup-Guide.html`. Fill the **Guide ref** column with a section/figure number, or
mark `gap` if missing. Pure list/lookup endpoints used only as dropdown sources don't need a
dedicated figure — those get `N/A — internal lookup`.

**Exit criterion:** every user-facing endpoint has either a guide reference or a `gap` mark.

### Phase 4 — Fix gaps  *(code changes, gated)*

Process the gaps in this order, one batch per controller, committing after each batch:

1. **Field-name mismatches** — fix in JS (or backend if the JS shape is more correct), retest
   the affected page in Playwright, screenshot the working state.
2. **Orphan frontend calls** — point them at the right route, retest.
3. **Missing UIs for high-value endpoints** — build the UI (form + table + row actions),
   wire to API, test in Playwright. "High value" = anything in the user-visible domain
   (PurchaseOrders, ProformaInvoices, DebitNotes, ClientVendorRequests are the obvious
   candidates that exist in the backend without a dedicated frontend page today).
4. **Truly internal endpoints** — mark `N/A` with the reason. No work.

After each batch:
- bump `js/sw-version.js`
- mark every fixed row `✓ done` in this file
- commit with a message naming the controller batch
- **do not** push until the user asks (per their preferred local-first workflow)

**Exit criterion:** zero rows with status `gap`.

### Phase 5 — Guide refresh  *(content changes)*

For every row marked `gap` in the **Guide ref** column during Phase 3 (and every new UI built
in Phase 4), capture the flow in Playwright, save screenshots into `KnowledgeBase/Accounts/images/`,
and add prose + figures to the appropriate section of `Accounts-Setup-Guide.html`. Re-run the
guide's table of contents check.

**Exit criterion:** every user-facing endpoint has a guide reference; the guide's "Where to go
next" closing callout is updated to mention any new modules.

---

## Resume rules (if a Claude session crashes)

1. Read this file top-to-bottom.
2. Find the **Phase status table** below — that tells you which phase to resume.
3. Within that phase, find the first row with status `pending` or `in-progress`.
4. If you were mid-edit on a controller, finish that controller's table before starting a new one.
5. **Never re-do `✓ done` work.** Never delete rows. Only update statuses and fill columns.
6. If the file ever exceeds ~3000 lines, split per-controller tables into
   `_GAP_ANALYSIS_<controller>.md` and link from here. Don't truncate.

---

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1. Backend inventory | in-progress | 13 / 24 controllers walked. Done: Health, System, COA, Fiscal, Customers, Vendors, ClientVendorRequests, Bank, Journals, GL, Closing, Audit, Copilot. Remaining: Taxation, AR (CustomerInvoices), AP (VendorBills), Proforma, PO, DebitNotes, Expense, FixedAssets, Billing, Reports |
| 2. Frontend inventory | pending | depends on Phase 1 |
| 3. Guide coverage | pending | depends on Phase 2 |
| 4. Fix gaps | pending | gated on Phase 3 + user approval |
| 5. Guide refresh | pending | gated on Phase 4 |

---

## Controller list (Phase 1 checklist)

Walk in this order. Each controller gets a `### N. ControllerName` subsection below with its
endpoint table. Update the checkbox here as each table is filled in.

- [x] 1. `HealthController` (1 endpoint) — sanity check
- [x] 2. `SystemController` (6) — tenant settings, init, integrity
- [x] 3. `ChartOfAccountsController` (15) — accounts, groups, types
- [x] 4. `FiscalController` (8) — fiscal years, periods
- [ ] 5. `TaxationController` (19) — tax configs, rates, HSN/SAC, returns
- [x] 6. `CustomersController` (4) — customer master
- [x] 7. `VendorsController` (4) — vendor master
- [x] 8. `ClientVendorRequestsController` (6) — pending creates from CRM/Procurement
- [ ] 9. `CustomerInvoicesController` (13) — AR invoices
- [ ] 10. `VendorBillsController` (11) — AP bills
- [ ] 11. `ProformaInvoicesController` (9) — quotes/proforma
- [ ] 12. `PurchaseOrdersController` (10) — POs
- [ ] 13. `DebitNotesController` (4) — vendor debit notes
- [x] 14. `BankController` (15) — accounts, transactions, transfers, reconciliation
- [x] 15. `JournalsController` (5) — manual journal entries
- [x] 16. `GeneralLedgerController` (9) — GL listing, detail, reverse, lock
- [ ] 17. `ExpenseController` (12) — categories, policies, claims, reimbursement
- [ ] 18. `FixedAssetsController` (11) — categories, register, depreciation, disposal
- [ ] 19. `BillingController` (18) — plans, subscriptions, usage, tokens
- [ ] 20. `ReportsController` (10) — Trial Balance, P&L, BS, CF, aging, statements
- [x] 21. `ClosingController` (6) — closing checklists, year-end
- [x] 22. `AuditController` (4) — audit log
- [x] 23. `CopilotController` (4) — AI copilot bridge (probably N/A for end-user UI)
- [ ] 24. `BaseController` — abstract, no endpoints

---

## Audit table — schema

Each controller table uses this schema:

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|

Column meanings:

- **#** — sequential within controller
- **Verb** — GET/POST/PUT/DELETE/PATCH
- **Route** — full path including class `[Route]`
- **Method** — C# method name
- **Roles** — `[Authorize(Roles=...)]` value, or `Any` if just `[Authorize]`
- **Request fields** — DTO type + comma-separated field names; or `—` for parameterless
- **Response fields** — DTO type + comma-separated field names; or `void`
- **Frontend caller** — `js/accounts/<file>.js:<line>` or `none`
- **Field binding** — `ok` / `mismatch:<which>` / `n/a`
- **Guide ref** — `§X.Y Fig N` or `gap` or `N/A — lookup`
- **Status** — `pending` / `in-progress` / `✓` / `gap` / `N/A`

---

## Controller Audit Tables

> Phase 1 fills these in. Empty until then.

### 1. HealthController

Class route: `api/[controller]` → `/api/Health`. No `[Authorize]`.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/Health` | `Get` | Anonymous | — | anon `{ status, service, timestamp }` | TBD Phase 2 | TBD | N/A — health probe | pending |

### 2. SystemController

Class route: `api/accounts/system`. Class-level `[Authorize(Roles = "ACCOUNTS_ADMIN,SUPERADMIN")]`.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/accounts/system/encrypt-existing-data` | `EncryptExistingData` | ADMIN+ | — | anon `{ message, details }` (details = list of table results) | TBD | TBD | N/A — one-time admin migration | pending |
| 2 | POST | `/api/accounts/system/integrity-check` | `RunIntegrityCheck` | ADMIN+ | — | result of `BL.RunIntegrityChecks` (list of `{ check_type, status, details, ... }`) | TBD | TBD | §15.5.3 Fig 15.5.3 | pending |
| 3 | GET  | `/api/accounts/system/gl-summary` | `GetGlSummary` | ADMIN+ | — | result of `BL.GetGlSummary` | TBD | TBD | TBD | pending |
| 4 | POST | `/api/accounts/system/recompute-balances` | `RecomputeBalances` | SUPERADMIN | — | anon `{ message }` | TBD | TBD | N/A — recovery action | pending |
| 5 | GET  | `/api/accounts/system/integrity-check/results` | `GetIntegrityCheckResults` | ADMIN+ | query `limit` | **STUB** anon `{ message, tenant_id, limit }` — not actually querying `integrity_check_results` table | TBD | TBD | gap — backend stub | gap |
| 6 | GET  | `/api/accounts/system/job-log` | `GetJobLog` | ADMIN+ | query `jobType, limit` | **STUB** anon `{ message, tenant_id, limit }` — not actually returning rows | TBD | TBD | gap — backend stub (Fig 15.5.4 shows empty UI) | gap |

### 3. ChartOfAccountsController

Class route: `api/accounts/coa`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ACCOUNTS_ADMIN, ACCOUNTS_MANAGER, ACCOUNTS_AUDITOR, SUPERADMIN")]`. Method-level overrides noted per row.

DTO field reference (`Models/ChartOfAccountsModels.cs`):
- **AccountType** → `id, tenant_id, name, normal_balance, display_order, is_active, created_at`
- **AccountGroup** → `id, tenant_id, account_type_id, name, code, parent_group_id, description, display_order, is_active, created_by, created_at, updated_at, account_type_name`
- **Account** → `id, tenant_id, account_code, account_name, account_type_id, account_group_id, parent_account_id, description, normal_balance, is_active, is_system_account, allow_direct_posting, currency, current_balance, depth_level, hierarchy_path, created_by, created_at, updated_at, account_type_name, account_group_name, parent_account_name, children`
- **CreateAccountGroupRequest** → `account_type_id, name, code, parent_group_id, description, display_order`
- **UpdateAccountGroupRequest** → `id, name, description, display_order, is_active`
- **CreateAccountRequest** → `account_code, account_name, account_type_id, account_group_id, parent_account_id, description, allow_direct_posting, currency, normal_balance`
- **UpdateAccountRequest** → `id, account_name, description, account_group_id, is_active, allow_direct_posting`
- **SetOpeningBalanceRequest** → `account_id, amount, balance_type, as_of_date`
- **SetupTemplateRequest** → `country_code`
- **ImportAccountsRequest** → `accounts: ImportAccountRow[]`; **ImportAccountRow** → `account_code, account_name, account_type, account_group, parent_code, description, opening_balance, balance_type`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/coa/types` | `GetAccountTypes` | USER+ | — | `List<AccountType>` | TBD | TBD | §4.3 Fig 4.4 | pending |
| 2 | GET    | `/api/accounts/coa/groups` | `GetAccountGroups` | USER+ | query `accountTypeId?` | `List<AccountGroup>` | TBD | TBD | §4.3 (groups subsection) | pending |
| 3 | POST   | `/api/accounts/coa/groups` | `CreateAccountGroup` | ADMIN+ | `CreateAccountGroupRequest` | `AccountGroup` (fresh-fetched) | TBD | TBD | §4.3 Fig 4.5–4.8 | pending |
| 4 | PUT    | `/api/accounts/coa/groups/{id}` | `UpdateAccountGroup` | ADMIN+ | route `id` + `UpdateAccountGroupRequest` (id auto-set from route) | `AccountGroup` | TBD | TBD | §4.3 Fig 4.3c | pending |
| 5 | DELETE | `/api/accounts/coa/groups/{id}` | `DeleteAccountGroup` | ADMIN+ | route `id` | 204 | TBD | TBD | §4.3 Fig 4.3d/g/h | pending |
| 6 | GET    | `/api/accounts/coa` | `GetAccounts` | USER+ | query `accountTypeId?, accountGroupId?, isActive?, search?` | `List<Account>` | TBD | TBD | §4.4 Fig 4.19 | pending |
| 7 | GET    | `/api/accounts/coa/tree` | `GetAccountTree` | USER+ | — | `List<Account>` (with `children`) | TBD | TBD | §4.4 Fig 4.17/4.20 | pending |
| 8 | GET    | `/api/accounts/coa/{id}` | `GetAccountById` | USER+ | route `id` | `Account` or 404 | TBD | TBD | §4.4 Fig 4.19c | pending |
| 9 | POST   | `/api/accounts/coa` | `CreateAccount` | ADMIN+ | `CreateAccountRequest` | `Account` (fresh-fetched) | TBD | TBD | §4.4 Fig 4.10–4.16 | pending |
| 10 | PUT   | `/api/accounts/coa/{id}` | `UpdateAccount` | ADMIN+ | route `id` + `UpdateAccountRequest` (id auto-set) | `Account` | TBD | TBD | §4.4 Fig 4.19d | pending |
| 11 | DELETE| `/api/accounts/coa/{id}` | `DeactivateAccount` | ADMIN+ | route `id` | 204 | TBD | TBD | §4.4 Fig 4.19e/f/g | pending |
| 12 | POST  | `/api/accounts/coa/opening-balances` | `SetOpeningBalance` | ADMIN+ | `SetOpeningBalanceRequest` | anon `{ message }` | TBD | TBD | §4.5 Fig 4.21 | pending |
| 13 | GET   | `/api/accounts/coa/balances` | `GetAccountBalances` | USER+ | query `fiscalYearId, periodId?` | `List<AccountPeriodBalance>` | TBD | TBD | TBD | pending |
| 14 | POST  | `/api/accounts/coa/setup-template` | `SetupTemplate` | ADMIN+ | `SetupTemplateRequest` | anon `{ message, account_types, accounts }` | TBD | TBD | §4.2 Fig 4.1 | pending |
| 15 | POST  | `/api/accounts/coa/import` | `ImportAccounts` | ADMIN+ | `ImportAccountsRequest` | **STUB** anon `{ message, rows_received }` — implementation deferred to S15 sprint | TBD | TBD | gap — backend stub | gap |

### 4. FiscalController

Class route: `api/accounts/fiscal`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ACCOUNTS_ADMIN, ACCOUNTS_MANAGER, ACCOUNTS_AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/FiscalModels.cs`):
- **FiscalYear** → `id, tenant_id, name, start_date, end_date, is_active, is_closed, closed_by, closed_at, created_by, created_at, periods`
- **FiscalPeriod** → `id, tenant_id, fiscal_year_id, name, period_number, start_date, end_date, is_open, is_locked, locked_by, locked_at, created_at`
- **CreateFiscalYearRequest** → `name, start_date, end_date`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/fiscal/years` | `GetFiscalYears` | USER+ | — | `List<FiscalYear>` | TBD | TBD | §5.1 Fig 5.1 / §4 Fig 4.22 | pending |
| 2 | GET  | `/api/accounts/fiscal/years/active` | `GetActiveFiscalYear` | USER+ | — | `FiscalYear` or 404 | TBD | TBD | TBD — internal lookup | pending |
| 3 | GET  | `/api/accounts/fiscal/years/{id}` | `GetFiscalYearById` | USER+ | route `id` | `FiscalYear` or 404 | TBD | TBD | §4 Fig 4.22b | pending |
| 4 | POST | `/api/accounts/fiscal/years` | `CreateFiscalYear` | ADMIN+ | `CreateFiscalYearRequest` | `FiscalYear` (fresh-fetched) | TBD | TBD | §5.1 Fig 5.2/5.3/5.4 | pending |
| 5 | GET  | `/api/accounts/fiscal/periods` | `GetFiscalPeriods` | USER+ | query `fiscalYearId` (Empty → falls back to active) | `List<FiscalPeriod>` | TBD | TBD | §5.2 Fig 5.5 | pending |
| 6 | POST | `/api/accounts/fiscal/periods/{id}/lock` | `LockPeriod` | ADMIN+ | route `id` | anon `{ message }` | TBD | TBD | §5.3 Fig 5.6/5.7 | pending |
| 7 | POST | `/api/accounts/fiscal/periods/{id}/unlock` | `UnlockPeriod` | ADMIN+ | route `id` | anon `{ message }` | TBD | TBD | §5.4 Fig 5.8 | pending |
| 8 | POST | `/api/accounts/fiscal/years/{id}/close` | `CloseFiscalYear` | ADMIN+ | route `id` | anon `{ message }` | TBD | TBD | §15.5.6 Fig 15.5.6 | pending |

### 5. TaxationController
*pending*

### 6. CustomersController

Class route: `api/accounts/customers`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AccountsReceivableModels.cs`):
- **Customer** → `id, tenant_id, customer_code, name, display_name, email, phone, billing_address_line1, billing_address_line2, city, state, state_code, country, postal_code, tax_id, payment_terms_days, default_account_id, notes, is_active, industry, website, tags, custom_fields, owner_user_id, source_service, contact_person, bank_name, bank_account_number, bank_ifsc, bank_swift, gst_number, pan_number, credit_limit, created_by, created_at, updated_at`
- **CreateCustomerRequest** → same shape as Customer minus system fields (no id/tenant_id/source_service/created_by/created_at/updated_at; `is_active` excluded)
- **UpdateCustomerRequest** → all fields above as nullable, plus `id` (auto-set from route)

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/customers` | `Get` | USER+ | query `search?, isActive?` | `List<Customer>` | TBD | TBD | §7 Fig 7.1 / §8 | pending |
| 2 | GET  | `/api/accounts/customers/{id}` | `GetById` | USER+ | route `id` | `Customer` or 404 | TBD | TBD | TBD | pending |
| 3 | POST | `/api/accounts/customers` | `Create` | USER+ (no override) | `CreateCustomerRequest` | `Customer` (fresh-fetched) | TBD | TBD | §7 Fig 7.5/7.6 | pending |
| 4 | PUT  | `/api/accounts/customers/{id}` | `Update` | USER+ | route `id` + `UpdateCustomerRequest` | `Customer` | TBD | TBD | §7 Fig 7.6 | pending |

### 7. VendorsController

Class route: `api/accounts/vendors`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AccountsPayableModels.cs`):
- **Vendor** → `id, tenant_id, vendor_code, name, display_name, email, phone, address_line1, address_line2, city, state, state_code, country, postal_code, tax_id, payment_terms_days, default_account_id, bank_name, bank_account_number, bank_ifsc, bank_swift, website, gst_number, pan_number, industry, tags, custom_fields, source_service, contact_person, credit_limit, notes, is_active, created_by, created_at, updated_at`
- **CreateVendorRequest** → same shape minus system fields (no id/tenant_id/source_service/created_by/timestamps; `is_active` excluded)
- **UpdateVendorRequest** → all fields nullable plus `id` (auto-set from route)

> **Field naming gap to track in Phase 2:** Vendor uses `address_line1/2`, Customer uses `billing_address_line1/2`. The frontend Parties page needs different field names for each side — easy place for a binding bug.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/vendors` | `GetVendors` | USER+ | query `search?, isActive?` | `List<Vendor>` | TBD | TBD | §7 Fig 7.1 | pending |
| 2 | GET  | `/api/accounts/vendors/{id}` | `GetVendorById` | USER+ | route `id` | `Vendor` or 404 | TBD | TBD | TBD | pending |
| 3 | POST | `/api/accounts/vendors` | `CreateVendor` | USER+ | `CreateVendorRequest` | `Vendor` (fresh-fetched) | TBD | TBD | §7 Fig 7.2/7.3/7.4 | pending |
| 4 | PUT  | `/api/accounts/vendors/{id}` | `UpdateVendor` | USER+ | route `id` + `UpdateVendorRequest` | `Vendor` | TBD | TBD | TBD | pending |

### 8. ClientVendorRequestsController

Class route: `api/accounts/requests`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`. Review endpoint elevated to ADMIN+.

DTO field reference (`Models/ClientVendorRequestModels.cs`):
- **ClientVendorRequest** → `id, tenant_id, request_type, status, requested_by, requested_by_name, requested_from_service, name, code, display_name, email, phone, tax_id, address_line1, address_line2, city, state, state_code, country, postal_code, industry, website, payment_terms_days, gst_number, pan_number, bank_name, bank_account_number, bank_ifsc, bank_swift, contact_person, credit_limit, notes, request_reason, tags, custom_fields, reviewed_by, reviewed_by_name, reviewed_at, rejection_reason, created_customer_id, created_vendor_id, sla_deadline, sla_breached, auto_approved, reminder_24h_sent, reminder_8h_sent, created_at, updated_at`
- **SubmitClientVendorRequest** → `request_type, name, code, email, phone, tax_id, address_line1, city, state, country, industry, website, payment_terms_days, gst_number, pan_number, request_reason, notes, bank_name, bank_account_number, bank_ifsc, contact_person, credit_limit`
- **ReviewRequestAction** → `action ('approve'|'reject'), rejection_reason, name, code, email, phone, tax_id, address_line1, city, state, country, payment_terms_days, bank_name, bank_account_number, bank_ifsc`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/accounts/requests` | `Submit` | USER+ | `SubmitClientVendorRequest` | `ClientVendorRequest` | TBD | TBD | gap — likely no UI in Accounts module (CRM/Procurement submit) | gap |
| 2 | GET  | `/api/accounts/requests` | `Get` | USER+ | query `type?, status?, limit, offset` | anon `{ items: List<ClientVendorRequest>, total }` | TBD | TBD | gap — no UI today (only `07J-1/2-pending-vendors/customers-empty.png` exist as orphan captures) | gap |
| 3 | GET  | `/api/accounts/requests/{id}` | `GetById` | USER+ | route `id` | `ClientVendorRequest` or 404 | TBD | TBD | gap | gap |
| 4 | GET  | `/api/accounts/requests/pending-count` | `GetPendingCount` | USER+ | — | dict `{ client: N, vendor: N }` (whatever `BL.GetPendingCountByType` returns) | TBD | TBD | TBD — would feed Parties page badge | pending |
| 5 | GET  | `/api/accounts/requests/sla-report` | `GetSlaReport` | ADMIN/MANAGER+ | — | SLA report shape from `BL.GetSlaReportAsync` | TBD | TBD | gap — no UI | gap |
| 6 | POST | `/api/accounts/requests/{id}/review` | `Review` | ADMIN+ | route `id` + `ReviewRequestAction` | review result from `BL.ReviewRequest` | TBD | TBD | gap — no UI | gap |

### 9. CustomerInvoicesController
*pending*

### 10. VendorBillsController
*pending*

### 11. ProformaInvoicesController
*pending*

### 12. PurchaseOrdersController
*pending*

### 13. DebitNotesController
*pending*

### 14. BankController

Class route: `api/accounts/bank`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`. Razorpay/Stripe webhooks are `[AllowAnonymous]` and rely on signature verification.

DTO field reference (`Models/BankModels.cs`):
- **BankAccount** → `id, tenant_id, account_name, account_type, bank_name, account_number, ifsc_code, swift_code, branch, gl_account_id, current_balance, is_default, is_active, created_by, created_at, updated_at, gl_account_code, gl_account_name`
- **BankTransaction** → `id, tenant_id, bank_account_id, transaction_date, transaction_type, amount, reference_number, description, party_name, gl_entry_id, is_reconciled, reconciliation_id, source_type, source_id, created_by, created_at`
- **BankReconciliation** → `id, tenant_id, bank_account_id, statement_date, statement_balance, book_balance, difference, status, completed_by, completed_at, created_by, created_at`
- **BankTransfer** → `id, transfer_date, from_account_id, from_account_name, to_account_id, to_account_name, amount, description, status`
- **BankDashboardSummary** → `total_bank_balance, total_cash_balance, accounts: List<BankAccount>`
- **CreateBankAccountRequest** → `account_name, account_type, bank_name, account_number, ifsc_code, swift_code, branch, gl_account_id, is_default`
- **UpdateBankAccountBody** (nested in controller) → `account_name, bank_name, account_number, account_type, ifsc_code, swift_code, branch, gl_account_id, is_default, is_active`
- **RecordBankTransactionRequest** → `transaction_date, transaction_type, amount, reference_number, description, party_name, counter_account_id`
- **InterBankTransferRequest** → `from_bank_account_id, to_bank_account_id, amount, transfer_date, reference_number, description`
- **StartReconciliationRequest** → `bank_account_id, statement_date, statement_balance`
- **MatchTransactionsRequest** → `transaction_ids: Guid[]`

> ⚠️ **Likely binding gap (Phase 2 priority):** `RecordBankTransactionRequest.transaction_type` declares `AllowedValues = { "debit", "credit" }`, but the frontend's recent fix reduced the dropdown to 4 manual types: **Deposit / Withdrawal / Interest / Charges**. Need to check whether the BL maps those four to debit/credit or whether the frontend translates them — if neither does, every manual transaction is currently breaking schema validation. Verify in Phase 2 against `BusinessLayer_Bank.cs`.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/bank/accounts` | `GetBankAccounts` | USER+ | query `includeInactive` | `List<BankAccount>` | TBD | TBD | §15.1 Fig 15.1.1/4/5 | pending |
| 2 | GET    | `/api/accounts/bank/accounts/{id}` | `GetBankAccountById` | USER+ | route `id` | `BankAccount` or 404 | TBD | TBD | §15.1 Fig 15.1.6 (view modal) | pending |
| 3 | POST   | `/api/accounts/bank/accounts` | `CreateBankAccount` | ADMIN+ | `CreateBankAccountRequest` | `BankAccount` (fresh-fetched) | TBD | TBD | §15.1 Fig 15.1.2/3 | pending |
| 4 | PUT    | `/api/accounts/bank/accounts/{id}` | `UpdateBankAccount` | ADMIN+ | route `id` + `UpdateBankAccountBody` | `BankAccount` | TBD | TBD | §15.1 Fig 15.1.7 (edit prefilled) + Fig 15.1.8/9/10/11 (deactivate/reactivate via `is_active`) | pending |
| 5 | GET    | `/api/accounts/bank/accounts/{id}/transactions` | `GetTransactions` | USER+ | route `id` + query `fromDate?, toDate?, search?, limit, offset` | `List<BankTransaction>` | TBD | TBD | §15.1 Fig 15.1.12–17 | pending |
| 6 | POST   | `/api/accounts/bank/accounts/{id}/transactions` | `RecordTransaction` | ADMIN/MANAGER+ | route `id` + `RecordBankTransactionRequest` | 201 + result of `BL.RecordManualTransaction` | TBD | **likely mismatch — see warning** | §15.1 Fig 15.1.16–19, 15.1.21a/b | gap |
| 7 | DELETE | `/api/accounts/bank/accounts/{bankAccountId}/transactions/{transactionId}` | `DeleteTransaction` | ADMIN+ | two route params | anon `{ message }` | TBD | TBD | §15.1 Fig 15.1.21 | pending |
| 8 | GET    | `/api/accounts/bank/transfer` | `GetRecentTransfers` | USER+ | query `limit` | `List<BankTransfer>` | TBD | TBD | §15.1 Fig 15.1.25 (recent transfers table) | pending |
| 9 | POST   | `/api/accounts/bank/transfer` | `InterBankTransfer` | ADMIN/MANAGER+ | `InterBankTransferRequest` | anon `{ message }` | TBD | TBD | §15.1 Fig 15.1.22–25 | pending |
| 10 | POST  | `/api/accounts/bank/reconciliations` | `StartReconciliation` | ADMIN/MANAGER+ | `StartReconciliationRequest` | 201 + reconciliation result | TBD | TBD | §15.1 Fig 15.1.26/27/28 | pending |
| 11 | PUT   | `/api/accounts/bank/reconciliations/{id}` | `MatchTransactions` | ADMIN/MANAGER+ | route `id` + `MatchTransactionsRequest` | anon `{ message }` | TBD | TBD | §15.1 Fig 15.1.29 | pending |
| 12 | POST  | `/api/accounts/bank/reconciliations/{id}/complete` | `CompleteReconciliation` | ADMIN/MANAGER+ | route `id` | anon `{ message }` | TBD | TBD | §15.1 Fig 15.1.30/31 | pending |
| 13 | GET   | `/api/accounts/bank/dashboard` | `GetDashboard` | USER+ | — | `BankDashboardSummary` | TBD | TBD | §15.1 stats tiles + Dashboard §3.6 | pending |
| 14 | POST  | `/api/accounts/bank/webhooks/razorpay` | `RazorpayWebhook` | Anonymous + signature | raw JSON Razorpay webhook | anon `{ status, payment_id, amount, event_type }` | N/A — external | n/a | N/A — payment gateway webhook | N/A |
| 15 | POST  | `/api/accounts/bank/webhooks/stripe` | `StripeWebhook` | Anonymous + signature | raw JSON Stripe webhook | anon `{ status }` | N/A — external | n/a | N/A — payment gateway webhook (also a backend stub: signature verification not yet wired) | gap |

### 15. JournalsController

Class route: `api/accounts/journals`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/JournalModels.cs`):
- **JournalType** → `id, tenant_id, code, name, description, is_system, is_active, created_at`
- **CreateJournalTypeRequest** → `code, name, description`
- **UpdateJournalTypeRequest** → `id, name, description, is_active`

> Note: `entries` listing endpoint actually delegates to `BL.QueryGlEntries` (same path as the GL Entries listing in `GeneralLedgerController`). The Frontend Ledger page surfaces this on the Journal Entries tab — see §12.3.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/journals/types` | `GetJournalTypes` | USER+ | — | `List<JournalType>` | TBD | TBD | §4 Fig 4.18/4.24 | pending |
| 2 | GET  | `/api/accounts/journals/types/{id}` | `GetJournalTypeById` | USER+ | route `id` | `JournalType` or 404 | TBD | TBD | TBD — internal lookup | pending |
| 3 | POST | `/api/accounts/journals/types` | `CreateJournalType` | ADMIN+ | `CreateJournalTypeRequest` | `JournalType` (fresh-fetched) | TBD | TBD | §4 Fig 4.24a | pending |
| 4 | PUT  | `/api/accounts/journals/types/{id}` | `UpdateJournalType` | ADMIN+ | route `id` + `UpdateJournalTypeRequest` | `JournalType` | TBD | TBD | TBD | pending |
| 5 | GET  | `/api/accounts/journals/entries` | `GetJournalEntries` | USER+ | query `journalTypeId?, fromDate?, toDate?, search?, limit, offset` (mapped into `GlQueryRequest`) | anon `{ data: List<GlEntry>, total, limit, offset }` | TBD | TBD | §12.3 Fig 12.3a | pending |

### 16. GeneralLedgerController

Class route: `api/accounts/gl`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/GeneralLedgerModels.cs`):
- **GlEntry** → `id, tenant_id, entry_number, idempotency_key, entry_date, fiscal_year_id, fiscal_period_id, journal_type_id, description, reference_type, reference_id, total_debit, total_credit, status, is_auto_generated, is_reversed, reversal_of, reversed_by, locked_by, locked_at, posted_by, posted_at, created_by, created_at, updated_at, lines, journal_type_name, posted_by_name`
- **GlEntryLine** → `id, gl_entry_id, tenant_id, account_id, description, debit_amount, credit_amount, cost_center, created_at, account_code, account_name`
- **CreateGlEntryRequest** → `idempotency_key, entry_date, journal_type_id, description, reference_type, reference_id, lines: CreateGlEntryLineRequest[]`
- **CreateGlEntryLineRequest** → `account_id, description, debit_amount, credit_amount, cost_center`
- **ReverseGlEntryRequest** → `reversal_date, reason`
- **GlQueryRequest** → `from_date, to_date, account_id, journal_type_id, status, reference_type, search, limit, offset`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/gl` | `QueryGlEntries` | USER+ | query (8 params, mapped to `GlQueryRequest`) | anon `{ data: List<GlEntry>, total, limit, offset }` | TBD | TBD | §12.1 / §12.1a Fig 12.1/12.1a | pending |
| 2 | GET    | `/api/accounts/gl/{id}` | `GetGlEntryById` | USER+ | route `id` | `GlEntry` (with lines) or 404 | TBD | TBD | §12.2 / §15.1.17a Fig 12.2 / 15.1.17a | pending |
| 3 | POST   | `/api/accounts/gl` | `CreateGlEntry` | ADMIN/MANAGER+ | `CreateGlEntryRequest` | `GlEntry` | TBD | TBD | gap — manual JE form not in guide; do users actually create manual JEs from the UI? Verify Phase 2 | pending |
| 4 | PUT    | `/api/accounts/gl/{id}` | `UpdateDraftGlEntry` | ADMIN/MANAGER+ | route `id` + `CreateGlEntryRequest` | `GlEntry` or 404 | TBD | TBD | gap — same as above | pending |
| 5 | DELETE | `/api/accounts/gl/{id}` | `DeleteDraftGlEntry` | ADMIN+ | route `id` | 204 | TBD | TBD | TBD | pending |
| 6 | POST   | `/api/accounts/gl/{id}/lock` | `LockDraftEntry` | ADMIN/MANAGER+ | route `id` | anon `{ message }` | TBD | TBD | §12.3 (Lock action button) | pending |
| 7 | POST   | `/api/accounts/gl/{id}/unlock` | `UnlockDraftEntry` | ADMIN/MANAGER+ | route `id` | anon `{ message }` | TBD | TBD | TBD | pending |
| 8 | POST   | `/api/accounts/gl/{id}/post` | `PostGlEntry` | ADMIN+ | route `id` | `GlEntry` | TBD | TBD | §12.3 (Post action button) | pending |
| 9 | POST   | `/api/accounts/gl/{id}/reverse` | `ReverseGlEntry` | ADMIN+ | route `id` + `ReverseGlEntryRequest` | reversal `GlEntry` | TBD | TBD | §12.3 Fig 12.3b | pending |

### 17. ExpenseController
*pending*

### 18. FixedAssetsController
*pending*

### 19. BillingController
*pending*

### 20. ReportsController
*pending*

### 21. ClosingController

Class route: `api/accounts/closing`. Class-level `[Authorize(Roles = "ACCOUNTS_ADMIN, SUPERADMIN")]`.

DTO field reference (`Models/ClosingModels.cs`):
- **ClosingChecklist** → `id, tenant_id, fiscal_period_id, closing_type, status, started_by, started_at, completed_by, completed_at, created_at, period_name, items`
- **ClosingChecklistItem** → `id, closing_checklist_id, tenant_id, step_number, category, description, is_completed, is_auto_check, completed_by, completed_at, notes, created_at`
- **StartClosingRequest** → `fiscal_period_id, closing_type ('month_end'|'quarter_end'|'year_end')`
- **CompleteItemRequest** → `notes`

> Note: `year-end/{fiscalYearId}` is a thin wrapper around `BL.CloseFiscalYear` — same logic as `FiscalController.CloseFiscalYear` (row 8) reached via a different route. **Functional duplicate** — flag for Phase 4 dedup.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/closing/checklists` | `GetChecklists` | ADMIN+ | query `fiscalYearId?` | `List<ClosingChecklist>` | TBD | TBD | §15.5.5 Fig 15.5.5 | pending |
| 2 | POST | `/api/accounts/closing/checklists` | `StartChecklist` | ADMIN+ | `StartClosingRequest` | 201 + checklist | TBD | TBD | §15.5.5 Fig 15.5.5a | pending |
| 3 | GET  | `/api/accounts/closing/checklists/{id}` | `GetChecklistById` | ADMIN+ | route `id` | `ClosingChecklist` (with items) | TBD | TBD | §15.5.5 Fig 15.5.5b | pending |
| 4 | POST | `/api/accounts/closing/checklists/{id}/items/{itemId}/complete` | `CompleteItem` | ADMIN+ | two route params + `CompleteItemRequest?` | anon `{ message }` | TBD | TBD | §15.5.5 Fig 15.5.5b | pending |
| 5 | POST | `/api/accounts/closing/checklists/{id}/complete` | `CompleteClosing` | ADMIN+ | route `id` | result of `BL.CompleteClosing` | TBD | TBD | TBD | pending |
| 6 | POST | `/api/accounts/closing/year-end/{fiscalYearId}` | `YearEndClosing` | ADMIN+ | route `fiscalYearId` | anon `{ message, fiscal_year_id }` | TBD | TBD | §15.5.6 Fig 15.5.6/15.5.6a — duplicates `FiscalController.CloseFiscalYear` | pending |

### 22. AuditController

Class route: `api/accounts/audit`. Class-level `[Authorize(Roles = "ACCOUNTS_ADMIN, ACCOUNTS_AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AuditModels.cs`):
- **AuditLog** → `id, tenant_id, entity_type, entity_id, action, performed_by, details, ip_address, created_at, performed_by_name`
- **AuditLogQuery** → `entity_type, entity_id, performed_by, from_date, to_date, limit, offset`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/audit/logs` | `GetAuditLogs` | ADMIN/AUDITOR+ | query (7 params, mapped to `AuditLogQuery`) | anon `{ data: List<AuditLog>, total, limit, offset }` | TBD | TBD | §15.5.1 Fig 15.5.1 / 15.5.1a / 15.5.1b | pending |
| 2 | GET  | `/api/accounts/audit/logs/{entityType}/{entityId}` | `GetEntityAuditTrail` | ADMIN/AUDITOR+ | two route params + query `limit` | `List<AuditLog>` | TBD | TBD | TBD — drill-down trail used by entity-audit modal | pending |
| 3 | GET  | `/api/accounts/audit/approvals/pending` | `GetPendingApprovals` | ADMIN/AUDITOR+ | — | anon `{ expense_claims: [...], total_pending }` (currently only surfaces pending **expense claims**, not all approval-gated items) | TBD | partial — only one entity type | §15.5.2 Fig 15.5.2 | gap |
| 4 | POST | `/api/accounts/audit/export` | `ExportAuditLogs` | ADMIN/AUDITOR+ | query `fromDate?, toDate?` | anon `{ export_format: "json", record_count, data }` (PDF/CSV deferred to "Phase 2") | TBD | TBD | gap — export claims JSON, no real CSV/PDF | gap |

### 23. CopilotController

Class route: `api/copilot` (note: NOT under `/api/accounts/...` — sits at the root). Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`. Bridges to AIEngine via gRPC.

DTO field reference (in-controller `CopilotMessageRequest`): `Message, CurrentPage`.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | POST   | `/api/copilot/message` | `SendMessage` | USER+ | `CopilotMessageRequest` (Message, CurrentPage) | **SSE stream** with events `progress`, `chunk`, `response`, `error`, `done`; final `response` payload includes `session_id, response, tool_calls_json, input_tokens, output_tokens, requires_confirmation, pending_tool_name, pending_preview` | `js/copilot/*` (cross-service shared component, not in `js/accounts/`) | n/a | N/A — copilot bridge | N/A |
| 2 | GET    | `/api/copilot/session` | `GetSession` | USER+ | — | anon `{ session_id, message_count, setup_completed, created_at }` | shared copilot UI | n/a | N/A — copilot bridge | N/A |
| 3 | GET    | `/api/copilot/history` | `GetHistory` | USER+ | query `limit` | anon `{ session_id, messages: [{id, role, content, tool_calls, created_at}] }` | shared copilot UI | n/a | N/A — copilot bridge | N/A |
| 4 | DELETE | `/api/copilot/session` | `ClearSession` | USER+ | — | anon `{ message }` | shared copilot UI | n/a | N/A — copilot bridge | N/A |

---

## Orphan frontend calls

> Frontend `api.*` calls that don't match any backend route. Filled during Phase 2.

*pending*

---

## Gap summary

> Auto-built at the end of Phase 3. Counts of `gap` rows by controller and by category
> (mismatch / missing-UI / missing-guide). Don't fill by hand — generate from the tables above.

*pending*

---

## Decisions log

> Anything we deliberately marked `N/A` or deferred. One line each, with the reason. So a future
> session doesn't relitigate.

*(empty)*
