let userRole = 'HRMS_USER';

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('hrms', '../');

    const user = api.getUser();
    if (user && user.roles) {
        if (user.roles.includes('SUPERADMIN') || user.roles.includes('HRMS_ADMIN')) {
            userRole = 'HRMS_ADMIN';
        } else if (user.roles.includes('HRMS_MANAGER')) {
            userRole = 'HRMS_MANAGER';
        }
    }

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

function switchTab(tabName) {
    document.querySelectorAll('.hrms-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`${tabName}Tab`).classList.add('active');

    switch(tabName) {
        case 'daily': loadAttendance(); break;
        case 'myAttendance': loadMyAttendance(); break;
        case 'regularization': loadRegularizations(); break;
        case 'overtime': loadOvertimeRequests(); break;
    }
}

async function loadAttendance() {
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '<tr><td colspan="6"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const date = document.getElementById('dateFilter').value;
        // Note: For admin view, we need a team attendance endpoint
        // Using report endpoint for now
        const attendance = await api.getAttendanceReport(date, date) || [];

        let present = 0, absent = 0, late = 0, onLeave = 0;

        if (!attendance || attendance.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No attendance records for this date</p></td></tr>';
            updateDailyStats(0, 0, 0, 0);
            return;
        }

        attendance.forEach(a => {
            if (a.status === 'present') present++;
            else if (a.status === 'absent') absent++;
            if (a.is_late) late++;
            if (a.status === 'leave') onLeave++;
        });

        updateDailyStats(present, absent, late, onLeave);

        tbody.innerHTML = attendance.map(a => `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-avatar">${getInitials(a.employee_name)}</div>
                        <div class="employee-name">${a.employee_name || 'Employee'}</div>
                    </div>
                </td>
                <td>${formatTime(a.check_in_time)}</td>
                <td>${formatTime(a.check_out_time)}</td>
                <td>${a.working_hours ? a.working_hours.toFixed(1) + 'h' : '-'}</td>
                <td><span class="status-badge ${a.status}">${capitalizeFirst(a.status)}</span></td>
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
        const lateDays = history.filter(a => a.is_late).length;
        const totalHours = history.reduce((sum, a) => sum + (a.working_hours || 0), 0);

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
                <td>${formatDate(a.attendance_date)}</td>
                <td>${formatTime(a.check_in_time)}</td>
                <td>${formatTime(a.check_out_time)}</td>
                <td>${a.working_hours ? a.working_hours.toFixed(1) + 'h' : '-'}</td>
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
                <td>${r.reason || '-'}</td>
                <td><span class="status-badge ${r.status}">${capitalizeFirst(r.status)}</span></td>
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
    tbody.innerHTML = '<tr><td colspan="6"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        // Note: Overtime feature not yet implemented in backend
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Overtime tracking coming soon</p></td></tr>';
    } catch (error) {
        console.error('Error loading overtime:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Error loading requests</p></td></tr>';
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
            attendance_date: date,
            check_in_time: `${date}T${checkIn}:00`,
            check_out_time: `${date}T${checkOut}:00`,
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
    const task = document.getElementById('otTask').value;

    if (!date || !startTime || !endTime || !reason) {
        showToast('Please fill all required fields', 'error');
        return;
    }

    // Note: Overtime feature not yet implemented in backend
    showToast('Overtime feature coming soon', 'info');
    closeModal('overtimeModal');
}

// Utility functions
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
    document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
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
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
