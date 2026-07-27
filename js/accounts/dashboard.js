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

    grid.innerHTML = phases.map(p => `
        <div class="setup-phase-title">${esc(p.title)}</div>
        ${p.steps.map(st => {
            const state = st.ok === true ? 'ok' : (st.required ? 'warn' : 'opt');
            return `<div class="setup-status-row ${state}">
                <span class="setup-status-icon">${icon(st.ok)}</span>
                <div class="setup-status-text">
                    <span class="setup-status-label">${esc(st.label)}${st.required ? '' : ' <em class="setup-opt-tag">optional</em>'}</span>
                    <span class="setup-status-detail">${esc(st.detail)}</span>
                </div>
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
