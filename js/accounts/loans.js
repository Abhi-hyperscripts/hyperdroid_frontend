/**
 * Loans page — term loans with reducing-balance EMI schedules.
 * Backend: /api/accounts/loans (list/get/create, installments/pay). Create + pay are ADMIN-only.
 */

let loansList = [];
let loansPage = 1;   // server-side pagination
let loansTotal = 0;
const PAGE_SIZE = 50;
let accountsList = [];
let bankAccountsList = [];
let loanViewCurrent = null;

let loanAccountDropdown = null;
let interestAccountDropdown = null;
let bankAccountDropdown = null;
let disbursementAccountDropdown = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!await AccountsCommon.initPage('loans', '../')) return;

    const tabNames = { 'loan-list': 'Loan List' };
    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames);

    accountsRoles.applyRBAC();

    document.getElementById('loanStartDate').value = AccountsCommon.todayLocal();

    await Promise.all([loadLoans(), loadLookups()]);
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
});

function initDropdowns() {
    if (typeof SearchableDropdown === 'undefined') { setTimeout(initDropdowns, 100); return; }

    const acctOptions = accountsList.map(a => ({ value: a.id, label: `${a.account_code} — ${a.account_name}` }));
    // SearchableDropdown escapes option labels itself — pass raw text (no pre-escaping, else double-escaped).
    const bankOptions = bankAccountsList.map(b => ({ value: b.id, label: `${b.account_name}${b.bank_name ? ' (' + b.bank_name + ')' : ''}` }));

    loanAccountDropdown = new SearchableDropdown(document.getElementById('loanAccountContainer'), {
        options: acctOptions, placeholder: 'Select liability account...'
    });
    interestAccountDropdown = new SearchableDropdown(document.getElementById('interestAccountContainer'), {
        options: acctOptions, placeholder: 'Select interest expense account...'
    });
    disbursementAccountDropdown = new SearchableDropdown(document.getElementById('disbursementAccountContainer'), {
        options: acctOptions, placeholder: 'Select where the money landed...'
    });
    bankAccountDropdown = new SearchableDropdown(document.getElementById('bankAccountContainer'), {
        options: bankOptions, placeholder: 'Select bank account...'
    });
}

async function loadLookups() {
    try {
        const [coaRes, bankRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => [])
        ]);
        accountsList = (Array.isArray(coaRes) ? coaRes : (coaRes?.data || coaRes?.items || []))
            .filter(a => a.is_active !== false);
        bankAccountsList = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);
    } catch (err) {
        console.error('[Loans] loadLookups error:', err);
    }
}

async function loadLoans(page = loansPage) {
    try {
        loansPage = page;
        AccountsCommon.setTableLoading('loansTable', 8, 'Loading loans…');
        const params = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
        const res = await api.request(AccountsCommon.buildUrl('loans', params), { _skipSpinner: true });
        const env = Array.isArray(res) ? { data: res, total: res.length, stats: null } : (res || {});
        loansList = env.data || [];
        loansTotal = env.total ?? loansList.length;
        updateStats(env.stats);
        renderLoans();
    } catch (err) {
        console.error('[Loans] loadLoans error:', err);
        const tb = document.getElementById('loansTable');
        if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load loans</td></tr>';
    }
}

function updateStats(stats) {
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    if (stats) {
        el('statTotal', stats.total_count);
        el('statActive', stats.active_count);
        el('statOutstanding', AccountsCommon.formatCurrency(stats.total_outstanding));
    } else {
        el('statTotal', loansList.length);
        el('statActive', loansList.filter(l => l.status === 'active').length);
        el('statOutstanding', AccountsCommon.formatCurrency(loansList.reduce((s, l) => s + (parseFloat(l.outstanding_principal) || 0), 0)));
    }
}

function renderLoans() {
    const tb = document.getElementById('loansTable');
    if (!tb) return;
    if (!loansList.length) {
        tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-secondary);">No loans yet. Click "New Loan" to create one.</td></tr>';
        AccountsCommon.renderPagination('loansPagination', 1, 1, () => {});
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    const totalPages = Math.max(1, Math.ceil((loansTotal || loansList.length) / PAGE_SIZE));
    AccountsCommon.renderPagination('loansPagination', loansPage, totalPages, (p) => loadLoans(p));
    tb.innerHTML = loansList.map(l => {
        const statusClass = l.status === 'active' ? 'status-active' : (l.status === 'closed' ? 'status-pending' : 'status-rejected');
        return `<tr>
            <td>${AccountsCommon.escapeHtml(l.name || '')}</td>
            <td>${AccountsCommon.escapeHtml(l.lender_name || '-')}</td>
            <td>${AccountsCommon.formatCurrency(l.principal_amount)}</td>
            <td>${(parseFloat(l.annual_interest_rate) || 0).toFixed(2)}%</td>
            <td>${l.tenure_months || 0} mo</td>
            <td>${AccountsCommon.formatCurrency(l.outstanding_principal)}</td>
            <td><span class="badge ${statusClass}">${AccountsCommon.escapeHtml((l.status || '').replace(/\b\w/g, c => c.toUpperCase()))}</span></td>
            <td class="actions-cell">
                <button class="btn btn-sm btn-outline" onclick="viewLoan('${AccountsCommon.escJs(l.id)}')">View / Pay EMI</button>
            </td>
        </tr>`;
    }).join('');
}

function openCreateLoan() {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can create loans'); return; }
    ['loanName', 'loanLender', 'loanPrincipal', 'loanRate', 'loanTenure', 'loanEmi'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    document.getElementById('loanStartDate').value = AccountsCommon.todayLocal();
    loanAccountDropdown?.setValue?.('');
    interestAccountDropdown?.setValue?.('');
    bankAccountDropdown?.setValue?.('');
    disbursementAccountDropdown?.setValue?.('');
    AccountsCommon.showFormPage('loanModal');
}

async function saveLoan() {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can create loans'); return; }

    const name = document.getElementById('loanName').value.trim();
    const principal = parseFloat(document.getElementById('loanPrincipal').value);
    const rate = parseFloat(document.getElementById('loanRate').value);
    const tenure = parseInt(document.getElementById('loanTenure').value);
    const startDate = document.getElementById('loanStartDate').value;
    const emiRaw = document.getElementById('loanEmi').value.trim();
    const loanAccountId = loanAccountDropdown?.getValue?.();
    const interestAccountId = interestAccountDropdown?.getValue?.();
    const bankAccountId = bankAccountDropdown?.getValue?.();
    const disbursementAccountId = disbursementAccountDropdown?.getValue?.();

    if (!name) { Toast.error('Loan name is required'); return; }
    if (!(principal > 0)) { Toast.error('Principal amount must be greater than 0'); return; }
    if (!(rate >= 0)) { Toast.error('Annual interest rate is required'); return; }
    if (!(tenure > 0)) { Toast.error('Tenure (months) must be at least 1'); return; }
    if (!startDate) { Toast.error('Start date is required'); return; }
    if (!loanAccountId) { Toast.error('Select the loan liability account'); return; }
    if (!interestAccountId) { Toast.error('Select the interest expense account'); return; }
    if (loanAccountId === interestAccountId) { Toast.error('Loan liability and interest accounts must be different'); return; }
    if (!bankAccountId) { Toast.error('Select the bank account EMIs are paid from'); return; }
    if (!disbursementAccountId) { Toast.error('Select the disbursement account (where the money landed)'); return; }

    const payload = {
        name,
        lender_name: document.getElementById('loanLender').value.trim() || null,
        principal_amount: principal,
        annual_interest_rate: rate,
        tenure_months: tenure,
        start_date: startDate,
        emi_amount: emiRaw ? parseFloat(emiRaw) : null,
        loan_account_id: loanAccountId,
        interest_account_id: interestAccountId,
        bank_account_id: bankAccountId,
        disbursement_account_id: disbursementAccountId
    };

    if (!AccountsCommon.beginSubmit('saveLoan')) return;
    try {
        await api.request(AccountsCommon.buildUrl('loans'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Loan created — disbursement posted and EMI schedule generated');
        AccountsCommon.hideFormPage('loanModal');
        await loadLoans();
    } catch (err) {
        console.error('[Loans] saveLoan error:', err);
        Toast.error(err.message || 'Failed to create loan');
    } finally {
        AccountsCommon.endSubmit('saveLoan');
    }
}

async function viewLoan(id) {
    try {
        const loan = await api.request(AccountsCommon.buildUrl(`loans/${encodeURIComponent(id)}`), { _skipSpinner: true });
        loanViewCurrent = loan;
        renderLoanView(loan);
        AccountsCommon.showFormPage('loanViewModal');
    } catch (err) {
        console.error('[Loans] viewLoan error:', err);
        Toast.error(err.message || 'Failed to load loan');
    }
}

function renderLoanView(loan) {
    document.getElementById('loanViewTitle').textContent = `${loan.name} — Schedule`;
    document.getElementById('loanViewSummary').innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:1.5rem;">
            <div><div class="stat-label">Principal</div><div style="font-weight:600;">${AccountsCommon.formatCurrency(loan.principal_amount)}</div></div>
            <div><div class="stat-label">Rate</div><div style="font-weight:600;">${(parseFloat(loan.annual_interest_rate) || 0).toFixed(2)}% p.a.</div></div>
            <div><div class="stat-label">EMI</div><div style="font-weight:600;">${AccountsCommon.formatCurrency(loan.emi_amount)}</div></div>
            <div><div class="stat-label">Outstanding</div><div style="font-weight:600;">${AccountsCommon.formatCurrency(loan.outstanding_principal)}</div></div>
        </div>`;

    const schedule = loan.schedule || [];
    const isAdmin = accountsRoles.isAdmin();
    const firstPendingNo = Math.min(...schedule.filter(s => s.status !== 'paid').map(s => s.installment_number).concat([Infinity]));
    const tb = document.getElementById('scheduleTable');
    tb.innerHTML = schedule.map(s => {
        const paid = s.status === 'paid';
        const isNext = !paid && s.installment_number === firstPendingNo;
        const action = (isAdmin && isNext)
            ? `<button class="btn btn-sm btn-primary" onclick="payInstallment('${AccountsCommon.escJs(loan.id)}','${AccountsCommon.escJs(s.id)}')">Pay EMI</button>`
            : (paid ? '<span style="color:var(--color-success);font-size:0.8rem;">Paid</span>' : '<span style="color:var(--text-secondary);font-size:0.8rem;">—</span>');
        return `<tr>
            <td>${s.installment_number}</td>
            <td>${AccountsCommon.escapeHtml(AccountsCommon.formatDate ? AccountsCommon.formatDate(s.due_date) : (s.due_date || '').slice(0, 10))}</td>
            <td>${AccountsCommon.formatCurrency(s.opening_balance)}</td>
            <td>${AccountsCommon.formatCurrency(s.emi_amount)}</td>
            <td>${AccountsCommon.formatCurrency(s.principal_component)}</td>
            <td>${AccountsCommon.formatCurrency(s.interest_component)}</td>
            <td>${AccountsCommon.formatCurrency(s.closing_balance)}</td>
            <td><span class="badge ${paid ? 'status-active' : 'status-pending'}">${paid ? 'Paid' : 'Pending'}</span></td>
            <td>${action}</td>
        </tr>`;
    }).join('');
}

async function payInstallment(loanId, installmentId) {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can record EMI payments'); return; }
    const ok = await Confirm.show({
        title: 'Record EMI Payment',
        message: 'Record this EMI as paid? This posts Dr loan-liability (principal) + Dr interest / Cr bank, and reduces the outstanding principal.',
        confirmText: 'Record Payment', type: 'info'
    });
    if (!ok) return;

    if (!AccountsCommon.beginSubmit('payInstallment')) return;
    try {
        await api.request(AccountsCommon.buildUrl('loans/installments/pay'), {
            method: 'POST',
            body: JSON.stringify({ loan_id: loanId, installment_id: installmentId })
        });
        Toast.success('EMI recorded');
        // refresh the open schedule + the list
        await viewLoan(loanId);
        await loadLoans();
    } catch (err) {
        console.error('[Loans] payInstallment error:', err);
        Toast.error(err.message || 'Failed to record EMI');
    } finally {
        AccountsCommon.endSubmit('payInstallment');
    }
}
