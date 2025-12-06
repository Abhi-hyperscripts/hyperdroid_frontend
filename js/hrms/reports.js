// Reports Page JavaScript
let currentUser = null;
let isAdmin = false;
let currentReportType = null;
let reportData = [];
let offices = [];
let departments = [];

const reportConfig = {
    'employee-headcount': {
        title: 'Employee Headcount Report',
        endpoint: '/hrms/reports/headcount',
        columns: ['Department', 'Office', 'Active', 'Inactive', 'Total'],
        dataExtractor: (response) => response.by_department || []
    },
    'employee-demographics': {
        title: 'Demographics Report',
        endpoint: '/hrms/reports/demographics',
        columns: ['Category', 'Count', 'Percentage'],
        dataExtractor: null
    },
    'employee-turnover': {
        title: 'Turnover Analysis',
        endpoint: '/hrms/reports/turnover',
        columns: ['Month', 'New Hires', 'Exits', 'Net Change', 'Attrition Rate'],
        dataExtractor: null
    },
    'employee-directory': {
        title: 'Employee Directory',
        endpoint: '/hrms/reports/directory',
        columns: ['Name', 'Employee ID', 'Department', 'Designation', 'Email', 'Phone'],
        dataExtractor: null
    },
    'daily-attendance': {
        title: 'Daily Attendance Report',
        endpoint: '/hrms/reports/daily-attendance',
        columns: ['Employee', 'Date', 'Check In', 'Check Out', 'Hours', 'Status'],
        dataExtractor: null
    },
    'monthly-attendance': {
        title: 'Monthly Attendance Summary',
        endpoint: '/hrms/reports/monthly-attendance',
        columns: ['Employee', 'Present', 'Absent', 'Late', 'Half Day', 'Leave', 'Total Days'],
        dataExtractor: null
    },
    'late-arrivals': {
        title: 'Late Arrivals Report',
        endpoint: '/hrms/reports/late-arrivals',
        columns: ['Employee', 'Department', 'Late Count', 'Avg Late (mins)', 'Last Late Date'],
        dataExtractor: null
    },
    'overtime-report': {
        title: 'Overtime Report',
        endpoint: '/hrms/reports/overtime',
        columns: ['Employee', 'Department', 'OT Hours', 'OT Amount', 'Status'],
        dataExtractor: null
    },
    'absenteeism': {
        title: 'Absenteeism Analysis',
        endpoint: '/hrms/reports/absenteeism',
        columns: ['Employee', 'Department', 'Absent Days', 'Rate (%)', 'Pattern'],
        dataExtractor: null
    },
    'leave-balance': {
        title: 'Leave Balance Report',
        endpoint: '/hrms/reports/leave-balance',
        columns: ['Employee', 'Department', 'Annual', 'Sick', 'Casual', 'Comp Off', 'LOP Used'],
        dataExtractor: null
    },
    'leave-utilization': {
        title: 'Leave Utilization Report',
        endpoint: '/hrms/reports/leave-utilization',
        columns: ['Leave Type', 'Allocated', 'Used', 'Balance', 'Utilization %'],
        dataExtractor: null
    },
    'leave-trend': {
        title: 'Leave Trend Analysis',
        endpoint: '/hrms/reports/leave-trend',
        columns: ['Month', 'Requests', 'Approved', 'Rejected', 'Avg Days'],
        dataExtractor: null
    },
    'pending-approvals': {
        title: 'Pending Approvals Report',
        endpoint: '/hrms/reports/pending-approvals',
        columns: ['Employee', 'Leave Type', 'From', 'To', 'Days', 'Applied On', 'Pending With'],
        dataExtractor: null
    },
    'salary-summary': {
        title: 'Salary Summary Report',
        endpoint: '/hrms/reports/salary-summary',
        columns: ['Department', 'Employees', 'Gross', 'Deductions', 'Net'],
        dataExtractor: null
    },
    'payroll-register': {
        title: 'Payroll Register',
        endpoint: '/hrms/reports/payroll-register',
        columns: ['Employee', 'Basic', 'Allowances', 'Gross', 'Deductions', 'Net'],
        dataExtractor: null
    },
    'deductions-report': {
        title: 'Deductions Report',
        endpoint: '/hrms/reports/deductions',
        columns: ['Employee', 'PF', 'ESI', 'TDS', 'Loan EMI', 'Other', 'Total'],
        dataExtractor: null
    },
    'tax-report': {
        title: 'Tax Computation Report',
        endpoint: '/hrms/reports/tax',
        columns: ['Employee', 'Gross Salary', 'Exemptions', 'Taxable Income', 'Tax Payable', 'TDS Deducted'],
        dataExtractor: null
    },
    'loan-report': {
        title: 'Loans & Advances Report',
        endpoint: '/hrms/reports/loans',
        columns: ['Employee', 'Loan Type', 'Principal', 'EMI', 'Paid', 'Balance', 'Status'],
        dataExtractor: null
    },
    'bank-advice': {
        title: 'Bank Advice Report',
        endpoint: '/hrms/reports/bank-advice',
        columns: ['Employee', 'Bank', 'Account No', 'IFSC', 'Net Salary'],
        dataExtractor: null
    }
};

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

        // Set default dates
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        document.getElementById('reportDateFrom').value = firstDay.toISOString().split('T')[0];
        document.getElementById('reportDateTo').value = today.toISOString().split('T')[0];

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

async function loadOffices() {
    try {
        const response = await api.request('/hrms/offices');
        offices = Array.isArray(response) ? response : (response?.data || []);

        const select = document.getElementById('reportOffice');
        select.innerHTML = '<option value="">All Offices</option>';
        offices.forEach(office => {
            select.innerHTML += `<option value="${office.id}">${office.office_name || office.name}</option>`;
        });
    } catch (error) {
        console.error('Error loading offices:', error);
    }
}

async function loadDepartments() {
    try {
        const response = await api.request('/hrms/departments');
        departments = Array.isArray(response) ? response : (response?.data || []);

        const select = document.getElementById('reportDepartment');
        select.innerHTML = '<option value="">All Departments</option>';
        departments.forEach(dept => {
            select.innerHTML += `<option value="${dept.id}">${dept.department_name || dept.name}</option>`;
        });
    } catch (error) {
        console.error('Error loading departments:', error);
    }
}

function showReportSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.report-section').forEach(s => s.classList.remove('active'));
    document.getElementById('reportGenerator').classList.remove('active');

    // Show selected section
    document.getElementById(sectionId).classList.add('active');

    // Hide categories
    document.querySelector('.report-categories').style.display = 'none';
}

function hideReportSection() {
    document.querySelectorAll('.report-section').forEach(s => s.classList.remove('active'));
    document.querySelector('.report-categories').style.display = 'grid';
}

function generateReport(reportType) {
    currentReportType = reportType;
    const config = reportConfig[reportType];

    if (!config) {
        showToast('Report type not configured', 'error');
        return;
    }

    document.getElementById('reportTitle').textContent = config.title;

    // Hide sections and show generator
    document.querySelectorAll('.report-section').forEach(s => s.classList.remove('active'));
    document.querySelector('.report-categories').style.display = 'none';
    document.getElementById('reportGenerator').classList.add('active');

    // Clear previous results
    document.getElementById('reportTable').innerHTML = '<p class="placeholder-text">Configure filters and click "Generate Report" to view data</p>';
    document.getElementById('reportRecordCount').textContent = '0 records';
}

function hideReportGenerator() {
    document.getElementById('reportGenerator').classList.remove('active');
    document.querySelector('.report-categories').style.display = 'grid';
    currentReportType = null;
}

function resetFilters() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('reportDateFrom').value = firstDay.toISOString().split('T')[0];
    document.getElementById('reportDateTo').value = today.toISOString().split('T')[0];
    document.getElementById('reportOffice').value = '';
    document.getElementById('reportDepartment').value = '';
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
        const fromDate = document.getElementById('reportDateFrom').value;
        const toDate = document.getElementById('reportDateTo').value;
        const officeId = document.getElementById('reportOffice').value;
        const departmentId = document.getElementById('reportDepartment').value;

        if (fromDate) params.append('fromDate', fromDate);
        if (toDate) params.append('toDate', toDate);
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
        document.getElementById('reportRecordCount').textContent = `${reportData.length} records`;

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

function renderReportTable(columns, data) {
    const container = document.getElementById('reportTable');

    if (!data || data.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No data found for the selected filters</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'data-table';

    // Determine columns based on data if default columns don't match
    let tableColumns = columns;
    if (data.length > 0 && Object.keys(data[0]).length > 0) {
        const dataKeys = Object.keys(data[0]);
        // Check if data keys match expected columns pattern
        if (!dataKeys.some(key => columns.some(col =>
            col.toLowerCase().replace(/\s+/g, '') === key.toLowerCase() ||
            col.toLowerCase().replace(/\s+/g, '_') === key.toLowerCase()
        ))) {
            // Use data keys as columns
            tableColumns = dataKeys.map(key => formatFieldName(key));
        }
    }

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
            // Try to find matching key
            const key = rowKeys.find(k =>
                k.toLowerCase() === col.toLowerCase().replace(/\s+/g, '') ||
                k.toLowerCase() === col.toLowerCase().replace(/\s+/g, '_') ||
                formatFieldName(k).toLowerCase() === col.toLowerCase()
            ) || rowKeys[index];

            let value = key ? (row[key] ?? '-') : '-';

            // Format currency values
            if (typeof value === 'number' && (col.includes('Salary') || col.includes('Amount') || col.includes('Gross') || col.includes('Net') || col.includes('Deduction') || col.includes('CTC') || col.includes('Basic'))) {
                value = formatCurrency(value);
            }

            // Format percentages
            if (typeof value === 'number' && col.includes('%')) {
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

        if (format === 'csv') {
            exportToCSV(Object.keys(reportData[0]).map(k => formatFieldName(k)), reportData, config.title);
        } else if (format === 'pdf') {
            showToast('PDF export coming soon', 'info');
        }

        hideLoading();
    } catch (error) {
        console.error('Error exporting report:', error);
        showToast('Failed to export report', 'error');
        hideLoading();
    }
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
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}
