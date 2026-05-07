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
        renderVendorPerformanceSection();
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

    if (po.status === 'draft' || po.status === 'approved') {
        actionsHtml += `
            <button class="btn btn-secondary btn-sm" onclick="openEditPoModal()">
                Edit
            </button>
        `;
    }

    if (po.status !== 'closed' && po.status !== 'cancelled') {
        actionsHtml += `
            <button class="btn btn-secondary btn-sm" onclick="openStatusModal()">
                Update Status
            </button>
            <button class="btn btn-sm" onclick="openCancelPoModal()" style="background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);">
                Cancel PO
            </button>
        `;
    }

    if (po.status === 'draft') {
        actionsHtml += `
            <button class="btn btn-sm" onclick="deletePo()" style="background: none; color: #ef4444; border: none; padding: 4px 8px;" title="Delete PO">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        `;
    }

    actionsDiv.innerHTML = actionsHtml;

    // Show cancellation info banner for cancelled POs
    let cancelBanner = document.getElementById('cancelInfoBanner');
    if (!cancelBanner) {
        cancelBanner = document.createElement('div');
        cancelBanner.id = 'cancelInfoBanner';
        const metaSection = document.getElementById('metaPoNumber')?.parentElement?.parentElement;
        if (metaSection) metaSection.parentNode.insertBefore(cancelBanner, metaSection);
    }
    if (po.status === 'cancelled' && po.cancelled_reason) {
        cancelBanner.style.display = '';
        cancelBanner.style.cssText = 'padding:12px 16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;margin-bottom:16px;';
        cancelBanner.innerHTML = `
            <div style="font-size:12px;font-weight:700;color:#ef4444;margin-bottom:4px;">Cancelled${po.cancelled_at ? ' on ' + formatDate(po.cancelled_at) : ''}</div>
            <div style="font-size:13px;color:inherit;">Reason: ${escapeHtml(po.cancelled_reason)}</div>
        `;
    } else {
        cancelBanner.style.display = 'none';
    }

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

// Mirrors AllowedTransitions in BusinessLayer_PurchaseOrders.cs. The
// "approved" leg lives behind the Approve button (separate endpoint) and
// "cancelled" lives behind Cancel PO (mandatory reason), so neither shows
// up in this dropdown — only forward fulfilment moves do.
const PO_STATUS_TRANSITIONS = {
    'draft':              [],
    'approved':           ['sent'],
    'sent':               ['acknowledged', 'partially_received', 'received'],
    'acknowledged':       ['partially_received', 'received'],
    'partially_received': ['received'],
    'received':           ['closed'],
    'closed':             [],
    'cancelled':          []
};

const PO_STATUS_LABELS = {
    'sent':               'Sent',
    'acknowledged':       'Acknowledged',
    'partially_received': 'Partially Received',
    'received':           'Received',
    'closed':             'Closed'
};

function openStatusModal() {
    document.getElementById('statusForm').reset();

    const allowed = PO_STATUS_TRANSITIONS[currentPo?.status] || [];
    const select = document.getElementById('newStatus');
    const wrap = document.getElementById('statusSelectWrap');
    const notice = document.getElementById('statusTerminalNotice');
    const submitBtn = document.getElementById('statusSubmitBtn');

    // Rebuild options from scratch — the auto-searchable observer notices
    // the childList change and re-renders the SearchableDropdown with the
    // gated set, so a closed PO can't show "Sent" in the picker.
    select.innerHTML = '';
    allowed.forEach(value => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = PO_STATUS_LABELS[value] || value;
        select.appendChild(opt);
    });

    if (allowed.length === 0) {
        // Terminal state — hide the picker AND the submit button so the
        // dialog reads as informational only. Cancel becomes the only
        // action besides closing the modal.
        wrap.style.display = 'none';
        notice.style.display = '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.display = 'none'; }
    } else {
        wrap.style.display = '';
        notice.style.display = 'none';
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.display = ''; }
        select.value = allowed[0];
    }

    openModal('statusModal');
}

function closeStatusModal() {
    closeModal('statusModal');
}

function openCancelPoModal() {
    document.getElementById('cancelPoForm').reset();
    openModal('cancelPoModal');
}

function closeCancelPoModal() {
    closeModal('cancelPoModal');
}

async function handleCancelPo(event) {
    event.preventDefault();
    const reason = document.getElementById('cancelReason').value.trim();
    if (!reason) { Toast.error('Cancellation reason is required'); return; }

    const submitBtn = document.getElementById('cancelPoSubmitBtn');
    const spinner = document.getElementById('cancelPoSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    try {
        await api.request(`/procurement/purchase-orders/${currentPo.id}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
        Toast.success('Purchase order cancelled');
        closeCancelPoModal();
        loadPoDetail(currentPo.id);
    } catch (error) {
        console.error('Failed to cancel PO:', error);
        Toast.error(error.message || 'Failed to cancel purchase order');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== EDIT & DELETE PO ====================

function openEditPoModal() {
    if (!currentPo) return;
    document.getElementById('editPoTitle').value = currentPo.title || '';
    document.getElementById('editPoDeliveryDate').value = currentPo.delivery_date ? new Date(currentPo.delivery_date).toISOString().split('T')[0] : '';
    document.getElementById('editPoPaymentTerms').value = currentPo.payment_terms || '';
    document.getElementById('editPoShippingAddress').value = currentPo.shipping_address || '';
    document.getElementById('editPoNotes').value = currentPo.notes || '';
    openModal('editPoModal');
}

function closeEditPoModal() {
    closeModal('editPoModal');
}

async function handleEditPo(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('editPoSubmitBtn');
    submitBtn.disabled = true;

    try {
        await api.request('/procurement/purchase-orders', {
            method: 'PUT',
            body: JSON.stringify({
                id: currentPo.id,
                title: document.getElementById('editPoTitle').value.trim() || null,
                delivery_date: document.getElementById('editPoDeliveryDate').value || null,
                payment_terms: document.getElementById('editPoPaymentTerms').value.trim() || null,
                shipping_address: document.getElementById('editPoShippingAddress').value.trim() || null,
                notes: document.getElementById('editPoNotes').value.trim() || null
            })
        });
        Toast.success('Purchase order updated');
        closeEditPoModal();
        loadPoDetail(currentPo.id);
    } catch (e) {
        Toast.error(e.message || 'Failed to update purchase order');
    } finally {
        submitBtn.disabled = false;
    }
}

async function deletePo() {
    if (!currentPo) return;
    const confirmed = await showConfirm('Delete this draft purchase order? This cannot be undone.', 'Delete PO', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/procurement/purchase-orders/${currentPo.id}`, { method: 'DELETE' });
        Toast.success('Purchase order deleted');
        window.location.href = 'purchase-orders.html';
    } catch (e) {
        Toast.error(e.message || 'Failed to delete purchase order');
    }
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

// ==================== Vendor Performance ====================

let _currentRating = 0;

function renderVendorPerformanceSection() {
    const section = document.getElementById('vendorPerformanceSection');
    if (!currentPo || !currentPo.vendor_id) {
        if (section) section.style.display = 'none';
        return;
    }

    // Show section for approved/sent/acknowledged/received/closed POs
    const showStatuses = ['approved', 'sent', 'acknowledged', 'partially_received', 'received', 'closed'];
    if (!showStatuses.includes(currentPo.status)) {
        if (section) section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Render action buttons
    const btnsDiv = document.getElementById('perfActionButtons');
    const canRecord = currentPo.status !== 'closed' && currentPo.status !== 'cancelled';
    btnsDiv.innerHTML = canRecord ? `
        <button class="btn btn-sm" onclick="openDeliveryModal()" style="background: rgba(59,130,246,0.1); color: var(--brand-primary); border: 1px solid rgba(59,130,246,0.2); border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            Record Delivery
        </button>
        <button class="btn btn-sm" onclick="openGoodsReceiptModal()" style="background: rgba(16,185,129,0.1); color: var(--color-success); border: 1px solid rgba(16,185,129,0.2); border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>
            Goods Receipt
        </button>
        <button class="btn btn-sm" onclick="openRateQualityModal()" style="background: rgba(245,158,11,0.1); color: var(--color-warning); border: 1px solid rgba(245,158,11,0.2); border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Rate Quality
        </button>
    ` : '';

    loadVendorPerformanceData();
}

async function loadVendorPerformanceData() {
    if (!currentPo || !currentPo.vendor_id) return;

    try {
        const [perfData, summaryData] = await Promise.allSettled([
            api.request(`/procurement/vendor-performance/vendor/${currentPo.vendor_id}`, { _skipSpinner: true }),
            api.request(`/procurement/vendor-performance/vendor/${currentPo.vendor_id}/summary`, { _skipSpinner: true })
        ]);

        const records = perfData.status === 'fulfilled' ? (perfData.value.data || perfData.value || []) : [];
        const summary = summaryData.status === 'fulfilled' ? (summaryData.value.data || summaryData.value || null) : null;

        renderPerfSummaryCards(summary, records);
        renderPerfHistory(records);
    } catch (error) {
        console.error('Failed to load vendor performance:', error);
    }
}

function renderPerfSummaryCards(summary, records) {
    const container = document.getElementById('perfSummaryCards');

    // Calculate metrics from records if no summary
    const deliveryRecords = records.filter(r => r.promised_delivery_days != null && r.actual_delivery_days != null);
    const qualityRecords = records.filter(r => r.quality_score != null);
    const receiptRecords = records.filter(r => r.items_ordered != null);

    const avgDeliveryDays = deliveryRecords.length > 0
        ? (deliveryRecords.reduce((s, r) => s + (r.actual_delivery_days - r.promised_delivery_days), 0) / deliveryRecords.length)
        : null;

    const avgQuality = summary?.avg_quality_score
        || (qualityRecords.length > 0 ? qualityRecords.reduce((s, r) => s + r.quality_score, 0) / qualityRecords.length : null);

    const avgRejection = receiptRecords.length > 0
        ? (receiptRecords.reduce((s, r) => s + (r.items_rejected || 0), 0) / receiptRecords.reduce((s, r) => s + (r.items_ordered || 0), 0) * 100)
        : null;

    const totalRecords = records.length;

    const cardClass = `glass-card`;
    const cardStyle = `padding: 16px 20px;`;
    const labelStyle = `font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;`;
    const valueStyle = `font-size: 22px; font-weight: 700;`;

    let deliveryColor = 'var(--text-secondary)';
    let deliveryText = 'No data';
    if (avgDeliveryDays !== null) {
        if (avgDeliveryDays <= 0) { deliveryColor = 'var(--color-success)'; deliveryText = avgDeliveryDays === 0 ? 'On time' : `${Math.abs(avgDeliveryDays).toFixed(0)}d early`; }
        else { deliveryColor = 'var(--color-error)'; deliveryText = `${avgDeliveryDays.toFixed(0)}d late`; }
    }

    let qualityColor = 'var(--text-secondary)';
    let qualityText = 'No rating';
    if (avgQuality !== null) {
        qualityColor = avgQuality >= 4 ? 'var(--color-success)' : avgQuality >= 3 ? 'var(--color-warning)' : 'var(--color-error)';
        qualityText = `${avgQuality.toFixed(1)} / 5`;
    }

    let rejectionColor = 'var(--text-secondary)';
    let rejectionText = 'No data';
    if (avgRejection !== null) {
        rejectionColor = avgRejection <= 2 ? 'var(--color-success)' : avgRejection <= 5 ? 'var(--color-warning)' : 'var(--color-error)';
        rejectionText = `${avgRejection.toFixed(1)}%`;
    }

    container.innerHTML = `
        <div class="${cardClass}" style="${cardStyle}">
            <div style="${labelStyle}">Delivery</div>
            <div style="${valueStyle} color: ${deliveryColor};">${deliveryText}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${deliveryRecords.length} record${deliveryRecords.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="${cardClass}" style="${cardStyle}">
            <div style="${labelStyle}">Quality Rating</div>
            <div style="${valueStyle} color: ${qualityColor};">${qualityText}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${qualityRecords.length} rating${qualityRecords.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="${cardClass}" style="${cardStyle}">
            <div style="${labelStyle}">Rejection Rate</div>
            <div style="${valueStyle} color: ${rejectionColor};">${rejectionText}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${receiptRecords.length} receipt${receiptRecords.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="${cardClass}" style="${cardStyle}">
            <div style="${labelStyle}">Total Records</div>
            <div style="${valueStyle} color: var(--text-primary);">${totalRecords}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">for this vendor</div>
        </div>
    `;
}

function renderPerfHistory(records) {
    const section = document.getElementById('perfHistorySection');
    const tbody = document.getElementById('perfHistoryBody');
    if (!records || records.length === 0) {
        section.style.display = 'none';
        return;
    }

    // Filter out rfq_response records — they have no displayable performance data
    const displayRecords = records.filter(r =>
        r.source !== 'rfq_response' &&
        (r.promised_delivery_days != null || r.items_ordered != null || r.quality_score != null)
    );

    if (displayRecords.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    tbody.innerHTML = displayRecords.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(r => {
        let type = 'Record';
        let details = '-';
        let score = '-';

        if (r.promised_delivery_days != null) {
            type = 'Delivery';
            const diff = (r.actual_delivery_days || 0) - r.promised_delivery_days;
            details = `Promised: ${r.promised_delivery_days}d, Actual: ${r.actual_delivery_days}d`;
            score = diff <= 0
                ? `<span style="color: var(--color-success);">${diff === 0 ? 'On time' : Math.abs(diff) + 'd early'}</span>`
                : `<span style="color: var(--color-error);">${diff}d late</span>`;
        } else if (r.items_ordered != null) {
            type = 'Goods Receipt';
            const accepted = (r.items_ordered || 0) - (r.items_rejected || 0);
            details = `Ordered: ${r.items_ordered}, Rejected: ${r.items_rejected || 0}`;
            const rate = r.items_ordered > 0 ? ((accepted / r.items_ordered) * 100).toFixed(0) : 100;
            const color = rate >= 98 ? 'var(--color-success)' : rate >= 95 ? 'var(--color-warning)' : 'var(--color-error)';
            score = `<span style="color: ${color};">${rate}% accepted</span>`;
        } else if (r.quality_score != null) {
            type = 'Quality Rating';
            details = `Score: ${r.quality_score}/5`;
            const stars = '&#9733;'.repeat(Math.round(r.quality_score)) + '&#9734;'.repeat(5 - Math.round(r.quality_score));
            score = `<span style="color: var(--color-warning);">${stars}</span>`;
        }

        const typeBadge = {
            'Delivery': 'background: rgba(59,130,246,0.1); color: var(--brand-primary);',
            'Goods Receipt': 'background: rgba(16,185,129,0.1); color: var(--color-success);',
            'Quality Rating': 'background: rgba(245,158,11,0.1); color: var(--color-warning);'
        }[type] || 'background: var(--bg-tertiary); color: var(--text-secondary);';

        return `<tr>
            <td><span style="${typeBadge} padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;">${type}</span></td>
            <td style="color: var(--text-primary); font-size: 13px;">${details}</td>
            <td class="hide-mobile">${score}</td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(r.notes || '-')}</span></td>
            <td><span class="crm-cell-secondary">${formatDate(r.created_at)}</span></td>
        </tr>`;
    }).join('');
}

// --- Delivery Modal ---

function openDeliveryModal() {
    document.getElementById('deliveryForm').reset();
    document.getElementById('deliveryVariance').textContent = '-';
    document.getElementById('deliveryVariance').style.color = 'var(--color-success)';
    openModal('deliveryModal');
}

// Live variance calculation
document.addEventListener('DOMContentLoaded', () => {
    const promisedInput = document.getElementById('promisedDays');
    const actualInput = document.getElementById('actualDays');
    if (promisedInput && actualInput) {
        const updateVariance = () => {
            const promised = parseInt(promisedInput.value) || 0;
            const actual = parseInt(actualInput.value) || 0;
            const el = document.getElementById('deliveryVariance');
            if (!promised || !actual) { el.textContent = '-'; el.style.color = 'var(--text-secondary)'; return; }
            const diff = actual - promised;
            if (diff <= 0) {
                el.textContent = diff === 0 ? 'On time' : `${Math.abs(diff)} day${Math.abs(diff) > 1 ? 's' : ''} early`;
                el.style.color = 'var(--color-success)';
            } else {
                el.textContent = `${diff} day${diff > 1 ? 's' : ''} late`;
                el.style.color = 'var(--color-error)';
            }
        };
        promisedInput.addEventListener('input', updateVariance);
        actualInput.addEventListener('input', updateVariance);
    }

    // Goods receipt acceptance rate calculation
    const orderedInput = document.getElementById('itemsOrdered');
    const rejectedInput = document.getElementById('itemsRejected');
    if (orderedInput && rejectedInput) {
        const updateRate = () => {
            const ordered = parseInt(orderedInput.value) || 0;
            const rejected = parseInt(rejectedInput.value) || 0;
            const el = document.getElementById('acceptanceRate');
            if (!ordered) { el.textContent = '-'; el.style.color = 'var(--text-secondary)'; return; }
            const rate = ((ordered - rejected) / ordered * 100);
            el.textContent = rate.toFixed(1) + '%';
            el.style.color = rate >= 98 ? 'var(--color-success)' : rate >= 95 ? 'var(--color-warning)' : 'var(--color-error)';
        };
        orderedInput.addEventListener('input', updateRate);
        rejectedInput.addEventListener('input', updateRate);
    }
});

async function handleRecordDelivery(event) {
    event.preventDefault();
    const btn = document.getElementById('deliverySubmitBtn');
    const spinner = document.getElementById('deliverySpinner');
    btn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    try {
        await api.request('/procurement/vendor-performance/delivery', {
            method: 'POST',
            body: JSON.stringify({
                po_id: currentPo.id,
                vendor_id: currentPo.vendor_id,
                promised_days: parseInt(document.getElementById('promisedDays').value),
                actual_days: parseInt(document.getElementById('actualDays').value)
            })
        });
        Toast.success('Delivery recorded');
        closeModal('deliveryModal');
        loadVendorPerformanceData();
    } catch (error) {
        console.error('Failed to record delivery:', error);
        Toast.error(error.message || 'Failed to record delivery');
    } finally {
        btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// --- Goods Receipt Modal ---

function openGoodsReceiptModal() {
    document.getElementById('goodsReceiptForm').reset();
    // Auto-fill items ordered from line items count
    const totalItems = (currentPo.line_items || currentPo.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
    document.getElementById('itemsOrdered').value = totalItems;
    document.getElementById('itemsRejected').value = 0;
    document.getElementById('acceptanceRate').textContent = '100%';
    document.getElementById('acceptanceRate').style.color = 'var(--color-success)';
    openModal('goodsReceiptModal');
}

async function handleRecordGoodsReceipt(event) {
    event.preventDefault();
    const btn = document.getElementById('grSubmitBtn');
    const spinner = document.getElementById('grSpinner');
    btn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    try {
        await api.request('/procurement/vendor-performance/goods-receipt', {
            method: 'POST',
            body: JSON.stringify({
                po_id: currentPo.id,
                vendor_id: currentPo.vendor_id,
                items_ordered: parseInt(document.getElementById('itemsOrdered').value),
                items_rejected: parseInt(document.getElementById('itemsRejected').value) || 0,
                notes: document.getElementById('grNotes').value || null
            })
        });
        Toast.success('Goods receipt recorded');
        closeModal('goodsReceiptModal');
        loadVendorPerformanceData();
    } catch (error) {
        console.error('Failed to record goods receipt:', error);
        Toast.error(error.message || 'Failed to record goods receipt');
    } finally {
        btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// --- Rate Quality Modal ---

function openRateQualityModal() {
    document.getElementById('rateQualityForm').reset();
    _currentRating = 0;
    document.getElementById('qualityScore').value = 0;
    updateStarDisplay(0);
    document.getElementById('ratingLabel').textContent = 'Click a star to rate';
    openModal('rateQualityModal');
}

function setRating(stars) {
    _currentRating = stars;
    document.getElementById('qualityScore').value = stars;
    updateStarDisplay(stars);
    const labels = ['', 'Poor', 'Below Average', 'Average', 'Good', 'Excellent'];
    document.getElementById('ratingLabel').textContent = `${labels[stars]} (${stars}/5)`;
}

function updateStarDisplay(rating) {
    const buttons = document.querySelectorAll('#starRating .star-btn');
    buttons.forEach((btn, i) => {
        const svg = btn.querySelector('svg polygon');
        if (i < rating) {
            svg.setAttribute('fill', '#f59e0b');
            svg.setAttribute('stroke', '#f59e0b');
        } else {
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'var(--text-secondary)');
        }
    });
}

async function handleRateQuality(event) {
    event.preventDefault();
    if (_currentRating === 0) {
        Toast.error('Please select a rating');
        return;
    }

    const btn = document.getElementById('rateSubmitBtn');
    const spinner = document.getElementById('rateSpinner');
    btn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    try {
        await api.request('/procurement/vendor-performance/rating', {
            method: 'POST',
            body: JSON.stringify({
                vendor_id: currentPo.vendor_id,
                quality_score: _currentRating,
                notes: document.getElementById('ratingNotes').value || null
            })
        });
        Toast.success('Quality rating submitted');
        closeModal('rateQualityModal');
        loadVendorPerformanceData();
    } catch (error) {
        console.error('Failed to submit rating:', error);
        Toast.error(error.message || 'Failed to submit rating');
    } finally {
        btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
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
