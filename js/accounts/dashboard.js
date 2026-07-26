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
        stroke: { curve: 'smooth', width: 2.5 },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.32, opacityTo: 0, stops: [0, 92] } },
        markers: { size: 0, hover: { size: 5 } },
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

    // Fire all 6 reads in parallel; never throw — each check has its own
    // catch so one broken endpoint can't break the whole readiness panel.
    const safeGet = async (path) => {
        try { return await api.request(AccountsCommon.buildUrl(path), { _skipSpinner: true }); }
        catch (e) { return { _err: e?.message || 'failed' }; }
    };

    const [coa, fy, taxConfigs, customers, vendors, banks] = await Promise.all([
        safeGet('coa'),
        safeGet('fiscal/years/active'),
        safeGet('tax/configurations'),
        safeGet('customers'),
        safeGet('vendors'),
        safeGet('bank/accounts')
    ]);

    const checks = [];

    // 1. Chart of Accounts
    {
        const list = Array.isArray(coa) ? coa : (coa?.accounts || []);
        const ok = list.length > 0;
        checks.push(_setupCheck({
            label: 'Chart of Accounts',
            ok,
            detail: ok ? `${list.length} account${list.length === 1 ? '' : 's'} configured` : 'No accounts yet — invoices and journal entries can\'t post',
            actionLabel: ok ? 'Manage' : 'Set up now',
            href: 'setup.html#accounts'
        }));
    }

    // 2. Fiscal Year
    {
        const active = fy && !fy._err && (fy.id || fy.fiscal_year_id || fy.name);
        const ok = !!active;
        const detail = ok
            ? `${fy.name || 'Active fiscal year'} (${(fy.start_date||'').slice(0,10)} → ${(fy.end_date||'').slice(0,10)})`
            : 'No active fiscal year — opening balances + period reports can\'t resolve';
        checks.push(_setupCheck({
            label: 'Fiscal Year',
            ok,
            detail,
            actionLabel: ok ? 'View' : 'Create now',
            href: 'setup.html#fiscal-years'
        }));
    }

    // 3. Taxation — if there's at least one configuration AND it has at least one rate.
    //    Cheaper proxy: just count configurations. If a config exists, the CA can drill in.
    {
        const list = Array.isArray(taxConfigs) ? taxConfigs : (taxConfigs?.configurations || []);
        const ok = list.length > 0;
        checks.push(_setupCheck({
            label: 'Taxation (GST/VAT)',
            ok,
            detail: ok
                ? `${list.length} tax configuration${list.length === 1 ? '' : 's'} ready — invoices will pick up the right slabs`
                : 'Not configured — GST won\'t appear on invoices until you set this up',
            actionLabel: ok ? 'Manage' : 'Set up now',
            href: 'taxation.html',
            severity: ok ? 'ok' : 'error'   // taxation missing is a hard error, not just a warning
        }));
    }

    // 4. Customers
    {
        // The list endpoints return { data, total, stats } — parse data/items too, not just a bare array
        // or a (non-existent) .customers key, else this wrongly reads 0 and shows "No customers yet".
        const list = Array.isArray(customers) ? customers : (customers?.data || customers?.items || customers?.customers || []);
        const ok = list.length > 0;
        checks.push(_setupCheck({
            label: 'Customers',
            ok,
            detail: ok ? `${list.length} customer${list.length === 1 ? '' : 's'} on file` : 'No customers yet — needed to issue invoices',
            actionLabel: ok ? 'View' : 'Add first',
            href: 'parties.html#customers'
        }));
    }

    // 5. Vendors
    {
        const list = Array.isArray(vendors) ? vendors : (vendors?.data || vendors?.items || vendors?.vendors || []);
        const ok = list.length > 0;
        checks.push(_setupCheck({
            label: 'Vendors',
            ok,
            detail: ok ? `${list.length} vendor${list.length === 1 ? '' : 's'} on file` : 'No vendors yet — needed to record bills',
            actionLabel: ok ? 'View' : 'Add first',
            href: 'parties.html#vendors'
        }));
    }

    // 6. Bank Account
    {
        const list = Array.isArray(banks) ? banks : (banks?.bank_accounts || []);
        const ok = list.length > 0;
        checks.push(_setupCheck({
            label: 'Bank Account',
            ok,
            detail: ok ? `${list.length} account${list.length === 1 ? '' : 's'} linked` : 'No bank account linked — payments can\'t be reconciled',
            actionLabel: ok ? 'Manage' : 'Link now',
            href: 'banking.html'
        }));
    }

    grid.innerHTML = checks.map(_renderSetupRow).join('');

    // Header summary + collapse behavior
    const passed = checks.filter(c => c.ok).length;
    const total  = checks.length;
    const allGreen = passed === total;
    document.getElementById('setupStatusProgress').textContent = `${passed} of ${total}`;
    document.getElementById('setupStatusSub').textContent = allGreen
        ? 'All systems ready — start invoicing and recording transactions.'
        : `${total - passed} step${total - passed === 1 ? '' : 's'} remaining before you can transact cleanly.`;

    panel.classList.toggle('is-all-green', allGreen);

    // Default expanded if anything is missing; collapsed when all-green.
    // Respect the user's manual collapse choice across reloads.
    const userPref = localStorage.getItem(SETUP_STATUS_COLLAPSED_KEY);
    let collapsed;
    if (userPref === 'true' || userPref === 'false') {
        collapsed = userPref === 'true';
    } else {
        collapsed = allGreen;
    }
    panel.classList.toggle('is-collapsed', collapsed);
}

function _setupCheck({ label, ok, detail, actionLabel, href, severity }) {
    return { label, ok, detail, actionLabel, href, severity: severity || (ok ? 'ok' : 'warn') };
}

function _renderSetupRow(c) {
    const icon = c.ok
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/><circle cx="12" cy="12" r="10"/></svg>';
    const safeLabel  = AccountsCommon.escapeHtml(c.label);
    const safeDetail = AccountsCommon.escapeHtml(c.detail || '');
    const safeAction = AccountsCommon.escapeHtml(c.actionLabel || (c.ok ? 'View' : 'Fix'));
    const safeHref   = AccountsCommon.escapeHtml(c.href || '#');
    return `
        <div class="setup-status-row ${c.severity}">
            <span class="setup-status-icon">${icon}</span>
            <div class="setup-status-text">
                <span class="setup-status-label">${safeLabel}</span>
                <span class="setup-status-detail">${safeDetail}</span>
            </div>
            <a class="setup-status-action" href="${safeHref}">${safeAction}</a>
        </div>`;
}

function toggleSetupStatusCollapsed() {
    const panel = document.getElementById('setupStatusPanel');
    if (!panel) return;
    panel.classList.toggle('is-collapsed');
    localStorage.setItem(SETUP_STATUS_COLLAPSED_KEY, String(panel.classList.contains('is-collapsed')));
}
