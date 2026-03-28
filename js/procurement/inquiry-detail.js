/**
 * Procurement Inquiry Detail
 * Handles inquiry detail view, items management, and RFQ creation.
 */

// ==================== State ====================
let currentInquiry = null;
let inquiryItems = [];
let currentEditItemId = null;
let aiAvailable = false;
let allMasterItems = [];
let _addItemDropdown = null;

async function checkAIAvailability() {
    try {
        const resp = await api.request('/procurement/procurement-ai/status', { _skipSpinner: true });
        aiAvailable = resp.ai_available === true;
    } catch {
        aiAvailable = false;
    }
}

async function loadMasterItemsForDropdown() {
    try {
        const response = await api.request('/procurement/master-items', { _skipSpinner: true });
        allMasterItems = response.data || response || [];

        // Populate the native select
        const select = document.getElementById('addItemName');
        if (select) {
            select.innerHTML = '<option value="">Choose an item...</option>';
            allMasterItems.forEach(item => {
                const label = `${item.item_name}${item.item_code ? ' (' + item.item_code + ')' : ''}${item.category_name ? ' — ' + item.category_name : ''}`;
                select.innerHTML += `<option value="${item.item_name}" data-id="${item.id}" data-unit="${item.unit || ''}" data-desc="${escapeHtml(item.description || '')}">${escapeHtml(label)}</option>`;
            });
        }
    } catch (error) {
        console.error('Failed to load master items:', error);
    }
}

function _ensureAddItemDropdown() {
    if (!_addItemDropdown && typeof convertSelectToSearchable === 'function') {
        _addItemDropdown = convertSelectToSearchable('addItemName', {
            placeholder: 'Search items...',
            searchPlaceholder: 'Type item name or code...',
            onChange: (value, option) => {
                // Auto-fill unit and description from master item
                if (value && allMasterItems.length > 0) {
                    const masterItem = allMasterItems.find(m => m.item_name === value);
                    if (masterItem) {
                        document.getElementById('addItemMasterItemId').value = masterItem.id || '';
                        if (masterItem.unit) {
                            document.getElementById('addItemUnit').value = masterItem.unit;
                        }
                        if (masterItem.description) {
                            document.getElementById('addItemDescription').value = masterItem.description;
                        }
                    }
                }
            }
        });
    }
    // Always sync options (in case master items loaded after dropdown init)
    if (_addItemDropdown && allMasterItems.length > 0) {
        const opts = [{ value: '', label: 'Choose an item...' }].concat(
            allMasterItems.map(item => ({
                value: item.item_name,
                label: `${item.item_name}${item.item_code ? ' (' + item.item_code + ')' : ''}${item.category_name ? ' — ' + item.category_name : ''}`,
                description: item.category_name || ''
            }))
        );
        _addItemDropdown.setOptions(opts);
    }
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Check AI availability (non-blocking)
    checkAIAvailability();

    // Load master items for the Add Item dropdown
    loadMasterItemsForDropdown();

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
        loadDecisions(inquiryId);
    } catch (error) {
        console.error('Failed to load inquiry:', error);
        Toast.error('Failed to load inquiry details');
    }
}

// ==================== DECISIONS HISTORY ====================

async function loadDecisions(inquiryId) {
    try {
        const data = await api.request(`/procurement/inquiry-decisions?inquiryId=${inquiryId}`, { _skipSpinner: true });
        const decisions = data.data || data || [];
        renderDecisions(decisions);
    } catch (e) {
        console.error('Failed to load decisions:', e);
    }
}

function renderDecisions(decisions) {
    let section = document.getElementById('decisionsSection');
    if (!section) {
        // Create section dynamically after items
        section = document.createElement('div');
        section.id = 'decisionsSection';
        const itemsSection = document.querySelector('.crm-container');
        if (itemsSection) itemsSection.appendChild(section);
    }

    if (decisions.length === 0) {
        section.innerHTML = '';
        return;
    }

    const typeColors = {
        'manual': 'var(--brand-primary)',
        'split_award': 'var(--color-warning)',
        'ai_recommended': 'var(--color-purple, #8b5cf6)'
    };

    section.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin: 24px 0 12px 0;">Decision History</h3>
        <div class="glass-card" style="padding: 0;">
            ${decisions.map(d => `
                <div style="display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-bottom: 1px solid rgba(128,128,128,0.1);">
                    <div style="width: 8px; height: 8px; border-radius: 50%; background: ${typeColors[d.decision_type] || 'var(--text-secondary)'}; margin-top: 6px; flex-shrink: 0;"></div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 13px; font-weight: 600;">
                            ${escapeHtml(d.vendor_name || 'Unknown vendor')}
                            <span style="font-size: 11px; font-weight: 400; opacity: 0.6; margin-left: 6px;">${escapeHtml(d.decision_type || 'manual').replace(/_/g, ' ')}</span>
                        </div>
                        ${d.reason ? `<div style="font-size: 12px; opacity: 0.7; margin-top: 2px;">${escapeHtml(d.reason)}</div>` : ''}
                        <div style="font-size: 11px; opacity: 0.4; margin-top: 2px;">${formatDate(d.created_at)}${d.decided_by_name ? ' by ' + escapeHtml(d.decided_by_name) : ''}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
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

    // Edit button (draft/open only — once RFQs are sent, inquiry details are locked)
    if (inq.status === 'draft' || inq.status === 'open' || inq.status === 'in_progress') {
        actionsHtml += `<button class="btn btn-secondary btn-sm" onclick="openEditInquiryModal()">Edit</button>`;
    }

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

    // Delete button (draft only)
    if (inq.status === 'draft') {
        actionsHtml += `<button class="btn btn-sm" onclick="deleteInquiry()" style="background:none;color:var(--color-error);border:none;padding:4px 8px;" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>`;
    }

    // Show "View Comparison" button when comparison exists
    if (['comparison_done', 'po_created', 'quoted'].includes(inq.status)) {
        actionsHtml += `
            <button class="btn btn-sm" id="viewComparisonBtn" onclick="viewComparison()" style="background: var(--bg-tertiary); color: var(--brand-primary); border: 1px solid var(--brand-primary); font-weight: 600;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="20" x2="18" y2="10"/>
                    <line x1="12" y1="20" x2="12" y2="4"/>
                    <line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
                View Comparison
            </button>
        `;
    }

    actionsDiv.innerHTML = actionsHtml;

    // Show/hide item action buttons (Add Item, Bulk Add) — only when items can be modified
    const itemBtns = document.getElementById('itemActionButtons');
    if (itemBtns) {
        const canModifyItems = inq.status === 'draft' || inq.status === 'open' || inq.status === 'in_progress';
        itemBtns.style.display = canModifyItems ? 'flex' : 'none';
    }

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

    const canModifyItems = currentInquiry.status === 'draft' || currentInquiry.status === 'open' || currentInquiry.status === 'in_progress';

    tbody.innerHTML = inquiryItems.map(item => {
        const hasMasterItem = item.master_item_id && item.master_item_id !== '00000000-0000-0000-0000-000000000000';
        const mapBtnHtml = (aiAvailable && !hasMasterItem && canModifyItems) ? `
            <button class="crm-action-btn" id="mapBtn_${item.id}" onclick="aiMapItem('${item.id}', '${escapeHtml(item.item_name || '')}')" title="AI Map to Catalog" style="color: var(--color-warning);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
            </button>
        ` : '';

        return `
            <tr>
                <td>
                    <div class="crm-cell-primary">
                        <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(item.item_name || '')}</div>
                        ${hasMasterItem ? '<span style="font-size: 10px; color: var(--color-success); font-weight: 600;">MAPPED</span>' : ''}
                    </div>
                </td>
                <td><span style="color: var(--text-primary); font-weight: 600;">${item.quantity || 0}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(item.unit || '-')}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(item.description || '-')}</span></td>
                <td>
                    <div class="crm-actions">
                        ${mapBtnHtml}
                        ${canModifyItems ? `
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
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
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
    document.getElementById('addItemMasterItemId').value = '';
    _ensureAddItemDropdown();
    if (_addItemDropdown) _addItemDropdown.setValue('');
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
    document.getElementById('addItemMasterItemId').value = item.master_item_id || '';
    _ensureAddItemDropdown();
    if (_addItemDropdown) _addItemDropdown.setValue(item.item_name || '');
    else document.getElementById('addItemName').value = item.item_name || '';
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

    const masterItemId = document.getElementById('addItemMasterItemId').value.trim();
    const formData = {
        item_name: document.getElementById('addItemName').value.trim(),
        quantity: parseFloat(document.getElementById('addItemQuantity').value) || 0,
        unit: document.getElementById('addItemUnit').value.trim(),
        description: document.getElementById('addItemDescription').value.trim(),
        master_item_id: masterItemId || null
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

// ==================== View Comparison ====================

async function viewComparison() {
    try {
        // Find the RFQ for this inquiry
        const rfqs = await api.request(`/procurement/rfqs?inquiryId=${currentInquiry.id}`, { _skipSpinner: true });
        const rfqList = rfqs.data || rfqs || [];
        if (rfqList.length === 0) {
            Toast.error('No RFQ found for this inquiry');
            return;
        }
        // Use the latest RFQ
        const rfq = rfqList[0];
        window.location.href = `comparisons.html?rfqId=${rfq.id}`;
    } catch (error) {
        console.error('Failed to find RFQ:', error);
        Toast.error('Could not find comparison');
    }
}

// ==================== Create RFQ ====================

function createRFQ() {
    if (!currentInquiry || !inquiryItems.length) {
        Toast.error('Add items before creating an RFQ');
        return;
    }

    // Navigate to RFQs page with inquiry pre-selected
    window.location.href = `rfqs.html?createFrom=${currentInquiry.id}`;
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

// ==================== AI Item Mapping ====================

async function aiMapItem(itemId, itemName) {
    const btn = document.getElementById(`mapBtn_${itemId}`);
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
    }

    try {
        const response = await api.request('/procurement/procurement-ai/suggest-mapping', {
            method: 'POST',
            body: JSON.stringify({ raw_name: itemName })
        });

        const suggestion = response.data || response;

        if (suggestion && suggestion.suggested_item_id) {
            const confidence = suggestion.confidence ? Math.round(suggestion.confidence * 100) : 0;
            let confColor = 'var(--color-success)';
            if (confidence < 50) confColor = 'var(--color-error)';
            else if (confidence < 75) confColor = 'var(--color-warning)';

            // Show confirmation
            showAiMappingConfirm(itemId, itemName, suggestion, confidence, confColor);
        } else {
            Toast.info('No matching catalog item found for this item.');
        }
    } catch (error) {
        console.error('AI mapping failed:', error);
        if (error.status === 503) {
            Toast.error('AI service unavailable. Please try again later.');
        } else {
            Toast.error(error.message || 'AI mapping failed');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    }
}

function showAiMappingConfirm(itemId, rawName, suggestion, confidence, confColor) {
    // Remove existing modal if any
    const existing = document.getElementById('aiMappingModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'aiMappingModal';
    modal.className = 'gm-overlay gm-animating';
    modal.innerHTML = `
        <div class="gm-modal" style="max-width: 450px;">
            <div class="gm-header">
                <h3 class="gm-title" style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2">
                        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    AI Mapping Suggestion
                </h3>
                <button class="gm-close" onclick="document.getElementById('aiMappingModal').remove();">&times;</button>
            </div>
            <div class="gm-body">
                <div style="margin-bottom: 12px;">
                    <span style="color: var(--text-secondary); font-size: 12px;">Raw item name:</span>
                    <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(rawName)}</div>
                </div>
                <div style="padding: 14px; background: var(--bg-secondary); border-radius: 10px; border: 1px solid var(--border-primary); margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="color: var(--text-secondary); font-size: 12px;">Suggested match:</span>
                        <span style="font-size: 12px; font-weight: 600; color: ${confColor};">Confidence: ${confidence}%</span>
                    </div>
                    <div style="color: var(--text-primary); font-weight: 600; font-size: 15px;">${escapeHtml(suggestion.suggested_item_name || '')}</div>
                    ${suggestion.category ? `<div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px;">Category: ${escapeHtml(suggestion.category)}</div>` : ''}
                    ${suggestion.reasoning ? `<div style="color: var(--text-secondary); font-size: 12px; margin-top: 6px; font-style: italic;">${escapeHtml(suggestion.reasoning)}</div>` : ''}
                </div>
            </div>
            <div class="gm-footer" style="display: flex; gap: 8px; justify-content: flex-end;">
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('aiMappingModal').remove();">Reject</button>
                <button class="btn btn-primary btn-sm" onclick="acceptAiMapping('${itemId}', '${suggestion.suggested_item_id}')">Accept Mapping</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('active'));
}

async function acceptAiMapping(itemId, masterItemId) {
    try {
        await api.request(`/procurement/inquiries/items/${itemId}`, {
            method: 'PUT',
            body: JSON.stringify({ master_item_id: masterItemId })
        });
        Toast.success('Item mapped to catalog successfully');
        const mappingModal = document.getElementById('aiMappingModal');
        if (mappingModal) mappingModal.remove();
        // Reload to show updated state
        loadInquiryDetail(currentInquiry.id);
    } catch (error) {
        console.error('Failed to accept mapping:', error);
        Toast.error(error.message || 'Failed to save mapping');
    }
}

// ==================== EDIT INQUIRY ====================

function openEditInquiryModal() {
    if (!currentInquiry) return;
    const inq = currentInquiry;
    document.getElementById('editInqTitle').value = inq.title || '';
    document.getElementById('editInqClient').value = inq.client_name || '';
    document.getElementById('editInqProject').value = inq.project_name || '';
    document.getElementById('editInqPriority').value = inq.priority || 'medium';
    document.getElementById('editInqDueDate').value = inq.due_date ? new Date(inq.due_date).toISOString().split('T')[0] : '';
    document.getElementById('editInqDescription').value = inq.description || '';
    openModal('editInquiryModal');
}

async function handleEditInquiry(event) {
    event.preventDefault();
    const btn = document.getElementById('editInqSubmitBtn');
    btn.disabled = true;
    try {
        await api.request('/procurement/inquiries', {
            method: 'PUT',
            body: JSON.stringify({
                id: currentInquiry.id,
                title: document.getElementById('editInqTitle').value.trim(),
                client_name: document.getElementById('editInqClient').value.trim() || null,
                project_name: document.getElementById('editInqProject').value.trim() || null,
                priority: document.getElementById('editInqPriority').value,
                due_date: document.getElementById('editInqDueDate').value || null,
                description: document.getElementById('editInqDescription').value.trim() || null
            })
        });
        Toast.success('Inquiry updated');
        closeModal('editInquiryModal');
        loadInquiryDetail(currentInquiry.id);
    } catch (e) {
        Toast.error(e.message || 'Failed to update inquiry');
    } finally {
        btn.disabled = false;
    }
}

// ==================== DELETE INQUIRY ====================

async function deleteInquiry() {
    if (!currentInquiry) return;
    const confirmed = await showConfirm('Delete this draft inquiry? This cannot be undone.', 'Delete Inquiry', 'danger');
    if (!confirmed) return;
    try {
        await api.request(`/procurement/inquiries/${currentInquiry.id}`, { method: 'DELETE' });
        Toast.success('Inquiry deleted');
        window.location.href = 'inquiries.html';
    } catch (e) {
        Toast.error(e.message || 'Failed to delete inquiry');
    }
}

// ==================== BULK IMPORT ITEMS ====================

let _bulkAllItems = [];
let _bulkSelected = {}; // { masterItemId: { item, quantity } }

async function openBulkImportModal() {
    _bulkSelected = {};
    const container = document.getElementById('bulkAvailableItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5;">Loading catalog...</div>';
    document.getElementById('bulkSelectedItems').innerHTML = '<div style="color:var(--text-secondary);padding:8px;">Click items on the left to add them</div>';
    document.getElementById('bulkSelectedCount').textContent = '0';
    openModal('bulkImportModal');

    try {
        // Load master items and categories
        const [itemsResp, catsResp] = await Promise.all([
            api.request('/procurement/master-items'),
            api.request('/procurement/item-categories')
        ]);
        _bulkAllItems = itemsResp.data || itemsResp || [];
        const cats = catsResp.data || catsResp || [];

        // Populate category filter
        const catFilter = document.getElementById('bulkCategoryFilter');
        catFilter.innerHTML = '<option value="">All Categories</option>' +
            cats.map(c => `<option value="${c.id}">${c.category_name}</option>`).join('');

        // Exclude items already in the inquiry
        const existingNames = new Set((inquiryItems || []).map(i => (i.item_name || '').toLowerCase()));
        _bulkAllItems = _bulkAllItems.filter(i => !existingNames.has((i.item_name || '').toLowerCase()));

        filterBulkItems();
    } catch (e) {
        container.innerHTML = '<div style="color:var(--color-error);padding:12px;">Failed to load items</div>';
    }
}

function filterBulkItems() {
    const search = (document.getElementById('bulkSearchInput').value || '').toLowerCase();
    const catId = document.getElementById('bulkCategoryFilter').value;

    let filtered = _bulkAllItems;
    if (search) filtered = filtered.filter(i => (i.item_name || '').toLowerCase().includes(search) || (i.item_code || '').toLowerCase().includes(search));
    if (catId) filtered = filtered.filter(i => i.category_id === catId);

    const container = document.getElementById('bulkAvailableItems');
    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.4;font-size:12px;">No items match</div>';
        return;
    }
    container.innerHTML = filtered.map(item => {
        const isSelected = !!_bulkSelected[item.id];
        return `<div onclick="toggleBulkItem('${item.id}')" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;margin-bottom:2px;background:${isSelected ? 'rgba(59,130,246,0.15)' : 'transparent'};border:1px solid ${isSelected ? 'var(--brand-primary)' : 'transparent'};">
            <div style="width:16px;height:16px;border-radius:4px;border:2px solid ${isSelected ? 'var(--brand-primary)' : 'var(--border-primary)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                ${isSelected ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.item_name)}</div>
                <div style="font-size:10px;opacity:0.5;">${escapeHtml(item.item_code || '')} · ${escapeHtml(item.unit || '')}</div>
            </div>
        </div>`;
    }).join('');
}

function toggleBulkItem(itemId) {
    if (_bulkSelected[itemId]) {
        delete _bulkSelected[itemId];
    } else {
        const item = _bulkAllItems.find(i => i.id === itemId);
        if (item) _bulkSelected[itemId] = { item, quantity: 1 };
    }
    filterBulkItems();
    renderBulkSelected();
}

function renderBulkSelected() {
    const container = document.getElementById('bulkSelectedItems');
    const entries = Object.entries(_bulkSelected);
    document.getElementById('bulkSelectedCount').textContent = entries.length;

    if (entries.length === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary);padding:8px;">Click items on the left to add them</div>';
        return;
    }
    container.innerHTML = entries.map(([id, { item }]) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border-primary);">
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.item_name)}</div>
                <div style="font-size:10px;opacity:0.5;">${escapeHtml(item.unit || '')}</div>
            </div>
            <input type="number" min="1" value="${_bulkSelected[id].quantity}" onchange="_bulkSelected['${id}'].quantity=parseFloat(this.value)||1" style="width:70px;font-size:12px;padding:3px 6px;border-radius:4px;border:1px solid var(--border-primary);background:var(--bg-tertiary);color:var(--text-primary);text-align:center;">
            <button onclick="toggleBulkItem('${id}')" style="border:none;background:none;color:var(--color-error);cursor:pointer;font-size:16px;padding:0 4px;">&times;</button>
        </div>
    `).join('');
}

async function handleBulkImport() {
    const entries = Object.entries(_bulkSelected);
    if (entries.length === 0) { Toast.error('Select items from the catalog first'); return; }

    const items = entries.map(([id, { item, quantity }], idx) => ({
        item_name: item.item_name,
        master_item_id: item.id,
        quantity: quantity,
        unit: item.unit,
        sort_order: (inquiryItems?.length || 0) + idx + 1
    }));

    const btn = document.getElementById('bulkImportBtn');
    btn.disabled = true;
    try {
        const result = await api.request(`/procurement/inquiries/${currentInquiry.id}/bulk-items`, {
            method: 'POST',
            body: JSON.stringify({ inquiry_id: currentInquiry.id, items })
        });
        const count = result.created || items.length;
        Toast.success(`${count} item${count !== 1 ? 's' : ''} added`);
        closeModal('bulkImportModal');
        loadInquiryDetail(currentInquiry.id);
    } catch (e) {
        Toast.error(e.message || 'Failed to add items');
    } finally {
        btn.disabled = false;
    }
}
