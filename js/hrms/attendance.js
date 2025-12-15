let currentUser = null;
let pendingRejectionId = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('hrms', '../');

    // Initialize RBAC
    hrmsRoles.init();
    currentUser = api.getUser();

    // Apply RBAC visibility
    applyAttendanceRBAC();

    // Set default date
    document.getElementById('dateFilter').value = new Date().toISOString().split('T')[0];

    // Populate year filter
    const currentYear = new Date().getFullYear();
    const yearSelect = document.getElementById('yearFilter');
    for (let y = currentYear; y >= currentYear - 5; y--) {
        yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
    }
    document.getElementById('monthFilter').value = new Date().getMonth() + 1;

    await loadAttendance();
});

// Apply RBAC visibility rules for attendance page
function applyAttendanceRBAC() {
    // Daily View tab - visible to HR users, managers, admins (team/org-wide view)
    const dailyTab = document.querySelector('[data-tab="daily"]');
    if (dailyTab) {
        // Users can only see My Attendance tab
        if (!hrmsRoles.isHRUser() && !hrmsRoles.isManager() && !hrmsRoles.isHRAdmin()) {
            dailyTab.style.display = 'none';
        }
    }

    // Approvals tab - visible to managers and HR admins
    const approvalsTab = document.getElementById('approvalsTab');
    if (approvalsTab) {
        if (hrmsRoles.canApproveAttendance()) {
            approvalsTab.style.display = 'inline-block';
        } else {
            approvalsTab.style.display = 'none';
        }
    }

    // If user is basic HRMS_USER, switch to My Attendance tab by default
    if (!hrmsRoles.isHRUser() && !hrmsRoles.isManager() && !hrmsRoles.isHRAdmin()) {
        switchTab('myAttendance');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.hrms-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Handle special case for approvals tab content element
    const tabContentId = tabName === 'approvals' ? 'approvalsTabContent' : `${tabName}Tab`;
    document.getElementById(tabContentId).classList.add('active');

    switch(tabName) {
        case 'daily': loadAttendance(); break;
        case 'myAttendance': loadMyAttendance(); break;
        case 'regularization': loadRegularizations(); break;
        case 'overtime':
            loadOvertimeRequests();
            if (hrmsRoles.isManager() || hrmsRoles.isHRAdmin() || hrmsRoles.isSuperAdmin()) {
                loadPendingOvertimeApprovals();
            }
            break;
        case 'approvals': loadPendingApprovals(); break;
    }
}

async function loadAttendance() {
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '<tr><td colspan="6"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const date = document.getElementById('dateFilter').value;
        // Use team attendance endpoint which returns array of attendance records
        const attendance = await api.request(`/hrms/attendance/team?date=${date}`) || [];

        let present = 0, absent = 0, late = 0, onLeave = 0;

        if (!attendance || attendance.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No attendance records for this date</p></td></tr>';
            updateDailyStats(0, 0, 0, 0);
            return;
        }

        attendance.forEach(a => {
            if (a.status === 'present') present++;
            else if (a.status === 'absent') absent++;
            if (a.late_by_minutes > 0) late++;
            if (a.status === 'leave') onLeave++;
        });

        updateDailyStats(present, absent, late, onLeave);

        tbody.innerHTML = attendance.map(a => `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-avatar">${escapeHtml(getInitials(a.employee_name))}</div>
                        <div class="employee-name">${escapeHtml(a.employee_name) || 'Employee'}</div>
                    </div>
                </td>
                <td>${formatTime(a.check_in_time)}</td>
                <td>${formatTime(a.check_out_time)}</td>
                <td>${a.total_hours ? a.total_hours.toFixed(1) + 'h' : '-'}</td>
                <td><span class="status-badge ${escapeHtml(a.status)}">${capitalizeFirst(a.status)}</span></td>
                <td>${capitalizeFirst(a.attendance_type) || '-'}</td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading attendance:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Error loading attendance</p></td></tr>';
    }
}

function updateDailyStats(present, absent, late, onLeave) {
    document.getElementById('presentCount').textContent = present;
    document.getElementById('absentCount').textContent = absent;
    document.getElementById('lateCount').textContent = late;
    document.getElementById('onLeaveCount').textContent = onLeave;
}

async function loadMyAttendance() {
    const tbody = document.getElementById('myAttendanceTableBody');
    tbody.innerHTML = '<tr><td colspan="5"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const month = document.getElementById('monthFilter').value;
        const year = document.getElementById('yearFilter').value;
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
        const history = await api.getMyAttendance(startDate, endDate);

        // Calculate summary from history
        const presentDays = history.filter(a => a.status === 'present' || a.check_in_time).length;
        const lateDays = history.filter(a => a.late_by_minutes > 0).length;
        const totalHours = history.reduce((sum, a) => sum + (a.total_hours || 0), 0);

        document.getElementById('myWorkingDays').textContent = history.length || '-';
        document.getElementById('myPresentDays').textContent = presentDays || '-';
        document.getElementById('myLateDays').textContent = lateDays || '-';
        document.getElementById('myTotalHours').textContent = totalHours ? totalHours.toFixed(0) : '-';

        if (!history || history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>No attendance records</p></td></tr>';
            return;
        }

        tbody.innerHTML = history.map(a => `
            <tr>
                <td>${formatDate(a.date)}</td>
                <td>${formatTime(a.check_in_time)}</td>
                <td>${formatTime(a.check_out_time)}</td>
                <td>${a.total_hours ? a.total_hours.toFixed(1) + 'h' : '-'}</td>
                <td><span class="status-badge ${a.status}">${capitalizeFirst(a.status)}</span></td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading my attendance:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>Error loading attendance</p></td></tr>';
    }
}

async function loadRegularizations() {
    const tbody = document.getElementById('regularizationTableBody');
    tbody.innerHTML = '<tr><td colspan="6"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const regs = await api.getRegularizationRequests();

        if (!regs || regs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No regularization requests</p></td></tr>';
            return;
        }

        tbody.innerHTML = regs.map(r => `
            <tr>
                <td>${formatDate(r.date)}</td>
                <td>${formatTime(r.requested_check_in)}</td>
                <td>${formatTime(r.requested_check_out)}</td>
                <td>${escapeHtml(r.reason) || '-'}</td>
                <td><span class="status-badge ${escapeHtml(r.status)}">${capitalizeFirst(r.status)}</span></td>
                <td>
                    ${r.status === 'pending' ? `
                        <button class="action-btn danger" onclick="cancelRegularization('${r.id}')" data-tooltip="Cancel">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    ` : '-'}
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading regularizations:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Error loading requests</p></td></tr>';
    }
}

async function loadOvertimeRequests() {
    const tbody = document.getElementById('overtimeTableBody');
    tbody.innerHTML = '<tr><td colspan="7"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const requests = await api.getMyOvertimeRequests();

        if (!requests || requests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>No overtime requests found</p></td></tr>';
            return;
        }

        tbody.innerHTML = requests.map(r => `
            <tr>
                <td>${formatDate(r.date)}</td>
                <td>${formatTime(r.planned_start_time)}</td>
                <td>${formatTime(r.planned_end_time)}</td>
                <td>${r.actual_start_time ? formatTime(r.actual_start_time) : '-'}</td>
                <td>${r.actual_end_time ? formatTime(r.actual_end_time) : '-'}</td>
                <td><span class="status-badge status-${r.status?.toLowerCase()}">${capitalizeFirst(r.status)}</span></td>
                <td>
                    ${r.status?.toLowerCase() === 'approved' ? `
                    <button class="action-btn primary" onclick="openCompleteOvertimeModal('${r.id}')" data-tooltip="Mark Complete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </button>
                    ` : '-'}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading overtime:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Error loading overtime requests</p></td></tr>';
    }
}

async function loadPendingApprovals() {
    const tbody = document.getElementById('pendingRegularizationsTableBody');
    tbody.innerHTML = '<tr><td colspan="6"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        // SUPERADMIN and HRMS_HR_ADMIN can see ALL pending requests
        const pending = await api.getPendingRegularizations(hrmsRoles.isHRAdmin());

        if (!pending || pending.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No pending regularization requests</p></td></tr>';
            return;
        }

        tbody.innerHTML = pending.map(r => {
            // Determine if current user can approve this request
            const isOwnRequest = r.employee_user_id === currentUser?.userId || r.employee_email === currentUser?.email;
            const canApprove = (
                hrmsRoles.isSuperAdmin() ||  // SUPERADMIN can approve anyone including self
                (hrmsRoles.isHRAdmin() && !isOwnRequest) ||  // HR_ADMIN can approve anyone except self
                (!hrmsRoles.isHRAdmin() && hrmsRoles.isManager())  // Manager - backend filters to direct reports
            );

            return `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-avatar">${escapeHtml(getInitials(r.employee_name))}</div>
                        <div class="employee-name">${escapeHtml(r.employee_name) || 'Employee'}${isOwnRequest ? ' (You)' : ''}</div>
                    </div>
                </td>
                <td>${formatDate(r.date)}</td>
                <td>${formatTime(r.requested_check_in)}</td>
                <td>${formatTime(r.requested_check_out)}</td>
                <td>${escapeHtml(r.reason) || '-'}</td>
                <td>
                    ${canApprove ? `
                    <button class="action-btn success" onclick="approveRegularizationRequest('${r.id}')" data-tooltip="Approve">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="openRejectModal('${r.id}')" data-tooltip="Reject">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                    ` : '<span class="text-muted">Cannot approve</span>'}
                </td>
            </tr>
        `}).join('');

    } catch (error) {
        console.error('Error loading pending approvals:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Error loading pending requests</p></td></tr>';
    }
}

async function approveRegularizationRequest(id) {
    try {
        await api.approveRegularization(id);
        showToast('Regularization approved successfully', 'success');
        loadPendingApprovals();
    } catch (error) {
        showToast(error.message || 'Error approving request', 'error');
    }
}

function openRejectModal(id) {
    pendingRejectionId = id;
    document.getElementById('rejectionReason').value = '';
    openModal('rejectionModal');
}

async function confirmRejectRegularization() {
    if (!pendingRejectionId) return;

    const reason = document.getElementById('rejectionReason').value;

    try {
        await api.rejectRegularization(pendingRejectionId, reason);
        showToast('Regularization request rejected', 'success');
        closeModal('rejectionModal');
        pendingRejectionId = null;
        loadPendingApprovals();
    } catch (error) {
        showToast(error.message || 'Error rejecting request', 'error');
    }
}

function openRegularizationModal() {
    document.getElementById('regularizationForm').reset();
    openModal('regularizationModal');
}

function openOvertimeModal() {
    document.getElementById('overtimeForm').reset();
    openModal('overtimeModal');
}

async function submitRegularization() {
    const date = document.getElementById('regDate').value;
    const checkIn = document.getElementById('regCheckIn').value;
    const checkOut = document.getElementById('regCheckOut').value;
    const reason = document.getElementById('regReason').value;

    if (!date || !checkIn || !checkOut || !reason) {
        showToast('Please fill all required fields', 'error');
        return;
    }

    try {
        await api.requestAttendanceRegularization({
            date: date,
            requested_check_in: `${date}T${checkIn}:00`,
            requested_check_out: `${date}T${checkOut}:00`,
            reason: reason
        });

        showToast('Regularization request submitted', 'success');
        closeModal('regularizationModal');
        loadRegularizations();

    } catch (error) {
        showToast(error.message || 'Error submitting request', 'error');
    }
}

async function submitOvertime() {
    const date = document.getElementById('otDate').value;
    const startTime = document.getElementById('otStartTime').value;
    const endTime = document.getElementById('otEndTime').value;
    const reason = document.getElementById('otReason').value;
    const task = document.getElementById('otTask')?.value || '';

    if (!date || !startTime || !endTime || !reason) {
        showToast('Please fill all required fields', 'error');
        return;
    }

    try {
        await api.createOvertimeRequest({
            date: date,
            planned_start_time: `${date}T${startTime}:00`,
            planned_end_time: `${date}T${endTime}:00`,
            reason: reason,
            task_reference: task
        });

        showToast('Overtime request submitted successfully', 'success');
        closeModal('overtimeModal');
        loadOvertimeRequests();
    } catch (error) {
        console.error('Error submitting overtime request:', error);
        showToast(error.message || 'Error submitting overtime request', 'error');
    }
}

// Overtime approval functions
let pendingOvertimeRejectionId = null;

async function loadPendingOvertimeApprovals() {
    const tbody = document.getElementById('pendingOvertimeTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const pending = await api.getPendingOvertimeRequestsAll(hrmsRoles.isHRAdmin());

        if (!pending || pending.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>No pending overtime requests</p></td></tr>';
            return;
        }

        tbody.innerHTML = pending.map(r => {
            const isOwnRequest = r.employee_user_id === currentUser?.userId || r.employee_email === currentUser?.email;
            const canApprove = (
                hrmsRoles.isSuperAdmin() ||
                (hrmsRoles.isHRAdmin() && !isOwnRequest) ||
                (!hrmsRoles.isHRAdmin() && hrmsRoles.isManager())
            );

            return `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-avatar">${escapeHtml(getInitials(r.employee_name))}</div>
                        <div class="employee-name">${escapeHtml(r.employee_name) || 'Employee'}${isOwnRequest ? ' (You)' : ''}</div>
                    </div>
                </td>
                <td>${formatDate(r.date)}</td>
                <td>${formatTime(r.planned_start_time)}</td>
                <td>${formatTime(r.planned_end_time)}</td>
                <td>${escapeHtml(r.reason) || '-'}</td>
                <td>${escapeHtml(r.task_reference) || '-'}</td>
                <td>
                    ${canApprove ? `
                    <button class="action-btn success" onclick="approveOvertimeRequest('${r.id}')" data-tooltip="Approve">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="openOvertimeRejectModal('${r.id}')" data-tooltip="Reject">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                    ` : '<span class="text-muted">Cannot approve</span>'}
                </td>
            </tr>
        `}).join('');

    } catch (error) {
        console.error('Error loading pending overtime approvals:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Error loading pending requests</p></td></tr>';
    }
}

async function approveOvertimeRequest(id) {
    try {
        await api.approveOvertimeRequest(id);
        showToast('Overtime request approved', 'success');
        loadPendingOvertimeApprovals();
    } catch (error) {
        showToast(error.message || 'Error approving request', 'error');
    }
}

function openOvertimeRejectModal(id) {
    pendingOvertimeRejectionId = id;
    document.getElementById('overtimeRejectionReason').value = '';
    openModal('overtimeRejectionModal');
}

async function confirmRejectOvertime() {
    if (!pendingOvertimeRejectionId) return;

    const reason = document.getElementById('overtimeRejectionReason').value;

    try {
        await api.rejectOvertimeRequest(pendingOvertimeRejectionId, reason);
        showToast('Overtime request rejected', 'success');
        closeModal('overtimeRejectionModal');
        pendingOvertimeRejectionId = null;
        loadPendingOvertimeApprovals();
    } catch (error) {
        showToast(error.message || 'Error rejecting request', 'error');
    }
}

// Complete overtime functions
let currentOvertimeId = null;

function openCompleteOvertimeModal(id) {
    currentOvertimeId = id;
    document.getElementById('completeOvertimeForm')?.reset();
    openModal('completeOvertimeModal');
}

async function submitCompleteOvertime() {
    if (!currentOvertimeId) return;

    const actualStartTime = document.getElementById('actualOtStartTime').value;
    const actualEndTime = document.getElementById('actualOtEndTime').value;
    const notes = document.getElementById('completeOtNotes').value;

    if (!actualStartTime || !actualEndTime) {
        showToast('Please fill actual start and end times', 'error');
        return;
    }

    try {
        await api.completeOvertime(currentOvertimeId, actualStartTime, actualEndTime, notes);
        showToast('Overtime marked as complete', 'success');
        closeModal('completeOvertimeModal');
        currentOvertimeId = null;
        loadOvertimeRequests();
    } catch (error) {
        console.error('Error completing overtime:', error);
        showToast(error.message || 'Error completing overtime', 'error');
    }
}

// Utility functions
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
    if (!timeStr) return '-';
    return new Date(timeStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Local showToast removed - using unified toast.js instead
