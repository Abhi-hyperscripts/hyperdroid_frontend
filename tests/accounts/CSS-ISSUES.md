# Accounts Module — CSS Visual Inspection Issues

**Inspected:** 2026-04-05
**Pages:** 13 pages, dark mode (brand-enforced, light mode not available)
**Reference:** HRMS Employee page (gold standard for control alignment)
**Screenshots:** `css-audit/` directory

---

## CRITICAL (5) — Broken layout / modals visible

### CSS-1: Modals visible at page bottom (Assets, Admin, Billing, Parties)
- **Pages:** assets.html, admin.html, billing.html, parties.html
- **Issue:** Glassmorphic modals (Asset Details, Depreciation Schedule, Entity Audit Trail, Checklist Detail, etc.) are visible at the bottom of the page instead of hidden
- **Root cause:** Newly added modals missing `style="display:none"` or the `.glassmorphic-modal` class doesn't have `display:none` by default
- **Fix:** Add `style="display:none"` to all new modal divs, OR ensure `.glassmorphic-modal` has `display: none` in CSS
- **Status:** FIXED

### CSS-2: `<code>` tags in pink/magenta — not theme-aware
- **Pages:** payables.html (bill numbers), receivables.html (invoice numbers), billing.html (plan codes), ledger.html (entry numbers)
- **Issue:** `<code>` elements render in default browser pink/magenta color, clashing with dark theme
- **Root cause:** No CSS override for `code` elements inside `.data-table` in accounts.css
- **Fix:** Add `code { color: var(--text-primary); background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px; font-size: 0.85em; }` to accounts.css
- **Status:** FIXED

### CSS-3: Setup Account Types — duplicate "Normal Balance" column
- **Page:** setup.html, Tab: Account Types
- **Issue:** Table shows two identical "Normal Balance" columns (column 2 and 3 both say "Normal Balance" with same data)
- **Root cause:** HTML table header still has the old "Classification" column that wasn't removed when we added "Normal Balance" to replace it. The JS renderer also outputs both.
- **Fix:** Remove the extra `<th>` and extra `<td>` from both HTML header and JS renderer
- **Status:** FIXED

### CSS-4: Filter bar controls misaligned across pages
- **Pages:** payables.html, receivables.html, ledger.html
- **Issue:** Dropdowns, date inputs, search box, and buttons in filter bar have different heights and don't align vertically. Compare with HRMS where all controls are same height (40px) in a flex row with gap.
- **Root cause:** Missing unified filter bar styling. HRMS uses `.filter-bar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }` with all inputs having `height: 40px`.
- **Fix:** Add `.accounts-filter-bar` class with flex alignment and consistent `height: 40px` for all form controls
- **Status:** FIXED

### CSS-5: Stat card text overflow (large numbers)
- **Page:** payables.html
- **Issue:** "Total Outstanding" stat card value `₹10,10,01,21,24,970.30` overflows its card container
- **Root cause:** `.stat-value` doesn't have `overflow: hidden; text-overflow: ellipsis;` or `font-size` scaling for long numbers
- **Fix:** Add `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` to `.stat-value`, or reduce font-size with `font-size: clamp(1rem, 2vw, 1.5rem)`
- **Status:** FIXED

---

## MEDIUM (5) — Visual inconsistencies

### CSS-6: Banking — duplicate dashboard stats row
- **Page:** banking.html
- **Issue:** "2 ACCOUNTS" stat spans full width on top, then another row of 3 stats below. Dashboard stats were added on top of existing stats creating duplication.
- **Root cause:** `bankDashboardStats` div added by banking dashboard feature shows alongside existing stats
- **Fix:** Hide the dashboard stats row or merge with existing stats
- **Status:** FIXED

### CSS-7: Status badges inconsistent — some plain text, some styled
- **Pages:** payables.html, receivables.html
- **Issue:** Some status values appear as plain text ("Approved", "Paid") without the badge styling, while others show properly styled badges
- **Root cause:** Render functions use `AccountsCommon.statusBadge()` inconsistently — some use it, others just output the text
- **Fix:** Ensure ALL status columns use `AccountsCommon.statusBadge(status)` consistently
- **Status:** FIXED

### CSS-8: Ledger — draft entry IDs too long, wrapping awkwardly
- **Page:** ledger.html
- **Issue:** DRAFT entries show full UUIDs like `DRAFT-a5f7bc...` which wraps across multiple lines in the Entry # column
- **Root cause:** Draft entries that haven't been posted don't have short entry numbers
- **Fix:** Truncate long entry IDs in display: show first 12 chars + `...` with full ID in tooltip
- **Status:** FIXED

### CSS-9: Admin — Details column shows raw JSON overflowing
- **Page:** admin.html, Tab: Audit Logs
- **Issue:** The Details column shows raw JSON `{"Amount": 1500, "ClaimId": ...}` that extends beyond the column width
- **Root cause:** No `max-width` or `text-overflow: ellipsis` on the details cell
- **Fix:** Add `max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to the details cell, with tooltip for full content
- **Status:** FIXED

### CSS-10: Banking — account number shows underscore for empty values
- **Page:** banking.html
- **Issue:** Petty Cash shows `_` instead of `-` or empty for account number
- **Root cause:** Render code outputs `a.account_number || '_'` instead of `'-'`
- **Fix:** Change fallback from `'_'` to `'-'`
- **Status:** FIXED

---

## LOW (3) — Minor cosmetic

### CSS-11: Action buttons crowded on draft GL entries
- **Page:** ledger.html
- **Issue:** Draft entries have 6 action buttons (view, edit, post, lock, unlock, delete) all cramped in one cell
- **Root cause:** Too many actions for small column width
- **Fix:** Group less-used actions (lock/unlock) under a dropdown, or widen actions column
- **Status:** NOTED (functional, cosmetic only)

### CSS-12: Pagination not centered on some pages
- **Pages:** payables.html, receivables.html
- **Issue:** Pagination buttons aligned left instead of centered under the table
- **Root cause:** Missing `text-align: center` or `justify-content: center` on pagination wrapper
- **Fix:** Add `display: flex; justify-content: center;` to `.pagination` wrapper
- **Status:** FIXED

### CSS-13: Search input border not matching HRMS style
- **Pages:** All accounts pages
- **Issue:** Search inputs have a single-line border style vs HRMS which has a subtle rounded glass-card style
- **Root cause:** Different CSS class used for search inputs
- **Fix:** Low priority — functional, just slightly different styling
- **Status:** NOTED
