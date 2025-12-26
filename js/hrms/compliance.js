/**
 * HRMS Statutory Compliance JavaScript
 * Handles company info, ECR, ESI, and Form 16 generation
 */

let currentUser = null;
let offices = [];
let departments = [];
let employees = [];
let companyInfo = null;

// ==================== Page Initialization ====================

document.addEventListener('DOMContentLoaded', async function() {
    await loadNavigation();
    setupSidebar();
    setupTabs();
    setupSubTabs();
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

        // Check page access - only HR admins can access compliance
        if (!hrmsRoles.isHRAdmin()) {
            showToast('You do not have access to Statutory Compliance', 'error');
            window.location.href = 'dashboard.html';
            return;
        }

        // Populate year dropdowns
        populateYearDropdowns();

        // Populate FY dropdowns
        populateFYDropdowns();

        // Load initial data
        await Promise.all([
            loadCompanyInfo(),
            loadOffices(),
            loadDepartments(),
            loadEmployees()
        ]);

        // Setup form handlers
        setupFormHandlers();

        hideLoading();
    } catch (error) {
        console.error('Error initializing page:', error);
        showToast('Failed to load page data', 'error');
        hideLoading();
    }
}

// ==================== Data Loading ====================

async function loadCompanyInfo() {
    try {
        const response = await api.request('/hrms/statutory-compliance/company-info');
        if (response && response.id) {
            companyInfo = response;
            populateCompanyInfoForm(response);
        }
    } catch (error) {
        // Company info may not exist yet, that's OK
        console.log('Company info not found, will be created on save');
    }
}

async function loadOffices() {
    try {
        const response = await api.request('/hrms/offices');
        offices = response || [];
        populateOfficeDropdowns();
    } catch (error) {
        console.error('Error loading offices:', error);
    }
}

async function loadDepartments() {
    try {
        const response = await api.request('/hrms/departments');
        departments = response || [];
        populateDepartmentDropdowns();
    } catch (error) {
        console.error('Error loading departments:', error);
    }
}

async function loadEmployees() {
    try {
        const response = await api.request('/hrms/employees');
        employees = response || [];
        populateEmployeeDropdown();
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

// ==================== Dropdown Population ====================

function populateYearDropdowns() {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= currentYear - 5; y--) {
        years.push(y);
    }

    const yearSelects = ['ecrYear', 'esiYear'];
    yearSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            years.forEach(year => {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                select.appendChild(option);
            });
        }
    });
}

function populateFYDropdowns() {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    // Financial year starts in April
    const startFY = currentMonth >= 3 ? currentYear : currentYear - 1;
    const fyOptions = [];

    for (let y = startFY; y >= startFY - 5; y--) {
        fyOptions.push(`${y}-${(y + 1).toString().slice(-2)}`);
    }

    const fySelects = ['form16FY', 'bulkForm16FY'];
    fySelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            fyOptions.forEach(fy => {
                const option = document.createElement('option');
                option.value = fy;
                option.textContent = `FY ${fy}`;
                select.appendChild(option);
            });
        }
    });
}

function populateOfficeDropdowns() {
    const officeSelects = ['ecrOffice', 'esiOffice', 'bulkForm16Office'];
    officeSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            // Clear existing options except first
            while (select.options.length > 1) {
                select.remove(1);
            }
            offices.forEach(office => {
                const option = document.createElement('option');
                option.value = office.id;
                option.textContent = office.office_name;
                select.appendChild(option);
            });
        }
    });
}

function populateDepartmentDropdowns() {
    const deptSelects = ['bulkForm16Dept'];
    deptSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            while (select.options.length > 1) {
                select.remove(1);
            }
            departments.forEach(dept => {
                const option = document.createElement('option');
                option.value = dept.id;
                option.textContent = dept.department_name;
                select.appendChild(option);
            });
        }
    });
}

function populateEmployeeDropdown() {
    const select = document.getElementById('form16Employee');
    if (select) {
        while (select.options.length > 1) {
            select.remove(1);
        }
        employees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.first_name} ${emp.last_name || ''} (${emp.employee_code})`;
            select.appendChild(option);
        });
    }
}

function populateCompanyInfoForm(info) {
    document.getElementById('companyName').value = info.company_name || '';
    document.getElementById('companyPan').value = info.pan_number || '';
    document.getElementById('companyTan').value = info.tan_number || '';
    document.getElementById('companyGstin').value = info.gstin || '';
    document.getElementById('pfEstablishmentId').value = info.pf_establishment_id || '';
    document.getElementById('pfDbAccount').value = info.pf_db_account || '';
    document.getElementById('esiEmployerCode').value = info.esi_employer_code || '';
    document.getElementById('esiBranchCode').value = info.esi_branch_code || '';
    document.getElementById('ptRegistrationNumber').value = info.pt_registration_number || '';
    document.getElementById('bankName').value = info.bank_name || '';
    document.getElementById('bankAccountNumber').value = info.bank_account_number || '';
    document.getElementById('bankIfscCode').value = info.bank_ifsc_code || '';
    document.getElementById('signatoryName').value = info.authorized_signatory_name || '';
    document.getElementById('signatoryDesignation').value = info.authorized_signatory_designation || '';
    document.getElementById('signatoryPan').value = info.authorized_signatory_pan || '';
    document.getElementById('registeredAddress').value = info.registered_address || '';
}

// ==================== Tab & Sidebar Setup ====================

function setupSidebar() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('organizationSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarToggle.classList.toggle('active');
            if (overlay) overlay.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarToggle.classList.remove('active');
            overlay.classList.remove('active');
        });
    }

    // Nav group toggles
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.nav-group');
            group.classList.toggle('collapsed');
        });
    });
}

function setupTabs() {
    const tabButtons = document.querySelectorAll('.sidebar-btn[data-tab]');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            switchTab(tabId, btn);
        });
    });
}

function switchTab(tabId, btn) {
    // Update sidebar buttons
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    const targetContent = document.getElementById(tabId);
    if (targetContent) {
        targetContent.classList.add('active');
    }

    // Update active tab title
    const activeTabName = document.getElementById('activeTabName');
    if (activeTabName) {
        activeTabName.textContent = btn.querySelector('.nav-label').textContent;
    }

    // Close mobile sidebar
    const sidebar = document.getElementById('organizationSidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarToggle) sidebarToggle.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function setupSubTabs() {
    const subTabButtons = document.querySelectorAll('.sub-tab-btn[data-subtab]');
    subTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const subtabId = btn.getAttribute('data-subtab');

            // Update buttons
            document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content
            document.querySelectorAll('.sub-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            const targetContent = document.getElementById(subtabId);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

// ==================== Form Handlers ====================

function setupFormHandlers() {
    // Company Info Form
    const companyInfoForm = document.getElementById('companyInfoForm');
    if (companyInfoForm) {
        companyInfoForm.addEventListener('submit', handleCompanyInfoSubmit);
    }

    // ECR Buttons
    document.getElementById('previewEcrBtn')?.addEventListener('click', previewEcr);
    document.getElementById('downloadEcrBtn')?.addEventListener('click', downloadEcr);

    // ESI Buttons
    document.getElementById('previewEsiBtn')?.addEventListener('click', previewEsi);
    document.getElementById('downloadEsiBtn')?.addEventListener('click', downloadEsi);

    // Form 16 Buttons
    document.getElementById('previewForm16Btn')?.addEventListener('click', previewForm16);
    document.getElementById('generateForm16Btn')?.addEventListener('click', generateForm16);
    document.getElementById('bulkGenerateForm16Btn')?.addEventListener('click', bulkGenerateForm16);
    document.getElementById('printForm16Btn')?.addEventListener('click', printForm16);
}

async function handleCompanyInfoSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('saveCompanyInfoBtn');
    const btnText = btn.querySelector('.btn-text');
    const btnSpinner = btn.querySelector('.btn-spinner');

    try {
        btn.disabled = true;
        btnText.textContent = 'Saving...';
        btnSpinner.style.display = 'inline-block';

        const data = {
            company_name: document.getElementById('companyName').value,
            pan_number: document.getElementById('companyPan').value,
            tan_number: document.getElementById('companyTan').value,
            gstin: document.getElementById('companyGstin').value,
            pf_establishment_id: document.getElementById('pfEstablishmentId').value,
            pf_db_account: document.getElementById('pfDbAccount').value,
            esi_employer_code: document.getElementById('esiEmployerCode').value,
            esi_branch_code: document.getElementById('esiBranchCode').value,
            pt_registration_number: document.getElementById('ptRegistrationNumber').value,
            bank_name: document.getElementById('bankName').value,
            bank_account_number: document.getElementById('bankAccountNumber').value,
            bank_ifsc_code: document.getElementById('bankIfscCode').value,
            authorized_signatory_name: document.getElementById('signatoryName').value,
            authorized_signatory_designation: document.getElementById('signatoryDesignation').value,
            authorized_signatory_pan: document.getElementById('signatoryPan').value,
            registered_address: document.getElementById('registeredAddress').value
        };

        await api.request('/hrms/statutory-compliance/company-info', {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        showToast('Company information saved successfully', 'success');
    } catch (error) {
        console.error('Error saving company info:', error);
        showToast('Failed to save company information', 'error');
    } finally {
        btn.disabled = false;
        btnText.textContent = 'Save Company Information';
        btnSpinner.style.display = 'none';
    }
}

// ==================== ECR Functions ====================

async function previewEcr() {
    const month = document.getElementById('ecrMonth').value;
    const year = document.getElementById('ecrYear').value;
    const officeId = document.getElementById('ecrOffice').value;

    if (!month || !year) {
        showToast('Please select month and year', 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            period_month: parseInt(month),
            period_year: parseInt(year)
        };
        if (officeId) data.office_id = officeId;

        const response = await api.request('/hrms/statutory-compliance/generate/ecr', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        displayEcrPreview(response);
        hideLoading();
    } catch (error) {
        console.error('Error generating ECR preview:', error);
        showToast('Failed to generate ECR preview', 'error');
        hideLoading();
    }
}

function displayEcrPreview(ecr) {
    const previewSection = document.getElementById('ecrPreview');
    const previewBody = document.getElementById('ecrPreviewBody');
    const memberCount = document.getElementById('ecrMemberCount');
    const totalAmount = document.getElementById('ecrTotalAmount');

    if (!ecr || !ecr.records || ecr.records.length === 0) {
        showToast('No PF data found for the selected period', 'info');
        previewSection.style.display = 'none';
        return;
    }

    // Update summary
    memberCount.textContent = `${ecr.member_count} members`;
    const total = ecr.total_epf_ee + ecr.total_eps_er + ecr.total_epf_er_diff;
    totalAmount.textContent = `₹${total.toLocaleString('en-IN')}`;

    // Populate table
    previewBody.innerHTML = '';
    ecr.records.forEach(record => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${record.uan || 'N/A'}</td>
            <td>${record.employee_name}</td>
            <td class="amount">₹${(record.gross_wages || 0).toLocaleString('en-IN')}</td>
            <td class="amount">₹${(record.epf_wages || 0).toLocaleString('en-IN')}</td>
            <td class="amount">₹${(record.epf_ee || 0).toLocaleString('en-IN')}</td>
            <td class="amount">₹${(record.eps_er || 0).toLocaleString('en-IN')}</td>
            <td class="amount">₹${(record.epf_er_diff || 0).toLocaleString('en-IN')}</td>
            <td>${record.ncp_days || 0}</td>
        `;
        previewBody.appendChild(row);
    });

    previewSection.style.display = 'block';
}

async function downloadEcr() {
    const month = document.getElementById('ecrMonth').value;
    const year = document.getElementById('ecrYear').value;
    const officeId = document.getElementById('ecrOffice').value;

    if (!month || !year) {
        showToast('Please select month and year', 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            period_month: parseInt(month),
            period_year: parseInt(year)
        };
        if (officeId) data.office_id = officeId;

        const response = await api.request('/hrms/statutory-compliance/generate/ecr/download', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        // Create and download the file
        const blob = new Blob([response.file_content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.file_name || `ECR_${year}_${month}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showToast('ECR file downloaded successfully', 'success');
        hideLoading();
    } catch (error) {
        console.error('Error downloading ECR:', error);
        showToast('Failed to download ECR file', 'error');
        hideLoading();
    }
}

// ==================== ESI Functions ====================

async function previewEsi() {
    const month = document.getElementById('esiMonth').value;
    const year = document.getElementById('esiYear').value;
    const officeId = document.getElementById('esiOffice').value;

    if (!month || !year) {
        showToast('Please select month and year', 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            period_month: parseInt(month),
            period_year: parseInt(year)
        };
        if (officeId) data.office_id = officeId;

        const response = await api.request('/hrms/statutory-compliance/generate/esi-challan', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        displayEsiPreview(response);
        hideLoading();
    } catch (error) {
        console.error('Error generating ESI preview:', error);
        showToast('Failed to generate ESI preview', 'error');
        hideLoading();
    }
}

function displayEsiPreview(esi) {
    const previewSection = document.getElementById('esiPreview');
    const previewBody = document.getElementById('esiPreviewBody');
    const ipCount = document.getElementById('esiIpCount');
    const totalAmount = document.getElementById('esiTotalAmount');

    if (!esi || !esi.records || esi.records.length === 0) {
        showToast('No ESI data found for the selected period', 'info');
        previewSection.style.display = 'none';
        return;
    }

    // Update summary
    ipCount.textContent = `${esi.ip_count} insured persons`;
    totalAmount.textContent = `₹${esi.total_contribution.toLocaleString('en-IN')}`;

    // Populate table
    previewBody.innerHTML = '';
    esi.records.forEach(record => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${record.ip_number || 'N/A'}</td>
            <td>${record.employee_name}</td>
            <td class="amount">₹${(record.gross_wages || 0).toLocaleString('en-IN')}</td>
            <td>${record.days_worked || 0}</td>
            <td class="amount">₹${(record.ip_contribution || 0).toLocaleString('en-IN')}</td>
            <td class="amount">₹${(record.employer_contribution || 0).toLocaleString('en-IN')}</td>
            <td class="amount">₹${(record.total_contribution || 0).toLocaleString('en-IN')}</td>
        `;
        previewBody.appendChild(row);
    });

    previewSection.style.display = 'block';
}

async function downloadEsi() {
    const month = document.getElementById('esiMonth').value;
    const year = document.getElementById('esiYear').value;
    const officeId = document.getElementById('esiOffice').value;

    if (!month || !year) {
        showToast('Please select month and year', 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            period_month: parseInt(month),
            period_year: parseInt(year)
        };
        if (officeId) data.office_id = officeId;

        const response = await api.request('/hrms/statutory-compliance/generate/esi-challan/download', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        // Create and download the file
        const blob = new Blob([response.file_content], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.file_name || `ESI_Challan_${year}_${month}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showToast('ESI Challan downloaded successfully', 'success');
        hideLoading();
    } catch (error) {
        console.error('Error downloading ESI:', error);
        showToast('Failed to download ESI Challan', 'error');
        hideLoading();
    }
}

// ==================== Form 16 Functions ====================

async function previewForm16() {
    const employeeId = document.getElementById('form16Employee').value;
    const fy = document.getElementById('form16FY').value;

    if (!employeeId || !fy) {
        showToast('Please select employee and financial year', 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            employee_id: employeeId,
            financial_year: fy
        };

        const response = await api.request('/hrms/statutory-compliance/generate/form16', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        displayForm16Preview(response);
        hideLoading();
    } catch (error) {
        console.error('Error generating Form 16:', error);
        showToast('Failed to generate Form 16 preview', 'error');
        hideLoading();
    }
}

function displayForm16Preview(form16) {
    const previewSection = document.getElementById('form16Preview');
    const content = document.getElementById('form16Content');

    if (!form16) {
        showToast('No Form 16 data found', 'info');
        previewSection.style.display = 'none';
        return;
    }

    // Build Form 16 HTML
    content.innerHTML = `
        <div class="form16-header">
            <h3>FORM NO. 16</h3>
            <p>Certificate under section 203 of the Income Tax Act, 1961 for tax deducted at source on salary</p>
            <span class="certificate-number">Certificate No: ${form16.certificate_number || 'N/A'}</span>
        </div>

        <div class="form16-section">
            <h4 class="form16-section-title">Part A - Employer & Employee Details</h4>
            <div class="form16-info-grid">
                <div class="form16-info-row">
                    <span class="label">Employer Name:</span>
                    <span class="value">${form16.employer_name || 'N/A'}</span>
                </div>
                <div class="form16-info-row">
                    <span class="label">Employer TAN:</span>
                    <span class="value">${form16.employer_tan || 'N/A'}</span>
                </div>
                <div class="form16-info-row">
                    <span class="label">Employer PAN:</span>
                    <span class="value">${form16.employer_pan || 'N/A'}</span>
                </div>
                <div class="form16-info-row">
                    <span class="label">Assessment Year:</span>
                    <span class="value">${form16.assessment_year || 'N/A'}</span>
                </div>
                <div class="form16-info-row">
                    <span class="label">Employee Name:</span>
                    <span class="value">${form16.employee_name || 'N/A'}</span>
                </div>
                <div class="form16-info-row">
                    <span class="label">Employee PAN:</span>
                    <span class="value">${form16.employee_pan || 'N/A'}</span>
                </div>
            </div>
        </div>

        <div class="form16-section">
            <h4 class="form16-section-title">Quarterly TDS Details</h4>
            <table class="form16-table">
                <thead>
                    <tr>
                        <th>Quarter</th>
                        <th>Period</th>
                        <th>Total Paid</th>
                        <th>TDS Deducted</th>
                        <th>TDS Deposited</th>
                    </tr>
                </thead>
                <tbody>
                    ${(form16.quarterly_tds || []).map(q => `
                        <tr>
                            <td>Q${q.quarter}</td>
                            <td>${q.period_from} to ${q.period_to}</td>
                            <td class="amount">₹${(q.total_paid || 0).toLocaleString('en-IN')}</td>
                            <td class="amount">₹${(q.tds_deducted || 0).toLocaleString('en-IN')}</td>
                            <td class="amount">₹${(q.tds_deposited || 0).toLocaleString('en-IN')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="form16-section">
            <h4 class="form16-section-title">Part B - Tax Computation</h4>
            <table class="form16-table">
                <tbody>
                    <tr>
                        <td>Gross Salary (17(1))</td>
                        <td class="amount">₹${(form16.gross_salary || 0).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr>
                        <td>Less: Standard Deduction u/s 16(ia)</td>
                        <td class="amount">₹${(form16.standard_deduction || 0).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr>
                        <td>Less: Professional Tax u/s 16(iii)</td>
                        <td class="amount">₹${(form16.professional_tax || 0).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr class="total">
                        <td>Taxable Income</td>
                        <td class="amount">₹${(form16.taxable_income || 0).toLocaleString('en-IN')}</td>
                    </tr>
                </tbody>
            </table>

            <table class="form16-table" style="margin-top: var(--space-4);">
                <tbody>
                    <tr>
                        <td>Tax on Total Income</td>
                        <td class="amount">₹${(form16.tax_on_income || 0).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr>
                        <td>Add: Health & Education Cess (4%)</td>
                        <td class="amount">₹${(form16.education_cess || 0).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr class="total">
                        <td>Total Tax Payable</td>
                        <td class="amount">₹${(form16.total_tax_payable || 0).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr>
                        <td>Less: TDS Deducted</td>
                        <td class="amount">₹${(form16.total_tds_deducted || 0).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr class="total">
                        <td>Tax Refund / (Tax Payable)</td>
                        <td class="amount">₹${(form16.tax_refund || 0).toLocaleString('en-IN')}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="form16-summary">
            <div class="form16-summary-item">
                <div class="label">Gross Salary</div>
                <div class="value">₹${(form16.gross_salary || 0).toLocaleString('en-IN')}</div>
            </div>
            <div class="form16-summary-item">
                <div class="label">Total TDS</div>
                <div class="value">₹${(form16.total_tds_deducted || 0).toLocaleString('en-IN')}</div>
            </div>
        </div>
    `;

    previewSection.style.display = 'block';
}

async function generateForm16() {
    // Same as preview but could trigger PDF download in future
    await previewForm16();
    showToast('Form 16 generated. Use Print button to save as PDF.', 'info');
}

async function bulkGenerateForm16() {
    const fy = document.getElementById('bulkForm16FY').value;
    const officeId = document.getElementById('bulkForm16Office').value;
    const deptId = document.getElementById('bulkForm16Dept').value;

    if (!fy) {
        showToast('Please select financial year', 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            financial_year: fy
        };
        if (officeId) data.office_id = officeId;
        if (deptId) data.department_id = deptId;

        const response = await api.request('/hrms/statutory-compliance/generate/form16/bulk', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        displayBulkProgress(response);
        hideLoading();
    } catch (error) {
        console.error('Error bulk generating Form 16:', error);
        showToast('Failed to bulk generate Form 16', 'error');
        hideLoading();
    }
}

function displayBulkProgress(results) {
    const progressSection = document.getElementById('bulkProgress');
    const progressCount = document.getElementById('progressCount');
    const progressFill = document.getElementById('progressFill');
    const resultsList = document.getElementById('bulkResultsList');

    if (!results || !results.results) {
        showToast('No employees found for Form 16 generation', 'info');
        return;
    }

    const total = results.results.length;
    const success = results.results.filter(r => r.success).length;

    progressCount.textContent = `${success} / ${total} generated`;
    progressFill.style.width = `${(success / total) * 100}%`;

    resultsList.innerHTML = '';
    results.results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'bulk-result-item';
        item.innerHTML = `
            <span class="employee-name">${result.employee_name}</span>
            <span class="result-status ${result.success ? 'success' : 'error'}">
                ${result.success ?
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Generated' :
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Failed'
                }
            </span>
        `;
        resultsList.appendChild(item);
    });

    progressSection.style.display = 'block';
    showToast(`Form 16 generated for ${success} of ${total} employees`, success === total ? 'success' : 'warning');
}

function printForm16() {
    const content = document.getElementById('form16Content');
    if (!content || !content.innerHTML) {
        showToast('No Form 16 to print. Generate a preview first.', 'warning');
        return;
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Form 16</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                .form16-header { text-align: center; margin-bottom: 30px; }
                .form16-header h3 { margin: 0 0 10px; }
                .form16-section { margin-bottom: 25px; }
                .form16-section-title { background: #f3f4f6; padding: 8px 12px; margin-bottom: 15px; border-left: 3px solid #3b82f6; }
                .form16-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                .form16-info-row { display: flex; gap: 8px; }
                .form16-info-row .label { font-weight: 600; min-width: 140px; }
                .form16-table { width: 100%; border-collapse: collapse; }
                .form16-table th, .form16-table td { padding: 10px; border: 1px solid #ddd; text-align: left; }
                .form16-table th { background: #f3f4f6; }
                .form16-table .amount { text-align: right; font-family: monospace; }
                .form16-table .total { background: #f3f4f6; font-weight: 600; }
                .form16-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background: #1f2937; color: white; padding: 20px; margin-top: 30px; }
                .form16-summary-item { text-align: center; }
                .form16-summary-item .label { font-size: 12px; text-transform: uppercase; opacity: 0.8; }
                .form16-summary-item .value { font-size: 24px; font-weight: bold; font-family: monospace; }
                .certificate-number { display: inline-block; margin-top: 10px; padding: 4px 12px; background: #f3f4f6; font-family: monospace; font-size: 12px; }
            </style>
        </head>
        <body>
            ${content.innerHTML}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

// ==================== Utility Functions ====================

function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else {
        // Fallback
        const container = document.getElementById('toast-container');
        if (container) {
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }
}
