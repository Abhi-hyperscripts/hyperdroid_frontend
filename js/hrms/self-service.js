/**
 * HRMS Employee Self-Service Dashboard
 * Sidebar-based navigation version
 */

// Global variables
let currentEmployee = null;
let clockInterval = null;
let workingHoursInterval = null;
let clockedIn = false;
let checkInTime = null;
let currentPanel = 'panel-dashboard';

// Payslip variables
let myPayslips = [];
let currentPayslipId = null;

// Panel title mapping
const panelTitles = {
    'panel-dashboard': 'Dashboard',
    'panel-profile': 'My Profile',
    'panel-attendance': 'My Attendance',
    'panel-regularization': 'Regularization',
    'panel-overtime': 'Overtime',
    'panel-leaves': 'My Leaves',
    'panel-leave-balance': 'Leave Balance',
    'panel-holidays': 'Holidays',
    'panel-payslips': 'My Payslips',
    'panel-salary': 'Salary Details',
    'panel-loans': 'Loans & Advances',
    'panel-reimbursements': 'Reimbursements',
    'panel-directory': 'Team Directory',
    'panel-orgchart': 'Org Chart',
    'panel-announcements': 'Announcements',
    'panel-policies': 'Policies'
};

// SearchableDropdown instances
let myLeaveStatusDropdown = null;
let leaveTypeDropdown = null;
let halfDayDropdown = null;
let encashLeaveTypeDropdown = null;
let loanTypeDropdown = null;
let expenseTypeDropdown = null;

// Year dropdown instances
let myLeaveYearDropdown = null;
let holidayYearDropdown = null;
let payslipYearDropdown = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Check authentication
        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }

        // Initialize RBAC
        if (typeof hrmsRoles !== 'undefined') {
            hrmsRoles.init();

            // CRITICAL: Require compliance setup before accessing Self-Service page
            // This prevents users from bypassing setup by directly navigating to URL
            // ESS requires at least compliance setup (employees need to exist in the system)
            const setupComplete = await hrmsRoles.requireComplianceSetup({
                showToast: true,
                redirectUrl: 'compliance.html'
            });
            if (!setupComplete) return;
        }

        // Initialize navigation - use loadNavigation() which auto-detects path
        if (typeof loadNavigation === 'function') {
            await loadNavigation();
        } else if (typeof Navigation !== 'undefined') {
            Navigation.init('hrms', '../');
        }

        // Setup sidebar navigation
        setupSidebar();

        // Setup all year dropdowns dynamically
        setupYearDropdowns();

        // Setup attendance filters
        setupAttendanceFilters();

        // Setup leave filters
        setupLeaveFilters();

        // Start clock display
        startClock();

        // Load dashboard data
        await loadDashboard();

    } catch (error) {
        console.error('Error initializing self-service dashboard:', error);
        showToast('Failed to load dashboard', 'error');
    }
});

// ==========================================
// SIDEBAR NAVIGATION
// ==========================================

/**
 * Setup sidebar navigation and mobile toggle
 */
function setupSidebar() {
    const sidebar = document.getElementById('essSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuToggle = document.getElementById('menuToggleBtn');
    const closeBtn = document.getElementById('sidebarCloseBtn');
    const navBtns = document.querySelectorAll('.ess-nav-btn[data-panel]');
    const actionCards = document.querySelectorAll('.ess-action-card[data-panel]');
    const viewAllBtns = document.querySelectorAll('.ess-view-all-btn[data-panel]');

    // Mobile menu toggle
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            openSidebar();
        });
    }

    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeSidebar();
        });
    }

    // Overlay click to close
    if (overlay) {
        overlay.addEventListener('click', () => {
            closeSidebar();
        });
    }

    // Navigation button clicks
    navBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const panelId = this.dataset.panel;
            switchToPanel(panelId);
            closeSidebar();
        });
    });

    // Quick action cards
    actionCards.forEach(card => {
        card.addEventListener('click', function() {
            const panelId = this.dataset.panel;
            switchToPanel(panelId);
        });
    });

    // View all buttons
    viewAllBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const panelId = this.dataset.panel;
            switchToPanel(panelId);
        });
    });

    // Handle ESC key to close sidebar
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
        }
    });
}

/**
 * Open mobile sidebar
 */
function openSidebar() {
    const sidebar = document.getElementById('essSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Close mobile sidebar
 */
function closeSidebar() {
    const sidebar = document.getElementById('essSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
}

/**
 * Switch to a specific panel
 */
function switchToPanel(panelId) {
    if (!panelId) return;

    // Update nav buttons
    const navBtns = document.querySelectorAll('.ess-nav-btn');
    navBtns.forEach(btn => {
        if (btn.dataset.panel === panelId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update panels
    const panels = document.querySelectorAll('.ess-panel');
    panels.forEach(panel => {
        if (panel.id === panelId) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });

    // Update mobile title
    const mobileTitle = document.getElementById('mobilePageTitle');
    if (mobileTitle) {
        mobileTitle.textContent = panelTitles[panelId] || 'Dashboard';
    }

    // Store current panel
    currentPanel = panelId;

    // Load panel data if needed
    loadPanelData(panelId);

    // Scroll to top
    const mainContent = document.querySelector('.ess-main');
    if (mainContent) {
        mainContent.scrollTop = 0;
    }
}

/**
 * Load data for specific panel when switching
 */
function loadPanelData(panelId) {
    switch (panelId) {
        case 'panel-payslips':
            loadMyPayslips();
            break;
        case 'panel-attendance':
            loadMyAttendance();
            break;
        case 'panel-regularization':
            loadRegularizationRequests();
            break;
        case 'panel-overtime':
            loadOvertimeRequests();
            break;
        case 'panel-leaves':
            loadMyLeaves();
            break;
        case 'panel-leave-balance':
            loadLeaveBalanceDetailed();
            break;
        case 'panel-holidays':
            loadHolidays();
            break;
        case 'panel-profile':
            loadMyProfile();
            break;
        case 'panel-salary':
            loadSalaryDetails();
            break;
        case 'panel-loans':
            loadLoans();
            break;
        case 'panel-reimbursements':
            loadReimbursements();
            break;
        case 'panel-directory':
            loadDirectory();
            break;
        case 'panel-orgchart':
            loadOrgChart();
            break;
        case 'panel-announcements':
            loadAnnouncementsFull();
            break;
        case 'panel-policies':
            loadPolicies();
            break;
    }
}

// ==========================================
// CLOCK FUNCTIONALITY
// ==========================================

/**
 * Start the real-time clock display
 */
function startClock() {
    updateClock();
    clockInterval = setInterval(updateClock, 1000);
}

/**
 * Update clock display
 */
function updateClock() {
    const now = new Date();

    // Update time
    const timeEl = document.getElementById('currentTime');
    if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    }

    // Update date
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    // Update welcome date
    const welcomeDate = document.getElementById('welcomeDate');
    if (welcomeDate) {
        welcomeDate.textContent = now.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    }
}

// ==========================================
// DASHBOARD LOADING
// ==========================================

/**
 * Load dashboard data
 */
async function loadDashboard() {
    try {
        const dashboard = await api.getHrmsDashboard();

        if (dashboard && dashboard.employee) {
            // Store employee data
            currentEmployee = dashboard.employee;

            // Update sidebar profile section
            updateSidebarProfile(dashboard.employee);

            // Update attendance status
            updateAttendanceStatus(dashboard.attendance_today);

            // Update leave balances
            updateLeaveBalances(dashboard.leave_balances);

            // Update pending approvals
            updatePendingApprovals(dashboard.pending_approvals_count || 0);

            // Update notification badge
            updateNotificationBadge(dashboard.unread_notifications || 0);

            // Load additional data
            await Promise.all([
                loadAnnouncements(),
                loadUpcomingHolidays(),
                loadUpcomingBirthdays(),
                loadUpcomingAnniversaries()
            ]);

            // Initialize geofence location cards (shown only when all 3 flags are ON)
            await initGeofenceLocationCards();

            // Show attendance exempt banner if applicable
            updateAttendanceExemptBanner(dashboard.employee);

            // Show admin link if applicable
            checkAdminAccess();
        } else {
            // User doesn't have an employee profile
            showNoEmployeeProfile();
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);

        // Check if error is about missing employee profile
        if (error.message && (error.message.includes('Employee') || error.message.includes('not found'))) {
            showNoEmployeeProfile();
        } else {
            showToast('Failed to load dashboard data', 'error');
        }
    }
}

/**
 * Update sidebar profile section
 */
function updateSidebarProfile(employee) {
    if (!employee) return;

    // Get name - support both full_name and first_name/last_name formats
    const displayName = employee.full_name?.trim() ||
                       `${employee.first_name || ''} ${employee.last_name || ''}`.trim() ||
                       'Employee';

    // Update photo
    const photoContainer = document.getElementById('employeePhoto');
    const photoInitials = document.getElementById('photoInitials');
    const photoImg = document.getElementById('photoImg');

    if (employee.profile_photo_url) {
        if (photoImg) {
            photoImg.src = employee.profile_photo_url;
            photoImg.alt = displayName;
            photoImg.style.display = 'block';
        }
        if (photoInitials) {
            photoInitials.style.display = 'none';
        }
    } else {
        // Extract initials from display name
        const nameParts = displayName.split(' ').filter(p => p);
        const initials = nameParts.length >= 2
            ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
            : (nameParts[0]?.[0] || 'E').toUpperCase();
        if (photoInitials) {
            photoInitials.textContent = initials;
            photoInitials.style.display = 'flex';
        }
        if (photoImg) {
            photoImg.style.display = 'none';
        }
    }

    // Update name
    const nameEl = document.getElementById('employeeName');
    if (nameEl) {
        nameEl.textContent = displayName;
    }

    // Update role - support both designation and designation_name
    const roleEl = document.getElementById('employeeRole');
    if (roleEl) {
        roleEl.textContent = employee.designation || employee.designation_name || 'Employee';
    }

    // Update department - support both department and department_name
    const deptEl = document.getElementById('employeeDept');
    if (deptEl) {
        deptEl.textContent = employee.department || employee.department_name || '';
    }
}

/**
 * Show message when user doesn't have an employee profile
 */
function showNoEmployeeProfile() {
    // Update sidebar profile
    const nameEl = document.getElementById('employeeName');
    if (nameEl) {
        nameEl.textContent = 'Not Linked';
    }

    const roleEl = document.getElementById('employeeRole');
    if (roleEl) {
        roleEl.textContent = 'No employee profile';
    }

    const deptEl = document.getElementById('employeeDept');
    if (deptEl) {
        deptEl.textContent = 'Contact HR';
    }

    // Update leave balances with N/A
    const casualEl = document.getElementById('casualLeaveBalance');
    const sickEl = document.getElementById('sickLeaveBalance');
    const earnedEl = document.getElementById('earnedLeaveBalance');
    if (casualEl) casualEl.textContent = 'N/A';
    if (sickEl) sickEl.textContent = 'N/A';
    if (earnedEl) earnedEl.textContent = 'N/A';

    // Disable clock button
    const clockBtn = document.getElementById('clockBtn');
    if (clockBtn) {
        clockBtn.disabled = true;
        clockBtn.classList.add('disabled');
    }

    const clockBtnText = document.getElementById('clockBtnText');
    if (clockBtnText) {
        clockBtnText.textContent = 'No Profile';
    }

    // Update clock status badge
    const statusBadge = document.getElementById('clockStatusBadge');
    if (statusBadge) {
        statusBadge.textContent = 'Not Linked';
        statusBadge.classList.add('not-linked');
    }

    // Show helpful message
    showToast('Your account is not linked to an employee profile. Please contact HR.', 'warning');

    // Still check admin access
    checkAdminAccess();

    // Still load announcements and holidays
    loadAnnouncements();
    loadUpcomingHolidays();
}

/**
 * Get greeting based on time of day
 */
function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

/**
 * Get initials from name
 */
function getInitials(firstName, lastName) {
    const first = firstName ? firstName.charAt(0).toUpperCase() : '';
    const last = lastName ? lastName.charAt(0).toUpperCase() : '';
    return first + last || '--';
}

// ==========================================
// ATTENDANCE STATUS
// ==========================================

/**
 * Update attendance status section
 */
function updateAttendanceStatus(attendance) {
    const statusBadge = document.getElementById('clockStatusBadge');
    const btnText = document.getElementById('clockBtnText');
    const btn = document.getElementById('clockBtn');
    const checkInTimeEl = document.getElementById('checkInTime');
    const workingHoursEl = document.getElementById('workingHours');

    if (attendance && attendance.check_in_time) {
        clockedIn = true;
        checkInTime = new Date(attendance.check_in_time);

        // Update status badge
        if (statusBadge) {
            if (attendance.check_out_time) {
                statusBadge.textContent = 'Clocked Out';
                statusBadge.className = 'ess-clock-status clocked-out';
            } else {
                statusBadge.textContent = 'Working';
                statusBadge.className = 'ess-clock-status clocked-in';
            }
        }

        // Update button
        if (btn && btnText) {
            if (attendance.check_out_time) {
                btn.disabled = true;
                btnText.textContent = 'Day Complete';
                btn.classList.add('disabled');
            } else {
                btnText.textContent = 'Clock Out';
                btn.classList.add('clock-out');
            }
        }

        // Update check-in time
        if (checkInTimeEl) {
            const formattedTime = checkInTime.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            checkInTimeEl.textContent = `Check-in: ${formattedTime}`;
        }

        // Start working hours counter if not checked out
        if (!attendance.check_out_time) {
            startWorkingHoursCounter();
        } else {
            // Show final working hours
            if (workingHoursEl && attendance.working_hours) {
                workingHoursEl.textContent = `Working: ${formatHours(attendance.working_hours)}`;
            }
        }
    } else {
        clockedIn = false;
        checkInTime = null;

        if (statusBadge) {
            statusBadge.textContent = 'Not Clocked In';
            statusBadge.className = 'ess-clock-status';
        }

        if (btnText) {
            btnText.textContent = 'Clock In';
        }

        if (btn) {
            btn.classList.remove('clock-out', 'disabled');
            btn.disabled = false;
        }

        if (checkInTimeEl) {
            checkInTimeEl.textContent = 'Check-in: --:--';
        }

        if (workingHoursEl) {
            workingHoursEl.textContent = 'Working: -- hrs';
        }
    }
}

/**
 * Update attendance exempt banner visibility
 * Shows informational banner for employees exempt from attendance tracking for payroll
 */
function updateAttendanceExemptBanner(employee) {
    const banner = document.getElementById('attendanceExemptBanner');
    if (!banner) return;

    // Show banner if employee is attendance exempt
    if (employee && employee.is_attendance_exempt) {
        banner.style.display = 'flex';
        console.log('[Self-Service] Employee is attendance exempt - showing info banner');
    } else {
        banner.style.display = 'none';
    }
}

/**
 * Start working hours counter
 */
function startWorkingHoursCounter() {
    updateWorkingHours();
    workingHoursInterval = setInterval(updateWorkingHours, 60000); // Update every minute
}

/**
 * Update working hours display
 */
function updateWorkingHours() {
    if (!checkInTime) return;

    const now = new Date();
    const diffMs = now - checkInTime;
    const hours = diffMs / (1000 * 60 * 60);

    const workingHoursEl = document.getElementById('workingHours');
    if (workingHoursEl) {
        workingHoursEl.textContent = `Working: ${formatHours(hours)}`;
    }
}

/**
 * Format hours display
 */
function formatHours(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
}

/**
 * Handle clock in/out
 */
async function handleClock() {
    const btn = document.getElementById('clockBtn');
    if (btn.disabled) return;

    try {
        btn.disabled = true;

        // Get current location
        let location = null;
        try {
            location = await getCurrentLocation();
        } catch (e) {
            console.warn('Could not get location:', e);
        }

        if (clockedIn) {
            // Clock out
            // v3.0.52: Pass accuracy and device_type for location confidence tracking
            const result = await api.hrmsClockOut({
                latitude: location?.latitude,
                longitude: location?.longitude,
                accuracy: location?.accuracy,
                device_type: getDeviceType(),
                source: 'web'
            });

            showToast('Clocked out successfully', 'success');

            // Update UI
            const statusBadge = document.getElementById('clockStatusBadge');
            if (statusBadge) {
                statusBadge.textContent = 'Clocked Out';
                statusBadge.className = 'ess-clock-status clocked-out';
            }

            const btnText = document.getElementById('clockBtnText');
            if (btnText) {
                btnText.textContent = 'Day Complete';
            }

            btn.classList.add('disabled');

            // Stop working hours counter
            if (workingHoursInterval) {
                clearInterval(workingHoursInterval);
            }

            // Update working hours
            if (result && result.working_hours) {
                const workingHoursEl = document.getElementById('workingHours');
                if (workingHoursEl) {
                    workingHoursEl.textContent = `Working: ${formatHours(result.working_hours)}`;
                }
            }

        } else {
            // Clock in
            // v3.0.52: Pass accuracy and device_type for location confidence tracking
            const result = await api.hrmsClockIn({
                latitude: location?.latitude,
                longitude: location?.longitude,
                accuracy: location?.accuracy,
                device_type: getDeviceType(),
                source: 'web',
                attendance_type: 'office'
            });

            showToast('Clocked in successfully', 'success');

            // Update UI
            clockedIn = true;
            checkInTime = new Date();

            const statusBadge = document.getElementById('clockStatusBadge');
            if (statusBadge) {
                statusBadge.textContent = 'Working';
                statusBadge.className = 'ess-clock-status clocked-in';
            }

            const btnText = document.getElementById('clockBtnText');
            if (btnText) {
                btnText.textContent = 'Clock Out';
            }

            btn.classList.add('clock-out');
            btn.disabled = false;

            // Update check-in time display
            const checkInTimeEl = document.getElementById('checkInTime');
            if (checkInTimeEl) {
                const formattedTime = checkInTime.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });
                checkInTimeEl.textContent = `Check-in: ${formattedTime}`;
            }

            // Start working hours counter
            startWorkingHoursCounter();
        }

    } catch (error) {
        console.error('Clock error:', error);
        showToast(error.message || 'Failed to clock in/out', 'error');
        btn.disabled = false;
    }
}

/**
 * Get current location
 */
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                reject(error);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

/**
 * v3.0.52: Detect device type for location confidence tracking.
 *
 * Returns: 'mobile' | 'tablet' | 'desktop'
 *
 * Desktop devices have unreliable GPS (often 500m-1km city-level accuracy).
 * The backend uses this to:
 * - Cap desktop confidence at LOW (never HIGH)
 * - Apply advisory-only geofence checks for desktops
 */
function getDeviceType() {
    const userAgent = navigator.userAgent.toLowerCase();

    // Check for mobile devices
    const mobileKeywords = ['android', 'iphone', 'ipod', 'blackberry', 'windows phone', 'mobile'];
    const isMobile = mobileKeywords.some(keyword => userAgent.includes(keyword));

    // Check for tablets
    const tabletKeywords = ['ipad', 'tablet', 'kindle', 'playbook'];
    const isTablet = tabletKeywords.some(keyword => userAgent.includes(keyword)) ||
        (userAgent.includes('android') && !userAgent.includes('mobile'));

    if (isTablet) return 'tablet';
    if (isMobile) return 'mobile';
    return 'desktop';
}

/**
 * v3.0.52: Calculate and display location confidence based on accuracy and device type.
 * This mirrors the backend logic in BusinessLayer_Attendance.cs
 * @param {number|null} accuracy - GPS accuracy in meters
 * @returns {Object} - { confidence: string, reason: string }
 */
function calculateLocationConfidence(accuracy) {
    const deviceType = getDeviceType();
    const isDesktop = deviceType === 'desktop';

    // No location data
    if (!accuracy || accuracy === null) {
        return { confidence: 'NONE', reason: 'No location data' };
    }

    // Desktop devices ALWAYS capped at LOW confidence (advisory only)
    if (isDesktop) {
        let reason;
        if (accuracy <= 50) {
            reason = 'Desktop (capped)';
        } else if (accuracy <= 150) {
            reason = 'Desktop (capped)';
        } else if (accuracy <= 500) {
            reason = 'WiFi location';
        } else {
            reason = 'WiFi (weak)';
        }
        return { confidence: 'LOW', reason: reason };
    }

    // Mobile/Tablet devices - full confidence levels
    if (accuracy <= 50) {
        return { confidence: 'HIGH', reason: 'GPS (precise)' };
    } else if (accuracy <= 150) {
        return { confidence: 'MEDIUM', reason: 'GPS (normal)' };
    } else if (accuracy <= 500) {
        return { confidence: 'LOW', reason: 'WiFi location' };
    } else {
        return { confidence: 'WEAK', reason: 'WiFi (weak)' };
    }
}

/**
 * v3.0.52: Update the confidence indicator in the UI
 * @param {number|null} accuracy - GPS accuracy in meters
 */
function updateLocationConfidenceUI(accuracy) {
    const section = document.getElementById('locationConfidenceSection');
    const badge = document.getElementById('locationConfidenceBadge');
    const reason = document.getElementById('locationConfidenceReason');

    if (!section || !badge || !reason) return;

    const { confidence, reason: reasonText } = calculateLocationConfidence(accuracy);

    // Show the section
    section.style.display = 'flex';

    // Update badge
    badge.textContent = confidence;
    badge.className = 'confidence-badge confidence-' + confidence.toLowerCase();

    // Update reason text
    reason.textContent = `(${reasonText})`;
}

// ==========================================
// LEAVE BALANCES & STATS
// ==========================================

/**
 * Update leave balances
 */
function updateLeaveBalances(balances) {
    if (!balances) return;

    // Casual leave
    const casualEl = document.getElementById('casualLeaveBalance');
    if (casualEl) {
        casualEl.textContent = balances.casual ?? balances.CL ?? '--';
    }

    // Sick leave
    const sickEl = document.getElementById('sickLeaveBalance');
    if (sickEl) {
        sickEl.textContent = balances.sick ?? balances.SL ?? '--';
    }

    // Earned leave
    const earnedEl = document.getElementById('earnedLeaveBalance');
    if (earnedEl) {
        earnedEl.textContent = balances.earned ?? balances.EL ?? '--';
    }
}

/**
 * Update pending approvals count
 */
function updatePendingApprovals(count) {
    const el = document.getElementById('pendingApprovals');
    if (el) {
        el.textContent = count || '0';
    }
}

/**
 * Update notification badge
 */
function updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

// ==========================================
// UPCOMING ITEMS
// ==========================================

/**
 * Load announcements
 */
async function loadAnnouncements() {
    const container = document.getElementById('announcementsList');
    if (!container) return;

    try {
        const announcements = await api.getHrmsAnnouncements(false, 5);

        if (!announcements || announcements.length === 0) {
            container.innerHTML = `
                <div class="ess-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <p>No announcements</p>
                </div>
            `;
            return;
        }

        container.innerHTML = announcements.map(a => `
            <div class="ess-announcement-item ${a.is_read ? '' : 'unread'}" onclick="viewAnnouncement('${a.id}')">
                <div class="announcement-header">
                    <span class="announcement-priority ${a.priority || 'normal'}">${a.priority || 'Normal'}</span>
                    <span class="announcement-date">${formatDate(a.publish_date)}</span>
                </div>
                <h4 class="announcement-title">${escapeHtml(a.title)}</h4>
                <p class="announcement-preview">${truncateText(a.content, 100)}</p>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading announcements:', error);
        container.innerHTML = `
            <div class="ess-error-state">
                <p>Failed to load announcements</p>
            </div>
        `;
    }
}

/**
 * View announcement details
 */
async function viewAnnouncement(announcementId) {
    try {
        // Mark as read
        await api.markAnnouncementAsRead(announcementId);
        // Switch to announcements panel
        switchToPanel('panel-announcements');
    } catch (error) {
        console.error('Error viewing announcement:', error);
    }
}

/**
 * Load upcoming holidays
 */
async function loadUpcomingHolidays() {
    const container = document.getElementById('upcomingHolidays');
    if (!container) return;

    try {
        const holidays = await api.getUpcomingHolidays(5);

        if (!holidays || holidays.length === 0) {
            container.innerHTML = '<p class="ess-no-data">No upcoming holidays</p>';
            return;
        }

        container.innerHTML = holidays.map(h => `
            <div class="ess-upcoming-item">
                <div class="ess-upcoming-date">
                    <span class="day">${new Date(h.holiday_date).getDate()}</span>
                    <span class="month">${new Date(h.holiday_date).toLocaleDateString('en-US', { month: 'short' })}</span>
                </div>
                <div class="ess-upcoming-info">
                    <span class="ess-upcoming-name">${escapeHtml(h.holiday_name)}</span>
                    <span class="ess-upcoming-detail">${h.holiday_type || ''}</span>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading holidays:', error);
        container.innerHTML = '<p class="ess-error">Failed to load</p>';
    }
}

/**
 * Load upcoming birthdays
 */
async function loadUpcomingBirthdays() {
    const container = document.getElementById('upcomingBirthdays');
    if (!container) return;

    try {
        const data = await api.getDashboardBirthdays(30);
        const birthdays = data?.birthdays || [];

        if (birthdays.length === 0) {
            container.innerHTML = '<p class="ess-no-data">No upcoming birthdays</p>';
            return;
        }

        container.innerHTML = birthdays.slice(0, 5).map(b => `
            <div class="ess-upcoming-item">
                <div class="ess-upcoming-avatar">
                    ${b.profile_photo_url
                        ? `<img src="${b.profile_photo_url}" alt="${b.first_name}">`
                        : `<span>${getInitials(b.first_name, b.last_name)}</span>`
                    }
                </div>
                <div class="ess-upcoming-info">
                    <span class="ess-upcoming-name">${escapeHtml(b.first_name)} ${escapeHtml(b.last_name || '')}</span>
                    <span class="ess-upcoming-detail">${formatDate(b.date_of_birth, true)}</span>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading birthdays:', error);
        container.innerHTML = '<p class="ess-error">Failed to load</p>';
    }
}

/**
 * Load upcoming work anniversaries
 */
async function loadUpcomingAnniversaries() {
    const container = document.getElementById('upcomingAnniversaries');
    if (!container) return;

    try {
        const data = await api.getDashboardAnniversaries(30);
        const anniversaries = data?.anniversaries || [];

        if (anniversaries.length === 0) {
            container.innerHTML = '<p class="ess-no-data">No upcoming anniversaries</p>';
            return;
        }

        container.innerHTML = anniversaries.slice(0, 5).map(a => `
            <div class="ess-upcoming-item">
                <div class="ess-upcoming-avatar">
                    ${a.profile_photo_url
                        ? `<img src="${a.profile_photo_url}" alt="${a.first_name}">`
                        : `<span>${getInitials(a.first_name, a.last_name)}</span>`
                    }
                </div>
                <div class="ess-upcoming-info">
                    <span class="ess-upcoming-name">${escapeHtml(a.first_name)} ${escapeHtml(a.last_name || '')}</span>
                    <span class="ess-upcoming-detail">${a.years || 1} year${a.years !== 1 ? 's' : ''}</span>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading anniversaries:', error);
        container.innerHTML = '<p class="ess-error">Failed to load</p>';
    }
}

// ==========================================
// ADMIN ACCESS CHECK
// ==========================================

/**
 * Check if user has admin access
 */
function checkAdminAccess() {
    const adminNavGroup = document.getElementById('adminNavGroup');
    if (!adminNavGroup) return;

    // Check user roles from stored auth data
    const user = getStoredUser();
    if (user) {
        try {
            const roles = user.roles || [];
            const adminRoles = ['SUPERADMIN', 'HRMS_ADMIN', 'HRMS_HR_ADMIN', 'HRMS_HR_MANAGER'];

            if (roles.some(r => adminRoles.includes(r))) {
                adminNavGroup.style.display = 'block';
            }
        } catch (e) {
            console.error('Error parsing user data:', e);
        }
    }
}

// ==========================================
// PANEL DATA LOADERS
// ==========================================

/**
 * Generate year options for dropdowns
 * @param {number} yearsBack - Number of years to go back
 * @param {number} yearsForward - Number of years to go forward
 * @returns {Array} - Array of {value, label} options
 */
function generateYearOptions(yearsBack = 20, yearsForward = 1) {
    const currentYear = new Date().getFullYear();
    const options = [];

    // Future years first (descending)
    for (let y = currentYear + yearsForward; y > currentYear; y--) {
        options.push({ value: String(y), label: String(y) });
    }

    // Current year and past years
    for (let y = currentYear; y >= currentYear - yearsBack; y--) {
        options.push({ value: String(y), label: String(y) });
    }

    return options;
}

/**
 * Setup all searchable year dropdowns using SearchableDropdown
 */
function setupYearDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') {
        console.warn('SearchableDropdown not available for year dropdowns');
        return;
    }

    const currentYear = new Date().getFullYear();

    // My Leaves year dropdown (20 years back, 1 year forward)
    const myLeaveYearSelect = document.getElementById('myLeaveYear');
    if (myLeaveYearSelect && !myLeaveYearDropdown) {
        const options = generateYearOptions(20, 1);
        myLeaveYearSelect.innerHTML = options.map(o =>
            `<option value="${o.value}" ${o.value === String(currentYear) ? 'selected' : ''}>${o.label}</option>`
        ).join('');

        myLeaveYearDropdown = convertSelectToSearchable('myLeaveYear', {
            compact: true,
            placeholder: String(currentYear),
            searchPlaceholder: 'Search year...',
            onChange: () => loadMyLeaves()
        });
    }

    // Holidays year dropdown (20 years back, 1 year forward)
    const holidayYearSelect = document.getElementById('holidayYear');
    if (holidayYearSelect && !holidayYearDropdown) {
        const options = generateYearOptions(20, 1);
        holidayYearSelect.innerHTML = options.map(o =>
            `<option value="${o.value}" ${o.value === String(currentYear) ? 'selected' : ''}>${o.label}</option>`
        ).join('');

        holidayYearDropdown = convertSelectToSearchable('holidayYear', {
            compact: true,
            placeholder: String(currentYear),
            searchPlaceholder: 'Search year...',
            onChange: () => loadHolidays()
        });
    }

    // Payslips year dropdown (20 years back, no future years)
    const payslipYearSelect = document.getElementById('payslipYear');
    if (payslipYearSelect && !payslipYearDropdown) {
        const options = generateYearOptions(20, 0);
        payslipYearSelect.innerHTML = options.map(o =>
            `<option value="${o.value}" ${o.value === String(currentYear) ? 'selected' : ''}>${o.label}</option>`
        ).join('');

        payslipYearDropdown = convertSelectToSearchable('payslipYear', {
            compact: true,
            placeholder: String(currentYear),
            searchPlaceholder: 'Search year...',
            onChange: () => loadMyPayslips()
        });
    }
}

/**
 * Get the selected year from a year dropdown
 * @param {string} dropdownId - The dropdown ID (myLeaveYear, holidayYear, payslipYear)
 * @returns {number} - The selected year
 */
function getYearPickerValue(dropdownId) {
    const currentYear = new Date().getFullYear();

    // Map old picker IDs to new dropdown instances
    const dropdownMap = {
        'myLeaveYearPicker': myLeaveYearDropdown,
        'myLeaveYear': myLeaveYearDropdown,
        'holidayYearPicker': holidayYearDropdown,
        'holidayYear': holidayYearDropdown,
        'payslipYearPicker': payslipYearDropdown,
        'payslipYear': payslipYearDropdown
    };

    const dropdown = dropdownMap[dropdownId];
    if (dropdown) {
        const value = dropdown.getValue();
        return value ? parseInt(value) : currentYear;
    }

    // Fallback to native select
    const select = document.getElementById(dropdownId);
    return select?.value ? parseInt(select.value) : currentYear;
}

/**
 * Setup attendance filter listeners
 */
function setupAttendanceFilters() {
    const monthPicker = document.getElementById('attendanceMonthPicker');

    // Set current month (format: YYYY-MM)
    if (monthPicker) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        monthPicker.value = `${year}-${month}`;
        monthPicker.addEventListener('change', loadMyAttendance);
    }
}

/**
 * Setup leave filter listeners (status only - year is handled in setupYearDropdowns)
 */
function setupLeaveFilters() {
    // Convert myLeaveStatus to SearchableDropdown
    if (typeof convertSelectToSearchable === 'function') {
        if (document.getElementById('myLeaveStatus') && !myLeaveStatusDropdown) {
            myLeaveStatusDropdown = convertSelectToSearchable('myLeaveStatus', {
                compact: true,
                placeholder: 'All Status',
                searchPlaceholder: 'Search status...',
                onChange: () => loadMyLeaves()
            });
        }
    } else {
        // Fallback to native select
        const statusFilter = document.getElementById('myLeaveStatus');
        if (statusFilter) statusFilter.addEventListener('change', loadMyLeaves);
    }
}

/**
 * Load my attendance
 */
async function loadMyAttendance() {
    const tbody = document.getElementById('myAttendanceTableBody');
    if (!tbody) return;

    // Parse month picker value (format: YYYY-MM)
    const monthPicker = document.getElementById('attendanceMonthPicker');
    let month, year;
    if (monthPicker?.value) {
        const [y, m] = monthPicker.value.split('-');
        year = parseInt(y);
        month = parseInt(m);
    } else {
        const now = new Date();
        month = now.getMonth() + 1;
        year = now.getFullYear();
    }

    try {
        tbody.innerHTML = `<tr><td colspan="5" class="loading-cell"><div class="spinner"></div> Loading...</td></tr>`;

        const response = await api.request(`/hrms/attendance/history?month=${month}&year=${year}`);
        const records = response?.records || response || [];

        // Update stats
        const workingDaysEl = document.getElementById('myWorkingDays');
        const presentDaysEl = document.getElementById('myPresentDays');
        const lateDaysEl = document.getElementById('myLateDays');
        const totalHoursEl = document.getElementById('myTotalHours');

        if (response?.stats) {
            if (workingDaysEl) workingDaysEl.textContent = response.stats.working_days || 0;
            if (presentDaysEl) presentDaysEl.textContent = response.stats.present_days || 0;
            if (lateDaysEl) lateDaysEl.textContent = response.stats.late_days || 0;
            if (totalHoursEl) totalHoursEl.textContent = formatHours(response.stats.total_hours || 0);
        }

        if (!records.length) {
            tbody.innerHTML = `<tr class="ess-empty-state"><td colspan="5"><div class="ess-empty-message"><p>No attendance records found</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(r => {
            const date = new Date(r.attendance_date || r.date);
            const checkIn = r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--';
            const checkOut = r.check_out_time ? new Date(r.check_out_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--';
            const hours = r.working_hours ? formatHours(r.working_hours) : '--';
            const status = r.status || 'present';

            return `
                <tr>
                    <td>${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td>${checkIn}</td>
                    <td>${checkOut}</td>
                    <td>${hours}</td>
                    <td><span class="status-badge status-${status}">${capitalizeFirst(status)}</span></td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading attendance:', error);
        tbody.innerHTML = `<tr class="ess-empty-state"><td colspan="5"><div class="ess-empty-message"><p>Failed to load attendance</p></div></td></tr>`;
    }
}

/**
 * Load regularization requests
 */
async function loadRegularizationRequests() {
    const tbody = document.getElementById('regularizationTableBody');
    if (!tbody) return;

    try {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-cell"><div class="spinner"></div> Loading...</td></tr>`;

        const response = await api.request('/hrms/attendance/regularization');
        const requests = response?.requests || response || [];

        if (!requests.length) {
            tbody.innerHTML = `<tr class="ess-empty-state"><td colspan="6"><div class="ess-empty-message"><p>No regularization requests</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = requests.map(r => {
            const date = formatDate(r.date || r.regularization_date);
            const checkIn = r.requested_check_in ? formatTime(r.requested_check_in) : '--';
            const checkOut = r.requested_check_out ? formatTime(r.requested_check_out) : '--';
            const status = r.status || 'pending';

            return `
                <tr>
                    <td>${date}</td>
                    <td>${checkIn}</td>
                    <td>${checkOut}</td>
                    <td>${escapeHtml(truncateText(r.reason, 50))}</td>
                    <td><span class="status-badge status-${status}">${capitalizeFirst(status)}</span></td>
                    <td>
                        ${status === 'pending' ? `<button class="action-btn" onclick="cancelRegularization('${r.id}')" title="Cancel"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : '--'}
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading regularization requests:', error);
        tbody.innerHTML = `<tr class="ess-empty-state"><td colspan="6"><div class="ess-empty-message"><p>Failed to load requests</p></div></td></tr>`;
    }
}

/**
 * Load overtime requests
 */
async function loadOvertimeRequests() {
    const tbody = document.getElementById('overtimeTableBody');
    if (!tbody) return;

    try {
        tbody.innerHTML = `<tr><td colspan="7" class="loading-cell"><div class="spinner"></div> Loading...</td></tr>`;

        const response = await api.request('/hrms/attendance/overtime');
        const requests = response?.requests || response || [];

        if (!requests.length) {
            tbody.innerHTML = `<tr class="ess-empty-state"><td colspan="7"><div class="ess-empty-message"><p>No overtime requests</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = requests.map(r => {
            const date = formatDate(r.date || r.overtime_date);
            const status = r.status || 'pending';

            return `
                <tr>
                    <td>${date}</td>
                    <td>${r.planned_start || '--'}</td>
                    <td>${r.planned_end || '--'}</td>
                    <td>${r.actual_start || '--'}</td>
                    <td>${r.actual_end || '--'}</td>
                    <td><span class="status-badge status-${status}">${capitalizeFirst(status)}</span></td>
                    <td>
                        ${status === 'approved' && !r.actual_start ? `<button class="action-btn" onclick="openCompleteOvertimeModal('${r.id}')" title="Complete">Complete</button>` : '--'}
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading overtime requests:', error);
        tbody.innerHTML = `<tr class="ess-empty-state"><td colspan="7"><div class="ess-empty-message"><p>Failed to load requests</p></div></td></tr>`;
    }
}

/**
 * Load my leaves
 */
async function loadMyLeaves() {
    const tbody = document.getElementById('myLeaveTable');
    if (!tbody) return;

    const year = getYearPickerValue('myLeaveYearPicker');
    // Get value from SearchableDropdown if available, otherwise from native select
    const status = myLeaveStatusDropdown
        ? myLeaveStatusDropdown.getValue()
        : document.getElementById('myLeaveStatus')?.value || '';

    try {
        tbody.innerHTML = `<tr><td colspan="7" class="loading-cell"><div class="spinner"></div> Loading...</td></tr>`;

        let url = `/hrms/leave/requests?year=${year}`;
        if (status) url += `&status=${status}`;

        const response = await api.request(url);
        const requests = response?.requests || response || [];

        // Update leave balance cards
        if (response?.balances) {
            updateLeaveBalanceCards(response.balances);
        }

        if (!requests.length) {
            tbody.innerHTML = `<tr class="ess-empty-state"><td colspan="7"><div class="ess-empty-message"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><p>No leave requests found</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = requests.map(r => {
            const reqStatus = r.status || 'pending';

            return `
                <tr>
                    <td>${escapeHtml(r.leave_type_name || r.leaveTypeName || 'Leave')}</td>
                    <td>${formatDate(r.start_date || r.from_date || r.fromDate)}</td>
                    <td>${formatDate(r.end_date || r.to_date || r.toDate)}</td>
                    <td>${r.total_days || r.totalDays || 1}</td>
                    <td>${escapeHtml(truncateText(r.reason, 30))}</td>
                    <td><span class="status-badge status-${reqStatus}">${capitalizeFirst(reqStatus)}</span></td>
                    <td>
                        <div style="display: flex; gap: 8px; align-items: center; justify-content: center;">
                            <button class="action-btn" onclick="viewLeaveRequest('${r.id}')" title="View">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                            </button>
                            ${reqStatus === 'pending' ? `<button class="action-btn" onclick="cancelLeaveRequest('${r.id}')" title="Cancel"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading leaves:', error);
        tbody.innerHTML = `<tr class="ess-empty-state"><td colspan="7"><div class="ess-empty-message"><p>Failed to load leave requests</p></div></td></tr>`;
    }
}

/**
 * Update leave balance cards in the leaves panel
 */
function updateLeaveBalanceCards(balances) {
    if (!balances) return;

    const annualEl = document.getElementById('annualBalance');
    const sickEl = document.getElementById('sickBalance');
    const casualEl = document.getElementById('casualBalance');
    const pendingEl = document.getElementById('pendingLeaveCount');

    if (annualEl) annualEl.textContent = balances.annual ?? balances.EL ?? 0;
    if (sickEl) sickEl.textContent = balances.sick ?? balances.SL ?? 0;
    if (casualEl) casualEl.textContent = balances.casual ?? balances.CL ?? 0;
    if (pendingEl) pendingEl.textContent = balances.pending ?? 0;
}

/**
 * View leave request details
 */
async function viewLeaveRequest(requestId) {
    try {
        const response = await api.request(`/hrms/leave/requests/${requestId}`);
        if (!response) {
            showToast('Leave request not found', 'error');
            return;
        }

        const r = response;
        const status = r.status?.toLowerCase() || 'pending';
        const statusClass = status === 'approved' ? 'ess-badge-success' :
                           status === 'rejected' ? 'ess-badge-danger' : 'ess-badge-warning';

        // Create and show modal
        const modalHtml = `
            <div class="ess-modal-overlay" id="viewLeaveModal" onclick="if(event.target === this) closeViewLeaveModal()">
                <div class="ess-modal-content" style="max-width: 500px;">
                    <div class="ess-modal-header">
                        <h2>Leave Request Details</h2>
                        <button class="ess-modal-close" onclick="closeViewLeaveModal()">&times;</button>
                    </div>
                    <div class="ess-modal-body">
                        <div class="ess-detail-group">
                            <label>Leave Type</label>
                            <p>${escapeHtml(r.leave_type_name || r.leave_type || 'N/A')}</p>
                        </div>
                        <div class="ess-detail-row">
                            <div class="ess-detail-group">
                                <label>From Date</label>
                                <p>${formatDate(r.start_date || r.from_date)}</p>
                            </div>
                            <div class="ess-detail-group">
                                <label>To Date</label>
                                <p>${formatDate(r.end_date || r.to_date)}</p>
                            </div>
                        </div>
                        <div class="ess-detail-row">
                            <div class="ess-detail-group">
                                <label>Total Days</label>
                                <p>${r.total_days ?? r.days ?? 0}</p>
                            </div>
                            <div class="ess-detail-group">
                                <label>Status</label>
                                <p><span class="ess-badge ${statusClass}">${status.charAt(0).toUpperCase() + status.slice(1)}</span></p>
                            </div>
                        </div>
                        <div class="ess-detail-group">
                            <label>Reason</label>
                            <p>${escapeHtml(r.reason || 'No reason provided')}</p>
                        </div>
                        ${r.half_day ? `
                        <div class="ess-detail-group">
                            <label>Half Day</label>
                            <p>${r.half_day_type || 'Yes'}</p>
                        </div>
                        ` : ''}
                        ${r.approved_by || r.rejected_by ? `
                        <div class="ess-detail-group">
                            <label>${r.status === 'approved' ? 'Approved' : 'Rejected'} By</label>
                            <p>${escapeHtml(r.approved_by || r.rejected_by || 'N/A')}</p>
                        </div>
                        ` : ''}
                        ${r.rejection_reason ? `
                        <div class="ess-detail-group">
                            <label>Rejection Reason</label>
                            <p>${escapeHtml(r.rejection_reason)}</p>
                        </div>
                        ` : ''}
                        <div class="ess-detail-group">
                            <label>Submitted On</label>
                            <p>${formatDate(r.created_at || r.applied_on)}</p>
                        </div>
                    </div>
                    <div class="ess-modal-actions">
                        <button class="ess-btn ess-btn-secondary" onclick="closeViewLeaveModal()">Close</button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('viewLeaveModal');
        if (existingModal) existingModal.remove();

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

    } catch (error) {
        console.error('Error viewing leave request:', error);
        showToast('Failed to load leave request details', 'error');
    }
}

/**
 * Close view leave modal
 */
function closeViewLeaveModal() {
    const modal = document.getElementById('viewLeaveModal');
    if (modal) modal.remove();
}

/**
 * Cancel a leave request
 */
async function cancelLeaveRequest(requestId) {
    const confirmed = await Confirm.show({
        title: 'Cancel Leave Request',
        message: 'Are you sure you want to cancel this leave request?',
        type: 'warning',
        confirmText: 'Cancel Request'
    });
    if (!confirmed) return;

    try {
        await api.request(`/hrms/leave/requests/${requestId}`, {
            method: 'DELETE'
        });
        showToast('Leave request cancelled successfully', 'success');
        // Reload the leaves list
        loadMyLeaves();
    } catch (error) {
        console.error('Error cancelling leave request:', error);
        showToast(error.message || 'Failed to cancel leave request', 'error');
    }
}

/**
 * Load detailed leave balance
 */
async function loadLeaveBalanceDetailed() {
    const container = document.getElementById('leaveBalanceDetailed');
    if (!container) return;

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading leave balances...</span></div>`;

        const response = await api.request('/hrms/leave/balances');
        const balances = response?.balances || response || [];

        if (!balances.length) {
            container.innerHTML = `
                <div class="ess-empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <p>No leave balances configured</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="ess-leave-balance-grid">
                ${balances.map(b => {
                    // Calculate available balance
                    const total = parseFloat(b.total_days) || parseFloat(b.total) || 0;
                    const carried = parseFloat(b.carried_forward_days) || 0;
                    const used = parseFloat(b.used_days) || parseFloat(b.used) || 0;
                    const pending = parseFloat(b.pending_days) || parseFloat(b.pending) || 0;
                    const encashed = parseFloat(b.encashed_days) || 0;
                    const available = Math.max(0, total + carried - used - pending - encashed);
                    const totalAllocation = total + carried;

                    // Calculate usage percentage for progress bar
                    const usedPercent = totalAllocation > 0 ? Math.min(((used + pending + encashed) / totalAllocation) * 100, 100) : 0;

                    // Check if this is a zero allocation leave type
                    const isZeroBalance = available === 0 && totalAllocation === 0;

                    return `
                        <div class="ess-leave-balance-item ${isZeroBalance ? 'zero-balance' : ''}">
                            <div class="leave-type-header">
                                <span class="leave-type-code">${escapeHtml(b.leave_type_code || b.code || 'N/A')}</span>
                                <span class="leave-type-name">${escapeHtml(b.leave_type_name || b.name || 'Unknown')}</span>
                            </div>
                            <div class="leave-balance-bar">
                                <div class="balance-used" style="width: ${usedPercent}%"></div>
                            </div>
                            <div class="leave-balance-stats">
                                <span class="balance-available">${available} available</span>
                                <span class="balance-total">of ${totalAllocation}</span>
                            </div>
                            ${(used > 0 || pending > 0 || encashed > 0 || carried > 0) ? `
                                <div class="leave-balance-breakdown">
                                    ${used > 0 ? `<span class="breakdown-item used">Used: ${used}</span>` : ''}
                                    ${pending > 0 ? `<span class="breakdown-item pending">Pending: ${pending}</span>` : ''}
                                    ${encashed > 0 ? `<span class="breakdown-item encashed">Encashed: ${encashed}</span>` : ''}
                                    ${carried > 0 ? `<span class="breakdown-item carried">Carried Forward: ${carried}</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;

    } catch (error) {
        console.error('Error loading leave balances:', error);
        container.innerHTML = `
            <div class="ess-error-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>Failed to load leave balances</p>
            </div>
        `;
    }
}

/**
 * Load holidays
 */
async function loadHolidays() {
    const container = document.getElementById('holidaysList');
    if (!container) return;

    const year = getYearPickerValue('holidayYearPicker');

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading holidays...</span></div>`;

        const response = await api.request(`/hrms/holidays?year=${year}`);
        const holidays = response?.holidays || response || [];

        if (!holidays.length) {
            container.innerHTML = `<div class="ess-empty-state"><p>No holidays for ${year}</p></div>`;
            return;
        }

        container.innerHTML = holidays.map(h => {
            const date = new Date(h.holiday_date || h.date);
            const isUpcoming = date >= new Date();

            return `
                <div class="ess-holiday-item ${isUpcoming ? 'upcoming' : 'past'}">
                    <div class="holiday-date">
                        <span class="day">${date.getDate()}</span>
                        <span class="month">${date.toLocaleDateString('en-US', { month: 'short' })}</span>
                        <span class="weekday">${date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    </div>
                    <div class="holiday-info">
                        <span class="holiday-name">${escapeHtml(h.holiday_name || h.name)}</span>
                        <span class="holiday-type">${h.holiday_type || h.type || 'Public Holiday'}</span>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading holidays:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load holidays</p></div>`;
    }
}

/**
 * Load my profile
 */
async function loadMyProfile() {
    const container = document.getElementById('profileContent');
    if (!container) return;

    try {
        // Show loading state
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading profile...</span></div>`;

        // Fetch full profile data from API (not the limited dashboard data)
        const emp = await api.request('/hrms/self-service/my-profile');

        if (!emp) {
            container.innerHTML = `<div class="ess-empty-state"><p>No employee profile linked to your account</p></div>`;
            return;
        }

        container.innerHTML = `
            <div class="ess-profile-card">
                <div class="profile-photo-section">
                    <div class="profile-photo-large">
                        ${emp.profile_photo_url
                            ? `<img src="${emp.profile_photo_url}" alt="${emp.first_name}">`
                            : `<span class="photo-initials">${getInitials(emp.first_name, emp.last_name)}</span>`
                        }
                    </div>
                    <h2>${escapeHtml(emp.first_name)} ${escapeHtml(emp.last_name || '')}</h2>
                    <p class="profile-title">${escapeHtml(emp.designation_name || 'Employee')}</p>
                    <p class="profile-dept">${escapeHtml(emp.department_name || '')}</p>
                </div>
                <div class="profile-details">
                    <div class="profile-section">
                        <h4>Personal Information</h4>
                        <div class="info-grid">
                            <div class="info-item"><label>Employee Code</label><span>${escapeHtml(emp.employee_code || '--')}</span></div>
                            <div class="info-item"><label>Email</label><span>${escapeHtml(emp.work_email || emp.email || '--')}</span></div>
                            <div class="info-item"><label>Phone</label><span>${escapeHtml(emp.work_phone || emp.phone || '--')}</span></div>
                            <div class="info-item"><label>Date of Birth</label><span>${formatDate(emp.date_of_birth) || '--'}</span></div>
                            <div class="info-item"><label>Gender</label><span>${capitalizeFirst(emp.gender) || '--'}</span></div>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h4>Employment Details</h4>
                        <div class="info-grid">
                            <div class="info-item"><label>Joining Date</label><span>${formatDate(emp.hire_date || emp.date_of_joining) || '--'}</span></div>
                            <div class="info-item"><label>Office</label><span>${escapeHtml(emp.office_name || '--')}</span></div>
                            <div class="info-item"><label>Department</label><span>${escapeHtml(emp.department_name || '--')}</span></div>
                            <div class="info-item"><label>Designation</label><span>${escapeHtml(emp.designation_name || '--')}</span></div>
                            <div class="info-item"><label>Reporting To</label><span>${escapeHtml(emp.manager_name || '--')}</span></div>
                            <div class="info-item"><label>Employment Type</label><span>${capitalizeFirst(emp.employment_type) || 'Full-time'}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

    } catch (error) {
        console.error('Error loading profile:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load profile</p></div>`;
    }
}

/**
 * Load salary details with tabs for Current Salary and Salary History
 * Uses the breakdown endpoint to get full salary details including statutory deductions
 */
async function loadSalaryDetails() {
    const container = document.getElementById('salaryDetails');
    if (!container) return;

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading salary details...</span></div>`;

        // Fetch salary info, breakdown, and history in parallel
        const [salaryResponse, breakdownResponse, historyResponse] = await Promise.all([
            api.request('/hrms/payroll/my-salary').catch(err => {
                console.log('No current salary:', err);
                return null;
            }),
            api.request('/hrms/payroll/my-salary/breakdown').catch(err => {
                console.log('No salary breakdown:', err);
                return null;
            }),
            api.request('/hrms/payroll/my-salary/history').catch(err => {
                console.log('No salary history:', err);
                return [];
            })
        ]);

        const salary = salaryResponse;
        const breakdown = breakdownResponse;
        const history = Array.isArray(historyResponse) ? historyResponse : [];

        // Build the tabs UI
        const historyCount = history.length > 0 ? ` (${history.length})` : '';

        container.innerHTML = `
            <div class="ess-salary-tabs-container">
                <div class="ess-salary-tabs">
                    <button class="ess-salary-tab active" data-tab="current" onclick="switchSalaryTab('current')">
                        Current Salary
                    </button>
                    <button class="ess-salary-tab" data-tab="history" onclick="switchSalaryTab('history')">
                        Salary History${historyCount}
                    </button>
                </div>

                <div id="salaryTabCurrent" class="ess-salary-tab-content active">
                    ${renderCurrentSalaryContent(salary, breakdown)}
                </div>

                <div id="salaryTabHistory" class="ess-salary-tab-content">
                    ${renderSalaryHistoryContent(history)}
                </div>
            </div>
        `;

    } catch (error) {
        console.error('Error loading salary:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load salary details</p></div>`;
    }
}

/**
 * Switch between Current Salary and Salary History tabs
 */
function switchSalaryTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.ess-salary-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.getElementById('salaryTabCurrent').classList.toggle('active', tabName === 'current');
    document.getElementById('salaryTabHistory').classList.toggle('active', tabName === 'history');
}

/**
 * Render the current salary content with full breakdown (like Payroll modal)
 */
function renderCurrentSalaryContent(salary, breakdown) {
    if (!salary && !breakdown) {
        return `<div class="ess-empty-state"><p>No salary structure configured</p></div>`;
    }

    // Use breakdown for detailed components if available, fallback to salary
    const ctc = breakdown?.ctc || salary?.ctc || 0;
    const monthlyCtc = Math.round(ctc / 12);
    const grossValue = breakdown?.gross || salary?.monthly_gross || salary?.gross || 0;
    const monthlyGross = breakdown ? Math.round(grossValue / 12) : grossValue;
    const totalDeductions = breakdown?.total_deductions || 0;
    const monthlyDeductions = breakdown ? Math.round(totalDeductions / 12) : 0;
    const netValue = breakdown?.net || salary?.monthly_net || salary?.net || 0;
    const monthlyNet = breakdown ? Math.round(netValue / 12) : netValue;
    const effectiveFrom = salary?.effective_from;

    // Get earnings and deductions from breakdown or salary
    const earnings = breakdown?.earnings || (salary?.components || []).filter(c => c.component_type === 'earning');
    const deductions = breakdown?.deductions || (salary?.components || []).filter(c => c.component_type === 'deduction');

    // Calculate totals for display
    const totalEarnings = earnings.reduce((sum, c) => sum + (c.monthly_amount || 0), 0);
    const totalDeductionsCalc = deductions.reduce((sum, c) => sum + (c.monthly_amount || 0), 0);

    return `
        <div class="ess-salary-card">
            <!-- Top Stats Row -->
            <div class="salary-stats-row">
                <div class="salary-stat-box">
                    <span class="stat-label">ANNUAL CTC</span>
                    <span class="stat-value">${formatCurrency(ctc)}</span>
                </div>
                <div class="salary-stat-box">
                    <span class="stat-label">MONTHLY GROSS</span>
                    <span class="stat-value">${formatCurrency(monthlyGross)}</span>
                </div>
                <div class="salary-stat-box">
                    <span class="stat-label">MONTHLY NET</span>
                    <span class="stat-value">${formatCurrency(monthlyNet)}</span>
                </div>
                <div class="salary-stat-box">
                    <span class="stat-label">EFFECTIVE FROM</span>
                    <span class="stat-value">${formatDate(effectiveFrom) || 'Current'}</span>
                </div>
            </div>

            <!-- Salary Breakdown Header -->
            <div class="breakdown-header">
                <h3>Salary Breakdown (Monthly)</h3>
                ${salary?.structure_name ? `
                    <span class="structure-badge">${escapeHtml(salary.structure_name)}${salary.structure_code ? ` (${escapeHtml(salary.structure_code)})` : ''}</span>
                ` : ''}
            </div>

            <!-- Earnings and Deductions Grid -->
            <div class="salary-components-grid">
                <!-- Earnings Column -->
                <div class="components-column earnings-column">
                    <div class="column-header earnings-header">EARNINGS</div>
                    <div class="components-list">
                        ${earnings.length > 0 ? earnings.map(c => `
                            <div class="component-row">
                                <span class="component-name">${escapeHtml(c.component_name || 'Unknown')}</span>
                                <span class="component-amount earnings-amount">+${formatCurrency(c.monthly_amount || 0)}</span>
                            </div>
                        `).join('') : '<p class="no-data">No earnings configured</p>'}
                        <div class="component-row total-row">
                            <span class="component-name">Gross</span>
                            <span class="component-amount earnings-amount">${formatCurrency(totalEarnings)}</span>
                        </div>
                    </div>
                </div>

                <!-- Deductions Column -->
                <div class="components-column deductions-column">
                    <div class="column-header deductions-header">DEDUCTIONS</div>
                    <div class="components-list">
                        ${deductions.length > 0 ? deductions.map(c => {
                            const amount = c.monthly_amount || 0;
                            const isZero = amount === 0;
                            return `
                                <div class="component-row${isZero ? ' zero-amount' : ''}">
                                    <span class="component-name">${escapeHtml(c.component_name || 'Unknown')}</span>
                                    <span class="component-amount deductions-amount">${isZero ? formatCurrency(0) : '-' + formatCurrency(amount)}</span>
                                </div>
                            `;
                        }).join('') : '<p class="no-data">No deductions</p>'}
                        <div class="component-row total-row">
                            <span class="component-name">Total</span>
                            <span class="component-amount deductions-amount">-${formatCurrency(totalDeductionsCalc)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Summary Boxes -->
            <div class="salary-summary-boxes">
                <div class="summary-box gross-box">
                    <span class="box-label">GROSS</span>
                    <span class="box-value">${formatCurrency(totalEarnings)}</span>
                </div>
                <div class="summary-box deductions-box">
                    <span class="box-label">DEDUCTIONS</span>
                    <span class="box-value">-${formatCurrency(totalDeductionsCalc)}</span>
                </div>
                <div class="summary-box net-box">
                    <span class="box-label">NET PAY</span>
                    <span class="box-value">${formatCurrency(totalEarnings - totalDeductionsCalc)}</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render salary history content
 */
function renderSalaryHistoryContent(history) {
    if (!history || history.length === 0) {
        return `<div class="ess-empty-state"><p>No salary revision history available</p></div>`;
    }

    return `
        <div class="ess-salary-history">
            <table class="ess-table">
                <thead>
                    <tr>
                        <th>Effective From</th>
                        <th>CTC (Annual)</th>
                        <th>Gross (Monthly)</th>
                        <th>Net (Monthly)</th>
                        <th>Revision Reason</th>
                    </tr>
                </thead>
                <tbody>
                    ${history.map(item => `
                        <tr${item.is_current ? ' class="current-salary"' : ''}>
                            <td>${formatDate(item.effective_from) || '-'}</td>
                            <td>${formatCurrency(item.ctc || 0)}</td>
                            <td>${formatCurrency(item.monthly_gross || (item.gross ? Math.round(item.gross / 12) : 0))}</td>
                            <td>${formatCurrency(item.monthly_net || (item.net ? Math.round(item.net / 12) : 0))}</td>
                            <td>${escapeHtml(item.revision_reason || (item.is_current ? 'Current Salary' : '-'))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Load loans
 * v3.0.53: COUNTRY-AGNOSTIC - uses currency_symbol and currency_code from backend
 */
async function loadLoans() {
    const container = document.getElementById('loansContainer');
    if (!container) return;

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading loans...</span></div>`;

        const response = await api.request('/hrms/payroll-processing/my-loans');
        const loans = response?.loans || [];
        // v3.0.53: Extract currency info from API response (country-agnostic)
        const currencySymbol = response?.currency_symbol || '';
        const currencyCode = response?.currency_code || '';

        if (!loans.length) {
            container.innerHTML = `
                <div class="empty-message" style="text-align: center; padding: 2rem;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="1">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                    <p style="margin-top: 1rem; color: var(--text-secondary);">No loans or advances</p>
                </div>`;
            return;
        }

        // v3.0.54: Check if any loans are withdrawable (pending/rejected)
        const hasWithdrawable = loans.some(l => ['pending', 'rejected'].includes((l.status || '').toLowerCase()));

        container.innerHTML = `
            <div class="table-responsive">
                <table class="data-table" style="table-layout: fixed;">
                    <thead>
                        <tr>
                            <th style="width: ${hasWithdrawable ? '20%' : '22%'};">Loan Type</th>
                            <th style="width: ${hasWithdrawable ? '18%' : '20%'}; text-align: right;">Principal</th>
                            <th style="width: ${hasWithdrawable ? '15%' : '18%'}; text-align: right;">EMI</th>
                            <th style="width: ${hasWithdrawable ? '18%' : '22%'}; text-align: right;">Outstanding</th>
                            <th style="width: ${hasWithdrawable ? '15%' : '18%'};">Status</th>
                            ${hasWithdrawable ? '<th style="width: 14%; text-align: center;">Actions</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${loans.map(l => {
                            const status = (l.status || 'pending').toLowerCase();
                            const loanType = l.loan_type || l.type || 'unknown';
                            const canWithdraw = ['pending', 'rejected'].includes(status);
                            return `
                            <tr>
                                <td>${formatLoanTypeBadge(loanType)}</td>
                                <td class="amount-cell">${formatCurrency(l.principal_amount || l.amount, currencySymbol, currencyCode)}</td>
                                <td class="amount-cell">${formatCurrency(l.emi_amount || l.emi, currencySymbol, currencyCode)}</td>
                                <td class="amount-cell">${formatCurrency(l.outstanding_amount || l.outstanding, currencySymbol, currencyCode)}</td>
                                <td>${getLoanStatusBadge(status)}</td>
                                ${hasWithdrawable ? `
                                <td style="text-align: center;">
                                    ${canWithdraw ? `
                                        <button class="btn-icon-danger" onclick="withdrawLoan('${l.id}')" title="Withdraw application">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                            </svg>
                                        </button>
                                    ` : '-'}
                                </td>
                                ` : ''}
                            </tr>
                        `}).join('')}
                    </tbody>
                </table>
            </div>
        `;

    } catch (error) {
        console.error('Error loading loans:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load loans</p></div>`;
    }
}

/**
 * Format loan type as badge
 */
function formatLoanTypeBadge(type) {
    const types = {
        'salary_advance': 'Salary Advance',
        'personal_loan': 'Personal Loan',
        'emergency_loan': 'Emergency Loan'
    };
    const label = types[type] || capitalizeFirst(type.replace(/_/g, ' '));
    return `<span class="type-badge earning">${label}</span>`;
}

/**
 * Get loan status badge
 */
function getLoanStatusBadge(status) {
    const badges = {
        'pending': '<span class="status-badge pending">Pending</span>',
        'approved': '<span class="status-badge approved">Approved</span>',
        'active': '<span class="status-badge active">Active</span>',
        'completed': '<span class="status-badge approved">Completed</span>',
        'rejected': '<span class="status-badge rejected">Rejected</span>',
        'cancelled': '<span class="status-badge inactive">Cancelled</span>'
    };
    return badges[status] || `<span class="status-badge">${capitalizeFirst(status)}</span>`;
}

/**
 * Load reimbursements
 * v3.0.52: Connected to backend my-adjustments API with type=reimbursement filter
 */
async function loadReimbursements() {
    const container = document.getElementById('reimbursementsContainer');
    if (!container) return;

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading reimbursements...</span></div>`;

        // v3.0.52: Fetch reimbursement adjustments from new ESS endpoint
        const response = await api.request('/hrms/payroll-processing/my-adjustments?type=reimbursement');
        const claims = response?.data || [];
        // v3.0.53: COUNTRY-AGNOSTIC - Extract currency info from API response
        const currencySymbol = response?.currency_symbol || '';
        const currencyCode = response?.currency_code || '';

        if (!claims.length) {
            container.innerHTML = `
                <div class="empty-message" style="text-align: center; padding: 2rem;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="1.5">
                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <p style="margin-top: 1rem; color: var(--text-secondary);">No reimbursement claims</p>
                </div>`;
            return;
        }

        // v3.0.54: Check if any claims are withdrawable (pending/rejected)
        const hasWithdrawable = claims.some(c => ['pending', 'rejected'].includes((c.status || '').toLowerCase()));

        container.innerHTML = `
            <div class="table-responsive">
                <table class="data-table" style="table-layout: fixed;">
                    <thead>
                        <tr>
                            <th style="width: ${hasWithdrawable ? '15%' : '18%'};">Type</th>
                            <th style="width: ${hasWithdrawable ? '12%' : '15%'}; text-align: right;">Amount</th>
                            <th style="width: ${hasWithdrawable ? '14%' : '17%'};">Period</th>
                            <th style="width: ${hasWithdrawable ? '30%' : '35%'};">Description</th>
                            <th style="width: ${hasWithdrawable ? '15%' : '15%'};">Status</th>
                            ${hasWithdrawable ? '<th style="width: 14%; text-align: center;">Actions</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${claims.map(c => {
                            const status = (c.status || 'pending').toLowerCase();
                            const period = `${getMonthName(c.effective_month)} ${c.effective_year}`;
                            const canWithdraw = ['pending', 'rejected'].includes(status);
                            return `
                            <tr>
                                <td><span class="type-badge earning">Reimbursement</span></td>
                                <td class="amount-cell positive">+${formatCurrency(c.amount, currencySymbol, currencyCode)}</td>
                                <td>${period}</td>
                                <td class="reason-cell" title="${escapeHtml(c.reason || '')}">${escapeHtml(truncateText(c.reason || '-', 35))}</td>
                                <td>${getReimbursementStatusBadge(status)}</td>
                                ${hasWithdrawable ? `
                                <td style="text-align: center;">
                                    ${canWithdraw ? `
                                        <button class="btn-icon-danger" onclick="withdrawAdjustment('${c.id}')" title="Withdraw claim">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                            </svg>
                                        </button>
                                    ` : '-'}
                                </td>
                                ` : ''}
                            </tr>
                        `}).join('')}
                    </tbody>
                </table>
            </div>
        `;

    } catch (error) {
        console.error('Error loading reimbursements:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load reimbursements</p></div>`;
    }
}

/**
 * Get reimbursement status badge
 */
function getReimbursementStatusBadge(status) {
    const badges = {
        'pending': '<span class="status-badge pending">Pending</span>',
        'approved': '<span class="status-badge approved">Approved</span>',
        'rejected': '<span class="status-badge rejected">Rejected</span>',
        'applied': '<span class="status-badge processing">Applied</span>'
    };
    return badges[status] || `<span class="status-badge">${capitalizeFirst(status)}</span>`;
}

/**
 * Load team directory
 */
async function loadDirectory() {
    const container = document.getElementById('directoryGrid');
    if (!container) return;

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading directory...</span></div>`;

        const response = await api.request('/hrms/self-service/directory');
        const employees = response?.employees || response || [];

        if (!employees.length) {
            container.innerHTML = `<div class="ess-empty-state"><p>No employees found</p></div>`;
            return;
        }

        container.innerHTML = employees.map(e => {
            // Extract first and last name from full_name for initials
            const nameParts = (e.full_name || '').split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            return `
            <div class="ess-directory-card">
                <div class="ess-directory-avatar">
                    ${e.profile_photo_url
                        ? `<img src="${e.profile_photo_url}" alt="${e.full_name}">`
                        : `<span>${getInitials(firstName, lastName)}</span>`
                    }
                </div>
                <div class="ess-directory-info">
                    <h4 class="ess-directory-name">${escapeHtml(e.full_name || e.employee_code || 'Unknown')}</h4>
                    <p class="ess-directory-role">${escapeHtml(e.designation || 'Employee')}</p>
                    <p class="ess-directory-dept">${escapeHtml(e.department || '')}</p>
                    ${e.work_email ? `<a href="mailto:${e.work_email}" class="ess-directory-email">${escapeHtml(e.work_email)}</a>` : ''}
                </div>
            </div>
        `}).join('');

        // Setup search
        const searchInput = document.getElementById('directorySearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => filterDirectory(e.target.value, employees));
        }

    } catch (error) {
        console.error('Error loading directory:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load directory</p></div>`;
    }
}

/**
 * Filter directory
 */
function filterDirectory(query, employees) {
    const container = document.getElementById('directoryGrid');
    if (!container || !employees) return;

    const filtered = employees.filter(e => {
        const fullName = `${e.first_name} ${e.last_name || ''}`.toLowerCase();
        const dept = (e.department_name || '').toLowerCase();
        const title = (e.designation_name || '').toLowerCase();
        const q = query.toLowerCase();

        return fullName.includes(q) || dept.includes(q) || title.includes(q);
    });

    if (!filtered.length) {
        container.innerHTML = `<div class="ess-empty-state"><p>No matches found for "${escapeHtml(query)}"</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(e => `
        <div class="ess-directory-card">
            <div class="ess-directory-avatar">
                ${e.profile_photo_url
                    ? `<img src="${e.profile_photo_url}" alt="${e.first_name}">`
                    : `<span>${getInitials(e.first_name, e.last_name)}</span>`
                }
            </div>
            <div class="ess-directory-info">
                <h4>${escapeHtml(e.first_name)} ${escapeHtml(e.last_name || '')}</h4>
                <p class="ess-directory-role">${escapeHtml(e.designation_name || 'Employee')}</p>
                <p class="ess-directory-dept">${escapeHtml(e.department_name || '')}</p>
            </div>
        </div>
    `).join('');
}

/**
 * Load org chart
 */
async function loadOrgChart() {
    const container = document.getElementById('orgChartContainer');
    if (!container) return;

    container.innerHTML = `<div class="ess-empty-state"><p>Organization chart coming soon</p></div>`;
}

/**
 * Load full announcements
 */
async function loadAnnouncementsFull() {
    const container = document.getElementById('announcementsFull');
    if (!container) return;

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading announcements...</span></div>`;

        const announcements = await api.getHrmsAnnouncements(false, 50);

        if (!announcements || announcements.length === 0) {
            container.innerHTML = `<div class="ess-empty-state"><p>No announcements</p></div>`;
            return;
        }

        container.innerHTML = announcements.map(a => `
            <div class="ess-announcement-full ${a.is_read ? '' : 'unread'}">
                <div class="announcement-meta">
                    <span class="announcement-priority ${a.priority || 'normal'}">${a.priority || 'Normal'}</span>
                    <span class="announcement-date">${formatDate(a.publish_date)}</span>
                </div>
                <h3>${escapeHtml(a.title)}</h3>
                <div class="announcement-content">${a.content || ''}</div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading announcements:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load announcements</p></div>`;
    }
}

/**
 * Load policies
 */
async function loadPolicies() {
    const container = document.getElementById('policiesList');
    if (!container) return;

    container.innerHTML = `<div class="ess-empty-state"><p>Company policies coming soon</p></div>`;
}

// ==========================================
// PAYSLIPS FUNCTIONALITY
// ==========================================

/**
 * Load my payslips for the selected year
 */
async function loadMyPayslips() {
    try {
        const year = getYearPickerValue('payslipYearPicker');
        const response = await api.request(`/hrms/payroll-processing/my-payslips?year=${year}`);
        myPayslips = response || [];

        // Update stats
        if (myPayslips.length > 0) {
            const lastPayslip = myPayslips[0];
            const lastGrossEl = document.getElementById('lastGross');
            const lastDeductionsEl = document.getElementById('lastDeductions');
            const lastNetEl = document.getElementById('lastNet');
            const ytdEl = document.getElementById('ytdEarnings');

            if (lastGrossEl) lastGrossEl.textContent = formatCurrency(lastPayslip.grossSalary || lastPayslip.gross_salary || lastPayslip.gross_earnings || lastPayslip.gross_pay || 0);
            if (lastDeductionsEl) lastDeductionsEl.textContent = formatCurrency(lastPayslip.totalDeductions || lastPayslip.total_deductions || 0);
            if (lastNetEl) lastNetEl.textContent = formatCurrency(lastPayslip.netSalary || lastPayslip.net_salary || lastPayslip.net_pay || 0);

            const ytd = myPayslips.reduce((sum, p) => sum + (p.grossSalary || p.gross_salary || p.gross_earnings || p.gross_pay || 0), 0);
            if (ytdEl) ytdEl.textContent = formatCurrency(ytd);
        } else {
            document.getElementById('lastGross').textContent = '₹0';
            document.getElementById('lastDeductions').textContent = '₹0';
            document.getElementById('lastNet').textContent = '₹0';
            document.getElementById('ytdEarnings').textContent = '₹0';
        }

        updateMyPayslipsTable(myPayslips);
    } catch (error) {
        if (error.message?.includes('Employee profile not found') || error.message?.includes('not found')) {
            console.log('User has no employee profile - showing empty payslips');
            updateMyPayslipsTable([]);
        } else {
            console.error('Error loading payslips:', error);
            showToast('Failed to load payslips', 'error');
        }
    }
}

/**
 * Update the payslips table
 */
function updateMyPayslipsTable(payslips) {
    const tbody = document.getElementById('myPayslipsTable');
    if (!tbody) return;

    if (!payslips || payslips.length === 0) {
        tbody.innerHTML = `
            <tr class="ess-empty-state">
                <td colspan="7">
                    <div class="ess-empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                            <line x1="1" y1="10" x2="23" y2="10"></line>
                        </svg>
                        <p>No payslips found for this year</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = payslips.map(slip => {
        const month = slip.month || slip.payroll_month;
        const year = slip.year || slip.payroll_year;
        const periodStart = slip.periodStart || slip.period_start || slip.pay_period_start;
        const periodEnd = slip.periodEnd || slip.period_end || slip.pay_period_end;
        const grossSalary = slip.grossSalary || slip.gross_salary || slip.gross_earnings || 0;
        const totalDeductions = slip.totalDeductions || slip.total_deductions || 0;
        const netSalary = slip.netSalary || slip.net_salary || slip.net_pay || 0;
        const status = slip.status || 'finalized';

        return `
            <tr>
                <td><strong>${getMonthName(month)} ${year}</strong></td>
                <td>${formatPayslipDate(periodStart)} - ${formatPayslipDate(periodEnd)}</td>
                <td>${formatCurrency(grossSalary)}</td>
                <td>${formatCurrency(totalDeductions)}</td>
                <td><strong>${formatCurrency(netSalary)}</strong></td>
                <td><span class="status-badge status-${status.toLowerCase()}">${capitalizeFirst(status)}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn" onclick="viewPayslipEss('${slip.id}')" title="View Payslip">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="downloadPayslipById('${slip.id}')" title="Download">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// viewPayslipEss is used on ESS page - it enables ESS mode which hides organizational_overhead items and JSON tab
// viewPayslip is still available globally but doesn't use ESS mode (for payroll admin pages)
// viewCalculationProofProcessed is also provided by payslip-modal.js
// downloadPayslip is now provided by payslip-modal.js (PayslipModal.downloadPdf)

// ==========================================
// MODALS
// ==========================================

/**
 * Open modal
 */
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

/**
 * Close modal
 */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * Open regularization modal
 */
function openRegularizationModal() {
    document.getElementById('regularizationForm')?.reset();
    openModal('regularizationModal');
}

/**
 * Submit regularization request
 */
async function submitRegularization() {
    try {
        const checkInDate = document.getElementById('regCheckInDate').value;
        const checkInTime = document.getElementById('regCheckInTime').value;
        const checkOutDate = document.getElementById('regCheckOutDate').value;
        const checkOutTime = document.getElementById('regCheckOutTime').value;
        const reason = document.getElementById('regReason').value?.trim();

        // Validate all required fields
        if (!checkInDate) {
            showToast('Please select check-in date', 'error');
            return;
        }
        if (!checkInTime) {
            showToast('Please provide check-in time', 'error');
            return;
        }
        if (!checkOutDate) {
            showToast('Please select check-out date', 'error');
            return;
        }
        if (!checkOutTime) {
            showToast('Please provide check-out time', 'error');
            return;
        }
        if (!reason) {
            showToast('Please provide a reason', 'error');
            return;
        }

        // Build full datetime objects
        const checkInDateTime = new Date(`${checkInDate}T${checkInTime}:00`);
        const checkOutDateTime = new Date(`${checkOutDate}T${checkOutTime}:00`);

        // Validate check-out is after check-in
        if (checkOutDateTime <= checkInDateTime) {
            showToast('Check-out must be after check-in', 'error');
            return;
        }

        // Build request with full datetime values (use check-in date as the "date" field)
        const requestData = {
            date: checkInDate,
            reason: reason,
            requested_check_in: checkInDateTime.toISOString(),
            requested_check_out: checkOutDateTime.toISOString()
        };

        await api.request('/hrms/attendance/regularization', {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        showToast('Regularization request submitted', 'success');
        closeModal('regularizationModal');
        loadRegularizationRequests();
    } catch (error) {
        console.error('Error submitting regularization:', error);
        showToast(error.message || 'Failed to submit request', 'error');
    }
}

/**
 * Cancel/delete a pending regularization request
 */
async function cancelRegularization(id) {
    const confirmed = await Confirm.danger(
        'Are you sure you want to cancel this regularization request?',
        'Cancel Request'
    );
    if (!confirmed) {
        return;
    }

    try {
        await api.request(`/hrms/attendance/regularization/${id}`, {
            method: 'DELETE'
        });
        showToast('Regularization request cancelled', 'success');
        loadRegularizationRequests();
    } catch (error) {
        console.error('Error cancelling regularization:', error);
        showToast(error.message || 'Failed to cancel request', 'error');
    }
}

/**
 * Open overtime modal
 */
function openOvertimeModal() {
    document.getElementById('overtimeForm')?.reset();
    openModal('overtimeModal');
}

/**
 * Submit overtime request
 */
async function submitOvertime() {
    try {
        const date = document.getElementById('otDate').value;
        const startTime = document.getElementById('otStartTime').value;
        const endTime = document.getElementById('otEndTime').value;
        const reason = document.getElementById('otReason').value;
        const task = document.getElementById('otTask').value;

        if (!date || !startTime || !endTime || !reason) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        // v3.0.52: Fixed API call format
        await api.request('/hrms/attendance/overtime', {
            method: 'POST',
            body: JSON.stringify({
                date, planned_start: startTime, planned_end: endTime, reason, task
            })
        });

        showToast('Overtime request submitted', 'success');
        closeModal('overtimeModal');
        loadOvertimeRequests();
    } catch (error) {
        console.error('Error submitting overtime:', error);
        showToast(error.message || 'Failed to submit request', 'error');
    }
}

/**
 * Show apply leave modal
 */
async function showApplyLeaveModal() {
    // Reset form first
    document.getElementById('applyLeaveForm')?.reset();

    // Initialize SearchableDropdowns for modal if not already done
    initializeLeaveModalDropdowns();

    // Load leave types
    try {
        const response = await api.request('/hrms/leave/types');
        const types = response?.types || response || [];

        // Prepare options for SearchableDropdown
        const options = [
            { value: '', label: 'Select Leave Type' },
            ...types.map(t => ({
                value: t.id,
                label: t.leave_name || t.leave_type_name || t.name
            }))
        ];

        if (leaveTypeDropdown) {
            leaveTypeDropdown.setOptions(options);
            leaveTypeDropdown.setValue('');
        } else {
            // Fallback to native select
            const select = document.getElementById('leaveType');
            if (select) {
                select.innerHTML = '<option value="">Select Leave Type</option>' +
                    types.map(t => `<option value="${t.id}">${escapeHtml(t.leave_name || t.leave_type_name || t.name)}</option>`).join('');
            }
        }
    } catch (e) {
        console.error('Error loading leave types:', e);
    }

    // Reset halfDay dropdown
    if (halfDayDropdown) {
        halfDayDropdown.setValue('');
    }

    openModal('applyLeaveModal');
}

/**
 * Initialize SearchableDropdowns for Apply Leave modal
 */
function initializeLeaveModalDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    // Convert leaveType dropdown
    if (document.getElementById('leaveType') && !leaveTypeDropdown) {
        leaveTypeDropdown = convertSelectToSearchable('leaveType', {
            placeholder: 'Select Leave Type',
            searchPlaceholder: 'Search leave types...'
        });
    }

    // Convert halfDay dropdown
    if (document.getElementById('halfDay') && !halfDayDropdown) {
        halfDayDropdown = convertSelectToSearchable('halfDay', {
            placeholder: 'No',
            searchPlaceholder: 'Select...'
        });
    }
}

/**
 * Submit leave application
 */
async function submitLeaveApplication() {
    try {
        // Get values from SearchableDropdown if available, otherwise from native select
        const leaveType = leaveTypeDropdown
            ? leaveTypeDropdown.getValue()
            : document.getElementById('leaveType').value;
        const fromDate = document.getElementById('fromDate').value;
        const toDate = document.getElementById('toDate').value;
        const reason = document.getElementById('leaveReason').value;
        const halfDay = halfDayDropdown
            ? halfDayDropdown.getValue()
            : document.getElementById('halfDay').value;
        const emergencyContact = document.getElementById('emergencyContact').value;

        if (!leaveType || !fromDate || !toDate || !reason) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        // v3.0.55: Fixed field names to match backend (start_date, end_date)
        await api.request('/hrms/leave/requests', {
            method: 'POST',
            body: JSON.stringify({
                leave_type_id: leaveType,
                start_date: fromDate,
                end_date: toDate,
                reason,
                is_half_day: halfDay === 'first_half' || halfDay === 'second_half' ? true : false,
                half_day_type: halfDay || null
            })
        });

        showToast('Leave application submitted', 'success');
        closeModal('applyLeaveModal');
        loadMyLeaves();
    } catch (error) {
        console.error('Error submitting leave:', error);
        showToast(error.message || 'Failed to submit application', 'error');
    }
}

/**
 * Show encash leave modal
 */
async function showEncashLeaveModal() {
    // Reset form
    document.getElementById('encashLeaveForm')?.reset();

    // Initialize SearchableDropdown for encashLeaveType if not already done
    if (typeof convertSelectToSearchable === 'function') {
        if (document.getElementById('encashLeaveType') && !encashLeaveTypeDropdown) {
            encashLeaveTypeDropdown = convertSelectToSearchable('encashLeaveType', {
                placeholder: 'Select Leave Type',
                searchPlaceholder: 'Search leave types...',
                onChange: updateEncashPreview
            });
        }
    }

    // Load leave types with encashment enabled
    try {
        const response = await api.request('/hrms/leave/types');
        const types = (response?.types || response || []).filter(t => t.encashment_enabled || t.allow_encashment);

        const options = [
            { value: '', label: 'Select Leave Type' },
            ...types.map(t => ({
                value: t.id,
                label: t.leave_name || t.leave_type_name || t.name
            }))
        ];

        if (encashLeaveTypeDropdown) {
            encashLeaveTypeDropdown.setOptions(options);
            encashLeaveTypeDropdown.setValue('');
        } else {
            const select = document.getElementById('encashLeaveType');
            if (select) {
                select.innerHTML = '<option value="">Select Leave Type</option>' +
                    types.map(t => `<option value="${t.id}">${escapeHtml(t.leave_name || t.leave_type_name || t.name)}</option>`).join('');
            }
        }
    } catch (e) {
        console.error('Error loading leave types:', e);
    }

    openModal('encashLeaveModal');
}

/**
 * Open loan modal
 */
function openLoanModal() {
    document.getElementById('loanForm')?.reset();

    // Initialize SearchableDropdown for loanType if not already done
    if (typeof convertSelectToSearchable === 'function') {
        if (document.getElementById('loanType') && !loanTypeDropdown) {
            loanTypeDropdown = convertSelectToSearchable('loanType', {
                placeholder: 'Select Type',
                searchPlaceholder: 'Search loan types...'
            });
        }
    }

    // Reset dropdown
    if (loanTypeDropdown) {
        loanTypeDropdown.setValue('');
    }

    openModal('loanModal');
}

/**
 * Open reimbursement modal
 */
function openReimbursementModal() {
    document.getElementById('reimbursementForm')?.reset();

    // Initialize SearchableDropdown for expenseType if not already done
    if (typeof convertSelectToSearchable === 'function') {
        if (document.getElementById('expenseType') && !expenseTypeDropdown) {
            expenseTypeDropdown = convertSelectToSearchable('expenseType', {
                placeholder: 'Select Type',
                searchPlaceholder: 'Search expense types...'
            });
        }
    }

    // Reset dropdown
    if (expenseTypeDropdown) {
        expenseTypeDropdown.setValue('');
    }

    openModal('reimbursementModal');
}

/**
 * Update encashment preview - fetch leave balance and calculate available days
 */
async function updateEncashPreview() {
    const leaveTypeId = encashLeaveTypeDropdown
        ? encashLeaveTypeDropdown.getValue()
        : document.getElementById('encashLeaveType')?.value;
    const days = parseFloat(document.getElementById('encashDays')?.value) || 0;

    // Update available days display
    const availableEl = document.getElementById('encashAvailableDays');
    const previewEl = document.getElementById('encashAmountPreview');

    if (!leaveTypeId) {
        if (availableEl) availableEl.textContent = 'Available: 0 days';
        if (previewEl) previewEl.textContent = '--';
        // Store available days for validation
        window.encashableBalance = 0;
        return;
    }

    // Fetch leave balance for the selected leave type
    try {
        const year = new Date().getFullYear();
        const response = await api.request(`/hrms/leave/balances?year=${year}`);
        const balances = response?.balances || response || [];

        // Find the balance for the selected leave type
        const balance = balances.find(b => b.leave_type_id === leaveTypeId);

        if (balance) {
            // Calculate available balance: total + carried_forward - used - pending - encashed
            const total = parseFloat(balance.total_days) || 0;
            const carried = parseFloat(balance.carried_forward_days) || 0;
            const used = parseFloat(balance.used_days) || 0;
            const pending = parseFloat(balance.pending_days) || 0;
            const encashed = parseFloat(balance.encashed_days) || 0;
            const available = total + carried - used - pending - encashed;

            if (availableEl) availableEl.textContent = `Available: ${Math.max(0, available)} days`;
            // Store available days for validation
            window.encashableBalance = Math.max(0, available);
        } else {
            if (availableEl) availableEl.textContent = 'Available: 0 days';
            window.encashableBalance = 0;
        }
    } catch (error) {
        console.error('Error fetching leave balance for encashment:', error);
        if (availableEl) availableEl.textContent = 'Available: -- days';
        window.encashableBalance = 0;
    }

    // Update amount preview
    if (previewEl) {
        if (days > 0 && window.encashableBalance > 0) {
            previewEl.textContent = 'Contact HR for rate';
        } else {
            previewEl.textContent = '--';
        }
    }
}

/**
 * Submit loan application
 */
async function submitLoanApplication() {
    try {
        const loanType = loanTypeDropdown
            ? loanTypeDropdown.getValue()
            : document.getElementById('loanType')?.value;
        const amount = document.getElementById('loanAmount')?.value;
        const emi = document.getElementById('loanEmi')?.value;
        const reason = document.getElementById('loanReason')?.value;

        if (!loanType || !amount || !emi || !reason) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        // v3.0.52: Fixed API call format and field names
        await api.request('/hrms/payroll-processing/loans', {
            method: 'POST',
            body: JSON.stringify({
                loan_type: loanType,
                principal_amount: parseFloat(amount),
                tenure_months: parseInt(emi),
                interest_rate: 0, // Interest-free by default, HR can update if needed
                purpose: reason
            })
        });

        showToast('Loan application submitted', 'success');
        closeModal('loanModal');
        loadLoans();
    } catch (error) {
        console.error('Error submitting loan:', error);
        showToast(error.message || 'Failed to submit loan application', 'error');
    }
}

/**
 * v3.0.54: Withdraw loan application (only pending/rejected)
 */
async function withdrawLoan(loanId) {
    const confirmed = await Confirm.show({
        title: 'Withdraw Loan Application',
        message: 'Are you sure you want to withdraw this loan application?',
        type: 'warning',
        confirmText: 'Withdraw'
    });
    if (!confirmed) return;

    try {
        await api.request(`/hrms/payroll-processing/my-loans/${loanId}`, {
            method: 'DELETE'
        });

        showToast('Loan application withdrawn successfully', 'success');
        loadLoans();
    } catch (error) {
        console.error('Error withdrawing loan:', error);
        showToast(error.message || 'Failed to withdraw loan application', 'error');
    }
}

/**
 * v3.0.54: Withdraw reimbursement/adjustment claim (only pending/rejected)
 */
async function withdrawAdjustment(adjustmentId) {
    const confirmed = await Confirm.show({
        title: 'Withdraw Claim',
        message: 'Are you sure you want to withdraw this claim?',
        type: 'warning',
        confirmText: 'Withdraw'
    });
    if (!confirmed) return;

    try {
        await api.request(`/hrms/payroll-processing/my-adjustments/${adjustmentId}`, {
            method: 'DELETE'
        });

        showToast('Claim withdrawn successfully', 'success');
        loadReimbursements();
    } catch (error) {
        console.error('Error withdrawing claim:', error);
        showToast(error.message || 'Failed to withdraw claim', 'error');
    }
}

/**
 * Submit reimbursement claim
 * v3.0.52: Connected to backend adjustments/claim API
 * v3.0.53: Updated to use FormData for atomic file upload (optional receipt)
 */
async function submitReimbursement() {
    try {
        const expenseType = expenseTypeDropdown
            ? expenseTypeDropdown.getValue()
            : document.getElementById('expenseType')?.value;
        const expenseDate = document.getElementById('expenseDate')?.value;
        const amount = document.getElementById('expenseAmount')?.value;
        const description = document.getElementById('expenseDescription')?.value;
        const receiptInput = document.getElementById('expenseReceipt');
        const receiptFile = receiptInput?.files?.[0];

        if (!expenseType || !expenseDate || !amount || !description) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        if (parseFloat(amount) <= 0) {
            showToast('Amount must be greater than 0', 'error');
            return;
        }

        // v3.0.53: Validate receipt file if provided (optional, max 5MB, image/pdf only)
        if (receiptFile) {
            const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
            if (!allowedTypes.includes(receiptFile.type)) {
                showToast('Invalid receipt file type. Only PDF, JPEG, and PNG are allowed.', 'error');
                return;
            }
            const maxSizeBytes = 5 * 1024 * 1024; // 5MB
            if (receiptFile.size > maxSizeBytes) {
                showToast('Receipt file too large. Maximum size is 5MB.', 'error');
                return;
            }
        }

        // v3.0.53: Build FormData for atomic upload (file + data together)
        const formData = new FormData();
        formData.append('expense_type', expenseType);
        formData.append('expense_date', expenseDate);
        formData.append('amount', parseFloat(amount).toString());
        formData.append('description', description);

        // Append receipt file if provided (optional)
        if (receiptFile) {
            formData.append('receipt', receiptFile);
        }

        // v3.0.53: Use the new API method that handles FormData
        await api.submitReimbursementClaim(formData);

        showToast('Reimbursement claim submitted successfully! Pending HR approval.', 'success');
        closeModal('reimbursementModal');

        // Reset form
        document.getElementById('reimbursementForm')?.reset();

        // Refresh claims list
        loadReimbursements();
    } catch (error) {
        console.error('Error submitting reimbursement:', error);
        showToast(error.message || 'Failed to submit claim', 'error');
    }
}

/**
 * Submit leave encashment
 */
async function submitLeaveEncashment() {
    try {
        const leaveTypeId = encashLeaveTypeDropdown
            ? encashLeaveTypeDropdown.getValue()
            : document.getElementById('encashLeaveType')?.value;
        const days = parseFloat(document.getElementById('encashDays')?.value) || 0;
        const reason = document.getElementById('encashReason')?.value;

        if (!leaveTypeId || !days) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        // Validate days against available balance
        if (window.encashableBalance && days > window.encashableBalance) {
            showToast(`Cannot encash more than ${window.encashableBalance} days`, 'error');
            return;
        }

        // Call backend API to process encashment
        const year = new Date().getFullYear();
        const response = await api.request('/hrms/leave/encash', {
            method: 'POST',
            body: JSON.stringify({
                leave_type_id: leaveTypeId,
                year: year,
                days: days
            })
        });

        showToast(response?.message || 'Leave encashment submitted successfully', 'success');
        closeModal('encashLeaveModal');

        // Refresh leave balances
        loadMyLeaves();
    } catch (error) {
        console.error('Error submitting encashment:', error);
        showToast(error.message || 'Failed to submit encashment', 'error');
    }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Format currency
 * v3.0.53: COUNTRY-AGNOSTIC - accepts currency symbol/code from backend
 * @param {number} amount - The amount to format
 * @param {string} currencySymbol - Currency symbol (e.g., '₹', '$', '£')
 * @param {string} currencyCode - Currency code (e.g., 'INR', 'USD', 'GBP')
 */
function formatCurrency(amount, currencySymbol = '', currencyCode = '') {
    if (amount === null || amount === undefined) {
        return currencySymbol ? `${currencySymbol}0` : '0';
    }

    // If we have currency code, use Intl.NumberFormat for proper localization
    if (currencyCode) {
        const localeMap = {
            'INR': 'en-IN',
            'USD': 'en-US',
            'GBP': 'en-GB',
            'EUR': 'de-DE',
            'AED': 'ar-AE',
            'IDR': 'id-ID',
            'MVR': 'en-MV'
        };
        const locale = localeMap[currencyCode] || 'en-US';
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: currencyCode,
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(amount);
        } catch (e) {
            // Fallback if currency code not supported
            return `${currencySymbol || currencyCode} ${Number(amount).toLocaleString()}`;
        }
    }

    // If only symbol provided, format with symbol
    if (currencySymbol) {
        return `${currencySymbol}${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }

    // Fallback: just format the number
    return Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * Get month name
 */
function getMonthName(month) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month] || 'Unknown';
}

/**
 * Format date for display
 */
function formatDate(dateStr, monthDay = false) {
    if (!dateStr) return '';
    const date = new Date(dateStr);

    if (monthDay) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Format time for display (HH:MM AM/PM)
 */
function formatTime(timeStr) {
    if (!timeStr) return '--';
    return new Date(timeStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format date for payslip display
 */
function formatPayslipDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Truncate text
 */
function truncateText(text, maxLength) {
    if (!text) return '';
    text = stripHtml(text);
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Strip HTML tags
 */
function stripHtml(html) {
    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Note: getStoredUser() is defined in config.js - do not duplicate here

// ==========================================
// GEOFENCE LOCATION CARDS
// ==========================================

// Global variables for geofence
let officeLocation = null;
let currentUserLocation = null;

/**
 * Check if geofence validation is required (all 3 flags must be ON)
 * Returns { required: boolean, office: object, shift: object, employee: object }
 */
async function checkGeofenceRequirement() {
    try {
        if (!currentEmployee) return { required: false };

        // Get employee data which includes office, shift, and employee geofence flags
        const employee = currentEmployee;

        // Get office details
        if (!employee.office_id) {
            console.log('No office assigned to employee');
            return { required: false };
        }

        const office = await api.request(`/hrms/offices/${employee.office_id}`);
        if (!office) {
            console.log('Office not found');
            return { required: false };
        }

        // Get shift details if assigned
        let shift = null;
        if (employee.shift_id) {
            try {
                shift = await api.request(`/hrms/shifts/${employee.shift_id}`);
            } catch (e) {
                console.log('Could not fetch shift:', e);
            }
        }

        // Check all three geofence flags
        const officeGeofenceEnabled = office.enable_geofence_attendance === true;
        const shiftGeofenceEnabled = shift?.enable_geofence_attendance === true;
        const employeeGeofenceEnabled = employee.enable_geofence_attendance === true;

        const allEnabled = officeGeofenceEnabled && shiftGeofenceEnabled && employeeGeofenceEnabled;

        console.log('Geofence check:', {
            office: officeGeofenceEnabled,
            shift: shiftGeofenceEnabled,
            employee: employeeGeofenceEnabled,
            allEnabled
        });

        return {
            required: allEnabled,
            office: office,
            shift: shift,
            employee: employee
        };
    } catch (error) {
        console.error('Error checking geofence requirement:', error);
        return { required: false };
    }
}

/**
 * Initialize geofence location cards if all 3 flags are ON
 */
async function initGeofenceLocationCards() {
    const geofenceSection = document.getElementById('geofenceLocationSection');
    if (!geofenceSection) return;

    try {
        const geofenceStatus = await checkGeofenceRequirement();

        if (!geofenceStatus.required) {
            geofenceSection.style.display = 'none';
            return;
        }

        // Show the location cards section
        geofenceSection.style.display = 'block';

        // Store office location globally
        officeLocation = {
            latitude: parseFloat(geofenceStatus.office.latitude),
            longitude: parseFloat(geofenceStatus.office.longitude),
            radius: geofenceStatus.office.geofence_radius_meters || 100,
            name: geofenceStatus.office.office_name,
            address: formatOfficeAddress(geofenceStatus.office)
        };

        // Update office location card
        updateOfficeLocationCard(geofenceStatus.office);

        // Setup event listeners for map buttons
        setupLocationCardListeners();

        // Fetch and display current location
        await refreshCurrentLocation();

    } catch (error) {
        console.error('Error initializing geofence location cards:', error);
        geofenceSection.style.display = 'none';
    }
}

/**
 * Format office address from office object
 */
function formatOfficeAddress(office) {
    const parts = [];
    if (office.address_line1) parts.push(office.address_line1);
    if (office.address_line2) parts.push(office.address_line2);
    if (office.city) parts.push(office.city);
    if (office.state) parts.push(office.state);
    if (office.postal_code) parts.push(office.postal_code);
    return parts.join(', ') || 'Address not available';
}

/**
 * Update office location card with data
 */
function updateOfficeLocationCard(office) {
    // Update office name
    const nameEl = document.getElementById('officeName');
    if (nameEl) nameEl.textContent = office.office_name || 'Office';

    // Update address
    const addressEl = document.getElementById('officeAddress');
    if (addressEl) addressEl.textContent = formatOfficeAddress(office);

    // Update radius
    const radiusEl = document.getElementById('officeRadius');
    if (radiusEl) {
        const radius = office.geofence_radius_meters || 100;
        radiusEl.textContent = `Geofence: ${radius}m`;
    }

    // Update coordinates
    const latEl = document.getElementById('officeLatitude');
    const longEl = document.getElementById('officeLongitude');
    if (latEl && office.latitude) latEl.textContent = parseFloat(office.latitude).toFixed(6);
    if (longEl && office.longitude) longEl.textContent = parseFloat(office.longitude).toFixed(6);
}

/**
 * Check geolocation permission status
 * Returns: 'granted', 'denied', 'prompt', or 'unsupported'
 */
async function checkLocationPermission() {
    if (!navigator.geolocation) {
        return 'unsupported';
    }

    // Use Permissions API if available (modern browsers)
    if (navigator.permissions && navigator.permissions.query) {
        try {
            const result = await navigator.permissions.query({ name: 'geolocation' });
            return result.state; // 'granted', 'denied', or 'prompt'
        } catch (e) {
            // Permissions API not supported for geolocation, fall back
            return 'prompt';
        }
    }

    // Fallback for browsers without Permissions API
    return 'prompt';
}

/**
 * Refresh current location
 */
async function refreshCurrentLocation() {
    const statusEl = document.getElementById('locationStatus');
    const refreshBtn = document.getElementById('refreshLocationBtn');
    const distanceValueEl = document.querySelector('.distance-value');
    const permissionBanner = document.getElementById('locationPermissionBanner');

    // Check permission status first
    const permissionStatus = await checkLocationPermission();

    if (permissionStatus === 'unsupported') {
        if (statusEl) {
            statusEl.textContent = 'Not supported';
            statusEl.className = 'ess-location-status error';
        }
        showLocationPermissionBanner('unsupported');
        return;
    }

    if (permissionStatus === 'denied') {
        if (statusEl) {
            statusEl.textContent = 'Permission denied';
            statusEl.className = 'ess-location-status error';
        }
        showLocationPermissionBanner('denied');
        return;
    }

    // Show fetching state
    if (statusEl) {
        statusEl.textContent = permissionStatus === 'prompt' ? 'Requesting permission...' : 'Fetching...';
        statusEl.className = 'ess-location-status fetching';
    }
    if (refreshBtn) {
        refreshBtn.classList.add('refreshing');
    }

    // Hide permission banner if visible
    hideLocationPermissionBanner();

    try {
        const location = await getCurrentLocation();
        currentUserLocation = location;

        // Update status
        if (statusEl) {
            statusEl.textContent = 'Location acquired';
            statusEl.className = 'ess-location-status success';
        }

        // Update coordinates and accuracy
        const latEl = document.getElementById('currentLatitude');
        const longEl = document.getElementById('currentLongitude');
        const accEl = document.getElementById('currentAccuracy');
        if (latEl) latEl.textContent = location.latitude.toFixed(6);
        if (longEl) longEl.textContent = location.longitude.toFixed(6);
        if (accEl) accEl.textContent = location.accuracy ? `±${Math.round(location.accuracy)}m` : '--';

        // v3.0.52: Update location confidence indicator
        updateLocationConfidenceUI(location.accuracy);

        // Calculate and display distance from office
        if (officeLocation && officeLocation.latitude && officeLocation.longitude) {
            const distance = calculateDistance(
                location.latitude,
                location.longitude,
                officeLocation.latitude,
                officeLocation.longitude
            );

            if (distanceValueEl) {
                distanceValueEl.textContent = formatDistance(distance);

                // Update styling based on whether within geofence
                const geofenceHint = document.getElementById('geofenceHint');
                const geofenceRadiusHint = document.getElementById('geofenceRadiusHint');

                if (distance <= officeLocation.radius) {
                    distanceValueEl.classList.add('within-range');
                    distanceValueEl.classList.remove('out-of-range');
                    // Hide geofence hint when within range
                    if (geofenceHint) geofenceHint.style.display = 'none';
                } else {
                    distanceValueEl.classList.add('out-of-range');
                    distanceValueEl.classList.remove('within-range');
                    // Show geofence hint when outside range
                    if (geofenceHint) {
                        geofenceHint.style.display = 'block';
                        if (geofenceRadiusHint) geofenceRadiusHint.textContent = officeLocation.radius;
                    }
                }
            }
        }

    } catch (error) {
        console.error('Error getting current location:', error);

        // Handle specific geolocation errors
        let errorMessage = 'Location unavailable';
        let bannerType = 'error';

        if (error.code) {
            switch (error.code) {
                case 1: // PERMISSION_DENIED
                    errorMessage = 'Permission denied';
                    bannerType = 'denied';
                    break;
                case 2: // POSITION_UNAVAILABLE
                    errorMessage = 'Position unavailable';
                    bannerType = 'unavailable';
                    break;
                case 3: // TIMEOUT
                    errorMessage = 'Request timed out';
                    bannerType = 'timeout';
                    break;
            }
        }

        if (statusEl) {
            statusEl.textContent = errorMessage;
            statusEl.className = 'ess-location-status error';
        }

        if (distanceValueEl) {
            distanceValueEl.textContent = '--';
            distanceValueEl.classList.remove('within-range', 'out-of-range');
        }

        showLocationPermissionBanner(bannerType);
    } finally {
        if (refreshBtn) {
            refreshBtn.classList.remove('refreshing');
        }
    }
}

/**
 * Show location permission banner with appropriate message
 */
function showLocationPermissionBanner(type) {
    let banner = document.getElementById('locationPermissionBanner');

    // Create banner if it doesn't exist
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'locationPermissionBanner';
        banner.className = 'ess-permission-banner';

        const currentLocationCard = document.getElementById('currentLocationCard');
        if (currentLocationCard) {
            currentLocationCard.appendChild(banner);
        }
    }

    let message = '';
    let icon = '';
    let showTryAgain = true;
    let showHowToEnable = false;

    switch (type) {
        case 'denied':
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
            message = `<strong>Location access denied</strong><br>Enable location in browser settings to use geofence attendance.`;
            showHowToEnable = true;
            break;
        case 'unsupported':
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
            message = `<strong>Geolocation not supported</strong><br>Your browser does not support location services.`;
            showTryAgain = false;
            break;
        case 'unavailable':
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
            message = `<strong>Location unavailable</strong><br>Could not determine your position. Check your device's location settings.`;
            showHowToEnable = true;
            break;
        case 'timeout':
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
            message = `<strong>Location request timed out</strong><br>Please try again or check your connection.`;
            break;
        default:
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
            message = `<strong>Location error</strong><br>Could not get your location. Please try again.`;
    }

    // Build action buttons
    let actions = '';
    if (showTryAgain || showHowToEnable) {
        actions = '<div class="permission-banner-actions">';
        if (showTryAgain) {
            actions += `<button class="permission-try-again-btn" onclick="retryLocationPermission()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                Try Again
            </button>`;
        }
        if (showHowToEnable) {
            actions += `<button class="permission-help-btn" onclick="showLocationHelpModal()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                How to Enable
            </button>`;
        }
        actions += '</div>';
    }

    banner.innerHTML = `
        <div class="permission-banner-icon">${icon}</div>
        <div class="permission-banner-content">
            <div class="permission-banner-message">${message}</div>
            ${actions}
        </div>
    `;
    banner.style.display = 'flex';
}

/**
 * Retry getting location permission
 */
async function retryLocationPermission() {
    // Hide any existing banner
    hideLocationPermissionBanner();

    // Update status to show we're trying
    const statusEl = document.getElementById('currentLocationStatus');
    if (statusEl) {
        statusEl.textContent = 'Requesting permission...';
        statusEl.className = 'ess-location-status fetching';
    }

    // Try to get location again
    await refreshCurrentLocation();
}

/**
 * Show modal with instructions on how to enable location
 */
function showLocationHelpModal() {
    // Create modal if it doesn't exist
    let modal = document.getElementById('locationHelpModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'locationHelpModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content ess-help-modal">
                <div class="modal-header">
                    <h3>Enable Location Access</h3>
                    <button class="modal-close" onclick="closeLocationHelpModal()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="modal-body ess-help-body">
                    <div class="ess-help-quickfix">
                        <div class="quickfix-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                        </div>
                        <div class="quickfix-content">
                            <strong>Quick Fix</strong>
                            <p>Click the <strong>🔒 lock icon</strong> in address bar → <strong>Location</strong> → <strong>Allow</strong></p>
                        </div>
                    </div>

                    <div class="ess-help-tabs">
                        <div class="help-tab-buttons">
                            <button class="help-tab-btn active" onclick="switchHelpTab('chrome')">Chrome/Edge</button>
                            <button class="help-tab-btn" onclick="switchHelpTab('safari')">Safari</button>
                            <button class="help-tab-btn" onclick="switchHelpTab('mobile')">Mobile</button>
                        </div>
                        <div class="help-tab-content">
                            <div class="help-tab-pane active" id="helpTabChrome">
                                <ol>
                                    <li><strong>⋮</strong> menu → <strong>Settings</strong></li>
                                    <li><strong>Privacy and security</strong> → <strong>Site settings</strong> → <strong>Location</strong></li>
                                    <li>Find this site → <strong>"Allow"</strong></li>
                                </ol>
                            </div>
                            <div class="help-tab-pane" id="helpTabSafari">
                                <ol>
                                    <li><strong>Safari</strong> menu → <strong>Settings</strong></li>
                                    <li><strong>Websites</strong> tab → <strong>Location</strong></li>
                                    <li>Find this site → <strong>"Allow"</strong></li>
                                </ol>
                            </div>
                            <div class="help-tab-pane" id="helpTabMobile">
                                <ol>
                                    <li>Open device <strong>Settings</strong></li>
                                    <li><strong>Privacy</strong> → <strong>Location Services</strong></li>
                                    <li>Find browser → <strong>"While Using"</strong></li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer ess-help-footer">
                    <button class="btn btn-secondary" onclick="closeLocationHelpModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="closeLocationHelpModal(); retryLocationPermission();">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                        Try Again
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
}

/**
 * Switch help tab
 */
function switchHelpTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.help-tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    // Update tab panes
    document.querySelectorAll('.help-tab-pane').forEach(pane => pane.classList.remove('active'));
    const tabMap = { chrome: 'helpTabChrome', safari: 'helpTabSafari', mobile: 'helpTabMobile' };
    document.getElementById(tabMap[tab])?.classList.add('active');
}

/**
 * Close location help modal
 */
function closeLocationHelpModal() {
    const modal = document.getElementById('locationHelpModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Hide location permission banner
 */
function hideLocationPermissionBanner() {
    const banner = document.getElementById('locationPermissionBanner');
    if (banner) {
        banner.style.display = 'none';
    }
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Format distance for display
 */
function formatDistance(meters) {
    if (meters < 1000) {
        return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Setup event listeners for location cards
 */
function setupLocationCardListeners() {
    // Office map button
    const officeMapBtn = document.getElementById('viewOfficeMapBtn');
    if (officeMapBtn) {
        officeMapBtn.addEventListener('click', () => {
            if (officeLocation) {
                openMapModal('Office Location', officeLocation.latitude, officeLocation.longitude);
            }
        });
    }

    // Current location map button
    const currentMapBtn = document.getElementById('viewCurrentMapBtn');
    if (currentMapBtn) {
        currentMapBtn.addEventListener('click', () => {
            if (currentUserLocation) {
                openMapModal('Your Location', currentUserLocation.latitude, currentUserLocation.longitude);
            } else {
                showToast('Location not available. Click Refresh to get your location.', 'warning');
            }
        });
    }

    // Refresh location button
    const refreshBtn = document.getElementById('refreshLocationBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshCurrentLocation);
    }
}

/**
 * Open Google Maps modal with coordinates
 */
function openMapModal(title, latitude, longitude) {
    const overlay = document.getElementById('mapModalOverlay');
    const titleEl = document.getElementById('mapModalTitle');
    const latEl = document.getElementById('mapLatitude');
    const longEl = document.getElementById('mapLongitude');
    const iframe = document.getElementById('googleMapIframe');
    const openLink = document.getElementById('openInGoogleMaps');

    if (!overlay || !iframe) return;

    // Update title
    if (titleEl) titleEl.textContent = title;

    // Update coordinates display
    if (latEl) latEl.textContent = latitude.toFixed(6);
    if (longEl) longEl.textContent = longitude.toFixed(6);

    // Set iframe source to Google Maps embed
    // Using place mode which shows a marker at the coordinates
    const mapUrl = `https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d500!2d${longitude}!3d${latitude}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zM!5e0!3m2!1sen!2s!4v1!5m2!1sen!2s`;
    iframe.src = mapUrl;

    // Update "Open in Google Maps" link
    if (openLink) {
        openLink.href = `https://www.google.com/maps?q=${latitude},${longitude}`;
    }

    // Show modal
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

/**
 * Close Google Maps modal
 */
function closeMapModal() {
    const overlay = document.getElementById('mapModalOverlay');
    const iframe = document.getElementById('googleMapIframe');

    if (overlay) {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    // Clear iframe to stop loading
    if (iframe) {
        iframe.src = '';
    }
}

// Close modal when clicking overlay
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('mapModalOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeMapModal();
            }
        });
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('mapModalOverlay');
        if (overlay && overlay.style.display === 'flex') {
            closeMapModal();
        }
    }
});

// ==========================================
// CALCULATION PROOF - v3.0.52
// ==========================================

/**
 * View calculation proof for a PROCESSED payslip in ESS mode.
 * v3.0.52: Now uses centralized PayslipModal with ESS mode enabled.
 * - Hides deductions where employerPortion='organizational_overhead'
 * - Hides JSON Data tab (employees don't need raw JSON)
 */
async function viewCalculationProofProcessed(payslipId) {
    // Use centralized PayslipModal with ESS mode
    // This filters out organizational_overhead items and hides JSON tab
    return PayslipModal.viewCalculationProofEss(payslipId, false);
}

/**
 * Format date for proof display
 */
function formatDateForProof(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

/**
 * Build the calculation proof UI from JSON data.
 * v3.0.51: Ported from payroll.js for self-service page.
 */
function buildCalculationProofUIESS(proof, response) {
    const currencySymbol = proof.currencySymbol || '₹';
    const fmt = (amount) => `${currencySymbol} ${(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const pct = (value) => `${(value || 0).toFixed(2)}%`;

    const jsonString = JSON.stringify(proof, null, 2);

    return `
        <div class="modal-dialog modal-dialog-centered modal-xl">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right: 8px; vertical-align: middle;">
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        Calculation - ${proof.employeeName || response.employee_name} (${proof.employeeCode || response.employee_code})
                    </h5>
                    <button class="close-btn" onclick="closeModal('calculationProofModal')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="modal-body proof-modal-body">
                    <!-- Tabs Navigation -->
                    <div class="proof-tabs">
                        <button class="proof-tab active" onclick="switchProofTabESS('formatted')">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                            </svg>
                            Formatted View
                        </button>
                        <button class="proof-tab" onclick="switchProofTabESS('json')">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                            </svg>
                            JSON Data
                        </button>
                        <div class="proof-tab-actions">
                            <button class="btn btn-secondary btn-sm" onclick="downloadCalculationProofESS()">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                                </svg>
                                Download
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="printCalculationProofESS()">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
                                </svg>
                                Print
                            </button>
                        </div>
                    </div>

                    <!-- Tab Content: Formatted View -->
                    <div class="proof-tab-content" id="proofTabFormattedESS">
                        <!-- Summary Cards Row -->
                        <div class="proof-summary-row">
                            <div class="proof-summary-card earnings">
                                <div class="summary-label">Gross Earnings</div>
                                <div class="summary-value">${fmt(proof.grossEarnings)}</div>
                            </div>
                            <div class="proof-summary-card deductions">
                                <div class="summary-label">Total Deductions</div>
                                <div class="summary-value">${fmt(proof.totalDeductions)}</div>
                            </div>
                            <div class="proof-summary-card net-pay">
                                <div class="summary-label">Net Pay</div>
                                <div class="summary-value">${fmt(proof.netPay)}</div>
                            </div>
                        </div>

                        <!-- Employee & Pay Period Info -->
                        <div class="proof-section-grid">
                            <div class="proof-card">
                                <div class="proof-card-header">
                                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                                    </svg>
                                    <span>Employee Information</span>
                                </div>
                                <div class="proof-card-body">
                                    <div class="info-grid">
                                        <div class="info-item">
                                            <span class="info-label">Name</span>
                                            <span class="info-value">${proof.employeeName || '-'}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Employee Code</span>
                                            <span class="info-value">${proof.employeeCode || '-'}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Department</span>
                                            <span class="info-value">${proof.departmentName || '-'}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Designation</span>
                                            <span class="info-value">${proof.designationName || '-'}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Office</span>
                                            <span class="info-value">${proof.officeName || '-'} (${proof.officeCode || '-'})</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Location</span>
                                            <span class="info-value">${proof.stateName || '-'}, ${proof.countryName || proof.countryCode || '-'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="proof-card">
                                <div class="proof-card-header">
                                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                                    </svg>
                                    <span>Pay Period Details</span>
                                </div>
                                <div class="proof-card-body">
                                    <div class="info-grid">
                                        <div class="info-item">
                                            <span class="info-label">Pay Period</span>
                                            <span class="info-value">${formatDateForProof(proof.payPeriodStart)} - ${formatDateForProof(proof.payPeriodEnd)}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Financial Year</span>
                                            <span class="info-value">${proof.financialYear || '-'}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Total Working Days</span>
                                            <span class="info-value">${proof.totalWorkingDays || 0}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Days Worked</span>
                                            <span class="info-value">${proof.daysWorked || 0}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Proration Factor</span>
                                            <span class="info-value">${((proof.proratedFactor || 1) * 100).toFixed(2)}%</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">LOP Days</span>
                                            <span class="info-value ${(proof.lopDays || 0) > 0 ? 'text-warning' : ''}">${proof.lopDays || 0}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Attendance Exemption Card -->
                        ${proof.isAttendanceExempt ? `
                        <div class="proof-card attendance-exempt-card">
                            <div class="proof-card-header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white;">
                                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                                </svg>
                                <span>Attendance Exemption</span>
                                <span style="margin-left: auto; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px; font-size: 11px;">EXEMPT</span>
                            </div>
                            <div class="proof-card-body">
                                <div class="info-grid">
                                    <div class="info-item">
                                        <span class="info-label">Status</span>
                                        <span class="info-value" style="color: #10b981; font-weight: 600;">✓ Attendance Exempt</span>
                                    </div>
                                    <div class="info-item">
                                        <span class="info-label">Exemption Source</span>
                                        <span class="info-value">${proof.attendanceExemptSource === 'designation' ? 'Designation Default' : proof.attendanceExemptSource === 'employee_override' ? 'Employee Override' : proof.attendanceExemptSource || '-'}</span>
                                    </div>
                                </div>
                                <div style="margin-top: 12px; padding: 10px 12px; background: #ecfdf5; border-radius: 6px; border-left: 3px solid #10b981;">
                                    <p style="margin: 0; font-size: 13px; color: #065f46; line-height: 1.5;">
                                        ${proof.attendanceExemptLopNote || 'This employee is exempt from clock-in/out attendance tracking. LOP is calculated from unpaid leave only.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                        ` : ''}

                        <!-- Compensation Card -->
                        <div class="proof-card">
                            <div class="proof-card-header">
                                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                </svg>
                                <span>Compensation Details</span>
                            </div>
                            <div class="proof-card-body">
                                <div class="compensation-grid">
                                    <div class="comp-item">
                                        <span class="comp-label">Annual CTC</span>
                                        <span class="comp-value">${fmt(proof.annualCTC)}</span>
                                    </div>
                                    <div class="comp-item">
                                        <span class="comp-label">Monthly CTC</span>
                                        <span class="comp-value">${fmt(proof.monthlyCTC)}</span>
                                    </div>
                                    <div class="comp-item">
                                        <span class="comp-label">Salary Structure</span>
                                        <span class="comp-value">${proof.salaryStructureName || '-'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Version Timeline Section -->
                        ${buildVersionTimelineSectionESS(proof, fmt)}

                        <!-- Earnings Table -->
                        ${buildEarningsSectionESS(proof, fmt)}

                        <!-- Deductions Table -->
                        ${buildDeductionsSectionESS(proof, fmt)}

                        <!-- Voluntary Deductions Section -->
                        ${buildVoluntaryDeductionsSectionESS(proof, fmt)}

                        <!-- Adjustments Section -->
                        ${buildAdjustmentsSectionESS(proof, fmt)}

                        <!-- Tax Calculation Section -->
                        ${buildTaxCalculationSectionESS(proof, fmt, pct)}

                        <!-- Employer Contributions -->
                        ${buildEmployerContributionsSectionESS(proof, fmt)}

                        <!-- Location Breakdown Section -->
                        ${buildLocationBreakdownSectionESS(proof, fmt)}

                        <!-- Verification & Footer -->
                        <div class="proof-card verification-card">
                            <div class="proof-card-header">
                                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                </svg>
                                <span>Verification Summary</span>
                            </div>
                            <div class="proof-card-body">
                                <div class="verification-grid">
                                    <div class="verification-item">
                                        <span class="verification-label">Gross Earnings</span>
                                        <span class="verification-value">${fmt(proof.grossEarnings)}</span>
                                        <span class="verification-check">✓</span>
                                    </div>
                                    <div class="verification-item">
                                        <span class="verification-label">Total Deductions</span>
                                        <span class="verification-value">${fmt(proof.totalDeductions)}</span>
                                        <span class="verification-check">✓</span>
                                    </div>
                                    <div class="verification-item highlight">
                                        <span class="verification-label">Net Pay (Gross - Deductions)</span>
                                        <span class="verification-value">${fmt(proof.netPay)}</span>
                                        <span class="verification-check">✓</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Footer -->
                        <div class="proof-footer">
                            <div class="footer-info">
                                <span>Generated: ${new Date(proof.generatedAt || Date.now()).toLocaleString()}</span>
                                <span>•</span>
                                <span>HyperDroid HRMS ${proof.taxCalculation?.engineVersion || 'v3.0.51'}</span>
                                ${proof.countryConfigVersion ? `<span>•</span><span>Config: ${proof.countryConfigVersion}</span>` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Tab Content: JSON Data -->
                    <div class="proof-tab-content" id="proofTabJsonESS" style="display: none;">
                        <div class="json-toolbar">
                            <button class="btn btn-secondary btn-sm" onclick="copyProofJsonESS()">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/>
                                </svg>
                                Copy JSON
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="downloadProofJsonESS()">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                                </svg>
                                Download JSON
                            </button>
                        </div>
                        <pre class="json-viewer" id="proofJsonViewer">${escapeHtmlForProof(jsonString)}</pre>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Escape HTML for proof display
 */
function escapeHtmlForProof(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Build earnings section HTML
 */
function buildEarningsSectionESS(proof, fmt) {
    const items = proof.earningsItems || [];
    if (items.length === 0) return '';

    const timeline = proof.versionTimeline || [];
    const hasMultipleVersions = proof.hasMultipleVersions || timeline.length > 1;

    if (hasMultipleVersions && timeline.length > 0) {
        return buildGroupedEarningsSectionESS(proof, fmt, timeline);
    }

    let rows = items.map(item => `
        <tr>
            <td class="component-name">${item.componentName || item.componentCode || '-'}</td>
            <td class="text-right">${fmt(item.baseAmount || item.amount)}</td>
            <td class="text-center">${item.isProrated ? `${(item.proratedFactor * 100).toFixed(1)}%` : '100%'}</td>
            <td class="text-right amount-cell">${fmt(item.amount)}</td>
        </tr>
    `).join('');

    return `
        <div class="proof-card">
            <div class="proof-card-header earnings-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/>
                </svg>
                <span>Earnings Breakdown</span>
                <span class="header-badge earnings-badge">${fmt(proof.grossEarnings)}</span>
            </div>
            <div class="proof-card-body">
                <table class="proof-table">
                    <thead>
                        <tr>
                            <th>Component</th>
                            <th class="text-right">Base Amount</th>
                            <th class="text-center">Proration</th>
                            <th class="text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td colspan="3"><strong>Total Gross Earnings</strong></td>
                            <td class="text-right"><strong>${fmt(proof.grossEarnings)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

/**
 * Build grouped earnings section
 */
function buildGroupedEarningsSectionESS(proof, fmt, timeline) {
    const items = proof.earningsItems || [];
    const groupedItems = {};
    const prorationToVersion = {};

    timeline.forEach((version, index) => {
        const totalDays = proof.totalWorkingDays || 22;
        const expectedProration = version.daysApplied / totalDays;
        prorationToVersion[expectedProration.toFixed(4)] = {
            versionCode: version.versionCode || `V${index + 1}`,
            structureName: version.structureName,
            daysApplied: version.daysApplied,
            effectiveFrom: version.effectiveFrom,
            effectiveTo: version.effectiveTo
        };
    });

    items.forEach(item => {
        const factor = item.proratedFactor || 1;
        const key = factor.toFixed(4);
        if (!groupedItems[key]) {
            groupedItems[key] = [];
        }
        groupedItems[key].push(item);
    });

    let groupedRowsHtml = '';
    let groupIndex = 0;

    for (const [prorationKey, groupItems] of Object.entries(groupedItems)) {
        const versionInfo = prorationToVersion[prorationKey] || findClosestVersionESS(prorationKey, prorationToVersion);
        const subtotal = groupItems.reduce((sum, item) => sum + (item.amount || 0), 0);

        const structureLabel = versionInfo
            ? `${versionInfo.structureName} (${versionInfo.daysApplied} days)`
            : `Period ${groupIndex + 1}`;
        const periodLabel = versionInfo && versionInfo.effectiveFrom
            ? `${formatDateForProof(versionInfo.effectiveFrom)} - ${formatDateForProof(versionInfo.effectiveTo)}`
            : '';

        groupedRowsHtml += `
            <tr class="version-group-header">
                <td colspan="4">
                    <div class="version-group-title">
                        <span class="version-badge-sm">${versionInfo?.versionCode || `V${groupIndex + 1}`}</span>
                        <span class="structure-name">${structureLabel}</span>
                        ${periodLabel ? `<span class="period-label">${periodLabel}</span>` : ''}
                    </div>
                </td>
            </tr>
        `;

        groupItems.forEach(item => {
            groupedRowsHtml += `
                <tr class="version-group-item">
                    <td class="component-name">${item.componentName || item.componentCode || '-'}</td>
                    <td class="text-right">${fmt(item.baseAmount || item.amount)}</td>
                    <td class="text-center">${item.isProrated ? `${(item.proratedFactor * 100).toFixed(1)}%` : '100%'}</td>
                    <td class="text-right amount-cell">${fmt(item.amount)}</td>
                </tr>
            `;
        });

        groupedRowsHtml += `
            <tr class="version-subtotal-row">
                <td colspan="3" class="text-right"><em>Subtotal</em></td>
                <td class="text-right"><em>${fmt(subtotal)}</em></td>
            </tr>
        `;

        groupIndex++;
    }

    return `
        <div class="proof-card">
            <div class="proof-card-header earnings-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/>
                </svg>
                <span>Earnings Breakdown</span>
                <span class="header-badge earnings-badge">${fmt(proof.grossEarnings)}</span>
            </div>
            <div class="proof-card-body">
                <p class="section-description">Earnings grouped by salary structure. Each group shows components for the period that structure was active.</p>
                <table class="proof-table grouped-earnings-table">
                    <thead>
                        <tr>
                            <th>Component</th>
                            <th class="text-right">Base Amount</th>
                            <th class="text-center">Proration</th>
                            <th class="text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groupedRowsHtml}
                    </tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td colspan="3"><strong>Total Gross Earnings</strong></td>
                            <td class="text-right"><strong>${fmt(proof.grossEarnings)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

/**
 * Find closest version match
 */
function findClosestVersionESS(prorationKey, prorationToVersion) {
    const target = parseFloat(prorationKey);
    let closest = null;
    let minDiff = Infinity;

    for (const [key, version] of Object.entries(prorationToVersion)) {
        const diff = Math.abs(parseFloat(key) - target);
        if (diff < minDiff) {
            minDiff = diff;
            closest = version;
        }
    }

    return closest;
}

/**
 * Build deductions section HTML
 */
function buildDeductionsSectionESS(proof, fmt) {
    const items = proof.deductionItems || [];
    if (items.length === 0) return '';

    const hasMultipleLocations = (proof.locationBreakdowns || []).length > 1;
    const hasJurisdictionDeductions = items.some(item => item.jurisdictionName || item.jurisdictionCode);

    let rows = items.map(item => {
        const isEligible = item.isEligible !== false;
        const eligibilityClass = isEligible ? '' : 'not-eligible';
        const eligibilityIcon = isEligible ? '✓' : '✗';
        const eligibilityReason = item.eligibilityReason || '';

        const componentName = item.componentName || item.componentCode || '-';
        const jurisdictionLabel = item.jurisdictionName
            ? `<span class="jurisdiction-label">(${item.jurisdictionName})</span>`
            : '';

        return `
            <tr class="${eligibilityClass}">
                <td class="component-name">
                    ${componentName}
                    ${jurisdictionLabel}
                    ${eligibilityReason ? `<span class="eligibility-reason" title="${eligibilityReason}">ℹ</span>` : ''}
                </td>
                <td class="text-center">
                    <span class="eligibility-badge ${isEligible ? 'eligible' : 'not-eligible'}">${eligibilityIcon}</span>
                </td>
                <td class="text-right amount-cell">${fmt(item.amount)}</td>
            </tr>
        `;
    }).join('');

    const jurisdictionNote = hasJurisdictionDeductions && hasMultipleLocations
        ? `<p class="section-description">Some deductions (like Professional Tax) are state-specific and appear separately for each location worked.</p>`
        : '';

    return `
        <div class="proof-card">
            <div class="proof-card-header deductions-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span>Deductions Breakdown</span>
                <span class="header-badge deductions-badge">${fmt(proof.totalDeductions)}</span>
            </div>
            <div class="proof-card-body">
                ${jurisdictionNote}
                <table class="proof-table">
                    <thead>
                        <tr>
                            <th>Component</th>
                            <th class="text-center">Eligible</th>
                            <th class="text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td colspan="2"><strong>Total Deductions</strong></td>
                            <td class="text-right"><strong>${fmt(proof.totalDeductions)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

/**
 * Build voluntary deductions section
 */
function buildVoluntaryDeductionsSectionESS(proof, fmt) {
    const items = proof.voluntaryDeductionItems || [];
    if (items.length === 0) return '';

    let rows = items.map(item => {
        const isProrated = item.isProrated === true;
        const proratedBadge = isProrated
            ? `<span class="proration-badge" title="${formatProratedReasonESS(item.proratedReason)}">${(item.proratedFactor * 100).toFixed(0)}%</span>`
            : '';

        return `
            <tr>
                <td class="component-name">
                    ${item.deductionTypeName || '-'}
                    ${proratedBadge}
                </td>
                <td class="text-center">${formatVoluntaryCategoryESS(item.category)}</td>
                <td class="text-right amount-cell">${fmt(item.fullAmount)}</td>
                <td class="text-right amount-cell ${isProrated ? 'prorated' : ''}">${fmt(item.deductedAmount)}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="proof-card">
            <div class="proof-card-header voluntary-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                </svg>
                <span>Voluntary Deductions</span>
                <span class="header-badge voluntary-badge">${fmt(proof.totalVoluntaryDeductions)}</span>
            </div>
            <div class="proof-card-body">
                <p class="section-description">Employee-elected deductions (insurance, savings, etc.)</p>
                <table class="proof-table">
                    <thead>
                        <tr>
                            <th>Deduction Type</th>
                            <th class="text-center">Category</th>
                            <th class="text-right">Full Amount</th>
                            <th class="text-right">Deducted</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td colspan="3"><strong>Total Voluntary Deductions</strong></td>
                            <td class="text-right"><strong>${fmt(proof.totalVoluntaryDeductions)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

/**
 * Format voluntary category
 */
function formatVoluntaryCategoryESS(category) {
    if (!category) return 'Other';
    const categoryMap = {
        'benefits': 'Benefits',
        'insurance': 'Insurance',
        'savings': 'Savings',
        'lease': 'Lease',
        'other': 'Other'
    };
    return categoryMap[category.toLowerCase()] || category;
}

/**
 * Format proration reason
 */
function formatProratedReasonESS(reason) {
    if (!reason) return 'Prorated';
    const reasonMap = {
        'mid_month_enrollment': 'Mid-month enrollment',
        'mid_month_opt_out': 'Mid-month opt-out',
        'amount_change': 'Amount change mid-period'
    };
    return reasonMap[reason.toLowerCase()] || reason.replace(/_/g, ' ');
}

/**
 * Build adjustments section
 */
function buildAdjustmentsSectionESS(proof, fmt) {
    const items = proof.adjustmentItems || [];
    if (items.length === 0) return '';

    const additions = items.filter(item => item.isAddition !== false);
    const deductions = items.filter(item => item.isAddition === false);

    const formatAdjType = (type) => {
        const typeMap = {
            'bonus': 'Bonus',
            'reimbursement': 'Reimbursement',
            'incentive': 'Incentive',
            'recovery': 'Recovery',
            'deduction': 'Deduction',
            'arrears': 'Arrears'
        };
        return type ? (typeMap[type.toLowerCase()] || type.replace(/_/g, ' ')) : 'Adjustment';
    };

    let additionRows = additions.length > 0 ?
        additions.map(item => `
            <tr>
                <td class="component-name">
                    <span class="adjustment-type addition">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="vertical-align: middle; margin-right: 4px;">
                            <path d="M12 4v16m8-8H4"/>
                        </svg>
                        ${item.displayType || formatAdjType(item.adjustmentType)}
                    </span>
                </td>
                <td class="text-left" style="font-size: 0.85rem; color: var(--text-secondary);">${item.reason || '-'}</td>
                <td class="text-right amount-cell addition-amount">+${fmt(item.amount)}</td>
            </tr>
        `).join('') :
        '<tr><td colspan="3" class="text-center text-muted">No additional earnings</td></tr>';

    let deductionRows = deductions.length > 0 ?
        deductions.map(item => `
            <tr>
                <td class="component-name">
                    <span class="adjustment-type deduction">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="vertical-align: middle; margin-right: 4px;">
                            <path d="M20 12H4"/>
                        </svg>
                        ${item.displayType || formatAdjType(item.adjustmentType)}
                    </span>
                </td>
                <td class="text-left" style="font-size: 0.85rem; color: var(--text-secondary);">${item.reason || '-'}</td>
                <td class="text-right amount-cell deduction-amount">-${fmt(item.amount)}</td>
            </tr>
        `).join('') :
        '<tr><td colspan="3" class="text-center text-muted">No additional deductions</td></tr>';

    const totalAdditions = proof.totalAdjustmentsAddition || 0;
    const totalDeductions = proof.totalAdjustmentsDeduction || 0;
    const netAdjustment = totalAdditions - totalDeductions;
    const netClass = netAdjustment >= 0 ? 'addition-amount' : 'deduction-amount';
    const netSign = netAdjustment >= 0 ? '+' : '';

    return `
        <div class="proof-card">
            <div class="proof-card-header adjustments-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"/>
                    <path d="M9 12h6"/>
                </svg>
                <span>Adjustments</span>
                <span class="header-badge ${netAdjustment >= 0 ? 'earnings-badge' : 'deduction-badge'}">${netSign}${fmt(Math.abs(netAdjustment))}</span>
            </div>
            <div class="proof-card-body">
                <p class="section-description">One-time adjustments for this pay period (bonus, reimbursement, incentive, recovery)</p>

                <div class="adjustments-subsection">
                    <h6 class="subsection-title additions-title">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M12 4v16m8-8H4"/>
                        </svg>
                        Additional Earnings
                    </h6>
                    <table class="proof-table adjustments-table">
                        <thead>
                            <tr>
                                <th>Type</th>
                                <th>Reason</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${additionRows}
                        </tbody>
                        ${additions.length > 0 ? `
                        <tfoot>
                            <tr class="subtotal-row">
                                <td colspan="2"><strong>Total Additions</strong></td>
                                <td class="text-right addition-amount"><strong>+${fmt(totalAdditions)}</strong></td>
                            </tr>
                        </tfoot>
                        ` : ''}
                    </table>
                </div>

                <div class="adjustments-subsection" style="margin-top: 1rem;">
                    <h6 class="subsection-title deductions-title">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M20 12H4"/>
                        </svg>
                        Additional Deductions
                    </h6>
                    <table class="proof-table adjustments-table">
                        <thead>
                            <tr>
                                <th>Type</th>
                                <th>Reason</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${deductionRows}
                        </tbody>
                        ${deductions.length > 0 ? `
                        <tfoot>
                            <tr class="subtotal-row">
                                <td colspan="2"><strong>Total Deductions</strong></td>
                                <td class="text-right deduction-amount"><strong>-${fmt(totalDeductions)}</strong></td>
                            </tr>
                        </tfoot>
                        ` : ''}
                    </table>
                </div>

                <div class="adjustment-net-impact" style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 500;">Net Impact from Adjustments</span>
                    <span class="${netClass}" style="font-size: 1.1rem; font-weight: 600;">${netSign}${fmt(Math.abs(netAdjustment))}</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Build tax calculation section
 */
function buildTaxCalculationSectionESS(proof, fmt, pct) {
    const tax = proof.taxCalculation;
    if (!tax) return '';

    let slabRows = '';
    if (tax.slabBreakdown?.slabs) {
        slabRows = tax.slabBreakdown.slabs.map(slab => `
            <tr>
                <td>${fmt(slab.fromAmount)} - ${slab.toAmount == null || slab.toAmount >= 99999999 ? '∞' : fmt(slab.toAmount)}</td>
                <td class="text-center">${pct(slab.rate)}</td>
                <td class="text-right">${fmt(slab.taxableAmountInSlab)}</td>
                <td class="text-right">${fmt(slab.taxAmount)}</td>
            </tr>
        `).join('');
    }

    let preTaxSection = '';
    if (tax.preTaxDeductionItems && tax.preTaxDeductionItems.length > 0) {
        const preTaxRows = tax.preTaxDeductionItems.map(item => `
            <div class="pretax-item">
                <span class="pretax-name">${item.chargeName || item.chargeCode}</span>
                <span class="pretax-amount">${fmt(item.annualAmount)}</span>
            </div>
        `).join('');
        preTaxSection = `
            <div class="pretax-section">
                <div class="pretax-title">Pre-Tax Deductions (Annual)</div>
                ${preTaxRows}
                <div class="pretax-item pretax-total">
                    <span class="pretax-name">Total Pre-Tax Deductions</span>
                    <span class="pretax-amount">${fmt(tax.preTaxDeductions)}</span>
                </div>
            </div>
        `;
    }

    return `
        <div class="proof-card tax-card">
            <div class="proof-card-header tax-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                </svg>
                <span>Income Tax Calculation</span>
                <span class="header-badge tax-badge">${fmt(tax.monthlyTDS || tax.proratedTDS)}/mo</span>
            </div>
            <div class="proof-card-body">
                <div class="tax-regime-banner">
                    <span class="regime-label">Tax Regime:</span>
                    <span class="regime-value">${tax.taxRegime || 'New'} Regime</span>
                    ${tax.taxRegimeLegalSection ? `<span class="regime-section">(${tax.taxRegimeLegalSection})</span>` : ''}
                </div>

                <div class="tax-flow">
                    <div class="tax-flow-item">
                        <span class="flow-label">Annual Gross</span>
                        <span class="flow-value">${fmt(tax.annualGross)}</span>
                    </div>
                    <div class="tax-flow-operator">−</div>
                    <div class="tax-flow-item">
                        <span class="flow-label">Standard Deduction</span>
                        <span class="flow-value">${fmt(tax.standardDeduction)}</span>
                    </div>
                    ${tax.preTaxDeductions > 0 ? `
                        <div class="tax-flow-operator">−</div>
                        <div class="tax-flow-item">
                            <span class="flow-label">Pre-Tax Deductions</span>
                            <span class="flow-value">${fmt(tax.preTaxDeductions)}</span>
                        </div>
                    ` : ''}
                    <div class="tax-flow-operator">=</div>
                    <div class="tax-flow-item result">
                        <span class="flow-label">Taxable Income</span>
                        <span class="flow-value">${fmt(tax.taxableIncome)}</span>
                    </div>
                </div>

                ${preTaxSection}

                ${slabRows ? `
                    <div class="slab-section">
                        <h4 class="slab-title">Tax Slab Breakdown</h4>
                        <table class="proof-table slab-table">
                            <thead>
                                <tr>
                                    <th>Slab Range</th>
                                    <th class="text-center">Rate</th>
                                    <th class="text-right">Taxable</th>
                                    <th class="text-right">Tax</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${slabRows}
                            </tbody>
                            <tfoot>
                                <tr class="total-row">
                                    <td colspan="3"><strong>Tax from Slabs</strong></td>
                                    <td class="text-right"><strong>${fmt(tax.slabBreakdown?.totalTaxFromSlabs || tax.taxBeforeRebate)}</strong></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                ` : ''}

                ${tax.rebate ? `
                    <div class="rebate-section ${tax.rebate.isApplicable ? 'applicable' : 'not-applicable'}">
                        <div class="rebate-header">
                            <span class="rebate-icon">${tax.rebate.isApplicable ? '✓' : '✗'}</span>
                            <span class="rebate-title">${tax.rebate.section || 'Tax Rebate'}</span>
                        </div>
                        <div class="rebate-details">
                            <span>Threshold: ${fmt(tax.rebate.incomeThreshold)} | Max Rebate: ${fmt(tax.rebate.maxRebate)}</span>
                            ${tax.rebate.isApplicable ? `<span class="rebate-amount">Applied: ${fmt(tax.rebate.actualRebate)}</span>` : ''}
                        </div>
                        ${tax.rebate.reason ? `<div class="rebate-reason">${tax.rebate.reason}</div>` : ''}
                    </div>
                ` : ''}

                <div class="tax-final">
                    <div class="tax-line">
                        <span>Tax After Rebate</span>
                        <span>${fmt(tax.taxAfterRebate)}</span>
                    </div>
                    ${tax.surchargeAmount > 0 ? `
                        <div class="tax-line">
                            <span>${tax.surchargeName || 'Surcharge'} (${pct(tax.surchargePercentage)})</span>
                            <span>+ ${fmt(tax.surchargeAmount)}</span>
                        </div>
                    ` : ''}
                    ${tax.cessAmount > 0 ? `
                        <div class="tax-line">
                            <span>${tax.cessName || 'Cess'} (${pct(tax.cessPercentage)})</span>
                            <span>+ ${fmt(tax.cessAmount)}</span>
                        </div>
                    ` : ''}
                    <div class="tax-line total">
                        <span>Total Annual Tax</span>
                        <span>${fmt(tax.totalAnnualTax)}</span>
                    </div>
                    <div class="tax-line monthly">
                        <span>Monthly TDS (${tax.monthsRemaining || 12} months remaining)</span>
                        <span class="monthly-tds">${fmt(tax.monthlyTDS || tax.proratedTDS)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Build employer contributions section
 */
function buildEmployerContributionsSectionESS(proof, fmt) {
    const items = proof.employerContributionItems || [];
    if (items.length === 0) return '';

    let rows = items.map(item => `
        <tr>
            <td class="component-name">${item.componentName || item.componentCode || '-'}</td>
            <td class="text-right amount-cell">${fmt(item.amount)}</td>
        </tr>
    `).join('');

    return `
        <div class="proof-card employer-card">
            <div class="proof-card-header employer-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                </svg>
                <span>Employer Contributions</span>
                <span class="header-badge employer-badge">${fmt(proof.totalEmployerContributions)}</span>
            </div>
            <div class="proof-card-body">
                <p class="employer-note">These contributions are paid by the employer and are not deducted from employee salary.</p>
                <table class="proof-table">
                    <thead>
                        <tr>
                            <th>Component</th>
                            <th class="text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td><strong>Total Employer Contributions</strong></td>
                            <td class="text-right"><strong>${fmt(proof.totalEmployerContributions)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

/**
 * Build version timeline section
 */
function buildVersionTimelineSectionESS(proof, fmt) {
    const timeline = proof.versionTimeline || [];
    if (timeline.length <= 1) return '';

    const rows = timeline.map((version, index) => {
        const effectiveFrom = formatDateForProof(version.effectiveFrom);
        const effectiveTo = formatDateForProof(version.effectiveTo);
        const reasonDisplay = formatChangeReasonESS(version.changeReason);
        const isFirst = index === 0;

        return `
            <tr class="${isFirst ? 'first-version' : ''}">
                <td class="version-code">
                    <span class="version-badge">${version.versionCode || `V${index + 1}`}</span>
                </td>
                <td class="structure-name">${version.structureName || '-'}</td>
                <td class="text-center">${effectiveFrom} - ${effectiveTo}</td>
                <td class="text-center">
                    <span class="days-badge">${version.daysApplied || 0} days</span>
                </td>
                <td class="text-center">
                    <span class="reason-badge ${version.changeReason || 'default'}">${reasonDisplay}</span>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="proof-card timeline-card">
            <div class="proof-card-header timeline-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span>Salary Structure Timeline</span>
                <span class="header-badge timeline-badge">${timeline.length} versions</span>
            </div>
            <div class="proof-card-body">
                <p class="section-description">Employee had salary structure changes during this pay period. Earnings are prorated based on days worked under each structure.</p>
                <table class="proof-table timeline-table">
                    <thead>
                        <tr>
                            <th>Version</th>
                            <th>Salary Structure</th>
                            <th class="text-center">Period</th>
                            <th class="text-center">Days Applied</th>
                            <th class="text-center">Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

/**
 * Format change reason
 */
function formatChangeReasonESS(reason) {
    if (!reason) return 'Standard';
    const reasonMap = {
        'salary_period': 'Standard Period',
        'structure_update': 'Structure Change',
        'transfer': 'Transfer',
        'promotion': 'Promotion',
        'revision': 'Salary Revision',
        'mid_month_change': 'Mid-Month Change'
    };
    return reasonMap[reason.toLowerCase()] || reason.replace(/_/g, ' ');
}

/**
 * Build location breakdown section
 */
function buildLocationBreakdownSectionESS(proof, fmt) {
    const locations = proof.locationBreakdowns || [];
    if (locations.length <= 1) return '';

    const rows = locations.map((loc, index) => {
        const isFirst = index === 0;
        return `
            <tr class="${isFirst ? 'primary-location' : ''}">
                <td class="location-name">
                    <span class="location-icon">📍</span>
                    ${loc.officeName || '-'}
                    <span class="office-code">(${loc.officeCode || '-'})</span>
                </td>
                <td class="text-center">
                    <span class="days-badge">${loc.workedDays || 0} days</span>
                </td>
                <td class="text-right">${fmt(loc.grossEarnings || 0)}</td>
                <td class="text-right">${fmt(loc.totalDeductions || 0)}</td>
                <td class="text-right net-cell">
                    <strong>${fmt(loc.netPay || 0)}</strong>
                </td>
            </tr>
        `;
    }).join('');

    const totalWorkedDays = locations.reduce((sum, loc) => sum + (loc.workedDays || 0), 0);
    const totalGross = locations.reduce((sum, loc) => sum + (loc.grossEarnings || 0), 0);
    const totalDeductions = locations.reduce((sum, loc) => sum + (loc.totalDeductions || 0), 0);
    const totalNet = locations.reduce((sum, loc) => sum + (loc.netPay || 0), 0);

    const jurisdictionNote = proof.jurisdictionPolicy
        ? `<p class="jurisdiction-note"><strong>Tax Jurisdiction Policy:</strong> ${formatJurisdictionPolicyESS(proof.jurisdictionPolicy)}</p>`
        : '';

    return `
        <div class="proof-card location-card">
            <div class="proof-card-header location-header">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                    <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
                <span>Multi-Location Breakdown</span>
                <span class="header-badge location-badge">${locations.length} locations</span>
            </div>
            <div class="proof-card-body">
                <p class="section-description">Employee worked at multiple locations during this pay period. Statutory deductions are applied based on each location's tax jurisdiction.</p>
                ${jurisdictionNote}
                <table class="proof-table location-table">
                    <thead>
                        <tr>
                            <th>Location</th>
                            <th class="text-center">Days Worked</th>
                            <th class="text-right">Gross Earnings</th>
                            <th class="text-right">Deductions</th>
                            <th class="text-right">Net Pay</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td><strong>Combined Total</strong></td>
                            <td class="text-center"><strong>${totalWorkedDays} days</strong></td>
                            <td class="text-right"><strong>${fmt(totalGross)}</strong></td>
                            <td class="text-right"><strong>${fmt(totalDeductions)}</strong></td>
                            <td class="text-right"><strong>${fmt(totalNet)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

/**
 * Format jurisdiction policy
 */
function formatJurisdictionPolicyESS(policy) {
    if (!policy) return 'Standard';
    const policyMap = {
        'CALENDAR_MONTH_FIRST': 'Tax applied based on first location of the calendar month',
        'DAYS_MAJORITY': 'Tax applied based on location with most days worked',
        'PROPORTIONAL': 'Tax prorated based on days worked at each location',
        'PRIMARY_OFFICE': 'Tax applied based on employee\'s primary office'
    };
    return policyMap[policy.toUpperCase()] || policy.replace(/_/g, ' ');
}

/**
 * Switch proof tab
 */
function switchProofTabESS(tabName) {
    // Only select tabs within the ESS calculation proof modal
    const modal = document.getElementById('calculationProofModal');
    if (!modal) return;

    const tabs = modal.querySelectorAll('.proof-tab');
    tabs.forEach(tab => {
        const isActive = (tabName === 'formatted' && tab.textContent.includes('Formatted')) ||
                        (tabName === 'json' && tab.textContent.includes('JSON'));
        tab.classList.toggle('active', isActive);
    });

    const formattedContent = document.getElementById('proofTabFormattedESS');
    const jsonContent = document.getElementById('proofTabJsonESS');

    if (tabName === 'formatted') {
        formattedContent.style.display = 'block';
        jsonContent.style.display = 'none';
    } else {
        formattedContent.style.display = 'none';
        jsonContent.style.display = 'block';
    }
}

/**
 * Copy proof JSON to clipboard
 */
function copyProofJsonESS() {
    if (!window.currentCalculationProof || !window.currentCalculationProof.proof) {
        showToast('No calculation proof data available', 'error');
        return;
    }

    const jsonString = JSON.stringify(window.currentCalculationProof.proof, null, 2);

    navigator.clipboard.writeText(jsonString).then(() => {
        showToast('JSON copied to clipboard', 'success');
    }).catch(err => {
        console.error('Failed to copy JSON:', err);
        const textArea = document.createElement('textarea');
        textArea.value = jsonString;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('JSON copied to clipboard', 'success');
    });
}

/**
 * Download proof JSON
 */
function downloadProofJsonESS() {
    if (!window.currentCalculationProof || !window.currentCalculationProof.proof) {
        showToast('No calculation proof data available', 'error');
        return;
    }

    const { proof, employeeCode, payPeriod } = window.currentCalculationProof;
    const jsonString = JSON.stringify(proof, null, 2);
    const fileName = `Calculation_Proof_${employeeCode || 'Employee'}_${payPeriod.replace(/[^a-zA-Z0-9]/g, '_')}.json`;

    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('JSON downloaded', 'success');
}

/**
 * Download calculation proof as markdown
 */
async function downloadCalculationProofESS() {
    if (!window.currentCalculationProof) {
        showToast('No calculation proof available to download', 'error');
        return;
    }

    const { payslipId, employeeCode, payPeriod, isProcessed } = window.currentCalculationProof;

    try {
        showLoading();
        const endpoint = isProcessed
            ? `/hrms/payroll-processing/payslips/${payslipId}/calculation-proof?format=markdown`
            : `/hrms/payroll-drafts/payslips/${payslipId}/calculation-proof?format=markdown`;

        const response = await api.request(endpoint);

        if (!response || !response.calculation_proof) {
            hideLoading();
            showToast('Failed to generate downloadable proof', 'error');
            return;
        }

        const markdown = response.calculation_proof;
        const fileName = `Calculation_Proof_${employeeCode || 'Employee'}_${payPeriod.replace(/[^a-zA-Z0-9]/g, '_')}.md`;

        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        hideLoading();
        showToast('Calculation proof downloaded', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error downloading calculation proof:', error);
        showToast('Failed to download calculation proof', 'error');
    }
}

/**
 * Print calculation proof
 */
function printCalculationProofESS() {
    if (!window.currentCalculationProof) {
        showToast('No calculation proof available to print', 'error');
        return;
    }

    const contentDiv = document.querySelector('#proofTabFormattedESS');
    if (!contentDiv) return;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Calculation - ${window.currentCalculationProof.employeeCode || 'Employee'}</title>
            <style>
                * { box-sizing: border-box; }
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.5;
                    padding: 1rem;
                    max-width: 900px;
                    margin: 0 auto;
                    color: #1f2937;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .proof-summary-row { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
                .proof-summary-card { flex: 1; padding: 1rem; border-radius: 8px; text-align: center; color: white; }
                .proof-summary-card.earnings { background: #10b981; }
                .proof-summary-card.deductions { background: #f59e0b; }
                .proof-summary-card.net-pay { background: #6366f1; }
                .summary-label { font-size: 0.7rem; text-transform: uppercase; opacity: 0.9; }
                .summary-value { font-size: 1.25rem; font-weight: 700; }
                .proof-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }
                .proof-card-header { background: #f3f4f6; padding: 0.75rem 1rem; font-weight: 600; font-size: 0.9rem; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 0.5rem; }
                .header-badge { margin-left: auto; padding: 0.2rem 0.5rem; border-radius: 12px; font-size: 0.75rem; color: white; }
                .earnings-badge { background: #10b981; }
                .deductions-badge { background: #f59e0b; }
                .tax-badge { background: #8b5cf6; }
                .employer-badge { background: #06b6d4; }
                .proof-card-body { padding: 1rem; }
                .proof-section-grid { display: flex; gap: 1rem; margin-bottom: 1rem; }
                .proof-section-grid > * { flex: 1; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
                .info-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; }
                .info-value { font-size: 0.85rem; font-weight: 500; }
                .compensation-grid { display: flex; justify-content: space-around; text-align: center; }
                .comp-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; }
                .comp-value { font-size: 1rem; font-weight: 600; }
                .proof-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
                .proof-table th { background: #f3f4f6; padding: 0.5rem; font-weight: 600; text-align: left; border-bottom: 2px solid #e5e7eb; }
                .proof-table td { padding: 0.5rem; border-bottom: 1px solid #e5e7eb; }
                .proof-table .text-right { text-align: right; }
                .proof-table .text-center { text-align: center; }
                .proof-table tfoot td { background: #f3f4f6; font-weight: 600; border-top: 2px solid #e5e7eb; }
                .tax-regime-banner { background: #8b5cf6; color: white; padding: 0.5rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
                .tax-flow { display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.75rem; background: #f3f4f6; border-radius: 6px; margin-bottom: 1rem; align-items: center; }
                .tax-flow-item { padding: 0.4rem 0.75rem; background: white; border: 1px solid #e5e7eb; border-radius: 4px; text-align: center; }
                .tax-flow-item.result { background: #6366f1; color: white; border: none; }
                .flow-label { font-size: 0.65rem; text-transform: uppercase; opacity: 0.7; }
                .flow-value { font-weight: 600; font-size: 0.85rem; }
                .tax-flow-operator { font-weight: bold; color: #6b7280; }
                .tax-final { background: #f3f4f6; padding: 0.75rem; border-radius: 6px; }
                .tax-line { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem; }
                .tax-line.total { border-top: 1px solid #e5e7eb; margin-top: 0.5rem; padding-top: 0.5rem; font-weight: 600; }
                .tax-line.monthly { background: #6366f1; color: white; margin: 0.5rem -0.75rem -0.75rem; padding: 0.5rem 0.75rem; border-radius: 0 0 6px 6px; }
                .rebate-section { padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem; }
                .rebate-section.applicable { background: #d1fae5; border: 1px solid #10b981; }
                .rebate-section.not-applicable { background: #fee2e2; border: 1px solid #ef4444; }
                .rebate-header { font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
                .rebate-section.applicable .rebate-icon { color: #10b981; }
                .rebate-section.not-applicable .rebate-icon { color: #ef4444; }
                .eligibility-badge { display: inline-block; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; font-size: 0.7rem; color: white; }
                .eligibility-badge.eligible { background: #10b981; }
                .eligibility-badge.not-eligible { background: #ef4444; }
                tr.not-eligible { opacity: 0.6; }
                .verification-card { border: 2px solid #6366f1; }
                .verification-grid { display: flex; flex-direction: column; gap: 0.5rem; }
                .verification-item { display: flex; align-items: center; padding: 0.5rem; background: #f3f4f6; border-radius: 4px; }
                .verification-item.highlight { background: #6366f1; color: white; }
                .verification-label { flex: 1; font-size: 0.85rem; }
                .verification-value { font-weight: 600; margin-right: 0.75rem; }
                .verification-check { color: #10b981; font-size: 1rem; }
                .verification-item.highlight .verification-check { color: white; }
                .proof-footer { padding: 0.75rem; background: #f3f4f6; text-align: center; font-size: 0.7rem; color: #6b7280; border-top: 1px solid #e5e7eb; }
                .footer-info { display: flex; justify-content: center; gap: 0.5rem; }
                .proof-header-actions, .proof-icon svg { display: none !important; }
                @media print {
                    body { padding: 0; }
                    @page { margin: 0.75cm; }
                }
            </style>
        </head>
        <body>
            ${contentDiv.innerHTML}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
}

/**
 * Inject CSS styles for the calculation proof modal - ESS version
 */
function injectCalculationProofStylesESS() {
    const existingStyle = document.getElementById('calculation-proof-styles-ess');
    if (existingStyle) return;

    const style = document.createElement('style');
    style.id = 'calculation-proof-styles-ess';
    style.textContent = `
        .proof-modal-body {
            padding: 0 !important;
            max-height: calc(90vh - 60px);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .proof-tabs {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1rem;
            background: var(--bg-tertiary);
            border-bottom: 1px solid var(--border-primary);
        }
        .proof-tab {
            display: flex;
            align-items: center;
            gap: 0.375rem;
            padding: 0.5rem 1rem;
            background: transparent;
            border: 1px solid var(--border-secondary);
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--text-secondary);
            transition: all 0.2s ease;
        }
        .proof-tab:hover {
            background: var(--bg-hover);
            color: var(--text-primary);
        }
        .proof-tab.active {
            background: var(--brand-primary);
            color: var(--text-inverse);
            border-color: var(--brand-primary);
        }
        .proof-tab svg { flex-shrink: 0; }
        .proof-tab-actions {
            margin-left: auto;
            display: flex;
            gap: 0.5rem;
        }
        .proof-tab-content {
            flex: 1;
            overflow-y: auto;
            padding: 1.5rem;
            background: var(--bg-primary);
        }
        #proofTabFormattedESS, #proofTabJsonESS { max-height: calc(90vh - 140px); }
        .json-toolbar {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-secondary);
        }
        .json-viewer {
            font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 0.8rem;
            line-height: 1.5;
            padding: 1rem;
            background: var(--bg-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
            overflow: auto;
            max-height: calc(90vh - 250px);
            white-space: pre-wrap;
            word-wrap: break-word;
            color: var(--text-primary);
        }
        .proof-summary-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin-bottom: 1.5rem;
        }
        .proof-summary-card {
            padding: 1.25rem;
            border-radius: 10px;
            text-align: center;
            transition: transform 0.2s;
            color: var(--text-inverse);
        }
        .proof-summary-card:hover { transform: translateY(-2px); }
        .proof-summary-card.earnings { background: linear-gradient(135deg, #10b981, #059669); }
        .proof-summary-card.deductions { background: linear-gradient(135deg, #f59e0b, #d97706); }
        .proof-summary-card.net-pay { background: linear-gradient(135deg, #6366f1, #4f46e5); }
        .summary-label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            opacity: 0.9;
            margin-bottom: 0.25rem;
        }
        .summary-value { font-size: 1.5rem; font-weight: 700; }
        .proof-section-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
            margin-bottom: 1rem;
        }
        @media (max-width: 768px) {
            .proof-section-grid { grid-template-columns: 1fr; }
            .proof-summary-row { grid-template-columns: 1fr; }
        }
        .proof-card {
            background: var(--bg-secondary);
            border-radius: 10px;
            border: 1px solid var(--border-primary);
            margin-bottom: 1rem;
            overflow: hidden;
            transition: all 0.25s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        .proof-card:hover {
            border-color: var(--brand-primary);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .proof-card-header {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.875rem 1rem;
            background: var(--bg-tertiary);
            font-weight: 600;
            font-size: 0.9rem;
            border-bottom: 1px solid var(--border-primary);
            color: var(--text-primary);
        }
        .header-badge {
            margin-left: auto;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--text-inverse);
        }
        .earnings-badge { background: var(--color-success); }
        .deductions-badge { background: var(--color-warning); }
        .tax-badge { background: var(--brand-accent, var(--brand-primary)); }
        .employer-badge { background: var(--color-info); }
        .voluntary-badge { background: var(--color-info); }
        .timeline-badge { background: var(--color-info); }
        .location-badge { background: var(--brand-secondary, var(--brand-primary)); }
        .proof-card-body { padding: 1rem; }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 0.75rem;
        }
        .info-item { display: flex; flex-direction: column; }
        .info-label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .info-value { font-size: 0.9rem; font-weight: 500; color: var(--text-primary); }
        .compensation-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.5rem;
            text-align: center;
        }
        .comp-item { display: flex; flex-direction: column; }
        .comp-label { font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; }
        .comp-value { font-size: 1.1rem; font-weight: 600; color: var(--text-primary); }
        .proof-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .proof-table th {
            background: var(--bg-tertiary);
            padding: 0.625rem 0.75rem;
            font-weight: 600;
            text-align: left;
            border-bottom: 2px solid var(--border-primary);
            color: var(--text-primary);
        }
        .proof-table td {
            padding: 0.625rem 0.75rem;
            border-bottom: 1px solid var(--border-secondary);
            color: var(--text-primary);
        }
        .proof-table tbody tr:hover { background: var(--bg-hover); }
        .proof-table .text-right { text-align: right; }
        .proof-table .text-center { text-align: center; }
        .proof-table tfoot td {
            background: var(--bg-tertiary);
            border-top: 2px solid var(--border-primary);
            border-bottom: none;
        }
        .total-row td { font-weight: 600; }
        .component-name { display: flex; align-items: center; gap: 0.5rem; }
        .eligibility-reason { color: var(--text-secondary); cursor: help; }
        .eligibility-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            font-size: 0.75rem;
            color: var(--text-inverse);
        }
        .eligibility-badge.eligible { background: var(--color-success); }
        .eligibility-badge.not-eligible { background: var(--color-error); }
        tr.not-eligible { opacity: 0.6; }
        .tax-regime-banner {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1rem;
            background: linear-gradient(135deg, var(--brand-accent, var(--brand-primary)), var(--brand-primary-hover));
            color: var(--text-inverse);
            border-radius: 8px;
            margin-bottom: 1rem;
        }
        .regime-label { opacity: 0.9; }
        .regime-value { font-weight: 600; }
        .regime-section { opacity: 0.8; font-size: 0.85rem; }
        .tax-flow {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 0.5rem;
            padding: 1rem;
            background: var(--bg-tertiary);
            border-radius: 8px;
            margin-bottom: 1rem;
        }
        .tax-flow-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 0.5rem 1rem;
            background: var(--bg-secondary);
            border-radius: 6px;
            border: 1px solid var(--border-secondary);
            color: var(--text-primary);
        }
        .tax-flow-item.result {
            background: var(--brand-primary);
            color: var(--text-inverse);
            border: none;
        }
        .flow-label { font-size: 0.7rem; text-transform: uppercase; opacity: 0.8; }
        .flow-value { font-weight: 600; font-size: 0.9rem; }
        .tax-flow-operator { font-size: 1.25rem; font-weight: bold; color: var(--text-secondary); }
        .pretax-section {
            background: var(--bg-tertiary);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1rem;
        }
        .pretax-title {
            font-size: 0.75rem;
            text-transform: uppercase;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
        }
        .pretax-item {
            display: flex;
            justify-content: space-between;
            padding: 0.25rem 0;
            font-size: 0.85rem;
            color: var(--text-primary);
        }
        .pretax-item.pretax-total {
            border-top: 1px dashed var(--border-primary);
            margin-top: 0.5rem;
            padding-top: 0.5rem;
            font-weight: 600;
        }
        .slab-section { margin-bottom: 1rem; }
        .slab-title { font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary); }
        .rebate-section { padding: 1rem; border-radius: 8px; margin-bottom: 1rem; }
        .rebate-section.applicable {
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid var(--color-success);
        }
        .rebate-section.not-applicable {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid var(--color-error);
        }
        .rebate-header {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-weight: 600;
            margin-bottom: 0.25rem;
            color: var(--text-primary);
        }
        .rebate-icon { font-size: 1.1rem; }
        .rebate-section.applicable .rebate-icon { color: var(--color-success); }
        .rebate-section.not-applicable .rebate-icon { color: var(--color-error); }
        .rebate-details {
            font-size: 0.85rem;
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            color: var(--text-primary);
        }
        .rebate-amount { font-weight: 600; color: var(--color-success); }
        .rebate-reason { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem; }
        .tax-final {
            background: var(--bg-tertiary);
            border-radius: 8px;
            padding: 1rem;
            padding-bottom: 3rem;
            position: relative;
        }
        .tax-line {
            display: flex;
            justify-content: space-between;
            padding: 0.375rem 0;
            font-size: 0.9rem;
            color: var(--text-primary);
        }
        .tax-line.total {
            border-top: 1px solid var(--border-primary);
            margin-top: 0.5rem;
            padding-top: 0.5rem;
            padding-bottom: 0.5rem;
            font-weight: 600;
        }
        .tax-line.monthly {
            background: var(--brand-primary);
            color: var(--text-inverse);
            margin-top: 0.5rem;
            padding: 0.75rem 1rem;
            border-radius: 0 0 8px 8px;
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
        }
        .monthly-tds { font-size: 1.1rem; font-weight: 700; }
        .employer-note {
            font-size: 0.8rem;
            color: var(--text-secondary);
            font-style: italic;
            margin-bottom: 0.75rem;
            padding: 0.5rem;
            background: var(--bg-tertiary);
            border-radius: 6px;
        }
        .verification-card { border: 2px solid var(--brand-primary); }
        .verification-grid { display: flex; flex-direction: column; gap: 0.5rem; }
        .verification-item {
            display: flex;
            align-items: center;
            padding: 0.625rem 0.75rem;
            background: var(--bg-tertiary);
            border-radius: 6px;
            color: var(--text-primary);
        }
        .verification-item.highlight {
            background: linear-gradient(135deg, var(--brand-primary), var(--brand-primary-hover));
            color: var(--text-inverse);
        }
        .verification-label { flex: 1; font-size: 0.9rem; }
        .verification-value { font-weight: 600; margin-right: 1rem; }
        .verification-check { color: var(--color-success); font-size: 1.25rem; }
        .verification-item.highlight .verification-check { color: var(--text-inverse); }
        .proof-footer {
            padding: 1rem;
            background: var(--bg-tertiary);
            border-top: 1px solid var(--border-primary);
            text-align: center;
        }
        .footer-info {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 0.75rem;
            font-size: 0.75rem;
            color: var(--text-secondary);
        }
        .text-warning { color: var(--color-warning); font-weight: 600; }
        .section-description {
            font-size: 0.8rem;
            color: var(--text-secondary);
            margin-bottom: 1rem;
            padding: 0.5rem;
            background: var(--bg-tertiary);
            border-radius: 6px;
            font-style: italic;
        }
        .proration-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.125rem 0.5rem;
            background: var(--status-pending);
            color: var(--text-inverse);
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 600;
        }
        .adjustments-subsection { margin-bottom: 0.75rem; }
        .subsection-title {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: var(--text-secondary);
        }
        .subsection-title.additions-title svg { color: var(--color-success); }
        .subsection-title.deductions-title svg { color: var(--color-error); }
        .adjustment-type { display: inline-flex; align-items: center; gap: 0.25rem; }
        .adjustment-type.addition svg { color: var(--color-success); }
        .adjustment-type.deduction svg { color: var(--color-error); }
        .addition-amount { color: var(--color-success); font-weight: 600; }
        .deduction-amount { color: var(--color-error); font-weight: 600; }
        .subtotal-row td { background: var(--bg-tertiary); font-size: 0.9rem; }
        .adjustments-table { margin-bottom: 0; }
        .text-muted { color: var(--text-secondary); font-style: italic; }
        .timeline-card { border-left: 3px solid var(--color-info); }
        .timeline-header svg { color: var(--color-info); }
        .version-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 2.5rem;
            padding: 0.25rem 0.5rem;
            background: var(--brand-primary);
            color: var(--text-inverse);
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
            font-family: monospace;
        }
        .days-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.25rem 0.75rem;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        .reason-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.25rem 0.75rem;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            border-radius: 12px;
            font-size: 0.75rem;
            text-transform: capitalize;
        }
        .location-card { border-left: 3px solid var(--brand-secondary, var(--brand-primary)); }
        .location-header svg { color: var(--brand-secondary, var(--brand-primary)); }
        .location-name { display: flex; align-items: center; gap: 0.5rem; }
        .location-icon { font-size: 1rem; }
        .office-code { color: var(--text-secondary); font-size: 0.8rem; font-family: monospace; }
        .location-table .net-cell { color: var(--color-success); }
        .jurisdiction-label {
            display: inline-block;
            margin-left: 0.5rem;
            padding: 0.15rem 0.5rem;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            border-radius: 10px;
            font-size: 0.75rem;
            font-weight: 500;
        }
        .jurisdiction-note {
            font-size: 0.8rem;
            color: var(--text-secondary);
            margin-bottom: 1rem;
            padding: 0.75rem 1rem;
            background: var(--bg-hover);
            border-radius: 6px;
            border-left: 3px solid var(--color-info);
        }
        .jurisdiction-note strong { color: var(--text-primary); }
        .version-group-header td {
            background: linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-primary-hover) 100%);
            padding: 0.75rem 1rem !important;
            border-top: 2px solid var(--brand-primary);
        }
        .version-group-title {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            flex-wrap: wrap;
        }
        .version-badge-sm {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 2rem;
            padding: 0.2rem 0.5rem;
            background: rgba(255, 255, 255, 0.2);
            color: var(--text-inverse);
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 700;
            font-family: monospace;
            letter-spacing: 0.05em;
        }
        .version-group-title .structure-name {
            color: var(--text-inverse);
            font-weight: 600;
            font-size: 0.9rem;
        }
        .period-label {
            color: rgba(255, 255, 255, 0.8);
            font-size: 0.8rem;
            font-style: italic;
            margin-left: auto;
        }
        .version-group-item td {
            background: var(--bg-secondary);
            border-left: 3px solid transparent;
            padding-left: 1.5rem !important;
        }
        .version-group-item:hover td { background: var(--bg-hover); }
        .version-subtotal-row td {
            background: var(--bg-tertiary);
            border-bottom: 1px solid var(--border-primary);
            font-size: 0.85rem;
            padding: 0.5rem 1rem !important;
        }
        .version-subtotal-row em { color: var(--text-secondary); }
    `;
    document.head.appendChild(style);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (clockInterval) clearInterval(clockInterval);
    if (workingHoursInterval) clearInterval(workingHoursInterval);
});
