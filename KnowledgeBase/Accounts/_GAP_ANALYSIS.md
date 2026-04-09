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
| 1. Backend inventory | ✓ done | All 23 controllers walked. 204 endpoints captured. |
| 2. Frontend inventory | ✓ done | All 14 JS modules walked, 218 `api.*` calls joined. 10 orphan calls + ~28 binding/payload bugs flagged. |
| 3. Guide coverage | pending | many rows already have `Guide ref` filled inline during Phase 1. Remaining work: walk `gap` rows + verify the figures the guide claims actually correspond to working flows (e.g. Year-End preflight is fictional — Fig 15.5.6a is documenting a non-functional UI). |
| 4. Fix gaps | in-progress | **Tier 1 complete (5/5):** payment allocations (AR+AP), Save&Approve (AR+AP), Year-End preflight, dashboard pending approvals badge. Each verified end-to-end via Playwright with two-step proof. SW bumped 874→880. |
| 5. Guide refresh | pending | gated on Phase 4 |

---

## Controller list (Phase 1 checklist)

Walk in this order. Each controller gets a `### N. ControllerName` subsection below with its
endpoint table. Update the checkbox here as each table is filled in.

- [x] 1. `HealthController` (1 endpoint) — sanity check
- [x] 2. `SystemController` (6) — tenant settings, init, integrity
- [x] 3. `ChartOfAccountsController` (15) — accounts, groups, types
- [x] 4. `FiscalController` (8) — fiscal years, periods
- [x] 5. `TaxationController` (19) — tax configs, rates, HSN/SAC, returns
- [x] 6. `CustomersController` (4) — customer master
- [x] 7. `VendorsController` (4) — vendor master
- [x] 8. `ClientVendorRequestsController` (6) — pending creates from CRM/Procurement
- [x] 9. `CustomerInvoicesController` (13) — AR invoices
- [x] 10. `VendorBillsController` (11) — AP bills
- [x] 11. `ProformaInvoicesController` (9) — quotes/proforma
- [x] 12. `PurchaseOrdersController` (10) — POs
- [x] 13. `DebitNotesController` (4) — vendor debit notes
- [x] 14. `BankController` (15) — accounts, transactions, transfers, reconciliation
- [x] 15. `JournalsController` (5) — manual journal entries
- [x] 16. `GeneralLedgerController` (9) — GL listing, detail, reverse, lock
- [x] 17. `ExpenseController` (12) — categories, policies, claims, reimbursement
- [x] 18. `FixedAssetsController` (11) — categories, register, depreciation, disposal
- [x] 19. `BillingController` (18) — plans, subscriptions, usage, tokens
- [x] 20. `ReportsController` (10) — Trial Balance, P&L, BS, CF, aging, statements
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
| 1 | POST | `/api/accounts/system/encrypt-existing-data` | `EncryptExistingData` | ADMIN+ | — | anon `{ message, details }` (details = list of table results) | none in `js/accounts/` | n/a | N/A — one-time admin migration | N/A |
| 2 | POST | `/api/accounts/system/integrity-check` | `RunIntegrityCheck` | ADMIN+ | — | result of `BL.RunIntegrityChecks` | `admin.js:463 runIntegrityCheck` | ok | §15.5.3 Fig 15.5.3 | pending |
| 3 | GET  | `/api/accounts/system/gl-summary` | `GetGlSummary` | ADMIN+ | — | result of `BL.GetGlSummary` | `dashboard.js:42 loadGLSummary` | reads `by_type_and_status[]` with `entry_count, status, total_debit, total_credit` (verify BL shape in Phase 4) | §3.6 / dashboard tiles | pending |
| 4 | POST | `/api/accounts/system/recompute-balances` | `RecomputeBalances` | SUPERADMIN | — | anon `{ message }` | `admin.js:549 recomputeBalances` | ok | N/A — recovery action | pending |
| 5 | GET  | `/api/accounts/system/integrity-check/results` | `GetIntegrityCheckResults` | ADMIN+ | query `limit` | **STUB** anon `{ message, tenant_id, limit }` | `admin.js:511 loadIntegrityCheckResults` | calling a backend stub — shows nothing useful no matter what | gap — backend stub | gap |
| 6 | GET  | `/api/accounts/system/job-log` | `GetJobLog` | ADMIN+ | query `jobType, limit` | **STUB** anon `{ message, tenant_id, limit }` | `admin.js:568 loadJobLog` | calling a backend stub — Fig 15.5.4 shows empty UI for that exact reason | gap — backend stub | gap |

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
| 1 | GET    | `/api/accounts/coa/types` | `GetAccountTypes` | USER+ | — | `List<AccountType>` | `setup.js:154 loadAccountTypes` | ok | §4.3 Fig 4.4 | pending |
| 2 | GET    | `/api/accounts/coa/groups` | `GetAccountGroups` | USER+ | query `accountTypeId?` | `List<AccountGroup>` | `setup.js:191 loadAccountGroups` | ok | §4.3 (groups subsection) | pending |
| 3 | POST   | `/api/accounts/coa/groups` | `CreateAccountGroup` | ADMIN+ | `CreateAccountGroupRequest` | `AccountGroup` (fresh-fetched) | `setup.js:277 saveAccountGroup` (no id) | ok — sends `name, account_type_id, code, parent_group_id, description` (no `display_order`) | §4.3 Fig 4.5–4.8 | pending |
| 4 | PUT    | `/api/accounts/coa/groups/{id}` | `UpdateAccountGroup` | ADMIN+ | route `id` + `UpdateAccountGroupRequest` (id auto-set from route) | `AccountGroup` | `setup.js:277 saveAccountGroup` (id branch) | ⚠️ sends full create payload `{name, account_type_id, code, parent_group_id, description}` but UpdateAccountGroupRequest only accepts `name, description, display_order, is_active` — `account_type_id, code, parent_group_id` are silently dropped server-side. Functional but **edits to type/code/parent are no-ops** | §4.3 Fig 4.3c | gap |
| 5 | DELETE | `/api/accounts/coa/groups/{id}` | `DeleteAccountGroup` | ADMIN+ | route `id` | 204 | `setup.js:308 deleteGroup` | ok | §4.3 Fig 4.3d/g/h | pending |
| 6 | GET    | `/api/accounts/coa` | `GetAccounts` | USER+ | query `accountTypeId?, accountGroupId?, isActive?, search?` | `List<Account>` | `setup.js:342 loadAccounts` + `setup.js:779` (opening balances) | dead-params: sends `page, pageSize` which backend ignores (no pagination on backend) — frontend "pagination" is fake, just renders all rows; pageSize=500 in opening-balance fetch silently capped server-side to whatever the BL returns | §4.4 Fig 4.19 | gap |
| 7 | GET    | `/api/accounts/coa/tree` | `GetAccountTree` | USER+ | — | `List<Account>` (with `children`) | `setup.js:649 loadAccountTree` | ok | §4.4 Fig 4.17/4.20 | pending |
| 8 | GET    | `/api/accounts/coa/{id}` | `GetAccountById` | USER+ | route `id` | `Account` or 404 | `setup.js:535 viewAccountDetail` | ok — reads `account_code, account_name, account_type_id, account_group_id, parent_account_id, normal_balance, description, is_active, current_balance, allow_direct_posting` | §4.4 Fig 4.19c | pending |
| 9 | POST   | `/api/accounts/coa` | `CreateAccount` | ADMIN+ | `CreateAccountRequest` | `Account` (fresh-fetched) | `setup.js:468 saveAccount` (no id) | ok — sends `account_code, account_name, account_type_id, account_group_id, parent_account_id, normal_balance, description, allow_direct_posting` (no `currency` — backend defaults to INR) | §4.4 Fig 4.10–4.16 | pending |
| 10 | PUT   | `/api/accounts/coa/{id}` | `UpdateAccount` | ADMIN+ | route `id` + `UpdateAccountRequest` (id auto-set) | `Account` | `setup.js:468 saveAccount` (id branch) | ⚠️ sends full create payload but UpdateAccountRequest only accepts `id, account_name, description, account_group_id, is_active, allow_direct_posting`; `account_code, account_type_id, parent_account_id, normal_balance` are silently dropped — **edits to those four fields are no-ops** | §4.4 Fig 4.19d | gap |
| 11 | DELETE| `/api/accounts/coa/{id}` | `DeactivateAccount` | ADMIN+ | route `id` | 204 | `setup.js:513 deactivateAccount` | ok | §4.4 Fig 4.19e/f/g | pending |
| 12 | POST  | `/api/accounts/coa/opening-balances` | `SetOpeningBalance` | ADMIN+ | `SetOpeningBalanceRequest` | anon `{ message }` | `setup.js:944 saveAllOpeningBalances` (working) + `setup.js:968 saveOpeningBalance` (broken — wrong shape `{fiscal_year_id, balances:[...]}`, dead code) | working path ok | §4.5 Fig 4.21 | gap |
| 13 | GET   | `/api/accounts/coa/balances` | `GetAccountBalances` | USER+ | query `fiscalYearId, periodId?` | `List<AccountPeriodBalance>` | `setup.js:778 loadOpeningBalances` | ok — reads `opening_debit, opening_credit` (matches model) | §4.5 (opening balances merge) | pending |
| 14 | POST  | `/api/accounts/coa/setup-template` | `SetupTemplate` | ADMIN+ | `SetupTemplateRequest` | anon `{ message, account_types, accounts }` | `setup.js:1357 initializeTemplate` | **MISMATCH** — sends `{country: "india"}` but backend expects `country_code`. Backend silently defaults `country_code` to "IN" → only India ever initializes regardless of which button user clicks | §4.2 Fig 4.1 | gap |
| 15 | POST  | `/api/accounts/coa/import` | `ImportAccounts` | ADMIN+ | `ImportAccountsRequest` | **STUB** anon `{ message, rows_received }` — implementation deferred to S15 sprint | `setup.js:573 importAccounts` | **DOUBLE BROKEN** — frontend sends multipart `FormData` with `file` field, backend expects JSON `{accounts: ImportAccountRow[]}`. Even ignoring backend stub, the request will 400 every time. | gap — backend stub + frontend wire-format mismatch | gap |

### 4. FiscalController

Class route: `api/accounts/fiscal`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ACCOUNTS_ADMIN, ACCOUNTS_MANAGER, ACCOUNTS_AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/FiscalModels.cs`):
- **FiscalYear** → `id, tenant_id, name, start_date, end_date, is_active, is_closed, closed_by, closed_at, created_by, created_at, periods`
- **FiscalPeriod** → `id, tenant_id, fiscal_year_id, name, period_number, start_date, end_date, is_open, is_locked, locked_by, locked_at, created_at`
- **CreateFiscalYearRequest** → `name, start_date, end_date`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/fiscal/years` | `GetFiscalYears` | USER+ | — | `List<FiscalYear>` | `setup.js:982 loadFiscalYears` | ok — reads `name, start_date, end_date, is_active, is_closed`; also reads non-existent `fy.status === 'active'` (dead code, falls back to `is_active`) | §5.1 Fig 5.1 / §4 Fig 4.22 | pending |
| 2 | GET  | `/api/accounts/fiscal/years/active` | `GetActiveFiscalYear` | USER+ | — | `FiscalYear` or 404 | `setup.js:116 loadActiveFiscalYear` | ok | TBD — internal lookup | pending |
| 3 | GET  | `/api/accounts/fiscal/years/{id}` | `GetFiscalYearById` | USER+ | route `id` | `FiscalYear` or 404 | `setup.js:1106 viewFiscalYearDetail` | ok — reads `name, start_date, end_date, is_active, is_closed, created_at` | §4 Fig 4.22b | pending |
| 4 | POST | `/api/accounts/fiscal/years` | `CreateFiscalYear` | ADMIN+ | `CreateFiscalYearRequest` | `FiscalYear` (fresh-fetched) | `setup.js:1059 saveFiscalYear` (no id) | ok — sends `name, start_date, end_date` | §5.1 Fig 5.2/5.3/5.4 | pending |
| 4a | PUT | `/api/accounts/fiscal/years/{id}` | (NO BACKEND ENDPOINT) | — | — | — | `setup.js:1079 saveFiscalYear` (id branch) | **ORPHAN CALL** — frontend tries to PUT to update a fiscal year, but backend has no PUT endpoint. Edit modal will 405 Method Not Allowed. Either build the backend endpoint or remove the Edit code path. | gap | gap |
| 5 | GET  | `/api/accounts/fiscal/periods` | `GetFiscalPeriods` | USER+ | query `fiscalYearId` (Empty → falls back to active) | `List<FiscalPeriod>` | `setup.js:1144 loadFiscalPeriods` | ok | §5.2 Fig 5.5 | pending |
| 6 | POST | `/api/accounts/fiscal/periods/{id}/lock` | `LockPeriod` | ADMIN+ | route `id` | anon `{ message }` | `setup.js:1185 lockPeriod` | ok | §5.3 Fig 5.6/5.7 | pending |
| 7 | POST | `/api/accounts/fiscal/periods/{id}/unlock` | `UnlockPeriod` | ADMIN+ | route `id` | anon `{ message }` | `setup.js:1205 unlockPeriod` | ok | §5.4 Fig 5.8 | pending |
| 8 | POST | `/api/accounts/fiscal/years/{id}/close` | `CloseFiscalYear` | ADMIN+ | route `id` | anon `{ message }` | `setup.js:1093 closeFiscalYear` | ok | §15.5.6 Fig 15.5.6 | pending |

### 5. TaxationController

Class route: `api/accounts/tax`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`. GST/TDS report endpoints are gated by `IsAccountsAdmin()` runtime check.

DTO field reference (`Models/TaxationModels.cs`):
- **TaxConfiguration** → `id, tenant_id, country_code, tax_type, name, configuration (JSON), is_active, effective_from, effective_to, created_by, created_at, updated_at, rates`
- **TaxRate** → `id, tenant_id, tax_configuration_id, name, rate, tax_account_id, is_active, created_at, tax_account_code, tax_account_name`
- **HsnSacCode** → `id, tenant_id, code, description, default_tax_rate, code_type ('HSN'|'SAC'), is_active, created_at`
- **TaxLedgerEntry** → `id, tenant_id, tax_configuration_id, gl_entry_id, transaction_type, party_name, party_tax_id, taxable_amount, tax_amount, tax_details, transaction_date, created_at`
- **TaxCalculationRequest** → `transaction_type ('sales'|'purchase'), seller_state_code, buyer_state_code, taxable_amount, tax_configuration_id`
- **TaxCalculationResult** → `total_tax, taxable_amount, tax_configuration_id, tax_configuration_name, tax_lines: TaxLineResult[]`
- **TaxLineResult** → `name, rate, amount, account_id, account_code`
- **CreateTaxConfigurationRequest** → `country_code, tax_type, name, configuration (object), effective_from, effective_to`
- **UpdateTaxConfigurationRequest** → `id, name, configuration, is_active, effective_to`
- **CreateTaxRateRequest** → `tax_configuration_id, name, rate, tax_account_id`
- **CreateHsnSacCodeRequest** → `code, description, default_tax_rate, code_type`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/tax/configurations` | `GetTaxConfigurations` | USER+ | query `countryCode?, taxType?` | `List<TaxConfiguration>` | `taxation.js:125 loadTaxConfigs` | ok | §6.1 Fig 6.1 | pending |
| 2 | GET    | `/api/accounts/tax/configurations/{id}` | `GetTaxConfigurationById` | USER+ | route `id` | `TaxConfiguration` (with rates) or 404 | `taxation.js:169 viewTaxConfig` | ok | §6.2 Fig 6.2 | pending |
| 3 | POST   | `/api/accounts/tax/configurations` | `CreateTaxConfiguration` | ADMIN+ | `CreateTaxConfigurationRequest` | 201 + `TaxConfiguration` | `taxation.js:254 saveTaxConfig` (no id) | ok — sends `{name, country_code, tax_type, configuration:{total_rate, description}, effective_from}` | §6.3 Fig 6.3 | pending |
| 4 | PUT    | `/api/accounts/tax/configurations/{id}` | `UpdateTaxConfiguration` | ADMIN+ | route `id` + `UpdateTaxConfigurationRequest` | `TaxConfiguration` or 404 | `taxation.js:251 saveTaxConfig` (id branch) | ok — sends `{name, is_active, configuration}` (no `effective_to`) | §6 Fig 6.4 | pending |
| 5 | DELETE | `/api/accounts/tax/configurations/{id}` | `DeleteTaxConfiguration` | ADMIN+ | route `id` | anon `{ message }` | `taxation.js:269 deleteTaxConfig` | ok | TBD | pending |
| 6 | GET    | `/api/accounts/tax/rates` | `GetTaxRates` | USER+ | query `configId` (required) | `List<TaxRate>` | `taxation.js:303 loadTaxRates` | **MISMATCH** — also sends `search` (not a backend param, ignored). When config filter empty, sends nothing → backend receives `configId = Guid.Empty` → either 400 or empty list. The Tax Rates tab can never load data unless a config is pre-selected. | §6.3 Fig 6.3 | gap |
| 7 | POST   | `/api/accounts/tax/rates` | `CreateTaxRate` | ADMIN+ | `CreateTaxRateRequest` | 201 + anon `{ id }` | `taxation.js:388 saveTaxRate` (no id) | **MISMATCH** — sends `{name, rate, tax_config_id, account_id, status}` but backend expects `tax_configuration_id` (NOT `tax_config_id`) and `tax_account_id` (NOT `account_id`). Both critical IDs silently dropped → 400 (`tax_configuration_id` is required and would be `Guid.Empty`). **Tax rate create completely broken.** | §6.3 | gap |
| 8 | PUT    | `/api/accounts/tax/rates/{id}` | `UpdateTaxRate` | ADMIN+ | route `id` + `CreateTaxRateRequest` | anon `{ message }` | `taxation.js:385 saveTaxRate` (id branch) | same mismatch as #7 — completely broken | TBD | gap |
| 9 | DELETE | `/api/accounts/tax/rates/{id}` | `DeleteTaxRate` | ADMIN+ | route `id` | anon `{ message }` | `taxation.js:403 deleteTaxRate` | ok | TBD | pending |
| 10 | GET   | `/api/accounts/tax/hsn-sac` | `GetHsnSacCodes` | USER+ | query `search?, codeType?` | `List<HsnSacCode>` | `taxation.js:449 loadHsnSacCodes` | ok send; **render reads `h.tax_rate`** but model has `default_tax_rate` → tax rate column always blank | §6.5 Fig 6.5 | gap |
| 11 | POST  | `/api/accounts/tax/hsn-sac` | `CreateHsnSacCode` | ADMIN+ | `CreateHsnSacCodeRequest` | 201 + anon `{ id }` | `taxation.js:534 saveHsnSac` (no id) | **MISMATCH** — sends `{code, type, description, tax_rate}` but backend expects `code_type` (not `type`) and `default_tax_rate` (not `tax_rate`). Both fields silently dropped → all rows save as HSN with no rate, regardless of UI choice. **Broken.** | §6.4 Fig 6.4 | gap |
| 12 | PUT   | `/api/accounts/tax/hsn-sac/{id}` | `UpdateHsnSacCode` | ADMIN+ | route `id` + `CreateHsnSacCodeRequest` | anon `{ message }` | `taxation.js:531 saveHsnSac` (id branch) + `editHsnSac:509-511` (prefill reads `h.type, h.tax_rate` → wrong fields, modal Type and Tax Rate always blank) | same mismatch | TBD | gap |
| 13 | DELETE| `/api/accounts/tax/hsn-sac/{id}` | `DeleteHsnSacCode` | ADMIN+ | route `id` | anon `{ message }` | `taxation.js:549 deleteHsnSac` | ok | TBD | pending |
| 14 | POST  | `/api/accounts/tax/calculate` | `CalculateTax` | USER+ | `TaxCalculationRequest` | `TaxCalculationResult` | `taxation.js:707 calculateTax` | send ok; **response unwrap broken** — reads `data.breakdown` but backend returns `tax_lines`; reads `data.tax_amount` but backend returns `total_tax`; reads `data.total_amount` (doesn't exist on backend). Stat cards mostly show 0, breakdown table empty. **Tax Calculator output completely broken.** | TBD — Tax Calculator UI tab | gap |
| 15 | GET   | `/api/accounts/tax/ledger` | `GetTaxLedger` | USER+ | query `transactionType?, fromDate?, toDate?, limit, offset` | `List<TaxLedgerEntry>` | `taxation.js:751 loadTaxLedger` | ok — render reads `transaction_date, party_name, transaction_type, tax_configuration_id, taxable_amount, tax_amount` (all match model) | §6 Tax Ledger tab (no how-to entry) | pending |
| 16 | POST  | `/api/accounts/tax/seed-india` | `SeedIndiaConfig` | ADMIN+ | — | anon `{ message, configurations }` | `taxation.js:282 seedIndiaGST` | ok | §6 Seed India button | pending |
| 17 | GET   | `/api/accounts/tax/reports/gstr1` | `GetGSTR1` | ADMIN+ | query `fromDate, toDate` (required) | anon `{ report, period, outward_supplies: [...projected...], total_taxable, total_tax, invoice_count }` | `taxation.js:572 generateGSTR1` | **DOUBLE BROKEN** — (a) reads `data` as if it were an array of rows but backend wraps in envelope `{report, period, outward_supplies:[...]}`; the array is `data.outward_supplies`. (b) row fields wrong: reads `invoice_number, date, customer_name, taxable_value, total` but backend rows have `party_name, party_tax_id, taxable_amount, tax_amount, transaction_date` (no invoice_number, no total). GSTR-1 page renders nothing usable. | §6 GSTR-1 tab (no how-to entry) | gap |
| 18 | GET   | `/api/accounts/tax/reports/gstr3b` | `GetGSTR3B` | ADMIN+ | query `fromDate, toDate` (required) | anon `{ report, period, outward_supplies, inward_supplies, net_tax_payable }` | `taxation.js:615 generateGSTR3B` | **MISMATCH** — reads `data.output_tax, data.input_tax, data.net_payable`. Backend has `outward_supplies.tax, inward_supplies.tax, net_tax_payable`. All three stat cards always ₹0. | §6 GSTR-3B tab | gap |
| 19 | GET   | `/api/accounts/tax/reports/tds` | `GetTDSReturn` | ADMIN+ | query `fromDate, toDate` (required) | anon `{ report, period, deductions: [...projected...], total_tds, deductee_count }` | `taxation.js:652 generateTDSReturn` | **DOUBLE BROKEN** — same envelope-unwrap bug as GSTR-1 (reads `data` not `data.deductions`); row fields wrong: reads `deductee_name, section, amount_paid, tds_deducted, date` but backend has `party_name, party_tax_id, taxable_amount, tax_amount, transaction_date`. | §6 TDS Return tab | gap |

### 6. CustomersController

Class route: `api/accounts/customers`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AccountsReceivableModels.cs`):
- **Customer** → `id, tenant_id, customer_code, name, display_name, email, phone, billing_address_line1, billing_address_line2, city, state, state_code, country, postal_code, tax_id, payment_terms_days, default_account_id, notes, is_active, industry, website, tags, custom_fields, owner_user_id, source_service, contact_person, bank_name, bank_account_number, bank_ifsc, bank_swift, gst_number, pan_number, credit_limit, created_by, created_at, updated_at`
- **CreateCustomerRequest** → same shape as Customer minus system fields (no id/tenant_id/source_service/created_by/created_at/updated_at; `is_active` excluded)
- **UpdateCustomerRequest** → all fields above as nullable, plus `id` (auto-set from route)

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/customers` | `Get` | USER+ | query `search?, isActive?` | `List<Customer>` | `parties.js:402 loadCustomers` | dead-param: sends `includeInactive=true` (backend ignores; filter is `isActive`); functional only because frontend does client-side `is_active !== false` filter on the full result set | §7 Fig 7.1 / §8 | gap |
| 2 | GET  | `/api/accounts/customers/{id}` | `GetById` | USER+ | route `id` | `Customer` or 404 | `parties.js:302 viewCustomer` | ok — passed to `openDetailPanel` which reads top-level fields | TBD | pending |
| 3 | POST | `/api/accounts/customers` | `Create` | USER+ (no override) | `CreateCustomerRequest` | `Customer` (fresh-fetched) | `parties.js:517 saveCustomer` (no id branch) | ok — sends `name, display_name, email, phone, billing_address_line1, billing_address_line2, city, state, state_code, country, postal_code, tax_id, payment_terms_days, credit_limit, notes` (matches CreateCustomerRequest) | §7 Fig 7.5/7.6 | pending |
| 4 | PUT  | `/api/accounts/customers/{id}` | `Update` | USER+ | route `id` + `UpdateCustomerRequest` | `Customer` | `parties.js:517 saveCustomer` (id branch) + `parties.js:491 editCustomer` (form prefill) | **MISMATCH on PREFILL**: `editCustomer` reads `c.address_line1/c.address_line2` but Customer uses `billing_address_line1/2` → Edit modal shows empty address. Save body sends `billing_address_line1` correctly so write is ok. Read-only display bug. | §7 Fig 7.6 | gap |

### 7. VendorsController

Class route: `api/accounts/vendors`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AccountsPayableModels.cs`):
- **Vendor** → `id, tenant_id, vendor_code, name, display_name, email, phone, address_line1, address_line2, city, state, state_code, country, postal_code, tax_id, payment_terms_days, default_account_id, bank_name, bank_account_number, bank_ifsc, bank_swift, website, gst_number, pan_number, industry, tags, custom_fields, source_service, contact_person, credit_limit, notes, is_active, created_by, created_at, updated_at`
- **CreateVendorRequest** → same shape minus system fields (no id/tenant_id/source_service/created_by/timestamps; `is_active` excluded)
- **UpdateVendorRequest** → all fields nullable plus `id` (auto-set from route)

> **Field naming gap to track in Phase 2:** Vendor uses `address_line1/2`, Customer uses `billing_address_line1/2`. The frontend Parties page needs different field names for each side — easy place for a binding bug.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/vendors` | `GetVendors` | USER+ | query `search?, isActive?` | `List<Vendor>` | `parties.js:89 loadVendors` | dead-param `includeInactive=true` (same pattern as customers) — functional via client-side filter | §7 Fig 7.1 | gap |
| 2 | GET  | `/api/accounts/vendors/{id}` | `GetVendorById` | USER+ | route `id` | `Vendor` or 404 | `parties.js:290 viewVendor` | ok | TBD | pending |
| 3 | POST | `/api/accounts/vendors` | `CreateVendor` | USER+ | `CreateVendorRequest` | `Vendor` (fresh-fetched) | `parties.js:356 saveVendor` (no id branch) | ok — sends `name, display_name, email, phone, address_line1, address_line2, city, state, state_code, country, postal_code, tax_id, payment_terms_days, bank_name, bank_account_number, bank_ifsc, bank_swift, notes` (matches CreateVendorRequest, no `industry/website/contact_person/credit_limit`) | §7 Fig 7.2/7.3/7.4 | pending |
| 4 | PUT  | `/api/accounts/vendors/{id}` | `UpdateVendor` | USER+ | route `id` + `UpdateVendorRequest` | `Vendor` | `parties.js:356 saveVendor` (id branch) + `editVendor` (prefill) | ok — Vendor uses `address_line1` natively so prefill works (asymmetric to Customer which broke) | TBD | pending |

### 8. ClientVendorRequestsController

Class route: `api/accounts/requests`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`. Review endpoint elevated to ADMIN+.

DTO field reference (`Models/ClientVendorRequestModels.cs`):
- **ClientVendorRequest** → `id, tenant_id, request_type, status, requested_by, requested_by_name, requested_from_service, name, code, display_name, email, phone, tax_id, address_line1, address_line2, city, state, state_code, country, postal_code, industry, website, payment_terms_days, gst_number, pan_number, bank_name, bank_account_number, bank_ifsc, bank_swift, contact_person, credit_limit, notes, request_reason, tags, custom_fields, reviewed_by, reviewed_by_name, reviewed_at, rejection_reason, created_customer_id, created_vendor_id, sla_deadline, sla_breached, auto_approved, reminder_24h_sent, reminder_8h_sent, created_at, updated_at`
- **SubmitClientVendorRequest** → `request_type, name, code, email, phone, tax_id, address_line1, city, state, country, industry, website, payment_terms_days, gst_number, pan_number, request_reason, notes, bank_name, bank_account_number, bank_ifsc, contact_person, credit_limit`
- **ReviewRequestAction** → `action ('approve'|'reject'), rejection_reason, name, code, email, phone, tax_id, address_line1, city, state, country, payment_terms_days, bank_name, bank_account_number, bank_ifsc`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/accounts/requests` | `Submit` | USER+ | `SubmitClientVendorRequest` | `ClientVendorRequest` | none on Accounts side | n/a | N/A — submitted from CRM/Procurement | N/A |
| 2 | GET  | `/api/accounts/requests` | `Get` | USER+ | query `type?, status?, limit, offset` | anon `{ items: List<ClientVendorRequest>, total }` | `parties.js:623 loadPendingRequests` (called per type) | reads `res.data \|\| res.items` — backend wraps in `items` not `data`, so `res?.data` is undefined and the `\|\| res?.items` fallback fires → ok via fallback (a touch fragile) | §7 / Pending Requests sub-tabs (no how-to-guide entry yet) | pending |
| 3 | GET  | `/api/accounts/requests/{id}` | `GetById` | USER+ | route `id` | `ClientVendorRequest` or 404 | none — frontend uses cached items from list call instead | n/a | gap — minor: detail-on-demand never fetched server-side | gap |
| 4 | GET  | `/api/accounts/requests/pending-count` | `GetPendingCount` | USER+ | — | dict `{ client: N, vendor: N }` (whatever `BL.GetPendingCountByType` returns) | `parties.js:566 loadPendingCounts` | reads `data.vendor \|\| data.vendors` and `data.client \|\| data.clients \|\| data.customer \|\| data.customers` — defensive over-coverage; verify BL returns one of these in Phase 4 | §7 sidebar badges | pending |
| 5 | GET  | `/api/accounts/requests/sla-report` | `GetSlaReport` | ADMIN/MANAGER+ | — | SLA report shape from `BL.GetSlaReportAsync` | none | n/a | gap — no UI for SLA dashboard | gap |
| 6 | POST | `/api/accounts/requests/{id}/review` | `Review` | ADMIN+ | route `id` + `ReviewRequestAction` | review result from `BL.ReviewRequest` | `parties.js:728 confirmApprove` + `parties.js:799 confirmReject` | ok — approve sends `{action:'approve', email, phone, tax_id, address_line1, city, state, country, payment_terms_days}`; reject sends `{action:'reject', rejection_reason}` (matches ReviewRequestAction; missing optional `name, code, bank_*` from approve flow) | §7 approve/reject row actions (no how-to entry yet) | pending |

### 9. CustomerInvoicesController

Class route: `api/accounts/invoices`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AccountsReceivableModels.cs`):
- **CustomerInvoice** → `id, tenant_id, invoice_number, customer_id, invoice_date, due_date, source_type, source_id, subtotal, tax_amount, discount_amount, total_amount, paid_amount, balance_due, currency, status, gl_entry_id, tax_details, payment_link, notes, is_active, created_by, created_at, updated_at, customer_name, lines` + computed display strings `currency_display, total_amount_formatted, balance_due_formatted, paid_amount_formatted`
- **CustomerInvoiceLine** → `id, customer_invoice_id, tenant_id, account_id, description, quantity, unit_price, amount, tax_config_id, tax_amount, created_at, account_code, account_name`
- **CustomerPayment** → `id, tenant_id, payment_number, customer_id, payment_date, amount, payment_method, bank_account_id, reference_number, gl_entry_id, notes, is_active, created_by, created_at, customer_name`
- **ARAgingRow** → `customer_id, customer_name, customer_code, current_amount, days_30, days_60, days_90, days_120_plus, total`
- **CreditNote** → `id, tenant_id, credit_note_number, customer_id, customer_invoice_id, credit_date, amount, reason, status, gl_entry_id, created_by, created_at, customer_name, invoice_number`
- **CreateCustomerInvoiceRequest** → `customer_id, invoice_date, due_date, source_type, source_id, notes, tax_configuration_id, lines: CreateCustomerInvoiceLineRequest[]`
- **CreateCustomerInvoiceLineRequest** → `account_id, description, quantity, unit_price`
- **RecordCustomerPaymentRequest** → `customer_id, payment_date, amount, payment_method, bank_account_id, reference_number, notes, allocations: CustomerPaymentAllocationRequest[]`
- **CustomerPaymentAllocationRequest** → `customer_invoice_id, allocated_amount`
- **CreateCreditNoteRequest** → `customer_id, customer_invoice_id, credit_date, amount, reason`

> **Notable:** invoice line request takes only `account_id, description, quantity, unit_price` — line-level tax (`tax_config_id`) is **not exposed in the create request** even though the model carries it. Header-level `tax_configuration_id` is the only way the frontend can attach tax. Flag for Phase 2 if the UI tries to send line-level tax. Also no `update`, `cancel`, or `mark-paid` endpoints — Cancel and "void after approve" flows are missing on the backend.

> Per-invoice line items: there is **no PUT/PATCH endpoint to edit a draft invoice's line items** — to change anything you must Delete + recreate. Frontend "Edit invoice" row action would have to follow that pattern. Verify in Phase 2.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/invoices` | `Get` | USER+ | query `customerId?, status?, fromDate?, toDate?, limit, offset` | anon `{ data: List<CustomerInvoice>, total, stats: { ... } }` | `receivables.js:191 loadCustomerInvoices` + line 557/668 (helper picks for payment/credit note) | line 557 sends `?status=approved,sent,partial` (comma-separated) but backend does exact-string filter — won't match. Helper picks for outstanding invoices probably return empty → payment allocation rows often blank | §10.1 Fig 10.1 / §3.6 | gap |
| 2 | GET    | `/api/accounts/invoices/{id}` | `GetById` | USER+ | route `id` | `CustomerInvoice` (with lines) or 404 | `receivables.js:325 viewInvoice/editInvoice` | ok | TBD — view modal | pending |
| 3 | POST   | `/api/accounts/invoices` | `Create` | ADMIN/MANAGER+ | `CreateCustomerInvoiceRequest` | 201 + `CustomerInvoice` | `receivables.js:423 saveInvoice` (no id) | ⚠️ sends per-line `hsn_sac` field which backend silently drops; sends top-level `status: 'approved'\|'draft'` flag for "Save & Approve" but backend has no `status` field in CreateCustomerInvoiceRequest → **Save & Approve only saves draft, never approves**. The user must click Approve row action separately. | §10.2 Fig 10.2a/10.2b / §10.3 | gap |
| 3a | PUT  | `/api/accounts/invoices/{id}` | (NO BACKEND ENDPOINT) | — | — | — | `receivables.js:421 saveInvoice` (id branch) | **ORPHAN CALL** — backend has no PUT for customer invoices. Edit Invoice button → 405 Method Not Allowed. Either build the backend endpoint or remove the Edit code path | gap | gap |
| 4 | DELETE | `/api/accounts/invoices/{id}` | `Delete` | ADMIN+ | route `id` | 204 | `receivables.js:487 deleteDraftInvoice` | ok | §10.3 — only drafts | pending |
| 5 | POST   | `/api/accounts/invoices/{id}/approve` | `Approve` | ADMIN/MANAGER+ | route `id` | result of `BL.ApproveCustomerInvoice` | `receivables.js:455 approveInvoice` | ok | §10.3 Fig 10.3a/b | pending |
| 6 | POST   | `/api/accounts/invoices/{id}/send` | `Send` | ADMIN/MANAGER+ | route `id` | anon `{ message }` | `receivables.js:471 sendInvoice` | ok | §10.3c Fig 10.3c | pending |
| 7 | POST   | `/api/accounts/invoices/payments` | `RecordPayment` | ADMIN/MANAGER+ | `RecordCustomerPaymentRequest` | 201 + payment from BL | `receivables.js:595 saveCustomerPayment` | **MISMATCH (2)** — sends `reference` (backend wants `reference_number`); allocations send `{invoice_id, amount}` (backend wants `{customer_invoice_id, allocated_amount}`). **Result: payments record successfully but reference is always blank AND allocations are silently dropped → invoice balance_due never decreases.** This is the kind of bug that matters most in accounting. | §10.4a Fig 10.4a | gap |
| 8 | GET    | `/api/accounts/invoices/payments` | `GetPayments` | USER+ | query `customerId?, limit, offset` | `List<CustomerPayment>` | `receivables.js:510 loadCustomerPayments` | dead-params: sends `customer_id` (snake — backend takes camelCase `customerId`), `date_from, date_to, search, page, pageSize` (none of which exist on backend) — all filters silently dropped | §10.4a | gap |
| 9 | GET    | `/api/accounts/invoices/aging` | `GetARAging` | USER+ | — | `List<ARAgingRow>` | `receivables.js:705 loadARAging` | ok — defensive multi-key normalization | §10.4c Fig 10.4c — also exposed at `/reports/ar-aging` (functional duplicate) | pending |
| 10 | GET   | `/api/accounts/invoices/customers/{customerId}/statement` | `GetCustomerStatement` | USER+ | route `customerId` + query `fromDate?, toDate?` | anon `{ customer_name, customer_code, invoices: [...], payments: [...], credit_notes: [...], totals... }` | `receivables.js:765 loadCustomerStatement` | ok send and read shape — but query params: sends `date_from/date_to` (snake) instead of backend's `fromDate/toDate` → date range silently ignored, statement always full history | §10.4d Fig 10.4d | gap |
| 11 | POST  | `/api/accounts/invoices/credit-notes` | `CreateCreditNote` | ADMIN/MANAGER+ | `CreateCreditNoteRequest` | 201 + credit note from BL | `receivables.js:689 saveCreditNote` | ok — sends `customer_id, customer_invoice_id, credit_date, amount, reason` | §10.4b Fig 10.4b | pending |
| 12 | GET   | `/api/accounts/invoices/credit-notes` | `GetCreditNotes` | USER+ | query `customerId?, limit, offset` | `List<CreditNote>` | `receivables.js:624 loadCreditNotes` | dead-params: same pattern as payments — `customer_id, status, date_from, date_to, search, page, pageSize` — all backend-ignored | §10.4b | gap |
| 13 | POST  | `/api/accounts/invoices/bulk` | `BulkCreateInvoices` | USER+ | `List<CreateCustomerInvoiceRequest>` | anon `{ total, created, results: [...] }` | `receivables.js:289` (caller TBD — likely subscription billing path) | TBD | TBD | pending |

### 10. VendorBillsController

Class route: `api/accounts/vendor-bills`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AccountsPayableModels.cs`):
- **VendorBill** → `id, tenant_id, bill_number, vendor_id, bill_date, due_date, po_reference, grn_reference, subtotal, tax_amount, tds_amount, total_amount, paid_amount, balance_due, currency, status, gl_entry_id, tax_details, notes, is_active, created_by, created_at, updated_at, vendor_name, lines`
- **VendorBillLine** → `id, vendor_bill_id, tenant_id, account_id, description, quantity, unit_price, amount, tax_config_id, tax_amount, created_at, account_code, account_name`
- **VendorPayment** → `id, tenant_id, payment_number, vendor_id, payment_date, amount, payment_method, bank_account_id, reference_number, tds_amount, gl_entry_id, notes, is_active, created_by, created_at, vendor_name, allocations`
- **VendorPaymentAllocation** → `id, tenant_id, vendor_payment_id, vendor_bill_id, allocated_amount, created_at, bill_number`
- **CreateVendorBillRequest** → `vendor_id, bill_date, due_date, po_reference, grn_reference, notes, tax_configuration_id, lines: CreateVendorBillLineRequest[]`
- **CreateVendorBillLineRequest** → `account_id, description, quantity, unit_price`
- **RecordVendorPaymentRequest** → `vendor_id, payment_date, amount, payment_method, bank_account_id, reference_number, notes, allocations: PaymentAllocationRequest[]`
- **PaymentAllocationRequest** → `vendor_bill_id, allocated_amount`

> Notable difference vs `CustomerInvoicesController`: VendorBills **does** have a PUT endpoint (`UpdateVendorBill`) that accepts the same shape as create — but only for drafts (409 if not). Customer invoices don't. **Asymmetry to flag in Phase 4** — either give invoices an Update endpoint too, or document why.

> Also: VendorBills exposes `tds_amount` on the model (Indian tax-deducted-at-source) but the create request **doesn't** — you can't supply it from the UI. Either compute server-side or expose it. Phase 4 candidate.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/vendor-bills` | `GetVendorBills` | USER+ | query `vendorId?, status?, fromDate?, toDate?, search?, limit, offset` | anon `{ data: List<VendorBill>, total, stats: {...} }` | `payables.js:124 loadVendorBills` + line 610 (open bills picker for payment alloc) | ok | §11.1 Fig 11.1 / §11.3a | pending |
| 2 | GET    | `/api/accounts/vendor-bills/{id}` | `GetVendorBillById` | USER+ | route `id` | `VendorBill` (with lines) or 404 | `payables.js:228 viewBill/editBill` | ok | §11.3b Fig 11.3b | pending |
| 3 | POST   | `/api/accounts/vendor-bills` | `CreateVendorBill` | ADMIN/MANAGER+ | `CreateVendorBillRequest` | 201 + `VendorBill` | `payables.js:383 saveBill` (no id) | ⚠️ sends top-level `status: 'approved'\|'draft'` flag — backend has no `status` field on CreateVendorBillRequest. **Save & Approve doesn't approve** — same bug as customer invoices. User must click Approve row action separately. | §11.2 Fig 11.2 / §11.3 | gap |
| 4 | PUT    | `/api/accounts/vendor-bills/{id}` | `UpdateVendorBill` | ADMIN/MANAGER+ | route `id` + `CreateVendorBillRequest`; rejects 409 if not draft | `VendorBill` or 404 | `payables.js:380 saveBill` (id branch) | ok | TBD — edit modal for drafts | pending |
| 5 | POST   | `/api/accounts/vendor-bills/{id}/cancel` | `CancelVendorBill` | ADMIN+ | route `id` | anon `{ message, id }` | `payables.js:434 cancelBill` | ok | §11.3a (cancel row action) | pending |
| 6 | GET    | `/api/accounts/vendor-bills/vendors/{vendorId}/statement` | `GetVendorStatement` | USER+ | route `vendorId` + query `fromDate?, toDate?` | anon `{ vendor_name, vendor_code, bills: [...], payments: [...], totals... }` | `payables.js:771 loadVendorStatement` | TBD — check param case in Phase 4 (likely same `date_from/date_to` snake-case bug as receivables) | §11.4c Fig 11.4c | pending |
| 7 | POST   | `/api/accounts/vendor-bills/{id}/approve` | `ApproveVendorBill` | ADMIN/MANAGER+ | route `id` | `VendorBill` after approval | `payables.js:410 approveBill` | ok | §11.3 Fig 11.3 | pending |
| 8 | POST   | `/api/accounts/vendor-bills/payments` | `RecordPayment` | ADMIN/MANAGER+ | `RecordVendorPaymentRequest` | 201 + `VendorPayment` | `payables.js:664 saveVendorPayment` | ⚠️ payload top-level fields all correct (`vendor_id, payment_date, amount, bank_account_id, reference_number, payment_method`); but **allocations send `{bill_id, amount}` while backend expects `{vendor_bill_id, allocated_amount}`** → allocations silently dropped, **payments record but bills' balance_due never decreases**. Same critical bug as customer payments. | §11.4a Fig 11.4a | gap |
| 9 | GET    | `/api/accounts/vendor-bills/payments` | `GetPayments` | USER+ | query `vendorId?, limit, offset` | `List<VendorPayment>` | `payables.js:521 loadVendorPayments` | TBD — likely same dead-params pattern as receivables | §11.4a | pending |
| 9a | DELETE | `/api/accounts/vendor-bills/payments/{id}` | (NO BACKEND ENDPOINT) | — | — | — | `payables.js:679 deletePayment` | **ORPHAN CALL** — "Void Payment" row action will 405. Backend has POST/GET on `/payments` but no DELETE. | gap | gap |
| 10 | GET   | `/api/accounts/vendor-bills/aging` | `GetAPAging` | USER+ | — | AP aging shape from BL | `payables.js:695 loadAPAging` | ok — defensive multi-key normalization on `current_amount, days_30/60/90/120_plus, total` (matches `AgingRow` model) | §11.4b Fig 11.4b — also at `/reports/ap-aging` (duplicate) | pending |
| 11 | POST  | `/api/accounts/vendor-bills/bulk` | `BulkCreateBills` | USER+ | `List<CreateVendorBillRequest>` | anon `{ total, created, results: [...] }` | `payables.js:492` (bulk paste/import flow) | TBD | TBD | pending |

### 11. ProformaInvoicesController

Class route: `api/accounts/proforma-invoices`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/ProformaInvoiceModels.cs`):
- **ProformaInvoice** → `id, tenant_id, proforma_number, customer_id, proforma_date, valid_until, subtotal, tax_amount, discount_amount, total_amount, currency, status, converted_invoice_id, notes, is_active, created_by, created_at, updated_at, customer_name, converted_invoice_number, lines`
- **ProformaInvoiceLine** → `id, proforma_invoice_id, tenant_id, account_id, description, quantity, unit_price, amount, tax_config_id, tax_amount, created_at, account_code, account_name`
- **CreateProformaInvoiceRequest** → `customer_id, proforma_date, valid_until, notes, tax_configuration_id, lines: CreateProformaInvoiceLineRequest[]`
- **CreateProformaInvoiceLineRequest** → `account_id, description, quantity, unit_price`
- **UpdateProformaInvoiceRequest** → `customer_id, proforma_date, valid_until, notes, tax_configuration_id, lines` (all nullable, lines replace all)

> **Likely missing-UI candidate.** No `pages/accounts/proforma-invoices.html` exists today. The whole controller (9 endpoints, full CRUD + accept/reject/convert lifecycle) is **probably an orphan**. Phase 4 should either build a Proforma page under Accounts or wire it into the existing Receivables page as a tab. Verify in Phase 2.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/proforma-invoices` | `Get` | USER+ | query `customerId?, status?, fromDate?, toDate?, limit, offset` | anon `{ data: List<ProformaInvoice>, total, stats: { total/draft/sent/accepted/rejected/invoiced/expired _count, total_value } }` | TBD | TBD | gap — no UI | gap |
| 2 | GET    | `/api/accounts/proforma-invoices/{id}` | `GetById` | USER+ | route `id` | `ProformaInvoice` (with lines) or 404 | TBD | TBD | gap | gap |
| 3 | POST   | `/api/accounts/proforma-invoices` | `Create` | ADMIN/MANAGER+ | `CreateProformaInvoiceRequest` | 201 + `ProformaInvoice` | TBD | TBD | gap | gap |
| 4 | PUT    | `/api/accounts/proforma-invoices/{id}` | `Update` | ADMIN/MANAGER+ | route `id` + `UpdateProformaInvoiceRequest` | `ProformaInvoice` | TBD | TBD | gap | gap |
| 5 | DELETE | `/api/accounts/proforma-invoices/{id}` | `Delete` | ADMIN+ | route `id` | 204 | TBD | TBD | gap | gap |
| 6 | POST   | `/api/accounts/proforma-invoices/{id}/send` | `Send` | ADMIN/MANAGER+ | route `id` | `ProformaInvoice` | TBD | TBD | gap | gap |
| 7 | POST   | `/api/accounts/proforma-invoices/{id}/accept` | `Accept` | ADMIN/MANAGER+ | route `id` | `ProformaInvoice` | TBD | TBD | gap | gap |
| 8 | POST   | `/api/accounts/proforma-invoices/{id}/reject` | `Reject` | ADMIN/MANAGER+ | route `id` | `ProformaInvoice` | TBD | TBD | gap | gap |
| 9 | POST   | `/api/accounts/proforma-invoices/{id}/convert-to-invoice` | `ConvertToInvoice` | ADMIN/MANAGER+ | route `id` | 201 + `CustomerInvoice` | TBD | TBD | gap | gap |

### 12. PurchaseOrdersController

Class route: `api/accounts/purchase-orders`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/PurchaseOrderModels.cs`):
- **PurchaseOrder** → `id, tenant_id, po_number, vendor_id, po_date, expected_date, subtotal, tax_amount, total_amount, currency, status, approved_by, approved_at, gl_entry_id, procurement_po_id, notes, is_active, created_by, created_at, updated_at, vendor_name, lines`
- **PurchaseOrderLine** → `id, purchase_order_id, tenant_id, account_id, description, quantity, unit_price, amount, tax_config_id, tax_amount, created_at, account_code, account_name`
- **CreatePurchaseOrderRequest** → `vendor_id, po_date, expected_date, currency, notes, procurement_po_id, lines: CreatePurchaseOrderLineRequest[]`
- **CreatePurchaseOrderLineRequest** → `account_id, description, quantity, unit_price`
- **UpdatePurchaseOrderRequest** → `id, vendor_id, po_date, expected_date, currency, notes, lines` (all nullable, lines replace all)

> **Likely missing-UI candidate.** No `pages/accounts/purchase-orders.html` exists today. The whole controller (10 endpoints, full lifecycle from draft → approved → sent → received → billed → cancelled, plus convert-to-bill) is **probably an orphan** in Accounts. The model has a `procurement_po_id` field, suggesting these POs may be created via the Procurement service's UI rather than Accounts'. Verify in Phase 2 — and decide whether to build Accounts-side UI for them or treat them as Procurement-only.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/purchase-orders` | `GetPurchaseOrders` | USER+ | query `vendorId?, status?, fromDate?, toDate?, search?, limit, offset` | anon `{ data: List<PurchaseOrder>, total, stats: { total/draft/approved/sent/received/billed/cancelled _count, total_value } }` | TBD | TBD | gap — no UI in Accounts | gap |
| 2 | GET    | `/api/accounts/purchase-orders/{id}` | `GetPurchaseOrderById` | USER+ | route `id` | `PurchaseOrder` (with lines) or 404 | TBD | TBD | gap | gap |
| 3 | POST   | `/api/accounts/purchase-orders` | `CreatePurchaseOrder` | ADMIN/MANAGER+ | `CreatePurchaseOrderRequest` | 201 + `PurchaseOrder` | TBD | TBD | gap | gap |
| 4 | PUT    | `/api/accounts/purchase-orders/{id}` | `UpdatePurchaseOrder` | ADMIN/MANAGER+ | route `id` + `UpdatePurchaseOrderRequest` | `PurchaseOrder` or 404 | TBD | TBD | gap | gap |
| 5 | DELETE | `/api/accounts/purchase-orders/{id}` | `DeletePurchaseOrder` | ADMIN+ | route `id` | anon `{ message, id }` | TBD | TBD | gap | gap |
| 6 | POST   | `/api/accounts/purchase-orders/{id}/approve` | `ApprovePurchaseOrder` | ADMIN/MANAGER+ | route `id` | `PurchaseOrder` after approval | TBD | TBD | gap | gap |
| 7 | POST   | `/api/accounts/purchase-orders/{id}/send` | `SendPurchaseOrder` | ADMIN/MANAGER+ | route `id` | anon `{ message, id }` | TBD | TBD | gap | gap |
| 8 | POST   | `/api/accounts/purchase-orders/{id}/receive` | `ReceivePurchaseOrder` | ADMIN/MANAGER+ | route `id` | `PurchaseOrder` | TBD | TBD | gap | gap |
| 9 | POST   | `/api/accounts/purchase-orders/{id}/convert-to-bill` | `ConvertToBill` | ADMIN/MANAGER+ | route `id` | anon `{ message, purchase_order_id, bill: VendorBill }` | TBD | TBD | gap | gap |
| 10 | POST  | `/api/accounts/purchase-orders/{id}/cancel` | `CancelPurchaseOrder` | ADMIN+ | route `id` | anon `{ message, id }` | TBD | TBD | gap | gap |

### 13. DebitNotesController

Class route: `api/accounts/debit-notes`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AccountsPayableModels.cs`):
- **DebitNote** → `id, tenant_id, debit_note_number, vendor_id, vendor_bill_id, debit_date, amount, reason, status, gl_entry_id, created_by, created_at, vendor_name, bill_number`
- **CreateDebitNoteRequest** → `vendor_id, vendor_bill_id, debit_date, amount, reason`

> **Likely missing-UI candidate.** Symmetric to credit notes (which exist on the Receivables page) but no Payables tab for debit notes today. Phase 4 should add a Debit Notes tab to the Payables page using the existing CreditNotes tab as a template — same shape, mirrored direction.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/debit-notes` | `Get` | USER+ | query `vendorId?, limit, offset` | `List<DebitNote>` | TBD | TBD | gap | gap |
| 2 | GET  | `/api/accounts/debit-notes/{id}` | `GetById` | USER+ | route `id` | `DebitNote` or 404 | TBD | TBD | gap | gap |
| 3 | POST | `/api/accounts/debit-notes` | `Create` | ADMIN/MANAGER+ | `CreateDebitNoteRequest` | 201 + `DebitNote` | TBD | TBD | gap | gap |
| 4 | POST | `/api/accounts/debit-notes/{id}/approve` | `Approve` | ADMIN/MANAGER+ | route `id` | result of `BL.ApproveDebitNote` | TBD | TBD | gap | gap |

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
| 1 | GET    | `/api/accounts/bank/accounts` | `GetBankAccounts` | USER+ | query `includeInactive` | `List<BankAccount>` | `dashboard.js:78` + `banking.js:71/151` | ok — banking.js correctly uses `includeInactive=true` for the Show Inactive toggle (only place this param actually works). Reads `account_name, bank_name, current_balance, is_active, is_default` | §15.1 Fig 15.1.1/4/5 / §3.6 | pending |
| 2 | GET    | `/api/accounts/bank/accounts/{id}` | `GetBankAccountById` | USER+ | route `id` | `BankAccount` or 404 | `banking.js:248 loadBankAccountIntoModal` | ok — reads `account_name, bank_name, account_number, account_type, ifsc_code, swift_code, branch, gl_account_id, is_default` | §15.1 Fig 15.1.6 (view modal) | pending |
| 3 | POST   | `/api/accounts/bank/accounts` | `CreateBankAccount` | ADMIN+ | `CreateBankAccountRequest` | `BankAccount` (fresh-fetched) | `banking.js:351 saveBankAccount` (no id) | ok — sends `account_name, bank_name, account_number, account_type, ifsc_code, swift_code, branch, gl_account_id, is_default` (matches CreateBankAccountRequest) | §15.1 Fig 15.1.2/3 | pending |
| 4 | PUT    | `/api/accounts/bank/accounts/{id}` | `UpdateBankAccount` | ADMIN+ | route `id` + `UpdateBankAccountBody` | `BankAccount` | `banking.js:348 saveBankAccount` (id branch) + `banking.js:283 deactivateBankAccount` + `banking.js:297 reactivateBankAccount` (both send `{is_active: bool}`) | ok | §15.1 Fig 15.1.7 (edit prefilled) + Fig 15.1.8/9/10/11 | pending |
| 5 | GET    | `/api/accounts/bank/accounts/{id}/transactions` | `GetTransactions` | USER+ | route `id` + query `fromDate?, toDate?, search?, limit, offset` | `List<BankTransaction>` | `banking.js:385 loadBankTransactions` | ok — sends `limit, offset, fromDate, toDate, search` (matches) | §15.1 Fig 15.1.12–17 | pending |
| 6 | POST   | `/api/accounts/bank/accounts/{id}/transactions` | `RecordTransaction` | ADMIN/MANAGER+ | route `id` + `RecordBankTransactionRequest` | 201 + result of `BL.RecordManualTransaction` | `banking.js:511 saveBankTransaction` | ⚠️ sends `transaction_type` as `deposit/withdrawal/interest/charges` (lowercase) — model declares `AllowedValues = {debit, credit}` but that attribute is **descriptive only, not enforced at runtime**, and `BL.RecordManualTransaction` accepts the lowercase strings. Working in practice. Backend AllowedValues attribute is misleading documentation — Phase 4 should fix the attribute. Also sends `bank_account_id` in body even though it's already in route — harmless duplicate. | §15.1 Fig 15.1.16–19, 15.1.21a/b | gap |
| 7 | DELETE | `/api/accounts/bank/accounts/{bankAccountId}/transactions/{transactionId}` | `DeleteTransaction` | ADMIN+ | two route params | anon `{ message }` | `banking.js:539 deleteBankTransaction` | ok | §15.1 Fig 15.1.21 | pending |
| 8 | GET    | `/api/accounts/bank/transfer` | `GetRecentTransfers` | USER+ | query `limit` | `List<BankTransfer>` | `banking.js:594 loadRecentTransfers` | ok | §15.1 Fig 15.1.25 (recent transfers table) | pending |
| 9 | POST   | `/api/accounts/bank/transfer` | `InterBankTransfer` | ADMIN/MANAGER+ | `InterBankTransferRequest` | anon `{ message }` | `banking.js:578 executeTransfer` | ok — sends `from_bank_account_id, to_bank_account_id, amount, transfer_date, description` (no `reference_number`) | §15.1 Fig 15.1.22–25 | pending |
| 10 | POST  | `/api/accounts/bank/reconciliations` | `StartReconciliation` | ADMIN/MANAGER+ | `StartReconciliationRequest` | 201 + reconciliation result | `banking.js:639 startReconciliation` | ok send; reads `recon.transactions \|\| recon.unmatched_transactions` defensively — verify BL key in Phase 4 | §15.1 Fig 15.1.26/27/28 | pending |
| 11 | PUT   | `/api/accounts/bank/reconciliations/{id}` | `MatchTransactions` | ADMIN/MANAGER+ | route `id` + `MatchTransactionsRequest` | anon `{ message }` | `banking.js:717 matchSelectedTransactions` | ok — sends `{transaction_ids: [...]}` | §15.1 Fig 15.1.29 | pending |
| 12 | POST  | `/api/accounts/bank/reconciliations/{id}/complete` | `CompleteReconciliation` | ADMIN/MANAGER+ | route `id` | anon `{ message }` | `banking.js:751 completeReconciliation` | ok | §15.1 Fig 15.1.30/31 | pending |
| 13 | GET   | `/api/accounts/bank/dashboard` | `GetDashboard` | USER+ | — | `BankDashboardSummary` | `banking.js:91 loadBankDashboard` | ok — reads `total_bank_balance, total_cash_balance, accounts[]` | §15.1 stats tiles + Dashboard §3.6 | pending |
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
| 1 | GET  | `/api/accounts/journals/types` | `GetJournalTypes` | USER+ | — | `List<JournalType>` | `setup.js:1229 loadJournalTypes` + others | ok | §4 Fig 4.18/4.24 | pending |
| 2 | GET  | `/api/accounts/journals/types/{id}` | `GetJournalTypeById` | USER+ | route `id` | `JournalType` or 404 | `setup.js:1334 viewJournalTypeDetail` | ok | TBD — internal lookup | pending |
| 3 | POST | `/api/accounts/journals/types` | `CreateJournalType` | ADMIN+ | `CreateJournalTypeRequest` | `JournalType` (fresh-fetched) | `setup.js:1292 saveJournalType` (no id) | ok — sends `code, name, description` | §4 Fig 4.24a | pending |
| 4 | PUT  | `/api/accounts/journals/types/{id}` | `UpdateJournalType` | ADMIN+ | route `id` + `UpdateJournalTypeRequest` | `JournalType` | `setup.js:1292 saveJournalType` (id branch) | ⚠️ sends `code` too but UpdateJournalTypeRequest only accepts `name, description, is_active` — `code` silently dropped | TBD | gap |
| 4a | DELETE | `/api/accounts/journals/types/{id}` | (NO BACKEND ENDPOINT) | — | — | — | `setup.js:1321 deleteJournalType` | **ORPHAN CALL** — frontend's Delete row action will 405. Either build the backend DELETE or remove the button (it's hidden for system journal types but admin still sees it for custom ones) | gap | gap |
| 5 | GET  | `/api/accounts/journals/entries` | `GetJournalEntries` | USER+ | query `journalTypeId?, fromDate?, toDate?, search?, limit, offset` (mapped into `GlQueryRequest`) | anon `{ data: List<GlEntry>, total, limit, offset }` | `ledger.js:662 loadJournalEntries` | ok — sends `journalTypeId, fromDate, toDate, search` (no limit/offset, defaults apply) | §12.3 Fig 12.3a | pending |

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
| 1 | GET    | `/api/accounts/gl` | `QueryGlEntries` | USER+ | query (8 params, mapped to `GlQueryRequest`) | anon `{ data: List<GlEntry>, total, limit, offset }` | `dashboard.js:124` + `ledger.js:151 loadGlEntries` | ok — sends `accountId, journalTypeId, status, fromDate, toDate, search, referenceType, limit, offset` | §12.1 / §12.1a / §3.6 | pending |
| 2 | GET    | `/api/accounts/gl/{id}` | `GetGlEntryById` | USER+ | route `id` | `GlEntry` (with lines) or 404 | `ledger.js:227 viewGlEntry` + `ledger.js:367 editGlEntry` | ok — reads `lines, total_debit, total_credit, entry_number, entry_date, journal_type_id, status, description, posted_by, posted_at, is_reversed, reversal_of, reversed_by` | §12.2 / §15.1.17a | pending |
| 3 | POST   | `/api/accounts/gl` | `CreateGlEntry` | ADMIN/MANAGER+ | `CreateGlEntryRequest` | `GlEntry` | `ledger.js:628 saveGlEntry` (no editingGlId) | ok — sends `journal_type_id, entry_date, description, reference_type:'manual', reference_id:null, lines:[{account_id, description, debit_amount, credit_amount}]` (no `idempotency_key`, no `cost_center` per line) | §12 (Create Entry tab — guide describes "you may also create manual entries") | pending |
| 4 | PUT    | `/api/accounts/gl/{id}` | `UpdateDraftGlEntry` | ADMIN/MANAGER+ | route `id` + `CreateGlEntryRequest` | `GlEntry` or 404 | `ledger.js:621 saveGlEntry` (editingGlId branch) | ok — same shape as create | §12 (Edit draft row action) | pending |
| 5 | DELETE | `/api/accounts/gl/{id}` | `DeleteDraftGlEntry` | ADMIN+ | route `id` | 204 | `ledger.js:352 deleteGlEntry` | ok | §12 (Delete draft row action) | pending |
| 6 | POST   | `/api/accounts/gl/{id}/lock` | `LockDraftEntry` | ADMIN/MANAGER+ | route `id` | anon `{ message }` | `ledger.js:426 lockGlEntry` | ok | §12.3 (Lock action button) | pending |
| 7 | POST   | `/api/accounts/gl/{id}/unlock` | `UnlockDraftEntry` | ADMIN/MANAGER+ | route `id` | anon `{ message }` | `ledger.js:443 unlockGlEntry` | ok | §12.3 (Unlock action) | pending |
| 8 | POST   | `/api/accounts/gl/{id}/post` | `PostGlEntry` | ADMIN+ | route `id` | `GlEntry` | `ledger.js:300 postGlEntry` (row action) + `ledger.js:624/630` (after Save & Post) | ok | §12.3 Fig — Post action button | pending |
| 9 | POST   | `/api/accounts/gl/{id}/reverse` | `ReverseGlEntry` | ADMIN+ | route `id` + `ReverseGlEntryRequest` | reversal `GlEntry` | `ledger.js:331 confirmReverse` | ok — sends `{reversal_date, reason}` | §12.3 Fig 12.3b | pending |

### 17. ExpenseController

Class route: `api/accounts/expenses`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/ExpenseModels.cs`):
- **ExpenseCategory** → `id, tenant_id, name, description, default_account_id, is_active, created_at, default_account_code`
- **ExpensePolicyModel** → `id, tenant_id, expense_category_id, name, max_amount, requires_receipt_above, auto_approve_below, description, is_active, category_name`
- **ExpenseClaim** → `id, tenant_id, claim_number, employee_id, claim_date, total_amount, status, description, project_id, gl_entry_id, approved_by, approved_at, rejection_reason, reimbursed_at, created_at, updated_at, items, employee_name`
- **ExpenseClaimItem** → `id, expense_claim_id, tenant_id, expense_category_id, expense_date, amount, description, receipt_file_id, created_at, category_name`
- **CreateExpenseCategoryRequest** → `name, description, default_account_id`
- **CreateExpensePolicyRequest** → `expense_category_id, name, max_amount, requires_receipt_above, auto_approve_below, description`
- **SubmitExpenseClaimRequest** → `claim_date, description, project_id, items: ExpenseClaimItemRequest[]`
- **ExpenseClaimItemRequest** → `expense_category_id, expense_date, amount, description`
- **RejectClaimBody** (in-controller) → `reason`
- **ReimburseClaimBody** (in-controller) → `bank_account_id`

> Notable: there are **no `DELETE policies/{id}` or `DELETE categories/{id}` endpoints** — but the recent expenses.js fix adds `deleteCategory` and `deletePolicy` row actions with target-named confirms. **Backend gap to flag:** the frontend can call delete row actions only if there's a corresponding endpoint. Verify in Phase 2 what those JS functions actually call.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/expenses/policies` | `GetPolicies` | USER+ | — | `List<ExpensePolicyModel>` | `expenses.js:262 loadExpensePolicies` | ok | §15.2 Fig 15.2.5 | pending |
| 2 | POST | `/api/accounts/expenses/policies` | `CreatePolicy` | ADMIN+ | `CreateExpensePolicyRequest` | 201 + anon `{ id }` | `expenses.js:400 saveExpensePolicy` (no id) | ok — sends `name, max_amount, requires_receipt_above, expense_category_id, description, is_active` (`is_active` silently dropped because not in CreateExpensePolicyRequest) | §15.2 Fig 15.2.6/7 | pending |
| 3 | PUT  | `/api/accounts/expenses/policies/{id}` | `UpdatePolicy` | ADMIN+ | route `id` + `CreateExpensePolicyRequest` | anon `{ message }` | `expenses.js:397 saveExpensePolicy` (id branch) | ⚠️ same — `is_active` in payload silently dropped (toggle has no effect) | §15.2 (edit policy) | gap |
| 3a | DELETE | `/api/accounts/expenses/policies/{id}` | (NO BACKEND ENDPOINT) | — | — | — | `expenses.js:327 deletePolicy` | **ORPHAN CALL** — Delete Policy row action will 405. Backend has GET/POST/PUT but no DELETE. | gap | gap |
| 4 | GET  | `/api/accounts/expenses/categories` | `GetCategories` | USER+ | — | `List<ExpenseCategory>` | `expenses.js:111 loadExpenseCategories` + line 70 (preload) | ok | §15.2 Fig 15.2.1 | pending |
| 5 | POST | `/api/accounts/expenses/categories` | `CreateCategory` | ADMIN+ | `CreateExpenseCategoryRequest` | 201 + anon `{ id }` | `expenses.js:245 saveExpenseCategory` (no id) | ok — sends `name, description, default_account_id` | §15.2 Fig 15.2.2/3/4 | pending |
| 6 | PUT  | `/api/accounts/expenses/categories/{id}` | `UpdateCategory` | ADMIN+ | route `id` + `CreateExpenseCategoryRequest` | anon `{ message }` | `expenses.js:242 saveExpenseCategory` (id branch) | ok | §15.2 (edit category) | pending |
| 6a | DELETE | `/api/accounts/expenses/categories/{id}` | (NO BACKEND ENDPOINT) | — | — | — | `expenses.js:175 deleteCategory` | **ORPHAN CALL** — Delete Category row action will 405. | gap | gap |
| 7 | GET  | `/api/accounts/expenses/claims` | `GetClaims` | USER+ | query `employeeId?, status?, limit, offset` | anon `{ data, total, stats }` | `expenses.js:422 loadExpenseClaims` | ok | §15.2 Fig 15.2.8 | pending |
| 8 | GET  | `/api/accounts/expenses/claims/{id}` | `GetClaimById` | USER+ | route `id` | `ExpenseClaim` (with items) or 404 | `expenses.js:589 viewClaim` | ⚠️ renders `i.date` for each item but backend `ExpenseClaimItem` field is `expense_date` → **claim detail items always show blank date** | TBD — view modal | gap |
| 9 | POST | `/api/accounts/expenses/claims` | `SubmitClaim` | USER+ | `SubmitExpenseClaimRequest` | 201 + `ExpenseClaim` | `expenses.js:573 saveExpenseClaim` | ok — sends `claim_date, description, items:[{expense_category_id, description, amount, expense_date}]` | §15.2 Fig 15.2.9/10 | pending |
| 10 | POST | `/api/accounts/expenses/claims/{id}/approve` | `ApproveClaim` | ADMIN/MANAGER+ | route `id` | `ExpenseClaim` after approval | `expenses.js:644 approveClaim` | ok | §15.2 Fig 15.2.11/12 | pending |
| 11 | POST | `/api/accounts/expenses/claims/{id}/reject` | `RejectClaim` | ADMIN/MANAGER+ | route `id` + optional `RejectClaimBody` | anon `{ message }` | `expenses.js:665 rejectClaim` | ok — sends `{reason}` | TBD — reject confirm | pending |
| 12 | POST | `/api/accounts/expenses/claims/{id}/reimburse` | `ReimburseClaim` | ADMIN+ | route `id` + optional `ReimburseClaimBody` | result of `BL.ReimburseExpenseClaim` | `expenses.js:707 reimburseClaim` | ok — sends `{bank_account_id}` | §15.2 Fig 15.2.13/14 | pending |

> ⚠️ **Phase 4 backend gap:** No DELETE endpoints for `categories/{id}` or `policies/{id}`. The frontend's recently-added `deleteCategory`/`deletePolicy` row actions with target-named confirms will fail unless they're using a different endpoint. Verify in Phase 2.

### 18. FixedAssetsController

Class route: `api/accounts/assets`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/FixedAssetModels.cs`):
- **AssetCategory** → `id, tenant_id, name, depreciation_method, useful_life_years, depreciation_rate, asset_account_id, depreciation_account_id, accumulated_dep_account_id, is_active, created_at`
- **FixedAsset** → `id, tenant_id, asset_code, name, description, asset_category_id, purchase_date, purchase_cost, salvage_value, book_value, accumulated_depreciation, status, disposal_date, disposal_amount, disposal_gl_entry_id, location, department, is_active, created_by, created_at, updated_at, category_name, depreciation_schedule`
- **AssetDepreciationEntry** → `id, tenant_id, fixed_asset_id, period_date, depreciation_amount, accumulated_amount, book_value_after, gl_entry_id, is_posted, created_at`
- **CreateAssetCategoryRequest** → `name, depreciation_method, useful_life_years, depreciation_rate, asset_account_id, depreciation_account_id, accumulated_dep_account_id`
- **RegisterAssetRequest** → `asset_code, name, description, asset_category_id, purchase_date, purchase_cost, salvage_value, location, department`
- **UpdateAssetBody** (in-controller) → `name, description, location, department`
- **DisposeAssetRequest** → `disposal_amount, disposal_date, bank_account_id`
- **RunDepreciationRequest** → `period_date`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/assets/categories` | `GetCategories` | USER+ | — | `List<AssetCategory>` | `assets.js:82 loadAssetCategories` | ok | §15.3 Fig 15.3.1 | pending |
| 2 | POST   | `/api/accounts/assets/categories` | `CreateCategory` | ADMIN+ | `CreateAssetCategoryRequest` | 201 + anon `{ id }` | `assets.js:171 saveAssetCategory` (no id) | ok — sends `name, depreciation_method, useful_life_years, depreciation_rate, asset_account_id, depreciation_account_id, accumulated_dep_account_id` (matches model) | §15.3 Fig 15.3.2/3/4 | pending |
| 3 | PUT    | `/api/accounts/assets/categories/{id}` | `UpdateCategory` | ADMIN+ | route `id` + `CreateAssetCategoryRequest` | anon `{ message }` | `assets.js:168 saveAssetCategory` (id branch) | ok | TBD | pending |
| 4 | DELETE | `/api/accounts/assets/categories/{id}` | `DeleteCategory` | ADMIN+ | route `id` | anon `{ message }` | `assets.js:186 deleteAssetCategory` | ok | TBD | pending |
| 5 | GET    | `/api/accounts/assets` | `GetAssets` | USER+ | query `status?` | anon `{ data, total, stats }` | `assets.js:234 loadAssets` | ok — defensive `purchase_cost \|\| cost` etc are dead fallbacks | §15.3 Fig 15.3.5/7 | pending |
| 6 | GET    | `/api/accounts/assets/{id}` | `GetAssetById` | USER+ | route `id` | `FixedAsset` (with schedule) or 404 | `assets.js:491 viewAssetDetail` | ok — reads `asset_code, name, asset_category_id, purchase_date, purchase_cost, salvage_value, book_value, accumulated_depreciation, location, department, description, status` | §15.3 Fig 15.3.8 | pending |
| 7 | POST   | `/api/accounts/assets` | `RegisterAsset` | ADMIN+ | `RegisterAssetRequest` | `FixedAsset` (fresh-fetched) | `assets.js:348 saveAsset` (no id) | ok — sends `asset_code, name, asset_category_id, purchase_date, purchase_cost, salvage_value, description` (no `location, department` — both optional) | §15.3 Fig 15.3.6/7 | pending |
| 8 | PUT    | `/api/accounts/assets/{id}` | `UpdateAsset` | ADMIN+ | route `id` + `UpdateAssetBody`; rejects 409 if not active | `FixedAsset` | `assets.js:345 saveAsset` (id branch) | ok — sends `{name, description}` (subset of UpdateAssetBody which also accepts `location, department` — UI doesn't expose those for editing) | §15.3 Fig 15.3.10 | pending |
| 9 | GET    | `/api/accounts/assets/{id}/depreciation` | `GetDepreciationSchedule` | USER+ | route `id` | depreciation schedule from BL | `assets.js:575 viewDepreciationSchedule` | ok via defensive `res?.schedule` fallback | §15.3 Fig 15.3.9 | pending |
| 10 | POST  | `/api/accounts/assets/run-depreciation` | `RunDepreciation` | ADMIN+ | `RunDepreciationRequest` | anon `{ message, assets_processed }` | `assets.js:443 runDepreciation` | ⚠️ frontend allows a category filter on the Run Depreciation form and sends `{period_date, category_id?}`, but `RunDepreciationRequest` only has `period_date`. **Category filter is silently ignored — depreciation always runs for ALL active assets**, regardless of dropdown selection. | §15.3 Fig 15.3.11/12/13 | gap |
| 11 | POST  | `/api/accounts/assets/{id}/dispose` | `DisposeAsset` | ADMIN+ | route `id` + `DisposeAssetRequest` | `FixedAsset` after disposal | `assets.js:391 confirmDispose` | ⚠️ sends `{disposal_date, disposal_amount}` but **omits `bank_account_id`** — backend accepts it, BL probably runs but disposal proceeds aren't linked to a bank deposit (the disposal cash never lands in a specific bank account in the GL entry). Verify BL behavior. | gap — disposal flow not in guide | gap |

### 19. BillingController

Class route: `api/accounts/billing`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`. `generate-invoices` runtime-gated by `IsAccountsAdmin()`.

DTO field reference (`Models/BillingModels.cs`):
- **BillingPlan** → `id, tenant_id, plan_code, name, description, billing_type, amount, currency, billing_cycle, trial_days, features (JSON), is_active, created_by, created_at, updated_at`
- **Subscription** → `id, tenant_id, customer_id, billing_plan_id, status, start_date, end_date, current_period_start, current_period_end, next_billing_date, trial_end_date, cancelled_at, cancellation_reason, metadata, created_by, created_at, updated_at, customer_name, plan_name`
- **UsageMeter** → `id, tenant_id, meter_code, name, unit, rate_per_unit, is_active, created_at`
- **TokenBalance** → `id, tenant_id, customer_id, balance, updated_at, customer_name`
- **TokenTransaction** → `id, tenant_id, customer_id, transaction_type, amount, balance_after, reason, reference_id, created_at`
- **CreateBillingPlanRequest** → `plan_code, name, description, billing_type, amount, billing_cycle, trial_days, features (object)`
- **UpdateBillingPlanRequest** → `id, name, description, amount, is_active`
- **CreateSubscriptionRequest** → `customer_id, billing_plan_id, start_date`
- **CancelSubscriptionRequest** → `reason`
- **CreateUsageMeterRequest** → `meter_code, name, unit, rate_per_unit`
- **RecordUsageRequest** → `customer_id, meter_code (string, not GUID!), quantity, metadata`
- **PurchaseTokensRequest** → `customer_id, amount`
- **DeductTokensRequest** → `customer_id, amount, reason`

> ⚠️ **`UpdateBillingPlanRequest` has only 5 fields** vs `CreateBillingPlanRequest`'s 9 — you can't change `billing_cycle`, `trial_days`, `billing_type`, or `features` after creation. The frontend Edit modal (Fig 15.4.3b) shows all fields though, which means either the frontend silently ignores those values or the backend silently ignores them. Field-binding gap to verify in Phase 2.

> **`RecordUsageRequest.meter_code` is a string** (`"API_CALLS"`) not a GUID. The frontend's recently-converted SearchableDropdown (Fig 15.4.5b) needs to confirm it's posting `meter_code` not `meter_id`. Field-binding check in Phase 2.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET    | `/api/accounts/billing/plans` | `GetPlans` | USER+ | — | `List<BillingPlan>` | `billing.js:133 loadPlans` | ok | §15.4.1 Fig 15.4.1 | pending |
| 2 | GET    | `/api/accounts/billing/plans/{id}` | `GetPlanById` | USER+ | route `id` | `BillingPlan` or 404 | `billing.js:186 viewPlan` | ok | §15.4.3a Fig 15.4.3a | pending |
| 3 | POST   | `/api/accounts/billing/plans` | `CreatePlan` | ADMIN+ | `CreateBillingPlanRequest` | `BillingPlan` (fresh-fetched) | `billing.js:262 savePlan` (no id) | ok — sends `name, plan_code, amount, billing_type, billing_cycle, description` (no `trial_days, features` — both optional) | §15.4.2/3 Fig 15.4.2/3 | pending |
| 4 | PUT    | `/api/accounts/billing/plans/{id}` | `UpdatePlan` | ADMIN+ | route `id` + `UpdateBillingPlanRequest` (only 4 nullable fields) | `BillingPlan` or 404 | `billing.js:259 savePlan` (id branch) | ok — frontend constructs an `updatePayload` with exactly the 4 backend-allowed fields `{name, description, amount, is_active}` and sends a separate shape from createPayload (Phase 1 warning resolved) | §15.4.3b Fig 15.4.3b | pending |
| 5 | DELETE | `/api/accounts/billing/plans/{id}` | `DeletePlan` | ADMIN+ | route `id` | anon `{ message }` | `billing.js:292 deletePlan` | ok | §15.4.3c Fig 15.4.3c | pending |
| 6 | GET    | `/api/accounts/billing/subscriptions` | `GetSubscriptions` | USER+ | query `customerId?` | `List<Subscription>` | `billing.js:311 loadSubscriptions` | ⚠️ sends dead `page, pageSize, search` params backend ignores; render reads `s.plan_id` but model has `billing_plan_id` → **plan column relies on `s.plan_name` fallback only**, no client-side cross-reference works | §15.4.4 Fig 15.4.4 / 15.4.4c | gap |
| 7 | GET    | `/api/accounts/billing/subscriptions/{id}` | `GetSubscriptionById` | USER+ | route `id` | `Subscription` or 404 | `billing.js:368 viewSubscription` | **MISMATCH (3)** — reads `s.plan_id` (model has `billing_plan_id`); reads `s.amount` (model has no `amount` — plan price is on the plan, not subscription); reads `s.cancel_reason` (model has `cancellation_reason`). View detail modal shows '-' for plan, amount, and cancel reason. | TBD | gap |
| 8 | POST   | `/api/accounts/billing/subscriptions` | `CreateSubscription` | ADMIN+ | `CreateSubscriptionRequest` | 201 + subscription | `billing.js:460 saveSubscription` | ok — sends `{customer_id, billing_plan_id, start_date}`; **note: guide §15.4.4b text mentions "Quantity 1" but neither the request DTO nor the Subscription model has a `quantity` field — guide claim is fictional** | §15.4.4a/b/c Fig 15.4.4a/b/c | gap |
| 9 | POST   | `/api/accounts/billing/subscriptions/{id}/cancel` | `CancelSubscription` | ADMIN+ | route `id` + `CancelSubscriptionRequest` | anon `{ message }` | `billing.js:474 cancelSubscription` | ok — sends `{reason: 'Cancelled by admin'}` (hardcoded — UI doesn't actually prompt for a reason despite the model accepting one) | TBD — cancel flow not in guide | pending |
| 10 | POST  | `/api/accounts/billing/generate-invoices` | `GenerateInvoices` | ADMIN+ | — | anon `{ message, invoices_generated }` | `billing.js:404 generateInvoices` | ok | §15.4.4c (Generate Invoices toolbar action) | pending |
| 11 | GET   | `/api/accounts/billing/usage-meters` | `GetUsageMeters` | USER+ | — | `List<UsageMeter>` | `billing.js:513 loadMeters` | ok send; **render does not display `rate_per_unit` anywhere** — the Usage Meters table only shows Name / Unit / Status / Actions | §15.4.5 Fig 15.4.5 | gap |
| 12 | POST  | `/api/accounts/billing/usage-meters` | `CreateUsageMeter` | ADMIN+ | `CreateUsageMeterRequest` | 201 + anon `{ id }` | `billing.js:593 saveMeter` (no id) | ⚠️ **`rate_per_unit` is hardcoded to `1`** in the payload — the Create Meter modal has no rate input. Every meter ever created has rate=1 regardless of intent. The guide §15.4.5a claims "API Calls at ₹0.05 per unit" — that price is **fictional**; the actual record has rate=1. **GAP — missing UI input + lying guide.** | §15.4.5a Fig 15.4.5a | gap |
| 13 | PUT   | `/api/accounts/billing/usage-meters/{id}` | `UpdateUsageMeter` | ADMIN+ | route `id` + `CreateUsageMeterRequest` | anon `{ message }` | `billing.js:590 saveMeter` (id branch) | same — rate hardcoded to 1 | TBD | gap |
| 14 | DELETE| `/api/accounts/billing/usage-meters/{id}` | `DeleteUsageMeter` | ADMIN+ | route `id` | anon `{ message }` | `billing.js:608 deleteMeter` | ok | TBD | pending |
| 15 | POST  | `/api/accounts/billing/usage` | `RecordUsage` | ADMIN+ | `RecordUsageRequest` (note `meter_code` is string!) | anon `{ message }` | `billing.js:652 recordUsage` | ok — correctly looks up `meter_code` from the meter object via `usageMeters.find(...).meter_code` and sends that as the string identifier (Phase 1 warning resolved) | §15.4.5b/c Fig 15.4.5b/c | pending |
| 16 | GET   | `/api/accounts/billing/tokens/{customerId}` | `GetTokenBalance` | USER+ | route `customerId` | `TokenBalance` or `{ balance: 0 }` | `billing.js:677 loadTokenBalance` | ok — reads `res.balance` | §15.4.6/6a Fig 15.4.6 / 15.4.6a | pending |
| 17 | POST  | `/api/accounts/billing/tokens/purchase` | `PurchaseTokens` | ADMIN+ | `PurchaseTokensRequest` | `TokenBalance` after purchase | `billing.js:702 purchaseTokens` | ok — sends `{customer_id, amount}` | §15.4.6 (Purchase Tokens form) | pending |
| 18 | POST  | `/api/accounts/billing/tokens/deduct` | `DeductTokens` | ADMIN+ | `DeductTokensRequest` | anon `{ remaining_balance }` | `billing.js:730 deductTokens` | ok — sends `{customer_id, amount, reason}` | §15.4.6 (Deduct Tokens form) | pending |

### 20. ReportsController

Class route: `api/accounts/reports`. Class-level `[Authorize(Roles = "ACCOUNTS_USER, ADMIN, MANAGER, AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/ReportModels.cs`):
- **ProfitLossReport** → `fiscal_year_id, sections: ProfitLossSection[], total_revenue, total_expenses, net_profit`
- **ProfitLossSection** → `account_type, accounts: ReportAccountRow[], section_total`
- **BalanceSheetReport** → `fiscal_year_id, as_of_date, sections, total_assets, total_liabilities, total_equity, current_year_pl, is_balanced`
- **BalanceSheetSection** → `account_type, accounts, section_total`
- **ReportAccountRow** → `account_code, account_name, balance`
- **LedgerReport** → `account_code, account_name, normal_balance, opening_balance, closing_balance, entries: LedgerEntry[]`
- **LedgerEntry** → `entry_date, entry_number, description, reference_type, debit_amount, credit_amount, running_balance`
- **DayBookEntry** → `entry_number, description, journal_type, reference_type, total_debit, total_credit, posted_by`
- Trial Balance / Cash Flow / AR Aging / AP Aging / Cash Book DTOs not in this file — defined inline by the BL methods.

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/reports/trial-balance` | `GetTrialBalance` | USER+ | query `fiscalYearId?` | trial balance shape from `BL.GetReportTrialBalance` | `reports.js:174 loadTrialBalance` | ok send; render reads defensively (`data.rows \|\| items \|\| accounts`) | §13.1 / §13.1a Fig 13.1 / 13.1a | pending |
| 2 | GET  | `/api/accounts/reports/profit-loss` | `GetProfitLoss` | USER+ | query `fiscalYearId?` | `ProfitLossReport` | `reports.js:190 loadProfitLoss` | ok send; verify render reads `sections, total_revenue, total_expenses, net_profit` in Phase 4 | §13.2 Fig 13.2 | pending |
| 3 | GET  | `/api/accounts/reports/balance-sheet` | `GetBalanceSheet` | USER+ | query `fiscalYearId?` | `BalanceSheetReport` | `reports.js:206 loadBalanceSheet` | ok | §13.3 | pending |
| 4 | GET  | `/api/accounts/reports/cash-flow` | `GetCashFlow` | USER+ | query `fiscalYearId?` | cash flow shape from BL | `reports.js:222 loadCashFlow` | ok | §13.4 | pending |
| 5 | GET  | `/api/accounts/reports/ledger` | `GetAccountLedger` | USER+ | query `accountId, fromDate, toDate` (all required) | `LedgerReport` | `reports.js:241 loadAccountLedger` | ok | TBD — Account Ledger tab | pending |
| 6 | GET  | `/api/accounts/reports/day-book` | `GetDayBook` | USER+ | query `date` | `List<DayBookEntry>` | `reports.js:258 loadDayBook` | ok | TBD — Day Book tab | pending |
| 7 | GET  | `/api/accounts/reports/cash-book` | `GetCashBook` | USER+ | query `bankAccountId?, fromDate, toDate` | cash book shape from BL | `reports.js:276 loadCashBook` | ok | TBD — Cash Book tab | pending |
| 8 | GET  | `/api/accounts/reports/ar-aging` | `GetARAging` | USER+ | — | AR aging shape from BL | `reports.js:290 loadARAgingReport` | ok | §10.4c / §13.5 | pending |
| 9 | GET  | `/api/accounts/reports/ap-aging` | `GetAPAging` | USER+ | — | AP aging shape from BL | `reports.js:302 loadAPAgingReport` | ok | §11.4b | pending |
| 10 | POST | `/api/accounts/reports/export/{reportType}` | `ExportReport` | USER+ | route `reportType` + query `format ('pdf'\|'csv'), fiscalYearId?` | `File` (only `trial-balance` to PDF wired) | `reports.js:319 exportReport` | sends `?format=` correctly with POST + blob response; **but backend only handles `trial-balance` reportType** — every other Export button (P&L, BS, CF, etc.) returns 400 | gap — backend implementation gap | gap |

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
| 1 | GET  | `/api/accounts/closing/checklists` | `GetChecklists` | ADMIN+ | query `fiscalYearId?` | `List<ClosingChecklist>` | `admin.js:624 loadChecklists` | ok | §15.5.5 Fig 15.5.5 | pending |
| 2 | POST | `/api/accounts/closing/checklists` | `StartChecklist` | ADMIN+ | `StartClosingRequest` | 201 + checklist | `admin.js:704 saveChecklist` (no id) | TBD — verify payload field names | §15.5.5 Fig 15.5.5a | pending |
| 2a | PUT | `/api/accounts/closing/checklists/{id}` | (NO BACKEND ENDPOINT) | — | — | — | `admin.js:701 saveChecklist` (id branch) | **ORPHAN CALL** — backend has no PUT for closing checklists. Edit Checklist row action will 405. | gap | gap |
| 3 | GET  | `/api/accounts/closing/checklists/{id}` | `GetChecklistById` | ADMIN+ | route `id` | `ClosingChecklist` (with items) | `admin.js:723 viewChecklist` + **`admin.js:838 loadYearEndPreflight`** | ⚠️ **CRITICAL: `loadYearEndPreflight` calls this endpoint with a `fiscalYearId` thinking it returns preflight checks**, but the route lookup is by checklist id. Result: 404 → catch shows fallback "All pre-flight checks passed. Ready for year-end closing." → **the destructive Year-End Closing button always becomes enabled with NO real preflight gating**. The figure 15.5.6a in the guide is fictional. | §15.5.5 Fig 15.5.5b / §15.5.6a (fictional) | gap |
| 4 | POST | `/api/accounts/closing/checklists/{id}/items/{itemId}/complete` | `CompleteItem` | ADMIN+ | two route params + `CompleteItemRequest?` | anon `{ message }` | `admin.js:781 completeChecklistItem` | ok | §15.5.5 Fig 15.5.5b | pending |
| 5 | POST | `/api/accounts/closing/checklists/{id}/complete` | `CompleteClosing` | ADMIN+ | route `id` | result of `BL.CompleteClosing` | `admin.js:801 completeChecklist` | ok | TBD | pending |
| 5a | DELETE | `/api/accounts/closing/checklists/{id}` | (NO BACKEND ENDPOINT) | — | — | — | `admin.js:816 deleteChecklist` | **ORPHAN CALL** — backend has no DELETE for checklists. Delete row action will 405. | gap | gap |
| 6 | POST | `/api/accounts/closing/year-end/{fiscalYearId}` | `YearEndClosing` | ADMIN+ | route `fiscalYearId` | anon `{ message, fiscal_year_id }` | `admin.js:896 closeFinancialYear` | ok | §15.5.6 Fig 15.5.6/15.5.6a — duplicates `FiscalController.CloseFiscalYear` | pending |

### 22. AuditController

Class route: `api/accounts/audit`. Class-level `[Authorize(Roles = "ACCOUNTS_ADMIN, ACCOUNTS_AUDITOR, SUPERADMIN")]`.

DTO field reference (`Models/AuditModels.cs`):
- **AuditLog** → `id, tenant_id, entity_type, entity_id, action, performed_by, details, ip_address, created_at, performed_by_name`
- **AuditLogQuery** → `entity_type, entity_id, performed_by, from_date, to_date, limit, offset`

| # | Verb | Route | Method | Roles | Request fields | Response fields | Frontend caller | Field binding | Guide ref | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET  | `/api/accounts/audit/logs` | `GetAuditLogs` | ADMIN/AUDITOR+ | query (7 params, mapped to `AuditLogQuery`) | anon `{ data: List<AuditLog>, total, limit, offset }` | `admin.js:138 loadAuditLogs` | ok | §15.5.1 Fig 15.5.1 / 15.5.1a / 15.5.1b | pending |
| 2 | GET  | `/api/accounts/audit/logs/{entityType}/{entityId}` | `GetEntityAuditTrail` | ADMIN/AUDITOR+ | two route params + query `limit` | `List<AuditLog>` | `admin.js:201` (entity audit drill-down modal) | ok | TBD — entity-audit modal | pending |
| 3 | GET  | `/api/accounts/audit/approvals/pending` | `GetPendingApprovals` | ADMIN/AUDITOR+ | — | anon `{ expense_claims: [...], total_pending }` | `dashboard.js:160` + `admin.js:301 loadPendingApprovals` | **MISMATCH** — frontend reads `res.total ?? res.count` but backend returns `total_pending` → dashboard badge always shows 0; admin.js Pending Approvals tab also reads same wrong key | §15.5.2 Fig 15.5.2 / §3.6 dashboard badge | gap |
| 3a | POST | `/api/accounts/audit/approvals/{id}/approve` | (NO BACKEND ENDPOINT) | — | — | — | `admin.js:367 approveApproval` | **ORPHAN CALL** — Pending Approvals row "Approve" action will 405. Backend has only the GET pending list, no per-item approve endpoint. | gap | gap |
| 3b | POST | `/api/accounts/audit/approvals/{id}/reject` | (NO BACKEND ENDPOINT) | — | — | — | `admin.js:386 rejectApproval` | **ORPHAN CALL** — Reject action will 405. | gap | gap |
| 4 | POST | `/api/accounts/audit/export` | `ExportAuditLogs` | ADMIN/AUDITOR+ | query `fromDate?, toDate?` | anon `{ export_format: "json", record_count, data }` (PDF/CSV deferred) | `admin.js:250 exportAuditLogs` | ok send (likely the JSON download is consumed as a file blob — verify in Phase 4) | gap — backend export is JSON only, no real CSV/PDF | gap |

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

| # | Caller | Method | URL | Notes |
|---|---|---|---|---|
| 1 | `setup.js:1079 saveFiscalYear` (id branch) | PUT | `/api/accounts/fiscal/years/{id}` | `FiscalController` has POST/GET/lock/unlock/close but no PUT. Edit fiscal year row action will 405. |
| 2 | `setup.js:1321 deleteJournalType` | DELETE | `/api/accounts/journals/types/{id}` | `JournalsController` has GET/POST/PUT but no DELETE. Delete row action will 405. |
| 3 | `receivables.js:421 saveInvoice` (id branch) | PUT | `/api/accounts/invoices/{id}` | `CustomerInvoicesController` has POST/DELETE/approve/send but no PUT. Edit invoice row action will 405. |
| 4 | `payables.js:679 deletePayment` | DELETE | `/api/accounts/vendor-bills/payments/{id}` | `VendorBillsController` has POST/GET on `/payments` but no DELETE. Void Payment row action will 405. |
| 5 | `expenses.js:175 deleteCategory` | DELETE | `/api/accounts/expenses/categories/{id}` | `ExpenseController` has GET/POST/PUT but no DELETE. Delete Category row action will 405. |
| 6 | `expenses.js:327 deletePolicy` | DELETE | `/api/accounts/expenses/policies/{id}` | Same — no DELETE. Delete Policy row action will 405. |
| 7 | `admin.js:367 approveApproval` | POST | `/api/accounts/audit/approvals/{id}/approve` | `AuditController` only has GET pending list, no per-item approve. Pending Approvals → Approve will 405. |
| 8 | `admin.js:386 rejectApproval` | POST | `/api/accounts/audit/approvals/{id}/reject` | Same — no per-item reject. Reject button will 405. |
| 9 | `admin.js:701 saveChecklist` (id branch) | PUT | `/api/accounts/closing/checklists/{id}` | `ClosingController` has GET/POST/items/complete/checklist/complete but no PUT. Edit Checklist row action will 405. |
| 10 | `admin.js:816 deleteChecklist` | DELETE | `/api/accounts/closing/checklists/{id}` | Same — no DELETE. Delete row action will 405. |

---

## Gap summary

> Built at the end of Phase 2. Phase 3 (guide coverage) will append to this.

### Critical bugs (show-stoppers for the investor demo)

These are real bugs that produce silently-wrong data — money flows that don't actually happen.

1. **Customer payment allocations are silently dropped.** `receivables.js:595 saveCustomerPayment` sends `allocations: [{invoice_id, amount}]` but backend `CustomerPaymentAllocationRequest` expects `{customer_invoice_id, allocated_amount}`. Payments record successfully but **invoice `balance_due` never decreases**. Same bug affects vendor payments (`payables.js:664 saveVendorPayment` → `{bill_id, amount}` should be `{vendor_bill_id, allocated_amount}`).
2. **Customer payment `reference` field**: frontend sends `reference`, backend wants `reference_number`. Reference number always blank on payment records. (vendor payments have it correct.)
3. **Year-End Closing preflight is fictional.** `admin.js:838 loadYearEndPreflight` calls `closing/checklists/{fiscalYearId}` but that route is `GetChecklistById(checklistId)`. 404 → catch shows "All pre-flight checks passed" → **Run Closing button always becomes enabled with NO real gating** for a destructive irreversible action. Fig 15.5.6a in the guide documents a non-functional UI.
4. **Save & Approve buttons (invoices + bills) don't approve.** Both pass `status: 'approved'` in the create payload but neither create-request DTO has a `status` field. Always saves as draft. User must hit Approve row action separately. Misleading button labels.
5. **Tax Rate create / update completely broken.** Sends `tax_config_id` + `account_id` but backend expects `tax_configuration_id` + `tax_account_id`. Both critical IDs silently dropped → 400 every save (`tax_configuration_id` is required and would be `Guid.Empty`).
6. **HSN/SAC create / update sends wrong field names.** Sends `type` and `tax_rate`; backend expects `code_type` and `default_tax_rate`. All rows save as HSN with no rate regardless of UI choice. Edit modal Type and Tax Rate fields also always blank.
7. **Tax Calculator output mostly broken.** Reads `data.breakdown` (backend has `tax_lines`), `data.tax_amount` (backend has `total_tax`), `data.total_amount` (doesn't exist). Stat cards mostly ₹0, breakdown table empty.
8. **GSTR-1 / GSTR-3B / TDS reports all broken.** All three read `data` directly instead of unwrapping `data.outward_supplies` / `data.inward_supplies` / `data.deductions`. All three project wrong row field names. GSTR-3B stat cards always ₹0; GSTR-1 / TDS render empty tables.
9. **Customer Invoice Edit button is an orphan.** `PUT /api/accounts/invoices/{id}` doesn't exist on the backend — clicking Edit on an existing invoice → 405. The whole "Save & Approve" / "edit then approve" UX is broken end-to-end.
10. **Dashboard "Pending Approvals" badge always shows 0.** Frontend reads `res.total ?? res.count`; backend returns `total_pending`. Badge never increments even when claims are pending.
11. **Customer Edit modal address field always blank.** `parties.js:491 editCustomer` reads `c.address_line1/2`; Customer model uses `billing_address_line1/2`. Save sends correct field, so create works, but edit can't display existing address. (Vendors are correct because Vendor model uses `address_line1`.)
12. **Usage meter rate is hardcoded to 1.** `billing.js:586 saveMeter` sends `rate_per_unit: 1` and the Create Meter modal has no rate input. Every meter ever created has rate=1, regardless of business intent. The guide §15.4.5a claims "API Calls at ₹0.05 per unit" — that's fictional; the saved record always has rate=1.

### Orphan frontend calls (10)

Each of these 10 row actions or buttons currently 405s in production. See "Orphan frontend calls" table above.

| # | UI button | Caller | Missing endpoint |
|---|---|---|---|
| 1 | Edit Fiscal Year | `setup.js:1079` | PUT `/fiscal/years/{id}` |
| 2 | Delete Journal Type | `setup.js:1321` | DELETE `/journals/types/{id}` |
| 3 | Edit Invoice | `receivables.js:421` | PUT `/invoices/{id}` |
| 4 | Void Vendor Payment | `payables.js:679` | DELETE `/vendor-bills/payments/{id}` |
| 5 | Delete Expense Category | `expenses.js:175` | DELETE `/expenses/categories/{id}` |
| 6 | Delete Expense Policy | `expenses.js:327` | DELETE `/expenses/policies/{id}` |
| 7 | Approve Pending (Admin) | `admin.js:367` | POST `/audit/approvals/{id}/approve` |
| 8 | Reject Pending (Admin) | `admin.js:386` | POST `/audit/approvals/{id}/reject` |
| 9 | Edit Closing Checklist | `admin.js:701` | PUT `/closing/checklists/{id}` |
| 10 | Delete Closing Checklist | `admin.js:816` | DELETE `/closing/checklists/{id}` |

### Backend stubs / partial implementations (8)

Backend advertises functionality it doesn't deliver. Frontend calls them and renders empty.

| # | Endpoint | Stub kind |
|---|---|---|
| 1 | `system/integrity-check/results` | returns placeholder, doesn't query the table |
| 2 | `system/job-log` | returns placeholder, doesn't return rows |
| 3 | `coa/import` | accepts payload, no-op (deferred S15) — also frontend wire-format mismatch (multipart vs JSON) |
| 4 | `reports/export/{reportType}` | only `trial-balance` to PDF wired; other report types 400 |
| 5 | `audit/export` | hardcoded `export_format: 'json'`, no real CSV/PDF |
| 6 | `audit/approvals/pending` | only surfaces expense_claims, not all approval-gated entities |
| 7 | `bank/webhooks/stripe` | signature verification stubbed |
| 8 | `closing/checklists/{id}` (read by year-end preflight) | the endpoint itself works; it's the **frontend's misuse** that makes preflight fictional |

### Silent-drop fields (frontend sends, backend ignores)

Most are non-fatal but they all mislead users — the form looks like it captured data, but the data went nowhere.

| # | Where | Frontend sends | Backend accepts |
|---|---|---|---|
| 1 | `coa/groups` PUT | `account_type_id, code, parent_group_id` | only `name, description, display_order, is_active` |
| 2 | `coa/{id}` PUT | `account_code, account_type_id, parent_account_id, normal_balance` | only `name, description, account_group_id, is_active, allow_direct_posting` |
| 3 | `journals/types` PUT | `code` | only `name, description, is_active` |
| 4 | `expenses/policies` POST/PUT | `is_active` | not in `CreateExpensePolicyRequest` — the active toggle has no effect |
| 5 | `invoices` POST | per-line `hsn_sac` | `CreateCustomerInvoiceLineRequest` has no HSN field |
| 6 | `invoices` POST | top-level `status` | no `status` in `CreateCustomerInvoiceRequest` |
| 7 | `vendor-bills` POST | top-level `status` | same |
| 8 | `assets/run-depreciation` | `category_id` | `RunDepreciationRequest` only has `period_date` — category filter ignored |
| 9 | `assets/{id}/dispose` | (missing) `bank_account_id` | required for the GL posting to land in a bank |
| 10 | All the snake_case query param bugs (`customer_id`, `date_from`, `pageSize`, `page`) — backend uses camelCase `customerId, fromDate, limit, offset` — filters silently dropped on payments, credit-notes, statements, vendor-payments lists |

### Documentation lies (Phase 5 priority)

The guide describes things that the UI cannot actually do:

1. **§15.4.4b "Quantity 1"** — neither `CreateSubscriptionRequest` nor `Subscription` has a quantity field. Subscriptions are 1× plan, full stop.
2. **§15.4.5a "rate ₹0.05 per unit"** — UI hardcodes rate to 1 and doesn't expose a rate input. Every meter has rate=1.
3. **§15.5.6a "Year-End preflight panel"** — fictional. The panel always shows "All pre-flight checks passed" because the underlying request 404s.
4. **§15.5.4 "Job Log"** — backend stub, the populated screenshot (if it ever existed) was fake.
5. **§15.2.13 "Reimburse modal Bank Account dropdown"** — works, but the figure should also note that disposal proceeds for fixed assets bypass the bank entirely (no `bank_account_id` sent).

### Counts

| Category | Count |
|---|---|
| Total endpoints walked | 204 |
| Endpoints with frontend caller | ~165 |
| Endpoints flagged `gap` | 51 |
| Endpoints flagged `N/A` | 11 (webhooks, copilot bridge, encryption migration, etc.) |
| Orphan frontend calls | 10 |
| Critical accounting bugs | 12 |
| Backend stubs | 8 |
| Silent-drop field mismatches | 10+ |
| Documentation lies | 5 |

---

## Decisions log

> Anything we deliberately marked `N/A` or deferred. One line each, with the reason. So a future
> session doesn't relitigate.

- **PMS/CRM/Procurement consolidation** — in scope but deferred to **Phase 4b** after the in-Accounts gaps are clean. Reason: it changes gRPC contracts in 4 services and shouldn't be tangled with the Tier-1-to-6 frontend/backend bug fixes.

---

## Phase 4 fix log

> Append-only log of every fix applied during Phase 4. Each entry includes the proof that the fix
> works (the second-order state change observed via Playwright). If a session crashes, the next
> session starts with the highest-numbered task that is still `pending` or `in_progress`.

### Tier 1 — Critical accounting integrity (5/5 ✓)

| # | Fix | Files | SW | Two-step proof |
|---|---|---|---|---|
| 1a | Customer payment allocation field names | `js/accounts/receivables.js:573 saveCustomerPayment` (`reference→reference_number`, alloc shape `{customer_invoice_id, allocated_amount}`) + `loadCustomerInvoicesForPayment` (camelCase `customerId`, drop dead status filter, read `balance_due`) | 875 | INV-2026-00001 went **balance_due 10000→6000, status approved→partially_paid, paid_amount 0→4000** after recording payment via Playwright UI. Receivables list visually shows ₹6,000 balance + "Partially Paid" badge + Total Receivable tile dropped 10000→6000. Screenshot: `images/_FIX_T1_payment_allocations_proof.png` |
| 1b | Vendor payment allocation field names | `js/accounts/payables.js:635 saveVendorPayment` (alloc shape `{vendor_bill_id, allocated_amount}`) + `loadVendorOpenBills` (read `balance_due`, client-side status filter) | 876 | BILL-2026-00002 went **balance_due 8000→5000, status approved→partially_paid, paid_amount 0→3000** after manual API call with new shape. Payables list visually shows "Partially Paid" + ₹13,000 Total Outstanding (was ₹18,000). Screenshot: `images/_FIX_T1_vendor_payment_proof.png` |
| 2a | Save & Approve invoices | `js/accounts/receivables.js saveInvoice` — drop `status` from payload, chain `POST /approve` when `approve===true` | 877 | Spy captured 2 calls: `POST /invoices` (no `status` field), then `POST /invoices/{id}/approve`. INV-2026-00002 lands as `status="approved"` with `gl_entry_id=650ee852...` (real GL entry posted). `approved_count: 0→1`. |
| 2b | Save & Approve vendor bills | `js/accounts/payables.js saveBill` — same pattern | 877 | Spy captured `POST /vendor-bills` (no `status`), `POST /vendor-bills/{id}/approve`. BILL-2026-00003 status=approved, `gl_entry_id=a5f73ef9...`. |
| 3 | Year-End preflight uses real integrity check | `js/accounts/admin.js:829 loadYearEndPreflight` — was hitting `closing/checklists/{fyId}` (404→fictional fallback), now hits `POST system/integrity-check` and renders the 3 real PASS/FAIL rows; closing button gates on `allPassed` | 878 | Spy captured `POST /system/integrity-check`. Rendered table shows 3 real rows: GL Balance PASS (₹34,500=₹34,500), Account Balance Drift PASS, Period Balance Consistency PASS. |
| 4 | Dashboard pending approvals badge | `js/accounts/dashboard.js:155 loadPendingApprovals` (`res.total_pending`); `pages/accounts/dashboard.html` (added badge slot to Admin nav card); `js/accounts/admin.js:296 loadPendingApprovals` (read `res.expense_claims` envelope, normalize to renderer shape) | 879→880 | Submitted EXP-2026-00001 ₹1,500 → dashboard badge shows **"1"**, desc reads **"1 item awaiting your approval"** (was always "0" / "No pending approvals"). Admin Pending Approvals tab also renders the row with title/type/date/amount and Approve/Reject buttons (backend endpoints orphan until Tier 3). |

### Bonus fix — discovered during fresh-DB seeding

| # | Fix | File | Reason |
|---|---|---|---|
| B1 | COA template `ON CONFLICT` clause | `AccountsService/DatabaseLayers/DatabaseLayer_ChartOfAccounts.cs:330` — added `WHERE is_active = true` predicate to match the partial unique index `uq_accounts_tenant_code_active` | Original tenant was set up before the partial index existed; fresh DB exposed that the SQL planner couldn't infer the index without the WHERE clause → 42P10 error → COA template setup completely broken on any new tenant. |
