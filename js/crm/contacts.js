/**
 * CRM Contacts Page JavaScript
 * Handles CRUD operations, search/filter, and modal management for contacts
 */

let contacts = [];
let companies = [];
let editingContactId = null;
let deletingContactId = null;

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

    // Load data
    await Promise.all([
        loadContacts(),
        loadCompanies()
    ]);
});

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
        option.textContent = company.companyName;
        select.appendChild(option);
    });
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
        const companyName = getCompanyName(contact.companyId);
        const fullName = escapeHtml(`${contact.firstName || ''} ${contact.lastName || ''}`.trim());
        const initials = getInitials(contact.firstName, contact.lastName);

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--brand-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 600; flex-shrink: 0;">
                            ${escapeHtml(initials)}
                        </div>
                        <span style="font-weight: 500;">${fullName}</span>
                    </div>
                </td>
                <td>${escapeHtml(contact.email) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${escapeHtml(contact.phone || contact.mobile) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${companyName ? escapeHtml(companyName) : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${contact.contactSource ? `<span class="badge badge-neutral">${escapeHtml(contact.contactSource)}</span>` : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${escapeHtml(contact.jobTitle) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td style="white-space: nowrap;">${formatDate(contact.createdAt)}</td>
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
    return company ? company.companyName : null;
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
        const fullName = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
        const email = (c.email || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const mobile = (c.mobile || '').toLowerCase();
        const companyName = (getCompanyName(c.companyId) || '').toLowerCase();
        const jobTitle = (c.jobTitle || '').toLowerCase();

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
    document.getElementById('firstName').value = contact.firstName || '';
    document.getElementById('lastName').value = contact.lastName || '';
    document.getElementById('contactEmail').value = contact.email || '';
    document.getElementById('contactPhone').value = contact.phone || '';
    document.getElementById('contactMobile').value = contact.mobile || '';
    document.getElementById('contactCompany').value = contact.companyId || '';
    document.getElementById('contactJobTitle').value = contact.jobTitle || '';
    document.getElementById('contactSource').value = contact.contactSource || '';

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
        `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
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
        const companyIdValue = document.getElementById('contactCompany').value;

        const payload = {
            firstName: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim(),
            email: document.getElementById('contactEmail').value.trim() || null,
            phone: document.getElementById('contactPhone').value.trim() || null,
            mobile: document.getElementById('contactMobile').value.trim() || null,
            companyId: companyIdValue || null,
            jobTitle: document.getElementById('contactJobTitle').value.trim() || null,
            contactSource: document.getElementById('contactSource').value || null
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
