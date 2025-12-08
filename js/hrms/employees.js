let employees = [];
let departments = [];
let designations = [];
let offices = [];
let shifts = [];
let availableUsers = [];
let currentViewEmployee = null;
let userRole = 'HRMS_USER';

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
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>No employees found</p></td></tr>';
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
                <td>${formatDate(emp.date_of_joining)}</td>
                <td><span class="status-badge ${emp.employment_status}">${capitalizeFirst(emp.employment_status)}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn" onclick="viewEmployee('${emp.id}')" data-tooltip="View">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                        ${userRole === 'HRMS_ADMIN' ? `
                            <button class="action-btn" onclick="editEmployee('${emp.id}')" data-tooltip="Edit">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
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

    // Reset all cascading dropdowns
    document.getElementById('departmentId').innerHTML = '<option value="">Select office first...</option>';
    document.getElementById('designationId').innerHTML = '<option value="">Select department first...</option>';
    document.getElementById('shiftId').innerHTML = '<option value="">Select office first...</option>';

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

        const userSelect = document.getElementById('userSelect');
        userSelect.innerHTML = '<option value="">Select a user...</option>' +
            availableUsers.map(u => `<option value="${u.id}">${u.email} (${u.firstName} ${u.lastName})</option>`).join('');

        // Add onchange handler to auto-populate fields when user is selected
        userSelect.onchange = function() {
            const selectedUserId = this.value;
            if (selectedUserId) {
                const user = availableUsers.find(u => u.id === selectedUserId);
                if (user) {
                    document.getElementById('firstName').value = user.firstName || '';
                    document.getElementById('lastName').value = user.lastName || '';
                    document.getElementById('workEmail').value = user.email || '';
                }
            } else {
                // Clear fields if no user selected
                document.getElementById('firstName').value = '';
                document.getElementById('lastName').value = '';
                document.getElementById('workEmail').value = '';
            }
        };
    } catch (error) {
        console.error('Error loading available users:', error);
    }

    // Load managers
    const managerSelect = document.getElementById('reportingManagerId');
    managerSelect.innerHTML = '<option value="">None</option>' +
        employees.map(e => `<option value="${e.user_id}">${e.first_name} ${e.last_name}</option>`).join('');

    openModal('employeeModal');
}

async function editEmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('employeeModalTitle').textContent = 'Edit Employee';
    document.getElementById('employeeId').value = id;
    document.getElementById('userSelectionSection').style.display = 'none';

    // Fill basic form fields first
    document.getElementById('employeeCode').value = emp.employee_code || '';
    document.getElementById('firstName').value = emp.first_name || '';
    document.getElementById('lastName').value = emp.last_name || '';
    document.getElementById('workEmail').value = emp.work_email || '';
    document.getElementById('workPhone').value = emp.work_phone || '';
    document.getElementById('dateOfBirth').value = emp.date_of_birth?.split('T')[0] || '';
    document.getElementById('gender').value = emp.gender || '';
    document.getElementById('employmentType').value = emp.employment_type || 'full_time';
    document.getElementById('dateOfJoining').value = emp.date_of_joining?.split('T')[0] || '';
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

    openModal('employeeModal');
}

async function saveEmployee() {
    const id = document.getElementById('employeeId').value;
    const isEdit = !!id;

    const data = {
        employee_code: document.getElementById('employeeCode').value,
        first_name: document.getElementById('firstName').value,
        last_name: document.getElementById('lastName').value,
        work_email: document.getElementById('workEmail').value,
        work_phone: document.getElementById('workPhone').value || null,
        date_of_birth: document.getElementById('dateOfBirth').value || null,
        gender: document.getElementById('gender').value || null,
        department_id: document.getElementById('departmentId').value,
        designation_id: document.getElementById('designationId').value,
        office_id: document.getElementById('officeId').value,
        shift_id: document.getElementById('shiftId').value || null,
        reporting_manager_id: document.getElementById('reportingManagerId').value || null,
        employment_type: document.getElementById('employmentType').value,
        date_of_joining: document.getElementById('dateOfJoining').value,
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
        if (isEdit) {
            await api.updateHrmsEmployee(id, data);
            showToast('Employee updated successfully', 'success');
        } else {
            await api.createHrmsEmployee(data);
            showToast('Employee created successfully', 'success');
        }

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
                            <span class="value">${formatDate(emp.date_of_joining)}</span>
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
