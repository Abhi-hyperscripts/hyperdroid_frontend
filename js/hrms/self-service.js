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

// Store for year picker instances
const yearPickerInstances = new Map();

/**
 * SearchableYearPicker - A reusable searchable year picker component
 * Matches the existing SearchableDropdown pattern from organization.js
 */
class SearchableYearPicker {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.yearsBack = options.yearsBack ?? 20;
        this.yearsForward = options.yearsForward ?? 1;  // Use ?? to allow 0
        this.onChange = options.onChange || (() => {});
        this.selectedValue = options.value ?? new Date().getFullYear();
        this.id = containerId;

        // Generate year options
        this.years = this.generateYears();
        this.filteredYears = [...this.years];
        this.highlightedIndex = -1;
        this.isOpen = false;

        this.cacheElements();
        this.bindEvents();
        this.render();

        // Store reference
        yearPickerInstances.set(this.id, this);
    }

    generateYears() {
        const currentYear = new Date().getFullYear();
        const years = [];

        // Future years first
        for (let y = currentYear + this.yearsForward; y > currentYear; y--) {
            years.push({ value: y, label: String(y) });
        }

        // Current year and past years
        for (let y = currentYear; y >= currentYear - this.yearsBack; y--) {
            years.push({ value: y, label: String(y) });
        }

        return years;
    }

    cacheElements() {
        this.triggerEl = this.container.querySelector('.ess-year-picker-trigger');
        this.dropdownEl = this.container.querySelector('.ess-year-picker-dropdown');
        this.searchInput = this.container.querySelector('.ess-year-picker-search input');
        this.listEl = this.container.querySelector('.ess-year-picker-list');
        this.valueEl = this.container.querySelector('.ess-year-picker-value');
    }

    render() {
        // Set initial value
        this.valueEl.textContent = this.selectedValue;

        // Render year options
        this.renderOptions();
    }

    renderOptions() {
        if (this.filteredYears.length === 0) {
            this.listEl.innerHTML = '<div class="ess-year-picker-empty">No matching years</div>';
            return;
        }

        this.listEl.innerHTML = this.filteredYears.map((year, index) => `
            <div class="ess-year-picker-option ${year.value === this.selectedValue ? 'selected' : ''} ${index === this.highlightedIndex ? 'highlighted' : ''}"
                 data-value="${year.value}"
                 data-index="${index}">
                ${year.label}
            </div>
        `).join('');
    }

    bindEvents() {
        // Toggle dropdown on trigger click
        this.triggerEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Search input
        this.searchInput.addEventListener('input', (e) => this.filter(e.target.value));
        this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));
        this.searchInput.addEventListener('click', (e) => e.stopPropagation());

        // Option click
        this.listEl.addEventListener('click', (e) => {
            const optionEl = e.target.closest('.ess-year-picker-option');
            if (optionEl) {
                this.select(parseInt(optionEl.dataset.value));
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });
    }

    handleKeydown(e) {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.highlightNext();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.highlightPrev();
                break;
            case 'Enter':
                e.preventDefault();
                if (this.highlightedIndex >= 0 && this.filteredYears[this.highlightedIndex]) {
                    this.select(this.filteredYears[this.highlightedIndex].value);
                }
                break;
            case 'Escape':
                this.close();
                break;
        }
    }

    highlightNext() {
        if (this.highlightedIndex < this.filteredYears.length - 1) {
            this.highlightedIndex++;
            this.updateHighlight();
        }
    }

    highlightPrev() {
        if (this.highlightedIndex > 0) {
            this.highlightedIndex--;
            this.updateHighlight();
        }
    }

    updateHighlight() {
        const options = this.listEl.querySelectorAll('.ess-year-picker-option');
        options.forEach((el, i) => {
            el.classList.toggle('highlighted', i === this.highlightedIndex);
        });

        // Scroll into view
        const highlighted = options[this.highlightedIndex];
        if (highlighted) {
            highlighted.scrollIntoView({ block: 'nearest' });
        }
    }

    filter(query) {
        const q = query.trim();
        this.filteredYears = this.years.filter(year =>
            String(year.value).includes(q)
        );
        this.highlightedIndex = this.filteredYears.length > 0 ? 0 : -1;
        this.renderOptions();
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.isOpen = true;
        this.triggerEl.classList.add('active');
        this.dropdownEl.classList.add('open');
        this.searchInput.value = '';
        this.filteredYears = [...this.years];
        this.highlightedIndex = -1;
        this.renderOptions();
        setTimeout(() => this.searchInput.focus(), 50);
    }

    close() {
        this.isOpen = false;
        this.triggerEl.classList.remove('active');
        this.dropdownEl.classList.remove('open');
        this.highlightedIndex = -1;
    }

    select(value) {
        const year = this.years.find(y => y.value === value);
        if (year) {
            this.selectedValue = year.value;
            this.valueEl.textContent = year.label;
            this.close();
            this.onChange(year.value);
        }
    }

    getValue() {
        return this.selectedValue;
    }

    setValue(value) {
        const year = this.years.find(y => y.value === value);
        if (year) {
            this.selectedValue = year.value;
            this.valueEl.textContent = year.label;
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Check authentication
        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
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
            const result = await api.hrmsClockOut({
                latitude: location?.latitude,
                longitude: location?.longitude,
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
            const result = await api.hrmsClockIn({
                latitude: location?.latitude,
                longitude: location?.longitude,
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
                    longitude: position.coords.longitude
                });
            },
            (error) => {
                reject(error);
            },
            { timeout: 10000 }
        );
    });
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
 * Setup all searchable year picker dropdowns
 */
function setupYearDropdowns() {
    const currentYear = new Date().getFullYear();

    // My Leaves year picker (20 years back, 1 year forward)
    new SearchableYearPicker('myLeaveYearPicker', {
        yearsBack: 20,
        yearsForward: 1,
        value: currentYear,
        onChange: loadMyLeaves
    });

    // Holidays year picker (20 years back, 1 year forward)
    new SearchableYearPicker('holidayYearPicker', {
        yearsBack: 20,
        yearsForward: 1,
        value: currentYear,
        onChange: loadHolidays
    });

    // Payslips year picker (20 years back, no future years)
    new SearchableYearPicker('payslipYearPicker', {
        yearsBack: 20,
        yearsForward: 0,
        value: currentYear,
        onChange: loadMyPayslips
    });
}

/**
 * Get the selected year from a year picker
 * @param {string} pickerId - The year picker container ID
 * @returns {number} - The selected year
 */
function getYearPickerValue(pickerId) {
    const picker = yearPickerInstances.get(pickerId);
    return picker ? picker.getValue() : new Date().getFullYear();
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
    const statusFilter = document.getElementById('myLeaveStatus');
    if (statusFilter) statusFilter.addEventListener('change', loadMyLeaves);
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
            const checkIn = r.check_in_time || '--';
            const checkOut = r.check_out_time || '--';
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
    const status = document.getElementById('myLeaveStatus')?.value || '';

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
                    <td>${formatDate(r.from_date || r.fromDate)}</td>
                    <td>${formatDate(r.to_date || r.toDate)}</td>
                    <td>${r.total_days || r.totalDays || 1}</td>
                    <td>${escapeHtml(truncateText(r.reason, 30))}</td>
                    <td><span class="status-badge status-${reqStatus}">${capitalizeFirst(reqStatus)}</span></td>
                    <td>
                        <button class="action-btn" onclick="viewLeaveRequest('${r.id}')" title="View">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                        ${reqStatus === 'pending' ? `<button class="action-btn" onclick="cancelLeaveRequest('${r.id}')" title="Cancel"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
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
            container.innerHTML = `<div class="ess-empty-state"><p>No leave balances configured</p></div>`;
            return;
        }

        container.innerHTML = `
            <div class="ess-leave-balance-grid">
                ${balances.map(b => `
                    <div class="ess-leave-balance-item">
                        <div class="leave-type-header">
                            <span class="leave-type-code">${escapeHtml(b.leave_type_code || b.code)}</span>
                            <span class="leave-type-name">${escapeHtml(b.leave_type_name || b.name)}</span>
                        </div>
                        <div class="leave-balance-bar">
                            <div class="balance-used" style="width: ${Math.min((b.used || 0) / (b.total || 1) * 100, 100)}%"></div>
                        </div>
                        <div class="leave-balance-stats">
                            <span class="balance-available">${b.available ?? b.balance ?? 0} available</span>
                            <span class="balance-total">of ${b.total ?? b.annual_quota ?? 0}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

    } catch (error) {
        console.error('Error loading leave balances:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load leave balances</p></div>`;
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
 * Load salary details
 */
async function loadSalaryDetails() {
    const container = document.getElementById('salaryDetails');
    if (!container) return;

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading salary details...</span></div>`;

        const response = await api.request('/hrms/payroll/my-salary');
        const salary = response;

        if (!salary || !salary.components) {
            container.innerHTML = `<div class="ess-empty-state"><p>No salary structure configured</p></div>`;
            return;
        }

        const earnings = (salary.components || []).filter(c => c.component_type === 'earning');
        const deductions = (salary.components || []).filter(c => c.component_type === 'deduction');

        container.innerHTML = `
            <div class="ess-salary-card">
                <div class="salary-header">
                    <h3>My Salary Structure</h3>
                    <span class="salary-effective">Effective: ${formatDate(salary.effective_from) || 'Current'}</span>
                </div>
                <div class="salary-summary">
                    <div class="salary-stat">
                        <span class="stat-value">${formatCurrency(salary.gross_salary || salary.ctc || 0)}</span>
                        <span class="stat-label">Gross Salary</span>
                    </div>
                    <div class="salary-stat">
                        <span class="stat-value">${formatCurrency(salary.net_salary || 0)}</span>
                        <span class="stat-label">Net Salary</span>
                    </div>
                </div>
                <div class="salary-breakdown">
                    <div class="breakdown-section">
                        <h4>Earnings</h4>
                        ${earnings.map(c => `
                            <div class="component-row">
                                <span>${escapeHtml(c.component_name || c.name)}</span>
                                <span>${formatCurrency(c.amount)}</span>
                            </div>
                        `).join('') || '<p class="no-data">No earnings configured</p>'}
                    </div>
                    <div class="breakdown-section">
                        <h4>Deductions</h4>
                        ${deductions.map(c => `
                            <div class="component-row">
                                <span>${escapeHtml(c.component_name || c.name)}</span>
                                <span>${formatCurrency(c.amount)}</span>
                            </div>
                        `).join('') || '<p class="no-data">No deductions configured</p>'}
                    </div>
                </div>
            </div>
        `;

    } catch (error) {
        console.error('Error loading salary:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load salary details</p></div>`;
    }
}

/**
 * Load loans
 */
async function loadLoans() {
    const container = document.getElementById('loansContainer');
    if (!container) return;

    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading loans...</span></div>`;

        const response = await api.request('/hrms/payroll-processing/my-loans');
        const loans = response?.loans || response || [];

        if (!loans.length) {
            container.innerHTML = `<div class="ess-empty-state"><p>No loans or advances</p></div>`;
            return;
        }

        container.innerHTML = `
            <table class="ess-table">
                <thead>
                    <tr><th>Type</th><th>Amount</th><th>EMI</th><th>Outstanding</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${loans.map(l => `
                        <tr>
                            <td>${capitalizeFirst(l.loan_type || l.type)}</td>
                            <td>${formatCurrency(l.amount)}</td>
                            <td>${formatCurrency(l.emi_amount || l.emi)}</td>
                            <td>${formatCurrency(l.outstanding_amount || l.outstanding)}</td>
                            <td><span class="status-badge status-${l.status}">${capitalizeFirst(l.status)}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error('Error loading loans:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load loans</p></div>`;
    }
}

/**
 * Load reimbursements
 */
async function loadReimbursements() {
    const container = document.getElementById('reimbursementsContainer');
    if (!container) return;

    // Reimbursements feature is not yet implemented in the backend
    container.innerHTML = `<div class="ess-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <p>Reimbursements feature coming soon</p>
    </div>`;
    return;

    // TODO: Uncomment when backend implements reimbursements
    /*
    try {
        container.innerHTML = `<div class="ess-loading"><div class="spinner"></div><span>Loading reimbursements...</span></div>`;

        const response = await api.request('/hrms/payroll/reimbursements/my');
        const claims = response?.claims || response || [];

        if (!claims.length) {
            container.innerHTML = `<div class="ess-empty-state"><p>No reimbursement claims</p></div>`;
            return;
        }

        container.innerHTML = `
            <table class="ess-table">
                <thead>
                    <tr><th>Date</th><th>Type</th><th>Amount</th><th>Description</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${claims.map(c => `
                        <tr>
                            <td>${formatDate(c.expense_date || c.date)}</td>
                            <td>${capitalizeFirst(c.expense_type || c.type)}</td>
                            <td>${formatCurrency(c.amount)}</td>
                            <td>${escapeHtml(truncateText(c.description, 30))}</td>
                            <td><span class="status-badge status-${c.status}">${capitalizeFirst(c.status)}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error('Error loading reimbursements:', error);
        container.innerHTML = `<div class="ess-error-state"><p>Failed to load reimbursements</p></div>`;
    }
    */
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

            if (lastGrossEl) lastGrossEl.textContent = formatCurrency(lastPayslip.grossSalary || lastPayslip.gross_salary || 0);
            if (lastDeductionsEl) lastDeductionsEl.textContent = formatCurrency(lastPayslip.totalDeductions || lastPayslip.total_deductions || 0);
            if (lastNetEl) lastNetEl.textContent = formatCurrency(lastPayslip.netSalary || lastPayslip.net_salary || 0);

            const ytd = myPayslips.reduce((sum, p) => sum + (p.netSalary || p.net_salary || 0), 0);
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
                        <button class="action-btn" onclick="viewPayslip('${slip.id}')" title="View Payslip">
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

/**
 * View payslip details
 */
async function viewPayslip(payslipId) {
    try {
        currentPayslipId = payslipId;
        const payslip = await api.request(`/hrms/payroll-processing/payslips/${payslipId}?includeItems=true`);

        const isMultiLocation = payslip.is_multi_location || payslip.isMultiLocation || false;
        const locationBreakdowns = payslip.location_breakdowns || payslip.locationBreakdowns || [];

        const multiLocationBadge = isMultiLocation
            ? `<span class="multi-location-badge" title="Multi-location payroll">Multi-Location</span>`
            : '';

        const month = payslip.month || payslip.payroll_month;
        const year = payslip.year || payslip.payroll_year;
        const employeeName = payslip.employeeName || payslip.employee_name || 'Employee';
        const employeeCode = payslip.employeeCode || payslip.employee_code || 'N/A';
        const departmentName = payslip.departmentName || payslip.department_name || 'N/A';
        const periodStart = payslip.periodStart || payslip.period_start || payslip.pay_period_start;
        const periodEnd = payslip.periodEnd || payslip.period_end || payslip.pay_period_end;
        const grossSalary = payslip.grossSalary || payslip.gross_salary || payslip.gross_earnings || 0;
        const totalDeductions = payslip.totalDeductions || payslip.total_deductions || 0;
        const netSalary = payslip.netSalary || payslip.net_salary || payslip.net_pay || 0;
        const earnings = payslip.earnings || payslip.earning_items || [];
        const deductions = payslip.deductions || payslip.deduction_items || [];

        const payslipDetailsEl = document.getElementById('payslipDetails');
        if (payslipDetailsEl) {
            payslipDetailsEl.innerHTML = `
                <div class="payslip-header">
                    <h3>${payslip.companyName || 'Company'}</h3>
                    <p>Payslip for ${getMonthName(month)} ${year} ${multiLocationBadge}</p>
                </div>
                <div class="payslip-employee">
                    <div class="info-row"><span class="label">Employee Name:</span><span class="value">${escapeHtml(employeeName)}</span></div>
                    <div class="info-row"><span class="label">Employee ID:</span><span class="value">${escapeHtml(employeeCode)}</span></div>
                    <div class="info-row"><span class="label">Department:</span><span class="value">${escapeHtml(departmentName)}</span></div>
                    <div class="info-row"><span class="label">Pay Period:</span><span class="value">${formatPayslipDate(periodStart)} - ${formatPayslipDate(periodEnd)}</span></div>
                </div>
                <div class="payslip-details">
                    <div class="earnings-section">
                        <h4>Earnings</h4>
                        <table>
                            ${earnings.map(e => `<tr><td>${e.componentName || e.component_name || e.name || ''}</td><td class="amount">${formatCurrency(e.amount || 0)}</td></tr>`).join('')}
                            <tr class="total"><td>Gross Salary</td><td class="amount">${formatCurrency(grossSalary)}</td></tr>
                        </table>
                    </div>
                    <div class="deductions-section">
                        <h4>Deductions</h4>
                        <table>
                            ${deductions.map(d => `<tr><td>${d.componentName || d.component_name || d.name || ''}</td><td class="amount">${formatCurrency(d.amount || 0)}</td></tr>`).join('')}
                            <tr class="total"><td>Total Deductions</td><td class="amount">${formatCurrency(totalDeductions)}</td></tr>
                        </table>
                    </div>
                </div>
                <div class="payslip-net">
                    <span>Net Pay:</span>
                    <span class="net-amount">${formatCurrency(netSalary)}</span>
                </div>
            `;
        }

        openModal('payslipModal');
    } catch (error) {
        console.error('Error loading payslip:', error);
        showToast('Failed to load payslip', 'error');
    }
}

/**
 * Download current payslip
 */
async function downloadPayslip() {
    if (currentPayslipId) {
        await downloadPayslipById(currentPayslipId);
    }
}

/**
 * Download payslip by ID
 */
async function downloadPayslipById(payslipId) {
    try {
        showToast('Generating payslip PDF...', 'info');
        const baseUrl = api.getBaseUrl ? api.getBaseUrl('/hrms') : '';
        window.open(`${baseUrl}/hrms/payroll-processing/payslips/${payslipId}/download`, '_blank');
    } catch (error) {
        console.error('Error downloading payslip:', error);
        showToast('Failed to download payslip', 'error');
    }
}

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
        const date = document.getElementById('regDate').value;
        const checkIn = document.getElementById('regCheckIn').value;
        const checkOut = document.getElementById('regCheckOut').value;
        const reason = document.getElementById('regReason').value;

        if (!date || !checkIn || !checkOut || !reason) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        await api.request('/hrms/attendance/regularization', 'POST', {
            date, check_in_time: checkIn, check_out_time: checkOut, reason
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

        await api.request('/hrms/attendance/overtime', 'POST', {
            date, planned_start: startTime, planned_end: endTime, reason, task
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
    // Load leave types
    try {
        const response = await api.request('/hrms/leave/types');
        const types = response?.types || response || [];
        const select = document.getElementById('leaveType');
        if (select) {
            select.innerHTML = '<option value="">Select Leave Type</option>' +
                types.map(t => `<option value="${t.id}">${escapeHtml(t.leave_type_name || t.name)}</option>`).join('');
        }
    } catch (e) {
        console.error('Error loading leave types:', e);
    }

    document.getElementById('applyLeaveForm')?.reset();
    openModal('applyLeaveModal');
}

/**
 * Submit leave application
 */
async function submitLeaveApplication() {
    try {
        const leaveType = document.getElementById('leaveType').value;
        const fromDate = document.getElementById('fromDate').value;
        const toDate = document.getElementById('toDate').value;
        const reason = document.getElementById('leaveReason').value;
        const halfDay = document.getElementById('halfDay').value;
        const emergencyContact = document.getElementById('emergencyContact').value;

        if (!leaveType || !fromDate || !toDate || !reason) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        await api.request('/hrms/leave/requests', 'POST', {
            leave_type_id: leaveType,
            from_date: fromDate,
            to_date: toDate,
            reason,
            half_day: halfDay || null,
            emergency_contact: emergencyContact || null
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
function showEncashLeaveModal() {
    openModal('encashLeaveModal');
}

/**
 * Open loan modal
 */
function openLoanModal() {
    document.getElementById('loanForm')?.reset();
    openModal('loanModal');
}

/**
 * Open reimbursement modal
 */
function openReimbursementModal() {
    document.getElementById('reimbursementForm')?.reset();
    openModal('reimbursementModal');
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Format currency
 */
function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (clockInterval) clearInterval(clockInterval);
    if (workingHoursInterval) clearInterval(workingHoursInterval);
});
