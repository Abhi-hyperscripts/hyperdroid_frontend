/**
 * AccountsService — Expense Management Page
 *
 * Handles 3 sidebar tabs:
 *   1. Expense Categories
 *   2. Expense Policies
 *   3. Expense Claims
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let expenseCategories = [];
let expensePolicies = [];
let expenseClaims = [];
let coaAccounts = [];
let bankAccounts = [];

// Dropdown instances
let categoryAccountDropdown = null;
let policyCategoryDropdown = null;
let reimburseBankDropdown = null;

// Pagination
let claimsPage = 1;
const claimsLimit = 20;
let claimsTotalPages = 1;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('expenses', '../')) return;

    const tabNames = {
        'expense-categories': 'Categories',
        'expense-policies': 'Policies',
        'expense-claims': 'Expense Claims'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    setupSearchListeners();
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'expense-categories': loadExpenseCategories(); break;
        case 'expense-policies':   loadExpensePolicies(); break;
        case 'expense-claims':     claimsPage = 1; loadExpenseClaims(); break;
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        const [catRes, acctRes, bankRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('expenses/categories'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => [])
        ]);
        expenseCategories = Array.isArray(catRes) ? catRes : (catRes?.data || catRes?.items || []);
        coaAccounts = Array.isArray(acctRes) ? acctRes : (acctRes?.data || acctRes?.items || []);
        bankAccounts = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);

        renderCategoriesTable();
        await Promise.all([loadExpensePolicies(), loadExpenseClaims()]);
    } catch (err) {
        console.error('[Expenses] loadInitialData error:', err);
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

    const catSearch = document.getElementById('categorySearch');
    if (catSearch) catSearch.addEventListener('input', debounce(() => renderCategoriesTable()));

    const polSearch = document.getElementById('policySearch');
    if (polSearch) polSearch.addEventListener('input', debounce(() => renderPoliciesTable()));

    const claimSearch = document.getElementById('claimSearch');
    if (claimSearch) claimSearch.addEventListener('input', debounce(() => renderClaimsTable()));
}

// ============================================================================
// 1. EXPENSE CATEGORIES
// ============================================================================

async function loadExpenseCategories() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('expenses/categories'), { _skipSpinner: true });
        expenseCategories = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderCategoriesTable();
    } catch (err) {
        console.error('[Expenses] loadExpenseCategories error:', err);
        Toast.error('Failed to load expense categories');
    }
}

function renderCategoriesTable() {
    const tbody = document.getElementById('expenseCategoriesTable');
    if (!tbody) return;

    const search = (document.getElementById('categorySearch')?.value || '').toLowerCase();
    let filtered = expenseCategories;
    if (search) {
        filtered = filtered.filter(c =>
            (c.name || '').toLowerCase().includes(search) ||
            (c.description || '').toLowerCase().includes(search)
        );
    }

    if (!filtered.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"></path>
            </svg><p>No expense categories found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(c => {
        const acct = coaAccounts.find(a => a.id === c.default_account_id);
        const statusClass = c.is_active !== false ? 'status-active' : 'status-rejected';
        const statusText = c.is_active !== false ? 'Active' : 'Inactive';
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editCategory('${c.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
            : '-';
        return `<tr>
            <td>${AccountsCommon.escapeHtml(c.name)}</td>
            <td>${AccountsCommon.escapeHtml(c.description || '-')}</td>
            <td>${AccountsCommon.escapeHtml(acct?.name || c.default_account_id || '-')}</td>
            <td><span class="badge ${statusClass}">${statusText}</span></td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// CATEGORY MODAL
// ============================================================================

function showCreateCategoryModal() {
    document.getElementById('categoryModalTitle').textContent = 'Add Category';
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryId').value = '';
    initCategoryDropdowns();
    AccountsCommon.openModal('expenseCategoryModal');
}

function editCategory(id) {
    const c = expenseCategories.find(x => x.id === id);
    if (!c) return;
    document.getElementById('categoryModalTitle').textContent = 'Edit Category';
    document.getElementById('categoryId').value = c.id;
    document.getElementById('categoryName').value = c.name || '';
    document.getElementById('categoryDescription').value = c.description || '';
    initCategoryDropdowns(c.default_account_id);
    AccountsCommon.openModal('expenseCategoryModal');
}

function initCategoryDropdowns(accountValue) {
    const container = document.getElementById('categoryDefaultAccountContainer');
    if (!container || typeof SearchableDropdown !== 'function') return;
    container.innerHTML = '';
    const options = coaAccounts.map(a => ({ value: a.id, label: `${a.code ? a.code + ' - ' : ''}${a.name}` }));
    categoryAccountDropdown = new SearchableDropdown(container, {
        id: 'categoryDefaultAccountDD',
        options,
        value: accountValue || null,
        placeholder: 'Select GL account...',
        searchPlaceholder: 'Search accounts...',
        onChange: () => {}
    });
}

async function saveExpenseCategory() {
    const id = document.getElementById('categoryId').value;
    const name = document.getElementById('categoryName').value.trim();
    if (!name) { Toast.error('Category name is required'); return; }

    const payload = {
        name,
        description: document.getElementById('categoryDescription').value.trim() || null,
        default_account_id: categoryAccountDropdown?.getValue() || null
    };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`expenses/categories/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Category updated');
        } else {
            await api.request(AccountsCommon.buildUrl('expenses/categories'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Category created');
        }
        AccountsCommon.closeModal('expenseCategoryModal');
        await loadExpenseCategories();
    } catch (err) {
        console.error('[Expenses] saveExpenseCategory error:', err);
        Toast.error(err.message || 'Failed to save category');
    }
}

// ============================================================================
// 2. EXPENSE POLICIES
// ============================================================================

async function loadExpensePolicies() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('expenses/policies'), { _skipSpinner: true });
        expensePolicies = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderPoliciesTable();
    } catch (err) {
        console.error('[Expenses] loadExpensePolicies error:', err);
        Toast.error('Failed to load expense policies');
    }
}

function renderPoliciesTable() {
    const tbody = document.getElementById('expensePoliciesTable');
    if (!tbody) return;

    const search = (document.getElementById('policySearch')?.value || '').toLowerCase();
    let filtered = expensePolicies;
    if (search) {
        filtered = filtered.filter(p =>
            (p.name || '').toLowerCase().includes(search) ||
            (p.description || '').toLowerCase().includes(search)
        );
    }

    if (!filtered.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg><p>No expense policies found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const cat = expenseCategories.find(c => c.id === p.expense_category_id);
        const statusClass = p.is_active !== false ? 'status-active' : 'status-rejected';
        const statusText = p.is_active !== false ? 'Active' : 'Inactive';
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editPolicy('${p.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
            : '-';
        return `<tr>
            <td>${AccountsCommon.escapeHtml(p.name)}</td>
            <td>${p.max_amount != null ? AccountsCommon.formatCurrency(p.max_amount) : '-'}</td>
            <td>${p.requires_receipt_above != null ? AccountsCommon.formatCurrency(p.requires_receipt_above) : '-'}</td>
            <td>${AccountsCommon.escapeHtml(cat?.name || '-')}</td>
            <td><span class="badge ${statusClass}">${statusText}</span></td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// POLICY MODAL
// ============================================================================

function showCreatePolicyModal() {
    document.getElementById('policyModalTitle').textContent = 'Add Policy';
    document.getElementById('policyForm').reset();
    document.getElementById('policyId').value = '';
    document.getElementById('policyIsActive').checked = true;
    initPolicyDropdowns();
    AccountsCommon.openModal('expensePolicyModal');
}

function editPolicy(id) {
    const p = expensePolicies.find(x => x.id === id);
    if (!p) return;
    document.getElementById('policyModalTitle').textContent = 'Edit Policy';
    document.getElementById('policyId').value = p.id;
    document.getElementById('policyName').value = p.name || '';
    document.getElementById('policyMaxAmount').value = p.max_amount ?? '';
    document.getElementById('policyReceiptAbove').value = p.requires_receipt_above ?? '';
    document.getElementById('policyDescription').value = p.description || '';
    document.getElementById('policyIsActive').checked = p.is_active !== false;
    initPolicyDropdowns(p.expense_category_id);
    AccountsCommon.openModal('expensePolicyModal');
}

function initPolicyDropdowns(categoryValue) {
    const container = document.getElementById('policyCategoryContainer');
    if (!container || typeof SearchableDropdown !== 'function') return;
    container.innerHTML = '';
    const options = expenseCategories.map(c => ({ value: c.id, label: c.name }));
    policyCategoryDropdown = new SearchableDropdown(container, {
        id: 'policyCategoryDD',
        options,
        value: categoryValue || null,
        placeholder: 'Select category...',
        searchPlaceholder: 'Search categories...',
        onChange: () => {}
    });
}

async function saveExpensePolicy() {
    const id = document.getElementById('policyId').value;
    const name = document.getElementById('policyName').value.trim();
    if (!name) { Toast.error('Policy name is required'); return; }

    const maxVal = document.getElementById('policyMaxAmount').value;
    const receiptVal = document.getElementById('policyReceiptAbove').value;

    const payload = {
        name,
        max_amount: maxVal ? parseFloat(maxVal) : null,
        requires_receipt_above: receiptVal ? parseFloat(receiptVal) : null,
        expense_category_id: policyCategoryDropdown?.getValue() || null,
        description: document.getElementById('policyDescription').value.trim() || null,
        is_active: document.getElementById('policyIsActive').checked
    };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`expenses/policies/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Policy updated');
        } else {
            await api.request(AccountsCommon.buildUrl('expenses/policies'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Policy created');
        }
        AccountsCommon.closeModal('expensePolicyModal');
        await loadExpensePolicies();
    } catch (err) {
        console.error('[Expenses] saveExpensePolicy error:', err);
        Toast.error(err.message || 'Failed to save policy');
    }
}

// ============================================================================
// 3. EXPENSE CLAIMS
// ============================================================================

async function loadExpenseClaims() {
    try {
        const status = document.getElementById('claimStatusFilter')?.value || '';
        const offset = (claimsPage - 1) * claimsLimit;
        const params = { limit: claimsLimit, offset };
        if (status) params.status = status;

        const res = await api.request(AccountsCommon.buildUrl('expenses/claims', params), { _skipSpinner: true });

        if (res && typeof res === 'object' && !Array.isArray(res)) {
            expenseClaims = res.data || res.items || [];
            const total = res.total || res.totalCount || expenseClaims.length;
            claimsTotalPages = Math.max(1, Math.ceil(total / claimsLimit));
            updateClaimStats(res);
        } else {
            expenseClaims = Array.isArray(res) ? res : [];
            claimsTotalPages = 1;
        }
        renderClaimsTable();
        AccountsCommon.renderPagination('claimsPagination', claimsPage, claimsTotalPages, (page) => {
            claimsPage = page;
            loadExpenseClaims();
        });
    } catch (err) {
        console.error('[Expenses] loadExpenseClaims error:', err);
        Toast.error('Failed to load expense claims');
    }
}

function updateClaimStats(res) {
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    const stats = res?.stats || {};
    el('totalClaims', stats.total_count ?? (res.total || res.totalCount || expenseClaims.length));
    el('submittedClaims', stats.submitted_count ?? (res.submitted_count ?? expenseClaims.filter(c => c.status === 'submitted').length));
    el('approvedClaims', stats.approved_count ?? (res.approved_count ?? expenseClaims.filter(c => c.status === 'approved').length));
    el('reimbursedClaims', stats.reimbursed_count ?? (res.reimbursed_count ?? expenseClaims.filter(c => c.status === 'reimbursed').length));
}

function renderClaimsTable() {
    const tbody = document.getElementById('expenseClaimsTable');
    if (!tbody) return;

    const search = (document.getElementById('claimSearch')?.value || '').toLowerCase();
    let filtered = expenseClaims;
    if (search) {
        filtered = filtered.filter(c =>
            (c.claim_number || '').toLowerCase().includes(search) ||
            (c.employee_name || '').toLowerCase().includes(search) ||
            (c.description || '').toLowerCase().includes(search)
        );
    }

    if (!filtered.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg><p>No expense claims found</p></div></td></tr>`;
        return;
    }

    const isAdmin = accountsRoles.isAdmin();
    tbody.innerHTML = filtered.map(c => {
        let actions = `<button class="btn-icon" onclick="viewClaim('${c.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        if (isAdmin && c.status === 'submitted') {
            actions += ` <button class="btn-icon" onclick="approveClaim('${c.id}')" data-tooltip="Approve" data-admin-only><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>`;
            actions += ` <button class="btn-icon" onclick="showRejectClaimModal('${c.id}')" data-tooltip="Reject" data-admin-only><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
        }
        if (isAdmin && c.status === 'approved') {
            actions += ` <button class="btn-icon" onclick="showReimburseClaimModal('${c.id}')" data-tooltip="Reimburse" data-admin-only><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>`;
        }
        return `<tr>
            <td>${AccountsCommon.escapeHtml(c.claim_number || '-')}</td>
            <td>${AccountsCommon.escapeHtml(c.employee_name || '-')}</td>
            <td>${AccountsCommon.formatDate(c.claim_date)}</td>
            <td>${AccountsCommon.formatCurrency(c.total_amount)}</td>
            <td>${AccountsCommon.escapeHtml(c.description || '-')}</td>
            <td>${AccountsCommon.statusBadge(c.status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// SUBMIT CLAIM MODAL
// ============================================================================

function showSubmitClaimModal() {
    document.getElementById('claimForm').reset();
    document.getElementById('claimDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('claimItemsBody').innerHTML = '';
    document.getElementById('claimTotal').textContent = '0.00';
    addClaimItem();
    AccountsCommon.openModal('submitClaimModal');
}

let claimItemIndex = 0;

function addClaimItem() {
    const tbody = document.getElementById('claimItemsBody');
    if (!tbody) return;
    const idx = claimItemIndex++;
    const catOptions = expenseCategories
        .filter(c => c.is_active !== false)
        .map(c => `<option value="${c.id}">${AccountsCommon.escapeHtml(c.name)}</option>`)
        .join('');

    const row = document.createElement('tr');
    row.id = `claimItem_${idx}`;
    row.innerHTML = `
        <td><select class="form-control claim-item-category" data-idx="${idx}">
            <option value="">Select...</option>${catOptions}
        </select></td>
        <td><input type="text" class="form-control claim-item-desc" data-idx="${idx}" placeholder="Description"></td>
        <td><input type="number" class="form-control claim-item-amount" data-idx="${idx}" min="0" step="0.01" placeholder="0.00" onchange="calculateClaimTotal()" oninput="calculateClaimTotal()"></td>
        <td><input type="date" class="form-control claim-item-date" data-idx="${idx}" value="${new Date().toISOString().split('T')[0]}"></td>
        <td><button type="button" class="btn-icon" onclick="removeClaimItem(${idx})" data-tooltip="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);
}

function removeClaimItem(idx) {
    const row = document.getElementById(`claimItem_${idx}`);
    if (row) row.remove();
    calculateClaimTotal();
}

function calculateClaimTotal() {
    const amounts = document.querySelectorAll('.claim-item-amount');
    let total = 0;
    amounts.forEach(inp => { total += parseFloat(inp.value) || 0; });
    const el = document.getElementById('claimTotal');
    if (el) el.textContent = total.toFixed(2);
    return total;
}

async function saveExpenseClaim() {
    const claimDate = document.getElementById('claimDate').value;
    const description = document.getElementById('claimDescription').value.trim();
    if (!claimDate) { Toast.error('Claim date is required'); return; }
    if (!description) { Toast.error('Description is required'); return; }

    const rows = document.querySelectorAll('#claimItemsBody tr');
    if (!rows.length) { Toast.error('Add at least one expense item'); return; }

    const items = [];
    for (const row of rows) {
        const cat = row.querySelector('.claim-item-category')?.value || null;
        const desc = row.querySelector('.claim-item-desc')?.value?.trim() || '';
        const amount = parseFloat(row.querySelector('.claim-item-amount')?.value) || 0;
        const date = row.querySelector('.claim-item-date')?.value || claimDate;

        if (amount <= 0) { Toast.error('Each item must have an amount greater than 0'); return; }
        items.push({ expense_category_id: cat || null, description: desc, amount, expense_date: date });
    }

    const payload = { claim_date: claimDate, description, items };

    try {
        await api.request(AccountsCommon.buildUrl('expenses/claims'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Expense claim submitted');
        AccountsCommon.closeModal('submitClaimModal');
        await loadExpenseClaims();
    } catch (err) {
        console.error('[Expenses] saveExpenseClaim error:', err);
        Toast.error(err.message || 'Failed to submit claim');
    }
}

// ============================================================================
// CLAIM DETAIL
// ============================================================================

async function viewClaim(id) {
    try {
        const claim = await api.request(AccountsCommon.buildUrl(`expenses/claims/${id}`));
        const items = claim.items || [];
        const itemsHtml = items.length ? `
            <div class="data-table-container" style="margin-top:1rem;">
                <table class="data-table">
                    <thead><tr><th>Category</th><th>Description</th><th>Amount</th><th>Date</th></tr></thead>
                    <tbody>${items.map(i => `<tr>
                        <td>${AccountsCommon.escapeHtml(i.category_name || '-')}</td>
                        <td>${AccountsCommon.escapeHtml(i.description || '-')}</td>
                        <td>${AccountsCommon.formatCurrency(i.amount)}</td>
                        <td>${AccountsCommon.formatDate(i.date)}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>` : '<p>No items</p>';

        document.getElementById('claimDetailTitle').textContent = `Claim ${claim.claim_number || ''}`;
        document.getElementById('claimDetailBody').innerHTML = `
            <div class="form-row two-col">
                <div class="form-group"><label>Employee</label><p>${AccountsCommon.escapeHtml(claim.employee_name || '-')}</p></div>
                <div class="form-group"><label>Date</label><p>${AccountsCommon.formatDate(claim.claim_date)}</p></div>
            </div>
            <div class="form-row two-col">
                <div class="form-group"><label>Total Amount</label><p><strong>${AccountsCommon.formatCurrency(claim.total_amount)}</strong></p></div>
                <div class="form-group"><label>Status</label><p>${AccountsCommon.statusBadge(claim.status)}</p></div>
            </div>
            <div class="form-group"><label>Description</label><p>${AccountsCommon.escapeHtml(claim.description || '-')}</p></div>
            ${claim.rejection_reason ? `<div class="form-group"><label>Rejection Reason</label><p style="color:var(--color-error);">${AccountsCommon.escapeHtml(claim.rejection_reason)}</p></div>` : ''}
            <label style="margin-top:1rem; font-weight:600;">Items</label>
            ${itemsHtml}`;
        AccountsCommon.openModal('claimDetailModal');
    } catch (err) {
        console.error('[Expenses] viewClaim error:', err);
        Toast.error('Failed to load claim details');
    }
}

// ============================================================================
// APPROVE / REJECT / REIMBURSE
// ============================================================================

async function approveClaim(id) {
    const ok = await Confirm.show({ title: 'Confirm Approval', message: 'Approve this expense claim?', confirmText: 'Approve', type: 'info' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`expenses/claims/${id}/approve`), { method: 'POST' });
        Toast.success('Claim approved');
        await loadExpenseClaims();
    } catch (err) {
        console.error('[Expenses] approveClaim error:', err);
        Toast.error(err.message || 'Failed to approve claim');
    }
}

function showRejectClaimModal(id) {
    document.getElementById('rejectClaimId').value = id;
    document.getElementById('rejectReason').value = '';
    AccountsCommon.openModal('rejectClaimModal');
}

async function rejectClaim() {
    const id = document.getElementById('rejectClaimId').value;
    const reason = document.getElementById('rejectReason').value.trim();
    if (!reason) { Toast.error('Rejection reason is required'); return; }

    try {
        await api.request(AccountsCommon.buildUrl(`expenses/claims/${id}/reject`), {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
        Toast.success('Claim rejected');
        AccountsCommon.closeModal('rejectClaimModal');
        await loadExpenseClaims();
    } catch (err) {
        console.error('[Expenses] rejectClaim error:', err);
        Toast.error(err.message || 'Failed to reject claim');
    }
}

function showReimburseClaimModal(id) {
    document.getElementById('reimburseClaimId').value = id;
    initReimburseDropdowns();
    AccountsCommon.openModal('reimburseClaimModal');
}

function initReimburseDropdowns() {
    const container = document.getElementById('reimburseBankAccountContainer');
    if (!container || typeof SearchableDropdown !== 'function') return;
    container.innerHTML = '';
    const options = bankAccounts
        .filter(b => b.is_active !== false)
        .map(b => ({ value: b.id, label: `${b.account_name || b.bank_name} - ${b.account_number || ''}`.trim() }));
    reimburseBankDropdown = new SearchableDropdown(container, {
        id: 'reimburseBankDD',
        options,
        value: null,
        placeholder: 'Select bank account...',
        searchPlaceholder: 'Search bank accounts...',
        onChange: () => {}
    });
}

async function reimburseClaim() {
    const id = document.getElementById('reimburseClaimId').value;
    const bankAccountId = reimburseBankDropdown?.getValue();
    if (!bankAccountId) { Toast.error('Please select a bank account'); return; }

    try {
        await api.request(AccountsCommon.buildUrl(`expenses/claims/${id}/reimburse`), {
            method: 'POST',
            body: JSON.stringify({ bank_account_id: bankAccountId })
        });
        Toast.success('Claim reimbursed');
        AccountsCommon.closeModal('reimburseClaimModal');
        await loadExpenseClaims();
    } catch (err) {
        console.error('[Expenses] reimburseClaim error:', err);
        Toast.error(err.message || 'Failed to reimburse claim');
    }
}

// ============================================================================
// DROPDOWN INIT (with retry for async script load)
// ============================================================================

function initDropdowns() {
    AccountsCommon.initSearchableDropdownsWithRetry(() => {
        // Dropdowns are initialized on-demand when modals open
        console.log('[Expenses] SearchableDropdown available');
    });
}
