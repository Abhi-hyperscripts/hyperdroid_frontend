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
    const ids = ['kpiCashPosition', 'kpiRevenueMtd', 'kpiRevenueYtd', 'kpiNetProfitYtd',
        'kpiArOutstanding', 'kpiApOutstanding', 'kpiProjected30d'];
    try {
        const url = AccountsCommon.buildUrl('dashboard/kpis');
        const k = await api.request(url, { _skipSpinner: true });

        // Cash
        setCurrency('kpiCashPosition', k.total_liquid);
        setText('kpiCashSplit',
            `Bank ${AccountsCommon.formatCurrency(k.total_bank_balance || 0)} · Cash ${AccountsCommon.formatCurrency(k.total_cash_balance || 0)}`);

        // Revenue MTD + trend vs prev month
        setCurrency('kpiRevenueMtd', k.revenue_mtd);
        renderTrend('kpiRevenueMtdTrend', k.revenue_mtd, k.revenue_prev_month);

        // Revenue YTD
        setCurrency('kpiRevenueYtd', k.revenue_ytd);
        setText('kpiFyLabel', k.fiscal_year_name || '');

        // Net profit YTD
        setCurrency('kpiNetProfitYtd', k.net_profit_ytd);
        setText('kpiExpensesYtd',
            `Expenses ${AccountsCommon.formatCurrency(k.expenses_ytd || 0)}`);

        // AR
        setCurrency('kpiArOutstanding', k.ar_outstanding);
        setText('kpiArCount',
            `${k.ar_open_invoices_count || 0} open invoice${(k.ar_open_invoices_count || 0) === 1 ? '' : 's'}`);
        renderOverdueBadge('kpiArOverdueBadge', k.ar_overdue_count, k.ar_overdue);

        // AP
        setCurrency('kpiApOutstanding', k.ap_outstanding);
        setText('kpiApCount',
            `${k.ap_open_bills_count || 0} open bill${(k.ap_open_bills_count || 0) === 1 ? '' : 's'}`);
        renderOverdueBadge('kpiApOverdueBadge', k.ap_overdue_count, k.ap_overdue);

        // Projected 30d balance
        setCurrency('kpiProjected30d', k.projected_balance_30d);
        setText('kpiFlow30d',
            `In ${AccountsCommon.formatCurrency(k.expected_inflow_30d || 0)} · Out ${AccountsCommon.formatCurrency(k.expected_outflow_30d || 0)}`);
    } catch (err) {
        console.error('[Accounts:Dashboard] loadKpis error:', err);
        ids.forEach(id => setText(id, '-'));
    }
}

async function loadRevenueTrend() {
    try {
        const url = AccountsCommon.buildUrl('dashboard/revenue-trend', { months: 12 });
        const trend = await api.request(url, { _skipSpinner: true });
        // TODO: wire to chart library (Chart.js / ApexCharts) — for now just log so
        // the endpoint is exercised and the shape is visible during dev.
        console.log('[Accounts:Dashboard] Revenue trend (last 12 months):', trend);
    } catch (err) {
        console.error('[Accounts:Dashboard] loadRevenueTrend error:', err);
    }
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

function renderOverdueBadge(elId, count, amount) {
    const el = document.getElementById(elId);
    if (!el) return;
    const c = parseInt(count, 10) || 0;
    if (c <= 0) { el.style.display = 'none'; return; }
    el.style.display = 'inline-block';
    el.textContent = `${c} overdue · ${AccountsCommon.formatCurrency(amount || 0)}`;
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

        grid.innerHTML = accounts.map(acc => {
            const name = AccountsCommon.escapeHtml(acc.account_name || acc.accountName || 'Unnamed');
            const bank = AccountsCommon.escapeHtml(acc.bank_name || acc.bankName || '');
            const balance = AccountsCommon.formatCurrency(acc.balance ?? acc.current_balance ?? 0);
            const isNeg = (acc.balance ?? acc.current_balance ?? 0) < 0;
            return `
                <div class="bank-account-card glass-card">
                    <div class="bank-card-header">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                            <line x1="3" y1="22" x2="21" y2="22"/>
                            <line x1="6" y1="18" x2="6" y2="11"/>
                            <line x1="10" y1="18" x2="10" y2="11"/>
                            <line x1="14" y1="18" x2="14" y2="11"/>
                            <line x1="18" y1="18" x2="18" y2="11"/>
                            <polygon points="12 2 2 8 22 8"/>
                        </svg>
                        <span class="bank-card-name">${name}</span>
                    </div>
                    ${bank ? `<div class="bank-card-bank">${bank}</div>` : ''}
                    <div class="bank-card-balance ${isNeg ? 'negative' : ''}">${balance}</div>
                </div>`;
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
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">No entries yet</td></tr>';
            return;
        }

        tbody.innerHTML = entries.map(e => {
            const date = AccountsCommon.formatDate(e.entry_date || e.entryDate || e.date);
            const desc = AccountsCommon.escapeHtml(e.description || e.memo || '-');
            const debit = e.total_debit ?? e.debit_amount ?? e.debitAmount ?? 0;
            const credit = e.total_credit ?? e.credit_amount ?? e.creditAmount ?? 0;
            return `<tr>
                <td>${date}</td>
                <td class="desc-cell">${desc}</td>
                <td class="text-right">${debit ? AccountsCommon.formatCurrency(debit) : '-'}</td>
                <td class="text-right">${credit ? AccountsCommon.formatCurrency(credit) : '-'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('[Accounts:Dashboard] loadRecentEntries error:', err);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Failed to load entries</td></tr>';
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
        const list = Array.isArray(customers) ? customers : (customers?.customers || []);
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
        const list = Array.isArray(vendors) ? vendors : (vendors?.vendors || []);
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
