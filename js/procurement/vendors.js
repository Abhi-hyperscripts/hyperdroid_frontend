/**
 * Procurement Vendors Management
 * Handles CRUD operations, filtering for vendors.
 */

// ==================== State ====================
let allVendors = [];
let currentEditVendorId = null;
let _vFilteredVendors = [];
let _vCurrentPage = 1;
const V_PAGE_SIZE = 20;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    loadVendors();
});

// ==================== Data Loading ====================

async function loadVendors() {
    try {
        const response = await api.request('/procurement/vendors');
        allVendors = response.data || response || [];
        _vFilteredVendors = allVendors;
        _vCurrentPage = 1;
        renderVendorsTable(allVendors);
    } catch (error) {
        console.error('Failed to load vendors:', error);
        renderVendorsTable([]);
        Toast.error('Failed to load vendors');
    }
}

// ==================== Filter Handling ====================

function applyFilters() {
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();

    let filtered = allVendors;
    if (search) {
        filtered = filtered.filter(vendor => {
            const name = (vendor.vendor_name || '').toLowerCase();
            const code = (vendor.vendor_code || '').toLowerCase();
            const email = (vendor.email || '').toLowerCase();
            const city = (vendor.city || '').toLowerCase();
            const country = (vendor.country || '').toLowerCase();
            return name.includes(search) || code.includes(search) || email.includes(search) || city.includes(search) || country.includes(search);
        });
    }

    _vFilteredVendors = filtered;
    _vCurrentPage = 1;
    renderVendorsTable(filtered);
}

function vGoToPage(page) {
    const totalPages = Math.ceil(_vFilteredVendors.length / V_PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    _vCurrentPage = page;
    renderVendorsTable(_vFilteredVendors);
    document.getElementById('vendorsTableBody')?.closest('table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==================== Table Rendering ====================

function renderVendorsTable(vendors) {
    const tbody = document.getElementById('vendorsTableBody');

    if (!vendors || vendors.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                        </svg>
                        <p>No vendors found</p>
                        <button class="btn btn-sm btn-primary" onclick="openNewVendorModal()">Add your first vendor</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // Pagination
    const totalItems = vendors.length;
    const totalPages = Math.ceil(totalItems / V_PAGE_SIZE);
    if (_vCurrentPage > totalPages) _vCurrentPage = totalPages || 1;
    const startIdx = (_vCurrentPage - 1) * V_PAGE_SIZE;
    const pageVendors = vendors.slice(startIdx, startIdx + V_PAGE_SIZE);

    tbody.innerHTML = pageVendors.map(vendor => `
        <tr>
            <td>
                <div class="crm-cell-primary" style="display: flex; align-items: center; gap: 10px;">
                    <div class="crm-avatar" style="width: 32px; height: 32px; border-radius: 8px; background: var(--brand-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0;">
                        ${getInitials(vendor.vendor_name)}
                    </div>
                    <div>
                        <div style="color: var(--brand-primary); font-weight: 500;">${escapeHtml(vendor.vendor_name || '')}</div>
                        ${vendor.contact_person ? `<div class="crm-cell-secondary">${escapeHtml(vendor.contact_person)}</div>` : ''}
                    </div>
                </div>
            </td>
            <td><span class="crm-cell-secondary">${escapeHtml(vendor.vendor_code || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(vendor.email || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(vendor.phone || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(vendor.city || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(vendor.country || '-')}</span></td>
            <td class="hide-mobile">${renderRating(vendor.rating)}</td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${vendor.item_count || 0}</span></td>
            <td>
                <div class="crm-actions">
                    <button class="crm-action-btn" onclick="openEditVendorModal('${vendor.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn" onclick="openManageItemsModal('${vendor.id}')" title="Manage Items">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                            <rect x="9" y="3" width="6" height="4" rx="1"/>
                            <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn" onclick="generateCatalogLink('${vendor.id}')" title="Catalog Link">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn action-delete" onclick="deleteVendor('${vendor.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    // Pagination controls
    vRenderPagination(totalItems, totalPages);
}

function vRenderPagination(totalItems, totalPages) {
    let container = document.getElementById('vendorsPagination');
    if (!container) {
        container = document.createElement('div');
        container.id = 'vendorsPagination';
        const table = document.getElementById('vendorsTableBody')?.closest('table');
        if (table) table.parentNode.insertBefore(container, table.nextSibling);
    }

    if (totalPages <= 1) {
        container.innerHTML = totalItems > 0
            ? `<div style="padding:10px 0; text-align:center; font-size:12px; color:var(--text-secondary);">${totalItems} vendor${totalItems !== 1 ? 's' : ''}</div>`
            : '';
        return;
    }

    const startItem = (_vCurrentPage - 1) * V_PAGE_SIZE + 1;
    const endItem = Math.min(_vCurrentPage * V_PAGE_SIZE, totalItems);

    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (_vCurrentPage > 3) pages.push('...');
        const start = Math.max(2, _vCurrentPage - 1);
        const end = Math.min(totalPages - 1, _vCurrentPage + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (_vCurrentPage < totalPages - 2) pages.push('...');
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
                <button onclick="vGoToPage(${_vCurrentPage - 1})" style="${_vCurrentPage === 1 ? disabledNavStyle : navStyle}" ${_vCurrentPage === 1 ? 'disabled' : ''} onmouseenter="if(!this.disabled)this.style.background='var(--bg-hover,var(--bg-secondary))'" onmouseleave="if(!this.disabled)this.style.background='var(--bg-tertiary)'">&lsaquo; Prev</button>
                ${pages.map(p => p === '...'
                    ? `<span style="padding:4px 4px; font-size:13px; color:var(--text-secondary); user-select:none;">…</span>`
                    : `<button onclick="vGoToPage(${p})" style="${p === _vCurrentPage ? activeBtnStyle : btnStyle}" ${p !== _vCurrentPage ? 'onmouseenter="this.style.background=\'var(--bg-hover,var(--bg-secondary))\'" onmouseleave="this.style.background=\'var(--bg-tertiary)\'"' : ''}>${p}</button>`
                ).join('')}
                <button onclick="vGoToPage(${_vCurrentPage + 1})" style="${_vCurrentPage === totalPages ? disabledNavStyle : navStyle}" ${_vCurrentPage === totalPages ? 'disabled' : ''} onmouseenter="if(!this.disabled)this.style.background='var(--bg-hover,var(--bg-secondary))'" onmouseleave="if(!this.disabled)this.style.background='var(--bg-tertiary)'">Next &rsaquo;</button>
            </div>
        </div>
    `;
}

function renderRating(rating) {
    if (!rating && rating !== 0) return '<span class="crm-cell-secondary">-</span>';
    const stars = Math.round(rating);
    let html = '';
    for (let i = 1; i <= 5; i++) {
        html += `<span style="color: ${i <= stars ? 'var(--color-warning)' : 'var(--text-muted)'}; font-size: 12px;">&#9733;</span>`;
    }
    return html;
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

function openNewVendorModal() {
    currentEditVendorId = null;
    document.getElementById('vendorModalTitle').textContent = 'Add Vendor';
    const submitBtn = document.getElementById('vendorSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="vendorSubmitSpinner" style="display:none;"></span> Add Vendor';
    document.getElementById('vendorForm').reset();
    document.getElementById('vendorId').value = '';
    openModal('vendorModal');
}

function openEditVendorModal(id) {
    const vendor = allVendors.find(v => v.id === id);
    if (!vendor) {
        Toast.error('Vendor not found');
        return;
    }

    currentEditVendorId = id;
    document.getElementById('vendorModalTitle').textContent = 'Edit Vendor';
    const submitBtn = document.getElementById('vendorSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="vendorSubmitSpinner" style="display:none;"></span> Update Vendor';
    document.getElementById('vendorId').value = id;
    document.getElementById('vendorName').value = vendor.vendor_name || '';
    document.getElementById('vendorCode').value = vendor.vendor_code || '';
    document.getElementById('vendorEmail').value = vendor.email || '';
    document.getElementById('vendorPhone').value = vendor.phone || '';
    document.getElementById('vendorContactPerson').value = vendor.contact_person || '';
    document.getElementById('vendorWebsite').value = vendor.website || '';
    document.getElementById('vendorAddress').value = vendor.address || '';
    document.getElementById('vendorCity').value = vendor.city || '';
    document.getElementById('vendorState').value = vendor.state || '';
    document.getElementById('vendorCountry').value = vendor.country || '';
    document.getElementById('vendorPostalCode').value = vendor.postal_code || '';
    document.getElementById('vendorGstNumber').value = vendor.gst_number || '';
    document.getElementById('vendorPanNumber').value = vendor.pan_number || '';
    document.getElementById('vendorPaymentTerms').value = vendor.payment_terms || '';
    document.getElementById('vendorNotes').value = vendor.notes || '';
    openModal('vendorModal');
}

function closeVendorModal() {
    closeModal('vendorModal');
    currentEditVendorId = null;
}

// ==================== CRUD Operations ====================

async function handleVendorSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('vendorSubmitBtn');
    const spinner = document.getElementById('vendorSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        vendor_name: document.getElementById('vendorName').value.trim(),
        vendor_code: document.getElementById('vendorCode').value.trim(),
        email: document.getElementById('vendorEmail').value.trim(),
        phone: document.getElementById('vendorPhone').value.trim(),
        contact_person: document.getElementById('vendorContactPerson').value.trim(),
        website: document.getElementById('vendorWebsite').value.trim(),
        address: document.getElementById('vendorAddress').value.trim(),
        city: document.getElementById('vendorCity').value.trim(),
        state: document.getElementById('vendorState').value.trim(),
        country: document.getElementById('vendorCountry').value.trim(),
        postal_code: document.getElementById('vendorPostalCode').value.trim(),
        gst_number: document.getElementById('vendorGstNumber').value.trim(),
        pan_number: document.getElementById('vendorPanNumber').value.trim(),
        payment_terms: document.getElementById('vendorPaymentTerms').value.trim(),
        notes: document.getElementById('vendorNotes').value.trim()
    };

    try {
        if (currentEditVendorId) {
            formData.id = currentEditVendorId;
            await api.request('/procurement/vendors', {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Vendor updated successfully');
        } else {
            await api.request('/procurement/vendors', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Vendor created successfully');
        }

        closeVendorModal();
        loadVendors();
    } catch (error) {
        console.error('Failed to save vendor:', error);
        Toast.error(error.message || 'Failed to save vendor');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteVendor(id) {
    const confirmed = await showConfirm('Are you sure you want to delete this vendor?', 'Delete Vendor', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/procurement/vendors/${id}`, { method: 'DELETE' });
        Toast.success('Vendor deleted');
        loadVendors();
    } catch (error) {
        console.error('Failed to delete vendor:', error);
        Toast.error('Failed to delete vendor');
    }
}

// ==================== Catalog Link ====================

async function generateCatalogLink(vendorId) {
    // Show modal with loading state
    document.getElementById('catalogLinkLoading').style.display = '';
    document.getElementById('catalogLinkResult').style.display = 'none';
    openModal('catalogLinkModal');

    try {
        const response = await api.request('/procurement/vendor-catalog/generate-link', {
            method: 'POST',
            body: JSON.stringify({ vendor_id: vendorId, expires_in_days: 30 })
        });

        const data = response.data || response;
        document.getElementById('catalogUrl').value = data.url || data.link || '';
        document.getElementById('catalogPassword').value = data.password || '';
        document.getElementById('catalogExpiry').textContent = data.expires_at ? formatDate(data.expires_at) : '30 days from now';

        document.getElementById('catalogLinkLoading').style.display = 'none';
        document.getElementById('catalogLinkResult').style.display = '';
    } catch (error) {
        console.error('Failed to generate catalog link:', error);
        closeCatalogLinkModal();
        Toast.error(error.message || 'Failed to generate catalog link');
    }
}

function closeCatalogLinkModal() {
    closeModal('catalogLinkModal');
}

function copyCatalogUrl() {
    const url = document.getElementById('catalogUrl').value;
    navigator.clipboard.writeText(url).then(() => {
        Toast.success('URL copied to clipboard');
    }).catch(() => {
        document.getElementById('catalogUrl').select();
        document.execCommand('copy');
        Toast.success('URL copied to clipboard');
    });
}

function copyCatalogPassword() {
    const pw = document.getElementById('catalogPassword').value;
    navigator.clipboard.writeText(pw).then(() => {
        Toast.success('Password copied to clipboard');
    }).catch(() => {
        document.getElementById('catalogPassword').select();
        document.execCommand('copy');
        Toast.success('Password copied to clipboard');
    });
}

// ==================== Utilities ====================

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

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

// ==================== Manage Vendor Items (Two-Pane Picker) ====================

let _manageItemsVendorId = null;
let _allMasterItems = []; // flat list
let _allCategories = []; // grouped
let _selectedItemIds = new Set();
let _itemScrollBound = false;
let _itemFilteredCache = [];
const ITEM_ROW_HEIGHT = 42;

async function openManageItemsModal(vendorId) {
    _manageItemsVendorId = vendorId;
    _selectedItemIds.clear();
    const vendor = allVendors.find(v => v.id === vendorId);

    // Create modal if not exists
    let modal = document.getElementById('manageItemsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'manageItemsModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-backdrop" onclick="closeManageItemsModal()"></div>
            <div class="modal-dialog" style="max-width:860px; width:95vw;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="manageItemsTitle">Manage Items</h5>
                        <button class="close-btn" onclick="closeManageItemsModal()">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="modal-body" style="padding:12px;">
                        <div style="display:flex; gap:12px; height:400px;">
                            <!-- LEFT: Available items -->
                            <div style="flex:1; display:flex; flex-direction:column; border:1px solid var(--border-primary); border-radius:8px; overflow:hidden; min-width:0;">
                                <div style="padding:8px 10px; background:var(--bg-tertiary); border-bottom:1px solid var(--border-primary); display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
                                    <span style="font-size:12px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Available Items</span>
                                    <span id="itemAvailableCount" style="font-size:11px; color:var(--text-secondary);">0</span>
                                </div>
                                <div style="padding:6px 8px; border-bottom:1px solid var(--border-primary); flex-shrink:0; display:flex; gap:6px; align-items:center;">
                                    <input type="text" id="itemSearchInput" placeholder="Search items..." autocomplete="off"
                                        style="padding:6px 10px; width:100%; box-sizing:border-box; height:30px; font-size:12px; border:1px solid var(--border-primary); border-radius:6px; background:var(--bg-input, var(--bg-secondary)); color:var(--text-primary); outline:none; flex:1;">
                                    <button type="button" id="itemSelectAllBtn" onclick="selectAllFilteredItems()" style="background:none; border:none; color:var(--brand-primary); font-size:11px; cursor:pointer; padding:4px 6px; white-space:nowrap; font-weight:600;">All</button>
                                </div>
                                <div id="itemAvailableList" style="flex:1; overflow-y:auto; padding:2px 0;">
                                    <div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:13px;">Loading...</div>
                                </div>
                            </div>
                            <!-- RIGHT: Selected items -->
                            <div style="flex:1; display:flex; flex-direction:column; border:1px solid var(--border-primary); border-radius:8px; overflow:hidden; min-width:0;">
                                <div style="padding:8px 10px; background:var(--bg-tertiary); border-bottom:1px solid var(--border-primary); display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
                                    <span style="font-size:12px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Selected</span>
                                    <span id="itemSelectedCount" style="font-size:11px; font-weight:600; color:var(--brand-primary);">0</span>
                                </div>
                                <div style="padding:6px 8px; border-bottom:1px solid var(--border-primary); flex-shrink:0;">
                                    <button type="button" id="itemClearAllBtn" onclick="clearAllItemSelections()" style="background:none; border:none; color:var(--color-error); font-size:11px; cursor:pointer; padding:4px 0; font-weight:500; display:none;">Clear all</button>
                                </div>
                                <div id="itemSelectedList" style="flex:1; overflow-y:auto; padding:2px 0;">
                                    <div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:12px;">
                                        <svg style="width:32px; height:32px; margin-bottom:8px; opacity:0.3;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg>
                                        <div>Select items from the left</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeManageItemsModal()">Cancel</button>
                        <button type="button" class="btn btn-primary" id="saveItemsBtn" onclick="handleSaveVendorItems()">
                            <span class="btn-spinner" id="saveItemsSpinner" style="display:none;"></span>
                            Save Items
                        </button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);

        // Bind search
        document.getElementById('itemSearchInput').addEventListener('input', () => {
            renderItemAvailablePane();
            updateItemPickerCounts();
        });
    }

    document.getElementById('manageItemsTitle').textContent = `Manage Items — ${vendor ? escapeHtml(vendor.vendor_name) : 'Vendor'}`;

    // Open modal
    modal.classList.add('gm-animating');
    requestAnimationFrame(() => modal.classList.add('active'));

    // Load data
    document.getElementById('itemAvailableList').innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:13px;">Loading...</div>';
    document.getElementById('itemSelectedList').innerHTML = '';

    try {
        const [categoriesRes, vendorItemsRes] = await Promise.all([
            api.request('/procurement/vendor-catalog/admin/master-items', { _skipSpinner: true }),
            api.request(`/procurement/vendor-catalog/admin/vendors/${vendorId}/items`, { _skipSpinner: true })
        ]);

        _allCategories = categoriesRes.data || categoriesRes || [];
        // Flatten categories into items list
        _allMasterItems = [];
        _allCategories.forEach(cat => {
            (cat.items || []).forEach(item => {
                _allMasterItems.push({ ...item, category_name: cat.category_name || 'Uncategorized' });
            });
        });
        _allMasterItems.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''));

        // Pre-select vendor's existing items
        const vendorItems = vendorItemsRes.data || vendorItemsRes || [];
        _selectedItemIds.clear();
        vendorItems.forEach(vi => _selectedItemIds.add(vi.master_item_id));

        renderItemAvailablePane();
        renderItemSelectedPane();
        updateItemPickerCounts();

        // Bind scroll for virtual scroll
        const listEl = document.getElementById('itemAvailableList');
        if (listEl && !_itemScrollBound) {
            listEl.addEventListener('scroll', () => _renderItemVirtualItems());
            _itemScrollBound = true;
        }
    } catch (error) {
        console.error('Failed to load items:', error);
        document.getElementById('itemAvailableList').innerHTML =
            '<div style="padding:20px; text-align:center; color:var(--color-error); font-size:13px;">Failed to load items</div>';
    }
}

function closeManageItemsModal() {
    const modal = document.getElementById('manageItemsModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.classList.remove('gm-animating'), 200);
    }
}

function getFilteredItems() {
    const filter = (document.getElementById('itemSearchInput')?.value || '').toLowerCase();
    if (!filter) return _allMasterItems;
    return _allMasterItems.filter(item =>
        (item.item_name || '').toLowerCase().includes(filter) ||
        (item.item_code || '').toLowerCase().includes(filter) ||
        (item.category_name || '').toLowerCase().includes(filter));
}

function _buildItemRowHtml(item) {
    const isSelected = _selectedItemIds.has(item.id);
    const name = escapeHtml(item.item_name || '');
    const code = item.item_code ? escapeHtml(item.item_code) : '';
    const cat = item.category_name ? escapeHtml(item.category_name) : '';
    const toggleState = isSelected ? 'on' : 'off';
    return `<div class="vendor-pick-item${isSelected ? ' vendor-pick-selected' : ''}" onclick="toggleItemSelection('${item.id}')" style="display:flex; align-items:center; gap:10px; padding:8px 10px; cursor:pointer; border-bottom:1px solid var(--border-primary); height:${ITEM_ROW_HEIGHT}px; box-sizing:border-box;">
        <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:500; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}${code ? ` <span style="color:var(--text-secondary); font-weight:400; font-size:11px;">(${code})</span>` : ''}</div>
            ${cat ? `<div style="font-size:10px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${cat}</div>` : ''}
        </div>
        <div class="vendor-toggle-track ${toggleState}"><div class="vendor-toggle-knob"></div></div>
    </div>`;
}

function renderItemAvailablePane() {
    const container = document.getElementById('itemAvailableList');
    _itemFilteredCache = getFilteredItems();
    const searchVal = document.getElementById('itemSearchInput')?.value || '';

    if (_itemFilteredCache.length === 0) {
        container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:12px;">${searchVal ? 'No items match' : 'No master items found'}</div>`;
        return;
    }

    const totalHeight = _itemFilteredCache.length * ITEM_ROW_HEIGHT;
    container.innerHTML = `<div id="itemVirtualSpacer" style="height:${totalHeight}px; position:relative;"><div id="itemVirtualViewport" style="position:absolute; left:0; right:0;"></div></div>`;
    container.scrollTop = 0;
    _renderItemVirtualItems();
}

function _renderItemVirtualItems() {
    const container = document.getElementById('itemAvailableList');
    const viewport = document.getElementById('itemVirtualViewport');
    if (!container || !viewport || _itemFilteredCache.length === 0) return;

    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_ROW_HEIGHT) - 3);
    const endIdx = Math.min(_itemFilteredCache.length, Math.ceil((scrollTop + containerHeight) / ITEM_ROW_HEIGHT) + 3);

    viewport.style.top = `${startIdx * ITEM_ROW_HEIGHT}px`;
    viewport.innerHTML = _itemFilteredCache.slice(startIdx, endIdx).map(item => _buildItemRowHtml(item)).join('');
}

function renderItemSelectedPane() {
    const container = document.getElementById('itemSelectedList');
    const clearBtn = document.getElementById('itemClearAllBtn');

    if (_selectedItemIds.size === 0) {
        container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:12px;">
            <svg style="width:32px; height:32px; margin-bottom:8px; opacity:0.3;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg>
            <div>Select items from the left</div>
        </div>`;
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }

    if (clearBtn) clearBtn.style.display = '';

    container.innerHTML = Array.from(_selectedItemIds).map(id => {
        const item = _allMasterItems.find(x => x.id === id);
        if (!item) return '';
        const name = escapeHtml(item.item_name || '');
        const cat = item.category_name ? escapeHtml(item.category_name) : '';
        return `<div style="display:flex; align-items:center; gap:8px; padding:7px 10px; border-bottom:1px solid var(--border-primary);">
            <div style="flex:1; min-width:0;">
                <div style="font-size:13px; font-weight:500; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
                ${cat ? `<div style="font-size:10px; color:var(--text-secondary);">${cat}</div>` : ''}
            </div>
            <button type="button" onclick="toggleItemSelection('${id}')" style="background:none; border:none; cursor:pointer; color:var(--color-error); padding:2px; line-height:1; font-size:16px; opacity:0.7;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.7'" title="Remove">&times;</button>
        </div>`;
    }).join('');
}

function toggleItemSelection(itemId) {
    if (_selectedItemIds.has(itemId)) {
        _selectedItemIds.delete(itemId);
    } else {
        _selectedItemIds.add(itemId);
    }
    _renderItemVirtualItems();
    renderItemSelectedPane();
    updateItemPickerCounts();
}

function selectAllFilteredItems() {
    const filtered = getFilteredItems();
    const allSelected = filtered.every(item => _selectedItemIds.has(item.id));
    if (allSelected) {
        filtered.forEach(item => _selectedItemIds.delete(item.id));
    } else {
        filtered.forEach(item => _selectedItemIds.add(item.id));
    }
    _renderItemVirtualItems();
    renderItemSelectedPane();
    updateItemPickerCounts();
}

function clearAllItemSelections() {
    _selectedItemIds.clear();
    _renderItemVirtualItems();
    renderItemSelectedPane();
    updateItemPickerCounts();
}

function updateItemPickerCounts() {
    const count = _selectedItemIds.size;
    const filtered = _itemFilteredCache;

    const availEl = document.getElementById('itemAvailableCount');
    if (availEl) availEl.textContent = filtered.length;

    const selEl = document.getElementById('itemSelectedCount');
    if (selEl) selEl.textContent = count;

    const btn = document.getElementById('itemSelectAllBtn');
    if (btn) {
        const allSelected = filtered.length > 0 && filtered.every(item => _selectedItemIds.has(item.id));
        btn.textContent = allSelected ? 'None' : 'All';
    }

    const saveBtn = document.getElementById('saveItemsBtn');
    if (saveBtn) {
        const spinner = document.getElementById('saveItemsSpinner');
        const spinnerHtml = spinner ? spinner.outerHTML : '';
        saveBtn.innerHTML = count > 0 ? `${spinnerHtml} Save ${count} Item${count > 1 ? 's' : ''}` : `${spinnerHtml} Save Items`;
    }
}

async function handleSaveVendorItems() {
    const saveBtn = document.getElementById('saveItemsBtn');
    const spinner = document.getElementById('saveItemsSpinner');
    saveBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const items = Array.from(_selectedItemIds).map(id => ({ master_item_id: id }));

    try {
        await api.request(`/procurement/vendor-catalog/admin/vendors/${_manageItemsVendorId}/items`, {
            method: 'PUT',
            body: JSON.stringify({ items })
        });
        Toast.success(`${items.length} item${items.length !== 1 ? 's' : ''} saved`);
        closeManageItemsModal();
        loadVendors(); // Refresh list to update item_count
    } catch (error) {
        console.error('Failed to save vendor items:', error);
        Toast.error(error.message || 'Failed to save items');
    } finally {
        saveBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}
