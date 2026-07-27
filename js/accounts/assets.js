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
let coaAccountNames = {}; // GL account id -> display name (for the categories table)

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
    AccountsCommon.initDatePickers(['assetPurchaseDate', 'disposeDate', 'depreciationDate']);
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    _acActiveRender = null;  // re-armed by loadAssets on the register tab
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
        await loadCoaAccountNames();
        await loadCategories();
    } catch (err) {
        console.error('[Assets] loadInitialData error:', err);
    }
}

async function loadCoaAccountNames() {
    try {
        const url = AccountsCommon.buildUrl('coa', { pageSize: 500 });
        const res = await api.request(url, { _skipSpinner: true });
        const accounts = Array.isArray(res) ? res : (res?.data || res?.items || []);
        coaAccountNames = {};
        accounts.forEach(a => {
            coaAccountNames[a.id] = a.account_code ? a.account_code + ' - ' + (a.account_name || a.name) : (a.account_name || a.name);
        });
    } catch (err) {
        console.error('[Assets] loadCoaAccountNames error:', err);
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
        'written_down': 'Written Down Value',
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
            <td>${AccountsCommon.escapeHtml(coaAccountNames[c.asset_account_id] || coaAccountNames[c.depreciation_account_id] || '-')}</td>
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
    const methodSel = document.getElementById('categoryMethod');
    methodSel.value = cat.depreciation_method || '';
    if (methodSel._searchableDropdown) methodSel._searchableDropdown.setValue(cat.depreciation_method || '');
    document.getElementById('categoryUsefulLife').value = cat.useful_life_years ?? '';
    document.getElementById('categoryRate').value = cat.depreciation_rate ?? '';
    populateCategoryAccountSelects(cat.asset_account_id || cat.gl_account_id, cat.depreciation_account_id || cat.depreciation_expense_account_id, cat.accumulated_dep_account_id);
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
    const accumulated_dep_account_id = document.getElementById('categoryAccumDep')?.value || null;

    if (!name || !depreciation_method || isNaN(useful_life_years)) {
        Toast.error('Name, Depreciation Method, and Useful Life are required');
        return;
    }

    // Include accumulated_dep_account_id — UpdateAssetCategory does a full-record replace, so omitting it
    // on edit silently blanks a previously-set accumulated-depreciation account.
    const payload = { name, depreciation_method, useful_life_years, depreciation_rate, asset_account_id: gl_account_id, depreciation_account_id: depreciation_expense_account_id, accumulated_dep_account_id };

    if (!AccountsCommon.beginSubmit('saveCategory')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveCategory');
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

async function populateCategoryAccountSelects(glAccountId, depAccountId, accumDepAccountId) {
    try {
        const url = AccountsCommon.buildUrl('coa', { pageSize: 500 });
        const res = await api.request(url, { _skipSpinner: true });
        const accounts = Array.isArray(res) ? res : (res?.data || res?.items || []);

        const glSel = document.getElementById('categoryGlAccount');
        const depSel = document.getElementById('categoryDepAccount');
        const accumSel = document.getElementById('categoryAccumDep');

        // Typed pickers: asset + accumulated-dep = postable Asset accounts, depreciation
        // charge = postable Expense accounts (headers/wrong types 409 at posting time).
        const toOpts = (list) => [{ value: '', label: 'Select account...' }].concat(list.map(a => ({
            value: a.id,
            label: a.account_code ? a.account_code + ' - ' + (a.account_name || a.name) : (a.account_name || a.name)
        })));
        const assetOpts = toOpts(AccountsCommon.postableAccounts(accounts, 'asset'));
        const expenseOpts = toOpts(AccountsCommon.postableAccounts(accounts, 'expense'));
        const optionsBySelect = [assetOpts, expenseOpts, assetOpts];

        const selectedById = [glAccountId, depAccountId, accumDepAccountId];
        [glSel, depSel, accumSel].forEach((sel, i) => {
            if (!sel) return;
            const selectedId = selectedById[i];
            if (sel._searchableDropdown) {
                sel._searchableDropdown.setOptions(optionsBySelect[i], false);
                if (selectedId) sel._searchableDropdown.setValue(selectedId);
            } else {
                sel.innerHTML = optionsBySelect[i].map(o => `<option value="${o.value}">${AccountsCommon.escapeHtml(o.label)}</option>`).join('');
                if (selectedId) sel.value = selectedId;
            }
        });
    } catch (err) {
        console.error('[Assets] populateCategoryAccountSelects error:', err);
    }
}

// ============================================================================
// 2. ASSET REGISTER
// ============================================================================

async function loadAssets() {
    try {
        const search = (document.getElementById('assetSearch')?.value || '').trim().toLowerCase();
        const statusFilter = document.getElementById('assetStatusFilter')?.value || '';

        // Backend GetAssets only supports a `status` query param — search and
        // pagination are applied client-side over the loaded list.
        const url = AccountsCommon.buildUrl('assets', statusFilter ? { status: statusFilter } : {});
        const res = await api.request(url, { _skipSpinner: true });
        let list = Array.isArray(res) ? res : (res?.data || res?.items || []);
        if (search) {
            list = list.filter(a =>
                (a.asset_code || a.code || '').toLowerCase().includes(search) ||
                (a.name || '').toLowerCase().includes(search) ||
                (a.description || '').toLowerCase().includes(search));
        }
        const total = list.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        if (assetPage > totalPages) assetPage = totalPages;
        assets = list.slice((assetPage - 1) * PAGE_SIZE, assetPage * PAGE_SIZE);

        // Update stats — prefer backend stats, fallback to client-side
        const stats = res?.stats || {};
        const setText = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        setText('totalAssets', stats.total_count ?? total);
        setText('activeAssets', stats.active_count ?? list.filter(a => a.status === 'active').length);
        setText('disposedAssets', stats.disposed_count ?? list.filter(a => a.status === 'disposed').length);
        setText('totalBookValue', stats.total_book_value != null ? AccountsCommon.formatCurrency(stats.total_book_value) : AccountsCommon.formatCurrency(list.reduce((sum, a) => sum + (a.book_value || 0), 0)));

        renderAssets();
        AccountsCommon.renderPagination('assetsPagination', assetPage, totalPages, (page) => {
            assetPage = page;
            loadAssets();
        });

        // Charts read the full filtered list (not the page slice)
        renderAssetCharts(list);
        _acActiveRender = () => renderAssetCharts(list);
    } catch (err) {
        console.error('[Assets] loadAssets error:', err);
        Toast.error('Failed to load assets');
    }
}

// Register charts — book value by category + cost-vs-book-value (gap = depreciation consumed)
function renderAssetCharts(list) {
    if (typeof acDonut !== 'function') return;
    const live = list.filter(a => a.status !== 'disposed');
    if (!live.length) { _acEmpty('assetCategoryChart'); _acEmpty('assetCostChart'); return; }
    const catMap = {};
    assetCategories.forEach(c => { catMap[c.id] = c.name; });
    const byCat = {};
    live.forEach(a => {
        const k = catMap[a.asset_category_id] || catMap[a.category_id] || a.category_name || 'Uncategorized';
        const b = byCat[k] || (byCat[k] = { book: 0, cost: 0 });
        b.book += parseFloat(a.book_value || 0);
        b.cost += parseFloat(a.purchase_cost || a.cost || 0);
    });
    const cats = Object.keys(byCat).sort();
    cats.some(k => byCat[k].book > 0)
        ? acDonut('assetCategoryChart', cats, cats.map(k => Math.round(byCat[k].book * 100) / 100),
                  cats.map((k, i) => _acPalette[i % _acPalette.length]))
        : _acEmpty('assetCategoryChart');
    acColumns('assetCostChart', cats.map(k => k.length > 14 ? k.slice(0, 13) + '…' : k), [
        { name: 'Purchase cost', data: cats.map(k => Math.round(byCat[k].cost * 100) / 100) },
        { name: 'Book value', data: cats.map(k => Math.round(byCat[k].book * 100) / 100) }
    ], ['#3b82f6', '#10b981']);
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

        let actions = `<button class="btn-icon" onclick="viewAssetDetail('${a.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        actions += `<button class="btn-icon" onclick="viewDepreciationSchedule('${a.id}')" data-tooltip="Schedule"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>`;
        if (accountsRoles.isAdmin()) {
            // Backend UpdateAsset 409s on non-active assets — only offer Edit while active.
            if (status === 'active') {
                actions += `<button class="btn-icon" onclick="editAsset('${a.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
            }
            if (status === 'active') {
                actions += `<button class="btn-icon danger" onclick="showDisposeModal('${a.id}')" data-tooltip="Dispose"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
            }
        }

        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(a.asset_code || a.code || '-')}</code></td>
            <td>${AccountsCommon.escapeHtml(a.asset_name || a.name || '-')}</td>
            <td>${AccountsCommon.escapeHtml(catName)}</td>
            <td>${AccountsCommon.formatDate(a.purchase_date)}</td>
            <td class="text-right">${AccountsCommon.formatCurrency(a.purchase_cost || a.cost)}</td>
            <td class="text-right">${AccountsCommon.formatCurrency(a.book_value)}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// Backend UpdateAssetBody only accepts { name, description, location, department } —
// code/category/purchase date/cost/residual are immutable after registration.
function setAssetEditMode(isEdit) {
    ['assetCode', 'assetCategory', 'assetPurchaseDate', 'assetCost', 'assetResidualValue'].forEach(fid => {
        const el = document.getElementById(fid);
        if (!el) return;
        el.disabled = isEdit;
        if (el._searchableDropdown) el._searchableDropdown.setDisabled(isEdit);
    });
}

function showRegisterAssetModal() {
    document.getElementById('assetModalTitle').textContent = 'Register Asset';
    document.getElementById('assetForm').reset();
    document.getElementById('assetId').value = '';
    setAssetEditMode(false);
    populateAssetCategorySelect();
    AccountsCommon.showFormPage('assetModal');
}

function editAsset(id) {
    const asset = assets.find(a => a.id === id);
    if (!asset) return;

    document.getElementById('assetModalTitle').textContent = 'Edit Asset';
    document.getElementById('assetId').value = asset.id;
    document.getElementById('assetCode').value = asset.asset_code || asset.code || '';
    document.getElementById('assetName').value = asset.name || '';
    AccountsCommon.setDateField('assetPurchaseDate', asset.purchase_date ? asset.purchase_date.split('T')[0] : '');
    document.getElementById('assetCost').value = asset.purchase_cost ?? asset.cost ?? '';
    document.getElementById('assetResidualValue').value = asset.salvage_value ?? asset.residual_value ?? '';
    document.getElementById('assetLocation').value = asset.location || '';
    document.getElementById('assetDepartment').value = asset.department || '';
    document.getElementById('assetDescription').value = asset.description || '';
    setAssetEditMode(true);
    populateAssetCategorySelect(asset.asset_category_id || asset.category_id);
    AccountsCommon.showFormPage('assetModal');
}

async function saveAsset() {
    const id = document.getElementById('assetId').value;
    const code = document.getElementById('assetCode').value.trim();
    const name = document.getElementById('assetName').value.trim();
    const category_id = document.getElementById('assetCategory').value;
    const purchase_date = document.getElementById('assetPurchaseDate').value;
    const cost = parseFloat(document.getElementById('assetCost').value);
    const residual_value = document.getElementById('assetResidualValue').value ? parseFloat(document.getElementById('assetResidualValue').value) : 0;
    const location = document.getElementById('assetLocation').value.trim() || null;
    const department = document.getElementById('assetDepartment').value.trim() || null;
    const description = document.getElementById('assetDescription').value.trim();

    if (!code || !name || !category_id || !purchase_date || isNaN(cost)) {
        Toast.error('Code, Name, Category, Purchase Date, and Cost are required');
        return;
    }

    const createPayload = { asset_code: code, name, asset_category_id: category_id, purchase_date, purchase_cost: cost, salvage_value: residual_value, location, department, description };
    // Backend UpdateAssetBody only supports these four fields
    const updatePayload = { name, description, location, department };

    if (!AccountsCommon.beginSubmit('saveAsset')) return;
    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`assets/${id}`), { method: 'PUT', body: JSON.stringify(updatePayload) });
            Toast.success('Asset updated');
        } else {
            await api.request(AccountsCommon.buildUrl('assets'), { method: 'POST', body: JSON.stringify(createPayload) });
            Toast.success('Asset registered');
        }
        AccountsCommon.hideFormPage('assetModal');
        await loadAssets();
    } catch (err) {
        console.error('[Assets] saveAsset error:', err);
        Toast.error(err.message || 'Failed to save asset');
    } finally {
        AccountsCommon.endSubmit('saveAsset');
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

let disposeBankAccountsLoaded = false;

function showDisposeModal(id) {
    document.getElementById('disposeForm').reset();
    document.getElementById('disposeAssetId').value = id;
    // form.reset() doesn't clear a converted SearchableDropdown's display
    const bankSel = document.getElementById('disposeBankAccount');
    if (bankSel?._searchableDropdown) bankSel._searchableDropdown.setValue('');
    populateDisposeBankAccounts();
    AccountsCommon.openModal('disposeModal');
}

// Optional destination for sale proceeds — loaded lazily on first open.
async function populateDisposeBankAccounts() {
    const sel = document.getElementById('disposeBankAccount');
    if (!sel || disposeBankAccountsLoaded) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true });
        const banks = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const options = [{ value: '', label: 'No bank account' }].concat(
            banks.filter(b => b.is_active !== false).map(b => ({
                value: b.id,
                label: [b.account_name || b.name, b.bank_name].filter(Boolean).join(' — ') || '-'
            })));
        if (sel._searchableDropdown) {
            sel._searchableDropdown.setOptions(options, false);
        } else {
            sel.innerHTML = options.map(o => `<option value="${o.value}">${AccountsCommon.escapeHtml(o.label)}</option>`).join('');
        }
        disposeBankAccountsLoaded = true;
    } catch (err) {
        console.error('[Assets] populateDisposeBankAccounts error:', err);
    }
}

async function confirmDispose() {
    const id = document.getElementById('disposeAssetId').value;
    const disposal_date = document.getElementById('disposeDate').value;
    const sale_amount = document.getElementById('disposeSaleAmount').value ? parseFloat(document.getElementById('disposeSaleAmount').value) : 0;
    const reason = document.getElementById('disposeReason').value.trim();
    const bank_account_id = document.getElementById('disposeBankAccount')?.value || null;

    if (!disposal_date) {
        Toast.error('Disposal date is required');
        return;
    }

    const ok = await Confirm.danger('Are you sure you want to dispose this asset? This action cannot be undone.', 'Dispose Asset');
    if (!ok) return;

    try {
        await api.request(AccountsCommon.buildUrl(`assets/${id}/dispose`), {
            method: 'POST',
            body: JSON.stringify({ disposal_date, disposal_amount: sale_amount, reason: reason || null, bank_account_id })
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

    // The backend honours category_id (RunDepreciationRequest.category_id): when set, only
    // assets in that category are depreciated; when omitted, all active assets are processed.
    const periodLabel = new Date(periodDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const scopeLabel = categoryId ? 'the selected category' : 'all active assets';
    const ok = await Confirm.show({
        title: 'Run Depreciation',
        message: `Run depreciation for ${scopeLabel} up to ${periodLabel}? This posts journal entries for each eligible asset (Dr Depreciation Expense, Cr Accumulated Depreciation) and cannot be undone for this period — you can only reverse by creating correcting journal entries in the General Ledger.`,
        confirmText: 'Run Depreciation',
        type: 'warning'
    });
    if (!ok) return;

    try {
        const payload = { period_date: periodDate };
        if (categoryId) payload.category_id = categoryId;

        const url = AccountsCommon.buildUrl('assets/run-depreciation');
        const res = await api.request(url, { method: 'POST', body: JSON.stringify(payload) });
        // Backend returns { message, assets_processed } — always show a summary row so
        // the user sees the outcome (including "0 assets processed" cases where the
        // selected period is too early for any asset to depreciate).
        const processed = res?.assets_processed || 0;
        const backendMessage = res?.message || `Depreciation run for ${processed} asset${processed === 1 ? '' : 's'}`;
        depreciationResults = [{ summary: true, assets_processed: processed, message: backendMessage }];

        Toast.success(processed > 0 ? `Depreciation posted for ${processed} asset${processed === 1 ? '' : 's'}` : 'Depreciation run — no eligible assets in this period');
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

// ============================================================================
// VIEW ASSET DETAIL
// ============================================================================

async function viewAssetDetail(id) {
    try {
        const url = AccountsCommon.buildUrl(`assets/${id}`);
        const asset = await api.request(url, { _skipSpinner: true });

        const catMap = {};
        assetCategories.forEach(c => { catMap[c.id] = c.name; });
        const catName = catMap[asset.asset_category_id] || catMap[asset.category_id] || asset.category_name || '-';

        document.getElementById('assetDetailTitle').textContent = `Asset: ${asset.asset_code || asset.code || asset.name}`;
        document.getElementById('assetDetailBody').innerHTML = `
            <div class="form-row two-col">
                <div class="form-group">
                    <label>Asset Code</label>
                    <div class="detail-value"><code>${AccountsCommon.escapeHtml(asset.asset_code || asset.code || '-')}</code></div>
                </div>
                <div class="form-group">
                    <label>Name</label>
                    <div class="detail-value">${AccountsCommon.escapeHtml(asset.name || '-')}</div>
                </div>
            </div>
            <div class="form-row two-col">
                <div class="form-group">
                    <label>Category</label>
                    <div class="detail-value">${AccountsCommon.escapeHtml(catName)}</div>
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <div class="detail-value">${AccountsCommon.statusBadge(asset.status || 'active')}</div>
                </div>
            </div>
            <div class="form-row two-col">
                <div class="form-group">
                    <label>Purchase Date</label>
                    <div class="detail-value">${AccountsCommon.formatDate(asset.purchase_date)}</div>
                </div>
                <div class="form-group">
                    <label>Purchase Cost</label>
                    <div class="detail-value">${AccountsCommon.formatCurrency(asset.purchase_cost || asset.cost)}</div>
                </div>
            </div>
            <div class="form-row two-col">
                <div class="form-group">
                    <label>Salvage Value</label>
                    <div class="detail-value">${AccountsCommon.formatCurrency(asset.salvage_value ?? asset.residual_value ?? 0)}</div>
                </div>
                <div class="form-group">
                    <label>Book Value</label>
                    <div class="detail-value">${AccountsCommon.formatCurrency(asset.book_value)}</div>
                </div>
            </div>
            <div class="form-row two-col">
                <div class="form-group">
                    <label>Accumulated Depreciation</label>
                    <div class="detail-value">${AccountsCommon.formatCurrency(asset.accumulated_depreciation ?? 0)}</div>
                </div>
                <div class="form-group">
                    <label>Location</label>
                    <div class="detail-value">${AccountsCommon.escapeHtml(asset.location || '-')}</div>
                </div>
            </div>
            <div class="form-row two-col">
                <div class="form-group">
                    <label>Department</label>
                    <div class="detail-value">${AccountsCommon.escapeHtml(asset.department || '-')}</div>
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <div class="detail-value">${AccountsCommon.escapeHtml(asset.description || '-')}</div>
                </div>
            </div>
        `;

        AccountsCommon.openModal('assetDetailModal');
    } catch (err) {
        console.error('[Assets] viewAssetDetail error:', err);
        Toast.error(err.message || 'Failed to load asset details');
    }
}

// ============================================================================
// VIEW DEPRECIATION SCHEDULE
// ============================================================================

async function viewDepreciationSchedule(id) {
    try {
        const url = AccountsCommon.buildUrl(`assets/${id}/depreciation`);
        const res = await api.request(url, { _skipSpinner: true });
        const entries = Array.isArray(res) ? res : (res?.data || res?.items || res?.schedule || []);

        const asset = assets.find(a => a.id === id);
        const assetName = asset ? (asset.asset_code || asset.code || asset.name) : 'Asset';

        document.getElementById('depScheduleTitle').textContent = `Depreciation Schedule: ${assetName}`;

        const tbody = document.getElementById('depScheduleBody');
        if (!entries.length) {
            tbody.innerHTML = `
                <div class="empty-message" style="padding: 2rem; text-align: center;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <p>No depreciation schedule entries found</p>
                </div>`;
        } else {
            tbody.innerHTML = `
                <div class="data-table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Period Date</th>
                                <th>Depreciation Amount</th>
                                <th>Accumulated</th>
                                <th>Book Value After</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${entries.map(e => `<tr>
                                <td>${AccountsCommon.formatDate(e.period_date || e.date)}</td>
                                <td class="text-right">${AccountsCommon.formatCurrency(e.depreciation_amount || e.amount)}</td>
                                <td class="text-right">${AccountsCommon.formatCurrency(e.accumulated_amount)}</td>
                                <td class="text-right">${AccountsCommon.formatCurrency(e.book_value_after || e.book_value)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`;
        }

        AccountsCommon.openModal('depScheduleModal');
    } catch (err) {
        console.error('[Assets] viewDepreciationSchedule error:', err);
        Toast.error(err.message || 'Failed to load depreciation schedule');
    }
}
