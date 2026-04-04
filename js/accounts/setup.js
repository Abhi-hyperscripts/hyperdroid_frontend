/**
 * AccountsService — Setup / Chart of Accounts Page
 *
 * Handles 9 sidebar tabs:
 *   1. Account Types       5. Opening Balances
 *   2. Account Groups      6. Fiscal Years
 *   3. Accounts            7. Fiscal Periods
 *   4. Account Tree        8. Journal Types
 *                          9. COA Templates
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let accountTypes = [];
let accountGroups = [];
let accounts = [];
let fiscalYears = [];
let journalTypes = [];
let fiscalPeriods = [];
let openingBalances = [];

let activeFiscalYear = null;

let currentPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances (for cleanup / re-init)
let groupTypeFilterDropdown = null;
let accountTypeFilterDropdown = null;
let accountGroupFilterDropdown = null;
let obFiscalYearDropdown = null;
let periodFiscalYearDropdown = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('setup', '../')) return;

    const tabNames = {
        'account-types': 'Account Types',
        'account-groups': 'Account Groups',
        'accounts': 'Accounts',
        'account-tree': 'Account Tree',
        'opening-balances': 'Opening Balances',
        'fiscal-years': 'Fiscal Years',
        'fiscal-periods': 'Fiscal Periods',
        'journal-types': 'Journal Types',
        'templates': 'COA Templates'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);

    // Wire up search inputs with debounce
    setupSearchListeners();
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'account-types':   loadAccountTypes(); break;
        case 'account-groups':  loadAccountGroups(); break;
        case 'accounts':        loadAccounts(); break;
        case 'account-tree':    loadAccountTree(); break;
        case 'opening-balances': loadOpeningBalances(); break;
        case 'fiscal-years':    loadFiscalYears(); break;
        case 'fiscal-periods':  loadFiscalPeriods(); break;
        case 'journal-types':   loadJournalTypes(); break;
        case 'templates':       break; // static content
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        await Promise.all([
            loadAccountTypes(),
            loadAccountGroups(),
            loadFiscalYears(),
            loadJournalTypes(),
            loadActiveFiscalYear()
        ]);
        // Accounts loaded after types/groups are available for filters
        await loadAccounts();
    } catch (err) {
        console.error('[Setup] loadInitialData error:', err);
    }
}

// ============================================================================
// ACTIVE FISCAL YEAR
// ============================================================================

async function loadActiveFiscalYear() {
    try {
        const url = AccountsCommon.buildUrl('fiscal/years/active');
        const res = await api.request(url, { _skipSpinner: true });
        activeFiscalYear = res || null;
    } catch (err) {
        console.warn('[Setup] No active fiscal year found:', err.message);
        activeFiscalYear = null;
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

    const groupSearch = document.getElementById('groupSearch');
    if (groupSearch) groupSearch.addEventListener('input', debounce(() => loadAccountGroups()));

    const accountSearch = document.getElementById('accountSearch');
    if (accountSearch) accountSearch.addEventListener('input', debounce(() => { currentPage = 1; loadAccounts(); }));

    const treeSearch = document.getElementById('treeSearch');
    if (treeSearch) treeSearch.addEventListener('input', debounce(() => loadAccountTree()));
}

// ============================================================================
// 1. ACCOUNT TYPES
// ============================================================================

async function loadAccountTypes() {
    try {
        const url = AccountsCommon.buildUrl('coa/types');
        const res = await api.request(url, { _skipSpinner: true });
        accountTypes = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderAccountTypes();
    } catch (err) {
        console.error('[Setup] loadAccountTypes error:', err);
        Toast.error('Failed to load account types');
    }
}

function renderAccountTypes() {
    const tbody = document.getElementById('accountTypesTable');
    if (!tbody) return;

    if (!accountTypes.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="3"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>
            </svg><p>No account types found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = accountTypes.map(t => `
        <tr>
            <td>${AccountsCommon.escapeHtml(t.name)}</td>
            <td><span class="badge ${t.normal_balance === 'debit' ? 'status-active' : 'status-pending'}">${AccountsCommon.escapeHtml(t.normal_balance || '-')}</span></td>
            <td class="actions-cell">-</td>
        </tr>
    `).join('');
}

// ============================================================================
// 2. ACCOUNT GROUPS
// ============================================================================

async function loadAccountGroups() {
    try {
        const search = document.getElementById('groupSearch')?.value || '';
        const typeFilter = groupTypeFilterDropdown?.getValue?.() || '';
        const params = {};
        if (search) params.search = search;
        if (typeFilter) params.accountTypeId = typeFilter;

        const url = AccountsCommon.buildUrl('coa/groups', params);
        const res = await api.request(url, { _skipSpinner: true });
        accountGroups = Array.isArray(res) ? res : (res?.data || res?.items || []);

        document.getElementById('totalGroups') && (document.getElementById('totalGroups').textContent = accountGroups.length);
        renderAccountGroups();
    } catch (err) {
        console.error('[Setup] loadAccountGroups error:', err);
        Toast.error('Failed to load account groups');
    }
}

function renderAccountGroups() {
    const tbody = document.getElementById('accountGroupsTable');
    if (!tbody) return;

    if (!accountGroups.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="4"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg><p>No account groups configured</p></div></td></tr>`;
        return;
    }

    const typeMap = {};
    accountTypes.forEach(t => { typeMap[t.id] = t.name; });
    const groupMap = {};
    accountGroups.forEach(g => { groupMap[g.id] = g.name; });

    tbody.innerHTML = accountGroups.map(g => {
        const typeName = typeMap[g.account_type_id] || g.account_type_name || '-';
        const parentName = g.parent_group_id ? (groupMap[g.parent_group_id] || g.parent_group_name || '-') : '-';
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editGroup('${g.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteGroup('${g.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';
        return `<tr>
            <td>${AccountsCommon.escapeHtml(g.name)}</td>
            <td>${AccountsCommon.escapeHtml(typeName)}</td>
            <td>${AccountsCommon.escapeHtml(parentName)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateGroupModal() {
    document.getElementById('groupModalTitle').textContent = 'Create Account Group';
    document.getElementById('groupForm').reset();
    document.getElementById('groupId').value = '';
    populateGroupTypeSelect();
    populateGroupParentSelect();
    AccountsCommon.openModal('accountGroupModal');
}

async function editGroup(id) {
    const group = accountGroups.find(g => g.id === id);
    if (!group) return;

    document.getElementById('groupModalTitle').textContent = 'Edit Account Group';
    document.getElementById('groupId').value = group.id;
    document.getElementById('groupName').value = group.name || '';
    document.getElementById('groupCode').value = group.code || '';
    document.getElementById('groupDescription').value = group.description || '';

    populateGroupTypeSelect(group.account_type_id);
    populateGroupParentSelect(group.parent_group_id, group.id);
    AccountsCommon.openModal('accountGroupModal');
}

async function saveAccountGroup() {
    const id = document.getElementById('groupId').value;
    const name = document.getElementById('groupName').value.trim();
    const accountTypeId = document.getElementById('groupAccountType').value;
    const code = document.getElementById('groupCode')?.value.trim() || '';
    const parentGroupId = document.getElementById('groupParent')?.value || null;
    const description = document.getElementById('groupDescription').value.trim();

    if (!name || !accountTypeId) {
        Toast.error('Name and Account Type are required');
        return;
    }

    const payload = { name, account_type_id: accountTypeId, code, parent_group_id: parentGroupId || null, description };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`coa/groups/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Account group updated');
        } else {
            await api.request(AccountsCommon.buildUrl('coa/groups'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Account group created');
        }
        AccountsCommon.closeModal('accountGroupModal');
        await loadAccountGroups();
    } catch (err) {
        console.error('[Setup] saveAccountGroup error:', err);
        Toast.error(err.message || 'Failed to save account group');
    }
}

async function deleteGroup(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this account group?', 'Delete Account Group');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`coa/groups/${id}`), { method: 'DELETE' });
        Toast.success('Account group deleted');
        await loadAccountGroups();
    } catch (err) {
        console.error('[Setup] deleteGroup error:', err);
        Toast.error(err.message || 'Failed to delete account group');
    }
}

function populateGroupTypeSelect(selectedValue) {
    const sel = document.getElementById('groupAccountType');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select...</option>' +
        accountTypes.map(t => `<option value="${t.id}" ${t.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(t.name)}</option>`).join('');
}

function populateGroupParentSelect(selectedValue, excludeId) {
    const sel = document.getElementById('groupParent');
    if (!sel) return;
    const filtered = excludeId ? accountGroups.filter(g => g.id !== excludeId) : accountGroups;
    sel.innerHTML = '<option value="">None (Top Level)</option>' +
        filtered.map(g => `<option value="${g.id}" ${g.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(g.name)}</option>`).join('');
}

// ============================================================================
// 3. ACCOUNTS
// ============================================================================

async function loadAccounts() {
    try {
        const search = document.getElementById('accountSearch')?.value || '';
        const typeFilter = accountTypeFilterDropdown?.getValue?.() || '';
        const groupFilter = accountGroupFilterDropdown?.getValue?.() || '';
        const showInactive = document.getElementById('showInactiveAccounts')?.checked || false;

        const params = { page: currentPage, pageSize: PAGE_SIZE };
        if (search) params.search = search;
        if (typeFilter) params.accountTypeId = typeFilter;
        if (groupFilter) params.accountGroupId = groupFilter;
        if (showInactive) params.includeInactive = true;

        const url = AccountsCommon.buildUrl('coa', params);
        const res = await api.request(url, { _skipSpinner: true });
        const data = res?.data || res?.items || (Array.isArray(res) ? res : []);
        accounts = data;

        const total = res?.total || res?.totalCount || accounts.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        const activeCount = accounts.filter(a => a.is_active !== false).length;
        const inactiveCount = accounts.filter(a => a.is_active === false).length;

        const totalEl = document.getElementById('totalAccounts');
        const activeEl = document.getElementById('activeAccounts');
        const inactiveEl = document.getElementById('inactiveAccounts');
        if (totalEl) totalEl.textContent = total;
        if (activeEl) activeEl.textContent = activeCount;
        if (inactiveEl) inactiveEl.textContent = inactiveCount;

        renderAccounts();
        AccountsCommon.renderPagination('accountsPagination', currentPage, totalPages, (page) => {
            currentPage = page;
            loadAccounts();
        });
    } catch (err) {
        console.error('[Setup] loadAccounts error:', err);
        Toast.error('Failed to load accounts');
    }
}

function renderAccounts() {
    const tbody = document.getElementById('accountsTable');
    if (!tbody) return;

    if (!accounts.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>
            </svg><p>No accounts configured</p></div></td></tr>`;
        return;
    }

    const typeMap = {};
    accountTypes.forEach(t => { typeMap[t.id] = t.name; });
    const groupMap = {};
    accountGroups.forEach(g => { groupMap[g.id] = g.name; });

    tbody.innerHTML = accounts.map(a => {
        const typeName = typeMap[a.account_type_id] || a.account_type_name || '-';
        const groupName = groupMap[a.account_group_id] || a.account_group_name || '-';
        const status = a.is_active === false ? 'inactive' : 'active';
        const balance = (a.current_balance ?? a.balance) != null ? AccountsCommon.formatCurrency(a.current_balance ?? a.balance) : '-';

        const viewBtn = `<button class="btn-icon" onclick="viewAccountDetail('${a.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        const actions = accountsRoles.isAdmin()
            ? viewBtn + `<button class="btn-icon" onclick="editAccount('${a.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               ${a.is_active !== false ? `<button class="btn-icon danger" onclick="deactivateAccount('${a.id}')" data-tooltip="Deactivate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></button>` : ''}`
            : viewBtn;

        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(a.account_code || a.code || '-')}</code></td>
            <td>${AccountsCommon.escapeHtml(a.account_name || a.name || '-')}</td>
            <td>${AccountsCommon.escapeHtml(typeName)}</td>
            <td>${AccountsCommon.escapeHtml(groupName)}</td>
            <td><span class="badge ${a.normal_balance === 'debit' ? 'status-active' : 'status-pending'}">${AccountsCommon.escapeHtml(a.normal_balance || '-')}</span></td>
            <td class="text-right">${balance}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateAccountModal() {
    document.getElementById('accountModalTitle').textContent = 'Create Account';
    document.getElementById('accountForm').reset();
    document.getElementById('accountId').value = '';
    document.getElementById('accountAllowDirectPosting').checked = true;
    populateAccountTypeSelect();
    populateAccountGroupSelect();
    populateAccountParentSelect();
    AccountsCommon.openModal('accountModal');
}

async function editAccount(id) {
    const acct = accounts.find(a => a.id === id);
    if (!acct) return;

    document.getElementById('accountModalTitle').textContent = 'Edit Account';
    document.getElementById('accountId').value = acct.id;
    document.getElementById('accountCode').value = acct.account_code || acct.code || '';
    document.getElementById('accountName').value = acct.account_name || acct.name || '';
    document.getElementById('accountDescription').value = acct.description || '';
    document.getElementById('accountNormalBalance').value = acct.normal_balance || '';
    document.getElementById('accountAllowDirectPosting').checked = acct.allow_direct_posting !== false;

    populateAccountTypeSelect(acct.account_type_id);
    populateAccountGroupSelect(acct.account_group_id, acct.account_type_id);
    populateAccountParentSelect(acct.parent_account_id, acct.id);
    AccountsCommon.openModal('accountModal');
}

async function saveAccount() {
    const id = document.getElementById('accountId').value;
    const code = document.getElementById('accountCode').value.trim();
    const name = document.getElementById('accountName').value.trim();
    const accountTypeId = document.getElementById('accountType').value;
    const accountGroupId = document.getElementById('accountGroup').value;
    const parentAccountId = document.getElementById('accountParent').value || null;
    const normalBalance = document.getElementById('accountNormalBalance').value;
    const description = document.getElementById('accountDescription').value.trim();
    const allowDirectPosting = document.getElementById('accountAllowDirectPosting').checked;

    if (!code || !name || !accountTypeId || !accountGroupId || !normalBalance) {
        Toast.error('Code, Name, Account Type, Group, and Normal Balance are required');
        return;
    }

    const payload = {
        code, name, account_type_id: accountTypeId, account_group_id: accountGroupId,
        parent_account_id: parentAccountId, normal_balance: normalBalance,
        description, allow_direct_posting: allowDirectPosting
    };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`coa/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Account updated');
        } else {
            await api.request(AccountsCommon.buildUrl('coa'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Account created');
        }
        AccountsCommon.closeModal('accountModal');
        await loadAccounts();
    } catch (err) {
        console.error('[Setup] saveAccount error:', err);
        Toast.error(err.message || 'Failed to save account');
    }
}

async function deactivateAccount(id) {
    const ok = await Confirm.show({ title: 'Deactivate Account', message: 'Are you sure you want to deactivate this account?', confirmText: 'Deactivate', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`coa/${id}`), { method: 'DELETE' });
        Toast.success('Account deactivated');
        await loadAccounts();
    } catch (err) {
        console.error('[Setup] deactivateAccount error:', err);
        Toast.error(err.message || 'Failed to deactivate account');
    }
}

async function viewAccountDetail(id) {
    try {
        const url = AccountsCommon.buildUrl(`coa/${id}`);
        const a = await api.request(url);

        const typeMap = {};
        accountTypes.forEach(t => { typeMap[t.id] = t.name; });
        const groupMap = {};
        accountGroups.forEach(g => { groupMap[g.id] = g.name; });

        const parentName = a.parent_account_id
            ? (accounts.find(x => x.id === a.parent_account_id)?.account_name || accounts.find(x => x.id === a.parent_account_id)?.name || a.parent_account_id)
            : '-';

        document.getElementById('acctDetailCode').textContent = a.account_code || a.code || '-';
        document.getElementById('acctDetailName').textContent = a.account_name || a.name || '-';
        document.getElementById('acctDetailType').textContent = typeMap[a.account_type_id] || a.account_type_name || '-';
        document.getElementById('acctDetailGroup').textContent = groupMap[a.account_group_id] || a.account_group_name || '-';
        document.getElementById('acctDetailParent').textContent = parentName;
        document.getElementById('acctDetailNormalBalance').innerHTML = `<span class="badge ${a.normal_balance === 'debit' ? 'status-active' : 'status-pending'}">${AccountsCommon.escapeHtml(a.normal_balance || '-')}</span>`;
        document.getElementById('acctDetailDescription').textContent = a.description || '-';
        document.getElementById('acctDetailIsActive').innerHTML = a.is_active !== false ? '<span class="badge status-active">Active</span>' : '<span class="badge status-rejected">Inactive</span>';
        document.getElementById('acctDetailBalance').textContent = (a.current_balance ?? a.balance) != null ? AccountsCommon.formatCurrency(a.current_balance ?? a.balance) : '-';
        document.getElementById('acctDetailDirectPosting').innerHTML = a.allow_direct_posting !== false ? '<span class="badge status-active">Yes</span>' : '<span class="badge status-pending">No</span>';

        AccountsCommon.openModal('accountDetailModal');
    } catch (err) {
        console.error('[Setup] viewAccountDetail error:', err);
        Toast.error(err.message || 'Failed to load account detail');
    }
}

function showImportModal() {
    const fileInput = document.getElementById('importCsvFile');
    if (fileInput) fileInput.value = '';
    AccountsCommon.openModal('importAccountsModal');
}

async function importAccounts() {
    const fileInput = document.getElementById('importCsvFile');
    if (!fileInput || !fileInput.files.length) {
        Toast.error('Please select a CSV file');
        return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
        const url = AccountsCommon.buildUrl('coa/import');
        await api.request(url, {
            method: 'POST',
            body: formData,
            _skipContentType: true
        });
        Toast.success('Accounts imported successfully');
        AccountsCommon.closeModal('importAccountsModal');
        await loadAccounts();
    } catch (err) {
        console.error('[Setup] importAccounts error:', err);
        Toast.error(err.message || 'Failed to import accounts');
    }
}

function onAccountTypeChange() {
    const typeId = document.getElementById('accountType').value;
    populateAccountGroupSelect(null, typeId);
    // Auto-set normal balance based on type
    const type = accountTypes.find(t => t.id === typeId);
    if (type && type.normal_balance) {
        document.getElementById('accountNormalBalance').value = type.normal_balance;
    }
}

function populateAccountTypeSelect(selectedValue) {
    const sel = document.getElementById('accountType');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select...</option>' +
        accountTypes.map(t => `<option value="${t.id}" ${t.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(t.name)}</option>`).join('');
}

function populateAccountGroupSelect(selectedValue, filterByTypeId) {
    const sel = document.getElementById('accountGroup');
    if (!sel) return;
    const filtered = filterByTypeId ? accountGroups.filter(g => g.account_type_id === filterByTypeId) : accountGroups;
    sel.innerHTML = '<option value="">Select...</option>' +
        filtered.map(g => `<option value="${g.id}" ${g.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(g.name)}</option>`).join('');
}

function populateAccountParentSelect(selectedValue, excludeId) {
    const sel = document.getElementById('accountParent');
    if (!sel) return;
    const filtered = excludeId ? accounts.filter(a => a.id !== excludeId) : accounts;
    sel.innerHTML = '<option value="">None (Top Level)</option>' +
        filtered.map(a => { const c = a.account_code || a.code || ''; const n = a.account_name || a.name || ''; return `<option value="${a.id}" ${a.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(c ? c + ' - ' + n : n)}</option>`; }).join('');
}

// ============================================================================
// 4. ACCOUNT TREE
// ============================================================================

async function loadAccountTree() {
    const container = document.getElementById('accountTreeContainer');
    if (!container) return;

    try {
        const search = document.getElementById('treeSearch')?.value || '';
        const params = {};
        if (search) params.search = search;

        const url = AccountsCommon.buildUrl('coa/tree', params);
        const res = await api.request(url, { _skipSpinner: true });
        const treeData = Array.isArray(res) ? res : (res?.data || res?.items || []);

        if (!treeData.length) {
            container.innerHTML = `<div class="empty-message">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="19" r="2"></circle>
                </svg><p>No accounts to display in tree</p></div>`;
            return;
        }

        container.innerHTML = '';
        renderTree(treeData, container, 0);
    } catch (err) {
        console.error('[Setup] loadAccountTree error:', err);
        container.innerHTML = `<div class="empty-message"><p>Failed to load account tree</p></div>`;
    }
}

function renderTree(nodes, container, level) {
    nodes.forEach(node => {
        const hasChildren = node.children && node.children.length > 0;
        const nodeEl = document.createElement('div');
        nodeEl.className = 'tree-node';
        nodeEl.dataset.nodeId = node.id;
        nodeEl.style.paddingLeft = (level * 24) + 'px';

        const code = node.account_code || node.code || '';
        const name = node.account_name || node.name || '';
        const balance = node.current_balance ?? node.balance;
        const balanceStr = balance != null && balance !== 0 ? AccountsCommon.formatCurrency(balance) : '';

        nodeEl.innerHTML = `
            <div class="tree-node-header" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:${hasChildren ? 'pointer' : 'default'}" onclick="${hasChildren ? `toggleTreeNode('${node.id}')` : ''}">
                <span class="tree-toggle" style="width:16px;flex-shrink:0;transition:transform 0.2s">${hasChildren ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' : ''}</span>
                <span class="tree-code" style="color:var(--text-secondary);font-size:0.8rem;min-width:50px;font-family:monospace">${AccountsCommon.escapeHtml(code)}</span>
                <span class="tree-name" style="color:var(--text-primary);font-weight:${level === 0 ? '600' : '400'}">${AccountsCommon.escapeHtml(name)}</span>
                ${balanceStr ? `<span class="tree-balance" style="margin-left:auto;font-family:monospace;color:var(--text-secondary)">${balanceStr}</span>` : ''}
            </div>
        `;
        container.appendChild(nodeEl);

        if (hasChildren) {
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-children';
            childContainer.id = `tree-children-${node.id}`;
            renderTree(node.children, childContainer, level + 1);
            container.appendChild(childContainer);
        }
    });
}

function toggleTreeNode(nodeId) {
    const children = document.getElementById(`tree-children-${nodeId}`);
    const node = document.querySelector(`.tree-node[data-node-id="${nodeId}"]`);
    if (!children) return;

    const isCollapsed = children.classList.contains('collapsed');
    children.classList.toggle('collapsed');

    const toggleIcon = node?.querySelector('.tree-toggle svg');
    if (toggleIcon) {
        toggleIcon.style.transform = isCollapsed ? '' : 'rotate(90deg)';
    }
}

function expandAllNodes() {
    document.querySelectorAll('.tree-children').forEach(el => el.classList.remove('collapsed'));
    document.querySelectorAll('.tree-toggle svg').forEach(svg => { svg.style.transform = 'rotate(90deg)'; });
}

function collapseAllNodes() {
    document.querySelectorAll('.tree-children').forEach(el => el.classList.add('collapsed'));
    document.querySelectorAll('.tree-toggle svg').forEach(svg => { svg.style.transform = ''; });
}

// ============================================================================
// 5. OPENING BALANCES
// ============================================================================

async function loadOpeningBalances() {
    const fiscalYearId = obFiscalYearDropdown?.getValue?.();
    if (!fiscalYearId) {
        document.getElementById('openingBalancesTable').innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <line x1="12" y1="1" x2="12" y2="23"></line>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg><p>Select a fiscal year to view opening balances</p></div></td></tr>`;
        return;
    }

    try {
        const url = AccountsCommon.buildUrl('coa/balances', { fiscalYearId });
        const res = await api.request(url, { _skipSpinner: true });
        openingBalances = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderOpeningBalances();
    } catch (err) {
        console.error('[Setup] loadOpeningBalances error:', err);
        Toast.error('Failed to load opening balances');
    }
}

function renderOpeningBalances() {
    const tbody = document.getElementById('openingBalancesTable');
    if (!tbody) return;

    if (!openingBalances.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message"><p>No accounts with opening balances</p></div></td></tr>`;
        return;
    }

    const typeMap = {};
    accountTypes.forEach(t => { typeMap[t.id] = t.name; });

    tbody.innerHTML = openingBalances.map(ob => {
        const typeName = ob.account_type_name || typeMap[ob.account_type_id] || '-';
        const isAdmin = accountsRoles.isAdmin();
        const debitVal = ob.debit_balance != null ? ob.debit_balance : '';
        const creditVal = ob.credit_balance != null ? ob.credit_balance : '';

        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(ob.account_code || ob.code || '-')}</code></td>
            <td>${AccountsCommon.escapeHtml(ob.account_name || ob.name || '-')}</td>
            <td>${AccountsCommon.escapeHtml(typeName)}</td>
            <td>${isAdmin
                ? `<input type="number" class="form-control form-control-sm ob-debit" data-account-id="${ob.account_id || ob.id}" value="${debitVal}" step="0.01" min="0" style="width:120px">`
                : (debitVal !== '' ? AccountsCommon.formatCurrency(debitVal) : '-')}</td>
            <td>${isAdmin
                ? `<input type="number" class="form-control form-control-sm ob-credit" data-account-id="${ob.account_id || ob.id}" value="${creditVal}" step="0.01" min="0" style="width:120px">`
                : (creditVal !== '' ? AccountsCommon.formatCurrency(creditVal) : '-')}</td>
        </tr>`;
    }).join('');
}

async function saveAllOpeningBalances() {
    const fiscalYearId = obFiscalYearDropdown?.getValue?.();
    if (!fiscalYearId) {
        Toast.error('Please select a fiscal year first');
        return;
    }

    const balances = [];
    document.querySelectorAll('.ob-debit').forEach(input => {
        const accountId = input.dataset.accountId;
        const debit = parseFloat(input.value) || 0;
        const creditInput = document.querySelector(`.ob-credit[data-account-id="${accountId}"]`);
        const credit = creditInput ? (parseFloat(creditInput.value) || 0) : 0;
        if (debit > 0 || credit > 0) {
            balances.push({ account_id: accountId, debit_balance: debit, credit_balance: credit });
        }
    });

    if (!balances.length) {
        Toast.error('No balances to save');
        return;
    }

    try {
        await api.request(AccountsCommon.buildUrl('coa/opening-balances'), {
            method: 'POST',
            body: JSON.stringify({ fiscal_year_id: fiscalYearId, balances })
        });
        Toast.success('Opening balances saved');
        await loadOpeningBalances();
    } catch (err) {
        console.error('[Setup] saveAllOpeningBalances error:', err);
        Toast.error(err.message || 'Failed to save opening balances');
    }
}

async function saveOpeningBalance(accountId, debit, credit) {
    const fiscalYearId = obFiscalYearDropdown?.getValue?.();
    if (!fiscalYearId) { Toast.error('No fiscal year selected'); return; }

    try {
        await api.request(AccountsCommon.buildUrl('coa/opening-balances'), {
            method: 'POST',
            body: JSON.stringify({ fiscal_year_id: fiscalYearId, balances: [{ account_id: accountId, debit_balance: debit, credit_balance: credit }] })
        });
        Toast.success('Balance saved');
    } catch (err) {
        Toast.error(err.message || 'Failed to save balance');
    }
}

// ============================================================================
// 6. FISCAL YEARS
// ============================================================================

async function loadFiscalYears() {
    try {
        const url = AccountsCommon.buildUrl('fiscal/years');
        const res = await api.request(url, { _skipSpinner: true });
        fiscalYears = Array.isArray(res) ? res : (res?.data || res?.items || []);

        const activeYear = fiscalYears.find(fy => fy.status === 'active' || fy.is_active === true);
        const closedCount = fiscalYears.filter(fy => fy.is_closed === true).length;

        const totalEl = document.getElementById('totalFiscalYears');
        const activeEl = document.getElementById('activeFiscalYear');
        const closedEl = document.getElementById('closedFiscalYears');
        if (totalEl) totalEl.textContent = fiscalYears.length;
        if (activeEl) activeEl.textContent = activeYear ? activeYear.name : '-';
        if (closedEl) closedEl.textContent = closedCount;

        renderFiscalYears();
    } catch (err) {
        console.error('[Setup] loadFiscalYears error:', err);
        Toast.error('Failed to load fiscal years');
    }
}

function renderFiscalYears() {
    const tbody = document.getElementById('fiscalYearsTable');
    if (!tbody) return;

    if (!fiscalYears.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg><p>No fiscal years configured</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = fiscalYears.map(fy => {
        const status = fy.is_closed ? 'closed' : (fy.is_active ? 'active' : 'inactive');
        const canClose = accountsRoles.isAdmin() && status !== 'closed';
        const viewBtn = `<button class="btn-icon" onclick="viewFiscalYearDetail('${fy.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        const closeBtn = canClose ? `<button class="btn btn-sm btn-outline" onclick="closeFiscalYear('${fy.id}')">Close Year</button>` : '';
        const actions = viewBtn + closeBtn || viewBtn;

        return `<tr>
            <td>${AccountsCommon.escapeHtml(fy.name)}</td>
            <td>${AccountsCommon.formatDate(fy.start_date)}</td>
            <td>${AccountsCommon.formatDate(fy.end_date)}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateFiscalYearModal() {
    document.getElementById('fiscalYearModalTitle').textContent = 'Create Fiscal Year';
    document.getElementById('fiscalYearForm').reset();
    document.getElementById('fiscalYearId').value = '';
    AccountsCommon.openModal('fiscalYearModal');
}

async function saveFiscalYear() {
    const id = document.getElementById('fiscalYearId').value;
    const name = document.getElementById('fiscalYearName').value.trim();
    const startDate = document.getElementById('fiscalYearStart').value;
    const endDate = document.getElementById('fiscalYearEnd').value;

    if (!name || !startDate || !endDate) {
        Toast.error('Name, Start Date, and End Date are required');
        return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
        Toast.error('End date must be after start date');
        return;
    }

    const payload = { name, start_date: startDate, end_date: endDate };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`fiscal/years/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Fiscal year updated');
        } else {
            await api.request(AccountsCommon.buildUrl('fiscal/years'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Fiscal year created');
        }
        AccountsCommon.closeModal('fiscalYearModal');
        await loadFiscalYears();
    } catch (err) {
        console.error('[Setup] saveFiscalYear error:', err);
        Toast.error(err.message || 'Failed to save fiscal year');
    }
}

async function closeFiscalYear(id) {
    const ok = await Confirm.danger('Are you sure you want to close this fiscal year? This action cannot be undone.', 'Close Fiscal Year');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`fiscal/years/${id}/close`), { method: 'POST' });
        Toast.success('Fiscal year closed');
        await loadFiscalYears();
    } catch (err) {
        console.error('[Setup] closeFiscalYear error:', err);
        Toast.error(err.message || 'Failed to close fiscal year');
    }
}

async function viewFiscalYearDetail(id) {
    try {
        const url = AccountsCommon.buildUrl(`fiscal/years/${id}`);
        const fy = await api.request(url);
        const status = fy.is_closed ? 'closed' : (fy.is_active ? 'active' : 'inactive');
        const isClosed = fy.is_closed === true;

        document.getElementById('fyDetailName').textContent = fy.name || '-';
        document.getElementById('fyDetailStartDate').textContent = AccountsCommon.formatDate(fy.start_date);
        document.getElementById('fyDetailEndDate').textContent = AccountsCommon.formatDate(fy.end_date);
        document.getElementById('fyDetailIsActive').innerHTML = fy.is_active ? '<span class="badge status-active">Yes</span>' : '<span class="badge status-pending">No</span>';
        document.getElementById('fyDetailIsClosed').innerHTML = isClosed ? '<span class="badge status-rejected">Yes</span>' : '<span class="badge status-active">No</span>';
        document.getElementById('fyDetailCreatedAt').textContent = fy.created_at ? AccountsCommon.formatDate(fy.created_at) : '-';

        AccountsCommon.openModal('fiscalYearDetailModal');
    } catch (err) {
        console.error('[Setup] viewFiscalYearDetail error:', err);
        Toast.error(err.message || 'Failed to load fiscal year detail');
    }
}

// ============================================================================
// 7. FISCAL PERIODS
// ============================================================================

async function loadFiscalPeriods() {
    const fiscalYearId = periodFiscalYearDropdown?.getValue?.();
    if (!fiscalYearId) {
        document.getElementById('fiscalPeriodsTable').innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg><p>Select a fiscal year to view periods</p></div></td></tr>`;
        return;
    }

    try {
        const url = AccountsCommon.buildUrl('fiscal/periods', { fiscalYearId });
        const res = await api.request(url, { _skipSpinner: true });
        fiscalPeriods = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderFiscalPeriods();
    } catch (err) {
        console.error('[Setup] loadFiscalPeriods error:', err);
        Toast.error('Failed to load fiscal periods');
    }
}

function renderFiscalPeriods() {
    const tbody = document.getElementById('fiscalPeriodsTable');
    if (!tbody) return;

    if (!fiscalPeriods.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message"><p>No periods found for this fiscal year</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = fiscalPeriods.map(p => {
        const status = p.status || (p.is_locked ? 'locked' : 'open');
        const isAdmin = accountsRoles.isAdmin();
        let actions = '-';
        if (isAdmin) {
            if (status === 'locked' || p.is_locked) {
                actions = `<button class="btn btn-sm btn-outline" onclick="unlockPeriod('${p.id}')">Unlock</button>`;
            } else {
                actions = `<button class="btn btn-sm btn-outline" onclick="lockPeriod('${p.id}')">Lock</button>`;
            }
        }

        return `<tr>
            <td>${AccountsCommon.escapeHtml(p.name || p.period_name || ('Period ' + p.period_number))}</td>
            <td>${AccountsCommon.formatDate(p.start_date)}</td>
            <td>${AccountsCommon.formatDate(p.end_date)}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

async function lockPeriod(id) {
    const ok = await Confirm.show({ title: 'Lock Period', message: 'Lock this period? No more journal entries can be posted.', confirmText: 'Lock', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`fiscal/periods/${id}/lock`), { method: 'POST' });
        Toast.success('Period locked');
        await loadFiscalPeriods();
    } catch (err) {
        console.error('[Setup] lockPeriod error:', err);
        Toast.error(err.message || 'Failed to lock period');
    }
}

async function unlockPeriod(id) {
    const ok = await Confirm.show({ title: 'Unlock Period', message: 'Unlock this period? Journal entries will be allowed again.', confirmText: 'Unlock', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`fiscal/periods/${id}/unlock`), { method: 'POST' });
        Toast.success('Period unlocked');
        await loadFiscalPeriods();
    } catch (err) {
        console.error('[Setup] unlockPeriod error:', err);
        Toast.error(err.message || 'Failed to unlock period');
    }
}

// ============================================================================
// 8. JOURNAL TYPES
// ============================================================================

async function loadJournalTypes() {
    try {
        const url = AccountsCommon.buildUrl('journals/types');
        const res = await api.request(url, { _skipSpinner: true });
        journalTypes = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderJournalTypes();
    } catch (err) {
        console.error('[Setup] loadJournalTypes error:', err);
        Toast.error('Failed to load journal types');
    }
}

function renderJournalTypes() {
    const tbody = document.getElementById('journalTypesTable');
    if (!tbody) return;

    if (!journalTypes.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg><p>No journal types configured</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = journalTypes.map(jt => {
        const isSystem = jt.is_system || jt.system || false;
        const canEdit = accountsRoles.isAdmin() && !isSystem;
        const viewBtn = `<button class="btn-icon" onclick="viewJournalTypeDetail('${jt.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        const actions = canEdit
            ? viewBtn + `<button class="btn-icon" onclick="editJournalType('${jt.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteJournalType('${jt.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : viewBtn;

        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(jt.code || '-')}</code></td>
            <td>${AccountsCommon.escapeHtml(jt.name)}</td>
            <td>${AccountsCommon.escapeHtml(jt.description || '-')}</td>
            <td>${isSystem ? '<span class="badge status-active">System</span>' : '<span class="badge status-pending">Custom</span>'}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateJournalTypeModal() {
    document.getElementById('journalTypeModalTitle').textContent = 'Create Journal Type';
    document.getElementById('journalTypeForm').reset();
    document.getElementById('journalTypeId').value = '';
    AccountsCommon.openModal('journalTypeModal');
}

async function editJournalType(id) {
    const jt = journalTypes.find(j => j.id === id);
    if (!jt) return;

    document.getElementById('journalTypeModalTitle').textContent = 'Edit Journal Type';
    document.getElementById('journalTypeId').value = jt.id;
    document.getElementById('journalTypeCode').value = jt.code || '';
    document.getElementById('journalTypeName').value = jt.name || '';
    document.getElementById('journalTypeDescription').value = jt.description || '';
    AccountsCommon.openModal('journalTypeModal');
}

async function saveJournalType() {
    const id = document.getElementById('journalTypeId').value;
    const code = document.getElementById('journalTypeCode').value.trim();
    const name = document.getElementById('journalTypeName').value.trim();
    const description = document.getElementById('journalTypeDescription').value.trim();

    if (!code || !name) {
        Toast.error('Code and Name are required');
        return;
    }

    const payload = { code, name, description };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`journals/types/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Journal type updated');
        } else {
            await api.request(AccountsCommon.buildUrl('journals/types'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Journal type created');
        }
        AccountsCommon.closeModal('journalTypeModal');
        await loadJournalTypes();
    } catch (err) {
        console.error('[Setup] saveJournalType error:', err);
        Toast.error(err.message || 'Failed to save journal type');
    }
}

async function deleteJournalType(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this journal type?', 'Delete Journal Type');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`journals/types/${id}`), { method: 'DELETE' });
        Toast.success('Journal type deleted');
        await loadJournalTypes();
    } catch (err) {
        console.error('[Setup] deleteJournalType error:', err);
        Toast.error(err.message || 'Failed to delete journal type');
    }
}

async function viewJournalTypeDetail(id) {
    try {
        const url = AccountsCommon.buildUrl(`journals/types/${id}`);
        const jt = await api.request(url);
        const isSystem = jt.is_system || jt.system || false;

        document.getElementById('jtDetailCode').textContent = jt.code || '-';
        document.getElementById('jtDetailName').textContent = jt.name || '-';
        document.getElementById('jtDetailDescription').textContent = jt.description || '-';
        document.getElementById('jtDetailIsSystem').innerHTML = isSystem ? '<span class="badge status-active">System</span>' : '<span class="badge status-pending">Custom</span>';
        document.getElementById('jtDetailCreatedAt').textContent = jt.created_at ? AccountsCommon.formatDate(jt.created_at) : '-';

        AccountsCommon.openModal('journalTypeDetailModal');
    } catch (err) {
        console.error('[Setup] viewJournalTypeDetail error:', err);
        Toast.error(err.message || 'Failed to load journal type detail');
    }
}

// ============================================================================
// 9. COA TEMPLATES
// ============================================================================

async function initializeTemplate(country) {
    const label = country === 'india' ? 'India' : 'Default';
    const ok = await Confirm.show({ title: 'Initialize Template', message: `Initialize the ${label} Chart of Accounts template? This will create account types, groups, and accounts.`, confirmText: 'Continue', type: 'warning' });
    if (!ok) return;

    try {
        await api.request(AccountsCommon.buildUrl('coa/setup-template'), {
            method: 'POST',
            body: JSON.stringify({ country })
        });
        Toast.success(`${label} template initialized successfully`);

        // Reload all data
        await Promise.all([
            loadAccountTypes(),
            loadAccountGroups()
        ]);
        await loadAccounts();
    } catch (err) {
        console.error('[Setup] initializeTemplate error:', err);
        Toast.error(err.message || 'Failed to initialize template');
    }
}

// ============================================================================
// SEARCHABLE DROPDOWNS INIT
// ============================================================================

function initDropdowns() {
    // Group type filter (account-groups tab)
    const groupTypeContainer = document.getElementById('groupTypeFilterContainer');
    if (groupTypeContainer) {
        groupTypeFilterDropdown = new SearchableDropdown(groupTypeContainer, {
            id: 'groupTypeFilter',
            options: [{ value: '', label: 'All Types' }, ...accountTypes.map(t => ({ value: t.id, label: t.name }))],
            placeholder: 'Filter by Type',
            compact: true,
            onChange: () => loadAccountGroups()
        });
    }

    // Account type filter (accounts tab)
    const accountTypeContainer = document.getElementById('accountTypeFilterContainer');
    if (accountTypeContainer) {
        accountTypeFilterDropdown = new SearchableDropdown(accountTypeContainer, {
            id: 'accountTypeFilter',
            options: [{ value: '', label: 'All Types' }, ...accountTypes.map(t => ({ value: t.id, label: t.name }))],
            placeholder: 'Filter by Type',
            compact: true,
            onChange: () => { currentPage = 1; loadAccounts(); }
        });
    }

    // Account group filter (accounts tab)
    const accountGroupContainer = document.getElementById('accountGroupFilterContainer');
    if (accountGroupContainer) {
        accountGroupFilterDropdown = new SearchableDropdown(accountGroupContainer, {
            id: 'accountGroupFilter',
            options: [{ value: '', label: 'All Groups' }, ...accountGroups.map(g => ({ value: g.id, label: g.name }))],
            placeholder: 'Filter by Group',
            compact: true,
            onChange: () => { currentPage = 1; loadAccounts(); }
        });
    }

    // Opening balances fiscal year dropdown
    const obContainer = document.getElementById('obFiscalYearContainer');
    if (obContainer) {
        const activeId = activeFiscalYear?.id || '';
        obFiscalYearDropdown = new SearchableDropdown(obContainer, {
            id: 'obFiscalYear',
            options: [{ value: '', label: 'Select Fiscal Year' }, ...fiscalYears.map(fy => ({ value: fy.id, label: fy.name }))],
            placeholder: 'Select Fiscal Year',
            compact: true,
            value: activeId,
            onChange: () => loadOpeningBalances()
        });
        if (activeId) loadOpeningBalances();
    }

    // Fiscal periods fiscal year dropdown
    const periodContainer = document.getElementById('periodFiscalYearContainer');
    if (periodContainer) {
        const activeId = activeFiscalYear?.id || '';
        periodFiscalYearDropdown = new SearchableDropdown(periodContainer, {
            id: 'periodFiscalYear',
            options: [{ value: '', label: 'Select Fiscal Year' }, ...fiscalYears.map(fy => ({ value: fy.id, label: fy.name }))],
            placeholder: 'Select Fiscal Year',
            compact: true,
            value: activeId,
            onChange: () => loadFiscalPeriods()
        });
        if (activeId) loadFiscalPeriods();
    }
}
