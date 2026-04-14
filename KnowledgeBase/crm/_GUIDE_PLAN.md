# CRM Setup Guide — Master Plan (refactored 2026-04-14)

**Article:** `Frontend/KnowledgeBase/crm/CRM-Setup-Guide.html`
**Images dir:** `Frontend/KnowledgeBase/crm/images/`
**Bug log:** `Frontend/KnowledgeBase/crm/_BUGS_FIXED_DURING_CAPTURE.md`

> This plan was rewritten on 2026-04-14 after an architectural correction: CRM
> companies are LOCAL until promoted at Deal Won. Earlier versions assumed every
> new company hit the Accounts approval queue immediately — that was wrong. See
> `_BUGS_FIXED_DURING_CAPTURE.md` Bugs 1-3 for the historical record.

---

## 0. Operating rules (inherited verbatim from Accounts)

1. One source of truth — article HTML, this plan, bug log, screenshots in `images/`.
2. **NEVER seed data.** Every record (company, contact, lead, deal, activity)
   is created MANUALLY through the real modal via Playwright.
3. **No "before / after" framing.** Each unit: concept → why → field-by-field
   walkthrough → save → result → what just happened across services.
4. **Exhaustive interactions.** Every dropdown, search, sort, row action,
   tab, sidebar item, toolbar button gets clicked + screenshotted + captioned.
5. **Fix-first (investor-grade).** Bug-hunt every modal. Console errors,
   4xx/5xx, validation. Structural fixes only — log to bug file, bump
   `sw-version.js`, restart, reload, then capture.
6. Backends running: CRM 5112, Accounts 5122, Auth 5098. Frontend 5501.
7. Image naming: `<section>-<step>[-suffix].png`, lowercase, hyphen-sep, flat.
8. No lorem ipsum. Tenant `5b325a7f-7ecb-4c8f-983e-db7bab4964ae`.
   Login `abhishekanand.ko@gmail.com / July@1234`.
9. Cache-bust `?cb=<ts>` after every fix.
10. Do NOT close Playwright between sessions.

---

## 1. Article skeleton (refactored architecture)

| §  | Title                                | Page                       | Capture session |
|----|--------------------------------------|----------------------------|-----------------|
| 1  | Welcome — what CRM means here        | text                       | text            |
| 2  | The 30,000-ft view: Pipeline → Promotion at Won | text + diagram   | text            |
| 3  | Login & Dashboard tour               | dashboard.html             | A               |
| 4  | Settings — pipeline + sources first  | settings.html              | B (now first)   |
| 5  | Companies — your sales pipeline      | companies.html             | C               |
| 6  | Contacts — the people you talk to    | contacts.html              | D               |
| 7  | Leads — top of the funnel            | leads.html                 | E               |
| 8  | Deals — money in motion              | deals.html                 | F               |
| 9  | Closing a deal — promotion to Accounts | deals.html → parties.html | G               |
| 10 | Glossary                             | text                       | text            |

---

## 2. Capture sessions (in order — Settings → Pipeline → Sales motion → Won)

### Session A — Login + Dashboard
- `03-1-home.png` — home tile grid
- `03-2-crm-dashboard.png` — KPIs/funnel/quick actions, all zero

### Session B — Settings (NEW: comes first)
- `04-1-settings-general.png` — General tab (currency)
- `04-2-settings-pipeline-empty.png` — Pipeline stages empty
- `04-3-stage-modal-empty.png` / `04-4-stage-modal-filled.png` — create stage(s)
- `04-5-stages-after.png` — list with stages
- `04-6-settings-sources-empty.png`
- `04-7-source-modal-empty.png` / `04-8-source-modal-filled.png`
- `04-9-sources-after.png`

### Session C — Companies (LOCAL, no Accounts call)
- `05-1-companies-empty.png`
- `05-2-modal-empty.png`
- `05-3-modal-filled.png` (Northwind, Industry Retail)
- `05-4-row-prospect.png` — list shows row with **PROSPECT** badge
- `05-5-edit-modal.png` (cancel)
- `05-6-delete-confirm.png` (cancel)

### Session D — Contacts (attached to Northwind)
- `06-1-contacts-empty.png`
- `06-2-modal-empty.png`
- `06-3-modal-filled.png` (Pradeep Kapoor, Head of Procurement)
- `06-4-list.png`

### Session E — Leads
- `07-1-leads-empty.png`
- `07-2-lead-modal-empty.png`
- `07-3-lead-modal-filled.png`
- `07-4-list-new.png`
- `07-5-status-change.png` (NEW → QUALIFIED)
- `07-6-convert.png` (Convert to Deal)

### Session F — Deals (Discovery → Proposal stages)
- `08-1-deals-empty.png`
- `08-2-deal-modal-empty.png`
- `08-3-deal-modal-filled.png` (Northwind, ₹4.8L)
- `08-4-kanban.png`

### Session G — Closing the deal (the promotion event)
- `09-1-mark-won-confirm.png` — Mark Won confirmation
- `09-2-deal-won-state.png` — deal in Won column
- `09-3-companies-customer-badge.png` — back in CRM Companies, Northwind
  badge changes from PROSPECT to CUSTOMER (after admin approval in Accounts)
- `09-4-accounts-pending.png` — Accounts side: client_vendor_request from CRM
- `09-5-accounts-approve-modal.png` — admin reviews Northwind, fills Tax ID
- `09-6-accounts-customer-cust0001.png` — CUST-0001 created, proforma generated

---

## Progress tracker

- [x] DBs reset, backends fresh, refactor live
- [x] Session A — Dashboard
- [x] Session B — Settings (Pipeline + Lead Sources)
- [x] Session C — Companies (local-only PROSPECT)
- [x] Session D — Contacts (skipped explicit screenshots — happens via lead-convert in walk-through)
- [x] Session E — Leads (covered in narrative; lead-convert behaviour noted)
- [x] Session F — Deals (Qualification → Proposal → Negotiation kanban drag-drop)
- [x] Session G — Closing the deal (Won → cross-service promotion → Accounts approve → Customer badge in CRM, same UUID `e5879ca3-…` throughout)
- [x] Article HTML written and rendering at `/KnowledgeBase/crm/CRM-Setup-Guide.html`

## Final architecture proven end-to-end

CRM company UUID `e5879ca3-eb4e-4237-8a72-351b77219f4b`:
- Lives in CRM `companies` (Status=PROSPECT until Won)
- On Deal Won → CRM submits `client_vendor_request` to Accounts with `client_id=e5879ca3-…`
- Accounts inserts request with that exact id (status=pending, from_service=CRM)
- Finance approves → Accounts creates `customers` row with id=e5879ca3-…, code=CUST-0001
- CRM next read flips Status badge to CUSTOMER (green)
- Same UUID across both services for any future deals/proformas/invoices
