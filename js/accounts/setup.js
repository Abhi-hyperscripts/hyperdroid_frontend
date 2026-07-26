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

// Display helper: turn a raw 'debit'/'credit' DB value into a properly
// title-cased label so it sits next to other capitalised columns ("Cash in
// Hand", "Assets", "Current Assets") without looking out of place.
function formatNormalBalance(nb) {
    if (!nb) return '—';
    return nb.charAt(0).toUpperCase() + nb.slice(1).toLowerCase();
}

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
    AccountsCommon.initDatePickers(['fiscalYearStart', 'fiscalYearEnd']);
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
        case 'templates':       loadCoaTemplates(); break;
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
    if (groupSearch) groupSearch.addEventListener('input', debounce(() => renderAccountGroups()));

    const accountSearch = document.getElementById('accountSearch');
    if (accountSearch) accountSearch.addEventListener('input', debounce(() => { currentPage = 1; loadAccounts(); }));

    const showInactiveToggle = document.getElementById('showInactiveAccounts');
    if (showInactiveToggle) showInactiveToggle.addEventListener('change', () => renderAccounts());

    const treeSearch = document.getElementById('treeSearch');
    if (treeSearch) treeSearch.addEventListener('input', debounce(() => renderAccountTree()));
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
            <td><span class="badge ${t.normal_balance === 'debit' ? 'status-active' : 'status-pending'}">${formatNormalBalance(t.normal_balance)}</span></td>
            <td class="actions-cell" style="color:var(--text-secondary);font-size:0.8rem;">System</td>
        </tr>
    `).join('');
}

// ============================================================================
// 2. ACCOUNT GROUPS
// ============================================================================

async function loadAccountGroups() {
    try {
        const typeFilter = groupTypeFilterDropdown?.getValue?.() || '';
        const params = {};
        if (typeFilter) params.accountTypeId = typeFilter;

        const url = AccountsCommon.buildUrl('coa/groups', params);
        const res = await api.request(url, { _skipSpinner: true });
        accountGroups = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderAccountGroups();
    } catch (err) {
        console.error('[Setup] loadAccountGroups error:', err);
        Toast.error('Failed to load account groups');
    }
}

function renderAccountGroups() {
    const tbody = document.getElementById('accountGroupsTable');
    if (!tbody) return;

    const searchTerm = (document.getElementById('groupSearch')?.value || '').trim().toLowerCase();
    const filtered = searchTerm
        ? accountGroups.filter(g =>
            (g.name || '').toLowerCase().includes(searchTerm) ||
            (g.code || '').toLowerCase().includes(searchTerm))
        : accountGroups;

    document.getElementById('totalGroups') && (document.getElementById('totalGroups').textContent = filtered.length);

    if (!filtered.length) {
        const msg = searchTerm
            ? `No account groups match "${AccountsCommon.escapeHtml(searchTerm)}"`
            : 'No account groups configured';
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg><p>${msg}</p></div></td></tr>`;
        return;
    }

    const typeMap = {};
    accountTypes.forEach(t => { typeMap[t.id] = t.name; });
    const groupMap = {};
    accountGroups.forEach(g => { groupMap[g.id] = g.name; });

    tbody.innerHTML = filtered.map(g => {
        const typeName = typeMap[g.account_type_id] || g.account_type_name || '-';
        const parentName = g.parent_group_id ? (groupMap[g.parent_group_id] || g.parent_group_name || '-') : '<span style="color:var(--text-secondary);font-size:0.8rem;">Top Level</span>';
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editGroup('${g.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteGroup('${g.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';
        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(g.code || '—')}</code></td>
            <td>${AccountsCommon.escapeHtml(g.name)}</td>
            <td>${AccountsCommon.escapeHtml(typeName)}</td>
            <td>${g.parent_group_id ? AccountsCommon.escapeHtml(parentName) : parentName}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// Enable/disable a form field AND its SearchableDropdown wrapper (selects in
// modals are auto-converted by AccountsCommon.openModal; the wrapper instance
// is exposed on the native element as `_searchableDropdown`). Must be called
// AFTER openModal so the wrapper exists on first open.
function _setGroupFieldDisabled(id, disabled) {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = disabled;
    el._searchableDropdown?.setDisabled?.(disabled);
}

function showCreateGroupModal() {
    document.getElementById('groupModalTitle').textContent = 'Create Account Group';
    document.getElementById('groupForm').reset();
    document.getElementById('groupId').value = '';
    populateGroupTypeSelect();
    populateGroupParentSelect();
    AccountsCommon.openModal('accountGroupModal');
    // Re-enable fields that editGroup disables
    ['groupCode', 'groupAccountType', 'groupParent'].forEach(id => _setGroupFieldDisabled(id, false));
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
    // Backend UpdateAccountGroupRequest only supports name/description —
    // code, account type, and parent group are immutable after creation
    // (mirrors editAccount, which disables its immutable fields).
    ['groupCode', 'groupAccountType', 'groupParent'].forEach(fid => _setGroupFieldDisabled(fid, true));
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

    // Backend UpdateAccountGroupRequest only supports name/description — the
    // other fields are disabled in edit mode and ignored server-side.
    const payload = id
        ? { name, description }
        : { name, account_type_id: accountTypeId, code, parent_group_id: parentGroupId || null, description };

    if (!AccountsCommon.beginSubmit('saveAccountGroup')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveAccountGroup');
    }
}

async function deleteGroup(id) {
    const g = accountGroups.find(x => x.id === id);
    const label = g ? `"${g.name}"${g.code ? ` (${g.code})` : ''}` : 'this account group';
    const ok = await Confirm.danger(`Are you sure you want to delete ${label}? This cannot be undone.`, 'Delete Account Group');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`coa/groups/${id}`), { method: 'DELETE' });
        Toast.success(`Deleted account group ${label}`);
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

        // Always fetch active + inactive so the stat tiles can show the true
        // counts. The "Show Inactive" toggle filters render-side via
        // renderAccounts() so the stats stay accurate regardless.
        // Backend GetAccounts has NO paging params (returns the full list) —
        // pagination is done client-side in renderAccounts() by slicing.
        const params = {};
        if (search) params.search = search;
        if (typeFilter) params.accountTypeId = typeFilter;
        if (groupFilter) params.accountGroupId = groupFilter;

        const url = AccountsCommon.buildUrl('coa', params);
        const res = await api.request(url, { _skipSpinner: true });
        const data = res?.data || res?.items || (Array.isArray(res) ? res : []);
        accounts = data;

        const activeCount = accounts.filter(a => a.is_active !== false).length;
        const inactiveCount = accounts.filter(a => a.is_active === false).length;

        const totalEl = document.getElementById('totalAccounts');
        const activeEl = document.getElementById('activeAccounts');
        const inactiveEl = document.getElementById('inactiveAccounts');
        if (totalEl) totalEl.textContent = accounts.length;
        if (activeEl) activeEl.textContent = activeCount;
        if (inactiveEl) inactiveEl.textContent = inactiveCount;

        renderAccounts();
    } catch (err) {
        console.error('[Setup] loadAccounts error:', err);
        Toast.error('Failed to load accounts');
    }
}

function renderAccounts() {
    const tbody = document.getElementById('accountsTable');
    if (!tbody) return;

    const showInactive = document.getElementById('showInactiveAccounts')?.checked || false;
    const filtered = showInactive ? accounts : accounts.filter(a => a.is_active !== false);

    // Client-side pagination — the backend returns the full account list.
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    AccountsCommon.renderPagination('accountsPagination', currentPage, totalPages, (page) => {
        currentPage = page;
        renderAccounts();
    });

    if (!visible.length) {
        const msg = !accounts.length
            ? 'No accounts configured'
            : 'No active accounts — toggle "Show Inactive" to see deactivated accounts';
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>
            </svg><p>${msg}</p></div></td></tr>`;
        return;
    }

    const typeMap = {};
    accountTypes.forEach(t => { typeMap[t.id] = t.name; });
    const groupMap = {};
    accountGroups.forEach(g => { groupMap[g.id] = g.name; });

    tbody.innerHTML = visible.map(a => {
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
    // Re-enable fields that editAccount disables
    document.getElementById('accountCode').disabled = false;
    document.getElementById('accountType').disabled = false;
    document.getElementById('accountParent').disabled = false;
    document.getElementById('accountNormalBalance').disabled = false;
    populateAccountTypeSelect();
    populateAccountGroupSelect();
    populateAccountParentSelect();
    AccountsCommon.openModal('accountModal');
    // After the modal opens, the SearchableDropdown wrappers may still hold
    // stale labels from the previous session. Force-resync them by dispatching
    // a change on each wrapped <select>; the syncFromLinked listener installed
    // by convertSelectToSearchable will then pull the post-reset value.
    ['accountType', 'accountGroup', 'accountParent', 'accountNormalBalance'].forEach(id => {
        document.getElementById(id)?.dispatchEvent(new Event('change', { bubbles: true }));
    });
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
    // Parent list is same-type and excludes this account's own subtree.
    populateAccountParentSelect(acct.parent_account_id, acct.id, acct.account_type_id);

    // Code, type and normal-balance stay immutable on edit (backend UpdateAccountRequest ignores them),
    // but the PARENT is now editable — re-parenting is supported (reparent flag + subtree cascade).
    document.getElementById('accountCode').disabled = true;
    document.getElementById('accountType').disabled = true;
    document.getElementById('accountParent').disabled = false;
    document.getElementById('accountNormalBalance').disabled = true;

    AccountsCommon.openModal('accountModal');
    // Resync the SearchableDropdown wrappers to the freshly-set values (parent especially).
    ['accountGroup', 'accountParent'].forEach(id => document.getElementById(id)?.dispatchEvent(new Event('change', { bubbles: true })));
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

    if (!code || !name || !accountTypeId || !normalBalance) {
        Toast.error('Code, Name, Account Type, and Normal Balance are required');
        return;
    }

    // NOTE: backend model fields are `account_code` and `account_name`, NOT `code`/`name`.
    // Sending the wrong names causes a 400 because they're non-nullable on the server.
    const payload = {
        account_code: code,
        account_name: name,
        account_type_id: accountTypeId,
        account_group_id: accountGroupId || null,
        parent_account_id: parentAccountId,
        normal_balance: normalBalance,
        description,
        allow_direct_posting: allowDirectPosting,
        // On EDIT, opt in to re-parenting so the backend applies parent_account_id (create uses it directly).
        // Without this flag a partial update that omits the parent would be read as "move to top level".
        ...(id ? { reparent: true } : {})
    };

    if (!AccountsCommon.beginSubmit('saveAccount')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveAccount');
    }
}

async function deactivateAccount(id) {
    const a = accounts.find(x => x.id === id);
    const code = a?.account_code || a?.code;
    const name = a?.account_name || a?.name;
    const label = a ? `"${name}"${code ? ` (${code})` : ''}` : 'this account';
    const ok = await Confirm.show({
        title: 'Deactivate Account',
        message: `Are you sure you want to deactivate ${label}? It will be hidden from new transactions but its history will be preserved. You can re-enable it later via the "Show Inactive" toggle.`,
        confirmText: 'Deactivate',
        type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`coa/${id}`), { method: 'DELETE' });
        Toast.success(`Deactivated account ${label}`);
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
        document.getElementById('acctDetailNormalBalance').innerHTML = `<span class="badge ${a.normal_balance === 'debit' ? 'status-active' : 'status-pending'}">${formatNormalBalance(a.normal_balance)}</span>`;
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
    if (!AccountsCommon.beginSubmit('importAccounts')) return;
    try {
        // Parse CSV client-side → send as JSON (backend expects ImportAccountsRequest)
        const text = await file.text();
        const rows = parseCSV(text);
        if (!rows.length) { Toast.error('CSV file is empty or has no data rows'); return; }

        const url = AccountsCommon.buildUrl('coa/import');
        const res = await api.request(url, {
            method: 'POST',
            body: JSON.stringify({ accounts: rows })
        });

        // Show results summary
        const { created = 0, skipped = 0, failed = 0, total = 0 } = res || {};
        const msg = `Import complete: ${created} created, ${skipped} skipped, ${failed} failed (${total} total rows)`;
        if (failed > 0) Toast.error(msg);
        else Toast.success(msg);

        // Show detailed results if any failures
        if (failed > 0 && res?.results) {
            const failures = res.results.filter(r => r.status === 'failed');
            console.warn('[Setup] Import failures:', failures);
        }

        AccountsCommon.closeModal('importAccountsModal');
        await loadAccounts();
        await loadAccountTree();
    } catch (err) {
        console.error('[Setup] importAccounts error:', err);
        Toast.error(err.message || 'Failed to import accounts');
    } finally {
        AccountsCommon.endSubmit('importAccounts');
    }
}

function parseCSV(text) {
    // Delegate to the quote-aware parser (_parseCsv, defined further down) —
    // the old raw comma-split broke on quoted fields containing commas.
    const rawRows = _parseCsv(text);
    if (!rawRows.length) return [];

    // Map header names to ImportAccountRow field names
    const fieldMap = {
        'account_code': 'account_code', 'code': 'account_code',
        'account_name': 'account_name', 'name': 'account_name',
        'account_type': 'account_type', 'type': 'account_type',
        'account_group': 'account_group', 'group': 'account_group',
        'parent_code': 'parent_code', 'parent': 'parent_code',
        'description': 'description', 'desc': 'description',
        'opening_balance': 'opening_balance', 'balance': 'opening_balance',
        'balance_type': 'balance_type'
    };

    return rawRows.map(raw => {
        const row = {};
        Object.entries(raw).forEach(([header, value]) => {
            const field = fieldMap[header.trim().toLowerCase().replace(/\s+/g, '_')];
            if (field && value !== undefined && value !== '') {
                row[field] = field === 'opening_balance' ? parseFloat(value) || null : value;
            }
        });
        return row;
    }).filter(r => r.account_code && r.account_name && r.account_type);
}

function downloadSampleCSV() {
    const sample = `account_code,account_name,account_type,account_group,parent_code,description,opening_balance,balance_type
6100,Petty Cash,Asset,Current Assets,,Petty cash account,5000,debit
6200,Savings Account,Asset,Bank Accounts,,Company savings,100000,debit
6300,Prepaid Insurance,Asset,Current Assets,,Annual insurance premium,,
7100,Vendor Advances,Liability,Current Liabilities,,Advance from vendors,,
7200,Rent Deposit Received,Liability,Current Liabilities,,Security deposit,,
8100,Retained Profit,Equity,,,Prior year retained profit,200000,credit
9100,Subscription Revenue,Revenue,,,Monthly SaaS revenue,,
9200,Training Revenue,Revenue,,,Workshop and training fees,,
9300,Office Supplies,Expense,Administrative Expenses,,Stationery and supplies,,
9400,Business Travel,Expense,Administrative Expenses,,Domestic and international travel,,
9500,Software Licenses,Expense,Administrative Expenses,,Annual license renewals,,`;

    const blob = new Blob([sample], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chart_of_accounts_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function onAccountTypeChange() {
    const typeId = document.getElementById('accountType').value;
    populateAccountGroupSelect(null, typeId);
    // Auto-set normal balance based on type. The user can still override this
    // afterwards (the backend honors the override for contra accounts like
    // Accumulated Depreciation, which is an Asset with a Credit normal balance).
    const type = accountTypes.find(t => t.id === typeId);
    if (type && type.normal_balance) {
        const nbSel = document.getElementById('accountNormalBalance');
        nbSel.value = type.normal_balance;
        // CRITICAL: dispatch change so the SearchableDropdown wrapper around
        // accountNormalBalance updates its visible label. Without this, the
        // underlying <select> has the right value but the visible text stays
        // at "Select…" — fooling the user into thinking the field is empty.
        nbSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Also re-sync the accountGroup wrapper after we replaced its options.
    document.getElementById('accountGroup')?.dispatchEvent(new Event('change', { bubbles: true }));
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

function populateAccountParentSelect(selectedValue, excludeId, typeId) {
    const sel = document.getElementById('accountParent');
    if (!sel) return;
    // A parent must be the SAME type, and can't be the account itself or one of its own descendants
    // (that would make a cycle — the backend rejects it too). Build the banned set (self + subtree).
    const banned = new Set();
    if (excludeId) {
        banned.add(excludeId);
        let frontier = [excludeId];
        while (frontier.length) {
            const next = [];
            accounts.forEach(a => {
                if (a.parent_account_id && frontier.includes(a.parent_account_id) && !banned.has(a.id)) { banned.add(a.id); next.push(a.id); }
            });
            frontier = next;
        }
    }
    const filtered = accounts.filter(a => !banned.has(a.id) && (!typeId || a.account_type_id === typeId));
    sel.innerHTML = '<option value="">None (Top Level)</option>' +
        filtered.map(a => { const c = a.account_code || a.code || ''; const n = a.account_name || a.name || ''; return `<option value="${a.id}" ${a.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(c ? c + ' - ' + n : n)}</option>`; }).join('');
}

// ============================================================================
// 4. ACCOUNT TREE
// ============================================================================

let cachedAccountTree = [];

async function loadAccountTree() {
    const container = document.getElementById('accountTreeContainer');
    if (!container) return;

    try {
        const url = AccountsCommon.buildUrl('coa/tree', {});
        const res = await api.request(url, { _skipSpinner: true });
        cachedAccountTree = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderAccountTree();
    } catch (err) {
        console.error('[Setup] loadAccountTree error:', err);
        container.innerHTML = `<div class="empty-message"><p>Failed to load account tree</p></div>`;
    }
}

function filterTree(nodes, term) {
    const out = [];
    for (const node of nodes) {
        const code = (node.account_code || node.code || '').toLowerCase();
        const name = (node.account_name || node.name || '').toLowerCase();
        const selfMatch = code.includes(term) || name.includes(term);
        const filteredChildren = node.children ? filterTree(node.children, term) : [];
        if (selfMatch || filteredChildren.length > 0) {
            out.push({ ...node, children: filteredChildren });
        }
    }
    return out;
}

function renderAccountTree() {
    const container = document.getElementById('accountTreeContainer');
    if (!container) return;

    const term = (document.getElementById('treeSearch')?.value || '').trim().toLowerCase();
    const tree = term ? filterTree(cachedAccountTree, term) : cachedAccountTree;

    if (!tree.length) {
        const msg = term
            ? `No accounts match "${AccountsCommon.escapeHtml(term)}"`
            : 'No accounts to display in tree';
        container.innerHTML = `<div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="19" r="2"></circle>
            </svg><p>${msg}</p></div>`;
        return;
    }

    container.innerHTML = '';
    renderTree(tree, container, 0);
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
        // Fetch existing balances AND all active accounts in parallel, then merge.
        // The page is useless if it only shows accounts that already have balances —
        // first-time setup needs every active account as an input row.
        const [balancesRes, accountsRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('coa/balances', { fiscalYearId }), { _skipSpinner: true }),
            // No pageSize param — backend GetAccounts has no paging and returns all
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true })
        ]);

        const existingBalances = Array.isArray(balancesRes) ? balancesRes : (balancesRes?.data || balancesRes?.items || []);
        const allAccounts = Array.isArray(accountsRes) ? accountsRes : (accountsRes?.data || accountsRes?.items || []);

        // Build a map of account_id → { debit_balance, credit_balance } from the existing
        // balances. The API returns ONE ROW PER ACCOUNT+PERIOD from account_period_balances
        // (opening_debit / opening_credit per period; fall back to the shorter aliases for
        // forward-compat). The opening balance typically sits only on the period it was
        // posted to, so AGGREGATE across each account's rows — last-row-wins would blank
        // out any account whose OB lives in an early period (and re-entry then 409s).
        const balanceMap = {};
        existingBalances.forEach(b => {
            const key = b.account_id || b.id;
            if (!balanceMap[key]) balanceMap[key] = { debit_balance: 0, credit_balance: 0 };
            balanceMap[key].debit_balance += parseFloat(b.opening_debit ?? b.debit_balance ?? 0) || 0;
            balanceMap[key].credit_balance += parseFloat(b.opening_credit ?? b.credit_balance ?? 0) || 0;
        });

        // Merge — every active BALANCE-SHEET account becomes a row, with pre-filled balances if any
        // exist. Opening balances belong only to Assets/Liabilities/Equity; the backend rejects a P&L
        // (Income/Expense) account with a 409, so listing them here would guarantee a save error and,
        // because saves post one account per request, leave the books half-written.
        const plTypes = ['Income', 'Revenue', 'Expense', 'Expenses'];
        openingBalances = allAccounts
            .filter(a => a.is_active !== false && !plTypes.includes(a.account_type_name))
            .map(a => ({
                account_id: a.id,
                account_code: a.account_code || a.code,
                account_name: a.account_name || a.name,
                account_type_id: a.account_type_id,
                account_type_name: a.account_type_name,
                debit_balance: balanceMap[a.id]?.debit_balance ?? null,
                credit_balance: balanceMap[a.id]?.credit_balance ?? null
            }));

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
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message"><p>No active accounts found. Create accounts in the Accounts tab first.</p></div></td></tr>`;
        return;
    }

    const typeMap = {};
    accountTypes.forEach(t => { typeMap[t.id] = t.name; });

    const rows = openingBalances.map(ob => {
        const typeName = ob.account_type_name || typeMap[ob.account_type_id] || '-';
        const isAdmin = accountsRoles.isAdmin();
        const debitVal = ob.debit_balance != null && ob.debit_balance !== 0 ? ob.debit_balance : '';
        const creditVal = ob.credit_balance != null && ob.credit_balance !== 0 ? ob.credit_balance : '';

        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(ob.account_code || ob.code || '-')}</code></td>
            <td>${AccountsCommon.escapeHtml(ob.account_name || ob.name || '-')}</td>
            <td>${AccountsCommon.escapeHtml(typeName)}</td>
            <td>${isAdmin
                ? `<input type="number" class="form-control form-control-sm ob-debit" data-account-id="${ob.account_id || ob.id}" value="${debitVal}" step="0.01" min="0" placeholder="0.00" style="width:140px;text-align:right" oninput="updateOpeningBalanceTotals()">`
                : (debitVal !== '' ? AccountsCommon.formatCurrency(debitVal) : '-')}</td>
            <td>${isAdmin
                ? `<input type="number" class="form-control form-control-sm ob-credit" data-account-id="${ob.account_id || ob.id}" value="${creditVal}" step="0.01" min="0" placeholder="0.00" style="width:140px;text-align:right" oninput="updateOpeningBalanceTotals()">`
                : (creditVal !== '' ? AccountsCommon.formatCurrency(creditVal) : '-')}</td>
        </tr>`;
    }).join('');

    // Totals row — live-updates as the user types so they can see when debits = credits.
    const totalsRow = `<tr class="ob-totals-row" style="border-top:2px solid var(--border-primary);font-weight:600">
        <td colspan="3" style="text-align:right;padding-top:14px">Totals</td>
        <td style="text-align:right;padding-top:14px"><span id="obTotalDebit">₹0.00</span></td>
        <td style="text-align:right;padding-top:14px"><span id="obTotalCredit">₹0.00</span></td>
    </tr>
    <tr class="ob-balance-row">
        <td colspan="5" style="text-align:right;padding:8px 12px 14px"><span id="obBalanceStatus" style="font-size:0.875rem;color:var(--text-secondary)">Enter opening balances above. Total debits must equal total credits.</span></td>
    </tr>`;

    tbody.innerHTML = rows + totalsRow;
    updateOpeningBalanceTotals();
}

function updateOpeningBalanceTotals() {
    let totalDebit = 0;
    let totalCredit = 0;
    document.querySelectorAll('.ob-debit').forEach(i => { totalDebit += parseFloat(i.value) || 0; });
    document.querySelectorAll('.ob-credit').forEach(i => { totalCredit += parseFloat(i.value) || 0; });

    const debitEl = document.getElementById('obTotalDebit');
    const creditEl = document.getElementById('obTotalCredit');
    const statusEl = document.getElementById('obBalanceStatus');
    if (debitEl) debitEl.textContent = AccountsCommon.formatCurrency(totalDebit);
    if (creditEl) creditEl.textContent = AccountsCommon.formatCurrency(totalCredit);

    if (statusEl) {
        if (totalDebit === 0 && totalCredit === 0) {
            statusEl.textContent = 'Enter opening balances above. Total debits must equal total credits.';
            statusEl.style.color = 'var(--text-secondary)';
        } else if (Math.abs(totalDebit - totalCredit) < 0.01) {
            statusEl.textContent = `Balanced: debits and credits both equal ${AccountsCommon.formatCurrency(totalDebit)}. Ready to save.`;
            statusEl.style.color = 'var(--color-success)';
        } else {
            const diff = totalDebit - totalCredit;
            statusEl.textContent = `Unbalanced: ${diff > 0 ? 'debits exceed credits' : 'credits exceed debits'} by ${AccountsCommon.formatCurrency(Math.abs(diff))}.`;
            statusEl.style.color = 'var(--color-danger)';
        }
    }
}

async function saveAllOpeningBalances() {
    const fiscalYearId = obFiscalYearDropdown?.getValue?.();
    if (!fiscalYearId) {
        Toast.error('Please select a fiscal year first');
        return;
    }

    // Collect non-zero rows. Each row becomes ONE backend POST because the
    // SetOpeningBalanceRequest endpoint takes a single account at a time.
    const entries = [];
    document.querySelectorAll('.ob-debit').forEach(input => {
        const accountId = input.dataset.accountId;
        const debit = parseFloat(input.value) || 0;
        const creditInput = document.querySelector(`.ob-credit[data-account-id="${accountId}"]`);
        const credit = creditInput ? (parseFloat(creditInput.value) || 0) : 0;
        if (debit > 0 && credit > 0) {
            // Defensive — same row can't be both debit and credit. The render
            // doesn't prevent it, so guard here.
            entries.push({ accountId, error: 'Cannot have both debit and credit on the same row' });
        } else if (debit > 0) {
            entries.push({ accountId, amount: debit, balance_type: 'debit' });
        } else if (credit > 0) {
            entries.push({ accountId, amount: credit, balance_type: 'credit' });
        }
    });

    const errors = entries.filter(e => e.error);
    if (errors.length) {
        Toast.error(errors[0].error);
        return;
    }
    if (!entries.length) {
        Toast.error('No balances to save — enter a debit or credit on at least one row');
        return;
    }

    // Validate balanced (debits === credits) before sending anything.
    let totalDebit = 0, totalCredit = 0;
    entries.forEach(e => {
        if (e.balance_type === 'debit') totalDebit += e.amount;
        else if (e.balance_type === 'credit') totalCredit += e.amount;
    });
    if (Math.abs(totalDebit - totalCredit) >= 0.01) {
        Toast.error(`Unbalanced: debits ${AccountsCommon.formatCurrency(totalDebit)} ≠ credits ${AccountsCommon.formatCurrency(totalCredit)}. Adjust the amounts before saving.`);
        return;
    }

    // Find the fiscal year start date — backend requires as_of_date.
    const fyList = (window.fiscalYears || []).length ? window.fiscalYears : (typeof fiscalYears !== 'undefined' ? fiscalYears : []);
    const fy = fyList.find(f => f.id === fiscalYearId);
    const asOfDate = fy?.start_date || fy?.startDate || AccountsCommon.todayLocal();

    // Skip rows whose exact value is already persisted server-side (prefilled by
    // loadOpeningBalances) — this makes a retry after a partial failure re-runnable
    // without 409s on the accounts that DID save. The Dr=Cr validation above still
    // runs over the full entered set, so the books stay balanced overall.
    const toPost = entries.filter(e => {
        const ob = openingBalances.find(o => (o.account_id || o.id) === e.accountId);
        const persisted = parseFloat(e.balance_type === 'debit' ? ob?.debit_balance : ob?.credit_balance) || 0;
        return !(persisted > 0 && Math.abs(persisted - e.amount) < 0.005);
    });
    if (!toPost.length) {
        Toast.success('All entered balances are already saved — nothing to do');
        return;
    }

    const codeOf = (accountId) => {
        const ob = openingBalances.find(o => (o.account_id || o.id) === accountId);
        return ob?.account_code || accountId;
    };

    // No atomic batch endpoint exists — each account is a separate POST, so a mid-loop
    // failure commits a prefix. Disable the button while the loop runs, and on failure
    // report exactly which accounts saved vs not (never claim success).
    const saveBtn = document.getElementById('saveAllOpeningBalancesBtn');
    if (saveBtn) saveBtn.disabled = true;
    const savedCodes = [];
    try {
        for (const e of toPost) {
            try {
                await api.request(AccountsCommon.buildUrl('coa/opening-balances'), {
                    method: 'POST',
                    body: JSON.stringify({
                        account_id: e.accountId,
                        amount: e.amount,
                        balance_type: e.balance_type,
                        as_of_date: typeof asOfDate === 'string' ? asOfDate.slice(0, 10) : AccountsCommon.toDateInput(asOfDate)
                    })
                });
                savedCodes.push(codeOf(e.accountId));
            } catch (err) {
                console.error('[Setup] saveAllOpeningBalances error:', err);
                const notSaved = toPost.slice(toPost.indexOf(e)).map(x => codeOf(x.accountId));
                Toast.error(savedCodes.length
                    ? `PARTIAL SAVE — books may be unbalanced. Saved: ${savedCodes.join(', ')}. NOT saved: ${notSaved.join(', ')} (failed at ${codeOf(e.accountId)}: ${err.message || 'unknown error'}). Fix the issue and click Save All Balances again — already-saved accounts are skipped on retry.`
                    : `Failed at ${codeOf(e.accountId)}: ${err.message || 'unknown error'} — nothing was saved.`);
                await loadOpeningBalances();
                return;
            }
        }
        Toast.success(`Saved ${savedCodes.length} opening balance${savedCodes.length === 1 ? '' : 's'} (debits ${AccountsCommon.formatCurrency(totalDebit)}, credits ${AccountsCommon.formatCurrency(totalCredit)})`);
        await loadOpeningBalances();
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

// saveOpeningBalance (single-account variant) removed — was dead code with wrong payload shape.
// Use saveAllOpeningBalances() instead, which sends the correct SetOpeningBalanceRequest shape.

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

        // Bug fix: also refresh the fiscal-year SearchableDropdowns on the
        // Opening Balances and Fiscal Periods tabs so they reflect newly
        // created/closed years without a full page reload.
        const fyOptions = [{ value: '', label: 'Select Fiscal Year' }, ...fiscalYears.map(fy => ({ value: fy.id, label: fy.name }))];
        if (obFiscalYearDropdown && typeof obFiscalYearDropdown.setOptions === 'function') {
            obFiscalYearDropdown.setOptions(fyOptions, true);
        }
        if (periodFiscalYearDropdown && typeof periodFiscalYearDropdown.setOptions === 'function') {
            periodFiscalYearDropdown.setOptions(fyOptions, true);
            // If nothing is selected yet but we now have an active year, auto-select it
            if (!periodFiscalYearDropdown.getValue?.() && activeYear) {
                periodFiscalYearDropdown.setValue?.(activeYear.id);
                if (typeof loadFiscalPeriods === 'function') loadFiscalPeriods();
            }
        }
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
        const editBtn = (accountsRoles.isAdmin() && !fy.is_closed) ? `<button class="btn-icon" onclick="editFiscalYear('${fy.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : '';
        const closeBtn = canClose ? `<button class="btn btn-sm btn-outline" style="margin-left:6px;" onclick="closeFiscalYear('${fy.id}')">Close Year</button>` : '';
        const actions = viewBtn + editBtn + closeBtn;

        return `<tr>
            <td>${AccountsCommon.escapeHtml(fy.name)}</td>
            <td>${AccountsCommon.formatDate(fy.start_date)}</td>
            <td>${AccountsCommon.formatDate(fy.end_date)}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function editFiscalYear(id) {
    const fy = fiscalYears.find(f => f.id === id);
    if (!fy) return;
    document.getElementById('fiscalYearModalTitle').textContent = 'Edit Fiscal Year';
    document.getElementById('fiscalYearId').value = fy.id;
    document.getElementById('fiscalYearName').value = fy.name;
    AccountsCommon.setDateField('fiscalYearStart', fy.start_date?.split('T')[0] || '');
    AccountsCommon.setDateField('fiscalYearEnd', fy.end_date?.split('T')[0] || '');
    // Backend UpdateFiscalYearRequest only supports `name` — dates are immutable
    // after creation, so disable them instead of implying they can change.
    document.getElementById('fiscalYearStart').disabled = true;
    const endEl = document.getElementById('fiscalYearEnd');
    if (endEl) endEl.disabled = true;
    AccountsCommon.openModal('fiscalYearModal');
}

function showCreateFiscalYearModal() {
    document.getElementById('fiscalYearModalTitle').textContent = 'Create Fiscal Year';
    document.getElementById('fiscalYearForm').reset();
    document.getElementById('fiscalYearId').value = '';
    // form.reset() bypasses flatpickr — clear its internal state so the calendar doesn't reopen on a stale date
    AccountsCommon.setDateField('fiscalYearStart', '');
    AccountsCommon.setDateField('fiscalYearEnd', '');
    // Re-enable date fields that editFiscalYear disables
    document.getElementById('fiscalYearStart').disabled = false;
    const endEl = document.getElementById('fiscalYearEnd');
    if (endEl) endEl.disabled = false;
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

    // Backend UpdateFiscalYearRequest only has `name` — don't send dates on edit
    // (they're disabled in the modal and ignored server-side anyway).
    const payload = id ? { name } : { name, start_date: startDate, end_date: endDate };

    if (!AccountsCommon.beginSubmit('saveFiscalYear')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveFiscalYear');
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
    const p = (window.fiscalPeriods || []).find(x => x.id === id) || fiscalPeriods?.find?.(x => x.id === id);
    const label = p ? `"${p.name}"` : 'this period';
    const ok = await Confirm.show({
        title: 'Lock Period',
        message: `Lock ${label}? No more journal entries can be posted to this period until you unlock it. Existing entries are not affected.`,
        confirmText: 'Lock',
        type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`fiscal/periods/${id}/lock`), { method: 'POST' });
        Toast.success(`Locked period ${label}`);
        await loadFiscalPeriods();
    } catch (err) {
        console.error('[Setup] lockPeriod error:', err);
        Toast.error(err.message || 'Failed to lock period');
    }
}

async function unlockPeriod(id) {
    const p = (window.fiscalPeriods || []).find(x => x.id === id) || fiscalPeriods?.find?.(x => x.id === id);
    const label = p ? `"${p.name}"` : 'this period';
    const ok = await Confirm.show({
        title: 'Unlock Period',
        message: `Unlock ${label}? Journal entries will be allowed in this period again.`,
        confirmText: 'Unlock',
        type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`fiscal/periods/${id}/unlock`), { method: 'POST' });
        Toast.success(`Unlocked period ${label}`);
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
    document.getElementById('journalTypeCode').disabled = false;
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
    // Code is immutable after creation (backend UpdateJournalTypeRequest ignores it)
    document.getElementById('journalTypeCode').disabled = true;
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

    if (!AccountsCommon.beginSubmit('saveJournalType')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveJournalType');
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

let _coaTemplates = [];
async function loadCoaTemplates() {
    const grid = document.getElementById('coaTemplateGrid');
    if (!grid) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('coa/templates'), { _skipSpinner: true });
        _coaTemplates = res?.data || [];
        if (!_coaTemplates.length) { grid.innerHTML = '<div class="empty-state"><p>No templates available.</p></div>'; return; }
        const esc = AccountsCommon.escapeHtml;
        grid.innerHTML = _coaTemplates.map(t => `
            <div class="tpl-card">
                <h5>${esc(t.name)}</h5>
                <p>${esc(t.description)}</p>
                <div class="tpl-card-foot">
                    <span class="tpl-count">${t.account_count} accounts</span>
                    <div style="display:flex;gap:6px;">
                        <button class="btn btn-sm btn-outline" onclick="viewCoaTemplate('${esc(t.code)}')">View</button>
                        <button class="btn btn-sm btn-primary" onclick="initializeTemplate('${esc(t.code)}')" data-admin-only>Apply</button>
                    </div>
                </div>
            </div>`).join('');
        accountsRoles.applyRBAC();
    } catch (err) {
        console.error('[Setup] loadCoaTemplates error:', err);
        grid.innerHTML = '<div class="empty-state"><p>Could not load templates.</p></div>';
    }
}

// Preview a template's accounts — grouped by type, headers dimmed, in a modal.
async function viewCoaTemplate(code) {
    const tpl = _coaTemplates.find(t => t.code === code);
    const esc = AccountsCommon.escapeHtml;
    document.getElementById('tplPreviewTitle').textContent = tpl ? tpl.name : code;
    const body = document.getElementById('tplPreviewBody');
    body.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
    AccountsCommon.openModal('tplPreviewModal');
    try {
        const res = await api.request(AccountsCommon.buildUrl(`coa/templates/${encodeURIComponent(code)}/accounts`), { _skipSpinner: true });
        const accounts = res?.data || [];
        const typeOrder = ['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses'];
        body.innerHTML = typeOrder.map(type => {
            const rows = accounts.filter(a => a.type === type);
            if (!rows.length) return '';
            return `<div class="tpl-prev-section">
                <div class="tpl-prev-type">${type} <span>${rows.filter(r => r.postable).length} postable</span></div>
                ${rows.map(a => `
                    <div class="tpl-prev-row ${a.postable ? '' : 'is-header'}">
                        <code>${esc(a.code)}</code>
                        <span class="tpl-prev-name">${esc(a.name)}</span>
                        <span class="tpl-prev-group">${esc(a.group || '')}</span>
                        ${a.postable ? '' : '<span class="tpl-prev-tag">header</span>'}
                    </div>`).join('')}
            </div>`;
        }).join('');
    } catch (err) {
        console.error('[Setup] viewCoaTemplate error:', err);
        body.innerHTML = '<div class="empty-state"><p>Could not load the template preview.</p></div>';
    }
}

async function initializeTemplate(templateCode) {
    // Back-compat with the old country-name argument
    const code = templateCode === 'india' ? 'IN' : templateCode;
    const tpl = _coaTemplates.find(t => t.code === code);
    const label = tpl ? tpl.name : code;
    const ok = await Confirm.show({
        title: 'Apply Template',
        message: `Apply "${label}"? This creates its account types, groups and accounts. Safe to run on an existing chart — accounts you already have are kept, only missing ones are added.`,
        confirmText: 'Apply Template', type: 'warning'
    });
    if (!ok) return;

    try {
        const res = await api.request(AccountsCommon.buildUrl('coa/setup-template'), {
            method: 'POST',
            body: JSON.stringify({ country_code: code })
        });
        Toast.success(`${label} applied — ${res?.accounts ?? '?'} accounts in your chart`);
        await Promise.all([loadAccountTypes(), loadAccountGroups()]);
        await loadAccounts();
    } catch (err) {
        console.error('[Setup] initializeTemplate error:', err);
        Toast.error(err.message || 'Failed to apply template');
    }
}

// ============================================================================
// 9b. CUSTOM TEMPLATE UPLOAD (CSV / JSON)
// ============================================================================
// CAs maintain their own Chart of Accounts in Excel. This lets them dump the
// CoA as CSV (or JSON) and bulk-import via POST /api/accounts/coa/import.
// The backend dedupes by account_code so re-uploads are idempotent.

// Required + optional columns. Order in this array determines sample-file order.
const COA_TEMPLATE_COLUMNS = [
    { key: 'account_code',    required: true,  example: '1100' },
    { key: 'account_name',    required: true,  example: 'Current Assets' },
    { key: 'account_type',    required: true,  example: 'Assets' },     // Assets/Liabilities/Equity/Income/Expenses
    { key: 'account_group',   required: false, example: 'Current Assets' },
    { key: 'parent_code',     required: false, example: '1000' },
    { key: 'description',     required: false, example: 'Bucket for short-term assets' },
    { key: 'opening_balance', required: false, example: '' },
    { key: 'balance_type',    required: false, example: '' }            // debit/credit
];

const COA_SAMPLE_ROWS = [
    { account_code: '1000', account_name: 'Assets',          account_type: 'Assets',      account_group: '',                  parent_code: '',     description: 'Top-level assets',         opening_balance: '', balance_type: '' },
    { account_code: '1100', account_name: 'Current Assets',  account_type: 'Assets',      account_group: 'Current Assets',    parent_code: '1000', description: 'Cash + receivables',       opening_balance: '', balance_type: '' },
    { account_code: '1110', account_name: 'Cash & Bank',     account_type: 'Assets',      account_group: 'Current Assets',    parent_code: '1100', description: '',                          opening_balance: '', balance_type: '' },
    { account_code: '1111', account_name: 'Cash in Hand',    account_type: 'Assets',      account_group: 'Current Assets',    parent_code: '1110', description: 'Petty cash',               opening_balance: '5000',  balance_type: 'debit'  },
    { account_code: '2000', account_name: 'Liabilities',     account_type: 'Liabilities', account_group: '',                  parent_code: '',     description: '',                          opening_balance: '', balance_type: '' },
    { account_code: '2100', account_name: 'Accounts Payable',account_type: 'Liabilities', account_group: 'Current Liabilities', parent_code: '2000', description: 'Vendor dues',           opening_balance: '12000', balance_type: 'credit' },
    { account_code: '3000', account_name: 'Equity',          account_type: 'Equity',      account_group: '',                  parent_code: '',     description: '',                          opening_balance: '', balance_type: '' },
    { account_code: '4000', account_name: 'Sales Revenue',   account_type: 'Income',      account_group: 'Operating Income',  parent_code: '',     description: 'Goods + services revenue', opening_balance: '', balance_type: '' },
    { account_code: '5000', account_name: 'Operating Expenses', account_type: 'Expenses', account_group: 'Operating Expenses', parent_code: '',     description: '',                          opening_balance: '', balance_type: '' },
    { account_code: '5100', account_name: 'Salaries',        account_type: 'Expenses',    account_group: 'Operating Expenses', parent_code: '5000', description: 'Payroll cost',             opening_balance: '', balance_type: '' }
];

let _customTemplateParsedRows = []; // cached rows from the chosen file

function downloadCoaSample(format) {
    const cols = COA_TEMPLATE_COLUMNS.map(c => c.key);

    let blob, filename;
    if (format === 'csv') {
        const lines = [cols.join(',')];
        for (const row of COA_SAMPLE_ROWS) {
            lines.push(cols.map(c => _csvEscape(row[c] ?? '')).join(','));
        }
        blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
        filename = 'coa-template-sample.csv';
    } else {
        blob = new Blob([JSON.stringify({ accounts: COA_SAMPLE_ROWS }, null, 2)], { type: 'application/json' });
        filename = 'coa-template-sample.json';
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _csvEscape(value) {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function openCustomTemplateModal() {
    _customTemplateParsedRows = [];
    document.getElementById('customTemplateFile').value = '';
    const preview = document.getElementById('customTemplatePreview');
    const err = document.getElementById('customTemplateError');
    const chosen = document.getElementById('customTemplateChosenName');
    const dz = document.getElementById('customTemplateDropZone');
    if (preview) preview.hidden = true;
    if (err) err.hidden = true;
    if (chosen) { chosen.hidden = true; chosen.textContent = ''; }
    if (dz) dz.classList.remove('is-dragging', 'has-file');
    document.getElementById('customTemplateImportBtn').disabled = true;
    AccountsCommon.openModal('customTemplateModal');
}

// Drop-zone drag handlers — keep them tiny + idempotent.
function onCustomTemplateDragOver(ev) {
    ev.preventDefault();
    document.getElementById('customTemplateDropZone')?.classList.add('is-dragging');
}
function onCustomTemplateDragLeave(ev) {
    ev.preventDefault();
    document.getElementById('customTemplateDropZone')?.classList.remove('is-dragging');
}
function onCustomTemplateDrop(ev) {
    ev.preventDefault();
    document.getElementById('customTemplateDropZone')?.classList.remove('is-dragging');
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    // Mirror the file into the hidden <input> so the rest of the pipeline
    // (which reads from the file input) keeps working unchanged.
    const input = document.getElementById('customTemplateFile');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}
function closeCustomTemplateModal() {
    AccountsCommon.closeModal('customTemplateModal');
}

async function onCustomTemplateFileChosen(event) {
    const file = event.target.files?.[0];
    const errEl = document.getElementById('customTemplateError');
    const previewEl = document.getElementById('customTemplatePreview');
    const importBtn = document.getElementById('customTemplateImportBtn');
    const chosenEl = document.getElementById('customTemplateChosenName');
    const dz = document.getElementById('customTemplateDropZone');
    errEl.hidden = true;
    previewEl.hidden = true;
    importBtn.disabled = true;
    if (chosenEl) { chosenEl.hidden = true; chosenEl.textContent = ''; }
    if (dz) dz.classList.remove('has-file');
    _customTemplateParsedRows = [];

    if (!file) return;

    // Show the picked filename inside the drop zone for clear feedback.
    if (chosenEl) {
        const sizeKb = (file.size / 1024).toFixed(1);
        chosenEl.textContent = `${file.name} · ${sizeKb} KB`;
        chosenEl.hidden = false;
    }
    if (dz) dz.classList.add('has-file');

    try {
        const text = await file.text();
        let rows;
        if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
            const parsed = JSON.parse(text);
            // Accept either { accounts: [...] } or a bare [...]
            rows = Array.isArray(parsed) ? parsed : (parsed.accounts || []);
        } else {
            rows = _parseCsv(text);
        }
        if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows found in file.');

        // Validate required fields per row
        const issues = [];
        const valid = [];
        rows.forEach((row, idx) => {
            const code = (row.account_code || '').toString().trim();
            const name = (row.account_name || '').toString().trim();
            const type = (row.account_type || '').toString().trim();
            if (!code || !name || !type) {
                issues.push(`Row ${idx + 2}: missing ${[!code && 'account_code', !name && 'account_name', !type && 'account_type'].filter(Boolean).join(', ')}`);
                return;
            }
            valid.push({
                account_code: code,
                account_name: name,
                account_type: type,
                account_group: (row.account_group || '').toString().trim() || null,
                parent_code:   (row.parent_code   || '').toString().trim() || null,
                description:   (row.description   || '').toString().trim() || null,
                opening_balance: row.opening_balance !== '' && row.opening_balance != null ? Number(row.opening_balance) : null,
                balance_type:  (row.balance_type  || '').toString().trim().toLowerCase() || null
            });
        });

        if (valid.length === 0) {
            throw new Error('No valid rows. ' + issues.slice(0, 5).join(' | '));
        }

        _customTemplateParsedRows = valid;

        // Render preview (first 50 rows)
        const body = document.getElementById('customTemplatePreviewBody');
        body.innerHTML = valid.slice(0, 50).map(r => `
            <tr>
                <td><code>${AccountsCommon.escapeHtml(r.account_code)}</code></td>
                <td>${AccountsCommon.escapeHtml(r.account_name)}</td>
                <td>${AccountsCommon.escapeHtml(r.account_type)}</td>
                <td>${AccountsCommon.escapeHtml(r.account_group || '—')}</td>
                <td>${r.parent_code ? `<code>${AccountsCommon.escapeHtml(r.parent_code)}</code>` : '—'}</td>
                <td>${r.opening_balance != null ? `${r.opening_balance} ${r.balance_type || ''}` : '—'}</td>
            </tr>
        `).join('');
        document.getElementById('customTemplateRowCount').textContent =
            `${valid.length} row${valid.length === 1 ? '' : 's'} parsed${valid.length > 50 ? ' (showing first 50)' : ''}`;
        document.getElementById('customTemplateValidationSummary').textContent =
            issues.length ? `${issues.length} skipped — ${issues[0]}` : 'All rows look valid';
        previewEl.hidden = false;
        importBtn.disabled = false;
    } catch (err) {
        console.error('[Setup] custom template parse error', err);
        errEl.textContent = err.message || 'Could not parse file.';
        errEl.hidden = false;
    }
}

// Tiny CSV parser — handles quoted fields, escaped quotes, CRLF/LF.
// Header row is mandatory; column order can be anything as long as headers match.
function _parseCsv(text) {
    const rows = [];
    let i = 0, field = '', row = [], inQuotes = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow   = () => { rows.push(row); row = []; };
    while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += ch; i++; continue;
        }
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === ',') { pushField(); i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch === '\n') { pushField(); pushRow(); i++; continue; }
        field += ch; i++;
    }
    if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
    if (rows.length === 0) return [];

    const headers = rows.shift().map(h => h.trim());
    return rows
        .filter(r => r.some(cell => (cell ?? '').trim() !== ''))
        .map(r => {
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
            return obj;
        });
}

// ============================================================================
// 9c. MANUAL CoA BUILDER (in-modal row grid)
// ============================================================================
// Same end-state as the CSV upload — submits to POST /api/accounts/coa/import
// — but lets the CA add accounts row by row in a modal grid. Useful when the
// chart is small enough that opening Excel feels heavier than typing rows.

const MANUAL_COA_TYPES = ['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses'];
let _manualCoaRowSeq = 0;
// Per-row SearchableDropdown instances so we can read their values back +
// dispose them when the row is removed. Keyed by row id.
const _manualCoaDropdowns = new Map(); // id -> { type, balance, parent }

function openManualCoaBuilderModal() {
    const body = document.getElementById('manualCoaTableBody');
    if (body) body.innerHTML = '';
    document.getElementById('manualCoaError').hidden = true;
    _manualCoaDropdowns.clear();
    _manualCoaRowSeq = 0;
    // Seed with 3 empty rows to give CAs something to type into.
    addManualCoaRow();
    addManualCoaRow();
    addManualCoaRow();
    AccountsCommon.openModal('manualCoaModal');
}
function closeManualCoaBuilderModal() {
    AccountsCommon.closeModal('manualCoaModal');
}

function addManualCoaRow(prefill) {
    const body = document.getElementById('manualCoaTableBody');
    if (!body) return;
    const id = ++_manualCoaRowSeq;
    const p = prefill || {};

    // Parent dropdown options = (1) every existing account in the system
    // (loaded into the global `accounts` array by setup.js init) + (2) every
    // code already typed into a previous row in this modal. Recomputed every
    // time we render so newer rows can parent older ones.
    const tr = document.createElement('tr');
    tr.dataset.manualRow = id;
    tr.innerHTML = `
        <td><input type="text" data-col="account_code" placeholder="e.g. 1100" value="${_attr(p.account_code)}"></td>
        <td><input type="text" data-col="account_name" placeholder="e.g. Current Assets" value="${_attr(p.account_name)}"></td>
        <td><div class="searchable-dropdown-container manual-coa-sd" data-col="account_type" id="manualCoaType-${id}"></div></td>
        <td><input type="text" data-col="account_group" placeholder="optional" value="${_attr(p.account_group)}"></td>
        <td><div class="searchable-dropdown-container manual-coa-sd" data-col="parent_code" id="manualCoaParent-${id}"></div></td>
        <td><input type="number" data-col="opening_balance" step="0.01" placeholder="0.00" value="${_attr(p.opening_balance)}"></td>
        <td><div class="searchable-dropdown-container manual-coa-sd" data-col="balance_type" id="manualCoaBalance-${id}"></div></td>
        <td>
            <button type="button" class="manual-coa-remove" title="Remove row" onclick="removeManualCoaRow(${id})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </td>
    `;
    body.appendChild(tr);

    // Replace the native selects with SearchableDropdown — house style is to
    // never use the browser default <select> in our forms.
    const typeDropdown = new SearchableDropdown(document.getElementById(`manualCoaType-${id}`), {
        id: `manualCoaType-${id}-sd`,
        options: [
            { value: '', label: '— select —' },
            ...MANUAL_COA_TYPES.map(t => ({ value: t, label: t }))
        ],
        value: p.account_type || '',
        placeholder: '— select —',
        compact: true
    });
    const balanceDropdown = new SearchableDropdown(document.getElementById(`manualCoaBalance-${id}`), {
        id: `manualCoaBalance-${id}-sd`,
        options: [
            { value: '',       label: '—' },
            { value: 'debit',  label: 'Debit'  },
            { value: 'credit', label: 'Credit' }
        ],
        value: p.balance_type || '',
        placeholder: '—',
        compact: true
    });

    // Parent dropdown — searchable list of (a) codes already typed in this
    // modal + (b) accounts already in the tenant's CoA. Built fresh now,
    // refreshed by _refreshManualCoaParentSuggestions when other rows change.
    const parentDropdown = new SearchableDropdown(document.getElementById(`manualCoaParent-${id}`), {
        id: `manualCoaParent-${id}-sd`,
        options: _buildManualCoaParentOptions(),
        value: p.parent_code || '',
        placeholder: 'optional',
        searchPlaceholder: 'Search parent…',
        compact: true,
        virtualScroll: true
    });

    _manualCoaDropdowns.set(id, { type: typeDropdown, balance: balanceDropdown, parent: parentDropdown });

    // Re-pull parent options whenever this row's code changes — debounced
    // so we don't rebuild on every keystroke.
    const codeInput = tr.querySelector('input[data-col="account_code"]');
    let _t = null;
    codeInput?.addEventListener('input', () => {
        clearTimeout(_t);
        _t = setTimeout(_refreshManualCoaParentSuggestions, 250);
    });

    // Refresh sibling parent dropdowns + recount
    _refreshManualCoaParentSuggestions();
    _updateManualCoaRowCount();
}

function _buildManualCoaParentOptions() {
    // (1) Existing accounts in the tenant — populated by setup.js into the
    //     global `accounts` variable when the page loads.
    const existing = (Array.isArray(window.accounts) ? window.accounts
                       : (typeof accounts !== 'undefined' ? accounts : []))
        .map(a => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }));
    // (2) Codes typed in the current modal session
    const inModal = Array.from(document.querySelectorAll('#manualCoaTableBody tr'))
        .map(tr => (tr.querySelector('input[data-col="account_code"]')?.value || '').trim())
        .filter(c => c.length > 0)
        .map(c => ({ value: c, label: `${c} (in this batch)` }));
    // Dedupe by value
    const seen = new Set();
    const merged = [{ value: '', label: '— none —' }];
    for (const opt of [...inModal, ...existing]) {
        if (seen.has(opt.value)) continue;
        seen.add(opt.value);
        merged.push(opt);
    }
    return merged;
}

function removeManualCoaRow(id) {
    const tr = document.querySelector(`#manualCoaTableBody tr[data-manual-row="${id}"]`);
    if (tr) tr.remove();
    _manualCoaDropdowns.delete(id);
    _refreshManualCoaParentSuggestions();
    _updateManualCoaRowCount();
}

function _attr(v) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function _updateManualCoaRowCount() {
    const n = document.querySelectorAll('#manualCoaTableBody tr').length;
    const el = document.getElementById('manualCoaRowCount');
    if (el) el.textContent = `${n} row${n === 1 ? '' : 's'}`;
}

// Rebuild parent dropdown options for every row whenever code typing/row
// changes happen. Each row's SearchableDropdown is re-rendered in place,
// preserving its current selection.
function _refreshManualCoaParentSuggestions() {
    const opts = _buildManualCoaParentOptions();
    _manualCoaDropdowns.forEach((dds) => {
        if (dds.parent) {
            const current = dds.parent.selectedValue;
            dds.parent.options = opts;
            dds.parent.filteredOptions = [...opts];
            dds.parent.render();
            dds.parent.bindEvents();
            // Restore selection if still valid
            if (current && opts.some(o => String(o.value) === String(current))) {
                dds.parent.selectedValue = current;
                dds.parent.render();
                dds.parent.bindEvents();
            }
        }
    });
}

function _collectManualCoaRows() {
    const rows = [];
    const issues = [];
    document.querySelectorAll('#manualCoaTableBody tr').forEach((tr, idx) => {
        const id = Number(tr.dataset.manualRow);
        const dropdowns = _manualCoaDropdowns.get(id);
        const get = (col) => (tr.querySelector(`input[data-col="${col}"]`)?.value || '').trim();
        const code = get('account_code');
        const name = get('account_name');
        const type = (dropdowns?.type?.selectedValue || '').toString().trim();
        const balance = (dropdowns?.balance?.selectedValue || '').toString().trim();

        // Drop fully-empty rows silently — CAs leave blanks at the bottom
        if (!code && !name && !type) return;

        if (!code || !name || !type) {
            issues.push(`Row ${idx + 1}: missing ${[!code && 'code', !name && 'name', !type && 'type'].filter(Boolean).join(', ')}`);
            tr.querySelectorAll('input').forEach(el => {
                if (el.dataset.col === 'account_code' && !code) el.classList.add('row-error');
                else if (el.dataset.col === 'account_name' && !name) el.classList.add('row-error');
                else el.classList.remove('row-error');
            });
            // Mark the type dropdown container if missing
            const typeContainer = tr.querySelector('[data-col="account_type"]');
            if (typeContainer) typeContainer.classList.toggle('row-error', !type);
            return;
        }
        // Clear any prior error highlight for this row
        tr.querySelectorAll('input').forEach(el => el.classList.remove('row-error'));
        tr.querySelector('[data-col="account_type"]')?.classList.remove('row-error');

        // Parent is now a SearchableDropdown that returns the bare code (no
        // " — Name" suffix), so no parsing needed.
        const parentCode = (dropdowns?.parent?.selectedValue || '').toString().trim();
        const opening = get('opening_balance');

        rows.push({
            account_code: code,
            account_name: name,
            account_type: type,
            account_group: get('account_group') || null,
            parent_code:   parentCode || null,
            description:   null,
            opening_balance: opening !== '' ? Number(opening) : null,
            balance_type:  balance || null
        });
    });
    return { rows, issues };
}

async function submitManualCoa() {
    const errEl = document.getElementById('manualCoaError');
    errEl.hidden = true;

    const { rows, issues } = _collectManualCoaRows();
    if (rows.length === 0) {
        errEl.textContent = issues.length
            ? `Fix these before saving: ${issues.slice(0, 5).join(' | ')}`
            : 'Add at least one account before saving.';
        errEl.hidden = false;
        return;
    }
    if (issues.length > 0) {
        errEl.textContent = `Fix these before saving: ${issues.slice(0, 5).join(' | ')}`;
        errEl.hidden = false;
        return;
    }

    const ok = await Confirm.show({
        title: 'Save Chart of Accounts',
        message: `Save ${rows.length} account${rows.length === 1 ? '' : 's'}? Existing codes will be skipped automatically.`,
        confirmText: 'Save',
        type: 'warning'
    });
    if (!ok) return;

    const btn = document.getElementById('manualCoaSaveBtn');
    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = 'Saving…';
    try {
        const result = await api.request(AccountsCommon.buildUrl('coa/import'), {
            method: 'POST',
            body: JSON.stringify({ accounts: rows })
        });

        const created = result.created ?? 0;
        const skipped = result.skipped ?? 0;
        const failed  = result.failed  ?? 0;
        Toast.success(`Saved ${created} new, skipped ${skipped} existing, ${failed} failed.`);

        if (Array.isArray(result.results)) {
            const firstFailure = result.results.find(r => r.status === 'failed');
            if (firstFailure) {
                console.warn('[Setup] Manual CoA failure:', firstFailure);
                Toast.error(`First failure: ${firstFailure.account_code} — ${firstFailure.reason}`);
            }
            const warned = result.results.filter(r => r.warning);
            if (warned.length > 0) {
                console.warn('[Setup] Manual CoA warnings:', warned);
                const first = warned[0];
                const more = warned.length > 1 ? ` (+${warned.length - 1} more — see console)` : '';
                Toast.warning?.(`${first.account_code}: ${first.warning}${more}`)
                    ?? Toast.error(`${first.account_code}: ${first.warning}${more}`);
            }
        }

        // Only close if everything was created without hard failures.
        // If there are failures, leave modal open so the CA can fix and resave.
        if (failed === 0) {
            closeManualCoaBuilderModal();
        }

        await Promise.all([loadAccountTypes(), loadAccountGroups()]);
        await loadAccounts();
    } catch (err) {
        console.error('[Setup] submitManualCoa error:', err);
        Toast.error(err.message || 'Failed to save accounts');
        errEl.textContent = err.message || 'Failed to save accounts';
        errEl.hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = prevText;
    }
}

async function submitCustomTemplate() {
    if (_customTemplateParsedRows.length === 0) {
        Toast.error('Pick a file first.');
        return;
    }
    const ok = await Confirm.show({
        title: 'Import Custom Chart of Accounts',
        message: `Import ${_customTemplateParsedRows.length} accounts? Existing codes are skipped automatically.`,
        confirmText: 'Import',
        type: 'warning'
    });
    if (!ok) return;

    const btn = document.getElementById('customTemplateImportBtn');
    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = 'Importing…';
    try {
        const result = await api.request(AccountsCommon.buildUrl('coa/import'), {
            method: 'POST',
            body: JSON.stringify({ accounts: _customTemplateParsedRows })
        });

        const created = result.created ?? 0;
        const skipped = result.skipped ?? 0;
        const failed  = result.failed  ?? 0;
        Toast.success(`Imported ${created} new, skipped ${skipped} existing, ${failed} failed.`);

        if (Array.isArray(result.results)) {
            // Surface the first failure (hard error)
            const firstFailure = result.results.find(r => r.status === 'failed');
            if (firstFailure) {
                console.warn('[Setup] First import failure:', firstFailure);
                Toast.error(`First failure: ${firstFailure.account_code} — ${firstFailure.reason}`);
            }
            // Also surface warnings — created-but-with-issues (missing parent, missing group,
            // opening balance not applied, etc). Important so CAs notice fat-fingered codes.
            const warned = result.results.filter(r => r.warning);
            if (warned.length > 0) {
                console.warn('[Setup] Import warnings:', warned);
                const first = warned[0];
                const more  = warned.length > 1 ? ` (+${warned.length - 1} more — see console)` : '';
                Toast.warning?.(`${first.account_code}: ${first.warning}${more}`)
                    ?? Toast.error(`${first.account_code}: ${first.warning}${more}`);
            }
        }

        closeCustomTemplateModal();
        await Promise.all([loadAccountTypes(), loadAccountGroups()]);
        await loadAccounts();
    } catch (err) {
        console.error('[Setup] submitCustomTemplate error:', err);
        Toast.error(err.message || 'Failed to import accounts');
    } finally {
        btn.disabled = false;
        btn.textContent = prevText;
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
