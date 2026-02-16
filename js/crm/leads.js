/**
 * CRM Leads Management
 * Handles CRUD operations, filtering, and lead conversion.
 */

// ==================== State ====================
let allLeads = [];
let selectedLeadIds = new Set();
let currentEditLeadId = null;
let convertingLeadId = null;

// Searchable dropdown instances
let filterStatusDropdown = null;
let filterSourceDropdown = null;
let leadSourceDropdown = null;
let leadStatusDropdown = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('crm', 'leads');
    loadLeads();
    loadLeadStats();
    initSearchableDropdowns();
});

// ==================== Data Loading ====================

/**
 * Load leads from the API with optional filters
 */
async function loadLeads() {
    try {
        const params = buildFilterParams();
        const queryString = params.toString();
        const endpoint = `/crm/leads${queryString ? '?' + queryString : ''}`;

        const response = await api.request(endpoint);
        allLeads = response.data || response || [];
        renderLeadsTable(allLeads);
    } catch (error) {
        console.error('Failed to load leads:', error);
        renderLeadsTable([]);
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to load leads');
        }
    }
}

/**
 * Load lead statistics
 */
async function loadLeadStats() {
    try {
        const stats = await api.request('/crm/leads/stats');
        document.getElementById('statTotalLeads').textContent = stats.total_leads ?? '-';
        document.getElementById('statNewLeads').textContent = stats.new_leads ?? '-';
        document.getElementById('statQualifiedLeads').textContent = stats.qualified ?? '-';
        document.getElementById('statConvertedLeads').textContent = stats.converted ?? '-';
    } catch (error) {
        console.error('Failed to load lead stats:', error);
    }
}

// ==================== Filter Handling ====================

/**
 * Build query params from filter inputs
 */
function buildFilterParams() {
    const params = new URLSearchParams();
    const status = filterStatusDropdown ? filterStatusDropdown.getValue() : document.getElementById('filterStatus').value;
    const source = filterSourceDropdown ? filterSourceDropdown.getValue() : document.getElementById('filterSource').value;
    const search = document.getElementById('filterSearch').value.trim();

    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (search) params.set('search', search);

    return params;
}

/**
 * Apply filters and reload leads
 */
function applyFilters() {
    loadLeads();
}

// ==================== Table Rendering ====================

/**
 * Render the leads table
 */
function renderLeadsTable(leads) {
    const tbody = document.getElementById('leadsTableBody');

    if (!leads || leads.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <line x1="23" y1="11" x2="17" y2="11"/>
                            <line x1="20" y1="8" x2="20" y2="14"/>
                        </svg>
                        <p>No leads found</p>
                        <button class="btn btn-sm btn-primary" onclick="openNewLeadModal()">Add your first lead</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = leads.map(lead => `
        <tr data-lead-id="${lead.id}">
            <td class="td-checkbox">
                <input type="checkbox" class="lead-checkbox" value="${lead.id}"
                    onchange="toggleLeadSelection('${lead.id}', this.checked)"
                    ${selectedLeadIds.has(lead.id) ? 'checked' : ''}>
            </td>
            <td>
                <div class="crm-cell-primary">${escapeHtml(lead.first_name || '')} ${escapeHtml(lead.last_name || '')}</div>
                ${lead.company ? `<div class="crm-cell-secondary">${escapeHtml(lead.company)}</div>` : ''}
            </td>
            <td>
                <span class="crm-cell-secondary">${escapeHtml(lead.email || '-')}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${escapeHtml(lead.phone || '-')}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-source-badge source-${lead.lead_source || 'manual'}">${formatSource(lead.lead_source)}</span>
            </td>
            <td>
                <span class="crm-status-badge status-${lead.status || 'new'}">${formatStatus(lead.status)}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${escapeHtml(lead.owner_name || '-')}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${formatDate(lead.created_at)}</span>
            </td>
            <td>
                <div class="crm-actions">
                    <button class="crm-action-btn" onclick="editLead('${lead.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    ${lead.status !== 'converted' ? `
                    <button class="crm-action-btn action-convert" onclick="openConvertModal('${lead.id}')" title="Convert to Contact">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                            <polyline points="17 6 23 6 23 12"/>
                        </svg>
                    </button>
                    ` : ''}
                    <button class="crm-action-btn action-delete" onclick="deleteLead('${lead.id}')" title="Delete">
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

// ==================== Status & Source Formatting ====================

function formatStatus(status) {
    const labels = {
        'new': 'New',
        'contacted': 'Contacted',
        'qualified': 'Qualified',
        'converted': 'Converted'
    };
    return labels[status] || status || 'New';
}

function formatSource(source) {
    const labels = {
        'manual': 'Manual',
        'website': 'Website',
        'facebook': 'Facebook',
        'linkedin': 'LinkedIn',
        'referral': 'Referral',
        'google_ads': 'Google Ads',
        'other': 'Other'
    };
    return labels[source] || source || 'Manual';
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

// ==================== Selection & Bulk Actions ====================

function toggleSelectAll(checkbox) {
    const checkboxes = document.querySelectorAll('.lead-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
        if (checkbox.checked) {
            selectedLeadIds.add(cb.value);
        } else {
            selectedLeadIds.delete(cb.value);
        }
    });
    updateBulkActionsBar();
}

function toggleLeadSelection(leadId, checked) {
    if (checked) {
        selectedLeadIds.add(leadId);
    } else {
        selectedLeadIds.delete(leadId);
    }
    updateBulkActionsBar();

    // Update "select all" checkbox state
    const allCheckboxes = document.querySelectorAll('.lead-checkbox');
    const selectAll = document.getElementById('selectAll');
    if (selectAll) {
        selectAll.checked = allCheckboxes.length > 0 && selectedLeadIds.size === allCheckboxes.length;
    }
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const countEl = document.getElementById('selectedCount');
    if (selectedLeadIds.size > 0) {
        bar.style.display = 'flex';
        countEl.textContent = selectedLeadIds.size;
    } else {
        bar.style.display = 'none';
    }
}

async function bulkAssign() {
    // Placeholder for bulk assignment
    Toast.info('Bulk assign functionality coming soon');
}

async function bulkDelete() {
    const confirmed = await showConfirm(`Delete ${selectedLeadIds.size} selected lead(s)?`, 'Delete Leads', 'danger');
    if (!confirmed) return;

    try {
        const promises = Array.from(selectedLeadIds).map(id =>
            api.request(`/crm/leads/${id}`, { method: 'DELETE' })
        );
        await Promise.all(promises);
        Toast.success(`Deleted ${selectedLeadIds.size} lead(s)`);
        selectedLeadIds.clear();
        updateBulkActionsBar();
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Bulk delete failed:', error);
        Toast.error('Failed to delete some leads');
    }
}

// ==================== Modal Handling ====================

function openNewLeadModal() {
    currentEditLeadId = null;
    document.getElementById('leadModalTitle').textContent = 'New Lead';
    document.getElementById('leadSubmitBtn').textContent = 'Create Lead';
    document.getElementById('leadForm').reset();
    if (leadSourceDropdown) leadSourceDropdown.setValue('');
    if (leadStatusDropdown) leadStatusDropdown.setValue('');
    document.getElementById('leadId').value = '';
    openModal('leadModal');
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

function closeLeadModal() {
    closeModal('leadModal');
    currentEditLeadId = null;
}

// ==================== CRUD Operations ====================

async function handleLeadSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('leadSubmitBtn');
    const spinner = document.getElementById('leadSubmitSpinner');
    submitBtn.disabled = true;
    spinner.style.display = 'inline-block';

    const formData = {
        first_name: document.getElementById('leadFirstName').value.trim(),
        last_name: document.getElementById('leadLastName').value.trim(),
        email: document.getElementById('leadEmail').value.trim(),
        phone: document.getElementById('leadPhone').value.trim(),
        company: document.getElementById('leadCompany').value.trim(),
        job_title: document.getElementById('leadJobTitle').value.trim(),
        lead_source: document.getElementById('leadSource').value,
        status: document.getElementById('leadStatus').value,
        notes: document.getElementById('leadNotes').value.trim()
    };

    try {
        if (currentEditLeadId) {
            await api.request(`/crm/leads/${currentEditLeadId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Lead updated successfully');
        } else {
            await api.request('/crm/leads', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Lead created successfully');
        }

        closeLeadModal();
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Failed to save lead:', error);
        Toast.error(error.message || 'Failed to save lead');
    } finally {
        submitBtn.disabled = false;
        spinner.style.display = 'none';
    }
}

async function editLead(leadId) {
    try {
        const lead = await api.request(`/crm/leads/${leadId}`);
        currentEditLeadId = leadId;

        document.getElementById('leadModalTitle').textContent = 'Edit Lead';
        document.getElementById('leadSubmitBtn').textContent = 'Update Lead';
        document.getElementById('leadId').value = leadId;
        document.getElementById('leadFirstName').value = lead.first_name || '';
        document.getElementById('leadLastName').value = lead.last_name || '';
        document.getElementById('leadEmail').value = lead.email || '';
        document.getElementById('leadPhone').value = lead.phone || '';
        document.getElementById('leadCompany').value = lead.company || '';
        document.getElementById('leadJobTitle').value = lead.job_title || '';
        document.getElementById('leadSource').value = lead.lead_source || 'manual';
        document.getElementById('leadStatus').value = lead.status || 'new';
        if (leadSourceDropdown) leadSourceDropdown.setValue(lead.lead_source || 'manual');
        if (leadStatusDropdown) leadStatusDropdown.setValue(lead.status || 'new');
        document.getElementById('leadNotes').value = lead.notes || '';

        openModal('leadModal');
    } catch (error) {
        console.error('Failed to load lead:', error);
        Toast.error('Failed to load lead details');
    }
}

async function deleteLead(leadId) {
    const confirmed = await showConfirm('Are you sure you want to delete this lead?', 'Delete Lead', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/crm/leads/${leadId}`, { method: 'DELETE' });
        Toast.success('Lead deleted');
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Failed to delete lead:', error);
        Toast.error('Failed to delete lead');
    }
}

// ==================== Status Update ====================

async function updateLeadStatus(leadId, newStatus) {
    try {
        await api.request(`/crm/leads/${leadId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        Toast.success(`Lead status updated to ${formatStatus(newStatus)}`);
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Failed to update status:', error);
        Toast.error('Failed to update lead status');
    }
}

// ==================== Lead Assignment ====================

async function assignLead(leadId, ownerId) {
    try {
        await api.request(`/crm/leads/${leadId}/assign`, {
            method: 'PUT',
            body: JSON.stringify({ owner_id: ownerId })
        });
        Toast.success('Lead assigned successfully');
        loadLeads();
    } catch (error) {
        console.error('Failed to assign lead:', error);
        Toast.error('Failed to assign lead');
    }
}

// ==================== Lead Conversion ====================

function openConvertModal(leadId) {
    convertingLeadId = leadId;
    const lead = allLeads.find(l => l.id === leadId);
    if (lead) {
        document.getElementById('convertDealName').value = `${lead.first_name || ''} ${lead.last_name || ''} - Deal`.trim();
    }
    document.getElementById('convertCreateDeal').checked = true;
    document.getElementById('convertDealFields').style.display = 'block';
    openModal('convertLeadModal');
}

function closeConvertModal() {
    closeModal('convertLeadModal');
    convertingLeadId = null;
}

// Toggle deal fields visibility based on checkbox
document.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.getElementById('convertCreateDeal');
    if (checkbox) {
        checkbox.addEventListener('change', function() {
            document.getElementById('convertDealFields').style.display = this.checked ? 'block' : 'none';
        });
    }
});

async function confirmConvertLead() {
    if (!convertingLeadId) return;

    const convertBtn = document.getElementById('convertLeadBtn');
    const spinner = document.getElementById('convertSpinner');
    convertBtn.disabled = true;
    spinner.style.display = 'inline-block';

    try {
        const payload = {
            create_deal: document.getElementById('convertCreateDeal').checked,
            deal_name: document.getElementById('convertDealName').value.trim(),
            deal_value: parseFloat(document.getElementById('convertDealValue').value) || 0
        };

        await api.request(`/crm/leads/${convertingLeadId}/convert`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        Toast.success('Lead converted successfully');
        closeConvertModal();
        loadLeads();
        loadLeadStats();
    } catch (error) {
        console.error('Failed to convert lead:', error);
        Toast.error(error.message || 'Failed to convert lead');
    } finally {
        convertBtn.disabled = false;
        spinner.style.display = 'none';
    }
}

// ==================== Searchable Dropdowns ====================

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    // Filter bar dropdowns (compact)
    if (!filterStatusDropdown) {
        filterStatusDropdown = convertSelectToSearchable('filterStatus', {
            compact: true,
            placeholder: 'All Statuses',
            searchPlaceholder: 'Search status...',
            onChange: () => applyFilters()
        });
    }

    if (!filterSourceDropdown) {
        filterSourceDropdown = convertSelectToSearchable('filterSource', {
            compact: true,
            placeholder: 'All Sources',
            searchPlaceholder: 'Search sources...',
            onChange: () => applyFilters()
        });
    }

    // Modal form dropdowns
    if (!leadSourceDropdown) {
        leadSourceDropdown = convertSelectToSearchable('leadSource', {
            placeholder: 'Select source...',
            searchPlaceholder: 'Search sources...'
        });
    }

    if (!leadStatusDropdown) {
        leadStatusDropdown = convertSelectToSearchable('leadStatus', {
            placeholder: 'Select status...',
            searchPlaceholder: 'Search status...'
        });
    }
}

// ==================== Utilities ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
