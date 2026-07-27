/**
 * Accounts Dashboard — Main entry point
 *
 * Loads financial summary stats, bank accounts, recent GL entries,
 * and pending approvals count.
 */

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('accounts', '../')) return;
    await loadDashboard();
});

// ============================================================================
// Dashboard Orchestrator
// ============================================================================

async function loadDashboard() {
    try {
        await Promise.all([
            loadSetupStatus(),
            loadKpis(),
            loadRevenueTrend(),
            loadAgingCharts(),
            loadBankingSummary(),
            loadRecentEntries(),
            loadPendingApprovals()
        ]);
    } catch (err) {
        console.error('[Accounts:Dashboard] loadDashboard error:', err);
    }
}

function refreshDashboard() {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('spinning');
    loadDashboard().finally(() => {
        if (btn) btn.classList.remove('spinning');
    });
}

// ============================================================================
// KPIs — single roll-up call for all dashboard tiles
// ============================================================================

async function loadKpis() {
    const ids = ['tCash', 'tAr', 'tAp', 'tRevM', 'tNet', 'tCashProj'];
    try {
        const url = AccountsCommon.buildUrl('dashboard/kpis');
        const k = await api.request(url, { _skipSpinner: true });
        const fmt = AccountsCommon.formatCurrency;

        renderVerdict(k);

        // Hero — the cash numeral counts up on load
        countUpCurrency('tCash', k.total_liquid);
        setText('tCashSplit', `Bank ${fmt(k.total_bank_balance || 0)} · Cash ${fmt(k.total_cash_balance || 0)}`);
        setCurrency('tCashProj', k.projected_balance_30d);
        setCurrency('tAr', k.ar_outstanding);
        setText('tArSub', `${k.ar_open_invoices_count || 0} open invoice${(k.ar_open_invoices_count || 0) === 1 ? '' : 's'}`);
        setCurrency('tAp', k.ap_outstanding);
        setText('tApSub', `${k.ap_open_bills_count || 0} open bill${(k.ap_open_bills_count || 0) === 1 ? '' : 's'}`);

        // Stat band
        setCurrency('tRevM', k.revenue_mtd);
        renderTrend('tRevMTrend', k.revenue_mtd, k.revenue_prev_month);
        setCurrency('tNet', k.net_profit_ytd);
        setText('tNetSub', `Revenue ${fmt(k.revenue_ytd || 0)} − expenses ${fmt(k.expenses_ytd || 0)}`);
        renderOverdueTile('tArOverVal', 'tArOverSub', k.ar_overdue_count, k.ar_overdue, 'invoice');
        renderOverdueTile('tApOverVal', 'tApOverSub', k.ap_overdue_count, k.ap_overdue, 'bill');
    } catch (err) {
        console.error('[Accounts:Dashboard] loadKpis error:', err);
        ids.forEach(id => setText(id, '-'));
    }
}

// The headline: a one-sentence verdict on financial health, plus the FY context line.
function renderVerdict(k) {
    const el = document.getElementById('dvVerdict');
    if (!el) return;
    const cash = parseFloat(k.total_liquid) || 0;
    const ap = parseFloat(k.ap_outstanding) || 0;
    const ar = parseFloat(k.ar_outstanding) || 0;
    let cls = 'ok', text;
    if (ap <= 0) {
        text = cash > 0 ? 'No open bills — everything in the bank is yours.' : 'No open bills, but no cash either — time to invoice.';
        if (cash <= 0) cls = 'warn';
    } else if (cash >= ap) {
        const x = cash / ap;
        text = `Cash covers every open bill ${x >= 10 ? Math.round(x) : x.toFixed(1)}× over.`;
    } else if (cash + ar >= ap) {
        cls = 'warn';
        text = `Bills exceed cash by ${AccountsCommon.formatCurrency(ap - cash)} — collecting receivables closes the gap.`;
    } else {
        cls = 'danger';
        text = `Bills exceed cash and receivables combined by ${AccountsCommon.formatCurrency(ap - cash - ar)}.`;
    }
    el.textContent = text;
    el.className = 'hero-verdict ' + cls;
    setText('dvContext', `${k.fiscal_year_name || 'This fiscal year'} so far · revenue ${AccountsCommon.formatCurrency(k.revenue_ytd || 0)} · expenses ${AccountsCommon.formatCurrency(k.expenses_ytd || 0)}`);
}

// Overdue tiles always show a state — a green "all current" is as informative as a red total.
function renderOverdueTile(valId, subId, count, amount, noun) {
    const val = document.getElementById(valId);
    if (!val) return;
    const c = parseInt(count, 10) || 0;
    if (c <= 0) {
        val.textContent = '✓ All current';
        val.classList.remove('dv-danger', 'dv-warn');
        val.classList.add('dv-ok');
        setText(subId, `No overdue ${noun}s`);
    } else {
        val.textContent = AccountsCommon.formatCurrency(amount || 0);
        setText(subId, `${c} ${noun}${c === 1 ? '' : 's'} past due — tap to see aging`);
    }
}

// rAF count-up for the hero numeral (skipped under prefers-reduced-motion).
function countUpCurrency(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const end = parseFloat(target) || 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || end === 0) {
        el.textContent = AccountsCommon.formatCurrency(end); return;
    }
    const dur = 900, t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        el.textContent = AccountsCommon.formatCurrency(end * ease(p));
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

async function loadRevenueTrend() {
    try {
        const url = AccountsCommon.buildUrl('dashboard/revenue-trend', { months: 12 });
        const res = await api.request(url, { _skipSpinner: true });
        const trend = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderRevenueTrendChart(trend);
    } catch (err) {
        console.error('[Accounts:Dashboard] loadRevenueTrend error:', err);
        const host = document.getElementById('revenueTrendChart');
        if (host) host.innerHTML = '<div class="empty-state"><p>Could not load revenue trend.</p></div>';
    }
}

// The dashboard has several charts — register each draw fn so a theme toggle
// redraws them all (each page normally has one _acActiveRender slot).
const _dashDraws = {};
function _registerDashDraw(key, draw) {
    _dashDraws[key] = draw;
    _acActiveRender = () => Object.values(_dashDraws).forEach(f => { try { f(); } catch (e) { /* chart host gone */ } });
}

// Monthly Revenue vs Expenses (last 12 months) + the monthly net result derived
// from the same data (green = profitable month, red = loss month).
function renderRevenueTrendChart(trend) {
    const host = document.getElementById('revenueTrendChart');
    if (!host) return;
    const data = (trend || []).slice(-12);
    if (!data.length || data.every(d => !d.revenue && !d.expenses)) {
        if (typeof _acEmpty === 'function') {
            _acEmpty('revenueTrendChart', 'No revenue or expenses in the last 12 months yet.');
            _acEmpty('netTrendChart', 'Nothing posted yet.');
        }
        return;
    }
    const categories = data.map(d => (d.label || '').replace(/ \d{2}(\d{2})$/, " '$1"));
    const revenue = data.map(d => Math.round((Number(d.revenue) || 0) * 100) / 100);
    const expenses = data.map(d => Math.round((Number(d.expenses) || 0) * 100) / 100);
    const net = revenue.map((r, i) => Math.round((r - expenses[i]) * 100) / 100);
    _registerDashDraw('revExp', () => drawHeroChart(categories, revenue, expenses));
    _registerDashDraw('net', () => acBarV('netTrendChart', categories, net,
        net.map(v => v >= 0 ? '#10b981' : '#ef4444')));
    _dashDraws.revExp(); _dashDraws.net();
}

// The hero chart is deliberately quieter than the card charts: full-bleed,
// no axes/grid noise — the shape of the money story, not a reading instrument.
// Hovering still gives exact figures via the shared tooltip.
function drawHeroChart(categories, revenue, expenses) {
    const el = document.getElementById('revenueTrendChart');
    if (!el || typeof ApexCharts === 'undefined') return;
    if (_acCharts['revenueTrendChart']) { _acCharts['revenueTrendChart'].destroy(); delete _acCharts['revenueTrendChart']; }
    el.innerHTML = '';
    const t = _acTheme();
    _acCharts['revenueTrendChart'] = new ApexCharts(el, {
        chart: { type: 'area', height: 150, background: 'transparent', fontFamily: 'inherit',
                 sparkline: { enabled: true }, animations: { speed: 900, easing: 'easeout' } },
        theme: { mode: t.isDark ? 'dark' : 'light' },
        colors: ['#10b981', '#ef4444'],
        series: [{ name: 'Revenue', data: revenue }, { name: 'Expenses', data: expenses }],
        stroke: { curve: 'straight', width: 2.5 },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.32, opacityTo: 0, stops: [0, 92] } },
        markers: { size: 3, strokeWidth: 0, hover: { size: 5 } },
        xaxis: { categories },
        tooltip: { theme: t.isDark ? 'dark' : 'light', shared: true,
                   x: { formatter: (i) => categories[i - 1] ?? '' },
                   y: { formatter: (v) => AccountsCommon.formatCurrency(v) } }
    });
    _acCharts['revenueTrendChart'].render();
}

// AR / AP aging buckets — same risk gradient as the Receivables/Payables pages.
const _AGING_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];
const _AGING_LABELS = ['Current', '1–30d', '31–60d', '61–90d', '90d+'];
async function loadAgingCharts() {
    const bucketize = (rows, nameKey) => {
        const sum = (f1, f2, f3) => rows.reduce((s, r) => s + (parseFloat(r[f1] ?? r[f2] ?? r[f3] ?? 0) || 0), 0);
        return [
            rows.reduce((s, r) => s + (parseFloat(r.current_amount ?? r.current ?? 0) || 0), 0),
            sum('days_30', '1_30', 'days_1_30'),
            sum('days_60', '31_60', 'days_31_60'),
            sum('days_90', '61_90', 'days_61_90'),
            sum('days_120_plus', '90_plus', 'days_90_plus')
        ].map(v => Math.round(v * 100) / 100);
    };
    const draw = (chartId, buckets, emptyMsg) => {
        if (buckets.every(v => !v)) { if (typeof _acEmpty === 'function') _acEmpty(chartId, emptyMsg); return; }
        _registerDashDraw(chartId, () => acBarV(chartId, _AGING_LABELS, buckets, _AGING_COLORS));
        _dashDraws[chartId]();
    };
    try {
        const ar = await api.request(AccountsCommon.buildUrl('invoices/aging'), { _skipSpinner: true });
        const arRows = Array.isArray(ar) ? ar : (ar?.data || ar?.buckets || ar?.customers || []);
        draw('arAgingChart', bucketize(arRows), 'Nothing outstanding — all invoices collected.');
    } catch (e) { if (typeof _acEmpty === 'function') _acEmpty('arAgingChart', 'Could not load receivables aging.'); }
    try {
        const ap = await api.request(AccountsCommon.buildUrl('vendor-bills/aging'), { _skipSpinner: true });
        const apRows = Array.isArray(ap) ? ap : (ap?.data || ap?.buckets || ap?.vendors || []);
        draw('apAgingChart', bucketize(apRows), 'Nothing owed — all bills settled.');
    } catch (e) { if (typeof _acEmpty === 'function') _acEmpty('apAgingChart', 'Could not load payables aging.'); }
}

function renderTrend(elId, current, previous) {
    const el = document.getElementById(elId);
    if (!el) return;
    const cur = parseFloat(current) || 0;
    const prev = parseFloat(previous) || 0;
    if (prev === 0 && cur === 0) { el.textContent = ''; el.className = 'kpi-trend'; return; }
    const deltaPct = prev === 0 ? 100 : ((cur - prev) / Math.abs(prev)) * 100;
    const up = deltaPct >= 0;
    el.textContent = `${up ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}%`;
    el.className = 'kpi-trend ' + (up ? 'kpi-trend-up' : 'kpi-trend-down');
}

// ============================================================================
// Banking Summary
// ============================================================================

async function loadBankingSummary() {
    const grid = document.getElementById('bankAccountsGrid');
    if (!grid) return;

    try {
        const url = AccountsCommon.buildUrl('bank/accounts');
        const res = await api.request(url, { _skipSpinner: true });
        const accounts = Array.isArray(res) ? res : (res?.data || res?.items || []);

        if (!accounts.length) {
            grid.innerHTML = '<div class="empty-state"><p>No bank accounts configured</p></div>';
            return;
        }

        // Deterministic avatar hue per account so colors are stable across loads
        const AV_HUES = [212, 158, 262, 20, 330, 190];
        grid.innerHTML = accounts.map((acc, i) => {
            const rawName = acc.account_name || acc.accountName || 'Unnamed';
            const name = AccountsCommon.escapeHtml(rawName);
            const bank = AccountsCommon.escapeHtml(acc.bank_name || acc.bankName || '');
            const bal = acc.balance ?? acc.current_balance ?? 0;
            const initials = rawName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
            const hue = AV_HUES[i % AV_HUES.length];
            return `
                <a class="bank-row" href="banking.html#bank-transactions">
                    <span class="bank-avatar" style="background:linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${hue + 24} 70% 42%));">${AccountsCommon.escapeHtml(initials)}</span>
                    <div>
                        <div class="bank-row-name">${name}</div>
                        ${bank ? `<div class="bank-row-bank">${bank}</div>` : ''}
                    </div>
                    <span class="bank-row-balance ${bal < 0 ? 'negative' : ''}">${AccountsCommon.formatCurrency(bal)}</span>
                </a>`;
        }).join('');
    } catch (err) {
        console.error('[Accounts:Dashboard] loadBankingSummary error:', err);
        grid.innerHTML = '<div class="empty-state"><p>Failed to load bank accounts</p></div>';
    }
}

// ============================================================================
// Recent GL Entries
// ============================================================================

async function loadRecentEntries() {
    const tbody = document.getElementById('recentEntriesBody');
    if (!tbody) return;

    try {
        const url = AccountsCommon.buildUrl('gl', { limit: 10, offset: 0 });
        const res = await api.request(url, { _skipSpinner: true });
        const entries = Array.isArray(res) ? res : (res?.data || res?.items || []);

        if (!entries.length) {
            tbody.innerHTML = '<div class="empty-state"><p>No entries yet — approve your first invoice or bill.</p></div>';
            return;
        }

        // Feed rows: classify each entry from its description so it gets a typed
        // icon, a clean title (system prefixes stripped) and a signed amount colour.
        const FEED_TYPES = [
            { re: /^withdrawal:\s*/i, kind: 'out',  label: 'Money out' },
            { re: /^deposit:\s*/i,    kind: 'in',   label: 'Money in' },
            { re: /^transfer:\s*/i,   kind: 'move', label: 'Transfer' },
            { re: /^invoice:\s*/i,    kind: 'doc',  label: 'Invoice' },
            { re: /^payment/i,        kind: 'in',   label: 'Payment' },
            { re: /^emi\b/i,          kind: 'out',  label: 'Loan EMI' },
            { re: /accrual/i,         kind: 'doc',  label: 'Journal' },
        ];
        const ICONS = {
            in:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/></svg>',
            out:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>',
            move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
            doc:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        };
        tbody.innerHTML = entries.slice(0, 9).map(e => {
            const rawDesc = e.description || e.memo || '—';
            let kind = 'doc', typeLabel = 'Entry', title = rawDesc;
            for (const t of FEED_TYPES) {
                if (t.re.test(rawDesc)) { kind = t.kind; typeLabel = t.label; title = rawDesc.replace(t.re, ''); break; }
            }
            const date = AccountsCommon.formatDate(e.entry_date || e.entryDate || e.date);
            const amount = e.total_debit ?? e.debit_amount ?? e.total_credit ?? 0;
            const sign = kind === 'out' ? '−' : kind === 'in' ? '+' : '';
            return `<div class="feed-row">
                <span class="feed-ic feed-${kind}">${ICONS[kind]}</span>
                <div class="feed-body">
                    <span class="feed-title">${AccountsCommon.escapeHtml(title)}</span>
                    <span class="feed-sub">${date} · ${typeLabel}</span>
                </div>
                <span class="feed-amount feed-${kind}-amt">${sign}${AccountsCommon.formatCurrency(amount)}</span>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('[Accounts:Dashboard] loadRecentEntries error:', err);
        tbody.innerHTML = '<div class="empty-state"><p>Could not load activity.</p></div>';
    }
}

// ============================================================================
// Pending Approvals
// ============================================================================

async function loadPendingApprovals() {
    const badge = document.getElementById('pendingApprovalsBadge');
    const desc = document.getElementById('pendingApprovalsDesc');

    try {
        const url = AccountsCommon.buildUrl('audit/approvals/pending');
        const res = await api.request(url, { _skipSpinner: true });
        // Backend returns { expense_claims: [...], total_pending }. Was reading res.total
        // (doesn't exist) → badge always showed 0. Fixed in Phase 4 Tier 1.
        const count = res?.total_pending
            ?? (Array.isArray(res?.expense_claims) ? res.expense_claims.length : 0);

        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        if (desc) {
            desc.textContent = count > 0
                ? `${count} item${count !== 1 ? 's' : ''} awaiting your approval`
                : 'Audit logs, approvals & year-end closing';
        }
    } catch (err) {
        console.error('[Accounts:Dashboard] loadPendingApprovals error:', err);
        if (badge) badge.textContent = '0';
        if (desc) desc.textContent = 'Unable to load approvals';
    }
}

// ============================================================================
// Helpers
// ============================================================================

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setCurrency(id, amount) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = AccountsCommon.formatCurrency(amount ?? 0);
    if ((amount ?? 0) < 0) {
        el.classList.add('negative');
    } else {
        el.classList.remove('negative');
    }
}

// ============================================================================
// Setup Status — readiness checklist for CA-style onboarding
// ============================================================================
// Catches missing config (no fiscal year, no taxation, etc.) BEFORE the user
// hits an empty dropdown on the invoice screen. Each row queries one endpoint;
// passes are silent (green), failures get an actionable button to navigate to
// the page that fixes them. Once all 6 checks pass, the panel auto-collapses
// to a thin "all ready" strip — out of the way but still discoverable.

const SETUP_STATUS_COLLAPSED_KEY = 'accounts_setupStatus_userCollapsed';


// ── Founder-friendly deep help per guide step (right slide-over). Written for
// owners with NO accounting background: what it is, why THEY should care,
// how to do it, and a rupee example. Keyed by step label. ──
const GUIDE_HELP = {
    'Chart of accounts': {
        what: `Think of it as the set of labelled folders your money gets filed into — one folder for Rent, one for Sales, one for your bank, one for what customers owe you. Every rupee that ever moves lands in exactly one folder.`,
        why: `Without folders, your reports can only say "money came, money went". With them, the P&L can answer "what do we spend on ads?" or "how much did services earn?" in one line. You never post to these folders manually — invoices and bills do it for you.`,
        how: [`Open Setup → COA Templates`, `Press View on the template that matches your business (software company → "Services & Software (Lean)")`, `Press Apply — ~50 ready-made folders appear`, `Forget about it. Add a folder later only when a real need shows up`],
        example: `You start running Google ads. Instead of dumping it in "Office Supplies", you add one account "Digital Ads". Six months later you know exactly what marketing costs you — that's the entire point.`
    },
    'Fiscal year': {
        what: `The 12-month window your books are measured in. In India that's 1 April to 31 March — "FY 2026-27" means Apr 2026 through Mar 2027.`,
        why: `Every report ("profit this year"), every budget and every tax filing is measured inside this window. A bill dated 31 March and one dated 1 April land in different years — and different tax returns.`,
        how: [`Open Setup → Fiscal Years`, `Create the current year (e.g. FY 2026-27: 01-04-2026 to 31-03-2027)`, `The 12 monthly periods are created under it automatically`],
        example: `You invoice ₹1,00,000 on 28 March 2027 — it counts in FY 2026-27's profit and tax. Send the same invoice 5 days later and it belongs to FY 2027-28. Same work, different tax year.`
    },
    'GST home state': {
        what: `The state your GST registration lives in. This one dropdown decides how tax splits on every single invoice and bill.`,
        why: `Sell to someone in YOUR state → tax splits as CGST + SGST. Sell to another state → it's IGST. Get the home state wrong and every document you approve carries the wrong tax split — painful to fix after the fact.`,
        how: [`Open Administration → Tenant Settings`, `Set country India and pick your state (e.g. Uttar Pradesh)`, `Save — done forever unless you relocate the registration`],
        example: `Your office is in Noida (UP). A ₹1,00,000 invoice to a Delhi client shows ₹18,000 IGST; the same invoice to a Noida client shows ₹9,000 CGST + ₹9,000 SGST. You never think about it — the system reads this setting.`
    },
    'Taxes (GST/TDS)': {
        what: `The tax rates the system applies for you: GST slabs (5/12/18/28%) and TDS sections. "Seed India defaults" creates all of them in one click.`,
        why: `Once seeded, you pick "GST 18%" from a dropdown on an invoice line and everything else — the split, the ledger entries, the GSTR-1/3B returns — assembles itself. No spreadsheets at filing time.`,
        how: [`Open Taxation → Tax Configuration`, `Press Seed India defaults`, `Then add the 2-3 HSN/SAC codes you bill under (software services = SAC 998314) so invoice lines auto-fill`],
        example: `In July you charged ₹72,000 GST on sales and paid ₹23,000 GST on purchases. GSTR-3B says: pay ₹49,000, not ₹72,000 — the ₹23,000 credit is money this setup saves you from overpaying.`
    },
    'Bank account': {
        what: `A card in the system for each real-world account — your current account, and optionally a petty-cash box for office cash.`,
        why: `Every payment in or out needs a place to land. This is also what makes the monthly bank reconciliation possible — proving your books match the bank's statement.`,
        how: [`Open Banking → Bank Accounts → Add`, `Enter the account name, bank and number`, `Add a "Petty Cash Box" (type: Petty Cash) too if the office spends cash on milk, stationery, wages`],
        example: `HDFC Current for client payments, plus a ₹10,000 petty-cash box. When the office buys ₹380 of milk, it's two clicks in Record Spend — and month-end the box's balance should match the physical cash.`
    },
    'Opening balances': {
        what: `Where your OLD records hand over to this system. You enter what each folder held on day one: bank balance, what customers owed you, what you owed vendors.`,
        why: `Skip this on a running business and the system starts from zero — your bank card shows ₹0 while the real account holds lakhs, and old dues vanish. Starting a brand-new business? Genuinely skip it.`,
        how: [`Open Setup → Opening Balances`, `Pick your start date (usually 1 April)`, `Enter each account's balance from your old records/CA`, `The two columns must match — the system checks`],
        example: `Switching on 1 April with ₹3,20,000 in the bank, customers owing ₹1,80,000 and vendor dues of ₹80,000 — enter those and day one starts from truth.`
    },
    'Customers': {
        what: `Who you sell to. Each customer record carries the two facts that drive tax: their state and their GST registration status.`,
        why: `Set once, correct forever: registered Delhi client → IGST automatically; overseas client → zero-rated export automatically. Every invoice, statement and reminder hangs off this record.`,
        how: [`Open Parties → Customers → Add`, `Name, state, GST treatment (registered / unregistered / overseas), GSTIN if they have one`, `Add just your real customers — more get added as they come`],
        example: `Add "Northwind Software (USA)" as Overseas once — every invoice to them is automatically a zero-GST export. No per-invoice thinking.`
    },
    'Vendors': {
        what: `Who you buy from — landlord, internet provider, the AC repair shop, your CA.`,
        why: `Bills need a vendor. And a REGISTERED vendor's GST becomes credit you subtract from your own GST bill — the system tracks that claim for you, but only if the vendor record says they're registered.`,
        how: [`Open Parties → Vendors → Add`, `Name, state, GST registration + GSTIN`, `That's it — record your first bill against them any time`],
        example: `Two ad agencies quote ₹50,000. The GST-registered one effectively costs you ₹50,000 (you claim back the ₹9,000 GST); the unregistered one's price is final. The vendor record is where the system learns the difference.`
    },
    'Expense categories': {
        what: `Plain-English names for everyday spending — "Milk & Water", "Stationery", "Staff Salaries" — each quietly mapped to the right accounting folder once.`,
        why: `So nobody in the office ever needs to know an account code. Pick "Groceries", type the amount, done — the accounting happens behind the curtain. These power both the Record Spend button and employee expense claims.`,
        how: [`Open Expenses → Categories → Add`, `Name it what your team actually says`, `Map it to an expense account (your CA can confirm, or use the obvious one)`, `It appears instantly in Banking's Record Spend`],
        example: `Office boy buys ₹380 of milk. With a "Milk & Water" category: Record Spend → pick it → 380 → Save. Ten seconds, and the P&L still knows exactly where the money went.`
    },
    'Cost centres': {
        what: `Optional tags that answer "WHICH PART of the business spent this?" — departments, branches, teams.`,
        why: `The expense folder says what the money became (Rent, Ads). The cost centre adds who spent it. Only worth it once you have multiple teams or branches to compare.`,
        how: [`Open Cost Centres → New`, `Create e.g. Engineering / Marketing / Operations`, `When recording a bill, tag each line to a centre`, `Read the answers in Cost Centres → Spend Report`],
        example: `Electricity ₹30,000 — the spend report shows Factory ₹22,000, Office ₹8,000. Same bill, one extra dimension of truth.`
    },
    'Projects': {
        what: `Optional per-client engagement tags — so "the mobile app project" and "the website revamp" each get their own billed / collected / due story.`,
        why: `If you bill clients per project, this answers "how much of the app budget have we invoiced, and what's still unpaid?" without a spreadsheet.`,
        how: [`Open Projects → New Project (pick the customer, set a budget if you have one)`, `When invoicing, tag each line to its project`, `Read Projects → Project Statement before every milestone conversation`],
        example: `Mobile App: billed ₹3,70,000, collected ₹2,10,000, due ₹1,60,000. That due figure is your leverage before starting milestone 4.`
    },
    'Recurring rules': {
        what: `Set-and-forget for anything that repeats: the rent bill every month, a monthly retainer invoice to a client, the salary accrual.`,
        why: `The system becomes the person who never forgets. On the 1st, the rent bill simply exists — correctly filed, every month, forever.`,
        how: [`Open Recurring → New Recurring`, `Pick the type (invoice / bill / journal), the party, amount and frequency`, `Set the start date — generation is automatic from then on`],
        example: `"Office Rent — ₹50,000 — monthly — starts 1 Aug." Every month a real vendor bill appears by itself, posted to Rent. You've retired from remembering it.`
    },
    'Budgets': {
        what: `Your plan for the year, per folder: "Rent ₹6L, Ads ₹3L, and we aim to sell ₹30L."`,
        why: `Plans only matter when something judges them. Budget-vs-Actual shows green when an expense is under plan and red when income is behind target — mid-year, while you can still act.`,
        how: [`Open Budgets → Add Budget (needs a fiscal year first)`, `Pick an account, enter the annual amount`, `Check Budgets → Budget vs Actual monthly`],
        example: `Sales target ₹30L, actual ₹8L by mid-year → the analysis shows it red. Under-plan income is the bad direction — the colours already know that.`
    },
    'First invoice approved': {
        what: `Your first real sale in the system. Key idea: a DRAFT invoice is just a piece of paper — nothing hits the books until you press Approve.`,
        why: `Approval is the accounting moment: income is recorded, the customer officially owes you, GST liability starts. It also locks the invoice — corrections happen via credit notes, never deletion. That audit trail is what makes your books trustworthy.`,
        how: [`Receivables → New invoice`, `Pick the customer, add a line (description, SAC code, amount, GST rate)`, `Save as draft, review, press Approve`, `Send it — then watch it in AR Aging until paid`],
        example: `₹1,00,000 to a Noida client becomes ₹1,18,000 with GST. On Approve: revenue +₹1,00,000, the client owes ₹1,18,000, and ₹18,000 sits as GST you're holding for the government — all from one click.`
    },
    'First bill recorded': {
        what: `The mirror image: an invoice a supplier sent YOU. Recording it captures the expense and remembers who you owe.`,
        why: `Two reasons founders skip this and regret it: unpaid bills vanish from memory (and vendor goodwill), and every GST bill you don't record is GST credit you're gifting the government.`,
        how: [`Payables → Record a bill when a vendor invoice arrives`, `Pick the vendor, put each line under the right expense folder`, `Approve — the expense and the due amount are now tracked`, `Pay it when due and record the payment`],
        example: `Ad agency bills ₹45,000 + ₹8,100 GST. Record it and that ₹8,100 reduces next month's GST payment. Toss the PDF in a folder instead, and you pay ₹8,100 extra.`
    },
    'First payment': {
        what: `Money actually arriving: match what landed in the bank against the invoice it pays.`,
        why: `This is what separates "profit on paper" from cash. Until recorded, the invoice shows unpaid, reminders keep counting, and your cash position is wrong.`,
        how: [`Receivables → Payments → Record Payment`, `Pick the customer, amount, and which bank it hit`, `Allocate it against the invoice(s) it pays`, `If the client deducted TDS, enter it — you still get credit for it at tax time`],
        example: `Client owes ₹1,18,000, transfers ₹1,16,000 after 2% TDS. Record ₹1,18,000 with ₹2,000 TDS: bank +₹1,16,000, invoice fully paid, ₹2,000 parked as tax already paid on your behalf.`
    },
    'Monthly habit: reconcile the bank': {
        what: `A once-a-month ritual: take the bank statement, tick off each transaction against your books, and make the totals agree.`,
        why: `This is the single habit that makes every number in this system trustworthy. Differences are always a message: a payment you forgot to record, a charge the bank took silently, or a cheque that never cleared.`,
        how: [`Banking → Reconciliation → enter the statement's closing balance`, `Tick each book transaction that appears on the statement`, `Chase any difference until it's zero, then complete`, `Then lock the month in Setup → Fiscal Periods`],
        example: `Statement says ₹5,20,000; books say ₹5,28,000. Matching reveals an ₹8,000 customer cheque that bounced silently. You found out this month — not at year-end.`
    }
};

let _guideSteps = [];
let _guideHelpPanel = null;
function openStepHelp(idx) {
    const st = _guideSteps[idx];
    if (!st || typeof SlidePanel === 'undefined') return;
    const h = GUIDE_HELP[st.label] || {};
    const esc = AccountsCommon.escapeHtml;
    if (!_guideHelpPanel) _guideHelpPanel = new SlidePanel({ id: 'guideHelpPanel', title: st.label });
    _guideHelpPanel.setTitle(st.label);
    _guideHelpPanel.open({
        body: `<div class="guide-help-body">
            <h4>What is this?</h4><p>${esc(h.what || st.detail)}</p>
            ${h.why ? `<h4>Why you should care</h4><p>${esc(h.why)}</p>` : ''}
            ${h.how ? `<h4>How to do it</h4><ol>${h.how.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
            ${h.example ? `<h4>Example</h4><div class="guide-help-example">${esc(h.example)}</div>` : ''}
            <a class="guide-help-cta" href="${esc(st.href)}">${esc(st.ok === true ? 'Open' : st.action)} →</a>
        </div>`
    });
}

async function loadSetupStatus() {
    const panel = document.getElementById('setupStatusPanel');
    const grid  = document.getElementById('setupStatusGrid');
    if (!panel || !grid) return;
    panel.hidden = false;

    // Every check has its own catch — one broken endpoint can't break the guide.
    const safeGet = async (path, params) => {
        try { return await api.request(AccountsCommon.buildUrl(path, params), { _skipSpinner: true }); }
        catch (e) { return { _err: e?.message || 'failed' }; }
    };
    const listOf = (res, ...keys) => {
        if (Array.isArray(res)) return res;
        for (const k of ['data', 'items', ...keys]) if (Array.isArray(res?.[k])) return res[k];
        return [];
    };
    const countOf = (res, ...keys) => res?.total ?? res?.totalCount ?? listOf(res, ...keys).length;

    const [coa, fy, settings, taxConfigs, banks, customers, vendors, expCats,
           ccs, projects, recurring, invoices, bills, payments] = await Promise.all([
        safeGet('coa', { limit: 1 }), safeGet('fiscal/years/active'), safeGet('settings'),
        safeGet('tax/configurations'), safeGet('bank/accounts'),
        safeGet('customers', { limit: 1 }), safeGet('vendors', { limit: 1 }), safeGet('expenses/categories'),
        safeGet('cost-centres', { limit: 1 }), safeGet('projects', { limit: 1 }), safeGet('recurring', { limit: 1 }),
        safeGet('invoices', { limit: 1 }), safeGet('vendor-bills', { limit: 1 }),
        safeGet('invoices/payments', { limit: 1 })
    ]);

    const hasFy = !!(fy && !fy._err && (fy.id || fy.fiscal_year_id || fy.name));
    // Budgets are per fiscal year — only checkable once a year exists
    const budgets = hasFy ? await safeGet('budgets', { fiscalYearId: fy.id || fy.fiscal_year_id, limit: 1 }) : null;
    const hasState = !!(settings && !settings._err && settings.state_code);

    // The in-product version of the onboarding walkthrough: four phases, each
    // step = live status + why it matters + a link to the exact screen.
    const phases = [
        { title: 'Phase 1 — Foundation (one-time)', steps: [
            { label: 'Chart of accounts', ok: countOf(coa, 'accounts') > 0, required: true,
              detail: 'Your filing system for money — apply a business-type template, customize later',
              action: 'Pick a template', href: 'setup.html#templates' },
            { label: 'Fiscal year', ok: hasFy, required: true,
              detail: hasFy ? `${fy.name || 'Active year'} is active` : 'The 12-month cycle reports are measured in (India: April–March)',
              action: hasFy ? 'View' : 'Create', href: 'setup.html#fiscal-years' },
            { label: 'GST home state', ok: hasState, required: true,
              detail: hasState ? 'Home state set — CGST/SGST vs IGST resolves automatically'
                               : 'Decides CGST+SGST vs IGST on every document — set before approving anything',
              action: hasState ? 'View' : 'Set now', href: 'admin.html#tenant-settings' },
            { label: 'Taxes (GST/TDS)', ok: countOf(taxConfigs, 'configurations') > 0, required: true,
              detail: 'Seed the India defaults, then add the HSN/SAC codes you bill under',
              action: 'Set up taxes', href: 'taxation.html' },
            { label: 'Bank account', ok: countOf(banks, 'bank_accounts') > 0, required: true,
              detail: 'Where payments land — add each real account (+ a petty-cash box if you spend cash)',
              action: 'Add bank', href: 'banking.html' },
            { label: 'Opening balances', ok: null, required: false,
              detail: 'Only if the business existed before this system — enter balances as of day one',
              action: 'Enter', href: 'setup.html#opening-balances' },
        ]},
        { title: 'Phase 2 — People & vocabulary', steps: [
            { label: 'Customers', ok: countOf(customers, 'customers') > 0, required: true,
              detail: 'State + GST treatment per customer makes invoice tax automatic',
              action: 'Add first', href: 'parties.html#customer-list' },
            { label: 'Vendors', ok: countOf(vendors, 'vendors') > 0, required: true,
              detail: 'Needed to record bills — registered vendors give you GST input credit',
              action: 'Add first', href: 'parties.html#vendor-list' },
            { label: 'Expense categories', ok: listOf(expCats).length > 0, required: true,
              detail: 'Friendly names (Groceries, Stationery…) that power Record Spend and claims',
              action: 'Define', href: 'expenses.html#expense-categories' },
        ]},
        { title: 'Phase 3 — Optional structure (add when needed)', steps: [
            { label: 'Cost centres', ok: countOf(ccs) > 0, required: false,
              detail: 'Tag spending by department to answer "who spent this?"', action: 'Create', href: 'cost-centres.html' },
            { label: 'Projects', ok: countOf(projects) > 0, required: false,
              detail: 'Track billed / collected / due per client engagement', action: 'Create', href: 'projects.html' },
            { label: 'Recurring rules', ok: countOf(recurring) > 0, required: false,
              detail: 'Rent, salaries, SaaS invoices — generated on schedule so nobody has to remember',
              action: 'Automate', href: 'recurring.html' },
            { label: 'Budgets', ok: countOf(budgets) > 0, required: false,
              detail: 'Plan per account for the year; Budget-vs-Actual does the judging', action: 'Plan', href: 'budgets.html' },
        ]},
        { title: 'Phase 4 — Go live', steps: [
            { label: 'First invoice approved', ok: countOf(invoices) > 0, required: true,
              detail: 'Draft posts nothing — approval is the accounting moment', action: 'New invoice', href: 'receivables.html' },
            { label: 'First bill recorded', ok: countOf(bills) > 0, required: true,
              detail: 'Captures the expense AND your GST input credit', action: 'Record bill', href: 'payables.html' },
            { label: 'First payment', ok: countOf(payments) > 0, required: true,
              detail: 'Money in against an invoice — bank up, receivable cleared', action: 'Record', href: 'receivables.html#customer-payments' },
            { label: 'Monthly habit: reconcile the bank', ok: null, required: false,
              detail: 'Prove books = bank statement every month, then lock the period. The one habit that keeps everything trustworthy.',
              action: 'Reconcile', href: 'banking.html#reconciliation' },
        ]},
    ];

    const esc = AccountsCommon.escapeHtml;
    const icon = (ok) => ok === true
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        : ok === false
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';

    _guideSteps = phases.flatMap(p => p.steps);
    let idx = 0;
    grid.innerHTML = phases.map(p => `
        <div class="setup-phase-title">${esc(p.title)}</div>
        ${p.steps.map(st => {
            const state = st.ok === true ? 'ok' : (st.required ? 'warn' : 'opt');
            const i = idx++;
            return `<div class="setup-status-row ${state}">
                <span class="setup-status-icon">${icon(st.ok)}</span>
                <div class="setup-status-text">
                    <span class="setup-status-label">${esc(st.label)}${st.required ? '' : ' <em class="setup-opt-tag">optional</em>'}</span>
                    <span class="setup-status-detail">${esc(st.detail)}</span>
                </div>
                <button type="button" class="setup-info-btn" onclick="openStepHelp(${i})" title="What is this and why it matters">i</button>
                <a class="setup-status-action" href="${esc(st.href)}">${esc(st.ok === true ? 'View' : st.action)}</a>
            </div>`;
        }).join('')}`).join('');

    const required = phases.flatMap(p => p.steps).filter(st => st.required);
    const passed = required.filter(st => st.ok === true).length;
    const allGreen = passed === required.length;
    document.getElementById('setupStatusProgress').textContent = `${passed} of ${required.length}`;
    document.getElementById('setupStatusSub').textContent = allGreen
        ? 'All set — the books are live. Expand any time to revisit the guide.'
        : `Your step-by-step setup guide — ${required.length - passed} step${required.length - passed === 1 ? '' : 's'} to go.`;

    panel.classList.toggle('is-all-green', allGreen);
    const userPref = localStorage.getItem(SETUP_STATUS_COLLAPSED_KEY);
    let collapsed;
    if (userPref === 'true' || userPref === 'false') collapsed = userPref === 'true';
    else collapsed = allGreen;
    panel.classList.toggle('is-collapsed', collapsed);
}

function toggleSetupStatusCollapsed() {
    const panel = document.getElementById('setupStatusPanel');
    if (!panel) return;
    panel.classList.toggle('is-collapsed');
    localStorage.setItem(SETUP_STATUS_COLLAPSED_KEY, String(panel.classList.contains('is-collapsed')));
}
