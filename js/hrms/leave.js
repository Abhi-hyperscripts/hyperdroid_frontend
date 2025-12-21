let currentUser = null;
let leaveTypes = [];
let employees = [];
let departments = [];

// Employee search dropdown state (virtual scrolling)
let filteredEmployees = [];
let displayedEmployeeCount = 0;
let selectedEmployeeId = null;
const EMPLOYEE_BATCH_SIZE = 20;

document.addEventListener('DOMContentLoaded', async function() {
    await loadNavigation();
    setupSidebar();
    await initializePage();
});

async function initializePage() {
    try {
        showLoading();
        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }
        currentUser = api.getUser();

        if (!currentUser) {
            window.location.href = '../login.html';
            return;
        }

        // Initialize RBAC
        hrmsRoles.init();

        // Apply RBAC visibility
        applyLeaveRBAC();

        // Setup tabs
        setupTabs();

        // Load initial data
        await Promise.all([
            loadLeaveTypes(),
            loadMyLeaveRequests(),
            loadDepartments()
        ]);

        if (hrmsRoles.canApproveLeave()) {
            await loadPendingRequests();
            await loadEmployees();
        }

        // Setup date change handlers
        document.getElementById('fromDate').addEventListener('change', calculateLeaveDays);
        document.getElementById('toDate').addEventListener('change', calculateLeaveDays);
        document.getElementById('halfDay').addEventListener('change', calculateLeaveDays);

        hideLoading();
    } catch (error) {
        console.error('Error initializing page:', error);
        showToast('Failed to load page data', 'error');
        hideLoading();
    }
}

// Apply RBAC visibility rules for leave page
function applyLeaveRBAC() {
    // Management nav group (Leave Requests, Team Calendar) - visible to managers and HR admins
    const managementNavGroup = document.getElementById('managementNavGroup');
    if (managementNavGroup) {
        managementNavGroup.style.display = hrmsRoles.canApproveLeave() ? 'block' : 'none';
    }

    // Configuration nav group (Leave Types) - HR Admin only
    const configNavGroup = document.getElementById('configNavGroup');
    if (configNavGroup) {
        configNavGroup.style.display = hrmsRoles.isHRAdmin() ? 'block' : 'none';
    }

    // Admin actions (Create Leave Type button) - HR Admin only
    const adminActions = document.getElementById('adminActions');
    if (adminActions) {
        adminActions.style.display = hrmsRoles.isHRAdmin() ? 'flex' : 'none';
    }

    // Allocate button - HR Admin only
    const allocateBtn = document.getElementById('allocateBtn');
    if (allocateBtn) {
        allocateBtn.style.display = hrmsRoles.isHRAdmin() ? 'inline-flex' : 'none';
    }
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.sidebar-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            switchTab(tabId);
        });
    });
}

function switchTab(tabName) {
    // Update sidebar button active states
    document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.sidebar-btn[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Update tab content visibility
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabContent = document.getElementById(tabName);
    if (tabContent) tabContent.classList.add('active');

    // Update active tab title
    const titleMap = {
        'my-leave': 'My Leave',
        'leave-balance': 'Leave Balance',
        'leave-requests': 'Leave Requests',
        'team-calendar': 'Team Calendar',
        'leave-types': 'Leave Types'
    };
    const titleEl = document.getElementById('activeTabName');
    if (titleEl) titleEl.textContent = titleMap[tabName] || 'Leave';

    // Load data for specific tabs
    if (tabName === 'leave-balance' && hrmsRoles.canApproveLeave()) {
        loadLeaveBalances();
    } else if (tabName === 'team-calendar') {
        initializeTeamCalendar();
    } else if (tabName === 'leave-types') {
        updateLeaveTypesTable();
    } else if (tabName === 'leave-requests') {
        loadPendingRequests();
    }
}

async function loadLeaveTypes() {
    try {
        const response = await api.request('/hrms/leave-types');
        // Handle both array response and { success, data } response format
        leaveTypes = Array.isArray(response) ? response : (response?.data || []);

        // Populate leave type selects
        const selects = ['leaveType', 'allocLeaveType'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.innerHTML = '<option value="">Select Leave Type</option>';
                // Filter for active leave types (backend returns is_active in snake_case)
                leaveTypes.filter(t => t.is_active !== false && t.isActive !== false).forEach(type => {
                    // Backend returns leave_name in snake_case
                    const displayName = type.leave_name || type.name || type.leaveName || 'Unknown';
                    select.innerHTML += `<option value="${type.id}">${displayName}</option>`;
                });
            }
        });

        // Update leave types table if HR admin
        if (hrmsRoles.isHRAdmin()) {
            updateLeaveTypesTable();
        }

        // Update balance stats
        await loadMyLeaveBalance();
    } catch (error) {
        console.error('Error loading leave types:', error);
    }
}

async function loadMyLeaveBalance() {
    try {
        const year = new Date().getFullYear();
        const response = await api.request(`/hrms/leave/balances?year=${year}`);
        // Handle response - could be array directly or { success, data } format
        const balances = Array.isArray(response) ? response : (response?.balances || response?.data || []);
        if (balances && balances.length > 0) {
            // Update stats - look for leave type codes EL (Earned/Annual), SL (Sick), CL (Casual)
            document.getElementById('annualBalance').textContent =
                balances.find(b => b.leave_type_code === 'EL' || b.leaveTypeCode === 'EL')?.available_balance ??
                balances.find(b => b.leave_type_code === 'EL' || b.leaveTypeCode === 'EL')?.availableBalance ?? 0;
            document.getElementById('sickBalance').textContent =
                balances.find(b => b.leave_type_code === 'SL' || b.leaveTypeCode === 'SL')?.available_balance ??
                balances.find(b => b.leave_type_code === 'SL' || b.leaveTypeCode === 'SL')?.availableBalance ?? 0;
            document.getElementById('casualBalance').textContent =
                balances.find(b => b.leave_type_code === 'CL' || b.leaveTypeCode === 'CL')?.available_balance ??
                balances.find(b => b.leave_type_code === 'CL' || b.leaveTypeCode === 'CL')?.availableBalance ?? 0;
        }
    } catch (error) {
        console.error('Error loading leave balance:', error);
    }
}

async function loadMyLeaveRequests() {
    try {
        const year = document.getElementById('myLeaveYear').value;
        const status = document.getElementById('myLeaveStatus').value;

        let url = `/hrms/leave/requests?year=${year}`;
        if (status) url += `&status=${status}`;

        const response = await api.request(url);
        const requests = response || [];

        // Update pending count (handle both 'pending' and 'Pending')
        const pendingCount = requests.filter(r => r.status?.toLowerCase() === 'pending').length;
        document.getElementById('pendingCount').textContent = pendingCount;

        updateMyLeaveTable(requests);
    } catch (error) {
        console.error('Error loading leave requests:', error);
    }
}

function updateMyLeaveTable(requests) {
    const tbody = document.getElementById('myLeaveTable');

    if (!requests || requests.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <p>No leave requests found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = requests.map(req => `
        <tr>
            <td>${req.leave_type_name || req.leaveTypeName || 'N/A'}</td>
            <td>${formatDate(req.start_date || req.fromDate)}</td>
            <td>${formatDate(req.end_date || req.toDate)}</td>
            <td>${req.total_days || req.numberOfDays || 'N/A'}</td>
            <td class="reason-cell" title="${escapeHtml(req.reason)}">${truncate(req.reason, 30)}</td>
            <td><span class="status-badge status-${req.status?.toLowerCase()}">${req.status}</span></td>
            <td>${formatDate(req.created_at || req.appliedOn)}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewLeaveDetails('${req.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    ${(req.status === 'pending' || req.status === 'Pending') ? `
                    <button class="action-btn" onclick="cancelLeaveRequest('${req.id}')" title="Cancel Request">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadPendingRequests() {
    try {
        const status = document.getElementById('requestStatus').value;
        const department = document.getElementById('requestDepartment').value;

        let url = `/hrms/leave/pending-approvals`;
        const params = [];

        // SUPERADMIN and HRMS_HR_ADMIN can see ALL pending requests, not just their direct reports
        if (hrmsRoles.isHRAdmin()) {
            params.push('all=true');
        }

        if (status) params.push(`status=${status}`);
        if (department) params.push(`departmentId=${department}`);
        if (params.length) url += '?' + params.join('&');

        const response = await api.request(url);
        updateLeaveRequestsTable(response || []);
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

function updateLeaveRequestsTable(requests) {
    const tbody = document.getElementById('leaveRequestsTable');

    if (!requests || requests.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <p>No pending leave requests</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = requests.map(req => {
        // Support both snake_case (backend) and camelCase property names
        const employeeName = req.employee_name || req.employeeName || 'Unknown';
        const employeeEmail = req.employee_email || req.employeeEmail || '';
        const employeeUserId = req.employee_user_id || req.employeeUserId;
        const leaveTypeName = req.leave_type_name || req.leaveTypeName || 'N/A';
        const startDate = req.start_date || req.fromDate;
        const endDate = req.end_date || req.toDate;
        const totalDays = req.total_days || req.numberOfDays || 'N/A';
        const status = req.status || 'pending';

        // Determine if current user can approve this request
        // SUPERADMIN can approve anyone (including self)
        // HRMS_HR_ADMIN can approve anyone except self
        // Manager can approve only direct reports (backend handles this filtering)
        const isOwnRequest = employeeUserId === currentUser?.userId || employeeEmail === currentUser?.email;
        const canApprove = status.toLowerCase() === 'pending' && (
            hrmsRoles.isSuperAdmin() ||  // SUPERADMIN can approve anyone including self
            (hrmsRoles.isHRAdmin() && !isOwnRequest) ||  // HR_ADMIN can approve anyone except self
            (!hrmsRoles.isHRAdmin() && hrmsRoles.isManager())  // Manager - backend already filtered to their direct reports
        );

        return `
        <tr>
            <td class="employee-cell">
                <div class="employee-info">
                    <div class="avatar">${getInitials(employeeName)}</div>
                    <div class="details">
                        <span class="name">${employeeName}${isOwnRequest ? ' (You)' : ''}</span>
                        <span class="email">${employeeEmail}</span>
                    </div>
                </div>
            </td>
            <td>${leaveTypeName}</td>
            <td>${formatDate(startDate)}</td>
            <td>${formatDate(endDate)}</td>
            <td>${totalDays}</td>
            <td class="reason-cell" title="${escapeHtml(req.reason)}">${truncate(req.reason, 25)}</td>
            <td><span class="status-badge status-${status.toLowerCase()}">${status}</span></td>
            <td>
                <div class="action-buttons">
                    ${canApprove ? `
                    <button class="action-btn success" onclick="showApproveModal('${req.id}')" title="Approve">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="showRejectModal('${req.id}')" title="Reject">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                    ` : ''}
                    <button class="action-btn" onclick="viewLeaveDetails('${req.id}')" title="View">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');
}

async function loadLeaveBalances() {
    try {
        showLoading();
        const year = document.getElementById('balanceYear').value;
        const department = document.getElementById('balanceDepartment').value;

        // Use the admin endpoint for getting all employee balances
        let url = `/hrms/leave-types/balances?year=${year}`;
        if (department) url += `&departmentId=${department}`;

        const response = await api.request(url);
        const rawBalances = Array.isArray(response) ? response : (response?.data || []);

        // Transform raw LeaveBalance records to aggregated format per employee
        const aggregated = transformLeaveBalancesToAggregated(rawBalances);
        updateLeaveBalanceTable(aggregated);
        hideLoading();
    } catch (error) {
        console.error('Error loading leave balances:', error);
        hideLoading();
    }
}

/**
 * Transform raw LeaveBalance records from backend to aggregated format per employee.
 * Backend returns: [{ employee_id, employee_name, leave_type_code, available_days, ... }, ...]
 * Frontend expects: [{ employee_id, employee_name, annual_leave, sick_leave, casual_leave, ... }, ...]
 */
function transformLeaveBalancesToAggregated(rawBalances) {
    if (!rawBalances || rawBalances.length === 0) return [];

    // Map leave_type_code to property names for display
    const codeToProperty = {
        'EL': 'annual_leave',      // Earned Leave → Annual Leave
        'BL': 'annual_leave',      // Base Leave → Annual Leave (alternative)
        'SL': 'sick_leave',        // Sick Leave
        'CL': 'casual_leave',      // Casual Leave
        'CO': 'comp_off',          // Comp Off
        'LWP': 'lop',              // Leave Without Pay
        'LOP': 'lop',              // Loss of Pay (alias)
        'UL': 'lop',               // Unpaid Leave
        'PL': 'paternity_leave',   // Paternity Leave
        'ML': 'maternity_leave'    // Maternity Leave
    };

    // Group by employee_id
    const employeeMap = new Map();

    for (const balance of rawBalances) {
        const empId = balance.employee_id;

        if (!employeeMap.has(empId)) {
            employeeMap.set(empId, {
                employee_id: empId,
                employee_name: balance.employee_name || 'Unknown',
                user_id: balance.user_id,
                department_name: balance.department_name || '-',
                annual_leave: '-',
                sick_leave: '-',
                casual_leave: '-',
                comp_off: '-',
                lop: '-',
                paternity_leave: '-',
                maternity_leave: '-'
            });
        }

        const employee = employeeMap.get(empId);
        const code = (balance.leave_type_code || '').toUpperCase();
        const propName = codeToProperty[code];

        if (propName) {
            // Use available_days for display (total - used - pending)
            const available = balance.available_days ?? balance.total_days ?? 0;
            employee[propName] = available;
        }
    }

    return Array.from(employeeMap.values());
}

function updateLeaveBalanceTable(balances) {
    const tbody = document.getElementById('leaveBalanceTable');

    if (!balances || balances.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                        </svg>
                        <p>No leave balance data found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = balances.map(emp => {
        // Support both snake_case (backend) and camelCase property names
        const employeeName = emp.employee_name || emp.employeeName || 'Unknown';
        const departmentName = emp.department_name || emp.departmentName || '-';
        const employeeId = emp.employee_id || emp.employeeId;
        const annualLeave = emp.annual_leave ?? emp.annualLeave ?? '-';
        const sickLeave = emp.sick_leave ?? emp.sickLeave ?? '-';
        const casualLeave = emp.casual_leave ?? emp.casualLeave ?? '-';
        const compOff = emp.comp_off ?? emp.compOff ?? '-';
        const lop = emp.lop ?? '-';

        return `
        <tr>
            <td class="employee-cell">
                <div class="employee-info">
                    <div class="avatar">${getInitials(employeeName)}</div>
                    <div class="details">
                        <span class="name">${employeeName}</span>
                    </div>
                </div>
            </td>
            <td>${departmentName}</td>
            <td>${annualLeave}</td>
            <td>${sickLeave}</td>
            <td>${casualLeave}</td>
            <td>${compOff}</td>
            <td>${lop}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewEmployeeBalance('${employeeId}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');
}

function updateLeaveTypesTable() {
    const tbody = document.getElementById('leaveTypesTable');
    const searchTerm = document.getElementById('leaveTypeSearch')?.value?.toLowerCase() || '';

    const filtered = leaveTypes.filter(t =>
        (t.leave_name || '').toLowerCase().includes(searchTerm) ||
        (t.leave_code || '').toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="9">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <p>No leave types configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(type => `
        <tr>
            <td><strong>${type.leave_name}</strong></td>
            <td><code>${type.leave_code}</code></td>
            <td>${type.default_days_per_year}</td>
            <td>${type.carry_forward_enabled ? 'Yes' : 'No'}</td>
            <td>${type.max_carry_forward_days || '-'}</td>
            <td>${type.is_paid ? 'Yes' : 'No'}</td>
            <td>${type.prorate_on_joining ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${type.is_active ? 'active' : 'inactive'}">${type.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editLeaveType('${type.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadDepartments() {
    try {
        const response = await api.request('/hrms/departments');
        departments = response || [];

        const selects = ['requestDepartment', 'balanceDepartment'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.innerHTML = '<option value="">All Departments</option>';
                departments.forEach(dept => {
                    // Support both snake_case (backend) and camelCase property names
                    const deptName = dept.department_name || dept.name || 'Unknown';
                    select.innerHTML += `<option value="${dept.id}">${deptName}</option>`;
                });
            }
        });
    } catch (error) {
        console.error('Error loading departments:', error);
    }
}

async function loadEmployees() {
    try {
        const response = await api.request('/hrms/employees');
        employees = response || [];

        // Initialize the searchable dropdown
        filteredEmployees = [...employees];
        displayedEmployeeCount = 0;
        selectedEmployeeId = null;

        // Display employees in the searchable list
        displayEmployeeList(filteredEmployees, false);
        setupEmployeeListScroll();
    } catch (error) {
        console.error('Error loading employees:', error);
        const list = document.getElementById('employeeSearchList');
        if (list) {
            list.innerHTML = '<p class="text-danger" style="text-align: center; padding: 20px;">Failed to load employees</p>';
        }
    }
}

// ===== Searchable Employee Dropdown Functions =====

function toggleEmployeeDropdown() {
    const dropdown = document.getElementById('employeeSearchDropdown');
    dropdown.classList.toggle('open');

    if (dropdown.classList.contains('open')) {
        document.getElementById('employeeSearchInput').focus();
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeEmployeeDropdownOnOutsideClick);
        }, 0);
    } else {
        document.removeEventListener('click', closeEmployeeDropdownOnOutsideClick);
    }
}

function closeEmployeeDropdownOnOutsideClick(e) {
    const dropdown = document.getElementById('employeeSearchDropdown');
    if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        document.removeEventListener('click', closeEmployeeDropdownOnOutsideClick);
    }
}

function resetEmployeeDropdown() {
    const selectedText = document.querySelector('.employee-search-selected .selected-employee-text');
    if (selectedText) {
        selectedText.textContent = 'Select an employee...';
        selectedText.classList.add('placeholder');
    }
    const searchInput = document.getElementById('employeeSearchInput');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('clearEmployeeSearchBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    const dropdown = document.getElementById('employeeSearchDropdown');
    if (dropdown) dropdown.classList.remove('open');

    // Reset hidden input
    const hiddenInput = document.getElementById('allocEmployee');
    if (hiddenInput) hiddenInput.value = '';

    selectedEmployeeId = null;
    filteredEmployees = [...employees];
    displayedEmployeeCount = 0;
    displayEmployeeList(filteredEmployees, false);
}

function filterEmployeeList() {
    const searchTerm = document.getElementById('employeeSearchInput').value.toLowerCase();
    const clearBtn = document.getElementById('clearEmployeeSearchBtn');

    clearBtn.style.display = searchTerm ? 'flex' : 'none';

    filteredEmployees = employees.filter(emp => {
        const firstName = (emp.first_name || emp.firstName || '').toLowerCase();
        const lastName = (emp.last_name || emp.lastName || '').toLowerCase();
        const email = (emp.email || '').toLowerCase();
        const deptName = (emp.department_name || emp.departmentName || '').toLowerCase();

        return firstName.includes(searchTerm) ||
               lastName.includes(searchTerm) ||
               email.includes(searchTerm) ||
               deptName.includes(searchTerm);
    });

    displayedEmployeeCount = 0;
    displayEmployeeList(filteredEmployees, false);
}

function clearEmployeeSearch() {
    document.getElementById('employeeSearchInput').value = '';
    document.getElementById('clearEmployeeSearchBtn').style.display = 'none';
    filteredEmployees = [...employees];
    displayedEmployeeCount = 0;
    displayEmployeeList(filteredEmployees, false);
}

function displayEmployeeList(empList, append = false) {
    const list = document.getElementById('employeeSearchList');
    const countDisplay = document.getElementById('employeeCountDisplay');

    if (!list) return;

    const totalEmployees = employees.length;
    const filteredCount = empList.length;
    countDisplay.textContent = filteredCount === totalEmployees
        ? `${totalEmployees} employee${totalEmployees !== 1 ? 's' : ''}`
        : `${filteredCount} of ${totalEmployees} employees`;

    if (empList.length === 0) {
        list.innerHTML = '<p class="text-muted" style="text-align: center; font-size: 0.75rem; padding: 20px;">No employees found</p>';
        return;
    }

    const startIndex = append ? displayedEmployeeCount : 0;
    const endIndex = Math.min(startIndex + EMPLOYEE_BATCH_SIZE, empList.length);
    const batch = empList.slice(startIndex, endIndex);

    const batchHTML = batch.map(emp => {
        const firstName = emp.first_name || emp.firstName || '';
        const lastName = emp.last_name || emp.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
        const email = emp.email || '';
        const deptName = emp.department_name || emp.departmentName || '';
        const isSelected = selectedEmployeeId === emp.id;

        return `
            <div class="employee-select-item ${isSelected ? 'selected' : ''}"
                 data-employee-id="${emp.id}"
                 onclick="selectEmployee('${emp.id}')">
                <div class="employee-info-compact">
                    <span class="employee-name-compact">${fullName}</span>
                    <div class="employee-meta-compact">
                        <span class="employee-email-compact">${email}</span>
                        ${deptName ? `<span class="employee-dept-compact">${deptName}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (append) {
        const loadingIndicator = document.getElementById('employee-loading-indicator');
        if (loadingIndicator) loadingIndicator.remove();
        list.insertAdjacentHTML('beforeend', batchHTML);
    } else {
        list.innerHTML = batchHTML;
    }

    displayedEmployeeCount = endIndex;

    // Show "scroll for more" indicator if there are more employees
    if (displayedEmployeeCount < empList.length) {
        list.insertAdjacentHTML('beforeend',
            '<div id="employee-loading-indicator" class="text-muted" style="text-align: center; padding: 12px; font-size: 0.75rem;">Scroll for more...</div>');
    }
}

function setupEmployeeListScroll() {
    const list = document.getElementById('employeeSearchList');
    if (!list) return;

    list.onscroll = () => {
        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;

        // Load more when near bottom
        if (scrollTop + clientHeight >= scrollHeight - 50) {
            if (displayedEmployeeCount < filteredEmployees.length) {
                displayEmployeeList(filteredEmployees, true);
            }
        }
    };
}

function selectEmployee(employeeId) {
    selectedEmployeeId = employeeId;
    const emp = employees.find(e => e.id === employeeId);

    if (emp) {
        // Update hidden input
        document.getElementById('allocEmployee').value = employeeId;

        // Update selected text
        const firstName = emp.first_name || emp.firstName || '';
        const lastName = emp.last_name || emp.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim() || emp.email || 'Unknown';
        const deptName = emp.department_name || emp.departmentName || '';

        const selectedText = document.querySelector('.employee-search-selected .selected-employee-text');
        selectedText.textContent = deptName ? `${fullName} (${deptName})` : fullName;
        selectedText.classList.remove('placeholder');

        // Update list to show selected state
        document.querySelectorAll('.employee-search-panel .employee-select-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.employeeId === employeeId);
        });

        // Close dropdown
        document.getElementById('employeeSearchDropdown').classList.remove('open');
        document.removeEventListener('click', closeEmployeeDropdownOnOutsideClick);
    }
}

// Modal functions
function showApplyLeaveModal() {
    document.getElementById('applyLeaveForm').reset();
    document.getElementById('leaveDays').value = '0';
    document.getElementById('applyLeaveModal').classList.add('active');
}

function showCreateLeaveTypeModal() {
    document.getElementById('leaveTypeForm').reset();
    document.getElementById('leaveTypeId').value = '';
    document.getElementById('leaveTypeModalTitle').textContent = 'Create Leave Type';
    document.getElementById('leaveTypeModal').classList.add('active');
}

function editLeaveType(id) {
    const type = leaveTypes.find(t => t.id === id);
    if (!type) return;

    document.getElementById('leaveTypeId').value = type.id;
    document.getElementById('typeName').value = type.leave_name;
    document.getElementById('typeCode').value = type.leave_code;
    document.getElementById('typeDescription').value = type.description || '';
    document.getElementById('defaultDays').value = type.default_days_per_year;
    document.getElementById('maxDaysPerRequest').value = type.max_consecutive_days || 0;
    document.getElementById('carryForward').value = type.carry_forward_enabled ? 'true' : 'false';
    document.getElementById('maxCarryForward').value = type.max_carry_forward_days || 0;
    document.getElementById('isPaid').value = type.is_paid ? 'true' : 'false';
    document.getElementById('requiresApproval').value = type.requires_approval ? 'true' : 'false';
    document.getElementById('allowHalfDay').value = type.allow_half_day ? 'true' : 'false';
    document.getElementById('prorateOnJoining').value = type.prorate_on_joining ? 'true' : 'false';
    document.getElementById('typeIsActive').value = type.is_active ? 'true' : 'false';

    document.getElementById('leaveTypeModalTitle').textContent = 'Edit Leave Type';
    document.getElementById('leaveTypeModal').classList.add('active');
}

function showAllocateLeaveModal() {
    document.getElementById('allocateLeaveForm').reset();
    resetEmployeeDropdown();
    document.getElementById('allocateLeaveModal').classList.add('active');
}

function showApproveModal(requestId) {
    document.getElementById('leaveRequestId').value = requestId;
    document.getElementById('leaveAction').value = 'approve';
    document.getElementById('leaveActionTitle').textContent = 'Approve Leave Request';
    document.getElementById('confirmActionBtn').className = 'btn btn-primary';
    document.getElementById('confirmActionBtn').textContent = 'Approve';
    document.getElementById('actionComments').value = '';
    document.getElementById('leaveActionModal').classList.add('active');
}

function showRejectModal(requestId) {
    document.getElementById('leaveRequestId').value = requestId;
    document.getElementById('leaveAction').value = 'reject';
    document.getElementById('leaveActionTitle').textContent = 'Reject Leave Request';
    document.getElementById('confirmActionBtn').className = 'btn btn-danger';
    document.getElementById('confirmActionBtn').textContent = 'Reject';
    document.getElementById('actionComments').value = '';
    document.getElementById('leaveActionModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Calculate leave days
function calculateLeaveDays() {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const halfDay = document.getElementById('halfDay').value;

    if (!fromDate || !toDate) {
        document.getElementById('leaveDays').value = '0';
        return;
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);

    if (to < from) {
        document.getElementById('leaveDays').value = '0';
        return;
    }

    let days = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;

    if (halfDay && from.getTime() === to.getTime()) {
        days = 0.5;
    }

    document.getElementById('leaveDays').value = days;
}

// Submit functions
async function submitLeaveApplication() {
    const form = document.getElementById('applyLeaveForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const data = {
            leave_type_id: document.getElementById('leaveType').value,
            start_date: document.getElementById('fromDate').value,
            end_date: document.getElementById('toDate').value,
            half_day_type: document.getElementById('halfDay').value || null,
            reason: document.getElementById('leaveReason').value,
            contact_during_leave: document.getElementById('emergencyContact').value || null
        };

        await api.request('/hrms/leave/requests', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        closeModal('applyLeaveModal');
        showToast('Leave application submitted successfully', 'success');
        await loadMyLeaveRequests();
        await loadMyLeaveBalance();
        hideLoading();
    } catch (error) {
        console.error('Error submitting leave:', error);
        showToast(error.message || 'Failed to submit leave application', 'error');
        hideLoading();
    }
}

async function saveLeaveType() {
    const form = document.getElementById('leaveTypeForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('leaveTypeId').value;
        const data = {
            leave_name: document.getElementById('typeName').value,
            leave_code: document.getElementById('typeCode').value,
            description: document.getElementById('typeDescription').value,
            default_days_per_year: parseInt(document.getElementById('defaultDays').value),
            max_consecutive_days: parseInt(document.getElementById('maxDaysPerRequest').value) || null,
            carry_forward_enabled: document.getElementById('carryForward').value === 'true',
            max_carry_forward_days: parseInt(document.getElementById('maxCarryForward').value) || 0,
            is_paid: document.getElementById('isPaid').value === 'true',
            requires_approval: document.getElementById('requiresApproval').value === 'true',
            allow_half_day: document.getElementById('allowHalfDay').value === 'true',
            prorate_on_joining: document.getElementById('prorateOnJoining').value === 'true',
            is_active: document.getElementById('typeIsActive').value === 'true'
        };

        if (id) {
            data.id = id;
            await api.request(`/hrms/leave-types/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/leave-types', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('leaveTypeModal');
        showToast(`Leave type ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadLeaveTypes();
        hideLoading();
    } catch (error) {
        console.error('Error saving leave type:', error);
        showToast(error.message || 'Failed to save leave type', 'error');
        hideLoading();
    }
}

async function saveLeaveAllocation() {
    const form = document.getElementById('allocateLeaveForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();

        const allocatedDays = parseFloat(document.getElementById('allocDays').value);
        const carryForwardDays = parseFloat(document.getElementById('allocCarryForward').value) || 0;
        const notes = document.getElementById('allocNotes').value;

        // Build request for the balances/adjust endpoint
        const data = {
            employee_id: document.getElementById('allocEmployee').value,
            leave_type_id: document.getElementById('allocLeaveType').value,
            year: parseInt(document.getElementById('allocYear').value),
            days: allocatedDays,
            adjustment_type: 'credit',
            reason: notes || 'Manual allocation by HR'
        };

        await api.request('/hrms/leave-types/balances/adjust', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        // If carry forward days are specified, make a second request
        if (carryForwardDays > 0) {
            const carryForwardData = {
                employee_id: document.getElementById('allocEmployee').value,
                leave_type_id: document.getElementById('allocLeaveType').value,
                year: parseInt(document.getElementById('allocYear').value),
                days: carryForwardDays,
                adjustment_type: 'carry_forward',
                reason: notes || 'Carry forward allocation by HR'
            };

            await api.request('/hrms/leave-types/balances/adjust', {
                method: 'POST',
                body: JSON.stringify(carryForwardData)
            });
        }

        closeModal('allocateLeaveModal');
        showToast('Leave allocated successfully', 'success');
        await loadLeaveBalances();
        hideLoading();
    } catch (error) {
        console.error('Error allocating leave:', error);
        showToast(error.message || 'Failed to allocate leave', 'error');
        hideLoading();
    }
}

async function confirmLeaveAction() {
    const requestId = document.getElementById('leaveRequestId').value;
    const action = document.getElementById('leaveAction').value;
    const comments = document.getElementById('actionComments').value;

    try {
        showLoading();
        await api.request(`/hrms/leave/approve`, {
            method: 'POST',
            body: JSON.stringify({ leave_request_id: requestId, approve: action === 'approve', rejection_reason: comments })
        });

        closeModal('leaveActionModal');
        showToast(`Leave request ${action === 'approve' ? 'approved' : 'rejected'} successfully`, 'success');
        await loadPendingRequests();
        hideLoading();
    } catch (error) {
        console.error('Error processing leave action:', error);
        showToast(error.message || `Failed to ${action} leave request`, 'error');
        hideLoading();
    }
}

async function cancelLeaveRequest(requestId) {
    const confirmed = await Confirm.show({
        title: 'Cancel Leave Request',
        message: 'Are you sure you want to cancel this leave request?',
        type: 'warning',
        confirmText: 'Cancel Request',
        cancelText: 'Keep'
    });
    if (!confirmed) return;

    try {
        showLoading();
        await api.request(`/hrms/leave/requests/${requestId}`, {
            method: 'DELETE'
        });
        showToast('Leave request cancelled', 'success');
        await loadMyLeaveRequests();
        await loadMyLeaveBalance();
        hideLoading();
    } catch (error) {
        console.error('Error cancelling leave:', error);
        showToast(error.message || 'Failed to cancel leave request', 'error');
        hideLoading();
    }
}

async function viewLeaveDetails(requestId) {
    try {
        showLoading();
        const leave = await api.request(`/hrms/leave/requests/${requestId}`);

        // Support both snake_case (backend) and camelCase property names
        const employeeName = leave.employee_name || leave.employeeName || 'N/A';
        const leaveTypeName = leave.leave_type_name || leave.leaveTypeName || 'N/A';
        const fromDate = leave.start_date || leave.fromDate;
        const toDate = leave.end_date || leave.toDate;
        const numberOfDays = leave.total_days || leave.numberOfDays || 'N/A';
        const halfDayType = leave.half_day_type || leave.halfDayType || null;
        const reason = leave.reason || '';
        const status = leave.status || 'pending';
        const appliedOn = leave.created_at || leave.appliedOn;
        const approvedBy = leave.approved_by || leave.approvedBy;
        const approverName = leave.approver_name || leave.approverName;
        const approvedOn = leave.approved_at || leave.approvedOn;
        const comments = leave.rejection_reason || leave.comments;
        const contactDuringLeave = leave.contact_during_leave || leave.contactDuringLeave;

        document.getElementById('leaveDetails').innerHTML = `
            <div class="leave-detail-card">
                <div class="leave-detail-header">
                    <div class="leave-type-badge">${leaveTypeName}</div>
                    <span class="status-badge status-${status.toLowerCase()}">${status}</span>
                </div>

                <div class="leave-detail-grid">
                    <div class="leave-detail-row">
                        <div class="leave-detail-item">
                            <span class="detail-label">Employee</span>
                            <span class="detail-value">${employeeName}</span>
                        </div>
                        <div class="leave-detail-item">
                            <span class="detail-label">Duration</span>
                            <span class="detail-value">${numberOfDays} day${numberOfDays !== 1 ? 's' : ''}</span>
                        </div>
                    </div>

                    <div class="leave-detail-row">
                        <div class="leave-detail-item">
                            <span class="detail-label">From Date</span>
                            <span class="detail-value">${formatDate(fromDate)}</span>
                        </div>
                        <div class="leave-detail-item">
                            <span class="detail-label">To Date</span>
                            <span class="detail-value">${formatDate(toDate)}</span>
                        </div>
                    </div>

                    <div class="leave-detail-row">
                        <div class="leave-detail-item">
                            <span class="detail-label">Half Day</span>
                            <span class="detail-value">${halfDayType ? (halfDayType === 'first' ? 'First Half' : 'Second Half') : 'No'}</span>
                        </div>
                        <div class="leave-detail-item">
                            <span class="detail-label">Applied On</span>
                            <span class="detail-value">${formatDateTime(appliedOn)}</span>
                        </div>
                    </div>

                    <div class="leave-detail-row full-width">
                        <div class="leave-detail-item">
                            <span class="detail-label">Reason</span>
                            <span class="detail-value reason-text">${reason || '-'}</span>
                        </div>
                    </div>

                    ${contactDuringLeave ? `
                    <div class="leave-detail-row full-width">
                        <div class="leave-detail-item">
                            <span class="detail-label">Contact During Leave</span>
                            <span class="detail-value">${contactDuringLeave}</span>
                        </div>
                    </div>
                    ` : ''}

                    ${approvedBy ? `
                    <div class="leave-detail-divider"></div>
                    <div class="leave-detail-row">
                        <div class="leave-detail-item">
                            <span class="detail-label">${status.toLowerCase() === 'approved' ? 'Approved' : 'Reviewed'} By</span>
                            <span class="detail-value">${approverName || approvedBy}</span>
                        </div>
                        <div class="leave-detail-item">
                            <span class="detail-label">${status.toLowerCase() === 'approved' ? 'Approved' : 'Reviewed'} On</span>
                            <span class="detail-value">${formatDateTime(approvedOn)}</span>
                        </div>
                    </div>
                    ` : ''}

                    ${comments ? `
                    <div class="leave-detail-row full-width">
                        <div class="leave-detail-item">
                            <span class="detail-label">${status.toLowerCase() === 'rejected' ? 'Rejection Reason' : 'Comments'}</span>
                            <span class="detail-value reason-text">${comments}</span>
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Show/hide the View Calculation button based on whether calculation log is available
        const footer = document.getElementById('leaveDetailsFooter');
        const hasCalculationLog = leave.day_calculation_log && (
            leave.day_calculation_log.daily_breakdown?.length > 0 ||
            leave.day_calculation_log.dailyBreakdown?.length > 0
        );

        if (hasCalculationLog) {
            footer.style.display = 'flex';
            footer.innerHTML = `
                <button type="button" class="btn btn-outline" onclick="viewLeaveCalculationBreakdown('${leave.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    View Calculation Details
                </button>
            `;
        } else {
            footer.style.display = 'none';
        }

        document.getElementById('viewLeaveModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading leave details:', error);
        showToast('Failed to load leave details', 'error');
        hideLoading();
    }
}

async function viewLeaveCalculationBreakdown(requestId) {
    try {
        showLoading();
        const leave = await api.request(`/hrms/leave/requests/${requestId}`);

        const log = leave.day_calculation_log;
        if (!log) {
            showToast('No calculation details available for this leave request', 'info');
            hideLoading();
            return;
        }

        // Support both snake_case and camelCase
        const totalDays = log.total_days ?? log.totalDays ?? 0;
        const workingDays = log.working_days ?? log.workingDays ?? 0;
        const weekendDays = log.weekend_days ?? log.weekendDays ?? 0;
        const holidayDays = log.holiday_days ?? log.holidayDays ?? 0;
        const hasMultipleOffices = log.has_multiple_offices ?? log.hasMultipleOffices ?? false;
        const dailyBreakdown = log.daily_breakdown ?? log.dailyBreakdown ?? [];

        // Update summary stats
        document.getElementById('calcTotalDays').textContent = totalDays;
        document.getElementById('calcWorkingDays').textContent = workingDays;
        document.getElementById('calcWeekendDays').textContent = weekendDays;
        document.getElementById('calcHolidayDays').textContent = holidayDays;

        // Show multi-location indicator if applicable
        document.getElementById('multiLocationIndicator').style.display = hasMultipleOffices ? 'flex' : 'none';

        // Render day-by-day breakdown
        const calendarEl = document.getElementById('calculationCalendar');

        if (dailyBreakdown.length === 0) {
            calendarEl.innerHTML = '<p class="no-data-message">No day-by-day breakdown available</p>';
        } else {
            calendarEl.innerHTML = dailyBreakdown.map(day => {
                const date = day.date;
                const isWeekend = day.is_weekend ?? day.isWeekend ?? false;
                const isHoliday = day.is_holiday ?? day.isHoliday ?? false;
                const isWorkingDay = day.is_working_day ?? day.isWorkingDay ?? false;
                const reason = day.reason ?? '';
                const officeName = day.office_name ?? day.officeName ?? '';
                const shiftName = day.shift_name ?? day.shiftName ?? '';
                const effectiveWeekendDays = day.effective_weekend_days ?? day.effectiveWeekendDays ?? [];

                let dayClass = '';
                if (isWorkingDay) dayClass = 'working';
                else if (isHoliday) dayClass = 'holiday';
                else if (isWeekend) dayClass = 'weekend';

                return `
                    <div class="calc-day ${dayClass}">
                        <div class="day-date">${formatShortDate(date)}</div>
                        <div class="day-name">${getDayName(date)}</div>
                        <div class="day-status">${isWorkingDay ? '✓ Counted' : '✗ Not Counted'}</div>
                        <div class="day-reason">${escapeHtml(reason) || (isHoliday ? 'Holiday' : (isWeekend ? 'Weekend' : ''))}</div>
                        <div class="day-details">
                            ${officeName ? `<small>Office: ${escapeHtml(officeName)}</small>` : ''}
                            ${shiftName ? `<small>Shift: ${escapeHtml(shiftName)}</small>` : ''}
                            ${effectiveWeekendDays.length > 0 ? `<small>Weekend: ${effectiveWeekendDays.join(', ')}</small>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Close the details modal and open the calculation modal
        closeModal('viewLeaveModal');
        document.getElementById('leaveCalculationModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading calculation breakdown:', error);
        showToast('Failed to load calculation details', 'error');
        hideLoading();
    }
}

function formatShortDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDayName(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'short' });
}

async function viewEmployeeBalance(employeeId) {
    try {
        showLoading();
        const year = document.getElementById('balanceYear')?.value || new Date().getFullYear();

        // Fetch employee's leave balances
        const response = await api.request(`/hrms/leave-types/balances?year=${year}&employeeId=${employeeId}`);
        const balances = Array.isArray(response) ? response : (response?.data || []);

        if (balances.length === 0) {
            showToast('No leave balance data found for this employee', 'info');
            hideLoading();
            return;
        }

        // Get employee info from first balance record
        const employeeName = balances[0]?.employee_name || 'Unknown Employee';
        const departmentName = balances[0]?.department_name || '-';

        // Build balance cards HTML
        const balanceCardsHtml = balances.map(balance => {
            const leaveTypeName = balance.leave_type_name || balance.leaveTypeName || 'Unknown';
            const leaveTypeCode = balance.leave_type_code || balance.leaveTypeCode || '';
            const totalDays = balance.total_days ?? balance.totalDays ?? 0;
            const usedDays = balance.used_days ?? balance.usedDays ?? 0;
            const pendingDays = balance.pending_days ?? balance.pendingDays ?? 0;
            const availableDays = balance.available_days ?? balance.availableDays ?? (totalDays - usedDays - pendingDays);
            const carryForward = balance.carry_forward_days ?? balance.carryForwardDays ?? 0;

            // Calculate percentage for progress bar
            const usedPercent = totalDays > 0 ? Math.min((usedDays / totalDays) * 100, 100) : 0;
            const pendingPercent = totalDays > 0 ? Math.min((pendingDays / totalDays) * 100, 100) : 0;

            return `
                <div class="balance-card">
                    <div class="balance-card-header">
                        <span class="leave-type-name">${leaveTypeName}</span>
                        <span class="leave-type-code">${leaveTypeCode}</span>
                    </div>
                    <div class="balance-card-body">
                        <div class="balance-main">
                            <span class="balance-available">${availableDays}</span>
                            <span class="balance-total">/ ${totalDays} days</span>
                        </div>
                        <div class="balance-progress">
                            <div class="progress-bar">
                                <div class="progress-used" style="width: ${usedPercent}%"></div>
                                <div class="progress-pending" style="width: ${pendingPercent}%; left: ${usedPercent}%"></div>
                            </div>
                        </div>
                        <div class="balance-breakdown">
                            <div class="breakdown-item">
                                <span class="breakdown-label">Used</span>
                                <span class="breakdown-value used">${usedDays}</span>
                            </div>
                            <div class="breakdown-item">
                                <span class="breakdown-label">Pending</span>
                                <span class="breakdown-value pending">${pendingDays}</span>
                            </div>
                            ${carryForward > 0 ? `
                            <div class="breakdown-item">
                                <span class="breakdown-label">Carry Fwd</span>
                                <span class="breakdown-value carry">${carryForward}</span>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Check if employee has profile photo
        const userId = balances[0]?.user_id;
        const profilePhotoUrl = userId ? `${CONFIG.authApiBaseUrl}/api/users/${userId}/photo` : null;

        document.getElementById('employeeBalanceDetails').innerHTML = `
            <div class="employee-balance-card compact">
                <div class="employee-balance-header compact">
                    ${profilePhotoUrl ?
                        `<img src="${profilePhotoUrl}" class="employee-avatar-img-modal" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" alt="${employeeName}">
                         <div class="employee-avatar-modal" style="display:none;">${getInitials(employeeName)}</div>` :
                        `<div class="employee-avatar-modal">${getInitials(employeeName)}</div>`
                    }
                    <div class="employee-info-modal">
                        <span class="employee-name-modal">${employeeName}</span>
                        <span class="department-badge-modal">${departmentName}</span>
                    </div>
                    <div class="year-badge-modal">${year}</div>
                </div>
                <div class="balance-cards-grid compact">
                    ${balanceCardsHtml}
                </div>
            </div>
        `;

        document.getElementById('viewEmployeeBalanceModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading employee balance:', error);
        showToast('Failed to load employee balance details', 'error');
        hideLoading();
    }
}

// Utility functions
function formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

function truncate(text, length) {
    if (!text) return '';
    return text.length > length ? text.substring(0, length) + '...' : text;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// Local showToast removed - using unified toast.js instead

// Search handlers
document.getElementById('leaveTypeSearch')?.addEventListener('input', updateLeaveTypesTable);
document.getElementById('myLeaveYear')?.addEventListener('change', loadMyLeaveRequests);
document.getElementById('myLeaveStatus')?.addEventListener('change', loadMyLeaveRequests);
document.getElementById('requestStatus')?.addEventListener('change', loadPendingRequests);
document.getElementById('requestDepartment')?.addEventListener('change', loadPendingRequests);
document.getElementById('balanceYear')?.addEventListener('change', loadLeaveBalances);
document.getElementById('balanceDepartment')?.addEventListener('change', loadLeaveBalances);

// ==========================================
// Leave Encashment Functions
// ==========================================

let encashableBalances = [];
let dailyRate = 0;

async function showEncashLeaveModal() {
    try {
        showLoading();
        document.getElementById('encashLeaveForm').reset();

        // Load encashable leave balance
        const balances = await api.getEncashableLeaveBalance();
        encashableBalances = balances || [];

        // Populate leave type dropdown with encashable types only
        const select = document.getElementById('encashLeaveType');
        select.innerHTML = '<option value="">Select Leave Type</option>';

        if (encashableBalances.length === 0) {
            document.getElementById('encashBalanceInfo').innerHTML = `
                <div class="alert alert-info">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span>No leave types are available for encashment at this time.</span>
                </div>
            `;
        } else {
            encashableBalances.forEach(b => {
                if (b.encashable_days > 0) {
                    select.innerHTML += `<option value="${b.leave_type_id}" data-balance="${b.encashable_days}" data-rate="${b.daily_rate || 0}">${b.leave_type_name} (${b.encashable_days} days available)</option>`;
                }
            });

            document.getElementById('encashBalanceInfo').innerHTML = `
                <div class="alert alert-success">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>You have leave balance available for encashment.</span>
                </div>
            `;
        }

        document.getElementById('encashAvailableDays').textContent = 'Available: 0 days';
        document.getElementById('encashAmountPreview').textContent = '--';

        openModal('encashLeaveModal');
        hideLoading();
    } catch (error) {
        console.error('Error loading encashable balance:', error);
        showToast('Failed to load encashable leave balance', 'error');
        hideLoading();
    }
}

function updateEncashPreview() {
    const select = document.getElementById('encashLeaveType');
    const selectedOption = select.options[select.selectedIndex];
    const daysInput = document.getElementById('encashDays');

    if (!selectedOption || !selectedOption.value) {
        document.getElementById('encashAvailableDays').textContent = 'Available: 0 days';
        document.getElementById('encashAmountPreview').textContent = '--';
        return;
    }

    const availableDays = parseFloat(selectedOption.dataset.balance) || 0;
    dailyRate = parseFloat(selectedOption.dataset.rate) || 0;

    document.getElementById('encashAvailableDays').textContent = `Available: ${availableDays} days`;
    daysInput.max = availableDays;

    const days = parseFloat(daysInput.value) || 0;
    if (days > 0 && dailyRate > 0) {
        const estimatedAmount = days * dailyRate;
        document.getElementById('encashAmountPreview').textContent = formatCurrency(estimatedAmount);
    } else if (days > 0) {
        document.getElementById('encashAmountPreview').textContent = 'Rate not configured';
    } else {
        document.getElementById('encashAmountPreview').textContent = '--';
    }
}

async function submitLeaveEncashment() {
    const form = document.getElementById('encashLeaveForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const leaveTypeId = document.getElementById('encashLeaveType').value;
    const days = parseFloat(document.getElementById('encashDays').value);
    const reason = document.getElementById('encashReason').value;

    if (!leaveTypeId) {
        showToast('Please select a leave type', 'error');
        return;
    }

    if (!days || days <= 0) {
        showToast('Please enter valid number of days', 'error');
        return;
    }

    try {
        showLoading();
        await api.encashLeave({
            leave_type_id: leaveTypeId,
            days: days,
            reason: reason
        });

        closeModal('encashLeaveModal');
        showToast('Leave encashment request submitted successfully', 'success');
        await loadMyLeaveRequests();
        hideLoading();
    } catch (error) {
        console.error('Error submitting encashment:', error);
        showToast(error.message || 'Failed to submit encashment request', 'error');
        hideLoading();
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
}

// ==========================================
// Team Calendar Functions
// ==========================================

let calendarData = [];
let calendarInitialized = false;

function initializeTeamCalendar() {
    if (!calendarInitialized) {
        // Set default month to current month
        const now = new Date();
        const monthInput = document.getElementById('calendarMonth');
        if (monthInput) {
            monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        // Populate department filter
        const deptSelect = document.getElementById('calendarDepartment');
        if (deptSelect && departments.length > 0) {
            deptSelect.innerHTML = '<option value="">All Departments</option>';
            departments.forEach(d => {
                deptSelect.innerHTML += `<option value="${d.id}">${d.department_name || d.name}</option>`;
            });
        }

        calendarInitialized = true;
    }

    loadTeamCalendar();
}

async function loadTeamCalendar() {
    const monthInput = document.getElementById('calendarMonth');
    const deptSelect = document.getElementById('calendarDepartment');

    if (!monthInput || !monthInput.value) {
        return;
    }

    const [year, month] = monthInput.value.split('-');
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${month}-${lastDay}`;
    const departmentId = deptSelect?.value || null;

    try {
        showLoading();
        const data = await api.getTeamLeaveCalendar(startDate, endDate, departmentId);
        calendarData = data || [];
        renderTeamCalendar(parseInt(year), parseInt(month));
        hideLoading();
    } catch (error) {
        console.error('Error loading team calendar:', error);
        showToast('Failed to load team calendar', 'error');
        hideLoading();
    }
}

function renderTeamCalendar(year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

    // Render calendar header (days of week)
    const headerHtml = `
        <div class="calendar-weekdays">
            <div class="weekday">Sun</div>
            <div class="weekday">Mon</div>
            <div class="weekday">Tue</div>
            <div class="weekday">Wed</div>
            <div class="weekday">Thu</div>
            <div class="weekday">Fri</div>
            <div class="weekday">Sat</div>
        </div>
    `;
    document.getElementById('calendarHeader').innerHTML = headerHtml;

    // Build calendar grid
    let gridHtml = '<div class="calendar-days">';

    // Empty cells for days before the first day of month
    for (let i = 0; i < firstDayOfWeek; i++) {
        gridHtml += '<div class="calendar-day empty"></div>';
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const leavesOnDay = getLeaveEntriesForDate(dateStr);
        const isWeekend = new Date(year, month - 1, day).getDay() === 0 || new Date(year, month - 1, day).getDay() === 6;

        gridHtml += `
            <div class="calendar-day ${isWeekend ? 'weekend' : ''} ${leavesOnDay.length > 0 ? 'has-leaves' : ''}">
                <div class="day-number">${day}</div>
                <div class="day-leaves">
                    ${leavesOnDay.slice(0, 3).map(l => `
                        <div class="leave-entry ${l.status?.toLowerCase()}" title="${l.employee_name}: ${l.leave_type_name}">
                            <span class="leave-employee">${getInitials(l.employee_name)}</span>
                        </div>
                    `).join('')}
                    ${leavesOnDay.length > 3 ? `<div class="leave-entry more">+${leavesOnDay.length - 3}</div>` : ''}
                </div>
            </div>
        `;
    }

    gridHtml += '</div>';
    document.getElementById('calendarGrid').innerHTML = gridHtml;
}

function getLeaveEntriesForDate(dateStr) {
    const date = new Date(dateStr);
    return calendarData.filter(leave => {
        const fromDate = new Date(leave.from_date);
        const toDate = new Date(leave.to_date);
        return date >= fromDate && date <= toDate;
    });
}

// ==========================================
// Sidebar Setup
// ==========================================

function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('organizationSidebar');
    const container = document.querySelector('.hrms-container');

    if (!toggle || !sidebar) return;

    // Open sidebar by default on page load
    toggle.classList.add('active');
    sidebar.classList.add('open');
    container?.classList.add('sidebar-open');

    // Toggle sidebar open/close
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
    });

    // Collapsible nav groups
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.nav-group');
            if (group) {
                group.classList.toggle('collapsed');
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
