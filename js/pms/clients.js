/**
 * PMS Clients Management
 * Handles CRUD operations, filtering, and client contacts.
 */

// ==================== State ====================
let allClients = [];
let currentEditClientId = null;
let currentContactsClientId = null;

// ==================== Role helpers ====================
/**
 * True if the current user has any role that gives them access to the Accounts
 * module (so the "Manage in Accounts" link would actually work). A PMS developer
 * with only PMS_USER shouldn't be bounced into a 403 — we show them a toast
 * telling them to contact Finance instead.
 */
function _hasAccountsAccess() {
    try {
        const user = JSON.parse(localStorage.getItem('ragenaizer_user') || '{}');
        const roles = user.roles || [];
        const allowed = ['SUPERADMIN','ACCOUNTS_ADMIN','ACCOUNTS_USER','ACCOUNTS_MANAGER','ACCOUNTS_AUDITOR'];
        return roles.some(r => allowed.includes(r));
    } catch { return false; }
}
/** True if the current user can trigger the legacy-client reconciliation. */
function _canReconcile() {
    try {
        const user = JSON.parse(localStorage.getItem('ragenaizer_user') || '{}');
        const roles = user.roles || [];
        return roles.includes('PMS_ADMIN') || roles.includes('SUPERADMIN');
    } catch { return false; }
}

/**
 * Handler for the row-level "Manage" action. If the current user has Accounts
 * access we send them straight to the customer list; otherwise we surface a
 * friendly note pointing them at Finance so they don't hit a permission wall.
 */
function manageClientInAccounts() {
    if (_hasAccountsAccess()) {
        window.location.href = '../accounts/parties.html#customer-list';
        return;
    }
    const msg = 'Client details are owned by the Accounts module. To update this client please contact your Accounts team — your current role does not include Accounts access.';
    if (typeof Toast !== 'undefined') Toast.info(msg);
    else alert(msg);
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('pms', '../');
    loadClients();
    checkOrphanedClients();
});

// ==================== Reconciliation banner ====================
// Surface legacy PMS clients that have no Accounts customer record. Lets a
// PMS admin one-shot submit them as pending requests in Accounts so Finance
// can approve them — preserving their UUID (and therefore their project /
// task / time-entry FKs) intact.
async function checkOrphanedClients() {
    // Only PMS admins can trigger the reconciliation, so only show the banner
    // to them. A PMS_USER seeing an amber "click to fix" that they can't
    // actually click is worse than not seeing the banner at all.
    if (!_canReconcile()) return;
    try {
        const response = await api.request('/pms/clients/orphans-count');
        const count = response.orphan_count || 0;
        if (count > 0) renderReconcileBanner(count);
    } catch (e) {
        // Endpoint missing on older builds — silent
        console.warn('Orphan-count probe failed:', e.message || e);
    }
}

function renderReconcileBanner(count) {
    // Insert inside .crm-container after stats grid so it stays within page width
    const anchor = document.querySelector('.crm-stats-grid, #clientStatsGrid');
    const container = document.querySelector('.crm-container') || document.querySelector('.crm-page, main, .main-content') || document.body;
    const banner = document.createElement('div');
    banner.id = 'pmsReconcileBanner';
    banner.style.cssText = 'margin:16px 0;padding:14px 18px;background:var(--bg-tertiary,#1f2128);border:1px solid var(--color-warning,#b07a1d);border-left:3px solid var(--color-warning,#b07a1d);border-radius:6px;display:flex;gap:12px;align-items:flex-start;justify-content:space-between';
    banner.innerHTML = `
        <div style="display:flex;gap:12px;align-items:flex-start">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning,#b07a1d)" stroke-width="2" style="flex-shrink:0;margin-top:2px">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div style="font-size:13px;line-height:1.5;color:var(--text-secondary,#a8aab3)">
                <strong>${count} legacy client${count===1?'':'s'} need${count===1?'s':''} to be promoted to Accounts.</strong>
                These were created in PMS before the migration to the Accounts-as-source-of-truth model. Click below to submit them as pending customer requests &mdash; their UUIDs (and all existing project/task/time-entry links) will be preserved through Finance approval.
            </div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="runClientReconciliation(this)" style="white-space:nowrap;flex-shrink:0">Run Reconciliation</button>
    `;
    if (anchor && anchor.nextSibling) {
        container.insertBefore(banner, anchor.nextSibling);
    } else {
        container.appendChild(banner);
    }
}

async function runClientReconciliation(btn) {
    const confirmed = await Confirm.show({
        title: 'Run Client Reconciliation',
        message: 'Submit all orphaned PMS clients to Accounts as pending customer requests? Finance will need to approve each one before they reappear here.',
        type: 'warning'
    });
    if (!confirmed) return;
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
        const result = await api.request('/pms/clients/reconcile-with-accounts', { method: 'POST' });
        const msg = `Reconciliation complete. ${result.requests_submitted} request${result.requests_submitted===1?'':'s'} submitted to Accounts. ${result.submission_failures ? result.submission_failures + ' failure(s).' : ''} ${result.already_in_accounts} customer(s) were already in Accounts.`;
        if (typeof Toast !== 'undefined') Toast.success(msg);
        else alert(msg);
        const banner = document.getElementById('pmsReconcileBanner');
        if (banner) banner.remove();
    } catch (e) {
        const m = 'Reconciliation failed: ' + (e.message || e);
        if (typeof Toast !== 'undefined') Toast.error(m);
        else alert(m);
        btn.disabled = false;
        btn.textContent = 'Run Reconciliation';
    }
}

// ==================== Data Loading ====================

/**
 * Load clients from the API
 */
async function loadClients() {
    try {
        const response = await api.request('/pms/clients');
        allClients = response.data || response || [];
        renderClientsTable(allClients);
        loadClientStats();
    } catch (error) {
        console.error('Failed to load clients:', error);
        renderClientsTable([]);
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to load clients');
        }
    }
}

/**
 * Load client statistics from local data
 */
function loadClientStats() {
    const totalClients = allClients.length;
    const totalContacts = allClients.reduce((sum, c) => sum + (c.contact_count || 0), 0);
    const activeProjects = allClients.reduce((sum, c) => sum + (c.project_count || 0), 0);
    const industries = new Set(allClients.map(c => c.industry).filter(Boolean));

    document.getElementById('statTotalClients').textContent = totalClients;
    document.getElementById('statActiveProjects').textContent = activeProjects;
    document.getElementById('statTotalContacts').textContent = totalContacts;
    document.getElementById('statIndustries').textContent = industries.size;
}

// ==================== Filter Handling ====================

/**
 * Apply client-side search filter
 */
function applyFilters() {
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();

    if (!search) {
        renderClientsTable(allClients);
        return;
    }

    const filtered = allClients.filter(client => {
        const name = (client.client_name || '').toLowerCase();
        const industry = (client.industry || '').toLowerCase();
        const website = (client.website || '').toLowerCase();
        const city = (client.city || '').toLowerCase();
        const country = (client.country || '').toLowerCase();
        return name.includes(search) || industry.includes(search) || website.includes(search) || city.includes(search) || country.includes(search);
    });

    renderClientsTable(filtered);
}

// ==================== Table Rendering ====================

/**
 * Render the clients table
 */
function renderClientsTable(clients) {
    const tbody = document.getElementById('clientsTableBody');

    if (!clients || clients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                            <polyline points="9 22 9 12 15 12 15 22"/>
                        </svg>
                        <p>No clients yet</p>
                        <p style="font-size: 13px; color: var(--text-muted); margin-top: 8px;">Clients are managed in <a href="../accounts/parties.html#customer-list" style="color: var(--brand-primary)">Accounts</a> &mdash; close a deal Won in CRM or have Finance approve a customer there. Approved customers will appear here automatically.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = clients.map(client => `
        <tr data-client-id="${client.id}" data-clickable onclick="window.location.href='client-detail.html?id=${client.id}'" style="cursor: pointer;">
            <td>
                <div class="crm-cell-primary" style="display: flex; align-items: center; gap: 10px;">
                    <div class="crm-avatar" style="width: 32px; height: 32px; border-radius: 8px; background: var(--brand-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0;">
                        ${getInitials(client.client_name)}
                    </div>
                    <div>
                        <div style="color: var(--brand-primary);">${escapeHtml(client.client_name || '')}</div>
                        ${client.city || client.country ? `<div class="crm-cell-secondary">${escapeHtml([client.city, client.country].filter(Boolean).join(', '))}</div>` : ''}
                    </div>
                </div>
            </td>
            <td>
                ${client.industry ? `<span class="crm-source-badge">${escapeHtml(client.industry)}</span>` : '<span class="crm-cell-secondary">-</span>'}
            </td>
            <td class="hide-mobile">
                ${client.website ? `<a href="${escapeHtml(client.website)}" target="_blank" rel="noopener noreferrer" style="color: var(--brand-primary); text-decoration: none;">${escapeHtml(client.website.replace(/^https?:\/\//, ''))}</a>` : '<span class="crm-cell-secondary">-</span>'}
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${client.project_count || 0}</span>
            </td>
            <td class="hide-mobile">
                <a href="javascript:void(0)" onclick="openContactsModal('${client.id}', '${escapeHtml(client.client_name)}')" style="color: var(--brand-primary); text-decoration: none;">${client.contact_count || 0}</a>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${formatDate(client.created_at)}</span>
            </td>
            <td>
                <div class="crm-actions" onclick="event.stopPropagation();">
                    <button class="crm-action-btn" onclick="openContactsModal('${client.id}', '${escapeHtml(client.client_name)}')" title="Contacts">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                    </button>
                    <button class="crm-action-btn" onclick="manageClientInAccounts()"
                            title="${_hasAccountsAccess() ? 'Manage this customer in Accounts' : 'Contact the Accounts team to update this client'}"
                            style="display:inline-flex;align-items:center;justify-content:center;color:var(--text-secondary);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${_hasAccountsAccess()
                                ? `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`
                                : `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`}
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
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

function openNewClientModal() {
    currentEditClientId = null;
    document.getElementById('clientModalTitle').textContent = 'New Client';
    const submitBtn = document.getElementById('clientSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="clientSubmitSpinner" style="display:none;"></span> Create Client';
    document.getElementById('clientForm').reset();
    document.getElementById('clientId').value = '';
    openModal('clientModal');
}

function openEditClientModal(id) {
    const client = allClients.find(c => c.id === id);
    if (!client) {
        Toast.error('Client not found');
        return;
    }

    currentEditClientId = id;
    document.getElementById('clientModalTitle').textContent = 'Edit Client';
    const submitBtn = document.getElementById('clientSubmitBtn');
    submitBtn.innerHTML = '<span class="btn-spinner" id="clientSubmitSpinner" style="display:none;"></span> Update Client';
    document.getElementById('clientId').value = id;
    document.getElementById('clientName').value = client.client_name || '';
    document.getElementById('clientIndustry').value = client.industry || '';
    document.getElementById('clientContactPerson').value = client.contact_person || '';
    document.getElementById('clientEmail').value = client.email || '';
    document.getElementById('clientPhone').value = client.phone || '';
    document.getElementById('clientWebsite').value = client.website || '';
    document.getElementById('clientAddress').value = client.address || '';
    document.getElementById('clientCity').value = client.city || '';
    document.getElementById('clientState').value = client.state || '';
    document.getElementById('clientCountry').value = client.country || '';
    document.getElementById('clientPostalCode').value = client.postal_code || '';
    document.getElementById('clientPaymentTerms').value = client.payment_terms || '';
    document.getElementById('clientGstNumber').value = client.tax_id || '';
    document.getElementById('clientPanNumber').value = client.pan_number || '';
    document.getElementById('clientNotes').value = client.notes || '';
    openModal('clientModal');
}

function closeClientModal() {
    closeModal('clientModal');
    currentEditClientId = null;
}

// ==================== CRUD Operations ====================

async function handleClientSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('clientSubmitBtn');
    const spinner = document.getElementById('clientSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        client_name: document.getElementById('clientName').value.trim(),
        industry: document.getElementById('clientIndustry').value.trim(),
        contact_person: document.getElementById('clientContactPerson')?.value.trim() || '',
        email: document.getElementById('clientEmail')?.value.trim() || '',
        phone: document.getElementById('clientPhone')?.value.trim() || '',
        website: document.getElementById('clientWebsite').value.trim(),
        tax_id: document.getElementById('clientGstNumber')?.value.trim() || '',
        pan_number: document.getElementById('clientPanNumber')?.value.trim() || '',
        address: document.getElementById('clientAddress').value.trim(),
        city: document.getElementById('clientCity').value.trim(),
        state: document.getElementById('clientState').value.trim(),
        country: document.getElementById('clientCountry').value.trim(),
        postal_code: document.getElementById('clientPostalCode').value.trim(),
        payment_terms: document.getElementById('clientPaymentTerms')?.value.trim() || '',
        notes: document.getElementById('clientNotes').value.trim()
    };

    try {
        if (currentEditClientId) {
            formData.id = currentEditClientId;
            await api.request('/pms/clients', {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            Toast.success('Client updated successfully');
        } else {
            await api.request('/pms/clients', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            Toast.success('Client created successfully');
        }

        closeClientModal();
        loadClients();
    } catch (error) {
        console.error('Failed to save client:', error);
        Toast.error(error.message || 'Failed to save client');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteClient(id) {
    const confirmed = await showConfirm('Are you sure you want to delete this client?', 'Delete Client', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/pms/clients/${id}`, { method: 'DELETE' });
        Toast.success('Client deleted');
        loadClients();
    } catch (error) {
        console.error('Failed to delete client:', error);
        Toast.error('Failed to delete client');
    }
}

// ==================== Client Contacts ====================

async function openContactsModal(clientId, clientName) {
    currentContactsClientId = clientId;
    document.getElementById('contactsModalTitle').textContent = `Contacts - ${clientName}`;
    document.getElementById('contactClientId').value = clientId;
    document.getElementById('contactForm').reset();
    document.getElementById('contactIsPrimary').checked = false;
    openModal('contactsModal');
    await loadContacts(clientId);
}

function closeContactsModal() {
    closeModal('contactsModal');
    currentContactsClientId = null;
}

async function loadContacts(clientId) {
    const list = document.getElementById('contactsList');
    list.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Loading contacts...</p>';

    try {
        const response = await api.request(`/pms/client-contacts?clientId=${clientId}`);
        const contacts = response.data || response || [];
        renderContactsList(contacts);
    } catch (error) {
        console.error('Failed to load contacts:', error);
        list.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Failed to load contacts</p>';
    }
}

function renderContactsList(contacts) {
    const list = document.getElementById('contactsList');

    if (!contacts || contacts.length === 0) {
        list.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No contacts yet</p>';
        return;
    }

    list.innerHTML = contacts.map(contact => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border: 1px solid var(--border-primary); border-radius: 8px; margin-bottom: 8px; background: var(--bg-tertiary);">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--brand-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0;">
                    ${getInitials(contact.contact_name)}
                </div>
                <div>
                    <div style="color: var(--text-primary); font-weight: 500; font-size: 13px;">
                        ${escapeHtml(contact.contact_name)}
                        ${contact.is_primary ? '<span style="background: var(--color-success); color: var(--text-inverse); font-size: 10px; padding: 1px 6px; border-radius: 4px; margin-left: 6px;">Primary</span>' : ''}
                    </div>
                    <div style="color: var(--text-secondary); font-size: 12px;">
                        ${escapeHtml(contact.designation || '')}${contact.designation && contact.email ? ' &middot; ' : ''}${escapeHtml(contact.email || '')}
                        ${contact.phone ? ` &middot; ${escapeHtml(contact.phone)}` : ''}
                    </div>
                </div>
            </div>
            <button class="crm-action-btn action-delete" onclick="deleteContact('${contact.id}')" title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </button>
        </div>
    `).join('');
}

async function handleContactSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('contactSubmitBtn');
    const spinner = document.getElementById('contactSubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        client_id: document.getElementById('contactClientId').value,
        contact_name: document.getElementById('contactName').value.trim(),
        email: document.getElementById('contactEmail').value.trim(),
        phone: document.getElementById('contactPhone').value.trim(),
        designation: document.getElementById('contactDesignation').value.trim(),
        is_primary: document.getElementById('contactIsPrimary').checked
    };

    try {
        await api.request('/pms/client-contacts', {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        Toast.success('Contact added');
        document.getElementById('contactForm').reset();
        document.getElementById('contactIsPrimary').checked = false;
        await loadContacts(currentContactsClientId);
        // Refresh clients to update contact counts
        loadClients();
    } catch (error) {
        console.error('Failed to add contact:', error);
        Toast.error(error.message || 'Failed to add contact');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function deleteContact(contactId) {
    const confirmed = await showConfirm('Are you sure you want to delete this contact?', 'Delete Contact', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/pms/client-contacts/${contactId}`, { method: 'DELETE' });
        Toast.success('Contact deleted');
        if (currentContactsClientId) {
            await loadContacts(currentContactsClientId);
        }
        // Refresh clients to update contact counts
        loadClients();
    } catch (error) {
        console.error('Failed to delete contact:', error);
        Toast.error('Failed to delete contact');
    }
}

// ==================== Utilities ====================

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
