/**
 * PMS Client Detail
 * Shows client info, their projects (clickable to project-detail), and contacts.
 */

// ==================== State ====================
let clientId = null;
let client = null;
let clientProjects = [];
let clientContacts = [];
let currentEditProjectId = null;

// SearchableDropdown instances
let projectFormStatusDropdown = null;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');

    clientId = new URLSearchParams(window.location.search).get('id');
    if (!clientId) {
        window.location.href = 'clients.html';
        return;
    }

    loadClientDetail();
    renderClientDetailActions();

    // Init searchable dropdowns
    if (typeof convertSelectToSearchable === 'function') {
        projectFormStatusDropdown = convertSelectToSearchable('projectFormStatus', { placeholder: 'Select status...' });
    }
});

// ==================== Data Loading ====================

async function loadClientDetail() {
    try {
        client = await api.request(`/pms/clients/${clientId}`);
        if (client.data) client = client.data;
        renderClientHeader();
        loadClientProjects();
        loadClientContacts();
    } catch (error) {
        console.error('Failed to load client:', error);
        Toast.error('Failed to load client details');
        setTimeout(() => window.location.href = 'clients.html', 1500);
    }
}

function renderClientHeader() {
    document.title = `${client.client_name} - PMS | Ragenaizer`;
    document.getElementById('breadcrumbClient').textContent = client.client_name;
    document.getElementById('clientTitle').textContent = client.client_name;
    document.getElementById('clientAvatar').textContent = getInitials(client.client_name);

    // Industry badge
    const industryEl = document.getElementById('clientIndustry');
    if (client.industry) {
        industryEl.textContent = client.industry;
        industryEl.style.display = 'inline-block';
    }

    // Website
    const websiteEl = document.getElementById('clientWebsite');
    if (client.website) {
        websiteEl.href = client.website;
        websiteEl.textContent = client.website.replace(/^https?:\/\//, '');
    } else {
        websiteEl.removeAttribute('href');
        websiteEl.textContent = '-';
    }

    // Location
    const location = [client.city, client.state, client.country].filter(Boolean).join(', ');
    document.getElementById('clientLocation').textContent = location || '-';

    // Counts
    document.getElementById('clientProjectCount').textContent = client.project_count || 0;
    document.getElementById('clientContactCount').textContent = client.contact_count || 0;

    // Notes
    const notesEl = document.getElementById('clientNotes');
    if (client.notes) {
        notesEl.textContent = client.notes;
        notesEl.style.display = 'block';
    }
}

// ==================== Projects Section ====================

async function loadClientProjects() {
    const tbody = document.getElementById('clientProjectsBody');
    try {
        const response = await api.request(`/pms/projects?clientId=${clientId}`);
        clientProjects = response.data || response || [];
        document.getElementById('clientProjectCount').textContent = clientProjects.length;

        // Update stats cards
        const el = (id) => document.getElementById(id);
        if (el('statTotalTasks')) el('statTotalTasks').textContent = clientProjects.reduce((sum, p) => sum + (p.task_count || 0), 0);
        if (el('statCompletedTasks')) el('statCompletedTasks').textContent = clientProjects.reduce((sum, p) => sum + (p.completed_task_count || 0), 0);
        if (el('statTotalMembers')) el('statTotalMembers').textContent = clientProjects.reduce((sum, p) => sum + (p.member_count || 0), 0);
        if (el('statTotalHours')) el('statTotalHours').textContent = clientProjects.reduce((sum, p) => sum + (p.total_hours_logged || 0), 0).toFixed(1);

        if (!clientProjects.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="crm-empty-state"><div class="crm-empty-content"><p>No projects yet</p><button class="btn btn-sm btn-primary" onclick="openNewProjectModal()">Create first project</button></div></td></tr>`;
            return;
        }

        tbody.innerHTML = clientProjects.map(p => `
            <tr data-clickable onclick="navigateToProject('${p.id}')" style="cursor: pointer;">
                <td>
                    <div class="crm-cell-primary" style="color: var(--brand-primary);">${escapeHtml(p.project_name || '')}</div>
                    ${p.description ? `<div class="crm-cell-secondary">${escapeHtml(truncate(p.description, 50))}</div>` : ''}
                </td>
                <td><span class="crm-status-badge status-${getStatusClass(p.status)}">${formatStatus(p.status)}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${p.task_count ?? 0}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${p.member_count ?? 0}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${(p.total_hours_logged ?? 0).toFixed(1)}</span></td>
                <td class="hide-mobile"><span class="crm-cell-secondary">${formatDate(p.start_date)}</span></td>
                <td>
                    <div class="crm-actions" onclick="event.stopPropagation();">
                        <button class="crm-action-btn" onclick="navigateToProject('${p.id}')" title="Open">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load projects</p></div></td></tr>`;
    }
}

function navigateToProject(projectId) {
    window.location.href = `project-detail.html?id=${projectId}`;
}

// ==================== Contacts Section ====================

async function loadClientContacts() {
    const container = document.getElementById('contactsList');
    try {
        const response = await api.request(`/pms/client-contacts?clientId=${clientId}`);
        clientContacts = response.data || response || [];
        document.getElementById('clientContactCount').textContent = clientContacts.length;

        if (!clientContacts.length) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No contacts yet. Click <strong>Add Contact</strong> to add the first one.</p>';
            return;
        }

        container.innerHTML = clientContacts.map(c => `
            <div class="pms-contact-card">
                <div class="pms-contact-info">
                    <div class="pms-contact-avatar">${getInitials(c.contact_name)}</div>
                    <div>
                        <div class="pms-contact-name">
                            ${escapeHtml(c.contact_name)}
                            ${c.is_primary ? '<span class="pms-primary-badge">Primary</span>' : ''}
                        </div>
                        <div class="pms-contact-detail">
                            ${escapeHtml(c.designation || '')}${c.designation && c.email ? ' &middot; ' : ''}${escapeHtml(c.email || '')}
                            ${c.phone ? ` &middot; ${escapeHtml(c.phone)}` : ''}
                        </div>
                    </div>
                </div>
                <button class="crm-action-btn action-delete" onclick="deleteContact('${c.id}')" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Failed to load contacts</p>';
    }
}

function toggleAddContactForm() {
    const form = document.getElementById('addContactForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function handleContactSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('contactSubmitBtn');
    const spinner = document.getElementById('contactSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        client_id: clientId,
        contact_name: document.getElementById('contactName').value.trim(),
        email: document.getElementById('contactEmail').value.trim(),
        phone: document.getElementById('contactPhone').value.trim(),
        designation: document.getElementById('contactDesignation').value.trim()
    };

    try {
        await api.request('/pms/client-contacts', { method: 'POST', body: JSON.stringify(formData) });
        Toast.success('Contact added');
        document.getElementById('contactName').value = '';
        document.getElementById('contactEmail').value = '';
        document.getElementById('contactPhone').value = '';
        document.getElementById('contactDesignation').value = '';
        loadClientContacts();
    } catch (error) {
        Toast.error(error.message || 'Failed to add contact');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteContact(contactId) {
    if (!await showConfirm('Delete this contact?', 'Delete Contact', 'danger')) return;
    try {
        await api.request(`/pms/client-contacts/${contactId}`, { method: 'DELETE' });
        Toast.success('Contact deleted');
        loadClientContacts();
    } catch (error) {
        Toast.error('Failed to delete contact');
    }
}

// ==================== Client Edit ====================

/**
 * Refactored 2026-04-14: client fields are owned by Accounts. This renders the
 * header action as either a live link (if the user has an Accounts role) or a
 * soft informational button that surfaces a toast directing them to Finance.
 */
function renderClientDetailActions() {
    const host = document.getElementById('clientDetailActions');
    if (!host) return;
    let hasAccountsAccess = false;
    try {
        const user = JSON.parse(localStorage.getItem('ragenaizer_user') || '{}');
        const allowed = ['SUPERADMIN','ACCOUNTS_ADMIN','ACCOUNTS_USER','ACCOUNTS_MANAGER','ACCOUNTS_AUDITOR'];
        hasAccountsAccess = (user.roles || []).some(r => allowed.includes(r));
    } catch {}

    if (hasAccountsAccess) {
        host.innerHTML = `
            <a class="btn btn-secondary btn-sm" href="../accounts/parties.html#customer-list" title="Manage this customer in Accounts">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Manage in Accounts
            </a>`;
    } else {
        host.innerHTML = `
            <button class="btn btn-sm" style="background:transparent;border:1px solid var(--border-primary);color:var(--text-secondary);cursor:default"
                    onclick="(typeof Toast!=='undefined'?Toast.info:alert)('Client details are owned by the Accounts module. Please contact your Accounts team to update this client — your current role does not include Accounts access.')"
                    title="Managed by the Accounts team">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Managed by Accounts
            </button>`;
    }
}

function openEditClientModal() {
    document.getElementById('editClientName').value = client.client_name || '';
    document.getElementById('editClientIndustry').value = client.industry || '';
    document.getElementById('editClientWebsite').value = client.website || '';
    document.getElementById('editClientCountry').value = client.country || '';
    document.getElementById('editClientCity').value = client.city || '';
    document.getElementById('editClientState').value = client.state || '';
    document.getElementById('editClientNotes').value = client.notes || '';
    openModal('clientModal');
}

function closeClientModal() { closeModal('clientModal'); }

async function handleClientSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('clientSubmitBtn');
    const spinner = document.getElementById('clientSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        id: clientId,
        client_name: document.getElementById('editClientName').value.trim(),
        industry: document.getElementById('editClientIndustry').value.trim(),
        website: document.getElementById('editClientWebsite').value.trim(),
        country: document.getElementById('editClientCountry').value.trim(),
        city: document.getElementById('editClientCity').value.trim(),
        state: document.getElementById('editClientState').value.trim(),
        notes: document.getElementById('editClientNotes').value.trim()
    };

    try {
        await api.request('/pms/clients', { method: 'PUT', body: JSON.stringify(formData) });
        Toast.success('Client updated');
        closeClientModal();
        loadClientDetail();
    } catch (error) {
        Toast.error(error.message || 'Failed to update client');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteCurrentClient() {
    if (!await showConfirm('Delete this client? This cannot be undone.', 'Delete Client', 'danger')) return;
    try {
        await api.request(`/pms/clients/${clientId}`, { method: 'DELETE' });
        Toast.success('Client deleted');
        window.location.href = 'clients.html';
    } catch (error) {
        Toast.error('Failed to delete client');
    }
}

// ==================== New Project (pre-filled with client) ====================

function openNewProjectModal() {
    currentEditProjectId = null;
    document.getElementById('projectModalTitle').textContent = 'New Project';
    document.getElementById('projectSubmitBtn').innerHTML = '<span class="btn-spinner" id="projectSubmitSpinner" style="display:none;"></span> Create Project';
    document.getElementById('projectForm').reset();
    document.getElementById('projectFormId').value = '';
    openModal('projectModal');
}

function closeProjectModal() { closeModal('projectModal'); currentEditProjectId = null; }

async function handleProjectSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('projectSubmitBtn');
    const spinner = document.getElementById('projectSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        client_id: clientId,
        project_name: document.getElementById('projectFormName').value.trim(),
        status: document.getElementById('projectFormStatus').value,
        budget: parseFloat(document.getElementById('projectFormBudget').value) || null,
        start_date: document.getElementById('projectFormStartDate').value || null,
        end_date: document.getElementById('projectFormEndDate').value || null,
        description: document.getElementById('projectFormDescription').value.trim()
    };

    try {
        if (currentEditProjectId) {
            formData.id = currentEditProjectId;
            await api.request('/pms/projects', { method: 'PUT', body: JSON.stringify(formData) });
            Toast.success('Project updated');
        } else {
            await api.request('/pms/projects', { method: 'POST', body: JSON.stringify(formData) });
            Toast.success('Project created');
        }
        closeProjectModal();
        loadClientProjects();
    } catch (error) {
        Toast.error(error.message || 'Failed to save project');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== Shared Utilities ====================

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => modal.classList.add('active'));
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.classList.remove('gm-animating'), 200);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return dateStr; }
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
}

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
}

function formatStatus(status) {
    const labels = { 'not_started': 'Not Started', 'in_progress': 'In Progress', 'on_hold': 'On Hold', 'completed': 'Completed', 'cancelled': 'Cancelled' };
    return labels[status] || status || 'Not Started';
}

function getStatusClass(status) {
    const map = { 'not_started': 'new', 'in_progress': 'qualified', 'on_hold': 'contacted', 'completed': 'converted', 'cancelled': 'lost' };
    return map[status] || 'new';
}
