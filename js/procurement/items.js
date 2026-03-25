/**
 * Procurement Master Items Management
 * Handles CRUD operations, filtering for master items.
 */

// ==================== State ====================
let allItems = [];
let allCategories = [];
let currentEditItemId = null;

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

function populateCategoryDropdowns() {
    // Filter dropdown
    const filterSelect = document.getElementById('filterCategory');
    if (filterSelect) {
        const currentVal = filterSelect.value;
        filterSelect.innerHTML = '<option value="">All Categories</option>';
        allCategories.forEach(cat => {
            const name = typeof cat === 'string' ? cat : (cat.category_name || cat.name || cat);
            filterSelect.innerHTML += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        });
        filterSelect.value = currentVal;
    }

    // Modal datalist
    const datalist = document.getElementById('categoryList');
    if (datalist) {
        datalist.innerHTML = '';
        allCategories.forEach(cat => {
            const name = typeof cat === 'string' ? cat : (cat.category_name || cat.name || cat);
            datalist.innerHTML += `<option value="${escapeHtml(name)}">`;
        });
    }
}

// ==================== Filter Handling ====================

function applyFilters() {
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();
    const category = document.getElementById('filterCategory').value;

    let filtered = allItems;

    if (search) {
        filtered = filtered.filter(item => {
            const name = (item.item_name || '').toLowerCase();
            const code = (item.item_code || '').toLowerCase();
            const cat = (item.category || '').toLowerCase();
            const desc = (item.description || '').toLowerCase();
            return name.includes(search) || code.includes(search) || cat.includes(search) || desc.includes(search);
        });
    }

    if (category) {
        filtered = filtered.filter(item => item.category === category);
    }

    renderItemsTable(filtered);
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

    tbody.innerHTML = items.map(item => `
        <tr>
            <td>
                <div class="crm-cell-primary">
                    <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(item.item_name || '')}</div>
                    ${item.specifications ? `<div class="crm-cell-secondary">${escapeHtml(item.specifications)}</div>` : ''}
                </div>
            </td>
            <td><span class="crm-cell-secondary">${escapeHtml(item.item_code || '-')}</span></td>
            <td class="hide-mobile">
                ${item.category ? `<span class="crm-source-badge">${escapeHtml(item.category)}</span>` : '<span class="crm-cell-secondary">-</span>'}
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
    `).join('');
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

function openNewItemModal() {
    currentEditItemId = null;
    document.getElementById('itemModalTitle').textContent = 'Add Item';
    const submitBtn = document.getElementById('itemSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="itemSubmitSpinner" style="display:none;"></span> Add Item';
    document.getElementById('itemForm').reset();
    document.getElementById('itemId').value = '';
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
    document.getElementById('itemCategory').value = item.category || '';
    document.getElementById('itemUnit').value = item.unit || '';
    document.getElementById('itemHsnCode').value = item.hsn_code || '';
    document.getElementById('itemSpecifications').value = item.specifications || '';
    document.getElementById('itemDescription').value = item.description || '';
    openModal('itemModal');
}

function closeItemModal() {
    closeModal('itemModal');
    currentEditItemId = null;
}

// ==================== CRUD Operations ====================

async function handleItemSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('itemSubmitBtn');
    const spinner = document.getElementById('itemSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        item_name: document.getElementById('itemName').value.trim(),
        item_code: document.getElementById('itemCode').value.trim(),
        category: document.getElementById('itemCategory').value.trim(),
        unit: document.getElementById('itemUnit').value.trim(),
        hsn_code: document.getElementById('itemHsnCode').value.trim(),
        specifications: document.getElementById('itemSpecifications').value.trim(),
        description: document.getElementById('itemDescription').value.trim()
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
