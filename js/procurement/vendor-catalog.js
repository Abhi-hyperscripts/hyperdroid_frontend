/**
 * Vendor Catalog Portal - Public Page
 * No authentication required. Accessed via token URL parameter + password.
 * Allows vendors to self-register their item offerings.
 */

// ==================== State ====================
let catalogToken = null;
let catalogPassword = null;
let catalogData = null;
let categories = [];
let selectedItems = new Map(); // master_item_id -> { price, notes }
let isEditable = true;
let searchQuery = '';

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    catalogToken = params.get('token');

    if (!catalogToken) {
        showError('No access token provided. Please use the link sent to you by the buyer.');
        return;
    }

    // Fetch vendor name from status endpoint (no password needed)
    fetchVendorPreview();

    // Show password form
    showAuthForm();

    // Enter key on password field
    const passwordInput = document.getElementById('catalogPassword');
    if (passwordInput) {
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleAccess();
        });
        passwordInput.focus();
    }
});

// ==================== Vendor Preview ====================

async function fetchVendorPreview() {
    try {
        const baseUrl = CONFIG.procurementApiBaseUrl;
        const response = await fetch(`${baseUrl}/vendor-catalog/${catalogToken}/status`);
        if (response.ok) {
            const data = await response.json();
            // Update auth card with vendor name if available
            const titleEl = document.getElementById('authTitle');
            const subEl = document.getElementById('authSubtitle');
            if (data.vendor_name && titleEl) {
                titleEl.textContent = data.vendor_name;
                if (subEl) subEl.textContent = 'Enter your password to manage your item catalog.';
            }
        }
    } catch (e) {
        // Silently fail - vendor name is optional on login screen
    }
}

// ==================== Authentication ====================

async function handleAccess() {
    const passwordInput = document.getElementById('catalogPassword');
    const password = passwordInput.value.trim();
    const authError = document.getElementById('authError');
    const accessBtn = document.getElementById('accessBtn');

    if (!password) {
        authError.textContent = 'Please enter the password';
        authError.style.display = 'block';
        return;
    }

    accessBtn.disabled = true;
    accessBtn.textContent = 'Accessing...';
    authError.style.display = 'none';

    try {
        const baseUrl = CONFIG.procurementApiBaseUrl;
        const response = await fetch(`${baseUrl}/vendor-catalog/access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: catalogToken, password: password })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Invalid credentials');
        }

        const data = await response.json();
        catalogData = data;
        catalogPassword = password;
        categories = data.categories || [];
        isEditable = data.is_editable;

        // Load pre-selected items
        if (data.selected_items) {
            data.selected_items.forEach(item => {
                selectedItems.set(item.master_item_id, {
                    price: item.price,
                    notes: item.notes
                });
            });
        }

        renderCatalog();
        showMainContent();
    } catch (error) {
        console.error('Access failed:', error);
        authError.textContent = error.message || 'Failed to access catalog';
        authError.style.display = 'block';
        accessBtn.disabled = false;
        accessBtn.textContent = 'Access Catalog';
    }
}

// ==================== Rendering ====================

function renderCatalog() {
    if (!catalogData) return;

    // Title and badge
    const title = document.getElementById('catalogTitle');
    title.textContent = escapeHtml(catalogData.vendor_name || 'Vendor Catalog');
    const subtitle = document.getElementById('catalogSubtitle');
    if (subtitle) subtitle.textContent = 'Vendor Catalog - Item Offerings';

    const badge = document.getElementById('catalogBadge');
    if (catalogData.status === 'submitted') {
        badge.textContent = 'Submitted';
        badge.className = 'vc-badge vc-badge-submitted';
    } else {
        badge.textContent = 'Active';
        badge.className = 'vc-badge vc-badge-active';
    }

    // Hint text
    const hint = document.getElementById('catalogHint');
    if (!isEditable) {
        hint.textContent = 'This catalog has been submitted. You can view your selections but cannot make changes.';
    }

    // Hide actions if not editable
    if (!isEditable) {
        document.getElementById('footerActions').style.display = 'none';
        document.getElementById('searchInput').placeholder = 'Search items...';
    }

    renderCategories();
    updateSelectedCount();
}

function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    container.innerHTML = '';

    if (!categories || categories.length === 0) {
        container.innerHTML = `
            <div class="vc-card" style="text-align: center; color: var(--text-secondary); padding: 40px;">
                No items available in the catalog.
            </div>
        `;
        return;
    }

    categories.forEach((category, catIndex) => {
        const items = filterItems(category.items || []);
        if (searchQuery && items.length === 0) return; // Hide empty categories when searching

        const selectedInCategory = items.filter(i => selectedItems.has(i.id)).length;
        const totalInCategory = items.length;

        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'vc-category';
        categoryDiv.id = `category-${catIndex}`;

        categoryDiv.innerHTML = `
            <div class="vc-category-header" onclick="toggleCategory(${catIndex})">
                <div>
                    <span class="vc-category-name">${escapeHtml(category.category_name)}</span>
                    <span class="vc-category-count">${selectedInCategory}/${totalInCategory} selected</span>
                </div>
                <svg class="vc-category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </div>
            <div class="vc-category-body">
                <div class="vc-item-header">
                    <span></span>
                    <span>Item</span>
                    <span style="text-align: center;">Unit</span>
                    <span>Price (Optional)</span>
                    <span>Notes (Optional)</span>
                </div>
                ${items.map(item => renderItem(item)).join('')}
            </div>
        `;

        container.appendChild(categoryDiv);
    });
}

function renderItem(item) {
    const isSelected = selectedItems.has(item.id);
    const itemData = selectedItems.get(item.id) || {};
    const disabledAttr = !isEditable ? 'disabled' : '';
    const checkedAttr = isSelected ? 'checked' : '';
    const rowClass = isSelected ? 'vc-item-row selected' : 'vc-item-row';

    const toggleClass = isSelected ? 'vc-toggle active' : 'vc-toggle';

    return `
        <div class="${rowClass}" id="item-row-${item.id}">
            <div class="vc-item-check">
                <button class="${toggleClass}" ${disabledAttr}
                    onclick="handleItemToggle('${item.id}', !this.classList.contains('active'))"
                    id="check-${item.id}"></button>
            </div>
            <div class="vc-item-info">
                <div class="vc-item-name">${escapeHtml(item.item_name)}</div>
                ${item.item_code ? `<span class="vc-item-code">${escapeHtml(item.item_code)}</span>` : ''}
                ${item.description ? `<div class="vc-item-desc" title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</div>` : ''}
            </div>
            <div class="vc-item-unit">${escapeHtml(item.unit)}</div>
            <div class="vc-item-price">
                <input type="number" min="0" step="0.01" placeholder="0.00" ${disabledAttr}
                    value="${itemData.price != null ? itemData.price : ''}"
                    onchange="handlePriceChange('${item.id}', this.value)"
                    id="price-${item.id}">
            </div>
            <div class="vc-item-notes">
                <input type="text" placeholder="Optional notes" ${disabledAttr}
                    value="${escapeHtml(itemData.notes || '')}"
                    onchange="handleNotesChange('${item.id}', this.value)"
                    id="notes-${item.id}">
            </div>
        </div>
    `;
}

function filterItems(items) {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item =>
        (item.item_name && item.item_name.toLowerCase().includes(q)) ||
        (item.item_code && item.item_code.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q))
    );
}

function updateSelectedCount() {
    const count = selectedItems.size;
    // Hero stats
    const countEl = document.getElementById('selectedCount');
    if (countEl) countEl.textContent = count;
    // Footer count
    const footerCount = document.getElementById('footerCount');
    if (footerCount) footerCount.textContent = count;
    // Also update footer info text directly
    const footerInfo = document.querySelector('.vc-footer-info');
    if (footerInfo) footerInfo.innerHTML = `<strong>${count}</strong> items selected`;
    // Total items
    let total = 0;
    categories.forEach(c => { total += (c.items || []).length; });
    const totalEl = document.getElementById('totalItemsCount');
    if (totalEl) totalEl.textContent = total;
}

// ==================== Interactions ====================

function toggleCategory(catIndex) {
    const el = document.getElementById(`category-${catIndex}`);
    if (el) {
        el.classList.toggle('collapsed');
    }
}

function handleItemToggle(itemId, checked) {
    const toggle = document.getElementById(`check-${itemId}`);
    if (checked) {
        const priceInput = document.getElementById(`price-${itemId}`);
        const notesInput = document.getElementById(`notes-${itemId}`);
        selectedItems.set(itemId, {
            price: priceInput?.value ? parseFloat(priceInput.value) : null,
            notes: notesInput?.value || null
        });
        const row = document.getElementById(`item-row-${itemId}`);
        if (row) row.classList.add('selected');
        if (toggle) toggle.classList.add('active');
    } else {
        selectedItems.delete(itemId);
        const row = document.getElementById(`item-row-${itemId}`);
        if (row) row.classList.remove('selected');
        if (toggle) toggle.classList.remove('active');
    }
    updateSelectedCount();
    updateCategoryCounts();
}

function handlePriceChange(itemId, value) {
    if (selectedItems.has(itemId)) {
        const data = selectedItems.get(itemId);
        data.price = value ? parseFloat(value) : null;
    } else {
        // Auto-select item if price is entered
        const checkbox = document.getElementById(`check-${itemId}`);
        if (checkbox && value) {
            checkbox.checked = true;
            handleItemToggle(itemId, true);
            const data = selectedItems.get(itemId);
            if (data) data.price = parseFloat(value);
        }
    }
}

function handleNotesChange(itemId, value) {
    if (selectedItems.has(itemId)) {
        const data = selectedItems.get(itemId);
        data.notes = value || null;
    }
}

function handleSearch(query) {
    searchQuery = query;
    renderCategories();
}

function updateCategoryCounts() {
    categories.forEach((category, catIndex) => {
        const items = category.items || [];
        const selectedInCategory = items.filter(i => selectedItems.has(i.id)).length;
        const el = document.querySelector(`#category-${catIndex} .vc-category-count`);
        if (el) {
            el.textContent = `${selectedInCategory}/${items.length} selected`;
        }
    });
}

// ==================== Save & Submit ====================

function getSelections() {
    const items = [];
    selectedItems.forEach((data, masterItemId) => {
        items.push({
            master_item_id: masterItemId,
            price: data.price,
            notes: data.notes
        });
    });
    return items;
}

async function handleSaveDraft() {
    const btn = document.getElementById('saveDraftBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const baseUrl = CONFIG.procurementApiBaseUrl;
        const response = await fetch(`${baseUrl}/vendor-catalog/${catalogToken}/save-draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: getSelections() })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save draft');
        }

        _toast(`Draft saved - ${selectedItems.size} items`, 'success');
    } catch (error) {
        console.error('Save draft failed:', error);
        _toast(error.message || 'Failed to save draft', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Draft';
    }
}

async function handleSubmitCatalog() {
    if (selectedItems.size === 0) {
        _toast('Please select at least one item before submitting', 'error');
        return;
    }

    const confirmed = typeof showConfirm === 'function'
        ? await showConfirm(`You are about to submit your catalog with ${selectedItems.size} item(s). After submission, you will not be able to make changes.`, 'Submit Catalog')
        : confirm(`Submit catalog with ${selectedItems.size} item(s)?`);
    if (!confirmed) return;

    const saveBtn = document.getElementById('saveDraftBtn');
    const submitBtn = document.getElementById('submitCatalogBtn');
    saveBtn.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
        // Save draft first to ensure all selections are persisted
        const baseUrl = CONFIG.procurementApiBaseUrl;
        await fetch(`${baseUrl}/vendor-catalog/${catalogToken}/save-draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: getSelections() })
        });

        // Then submit
        const response = await fetch(`${baseUrl}/vendor-catalog/${catalogToken}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to submit catalog');
        }

        showSuccess();
    } catch (error) {
        console.error('Submit failed:', error);
        _toast(error.message || 'Failed to submit catalog', 'error');
        saveBtn.disabled = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Catalog';
    }
}

// ==================== View State Management ====================

function showAuthForm() {
    document.getElementById('authState').style.display = 'block';
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
}

function showLoading() {
    document.getElementById('authState').style.display = 'none';
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
}

function showMainContent() {
    document.getElementById('authState').style.display = 'none';
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
}

function showError(message) {
    document.getElementById('authState').style.display = 'none';
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
    if (message) {
        document.getElementById('errorMessage').textContent = message;
    }
}

function showSuccess() {
    document.getElementById('authState').style.display = 'none';
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('successState').style.display = 'block';
    document.getElementById('mainContent').style.display = 'none';
}

// ==================== Utilities ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Toast wrapper — uses Toast.js (loaded via script tag)
 */
function _toast(message, type) {
    if (typeof Toast !== 'undefined') {
        if (type === 'error') Toast.error(message);
        else if (type === 'warning') Toast.warning(message);
        else Toast.success(message);
    }
}
