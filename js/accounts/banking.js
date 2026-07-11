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
let bankTransactions = [];
let recentTransfers = [];
let currentTxnPage = 1;
let currentReconId = null;
let reconTransactions = [];
// Matched rows are spliced out of reconTransactions after each PUT, so keep a
// running count for the Complete Reconciliation summary (the transaction model
// has no is_matched field).
let reconMatchedCount = 0;
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
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'bank-accounts':      loadBankAccounts(); break;
        case 'bank-transactions':  loadBankTransactions(); break;
        case 'bank-transfers':     loadRecentTransfers(); break;
        case 'statement-import':   initImportTab(); break;
        case 'reconciliation':     break; // user-triggered
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        const [bankRes, coaRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => [])
        ]);

        bankAccountsList = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);
        coaAccounts = Array.isArray(coaRes) ? coaRes : (coaRes?.data || coaRes?.items || []);

        updateBankAccountStats();
        renderBankAccountsTable();

        // Dashboard stats are already shown by updateBankAccountStats() above.
        // loadBankDashboard() was duplicating the same info — disabled.
        // loadBankDashboard();
    } catch (err) {
        console.error('[Banking] loadInitialData error:', err);
    }
}

async function loadBankDashboard() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('bank/dashboard'), { _skipSpinner: true });
        const dashboard = res?.data || res;
        if (!dashboard) return;

        const container = document.getElementById('bankDashboardStats');
        if (!container) return;

        const fmt = AccountsCommon.formatCurrency;
        const totalBalance = dashboard.total_balance ?? dashboard.totalBalance;
        const accountCount = dashboard.account_count ?? dashboard.accountCount ?? bankAccountsList.length;
        const totalDeposits = dashboard.total_deposits ?? dashboard.totalDeposits;
        const totalWithdrawals = dashboard.total_withdrawals ?? dashboard.totalWithdrawals;

        let statsHtml = '';
        if (totalBalance != null) {
            statsHtml += `<div class="stat-card"><div class="stat-value">${fmt(totalBalance)}</div><div class="stat-label">Total Balance</div></div>`;
        }
        if (accountCount != null) {
            statsHtml += `<div class="stat-card"><div class="stat-value">${accountCount}</div><div class="stat-label">Accounts</div></div>`;
        }
        if (totalDeposits != null) {
            statsHtml += `<div class="stat-card"><div class="stat-value">${fmt(totalDeposits)}</div><div class="stat-label">Total Deposits</div></div>`;
        }
        if (totalWithdrawals != null) {
            statsHtml += `<div class="stat-card"><div class="stat-value">${fmt(totalWithdrawals)}</div><div class="stat-label">Total Withdrawals</div></div>`;
        }

        if (statsHtml) {
            container.innerHTML = statsHtml;
            container.style.display = '';
        }
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
    sel.innerHTML = '<option value="">Select GL Account...</option>' +
        coaAccounts.map(a => {
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
        refreshBankDropdowns();
    } catch (err) {
        console.error('[Banking] saveBankAccount error:', err);
        Toast.error(err.message || 'Failed to save bank account');
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

        const total = res?.total || res?.totalCount || bankTransactions.length;
        const totalPages = Math.ceil(total / TXN_PAGE_SIZE) || 1;

        renderBankTransactionsTable();
        AccountsCommon.renderPagination('bankTxnPagination', currentTxnPage, totalPages, (page) => {
            currentTxnPage = page;
            loadBankTransactions();
        });
    } catch (err) {
        console.error('[Banking] loadBankTransactions error:', err);
        Toast.error('Failed to load transactions');
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
    document.getElementById('txnDate').value = new Date().toISOString().split('T')[0];

    const bankId = txnBankFilterDropdown?.getValue?.() || '';
    document.getElementById('txnBankAccountId').value = bankId;

    populateCounterAccountSelect();
    AccountsCommon.openModal('bankTransactionModal');
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

    const payload = {
        bank_account_id: bankAccountId,
        transaction_date: txnDate,
        transaction_type: txnType,
        amount,
        description: document.getElementById('txnDescription').value.trim() || null,
        reference_number: document.getElementById('txnReference').value.trim() || null,
        counter_account_id: counterAccountId
    };

    try {
        await api.request(AccountsCommon.buildUrl(`bank/accounts/${bankAccountId}/transactions`), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Transaction recorded');
        AccountsCommon.closeModal('bankTransactionModal');
        await loadBankTransactions();
        await loadBankAccounts(); // refresh balances
    } catch (err) {
        console.error('[Banking] saveBankTransaction error:', err);
        Toast.error(err.message || 'Failed to save transaction');
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

    try {
        await api.request(AccountsCommon.buildUrl('bank/transfer'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Transfer executed successfully');
        document.getElementById('transferForm').reset();
        document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];
        transferFromDropdown?.setValue?.('');
        transferToDropdown?.setValue?.('');
        await loadRecentTransfers();
        await loadBankAccounts(); // refresh balances
    } catch (err) {
        console.error('[Banking] executeTransfer error:', err);
        Toast.error(err.message || 'Failed to execute transfer');
    }
}

async function loadRecentTransfers() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('bank/transfer', { limit: 20 }), { _skipSpinner: true });
        recentTransfers = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderRecentTransfersTable();
    } catch (err) {
        console.error('[Banking] loadRecentTransfers error:', err);
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
    const bankId = reconBankDropdown?.getValue?.();
    const statementBalance = parseFloat(document.getElementById('reconStatementBalance').value);
    const statementDate = document.getElementById('reconStatementDate').value;

    if (!bankId || isNaN(statementBalance) || !statementDate) {
        Toast.error('Bank Account, Statement Balance, and Statement Date are required');
        return;
    }

    try {
        const res = await api.request(AccountsCommon.buildUrl('bank/reconciliations'), {
            method: 'POST',
            body: JSON.stringify({ bank_account_id: bankId, statement_balance: statementBalance, statement_date: statementDate })
        });
        const recon = res?.data || res;
        currentReconId = recon.id;
        reconTransactions = recon.transactions || recon.unmatched_transactions || [];
        reconMatchedCount = 0;

        document.getElementById('reconWorkspace').style.display = 'block';
        document.getElementById('reconSummaryStatement').textContent = AccountsCommon.formatCurrency(statementBalance);
        renderReconTransactions();
        updateReconSummary();
        Toast.success('Reconciliation started');
    } catch (err) {
        console.error('[Banking] startReconciliation error:', err);
        Toast.error(err.message || 'Failed to start reconciliation');
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

    const diff = stmtBal - matched;
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('reconSummaryMatched', AccountsCommon.formatCurrency(Math.abs(matched)));
    el('reconSummaryUnmatched', AccountsCommon.formatCurrency(Math.abs(totalUnmatched)));
    el('reconSummaryDifference', AccountsCommon.formatCurrency(Math.abs(diff)));

    const diffEl = document.getElementById('reconSummaryDifference');
    if (diffEl) diffEl.style.color = Math.abs(diff) < 0.01 ? 'var(--color-success)' : 'var(--color-danger)';
}

async function matchSelectedTransactions() {
    if (!currentReconId) { Toast.error('No active reconciliation'); return; }

    const txnIds = [];
    document.querySelectorAll('.recon-check:checked').forEach(cb => { txnIds.push(cb.dataset.txnId); });

    if (!txnIds.length) { Toast.error('Select at least one transaction to match'); return; }

    try {
        await api.request(AccountsCommon.buildUrl(`bank/reconciliations/${currentReconId}`), {
            method: 'PUT',
            body: JSON.stringify({ transaction_ids: txnIds })
        });
        Toast.success(`${txnIds.length} transaction(s) matched`);
        reconMatchedCount += txnIds.length;
        // Remove matched from list
        reconTransactions = reconTransactions.filter(t => !txnIds.includes(t.id));
        renderReconTransactions();
        updateReconSummary();
    } catch (err) {
        console.error('[Banking] matchSelectedTransactions error:', err);
        Toast.error(err.message || 'Failed to match transactions');
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
        document.getElementById('reconWorkspace').style.display = 'none';
        await loadBankAccounts();
    } catch (err) {
        console.error('[Banking] completeReconciliation error:', err);
        Toast.error(err.message || 'Failed to complete reconciliation');
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
    if (transferDate && !transferDate.value) transferDate.value = new Date().toISOString().split('T')[0];
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
            dropZone.style.background = 'var(--bg-secondary)';
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
    if (!file.name.endsWith('.xlsx')) {
        Toast.error('Please upload an .xlsx file');
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
        const data = await file.arrayBuffer();
        parseExcelAndPreview(data);
    } catch (err) {
        console.error('[Import] File read error:', err);
        Toast.error('Failed to read file');
    }
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
        Toast.error('Failed to parse Excel file: ' + err.message);
    }
}

function parseFlexibleDate(str) {
    if (!str) return null;
    // Try ISO: YYYY-MM-DD
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    // Try DD/MM/YYYY or DD-MM-YYYY
    m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    // Try MM/DD/YYYY
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m && +m[1] <= 12) return new Date(+m[3], +m[1] - 1, +m[2]);
    // Try Date.parse as fallback
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function parseAmount(str) {
    if (!str) return null;
    // Remove currency symbols, commas, spaces
    const cleaned = str.replace(/[^0-9.\-]/g, '');
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    return isNaN(num) || num < 0 ? null : (num === 0 ? null : num);
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
        const dateStr = r.date ? r.date.toISOString().split('T')[0] : r.date_str;
        return `<tr style="${rowStyle}">
            <td>${i + 1}</td>
            <td>${statusBadge}</td>
            <td>${AccountsCommon.escapeHtml(dateStr)}</td>
            <td>${AccountsCommon.escapeHtml(r.description)}</td>
            <td style="text-align:right;">${r.debit != null ? fmt(r.debit) : ''}</td>
            <td style="text-align:right;">${r.credit != null ? fmt(r.credit) : ''}</td>
            <td style="text-align:right;">${r.balance != null ? fmt(r.balance) : ''}</td>
            <td>${AccountsCommon.escapeHtml(r.reference || '')}</td>
        </tr>`;
    }).join('');

    // Disable confirm if no valid rows
    document.getElementById('confirmImportBtn').disabled = valid.length === 0;
}

async function confirmStatementImport() {
    const bankId = importBankDropdown?.getValue?.();
    const counterId = importCounterDropdown?.getValue?.();

    if (!bankId) { Toast.error('Please select a bank account'); return; }
    if (!counterId) { Toast.error('Please select a counter account'); return; }

    const validRows = parsedStatementRows.filter(r => r.status === 'valid');
    if (validRows.length === 0) { Toast.error('No valid rows to import'); return; }

    const payload = {
        counter_account_id: counterId,
        transactions: validRows.map(r => ({
            transaction_date: r.date.getFullYear() + '-' + String(r.date.getMonth()+1).padStart(2,'0') + '-' + String(r.date.getDate()).padStart(2,'0'),
            description: r.description,
            debit: r.debit || null,
            credit: r.credit || null,
            balance: r.balance || null,
            reference_number: r.reference || null
        })),
        skip_duplicates: true
    };

    try {
        const btn = document.getElementById('confirmImportBtn');
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
        const btn = document.getElementById('confirmImportBtn');
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
