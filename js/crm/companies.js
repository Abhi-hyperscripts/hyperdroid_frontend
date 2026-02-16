/**
 * CRM Companies Page JavaScript
 * Handles CRUD operations, search/filter, and modal management for companies
 */

let companies = [];
let editingCompanyId = null;
let deletingCompanyId = null;
let companyIndustryDropdown = null;

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

    await loadCompanies();
});

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    if (!companyIndustryDropdown) {
        companyIndustryDropdown = convertSelectToSearchable('companyIndustry', {
            placeholder: '-- Select Industry --',
            searchPlaceholder: 'Search industries...'
        });
    }
}

// ─── Data Loading ───────────────────────────────────────────────────────────

async function loadCompanies() {
    try {
        showLoading(true);
        const result = await api.request('/crm/companies');
        companies = result || [];
        renderCompanies();
    } catch (error) {
        console.error('Error loading companies:', error);
        Toast.error('Failed to load companies');
        companies = [];
        renderCompanies();
    } finally {
        showLoading(false);
    }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderCompanies() {
    const tbody = document.getElementById('companiesTableBody');
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.querySelector('.data-table-container');

    if (!companies.length) {
        tbody.innerHTML = '';
        tableContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';

    tbody.innerHTML = companies.map(company => {
        const location = buildLocation(company.city, company.state, company.country);
        const initial = (company.company_name || '?')[0].toUpperCase();

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; border-radius: var(--border-radius-sm); background: var(--brand-secondary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; flex-shrink: 0;">
                            ${escapeHtml(initial)}
                        </div>
                        <span style="font-weight: 500;">${escapeHtml(company.company_name)}</span>
                    </div>
                </td>
                <td>${company.industry ? `<span class="badge badge-neutral">${escapeHtml(company.industry)}</span>` : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${company.website ? `<a href="${escapeHtml(company.website)}" target="_blank" rel="noopener" style="color: var(--brand-primary); text-decoration: none;">${escapeHtml(truncateUrl(company.website))}</a>` : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${escapeHtml(company.phone) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${escapeHtml(company.email) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${location ? escapeHtml(location) : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td style="white-space: nowrap;">${formatDate(company.created_at)}</td>
                <td class="actions-cell">
                    <button class="action-btn" title="Edit" onclick="openEditCompanyModal('${company.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="action-btn delete" title="Delete" onclick="openDeleteModal('${company.id}')">
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

function buildLocation(city, state, country) {
    const parts = [city, state, country].filter(Boolean);
    return parts.join(', ');
}

function truncateUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, '');
    } catch {
        return url.length > 30 ? url.substring(0, 30) + '...' : url;
    }
}

// ─── Search / Filter ────────────────────────────────────────────────────────

function filterCompanies() {
    const query = document.getElementById('companySearch').value.toLowerCase().trim();

    if (!query) {
        renderCompanies();
        return;
    }

    const filtered = companies.filter(c => {
        const name = (c.company_name || '').toLowerCase();
        const industry = (c.industry || '').toLowerCase();
        const email = (c.email || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const city = (c.city || '').toLowerCase();
        const country = (c.country || '').toLowerCase();

        return name.includes(query) ||
               industry.includes(query) ||
               email.includes(query) ||
               phone.includes(query) ||
               city.includes(query) ||
               country.includes(query);
    });

    renderFilteredCompanies(filtered);
}

function renderFilteredCompanies(filteredCompanies) {
    const tbody = document.getElementById('companiesTableBody');
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.querySelector('.data-table-container');

    if (!filteredCompanies.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    No companies match your search
                </td>
            </tr>
        `;
        tableContainer.style.display = 'block';
        emptyState.style.display = 'none';
        return;
    }

    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';

    const originalCompanies = companies;
    companies = filteredCompanies;
    renderCompanies();
    companies = originalCompanies;
}

// ─── Modal: Create ──────────────────────────────────────────────────────────

function openCreateCompanyModal() {
    editingCompanyId = null;
    document.getElementById('companyModalTitle').textContent = 'New Company';
    document.getElementById('companySubmitBtn').textContent = 'Create Company';
    document.getElementById('companyForm').reset();
    document.getElementById('companyId').value = '';
    if (companyIndustryDropdown) companyIndustryDropdown.setValue('');
    openModal('companyModal');
}

// ─── Modal: Edit ────────────────────────────────────────────────────────────

function openEditCompanyModal(id) {
    const company = companies.find(c => c.id === id);
    if (!company) return;

    editingCompanyId = id;
    document.getElementById('companyModalTitle').textContent = 'Edit Company';
    document.getElementById('companySubmitBtn').textContent = 'Update Company';

    document.getElementById('companyId').value = id;
    document.getElementById('companyName').value = company.company_name || '';
    document.getElementById('companyIndustry').value = company.industry || '';
    if (companyIndustryDropdown) companyIndustryDropdown.setValue(company.industry || '');
    document.getElementById('companyWebsite').value = company.website || '';
    document.getElementById('companyPhone').value = company.phone || '';
    document.getElementById('companyEmail').value = company.email || '';
    document.getElementById('companyAddress').value = company.address || '';
    document.getElementById('companyCity').value = company.city || '';
    document.getElementById('companyState').value = company.state || '';
    document.getElementById('companyCountry').value = company.country || '';

    openModal('companyModal');
}

function closeCompanyModal() {
    closeModal('companyModal');
    editingCompanyId = null;
}

// ─── Modal: Delete ──────────────────────────────────────────────────────────

function openDeleteModal(id) {
    const company = companies.find(c => c.id === id);
    if (!company) return;

    deletingCompanyId = id;
    document.getElementById('deleteCompanyName').textContent = company.company_name || '';
    openModal('deleteModal');
}

function closeDeleteModal() {
    closeModal('deleteModal');
    deletingCompanyId = null;
}

// ─── Form Submit ────────────────────────────────────────────────────────────

async function handleCompanySubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('companySubmitBtn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-spinner"></span>Saving...';

    try {
        const payload = {
            company_name: document.getElementById('companyName').value.trim(),
            industry: (companyIndustryDropdown ? companyIndustryDropdown.getValue() : document.getElementById('companyIndustry').value) || null,
            website: document.getElementById('companyWebsite').value.trim() || null,
            phone: document.getElementById('companyPhone').value.trim() || null,
            email: document.getElementById('companyEmail').value.trim() || null,
            address: document.getElementById('companyAddress').value.trim() || null,
            city: document.getElementById('companyCity').value.trim() || null,
            state: document.getElementById('companyState').value.trim() || null,
            country: document.getElementById('companyCountry').value.trim() || null
        };

        if (editingCompanyId) {
            await api.request(`/crm/companies/${editingCompanyId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            Toast.success('Company updated successfully');
        } else {
            await api.request('/crm/companies', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            Toast.success('Company created successfully');
        }

        closeCompanyModal();
        await loadCompanies();
    } catch (error) {
        console.error('Error saving company:', error);
        Toast.error(error.message || 'Failed to save company');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// ─── Delete Company ─────────────────────────────────────────────────────────

async function confirmDeleteCompany() {
    if (!deletingCompanyId) return;

    const deleteBtn = document.getElementById('confirmDeleteBtn');
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<span class="btn-spinner"></span>Deleting...';

    try {
        await api.request(`/crm/companies/${deletingCompanyId}`, {
            method: 'DELETE'
        });
        Toast.success('Company deleted successfully');
        closeDeleteModal();
        await loadCompanies();
    } catch (error) {
        console.error('Error deleting company:', error);
        Toast.error(error.message || 'Failed to delete company');
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
