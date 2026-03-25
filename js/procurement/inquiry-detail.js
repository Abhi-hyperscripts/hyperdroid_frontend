/**
 * Procurement Inquiry Detail
 * Handles inquiry detail view, items management, and RFQ creation.
 */

// ==================== State ====================
let currentInquiry = null;
let inquiryItems = [];
let currentEditItemId = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const inquiryId = params.get('id');
    if (!inquiryId) {
        Toast.error('No inquiry ID provided');
        window.location.href = 'inquiries.html';
        return;
    }

    loadInquiryDetail(inquiryId);
});

// ==================== Data Loading ====================

async function loadInquiryDetail(inquiryId) {
    try {
        const response = await api.request(`/procurement/inquiries/${inquiryId}`);
        currentInquiry = response.data || response;
        renderInquiryHeader();
        renderItems();
    } catch (error) {
        console.error('Failed to load inquiry:', error);
        Toast.error('Failed to load inquiry details');
    }
}

// ==================== Rendering ====================

function renderInquiryHeader() {
    if (!currentInquiry) return;

    const inq = currentInquiry;

    // Title and badges
    document.getElementById('inquiryTitle').textContent = inq.title || 'Untitled';
    document.getElementById('breadcrumbTitle').textContent = inq.inquiry_number || 'Detail';
    document.getElementById('inquiryStatusBadge').innerHTML = renderStatusBadge(inq.status);
    document.getElementById('inquiryPriorityBadge').innerHTML = renderPriorityBadge(inq.priority);

    // Metadata
    document.getElementById('metaInquiryNumber').textContent = inq.inquiry_number || '-';
    document.getElementById('metaClient').textContent = inq.client_name || '-';
    document.getElementById('metaProject').textContent = inq.project_name || '-';
    document.getElementById('metaDueDate').textContent = formatDate(inq.due_date);
    document.getElementById('metaCreatedBy').textContent = inq.created_by_name || inq.created_by || '-';

    // Description
    const descSection = document.getElementById('descriptionSection');
    if (inq.description) {
        descSection.style.display = 'block';
        document.getElementById('inquiryDescription').textContent = inq.description;
    } else {
        descSection.style.display = 'none';
    }

    // Header actions
    const actionsDiv = document.getElementById('headerActions');
    const items = inq.items || [];
    let actionsHtml = '';

    if (items.length > 0 && inq.status !== 'cancelled' && inq.status !== 'closed') {
        actionsHtml += `
            <button class="btn btn-primary btn-sm" onclick="createRFQ()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                Create RFQ
            </button>
        `;
    }

    actionsDiv.innerHTML = actionsHtml;

    // Update page title
    document.title = `${inq.inquiry_number || 'Inquiry'} - Procurement | Ragenaizer`;
}

function renderItems() {
    if (!currentInquiry) return;

    inquiryItems = currentInquiry.items || [];
    const tbody = document.getElementById('itemsTableBody');

    if (!inquiryItems || inquiryItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2z"/>
                        </svg>
                        <p>No items added yet</p>
                        <button class="btn btn-sm btn-primary" onclick="openAddItemModal()">Add your first item</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = inquiryItems.map(item => `
        <tr>
            <td>
                <div class="crm-cell-primary">
                    <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(item.item_name || '')}</div>
                </div>
            </td>
            <td><span style="color: var(--text-primary); font-weight: 600;">${item.quantity || 0}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(item.unit || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(item.description || '-')}</span></td>
            <td>
                <div class="crm-actions">
                    <button class="crm-action-btn" onclick="openEditItemModal('${item.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn action-delete" onclick="deleteInquiryItem('${item.id}')" title="Delete">
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

// ==================== Status/Priority Badges ====================

function renderStatusBadge(status) {
    if (!status) return '';
    const colorMap = {
        'draft': 'background: var(--bg-tertiary); color: var(--text-secondary);',
        'open': 'background: rgba(var(--brand-primary-rgb), 0.15); color: var(--brand-primary);',
        'in_progress': 'background: rgba(59, 130, 246, 0.15); color: var(--color-info);',
        'rfq_sent': 'background: rgba(139, 92, 246, 0.15); color: var(--color-purple);',
        'quoted': 'background: rgba(245, 158, 11, 0.15); color: var(--color-warning);',
        'closed': 'background: rgba(16, 185, 129, 0.15); color: var(--color-success);',
        'cancelled': 'background: rgba(239, 68, 68, 0.15); color: var(--color-error);'
    };
    const style = colorMap[status] || 'background: var(--bg-tertiary); color: var(--text-secondary);';
    const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<span class="status-badge" style="${style} padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">${label}</span>`;
}

function renderPriorityBadge(priority) {
    if (!priority) return '';
    const colorMap = {
        'low': 'background: rgba(16, 185, 129, 0.15); color: var(--color-success);',
        'medium': 'background: rgba(59, 130, 246, 0.15); color: var(--color-info);',
        'high': 'background: rgba(245, 158, 11, 0.15); color: var(--color-warning);',
        'urgent': 'background: rgba(239, 68, 68, 0.15); color: var(--color-error);'
    };
    const style = colorMap[priority] || 'background: var(--bg-tertiary); color: var(--text-secondary);';
    const label = priority.replace(/\b\w/g, c => c.toUpperCase());
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

function openAddItemModal() {
    currentEditItemId = null;
    document.getElementById('addItemModalTitle').textContent = 'Add Item';
    const submitBtn = document.getElementById('addItemSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="addItemSubmitSpinner" style="display:none;"></span> Add Item';
    document.getElementById('addItemForm').reset();
    document.getElementById('editItemId').value = '';
    openModal('addItemModal');
}

function openEditItemModal(itemId) {
    const item = inquiryItems.find(i => i.id === itemId);
    if (!item) {
        Toast.error('Item not found');
        return;
    }

    currentEditItemId = itemId;
    document.getElementById('addItemModalTitle').textContent = 'Edit Item';
    const submitBtn = document.getElementById('addItemSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="addItemSubmitSpinner" style="display:none;"></span> Update Item';
    document.getElementById('editItemId').value = itemId;
    document.getElementById('addItemName').value = item.item_name || '';
    document.getElementById('addItemQuantity').value = item.quantity || '';
    document.getElementById('addItemUnit').value = item.unit || '';
    document.getElementById('addItemDescription').value = item.description || '';
    openModal('addItemModal');
}

function closeAddItemModal() {
    closeModal('addItemModal');
    currentEditItemId = null;
}

// ==================== Item CRUD ====================

async function handleAddItemSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('addItemSubmitBtn');
    const spinner = document.getElementById('addItemSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        item_name: document.getElementById('addItemName').value.trim(),
        quantity: parseFloat(document.getElementById('addItemQuantity').value) || 0,
        unit: document.getElementById('addItemUnit').value.trim(),
        description: document.getElementById('addItemDescription').value.trim()
    };

    try {
        if (currentEditItemId) {
            // Update existing item
            formData.id = currentEditItemId;
            await api.request(`/procurement/inquiries/items/${currentEditItemId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Item updated');
        } else {
            // Add new item to inquiry
            await api.request(`/procurement/inquiries/${currentInquiry.id}/items`, {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Item added');
        }

        closeAddItemModal();
        // Reload inquiry to get updated items
        loadInquiryDetail(currentInquiry.id);
    } catch (error) {
        console.error('Failed to save item:', error);
        Toast.error(error.message || 'Failed to save item');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteInquiryItem(itemId) {
    const confirmed = await showConfirm('Are you sure you want to remove this item?', 'Remove Item', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/procurement/inquiries/items/${itemId}`, { method: 'DELETE' });
        Toast.success('Item removed');
        loadInquiryDetail(currentInquiry.id);
    } catch (error) {
        console.error('Failed to delete item:', error);
        Toast.error('Failed to remove item');
    }
}

// ==================== Create RFQ ====================

async function createRFQ() {
    if (!currentInquiry || !inquiryItems.length) {
        Toast.error('Add items before creating an RFQ');
        return;
    }

    const confirmed = await showConfirm(
        'This will create a Request for Quotation from this inquiry. Continue?',
        'Create RFQ',
        'primary'
    );
    if (!confirmed) return;

    try {
        const response = await api.request('/procurement/rfqs', {
            method: 'POST',
            body: JSON.stringify({
                inquiry_id: currentInquiry.id
            })
        });
        Toast.success('RFQ created successfully');
        // Reload to reflect status change
        loadInquiryDetail(currentInquiry.id);
    } catch (error) {
        console.error('Failed to create RFQ:', error);
        Toast.error(error.message || 'Failed to create RFQ');
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
