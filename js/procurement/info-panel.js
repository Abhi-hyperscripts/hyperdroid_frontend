/*
 * Reusable "What is this?" info panel for Procurement pages and modals.
 * Renders a collapsed <details> block with brand-themed styling and an
 * info icon, so non-technical users can expand it on demand without
 * cluttering the UI for power users.
 *
 * Usage:
 *   // page-level: drop the HTML right under your H1 / breadcrumb
 *   document.getElementById('pageInfoSlot').innerHTML = infoPanel(
 *     'page-vendors',
 *     'Vendors',
 *     `<p>Vendors are the suppliers you buy from...</p>`
 *   );
 *
 *   // modal-level: include in the .modal-body markup
 *   container.innerHTML = infoPanel('modal-create-rfq', 'Create RFQ',
 *     `<p>An RFQ asks vendors to quote prices...</p>`) + '<form>...</form>';
 */
(function () {
    if (typeof window === 'undefined') return;
    if (window.infoPanel) return; // idempotent

    function infoPanel(id, title, bodyHtml, opts = {}) {
        const safeId = (id || 'info').replace(/[^a-z0-9_-]/gi, '-');
        const open = opts.open ? 'open' : '';
        const icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" style="opacity:0.7;flex-shrink:0;">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>`;
        return `<details id="info-${safeId}" ${open} style="
            margin-bottom:14px;
            border:1px solid var(--border-primary);
            border-radius:6px;
            background:var(--bg-tertiary);
            box-shadow:0 1px 2px rgba(0,0,0,0.08);
        ">
            <summary style="
                cursor:pointer;padding:8px 12px;font-size:12px;font-weight:600;
                color:var(--text-primary);user-select:none;
                display:flex;align-items:center;gap:6px;list-style:none;
            ">
                ${icon}
                What is this? &mdash;
                <span style="font-weight:500;opacity:0.85;">${title}</span>
            </summary>
            <div style="
                padding:0 14px 12px 32px;
                font-size:12px;line-height:1.55;
                color:var(--text-secondary);
            ">${bodyHtml}</div>
        </details>`;
    }

    // Mount a page-level info panel automatically.
    // Looks for a <div id="pageInfoSlot"> on DOMContentLoaded; if found,
    // injects the panel registered for the current page.
    const PAGE_INFO = {
        'vendors.html': {
            id: 'page-vendors',
            title: 'Vendors',
            body: `
                <p><strong>Vendors</strong> are your suppliers — the companies you buy goods or services from.</p>
                <p>Vendor master records are owned by <strong>Accounts</strong> (single source of truth). When you click <strong>+ Add Vendor</strong> here, Procurement actually <em>requests</em> Accounts to create the vendor; it appears as <em>Pending</em> until Finance approves. Approved vendors then become available for RFQs and POs.</p>
                <p>Use the <strong>stat cards</strong> at the top to filter by status (Total / Approved / Pending / Rejected). Click an existing vendor to see its <strong>Intelligence</strong> (quote history, win rate, average price), <strong>Manage Items</strong> (which items they supply), or copy a <strong>Catalog Link</strong> to send the vendor for self-service catalog upload.</p>
                <p><em>Tip:</em> You cannot edit or delete a vendor from Procurement — those actions live in Accounts to keep AR/AP records consistent.</p>
            `
        },
        'items.html': {
            id: 'page-items',
            title: 'Master Items',
            body: `
                <p><strong>Master Items</strong> are your standardized catalog of <em>what you buy</em> — every product, material, or service that can appear on an inquiry, RFQ, quote, or PO.</p>
                <p>Group similar items into <strong>Categories</strong> (e.g. "Hotel Linen", "Kitchen Equipment") for filtering and reporting.</p>
                <p>Click <strong>Details</strong> on any row to manage:</p>
                <ul style="margin:6px 0 6px 18px;padding:0;">
                    <li><strong>Linked Vendors</strong> — who supplies this item</li>
                    <li><strong>Synonyms</strong> — alternative clean names ("Bath Towel 600gm" = "Bath Towel 600GSM")</li>
                    <li><strong>Mappings</strong> — messy raw strings from vendor bills/scans that should resolve to this item</li>
                </ul>
                <p><em>Tip:</em> Building a clean master items list early pays off later — every quote, comparison, and PO becomes faster and more accurate.</p>
            `
        },
        'inquiries.html': {
            id: 'page-inquiries',
            title: 'Inquiries',
            body: `
                <p>An <strong>Inquiry</strong> is the starting point of every procurement cycle — an internal request that says "we need to buy X for Project Y by date Z".</p>
                <p>Inquiries do <em>not</em> go to vendors directly. They capture the requirement; once approved, you create one or more <strong>RFQs</strong> from the inquiry to actually ask vendors for prices.</p>
                <p>Set <strong>Priority</strong> and a <strong>Due Date</strong> so the procurement team knows when this needs to be fulfilled. Add line items (the actual goods/services needed) by opening the inquiry after creation.</p>
                <p><em>Tip:</em> One inquiry can spawn multiple RFQs (e.g., split between vendor categories). Use the <strong>status</strong> filter to track open vs. fulfilled inquiries.</p>
            `
        },
        'rfqs.html': {
            id: 'page-rfqs',
            title: 'Requests for Quotation (RFQs)',
            body: `
                <p>An <strong>RFQ (Request for Quotation)</strong> takes an inquiry's items and sends them to one or more vendors asking <em>"how much will you charge?"</em>.</p>
                <p>Each vendor on the RFQ gets a unique <strong>secure portal link</strong> by email — no login needed. They click the link, see the items requested, and fill in their unit prices, delivery time, and terms.</p>
                <p>RFQ statuses: <strong>Draft</strong> (still being built) → <strong>Sent</strong> (vendors notified) → <strong>Partially / Fully Quoted</strong> → <strong>Closed</strong> (after PO is awarded).</p>
                <p><strong>Important:</strong> the <em>Compare Quotes</em> button only appears <strong>after you click <em>Send RFQ</em></strong> — that's what flips the RFQ from Draft to Sent and unlocks the comparison + award flow. Even if vendors have already submitted via their portal link, you still need to formally Send before you can compare and award.</p>
                <p><em>Tip:</em> Always send an RFQ to at least 3 vendors so the <strong>Comparison</strong> view gives you negotiation leverage. Set a clear <strong>Quote Deadline</strong> so vendors know when to respond.</p>
            `
        },
        'quotes.html': {
            id: 'page-quotes',
            title: 'Quotes',
            body: `
                <p><strong>Quotes</strong> are vendor responses to your RFQs — their prices, delivery times, and payment terms.</p>
                <p>Each quote belongs to one RFQ + one vendor. The system tracks who quoted, who didn't, and at what price — so the <strong>Vendor Intelligence</strong> page can rank suppliers over time.</p>
                <p>You don't usually create quotes from this page — they arrive automatically when a vendor submits via the portal link. Use this page to <strong>review</strong> quotes individually, or jump to <strong>Comparison</strong> to see all quotes for an RFQ side-by-side.</p>
                <p><em>Tip:</em> A quote that looks too cheap often means missing line items — open it before awarding to verify.</p>
            `
        },
        'comparisons.html': {
            id: 'page-comparison',
            title: 'Quote Comparison',
            body: `
                <p>The <strong>Comparison</strong> view lays out all vendor quotes for one RFQ in a side-by-side table — vendor names across the columns, line items down the rows. The cheapest cell per row is highlighted automatically.</p>
                <p>You can <strong>award the whole bundle</strong> to one vendor, or <strong>cherry-pick winners per item</strong> (split award) — the system will create separate POs as needed.</p>
                <p><strong>Two-stage commit pattern (important):</strong></p>
                <ul style="margin:6px 0 6px 18px;padding:0;">
                    <li><strong>Approve &amp; Generate Purchase Order</strong> here creates a <strong>Draft PO</strong> in both Procurement and Accounts. <em>Nothing hits your General Ledger yet</em> — it's a planning document you can still walk away from.</li>
                    <li>The PO only becomes a real financial commitment when you click <strong>Approve</strong> on the PO detail page. That's when Accounts posts the journal entry (DR expense, CR Accounts Payable) and the vendor liability appears on your balance sheet.</li>
                </ul>
                <p><em>Tip:</em> Look beyond price — delivery time and payment terms matter too. The comparison shows all three so you can make a real-world choice.</p>
            `
        },
        'purchase-orders.html': {
            id: 'page-pos',
            title: 'Purchase Orders (POs)',
            body: `
                <p>A <strong>Purchase Order (PO)</strong> is the formal commitment to buy — the legal document that locks in price, quantity, and delivery terms with a vendor.</p>
                <p>POs are usually created from a <strong>Quote Comparison</strong> after you award a winner. Once created, the PO is <strong>mirrored to Accounts</strong> via gRPC, but at this point it is just a planning document — your books are not yet affected.</p>
                <p><strong>Only TWO lifecycle steps actually touch Accounts.</strong> Everything else is pure procurement workflow:</p>
                <p>The accounting model uses the standard <strong>three-way-match (GR/IR)</strong> pattern — same flow as SAP and Oracle. There's a special suspense account called <strong>Goods Received Not Invoiced (GR/IR, code 2125)</strong> that holds the PO commitment until the vendor's actual invoice arrives. The pair clears to zero, so vendor liability lands on AP exactly once.</p>
                <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:11.5px;">
                    <thead>
                        <tr style="background:rgba(255,255,255,0.04);">
                            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-primary);">Status</th>
                            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-primary);">Hits Accounts?</th>
                            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-primary);">Effect on your books</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td style="padding:5px 8px;">Draft</td><td style="padding:5px 8px;opacity:0.7;">No</td><td style="padding:5px 8px;">PO mirrored to Accounts but NOT posted. Zero GL impact — pure planning document.</td></tr>
                        <tr><td style="padding:5px 8px;"><strong>Approved</strong></td><td style="padding:5px 8px;color:var(--color-success);"><strong>YES (commitment)</strong></td><td style="padding:5px 8px;"><em>Commitment leg.</em> Accounts posts: <strong>DR expense, CR GR/IR</strong>. Spend recognised; liability sits in suspense until the vendor invoice arrives. AP is NOT affected yet.</td></tr>
                        <tr><td style="padding:5px 8px;">Sent to Vendor</td><td style="padding:5px 8px;opacity:0.7;">No</td><td style="padding:5px 8px;">Vendor notified to ship. Pure operational signal — no Accounts call.</td></tr>
                        <tr><td style="padding:5px 8px;">Acknowledged</td><td style="padding:5px 8px;opacity:0.7;">No</td><td style="padding:5px 8px;">Vendor confirmed receipt of PO. Pure operational signal — no Accounts call.</td></tr>
                        <tr><td style="padding:5px 8px;"><strong>Received</strong></td><td style="padding:5px 8px;color:var(--color-success);"><strong>YES (creates bill)</strong></td><td style="padding:5px 8px;">Triggers <strong>Vendor Bill creation</strong> in Accounts (status: Draft). Bill carries the link back to the PO. No GL impact yet — that comes when the bill is approved.</td></tr>
                        <tr><td style="padding:5px 8px;">— then bill Approved —</td><td style="padding:5px 8px;color:var(--color-success);"><strong>YES (invoice leg)</strong></td><td style="padding:5px 8px;"><em>Invoice leg.</em> Accounts posts: <strong>DR GR/IR, CR Accounts Payable</strong>. GR/IR clears to zero; AP credited exactly once. AP can now process payment.</td></tr>
                        <tr><td style="padding:5px 8px;">Closed</td><td style="padding:5px 8px;opacity:0.7;">No</td><td style="padding:5px 8px;">Archives the PO after the bill is matched (3-way: PO ↔ GRN ↔ Bill) and paid.</td></tr>
                    </tbody>
                </table>
                <p><strong>Net effect across the full lifecycle:</strong> <code>DR Expense, CR Accounts Payable</code> — exactly what double-entry accounting requires. The GR/IR account is a temporary holding ground that always clears to zero on the matched pair, preventing the double-counting that would happen if both PO-approve and Bill-approve credited AP directly.</p>
                <p><em>Tip:</em> Watch the GR/IR balance — anything sitting in 2125 for more than a few days means goods were received but the vendor invoice hasn't been processed yet. Old GR/IR balances are an audit red flag.</p>
            `
        },
        'settings.html': {
            id: 'page-settings',
            title: 'Procurement Settings',
            body: `
                <p>Configure tenant-level Procurement options here: workflows, approval thresholds, vendor portal branding, and integrations.</p>
                <p>The <strong>Danger Zone</strong> tab (visible only to SUPERADMIN) contains destructive operations like <em>Wipe All Procurement Data</em>. Use only after taking a backup — there is no undo.</p>
                <p><em>Tip:</em> Vendor portal links inherit the tenant logo + colour set under the <strong>Branding</strong> tab — set this before you send any RFQs so vendors see your brand.</p>
            `
        },
        'inquiry-detail.html': {
            id: 'page-inquiry-detail',
            title: 'Inquiry Detail',
            body: `
                <p>This page shows everything about one inquiry — its line items, the RFQs you've spawned from it, and the resulting quotes/POs.</p>
                <p>Add line items here (each with item, quantity, target price). When you're ready, click <strong>Create RFQ</strong> to send the items to vendors.</p>
                <p><em>Tip:</em> An inquiry stays open until all its line items are covered by approved POs.</p>
            `
        },
        'dashboard.html': {
            id: 'page-dashboard',
            title: 'Procurement Dashboard',
            body: `
                <p>The dashboard summarises all live Procurement activity in one view — open inquiries, pending RFQs, quotes awaiting decision, POs by status, and recent activity.</p>
                <p>Click any tile or chart to drill down to the underlying records. The activity feed on the right shows who did what across the procurement team in the last 24 hours.</p>
                <p><em>Tip:</em> Check the <strong>"Quotes awaiting comparison"</strong> tile daily — sitting on quotes too long can lose vendor goodwill.</p>
            `
        }
    };

    function getCurrentPageKey() {
        const path = window.location.pathname;
        const m = path.match(/([^/]+\.html)$/);
        return m ? m[1] : null;
    }

    function mountPageInfo() {
        const key = getCurrentPageKey();
        const cfg = key && PAGE_INFO[key];
        if (!cfg) return;
        // Some pages (e.g. purchase-orders.html) have multiple .crm-header
        // blocks — one inside #listView, one inside #detailView — and only
        // one is visible at a time. Inject a panel after EVERY crm-header so
        // it persists across hash-route changes (#detail/{id}).
        const headers = document.querySelectorAll('.crm-header');
        if (headers.length === 0) return;
        headers.forEach((header, idx) => {
            // Skip if already injected after this header (idempotent across re-renders)
            if (header.nextElementSibling && header.nextElementSibling.dataset && header.nextElementSibling.dataset.pageInfoSlot === '1') {
                return;
            }
            const slot = document.createElement('div');
            slot.dataset.pageInfoSlot = '1';
            // Keep the legacy id on the first slot for any external code that targets it.
            if (idx === 0 && !document.getElementById('pageInfoSlot')) {
                slot.id = 'pageInfoSlot';
            }
            slot.style.padding = '0 24px';
            slot.style.marginTop = '8px';
            slot.innerHTML = infoPanel(cfg.id + (idx > 0 ? '-' + idx : ''), cfg.title, cfg.body);
            header.insertAdjacentElement('afterend', slot);
        });
    }

    // ===========================================================
    // Modal-level info panels — registry of modal IDs → explainer
    // ===========================================================
    const MODAL_INFO = {
        // Vendors
        'vendorModal': {
            title: 'Add Vendor',
            body: `
                <p>Submitting this form sends a <strong>request</strong> to Accounts to create the vendor — it does not create the vendor directly. Until Finance approves, the vendor shows as <strong>Pending</strong> and can't be used on RFQs/POs.</p>
                <p><strong>Required:</strong> Vendor Name. Everything else is optional but recommended — especially GST/PAN, payment terms, and contact email (vendors get RFQ portal links by email).</p>
                <p><em>Tip:</em> Add the GST number now to skip an extra approval step in Accounts.</p>
            `
        },
        'vendorIntelModal': {
            title: 'Vendor Intelligence',
            body: `
                <p>Tracks this vendor's performance over time: how often they quote, how often they win, average price rank vs competitors, and quality/delivery scores.</p>
                <p>Empty for new vendors — data accumulates as quotes flow in. Use this when shortlisting vendors for a new RFQ.</p>
            `
        },
        'manageItemsModal': {
            title: 'Manage Items this Vendor Supplies',
            body: `
                <p>Pick which <strong>master items</strong> this vendor can supply. Items selected here will be auto-suggested on RFQs and the vendor's catalog page.</p>
                <p>Use the <strong>Available</strong> column on the left to toggle items on; selected ones move to the right column.</p>
            `
        },
        'catalogLinkModal': {
            title: 'Vendor Catalog Link',
            body: `
                <p>A unique secure URL you can share with the vendor so they can fill in their <strong>full catalog</strong> (items + prices + lead times) without a login.</p>
                <p>Submitted catalogs feed the master items list and the vendor's price history — and you'll get notified when they submit.</p>
            `
        },
        // Items
        'itemModal': {
            title: 'Add / Edit Master Item',
            body: `
                <p>A <strong>master item</strong> is anything you buy — a product, material or service. Add a clear name, optional code, category, and unit so reports stay clean.</p>
                <p>After saving, open the item's <strong>Details</strong> to link vendors who supply it, add synonyms (alternative names), or map raw vendor strings.</p>
                <p><em>Tip:</em> Group items into Categories early — it makes filtering on every other page much faster.</p>
            `
        },
        'categoryModal': {
            title: 'Manage Categories',
            body: `
                <p>Categories are buckets for similar items (e.g. "Hotel Linen", "Office Stationery"). Used for filtering on the master items page and for reporting.</p>
                <p>Renaming a category here updates every item that uses it — no need to re-tag manually.</p>
            `
        },
        'itemDetailModal': {
            title: 'Item Details',
            body: `
                <p>Three tabs:</p>
                <ul style="margin:6px 0 6px 18px;padding:0;">
                    <li><strong>Linked Vendors</strong> — who supplies this item, with rankings.</li>
                    <li><strong>Synonyms</strong> — alternative clean names that mean the same item.</li>
                    <li><strong>Mappings</strong> — messy raw strings (from vendor bills/scans) that should resolve to this item.</li>
                </ul>
                <p>Each tab has its own &quot;What is this?&quot; explainer.</p>
            `
        },
        // Inquiries
        'inquiryModal': {
            title: 'New / Edit Inquiry',
            body: `
                <p>Capture an internal request: what we need, for which client/project, by when, and how urgent. This is the <strong>starting point</strong> of every procurement cycle.</p>
                <p>You'll add line items <strong>after</strong> creating the inquiry — open the inquiry detail page to add what's actually needed and then create RFQs from there.</p>
            `
        },
        'addItemModal': {
            title: 'Add Line Item',
            body: `
                <p>Pick a master item, set quantity and (optional) target price. The line item describes <em>what</em> the inquiry needs, not <em>from whom</em> — vendor selection happens on the RFQ.</p>
                <p><em>Tip:</em> If the item isn't in master, click <strong>+ Quick add</strong> in the dropdown to create it on the fly.</p>
            `
        },
        'editInquiryModal': {
            title: 'Edit Inquiry',
            body: `
                <p>Change the inquiry's title, description, client/project label, priority, or due date. Editing does <em>not</em> notify vendors — vendors only see RFQs.</p>
            `
        },
        'bulkImportModal': {
            title: 'Bulk Add from Catalog',
            body: `
                <p>Pull multiple master items into this inquiry in one go — useful when the inquiry covers a whole catalog (e.g., monthly stationery refill).</p>
                <p>Tick items, set quantities, then save — each row becomes a separate inquiry line item.</p>
            `
        },
        // RFQs
        'createRfqModal': {
            title: 'Create RFQ',
            body: `
                <p>Pick the <strong>Inquiry</strong> this RFQ is for, set a <strong>Quote Deadline</strong>, and add notes vendors should see (e.g. delivery location, payment terms).</p>
                <p>You'll select <em>which vendors</em> to invite in the next step. Each vendor gets a unique secure link — no login required.</p>
            `
        },
        'editRfqModal': {
            title: 'Edit RFQ',
            body: `
                <p>Update RFQ title, deadline, or vendor instructions. Editing after vendors have already received the link is allowed but bad form — they may have already started quoting.</p>
            `
        },
        'addVendorModal': {
            title: 'Add Vendors to RFQ',
            body: `
                <p>Pick the vendors who should receive this RFQ. Each selected vendor gets a unique secure portal link by email; they can quote without logging in.</p>
                <p><em>Tip:</em> Invite at least 3 vendors so the comparison page gives you negotiation leverage.</p>
            `
        },
        'viewQuoteModal': {
            title: 'Quote Details',
            body: `
                <p>Read-only view of one vendor's submitted quote: per-item prices, delivery time, terms, notes. Use the <strong>Comparison</strong> page to compare against other vendors' quotes side-by-side.</p>
            `
        },
        // Purchase Orders
        'createPoModal': {
            title: 'Create Purchase Order',
            body: `
                <p>The PO is the <strong>binding commitment</strong> to buy. Pick the awarded vendor, add line items + prices, and set delivery terms.</p>
                <p><strong>What happens on Save:</strong> a Procurement PO row is created AND a matching <strong>Accounts PO</strong> is mirrored via gRPC. Both rows start in <strong>Draft</strong> — at this stage there is NO impact on your General Ledger; nothing hits AP yet.</p>
                <p><strong>Why two-stage?</strong> Draft lets you review terms with the vendor before the financial commitment kicks in. Only when you click <strong>Approve</strong> does the PO become a posted journal entry (DR expense, CR AP) and start affecting your trial balance.</p>
                <p><em>Tip:</em> If Accounts is missing setup (chart of accounts, AP code, vendor not approved), Save will refuse with a clear message and roll back any half-written rows — you'll never end up out of sync.</p>
            `
        },
        'statusModal': {
            title: 'Update PO Status',
            body: `
                <p>Move the PO through its lifecycle: <strong>Draft → Approved → Sent → Acknowledged → Received → Closed</strong>.</p>
                <p><strong>Only TWO transitions touch Accounts.</strong> The rest are pure procurement-side workflow signals — no money moves, no API call to Accounts:</p>
                <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:11.5px;">
                    <thead>
                        <tr style="background:rgba(255,255,255,0.04);">
                            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-primary);">Transition</th>
                            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-primary);">Hits Accounts?</th>
                            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-primary);">What happens</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td style="padding:5px 8px;"><strong>→ Approved</strong></td><td style="padding:5px 8px;color:var(--color-success);"><strong>YES (commitment leg)</strong></td><td style="padding:5px 8px;">Posts GL journal: <em>DR expense, CR Goods Received Not Invoiced (GR/IR)</em>. Spend recognised; liability sits in suspense (NOT in AP) until the vendor invoice arrives.</td></tr>
                        <tr><td style="padding:5px 8px;">→ Sent</td><td style="padding:5px 8px;opacity:0.7;">No</td><td style="padding:5px 8px;">Operational signal only — vendor notified to ship. No GL impact, no Accounts call.</td></tr>
                        <tr><td style="padding:5px 8px;">→ Acknowledged</td><td style="padding:5px 8px;opacity:0.7;">No</td><td style="padding:5px 8px;">Operational signal only — vendor confirmed PO. No GL impact, no Accounts call.</td></tr>
                        <tr><td style="padding:5px 8px;">→ Partially Received</td><td style="padding:5px 8px;opacity:0.7;">No</td><td style="padding:5px 8px;">Operational only — track partial deliveries. Vendor Bill is created at full receive.</td></tr>
                        <tr><td style="padding:5px 8px;"><strong>→ Received</strong></td><td style="padding:5px 8px;color:var(--color-success);"><strong>YES (creates bill)</strong></td><td style="padding:5px 8px;">Creates a draft <strong>Vendor Bill</strong> in Accounts linked to this PO. No GL impact yet. When AP approves the bill, the second leg posts: <em>DR GR/IR, CR Accounts Payable</em> — clearing the suspense and credit AP exactly once.</td></tr>
                        <tr><td style="padding:5px 8px;">→ Closed</td><td style="padding:5px 8px;opacity:0.7;">No</td><td style="padding:5px 8px;">Procurement-side only — marks PO archived. Accounts state was already finalised at the bill payment step.</td></tr>
                    </tbody>
                </table>
                <p><em>Why this two-leg dance?</em> It's the standard <strong>three-way-match (GR/IR)</strong> pattern used by SAP/Oracle/NetSuite. Posting AP at the PO step would over-state liability if the vendor never invoices, or worse — double up if both PO and Bill credit AP. The GR/IR suspense account holds the commitment safely until the real invoice arrives, then transfers it to AP. Net effect: <code>DR Expense, CR AP</code> — exactly once.</p>
                <p><em>Tip:</em> Status moves are recorded in the audit log on both sides. If Accounts rejects a transition (e.g. GR/IR code missing), Procurement status will not flip — they always stay in sync.</p>
            `
        },
        'editPoModal': {
            title: 'Edit Purchase Order',
            body: `
                <p>Edits to an approved PO require re-approval. Changes to quantity or unit price update the Accounts liability automatically.</p>
            `
        },
        'cancelPoModal': {
            title: 'Cancel Purchase Order',
            body: `
                <p>Cancel a PO before goods are received. Cancellation reverses any open commitment and notifies the vendor (if the PO was already sent).</p>
                <p><strong>Accounts impact (depends on current status):</strong></p>
                <ul style="margin:6px 0 6px 18px;padding:0;">
                    <li><strong>Draft</strong> PO cancelled → row marked cancelled in both DBs. No GL impact (nothing was posted).</li>
                    <li><strong>Approved</strong> PO cancelled → Accounts posts a <strong>reversing GL entry</strong> (CR expense, DR AP) so the books net to zero, then marks the PO cancelled. Balance sheet returns to pre-approval state.</li>
                    <li><strong>Received</strong> PO cannot be cancelled — you must process a return + debit note instead.</li>
                </ul>
                <p><em>Tip:</em> Always add a clear reason — it appears on the vendor's portal AND on the audit trail Finance reviews.</p>
            `
        },
        'deliveryModal': {
            title: 'Record Delivery',
            body: `
                <p>Mark goods as received. Quantity received can be partial — the PO stays open until all items are delivered (or you mark the residual as cancelled).</p>
                <p><strong>Accounts impact:</strong> Receiving is the trigger that converts the PO into a <strong>Vendor Bill</strong> in Accounts. The bill is what AP actually pays. Until receive, you have a committed liability (PO approved) but no payable invoice.</p>
                <p><em>Tip:</em> If you receive less than ordered, only the received quantity moves to the bill — the residual stays open for short-shipment follow-up.</p>
            `
        },
        'goodsReceiptModal': {
            title: 'Record Goods Receipt Note (GRN)',
            body: `
                <p>Formal acknowledgement that goods arrived in good condition. The GRN is the second leg of the <strong>3-way match</strong> (PO ↔ GRN ↔ Vendor Bill) that AP uses before releasing payment.</p>
                <p><strong>Accounts impact:</strong> the GRN row is logged for audit and feeds the bill-matching workflow. No new GL entry at this step — the journal entry was already posted at PO approval.</p>
                <p><em>Tip:</em> Capture damage / shortfall here so the vendor bill can be reduced via a debit note before payment.</p>
            `
        },
        'rateQualityModal': {
            title: 'Rate Vendor Quality',
            body: `
                <p>After receipt, rate the vendor on quality and delivery. Ratings feed the <strong>Vendor Intelligence</strong> page so future RFQs can favour high-performers.</p>
            `
        },
        // Settings
        'procurementWipeModal': {
            title: 'DANGER — Wipe All Procurement Data',
            body: `
                <p>Deletes <strong>every</strong> Procurement record for this tenant: items, vendors-on-procurement, inquiries, RFQs, quotes, comparisons, POs, audit logs.</p>
                <p>Vendor master records in Accounts are <em>not</em> touched — they're owned by Accounts.</p>
                <p><em>This cannot be undone.</em> Take a database backup first.</p>
            `
        },
        'preferenceModal': {
            title: 'Add Vendor Preference',
            body: `<p>Bias the matching engine toward this vendor for matching items. Useful when a vendor has a contract or a strategic relationship.</p>`
        },
        'rejectionModal': {
            title: 'Add Vendor Rejection',
            body: `<p>Permanently exclude this vendor from being suggested for matching items (e.g. quality issues, blacklisted). Rejections take precedence over preferences.</p>`
        },
        'pricingModal': {
            title: 'Add Pricing Expectation',
            body: `<p>Tell the system the price band you expect for this item — when quotes come in outside the band, you'll see a flag on the comparison page.</p>`
        },
        'patternModal': {
            title: 'Add Decision Pattern',
            body: `<p>Codify a recurring procurement decision (e.g. &quot;always award delivery contracts to local vendors&quot;) so the system can apply it automatically next time.</p>`
        }
    };

    function injectModalInfo(modal) {
        if (!modal) return;
        const cfg = MODAL_INFO[modal.id];
        if (!cfg) return;
        const expectedId = 'info-modal-' + modal.id;
        // If the panel already exists in this modal, do nothing.
        if (modal.querySelector('#' + expectedId)) return;
        // Prefer to mount BETWEEN .modal-header and .modal-body so it survives
        // any innerHTML rewrites of .modal-body (e.g. vendorIntelModal where
        // .modal-body is the same element as #intelBody and gets fully replaced).
        const header = modal.querySelector('.modal-header');
        const wrapper = document.createElement('div');
        wrapper.innerHTML = infoPanel('modal-' + modal.id, cfg.title, cfg.body);
        const node = wrapper.firstElementChild;
        // Add a horizontal padding so the panel doesn't kiss the modal edges.
        node.style.margin = '12px 16px 0 16px';
        node.style.marginBottom = '0';
        if (header && header.parentElement) {
            header.insertAdjacentElement('afterend', node);
        } else {
            const body = modal.querySelector('.modal-body');
            if (body) body.insertAdjacentElement('afterbegin', node);
            else return;
        }
        modal.dataset.infoInjected = '1';
    }

    function scanAndInjectAllModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(injectModalInfo);
    }

    function startModalObserver() {
        scanAndInjectAllModals();
        // Re-scan whenever a new modal is added, OR an existing modal's class
        // changes (e.g. .active toggled by openModal()), OR a modal's body
        // contents are wiped (e.g. by JS innerHTML reset).
        const observer = new MutationObserver((mutations) => {
            for (const mut of mutations) {
                if (mut.type === 'attributes' && mut.target.classList?.contains('modal')) {
                    injectModalInfo(mut.target);
                    continue;
                }
                if (mut.type === 'childList') {
                    for (const node of mut.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        if (node.classList?.contains('modal')) {
                            injectModalInfo(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('.modal').forEach(injectModalInfo);
                        }
                    }
                    // If a node was removed from a modal we previously injected,
                    // re-check to see if our panel was nuked.
                    if (mut.removedNodes.length) {
                        const ancestorModal = mut.target.closest && mut.target.closest('.modal');
                        if (ancestorModal) injectModalInfo(ancestorModal);
                    }
                }
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            mountPageInfo();
            startModalObserver();
        });
    } else {
        mountPageInfo();
        startModalObserver();
    }

    window.infoPanel = infoPanel;
    window.PROCUREMENT_PAGE_INFO = PAGE_INFO;
    window.PROCUREMENT_MODAL_INFO = MODAL_INFO;
})();
