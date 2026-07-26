/**
 * Accounts "What is this?" education panels — one entry per section/subsection,
 * written for users with NO accounting background. Injected as a collapsed
 * <details class="acc-help"> at the top of each tab by AccountsCommon._injectHelpPanels.
 * Key = `${pageId}:${tabContentId}` (pageId as passed to AccountsCommon.initPage;
 * `_page` = page-level panel for pages without tabs).
 */
window.ACCOUNTS_HELP = {

    // ── Dashboard ─────────────────────────────────────────────────────────
    'accounts:_page':
        `<p><strong>Your money at a glance.</strong> Everything in Accounts follows one simple idea called <strong>double-entry</strong>: every transaction touches two places — money comes <em>from</em> somewhere and goes <em>to</em> somewhere. Sell something → your income goes up AND the customer owes you. Pay rent → your bank goes down AND your expenses go up.</p>
         <p>This dashboard summarises the result: revenue vs expenses, what customers owe you (<strong>receivables</strong>), and what you owe vendors (<strong>payables</strong>). Start with <strong>Setup</strong> if the books are empty, or <strong>Receivables → Invoices</strong> to bill your first customer.</p>`,

    // ── General Ledger ────────────────────────────────────────────────────
    'ledger:gl-entries':
        `<p><strong>The General Ledger (GL) is the master diary of your business.</strong> Every invoice, bill, payment and adjustment ends up here as an <strong>entry</strong> with two sides: a <strong>debit</strong> (where value went) and a <strong>credit</strong> (where it came from). The two sides always match — that's why Total Debit equals Total Credit on every row.</p>
         <p>You rarely create entries here by hand — they're posted automatically when you approve documents. Use this register to trace "where did this number come from?" for anything in your reports.</p>`,
    'ledger:create-gl':
        `<p><strong>A manual journal entry</strong> is for the rare cases no document covers — corrections, accruals, or opening adjustments. Pick a date and journal, then add at least two lines: what to <strong>debit</strong> (e.g. an expense that increased) and what to <strong>credit</strong> (e.g. the bank that paid it). The totals must balance before you can post.</p>
         <p><strong>Tip:</strong> debit = value IN to that account, credit = value OUT of it. Paying ₹1,000 insurance from bank → Dr Insurance Expense 1,000 / Cr Bank 1,000.</p>`,
    'ledger:journal-entries':
        `<p><strong>Journals are the "books" the ledger is organised into</strong> — Sales Journal for customer invoices, Purchase Journal for vendor bills, Bank Journal for money movements, Adjustment Journal for corrections. Same entries as the GL register, grouped by which book they belong to.</p>
         <p>The charts show which journals carry your value each month — a healthy trading business is usually dominated by Sales and Purchase journals.</p>`,

    // ── Receivables ───────────────────────────────────────────────────────
    'receivables:customer-invoices':
        `<p><strong>An invoice is a formal "you owe us" to a customer.</strong> When you approve one, the system records income AND adds the amount to <strong>Accounts Receivable</strong> (money owed to you). It stays "owed" until a payment clears it.</p>
         <p>Flow: create as <strong>Draft</strong> (editable) → <strong>Approve</strong> (locks it, posts to the ledger, gets a real invoice number) → <strong>Send</strong> → record the <strong>Payment</strong> when money arrives. GST is calculated automatically from the customer's state and registration.</p>`,
    'receivables:customer-payments':
        `<p><strong>Record money received from customers here.</strong> A payment does two things: increases your bank and reduces what the customer owes. You <strong>allocate</strong> the payment against specific invoices — that's how an invoice moves to Partially Paid or Paid.</p>
         <p>If a customer deducted <strong>TDS</strong> before paying (common in B2B India), enter it while recording — you receive less cash but the invoice still clears in full, and the TDS becomes a claimable credit.</p>`,
    'receivables:credit-notes':
        `<p><strong>A credit note is an "anti-invoice".</strong> Issue one when you over-billed, gave a discount after the fact, or the customer returned something. It reduces both your income and what the customer owes — without deleting the original invoice (deleting approved documents is never allowed in accounting; you always reverse with a new document).</p>`,
    'receivables:ar-aging':
        `<p><strong>Aging = how long invoices have been unpaid.</strong> Buckets group outstanding money by age: 0–30 days is normal, 31–60 needs a reminder, beyond 90 is at risk of never being collected. The rightmost red buckets are where to focus your follow-up calls today.</p>`,
    'receivables:customer-statements':
        `<p><strong>A statement is the full running history with one customer</strong> — every invoice (they owe more) and payment (they owe less) in order, ending at the current balance. Send it when a customer asks "what do I owe you?" or when your numbers and theirs disagree.</p>`,
    'receivables:tds-receivable':
        `<p><strong>TDS your customers deducted from your payments.</strong> In India, businesses often withhold ~2–10% tax when paying you and deposit it with the government against your PAN. It's not lost money — it's a prepaid tax credit you claim when filing your income-tax return. This tab tracks how much is sitting there, per customer.</p>`,

    // ── Payables ──────────────────────────────────────────────────────────
    'payables:vendor-bills':
        `<p><strong>A bill is an invoice you RECEIVED from a supplier</strong> — the mirror of a customer invoice. Approving it records the expense AND adds it to <strong>Accounts Payable</strong> (money you owe). Each line goes to an expense account (Rent, Advertising…) so reports show where money went; tag a <strong>cost centre</strong> to see which department spent it.</p>
         <p>GST on bills becomes <strong>input credit</strong> — tax you can subtract from the GST you owe on sales.</p>`,
    'payables:vendor-payments':
        `<p><strong>Record money you paid to vendors here.</strong> Allocate each payment against the bills it settles — the bank goes down, the amount you owe goes down. If you're required to deduct <strong>TDS</strong> on a vendor (e.g. contractors, rent), the system posts the withheld part to a TDS-payable account for you to deposit with the government.</p>`,
    'payables:debit-notes':
        `<p><strong>A debit note is the mirror of a credit note, on the buying side.</strong> Raise one against a vendor bill when you were overcharged or returned goods — it reduces the expense and what you owe that vendor, while keeping the original bill intact for the audit trail.</p>`,
    'payables:ap-aging':
        `<p><strong>How long YOUR unpaid bills have been sitting.</strong> Use it to plan cash: pay the oldest first to keep vendors happy, and watch the far buckets — chronically old payables strain supplier relationships and can signal cash-flow trouble.</p>`,
    'payables:vendor-statements':
        `<p><strong>The full running history with one vendor</strong> — every bill and every payment, ending at the balance you still owe. Reconcile it against the statement the vendor sends you; differences usually mean a missing bill or an unallocated payment.</p>`,

    // ── Banking ───────────────────────────────────────────────────────────
    'banking:bank-accounts':
        `<p><strong>Each real-world bank/cash account gets a card here,</strong> linked to a GL account so every deposit and withdrawal flows into the books. The balance shown is your <strong>book balance</strong> — what the ledger says you have, which can briefly differ from the bank's number until everything is recorded (that's what Reconciliation checks).</p>`,
    'banking:bank-transactions':
        `<p><strong>The register of money in and out of one bank account.</strong> Most rows appear automatically from payments; use <strong>Record Transaction</strong> for things that bypass documents — bank charges, interest earned, owner deposits. Every manual row needs a <strong>counter account</strong>: the "other side" that explains WHY money moved (charges → an expense account; interest → an income account).</p>`,
    'banking:bank-transfers':
        `<p><strong>Move money between your own accounts</strong> (e.g. current → savings, bank → petty cash). A transfer is NOT income or expense — it's the same money changing pockets, so it posts as one account down, the other up, with zero effect on profit.</p>`,
    'banking:statement-import':
        `<p><strong>Bulk-load your bank statement (CSV)</strong> instead of typing rows one by one. Map the columns, pick a counter account for the batch, and the system creates the transactions — skipping duplicates it has already seen. Great for catching up a month of activity in one go.</p>`,
    'banking:reconciliation':
        `<p><strong>Reconciliation = proving your books match the bank's statement.</strong> Enter the closing balance from the real bank statement, then tick off ("match") each book transaction that appears on it. When the ticked total equals the statement balance, you're reconciled — any leftover difference means something is missing or duplicated in your books. Do this monthly; it's the single best habit for trustworthy accounts.</p>`,

    // ── Reports ───────────────────────────────────────────────────────────
    'reports:trial-balance':
        `<p><strong>The accountant's health check.</strong> It lists every account with its debit or credit balance — and the two columns MUST be equal (that's double-entry doing its job). If a trial balance ever didn't balance, something is broken. You mostly use it to eyeball account balances in one place before deeper reports.</p>`,
    'reports:profit-loss':
        `<p><strong>Did we make money?</strong> The P&L (income statement) totals your income and subtracts expenses over a period: <strong>Revenue − Expenses = Profit</strong>. Only <em>approved/posted</em> documents in the selected fiscal year count — drafts don't exist yet as far as accounting is concerned.</p>`,
    'reports:balance-sheet':
        `<p><strong>What we own vs what we owe, frozen at one date.</strong> <strong>Assets</strong> (bank, receivables, equipment) on one side; <strong>Liabilities</strong> (loans, payables) + <strong>Equity</strong> (owner's stake incl. accumulated profit) on the other. The two sides always equal — hence "balance" sheet. P&L is a movie over a period; this is a photograph on a date.</p>`,
    'reports:cash-flow':
        `<p><strong>Profit is an opinion, cash is a fact.</strong> A profitable business can still die if customers haven't paid yet. This report tracks actual money moving — from operations (trading), investing (assets), and financing (loans/capital) — so you can see whether real cash grew or shrank.</p>`,
    'reports:account-ledger':
        `<p><strong>One account's full story.</strong> Pick any account (say, Rent or a customer) and see every entry that touched it with a <strong>running balance</strong> — like a bank passbook for that account. This is the drill-down you use when a report number looks wrong.</p>`,
    'reports:day-book':
        `<p><strong>Everything that happened on a single day,</strong> across all journals. Auditors and accountants use it to review a day's activity end-to-end.</p>`,
    'reports:cash-book':
        `<p><strong>The classic cashier's register:</strong> receipts on one side, payments on the other, for your cash and bank accounts. Small businesses often run entirely from this view.</p>`,
    'reports:ar-aging-report':
        `<p><strong>Snapshot of who owes YOU, by how old the debt is.</strong> Same idea as Receivables → AR Aging, but as a printable report for reviews and follow-up meetings.</p>`,
    'reports:ap-aging-report':
        `<p><strong>Snapshot of who YOU owe, by how old the bill is.</strong> Use it to prioritise payments and forecast the cash you'll need in the coming weeks.</p>`,

    // ── Taxation ──────────────────────────────────────────────────────────
    'taxation:tax-config':
        `<p><strong>The tax regimes your business operates under</strong> (e.g. GST for India). A configuration defines the tax type and its rules; rates hang off it. You normally seed India defaults once and rarely touch this again.</p>`,
    'taxation:tax-rates':
        `<p><strong>The actual percentages</strong> — GST 5/12/18/28%, TDS sections like 194C/194J, etc. When you pick "GST 18%" on an invoice line, this is where that rate lives. Intra-state sales split into CGST+SGST; inter-state becomes IGST — the system decides using your state vs the customer's.</p>`,
    'taxation:hsn-sac':
        `<p><strong>HSN (goods) and SAC (services) are government classification codes</strong> that must appear on GST invoices. Store the codes you commonly use with their default rates so invoice lines can auto-fill them.</p>`,
    'taxation:gstr-1':
        `<p><strong>GSTR-1 is the monthly return of your SALES.</strong> It lists the GST you charged customers (output tax), broken up by B2B/B2C and party. This screen assembles those numbers straight from your approved invoices, ready to file on the GST portal.</p>`,
    'taxation:gstr-3b':
        `<p><strong>GSTR-3B is the monthly summary where you actually pay.</strong> Output tax (on sales) minus <strong>input credit</strong> (GST you paid on purchases) = net GST payable. Keep bills entered promptly — every missed purchase bill is input credit you're leaving on the table.</p>`,
    'taxation:tds-return':
        `<p><strong>TDS you deducted from vendor payments has to be deposited and reported quarterly.</strong> This assembles deductee-wise totals (who, how much, under which section) from your recorded payments — the raw material for Form 26Q.</p>`,
    'taxation:tax-calculator':
        `<p><strong>A scratchpad:</strong> enter an amount and a rate to preview GST/TDS splits without creating any document. Nothing here posts to the books.</p>`,
    'taxation:tax-ledger':
        `<p><strong>Every tax rupee, in one register.</strong> Each row is tax charged on a sale (output), tax paid on a purchase (input credit), or TDS/TCS captured. The charts show output vs input by month — the gap between the red and green bars is roughly what you'll owe on GSTR-3B.</p>`,

    // ── Setup / COA ───────────────────────────────────────────────────────
    'setup:account-types':
        `<p><strong>The five families every account belongs to:</strong> <strong>Assets</strong> (what you own), <strong>Liabilities</strong> (what you owe), <strong>Equity</strong> (the owner's stake), <strong>Income</strong>, and <strong>Expenses</strong>. They're fixed by design — the P&L and Balance Sheet are built by classifying accounts into exactly these five.</p>`,
    'setup:account-groups':
        `<p><strong>Groups organise accounts within a type</strong> — e.g. "Current Assets" and "Fixed Assets" inside Assets. They exist purely to make reports readable; money never posts to a group itself.</p>`,
    'setup:accounts':
        `<p><strong>The Chart of Accounts (COA) is your filing system for money.</strong> Every rupee that moves lands in exactly one account — 5310 Rent, 1110 Bank, 4110 Product Sales. Create accounts sparingly: too many makes reports noisy, too few hides detail. Codes group naturally (all 5xxx = expenses).</p>`,
    'setup:account-tree':
        `<p><strong>The same chart of accounts, as a hierarchy.</strong> Parent accounts (5000 Expenses → 5300 Admin → 5310 Rent) let reports show subtotals at each level. Posting happens only at leaf accounts.</p>`,
    'setup:opening-balances':
        `<p><strong>Where your OLD books hand over to this system.</strong> If you switch software mid-life, enter each account's balance as of your start date here — otherwise the books start from zero and won't match reality. Total debits must equal total credits, like everything else.</p>`,
    'setup:fiscal-years':
        `<p><strong>The 12-month cycle your books are measured in.</strong> In India that's April–March (FY 2026-27 = Apr 2026 to Mar 2027). Reports like P&L are always "within a fiscal year"; at year-end you close the year to lock it.</p>`,
    'setup:fiscal-periods':
        `<p><strong>Each fiscal year splits into monthly periods.</strong> Locking a period stops anyone posting into it — do this after you've reconciled and reported a month so history can't quietly change under you.</p>`,
    'setup:journal-types':
        `<p><strong>The "books" entries get filed into</strong> — Sales, Purchase, Bank, Adjustment. Documents pick their journal automatically; you'd only add custom journals for special workflows.</p>`,
    'setup:templates':
        `<p><strong>One-click chart of accounts for your country.</strong> The India template creates a sensible GST-ready account structure so you don't start from a blank page. Apply once on a fresh tenant.</p>`,

    // ── Recurring ─────────────────────────────────────────────────────────
    'recurring:recurring-list':
        `<p><strong>Set-and-forget for repeating transactions.</strong> Rent every month, a SaaS invoice to a client, a quarterly insurance journal — define the template once, and the system generates the real document on schedule (as a draft/posted per rule). "Monthly-equivalent" in the charts normalises different frequencies so a yearly ₹1.2L and a monthly ₹10k compare fairly.</p>`,

    // ── Loans ─────────────────────────────────────────────────────────────
    'loans:loan-list':
        `<p><strong>Track borrowed money properly.</strong> A loan is NOT income — it's cash in hand plus an equal liability. Each EMI you pay splits into <strong>principal</strong> (reduces the liability) and <strong>interest</strong> (an expense). The schedule here does that split for you using reducing-balance math, so your P&L only shows the true cost (interest), never the principal.</p>`,

    // ── Billing (SaaS) ────────────────────────────────────────────────────
    'billing:billing-plans':
        `<p><strong>Your price list for recurring customer billing</strong> — e.g. Starter ₹5k/month, Enterprise ₹45k/year. Plans don't post anything by themselves; they're templates that subscriptions bill from.</p>`,
    'billing:subscriptions':
        `<p><strong>A subscription attaches a customer to a plan</strong> and generates their invoice each cycle. The value charts show your recurring revenue base at plan prices — the closest thing to MRR in these books.</p>`,
    'billing:usage-meters':
        `<p><strong>For usage-based pricing:</strong> define a meter (API calls, storage GB) with a rate per unit, record usage against customers, and billing turns consumption into invoice lines.</p>`,
    'billing:tokens':
        `<p><strong>Prepaid credits:</strong> customers buy tokens up front and burn them with usage. Purchases add to their balance; consumption draws it down.</p>`,

    // ── Admin ─────────────────────────────────────────────────────────────
    'admin:tenant-settings':
        `<p><strong>Business-wide accounting defaults.</strong> The <strong>GST home state</strong> matters most — it decides whether a sale is intra-state (CGST+SGST) or inter-state (IGST). Set it before approving any GST document.</p>`,
    'admin:custom-fields':
        `<p><strong>Add your own fields to documents</strong> (text, number, date, dropdown) — e.g. a "PO Reference" on invoices or "Approved by" on claims. They appear in forms and are stored with each document.</p>`,
    'admin:audit-logs':
        `<p><strong>Who did what, when.</strong> Every create/approve/cancel across the module is recorded here permanently. This is your defence in an audit and your first stop when something looks tampered with.</p>`,
    'admin:pending-approvals':
        `<p><strong>Money-sensitive actions that need a second pair of eyes</strong> queue here for an admin's approve/reject. Separation of duties: the person who requests shouldn't be the one who approves.</p>`,
    'admin:integrity-check':
        `<p><strong>An automated auditor.</strong> It re-verifies the books' invariants — debits equal credits, balances match ledgers, documents tie to their GL entries — and reports anything off. Run it after bulk imports or if a report looks impossible.</p>`,
    'admin:job-log':
        `<p><strong>The run history of background jobs</strong> — recurring generation, billing runs, reminders. If something that should have happened automatically didn't, check here first.</p>`,
    'admin:closing-checklists':
        `<p><strong>Month-end closing, as a checklist.</strong> Reconcile banks → review aging → lock the period. Working the list each month keeps the books consistently trustworthy instead of "we'll fix it at year-end".</p>`,
    'admin:year-end':
        `<p><strong>Closing a fiscal year</strong> zeroes income and expense accounts into retained earnings (Equity) so the new year starts fresh, and locks the old year. Do it only after the final P&L is reviewed — it's meant to be permanent.</p>`,
    'admin:danger-zone':
        `<p><strong>Destructive tools for superadmins only.</strong> Wiping tenant data is irreversible — it exists for test environments, not for "cleaning up" a live business.</p>`,

    // ── Projects ──────────────────────────────────────────────────────────
    'projects:pr-list':
        `<p><strong>Projects are analytical tags (per customer) for tracking billing per engagement.</strong> They don't affect the ledger — tag customer-invoice lines with a project, and the statement shows billed / collected / due for each engagement. Set a budget to compare against billing.</p>`,
    'projects:pr-stmt':
        `<p><strong>Per-project money view for one customer:</strong> how much you've <strong>billed</strong>, how much they've actually <strong>paid (collected)</strong>, and what's still <strong>due</strong>. Click a project row to expand the exact invoice lines behind the numbers.</p>`,

    // ── Budgets ───────────────────────────────────────────────────────────
    'budgets:budget-list':
        `<p><strong>A budget is your spending/earning plan per account for the fiscal year</strong> — e.g. "Rent ₹6L, Advertising ₹3L, Product Sales target ₹30L". On its own it posts nothing; its power shows up in Budget vs Actual.</p>`,
    'budgets:budget-analysis':
        `<p><strong>Plan vs reality.</strong> For each budgeted account: what you planned, what actually posted, and the <strong>variance</strong>. Read the colours by <em>favourability</em>, not direction — an expense UNDER budget is good (green), but income UNDER budget is bad (red).</p>`,

    // ── Parties ───────────────────────────────────────────────────────────
    'parties:vendor-list':
        `<p><strong>Your supplier master.</strong> GST treatment and state decide how tax applies on their bills (registered vendors give you input credit; unregistered don't). Keep GSTINs accurate — they flow onto documents and returns.</p>`,
    'parties:customer-list':
        `<p><strong>Your customer master.</strong> State + GST registration drive invoice tax (intra vs inter-state, or zero-rated for overseas). A customer's full money story lives in Receivables; this is just who they are.</p>`,
    'parties:pending-vendors':
        `<p><strong>Vendor records requested by other modules</strong> (e.g. Procurement) wait here for an accounts admin to approve before they become usable — keeping one clean, deduplicated master list.</p>`,
    'parties:pending-customers':
        `<p><strong>Customer records requested by other modules</strong> (e.g. CRM converting a won deal) wait here for approval before entering the customer master.</p>`,

    // ── Proforma ──────────────────────────────────────────────────────────
    'proforma-invoices:proforma-list':
        `<p><strong>A proforma is a quotation dressed as an invoice</strong> — it shows the customer exactly what they'd pay (with GST) but posts NOTHING to the books and creates no tax liability. When they accept, one click converts it into a real invoice. You can even quote a prospect who isn't a customer yet — the customer record is created only at conversion.</p>`,

    // ── Purchase Orders ───────────────────────────────────────────────────
    'purchase-orders:po-list':
        `<p><strong>A PO is a promise to buy, not a purchase.</strong> It documents what you agreed with a vendor (items, prices) before any money or goods move — nothing posts to the ledger yet. When goods arrive, convert the PO to a <strong>bill</strong>; that's the moment the expense and the payable become real.</p>`,

    // ── Expenses ──────────────────────────────────────────────────────────
    'expenses:expense-categories':
        `<p><strong>Friendly names employees pick from</strong> ("Travel", "Pantry") — each mapped to a real GL expense account behind the scenes. Employees never need to know account codes; the mapping does the accounting.</p>`,
    'expenses:expense-policies':
        `<p><strong>Guardrails for claims:</strong> per-category limits and receipt thresholds (e.g. "meals over ₹500 need a receipt"). Claims that breach a policy get flagged before approval.</p>`,
    'expenses:expense-claims':
        `<p><strong>Employees spend their own money, then claim it back.</strong> A claim is itemised against categories, then <strong>approved by someone else</strong> (you can't approve your own — that separation prevents fraud), which posts the expense and creates the reimbursement to pay out.</p>`,

    // ── Cost Centres ──────────────────────────────────────────────────────
    'cost-centres:cc-list':
        `<p><strong>Cost centres answer "WHICH PART of the business spent this?"</strong> — departments, branches, teams. They're tags on bill lines, not accounts: the expense still posts to Rent or Marketing; the cost centre adds the "who" dimension for the spend report.</p>`,
    'cost-centres:cc-spend':
        `<p><strong>Spend per department for a period,</strong> built from cost-centre-tagged bill lines. "Unassigned" is spending nobody tagged — a big Unassigned bar means the team is skipping tags when entering bills.</p>`,

    // ── Assets ────────────────────────────────────────────────────────────
    'assets:asset-categories':
        `<p><strong>Categories define HOW things depreciate:</strong> method, useful life, and which GL accounts to hit. E.g. Computers over 3 years, Furniture over 5. Every registered asset inherits the rules of its category.</p>`,
    'assets:asset-register':
        `<p><strong>Buying equipment isn't an expense — it's swapping cash for a thing you own (an asset).</strong> The cost enters the books gradually instead, via <strong>depreciation</strong>. <strong>Book value = cost − depreciation so far</strong>: the "cost vs book value" gap in the chart is exactly how much value has been consumed to date.</p>`,
    'assets:depreciation':
        `<p><strong>Running depreciation posts the period's wear-and-tear:</strong> Dr Depreciation Expense / Cr Accumulated Depreciation for every eligible asset up to your chosen date. Run it monthly or at year-end — once posted, it's reversed only by correcting journal entries, never deleted.</p>`,
};
