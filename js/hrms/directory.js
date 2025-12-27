/**
 * HRMS Team Directory Page
 */

let employees = [];
let searchTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    if (typeof Navigation !== 'undefined') Navigation.init();

    await Promise.all([
        loadFilters(),
        loadDirectory()
    ]);
});

async function loadFilters() {
    try {
        const [departments, offices] = await Promise.all([
            api.getHrmsDepartments(),
            api.getHrmsOffices()
        ]);

        const deptSelect = document.getElementById('departmentFilter');
        deptSelect.innerHTML = '<option value="">All Departments</option>' +
            (departments || []).map(d => `<option value="${d.id}">${escapeHtml(d.department_name)}</option>`).join('');

        const officeSelect = document.getElementById('officeFilter');
        officeSelect.innerHTML = '<option value="">All Offices</option>' +
            (offices || []).map(o => `<option value="${o.id}">${escapeHtml(o.office_name)}</option>`).join('');
    } catch (e) {
        console.error('Error loading filters:', e);
    }
}

async function loadDirectory() {
    const container = document.getElementById('directoryGrid');
    const search = document.getElementById('searchInput').value.trim();
    const departmentId = document.getElementById('departmentFilter').value;
    const officeId = document.getElementById('officeFilter').value;

    try {
        employees = await api.getTeamDirectory(departmentId || null, officeId || null, search || null) || [];
        renderDirectory();
    } catch (error) {
        console.error('Error loading directory:', error);
        container.innerHTML = '<div class="ess-error-state"><p>Failed to load directory</p></div>';
    }
}

function renderDirectory() {
    const container = document.getElementById('directoryGrid');

    if (employees.length === 0) {
        container.innerHTML = `
            <div class="ess-empty-state" style="grid-column: 1/-1;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <p>No employees found</p>
            </div>
        `;
        return;
    }

    container.innerHTML = employees.map(emp => {
        // Handle both API field names (full_name vs first_name/last_name)
        // Fall back to employee_code if name is empty
        const displayName = emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code || 'Unknown';
        const designation = emp.designation || emp.designation_name || '--';
        const department = emp.department || emp.department_name || '--';
        const office = emp.office || emp.office_name || '--';
        const employeeCode = emp.employee_code || '';

        return `
        <div class="directory-card compact" onclick="showEmployeeDetails('${emp.id}')">
            <div class="directory-card-left">
                <div class="directory-card-avatar">
                    ${emp.profile_photo_url
                        ? `<img src="${emp.profile_photo_url}" alt="${displayName}">`
                        : `<span>${getInitialsFromName(displayName)}</span>`
                    }
                </div>
            </div>
            <div class="directory-card-right">
                <div class="directory-card-header">
                    <h3>${escapeHtml(displayName)}</h3>
                    <span class="employee-code">${escapeHtml(employeeCode)}</span>
                </div>
                <div class="directory-card-details">
                    <div class="detail-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                            <path d="M16 3v4M8 3v4"/>
                        </svg>
                        <span>${escapeHtml(designation)}</span>
                    </div>
                    <div class="detail-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        <span>${escapeHtml(department)}</span>
                    </div>
                    <div class="detail-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                            <circle cx="12" cy="10" r="3"/>
                        </svg>
                        <span>${escapeHtml(office)}</span>
                    </div>
                </div>
                <div class="directory-card-contact">
                    ${emp.work_email ? `<div class="contact-item">
                        <a href="mailto:${emp.work_email}" onclick="event.stopPropagation()" class="contact-link">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                                <polyline points="22,6 12,13 2,6"/>
                            </svg>
                            <span>${emp.work_email}</span>
                        </a>
                        <button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard('${emp.work_email}', this)" title="Copy email">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                        </button>
                    </div>` : ''}
                    ${emp.work_phone ? `<div class="contact-item">
                        <a href="tel:${emp.work_phone}" onclick="event.stopPropagation()" class="contact-link">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                            </svg>
                            <span>${emp.work_phone}</span>
                        </a>
                        <button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard('${emp.work_phone}', this)" title="Copy phone">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                        </button>
                    </div>` : ''}
                </div>
            </div>
        </div>
    `}).join('');
}

function debounceSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadDirectory(), 300);
}

function applyFilters() {
    loadDirectory();
}

function showEmployeeDetails(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    // Handle both API field names - fall back to employee_code if name is empty
    const displayName = emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code || 'Unknown';
    const designation = emp.designation || emp.designation_name || '--';
    const department = emp.department || emp.department_name || '--';
    const office = emp.office || emp.office_name || '--';

    const container = document.getElementById('employeeDetails');
    container.innerHTML = `
        <div class="employee-detail-header">
            <div class="employee-detail-avatar">
                ${emp.profile_photo_url
                    ? `<img src="${emp.profile_photo_url}" alt="${displayName}">`
                    : `<span>${getInitialsFromName(displayName)}</span>`
                }
            </div>
            <div class="employee-detail-info">
                <h2>${escapeHtml(displayName)}</h2>
                <p class="employee-code">${emp.employee_code || ''}</p>
            </div>
        </div>
        <div class="employee-detail-body">
            <div class="detail-row">
                <span class="detail-label">Designation</span>
                <span class="detail-value">${escapeHtml(designation)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Department</span>
                <span class="detail-value">${escapeHtml(department)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Office</span>
                <span class="detail-value">${escapeHtml(office)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Email</span>
                <span class="detail-value">${emp.work_email ? `<a href="mailto:${emp.work_email}">${emp.work_email}</a>` : '--'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Phone</span>
                <span class="detail-value">${emp.work_phone ? `<a href="tel:${emp.work_phone}">${emp.work_phone}</a>` : '--'}</span>
            </div>
            ${emp.reporting_manager_name ? `
            <div class="detail-row">
                <span class="detail-label">Reports To</span>
                <span class="detail-value">${escapeHtml(emp.reporting_manager_name)}</span>
            </div>` : ''}
        </div>
    `;

    document.getElementById('employeeModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('employeeModal').style.display = 'none';
}

function getInitials(firstName, lastName) {
    const first = firstName ? firstName.charAt(0).toUpperCase() : '';
    const last = lastName ? lastName.charAt(0).toUpperCase() : '';
    return first + last || '--';
}

function getInitialsFromName(name) {
    if (!name) return '--';
    const parts = name.trim().split(' ').filter(p => p);
    if (parts.length === 0) return '--';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return parts[0].charAt(0).toUpperCase() + parts[parts.length - 1].charAt(0).toUpperCase();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        // Show copied feedback
        const originalSvg = btn.innerHTML;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
        </svg>`;
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = originalSvg;
            btn.classList.remove('copied');
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}
