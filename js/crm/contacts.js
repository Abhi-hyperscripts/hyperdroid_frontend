/**
 * CRM Contacts Page JavaScript
 * Handles CRUD operations, search/filter, and modal management for contacts
 */

let contacts = [];
let companies = [];
let editingContactId = null;
let deletingContactId = null;
let contactCompanyDropdown = null;
let contactSourceDropdown = null;

// Utility function to escape HTML special characters
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format date for display
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Initialization ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('crm', '../');

    initSearchableDropdowns();

    // Load data
    await Promise.all([
        loadContacts(),
        loadCompanies()
    ]);
});

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    if (!contactCompanyDropdown) {
        contactCompanyDropdown = convertSelectToSearchable('contactCompany', {
            placeholder: '-- Select Company --',
            searchPlaceholder: 'Search companies...'
        });
    }

    if (!contactSourceDropdown) {
        contactSourceDropdown = convertSelectToSearchable('contactSource', {
            placeholder: '-- Select Source --',
            searchPlaceholder: 'Search sources...'
        });
    }
}

// ─── Data Loading ───────────────────────────────────────────────────────────

async function loadContacts() {
    try {
        showLoading(true);
        const result = await api.request('/crm/contacts');
        contacts = result || [];
        renderContacts();
    } catch (error) {
        console.error('Error loading contacts:', error);
        Toast.error('Failed to load contacts');
        contacts = [];
        renderContacts();
    } finally {
        showLoading(false);
    }
}

async function loadCompanies() {
    try {
        const result = await api.request('/crm/companies');
        companies = result || [];
        populateCompanyDropdown();
    } catch (error) {
        console.error('Error loading companies:', error);
        companies = [];
    }
}

function populateCompanyDropdown() {
    const select = document.getElementById('contactCompany');
    if (!select) return;

    // Keep the default option
    select.innerHTML = '<option value="">-- Select Company --</option>';

    companies.forEach(company => {
        const option = document.createElement('option');
        option.value = company.id;
        option.textContent = company.company_name;
        select.appendChild(option);
    });

    // Update searchable dropdown
    if (contactCompanyDropdown) {
        contactCompanyDropdown.setOptions([
            { value: '', label: '-- Select Company --' },
            ...companies.map(c => ({ value: c.id, label: c.company_name }))
        ]);
    }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderContacts() {
    const tbody = document.getElementById('contactsTableBody');
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.querySelector('.data-table-container');

    if (!contacts.length) {
        tbody.innerHTML = '';
        tableContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';

    tbody.innerHTML = contacts.map(contact => {
        const companyName = getCompanyName(contact.company_id);
        const fullName = escapeHtml(`${contact.first_name || ''} ${contact.last_name || ''}`.trim());
        const initials = getInitials(contact.first_name, contact.last_name);

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--brand-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 600; flex-shrink: 0;">
                            ${escapeHtml(initials)}
                        </div>
                        <span style="font-weight: 500; cursor: pointer;" onclick="openContactDetailPanel('${contact.id}')">${fullName}</span>
                    </div>
                </td>
                <td>${escapeHtml(contact.email) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${escapeHtml(contact.phone || contact.mobile) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${companyName ? escapeHtml(companyName) : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${contact.contact_source ? `<span class="badge badge-neutral">${escapeHtml(contact.contact_source)}</span>` : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${escapeHtml(contact.job_title) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td style="white-space: nowrap;">${formatDate(contact.created_at)}</td>
                <td class="actions-cell">
                    <button class="action-btn" title="Edit" onclick="openEditContactModal('${contact.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="action-btn delete" title="Delete" onclick="openDeleteModal('${contact.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function getCompanyName(companyId) {
    if (!companyId) return null;
    const company = companies.find(c => c.id === companyId);
    return company ? company.company_name : null;
}

function getInitials(firstName, lastName) {
    const f = (firstName || '')[0] || '';
    const l = (lastName || '')[0] || '';
    return (f + l).toUpperCase() || '?';
}

// ─── Search / Filter ────────────────────────────────────────────────────────

function filterContacts() {
    const query = document.getElementById('contactSearch').value.toLowerCase().trim();

    if (!query) {
        renderContacts();
        return;
    }

    const filtered = contacts.filter(c => {
        const fullName = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
        const email = (c.email || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const mobile = (c.mobile || '').toLowerCase();
        const companyName = (getCompanyName(c.company_id) || '').toLowerCase();
        const jobTitle = (c.job_title || '').toLowerCase();

        return fullName.includes(query) ||
               email.includes(query) ||
               phone.includes(query) ||
               mobile.includes(query) ||
               companyName.includes(query) ||
               jobTitle.includes(query);
    });

    renderFilteredContacts(filtered);
}

function renderFilteredContacts(filteredContacts) {
    const tbody = document.getElementById('contactsTableBody');
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.querySelector('.data-table-container');

    if (!filteredContacts.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    No contacts match your search
                </td>
            </tr>
        `;
        tableContainer.style.display = 'block';
        emptyState.style.display = 'none';
        return;
    }

    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';

    // Temporarily swap contacts for rendering, then restore
    const originalContacts = contacts;
    contacts = filteredContacts;
    renderContacts();
    contacts = originalContacts;
}

// ─── Modal: Create ──────────────────────────────────────────────────────────

function openCreateContactModal() {
    editingContactId = null;
    document.getElementById('contactModalTitle').textContent = 'New Contact';
    document.getElementById('contactSubmitBtn').textContent = 'Create Contact';
    document.getElementById('contactForm').reset();
    document.getElementById('contactId').value = '';
    if (contactCompanyDropdown) contactCompanyDropdown.setValue('');
    if (contactSourceDropdown) contactSourceDropdown.setValue('');
    openModal('contactModal');
}

// ─── Modal: Edit ────────────────────────────────────────────────────────────

function openEditContactModal(id) {
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;

    editingContactId = id;
    document.getElementById('contactModalTitle').textContent = 'Edit Contact';
    document.getElementById('contactSubmitBtn').textContent = 'Update Contact';

    document.getElementById('contactId').value = id;
    document.getElementById('firstName').value = contact.first_name || '';
    document.getElementById('lastName').value = contact.last_name || '';
    document.getElementById('contactEmail').value = contact.email || '';
    document.getElementById('contactPhone').value = contact.phone || '';
    document.getElementById('contactMobile').value = contact.mobile || '';
    document.getElementById('contactCompany').value = contact.company_id || '';
    document.getElementById('contactJobTitle').value = contact.job_title || '';
    document.getElementById('contactSource').value = contact.contact_source || '';
    if (contactCompanyDropdown) contactCompanyDropdown.setValue(contact.company_id || '');
    if (contactSourceDropdown) contactSourceDropdown.setValue(contact.contact_source || '');

    openModal('contactModal');
}

function closeContactModal() {
    closeModal('contactModal');
    editingContactId = null;
}

// ─── Modal: Delete ──────────────────────────────────────────────────────────

function openDeleteModal(id) {
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;

    deletingContactId = id;
    document.getElementById('deleteContactName').textContent =
        `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
    openModal('deleteModal');
}

function closeDeleteModal() {
    closeModal('deleteModal');
    deletingContactId = null;
}

// ─── Form Submit ────────────────────────────────────────────────────────────

async function handleContactSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('contactSubmitBtn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-spinner"></span>Saving...';

    try {
        const companyIdValue = (contactCompanyDropdown ? contactCompanyDropdown.getValue() : document.getElementById('contactCompany').value);

        const payload = {
            first_name: document.getElementById('firstName').value.trim(),
            last_name: document.getElementById('lastName').value.trim(),
            email: document.getElementById('contactEmail').value.trim() || null,
            phone: document.getElementById('contactPhone').value.trim() || null,
            mobile: document.getElementById('contactMobile').value.trim() || null,
            company_id: companyIdValue || null,
            job_title: document.getElementById('contactJobTitle').value.trim() || null,
            contact_source: (contactSourceDropdown ? contactSourceDropdown.getValue() : document.getElementById('contactSource').value) || null
        };

        if (editingContactId) {
            await api.request(`/crm/contacts/${editingContactId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            Toast.success('Contact updated successfully');
        } else {
            await api.request('/crm/contacts', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            Toast.success('Contact created successfully');
        }

        closeContactModal();
        await loadContacts();
    } catch (error) {
        console.error('Error saving contact:', error);
        Toast.error(error.message || 'Failed to save contact');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// ─── Delete Contact ─────────────────────────────────────────────────────────

async function confirmDeleteContact() {
    if (!deletingContactId) return;

    const deleteBtn = document.getElementById('confirmDeleteBtn');
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<span class="btn-spinner"></span>Deleting...';

    try {
        await api.request(`/crm/contacts/${deletingContactId}`, {
            method: 'DELETE'
        });
        Toast.success('Contact deleted successfully');
        closeDeleteModal();
        await loadContacts();
    } catch (error) {
        console.error('Error deleting contact:', error);
        Toast.error(error.message || 'Failed to delete contact');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
    }
}

// ─── Modal Helpers ──────────────────────────────────────────────────────────

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

// ─── Loading State ──────────────────────────────────────────────────────────

function showLoading(show) {
    const loadingEl = document.getElementById('loadingState');
    const tableContainer = document.querySelector('.data-table-container');
    const emptyState = document.getElementById('emptyState');

    if (show) {
        loadingEl.style.display = 'flex';
        tableContainer.style.display = 'none';
        emptyState.style.display = 'none';
    } else {
        loadingEl.style.display = 'none';
    }
}

// ==================== Contact Detail Slide Panel ====================

async function openContactDetailPanel(contactId) {
    document.getElementById('contactDetailOverlay').classList.add('active');
    document.getElementById('contactDetailPanel').classList.add('active');
    document.getElementById('contactTimeline').innerHTML = '<div class="import-loading">Loading timeline...</div>';
    document.getElementById('contactDetailInfo').innerHTML = '';
    document.getElementById('contactDetailName').textContent = 'Contact Details';

    try {
        const contact = await api.request(`/crm/contacts/${contactId}`);
        const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';
        document.getElementById('contactDetailName').textContent = name;

        const esc = s => { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
        const field = (label, value) => value ? `<div class="lead-detail-item"><span class="lead-detail-label">${label}</span><span>${esc(value)}</span></div>` : '';

        document.getElementById('contactDetailInfo').innerHTML = `
            <div class="lead-detail-grid">
                ${field('Email', contact.email)}
                ${field('Phone', contact.phone || contact.mobile)}
                ${field('Company', contact.company_name)}
                ${field('Job Title', contact.job_title)}
                ${field('Source', contact.contact_source)}
                ${field('City', contact.city)}
                ${field('State', contact.state)}
                ${field('Country', contact.country)}
                ${field('Address', contact.address)}
                ${field('Website', contact.website)}
                ${contact.notes ? `<div class="lead-detail-item" style="grid-column:1/-1"><span class="lead-detail-label">Notes</span><span>${esc(contact.notes)}</span></div>` : ''}
                <div class="lead-detail-item"><span class="lead-detail-label">Created</span><span>${new Date(contact.created_at).toLocaleString()}</span></div>
            </div>
        `;

        // Load timeline
        const timeline = await api.request(`/crm/contacts/${contactId}/timeline`);
        renderEntityTimeline(timeline, 'contactTimeline');
    } catch (e) {
        document.getElementById('contactTimeline').innerHTML = `<p style="color:var(--color-error);">${e.message || 'Failed to load'}</p>`;
    }
}

function closeContactDetailPanel() {
    document.getElementById('contactDetailOverlay').classList.remove('active');
    document.getElementById('contactDetailPanel').classList.remove('active');
}

function renderEntityTimeline(entries, containerId) {
    const container = document.getElementById(containerId);
    if (!entries || entries.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:20px;">No activity yet</p>';
        return;
    }

    const esc = s => { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

    const iconMap = {
        call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅',
        stage: '🏷️', status_change: '🔄', auto_assigned: '🔀', reassigned: '🔀',
        transferred: '↔️', converted: '🎯', followup: '⏰', transfer: '↔️'
    };

    function formatTimeAgo(date) {
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }

    container.innerHTML = entries.map(e => {
        const icon = iconMap[e.icon] || iconMap[e.type] || '⏳';
        const time = formatTimeAgo(new Date(e.timestamp));
        const desc = e.description ? `<div class="tl-desc">${esc(e.description)}</div>` : '';
        const typeClass = `tl-${e.type}`;
        const who = e.performed_by_name || '';
        const whoLine = who ? `<span class="tl-who">${esc(who)}</span>` : '';

        let chips = '';
        if (e.meta) {
            const c = [];
            if (e.meta.activity_type) c.push(`<span class="tl-chip tl-chip-type">${esc(e.meta.activity_type)}</span>`);
            if (e.meta.contact_outcome || e.outcome) c.push(`<span class="tl-chip tl-chip-outcome">${esc((e.meta.contact_outcome || e.outcome || '').replace(/_/g, ' '))}</span>`);
            if (e.meta.call_duration_seconds > 0) c.push(`<span class="tl-chip">Call: ${Math.floor(e.meta.call_duration_seconds/60)}m</span>`);
            if (e.meta.next_action_date) c.push(`<span class="tl-chip tl-chip-pending">Next: ${new Date(e.meta.next_action_date).toLocaleDateString()}</span>`);
            if (e.meta.to_stage_name) c.push(`<span class="tl-chip" style="background:rgba(168,85,247,0.15);color:#a855f7;">${esc(e.meta.to_stage_name)}</span>`);
            if (c.length) chips = `<div class="tl-chips">${c.join('')}</div>`;
        }

        return `
            <div class="tl-entry ${typeClass}">
                <div class="tl-icon">${icon}</div>
                <div class="tl-content">
                    <div class="tl-header">
                        <span class="tl-title">${esc(e.title)}</span>
                    </div>
                    ${chips}
                    ${desc}
                    <div class="tl-meta">${whoLine ? `${whoLine} · ` : ''}${time}</div>
                </div>
            </div>
        `;
    }).join('');
}
