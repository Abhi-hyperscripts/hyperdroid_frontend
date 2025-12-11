let employees = [];
let departments = [];
let designations = [];
let offices = [];
let shifts = [];
let availableUsers = [];
let filteredUsers = [];
let selectedUserId = null;
let currentViewEmployee = null;
let userRole = 'HRMS_USER';
const USER_BATCH_SIZE = 50;
let displayedUserCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('hrms', '../');

    // Determine user role
    const user = api.getUser();
    if (user && user.roles) {
        if (user.roles.includes('SUPERADMIN') || user.roles.includes('HRMS_ADMIN')) {
            userRole = 'HRMS_ADMIN';
            document.getElementById('createEmployeeBtn').style.display = 'flex';
        } else if (user.roles.includes('HRMS_MANAGER')) {
            userRole = 'HRMS_MANAGER';
        }
    }

    await loadFormData();
    await loadEmployees();
});

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

        // Populate filter dropdowns (all items)
        populateSelect('departmentFilter', departments, 'department_name', true);
        populateSelect('officeFilter', offices, 'office_name', true);

        // Only populate Office dropdown in the form - others are cascading
        populateSelect('officeId', offices, 'office_name');

        // Set initial state for cascading dropdowns
        document.getElementById('departmentId').innerHTML = '<option value="">Select office first...</option>';
        document.getElementById('designationId').innerHTML = '<option value="">Select department first...</option>';
        document.getElementById('shiftId').innerHTML = '<option value="">Select office first...</option>';

    } catch (error) {
        console.error('Error loading form data:', error);
    }
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
    tbody.innerHTML = '<tr><td colspan="7"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        employees = await api.getHrmsEmployees(false);

        updateStats();
        renderEmployees();

    } catch (error) {
        console.error('Error loading employees:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Error loading employees</p></td></tr>';
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
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const deptFilter = document.getElementById('departmentFilter').value;
    const officeFilter = document.getElementById('officeFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;

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

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No employees found</p></td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(emp => {
        const dept = departments.find(d => d.id === emp.department_id);
        const desig = designations.find(d => d.id === emp.designation_id);
        const office = offices.find(o => o.id === emp.office_id);

        return `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-avatar">${getInitials(emp.first_name, emp.last_name)}</div>
                        <div>
                            <div class="employee-name">${emp.first_name} ${emp.last_name}</div>
                            <div class="employee-code">${emp.employee_code}</div>
                        </div>
                    </div>
                </td>
                <td>${dept?.department_name || '-'}</td>
                <td>${desig?.designation_name || '-'}</td>
                <td>${office?.office_name || '-'}</td>
                <td>${formatDate(emp.hire_date)}</td>
                <td>${formatCurrency(emp.current_ctc || 0)}</td>
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
                        ${userRole === 'HRMS_ADMIN' ? `
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
                            <button class="action-btn" onclick="openSalaryModal('${emp.id}')" data-tooltip="Salary">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="12" y1="1" x2="12" y2="23"></line>
                                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                </svg>
                            </button>
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

    // Hide user info display until user is selected
    document.getElementById('userInfoDisplay').style.display = 'none';

    // Reset all cascading dropdowns
    document.getElementById('departmentId').innerHTML = '<option value="">Select office first...</option>';
    document.getElementById('designationId').innerHTML = '<option value="">Select department first...</option>';
    document.getElementById('shiftId').innerHTML = '<option value="">Select office first...</option>';

    // Reset user selection
    selectedUserId = null;
    document.getElementById('userSelect').value = '';
    resetUserDropdown();

    // Reset documents and banking
    resetDocumentsAndBanking();

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
            '<p style="text-align: center; color: #dc3545; padding: 20px;">Failed to load users</p>';
    }

    // Load managers
    const managerSelect = document.getElementById('reportingManagerId');
    managerSelect.innerHTML = '<option value="">None</option>' +
        employees.map(e => `<option value="${e.user_id}">${e.first_name} ${e.last_name}</option>`).join('');

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
        list.innerHTML = '<p style="text-align: center; color: #999; font-size: 0.75rem; padding: 20px;">No users found</p>';
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
            '<div id="user-loading-indicator" style="text-align: center; padding: 12px; color: #999; font-size: 0.75rem;">Scroll for more...</div>');
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
    document.getElementById('dateOfBirth').value = emp.date_of_birth?.split('T')[0] || '';
    document.getElementById('gender').value = emp.gender || '';
    document.getElementById('employmentType').value = emp.employment_type || 'full_time';
    document.getElementById('dateOfJoining').value = emp.hire_date?.split('T')[0] || '';
    document.getElementById('probationEndDate').value = emp.probation_end_date?.split('T')[0] || '';

    // Set Office and trigger cascading dropdown updates
    document.getElementById('officeId').value = emp.office_id || '';

    // Update departments and shifts for the selected office
    if (emp.office_id) {
        updateDepartmentsForOffice(emp.office_id);
        updateShiftsForOffice(emp.office_id);
    }

    // Set Department and trigger designation cascade
    document.getElementById('departmentId').value = emp.department_id || '';
    if (emp.department_id) {
        updateDesignationsForDepartment(emp.department_id);
    }

    // Now set the dependent dropdown values
    document.getElementById('designationId').value = emp.designation_id || '';
    document.getElementById('shiftId').value = emp.shift_id || '';

    // Load managers
    const managerSelect = document.getElementById('reportingManagerId');
    managerSelect.innerHTML = '<option value="">None</option>' +
        employees.filter(e => e.id !== id).map(e => `<option value="${e.user_id}">${e.first_name} ${e.last_name}</option>`).join('');
    managerSelect.value = emp.reporting_manager_id || '';

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

    // Validate bank details
    if (!validateBankDetails()) {
        return;
    }

    // Note: first_name, last_name, and work_email are NOT sent to the backend
    // These fields are managed by the Auth service and sourced from there
    const data = {
        employee_code: document.getElementById('employeeCode').value,
        work_phone: document.getElementById('workPhone').value || null,
        date_of_birth: document.getElementById('dateOfBirth').value || null,
        gender: document.getElementById('gender').value || null,
        department_id: document.getElementById('departmentId').value,
        designation_id: document.getElementById('designationId').value,
        office_id: document.getElementById('officeId').value,
        shift_id: document.getElementById('shiftId').value || null,
        reporting_manager_id: document.getElementById('reportingManagerId').value || null,
        employment_type: document.getElementById('employmentType').value,
        hire_date: document.getElementById('dateOfJoining').value,
        probation_end_date: document.getElementById('probationEndDate').value || null
    };

    if (!isEdit) {
        data.user_id = document.getElementById('userSelect').value;
        if (!data.user_id) {
            showToast('Please select a user account', 'error');
            return;
        }
    }

    try {
        let employeeId = id;

        if (isEdit) {
            await api.updateHrmsEmployee(id, data);
        } else {
            const result = await api.createHrmsEmployee(data);
            employeeId = result.id || result.employee_id || result;
        }

        // Save bank account
        try {
            await saveBankAccount(employeeId);
        } catch (bankError) {
            console.error('Error saving bank account:', bankError);
            showToast('Employee saved but bank account failed: ' + bankError.message, 'error');
        }

        // Upload pending documents
        const docTypes = ['pan', 'aadhar', 'passport', 'photo'];
        for (const docType of docTypes) {
            if (pendingDocuments[docType]) {
                try {
                    // Delete existing document if replacing
                    if (existingDocuments[docType] && !existingDocuments[docType].markedForDeletion) {
                        await api.deleteEmployeeDocument(employeeId, existingDocuments[docType].id);
                    }
                    await uploadDocument(employeeId, docType, pendingDocuments[docType]);
                } catch (docError) {
                    console.error(`Error uploading ${docType}:`, docError);
                    showToast(`Failed to upload ${docType}: ${docError.message}`, 'error');
                }
            }
        }

        // Delete documents marked for deletion
        for (const [docType, doc] of Object.entries(existingDocuments)) {
            if (doc && doc.markedForDeletion) {
                try {
                    await api.deleteEmployeeDocument(employeeId, doc.id);
                } catch (delError) {
                    console.error(`Error deleting ${docType}:`, delError);
                }
            }
        }

        showToast(isEdit ? 'Employee updated successfully' : 'Employee created successfully', 'success');
        closeModal('employeeModal');
        await loadEmployees();

    } catch (error) {
        showToast(error.message || 'Error saving employee', 'error');
    }
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

        content.innerHTML = `
            <div class="employee-view-header">
                <div class="employee-avatar-large">${getInitials(emp.first_name, emp.last_name)}</div>
                <div>
                    <h2>${emp.first_name} ${emp.last_name}</h2>
                    <p>${emp.employee_code} | ${desig?.designation_name || '-'}</p>
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

        document.getElementById('editFromViewBtn').style.display = userRole === 'HRMS_ADMIN' ? 'block' : 'none';

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
    const filteredDepts = departments.filter(d => !d.office_id || d.office_id === officeId);

    if (filteredDepts.length === 0) {
        deptSelect.innerHTML = '<option value="">No departments for this office</option>';
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

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${type === 'success' ? '<polyline points="20 6 9 17 4 12"/>' : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
        </svg>
        ${message}
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Document Upload Functions
// ============================================

// Store pending uploads (files selected but not yet uploaded)
let pendingDocuments = {
    pan: null,
    aadhar: null,
    passport: null,
    photo: null
};

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

    // Show preview
    const previewEl = document.getElementById(`${docType}-preview`);
    const uploadArea = document.getElementById(`${docType}-upload`);

    if (previewEl && uploadArea) {
        previewEl.querySelector('.file-name').textContent = file.name;
        previewEl.style.display = 'flex';
        uploadArea.style.display = 'none';
    }

    // Update status
    const statusEl = document.getElementById(`${docType}-status`);
    if (statusEl) {
        statusEl.textContent = 'Pending upload';
        statusEl.className = 'doc-status pending';
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
        const removeBtn = document.getElementById('removePhotoBtn');

        photoImage.src = e.target.result;
        photoImage.style.display = 'block';
        photoPlaceholder.style.display = 'none';
        removeBtn.style.display = 'inline-flex';
    };
    reader.readAsDataURL(file);
}

function removeDocument(docType) {
    pendingDocuments[docType] = null;

    const input = document.getElementById(`${docType}-file`);
    if (input) input.value = '';

    const previewEl = document.getElementById(`${docType}-preview`);
    const uploadArea = document.getElementById(`${docType}-upload`);

    if (previewEl && uploadArea) {
        previewEl.style.display = 'none';
        uploadArea.style.display = 'flex';
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
    const removeBtn = document.getElementById('removePhotoBtn');

    photoImage.src = '';
    photoImage.style.display = 'none';
    photoPlaceholder.style.display = 'flex';
    removeBtn.style.display = 'none';

    // Clear doc ID
    document.getElementById('photo-doc-id').value = '';

    // Mark for deletion if it was an existing document
    if (existingDocuments.photo) {
        existingDocuments.photo.markedForDeletion = true;
    }
}

async function uploadDocument(employeeId, docType, file) {
    const docTypeMap = {
        'pan': 'pan_card',
        'aadhar': 'aadhar_card',
        'passport': 'passport',
        'photo': 'employee_photo'
    };

    const docNumber = document.getElementById(`${docType}-number`)?.value || null;
    const expiryDate = document.getElementById(`${docType}-expiry`)?.value || null;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('document_type', docTypeMap[docType]);
    formData.append('document_name', `${docType.charAt(0).toUpperCase() + docType.slice(1)} - ${file.name}`);
    if (docNumber) formData.append('document_number', docNumber);
    if (expiryDate) formData.append('expiry_date', expiryDate);

    return await api.uploadEmployeeDocument(employeeId, formData);
}

async function loadEmployeeDocuments(employeeId) {
    try {
        const documents = await api.getEmployeeDocuments(employeeId);
        existingDocuments = {};

        for (const doc of documents) {
            const docTypeMap = {
                'pan_card': 'pan',
                'aadhar_card': 'aadhar',
                'passport': 'passport',
                'employee_photo': 'photo'
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
                        const removeBtn = document.getElementById('removePhotoBtn');

                        photoImage.src = downloadUrl.url || downloadUrl;
                        photoImage.style.display = 'block';
                        photoPlaceholder.style.display = 'none';
                        removeBtn.style.display = 'inline-flex';
                    } catch (e) {
                        console.error('Error loading photo:', e);
                    }
                }
                document.getElementById('photo-doc-id').value = doc.id;
            } else {
                // Show as uploaded
                const previewEl = document.getElementById(`${docType}-preview`);
                const uploadArea = document.getElementById(`${docType}-upload`);
                const statusEl = document.getElementById(`${docType}-status`);

                if (previewEl && uploadArea) {
                    previewEl.querySelector('.file-name').textContent = doc.file_name || 'Uploaded';
                    previewEl.style.display = 'flex';
                    uploadArea.style.display = 'none';
                }

                if (statusEl) {
                    statusEl.textContent = doc.verification_status === 'verified' ? 'Verified' : 'Uploaded';
                    statusEl.className = `doc-status ${doc.verification_status === 'verified' ? 'verified' : 'uploaded'}`;
                }

                // Set document number if available
                const docNumberEl = document.getElementById(`${docType}-number`);
                if (docNumberEl && doc.document_number) {
                    docNumberEl.value = doc.document_number;
                }

                // Set expiry date if available
                const expiryEl = document.getElementById(`${docType}-expiry`);
                if (expiryEl && doc.expiry_date) {
                    expiryEl.value = doc.expiry_date.split('T')[0];
                }

                document.getElementById(`${docType}-doc-id`).value = doc.id;
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

    if (ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode.toUpperCase())) {
        showToast('Invalid IFSC code format', 'error');
        return false;
    }

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
    pendingDocuments = { pan: null, aadhar: null, passport: null, photo: null };
    existingDocuments = {};

    // Reset file inputs
    ['pan', 'aadhar', 'passport', 'photo'].forEach(docType => {
        const input = document.getElementById(`${docType}-file`);
        if (input) input.value = '';

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

        const numberEl = document.getElementById(`${docType}-number`);
        if (numberEl) numberEl.value = '';

        const expiryEl = document.getElementById(`${docType}-expiry`);
        if (expiryEl) expiryEl.value = '';
    });

    // Reset photo
    const photoImage = document.getElementById('photoImage');
    const photoPlaceholder = document.getElementById('photoPlaceholder');
    const removeBtn = document.getElementById('removePhotoBtn');
    if (photoImage) {
        photoImage.src = '';
        photoImage.style.display = 'none';
    }
    if (photoPlaceholder) photoPlaceholder.style.display = 'flex';
    if (removeBtn) removeBtn.style.display = 'none';

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
// Salary Management Functions
// ============================================

let salaryStructures = [];
let currentEmployeeSalary = null;

async function openSalaryModal(employeeId) {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
        showToast('Employee not found', 'error');
        return;
    }

    // Reset form
    document.getElementById('salaryEmployeeId').value = employeeId;
    document.getElementById('existingSalaryId').value = '';
    document.getElementById('salaryCTC').value = '';
    document.getElementById('salaryEffectiveFrom').value = new Date().toISOString().split('T')[0];
    document.getElementById('currentSalarySection').style.display = 'none';
    document.getElementById('salaryBreakdownSection').style.display = 'none';
    document.getElementById('revisionReasonGroup').style.display = 'none';
    document.getElementById('salaryFormTitle').textContent = 'Configure Salary';
    document.getElementById('saveSalaryBtnText').textContent = 'Save Salary';
    currentEmployeeSalary = null;

    // Set employee info in header
    const initials = (employee.first_name?.[0] || '') + (employee.last_name?.[0] || '');
    document.getElementById('salaryEmployeeAvatar').textContent = initials.toUpperCase() || '-';
    document.getElementById('salaryEmployeeName').textContent =
        `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Unknown';
    document.getElementById('salaryEmployeeDesignation').textContent =
        employee.designation_name || 'No Designation';

    // Load salary structures for employee's office
    try {
        salaryStructures = await api.getHrmsSalaryStructures(employee.office_id);
        const structureSelect = document.getElementById('salaryStructureId');
        structureSelect.innerHTML = '<option value="">Select Salary Structure...</option>';
        salaryStructures.forEach(s => {
            structureSelect.innerHTML += `<option value="${s.id}">${s.structure_name}</option>`;
        });
    } catch (error) {
        console.error('Error loading salary structures:', error);
        showToast('Failed to load salary structures', 'error');
    }

    // Load existing salary if any
    try {
        const salary = await api.getEmployeeSalary(employeeId);
        if (salary && salary.id) {
            currentEmployeeSalary = salary;
            document.getElementById('existingSalaryId').value = salary.id;

            // Show current salary section
            document.getElementById('currentSalarySection').style.display = 'block';
            document.getElementById('currentCTC').textContent = formatCurrency(salary.ctc);
            document.getElementById('currentMonthlyGross').textContent = formatCurrency(salary.gross / 12);
            document.getElementById('currentMonthlyNet').textContent = formatCurrency(salary.net / 12);
            document.getElementById('currentEffectiveFrom').textContent =
                salary.effective_from ? new Date(salary.effective_from).toLocaleDateString() : '-';

            // Update status badge
            document.getElementById('salaryStatusBadge').innerHTML =
                '<span class="badge badge-success">Active</span>';

            // Pre-fill form for revision
            document.getElementById('salaryStructureId').value = salary.structure_id || '';
            document.getElementById('salaryCTC').value = salary.ctc || '';
            document.getElementById('salaryFormTitle').textContent = 'Revise Salary';
            document.getElementById('revisionReasonGroup').style.display = 'block';
            document.getElementById('saveSalaryBtnText').textContent = 'Revise Salary';

            // Trigger breakdown preview
            await previewSalaryBreakdown();

            // Load salary history
            await loadSalaryHistory(employeeId);
        } else {
            document.getElementById('salaryStatusBadge').innerHTML =
                '<span class="badge badge-warning">Not Configured</span>';
            document.getElementById('salaryHistorySection').style.display = 'none';
        }
    } catch (error) {
        // No existing salary - that's OK for new employees
        document.getElementById('salaryStatusBadge').innerHTML =
            '<span class="badge badge-warning">Not Configured</span>';
        document.getElementById('salaryHistorySection').style.display = 'none';
    }

    openModal('salaryModal');
}

async function loadSalaryHistory(employeeId) {
    try {
        const history = await api.getEmployeeSalaryHistory(employeeId);
        const tbody = document.getElementById('salaryHistoryTableBody');

        if (!history || history.length === 0) {
            document.getElementById('salaryHistorySection').style.display = 'none';
            return;
        }

        document.getElementById('salaryHistorySection').style.display = 'block';

        tbody.innerHTML = history.map(item => {
            const effectiveFrom = item.effective_from ? new Date(item.effective_from).toLocaleDateString() : '-';
            const effectiveTo = item.effective_to ? new Date(item.effective_to).toLocaleDateString() : 'Present';
            const isCurrent = item.is_current || !item.effective_to;
            const revisionType = item.revision_reason || item.revision_type || '-';

            return `
                <tr class="${isCurrent ? 'current-salary' : ''}">
                    <td class="period-cell">
                        <div class="period-dates">
                            ${effectiveFrom} - ${effectiveTo}
                        </div>
                        ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
                    </td>
                    <td>${formatCurrency(item.ctc)}</td>
                    <td>${formatCurrency(item.gross / 12)}</td>
                    <td>${formatCurrency(item.net / 12)}</td>
                    <td class="revision-type">${revisionType.replace(/_/g, ' ')}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading salary history:', error);
        document.getElementById('salaryHistorySection').style.display = 'none';
    }
}

async function previewSalaryBreakdown() {
    const structureId = document.getElementById('salaryStructureId').value;
    const ctc = parseFloat(document.getElementById('salaryCTC').value);

    if (!structureId || !ctc || ctc <= 0) {
        document.getElementById('salaryBreakdownSection').style.display = 'none';
        return;
    }

    try {
        const breakdown = await api.calculateSalaryBreakdown({
            structure_id: structureId,
            ctc: ctc
        });

        if (breakdown) {
            renderSalaryBreakdown(breakdown);
            document.getElementById('salaryBreakdownSection').style.display = 'block';
        }
    } catch (error) {
        console.error('Error calculating breakdown:', error);
        document.getElementById('salaryBreakdownSection').style.display = 'none';
    }
}

function renderSalaryBreakdown(breakdown) {
    const grid = document.getElementById('salaryBreakdownGrid');
    let html = '';

    // Earnings
    if (breakdown.earnings && breakdown.earnings.length > 0) {
        html += '<div class="salary-breakdown-column earnings">';
        html += '<h5>Earnings</h5>';
        breakdown.earnings.forEach(e => {
            html += `
                <div class="breakdown-item">
                    <span class="item-name">${e.component_name}</span>
                    <span class="item-value">${formatCurrency(e.monthly_amount)}</span>
                </div>
            `;
        });
        html += '</div>';
    }

    // Deductions
    if (breakdown.deductions && breakdown.deductions.length > 0) {
        html += '<div class="salary-breakdown-column deductions">';
        html += '<h5>Deductions</h5>';
        breakdown.deductions.forEach(d => {
            html += `
                <div class="breakdown-item">
                    <span class="item-name">${d.component_name}</span>
                    <span class="item-value">-${formatCurrency(d.monthly_amount)}</span>
                </div>
            `;
        });
        html += '</div>';
    }

    grid.innerHTML = html;

    // Update totals (backend returns annual amounts, convert to monthly)
    document.getElementById('previewMonthlyGross').textContent = formatCurrency(breakdown.gross / 12);
    document.getElementById('previewMonthlyDeductions').textContent =
        formatCurrency(breakdown.total_deductions / 12 || 0);
    document.getElementById('previewMonthlyNet').textContent = formatCurrency(breakdown.net / 12);
}

async function saveEmployeeSalary() {
    const employeeId = document.getElementById('salaryEmployeeId').value;
    const existingSalaryId = document.getElementById('existingSalaryId').value;
    const structureId = document.getElementById('salaryStructureId').value;
    const ctc = parseFloat(document.getElementById('salaryCTC').value);
    const effectiveFrom = document.getElementById('salaryEffectiveFrom').value;

    if (!structureId || !ctc || !effectiveFrom) {
        showToast('Please fill all required fields', 'error');
        return;
    }

    const saveBtn = document.getElementById('saveSalaryBtn');
    const originalText = document.getElementById('saveSalaryBtnText').textContent;
    saveBtn.disabled = true;
    document.getElementById('saveSalaryBtnText').textContent = 'Saving...';

    try {
        let salaryData;

        if (existingSalaryId) {
            // Revise existing salary - backend expects new_ctc, new_structure_id
            salaryData = {
                employee_id: employeeId,
                new_structure_id: structureId,
                new_ctc: ctc,
                effective_from: effectiveFrom,
                revision_type: document.getElementById('salaryRevisionType').value || 'adjustment'
            };
            await api.updateEmployeeSalary(employeeId, salaryData);
            showToast('Salary revised successfully', 'success');
        } else {
            // Create new salary - backend expects ctc, structure_id
            salaryData = {
                employee_id: employeeId,
                structure_id: structureId,
                ctc: ctc,
                effective_from: effectiveFrom
            };
            await api.assignEmployeeSalary(salaryData);
            showToast('Salary assigned successfully', 'success');
        }

        closeModal('salaryModal');
    } catch (error) {
        console.error('Error saving salary:', error);
        showToast(error.message || 'Failed to save salary', 'error');
    } finally {
        saveBtn.disabled = false;
        document.getElementById('saveSalaryBtnText').textContent = originalText;
    }
}

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
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

    // Set employee info
    const initials = getInitials(employee.first_name, employee.last_name);
    document.getElementById('transferEmployeeAvatar').textContent = initials;
    document.getElementById('transferEmployeeName').textContent =
        `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Unknown';
    document.getElementById('transferEmployeeCode').textContent = employee.employee_code || '-';

    // Set current values
    const currentOffice = offices.find(o => o.id === employee.office_id);
    const currentDept = departments.find(d => d.id === employee.department_id);
    const currentDesig = designations.find(d => d.id === employee.designation_id);
    const currentManager = employees.find(e => e.user_id === employee.reporting_manager_id);

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
    document.getElementById('salaryRevisionSection').style.display = 'none';

    // Uncheck all checkboxes
    document.getElementById('changeOffice').checked = false;
    document.getElementById('changeDepartment').checked = false;
    document.getElementById('changeManager').checked = false;
    document.getElementById('reviseSalary').checked = false;

    openModal('transferModal');
}

function populateTransferDropdowns(employee) {
    // Populate office dropdown
    const officeSelect = document.getElementById('newOfficeId');
    officeSelect.innerHTML = '<option value="">Select new office...</option>' +
        offices.filter(o => o.id !== employee.office_id)
            .map(o => `<option value="${o.id}">${o.office_name}</option>`).join('');

    // Populate department dropdown
    const deptSelect = document.getElementById('newDepartmentId');
    deptSelect.innerHTML = '<option value="">Select new department...</option>' +
        departments.map(d => `<option value="${d.id}">${d.department_name}</option>`).join('');

    // Populate designation dropdown (initially empty until department selected)
    document.getElementById('newDesignationId').innerHTML = '<option value="">Select department first...</option>';

    // Populate manager dropdown (exclude current employee and their direct reports)
    const managerSelect = document.getElementById('newManagerUserId');
    managerSelect.innerHTML = '<option value="">No manager (CEO/Top level)</option>' +
        employees.filter(e => e.id !== employee.id && e.user_id !== employee.reporting_manager_id)
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
    const reviseSalary = document.getElementById('reviseSalary').checked;

    if (!changeOffice && !changeDepartment && !changeManager && !reviseSalary) {
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

        if (reviseSalary) {
            const newCTC = parseFloat(document.getElementById('newCTC').value);
            if (newCTC && newCTC > 0) {
                request.new_ctc = newCTC;
            }
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
        currentUserId = currentEmployee.manager_user_id || currentEmployee.reporting_manager_id;
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
    const managerUserId = document.getElementById('reportingManagerId').value;
    const validationMsg = document.getElementById('managerValidationMsg');

    // For edit mode, get the employee's user_id from existing data
    let actualEmployeeUserId = employeeUserId;
    if (employeeId && !actualEmployeeUserId) {
        const employee = employees.find(e => e.id === employeeId);
        actualEmployeeUserId = employee?.user_id;
    }

    const validation = validateManagerSelection(employeeId, actualEmployeeUserId, managerUserId);

    const managerSelect = document.getElementById('reportingManagerId');
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
 * @param {Array} employeeList - List of employees to filter
 * @param {string} currentEmployeeId - The employee being edited (to exclude from list)
 * @param {string} currentEmployeeUserId - The user_id of employee being edited (to check hierarchy)
 * @returns {Array} - Filtered list of valid managers
 */
function getValidManagers(employeeList, currentEmployeeId, currentEmployeeUserId) {
    return employeeList.filter(e => {
        // Exclude the employee themselves
        if (e.id === currentEmployeeId) return false;
        if (e.user_id === currentEmployeeUserId) return false;

        // Only include active employees
        if (e.employment_status !== 'active' && !e.is_active) return false;

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

        let html = `
            <div class="transfer-history-header">
                <div class="employee-avatar-large">${getInitials(employee?.first_name, employee?.last_name)}</div>
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
// Employee Wizard Navigation Functions
// ============================================

let currentEmployeeStep = 1;
const totalEmployeeSteps = 4;

function goToEmployeeStep(stepNumber) {
    // Validate current step before moving forward
    if (stepNumber > currentEmployeeStep && !validateEmployeeStep(currentEmployeeStep)) {
        return;
    }

    // Update step indicators
    for (let i = 1; i <= totalEmployeeSteps; i++) {
        const stepEl = document.getElementById(`emp-step-${i}`);
        if (!stepEl) continue;

        stepEl.classList.remove('active', 'completed');
        if (i < stepNumber) {
            stepEl.classList.add('completed');
        } else if (i === stepNumber) {
            stepEl.classList.add('active');
        }
    }

    // Update panels
    for (let i = 1; i <= totalEmployeeSteps; i++) {
        const panelEl = document.getElementById(`emp-panel-${i}`);
        if (!panelEl) continue;

        panelEl.classList.remove('active');
        if (i === stepNumber) {
            panelEl.classList.add('active');
        }
    }

    // Update navigation buttons
    const backBtn = document.getElementById('empWizardBackBtn');
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
            return true; // Documents are optional
        default:
            return true;
    }
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

    return true;
}

function validateEmploymentStep() {
    const officeId = document.getElementById('officeId').value;
    const departmentId = document.getElementById('departmentId').value;
    const designationId = document.getElementById('designationId').value;
    const hireDate = document.getElementById('dateOfJoining').value;

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
        showToast('Please enter the date of joining', 'error');
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

    if (ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode.toUpperCase())) {
        showToast('Invalid IFSC code format', 'error');
        return false;
    }

    return true;
}

// Reset wizard to step 1 when opening modal
function resetEmployeeWizard() {
    currentEmployeeStep = 1;
    goToEmployeeStep(1);
}
