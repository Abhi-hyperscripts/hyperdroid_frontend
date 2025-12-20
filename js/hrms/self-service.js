/**
 * HRMS Employee Self-Service Dashboard
 */

// Global variables
let currentEmployee = null;
let clockInterval = null;
let workingHoursInterval = null;
let clockedIn = false;
let checkInTime = null;

// Payslip variables
let myPayslips = [];
let currentPayslipId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Check authentication
        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }

        // Initialize navigation
        if (typeof Navigation !== 'undefined') {
            Navigation.init();
        }

        // Setup tabs
        setupTabs();

        // Setup payslip year change listener
        const payslipYearSelect = document.getElementById('payslipYear');
        if (payslipYearSelect) {
            payslipYearSelect.addEventListener('change', loadMyPayslips);
        }

        // Start clock display
        startClock();

        // Load dashboard data
        await loadDashboard();

    } catch (error) {
        console.error('Error initializing self-service dashboard:', error);
        showToast('Failed to load dashboard', 'error');
    }
});

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
}

/**
 * Load dashboard data
 */
async function loadDashboard() {
    try {
        const dashboard = await api.getHrmsDashboard();

        if (dashboard && dashboard.employee) {
            // Store employee data
            currentEmployee = dashboard.employee;

            // Update welcome section
            updateWelcomeSection(dashboard.employee);

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
 * Show message when user doesn't have an employee profile
 */
function showNoEmployeeProfile() {
    // Update welcome section
    const welcomeEl = document.getElementById('welcomeMessage');
    if (welcomeEl) {
        welcomeEl.textContent = 'Welcome!';
    }

    const infoEl = document.getElementById('employeeInfo');
    if (infoEl) {
        infoEl.textContent = 'No employee profile linked';
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

    const statusEl = document.getElementById('clockStatus');
    if (statusEl) {
        statusEl.textContent = 'Profile not linked';
        statusEl.className = 'clock-status';
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
 * Update welcome section with employee info
 */
function updateWelcomeSection(employee) {
    if (!employee) return;

    // Update avatar
    const avatarEl = document.getElementById('employeeAvatar');
    const initialsEl = document.getElementById('avatarInitials');

    if (employee.profile_photo_url) {
        avatarEl.style.backgroundImage = `url(${employee.profile_photo_url})`;
        avatarEl.style.backgroundSize = 'cover';
        initialsEl.style.display = 'none';
    } else {
        const initials = getInitials(employee.first_name, employee.last_name);
        initialsEl.textContent = initials;
    }

    // Update welcome message
    const welcomeEl = document.getElementById('welcomeMessage');
    if (welcomeEl) {
        const greeting = getGreeting();
        welcomeEl.textContent = `${greeting}, ${employee.first_name}!`;
    }

    // Update employee info
    const infoEl = document.getElementById('employeeInfo');
    if (infoEl) {
        const designation = employee.designation_name || 'Employee';
        const department = employee.department_name || '';
        infoEl.textContent = department ? `${designation} • ${department}` : designation;
    }
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

/**
 * Update attendance status section
 */
function updateAttendanceStatus(attendance) {
    const statusEl = document.getElementById('clockStatus');
    const btnText = document.getElementById('clockBtnText');
    const btn = document.getElementById('clockBtn');
    const checkInTimeEl = document.getElementById('checkInTime');
    const workingHoursEl = document.getElementById('workingHours');

    if (attendance && attendance.check_in_time) {
        clockedIn = true;
        checkInTime = new Date(attendance.check_in_time);

        // Update status
        if (statusEl) {
            if (attendance.check_out_time) {
                statusEl.textContent = 'Checked out';
                statusEl.className = 'clock-status checked-out';
            } else {
                statusEl.textContent = 'Currently working';
                statusEl.className = 'clock-status checked-in';
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

        if (statusEl) {
            statusEl.textContent = 'Not checked in';
            statusEl.className = 'clock-status';
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
            const statusEl = document.getElementById('clockStatus');
            if (statusEl) {
                statusEl.textContent = 'Checked out';
                statusEl.className = 'clock-status checked-out';
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

            const statusEl = document.getElementById('clockStatus');
            if (statusEl) {
                statusEl.textContent = 'Currently working';
                statusEl.className = 'clock-status checked-in';
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

        // Navigate to announcements page
        window.location.href = `announcements.html?id=${announcementId}`;
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
            <div class="upcoming-item">
                <div class="upcoming-date">
                    <span class="day">${new Date(h.holiday_date).getDate()}</span>
                    <span class="month">${new Date(h.holiday_date).toLocaleDateString('en-US', { month: 'short' })}</span>
                </div>
                <div class="upcoming-info">
                    <span class="upcoming-name">${escapeHtml(h.holiday_name)}</span>
                    <span class="upcoming-detail">${h.holiday_type || ''}</span>
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
            <div class="upcoming-item">
                <div class="upcoming-avatar">
                    ${b.profile_photo_url
                        ? `<img src="${b.profile_photo_url}" alt="${b.first_name}">`
                        : `<span>${getInitials(b.first_name, b.last_name)}</span>`
                    }
                </div>
                <div class="upcoming-info">
                    <span class="upcoming-name">${escapeHtml(b.first_name)} ${escapeHtml(b.last_name || '')}</span>
                    <span class="upcoming-detail">${formatDate(b.date_of_birth, true)}</span>
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
            <div class="upcoming-item">
                <div class="upcoming-avatar">
                    ${a.profile_photo_url
                        ? `<img src="${a.profile_photo_url}" alt="${a.first_name}">`
                        : `<span>${getInitials(a.first_name, a.last_name)}</span>`
                    }
                </div>
                <div class="upcoming-info">
                    <span class="upcoming-name">${escapeHtml(a.first_name)} ${escapeHtml(a.last_name || '')}</span>
                    <span class="upcoming-detail">${a.years || 1} year${a.years !== 1 ? 's' : ''}</span>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading anniversaries:', error);
        container.innerHTML = '<p class="ess-error">Failed to load</p>';
    }
}

/**
 * Check if user has admin access
 */
function checkAdminAccess() {
    const adminLink = document.getElementById('adminLink');
    if (!adminLink) return;

    // Check user roles from stored auth data
    const userData = localStorage.getItem('userData');
    if (userData) {
        try {
            const user = JSON.parse(userData);
            const roles = user.roles || [];
            const adminRoles = ['SUPERADMIN', 'HRMS_ADMIN', 'HRMS_HR_ADMIN', 'HRMS_HR_MANAGER'];

            if (roles.some(r => adminRoles.includes(r))) {
                adminLink.style.display = 'block';
            }
        } catch (e) {
            console.error('Error parsing user data:', e);
        }
    }
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

// Local showToast removed - using unified toast.js instead

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (clockInterval) clearInterval(clockInterval);
    if (workingHoursInterval) clearInterval(workingHoursInterval);
});

// ==========================================
// TAB FUNCTIONALITY
// ==========================================

/**
 * Setup tab switching functionality
 */
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;

            // Update active states
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            const tabContent = document.getElementById(tabId);
            if (tabContent) {
                tabContent.classList.add('active');
            }

            // Load data when switching to My Payslips tab
            if (tabId === 'my-payslips') {
                loadMyPayslips();
            }
        });
    });
}

/**
 * Switch to the My Payslips tab (called from Quick Actions)
 */
function switchToPayslipsTab() {
    const payslipsTabBtn = document.querySelector('[data-tab="my-payslips"]');
    if (payslipsTabBtn) {
        payslipsTabBtn.click();
    }
}

// ==========================================
// MY PAYSLIPS FUNCTIONALITY
// ==========================================

/**
 * Load my payslips for the selected year
 */
async function loadMyPayslips() {
    try {
        const year = document.getElementById('payslipYear')?.value || new Date().getFullYear();
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
            // Reset stats to zero
            document.getElementById('lastGross').textContent = '₹0';
            document.getElementById('lastDeductions').textContent = '₹0';
            document.getElementById('lastNet').textContent = '₹0';
            document.getElementById('ytdEarnings').textContent = '₹0';
        }

        updateMyPayslipsTable(myPayslips);
    } catch (error) {
        // If user has no employee profile (e.g., admin users), just show empty state
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
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
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
        // Fetch with includeItems=true to get location breakdowns
        const payslip = await api.request(`/hrms/payroll-processing/payslips/${payslipId}?includeItems=true`);

        // Check for multi-location indicator
        const isMultiLocation = payslip.is_multi_location || payslip.isMultiLocation || false;
        const locationBreakdowns = payslip.location_breakdowns || payslip.locationBreakdowns || [];

        // Multi-location badge if applicable
        const multiLocationBadge = isMultiLocation
            ? `<span class="multi-location-badge" title="Employee worked at multiple locations during this period">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                </svg>
                Multi-Location
               </span>`
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
        const arrears = payslip.arrears || 0;
        const arrearsBreakdown = payslip.arrears_breakdown || payslip.arrearsBreakdown || [];

        const payslipDetailsEl = document.getElementById('payslipDetails');
        if (payslipDetailsEl) {
            payslipDetailsEl.innerHTML = `
                <div class="payslip-header">
                    <h3>${payslip.companyName || 'Company'}</h3>
                    <p>Payslip for ${getMonthName(month)} ${year} ${multiLocationBadge}</p>
                </div>
                <div class="payslip-employee">
                    <div class="info-row">
                        <span class="label">Employee Name:</span>
                        <span class="value">${escapeHtml(employeeName)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Employee ID:</span>
                        <span class="value">${escapeHtml(employeeCode)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Department:</span>
                        <span class="value">${escapeHtml(departmentName)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Pay Period:</span>
                        <span class="value">${formatPayslipDate(periodStart)} - ${formatPayslipDate(periodEnd)}</span>
                    </div>
                </div>
                <div class="payslip-details">
                    <div class="earnings-section">
                        <h4>Earnings</h4>
                        <table>
                            ${earnings.map(e => `
                                <tr>
                                    <td>${e.componentName || e.component_name || e.name || ''}</td>
                                    <td class="amount">${formatCurrency(e.amount || 0)}</td>
                                </tr>
                            `).join('')}
                            <tr class="total">
                                <td>Gross Salary</td>
                                <td class="amount">${formatCurrency(grossSalary)}</td>
                            </tr>
                        </table>
                    </div>
                    <div class="deductions-section">
                        <h4>Deductions</h4>
                        <table>
                            ${deductions.map(d => `
                                <tr>
                                    <td>${d.componentName || d.component_name || d.name || ''}</td>
                                    <td class="amount">${formatCurrency(d.amount || 0)}</td>
                                </tr>
                            `).join('')}
                            <tr class="total">
                                <td>Total Deductions</td>
                                <td class="amount">${formatCurrency(totalDeductions)}</td>
                            </tr>
                        </table>
                    </div>
                </div>
                ${arrears > 0 ? `
                <div class="arrears-section" style="margin-top: 15px; padding: 15px; background: rgba(245, 158, 11, 0.08); border-radius: 8px; border-left: 3px solid var(--color-warning, #f59e0b);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h4 style="margin: 0; color: var(--color-warning, #f59e0b); display: flex; align-items: center; gap: 8px;">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3.5a.5.5 0 0 1-.5-.5v-3.5A.5.5 0 0 1 8 4z"/>
                            </svg>
                            Arrears
                        </h4>
                        <span class="arrears-total" style="font-weight: 600; color: var(--color-warning, #f59e0b);">${formatCurrency(arrears)}</span>
                    </div>
                    ${arrearsBreakdown.length > 0 ? `
                    <table style="width: 100%; font-size: 0.85rem;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <th style="text-align: left; padding: 5px 0;">Period</th>
                                <th style="text-align: left; padding: 5px 0;">Type</th>
                                <th style="text-align: right; padding: 5px 0;">Old</th>
                                <th style="text-align: right; padding: 5px 0;">New</th>
                                <th style="text-align: right; padding: 5px 0;">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${arrearsBreakdown.map(arr => `
                            <tr>
                                <td style="padding: 5px 0;">${arr.period_display || getMonthName(arr.payroll_month) + ' ' + arr.payroll_year}</td>
                                <td style="padding: 5px 0;">
                                    <span style="display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 0.75rem;
                                        background: ${arr.source_type === 'ctc_revision' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(107, 114, 128, 0.1)'};
                                        color: ${arr.source_type === 'ctc_revision' ? '#3b82f6' : '#6b7280'};">
                                        ${arr.source_type === 'ctc_revision' ? 'CTC Revision' : 'Structure'}
                                    </span>
                                    ${arr.source_type === 'ctc_revision' && arr.revision_type ? `
                                    <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 2px;">${formatRevisionType(arr.revision_type)}</div>
                                    ` : ''}
                                </td>
                                <td style="text-align: right; padding: 5px 0; color: var(--text-secondary);">
                                    ${arr.source_type === 'ctc_revision' && arr.old_ctc ? formatCurrency(arr.old_ctc) + '/yr' : formatCurrency(arr.old_gross)}
                                </td>
                                <td style="text-align: right; padding: 5px 0; color: var(--color-success, #22c55e);">
                                    ${arr.source_type === 'ctc_revision' && arr.new_ctc ? formatCurrency(arr.new_ctc) + '/yr' : formatCurrency(arr.new_gross)}
                                </td>
                                <td style="text-align: right; padding: 5px 0; font-weight: 600; color: var(--color-warning, #f59e0b);">${formatCurrency(arr.arrears_amount)}</td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ` : ''}
                </div>
                ` : ''}
                <div class="payslip-net">
                    <span>Net Pay:</span>
                    <span class="net-amount">${formatCurrency(netSalary)}</span>
                </div>
                ${isMultiLocation && locationBreakdowns.length > 0 ? renderLocationBreakdowns(locationBreakdowns) : ''}
            `;
        }

        openModal('payslipModal');
    } catch (error) {
        console.error('Error loading payslip:', error);
        showToast('Failed to load payslip', 'error');
    }
}

/**
 * Render multi-location breakdown section
 */
function renderLocationBreakdowns(locationBreakdowns) {
    return `
        <div class="location-breakdown-section" style="margin-top: 20px;">
            <h4 style="margin-bottom: 15px; color: var(--text-primary);">Multi-Location Breakdown</h4>
            <div class="location-cards" style="display: grid; gap: 15px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));">
                ${locationBreakdowns.map(loc => {
                    const officeName = loc.office_name || loc.officeName || 'Office';
                    const officeCode = loc.office_code || loc.officeCode || '';
                    const periodStart = loc.period_start || loc.periodStart;
                    const periodEnd = loc.period_end || loc.periodEnd;
                    const daysWorked = loc.days_worked || loc.daysWorked || 0;
                    const prorationFactor = loc.proration_factor || loc.prorationFactor || 0;
                    const grossEarnings = loc.gross_earnings || loc.grossEarnings || 0;
                    const locationTaxes = loc.location_taxes || loc.locationTaxes || 0;
                    const netPay = loc.net_pay || loc.netPay || 0;
                    const taxItems = loc.tax_items || loc.taxItems || [];

                    return `
                        <div class="location-card" style="background: var(--bg-secondary); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div class="location-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <div class="location-name" style="font-weight: 600; display: flex; align-items: center; gap: 8px;">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                                        <polyline points="9 22 9 12 15 12 15 22"></polyline>
                                    </svg>
                                    ${escapeHtml(officeName)}
                                </div>
                                <span class="location-code" style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(officeCode)}</span>
                            </div>
                            <div class="location-period" style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 10px;">
                                ${formatPayslipDate(periodStart)} - ${formatPayslipDate(periodEnd)}
                            </div>
                            <div class="location-stats" style="display: flex; gap: 15px; margin-bottom: 10px;">
                                <div class="loc-stat" style="text-align: center;">
                                    <span class="loc-value" style="display: block; font-weight: 600; font-size: 1.1rem;">${daysWorked}</span>
                                    <span class="loc-label" style="font-size: 0.75rem; color: var(--text-secondary);">Days</span>
                                </div>
                                <div class="loc-stat" style="text-align: center;">
                                    <span class="loc-value" style="display: block; font-weight: 600; font-size: 1.1rem;">${(prorationFactor * 100).toFixed(0)}%</span>
                                    <span class="loc-label" style="font-size: 0.75rem; color: var(--text-secondary);">Proration</span>
                                </div>
                                <div class="loc-stat" style="text-align: center;">
                                    <span class="loc-value" style="display: block; font-weight: 600; font-size: 1.1rem;">${formatCurrency(grossEarnings)}</span>
                                    <span class="loc-label" style="font-size: 0.75rem; color: var(--text-secondary);">Gross</span>
                                </div>
                            </div>
                            ${taxItems.length > 0 ? `
                                <div class="location-taxes" style="background: var(--bg-tertiary); padding: 10px; border-radius: 6px; margin-top: 10px;">
                                    <div class="tax-label" style="font-weight: 500; font-size: 0.85rem; margin-bottom: 5px;">Location Taxes: ${formatCurrency(locationTaxes)}</div>
                                    ${taxItems.map(tax => `
                                        <div class="tax-item" style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-secondary);">
                                            <span>${tax.tax_name || tax.taxName} ${tax.jurisdiction_code ? `(${tax.jurisdiction_code})` : ''}</span>
                                            <span>${formatCurrency(tax.tax_amount || tax.taxAmount)}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                            <div class="location-net" style="text-align: right; font-weight: 600; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color);">
                                Net: ${formatCurrency(netPay)}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
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
        // In a real implementation, this would call an API to generate PDF
        const baseUrl = api.getBaseUrl ? api.getBaseUrl('/hrms') : '';
        window.open(`${baseUrl}/hrms/payroll-processing/payslips/${payslipId}/download`, '_blank');
    } catch (error) {
        console.error('Error downloading payslip:', error);
        showToast('Failed to download payslip', 'error');
    }
}

// ==========================================
// HELPER FUNCTIONS FOR PAYSLIPS
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
 * Format revision type for CTC revision arrears display
 */
function formatRevisionType(type) {
    const types = {
        'promotion': 'Promotion',
        'annual_increment': 'Annual Increment',
        'adjustment': 'Adjustment',
        'correction': 'Correction',
        'market_correction': 'Market Correction',
        'performance_bonus': 'Performance Bonus'
    };
    return types[type] || (type ? type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Revision');
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
