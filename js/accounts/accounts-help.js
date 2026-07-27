/**
 * Accounts "What is this?" education panels — one entry per section/subsection,
 * written for users with NO accounting background, each with a concrete worked
 * example. Injected as a collapsed <details class="acc-help"> at the top of each
 * tab by AccountsCommon._injectHelpPanels.
 * Key = `${pageId}:${tabContentId}` (pageId as passed to AccountsCommon.initPage;
 * `_page` = page-level panel for pages without tabs).
 */
window.ACCOUNTS_HELP = {

    // ── Inventory ─────────────────────────────────────────────────────────
    'inventory:inv-items':
        `<p><strong>Your product catalog.</strong> An <strong>item</strong> is anything you sell or buy repeatedly — a product (goods) or a service. Give it a SKU (your short code), price, GST slab and HSN code once, and billing becomes "pick item, quantity 2" instead of retyping everything. Tick <strong>Track stock</strong> for physical goods so the system counts what's on the shelf; tick <strong>Serial-tracked</strong> for things with warranties (phones, laptops) so each unit is tracked individually. The ⚙ button opens the <strong>Bill of Materials</strong> — a recipe for items you assemble from components.</p>
         <p><strong>Example:</strong> "LAP-DELL-5520 — Dell Latitude, ₹62,000, GST 18%, warranty 12 months, serial-tracked, reorder at 3". Now every sale deducts stock, computes profit, and starts a 12-month warranty clock per serial number.</p>`,
    'inventory:inv-stock':
        `<p><strong>What's on the shelf, and what it's worth.</strong> Stock is valued at <strong>weighted-average cost</strong>: buy 10 @ ₹800 then 5 @ ₹900 and each unit is worth ₹833.33 in your books. The two big numbers at the top must always match — <strong>Stock Valuation</strong> (counted from items) and the <strong>Inventory GL balance</strong> (from the accounting ledger). "Books in Sync ✓" is your audit-grade guarantee. Use <strong>Adjust Stock</strong> for stock-takes (differences post to Cost of Goods Sold) and for <strong>opening stock</strong> when you first join (posts against opening balance equity, not your profit).</p>
         <p><strong>Example:</strong> your stock-take finds 2 damaged keyboards. Adjust −2: stock drops, and ₹1,000 posts to COGS automatically — your profit honestly reflects the loss, no journal entry needed.</p>`,
    'inventory:inv-movements':
        `<p><strong>Every stock in and out, forever.</strong> This is the stock ledger — the inventory equivalent of your bank statement. Approving a purchase bill writes a <em>Purchase in</em>; approving an invoice writes a <em>Sale out</em> at average cost; adjustments, opening stock and assembly builds all leave rows here. Nothing edits stock silently.</p>
         <p><strong>Example:</strong> "Where did my 4 missing power banks go?" Filter the item: 20 in on BILL-2026-014, 14 sold across 6 invoices, 2 written off in the March stock-take — leaving 4 on the shelf. Every row links to its document.</p>`,
    'inventory:inv-serials':
        `<p><strong>Warranty desk.</strong> For serial-tracked items, every unit has its own record: which bill it arrived on, which invoice sold it, to whom, and <strong>when its warranty ends</strong> (sale date + the item's warranty months). A customer walks in with a device — scan or type the serial, press Enter, and you instantly see IN WARRANTY or OUT OF WARRANTY with the full purchase story. Mark units <em>returned</em> or <em>claimed</em> to keep the service trail.</p>
         <p><strong>Example:</strong> serial PH-88231 → "Sold to Meera Traders on INV-2026-0042, 2026-03-11 — IN WARRANTY until 2027-03-11." No register, no arguing over receipts.</p>`,

    // ── Cash Sale (POS) ───────────────────────────────────────────────────
    'pos:pos-counter':
        `<p><strong>The 30-second counter sale.</strong> Tap items (or scan a SKU into the search box and press Enter), take the money, done. Behind the scenes this does full accounting in one motion: creates a tax invoice for the <strong>Walk-in Customer</strong>, approves it (revenue + GST + stock out + cost of goods sold all post), records the payment into the account you picked, and prints an 80mm receipt. Items priced "GST-inclusive" are split correctly — a ₹499 MRP at 18% books ₹422.88 revenue + ₹76.12 GST.</p>
         <p><strong>Example:</strong> 2 × Mouse ₹500 + 1 × Keyboard ₹1,500 by UPI → total ₹2,950 with GST, stock down 3 units, profit margin recorded, receipt printed. One tap. Mixed GST slabs are handled automatically — the sale splits into one invoice per slab behind the scenes, settled by a single payment. Serial-tracked items prompt you for which units were sold, starting their warranties.</p>`,

    // ── Dashboard ─────────────────────────────────────────────────────────
    'accounts:_page':
        `<p><strong>Your money at a glance.</strong> Everything in Accounts follows one simple idea called <strong>double-entry</strong>: every transaction touches two places — money comes <em>from</em> somewhere and goes <em>to</em> somewhere. This dashboard summarises the result: revenue vs expenses, what customers owe you (<strong>receivables</strong>), and what you owe vendors (<strong>payables</strong>).</p>
         <p><strong>Example:</strong> you invoice a client ₹1,00,000 and pay ₹30,000 rent. The dashboard now shows revenue ₹1,00,000, expenses ₹30,000, and — until the client pays — ₹1,00,000 sitting in receivables. Profit says ₹70,000, but your bank has only gone DOWN ₹30,000 so far. That gap is why every card here matters.</p>`,

    // ── General Ledger ────────────────────────────────────────────────────
    'ledger:gl-entries':
        `<p><strong>The General Ledger (GL) is the master diary of your business.</strong> Every invoice, bill, payment and adjustment ends up here as an <strong>entry</strong> with two sides: a <strong>debit</strong> (where value went) and a <strong>credit</strong> (where it came from). The two sides always match — that's why Total Debit equals Total Credit on every row. You rarely create entries here by hand — they post automatically when you approve documents.</p>
         <p><strong>Example:</strong> you approve a ₹18,500 maintenance bill. The system writes one GL entry: <em>Dr Repairs &amp; Maintenance 18,500 / Cr Accounts Payable 18,500</em> — the expense went UP, and so did what you owe the vendor. When you later pay it: <em>Dr Accounts Payable 18,500 / Cr Bank 18,500</em>. Two entries, and every rupee is traceable.</p>`,
    'ledger:create-gl':
        `<p><strong>A manual journal entry</strong> is for the rare cases no document covers — corrections, accruals, or opening adjustments. Add at least two lines: what to <strong>debit</strong> (value IN to that account) and what to <strong>credit</strong> (value OUT of it). The totals must balance before you can post.</p>
         <p><strong>Example:</strong> you paid ₹12,000 insurance for the year from the bank, but forgot to record it. Create: <em>Dr Insurance Expense 12,000 / Cr Bank 12,000</em>. Or month-end electricity is used but unbilled — accrue it: <em>Dr Electricity Expense 4,000 / Cr Expenses Payable 4,000</em>, so July's P&L carries July's cost.</p>
         <p><strong>Salaries without a payroll module:</strong> the classic multi-line entry. Month-end, accrue: <em>Dr Salary &amp; Wages 1,50,000 (gross) / Cr Salary Payable 1,45,000 (net) / Cr TDS Payable 5,000</em> — the month carries its own salary cost even if payday is the 5th. On payday, record a bank withdrawal against <em>Salary Payable</em> for the net; when you deposit the TDS with the government, another against <em>TDS Payable</em>. Tip: set this up once as a monthly rule in <strong>Recurring</strong> and it posts itself.</p>`,
    'ledger:journal-entries':
        `<p><strong>Journals are the "books" the ledger is organised into</strong> — Sales Journal for customer invoices, Purchase Journal for vendor bills, Bank Journal for money movements, Adjustment Journal for corrections. Same entries as the GL register, grouped by which book they belong to.</p>
         <p><strong>Example:</strong> in a typical month you'd see: 6 entries in Sales (your invoices), 4 in Purchase (vendor bills), 10 in Bank (payments in/out), 1 in Adjustment (a correction). If Adjustment suddenly has 15 entries, someone is fixing a lot of mistakes — worth asking why.</p>`,

    // ── Receivables ───────────────────────────────────────────────────────
    'receivables:customer-invoices':
        `<p><strong>An invoice is a formal "you owe us" to a customer.</strong> Approving it records income AND adds the amount to <strong>Accounts Receivable</strong> (money owed to you). Flow: <strong>Draft</strong> (editable) → <strong>Approve</strong> (locks it, posts to the ledger, gets a real number) → <strong>Send</strong> → record the <strong>Payment</strong> when money arrives. GST is calculated automatically from the customer's state and registration.</p>
         <p><strong>Example:</strong> you bill Acme Pvt Ltd ₹1,00,000 for a website. Both of you are in UP, Acme is GST-registered → the invoice becomes ₹1,00,000 + ₹9,000 CGST + ₹9,000 SGST = <strong>₹1,18,000</strong>. Your income shows ₹1,00,000 (the tax is never your income — you're just collecting it for the government), and Acme owes you ₹1,18,000.</p>`,
    'receivables:customer-payments':
        `<p><strong>Record money received from customers here.</strong> A payment increases your bank and reduces what the customer owes. You <strong>allocate</strong> it against specific invoices — that's how an invoice becomes Partially Paid or Paid. If a customer deducted <strong>TDS</strong> before paying, enter it while recording — you receive less cash but the invoice still clears in full.</p>
         <p><strong>Example:</strong> Acme owes ₹1,18,000 but transfers ₹1,16,000, having deducted 2% TDS on the ₹1,00,000 base (₹2,000). Record payment: amount ₹1,18,000, TDS ₹2,000, allocate ₹1,18,000 to the invoice. Bank +₹1,16,000, invoice fully Paid, and ₹2,000 parks in TDS Receivable — tax already paid on your behalf, claimable at return time.</p>`,
    'receivables:credit-notes':
        `<p><strong>A credit note is an "anti-invoice".</strong> Issue one when you over-billed, gave an after-the-fact discount, or the customer returned something. It reduces both your income and what the customer owes — without deleting the original invoice (approved documents are never deleted in accounting; you always reverse with a new document).</p>
         <p><strong>Example:</strong> you billed ₹50,000 but the client negotiated ₹5,000 off after delivery. Issue a ₹5,000 credit note against that invoice: their balance drops to ₹45,000 and your revenue adjusts down ₹5,000 — with a clean paper trail showing both the original price and the concession.</p>`,
    'receivables:ar-aging':
        `<p><strong>Aging = how long invoices have been unpaid.</strong> Buckets group outstanding money by age: 0–30 days is normal, 31–60 needs a reminder, beyond 90 is at risk of never being collected. The rightmost red buckets are where to focus your follow-up calls today.</p>
         <p><strong>Example:</strong> ₹6,00,000 outstanding might split as ₹3,50,000 (0–30d, fine), ₹1,50,000 (31–60d, send reminders), ₹1,00,000 (90d+, call them today). Same total, very different urgency — that's what the buckets reveal.</p>`,
    'receivables:customer-statements':
        `<p><strong>A statement is the full running history with one customer</strong> — every invoice (they owe more) and payment (they owe less) in order, ending at the current balance. Send it when a customer asks "what do I owe you?" or when your numbers and theirs disagree.</p>
         <p><strong>Example:</strong> Invoice ₹1,18,000 (balance 1,18,000) → payment ₹60,000 (balance 58,000) → invoice ₹40,000 (balance 98,000). If the customer insists they owe ₹58,000, the statement shows them the second invoice they missed.</p>`,
    'receivables:tds-receivable':
        `<p><strong>TDS your customers deducted from your payments.</strong> In India, businesses withhold ~2–10% tax when paying you and deposit it with the government against your PAN. It's not lost money — it's a prepaid tax credit you claim when filing your income-tax return. This tab tracks how much is sitting there, per customer.</p>
         <p><strong>Example:</strong> across the year, three clients deducted ₹2,000 + ₹15,000 + ₹8,000 = <strong>₹25,000 TDS</strong>. At return time your CA verifies it against Form 26AS and sets it off against your tax bill — pay ₹25,000 less (or get a refund). Ignore this tab and that's ₹25,000 quietly forgotten.</p>`,

    // ── Payables ──────────────────────────────────────────────────────────
    'payables:vendor-bills':
        `<p><strong>A bill is an invoice you RECEIVED from a supplier</strong> — the mirror of a customer invoice. Approving it records the expense AND adds it to <strong>Accounts Payable</strong> (money you owe). Each line goes to an expense account so reports show where money went; tag a <strong>cost centre</strong> to see which department spent it. GST on bills becomes <strong>input credit</strong> — tax you subtract from the GST you owe on sales.</p>
         <p><strong>Example:</strong> your ad agency bills ₹45,000 + 18% GST = ₹53,100. Line account: 5510 Advertising, cost centre: Marketing. Your books record ₹45,000 expense, ₹8,100 input credit (reduces next month's GST payment), and ₹53,100 owed to the agency.</p>`,
    'payables:vendor-payments':
        `<p><strong>Record money you paid to vendors here.</strong> Allocate each payment against the bills it settles — bank goes down, the amount you owe goes down. If you must deduct <strong>TDS</strong> on a vendor (contractors, rent, professional fees), the system posts the withheld part to a TDS-payable account for you to deposit with the government.</p>
         <p><strong>Example:</strong> your landlord's rent bill is ₹50,000 and rent TDS (194-I) is 10%. You pay the landlord ₹45,000, record TDS ₹5,000 — the bill still clears in full, and ₹5,000 sits in TDS Payable until you deposit it against the landlord's PAN by the 7th of next month.</p>`,
    'payables:debit-notes':
        `<p><strong>A debit note is the mirror of a credit note, on the buying side.</strong> Raise one against a vendor bill when you were overcharged or returned goods — it reduces the expense and what you owe, while keeping the original bill intact for the audit trail.</p>
         <p><strong>Example:</strong> the AC vendor billed ₹14,750 but you'd agreed ₹12,250. Raise a ₹2,500 debit note against that bill: you now owe ₹12,250, the expense corrects itself, and both documents survive for the auditor.</p>`,
    'payables:ap-aging':
        `<p><strong>How long YOUR unpaid bills have been sitting.</strong> Use it to plan cash: pay the oldest first to keep vendors happy, and watch the far buckets — chronically old payables strain supplier relationships and can signal cash-flow trouble.</p>
         <p><strong>Example:</strong> you owe ₹4,00,000 total: ₹2,50,000 is fresh (0–30d), but ₹80,000 to your key component supplier is 75 days old. That ₹80,000 is the cheque to cut TODAY — losing that supplier costs more than any late fee.</p>`,
    'payables:vendor-statements':
        `<p><strong>The full running history with one vendor</strong> — every bill and every payment, ending at the balance you still owe. Reconcile it against the statement the vendor sends you; differences usually mean a missing bill or an unallocated payment.</p>
         <p><strong>Example:</strong> the vendor says you owe ₹1,20,000; your statement says ₹95,000. Comparing line by line you find their March bill of ₹25,000 never reached you — enter it, and both books agree again.</p>`,

    // ── Banking ───────────────────────────────────────────────────────────
    'banking:bank-accounts':
        `<p><strong>Each real-world bank/cash account gets a card here,</strong> linked to a GL account so every deposit and withdrawal flows into the books. The balance shown is your <strong>book balance</strong> — what the ledger says you have, which can briefly differ from the bank's number until everything is recorded (that's what Reconciliation checks).</p>
         <p><strong>Example:</strong> HDFC Current for daily trading, ICICI for savings/sweeps, and a Petty Cash box for office expenses under ₹500 — three cards, three GL accounts, one complete cash picture.</p>`,
    'banking:bank-transactions':
        `<p><strong>The register of money in and out of one bank account.</strong> Most rows appear automatically from payments. For everyday expenses — groceries, milk, stationery, office-boy wages — use <strong>Record Spend</strong>: just pick WHAT it was for (a category) and the amount; the accounting happens behind the scenes (categories are managed in Expenses → Categories). <strong>Record Transaction</strong> is the advanced form for everything else — deposits, interest, bank charges — where you choose the <strong>counter account</strong> (the "other side" that explains WHY money moved) yourself.</p>
         <p><strong>Example (petty cash):</strong> keep a "Petty Cash Box" account (type Petty Cash), top it up with an Inter-Bank Transfer of ₹10,000, then Record Spend: category <em>Milk &amp; Water</em>, ₹380, paid from Petty Cash Box — done. Month-end, the box's book balance should match the physical cash; the P&L shows groceries, stationery and wages in their own lines.</p>
         <p><strong>Monthly salaries:</strong> simplest way — Record Spend with a "Staff Salaries" category on payday (cash basis). The proper way — accrue month-end via a Recurring journal (<em>Dr Salary &amp; Wages / Cr Salary Payable</em>), then record the payday withdrawal here with counter account <em>Salary Payable</em>, so each month's P&L carries its own salary cost even when payday falls in the next month.</p>`,
    'banking:bank-transfers':
        `<p><strong>Move money between your own accounts</strong> (current → savings, bank → petty cash). A transfer is NOT income or expense — it's the same money changing pockets, so it posts as one account down, the other up, with zero effect on profit.</p>
         <p><strong>Example:</strong> sweep ₹75,000 from HDFC to ICICI at month-end. HDFC −75,000, ICICI +75,000, profit unchanged. If this ever showed up as income, your P&L would be lying to you.</p>`,
    'banking:statement-import':
        `<p><strong>Bulk-load your bank statement (CSV)</strong> instead of typing rows one by one. Map the columns, pick a counter account for the batch, and the system creates the transactions — skipping duplicates it has already seen.</p>
         <p><strong>Example:</strong> download June's statement from netbanking (42 rows), import with counter account "Suspense", then reclassify the few big ones properly. Ten minutes instead of an evening of data entry.</p>`,
    'banking:reconciliation':
        `<p><strong>Reconciliation = proving your books match the bank's statement.</strong> Enter the closing balance from the real statement, then tick off ("match") each book transaction that appears on it. When the ticked total equals the statement balance, you're reconciled — any leftover difference means something is missing or duplicated. Do this monthly; it's the single best habit for trustworthy accounts.</p>
         <p><strong>Example:</strong> statement says ₹5,20,000; your books say ₹5,28,000. Matching reveals a ₹8,000 customer cheque you recorded that never actually cleared. Now you know to chase the customer — without reconciliation you'd have "phantom money" for months.</p>`,

    // ── Reports ───────────────────────────────────────────────────────────
    'reports:trial-balance':
        `<p><strong>The accountant's health check.</strong> Every account with its debit or credit balance — and the two columns MUST be equal (that's double-entry doing its job). Use it to eyeball all balances in one place before deeper reports.</p>
         <p><strong>Example:</strong> Bank ₹5L and Receivables ₹3L sit in the debit column; Payables ₹2L, Capital ₹4L and Sales ₹2L in credit. Both columns total ₹8L — balanced. If Rent showed a <em>credit</em> balance, something was posted backwards; this is where you'd spot it.</p>`,
    'reports:profit-loss':
        `<p><strong>Did we make money?</strong> The P&L totals income and subtracts expenses over a period: <strong>Revenue − Expenses = Profit</strong>. Only <em>approved/posted</em> documents in the selected fiscal year count — drafts don't exist yet as far as accounting is concerned.</p>
         <p><strong>Example:</strong> FY 2026-27 so far: revenue ₹6,50,000, expenses ₹3,80,000 (rent 1.5L, salaries 1.2L, marketing 0.6L, other 0.5L) → <strong>profit ₹2,70,000</strong>. If a ₹1L invoice is still in Draft, it's NOT in these numbers — approve it and watch revenue jump.</p>`,
    'reports:balance-sheet':
        `<p><strong>What we own vs what we owe, frozen at one date.</strong> <strong>Assets</strong> (bank, receivables, equipment) on one side; <strong>Liabilities</strong> (loans, payables) + <strong>Equity</strong> (owner's stake incl. accumulated profit) on the other. The two sides always equal. P&L is a movie over a period; this is a photograph on a date.</p>
         <p><strong>Example:</strong> Assets: bank ₹5L + receivables ₹3L + laptops ₹2L = ₹10L. Liabilities: loan ₹4L + payables ₹1L = ₹5L. Equity = the remaining ₹5L — what the business is "worth" to you on paper today.</p>`,
    'reports:cash-flow':
        `<p><strong>Profit is an opinion, cash is a fact.</strong> A profitable business can still die if customers haven't paid yet. This tracks actual money moving — operations (trading), investing (assets), financing (loans/capital) — so you see whether real cash grew or shrank.</p>
         <p><strong>Example:</strong> P&L shows ₹2,70,000 profit, but customers owe you ₹3L and you bought ₹2L of laptops → cash actually FELL ₹30,000 this quarter. This report is where that painful truth shows up before the salary run bounces.</p>`,
    'reports:account-ledger':
        `<p><strong>One account's full story.</strong> Pick any account and see every entry that touched it with a <strong>running balance</strong> — like a bank passbook for that account. This is the drill-down when a report number looks wrong.</p>
         <p><strong>Example:</strong> P&L shows Rent at ₹3,50,000 but you expected ₹3,00,000 (₹50k × 6 months). Open the Rent ledger: seven entries — June was posted twice. Reverse the duplicate; mystery solved in two minutes.</p>`,
    'reports:day-book':
        `<p><strong>Everything that happened on a single day,</strong> across all journals. Auditors and accountants use it to review a day's activity end-to-end.</p>
         <p><strong>Example:</strong> for 20 Jul you see: 2 invoices approved (₹35,000), 1 receipt (₹50,000), 1 bank charge (₹590). Four movements, one screen — exactly what the auditor asks for when sampling "show me everything from that Tuesday".</p>`,
    'reports:cash-book':
        `<p><strong>The classic cashier's register:</strong> receipts on one side, payments on the other, for your cash and bank accounts. Small businesses often run entirely from this view.</p>
         <p><strong>Example:</strong> opening ₹4,00,000 → receipts ₹1,50,000, payments ₹90,000 → closing ₹4,60,000. If the physical till or bank shows anything else, today's the day to find out why, not at year-end.</p>`,
    'reports:ar-aging-report':
        `<p><strong>Snapshot of who owes YOU, by how old the debt is.</strong> Same idea as Receivables → AR Aging, but as a printable report for reviews and follow-up meetings.</p>
         <p><strong>Example:</strong> Monday review: print this, and every client in the 60+ column gets a call before lunch. Collections is a habit, and this report is its checklist.</p>`,
    'reports:ap-aging-report':
        `<p><strong>Snapshot of who YOU owe, by how old the bill is.</strong> Use it to prioritise payments and forecast the cash you'll need in coming weeks.</p>
         <p><strong>Example:</strong> next week ₹1,80,000 of bills cross 30 days. Your bank holds ₹2,10,000 — fine, but only if that ₹90,000 customer receipt actually lands. Now you know exactly which customer to nudge first.</p>`,

    // ── Taxation ──────────────────────────────────────────────────────────
    'taxation:tax-config':
        `<p><strong>The tax regimes your business operates under</strong> (e.g. GST for India). A configuration defines the tax type and its rules; rates hang off it. Seed India defaults once and rarely touch this again.</p>
         <p><strong>Example:</strong> the India seed creates GST (with CGST/SGST/IGST splitting), TDS and TCS configurations in one click — the plumbing every invoice and bill then uses automatically.</p>`,
    'taxation:tax-rates':
        `<p><strong>The actual percentages</strong> — GST 5/12/18/28%, TDS sections like 194C/194J. When you pick "GST 18%" on an invoice line, this is where that rate lives. Intra-state splits into CGST+SGST; inter-state becomes IGST — decided by your state vs the customer's.</p>
         <p><strong>Example:</strong> same ₹1,00,000 service at 18%: customer in your state → ₹9,000 CGST + ₹9,000 SGST; customer in Karnataka → ₹18,000 IGST; customer in Dubai → zero-rated export, ₹0. One rate, three outcomes, all automatic.</p>`,
    'taxation:hsn-sac':
        `<p><strong>HSN (goods) and SAC (services) are government classification codes</strong> that must appear on GST invoices. Store the ones you use with default rates so invoice lines auto-fill.</p>
         <p><strong>Example:</strong> software development services = SAC <strong>998314</strong> @ 18%; a laptop you resell = HSN <strong>8471</strong> @ 18%. Save both once — every future invoice line picks them from a dropdown instead of you googling codes at billing time.</p>`,
    'taxation:gstr-1':
        `<p><strong>GSTR-1 is the monthly return of your SALES.</strong> It lists the GST you charged customers (output tax), broken up by B2B/B2C and party — assembled straight from your approved invoices, ready for the GST portal.</p>
         <p><strong>Example:</strong> July: 4 B2B invoices to 2 registered clients totalling ₹4,00,000 + ₹72,000 GST. GSTR-1 groups them party-wise with GSTINs — your CA files it by the 11th of August without re-typing a single invoice.</p>`,
    'taxation:gstr-3b':
        `<p><strong>GSTR-3B is the monthly summary where you actually pay.</strong> Output tax (on sales) minus <strong>input credit</strong> (GST you paid on purchases) = net GST payable. Keep bills entered promptly — every missed purchase bill is input credit you're leaving on the table.</p>
         <p><strong>Example:</strong> July output tax ₹72,000, input credit from vendor bills ₹23,000 → you pay <strong>₹49,000</strong>, not ₹72,000. Forget to enter the ad agency's ₹53,100 bill and you overpay ₹8,100 — real money lost to lazy bookkeeping.</p>`,
    'taxation:tds-return':
        `<p><strong>TDS you deducted from vendor payments must be deposited and reported quarterly.</strong> This assembles deductee-wise totals (who, how much, which section) from your recorded payments — the raw material for Form 26Q.</p>
         <p><strong>Example:</strong> Q2 you deducted ₹5,000/month on rent (194-I) and ₹3,000 on a designer's fee (194-J). The return shows landlord ₹15,000 + designer ₹3,000 with PANs and sections — deposit by the 7ths, file by 31 Oct, and both parties see their credit in 26AS.</p>`,
    'taxation:tax-calculator':
        `<p><strong>A scratchpad:</strong> enter an amount and a rate to preview GST/TDS splits without creating any document. Nothing here posts to the books.</p>
         <p><strong>Example:</strong> client offers "₹1,50,000 all-inclusive". Calculator: base ₹1,27,119 + 18% GST ₹22,881 = ₹1,50,000. Now you know what you're really earning before saying yes.</p>`,
    'taxation:tax-ledger':
        `<p><strong>Every tax rupee, in one register.</strong> Each row is tax charged on a sale (output), tax paid on a purchase (input credit), or TDS/TCS captured. The gap between the red and green bars is roughly what you'll owe on GSTR-3B.</p>
         <p><strong>Example:</strong> May shows output ₹7,627 (red) vs input ₹2,250 (green) → expect to pay ≈ ₹5,377 for May. If the green bar ever towers over red for months, you're buying far more than selling — the tax ledger notices before you do.</p>`,

    // ── Setup / COA ───────────────────────────────────────────────────────
    'setup:account-types':
        `<p><strong>The five families every account belongs to:</strong> <strong>Assets</strong> (what you own), <strong>Liabilities</strong> (what you owe), <strong>Equity</strong> (the owner's stake), <strong>Income</strong>, and <strong>Expenses</strong>. Fixed by design — the P&L and Balance Sheet are built by classifying accounts into exactly these five.</p>
         <p><strong>Example:</strong> Bank = Asset, unpaid vendor bill = Liability, your initial ₹5L investment = Equity, invoice to a client = Income, rent = Expense. Every transaction you'll ever record is just these five shaking hands.</p>`,
    'setup:account-groups':
        `<p><strong>Groups organise accounts within a type</strong> — e.g. "Current Assets" and "Fixed Assets" inside Assets. They exist purely to make reports readable; money never posts to a group itself.</p>
         <p><strong>Example:</strong> the Balance Sheet shows "Current Assets ₹8L" as a subtotal of Bank + Receivables + Cash — that rollup line IS the group doing its job.</p>`,
    'setup:accounts':
        `<p><strong>The Chart of Accounts (COA) is your filing system for money.</strong> Every rupee lands in exactly one account. Create accounts sparingly: too many makes reports noisy, too few hides detail. Codes group naturally (all 5xxx = expenses).</p>
         <p><strong>Example:</strong> you start running Google ads. Don't dump it in "Misc Expenses" — create <em>5530 Digital Ads</em> under Marketing. Six months later the P&L can answer "what do we spend on ads?" in one line. That's the whole game.</p>`,
    'setup:account-tree':
        `<p><strong>The same chart of accounts, as a hierarchy.</strong> Parent accounts let reports show subtotals at each level. Posting happens only at leaf accounts.</p>
         <p><strong>Example:</strong> 5000 Expenses → 5500 Marketing → 5510 Advertising + 5530 Digital Ads. The P&L can show "Marketing ₹90,000" (parent subtotal) or drill into the two leaves — same data, two zoom levels.</p>`,
    'setup:opening-balances':
        `<p><strong>Where your OLD books hand over to this system.</strong> If you switch software mid-life, enter each account's balance as of your start date — otherwise the books start from zero and won't match reality. Debits must equal credits, like everything else.</p>
         <p><strong>Example:</strong> switching on 1 Apr: Bank ₹3,20,000 (Dr), customers owe ₹1,80,000 (Dr), you owe vendors ₹80,000 (Cr), the rest ₹4,20,000 is Equity (Cr). Enter those four lines and day one starts from truth, not zero.</p>`,
    'setup:fiscal-years':
        `<p><strong>The 12-month cycle your books are measured in.</strong> In India that's April–March (FY 2026-27 = Apr 2026 to Mar 2027). Reports like P&L are always "within a fiscal year"; at year-end you close the year to lock it.</p>
         <p><strong>Example:</strong> an expense dated 20 Mar 2026 belongs to FY 2025-26; the same expense on 5 Apr 2026 belongs to FY 2026-27. Two weeks apart, different P&Ls, different tax years — the fiscal year decides.</p>`,
    'setup:fiscal-periods':
        `<p><strong>Each fiscal year splits into monthly periods.</strong> Locking a period stops anyone posting into it — do this after you've reconciled and reported a month so history can't quietly change under you.</p>
         <p><strong>Example:</strong> you reported June's profit as ₹1,10,000 to your partner. Lock June — now nobody can slip a backdated ₹40,000 bill into it and make last month's report retroactively wrong.</p>`,
    'setup:journal-types':
        `<p><strong>The "books" entries get filed into</strong> — Sales, Purchase, Bank, Adjustment. Documents pick their journal automatically; you'd only add custom journals for special workflows.</p>
         <p><strong>Example:</strong> a payroll-heavy business might add a "Payroll Journal" so salary entries don't drown the Adjustment journal — pure organisation, zero effect on the numbers.</p>`,
    'setup:templates':
        `<p><strong>One-click chart of accounts for your country.</strong> The India template creates a sensible GST-ready structure so you don't start from a blank page. Apply once on a fresh tenant.</p>
         <p><strong>Example:</strong> one click creates ~80 accounts: 1110 Bank, 4110 Product Sales, 5310 Rent, GST input/output accounts, TDS accounts… the skeleton a CA would take an afternoon to build by hand.</p>`,

    // ── Recurring ─────────────────────────────────────────────────────────
    'recurring:recurring-list':
        `<p><strong>Set-and-forget for repeating transactions.</strong> Rent every month, a SaaS invoice to a client, a quarterly insurance journal — define the template once and the system generates the real document on schedule. "Monthly-equivalent" in the charts normalises frequencies so different cycles compare fairly.</p>
         <p><strong>Example:</strong> "Office Rent — ₹50,000 — monthly — starts 1 Aug." On 1 Aug (and every month after) a real vendor bill appears by itself, posted to 5310 Rent. You stop being the person who remembers rent; the system is.</p>
         <p><strong>Salaries without a payroll module:</strong> create a monthly <em>Journal</em> rule "Salary Accrual" — <em>Dr Salary &amp; Wages (gross) / Cr Salary Payable (net, + a TDS Payable line if you withhold tax)</em>. Every month-end the expense books itself into the right month; on payday just record a bank withdrawal against <em>Salary Payable</em> in Banking. Correct accrual accounting with zero monthly effort.</p>`,

    // ── Loans ─────────────────────────────────────────────────────────────
    'loans:loan-list':
        `<p><strong>Track borrowed money properly.</strong> A loan is NOT income — it's cash in hand plus an equal liability. Each EMI splits into <strong>principal</strong> (reduces the liability) and <strong>interest</strong> (an expense). The schedule does that split with reducing-balance math, so your P&L only shows the true cost.</p>
         <p><strong>Example:</strong> ₹8,00,000 vehicle loan @ 9.5% for 48 months → EMI ≈ ₹20,099. In month 1 that's ≈ ₹6,333 interest + ₹13,766 principal; by month 40 it's mostly principal. Only the interest ever touches your P&L — the ₹8L itself was never income, so repaying it is never an expense.</p>`,

    // ── Billing (SaaS) ────────────────────────────────────────────────────
    'billing:billing-plans':
        `<p><strong>Your price list for recurring customer billing</strong>. Plans don't post anything by themselves; they're templates that subscriptions bill from.</p>
         <p><strong>Example:</strong> Starter ₹5,000/month, Professional ₹15,000/month, Enterprise ₹45,000/year. Change the Pro price once here, and every Pro subscriber's next invoice picks it up.</p>`,
    'billing:subscriptions':
        `<p><strong>A subscription attaches a customer to a plan</strong> and generates their invoice each cycle. The value charts show your recurring revenue base at plan prices — the closest thing to MRR in these books.</p>
         <p><strong>Example:</strong> Acme on Professional from 1 May → invoices of ₹15,000 auto-generate on 1 May, 1 Jun, 1 Jul… Cancel in August and generation simply stops; history stays.</p>`,
    'billing:usage-meters':
        `<p><strong>For usage-based pricing:</strong> define a meter with a rate per unit, record usage against customers, and billing turns consumption into invoice lines.</p>
         <p><strong>Example:</strong> meter "API Calls" @ ₹0.50/call. Acme makes 12,000 calls in July → the billing run adds ₹6,000 to their invoice. Metered revenue with zero spreadsheet math.</p>`,
    'billing:tokens':
        `<p><strong>Prepaid credits:</strong> customers buy tokens up front and burn them with usage. Purchases add to the balance; consumption draws it down.</p>
         <p><strong>Example:</strong> Acme buys ₹10,000 of tokens. Each report they generate burns 50 tokens; at zero they top up again. You got the cash up front — they get pay-as-you-go.</p>`,

    // ── Admin ─────────────────────────────────────────────────────────────
    'admin:tenant-settings':
        `<p><strong>Business-wide accounting defaults.</strong> The <strong>GST home state</strong> matters most — it decides whether a sale is intra-state (CGST+SGST) or inter-state (IGST). Set it before approving any GST document.</p>
         <p><strong>Example:</strong> home state = Uttar Pradesh. Invoice a Noida client → CGST+SGST. Invoice a Mumbai client → IGST. Set the wrong home state and every single invoice splits tax incorrectly.</p>`,
    'admin:custom-fields':
        `<p><strong>Add your own fields to documents</strong> (text, number, date, dropdown) — they appear in forms and are stored with each document.</p>
         <p><strong>Example:</strong> add "Client PO Number" (text) to invoices because your big customer refuses to pay any invoice that doesn't quote their PO. Now the field is right in the invoice form, impossible to forget.</p>`,
    'admin:audit-logs':
        `<p><strong>Who did what, when.</strong> Every create/approve/cancel across the module is recorded permanently. Your defence in an audit and your first stop when something looks tampered with.</p>
         <p><strong>Example:</strong> a ₹50,000 invoice was cancelled last Tuesday and nobody admits it. The log shows: <em>cancelled by priya@…, 14:32, 22 Jul</em>. Conversation over.</p>`,
    'admin:pending-approvals':
        `<p><strong>Money-sensitive actions that need a second pair of eyes</strong> queue here for an admin's approve/reject. Separation of duties: the requester shouldn't be the approver.</p>
         <p><strong>Example:</strong> an accountant voids a posted ₹1,00,000 payment. It doesn't just happen — it waits here until you (the admin) review and approve. Fraud needs two people now, not one.</p>`,
    'admin:integrity-check':
        `<p><strong>An automated auditor.</strong> Re-verifies the books' invariants — debits equal credits, balances match ledgers, documents tie to their GL entries — and reports anything off. Run after bulk imports or when a report looks impossible.</p>
         <p><strong>Example:</strong> after importing 400 statement rows, run a check. "All 12 checks passed" = sleep well. One failure = it points at the exact entry to inspect, instead of you bisecting the whole month.</p>`,
    'admin:job-log':
        `<p><strong>The run history of background jobs</strong> — recurring generation, billing runs, reminders. If something that should have happened automatically didn't, check here first.</p>
         <p><strong>Example:</strong> it's 2 Aug and the rent bill didn't auto-generate. The log shows the 1 Aug recurring run failed at 00:05 with an error — now you know it's a system issue, not a forgotten rule.</p>`,
    'admin:closing-checklists':
        `<p><strong>Month-end closing, as a checklist.</strong> Reconcile banks → review aging → lock the period. Working the list monthly keeps books consistently trustworthy instead of "we'll fix it at year-end".</p>
         <p><strong>Example:</strong> July's checklist: ✓ HDFC reconciled, ✓ ICICI reconciled, ✓ AR aging reviewed, ✓ GSTR-3B filed, ✓ period locked. Five ticks, and July can never surprise you again.</p>`,
    'admin:year-end':
        `<p><strong>Closing a fiscal year</strong> zeroes income and expense accounts into retained earnings (Equity) and locks the old year. Do it only after the final P&L is reviewed — it's meant to be permanent.</p>
         <p><strong>Example:</strong> FY 2025-26 ends with ₹4,20,000 profit. Closing moves it into <em>Retained Earnings</em>, income/expense accounts restart at zero for FY 2026-27, and the Balance Sheet's Equity grows ₹4,20,000 — the year's work, banked into net worth.</p>`,
    'admin:danger-zone':
        `<p><strong>Destructive tools for superadmins only.</strong> Wiping tenant data is irreversible — it exists for test environments, not for "cleaning up" a live business.</p>
         <p><strong>Example:</strong> you seeded a demo tenant with junk data for training. Wipe THAT. Never wipe a tenant with even one real invoice — there is no undo, and the taxman doesn't accept "we deleted it".</p>`,

    // ── Projects ──────────────────────────────────────────────────────────
    'projects:pr-list':
        `<p><strong>Projects are analytical tags (per customer) for tracking billing per engagement.</strong> They don't affect the ledger — tag customer-invoice lines with a project, and the statement shows billed / collected / due per engagement. Set a budget to compare against billing.</p>
         <p><strong>Example:</strong> Acme has two engagements: "Mobile App" (budget ₹5L) and "Website Revamp" (₹2L). Tag each invoice line to its project, and next month you can answer "how much of the app budget have we billed?" without opening a spreadsheet.</p>`,
    'projects:pr-stmt':
        `<p><strong>Per-project money view for one customer:</strong> how much you've <strong>billed</strong>, how much they've actually <strong>paid (collected)</strong>, and what's still <strong>due</strong>. Click a project row to expand the exact invoice lines behind the numbers.</p>
         <p><strong>Example:</strong> Mobile App shows billed ₹3,70,000 / collected ₹2,10,000 / due ₹1,60,000. Before starting milestone 4, that ₹1,60,000 due is your negotiating position: "we'd love to continue — right after the outstanding clears".</p>`,

    // ── Budgets ───────────────────────────────────────────────────────────
    'budgets:budget-list':
        `<p><strong>A budget is your plan per account for the fiscal year.</strong> On its own it posts nothing; its power shows up in Budget vs Actual.</p>
         <p><strong>Example:</strong> plan FY 2026-27 as: Rent ₹6,00,000, Advertising ₹3,00,000, and a Product Sales <em>target</em> of ₹30,00,000. Now every month has something to be measured against.</p>`,
    'budgets:budget-analysis':
        `<p><strong>Plan vs reality.</strong> For each budgeted account: planned, actually posted, and the <strong>variance</strong>. Read the colours by <em>favourability</em>, not direction — an expense UNDER budget is good (green), but income UNDER budget is bad (red).</p>
         <p><strong>Example:</strong> Rent: budget ₹6L, actual ₹1.5L so far → green (underspent, fine). Product Sales: target ₹30L, actual ₹8L by mid-year → red, even though "under" — for income, under-plan is the bad direction. Same arithmetic, opposite meaning.</p>`,

    // ── Parties ───────────────────────────────────────────────────────────
    'parties:vendor-list':
        `<p><strong>Your supplier master.</strong> GST treatment and state decide how tax applies on their bills (registered vendors give you input credit; unregistered don't). Keep GSTINs accurate — they flow onto documents and returns.</p>
         <p><strong>Example:</strong> two ad agencies quote ₹50,000. The GST-registered one effectively costs ₹50,000 (you reclaim the ₹9,000 GST as input credit); the unregistered one's ₹50,000 is final. Registration status literally changes the price.</p>`,
    'parties:customer-list':
        `<p><strong>Your customer master.</strong> State + GST registration drive invoice tax (intra vs inter-state, or zero-rated for overseas). A customer's full money story lives in Receivables; this is just who they are.</p>
         <p><strong>Example:</strong> add "Northwind Software (USA)" with treatment <em>Overseas</em> → every invoice to them is automatically zero-rated export, no GST. Add a Bengaluru client → IGST. Set it right once, never think about it again.</p>`,
    'parties:pending-vendors':
        `<p><strong>Vendor records requested by other modules</strong> (e.g. Procurement) wait here for an accounts admin to approve before joining the master — keeping one clean, deduplicated list.</p>
         <p><strong>Example:</strong> Procurement raises "ABC Traders" for a new PO. You spot it's the same as existing "A.B.C. Traders" and reject the duplicate — one vendor, one payment history, no split records.</p>`,
    'parties:pending-customers':
        `<p><strong>Customer records requested by other modules</strong> (e.g. CRM converting a won deal) wait here for approval before entering the customer master.</p>
         <p><strong>Example:</strong> CRM closes a deal with "Zenith Corp" and requests the customer record. You verify the GSTIN and state, approve — and billing can start on a correctly-taxed foundation.</p>`,

    // ── Proforma ──────────────────────────────────────────────────────────
    'proforma-invoices:proforma-list':
        `<p><strong>A proforma is a quotation dressed as an invoice</strong> — it shows exactly what the customer would pay (with GST) but posts NOTHING to the books and creates no tax liability. On acceptance, one click converts it to a real invoice. You can even quote a prospect who isn't a customer yet.</p>
         <p><strong>Example:</strong> a prospect asks "what would the CRM cost us?" Send a proforma: ₹2,00,000 + ₹36,000 GST. No revenue recorded, no GSTR entry, nothing owed. They accept → Convert → NOW it's a real invoice, and only now does the customer record get created.</p>`,

    // ── Purchase Orders ───────────────────────────────────────────────────
    'purchase-orders:po-list':
        `<p><strong>A PO is a promise to buy, not a purchase.</strong> It documents what you agreed with a vendor before any money or goods move — nothing posts to the ledger yet. When goods arrive, convert the PO to a <strong>bill</strong>; that's when the expense and payable become real.</p>
         <p><strong>Example:</strong> you order 6 workstations at ₹30,000 each — PO for ₹1,80,000. Books unchanged. Vendor delivers 5 (one is backordered) → convert to a bill for ₹1,50,000. The PO remembers the deal; the bill records the reality.</p>`,

    // ── Expenses ──────────────────────────────────────────────────────────
    'expenses:expense-categories':
        `<p><strong>Friendly names employees pick from</strong> — each mapped to a real GL expense account behind the scenes. Employees never need to know account codes; the mapping does the accounting.</p>
         <p><strong>Example:</strong> employee picks "Pantry &amp; Groceries" on a claim; the system posts to <em>5240 Staff Welfare</em>. They speak human, the ledger speaks accounting, everyone's happy.</p>`,
    'expenses:expense-policies':
        `<p><strong>Guardrails for claims:</strong> per-category limits and receipt thresholds. Claims that breach a policy get flagged before approval.</p>
         <p><strong>Example:</strong> policy "Travel: max ₹10,000 per claim, receipt required above ₹500". A ₹12,000 claim or a receipt-less ₹800 cab gets flagged for the approver automatically — the policy argues so you don't have to.</p>`,
    'expenses:expense-claims':
        `<p><strong>Employees spend their own money, then claim it back.</strong> A claim is itemised against categories, then <strong>approved by someone else</strong> (you can't approve your own — that separation prevents fraud), which posts the expense and creates the reimbursement.</p>
         <p><strong>Example:</strong> Ravi visits a client: cab ₹1,200 + lunch ₹800 + prints ₹350 = ₹2,350 claim with receipts. His manager approves → the expenses post to their accounts and Ravi's ₹2,350 reimbursement is queued. Ravi could NOT have approved it himself.</p>`,

    // ── Cost Centres ──────────────────────────────────────────────────────
    'cost-centres:cc-list':
        `<p><strong>Cost centres answer "WHICH PART of the business spent this?"</strong> — departments, branches, teams. They're tags on bill lines, not accounts: the expense still posts to Rent or Marketing; the cost centre adds the "who".</p>
         <p><strong>Example:</strong> electricity bill ₹30,000 → the expense account says WHAT (Utilities); the tag says WHO (Factory ₹22,000, Office ₹8,000). Same ledger, one extra dimension of truth.</p>`,
    'cost-centres:cc-spend':
        `<p><strong>Spend per department for a period,</strong> built from cost-centre-tagged bill lines. "Unassigned" is spending nobody tagged — a big Unassigned bar means the team skips tags when entering bills.</p>
         <p><strong>Example:</strong> Q2: Operations ₹1,62,500, Marketing ₹53,100, Engineering ₹44,840 — and Unassigned ₹6,57,500. That Unassigned bar isn't a department; it's a discipline problem. Chase the tagging, not the spending.</p>`,

    // ── Assets ────────────────────────────────────────────────────────────
    'assets:asset-categories':
        `<p><strong>Categories define HOW things depreciate:</strong> method, useful life, and which GL accounts to hit. Every registered asset inherits its category's rules.</p>
         <p><strong>Example:</strong> "Computers — straight line, 3 years" vs "Furniture — straight line, 5 years". A ₹90,000 laptop loses ≈ ₹30,000/year; a ₹90,000 conference table loses ≈ ₹18,000/year. Same price, different lifespans, different maths — set once per category.</p>`,
    'assets:asset-register':
        `<p><strong>Buying equipment isn't an expense — it's swapping cash for a thing you own (an asset).</strong> The cost enters the books gradually via <strong>depreciation</strong>. <strong>Book value = cost − depreciation so far</strong>: the "cost vs book value" gap in the chart is how much value has been consumed to date.</p>
         <p><strong>Example:</strong> MacBook bought Apr 2025 for ₹2,85,000 (salvage ₹20,000, 3-year life) → depreciates ≈ ₹88,333/year. By mid-2026 its book value is ≈ ₹1,75,000. Your P&L absorbed the laptop over its working life instead of one brutal month.</p>`,
    'assets:depreciation':
        `<p><strong>Running depreciation posts the period's wear-and-tear:</strong> Dr Depreciation Expense / Cr Accumulated Depreciation for every eligible asset up to your chosen date. Run monthly or at year-end — once posted, reverse only via correcting journal entries.</p>
         <p><strong>Example:</strong> run up to 30 Jun for all 5 assets → one click posts ≈ ₹96,000 of depreciation across them. P&L now carries the true cost of using your equipment; the Balance Sheet shows assets at their honest remaining value.</p>`,
};
