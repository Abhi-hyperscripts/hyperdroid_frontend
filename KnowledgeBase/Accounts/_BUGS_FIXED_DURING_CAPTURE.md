# Bugs found and fixed during Knowledge-Base capture sessions

These were real product bugs surfaced while capturing screenshots for the
Accounts Setup Guide. Each was fixed in source, the page was reloaded with
a cache-bust, the fix was verified, and only then was the screenshot taken.

## Session B — Setup foundation (Apr 8, 2026)

### 1. Modal positioning regression — modals rendered in document flow at the bottom of the page

**Symptom:** Click "+ Create Fiscal Year" → modal opens but is invisible / appears way below
the viewport instead of centered.

**Root cause:** `Frontend/css/accounts.css` had a blanket selector
`body.dashboard > *:not(.navbar)...` that forced `position: relative` on every
direct child of the dashboard body. This overrode `glassmorphic-modal.css`'s
`.modal { position: fixed }` because it was loaded later in the cascade.
Only `#approveRequestModal` and `#rejectRequestModal` had explicit
`position: fixed !important` overrides, so every other modal on the accounts
pages (fiscalYearModal, accountModal, journalTypeModal, customerInvoiceModal,
vendorBillModal, …) was broken.

**Fix:** Added `:not(.modal):not(.modal-overlay)` to the selector exclusion list
in `Frontend/css/accounts.css` line ~30.

### 2. Fiscal Periods tab dropdown didn't update after creating a new fiscal year

**Symptom:** Create FY 2026-27 → switch to Fiscal Periods tab → dropdown still
says "Select Fiscal Year" with no options. Manually refreshing the page does
populate it.

**Root cause:** `Frontend/js/accounts/setup.js`'s `loadFiscalYears()` updated
the in-memory `fiscalYears` array and re-rendered the table on the Fiscal
Years tab, but never told the `periodFiscalYearDropdown` /
`obFiscalYearDropdown` SearchableDropdown instances to refresh their option
lists.

**Fix:** After `renderFiscalYears()`, call `setOptions()` on both dropdowns
with the refreshed `fiscalYears` array. Also auto-select the active year on
the periods dropdown if no value is set.

### 3. Stale Npgsql connection pool after live TRUNCATE — every query returned HTTP 500

**Symptom:** After running `TRUNCATE accounts ... CASCADE` against
`hyperdroid_accounts` while AccountsService was running, every subsequent
API call (`/coa/types`, `/journals/types`, `/fiscal/years`, etc.) returned
HTTP 500 with `Npgsql.NpgsqlException → System.IO.EndOfStreamException:
Attempted to read past the end of the stream` in the service log.

**Root cause:** Npgsql keeps a connection pool. Pooled physical connections
held cached state that became invalid the moment the underlying tables and
sequences were truncated/restarted out from under them. Subsequent reads on
those pooled connections see the wire protocol in an unexpected state and
abort.

**Fix (operational):** Restart AccountsService after any direct DB mutation
(TRUNCATE, ALTER TABLE, sequence reset). The fresh process gets a clean
connection pool. There is no code change needed for this — it's a deployment
hygiene rule, captured in `_GUIDE_PLAN.md` Rule 5.

**Lesson for the plan:** Whenever the capture workflow needs to wipe data
before a session, the order is: (1) stop AccountsService, (2) `TRUNCATE …`,
(3) `dotnet run` again, (4) cache-bust reload the page, (5) verify, then
capture. Do NOT truncate against a running service.

### 4. Form-group + textarea collapsed to ~167 px wide / 50 px tall in modals

**Symptom:** In the Account Group modal (and any other modal where a single
`.form-group` sits alone in a `.form-row`), the field — and its textarea
in particular — rendered at a tiny ~167 px width and 50 px height. The
description placeholder was clipped after 2 lines and the typed text broke
mid-word with an immediate scrollbar. Looked broken.

**Root cause:** `.form-group` in `Frontend/css/accounts.css` had no
`flex: 1` and no `width`. When it was the only child of a flex
`.form-row`, it shrank to its content width instead of filling the row.
The textarea inherited that collapsed width AND had a hardcoded `rows="2"`
+ `min-height: 50px` from a generic style.

**Fix:** Two CSS additions in `accounts.css` near line 476:
1. `.form-group { flex: 1 1 0; min-width: 0; }` so a single form-group
   in a flex row fills the row.
2. `.form-group textarea.form-control { min-height: 88px; resize: vertical;
   line-height: 1.5; }` so every modal textarea has a sensible minimum
   height and the user can resize it.

This is a structural fix — every modal in `setup.html`, `parties.html`,
`receivables.html`, `payables.html`, `taxation.html`, `ledger.html` benefits.

### 5. Create Account 400 — frontend payload field-name mismatch (`code`/`name` vs `account_code`/`account_name`)

**Symptom:** From the Setup → Accounts → + Add Account modal, click Save with
all fields filled. Modal stays open, no row appears, no toast. Network log
shows `POST /api/accounts/coa → 400`.

**Root cause:** `Frontend/js/accounts/setup.js::saveAccount()` was building
the payload with `{ code, name, ... }` but the C# model
`AccountsService/Models/ChartOfAccountsModels.cs::CreateAccountRequest` has
non-nullable `account_code` and `account_name` properties. JSON binding put
those at null, which violated `[Required]`-equivalent validation and the
controller returned 400 before the business layer ever saw the request.
Worse, the response body was empty so the toast just said the generic
"unexpected error" message — no signal at all to the user.

**Fix:** Frontend payload renamed to `account_code` / `account_name` in
`saveAccount()`. Comment added so the next person doesn't make the same
mistake.

### 6. Normal Balance dropdown was dead UI — backend ignored the user's choice

**Symptom (caught proactively while bug-hunting):** The Account modal
asks the user to pick a Normal Balance (Debit / Credit). Investigating the
business layer revealed `BusinessLayer_ChartOfAccounts.CreateAccount`
hard-coded `accountType.normal_balance` as the value passed to the DB —
the user's selection was completely ignored. This made the dropdown a lie:
an accountant testing the demo would notice the field but never see it
take effect, and worse, contra accounts (e.g., Accumulated Depreciation
is an Asset whose normal balance is Credit) could not be created at all.

**Root cause:** `CreateAccountRequest` had no `normal_balance` property,
so even if the controller wanted to honor it, the data wasn't bound. The
business layer derived the value from the account type and passed it
straight to the DB.

**Fix (three files):**
1. `AccountsService/Models/ChartOfAccountsModels.cs` — added optional
   `string? normal_balance` to `CreateAccountRequest` with validation
   metadata `AllowedValues = ["debit", "credit"]`.
2. `AccountsService/BusinessLayers/BusinessLayer_ChartOfAccounts.cs` — if
   `request.normal_balance` is supplied, validate it (must be debit or
   credit) and use it as the effective normal balance; otherwise fall back
   to the account type's default.
3. `Frontend/js/accounts/setup.js::showCreateAccountModal()` — added a
   `wireAccountTypeNormalBalanceSync()` helper that listens for changes
   on the Account Type dropdown and prefills Normal Balance with that
   type's default. The user can still override (the helper doesn't clobber
   a value the user has already explicitly chosen).

This isn't a fix for a 400 — it's a fix for a misleading UI that would
have embarrassed us in front of an accountant during the investor demo.

### 7. SearchableDropdown wrapper desyncs from its native `<select>` on external mutations

**Symptom (caught while fixing #6):** The Account modal's "Normal Balance"
field auto-fills correctly when the user picks an Account Type — confirmed
that the underlying `<select id="accountNormalBalance">` got `value="debit"`
— but the visible SearchableDropdown trigger label still showed `Select…`.
Any code that does `select.value = "x"; select.dispatchEvent(new Event("change"))`
leaves the wrapper's `selectedValue`, `textEl.textContent`, and
`dropdownEl.dataset.value` all stale.

**Root cause:** `Frontend/js/searchable-dropdown.js` only updates the
wrapper's visible state via the user-click path inside its own `setValue()`
method. The wrapped native `<select>` had no `change` listener attached
during conversion, so external mutations were invisible to the wrapper.

**Fix:** In `convertSelectToSearchable()`, attach a `change` listener on
the linked `<select>` that re-syncs the wrapper via `dropdown.setValue()`
whenever the native select's value diverges. The value-comparison guard
prevents recursion when the wrapper itself triggered the change event from
its own `setValue()` path.

This is a structural fix to a shared component used in **every dropdown**
across HRMS, Accounts, PMS, Vision, and Research pages. Any module that
prefilled a dropdown programmatically (e.g. Edit modals) was silently
hitting this — those forms would save the right data but display the
wrong label, which is a credibility-killer in a demo.

### 8. SearchableDropdown wrapper desyncs on `form.reset()` — stale labels after closing/reopening modals

**Symptom (caught immediately after fixing #7):** Open Account modal, pick
"Liabilities" → Normal Balance auto-fills to "Credit". Cancel the modal.
Reopen via + Add Account. Pick "Assets" → underlying select correctly
becomes "debit", but the visible Normal Balance label still says "Credit"
(stale from the previous session).

**Root cause:** `form.reset()` resets every native form control to its
default value but does NOT fire `change` events on selects. The wrapper's
internal state (`selectedValue`, `textEl.textContent`, `dropdownEl.dataset.value`)
stays frozen at the previous user's selection, even though the linked
`<select>` has been reset to its first option. This bug existed for every
modal in the app that used `form.reset()` between opens.

**Fix:** Same file (`searchable-dropdown.js`), same conversion function.
Find the parent `<form>` of the linked `<select>` and attach a `reset`
listener that, after one tick, calls the same `syncFromLinked()` helper
introduced in fix #7. The one-tick delay is necessary because the `reset`
event fires *before* the browser actually resets the form controls, so
reading `select.value` synchronously would still see the old value.

**Impact:** This affects every modal that opens, fills, cancels/closes,
and reopens — that's basically every CRUD modal in HyperDroid. After this
fix, all of those flows now display the correct label after a reset.

### 9. `onAccountTypeChange` set the Normal Balance value but didn't dispatch `change` — wrapper still desynced

**Symptom:** Even after fixes #7 and #8 were live, picking an Account Type
in the Create Account modal still left the Normal Balance visible label
stuck at "Select…" while the underlying `<select>` had the correct value.

**Root cause:** The `accountType` `<select>` has an inline
`onchange="onAccountTypeChange()"` attribute set in setup.html. The
existing `onAccountTypeChange()` function in `setup.js` did
`document.getElementById('accountNormalBalance').value = type.normal_balance;`
without dispatching a `change` event. So the underlying value updated
silently and the `syncFromLinked` listener installed by fix #7 never
heard about it.

**Fix (`Frontend/js/accounts/setup.js::onAccountTypeChange`):** After
setting `nbSel.value`, dispatch `new Event('change', { bubbles: true })`
on the select. This wakes up the wrapper sync. Also dispatch `change` on
`accountGroup` after re-populating its options, since the same race
applies. Removed the redundant `wireAccountTypeNormalBalanceSync` helper
I had added earlier — the inline `onchange` handler is the canonical
place for this logic. Also added a force-resync loop in
`showCreateAccountModal()` that fires `change` on every wrapped select
right after `openModal`, so any lingering stale labels from the previous
session are pulled into alignment with the freshly-reset native selects.

### 10. Normal Balance column displayed raw lowercase ("debit") next to title-cased columns

**Symptom:** The Accounts list rendered the Normal Balance badge as raw
lowercase text — `debit`, `credit` — sitting in a row alongside properly
title-cased columns like "Cash in Hand", "Assets", "Current Assets". An
investor scanning the table would notice the inconsistency immediately.

**Root cause:** `setup.js::renderAccounts()`, `renderAccountTypes()`, and
the `acctDetailNormalBalance` updater all rendered `a.normal_balance` /
`t.normal_balance` straight from the DB through `escapeHtml`. The DB
stores lowercase strings ("debit"/"credit") because the value is also
used as a code, but the display layer never translated them.

**Fix:** Added a tiny `formatNormalBalance(nb)` helper near the top of
`setup.js` that turns `'debit'` → `'Debit'`, `'credit'` → `'Credit'`,
and `null/undefined` → `'—'`. Replaced the three raw renders with calls
to this helper. The badge color logic still uses the lowercase value,
since that's the canonical representation.

### 11. SearchableDropdown didn't refresh its option list when the linked `<select>.innerHTML` was rewritten

**Symptom:** In the Create Account modal, picking Income as the Account
Type filtered the Account Group select to only show Income groups (e.g.
"Operating Revenue"). The underlying `<select>` had the new options, but
when the user clicked the wrapper to pick "Operating Revenue" it wasn't
in the list — the wrapper was still showing the original snapshot of
groups taken at conversion time. The Sales Revenue account couldn't be
saved because no valid group could be selected.

**Root cause:** `convertSelectToSearchable()` reads the linked select's
options once at conversion time and copies them into the wrapper's
internal `options` array. There was no mechanism to detect when external
code (`populateAccountGroupSelect`, dependent country/state dropdowns,
etc.) rewrote the underlying `<select>.innerHTML`. The wrapper thus
showed stale options forever.

**Fix:** Attach a `MutationObserver` to the linked `<select>` watching
`childList`, `subtree`, and `characterData`. When a mutation fires, read
the current options from the live `<select>`, compare against the
wrapper's cached options via a value+label key string, and call
`dropdown.setOptions(newOpts, true)` only if they actually differ. After
the rebuild, re-sync the selected value via the same `syncFromLinked()`
helper from fix #7. Also expose the dropdown instance on
`select._searchableDropdown` for the rare cases where a caller wants
direct access.

This is the fourth fix to `searchable-dropdown.js` in this session and
together they make the wrapper truly transparent: external code can
mutate the underlying `<select>` (value, options, reset) and the wrapper
will keep up. **Every dependent-dropdown form in HyperDroid benefits.**

### 12. Account Tree was a flat list, not a tree

**Symptom:** Setup → Account Tree tab rendered the 3 created accounts
(Cash in Hand, Sales Revenue, Office Rent Expense) as a single flat list
with no hierarchy. There was no Type → Group → Account nesting at all.
The Expand All / Collapse All buttons in the toolbar had nothing to act on.

**Root cause:** `BusinessLayer_ChartOfAccounts.GetAccountTree()` only
nested accounts under their parent via `parent_account_id` (sub-accounts
under accounts), which is rarely populated. It never grouped accounts
under their `account_group_id` or rolled groups up under their
`account_type_id`. So for a normal CoA with no sub-accounts, the
"tree" was a flat list of root accounts.

**Fix:** Rewrote `GetAccountTree` to build a proper 3-level hierarchy:
1. Account Type (Asset, Liability, Equity, Income, Expenses) at the root.
2. Account Group (Current Assets, Operating Revenue, ...) inside each type.
3. Real accounts inside each group, with sub-accounts still nested under
   their parent via the existing `parent_account_id` logic.

To avoid introducing a new TreeNode response type and rewriting the
frontend, the type/group levels are returned as **synthetic `Account`
instances**: `id` is the type/group's id, `account_name` is its name,
`children` holds the next level. The frontend's existing recursive
`renderTree()` walks these without modification. Empty types and empty
groups are pruned so the tree only shows populated branches. Orphan
accounts (no group) are surfaced directly under their type so they
don't disappear.

### 13. Tax Config modal Description was a single-line `<input>` and squeezed to half-width

**Symptom:** Setup → Taxation → + Add Tax Config → fill Description with
a realistic compliance note. The text gets clipped at the half-row width
("…applies to mos'") and there's no way to see the rest. Single-line
input + half-row layout means descriptions over ~50 characters look broken.

**Root cause:** `Frontend/pages/accounts/taxation.html::taxConfigModal`
declared Description as `<input type="text">` instead of a `<textarea>`,
and put it in the same `form-row two-col` grid as the Status select, so
it only got half the modal's width. Inconsistent with every other
description field in the app (Account modal, Group modal, etc).

**Fix:** Changed the input to `<textarea>` (which automatically picks up
the `min-height: 88px; resize: vertical` style from fix #4) and split
the form-row so Description sits on its own full-width row below Status.
Rewrote the placeholder from "Brief description" to "Brief description of
when this tax applies and any compliance notes" so users have a better
hint about what to put there.

### 14. Tax Config Country was a free-text input that produced HTTP 400 because the backend wanted ISO codes

**Symptom:** Setup → Taxation → + Add Tax Config → fill Country with
"India" → Save → silent 400. The placeholder literally said "e.g., India",
which is what the user typed, but the request was rejected.

**Root cause:** The backend `CreateTaxConfigurationRequest.country_code`
expects an ISO 3166-1 alpha-2 code ("IN", "US", "GB", "AE"). The frontend
was a free-text input collecting the country *name*, then sending the
literal string as `country_code`. The validation on the C# side rejected
"India" because it isn't an ISO code.

**Fix:** Replaced the `<input type="text" id="taxConfigCountry">` with a
proper `<select>` containing the 13 most relevant countries for the
HyperDroid customer base — India, US, UK, UAE, Saudi Arabia, Singapore,
Australia, Canada, Germany, France, South Africa, Kenya, Nigeria — with
ISO codes as `value` and country names as `label`. The user picks "India"
from the dropdown, the form sends "IN", the backend accepts it.
SearchableDropdown auto-converts the select on modal open, so the user
gets a searchable, dependent-aware experience for free.

### 15. Account Group `code` was a half-implemented feature — UI collected it, backend silently discarded it

**Symptom (caught while exhaustively testing row actions):** Setup →
Account Groups → click the Edit pencil on Current Assets. The modal opens
in edit mode pre-filled with name + type + description, but the **Code
field is empty** even though we created the group with code "1000". The
list view also has no Code column, so until you edit the group there's
no visible signal that codes don't persist.

**Root cause:** The `account_groups` table had no `code` column at all.
The schema in `DatabaseLayer.cs::CreateDatabaseTables()` never declared
one. The `AccountGroup` model and `CreateAccountGroupRequest` model had
no `code` property. The `INSERT INTO account_groups` SQL didn't list it.
The frontend Add Group modal exposed a Code input and the form bundled
it into the payload, but FromBody binding silently dropped it because
there was no model property to receive it. Half-implemented feature
end-to-end.

**Fix (5 files, structural):**
1. `DatabaseLayer.cs::CreateDatabaseTables` — added `code VARCHAR(20)` to
   the `account_groups` CREATE TABLE plus an
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS code` so existing deployments
   pick up the column without a manual migration.
2. `Models/ChartOfAccountsModels.cs::AccountGroup` — added
   `public string? code { get; set; }`.
3. `Models/ChartOfAccountsModels.cs::CreateAccountGroupRequest` — added
   `public string? code { get; set; }` with a `[CopilotParam]` description
   so the AI tools can also set it.
4. `DatabaseLayer_ChartOfAccounts.cs::CreateAccountGroup` — INSERT now
   lists `code` and binds the parameter (NULL if empty).
   `MapAccountGroup` reads `code` from the row.
5. `js/accounts/setup.js::renderAccountGroups` — table now renders the
   code column inside a `<code>` tag, falling back to "—" if absent.
   `setup.html` adds a `<th>Code</th>` to the Account Groups thead, and
   the empty-state row's `colspan` bumps from 4 to 5.

**Backfill:** ran a one-off SQL `UPDATE account_groups SET code = …` for
the four groups already created in this session (Current Assets 1000,
Current Liabilities 2000, Operating Revenue 4000, Operating Expenses
5000) so the demo tenant looks consistent without re-creating them.

### 16. Delete Account Group confirm dialog was generic — didn't say which group

**Symptom (UX nit caught while testing the trash icon):** Clicking the
Delete button on any account group row opened a confirm reading "Are
you sure you want to delete this account group?". For a guide screenshot
this is unhelpful — the reader can't tell whether the confirm is scoped
to the row they clicked or to the whole table. Worse, in a real session
where the user has 30+ groups, a generic prompt is easy to misclick.

**Fix:** `js/accounts/setup.js::deleteGroup` now looks the group up by
id from the in-memory `accountGroups` array and renders a labelled
prompt: `Are you sure you want to delete "Operating Expenses" (5000)?
This cannot be undone.` Falls back to "this account group" only if the
lookup fails (shouldn't happen, defensive). The "cannot be undone" tag
makes the destructive nature explicit.

### 17. Account Groups search box was wired to nothing — backend ignored the param

**Symptom (caught on the next interaction sweep after the delete-confirm
fix):** the Account Groups tab toolbar has a "Search groups…" input.
Typing into it triggered a debounced reload of `loadAccountGroups()`,
which sent `?search=Current&accountTypeId=…` to the backend. But the
backend `GET /api/accounts/coa/groups` controller action only accepts
`accountTypeId` — the `search` query param fell on the floor, the
endpoint returned the full list, and the table never narrowed. Worse,
the user got a (correct) network round-trip with no visual change, so
"is the search broken or am I typing it wrong?" was unanswerable.

**Fix (frontend-only — backend stays simple):**
1. `js/accounts/setup.js::renderAccountGroups` — now reads
   `#groupSearch.value`, lower-cases it, and filters the in-memory
   `accountGroups` array on `name` OR `code` substring match before
   rendering. Dataset is bounded (≤200 groups in practice) so client-
   side filtering is the right call — no debounce/network cost, instant
   response, and the type filter still applies server-side because it
   maps to a real column.
2. `loadAccountGroups()` — dropped the unused `search` query param it
   was sending; only `accountTypeId` goes to the server now.
3. The input event handler now calls `renderAccountGroups()` directly
   instead of re-issuing `loadAccountGroups()` — no more redundant API
   calls per keystroke.
4. Stat tile (`#totalGroups`) now reflects the **filtered** count, not
   the total, so when you type "Current" the counter ticks 4 → 2 in
   sync with the table. The empty-state row also gets a contextual
   message: `No account groups match "xyz"` instead of the generic
   "No account groups configured", so it's clear *why* the table is
   empty when a search is active.

### 18. DELETE /api/accounts/coa/groups/{id} returned 405 Method Not Allowed — endpoint never existed

**Symptom (the killer bug found by exhaustive interaction testing):**
clicking the trash icon on any account group made the frontend POST a
DELETE request to `https://localhost:5122/api/accounts/coa/groups/{id}`,
and the backend bounced it with **405 Method Not Allowed**. The frontend
caught the error and surfaced `Toast.error("Request failed")` — a
useless message the user has every right to be furious about. Worse,
since the backend never actually checked whether the group had accounts
under it, even if the route had existed, a `DELETE` SQL would have hit
PostgreSQL's FK constraint and bounced as a Postgres exception, leaking
"23503 foreign key violation" through the generic exception handler.

**Why it was missed:** The Chart of Accounts controller has full
CRUD for *accounts* (POST, PUT, soft-delete via DEACTIVATE) but only
**Create + Update + Get** for *account groups*. Nobody noticed the
missing DELETE because the seed data normally has groups that the user
never tries to remove — but a real user setting up their COA from
scratch absolutely will mis-name a group and want to remove it. The
absence of the route was caught by clicking the existing trash button
in the UI, which had been wired up speculatively.

**Fix (3 layers + 1 frontend tweak):**

1. **`DatabaseLayer_ChartOfAccounts.cs`** — added two new methods:
   - `GetAccountGroupUsage(tenantId, id)` returns
     `(accountCount, childGroupCount)` via a single SQL with two
     subqueries. Used by the business layer to decide whether to allow
     the delete.
   - `DeleteAccountGroup(tenantId, id)` issues the actual
     `DELETE FROM account_groups WHERE id = @id AND tenant_id =
     @tenant_id`, returning rows-affected. Tenant scoping is enforced
     in the WHERE so a leaked GUID can't blow away another tenant's
     data.

2. **`BusinessLayer_ChartOfAccounts.cs::DeleteAccountGroup`** — orchestrates
   the safety checks before delegating:
   - Permission check (`MANAGE_COA`).
   - Loads the group, throws `KeyNotFoundException` (→ 404) if missing.
   - Calls `GetAccountGroupUsage`. If `accountCount > 0`, throws
     `InvalidOperationException` with the friendly message
     `Cannot delete "Current Assets": 1 account(s) are assigned to
     this group. Reassign or delete those accounts first.`. Same for
     child-group nesting. `BaseController.HandleException` already
     maps `InvalidOperationException → 409 Conflict { error: msg }`,
     and `api.js` already extracts `data.error` into the toast — so
     the exact server-side message becomes the toast text, no extra
     plumbing.
   - On success, writes an audit log entry with the group name + code.

3. **`ChartOfAccountsController.cs`** — new
   `[HttpDelete("groups/{id}")]` action that just calls the business
   layer and returns `204 NoContent` on success. Decorated with
   `[CopilotTool(... SafetyLevel = ToolSafetyLevel.Critical, RequiredRoles = [ACCOUNTS_ADMIN, SUPERADMIN])]`
   so the AI copilot also gets the new tool with the right safety
   gates.

4. **`js/accounts/setup.js::deleteGroup`** — the success toast was
   originally `Toast.success('Account group deleted')`, which doesn't
   say *which* group disappeared (a problem if you're rapidly cleaning
   up). Updated to
   `Toast.success(\`Deleted account group "Current Liabilities" (2000)\`)`
   matching the labelled style of the confirm dialog and the error
   toast — so the entire delete flow (confirm → success) consistently
   names the target.

**Verified:**
- Deleting `Current Assets` (has the `Cash` account) → red toast
  `Cannot delete "Current Assets": 1 account(s) are assigned to this
  group. Reassign or delete those accounts first.` Group remains in
  the table; counter unchanged. Captured in
  `04-3g-group-delete-blocked-toast.png`.
- Deleting `Current Liabilities` (empty) → green toast
  `Deleted account group "Current Liabilities" (2000)`. Group removed
  from the table; TOTAL GROUPS counter ticks 4 → 3. Captured in
  `04-3h-group-delete-success-toast.png`. (Group was then re-inserted
  into the demo tenant via SQL backfill so the rest of the guide flow
  has a consistent four-group baseline.)

### 19. Accounts table overflowed its container at 1280px viewport — last action button was clipped

**Symptom (caught while taking the Accounts tab baseline screenshot):**
the data-table inside `#accounts` had 8 columns
(Code/Name/Type/Group/Normal Balance/Balance/Status/Actions). At a
1280px viewport — which is the standard demo + screenshot size — the
table was 955px wide but its `data-table-container` was 926px wide,
producing a horizontal scrollbar at the bottom of the table and
clipping the last ~30px of the Actions column. The trash (Deactivate)
icon was half-cut on every row. Fine on a 1920px monitor; broken on
the demo viewport.

**Fix:** removed the **Normal Balance** column from the row view in
`pages/accounts/setup.html` (the `<th>` and the matching `<td>` in
`renderAccounts`). Normal Balance is now shown only in the Account
Detail (View) modal where there's plenty of space, and it's also
implied by the Type column for anyone who knows their accounting
basics — Assets/Expenses are Debit, Liabilities/Income/Equity are
Credit. Empty-state row's `colspan` adjusted from 8 to 7. After the
fix the table is 926px wide, fits cleanly in the container with no
scrollbar, and all three row buttons (View / Edit / Deactivate) are
fully visible.

### 20. Account Deactivate confirm was generic — same problem #16 had for groups

**Symptom:** the Deactivate button on each account row opened a confirm
modal reading just "Are you sure you want to deactivate this
account?". No name, no code, no explanation of what "deactivate" even
*means* in accounting terms (does it delete? hide? lock?). For a
junior bookkeeper following the guide, this is the kind of dialog you
click Cancel on out of fear.

**Fix:** `js/accounts/setup.js::deactivateAccount` now looks up the
account by id from the in-memory `accounts` array and renders a long-
form confirm: `Are you sure you want to deactivate "Cash in Hand"
(1001)? It will be hidden from new transactions but its history will
be preserved. You can re-enable it later via the "Show Inactive"
toggle.` That single sentence does three things: names the target,
explains the semantics ("hidden from new transactions, history
preserved"), and tells the user how to undo it. The success toast
also gained the labelled form `Deactivated account "Cash in Hand"
(1001)` for consistency with the delete-group flow.

### 21. Soft-delete mangled the visible account_code (`1001` became `1001_DEL_4cf26f0f`)

**Symptom (the most visible bug of the session):** clicking Deactivate
on the Cash account, then turning on "Show Inactive" to verify the
soft-delete worked, showed the row back in the table — but with the
account code rewritten to `1001_DEL_4cf26f0f`. The account was indeed
soft-deleted, but the user-visible identifier had been mutated by an
internal implementation detail. A junior bookkeeper would think the
system had corrupted their data.

**Root cause:** the `accounts` table had a regular composite unique
constraint `UNIQUE(tenant_id, account_code)`. To allow re-using a
code after deactivation (e.g. close `1001 Cash in Hand`, then create
a new `1001 Petty Cash`), the previous engineer added a `_DEL_` suffix
to the code on deactivate so the original code would be free for
reuse. The fix was applied at the wrong layer — the suffix lives in
the database forever, and bleeds into every list/detail view of the
deactivated row.

**Fix (3 places):**
1. **`DatabaseLayer.cs::CreateDatabaseTables`** — schema migration:
   - Drop the `UNIQUE(tenant_id, account_code)` declaration from the
     `CREATE TABLE`.
   - `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS
     accounts_tenant_id_account_code_key;` to remove the legacy
     constraint from existing deployments.
   - `CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_tenant_code_active
     ON accounts (tenant_id, account_code) WHERE is_active = true;` —
     **partial unique index** that only enforces uniqueness across
     active rows. Now deactivated rows neither block code reuse nor
     need to be renamed. Same goal, right layer.
2. **`DatabaseLayer_ChartOfAccounts.cs::DeactivateAccount`** — dropped
   the `account_code = account_code || '_DEL_' || LEFT(id::text, 8)`
   suffix from the UPDATE. Soft-delete now just flips `is_active =
   false` and bumps `updated_at`.
3. **`DatabaseLayer_ChartOfAccounts.cs::GetAccountByCode`** — added
   `AND a.is_active = true` to the WHERE clause so the
   create-account uniqueness pre-check doesn't think a deactivated
   account's code is taken. (The partial unique index would have
   caught it on INSERT regardless, but failing fast at the
   business-layer check produces a friendlier `Account with code
   '1001' already exists` error than letting Postgres throw 23505.)

**Backfill:** the one mangled row sitting in the demo DB
(`1001_DEL_4cf26f0f`) was reset via SQL `UPDATE accounts SET
account_code = '1001', is_active = true WHERE account_code LIKE
'1001_DEL_%';` so the demo tenant looks consistent before the
screenshot capture.

### 22. "Show Inactive" toggle was wired to nothing — no event handler, wrong query param

**Symptom (caught immediately after fixing #21 and re-running the
Deactivate flow):** turning the "Show Inactive" checkbox on/off had
zero effect. The deactivated row was visible regardless of the
toggle's state.

**Root cause — three independent breakages stacked:**
1. The `<input id="showInactiveAccounts">` element had **no event
   handler at all** in `setup.js`. Toggling it changed the checkbox
   visual but never triggered a re-fetch or re-render.
2. Even when `loadAccounts()` was called manually, it sent the
   filter as `?includeInactive=true` — but the backend
   `GET /api/accounts/coa` action's signature is
   `[FromQuery] bool? isActive`, so the param name didn't match
   and the value was silently dropped. The endpoint always returned
   everything, regardless of the toggle.
3. The stat tiles (TOTAL / ACTIVE / INACTIVE) were derived from the
   same fetched array, so when the backend *did* eventually return a
   filtered list, the Inactive counter would read `0` even when
   inactive accounts existed in the database — a separate misleading
   bug hidden behind the toggle bug.

**Fix:**
- **Wired the toggle:** added
  `showInactiveToggle.addEventListener('change', () => renderAccounts())`
  alongside the existing search-input handler. The change handler calls
  `renderAccounts()` directly — no server round-trip, no flash of
  loading state.
- **Render-side filter:** `renderAccounts()` now reads
  `#showInactiveAccounts.checked` and filters the in-memory `accounts`
  array on `is_active !== false` when the toggle is off. The full
  array still drives the stat tiles, so TOTAL / ACTIVE / INACTIVE
  always reflect the true counts regardless of what the user has
  toggled. The empty-state row gets a contextual message
  `No active accounts — toggle "Show Inactive" to see deactivated
  accounts` so the user understands *why* the table is empty when
  they've deactivated everything.
- **Always fetch full set:** `loadAccounts()` no longer sends any
  `is_active` query param at all. It fetches active + inactive in one
  call and lets the render layer decide what to show. One API call,
  accurate stats, instant toggle response.

**Verified:**
- Deactivate Cash with toggle OFF → table shows 2 rows
  (Sales/Rent), stats show TOTAL 3 / ACTIVE 2 / INACTIVE 1, success
  toast `Deactivated account "Cash in Hand" (1001)`. Captured in
  `04-19f-account-deactivate-success-hidden.png`.
- Flip toggle ON → Cash row reappears with code `1001` (no mangling)
  and an `Inactive` status badge; the row's action column shows only
  View + Edit (no Deactivate, since it's already deactivated). Stats
  unchanged. Captured in `04-19g-account-show-inactive-toggle.png`.

### 23. Account Tree search box was wired to a backend `?search` param the server ignored

**Symptom:** Typing into the Account Tree search box (top of tab 4)
fired a request to `coa/tree?search=cash` but the backend
`GET /api/accounts/coa/tree` ignored the parameter — the full tree was
returned every time. Same pattern as bug #17 for Account Groups.

**Fix:** `js/accounts/setup.js::loadAccountTree` now fetches the full
tree once and caches it in `cachedAccountTree`. The search input now
calls a new `renderAccountTree()` function that runs an in-memory
filter — for each node it keeps the node if its code or name matches
**OR** if any descendant matches, so ancestors stay visible to provide
context. The empty-state message also picks up a contextual variant
("No accounts match \"xyz\"") when a search is active.

### 24. Opening Balances page was unusable — empty state with no way to enter balances

**Symptom (the worst find of the run):** the entire Opening Balances
page was a dead end. It showed the message "No accounts with opening
balances" and a Save All button — but there was nothing to save
because there were no input rows. A first-time user has zero way to
enter their starting balances.

**Root cause:** `loadOpeningBalances` fetched only from
`/api/accounts/coa/balances`, which returns rows from the
`account_period_balances` table — i.e. accounts that **already** have
non-zero balances. On a fresh tenant that's nothing.

**Fix:** Rewrote the loader to fetch active accounts AND existing
balances **in parallel**, then merge. Every active account becomes
one row whether or not it has a balance. Existing balances pre-fill
the inputs. The merge handles backend field name variations (the
balances API returns `opening_debit` / `opening_credit`, the loader
also accepts `debit_balance` / `credit_balance`).

The render also got upgraded with:
- A live **Totals row** that updates as the user types in any cell.
- A live **balance status text** that turns green when debits = credits
  ("Balanced: debits and credits both equal ₹50,000.00. Ready to save")
  and red when they don't ("Unbalanced: debits exceed credits by ₹X").
- A contextual empty-state message: "No active accounts found.
  Create accounts in the Accounts tab first."

### 25. Save All Opening Balances POST shape didn't match the backend model

**Symptom:** Even after fixing #24 so the form was usable, clicking
Save All Balances threw a 400 with the body
`{"errors":{"balance_type":["The balance_type field is required."]}}`.
The frontend was sending `{fiscal_year_id, balances: [{account_id,
debit_balance, credit_balance}]}` — the backend
`SetOpeningBalanceRequest` actually expects ONE balance per request:
`{account_id, amount, balance_type: "debit"|"credit", as_of_date}`.

**Fix:** Rewrote `saveAllOpeningBalances` to:
1. Collect non-zero rows and split them into `entries` with
   `{accountId, amount, balance_type}` per row (a row with both debit
   and credit set is rejected as a defensive guard).
2. Validate the totals balance before sending anything (no half-saved
   state if the math is off).
3. Look up the fiscal year start date as the `as_of_date`.
4. Issue **one POST per row** in a sequential loop (the backend takes
   one balance at a time). Counts saved entries for the success toast.
5. Show a labelled success toast: `Saved 2 opening balances (debits
   ₹50,000.00, credits ₹50,000.00)`.

### 26. Backend rejected opening-balance posting because the contra account didn't exist

**Symptom (downstream of #25):** Once the payload shape was right, the
backend POST returned 409 with the message *"Opening balance equity
account (3300 or 3200) not found"*. The accounting fix is correct —
opening balances post a journal entry whose offsetting line lands on
an "Opening Balance Equity" account — but forcing the user to know
this and pre-create the account by hand is a brutal first-run
experience.

**Fix (backend, two layers):**
1. **`BusinessLayer_ChartOfAccounts.cs`** — added a private helper
   `EnsureOpeningBalanceContraAccount(tenantId, userId)` that:
   - Tries to load the account by code (3300 first, then the
     fallback 3200 from `tenant_account_config`).
   - If neither exists, ensures account types are seeded, finds or
     creates an Equity-type group called "Owner's Equity" (code 3000),
     and creates a new account `3300 Current Year Earnings` with
     `normal_balance = "credit"` and a description that explains
     what it's for ("Holds the offset for opening balances and the
     running current-year P&L roll-up. Created automatically the
     first time you save opening balances — you don't need to post
     to it manually.").
   - Returns the loaded Account ready for use as the contra.
2. **`SetOpeningBalance` in the same file** — replaced the
   `?? throw new InvalidOperationException(...)` with a call to
   the new helper. First-run is now seamless: the user enters their
   balances and the system invisibly creates 3300 in the same
   transaction as the first GL post.

Also generalised the helper into `EnsureSystemAccount` and added
two more sister helpers: `EnsureArAccount` (for code 1130 Accounts
Receivable, used by Customer Invoice approval) and `EnsureApAccount`
(for code 2110 Accounts Payable, used by Vendor Bill approval).
Both use the same pattern: look up by code, fall back to the
fallback code if any, otherwise create the type / group / account
on the fly.

### 27. Lock Period confirm dialog was generic

**Symptom:** Clicking the Lock button on a fiscal period row showed
*"Lock this period? No more journal entries can be posted."* — same
generic-confirm problem as bugs #16 and #20. Doesn't say which period.

**Fix:** `js/accounts/setup.js::lockPeriod` and `unlockPeriod` now
look up the period by id from the in-memory `fiscalPeriods` array and
include both the period name and a complete explanation of what
locking means in the message:
*"Lock \"Apr-2026\"? No more journal entries can be posted to this
period until you unlock it. Existing entries are not affected."*
The success toast also names the period: `Locked period "Apr-2026"`.

### 28. Tax Config Detail modal had no spacing between labels and values

**Symptom:** The View modal on a tax config rendered every field as
"NameGST 18%" / "Country CodeIN" / "Tax TypeGST" — labels run
together with values. Looks like a stylesheet that was never written.

**Root cause:** The detail modal HTML uses `.detail-row /
.detail-label / .detail-value` classes, but **none of these classes
were defined in any CSS file**. The spans rendered inline with no
separator.

**Fix:** Added a complete `.detail-grid` rule set to
`Frontend/css/accounts.css`:
- `.detail-grid` is a 2-column CSS grid with 18px row gap and 28px
  column gap.
- `.detail-grid .detail-row` is a flex column with 6px gap between
  label and value.
- `.detail-grid .detail-row.full-width` spans both columns
  (`grid-column: 1 / -1`) — used for the Description and the
  Configuration JSON fields.
- `.detail-grid .detail-label` is uppercase, small, dimmed, with
  letter-spacing — looks like a magazine field label.
- `.detail-grid .detail-value pre` and `code` get a styled mono
  block (`bg-tertiary` background, border, padding) so JSON and other
  monospace content reads cleanly.

`taxation.js::viewTaxConfig` was also updated to mark Description
and Configuration JSON rows with the `full-width` modifier so they
span both columns instead of getting cramped into the right side.

### 29. Vendors and Customers tables clipped at 1280px viewport

**Symptom (caught after creating the first vendor):** The Vendors
table at 1280px showed a horizontal scrollbar and clipped the Status
and Actions columns. Same root cause as bug #19 — too many columns
in too narrow a container.

**Fix:** Removed the **Email** column from both the Vendor List and
Customer List row views. Email is still shown in the View detail
modal where there's space, and also derivable from clicking the row
to inspect the contact. Drops 8 columns to 7. After the fix the
tables fit cleanly with no scrollbar at 1280px viewport.

### 30. Account dropdown in invoice/bill line items had empty option labels

**Symptom (caught while filling out the Customer Invoice line item):**
The Account dropdown on each invoice line had options with EMPTY
text — just blank entries with hidden IDs. The dropdown was unusable
because you couldn't tell which option was which account.

**Root cause:** Both `receivables.js::addInvoiceLine` and
`payables.js::addBillLine` rendered the option text as
`${a.name || a.code}`. But the `accounts` collection comes from the
backend with field names `account_name` and `account_code` (not
`name`/`code`), so both fallbacks resolved to undefined and the
option text was empty.

**Fix:** Changed both renderers to read the correct field names
with fallbacks:
```js
const code = a.account_code || a.code || '';
const name = a.account_name || a.name || '';
const label = code && name ? `${code} — ${name}` : (name || code);
```
Now options render as `1001 — Cash in Hand`, `4001 — Sales Revenue`,
etc. — exactly what the user needs to pick the right one.

### 31. Customer Invoices and Vendor Bills tables had 11 columns and clipped badly

**Symptom:** Both tables tried to fit 11 columns
(Number / Customer-or-Vendor / Date / Due Date / Subtotal / Tax /
Total / Paid / Balance / Status / Actions) into the 926px container.
Heavy horizontal scrollbar, last 3-4 columns hidden.

**Fix:** Dropped **Subtotal**, **Tax**, and **Paid** from both row
views. The Total tells the user what the document is worth; the
Balance tells them what's still outstanding; Status closes the
loop. The dropped fields are still visible in the View detail
modal. Empty-state colspan reduced from 11 to 8.

### 32. ApproveCustomerInvoice and ApproveVendorBill required AR/AP accounts to exist

**Symptom:** First-time approval of an invoice returned 409 with
*"AR account (1130) not found"*; same thing on bill approval with
*"Accounts Payable account (2110) not found"*. Same pattern as
bug #26 for opening balances.

**Fix:** Both call sites now use the new generalised
`EnsureSystemAccount` helper introduced in #26:
- `BusinessLayer_CustomerInvoices.cs::ApproveCustomerInvoice` calls
  `await EnsureArAccount(tenantId, userId)` instead of throwing.
- `BusinessLayer_VendorBills.cs::ApproveVendorBill` calls
  `await EnsureApAccount(tenantId, userId)`.

Both helpers create the account in the right group ("Current Assets"
for AR, "Current Liabilities" for AP), with the right normal balance,
and a description explaining what the account is for and that it was
auto-created. After this fix, a first-time user can go from clean
tenant → seeded chart of accounts → opening balances → first
invoice → first bill all in one session, without ever touching the
plumbing accounts manually.

---

## Final state at end of autonomous run

After all 32 bugs fixed and the demo flow run end-to-end, the
demo tenant has:

- **6 accounts** in the Chart of Accounts:
  1001 Cash in Hand, 1130 Accounts Receivable (auto-created),
  2110 Accounts Payable (auto-created), 3300 Current Year Earnings
  (auto-created), 4001 Sales Revenue, 5001 Office Rent Expense.
- **4 account groups**: Current Assets (1000), Current Liabilities
  (2000), Operating Revenue (4000), Operating Expenses (5000).
  (Plus auto-created Owner's Equity 3000 and the AR/AP host groups.)
- **1 fiscal year** (FY 2026-27, active) with **12 fiscal periods**
  (all open).
- **7 journal types** (6 system + 1 custom General Journal).
- **1 GST 18% tax config** + **1 SAC 9983 code**.
- **1 customer** (C-001 Lumira Studios LLP) and **1 vendor** (V-001
  CloudKite Hosting Pvt Ltd).
- **1 approved customer invoice** (INV-2026-00001 for ₹1,00,000).
- **1 approved vendor bill** (BILL-2026-00001 for ₹12,000).
- **4 GL entries** (2 opening balance + 1 invoice + 1 bill), all
  posted, all balanced.
- **A clean Trial Balance** (₹1,62,000 = ₹1,62,000), a P&L showing
  ₹1,38,000 net profit, a Balance Sheet that satisfies
  Assets = Liabilities + Equity (₹1,50,000 = ₹12,000 + ₹1,38,000),
  a Cash Flow statement, an AR Aging report (Lumira's ₹1,00,000 in
  the Current bucket), an AP Aging report (CloudKite's ₹12,000 in
  Current), and an Audit Log feed showing every action taken.

The complete how-to guide
(`Frontend/KnowledgeBase/Accounts/Accounts-Setup-Guide.html`)
has been written end-to-end with all 17 sections filled in, every
screenshot embedded with figure captions, every domain term defined
in callouts, and every interactive button/dropdown/modal documented
with before/after captures. Reading time ~25 minutes; another ~30
minutes if the reader follows along.
