/**
 * CRM Deals Pipeline Management
 * Handles pipeline visualization (Kanban & List), CRUD, stage changes, won/lost.
 */

// ==================== State ====================
let allDeals = [];
let dealStages = [];
let currentView = 'kanban'; // 'kanban' or 'list'
let currentEditDealId = null;
let pendingStageChange = null; // { dealId, action, data }
let contactsList = [];
let companiesList = [];

// Currency symbols map
const CURRENCY_SYMBOLS = {
    'USD': '$', 'EUR': '\u20AC', 'GBP': '\u00A3', 'INR': '\u20B9',
    'AED': 'AED ', 'CAD': 'C$', 'AUD': 'A$', 'JPY': '\u00A5',
    'CNY': '\u00A5', 'KRW': '\u20A9', 'BRL': 'R$', 'ZAR': 'R'
};

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('crm', 'deals');
    loadDealStages();
    loadPipeline();
    loadContacts();
    loadCompanies();
});

// ==================== Data Loading ====================

/**
 * Load pipeline stages
 */
async function loadDealStages() {
    try {
        const response = await api.request('/crm/deal-stages?pipelineName=Default');
        dealStages = response.data || response || [];

        // Populate stage dropdown in deal form
        const stageSelect = document.getElementById('dealStage');
        if (stageSelect && dealStages.length > 0) {
            stageSelect.innerHTML = dealStages.map(stage =>
                `<option value="${stage.id}">${escapeHtml(stage.name)}</option>`
            ).join('');
        }
    } catch (error) {
        console.error('Failed to load deal stages:', error);
        // Fallback default stages
        dealStages = [
            { id: 'qualification', name: 'Qualification', order: 1, color: 'blue' },
            { id: 'proposal', name: 'Proposal', order: 2, color: 'purple' },
            { id: 'negotiation', name: 'Negotiation', order: 3, color: 'orange' },
            { id: 'won', name: 'Won', order: 4, color: 'green' },
            { id: 'lost', name: 'Lost', order: 5, color: 'red' }
        ];
    }
}

/**
 * Load pipeline deals
 */
async function loadPipeline() {
    try {
        const response = await api.request('/crm/deals/pipeline?pipelineName=Default');
        allDeals = response.data || response || [];
        renderCurrentView();
        updatePipelineSummary();
    } catch (error) {
        console.error('Failed to load pipeline:', error);
        allDeals = [];
        renderCurrentView();
    }
}

/**
 * Load contacts for the deal form dropdown
 */
async function loadContacts() {
    try {
        const response = await api.request('/crm/contacts');
        contactsList = response.data || response || [];
        const contactSelect = document.getElementById('dealContact');
        if (contactSelect) {
            const options = contactsList.map(c =>
                `<option value="${c.id}">${escapeHtml((c.first_name || '') + ' ' + (c.last_name || ''))}</option>`
            ).join('');
            contactSelect.innerHTML = '<option value="">Select contact...</option>' + options;
        }
    } catch (error) {
        console.error('Failed to load contacts:', error);
    }
}

/**
 * Load companies for the deal form dropdown
 */
async function loadCompanies() {
    try {
        const response = await api.request('/crm/companies');
        companiesList = response.data || response || [];
        const companySelect = document.getElementById('dealCompany');
        if (companySelect) {
            const options = companiesList.map(c =>
                `<option value="${c.id}">${escapeHtml(c.name || '')}</option>`
            ).join('');
            companySelect.innerHTML = '<option value="">Select company...</option>' + options;
        }
    } catch (error) {
        console.error('Failed to load companies:', error);
    }
}

// ==================== Pipeline Summary ====================

function updatePipelineSummary() {
    const totalValue = allDeals.reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0);
    const wonDeals = allDeals.filter(d => d.is_won);
    const lostDeals = allDeals.filter(d => d.is_lost);
    const wonValue = wonDeals.reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0);
    const lostValue = lostDeals.reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0);

    document.getElementById('totalPipelineValue').textContent = formatCurrency(totalValue);
    document.getElementById('totalDealsCount').textContent = allDeals.length;
    document.getElementById('wonDealsValue').textContent = formatCurrency(wonValue);
    document.getElementById('lostDealsValue').textContent = formatCurrency(lostValue);
}

// ==================== View Toggle ====================

function switchView(view) {
    currentView = view;

    // Update toggle buttons
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Show/hide views
    document.getElementById('kanbanView').style.display = view === 'kanban' ? 'block' : 'none';
    document.getElementById('listView').style.display = view === 'list' ? 'block' : 'none';

    renderCurrentView();
}

function renderCurrentView() {
    if (currentView === 'kanban') {
        renderKanbanBoard();
    } else {
        renderListView();
    }
}

// ==================== Kanban Board ====================

function renderKanbanBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    if (dealStages.length === 0) {
        board.innerHTML = `
            <div class="kanban-loading">
                <div class="crm-empty-content">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="7" height="7"/>
                        <rect x="14" y="3" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/>
                    </svg>
                    <p>No pipeline stages configured</p>
                </div>
            </div>
        `;
        return;
    }

    // Group deals by stage
    const dealsByStage = {};
    dealStages.forEach(stage => {
        dealsByStage[stage.id] = allDeals.filter(d =>
            d.stage_id === stage.id ||
            (stage.name === 'Won' && d.is_won) ||
            (stage.name === 'Lost' && d.is_lost)
        );
    });

    board.innerHTML = dealStages.map(stage => {
        const stageDeals = dealsByStage[stage.id] || [];
        const stageValue = stageDeals.reduce((sum, d) => sum + (parseFloat(d.deal_value) || 0), 0);
        const stageColor = getStageColor(stage);

        return `
            <div class="kanban-column" data-stage-id="${stage.id}"
                 ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${stage.id}')">
                <div class="kanban-column-header" style="border-top-color: ${stageColor};">
                    <div class="kanban-column-title">
                        <span class="kanban-stage-dot" style="background: ${stageColor};"></span>
                        <span>${escapeHtml(stage.name)}</span>
                        <span class="kanban-count">${stageDeals.length}</span>
                    </div>
                    <div class="kanban-column-value">${formatCurrency(stageValue)}</div>
                </div>
                <div class="kanban-column-body">
                    ${stageDeals.length === 0 ? `
                        <div class="kanban-empty">
                            <p>No deals</p>
                        </div>
                    ` : stageDeals.map(deal => renderDealCard(deal, stage)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function renderDealCard(deal, stage) {
    const value = formatCurrency(parseFloat(deal.deal_value) || 0, deal.currency);
    const contactName = deal.contact_name || '';
    const companyName = deal.company_name || '';
    const closeDate = deal.expected_close_date ? formatDate(deal.expected_close_date) : '';

    return `
        <div class="kanban-deal-card" draggable="true"
             data-deal-id="${deal.id}"
             ondragstart="handleDragStart(event, '${deal.id}')">
            <div class="deal-card-header">
                <span class="deal-card-name">${escapeHtml(deal.deal_name || 'Untitled Deal')}</span>
                <div class="deal-card-actions">
                    <button class="crm-action-btn" onclick="editDeal('${deal.id}')" title="Edit">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="deal-card-value">${value}</div>
            <div class="deal-card-meta">
                ${companyName ? `<span class="deal-card-company">${escapeHtml(companyName)}</span>` : ''}
                ${contactName ? `<span class="deal-card-contact">${escapeHtml(contactName)}</span>` : ''}
            </div>
            ${closeDate ? `<div class="deal-card-date">${closeDate}</div>` : ''}
            <div class="deal-card-footer">
                ${!deal.is_won && !deal.is_lost ? `
                    <button class="deal-quick-btn deal-won-btn" onclick="event.stopPropagation(); markDealWon('${deal.id}')" title="Mark as Won">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </button>
                    <button class="deal-quick-btn deal-lost-btn" onclick="event.stopPropagation(); markDealLost('${deal.id}')" title="Mark as Lost">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

function getStageColor(stage) {
    // Use stage color if provided, otherwise map by name
    if (stage.color) {
        const colorMap = {
            'blue': 'var(--brand-primary)',
            'purple': 'var(--brand-secondary)',
            'orange': 'var(--color-warning)',
            'green': 'var(--color-success)',
            'red': 'var(--color-danger)',
            'cyan': 'var(--color-cyan)',
            'indigo': 'var(--brand-accent)'
        };
        return colorMap[stage.color] || stage.color;
    }

    // Default color mapping by stage name
    const nameMap = {
        'qualification': 'var(--brand-primary)',
        'proposal': 'var(--brand-secondary)',
        'negotiation': 'var(--color-warning)',
        'won': 'var(--color-success)',
        'lost': 'var(--color-danger)'
    };
    return nameMap[stage.name?.toLowerCase()] || 'var(--brand-primary)';
}

// ==================== Drag & Drop ====================

function handleDragStart(event, dealId) {
    event.dataTransfer.setData('text/plain', dealId);
    event.dataTransfer.effectAllowed = 'move';
    event.target.classList.add('dragging');
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const column = event.currentTarget;
    column.classList.add('drag-over');
}

function handleDrop(event, stageId) {
    event.preventDefault();
    const dealId = event.dataTransfer.getData('text/plain');

    // Remove drag-over styling from all columns
    document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
    document.querySelectorAll('.kanban-deal-card').forEach(card => card.classList.remove('dragging'));

    if (dealId) {
        changeDealStage(dealId, stageId);
    }
}

// Remove drag-over on drag leave
document.addEventListener('dragleave', (event) => {
    const column = event.target.closest('.kanban-column');
    if (column && !column.contains(event.relatedTarget)) {
        column.classList.remove('drag-over');
    }
});

// ==================== List View ====================

function renderListView() {
    const tbody = document.getElementById('dealsTableBody');
    if (!tbody) return;

    if (!allDeals || allDeals.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <line x1="12" y1="1" x2="12" y2="23"/>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                        <p>No deals found</p>
                        <button class="btn btn-sm btn-primary" onclick="openNewDealModal()">Create your first deal</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = allDeals.map(deal => {
        const stage = dealStages.find(s => s.id === deal.stage_id);
        const stageName = stage ? stage.name : (deal.is_won ? 'Won' : deal.is_lost ? 'Lost' : '-');
        const stageClass = deal.is_won ? 'stage-won' : deal.is_lost ? 'stage-lost' : '';

        return `
            <tr data-deal-id="${deal.id}">
                <td>
                    <div class="crm-cell-primary">${escapeHtml(deal.deal_name || 'Untitled')}</div>
                </td>
                <td>
                    <span class="deal-value-cell">${formatCurrency(parseFloat(deal.deal_value) || 0, deal.currency)}</span>
                </td>
                <td>
                    <span class="crm-stage-badge ${stageClass}">${escapeHtml(stageName)}</span>
                </td>
                <td class="hide-mobile">
                    <span class="crm-cell-secondary">${escapeHtml(deal.contact_name || '-')}</span>
                </td>
                <td class="hide-mobile">
                    <span class="crm-cell-secondary">${escapeHtml(deal.company_name || '-')}</span>
                </td>
                <td class="hide-mobile">
                    <span class="crm-cell-secondary">${deal.expected_close_date ? formatDate(deal.expected_close_date) : '-'}</span>
                </td>
                <td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="editDeal('${deal.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        ${!deal.is_won && !deal.is_lost ? `
                        <button class="crm-action-btn action-convert" onclick="markDealWon('${deal.id}')" title="Mark Won">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="markDealLost('${deal.id}')" title="Mark Lost">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                        ` : ''}
                        <button class="crm-action-btn action-delete" onclick="deleteDeal('${deal.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== Modal Handling ====================

function openNewDealModal() {
    currentEditDealId = null;
    document.getElementById('dealModalTitle').textContent = 'New Deal';
    document.getElementById('dealSubmitBtn').textContent = 'Create Deal';
    document.getElementById('dealForm').reset();
    document.getElementById('dealId').value = '';
    openModal('dealModal');
}

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

function closeDealModal() {
    closeModal('dealModal');
    currentEditDealId = null;
}

function closeStageChangeModal() {
    closeModal('stageChangeModal');
    pendingStageChange = null;
}

// ==================== CRUD Operations ====================

async function handleDealSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('dealSubmitBtn');
    const spinner = document.getElementById('dealSubmitSpinner');
    submitBtn.disabled = true;
    spinner.style.display = 'inline-block';

    const formData = {
        deal_name: document.getElementById('dealName').value.trim(),
        deal_value: parseFloat(document.getElementById('dealValue').value) || 0,
        currency: document.getElementById('dealCurrency').value,
        stage_id: document.getElementById('dealStage').value,
        expected_close_date: document.getElementById('dealExpectedClose').value || null,
        contact_id: document.getElementById('dealContact').value || null,
        company_id: document.getElementById('dealCompany').value || null,
        notes: document.getElementById('dealNotes').value.trim()
    };

    try {
        if (currentEditDealId) {
            await api.request(`/crm/deals/${currentEditDealId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Deal updated successfully');
        } else {
            await api.request('/crm/deals', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Deal created successfully');
        }

        closeDealModal();
        loadPipeline();
    } catch (error) {
        console.error('Failed to save deal:', error);
        Toast.error(error.message || 'Failed to save deal');
    } finally {
        submitBtn.disabled = false;
        spinner.style.display = 'none';
    }
}

async function editDeal(dealId) {
    try {
        const deal = await api.request(`/crm/deals/${dealId}`);
        currentEditDealId = dealId;

        document.getElementById('dealModalTitle').textContent = 'Edit Deal';
        document.getElementById('dealSubmitBtn').textContent = 'Update Deal';
        document.getElementById('dealId').value = dealId;
        document.getElementById('dealName').value = deal.deal_name || '';
        document.getElementById('dealValue').value = deal.deal_value || '';
        document.getElementById('dealCurrency').value = deal.currency || 'USD';
        document.getElementById('dealStage').value = deal.stage_id || '';
        document.getElementById('dealExpectedClose').value = deal.expected_close_date ? deal.expected_close_date.split('T')[0] : '';
        document.getElementById('dealContact').value = deal.contact_id || '';
        document.getElementById('dealCompany').value = deal.company_id || '';
        document.getElementById('dealNotes').value = deal.notes || '';

        openModal('dealModal');
    } catch (error) {
        console.error('Failed to load deal:', error);
        Toast.error('Failed to load deal details');
    }
}

async function deleteDeal(dealId) {
    if (!confirm('Are you sure you want to delete this deal?')) return;

    try {
        await api.request(`/crm/deals/${dealId}`, { method: 'DELETE' });
        Toast.success('Deal deleted');
        loadPipeline();
    } catch (error) {
        console.error('Failed to delete deal:', error);
        Toast.error('Failed to delete deal');
    }
}

// ==================== Stage Changes ====================

async function changeDealStage(dealId, newStageId) {
    try {
        await api.request(`/crm/deals/${dealId}/stage`, {
            method: 'PUT',
            body: JSON.stringify({ stage_id: newStageId })
        });
        Toast.success('Deal stage updated');
        loadPipeline();
    } catch (error) {
        console.error('Failed to change deal stage:', error);
        Toast.error('Failed to update deal stage');
        renderCurrentView(); // Re-render to restore original position
    }
}

function markDealWon(dealId) {
    pendingStageChange = { dealId, action: 'won' };
    document.getElementById('stageChangeTitle').textContent = 'Mark Deal as Won';
    document.getElementById('stageChangeBody').innerHTML = `
        <p style="color: var(--text-secondary);">
            Are you sure you want to mark this deal as <strong style="color: var(--color-success);">Won</strong>?
        </p>
    `;
    document.getElementById('stageChangeConfirmBtn').className = 'btn btn-success';
    document.getElementById('stageChangeConfirmBtn').innerHTML = `
        <span class="btn-spinner" id="stageChangeSpinner" style="display:none;"></span>
        Mark as Won
    `;
    openModal('stageChangeModal');
}

function markDealLost(dealId) {
    pendingStageChange = { dealId, action: 'lost' };
    document.getElementById('stageChangeTitle').textContent = 'Mark Deal as Lost';
    document.getElementById('stageChangeBody').innerHTML = `
        <p style="color: var(--text-secondary);">
            Are you sure you want to mark this deal as <strong style="color: var(--color-danger);">Lost</strong>?
        </p>
        <div class="mb-3" style="margin-top: 12px;">
            <label for="lostReason" class="form-label">Reason (optional)</label>
            <textarea class="form-control" id="lostReason" rows="2" placeholder="Why was this deal lost?"></textarea>
        </div>
    `;
    document.getElementById('stageChangeConfirmBtn').className = 'btn btn-danger';
    document.getElementById('stageChangeConfirmBtn').innerHTML = `
        <span class="btn-spinner" id="stageChangeSpinner" style="display:none;"></span>
        Mark as Lost
    `;
    openModal('stageChangeModal');
}

async function confirmStageChange() {
    if (!pendingStageChange) return;

    const confirmBtn = document.getElementById('stageChangeConfirmBtn');
    const spinner = document.getElementById('stageChangeSpinner');
    confirmBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const { dealId, action } = pendingStageChange;

    try {
        if (action === 'won') {
            await api.request(`/crm/deals/${dealId}/won`, { method: 'POST' });
            Toast.success('Deal marked as Won!');
        } else if (action === 'lost') {
            const reason = document.getElementById('lostReason')?.value?.trim() || '';
            await api.request(`/crm/deals/${dealId}/lost`, {
                method: 'POST',
                body: JSON.stringify({ reason })
            });
            Toast.success('Deal marked as Lost');
        }

        closeStageChangeModal();
        loadPipeline();
    } catch (error) {
        console.error(`Failed to mark deal as ${action}:`, error);
        Toast.error(`Failed to mark deal as ${action}`);
    } finally {
        confirmBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== Currency Formatting ====================

function formatCurrency(amount, currency = 'USD') {
    const symbol = CURRENCY_SYMBOLS[currency] || currency + ' ';

    if (amount >= 1000000) {
        return symbol + (amount / 1000000).toFixed(1) + 'M';
    } else if (amount >= 1000) {
        return symbol + (amount / 1000).toFixed(1) + 'K';
    }
    return symbol + amount.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

// ==================== Utilities ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
