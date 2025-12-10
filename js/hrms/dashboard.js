// HRMS Dashboard JavaScript
let userRole = 'HRMS_USER';
let currentEmployee = null;
let isClockedIn = false;
let isSetupComplete = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadNavigation();

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Determine user role
    const user = api.getUser();
    if (user && user.roles) {
        if (user.roles.includes('SUPERADMIN') || user.roles.includes('HRMS_ADMIN')) {
            userRole = 'HRMS_ADMIN';
        } else if (user.roles.includes('HRMS_MANAGER')) {
            userRole = 'HRMS_MANAGER';
        }
    }

    // Start clock
    updateClock();
    setInterval(updateClock, 1000);

    // Check organization setup status first
    await checkSetupStatus();

    // Load dashboard data
    await loadDashboard();
});

async function checkSetupStatus() {
    try {
        const status = await api.request('/hrms/dashboard/setup-status');
        isSetupComplete = status.is_setup_complete;

        // Check if we have at least basic organization setup (office, department, designation, shift)
        // Payroll should be accessible even if salary structures aren't set up yet
        hasBasicSetup = status.has_office && status.has_department &&
                        status.has_designation && status.has_shift;

        if (!isSetupComplete) {
            // Show warning banner
            const banner = document.getElementById('setupWarningBanner');
            const message = document.getElementById('setupWarningMessage');
            const missingList = document.getElementById('setupMissingItems');

            if (banner) {
                banner.style.display = 'flex';
            }

            if (message && status.setup_message) {
                message.textContent = status.setup_message;
            }

            if (missingList && status.missing_items && status.missing_items.length > 0) {
                missingList.innerHTML = status.missing_items.map(item => `<li>${item}</li>`).join('');
            }

            // Disable cards that require full setup
            const cardsToDisable = ['cardEmployees', 'cardAttendance', 'cardLeave', 'cardReports'];
            cardsToDisable.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) {
                    card.classList.add('disabled');
                }
            });

            // Payroll should be accessible when basic organization is set up
            // (office, department, designation, shift) so users can create salary structures
            const payrollCard = document.getElementById('cardPayroll');
            if (payrollCard) {
                if (hasBasicSetup) {
                    payrollCard.classList.remove('disabled');
                } else {
                    payrollCard.classList.add('disabled');
                }
            }
        } else {
            // Hide warning banner if visible
            const banner = document.getElementById('setupWarningBanner');
            if (banner) {
                banner.style.display = 'none';
            }

            // Enable all cards
            const cardsToEnable = ['cardEmployees', 'cardAttendance', 'cardLeave', 'cardPayroll', 'cardReports'];
            cardsToEnable.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) {
                    card.classList.remove('disabled');
                }
            });
        }
    } catch (error) {
        console.error('Error checking setup status:', error);
        // If error, assume setup is complete to not block users
        isSetupComplete = true;
    }
}

// Track if basic setup is complete (for Payroll access)
let hasBasicSetup = false;

function navigateIfSetupComplete(page) {
    // Allow payroll navigation if basic setup is done (office, department, designation, shift)
    if (page === 'payroll.html' && hasBasicSetup) {
        navigateTo(page);
        return;
    }

    if (!isSetupComplete) {
        showToast('Please complete organization setup first', 'error');
        return;
    }
    navigateTo(page);
}

function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const timeEl = document.getElementById('currentTime');
    const dateEl = document.getElementById('currentDate');
    if (timeEl) timeEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
}

async function loadDashboard() {
    try {
        // Check if user has an employee profile (including admins who are also employees)
        let hasEmployeeProfile = false;
        try {
            const profileResult = await api.request('/hrms/self-service/my-profile');
            if (profileResult && profileResult.id) {
                hasEmployeeProfile = true;
                currentEmployee = profileResult;
            }
        } catch (e) {
            // User doesn't have an employee profile - that's okay
            console.log('User has no employee profile');
        }

        // Show clock section for ANY user with an employee profile
        if (hasEmployeeProfile || userRole === 'HRMS_USER') {
            document.getElementById('clockSection').style.display = 'block';
            await loadEmployeeAttendance();
        }

        // Load stats based on role
        if (userRole === 'HRMS_ADMIN' || userRole === 'HRMS_MANAGER') {
            await loadAdminStats();
        } else {
            await loadEmployeeStats();
        }

        // Load common sections
        await loadRecentLeaveRequests();
        await loadUpcomingEvents();

    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Error loading dashboard data', 'error');
    }
}

async function loadAdminStats() {
    try {
        // Load employees count
        const employees = await api.request('/hrms/employees?includeInactive=false');
        const employeeList = Array.isArray(employees) ? employees : (employees?.data || []);
        document.getElementById('totalEmployees').textContent = employeeList.length || 0;

        // Load departments
        const departments = await api.request('/hrms/departments');
        const deptList = Array.isArray(departments) ? departments : (departments?.data || []);
        document.getElementById('totalDepartments').textContent = deptList.length || 0;

        // Load offices
        const offices = await api.request('/hrms/offices');
        const officeList = Array.isArray(offices) ? offices : (offices?.data || []);
        document.getElementById('totalOffices').textContent = officeList.length || 0;

        // Load pending leave approvals count
        try {
            const pendingLeave = await api.request('/hrms/leave/pending-approvals');
            const pendingList = Array.isArray(pendingLeave) ? pendingLeave : (pendingLeave?.data || []);
            document.getElementById('pendingApprovals').textContent = pendingList.length || 0;
        } catch (e) {
            document.getElementById('pendingApprovals').textContent = '-';
        }

        // Attendance stats would come from dashboard API
        document.getElementById('presentToday').textContent = '-';
        document.getElementById('onLeave').textContent = '-';

    } catch (error) {
        console.error('Error loading admin stats:', error);
    }
}

async function loadEmployeeStats() {
    try {
        // Load current employee's dashboard data
        const dashboardData = await api.request('/hrms/self-service/dashboard');
        if (dashboardData) {
            currentEmployee = dashboardData.employee;
        }

        // Update stats for employee view
        document.getElementById('totalEmployees').textContent = '-';
        document.getElementById('presentToday').textContent = '-';
        document.getElementById('onLeave').textContent = '-';
        document.getElementById('totalDepartments').textContent = '-';
        document.getElementById('totalOffices').textContent = '-';
        document.getElementById('pendingApprovals').textContent = '-';

    } catch (error) {
        console.error('Error loading employee stats:', error);
    }
}

async function loadEmployeeAttendance() {
    try {
        const today = await api.request('/hrms/attendance/today');
        if (today && today.check_in_time) {
            isClockedIn = !today.check_out_time;
            updateClockUI(today);
        }
    } catch (error) {
        console.error('Error loading attendance:', error);
    }
}

function updateClockUI(attendance) {
    const clockBtn = document.getElementById('clockBtn');
    const clockInfo = document.getElementById('clockInfo');

    if (attendance && attendance.check_in_time) {
        const checkIn = new Date(attendance.check_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        if (attendance.check_out_time) {
            const checkOut = new Date(attendance.check_out_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            clockInfo.textContent = `Checked in: ${checkIn} | Checked out: ${checkOut}`;
            clockBtn.textContent = 'Completed';
            clockBtn.disabled = true;
            clockBtn.classList.remove('clock-in');
            clockBtn.classList.add('clock-out');
        } else {
            clockInfo.textContent = `Checked in at ${checkIn}`;
            clockBtn.textContent = 'Clock Out';
            clockBtn.classList.remove('clock-in');
            clockBtn.classList.add('clock-out');
            isClockedIn = true;
        }
    } else {
        clockInfo.textContent = 'Not checked in yet';
        clockBtn.textContent = 'Clock In';
        clockBtn.classList.remove('clock-out');
        clockBtn.classList.add('clock-in');
        isClockedIn = false;
    }
}

async function handleClock() {
    try {
        if (isClockedIn) {
            const result = await api.request('/hrms/attendance/clock-out', {
                method: 'POST',
                body: JSON.stringify({})
            });
            showToast('Clocked out successfully', 'success');
            updateClockUI(result);
        } else {
            const result = await api.request('/hrms/attendance/clock-in', {
                method: 'POST',
                body: JSON.stringify({})
            });
            showToast('Clocked in successfully', 'success');
            updateClockUI(result);
        }
    } catch (error) {
        showToast(error.message || 'Clock operation failed', 'error');
    }
}

async function loadRecentLeaveRequests() {
    const tbody = document.getElementById('recentLeaveRequests');
    try {
        // For admin/manager, show pending approvals
        // For employee, show their own requests
        let requests = [];

        if (userRole === 'HRMS_ADMIN' || userRole === 'HRMS_MANAGER') {
            const response = await api.request('/hrms/leave/pending-approvals');
            requests = Array.isArray(response) ? response : (response?.data || []);
        } else {
            const response = await api.request('/hrms/leave/requests');
            requests = Array.isArray(response) ? response : (response?.data || []);
        }

        if (!requests || requests.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <p style="color: #888; font-size: 0.85rem;">No leave requests found</p>
                    </td>
                </tr>
            `;
            return;
        }

        // Show only recent 5
        const recentRequests = requests.slice(0, 5);

        tbody.innerHTML = recentRequests.map(req => `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-avatar">${getInitials(req.employee_name || 'User')}</div>
                        <div>
                            <div class="employee-name">${req.employee_name || 'Employee'}</div>
                        </div>
                    </div>
                </td>
                <td>${req.leave_type_name || '-'}</td>
                <td>${formatDate(req.start_date)}</td>
                <td>${formatDate(req.end_date)}</td>
                <td>${req.number_of_days || '-'}</td>
                <td><span class="status-badge ${req.status || 'pending'}">${capitalizeFirst(req.status || 'pending')}</span></td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading leave requests:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <p style="color: #888; font-size: 0.85rem;">Unable to load leave requests</p>
                </td>
            </tr>
        `;
    }
}

async function loadUpcomingEvents() {
    const holidaysContainer = document.getElementById('upcomingHolidays');
    const birthdaysContainer = document.getElementById('upcomingBirthdays');

    try {
        // Load upcoming holidays for current year
        const holidays = await api.request(`/hrms/holidays?year=${new Date().getFullYear()}`);
        const holidayList = Array.isArray(holidays) ? holidays : (holidays?.data || []);

        // Filter for upcoming holidays only
        const today = new Date();
        const upcomingHolidays = holidayList
            .filter(h => new Date(h.holiday_date) >= today)
            .sort((a, b) => new Date(a.holiday_date) - new Date(b.holiday_date))
            .slice(0, 5);

        if (upcomingHolidays.length > 0) {
            holidaysContainer.innerHTML = upcomingHolidays.map(h => `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.04);">
                    <span style="font-size: 0.85rem;">${h.holiday_name}</span>
                    <span style="font-size: 0.8rem; color: #888;">${formatDate(h.holiday_date)}</span>
                </div>
            `).join('');
        } else {
            holidaysContainer.innerHTML = '<p style="color: #888; font-size: 0.85rem;">No upcoming holidays</p>';
        }
    } catch (error) {
        holidaysContainer.innerHTML = '<p style="color: #888; font-size: 0.85rem;">Unable to load holidays</p>';
    }

    // Birthdays feature - show placeholder for now (requires backend API)
    birthdaysContainer.innerHTML = '<p style="color: #888; font-size: 0.85rem;">Feature coming soon</p>';
}

function refreshDashboard() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('loading');
    loadDashboard().finally(() => {
        btn.classList.remove('loading');
    });
}

function navigateTo(page) {
    window.location.href = page;
}

// Utility functions
function getInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${type === 'success'
                ? '<polyline points="20 6 9 17 4 12"/>'
                : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
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
