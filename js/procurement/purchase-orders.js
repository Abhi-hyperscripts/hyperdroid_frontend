/**
 * Procurement Purchase Orders Management
 * Handles listing, detail view, creation, approval, and status updates.
 */

// ==================== State ====================
let allPos = [];
let currentPo = null;
let poLineItems = [];
let allVendorsList = [];
let currentView = 'list';
let _poFiltered = [];
let _poCurrentPage = 1;
const PO_PAGE_SIZE = 20;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const fromComparison = params.get('fromComparison');

    if (hash && hash.startsWith('#detail/')) {
        const poId = hash.replace('#detail/', '');
        if (poId) {
            showDetailView(poId);
            return;
        }
    }

    loadPos();

    // Auto-create PO from comparison
    if (fromComparison) {
        createPoFromComparison(fromComparison);
    }

    // Convert filter dropdown to searchable
    setTimeout(() => {
        if (typeof convertSelectToSearchable === 'function') {
            convertSelectToSearchable('filterStatus', {
                placeholder: 'All Statuses',
                searchPlaceholder: 'Search status...',
                compact: true,
                onChange: () => applyFilters()
            });
        }
    }, 100);
});

window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#detail/')) {
        const poId = hash.replace('#detail/', '');
        if (poId) showDetailView(poId);
    } else {
        showListView();
    }
});

// ==================== Data Loading ====================

async function loadPos() {
    try {
        const response = await api.request('/procurement/purchase-orders');
        allPos = response.data || response || [];
        _poFiltered = allPos;
        renderPosTable(allPos);
    } catch (error) {
        console.error('Failed to load POs:', error);
        renderPosTable([]);
        Toast.error('Failed to load purchase orders');
    }
}

async function loadPoDetail(poId) {
    try {
        const response = await api.request(`/procurement/purchase-orders/${poId}`);
        currentPo = response.data || response;
        renderDetailHeader();
        renderLineItems();
    } catch (error) {
        console.error('Failed to load PO detail:', error);
        Toast.error('Failed to load purchase order details');
    }
}

async function loadVendorsForModal() {
    try {
        const response = await api.request('/procurement/vendors', { _skipSpinner: true });
        allVendorsList = response.data || response || [];
        const select = document.getElementById('poVendor');
        select.innerHTML = '<option value="">Select a vendor...</option>';
        allVendorsList.forEach(v => {
            select.innerHTML += `<option value="${v.id}">${escapeHtml(v.vendor_name || '')} ${v.vendor_code ? '(' + escapeHtml(v.vendor_code) + ')' : ''}</option>`;
        });
    } catch (error) {
        console.error('Failed to load vendors:', error);
    }
}

// ==================== View Switching ====================

function showListView() {
    currentView = 'list';
    document.getElementById('listView').style.display = '';
    document.getElementById('detailView').style.display = 'none';
    window.location.hash = '';
    document.title = 'Purchase Orders - Procurement | Ragenaizer';
    loadPos();
}

function showDetailView(poId) {
    currentView = 'detail';
    document.getElementById('listView').style.display = 'none';
    document.getElementById('detailView').style.display = '';
    if (!window.location.hash.includes(poId)) {
        window.location.hash = `detail/${poId}`;
    }
    loadPoDetail(poId);
}

// ==================== Filter Handling ====================

function applyFilters() {
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();
    const status = document.getElementById('filterStatus').value;

    let filtered = allPos;

    if (search) {
        filtered = filtered.filter(po => {
            const number = (po.po_number || '').toLowerCase();
            const title = (po.title || '').toLowerCase();
            const vendor = (po.vendor_name || '').toLowerCase();
            return number.includes(search) || title.includes(search) || vendor.includes(search);
        });
    }

    if (status) {
        filtered = filtered.filter(po => po.status === status);
    }

    _poFiltered = filtered;
    _poCurrentPage = 1;
    renderPosTable(filtered);
}

// ==================== Table Rendering ====================

function renderPosTable(pos) {
    const tbody = document.getElementById('posTableBody');

    if (!pos || pos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                            <rect x="9" y="3" width="6" height="4" rx="1"/>
                        </svg>
                        <p>No purchase orders found</p>
                        <button class="btn btn-sm btn-primary" onclick="openCreatePoModal()">Create your first PO</button>
                    </div>
                </td>
            </tr>
        `;
        poRenderPagination(0, 0);
        return;
    }

    const totalItems = pos.length;
    const totalPages = Math.ceil(totalItems / PO_PAGE_SIZE);
    if (_poCurrentPage > totalPages) _poCurrentPage = totalPages;
    const startIdx = (_poCurrentPage - 1) * PO_PAGE_SIZE;
    const pageItems = pos.slice(startIdx, startIdx + PO_PAGE_SIZE);

    tbody.innerHTML = pageItems.map(po => `
        <tr style="cursor: pointer;" onclick="showDetailView('${po.id}')">
            <td>
                <div style="color: var(--brand-primary); font-weight: 600;">${escapeHtml(po.po_number || '-')}</div>
            </td>
            <td>
                <div class="crm-cell-primary">
                    <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(po.title || 'Untitled')}</div>
                </div>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${escapeHtml(po.vendor_name || '-')}</span>
            </td>
            <td>
                <span style="color: var(--text-primary); font-weight: 600;">${formatCurrency(po.total_amount)}</span>
            </td>
            <td>${renderStatusBadge(po.status)}</td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${formatDate(po.created_at)}</span></td>
            <td>
                <div class="crm-actions">
                    <button class="crm-action-btn" onclick="event.stopPropagation(); showDetailView('${po.id}')" title="View">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    poRenderPagination(totalItems, totalPages);
}

function renderDetailHeader() {
    if (!currentPo) return;
    const po = currentPo;

    document.getElementById('detailTitle').textContent = po.title || 'Untitled PO';
    document.getElementById('breadcrumbPoNumber').textContent = po.po_number || 'Detail';
    document.getElementById('detailStatusBadge').innerHTML = renderStatusBadge(po.status);
    document.getElementById('metaPoNumber').textContent = po.po_number || '-';
    document.getElementById('metaVendor').textContent = po.vendor_name || '-';
    document.getElementById('metaTotal').textContent = formatCurrency(po.total_amount);
    document.getElementById('metaCreated').textContent = formatDate(po.created_at);
    document.getElementById('metaDelivery').textContent = formatDate(po.expected_delivery_date || po.delivery_date);

    const notesSection = document.getElementById('poNotesSection');
    if (po.notes) {
        notesSection.style.display = 'block';
        document.getElementById('detailNotes').textContent = po.notes;
    } else {
        notesSection.style.display = 'none';
    }

    // Actions
    const actionsDiv = document.getElementById('detailActions');
    let actionsHtml = '';

    if (po.status === 'draft') {
        actionsHtml += `
            <button class="btn btn-primary btn-sm" onclick="approvePo()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Approve
            </button>
        `;
    }

    if (po.status !== 'closed' && po.status !== 'cancelled') {
        actionsHtml += `
            <button class="btn btn-secondary btn-sm" onclick="openStatusModal()">
                Update Status
            </button>
        `;
    }

    actionsDiv.innerHTML = actionsHtml;

    document.title = `${po.po_number || 'PO'} - Procurement | Ragenaizer`;
}

function renderLineItems() {
    if (!currentPo) return;
    poLineItems = currentPo.line_items || currentPo.items || [];
    const tbody = document.getElementById('lineItemsTableBody');

    if (!poLineItems || poLineItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="crm-empty-state">
                    <div class="crm-empty-content"><p>No line items</p></div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = poLineItems.map(item => {
        const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
        return `
            <tr>
                <td>
                    <div class="crm-cell-primary">
                        <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(item.item_name || '')}</div>
                        ${item.specifications ? `<div class="crm-cell-secondary">${escapeHtml(item.specifications)}</div>` : ''}
                    </div>
                </td>
                <td><span style="color: var(--text-primary); font-weight: 600;">${item.quantity || 0}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(item.unit || '-')}</span></td>
                <td><span style="color: var(--text-primary);">${formatCurrency(item.unit_price)}</span></td>
                <td><span style="color: var(--text-primary); font-weight: 600;">${formatCurrency(lineTotal)}</span></td>
            </tr>
        `;
    }).join('');

    // Add total row
    const total = poLineItems.reduce((sum, item) => sum + ((item.quantity || 0) * (item.unit_price || 0)), 0);
    tbody.innerHTML += `
        <tr style="border-top: 2px solid var(--border-primary);">
            <td colspan="4" style="text-align: right; font-weight: 700; color: var(--text-primary);">Grand Total</td>
            <td><span style="color: var(--text-primary); font-weight: 700; font-size: 15px;">${formatCurrency(total)}</span></td>
        </tr>
    `;
}

// ==================== Status Badges ====================

function renderStatusBadge(status) {
    if (!status) return '';
    const colorMap = {
        'draft': 'background: var(--bg-tertiary); color: var(--text-secondary);',
        'approved': 'background: rgba(59, 130, 246, 0.15); color: var(--color-info);',
        'sent': 'background: rgba(139, 92, 246, 0.15); color: var(--color-purple, #8b5cf6);',
        'acknowledged': 'background: rgba(245, 158, 11, 0.15); color: var(--color-warning);',
        'partially_received': 'background: rgba(245, 158, 11, 0.15); color: var(--color-warning);',
        'received': 'background: rgba(16, 185, 129, 0.15); color: var(--color-success);',
        'closed': 'background: rgba(16, 185, 129, 0.15); color: var(--color-success);',
        'cancelled': 'background: rgba(239, 68, 68, 0.15); color: var(--color-error);'
    };
    const style = colorMap[status] || 'background: var(--bg-tertiary); color: var(--text-secondary);';
    const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<span class="status-badge" style="${style} padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">${label}</span>`;
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

function openCreatePoModal() {
    document.getElementById('createPoForm').reset();
    loadVendorsForModal();
    openModal('createPoModal');
}

function closeCreatePoModal() {
    closeModal('createPoModal');
}

function openStatusModal() {
    document.getElementById('statusForm').reset();
    openModal('statusModal');
}

function closeStatusModal() {
    closeModal('statusModal');
}

// ==================== CRUD Operations ====================

async function handleCreatePo(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('createPoSubmitBtn');
    const spinner = document.getElementById('createPoSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        vendor_id: document.getElementById('poVendor').value,
        title: document.getElementById('poTitle').value.trim(),
        expected_delivery_date: document.getElementById('poDeliveryDate').value || null,
        payment_terms: document.getElementById('poPaymentTerms').value.trim(),
        notes: document.getElementById('poNotes').value.trim()
    };

    try {
        const response = await api.request('/procurement/purchase-orders', {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        Toast.success('Purchase order created');
        closeCreatePoModal();
        const newPo = response.data || response;
        if (newPo && newPo.id) {
            showDetailView(newPo.id);
        } else {
            loadPos();
        }
    } catch (error) {
        console.error('Failed to create PO:', error);
        Toast.error(error.message || 'Failed to create purchase order');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function createPoFromComparison(comparisonId) {
    try {
        const response = await api.request('/procurement/purchase-orders/from-comparison', {
            method: 'POST',
            body: JSON.stringify({ comparison_id: comparisonId })
        });
        Toast.success('Purchase order created from comparison');
        const newPo = response.data || response;
        if (newPo && newPo.id) {
            showDetailView(newPo.id);
        } else {
            loadPos();
        }
    } catch (error) {
        console.error('Failed to create PO from comparison:', error);
        Toast.error(error.message || 'Failed to create purchase order');
        loadPos();
    }
}

async function approvePo() {
    if (!currentPo) return;

    const confirmed = await showConfirm(
        'Approve this purchase order? This will change the status to Approved.',
        'Approve PO',
        'primary'
    );
    if (!confirmed) return;

    try {
        await api.request(`/procurement/purchase-orders/${currentPo.id}/approve`, { method: 'POST' });
        Toast.success('Purchase order approved');
        loadPoDetail(currentPo.id);
    } catch (error) {
        console.error('Failed to approve PO:', error);
        Toast.error(error.message || 'Failed to approve purchase order');
    }
}

async function handleStatusUpdate(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('statusSubmitBtn');
    const spinner = document.getElementById('statusSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const newStatus = document.getElementById('newStatus').value;

    try {
        await api.request(`/procurement/purchase-orders/${currentPo.id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        Toast.success('Status updated');
        closeStatusModal();
        loadPoDetail(currentPo.id);
    } catch (error) {
        console.error('Failed to update status:', error);
        Toast.error(error.message || 'Failed to update status');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== Utilities ====================

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '-';
    return parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

// ==================== Pagination ====================

function poGoToPage(page) {
    const totalPages = Math.ceil(_poFiltered.length / PO_PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    _poCurrentPage = page;
    renderPosTable(_poFiltered);
    const table = document.getElementById('posTableBody')?.closest('table');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function poRenderPagination(totalItems, totalPages) {
    let container = document.getElementById('posPagination');
    if (!container) {
        container = document.createElement('div');
        container.id = 'posPagination';
        const table = document.getElementById('posTableBody')?.closest('table');
        if (table) table.parentNode.insertBefore(container, table.nextSibling);
    }
    if (totalPages <= 1) {
        container.innerHTML = totalItems > 0
            ? `<div style="padding:10px 0; text-align:center; font-size:12px; color:var(--text-secondary);">${totalItems} record${totalItems !== 1 ? 's' : ''}</div>`
            : '';
        return;
    }
    const startItem = (_poCurrentPage - 1) * PO_PAGE_SIZE + 1;
    const endItem = Math.min(_poCurrentPage * PO_PAGE_SIZE, totalItems);
    let pages = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else {
        pages.push(1);
        if (_poCurrentPage > 3) pages.push('...');
        const start = Math.max(2, _poCurrentPage - 1);
        const end = Math.min(totalPages - 1, _poCurrentPage + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (_poCurrentPage < totalPages - 2) pages.push('...');
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
                <button onclick="poGoToPage(${_poCurrentPage - 1})" style="${_poCurrentPage === 1 ? disabledNavStyle : navStyle}" ${_poCurrentPage === 1 ? 'disabled' : ''}>&lsaquo; Prev</button>
                ${pages.map(p => p === '...' ? '<span style="padding:4px 4px; font-size:13px; color:var(--text-secondary);">…</span>' : `<button onclick="poGoToPage(${p})" style="${p === _poCurrentPage ? activeBtnStyle : btnStyle}">${p}</button>`).join('')}
                <button onclick="poGoToPage(${_poCurrentPage + 1})" style="${_poCurrentPage === totalPages ? disabledNavStyle : navStyle}" ${_poCurrentPage === totalPages ? 'disabled' : ''}>Next &rsaquo;</button>
            </div>
        </div>`;
}
