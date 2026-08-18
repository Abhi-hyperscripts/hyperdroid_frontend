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

    // Show the Mobile App Settings tab to HR/admin/superadmin and wire the toggle.
    wireAttendanceConfigTab();

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
        'overtime': 'Overtime Requests',
        'settings': 'Mobile App Settings'
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
        case 'settings': loadAttendanceConfig(); break;
    }
}

// ───────────────────────────────────────────────────────────────────────
// Mobile App Settings tab — tenant-scoped attendance config.
// Today this is just the liveness flag, but the same fetch/save pair is
// the future home for any other per-tenant mobile attendance knob
// (geofence enforcement, photo retention policy, etc.). The endpoint
// returns the current config and the strictly-monotonic version number
// that the mobile app's response-header watcher uses to know it needs
// to refetch.
// ───────────────────────────────────────────────────────────────────────

let _attendanceConfigState = { liveness_required: false, config_version: null, updated_by: null, updated_at: null };
let _savingAttendanceConfig = false;

async function loadAttendanceConfig() {
    const toggle = document.getElementById('livenessToggle');
    const pill = document.getElementById('livenessStatusPill');
    const audit = document.getElementById('livenessAuditLine');
    if (!toggle) return; // settings tab not in DOM (RBAC hid it)

    toggle.disabled = true;
    pill.textContent = '…';
    audit.textContent = 'Loading current state…';

    try {
        const cfg = await api.request('/hrms/attendance/config');
        _attendanceConfigState = cfg;
        renderAttendanceConfigState();
    } catch (e) {
        const status = e?.response?.status ?? e?.status;
        audit.textContent = `Couldn't load (${status || 'network error'}). Try again.`;
        pill.textContent = '—';
        if (typeof Toast !== 'undefined') Toast.error('Failed to load attendance settings.');
        // Re-enable the toggle (per edit permission) so the user can actually retry —
        // the success branch was the ONLY place it got re-enabled, so an error left
        // the control permanently greyed out and the "Try again" copy was a lie.
        toggle.disabled = !canEditAttendanceConfig();
    }
}

function renderAttendanceConfigState() {
    const toggle = document.getElementById('livenessToggle');
    const pill = document.getElementById('livenessStatusPill');
    const audit = document.getElementById('livenessAuditLine');
    if (!toggle) return;

    toggle.checked = !!_attendanceConfigState.liveness_required;
    toggle.disabled = !canEditAttendanceConfig();
    pill.textContent = _attendanceConfigState.liveness_required ? 'ON' : 'OFF';
    pill.style.background = _attendanceConfigState.liveness_required ? 'var(--color-success-light)' : 'var(--bg-tertiary)';
    pill.style.color = _attendanceConfigState.liveness_required ? 'var(--color-success-text)' : 'var(--text-secondary)';

    const v = _attendanceConfigState.config_version ?? '—';
    const when = _attendanceConfigState.updated_at
        ? new Date(_attendanceConfigState.updated_at).toLocaleString()
        : 'never';
    audit.textContent = `v${v} · last updated ${when}`;
}

function canEditAttendanceConfig() {
    return hrmsRoles.isHRAdmin() || hrmsRoles.isHrmsAdmin?.() || hrmsRoles.isSuperAdmin();
}

async function saveAttendanceConfig(newValue) {
    if (_savingAttendanceConfig) return;
    _savingAttendanceConfig = true;
    const toggle = document.getElementById('livenessToggle');
    const audit = document.getElementById('livenessAuditLine');
    const previous = _attendanceConfigState.liveness_required;
    toggle.disabled = true;
    audit.textContent = 'Saving…';

    try {
        const updated = await api.request('/hrms/attendance/config', {
            method: 'PUT',
            body: JSON.stringify({ liveness_required: !!newValue })
        });
        _attendanceConfigState = updated;
        renderAttendanceConfigState();
        if (typeof Toast !== 'undefined') {
            Toast.success(newValue
                ? 'Liveness verification turned ON. Mobile devices will update within a minute.'
                : 'Liveness verification turned OFF. Mobile devices will update within a minute.');
        }
    } catch (e) {
        // Roll the toggle back so UI matches server state on failure.
        toggle.checked = previous;
        _attendanceConfigState.liveness_required = previous;
        renderAttendanceConfigState();
        const status = e?.response?.status ?? e?.status;
        if (typeof Toast !== 'undefined') Toast.error(`Save failed (${status || 'network'}). No change applied.`);
    } finally {
        _savingAttendanceConfig = false;
        toggle.disabled = !canEditAttendanceConfig();
    }
}

// Wire toggle handler + RBAC visibility once the DOM is ready. This runs
// alongside setupSidebar so the new tab + button behave like the rest.
function wireAttendanceConfigTab() {
    const navGroup = document.getElementById('attendanceConfigNavGroup');
    if (!navGroup) return;

    // Only HR Admin / Admin / Superadmin can see the Settings tab. The
    // backend GET is open to everyone (mobile app needs it), but the
    // admin UI for it is gated to people who can also PUT.
    if (canEditAttendanceConfig()) {
        navGroup.style.display = '';
    }

    const toggle = document.getElementById('livenessToggle');
    if (!toggle) return;

    toggle.addEventListener('change', async () => {
        const next = toggle.checked;
        // Confirm before turning OFF — weakening fraud detection
        // deserves a deliberate click, not an accidental tap.
        if (!next && typeof Confirm !== 'undefined' && Confirm.show) {
            const ok = await Confirm.show({
                title: 'Disable liveness verification?',
                message: 'Employees will be able to clock in with a single selfie (no live action check). This weakens defence against photo replay attacks. Continue?',
                confirmLabel: 'Turn OFF',
                confirmStyle: 'danger',
            });
            if (!ok) {
                toggle.checked = true;
                return;
            }
        }
        await saveAttendanceConfig(next);
    });
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
        let statusHtml = `<span class="status-badge ${escapeHtml(a.status)}">${escapeHtml(capitalizeFirst(a.status))}</span>`;
        if (a.late_by_minutes > 0) {
            const lateText = a.late_by_minutes >= 60
                ? `${Math.floor(a.late_by_minutes / 60)}h ${a.late_by_minutes % 60}m`
                : `${a.late_by_minutes}m`;
            statusHtml += ` <span class="status-badge late" title="Late by ${lateText}">Late (${lateText})</span>`;
        }

        // GPS pins — tap to open in Google Maps. The mobile app already
        // sends both clock-in + clock-out coordinates (web stays
        // GPS-optional). Two tiny pins side-by-side: green=in, red=out,
        // grey=missing. Hover/title shows the exact coords + accuracy.
        const locHtml = renderGpsCell(a);

        // Clock-in selfie thumbnail. URL is presigned on the row at
        // clock-in time; older rows may show a broken-image fallback
        // (see TODO in renderPhotoCell — re-presign on list is a v2).
        const photoHtml = renderPhotoCell(a);

        // Actions cell — SUPERADMIN-only Delete button. The backend
        // enforces the same role; hiding the UI button is just so HR
        // admins don't get a 401 when they don't expect it.
        const actionsHtml = renderActionsCell(a);

        return `
        <tr>
            <td>
                <div class="employee-info">
                    <div class="employee-avatar">${escapeHtml(getInitials(a.employee_name))}</div>
                    <div class="employee-name">${escapeHtml(a.employee_name) || 'Employee'}</div>
                </div>
            </td>
            <td>${photoHtml}</td>
            <td>${formatTime(a.check_in_time)}</td>
            <td>${formatTime(a.check_out_time)}</td>
            <td>${a.total_hours ? a.total_hours.toFixed(1) + 'h' : '-'}</td>
            <td>${statusHtml}</td>
            <td>${escapeHtml(capitalizeFirst(a.attendance_type)) || '-'}</td>
            <td>${locHtml}</td>
            <td>${actionsHtml}</td>
        </tr>
    `;
    }).join('');
}

// Small circular thumbnail for the clock-in selfie. Click expands to a
// full-screen lightbox. No photo → outlined placeholder circle.
//
// TODO(v2): the presigned URL stored in check_in_photo_url expires
// (typically 1 hour from clock-in). The list endpoint should re-presign
// on each fetch — moving to GetEmployeeProfilePhotoUrlAsync-style
// derivation. For now older rows will show a broken image; the onerror
// handler swaps to the placeholder so the table doesn't break.
function renderPhotoCell(a) {
    const url = a.check_in_photo_url;
    if (!url) {
        return `<span class="attendance-photo-empty" title="No clock-in photo">📷</span>`;
    }
    const safeUrl = url.replace(/"/g, '&quot;');
    return `
        <img src="${safeUrl}"
             class="attendance-photo-thumb"
             alt="Clock-in selfie"
             title="Click to expand"
             onclick="openAttendancePhotoLightbox('${safeUrl}', '${escapeHtml(a.employee_name || '')}', '${escapeHtml(formatTime(a.check_in_time) || '')}')"
             onerror="this.outerHTML='<span class=&quot;attendance-photo-empty&quot; title=&quot;Photo expired or unavailable&quot;>📷</span>'" />
    `;
}

// Actions cell: a small trash icon button. Three gates before we render it:
//   1. Caller is SUPERADMIN — backend enforces this; we hide the button
//      for everyone else so they don't get a 401 they don't expect.
//   2. The row has a real DB id — absent-employee rows are synthesised
//      client-side from the employee roster (no attendance_records row
//      yet), so there's nothing to delete.
//   3. The row has at least one of check_in_time or check_out_time — an
//      attendance_records row with both null is effectively empty, and
//      should not be deletable (nothing to undo).
// Anything that fails the gates renders an em-dash so the column stays
// aligned without a phantom button.
function renderActionsCell(a) {
    if (!(window.hrmsRoles && hrmsRoles.isSuperAdmin && hrmsRoles.isSuperAdmin())) {
        return `<span style="color: var(--text-muted);">—</span>`;
    }
    if (!a.id || (!a.check_in_time && !a.check_out_time)) {
        return `<span style="color: var(--text-muted);" title="Nothing to delete — no clock-in / clock-out yet.">—</span>`;
    }
    return `
        <button
            class="btn-attendance-delete"
            onclick="confirmDeleteAttendance('${a.id}', '${escapeHtml(a.employee_name || 'Employee')}', '${escapeHtml(formatTime(a.check_in_time) || '')}')"
            title="Delete clock-in/out, photos, GPS, and the rest of this attendance row (SUPERADMIN only). The employee record is untouched.">
            🗑️
        </button>
    `;
}

// Lightbox for the selfie thumbnail. Renders a fixed-position overlay
// with the photo enlarged, the employee name + clock-in time captioned,
// and a close button. Clicking the backdrop or pressing Escape closes.
function openAttendancePhotoLightbox(url, employeeName, clockInTime) {
    // Reuse if already open (e.g. double-click).
    let existing = document.getElementById('attendancePhotoLightbox');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'attendancePhotoLightbox';
    overlay.className = 'attendance-photo-lightbox';
    overlay.innerHTML = `
        <div class="attendance-photo-lightbox-content" onclick="event.stopPropagation()">
            <img src="${url.replace(/"/g, '&quot;')}" alt="Clock-in selfie" />
            <div class="attendance-photo-lightbox-caption">
                <strong>${employeeName}</strong>
                <span>Clocked in at ${clockInTime}</span>
            </div>
            <button class="attendance-photo-lightbox-close" onclick="document.getElementById('attendancePhotoLightbox').remove()">✕</button>
        </div>
    `;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);

    // ESC closes too — added once per lightbox open so it self-removes.
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}
window.openAttendancePhotoLightbox = openAttendancePhotoLightbox;

// SUPERADMIN delete confirmation. Shows a modal with the employee
// + clock-in time so the admin can confirm they're deleting the
// right record. The backend deletes both the DB row AND the Drive
// photo(s) — that's why this is irreversible.
async function confirmDeleteAttendance(recordId, employeeName, clockInTime) {
    // Use Confirm.show from toast.js — project convention; never the
    // browser's window.confirm (which looks like a phishing dialog and
    // ignores our theme). Confirm.show escapes HTML in the message
    // field, so format with line breaks + bullet characters, not tags.
    const confirmed = await Confirm.show({
        type: 'danger',
        title: `Delete today's attendance for ${employeeName}?`,
        message:
            `Clocked in at ${clockInTime}.\n\n` +
            `REMOVES:\n` +
            `  • Check-in and check-out times\n` +
            `  • GPS coordinates\n` +
            `  • Selfie photo (from Drive storage)\n` +
            `  • Status, notes, and other attendance fields\n\n` +
            `KEEPS:\n` +
            `  • The employee profile\n` +
            `  • Salary, leave balance, every other day's attendance\n\n` +
            `This cannot be undone.`,
        confirmText: 'Delete attendance',
        cancelText: 'Keep it',
    });
    if (!confirmed) return;

    try {
        // The api singleton uses `api.request(url, { method })` for any
        // non-GET verb (organization.js, recruitment.js, leave.js all
        // do the same). There is no shorthand `api.delete()`.
        await api.request(`/hrms/attendance/${recordId}`, { method: 'DELETE' });
        showToast('Attendance record deleted', 'success');
        // No explicit refresh — the backend broadcasts AttendanceUpdated
        // (Action='deleted') over SignalR, and onAttendanceUpdated() in
        // this file already calls loadAttendance() when that fires.
        // Belt-and-braces fallback: refresh anyway after a small delay,
        // in case the WebSocket dropped between delete and broadcast.
        setTimeout(() => { if (typeof loadAttendance === 'function') loadAttendance(); }, 500);
    } catch (e) {
        const errMsg = e?.response?.data?.error
            ?? e?.message
            ?? 'Could not delete the record.';
        showToast(errMsg, 'error');
        console.error('[attendance] delete failed', e);
    }
}
window.confirmDeleteAttendance = confirmDeleteAttendance;

// One-line cell with two map pins: green (clock-in) + red (clock-out).
// Each pin is a link to https://maps.google.com/?q=lat,long when GPS
// was captured; an outlined grey pin when missing (e.g. user denied
// location permission or clocked out from the web without geofence).
function renderGpsCell(a) {
    const fmt = (lat, lng) => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
    const pin = (lat, lng, color, title) => {
        if (lat == null || lng == null) {
            return `<span class="gps-pin gps-pin-missing" title="${escapeHtml(title)} — no GPS captured">📍</span>`;
        }
        const href = `https://maps.google.com/?q=${lat},${lng}`;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer"
                   class="gps-pin gps-pin-${color}"
                   title="${escapeHtml(title)} · ${fmt(lat, lng)}">📍</a>`;
    };
    return `
        <span style="display:inline-flex;gap:6px;align-items:center;">
            ${pin(a.check_in_latitude,  a.check_in_longitude,  'in',  'Clock-in')}
            ${pin(a.check_out_latitude, a.check_out_longitude, 'out', 'Clock-out')}
        </span>
    `;
}

function updateDailyStats(present, absent, late, onLeave) {
    document.getElementById('presentCount').textContent = present;
    document.getElementById('absentCount').textContent = absent;
    document.getElementById('lateCount').textContent = late;
    document.getElementById('onLeaveCount').textContent = onLeave;
    renderAttendanceTrend();
}

// 30-day trend from /hrms/reports/daily-attendance, which returns one row per
// date x office x department — roll up by date. Re-fetches when the office
// filter or date changes; hidden when the window has no records.
let _attTrendKey = null;
async function renderAttendanceTrend() {
    const wrap = document.getElementById('attChartsWrap');
    if (!wrap || typeof acColumns !== 'function' || typeof ApexCharts === 'undefined') return;

    const toDate = document.getElementById('attendanceDate')?.value || new Date().toISOString().slice(0, 10);
    const officeId = (typeof officeDropdown !== 'undefined' && officeDropdown) ? officeDropdown.getValue() : '';
    const key = `${toDate}|${officeId}`;
    if (key === _attTrendKey) return;      // nothing changed
    _attTrendKey = key;

    try {
        const from = new Date(Date.parse(toDate) - 29 * 864e5).toISOString().slice(0, 10);
        let url = `/hrms/reports/daily-attendance?fromDate=${from}&toDate=${toDate}`;
        if (officeId) url += `&officeId=${officeId}`;
        const rows = await api.request(url) || [];

        const byDay = {};
        rows.forEach(r => {
            const k = String(r.date || '').slice(0, 10);
            if (!k) return;
            (byDay[k] = byDay[k] || { p: 0, a: 0, l: 0 });
            byDay[k].p += r.present || 0;
            byDay[k].a += r.absent || 0;
            byDay[k].l += r.on_leave || 0;
        });
        const keys = Object.keys(byDay).sort();
        if (!keys.length) { wrap.style.display = 'none'; return; }

        wrap.style.display = '';
        const lbl = k => new Date(k).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const draw = () => acColumns('attTrendChart', keys.map(lbl), [
            { name: 'Present', data: keys.map(k => byDay[k].p) },
            { name: 'Absent', data: keys.map(k => byDay[k].a) },
            { name: 'On leave', data: keys.map(k => byDay[k].l) }
        ], ['#10b981', '#ef4444', '#f59e0b'], v => `${v}`);
        draw();
        _acActiveRender = draw;
    } catch (e) {
        console.warn('[attendance] trend unavailable:', e && e.message);
        wrap.style.display = 'none';
    }
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
            <td><span class="status-badge ${escapeHtml(r.status)}">${escapeHtml(capitalizeFirst(r.status))}</span></td>
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
            <td><span class="status-badge status-${escapeHtml(String(r.status || '').toLowerCase())}">${escapeHtml(capitalizeFirst(r.status))}</span></td>
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
                <td><span class="status-badge ${escapeHtml(a.status)}">${escapeHtml(capitalizeFirst(a.status))}</span></td>
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
                <td><span class="status-badge ${escapeHtml(r.status)}">${escapeHtml(capitalizeFirst(r.status))}</span></td>
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
                <td><span class="status-badge status-${escapeHtml(String(r.status || '').toLowerCase())}">${escapeHtml(capitalizeFirst(r.status))}</span></td>
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
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
        case 'deleted':
            // Fired by the SUPERADMIN delete endpoint. Toast is muted —
            // the actor already saw their own "Attendance record deleted"
            // success toast from confirmDeleteAttendance(), so this one
            // is mainly so OTHER admins watching the table get a hint
            // about why the row just vanished.
            message = `Attendance deleted for ${employeeName}`;
            break;
        default:
            message = `Attendance updated for ${employeeName}`;
    }

    showToast(message, 'info');

    // Reload attendance data
    loadAttendance();
}
