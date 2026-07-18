/**
 * Budgets page
 */

let fiscalYearsList = [];
let accountsList = [];
let budgetsList = [];
let budgetsTotal = 0;
let budgetPage = 1;
const BUDGET_PAGE_SIZE = 50;
const BUDGET_FETCH_LIMIT = 2000; // matches the budgets endpoint's raised server cap so the full FY list loads
let selectedFyId = null;
let editingBudget = null;

let fyDropdown = null;
let sourceFyDropdown = null;
let accountDropdown = null;

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

document.addEventListener('DOMContentLoaded', async () => {
    if (!await AccountsCommon.initPage('budgets', '../')) return;

    await loadInitialData();
    initDropdowns();
    buildMonthlyInputs();
});

async function loadInitialData() {
    try {
        const [fyRes, coaRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('fiscal/years'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => [])
        ]);
        fiscalYearsList = Array.isArray(fyRes) ? fyRes : (fyRes?.data || []);
        accountsList = Array.isArray(coaRes) ? coaRes : (coaRes?.data || []);
    } catch (err) {
        console.error('[Budgets] load error:', err);
    }
}

function initDropdowns() {
    if (typeof SearchableDropdown === 'undefined') { setTimeout(initDropdowns, 100); return; }

    const fyOpts = fiscalYearsList.map(f => ({ value: f.id, label: f.name }));

    fyDropdown = new SearchableDropdown(document.getElementById('fyContainer'), {
        options: [{ value: '', label: 'Select fiscal year' }, ...fyOpts],
        placeholder: 'Select fiscal year', compact: true,
        onChange: (val) => { selectedFyId = val; if (val) loadBudgets(); }
    });

    sourceFyDropdown = new SearchableDropdown(document.getElementById('sourceFyContainer'), {
        options: [{ value: '', label: 'Select source fiscal year' }, ...fyOpts],
        placeholder: 'Select source year', compact: true
    });

    // Only Income and Expenses accounts can be budgeted
    const budgetableAccounts = accountsList.filter(a =>
        (a.account_type_name === 'Income' || a.account_type_name === 'Expenses') && a.allow_direct_posting
    );
    accountDropdown = new SearchableDropdown(document.getElementById('bAccountContainer'), {
        options: [{ value: '', label: 'Select account' }, ...budgetableAccounts.map(a => ({
            value: a.id, label: `${a.account_code} - ${a.account_name} (${a.account_type_name})`
        }))],
        placeholder: 'Search account...', compact: true
    });

    // Auto-select first fiscal year if available
    if (fiscalYearsList.length > 0) {
        fyDropdown.setValue(fiscalYearsList[0].id);
        selectedFyId = fiscalYearsList[0].id;
        loadBudgets();
    }
}

function buildMonthlyInputs() {
    const container = document.getElementById('monthlyInputs');
    container.innerHTML = MONTH_NAMES.map((m, i) => `
        <div class="form-group" style="margin-bottom:0.5rem;">
            <label style="font-size:0.75rem;color:var(--text-secondary);">${m}</label>
            <input type="number" class="form-control form-control-sm" id="bMonth${i+1}" min="0" step="0.01" style="font-size:0.85rem;">
        </div>
    `).join('');
}

function autoSplitMonthly() {
    const annual = parseFloat(document.getElementById('bAnnualAmount').value) || 0;
    // Paise-exact split: floor the first 11 months to 2dp, last month absorbs
    // the remainder so the 12 values sum exactly to the annual amount
    // (backend rejects monthly_amounts whose sum != annual_amount).
    const perMonthPaise = Math.floor((annual * 100) / 12);
    for (let i = 1; i <= 11; i++) {
        document.getElementById(`bMonth${i}`).value = (perMonthPaise / 100).toFixed(2);
    }
    const lastPaise = Math.round(annual * 100) - perMonthPaise * 11;
    document.getElementById('bMonth12').value = (lastPaise / 100).toFixed(2);
}

async function loadBudgets() {
    if (!selectedFyId) return;
    try {
        // High limit so the full FY budget list (and the Total Annual Budget
        // sum) is loaded; pagination is applied client-side over this list.
        const res = await api.request(AccountsCommon.buildUrl('budgets', { fiscalYearId: selectedFyId, limit: BUDGET_FETCH_LIMIT, offset: 0 }));
        budgetsList = Array.isArray(res) ? res : (res?.data || []);
        budgetsTotal = Array.isArray(res) ? res.length : (res?.total ?? budgetsList.length);
        budgetPage = 1;
        renderBudgets();
    } catch (err) {
        console.error('[Budgets] load error:', err);
        Toast.error('Failed to load budgets');
    }
}

function renderBudgets() {
    const tbody = document.getElementById('budgetsTable');
    const fmt = AccountsCommon.formatCurrency;

    document.getElementById('statBudgetCount').textContent = budgetsTotal;
    const total = budgetsList.reduce((s, b) => s + (b.annual_amount || 0), 0);
    document.getElementById('statBudgetTotal').textContent = fmt(total);

    if (!budgetsList.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-secondary);">No budgets for this fiscal year. Click "Add Budget" to create one.</td></tr>';
        AccountsCommon.renderPagination('budgetsPagination', 1, 1, () => {});
        return;
    }

    const totalPages = Math.ceil(budgetsList.length / BUDGET_PAGE_SIZE) || 1;
    if (budgetPage > totalPages) budgetPage = totalPages;
    const pageRows = budgetsList.slice((budgetPage - 1) * BUDGET_PAGE_SIZE, budgetPage * BUDGET_PAGE_SIZE);

    tbody.innerHTML = pageRows.map(b => {
        const perMonth = (b.annual_amount || 0) / 12;
        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(b.account_code || '-')}</code></td>
            <td>${AccountsCommon.escapeHtml(b.account_name || '-')}</td>
            <td><span class="badge ${b.account_type_name === 'Income' ? 'status-active' : 'status-pending'}">${AccountsCommon.escapeHtml(b.account_type_name || '-')}</span></td>
            <td style="text-align:right;">${fmt(b.annual_amount || 0)}</td>
            <td style="text-align:right;color:var(--text-secondary);">${fmt(perMonth)}</td>
            <td><div style="display:flex;gap:0.35rem;">
                <button class="btn-icon" onclick="editBudget('${b.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="btn-icon btn-icon-danger" onclick="deleteBudget('${b.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
            </div></td>
        </tr>`;
    }).join('');

    AccountsCommon.renderPagination('budgetsPagination', budgetPage, totalPages, p => { budgetPage = p; renderBudgets(); });
}

function openAddModal() {
    if (!selectedFyId) { Toast.error('Please select a fiscal year first'); return; }
    editingBudget = null;
    document.getElementById('budgetModalTitle').textContent = 'Add Budget';
    document.getElementById('bAnnualAmount').value = '';
    document.getElementById('bNotes').value = '';
    for (let i = 1; i <= 12; i++) document.getElementById(`bMonth${i}`).value = '';
    accountDropdown?.setValue('');
    accountDropdown?.setDisabled(false); // re-enable (edit mode locks it)
    AccountsCommon.openModal('budgetModal');
}

function editBudget(id) {
    const b = budgetsList.find(x => x.id === id);
    if (!b) return;
    editingBudget = b;
    document.getElementById('budgetModalTitle').textContent = 'Edit Budget';
    document.getElementById('bAnnualAmount').value = b.annual_amount || 0;
    document.getElementById('bNotes').value = b.notes || '';
    // Leave months blank when the budget has no stored breakdown, so saving
    // again keeps the "annual only" (backend even-split) behaviour.
    const monthly = b.monthly_amounts || [];
    for (let i = 1; i <= 12; i++) document.getElementById(`bMonth${i}`).value = monthly[i-1] ?? '';
    accountDropdown?.setValue(b.account_id);
    // The account is the budget's identity key (POST upserts on tenant+FY+account); changing it on edit
    // would create a NEW row and orphan the original. Lock the field during edit.
    accountDropdown?.setDisabled(true);
    AccountsCommon.openModal('budgetModal');
}

async function saveBudget() {
    const accountId = accountDropdown?.getValue();
    const annualAmount = parseFloat(document.getElementById('bAnnualAmount').value);
    const notes = document.getElementById('bNotes').value.trim();

    if (!accountId || !annualAmount || annualAmount <= 0) {
        Toast.error('Please select an account and enter a valid annual amount');
        return;
    }

    // Only send monthly_amounts when the user explicitly entered at least one
    // month — with all 12 blank the backend even-splits the annual amount
    // itself (an explicit array of zeros would be rejected as sum != annual).
    const monthly_amounts = [];
    let anyMonthEntered = false;
    for (let i = 1; i <= 12; i++) {
        const raw = document.getElementById(`bMonth${i}`).value.trim();
        if (raw !== '') anyMonthEntered = true;
        monthly_amounts.push(parseFloat(raw) || 0);
    }

    const payload = {
        fiscal_year_id: selectedFyId,
        account_id: accountId,
        annual_amount: annualAmount,
        notes: notes || null
    };
    if (anyMonthEntered) payload.monthly_amounts = monthly_amounts;

    if (!AccountsCommon.beginSubmit('saveBudget')) return;
    try {
        await api.request(AccountsCommon.buildUrl('budgets'), {
            method: 'POST', body: JSON.stringify(payload)
        });
        Toast.success(editingBudget ? 'Budget updated' : 'Budget created');
        AccountsCommon.closeModal('budgetModal');
        await loadBudgets();
    } catch (err) {
        console.error('[Budgets] save error:', err);
        Toast.error(err.message || 'Failed to save budget');
    } finally {
        AccountsCommon.endSubmit('saveBudget');
    }
}

async function deleteBudget(id) {
    const ok = await Confirm.show({
        title: 'Delete Budget', message: 'Are you sure you want to delete this budget entry?',
        confirmText: 'Delete', type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`budgets/${id}`), { method: 'DELETE' });
        Toast.success('Budget deleted');
        await loadBudgets();
    } catch (err) { Toast.error(err.message || 'Failed to delete'); }
}

function openCopyModal() {
    if (!selectedFyId) { Toast.error('Please select a target fiscal year first'); return; }
    sourceFyDropdown?.setValue('');
    AccountsCommon.openModal('copyModal');
}

async function confirmCopy() {
    const sourceFy = sourceFyDropdown?.getValue();
    if (!sourceFy) { Toast.error('Please select source fiscal year'); return; }
    if (sourceFy === selectedFyId) { Toast.error('Source and target fiscal year cannot be the same'); return; }

    if (!AccountsCommon.beginSubmit('confirmCopy')) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('budgets/copy'), {
            method: 'POST',
            body: JSON.stringify({ source_fiscal_year_id: sourceFy, target_fiscal_year_id: selectedFyId })
        });
        Toast.success(`Copied ${res.count || 0} budget(s)`);
        AccountsCommon.closeModal('copyModal');
        await loadBudgets();
    } catch (err) {
        console.error('[Budgets] copy error:', err);
        Toast.error(err.message || 'Failed to copy budgets');
    } finally {
        AccountsCommon.endSubmit('confirmCopy');
    }
}

function switchTab(tab) {
    document.querySelectorAll('.budget-tab-btn').forEach(b => {
        if (b.dataset.tab === tab) b.classList.add('active');
        else b.classList.remove('active');
    });
    document.getElementById('listTab').style.display = tab === 'list' ? '' : 'none';
    document.getElementById('analysisTab').style.display = tab === 'analysis' ? '' : 'none';
    if (tab === 'analysis') loadAnalysis();
}

async function loadAnalysis() {
    // NB: do NOT call switchTab('analysis') here — switchTab() calls loadAnalysis(), so that would
    // be unconditional mutual recursion (stack overflow the moment the Analysis tab is opened).
    if (!selectedFyId) {
        document.getElementById('analysisContent').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-secondary);">Please select a fiscal year first</p>';
        return;
    }

    try {
        const res = await api.request(AccountsCommon.buildUrl('budgets/analysis', { fiscalYearId: selectedFyId }));
        renderAnalysis(res);
    } catch (err) {
        console.error('[Budgets] analysis error:', err);
        document.getElementById('analysisContent').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load analysis</p>';
    }
}

function renderAnalysis(report) {
    const fmt = AccountsCommon.formatCurrency;
    const container = document.getElementById('analysisContent');

    if (!report || !report.sections || report.sections.length === 0) {
        container.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-secondary);">No budget data for this fiscal year</p>';
        return;
    }

    let html = `<div class="stats-row" style="margin-bottom:1.5rem;">
        <div class="stat-card">
            <div class="stat-value">${fmt(report.total_budget)}</div>
            <div class="stat-label">Total Budget</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmt(report.total_actual)}</div>
            <div class="stat-label">Total Actual</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color:${report.total_variance >= 0 ? 'var(--color-success)' : 'var(--color-error)'};">${fmt(report.total_variance)}</div>
            <div class="stat-label">Variance</div>
        </div>
    </div>`;

    for (const section of report.sections) {
        // Backend variance = budget - actual. Favorable = expense under budget
        // (variance >= 0) OR income over budget (variance <= 0).
        const isIncome = (section.account_type || '').toLowerCase().includes('income')
            || (section.account_type || '').toLowerCase().includes('revenue');
        const varianceColor = (variance) =>
            (isIncome ? variance <= 0 : variance >= 0) ? 'var(--color-success)' : 'var(--color-error)';
        html += `<div class="glass-card" style="margin-bottom:1rem;">
            <div class="glass-card-body">
                <h4 style="margin-bottom:0.75rem;">${AccountsCommon.escapeHtml(section.account_type)}</h4>
                <div class="data-table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Code</th>
                                <th>Account</th>
                                <th style="text-align:right;">Budget</th>
                                <th style="text-align:right;">Actual</th>
                                <th style="text-align:right;">Variance</th>
                                <th style="text-align:right;">%</th>
                                <th style="width:30%;">Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${section.accounts.map(a => {
                                // Use the raw (uncapped) pct for the color test; clamp only the bar width
                                const rawPct = a.budget_amount > 0 ? (a.actual_amount / a.budget_amount) * 100 : 0;
                                const pct = Math.min(100, rawPct);
                                const pctColor = rawPct > 100
                                    ? (isIncome ? 'var(--color-success)' : 'var(--color-error)')
                                    : rawPct > 80 ? 'var(--color-warning)' : 'var(--color-success)';
                                const varColor = varianceColor(a.variance);
                                return `<tr>
                                    <td><code>${AccountsCommon.escapeHtml(a.account_code)}</code></td>
                                    <td>${AccountsCommon.escapeHtml(a.account_name)}</td>
                                    <td style="text-align:right;">${fmt(a.budget_amount)}</td>
                                    <td style="text-align:right;">${fmt(a.actual_amount)}</td>
                                    <td style="text-align:right;color:${varColor};">${fmt(a.variance)}</td>
                                    <td style="text-align:right;color:${varColor};">${(a.variance_percentage || 0).toFixed(1)}%</td>
                                    <td><div style="height:8px;background:var(--bg-secondary);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pctColor};transition:width 0.3s;"></div></div></td>
                                </tr>`;
                            }).join('')}
                            <tr style="font-weight:600;background:var(--bg-secondary);">
                                <td colspan="2">Total ${AccountsCommon.escapeHtml(section.account_type)}</td>
                                <td style="text-align:right;">${fmt(section.section_budget)}</td>
                                <td style="text-align:right;">${fmt(section.section_actual)}</td>
                                <td style="text-align:right;color:${varianceColor(section.section_variance)};" colspan="3">${fmt(section.section_variance)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>`;
    }

    container.innerHTML = html;
}
