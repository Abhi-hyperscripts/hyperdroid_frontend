/**
 * AccountsService — Banking Page
 *
 * Handles 4 sidebar tabs:
 *   1. Bank Accounts          3. Inter-Bank Transfer
 *   2. Transactions           4. Reconciliation
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let bankAccountsList = [];
let coaAccounts = [];
let expenseCategoriesList = [];   // spend-category shortcuts in the Record Transaction modal
let bankTransactions = [];
let recentTransfers = [];
let currentTxnPage = 1;
let currentReconId = null;
let reconTransactions = [];
// Book balance (per GL) at the moment the reconciliation started — the anchor for
// the Difference math. See startReconciliation for how it's sourced.
let reconBookBalance = null;
let reconStartInFlight = false;
let transferInFlight = false;   // double-submit guard for executeTransfer
let bankTxnInFlight = false;    // double-submit guard for saveBankTransaction
let matchInFlight = false;      // double-submit guard for matchSelectedTransactions
let bankAccountSaveInFlight = false;  // double-submit guard for saveBankAccount
// Matched rows are spliced out of reconTransactions after each PUT, so keep a
// running count for the Complete Reconciliation summary (the transaction model
// has no is_matched field).
let reconMatchedCount = 0;
let reconMatchedAmount = 0; // running total of already-matched amounts (survives splicing out matched rows)
const TXN_PAGE_SIZE = 50;

// Dropdown instances
let txnBankFilterDropdown = null;
let transferFromDropdown = null;
let transferToDropdown = null;
let reconBankDropdown = null;
let importBankDropdown = null;
let importCounterDropdown = null;

// Statement import state
let parsedStatementRows = [];

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('banking', '../')) return;

    const tabNames = {
        'bank-accounts': 'Bank Accounts',
        'bank-transactions': 'Transactions',
        'bank-transfers': 'Inter-Bank Transfer',
        'pdc-cheques': 'Cheques / PDC',
        'statement-import': 'Import Statement',
        'reconciliation': 'Reconciliation'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    // Ensure dropdowns are populated after data + dropdown init are both complete
    refreshBankDropdowns();
    refreshImportCounterDropdown();
    setupSearchListeners();
    AccountsCommon.initDatePickers([
        { id: 'txnFromDate', onChange: () => { currentTxnPage = 1; loadBankTransactions(); } },
        { id: 'txnToDate', onChange: () => { currentTxnPage = 1; loadBankTransactions(); } },
        'txnDate', 'transferDate', 'reconStatementDate', 'qsDate'
    ]);
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    _acActiveRender = null;  // re-armed by loadBankDashboard on the accounts tab
    switch (tabId) {
        case 'bank-accounts':      loadBankAccounts(); loadBankDashboard(); break;
        case 'bank-transactions':  loadBankTransactions(); break;
        case 'bank-transfers':     loadRecentTransfers(); break;
        case 'pdc-cheques':        loadPdcCheques(); break;
        case 'statement-import':   initImportTab(); break;
        case 'reconciliation':     break; // user-triggered
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        const [bankRes, coaRes, catRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('expenses/categories'), { _skipSpinner: true }).catch(() => [])
        ]);

        bankAccountsList = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);
        coaAccounts = Array.isArray(coaRes) ? coaRes : (coaRes?.data || coaRes?.items || []);
        expenseCategoriesList = Array.isArray(catRes) ? catRes : (catRes?.data || catRes?.items || []);

        updateBankAccountStats();
        renderBankAccountsTable();

        // Summary tiles come from updateBankAccountStats(); loadBankDashboard() now only renders the
        // Balance-by-account chart (no duplicate tiles), so it's safe to run on load.
        loadBankDashboard();
    } catch (err) {
        console.error('[Banking] loadInitialData error:', err);
    }
}

async function loadBankDashboard() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('bank/dashboard'), { _skipSpinner: true });
        const dashboard = res?.data || res;
        if (!dashboard) return;
        // The summary tiles (bank/cash/total balance) are already covered by the static stats-row on this
        // tab, so we only use the dashboard here for the Balance-by-account chart — no duplicate tiles.

        // Balance-by-account chart (all accounts, sorted by balance; keeps sign so overdrafts show).
        const accts = dashboard.accounts || [];
        const rows = accts
            .map(a => ({ name: a.account_name || a.name || a.bank_name || '—', bal: parseFloat(a.current_balance ?? a.balance ?? 0) }))
            .sort((x, y) => y.bal - x.bal).slice(0, 10);
        const drawBank = () => {
            if (typeof acBarH !== 'function') return;
            if (!rows.length) return _acEmpty('bankBalanceChart', 'No bank or cash accounts yet');
            acBarH('bankBalanceChart', rows.map(r => r.name), rows.map(r => Math.round(r.bal * 100) / 100));
        };
        drawBank();
        _acActiveRender = drawBank;
    } catch (err) {
        // Silently ignore - dashboard data is supplementary
        console.debug('[Banking] loadBankDashboard not available:', err.message);
    }
}

// ============================================================================
// SEARCH LISTENERS
// ============================================================================

function setupSearchListeners() {
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    const txnSearch = document.getElementById('txnSearch');
    if (txnSearch) txnSearch.addEventListener('input', debounce(() => { currentTxnPage = 1; loadBankTransactions(); }));
}

// ============================================================================
// 1. BANK ACCOUNTS
// ============================================================================

let bankShowInactive = false;

async function loadBankAccounts() {
    try {
        const qs = bankShowInactive ? (AccountsCommon.buildUrl('bank/accounts').includes('?') ? '&' : '?') + 'includeInactive=true' : '';
        const res = await api.request(AccountsCommon.buildUrl('bank/accounts') + qs, { _skipSpinner: true });
        bankAccountsList = Array.isArray(res) ? res : (res?.data || res?.items || []);
        updateBankAccountStats();
        renderBankAccountsTable();
    } catch (err) {
        console.error('[Banking] loadBankAccounts error:', err);
        Toast.error('Failed to load bank accounts');
    }
}

function toggleBankShowInactive() {
    bankShowInactive = document.getElementById('bankShowInactive')?.checked || false;
    loadBankAccounts();
}

function updateBankAccountStats() {
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    const active = bankAccountsList.filter(a => a.is_active !== false);
    const totalBal = bankAccountsList.reduce((s, a) => s + (parseFloat(a.current_balance || a.balance) || 0), 0);
    el('totalBankAccounts', bankAccountsList.length);
    el('totalBankBalance', AccountsCommon.formatCurrency(totalBal));
    el('activeBankAccounts', active.length);
}

function renderBankAccountsTable() {
    const tbody = document.getElementById('bankAccountsTable');
    if (!tbody) return;
    if (!bankAccountsList.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg><p>No bank accounts found</p></div></td></tr>`;
        return;
    }
    const coaMap = {};
    coaAccounts.forEach(a => { coaMap[a.id] = (a.account_code || a.code) ? (a.account_code || a.code) + ' - ' + (a.account_name || a.name) : (a.account_name || a.name); });
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency;
    const viewSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const editSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    const deactivateSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
    const isAdmin = accountsRoles.isAdmin();

    tbody.innerHTML = bankAccountsList.map(a => {
        const statusBadge = a.is_active !== false
            ? '<span class="status-badge active">Active</span>'
            : '<span class="status-badge inactive">Inactive</span>';
        const defaultBadge = a.is_default ? ' <span class="status-badge" style="background:var(--brand-primary);color:var(--text-inverse);font-size:0.7rem;">Default</span>' : '';
        const viewBtn = `<button class="btn-icon" onclick="viewBankAccount('${a.id}')" data-tooltip="View">${viewSvg}</button>`;
        const actions = isAdmin
            ? viewBtn
                + `<button class="btn-icon" onclick="editBankAccount('${a.id}')" data-tooltip="Edit">${editSvg}</button>`
                + (a.is_active !== false
                    ? `<button class="btn-icon danger" onclick="deactivateBankAccount('${a.id}')" data-tooltip="Deactivate">${deactivateSvg}</button>`
                    : `<button class="btn-icon" onclick="reactivateBankAccount('${a.id}')" data-tooltip="Reactivate">${editSvg}</button>`)
            : viewBtn;
        return `<tr>
            <td>${esc(a.account_name || a.name || '-')}${defaultBadge}</td>
            <td>${esc(a.bank_name || '-')}</td>
            <td><code>${esc(a.account_number || '-')}</code></td>
            <td>${esc((a.account_type || '').charAt(0).toUpperCase() + (a.account_type || '').slice(1))}</td>
            <td>${esc(a.gl_account_code ? a.gl_account_code + ' - ' + (a.gl_account_name || '') : (coaMap[a.gl_account_id] || '-'))}</td>
            <td class="text-right">${fmt(a.current_balance || a.balance || 0)}</td>
            <td>${statusBadge}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// BANK ACCOUNT MODAL — CREATE / EDIT
// ============================================================================

function setBankAccountModalMode(mode) {
    // mode: 'create' | 'edit' | 'view'
    const title = document.getElementById('bankAccountModalTitle');
    const saveBtn = document.getElementById('bankAccountSaveBtn');
    const cancelBtn = document.getElementById('bankAccountCancelBtn');
    const form = document.getElementById('bankAccountForm');
    if (title) title.textContent = mode === 'create' ? 'Add Bank Account' : mode === 'edit' ? 'Edit Bank Account' : 'View Bank Account';
    if (saveBtn) saveBtn.style.display = mode === 'view' ? 'none' : '';
    if (cancelBtn) cancelBtn.textContent = mode === 'view' ? 'Close' : 'Cancel';
    if (form) {
        form.querySelectorAll('input, select, textarea').forEach(el => {
            el.disabled = mode === 'view';
            el.readOnly = mode === 'view';
        });
    }
}

function showCreateBankAccountModal() {
    document.getElementById('bankAccountForm').reset();
    document.getElementById('bankAccountId').value = '';
    setBankAccountModalMode('create');
    populateGLAccountSelect();
    AccountsCommon.openModal('bankAccountModal');
}

async function loadBankAccountIntoModal(id, mode) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`bank/accounts/${id}`));
        const acct = res?.data || res;
        if (!acct) { Toast.error('Account not found'); return; }
        document.getElementById('bankAccountId').value = acct.id;
        document.getElementById('accountName').value = acct.account_name || acct.name || '';
        document.getElementById('bankName').value = acct.bank_name || '';
        document.getElementById('accountNumber').value = acct.account_number || '';
        document.getElementById('accountType').value = acct.account_type || '';
        document.getElementById('ifscCode').value = acct.ifsc_code || '';
        document.getElementById('swiftCode').value = acct.swift_code || '';
        document.getElementById('branchName').value = acct.branch || '';
        document.getElementById('isDefault').checked = !!acct.is_default;
        populateGLAccountSelect(acct.gl_account_id);
        setBankAccountModalMode(mode);
        AccountsCommon.openModal('bankAccountModal');
    } catch (err) {
        console.error('[Banking] loadBankAccountIntoModal error:', err);
        Toast.error('Failed to load account details');
    }
}

async function editBankAccount(id) { return loadBankAccountIntoModal(id, 'edit'); }
async function viewBankAccount(id) { return loadBankAccountIntoModal(id, 'view'); }

async function deactivateBankAccount(id) {
    const a = bankAccountsList.find(x => x.id === id);
    const label = a ? `"${a.account_name || a.name}"${a.bank_name ? ` at ${a.bank_name}` : ''}` : 'this bank account';
    const ok = await Confirm.show({
        title: 'Deactivate Bank Account',
        message: `Are you sure you want to deactivate ${label}? It will be hidden from new transactions, transfers, and reconciliations, but its history (posted transactions, GL entries) stays intact. You can reactivate it later.`,
        confirmText: 'Deactivate',
        type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`bank/accounts/${id}`), {
            method: 'PUT',
            body: JSON.stringify({ is_active: false })
        });
        Toast.success(`Deactivated bank account ${label}`);
        await loadBankAccounts();
    } catch (err) {
        console.error('[Banking] deactivateBankAccount error:', err);
        Toast.error(err.message || 'Failed to deactivate bank account');
    }
}

async function reactivateBankAccount(id) {
    try {
        await api.request(AccountsCommon.buildUrl(`bank/accounts/${id}`), {
            method: 'PUT',
            body: JSON.stringify({ is_active: true })
        });
        Toast.success('Bank account reactivated');
        await loadBankAccounts();
    } catch (err) {
        console.error('[Banking] reactivateBankAccount error:', err);
        Toast.error(err.message || 'Failed to reactivate bank account');
    }
}

function populateGLAccountSelect(selectedId) {
    const sel = document.getElementById('glAccountId');
    if (!sel) return;
    const esc = AccountsCommon.escapeHtml;
    // Only VALID bank ledgers are offered: postable (headers like "1120 Bank
    // Accounts" are structure rows — linking one bricks every payment posting),
    // Asset-type, debit-normal, and not already claimed by another bank account.
    const takenGls = new Set(bankAccountsList.filter(b => b.id !== document.getElementById('bankAccountId')?.value)
        .map(b => b.gl_account_id));
    sel.innerHTML = '<option value="">Select GL Account...</option>' +
        coaAccounts.filter(a =>
            a.id === selectedId || (
                a.allow_direct_posting !== false &&
                (a.account_type_name || '') === 'Assets' &&
                (a.normal_balance || 'debit') === 'debit' &&
                !takenGls.has(a.id)))
        .map(a => {
            const code = a.account_code || a.code || '';
            const name = a.account_name || a.name || '';
            const label = code ? code + ' - ' + name : name;
            return `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${esc(label)}</option>`;
        }).join('');
}

async function saveBankAccount() {
    const id = document.getElementById('bankAccountId').value;
    const accountName = document.getElementById('accountName').value.trim();
    const bankName = document.getElementById('bankName').value.trim();
    const accountNumber = document.getElementById('accountNumber').value.trim();
    const accountType = document.getElementById('accountType').value;
    const glAccountId = document.getElementById('glAccountId').value;

    // Backend CreateBankAccountRequest.gl_account_id is a non-nullable Guid —
    // sending null 400s, so require it client-side.
    if (!accountName || !bankName || !accountNumber || !accountType || !glAccountId) {
        Toast.error('Account Name, Bank Name, Account Number, Type, and GL Account are required');
        return;
    }

    if (bankAccountSaveInFlight) return;
    bankAccountSaveInFlight = true;

    const payload = {
        account_name: accountName,
        bank_name: bankName,
        account_number: accountNumber,
        account_type: accountType,
        ifsc_code: document.getElementById('ifscCode').value.trim() || null,
        swift_code: document.getElementById('swiftCode').value.trim() || null,
        branch: document.getElementById('branchName').value.trim() || null,
        gl_account_id: glAccountId,
        is_default: document.getElementById('isDefault').checked
    };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`bank/accounts/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Bank account updated');
        } else {
            await api.request(AccountsCommon.buildUrl('bank/accounts'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Bank account created');
        }
        AccountsCommon.closeModal('bankAccountModal');
        await loadBankAccounts();
        loadBankDashboard();   // the balance-by-account chart must reflect the new/edited account
        refreshBankDropdowns();
    } catch (err) {
        console.error('[Banking] saveBankAccount error:', err);
        Toast.error(err.message || 'Failed to save bank account');
    } finally {
        bankAccountSaveInFlight = false;
    }
}

// ============================================================================
// 2. BANK TRANSACTIONS
// ============================================================================

async function loadBankTransactions() {
    try {
        const bankId = txnBankFilterDropdown?.getValue?.() || '';
        if (!bankId) {
            const tbody = document.getElementById('bankTransactionsTable');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1rem; color:var(--text-secondary);">Select a bank account to view transactions</td></tr>';
            _acEmpty('txnFlowChart', 'Select a bank account');
            _acEmpty('txnTypeChart', 'Select a bank account');
            return;
        }

        const fromDate = document.getElementById('txnFromDate')?.value || '';
        const toDate = document.getElementById('txnToDate')?.value || '';
        const search = document.getElementById('txnSearch')?.value || '';

        const params = { limit: TXN_PAGE_SIZE, offset: (currentTxnPage - 1) * TXN_PAGE_SIZE };
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;
        if (search) params.search = search;

        const url = AccountsCommon.buildUrl(`bank/accounts/${bankId}/transactions`, params);
        const res = await api.request(url, { _skipSpinner: true });
        bankTransactions = Array.isArray(res) ? res : (res?.data || res?.items || []);

        // ?? not ||: a legit total of 0 (or a bare-array response) must not fall
        // through and cap pagination at the current page's row count.
        const total = res?.total ?? res?.totalCount ?? bankTransactions.length;
        const totalPages = Math.ceil(total / TXN_PAGE_SIZE) || 1;
        // Clamp if actioning the last row on a page left us past the end (else an empty "No … found").
        if (currentTxnPage > totalPages) { currentTxnPage = totalPages; return loadBankTransactions(); }

        renderBankTransactionsTable();
        AccountsCommon.renderPagination('bankTxnPagination', currentTxnPage, totalPages, (page) => {
            currentTxnPage = page;
            loadBankTransactions();
        });

        // Charts read the full matching set for this account (dates respected, search ignored)
        const chartParams = {};
        if (fromDate) chartParams.fromDate = fromDate;
        if (toDate) chartParams.toDate = toDate;
        renderBankTxnCharts(bankId, chartParams);
        _acActiveRender = () => renderBankTxnCharts(bankId, chartParams);
    } catch (err) {
        console.error('[Banking] loadBankTransactions error:', err);
        Toast.error('Failed to load transactions');
    }
}

// Transaction charts — monthly in-vs-out + volume by type. Inflow set matches the
// table's Dr/Cr logic (deposit / transfer_in / interest increase the bank asset).
async function renderBankTxnCharts(bankId, baseParams) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`bank/accounts/${bankId}/transactions`, { ...baseParams, limit: 1000, offset: 0 }), { _skipSpinner: true });
        const all = Array.isArray(res) ? res : (res?.data || res?.items || []);
        if (!all.length) { _acEmpty('txnFlowChart'); _acEmpty('txnTypeChart'); return; }
        const inflowTypes = ['deposit', 'transfer_in', 'interest'];
        const isIn = (t) => inflowTypes.includes(t.transaction_type || t.type);
        const dateKey = all[0].transaction_date != null ? 'transaction_date' : 'date';
        const inM = _acMonthly(all.filter(isIn), dateKey, 'amount', 6);
        const outM = _acMonthly(all.filter(t => !isIn(t)), dateKey, 'amount', 6);
        acColumns('txnFlowChart', inM.categories, [
            { name: 'In', data: inM.data },
            { name: 'Out', data: outM.data }
        ], ['#10b981', '#ef4444']);
        const byType = {};
        all.forEach(t => {
            const k = (t.transaction_type || t.type || 'other').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            byType[k] = (byType[k] || 0) + parseFloat(t.amount || 0);
        });
        const types = Object.keys(byType).filter(k => byType[k] > 0).sort();
        types.length
            ? acDonut('txnTypeChart', types, types.map(k => Math.round(byType[k] * 100) / 100),
                      types.map((k, i) => _acPalette[i % _acPalette.length]))
            : _acEmpty('txnTypeChart');
    } catch (err) {
        console.error('[Banking] renderBankTxnCharts error:', err);
        _acEmpty('txnFlowChart'); _acEmpty('txnTypeChart');
    }
}

function renderBankTransactionsTable() {
    const tbody = document.getElementById('bankTransactionsTable');
    if (!tbody) return;
    if (!bankTransactions.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><p>No transactions found</p></div></td></tr>`;
        return;
    }
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;
    const isAdmin = accountsRoles.isAdmin();
    const delSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    // Note: the old "Balance" column was removed — it was a per-page running
    // total starting at 0 (the backend provides no opening balance for the
    // page), which misread as an authoritative ledger balance.

    tbody.innerHTML = bankTransactions.map(t => {
        // From the account HOLDER's perspective (our ledger, not the bank's
        // passbook): a deposit INCREASES our bank asset so it's a Debit;
        // a withdrawal DECREASES it so it's a Credit. This matches the GL
        // perspective used everywhere else in the Accounts module.
        const inflowTypes = ['deposit', 'transfer_in', 'interest'];
        const isInflow = inflowTypes.includes(t.transaction_type);
        const debit = isInflow ? fmt(t.amount) : '-';
        const credit = !isInflow ? fmt(t.amount) : '-';
        const reconBadge = t.is_reconciled
            ? '<span class="status-badge active" style="font-size:0.7rem;">Yes</span>'
            : '<span class="status-badge" style="font-size:0.7rem;">No</span>';
        const actions = isAdmin && !t.is_reconciled
            ? `<button class="btn-icon danger" onclick="deleteBankTransaction('${t.id}')" data-tooltip="Delete">${delSvg}</button>`
            : '<span class="text-secondary">-</span>';
        return `<tr>
            <td>${fmtD(t.transaction_date || t.date)}</td>
            <td>${esc(t.description || '-')}</td>
            <td>${esc((t.transaction_type || t.type || '').charAt(0).toUpperCase() + (t.transaction_type || t.type || '').slice(1))}</td>
            <td class="text-right">${debit}</td>
            <td class="text-right">${credit}</td>
            <td>${reconBadge}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// TRANSACTION MODAL
// ============================================================================

function showRecordTransactionModal() {
    document.getElementById('bankTransactionForm').reset();
    AccountsCommon.setDateField('txnDate', AccountsCommon.todayLocal());

    const bankId = txnBankFilterDropdown?.getValue?.() || '';
    document.getElementById('txnBankAccountId').value = bankId;

    populateCounterAccountSelect();
    AccountsCommon.openModal('bankTransactionModal');
}

// ============================================================================
// QUICK SPEND — everyday petty-cash expenses by category. The user picks WHAT
// it was for (Groceries / Milk / Stationery…) and the accounting (withdrawal +
// counter account from the category's default GL) happens behind the scenes.
// ============================================================================

function showQuickSpendModal() {
    document.getElementById('quickSpendForm').reset();
    AccountsCommon.setDateField('qsDate', AccountsCommon.todayLocal());

    const esc = AccountsCommon.escapeHtml;
    const catSel = document.getElementById('qsCategory');
    catSel.innerHTML = '<option value="">Select category...</option>' +
        expenseCategoriesList
            .filter(c => c.is_active !== false && c.default_account_id)
            .map(c => `<option value="${c.id}">${esc(c.name)}</option>`)
            .join('');

    const fromSel = document.getElementById('qsPaidFrom');
    fromSel.innerHTML = '<option value="">Select account...</option>' +
        bankAccountsList
            .filter(b => b.is_active !== false)
            .map(b => `<option value="${b.id}">${esc(b.account_name || b.name)}</option>`)
            .join('');
    // Default to the account being viewed, else the petty-cash box — that's the everyday case
    const current = txnBankFilterDropdown?.getValue?.();
    const petty = bankAccountsList.find(b => (b.account_type || '') === 'petty_cash');
    fromSel.value = current || petty?.id || '';

    AccountsCommon.openModal('quickSpendModal');
}

let quickSpendInFlight = false;
async function saveQuickSpend() {
    const cat = expenseCategoriesList.find(c => c.id === document.getElementById('qsCategory').value);
    const bankId = document.getElementById('qsPaidFrom').value;
    const amount = parseFloat(document.getElementById('qsAmount').value) || 0;
    const date = document.getElementById('qsDate').value;
    const note = document.getElementById('qsDescription').value.trim();

    if (!cat || !bankId || amount <= 0 || !date) {
        Toast.error('Category, amount, paid-from account and date are required');
        return;
    }

    if (quickSpendInFlight) return;
    quickSpendInFlight = true;
    const btn = document.getElementById('saveQuickSpendBtn');
    if (btn) btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl(`bank/accounts/${bankId}/transactions`), {
            method: 'POST',
            body: JSON.stringify({
                bank_account_id: bankId,
                transaction_date: date,
                transaction_type: 'withdrawal',
                amount,
                description: note ? `${cat.name} — ${note}` : cat.name,
                reference_number: null,
                counter_account_id: cat.default_account_id
            })
        });
        Toast.success(`Spend recorded: ${cat.name} ₹${amount.toLocaleString('en-IN')}`);
        AccountsCommon.closeModal('quickSpendModal');
        // Refresh the register + balances if the spend hit the account being viewed
        if (txnBankFilterDropdown?.getValue?.() === bankId) await loadBankTransactions();
        await loadBankAccounts();
    } catch (err) {
        console.error('[Banking] saveQuickSpend error:', err);
        Toast.error(err.message || 'Failed to record spend');
    } finally {
        quickSpendInFlight = false;
        if (btn) btn.disabled = false;
    }
}

function populateCounterAccountSelect(selectedId) {
    const sel = document.getElementById('txnCounterAccount');
    if (!sel) return;
    const esc = AccountsCommon.escapeHtml;
    sel.innerHTML = '<option value="">Select Account...</option>' +
        coaAccounts
            // Only postable accounts are valid counter accounts — the backend rejects
            // header/non-postable GLs (allow_direct_posting = false) with a 409.
            .filter(a => a.allow_direct_posting)
            .map(a => {
                const code = a.account_code || a.code || '';
                const name = a.account_name || a.name || '';
                const label = code ? code + ' - ' + name : name;
                return `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${esc(label)}</option>`;
            }).join('');
}

async function saveBankTransaction() {
    const bankAccountId = document.getElementById('txnBankAccountId').value || txnBankFilterDropdown?.getValue?.();
    const txnDate = document.getElementById('txnDate').value;
    const txnType = document.getElementById('txnType').value;
    const amount = parseFloat(document.getElementById('txnAmount').value) || 0;
    const counterAccountId = document.getElementById('txnCounterAccount').value;

    // Backend RecordBankTransactionRequest.counter_account_id is a non-nullable
    // Guid (the other leg of the double entry) — sending null 400s.
    if (!bankAccountId || !txnDate || !txnType || !amount || !counterAccountId) {
        Toast.error('Bank account, date, type, amount, and counter account are required');
        return;
    }
    // type="button" form — reportValidity never fires, so a typed negative would
    // otherwise pass the truthiness check above and post.
    if (amount <= 0) {
        Toast.error('Amount must be greater than zero');
        return;
    }

    const payload = {
        bank_account_id: bankAccountId,
        transaction_date: txnDate,
        transaction_type: txnType,
        amount,
        description: document.getElementById('txnDescription').value.trim() || null,
        reference_number: document.getElementById('txnReference').value.trim() || null,
        counter_account_id: counterAccountId
    };

    // Guard against a double-click posting the same bank transaction (a real double ledger movement) twice.
    if (bankTxnInFlight) return;
    bankTxnInFlight = true;
    const txnBtn = document.getElementById('saveBankTransactionBtn');
    if (txnBtn) txnBtn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl(`bank/accounts/${bankAccountId}/transactions`), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Transaction recorded');
        AccountsCommon.closeModal('bankTransactionModal');
        await loadBankTransactions();
        await loadBankAccounts(); // refresh balances
    } catch (err) {
        console.error('[Banking] saveBankTransaction error:', err);
        Toast.error(err.message || 'Failed to save transaction');
    } finally {
        bankTxnInFlight = false;
        if (txnBtn) txnBtn.disabled = false;
    }
}

async function deleteBankTransaction(id) {
    const t = bankTransactions.find(x => x.id === id);
    const fmt = AccountsCommon.formatCurrency;
    const dateStr = t?.transaction_date ? new Date(t.transaction_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const typeStr = t?.transaction_type ? (t.transaction_type.charAt(0).toUpperCase() + t.transaction_type.slice(1)) : 'transaction';
    const amountStr = t?.amount != null ? fmt(t.amount) : '';
    const descStr = t?.description ? ` "${t.description.length > 60 ? t.description.slice(0, 60) + '…' : t.description}"` : '';
    const label = t ? `the ${typeStr} of ${amountStr} on ${dateStr}${descStr}` : 'this transaction';
    const ok = await Confirm.show({
        title: 'Delete Bank Transaction',
        message: `Are you sure you want to delete ${label}? This will permanently remove the transaction and reverse its effect on the bank account balance. This cannot be undone. Reconciled transactions cannot be deleted — unreconcile them first if needed.`,
        confirmText: 'Delete',
        type: 'danger'
    });
    if (!ok) return;
    const bankId = txnBankFilterDropdown?.getValue?.() || '';
    try {
        await api.request(AccountsCommon.buildUrl(`bank/accounts/${bankId}/transactions/${id}`), { method: 'DELETE' });
        Toast.success('Transaction deleted');
        await loadBankTransactions();
        await loadBankAccounts();
    } catch (err) {
        console.error('[Banking] deleteBankTransaction error:', err);
        Toast.error(err.message || 'Failed to delete transaction');
    }
}

// ============================================================================
// 3. INTER-BANK TRANSFER
// ============================================================================

async function executeTransfer() {
    const fromId = transferFromDropdown?.getValue?.();
    const toId = transferToDropdown?.getValue?.();
    const amount = parseFloat(document.getElementById('transferAmount').value) || 0;
    const date = document.getElementById('transferDate').value;
    const description = document.getElementById('transferDescription').value.trim();

    if (!fromId || !toId || !amount || !date) {
        Toast.error('From Account, To Account, Amount, and Date are required');
        return;
    }
    // type="button" form — reportValidity never fires, so a typed negative would
    // otherwise pass the truthiness check above and post.
    if (amount <= 0) {
        Toast.error('Transfer amount must be greater than zero');
        return;
    }
    if (fromId === toId) {
        Toast.error('From and To accounts must be different');
        return;
    }

    const payload = {
        from_bank_account_id: fromId,
        to_bank_account_id: toId,
        amount,
        transfer_date: date,
        description: description || null
    };

    // Guard against a double-click / re-click during a slow response posting the transfer twice
    // (each transfer moves money between two ledgers — a duplicate is a real double-spend).
    if (transferInFlight) return;
    transferInFlight = true;
    const transferBtn = document.getElementById('executeTransferBtn');
    if (transferBtn) transferBtn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('bank/transfer'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Transfer executed successfully');
        document.getElementById('transferForm').reset();
        AccountsCommon.setDateField('transferDate', AccountsCommon.todayLocal());
        transferFromDropdown?.setValue?.('');
        transferToDropdown?.setValue?.('');
        await loadRecentTransfers();
        await loadBankAccounts(); // refresh balances
    } catch (err) {
        console.error('[Banking] executeTransfer error:', err);
        Toast.error(err.message || 'Failed to execute transfer');
    } finally {
        transferInFlight = false;
        if (transferBtn) transferBtn.disabled = false;
    }
}

async function loadRecentTransfers() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('bank/transfer', { limit: 20 }), { _skipSpinner: true });
        recentTransfers = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderRecentTransfersTable();
        renderTransferCharts();
        _acActiveRender = renderTransferCharts;
    } catch (err) {
        console.error('[Banking] loadRecentTransfers error:', err);
    }
}

// Transfer charts — monthly volume + busiest from→to routes (full set, not the recent-20 slice)
async function renderTransferCharts() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('bank/transfer', { limit: 500 }), { _skipSpinner: true });
        const all = Array.isArray(res) ? res : (res?.data || res?.items || []);
        if (!all.length) { _acEmpty('transferVolumeChart'); _acEmpty('transferRoutesChart'); return; }
        const acctMap = {};
        bankAccountsList.forEach(a => { acctMap[a.id] = a.account_name || a.name; });
        const dateKey = all[0].transfer_date != null ? 'transfer_date' : 'date';
        const m = _acMonthly(all, dateKey, 'amount', 6);
        acArea('transferVolumeChart', m.categories, m.data, 'Transferred');
        const short = (s) => (s || '?').length > 12 ? s.slice(0, 11) + '…' : (s || '?');
        const rank = _acRank(all.map(t => ({
            route: `${short(acctMap[t.from_account_id] || t.from_account_name)} → ${short(acctMap[t.to_account_id] || t.to_account_name)}`,
            amt: parseFloat(t.amount || 0)
        })), 'route', 'amt', 6);
        rank.labels.length ? acBarH('transferRoutesChart', rank.labels, rank.data) : _acEmpty('transferRoutesChart');
    } catch (err) {
        console.error('[Banking] renderTransferCharts error:', err);
        _acEmpty('transferVolumeChart'); _acEmpty('transferRoutesChart');
    }
}

function renderRecentTransfersTable() {
    const tbody = document.getElementById('recentTransfersTable');
    if (!tbody) return;
    if (!recentTransfers.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><p>No recent transfers</p></div></td></tr>`;
        return;
    }
    const acctMap = {};
    bankAccountsList.forEach(a => { acctMap[a.id] = a.account_name || a.name; });
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;

    tbody.innerHTML = recentTransfers.map(t => `<tr>
        <td>${fmtD(t.transfer_date || t.date)}</td>
        <td>${esc(acctMap[t.from_account_id] || t.from_account_name || '-')}</td>
        <td>${esc(acctMap[t.to_account_id] || t.to_account_name || '-')}</td>
        <td class="text-right">${fmt(t.amount)}</td>
        <td>${esc(t.description || '-')}</td>
        <td>${AccountsCommon.statusBadge(t.status || 'completed')}</td>
    </tr>`).join('');
}

// ============================================================================
// 4. RECONCILIATION
// ============================================================================

async function startReconciliation() {
    // Re-entry guard: clicking Start with a session already open would create a
    // second backend reconciliation and orphan currentReconId's matched state.
    if (currentReconId) {
        Toast.error('A reconciliation is already in progress — complete it before starting another');
        return;
    }
    if (reconStartInFlight) return;

    const bankId = reconBankDropdown?.getValue?.();
    const statementBalance = parseFloat(document.getElementById('reconStatementBalance').value);
    const statementDate = document.getElementById('reconStatementDate').value;

    if (!bankId || isNaN(statementBalance) || !statementDate) {
        Toast.error('Bank Account, Statement Balance, and Statement Date are required');
        return;
    }

    reconStartInFlight = true;
    try {
        const res = await api.request(AccountsCommon.buildUrl('bank/reconciliations'), {
            method: 'POST',
            body: JSON.stringify({ bank_account_id: bankId, statement_balance: statementBalance, statement_date: statementDate })
        });
        const recon = res?.data || res;
        currentReconId = recon.id;
        reconTransactions = recon.transactions || recon.unmatched_transactions || [];
        reconMatchedCount = 0;
        reconMatchedAmount = 0;
        // BACKEND GAP: the start response is {id, status, transactions} — it does not
        // echo the book_balance the backend just stored on bank_reconciliations.
        // BusinessLayer_Bank.StartReconciliation uses bankAcct.current_balance as the
        // book balance, so mirror exactly that from the already-loaded account list
        // (prefer any book_balance the backend may add later).
        const bank = bankAccountsList.find(b => b.id === bankId);
        reconBookBalance = parseFloat(recon.book_balance ?? bank?.current_balance ?? bank?.balance ?? 0);

        document.getElementById('reconWorkspace').style.display = 'block';
        document.getElementById('reconSummaryStatement').textContent = AccountsCommon.formatCurrency(statementBalance);
        const bookEl = document.getElementById('reconSummaryBook');
        if (bookEl) bookEl.textContent = AccountsCommon.formatCurrency(reconBookBalance);
        renderReconTransactions();
        updateReconSummary();
        Toast.success('Reconciliation started');
    } catch (err) {
        console.error('[Banking] startReconciliation error:', err);
        Toast.error(err.message || 'Failed to start reconciliation');
    } finally {
        reconStartInFlight = false;
    }
}

function renderReconTransactions() {
    const tbody = document.getElementById('reconTransactionsTable');
    if (!tbody) return;
    if (!reconTransactions.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">No unmatched transactions</td></tr>';
        return;
    }
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;

    tbody.innerHTML = reconTransactions.map(t => {
        // Same outflow set as the Transactions list view: withdrawal, charges and
        // transfer_out reduce the bank balance; deposit/transfer_in/interest add.
        const outflowTypes = ['withdrawal', 'charges', 'transfer_out'];
        const amt = outflowTypes.includes(t.transaction_type) ? -(parseFloat(t.amount) || 0) : (parseFloat(t.amount) || 0);
        return `<tr>
            <td><input type="checkbox" class="recon-check" data-txn-id="${t.id}" data-amount="${amt}" onchange="updateReconSummary()"></td>
            <td>${fmtD(t.transaction_date || t.date)}</td>
            <td>${esc(t.description || '-')}</td>
            <td class="text-right" style="${amt < 0 ? 'color:var(--color-danger)' : ''}">${fmt(Math.abs(amt))}</td>
        </tr>`;
    }).join('');
}

function toggleReconSelectAll() {
    const checked = document.getElementById('reconSelectAll')?.checked || false;
    document.querySelectorAll('.recon-check').forEach(cb => { cb.checked = checked; });
    updateReconSummary();
}

function updateReconSummary() {
    const stmtBal = parseFloat(document.getElementById('reconStatementBalance')?.value) || 0;
    let matched = 0;
    let totalUnmatched = 0;

    document.querySelectorAll('.recon-check').forEach(cb => {
        const amt = parseFloat(cb.dataset.amount) || 0;
        if (cb.checked) {
            matched += amt;
        } else {
            totalUnmatched += amt;
        }
    });

    // Reconciliation difference = statement balance − (book balance − outstanding items).
    // The book balance already includes every recorded transaction; UNCHECKED rows are
    // treated as outstanding (in the books but not yet on this statement), so the
    // expected statement balance is bookBalance − Σ(unchecked signed amounts). Checked
    // rows clear on this statement and drop out of the outstanding adjustment — as do
    // rows already matched via Match Selected (they're spliced out of the list).
    // (Previously: stmtBal − Σchecked, which ignored the book balance entirely.)
    // reconBookBalance mirrors the backend's book_balance (see startReconciliation).
    const bookBal = reconBookBalance ?? 0;
    const diff = stmtBal - (bookBal - totalUnmatched);
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    // Matched tile = already-committed matches (survive splicing) + currently-checked preview.
    el('reconSummaryMatched', AccountsCommon.formatCurrency(Math.abs(reconMatchedAmount + matched)));
    el('reconSummaryUnmatched', AccountsCommon.formatCurrency(Math.abs(totalUnmatched)));
    el('reconSummaryDifference', AccountsCommon.formatCurrency(Math.abs(diff)));

    const diffEl = document.getElementById('reconSummaryDifference');
    if (diffEl) diffEl.style.color = Math.abs(diff) < 0.01 ? 'var(--color-success)' : 'var(--color-danger)';
}

async function matchSelectedTransactions() {
    if (!currentReconId) { Toast.error('No active reconciliation'); return; }

    const txnIds = [];
    let matchedSum = 0;
    document.querySelectorAll('.recon-check:checked').forEach(cb => { txnIds.push(cb.dataset.txnId); matchedSum += parseFloat(cb.dataset.amount) || 0; });

    if (!txnIds.length) { Toast.error('Select at least one transaction to match'); return; }

    // Guard against a double-click double-counting reconMatchedCount (inflates the completion summary).
    if (matchInFlight) return;
    matchInFlight = true;
    try {
        await api.request(AccountsCommon.buildUrl(`bank/reconciliations/${currentReconId}`), {
            method: 'PUT',
            body: JSON.stringify({ transaction_ids: txnIds })
        });
        Toast.success(`${txnIds.length} transaction(s) matched`);
        reconMatchedCount += txnIds.length;
        reconMatchedAmount += matchedSum; // keep the matched-amount tile accurate after rows are spliced out
        // Remove matched from list
        reconTransactions = reconTransactions.filter(t => !txnIds.includes(t.id));
        renderReconTransactions();
        updateReconSummary();
    } catch (err) {
        console.error('[Banking] matchSelectedTransactions error:', err);
        Toast.error(err.message || 'Failed to match transactions');
    } finally {
        matchInFlight = false;
    }
}

async function completeReconciliation() {
    if (!currentReconId) { Toast.error('No active reconciliation'); return; }
    const fmt = AccountsCommon.formatCurrency;
    const bankId = reconBankDropdown?.getValue?.() || '';
    const bank = bankAccountsList.find(b => b.id === bankId);
    const bankLabel = bank ? `${bank.account_name}${bank.bank_name ? ' at ' + bank.bank_name : ''}` : 'this bank account';
    const stmtBal = parseFloat(document.getElementById('reconStatementBalance')?.value || 0);
    const stmtDate = document.getElementById('reconStatementDate')?.value || '';
    // Matched rows have already been spliced out of reconTransactions — the
    // remaining ones are the unmatched set.
    const matchedCount = reconMatchedCount;
    const unmatchedCount = reconTransactions.length;
    const ok = await Confirm.show({
        title: 'Complete Bank Reconciliation',
        message: `Finalise the reconciliation for ${bankLabel} as of ${stmtDate || 'the selected date'}? Statement balance ${fmt(stmtBal)}, ${matchedCount} transaction${matchedCount === 1 ? '' : 's'} matched${unmatchedCount > 0 ? `, ${unmatchedCount} still unmatched (these will remain in the next reconciliation)` : ''}. Once completed, this reconciliation is locked and cannot be reopened — any further changes require a new reconciliation.`,
        confirmText: 'Complete Reconciliation',
        type: 'warning'
    });
    if (!ok) return;

    try {
        await api.request(AccountsCommon.buildUrl(`bank/reconciliations/${currentReconId}/complete`), { method: 'POST' });
        Toast.success('Reconciliation completed');
        currentReconId = null;
        reconTransactions = [];
        reconMatchedCount = 0;
        reconMatchedAmount = 0;
        reconBookBalance = null;
        document.getElementById('reconWorkspace').style.display = 'none';
        await loadBankAccounts();
    } catch (err) {
        console.error('[Banking] completeReconciliation error:', err);
        Toast.error(err.message || 'Failed to complete reconciliation');
    }
}

// Abandon an in-progress reconciliation without finalising it. Without this, a
// started session could only be Completed — leaving no way to back out of a
// mistaken start (wrong bank/date) short of finalising a wrong reconciliation.
// Nothing is posted to the GL; matched rows are simply released.
async function abandonReconciliation() {
    if (!currentReconId) { Toast.error('No active reconciliation'); return; }
    const ok = await Confirm.show({
        title: 'Abandon Reconciliation',
        message: 'Discard this in-progress reconciliation? Any transactions you matched in this session are released back to unreconciled, and nothing is posted. This does not affect completed reconciliations.',
        confirmText: 'Abandon',
        type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`bank/reconciliations/${currentReconId}/abandon`), { method: 'POST' });
        Toast.success('Reconciliation abandoned');
        currentReconId = null;
        reconTransactions = [];
        reconMatchedCount = 0;
        reconMatchedAmount = 0;
        reconBookBalance = null;
        document.getElementById('reconWorkspace').style.display = 'none';
        await loadBankAccounts();
    } catch (err) {
        console.error('[Banking] abandonReconciliation error:', err);
        Toast.error(err.message || 'Failed to abandon reconciliation');
    }
}

// ============================================================================
// SEARCHABLE DROPDOWNS INIT
// ============================================================================

function initDropdowns() {
    const bankOpts = bankAccountsList.map(a => ({ value: a.id, label: a.account_name || a.name }));
    const bankOptsWithAll = [{ value: '', label: 'Select Bank Account' }, ...bankOpts];

    // Transaction bank filter
    const txnContainer = document.getElementById('txnBankFilterContainer');
    if (txnContainer) {
        txnBankFilterDropdown = new SearchableDropdown(txnContainer, {
            id: 'txnBankFilter',
            options: bankOptsWithAll,
            placeholder: 'Select Bank Account',
            compact: true,
            onChange: () => { currentTxnPage = 1; loadBankTransactions(); }
        });
    }

    // Transfer From
    const fromContainer = document.getElementById('transferFromContainer');
    if (fromContainer) {
        transferFromDropdown = new SearchableDropdown(fromContainer, {
            id: 'transferFrom',
            options: [{ value: '', label: 'Select Account' }, ...bankOpts],
            placeholder: 'From Account',
            compact: true
        });
    }

    // Transfer To
    const toContainer = document.getElementById('transferToContainer');
    if (toContainer) {
        transferToDropdown = new SearchableDropdown(toContainer, {
            id: 'transferTo',
            options: [{ value: '', label: 'Select Account' }, ...bankOpts],
            placeholder: 'To Account',
            compact: true
        });
    }

    // Reconciliation bank
    const reconContainer = document.getElementById('reconBankContainer');
    if (reconContainer) {
        reconBankDropdown = new SearchableDropdown(reconContainer, {
            id: 'reconBank',
            options: bankOptsWithAll,
            placeholder: 'Select Bank Account',
            compact: true
        });
    }

    // Import bank dropdown
    const importBankContainer = document.getElementById('importBankContainer');
    if (importBankContainer) {
        importBankDropdown = new SearchableDropdown(importBankContainer, {
            id: 'importBank',
            options: bankOptsWithAll,
            placeholder: 'Search bank account...',
            compact: true
        });
    }

    // Import counter account dropdown
    const counterOpts = [{ value: '', label: 'Select Counter Account' },
        ...coaAccounts
            .filter(a => a.allow_direct_posting)
            .map(a => ({ value: a.id, label: `${a.account_code} - ${a.account_name}` }))
    ];
    const importCounterContainer = document.getElementById('importCounterContainer');
    if (importCounterContainer) {
        importCounterDropdown = new SearchableDropdown(importCounterContainer, {
            id: 'importCounter',
            options: counterOpts,
            placeholder: 'Search GL account...',
            compact: true
        });
    }

    // Set default date for transfer
    const transferDate = document.getElementById('transferDate');
    if (transferDate && !transferDate.value) AccountsCommon.setDateField(transferDate, AccountsCommon.todayLocal());
}

function refreshBankDropdowns() {
    const bankOpts = bankAccountsList.map(a => ({ value: a.id, label: a.account_name || a.name }));
    const bankOptsWithAll = [{ value: '', label: 'Select Bank Account' }, ...bankOpts];
    txnBankFilterDropdown?.setOptions?.(bankOptsWithAll);
    transferFromDropdown?.setOptions?.([{ value: '', label: 'Select Account' }, ...bankOpts]);
    transferToDropdown?.setOptions?.([{ value: '', label: 'Select Account' }, ...bankOpts]);
    reconBankDropdown?.setOptions?.(bankOptsWithAll);
    importBankDropdown?.setOptions?.(bankOptsWithAll);
}

function refreshImportCounterDropdown() {
    if (!importCounterDropdown) return;
    const counterOpts = [{ value: '', label: 'Select Counter Account' },
        ...coaAccounts
            .filter(a => a.allow_direct_posting)
            .map(a => ({ value: a.id, label: `${a.account_code} - ${a.account_name}` }))
    ];
    importCounterDropdown.setOptions(counterOpts);
}

// ============================================================================
// 5. STATEMENT IMPORT
// ============================================================================

let importTabInitialized = false;

function initImportTab() {
    if (importTabInitialized) return;
    importTabInitialized = true;

    // Setup drag-and-drop
    const dropZone = document.getElementById('statementDropZone');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--brand-primary)';
            dropZone.style.background = 'var(--bg-tertiary)';
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = 'var(--border-primary)';
            dropZone.style.background = '';
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--border-primary)';
            dropZone.style.background = '';
            const file = e.dataTransfer?.files?.[0];
            if (file) processStatementFile(file);
        });
    }
}

async function downloadStatementTemplate() {
    try {
        const baseUrl = api._getBaseUrl('/accounts/');
        const url = `${baseUrl}/accounts/bank/statement-template?tenantId=${AccountsCommon.getTenantId()}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${api.token}` }
        });
        if (!response.ok) throw new Error('Failed to download template');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'bank_statement_template.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        Toast.success('Template downloaded');
    } catch (err) {
        console.error('[Import] Download template error:', err);
        Toast.error('Failed to download template');
    }
}

function handleStatementFileSelect(event) {
    const file = event.target.files?.[0];
    if (file) processStatementFile(file);
}

async function processStatementFile(file) {
    const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    if (!isXlsx && !isCsv) {
        Toast.error('Upload an .xlsx or .csv file');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        Toast.error('File too large (max 10MB)');
        return;
    }

    // Show selected file
    document.getElementById('statementSelectedFile').style.display = 'flex';
    document.getElementById('statementFileName').textContent = file.name;

    try {
        if (isCsv) {
            parseRowsAndPreview(parseCsvStatement(await file.text()));
        } else {
            const data = await file.arrayBuffer();
            parseExcelAndPreview(data);
        }
    } catch (err) {
        console.error('[Import] File read error:', err);
        Toast.error('Failed to read file');
    }
}

/**
 * CSV → row-of-cells matrix, quote-aware (handles "quoted, commas" and "" escapes).
 * Banks export CSV far more often than xlsx, so this accepts the same Date/Description/
 * Debit/Credit/Balance/Reference header layout as the Excel template.
 */
function parseCsvStatement(text) {
    if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip UTF-8 BOM (Excel/bank exports)
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; }
            else cell += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(c => c.trim() !== '')) rows.push(row);
            row = [];
        } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    return rows;
}

function parseExcelAndPreview(arrayBuffer) {
    // Use SheetJS if available, otherwise parse via backend
    // Since we're using OpenXML on backend, let's parse client-side with a lightweight approach
    // We'll use the XLSX library (SheetJS) which is commonly available
    if (typeof XLSX === 'undefined') {
        Toast.error('Excel parser not loaded. Please refresh the page.');
        return;
    }

    try {
        const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
        parseRowsAndPreview(rows);
    } catch (err) {
        console.error('[Import] Parse error:', err);
        Toast.error('Failed to parse Excel file: ' + err.message);
    }
}

/** Shared for xlsx + csv: cell matrix → validated parsedStatementRows → preview. */
function parseRowsAndPreview(rows) {
    showMatchCol = false;   // fresh file → matches from a previous file no longer apply
    try {
        if (rows.length < 2) {
            Toast.error('File has no data rows (only header found)');
            return;
        }

        // Find header row (look for "Date" in first few rows)
        let headerIdx = -1;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
            const row = rows[i];
            if (row && row.some(c => typeof c === 'string' && c.toLowerCase().trim() === 'date')) {
                headerIdx = i;
                break;
            }
        }
        if (headerIdx === -1) {
            Toast.error('Could not find header row with "Date" column');
            return;
        }

        const headers = rows[headerIdx].map(h => (h || '').toString().toLowerCase().trim());
        const colMap = {
            date: headers.indexOf('date'),
            description: headers.indexOf('description'),
            debit: headers.indexOf('debit'),
            credit: headers.indexOf('credit'),
            balance: headers.indexOf('balance'),
            reference: headers.indexOf('reference')
        };

        if (colMap.date === -1 || colMap.description === -1) {
            Toast.error('Template must have "Date" and "Description" columns');
            return;
        }
        if (colMap.debit === -1 && colMap.credit === -1) {
            Toast.error('Template must have "Debit" and/or "Credit" columns');
            return;
        }

        // Parse data rows (skip header, skip instruction rows)
        parsedStatementRows = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            const dateVal = colMap.date >= 0 ? (row[colMap.date] || '').toString().trim() : '';
            const desc = colMap.description >= 0 ? (row[colMap.description] || '').toString().trim() : '';
            const debitVal = colMap.debit >= 0 ? (row[colMap.debit] || '').toString().trim() : '';
            const creditVal = colMap.credit >= 0 ? (row[colMap.credit] || '').toString().trim() : '';
            const balVal = colMap.balance >= 0 ? (row[colMap.balance] || '').toString().trim() : '';
            const refVal = colMap.reference >= 0 ? (row[colMap.reference] || '').toString().trim() : '';

            // Skip empty/instruction rows
            if (!dateVal && !desc) continue;
            if (desc.toLowerCase().startsWith('instructions:')) continue;

            const parsedDate = parseFlexibleDate(dateVal);
            const debit = parseAmount(debitVal);
            const credit = parseAmount(creditVal);
            const balance = parseAmount(balVal);

            let status = 'valid';
            let error = '';
            if (!parsedDate) { status = 'error'; error = 'Invalid date'; }
            else if (debit === null && credit === null) { status = 'error'; error = 'No amount'; }
            else if (debit !== null && credit !== null && debit > 0 && credit > 0) { status = 'error'; error = 'Both debit & credit filled'; }
            else if (!desc) { status = 'error'; error = 'No description'; }

            parsedStatementRows.push({
                row_number: i + 1,
                date: parsedDate,
                date_str: dateVal,
                description: desc,
                debit, credit, balance,
                reference: refVal,
                status, error
            });
        }

        if (parsedStatementRows.length === 0) {
            Toast.error('No valid data rows found in the file');
            return;
        }

        renderImportPreview();
    } catch (err) {
        console.error('[Import] Parse error:', err);
        Toast.error('Failed to parse the statement: ' + err.message);
    }
}

function parseFlexibleDate(str) {
    if (!str) return null;
    // Build a Date only from a REAL calendar date — new Date() silently rolls
    // invalid parts over (month 15 → Mar next year, 31 Feb → 3 Mar), which used
    // to import US-format dates a year off with no error. Reject instead.
    const build = (y, mo, d) => {
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        const dt = new Date(y, mo - 1, d);
        return (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) ? dt : null;
    };
    // Try ISO: YYYY-MM-DD
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return build(+m[1], +m[2], +m[3]);
    // Slash/dash numeric: DD/MM/YYYY preferred (template convention); if the
    // middle part can't be a month (e.g. 03/15/2026), fall back to MM/DD/YYYY.
    // If neither reading is a valid date, fail loudly — the row gets flagged
    // "Invalid date" instead of importing a rolled-over date a year off.
    m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) {
        const a = +m[1], b = +m[2], y = +m[3];
        if (b >= 1 && b <= 12) {
            const ddmm = build(y, b, a);
            if (ddmm) return ddmm;
        }
        if (a >= 1 && a <= 12) return build(y, a, b); // MM/DD/YYYY
        return null;
    }
    // Try Date.parse as fallback (e.g. "15 Mar 2026")
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function parseAmount(str) {
    if (str == null) return null;
    const s = String(str).trim();
    if (!s) return null;
    // Bank-statement convention: parentheses mean negative, e.g. (500) => -500.
    const parenNegative = /^\(.*\)$/.test(s);
    // Remove currency symbols, commas, spaces
    const cleaned = s.replace(/[^0-9.\-]/g, '');
    if (!/\d/.test(cleaned)) return null; // truly non-numeric → "No amount"
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    // 0 and negatives are legitimate values — only non-numeric input returns null.
    return parenNegative ? -Math.abs(num) : num;
}

// ── Statement auto-match: suggest which open invoice/bill each row settles ──
let showMatchCol = false;

function matchCellHtml(r, i) {
    if (r.recorded) return `<span style="color:var(--color-success);font-weight:600;">✓ ${AccountsCommon.escapeHtml(r.recorded)}</span>`;
    const c = r.match;
    if (c === undefined) return '<span style="color:var(--text-secondary);font-size:0.8rem;">—</span>';
    if (!c) return '<span style="color:var(--text-secondary);font-size:0.8rem;">No match found</span>';
    const kindLabel = c.kind === 'customer_invoice' ? 'Receipt for' : 'Payment for';
    return `<div style="font-size:0.8rem;line-height:1.35;">
        <div><strong>${AccountsCommon.escapeHtml(c.doc_number)}</strong> · ${AccountsCommon.escapeHtml(c.party_name)}</div>
        <div style="color:var(--text-secondary);">${AccountsCommon.escapeHtml(c.reasons)}</div>
        <button class="btn btn-outline" style="height:26px;padding:0 10px;font-size:0.75rem;margin-top:3px;"
            onclick="recordMatchedRow(${i})">${kindLabel} ${AccountsCommon.formatCurrency(r.credit ?? r.debit ?? 0)}</button>
    </div>`;
}

async function suggestStatementMatches() {
    const valid = parsedStatementRows.filter(r => r.status === 'valid');
    if (!valid.length) { Toast.error('No valid rows to match'); return; }
    try {
        const payload = valid.map(r => ({
            transaction_date: AccountsCommon.toDateInput(r.date),
            description: r.description,
            debit: r.debit ?? null, credit: r.credit ?? null,
            reference_number: r.reference || null
        }));
        const res = await api.request(AccountsCommon.buildUrl('bank/match-suggestions'), {
            method: 'POST', body: JSON.stringify({ transactions: payload })
        });
        // res[i] pairs with valid[i]; store the TOP candidate on the row.
        let matched = 0;
        valid.forEach((r, vi) => {
            const s = (res || []).find(x => x.row_index === vi);
            r.match = s?.candidates?.length ? s.candidates[0] : null;
            if (r.match) matched++;
        });
        showMatchCol = true;
        renderImportPreview();
        Toast.success(matched ? `${matched} of ${valid.length} rows matched to open invoices/bills` : 'No confident matches found');
    } catch (err) { Toast.error(err.message || 'Match suggestion failed'); }
}

/**
 * One-click record of a matched row: credit → customer receipt against the invoice,
 * debit → vendor payment against the bill, into the bank account selected for this
 * import. The row is then EXCLUDED from Confirm Import — the receipt/payment already
 * moved the bank GL, importing it again would double-book the money.
 */
async function recordMatchedRow(i) {
    const r = parsedStatementRows[i];
    const c = r?.match;
    if (!r || !c || r.recorded) return;
    const bankId = importBankDropdown?.getValue?.();
    if (!bankId) { Toast.error('Pick the bank account (step 1) first — the receipt/payment posts into it'); return; }
    const amount = Math.min(r.credit ?? r.debit ?? 0, c.balance_due);
    const dateStr = AccountsCommon.toDateInput(r.date);
    // Idempotency key: stable across RETRIES of THIS row, but UNIQUE per statement row — include the
    // row index + date so two equal-amount lines to the same invoice (e.g. equal instalments) don't
    // collide and silently drop the second payment.
    const idemKey = `stmt-${c.kind}-${c.doc_id}-${i}-${AccountsCommon.toDateInput(r.date)}-${amount}`;
    try {
        if (c.kind === 'customer_invoice') {
            await api.request(AccountsCommon.buildUrl('invoices/payments'), {
                method: 'POST',
                headers: { 'Idempotency-Key': idemKey },
                body: JSON.stringify({
                    customer_id: c.party_id, payment_date: dateStr, amount, tds_amount: 0,
                    bank_account_id: bankId, payment_method: 'bank_transfer',
                    reference_number: r.reference || 'Statement import',
                    allocations: [{ customer_invoice_id: c.doc_id, allocated_amount: amount }]
                })
            });
        } else {
            await api.request(AccountsCommon.buildUrl('vendor-bills/payments'), {
                method: 'POST',
                headers: { 'Idempotency-Key': idemKey },
                body: JSON.stringify({
                    vendor_id: c.party_id, payment_date: dateStr, amount,
                    bank_account_id: bankId, payment_method: 'bank_transfer',
                    reference_number: r.reference || 'Statement import',
                    allocations: [{ vendor_bill_id: c.doc_id, allocated_amount: amount }]
                })
            });
        }
        r.recorded = `${c.kind === 'customer_invoice' ? 'Receipt' : 'Payment'} · ${c.doc_number}`;
        renderImportPreview();
        Toast.success(`${r.recorded} recorded — row excluded from the raw import`);
    } catch (err) { Toast.error(err.message || 'Recording failed'); }
}

function renderImportPreview() {
    document.getElementById('importStep1').style.display = 'none';
    document.getElementById('importStep2').style.display = '';
    document.getElementById('importStep3').style.display = 'none';

    const valid = parsedStatementRows.filter(r => r.status === 'valid');
    const errors = parsedStatementRows.filter(r => r.status === 'error');

    document.getElementById('importRowCount').textContent = valid.length;

    // Summary
    const summary = document.getElementById('importValidationSummary');
    let summaryHtml = `<div style="display:flex;gap:1.5rem;flex-wrap:wrap;">`;
    summaryHtml += `<span style="color:var(--color-success);font-weight:500;">${valid.length} valid</span>`;
    if (errors.length > 0)
        summaryHtml += `<span style="color:var(--color-error);font-weight:500;">${errors.length} errors (will be skipped)</span>`;
    summaryHtml += `</div>`;
    summary.innerHTML = summaryHtml;

    // Table
    const tbody = document.getElementById('importPreviewTable');
    const fmt = AccountsCommon.formatCurrency;
    tbody.innerHTML = parsedStatementRows.map((r, i) => {
        const rowStyle = r.status === 'error' ? 'background:rgba(var(--color-error-rgb, 220,53,69),0.08);' : '';
        const statusBadge = r.status === 'error'
            ? `<span class="badge" style="background:var(--color-error);color:#fff;font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;" title="${AccountsCommon.escapeHtml(r.error)}">Error</span>`
            : `<span class="badge" style="background:var(--color-success);color:#fff;font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;">OK</span>`;
        // toDateInput (local) — toISOString() shifts local-midnight Dates back a day in IST,
        // making the preview disagree with the (correct) import payload.
        const dateStr = r.date ? AccountsCommon.toDateInput(r.date) : r.date_str;
        return `<tr style="${rowStyle}">
            <td>${i + 1}</td>
            <td>${statusBadge}</td>
            <td>${AccountsCommon.escapeHtml(dateStr)}</td>
            <td>${AccountsCommon.escapeHtml(r.description)}</td>
            <td style="text-align:right;">${r.debit != null ? fmt(r.debit) : ''}</td>
            <td style="text-align:right;">${r.credit != null ? fmt(r.credit) : ''}</td>
            <td style="text-align:right;">${r.balance != null ? fmt(r.balance) : ''}</td>
            <td>${AccountsCommon.escapeHtml(r.reference || '')}</td>
            <td class="import-match-cell" data-row="${i}" style="display:${showMatchCol ? '' : 'none'};">${matchCellHtml(r, i)}</td>
        </tr>`;
    }).join('');
    document.getElementById('importMatchTh').style.display = showMatchCol ? '' : 'none';

    // Disable confirm if no valid rows
    document.getElementById('confirmImportBtn').disabled = valid.length === 0;
}

async function confirmStatementImport() {
    const bankId = importBankDropdown?.getValue?.();
    const counterId = importCounterDropdown?.getValue?.();

    if (!bankId) { Toast.error('Please select a bank account'); return; }
    if (!counterId) { Toast.error('Please select a counter account'); return; }

    // Rows already recorded as receipts/payments are EXCLUDED: those postings moved the
    // bank GL through the payment flows — importing them again would double-book the money.
    const validRows = parsedStatementRows.filter(r => r.status === 'valid' && !r.recorded);
    if (validRows.length === 0) { Toast.error(parsedStatementRows.some(r => r.recorded) ? 'All rows were recorded as receipts/payments — nothing left to import as raw transactions' : 'No valid rows to import'); return; }

    const payload = {
        counter_account_id: counterId,
        transactions: validRows.map(r => ({
            transaction_date: r.date.getFullYear() + '-' + String(r.date.getMonth()+1).padStart(2,'0') + '-' + String(r.date.getDate()).padStart(2,'0'),
            description: r.description,
            // ?? not ||: a genuine 0 amount must survive to the payload
            debit: r.debit ?? null,
            credit: r.credit ?? null,
            balance: r.balance ?? null,
            reference_number: r.reference || null
        })),
        skip_duplicates: true
    };

    const btn = document.getElementById('confirmImportBtn');
    try {
        btn.disabled = true;
        btn.textContent = 'Importing...';

        const result = await api.request(AccountsCommon.buildUrl(`bank/accounts/${bankId}/import-statement`), {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        showImportResults(result);
        Toast.success(`Imported ${result.imported} transactions`);
    } catch (err) {
        console.error('[Import] Error:', err);
        Toast.error(err.message || 'Import failed');
    } finally {
        // Restore in finally — the success path used to leave the button stuck on
        // "Importing..." for the next import cycle (step 2 is re-shown via
        // "Import Another", which never reset the label).
        btn.disabled = false;
        btn.textContent = 'Confirm Import';
    }
}

function showImportResults(result) {
    document.getElementById('importStep1').style.display = 'none';
    document.getElementById('importStep2').style.display = 'none';
    document.getElementById('importStep3').style.display = '';

    const container = document.getElementById('importResultsContent');
    let html = `<h4 style="margin-bottom:1rem;">Import Complete</h4>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem;">`;
    html += `<div class="stat-card"><div class="stat-value">${result.total_rows}</div><div class="stat-label">Total Rows</div></div>`;
    html += `<div class="stat-card"><div class="stat-value" style="color:var(--color-success);">${result.imported}</div><div class="stat-label">Imported</div></div>`;
    if (result.skipped_duplicates > 0)
        html += `<div class="stat-card"><div class="stat-value" style="color:var(--color-warning);">${result.skipped_duplicates}</div><div class="stat-label">Duplicates Skipped</div></div>`;
    if (result.skipped_errors > 0)
        html += `<div class="stat-card"><div class="stat-value" style="color:var(--color-error);">${result.skipped_errors}</div><div class="stat-label">Errors Skipped</div></div>`;
    html += `</div>`;

    if (result.errors?.length > 0) {
        html += `<h5 style="margin-bottom:0.5rem;">Errors</h5>`;
        html += `<div class="data-table-container" style="max-height:200px;overflow-y:auto;">`;
        html += `<table class="data-table"><thead><tr><th>Row</th><th>Error</th></tr></thead><tbody>`;
        result.errors.forEach(e => {
            html += `<tr><td>${e.row_number}</td><td>${AccountsCommon.escapeHtml(e.message)}</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    html += `<div style="margin-top:1.5rem;"><button class="btn btn-primary" onclick="resetStatementImport()">Import Another</button></div>`;
    container.innerHTML = html;
}

function cancelStatementImport() {
    resetStatementImport();
}

function resetStatementImport() {
    parsedStatementRows = [];
    document.getElementById('importStep1').style.display = '';
    document.getElementById('importStep2').style.display = 'none';
    document.getElementById('importStep3').style.display = 'none';
    document.getElementById('statementSelectedFile').style.display = 'none';
    document.getElementById('statementFileName').textContent = '';
    const fileInput = document.getElementById('statementFileInput');
    if (fileInput) fileInput.value = '';
}

function clearStatementFile() {
    resetStatementImport();
}

// ============================================================================
// CHEQUES / PDC REGISTER
// The register tracks cheques with NO money movement; CLEARING is the only
// money-moving step — the backend posts through the standard payment paths
// (customer advance for received cheques; allocated vendor payment for issued).
// ============================================================================

let pdcCache = [];
let pdcCustomers = [];
let pdcVendors = [];
let pdcDirectionDD = null, pdcPartyDD = null, pdcDepositBankDD = null, pdcClearBankDD = null;
let pdcClearCheque = null;   // the cheque object open in the clear modal

async function loadPdcCheques() {
    try {
        const direction = document.getElementById('pdcDirectionFilter')?.value || '';
        const status = document.getElementById('pdcStatusFilter')?.value || '';
        const params = { limit: 500 };
        if (direction) params.direction = direction;
        if (status) params.status = status;
        const res = await api.request(AccountsCommon.buildUrl('pdc-cheques', params), { _skipSpinner: true });
        pdcCache = Array.isArray(res) ? res : (res?.data || res?.items || []);

        // KPIs always cover ALL cheques regardless of filters.
        let all = pdcCache;
        if (direction || status) {
            try {
                const allRes = await api.request(AccountsCommon.buildUrl('pdc-cheques', { limit: 500 }), { _skipSpinner: true });
                all = Array.isArray(allRes) ? allRes : (allRes?.data || allRes?.items || []);
            } catch { /* keep filtered set */ }
        }
        const open = (c) => c.status === 'pending' || c.status === 'deposited';
        const inHand = all.filter(c => c.direction === 'received' && open(c));
        const outstanding = all.filter(c => c.direction === 'issued' && open(c));
        const soon = new Date(); soon.setDate(soon.getDate() + 7);
        const dueSoon = all.filter(c => open(c) && new Date(c.cheque_date) <= soon);
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
        document.getElementById('pdcPendingIn').textContent = AccountsCommon.formatCurrency(inHand.reduce((s, c) => s + Number(c.amount), 0));
        document.getElementById('pdcDueSoon').textContent = AccountsCommon.formatCurrency(dueSoon.reduce((s, c) => s + Number(c.amount), 0));
        document.getElementById('pdcPendingOut').textContent = AccountsCommon.formatCurrency(outstanding.reduce((s, c) => s + Number(c.amount), 0));
        document.getElementById('pdcBouncedCount').textContent = all.filter(c => c.status === 'bounced' && new Date(c.updated_at) >= cutoff).length;
        renderPdcTable();
    } catch (err) {
        console.error('[PDC] load error:', err);
        Toast.error('Failed to load the cheque register');
    }
}

function renderPdcTable() {
    const tbody = document.getElementById('pdcTable');
    if (!tbody) return;
    const esc = AccountsCommon.escapeHtml;
    const q = (document.getElementById('pdcSearch')?.value || '').trim().toLowerCase();
    const rows = pdcCache.filter(c => !q ||
        (c.cheque_number || '').toLowerCase().includes(q) ||
        (c.party_name || '').toLowerCase().includes(q) ||
        (c.bank_name || '').toLowerCase().includes(q));
    if (!rows.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
            <p>${q ? 'No cheques match your search' : 'No cheques registered — post-dated cheques you hold or hand out live here'}</p></div></td></tr>`;
        return;
    }
    const icon = {
        deposit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        clear: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
        bounce: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
        print: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
        del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
    };
    tbody.innerHTML = rows.map(c => {
        const acts = [];
        const open = c.status === 'pending' || c.status === 'deposited';
        if (c.status === 'pending' && c.direction === 'received')
            acts.push(`<button class="btn-icon" onclick="showPdcDepositModal('${c.id}')" data-tooltip="Deposit into bank" data-admin-only>${icon.deposit}</button>`);
        if (open)
            acts.push(`<button class="btn-icon" onclick="showPdcClearModal('${c.id}')" data-tooltip="Clear (posts money)" data-admin-only>${icon.clear}</button>`);
        if (open)
            acts.push(`<button class="btn-icon btn-icon-danger" onclick="bouncePdcCheque('${c.id}')" data-tooltip="Mark bounced" data-admin-only>${icon.bounce}</button>`);
        if (c.direction === 'issued')
            acts.push(`<button class="btn-icon" onclick="printPdcCheque('${c.id}')" data-tooltip="Print cheque">${icon.print}</button>`);
        if (c.status === 'pending')
            acts.push(`<button class="btn-icon btn-icon-danger" onclick="deletePdcCheque('${c.id}')" data-tooltip="Delete" data-admin-only>${icon.del}</button>`);
        const dirBadge = c.direction === 'received'
            ? '<span class="status-badge status-accepted">Received</span>'
            : '<span class="status-badge status-sent">Issued</span>';
        const postDated = new Date(c.cheque_date) > new Date() ? ' <span style="color:var(--color-warning);font-size:.75rem;">(post-dated)</span>' : '';
        return `<tr>
            <td><strong>${esc(c.cheque_number)}</strong>${c.status === 'bounced' && c.bounce_reason ? `<br><span style="font-size:.75rem;color:var(--color-error);">${esc(c.bounce_reason)}</span>` : ''}</td>
            <td>${dirBadge}</td>
            <td>${esc(c.party_name || '')}</td>
            <td>${esc(c.bank_name || '—')}</td>
            <td>${AccountsCommon.formatDate(c.cheque_date)}${postDated}</td>
            <td style="text-align:right;">${AccountsCommon.formatCurrency(c.amount)}</td>
            <td>${AccountsCommon.statusBadge(c.status)}</td>
            <td class="table-actions">${acts.join('')}</td>
        </tr>`;
    }).join('');
    accountsRoles.applyRBAC();
}

// ── Register modal ──────────────────────────────────────────────────────────

async function ensurePdcParties() {
    if (!pdcCustomers.length) {
        try { pdcCustomers = await api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }); } catch { pdcCustomers = []; }
        pdcCustomers = Array.isArray(pdcCustomers) ? pdcCustomers : (pdcCustomers?.data || []);
    }
    if (!pdcVendors.length) {
        try { pdcVendors = await api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }); } catch { pdcVendors = []; }
        pdcVendors = Array.isArray(pdcVendors) ? pdcVendors : (pdcVendors?.data || []);
    }
}

function buildPdcPartyDD(direction) {
    const list = direction === 'issued' ? pdcVendors : pdcCustomers;
    pdcPartyDD = new SearchableDropdown(document.getElementById('pdcPartyDD'), {
        id: 'pdcPartySD',
        options: [{ value: '', label: direction === 'issued' ? 'Select vendor...' : 'Select customer...' },
            ...list.filter(p => p.is_active !== false).map(p => ({ value: p.id, label: p.name }))],
        value: '', placeholder: direction === 'issued' ? 'Select vendor...' : 'Select customer...', searchPlaceholder: 'Search…'
    });
}

async function showPdcModal() {
    await ensurePdcParties();
    document.getElementById('pdcNumber').value = '';
    document.getElementById('pdcBankName').value = '';
    document.getElementById('pdcAmount').value = '';
    document.getElementById('pdcMemo').value = '';
    if (typeof flatpickr === 'function') flatpickr('#pdcDate', { dateFormat: 'Y-m-d', allowInput: true, defaultDate: new Date() });
    pdcDirectionDD = new SearchableDropdown(document.getElementById('pdcDirectionDD'), {
        id: 'pdcDirectionSD',
        options: [
            { value: 'received', label: 'Received — customer\'s cheque we hold' },
            { value: 'issued', label: 'Issued — our cheque given to a vendor' }
        ],
        value: 'received',
        onChange: (v) => buildPdcPartyDD(v)
    });
    buildPdcPartyDD('received');
    AccountsCommon.openModal('pdcModal');
}

async function savePdcCheque() {
    const direction = pdcDirectionDD?.getValue?.() || 'received';
    const partyId = pdcPartyDD?.getValue?.();
    if (!partyId) { Toast.error(direction === 'issued' ? 'Pick a vendor' : 'Pick a customer'); return; }
    const amount = parseFloat(document.getElementById('pdcAmount').value);
    if (!(amount > 0)) { Toast.error('Enter the cheque amount'); return; }
    const number = document.getElementById('pdcNumber').value.trim();
    if (!number) { Toast.error('Enter the cheque number'); return; }
    const date = document.getElementById('pdcDate').value;
    if (!date) { Toast.error('Pick the cheque date'); return; }
    const btn = document.getElementById('pdcSaveBtn');
    btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl('pdc-cheques'), {
            method: 'POST',
            body: JSON.stringify({
                direction,
                customer_id: direction === 'received' ? partyId : null,
                vendor_id: direction === 'issued' ? partyId : null,
                cheque_number: number,
                bank_name: document.getElementById('pdcBankName').value.trim() || null,
                cheque_date: date,
                amount: Math.round(amount * 100) / 100,
                memo: document.getElementById('pdcMemo').value.trim() || null
            })
        });
        Toast.success('Cheque registered — no money moves until it clears');
        AccountsCommon.closeModal('pdcModal');
        loadPdcCheques();
    } catch (err) {
        Toast.error(err?.message || 'Failed to register cheque');
    } finally { btn.disabled = false; }
}

// ── Deposit ─────────────────────────────────────────────────────────────────

function pdcBankOptions() {
    return [{ value: '', label: 'Select bank account...' },
        ...bankAccountsList.filter(b => b.is_active !== false).map(b => ({ value: b.id, label: b.account_name }))];
}

function showPdcDepositModal(id) {
    const ch = pdcCache.find(c => c.id === id);
    if (!ch) return;
    document.getElementById('pdcDepositId').value = id;
    document.getElementById('pdcDepositSummary').innerHTML =
        `Cheque <strong>${AccountsCommon.escapeHtml(ch.cheque_number)}</strong> from <strong>${AccountsCommon.escapeHtml(ch.party_name || '')}</strong> for <strong>${AccountsCommon.formatCurrency(ch.amount)}</strong>`;
    pdcDepositBankDD = new SearchableDropdown(document.getElementById('pdcDepositBankDD'), {
        id: 'pdcDepositBankSD', options: pdcBankOptions(), value: '', placeholder: 'Select bank account...'
    });
    if (typeof flatpickr === 'function') flatpickr('#pdcDepositDate', { dateFormat: 'Y-m-d', allowInput: true, defaultDate: new Date() });
    AccountsCommon.openModal('pdcDepositModal');
}

async function savePdcDeposit() {
    const id = document.getElementById('pdcDepositId').value;
    const bankId = pdcDepositBankDD?.getValue?.();
    if (!bankId) { Toast.error('Pick the bank account'); return; }
    try {
        await api.request(AccountsCommon.buildUrl(`pdc-cheques/${id}/deposit`), {
            method: 'POST',
            body: JSON.stringify({ bank_account_id: bankId, deposited_date: document.getElementById('pdcDepositDate').value || null })
        });
        Toast.success('Cheque deposited — clear it once the bank confirms');
        AccountsCommon.closeModal('pdcDepositModal');
        loadPdcCheques();
    } catch (err) { Toast.error(err?.message || 'Failed to deposit cheque'); }
}

// ── Clear ───────────────────────────────────────────────────────────────────

async function showPdcClearModal(id) {
    const ch = pdcCache.find(c => c.id === id);
    if (!ch) return;
    pdcClearCheque = ch;
    document.getElementById('pdcClearId').value = id;
    document.getElementById('pdcClearSummary').innerHTML =
        `Cheque <strong>${AccountsCommon.escapeHtml(ch.cheque_number)}</strong> ${ch.direction === 'received' ? 'from' : 'to'} <strong>${AccountsCommon.escapeHtml(ch.party_name || '')}</strong> for <strong>${AccountsCommon.formatCurrency(ch.amount)}</strong>`;
    pdcClearBankDD = new SearchableDropdown(document.getElementById('pdcClearBankDD'), {
        id: 'pdcClearBankSD', options: pdcBankOptions(), value: ch.bank_account_id || '', placeholder: 'Select bank account...'
    });
    if (typeof flatpickr === 'function') flatpickr('#pdcClearDate', { dateFormat: 'Y-m-d', allowInput: true, defaultDate: new Date() });

    const allocWrap = document.getElementById('pdcClearAllocs');
    const advanceNote = document.getElementById('pdcClearAdvanceNote');
    if (ch.direction === 'issued') {
        advanceNote.style.display = 'none';
        allocWrap.style.display = '';
        document.getElementById('pdcClearAmount').textContent = AccountsCommon.formatCurrency(ch.amount);
        document.getElementById('pdcClearBillRows').innerHTML = '<tr><td colspan="3" style="color:var(--text-secondary);">Loading open bills…</td></tr>';
        try {
            const res = await api.request(AccountsCommon.buildUrl('vendor-bills', { vendorId: ch.vendor_id, limit: 200 }), { _skipSpinner: true });
            const bills = (Array.isArray(res) ? res : (res?.bills || res?.data || res?.items || []))
                .filter(b => ['approved', 'partially_paid', 'overdue'].includes(b.status) && parseFloat(b.balance_due ?? 0) > 0);
            if (!bills.length) {
                document.getElementById('pdcClearBillRows').innerHTML = '<tr><td colspan="3" style="color:var(--color-error);">No open bills for this vendor — approve the bill first, then clear the cheque.</td></tr>';
            } else {
                // Auto-allocate oldest-first up to the cheque amount (still editable).
                let remaining = Number(ch.amount);
                document.getElementById('pdcClearBillRows').innerHTML = bills.map(b => {
                    const due = parseFloat(b.balance_due ?? 0);
                    const take = Math.min(due, Math.max(0, remaining));
                    remaining = Math.round((remaining - take) * 100) / 100;
                    return `<tr data-bill="${b.id}">
                        <td>${AccountsCommon.escapeHtml(b.bill_number || '')}<br><span style="font-size:.75rem;color:var(--text-secondary);">${AccountsCommon.formatDate(b.bill_date)}</span></td>
                        <td style="text-align:right;">${AccountsCommon.formatCurrency(due)}</td>
                        <td><input type="number" class="form-control pdc-alloc" value="${take || ''}" min="0" max="${due}" step="0.01" oninput="updatePdcAllocTotal()"></td>
                    </tr>`;
                }).join('');
            }
        } catch {
            document.getElementById('pdcClearBillRows').innerHTML = '<tr><td colspan="3" style="color:var(--color-error);">Failed to load bills</td></tr>';
        }
        updatePdcAllocTotal();
    } else {
        allocWrap.style.display = 'none';
        advanceNote.style.display = '';
    }
    AccountsCommon.openModal('pdcClearModal');
}

function updatePdcAllocTotal() {
    let total = 0;
    document.querySelectorAll('#pdcClearBillRows .pdc-alloc').forEach(el => { total += parseFloat(el.value) || 0; });
    total = Math.round((total + Number.EPSILON) * 100) / 100;
    const el = document.getElementById('pdcClearAllocTotal');
    el.textContent = AccountsCommon.formatCurrency(total);
    el.style.color = pdcClearCheque && total !== Number(pdcClearCheque.amount) ? 'var(--color-error)' : 'var(--color-success)';
}

async function savePdcClear() {
    const id = document.getElementById('pdcClearId').value;
    const ch = pdcClearCheque;
    const bankId = pdcClearBankDD?.getValue?.();
    if (!bankId) { Toast.error('Pick the bank account'); return; }
    const body = { bank_account_id: bankId, cleared_date: document.getElementById('pdcClearDate').value || null };
    if (ch?.direction === 'issued') {
        const allocations = [];
        document.querySelectorAll('#pdcClearBillRows tr[data-bill]').forEach(row => {
            const amt = parseFloat(row.querySelector('.pdc-alloc')?.value) || 0;
            if (amt > 0) allocations.push({ vendor_bill_id: row.dataset.bill, allocated_amount: Math.round(amt * 100) / 100 });
        });
        if (!allocations.length) { Toast.error('Allocate the cheque to at least one bill'); return; }
        body.allocations = allocations;
    }
    const btn = document.getElementById('pdcClearBtn');
    btn.disabled = true;
    try {
        await api.request(AccountsCommon.buildUrl(`pdc-cheques/${id}/clear`), { method: 'POST', body: JSON.stringify(body) });
        Toast.success(ch?.direction === 'received'
            ? 'Cheque cleared — posted as a customer advance; allocate it on Receivables → Payments'
            : 'Cheque cleared — vendor payment posted against the bills');
        AccountsCommon.closeModal('pdcClearModal');
        loadPdcCheques();
    } catch (err) {
        Toast.error(err?.message || 'Failed to clear cheque');
    } finally { btn.disabled = false; }
}

// ── Bounce / delete ─────────────────────────────────────────────────────────

async function bouncePdcCheque(id) {
    const ok = await Confirm.show({
        title: 'Mark this cheque as bounced?',
        message: 'Use when the bank dishonours it. No money had moved, so nothing posts — the register records the dishonour.',
        confirmText: 'Mark Bounced', type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`pdc-cheques/${id}/bounce`), { method: 'POST', body: JSON.stringify({ reason: 'Dishonoured by bank' }) });
        Toast.success('Cheque marked bounced');
        loadPdcCheques();
    } catch (err) { Toast.error(err?.message || 'Failed to mark bounced'); }
}

async function deletePdcCheque(id) {
    const ok = await Confirm.show({
        title: 'Delete this cheque entry?',
        message: 'Pending entries have no money behind them — deleting is safe.',
        confirmText: 'Delete', type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl('pdc-cheques/' + id), { method: 'DELETE' });
        Toast.success('Cheque entry deleted');
        loadPdcCheques();
    } catch (err) { Toast.error(err?.message || 'Failed to delete'); }
}

// ── Cheque printing (issued cheques) ────────────────────────────────────────

// Indian-system amount in words (lakh / crore), paise-aware — banks reject
// mismatched words vs figures, so this must be exact.
function amountInWordsINR(amount) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
        'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = (n) => n < 20 ? ones[n] : (tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''));
    const three = (n) => (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
    const parts = [];
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const rest = rupees % 1000;
    if (crore) parts.push(three(crore) + ' Crore');
    if (lakh) parts.push(two(lakh) + ' Lakh');
    if (thousand) parts.push(two(thousand) + ' Thousand');
    if (rest) parts.push(three(rest));
    let words = parts.length ? parts.join(' ') + (parts.length ? ' Rupees' : '') : '';
    if (paise) words += (words ? ' and ' : '') + two(paise) + ' Paise';
    return words + ' Only';
}

function printPdcCheque(id) {
    const ch = pdcCache.find(c => c.id === id);
    if (!ch) return;
    const esc = AccountsCommon.escapeHtml;
    const d = new Date(ch.cheque_date);
    const dateDigits = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + d.getFullYear();
    const figures = Number(ch.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const w = window.open('', '_blank');
    if (!w) { Toast.error('Allow pop-ups to print the cheque'); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>Cheque ${esc(ch.cheque_number)}</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Courier New', monospace; padding: 24px; color: #111; }
    .hint { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #666; margin-bottom: 14px; max-width: 640px; }
    /* Standard CTS-2010 cheque leaf is 202 × 92 mm — rendered here at ~3.78px/mm */
    .cheque { position: relative; width: 764px; height: 348px; border: 1px dashed #999; }
    .field { position: absolute; font-size: 15px; font-weight: 600; letter-spacing: 0.5px; }
    .date { top: 22px; right: 28px; letter-spacing: 8px; font-size: 16px; }
    .payee { top: 78px; left: 90px; max-width: 540px; }
    .words { top: 118px; left: 130px; max-width: 480px; line-height: 1.7; }
    .figures { top: 150px; right: 40px; border: 1.5px solid #111; padding: 5px 12px; font-size: 16px; }
    .acpayee { position: absolute; top: 8px; left: 60px; transform: rotate(-18deg); border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; font-size: 11px; padding: 1px 6px; font-weight: 700; }
    .memoline { position: absolute; bottom: 60px; left: 28px; font-size: 11px; color: #555; font-family: 'Segoe UI', Arial, sans-serif; }
    @media print { .hint { display: none; } .cheque { border: none; } body { padding: 0; } }
</style></head><body>
    <p class="hint"><strong>Cheque overlay — ${esc(ch.cheque_number)}.</strong> Load the bank's cheque leaf into the printer and print this page at 100% scale (no fit-to-page).
    Positions follow the standard CTS-2010 leaf (202×92mm); fine-tune printer margins if your bank's leaf differs. The dashed outline does not print.</p>
    <div class="cheque">
        <div class="acpayee">A/c Payee Only</div>
        <div class="field date">${dateDigits}</div>
        <div class="field payee">${esc(ch.party_name || '')}</div>
        <div class="field words">${esc(amountInWordsINR(Number(ch.amount)))}</div>
        <div class="field figures">₹ ${figures}/-</div>
        <div class="memoline">${esc(ch.memo || '')} · CHQ ${esc(ch.cheque_number)}${ch.bank_name ? ' · ' + esc(ch.bank_name) : ''}</div>
    </div>
    <script>window.onload = () => window.print();<\/script>
</body></html>`);
    w.document.close();
}
