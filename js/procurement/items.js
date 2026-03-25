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
                <button class="crm-action-btn action-delete" onclick="deleteCategory('${id}', '${escapeHtml(name)}')" title="Delete category">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
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
