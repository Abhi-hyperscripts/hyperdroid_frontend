// Reports Page JavaScript
let currentUser = null;
let currentReportType = null;
let reportData = [];
let offices = [];
let departments = [];

// SearchableDropdown instances
let officeDropdown = null;
let departmentDropdown = null;

// Pagination instance
let reportPagination = null;

// Cache for pagination - store columns and data for pagination rendering
let cachedReportColumns = [];

const reportConfig = {
    'employee-headcount': {
        title: 'Employee Headcount Report',
        endpoint: '/hrms/reports/headcount',
        columns: ['Department', 'Count', 'Percentage'],
        dataExtractor: (response) => response.by_department || []
    },
    'employee-demographics': {
        title: 'Demographics Report',
        endpoint: '/hrms/reports/demographics',
        columns: ['Department', 'Count', 'Percentage'],
        dataExtractor: null
    },
    'employee-turnover': {
        title: 'Turnover Analysis',
        endpoint: '/hrms/reports/turnover',
        columns: ['Department', 'Exit Count', 'Attrition Rate'],
        dataExtractor: null
    },
    'employee-directory': {
        title: 'Employee Directory',
        endpoint: '/hrms/reports/directory',
        columns: ['Employee Code', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Office'],
        dataExtractor: null
    },
    'daily-attendance': {
        title: 'Daily Attendance Report',
        endpoint: '/hrms/reports/daily-attendance',
        columns: ['Date', 'Total Employees', 'Present', 'Absent', 'On Leave', 'Attendance Rate'],
        dataExtractor: null
    },
    'monthly-attendance': {
        title: 'Monthly Attendance Summary',
        endpoint: '/hrms/reports/monthly-attendance',
        columns: ['Department', 'Employee Count', 'Present Days', 'Absent Days', 'Late Arrivals', 'Attendance Rate'],
        dataExtractor: null
    },
    'late-arrivals': {
        title: 'Late Arrivals Report',
        endpoint: '/hrms/reports/late-arrivals',
        columns: ['Department', 'Late Arrivals'],
        dataExtractor: (response) => response.by_department || []
    },
    'overtime-report': {
        title: 'Overtime Report',
        endpoint: '/hrms/reports/overtime',
        columns: ['Department', 'Average Working Hours'],
        dataExtractor: (response) => response.by_department || []
    },
    'absenteeism': {
        title: 'Absenteeism Analysis',
        endpoint: '/hrms/reports/absenteeism',
        columns: ['Department', 'Absent Days'],
        dataExtractor: (response) => response.by_department || []
    },
    'leave-balance': {
        title: 'Leave Balance Report',
        endpoint: '/hrms/reports/leave-balance',
        columns: ['Employee', 'Leave Type', 'Credited', 'Used', 'Balance'],
        dataExtractor: null
    },
    'leave-utilization': {
        title: 'Leave Utilization Report',
        endpoint: '/hrms/reports/leave-utilization',
        columns: ['Leave Type', 'Allocated', 'Used', 'Balance', 'Utilization Rate'],
        dataExtractor: null
    },
    'leave-trend': {
        title: 'Leave Trend Analysis',
        endpoint: '/hrms/reports/leave-trend',
        columns: ['Month', 'Requests', 'Total Days', 'Approved', 'Rejected', 'Average Days'],
        dataExtractor: null
    },
    'pending-approvals': {
        title: 'Pending Approvals Report',
        endpoint: '/hrms/reports/pending-approvals',
        columns: ['Employee', 'Leave Type', 'Start Date', 'End Date', 'Days', 'Reason', 'Status'],
        dataExtractor: null
    },
    'salary-summary': {
        title: 'Salary Summary Report',
        endpoint: '/hrms/reports/salary-summary',
        columns: ['Department', 'Employee Count', 'Total Gross', 'Total Net', 'Percentage'],
        dataExtractor: null
    },
    'payroll-register': {
        title: 'Payroll Register',
        endpoint: '/hrms/reports/payroll-register',
        columns: ['Employee Code', 'Employee Name', 'Department', 'Basic', 'Gross', 'Deductions', 'Net Pay'],
        dataExtractor: null
    },
    'deductions-report': {
        title: 'Deductions Report',
        endpoint: '/hrms/reports/deductions',
        // Country-agnostic columns using charge_type from globalSchemaV3:
        // retirement, social_insurance, regional_tax, income_tax
        columns: ['Employee Code', 'Employee Name', 'Retirement', 'Social Insurance', 'Regional Tax', 'Income Tax', 'Other', 'Total'],
        dataExtractor: null
    },
    'tax-report': {
        title: 'Tax Computation Report',
        endpoint: '/hrms/reports/tax',
        // Country-agnostic: "Income Tax" instead of hardcoded "TDS"
        columns: ['Month', 'Month Name', 'Total Income Tax', 'Employee Count'],
        dataExtractor: null
    },
    'loan-report': {
        title: 'Loans & Advances Report',
        endpoint: '/hrms/reports/loans',
        columns: ['Employee Name', 'Loan Type', 'Principal', 'EMI', 'Outstanding', 'Status'],
        dataExtractor: null
    },
    'bank-advice': {
        title: 'Bank Advice Report',
        endpoint: '/hrms/reports/bank-advice',
        columns: ['Employee Code', 'Employee Name', 'Bank Name', 'Account Number', 'IFSC Code', 'Net Pay'],
        dataExtractor: null
    }
};

document.addEventListener('DOMContentLoaded', async function() {
    await loadNavigation();
    setupSidebar();
    setupReportButtons();
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

        // Initialize RBAC
        hrmsRoles.init();

        // Check page access - only HR users, managers, and admins can access reports
        if (!hrmsRoles.canAccessReports()) {
            showToast('You do not have access to the Reports page', 'error');
            window.location.href = 'dashboard.html';
            return;
        }

        // CRITICAL: Require organization setup before accessing Reports page
        // This prevents users from bypassing setup by directly navigating to URL
        const setupComplete = await hrmsRoles.requireOrganizationSetup({
            showToast: true,
            redirectUrl: 'organization.html',
            requireBasicOnly: true  // Reports can work with basic setup
        });
        if (!setupComplete) return;

        // Apply RBAC visibility
        applyReportsRBAC();

        // Set default dates
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        document.getElementById('fromDate').value = firstDay.toISOString().split('T')[0];
        document.getElementById('toDate').value = today.toISOString().split('T')[0];

        await Promise.all([
            loadOffices(),
            loadDepartments()
        ]);

        hideLoading();
    } catch (error) {
        console.error('Error initializing page:', error);
        showToast('Failed to load page data', 'error');
        hideLoading();
    }
}

// Apply RBAC visibility rules for reports page
function applyReportsRBAC() {
    // Export buttons - only HR Admin can export
    const exportBtns = document.querySelectorAll('.export-btn, [onclick*="exportReport"]');
    exportBtns.forEach(btn => {
        if (!hrmsRoles.isHRAdmin()) {
            btn.style.display = 'none';
        }
    });

    // Payroll reports - only visible to HR Admin and Super Admin
    const payrollNavGroup = document.getElementById('payrollNavGroup');
    if (payrollNavGroup) {
        if (hrmsRoles.isHRAdmin()) {
            payrollNavGroup.style.display = 'block';
        } else {
            payrollNavGroup.style.display = 'none';
        }
    }
}

// Setup report button click handlers
function setupReportButtons() {
    const reportBtns = document.querySelectorAll('.sidebar-btn[data-report]');
    reportBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const reportType = this.dataset.report;
            selectReport(reportType);

            // Update active button state
            document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Select first report by default
    if (reportBtns.length > 0) {
        const firstBtn = reportBtns[0];
        const reportType = firstBtn.dataset.report;
        currentReportType = reportType;
        updateActiveTabTitle(reportType);
    }
}

// Select a report and update the UI
function selectReport(reportType) {
    currentReportType = reportType;
    const config = reportConfig[reportType];

    if (!config) {
        showToast('Report type not configured', 'error');
        return;
    }

    // Update active tab title
    updateActiveTabTitle(reportType);

    // Clear previous results and show placeholder
    document.getElementById('reportTable').innerHTML = '<p class="placeholder-text">Configure filters and click "Generate Report" to view data</p>';
    document.getElementById('recordCount').textContent = '0 records';
}

// Update the active tab title based on report type
function updateActiveTabTitle(reportType) {
    const config = reportConfig[reportType];
    const titleEl = document.getElementById('activeTabName');
    if (titleEl && config) {
        titleEl.textContent = config.title;
    }
}

async function loadOffices() {
    try {
        const response = await api.request('/hrms/offices');
        offices = Array.isArray(response) ? response : (response?.data || []);

        // Use HrmsOfficeSelection to get persisted or first office
        const selectedOfficeId = HrmsOfficeSelection.initializeSelection(offices);

        // Build options using HrmsOfficeSelection (no "All Offices" for filters)
        const dropdownOptions = HrmsOfficeSelection.buildOfficeOptions(offices, { isFormDropdown: false });

        // Convert to SearchableDropdown format
        const searchableOptions = dropdownOptions.map(opt => ({
            value: opt.value,
            label: opt.label
        }));

        // Initialize or update office dropdown
        if (!officeDropdown) {
            officeDropdown = convertSelectToSearchable('officeFilter', {
                compact: true,
                placeholder: 'Select Office',
                searchPlaceholder: 'Search offices...',
                onChange: (value) => {
                    HrmsOfficeSelection.setSelectedOfficeId(value);
                    updateDepartmentsForOffice(value);
                }
            });
        }

        if (officeDropdown) {
            officeDropdown.setOptions(searchableOptions);
            officeDropdown.setValue(selectedOfficeId);
        }

        // Load departments filtered by selected office
        await loadDepartments(selectedOfficeId);
    } catch (error) {
        console.error('Error loading offices:', error);
    }
}

async function loadDepartments(selectedOfficeId = null) {
    try {
        const response = await api.request('/hrms/departments');
        departments = Array.isArray(response) ? response : (response?.data || []);

        // Initialize department dropdown if not yet created
        if (!departmentDropdown) {
            departmentDropdown = convertSelectToSearchable('departmentFilter', {
                compact: true,
                placeholder: 'All Departments',
                searchPlaceholder: 'Search departments...',
                onChange: (value) => {
                    // Department filter change - no cascade needed
                }
            });
        }

        // Update departments based on selected office
        const officeIdToUse = selectedOfficeId || (officeDropdown ? officeDropdown.getValue() : null);
        updateDepartmentsForOffice(officeIdToUse);
    } catch (error) {
        console.error('Error loading departments:', error);
    }
}

/**
 * Update department dropdown based on selected office
 */
function updateDepartmentsForOffice(officeId) {
    if (!departmentDropdown) return;

    // Filter departments by selected office
    const filteredDepts = officeId
        ? departments.filter(d => d.is_active !== false && d.office_id === officeId)
        : departments.filter(d => d.is_active !== false);

    // Build options with "All Departments" first
    const deptOptions = [
        { value: '', label: 'All Departments' },
        ...filteredDepts.map(d => ({
            value: d.id,
            label: d.department_name || d.name
        }))
    ];

    departmentDropdown.setOptions(deptOptions);
    departmentDropdown.setValue(''); // Default to "All Departments"
}

// Legacy functions removed - sidebar-based navigation replaces category cards

function resetFilters() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('fromDate').value = firstDay.toISOString().split('T')[0];
    document.getElementById('toDate').value = today.toISOString().split('T')[0];

    // Reset office to persisted or first office (NOT "All")
    if (officeDropdown && offices.length > 0) {
        const selectedOfficeId = HrmsOfficeSelection.initializeSelection(offices);
        officeDropdown.setValue(selectedOfficeId);
        updateDepartmentsForOffice(selectedOfficeId);
    }

    // Reset department to "All Departments" within selected office
    if (departmentDropdown) {
        departmentDropdown.setValue('');
    }
}

async function runReport() {
    if (!currentReportType) {
        showToast('Please select a report type', 'error');
        return;
    }

    const config = reportConfig[currentReportType];

    try {
        showLoading();

        const params = new URLSearchParams();
        const fromDate = document.getElementById('fromDate').value;
        const toDate = document.getElementById('toDate').value;
        const officeId = officeDropdown ? officeDropdown.getValue() : '';
        const departmentId = departmentDropdown ? departmentDropdown.getValue() : '';

        // Extract year and month from dates for reports that need them
        const fromDateObj = fromDate ? new Date(fromDate) : new Date();
        const year = fromDateObj.getFullYear();
        const month = fromDateObj.getMonth() + 1;

        // Different reports need different parameters
        const reportsNeedingYear = [
            'employee-turnover', 'leave-trend', 'tax-report',
            'salary-summary', 'payroll-register', 'deductions-report', 'bank-advice'
        ];

        const reportsNeedingDates = [
            'daily-attendance', 'monthly-attendance', 'late-arrivals',
            'overtime-report', 'absenteeism'
        ];

        const reportsNeedingYearMonth = [
            'salary-summary', 'payroll-register', 'deductions-report', 'bank-advice'
        ];

        if (reportsNeedingYear.includes(currentReportType)) {
            params.append('year', year);
        }

        if (reportsNeedingYearMonth.includes(currentReportType)) {
            params.append('month', month);
        }

        if (reportsNeedingDates.includes(currentReportType)) {
            if (fromDate) params.append('fromDate', fromDate);
            if (toDate) params.append('toDate', toDate);
        }

        if (officeId) params.append('officeId', officeId);
        if (departmentId) params.append('departmentId', departmentId);

        const url = `${config.endpoint}?${params.toString()}`;
        const response = await api.request(url);

        // Use custom data extractor if defined, otherwise handle common formats
        if (config.dataExtractor) {
            reportData = config.dataExtractor(response);
        } else if (Array.isArray(response)) {
            reportData = response;
        } else if (response?.data && Array.isArray(response.data)) {
            reportData = response.data;
        } else {
            // For summary reports, display as key-value pairs
            reportData = convertObjectToTableData(response);
        }

        renderReportTable(config.columns, reportData);
        document.getElementById('recordCount').textContent = `${reportData.length} records`;

        hideLoading();
    } catch (error) {
        console.error('Error generating report:', error);
        showToast(error.message || 'Failed to generate report', 'error');
        hideLoading();
    }
}

function convertObjectToTableData(obj) {
    // Convert a summary object to displayable table data
    if (!obj || typeof obj !== 'object') return [];

    const result = [];
    for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
            // If value is an array, use it directly
            result.push(...value);
        } else if (typeof value !== 'object') {
            // For primitive values, create a row
            result.push({
                field: formatFieldName(key),
                value: value
            });
        }
    }
    return result;
}

function formatFieldName(key) {
    // Convert snake_case or camelCase to Title Case
    return key
        .replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

// Column name to data key mapping for reports
const columnKeyMap = {
    'department': 'department_name',
    'office': 'office_name',
    'designation': 'designation_name',
    'employee': 'employee_name',
    'leave type': 'leave_type_name',
    'employee code': 'employee_code',
    'name': 'employee_name',
    'email': 'work_email',
    'phone': 'work_phone',
    'late arrivals': 'late_arrivals',
    'average working hours': 'avg_working_hours',
    'absent days': 'absent_days',
    'present': 'present_count',
    'absent': 'absent_count',
    'on leave': 'on_leave_count',
    'attendance rate': 'attendance_rate',
    'total employees': 'total_employees',
    'employee count': 'employee_count',
    'present days': 'present_days',
    'utilization rate': 'utilization_rate',
    'total gross': 'total_gross',
    'total net': 'total_net',
    // Leave balance report mappings
    'credited': 'total_days',
    'balance': 'available_days',
    'used': 'used_days',
    // Leave utilization report mappings
    'allocated': 'total_days',
    // Leave trend report mappings
    'requests': 'request_count',
    'total days': 'total_days',
    'approved': 'approved_count',
    'rejected': 'rejected_count',
    'average days': 'average_days',
    // Pending approvals report mappings
    'days': 'number_of_days',
    'start date': 'start_date',
    'end date': 'end_date',
    'reason': 'reason',
    'status': 'status',
    // Loan report mappings
    'employee name': 'employee_name',
    'loan type': 'loan_type',
    'principal': 'principal_amount',
    'emi': 'emi_amount',
    'outstanding': 'outstanding_balance'
};

function renderReportTable(columns, data) {
    const container = document.getElementById('reportTable');

    if (!data || data.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No data found for the selected filters</p>';
        // Clear pagination
        const paginationContainer = document.getElementById('reportPagination');
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    // Determine columns based on data if default columns don't match
    let tableColumns = columns;
    if (data.length > 0 && Object.keys(data[0]).length > 0) {
        const dataKeys = Object.keys(data[0]);
        // Check if data keys match expected columns pattern (including our custom mapping)
        const hasMatch = dataKeys.some(key => columns.some(col => {
            const colLower = col.toLowerCase().replace(/\s+/g, '');
            const colUnder = col.toLowerCase().replace(/\s+/g, '_');
            const mappedKey = columnKeyMap[col.toLowerCase()];
            return colLower === key.toLowerCase() ||
                   colUnder === key.toLowerCase() ||
                   mappedKey === key.toLowerCase() ||
                   key.toLowerCase().includes(colLower);
        }));

        if (!hasMatch) {
            // Use data keys as columns (but filter out IDs)
            tableColumns = dataKeys
                .filter(key => !key.endsWith('_id') || key === 'employee_id')
                .map(key => formatFieldName(key));
        }
    }

    // Cache columns for pagination rendering
    cachedReportColumns = tableColumns;

    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        reportPagination = createTablePagination('reportPagination', {
            containerSelector: '#reportPagination',
            data: data,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderReportTableRows(cachedReportColumns, paginatedData);
            }
        });
    } else {
        renderReportTableRows(tableColumns, data);
    }
}

function renderReportTableRows(tableColumns, data) {
    const container = document.getElementById('reportTable');
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No data found for the selected filters</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'data-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    tableColumns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    data.forEach(row => {
        const tr = document.createElement('tr');
        const rowKeys = Object.keys(row);

        tableColumns.forEach((col, index) => {
            const td = document.createElement('td');

            // First check our custom column mapping
            const mappedKey = columnKeyMap[col.toLowerCase()];

            // Try to find matching key with multiple strategies
            const key = rowKeys.find(k => {
                const kLower = k.toLowerCase();
                const colLower = col.toLowerCase().replace(/\s+/g, '');
                const colUnder = col.toLowerCase().replace(/\s+/g, '_');

                // Direct match with mapped key
                if (mappedKey && kLower === mappedKey.toLowerCase()) return true;

                // Exact match
                if (kLower === colLower) return true;
                if (kLower === colUnder) return true;

                // Format field name match
                if (formatFieldName(k).toLowerCase() === col.toLowerCase()) return true;

                // Partial match (e.g., "department" matches "department_name")
                if (kLower.includes(colLower) && !kLower.endsWith('_id')) return true;

                return false;
            }) || rowKeys[index];

            let value = key ? (row[key] ?? '-') : '-';

            // Format currency values
            if (typeof value === 'number' && (col.includes('Salary') || col.includes('Amount') || col.includes('Gross') || col.includes('Net') || col.includes('Deduction') || col.includes('CTC') || col.includes('Basic') || col.includes('Pay') || col.includes('Principal') || col.includes('EMI') || col.includes('Outstanding'))) {
                value = formatCurrency(value);
            }

            // Format percentages
            if (typeof value === 'number' && (col.includes('%') || col.toLowerCase().includes('percentage') || col.toLowerCase().includes('rate'))) {
                value = value.toFixed(1) + '%';
            }

            // Format dates
            if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
                value = new Date(value).toLocaleDateString('en-IN');
            }

            td.textContent = value;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.innerHTML = '';
    container.appendChild(table);
}

async function exportReport(format) {
    if (!reportData || reportData.length === 0) {
        showToast('No data to export. Generate report first.', 'error');
        return;
    }

    try {
        showLoading();
        const config = reportConfig[currentReportType];
        const columns = Object.keys(reportData[0]).map(k => formatFieldName(k));

        if (format === 'csv') {
            exportToCSV(columns, reportData, config.title);
        } else if (format === 'pdf') {
            exportToPDF(columns, reportData, config.title);
        }

        hideLoading();
    } catch (error) {
        console.error('Error exporting report:', error);
        showToast('Failed to export report', 'error');
        hideLoading();
    }
}

function exportToPDF(columns, data, title) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape for better table fit

    // Add title
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(title, 14, 15);

    // Add date and filters info
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;

    // Get office and department names from SearchableDropdown
    const officeValue = officeDropdown ? officeDropdown.getValue() : '';
    const deptValue = departmentDropdown ? departmentDropdown.getValue() : '';
    const selectedOffice = offices.find(o => o.id === officeValue);
    const selectedDept = departments.find(d => d.id === deptValue);
    const officeName = selectedOffice ? selectedOffice.office_name : 'All Offices';
    const deptName = selectedDept ? (selectedDept.department_name || selectedDept.name) : 'All Departments';

    let filterText = `Period: ${fromDate || 'All'} to ${toDate || 'All'}`;
    if (officeName !== 'All Offices') filterText += ` | Office: ${officeName}`;
    if (deptName !== 'All Departments') filterText += ` | Department: ${deptName}`;
    doc.text(filterText, 14, 22);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

    // Prepare table data
    const dataKeys = Object.keys(data[0]);
    const tableData = data.map(row => {
        return dataKeys.map(key => {
            let value = row[key] ?? '-';
            // Format currency values
            if (typeof value === 'number' && (key.toLowerCase().includes('amount') ||
                key.toLowerCase().includes('salary') || key.toLowerCase().includes('gross') ||
                key.toLowerCase().includes('net') || key.toLowerCase().includes('ctc') ||
                key.toLowerCase().includes('pay') || key.toLowerCase().includes('emi'))) {
                value = formatCurrency(value);
            }
            // Format percentages
            if (typeof value === 'number' && (key.toLowerCase().includes('rate') ||
                key.toLowerCase().includes('percentage'))) {
                value = value.toFixed(1) + '%';
            }
            // Format dates
            if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
                value = new Date(value).toLocaleDateString('en-IN');
            }
            return String(value);
        });
    });

    // Generate table
    doc.autoTable({
        head: [columns],
        body: tableData,
        startY: 35,
        styles: {
            fontSize: 8,
            cellPadding: 2
        },
        headStyles: {
            fillColor: [0, 0, 0],
            textColor: [255, 255, 255],
            fontStyle: 'bold'
        },
        alternateRowStyles: {
            fillColor: [245, 245, 245]
        },
        didDrawPage: function(data) {
            // Footer with page numbers
            const pageCount = doc.internal.getNumberOfPages();
            doc.setFontSize(8);
            doc.text(
                `Page ${data.pageNumber} of ${pageCount}`,
                doc.internal.pageSize.getWidth() / 2,
                doc.internal.pageSize.getHeight() - 10,
                { align: 'center' }
            );
            doc.text(
                'HyperDroid HRMS',
                14,
                doc.internal.pageSize.getHeight() - 10
            );
        }
    });

    // Save PDF
    const filename = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);

    showToast('PDF exported successfully', 'success');
}

function exportToCSV(columns, data, filename) {
    const rows = [columns.join(',')];
    const dataKeys = data.length > 0 ? Object.keys(data[0]) : [];

    data.forEach(row => {
        const values = dataKeys.map(key => {
            let value = row[key] ?? '';
            value = String(value).replace(/"/g, '""');
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                value = `"${value}"`;
            }
            return value;
        });
        rows.push(values.join(','));
    });

    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    showToast('Report exported successfully', 'success');
}

function printReport() {
    window.print();
}

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.add('active');
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('active');
}

// Local showToast removed - using unified toast.js instead

// ==========================================
// Sidebar Setup
// ==========================================

function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('organizationSidebar');
    const activeTabName = document.getElementById('activeTabName');
    const container = document.querySelector('.hrms-container');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    // Tab name mapping for display
    const tabNames = {
        'employee-headcount': 'Employee Headcount',
        'employee-demographics': 'Demographics',
        'employee-turnover': 'Turnover Analysis',
        'employee-directory': 'Employee Directory',
        'daily-attendance': 'Daily Attendance',
        'monthly-attendance': 'Monthly Attendance',
        'late-arrivals': 'Late Arrivals',
        'overtime-report': 'Overtime Report',
        'absenteeism': 'Absenteeism Analysis',
        'leave-balance': 'Leave Balance',
        'leave-utilization': 'Leave Utilization',
        'leave-trend': 'Leave Trends',
        'pending-approvals': 'Pending Approvals',
        'salary-summary': 'Salary Summary',
        'payroll-register': 'Payroll Register',
        'deductions-report': 'Deductions Report',
        'tax-report': 'Tax Report',
        'loan-report': 'Loans Report',
        'bank-advice': 'Bank Advice'
    };

    // Update active tab title
    function updateActiveTabTitle(tabId) {
        if (activeTabName && tabNames[tabId]) {
            activeTabName.textContent = tabNames[tabId];
        }
    }

    // Open sidebar by default on page load (desktop)
    if (window.innerWidth > 1024) {
        toggle.classList.add('active');
        sidebar.classList.add('open');
        container?.classList.add('sidebar-open');
    }

    // Toggle sidebar open/close
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
    });

    // Close sidebar when clicking overlay (mobile)
    overlay?.addEventListener('click', () => {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
    });

    // Collapsible nav groups
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.nav-group');
            if (group) {
                group.classList.toggle('collapsed');
            }
        });
    });

    // Update title when a tab is selected
    document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            updateActiveTabTitle(tabId);
        });
    });

    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
        }
    });
}

// Global function alias for HTML onclick handlers
function generateReport() {
    runReport();
}

function resetFilters() {
    // Reset date filters
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';

    // Reset dropdowns to default
    if (officeDropdown) {
        officeDropdown.setValue('');
    }
    if (departmentDropdown) {
        departmentDropdown.setValue('');
    }

    // Clear report table
    document.getElementById('reportTable').innerHTML = '<p class="placeholder-text">Select a report from the sidebar and click "Generate Report" to view data</p>';
    document.getElementById('recordCount').textContent = '0 records';

    // Clear pagination
    const paginationContainer = document.getElementById('reportPagination');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
    }
}
