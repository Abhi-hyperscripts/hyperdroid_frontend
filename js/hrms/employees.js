let employees = [];
let departments = [];
let designations = [];
let offices = [];
let shifts = [];
let availableUsers = [];
let filteredUsers = [];
let selectedUserId = null;
let currentViewEmployee = null;
const USER_BATCH_SIZE = 50;
let displayedUserCount = 0;

// Currency lookup by country code (populated from statutory configs)
let currencyByCountry = {};

// SearchableDropdown instances for filter bar
let officeFilterDropdown = null;
let departmentFilterDropdown = null;
let statusFilterDropdown = null;

// Pagination instances
let employeesPagination = null;
let nfcCardsPagination = null;

// Utility function to escape HTML special characters
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to set date picker values (works with flatpickr)
function setDatePickerValue(elementId, dateValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const dateStr = dateValue ? dateValue.split('T')[0] : '';

    // If flatpickr is initialized, use setDate for proper display
    if (element._flatpickr) {
        if (dateStr) {
            element._flatpickr.setDate(dateStr, true);
        } else {
            element._flatpickr.clear();
        }
    } else {
        // Fallback: set value directly (flatpickr not yet initialized)
        element.value = dateStr;
    }
}

// Helper function to clear date picker values
function clearDatePickerValue(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (element._flatpickr) {
        element._flatpickr.clear();
    } else {
        element.value = '';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('hrms', '../');

    // Initialize RBAC
    hrmsRoles.init();

    // Check if user has access to employees page
    if (!hrmsRoles.canAccessEmployees()) {
        showToast('You do not have access to the Employees page', 'error');
        window.location.href = 'dashboard.html';
        return;
    }

    // CRITICAL: Require organization setup before accessing Employees page
    // This prevents users from bypassing setup by directly navigating to URL
    const setupComplete = await hrmsRoles.requireOrganizationSetup({
        showToast: true,
        redirectUrl: 'organization.html'
    });
    if (!setupComplete) return;

    // Apply RBAC visibility
    applyEmployeesRBAC();

    // Setup sidebar navigation
    setupSidebar();

    await loadFormData();
    await loadEmployees();
});

/**
 * Apply RBAC visibility to employees page elements
 */
function applyEmployeesRBAC() {
    // Show create/bulk import buttons only for HR Admin
    hrmsRoles.setElementVisibility('createEmployeeBtn', hrmsRoles.canCreateEmployee());
    hrmsRoles.setElementVisibility('bulkImportBtn', hrmsRoles.canCreateEmployee());

    console.log('Employees RBAC applied:', hrmsRoles.getDebugInfo());
}

async function loadFormData() {
    try {
        const [depts, desigs, offs, shiftsData] = await Promise.all([
            api.getHrmsDepartments(),
            api.getHrmsDesignations(),
            api.getHrmsOffices(),
            api.getHrmsShifts()
        ]);

        departments = depts || [];
        designations = desigs || [];
        offices = offs || [];
        shifts = shiftsData || [];

        // Use HrmsOfficeSelection to get persisted or first office
        const selectedOfficeId = HrmsOfficeSelection.initializeSelection(offices);

        // Initialize SearchableDropdown filter dropdowns
        initializeFilterDropdowns(selectedOfficeId);

        // Populate office filter (NO "All" option - office is atomic unit)
        populateOfficeFilterDropdown(selectedOfficeId);

        // Populate department filter based on selected office
        updateDepartmentFilterForOffice(selectedOfficeId);

        // Only populate Office dropdown in the form - others are cascading
        populateSelect('officeId', offices, 'office_name');

        // Set initial state for cascading dropdowns
        document.getElementById('departmentId').innerHTML = '<option value="">Select office first...</option>';
        document.getElementById('designationId').innerHTML = '<option value="">Select department first...</option>';
        document.getElementById('shiftId').innerHTML = '<option value="">Select office first...</option>';

        // Load currency info for all countries (for proper currency formatting)
        await loadCurrencyInfo();

    } catch (error) {
        console.error('Error loading form data:', error);
    }
}

/**
 * Initialize SearchableDropdown instances for filter bar
 */
function initializeFilterDropdowns(selectedOfficeId) {
    if (typeof convertSelectToSearchable !== 'function') {
        console.warn('SearchableDropdown not available');
        return;
    }

    // Office filter dropdown
    if (document.getElementById('officeFilter') && !officeFilterDropdown) {
        officeFilterDropdown = convertSelectToSearchable('officeFilter', {
            compact: true,
            placeholder: 'Select Office',
            searchPlaceholder: 'Search offices...',
            onChange: (value) => {
                HrmsOfficeSelection.setSelectedOfficeId(value);
                updateDepartmentFilterForOffice(value);
                filterEmployees();
            }
        });
    }

    // Department filter dropdown
    if (document.getElementById('departmentFilter') && !departmentFilterDropdown) {
        departmentFilterDropdown = convertSelectToSearchable('departmentFilter', {
            compact: true,
            placeholder: 'All Departments',
            searchPlaceholder: 'Search departments...',
            onChange: (value) => {
                filterEmployees();
            }
        });
    }

    // Status filter dropdown
    if (document.getElementById('statusFilter') && !statusFilterDropdown) {
        statusFilterDropdown = convertSelectToSearchable('statusFilter', {
            compact: true,
            placeholder: 'All Status',
            searchPlaceholder: 'Search status...',
            onChange: (value) => {
                filterEmployees();
            }
        });
    }
}

/**
 * Populate office filter dropdown using HrmsOfficeSelection utility
 * NO "All Offices" option - office is the atomic unit
 */
function populateOfficeFilterDropdown(selectedOfficeId) {
    // Build options using HrmsOfficeSelection (no "All" for filters)
    const options = HrmsOfficeSelection.buildOfficeOptions(offices, { isFormDropdown: false });
    const searchableOptions = options.map(opt => ({
        value: opt.value,
        label: opt.label
    }));

    // Update SearchableDropdown if available
    if (officeFilterDropdown) {
        officeFilterDropdown.setOptions(searchableOptions);
        officeFilterDropdown.setValue(selectedOfficeId);
    } else {
        // Fallback to native select
        const select = document.getElementById('officeFilter');
        if (select && select.tagName === 'SELECT') {
            select.innerHTML = options.map(opt =>
                `<option value="${opt.value}"${opt.value === selectedOfficeId ? ' selected' : ''}>${opt.label}</option>`
            ).join('');
        }
    }
}

/**
 * Update department filter based on selected office
 * Shows "All Departments" within the selected office
 */
function updateDepartmentFilterForOffice(officeId) {
    // Filter departments by selected office
    const filteredDepts = officeId
        ? departments.filter(d => d.is_active !== false && d.office_id === officeId)
        : departments.filter(d => d.is_active !== false);

    // Build options with "All Departments" at the top
    const deptOptions = [
        { value: '', label: 'All Departments' },
        ...filteredDepts.map(d => ({ value: d.id, label: d.department_name }))
    ];

    // Update SearchableDropdown if available
    if (departmentFilterDropdown) {
        departmentFilterDropdown.setOptions(deptOptions);
        departmentFilterDropdown.setValue(''); // Reset to "All Departments"
    } else {
        // Fallback to native select
        const select = document.getElementById('departmentFilter');
        if (select && select.tagName === 'SELECT') {
            select.innerHTML = '<option value="">All Departments</option>' +
                filteredDepts.map(d => `<option value="${d.id}">${d.department_name}</option>`).join('');
        }
    }
}

/**
 * Setup change handlers for filter dropdowns
 * NOTE: Handlers are now set up in initializeFilterDropdowns() via SearchableDropdown onChange
 * This function is kept for backwards compatibility if SearchableDropdown is not available
 */
function setupFilterChangeHandlers() {
    // Only add native event listeners if SearchableDropdown is not available
    if (officeFilterDropdown) return;

    const officeFilter = document.getElementById('officeFilter');
    if (officeFilter) {
        officeFilter.addEventListener('change', function() {
            const selectedOfficeId = this.value;
            HrmsOfficeSelection.setSelectedOfficeId(selectedOfficeId);
            updateDepartmentFilterForOffice(selectedOfficeId);
            filterEmployees();
        });
    }
}

/**
 * Load currency info from statutory configs for all active countries.
 * Populates the currencyByCountry lookup map.
 */
async function loadCurrencyInfo() {
    try {
        // Get unique country codes from loaded offices
        const countryCodes = [...new Set(offices.filter(o => o.country_code).map(o => o.country_code))];

        if (countryCodes.length === 0) {
            console.log('[Currency] No country codes found in offices');
            return;
        }

        // Fetch statutory config for each country in parallel
        const configPromises = countryCodes.map(async (countryCode) => {
            try {
                const response = await api.getHrmsStatutoryConfigByCountry(countryCode);
                // Note: JSON serialization uses camelCase (configData, not config_data)
                if (response?.success && response?.config?.configData?.country?.currency) {
                    const currency = response.config.configData.country.currency;
                    return {
                        countryCode,
                        currency: {
                            code: currency.code,
                            symbol: currency.symbol,
                            locale: getLocaleForCurrency(currency.code)
                        }
                    };
                }
            } catch (err) {
                console.warn(`[Currency] Could not load config for ${countryCode}:`, err.message);
            }
            return null;
        });

        const results = await Promise.all(configPromises);
        results.filter(r => r !== null).forEach(r => {
            currencyByCountry[r.countryCode] = r.currency;
        });

        console.log('[Currency] Loaded currency info for countries:', Object.keys(currencyByCountry));
    } catch (error) {
        console.error('[Currency] Error loading currency info:', error);
    }
}

/**
 * Get appropriate locale for a currency code.
 */
function getLocaleForCurrency(currencyCode) {
    const localeMap = {
        'INR': 'en-IN',
        'USD': 'en-US',
        'EUR': 'de-DE',
        'GBP': 'en-GB',
        'IDR': 'id-ID',
        'MVR': 'dv-MV',
        'AED': 'ar-AE',
        'SGD': 'en-SG',
        'JPY': 'ja-JP',
        'CNY': 'zh-CN',
        'AUD': 'en-AU',
        'CAD': 'en-CA'
    };
    return localeMap[currencyCode] || 'en-US';
}

function populateSelect(elementId, items, labelField, isFilter = false) {
    const select = document.getElementById(elementId);
    if (!select) return;

    const defaultOption = isFilter ? '<option value="">All</option>' : '<option value="">Select...</option>';
    select.innerHTML = defaultOption + items.map(item =>
        `<option value="${item.id}">${item[labelField]}</option>`
    ).join('');
}

async function loadEmployees() {
    const tbody = document.getElementById('employeesTableBody');
    tbody.innerHTML = '<tr><td colspan="8"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        employees = await api.getHrmsEmployees(false);

        updateStats();
        renderEmployees();

        // Preload employee photos in the background
        preloadEmployeePhotos();

    } catch (error) {
        console.error('Error loading employees:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>Error loading employees</p></td></tr>';
    }
}

// Preload photos for all employees (background task)
async function preloadEmployeePhotos() {
    for (const emp of employees) {
        if (!employeePhotoCache[emp.id]) {
            try {
                const documents = await api.getEmployeeDocuments(emp.id);
                const photoDoc = documents.find(d => d.document_type === 'profile_photo');
                if (photoDoc) {
                    const downloadUrl = await api.getEmployeeDocumentDownloadUrl(emp.id, photoDoc.id);
                    const photoUrl = downloadUrl.url || downloadUrl;
                    employeePhotoCache[emp.id] = photoUrl;
                    // Update the table cell if it exists
                    const photoCell = document.getElementById(`emp-photo-${emp.id}`);
                    if (photoCell) {
                        photoCell.innerHTML = `<img class="employee-avatar-img" src="${photoUrl}" alt="${emp.first_name}" onerror="this.outerHTML='<div class=\\'employee-avatar\\'>${getInitials(emp.first_name, emp.last_name)}</div>'">`;
                    }
                }
            } catch (e) {
                // Silent fail - just use initials
            }
        }
    }
}

function updateStats() {
    document.getElementById('totalCount').textContent = employees.length;
    document.getElementById('activeCount').textContent = employees.filter(e => e.employment_status === 'active').length;

    const today = new Date();
    const probationEmployees = employees.filter(e => {
        if (!e.probation_end_date) return false;
        return new Date(e.probation_end_date) > today;
    });
    document.getElementById('probationCount').textContent = probationEmployees.length;

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const exitEmployees = employees.filter(e => {
        if (!e.termination_date) return false;
        const termDate = new Date(e.termination_date);
        return termDate >= monthStart && termDate <= today;
    });
    document.getElementById('exitCount').textContent = exitEmployees.length;
}

function filterEmployees() {
    renderEmployees();
}

function renderEmployees() {
    const tbody = document.getElementById('employeesTableBody');
    if (!tbody) return;

    const searchTerm = document.getElementById('searchInput').value.toLowerCase();

    // Get filter values from SearchableDropdown instances or fallback to native select
    const deptFilter = departmentFilterDropdown ? departmentFilterDropdown.getValue() : document.getElementById('departmentFilter')?.value || '';
    const officeFilter = officeFilterDropdown ? officeFilterDropdown.getValue() : document.getElementById('officeFilter')?.value || '';
    const statusFilter = statusFilterDropdown ? statusFilterDropdown.getValue() : document.getElementById('statusFilter')?.value || '';

    let filtered = employees.filter(emp => {
        const matchesSearch = !searchTerm ||
            emp.first_name?.toLowerCase().includes(searchTerm) ||
            emp.last_name?.toLowerCase().includes(searchTerm) ||
            emp.employee_code?.toLowerCase().includes(searchTerm) ||
            emp.work_email?.toLowerCase().includes(searchTerm);

        const matchesDept = !deptFilter || emp.department_id === deptFilter;
        const matchesOffice = !officeFilter || emp.office_id === officeFilter;
        const matchesStatus = !statusFilter || emp.employment_status === statusFilter;

        return matchesSearch && matchesDept && matchesOffice && matchesStatus;
    });

    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        employeesPagination = createTablePagination('employeesPagination', {
            containerSelector: '#employeesPagination',
            data: filtered,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderEmployeesRows(paginatedData);
            }
        });
    } else {
        renderEmployeesRows(filtered);
    }
}

function renderEmployeesRows(filtered) {
    const tbody = document.getElementById('employeesTableBody');
    if (!tbody) return;

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No employees found</p></td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(emp => {
        const dept = departments.find(d => d.id === emp.department_id);
        const desig = designations.find(d => d.id === emp.designation_id);
        const office = offices.find(o => o.id === emp.office_id);

        // Find manager by user_id
        const manager = emp.manager_user_id ? employees.find(e => e.user_id === emp.manager_user_id) : null;
        const managerDisplay = manager
            ? `<div class="manager-info"><div class="manager-name">${manager.first_name} ${manager.last_name}</div><div class="manager-email">${manager.work_email || ''}</div></div>`
            : '<span class="text-muted">-</span>';

        // Get photo from cache if available
        const photoUrl = employeePhotoCache[emp.id];
        const photoHtml = photoUrl
            ? `<img class="employee-avatar-img" src="${photoUrl}" alt="${emp.first_name}" onerror="this.outerHTML='<div class=\\'employee-avatar\\'>${getInitials(emp.first_name, emp.last_name)}</div>'">`
            : `<div class="employee-avatar">${getInitials(emp.first_name, emp.last_name)}</div>`;

        return `
            <tr>
                <td>
                    <div class="employee-info">
                        <div id="emp-photo-${emp.id}">${photoHtml}</div>
                        <div>
                            <div class="employee-name">${emp.first_name} ${emp.last_name}</div>
                            <div class="employee-code">${emp.employee_code || '-'}</div>
                        </div>
                    </div>
                </td>
                <td>${dept?.department_name || '-'}</td>
                <td>${desig?.designation_name || '-'}</td>
                <td>${office?.office_name || '-'}</td>
                <td>${managerDisplay}</td>
                <td>${formatDate(emp.hire_date)}</td>
                <td><span class="status-badge ${emp.employment_status}">${capitalizeFirst(emp.employment_status)}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn" onclick="viewEmployee('${emp.id}')" data-tooltip="View">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="viewTransferHistory('${emp.id}')" data-tooltip="History">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                        </button>
                        ${hrmsRoles.canEditEmployee() ? `
                            <button class="action-btn" onclick="editEmployee('${emp.id}')" data-tooltip="Edit">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </button>
                            <button class="action-btn" onclick="openTransferModal('${emp.id}')" data-tooltip="Transfer">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="15 10 20 15 15 20"/>
                                    <path d="M4 4v7a4 4 0 0 0 4 4h12"/>
                                </svg>
                            </button>
                            <button class="action-btn" onclick="openReassignManagerModal('${emp.id}')" data-tooltip="Reassign Manager">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="9" cy="7" r="4"></circle>
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                                </svg>
                            </button>
                            ${emp.employment_status === 'active' ? `
                            <button class="action-btn danger" onclick="showTerminateModal('${emp.id}')" data-tooltip="Terminate">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="15" y1="9" x2="9" y2="15"/>
                                    <line x1="9" y1="9" x2="15" y2="15"/>
                                </svg>
                            </button>
                            ` : ''}
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function openCreateEmployeeModal() {
    document.getElementById('employeeModalTitle').textContent = 'Add Employee';
    document.getElementById('employeeForm').reset();
    document.getElementById('employeeId').value = '';
    document.getElementById('userSelectionSection').style.display = 'block';

    // Reset wizard to step 1
    resetEmployeeWizard();

    // Clear date pickers (flatpickr needs explicit clearing)
    clearDatePickerValue('dateOfBirth');
    clearDatePickerValue('dateOfJoining');
    clearDatePickerValue('probationEndDate');

    // Hide user info display until user is selected
    document.getElementById('userInfoDisplay').style.display = 'none';

    // Initialize searchable dropdowns for Step 2 Employment
    initializeEmploymentDropdowns();

    // Reset user selection
    selectedUserId = null;
    document.getElementById('userSelect').value = '';
    resetUserDropdown();

    // Reset documents and banking
    resetDocumentsAndBanking();

    // Initialize/reset gender dropdown (using SearchableDropdown component)
    initGenderDropdown();

    // Load available users
    try {
        const response = await api.getAvailableUsersForEmployee();
        // API returns { users: [...], total_users, existing_employees, available_count }
        // Extract the users array and normalize field names
        const usersArray = response.users || response || [];
        availableUsers = usersArray.map(u => ({
            id: u.user_id || u.id,
            email: u.email,
            firstName: u.first_name || u.firstName || '',
            lastName: u.last_name || u.lastName || '',
            displayName: u.display_name || u.displayName || ''
        }));

        filteredUsers = [...availableUsers];
        displayedUserCount = 0;
        displayUserList(filteredUsers, false);
        setupUserListScroll();
    } catch (error) {
        console.error('Error loading available users:', error);
        document.getElementById('userSearchList').innerHTML =
            '<p class="text-danger" style="text-align: center; padding: 20px;">Failed to load users</p>';
    }

    openModal('employeeModal');
}

// Searchable User Dropdown Functions
function toggleUserDropdown() {
    const dropdown = document.getElementById('userSearchDropdown');
    dropdown.classList.toggle('open');

    if (dropdown.classList.contains('open')) {
        document.getElementById('userSearchInput').focus();
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeUserDropdownOnOutsideClick);
        }, 0);
    } else {
        document.removeEventListener('click', closeUserDropdownOnOutsideClick);
    }
}

function closeUserDropdownOnOutsideClick(e) {
    const dropdown = document.getElementById('userSearchDropdown');
    if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        document.removeEventListener('click', closeUserDropdownOnOutsideClick);
    }
}

function resetUserDropdown() {
    const selectedText = document.querySelector('.user-search-selected .selected-user-text');
    selectedText.textContent = 'Select a user...';
    selectedText.classList.add('placeholder');
    document.getElementById('userSearchInput').value = '';
    document.getElementById('clearUserSearchBtn').style.display = 'none';
    document.getElementById('userSearchDropdown').classList.remove('open');
}

function filterUserList() {
    const searchTerm = document.getElementById('userSearchInput').value.toLowerCase();
    const clearBtn = document.getElementById('clearUserSearchBtn');

    clearBtn.style.display = searchTerm ? 'flex' : 'none';

    filteredUsers = availableUsers.filter(user => {
        const firstName = (user.firstName || '').toLowerCase();
        const lastName = (user.lastName || '').toLowerCase();
        const email = (user.email || '').toLowerCase();

        return firstName.includes(searchTerm) ||
               lastName.includes(searchTerm) ||
               email.includes(searchTerm);
    });

    displayedUserCount = 0;
    displayUserList(filteredUsers, false);
}

function clearUserSearch() {
    document.getElementById('userSearchInput').value = '';
    document.getElementById('clearUserSearchBtn').style.display = 'none';
    filteredUsers = [...availableUsers];
    displayedUserCount = 0;
    displayUserList(filteredUsers, false);
}

function displayUserList(users, append = false) {
    const list = document.getElementById('userSearchList');
    const countDisplay = document.getElementById('userCountDisplay');

    const totalUsers = availableUsers.length;
    const filteredCount = users.length;
    countDisplay.textContent = filteredCount === totalUsers
        ? `${totalUsers} user${totalUsers !== 1 ? 's' : ''}`
        : `${filteredCount} of ${totalUsers} users`;

    if (users.length === 0) {
        list.innerHTML = '<p class="text-muted" style="text-align: center; font-size: 0.75rem; padding: 20px;">No users found</p>';
        return;
    }

    const startIndex = append ? displayedUserCount : 0;
    const endIndex = Math.min(startIndex + USER_BATCH_SIZE, users.length);
    const batch = users.slice(startIndex, endIndex);

    const batchHTML = batch.map(user => {
        const isSelected = selectedUserId === user.id;
        return `
            <div class="user-select-item ${isSelected ? 'selected' : ''}"
                 data-user-id="${user.id}"
                 onclick="selectUser('${user.id}')">
                <div class="user-info-compact">
                    <span class="user-name-compact">${user.firstName} ${user.lastName}</span>
                    <span class="user-email-compact">${user.email}</span>
                </div>
            </div>
        `;
    }).join('');

    if (append) {
        const loadingIndicator = document.getElementById('user-loading-indicator');
        if (loadingIndicator) loadingIndicator.remove();
        list.insertAdjacentHTML('beforeend', batchHTML);
    } else {
        list.innerHTML = batchHTML;
    }

    displayedUserCount = endIndex;

    if (displayedUserCount < users.length) {
        list.insertAdjacentHTML('beforeend',
            '<div id="user-loading-indicator" class="text-muted" style="text-align: center; padding: 12px; font-size: 0.75rem;">Scroll for more...</div>');
    }
}

function setupUserListScroll() {
    const list = document.getElementById('userSearchList');

    list.onscroll = () => {
        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;

        if (scrollTop + clientHeight >= scrollHeight - 50) {
            if (displayedUserCount < filteredUsers.length) {
                displayUserList(filteredUsers, true);
            }
        }
    };
}

function selectUser(userId) {
    selectedUserId = userId;
    const user = availableUsers.find(u => u.id === userId);

    if (user) {
        // Update hidden input
        document.getElementById('userSelect').value = userId;

        // Update selected text
        const selectedText = document.querySelector('.user-search-selected .selected-user-text');
        selectedText.textContent = `${user.email} (${user.firstName} ${user.lastName})`;
        selectedText.classList.remove('placeholder');

        // Store values in hidden inputs (for form submission)
        document.getElementById('firstName').value = user.firstName || '';
        document.getElementById('lastName').value = user.lastName || '';
        document.getElementById('workEmail').value = user.email || '';

        // Display read-only user info
        document.getElementById('userInfoDisplay').style.display = 'flex';
        document.getElementById('userNameDisplay').textContent = `${user.firstName} ${user.lastName}`.trim() || '-';
        document.getElementById('userEmailDisplay').textContent = user.email || '-';

        // Update list to show selected state
        document.querySelectorAll('.user-search-panel .user-select-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.userId === userId);
        });

        // Close dropdown
        document.getElementById('userSearchDropdown').classList.remove('open');
        document.removeEventListener('click', closeUserDropdownOnOutsideClick);
    }
}

async function editEmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('employeeModalTitle').textContent = 'Edit Employee';
    document.getElementById('employeeId').value = id;
    document.getElementById('userSelectionSection').style.display = 'none';

    // Reset wizard to step 1
    resetEmployeeWizard();

    // Fill basic form fields first
    document.getElementById('employeeCode').value = emp.employee_code || '';

    // Store values in hidden inputs (read-only, from Auth service)
    document.getElementById('firstName').value = emp.first_name || '';
    document.getElementById('lastName').value = emp.last_name || '';
    document.getElementById('workEmail').value = emp.work_email || '';

    // Display read-only user info
    document.getElementById('userInfoDisplay').style.display = 'flex';
    document.getElementById('userNameDisplay').textContent = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || '-';
    document.getElementById('userEmailDisplay').textContent = emp.work_email || '-';

    document.getElementById('workPhone').value = emp.work_phone || '';

    // Set date fields using flatpickr's setDate method for proper display
    setDatePickerValue('dateOfBirth', emp.date_of_birth);

    // Initialize and set gender dropdown (using SearchableDropdown component)
    initGenderDropdown();
    setGenderValue(emp.gender || '');

    // Initialize and set employment type dropdown (using SearchableDropdown component)
    initEmploymentTypeDropdown();
    setEmploymentTypeValue(emp.employment_type || 'full_time');
    setDatePickerValue('dateOfJoining', emp.hire_date);
    setDatePickerValue('probationEndDate', emp.probation_end_date);
    document.getElementById('enableGeofenceAttendance').checked = emp.enable_geofence_attendance || false;

    // Set attendance exempt override dropdown
    // null = "Use Designation Default", true = "Exempt", false = "Required"
    const attendanceExemptSelect = document.getElementById('attendanceExemptOverride');
    if (emp.attendance_exempt_override === true) {
        attendanceExemptSelect.value = 'true';
    } else if (emp.attendance_exempt_override === false) {
        attendanceExemptSelect.value = 'false';
    } else {
        attendanceExemptSelect.value = ''; // Use designation default
    }

    // Set searchable dropdown values for Step 2 Employment
    setEmploymentDropdownValues(emp);

    // Reset and load documents and bank account
    resetDocumentsAndBanking();
    await Promise.all([
        loadEmployeeDocuments(id),
        loadEmployeeBankAccount(id)
    ]);

    openModal('employeeModal');
}

async function saveEmployee() {
    const id = document.getElementById('employeeId').value;
    const isEdit = !!id;

    // Validate all steps before saving
    if (!validatePersonalStep()) {
        goToEmployeeStep(1);
        return;
    }
    if (!validateEmploymentStep()) {
        goToEmployeeStep(2);
        return;
    }
    if (!validateBankingStep()) {
        goToEmployeeStep(3);
        return;
    }
    if (!validateDocumentsStep()) {
        goToEmployeeStep(4);
        return;
    }

    // Disable save button to prevent double-click
    const saveBtn = document.getElementById('empWizardSaveBtn');
    const originalBtnHtml = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-spinner"></span> Saving...';

    try {
        if (isEdit) {
            // For editing, use the existing approach (update employee, then handle documents separately)
            await saveEmployeeEdit(id);
        } else {
            // For new employees, use atomic creation (everything in one request)
            await saveEmployeeAtomic();
        }
    } catch (error) {
        console.error('Error saving employee:', error);
        showToast(error.message || 'Error saving employee', 'error');
    } finally {
        // Re-enable save button
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnHtml;
    }
}

/**
 * Create a new employee atomically - all data and documents in a single request.
 * If any part fails, the backend rolls back everything.
 */
async function saveEmployeeAtomic() {
    const userId = document.getElementById('userSelect').value;
    if (!userId) {
        showToast('Please select a user account', 'error');
        return;
    }

    // Build FormData with all employee info, documents, and bank details
    const formData = new FormData();

    // Employee basic info
    formData.append('user_id', userId);

    const employeeCode = document.getElementById('employeeCode').value;
    if (employeeCode) formData.append('employee_code', employeeCode);

    const workPhone = document.getElementById('workPhone').value;
    if (workPhone) formData.append('work_phone', workPhone);

    const dateOfBirth = document.getElementById('dateOfBirth').value;
    if (dateOfBirth) formData.append('date_of_birth', dateOfBirth);

    const gender = document.getElementById('gender').value;
    if (gender) formData.append('gender', gender);

    const departmentId = document.getElementById('departmentId').value;
    if (departmentId) formData.append('department_id', departmentId);

    const designationId = document.getElementById('designationId').value;
    if (designationId) formData.append('designation_id', designationId);

    const officeId = document.getElementById('officeId').value;
    if (officeId) formData.append('office_id', officeId);

    const shiftId = document.getElementById('shiftId').value;
    if (shiftId) formData.append('shift_id', shiftId);

    const managerIdValue = document.getElementById('managerId').value;
    if (managerIdValue) formData.append('manager_user_id', managerIdValue);

    const employmentType = document.getElementById('employmentType').value;
    if (employmentType) formData.append('employment_type', employmentType);

    const hireDate = document.getElementById('dateOfJoining').value;
    if (hireDate) formData.append('hire_date', hireDate);

    const probationEndDate = document.getElementById('probationEndDate').value;
    if (probationEndDate) formData.append('probation_end_date', probationEndDate);

    formData.append('enable_geofence_attendance', document.getElementById('enableGeofenceAttendance').checked);

    // Attendance exempt override: "" (null/use default), "true", or "false"
    const attendanceExemptValue = document.getElementById('attendanceExemptOverride').value;
    if (attendanceExemptValue !== '') {
        formData.append('attendance_exempt_override', attendanceExemptValue === 'true');
    }
    // If value is empty string, don't append it - backend will treat as null (use designation default)

    // Document numbers
    const panNumber = document.getElementById('pan-number')?.value;
    if (panNumber) formData.append('pan_number', panNumber);

    const aadharNumber = document.getElementById('aadhar-number')?.value;
    if (aadharNumber) formData.append('aadhar_number', aadharNumber);

    const passportNumber = document.getElementById('passport-number')?.value;
    if (passportNumber) formData.append('passport_number', passportNumber);

    const passportExpiry = document.getElementById('passport-expiry')?.value;
    if (passportExpiry) formData.append('passport_expiry', passportExpiry);

    // Document files
    if (pendingDocuments.photo) {
        formData.append('profile_photo', pendingDocuments.photo);
    }
    if (pendingDocuments.pan_front) {
        formData.append('pan_front', pendingDocuments.pan_front);
    }
    if (pendingDocuments.pan_back) {
        formData.append('pan_back', pendingDocuments.pan_back);
    }
    if (pendingDocuments.aadhar_front) {
        formData.append('aadhar_front', pendingDocuments.aadhar_front);
    }
    if (pendingDocuments.aadhar_back) {
        formData.append('aadhar_back', pendingDocuments.aadhar_back);
    }
    if (pendingDocuments.passport) {
        formData.append('passport', pendingDocuments.passport);
    }

    // Bank account info
    const bankName = document.getElementById('bankName').value;
    const accountNumber = document.getElementById('accountNumber').value;
    if (bankName && accountNumber) {
        formData.append('bank_name', bankName);
        formData.append('account_number', accountNumber);

        const accountHolderName = document.getElementById('accountHolderName').value;
        if (accountHolderName) formData.append('account_holder_name', accountHolderName);

        const ifscCode = document.getElementById('ifscCode').value;
        if (ifscCode) formData.append('ifsc_code', ifscCode.toUpperCase());

        const branchName = document.getElementById('branchName').value;
        if (branchName) formData.append('branch_name', branchName);

        formData.append('account_type', 'savings');
    }

    // Make the atomic request
    const result = await api.createHrmsEmployeeAtomic(formData);

    // Remove the user from availableUsers to prevent re-selection
    availableUsers = availableUsers.filter(u => u.user_id !== userId);
    filteredUsers = filteredUsers.filter(u => u.user_id !== userId);

    showToast('Employee created successfully', 'success');
    closeModal('employeeModal');
    await loadEmployees();
}

/**
 * Update an existing employee - uses separate calls for employee data and documents.
 */
async function saveEmployeeEdit(id) {
    // Note: first_name, last_name, and work_email are NOT sent to the backend
    // These fields are managed by the Auth service and sourced from there
    const data = {
        employee_code: document.getElementById('employeeCode').value,
        work_phone: document.getElementById('workPhone').value,
        date_of_birth: document.getElementById('dateOfBirth').value,
        gender: document.getElementById('gender').value || null,
        department_id: document.getElementById('departmentId').value,
        designation_id: document.getElementById('designationId').value,
        office_id: document.getElementById('officeId').value,
        shift_id: document.getElementById('shiftId').value || null,
        manager_user_id: document.getElementById('managerId').value || null,
        employment_type: document.getElementById('employmentType').value,
        hire_date: document.getElementById('dateOfJoining').value,
        probation_end_date: document.getElementById('probationEndDate').value,
        enable_geofence_attendance: document.getElementById('enableGeofenceAttendance').checked,
        // Attendance exempt override: null (use designation default), true (exempt), or false (required)
        attendance_exempt_override: (() => {
            const val = document.getElementById('attendanceExemptOverride').value;
            return val === '' ? null : val === 'true';
        })()
    };

    // Update employee record
    await api.updateHrmsEmployee(id, data);

    // Save bank account (non-blocking - continue even if fails)
    try {
        await saveBankAccount(id);
    } catch (bankError) {
        console.error('Error saving bank account:', bankError);
        showToast('Employee saved but bank account failed: ' + bankError.message, 'warning');
    }

    // Upload pending documents (all types including front/back)
    // Each upload is independent - if one fails, continue with others
    const docTypes = ['pan_front', 'pan_back', 'aadhar_front', 'aadhar_back', 'passport', 'photo'];
    let docUploadErrors = 0;
    for (const docType of docTypes) {
        if (pendingDocuments[docType]) {
            try {
                // Delete existing document if replacing
                if (existingDocuments[docType] && !existingDocuments[docType].markedForDeletion) {
                    await api.deleteEmployeeDocument(id, existingDocuments[docType].id);
                }
                await uploadDocument(id, docType, pendingDocuments[docType]);
            } catch (docError) {
                docUploadErrors++;
                console.error(`Error uploading ${docType}:`, docError);
            }
        }
    }

    // Delete documents marked for deletion
    for (const [docType, doc] of Object.entries(existingDocuments)) {
        if (doc && doc.markedForDeletion) {
            try {
                await api.deleteEmployeeDocument(id, doc.id);
            } catch (delError) {
                console.error(`Error deleting ${docType}:`, delError);
            }
        }
    }

    // Show success message (with note about document errors if any)
    if (docUploadErrors > 0) {
        showToast('Employee updated. Some documents failed to upload.', 'warning');
    } else {
        showToast('Employee updated successfully', 'success');
    }
    closeModal('employeeModal');
    await loadEmployees();
}

async function viewEmployee(id) {
    const content = document.getElementById('viewEmployeeContent');
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    openModal('viewEmployeeModal');

    try {
        const emp = await api.getHrmsEmployee(id);
        currentViewEmployee = emp;

        const dept = departments.find(d => d.id === emp.department_id);
        const desig = designations.find(d => d.id === emp.designation_id);
        const office = offices.find(o => o.id === emp.office_id);
        const shift = shifts.find(s => s.id === emp.shift_id);

        // Try to get employee photo
        let photoHtml = `<div class="employee-avatar-large">${getInitials(emp.first_name, emp.last_name)}</div>`;

        // Check cache first, then fetch
        if (employeePhotoCache[id]) {
            photoHtml = `<img class="employee-avatar-large-img" src="${employeePhotoCache[id]}" alt="${emp.first_name}" onerror="this.outerHTML='<div class=\\'employee-avatar-large\\'>${getInitials(emp.first_name, emp.last_name)}</div>'">`;
        } else {
            // Try to fetch photo from documents
            try {
                const documents = await api.getEmployeeDocuments(id);
                const photoDoc = documents.find(d => d.document_type === 'profile_photo');
                if (photoDoc) {
                    const downloadUrl = await api.getEmployeeDocumentDownloadUrl(id, photoDoc.id);
                    const photoUrl = downloadUrl.url || downloadUrl;
                    employeePhotoCache[id] = photoUrl;
                    photoHtml = `<img class="employee-avatar-large-img" src="${photoUrl}" alt="${emp.first_name}" onerror="this.outerHTML='<div class=\\'employee-avatar-large\\'>${getInitials(emp.first_name, emp.last_name)}</div>'">`;
                }
            } catch (e) {
                console.log('Could not load photo:', e);
            }
        }

        content.innerHTML = `
            <div class="employee-view-header">
                ${photoHtml}
                <div>
                    <h2>${emp.first_name} ${emp.last_name}</h2>
                    <p>${emp.employee_code || '-'} | ${desig?.designation_name || '-'}</p>
                </div>
                <span class="status-badge ${emp.employment_status}">${capitalizeFirst(emp.employment_status)}</span>
            </div>

            <div class="employee-view-sections">
                <div class="view-section">
                    <h4>Personal Information</h4>
                    <div class="view-grid">
                        <div class="view-item">
                            <span class="label">Email</span>
                            <span class="value">${emp.work_email}</span>
                        </div>
                        <div class="view-item">
                            <span class="label">Phone</span>
                            <span class="value">${emp.work_phone || '-'}</span>
                        </div>
                        <div class="view-item">
                            <span class="label">Date of Birth</span>
                            <span class="value">${formatDate(emp.date_of_birth) || '-'}</span>
                        </div>
                        <div class="view-item">
                            <span class="label">Gender</span>
                            <span class="value">${capitalizeFirst(emp.gender) || '-'}</span>
                        </div>
                    </div>
                </div>

                <div class="view-section">
                    <h4>Employment Details</h4>
                    <div class="view-grid">
                        <div class="view-item">
                            <span class="label">Department</span>
                            <span class="value">${dept?.department_name || '-'}</span>
                        </div>
                        <div class="view-item">
                            <span class="label">Designation</span>
                            <span class="value">${desig?.designation_name || '-'}</span>
                        </div>
                        <div class="view-item">
                            <span class="label">Office</span>
                            <span class="value">${office?.office_name || '-'}</span>
                        </div>
                        <div class="view-item">
                            <span class="label">Shift</span>
                            <span class="value">${shift?.shift_name || 'Default'}</span>
                        </div>
                        <div class="view-item">
                            <span class="label">Employment Type</span>
                            <span class="value">${capitalizeFirst(emp.employment_type?.replace('_', ' '))}</span>
                        </div>
                        <div class="view-item">
                            <span class="label">Joining Date</span>
                            <span class="value">${formatDate(emp.hire_date)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('editFromViewBtn').style.display = hrmsRoles.canEditEmployee() ? 'block' : 'none';

    } catch (error) {
        content.innerHTML = '<div class="empty-state"><p>Error loading employee details</p></div>';
    }
}

function editFromView() {
    if (currentViewEmployee) {
        closeModal('viewEmployeeModal');
        editEmployee(currentViewEmployee.id);
    }
}

// Utility functions
function getInitials(firstName, lastName) {
    return ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase() || 'U';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Cascading dropdown: Office → Department, Shift
function updateForOfficeChange() {
    const officeId = document.getElementById('officeId').value;

    // Update departments for this office
    updateDepartmentsForOffice(officeId);

    // Update shifts for this office
    updateShiftsForOffice(officeId);

    // Reset designation since department will change
    document.getElementById('designationId').innerHTML = '<option value="">Select department first...</option>';
}

function updateDepartmentsForOffice(officeId) {
    const deptSelect = document.getElementById('departmentId');
    const currentDeptId = deptSelect.value;

    if (!officeId) {
        deptSelect.innerHTML = '<option value="">Select office first...</option>';
        return;
    }

    // Filter departments by selected office (or show those without office_id for backward compatibility)
    // Also filter out departments that have no designations
    const filteredDepts = departments.filter(d => {
        const matchesOffice = !d.office_id || d.office_id === officeId;
        const hasDesignations = designations.some(desig => desig.department_id === d.id);
        return matchesOffice && hasDesignations;
    });

    if (filteredDepts.length === 0) {
        deptSelect.innerHTML = '<option value="">No departments with designations for this office</option>';
        return;
    }

    deptSelect.innerHTML = '<option value="">Select department...</option>' +
        filteredDepts.map(d => `<option value="${d.id}">${d.department_name}</option>`).join('');

    // Keep previous selection if still valid
    if (currentDeptId && filteredDepts.some(d => d.id === currentDeptId)) {
        deptSelect.value = currentDeptId;
        // Trigger designation update
        updateDesignationsForDepartment(currentDeptId);
    }
}

function updateShiftsForOffice(officeId) {
    const shiftSelect = document.getElementById('shiftId');
    const currentShiftId = shiftSelect.value;

    if (!officeId) {
        shiftSelect.innerHTML = '<option value="">Select office first...</option>';
        return;
    }

    // Filter shifts by selected office (or show those without office_id for global shifts)
    const filteredShifts = shifts.filter(s => !s.office_id || s.office_id === officeId);

    shiftSelect.innerHTML = '<option value="">Default shift</option>' +
        filteredShifts.map(s => `<option value="${s.id}">${s.shift_name}</option>`).join('');

    // Keep previous selection if still valid
    if (currentShiftId && filteredShifts.some(s => s.id === currentShiftId)) {
        shiftSelect.value = currentShiftId;
    }
}

// Cascading dropdown: Department → Designation
function updateDesignationsForDepartment(departmentId) {
    const desigSelect = document.getElementById('designationId');
    const currentDesigId = desigSelect.value;

    // Get departmentId from parameter or from the select element
    const deptId = departmentId || document.getElementById('departmentId').value;

    if (!deptId) {
        desigSelect.innerHTML = '<option value="">Select department first...</option>';
        return;
    }

    // Filter designations by selected department (or show those without department_id for backward compatibility)
    const filteredDesigs = designations.filter(d => !d.department_id || d.department_id === deptId);

    if (filteredDesigs.length === 0) {
        desigSelect.innerHTML = '<option value="">No designations for this department</option>';
        return;
    }

    desigSelect.innerHTML = '<option value="">Select designation...</option>' +
        filteredDesigs.map(d => `<option value="${d.id}">${d.designation_name}</option>`).join('');

    // Keep previous selection if still valid
    if (currentDesigId && filteredDesigs.some(d => d.id === currentDesigId)) {
        desigSelect.value = currentDesigId;
    }
}

// Called when department dropdown changes
function onDepartmentChange() {
    const deptId = document.getElementById('departmentId').value;
    updateDesignationsForDepartment(deptId);
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Local showToast removed - using unified toast.js instead

// ============================================
// Document Upload Functions
// ============================================

// Store pending uploads (files selected but not yet uploaded)
let pendingDocuments = {
    pan_front: null,
    pan_back: null,
    aadhar_front: null,
    aadhar_back: null,
    passport: null,
    photo: null
};

// Cache for employee photo URLs (employeeId -> photoUrl)
let employeePhotoCache = {};

// Existing documents loaded when editing
let existingDocuments = {};

function triggerFileUpload(docType) {
    document.getElementById(`${docType}-file`).click();
}

function handleDocumentSelect(docType, input) {
    const file = input.files[0];
    if (!file) return;

    // Validate file size (10MB for documents, 5MB for photo)
    const maxSize = docType === 'photo' ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
        showToast(`File too large. Maximum size is ${docType === 'photo' ? '5MB' : '10MB'}`, 'error');
        input.value = '';
        return;
    }

    // Validate file type
    const validTypes = docType === 'photo'
        ? ['image/jpeg', 'image/png']
        : ['image/jpeg', 'image/png', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
        showToast('Invalid file type', 'error');
        input.value = '';
        return;
    }

    // Store for later upload
    pendingDocuments[docType] = file;

    // New structure: Show thumbnail preview card
    const placeholderEl = document.getElementById(`${docType}-placeholder`);
    const previewCardEl = document.getElementById(`${docType}-preview-card`);
    const thumbEl = document.getElementById(`${docType}-thumb`);

    if (placeholderEl && previewCardEl && thumbEl) {
        // Show thumbnail for images
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                thumbEl.src = e.target.result;
                placeholderEl.style.display = 'none';
                previewCardEl.style.display = 'block';
            };
            reader.readAsDataURL(file);
        } else {
            // PDF - show placeholder icon
            thumbEl.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="12" y="16" font-size="6" text-anchor="middle" fill="%236b7280">PDF</text></svg>');
            placeholderEl.style.display = 'none';
            previewCardEl.style.display = 'block';
        }
    } else {
        // Fallback for old structure (if any)
        const previewEl = document.getElementById(`${docType}-preview`);
        const uploadArea = document.getElementById(`${docType}-upload`);

        if (previewEl && uploadArea) {
            const fileNameEl = previewEl.querySelector('.file-name');
            if (fileNameEl) fileNameEl.textContent = file.name;
            previewEl.style.display = 'flex';
            uploadArea.style.display = 'none';
        }
    }

    // Update status
    const statusEl = document.getElementById(`${docType}-status`);
    if (statusEl) {
        statusEl.textContent = 'Pending upload';
        statusEl.className = 'doc-status pending';
    }
}

// Open document zoom modal
function openDocumentZoom(docType) {
    const thumbEl = document.getElementById(`${docType}-thumb`);
    const modal = document.getElementById('docZoomModal');
    const zoomImg = document.getElementById('docZoomImage');

    if (thumbEl && modal && zoomImg) {
        zoomImg.src = thumbEl.src;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Close document zoom modal
function closeDocumentZoom(event) {
    // Only close if clicking on the backdrop or close button
    if (event.target.id === 'docZoomModal' || event.target.classList.contains('doc-zoom-close')) {
        const modal = document.getElementById('docZoomModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }
}

function handlePhotoSelect(input) {
    const file = input.files[0];
    if (!file) return;

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('Photo too large. Maximum size is 5MB', 'error');
        input.value = '';
        return;
    }

    // Validate file type
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
        showToast('Invalid file type. Only JPG and PNG allowed', 'error');
        input.value = '';
        return;
    }

    // Store for later upload
    pendingDocuments.photo = file;

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        const photoImage = document.getElementById('photoImage');
        const photoPlaceholder = document.getElementById('photoPlaceholder');
        const photoPreview = document.getElementById('photoPreview');

        photoImage.src = e.target.result;
        photoPlaceholder.style.display = 'none';
        photoPreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function removeDocument(docType) {
    pendingDocuments[docType] = null;

    const input = document.getElementById(`${docType}-file`);
    if (input) input.value = '';

    // New structure: Show placeholder, hide preview card
    const placeholderEl = document.getElementById(`${docType}-placeholder`);
    const previewCardEl = document.getElementById(`${docType}-preview-card`);
    const thumbEl = document.getElementById(`${docType}-thumb`);

    if (placeholderEl && previewCardEl) {
        placeholderEl.style.display = 'flex';
        previewCardEl.style.display = 'none';
        if (thumbEl) thumbEl.src = '';
    } else {
        // Fallback for old structure
        const previewEl = document.getElementById(`${docType}-preview`);
        const uploadArea = document.getElementById(`${docType}-upload`);

        if (previewEl && uploadArea) {
            previewEl.style.display = 'none';
            uploadArea.style.display = 'flex';
        }
    }

    const statusEl = document.getElementById(`${docType}-status`);
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'doc-status';
    }

    // Clear doc ID if it was an existing document
    const docIdEl = document.getElementById(`${docType}-doc-id`);
    if (docIdEl) docIdEl.value = '';

    // Mark for deletion if it was an existing document
    if (existingDocuments[docType]) {
        existingDocuments[docType].markedForDeletion = true;
    }
}

function removePhoto() {
    pendingDocuments.photo = null;

    const input = document.getElementById('photo-file');
    if (input) input.value = '';

    const photoImage = document.getElementById('photoImage');
    const photoPlaceholder = document.getElementById('photoPlaceholder');
    const photoPreview = document.getElementById('photoPreview');

    photoImage.src = '';
    photoPlaceholder.style.display = 'flex';
    photoPreview.style.display = 'none';

    // Clear doc ID
    document.getElementById('photo-doc-id').value = '';

    // Mark for deletion if it was an existing document
    if (existingDocuments.photo) {
        existingDocuments.photo.markedForDeletion = true;
    }
}

async function uploadDocument(employeeId, docType, file) {
    const docTypeMap = {
        'pan_front': 'pan_front',
        'pan_back': 'pan_back',
        'aadhar_front': 'aadhar_front',
        'aadhar_back': 'aadhar_back',
        'passport': 'passport',
        'photo': 'profile_photo'
    };

    // Determine which number field to use
    let docNumber = null;
    let expiryDate = null;

    if (docType.startsWith('pan')) {
        docNumber = document.getElementById('pan-number')?.value || null;
    } else if (docType.startsWith('aadhar')) {
        docNumber = document.getElementById('aadhar-number')?.value || null;
    } else if (docType === 'passport') {
        docNumber = document.getElementById('passport-number')?.value || null;
        expiryDate = document.getElementById('passport-expiry')?.value || null;
    }

    // Create a readable name for the document
    const docNames = {
        'pan_front': 'PAN Card (Front)',
        'pan_back': 'PAN Card (Back)',
        'aadhar_front': 'Aadhar Card (Front)',
        'aadhar_back': 'Aadhar Card (Back)',
        'passport': 'Passport',
        'photo': 'Profile Photo'
    };

    const formData = new FormData();
    formData.append('file', file);
    formData.append('document_type', docTypeMap[docType]);
    formData.append('document_name', `${docNames[docType] || docType} - ${file.name}`);
    if (docNumber) formData.append('document_number', docNumber);
    if (expiryDate) formData.append('expiry_date', expiryDate);

    return await api.uploadEmployeeDocument(employeeId, formData);
}

async function loadEmployeeDocuments(employeeId) {
    try {
        const documents = await api.getEmployeeDocuments(employeeId);
        existingDocuments = {};

        for (const doc of documents) {
            // Map backend document types to frontend element IDs
            const docTypeMap = {
                'pan_front': 'pan_front',
                'pan_back': 'pan_back',
                'aadhar_front': 'aadhar_front',
                'aadhar_back': 'aadhar_back',
                'passport': 'passport',
                'profile_photo': 'photo'
            };

            const docType = docTypeMap[doc.document_type];
            if (!docType) continue;

            existingDocuments[docType] = doc;

            if (docType === 'photo') {
                // Load photo preview
                if (doc.s3_key) {
                    try {
                        const downloadUrl = await api.getEmployeeDocumentDownloadUrl(employeeId, doc.id);
                        const photoImage = document.getElementById('photoImage');
                        const photoPlaceholder = document.getElementById('photoPlaceholder');
                        const photoPreview = document.getElementById('photoPreview');

                        const photoUrl = downloadUrl.url || downloadUrl;
                        photoImage.src = photoUrl;
                        photoPlaceholder.style.display = 'none';
                        photoPreview.style.display = 'block';

                        // Cache photo URL for table display
                        employeePhotoCache[employeeId] = photoUrl;
                    } catch (e) {
                        console.error('Error loading photo:', e);
                    }
                }
                document.getElementById('photo-doc-id').value = doc.id;
            } else {
                // Show document preview with actual image
                const previewCard = document.getElementById(`${docType}-preview-card`);
                const placeholder = document.getElementById(`${docType}-placeholder`);
                const thumbImg = document.getElementById(`${docType}-thumb`);

                if (previewCard && placeholder) {
                    // Fetch and display the document image
                    if (doc.s3_key && thumbImg) {
                        try {
                            const downloadUrl = await api.getEmployeeDocumentDownloadUrl(employeeId, doc.id);
                            const docUrl = downloadUrl.url || downloadUrl;
                            thumbImg.src = docUrl;
                        } catch (e) {
                            console.error(`Error loading ${docType} image:`, e);
                        }
                    }
                    previewCard.style.display = 'block';
                    placeholder.style.display = 'none';
                }

                // Set document number for pan/aadhar (shared across front/back)
                if (docType.startsWith('pan')) {
                    const docNumberEl = document.getElementById('pan-number');
                    if (docNumberEl && doc.document_number) {
                        docNumberEl.value = doc.document_number;
                    }
                } else if (docType.startsWith('aadhar')) {
                    const docNumberEl = document.getElementById('aadhar-number');
                    if (docNumberEl && doc.document_number) {
                        docNumberEl.value = doc.document_number;
                    }
                } else if (docType === 'passport') {
                    const docNumberEl = document.getElementById('passport-number');
                    if (docNumberEl && doc.document_number) {
                        docNumberEl.value = doc.document_number;
                    }
                    const expiryEl = document.getElementById('passport-expiry');
                    if (expiryEl && doc.expiry_date) {
                        expiryEl.value = doc.expiry_date.split('T')[0];
                    }
                }

                const docIdEl = document.getElementById(`${docType}-doc-id`);
                if (docIdEl) docIdEl.value = doc.id;
            }
        }

        // Update PAN status if both front and back are uploaded
        const panStatus = document.getElementById('pan-status');
        if (panStatus) {
            if (existingDocuments['pan_front'] && existingDocuments['pan_back']) {
                panStatus.textContent = 'Complete';
                panStatus.className = 'doc-status uploaded';
            } else if (existingDocuments['pan_front'] || existingDocuments['pan_back']) {
                panStatus.textContent = 'Partial';
                panStatus.className = 'doc-status pending';
            }
        }

        // Update Aadhar status if both front and back are uploaded
        const aadharStatus = document.getElementById('aadhar-status');
        if (aadharStatus) {
            if (existingDocuments['aadhar_front'] && existingDocuments['aadhar_back']) {
                aadharStatus.textContent = 'Complete';
                aadharStatus.className = 'doc-status uploaded';
            } else if (existingDocuments['aadhar_front'] || existingDocuments['aadhar_back']) {
                aadharStatus.textContent = 'Partial';
                aadharStatus.className = 'doc-status pending';
            }
        }
    } catch (error) {
        console.error('Error loading employee documents:', error);
    }
}

// ============================================
// Bank Account Functions
// ============================================

async function loadEmployeeBankAccount(employeeId) {
    try {
        const accounts = await api.getEmployeeBankAccounts(employeeId);
        if (accounts && accounts.length > 0) {
            // Use the primary account or first account
            const account = accounts.find(a => a.is_primary) || accounts[0];

            document.getElementById('bankAccountId').value = account.id;
            document.getElementById('accountHolderName').value = account.account_holder_name || '';
            document.getElementById('bankName').value = account.bank_name || '';
            document.getElementById('accountNumber').value = account.account_number || '';
            document.getElementById('confirmAccountNumber').value = account.account_number || '';
            document.getElementById('ifscCode').value = account.ifsc_code || '';
            document.getElementById('branchName').value = account.branch_name || '';
        }
    } catch (error) {
        console.error('Error loading bank account:', error);
    }
}

function validateBankDetails() {
    const accountNumber = document.getElementById('accountNumber').value;
    const confirmAccountNumber = document.getElementById('confirmAccountNumber').value;
    const ifscCode = document.getElementById('ifscCode').value;

    if (accountNumber && accountNumber !== confirmAccountNumber) {
        showToast('Account numbers do not match', 'error');
        return false;
    }

    // Bank routing code is required but format varies by country (IFSC, SWIFT, BIC, IBAN)
    // Just check if filled, no format validation

    return true;
}

async function saveBankAccount(employeeId) {
    const accountHolderName = document.getElementById('accountHolderName').value;
    const bankName = document.getElementById('bankName').value;
    const accountNumber = document.getElementById('accountNumber').value;
    const ifscCode = document.getElementById('ifscCode').value?.toUpperCase();
    const branchName = document.getElementById('branchName').value;
    const bankAccountId = document.getElementById('bankAccountId').value;

    // Skip if no bank details provided
    if (!accountHolderName && !bankName && !accountNumber) {
        return;
    }

    const data = {
        employee_id: employeeId,
        account_holder_name: accountHolderName,
        bank_name: bankName,
        account_number: accountNumber,
        ifsc_code: ifscCode,
        branch_name: branchName || null,
        is_primary: true
    };

    if (bankAccountId) {
        await api.updateEmployeeBankAccount(employeeId, bankAccountId, data);
    } else {
        await api.createEmployeeBankAccount(employeeId, data);
    }
}

// ============================================
// Reset Form Functions
// ============================================

function resetDocumentsAndBanking() {
    // Reset pending documents
    pendingDocuments = { pan_front: null, pan_back: null, aadhar_front: null, aadhar_back: null, passport: null, photo: null };
    existingDocuments = {};

    // Reset file inputs for all document types
    ['pan_front', 'pan_back', 'aadhar_front', 'aadhar_back', 'passport', 'photo'].forEach(docType => {
        const input = document.getElementById(`${docType}-file`);
        if (input) input.value = '';

        // NEW structure: Reset placeholder, preview-card, and thumb
        const placeholderEl = document.getElementById(`${docType}-placeholder`);
        const previewCardEl = document.getElementById(`${docType}-preview-card`);
        const thumbEl = document.getElementById(`${docType}-thumb`);

        if (placeholderEl) placeholderEl.style.display = 'flex';
        if (previewCardEl) previewCardEl.style.display = 'none';
        if (thumbEl) thumbEl.src = '';

        // OLD structure fallback: Reset preview and upload area
        const previewEl = document.getElementById(`${docType}-preview`);
        const uploadArea = document.getElementById(`${docType}-upload`);

        if (previewEl) previewEl.style.display = 'none';
        if (uploadArea) uploadArea.style.display = 'flex';

        const statusEl = document.getElementById(`${docType}-status`);
        if (statusEl) {
            statusEl.textContent = '';
            statusEl.className = 'doc-status';
        }

        const docIdEl = document.getElementById(`${docType}-doc-id`);
        if (docIdEl) docIdEl.value = '';
    });

    // Reset document number and expiry fields
    ['pan', 'aadhar', 'passport'].forEach(docType => {
        const numberEl = document.getElementById(`${docType}-number`);
        if (numberEl) numberEl.value = '';

        const expiryEl = document.getElementById(`${docType}-expiry`);
        if (expiryEl) expiryEl.value = '';
    });

    // Reset photo
    const photoImage = document.getElementById('photoImage');
    const photoPlaceholder = document.getElementById('photoPlaceholder');
    const photoPreview = document.getElementById('photoPreview');
    if (photoImage) {
        photoImage.src = '';
    }
    if (photoPlaceholder) photoPlaceholder.style.display = 'flex';
    if (photoPreview) photoPreview.style.display = 'none';

    // Reset bank fields
    document.getElementById('bankAccountId').value = '';
    document.getElementById('accountHolderName').value = '';
    document.getElementById('bankName').value = '';
    document.getElementById('accountNumber').value = '';
    document.getElementById('confirmAccountNumber').value = '';
    document.getElementById('ifscCode').value = '';
    document.getElementById('branchName').value = '';
}

// ============================================
// Employee Transfer Functions
// ============================================

let currentTransferEmployee = null;

async function openTransferModal(employeeId) {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
        showToast('Employee not found', 'error');
        return;
    }

    currentTransferEmployee = employee;

    // Set employee info (with photo if available)
    const initials = getInitials(employee.first_name, employee.last_name);
    const photoUrl = employeePhotoCache[employeeId];
    const avatarEl = document.getElementById('transferEmployeeAvatar');
    if (photoUrl) {
        avatarEl.innerHTML = `<img src="${photoUrl}" alt="${employee.first_name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.outerHTML='${initials}'">`;
    } else {
        avatarEl.textContent = initials || '-';
    }
    document.getElementById('transferEmployeeName').textContent =
        `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Unknown';
    document.getElementById('transferEmployeeCode').textContent = employee.employee_code || '-';

    // Set current values
    const currentOffice = offices.find(o => o.id === employee.office_id);
    const currentDept = departments.find(d => d.id === employee.department_id);
    const currentDesig = designations.find(d => d.id === employee.designation_id);
    const currentManager = employees.find(e => e.user_id === employee.manager_user_id);

    document.getElementById('currentOfficeName').textContent = currentOffice?.office_name || 'Not assigned';
    document.getElementById('currentDepartmentName').textContent = currentDept?.department_name || 'Not assigned';
    document.getElementById('currentDesignationName').textContent = currentDesig?.designation_name || 'Not assigned';
    document.getElementById('currentManagerName').textContent = currentManager
        ? `${currentManager.first_name} ${currentManager.last_name}`
        : 'None';

    // Reset form
    document.getElementById('transferForm').reset();
    document.getElementById('transferEmployeeId').value = employeeId;
    document.getElementById('transferEffectiveDate').value = new Date().toISOString().split('T')[0];

    // Populate dropdowns
    populateTransferDropdowns(employee);

    // Reset change sections
    document.getElementById('officeChangeSection').style.display = 'none';
    document.getElementById('departmentChangeSection').style.display = 'none';
    document.getElementById('managerChangeSection').style.display = 'none';

    // Uncheck all checkboxes
    document.getElementById('changeOffice').checked = false;
    document.getElementById('changeDepartment').checked = false;
    document.getElementById('changeManager').checked = false;

    openModal('transferModal');
}

function populateTransferDropdowns(employee) {
    // Populate office dropdown
    const officeSelect = document.getElementById('newOfficeId');
    officeSelect.innerHTML = '<option value="">Select new office...</option>' +
        offices.filter(o => o.id !== employee.office_id)
            .map(o => `<option value="${o.id}">${o.office_name}</option>`).join('');

    // Populate department dropdown (only departments with designations)
    const deptSelect = document.getElementById('newDepartmentId');
    const deptsWithDesignations = departments.filter(d =>
        designations.some(desig => desig.department_id === d.id)
    );
    deptSelect.innerHTML = '<option value="">Select new department...</option>' +
        deptsWithDesignations.map(d => `<option value="${d.id}">${d.department_name}</option>`).join('');

    // Populate designation dropdown (initially empty until department selected)
    document.getElementById('newDesignationId').innerHTML = '<option value="">Select department first...</option>';

    // Populate manager dropdown (exclude current employee and their direct reports)
    const managerSelect = document.getElementById('newManagerUserId');
    managerSelect.innerHTML = '<option value="">No manager (CEO/Top level)</option>' +
        employees.filter(e => e.id !== employee.id && e.user_id !== employee.manager_user_id)
            .map(e => `<option value="${e.user_id}">${e.first_name} ${e.last_name} (${e.employee_code})</option>`).join('');
}

function toggleTransferSection(sectionId, checkbox) {
    const section = document.getElementById(sectionId);
    section.style.display = checkbox.checked ? 'block' : 'none';
}

function onNewDepartmentChange() {
    const deptId = document.getElementById('newDepartmentId').value;
    const desigSelect = document.getElementById('newDesignationId');

    if (!deptId) {
        desigSelect.innerHTML = '<option value="">Select department first...</option>';
        return;
    }

    // Filter designations for this department
    const filteredDesigs = designations.filter(d => !d.department_id || d.department_id === deptId);

    desigSelect.innerHTML = '<option value="">Select new designation...</option>' +
        filteredDesigs.map(d => `<option value="${d.id}">${d.designation_name}</option>`).join('');
}

async function submitTransfer() {
    const employeeId = document.getElementById('transferEmployeeId').value;
    const effectiveDate = document.getElementById('transferEffectiveDate').value;
    const transferType = document.getElementById('transferType').value;
    const transferReason = document.getElementById('transferReason').value;

    if (!effectiveDate) {
        showToast('Please select an effective date', 'error');
        return;
    }

    const changeOffice = document.getElementById('changeOffice').checked;
    const changeDepartment = document.getElementById('changeDepartment').checked;
    const changeManager = document.getElementById('changeManager').checked;

    if (!changeOffice && !changeDepartment && !changeManager) {
        showToast('Please select at least one change to make', 'error');
        return;
    }

    const saveBtn = document.getElementById('submitTransferBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Processing...';

    try {
        // Build comprehensive transfer request
        const request = {
            employee_id: employeeId,
            effective_date: effectiveDate,
            transfer_type: transferType,
            transfer_reason: transferReason || null
        };

        if (changeOffice) {
            const newOfficeId = document.getElementById('newOfficeId').value;
            if (!newOfficeId) {
                showToast('Please select a new office', 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Submit Transfer';
                return;
            }
            request.new_office_id = newOfficeId;
        }

        if (changeDepartment) {
            const newDeptId = document.getElementById('newDepartmentId').value;
            if (!newDeptId) {
                showToast('Please select a new department', 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Submit Transfer';
                return;
            }
            request.new_department_id = newDeptId;
            const newDesigId = document.getElementById('newDesignationId').value;
            if (newDesigId) {
                request.new_designation_id = newDesigId;
            }
        }

        if (changeManager) {
            request.change_manager = true;
            const newManagerId = document.getElementById('newManagerUserId').value;
            request.new_manager_user_id = newManagerId || null;
        }

        // Call comprehensive transfer API
        await api.comprehensiveTransfer(request);

        showToast('Transfer completed successfully', 'success');
        closeModal('transferModal');
        await loadEmployees();

    } catch (error) {
        console.error('Error processing transfer:', error);
        showToast(error.message || 'Failed to process transfer', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Submit Transfer';
    }
}

// ============================================
// Transfer History Functions
// ============================================

// ============================================
// Manager Hierarchy Validation Functions
// ============================================

/**
 * Check if assigning newManagerUserId as manager to employeeId would create a circular dependency.
 * A circular dependency exists if the new manager (or any of their managers up the chain)
 * reports to the employee being modified.
 * @param {string} employeeId - The employee ID (guid) being assigned a new manager
 * @param {string} newManagerUserId - The user_id of the proposed new manager
 * @returns {boolean} - true if circular dependency would be created
 */
function wouldCreateCircularDependency(employeeId, newManagerUserId) {
    if (!newManagerUserId) return false;

    // Get the employee being modified
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return false;

    const visited = new Set();
    let currentUserId = newManagerUserId;

    while (currentUserId) {
        // Check if we've visited this user before (cycle in existing data)
        if (visited.has(currentUserId)) {
            return true;
        }
        visited.add(currentUserId);

        // Find the employee with this user_id
        const currentEmployee = employees.find(e => e.user_id === currentUserId);
        if (!currentEmployee) {
            break; // User doesn't have an employee record
        }

        // If this employee is the one we're assigning a manager to, it's circular
        if (currentEmployee.id === employeeId) {
            return true;
        }

        // Move up the chain
        currentUserId = currentEmployee.manager_user_id || currentEmployee.manager_user_id;
    }

    return false;
}

/**
 * Validate manager selection and show error if invalid.
 * @param {string} employeeId - The employee ID being modified (null for create)
 * @param {string} employeeUserId - The user_id of the employee being modified (for self-check)
 * @param {string} newManagerUserId - The proposed manager's user_id
 * @returns {object} - { valid: boolean, message: string }
 */
function validateManagerSelection(employeeId, employeeUserId, newManagerUserId) {
    if (!newManagerUserId) {
        return { valid: true, message: '' };
    }

    // 1. Check self-assignment
    if (employeeUserId && newManagerUserId === employeeUserId) {
        return {
            valid: false,
            message: 'Employee cannot be their own manager'
        };
    }

    // 2. Check if manager is an active employee
    const managerEmployee = employees.find(e => e.user_id === newManagerUserId);
    if (!managerEmployee) {
        return {
            valid: false,
            message: 'Selected manager is not a valid employee'
        };
    }

    if (managerEmployee.employment_status !== 'active' && !managerEmployee.is_active) {
        return {
            valid: false,
            message: 'Manager must be an active employee'
        };
    }

    // 3. Check for circular dependency (only for existing employees)
    if (employeeId && wouldCreateCircularDependency(employeeId, newManagerUserId)) {
        return {
            valid: false,
            message: 'This assignment would create a circular reporting structure. The selected manager (or someone in their reporting chain) reports to this employee.'
        };
    }

    return { valid: true, message: '' };
}

/**
 * Called when manager dropdown changes in the employee form
 */
function onManagerChange() {
    const employeeId = document.getElementById('employeeId').value;
    const userSelect = document.getElementById('userSelect');
    const employeeUserId = userSelect ? userSelect.value : null;
    const managerUserId = document.getElementById('managerId').value;
    const validationMsg = document.getElementById('managerValidationMsg');

    // For edit mode, get the employee's user_id from existing data
    let actualEmployeeUserId = employeeUserId;
    if (employeeId && !actualEmployeeUserId) {
        const employee = employees.find(e => e.id === employeeId);
        actualEmployeeUserId = employee?.user_id;
    }

    const validation = validateManagerSelection(employeeId, actualEmployeeUserId, managerUserId);

    const managerSelect = document.getElementById('managerId');
    if (!validation.valid) {
        showToast(validation.message, 'error');
        // Show inline validation message
        if (validationMsg) {
            validationMsg.textContent = validation.message;
            validationMsg.style.display = 'block';
        }
        // Reset to previous value or empty
        managerSelect.value = '';
    } else {
        // Hide validation message
        if (validationMsg) {
            validationMsg.style.display = 'none';
        }
    }
}

/**
 * Called when manager dropdown changes in the transfer modal
 */
function onTransferManagerChange() {
    const employeeId = document.getElementById('transferEmployeeId').value;
    if (!employeeId) return;

    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return;

    const newManagerUserId = document.getElementById('newManagerUserId').value;
    const validationMsg = document.getElementById('transferManagerValidationMsg');

    const validation = validateManagerSelection(employeeId, employee.user_id, newManagerUserId);

    if (!validation.valid) {
        showToast(validation.message, 'error');
        // Show inline validation message
        if (validationMsg) {
            validationMsg.textContent = validation.message;
            validationMsg.style.display = 'block';
        }
        // Reset to empty (No manager option)
        document.getElementById('newManagerUserId').value = '';
    } else {
        // Hide validation message
        if (validationMsg) {
            validationMsg.style.display = 'none';
        }
    }
}

/**
 * Filter manager dropdown to exclude invalid options
 * Only includes employees whose designation has manager/admin roles
 * @param {Array} employeeList - List of employees to filter
 * @param {string} currentEmployeeId - The employee being edited (to exclude from list)
 * @param {string} currentEmployeeUserId - The user_id of employee being edited (to check hierarchy)
 * @returns {Array} - Filtered list of valid managers
 */
function getValidManagers(employeeList, currentEmployeeId, currentEmployeeUserId) {
    // Roles that indicate manager capability
    const managerRoles = ['HRMS_MANAGER', 'HRMS_ADMIN', 'HRMS_HR_MANAGER', 'HRMS_HR_ADMIN'];

    // Helper function to check if designation has manager roles
    const hasManagerRole = (designationId) => {
        const desig = designations.find(d => d.id === designationId);
        if (!desig) return false;
        if (desig.is_manager === true) return true;
        if (Array.isArray(desig.default_hrms_roles)) {
            return desig.default_hrms_roles.some(role => managerRoles.includes(role));
        }
        return false;
    };

    return employeeList.filter(e => {
        // Exclude the employee themselves
        if (e.id === currentEmployeeId) return false;
        if (e.user_id === currentEmployeeUserId) return false;

        // Only include active employees
        if (e.employment_status !== 'active' && !e.is_active) return false;

        // Only include employees with manager/admin roles
        if (!hasManagerRole(e.designation_id)) return false;

        // Check if selecting this manager would create circular dependency
        if (currentEmployeeId && wouldCreateCircularDependency(currentEmployeeId, e.user_id)) {
            return false;
        }

        return true;
    });
}

async function viewTransferHistory(employeeId) {
    const content = document.getElementById('transferHistoryContent');
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    openModal('transferHistoryModal');

    try {
        const history = await api.getEmployeeFullTransferHistory(employeeId);
        const employee = employees.find(e => e.id === employeeId);

        // Get photo if available
        const photoUrl = employeePhotoCache[employeeId];
        const initials = getInitials(employee?.first_name, employee?.last_name);
        const avatarHtml = photoUrl
            ? `<img src="${photoUrl}" alt="${employee?.first_name}" class="employee-avatar-large-img" style="width:60px;height:60px;object-fit:cover;border-radius:50%;" onerror="this.outerHTML='<div class=\\'employee-avatar-large\\'>${initials}</div>'">`
            : `<div class="employee-avatar-large">${initials}</div>`;

        let html = `
            <div class="transfer-history-header">
                ${avatarHtml}
                <div>
                    <h3>${employee?.first_name || ''} ${employee?.last_name || ''}</h3>
                    <p>${employee?.employee_code || ''}</p>
                </div>
            </div>

            <div class="transfer-stats">
                <div class="stat-item">
                    <span class="stat-value">${history.total_office_transfers || 0}</span>
                    <span class="stat-label">Office Transfers</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${history.total_department_changes || 0}</span>
                    <span class="stat-label">Department Changes</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${history.total_manager_changes || 0}</span>
                    <span class="stat-label">Manager Changes</span>
                </div>
            </div>
        `;

        // Office History
        if (history.office_history && history.office_history.length > 0) {
            html += `
                <div class="history-section">
                    <h4>Office History</h4>
                    <div class="history-timeline">
                        ${history.office_history.map((item, idx) => {
                            const office = offices.find(o => o.id === item.office_id);
                            const isCurrent = !item.effective_to;
                            return `
                                <div class="timeline-item ${isCurrent ? 'current' : ''}">
                                    <div class="timeline-marker"></div>
                                    <div class="timeline-content">
                                        <div class="timeline-header">
                                            <span class="timeline-title">${office?.office_name || 'Unknown Office'}</span>
                                            ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
                                        </div>
                                        <div class="timeline-date">
                                            ${formatDate(item.effective_from)} - ${item.effective_to ? formatDate(item.effective_to) : 'Present'}
                                        </div>
                                        ${item.transfer_reason ? `<div class="timeline-reason">${item.transfer_reason}</div>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        // Department History
        if (history.department_history && history.department_history.length > 0) {
            html += `
                <div class="history-section">
                    <h4>Department History</h4>
                    <div class="history-timeline">
                        ${history.department_history.map((item, idx) => {
                            const dept = departments.find(d => d.id === item.department_id);
                            const desig = designations.find(d => d.id === item.designation_id);
                            const isCurrent = !item.effective_to;
                            return `
                                <div class="timeline-item ${isCurrent ? 'current' : ''}">
                                    <div class="timeline-marker"></div>
                                    <div class="timeline-content">
                                        <div class="timeline-header">
                                            <span class="timeline-title">${dept?.department_name || 'Unknown'}</span>
                                            ${desig ? `<span class="timeline-subtitle">${desig.designation_name}</span>` : ''}
                                            ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
                                        </div>
                                        <div class="timeline-date">
                                            ${formatDate(item.effective_from)} - ${item.effective_to ? formatDate(item.effective_to) : 'Present'}
                                        </div>
                                        ${item.transfer_type ? `<span class="transfer-type-badge ${item.transfer_type}">${capitalizeFirst(item.transfer_type)}</span>` : ''}
                                        ${item.transfer_reason ? `<div class="timeline-reason">${item.transfer_reason}</div>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        // Manager History
        if (history.manager_history && history.manager_history.length > 0) {
            html += `
                <div class="history-section">
                    <h4>Manager History</h4>
                    <div class="history-timeline">
                        ${history.manager_history.map((item, idx) => {
                            const manager = employees.find(e => e.user_id === item.manager_user_id);
                            const isCurrent = !item.effective_to;
                            return `
                                <div class="timeline-item ${isCurrent ? 'current' : ''}">
                                    <div class="timeline-marker"></div>
                                    <div class="timeline-content">
                                        <div class="timeline-header">
                                            <span class="timeline-title">${manager ? `${manager.first_name} ${manager.last_name}` : (item.manager_user_id ? 'Unknown Manager' : 'No Manager')}</span>
                                            ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
                                        </div>
                                        <div class="timeline-date">
                                            ${formatDate(item.effective_from)} - ${item.effective_to ? formatDate(item.effective_to) : 'Present'}
                                        </div>
                                        ${item.change_reason ? `<div class="timeline-reason">${item.change_reason}</div>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        if (!history.office_history?.length && !history.department_history?.length && !history.manager_history?.length) {
            html += '<div class="empty-state"><p>No transfer history found</p></div>';
        }

        content.innerHTML = html;

    } catch (error) {
        console.error('Error loading transfer history:', error);
        content.innerHTML = '<div class="empty-state"><p>Error loading transfer history</p></div>';
    }
}

// ============================================
// Reassign Manager Functions (Compact Modal with Searchable Dropdown)
// ============================================

let currentReassignEmployee = null;
let validManagersList = [];
let filteredManagersList = [];
let selectedManagerIndex = -1;
let managerDropdownOpen = false;

// Virtual scrolling config
const ITEM_HEIGHT = 44; // Height of each dropdown item in pixels
const VISIBLE_ITEMS = 6; // Number of items visible at once

/**
 * Opens the compact Reassign Manager modal
 */
async function openReassignManagerModal(employeeId) {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
        showToast('Employee not found', 'error');
        return;
    }

    currentReassignEmployee = employee;

    // Set employee info in modal
    document.getElementById('reassignEmployeeId').value = employeeId;
    document.getElementById('reassignEmployeeName').textContent = `${employee.first_name} ${employee.last_name}`;
    document.getElementById('reassignEmployeeCode').textContent = employee.employee_code || 'N/A';

    const initials = `${(employee.first_name || '')[0] || ''}${(employee.last_name || '')[0] || ''}`.toUpperCase();
    document.getElementById('reassignEmployeeAvatar').textContent = initials || '--';

    // Show loading in manager history
    document.getElementById('managerHistoryList').innerHTML = '<div class="no-history-message">Loading...</div>';

    // Set default effective date to today
    document.getElementById('reassignEffectiveDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('reassignReason').value = '';

    // Prepare manager list for searchable dropdown
    await prepareManagerList(employee);

    // Reset search input and selection
    document.getElementById('managerSearchInput').value = '';
    document.getElementById('newReportingManagerId').value = '';
    filteredManagersList = [...validManagersList];
    selectedManagerIndex = -1;

    // Initialize dropdown
    initSearchableDropdown();
    renderVirtualList();

    // Hide validation message
    document.getElementById('reassignManagerValidationMsg').style.display = 'none';

    openModal('reassignManagerModal');

    // Load manager history asynchronously
    await loadManagerHistory(employeeId, employee);
}

/**
 * Load and display manager history for an employee
 */
async function loadManagerHistory(employeeId, employee) {
    const historyContainer = document.getElementById('managerHistoryList');

    try {
        // Get manager history from API
        const history = await api.request(`/hrms/employees/${employeeId}/manager-history`);

        // Build the history display
        let html = '';

        // Current manager (shown first with "Current" badge)
        const currentManager = employees.find(e => e.user_id === employee.manager_user_id);
        const currentEffectiveDate = history && history.length > 0
            ? history[0].effective_date
            : employee.date_of_joining || employee.hire_date;

        html += `
            <div class="manager-history-item current">
                <div class="manager-avatar">${currentManager
                    ? `${(currentManager.first_name || '')[0] || ''}${(currentManager.last_name || '')[0] || ''}`.toUpperCase()
                    : '—'}</div>
                <div class="manager-info">
                    <div class="manager-name">${currentManager
                        ? `${currentManager.first_name} ${currentManager.last_name}`
                        : 'No Manager (Top level)'}</div>
                    <div class="manager-period">${formatDate(currentEffectiveDate)} → Present</div>
                </div>
                <span class="current-badge">Current</span>
            </div>
        `;

        // Previous managers from history (most recent first)
        if (history && history.length > 0) {
            // Skip first entry as it represents change TO current manager
            for (let i = 0; i < history.length; i++) {
                const record = history[i];
                const prevManager = record.old_manager_name || 'No Manager';
                const prevManagerInitials = prevManager !== 'No Manager'
                    ? prevManager.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                    : '—';

                // Calculate period - from previous change date to this change date
                const periodEnd = record.effective_date;
                const periodStart = history[i + 1]
                    ? history[i + 1].effective_date
                    : employee.date_of_joining || employee.hire_date;

                html += `
                    <div class="manager-history-item">
                        <div class="manager-avatar">${prevManagerInitials}</div>
                        <div class="manager-info">
                            <div class="manager-name">${prevManager === 'No Manager' ? 'No Manager (Top level)' : prevManager}</div>
                            <div class="manager-period">${formatDate(periodStart)} → ${formatDate(periodEnd)}</div>
                        </div>
                    </div>
                `;
            }
        }

        historyContainer.innerHTML = html || '<div class="no-history-message">No reporting history</div>';

        // Update count badge (1 for current + history entries)
        const totalCount = 1 + (history ? history.length : 0);
        const countBadge = document.getElementById('managerHistoryCount');
        if (countBadge) {
            countBadge.textContent = totalCount;
            countBadge.style.display = totalCount > 1 ? 'inline-flex' : 'none';
        }

    } catch (error) {
        console.error('Error loading manager history:', error);

        // Fallback: show current manager only
        const currentManager = employees.find(e => e.user_id === employee.manager_user_id);
        const joiningDate = employee.date_of_joining || employee.hire_date;

        historyContainer.innerHTML = `
            <div class="manager-history-item current">
                <div class="manager-avatar">${currentManager
                    ? `${(currentManager.first_name || '')[0] || ''}${(currentManager.last_name || '')[0] || ''}`.toUpperCase()
                    : '—'}</div>
                <div class="manager-info">
                    <div class="manager-name">${currentManager
                        ? `${currentManager.first_name} ${currentManager.last_name}`
                        : 'No Manager (Top level)'}</div>
                    <div class="manager-period">${formatDate(joiningDate)} → Present</div>
                </div>
                <span class="current-badge">Current</span>
            </div>
        `;

        // Hide count badge on error (only current manager shown)
        const countBadge = document.getElementById('managerHistoryCount');
        if (countBadge) {
            countBadge.style.display = 'none';
        }
    }
}

/**
 * Prepare the list of valid managers for the dropdown
 * Only includes employees whose designation has manager/admin roles
 */
async function prepareManagerList(employee) {
    // Roles that indicate manager capability
    const managerRoles = ['HRMS_MANAGER', 'HRMS_ADMIN', 'HRMS_HR_MANAGER', 'HRMS_HR_ADMIN'];

    // Helper function to check if designation has manager roles
    const hasManagerRole = (designationId) => {
        const desig = designations.find(d => d.id === designationId);
        if (!desig) return false;
        if (desig.is_manager === true) return true;
        if (Array.isArray(desig.default_hrms_roles)) {
            return desig.default_hrms_roles.some(role => managerRoles.includes(role));
        }
        return false;
    };

    validManagersList = employees.filter(e => {
        // Exclude self
        if (e.id === employee.id) return false;
        // Exclude inactive employees
        if (e.employment_status !== 'active' && !e.is_active) return false;
        // Exclude current manager (no change)
        if (e.user_id === employee.manager_user_id) return false;
        // Only include employees with manager/admin roles
        if (!hasManagerRole(e.designation_id)) return false;
        // Check circular dependency
        if (wouldCreateCircularDependency(employee.id, e.user_id)) return false;
        return true;
    }).map(mgr => ({
        user_id: mgr.user_id,
        name: `${mgr.first_name} ${mgr.last_name}`,
        code: mgr.employee_code || 'N/A',
        email: mgr.work_email || mgr.email || '',
        initials: `${(mgr.first_name || '')[0] || ''}${(mgr.last_name || '')[0] || ''}`.toUpperCase(),
        department: mgr.department_name || '',
        designation: mgr.designation_name || '',
        office: mgr.office_name || '',
        searchText: `${mgr.first_name} ${mgr.last_name} ${mgr.employee_code || ''} ${mgr.work_email || mgr.email || ''} ${mgr.designation_name || ''} ${mgr.office_name || ''}`.toLowerCase()
    }));

    filteredManagersList = [...validManagersList];
}

/**
 * Initialize the searchable dropdown with event listeners
 */
function initSearchableDropdown() {
    const container = document.getElementById('managerDropdownContainer');
    const searchInput = document.getElementById('managerSearchInput');
    const dropdownList = document.getElementById('managerDropdownList');

    // Remove old listeners by replacing element
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);

    // Focus/click opens dropdown
    newSearchInput.addEventListener('focus', () => openManagerDropdown());
    newSearchInput.addEventListener('click', () => openManagerDropdown());

    // Search input handler with debounce
    let searchTimeout;
    newSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            filterManagers(e.target.value);
        }, 150);
    });

    // Keyboard navigation
    newSearchInput.addEventListener('keydown', handleDropdownKeyboard);

    // Close dropdown on click outside
    document.addEventListener('click', handleDropdownClickOutside);

    // Handle "No manager" option click
    const noManagerOption = dropdownList.querySelector('.no-manager');
    if (noManagerOption) {
        noManagerOption.onclick = () => selectManager('', 'No manager (Top level)');
    }
}

/**
 * Open the manager dropdown
 */
function openManagerDropdown() {
    const container = document.getElementById('managerDropdownContainer');
    container.classList.add('open');
    managerDropdownOpen = true;
    selectedManagerIndex = -1;
}

/**
 * Close the manager dropdown
 */
function closeManagerDropdown() {
    const container = document.getElementById('managerDropdownContainer');
    container.classList.remove('open');
    managerDropdownOpen = false;
    selectedManagerIndex = -1;
}

/**
 * Handle click outside dropdown to close it
 */
function handleDropdownClickOutside(e) {
    const container = document.getElementById('managerDropdownContainer');
    if (container && !container.contains(e.target)) {
        closeManagerDropdown();
    }
}

/**
 * Handle keyboard navigation in dropdown
 */
function handleDropdownKeyboard(e) {
    if (!managerDropdownOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
            openManagerDropdown();
            e.preventDefault();
        }
        return;
    }

    const totalItems = filteredManagersList.length + 1; // +1 for "No manager" option

    switch(e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedManagerIndex = Math.min(selectedManagerIndex + 1, totalItems - 1);
            highlightItem(selectedManagerIndex);
            scrollToItem(selectedManagerIndex);
            break;
        case 'ArrowUp':
            e.preventDefault();
            selectedManagerIndex = Math.max(selectedManagerIndex - 1, -1);
            highlightItem(selectedManagerIndex);
            scrollToItem(selectedManagerIndex);
            break;
        case 'Enter':
            e.preventDefault();
            if (selectedManagerIndex === 0) {
                // "No manager" option
                selectManager('', 'No manager (Top level)');
            } else if (selectedManagerIndex > 0 && selectedManagerIndex <= filteredManagersList.length) {
                const mgr = filteredManagersList[selectedManagerIndex - 1];
                selectManager(mgr.user_id, mgr.name);
            }
            break;
        case 'Escape':
            closeManagerDropdown();
            break;
    }
}

/**
 * Filter managers based on search query
 */
function filterManagers(query) {
    const searchTerm = query.toLowerCase().trim();

    if (!searchTerm) {
        filteredManagersList = [...validManagersList];
    } else {
        filteredManagersList = validManagersList.filter(mgr =>
            mgr.searchText.includes(searchTerm)
        );
    }

    selectedManagerIndex = -1;
    renderVirtualList();
}

/**
 * Render the virtual scrolling list
 */
function renderVirtualList() {
    const container = document.getElementById('managerVirtualList');

    if (filteredManagersList.length === 0) {
        container.innerHTML = '<div class="dropdown-no-results">No managers found</div>';
        return;
    }

    // For smaller lists (<100), render all items
    // For larger lists, implement true virtual scrolling
    if (filteredManagersList.length < 100) {
        container.innerHTML = filteredManagersList.map((mgr, index) => {
            const line1 = [mgr.code, mgr.designation].filter(Boolean).join(' • ');
            const line2 = [mgr.department, mgr.office].filter(Boolean).join(' • ');
            const line3 = mgr.email;
            return `
            <div class="dropdown-item" data-index="${index + 1}" data-value="${mgr.user_id}" onclick="selectManager('${mgr.user_id}', '${mgr.name.replace(/'/g, "\\'")}')">
                <span class="item-avatar">${mgr.initials}</span>
                <div class="item-name">
                    <strong>${mgr.name}</strong>
                    <small>${line1}${line2 ? '<br>' + line2 : ''}${line3 ? '<br>' + line3 : ''}</small>
                </div>
            </div>
        `;
        }).join('');
    } else {
        // True virtual scrolling for large lists
        renderVirtualScrollItems(container);
    }
}

/**
 * Render virtual scroll items (for large lists)
 */
function renderVirtualScrollItems(container) {
    const dropdownList = document.getElementById('managerDropdownList');
    const scrollTop = dropdownList.scrollTop;
    const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    const endIndex = Math.min(startIndex + VISIBLE_ITEMS + 2, filteredManagersList.length);

    // Set container height for proper scrollbar
    container.style.height = `${filteredManagersList.length * ITEM_HEIGHT}px`;

    let html = '';
    for (let i = startIndex; i < endIndex; i++) {
        const mgr = filteredManagersList[i];
        const top = i * ITEM_HEIGHT;
        const line1 = [mgr.code, mgr.designation].filter(Boolean).join(' • ');
        const line2 = [mgr.department, mgr.office].filter(Boolean).join(' • ');
        const line3 = mgr.email;
        html += `
            <div class="dropdown-item" style="position: absolute; top: ${top}px; left: 0; right: 0;"
                 data-index="${i + 1}" data-value="${mgr.user_id}"
                 onclick="selectManager('${mgr.user_id}', '${mgr.name.replace(/'/g, "\\'")}')">
                <span class="item-avatar">${mgr.initials}</span>
                <div class="item-name">
                    <strong>${mgr.name}</strong>
                    <small>${line1}${line2 ? '<br>' + line2 : ''}${line3 ? '<br>' + line3 : ''}</small>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;

    // Attach scroll listener for virtual scrolling
    dropdownList.onscroll = () => renderVirtualScrollItems(container);
}

/**
 * Highlight an item by index
 */
function highlightItem(index) {
    const container = document.getElementById('managerDropdownList');
    container.querySelectorAll('.dropdown-item').forEach(item => {
        item.classList.remove('highlighted');
        if (parseInt(item.dataset.index) === index) {
            item.classList.add('highlighted');
        }
    });
}

/**
 * Scroll to an item by index
 */
function scrollToItem(index) {
    const container = document.getElementById('managerDropdownList');
    const item = container.querySelector(`[data-index="${index}"]`);
    if (item) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

/**
 * Select a manager from the dropdown
 */
function selectManager(userId, displayName) {
    document.getElementById('newReportingManagerId').value = userId;
    document.getElementById('managerSearchInput').value = displayName;
    closeManagerDropdown();

    // Mark selected item
    const container = document.getElementById('managerDropdownList');
    container.querySelectorAll('.dropdown-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.value === userId) {
            item.classList.add('selected');
        }
    });
}

/**
 * Check for circular dependency when reassigning manager
 */
function wouldCreateCircularDependency(employeeId, newManagerUserId) {
    if (!newManagerUserId) return false;

    let currentUserId = newManagerUserId;
    const visited = new Set();

    while (currentUserId && !visited.has(currentUserId)) {
        visited.add(currentUserId);
        const currentEmployee = employees.find(e => e.user_id === currentUserId);

        if (!currentEmployee) break;

        // If we reach the original employee, it's circular
        if (currentEmployee.id === employeeId) return true;

        currentUserId = currentEmployee.manager_user_id;
    }

    return false;
}

/**
 * Submit the manager reassignment
 */
async function submitReassignManager() {
    const employeeId = document.getElementById('reassignEmployeeId').value;
    const newManagerUserId = document.getElementById('newReportingManagerId').value;
    const effectiveDate = document.getElementById('reassignEffectiveDate').value;
    const reason = document.getElementById('reassignReason').value.trim();

    if (!effectiveDate) {
        showToast('Please select an effective date', 'error');
        return;
    }

    // Validate manager selection
    if (newManagerUserId && currentReassignEmployee) {
        if (wouldCreateCircularDependency(currentReassignEmployee.id, newManagerUserId)) {
            document.getElementById('reassignManagerValidationMsg').textContent =
                'This would create a circular reporting structure';
            document.getElementById('reassignManagerValidationMsg').style.display = 'block';
            return;
        }
    }

    const submitBtn = document.getElementById('submitReassignBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Reassigning...';

    try {
        // Call the dedicated manager change API
        const response = await api.request('/hrms/employee-transfers/manager', {
            method: 'POST',
            body: JSON.stringify({
                employee_id: employeeId,
                new_manager_user_id: newManagerUserId || null,
                effective_from: effectiveDate,
                change_reason: reason || 'Manager reassignment'
            })
        });

        showToast('Manager reassigned successfully', 'success');
        closeModal('reassignManagerModal');
        await loadEmployees();

    } catch (error) {
        console.error('Error reassigning manager:', error);
        showToast(error.message || 'Failed to reassign manager', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reassign';
    }
}

// ============================================
// Employee Wizard Navigation Functions
// ============================================

let currentEmployeeStep = 1;
const totalEmployeeSteps = 4; // Always 4 steps (NFC management moved to separate tab)

function goToEmployeeStep(stepNumber) {
    // Validate current step before moving forward
    if (stepNumber > currentEmployeeStep && !validateEmployeeStep(currentEmployeeStep)) {
        return;
    }

    // Update step indicators (using data-step attribute)
    const wizardSteps = document.querySelectorAll('#employeeModal .wizard-step');
    wizardSteps.forEach(stepEl => {
        const step = parseInt(stepEl.getAttribute('data-step'));
        stepEl.classList.remove('active', 'completed');
        if (step < stepNumber) {
            stepEl.classList.add('completed');
        } else if (step === stepNumber) {
            stepEl.classList.add('active');
        }
    });

    // Update panels (using employeeStep1, employeeStep2, etc.)
    for (let i = 1; i <= totalEmployeeSteps; i++) {
        const panelEl = document.getElementById(`employeeStep${i}`);
        if (!panelEl) continue;

        panelEl.classList.remove('active');
        if (i === stepNumber) {
            panelEl.classList.add('active');
        }
    }

    // Update navigation buttons
    const backBtn = document.getElementById('empWizardPrevBtn');
    const nextBtn = document.getElementById('empWizardNextBtn');
    const saveBtn = document.getElementById('empWizardSaveBtn');

    if (backBtn) backBtn.style.display = stepNumber === 1 ? 'none' : 'inline-flex';
    if (nextBtn) nextBtn.style.display = stepNumber === totalEmployeeSteps ? 'none' : 'inline-flex';
    if (saveBtn) saveBtn.style.display = stepNumber === totalEmployeeSteps ? 'inline-flex' : 'none';

    currentEmployeeStep = stepNumber;
}

function nextEmployeeStep() {
    if (currentEmployeeStep < totalEmployeeSteps) {
        goToEmployeeStep(currentEmployeeStep + 1);
    }
}

function prevEmployeeStep() {
    if (currentEmployeeStep > 1) {
        goToEmployeeStep(currentEmployeeStep - 1);
    }
}

function validateEmployeeStep(stepNumber) {
    switch (stepNumber) {
        case 1: // Personal Information
            return validatePersonalStep();
        case 2: // Employment Details
            return validateEmploymentStep();
        case 3: // Banking Details
            return validateBankingStep();
        case 4: // Documents
            return validateDocumentsStep();
        default:
            return true;
    }
}

function validateDocumentsStep() {
    const employeeId = document.getElementById('employeeId').value;
    const isEdit = !!employeeId;

    // Check for photo - either pending upload or existing document
    const hasPhoto = pendingDocuments.photo || (existingDocuments.photo && !existingDocuments.photo.markedForDeletion);
    if (!hasPhoto) {
        showToast('Employee photo is required', 'error');
        return false;
    }

    // Check for PAN front - either pending upload or existing document
    const hasPanFront = pendingDocuments.pan_front || (existingDocuments.pan_front && !existingDocuments.pan_front.markedForDeletion);
    if (!hasPanFront) {
        showToast('PAN Card front is required', 'error');
        return false;
    }

    // Check for PAN back - either pending upload or existing document
    const hasPanBack = pendingDocuments.pan_back || (existingDocuments.pan_back && !existingDocuments.pan_back.markedForDeletion);
    if (!hasPanBack) {
        showToast('PAN Card back is required', 'error');
        return false;
    }

    // Check for Aadhar front - either pending upload or existing document
    const hasAadharFront = pendingDocuments.aadhar_front || (existingDocuments.aadhar_front && !existingDocuments.aadhar_front.markedForDeletion);
    if (!hasAadharFront) {
        showToast('Aadhar Card front is required', 'error');
        return false;
    }

    // Check for Aadhar back - either pending upload or existing document
    const hasAadharBack = pendingDocuments.aadhar_back || (existingDocuments.aadhar_back && !existingDocuments.aadhar_back.markedForDeletion);
    if (!hasAadharBack) {
        showToast('Aadhar Card back is required', 'error');
        return false;
    }

    return true;
}

function validatePersonalStep() {
    const employeeId = document.getElementById('employeeId').value;
    const isEdit = !!employeeId;

    // For new employees, user must be selected
    if (!isEdit) {
        const userId = document.getElementById('userSelect').value;
        if (!userId) {
            showToast('Please select a user account', 'error');
            return false;
        }
    }

    // Employee code is required
    const employeeCode = document.getElementById('employeeCode').value;
    if (!employeeCode.trim()) {
        showToast('Employee code is required', 'error');
        return false;
    }

    // Phone number is mandatory
    const workPhone = document.getElementById('workPhone').value;
    if (!workPhone || !workPhone.trim()) {
        showToast('Phone number is required', 'error');
        return false;
    }

    // Date of birth is mandatory
    const dateOfBirth = document.getElementById('dateOfBirth').value;
    if (!dateOfBirth) {
        showToast('Date of birth is required', 'error');
        return false;
    }

    return true;
}

function validateEmploymentStep() {
    const officeId = document.getElementById('officeId').value;
    const departmentId = document.getElementById('departmentId').value;
    const designationId = document.getElementById('designationId').value;
    const hireDate = document.getElementById('dateOfJoining').value;
    const probationEndDate = document.getElementById('probationEndDate').value;

    if (!officeId) {
        showToast('Please select an office', 'error');
        return false;
    }

    if (!departmentId) {
        showToast('Please select a department', 'error');
        return false;
    }

    if (!designationId) {
        showToast('Please select a designation', 'error');
        return false;
    }

    if (!hireDate) {
        showToast('Date of joining is required', 'error');
        return false;
    }

    if (!probationEndDate) {
        showToast('Probation end date is required', 'error');
        return false;
    }

    // Validate probation end date is after joining date
    if (hireDate && probationEndDate && new Date(probationEndDate) <= new Date(hireDate)) {
        showToast('Probation end date must be after date of joining', 'error');
        return false;
    }

    return true;
}

function validateBankingStep() {
    // Banking is optional, but if account number is provided, validate
    const accountNumber = document.getElementById('accountNumber').value;
    const confirmAccountNumber = document.getElementById('confirmAccountNumber').value;
    const ifscCode = document.getElementById('ifscCode').value;

    if (accountNumber && accountNumber !== confirmAccountNumber) {
        showToast('Account numbers do not match', 'error');
        return false;
    }

    // Bank routing code is required but format varies by country (IFSC, SWIFT, BIC, IBAN)
    // Just check if filled, no format validation

    return true;
}

// Reset wizard to step 1 when opening modal
function resetEmployeeWizard() {
    currentEmployeeStep = 1;
    goToEmployeeStep(1);
}

// ============================================
// Employee Termination Functions
// ============================================

let terminatingEmployeeId = null;

/**
 * Show the termination modal with employee information
 */
function showTerminateModal(employeeId) {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
        showToast('Employee not found', 'error');
        return;
    }

    // Store the employee ID for later
    terminatingEmployeeId = employeeId;

    // Get department and designation info
    const dept = departments.find(d => d.id === employee.department_id);
    const desig = designations.find(d => d.id === employee.designation_id);

    // Populate employee info in the modal
    const employeeInfoEl = document.getElementById('terminateEmployeeInfo');
    if (employeeInfoEl) {
        // Get photo from cache if available
        const photoUrl = employeePhotoCache[employee.id];
        const photoHtml = photoUrl
            ? `<img class="terminate-employee-avatar-img" src="${photoUrl}" alt="${employee.first_name}" onerror="this.outerHTML='<div class=\\'terminate-employee-avatar\\'>${getInitials(employee.first_name, employee.last_name)}</div>'">`
            : `<div class="terminate-employee-avatar">${getInitials(employee.first_name, employee.last_name)}</div>`;

        employeeInfoEl.innerHTML = `
            <div class="terminate-employee-card">
                ${photoHtml}
                <div class="terminate-employee-details">
                    <h4>${employee.first_name} ${employee.last_name}</h4>
                    <p class="employee-code">${employee.employee_code || '-'}</p>
                    <p>${desig?.designation_name || '-'} • ${dept?.department_name || '-'}</p>
                    <p class="join-date">Joined: ${formatDate(employee.hire_date)}</p>
                </div>
            </div>
        `;
    }

    // Reset the form
    const form = document.getElementById('terminateForm');
    if (form) {
        form.reset();
    }

    // Set default last working date to today
    const lastWorkingDateEl = document.getElementById('lastWorkingDate');
    if (lastWorkingDateEl) {
        lastWorkingDateEl.value = new Date().toISOString().split('T')[0];
    }

    // Set default settlement date to 30 days from today
    const settlementDateEl = document.getElementById('settlementDate');
    if (settlementDateEl) {
        const settlementDate = new Date();
        settlementDate.setDate(settlementDate.getDate() + 30);
        settlementDateEl.value = settlementDate.toISOString().split('T')[0];
    }

    // Uncheck confirmation
    const confirmCheckbox = document.getElementById('confirmTermination');
    if (confirmCheckbox) {
        confirmCheckbox.checked = false;
    }

    // Open the modal
    openModal('terminateModal');
}

/**
 * Validate and submit employee termination
 */
async function confirmTerminateEmployee() {
    if (!terminatingEmployeeId) {
        showToast('No employee selected for termination', 'error');
        return;
    }

    // Validate required fields
    const lastWorkingDate = document.getElementById('lastWorkingDate').value;
    const terminationReason = document.getElementById('terminationReason').value;
    const confirmCheckbox = document.getElementById('confirmTermination');

    if (!lastWorkingDate) {
        showToast('Last working date is required', 'error');
        return;
    }

    if (!terminationReason) {
        showToast('Termination reason is required', 'error');
        return;
    }

    if (!confirmCheckbox || !confirmCheckbox.checked) {
        showToast('Please confirm that you understand this action is irreversible', 'error');
        return;
    }

    // Validate last working date is not in the future (too far)
    const lastWorkDate = new Date(lastWorkingDate);
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

    if (lastWorkDate > threeMonthsFromNow) {
        showToast('Last working date cannot be more than 3 months in the future', 'error');
        return;
    }

    // Get optional fields
    const exitInterviewDate = document.getElementById('exitInterviewDate').value;
    const settlementDate = document.getElementById('settlementDate').value;
    const exitNotes = document.getElementById('exitNotes').value;

    // Prepare termination data
    const terminationData = {
        last_working_date: lastWorkingDate,
        termination_reason: terminationReason,
        exit_interview_date: exitInterviewDate || null,
        settlement_date: settlementDate || null,
        exit_notes: exitNotes || null
    };

    // Disable the terminate button and show loading
    const terminateBtn = document.querySelector('#terminateModal .btn-danger');
    const originalText = terminateBtn.textContent;
    terminateBtn.disabled = true;
    terminateBtn.textContent = 'Processing...';

    try {
        await api.terminateEmployee(terminatingEmployeeId, terminationData);

        showToast('Employee terminated successfully', 'success');
        closeModal('terminateModal');

        // Reset the terminating employee ID
        terminatingEmployeeId = null;

        // Reload employees list
        await loadEmployees();

    } catch (error) {
        console.error('Error terminating employee:', error);
        showToast(error.message || 'Failed to terminate employee', 'error');
    } finally {
        // Re-enable the button
        terminateBtn.disabled = false;
        terminateBtn.textContent = originalText;
    }
}

/**
 * Close the termination modal
 */
function closeTerminationModal() {
    terminatingEmployeeId = null;
    closeModal('terminateModal');
}

// ============================================================================
// COLLAPSIBLE SIDEBAR NAVIGATION
// ============================================================================

function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('organizationSidebar');
    const activeTabName = document.getElementById('activeTabName');
    const container = document.querySelector('.hrms-container');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    // Tab name mapping for display
    const tabNames = {
        'directory': 'Employee Directory',
        'nfcCards': 'NFC Cards'
    };

    // Update active tab title
    function updateActiveTabTitle(tabId) {
        if (activeTabName && tabNames[tabId]) {
            activeTabName.textContent = tabNames[tabId];
        }
    }

    // Open sidebar by default on page load (desktop)
    if (window.innerWidth > 1024) {
        toggle.classList.add('active');
        sidebar.classList.add('open');
        container?.classList.add('sidebar-open');
    }

    // Toggle sidebar open/close
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
    });

    // Close sidebar when clicking overlay (mobile)
    overlay?.addEventListener('click', () => {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
    });

    // Collapsible nav groups
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.nav-group');
            group.classList.toggle('collapsed');
        });
    });

    // Tab switching functionality
    const tabBtns = document.querySelectorAll('.sidebar-btn[data-tab]');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // Update button states
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update tab content visibility
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const tabContent = document.getElementById(tabId);
            if (tabContent) {
                tabContent.classList.add('active');
            }

            // Update title
            updateActiveTabTitle(tabId);

            // Load data for the tab if needed
            if (tabId === 'nfcCards' && !nfcCardsLoaded) {
                loadNfcCardsTable();
            }
        });
    });

    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
        }
    });
}

// ============================================
// Searchable Dropdown Functions (Step 2 Employment)
// ============================================

// Data storage for searchable dropdowns
const searchableDropdownData = {
    office: { items: [], filteredItems: [], selectedId: null, displayedCount: 0 },
    department: { items: [], filteredItems: [], selectedId: null, displayedCount: 0 },
    designation: { items: [], filteredItems: [], selectedId: null, displayedCount: 0 },
    shift: { items: [], filteredItems: [], selectedId: null, displayedCount: 0 },
    manager: { items: [], filteredItems: [], selectedId: null, displayedCount: 0 }
};

const DROPDOWN_BATCH_SIZE = 50;

// Gender dropdown instance (using SearchableDropdown component)
let genderDropdown = null;

/**
 * Initialize gender dropdown using SearchableDropdown component
 */
function initGenderDropdown() {
    // Check if already converted
    const existingContainer = document.getElementById('gender-searchable-container');
    if (existingContainer) {
        // Already converted, just reset
        if (genderDropdown) {
            genderDropdown.setValue(null);
        }
        return;
    }

    // Convert native select to searchable dropdown
    genderDropdown = convertSelectToSearchable('gender', {
        placeholder: 'Select gender...',
        searchPlaceholder: 'Search...',
        compact: true
    });
}

/**
 * Reset gender dropdown to default state
 */
function resetGenderDropdown() {
    if (genderDropdown) {
        genderDropdown.setValue(null);
    } else {
        const select = document.getElementById('gender');
        if (select) select.value = '';
    }
}

/**
 * Set gender dropdown value
 */
function setGenderValue(value) {
    if (genderDropdown) {
        genderDropdown.setValue(value);
    } else {
        const select = document.getElementById('gender');
        if (select) select.value = value || '';
    }
}

// Employment Type dropdown instance (using SearchableDropdown component)
let employmentTypeDropdown = null;

/**
 * Initialize employment type dropdown using SearchableDropdown component
 */
function initEmploymentTypeDropdown() {
    // Check if already converted
    const existingContainer = document.getElementById('employmentType-searchable-container');
    if (existingContainer) {
        // Already converted, just reset
        if (employmentTypeDropdown) {
            employmentTypeDropdown.setValue(null);
        }
        return;
    }

    // Convert native select to searchable dropdown
    employmentTypeDropdown = convertSelectToSearchable('employmentType', {
        placeholder: 'Select employment type...',
        searchPlaceholder: 'Search...',
        compact: true
    });
}

/**
 * Reset employment type dropdown to default state
 */
function resetEmploymentTypeDropdown() {
    if (employmentTypeDropdown) {
        employmentTypeDropdown.setValue(null);
    } else {
        const select = document.getElementById('employmentType');
        if (select) select.value = '';
    }
}

/**
 * Set employment type dropdown value
 */
function setEmploymentTypeValue(value) {
    if (employmentTypeDropdown) {
        employmentTypeDropdown.setValue(value);
    } else {
        const select = document.getElementById('employmentType');
        if (select) select.value = value || '';
    }
}

/**
 * Toggle searchable dropdown open/close
 */
function toggleSearchableDropdown(field) {
    const dropdown = document.getElementById(`${field}Dropdown`);
    const trigger = dropdown.querySelector('.searchable-dropdown-trigger');

    // Don't open if disabled
    if (trigger.classList.contains('disabled')) return;

    // Close all other dropdowns first
    document.querySelectorAll('.searchable-dropdown.open').forEach(d => {
        if (d.id !== `${field}Dropdown`) {
            d.classList.remove('open');
        }
    });

    dropdown.classList.toggle('open');

    if (dropdown.classList.contains('open')) {
        const searchInput = dropdown.querySelector('.searchable-dropdown-search input');
        searchInput?.focus();

        // Setup scroll listener for infinite scroll
        setupDropdownScroll(field);

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeSearchableDropdownOnOutsideClick);
        }, 0);
    } else {
        document.removeEventListener('click', closeSearchableDropdownOnOutsideClick);
    }
}

function closeSearchableDropdownOnOutsideClick(e) {
    const openDropdowns = document.querySelectorAll('.searchable-dropdown.open');
    openDropdowns.forEach(dropdown => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });
    if (document.querySelectorAll('.searchable-dropdown.open').length === 0) {
        document.removeEventListener('click', closeSearchableDropdownOnOutsideClick);
    }
}

/**
 * Filter searchable dropdown items
 */
function filterSearchableDropdown(field, searchTerm) {
    const data = searchableDropdownData[field];
    const dropdown = document.getElementById(`${field}Dropdown`);
    const clearBtn = dropdown.querySelector('.clear-btn');

    clearBtn.style.display = searchTerm ? 'flex' : 'none';

    const term = searchTerm.toLowerCase();

    data.filteredItems = data.items.filter(item => {
        // Search in all relevant fields
        const name = (item.displayName || item.name || '').toLowerCase();
        const code = (item.code || '').toLowerCase();
        const email = (item.email || '').toLowerCase();
        const office = (item.officeName || '').toLowerCase();
        const designation = (item.designationName || '').toLowerCase();

        return name.includes(term) ||
               code.includes(term) ||
               email.includes(term) ||
               office.includes(term) ||
               designation.includes(term);
    });

    data.displayedCount = 0;
    renderDropdownItems(field, false);
}

/**
 * Clear search in dropdown
 */
function clearSearchableDropdown(field) {
    const dropdown = document.getElementById(`${field}Dropdown`);
    const searchInput = dropdown.querySelector('.searchable-dropdown-search input');
    const clearBtn = dropdown.querySelector('.clear-btn');

    searchInput.value = '';
    clearBtn.style.display = 'none';

    const data = searchableDropdownData[field];
    data.filteredItems = [...data.items];
    data.displayedCount = 0;
    renderDropdownItems(field, false);
}

/**
 * Select an item from searchable dropdown
 */
function selectSearchableDropdownItem(field, id, name, extraInfo = '') {
    const data = searchableDropdownData[field];
    const dropdown = document.getElementById(`${field}Dropdown`);
    const hiddenInput = document.getElementById(`${field}Id`);
    const trigger = dropdown.querySelector('.searchable-dropdown-trigger');
    const selectedText = trigger.querySelector('.selected-text');

    // Update selected state
    data.selectedId = id;

    // Update hidden input
    if (hiddenInput) {
        hiddenInput.value = id || '';
    }

    // Update display text
    if (id) {
        selectedText.textContent = extraInfo ? `${name} (${extraInfo})` : name;
        selectedText.classList.remove('placeholder');
    } else {
        // Clearing selection
        const placeholderMap = {
            office: 'Select office...',
            department: 'Select department...',
            designation: 'Select designation...',
            shift: 'Default shift',
            manager: 'None (Select manager...)'
        };
        selectedText.textContent = placeholderMap[field] || 'Select...';
        selectedText.classList.add('placeholder');
    }

    // Update selected state in list
    dropdown.querySelectorAll('.searchable-dropdown-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.id === id);
    });

    // Close dropdown
    dropdown.classList.remove('open');
    document.removeEventListener('click', closeSearchableDropdownOnOutsideClick);

    // Trigger cascade updates
    handleDropdownCascade(field, id);
}

/**
 * Handle cascading dropdown updates
 */
function handleDropdownCascade(field, id) {
    if (field === 'office') {
        // Office changed - update departments and shifts
        updateSearchableDepartmentsForOffice(id);
        updateSearchableShiftsForOffice(id);
        // Reset designation since department will change
        resetSearchableDropdown('designation', 'Select department first...', true);
    } else if (field === 'department') {
        // Department changed - update designations
        updateSearchableDesignationsForDepartment(id);
    }
}

/**
 * Reset a searchable dropdown to disabled/empty state
 */
function resetSearchableDropdown(field, placeholder, disabled = false) {
    const data = searchableDropdownData[field];
    const dropdown = document.getElementById(`${field}Dropdown`);
    const trigger = dropdown.querySelector('.searchable-dropdown-trigger');
    const selectedText = trigger.querySelector('.selected-text');
    const list = dropdown.querySelector('.searchable-dropdown-list');
    const countDisplay = dropdown.querySelector('.item-count');
    const hiddenInput = document.getElementById(`${field}Id`);
    const searchInput = dropdown.querySelector('.searchable-dropdown-search input');

    // Reset data
    data.items = [];
    data.filteredItems = [];
    data.selectedId = null;
    data.displayedCount = 0;

    // Reset hidden input
    if (hiddenInput) hiddenInput.value = '';

    // Reset search
    if (searchInput) searchInput.value = '';

    // Update display
    selectedText.textContent = placeholder;
    selectedText.classList.add('placeholder');

    // Update disabled state
    if (disabled) {
        trigger.classList.add('disabled');
    } else {
        trigger.classList.remove('disabled');
    }

    // Clear list
    list.innerHTML = '';
    countDisplay.textContent = `0 ${field}s`;

    // Close if open
    dropdown.classList.remove('open');
}

/**
 * Populate a searchable dropdown with items
 */
function populateSearchableDropdown(field, items, selectedId = null) {
    const data = searchableDropdownData[field];
    const dropdown = document.getElementById(`${field}Dropdown`);
    const trigger = dropdown.querySelector('.searchable-dropdown-trigger');
    const searchInput = dropdown.querySelector('.searchable-dropdown-search input');

    // Store items
    data.items = items;
    data.filteredItems = [...items];
    data.selectedId = selectedId;
    data.displayedCount = 0;

    // Enable dropdown if there are items
    trigger.classList.remove('disabled');

    // Clear search
    if (searchInput) searchInput.value = '';

    // Render items
    renderDropdownItems(field, false);

    // If there's a selected ID, update the trigger display
    if (selectedId) {
        const selectedItem = items.find(item => item.id === selectedId);
        if (selectedItem) {
            const selectedText = trigger.querySelector('.selected-text');
            selectedText.textContent = selectedItem.displayName || selectedItem.name;
            selectedText.classList.remove('placeholder');
        }
    }
}

/**
 * Render dropdown items (with virtual scrolling support)
 */
function renderDropdownItems(field, append = false) {
    const data = searchableDropdownData[field];
    const dropdown = document.getElementById(`${field}Dropdown`);
    const list = dropdown.querySelector('.searchable-dropdown-list');
    const countDisplay = dropdown.querySelector('.item-count');

    const items = data.filteredItems;
    const totalItems = data.items.length;
    const filteredCount = items.length;

    // Update count display
    const labelMap = {
        office: 'office',
        department: 'department',
        designation: 'designation',
        shift: 'shift',
        manager: 'manager'
    };
    const label = labelMap[field] || field;
    countDisplay.textContent = filteredCount === totalItems
        ? `${totalItems} ${label}${totalItems !== 1 ? 's' : ''}`
        : `${filteredCount} of ${totalItems} ${label}s`;

    if (items.length === 0) {
        list.innerHTML = '<div class="searchable-dropdown-empty">No items found</div>';
        return;
    }

    const startIndex = append ? data.displayedCount : 0;
    const endIndex = Math.min(startIndex + DROPDOWN_BATCH_SIZE, items.length);
    const batch = items.slice(startIndex, endIndex);

    const batchHTML = batch.map(item => {
        const isSelected = data.selectedId === item.id;

        // Build item HTML based on field type
        let itemContent = '';
        if (field === 'manager') {
            // Manager shows: Name, Email, Office, Designation, Level
            itemContent = `
                <div class="dropdown-item-main">
                    <span class="dropdown-item-name">${item.displayName}</span>
                    <span class="dropdown-item-code">${item.code || ''}</span>
                </div>
                <div class="dropdown-item-details">
                    <span class="dropdown-item-email">${item.email || ''}</span>
                    <span class="dropdown-item-meta">${item.officeName || ''} • ${item.designationName || ''} • L${item.level || 0}</span>
                </div>
            `;
        } else if (field === 'designation') {
            // Designation shows level
            itemContent = `
                <div class="dropdown-item-main">
                    <span class="dropdown-item-name">${item.name}</span>
                    ${item.level ? `<span class="dropdown-item-level">Level ${item.level}</span>` : ''}
                </div>
            `;
        } else {
            // Default: just show name and code
            itemContent = `
                <div class="dropdown-item-main">
                    <span class="dropdown-item-name">${item.name}</span>
                    ${item.code ? `<span class="dropdown-item-code">${item.code}</span>` : ''}
                </div>
            `;
        }

        return `
            <div class="searchable-dropdown-item ${isSelected ? 'selected' : ''}"
                 data-id="${item.id}"
                 onclick="selectSearchableDropdownItem('${field}', '${item.id}', '${(item.displayName || item.name).replace(/'/g, "\\'")}', '${(item.code || '').replace(/'/g, "\\'")}')">
                ${itemContent}
            </div>
        `;
    }).join('');

    if (append) {
        const loadingIndicator = list.querySelector('.dropdown-loading-indicator');
        if (loadingIndicator) loadingIndicator.remove();
        list.insertAdjacentHTML('beforeend', batchHTML);
    } else {
        list.innerHTML = batchHTML;
    }

    data.displayedCount = endIndex;

    // Add loading indicator if more items
    if (data.displayedCount < items.length) {
        list.insertAdjacentHTML('beforeend',
            '<div class="dropdown-loading-indicator">Scroll for more...</div>');
    }
}

/**
 * Setup scroll listener for infinite scroll
 */
function setupDropdownScroll(field) {
    const dropdown = document.getElementById(`${field}Dropdown`);
    const list = dropdown.querySelector('.searchable-dropdown-list');
    const data = searchableDropdownData[field];

    list.onscroll = () => {
        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;

        if (scrollTop + clientHeight >= scrollHeight - 50) {
            if (data.displayedCount < data.filteredItems.length) {
                renderDropdownItems(field, true);
            }
        }
    };
}

/**
 * Update departments dropdown when office changes
 */
function updateSearchableDepartmentsForOffice(officeId) {
    if (!officeId) {
        resetSearchableDropdown('department', 'Select office first...', true);
        return;
    }

    // Filter departments by office and ensure they have designations
    const filteredDepts = departments.filter(d => {
        const matchesOffice = !d.office_id || d.office_id === officeId;
        const hasDesignations = designations.some(desig => desig.department_id === d.id);
        return matchesOffice && hasDesignations;
    });

    if (filteredDepts.length === 0) {
        resetSearchableDropdown('department', 'No departments for this office', true);
        return;
    }

    // Format items for dropdown
    const items = filteredDepts.map(d => ({
        id: d.id,
        name: d.department_name,
        code: d.department_code || ''
    }));

    populateSearchableDropdown('department', items);

    // Update trigger placeholder
    const dropdown = document.getElementById('departmentDropdown');
    const selectedText = dropdown.querySelector('.selected-text');
    selectedText.textContent = 'Select department...';
    selectedText.classList.add('placeholder');
}

/**
 * Update shifts dropdown when office changes
 */
function updateSearchableShiftsForOffice(officeId) {
    if (!officeId) {
        resetSearchableDropdown('shift', 'Select office first...', true);
        return;
    }

    // Filter shifts by office (or global shifts without office_id)
    const filteredShifts = shifts.filter(s => !s.office_id || s.office_id === officeId);

    // Format items for dropdown
    const items = filteredShifts.map(s => ({
        id: s.id,
        name: s.shift_name,
        code: `${s.start_time?.substring(0, 5) || ''} - ${s.end_time?.substring(0, 5) || ''}`
    }));

    populateSearchableDropdown('shift', items);

    // Update trigger placeholder for shift (optional field)
    const dropdown = document.getElementById('shiftDropdown');
    const selectedText = dropdown.querySelector('.selected-text');
    selectedText.textContent = 'Default shift';
    selectedText.classList.add('placeholder');
}

/**
 * Update designations dropdown when department changes
 */
function updateSearchableDesignationsForDepartment(departmentId) {
    if (!departmentId) {
        resetSearchableDropdown('designation', 'Select department first...', true);
        return;
    }

    // Filter designations by department
    const filteredDesigs = designations.filter(d => !d.department_id || d.department_id === departmentId);

    if (filteredDesigs.length === 0) {
        resetSearchableDropdown('designation', 'No designations for this department', true);
        return;
    }

    // Format items for dropdown
    const items = filteredDesigs.map(d => ({
        id: d.id,
        name: d.designation_name,
        code: d.designation_code || '',
        level: d.level || 0
    }));

    populateSearchableDropdown('designation', items);

    // Update trigger placeholder
    const dropdown = document.getElementById('designationDropdown');
    const selectedText = dropdown.querySelector('.selected-text');
    selectedText.textContent = 'Select designation...';
    selectedText.classList.add('placeholder');
}

/**
 * Populate managers dropdown
 * Shows: Name, Office, Designation, Level, Email
 * Only includes employees whose designation has manager/admin roles
 */
function populateSearchableManagerDropdown(excludeEmployeeId = null) {
    // Roles that indicate manager capability
    const managerRoles = ['HRMS_MANAGER', 'HRMS_ADMIN', 'HRMS_HR_MANAGER', 'HRMS_HR_ADMIN'];

    // Helper function to check if designation has manager roles
    const hasManagerRole = (designationId) => {
        const desig = designations.find(d => d.id === designationId);
        if (!desig) return false;

        // Check is_manager flag first
        if (desig.is_manager === true) return true;

        // Check default_hrms_roles array for manager roles
        if (Array.isArray(desig.default_hrms_roles)) {
            return desig.default_hrms_roles.some(role => managerRoles.includes(role));
        }
        return false;
    };

    // Filter to only include employees with manager/admin designations
    const managerItems = employees
        .filter(e => e.id !== excludeEmployeeId && hasManagerRole(e.designation_id))
        .map(e => {
            const office = offices.find(o => o.id === e.office_id);
            const desig = designations.find(d => d.id === e.designation_id);

            return {
                id: e.user_id,  // Manager is identified by user_id
                displayName: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
                code: e.employee_code || '',
                email: e.work_email || '',
                officeName: office?.office_name || 'N/A',
                designationName: desig?.designation_name || 'N/A',
                level: desig?.level || 0
            };
        });

    populateSearchableDropdown('manager', managerItems);

    // Reset trigger placeholder
    const dropdown = document.getElementById('managerDropdown');
    const selectedText = dropdown.querySelector('.selected-text');
    selectedText.textContent = 'None (Select manager...)';
    selectedText.classList.add('placeholder');
}

/**
 * Initialize searchable dropdowns for employment step
 */
function initializeEmploymentDropdowns() {
    // Initialize employment type dropdown
    initEmploymentTypeDropdown();

    // Populate offices dropdown
    const officeItems = offices.map(o => ({
        id: o.id,
        name: o.office_name,
        code: o.office_code || ''
    }));
    populateSearchableDropdown('office', officeItems);

    // Reset dependent dropdowns
    resetSearchableDropdown('department', 'Select office first...', true);
    resetSearchableDropdown('designation', 'Select department first...', true);
    resetSearchableDropdown('shift', 'Select office first...', true);

    // Populate managers
    populateSearchableManagerDropdown();
}

/**
 * Set values for edit mode
 */
function setEmploymentDropdownValues(emp) {
    // Set office and trigger cascading
    if (emp.office_id) {
        const office = offices.find(o => o.id === emp.office_id);
        if (office) {
            // Populate and select office
            const officeItems = offices.map(o => ({
                id: o.id,
                name: o.office_name,
                code: o.office_code || ''
            }));
            populateSearchableDropdown('office', officeItems, emp.office_id);

            // Update trigger display
            const officeDropdown = document.getElementById('officeDropdown');
            const officeText = officeDropdown.querySelector('.selected-text');
            officeText.textContent = office.office_name;
            officeText.classList.remove('placeholder');
            document.getElementById('officeId').value = emp.office_id;
            searchableDropdownData.office.selectedId = emp.office_id;
        }

        // Update departments for office
        updateSearchableDepartmentsForOffice(emp.office_id);

        // Set department if exists
        if (emp.department_id) {
            const dept = departments.find(d => d.id === emp.department_id);
            if (dept) {
                const deptDropdown = document.getElementById('departmentDropdown');
                const deptText = deptDropdown.querySelector('.selected-text');
                deptText.textContent = dept.department_name;
                deptText.classList.remove('placeholder');
                document.getElementById('departmentId').value = emp.department_id;
                searchableDropdownData.department.selectedId = emp.department_id;
            }

            // Update designations for department
            updateSearchableDesignationsForDepartment(emp.department_id);

            // Set designation if exists
            if (emp.designation_id) {
                const desig = designations.find(d => d.id === emp.designation_id);
                if (desig) {
                    const desigDropdown = document.getElementById('designationDropdown');
                    const desigText = desigDropdown.querySelector('.selected-text');
                    desigText.textContent = desig.designation_name;
                    desigText.classList.remove('placeholder');
                    document.getElementById('designationId').value = emp.designation_id;
                    searchableDropdownData.designation.selectedId = emp.designation_id;
                }
            }
        }

        // Update shifts for office
        updateSearchableShiftsForOffice(emp.office_id);

        // Set shift if exists
        if (emp.shift_id) {
            const shift = shifts.find(s => s.id === emp.shift_id);
            if (shift) {
                const shiftDropdown = document.getElementById('shiftDropdown');
                const shiftText = shiftDropdown.querySelector('.selected-text');
                shiftText.textContent = shift.shift_name;
                shiftText.classList.remove('placeholder');
                document.getElementById('shiftId').value = emp.shift_id;
                searchableDropdownData.shift.selectedId = emp.shift_id;
            }
        }
    }

    // Populate and set manager
    populateSearchableManagerDropdown(emp.id);
    if (emp.manager_user_id) {
        const manager = employees.find(e => e.user_id === emp.manager_user_id);
        if (manager) {
            const managerDropdown = document.getElementById('managerDropdown');
            const managerText = managerDropdown.querySelector('.selected-text');
            managerText.textContent = `${manager.first_name} ${manager.last_name} (${manager.employee_code})`;
            managerText.classList.remove('placeholder');
            document.getElementById('managerId').value = emp.manager_user_id;
            searchableDropdownData.manager.selectedId = emp.manager_user_id;
        }
    }
}

// ============================================
// SignalR Real-Time Event Handlers
// ============================================

/**
 * Called when an employee is updated (from hrms-signalr.js)
 */
function onEmployeeUpdated(data) {
    console.log('[Employees] Employee updated:', data);
    // Don't show toast here - the updater already sees a toast from saveEmployee()
    // This handler is for refreshing data when other users update employees
    loadEmployees();
}

/**
 * Called when a new employee is created (from hrms-signalr.js)
 */
function onEmployeeCreated(data) {
    console.log('[Employees] Employee created:', data);
    // Don't show toast here - the creator already sees a toast from saveEmployee()
    // This handler is for refreshing data when other users create employees
    loadEmployees();
}

// ============================================
// NFC Card Management Functions (v3.0.62)
// ============================================

let allNfcCards = []; // Cache of all NFC cards for the table
let nfcCardsLoaded = false; // Track if NFC cards have been loaded
let viewingEmployeeCards = null; // Employee being viewed in modal

/**
 * Load all NFC cards for the table
 */
async function loadNfcCardsTable() {
    try {
        const cards = await api.getAllNfcCards(true); // Include inactive
        allNfcCards = cards || [];
        nfcCardsLoaded = true;

        // Populate office filter for NFC tab
        populateNfcOfficeFilter();

        // Show issue button for HR Admin
        hrmsRoles.setElementVisibility('issueNfcCardBtn', hrmsRoles.canCreateEmployee());

        renderNfcCardsTable();
    } catch (error) {
        console.error('Error loading NFC cards:', error);
        allNfcCards = [];
        renderNfcCardsTable();
    }
}

/**
 * Populate office filter dropdown for NFC Cards tab
 */
function populateNfcOfficeFilter() {
    const select = document.getElementById('nfcOfficeFilter');
    if (!select) return;

    select.innerHTML = '<option value="">All Offices</option>';
    offices.forEach(office => {
        const option = document.createElement('option');
        option.value = office.id;
        option.textContent = office.office_name;
        select.appendChild(option);
    });
}

/**
 * Filter NFC cards based on search and filters
 */
function filterNfcCards() {
    renderNfcCardsTable();
}

/**
 * Get filtered NFC cards based on current filter values
 */
function getFilteredNfcCards() {
    const searchTerm = document.getElementById('nfcSearchInput')?.value?.toLowerCase() || '';
    const statusFilter = document.getElementById('nfcStatusFilter')?.value || '';
    const officeFilter = document.getElementById('nfcOfficeFilter')?.value || '';

    return allNfcCards.filter(card => {
        // Search filter
        if (searchTerm) {
            const employeeName = `${card.employee_first_name || ''} ${card.employee_last_name || ''}`.toLowerCase();
            const employeeCode = (card.employee_code || '').toLowerCase();
            const cardUid = (card.card_uid || '').toLowerCase();
            const cardLabel = (card.card_label || '').toLowerCase();

            if (!employeeName.includes(searchTerm) &&
                !employeeCode.includes(searchTerm) &&
                !cardUid.includes(searchTerm) &&
                !cardLabel.includes(searchTerm)) {
                return false;
            }
        }

        // Status filter
        if (statusFilter === 'active' && !card.is_active) return false;
        if (statusFilter === 'inactive' && card.is_active) return false;

        // Office filter
        if (officeFilter && card.employee_office_id !== officeFilter) return false;

        return true;
    });
}

/**
 * Render the NFC cards table
 */
function renderNfcCardsTable() {
    const tbody = document.getElementById('nfcCardsTableBody');
    if (!tbody) return;

    const filteredCards = getFilteredNfcCards();

    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        nfcCardsPagination = createTablePagination('nfcCardsPagination', {
            containerSelector: '#nfcCardsPagination',
            data: filteredCards,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderNfcCardsRows(paginatedData);
            }
        });
    } else {
        renderNfcCardsRows(filteredCards);
    }
}

function renderNfcCardsRows(filteredCards) {
    const tbody = document.getElementById('nfcCardsTableBody');
    if (!tbody) return;

    if (!filteredCards || filteredCards.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="7">
                    <div class="empty-state">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <rect x="2" y="5" width="20" height="14" rx="2"/>
                            <line x1="2" y1="10" x2="22" y2="10"/>
                        </svg>
                        <p>No NFC cards found</p>
                        <small>Issue NFC cards to employees for attendance kiosks</small>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredCards.map(card => {
        const statusClass = card.is_active ? 'active' : 'inactive';
        const statusText = card.is_active ? 'Active' : 'Inactive';
        const employeeName = `${card.employee_first_name || ''} ${card.employee_last_name || ''}`.trim() || '-';
        const dept = departments.find(d => d.id === card.employee_department_id);

        return `
            <tr data-card-id="${card.id}">
                <td>
                    <div class="employee-cell">
                        <div class="employee-avatar-sm">${getInitials(card.employee_first_name, card.employee_last_name)}</div>
                        <div class="employee-info-cell">
                            <span class="employee-name">${escapeHtml(employeeName)}</span>
                            <span class="employee-code">${escapeHtml(card.employee_code || '-')}</span>
                        </div>
                    </div>
                </td>
                <td><code class="card-uid">${formatCardUid(card.card_uid)}</code></td>
                <td>${escapeHtml(card.card_label || '-')}</td>
                <td><span class="badge badge-${statusClass}">${statusText}</span></td>
                <td>${card.is_primary ? '<span class="badge badge-primary">Primary</span>' : '-'}</td>
                <td>${formatDate(card.issued_at)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-outline" onclick="openViewEmployeeCardsModal('${card.employee_id}')" title="View all cards">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                        ${card.is_active && !card.is_primary ? `
                            <button class="btn btn-sm btn-outline-primary" onclick="setNfcCardPrimaryFromTable('${card.id}')" title="Set as primary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                </svg>
                            </button>
                        ` : ''}
                        ${card.is_active ? `
                            <button class="btn btn-sm btn-outline-warning" onclick="openDeactivateCardModal('${card.id}')" title="Deactivate">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                                </svg>
                            </button>
                        ` : `
                            <button class="btn btn-sm btn-outline-success" onclick="reactivateNfcCardFromTable('${card.id}')" title="Reactivate">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="23 4 23 10 17 10"/>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                </svg>
                            </button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Format card UID for display (add colons every 2 chars)
 */
function formatCardUid(uid) {
    if (!uid) return '-';
    return uid.match(/.{1,2}/g)?.join(':') || uid;
}

/**
 * Get employee initials for avatar
 */
function getInitials(firstName, lastName) {
    const first = (firstName || '').charAt(0).toUpperCase();
    const last = (lastName || '').charAt(0).toUpperCase();
    return first + last || '?';
}

// ============================================
// Issue NFC Card Modal Functions
// ============================================

/**
 * Open the issue NFC card modal
 */
function openIssueNfcCardModal() {
    document.getElementById('nfcCardModalTitle').textContent = 'Issue NFC Card';
    document.getElementById('issueNfcCardForm').reset();
    document.getElementById('nfcCardId').value = '';
    document.getElementById('nfcSelectedEmployeeCard').style.display = 'none';

    // Populate employee dropdown
    populateNfcEmployeeSelect();

    openModal('issueNfcCardModal');
}

/**
 * Populate employee select dropdown for issue card modal
 */
function populateNfcEmployeeSelect() {
    const select = document.getElementById('nfcEmployeeSelect');
    if (!select) return;

    select.innerHTML = '<option value="">Select employee...</option>';

    // Only show active employees
    const activeEmployees = employees.filter(e => e.employment_status === 'active');

    activeEmployees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.first_name} ${emp.last_name} (${emp.employee_code})`;
        select.appendChild(option);
    });

    // Add change handler
    select.onchange = onNfcEmployeeSelect;
}

/**
 * Handle employee selection in issue card modal
 */
async function onNfcEmployeeSelect() {
    const select = document.getElementById('nfcEmployeeSelect');
    const employeeId = select.value;
    const cardEl = document.getElementById('nfcSelectedEmployeeCard');

    if (!employeeId) {
        cardEl.style.display = 'none';
        return;
    }

    const emp = employees.find(e => e.id === employeeId);
    if (!emp) {
        cardEl.style.display = 'none';
        return;
    }

    // Show employee card
    document.getElementById('nfcEmployeeAvatar').textContent = getInitials(emp.first_name, emp.last_name);
    document.getElementById('nfcEmployeeName').textContent = `${emp.first_name} ${emp.last_name}`;
    document.getElementById('nfcEmployeeCode').textContent = emp.employee_code;

    const dept = departments.find(d => d.id === emp.department_id);
    const desig = designations.find(d => d.id === emp.designation_id);
    document.getElementById('nfcEmployeeDept').textContent = dept?.department_name || '-';
    document.getElementById('nfcEmployeeDesig').textContent = desig?.designation_name || '-';

    // Load existing cards for this employee
    try {
        const existingCards = await api.getNfcCardsByEmployee(employeeId);
        const infoEl = document.getElementById('nfcExistingCardsInfo');

        if (existingCards && existingCards.length > 0) {
            const activeCount = existingCards.filter(c => c.is_active).length;
            infoEl.innerHTML = `<span class="existing-cards-badge">${activeCount} active card(s)</span>`;
        } else {
            infoEl.innerHTML = '<span class="no-cards-badge">No cards assigned</span>';
        }
    } catch (error) {
        console.error('Error loading existing cards:', error);
    }

    cardEl.style.display = 'flex';
}

/**
 * Submit new NFC card issue
 */
async function submitIssueNfcCard() {
    const employeeId = document.getElementById('nfcEmployeeSelect').value;
    if (!employeeId) {
        showToast('Please select an employee', 'error');
        return;
    }

    const cardUid = document.getElementById('nfcNewCardUid').value.trim().toUpperCase().replace(/[^A-F0-9]/g, '');
    const cardLabel = document.getElementById('nfcNewCardLabel').value.trim();
    const isPrimary = document.getElementById('nfcNewCardPrimary').checked;

    if (!cardUid) {
        showToast('Card UID is required', 'error');
        return;
    }

    if (cardUid.length < 8) {
        showToast('Card UID must be at least 8 hex characters', 'error');
        return;
    }

    try {
        await api.issueNfcCard({
            employee_id: employeeId,
            card_uid: cardUid,
            card_label: cardLabel || null,
            is_primary: isPrimary
        });

        showToast('NFC card issued successfully', 'success');
        closeModal('issueNfcCardModal');

        // Reload table
        await loadNfcCardsTable();
    } catch (error) {
        console.error('Error issuing NFC card:', error);
        showToast(error.message || 'Failed to issue NFC card', 'error');
    }
}

// ============================================
// View Employee Cards Modal Functions
// ============================================

/**
 * Open modal to view/manage all cards for an employee
 */
async function openViewEmployeeCardsModal(employeeId) {
    viewingEmployeeCards = employeeId;

    const emp = employees.find(e => e.id === employeeId);
    if (!emp) {
        showToast('Employee not found', 'error');
        return;
    }

    // Update employee info
    document.getElementById('viewCardsEmployeeAvatar').textContent = getInitials(emp.first_name, emp.last_name);
    document.getElementById('viewCardsEmployeeName').textContent = `${emp.first_name} ${emp.last_name}`;
    document.getElementById('viewCardsEmployeeCode').textContent = emp.employee_code;

    const dept = departments.find(d => d.id === emp.department_id);
    const desig = designations.find(d => d.id === emp.designation_id);
    document.getElementById('viewCardsEmployeeDept').textContent = dept?.department_name || '-';
    document.getElementById('viewCardsEmployeeDesig').textContent = desig?.designation_name || '-';

    // Show/hide issue section based on permissions
    const issueSection = document.getElementById('viewCardsIssueSection');
    if (issueSection) {
        issueSection.style.display = hrmsRoles.canCreateEmployee() ? 'block' : 'none';
    }

    // Load and render cards
    await loadViewEmployeeCards();

    openModal('viewEmployeeCardsModal');
}

/**
 * Load cards for the view modal
 */
async function loadViewEmployeeCards() {
    if (!viewingEmployeeCards) return;

    const listEl = document.getElementById('viewCardsCardsList');
    if (!listEl) return;

    try {
        const cards = await api.getNfcCardsByEmployee(viewingEmployeeCards);

        if (!cards || cards.length === 0) {
            listEl.innerHTML = `
                <div class="nfc-cards-empty-modal">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="5" width="20" height="14" rx="2"/>
                        <line x1="2" y1="10" x2="22" y2="10"/>
                    </svg>
                    <p>No NFC cards assigned</p>
                </div>
            `;
            return;
        }

        listEl.innerHTML = cards.map(card => {
            const statusClass = card.is_active ? 'active' : 'inactive';
            const statusText = card.is_active ? 'Active' : 'Inactive';

            return `
                <div class="nfc-card-item-modal ${card.is_active ? '' : 'inactive'}">
                    <div class="nfc-card-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="5" width="20" height="14" rx="2"/>
                            <line x1="2" y1="10" x2="22" y2="10"/>
                        </svg>
                    </div>
                    <div class="nfc-card-info-modal">
                        <code class="card-uid">${formatCardUid(card.card_uid)}</code>
                        <span class="card-label">${escapeHtml(card.card_label || 'No label')}</span>
                        <div class="card-badges">
                            <span class="badge badge-${statusClass}">${statusText}</span>
                            ${card.is_primary ? '<span class="badge badge-primary">Primary</span>' : ''}
                        </div>
                    </div>
                    <div class="nfc-card-actions-modal">
                        ${card.is_active && !card.is_primary ? `
                            <button class="btn btn-sm btn-outline-primary" onclick="setNfcCardPrimaryFromModal('${card.id}')" title="Set as primary">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                </svg>
                            </button>
                        ` : ''}
                        ${card.is_active ? `
                            <button class="btn btn-sm btn-outline-warning" onclick="deactivateCardFromModal('${card.id}')" title="Deactivate">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                                </svg>
                            </button>
                        ` : `
                            <button class="btn btn-sm btn-outline-success" onclick="reactivateCardFromModal('${card.id}')" title="Reactivate">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="23 4 23 10 17 10"/>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                </svg>
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading employee cards:', error);
        listEl.innerHTML = '<p class="error-text">Failed to load cards</p>';
    }
}

/**
 * Issue card from view modal
 */
async function issueCardFromViewModal() {
    if (!viewingEmployeeCards) return;

    const cardUid = document.getElementById('viewCardsNewUid').value.trim().toUpperCase().replace(/[^A-F0-9]/g, '');
    const cardLabel = document.getElementById('viewCardsNewLabel').value.trim();
    const isPrimary = document.getElementById('viewCardsNewPrimary').checked;

    if (!cardUid) {
        showToast('Card UID is required', 'error');
        return;
    }

    if (cardUid.length < 8) {
        showToast('Card UID must be at least 8 hex characters', 'error');
        return;
    }

    try {
        await api.issueNfcCard({
            employee_id: viewingEmployeeCards,
            card_uid: cardUid,
            card_label: cardLabel || null,
            is_primary: isPrimary
        });

        showToast('NFC card issued successfully', 'success');

        // Clear form
        document.getElementById('viewCardsNewUid').value = '';
        document.getElementById('viewCardsNewLabel').value = '';
        document.getElementById('viewCardsNewPrimary').checked = false;

        // Reload cards in modal and table
        await loadViewEmployeeCards();
        await loadNfcCardsTable();
    } catch (error) {
        console.error('Error issuing NFC card:', error);
        showToast(error.message || 'Failed to issue NFC card', 'error');
    }
}

// ============================================
// NFC Card Action Functions
// ============================================

/**
 * Set card as primary (from table)
 */
async function setNfcCardPrimaryFromTable(cardId) {
    try {
        await api.setNfcCardAsPrimary(cardId);
        showToast('Card set as primary', 'success');
        await loadNfcCardsTable();
    } catch (error) {
        console.error('Error setting primary card:', error);
        showToast(error.message || 'Failed to set primary card', 'error');
    }
}

/**
 * Set card as primary (from modal)
 */
async function setNfcCardPrimaryFromModal(cardId) {
    try {
        await api.setNfcCardAsPrimary(cardId);
        showToast('Card set as primary', 'success');
        await loadViewEmployeeCards();
        await loadNfcCardsTable();
    } catch (error) {
        console.error('Error setting primary card:', error);
        showToast(error.message || 'Failed to set primary card', 'error');
    }
}

/**
 * Open deactivate card modal
 */
function openDeactivateCardModal(cardId) {
    document.getElementById('deactivateCardId').value = cardId;
    document.getElementById('deactivateCardReason').value = '';
    openModal('deactivateCardModal');
}

/**
 * Confirm card deactivation
 */
async function confirmDeactivateCard() {
    const cardId = document.getElementById('deactivateCardId').value;
    const reason = document.getElementById('deactivateCardReason').value.trim();

    if (!cardId) return;

    // Default reason if not provided
    const deactivationReason = reason || 'returned';

    try {
        await api.deactivateNfcCard(cardId, deactivationReason);
        showToast('NFC card deactivated', 'success');
        closeModal('deactivateCardModal');
        await loadNfcCardsTable();
    } catch (error) {
        console.error('Error deactivating NFC card:', error);
        showToast(error.message || 'Failed to deactivate card', 'error');
    }
}

/**
 * Deactivate card from view modal (quick action)
 */
async function deactivateCardFromModal(cardId) {
    const confirmed = await Confirm.show({
        title: 'Deactivate Card',
        message: 'Are you sure you want to deactivate this card?',
        type: 'warning',
        confirmText: 'Deactivate'
    });
    if (!confirmed) return;

    try {
        await api.deactivateNfcCard(cardId, 'returned');
        showToast('NFC card deactivated', 'success');
        await loadViewEmployeeCards();
        await loadNfcCardsTable();
    } catch (error) {
        console.error('Error deactivating NFC card:', error);
        showToast(error.message || 'Failed to deactivate card', 'error');
    }
}

/**
 * Reactivate card (from table)
 */
async function reactivateNfcCardFromTable(cardId) {
    const confirmed = await Confirm.show({
        title: 'Reactivate Card',
        message: 'Are you sure you want to reactivate this card?',
        type: 'info',
        confirmText: 'Reactivate'
    });
    if (!confirmed) return;

    try {
        await api.reactivateNfcCard(cardId);
        showToast('NFC card reactivated', 'success');
        await loadNfcCardsTable();
    } catch (error) {
        console.error('Error reactivating NFC card:', error);
        showToast(error.message || 'Failed to reactivate card', 'error');
    }
}

/**
 * Reactivate card (from modal)
 */
async function reactivateCardFromModal(cardId) {
    const confirmed = await Confirm.show({
        title: 'Reactivate Card',
        message: 'Are you sure you want to reactivate this card?',
        type: 'info',
        confirmText: 'Reactivate'
    });
    if (!confirmed) return;

    try {
        await api.reactivateNfcCard(cardId);
        showToast('NFC card reactivated', 'success');
        await loadViewEmployeeCards();
        await loadNfcCardsTable();
    } catch (error) {
        console.error('Error reactivating NFC card:', error);
        showToast(error.message || 'Failed to reactivate card', 'error');
    }
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
}
