/**
 * AccountsService — Financial Reports Page
 *
 * Handles 9 sidebar tabs:
 *   1. Trial Balance          5. Account Ledger
 *   2. Profit & Loss          6. Day Book
 *   3. Balance Sheet          7. Cash Book
 *   4. Cash Flow              8. AR Aging
 *                             9. AP Aging
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let fiscalYears = [];
let coaAccounts = [];
let bankAccounts = [];

// Dropdown instances
let tbFiscalYearDropdown = null;
let plFiscalYearDropdown = null;
let bsFiscalYearDropdown = null;
let cfFiscalYearDropdown = null;
let ledgerAccountDropdown = null;
let cashBookBankDropdown = null;

// Flatpickr instances
let ledgerFromPicker = null;
let ledgerToPicker = null;
let dayBookPicker = null;
let cashBookFromPicker = null;
let cashBookToPicker = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('reports', '../')) return;

    const tabNames = {
        'trial-balance': 'Trial Balance',
        'profit-loss': 'Profit & Loss',
        'balance-sheet': 'Balance Sheet',
        'cash-flow': 'Cash Flow',
        'account-ledger': 'Account Ledger',
        'day-book': 'Day Book',
        'cash-book': 'Cash Book',
        'ar-aging-report': 'AR Aging',
        'ap-aging-report': 'AP Aging'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    initDatePickers();
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    // Tabs load on-demand via Generate button; no auto-load needed
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        const [fyRes, coaRes, bankRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('fiscal/years'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => [])
        ]);
        fiscalYears = Array.isArray(fyRes) ? fyRes : (fyRes?.data || fyRes?.items || []);
        coaAccounts = Array.isArray(coaRes) ? coaRes : (coaRes?.data || coaRes?.items || []);
        bankAccounts = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);
    } catch (err) {
        console.error('[Reports] loadInitialData error:', err);
    }
}

// ============================================================================
// DROPDOWNS
// ============================================================================

function initDropdowns() {
    const fyOptions = fiscalYears.map(fy => ({
        value: fy.id,
        label: fy.name || `${fy.start_date} - ${fy.end_date}`
    }));

    const accountOptions = coaAccounts.map(a => ({
        value: a.id,
        label: `${a.account_code ? a.account_code + ' - ' : ''}${a.account_name || a.name || ''}`
    }));

    const bankOptions = bankAccounts.map(b => ({
        value: b.id,
        label: b.account_name || b.name || `${b.bank_name} - ${b.account_number}`
    }));

    // FY dropdowns for each financial statement tab
    tbFiscalYearDropdown = new SearchableDropdown('tbFiscalYearContainer', {
        placeholder: 'Select Fiscal Year',
        options: fyOptions
    });

    plFiscalYearDropdown = new SearchableDropdown('plFiscalYearContainer', {
        placeholder: 'Select Fiscal Year',
        options: fyOptions
    });

    bsFiscalYearDropdown = new SearchableDropdown('bsFiscalYearContainer', {
        placeholder: 'Select Fiscal Year',
        options: fyOptions
    });

    cfFiscalYearDropdown = new SearchableDropdown('cfFiscalYearContainer', {
        placeholder: 'Select Fiscal Year',
        options: fyOptions
    });

    // Account selector for ledger
    ledgerAccountDropdown = new SearchableDropdown('ledgerAccountContainer', {
        placeholder: 'Select Account',
        options: accountOptions
    });

    // Bank account selector for cash book
    cashBookBankDropdown = new SearchableDropdown('cashBookBankContainer', {
        placeholder: 'Select Bank Account',
        options: bankOptions
    });
}

// ============================================================================
// DATE PICKERS
// ============================================================================

function initDatePickers() {
    const fpConfig = { dateFormat: 'Y-m-d', allowInput: true };

    const initWhenReady = () => {
        if (typeof flatpickr !== 'function') {
            setTimeout(initWhenReady, 200);
            return;
        }
        ledgerFromPicker = flatpickr('#ledgerFromDate', fpConfig);
        ledgerToPicker = flatpickr('#ledgerToDate', fpConfig);
        dayBookPicker = flatpickr('#dayBookDate', { ...fpConfig, defaultDate: 'today' });
        cashBookFromPicker = flatpickr('#cashBookFromDate', fpConfig);
        cashBookToPicker = flatpickr('#cashBookToDate', fpConfig);
    };
    initWhenReady();
}

// ============================================================================
// REPORT LOADERS
// ============================================================================

async function loadTrialBalance() {
    const fyId = tbFiscalYearDropdown?.getValue?.();
    if (!fyId) { Toast.error('Please select a fiscal year'); return; }

    try {
        const url = AccountsCommon.buildUrl('reports/trial-balance', { fiscalYearId: fyId });
        const data = await api.request(url);
        const fy = fiscalYears.find(f => f.id === fyId);
        document.getElementById('trialBalancePeriod').textContent = fy ? (fy.name || `${fy.start_date} to ${fy.end_date}`) : '';
        renderTrialBalanceReport(data);
    } catch (err) {
        console.error('[Reports] loadTrialBalance error:', err);
        Toast.error('Failed to generate Trial Balance');
    }
}

async function loadProfitLoss() {
    const fyId = plFiscalYearDropdown?.getValue?.();
    if (!fyId) { Toast.error('Please select a fiscal year'); return; }

    const compareTo = document.getElementById('plCompareTo')?.value || 'none';
    try {
        const params = { fiscalYearId: fyId };
        if (compareTo && compareTo !== 'none') params.compareTo = compareTo;
        const url = AccountsCommon.buildUrl('reports/profit-loss', params);
        const data = await api.request(url);
        const fy = fiscalYears.find(f => f.id === fyId);
        document.getElementById('profitLossPeriod').textContent = fy ? (fy.name || `${fy.start_date} to ${fy.end_date}`) : '';
        renderProfitLossReport(data);
    } catch (err) {
        console.error('[Reports] loadProfitLoss error:', err);
        Toast.error('Failed to generate Profit & Loss');
    }
}

async function loadBalanceSheet() {
    const fyId = bsFiscalYearDropdown?.getValue?.();
    if (!fyId) { Toast.error('Please select a fiscal year'); return; }

    const compareTo = document.getElementById('bsCompareTo')?.value || 'none';
    try {
        const params = { fiscalYearId: fyId };
        if (compareTo && compareTo !== 'none') params.compareTo = compareTo;
        const url = AccountsCommon.buildUrl('reports/balance-sheet', params);
        const data = await api.request(url);
        const fy = fiscalYears.find(f => f.id === fyId);
        document.getElementById('balanceSheetPeriod').textContent = fy ? (fy.name || `${fy.start_date} to ${fy.end_date}`) : '';
        renderBalanceSheetReport(data);
    } catch (err) {
        console.error('[Reports] loadBalanceSheet error:', err);
        Toast.error('Failed to generate Balance Sheet');
    }
}

async function loadCashFlow() {
    const fyId = cfFiscalYearDropdown?.getValue?.();
    if (!fyId) { Toast.error('Please select a fiscal year'); return; }

    try {
        const url = AccountsCommon.buildUrl('reports/cash-flow', { fiscalYearId: fyId });
        const data = await api.request(url);
        const fy = fiscalYears.find(f => f.id === fyId);
        document.getElementById('cashFlowPeriod').textContent = fy ? (fy.name || `${fy.start_date} to ${fy.end_date}`) : '';
        renderCashFlowReport(data);
    } catch (err) {
        console.error('[Reports] loadCashFlow error:', err);
        Toast.error('Failed to generate Cash Flow Statement');
    }
}

async function loadAccountLedger() {
    const accountId = ledgerAccountDropdown?.getValue?.();
    if (!accountId) { Toast.error('Please select an account'); return; }

    const fromDate = document.getElementById('ledgerFromDate')?.value || '';
    const toDate = document.getElementById('ledgerToDate')?.value || '';

    try {
        const url = AccountsCommon.buildUrl('reports/ledger', { accountId, fromDate, toDate });
        const data = await api.request(url);
        const acct = coaAccounts.find(a => a.id === accountId);
        document.getElementById('ledgerTitle').textContent = acct ? `Ledger: ${acct.account_code ? acct.account_code + ' - ' : ''}${acct.account_name || acct.name || ''}` : 'Account Ledger';
        document.getElementById('ledgerPeriod').textContent = fromDate && toDate ? `${fromDate} to ${toDate}` : '';
        renderLedgerReport(data);
    } catch (err) {
        console.error('[Reports] loadAccountLedger error:', err);
        Toast.error('Failed to generate Account Ledger');
    }
}

async function loadDayBook() {
    const date = document.getElementById('dayBookDate')?.value || '';
    if (!date) { Toast.error('Please select a date'); return; }

    try {
        const url = AccountsCommon.buildUrl('reports/day-book', { date });
        const data = await api.request(url);
        document.getElementById('dayBookPeriod').textContent = AccountsCommon.formatDate(date);
        renderDayBookReport(data);
    } catch (err) {
        console.error('[Reports] loadDayBook error:', err);
        Toast.error('Failed to generate Day Book');
    }
}

async function loadCashBook() {
    const bankAccountId = cashBookBankDropdown?.getValue?.();
    if (!bankAccountId) { Toast.error('Please select a bank account'); return; }

    const fromDate = document.getElementById('cashBookFromDate')?.value || '';
    const toDate = document.getElementById('cashBookToDate')?.value || '';

    try {
        const url = AccountsCommon.buildUrl('reports/cash-book', { bankAccountId, fromDate, toDate });
        const data = await api.request(url);
        const bank = bankAccounts.find(b => b.id === bankAccountId);
        document.getElementById('cashBookTitle').textContent = bank ? `Cash Book: ${bank.account_name || bank.name}` : 'Cash Book';
        document.getElementById('cashBookPeriod').textContent = fromDate && toDate ? `${fromDate} to ${toDate}` : '';
        renderCashBookReport(data);
    } catch (err) {
        console.error('[Reports] loadCashBook error:', err);
        Toast.error('Failed to generate Cash Book');
    }
}

async function loadARAgingReport() {
    try {
        const url = AccountsCommon.buildUrl('reports/ar-aging');
        const data = await api.request(url);
        document.getElementById('arAgingPeriod').textContent = `As of ${AccountsCommon.formatDate(new Date().toISOString())}`;
        renderAgingReport(data, 'ar');
    } catch (err) {
        console.error('[Reports] loadARAgingReport error:', err);
        Toast.error('Failed to generate AR Aging Report');
    }
}

async function loadAPAgingReport() {
    try {
        const url = AccountsCommon.buildUrl('reports/ap-aging');
        const data = await api.request(url);
        document.getElementById('apAgingPeriod').textContent = `As of ${AccountsCommon.formatDate(new Date().toISOString())}`;
        renderAgingReport(data, 'ap');
    } catch (err) {
        console.error('[Reports] loadAPAgingReport error:', err);
        Toast.error('Failed to generate AP Aging Report');
    }
}

// ============================================================================
// EXPORT
// ============================================================================

async function exportReport(reportType, format) {
    try {
        // Use direct fetch for binary responses — api.request() auto-parses
        // responses as JSON/text which corrupts PDF/CSV downloads.
        const baseUrl = api._getBaseUrl('/accounts/');
        const tenantId = AccountsCommon.getTenantId();
        const url = `${baseUrl}/accounts/reports/export/${reportType}?format=${format}&tenantId=${tenantId}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${api.token}` }
        });
        if (!response.ok) throw new Error(`Export failed: ${response.status}`);

        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${reportType}-report.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        Toast.success(`${format.toUpperCase()} exported successfully`);
    } catch (err) {
        console.error('[Reports] exportReport error:', err);
        Toast.error(`Failed to export ${format.toUpperCase()}`);
    }
}

// ============================================================================
// RENDER HELPERS
// ============================================================================

function fmt(amount) {
    return AccountsCommon.formatCurrency(amount);
}

function esc(text) {
    return AccountsCommon.escapeHtml(text);
}

// ---- Trial Balance ----

function renderTrialBalanceReport(data) {
    const container = document.getElementById('trialBalanceContent');
    const items = Array.isArray(data) ? data : (data?.rows || data?.items || data?.accounts || []);

    if (!items.length) {
        container.innerHTML = '<div class="empty-message"><p>No data available for the selected period</p></div>';
        return;
    }

    let totalDebit = data.total_debit || 0, totalCredit = data.total_credit || 0;
    if (!totalDebit && !totalCredit) {
        items.forEach(item => { totalDebit += parseFloat(item.debit_balance || item.debit || 0); totalCredit += parseFloat(item.credit_balance || item.credit || 0); });
    }
    const rows = items.map(item => {
        const debit = parseFloat(item.debit_balance || item.debit || 0);
        const credit = parseFloat(item.credit_balance || item.credit || 0);
        return `<tr>
            <td>${esc(item.account_code || item.code || '')}</td>
            <td>${esc(item.account_name || item.name)}</td>
            <td class="amount">${debit ? fmt(debit) : '-'}</td>
            <td class="amount">${credit ? fmt(credit) : '-'}</td>
        </tr>`;
    }).join('');

    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
    container.innerHTML = `
        <div class="data-table-container">
            <table class="data-table report-table">
                <thead>
                    <tr><th>Account Code</th><th>Account Name</th><th class="amount">Debit</th><th class="amount">Credit</th></tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="2"><strong>Total</strong></td>
                        <td class="amount"><strong>${fmt(totalDebit)}</strong></td>
                        <td class="amount"><strong>${fmt(totalCredit)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
        <div class="report-footer ${balanced ? 'balanced' : 'unbalanced'}">
            ${balanced ? 'Trial Balance is balanced' : 'WARNING: Trial Balance is NOT balanced (difference: ' + fmt(Math.abs(totalDebit - totalCredit)) + ')'}
        </div>`;
}

// ---- Profit & Loss ----

// Direction-aware variance color. For Income accounts a positive variance (earning more)
// is favorable → green. For Expense accounts a positive variance (spending more) is
// unfavorable → red. Matches the rule used in budgets.js.
function varianceColor(variance, isExpense) {
    const v = parseFloat(variance || 0);
    if (v === 0) return 'var(--text-secondary)';
    const favorable = isExpense ? v < 0 : v > 0;
    return favorable ? 'var(--color-success)' : 'var(--color-error)';
}

/**
 * Render a variance percentage cell.
 * - If the comparison was non-zero → show signed percentage (e.g. "+62.7%")
 * - If the comparison was zero AND current is non-zero → show "NEW"
 *   (backend correctly returns null in this case to avoid divide-by-zero;
 *   the UI interprets that as "didn't exist in comparison window")
 * - If both were zero → "—"
 *
 * The `comparison` and `current` params are optional; if omitted we fall
 * back to the legacy behavior of showing "-" for null (keeps backward
 * compatibility for any callers that haven't been updated).
 */
function fmtVariancePct(pct, current, comparison) {
    if (pct === null || pct === undefined || pct === '') {
        // Prior was zero — interpret via current/comparison values
        if (current !== undefined && comparison !== undefined) {
            const curNum = parseFloat(current) || 0;
            const cmpNum = parseFloat(comparison) || 0;
            if (cmpNum === 0 && curNum !== 0) return 'NEW';
            if (cmpNum === 0 && curNum === 0) return '—';
        }
        return '-';
    }
    const n = parseFloat(pct);
    if (!isFinite(n)) return '-';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(1)}%`;
}

function renderProfitLossReport(data) {
    const container = document.getElementById('profitLossContent');
    if (!data) { container.innerHTML = '<div class="empty-message"><p>No data available</p></div>'; return; }

    const hasComparison = !!data.compare_to && data.compare_to !== 'none';

    // Backend returns { sections: [{account_type, accounts: [{account_code, account_name, balance, comparison_balance, variance, variance_percentage}]}], total_revenue, ... }
    const sections = data.sections || [];
    const incomeSection = sections.find(s => (s.account_type || '').toLowerCase().includes('income') || (s.account_type || '').toLowerCase().includes('revenue'));
    const expenseSection = sections.find(s => (s.account_type || '').toLowerCase().includes('expense'));
    const revenue = incomeSection?.accounts || data.revenue || data.income || [];
    const expenses = expenseSection?.accounts || data.expenses || [];
    const totalRevenue = parseFloat(data.total_revenue || data.total_income || 0);
    const totalExpenses = parseFloat(data.total_expenses || 0);
    const netProfit = parseFloat(data.net_profit ?? (totalRevenue - totalExpenses));

    const colSpan = hasComparison ? 6 : 2;

    const renderSection = (items, label, isExpense) => {
        if (!items.length) return `<tr class="section-header"><td colspan="${colSpan}"><strong>${esc(label)}</strong></td></tr>
            <tr><td colspan="${colSpan}" style="padding-left:2rem;color:var(--text-secondary);">No items</td></tr>`;
        const rows = items.map(i => {
            const code = esc(i.account_code || '');
            const name = esc(i.account_name || i.name || '');
            const bal = parseFloat(i.amount || i.balance || 0);
            if (!hasComparison) {
                return `<tr>
                    <td style="padding-left:2rem;">${name}</td>
                    <td class="amount">${fmt(bal)}</td>
                </tr>`;
            }
            const cmp = parseFloat(i.comparison_balance || 0);
            const variance = parseFloat(i.variance ?? (bal - cmp));
            const varPct = i.variance_percentage;
            const vcolor = varianceColor(variance, isExpense);
            return `<tr>
                <td>${code}</td>
                <td>${name}</td>
                <td class="amount">${fmt(bal)}</td>
                <td class="amount">${fmt(cmp)}</td>
                <td class="amount" style="color:${vcolor};">${fmt(variance)}</td>
                <td class="amount" style="color:${vcolor};">${fmtVariancePct(varPct, bal, cmp)}</td>
            </tr>`;
        }).join('');
        return `<tr class="section-header"><td colspan="${colSpan}"><strong>${esc(label)}</strong></td></tr>${rows}`;
    };

    // Headers
    const headerRow = hasComparison
        ? `<tr>
              <th>Code</th>
              <th>Account Name</th>
              <th class="amount">Current</th>
              <th class="amount">Comparison</th>
              <th class="amount">Variance</th>
              <th class="amount">Variance %</th>
           </tr>`
        : `<tr><th>Particulars</th><th class="amount">Amount</th></tr>`;

    // Subtotals
    const revCmp = parseFloat(data.total_revenue_comparison || 0);
    const expCmp = parseFloat(data.total_expenses_comparison || 0);
    const netCmp = parseFloat(data.net_profit_comparison || 0);
    const revVar = parseFloat(data.total_revenue_variance ?? (totalRevenue - revCmp));
    const expVar = parseFloat(data.total_expenses_variance ?? (totalExpenses - expCmp));
    const netVar = parseFloat(data.net_profit_variance ?? (netProfit - netCmp));

    const revVColor = varianceColor(revVar, false);
    const expVColor = varianceColor(expVar, true);
    const netVColor = netVar >= 0 ? 'var(--color-success)' : 'var(--color-error)';

    const subtotalRow = (label, current, cmp, variance, varPct, color) => {
        if (!hasComparison) {
            return `<tr class="subtotal-row"><td><strong>${label}</strong></td><td class="amount"><strong>${fmt(current)}</strong></td></tr>`;
        }
        return `<tr class="subtotal-row">
            <td colspan="2"><strong>${label}</strong></td>
            <td class="amount"><strong>${fmt(current)}</strong></td>
            <td class="amount"><strong>${fmt(cmp)}</strong></td>
            <td class="amount" style="color:${color};"><strong>${fmt(variance)}</strong></td>
            <td class="amount" style="color:${color};"><strong>${fmtVariancePct(varPct, current, cmp)}</strong></td>
        </tr>`;
    };

    const totalRow = hasComparison
        ? `<tr class="total-row ${netProfit >= 0 ? 'profit' : 'loss'}">
               <td colspan="2"><strong>${netProfit >= 0 ? 'Net Profit' : 'Net Loss'}</strong></td>
               <td class="amount"><strong>${fmt(Math.abs(netProfit))}</strong></td>
               <td class="amount"><strong>${fmt(Math.abs(netCmp))}</strong></td>
               <td class="amount" style="color:${netVColor};"><strong>${fmt(netVar)}</strong></td>
               <td class="amount" style="color:${netVColor};"><strong>${fmtVariancePct(data.net_profit_variance_percentage, netProfit, netCmp)}</strong></td>
           </tr>`
        : `<tr class="total-row ${netProfit >= 0 ? 'profit' : 'loss'}">
               <td><strong>${netProfit >= 0 ? 'Net Profit' : 'Net Loss'}</strong></td>
               <td class="amount"><strong>${fmt(Math.abs(netProfit))}</strong></td>
           </tr>`;

    const comparisonBanner = hasComparison && data.comparison_label
        ? `<div class="report-note" style="margin-bottom:0.5rem;">Comparison: <strong>${esc(data.comparison_label)}</strong></div>`
        : '';

    container.innerHTML = `
        ${comparisonBanner}
        <div class="data-table-container">
            <table class="data-table report-table">
                <thead>${headerRow}</thead>
                <tbody>
                    ${renderSection(revenue, 'Revenue / Income', false)}
                    ${subtotalRow('Total Revenue', totalRevenue, revCmp, revVar, data.total_revenue_variance_percentage, revVColor)}
                    ${renderSection(expenses, 'Expenses', true)}
                    ${subtotalRow('Total Expenses', totalExpenses, expCmp, expVar, data.total_expenses_variance_percentage, expVColor)}
                </tbody>
                <tfoot>
                    ${totalRow}
                </tfoot>
            </table>
        </div>`;
}

// ---- Balance Sheet ----

function renderBalanceSheetReport(data) {
    const container = document.getElementById('balanceSheetContent');
    if (!data) { container.innerHTML = '<div class="empty-message"><p>No data available</p></div>'; return; }

    const hasComparison = !!data.compare_to && data.compare_to !== 'none';

    // Backend returns { sections: [{account_type, accounts}], total_assets, total_liabilities, total_equity, current_year_pl, ... }
    const sections = data.sections || [];
    const assets = sections.find(s => (s.account_type || '').toLowerCase().includes('asset'))?.accounts || data.assets || [];
    const liabilities = sections.find(s => (s.account_type || '').toLowerCase().includes('liabilit'))?.accounts || data.liabilities || [];
    const equity = sections.find(s => (s.account_type || '').toLowerCase().includes('equity'))?.accounts || data.equity || [];
    const totalAssets = parseFloat(data.total_assets || 0);
    const totalLiabilities = parseFloat(data.total_liabilities || 0);
    const totalEquity = parseFloat(data.total_equity || 0) + parseFloat(data.current_year_pl || 0);
    const liabEquity = totalLiabilities + totalEquity;

    const colSpan = hasComparison ? 6 : 2;

    // For Balance Sheet: Assets growing is favorable (green), Liabilities growing is
    // unfavorable (red). Equity growing is favorable.
    const sectionIsUnfavorableWhenUp = (label) => label === 'Liabilities';

    const renderSection = (items, label) => {
        const isUnfavUp = sectionIsUnfavorableWhenUp(label);
        const rows = items.map(i => {
            const code = esc(i.account_code || '');
            const name = esc(i.account_name || i.name || '');
            const bal = parseFloat(i.amount || i.balance || 0);
            if (!hasComparison) {
                return `<tr>
                    <td style="padding-left:2rem;">${name}</td>
                    <td class="amount">${fmt(bal)}</td>
                </tr>`;
            }
            const cmp = parseFloat(i.comparison_balance || 0);
            const variance = parseFloat(i.variance ?? (bal - cmp));
            const varPct = i.variance_percentage;
            const vcolor = varianceColor(variance, isUnfavUp);
            return `<tr>
                <td>${code}</td>
                <td>${name}</td>
                <td class="amount">${fmt(bal)}</td>
                <td class="amount">${fmt(cmp)}</td>
                <td class="amount" style="color:${vcolor};">${fmt(variance)}</td>
                <td class="amount" style="color:${vcolor};">${fmtVariancePct(varPct, bal, cmp)}</td>
            </tr>`;
        }).join('');
        return `<tr class="section-header"><td colspan="${colSpan}"><strong>${esc(label)}</strong></td></tr>
            ${rows || `<tr><td colspan="${colSpan}" style="padding-left:2rem;color:var(--text-secondary);">No items</td></tr>`}`;
    };

    const headerRow = hasComparison
        ? `<tr>
              <th>Code</th>
              <th>Account Name</th>
              <th class="amount">Current</th>
              <th class="amount">Comparison</th>
              <th class="amount">Variance</th>
              <th class="amount">Variance %</th>
           </tr>`
        : `<tr><th>Particulars</th><th class="amount">Amount</th></tr>`;

    const assetsCmp = parseFloat(data.total_assets_comparison || 0);
    const liabCmp = parseFloat(data.total_liabilities_comparison || 0);
    const equityCmp = parseFloat(data.total_equity_comparison || 0);
    const assetsVar = parseFloat(data.total_assets_variance ?? (totalAssets - assetsCmp));
    const liabVar = parseFloat(data.total_liabilities_variance ?? (totalLiabilities - liabCmp));
    const equityVar = parseFloat(data.total_equity_variance ?? (totalEquity - equityCmp));

    const assetsColor = varianceColor(assetsVar, false);
    const liabColor = varianceColor(liabVar, true);
    const equityColor = varianceColor(equityVar, false);

    const subtotalRow = (label, current, cmp, variance, varPct, color) => {
        if (!hasComparison) {
            return `<tr class="subtotal-row"><td><strong>${label}</strong></td><td class="amount"><strong>${fmt(current)}</strong></td></tr>`;
        }
        return `<tr class="subtotal-row">
            <td colspan="2"><strong>${label}</strong></td>
            <td class="amount"><strong>${fmt(current)}</strong></td>
            <td class="amount"><strong>${fmt(cmp)}</strong></td>
            <td class="amount" style="color:${color};"><strong>${fmt(variance)}</strong></td>
            <td class="amount" style="color:${color};"><strong>${fmtVariancePct(varPct, current, cmp)}</strong></td>
        </tr>`;
    };

    const totalRow = hasComparison
        ? `<tr class="total-row">
               <td colspan="2"><strong>Liabilities + Equity</strong></td>
               <td class="amount"><strong>${fmt(liabEquity)}</strong></td>
               <td class="amount"><strong>${fmt(liabCmp + equityCmp)}</strong></td>
               <td class="amount"><strong>${fmt(liabVar + equityVar)}</strong></td>
               <td class="amount">—</td>
           </tr>`
        : `<tr class="total-row"><td><strong>Liabilities + Equity</strong></td><td class="amount"><strong>${fmt(liabEquity)}</strong></td></tr>`;

    const comparisonBanner = hasComparison && data.comparison_label
        ? `<div class="report-note" style="margin-bottom:0.5rem;">Comparison as at: <strong>${esc(data.comparison_label)}</strong></div>`
        : '';

    const balanced = Math.abs(totalAssets - liabEquity) < 0.01;
    container.innerHTML = `
        ${comparisonBanner}
        <div class="data-table-container">
            <table class="data-table report-table">
                <thead>${headerRow}</thead>
                <tbody>
                    ${renderSection(assets, 'Assets')}
                    ${subtotalRow('Total Assets', totalAssets, assetsCmp, assetsVar, data.total_assets_variance_percentage, assetsColor)}
                    ${renderSection(liabilities, 'Liabilities')}
                    ${subtotalRow('Total Liabilities', totalLiabilities, liabCmp, liabVar, data.total_liabilities_variance_percentage, liabColor)}
                    ${renderSection(equity, 'Equity')}
                    ${subtotalRow('Total Equity', totalEquity, equityCmp, equityVar, data.total_equity_variance_percentage, equityColor)}
                </tbody>
                <tfoot>
                    ${totalRow}
                </tfoot>
            </table>
        </div>
        <div class="report-footer ${balanced ? 'balanced' : 'unbalanced'}">
            ${balanced ? 'Assets = Liabilities + Equity (Balanced)' : 'WARNING: Assets (' + fmt(totalAssets) + ') != Liabilities + Equity (' + fmt(liabEquity) + ')'}
        </div>`;
}

// ---- Cash Flow ----

function renderCashFlowReport(data) {
    const container = document.getElementById('cashFlowContent');
    if (!data) { container.innerHTML = '<div class="empty-message"><p>No data available</p></div>'; return; }

    // Backend returns { operating_activities: {items, total}, investing_activities: {items, total}, financing_activities: {items, total}, net_cash_change }
    const opSection = data.operating_activities || {};
    const invSection = data.investing_activities || {};
    const finSection = data.financing_activities || {};
    const operating = opSection.items || data.operating || [];
    const investing = invSection.items || data.investing || [];
    const financing = finSection.items || data.financing || [];
    const totalOperating = parseFloat(opSection.total || data.total_operating || 0);
    const totalInvesting = parseFloat(invSection.total || data.total_investing || 0);
    const totalFinancing = parseFloat(finSection.total || data.total_financing || 0);
    const netChange = parseFloat(data.net_cash_change ?? data.net_change ?? (totalOperating + totalInvesting + totalFinancing));

    const renderSection = (items, label, total) => {
        const rows = items.map(i => `<tr>
            <td style="padding-left:2rem;">${esc(i.reference_type || i.description || i.name || '')}</td>
            <td class="amount">${fmt(i.cash_impact || i.amount || 0)}</td>
        </tr>`).join('');
        return `<tr class="section-header"><td colspan="2"><strong>${esc(label)}</strong></td></tr>
            ${rows || '<tr><td colspan="2" style="padding-left:2rem;color:var(--text-secondary);">No items</td></tr>'}
            <tr class="subtotal-row"><td><strong>Net ${esc(label)}</strong></td><td class="amount"><strong>${fmt(total)}</strong></td></tr>`;
    };

    container.innerHTML = `
        <div class="data-table-container">
            <table class="data-table report-table">
                <thead><tr><th>Particulars</th><th class="amount">Amount</th></tr></thead>
                <tbody>
                    ${renderSection(operating, 'Operating Activities', totalOperating)}
                    ${renderSection(investing, 'Investing Activities', totalInvesting)}
                    ${renderSection(financing, 'Financing Activities', totalFinancing)}
                </tbody>
                <tfoot>
                    <tr class="total-row">
                        <td><strong>Net Change in Cash</strong></td>
                        <td class="amount"><strong>${fmt(netChange)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

// ---- Account Ledger ----

function renderLedgerReport(data) {
    const container = document.getElementById('ledgerContent');
    const items = Array.isArray(data) ? data : (data?.entries || data?.items || []);

    if (!items.length) {
        container.innerHTML = '<div class="empty-message"><p>No transactions found for the selected criteria</p></div>';
        return;
    }

    let runningBalance = parseFloat(data?.opening_balance || 0);
    const rows = items.map(item => {
        const debit = parseFloat(item.debit_amount || item.debit || 0);
        const credit = parseFloat(item.credit_amount || item.credit || 0);
        // Use backend running_balance if available, otherwise compute
        if (item.running_balance != null) runningBalance = parseFloat(item.running_balance);
        else runningBalance += debit - credit;
        return `<tr>
            <td>${AccountsCommon.formatDate(item.entry_date || item.date || item.transaction_date)}</td>
            <td>${esc(item.description || item.narration || item.entry_number || '')}</td>
            <td class="amount">${debit ? fmt(debit) : '-'}</td>
            <td class="amount">${credit ? fmt(credit) : '-'}</td>
            <td class="amount">${fmt(runningBalance)}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        ${data?.opening_balance != null ? `<div class="report-note">Opening Balance: <strong>${fmt(data.opening_balance)}</strong></div>` : ''}
        <div class="data-table-container">
            <table class="data-table report-table">
                <thead>
                    <tr><th>Date</th><th>Description</th><th class="amount">Debit</th><th class="amount">Credit</th><th class="amount">Balance</th></tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="2"><strong>Closing Balance</strong></td>
                        <td></td><td></td>
                        <td class="amount"><strong>${fmt(runningBalance)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

// ---- Day Book ----

function renderDayBookReport(data) {
    const container = document.getElementById('dayBookContent');
    const items = Array.isArray(data) ? data : (data?.entries || data?.items || []);

    if (!items.length) {
        container.innerHTML = '<div class="empty-message"><p>No entries found for the selected date</p></div>';
        return;
    }

    let totalDebit = 0, totalCredit = 0;
    const rows = items.map(item => {
        const debit = parseFloat(item.total_debit || item.debit || 0);
        const credit = parseFloat(item.total_credit || item.credit || 0);
        totalDebit += debit;
        totalCredit += credit;
        return `<tr>
            <td>${esc(item.entry_number || item.voucher_number || item.reference || '')}</td>
            <td>${esc(item.journal_type || item.account_name || item.name || '')}</td>
            <td>${esc(item.description || item.narration || '')}</td>
            <td class="amount">${debit ? fmt(debit) : '-'}</td>
            <td class="amount">${credit ? fmt(credit) : '-'}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="data-table-container">
            <table class="data-table report-table">
                <thead>
                    <tr><th>Voucher #</th><th>Account</th><th>Description</th><th class="amount">Debit</th><th class="amount">Credit</th></tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="3"><strong>Total</strong></td>
                        <td class="amount"><strong>${fmt(totalDebit)}</strong></td>
                        <td class="amount"><strong>${fmt(totalCredit)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

// ---- Cash Book ----

function renderCashBookReport(data) {
    const container = document.getElementById('cashBookContent');
    const items = Array.isArray(data) ? data : (data?.entries || data?.items || []);

    if (!items.length) {
        container.innerHTML = '<div class="empty-message"><p>No transactions found for the selected criteria</p></div>';
        return;
    }

    let runningBalance = parseFloat(data?.opening_balance || 0);
    const rows = items.map(item => {
        // Backend returns {type: 'deposit'|'withdrawal'|'transfer_in'|'transfer_out', amount}
        const amt = parseFloat(item.amount || 0);
        const isReceipt = item.type === 'deposit' || item.type === 'transfer_in';
        const isPayment = item.type === 'withdrawal' || item.type === 'transfer_out';
        const receipt = isReceipt ? amt : parseFloat(item.receipt || item.debit || 0);
        const payment = isPayment ? amt : parseFloat(item.payment || item.credit || 0);
        runningBalance += receipt - payment;
        return `<tr>
            <td>${AccountsCommon.formatDate(item.date || item.transaction_date)}</td>
            <td>${esc(item.description || item.narration || item.reference || '')}</td>
            <td class="amount">${receipt ? fmt(receipt) : '-'}</td>
            <td class="amount">${payment ? fmt(payment) : '-'}</td>
            <td class="amount">${fmt(runningBalance)}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        ${data?.opening_balance != null ? `<div class="report-note">Opening Balance: <strong>${fmt(data.opening_balance)}</strong></div>` : ''}
        <div class="data-table-container">
            <table class="data-table report-table">
                <thead>
                    <tr><th>Date</th><th>Description</th><th class="amount">Receipts</th><th class="amount">Payments</th><th class="amount">Balance</th></tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="2"><strong>Closing Balance</strong></td>
                        <td></td><td></td>
                        <td class="amount"><strong>${fmt(runningBalance)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

// ---- Aging Reports (AR / AP) ----

function renderAgingReport(data, type) {
    const containerId = type === 'ar' ? 'arAgingContent' : 'apAgingContent';
    const container = document.getElementById(containerId);
    const items = Array.isArray(data) ? data : (data?.items || data?.parties || []);
    const partyLabel = type === 'ar' ? 'Customer' : 'Vendor';

    if (!items.length) {
        container.innerHTML = `<div class="empty-message"><p>No ${type === 'ar' ? 'receivables' : 'payables'} aging data found</p></div>`;
        return;
    }

    // Backend returns: current_amount, days_30, days_60, days_90, days_120_plus, total
    const buckets = ['current_amount', 'days_30', 'days_60', 'days_90', 'days_120_plus'];
    const bucketLabels = ['Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'];
    const totals = { current_amount: 0, days_30: 0, days_60: 0, days_90: 0, days_120_plus: 0, total: 0 };

    const rows = items.map(item => {
        const total = parseFloat(item.total || 0);
        totals.total += total;
        const cells = buckets.map(b => {
            const val = parseFloat(item[b] || 0);
            totals[b] += val;
            const cls = b === 'days_120_plus' && val > 0 ? ' overdue-severe' : (b === 'days_90' && val > 0 ? ' overdue-warn' : '');
            return `<td class="amount${cls}">${val ? fmt(val) : '-'}</td>`;
        }).join('');
        const partyName = item.customer_name || item.vendor_name || item.party_name || item.name || '';
        return `<tr>
            <td>${esc(partyName)}</td>
            ${cells}
            <td class="amount"><strong>${fmt(total)}</strong></td>
        </tr>`;
    }).join('');

    const totalCells = buckets.map(b => `<td class="amount"><strong>${fmt(totals[b])}</strong></td>`).join('');

    container.innerHTML = `
        <div class="data-table-container">
            <table class="data-table report-table">
                <thead>
                    <tr>
                        <th>${partyLabel}</th>
                        ${bucketLabels.map(l => `<th class="amount">${l}</th>`).join('')}
                        <th class="amount">Total</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="total-row">
                        <td><strong>Total</strong></td>
                        ${totalCells}
                        <td class="amount"><strong>${fmt(totals.total)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}
