# How to create a Knowledge Base guide (for any Ragenaizer module)

> **Read this end-to-end before you write a single line of guide content.**
> This file is the canonical playbook used by every autonomous Claude
> session that produces a Knowledge Base guide. It is the "operating
> system" of the Knowledge Base. Treat every section as a non-negotiable.

---

## Why this file exists

The first guide we built was for **Accounts** (`KnowledgeBase/Accounts/Accounts-Setup-Guide.html`).
It set the bar for every guide that comes after it:

- A complete walkthrough that takes someone who has **never used the
  module before** from clean install to a working, bug-free, end-to-end
  flow.
- Every interactive element of the UI (every dropdown, every button,
  every modal, every confirmation, every row action) is **clicked,
  screenshotted, and explained**.
- Every screenshot reflects the **post-fix state** of the UI — if the
  capture session finds a glitch, the rule is **fix the glitch first,
  reload, screenshot the working version**. We never ship a broken
  screenshot.
- A live progress log (`_BUGS_FIXED_DURING_CAPTURE.md`) is updated
  after every phase so the work survives a crashed Claude session.

Future modules need to land at the same standard, and they need to feel
visually identical to Accounts so the Knowledge Base is one coherent
publication and not a pile of disconnected pages.

This document is the playbook to make that happen. It is not the guide
itself — it is the **instructions for producing the guide**.

---

## Mission and audience

### Audience

Imagine the reader is a **junior bookkeeper / junior HR analyst /
junior project coordinator** who:

- Has **never seen** the Ragenaizer product before.
- Has been **delegated** the setup task by their boss who told them
  "go figure it out."
- Does **not know what the module does** beyond the one-line marketing
  pitch their boss heard at a demo.
- Does **not know the domain vocabulary** ("trial balance", "fiscal
  year", "9-box grid", "burn-down chart", "KPI cascade") and will
  bounce if you use a term without defining it the first time.
- Is going to have the guide open in **one tab** and the actual
  Ragenaizer app open in another tab, **following along step-by-step**.
- Will be **judged on the result**. If they finish the guide and the
  module is half-set-up or broken, they get fired. So the guide has
  to actually work, in the actual product, top to bottom, with no
  hand-waving or "see the API docs" cop-outs.

### Mission

Ship a guide that, when followed end-to-end:

1. **Teaches** the reader what the module is and why it exists, before
   asking them to click anything.
2. **Defines every term** the first time it appears, in plain English,
   using a callout box.
3. **Walks them through the setup**, click by click, with a screenshot
   of every meaningful state change (empty form → filled form → saved
   row → table refreshed → confirm dialog → success toast).
4. **Exercises every interactive element** at least once: every filter
   dropdown, every search box, every row action button (View / Edit /
   Delete / Approve / etc.), every modal, every confirmation dialog.
5. **Leaves the reader with a working module**: a populated Chart of
   Accounts, an active fiscal year, a real customer, a real invoice,
   a clean Trial Balance — or whatever the equivalent is for the
   module being documented.
6. Reads like a **magazine article**, not like a wiki dump or an API
   reference. The Accounts guide hits ~25 minutes of read time. The
   reader should feel hosted, not lectured at.

---

## The five non-negotiables

If you do not internalise these, the guide will fail. Print them out
mentally before you start.

### 1. Fix the glitch first. Always.

Every screenshot in the published guide must reflect the **post-fix
state** of the UI. If you click a button during capture and it does
nothing, returns 500, throws a console error, shows a generic "Request
failed" toast, or renders a layout that's clipped — **stop**.

The protocol is:

1. **Diagnose** the bug. Read the console, check the Network tab,
   look at the backend logs (`/tmp/accounts-restart*.log` or
   equivalent), inspect the failing call.
2. **Fix it** in the source. Frontend, backend, schema migration —
   wherever the actual bug is. Do not work around it in JavaScript
   or hack the screenshot.
3. **Restart the affected service** (`dotnet build` then restart the
   `dotnet run` background process; bump `js/sw-version.js` if any
   frontend file changed).
4. **Reload the browser** (`browser_navigate` with a new `?cb=N` query
   param to bust the cache). Verify zero console errors.
5. **Re-trigger the action** that was broken.
6. **Take the screenshot** of the working state.
7. **Log the bug** in `_BUGS_FIXED_DURING_CAPTURE.md` with the format
   below (Symptom / Root cause / Fix / Verified).

The rule is non-negotiable because the screenshots are **also investor
demo material** and **also a QA pass against the module**. A broken
screenshot in the published guide tells every reader "this product
doesn't work." A fixed screenshot tells them "this product is polished."

### 2. Click everything. Skip nothing.

Every interactive element gets exercised at least once with a
before/after screenshot. The complete checklist for every page:

- **Every filter dropdown** — open it, pick an option, screenshot the
  filtered result, screenshot the dropdown's options menu, reset the
  filter.
- **Every search box** — type something, screenshot the narrowed
  result, screenshot the empty-state when the search has no matches,
  clear the search.
- **Every action button in the toolbar** — Add / Create / Import /
  Export / Refresh / Settings.
- **Every row action button** — View (eye), Edit (pencil), Delete /
  Deactivate (trash), Approve, Reject, Send, Pay, Reverse, Lock,
  Unlock, etc. Each one opens a modal or a confirm — screenshot
  before clicking, screenshot the modal/confirm, screenshot after
  the action completes.
- **Every confirm dialog** — verify it names the target ("Delete
  *Current Assets* (1000)?") and explains what's about to happen.
  If it's generic ("Are you sure?"), that's a bug — fix it (see
  the Accounts bug log entries #16, #20, #27 for the pattern).
- **Every modal** — empty state, filled state, saved/cancelled state.
  Verify all dropdowns inside the modal actually have option labels
  (Accounts bug #30: invoice line account dropdown was rendering
  empty options because field name mismatch).
- **Every toggle** — verify it actually does something. (Accounts
  bug #22: "Show Inactive" toggle had no event handler.)
- **Every table column** — verify columns fit the 1280px viewport
  without horizontal scroll. If they don't, trim columns and move
  the trimmed data into the View detail modal (Accounts bugs #19,
  #29, #31).
- **Every empty state** — capture it. The empty state is what the
  reader sees on day one and it's the first impression of the page.
- **Every populated state** — capture it after you've created the
  demo data the guide tells the reader to create.

If you skip a button, you have left a hole in the guide and a hole
in your QA pass. Neither is acceptable.

### 3. Maintain the live progress log.

Every guide has a sibling file at
`KnowledgeBase/<Module>/_BUGS_FIXED_DURING_CAPTURE.md` that you
update **after every phase**. Phase = a major section of the guide
(Setup, Customers, Invoices, Reports, etc.) or every ~5 bugs found,
whichever is more frequent.

The log has two purposes:

1. **Documentation** — every bug fixed during capture is recorded
   so engineering can review and reviewers can understand the work.
2. **Crash recovery** — if the Claude session running the capture
   dies (token limit, network error, browser crash), the next session
   reads this log to figure out where the previous one left off. The
   log is the **single source of truth** for "what's been done."

Format for each bug entry (copy this exactly):

```markdown
### N. Short symptom title

**Symptom (where it was caught):** Plain-English description of what
the user sees / what triggered the discovery. Be concrete: "clicking
the Approve button on a draft invoice returned a 409 with the toast
'AR account (1130) not found'", not "approve flow broken."

**Root cause:** Why it happens. Pin it to a specific file/function/
line if you can. If it's a schema issue, name the column. If it's a
field name mismatch, show both names.

**Fix (N files):**
1. `path/to/file.cs` — what you changed, why.
2. `path/to/other.js` — what you changed, why.
...

**Verified:** Concrete proof it works now. Reference the screenshot
filename(s) that capture the fixed state.
```

The log also has a "Final state at end of capture" section at the
bottom that the last phase updates with the demo tenant's complete
state (counts of every entity created, key reports, etc.) so the
reader of the log can verify the work matches the screenshots.

### 4. Style consistency. The guide must look like Accounts.

The Knowledge Base is a single publication. Every guide must use the
same type system, the same colour tokens, the same callout types, the
same section structure. The full type and colour spec is in the next
chapter of this document — **do not deviate from it** without first
updating this playbook.

The fastest way to stay consistent: **copy the Accounts guide HTML
file** as your starting point and replace the section content. The
shell — `<head>`, the foundational CSS, the sidebar TOC component,
the topbar, the print mode, the scripts at the bottom — should stay
identical across guides. Only the section bodies and the per-guide
metadata (title, OG tags, breadcrumb labels) change.

### 5. Performance and shareability are part of the deliverable.

Every published guide must:

- **Lazy-load all images** (`loading="lazy" decoding="async"` on every
  `<img>` tag). Without this, a 100-screenshot guide downloads ~25 MB
  on first load and feels broken on slow connections.
- **Have a complete OG card** so it looks beautiful when shared on
  WhatsApp, LinkedIn, Twitter. Use the reusable template at
  `KnowledgeBase/_shared/og-card.html` (see the OG section below).
- **Have full og:* + twitter:card meta tags** in the `<head>` pointing
  at the rendered card.
- **Be wired into the marketing navbar** (`Frontend/js/navbar.js`,
  the Knowledge Base dropdown) so people can actually find it.
- **Be responsive on mobile** down to 320px. The Accounts guide
  inherits this from the editorial layout; if you fork the layout
  drastically, retest at 390px.

---

## Pre-flight setup

Before writing a single line of guide content or taking a single
screenshot, get the workspace into a known-good state. The checklist:

### A. Services

Make sure every service the module depends on is running and healthy.
For most modules you'll need at minimum:

- **Authentication** (port 5098 / gRPC 5097) — required by every
  other service.
- **The module's own backend** — e.g. `AccountsService` (5122),
  `HRMS` (5104), `PMS` (5116), `Vision` (5099), etc. Check the table
  in `CLAUDE.md` for the canonical list.
- **PostgreSQL** in Docker (`pgvector` container).
- **Frontend** static server on port 5501.

Use the dedicated tool launcher you already have (`./deploy.sh` in
`Vision/Services/Documentation/`) for the infrastructure containers,
then `dotnet run` each service in its own background shell. Health-
check each one with `curl -k -s https://localhost:<port>/health`.

### B. Demo tenant state

Decide what the **demo data** is going to be **before** you start
clicking. The Accounts guide uses:

- Tenant ID: `5b325a7f-7ecb-4c8f-983e-db7bab4964ae`
- Superadmin: `abhishekanand.ko@gmail.com / July@1234`
- A consistent set of named entities: customer "Lumira Studios LLP",
  vendor "CloudKite Hosting Pvt Ltd", three accounts (1001 Cash,
  4001 Sales, 5001 Office Rent), opening balance ₹50,000, etc.

Pick names that are:

- **Memorable and distinctive** — no "Test Customer 1". Real-sounding
  brand names that the reader can recognise across screenshots.
- **Indian / international mix** — Lumira (Mumbai), CloudKite
  (Bengaluru), etc. The reader should see realistic data.
- **Internally consistent** — if the customer is in Mumbai, their
  GSTIN starts with 27. If the vendor is in Karnataka, their state
  code is 29. Domain accuracy matters.

Document the chosen demo data **at the top of the bug log file** so
future sessions can see what was used.

### C. Database snapshot

Before starting, snapshot the relevant database tables so you can
reset them if a destructive test goes wrong. For Accounts the
relevant tables are `accounts`, `account_groups`, `account_types`,
`gl_entries`, `gl_entry_lines`, `account_period_balances`,
`fiscal_years`, `fiscal_periods`, `customers`, `vendors`,
`customer_invoices`, `vendor_bills`. For HRMS it's the 62 HR
tables. For PMS it's the 12 project tables.

Quick snapshot pattern (run in the host shell):

```bash
docker exec pgvector pg_dump -U postgres -d hyperdroid_<module> \
  --data-only --table='public.<table1>' --table='public.<table2>' \
  > /tmp/<module>-snapshot-$(date +%Y%m%d).sql
```

You will not always need to restore from this — most of the time
the cleanup is just `TRUNCATE` + re-seed. But have it as a safety
net.

### D. Browser & viewport

All screenshots are taken at exactly **1280×800** viewport (the
default Playwright viewport for these guides). Do not deviate. The
columns of every table in the published UI are tuned to fit this
width without horizontal scroll. If you take a screenshot at 1440
or 1024 it will look subtly wrong next to the rest of the guide.

The screenshot tool is Playwright MCP (`mcp__playwright__browser_*`).
Always use PNG format for UI captures (not JPEG — JPEG creates
artefacts on the dark backgrounds and the small UI text). Screenshots
go directly into `KnowledgeBase/<Module>/images/` with sequential
filenames matching the section number (`04-3a-...`, `04-3b-...`, etc.).

---

## Project structure

Every Knowledge Base guide lives in its own subdirectory under
`Frontend/KnowledgeBase/`:

```
Frontend/KnowledgeBase/
├── _shared/                              ← shared assets across all guides
│   ├── HOW-TO-CREATE-A-GUIDE.md          ← THIS FILE
│   └── og-card.html                      ← reusable OG card template
│
├── Accounts/                             ← the canonical reference guide
│   ├── Accounts-Setup-Guide.html         ← the guide HTML
│   ├── _BUGS_FIXED_DURING_CAPTURE.md     ← live progress log
│   ├── _GUIDE_PLAN.md                    ← outline / plan (optional)
│   ├── og-image.png                      ← rendered OG card (1200×630)
│   └── images/                           ← all screenshots (PNG)
│       ├── 03-1-login.png
│       ├── 04-1-setup-hub-empty.png
│       └── ... (one per figure)
│
├── HRMS/                                 ← future guide
│   ├── HRMS-Setup-Guide.html
│   ├── _BUGS_FIXED_DURING_CAPTURE.md
│   ├── og-image.png
│   └── images/
│
└── PMS/                                  ← future guide
    └── ...
```

**File naming conventions:**

- The main guide HTML is named `<Module>-Setup-Guide.html`. Always
  this exact pattern. The breadcrumb at the top of the guide reads
  `Knowledge Base / <Module> / Setup Guide`, so the URL slug must
  match.
- The bug log is always `_BUGS_FIXED_DURING_CAPTURE.md`. The leading
  underscore sorts it to the top of the directory listing and signals
  "internal / not for users".
- The OG image is always `og-image.png` at the root of the guide
  folder, exactly 1200×630, exactly the file pointed at by the
  `og:image` meta tag.
- Screenshots inside `images/` are named `<section>-<sub>-<slug>.png`.
  Examples: `04-3-account-groups-empty.png`,
  `04-3a-groups-filter-dropdown-open.png`,
  `08-2a-vendor-create-modal-empty.png`.
  Section numbers match the guide's section numbering (so `04-...`
  is section 4 of the guide). Sub-letters group related captures
  (`a/b/c` for before/middle/after states).

---

## The progress log file (`_BUGS_FIXED_DURING_CAPTURE.md`)

This is the single most important operational artefact. Without it,
a crashed Claude session has no way to know where to resume.

### Top of the file (created at session start)

```markdown
# <Module> Setup Guide — Bugs Fixed During Capture

## Demo tenant
- Tenant ID: `<uuid>`
- Superadmin: `<email> / <password>`
- Demo entities: <list the named demo data you've decided to create>

## Capture progress

| Phase | Status | Last screenshot |
|-------|--------|-----------------|
| §1 Welcome              | ✅ done | 01-1-login.png         |
| §2 30k-ft view          | ✅ done | 02-1-arch-overview.png |
| §3 Login & dashboard    | ✅ done | 03-2-dashboard-empty.png |
| §4 <module-section>     | 🚧 in progress — last did `04-3c-edit-modal.png`, still need filter+delete |
| §5 ...                  | ⬜ not started |
| ...
```

Update the progress table **at the start and end of every phase**.
"In progress" entries should mention what the next action is, in
enough detail that a fresh Claude session could pick up.

### Bug entries (added inline as bugs are found)

```markdown
## Bugs found and fixed

### 1. <short-symptom-title>

**Symptom:** ...
**Root cause:** ...
**Fix (N files):** ...
**Verified:** screenshot `XX-Yy-...png`
```

Number bugs sequentially across the entire capture. Number 1 is the
first bug found in the first phase; number 32 is the last bug found
in the last phase. **Do not reset the counter per phase.**

### Bottom of the file (filled in at end of capture)

```markdown
## Final state at end of capture

After all <N> bugs fixed and the demo flow run end-to-end, the
demo tenant has:

- <X> accounts in the Chart of Accounts: ...
- <Y> account groups: ...
- <fiscal year, periods, customers, vendors, etc.>
- A clean Trial Balance: <numbers>
- ...

The complete how-to guide
(`Frontend/KnowledgeBase/<Module>/<Module>-Setup-Guide.html`)
has been written end-to-end with all <N> sections filled in,
every screenshot embedded, every domain term defined, and every
interactive button documented. Reading time ~<X> minutes.
```

---

## The guide HTML structure

Every guide HTML file follows the same skeleton. Copy it from the
Accounts guide as a starting template (`Frontend/KnowledgeBase/Accounts/Accounts-Setup-Guide.html`)
and replace section bodies. Do not rebuild the chrome from scratch.

### Sections every guide must have

1. **Welcome** (§1) — who this guide is for, what they'll have at the
   end, a 5-minute vocabulary primer of the domain terms they'll need.
2. **30,000-ft view** (§2) — what the module is in plain English, what
   problem it solves, the conceptual mental model, the setup roadmap
   (a numbered list of all the sections that follow).
3. **Logging in & the dashboard** (§3) — login screen, where to land,
   the KPI tiles explained, every Quick Action card explained, the
   recent activity feed.
4. **Foundation sections** (§4 onwards) — the core setup steps.
   Number and name these to match the module's actual setup tabs.
5. **Master data sections** — the named entities the user creates
   (customers, employees, projects, etc.).
6. **Transaction sections** — the workflows that produce data
   (invoices, payslips, time entries, etc.).
7. **Reports** — every standard report the module exposes, with a
   screenshot of each generated against the demo data.
8. **Closing / housekeeping** — period locks, year-end, audit logs,
   integrity checks.
9. **Beyond the basics** — a one-line tour of any related modules
   that aren't the focus of this guide.
10. **Glossary** (§N, always last) — every term used in the guide,
    defined in plain English. Each glossary entry links back to the
    section where the term is first introduced.

### Subsection structure

Within each section, follow this pattern for **every** subsection
that documents a UI surface:

1. **Subsection title** (e.g. "4.3 Tab 2 — Account Groups") — names
   what the subsection is about. The title should match the actual
   tab/page label in the product.
2. **Term callout** (if a new domain term is introduced) — defined in
   a `.callout--term` box with the term name, a one-line summary,
   and a paragraph of plain-English explanation.
3. **Prose paragraph** introducing what the page does and why the
   reader is being sent here.
4. **Empty-state figure** — screenshot of the page on day one with
   no data, with a `.figure__caption` describing what the reader
   is looking at.
5. **Modal-empty figure** (if there's a create flow) — screenshot of
   the create modal with all fields blank.
6. **Modal-filled figure** — screenshot of the same modal with the
   demo data typed in. The values used must match the demo data
   the rest of the guide assumes.
7. **Saved-state figure** — screenshot of the page after Save was
   clicked, showing the new row in the table.
8. **Row-action subsections** — for each row action button (View,
   Edit, Delete, etc.), one figure showing the resulting modal or
   confirm dialog.
9. **Filter / search subsections** — one figure per filter, showing
   the filtered state.

### Prose tone

- Write like a magazine, not a wiki. Sentences with rhythm, not
  bullet-point staccato. Bullets are for genuine lists, not for
  every paragraph.
- Use the **second person** ("you'll see", "click *Save*"), never
  "the user" or "one should".
- **Italicise** UI labels the first time you reference them inline
  (`*Save*`, `*Add Vendor*`).
- Use `<code>` for **identifiers, file names, URLs, query params,
  field names** (`payables.html`, `account_code`, `?cb=23`).
- Use `<strong>` for **emphasis on a single word**, sparingly.
- Always **define a term the first time** it appears, even if it's
  obvious to you. The reader has zero context.

---

## Type and design tokens (DO NOT DEVIATE)

Every guide inherits this CSS. It is in the `<style>` block at the top
of the Accounts guide HTML and **must be copied verbatim** into every
new guide HTML.

### Fonts

```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Onest:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

```css
--font-display: 'Instrument Serif', Georgia, 'Times New Roman', serif;
--font-body:    'Onest', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono:    'JetBrains Mono', ui-monospace, Menlo, monospace;
```

- **Instrument Serif** is the display face. Used for hero title,
  section titles, subsection titles.
- **Onest** is the body face. Used for prose, callouts, captions,
  TOC sidebar.
- **JetBrains Mono** is the monospace face. Used for `<code>`,
  filenames, URLs, query params, field names.

### Colour palette (light)

```css
--paper:   #faf9f6;        /* warm paper background */
--paper-2: #f3f1ea;        /* slightly darker section divider */
--ink:     #0a0a0a;        /* near-black body text */
--ink-2:   #2d2a26;        /* secondary text */
--ink-3:   #6b6660;        /* tertiary text / captions */
--ink-4:   #a8a39d;        /* faint text / metadata */
--line:    #e7e3da;        /* hairline borders */
--line-2:  #d8d4cb;        /* slightly darker borders */
--card:    #ffffff;        /* card surfaces */

--blue:       #3b82f6;     /* matches theme.css --brand-primary */
--blue-dark:  #2563eb;
--blue-light: #dbeafe;

--clay:       #b85c38;     /* terracotta editorial accent */
--clay-dark:  #8f4426;
--clay-light: #f5e6dc;
```

### Callout palette (six callout types)

```css
--tip-bg:  #ecfdf5;  --tip-border:  #10b981;  --tip-ink:  #065f46;   /* tips, do this */
--warn-bg: #fffbeb;  --warn-border: #f59e0b;  --warn-ink: #78350f;   /* warnings */
--term-bg: #eff6ff;  --term-border: #3b82f6;  --term-ink: #1e3a8a;   /* term definitions */
--try-bg:  #fdf3ee;  --try-border:  #b85c38;  --try-ink:  #8f4426;   /* try-this exercises */
--what-bg: #f5f3ff;  --what-border: #8b5cf6;  --what-ink: #5b21b6;   /* "what this proves" */
```

### Layout dimensions

```css
--sidebar-w:   280px;     /* TOC sidebar */
--content-w:   760px;     /* main prose column */
--margin-w:    96px;      /* left gutter for big section numbers */
--container-w: 1280px;    /* outer container */
```

The `--content-w: 760px` is critical. Figures use `figure--wide`
which used to break out of the content column with negative margins
but now stays inside it (we removed the breakout in the lazy-loading
commit because it was clipping into the sidebar at intermediate
viewports). All figures should fit comfortably inside 760px.

### Section numbering

The section numbers in the left margin are huge serif numerals
(`56–96px Instrument Serif`) positioned absolutely so they stick out
into the gutter. Subsection numbers are smaller (`14–18px JetBrains
Mono`) with a clay-coloured accent. The HTML pattern:

```html
<section class="section" id="s-4">
  <div class="section__head">
    <span class="section__num">04</span>
    <span class="section__eyebrow">Section four · Foundation</span>
    <h2 class="section__title">Chart of <em>Accounts</em>.</h2>
    <p class="section__sub">One-line summary of what this section covers.</p>
  </div>
  <hr class="section__rule">

  <div class="subsection" id="s-4-1">
    <span class="subsection__num">4.1</span>
    <h3 class="subsection__title">Where to find Accounts Setup</h3>
    <div class="prose">
      <p>...</p>
    </div>
    <figure class="figure figure--wide">
      <img loading="lazy" decoding="async" src="./images/04-1-...png" alt="...">
      <div class="figure__caption"><strong>Figure 4.1 —</strong> ...</div>
    </figure>
  </div>
</section>
```

### Callout HTML pattern

```html
<div class="callout callout--term">
  <div class="callout__icon">i</div>
  <div class="callout__body">
    <span class="callout__label">Term you'll see everywhere</span>
    <h4 class="callout__title">Chart of Accounts (CoA)</h4>
    <p>The complete list of every "bucket" your business records
       transactions against...</p>
  </div>
</div>
```

The four `callout--*` modifiers are `term`, `tip`, `warn`, `what`.
Pick the one that matches the message:

- **term** — defining a domain word the first time it appears.
- **tip** — recommended action, "you should also do X".
- **warn** — something that could go wrong, "be careful".
- **what** — meta commentary, "what this proves" or "what this tells you".

---

## The capture workflow (the actual loop you run)

For each section of the guide, the workflow is:

### Phase 1: Plan the section

Before opening Playwright, write a **section outline** in the bug
log. Three to five bullet points covering:

- What page(s) the section will document.
- What demo data it depends on (must already exist by this point in
  the guide flow).
- Which interactive elements need to be exercised (filters, action
  buttons, modals).
- What "success" looks like for the section (e.g. "the reader has
  created their first customer and can see them in the list").

### Phase 2: Click through the page in Playwright

Navigate to the page. Take a baseline empty-state screenshot. Then
exercise every interactive element, screenshotting before/after for
each. Use the `browser_evaluate` tool to inspect the DOM between
clicks (option labels, dropdown values, table row counts) so you
catch bugs that aren't visually obvious.

### Phase 3: Fix any bugs found

For every bug:

1. Diagnose. Read console, check network, inspect DOM.
2. Fix in the source.
3. Restart the affected service if backend; bump SW version if
   frontend.
4. `browser_navigate` with a new `?cb=N` to bust cache.
5. Verify zero console errors.
6. Re-trigger the action that was broken.
7. Re-screenshot the working state.
8. Log the bug in `_BUGS_FIXED_DURING_CAPTURE.md`.

### Phase 4: Write the guide section

Open the guide HTML, find the section placeholder, write the
content. Embed the screenshots you just captured. Define any new
terms in callouts. Make sure the prose flows from the previous
section.

### Phase 5: Update the progress log

Update the progress table at the top of the bug log. Mark the
current phase ✅ done. Mark the next phase 🚧 in progress with a
one-line "next action" hint.

### Phase 6: Verify the section renders correctly

`browser_navigate` to the guide HTML at the section anchor
(`?cb=N#s-X-Y`). Take a screenshot of the rendered section to
visually confirm the layout, the figures, and the captions all look
right. If the figures clip or the layout breaks, fix the CSS now —
do not let layout debt accumulate.

### Phase 7: Commit (optional)

For long guides, commit at logical breakpoints (every 3–5 sections)
so the work is saved on the remote. The commit message follows the
pattern:

```
feat(kb-<module>): sections N–M (<short summary>)

- §N <section name> — captured, written, X bugs fixed during.
- §N+1 ... — ...

Bugs in this batch: #X, #Y, #Z (see _BUGS_FIXED_DURING_CAPTURE.md
for symptom + root cause + fix per entry).
```

---

## OG card generation

Every guide gets a 1200×630 Open Graph card so it looks beautiful
when shared on WhatsApp, LinkedIn, Twitter. The card is generated
from the reusable template at
`Frontend/KnowledgeBase/_shared/og-card.html`.

### Generation steps

1. **Decide the hook**. The card has space for a 1–2 line title and
   a 2–3 line subtitle. Lead with the **most curiosity-generating
   line** — not a description. For Accounts the title is "How to
   set up *Accounts*" because the audience already knows what
   accounts are. For something like Procurement the hook might be
   "Stop chasing vendor approvals on WhatsApp." Think about who
   the reader is and what would make them stop scrolling.
2. **Pick a module accent colour** from the variants in `og-card.html`:
   `accounts` (amber), `hrms` (cyan), `vision` (violet), `drive`
   (emerald), `pms` (orange), `crm` (pink), `lms` (teal), `research`
   (indigo), `procurement` (lime), or `default` (terracotta).
3. **Render the template** with URL params:

   ```
   http://localhost:5501/KnowledgeBase/_shared/og-card.html
     ?title=How+to+set+up+%3Cem%3E<Module>%3C%2Fem%3E
     &subtitle=<one-line+description+with+the+hook>
     &kicker=KNOWLEDGE+BASE
     &module=<module-slug>
     &badge=<Module>
     &badge2=Setup+Guide
     &badge3=~25+min+read
     &url=ragenaizer.com/kb
   ```

4. **Resize Playwright** to exactly 1200×630, navigate to the URL,
   wait for fonts (`document.fonts.ready`), then screenshot to
   `Frontend/KnowledgeBase/<Module>/og-image.png`.

5. **Wire it into the guide HTML** with the meta tags shown below.

### OG meta tags (paste this into every guide's `<head>`)

Replace `<Module>` and the URLs with the actual values:

```html
<title>How to set up <Module> — Ragenaizer Knowledge Base</title>
<meta name="description" content="A complete walkthrough for setting up Ragenaizer <Module> from a clean install. Built for first-time implementers.">
<link rel="canonical" href="https://ragenaizer.com/KnowledgeBase/<Module>/<Module>-Setup-Guide.html">

<!-- Open Graph -->
<meta property="og:type" content="article">
<meta property="og:site_name" content="Ragenaizer Knowledge Base">
<meta property="og:url" content="https://ragenaizer.com/KnowledgeBase/<Module>/<Module>-Setup-Guide.html">
<meta property="og:title" content="How to set up <Module>">
<meta property="og:description" content="<copy of the OG card subtitle>">
<meta property="og:image" content="https://ragenaizer.com/KnowledgeBase/<Module>/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="How to set up <Module> — Ragenaizer Knowledge Base">
<meta property="og:locale" content="en_US">
<meta property="article:section" content="Knowledge Base">
<meta property="article:tag" content="<Module>">
<meta property="article:tag" content="Setup Guide">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@ragenaizer">
<meta name="twitter:title" content="How to set up <Module>">
<meta name="twitter:description" content="<same as og:description>">
<meta name="twitter:image" content="https://ragenaizer.com/KnowledgeBase/<Module>/og-image.png">
```

---

## Wiring the new guide into the navbar

The marketing nav lives in `Frontend/js/navbar.js`. Every guide
must be added to the **Knowledge Base dropdown** so users can find
it from the marketing site.

Find this block in `navbar.js`:

```html
<div class="nav-dropdown" data-nav="knowledge-base">
    <span class="nav-dropdown-trigger">Knowledge Base ...</span>
    <div class="nav-dropdown-menu">
        <div class="nav-dropdown-label">Setup Guides</div>
        <a href="/KnowledgeBase/Accounts/Accounts-Setup-Guide.html" class="nav-dropdown-item" data-nav="kb-accounts">
            Accounts <span>Books, invoices, GST — from zero</span>
        </a>
        <!-- ADD YOUR NEW GUIDE HERE -->
    </div>
</div>
```

Add a sibling `<a class="nav-dropdown-item">` for the new guide,
matching the format. Then add a matching entry to the **mobile**
nav block lower in the same file:

```html
<div class="nav-mobile-section">Knowledge Base</div>
<a href="/KnowledgeBase/Accounts/..." class="nav-mobile-link" ...>
    Accounts <span>...</span>
</a>
<!-- ADD YOUR NEW GUIDE HERE TOO -->
```

After editing `navbar.js`, **bump `Frontend/js/sw-version.js`** so
the service worker picks up the change.

---

## Pre-commit checklist (run this before every push)

Walk through this list before `git push`. Any "no" stops the commit.

- [ ] Every section of the guide is filled in (no `_GUIDE_PLAN.md`
      placeholder text leaking into the published HTML).
- [ ] Every screenshot referenced in the HTML actually exists in
      `images/`. Run a grep to verify:
      ```bash
      grep -oE 'src="\./images/[^"]+"' <Module>-Setup-Guide.html | sed 's|src="\./images/||;s|"||' | sort -u > /tmp/refs.txt
      ls images/ | sort -u > /tmp/exist.txt
      comm -23 /tmp/refs.txt /tmp/exist.txt
      # ↑ should print nothing
      ```
- [ ] Every `<img>` has `loading="lazy" decoding="async"`. Run:
      ```bash
      grep -c '<img loading="lazy" decoding="async"' <Module>-Setup-Guide.html
      ```
      The count should equal the total `<img>` count in the file.
- [ ] The TOC sidebar in the guide HTML matches the actual subsection
      headings (no leftover placeholder titles).
- [ ] OG meta tags are present and the OG image renders correctly
      at 1200×630.
- [ ] The new guide is added to the marketing navbar (desktop and
      mobile).
- [ ] `js/sw-version.js` has been bumped.
- [ ] `_BUGS_FIXED_DURING_CAPTURE.md` has its "Final state at end
      of capture" section filled in with the demo tenant counts.
- [ ] Open the guide in Playwright. Verify zero console errors.
      Take a final hero screenshot to confirm the magazine layout
      renders correctly.
- [ ] Open the guide in Playwright at 390px viewport. Verify it's
      readable (no horizontal scroll, no clipped figures).
- [ ] All bug fixes are committed in their respective service repos
      (the frontend repo can't have a green commit referencing a
      backend fix that isn't pushed yet).

---

## Resume protocol (when a Claude session crashes)

A long capture session can take 100+ tool calls and easily exceed a
token budget or hit a network glitch. The next session inherits an
unfinished workspace. The protocol to pick up cleanly:

1. **Read the bug log file first**, before doing anything else.
   `KnowledgeBase/<Module>/_BUGS_FIXED_DURING_CAPTURE.md` is the
   single source of truth. Look at the "Capture progress" table
   at the top and find the row marked 🚧 in progress. The "next
   action" hint there tells you exactly where to resume.

2. **Read the existing guide HTML** to see what's already written.
   The phases that are complete will have full content; the
   in-progress phase will be partially written or empty.

3. **Verify the demo tenant state**. Run a quick query against the
   relevant DB tables to confirm the entities the previous session
   was working with still exist. If the previous session got
   partway through creating demo data, finish creating it before
   you start capturing again.

4. **Check git status**. The previous session may have committed
   some work and left the rest uncommitted. Don't accidentally
   re-create files that already exist.

5. **Start the affected services** if they're not running. The
   previous session probably left them running but a kernel
   reboot or laptop sleep can have killed them. Health-check
   each one.

6. **Resume from the marked phase**. Update the progress table to
   mark the row 🚧 → ✅ if you confirmed it's actually done, or
   pick up the click-through where the previous session left off.

7. **Never restart from scratch**. If a phase looks "almost done",
   finish it. Do not regenerate screenshots that already exist
   unless the bug log says they're stale.

---

## A worked example: how the Accounts guide was built

For reference, the Accounts guide was built in this approximate order
across two long Claude sessions. Use this as the template for what
"good" looks like.

1. **Pre-flight** — chose tenant ID, demo entities, snapshotted the
   `accounts*` tables, started AccountsService + Auth + Postgres.
2. **§4 Account Types** — captured (no bugs).
3. **§4.3 Account Groups** — captured + filter test + delete confirm
   test. Found bugs #15 (code column missing), #16 (generic confirm),
   #17 (broken search), #18 (DELETE endpoint missing). Fixed all
   four end-to-end through schema migration, backend endpoint, and
   frontend rewrite. Re-captured every screenshot.
4. **§4.4 Accounts** — captured + view/edit/deactivate test. Found
   bugs #19 (table clipped), #20 (generic confirm), #21 (account
   code mangled on soft-delete — schema migration to partial unique
   index), #22 (Show Inactive toggle was wired to nothing).
5. **§4.5 Account Tree** — captured + tree search test. Found bug
   #23 (tree search wired to ignored backend param).
6. **§7 Opening Balances** — found bug #24 (page was unusable, the
   loader only fetched accounts that already had balances), #25
   (POST shape mismatched backend model), #26 (backend required a
   contra account that didn't exist — added auto-create helper).
7. **§5 Fiscal Years / §5.2 Periods / §5.3 Journal Types / §5.4
   Templates** — captured. Bug #27 (lock period generic confirm).
8. **§6 Tax** — captured. Bug #28 (tax detail modal had no
   `.detail-grid` CSS so labels and values ran together).
9. **§8 Customers / §9 Vendors** — captured. Bug #29 (tables
   clipped), generalised CSS table fix.
10. **§10 Customer Invoices / §11 Vendor Bills** — captured. Bugs
    #30 (account dropdown empty options), #31 (invoice/bill tables
    clipped), #32 (approve required AR/AP accounts that didn't
    exist — extended auto-create helper).
11. **§12 General Ledger / §13 Reports** — captured. Generated
    Trial Balance, P&L, Balance Sheet, Cash Flow, AR/AP Aging
    against the real data created in earlier sections. Trial
    Balance was unbalanced because of stale `current_balance`
    rows from earlier debug runs — recomputed from GL.
12. **§14 Audit logs / §15 Beyond the basics** — captured.
13. **Wrote section bodies** in the guide HTML, embedded all 115
    screenshots, defined 18 terms in callouts.
14. **Generated OG card** via the shared template, wired the OG
    meta tags, added the guide to the navbar Knowledge Base
    dropdown.
15. **Committed and pushed**.
16. **Follow-ups**: lazy-load all images, fix figure alignment,
    fix mobile responsive.

Total: 32 bugs fixed end-to-end, 115 screenshots, ~2700 lines of
guide HTML, 17 sections + glossary, ~25 minute read time. Both
backend and frontend bug fixes pushed to GitHub. Demo tenant left
in a coherent end-to-end working state for the investor demo.

---

## Final word

The Accounts guide is the bar. Every future guide should feel like
it could have been published in the same magazine issue as the
Accounts one. If you find yourself cutting corners — skipping a
button click, shipping a "Request failed" toast in a screenshot,
leaving the bug log empty, deviating from the type tokens — stop,
re-read this file, and do it right.

The reader's boss is going to fire them if the guide doesn't work.
Take that personally.
