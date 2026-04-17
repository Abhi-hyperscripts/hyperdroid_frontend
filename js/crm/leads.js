/**
 * CRM Leads Management
 * Handles CRUD operations, filtering, and lead conversion.
 */

// ==================== State ====================
let allLeads = [];
let selectedLeadIds = new Set();
let currentEditLeadId = null;
let convertingLeadId = null;
let currentPage = 1;
let pageSize = 50;
let totalLeads = 0;
let myTeamRole = 'member'; // default to most restrictive

// Searchable dropdown instances
let filterStatusDropdown = null;
let filterSourceDropdown = null;
let leadSourceDropdown = null;
let leadStatusDropdown = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('crm', 'leads');
    loadMyRole();
    loadLeads();
    loadLeadStats();
    loadSourceFilter();
    initSearchableDropdowns();
});

async function loadMyRole() {
    try {
        const user = api.getUser();
        if (user?.roles?.includes('CRM_ADMIN') || user?.roles?.includes('SUPERADMIN')) {
            myTeamRole = 'admin';
        } else {
            const res = await api.request('/crm/leads/my-role');
            myTeamRole = res.role || 'member';
        }
    } catch { myTeamRole = 'member'; }
    // Hide admin-only buttons for members
    if (!canDeleteLead()) {
        const bulkDelBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDelBtn) bulkDelBtn.style.display = 'none';
    }
    if (myTeamRole === 'member') {
        ['discoverLeadsBtn', 'importLeadsBtn', 'newLeadBtn', 'pendingTransfersBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }
}

function canDeleteLead() {
    return ['admin', 'manager', 'teamlead'].includes(myTeamRole);
}

// ==================== Data Loading ====================

/**
 * Load leads from the API with optional filters
 */
async function loadLeads(page) {
    if (page) currentPage = page;
    try {
        const params = buildFilterParams();
        params.set('page', currentPage);
        params.set('pageSize', pageSize);
        const queryString = params.toString();
        const endpoint = `/crm/leads${queryString ? '?' + queryString : ''}`;

        const response = await api.request(endpoint);
        allLeads = response.data || [];
        totalLeads = response.total || allLeads.length;
        renderLeadsTable(allLeads);
        renderPagination();
    } catch (error) {
        console.error('Failed to load leads:', error);
        allLeads = [];
        totalLeads = 0;
        renderLeadsTable([]);
        renderPagination();
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

/**
 * Load distinct lead sources from API and populate the source filter dropdown
 */
async function loadSourceFilter() {
    try {
        const sources = await api.request('/crm/leads/sources');
        const sel = document.getElementById('filterSource');
        // Keep the "All Sources" option, clear rest
        const allOpt = sel.querySelector('option[value=""]');
        sel.innerHTML = '';
        if (allOpt) sel.appendChild(allOpt);
        else {
            const o = document.createElement('option');
            o.value = ''; o.textContent = 'All Sources';
            sel.appendChild(o);
        }
        (sources || []).forEach(s => {
            const o = document.createElement('option');
            o.value = s;
            o.textContent = s;
            sel.appendChild(o);
        });
        // Re-init the searchable dropdown for this select if it was already converted
        if (filterSourceDropdown && typeof filterSourceDropdown.rebuild === 'function') {
            filterSourceDropdown.rebuild();
        }
    } catch (e) {
        console.error('Failed to load source filter:', e);
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
    currentPage = 1;
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
                <td colspan="11" class="crm-empty-state">
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
                    ${selectedLeadIds.has(lead.id) ? 'checked' : ''}
                    ${(lead.team_id || lead.teamName || lead.team_name) ? 'disabled data-tooltip="Already assigned to a team"' : ''}>
            </td>
            <td>
                <span class="crm-lead-number">${escapeHtml(lead.leadNumber || lead.lead_number || '-')}</span>
            </td>
            <td onclick="openLeadDetailPanel('${lead.id}')" style="cursor:pointer;">
                <div class="crm-cell-primary">
                    ${escapeHtml(lead.first_name || '')} ${escapeHtml(lead.last_name || '')}${getCustomFieldsBadge(lead.custom_fields)}
                </div>
                ${lead.company_name ? `<div class="crm-cell-secondary">${escapeHtml(lead.company_name)}</div>` : (lead.company ? `<div class="crm-cell-secondary">${escapeHtml(lead.company)}</div>` : '')}
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
                <span class="crm-status-badge status-${lead.status || 'new'}" onclick="openStatusChangeModal('${lead.id}')" style="cursor:pointer;" data-tooltip="Click to change status">${formatStatus(lead.status)}</span>
                ${lead.disposition ? `<span class="crm-disposition-badge disp-${lead.disposition}" title="${formatDisposition(lead.disposition)}">${formatDisposition(lead.disposition)}</span>` : ''}
                ${lead.next_followup_date ? formatFollowupIndicator(lead.next_followup_date) : ''}
                ${lead.has_pending_transfer ? '<span class="crm-transfer-pending-badge" data-tooltip="Transfer/Reassignment pending approval">⇄ Transfer Pending</span>' : ''}
            </td>
            <td class="hide-mobile">
                ${lead.teamName || lead.team_name ? `<span class="crm-team-badge ${teamColorClass(lead.teamName || lead.team_name)}">${escapeHtml(lead.teamName || lead.team_name)}</span>` : '<span class="crm-cell-secondary">—</span>'}
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${escapeHtml(lead.ownerName || lead.owner_name || '-')}</span>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${formatDate(lead.created_at)}</span>
            </td>
            <td>
                <div class="crm-actions">
                    <button class="crm-action-btn" onclick="openLogActivityModal('${lead.id}')" data-tooltip="Log Activity">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn" onclick="editLead('${lead.id}')" data-tooltip="Edit Lead">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    ${lead.status === 'qualified' ? `
                    <button class="crm-action-btn action-convert" onclick="openConvertModal('${lead.id}')" data-tooltip="Convert to Contact + Deal">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                            <polyline points="17 6 23 6 23 12"/>
                        </svg>
                    </button>
                    ` : ''}
                    ${canDeleteLead() ? `<button class="crm-action-btn action-delete" onclick="deleteLead('${lead.id}')" data-tooltip="Delete Lead">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

// ==================== Status & Source Formatting ====================

function formatStatus(status) {
    const labels = {
        'new': 'New',
        'assigned': 'Assigned',
        'contacted': 'Contacted',
        'qualified': 'Qualified',
        'unqualified': 'Unqualified',
        'converted': 'Converted'
    };
    return labels[status] || status || 'New';
}

function formatFollowupIndicator(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fuDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((fuDay - today) / 86400000);

    let cls, label;
    if (diffDays < 0) {
        cls = 'followup-overdue';
        label = `Overdue ${Math.abs(diffDays)}d`;
    } else if (diffDays === 0) {
        cls = 'followup-today';
        label = 'Follow-up today';
    } else if (diffDays === 1) {
        cls = 'followup-soon';
        label = 'Follow-up tomorrow';
    } else {
        cls = 'followup-future';
        label = `Follow-up ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    }
    return `<div class="crm-followup-indicator ${cls}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${label}</div>`;
}

function formatDisposition(disp) {
    const labels = {
        'not_responding': 'Not Responding',
        'not_interested': 'Not Interested',
        'callback_later': 'Callback Later',
        'hot_lead': 'Hot Lead',
        'wrong_number': 'Wrong Number',
        'voicemail': 'Voicemail',
        'email_sent': 'Email Sent',
        'meeting_scheduled': 'Meeting Scheduled',
        'proposal_sent': 'Proposal Sent',
        'deal_in_progress': 'Deal In Progress'
    };
    return labels[disp] || disp || '';
}

function formatSource(source) {
    const labels = {
        'manual': 'Manual',
        'website': 'Website',
        'facebook': 'Facebook',
        'linkedin': 'LinkedIn',
        'referral': 'Referral',
        'google_ads': 'Google Ads',
        'landing_page': 'Landing Page',
        'api': 'API',
        'import': 'Import',
        'other': 'Other'
    };
    return labels[source] || source || 'Manual';
}

function renderPagination() {
    let container = document.getElementById('leadsPagination');
    if (!container) {
        container = document.createElement('div');
        container.id = 'leadsPagination';
        container.className = 'crm-pagination';
        const table = document.getElementById('leadsTableBody')?.closest('table');
        if (table) table.after(container);
    }

    const totalPages = Math.ceil(totalLeads / pageSize);
    if (totalPages <= 1) {
        container.innerHTML = `<span class="crm-pagination-info">Showing ${totalLeads} lead${totalLeads !== 1 ? 's' : ''}</span>`;
        return;
    }

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalLeads);

    let buttons = '';
    buttons += `<button class="crm-page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="loadLeads(${currentPage - 1})">‹</button>`;

    // Show at most 7 page buttons
    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages = [1];
        if (currentPage > 3) pages.push('...');
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
        if (currentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
    }

    for (const p of pages) {
        if (p === '...') {
            buttons += `<span class="crm-page-ellipsis">…</span>`;
        } else {
            buttons += `<button class="crm-page-btn ${p === currentPage ? 'active' : ''}" onclick="loadLeads(${p})">${p}</button>`;
        }
    }

    buttons += `<button class="crm-page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="loadLeads(${currentPage + 1})">›</button>`;

    container.innerHTML = `
        <span class="crm-pagination-info">${start}–${end} of ${totalLeads}</span>
        <div class="crm-pagination-buttons">${buttons}</div>
    `;
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

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        }) + ' ' + date.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    } catch {
        return dateStr;
    }
}

function teamColorClass(name) {
    if (!name) return '';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const colors = ['team-indigo', 'team-emerald', 'team-amber', 'team-rose', 'team-cyan', 'team-violet', 'team-orange', 'team-teal'];
    return colors[Math.abs(hash) % colors.length];
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
    if (selectedLeadIds.size === 0) {
        Toast.info('Select at least one lead first');
        return;
    }
    try {
        // Load teams
        const teams = await api.request('/crm/teams');
        if (!teams || teams.length === 0) {
            Toast.error('No teams found. Create a team in Settings first.');
            return;
        }
        // Build a simple picker
        const items = teams.map(t =>
            `<div class="assign-team-option" data-team-id="${t.id}" onclick="confirmBulkAssign('${t.id}', '${(t.team_name || '').replace(/'/g, "\\'")}')">
                <strong>${escHtml(t.team_name)}</strong>
                <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:8px;">${t.team_code || ''}</span>
            </div>`
        ).join('');
        const html = `<div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">${items}</div>`;
        // Use a confirm-style dialog
        const modal = document.createElement('div');
        modal.className = 'gm-overlay active';
        modal.id = 'bulkAssignOverlay';
        modal.innerHTML = `
            <div class="gm-modal gm-sm">
                <div class="gm-header">
                    <div class="gm-header-left">
                        <div class="gm-title-group">
                            <h3 class="gm-title">Assign ${selectedLeadIds.size} lead(s) to team</h3>
                            <p class="gm-subtitle">Pick a team below</p>
                        </div>
                    </div>
                    <button class="gm-close" onclick="document.getElementById('bulkAssignOverlay').remove()">&times;</button>
                </div>
                <div class="gm-body">${html}</div>
                <div class="gm-footer" style="display:flex;justify-content:flex-end;">
                    <button class="btn btn-outline-secondary" onclick="document.getElementById('bulkAssignOverlay').remove()">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    } catch (e) {
        Toast.error('Failed to load teams');
        console.error(e);
    }
}

function escHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

async function confirmBulkAssign(teamId, teamName) {
    try {
        // Filter out leads already assigned to a team (client-side check)
        const allIds = Array.from(selectedLeadIds);
        const alreadyAssigned = allIds.filter(id => {
            const row = document.querySelector(`tr[data-lead-id="${id}"]`);
            if (!row) return false;
            const teamCell = row.querySelector('.crm-team-badge');
            return !!teamCell;
        });
        const ids = allIds.filter(id => !alreadyAssigned.includes(id));

        if (ids.length === 0) {
            Toast.warning('All selected leads are already assigned to a team.');
            return;
        }
        if (alreadyAssigned.length > 0) {
            Toast.info(`${alreadyAssigned.length} lead(s) skipped — already assigned to a team.`);
        }

        await api.request('/crm/leads/bulk-assign-team', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_ids: ids, team_id: teamId })
        });
        Toast.success(`${ids.length} lead(s) assigned to ${teamName}`);
        document.getElementById('bulkAssignOverlay')?.remove();
        selectedLeadIds.clear();
        loadLeads();
    } catch (e) {
        Toast.error(e.message || 'Assignment failed');
    }
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
    const submitBtn = document.getElementById('leadSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="leadSubmitSpinner" style="display:none;"></span> Create Lead';
    document.getElementById('leadForm').reset();
    if (leadSourceDropdown) leadSourceDropdown.setValue('');
    if (leadStatusDropdown) leadStatusDropdown.setValue('');
    document.getElementById('leadId').value = '';
    // Clear new fields
    ['leadCity','leadState','leadCountry','leadPincode','leadAddress','leadAltPhone','leadWebsite','leadCampaign','leadProductInterest','leadEstimatedValue'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    clearCustomFieldRows();
    clearCapturedData();
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

    const customFields = getCustomFieldsFromForm();

    const formData = {
        first_name: document.getElementById('leadFirstName').value.trim(),
        last_name: document.getElementById('leadLastName').value.trim(),
        email: document.getElementById('leadEmail').value.trim(),
        phone: document.getElementById('leadPhone').value.trim(),
        company_name: document.getElementById('leadCompany').value.trim(),
        job_title: document.getElementById('leadJobTitle').value.trim(),
        lead_source: leadSourceDropdown ? (leadSourceDropdown.getValue() || '') : document.getElementById('leadSource').value,
        status: leadStatusDropdown ? (leadStatusDropdown.getValue() || '') : document.getElementById('leadStatus').value,
        city: document.getElementById('leadCity').value.trim(),
        state: document.getElementById('leadState').value.trim(),
        country: document.getElementById('leadCountry').value.trim(),
        pincode: document.getElementById('leadPincode').value.trim(),
        address: document.getElementById('leadAddress').value.trim(),
        alternate_phone: document.getElementById('leadAltPhone').value.trim(),
        website: document.getElementById('leadWebsite').value.trim(),
        campaign_name: document.getElementById('leadCampaign').value.trim(),
        product_interest: document.getElementById('leadProductInterest').value.trim(),
        estimated_value: document.getElementById('leadEstimatedValue').value ? parseFloat(document.getElementById('leadEstimatedValue').value) : null,
        notes: document.getElementById('leadNotes').value.trim(),
        custom_fields: Object.keys(customFields).length > 0 ? JSON.stringify(customFields) : null
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
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function editLead(leadId) {
    try {
        const lead = await api.request(`/crm/leads/${leadId}`);
        currentEditLeadId = leadId;

        document.getElementById('leadModalTitle').textContent = 'Edit Lead';
        const editSubmitBtn = document.getElementById('leadSubmitBtn');
        editSubmitBtn.innerHTML = '<span class="btn-spinner" id="leadSubmitSpinner" style="display:none;"></span> Update Lead';
        document.getElementById('leadId').value = leadId;
        document.getElementById('leadFirstName').value = lead.first_name || '';
        document.getElementById('leadLastName').value = lead.last_name || '';
        document.getElementById('leadEmail').value = lead.email || '';
        document.getElementById('leadPhone').value = lead.phone || '';
        document.getElementById('leadCompany').value = lead.company_name || lead.company || '';
        document.getElementById('leadJobTitle').value = lead.job_title || '';
        document.getElementById('leadSource').value = lead.lead_source || 'manual';
        document.getElementById('leadStatus').value = lead.status || 'new';
        if (leadSourceDropdown) leadSourceDropdown.setValue(lead.lead_source || 'manual');
        if (leadStatusDropdown) leadStatusDropdown.setValue(lead.status || 'new');
        document.getElementById('leadCity').value = lead.city || '';
        document.getElementById('leadState').value = lead.state || '';
        document.getElementById('leadCountry').value = lead.country || '';
        document.getElementById('leadPincode').value = lead.pincode || '';
        document.getElementById('leadAddress').value = lead.address || '';
        document.getElementById('leadAltPhone').value = lead.alternate_phone || '';
        document.getElementById('leadWebsite').value = lead.website || '';
        document.getElementById('leadCampaign').value = lead.campaign_name || '';
        document.getElementById('leadProductInterest').value = lead.product_interest || '';
        document.getElementById('leadEstimatedValue').value = lead.estimated_value || '';
        document.getElementById('leadNotes').value = lead.notes || '';

        // Populate custom fields
        populateCustomFieldRows(lead.custom_fields);

        // Populate captured data from source_raw_data
        populateCapturedData(lead.source_raw_data);

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

// ==================== Custom Fields ====================

function getCustomFieldsBadge(customFieldsJson) {
    if (!customFieldsJson || customFieldsJson === '{}') return '';
    try {
        const fields = typeof customFieldsJson === 'string' ? JSON.parse(customFieldsJson) : customFieldsJson;
        const count = Object.keys(fields).length;
        if (count === 0) return '';

        const tooltipItems = Object.entries(fields)
            .slice(0, 5)
            .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v).substring(0, 30))}`)
            .join('&#10;');
        const extra = count > 5 ? `&#10;...and ${count - 5} more` : '';

        return ` <span class="crm-custom-fields-badge" title="${tooltipItems}${extra}">+${count} fields</span>`;
    } catch {
        return '';
    }
}

function addCustomFieldRow(key, value) {
    const list = document.getElementById('customFieldsList');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'custom-field-row';
    row.innerHTML = `
        <input type="text" class="form-control form-control-sm custom-field-key" placeholder="Field name" value="${escapeHtml(key || '')}">
        <input type="text" class="form-control form-control-sm custom-field-value" placeholder="Value" value="${escapeHtml(value || '')}">
        <button type="button" class="btn btn-sm btn-outline-danger custom-field-remove" onclick="this.parentElement.remove()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;
    list.appendChild(row);
}

function clearCustomFieldRows() {
    const list = document.getElementById('customFieldsList');
    if (list) list.innerHTML = '';
}

function populateCustomFieldRows(customFieldsJson) {
    clearCustomFieldRows();
    if (!customFieldsJson || customFieldsJson === '{}') return;
    try {
        const fields = typeof customFieldsJson === 'string' ? JSON.parse(customFieldsJson) : customFieldsJson;
        for (const [key, value] of Object.entries(fields)) {
            addCustomFieldRow(key, String(value));
        }
    } catch (e) {
        console.error('Error parsing custom fields:', e);
    }
}

function getCustomFieldsFromForm() {
    const list = document.getElementById('customFieldsList');
    if (!list) return {};

    const fields = {};
    const rows = list.querySelectorAll('.custom-field-row');
    rows.forEach(row => {
        const key = row.querySelector('.custom-field-key')?.value?.trim();
        const value = row.querySelector('.custom-field-value')?.value?.trim();
        if (key) {
            fields[key] = value || '';
        }
    });
    return fields;
}

// ==================== Captured Data (Source Raw Data) ====================

const CORE_LEAD_FIELDS = new Set([
    'first_name', 'last_name', 'full_name', 'email', 'phone', 'company_name', 'company', 'job_title',
    'lead_source', 'status', 'notes'
]);

function populateCapturedData(sourceRawData) {
    const section = document.getElementById('capturedDataSection');
    const list = document.getElementById('capturedDataList');
    if (!section || !list) return;

    list.innerHTML = '';

    if (!sourceRawData || sourceRawData === '{}') {
        section.style.display = 'none';
        return;
    }

    try {
        const data = typeof sourceRawData === 'string' ? JSON.parse(sourceRawData) : sourceRawData;
        const entries = Object.entries(data).filter(([key]) => !CORE_LEAD_FIELDS.has(key));

        if (entries.length === 0) {
            section.style.display = 'none';
            return;
        }

        entries.forEach(([key, value]) => {
            const item = document.createElement('div');
            item.className = 'captured-data-item';
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            item.innerHTML = `
                <span class="captured-data-label">${escapeHtml(label)}</span>
                <span class="captured-data-value">${escapeHtml(String(value || '-'))}</span>
            `;
            list.appendChild(item);
        });

        section.style.display = 'block';
    } catch (e) {
        console.error('Error parsing source_raw_data:', e);
        section.style.display = 'none';
    }
}

function clearCapturedData() {
    const section = document.getElementById('capturedDataSection');
    const list = document.getElementById('capturedDataList');
    if (section) section.style.display = 'none';
    if (list) list.innerHTML = '';
}

function toggleCapturedData() {
    const list = document.getElementById('capturedDataList');
    const chevron = document.getElementById('capturedDataChevron');
    if (!list) return;
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? '' : 'none';
    if (chevron) chevron.style.transform = isHidden ? '' : 'rotate(-90deg)';
}

// ==================== Utilities ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
