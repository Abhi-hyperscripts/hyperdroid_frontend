# CRM — Bugs Fixed During Capture

Append-only log. Each entry: symptom → root cause → fix → file:line → triggering modal/page.

---

## 2026-04-14 — Session B (Companies create + cross-service approval)

### Bug 1: New CRM company persisted with `is_active = TRUE` despite BL setting `false`

- **Symptom.** After clicking Create Company in CRM, the local `companies` row
  was stored with `is_active = TRUE`, even though `BusinessLayer.CreateCompanyAsync`
  explicitly constructs the `Company` object with `IsActive = false` because
  Accounts has not yet approved.
- **Root cause.** `DatabaseLayer_Companies.CreateCompanyWithIdAsync` did not
  include `is_active` in its INSERT column list. Postgres fell back to the
  table default `is_active BOOLEAN DEFAULT true`, silently overriding the BL
  intent.
- **Fix.** Added `is_active` to the INSERT and bound `@is_active` from
  `company.IsActive`.
- **File.** `CRM/DatabaseLayers/DatabaseLayer_Companies.cs` (CreateCompanyWithIdAsync).
- **Triggering page.** `pages/crm/companies.html` → New Company modal → Create.

### Bug 2: Pending companies invisible in CRM Companies list

- **Symptom.** After creating a new company in CRM, the Companies grid showed
  "No companies yet". The user got zero feedback that their submission had
  worked, and had no way to tell that approval was pending in Accounts.
- **Root cause.** `BusinessLayer.GetCompaniesAsync` only fetched data via
  `_accountsGrpcClient.ListCustomersAsync` (i.e., from the Accounts
  `customers` table). New CRM companies live as `client_vendor_requests` on
  the Accounts side until approved — they are NOT yet in `customers`. The
  local CRM `companies` cache row (which we DO write at submit time) was
  never read for the listing path, so a freshly-submitted company was
  invisible everywhere in CRM.
- **Fix.** `BusinessLayer.GetCompaniesAsync` now merges:
  1. Approved customers from Accounts (Status = "active").
  2. Local CRM `companies` rows whose id is NOT in the approved set
     (Status = "pending_approval").
  And self-heals: if a local row is `is_active=false` but the matching
  Accounts customer now exists, it flips `is_active=true`.
- **Files.**
  - `CRM/BusinessLayers/BusinessLayer_Companies.cs` (GetCompaniesAsync)
  - `CRM/DatabaseLayers/DatabaseLayer_Companies.cs` (new MarkCompanyApprovedAsync,
    dropped `is_active = true` filter from GetCompaniesAsync/GetCompanyByIdAsync,
    surfaced Status in MapCompany)
  - `CRM/Models/CrmModels.cs` (added transient `Status` property on `Company`)
  - `Frontend/pages/crm/companies.html` (added Status column header)
  - `Frontend/js/crm/companies.js` (new `renderCompanyStatus`, status-aware
    Edit/Delete actions — disabled with "Awaiting approval" placeholder for
    pending rows since there is no Accounts customer to update yet)
  - `Frontend/js/sw-version.js` (bumped to 1029)
- **Triggering page.** `pages/crm/companies.html` after creating a company
  through New Company modal.

### Bug 3: Approved customer/vendor created with NULL `customer_code`/`vendor_code`

- **Symptom.** After approving a `client_vendor_request`, the resulting
  `customers` row had a blank `customer_code` (UI showed "—" in the Code
  column on `parties.html` Customer List). Same risk for vendor approvals.
- **Root cause.** Approval flow in
  `BusinessLayer_ClientVendorRequests.Review` populates
  `CreateCustomerRequest.customer_code` from `request.code`, but the CRM
  submit path never fills `code`, the Approve modal does not ask the admin
  for one, and the DB layer's `CreateCustomer` / `CreateCustomerWithIdAsync`
  did not auto-generate when missing — so the column was inserted as NULL
  even though the model docs claim "Auto-generated if not provided".
- **Fix.** Implemented true auto-generation. Added private
  `GenerateNextCustomerCodeAsync(tenantId, conn)` and
  `GenerateNextVendorCodeAsync(tenantId, conn)` helpers that read the max
  numeric suffix from existing `CUST-NNNN` / `VEND-NNNN` codes for the
  tenant and increment. Both `CreateCustomer`/`CreateCustomerWithIdAsync`
  and `CreateVendor`/`CreateVendorWithIdAsync` now call the helper before
  INSERT when the request's code is null/blank. The unique
  `(tenant_id, customer_code)` and `(tenant_id, vendor_code)` constraints
  remain the final guard against any race.
- **Files.**
  - `AccountsService/DatabaseLayers/DatabaseLayer_Customers.cs`
  - `AccountsService/DatabaseLayers/DatabaseLayer_Vendors.cs`
- **Triggering page.** `pages/accounts/parties.html#pending-customers`
  → green-check Approve → fill required fields → Approve & Create.

### Architectural refactor: CRM Companies are local until Deal Won

- **Symptom (architectural, not a runtime bug).** Every new CRM company was
  forced through the Accounts approval queue at creation time. Sales adds
  dozens of prospects per day and 95% never become customers — this created
  pointless backlog for Finance, slowed sales workflow, and made Bug 2
  necessary in the first place (the merge/self-heal logic for "pending"
  rows). It is the inverse of the universal CRM↔ERP pattern (Salesforce↔
  NetSuite, HubSpot↔QuickBooks, Pipedrive↔Xero) where CRM is the wide
  top-of-funnel and ERP is the narrow bottom that only sees real customers.
- **Fix.**
  - `BusinessLayer_Companies.CreateCompanyAsync` no longer calls Accounts.
    Companies are inserted into the local CRM `companies` table only, with
    `IsActive=true` and `Status="prospect"`.
  - `BusinessLayer_Companies.GetCompaniesAsync` reads the local table and
    best-effort enriches each row's `Status` to `"customer"` if Accounts
    has a customer with the same id. Falls back to `"prospect"` if Accounts
    is unreachable. The merge/pending/self-heal logic from Bug 2 is gone.
  - `BusinessLayer_Companies.UpdateCompanyAsync` / `DeleteCompanyAsync` are
    now local-only (no gRPC).
  - `BusinessLayer_Deals.MarkDealWonAsync` removed the "company must be
    approved in Accounts" guard. Instead, on Won, it calls a new
    `TryPromoteCompanyToAccountsAsync` helper that submits a
    `client_vendor_request` to Accounts. Idempotent — no-op if the customer
    already exists. Best-effort — never blocks the win.
  - Frontend `companies.js` `renderCompanyStatus` now renders "Prospect"
    (neutral) or "Customer" (green). Edit/Delete are always available
    regardless of status (no more "Awaiting approval" placeholder).
  - `js/sw-version.js` bumped to 1030.
- **Files.**
  - `CRM/BusinessLayers/BusinessLayer_Companies.cs` (rewritten)
  - `CRM/BusinessLayers/BusinessLayer_Deals.cs` (Won path + new helper)
  - `Frontend/js/crm/companies.js` (status badge + actions)
  - `Frontend/js/sw-version.js`
