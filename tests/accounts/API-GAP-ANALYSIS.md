# Accounts Module — Backend vs Frontend API Gap Analysis

**Date:** 2026-04-04
**Backend:** 118 endpoints across 16 controllers
**Frontend:** ~95 unique endpoints called across 14 JS files

---

## Gap Summary

| Controller | Backend Endpoints | Frontend Calls | Missing |
|------------|:-:|:-:|:-:|
| ChartOfAccounts (coa) | 14 | 12 | 2 |
| FixedAssets (assets) | 9 | 9 | 0 |
| Customers | 4 | 4 | 0 |
| Closing | 6 | 3 | 3 |
| Expense | 10 | 10 | 0 |
| CustomerInvoices | 13 | 12 | 1 |
| System | 5 | 2 | 3 |
| Journals | 5 | 4 | 1 |
| Fiscal | 8 | 6 | 2 |
| Billing | 15 | 9 | 6 |
| Reports | 10 | 10 | 0 |
| GeneralLedger (gl) | 9 | 7 | 2 |
| Vendors | 4 | 4 | 0 |
| Bank | 13 | 11 | 2 |
| Taxation (tax) | 14 | 10 | 4 |
| Health | 1 | 0 | 1 |
| **TOTAL** | **140** | **113** | **27** |

---

## Missing Endpoints — Detail

### 1. ChartOfAccounts (`api/accounts/coa`) — 2 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 1 | `/coa/{id}` | GET | Get single account by ID (detail view) | LOW — edit modal fetches list |
| 2 | `/coa/import` | POST | Bulk import accounts from CSV/Excel | MEDIUM |

### 2. Closing (`api/accounts/closing`) — 3 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 3 | `/closing/checklists/{id}` | GET | Get single checklist detail | MEDIUM |
| 4 | `/closing/checklists/{id}/items/{itemId}/complete` | POST | Mark individual checklist item done | HIGH |
| 5 | `/closing/year-end/{fiscalYearId}` | POST | Execute year-end closing process | HIGH |

### 3. CustomerInvoices (`api/accounts/invoices`) — 1 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 6 | `/invoices/bulk` | POST | Bulk create invoices | LOW |

### 4. System (`api/accounts/system`) — 3 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 7 | `/system/recompute-balances` | POST | Recompute all GL balances | MEDIUM |
| 8 | `/system/integrity-check/results` | GET | Get past integrity check results | MEDIUM |
| 9 | `/system/job-log` | GET | Get background job logs | HIGH |

### 5. Journals (`api/accounts/journals`) — 1 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 10 | `/journals/types/{id}` | GET | Get single journal type by ID | LOW |

### 6. Fiscal (`api/accounts/fiscal`) — 2 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 11 | `/fiscal/years/active` | GET | Get currently active fiscal year | MEDIUM |
| 12 | `/fiscal/years/{id}` | GET | Get single fiscal year by ID | LOW |

### 7. Billing (`api/accounts/billing`) — 6 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 13 | `/billing/plans/{id}` | GET | Get single plan detail | LOW |
| 14 | `/billing/subscriptions/{id}` | GET | Get single subscription detail | LOW |
| 15 | `/billing/generate-invoices` | POST | Auto-generate invoices from subscriptions | HIGH |
| 16 | `/billing/usage-meters` | GET | List usage meters (READ) | HIGH |
| 17 | `/billing/tokens/{customerId}` | GET | Get customer token balance | MEDIUM |
| 18 | `/billing/subscriptions` | GET | List subscriptions (READ) | HIGH |

### 8. GeneralLedger (`api/accounts/gl`) — 2 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 19 | `/gl/{id}/lock` | POST | Lock a draft GL entry | LOW |
| 20 | `/gl/{id}/unlock` | POST | Unlock a locked GL entry | LOW |

### 9. Bank (`api/accounts/bank`) — 2 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 21 | `/bank/dashboard` | GET | Bank dashboard summary | MEDIUM |
| 22 | `/bank/reconciliations` | POST | Start new reconciliation | HIGH |

### 10. Taxation (`api/accounts/tax`) — 4 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 23 | `/tax/configurations` | GET | List tax configs (READ) | HIGH |
| 24 | `/tax/rates` | GET | List tax rates (READ) | HIGH |
| 25 | `/tax/hsn-sac` | GET | List HSN/SAC codes (READ) | HIGH |
| 26 | `/tax/ledger` | GET | Get tax ledger entries (READ) | HIGH |

### 11. Health — 1 missing
| # | Endpoint | Method | Purpose | Priority |
|---|----------|--------|---------|----------|
| 27 | `/health` | GET | Health check | N/A — not user-facing |

---

## Frontend URL Mismatch Issues

Several frontend JS files call endpoints with URLs that may NOT match the actual backend routes. These need verification during testing:

| Frontend URL | Backend Route | Issue |
|-------------|---------------|-------|
| `/accounts/vendor-bills` | `/accounts/vendor-bills` or nested under vendors? | Verify routing |
| `/accounts/journal-types` | `/accounts/journals/types` | Possible mismatch |
| `/accounts/fiscal-years` | `/accounts/fiscal/years` | Possible mismatch |
| `/accounts/chart-of-accounts` | `/accounts/coa` | Mismatch in expenses.js |
| `/accounts/bank-accounts` | `/accounts/bank/accounts` | Mismatch in expenses.js |
| `/accounts/tax/configs` | `/accounts/tax/configurations` | Possible mismatch |
| `/accounts/audit/approvals` | No matching controller | Missing controller? |
| `/accounts/admin/` | No AdminController found | Using SystemController? |

---

## Priority Breakdown

| Priority | Count | Action |
|----------|-------|--------|
| HIGH | 10 | Must implement — core functionality broken without these |
| MEDIUM | 7 | Should implement — feature gaps visible to users |
| LOW | 9 | Nice to have — detail views, bulk ops |
| N/A | 1 | Health check — not user-facing |

---

## HIGH Priority Items (Must Fix)

1. **Billing: GET subscriptions & usage-meters** — Billing tabs load empty without these READ endpoints
2. **Billing: generate-invoices** — Can't auto-bill subscriptions
3. **Taxation: GET configs, rates, hsn-sac, ledger** — All taxation READ tabs may be broken
4. **Closing: checklist item complete + year-end** — Admin closing workflow incomplete
5. **System: job-log** — Admin Job Log tab has no data source
6. **Bank: start reconciliation** — Can't initiate new reconciliation

---

## Next Steps

1. During page-by-page testing, verify each API call works (200 response)
2. Fix URL mismatches where frontend doesn't match backend routes
3. Implement missing HIGH priority frontend calls
4. Wire up tab data loading for tabs that have write-only (no GET) endpoints
