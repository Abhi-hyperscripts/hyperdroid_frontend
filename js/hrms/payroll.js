let currentUser = null;
let isAdmin = false;
let employees = [];
let offices = [];
let components = [];
let structures = [];
let currentPayslipId = null;

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

        // Show/hide admin elements
        if (isAdmin) {
            document.getElementById('adminActions').style.display = 'flex';
            document.getElementById('payrollRunsTab').style.display = 'block';
            document.getElementById('salaryTab').style.display = 'block';
            document.getElementById('componentsTab').style.display = 'block';
            document.getElementById('createStructureBtn').style.display = 'inline-flex';
            document.getElementById('createComponentBtn').style.display = 'inline-flex';
            document.getElementById('loanEmployeeRow').style.display = 'block';
        } else {
            document.getElementById('loanEmployeeRow').style.display = 'none';
        }

        // Setup tabs
        setupTabs();

        // Load initial data
        await Promise.all([
            loadMyPayslips(),
            loadOffices()
        ]);

        if (isAdmin) {
            await Promise.all([
                loadPayrollRuns(),
                loadComponents(),
                loadSalaryStructures(),
                loadEmployees()
            ]);
        }

        await loadLoans();

        // Set default dates for payroll run
        setDefaultPayrollDates();

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

            // Update active states
            tabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        });
    });
}

function setDefaultPayrollDates() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    document.getElementById('payrollMonth').value = currentMonth;
    document.getElementById('payrollYear').value = currentYear;

    // Set period start to 1st of month
    const periodStart = new Date(currentYear, currentMonth - 1, 1);
    document.getElementById('periodStart').value = periodStart.toISOString().split('T')[0];

    // Set period end to last day of month
    const periodEnd = new Date(currentYear, currentMonth, 0);
    document.getElementById('periodEnd').value = periodEnd.toISOString().split('T')[0];

    // Set pay date to 1st of next month
    const payDate = new Date(currentYear, currentMonth, 1);
    document.getElementById('payDate').value = payDate.toISOString().split('T')[0];
}

async function loadMyPayslips() {
    try {
        const year = document.getElementById('payslipYear').value;
        const response = await api.request(`/hrms/payslips/my?year=${year}`);
        const payslips = response || [];

        // Update stats
        if (payslips.length > 0) {
            const lastPayslip = payslips[0];
            document.getElementById('lastGross').textContent = formatCurrency(lastPayslip.grossSalary);
            document.getElementById('lastDeductions').textContent = formatCurrency(lastPayslip.totalDeductions);
            document.getElementById('lastNet').textContent = formatCurrency(lastPayslip.netSalary);

            const ytd = payslips.reduce((sum, p) => sum + (p.netSalary || 0), 0);
            document.getElementById('ytdEarnings').textContent = formatCurrency(ytd);
        }

        updateMyPayslipsTable(payslips);
    } catch (error) {
        console.error('Error loading payslips:', error);
    }
}

function updateMyPayslipsTable(payslips) {
    const tbody = document.getElementById('myPayslipsTable');

    if (!payslips || payslips.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                            <line x1="1" y1="10" x2="23" y2="10"></line>
                        </svg>
                        <p>No payslips found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = payslips.map(slip => `
        <tr>
            <td><strong>${getMonthName(slip.month)} ${slip.year}</strong></td>
            <td>${formatDate(slip.periodStart)} - ${formatDate(slip.periodEnd)}</td>
            <td>${formatCurrency(slip.grossSalary)}</td>
            <td>${formatCurrency(slip.totalDeductions)}</td>
            <td><strong>${formatCurrency(slip.netSalary)}</strong></td>
            <td><span class="status-badge status-${slip.status?.toLowerCase()}">${slip.status}</span></td>
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
    `).join('');
}

async function loadPayrollRuns() {
    try {
        const year = document.getElementById('runYear').value;
        const month = document.getElementById('runMonth').value;
        const officeId = document.getElementById('runOffice').value;

        let url = `/hrms/payroll-runs?year=${year}`;
        if (month) url += `&month=${month}`;
        if (officeId) url += `&officeId=${officeId}`;

        const response = await api.request(url);
        updatePayrollRunsTable(response || []);
    } catch (error) {
        console.error('Error loading payroll runs:', error);
    }
}

function updatePayrollRunsTable(runs) {
    const tbody = document.getElementById('payrollRunsTable');

    if (!runs || runs.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <p>No payroll runs found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = runs.map(run => `
        <tr>
            <td><code>${run.runNumber || run.id.substring(0, 8)}</code></td>
            <td>${getMonthName(run.month)} ${run.year}</td>
            <td>${run.officeName || 'All'}</td>
            <td>${run.employeeCount}</td>
            <td>${formatCurrency(run.totalGross)}</td>
            <td>${formatCurrency(run.totalNet)}</td>
            <td><span class="status-badge status-${run.status?.toLowerCase()}">${run.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewPayrollRun('${run.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    ${run.status === 'Draft' ? `
                    <button class="action-btn success" onclick="processPayrollRun('${run.id}')" title="Process">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadSalaryStructures() {
    try {
        const response = await api.request('/hrms/salary-structures');
        structures = response || [];
        updateSalaryStructuresTable();
    } catch (error) {
        console.error('Error loading salary structures:', error);
    }
}

function updateSalaryStructuresTable() {
    const tbody = document.getElementById('salaryStructuresTable');
    const searchTerm = document.getElementById('structureSearch')?.value?.toLowerCase() || '';

    const filtered = structures.filter(s =>
        s.name.toLowerCase().includes(searchTerm) ||
        s.code?.toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="6">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        </svg>
                        <p>No salary structures defined</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(s => `
        <tr>
            <td><strong>${s.name}</strong></td>
            <td>${formatCurrency(s.minBasic || 0)} - ${formatCurrency(s.maxBasic || 0)}</td>
            <td>${s.componentCount || 0}</td>
            <td>${s.employeeCount || 0}</td>
            <td><span class="status-badge status-${s.isActive ? 'active' : 'inactive'}">${s.isActive ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editSalaryStructure('${s.id}')" title="Edit">
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

async function loadComponents() {
    try {
        const response = await api.request('/hrms/salary-components');
        components = response || [];
        updateComponentsTables();
    } catch (error) {
        console.error('Error loading components:', error);
    }
}

function updateComponentsTables() {
    const searchTerm = document.getElementById('componentSearch')?.value?.toLowerCase() || '';
    const typeFilter = document.getElementById('componentType')?.value || '';

    const filtered = components.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm) ||
                             c.code?.toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || c.category === typeFilter;
        return matchesSearch && matchesType;
    });

    const earnings = filtered.filter(c => c.category === 'earning');
    const deductions = filtered.filter(c => c.category === 'deduction');

    updateEarningsTable(earnings);
    updateDeductionsTable(deductions);
}

function updateEarningsTable(earnings) {
    const tbody = document.getElementById('earningsTable');

    if (!earnings || earnings.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="6"><p>No earnings components</p></td></tr>';
        return;
    }

    tbody.innerHTML = earnings.map(c => `
        <tr>
            <td><strong>${c.name}</strong></td>
            <td><code>${c.code}</code></td>
            <td>${c.calculationType}</td>
            <td>${c.isTaxable ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${c.isActive ? 'active' : 'inactive'}">${c.isActive ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editComponent('${c.id}')" title="Edit">
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

function updateDeductionsTable(deductions) {
    const tbody = document.getElementById('deductionsTable');

    if (!deductions || deductions.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="6"><p>No deduction components</p></td></tr>';
        return;
    }

    tbody.innerHTML = deductions.map(c => `
        <tr>
            <td><strong>${c.name}</strong></td>
            <td><code>${c.code}</code></td>
            <td>${c.calculationType}</td>
            <td>${c.isPreTax ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${c.isActive ? 'active' : 'inactive'}">${c.isActive ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editComponent('${c.id}')" title="Edit">
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

async function loadLoans() {
    try {
        const status = document.getElementById('loanStatus')?.value || '';
        let url = isAdmin ? '/hrms/loans' : '/hrms/loans/my';
        if (status) url += `?status=${status}`;

        const response = await api.request(url);
        updateLoansTable(response || []);
    } catch (error) {
        console.error('Error loading loans:', error);
    }
}

function updateLoansTable(loans) {
    const tbody = document.getElementById('loansTable');

    if (!loans || loans.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <line x1="12" y1="1" x2="12" y2="23"></line>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        <p>No loans found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = loans.map(loan => `
        <tr>
            <td class="employee-cell">
                <div class="employee-info">
                    <div class="avatar">${getInitials(loan.employeeName)}</div>
                    <div class="details">
                        <span class="name">${loan.employeeName}</span>
                    </div>
                </div>
            </td>
            <td>${formatLoanType(loan.loanType)}</td>
            <td>${formatCurrency(loan.principalAmount)}</td>
            <td>${formatCurrency(loan.emiAmount)}</td>
            <td>${formatCurrency(loan.remainingBalance)}</td>
            <td>${formatDate(loan.startDate)}</td>
            <td><span class="status-badge status-${loan.status?.toLowerCase()}">${loan.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewLoan('${loan.id}')" title="View">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadOffices() {
    try {
        const response = await api.request('/hrms/offices');
        offices = response || [];

        const selects = ['payrollOffice', 'runOffice'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                const firstOption = id === 'runOffice' ? '<option value="">All Offices</option>' : '<option value="">Select Office</option>';
                select.innerHTML = firstOption;
                offices.forEach(office => {
                    select.innerHTML += `<option value="${office.id}">${office.name}</option>`;
                });
            }
        });
    } catch (error) {
        console.error('Error loading offices:', error);
    }
}

async function loadEmployees() {
    try {
        const response = await api.request('/hrms/employees');
        employees = response || [];

        const select = document.getElementById('loanEmployee');
        if (select) {
            select.innerHTML = '<option value="">Select Employee</option>';
            employees.forEach(emp => {
                select.innerHTML += `<option value="${emp.id}">${emp.firstName} ${emp.lastName}</option>`;
            });
        }
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

// Modal functions
function showRunPayrollModal() {
    document.getElementById('runPayrollForm').reset();
    setDefaultPayrollDates();
    document.getElementById('runPayrollModal').classList.add('active');
}

function showSalaryStructureModal() {
    // Navigate to structures tab first
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="salary-structures"]').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('salary-structures').classList.add('active');
}

function showCreateStructureModal() {
    document.getElementById('structureForm').reset();
    document.getElementById('structureId').value = '';
    document.getElementById('structureModalTitle').textContent = 'Create Salary Structure';
    document.getElementById('structureComponents').innerHTML = '';
    document.getElementById('structureModal').classList.add('active');
}

function showCreateComponentModal() {
    document.getElementById('componentForm').reset();
    document.getElementById('componentId').value = '';
    document.getElementById('componentModalTitle').textContent = 'Create Salary Component';
    document.getElementById('componentModal').classList.add('active');
}

function showCreateLoanModal() {
    document.getElementById('loanForm').reset();
    document.getElementById('loanId').value = '';
    document.getElementById('loanModalTitle').textContent = 'Apply for Loan';
    document.getElementById('loanModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Submit functions
async function runPayroll() {
    const form = document.getElementById('runPayrollForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const data = {
            month: parseInt(document.getElementById('payrollMonth').value),
            year: parseInt(document.getElementById('payrollYear').value),
            officeId: document.getElementById('payrollOffice').value,
            periodStart: document.getElementById('periodStart').value,
            periodEnd: document.getElementById('periodEnd').value,
            payDate: document.getElementById('payDate').value
        };

        await api.request('/hrms/payroll-runs', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        closeModal('runPayrollModal');
        showToast('Payroll run created successfully', 'success');
        await loadPayrollRuns();
        hideLoading();
    } catch (error) {
        console.error('Error running payroll:', error);
        showToast(error.message || 'Failed to run payroll', 'error');
        hideLoading();
    }
}

async function saveComponent() {
    const form = document.getElementById('componentForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('componentId').value;
        const data = {
            name: document.getElementById('componentName').value,
            code: document.getElementById('componentCode').value,
            category: document.getElementById('componentCategory').value,
            calculationType: document.getElementById('calculationType').value,
            isTaxable: document.getElementById('isTaxable').value === 'true',
            isStatutory: document.getElementById('isStatutory').value === 'true',
            description: document.getElementById('componentDescription').value
        };

        if (id) {
            data.id = id;
            await api.request(`/hrms/salary-components/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/salary-components', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('componentModal');
        showToast(`Component ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadComponents();
        hideLoading();
    } catch (error) {
        console.error('Error saving component:', error);
        showToast(error.message || 'Failed to save component', 'error');
        hideLoading();
    }
}

async function saveLoan() {
    const form = document.getElementById('loanForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const data = {
            loanType: document.getElementById('loanType').value,
            principalAmount: parseFloat(document.getElementById('loanAmount').value),
            interestRate: parseFloat(document.getElementById('interestRate').value) || 0,
            emiAmount: parseFloat(document.getElementById('emiAmount').value),
            startDate: document.getElementById('loanStartDate').value,
            numberOfInstallments: parseInt(document.getElementById('numberOfInstallments').value),
            reason: document.getElementById('loanReason').value
        };

        if (isAdmin) {
            data.employeeId = document.getElementById('loanEmployee').value;
        }

        await api.request('/hrms/loans', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        closeModal('loanModal');
        showToast('Loan application submitted successfully', 'success');
        await loadLoans();
        hideLoading();
    } catch (error) {
        console.error('Error saving loan:', error);
        showToast(error.message || 'Failed to submit loan application', 'error');
        hideLoading();
    }
}

async function viewPayslip(payslipId) {
    try {
        showLoading();
        currentPayslipId = payslipId;
        const payslip = await api.request(`/hrms/payslips/${payslipId}`);

        document.getElementById('payslipContent').innerHTML = `
            <div class="payslip-header">
                <h3>${payslip.companyName || 'Company Name'}</h3>
                <p>Payslip for ${getMonthName(payslip.month)} ${payslip.year}</p>
            </div>
            <div class="payslip-employee">
                <div class="info-row">
                    <span class="label">Employee Name:</span>
                    <span class="value">${payslip.employeeName}</span>
                </div>
                <div class="info-row">
                    <span class="label">Employee ID:</span>
                    <span class="value">${payslip.employeeCode || 'N/A'}</span>
                </div>
                <div class="info-row">
                    <span class="label">Department:</span>
                    <span class="value">${payslip.departmentName || 'N/A'}</span>
                </div>
                <div class="info-row">
                    <span class="label">Pay Period:</span>
                    <span class="value">${formatDate(payslip.periodStart)} - ${formatDate(payslip.periodEnd)}</span>
                </div>
            </div>
            <div class="payslip-details">
                <div class="earnings-section">
                    <h4>Earnings</h4>
                    <table>
                        ${(payslip.earnings || []).map(e => `
                            <tr>
                                <td>${e.componentName}</td>
                                <td class="amount">${formatCurrency(e.amount)}</td>
                            </tr>
                        `).join('')}
                        <tr class="total">
                            <td>Gross Salary</td>
                            <td class="amount">${formatCurrency(payslip.grossSalary)}</td>
                        </tr>
                    </table>
                </div>
                <div class="deductions-section">
                    <h4>Deductions</h4>
                    <table>
                        ${(payslip.deductions || []).map(d => `
                            <tr>
                                <td>${d.componentName}</td>
                                <td class="amount">${formatCurrency(d.amount)}</td>
                            </tr>
                        `).join('')}
                        <tr class="total">
                            <td>Total Deductions</td>
                            <td class="amount">${formatCurrency(payslip.totalDeductions)}</td>
                        </tr>
                    </table>
                </div>
            </div>
            <div class="payslip-net">
                <span>Net Pay:</span>
                <span class="net-amount">${formatCurrency(payslip.netSalary)}</span>
            </div>
        `;

        document.getElementById('payslipModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading payslip:', error);
        showToast('Failed to load payslip', 'error');
        hideLoading();
    }
}

async function downloadPayslip() {
    if (currentPayslipId) {
        await downloadPayslipById(currentPayslipId);
    }
}

async function downloadPayslipById(payslipId) {
    try {
        showToast('Downloading payslip...', 'info');
        // In a real implementation, this would call an API to generate PDF
        window.open(`/hrms/payslips/${payslipId}/download`, '_blank');
    } catch (error) {
        console.error('Error downloading payslip:', error);
        showToast('Failed to download payslip', 'error');
    }
}

function editComponent(componentId) {
    const component = components.find(c => c.id === componentId);
    if (!component) return;

    document.getElementById('componentId').value = component.id;
    document.getElementById('componentName').value = component.name;
    document.getElementById('componentCode').value = component.code;
    document.getElementById('componentCategory').value = component.category;
    document.getElementById('calculationType').value = component.calculationType;
    document.getElementById('isTaxable').value = component.isTaxable ? 'true' : 'false';
    document.getElementById('isStatutory').value = component.isStatutory ? 'true' : 'false';
    document.getElementById('componentDescription').value = component.description || '';

    document.getElementById('componentModalTitle').textContent = 'Edit Salary Component';
    document.getElementById('componentModal').classList.add('active');
}

// Utility functions
function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[(month - 1) % 12] || '';
}

function formatLoanType(type) {
    const types = {
        'salary_advance': 'Salary Advance',
        'personal_loan': 'Personal Loan',
        'emergency_loan': 'Emergency Loan'
    };
    return types[type] || type;
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
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

// Event listeners
document.getElementById('payslipYear')?.addEventListener('change', loadMyPayslips);
document.getElementById('runYear')?.addEventListener('change', loadPayrollRuns);
document.getElementById('runMonth')?.addEventListener('change', loadPayrollRuns);
document.getElementById('runOffice')?.addEventListener('change', loadPayrollRuns);
document.getElementById('structureSearch')?.addEventListener('input', updateSalaryStructuresTable);
document.getElementById('componentSearch')?.addEventListener('input', updateComponentsTables);
document.getElementById('componentType')?.addEventListener('change', updateComponentsTables);
document.getElementById('loanStatus')?.addEventListener('change', loadLoans);
