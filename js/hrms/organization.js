// Organization Page JavaScript
let currentUser = null;
let isAdmin = false;
let offices = [];
let departments = [];
let designations = [];
let shifts = [];
let holidays = [];
let employees = [];

// Convert time string from "9:00 AM" or "09:00 AM" format to "HH:mm:ss" (24-hour TimeSpan format)
function convertTo24HourFormat(timeStr) {
    if (!timeStr) return null;

    // If already in 24-hour format (HH:mm or HH:mm:ss), return with seconds
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeStr) && !timeStr.toLowerCase().includes('am') && !timeStr.toLowerCase().includes('pm')) {
        const parts = timeStr.split(':');
        const hours = parts[0].padStart(2, '0');
        const minutes = parts[1].padStart(2, '0');
        const seconds = parts[2] || '00';
        return `${hours}:${minutes}:${seconds}`;
    }

    // Parse AM/PM format
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) {
        console.warn('Invalid time format:', timeStr);
        return timeStr; // Return as-is if format not recognized
    }

    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const period = match[3].toUpperCase();

    // Convert to 24-hour format
    if (period === 'AM') {
        if (hours === 12) hours = 0;
    } else { // PM
        if (hours !== 12) hours += 12;
    }

    return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
}

// Convert time from "HH:mm:ss" (24-hour) format to "h:mm AM/PM" for display
function convertTo12HourFormat(timeStr) {
    if (!timeStr) return '';

    const parts = timeStr.split(':');
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    const period = hours >= 12 ? 'PM' : 'AM';

    if (hours === 0) hours = 12;
    else if (hours > 12) hours -= 12;

    return `${hours}:${minutes} ${period}`;
}

document.addEventListener('DOMContentLoaded', async function() {
    await loadNavigation();
    await initializePage();
});

async function initializePage() {
    try {
        showLoading();
        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }
        currentUser = api.getUser();

        if (!currentUser) {
            window.location.href = '../login.html';
            return;
        }

        isAdmin = currentUser.roles?.includes('HRMS_ADMIN') || currentUser.roles?.includes('SUPERADMIN');

        // Setup tabs
        setupTabs();

        // Load all data
        await loadAllData();

        hideLoading();
    } catch (error) {
        console.error('Error initializing page:', error);
        showToast('Failed to load page data', 'error');
        hideLoading();
    }
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;

            tabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        });
    });
}

async function loadAllData() {
    await Promise.all([
        loadOffices(),
        loadDepartments(),
        loadDesignations(),
        loadShifts(),
        loadHolidays()
    ]);

    if (isAdmin) {
        await loadEmployees();
    }
}

async function loadOffices() {
    try {
        const response = await api.request('/hrms/offices');
        offices = Array.isArray(response) ? response : (response?.data || []);

        // Update stats by office type
        document.getElementById('totalOffices').textContent = offices.length;
        document.getElementById('headOfficeCount').textContent = offices.filter(o => o.office_type === 'head').length;
        document.getElementById('regionalOfficeCount').textContent = offices.filter(o => o.office_type === 'regional').length;
        document.getElementById('branchOfficeCount').textContent = offices.filter(o => o.office_type === 'branch' || !o.office_type).length;
        document.getElementById('satelliteOfficeCount').textContent = offices.filter(o => o.office_type === 'satellite').length;

        updateOfficesTable();
        populateOfficeSelects();
    } catch (error) {
        console.error('Error loading offices:', error);
    }
}

function updateOfficesTable() {
    const tbody = document.getElementById('officesTable');
    const searchTerm = document.getElementById('officeSearch')?.value?.toLowerCase() || '';

    // Map office_type to display text for searching
    const typeMap = {
        'head': 'head office',
        'regional': 'regional office',
        'branch': 'branch office',
        'satellite': 'satellite office'
    };

    const filtered = offices.filter(o => {
        const officeTypeText = typeMap[o.office_type] || 'branch office';
        const statusText = o.is_active ? 'active' : 'inactive';
        const location = `${o.city || ''} ${o.country || ''}`.toLowerCase();

        return o.office_name?.toLowerCase().includes(searchTerm) ||
            o.office_code?.toLowerCase().includes(searchTerm) ||
            officeTypeText.includes(searchTerm) ||
            location.includes(searchTerm) ||
            statusText.includes(searchTerm);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                            <polyline points="9 22 9 12 15 12 15 22"></polyline>
                        </svg>
                        <p>No offices configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(office => {
        // Map office_type to display text
        const typeMap = {
            'head': 'Head Office',
            'regional': 'Regional Office',
            'branch': 'Branch Office',
            'satellite': 'Satellite Office'
        };
        const officeType = typeMap[office.office_type] || 'Branch Office';
        const badgeClass = office.office_type || 'branch';
        return `
        <tr>
            <td><strong>${office.office_name}</strong></td>
            <td><code>${office.office_code}</code></td>
            <td><span class="badge badge-${badgeClass}">${officeType}</span></td>
            <td>${office.city || ''}, ${office.country || ''}</td>
            <td>${office.employee_count || 0}</td>
            <td><span class="status-badge status-${office.is_active ? 'active' : 'inactive'}">${office.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editOffice('${office.id}')" data-tooltip="Edit Office">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function populateOfficeSelects() {
    const selects = ['departmentOffice', 'deptOffice', 'shiftOffice', 'shiftOfficeId', 'holidayOffice', 'holidayOffices'];
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            const isMultiple = select.multiple;
            const firstOption = isMultiple ? '' : '<option value="">Select Office</option>';
            select.innerHTML = firstOption;
            offices.filter(o => o.is_active).forEach(office => {
                select.innerHTML += `<option value="${office.id}">${office.office_name}</option>`;
            });
        }
    });
}

async function loadDepartments() {
    try {
        const response = await api.request('/hrms/departments');
        departments = Array.isArray(response) ? response : (response?.data || []);
        updateDepartmentsTable();
        populateDepartmentSelects();
    } catch (error) {
        console.error('Error loading departments:', error);
    }
}

function updateDepartmentsTable() {
    const tbody = document.getElementById('departmentsTable');
    const searchTerm = document.getElementById('departmentSearch')?.value?.toLowerCase() || '';
    const officeFilter = document.getElementById('departmentOffice')?.value || '';

    let filtered = departments.filter(d =>
        d.department_name?.toLowerCase().includes(searchTerm) ||
        d.department_code?.toLowerCase().includes(searchTerm)
    );

    if (officeFilter) {
        filtered = filtered.filter(d => d.office_id === officeFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                        </svg>
                        <p>No departments configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(dept => `
        <tr>
            <td><strong>${dept.department_name}</strong></td>
            <td><code>${dept.department_code}</code></td>
            <td>${dept.office_name || '-'}</td>
            <td>${dept.head_name || '-'}</td>
            <td>${dept.employee_count || 0}</td>
            <td><span class="status-badge status-${dept.is_active ? 'active' : 'inactive'}">${dept.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editDepartment('${dept.id}')" data-tooltip="Edit Department">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function populateDepartmentSelects() {
    const selects = ['designationDepartment', 'desigDepartment'];
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.innerHTML = '<option value="">All Departments</option>';
            departments.filter(d => d.is_active).forEach(dept => {
                select.innerHTML += `<option value="${dept.id}">${dept.department_name}</option>`;
            });
        }
    });
}

async function loadDesignations() {
    try {
        const response = await api.request('/hrms/designations');
        designations = Array.isArray(response) ? response : (response?.data || []);
        updateDesignationsTable();
    } catch (error) {
        console.error('Error loading designations:', error);
    }
}

function updateDesignationsTable() {
    const tbody = document.getElementById('designationsTable');
    const searchTerm = document.getElementById('designationSearch')?.value?.toLowerCase() || '';
    const deptFilter = document.getElementById('designationDepartment')?.value || '';

    let filtered = designations.filter(d =>
        d.designation_name?.toLowerCase().includes(searchTerm) ||
        d.designation_code?.toLowerCase().includes(searchTerm)
    );

    if (deptFilter) {
        filtered = filtered.filter(d => d.department_id === deptFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M20 7h-9"></path>
                            <path d="M14 17H5"></path>
                            <circle cx="17" cy="17" r="3"></circle>
                            <circle cx="7" cy="7" r="3"></circle>
                        </svg>
                        <p>No designations configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(desig => `
        <tr>
            <td><strong>${desig.designation_name}</strong></td>
            <td><code>${desig.designation_code}</code></td>
            <td>${desig.department_name || 'All'}</td>
            <td>Level ${desig.level || 1}</td>
            <td>${desig.employee_count || 0}</td>
            <td><span class="status-badge status-${desig.is_active ? 'active' : 'inactive'}">${desig.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editDesignation('${desig.id}')" data-tooltip="Edit Designation">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadShifts() {
    try {
        const response = await api.request('/hrms/shifts');
        shifts = Array.isArray(response) ? response : (response?.data || []);
        updateShiftsTable();
    } catch (error) {
        console.error('Error loading shifts:', error);
    }
}

function updateShiftsTable() {
    const tbody = document.getElementById('shiftsTable');
    const searchTerm = document.getElementById('shiftSearch')?.value?.toLowerCase() || '';
    const officeFilter = document.getElementById('shiftOffice')?.value || '';

    let filtered = shifts.filter(s =>
        s.shift_name?.toLowerCase().includes(searchTerm) ||
        s.shift_code?.toLowerCase().includes(searchTerm)
    );

    if (officeFilter) {
        filtered = filtered.filter(s => s.office_id === officeFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <p>No shifts configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(shift => `
        <tr>
            <td><strong>${shift.shift_name}</strong></td>
            <td><code>${shift.shift_code}</code></td>
            <td>${shift.office_name || '-'}</td>
            <td>${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}</td>
            <td>${shift.working_hours || calculateWorkingHours(shift.start_time, shift.end_time)} hrs</td>
            <td><span class="status-badge status-${shift.is_active ? 'active' : 'inactive'}">${shift.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editShift('${shift.id}')" data-tooltip="Edit Shift">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadHolidays() {
    try {
        const year = document.getElementById('holidayYear')?.value || new Date().getFullYear();
        const response = await api.request(`/hrms/holidays?year=${year}`);
        holidays = Array.isArray(response) ? response : (response?.data || []);
        updateHolidaysTable();
    } catch (error) {
        console.error('Error loading holidays:', error);
    }
}

function updateHolidaysTable() {
    const tbody = document.getElementById('holidaysTable');
    const officeFilter = document.getElementById('holidayOffice')?.value || '';
    const typeFilter = document.getElementById('holidayType')?.value || '';

    let filtered = holidays;

    if (typeFilter) {
        filtered = filtered.filter(h => h.holiday_type === typeFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="6">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <p>No holidays configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(holiday => `
        <tr>
            <td><strong>${holiday.holiday_name}</strong></td>
            <td>${formatDate(holiday.holiday_date)}</td>
            <td>${getDayName(holiday.holiday_date)}</td>
            <td><span class="badge badge-${holiday.holiday_type}">${formatHolidayType(holiday.holiday_type)}</span></td>
            <td>${holiday.office_names?.join(', ') || 'All Offices'}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editHoliday('${holiday.id}')" data-tooltip="Edit Holiday">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteHoliday('${holiday.id}')" data-tooltip="Delete Holiday">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadEmployees() {
    try {
        const response = await api.request('/hrms/employees');
        employees = Array.isArray(response) ? response : (response?.data || []);

        const select = document.getElementById('deptHead');
        if (select) {
            select.innerHTML = '<option value="">Select Employee</option>';
            employees.forEach(emp => {
                select.innerHTML += `<option value="${emp.id}">${emp.first_name} ${emp.last_name}</option>`;
            });
        }
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

// Modal functions
function showCreateOfficeModal() {
    document.getElementById('officeForm').reset();
    document.getElementById('officeId').value = '';
    document.getElementById('officeModalTitle').textContent = 'Create Office';
    document.getElementById('officeModal').classList.add('active');
}

function editOffice(id) {
    const office = offices.find(o => o.id === id);
    if (!office) return;

    // Use office_type directly from backend
    const officeType = office.office_type || 'branch';

    document.getElementById('officeId').value = office.id;
    document.getElementById('officeName').value = office.office_name;
    document.getElementById('officeCode').value = office.office_code;
    document.getElementById('officeType').value = officeType;
    document.getElementById('officeTimezone').value = office.timezone || 'Asia/Kolkata';
    document.getElementById('officeAddress').value = office.address_line1 || '';
    document.getElementById('officeCity').value = office.city || '';
    document.getElementById('officeState').value = office.state || '';
    document.getElementById('officeCountry').value = office.country || 'India';
    document.getElementById('officePostalCode').value = office.postal_code || '';
    document.getElementById('officePhone').value = office.phone || '';
    document.getElementById('officeEmail').value = office.email || '';
    document.getElementById('officeLatitude').value = office.latitude || '';
    document.getElementById('officeLongitude').value = office.longitude || '';
    document.getElementById('officeGeofenceRadius').value = office.geofence_radius_meters || 100;
    document.getElementById('officeIsActive').value = office.is_active ? 'true' : 'false';

    document.getElementById('officeModalTitle').textContent = 'Edit Office';
    document.getElementById('officeModal').classList.add('active');
}

function showCreateDepartmentModal() {
    document.getElementById('departmentForm').reset();
    document.getElementById('departmentId').value = '';
    document.getElementById('departmentModalTitle').textContent = 'Create Department';
    document.getElementById('departmentModal').classList.add('active');
}

function editDepartment(id) {
    const dept = departments.find(d => d.id === id);
    if (!dept) return;

    document.getElementById('departmentId').value = dept.id;
    document.getElementById('departmentName').value = dept.department_name;
    document.getElementById('departmentCode').value = dept.department_code;
    document.getElementById('deptOffice').value = dept.office_id || '';
    document.getElementById('deptHead').value = dept.head_employee_id || '';
    document.getElementById('departmentDescription').value = dept.description || '';
    document.getElementById('departmentIsActive').value = dept.is_active ? 'true' : 'false';

    document.getElementById('departmentModalTitle').textContent = 'Edit Department';
    document.getElementById('departmentModal').classList.add('active');
}

function showCreateDesignationModal() {
    document.getElementById('designationForm').reset();
    document.getElementById('designationId').value = '';
    document.getElementById('designationModalTitle').textContent = 'Create Designation';
    document.getElementById('designationModal').classList.add('active');
}

function editDesignation(id) {
    const desig = designations.find(d => d.id === id);
    if (!desig) return;

    document.getElementById('designationId').value = desig.id;
    document.getElementById('designationName').value = desig.designation_name;
    document.getElementById('designationCode').value = desig.designation_code;
    document.getElementById('desigDepartment').value = desig.department_id || '';
    document.getElementById('desigLevel').value = desig.level || 1;
    document.getElementById('designationDescription').value = desig.description || '';
    document.getElementById('designationIsActive').value = desig.is_active ? 'true' : 'false';

    document.getElementById('designationModalTitle').textContent = 'Edit Designation';
    document.getElementById('designationModal').classList.add('active');
}

function showCreateShiftModal() {
    document.getElementById('shiftForm').reset();
    document.getElementById('shiftId').value = '';
    document.getElementById('shiftModalTitle').textContent = 'Create Shift';
    document.getElementById('shiftModal').classList.add('active');

    // Initialize time pickers and set default values
    initTimePickers();
    setTimePickerValue('shiftStart', '09:00');
    setTimePickerValue('shiftEnd', '18:00');
    setTimePickerValue('breakStart', '13:00');
    setTimePickerValue('breakEnd', '14:00');
}

function editShift(id) {
    const shift = shifts.find(s => s.id === id);
    if (!shift) return;

    document.getElementById('shiftId').value = shift.id;
    document.getElementById('shiftName').value = shift.shift_name;
    document.getElementById('shiftCode').value = shift.shift_code;
    document.getElementById('shiftOfficeId').value = shift.office_id || '';
    document.getElementById('graceMinutes').value = shift.grace_period_minutes || 15;
    document.getElementById('halfDayHours').value = shift.half_day_hours || 4;
    document.getElementById('shiftIsActive').value = shift.is_active ? 'true' : 'false';

    // Set working days checkboxes
    const workingDays = shift.working_days || [];
    document.querySelectorAll('input[name="workingDays"]').forEach(cb => {
        cb.checked = workingDays.includes(cb.value);
    });

    document.getElementById('shiftModalTitle').textContent = 'Edit Shift';
    document.getElementById('shiftModal').classList.add('active');

    // Initialize time pickers and set values
    initTimePickers();
    setTimePickerValue('shiftStart', shift.start_time || '09:00');
    setTimePickerValue('shiftEnd', shift.end_time || '18:00');
    setTimePickerValue('breakStart', shift.break_start || '13:00');
    setTimePickerValue('breakEnd', shift.break_end || '14:00');
}

function showCreateHolidayModal() {
    document.getElementById('holidayForm').reset();
    document.getElementById('holidayId').value = '';
    document.getElementById('holidayModalTitle').textContent = 'Create Holiday';
    document.getElementById('holidayModal').classList.add('active');
}

function editHoliday(id) {
    const holiday = holidays.find(h => h.id === id);
    if (!holiday) return;

    document.getElementById('holidayId').value = holiday.id;
    document.getElementById('holidayName').value = holiday.holiday_name;
    document.getElementById('holidayDate').value = holiday.holiday_date?.split('T')[0] || '';
    document.getElementById('holidayTypeSelect').value = holiday.holiday_type;
    document.getElementById('holidayDescription').value = holiday.description || '';

    // Set selected offices
    const officeSelect = document.getElementById('holidayOffices');
    Array.from(officeSelect.options).forEach(opt => {
        opt.selected = holiday.office_ids?.includes(opt.value);
    });

    document.getElementById('holidayModalTitle').textContent = 'Edit Holiday';
    document.getElementById('holidayModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Save functions
async function saveOffice() {
    const form = document.getElementById('officeForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('officeId').value;
        const latitudeVal = document.getElementById('officeLatitude').value;
        const longitudeVal = document.getElementById('officeLongitude').value;
        const geofenceVal = document.getElementById('officeGeofenceRadius').value;

        // Get office_type directly from dropdown
        const officeTypeVal = document.getElementById('officeType').value;
        const isHeadquarters = officeTypeVal === 'head';

        const data = {
            office_name: document.getElementById('officeName').value,
            office_code: document.getElementById('officeCode').value,
            is_headquarters: isHeadquarters,
            office_type: officeTypeVal,
            timezone: document.getElementById('officeTimezone').value,
            address_line1: document.getElementById('officeAddress').value,
            city: document.getElementById('officeCity').value,
            state: document.getElementById('officeState').value || null,
            country: document.getElementById('officeCountry').value,
            postal_code: document.getElementById('officePostalCode').value || null,
            phone: document.getElementById('officePhone').value || null,
            email: document.getElementById('officeEmail').value || null,
            latitude: latitudeVal ? parseFloat(latitudeVal) : null,
            longitude: longitudeVal ? parseFloat(longitudeVal) : null,
            geofence_radius_meters: geofenceVal ? parseInt(geofenceVal) : 100,
            is_active: document.getElementById('officeIsActive').value === 'true'
        };

        console.log('Saving office with data:', data);

        let response;
        if (id) {
            data.id = id;
            response = await api.request('/hrms/offices', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            response = await api.request('/hrms/offices', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        console.log('Server response:', response);

        closeModal('officeModal');
        showToast(`Office ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadOffices();
        hideLoading();
    } catch (error) {
        console.error('Error saving office:', error);
        showToast(error.message || 'Failed to save office', 'error');
        hideLoading();
    }
}

async function saveDepartment() {
    const form = document.getElementById('departmentForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('departmentId').value;
        const data = {
            department_name: document.getElementById('departmentName').value,
            department_code: document.getElementById('departmentCode').value,
            office_id: document.getElementById('deptOffice').value || null,
            head_employee_id: document.getElementById('deptHead').value || null,
            description: document.getElementById('departmentDescription').value,
            is_active: document.getElementById('departmentIsActive').value === 'true'
        };

        if (id) {
            data.id = id;
            await api.request('/hrms/departments', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/departments', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('departmentModal');
        showToast(`Department ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadDepartments();
        hideLoading();
    } catch (error) {
        console.error('Error saving department:', error);
        showToast(error.message || 'Failed to save department', 'error');
        hideLoading();
    }
}

async function saveDesignation() {
    const form = document.getElementById('designationForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('designationId').value;
        const data = {
            designation_name: document.getElementById('designationName').value,
            designation_code: document.getElementById('designationCode').value,
            department_id: document.getElementById('desigDepartment').value || null,
            level: parseInt(document.getElementById('desigLevel').value) || 1,
            description: document.getElementById('designationDescription').value,
            is_active: document.getElementById('designationIsActive').value === 'true'
        };

        if (id) {
            data.id = id;
            await api.request('/hrms/designations', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/designations', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('designationModal');
        showToast(`Designation ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadDesignations();
        hideLoading();
    } catch (error) {
        console.error('Error saving designation:', error);
        showToast(error.message || 'Failed to save designation', 'error');
        hideLoading();
    }
}

async function saveShift() {
    const form = document.getElementById('shiftForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('shiftId').value;

        // Calculate break duration from break start/end times
        const breakStart = convertTo24HourFormat(document.getElementById('breakStart').value);
        const breakEnd = convertTo24HourFormat(document.getElementById('breakEnd').value);
        let breakDurationMinutes = 60; // default
        if (breakStart && breakEnd) {
            const [startH, startM] = breakStart.split(':').map(Number);
            const [endH, endM] = breakEnd.split(':').map(Number);
            breakDurationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
            if (breakDurationMinutes < 0) breakDurationMinutes = 60; // fallback if invalid
        }

        const data = {
            shift_name: document.getElementById('shiftName').value,
            shift_code: document.getElementById('shiftCode').value,
            office_id: document.getElementById('shiftOfficeId').value || null,
            start_time: convertTo24HourFormat(document.getElementById('shiftStart').value),
            end_time: convertTo24HourFormat(document.getElementById('shiftEnd').value),
            break_duration_minutes: breakDurationMinutes,
            grace_period_minutes: parseInt(document.getElementById('graceMinutes').value) || 15,
            half_day_hours: parseFloat(document.getElementById('halfDayHours').value) || 4
        };

        if (id) {
            data.id = id;
            await api.request('/hrms/shifts', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/shifts', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('shiftModal');
        showToast(`Shift ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadShifts();
        hideLoading();
    } catch (error) {
        console.error('Error saving shift:', error);
        showToast(error.message || 'Failed to save shift', 'error');
        hideLoading();
    }
}

async function saveHoliday() {
    const form = document.getElementById('holidayForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('holidayId').value;

        const officeIds = Array.from(document.getElementById('holidayOffices').selectedOptions)
            .map(opt => opt.value);

        const data = {
            holiday_name: document.getElementById('holidayName').value,
            holiday_date: document.getElementById('holidayDate').value,
            holiday_type: document.getElementById('holidayTypeSelect').value,
            description: document.getElementById('holidayDescription').value,
            office_ids: officeIds.length > 0 ? officeIds : null
        };

        if (id) {
            data.id = id;
            await api.request('/hrms/holidays', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/holidays', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('holidayModal');
        showToast(`Holiday ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadHolidays();
        hideLoading();
    } catch (error) {
        console.error('Error saving holiday:', error);
        showToast(error.message || 'Failed to save holiday', 'error');
        hideLoading();
    }
}

async function deleteHoliday(id) {
    if (!confirm('Are you sure you want to delete this holiday?')) return;

    try {
        showLoading();
        await api.request(`/hrms/holidays/${id}`, { method: 'DELETE' });
        showToast('Holiday deleted successfully', 'success');
        await loadHolidays();
        hideLoading();
    } catch (error) {
        console.error('Error deleting holiday:', error);
        showToast(error.message || 'Failed to delete holiday', 'error');
        hideLoading();
    }
}

// Utility functions
function formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function getDayName(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', { weekday: 'long' });
}

function formatTime(timeString) {
    if (!timeString) return '-';
    const [hours, minutes] = timeString.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
}

function calculateWorkingHours(start, end) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

function formatOfficeType(type) {
    const types = {
        'head': 'Head Office',
        'branch': 'Branch',
        'regional': 'Regional',
        'satellite': 'Satellite'
    };
    return types[type] || type || 'Branch';
}

function formatHolidayType(type) {
    const types = {
        'public': 'Public/National',
        'regional': 'Regional',
        'restricted': 'Restricted/Optional',
        'company': 'Company'
    };
    return types[type] || type;
}

function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 5000);
}

// Event listeners - will be attached after DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('officeSearch')?.addEventListener('input', updateOfficesTable);
    document.getElementById('departmentSearch')?.addEventListener('input', updateDepartmentsTable);
    document.getElementById('departmentOffice')?.addEventListener('change', updateDepartmentsTable);
    document.getElementById('designationSearch')?.addEventListener('input', updateDesignationsTable);
    document.getElementById('designationDepartment')?.addEventListener('change', updateDesignationsTable);
    document.getElementById('shiftSearch')?.addEventListener('input', updateShiftsTable);
    document.getElementById('shiftOffice')?.addEventListener('change', updateShiftsTable);
    document.getElementById('holidayYear')?.addEventListener('change', loadHolidays);
    document.getElementById('holidayOffice')?.addEventListener('change', updateHolidaysTable);
    document.getElementById('holidayType')?.addEventListener('change', updateHolidaysTable);
});

// ============================================
// Time Picker Initialization (Flatpickr)
// ============================================

function initTimePickers() {
    if (typeof flatpickr === 'undefined') {
        console.warn('Flatpickr not loaded');
        return;
    }

    const timePickerConfig = {
        enableTime: true,
        noCalendar: true,
        dateFormat: "h:i K",
        time_24hr: false,
        minuteIncrement: 15,
        defaultHour: 9,
        defaultMinute: 0
    };

    document.querySelectorAll('.time-picker').forEach(input => {
        if (!input._flatpickr) {
            flatpickr(input, timePickerConfig);
        }
    });
}

function setTimePickerValue(inputId, timeValue) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input._flatpickr && timeValue) {
        // Convert 24h time (HH:MM or HH:MM:SS) to 12h format for flatpickr
        const parts = timeValue.split(':');
        const hours = parts[0];
        const minutes = parts[1];
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        input._flatpickr.setDate(`${hour12}:${minutes} ${ampm}`, true);
    } else if (timeValue) {
        input.value = timeValue;
    }
}
