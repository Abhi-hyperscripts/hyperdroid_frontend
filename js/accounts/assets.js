/**
 * AccountsService — Fixed Assets Page
 *
 * Handles 3 sidebar tabs:
 *   1. Asset Categories
 *   2. Asset Register
 *   3. Depreciation
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let assetCategories = [];
let assets = [];
let depreciationResults = [];

let assetPage = 1;
const PAGE_SIZE = 50;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('assets', '../')) return;

    const tabNames = {
        'asset-categories': 'Asset Categories',
        'asset-register': 'Asset Register',
        'depreciation': 'Depreciation'
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
        case 'asset-categories':  loadCategories(); break;
        case 'asset-register':    loadAssets(); break;
        case 'depreciation':      populateDepreciationCategoryFilter(); break;
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        await loadCategories();
    } catch (err) {
        console.error('[Assets] loadInitialData error:', err);
    }
}

function setupSearchListeners() {
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    const assetSearch = document.getElementById('assetSearch');
    if (assetSearch) assetSearch.addEventListener('input', debounce(() => { assetPage = 1; loadAssets(); }));
}

// ============================================================================
// 1. ASSET CATEGORIES
// ============================================================================

async function loadCategories() {
    try {
        const url = AccountsCommon.buildUrl('assets/categories');
        const res = await api.request(url, { _skipSpinner: true });
        assetCategories = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderCategories();
    } catch (err) {
        console.error('[Assets] loadCategories error:', err);
        Toast.error('Failed to load asset categories');
    }
}

function renderCategories() {
    const tbody = document.getElementById('assetCategoriesTable');
    if (!tbody) return;

    if (!assetCategories.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>
            </svg><p>No asset categories configured</p></div></td></tr>`;
        return;
    }

    const methodLabels = {
        'straight_line': 'Straight Line',
        'written_down_value': 'Written Down Value',
        'units_of_production': 'Units of Production'
    };

    tbody.innerHTML = assetCategories.map(c => {
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editCategory('${c.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteCategory('${c.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';

        return `<tr>
            <td>${AccountsCommon.escapeHtml(c.name)}</td>
            <td>${AccountsCommon.escapeHtml(methodLabels[c.depreciation_method] || c.depreciation_method || '-')}</td>
            <td>${c.useful_life_years ?? '-'}</td>
            <td>${c.depreciation_rate != null ? c.depreciation_rate + '%' : '-'}</td>
            <td>${AccountsCommon.escapeHtml(c.gl_account_name || '-')}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateCategoryModal() {
    document.getElementById('categoryModalTitle').textContent = 'Create Asset Category';
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryId').value = '';
    populateCategoryAccountSelects();
    AccountsCommon.openModal('assetCategoryModal');
}

function editCategory(id) {
    const cat = assetCategories.find(c => c.id === id);
    if (!cat) return;

    document.getElementById('categoryModalTitle').textContent = 'Edit Asset Category';
    document.getElementById('categoryId').value = cat.id;
    document.getElementById('categoryName').value = cat.name || '';
    document.getElementById('categoryMethod').value = cat.depreciation_method || '';
    document.getElementById('categoryUsefulLife').value = cat.useful_life_years ?? '';
    document.getElementById('categoryRate').value = cat.depreciation_rate ?? '';
    populateCategoryAccountSelects(cat.asset_account_id || cat.gl_account_id, cat.depreciation_account_id || cat.depreciation_expense_account_id);
    AccountsCommon.openModal('assetCategoryModal');
}

async function saveCategory() {
    const id = document.getElementById('categoryId').value;
    const name = document.getElementById('categoryName').value.trim();
    const depreciation_method = document.getElementById('categoryMethod').value;
    const useful_life_years = parseInt(document.getElementById('categoryUsefulLife').value);
    const depreciation_rate = document.getElementById('categoryRate').value ? parseFloat(document.getElementById('categoryRate').value) : null;
    const gl_account_id = document.getElementById('categoryGlAccount').value || null;
    const depreciation_expense_account_id = document.getElementById('categoryDepAccount').value || null;

    if (!name || !depreciation_method || isNaN(useful_life_years)) {
        Toast.error('Name, Depreciation Method, and Useful Life are required');
        return;
    }

    const payload = { name, depreciation_method, useful_life_years, depreciation_rate, asset_account_id: gl_account_id, depreciation_account_id: depreciation_expense_account_id };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`assets/categories/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Asset category updated');
        } else {
            await api.request(AccountsCommon.buildUrl('assets/categories'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Asset category created');
        }
        AccountsCommon.closeModal('assetCategoryModal');
        await loadCategories();
    } catch (err) {
        console.error('[Assets] saveCategory error:', err);
        Toast.error(err.message || 'Failed to save asset category');
    }
}

async function deleteCategory(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this asset category?', 'Delete Asset Category');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`assets/categories/${id}`), { method: 'DELETE' });
        Toast.success('Asset category deleted');
        await loadCategories();
    } catch (err) {
        console.error('[Assets] deleteCategory error:', err);
        Toast.error(err.message || 'Failed to delete asset category');
    }
}

async function populateCategoryAccountSelects(glAccountId, depAccountId) {
    try {
        const url = AccountsCommon.buildUrl('coa', { pageSize: 500 });
        const res = await api.request(url, { _skipSpinner: true });
        const accounts = Array.isArray(res) ? res : (res?.data || res?.items || []);

        const glSel = document.getElementById('categoryGlAccount');
        const depSel = document.getElementById('categoryDepAccount');

        const optionsHtml = accounts.map(a =>
            `<option value="${a.id}">${AccountsCommon.escapeHtml(a.account_code ? a.account_code + ' - ' + (a.account_name || a.name) : (a.account_name || a.name))}</option>`
        ).join('');

        if (glSel) {
            glSel.innerHTML = '<option value="">Select account...</option>' + optionsHtml;
            if (glAccountId) glSel.value = glAccountId;
        }
        if (depSel) {
            depSel.innerHTML = '<option value="">Select account...</option>' + optionsHtml;
            if (depAccountId) depSel.value = depAccountId;
        }
    } catch (err) {
        console.error('[Assets] populateCategoryAccountSelects error:', err);
    }
}

// ============================================================================
// 2. ASSET REGISTER
// ============================================================================

async function loadAssets() {
    try {
        const search = document.getElementById('assetSearch')?.value || '';
        const statusFilter = document.getElementById('assetStatusFilter')?.value || '';

        const params = { page: assetPage, pageSize: PAGE_SIZE };
        if (search) params.search = search;
        if (statusFilter) params.status = statusFilter;

        const url = AccountsCommon.buildUrl('assets', params);
        const res = await api.request(url, { _skipSpinner: true });
        assets = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const total = res?.total || res?.totalCount || assets.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        // Update stats
        const activeCount = assets.filter(a => a.status === 'active').length;
        const disposedCount = assets.filter(a => a.status === 'disposed').length;
        const bookValue = assets.reduce((sum, a) => sum + (a.book_value || 0), 0);

        const totalEl = document.getElementById('totalAssets');
        const activeEl = document.getElementById('activeAssets');
        const disposedEl = document.getElementById('disposedAssets');
        const bvEl = document.getElementById('totalBookValue');
        if (totalEl) totalEl.textContent = total;
        if (activeEl) activeEl.textContent = activeCount;
        if (disposedEl) disposedEl.textContent = disposedCount;
        if (bvEl) bvEl.textContent = AccountsCommon.formatCurrency(bookValue);

        renderAssets();
        AccountsCommon.renderPagination('assetsPagination', assetPage, totalPages, (page) => {
            assetPage = page;
            loadAssets();
        });
    } catch (err) {
        console.error('[Assets] loadAssets error:', err);
        Toast.error('Failed to load assets');
    }
}

function renderAssets() {
    const tbody = document.getElementById('assetsTable');
    if (!tbody) return;

    if (!assets.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>
            </svg><p>No assets registered</p></div></td></tr>`;
        return;
    }

    const catMap = {};
    assetCategories.forEach(c => { catMap[c.id] = c.name; });

    tbody.innerHTML = assets.map(a => {
        const catName = catMap[a.asset_category_id] || catMap[a.category_id] || a.category_name || '-';
        const status = a.status || 'active';

        let actions = '-';
        if (accountsRoles.isAdmin()) {
            actions = `<button class="btn-icon" onclick="editAsset('${a.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
            if (status === 'active') {
                actions += `<button class="btn-icon danger" onclick="showDisposeModal('${a.id}')" data-tooltip="Dispose"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
            }
        }

        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(a.asset_code || a.code || '-')}</code></td>
            <td>${AccountsCommon.escapeHtml(a.name)}</td>
            <td>${AccountsCommon.escapeHtml(catName)}</td>
            <td>${AccountsCommon.formatDate(a.purchase_date)}</td>
            <td class="text-right">${AccountsCommon.formatCurrency(a.purchase_cost || a.cost)}</td>
            <td class="text-right">${AccountsCommon.formatCurrency(a.book_value)}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showRegisterAssetModal() {
    document.getElementById('assetModalTitle').textContent = 'Register Asset';
    document.getElementById('assetForm').reset();
    document.getElementById('assetId').value = '';
    populateAssetCategorySelect();
    AccountsCommon.openModal('assetModal');
}

function editAsset(id) {
    const asset = assets.find(a => a.id === id);
    if (!asset) return;

    document.getElementById('assetModalTitle').textContent = 'Edit Asset';
    document.getElementById('assetId').value = asset.id;
    document.getElementById('assetCode').value = asset.asset_code || asset.code || '';
    document.getElementById('assetName').value = asset.name || '';
    document.getElementById('assetPurchaseDate').value = asset.purchase_date ? asset.purchase_date.split('T')[0] : '';
    document.getElementById('assetCost').value = asset.purchase_cost ?? asset.cost ?? '';
    document.getElementById('assetResidualValue').value = asset.salvage_value ?? asset.residual_value ?? '';
    document.getElementById('assetDescription').value = asset.description || '';
    populateAssetCategorySelect(asset.asset_category_id || asset.category_id);
    AccountsCommon.openModal('assetModal');
}

async function saveAsset() {
    const id = document.getElementById('assetId').value;
    const code = document.getElementById('assetCode').value.trim();
    const name = document.getElementById('assetName').value.trim();
    const category_id = document.getElementById('assetCategory').value;
    const purchase_date = document.getElementById('assetPurchaseDate').value;
    const cost = parseFloat(document.getElementById('assetCost').value);
    const residual_value = document.getElementById('assetResidualValue').value ? parseFloat(document.getElementById('assetResidualValue').value) : 0;
    const description = document.getElementById('assetDescription').value.trim();

    if (!code || !name || !category_id || !purchase_date || isNaN(cost)) {
        Toast.error('Code, Name, Category, Purchase Date, and Cost are required');
        return;
    }

    const createPayload = { asset_code: code, name, asset_category_id: category_id, purchase_date, purchase_cost: cost, salvage_value: residual_value, description };
    const updatePayload = { name, description };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`assets/${id}`), { method: 'PUT', body: JSON.stringify(updatePayload) });
            Toast.success('Asset updated');
        } else {
            await api.request(AccountsCommon.buildUrl('assets'), { method: 'POST', body: JSON.stringify(createPayload) });
            Toast.success('Asset registered');
        }
        AccountsCommon.closeModal('assetModal');
        await loadAssets();
    } catch (err) {
        console.error('[Assets] saveAsset error:', err);
        Toast.error(err.message || 'Failed to save asset');
    }
}

function populateAssetCategorySelect(selectedValue) {
    const sel = document.getElementById('assetCategory');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select...</option>' +
        assetCategories.map(c => `<option value="${c.id}" ${c.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(c.name)}</option>`).join('');
}

// ============================================================================
// DISPOSE ASSET
// ============================================================================

function showDisposeModal(id) {
    document.getElementById('disposeForm').reset();
    document.getElementById('disposeAssetId').value = id;
    AccountsCommon.openModal('disposeModal');
}

async function confirmDispose() {
    const id = document.getElementById('disposeAssetId').value;
    const disposal_date = document.getElementById('disposeDate').value;
    const sale_amount = document.getElementById('disposeSaleAmount').value ? parseFloat(document.getElementById('disposeSaleAmount').value) : 0;
    const reason = document.getElementById('disposeReason').value.trim();

    if (!disposal_date) {
        Toast.error('Disposal date is required');
        return;
    }

    const ok = await Confirm.danger('Are you sure you want to dispose this asset? This action cannot be undone.', 'Dispose Asset');
    if (!ok) return;

    try {
        await api.request(AccountsCommon.buildUrl(`assets/${id}/dispose`), {
            method: 'POST',
            body: JSON.stringify({ disposal_date, disposal_amount: sale_amount })
        });
        Toast.success('Asset disposed successfully');
        AccountsCommon.closeModal('disposeModal');
        await loadAssets();
    } catch (err) {
        console.error('[Assets] confirmDispose error:', err);
        Toast.error(err.message || 'Failed to dispose asset');
    }
}

// ============================================================================
// 3. DEPRECIATION
// ============================================================================

function populateDepreciationCategoryFilter() {
    const sel = document.getElementById('depreciationCategoryFilter');
    if (!sel) return;
    sel.innerHTML = '<option value="">All Categories</option>' +
        assetCategories.map(c => `<option value="${c.id}">${AccountsCommon.escapeHtml(c.name)}</option>`).join('');
}

async function runDepreciation() {
    const periodDate = document.getElementById('depreciationDate')?.value;
    const categoryId = document.getElementById('depreciationCategoryFilter')?.value || '';

    if (!periodDate) {
        Toast.error('Period end date is required');
        return;
    }

    const ok = await Confirm.show({ title: 'Run Depreciation', message: 'Run depreciation for the selected period? This will create journal entries.', confirmText: 'Continue', type: 'warning' });
    if (!ok) return;

    try {
        const payload = { period_date: periodDate };

        const url = AccountsCommon.buildUrl('assets/run-depreciation');
        const res = await api.request(url, { method: 'POST', body: JSON.stringify(payload) });
        // Backend returns { message, assets_processed } — show summary instead of detailed results
        const processed = res?.assets_processed || 0;
        depreciationResults = processed > 0 ? [{ summary: true, assets_processed: processed, message: res?.message }] : [];

        Toast.success('Depreciation calculated successfully');
        renderDepreciationResults();
    } catch (err) {
        console.error('[Assets] runDepreciation error:', err);
        Toast.error(err.message || 'Failed to run depreciation');
    }
}

function renderDepreciationResults() {
    const tbody = document.getElementById('depreciationTable');
    if (!tbody) return;

    if (!depreciationResults.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg><p>No depreciation results</p></div></td></tr>`;
        return;
    }

    if (depreciationResults[0]?.summary) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1.5rem;"><strong>${AccountsCommon.escapeHtml(depreciationResults[0].message || `Depreciation run for ${depreciationResults[0].assets_processed} asset(s)`)}</strong></td></tr>`;
        return;
    }
    tbody.innerHTML = depreciationResults.map(d => `<tr>
        <td>${AccountsCommon.escapeHtml(d.asset_name || d.name || '-')}</td>
        <td>${AccountsCommon.escapeHtml(d.category_name || '-')}</td>
        <td class="text-right">${AccountsCommon.formatCurrency(d.purchase_cost || d.cost)}</td>
        <td class="text-right">${AccountsCommon.formatCurrency(d.accumulated_depreciation)}</td>
        <td class="text-right">${AccountsCommon.formatCurrency(d.period_depreciation || d.depreciation_amount)}</td>
        <td class="text-right">${AccountsCommon.formatCurrency(d.book_value)}</td>
    </tr>`).join('');
}
