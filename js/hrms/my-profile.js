/**
 * HRMS My Profile Page
 */

// Global variables
let profileData = null;
let currentTab = 'personal';

// Field mappings for update requests
const fieldMappings = {
    personal_info: [
        { value: 'personal_email', label: 'Personal Email', dataKey: 'personal_email' },
        { value: 'personal_phone', label: 'Personal Phone', dataKey: 'personal_phone' },
        { value: 'emergency_contact_name', label: 'Emergency Contact Name', dataKey: 'emergency_contact_name' },
        { value: 'emergency_contact_phone', label: 'Emergency Contact Phone', dataKey: 'emergency_contact_phone' },
        { value: 'current_address', label: 'Current Address', dataKey: 'current_address' }
    ],
    bank_account: [
        { value: 'account_number', label: 'Account Number', dataKey: 'account_number' },
        { value: 'ifsc_code', label: 'IFSC Code', dataKey: 'ifsc_code' },
        { value: 'bank_name', label: 'Bank Name', dataKey: 'bank_name' },
        { value: 'branch_name', label: 'Branch Name', dataKey: 'branch_name' }
    ],
    // Country-agnostic statutory fields - labels use generic terms
    // Backend dataKey unchanged for compatibility
    statutory_info: [
        { value: 'pan_number', label: 'Tax ID Number', dataKey: 'pan_number' },
        { value: 'pf_number', label: 'Retirement Fund ID', dataKey: 'pf_number' },
        { value: 'uan', label: 'Universal Account Number', dataKey: 'uan' },
        { value: 'esi_number', label: 'Social Insurance ID', dataKey: 'esi_number' }
    ],
    contact: [
        { value: 'work_phone', label: 'Work Phone', dataKey: 'work_phone' }
    ]
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Check authentication
        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }

        // Initialize navigation
        if (typeof Navigation !== 'undefined') {
            Navigation.init();
        }

        // Load profile data
        await loadProfile();

    } catch (error) {
        console.error('Error initializing profile page:', error);
        showToast('Failed to load profile', 'error');
    }
});

/**
 * Load employee profile
 */
async function loadProfile() {
    try {
        profileData = await api.getMyHrmsProfile();

        if (profileData) {
            // Update header
            updateProfileHeader(profileData);

            // Update personal info tab
            updatePersonalInfo(profileData);

            // Update employment tab
            updateEmploymentInfo(profileData);

            // Load other data as needed
            loadBankAccounts();
            loadStatutoryInfo();
            loadDocuments();
            loadUpdateRequests();
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        showToast('Failed to load profile data', 'error');
    }
}

/**
 * Update profile header
 */
function updateProfileHeader(data) {
    // Avatar
    const avatarEl = document.getElementById('profileAvatar');
    const initialsEl = document.getElementById('avatarInitials');

    if (data.profile_photo_url) {
        const img = document.createElement('img');
        img.src = data.profile_photo_url;
        img.alt = data.first_name;
        avatarEl.innerHTML = '';
        avatarEl.appendChild(img);
    } else {
        const initials = getInitials(data.first_name, data.last_name);
        initialsEl.textContent = initials;
    }

    // Name and code
    document.getElementById('employeeName').textContent = `${data.first_name} ${data.last_name || ''}`.trim();
    document.getElementById('employeeCode').textContent = data.employee_code || '--';

    // Meta info
    document.getElementById('designation').textContent = data.designation_name || '--';
    document.getElementById('department').textContent = data.department_name || '--';
    document.getElementById('office').textContent = data.office_name || '--';
    document.getElementById('joiningDate').textContent = data.date_of_joining
        ? `Joined: ${formatDate(data.date_of_joining)}`
        : 'Joined: --';
}

/**
 * Update personal info tab
 */
function updatePersonalInfo(data) {
    document.getElementById('firstName').textContent = data.first_name || '--';
    document.getElementById('lastName').textContent = data.last_name || '--';
    document.getElementById('dateOfBirth').textContent = data.date_of_birth ? formatDate(data.date_of_birth) : '--';
    document.getElementById('gender').textContent = capitalizeFirst(data.gender) || '--';
    document.getElementById('personalEmail').textContent = data.personal_email || '--';
    document.getElementById('personalPhone').textContent = data.personal_phone || '--';
    document.getElementById('emergencyContactName').textContent = data.emergency_contact_name || '--';
    document.getElementById('emergencyContactPhone').textContent = data.emergency_contact_phone || '--';

    // Address
    const permanentAddr = formatAddress(data.permanent_address);
    const currentAddr = formatAddress(data.current_address);
    document.getElementById('permanentAddress').textContent = permanentAddr || '--';
    document.getElementById('currentAddress').textContent = currentAddr || '--';
}

/**
 * Update employment info tab
 */
function updateEmploymentInfo(data) {
    document.getElementById('empCode').textContent = data.employee_code || '--';
    document.getElementById('workEmail').textContent = data.work_email || '--';
    document.getElementById('workPhone').textContent = data.work_phone || '--';
    document.getElementById('empDepartment').textContent = data.department_name || '--';
    document.getElementById('empDesignation').textContent = data.designation_name || '--';
    document.getElementById('empOffice').textContent = data.office_name || '--';
    document.getElementById('empShift').textContent = data.shift_name || '--';
    document.getElementById('reportingManager').textContent = data.reporting_manager_name || '--';
    document.getElementById('empJoiningDate').textContent = data.date_of_joining ? formatDate(data.date_of_joining) : '--';
    document.getElementById('employmentType').textContent = formatEmploymentType(data.employment_type) || '--';
    document.getElementById('employmentStatus').textContent = formatEmploymentStatus(data.employment_status) || '--';
    document.getElementById('probationEndDate').textContent = data.probation_end_date ? formatDate(data.probation_end_date) : '--';
}

/**
 * Load bank accounts
 */
async function loadBankAccounts() {
    const container = document.getElementById('bankAccountsList');

    try {
        const accounts = await api.getMyHrmsProfileBankAccounts();

        if (!accounts || accounts.length === 0) {
            container.innerHTML = `
                <div class="ess-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                        <line x1="1" y1="10" x2="23" y2="10"/>
                    </svg>
                    <p>No bank accounts on file</p>
                </div>
            `;
            return;
        }

        container.innerHTML = accounts.map(acc => `
            <div class="bank-account-card ${acc.is_primary ? 'primary' : ''}">
                ${acc.is_primary ? '<span class="primary-badge">Primary</span>' : ''}
                <div class="bank-account-details">
                    <div class="bank-name">${escapeHtml(acc.bank_name || '--')}</div>
                    <div class="account-number">A/C: ${maskAccountNumber(acc.account_number)}</div>
                    <div class="bank-meta">
                        <span>IFSC: ${acc.ifsc_code || '--'}</span>
                        <span>Branch: ${acc.branch_name || '--'}</span>
                    </div>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading bank accounts:', error);
        container.innerHTML = `
            <div class="ess-error-state">
                <p>Failed to load bank accounts</p>
            </div>
        `;
    }
}

/**
 * Load statutory info
 */
async function loadStatutoryInfo() {
    try {
        const statutory = await api.getMyHrmsProfileStatutory();

        if (statutory) {
            document.getElementById('panNumber').textContent = statutory.pan_number || '--';
            document.getElementById('aadharNumber').textContent = maskAadhar(statutory.aadhar_number) || '--';
            document.getElementById('pfNumber').textContent = statutory.pf_number || '--';
            document.getElementById('uanNumber').textContent = statutory.uan || '--';
            document.getElementById('esiNumber').textContent = statutory.esi_number || '--';
        }
    } catch (error) {
        console.error('Error loading statutory info:', error);
    }
}

/**
 * Load documents
 */
async function loadDocuments() {
    const container = document.getElementById('documentsList');

    try {
        const documents = await api.getMyHrmsProfileDocuments();

        if (!documents || documents.length === 0) {
            container.innerHTML = `
                <div class="ess-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <p>No documents uploaded</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="documents-grid">
                ${documents.map(doc => `
                    <div class="document-card">
                        <div class="document-icon ${getDocumentTypeClass(doc.document_type)}">
                            ${getDocumentIcon(doc.document_type)}
                        </div>
                        <div class="document-info">
                            <span class="document-name">${formatDocumentType(doc.document_type)}</span>
                            <span class="document-status ${doc.is_verified ? 'verified' : 'pending'}">
                                ${doc.is_verified ? 'Verified' : 'Pending Verification'}
                            </span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

    } catch (error) {
        console.error('Error loading documents:', error);
        container.innerHTML = `
            <div class="ess-error-state">
                <p>Failed to load documents</p>
            </div>
        `;
    }
}

/**
 * Load update requests
 */
async function loadUpdateRequests() {
    const container = document.getElementById('updateRequestsList');

    try {
        const requests = await api.getMyProfileUpdateRequests();

        if (!requests || requests.length === 0) {
            container.innerHTML = `
                <div class="ess-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    <p>No update requests</p>
                </div>
            `;
            return;
        }

        container.innerHTML = requests.map(req => `
            <div class="update-request-item">
                <div class="request-header">
                    <span class="request-type">${formatRequestType(req.request_type)}</span>
                    <span class="request-status status-${req.status}">${capitalizeFirst(req.status)}</span>
                </div>
                <div class="request-details">
                    <div class="request-field">
                        <span class="field-label">Field:</span>
                        <span class="field-value">${formatFieldName(req.field_name)}</span>
                    </div>
                    <div class="request-field">
                        <span class="field-label">Current:</span>
                        <span class="field-value">${escapeHtml(req.current_value || '--')}</span>
                    </div>
                    <div class="request-field">
                        <span class="field-label">Requested:</span>
                        <span class="field-value">${escapeHtml(req.requested_value || '--')}</span>
                    </div>
                    <div class="request-field">
                        <span class="field-label">Reason:</span>
                        <span class="field-value">${escapeHtml(req.reason || '--')}</span>
                    </div>
                </div>
                <div class="request-footer">
                    <span class="request-date">Submitted: ${formatDateTime(req.created_at)}</span>
                    ${req.status === 'pending' ? `
                        <button class="btn-cancel-request" onclick="cancelRequest('${req.id}')">Cancel</button>
                    ` : ''}
                    ${req.status === 'rejected' && req.rejection_reason ? `
                        <span class="rejection-reason">Reason: ${escapeHtml(req.rejection_reason)}</span>
                    ` : ''}
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading update requests:', error);
        container.innerHTML = `
            <div class="ess-error-state">
                <p>Failed to load update requests</p>
            </div>
        `;
    }
}

/**
 * Show tab
 */
function showTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('hidden', content.id !== `tab-${tabName}`);
    });

    currentTab = tabName;

    // Load NFC cards when switching to NFC tab
    if (tabName === 'nfc' && !nfcCardsLoaded) {
        loadMyNfcCards();
    }
}

/**
 * Open update request modal
 */
function openUpdateRequestModal(requestType) {
    const modal = document.getElementById('updateRequestModal');
    const fieldSelect = document.getElementById('fieldName');
    const typeInput = document.getElementById('requestType');

    // Set request type
    typeInput.value = requestType;

    // Populate field options
    const fields = fieldMappings[requestType] || [];
    fieldSelect.innerHTML = '<option value="">Select field...</option>' +
        fields.map(f => `<option value="${f.value}" data-key="${f.dataKey}">${f.label}</option>`).join('');

    // Clear form
    document.getElementById('currentValue').value = '';
    document.getElementById('requestedValue').value = '';
    document.getElementById('reason').value = '';

    // Add change handler for field select
    fieldSelect.onchange = function() {
        const option = this.options[this.selectedIndex];
        const dataKey = option.dataset.key;
        if (dataKey && profileData) {
            document.getElementById('currentValue').value = profileData[dataKey] || '';
        }
    };

    modal.style.display = 'flex';
}

/**
 * Close update request modal
 */
function closeUpdateRequestModal() {
    document.getElementById('updateRequestModal').style.display = 'none';
}

/**
 * Submit update request
 */
async function submitUpdateRequest(event) {
    event.preventDefault();

    const requestType = document.getElementById('requestType').value;
    const fieldName = document.getElementById('fieldName').value;
    const currentValue = document.getElementById('currentValue').value;
    const requestedValue = document.getElementById('requestedValue').value;
    const reason = document.getElementById('reason').value;

    if (!fieldName || !requestedValue || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        await api.createProfileUpdateRequest({
            request_type: requestType,
            field_name: fieldName,
            current_value: currentValue,
            requested_value: requestedValue,
            reason: reason
        });

        showToast('Update request submitted successfully', 'success');
        closeUpdateRequestModal();

        // Reload requests
        loadUpdateRequests();

        // Switch to requests tab
        showTab('requests');

    } catch (error) {
        console.error('Error submitting update request:', error);
        showToast(error.message || 'Failed to submit request', 'error');
    }
}

/**
 * Cancel update request
 */
async function cancelRequest(requestId) {
    const confirmed = await Confirm.show({
        title: 'Cancel Request',
        message: 'Are you sure you want to cancel this request?',
        type: 'warning',
        confirmText: 'Yes, Cancel',
        cancelText: 'No, Keep It'
    });

    if (!confirmed) {
        return;
    }

    try {
        await api.cancelProfileUpdateRequest(requestId);
        showToast('Request cancelled successfully', 'success');
        loadUpdateRequests();
    } catch (error) {
        console.error('Error cancelling request:', error);
        showToast(error.message || 'Failed to cancel request', 'error');
    }
}

// Utility functions
function getInitials(firstName, lastName) {
    const first = firstName ? firstName.charAt(0).toUpperCase() : '';
    const last = lastName ? lastName.charAt(0).toUpperCase() : '';
    return first + last || '--';
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function formatAddress(addr) {
    if (!addr) return null;
    if (typeof addr === 'string') return addr;
    const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country];
    return parts.filter(Boolean).join(', ');
}

function formatEmploymentType(type) {
    if (!type) return '';
    const types = {
        'full_time': 'Full-Time',
        'part_time': 'Part-Time',
        'contract': 'Contract',
        'intern': 'Intern',
        'consultant': 'Consultant'
    };
    return types[type] || capitalizeFirst(type);
}

function formatEmploymentStatus(status) {
    if (!status) return '';
    const statuses = {
        'active': 'Active',
        'on_notice': 'On Notice',
        'terminated': 'Terminated',
        'resigned': 'Resigned'
    };
    return statuses[status] || capitalizeFirst(status);
}

function maskAccountNumber(num) {
    if (!num) return '--';
    if (num.length <= 4) return num;
    return '*'.repeat(num.length - 4) + num.slice(-4);
}

function maskAadhar(num) {
    if (!num) return null;
    if (num.length <= 4) return num;
    return '*'.repeat(num.length - 4) + num.slice(-4);
}

function formatDocumentType(type) {
    if (!type) return '--';
    const types = {
        'profile_photo': 'Profile Photo',
        'pan_front': 'PAN Card (Front)',
        'pan_back': 'PAN Card (Back)',
        'aadhar_front': 'Aadhaar Card (Front)',
        'aadhar_back': 'Aadhaar Card (Back)'
    };
    return types[type] || capitalizeFirst(type.replace(/_/g, ' '));
}

function getDocumentTypeClass(type) {
    if (!type) return '';
    if (type.includes('pan')) return 'pan';
    if (type.includes('aadhar')) return 'aadhar';
    if (type.includes('photo')) return 'photo';
    return '';
}

function getDocumentIcon(type) {
    if (type === 'profile_photo') {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
    </svg>`;
}

function formatRequestType(type) {
    if (!type) return '--';
    const types = {
        'personal_info': 'Personal Information',
        'bank_account': 'Bank Account',
        'statutory_info': 'Statutory Information',
        'contact': 'Contact Information'
    };
    return types[type] || capitalizeFirst(type.replace(/_/g, ' '));
}

function formatFieldName(name) {
    if (!name) return '--';
    return capitalizeFirst(name.replace(/_/g, ' '));
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Local showToast removed - using unified toast.js instead

// ============================================
// NFC Card Functions (v3.0.62)
// ============================================

let nfcCardsLoaded = false;
let myNfcCards = [];

/**
 * Load current user's NFC cards
 */
async function loadMyNfcCards() {
    const loadingEl = document.getElementById('nfcCardsLoading');
    const emptyEl = document.getElementById('nfcCardsEmpty');
    const listEl = document.getElementById('myNfcCardsList');

    try {
        if (loadingEl) loadingEl.style.display = 'flex';
        if (emptyEl) emptyEl.style.display = 'none';

        myNfcCards = await api.getMyNfcCards();
        nfcCardsLoaded = true;

        renderMyNfcCards();

        // Also load public profile settings
        loadMyPublicProfile();
    } catch (error) {
        console.error('Error loading NFC cards:', error);
        myNfcCards = [];
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'flex';
    }
}

/**
 * Render NFC cards list in my-profile
 */
function renderMyNfcCards() {
    const loadingEl = document.getElementById('nfcCardsLoading');
    const emptyEl = document.getElementById('nfcCardsEmpty');
    const listEl = document.getElementById('myNfcCardsList');

    if (loadingEl) loadingEl.style.display = 'none';

    // Remove existing card items
    const existingCards = listEl?.querySelectorAll('.my-nfc-card-item');
    existingCards?.forEach(el => el.remove());

    if (!myNfcCards || myNfcCards.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    myNfcCards.forEach(card => {
        const cardEl = createMyNfcCardElement(card);
        listEl?.appendChild(cardEl);
    });
}

/**
 * Create DOM element for a single NFC card in my-profile view
 */
function createMyNfcCardElement(card) {
    const div = document.createElement('div');
    div.className = `my-nfc-card-item ${card.is_active ? '' : 'inactive'}`;

    const statusText = card.is_active ? 'Active' : 'Inactive';
    const statusClass = card.is_active ? 'active' : 'inactive';
    const primaryBadge = card.is_primary ? '<span class="badge primary">Primary</span>' : '';

    div.innerHTML = `
        <div class="card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
        </div>
        <div class="card-details">
            <div class="card-uid">${formatNfcCardUid(card.card_uid)}</div>
            <div class="card-label">${card.card_label || 'Access Card'}</div>
            <div class="card-badges">
                <span class="badge ${statusClass}">${statusText}</span>
                ${primaryBadge}
            </div>
        </div>
        <div class="card-meta">
            <span class="card-date">Issued: ${formatCardDate(card.issued_at)}</span>
        </div>
    `;

    return div;
}

/**
 * Format card UID for display
 */
function formatNfcCardUid(uid) {
    if (!uid) return '-';
    return uid.match(/.{1,2}/g)?.join(':') || uid;
}

/**
 * Format date for card display
 */
function formatCardDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
}

/**
 * Load public profile settings
 */
async function loadMyPublicProfile() {
    try {
        const response = await api.request('/hrms/employees/me/public-profile');

        const enabledCheckbox = document.getElementById('myPublicProfileEnabled');
        const urlSection = document.getElementById('myPublicProfileUrlSection');
        const urlDisplay = document.getElementById('myPublicProfileUrl');

        if (enabledCheckbox) {
            enabledCheckbox.checked = response.public_profile_enabled || false;
        }

        if (response.public_profile_enabled && response.public_profile_url) {
            if (urlSection) urlSection.style.display = 'block';
            if (urlDisplay) urlDisplay.textContent = window.location.origin + response.public_profile_url;
        } else {
            if (urlSection) urlSection.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading public profile settings:', error);
    }
}

/**
 * Toggle public profile on/off
 */
async function toggleMyPublicProfile() {
    const enabledCheckbox = document.getElementById('myPublicProfileEnabled');
    const enabled = enabledCheckbox?.checked || false;

    try {
        // Get current employee's ID
        const employeeResponse = await api.getMyProfile();
        if (!employeeResponse || !employeeResponse.id) {
            throw new Error('Could not get employee ID');
        }

        await api.updatePublicProfileSettings(employeeResponse.id, {
            public_profile_enabled: enabled,
            public_profile_slug: null // Let backend auto-generate
        });

        showToast(enabled ? 'Public profile enabled' : 'Public profile disabled', 'success');

        // Reload to get the generated URL
        await loadMyPublicProfile();
    } catch (error) {
        console.error('Error updating public profile:', error);
        showToast(error.message || 'Failed to update public profile', 'error');

        // Revert checkbox
        if (enabledCheckbox) {
            enabledCheckbox.checked = !enabled;
        }
    }
}

/**
 * Copy public profile URL to clipboard
 */
async function copyPublicProfileUrl() {
    const urlDisplay = document.getElementById('myPublicProfileUrl');
    const url = urlDisplay?.textContent;

    if (!url || url === '-') {
        showToast('No URL to copy', 'warning');
        return;
    }

    try {
        await navigator.clipboard.writeText(url);
        showToast('URL copied to clipboard', 'success');
    } catch (error) {
        console.error('Error copying to clipboard:', error);
        showToast('Failed to copy URL', 'error');
    }
}
