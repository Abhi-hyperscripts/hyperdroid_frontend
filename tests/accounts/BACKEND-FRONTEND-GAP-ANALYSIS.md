# Accounts Module — Backend vs Frontend API Gap Analysis

**Generated:** 2026-04-04
**Backend Endpoints:** 167 | **Frontend Implemented:** 139 | **Not Implemented:** 28
**Coverage:** 83%

---

## Legend

| Symbol | Meaning |
|--------|---------|
| TRUE | Frontend calls this endpoint |
| FALSE | Backend endpoint exists but frontend does NOT call it |

---

## 1. HealthController (`api/health`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| HealthController | `/api/health` | GET | - | FALSE |

---

## 2. FiscalController (`api/accounts/fiscal`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| FiscalController | `/fiscal/years` | GET | setup.js, reports.js, admin.js | TRUE |
| FiscalController | `/fiscal/years/active` | GET | - | FALSE |
| FiscalController | `/fiscal/years/{id}` | GET | - | FALSE |
| FiscalController | `/fiscal/years` | POST | setup.js | TRUE |
| FiscalController | `/fiscal/periods` | GET | setup.js | TRUE |
| FiscalController | `/fiscal/periods/{id}/lock` | POST | setup.js | TRUE |
| FiscalController | `/fiscal/periods/{id}/unlock` | POST | setup.js | TRUE |
| FiscalController | `/fiscal/years/{id}/close` | POST | setup.js | TRUE |

---

## 3. VendorsController (`api/accounts/vendors`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| VendorsController | `/vendors` | GET | parties.js, payables.js | TRUE |
| VendorsController | `/vendors/{id}` | GET | - | FALSE |
| VendorsController | `/vendors` | POST | parties.js | TRUE |
| VendorsController | `/vendors/{id}` | PUT | parties.js | TRUE |

---

## 4. CustomersController (`api/accounts/customers`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| CustomersController | `/customers` | GET | parties.js, receivables.js | TRUE |
| CustomersController | `/customers/{id}` | GET | - | FALSE |
| CustomersController | `/customers` | POST | parties.js | TRUE |
| CustomersController | `/customers/{id}` | PUT | parties.js | TRUE |

---

## 5. ChartOfAccountsController (`api/accounts/coa`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| ChartOfAccountsController | `/coa/types` | GET | setup.js | TRUE |
| ChartOfAccountsController | `/coa/groups` | GET | setup.js | TRUE |
| ChartOfAccountsController | `/coa/groups` | POST | setup.js | TRUE |
| ChartOfAccountsController | `/coa/groups/{id}` | PUT | setup.js | TRUE |
| ChartOfAccountsController | `/coa` | GET | setup.js, reports.js, ledger.js, expenses.js, assets.js, taxation.js, payables.js, receivables.js | TRUE |
| ChartOfAccountsController | `/coa/tree` | GET | setup.js | TRUE |
| ChartOfAccountsController | `/coa/{id}` | GET | - | FALSE |
| ChartOfAccountsController | `/coa` | POST | setup.js | TRUE |
| ChartOfAccountsController | `/coa/{id}` | PUT | setup.js | TRUE |
| ChartOfAccountsController | `/coa/{id}` | DELETE | setup.js | TRUE |
| ChartOfAccountsController | `/coa/opening-balances` | POST | setup.js | TRUE |
| ChartOfAccountsController | `/coa/balances` | GET | setup.js | TRUE |
| ChartOfAccountsController | `/coa/setup-template` | POST | setup.js | TRUE |
| ChartOfAccountsController | `/coa/import` | POST | - | FALSE |

---

## 6. GeneralLedgerController (`api/accounts/gl`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| GeneralLedgerController | `/gl` | GET | ledger.js, dashboard.js | TRUE |
| GeneralLedgerController | `/gl/{id}` | GET | ledger.js | TRUE |
| GeneralLedgerController | `/gl` | POST | ledger.js | TRUE |
| GeneralLedgerController | `/gl/{id}` | PUT | - | FALSE |
| GeneralLedgerController | `/gl/{id}` | DELETE | ledger.js | TRUE |
| GeneralLedgerController | `/gl/{id}/lock` | POST | - | FALSE |
| GeneralLedgerController | `/gl/{id}/unlock` | POST | - | FALSE |
| GeneralLedgerController | `/gl/{id}/post` | POST | ledger.js | TRUE |
| GeneralLedgerController | `/gl/{id}/reverse` | POST | ledger.js | TRUE |

---

## 7. JournalsController (`api/accounts/journals`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| JournalsController | `/journals/types` | GET | ledger.js, setup.js | TRUE |
| JournalsController | `/journals/types/{id}` | GET | - | FALSE |
| JournalsController | `/journals/types` | POST | setup.js | TRUE |
| JournalsController | `/journals/types/{id}` | PUT | setup.js | TRUE |
| JournalsController | `/journals/entries` | GET | ledger.js | TRUE |

---

## 8. VendorBillsController (`api/accounts/vendor-bills`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| VendorBillsController | `/vendor-bills` | GET | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/{id}` | GET | payables.js | TRUE |
| VendorBillsController | `/vendor-bills` | POST | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/{id}` | PUT | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/{id}/cancel` | POST | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/{id}/approve` | POST | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/payments` | POST | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/payments` | GET | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/aging` | GET | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/vendors/{vendorId}/statement` | GET | payables.js | TRUE |
| VendorBillsController | `/vendor-bills/bulk` | POST | - | FALSE |

---

## 9. CustomerInvoicesController (`api/accounts/invoices`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| CustomerInvoicesController | `/invoices` | GET | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/{id}` | GET | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices` | POST | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/{id}` | DELETE | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/{id}/approve` | POST | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/{id}/send` | POST | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/payments` | POST | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/payments` | GET | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/aging` | GET | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/customers/{customerId}/statement` | GET | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/credit-notes` | POST | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/credit-notes` | GET | receivables.js | TRUE |
| CustomerInvoicesController | `/invoices/bulk` | POST | - | FALSE |

---

## 10. BankController (`api/accounts/bank`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| BankController | `/bank/accounts` | GET | banking.js, reports.js, expenses.js | TRUE |
| BankController | `/bank/accounts/{id}` | GET | banking.js | TRUE |
| BankController | `/bank/accounts` | POST | banking.js | TRUE |
| BankController | `/bank/accounts/{id}` | PUT | banking.js | TRUE |
| BankController | `/bank/accounts/{id}/transactions` | GET | banking.js | TRUE |
| BankController | `/bank/accounts/{id}/transactions` | POST | banking.js | TRUE |
| BankController | `/bank/accounts/{bankId}/transactions/{txnId}` | DELETE | banking.js | TRUE |
| BankController | `/bank/transfer` | GET | banking.js | TRUE |
| BankController | `/bank/transfer` | POST | banking.js | TRUE |
| BankController | `/bank/reconciliations` | POST | banking.js | TRUE |
| BankController | `/bank/reconciliations/{id}` | PUT | banking.js | TRUE |
| BankController | `/bank/reconciliations/{id}/complete` | POST | banking.js | TRUE |
| BankController | `/bank/dashboard` | GET | - | FALSE |
| BankController | `/bank/webhooks/razorpay` | POST | - | FALSE |
| BankController | `/bank/webhooks/stripe` | POST | - | FALSE |

---

## 11. ExpenseController (`api/accounts/expenses`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| ExpenseController | `/expenses/categories` | GET | expenses.js | TRUE |
| ExpenseController | `/expenses/categories` | POST | expenses.js | TRUE |
| ExpenseController | `/expenses/categories/{id}` | PUT | expenses.js | TRUE |
| ExpenseController | `/expenses/policies` | GET | expenses.js | TRUE |
| ExpenseController | `/expenses/policies` | POST | expenses.js | TRUE |
| ExpenseController | `/expenses/policies/{id}` | PUT | expenses.js | TRUE |
| ExpenseController | `/expenses/claims` | GET | expenses.js | TRUE |
| ExpenseController | `/expenses/claims/{id}` | GET | expenses.js | TRUE |
| ExpenseController | `/expenses/claims` | POST | expenses.js | TRUE |
| ExpenseController | `/expenses/claims/{id}/approve` | POST | expenses.js | TRUE |
| ExpenseController | `/expenses/claims/{id}/reject` | POST | expenses.js | TRUE |
| ExpenseController | `/expenses/claims/{id}/reimburse` | POST | expenses.js | TRUE |

---

## 12. ReportsController (`api/accounts/reports`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| ReportsController | `/reports/trial-balance` | GET | reports.js | TRUE |
| ReportsController | `/reports/profit-loss` | GET | reports.js | TRUE |
| ReportsController | `/reports/balance-sheet` | GET | reports.js | TRUE |
| ReportsController | `/reports/cash-flow` | GET | reports.js | TRUE |
| ReportsController | `/reports/ledger` | GET | reports.js | TRUE |
| ReportsController | `/reports/day-book` | GET | reports.js | TRUE |
| ReportsController | `/reports/cash-book` | GET | reports.js | TRUE |
| ReportsController | `/reports/ar-aging` | GET | reports.js | TRUE |
| ReportsController | `/reports/ap-aging` | GET | reports.js | TRUE |
| ReportsController | `/reports/export/{reportType}` | POST | reports.js | TRUE |

---

## 13. TaxationController (`api/accounts/tax`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| TaxationController | `/tax/configurations` | GET | taxation.js | TRUE |
| TaxationController | `/tax/configurations/{id}` | GET | - | FALSE |
| TaxationController | `/tax/configurations` | POST | taxation.js | TRUE |
| TaxationController | `/tax/configurations/{id}` | PUT | taxation.js | TRUE |
| TaxationController | `/tax/configurations/{id}` | DELETE | taxation.js | TRUE |
| TaxationController | `/tax/rates` | GET | taxation.js | TRUE |
| TaxationController | `/tax/rates` | POST | taxation.js | TRUE |
| TaxationController | `/tax/rates/{id}` | PUT | taxation.js | TRUE |
| TaxationController | `/tax/rates/{id}` | DELETE | taxation.js | TRUE |
| TaxationController | `/tax/hsn-sac` | GET | taxation.js | TRUE |
| TaxationController | `/tax/hsn-sac` | POST | taxation.js | TRUE |
| TaxationController | `/tax/hsn-sac/{id}` | PUT | taxation.js | TRUE |
| TaxationController | `/tax/hsn-sac/{id}` | DELETE | taxation.js | TRUE |
| TaxationController | `/tax/calculate` | POST | taxation.js | TRUE |
| TaxationController | `/tax/ledger` | GET | taxation.js | TRUE |
| TaxationController | `/tax/seed-india` | POST | taxation.js | TRUE |
| TaxationController | `/tax/reports/gstr1` | GET | taxation.js | TRUE |
| TaxationController | `/tax/reports/gstr3b` | GET | taxation.js | TRUE |
| TaxationController | `/tax/reports/tds` | GET | taxation.js | TRUE |

---

## 14. FixedAssetsController (`api/accounts/assets`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| FixedAssetsController | `/assets/categories` | GET | assets.js | TRUE |
| FixedAssetsController | `/assets/categories` | POST | assets.js | TRUE |
| FixedAssetsController | `/assets/categories/{id}` | PUT | assets.js | TRUE |
| FixedAssetsController | `/assets/categories/{id}` | DELETE | assets.js | TRUE |
| FixedAssetsController | `/assets` | GET | assets.js | TRUE |
| FixedAssetsController | `/assets/{id}` | GET | - | FALSE |
| FixedAssetsController | `/assets` | POST | assets.js | TRUE |
| FixedAssetsController | `/assets/{id}` | PUT | assets.js | TRUE |
| FixedAssetsController | `/assets/{id}/depreciation` | GET | - | FALSE |
| FixedAssetsController | `/assets/run-depreciation` | POST | assets.js | TRUE |
| FixedAssetsController | `/assets/{id}/dispose` | POST | assets.js | TRUE |

---

## 15. BillingController (`api/accounts/billing`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| BillingController | `/billing/plans` | GET | billing.js | TRUE |
| BillingController | `/billing/plans/{id}` | GET | - | FALSE |
| BillingController | `/billing/plans` | POST | billing.js | TRUE |
| BillingController | `/billing/plans/{id}` | PUT | billing.js | TRUE |
| BillingController | `/billing/plans/{id}` | DELETE | billing.js | TRUE |
| BillingController | `/billing/subscriptions` | GET | billing.js | TRUE |
| BillingController | `/billing/subscriptions/{id}` | GET | - | FALSE |
| BillingController | `/billing/subscriptions` | POST | billing.js | TRUE |
| BillingController | `/billing/subscriptions/{id}/cancel` | POST | billing.js | TRUE |
| BillingController | `/billing/generate-invoices` | POST | - | FALSE |
| BillingController | `/billing/usage-meters` | GET | billing.js | TRUE |
| BillingController | `/billing/usage-meters` | POST | billing.js | TRUE |
| BillingController | `/billing/usage-meters/{id}` | PUT | billing.js | TRUE |
| BillingController | `/billing/usage-meters/{id}` | DELETE | billing.js | TRUE |
| BillingController | `/billing/usage` | POST | billing.js | TRUE |
| BillingController | `/billing/tokens/{customerId}` | GET | billing.js | TRUE |
| BillingController | `/billing/tokens/purchase` | POST | billing.js | TRUE |
| BillingController | `/billing/tokens/deduct` | POST | billing.js | TRUE |

---

## 16. AuditController (`api/accounts/audit`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| AuditController | `/audit/logs` | GET | admin.js | TRUE |
| AuditController | `/audit/logs/{entityType}/{entityId}` | GET | - | FALSE |
| AuditController | `/audit/approvals/pending` | GET | admin.js, dashboard.js | TRUE |
| AuditController | `/audit/export` | POST | admin.js | TRUE |

---

## 17. SystemController (`api/accounts/system`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| SystemController | `/system/integrity-check` | POST | admin.js | TRUE |
| SystemController | `/system/gl-summary` | GET | dashboard.js | TRUE |
| SystemController | `/system/recompute-balances` | POST | admin.js | TRUE |
| SystemController | `/system/integrity-check/results` | GET | - | FALSE |
| SystemController | `/system/job-log` | GET | admin.js | TRUE |

---

## 18. ClosingController (`api/accounts/closing`)

| Controller | Route | Method | Frontend Page | Implemented |
|-----------|-------|--------|---------------|-------------|
| ClosingController | `/closing/checklists` | GET | admin.js | TRUE |
| ClosingController | `/closing/checklists` | POST | admin.js | TRUE |
| ClosingController | `/closing/checklists/{id}` | GET | admin.js | TRUE |
| ClosingController | `/closing/checklists/{id}/items/{itemId}/complete` | POST | - | FALSE |
| ClosingController | `/closing/checklists/{id}/complete` | POST | - | FALSE |
| ClosingController | `/closing/year-end/{fiscalYearId}` | POST | admin.js | TRUE |

---

## Summary: Unimplemented Endpoints (28)

| # | Controller | Route | Method | Reason |
|---|-----------|-------|--------|--------|
| 1 | HealthController | `/api/health` | GET | Infrastructure, not user-facing |
| 2 | FiscalController | `/fiscal/years/active` | GET | Not needed — full list fetched |
| 3 | FiscalController | `/fiscal/years/{id}` | GET | Not needed — full list fetched |
| 4 | VendorsController | `/vendors/{id}` | GET | Not needed — full list fetched |
| 5 | CustomersController | `/customers/{id}` | GET | Not needed — full list fetched |
| 6 | ChartOfAccountsController | `/coa/{id}` | GET | Not needed — full list fetched |
| 7 | ChartOfAccountsController | `/coa/import` | POST | Phase 2 feature |
| 8 | GeneralLedgerController | `/gl/{id}` | PUT | Edit draft GL — not exposed in UI |
| 9 | GeneralLedgerController | `/gl/{id}/lock` | POST | Lock/unlock draft — not exposed in UI |
| 10 | GeneralLedgerController | `/gl/{id}/unlock` | POST | Lock/unlock draft — not exposed in UI |
| 11 | JournalsController | `/journals/types/{id}` | GET | Not needed — full list fetched |
| 12 | VendorBillsController | `/vendor-bills/bulk` | POST | Bulk operations — Phase 2 |
| 13 | CustomerInvoicesController | `/invoices/bulk` | POST | Bulk operations — Phase 2 |
| 14 | BankController | `/bank/dashboard` | GET | Separate banking dashboard — not used |
| 15 | BankController | `/bank/webhooks/razorpay` | POST | Server-to-server webhook |
| 16 | BankController | `/bank/webhooks/stripe` | POST | Server-to-server webhook |
| 17 | TaxationController | `/tax/configurations/{id}` | GET | Not needed — full list fetched |
| 18 | FixedAssetsController | `/assets/{id}` | GET | Not needed — full list fetched |
| 19 | FixedAssetsController | `/assets/{id}/depreciation` | GET | Per-asset depreciation schedule — Phase 2 |
| 20 | BillingController | `/billing/plans/{id}` | GET | Not needed — full list fetched |
| 21 | BillingController | `/billing/subscriptions/{id}` | GET | Not needed — full list fetched |
| 22 | BillingController | `/billing/generate-invoices` | POST | Admin-only batch operation — Phase 2 |
| 23 | AuditController | `/audit/logs/{entityType}/{entityId}` | GET | Entity-specific trail — Phase 2 |
| 24 | SystemController | `/system/integrity-check/results` | GET | Results shown inline after POST |
| 25 | ClosingController | `/closing/checklists/{id}/items/{itemId}/complete` | POST | Granular checklist item completion — Phase 2 |
| 26 | ClosingController | `/closing/checklists/{id}/complete` | POST | Full checklist completion — Phase 2 |
| 27 | FiscalController | `/fiscal/years` | PUT | Edit fiscal year — not exposed |
| 28 | FiscalController | `/fiscal/periods` | POST | Create period — auto-created with FY |

---

## Coverage by Controller

| Controller | Total Endpoints | Implemented | Coverage |
|-----------|:-:|:-:|:-:|
| FiscalController | 8 | 6 | 75% |
| VendorsController | 4 | 3 | 75% |
| CustomersController | 4 | 3 | 75% |
| ChartOfAccountsController | 14 | 12 | 86% |
| GeneralLedgerController | 9 | 6 | 67% |
| JournalsController | 5 | 4 | 80% |
| VendorBillsController | 11 | 10 | 91% |
| CustomerInvoicesController | 13 | 12 | 92% |
| BankController | 15 | 12 | 80% |
| ExpenseController | 12 | 12 | **100%** |
| ReportsController | 10 | 10 | **100%** |
| TaxationController | 19 | 18 | 95% |
| FixedAssetsController | 11 | 9 | 82% |
| BillingController | 18 | 15 | 83% |
| AuditController | 4 | 3 | 75% |
| SystemController | 5 | 4 | 80% |
| ClosingController | 6 | 4 | 67% |
| HealthController | 1 | 0 | 0% |
| **TOTAL** | **169** | **143** | **85%** |
