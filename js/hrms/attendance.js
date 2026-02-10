let currentUser = null;
let pendingRejectionId = null;

// SearchableDropdown instances
let officeDropdown = null;
let regOfficeDropdown = null;
let otOfficeDropdown = null;
let regStatusDropdown = null;
let otStatusDropdown = null;

// MonthPicker instances
let regMonthPicker = null;
let otMonthPicker = null;

// Date picker instance for daily attendance
let dailyDatePicker = null;

// Data arrays
let offices = [];

// Pagination instances
let attendancePagination = null;
let regularizationPagination = null;
let overtimePagination = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('hrms', '../');

    // Initialize RBAC
    hrmsRoles.init();
    currentUser = api.getUser();

    // CRITICAL: Require organization setup before accessing Attendance page
    // This prevents users from bypassing setup by directly navigating to URL
    const setupComplete = await hrmsRoles.requireOrganizationSetup({
        showToast: true,
        redirectUrl: 'organization.html'
    });
    if (!setupComplete) return;

    // Apply RBAC visibility
    applyAttendanceRBAC();

    // Setup sidebar navigation
    setupSidebar();

    // Initialize daily date picker with Flatpickr
    initializeDailyDatePicker();

    // Load offices first, then initialize dropdowns
    await loadOffices();

    // Initialize SearchableDropdowns for status filters
    initializeStatusDropdowns();

    await loadAttendance();
});

// Apply RBAC visibility rules for attendance page
// This page is now Admin/Manager only - regular employees use ESS
function applyAttendanceRBAC() {
    // Only HR users, managers, and admins can access this page
    if (!hrmsRoles.isHRUser() && !hrmsRoles.isManager() && !hrmsRoles.isHRAdmin() && !hrmsRoles.isSuperAdmin()) {
        // Redirect regular employees to ESS page
        window.location.href = 'self-service.html';
        return;
    }
}

// Initialize daily date picker using HRMSDatePicker (styled Flatpickr with custom month/year selectors)
function initializeDailyDatePicker() {
    const container = document.getElementById('dailyDatePicker');
    if (!container || dailyDatePicker) return;

    // Create the date input element as type="text" to prevent MutationObserver auto-init
    // The MutationObserver in hrms-datepicker.js auto-initializes type="date" inputs
    // which prevents our custom options (defaultDate, onChange) from being applied
    const input = document.createElement('input');
    input.type = 'text';  // Use text to avoid auto-init, Flatpickr will handle it
    input.id = 'dateFilter';
    input.className = 'date-picker-input';
    input.placeholder = 'Select date...';
    container.appendChild(input);

    // Get today's date as YYYY-MM-DD string (required for setDate with maxDate constraint)
    // Using Date object with maxDate:'today' causes issues due to time comparison
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Initialize using HRMSDatePicker for beautifully styled calendar
    // This adds custom month/year dropdown selectors with search
    dailyDatePicker = HRMSDatePicker.init(input, {
        defaultDate: todayStr,
        maxDate: 'today',
        onChange: function(selectedDates, dateStr) {
            if (dateStr) {
                loadAttendance();
            }
        },
        onReady: function(selectedDates, dateStr, instance) {
            // Set today's date once Flatpickr is fully initialized
            // This ensures the date is displayed in the input on page load
            // Must use string format, not Date object, due to maxDate time comparison issues
            if (selectedDates.length === 0) {
                instance.setDate(todayStr, false);  // false = don't trigger onChange yet
            }
        }
    });
}

// Get selected date from daily date picker
function getSelectedDate() {
    if (dailyDatePicker && dailyDatePicker.selectedDates.length > 0) {
        // Format as YYYY-MM-DD using local date (not UTC)
        // toISOString() returns UTC which causes timezone bugs
        const date = dailyDatePicker.selectedDates[0];
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    // Default to today (using local date)
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Load offices and initialize office dropdowns
async function loadOffices() {
    try {
        const response = await api.request('/hrms/offices');
        offices = Array.isArray(response) ? response : (response?.data || []);

        // Use HrmsOfficeSelection for localStorage persistence
        const selectedOfficeId = HrmsOfficeSelection.initializeSelection(offices);
        const dropdownOptions = HrmsOfficeSelection.buildOfficeOptions(offices, { isFormDropdown: false });

        // Convert options to SearchableDropdown format
        const searchableOptions = dropdownOptions.map(opt => ({
            value: opt.value,
            label: opt.label
        }));

        // Initialize Daily Attendance office dropdown
        if (!officeDropdown && typeof convertSelectToSearchable === 'function') {
            officeDropdown = convertSelectToSearchable('officeFilter', {
                compact: true,
                placeholder: 'Select Office',
                searchPlaceholder: 'Search offices...',
                onChange: (value) => {
                    HrmsOfficeSelection.setSelectedOfficeId(value);
                    loadAttendance();
                }
            });
        }

        if (officeDropdown) {
            officeDropdown.setOptions(searchableOptions);
            officeDropdown.setValue(selectedOfficeId);
        }

        // Initialize Regularization office dropdown
        if (!regOfficeDropdown && document.getElementById('regOfficeFilter') && typeof convertSelectToSearchable === 'function') {
            regOfficeDropdown = convertSelectToSearchable('regOfficeFilter', {
                compact: true,
                placeholder: 'All Offices',
                searchPlaceholder: 'Search offices...',
                onChange: () => {
                    loadTeamRegularizations();
                }
            });
        }

        if (regOfficeDropdown) {
            regOfficeDropdown.setOptions(searchableOptions);
            regOfficeDropdown.setValue(selectedOfficeId);
        }

        // Initialize Overtime office dropdown
        if (!otOfficeDropdown && document.getElementById('otOfficeFilter') && typeof convertSelectToSearchable === 'function') {
            otOfficeDropdown = convertSelectToSearchable('otOfficeFilter', {
                compact: true,
                placeholder: 'All Offices',
                searchPlaceholder: 'Search offices...',
                onChange: () => {
                    loadTeamOvertime();
                }
            });
        }

        if (otOfficeDropdown) {
            otOfficeDropdown.setOptions(searchableOptions);
            otOfficeDropdown.setValue(selectedOfficeId);
        }
    } catch (error) {
        console.error('Error loading offices:', error);
    }
}

// Initialize status filter dropdowns with SearchableDropdown
function initializeStatusDropdowns() {
    // Regularization month picker
    if (document.getElementById('regMonthPicker') && typeof MonthPicker !== 'undefined') {
        const now = new Date();
        regMonthPicker = new MonthPicker('regMonthPicker', {
            year: now.getFullYear(),
            month: now.getMonth() + 1, // Current month selected by default
            allowAllMonths: true,
            yearsBack: 2,
            yearsForward: 0,
            onChange: () => {
                loadTeamRegularizations();
            }
        });
    }

    // Regularization status filter
    if (document.getElementById('regStatusFilter') && typeof convertSelectToSearchable === 'function') {
        regStatusDropdown = convertSelectToSearchable('regStatusFilter', {
            compact: true,
            placeholder: 'Select Status',
            searchPlaceholder: 'Search...',
            onChange: (value) => {
                loadTeamRegularizations();
            }
        });
    }

    // Overtime month picker
    if (document.getElementById('otMonthPicker') && typeof MonthPicker !== 'undefined') {
        const now = new Date();
        otMonthPicker = new MonthPicker('otMonthPicker', {
            year: now.getFullYear(),
            month: now.getMonth() + 1, // Current month selected by default
            allowAllMonths: true,
            yearsBack: 2,
            yearsForward: 0,
            onChange: () => {
                loadTeamOvertime();
            }
        });
    }

    // Overtime status filter
    if (document.getElementById('otStatusFilter') && typeof convertSelectToSearchable === 'function') {
        otStatusDropdown = convertSelectToSearchable('otStatusFilter', {
            compact: true,
            placeholder: 'Select Status',
            searchPlaceholder: 'Search...',
            onChange: (value) => {
                loadTeamOvertime();
            }
        });
    }
}

function switchTab(tabName) {
    // Update sidebar buttons
    document.querySelectorAll('.sidebar-btn').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    const tabBtn = document.querySelector(`.sidebar-btn[data-tab="${tabName}"]`);
    if (tabBtn) {
        tabBtn.classList.add('active');
    }

    // Update tab content - IDs match tab names directly
    const tabContent = document.getElementById(tabName);
    if (tabContent) {
        tabContent.classList.add('active');
    }

    // Update active tab title
    const tabNames = {
        'daily': 'Daily Attendance',
        'regularization': 'Regularization Requests',
        'overtime': 'Overtime Requests'
    };
    const activeTabName = document.getElementById('activeTabName');
    if (activeTabName && tabNames[tabName]) {
        activeTabName.textContent = tabNames[tabName];
    }

    // Load data for the tab
    switch(tabName) {
        case 'daily': loadAttendance(); break;
        case 'regularization': loadTeamRegularizations(); break;
        case 'overtime': loadTeamOvertime(); break;
    }
}

async function loadAttendance() {
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '<tr><td colspan="6"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const date = getSelectedDate();
        const selectedOfficeId = officeDropdown ? officeDropdown.getValue() : '';

        // Build query string with optional office filter
        let url = `/hrms/attendance/team?date=${date}`;
        if (selectedOfficeId) {
            url += `&officeId=${selectedOfficeId}`;
        }

        // Use team attendance endpoint which returns array of attendance records
        let attendance = await api.request(url) || [];

        // Client-side filter by office if API doesn't support it
        if (selectedOfficeId && attendance.length > 0 && attendance[0].office_id) {
            attendance = attendance.filter(a => a.office_id === selectedOfficeId);
        }

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

        // Use pagination if available
        if (typeof createTablePagination !== 'undefined') {
            attendancePagination = createTablePagination('attendancePagination', {
                containerSelector: '#attendancePagination',
                data: attendance,
                rowsPerPage: 25,
                rowsPerPageOptions: [10, 25, 50, 100],
                onPageChange: (paginatedData, pageInfo) => {
                    renderAttendanceRows(paginatedData);
                }
            });
        } else {
            renderAttendanceRows(attendance);
        }

    } catch (error) {
        console.error('Error loading attendance:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Error loading attendance</p></td></tr>';
    }
}

function renderAttendanceRows(attendance) {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

    if (!attendance || attendance.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No attendance records for this date</p></td></tr>';
        return;
    }

    tbody.innerHTML = attendance.map(a => {
        // Build status display - show Late badge if late_by_minutes > 0
        let statusHtml = `<span class="status-badge ${escapeHtml(a.status)}">${capitalizeFirst(a.status)}</span>`;
        if (a.late_by_minutes > 0) {
            const lateText = a.late_by_minutes >= 60
                ? `${Math.floor(a.late_by_minutes / 60)}h ${a.late_by_minutes % 60}m`
                : `${a.late_by_minutes}m`;
            statusHtml += ` <span class="status-badge late" title="Late by ${lateText}">Late (${lateText})</span>`;
        }

        return `
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
            <td>${statusHtml}</td>
            <td>${capitalizeFirst(a.attendance_type) || '-'}</td>
        </tr>
    `;
    }).join('');
}

function updateDailyStats(present, absent, late, onLeave) {
    document.getElementById('presentCount').textContent = present;
    document.getElementById('absentCount').textContent = absent;
    document.getElementById('lateCount').textContent = late;
    document.getElementById('onLeaveCount').textContent = onLeave;
}

// Team Regularization Requests (Admin/Manager view)
async function loadTeamRegularizations() {
    const tbody = document.getElementById('teamRegularizationTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const statusFilter = regStatusDropdown ? regStatusDropdown.getValue() : (document.getElementById('regStatusFilter')?.value || 'pending');

        // Get month/year from picker
        let month = null;
        let year = null;
        if (regMonthPicker) {
            const pickerValue = regMonthPicker.getValue();
            month = pickerValue.month;
            year = pickerValue.year;
        }

        // Get office filter
        const officeId = regOfficeDropdown ? regOfficeDropdown.getValue() : '';

        // Use team regularizations endpoint with status, month/year, and office filter
        const filtered = await api.getTeamRegularizations(statusFilter, hrmsRoles.isHRAdmin(), month, year, officeId || null) || [];

        if (!filtered || filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><p>No ${statusFilter === 'all' ? '' : statusFilter} regularization requests</p></td></tr>`;
            return;
        }

        // Use pagination if available
        if (typeof createTablePagination !== 'undefined') {
            regularizationPagination = createTablePagination('regularizationPagination', {
                containerSelector: '#regularizationPagination',
                data: filtered,
                rowsPerPage: 25,
                rowsPerPageOptions: [10, 25, 50, 100],
                onPageChange: (paginatedData, pageInfo) => {
                    renderRegularizationRows(paginatedData);
                }
            });
        } else {
            renderRegularizationRows(filtered);
        }

    } catch (error) {
        console.error('Error loading team regularizations:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Error loading requests</p></td></tr>';
    }
}

function renderRegularizationRows(filtered) {
    const tbody = document.getElementById('teamRegularizationTableBody');
    if (!tbody) return;

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>No regularization requests</p></td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(r => {
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
                    <div class="employee-name">${escapeHtml(r.employee_name) || 'Employee'}</div>
                </div>
            </td>
            <td>${formatDate(r.date)}</td>
            <td>${formatTime(r.requested_check_in)}</td>
            <td>${formatTime(r.requested_check_out)}</td>
            <td class="reason-cell">${escapeHtml(r.reason) || '-'}</td>
            <td><span class="status-badge ${escapeHtml(r.status)}">${capitalizeFirst(r.status)}</span></td>
            <td>
                ${r.status?.toLowerCase() === 'pending' && canApprove ? `
                    <div class="action-buttons">
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
                    </div>
                ` : '-'}
            </td>
        </tr>
    `}).join('');
}

// Team Overtime Requests (Admin/Manager view)
async function loadTeamOvertime() {
    const tbody = document.getElementById('teamOvertimeTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8"><div class="loading-spinner"><div class="spinner"></div></div></td></tr>';

    try {
        const statusFilter = otStatusDropdown ? otStatusDropdown.getValue() : (document.getElementById('otStatusFilter')?.value || 'pending');

        // Get month/year from picker
        let month = null;
        let year = null;
        if (otMonthPicker) {
            const pickerValue = otMonthPicker.getValue();
            month = pickerValue.month;
            year = pickerValue.year;
        }

        // Get office filter
        const officeId = otOfficeDropdown ? otOfficeDropdown.getValue() : '';

        // Use team overtime endpoint with status, month/year, and office filter
        const filtered = await api.getTeamOvertimeRequests(statusFilter, hrmsRoles.isHRAdmin(), month, year, officeId || null) || [];

        if (!filtered || filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><p>No ${statusFilter === 'all' ? '' : statusFilter} overtime requests</p></td></tr>`;
            return;
        }

        // Use pagination if available
        if (typeof createTablePagination !== 'undefined') {
            overtimePagination = createTablePagination('overtimePagination', {
                containerSelector: '#overtimePagination',
                data: filtered,
                rowsPerPage: 25,
                rowsPerPageOptions: [10, 25, 50, 100],
                onPageChange: (paginatedData, pageInfo) => {
                    renderOvertimeRows(paginatedData);
                }
            });
        } else {
            renderOvertimeRows(filtered);
        }

    } catch (error) {
        console.error('Error loading team overtime:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>Error loading requests</p></td></tr>';
    }
}

function renderOvertimeRows(filtered) {
    const tbody = document.getElementById('teamOvertimeTableBody');
    if (!tbody) return;

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No overtime requests</p></td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(r => {
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
                    <div class="employee-name">${escapeHtml(r.employee_name) || 'Employee'}</div>
                </div>
            </td>
            <td>${formatDate(r.date)}</td>
            <td>${formatTime(r.planned_start_time)}</td>
            <td>${formatTime(r.planned_end_time)}</td>
            <td class="reason-cell">${escapeHtml(r.reason) || '-'}</td>
            <td>${escapeHtml(r.task_project) || '-'}</td>
            <td><span class="status-badge status-${r.status?.toLowerCase()}">${capitalizeFirst(r.status)}</span></td>
            <td>
                ${r.status?.toLowerCase() === 'pending' && canApprove ? `
                    <div class="action-buttons">
                        <button class="action-btn success" onclick="approveOvertime('${r.id}')" data-tooltip="Approve">
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
                    </div>
                ` : '-'}
            </td>
        </tr>
    `}).join('');
}

// Keep old function for backwards compatibility but remove it later
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
    if (!tbody) return;
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
        // Refresh whichever view is currently active
        loadTeamRegularizations();
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
        // Refresh whichever view is currently active
        loadTeamRegularizations();
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
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('gm-animating');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('active'));
    });
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
    setTimeout(() => el.classList.remove('gm-animating'), 200);
}

// Local showToast removed - using unified toast.js instead

// Setup sidebar navigation
function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('organizationSidebar');
    const activeTabName = document.getElementById('activeTabName');
    const container = document.querySelector('.hrms-container');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    const tabNames = {
        'daily': 'Daily View',
        'myAttendance': 'My Attendance',
        'regularization': 'Regularization',
        'overtime': 'Overtime',
        'approvals': 'Pending Approvals'
    };

    function updateActiveTabTitle(tabId) {
        if (activeTabName && tabNames[tabId]) {
            activeTabName.textContent = tabNames[tabId];
        }
    }

    // Open sidebar by default on desktop, ensure closed on mobile
    if (window.innerWidth > 1024) {
        toggle.classList.add('active');
        sidebar.classList.add('open');
        container?.classList.add('sidebar-open');
    } else {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
        overlay?.classList.remove('active');
    }

    // Toggle sidebar open/close
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
        if (window.innerWidth <= 1024) {
            overlay?.classList.toggle('active');
        }
    });

    // Close sidebar when clicking overlay (mobile)
    overlay?.addEventListener('click', () => {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
        overlay?.classList.remove('active');
    });

    // Collapsible nav groups
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.nav-group');
            group.classList.toggle('collapsed');
        });
    });

    // Sidebar button clicks to switch tabs
    document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            switchTab(tabId);
            updateActiveTabTitle(tabId);
        });
    });

    // ESC key to close sidebar
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
        }
    });
}

// ============================================
// SignalR Real-Time Event Handlers
// ============================================

/**
 * Called when attendance is updated (from hrms-signalr.js)
 */
function onAttendanceUpdated(data) {
    console.log('[Attendance] Update received:', data);

    const action = data.Action;
    const employeeName = data.EmployeeName || 'Employee';

    let message = '';
    switch(action) {
        case 'clock_in':
            message = `${employeeName} clocked in`;
            break;
        case 'clock_out':
            message = `${employeeName} clocked out`;
            break;
        case 'regularized':
            message = `Attendance regularized for ${employeeName}`;
            break;
        case 'regularization_approved':
            message = `Regularization approved for ${employeeName}`;
            break;
        case 'regularization_rejected':
            message = `Regularization rejected for ${employeeName}`;
            break;
        default:
            message = `Attendance updated for ${employeeName}`;
    }

    showToast(message, 'info');

    // Reload attendance data
    loadAttendance();
}
