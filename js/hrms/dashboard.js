// HRMS Dashboard JavaScript
let currentEmployee = null;
let isClockedIn = false;
let isSetupComplete = false;
let isComplianceComplete = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadNavigation();

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Initialize RBAC
    hrmsRoles.init();

    // Auto-redirect basic users (HRMS_USER only) to Self-Service portal
    if (hrmsRoles.isBasicUser()) {
        window.location.href = 'self-service.html';
        return;
    }

    // Apply RBAC visibility
    applyDashboardRBAC();

    // Start clock
    updateClock();
    setInterval(updateClock, 1000);

    // Check organization setup status first
    await checkSetupStatus();

    // Load dashboard data
    await loadDashboard();
});

/**
 * Apply RBAC visibility to dashboard elements
 */
function applyDashboardRBAC() {
    // Setup warning banner - only show to HR admins
    hrmsRoles.setElementVisibility('setupWarningBanner', hrmsRoles.isHRAdmin());

    // Stats grid - show org stats only to HR users and above
    const statsGrid = document.getElementById('statsGrid');
    if (statsGrid) {
        // For basic users, hide org-level stats (they can still see the grid but values will be '-')
        if (hrmsRoles.isBasicUser()) {
            statsGrid.style.display = 'none';
        }
    }

    // Quick action cards visibility based on role
    // Organization - only HR users
    hrmsRoles.setElementVisibility('cardOrganization', hrmsRoles.canAccessOrganization());

    // Employees - HR users and managers
    hrmsRoles.setElementVisibility('cardEmployees', hrmsRoles.canAccessEmployees());

    // Payroll admin section - HR users only (basic users can still see own payslips via self-service)
    const payrollCard = document.getElementById('cardPayroll');
    if (payrollCard) {
        if (!hrmsRoles.canViewAllPayroll() && !hrmsRoles.isManager()) {
            // For basic users, change onclick to go to self-service payslips
            payrollCard.onclick = function() { navigateTo('self-service.html#payslips'); };
        }
    }

    // Reports - HR users and managers only
    hrmsRoles.setElementVisibility('cardReports', hrmsRoles.canAccessReports());

    // Attendance - all users can view (own or team)
    // But change behavior based on role
    const attendanceCard = document.getElementById('cardAttendance');
    if (attendanceCard && hrmsRoles.isBasicUser()) {
        // For basic users, go to self-service attendance
        attendanceCard.onclick = function() { navigateTo('self-service.html#attendance'); };
    }

    // Leave - all users can access (own or team)
    const leaveCard = document.getElementById('cardLeave');
    if (leaveCard && hrmsRoles.isBasicUser()) {
        // For basic users, go to self-service leave
        leaveCard.onclick = function() { navigateTo('self-service.html#leave'); };
    }

    console.log('Dashboard RBAC applied:', hrmsRoles.getDebugInfo());
}

async function checkSetupStatus() {
    try {
        const status = await api.request('/hrms/dashboard/setup-status');
        isSetupComplete = status.is_setup_complete;
        isComplianceComplete = status.is_compliance_complete;

        // Check if we have at least basic organization setup (office, department, designation, shift)
        // Payroll should be accessible even if salary structures aren't set up yet
        hasBasicSetup = status.has_office && status.has_department &&
                        status.has_designation && status.has_shift;

        const banner = document.getElementById('setupWarningBanner');
        const message = document.getElementById('setupWarningMessage');
        const missingList = document.getElementById('setupMissingItems');

        // STEP 1: Check Compliance First (MUST be complete before organization setup)
        if (!isComplianceComplete) {
            // Show compliance warning banner
            if (banner) {
                banner.style.display = 'flex';
                banner.classList.add('compliance-warning');
            }

            if (message) {
                message.textContent = status.compliance_message || 'Please complete the Compliance section first before setting up the organization.';
            }

            if (missingList && status.compliance_missing_items && status.compliance_missing_items.length > 0) {
                missingList.innerHTML = status.compliance_missing_items.map(item => `<li>${item}</li>`).join('');
            }

            // Disable ALL cards except Compliance until compliance is done
            const cardsToDisable = ['cardOrganization', 'cardEmployees', 'cardAttendance', 'cardLeave', 'cardPayroll', 'cardReports'];
            cardsToDisable.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) {
                    card.classList.add('disabled');
                }
            });

            // Enable Compliance card - it should always be accessible
            const complianceCard = document.getElementById('cardCompliance');
            if (complianceCard) {
                complianceCard.classList.remove('disabled');
                complianceCard.classList.add('highlight-action');
            }

            // Update the "Complete Setup" button to go to compliance page
            const setupButton = document.getElementById('setupActionButton');
            if (setupButton) {
                setupButton.setAttribute('onclick', "navigateTo('compliance.html')");
            }

            return; // Don't check organization setup if compliance is not complete
        }

        // STEP 2: Check Organization Setup (only if compliance is complete)
        if (!isSetupComplete) {
            // Show organization setup warning banner
            if (banner) {
                banner.style.display = 'flex';
                banner.classList.remove('compliance-warning');
            }

            if (message && status.setup_message) {
                message.textContent = status.setup_message;
            }

            if (missingList && status.missing_items && status.missing_items.length > 0) {
                missingList.innerHTML = status.missing_items.map(item => `<li>${item}</li>`).join('');
            }

            // Enable Compliance card (it's complete)
            const complianceCard = document.getElementById('cardCompliance');
            if (complianceCard) {
                complianceCard.classList.remove('disabled');
                complianceCard.classList.remove('highlight-action');
            }

            // Enable Organization card - this is what needs to be done next
            const organizationCard = document.getElementById('cardOrganization');
            if (organizationCard) {
                organizationCard.classList.remove('disabled');
                organizationCard.classList.add('highlight-action');
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
            const payrollCard = document.getElementById('cardPayroll');
            if (payrollCard) {
                if (hasBasicSetup) {
                    payrollCard.classList.remove('disabled');
                } else {
                    payrollCard.classList.add('disabled');
                }
            }
        } else {
            // STEP 3: Everything is complete!
            // Hide warning banner if visible
            if (banner) {
                banner.style.display = 'none';
            }

            // Enable all cards and remove highlight
            const cardsToEnable = ['cardCompliance', 'cardOrganization', 'cardEmployees', 'cardAttendance', 'cardLeave', 'cardPayroll', 'cardReports'];
            cardsToEnable.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) {
                    card.classList.remove('disabled');
                    card.classList.remove('highlight-action');
                }
            });
        }
    } catch (error) {
        console.error('Error checking setup status:', error);
        // If error, assume setup is NOT complete - disable cards that require setup
        isSetupComplete = false;
        isComplianceComplete = false;
        hasBasicSetup = false;

        // Disable cards that require setup (except compliance which should always work)
        const cardsToDisable = ['cardOrganization', 'cardEmployees', 'cardAttendance', 'cardLeave', 'cardReports', 'cardPayroll'];
        cardsToDisable.forEach(cardId => {
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.add('disabled');
            }
        });

        // Show warning banner
        const banner = document.getElementById('setupWarningBanner');
        if (banner) {
            banner.style.display = 'flex';
        }
        const message = document.getElementById('setupWarningMessage');
        if (message) {
            message.textContent = 'Please complete Compliance and Organization setup before accessing other features.';
        }
    }
}

// Track if basic setup is complete (for Payroll access)
let hasBasicSetup = false;

function navigateIfSetupComplete(page) {
    // Compliance is always accessible
    if (page === 'compliance.html') {
        navigateTo(page);
        return;
    }

    // Check compliance first
    if (!isComplianceComplete) {
        showToast('Please complete Compliance setup first', 'error');
        // Redirect to compliance page
        navigateTo('compliance.html');
        return;
    }

    // Allow organization navigation once compliance is done
    if (page === 'organization.html') {
        navigateTo(page);
        return;
    }

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
            // User doesn't have an employee profile - that's okay for admin users
            console.log('User has no employee profile (admin user)');
        }

        // Show clock section for ANY user with an employee profile
        const clockSection = document.getElementById('clockSection');
        if (clockSection && (hasEmployeeProfile || hrmsRoles.isBasicUser())) {
            clockSection.style.display = 'block';
            await loadEmployeeAttendance();
        }

        // Load stats based on role
        // HR users and managers can see org-level stats
        if (hrmsRoles.isHRUser() || hrmsRoles.isManager()) {
            await loadAdminStats();
        } else {
            await loadEmployeeStats();
        }

        // Load common sections only if DOM elements exist
        const leaveRequestsEl = document.getElementById('recentLeaveRequests');
        if (leaveRequestsEl) {
            await loadRecentLeaveRequests();
        }

        const holidaysEl = document.getElementById('upcomingHolidays');
        if (holidaysEl) {
            await loadUpcomingEvents();
        }

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

        // Load today's attendance stats
        try {
            const today = new Date().toISOString().split('T')[0];
            const teamAttendance = await api.request(`/hrms/attendance/team?date=${today}`);
            const attendanceList = Array.isArray(teamAttendance) ? teamAttendance : (teamAttendance?.data || []);

            // Count present employees (those with check_in_time)
            const presentCount = attendanceList.filter(a => a.check_in_time).length;
            document.getElementById('presentToday').textContent = presentCount;
        } catch (e) {
            console.log('Could not load attendance stats:', e);
            document.getElementById('presentToday').textContent = '0';
        }

        // Load today's approved leave count
        try {
            const today = new Date().toISOString().split('T')[0];
            const leaveRequests = await api.request(`/hrms/leave-types/requests?startDate=${today}&endDate=${today}&status=approved`);
            const leaveList = Array.isArray(leaveRequests) ? leaveRequests : (leaveRequests?.data || []);
            document.getElementById('onLeave').textContent = leaveList.length || 0;
        } catch (e) {
            console.log('Could not load leave stats:', e);
            document.getElementById('onLeave').textContent = '0';
        }

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
        // API returns { has_checked_in, has_checked_out, record: { check_in_time, ... } }
        if (today && today.has_checked_in && today.record) {
            isClockedIn = !today.has_checked_out;
            updateClockUI(today.record);
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
    if (!tbody) return; // Element removed from page

    try {
        // For HR users/manager, show pending approvals
        // For basic employee, show their own requests
        let requests = [];

        if (hrmsRoles.canApproveLeave()) {
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
                        <p class="text-muted" style="font-size: 0.85rem;">No leave requests found</p>
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
                    <p class="text-muted" style="font-size: 0.85rem;">Unable to load leave requests</p>
                </td>
            </tr>
        `;
    }
}

async function loadUpcomingEvents() {
    const holidaysContainer = document.getElementById('upcomingHolidays');
    const birthdaysContainer = document.getElementById('upcomingBirthdays');

    // Elements removed from page
    if (!holidaysContainer && !birthdaysContainer) return;

    if (holidaysContainer) {
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
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color-light);">
                        <span style="font-size: 0.85rem;">${h.holiday_name}</span>
                        <span class="text-muted" style="font-size: 0.8rem;">${formatDate(h.holiday_date)}</span>
                    </div>
                `).join('');
            } else {
                holidaysContainer.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">No upcoming holidays</p>';
            }
        } catch (error) {
            holidaysContainer.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Unable to load holidays</p>';
        }
    }

    // Birthdays feature - show placeholder for now (requires backend API)
    if (birthdaysContainer) {
        birthdaysContainer.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Feature coming soon</p>';
    }
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

// Local showToast removed - using unified toast.js instead

// ============================================
// SignalR Real-Time Event Handlers
// ============================================

/**
 * Called when an employee is updated (from hrms-signalr.js)
 */
function onEmployeeUpdated(data) {
    console.log('[Dashboard] Employee updated:', data);
    // Refresh dashboard stats
    loadDashboard();
}

/**
 * Called when a new employee is created (from hrms-signalr.js)
 */
function onEmployeeCreated(data) {
    console.log('[Dashboard] Employee created:', data);
    // Don't show toast here - the creator already sees a toast from saveEmployee()
    // This handler is for refreshing dashboard stats when other users create employees
    loadDashboard();
}

/**
 * Called when attendance is updated (from hrms-signalr.js)
 */
function onAttendanceUpdated(data) {
    console.log('[Dashboard] Attendance updated:', data);
    // Refresh dashboard to update attendance stats
    loadDashboard();
}

/**
 * Called when a leave request is updated (from hrms-signalr.js)
 */
function onLeaveRequestUpdated(data) {
    console.log('[Dashboard] Leave request updated:', data);
    // Refresh dashboard to update leave stats
    loadDashboard();
}

/**
 * Called when organization structure is updated (from hrms-signalr.js)
 */
function onOrganizationUpdated(data) {
    console.log('[Dashboard] Organization updated:', data);
    // Refresh dashboard to update org stats
    loadDashboard();
}
