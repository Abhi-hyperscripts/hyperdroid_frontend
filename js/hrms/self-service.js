/**
 * HRMS Employee Self-Service Dashboard
 */

// Global variables
let currentEmployee = null;
let clockInterval = null;
let workingHoursInterval = null;
let clockedIn = false;
let checkInTime = null;

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

        if (dashboard) {
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
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Failed to load dashboard data', 'error');
    }
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
