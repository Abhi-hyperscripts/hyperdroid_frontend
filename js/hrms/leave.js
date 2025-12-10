let currentUser = null;
let isAdmin = false;
let isSuperAdmin = false;
let isManager = false;
let leaveTypes = [];
let employees = [];
let departments = [];

document.addEventListener('DOMContentLoaded', async function() {
    await loadNavigation();
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

        isSuperAdmin = currentUser.roles?.includes('SUPERADMIN');
        isAdmin = currentUser.roles?.includes('HRMS_ADMIN') || isSuperAdmin;
        isManager = currentUser.roles?.includes('HRMS_MANAGER');

        // Show/hide admin elements
        if (isAdmin) {
            document.getElementById('adminActions').style.display = 'flex';
            document.getElementById('leaveTypesTab').style.display = 'block';
            document.getElementById('allocateBtn').style.display = 'inline-flex';
        }

        if (isAdmin || isManager) {
            document.getElementById('leaveRequestsTab').style.display = 'block';
        }

        // Setup tabs
        setupTabs();

        // Load initial data
        await Promise.all([
            loadLeaveTypes(),
            loadMyLeaveRequests(),
            loadDepartments()
        ]);

        if (isAdmin || isManager) {
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

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;

            // Update active states
            tabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');

            // Load data for tab
            if (tabId === 'leave-balance' && (isAdmin || isManager)) {
                loadLeaveBalances();
            }
        });
    });
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
                leaveTypes.filter(t => t.isActive).forEach(type => {
                    select.innerHTML += `<option value="${type.id}">${type.name}</option>`;
                });
            }
        });

        // Update leave types table if admin
        if (isAdmin) {
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
        const response = await api.request('/hrms/leave-balances/my');
        if (response && response.balances) {
            // Update stats
            const balances = response.balances;
            document.getElementById('annualBalance').textContent =
                balances.find(b => b.leaveTypeCode === 'AL')?.availableBalance ?? 0;
            document.getElementById('sickBalance').textContent =
                balances.find(b => b.leaveTypeCode === 'SL')?.availableBalance ?? 0;
            document.getElementById('casualBalance').textContent =
                balances.find(b => b.leaveTypeCode === 'CL')?.availableBalance ?? 0;
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

        // Update pending count
        const pendingCount = requests.filter(r => r.status === 'Pending').length;
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
            <td>${req.leaveTypeName || 'N/A'}</td>
            <td>${formatDate(req.fromDate)}</td>
            <td>${formatDate(req.toDate)}</td>
            <td>${req.numberOfDays}</td>
            <td class="reason-cell" title="${escapeHtml(req.reason)}">${truncate(req.reason, 30)}</td>
            <td><span class="status-badge status-${req.status?.toLowerCase()}">${req.status}</span></td>
            <td>${formatDate(req.appliedOn)}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewLeaveDetails('${req.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    ${req.status === 'Pending' ? `
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

        // SUPERADMIN and HRMS_ADMIN can see ALL pending requests, not just their direct reports
        if (isAdmin) {
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
        // Determine if current user can approve this request
        // SUPERADMIN can approve anyone (including self)
        // HRMS_ADMIN can approve anyone except self
        // Manager can approve only direct reports (backend handles this filtering)
        const isOwnRequest = req.employeeUserId === currentUser?.userId || req.employeeEmail === currentUser?.email;
        const canApprove = req.status === 'Pending' && (
            isSuperAdmin ||  // SUPERADMIN can approve anyone including self
            (isAdmin && !isOwnRequest) ||  // HRMS_ADMIN can approve anyone except self
            (!isAdmin && isManager)  // Manager - backend already filtered to their direct reports
        );

        return `
        <tr>
            <td class="employee-cell">
                <div class="employee-info">
                    <div class="avatar">${getInitials(req.employeeName)}</div>
                    <div class="details">
                        <span class="name">${req.employeeName}${isOwnRequest ? ' (You)' : ''}</span>
                        <span class="email">${req.employeeEmail || ''}</span>
                    </div>
                </div>
            </td>
            <td>${req.leaveTypeName}</td>
            <td>${formatDate(req.fromDate)}</td>
            <td>${formatDate(req.toDate)}</td>
            <td>${req.numberOfDays}</td>
            <td class="reason-cell" title="${escapeHtml(req.reason)}">${truncate(req.reason, 25)}</td>
            <td><span class="status-badge status-${req.status?.toLowerCase()}">${req.status}</span></td>
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

        let url = `/hrms/leave-balances?year=${year}`;
        if (department) url += `&departmentId=${department}`;

        const response = await api.request(url);
        updateLeaveBalanceTable(response || []);
        hideLoading();
    } catch (error) {
        console.error('Error loading leave balances:', error);
        hideLoading();
    }
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

    tbody.innerHTML = balances.map(emp => `
        <tr>
            <td class="employee-cell">
                <div class="employee-info">
                    <div class="avatar">${getInitials(emp.employeeName)}</div>
                    <div class="details">
                        <span class="name">${emp.employeeName}</span>
                    </div>
                </div>
            </td>
            <td>${emp.departmentName || '-'}</td>
            <td>${emp.annualLeave ?? '-'}</td>
            <td>${emp.sickLeave ?? '-'}</td>
            <td>${emp.casualLeave ?? '-'}</td>
            <td>${emp.compOff ?? '-'}</td>
            <td>${emp.lop ?? '-'}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewEmployeeBalance('${emp.employeeId}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
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
                <td colspan="8">
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
                    select.innerHTML += `<option value="${dept.id}">${dept.name}</option>`;
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

        const select = document.getElementById('allocEmployee');
        if (select) {
            select.innerHTML = '<option value="">Select Employee</option>';
            employees.forEach(emp => {
                select.innerHTML += `<option value="${emp.id}">${emp.firstName} ${emp.lastName}</option>`;
            });
        }
    } catch (error) {
        console.error('Error loading employees:', error);
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
    document.getElementById('typeIsActive').value = type.is_active ? 'true' : 'false';

    document.getElementById('leaveTypeModalTitle').textContent = 'Edit Leave Type';
    document.getElementById('leaveTypeModal').classList.add('active');
}

function showAllocateLeaveModal() {
    document.getElementById('allocateLeaveForm').reset();
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
            leaveTypeId: document.getElementById('leaveType').value,
            fromDate: document.getElementById('fromDate').value,
            toDate: document.getElementById('toDate').value,
            halfDayType: document.getElementById('halfDay').value || null,
            reason: document.getElementById('leaveReason').value,
            emergencyContact: document.getElementById('emergencyContact').value || null
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
        const data = {
            employeeId: document.getElementById('allocEmployee').value,
            leaveTypeId: document.getElementById('allocLeaveType').value,
            year: parseInt(document.getElementById('allocYear').value),
            allocatedDays: parseFloat(document.getElementById('allocDays').value),
            carryForwardDays: parseFloat(document.getElementById('allocCarryForward').value) || 0,
            notes: document.getElementById('allocNotes').value
        };

        await api.request('/hrms/leave-balances/allocate', {
            method: 'POST',
            body: JSON.stringify(data)
        });

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
        showToast(`Leave request ${action}d successfully`, 'success');
        await loadPendingRequests();
        hideLoading();
    } catch (error) {
        console.error('Error processing leave action:', error);
        showToast(error.message || `Failed to ${action} leave request`, 'error');
        hideLoading();
    }
}

async function cancelLeaveRequest(requestId) {
    if (!confirm('Are you sure you want to cancel this leave request?')) return;

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

        document.getElementById('leaveDetails').innerHTML = `
            <div class="detail-grid">
                <div class="detail-item">
                    <label>Employee</label>
                    <span>${leave.employeeName || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <label>Leave Type</label>
                    <span>${leave.leaveTypeName}</span>
                </div>
                <div class="detail-item">
                    <label>From Date</label>
                    <span>${formatDate(leave.fromDate)}</span>
                </div>
                <div class="detail-item">
                    <label>To Date</label>
                    <span>${formatDate(leave.toDate)}</span>
                </div>
                <div class="detail-item">
                    <label>Number of Days</label>
                    <span>${leave.numberOfDays}</span>
                </div>
                <div class="detail-item">
                    <label>Half Day</label>
                    <span>${leave.halfDayType || 'No'}</span>
                </div>
                <div class="detail-item full-width">
                    <label>Reason</label>
                    <span>${leave.reason}</span>
                </div>
                <div class="detail-item">
                    <label>Status</label>
                    <span class="status-badge status-${leave.status?.toLowerCase()}">${leave.status}</span>
                </div>
                <div class="detail-item">
                    <label>Applied On</label>
                    <span>${formatDateTime(leave.appliedOn)}</span>
                </div>
                ${leave.approvedBy ? `
                <div class="detail-item">
                    <label>Approved By</label>
                    <span>${leave.approverName || leave.approvedBy}</span>
                </div>
                <div class="detail-item">
                    <label>Approved On</label>
                    <span>${formatDateTime(leave.approvedOn)}</span>
                </div>
                ` : ''}
                ${leave.comments ? `
                <div class="detail-item full-width">
                    <label>Comments</label>
                    <span>${leave.comments}</span>
                </div>
                ` : ''}
            </div>
        `;

        document.getElementById('viewLeaveModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading leave details:', error);
        showToast('Failed to load leave details', 'error');
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

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Search handlers
document.getElementById('leaveTypeSearch')?.addEventListener('input', updateLeaveTypesTable);
document.getElementById('myLeaveYear')?.addEventListener('change', loadMyLeaveRequests);
document.getElementById('myLeaveStatus')?.addEventListener('change', loadMyLeaveRequests);
document.getElementById('requestStatus')?.addEventListener('change', loadPendingRequests);
document.getElementById('requestDepartment')?.addEventListener('change', loadPendingRequests);
document.getElementById('balanceYear')?.addEventListener('change', loadLeaveBalances);
document.getElementById('balanceDepartment')?.addEventListener('change', loadLeaveBalances);
