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
// CRM team role: 'admin' | 'manager' | 'teamlead' | 'member' | 'none'.
// Resolved on page load; gates which actions render.
let myTeamRole = 'member';

async function loadMyRole() {
    try {
        const user = api.getUser();
        if (user?.roles?.includes('CRM_ADMIN') || user?.roles?.includes('SUPERADMIN')) {
            myTeamRole = 'admin';
            return;
        }
        const res = await api.request('/crm/leads/my-role');
        myTeamRole = res?.role || 'member';
    } catch { myTeamRole = 'member'; }
}

function canDeleteContact() {
    return ['admin', 'manager', 'teamlead'].includes(myTeamRole);
}

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

    // Resolve role first so render() can hide member-blocked actions.
    await loadMyRole();
    // Load companies first (needed for contact table rendering)
    await loadCompanies();
    await loadContacts();
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
    // Populate datalist for company autocomplete
    const datalist = document.getElementById('companyAutocomplete');
    if (!datalist) return;

    datalist.innerHTML = companies.map(c =>
        `<option value="${escapeHtml(c.company_name)}">`
    ).join('');

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
                    ${canDeleteContact() ? `
                    <button class="action-btn delete" title="Delete" onclick="openDeleteModal('${contact.id}')">
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
    if (contactSourceDropdown) contactSourceDropdown.setValue('');
    document.getElementById('contactCompanyName').value = '';
    document.getElementById('contactCompanyId').value = '';
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
    // Company: show name in text input
    const co = companies.find(c => c.id === contact.company_id);
    document.getElementById('contactCompanyName').value = co?.company_name || '';
    document.getElementById('contactCompanyId').value = contact.company_id || '';
    document.getElementById('contactJobTitle').value = contact.job_title || '';
    document.getElementById('contactSource').value = contact.contact_source || '';
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
        // Resolve company: match by name or create new
        const companyName = document.getElementById('contactCompanyName').value.trim();
        let companyId = document.getElementById('contactCompanyId').value || null;

        if (companyName) {
            const match = companies.find(c => c.company_name.toLowerCase() === companyName.toLowerCase());
            if (match) {
                companyId = match.id;
            } else {
                // Auto-create company
                try {
                    const newCo = await api.request('/crm/companies', {
                        method: 'POST',
                        body: JSON.stringify({ company_name: companyName })
                    });
                    companyId = newCo.id;
                    companies.push(newCo);
                    populateCompanyDropdown();
                    Toast.info(`Company "${companyName}" created`);
                } catch (e) {
                    console.error('Failed to create company:', e);
                }
            }
        }

        const payload = {
            first_name: document.getElementById('firstName').value.trim(),
            last_name: document.getElementById('lastName').value.trim(),
            email: document.getElementById('contactEmail').value.trim() || null,
            phone: document.getElementById('contactPhone').value.trim() || null,
            mobile: document.getElementById('contactMobile').value.trim() || null,
            company_id: companyId,
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
        const field = (label, value, html) => value ? `<div class="lead-detail-item"><span class="lead-detail-label">${label}</span><span>${html || esc(value)}</span></div>` : '';

        // Try to find source lead for richer data
        let lead = null;
        try {
            const leads = await api.request('/crm/leads?pageSize=200');
            const allLeads = leads.data || leads || [];
            lead = allLeads.find(l => l.converted_contact_id === contactId);
        } catch {}

        const src = lead || contact; // use lead data if available, fallback to contact
        const statusBadge = lead ? `<span class="crm-status-badge status-${lead.status}" style="width:fit-content">${esc(lead.status?.charAt(0).toUpperCase() + lead.status?.slice(1))}</span>` : null;
        const teamBadge = lead?.team_name ? `<span class="crm-team-badge">${esc(lead.team_name)}</span>` : null;

        // Parse custom fields
        let customHtml = '';
        try {
            const cf = typeof src.custom_fields === 'string' ? JSON.parse(src.custom_fields || '{}') : (src.custom_fields || {});
            for (const [k, v] of Object.entries(cf)) {
                if (v) customHtml += field(k.replace(/_/g, ' '), v);
            }
        } catch {}

        document.getElementById('contactDetailInfo').innerHTML = `
            <div class="lead-detail-grid">
                ${field('Lead ID', lead?.lead_number, lead?.lead_number ? `<span class="crm-lead-number">${esc(lead.lead_number)}</span>` : null)}
                ${field('Email', contact.email)}
                ${field('Phone', contact.phone || contact.mobile || src.phone)}
                ${field('Company', contact.company_name || src.company_name)}
                ${field('Job Title', contact.job_title || src.job_title)}
                ${field('Source', contact.contact_source || src.lead_source)}
                ${field('Status', lead?.status, statusBadge)}
                ${field('City', src.city)}
                ${field('State', src.state)}
                ${field('Country', src.country)}
                ${field('Website', src.website)}
                ${field('Team', lead?.team_name, teamBadge)}
                ${field('Owner', lead?.owner_name || src.owner_name)}
                ${src.notes ? `<div class="lead-detail-item" style="grid-column:1/-1"><span class="lead-detail-label">Notes</span><span>${esc(src.notes)}</span></div>` : ''}
                ${customHtml}
                ${field('Next Follow-up', lead?.next_followup_date ? new Date(lead.next_followup_date).toLocaleDateString() : null)}
                ${field('First Contact', lead?.first_contact_date ? new Date(lead.first_contact_date).toLocaleDateString() : null)}
                ${field('Last Interaction', lead?.last_interaction_at ? new Date(lead.last_interaction_at).toLocaleDateString() : null)}
                ${field('Follow-ups', lead?.followup_count > 0 ? String(lead.followup_count) : null)}
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

function printContactTimeline() {
    printEntityTimeline(
        document.getElementById('contactDetailName')?.textContent || 'Contact',
        document.getElementById('contactDetailInfo')?.innerHTML || '',
        document.getElementById('contactTimeline')?.innerHTML || '',
        'Contact Report'
    );
}

function printEntityTimeline(name, infoHtml, timelineHtml, subtitle) {
    const logoUrl = window.location.origin + '/assets/logo-black.png';
    const printWin = window.open('', '_blank');
    printWin.document.write(`<!DOCTYPE html>
<html><head>
<title>${name} — ${subtitle}</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1a1a2e; max-width: 800px; margin: 0 auto; }
    .print-header { border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 16px; }
    .print-header img { height: 28px; margin-bottom: 8px; }
    .print-header h1 { font-size: 1.2rem; margin: 0; color: #1a1a2e; }
    .lead-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .lead-detail-item { display: flex; flex-direction: column; gap: 2px; font-size: 0.85rem; }
    .lead-detail-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
    .crm-status-badge, .crm-team-badge, .crm-lead-number { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: #e5e7eb; display: inline-block; }
    h2 { font-size: 1.1rem; margin: 20px 0 12px; color: #374151; }
    .tl-entry { display: flex; gap: 10px; padding: 8px 0; border-left: 2px solid #d1d5db; margin-left: 8px; padding-left: 16px; position: relative; page-break-inside: avoid; }
    .tl-icon { position: absolute; left: -9px; top: 10px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #fff; border: 2px solid #9ca3af; font-size: 10px; }
    .tl-title { font-weight: 600; font-size: 0.9rem; }
    .tl-desc { font-size: 0.82rem; color: #4b5563; margin-top: 2px; }
    .tl-meta { font-size: 0.75rem; color: #9ca3af; margin-top: 2px; }
    .tl-who { font-weight: 500; color: #374151; }
    .tl-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tl-chip { display: inline-flex; padding: 1px 7px; border-radius: 4px; font-size: 0.68rem; font-weight: 500; background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
    .tl-chip-type { background: #ede9fe; color: #7c3aed; text-transform: uppercase; }
    .tl-chip-outcome { background: #dcfce7; color: #16a34a; }
    .tl-chip-pending { background: #fef3c7; color: #d97706; }
    .print-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 0.7rem; color: #9ca3af; display: flex; justify-content: space-between; }
    @media print { body { padding: 0; } }
</style>
</head><body>
<div class="print-header">
    <img src="${logoUrl}" alt="Ragenaizer"><br>
    <h1>${name}</h1>
    <p style="margin:2px 0 0;font-size:0.85rem;color:#6b7280;">${subtitle}</p>
</div>
<div class="lead-detail-grid">${infoHtml}</div>
<h2>Full Journey Timeline</h2>
<div>${timelineHtml}</div>
<div class="print-footer">
    <span>Generated ${new Date().toLocaleString()}</span>
    <span>Ragenaizer CRM</span>
</div>
</body></html>`);
    printWin.document.close();
    setTimeout(() => printWin.print(), 400);
}

function filterContactTimeline(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#contactTimeline .tl-entry').forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
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
