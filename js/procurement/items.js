/**
 * Procurement Master Items Management
 * Handles CRUD operations, filtering for master items.
 * Uses category_id (UUID) instead of category (string name).
 */

// ==================== State ====================
let allItems = [];
let allCategories = [];
let currentEditItemId = null;
let _filteredItems = [];
let _currentPage = 1;
const PAGE_SIZE = 20;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    loadCategories();
    loadItems();
});

// ==================== Data Loading ====================

async function loadItems() {
    try {
        const response = await api.request('/procurement/master-items');
        allItems = response.data || response || [];
        renderItemsTable(allItems);
    } catch (error) {
        console.error('Failed to load items:', error);
        renderItemsTable([]);
        Toast.error('Failed to load items');
    }
}

async function loadCategories() {
    try {
        const response = await api.request('/procurement/item-categories', { _skipSpinner: true });
        allCategories = response.data || response || [];
        populateCategoryDropdowns();
    } catch (error) {
        console.error('Failed to load categories:', error);
    }
}

function getCategoryName(categoryId) {
    if (!categoryId) return '';
    const cat = allCategories.find(c => c.id === categoryId);
    if (cat) return cat.category_name || cat.name || '';
    // Fallback: if item has category as string (not a UUID)
    if (categoryId && !categoryId.match(/^[0-9a-f]{8}-/)) return categoryId;
    return '';
}

let _categoryDropdown = null;
let _unitDropdown = null;
let _filterCategoryDropdown = null;

function populateCategoryDropdowns() {
    const catOptions = allCategories.map(cat => ({ value: cat.id || '', label: cat.category_name || cat.name || '' }));

    // Filter dropdown — convert to searchable or update options
    const filterCatOptions = [{ value: '', label: 'All Categories' }].concat(catOptions);
    if (_filterCategoryDropdown) {
        _filterCategoryDropdown.setOptions(filterCatOptions);
    } else if (typeof convertSelectToSearchable === 'function') {
        // Populate native select first so convertSelectToSearchable picks up options
        const filterSelect = document.getElementById('filterCategory');
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">All Categories</option>';
            allCategories.forEach(cat => {
                filterSelect.innerHTML += `<option value="${cat.id || ''}">${escapeHtml(cat.category_name || cat.name || '')}</option>`;
            });
        }
        _filterCategoryDropdown = convertSelectToSearchable('filterCategory', {
            placeholder: 'All Categories',
            searchPlaceholder: 'Search categories...',
            compact: true,
            onChange: () => applyFilters()
        });
    } else {
        // Fallback: just populate native select
        const filterSelect = document.getElementById('filterCategory');
        if (filterSelect) {
            const currentVal = filterSelect.value;
            filterSelect.innerHTML = '<option value="">All Categories</option>';
            allCategories.forEach(cat => {
                filterSelect.innerHTML += `<option value="${cat.id || ''}">${escapeHtml(cat.category_name || cat.name || '')}</option>`;
            });
            filterSelect.value = currentVal;
        }
    }

    // Modal category dropdown — update if already initialized
    const modalCatOptions = [{ value: '', label: 'No Category' }].concat(catOptions);
    if (_categoryDropdown) {
        _categoryDropdown.setOptions(modalCatOptions);
    }
}

// ==================== Filter Handling ====================

function applyFilters() {
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();
    const categoryId = _filterCategoryDropdown ? _filterCategoryDropdown.getValue() || '' : document.getElementById('filterCategory').value;

    let filtered = allItems;

    if (search) {
        filtered = filtered.filter(item => {
            const name = (item.item_name || '').toLowerCase();
            const code = (item.item_code || '').toLowerCase();
            const catName = getCategoryName(item.category_id || item.category).toLowerCase();
            const desc = (item.description || '').toLowerCase();
            return name.includes(search) || code.includes(search) || catName.includes(search) || desc.includes(search);
        });
    }

    if (categoryId) {
        filtered = filtered.filter(item => (item.category_id || item.category) === categoryId);
    }

    _filteredItems = filtered;
    _currentPage = 1;
    renderItemsTable(filtered);
}

function goToPage(page) {
    const totalPages = Math.ceil(_filteredItems.length / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    _currentPage = page;
    renderItemsTable(_filteredItems);
    // Scroll to top of table
    document.getElementById('itemsTableBody')?.closest('table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==================== Table Rendering ====================

function renderItemsTable(items) {
    const tbody = document.getElementById('itemsTableBody');

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2z"/>
                        </svg>
                        <p>No items found</p>
                        <button class="btn btn-sm btn-primary" onclick="openNewItemModal()">Add your first item</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // Pagination
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    if (_currentPage > totalPages) _currentPage = totalPages || 1;
    const startIdx = (_currentPage - 1) * PAGE_SIZE;
    const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE);

    tbody.innerHTML = pageItems.map(item => {
        const catDisplay = getCategoryName(item.category_id || item.category) || item.category_name || item.category || '';
        return `
            <tr>
                <td>
                    <div class="crm-cell-primary">
                        <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(item.item_name || '')}</div>
                        ${item.specifications ? `<div class="crm-cell-secondary">${escapeHtml(item.specifications)}</div>` : ''}
                    </div>
                </td>
                <td><span class="crm-cell-secondary">${escapeHtml(item.item_code || '-')}</span></td>
                <td class="hide-mobile">
                    ${catDisplay ? `<span class="crm-source-badge">${escapeHtml(catDisplay)}</span>` : '<span class="crm-cell-secondary">-</span>'}
                </td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(item.unit || '-')}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${item.vendor_count || 0}</span></td>
                <td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="openItemDetailModal('${item.id}')" title="Details">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                        <button class="crm-action-btn" onclick="openEditItemModal('${item.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="deleteItem('${item.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Render pagination controls
    renderPagination(totalItems, totalPages);
}

function renderPagination(totalItems, totalPages) {
    let container = document.getElementById('itemsPagination');
    if (!container) {
        container = document.createElement('div');
        container.id = 'itemsPagination';
        const table = document.getElementById('itemsTableBody')?.closest('table');
        if (table) table.parentNode.insertBefore(container, table.nextSibling);
    }

    if (totalPages <= 1) {
        container.innerHTML = totalItems > 0
            ? `<div style="padding:10px 0; text-align:center; font-size:12px; color:var(--text-secondary);">${totalItems} item${totalItems !== 1 ? 's' : ''}</div>`
            : '';
        return;
    }

    const startItem = (_currentPage - 1) * PAGE_SIZE + 1;
    const endItem = Math.min(_currentPage * PAGE_SIZE, totalItems);

    // Build page buttons (show max 7 pages with ellipsis)
    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (_currentPage > 3) pages.push('...');
        const start = Math.max(2, _currentPage - 1);
        const end = Math.min(totalPages - 1, _currentPage + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (_currentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
    }

    const base = 'padding:6px 12px; border-radius:6px; font-size:13px; min-width:34px; text-align:center; transition:all 0.15s;';
    const btnStyle = `${base} background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer; border:1px solid var(--border-primary);`;
    const activeBtnStyle = `${base} background:var(--brand-primary); color:#fff; cursor:default; font-weight:600; box-shadow:0 2px 6px rgba(59,130,246,0.35); border:1px solid var(--brand-primary);`;
    const navStyle = `${base} background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer; font-weight:500; border:1px solid var(--border-primary);`;
    const disabledNavStyle = `${base} background:transparent; color:var(--text-secondary); cursor:not-allowed; opacity:0.4; border:1px solid var(--border-primary);`;

    container.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 4px; flex-wrap:wrap; gap:10px; border-top:1px solid var(--border-primary);">
            <span style="font-size:13px; color:var(--text-secondary);">Showing <strong style="color:var(--text-primary);">${startItem}–${endItem}</strong> of <strong style="color:var(--text-primary);">${totalItems}</strong></span>
            <div style="display:flex; gap:6px; align-items:center;">
                <button onclick="goToPage(${_currentPage - 1})" style="${_currentPage === 1 ? disabledNavStyle : navStyle}" ${_currentPage === 1 ? 'disabled' : ''} onmouseenter="if(!this.disabled)this.style.background='var(--bg-hover,var(--bg-secondary))'" onmouseleave="if(!this.disabled)this.style.background='var(--bg-tertiary)'">&lsaquo; Prev</button>
                ${pages.map(p => p === '...'
                    ? `<span style="padding:4px 4px; font-size:13px; color:var(--text-secondary); user-select:none;">…</span>`
                    : `<button onclick="goToPage(${p})" style="${p === _currentPage ? activeBtnStyle : btnStyle}" ${p !== _currentPage ? 'onmouseenter="this.style.background=\'var(--bg-hover,var(--bg-secondary))\'" onmouseleave="this.style.background=\'var(--bg-tertiary)\'"' : ''}>${p}</button>`
                ).join('')}
                <button onclick="goToPage(${_currentPage + 1})" style="${_currentPage === totalPages ? disabledNavStyle : navStyle}" ${_currentPage === totalPages ? 'disabled' : ''} onmouseenter="if(!this.disabled)this.style.background='var(--bg-hover,var(--bg-secondary))'" onmouseleave="if(!this.disabled)this.style.background='var(--bg-tertiary)'">Next &rsaquo;</button>
            </div>
        </div>
    `;
}

// ==================== Modal Handling ====================

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => {
            modal.classList.add('active');
        });
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.classList.remove('gm-animating');
        }, 200);
    }
}

function _ensureSearchableDropdowns() {
    if (!_categoryDropdown && typeof convertSelectToSearchable === 'function') {
        _categoryDropdown = convertSelectToSearchable('itemCategory', {
            placeholder: 'No Category',
            searchPlaceholder: 'Search categories...'
        });
    }
    // Always sync category options with allCategories
    if (_categoryDropdown && allCategories.length > 0) {
        const catOptions = [{ value: '', label: 'No Category' }].concat(
            allCategories.map(cat => ({ value: cat.id || '', label: cat.category_name || cat.name || '' }))
        );
        _categoryDropdown.setOptions(catOptions);
    }
    if (!_unitDropdown && typeof convertSelectToSearchable === 'function') {
        _unitDropdown = convertSelectToSearchable('itemUnit', {
            placeholder: 'Select Unit',
            searchPlaceholder: 'Search units...'
        });
    }
}

function openNewItemModal() {
    currentEditItemId = null;
    document.getElementById('itemModalTitle').textContent = 'Add Item';
    const submitBtn = document.getElementById('itemSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="itemSubmitSpinner" style="display:none;"></span> Add Item';
    document.getElementById('itemForm').reset();
    document.getElementById('itemId').value = '';
    _ensureSearchableDropdowns();
    if (_categoryDropdown) _categoryDropdown.setValue('');
    if (_unitDropdown) _unitDropdown.setValue('');
    openModal('itemModal');
}

function openEditItemModal(id) {
    const item = allItems.find(i => i.id === id);
    if (!item) {
        Toast.error('Item not found');
        return;
    }

    currentEditItemId = id;
    document.getElementById('itemModalTitle').textContent = 'Edit Item';
    const submitBtn = document.getElementById('itemSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="itemSubmitSpinner" style="display:none;"></span> Update Item';
    document.getElementById('itemId').value = id;
    document.getElementById('itemName').value = item.item_name || '';
    document.getElementById('itemCode').value = item.item_code || '';
    _ensureSearchableDropdowns();
    if (_categoryDropdown) _categoryDropdown.setValue(item.category_id || '');
    else document.getElementById('itemCategory').value = item.category_id || '';
    if (_unitDropdown) _unitDropdown.setValue(item.unit || '');
    else document.getElementById('itemUnit').value = item.unit || '';
    document.getElementById('itemHsnCode').value = item.hsn_code || '';
    document.getElementById('itemSpecifications').value = item.specifications || '';
    document.getElementById('itemDescription').value = item.description || '';
    openModal('itemModal');
}

function closeItemModal() {
    closeModal('itemModal');
    currentEditItemId = null;
}

// ==================== Item CRUD Operations ====================

async function handleItemSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('itemSubmitBtn');
    const spinner = document.getElementById('itemSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const categoryId = document.getElementById('itemCategory').value;
    const unit = document.getElementById('itemUnit').value.trim();

    if (!categoryId) {
        Toast.error('Please select a category');
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        return;
    }
    if (!unit) {
        Toast.error('Please select a unit');
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        return;
    }

    const formData = {
        item_name: document.getElementById('itemName').value.trim(),
        item_code: document.getElementById('itemCode').value.trim() || null,
        category_id: categoryId,
        unit: unit,
        hsn_code: document.getElementById('itemHsnCode').value.trim() || null,
        specifications: document.getElementById('itemSpecifications').value.trim() || null,
        description: document.getElementById('itemDescription').value.trim() || null
    };

    try {
        if (currentEditItemId) {
            formData.id = currentEditItemId;
            await api.request('/procurement/master-items', {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Item updated successfully');
        } else {
            await api.request('/procurement/master-items', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Item created successfully');
        }

        closeItemModal();
        loadItems();
        loadCategories();
    } catch (error) {
        console.error('Failed to save item:', error);
        Toast.error(error.message || 'Failed to save item');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteItem(id) {
    const confirmed = await showConfirm('Are you sure you want to delete this item?', 'Delete Item', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/procurement/master-items/${id}`, { method: 'DELETE' });
        Toast.success('Item deleted');
        loadItems();
    } catch (error) {
        console.error('Failed to delete item:', error);
        Toast.error('Failed to delete item');
    }
}

// ==================== Category Management ====================

function openCategoryModal() {
    renderCategoryList();
    openModal('categoryModal');
}

function closeCategoryModal() {
    closeModal('categoryModal');
    document.getElementById('newCategoryName').value = '';
}

function renderCategoryList() {
    const container = document.getElementById('categoryListContainer');

    if (!allCategories || allCategories.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 16px;">No categories yet. Add one above.</p>';
        return;
    }

    container.innerHTML = allCategories.map(cat => {
        const name = cat.category_name || cat.name || '';
        const id = cat.id || '';
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--border-primary);">
                <span style="color: var(--text-primary); font-weight: 500;">${escapeHtml(name)}</span>
                <div style="display:flex;gap:4px;">
                    <button class="crm-action-btn" onclick="editCategory('${id}', '${escapeHtml(name)}')" title="Rename">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn action-delete" onclick="deleteCategory('${id}', '${escapeHtml(name)}')" title="Delete category">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function addCategory() {
    const input = document.getElementById('newCategoryName');
    const name = input.value.trim();
    if (!name) {
        Toast.error('Please enter a category name');
        return;
    }

    try {
        await api.request('/procurement/item-categories', {
            method: 'POST',
            body: JSON.stringify({ category_name: name })
        });
        Toast.success('Category added');
        input.value = '';
        await loadCategories();
        renderCategoryList();
    } catch (error) {
        console.error('Failed to add category:', error);
        Toast.error(error.message || 'Failed to add category');
    }
}

async function deleteCategory(id, name) {
    const confirmed = await showConfirm(`Delete category "${name}"? Items in this category will become uncategorized.`, 'Delete Category', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/procurement/item-categories/${id}`, { method: 'DELETE' });
        Toast.success('Category deleted');
        await loadCategories();
        renderCategoryList();
        loadItems(); // Refresh items table since category display may change
    } catch (error) {
        console.error('Failed to delete category:', error);
        Toast.error(error.message || 'Failed to delete category');
    }
}

// ==================== Utilities ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
}

// ==================== ITEM DETAIL MODAL ====================

let currentDetailItemId = null;

function openItemDetailModal(itemId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    currentDetailItemId = itemId;
    document.getElementById('itemDetailTitle').textContent = item.item_name || 'Item Details';
    switchItemDetailTab('vendors');
    openModal('itemDetailModal');
}

function switchItemDetailTab(tab) {
    document.querySelectorAll('.item-detail-tab').forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('active', isActive);
        btn.style.color = isActive ? 'var(--brand-primary)' : 'var(--text-secondary)';
        btn.style.borderBottomColor = isActive ? 'var(--brand-primary)' : 'transparent';
    });
    document.querySelectorAll('.item-detail-content').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = '';

    if (tab === 'vendors') loadItemVendors();
    if (tab === 'synonyms') loadItemSynonyms();
    if (tab === 'mappings') loadItemMappings();
}

// ---- Tab 1: Linked Vendors ----

async function loadItemVendors() {
    const container = document.getElementById('tab-vendors');
    container.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5;">Loading...</div>';
    try {
        const [vendorData, rankingData] = await Promise.all([
            api.request(`/procurement/master-items/${currentDetailItemId}/vendors`),
            api.request(`/procurement/vendor-history/item/${currentDetailItemId}/ranking`).catch(() => ({ data: [] }))
        ]);
        const vendors = vendorData.data || vendorData || [];
        const rankings = rankingData.data || rankingData || [];

        let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="font-size:13px;font-weight:600;">Linked Vendors (${vendors.length})</span>
            <button onclick="showLinkVendorInput()" style="font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid var(--brand-primary);background:none;color:var(--brand-primary);cursor:pointer;">+ Link</button>
        </div>
        <div id="linkVendorInputRow" style="display:none;margin-bottom:10px;"></div>`;

        if (vendors.length > 0) {
            html += `<div style="border:1px solid var(--border-primary);border-radius:6px;overflow:hidden;margin-bottom:16px;">
                ${vendors.map(v => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-primary);">
                    <div><span style="font-weight:500;">${escapeHtml(v.vendor_name || '-')}</span>
                    ${v.last_quoted_price ? `<span style="opacity:0.5;font-size:11px;margin-left:8px;">Last: ${parseFloat(v.last_quoted_price).toLocaleString('en-IN')}</span>` : ''}</div>
                    <button onclick="unlinkVendor('${v.vendor_id}')" style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--color-error);background:none;color:var(--color-error);cursor:pointer;">Unlink</button>
                </div>`).join('')}
            </div>`;
        }

        if (rankings.length > 0) {
            html += `<div style="font-size:13px;font-weight:600;margin-bottom:8px;">Vendor Rankings</div>
            <div style="border:1px solid var(--border-primary);border-radius:6px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:var(--bg-tertiary);">
                        <th style="padding:5px 10px;text-align:left;font-size:11px;color:var(--text-secondary);">Vendor</th>
                        <th style="padding:5px 10px;text-align:center;font-size:11px;color:var(--text-secondary);">Quoted</th>
                        <th style="padding:5px 10px;text-align:center;font-size:11px;color:var(--text-secondary);">Won</th>
                        <th style="padding:5px 10px;text-align:center;font-size:11px;color:var(--text-secondary);">Win %</th>
                        <th style="padding:5px 10px;text-align:right;font-size:11px;color:var(--text-secondary);">Last Price</th>
                    </tr></thead>
                    <tbody>${rankings.map(r => `<tr style="border-top:1px solid var(--border-primary);">
                        <td style="padding:5px 10px;font-weight:500;">${escapeHtml(r.vendor_name || '-')}</td>
                        <td style="padding:5px 10px;text-align:center;">${r.times_quoted || 0}</td>
                        <td style="padding:5px 10px;text-align:center;">${r.times_selected || 0}</td>
                        <td style="padding:5px 10px;text-align:center;">${r.selection_rate != null ? (r.selection_rate * 100).toFixed(0) + '%' : '-'}</td>
                        <td style="padding:5px 10px;text-align:right;">${r.last_quoted_price != null ? parseFloat(r.last_quoted_price).toLocaleString('en-IN') : '-'}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>`;
        }

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="color:var(--color-error);padding:20px;">${e.message || 'Failed to load'}</div>`;
    }
}

function showLinkVendorInput() {
    const row = document.getElementById('linkVendorInputRow');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.innerHTML = `<select id="linkVendorSelect" class="form-control form-control-sm" style="flex:1;"><option value="">Loading...</option></select>
        <button onclick="linkSelectedVendor()" class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 12px;">Link</button>
        <button onclick="document.getElementById('linkVendorInputRow').style.display='none'" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 8px;">Cancel</button>`;
    // Load vendors
    api.request('/procurement/vendors').then(data => {
        const vendors = data.data || data || [];
        const select = document.getElementById('linkVendorSelect');
        select.innerHTML = '<option value="">Select vendor...</option>' + vendors.map(v => `<option value="${v.id}">${escapeHtml(v.vendor_name)}</option>`).join('');
    });
}

async function linkSelectedVendor() {
    const vendorId = document.getElementById('linkVendorSelect').value;
    if (!vendorId) { Toast.error('Select a vendor'); return; }
    try {
        await api.request(`/procurement/master-items/${currentDetailItemId}/vendors`, {
            method: 'POST', body: JSON.stringify({ vendor_id: vendorId })
        });
        Toast.success('Vendor linked');
        loadItemVendors();
    } catch (e) { Toast.error(e.message || 'Failed to link vendor'); }
}

async function unlinkVendor(vendorId) {
    const confirmed = await showConfirm('Unlink this vendor from this item?', 'Unlink Vendor', 'danger');
    if (!confirmed) return;
    try {
        await api.request(`/procurement/master-items/${currentDetailItemId}/vendors/${vendorId}`, { method: 'DELETE' });
        Toast.success('Vendor unlinked');
        loadItemVendors();
    } catch (e) { Toast.error(e.message || 'Failed to unlink vendor'); }
}

// ---- Tab 2: Synonyms ----

async function loadItemSynonyms() {
    const container = document.getElementById('tab-synonyms');
    container.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5;">Loading...</div>';
    try {
        const data = await api.request(`/procurement/item-synonyms?masterItemId=${currentDetailItemId}`);
        const synonyms = data.data || data || [];

        let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <input type="text" id="newSynonymInput" class="form-control form-control-sm" placeholder="Add synonym..." style="flex:1;max-width:300px;">
            <button onclick="addSynonym()" class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 12px;">Add</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
            ${synonyms.length > 0 ? synonyms.map(s => `
                <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:16px;background:var(--bg-tertiary);border:1px solid var(--border-primary);font-size:12px;">
                    ${escapeHtml(s.synonym || s.name || '')}
                    <button onclick="deleteSynonym('${s.id}')" style="border:none;background:none;color:var(--color-error);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;">&times;</button>
                </span>
            `).join('') : '<span style="opacity:0.4;font-size:12px;">No synonyms yet.</span>'}
        </div>
        <div style="border-top:1px solid var(--border-primary);padding-top:12px;">
            <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Search Synonyms</div>
            <div style="display:flex;gap:8px;">
                <input type="text" id="synonymSearchInput" class="form-control form-control-sm" placeholder="Search across all items..." style="flex:1;max-width:300px;">
                <button onclick="searchSynonyms()" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 12px;">Search</button>
            </div>
            <div id="synonymSearchResults" style="margin-top:8px;font-size:12px;"></div>
        </div>`;

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="color:var(--color-error);padding:20px;">${e.message || 'Failed to load'}</div>`;
    }
}

async function addSynonym() {
    const input = document.getElementById('newSynonymInput');
    const synonym = input.value.trim();
    if (!synonym) return;
    try {
        await api.request('/procurement/item-synonyms', {
            method: 'POST', body: JSON.stringify({ master_item_id: currentDetailItemId, synonym })
        });
        Toast.success('Synonym added');
        loadItemSynonyms();
    } catch (e) { Toast.error(e.message || 'Failed to add synonym'); }
}

async function deleteSynonym(id) {
    try {
        await api.request(`/procurement/item-synonyms/${id}`, { method: 'DELETE' });
        Toast.success('Synonym removed');
        loadItemSynonyms();
    } catch (e) { Toast.error(e.message || 'Failed to delete synonym'); }
}

async function searchSynonyms() {
    const query = document.getElementById('synonymSearchInput').value.trim();
    if (!query) return;
    const results = document.getElementById('synonymSearchResults');
    results.innerHTML = '<span style="opacity:0.5;">Searching...</span>';
    try {
        const data = await api.request('/procurement/item-synonyms/search', {
            method: 'POST', body: JSON.stringify({ query })
        });
        const items = data.data || data || [];
        if (items.length === 0) { results.innerHTML = '<span style="opacity:0.4;">No matches found.</span>'; return; }
        results.innerHTML = items.map(s => `<div style="padding:3px 0;">"${escapeHtml(s.synonym || '')}" → <strong>${escapeHtml(s.item_name || s.master_item_name || '?')}</strong></div>`).join('');
    } catch (e) { results.innerHTML = `<span style="color:var(--color-error);">${e.message || 'Search failed'}</span>`; }
}

// ---- Tab 3: Mappings ----

async function loadItemMappings() {
    const container = document.getElementById('tab-mappings');
    container.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5;">Loading...</div>';
    try {
        const data = await api.request(`/procurement/item-mappings?masterItemId=${currentDetailItemId}`);
        const mappings = data.data || data || [];

        let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <input type="text" id="newMappingInput" class="form-control form-control-sm" placeholder="Raw name to map..." style="flex:1;max-width:300px;">
            <button onclick="addMapping()" class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 12px;">Add</button>
        </div>`;

        if (mappings.length > 0) {
            html += `<div style="border:1px solid var(--border-primary);border-radius:6px;overflow:hidden;margin-bottom:16px;">
                ${mappings.map(m => `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid var(--border-primary);font-size:12px;">
                    <span>"${escapeHtml(m.raw_name || '')}"</span>
                    <button onclick="deleteMapping('${m.id}')" style="border:none;background:none;color:var(--color-error);cursor:pointer;font-size:14px;">&times;</button>
                </div>`).join('')}
            </div>`;
        } else {
            html += '<div style="opacity:0.4;font-size:12px;margin-bottom:16px;">No mappings yet.</div>';
        }

        html += `<div style="border-top:1px solid var(--border-primary);padding-top:12px;">
            <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Test Resolve</div>
            <div style="display:flex;gap:8px;">
                <input type="text" id="resolveInput" class="form-control form-control-sm" placeholder="Enter raw item name..." style="flex:1;max-width:300px;">
                <button onclick="testResolve()" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 12px;">Resolve</button>
            </div>
            <div id="resolveResult" style="margin-top:8px;font-size:12px;"></div>
        </div>`;

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="color:var(--color-error);padding:20px;">${e.message || 'Failed to load'}</div>`;
    }
}

async function addMapping() {
    const input = document.getElementById('newMappingInput');
    const rawName = input.value.trim();
    if (!rawName) return;
    try {
        await api.request('/procurement/item-mappings', {
            method: 'POST', body: JSON.stringify({ raw_name: rawName, master_item_id: currentDetailItemId })
        });
        Toast.success('Mapping added');
        loadItemMappings();
    } catch (e) { Toast.error(e.message || 'Failed to add mapping'); }
}

async function deleteMapping(id) {
    try {
        await api.request(`/procurement/item-mappings/${id}`, { method: 'DELETE' });
        Toast.success('Mapping removed');
        loadItemMappings();
    } catch (e) { Toast.error(e.message || 'Failed to delete mapping'); }
}

async function testResolve() {
    const rawName = document.getElementById('resolveInput').value.trim();
    if (!rawName) return;
    const result = document.getElementById('resolveResult');
    result.innerHTML = '<span style="opacity:0.5;">Resolving...</span>';
    try {
        const data = await api.request('/procurement/item-mappings/resolve', {
            method: 'POST', body: JSON.stringify({ raw_name: rawName })
        });
        const r = data.data || data;
        if (r.resolved && r.master_item) {
            result.innerHTML = `<span style="color:var(--color-success);">Resolved → <strong>${escapeHtml(r.master_item.item_name || '')}</strong></span>`;
        } else {
            result.innerHTML = `<span style="color:var(--color-warning);">Not resolved — no mapping found for "${escapeHtml(rawName)}"</span>`;
        }
    } catch (e) { result.innerHTML = `<span style="color:var(--color-error);">${e.message || 'Resolve failed'}</span>`; }
}

// ==================== CATEGORY EDIT ====================

async function editCategory(id, currentName) {
    const newName = prompt('Rename category:', currentName);
    if (!newName || newName.trim() === currentName) return;
    try {
        await api.request('/procurement/item-categories', {
            method: 'PUT', body: JSON.stringify({ id, category_name: newName.trim() })
        });
        Toast.success('Category renamed');
        loadCategories();
        renderCategoryList();
    } catch (e) { Toast.error(e.message || 'Failed to rename category'); }
}
