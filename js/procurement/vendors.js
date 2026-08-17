/**
 * Procurement Vendors Management
 * Handles CRUD operations, filtering for vendors.
 */

// ==================== State ====================
let allVendors = [];
let currentEditVendorId = null;
let _vFilteredVendors = [];
let _vCurrentPage = 1;
let _vStatusFilter = 'all';   // 'all' | 'approved' | 'pending' | 'rejected'
let _vStatusDropdown = null;
const V_PAGE_SIZE = 20;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    initStatusFilterDropdown();
    initStatCardClicks();
    loadVendors();
});

function initStatusFilterDropdown() {
    if (typeof SearchableDropdown === 'undefined') {
        // Script not loaded yet — retry once after layout settles.
        setTimeout(initStatusFilterDropdown, 200);
        return;
    }
    _vStatusDropdown = new SearchableDropdown('vendorStatusFilterContainer', {
        placeholder: 'All statuses',
        searchPlaceholder: 'Search statuses…',
        options: [
            { value: 'all',      label: 'All statuses' },
            { value: 'approved', label: 'Approved' },
            { value: 'pending',  label: 'Pending approval' },
            { value: 'rejected', label: 'Rejected' }
        ],
        onChange: v => {
            _vStatusFilter = v || 'all';
            applyFilters();
        }
    });
}

function initStatCardClicks() {
    document.querySelectorAll('.vendor-stat-card').forEach(card => {
        card.addEventListener('click', () => {
            const stat = card.getAttribute('data-stat');
            _vStatusFilter = stat;
            // Sync dropdown to keep UI consistent. setValue() updates the
            // displayed text but does NOT fire onChange — that's by design
            // (it would loop on every programmatic sync). So we explicitly
            // re-apply the filter ourselves after syncing.
            if (_vStatusDropdown && typeof _vStatusDropdown.setValue === 'function') {
                _vStatusDropdown.setValue(stat);
            }
            applyFilters();
            // Highlight the active stat card so the user can see which
            // status they're viewing.
            document.querySelectorAll('.vendor-stat-card').forEach(c =>
                c.style.boxShadow = c === card ? '0 0 0 2px var(--brand-primary)' : '');
        });
    });
}

// ==================== Data Loading ====================

async function loadVendors() {
    try {
        const response = await api.request('/procurement/vendors');
        allVendors = response.data || response || [];
        recomputeVendorStats();
        applyFilters();
    } catch (error) {
        console.error('Failed to load vendors:', error);
        renderVendorsTable([]);
        Toast.error('Failed to load vendors');
    }
}

function recomputeVendorStats() {
    const counts = { approved: 0, pending: 0, rejected: 0 };
    for (const v of allVendors) {
        const s = (v.status || 'approved').toLowerCase();
        if (counts[s] != null) counts[s]++;
    }
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    set('vendorStatTotal',    allVendors.length);
    set('vendorStatApproved', counts.approved);
    set('vendorStatPending',  counts.pending);
    set('vendorStatRejected', counts.rejected);
}

// ==================== Filter Handling ====================

function applyFilters() {
    const search = (document.getElementById('filterSearch')?.value || '').trim().toLowerCase();

    let filtered = allVendors;
    if (_vStatusFilter && _vStatusFilter !== 'all') {
        filtered = filtered.filter(v => (v.status || 'approved') === _vStatusFilter);
    }
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
                <td colspan="10" class="crm-empty-state">
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

    // Status badge: vendors that come back with status='pending' or 'rejected'
    // are actually client_vendor_request rows in Accounts that haven't been
    // promoted to the master vendors table yet. Procurement merges them into
    // this list so the operator can see the full pipeline.
    const statusBadge = (status, reason) => {
        const map = {
            approved: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: 'Approved' },
            pending:  { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b', label: 'Pending' },
            rejected: { bg: 'rgba(239,68,68,0.15)',  fg: '#ef4444', label: 'Rejected' }
        };
        const s = map[status] || map.approved;
        const tip = reason ? ` title="${escapeHtml(reason)}"` : '';
        return `<span${tip} style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; background:${s.bg}; color:${s.fg};">${s.label}</span>`;
    };

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
                        ${vendor.requested_from_service && vendor.status !== 'approved' ? `<div class="crm-cell-secondary" style="font-size:10px; opacity:0.6;">requested from ${escapeHtml(vendor.requested_from_service)}</div>` : ''}
                    </div>
                </div>
            </td>
            <td>${statusBadge(vendor.status || 'approved', vendor.rejection_reason)}</td>
            <td><span class="crm-cell-secondary">${escapeHtml(vendor.vendor_code || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(vendor.email || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(vendor.phone || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(vendor.city || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(vendor.country || '-')}</span></td>
            <td class="hide-mobile">${renderRating(vendor.rating)}</td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${vendor.item_count || 0}</span></td>
            <td>
                <div class="crm-actions">
                    ${(vendor.status || 'approved') !== 'approved' ? `
                        <!-- Pending / rejected vendors have no procurement-side
                             record yet (no catalog, no quotes, no scoring), so
                             the action buttons are intentionally suppressed.
                             They re-appear automatically once the vendor is
                             approved in Accounts. -->
                        <span style="opacity:0.4; font-size:11px; font-style:italic;">
                            ${vendor.status === 'rejected' ? 'rejected — no actions' : 'awaiting approval'}
                        </span>
                    ` : `
                    <button class="crm-action-btn" onclick="openVendorIntelligence('${vendor.id}')" title="Intelligence">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                        </svg>
                    </button>
                    <!-- Edit and Delete intentionally OMITTED: vendor master records
                         are owned by AccountsService (single source of truth).
                         Procurement only owns catalog/scoring/intelligence/portal
                         data, surfaced by the buttons that remain. -->
                    <button class="crm-action-btn" onclick="openManageItemsModal('${vendor.id}')" title="Manage Items this Vendor Supplies">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="8" y1="6" x2="21" y2="6"/>
                            <line x1="8" y1="12" x2="21" y2="12"/>
                            <line x1="8" y1="18" x2="21" y2="18"/>
                            <line x1="3" y1="6" x2="3.01" y2="6"/>
                            <line x1="3" y1="12" x2="3.01" y2="12"/>
                            <line x1="3" y1="18" x2="3.01" y2="18"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn" onclick="generateCatalogLink('${vendor.id}')" title="Catalog Link">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                    </button>
                    `}
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
    document.getElementById('contactsSection').style.display = 'none';
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
    document.getElementById('vendorIndustry').value = vendor.industry || '';
    document.getElementById('vendorContactPerson').value = vendor.contact_person || '';
    document.getElementById('vendorEmail').value = vendor.email || '';
    document.getElementById('vendorPhone').value = vendor.phone || '';
    document.getElementById('vendorWebsite').value = vendor.website || '';
    document.getElementById('vendorAddress').value = vendor.address || '';
    document.getElementById('vendorCity').value = vendor.city || '';
    document.getElementById('vendorState').value = vendor.state || '';
    document.getElementById('vendorCountry').value = vendor.country || '';
    document.getElementById('vendorPostalCode').value = vendor.postal_code || '';
    document.getElementById('vendorPaymentTerms').value = vendor.payment_terms || '';
    document.getElementById('vendorGstNumber').value = vendor.gst_number || '';
    document.getElementById('vendorPanNumber').value = vendor.pan_number || '';
    document.getElementById('vendorNotes').value = vendor.notes || '';
    document.getElementById('contactsSection').style.display = '';
    document.getElementById('catalogLinksSection').style.display = '';
    loadContacts(id);
    loadCatalogLinks(id);
    openModal('vendorModal');
}

function closeVendorModal() {
    closeModal('vendorModal');
    currentEditVendorId = null;
    document.getElementById('contactsSection').style.display = 'none';
    document.getElementById('catalogLinksSection').style.display = 'none';
}

// ==================== VENDOR CONTACTS ====================

let vendorContacts = [];

async function loadContacts(vendorId) {
    const list = document.getElementById('contactsList');
    list.innerHTML = '<span style="opacity:0.5;">Loading...</span>';
    try {
        const data = await api.request(`/procurement/vendor-contacts?vendorId=${vendorId}`, { _skipSpinner: true });
        vendorContacts = data.data || data || [];
        renderContacts();
    } catch (e) {
        list.innerHTML = '<span style="opacity:0.5;">Failed to load contacts</span>';
    }
}

function renderContacts() {
    const list = document.getElementById('contactsList');
    if (vendorContacts.length === 0) {
        list.innerHTML = '<span style="opacity:0.5;">No contacts yet</span>';
        return;
    }
    list.innerHTML = vendorContacts.map(c => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid color-mix(in srgb, currentColor 6%, transparent);">
            <div style="flex:1;min-width:0;">
                <span style="font-weight:600;">${escapeHtml(c.contact_name)}</span>
                ${c.is_primary ? '<span style="font-size:9px;background:rgba(16,185,129,0.15);color:var(--color-success);padding:1px 5px;border-radius:8px;margin-left:4px;">Primary</span>' : ''}
                ${c.designation ? `<span style="opacity:0.5;margin-left:4px;">${escapeHtml(c.designation)}</span>` : ''}
            </div>
            <span style="opacity:0.6;">${escapeHtml(c.email || '')}</span>
            <span style="opacity:0.6;">${escapeHtml(c.phone || '')}</span>
            <button type="button" onclick="deleteContact('${c.id}')" style="background:none;border:none;color:var(--color-danger);cursor:pointer;padding:2px 4px;" title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>
    `).join('');
}

function showAddContactForm() {
    document.getElementById('addContactForm').style.display = '';
    document.getElementById('newContactName').value = '';
    document.getElementById('newContactEmail').value = '';
    document.getElementById('newContactPhone').value = '';
    document.getElementById('newContactDesignation').value = '';
    document.getElementById('newContactPrimary').checked = false;
    document.getElementById('newContactName').focus();
}

function hideAddContactForm() {
    document.getElementById('addContactForm').style.display = 'none';
}

async function saveNewContact() {
    const name = document.getElementById('newContactName').value.trim();
    if (!name) { Toast.error('Contact name is required'); return; }

    try {
        await api.request('/procurement/vendor-contacts', {
            method: 'POST',
            body: JSON.stringify({
                vendor_id: currentEditVendorId,
                contact_name: name,
                email: document.getElementById('newContactEmail').value.trim() || null,
                phone: document.getElementById('newContactPhone').value.trim() || null,
                designation: document.getElementById('newContactDesignation').value.trim() || null,
                is_primary: document.getElementById('newContactPrimary').checked
            })
        });
        Toast.success('Contact added');
        hideAddContactForm();
        loadContacts(currentEditVendorId);
    } catch (e) {
        Toast.error(e.message || 'Failed to add contact');
    }
}

async function deleteContact(contactId) {
    const confirmed = await showConfirm('Delete this contact?', 'Delete Contact', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/procurement/vendor-contacts/${contactId}`, { method: 'DELETE' });
        Toast.success('Contact deleted');
        loadContacts(currentEditVendorId);
    } catch (e) {
        Toast.error(e.message || 'Failed to delete contact');
    }
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
        industry: document.getElementById('vendorIndustry')?.value.trim() || '',
        contact_person: document.getElementById('vendorContactPerson').value.trim(),
        email: document.getElementById('vendorEmail').value.trim(),
        phone: document.getElementById('vendorPhone').value.trim(),
        website: document.getElementById('vendorWebsite').value.trim(),
        address: document.getElementById('vendorAddress').value.trim(),
        city: document.getElementById('vendorCity').value.trim(),
        state: document.getElementById('vendorState').value.trim(),
        country: document.getElementById('vendorCountry').value.trim(),
        postal_code: document.getElementById('vendorPostalCode').value.trim(),
        payment_terms: document.getElementById('vendorPaymentTerms').value.trim(),
        gst_number: document.getElementById('vendorGstNumber').value.trim(),
        pan_number: document.getElementById('vendorPanNumber').value.trim(),
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
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
// master_item_id -> { price, notes, quoted_at } pulled from vendor_items.
// Captured here so the Selected pane can show the vendor's submission AND
// so the Save round-trip preserves price/notes for items the admin didn't
// touch (otherwise saving Manage Items would null out vendor's quotes).
let _vendorItemData = new Map();
let _itemScrollBound = false;
let _itemFilteredCache = [];
const ITEM_ROW_HEIGHT = 42;

async function openManageItemsModal(vendorId) {
    _manageItemsVendorId = vendorId;
    _selectedItemIds.clear();
    _vendorItemData.clear();
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

        // Pre-select vendor's existing items + capture price/notes so the
        // Selected pane can show the vendor's submission and Save can
        // round-trip them back without nulling existing quotes.
        const vendorItems = vendorItemsRes.data || vendorItemsRes || [];
        _selectedItemIds.clear();
        _vendorItemData.clear();
        vendorItems.forEach(vi => {
            _selectedItemIds.add(vi.master_item_id);
            _vendorItemData.set(vi.master_item_id, {
                price: vi.last_quoted_price ?? null,
                notes: vi.notes ?? null,
                quoted_at: vi.last_quoted_at ?? null
            });
        });

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
        const data = _vendorItemData.get(id) || {};
        const priceTxt = data.price != null ? `₹${Number(data.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
        const notesTxt = data.notes ? escapeHtml(data.notes) : '';
        const meta = [];
        if (priceTxt) meta.push(`<span style="color:var(--brand-primary); font-weight:600;" title="Vendor's last quoted price">${priceTxt}</span>`);
        if (notesTxt) meta.push(`<span style="color:var(--text-secondary);" title="Vendor's notes">${notesTxt}</span>`);
        const metaLine = meta.length ? `<div style="font-size:11px; margin-top:2px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">${meta.join('<span style=\"color:var(--text-secondary); opacity:0.5;\">·</span>')}</div>` : '';
        const catLine = cat ? `<div style="font-size:10px; color:var(--text-secondary);">${cat}</div>` : '';
        return `<div style="display:flex; align-items:flex-start; gap:8px; padding:7px 10px; border-bottom:1px solid var(--border-primary);">
            <div style="flex:1; min-width:0;">
                <div style="font-size:13px; font-weight:500; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
                ${catLine}
                ${metaLine}
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

    // Preserve vendor's submitted price/notes for items already in
    // vendor_items — the backend upsert would otherwise null them out.
    const items = Array.from(_selectedItemIds).map(id => {
        const data = _vendorItemData.get(id) || {};
        return { master_item_id: id, price: data.price ?? null, notes: data.notes ?? null };
    });

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

// ==================== VENDOR CATALOG LINKS ====================

async function loadCatalogLinks(vendorId) {
    const container = document.getElementById('catalogLinksList');
    container.innerHTML = '<span style="opacity:0.5;">Loading...</span>';
    try {
        const data = await api.request(`/procurement/vendor-catalog/links/${vendorId}`, { _skipSpinner: true });
        const links = data.data || data || [];
        if (links.length === 0) {
            container.innerHTML = '<span style="opacity:0.4;">No catalog links generated yet.</span>';
            return;
        }
        container.innerHTML = links.map(link => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.1);">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:500;">${escapeHtml(link.status || 'active')}</div>
                    <div style="opacity:0.5;font-size:11px;">
                        Expires: ${link.expires_at ? new Date(link.expires_at).toLocaleDateString() : 'Never'}
                        | Accessed: ${link.access_count || 0}x
                        ${link.submitted_at ? ' | Submitted' : ''}
                    </div>
                </div>
                <button onclick="revokeCatalogLink('${link.id}')" style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--color-error);background:none;color:var(--color-error);cursor:pointer;" title="Revoke">Revoke</button>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<span style="opacity:0.4;">Failed to load links.</span>';
    }
}

async function revokeCatalogLink(tokenId) {
    const confirmed = await showConfirm('Revoke this catalog link? The vendor will no longer be able to access it.', 'Revoke Link', 'danger');
    if (!confirmed) return;
    try {
        await api.request(`/procurement/vendor-catalog/links/${tokenId}`, { method: 'DELETE' });
        Toast.success('Catalog link revoked');
        if (currentEditVendorId) loadCatalogLinks(currentEditVendorId);
    } catch (e) {
        Toast.error(e.message || 'Failed to revoke link');
    }
}

// ==================== VENDOR INTELLIGENCE ====================

async function openVendorIntelligence(vendorId) {
    const modal = document.getElementById('vendorIntelModal');
    const body = document.getElementById('intelBody');
    body.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.5;">Loading intelligence...</div>';
    openModal('vendorIntelModal');

    try {
        const data = await api.request(`/procurement/vendor-intelligence/vendor/${vendorId}`);
        const profile = data.data || data;
        renderIntelligence(profile);
    } catch (e) {
        body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--color-error);">Failed to load intelligence: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }
}

function closeIntelModal() {
    closeModal('vendorIntelModal');
}

function renderIntelligence(profile) {
    const body = document.getElementById('intelBody');
    const vendor = profile.vendor || {};
    const perf = profile.performance_summary || {};
    const items = profile.item_history || [];
    const topItems = profile.top_items || [];
    const decisions = profile.recent_decisions || [];

    // Title
    document.getElementById('intelVendorName').textContent = vendor.vendor_name || 'Vendor';

    let html = '';

    // Performance Summary Cards
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:20px;">
        ${intelStatCard('Quality', formatScore(perf.avg_quality_score), 'var(--color-success)')}
        ${intelStatCard('Delivery Var.', perf.avg_delivery_variance != null ? (perf.avg_delivery_variance > 0 ? '+' : '') + perf.avg_delivery_variance.toFixed(1) + 'd' : '-', perf.avg_delivery_variance > 0 ? 'var(--color-warning)' : 'var(--color-success)')}
        ${intelStatCard('Total Orders', perf.total_orders || 0, 'var(--brand-primary)')}
        ${intelStatCard('Times Selected', perf.times_selected || 0, 'var(--brand-primary)')}
        ${intelStatCard('Avg Price Rank', perf.avg_price_rank ? '#' + perf.avg_price_rank.toFixed(1) : '-', 'var(--text-secondary)')}
    </div>`;

    // Top Items (ranked)
    if (topItems.length > 0) {
        html += `<div style="margin-bottom:20px;">
            <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">Top Items by Selection Rate</h4>
            <div style="border:1px solid var(--border-primary);border-radius:8px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:var(--bg-tertiary);">
                        <th style="padding:6px 10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Item</th>
                        <th style="padding:6px 10px;text-align:center;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Quoted</th>
                        <th style="padding:6px 10px;text-align:center;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Won</th>
                        <th style="padding:6px 10px;text-align:center;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Win Rate</th>
                        <th style="padding:6px 10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Last Price</th>
                    </tr></thead>
                    <tbody>
                        ${topItems.slice(0, 10).map(item => `<tr style="border-top:1px solid var(--border-primary);">
                            <td style="padding:6px 10px;font-weight:500;">${escapeHtml(item.item_name || '-')}</td>
                            <td style="padding:6px 10px;text-align:center;">${item.times_quoted || 0}</td>
                            <td style="padding:6px 10px;text-align:center;">${item.times_selected || 0}</td>
                            <td style="padding:6px 10px;text-align:center;">
                                <span style="padding:1px 6px;border-radius:10px;font-size:11px;font-weight:600;background:${getWinRateColor(item.selection_rate)};color:var(--text-inverse);">
                                    ${item.selection_rate != null ? (item.selection_rate * 100).toFixed(0) + '%' : '-'}
                                </span>
                            </td>
                            <td style="padding:6px 10px;text-align:right;">${item.last_quoted_price != null ? formatCurrency(item.last_quoted_price) : '-'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    // Recent Item History
    if (items.length > 0) {
        html += `<div style="margin-bottom:20px;">
            <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">Recent Quote History</h4>
            <div style="border:1px solid var(--border-primary);border-radius:8px;overflow:hidden;max-height:250px;overflow-y:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead style="position:sticky;top:0;"><tr style="background:var(--bg-tertiary);">
                        <th style="padding:6px 10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Item</th>
                        <th style="padding:6px 10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">RFQ</th>
                        <th style="padding:6px 10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Quoted Price</th>
                        <th style="padding:6px 10px;text-align:center;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Selected</th>
                        <th style="padding:6px 10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Date</th>
                    </tr></thead>
                    <tbody>
                        ${items.slice(0, 20).map(h => {
                            const rfqLabel = h.rfq_number != null
                                ? `<span style="font-weight:600;">#${h.rfq_number}</span>${h.rfq_title ? ` <span style="opacity:0.6;">${escapeHtml(h.rfq_title)}</span>` : ''}`
                                : '<span style="opacity:0.4;">—</span>';
                            return `<tr style="border-top:1px solid var(--border-primary);">
                                <td style="padding:5px 10px;">${escapeHtml(h.item_name || '-')}</td>
                                <td style="padding:5px 10px;font-size:11px;">${rfqLabel}</td>
                                <td style="padding:5px 10px;text-align:right;">${h.quoted_price != null ? formatCurrency(h.quoted_price) : '-'}</td>
                                <td style="padding:5px 10px;text-align:center;">${h.was_selected ? '<span style="color:var(--color-success);font-weight:600;">Yes</span>' : '<span style="opacity:0.4;">No</span>'}</td>
                                <td style="padding:5px 10px;text-align:right;opacity:0.6;">${formatIntelDate(h.created_at)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    // Recent Decisions
    if (decisions.length > 0) {
        html += `<div>
            <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">Recent Decisions</h4>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${decisions.slice(0, 10).map(d => {
                    // RFQ takes precedence; fall back to Inquiry context.
                    let ctx = '';
                    if (d.rfq_number != null) {
                        ctx = `<span style="font-weight:600;">RFQ #${d.rfq_number}</span>${d.rfq_title ? ` <span style="opacity:0.6;">${escapeHtml(d.rfq_title)}</span>` : ''}`;
                    } else if (d.inquiry_number != null) {
                        ctx = `<span style="font-weight:600;">Inquiry #${d.inquiry_number}</span>${d.inquiry_title ? ` <span style="opacity:0.6;">${escapeHtml(d.inquiry_title)}</span>` : ''}`;
                    }
                    return `
                    <div style="padding:8px 12px;border:1px solid var(--border-primary);border-radius:6px;font-size:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-weight:600;">${escapeHtml(d.decision_type || 'manual').replace(/_/g, ' ')}</span>
                            <span style="opacity:0.5;font-size:11px;" title="${escapeHtml(new Date(d.created_at).toLocaleString())}">${formatIntelDateTime(d.created_at)}</span>
                        </div>
                        ${ctx ? `<div style="margin-top:3px;font-size:11px;">${ctx}</div>` : ''}
                        ${d.reason ? `<div style="margin-top:3px;opacity:0.7;">${escapeHtml(d.reason)}</div>` : ''}
                        ${d.decided_by_name ? `<div style="margin-top:2px;opacity:0.4;font-size:11px;">by ${escapeHtml(d.decided_by_name)}</div>` : ''}
                    </div>
                    `;
                }).join('')}
            </div>
        </div>`;
    }

    if (!topItems.length && !items.length && !decisions.length) {
        html += '<div style="text-align:center;padding:30px;opacity:0.5;">No intelligence data available for this vendor yet.</div>';
    }

    body.innerHTML = html;
}

function intelStatCard(label, value, color) {
    return `<div style="padding:12px 14px;border:1px solid var(--border-primary);border-radius:8px;background:var(--bg-secondary);">
        <div style="font-size:18px;font-weight:700;color:${color};">${value}</div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${label}</div>
    </div>`;
}

function formatScore(score) {
    if (score == null || isNaN(score)) return '-';
    return parseFloat(score).toFixed(1);
}

function getWinRateColor(rate) {
    if (rate == null) return 'var(--text-secondary)';
    if (rate >= 0.7) return 'var(--color-success)';
    if (rate >= 0.4) return 'var(--color-warning)';
    return 'var(--color-error)';
}

function formatCurrency(amount) {
    if (amount == null) return '-';
    return parseFloat(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatIntelDate(dateStr) {
    if (!dateStr) return '-';
    try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return '-'; }
}

// Date + HH:MM so two decisions on the same day from the same vendor on
// the same RFQ are still visually distinguishable in the Recent Decisions
// list. Hover (title) shows the locale's full timestamp for precision.
function formatIntelDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${date} · ${time}`;
    } catch { return '-'; }
}
