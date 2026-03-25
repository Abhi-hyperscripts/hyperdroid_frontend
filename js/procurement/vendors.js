/**
 * Procurement Vendors Management
 * Handles CRUD operations, filtering for vendors.
 */

// ==================== State ====================
let allVendors = [];
let currentEditVendorId = null;

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

    if (!search) {
        renderVendorsTable(allVendors);
        return;
    }

    const filtered = allVendors.filter(vendor => {
        const name = (vendor.vendor_name || '').toLowerCase();
        const code = (vendor.vendor_code || '').toLowerCase();
        const email = (vendor.email || '').toLowerCase();
        const city = (vendor.city || '').toLowerCase();
        const country = (vendor.country || '').toLowerCase();
        return name.includes(search) || code.includes(search) || email.includes(search) || city.includes(search) || country.includes(search);
    });

    renderVendorsTable(filtered);
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

    tbody.innerHTML = vendors.map(vendor => `
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
