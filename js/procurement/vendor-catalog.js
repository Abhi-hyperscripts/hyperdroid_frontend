/**
 * Vendor Catalog Portal - Public Page
 * No authentication required. Accessed via token URL parameter + password.
 * Allows vendors to self-register their item offerings.
 *
 * Performance optimizations:
 * - Lazy render: category body only rendered when expanded
 * - Paginated: show first 25 items per category + "Show all" button
 * - Debounced search: 300ms delay before re-render
 * - Select All / Deselect All per category
 * - Mobile: card layout instead of table rows
 */

// ==================== State ====================
let catalogToken = null;
let catalogPassword = null;
let catalogData = null;
let categories = [];
let selectedItems = new Map(); // master_item_id -> { price, notes }
let isEditable = true;
let searchQuery = '';
let searchTimer = null;
const ITEMS_PER_PAGE = 25;
let expandedCategories = new Set(); // track which categories have been expanded
let showAllItems = new Set(); // categories showing all items (not paginated)

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    catalogToken = params.get('token');

    if (!catalogToken) {
        showError('No access token provided. Please use the link sent to you by the buyer.');
        return;
    }

    // Check if we have a saved session (survives page reload)
    const savedPassword = sessionStorage.getItem(`vc_pass_${catalogToken}`);
    if (savedPassword) {
        catalogPassword = savedPassword;
        autoRestore();
        return;
    }

    fetchVendorPreview();
    showAuthForm();

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
            const titleEl = document.getElementById('authTitle');
            const subEl = document.getElementById('authSubtitle');
            if (data.vendor_name && titleEl) {
                titleEl.textContent = data.vendor_name;
                if (subEl) subEl.textContent = 'Enter your password to manage your item catalog.';
            }
        }
    } catch (e) { /* silent */ }
}

// ==================== Session Restore ====================

async function autoRestore() {
    showLoading();
    try {
        const baseUrl = CONFIG.procurementApiBaseUrl;
        const response = await fetch(`${baseUrl}/vendor-catalog/access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: catalogToken, password: catalogPassword })
        });

        if (!response.ok) {
            // Session invalid — clear and show login
            sessionStorage.removeItem(`vc_pass_${catalogToken}`);
            fetchVendorPreview();
            showAuthForm();
            return;
        }

        const data = await response.json();
        catalogData = data;
        categories = data.categories || [];
        isEditable = data.is_editable;
        primeSelectedItemsFromCatalog(data);

        if (categories.length > 0) expandedCategories.add(0);
        renderCatalog();
        showMainContent();
    } catch (e) {
        sessionStorage.removeItem(`vc_pass_${catalogToken}`);
        fetchVendorPreview();
        showAuthForm();
    }
}

// Strict allow-list (Option A): the backend has already filtered the
// catalog to items the admin selected for this vendor. Every shown item
// is implicitly part of the vendor's catalog — there is no toggle to
// remove or add. Pre-populate selectedItems for every item so SaveDraft
// always submits the full catalog with whatever price/notes the vendor
// has entered.
function primeSelectedItemsFromCatalog(data) {
    selectedItems.clear();
    const priorByItemId = new Map();
    if (data && Array.isArray(data.selected_items)) {
        data.selected_items.forEach(item => {
            priorByItemId.set(item.master_item_id, { price: item.price, notes: item.notes });
        });
    }
    (data?.categories || []).forEach(cat => {
        (cat.items || []).forEach(item => {
            const prior = priorByItemId.get(item.id);
            selectedItems.set(item.id, prior ? { price: prior.price, notes: prior.notes } : { price: null, notes: null });
        });
    });
}

function showLoading() {
    document.getElementById('authState').style.display = 'none';
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
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
        // Save session so page reload doesn't require re-auth
        sessionStorage.setItem(`vc_pass_${catalogToken}`, password);
        categories = data.categories || [];
        isEditable = data.is_editable;
        primeSelectedItemsFromCatalog(data);

        // Auto-expand first category
        if (categories.length > 0) expandedCategories.add(0);

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

    const hint = document.getElementById('catalogHint');
    if (!isEditable) {
        hint.textContent = 'This catalog has been submitted. You can view your selections but cannot make changes.';
        document.getElementById('footerActions').style.display = 'none';
    }

    renderCategories();
    updateSelectedCount();
}

function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    container.innerHTML = '';

    if (!categories || categories.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 40px;">No items available in the catalog.</div>`;
        return;
    }

    categories.forEach((category, catIndex) => {
        const allItems = category.items || [];
        const filteredItems = filterItems(allItems);
        if (searchQuery && filteredItems.length === 0) return;

        const isExpanded = expandedCategories.has(catIndex);
        const collapsedClass = isExpanded ? '' : ' collapsed';

        const categoryDiv = document.createElement('div');
        categoryDiv.className = `vc-category${collapsedClass}`;
        categoryDiv.id = `category-${catIndex}`;

        // Strict allow-list (Option A): every item shown is in the
        // catalog, so the category count is just N items — no x/y ratio
        // and no Select All / Deselect All button.
        categoryDiv.innerHTML = `
            <div class="vc-category-header" onclick="toggleCategory(${catIndex})">
                <div class="vc-cat-left">
                    <div class="vc-cat-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <span class="vc-category-name">${escapeHtml(category.category_name)}</span>
                    <span class="vc-category-count">${allItems.length} ${allItems.length === 1 ? 'item' : 'items'}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <svg class="vc-category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
            </div>
            <div class="vc-category-body" id="catbody-${catIndex}">
                ${isExpanded ? renderCategoryBody(catIndex, filteredItems) : ''}
            </div>
        `;

        container.appendChild(categoryDiv);
    });
}

function renderCategoryBody(catIndex, items) {
    if (!items || items.length === 0) return '<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:0.82rem;">No items match your search.</div>';

    const showAll = showAllItems.has(catIndex);
    const visibleItems = showAll ? items : items.slice(0, ITEMS_PER_PAGE);
    const hasMore = !showAll && items.length > ITEMS_PER_PAGE;
    const remaining = items.length - ITEMS_PER_PAGE;

    // Desktop: table header (no checkbox column — admin curates the list)
    let html = `<div class="vc-item-header vc-desktop-only">
        <span>Item</span><span style="text-align:center;">Unit</span><span>Price (Optional)</span><span>Notes (Optional)</span>
    </div>`;

    // Items
    html += visibleItems.map(item => renderItem(item)).join('');

    // Show more button
    if (hasMore) {
        html += `<div class="vc-show-more" onclick="showMoreItems(${catIndex})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            Show all ${items.length} items (${remaining} more)
        </div>`;
    }

    return html;
}

function renderItem(item) {
    // Strict allow-list (Option A): every shown item is part of the
    // vendor's catalog. There is no toggle; the vendor only fills price
    // and notes. The "selected" CSS class is kept on the row/card so the
    // existing visual treatment (subtle highlight) still applies.
    const itemData = selectedItems.get(item.id) || {};
    const disabledAttr = !isEditable ? 'disabled' : '';
    const priceVal = itemData.price != null ? itemData.price : '';
    const notesVal = escapeHtml(itemData.notes || '');

    // Desktop row
    const desktopRow = `
        <div class="vc-item-row selected vc-desktop-only" id="item-row-${item.id}">
            <div class="vc-item-info">
                <div class="vc-item-name">${escapeHtml(item.item_name)}</div>
                ${item.item_code ? `<span class="vc-item-code">${escapeHtml(item.item_code)}</span>` : ''}
            </div>
            <div class="vc-item-unit">${escapeHtml(item.unit)}</div>
            <div class="vc-item-price">
                <input type="number" min="0" step="0.01" placeholder="0.00" ${disabledAttr} value="${priceVal}" onchange="handlePriceChange('${item.id}', this.value)" id="price-${item.id}">
            </div>
            <div class="vc-item-notes">
                <input type="text" placeholder="Optional notes" ${disabledAttr} value="${notesVal}" onchange="handleNotesChange('${item.id}', this.value)" id="notes-${item.id}">
            </div>
        </div>`;

    // Mobile card
    const mobileCard = `
        <div class="vc-item-card vc-mobile-only selected" id="item-card-${item.id}">
            <div class="vc-card-top">
                <div class="vc-card-info">
                    <div class="vc-item-name">${escapeHtml(item.item_name)}</div>
                    <div class="vc-card-meta">
                        ${item.item_code ? `<span class="vc-item-code">${escapeHtml(item.item_code)}</span>` : ''}
                        <span class="vc-card-unit">${escapeHtml(item.unit)}</span>
                    </div>
                </div>
            </div>
            <div class="vc-card-fields">
                <div class="vc-card-field">
                    <label>Price</label>
                    <input type="number" min="0" step="0.01" placeholder="0.00" ${disabledAttr} value="${priceVal}" onchange="handlePriceChange('${item.id}', this.value)" id="price-m-${item.id}">
                </div>
                <div class="vc-card-field">
                    <label>Notes</label>
                    <input type="text" placeholder="Optional" ${disabledAttr} value="${notesVal}" onchange="handleNotesChange('${item.id}', this.value)" id="notes-m-${item.id}">
                </div>
            </div>
        </div>`;

    return desktopRow + mobileCard;
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
    // Strict allow-list (Option A): every item shown IS in the vendor's
    // catalog, so the only meaningful count is the total. No "selected"
    // ratio is rendered.
    let total = 0;
    categories.forEach(c => { total += (c.items || []).length; });
    const totalEl = document.getElementById('totalItemsCount');
    if (totalEl) totalEl.textContent = total;
    const footerInfo = document.querySelector('.vc-footer-info');
    if (footerInfo) footerInfo.innerHTML = `<strong>${total}</strong> ${total === 1 ? 'item' : 'items'} in your catalog`;
}

// ==================== Interactions ====================

function toggleCategory(catIndex) {
    const el = document.getElementById(`category-${catIndex}`);
    if (!el) return;

    const isCollapsing = !el.classList.contains('collapsed');
    el.classList.toggle('collapsed');

    if (!isCollapsing && !expandedCategories.has(catIndex)) {
        // First time expanding — lazy render the body
        expandedCategories.add(catIndex);
        const body = document.getElementById(`catbody-${catIndex}`);
        if (body && !body.innerHTML.trim()) {
            const items = filterItems(categories[catIndex]?.items || []);
            body.innerHTML = renderCategoryBody(catIndex, items);
        }
    }

    if (isCollapsing) {
        expandedCategories.delete(catIndex);
    } else {
        expandedCategories.add(catIndex);
    }
}

function showMoreItems(catIndex) {
    showAllItems.add(catIndex);
    const body = document.getElementById(`catbody-${catIndex}`);
    if (body) {
        const items = filterItems(categories[catIndex]?.items || []);
        body.innerHTML = renderCategoryBody(catIndex, items);
    }
}

function toggleSelectAll(catIndex, selectAll) {
    const items = filterItems(categories[catIndex]?.items || []);
    items.forEach(item => {
        if (selectAll) {
            if (!selectedItems.has(item.id)) {
                selectedItems.set(item.id, { price: null, notes: null });
            }
        } else {
            selectedItems.delete(item.id);
        }
    });

    // Re-render this category body
    const body = document.getElementById(`catbody-${catIndex}`);
    if (body) {
        body.innerHTML = renderCategoryBody(catIndex, items);
    }

    // Update the Select All / Deselect All button in the header
    const allNowSelected = items.length > 0 && items.every(i => selectedItems.has(i.id));
    const btn = document.querySelector(`#category-${catIndex} .vc-select-all-btn`);
    if (btn) {
        btn.textContent = allNowSelected ? 'Deselect All' : 'Select All';
        btn.setAttribute('onclick', `event.stopPropagation(); toggleSelectAll(${catIndex}, ${!allNowSelected})`);
    }

    updateSelectedCount();
    updateCategoryCounts();
}

function handleItemToggle(itemId, checked) {
    // Update both desktop and mobile toggles
    ['check-', 'check-m-'].forEach(prefix => {
        const toggle = document.getElementById(`${prefix}${itemId}`);
        if (toggle) {
            if (checked) toggle.classList.add('active');
            else toggle.classList.remove('active');
        }
    });

    if (checked) {
        // Read from whichever input exists (desktop or mobile)
        const priceInput = document.getElementById(`price-${itemId}`) || document.getElementById(`price-m-${itemId}`);
        const notesInput = document.getElementById(`notes-${itemId}`) || document.getElementById(`notes-m-${itemId}`);
        selectedItems.set(itemId, {
            price: priceInput?.value ? parseFloat(priceInput.value) : null,
            notes: notesInput?.value || null
        });
        // Highlight rows/cards
        const row = document.getElementById(`item-row-${itemId}`);
        if (row) row.classList.add('selected');
        const card = document.getElementById(`item-card-${itemId}`);
        if (card) card.classList.add('selected');
    } else {
        selectedItems.delete(itemId);
        const row = document.getElementById(`item-row-${itemId}`);
        if (row) row.classList.remove('selected');
        const card = document.getElementById(`item-card-${itemId}`);
        if (card) card.classList.remove('selected');
    }
    updateSelectedCount();
    updateCategoryCounts();
}

function handlePriceChange(itemId, value) {
    let entry = selectedItems.get(itemId);
    if (!entry) {
        entry = { price: null, notes: null };
        selectedItems.set(itemId, entry);
    }
    entry.price = value ? parseFloat(value) : null;
}

function handleNotesChange(itemId, value) {
    let entry = selectedItems.get(itemId);
    if (!entry) {
        entry = { price: null, notes: null };
        selectedItems.set(itemId, entry);
    }
    entry.notes = value || null;
}

function handleSearch(query) {
    // Debounce 300ms
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchQuery = query;
        // When searching, expand all categories and show all items
        if (query) {
            categories.forEach((_, i) => expandedCategories.add(i));
        }
        renderCategories();
    }, 300);
}

function updateCategoryCounts() {
    categories.forEach((category, catIndex) => {
        const items = category.items || [];
        const el = document.querySelector(`#category-${catIndex} .vc-category-count`);
        if (el) el.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    });
}

// ==================== Save & Submit ====================

function getSelections() {
    const items = [];
    selectedItems.forEach((data, masterItemId) => {
        items.push({ master_item_id: masterItemId, price: data.price, notes: data.notes });
    });
    return items;
}

async function handleSaveDraft() {
    const btn = document.getElementById('saveDraftBtn');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/></svg> Saving...';

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

        _toast(`Draft saved — ${selectedItems.size} ${selectedItems.size === 1 ? 'item' : 'items'}`, 'success');
    } catch (error) {
        console.error('Save draft failed:', error);
        _toast(error.message || 'Failed to save draft', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
}

async function handleSubmitCatalog() {
    if (selectedItems.size === 0) {
        _toast('Your catalog is empty. Please contact the buyer to have items added.', 'error');
        return;
    }

    const confirmed = await showConfirm(
        `You are about to submit your catalog with ${selectedItems.size} item(s). After submission, you will not be able to make changes.`,
        'Submit Catalog'
    );
    if (!confirmed) return;

    const saveBtn = document.getElementById('saveDraftBtn');
    const submitBtn = document.getElementById('submitCatalogBtn');
    saveBtn.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
        const baseUrl = CONFIG.procurementApiBaseUrl;
        await fetch(`${baseUrl}/vendor-catalog/${catalogToken}/save-draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: getSelections() })
        });

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
    if (message) document.getElementById('errorMessage').textContent = message;
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
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _toast(message, type) {
    if (typeof Toast !== 'undefined') {
        if (type === 'error') Toast.error(message);
        else if (type === 'warning') Toast.warning(message);
        else Toast.success(message);
    }
}
