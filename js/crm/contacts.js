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

    // Deep link: ?contact=<id> opens that contact's panel straight away. The
    // related-records panels on companies link here, and a link that only
    // lands you on the list is a link that made you search again.
    const contactId = new URLSearchParams(window.location.search).get('contact');
    if (contactId) openContactDetailPanel(contactId);
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

function renderContacts(list) {
    // Rolodex grid. `list` defaults to the full set; filterContacts passes a
    // filtered array (no more global-swap hack).
    const grid = document.getElementById('contactsGrid');
    const emptyState = document.getElementById('emptyState');
    if (!grid) return;

    const rows = Array.isArray(list) ? list : contacts;
    const countEl = document.getElementById('rlxCount');
    if (countEl) countEl.textContent = contacts.length || '0';

    if (!contacts.length) {
        grid.innerHTML = '';
        grid.style.display = 'none';
        emptyState.style.display = 'block';
        renderContactsHeroWave();
        return;
    }
    grid.style.display = 'grid';
    emptyState.style.display = 'none';

    if (!rows.length) {
        grid.innerHTML = `<div class="rlx-empty">No contacts match your search</div>`;
        renderContactsHeroWave();
        return;
    }

    grid.innerHTML = rows.map(contact => renderContactCard(contact)).join('');
    renderContactsHeroWave();
}

// One contact = one identity card: avatar hue, name, role @ company,
// direct action chips (call / WhatsApp / email), source + age footer.
function renderContactCard(contact) {
    const companyName = getCompanyName(contact.company_id);
    const fullName = escapeHtml(`${contact.first_name || ''} ${contact.last_name || ''}`.trim()) || '—';
    const initials = getInitials(contact.first_name, contact.last_name);
    const phone = contact.phone || contact.mobile || '';
    const waDigits = phone.replace(/[^0-9]/g, '');
    const wa = waDigits ? (waDigits.length === 10 ? '91' + waDigits : waDigits) : '';
    const roleLine = [contact.job_title, companyName].filter(Boolean).map(escapeHtml).join(' · ');

    const chips = [
        phone ? `<a class="rlx-chip" href="tel:${escapeHtml(phone)}" onclick="event.stopPropagation()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    ${escapeHtml(phone)}</a>` : '',
        wa ? `<a class="rlx-chip wa" href="https://wa.me/${wa}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2a10 10 0 0 0-8.6 15.09L2 22l5.05-1.32A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3 .79.8-2.92-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>
                    WhatsApp</a>` : '',
        contact.email ? `<a class="rlx-chip" href="mailto:${escapeHtml(contact.email)}" onclick="event.stopPropagation()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    ${escapeHtml(contact.email)}</a>` : ''
    ].filter(Boolean).join('');

    return `
        <div class="rlx-card" onclick="openContactDetailPanel('${contact.id}')">
            <div class="rlx-manage">
                <button type="button" title="Edit" onclick="event.stopPropagation(); openEditContactModal('${contact.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                ${canDeleteContact() ? `
                <button type="button" class="rlx-del" title="Delete" onclick="event.stopPropagation(); openDeleteModal('${contact.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>` : ''}
            </div>
            <div class="rlx-top">
                <div class="rlx-av" style="background:${contactAvatarBg(contact)}">${escapeHtml(initials)}</div>
                <div class="rlx-idcol">
                    <div class="rlx-name">${fullName}</div>
                    <div class="rlx-role">${roleLine || '<span style="color:var(--text-muted)">No role on file</span>'}</div>
                </div>
            </div>
            <div class="rlx-chips">${chips || '<span class="rlx-chip" style="cursor:default">No contact details</span>'}</div>
            <div class="rlx-foot">
                <span class="rlx-src">${escapeHtml(contact.contact_source || 'manual')}</span>
                <span class="rlx-age">${contactTimeAgo(contact.created_at)}</span>
            </div>
        </div>
    `;
}

// Deterministic avatar hue per contact (same recipe as the Leads page).
function contactAvatarBg(contact) {
    const key = contact.id || `${contact.first_name}${contact.last_name}`;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const hues = [212, 262, 158, 24, 330, 190, 48, 288];
    const hue = hues[h % hues.length];
    return `linear-gradient(135deg, hsl(${hue} 62% 46%), hsl(${(hue + 28) % 360} 58% 38%))`;
}

function contactTimeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days < 30) return days + 'd ago';
    if (days < 365) return Math.floor(days / 30) + 'mo ago';
    return Math.floor(days / 365) + 'y ago';
}

// Hero wave: contacts created per day over the last 30-90 days.
function renderContactsHeroWave() {
    const band = document.getElementById('rlxWave');
    const capEl = document.getElementById('rlxWaveCap');
    if (!band) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const countIn = days => {
        const from = new Date(today); from.setDate(today.getDate() - (days - 1));
        return contacts.filter(c => c.created_at && new Date(c.created_at) >= from).length;
    };
    const DAYS = countIn(30) > 0 ? 30 : (countIn(90) > 0 ? 90 : 0);
    if (DAYS === 0) { band.hidden = true; if (capEl) capEl.textContent = ''; return; }
    const start = new Date(today); start.setDate(today.getDate() - (DAYS - 1));
    const buckets = new Array(DAYS).fill(0);
    contacts.forEach(c => {
        if (!c.created_at) return;
        const d = new Date(c.created_at); d.setHours(0, 0, 0, 0);
        const idx = Math.round((d - start) / 86400000);
        if (idx >= 0 && idx < DAYS) buckets[idx]++;
    });
    if (buckets.every(v => v === 0)) { band.hidden = true; if (capEl) capEl.textContent = ''; return; }
    const W = 1200, H = 100, padT = 56, padB = 6;
    const ih = H - padT - padB;
    const yMax = Math.max(...buckets) * 1.15 || 1;
    const x = i => (i / (DAYS - 1)) * W;
    const y = v => padT + ih - (v / yMax) * ih;
    const pts = buckets.map((v, i) => [x(i), y(v)]);
    const n = pts.length;
    const dx = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
    const t = [m[0]];
    for (let i = 1; i < n - 1; i++) t.push((m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2);
    t.push(m[n - 2]);
    for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
        else {
            const a = t[i] / m[i], b = t[i + 1] / m[i];
            const s2 = a * a + b * b;
            if (s2 > 9) { const tau = 3 / Math.sqrt(s2); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
        }
    }
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i];
        d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1) +
             ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1) +
             ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
    }
    const area = d + ' L' + W + ',' + H + ' L0,' + H + ' Z';
    band.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs><linearGradient id="rlxWaveFill" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="var(--brand-primary)" stop-opacity="0.22"/>' +
        '<stop offset="1" stop-color="var(--brand-primary)" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#rlxWaveFill)" stroke="none"/>' +
        '<path d="' + d + '" fill="none" stroke="var(--brand-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>' +
        '</svg>';
    band.hidden = false;
    if (capEl) capEl.textContent = 'New contacts/day · ' + DAYS + 'd';
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

    renderContacts(filtered);
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
    const loading = document.getElementById('loadingState');
    const grid = document.getElementById('contactsGrid');
    if (loading) loading.style.display = show ? 'flex' : 'none';
    if (grid) grid.style.display = show ? 'none' : 'grid';
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
                ${field('Phone', contact.phone || contact.mobile || src.phone, crmPhoneLink(contact.phone || contact.mobile || src.phone))}
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

        // Deals this contact is on. Mounted before the timeline fetch so it
        // paints while the (much larger) timeline is still loading.
        if (typeof RelatedPanel !== 'undefined') {
            RelatedPanel.mount(document.getElementById('contactRelatedPanel'), [
                { key: 'deals', label: 'Deals', shape: 'deals',
                  url: `/crm/contacts/${contactId}/deals` }
            ]);
        }

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
