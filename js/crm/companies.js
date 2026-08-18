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
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Format date for display
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Initialization ─────────────────────────────────────────────────────────

// ─── RBAC: mirror contacts.js — plain members can't create/delete companies ──
let myTeamRole = 'member';
async function loadMyRole() {
    try {
        const roles = (typeof getUserRoles === 'function') ? getUserRoles() : [];
        if (roles.includes('CRM_ADMIN') || roles.includes('SUPERADMIN')) { myTeamRole = 'admin'; return; }
        const res = await api.request('/crm/leads/my-role');
        myTeamRole = res?.role || 'member';
    } catch { myTeamRole = 'member'; }
}
function canManageCompanies() {
    return ['admin', 'manager', 'teamlead'].includes(myTeamRole);
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('crm', '../');

    await loadMyRole();
    // Members can't create companies — hide the create affordances (a click would
    // just 403). Delete is gated per-row in the table render below.
    if (!canManageCompanies()) {
        document.querySelectorAll('[onclick="openCreateCompanyModal()"]').forEach(b => { b.style.display = 'none'; });
    }

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

function renderCompanyStatus(status) {
    // Status mapping for the Companies grid (refactored 2026-04-14):
    //   "prospect" — local CRM company, no Accounts customer row yet. The default
    //                state for any company in the sales pipeline. Edit/delete
    //                works freely; nothing has hit the books.
    //   "customer" — promoted to an Accounts customer (typically auto-promoted at
    //                Deal Won). The same UUID now exists in both CRM and Accounts;
    //                invoices/proformas can reference this counterparty.
    if (status === 'customer') {
        return `<span class="badge" style="background: var(--status-active, #1f7a3a); color: #fff;" title="Promoted to an Accounts customer. The Finance team owns this counterparty in the books.">Customer</span>`;
    }
    if (status === 'prospect') {
        return `<span class="badge" style="background: var(--bg-tertiary, #2a2a35); color: var(--text-secondary, #aaa); border: 1px solid var(--border-primary, #3a3a45);" title="Local sales-pipeline company. Will be promoted to an Accounts customer when a deal is won.">Prospect</span>`;
    }
    return `<span style="color: var(--text-muted);">-</span>`;
}

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
                        <button type="button" class="company-name-link" onclick="openCompanyDetailPanel('${company.id}')">${escapeHtml(company.company_name)}</button>
                    </div>
                </td>
                <td>${company.industry ? `<span class="badge badge-neutral">${escapeHtml(company.industry)}</span>` : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${company.website ? `<a href="${escapeHtml(company.website)}" target="_blank" rel="noopener" style="color: var(--brand-primary); text-decoration: none;">${escapeHtml(truncateUrl(company.website))}</a>` : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${company.phone ? crmPhoneLink(company.phone) : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${escapeHtml(company.email) || '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${location ? escapeHtml(location) : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${renderCompanyStatus(company.status)}</td>
                <td style="white-space: nowrap;">${formatDate(company.created_at)}</td>
                <td class="actions-cell">
                    <button class="action-btn" title="Edit" onclick="openEditCompanyModal('${company.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    ${canManageCompanies() ? `
                    <button class="action-btn delete" title="Delete" onclick="openDeleteModal('${company.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>` : ''}
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

// ─── Company detail panel ───────────────────────────────────────────────────
//
// Companies were a table and nothing more: you could edit a row or delete it,
// but not answer "who do we know here, and what is in play". Both rollups
// existed on the backend the whole time —
//   GET /api/Companies/{id}/contacts
//   GET /api/Companies/{id}/deals
// — with no caller anywhere in the app. This panel is their surface, plus the
// notes panel so a company can carry context of its own.

function openCompanyDetailPanel(companyId) {
    document.getElementById('companyDetailOverlay').classList.add('active');
    document.getElementById('companyDetailPanel').classList.add('active');

    const company = companies.find(c => c.id === companyId);
    document.getElementById('companyDetailName').textContent =
        company?.company_name || 'Company';

    const esc = escapeHtml;
    const field = (label, value, html) => value
        ? `<div class="lead-detail-item"><span class="lead-detail-label">${label}</span><span>${html || esc(value)}</span></div>`
        : '';

    const info = document.getElementById('companyDetailInfo');
    if (company) {
        const site = company.website
            ? `<a href="${esc(company.website)}" target="_blank" rel="noopener" style="color:var(--brand-primary);">${esc(truncateUrl(company.website))}</a>`
            : null;
        info.innerHTML = `
            <div class="lead-detail-grid">
                ${field('Industry', company.industry)}
                ${field('Website', company.website, site)}
                ${field('Phone', company.phone, company.phone ? crmPhoneLink(company.phone) : null)}
                ${field('Email', company.email)}
                ${field('Location', buildLocation(company.city, company.state, company.country))}
                ${field('Status', company.status, renderCompanyStatus(company.status))}
                ${field('Employees', company.employee_count ? String(company.employee_count) : null)}
                ${field('Created', company.created_at ? formatDate(company.created_at) : null)}
            </div>`;
    } else {
        // Opened before the list finished loading, or from a stale row.
        info.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Company details unavailable — reload the page.</p>';
    }

    if (typeof RelatedPanel !== 'undefined') {
        RelatedPanel.mount(document.getElementById('companyRelatedPanel'), [
            { key: 'contacts', label: 'Contacts', shape: 'contacts',
              url: `/crm/companies/${companyId}/contacts` },
            { key: 'deals', label: 'Deals', shape: 'deals',
              url: `/crm/companies/${companyId}/deals` }
        ]);
    }
    if (typeof NotesPanel !== 'undefined') {
        NotesPanel.mount(document.getElementById('companyNotesPanel'), 'company', companyId);
    }
}

function closeCompanyDetailPanel() {
    document.getElementById('companyDetailOverlay').classList.remove('active');
    document.getElementById('companyDetailPanel').classList.remove('active');
}

// Esc closes the panel, matching every other slide-panel in the CRM.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const panel = document.getElementById('companyDetailPanel');
    if (panel && panel.classList.contains('active')) closeCompanyDetailPanel();
});
