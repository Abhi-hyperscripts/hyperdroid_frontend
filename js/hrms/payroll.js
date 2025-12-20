// Security: HTML escape function to prevent XSS attacks
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let currentUser = null;
let employees = [];
let offices = [];
let components = [];
let structures = [];
let currentPayslipId = null;
let drafts = [];
let taxTypes = [];
let taxRules = [];

// Store for searchable dropdown instances
const payrollSearchableDropdowns = new Map();

// VD employee dropdown instance
let vdEmployeeDropdown = null;

/**
 * SearchableDropdown - A reusable searchable dropdown component with virtual scroll
 * Copied from organization.js for use in payroll module
 */
class PayrollSearchableDropdown {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        if (!this.container) return;

        this.options = options.options || [];
        this.placeholder = options.placeholder || 'Select an option';
        this.searchPlaceholder = options.searchPlaceholder || 'Search...';
        this.onChange = options.onChange || (() => {});
        this.virtualScroll = options.virtualScroll !== false; // Default to true
        this.itemHeight = options.itemHeight || 32;
        this.selectedValue = options.value || null;
        this.filteredOptions = [...this.options];
        this.highlightedIndex = -1;
        this.isOpen = false;
        this.id = options.id || `psd-${Date.now()}`;
        this.visibleCount = 10; // Number of visible items in virtual scroll
        this.scrollTop = 0;

        this.render();
        this.bindEvents();

        // Store reference
        payrollSearchableDropdowns.set(this.id, this);
    }

    render() {
        const selectedOption = this.options.find(o => o.value === this.selectedValue);
        const displayText = selectedOption ? selectedOption.label : '';

        this.container.innerHTML = `
            <div class="searchable-dropdown" id="${this.id}">
                <div class="searchable-dropdown-trigger" tabindex="0">
                    <span class="dropdown-selection ${!displayText ? 'placeholder' : ''}">${displayText || this.placeholder}</span>
                    <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="searchable-dropdown-menu">
                    <div class="dropdown-search-box">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/>
                            <path d="m21 21-4.35-4.35"/>
                        </svg>
                        <input type="text" class="dropdown-search-input" placeholder="${this.searchPlaceholder}" autocomplete="off">
                    </div>
                    <div class="dropdown-options">
                        ${this.renderOptions()}
                    </div>
                </div>
            </div>
        `;

        this.dropdownEl = this.container.querySelector('.searchable-dropdown');
        this.triggerEl = this.container.querySelector('.searchable-dropdown-trigger');
        this.menuEl = this.container.querySelector('.searchable-dropdown-menu');
        this.searchInput = this.container.querySelector('.dropdown-search-input');
        this.optionsEl = this.container.querySelector('.dropdown-options');
        this.selectedTextEl = this.container.querySelector('.dropdown-selection');
    }

    renderOptions() {
        if (this.filteredOptions.length === 0) {
            return '<div class="dropdown-no-match">No employees found</div>';
        }

        // Use virtual scrolling for large lists
        if (this.virtualScroll && this.filteredOptions.length > 20) {
            return this.renderVirtualOptions();
        }

        return this.filteredOptions.map((option, index) => `
            <div class="dropdown-option ${option.value === this.selectedValue ? 'selected' : ''} ${index === this.highlightedIndex ? 'highlighted' : ''}"
                 data-value="${escapeHtml(String(option.value))}"
                 data-index="${index}">
                <span class="dropdown-option-text">${escapeHtml(option.label)}</span>
                ${option.description ? `<span class="dropdown-option-subtext">${escapeHtml(option.description)}</span>` : ''}
            </div>
        `).join('');
    }

    renderVirtualOptions() {
        const totalHeight = this.filteredOptions.length * this.itemHeight;
        const startIndex = Math.floor(this.scrollTop / this.itemHeight);
        const endIndex = Math.min(startIndex + this.visibleCount + 2, this.filteredOptions.length);
        const offsetY = startIndex * this.itemHeight;

        return `
            <div class="dropdown-virtual-container" style="height: ${totalHeight}px; position: relative;">
                <div class="dropdown-virtual-viewport" style="position: absolute; top: ${offsetY}px; left: 0; right: 0;">
                    ${this.filteredOptions.slice(startIndex, endIndex).map((option, i) => `
                        <div class="dropdown-option ${option.value === this.selectedValue ? 'selected' : ''}"
                             data-value="${escapeHtml(String(option.value))}"
                             data-index="${startIndex + i}"
                             style="height: ${this.itemHeight}px; display: flex; align-items: center;">
                            <span class="dropdown-option-text">${escapeHtml(option.label)}</span>
                            ${option.description ? `<span class="dropdown-option-subtext">${escapeHtml(option.description)}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    bindEvents() {
        // Toggle dropdown
        this.triggerEl.addEventListener('click', () => this.toggle());
        this.triggerEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggle();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.open();
            }
        });

        // Search input
        this.searchInput.addEventListener('input', (e) => this.filter(e.target.value));
        this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Option click
        this.optionsEl.addEventListener('click', (e) => {
            const optionEl = e.target.closest('.dropdown-option');
            if (optionEl) {
                this.select(optionEl.dataset.value);
            }
        });

        // Virtual scroll
        this.optionsEl.addEventListener('scroll', () => this.handleVirtualScroll());

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
                if (this.highlightedIndex >= 0 && this.filteredOptions[this.highlightedIndex]) {
                    this.select(this.filteredOptions[this.highlightedIndex].value);
                }
                break;
            case 'Escape':
                this.close();
                break;
        }
    }

    handleVirtualScroll() {
        if (!this.virtualScroll || this.filteredOptions.length <= 20) return;

        this.scrollTop = this.optionsEl.scrollTop;
        const startIndex = Math.floor(this.scrollTop / this.itemHeight);
        const endIndex = Math.min(startIndex + this.visibleCount + 2, this.filteredOptions.length);
        const offsetY = startIndex * this.itemHeight;

        const viewport = this.optionsEl.querySelector('.dropdown-virtual-viewport');
        if (viewport) {
            viewport.style.top = `${offsetY}px`;
            viewport.innerHTML = this.filteredOptions.slice(startIndex, endIndex).map((option, i) => `
                <div class="dropdown-option ${option.value === this.selectedValue ? 'selected' : ''}"
                     data-value="${escapeHtml(String(option.value))}"
                     data-index="${startIndex + i}"
                     style="height: ${this.itemHeight}px; display: flex; align-items: center;">
                    <span class="dropdown-option-text">${escapeHtml(option.label)}</span>
                    ${option.description ? `<span class="dropdown-option-subtext">${escapeHtml(option.description)}</span>` : ''}
                </div>
            `).join('');
        }
    }

    highlightNext() {
        if (this.highlightedIndex < this.filteredOptions.length - 1) {
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
        const options = this.optionsEl.querySelectorAll('.dropdown-option');
        options.forEach((el, i) => {
            const dataIndex = parseInt(el.dataset.index);
            el.classList.toggle('highlighted', dataIndex === this.highlightedIndex);
        });

        // Scroll into view
        const highlighted = this.optionsEl.querySelector('.dropdown-option.highlighted');
        if (highlighted) {
            highlighted.scrollIntoView({ block: 'nearest' });
        }
    }

    filter(query) {
        const q = query.toLowerCase().trim();
        this.filteredOptions = this.options.filter(option => {
            const label = (option.label || '').toLowerCase();
            const desc = (option.description || '').toLowerCase();
            return label.includes(q) || desc.includes(q);
        });
        this.highlightedIndex = this.filteredOptions.length > 0 ? 0 : -1;
        this.scrollTop = 0;
        this.optionsEl.scrollTop = 0;
        this.optionsEl.innerHTML = this.renderOptions();
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
        this.dropdownEl.classList.add('open');
        this.searchInput.value = '';
        this.filteredOptions = [...this.options];
        this.scrollTop = 0;
        this.optionsEl.scrollTop = 0;
        this.optionsEl.innerHTML = this.renderOptions();
        setTimeout(() => this.searchInput.focus(), 50);
    }

    close() {
        this.isOpen = false;
        this.dropdownEl.classList.remove('open');
        this.highlightedIndex = -1;
    }

    select(value) {
        const option = this.options.find(o => String(o.value) === String(value));
        if (option) {
            this.selectedValue = option.value;
            this.selectedTextEl.textContent = option.label;
            this.selectedTextEl.classList.remove('placeholder');
            this.close();
            this.onChange(option.value, option);
        }
    }

    getValue() {
        return this.selectedValue;
    }

    setValue(value) {
        const option = this.options.find(o => String(o.value) === String(value));
        if (option) {
            this.selectedValue = option.value;
            this.selectedTextEl.textContent = option.label;
            this.selectedTextEl.classList.remove('placeholder');
        }
    }

    setOptions(newOptions) {
        this.options = newOptions;
        this.filteredOptions = [...newOptions];
        if (this.selectedValue) {
            const stillExists = newOptions.find(o => o.value === this.selectedValue);
            if (!stillExists) {
                this.selectedValue = null;
                this.selectedTextEl.textContent = this.placeholder;
                this.selectedTextEl.classList.add('placeholder');
            }
        }
        if (this.isOpen) {
            this.scrollTop = 0;
            this.optionsEl.scrollTop = 0;
            this.optionsEl.innerHTML = this.renderOptions();
        }
    }

    reset() {
        this.selectedValue = null;
        this.selectedTextEl.textContent = this.placeholder;
        this.selectedTextEl.classList.add('placeholder');
        this.filteredOptions = [...this.options];
        this.highlightedIndex = -1;
        this.scrollTop = 0;
    }

    destroy() {
        payrollSearchableDropdowns.delete(this.id);
        this.container.innerHTML = '';
    }
}

// Modal utility functions
function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Modal should only be closed via the close button, not by clicking on backdrop

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

        // Initialize RBAC
        hrmsRoles.init();

        // Apply RBAC visibility
        applyPayrollRBAC();

        // Setup tabs
        setupTabs();

        // Load initial data - including year dropdowns
        await loadOffices();
        await populateYearDropdowns();

        if (hrmsRoles.isHRAdmin()) {
            await Promise.all([
                loadPayrollDrafts(),
                loadPayrollRuns(),
                loadEmployees(),
                loadComponents(),
                loadSalaryStructures(),
                loadTaxTypes(),
                loadOfficeTaxRules()
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

// Apply RBAC visibility rules for payroll page
function applyPayrollRBAC() {
    const isHRAdminRole = hrmsRoles.isHRAdmin();

    // Admin actions header
    const adminActions = document.getElementById('adminActions');
    if (adminActions) {
        adminActions.style.display = isHRAdminRole ? 'flex' : 'none';
    }

    // Payroll Drafts tab - HR Admin only
    const payrollDraftsTab = document.getElementById('payrollDraftsTab');
    if (payrollDraftsTab) {
        payrollDraftsTab.style.display = isHRAdminRole ? 'block' : 'none';
    }

    // Payroll Runs tab - HR Admin only
    const payrollRunsTab = document.getElementById('payrollRunsTab');
    if (payrollRunsTab) {
        payrollRunsTab.style.display = isHRAdminRole ? 'block' : 'none';
    }

    // Salary Components tab - HR Admin only
    const salaryComponentsTab = document.getElementById('salaryComponentsTab');
    if (salaryComponentsTab) {
        salaryComponentsTab.style.display = isHRAdminRole ? 'block' : 'none';
    }

    // Location Taxes tab - HR Admin only
    const locationTaxesTab = document.getElementById('locationTaxesTab');
    if (locationTaxesTab) {
        locationTaxesTab.style.display = isHRAdminRole ? 'block' : 'none';
    }

    // Salary Structures tab - HR Admin only
    const salaryStructuresTab = document.getElementById('salaryStructuresTab');
    if (salaryStructuresTab) {
        salaryStructuresTab.style.display = isHRAdminRole ? 'block' : 'none';
    }

    // Create Structure button - HR Admin only
    const createStructureBtn = document.getElementById('createStructureBtn');
    if (createStructureBtn) {
        createStructureBtn.style.display = isHRAdminRole ? 'inline-flex' : 'none';
    }

    // Create Component button - HR Admin only
    const createComponentBtn = document.getElementById('createComponentBtn');
    if (createComponentBtn) {
        createComponentBtn.style.display = isHRAdminRole ? 'inline-flex' : 'none';
    }

    // Loan Employee Row (for admin creating loans for employees) - HR Admin only
    const loanEmployeeRow = document.getElementById('loanEmployeeRow');
    if (loanEmployeeRow) {
        loanEmployeeRow.style.display = isHRAdminRole ? 'block' : 'none';
    }

    // Arrears tab - HR Admin only
    const arrearsTab = document.getElementById('arrearsTab');
    if (arrearsTab) {
        arrearsTab.style.display = isHRAdminRole ? 'block' : 'none';
    }

    // All Payslips tab - HR Admin only
    const allPayslipsTab = document.getElementById('allPayslipsTab');
    if (allPayslipsTab) {
        allPayslipsTab.style.display = isHRAdminRole ? 'block' : 'none';
    }

    // Salary Reports tab - HR Admin only
    const salaryReportsTab = document.getElementById('salaryReportsTab');
    if (salaryReportsTab) {
        salaryReportsTab.style.display = isHRAdminRole ? 'block' : 'none';
    }
}

// Populate year dropdowns dynamically from API
async function populateYearDropdowns() {
    try {
        // Fetch years for each tab type in parallel
        const [draftYears, runYears, payslipYears] = await Promise.all([
            fetchDraftYears(),
            fetchRunYears(),
            fetchPayslipYears()
        ]);

        // Populate drafts tab year dropdown
        const draftYearSelect = document.getElementById('draftYear');
        if (draftYearSelect && draftYears.length > 0) {
            populateYearSelect(draftYearSelect, draftYears);
        }

        // Populate finalized runs tab year dropdown
        const runYearSelect = document.getElementById('runYear');
        if (runYearSelect && runYears.length > 0) {
            populateYearSelect(runYearSelect, runYears);
        }

        // Populate all payslips tab year dropdown
        const allPayslipsYearSelect = document.getElementById('allPayslipsYear');
        if (allPayslipsYearSelect && payslipYears.length > 0) {
            populateYearSelect(allPayslipsYearSelect, payslipYears);
        }

        // Populate create draft modal year dropdown (use draft years)
        const draftPayrollYearSelect = document.getElementById('draftPayrollYear');
        if (draftPayrollYearSelect && draftYears.length > 0) {
            populateYearSelect(draftPayrollYearSelect, draftYears);
        }

    } catch (error) {
        console.error('Error populating year dropdowns:', error);
        // Fallback: populate with current year and previous year
        const currentYear = new Date().getFullYear();
        const fallbackYears = [currentYear, currentYear - 1];

        ['draftYear', 'runYear', 'allPayslipsYear', 'draftPayrollYear'].forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                populateYearSelect(select, fallbackYears);
            }
        });
    }
}

// Helper function to populate a year select dropdown
function populateYearSelect(selectElement, years) {
    selectElement.innerHTML = '';
    years.forEach((year, index) => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (index === 0) {
            option.selected = true; // Select first year (most recent) by default
        }
        selectElement.appendChild(option);
    });
}

// Fetch available years from API endpoints
async function fetchDraftYears() {
    try {
        const response = await api.request('/hrms/payroll-drafts/years');
        return response || [new Date().getFullYear()];
    } catch (error) {
        console.error('Error fetching draft years:', error);
        return [new Date().getFullYear()];
    }
}

async function fetchRunYears() {
    try {
        const response = await api.request('/hrms/payroll-processing/runs/years');
        return response || [new Date().getFullYear()];
    } catch (error) {
        console.error('Error fetching run years:', error);
        return [new Date().getFullYear()];
    }
}

async function fetchPayslipYears() {
    try {
        const response = await api.request('/hrms/payroll-processing/payslips/years');
        return response || [new Date().getFullYear()];
    } catch (error) {
        console.error('Error fetching payslip years:', error);
        return [new Date().getFullYear()];
    }
}

function setupTabs() {
    // Support both sidebar-btn (new) and tab-btn (legacy) selectors
    const tabBtns = document.querySelectorAll('.sidebar-btn[data-tab], .tab-btn[data-tab]');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', async function() {
            const tabId = this.dataset.tab;

            // Update active states
            tabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');

            // Load data for specific tabs when switched
            if (tabId === 'arrears') {
                await loadPendingArrears();
            } else if (tabId === 'payroll-drafts') {
                await loadPayrollDrafts();
            } else if (tabId === 'payroll-runs') {
                await loadPayrollRuns();
            } else if (tabId === 'loans') {
                await loadLoans();
            } else if (tabId === 'location-taxes') {
                // Ensure default sub-tab is active and load data
                const activeSubTab = document.querySelector('#location-taxes .sub-tab-btn.active');
                if (activeSubTab?.dataset.subtab === 'office-tax-rules') {
                    switchLocationTaxSubTab('office-tax-rules');
                } else {
                    // Default to tax-types
                    switchLocationTaxSubTab('tax-types');
                }
            } else if (tabId === 'voluntary-deductions') {
                // Ensure default sub-tab is active and load data
                const activeSubTab = document.querySelector('#voluntary-deductions .sub-tab-btn.active');
                if (activeSubTab?.dataset.subtab === 'vd-types') {
                    switchVDSubTab('vd-types');
                } else {
                    // Default to vd-enrollments
                    switchVDSubTab('vd-enrollments');
                }
            } else if (tabId === 'adjustments') {
                await loadAdjustments();
            } else if (tabId === 'salary-reports') {
                await loadSalaryReports();
            }
        });
    });

    // Setup sub-tabs for Location Taxes
    setupSubTabs();
}

function setupSubTabs() {
    // Setup Location Taxes sub-tabs (scoped to #location-taxes container)
    const locationTaxBtns = document.querySelectorAll('#location-taxes .sub-tab-btn');
    locationTaxBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            switchLocationTaxSubTab(this.dataset.subtab);
        });
    });
}

// Location Taxes sub-tab switcher (scoped to #location-taxes)
function switchLocationTaxSubTab(subTabId) {
    // Update sub-tab buttons within location-taxes only
    document.querySelectorAll('#location-taxes .sub-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.subtab === subTabId) {
            btn.classList.add('active');
        }
    });

    // Update sub-tab content within location-taxes only
    document.querySelectorAll('#location-taxes .sub-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(subTabId)?.classList.add('active');

    // Load data for the selected sub-tab
    if (subTabId === 'tax-types') {
        loadTaxTypes();
    } else if (subTabId === 'office-tax-rules') {
        loadOfficeTaxRules();
    }
}

function setDefaultPayrollDates() {
    // This function was used for the old Run Payroll modal which has been removed.
    // Now payroll is processed through drafts. Keeping function for compatibility.
    // Set draft filter defaults if elements exist
    const draftYear = document.getElementById('draftFilterYear');
    const draftMonth = document.getElementById('draftFilterMonth');

    if (draftYear) {
        draftYear.value = new Date().getFullYear();
    }
    if (draftMonth) {
        draftMonth.value = ''; // All months by default
    }
}

async function loadPayrollRuns() {
    try {
        const year = document.getElementById('runYear').value;
        const month = document.getElementById('runMonth').value;
        const officeId = document.getElementById('runOffice').value;

        let url = `/hrms/payroll-processing/runs?year=${year}`;
        if (month) url += `&month=${month}`;
        if (officeId) url += `&officeId=${officeId}`;

        const response = await api.request(url);
        updatePayrollRunsTable(response || []);
    } catch (error) {
        console.error('Error loading payroll runs:', error);
    }
}

// =====================================================
// PAYROLL DRAFTS FUNCTIONS
// =====================================================

async function loadPayrollDrafts() {
    try {
        const year = document.getElementById('draftYear')?.value || new Date().getFullYear();
        const month = document.getElementById('draftMonth')?.value || '';
        const officeId = document.getElementById('draftOffice')?.value || '';

        let url = `/hrms/payroll-drafts?year=${year}`;
        if (month) url += `&month=${month}`;
        if (officeId) url += `&officeId=${officeId}`;

        const response = await api.request(url);
        drafts = response || [];
        updatePayrollDraftsTable(drafts);
    } catch (error) {
        console.error('Error loading payroll drafts:', error);
    }
}

function updatePayrollDraftsTable(draftsList) {
    const tbody = document.getElementById('payrollDraftsTable');
    if (!tbody) return;

    if (!draftsList || draftsList.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="9">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                        <p>No payroll drafts found</p>
                        <p class="hint">Create a new draft to start payroll processing</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = draftsList.map(draft => `
        <tr>
            <td><strong>${draft.draft_name || 'Draft'}</strong> #${draft.draft_number || 1}</td>
            <td>${getMonthName(draft.payroll_month)} ${draft.payroll_year}</td>
            <td>${draft.office_name || 'All Offices'}</td>
            <td>${draft.total_employees || 0}</td>
            <td>${formatCurrency(draft.total_gross)}</td>
            <td>${formatCurrency(draft.total_net)}</td>
            <td><span class="status-badge status-${draft.status?.toLowerCase()}">${formatDraftStatus(draft.status)}</span></td>
            <td>${formatDate(draft.created_at)}</td>
            <td>
                <div class="action-buttons">
                    ${draft.status === 'pending' ? `
                    <button class="action-btn success" onclick="processDraft('${draft.id}')" title="Process All Employees">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                    </button>
                    <button class="action-btn" onclick="showProcessSelectedModal('${draft.id}')" title="Process Selected Employees">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="8.5" cy="7" r="4"></circle>
                            <polyline points="17 11 19 13 23 9"></polyline>
                        </svg>
                    </button>
                    ` : ''}
                    ${draft.status === 'processed' ? `
                    <button class="action-btn" onclick="viewDraftDetails('${draft.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    <button class="action-btn warning" onclick="recalculateDraft('${draft.id}')" title="Recalculate">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                        </svg>
                    </button>
                    <button class="action-btn success" onclick="finalizeDraft('${draft.id}')" title="Finalize Draft">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    ` : ''}
                    <button class="action-btn" onclick="renameDraft('${draft.id}', '${draft.draft_name || 'Draft'}')" title="Rename">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteDraft('${draft.id}')" title="Delete">
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

function formatDraftStatus(status) {
    const statusMap = {
        'pending': 'Not Processed',
        'processing': 'Processing...',
        'processed': 'Ready to Finalize'
    };
    return statusMap[status] || status;
}

async function createPayrollDraft() {
    const form = document.getElementById('createDraftForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const officeId = document.getElementById('draftPayrollOffice').value;

        // Parse month picker value (format: YYYY-MM)
        const periodValue = document.getElementById('draftPayrollPeriod').value;
        const [year, month] = periodValue.split('-').map(Number);

        const data = {
            payroll_month: month,
            payroll_year: year,
            office_id: officeId ? officeId : null,
            draft_name: document.getElementById('draftName').value || 'Draft',
            pay_period_start: document.getElementById('draftPeriodStart').value,
            pay_period_end: document.getElementById('draftPeriodEnd').value,
            notes: document.getElementById('draftNotes')?.value || ''
        };

        const draft = await api.request('/hrms/payroll-drafts', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        closeModal('createDraftModal');
        showToast('Draft created successfully', 'success');
        await loadPayrollDrafts();
        hideLoading();
    } catch (error) {
        console.error('Error creating draft:', error);
        showToast(error.message || error.error || 'Failed to create draft', 'error');
        hideLoading();
    }
}

async function processDraft(draftId) {
    const confirmed = await Confirm.show({
        title: 'Process Draft',
        message: 'Process this draft? This will generate payslips for all eligible employees.',
        type: 'info',
        confirmText: 'Process',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-drafts/${draftId}/process`, {
            method: 'POST'
        });

        let message = `Draft processed! ${result.payslips_generated || 0} payslips generated`;
        if (result.errors && result.errors.length > 0) {
            message += ` (${result.errors.length} errors)`;
        }
        showToast(message, result.errors?.length > 0 ? 'warning' : 'success');
        await loadPayrollDrafts();
        hideLoading();

        // Show details after processing
        if (result.draft_id) {
            await viewDraftDetails(result.draft_id);
        }
    } catch (error) {
        console.error('Error processing draft:', error);
        showToast(error.message || error.error || 'Failed to process draft', 'error');
        hideLoading();
    }
}

// =====================================================
// PROCESS SELECTED EMPLOYEES FUNCTIONS
// =====================================================

let processSelectedDraftId = null;
let processSelectedEmployees_all = [];
let processSelectedEmployees_filtered = [];
let processSelectedEmployees_selected = new Set();

/**
 * Show the Process Selected Employees modal
 */
async function showProcessSelectedModal(draftId) {
    processSelectedDraftId = draftId;
    processSelectedEmployees_all = [];
    processSelectedEmployees_filtered = [];
    processSelectedEmployees_selected = new Set();

    // Reset UI
    document.getElementById('pseSearch').value = '';
    document.getElementById('pseSelectAll').checked = false;
    document.getElementById('pseSelectedCount').textContent = '0';
    document.getElementById('pseTotalCount').textContent = '0';
    document.getElementById('pseProcessBtn').disabled = true;
    document.getElementById('pseSelectionSummary').style.display = 'none';
    document.getElementById('pseEmployeeList').innerHTML = `
        <div class="loading-placeholder">
            <div class="spinner"></div>
            <p>Loading eligible employees...</p>
        </div>
    `;

    openModal('processSelectedModal');

    try {
        // First, get the draft info
        const draft = await api.request(`/hrms/payroll-drafts/${draftId}`);

        // Populate draft info
        document.getElementById('pseDraftName').textContent = draft.draft_name || 'Draft';
        document.getElementById('psePeriod').textContent = `${getMonthName(draft.payroll_month)} ${draft.payroll_year}`;
        document.getElementById('pseOffice').textContent = draft.office_name || 'All Offices';

        // Get employees with salaries for this office
        let employeesUrl = '/hrms/payroll/all-salaries?currentOnly=true';
        if (draft.office_id) {
            employeesUrl += `&office_id=${draft.office_id}`;
        }

        const salariesResponse = await api.request(employeesUrl);
        const employees = salariesResponse.employees || salariesResponse || [];

        processSelectedEmployees_all = employees.map(emp => ({
            id: emp.employee_id || emp.id,
            employee_code: emp.employee_code || emp.code,
            employee_name: emp.employee_name || emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
            department_name: emp.department_name || emp.department || '-',
            designation_name: emp.designation_name || emp.designation || '-',
            monthly_gross: emp.monthly_gross || emp.gross || (emp.ctc ? emp.ctc / 12 : 0),
            ctc: emp.ctc || 0
        }));

        processSelectedEmployees_filtered = [...processSelectedEmployees_all];

        document.getElementById('pseTotalCount').textContent = processSelectedEmployees_all.length;

        renderProcessSelectedEmployeeList();

    } catch (error) {
        console.error('Error loading employees for process selected:', error);
        document.getElementById('pseEmployeeList').innerHTML = `
            <div class="empty-message">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>Failed to load employees</p>
                <small>${error.message || 'Please try again'}</small>
            </div>
        `;
    }
}

/**
 * Render the employee selection list
 */
function renderProcessSelectedEmployeeList() {
    const container = document.getElementById('pseEmployeeList');

    if (processSelectedEmployees_filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-message">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <line x1="19" y1="8" x2="19" y2="14"></line>
                    <line x1="22" y1="11" x2="16" y2="11"></line>
                </svg>
                <p>No eligible employees found</p>
                <small>Employees must have active salary records to be processed</small>
            </div>
        `;
        return;
    }

    container.innerHTML = processSelectedEmployees_filtered.map(emp => `
        <div class="employee-selection-item ${processSelectedEmployees_selected.has(emp.id) ? 'selected' : ''}"
             onclick="toggleProcessSelectedEmployee('${emp.id}')">
            <div class="employee-checkbox">
                <input type="checkbox" id="pse-emp-${emp.id}"
                       ${processSelectedEmployees_selected.has(emp.id) ? 'checked' : ''}
                       onchange="toggleProcessSelectedEmployee('${emp.id}', event)">
            </div>
            <div class="employee-info">
                <div class="employee-name">${emp.employee_name || 'Unknown'}</div>
                <div class="employee-details">
                    <span class="emp-code">${emp.employee_code || '-'}</span>
                    <span class="separator">•</span>
                    <span class="emp-dept">${emp.department_name || '-'}</span>
                </div>
            </div>
            <div class="employee-salary">
                <div class="salary-value">${formatCurrency(emp.monthly_gross)}</div>
                <div class="salary-label">Monthly Gross</div>
            </div>
        </div>
    `).join('');
}

/**
 * Filter employees based on search input
 */
function filterProcessSelectedEmployees() {
    const searchTerm = document.getElementById('pseSearch').value.toLowerCase().trim();

    if (!searchTerm) {
        processSelectedEmployees_filtered = [...processSelectedEmployees_all];
    } else {
        processSelectedEmployees_filtered = processSelectedEmployees_all.filter(emp =>
            (emp.employee_name || '').toLowerCase().includes(searchTerm) ||
            (emp.employee_code || '').toLowerCase().includes(searchTerm) ||
            (emp.department_name || '').toLowerCase().includes(searchTerm)
        );
    }

    renderProcessSelectedEmployeeList();
}

/**
 * Toggle selection of a single employee
 */
function toggleProcessSelectedEmployee(employeeId, event) {
    if (event) {
        event.stopPropagation();
    }

    if (processSelectedEmployees_selected.has(employeeId)) {
        processSelectedEmployees_selected.delete(employeeId);
    } else {
        processSelectedEmployees_selected.add(employeeId);
    }

    updateProcessSelectedUI();
    renderProcessSelectedEmployeeList();
}

/**
 * Toggle all employees selection
 */
function toggleAllProcessSelectedEmployees() {
    const selectAll = document.getElementById('pseSelectAll').checked;

    if (selectAll) {
        // Select all filtered employees
        processSelectedEmployees_filtered.forEach(emp => {
            processSelectedEmployees_selected.add(emp.id);
        });
    } else {
        // Deselect all
        processSelectedEmployees_selected.clear();
    }

    updateProcessSelectedUI();
    renderProcessSelectedEmployeeList();
}

/**
 * Update UI elements based on selection
 */
function updateProcessSelectedUI() {
    const selectedCount = processSelectedEmployees_selected.size;
    document.getElementById('pseSelectedCount').textContent = selectedCount;

    // Enable/disable process button
    document.getElementById('pseProcessBtn').disabled = selectedCount === 0;

    // Update select all checkbox state
    const selectAllCheckbox = document.getElementById('pseSelectAll');
    const allFilteredSelected = processSelectedEmployees_filtered.length > 0 &&
        processSelectedEmployees_filtered.every(emp => processSelectedEmployees_selected.has(emp.id));
    selectAllCheckbox.checked = allFilteredSelected;
    selectAllCheckbox.indeterminate = selectedCount > 0 && !allFilteredSelected;

    // Update summary
    const summary = document.getElementById('pseSelectionSummary');
    if (selectedCount > 0) {
        summary.style.display = 'flex';
        document.getElementById('pseSummaryTotal').textContent = selectedCount;

        // Calculate estimated gross
        const totalGross = processSelectedEmployees_all
            .filter(emp => processSelectedEmployees_selected.has(emp.id))
            .reduce((sum, emp) => sum + (emp.monthly_gross || 0), 0);
        document.getElementById('pseSummaryGross').textContent = formatCurrency(totalGross);
    } else {
        summary.style.display = 'none';
    }
}

/**
 * Process the selected employees
 */
async function processSelectedEmployees() {
    if (processSelectedEmployees_selected.size === 0) {
        showToast('Please select at least one employee', 'warning');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Process Selected Employees',
        message: `Process payroll for ${processSelectedEmployees_selected.size} selected employee(s)?`,
        type: 'info',
        confirmText: 'Process',
        cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
        showLoading();

        const employeeIds = Array.from(processSelectedEmployees_selected);

        const result = await api.request(`/hrms/payroll-drafts/${processSelectedDraftId}/process-selected`, {
            method: 'POST',
            body: JSON.stringify({
                include_all_employees: false,
                employee_ids: employeeIds
            })
        });

        closeModal('processSelectedModal');

        let message = `Draft processed! ${result.payslips_generated || 0} payslips generated`;
        if (result.errors && result.errors.length > 0) {
            message += ` (${result.errors.length} errors)`;
        }
        showToast(message, result.errors?.length > 0 ? 'warning' : 'success');

        await loadPayrollDrafts();
        hideLoading();

        // Show details after processing
        if (result.draft_id) {
            await viewDraftDetails(result.draft_id);
        }
    } catch (error) {
        console.error('Error processing selected employees:', error);
        showToast(error.message || error.error || 'Failed to process selected employees', 'error');
        hideLoading();
    }
}

async function recalculateDraft(draftId) {
    const confirmed = await Confirm.show({
        title: 'Recalculate Draft',
        message: 'Recalculate this draft? This will regenerate all payslips with current data.',
        type: 'warning',
        confirmText: 'Recalculate',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-drafts/${draftId}/recalculate`, {
            method: 'POST'
        });

        showToast(`Draft recalculated! ${result.payslips_generated || 0} payslips regenerated`, 'success');
        await loadPayrollDrafts();
        hideLoading();

        if (result.draft_id) {
            await viewDraftDetails(result.draft_id);
        }
    } catch (error) {
        console.error('Error recalculating draft:', error);
        showToast(error.message || error.error || 'Failed to recalculate draft', 'error');
        hideLoading();
    }
}

async function viewDraftDetails(draftId) {
    try {
        showLoading();
        const details = await api.request(`/hrms/payroll-drafts/${draftId}/details`);

        // Populate modal with draft details
        const modal = document.getElementById('draftDetailsModal');
        if (!modal) {
            console.error('Draft details modal not found');
            hideLoading();
            return;
        }

        const draft = details.draft;
        const payslips = details.payslips || [];
        const summary = details.summary || {};

        document.getElementById('draftDetailTitle').textContent = `${draft.draft_name} - ${getMonthName(draft.payroll_month)} ${draft.payroll_year}`;

        // Update summary cards
        document.getElementById('draftTotalEmployees').textContent = summary.total_employees || 0;
        document.getElementById('draftTotalGross').textContent = formatCurrency(summary.total_gross || 0);
        document.getElementById('draftTotalDeductions').textContent = formatCurrency(summary.total_deductions || 0);
        document.getElementById('draftTotalNet').textContent = formatCurrency(summary.total_net || 0);

        // Update payslips table
        const tbody = document.getElementById('draftPayslipsTable');
        if (payslips.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">No payslips generated yet</td></tr>';
        } else {
            tbody.innerHTML = payslips.map(p => `
                <tr class="draft-payslip-row"
                    data-code="${(p.employee_code || '').toLowerCase()}"
                    data-name="${(p.employee_name || '').toLowerCase()}"
                    data-dept="${(p.department_name || '').toLowerCase()}">
                    <td><code>${p.employee_code || '-'}</code></td>
                    <td>${p.employee_name || 'Unknown'}</td>
                    <td>${p.department_name || '-'}</td>
                    <td>${formatCurrency(p.gross_earnings)}</td>
                    <td>${formatCurrency(p.total_deductions)}</td>
                    <td><strong>${formatCurrency(p.net_pay)}</strong></td>
                    <td>
                        <button class="action-btn" onclick="viewDraftPayslip('${p.id}')" title="View Details">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                    </td>
                </tr>
            `).join('');
        }

        // Store payslips data for export
        window.currentDraftPayslips = payslips;

        // Clear search input
        const searchInput = document.getElementById('draftPayslipSearch');
        if (searchInput) searchInput.value = '';

        // Store current draft ID for finalization
        modal.dataset.draftId = draftId;

        openModal('draftDetailsModal');
        hideLoading();
    } catch (error) {
        console.error('Error loading draft details:', error);
        showToast(error.message || 'Failed to load draft details', 'error');
        hideLoading();
    }
}

async function viewDraftPayslip(payslipId) {
    try {
        showLoading();
        const payslip = await api.request(`/hrms/payroll-drafts/payslips/${payslipId}?includeItems=true`);

        // Populate payslipContent dynamically
        const contentDiv = document.getElementById('payslipContent');
        if (!contentDiv) {
            hideLoading();
            showToast('Payslip modal not found', 'error');
            return;
        }

        const items = payslip.items || [];

        // Group items by structure for compliance display
        const structureGroups = groupItemsByStructure(items);
        const hasMultipleStructures = structureGroups.length > 1;

        // Build structure-wise breakdown HTML
        let structureBreakdownHtml = '';

        if (hasMultipleStructures) {
            structureBreakdownHtml = `
                <div style="margin-bottom: 1.5rem; padding: 0.75rem; background: var(--color-warning-light); border: 1px solid var(--color-warning); border-radius: 8px;">
                    <strong class="text-warning-dark">Mid-Period Structure Change</strong>
                    <p class="text-warning-dark" style="margin: 0.5rem 0 0 0; font-size: 0.85rem;">
                        This employee had a salary structure change during the pay period.
                        Components are shown separately for each structure for compliance purposes.
                    </p>
                </div>
            `;

            for (const group of structureGroups) {
                const periodText = group.period_start && group.period_end
                    ? `${formatDate(group.period_start)} - ${formatDate(group.period_end)}`
                    : '';

                const groupEarnings = group.items.filter(i => i.component_type === 'earning');
                const groupDeductions = group.items.filter(i => i.component_type === 'deduction');

                const groupEarningsTotal = groupEarnings.reduce((sum, i) => sum + (i.amount || 0), 0);
                const groupDeductionsTotal = groupDeductions.reduce((sum, i) => sum + (i.amount || 0), 0);

                structureBreakdownHtml += `
                    <div style="margin-bottom: 1.5rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-subtle);">
                        <div style="margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                            <h5 style="margin: 0; color: var(--brand-primary);">${group.structure_name || 'Salary Structure'}</h5>
                            ${periodText ? `<p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--text-muted);">Period: ${periodText}</p>` : ''}
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <h6 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-success);">Earnings</h6>
                                <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; color: var(--text-muted);">
                                            <th>Component</th>
                                            <th class="text-right">Amount</th>
                                            <th class="text-right">YTD</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${groupEarnings.length > 0
                                            ? groupEarnings.map(i => `
                                                <tr>
                                                    <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                                                    <td class="text-right">${formatCurrency(i.amount)}</td>
                                                    <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${formatCurrency(i.ytd_amount || 0)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="3" class="text-muted">No earnings</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${formatCurrency(groupEarningsTotal)}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <div>
                                <h6 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-danger);">Deductions</h6>
                                <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; color: var(--text-muted);">
                                            <th>Component</th>
                                            <th class="text-right">Amount</th>
                                            <th class="text-right">YTD</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${groupDeductions.length > 0
                                            ? groupDeductions.map(i => `
                                                <tr>
                                                    <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                                                    <td class="text-right">${formatCurrency(i.amount)}</td>
                                                    <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${formatCurrency(i.ytd_amount || 0)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="3" class="text-muted">No deductions</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${formatCurrency(groupDeductionsTotal)}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
            }

            // Add combined totals section for multi-structure
            structureBreakdownHtml += `
                <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 8px; border: 2px solid var(--border-color);">
                    <h5 style="margin: 0 0 1rem 0;">Combined Totals</h5>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Total Gross Earnings</span>
                                <span style="font-weight: 600; color: var(--color-success);">${formatCurrency(payslip.gross_earnings)}</span>
                            </div>
                            ${payslip.arrears > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Arrears Total</span>
                                <span style="font-weight: 600; color: var(--color-warning);">${formatCurrency(payslip.arrears)}</span>
                            </div>
                            ${payslip.arrears_breakdown && payslip.arrears_breakdown.length > 0 ? `
                            <div class="arrears-breakdown-section" style="margin-top: 0.5rem; padding: 0.5rem; background: rgba(var(--color-warning-rgb, 245, 158, 11), 0.08); border-radius: 6px; border-left: 3px solid var(--color-warning);">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                    <svg width="14" height="14" fill="currentColor" style="color: var(--color-warning);"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3.5a.5.5 0 0 1-.5-.5v-3.5A.5.5 0 0 1 8 4z"/></svg>
                                    <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-warning);">Arrears by Period (Audit)</span>
                                </div>
                                <table class="data-table" style="width: 100%; font-size: 0.75rem;">
                                    <thead>
                                        <tr style="background: transparent;">
                                            <th style="padding: 0.25rem 0.5rem; text-align: left; font-weight: 500;">Period</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: left; font-weight: 500;">Type</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">Old</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">New</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">Arrears</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${payslip.arrears_breakdown.map(arr => `
                                            <tr>
                                                <td style="padding: 0.25rem 0.5rem;">${arr.period_display || getMonthName(arr.payroll_month) + ' ' + arr.payroll_year}</td>
                                                <td style="padding: 0.25rem 0.5rem;">
                                                    <span class="badge ${arr.source_type === 'ctc_revision' ? 'badge-info' : 'badge-secondary'}" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">
                                                        ${arr.source_type === 'ctc_revision' ? 'CTC Revision' : 'Structure'}
                                                    </span>
                                                    ${arr.source_type === 'ctc_revision' && arr.revision_type ? `
                                                        <span style="font-size: 0.6rem; color: var(--text-muted); display: block;">${formatRevisionType(arr.revision_type)}</span>
                                                    ` : ''}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--text-muted);">
                                                    ${arr.source_type === 'ctc_revision' && arr.old_ctc ? formatCurrency(arr.old_ctc) + '/yr' : formatCurrency(arr.old_gross)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--color-success);">
                                                    ${arr.source_type === 'ctc_revision' && arr.new_ctc ? formatCurrency(arr.new_ctc) + '/yr' : formatCurrency(arr.new_gross)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-warning);">${formatCurrency(arr.arrears_amount)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            ` : ''}
                            ` : ''}
                        </div>
                        <div>
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Total Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${formatCurrency(payslip.total_deductions)}</span>
                            </div>
                            ${payslip.loan_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Loan Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${formatCurrency(payslip.loan_deductions)}</span>
                            </div>
                            ` : ''}
                            ${payslip.voluntary_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Voluntary Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${formatCurrency(payslip.voluntary_deductions)}</span>
                            </div>
                            ${payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0 ? `
                            <div class="vd-breakdown-section" style="margin: 0.5rem 0; padding: 0.5rem; background: rgba(59, 130, 246, 0.08); border-radius: 6px; border-left: 3px solid #3b82f6;">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                    <svg width="14" height="14" fill="currentColor" style="color: #3b82f6;"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445z"/></svg>
                                    <span style="font-size: 0.75rem; font-weight: 600; color: #3b82f6;">Voluntary Deduction Details</span>
                                </div>
                                <table class="data-table" style="width: 100%; font-size: 0.75rem;">
                                    <thead>
                                        <tr style="background: transparent;">
                                            <th style="padding: 0.25rem 0.5rem; text-align: left; font-weight: 500;">Type</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">Full Amount</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">Deducted</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: left; font-weight: 500;">Period</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${payslip.voluntary_deduction_items.map(vd => `
                                            <tr>
                                                <td style="padding: 0.25rem 0.5rem;">
                                                    <span style="font-weight: 500;">${vd.deduction_type_name}</span>
                                                    <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">${vd.deduction_type_code}</span>
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--text-muted);">
                                                    ${formatCurrency(vd.full_amount)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-danger);">
                                                    ${formatCurrency(vd.deducted_amount)}
                                                    ${vd.is_prorated ? `<span style="font-size: 0.6rem; color: var(--text-muted); display: block;">(${(vd.proration_factor * 100).toFixed(0)}%)</span>` : ''}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; font-size: 0.7rem; color: var(--text-muted);">
                                                    ${vd.is_prorated ? `${vd.days_applicable || '-'}/${vd.total_days_in_period || '-'} days` : 'Full Month'}
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            ` : ''}
                            ` : ''}
                            <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; margin-top: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; padding-left: 0.5rem; padding-right: 0.5rem;">
                                <span style="font-weight: 700;">Net Pay</span>
                                <span style="font-weight: 700; color: var(--brand-primary); font-size: 1.1rem;">${formatCurrency(payslip.net_pay)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Single structure - use original layout
            const earnings = items.filter(i => i.component_type === 'earning');
            const deductions = items.filter(i => i.component_type === 'deduction');

            const earningsHtml = earnings.length > 0 ?
                earnings.map(i => `<tr><td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td><td class="text-right">${formatCurrency(i.amount)}</td><td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${formatCurrency(i.ytd_amount || 0)}</td></tr>`).join('') :
                '<tr><td colspan="3" class="text-muted">No earnings</td></tr>';

            const deductionsHtml = deductions.length > 0 ?
                deductions.map(i => `<tr><td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td><td class="text-right">${formatCurrency(i.amount)}</td><td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${formatCurrency(i.ytd_amount || 0)}</td></tr>`).join('') :
                '<tr><td colspan="3" class="text-muted">No deductions</td></tr>';

            structureBreakdownHtml = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div>
                        <h5 style="margin: 0 0 0.75rem 0; color: var(--color-success);">Earnings</h5>
                        <table class="data-table" style="width: 100%;">
                            <thead>
                                <tr style="font-size: 0.8rem; color: var(--text-muted);">
                                    <th>Component</th>
                                    <th class="text-right">Amount</th>
                                    <th class="text-right">YTD</th>
                                </tr>
                            </thead>
                            <tbody>${earningsHtml}</tbody>
                            <tfoot>
                                <tr style="font-weight: 600; border-top: 2px solid var(--border-color);">
                                    <td>Total Gross</td>
                                    <td class="text-right">${formatCurrency(payslip.gross_earnings)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div>
                        <h5 style="margin: 0 0 0.75rem 0; color: var(--color-danger);">Deductions</h5>
                        <table class="data-table" style="width: 100%;">
                            <thead>
                                <tr style="font-size: 0.8rem; color: var(--text-muted);">
                                    <th>Component</th>
                                    <th class="text-right">Amount</th>
                                    <th class="text-right">YTD</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${deductionsHtml}
                                ${payslip.loan_deductions > 0 ? `<tr><td>Loan EMI</td><td class="text-right">${formatCurrency(payslip.loan_deductions)}</td><td></td></tr>` : ''}
                                ${payslip.voluntary_deductions > 0 && payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0 ?
                                    payslip.voluntary_deduction_items.map(vd => `
                                        <tr>
                                            <td>
                                                ${vd.deduction_type_name}
                                                ${vd.is_prorated ? `<span style="font-size:0.7rem;color:var(--text-muted);"> (${vd.days_applicable || '-'}/${vd.total_days_in_period || '-'} days)</span>` : ''}
                                            </td>
                                            <td class="text-right">${formatCurrency(vd.deducted_amount)}</td>
                                            <td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">
                                                ${vd.is_prorated ? `${(vd.proration_factor * 100).toFixed(0)}%` : ''}
                                            </td>
                                        </tr>
                                    `).join('')
                                : ''}
                            </tbody>
                            <tfoot>
                                <tr style="font-weight: 600; border-top: 2px solid var(--border-color);">
                                    <td>Total Deductions</td>
                                    <td class="text-right">${formatCurrency(payslip.total_deductions + (payslip.loan_deductions || 0) + (payslip.voluntary_deductions || 0))}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;
        }

        contentDiv.innerHTML = `
            <div class="payslip-header" style="margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin: 0 0 0.25rem 0; font-size: 1rem;">${payslip.employee_name || 'Employee'}</h4>
                    <p style="margin: 0; color: var(--text-muted); font-size: 0.75rem;">Draft Payslip - ${formatDate(payslip.pay_period_start)} to ${formatDate(payslip.pay_period_end)}</p>
                </div>
                <div style="padding: 0.5rem 1rem; background: var(--brand-primary); color: var(--text-inverse); border-radius: 6px; text-align: right;">
                    <div style="font-size: 0.65rem; opacity: 0.9;">Net Pay</div>
                    <div style="font-size: 1.1rem; font-weight: 700;">${formatCurrency(payslip.net_pay)}</div>
                </div>
            </div>

            <div class="payslip-summary" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 0.75rem;">
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">Working Days</div>
                    <div style="font-size: 1rem; font-weight: 600;">${payslip.total_working_days || 0}</div>
                </div>
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">Days Worked</div>
                    <div style="font-size: 1rem; font-weight: 600;">${payslip.days_worked || 0}</div>
                </div>
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">LOP Days</div>
                    <div style="font-size: 1rem; font-weight: 600;">${payslip.lop_days || 0}</div>
                </div>
            </div>

            ${structureBreakdownHtml}

            ${(payslip.reimbursements > 0 || payslip.other_earnings > 0 || payslip.other_deductions > 0 || payslip.arrears > 0) ? `
            <div style="margin-top: 1rem; padding: 1rem; background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%); border-radius: 8px; border: 1px solid var(--border-color);">
                <h5 style="margin: 0 0 0.75rem 0; display: flex; align-items: center; gap: 0.5rem;">
                    <svg width="16" height="16" fill="currentColor" style="color: var(--color-success);"><path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/><path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"/></svg>
                    Adjustments & Additions
                </h5>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div>
                        <h6 style="margin: 0 0 0.5rem 0; font-size: 0.8rem; color: var(--color-success);">Additional Earnings</h6>
                        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                            <tbody>
                                ${payslip.reimbursements > 0 ? `
                                <tr>
                                    <td style="padding: 0.4rem 0;">
                                        <span style="display: flex; align-items: center; gap: 0.4rem;">
                                            <span class="badge" style="background: #10b981; color: white; font-size: 0.65rem; padding: 0.15rem 0.4rem;">Reimbursement</span>
                                        </span>
                                    </td>
                                    <td class="text-right" style="font-weight: 600; color: var(--color-success);">+${formatCurrency(payslip.reimbursements)}</td>
                                </tr>
                                ` : ''}
                                ${payslip.other_earnings > 0 ? `
                                <tr>
                                    <td style="padding: 0.4rem 0;">
                                        <span style="display: flex; align-items: center; gap: 0.4rem;">
                                            <span class="badge" style="background: #8b5cf6; color: white; font-size: 0.65rem; padding: 0.15rem 0.4rem;">Bonus/Incentive</span>
                                        </span>
                                    </td>
                                    <td class="text-right" style="font-weight: 600; color: var(--color-success);">+${formatCurrency(payslip.other_earnings)}</td>
                                </tr>
                                ` : ''}
                                ${payslip.arrears > 0 ? `
                                <tr>
                                    <td style="padding: 0.4rem 0;">
                                        <span style="display: flex; align-items: center; gap: 0.4rem;">
                                            <span class="badge" style="background: #f59e0b; color: white; font-size: 0.65rem; padding: 0.15rem 0.4rem;">Arrears</span>
                                        </span>
                                    </td>
                                    <td class="text-right" style="font-weight: 600; color: var(--color-warning);">+${formatCurrency(payslip.arrears)}</td>
                                </tr>
                                ` : ''}
                                ${(payslip.reimbursements <= 0 && payslip.other_earnings <= 0 && payslip.arrears <= 0) ? `
                                <tr><td colspan="2" class="text-muted" style="font-size: 0.8rem;">No additional earnings</td></tr>
                                ` : ''}
                            </tbody>
                            <tfoot style="border-top: 1px solid var(--border-color);">
                                <tr style="font-weight: 600;">
                                    <td style="padding: 0.5rem 0;">Total Additional</td>
                                    <td class="text-right" style="color: var(--color-success);">+${formatCurrency((payslip.reimbursements || 0) + (payslip.other_earnings || 0) + (payslip.arrears || 0))}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div>
                        <h6 style="margin: 0 0 0.5rem 0; font-size: 0.8rem; color: var(--color-danger);">Additional Deductions</h6>
                        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                            <tbody>
                                ${payslip.other_deductions > 0 ? `
                                <tr>
                                    <td style="padding: 0.4rem 0;">
                                        <span style="display: flex; align-items: center; gap: 0.4rem;">
                                            <span class="badge" style="background: #ef4444; color: white; font-size: 0.65rem; padding: 0.15rem 0.4rem;">Recovery</span>
                                        </span>
                                    </td>
                                    <td class="text-right" style="font-weight: 600; color: var(--color-danger);">-${formatCurrency(payslip.other_deductions)}</td>
                                </tr>
                                ` : `
                                <tr><td colspan="2" class="text-muted" style="font-size: 0.8rem;">No additional deductions</td></tr>
                                `}
                            </tbody>
                            ${payslip.other_deductions > 0 ? `
                            <tfoot style="border-top: 1px solid var(--border-color);">
                                <tr style="font-weight: 600;">
                                    <td style="padding: 0.5rem 0;">Total Deducted</td>
                                    <td class="text-right" style="color: var(--color-danger);">-${formatCurrency(payslip.other_deductions || 0)}</td>
                                </tr>
                            </tfoot>
                            ` : ''}
                        </table>
                    </div>
                </div>
                <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Net Impact from Adjustments</span>
                    <span style="font-weight: 700; font-size: 1rem; color: ${((payslip.reimbursements || 0) + (payslip.other_earnings || 0) + (payslip.arrears || 0) - (payslip.other_deductions || 0)) >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">
                        ${((payslip.reimbursements || 0) + (payslip.other_earnings || 0) + (payslip.arrears || 0) - (payslip.other_deductions || 0)) >= 0 ? '+' : ''}${formatCurrency((payslip.reimbursements || 0) + (payslip.other_earnings || 0) + (payslip.arrears || 0) - (payslip.other_deductions || 0))}
                    </span>
                </div>
            </div>
            ` : ''}
        `;

        openModal('payslipModal');
        hideLoading();
    } catch (error) {
        console.error('Error loading draft payslip:', error);
        showToast('Failed to load payslip details', 'error');
        hideLoading();
    }
}

// Helper function to group payslip items by structure
function groupItemsByStructure(items) {
    const groups = [];
    const groupMap = new Map();

    for (const item of items) {
        // Group by period dates (not structure_id) to handle same structure with different salaries
        // This is critical for mid-period appraisals where structure stays same but CTC changes
        const periodKey = `${item.period_start || 'none'}_${item.period_end || 'none'}`;

        if (!groupMap.has(periodKey)) {
            const group = {
                structure_id: item.structure_id,
                structure_name: item.structure_name || 'Standard',
                period_start: item.period_start,
                period_end: item.period_end,
                items: []
            };
            groupMap.set(periodKey, group);
            groups.push(group);
        }

        groupMap.get(periodKey).items.push(item);
    }

    // Sort groups by period_start date
    groups.sort((a, b) => {
        if (!a.period_start) return -1;
        if (!b.period_start) return 1;
        return new Date(a.period_start) - new Date(b.period_start);
    });

    return groups;
}

async function finalizeDraft(draftId) {
    const confirmed = await Confirm.show({
        title: 'Finalize Payroll Draft',
        message: 'Finalize this draft?\n\nThis will:\n• Move this draft to finalized payroll runs\n• Delete ALL other drafts for this period\n\nThis action cannot be undone.',
        type: 'warning',
        confirmText: 'Finalize',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-drafts/${draftId}/finalize`, {
            method: 'POST'
        });

        if (result.success) {
            showToast(`Payroll finalized successfully! ${result.drafts_deleted || 0} draft(s) cleaned up.`, 'success');
            closeModal('draftDetailsModal');
            await loadPayrollDrafts();
            await loadPayrollRuns();
        } else {
            showToast(result.message || 'Failed to finalize draft', 'error');
        }
        hideLoading();
    } catch (error) {
        console.error('Error finalizing draft:', error);
        showToast(error.message || error.error || 'Failed to finalize draft', 'error');
        hideLoading();
    }
}

async function deleteDraft(draftId) {
    const confirmed = await Confirm.show({
        title: 'Delete Draft',
        message: 'Delete this draft? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/payroll-drafts/${draftId}`, {
            method: 'DELETE'
        });

        showToast('Draft deleted successfully', 'success');
        await loadPayrollDrafts();
        hideLoading();
    } catch (error) {
        console.error('Error deleting draft:', error);
        showToast(error.message || error.error || 'Failed to delete draft', 'error');
        hideLoading();
    }
}

async function renameDraft(draftId, currentName) {
    const newName = await Prompt.show({
        title: 'Rename Draft',
        message: 'Enter new draft name:',
        defaultValue: currentName,
        placeholder: 'Draft name'
    });
    if (!newName || newName === currentName) return;

    try {
        showLoading();
        await api.request(`/hrms/payroll-drafts/${draftId}/rename`, {
            method: 'PUT',
            body: JSON.stringify({ draft_name: newName })
        });

        showToast('Draft renamed successfully', 'success');
        await loadPayrollDrafts();
        hideLoading();
    } catch (error) {
        console.error('Error renaming draft:', error);
        showToast(error.message || error.error || 'Failed to rename draft', 'error');
        hideLoading();
    }
}

function openCreateDraftModal() {
    // Reset form
    const form = document.getElementById('createDraftForm');
    if (form) form.reset();

    // Set default values
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Set month picker value (format: YYYY-MM)
    const monthStr = currentMonth.toString().padStart(2, '0');
    document.getElementById('draftPayrollPeriod').value = `${currentYear}-${monthStr}`;
    document.getElementById('draftName').value = 'Draft';

    // Set period start to 1st of month
    document.getElementById('draftPeriodStart').value = formatDateLocal(currentYear, currentMonth, 1);

    // Set period end to last day of month
    const lastDay = new Date(currentYear, currentMonth, 0).getDate();
    document.getElementById('draftPeriodEnd').value = formatDateLocal(currentYear, currentMonth, lastDay);

    openModal('createDraftModal');
}

// Format date as YYYY-MM-DD without timezone issues
function formatDateLocal(year, month, day) {
    const m = month.toString().padStart(2, '0');
    const d = day.toString().padStart(2, '0');
    return `${year}-${m}-${d}`;
}

// Update period dates when month picker changes
function updateDraftPeriodDates() {
    const periodValue = document.getElementById('draftPayrollPeriod').value;
    if (!periodValue) return;

    // Parse YYYY-MM format
    const [year, month] = periodValue.split('-').map(Number);

    // Set period start to 1st of month
    document.getElementById('draftPeriodStart').value = formatDateLocal(year, month, 1);

    // Set period end to last day of month
    const lastDay = new Date(year, month, 0).getDate();
    document.getElementById('draftPeriodEnd').value = formatDateLocal(year, month, lastDay);
}

// =====================================================
// END PAYROLL DRAFTS FUNCTIONS
// =====================================================

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
            <td><code>${run.run_number || run.id.substring(0, 8)}</code></td>
            <td>${getMonthName(run.payroll_month)} ${run.payroll_year}</td>
            <td>${run.office_name || 'All Offices'}</td>
            <td>${run.total_employees || 0}</td>
            <td>${formatCurrency(run.total_gross)}</td>
            <td>${formatCurrency(run.total_net)}</td>
            <td><span class="status-badge status-${run.status?.toLowerCase()}">${run.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewPayrollRun('${run.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    ${run.status === 'draft' ? `
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
        const officeFilter = document.getElementById('structureOfficeFilter')?.value || '';
        let url = '/hrms/payroll/structures';
        if (officeFilter) {
            url = `/hrms/payroll/structures/office/${officeFilter}`;
        }

        const response = await api.request(url);
        structures = response || [];
        updateSalaryStructuresTable();

        // Also load setup status to display office structure status
        await loadOfficeStructureStatus();
    } catch (error) {
        console.error('Error loading salary structures:', error);
    }
}

async function loadOfficeStructureStatus() {
    try {
        const response = await api.request('/hrms/dashboard/setup-status');
        if (response && response.office_salary_structure_status) {
            updateOfficeStructureStatusCards(response.office_salary_structure_status);
        }
    } catch (error) {
        console.error('Error loading office structure status:', error);
    }
}

function updateOfficeStructureStatusCards(statusList) {
    const container = document.getElementById('officeStructureStatus');
    if (!container) return;

    if (!statusList || statusList.length === 0) {
        container.innerHTML = '<p class="text-muted">No offices configured yet.</p>';
        return;
    }

    container.innerHTML = statusList.map(status => `
        <div class="office-status-card ${status.has_salary_structure ? 'complete' : 'incomplete'}">
            <div class="office-status-header">
                <span class="office-name">${status.office_name}</span>
                <span class="status-icon">
                    ${status.has_salary_structure ?
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' :
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
                    }
                </span>
            </div>
            <div class="office-status-details">
                <span class="structure-count">${status.structure_count} structure(s)</span>
                ${status.has_default_structure ?
                    '<span class="has-default">Default set</span>' :
                    '<span class="no-default">No default</span>'
                }
            </div>
        </div>
    `).join('');
}

function updateSalaryStructuresTable() {
    const tbody = document.getElementById('salaryStructuresTable');
    const searchTerm = document.getElementById('structureSearch')?.value?.toLowerCase() || '';

    const filtered = structures.filter(s =>
        (s.structure_name || '').toLowerCase().includes(searchTerm) ||
        (s.structure_code || '').toLowerCase().includes(searchTerm) ||
        (s.office_name || '').toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
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
            <td><strong>${s.office_name || 'N/A'}</strong></td>
            <td><strong>${s.structure_name}</strong></td>
            <td><code>${s.structure_code || '-'}</code></td>
            <td>${s.component_count || 0} component${s.component_count !== 1 ? 's' : ''}</td>
            <td>${s.employee_count || 0}</td>
            <td>
                ${s.is_default ?
                    '<span class="status-badge status-default">Default</span>' :
                    '<span class="text-muted">-</span>'
                }
            </td>
            <td><span class="status-badge status-${s.is_active ? 'active' : 'inactive'}">${s.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewStructureVersions('${s.id}')" title="Version History">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                    </button>
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
        const response = await api.request('/hrms/payroll/components');
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
        const name = c.component_name || c.name || '';
        const code = c.component_code || c.code || '';
        const type = c.component_type || c.category || '';
        const matchesSearch = name.toLowerCase().includes(searchTerm) ||
                             code.toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || type === typeFilter;
        return matchesSearch && matchesType;
    });

    const earnings = filtered.filter(c => (c.component_type || c.category) === 'earning');
    const deductions = filtered.filter(c => (c.component_type || c.category) === 'deduction');

    updateEarningsTable(earnings);
    updateDeductionsTable(deductions);
}

/**
 * Format component value based on calculation type
 */
function formatComponentValue(component) {
    const calcType = (component.calculation_type || component.calculationType || 'fixed').toLowerCase();

    if (calcType === 'percentage') {
        const value = component.percentage || component.percentage_of_basic || component.default_value || 0;
        if (!value) return '-';

        // Get the calculation base and format it nicely
        const base = component.calculation_base || 'basic';
        const baseLabel = base.toUpperCase();
        return `${value}% of ${baseLabel}`;
    } else if (calcType === 'fixed') {
        const value = component.fixed_amount || component.default_value || 0;
        if (value) {
            return `₹${Number(value).toLocaleString('en-IN')}`;
        }
        // For fixed type without a value, show descriptive text
        if (component.is_basic_component) {
            return '<span class="text-muted">Base component</span>';
        }
        // Check if it's a balance/remainder component (typically Special Allowance)
        const code = (component.component_code || '').toUpperCase();
        if (code === 'SA' || code === 'SPL' || code.includes('SPECIAL')) {
            return '<span class="text-muted">Balance amount</span>';
        }
        return '<span class="text-muted">Per structure</span>';
    } else if (calcType === 'balance' || calcType === 'remainder') {
        return '<span class="text-muted">Balance amount</span>';
    } else {
        const value = component.default_value || component.fixed_amount || component.percentage || 0;
        return value ? value.toString() : '-';
    }
}

function updateEarningsTable(earnings) {
    const tbody = document.getElementById('earningsTable');

    if (!earnings || earnings.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><p>No earnings components</p></td></tr>';
        return;
    }

    tbody.innerHTML = earnings.map(c => `
        <tr>
            <td><strong>${c.component_name || c.name}</strong></td>
            <td><code>${c.component_code || c.code}</code></td>
            <td>${c.calculation_type || c.calculationType || 'Fixed'}</td>
            <td>${formatComponentValue(c)}</td>
            <td>${(c.is_taxable !== undefined ? c.is_taxable : c.isTaxable) ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'active' : 'inactive'}">${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'Active' : 'Inactive'}</span></td>
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
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><p>No deduction components</p></td></tr>';
        return;
    }

    tbody.innerHTML = deductions.map(c => `
        <tr>
            <td><strong>${c.component_name || c.name}</strong></td>
            <td><code>${c.component_code || c.code}</code></td>
            <td>${c.calculation_type || c.calculationType || 'Fixed'}</td>
            <td>${formatComponentValue(c)}</td>
            <td>${(c.is_pre_tax !== undefined ? c.is_pre_tax : c.isPreTax) ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'active' : 'inactive'}">${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'Active' : 'Inactive'}</span></td>
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
        let url;

        if (hrmsRoles.isHRAdmin()) {
            // Use dedicated endpoints for better performance
            if (status === 'active') {
                url = '/hrms/payroll-processing/loans/active';
            } else if (status === 'pending') {
                url = '/hrms/payroll-processing/loans/pending';
            } else {
                // For 'completed', 'all', or empty - use main endpoint with status filter
                url = '/hrms/payroll-processing/loans';
                if (status && status !== 'all') {
                    url += `?status=${status}`;
                }
            }
        } else {
            // Regular users use my-loans endpoint
            url = '/hrms/payroll-processing/my-loans';
            if (status && status !== 'all') {
                url += `?status=${status}`;
            }
        }

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

    tbody.innerHTML = loans.map(loan => {
        const status = loan.status?.toLowerCase();
        const isAdmin = hrmsRoles.isHRAdmin();

        // Build action buttons based on status and role
        let actionButtons = `
            <button class="action-btn" onclick="viewLoan('${loan.id}')" title="View">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            </button>
        `;

        if (isAdmin && status === 'pending') {
            actionButtons += `
                <button class="action-btn success" onclick="approveLoan('${loan.id}')" title="Approve">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
                <button class="action-btn danger" onclick="showRejectLoanModal('${loan.id}')" title="Reject">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;
        } else if (isAdmin && status === 'approved') {
            actionButtons += `
                <button class="action-btn primary" onclick="showDisburseLoanModal('${loan.id}')" title="Disburse">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                </button>
            `;
        }

        return `
            <tr>
                <td class="employee-cell">
                    <div class="employee-info">
                        <div class="avatar">${getInitials(loan.employee_name || loan.employee_code)}</div>
                        <div class="details">
                            <span class="name">${loan.employee_name || loan.employee_code || 'Unknown'}</span>
                        </div>
                    </div>
                </td>
                <td>${formatLoanType(loan.loan_type)}</td>
                <td>${formatCurrency(loan.principal_amount)}</td>
                <td>${formatCurrency(loan.emi_amount)}</td>
                <td>${formatCurrency(loan.outstanding_amount)}</td>
                <td>${formatDate(loan.start_date)}</td>
                <td><span class="status-badge status-${status}">${loan.status}</span></td>
                <td>
                    <div class="action-buttons">${actionButtons}</div>
                </td>
            </tr>
        `;
    }).join('');
}

async function loadOffices() {
    try {
        const response = await api.request('/hrms/offices');
        offices = response || [];

        const selects = ['payrollOffice', 'runOffice', 'structureOfficeFilter', 'structureOffice', 'draftOffice', 'draftPayrollOffice'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                let firstOption;
                if (id === 'runOffice' || id === 'structureOfficeFilter' || id === 'draftOffice' || id === 'draftPayrollOffice') {
                    firstOption = '<option value="">All Offices</option>';
                } else if (id === 'structureOffice') {
                    firstOption = '<option value="">Select Office (Required)</option>';
                } else {
                    firstOption = '<option value="">Select Office</option>';
                }
                select.innerHTML = firstOption;
                offices.forEach(office => {
                    select.innerHTML += `<option value="${office.id}">${office.office_name}</option>`;
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
                select.innerHTML += `<option value="${emp.id}">${emp.first_name} ${emp.last_name}</option>`;
            });
        }
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

// Modal functions
function showSalaryStructureModal() {
    // Navigate to structures tab first
    document.querySelectorAll('.sidebar-btn[data-tab], .tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="salary-structures"]').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('salary-structures').classList.add('active');
}

function showCreateStructureModal() {
    document.getElementById('structureForm').reset();
    document.getElementById('structureId').value = '';
    document.getElementById('structureModalTitle').textContent = 'Create Salary Structure';
    document.getElementById('structureComponents').innerHTML = '';
    structureComponentCounter = 0; // Reset counter
    // Reset office dropdown
    const officeSelect = document.getElementById('structureOffice');
    if (officeSelect) officeSelect.value = '';
    // Reset is_default select
    const isDefaultSelect = document.getElementById('structureIsDefault');
    if (isDefaultSelect) isDefaultSelect.value = 'false';
    // Reset status to active for new structures
    const isActiveCheckbox = document.getElementById('structureIsActive');
    if (isActiveCheckbox) isActiveCheckbox.checked = true;
    document.getElementById('structureModal').classList.add('active');
}

async function editSalaryStructure(structureId) {
    try {
        showLoading();
        const structure = await api.request(`/hrms/payroll/structures/${structureId}`);

        if (!structure) {
            showToast('Structure not found', 'error');
            hideLoading();
            return;
        }

        document.getElementById('structureId').value = structure.id;
        document.getElementById('structureName').value = structure.structure_name || '';
        document.getElementById('structureCode').value = structure.structure_code || '';
        document.getElementById('structureDescription').value = structure.description || '';

        // Set office dropdown
        const officeSelect = document.getElementById('structureOffice');
        if (officeSelect && structure.office_id) {
            officeSelect.value = structure.office_id;
        }

        // Set is_default select
        const isDefaultSelect = document.getElementById('structureIsDefault');
        if (isDefaultSelect) {
            isDefaultSelect.value = structure.is_default ? 'true' : 'false';
        }

        // Set is_active checkbox
        const isActiveCheckbox = document.getElementById('structureIsActive');
        if (isActiveCheckbox) {
            isActiveCheckbox.checked = structure.is_active !== false; // Default to true if not set
        }

        // Load and populate structure components
        if (structure.components && structure.components.length > 0) {
            populateStructureComponents(structure.components);
        } else {
            document.getElementById('structureComponents').innerHTML = '';
            structureComponentCounter = 0;
        }

        document.getElementById('structureModalTitle').textContent = 'Edit Salary Structure';
        document.getElementById('structureModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading structure:', error);
        showToast('Failed to load structure details', 'error');
        hideLoading();
    }
}

async function saveSalaryStructure() {
    const form = document.getElementById('structureForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const officeId = document.getElementById('structureOffice')?.value;
    if (!officeId) {
        showToast('Please select an office for this salary structure', 'error');
        return;
    }

    // Get structure components
    const structureComponents = getStructureComponents();

    // Validate that at least one component is added with a value
    if (!structureComponents || structureComponents.length === 0) {
        showToast('Please add at least one salary component with values', 'error');
        return;
    }

    // Validate that all components have proper values
    const invalidComponents = structureComponents.filter(c => {
        if (c.calculation_type === 'percentage') {
            return !c.percentage || c.percentage <= 0;
        } else {
            return !c.fixed_amount || c.fixed_amount <= 0;
        }
    });

    if (invalidComponents.length > 0) {
        showToast('All components must have a value greater than 0', 'error');
        return;
    }

    // Validate that at least one earning component is present
    const hasEarningComponent = structureComponents.some(c => c.component_type === 'earning');
    if (!hasEarningComponent) {
        showToast('Salary structure must have at least one earning component (e.g., Basic Salary)', 'error');
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('structureId').value;
        const isDefaultSelect = document.getElementById('structureIsDefault');
        const isDefault = isDefaultSelect ? isDefaultSelect.value === 'true' : false;

        const data = {
            structure_name: document.getElementById('structureName').value,
            structure_code: document.getElementById('structureCode').value,
            description: document.getElementById('structureDescription').value,
            office_id: officeId,
            is_default: isDefault,
            is_active: document.getElementById('structureIsActive')?.checked !== false,
            components: structureComponents
        };

        if (id) {
            data.id = id;
            await api.request(`/hrms/payroll/structures/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/payroll/structures', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('structureModal');
        showToast(`Salary structure ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadSalaryStructures();
        hideLoading();
    } catch (error) {
        console.error('Error saving structure:', error);
        showToast(error.message || 'Failed to save salary structure', 'error');
        hideLoading();
    }
}

function showCreateComponentModal() {
    document.getElementById('componentForm').reset();
    document.getElementById('componentId').value = '';
    document.getElementById('componentModalTitle').textContent = 'Create Salary Component';
    // Reset status to active for new components
    const isActiveCheckbox = document.getElementById('componentIsActive');
    if (isActiveCheckbox) isActiveCheckbox.checked = true;
    // Reset is_basic_component to false for new components
    const isBasicCheckbox = document.getElementById('isBasicComponent');
    if (isBasicCheckbox) isBasicCheckbox.checked = false;
    document.getElementById('componentModal').classList.add('active');
    // Reset percentage fields visibility
    togglePercentageFields();
}

// Toggle percentage fields visibility based on calculation type
function togglePercentageFields() {
    const calcType = document.getElementById('calculationType').value;
    const percentageRow = document.getElementById('percentageFieldsRow');
    const percentageInput = document.getElementById('componentPercentage');

    if (calcType === 'percentage') {
        percentageRow.style.display = 'flex';
        percentageInput.required = true;
    } else {
        percentageRow.style.display = 'none';
        percentageInput.required = false;
        percentageInput.value = '';
    }
}

// Add event listener for calculation type change
document.addEventListener('DOMContentLoaded', function() {
    const calcTypeSelect = document.getElementById('calculationType');
    if (calcTypeSelect) {
        calcTypeSelect.addEventListener('change', togglePercentageFields);
    }
});

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
async function saveComponent() {
    const form = document.getElementById('componentForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('componentId').value;
        const calculationType = document.getElementById('calculationType').value;
        const data = {
            component_name: document.getElementById('componentName').value,
            component_code: document.getElementById('componentCode').value,
            component_type: document.getElementById('componentCategory').value,
            calculation_type: calculationType,
            is_taxable: document.getElementById('isTaxable').value === 'true',
            is_statutory: document.getElementById('isStatutory').value === 'true',
            description: document.getElementById('componentDescription').value,
            is_active: document.getElementById('componentIsActive')?.checked !== false,
            is_basic_component: document.getElementById('isBasicComponent')?.checked === true
        };

        // Add percentage fields if calculation type is percentage
        if (calculationType === 'percentage') {
            data.percentage = parseFloat(document.getElementById('componentPercentage').value) || 0;
            data.calculation_base = document.getElementById('calculationBase').value;
        }

        if (id) {
            data.id = id;
            await api.request(`/hrms/payroll/components/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/payroll/components', {
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
            loan_type: document.getElementById('loanType').value,
            principal_amount: parseFloat(document.getElementById('loanAmount').value),
            interest_rate: parseFloat(document.getElementById('interestRate').value) || 0,
            interest_calculation_type: document.getElementById('interestCalculationType').value || 'simple',
            emi_amount: parseFloat(document.getElementById('emiAmount').value),
            start_date: document.getElementById('loanStartDate').value,
            tenure_months: parseInt(document.getElementById('numberOfInstallments').value),
            reason: document.getElementById('loanReason').value
        };

        if (hrmsRoles.isHRAdmin()) {
            data.employee_id = document.getElementById('loanEmployee').value;
        }

        await api.request('/hrms/payroll-processing/loans', {
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

let currentLoanId = null;

async function viewLoan(loanId) {
    try {
        showLoading();
        currentLoanId = loanId;

        // Use the payroll-processing endpoint which is used elsewhere in the file
        const loan = await api.request(`/hrms/payroll-processing/loans/${loanId}`);

        if (!loan) {
            showToast('Loan not found', 'error');
            hideLoading();
            return;
        }

        // Build loan details HTML
        const detailsHtml = `
            <div class="loan-details-grid">
                <div class="detail-section">
                    <h4>Applicant Information</h4>
                    <div class="info-row">
                        <span class="label">Employee:</span>
                        <span class="value">${loan.employee_name || loan.employee_code || 'N/A'}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Employee ID:</span>
                        <span class="value">${loan.employee_code || 'N/A'}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Department:</span>
                        <span class="value">${loan.department_name || 'N/A'}</span>
                    </div>
                </div>

                <div class="detail-section">
                    <h4>Loan Details</h4>
                    <div class="info-row">
                        <span class="label">Loan Type:</span>
                        <span class="value">${formatLoanType(loan.loan_type)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Principal Amount:</span>
                        <span class="value">${formatCurrency(loan.principal_amount)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Interest Rate:</span>
                        <span class="value">${loan.interest_rate || 0}%</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Interest Type:</span>
                        <span class="value">${formatInterestCalculationType(loan.interest_calculation_type)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">EMI Amount:</span>
                        <span class="value">${formatCurrency(loan.emi_amount)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Tenure:</span>
                        <span class="value">${loan.tenure_months || 'N/A'} months</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Outstanding Amount:</span>
                        <span class="value">${formatCurrency(loan.outstanding_amount)}</span>
                    </div>
                </div>

                <div class="detail-section">
                    <h4>Status & Dates</h4>
                    <div class="info-row">
                        <span class="label">Status:</span>
                        <span class="value"><span class="status-badge status-${loan.status?.toLowerCase()}">${loan.status}</span></span>
                    </div>
                    <div class="info-row">
                        <span class="label">Applied Date:</span>
                        <span class="value">${formatDate(loan.applied_date || loan.created_at)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Start Date:</span>
                        <span class="value">${formatDate(loan.start_date)}</span>
                    </div>
                    ${loan.approved_date ? `
                    <div class="info-row">
                        <span class="label">Approved Date:</span>
                        <span class="value">${formatDate(loan.approved_date)}</span>
                    </div>` : ''}
                    ${loan.disbursed_date ? `
                    <div class="info-row">
                        <span class="label">Disbursed Date:</span>
                        <span class="value">${formatDate(loan.disbursed_date)}</span>
                    </div>` : ''}
                </div>

                ${loan.reason ? `
                <div class="detail-section full-width">
                    <h4>Reason</h4>
                    <p>${loan.reason}</p>
                </div>` : ''}

                ${loan.rejection_reason ? `
                <div class="detail-section full-width">
                    <h4>Rejection Reason</h4>
                    <p class="text-danger">${loan.rejection_reason}</p>
                </div>` : ''}

                ${(loan.status === 'active' || loan.status === 'disbursed' || loan.status === 'closed') ? `
                <div class="detail-section full-width repayment-schedule-section">
                    <h4>Repayment Schedule</h4>
                    ${generateRepaymentScheduleHtml(loan)}
                </div>` : ''}
            </div>
        `;

        document.getElementById('loanDetailsContent').innerHTML = detailsHtml;

        // Build action buttons based on status and role
        let actionsHtml = '';
        const status = loan.status?.toLowerCase();

        if (hrmsRoles.isHRAdmin()) {
            if (status === 'pending') {
                actionsHtml = `
                    <button type="button" class="btn btn-success" onclick="approveLoan('${loanId}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        Approve
                    </button>
                    <button type="button" class="btn btn-danger" onclick="showRejectLoanModal('${loanId}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                        Reject
                    </button>
                `;
            } else if (status === 'approved') {
                actionsHtml = `
                    <button type="button" class="btn btn-primary" onclick="showDisburseLoanModal('${loanId}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="1" x2="12" y2="23"></line>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        Disburse
                    </button>
                `;
            }
        }

        document.getElementById('loanActionsFooter').innerHTML = actionsHtml;

        document.getElementById('viewLoanModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading loan details:', error);
        showToast('Failed to load loan details', 'error');
        hideLoading();
    }
}

async function approveLoan(loanId) {
    const confirmed = await Confirm.show({
        title: 'Approve Loan',
        message: 'Are you sure you want to approve this loan application?',
        type: 'success',
        confirmText: 'Approve',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();
        await api.approveLoan(loanId);
        closeModal('viewLoanModal');
        showToast('Loan approved successfully', 'success');
        await loadLoans();
        hideLoading();
    } catch (error) {
        console.error('Error approving loan:', error);
        showToast(error.message || 'Failed to approve loan', 'error');
        hideLoading();
    }
}

function showRejectLoanModal(loanId) {
    document.getElementById('rejectLoanId').value = loanId;
    document.getElementById('rejectionReason').value = '';
    closeModal('viewLoanModal');
    document.getElementById('rejectLoanModal').classList.add('active');
}

async function confirmRejectLoan() {
    const loanId = document.getElementById('rejectLoanId').value;
    const reason = document.getElementById('rejectionReason').value.trim();

    if (!reason) {
        showToast('Please provide a rejection reason', 'error');
        return;
    }

    try {
        showLoading();
        await api.rejectLoan(loanId, reason);
        closeModal('rejectLoanModal');
        showToast('Loan rejected', 'success');
        await loadLoans();
        hideLoading();
    } catch (error) {
        console.error('Error rejecting loan:', error);
        showToast(error.message || 'Failed to reject loan', 'error');
        hideLoading();
    }
}

function showDisburseLoanModal(loanId) {
    document.getElementById('disburseLoanId').value = loanId;
    document.getElementById('disbursementMode').value = '';
    document.getElementById('disbursementReference').value = '';
    closeModal('viewLoanModal');
    document.getElementById('disburseLoanModal').classList.add('active');
}

async function confirmDisburseLoan() {
    const loanId = document.getElementById('disburseLoanId').value;
    const mode = document.getElementById('disbursementMode').value;
    const reference = document.getElementById('disbursementReference').value.trim();

    if (!mode) {
        showToast('Please select a disbursement mode', 'error');
        return;
    }

    try {
        showLoading();
        await api.disburseLoan(loanId, mode, reference);
        closeModal('disburseLoanModal');
        showToast('Loan disbursed successfully', 'success');
        await loadLoans();
        hideLoading();
    } catch (error) {
        console.error('Error disbursing loan:', error);
        showToast(error.message || 'Failed to disburse loan', 'error');
        hideLoading();
    }
}

async function viewPayslip(payslipId) {
    try {
        showLoading();
        currentPayslipId = payslipId;
        // Fetch with includeItems=true to get component items and location breakdowns
        const payslip = await api.request(`/hrms/payroll-processing/payslips/${payslipId}?includeItems=true`);

        // Populate payslipContent dynamically - matching draft payslip structure
        const contentDiv = document.getElementById('payslipContent');
        if (!contentDiv) {
            hideLoading();
            showToast('Payslip modal not found', 'error');
            return;
        }

        const items = payslip.items || [];

        // Group items by structure for compliance display
        const structureGroups = groupItemsByStructure(items);
        const hasMultipleStructures = structureGroups.length > 1;

        // Check for multi-location indicator
        const isMultiLocation = payslip.is_multi_location || false;
        const locationBreakdowns = payslip.location_breakdowns || [];

        // Build structure-wise breakdown HTML (matching draft payslip exactly)
        let structureBreakdownHtml = '';

        if (hasMultipleStructures) {
            structureBreakdownHtml = `
                <div style="margin-bottom: 1.5rem; padding: 0.75rem; background: var(--color-warning-light); border: 1px solid var(--color-warning); border-radius: 8px;">
                    <strong class="text-warning-dark">Mid-Period Structure Change</strong>
                    <p class="text-warning-dark" style="margin: 0.5rem 0 0 0; font-size: 0.85rem;">
                        This employee had a salary structure change during the pay period.
                        Components are shown separately for each structure for compliance purposes.
                    </p>
                </div>
            `;

            for (const group of structureGroups) {
                const periodText = group.period_start && group.period_end
                    ? `${formatDate(group.period_start)} - ${formatDate(group.period_end)}`
                    : '';

                const groupEarnings = group.items.filter(i => i.component_type === 'earning');
                const groupDeductions = group.items.filter(i => i.component_type === 'deduction');

                const groupEarningsTotal = groupEarnings.reduce((sum, i) => sum + (i.amount || 0), 0);
                const groupDeductionsTotal = groupDeductions.reduce((sum, i) => sum + (i.amount || 0), 0);

                structureBreakdownHtml += `
                    <div style="margin-bottom: 1.5rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-subtle);">
                        <div style="margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                            <h5 style="margin: 0; color: var(--brand-primary);">${group.structure_name || 'Salary Structure'}</h5>
                            ${periodText ? `<p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--text-muted);">Period: ${periodText}</p>` : ''}
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <h6 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-success);">Earnings</h6>
                                <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; color: var(--text-muted);">
                                            <th>Component</th>
                                            <th class="text-right">Amount</th>
                                            <th class="text-right">YTD</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${groupEarnings.length > 0
                                            ? groupEarnings.map(i => `
                                                <tr>
                                                    <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                                                    <td class="text-right">${formatCurrency(i.amount)}</td>
                                                    <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${formatCurrency(i.ytd_amount || 0)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="3" class="text-muted">No earnings</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${formatCurrency(groupEarningsTotal)}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <div>
                                <h6 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-danger);">Deductions</h6>
                                <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; color: var(--text-muted);">
                                            <th>Component</th>
                                            <th class="text-right">Amount</th>
                                            <th class="text-right">YTD</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${groupDeductions.length > 0
                                            ? groupDeductions.map(i => `
                                                <tr>
                                                    <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                                                    <td class="text-right">${formatCurrency(i.amount)}</td>
                                                    <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${formatCurrency(i.ytd_amount || 0)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="3" class="text-muted">No deductions</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${formatCurrency(groupDeductionsTotal)}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
            }

            // Add combined totals section for multi-structure
            structureBreakdownHtml += `
                <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 8px; border: 2px solid var(--border-color);">
                    <h5 style="margin: 0 0 1rem 0;">Combined Totals</h5>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Total Gross Earnings</span>
                                <span style="font-weight: 600; color: var(--color-success);">${formatCurrency(payslip.gross_earnings)}</span>
                            </div>
                            ${payslip.arrears > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Arrears Total</span>
                                <span style="font-weight: 600; color: var(--color-warning);">${formatCurrency(payslip.arrears)}</span>
                            </div>
                            ${payslip.arrears_breakdown && payslip.arrears_breakdown.length > 0 ? `
                            <div class="arrears-breakdown-section" style="margin-top: 0.5rem; padding: 0.5rem; background: rgba(var(--color-warning-rgb, 245, 158, 11), 0.08); border-radius: 6px; border-left: 3px solid var(--color-warning);">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                    <svg width="14" height="14" fill="currentColor" style="color: var(--color-warning);"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3.5a.5.5 0 0 1-.5-.5v-3.5A.5.5 0 0 1 8 4z"/></svg>
                                    <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-warning);">Arrears by Period (Audit)</span>
                                </div>
                                <table class="data-table" style="width: 100%; font-size: 0.75rem;">
                                    <thead>
                                        <tr style="background: transparent;">
                                            <th style="padding: 0.25rem 0.5rem; text-align: left; font-weight: 500;">Period</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: left; font-weight: 500;">Type</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">Old</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">New</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">Arrears</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${payslip.arrears_breakdown.map(arr => `
                                            <tr>
                                                <td style="padding: 0.25rem 0.5rem;">${arr.period_display || getMonthName(arr.payroll_month) + ' ' + arr.payroll_year}</td>
                                                <td style="padding: 0.25rem 0.5rem;">
                                                    <span class="badge ${arr.source_type === 'ctc_revision' ? 'badge-info' : 'badge-secondary'}" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">
                                                        ${arr.source_type === 'ctc_revision' ? 'CTC Revision' : 'Structure'}
                                                    </span>
                                                    ${arr.source_type === 'ctc_revision' && arr.revision_type ? `
                                                        <span style="font-size: 0.6rem; color: var(--text-muted); display: block;">${formatRevisionType(arr.revision_type)}</span>
                                                    ` : ''}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--text-muted);">
                                                    ${arr.source_type === 'ctc_revision' && arr.old_ctc ? formatCurrency(arr.old_ctc) + '/yr' : formatCurrency(arr.old_gross)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--color-success);">
                                                    ${arr.source_type === 'ctc_revision' && arr.new_ctc ? formatCurrency(arr.new_ctc) + '/yr' : formatCurrency(arr.new_gross)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-warning);">${formatCurrency(arr.arrears_amount)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            ` : ''}
                            ` : ''}
                        </div>
                        <div>
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Total Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${formatCurrency(payslip.total_deductions)}</span>
                            </div>
                            ${payslip.loan_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Loan Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${formatCurrency(payslip.loan_deductions)}</span>
                            </div>
                            ` : ''}
                            ${payslip.voluntary_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Voluntary Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${formatCurrency(payslip.voluntary_deductions)}</span>
                            </div>
                            ${payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0 ? `
                            <div class="vd-breakdown-section" style="margin: 0.5rem 0; padding: 0.5rem; background: rgba(59, 130, 246, 0.08); border-radius: 6px; border-left: 3px solid #3b82f6;">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                    <svg width="14" height="14" fill="currentColor" style="color: #3b82f6;"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445z"/></svg>
                                    <span style="font-size: 0.75rem; font-weight: 600; color: #3b82f6;">Voluntary Deduction Details</span>
                                </div>
                                <table class="data-table" style="width: 100%; font-size: 0.75rem;">
                                    <thead>
                                        <tr style="background: transparent;">
                                            <th style="padding: 0.25rem 0.5rem; text-align: left; font-weight: 500;">Type</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">Full Amount</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 500;">Deducted</th>
                                            <th style="padding: 0.25rem 0.5rem; text-align: left; font-weight: 500;">Period</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${payslip.voluntary_deduction_items.map(vd => `
                                            <tr>
                                                <td style="padding: 0.25rem 0.5rem;">
                                                    <span style="font-weight: 500;">${vd.deduction_type_name}</span>
                                                    <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">${vd.deduction_type_code}</span>
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--text-muted);">
                                                    ${formatCurrency(vd.full_amount)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-danger);">
                                                    ${formatCurrency(vd.deducted_amount)}
                                                    ${vd.is_prorated ? `<span style="font-size: 0.6rem; color: var(--text-muted); display: block;">(${(vd.proration_factor * 100).toFixed(0)}%)</span>` : ''}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; font-size: 0.7rem; color: var(--text-muted);">
                                                    ${vd.is_prorated ? `${vd.days_applicable || '-'}/${vd.total_days_in_period || '-'} days` : 'Full Month'}
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            ` : ''}
                            ` : ''}
                            <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; margin-top: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; padding-left: 0.5rem; padding-right: 0.5rem;">
                                <span style="font-weight: 700;">Net Pay</span>
                                <span style="font-weight: 700; color: var(--brand-primary); font-size: 1.1rem;">${formatCurrency(payslip.net_pay)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Single structure - use original layout with YTD
            const earnings = items.filter(i => i.component_type === 'earning');
            const deductions = items.filter(i => i.component_type === 'deduction');

            const earningsHtml = earnings.length > 0 ?
                earnings.map(i => `<tr><td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td><td class="text-right">${formatCurrency(i.amount)}</td><td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${formatCurrency(i.ytd_amount || 0)}</td></tr>`).join('') :
                '<tr><td colspan="3" class="text-muted">No earnings</td></tr>';

            const deductionsHtml = deductions.length > 0 ?
                deductions.map(i => `<tr><td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td><td class="text-right">${formatCurrency(i.amount)}</td><td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${formatCurrency(i.ytd_amount || 0)}</td></tr>`).join('') :
                '<tr><td colspan="3" class="text-muted">No deductions</td></tr>';

            // Arrears breakdown for single structure
            const arrearsBreakdownHtml = payslip.arrears > 0 && payslip.arrears_breakdown && payslip.arrears_breakdown.length > 0 ? `
                <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(var(--color-warning-rgb, 245, 158, 11), 0.08); border-radius: 8px; border-left: 3px solid var(--color-warning);">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <svg width="14" height="14" fill="currentColor" style="color: var(--color-warning);"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3.5a.5.5 0 0 1-.5-.5v-3.5A.5.5 0 0 1 8 4z"/></svg>
                        <span style="font-size: 0.8rem; font-weight: 600; color: var(--color-warning);">Arrears Breakdown (₹${formatCurrency(payslip.arrears)} total)</span>
                    </div>
                    <table class="data-table" style="width: 100%; font-size: 0.8rem;">
                        <thead>
                            <tr style="background: transparent;">
                                <th style="padding: 0.25rem 0.5rem; text-align: left;">Period</th>
                                <th style="padding: 0.25rem 0.5rem; text-align: left;">Type</th>
                                <th style="padding: 0.25rem 0.5rem; text-align: right;">Old</th>
                                <th style="padding: 0.25rem 0.5rem; text-align: right;">New</th>
                                <th style="padding: 0.25rem 0.5rem; text-align: right;">Arrears</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${payslip.arrears_breakdown.map(arr => `
                                <tr>
                                    <td style="padding: 0.25rem 0.5rem;">${arr.period_display || getMonthName(arr.payroll_month) + ' ' + arr.payroll_year}</td>
                                    <td style="padding: 0.25rem 0.5rem;">
                                        <span class="badge ${arr.source_type === 'ctc_revision' ? 'badge-info' : 'badge-secondary'}" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">
                                            ${arr.source_type === 'ctc_revision' ? 'CTC Revision' : 'Structure'}
                                        </span>
                                    </td>
                                    <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--text-muted);">
                                        ${arr.source_type === 'ctc_revision' && arr.old_ctc ? formatCurrency(arr.old_ctc) + '/yr' : formatCurrency(arr.old_gross)}
                                    </td>
                                    <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--color-success);">
                                        ${arr.source_type === 'ctc_revision' && arr.new_ctc ? formatCurrency(arr.new_ctc) + '/yr' : formatCurrency(arr.new_gross)}
                                    </td>
                                    <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-warning);">${formatCurrency(arr.arrears_amount)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '';

            structureBreakdownHtml = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div>
                        <h5 style="margin: 0 0 0.75rem 0; color: var(--color-success);">Earnings</h5>
                        <table class="data-table" style="width: 100%;">
                            <thead>
                                <tr style="font-size: 0.8rem; color: var(--text-muted);">
                                    <th>Component</th>
                                    <th class="text-right">Amount</th>
                                    <th class="text-right">YTD</th>
                                </tr>
                            </thead>
                            <tbody>${earningsHtml}</tbody>
                            <tfoot>
                                <tr style="font-weight: 600; border-top: 2px solid var(--border-color);">
                                    <td>Total Gross</td>
                                    <td class="text-right">${formatCurrency(payslip.gross_earnings)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div>
                        <h5 style="margin: 0 0 0.75rem 0; color: var(--color-danger);">Deductions</h5>
                        <table class="data-table" style="width: 100%;">
                            <thead>
                                <tr style="font-size: 0.8rem; color: var(--text-muted);">
                                    <th>Component</th>
                                    <th class="text-right">Amount</th>
                                    <th class="text-right">YTD</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${deductionsHtml}
                                ${payslip.loan_deductions > 0 ? `<tr><td>Loan EMI</td><td class="text-right">${formatCurrency(payslip.loan_deductions)}</td><td></td></tr>` : ''}
                                ${payslip.voluntary_deductions > 0 && payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0 ?
                                    payslip.voluntary_deduction_items.map(vd => `
                                        <tr>
                                            <td>
                                                ${vd.deduction_type_name}
                                                ${vd.is_prorated ? `<span style="font-size:0.7rem;color:var(--text-muted);"> (${vd.days_applicable || '-'}/${vd.total_days_in_period || '-'} days)</span>` : ''}
                                            </td>
                                            <td class="text-right">${formatCurrency(vd.deducted_amount)}</td>
                                            <td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">
                                                ${vd.is_prorated ? `${(vd.proration_factor * 100).toFixed(0)}%` : ''}
                                            </td>
                                        </tr>
                                    `).join('')
                                : ''}
                            </tbody>
                            <tfoot>
                                <tr style="font-weight: 600; border-top: 2px solid var(--border-color);">
                                    <td>Total Deductions</td>
                                    <td class="text-right">${formatCurrency(payslip.total_deductions + (payslip.loan_deductions || 0) + (payslip.voluntary_deductions || 0))}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
                ${arrearsBreakdownHtml}
            `;
        }

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

        contentDiv.innerHTML = `
            <div class="payslip-header" style="margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin: 0 0 0.25rem 0; font-size: 1rem;">${payslip.employee_name || 'Employee'} ${multiLocationBadge}</h4>
                    <p style="margin: 0; color: var(--text-muted); font-size: 0.75rem;">Payslip - ${formatDate(payslip.pay_period_start)} to ${formatDate(payslip.pay_period_end)}</p>
                </div>
                <div style="padding: 0.5rem 1rem; background: var(--brand-primary); color: var(--text-inverse); border-radius: 6px; text-align: right;">
                    <div style="font-size: 0.65rem; opacity: 0.9;">Net Pay</div>
                    <div style="font-size: 1.1rem; font-weight: 700;">${formatCurrency(payslip.net_pay)}</div>
                </div>
            </div>

            <div class="payslip-summary" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-bottom: 0.75rem;">
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">Employee ID</div>
                    <div style="font-size: 0.9rem; font-weight: 600;">${payslip.employee_code || 'N/A'}</div>
                </div>
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">Department</div>
                    <div style="font-size: 0.9rem; font-weight: 600;">${payslip.department_name || 'N/A'}</div>
                </div>
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">Working Days</div>
                    <div style="font-size: 0.9rem; font-weight: 600;">${payslip.total_working_days || 0}</div>
                </div>
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">Days Worked</div>
                    <div style="font-size: 0.9rem; font-weight: 600;">${payslip.days_worked || 0}</div>
                </div>
            </div>

            ${structureBreakdownHtml}
        `;

        // Handle multi-location breakdown display
        const locationSection = document.getElementById('locationBreakdownSection');
        const locationCards = document.getElementById('locationCards');

        if (isMultiLocation && locationBreakdowns.length > 0) {
            locationSection.style.display = 'block';

            locationCards.innerHTML = locationBreakdowns.map(loc => {
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
                    <div class="location-card">
                        <div class="location-header">
                            <div class="location-name">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                                    <polyline points="9 22 9 12 15 12 15 22"></polyline>
                                </svg>
                                ${officeName}
                            </div>
                            <span class="location-code">${officeCode}</span>
                        </div>
                        <div class="location-period">
                            ${formatDate(periodStart)} - ${formatDate(periodEnd)}
                        </div>
                        <div class="location-stats">
                            <div class="loc-stat">
                                <span class="loc-value">${daysWorked}</span>
                                <span class="loc-label">Days</span>
                            </div>
                            <div class="loc-stat">
                                <span class="loc-value">${(prorationFactor * 100).toFixed(0)}%</span>
                                <span class="loc-label">Proration</span>
                            </div>
                            <div class="loc-stat">
                                <span class="loc-value">${formatCurrency(grossEarnings)}</span>
                                <span class="loc-label">Gross</span>
                            </div>
                        </div>
                        ${taxItems.length > 0 ? `
                            <div class="location-taxes">
                                <div class="tax-label">Location Taxes: ${formatCurrency(locationTaxes)}</div>
                                ${taxItems.map(tax => `
                                    <div class="tax-item">
                                        <span>${tax.tax_name || tax.taxName} ${tax.jurisdiction_code ? `(${tax.jurisdiction_code})` : ''}</span>
                                        <span>${formatCurrency(tax.tax_amount || tax.taxAmount)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                        <div class="location-net">
                            Net: ${formatCurrency(netPay)}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            locationSection.style.display = 'none';
        }

        // Handle payslip status and finalize button visibility
        const payslipStatus = payslip.status || payslip.Status || 'generated';
        const statusInfo = document.getElementById('payslipStatusInfo');
        const finalizeBtn = document.getElementById('finalizePayslipBtn');

        // Display status info
        const statusBadgeClass = getPayslipStatusBadgeClass(payslipStatus);
        statusInfo.innerHTML = `
            <span class="status-label">Status:</span>
            <span class="status-badge ${statusBadgeClass}">${formatPayslipStatus(payslipStatus)}</span>
        `;

        // Show finalize button only for non-finalized payslips and if user has admin role
        const canFinalize = payslipStatus !== 'finalized' && payslipStatus !== 'paid' && hrmsRoles.isHRAdmin();
        finalizeBtn.style.display = canFinalize ? 'inline-flex' : 'none';

        document.getElementById('payslipModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading payslip:', error);
        showToast('Failed to load payslip', 'error');
        hideLoading();
    }
}

function getPayslipStatusBadgeClass(status) {
    switch (status?.toLowerCase()) {
        case 'generated':
        case 'draft':
            return 'badge-warning';
        case 'finalized':
            return 'badge-success';
        case 'paid':
            return 'badge-info';
        case 'cancelled':
            return 'badge-danger';
        default:
            return 'badge-secondary';
    }
}

function formatPayslipStatus(status) {
    if (!status) return 'Generated';
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

async function finalizePayslip() {
    if (!currentPayslipId) {
        showToast('No payslip selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Finalize Payslip',
        message: 'Finalize this payslip?\n\nOnce finalized, the payslip cannot be modified. This action cannot be undone.',
        type: 'warning',
        confirmText: 'Finalize',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-processing/payslips/${currentPayslipId}/finalize`, {
            method: 'POST'
        });

        if (result && !result.error) {
            showToast('Payslip finalized successfully!', 'success');
            // Hide finalize button after success
            document.getElementById('finalizePayslipBtn').style.display = 'none';
            // Update status display
            const statusInfo = document.getElementById('payslipStatusInfo');
            statusInfo.innerHTML = `
                <span class="status-label">Status:</span>
                <span class="status-badge badge-success">Finalized</span>
            `;
            // Refresh the payslip data if needed
            await loadAllPayslips();
            await loadPayrollDrafts();
        } else {
            showToast(result?.message || result?.error || 'Failed to finalize payslip', 'error');
        }
        hideLoading();
    } catch (error) {
        console.error('Error finalizing payslip:', error);
        showToast(error.message || error.error || 'Failed to finalize payslip', 'error');
        hideLoading();
    }
}

// All Payslips storage
let allPayslips = [];

async function loadAllPayslips() {
    try {
        showLoading();
        const year = document.getElementById('allPayslipsYear')?.value || new Date().getFullYear();
        const month = document.getElementById('allPayslipsMonth')?.value || '';
        const officeId = document.getElementById('allPayslipsOffice')?.value || '';
        const departmentId = document.getElementById('allPayslipsDepartment')?.value || '';
        const search = document.getElementById('allPayslipsSearch')?.value || '';

        // Build query parameters
        let params = [];
        if (year) params.push(`year=${year}`);
        if (month) params.push(`month=${month}`);
        if (officeId) params.push(`officeId=${officeId}`);
        if (departmentId) params.push(`departmentId=${departmentId}`);
        if (search) params.push(`search=${encodeURIComponent(search)}`);

        const queryString = params.length > 0 ? `?${params.join('&')}` : '';
        const response = await api.request(`/hrms/payroll-processing/payslips${queryString}`);

        allPayslips = Array.isArray(response) ? response : (response.payslips || response.data || []);
        updateAllPayslipsTable();
        updateAllPayslipsStats();
        hideLoading();
    } catch (error) {
        console.error('Error loading all payslips:', error);
        showToast('Failed to load payslips', 'error');
        allPayslips = [];
        updateAllPayslipsTable();
        updateAllPayslipsStats();
        hideLoading();
    }
}

function updateAllPayslipsTable() {
    const tbody = document.getElementById('allPayslipsTable');
    if (!tbody) return;

    if (allPayslips.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="9">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                            <line x1="1" y1="10" x2="23" y2="10"></line>
                        </svg>
                        <p>No payslips found for the selected filters</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = allPayslips.map(p => {
        const employeeName = p.employee_name || p.employeeName || 'N/A';
        const employeeCode = p.employee_code || p.employeeCode || 'N/A';
        const departmentName = p.department_name || p.departmentName || 'N/A';
        const month = p.payroll_month || p.month || p.payrollMonth || '-';
        const year = p.payroll_year || p.year || p.payrollYear || '-';
        const grossSalary = p.gross_earnings || p.grossSalary || p.gross || 0;
        const deductions = p.total_deductions || p.totalDeductions || p.deductions || 0;
        const netSalary = p.net_pay || p.netSalary || p.net || 0;
        const status = p.status || 'generated';
        const statusClass = getPayslipStatusBadgeClass(status);

        return `
            <tr>
                <td>${employeeName}</td>
                <td>${employeeCode}</td>
                <td>${departmentName}</td>
                <td>${getMonthName(month)} ${year}</td>
                <td>${formatCurrency(grossSalary)}</td>
                <td>${formatCurrency(deductions)}</td>
                <td>${formatCurrency(netSalary)}</td>
                <td><span class="status-badge ${statusClass}">${formatPayslipStatus(status)}</span></td>
                <td>
                    <button class="action-btn" onclick="viewPayslip('${p.id}')" title="View Payslip">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </td>
            </tr>`;
    }).join('');
}

function updateAllPayslipsStats() {
    const totalCount = allPayslips.length;
    const totalGross = allPayslips.reduce((sum, p) => sum + (p.gross_earnings || p.grossSalary || p.gross || 0), 0);
    const totalNet = allPayslips.reduce((sum, p) => sum + (p.net_pay || p.netSalary || p.net || 0), 0);
    const avgNet = totalCount > 0 ? totalNet / totalCount : 0;

    const totalCountEl = document.getElementById('totalPayslipsCount');
    const totalGrossEl = document.getElementById('totalGrossAmount');
    const totalNetEl = document.getElementById('totalNetAmount');
    const avgNetEl = document.getElementById('avgNetSalary');

    if (totalCountEl) totalCountEl.textContent = totalCount;
    if (totalGrossEl) totalGrossEl.textContent = formatCurrency(totalGross);
    if (totalNetEl) totalNetEl.textContent = formatCurrency(totalNet);
    if (avgNetEl) avgNetEl.textContent = formatCurrency(avgNet);
}

async function downloadPayslip() {
    if (currentPayslipId) {
        await downloadPayslipById(currentPayslipId);
    }
}

async function downloadPayslipById(payslipId) {
    try {
        showToast('Generating PDF...', 'info');

        // Fetch payslip data with items
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${CONFIG.hrmsApiBaseUrl}/payroll-processing/payslips/${payslipId}?includeItems=true`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch payslip data');
        }

        const payslip = await response.json();

        // Generate PDF using jsPDF directly
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        const pageWidth = 210;
        const pageHeight = 297;
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);
        let y = margin;

        // Colors
        const primaryColor = [26, 115, 232];  // #1a73e8
        const greenColor = [34, 197, 94];     // #22c55e
        const redColor = [239, 68, 68];       // #ef4444
        const grayColor = [100, 116, 139];    // #64748b
        const darkColor = [15, 23, 42];       // #0f172a

        // Helper to add colored rectangle
        const addRect = (x, y, w, h, color, fill = true) => {
            doc.setFillColor(...color);
            if (fill) doc.rect(x, y, w, h, 'F');
        };

        // Header background
        addRect(0, 0, pageWidth, 35, primaryColor);

        // Company name
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('HyperDroid', margin, 18);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('HUMAN RESOURCE MANAGEMENT', margin, 25);

        // Payslip month - right side
        const payMonth = payslip.payroll_month && payslip.payroll_year
            ? new Date(payslip.payroll_year, payslip.payroll_month - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
            : 'N/A';
        doc.setFontSize(8);
        doc.text('PAYSLIP', pageWidth - margin - 30, 15);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(payMonth, pageWidth - margin - 30, 23);

        y = 42;

        // Payslip info bar
        addRect(0, 35, pageWidth, 12, [241, 245, 249]);
        doc.setTextColor(...grayColor);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('Payslip No:', margin, 42);
        doc.setTextColor(...primaryColor);
        doc.setFont('helvetica', 'bold');
        doc.text(payslip.payslip_number || 'N/A', margin + 22, 42);

        const periodStart = payslip.pay_period_start ? new Date(payslip.pay_period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
        const periodEnd = payslip.pay_period_end ? new Date(payslip.pay_period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
        doc.setTextColor(...grayColor);
        doc.setFont('helvetica', 'normal');
        doc.text(`Pay Period: ${periodStart} to ${periodEnd}`, pageWidth - margin - 70, 42);

        y = 55;

        // Employee Details Section
        doc.setTextColor(...darkColor);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('EMPLOYEE DETAILS', margin, y);
        doc.setDrawColor(...primaryColor);
        doc.setLineWidth(0.5);
        doc.line(margin, y + 2, margin + 40, y + 2);

        y += 10;
        const colWidth = contentWidth / 4;

        // Employee details grid
        const details = [
            { label: 'Employee Name', value: payslip.employee_name || 'N/A' },
            { label: 'Employee ID', value: payslip.employee_code || 'N/A' },
            { label: 'Department', value: payslip.department_name || 'N/A' },
            { label: 'Designation', value: payslip.designation_name || 'N/A' }
        ];

        details.forEach((d, i) => {
            const x = margin + (i * colWidth);
            doc.setTextColor(...grayColor);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(d.label.toUpperCase(), x, y);
            doc.setTextColor(...darkColor);
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text(d.value, x, y + 6);
        });

        y += 20;

        // Attendance Summary
        addRect(margin, y, contentWidth, 22, [254, 249, 195]);
        doc.setDrawColor(253, 224, 71);
        doc.setLineWidth(0.3);
        doc.rect(margin, y, contentWidth, 22, 'S');

        const attCols = [
            { label: 'Working Days', value: (payslip.working_days || 0).toString(), color: [113, 63, 18] },
            { label: 'Days Worked', value: (payslip.days_worked || 0).toString(), color: [22, 101, 52] },
            { label: 'LOP Days', value: (payslip.lop_days || 0).toString(), color: (payslip.lop_days || 0) > 0 ? [220, 38, 38] : [22, 101, 52] },
            { label: 'Status', value: (payslip.status || 'N/A').charAt(0).toUpperCase() + (payslip.status || '').slice(1), color: [22, 101, 52] }
        ];

        const attColWidth = contentWidth / 4;
        attCols.forEach((col, i) => {
            const x = margin + (i * attColWidth) + (attColWidth / 2);
            doc.setTextColor(133, 77, 14);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.text(col.label.toUpperCase(), x, y + 7, { align: 'center' });
            doc.setTextColor(...col.color);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(col.value, x, y + 16, { align: 'center' });
        });

        y += 30;

        // Earnings and Deductions side by side
        const tableWidth = (contentWidth - 10) / 2;
        const earnings = (payslip.items || []).filter(i => i.component_type === 'earning');
        const deductions = (payslip.items || []).filter(i => i.component_type === 'deduction');

        // Earnings Table
        let earningsY = y;
        addRect(margin, earningsY, tableWidth, 10, greenColor);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('EARNINGS', margin + 5, earningsY + 7);
        earningsY += 10;

        earnings.forEach((e, i) => {
            const bgColor = i % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
            addRect(margin, earningsY, tableWidth, 8, bgColor);
            doc.setTextColor(...darkColor);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.text(e.component_name, margin + 3, earningsY + 5.5);
            doc.setTextColor(...[5, 150, 105]);
            doc.setFont('helvetica', 'bold');
            doc.text(`₹${formatNumber(e.amount)}`, margin + tableWidth - 5, earningsY + 5.5, { align: 'right' });
            earningsY += 8;
        });

        // Earnings Total
        addRect(margin, earningsY, tableWidth, 10, [220, 252, 231]);
        doc.setDrawColor(...greenColor);
        doc.setLineWidth(0.5);
        doc.line(margin, earningsY, margin + tableWidth, earningsY);
        doc.setTextColor(22, 101, 52);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Total Earnings', margin + 3, earningsY + 7);
        doc.text(`₹${formatNumber(payslip.gross_earnings || 0)}`, margin + tableWidth - 5, earningsY + 7, { align: 'right' });

        // Deductions Table
        let deductionsY = y;
        const dedX = margin + tableWidth + 10;
        addRect(dedX, deductionsY, tableWidth, 10, redColor);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('DEDUCTIONS', dedX + 5, deductionsY + 7);
        deductionsY += 10;

        deductions.forEach((d, i) => {
            const bgColor = i % 2 === 0 ? [255, 255, 255] : [254, 242, 242];
            addRect(dedX, deductionsY, tableWidth, 8, bgColor);
            doc.setTextColor(...darkColor);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.text(d.component_name, dedX + 3, deductionsY + 5.5);
            doc.setTextColor(220, 38, 38);
            doc.setFont('helvetica', 'bold');
            doc.text(`₹${formatNumber(d.amount)}`, dedX + tableWidth - 5, deductionsY + 5.5, { align: 'right' });
            deductionsY += 8;
        });

        // Deductions Total
        addRect(dedX, deductionsY, tableWidth, 10, [254, 226, 226]);
        doc.setDrawColor(...redColor);
        doc.setLineWidth(0.5);
        doc.line(dedX, deductionsY, dedX + tableWidth, deductionsY);
        doc.setTextColor(153, 27, 27);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Total Deductions', dedX + 3, deductionsY + 7);
        doc.text(`₹${formatNumber(payslip.total_deductions || 0)}`, dedX + tableWidth - 5, deductionsY + 7, { align: 'right' });

        y = Math.max(earningsY, deductionsY) + 20;

        // Net Pay Section
        addRect(margin, y, contentWidth, 35, primaryColor);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('NET PAY', pageWidth / 2, y + 10, { align: 'center' });
        doc.setFontSize(28);
        doc.setFont('helvetica', 'bold');
        doc.text(`₹${formatNumber(payslip.net_pay || 0)}`, pageWidth / 2, y + 24, { align: 'center' });

        const netPayInWords = numberToWords(payslip.net_pay || 0);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.text(`${netPayInWords} Only`, pageWidth / 2, y + 32, { align: 'center' });

        y += 45;

        // Footer
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(margin, y, pageWidth - margin, y);
        y += 8;
        doc.setTextColor(...grayColor);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text('This is a computer-generated payslip and does not require a signature.', margin, y);
        doc.setFontSize(7);
        const genDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        doc.text(`Generated on ${genDate}`, margin, y + 5);
        doc.setFont('helvetica', 'bold');
        doc.text('HyperDroid HRMS', pageWidth - margin, y + 3, { align: 'right' });

        // Save PDF
        doc.save(`payslip_${payslip.payslip_number || payslipId}.pdf`);
        showToast('Payslip downloaded successfully', 'success');
    } catch (error) {
        console.error('Error downloading payslip:', error);
        showToast('Failed to download payslip', 'error');
    }
}

// Helper function to format numbers with Indian comma separators
function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    const n = parseFloat(num);
    if (isNaN(n)) return '0';
    // Round to 2 decimal places
    const rounded = Math.round(n * 100) / 100;
    // Use Indian locale formatting (1,00,000 format)
    return rounded.toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function generatePayslipPdfContent(payslip) {
    const earnings = (payslip.items || []).filter(i => i.component_type === 'earning');
    const deductions = (payslip.items || []).filter(i => i.component_type === 'deduction');

    // Format earnings rows
    const earningsRows = earnings.map((e, i) => `
        <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="padding: 10px 12px; font-size: 12px; color: #374151; border-bottom: 1px solid #e5e7eb;">${e.component_name}</td>
            <td style="padding: 10px 12px; text-align: right; font-size: 12px; color: #059669; font-weight: 600; border-bottom: 1px solid #e5e7eb;">₹${formatNumber(e.amount)}</td>
        </tr>
    `).join('');

    // Format deductions rows
    const deductionsRows = deductions.map((d, i) => `
        <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#fef2f2'};">
            <td style="padding: 10px 12px; font-size: 12px; color: #374151; border-bottom: 1px solid #e5e7eb;">${d.component_name}</td>
            <td style="padding: 10px 12px; text-align: right; font-size: 12px; color: #dc2626; font-weight: 600; border-bottom: 1px solid #e5e7eb;">₹${formatNumber(d.amount)}</td>
        </tr>
    `).join('');

    const periodStart = payslip.pay_period_start ? new Date(payslip.pay_period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
    const periodEnd = payslip.pay_period_end ? new Date(payslip.pay_period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
    const payMonth = payslip.payroll_month && payslip.payroll_year
        ? new Date(payslip.payroll_year, payslip.payroll_month - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        : `${periodStart} - ${periodEnd}`;

    // Convert net pay to words
    const netPayInWords = numberToWords(payslip.net_pay || 0);
    const generatedDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `
        <div style="font-family: Arial, sans-serif; width: 700px; margin: 0 auto; background: #ffffff; padding: 0;">

            <!-- Header -->
            <table style="width: 100%; background: #1a73e8; padding: 0; border-collapse: collapse;">
                <tr>
                    <td style="padding: 20px 25px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="vertical-align: middle;">
                                    <div style="color: white; font-size: 24px; font-weight: bold; margin: 0;">HyperDroid</div>
                                    <div style="color: rgba(255,255,255,0.8); font-size: 11px; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px;">Human Resource Management</div>
                                </td>
                                <td style="text-align: right; vertical-align: middle;">
                                    <div style="background: rgba(255,255,255,0.2); padding: 10px 16px; border-radius: 6px; display: inline-block;">
                                        <div style="color: rgba(255,255,255,0.8); font-size: 10px; text-transform: uppercase;">Payslip</div>
                                        <div style="color: white; font-size: 16px; font-weight: bold; margin-top: 2px;">${payMonth}</div>
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>

            <!-- Payslip Info Bar -->
            <table style="width: 100%; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; border-collapse: collapse;">
                <tr>
                    <td style="padding: 10px 25px;">
                        <span style="color: #64748b; font-size: 11px;">Payslip No: </span>
                        <span style="background: #1a73e8; color: white; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: bold;">${payslip.payslip_number || 'N/A'}</span>
                    </td>
                    <td style="padding: 10px 25px; text-align: right;">
                        <span style="color: #64748b; font-size: 11px;">Pay Period: </span>
                        <span style="color: #1e293b; font-size: 11px; font-weight: 600;">${periodStart} to ${periodEnd}</span>
                    </td>
                </tr>
            </table>

            <!-- Employee Details -->
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; padding: 0 25px;">
                <tr>
                    <td colspan="4" style="padding: 0 25px 10px 25px;">
                        <div style="font-size: 12px; font-weight: bold; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #1a73e8; padding-bottom: 6px;">Employee Details</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px 25px; width: 25%;">
                        <div style="color: #64748b; font-size: 10px; text-transform: uppercase;">Employee Name</div>
                        <div style="color: #0f172a; font-size: 13px; font-weight: 600; margin-top: 3px;">${payslip.employee_name || 'N/A'}</div>
                    </td>
                    <td style="padding: 8px 10px; width: 25%;">
                        <div style="color: #64748b; font-size: 10px; text-transform: uppercase;">Employee ID</div>
                        <div style="color: #0f172a; font-size: 13px; font-weight: 600; margin-top: 3px;">${payslip.employee_code || 'N/A'}</div>
                    </td>
                    <td style="padding: 8px 10px; width: 25%;">
                        <div style="color: #64748b; font-size: 10px; text-transform: uppercase;">Department</div>
                        <div style="color: #0f172a; font-size: 13px; font-weight: 600; margin-top: 3px;">${payslip.department_name || 'N/A'}</div>
                    </td>
                    <td style="padding: 8px 25px; width: 25%;">
                        <div style="color: #64748b; font-size: 10px; text-transform: uppercase;">Designation</div>
                        <div style="color: #0f172a; font-size: 13px; font-weight: 600; margin-top: 3px;">${payslip.designation_name || 'N/A'}</div>
                    </td>
                </tr>
            </table>

            <!-- Attendance Summary -->
            <table style="width: 100%; border-collapse: collapse; margin: 15px 25px; width: calc(100% - 50px);">
                <tr>
                    <td style="background: #fef9c3; border: 1px solid #fde047; border-radius: 8px; padding: 12px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="text-align: center; padding: 5px 15px; border-right: 1px solid #fde047;">
                                    <div style="color: #854d0e; font-size: 10px; text-transform: uppercase;">Working Days</div>
                                    <div style="color: #713f12; font-size: 20px; font-weight: bold; margin-top: 2px;">${payslip.working_days || 0}</div>
                                </td>
                                <td style="text-align: center; padding: 5px 15px; border-right: 1px solid #fde047;">
                                    <div style="color: #854d0e; font-size: 10px; text-transform: uppercase;">Days Worked</div>
                                    <div style="color: #166534; font-size: 20px; font-weight: bold; margin-top: 2px;">${payslip.days_worked || 0}</div>
                                </td>
                                <td style="text-align: center; padding: 5px 15px; border-right: 1px solid #fde047;">
                                    <div style="color: #854d0e; font-size: 10px; text-transform: uppercase;">LOP Days</div>
                                    <div style="color: ${(payslip.lop_days || 0) > 0 ? '#dc2626' : '#166534'}; font-size: 20px; font-weight: bold; margin-top: 2px;">${payslip.lop_days || 0}</div>
                                </td>
                                <td style="text-align: center; padding: 5px 15px;">
                                    <div style="color: #854d0e; font-size: 10px; text-transform: uppercase;">Status</div>
                                    <div style="color: #166534; font-size: 12px; font-weight: 600; margin-top: 4px; text-transform: capitalize; background: #dcfce7; padding: 3px 10px; border-radius: 4px; display: inline-block;">${payslip.status || 'N/A'}</div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>

            <!-- Earnings & Deductions -->
            <table style="width: calc(100% - 50px); margin: 15px 25px; border-collapse: separate; border-spacing: 15px 0;">
                <tr>
                    <!-- Earnings Column -->
                    <td style="width: 50%; vertical-align: top;">
                        <table style="width: 100%; border-collapse: collapse; border: 1px solid #bbf7d0; border-radius: 8px; overflow: hidden;">
                            <tr>
                                <td colspan="2" style="background: #22c55e; padding: 10px 12px;">
                                    <div style="color: white; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Earnings</div>
                                </td>
                            </tr>
                            ${earningsRows}
                            <tr style="background: #dcfce7;">
                                <td style="padding: 12px; font-size: 13px; font-weight: bold; color: #166534; border-top: 2px solid #22c55e;">Total Earnings</td>
                                <td style="padding: 12px; text-align: right; font-size: 14px; font-weight: bold; color: #166534; border-top: 2px solid #22c55e;">₹${formatNumber(payslip.gross_earnings || 0)}</td>
                            </tr>
                        </table>
                    </td>
                    <!-- Deductions Column -->
                    <td style="width: 50%; vertical-align: top;">
                        <table style="width: 100%; border-collapse: collapse; border: 1px solid #fecaca; border-radius: 8px; overflow: hidden;">
                            <tr>
                                <td colspan="2" style="background: #ef4444; padding: 10px 12px;">
                                    <div style="color: white; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Deductions</div>
                                </td>
                            </tr>
                            ${deductionsRows}
                            <tr style="background: #fee2e2;">
                                <td style="padding: 12px; font-size: 13px; font-weight: bold; color: #991b1b; border-top: 2px solid #ef4444;">Total Deductions</td>
                                <td style="padding: 12px; text-align: right; font-size: 14px; font-weight: bold; color: #991b1b; border-top: 2px solid #ef4444;">₹${formatNumber(payslip.total_deductions || 0)}</td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>

            <!-- Net Pay -->
            <table style="width: calc(100% - 50px); margin: 20px 25px; border-collapse: collapse;">
                <tr>
                    <td style="background: #1a73e8; border-radius: 10px; padding: 25px; text-align: center;">
                        <div style="color: rgba(255,255,255,0.85); font-size: 11px; text-transform: uppercase; letter-spacing: 2px;">Net Pay</div>
                        <div style="color: white; font-size: 36px; font-weight: bold; margin: 8px 0;">₹${formatNumber(payslip.net_pay || 0)}</div>
                        <div style="color: rgba(255,255,255,0.7); font-size: 11px; font-style: italic;">${netPayInWords} Only</div>
                    </td>
                </tr>
            </table>

            <!-- Footer -->
            <table style="width: 100%; background: #f8fafc; border-top: 1px solid #e2e8f0; border-collapse: collapse; margin-top: 20px;">
                <tr>
                    <td style="padding: 15px 25px;">
                        <div style="color: #64748b; font-size: 10px;">This is a computer-generated payslip and does not require a signature.</div>
                        <div style="color: #94a3b8; font-size: 9px; margin-top: 4px;">Generated on ${generatedDate}</div>
                    </td>
                    <td style="padding: 15px 25px; text-align: right;">
                        <div style="color: #94a3b8; font-size: 11px; font-weight: bold;">HyperDroid HRMS</div>
                    </td>
                </tr>
            </table>
        </div>
    `;
}

// Helper function to convert number to words (Indian numbering system)
function numberToWords(num) {
    if (num === 0) return 'Zero Rupees';

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
                  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const numToWords = (n) => {
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
        if (n < 100000) return numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '');
        if (n < 10000000) return numToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numToWords(n % 100000) : '');
        return numToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numToWords(n % 10000000) : '');
    };

    return 'Rupees ' + numToWords(Math.floor(num));
}

function editComponent(componentId) {
    const component = components.find(c => c.id === componentId);
    if (!component) return;

    document.getElementById('componentId').value = component.id;
    document.getElementById('componentName').value = component.component_name || component.name || '';
    document.getElementById('componentCode').value = component.component_code || component.code || '';
    document.getElementById('componentCategory').value = component.component_type || component.category || 'earning';
    document.getElementById('calculationType').value = component.calculation_type || component.calculationType || 'fixed';
    document.getElementById('isTaxable').value = (component.is_taxable !== undefined ? component.is_taxable : component.isTaxable) ? 'true' : 'false';
    document.getElementById('isStatutory').value = (component.is_statutory !== undefined ? component.is_statutory : component.isStatutory) ? 'true' : 'false';
    document.getElementById('componentDescription').value = component.description || '';

    // Set is_active checkbox
    const isActiveCheckbox = document.getElementById('componentIsActive');
    if (isActiveCheckbox) {
        isActiveCheckbox.checked = component.is_active !== false; // Default to true if not set
    }

    // Set is_basic_component checkbox
    const isBasicCheckbox = document.getElementById('isBasicComponent');
    if (isBasicCheckbox) {
        isBasicCheckbox.checked = component.is_basic_component === true;
    }

    document.getElementById('componentModalTitle').textContent = 'Edit Salary Component';
    document.getElementById('componentModal').classList.add('active');
}

// Structure component management
let structureComponentCounter = 0;

function addStructureComponent() {
    const container = document.getElementById('structureComponents');
    const componentId = `sc_${structureComponentCounter++}`;

    const componentHtml = `
        <div class="structure-component-row" id="${componentId}">
            <div class="form-row component-row">
                <div class="form-group" style="flex: 2;">
                    <select class="form-control component-select" required>
                        <option value="">Select Component</option>
                        ${components.map(c => `<option value="${c.id}" data-type="${c.component_type || c.category}">${c.component_name || c.name} (${c.component_code || c.code})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" style="flex: 1;">
                    <select class="form-control calc-type-select" onchange="toggleComponentValueFields(this, '${componentId}')">
                        <option value="percentage">% of Basic</option>
                        <option value="fixed">Fixed Amount</option>
                    </select>
                </div>
                <div class="form-group value-field" style="flex: 1;">
                    <input type="number" class="form-control percentage-value" placeholder="%" step="0.01" min="0" max="100">
                    <input type="number" class="form-control fixed-value" placeholder="Amount" step="0.01" min="0" style="display: none;" disabled>
                </div>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeStructureComponent('${componentId}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', componentHtml);
}

function removeStructureComponent(componentId) {
    const element = document.getElementById(componentId);
    if (element) {
        element.remove();
    }
}

function toggleComponentValueFields(select, componentId) {
    const row = document.getElementById(componentId);
    if (!row) return;

    const percentageInput = row.querySelector('.percentage-value');
    const fixedInput = row.querySelector('.fixed-value');

    if (select.value === 'percentage') {
        percentageInput.style.display = 'block';
        percentageInput.disabled = false;
        fixedInput.style.display = 'none';
        fixedInput.disabled = true;
        fixedInput.value = '';
    } else {
        percentageInput.style.display = 'none';
        percentageInput.disabled = true;
        fixedInput.style.display = 'block';
        fixedInput.disabled = false;
        percentageInput.value = '';
    }
}

function getStructureComponents() {
    const container = document.getElementById('structureComponents');
    const rows = container.querySelectorAll('.structure-component-row');
    const componentsList = [];

    rows.forEach((row, index) => {
        const componentSelect = row.querySelector('.component-select');
        const calcTypeSelect = row.querySelector('.calc-type-select');
        const percentageInput = row.querySelector('.percentage-value');
        const fixedInput = row.querySelector('.fixed-value');

        if (componentSelect.value) {
            // Get component_type from the selected option's data-type attribute
            const selectedOption = componentSelect.options[componentSelect.selectedIndex];
            const componentType = selectedOption?.getAttribute('data-type') || '';

            componentsList.push({
                component_id: componentSelect.value,
                component_type: componentType,
                calculation_type: calcTypeSelect.value,
                percentage: calcTypeSelect.value === 'percentage' ? parseFloat(percentageInput.value) || 0 : null,
                fixed_amount: calcTypeSelect.value === 'fixed' ? parseFloat(fixedInput.value) || 0 : null,
                display_order: index + 1
            });
        }
    });

    return componentsList;
}

function populateStructureComponents(structureComponents) {
    const container = document.getElementById('structureComponents');
    container.innerHTML = '';
    structureComponentCounter = 0;

    if (structureComponents && structureComponents.length > 0) {
        structureComponents.forEach(sc => {
            addStructureComponent();
            const lastRow = container.lastElementChild;
            if (lastRow) {
                lastRow.querySelector('.component-select').value = sc.component_id;
                lastRow.querySelector('.calc-type-select').value = sc.calculation_type || 'percentage';

                const percentageInput = lastRow.querySelector('.percentage-value');
                const fixedInput = lastRow.querySelector('.fixed-value');

                if (sc.calculation_type === 'fixed') {
                    percentageInput.style.display = 'none';
                    percentageInput.disabled = true;
                    fixedInput.style.display = 'block';
                    fixedInput.disabled = false;
                    fixedInput.value = sc.fixed_amount || '';
                } else {
                    percentageInput.style.display = 'block';
                    percentageInput.disabled = false;
                    fixedInput.style.display = 'none';
                    fixedInput.disabled = true;
                    percentageInput.value = sc.percentage || '';
                }
            }
        });
    }
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

function formatInterestCalculationType(type) {
    const types = {
        'simple': 'Simple Interest',
        'reducing_balance': 'Reducing Balance (EMI)'
    };
    return types[type] || type || 'Simple Interest';
}

/**
 * Formats revision type for CTC revision arrears display
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
 * Generates repayment schedule HTML for a loan
 * Shows both actual repayments (if any) and projected schedule
 */
function generateRepaymentScheduleHtml(loan) {
    const principal = loan.principal_amount || 0;
    const interestRate = loan.interest_rate || 0;
    const tenure = loan.tenure_months || 12;
    const emi = loan.emi_amount || 0;
    const startDate = loan.start_date ? new Date(loan.start_date) : new Date();
    const interestType = loan.interest_calculation_type || 'simple';
    const repayments = loan.repayments || [];

    let html = '';

    // Show actual repayments if any
    if (repayments.length > 0) {
        html += `
            <div class="repayment-history">
                <h5>Payment History</h5>
                <div class="schedule-table-wrapper">
                    <table class="schedule-table">
                        <thead>
                            <tr>
                                <th>EMI #</th>
                                <th>Date</th>
                                <th>Principal</th>
                                <th>Interest</th>
                                <th>Total</th>
                                <th>Balance</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        repayments.forEach(r => {
            html += `
                <tr class="paid-row">
                    <td>${r.emi_number}</td>
                    <td>${formatDate(r.repayment_date)}</td>
                    <td>${formatCurrency(r.principal_amount)}</td>
                    <td>${formatCurrency(r.interest_amount)}</td>
                    <td>${formatCurrency(r.total_amount)}</td>
                    <td>${formatCurrency(r.outstanding_after)}</td>
                    <td><span class="status-badge status-paid">Paid</span></td>
                </tr>
            `;
        });
        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // Generate projected schedule
    html += `
        <div class="projected-schedule">
            <h5>${repayments.length > 0 ? 'Full Schedule' : 'Projected Schedule'}</h5>
            <div class="schedule-summary">
                <div class="summary-item">
                    <span class="summary-label">Principal:</span>
                    <span class="summary-value">${formatCurrency(principal)}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Interest Rate:</span>
                    <span class="summary-value">${interestRate}% p.a.</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Tenure:</span>
                    <span class="summary-value">${tenure} months</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">EMI:</span>
                    <span class="summary-value">${formatCurrency(emi)}</span>
                </div>
            </div>
            <div class="schedule-table-wrapper">
                <table class="schedule-table">
                    <thead>
                        <tr>
                            <th>EMI #</th>
                            <th>Due Date</th>
                            <th>Principal</th>
                            <th>Interest</th>
                            <th>EMI</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    // Calculate schedule based on interest type
    let balance = principal;
    const monthlyRate = interestRate / 12 / 100;
    const paidEmis = repayments.length;

    for (let i = 1; i <= tenure; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i - 1);

        let interestPortion, principalPortion, emiAmount;

        if (interestType === 'reducing_balance') {
            // Reducing balance (EMI) calculation
            interestPortion = balance * monthlyRate;
            principalPortion = emi - interestPortion;
            emiAmount = emi;
        } else {
            // Simple interest calculation
            const totalInterest = (principal * interestRate * tenure) / (12 * 100);
            interestPortion = totalInterest / tenure;
            principalPortion = principal / tenure;
            emiAmount = principalPortion + interestPortion;
        }

        // Handle last EMI to clear balance exactly
        if (i === tenure) {
            principalPortion = balance;
            emiAmount = principalPortion + interestPortion;
        }

        balance = Math.max(0, balance - principalPortion);

        const isPaid = i <= paidEmis;
        const rowClass = isPaid ? 'paid-row' : (i === paidEmis + 1 ? 'current-row' : '');

        html += `
            <tr class="${rowClass}">
                <td>${i}</td>
                <td>${formatShortMonth(dueDate)}</td>
                <td>${formatCurrency(principalPortion)}</td>
                <td>${formatCurrency(interestPortion)}</td>
                <td>${formatCurrency(emiAmount)}</td>
                <td>${formatCurrency(balance)}</td>
            </tr>
        `;
    }

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

/**
 * Format date to short month format (e.g., "Jan 2026")
 */
function formatShortMonth(date) {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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

// Local showToast removed - using unified toast.js instead

// Store current payroll run for modal actions
let currentPayrollRunId = null;
let currentPayrollRunStatus = null;

// Virtual scroll state for payroll modal
let payrollModalState = {
    payslips: [],
    filteredPayslips: [],
    rowHeight: 36,
    visibleRows: 15,
    scrollTop: 0,
    searchTerm: '',
    dynamicColumns: [] // Dynamic columns extracted from payslip items
};

// View payroll run details - Dynamic Columns Version
async function viewPayrollRun(runId) {
    try {
        showLoading();
        currentPayrollRunId = runId;

        // Call the details endpoint which includes payslips
        const response = await api.request(`/hrms/payroll-processing/runs/${runId}/details`);
        const run = response.run;
        const payslips = response.payslips || [];
        const summary = response.summary || {};

        currentPayrollRunStatus = run.status;
        payrollModalState.payslips = payslips;
        payrollModalState.filteredPayslips = payslips;
        payrollModalState.searchTerm = '';

        // Extract dynamic columns from payslip items
        payrollModalState.dynamicColumns = extractDynamicColumns(payslips);

        // Update modal title
        document.getElementById('payrollRunDetailsTitle').textContent =
            `${getMonthName(run.payroll_month)} ${run.payroll_year} Payroll`;

        // Build compact content
        let contentHtml = `
            <div class="pr-compact-header">
                <div class="pr-stats-row">
                    <div class="pr-stat"><span class="pr-stat-val">${summary.total_employees || 0}</span><span class="pr-stat-lbl">Employees</span></div>
                    <div class="pr-stat"><span class="pr-stat-val">${formatCurrency(summary.total_gross)}</span><span class="pr-stat-lbl">Gross</span></div>
                    <div class="pr-stat"><span class="pr-stat-val">${formatCurrency(summary.total_deductions)}</span><span class="pr-stat-lbl">Deductions</span></div>
                    <div class="pr-stat pr-stat-highlight"><span class="pr-stat-val">${formatCurrency(summary.total_net)}</span><span class="pr-stat-lbl">Net Pay</span></div>
                    <div class="pr-stat-badge">
                        <span class="status-badge status-${run.status?.toLowerCase()}">${run.status}</span>
                    </div>
                </div>
                <div class="pr-meta-row">
                    <span>${run.office_name || 'All Offices'}</span>
                    <span class="pr-meta-sep">|</span>
                    <span>${formatDate(run.pay_period_start)} - ${formatDate(run.pay_period_end)}</span>
                </div>
            </div>
        `;

        // Add payslips section with search and virtual scroll
        if (payslips.length > 0) {
            contentHtml += `
                <div class="pr-table-section">
                    <div class="pr-table-toolbar">
                        <div class="pr-search-box">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>
                            </svg>
                            <input type="text" id="payslipSearchInput" placeholder="Search employee..." onkeyup="filterPayslips(this.value)">
                        </div>
                        <span class="pr-count" id="payslipCount">${payslips.length} employees</span>
                    </div>
                    <div class="pr-table-container" id="payslipVirtualContainer">
                        <table class="pr-table">
                            <thead>
                                <tr>
                                    <th class="pr-col-emp">Employee</th>
                                    <th class="pr-col-dept">Dept</th>
                                    ${buildDynamicHeaders()}
                                    <th class="pr-col-num text-right">Gross</th>
                                    <th class="pr-col-num text-right">Ded.</th>
                                    <th class="pr-col-num text-right">Net</th>
                                    <th class="pr-col-days text-center">Days</th>
                                    <th class="pr-col-actions text-center">Payslip</th>
                                </tr>
                            </thead>
                        </table>
                        <div class="pr-virtual-scroll" id="payslipVirtualScroll" onscroll="handlePayslipScroll()">
                            <div class="pr-virtual-spacer" id="payslipSpacer"></div>
                            <table class="pr-table pr-virtual-table">
                                <tbody id="payslipTbody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        } else {
            contentHtml += `
                <div class="pr-empty-state">
                    <p>No payslips generated. ${run.status === 'draft' ? 'Process to generate.' : ''}</p>
                </div>
            `;
        }

        document.getElementById('payrollRunDetailsContent').innerHTML = contentHtml;

        // Show/hide action buttons based on status
        const deleteBtn = document.getElementById('deletePayrollRunBtn');
        const processBtn = document.getElementById('processPayrollRunBtn');
        const downloadBtn = document.getElementById('downloadCsvBtn');
        const approveBtn = document.getElementById('approvePayrollRunBtn');
        const markPaidBtn = document.getElementById('markPaidBtn');
        const bankFileBtn = document.getElementById('downloadBankFileBtn');

        if (deleteBtn) {
            deleteBtn.style.display = run.status === 'draft' ? 'inline-flex' : 'none';
        }
        if (processBtn) {
            processBtn.style.display = run.status === 'draft' ? 'inline-flex' : 'none';
        }
        if (downloadBtn) {
            downloadBtn.style.display = (payslips.length > 0) ? 'inline-flex' : 'none';
        }
        if (approveBtn) {
            // Show Approve button only for 'processed' status
            approveBtn.style.display = run.status === 'processed' ? 'inline-flex' : 'none';
        }
        if (markPaidBtn) {
            // Show Mark as Paid button only for 'approved' status
            markPaidBtn.style.display = run.status === 'approved' ? 'inline-flex' : 'none';
        }
        if (bankFileBtn) {
            // Show Bank File button for processed, approved, or paid status (if has payslips)
            const showBankFile = ['processed', 'approved', 'paid'].includes(run.status) && payslips.length > 0;
            bankFileBtn.style.display = showBankFile ? 'inline-flex' : 'none';
        }

        // Show the modal
        document.getElementById('payrollRunDetailsModal').classList.add('active');

        // Initialize virtual scroll if we have payslips
        if (payslips.length > 0) {
            initPayslipVirtualScroll();
        }

        hideLoading();
    } catch (error) {
        console.error('Error viewing payroll run:', error);
        showToast(error.message || 'Failed to load payroll run details', 'error');
        hideLoading();
    }
}

// Extract unique component columns from all payslips
function extractDynamicColumns(payslips) {
    const columnMap = new Map(); // code -> {code, name, type, order}

    payslips.forEach(slip => {
        const items = slip.items || [];
        items.forEach(item => {
            if (!columnMap.has(item.component_code)) {
                columnMap.set(item.component_code, {
                    code: item.component_code,
                    name: item.component_name || item.component_code,
                    type: item.component_type,
                    order: item.display_order || 999
                });
            }
        });
    });

    // Sort by display_order, then by type (earnings first, then deductions)
    const typeOrder = { 'earning': 0, 'deduction': 1, 'employer_contribution': 2 };
    return Array.from(columnMap.values()).sort((a, b) => {
        const typeA = typeOrder[a.type] ?? 3;
        const typeB = typeOrder[b.type] ?? 3;
        if (typeA !== typeB) return typeA - typeB;
        return a.order - b.order;
    });
}

// Build dynamic table headers from extracted columns
function buildDynamicHeaders() {
    return payrollModalState.dynamicColumns.map(col => {
        const shortName = col.name.length > 8 ? col.code : col.name;
        return `<th class="pr-col-num text-right" title="${col.name}">${shortName}</th>`;
    }).join('');
}

// Build dynamic table cells for a payslip row
function buildDynamicCells(slip) {
    const items = slip.items || [];
    const itemMap = new Map();
    items.forEach(item => {
        itemMap.set(item.component_code, item.amount);
    });

    return payrollModalState.dynamicColumns.map(col => {
        const amount = itemMap.get(col.code) || 0;
        return `<td class="pr-col-num text-right">${formatCurrencyCompact(amount)}</td>`;
    }).join('');
}

// Format currency compactly (no decimals, with commas)
function formatCurrencyCompact(amount) {
    if (amount === null || amount === undefined || amount === 0) return '0';
    return Math.round(amount).toLocaleString('en-IN');
}

// Initialize virtual scroll for payslips
function initPayslipVirtualScroll() {
    const container = document.getElementById('payslipVirtualScroll');
    if (!container) return;

    payrollModalState.scrollTop = 0;
    container.scrollTop = 0;
    updatePayslipSpacer();
    renderVisiblePayslips();
}

// Update spacer height for virtual scroll
function updatePayslipSpacer() {
    const spacer = document.getElementById('payslipSpacer');
    if (!spacer) return;

    const totalHeight = payrollModalState.filteredPayslips.length * payrollModalState.rowHeight;
    spacer.style.height = totalHeight + 'px';
}

// Handle scroll event for virtual scroll
function handlePayslipScroll() {
    const container = document.getElementById('payslipVirtualScroll');
    if (!container) return;

    payrollModalState.scrollTop = container.scrollTop;
    renderVisiblePayslips();
}

// Render only visible payslip rows
function renderVisiblePayslips() {
    const tbody = document.getElementById('payslipTbody');
    const virtualTable = document.querySelector('.pr-virtual-table');
    if (!tbody || !virtualTable) return;

    const { filteredPayslips, rowHeight, visibleRows, scrollTop } = payrollModalState;

    const startIndex = Math.floor(scrollTop / rowHeight);
    const endIndex = Math.min(startIndex + visibleRows + 2, filteredPayslips.length);
    const offsetY = startIndex * rowHeight;

    virtualTable.style.transform = `translateY(${offsetY}px)`;

    let html = '';
    for (let i = startIndex; i < endIndex; i++) {
        const slip = filteredPayslips[i];
        if (!slip) continue;

        html += `
            <tr class="clickable-row" title="Click to view payslip details">
                <td class="pr-col-emp">
                    <div class="pr-emp-cell">
                        <span class="pr-emp-name">${slip.employee_name || 'Unknown'}</span>
                        <span class="pr-emp-code">${slip.employee_code || ''}</span>
                    </div>
                </td>
                <td class="pr-col-dept pr-cell-muted">${(slip.department_name || '-').substring(0, 12)}</td>
                ${buildDynamicCells(slip)}
                <td class="pr-col-num text-right pr-cell-bold">${formatCurrencyCompact(slip.gross_earnings)}</td>
                <td class="pr-col-num text-right pr-cell-muted">${formatCurrencyCompact(slip.total_deductions)}</td>
                <td class="pr-col-num text-right pr-cell-net">${formatCurrencyCompact(slip.net_pay)}</td>
                <td class="pr-col-days text-center">${Math.round(slip.days_worked || 0)}/${slip.total_working_days || 0}</td>
                <td class="pr-col-actions text-center">
                    <button class="action-btn action-btn-sm" onclick="event.stopPropagation(); viewPayslip('${slip.id}')" title="View Payslip">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
}

// Filter payslips by search term
function filterPayslips(searchTerm) {
    payrollModalState.searchTerm = searchTerm.toLowerCase().trim();

    if (!payrollModalState.searchTerm) {
        payrollModalState.filteredPayslips = payrollModalState.payslips;
    } else {
        payrollModalState.filteredPayslips = payrollModalState.payslips.filter(slip => {
            const name = (slip.employee_name || '').toLowerCase();
            const code = (slip.employee_code || '').toLowerCase();
            const dept = (slip.department_name || '').toLowerCase();
            return name.includes(payrollModalState.searchTerm) ||
                   code.includes(payrollModalState.searchTerm) ||
                   dept.includes(payrollModalState.searchTerm);
        });
    }

    // Update count
    const countEl = document.getElementById('payslipCount');
    if (countEl) {
        countEl.textContent = `${payrollModalState.filteredPayslips.length} employees`;
    }

    // Reset scroll and re-render
    const container = document.getElementById('payslipVirtualScroll');
    if (container) container.scrollTop = 0;
    payrollModalState.scrollTop = 0;

    updatePayslipSpacer();
    renderVisiblePayslips();
}

// Delete current payroll run (draft only)
async function deleteCurrentPayrollRun() {
    if (!currentPayrollRunId) return;

    const confirmed = await Confirm.show({
        title: 'Delete Payroll Run',
        message: 'Are you sure you want to delete this draft payroll run? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/payroll-processing/runs/${currentPayrollRunId}`, {
            method: 'DELETE'
        });

        closeModal('payrollRunDetailsModal');
        showToast('Payroll run deleted successfully', 'success');
        await loadPayrollRuns();
        hideLoading();
    } catch (error) {
        console.error('Error deleting payroll run:', error);
        showToast(error.message || 'Failed to delete payroll run', 'error');
        hideLoading();
    }
}

// Download payroll CSV for bank upload
async function downloadPayrollCsv() {
    if (!currentPayrollRunId) return;

    try {
        showToast('Generating CSV file...', 'info');

        // Fetch the CSV file
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${CONFIG.hrmsApiBaseUrl}/payroll-processing/runs/${currentPayrollRunId}/export-csv`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to generate CSV');
        }

        // Get filename from Content-Disposition header or use default
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'payroll_export.csv';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?(.+)"?/);
            if (match) {
                filename = match[1];
            }
        }

        // Download the file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showToast('CSV downloaded successfully', 'success');
    } catch (error) {
        console.error('Error downloading CSV:', error);
        showToast(error.message || 'Failed to download CSV', 'error');
    }
}

// Process payroll from within the modal
async function processCurrentPayrollRun() {
    if (!currentPayrollRunId) return;

    const confirmed = await Confirm.show({
        title: 'Process Payroll Run',
        message: 'Are you sure you want to process this payroll run? This will generate payslips for all eligible employees.',
        type: 'info',
        confirmText: 'Process',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-processing/runs/${currentPayrollRunId}/process`, {
            method: 'POST',
            body: JSON.stringify({})
        });

        // Show processing results
        let message = `Payroll processed! Processed: ${result.processed || 0}`;
        if (result.failed > 0) {
            message += `, Failed: ${result.failed}`;
        }

        showToast(message, result.failed > 0 ? 'warning' : 'success');

        // Refresh the modal to show the new payslips
        await viewPayrollRun(currentPayrollRunId);
        await loadPayrollRuns();
        hideLoading();
    } catch (error) {
        console.error('Error processing payroll:', error);
        showToast(error.message || 'Failed to process payroll', 'error');
        hideLoading();
    }
}

// Process payroll run - generate payslips for employees
async function processPayrollRun(runId) {
    const confirmed = await Confirm.show({
        title: 'Process Payroll Run',
        message: 'Are you sure you want to process this payroll run? This will generate payslips for all eligible employees.',
        type: 'info',
        confirmText: 'Process',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-processing/runs/${runId}/process`, {
            method: 'POST',
            body: JSON.stringify({})
        });

        // Show processing results
        let message = `Payroll processed! Processed: ${result.processed || 0}`;
        if (result.failed > 0) {
            message += `, Failed: ${result.failed}`;
        }
        if (result.errors && result.errors.length > 0) {
            console.warn('Payroll processing errors:', result.errors);
            message += `. Errors: ${result.errors.slice(0, 3).join('; ')}`;
            if (result.errors.length > 3) {
                message += `... and ${result.errors.length - 3} more`;
            }
        }

        showToast(message, result.failed > 0 ? 'warning' : 'success');
        await loadPayrollRuns();
        hideLoading();
    } catch (error) {
        console.error('Error processing payroll:', error);
        showToast(error.message || 'Failed to process payroll', 'error');
        hideLoading();
    }
}

// ======================================
// Draft Payslip Search and Export
// ======================================

/**
 * Filter draft payslips based on search query
 * @param {string} query - Search query
 */
function filterDraftPayslips(query) {
    const rows = document.querySelectorAll('.draft-payslip-row');
    const searchTerm = query.toLowerCase().trim();

    rows.forEach(row => {
        if (!searchTerm) {
            row.classList.remove('hidden');
            return;
        }

        const code = row.dataset.code || '';
        const name = row.dataset.name || '';
        const dept = row.dataset.dept || '';

        const matches = code.includes(searchTerm) ||
                       name.includes(searchTerm) ||
                       dept.includes(searchTerm);

        if (matches) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
}

/**
 * Export current draft payslips to CSV
 */
function exportDraftToCSV() {
    const payslips = window.currentDraftPayslips;
    if (!payslips || payslips.length === 0) {
        showToast('No payslips to export', 'warning');
        return;
    }

    // Build CSV content
    const headers = ['Employee Code', 'Employee Name', 'Department', 'Gross Earnings', 'Total Deductions', 'Net Pay'];
    const rows = payslips.map(p => [
        p.employee_code || '',
        p.employee_name || '',
        p.department_name || '',
        p.gross_earnings || 0,
        p.total_deductions || 0,
        p.net_pay || 0
    ]);

    // Create CSV string
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => {
            // Escape quotes and wrap in quotes if contains comma
            const str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        }).join(','))
    ].join('\n');

    // Get draft info for filename
    const modal = document.getElementById('draftDetailsModal');
    const title = document.getElementById('draftDetailTitle')?.textContent || 'PayrollDraft';
    const filename = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${payslips.length} payslips to ${filename}`, 'success');
}

// Event listeners
document.getElementById('payslipYear')?.addEventListener('change', loadMyPayslips);
document.getElementById('runYear')?.addEventListener('change', loadPayrollRuns);
document.getElementById('runMonth')?.addEventListener('change', loadPayrollRuns);
document.getElementById('runOffice')?.addEventListener('change', loadPayrollRuns);
document.getElementById('structureSearch')?.addEventListener('input', updateSalaryStructuresTable);
document.getElementById('structureOfficeFilter')?.addEventListener('change', loadSalaryStructures);
document.getElementById('componentSearch')?.addEventListener('input', updateComponentsTables);
document.getElementById('componentType')?.addEventListener('change', updateComponentsTables);
document.getElementById('loanStatus')?.addEventListener('change', loadLoans);

// =====================================================
// SALARY STRUCTURE VERSIONING FUNCTIONS
// =====================================================

let currentVersionStructureId = null;
let currentVersionStructureName = '';
let structureVersions = [];

/**
 * View structure versions - opens version history modal
 */
async function viewStructureVersions(structureId) {
    try {
        showLoading();
        currentVersionStructureId = structureId;

        // First, ensure structure has at least version 1 (migrate if needed)
        await api.request(`/hrms/payroll/structures/${structureId}/ensure-version`, {
            method: 'POST'
        });

        // Load versions
        const versions = await api.request(`/hrms/payroll/structures/${structureId}/versions`);
        structureVersions = versions || [];

        // Get structure name
        const structure = structures.find(s => s.id === structureId);
        currentVersionStructureName = structure?.structure_name || 'Structure';

        // Update modal
        document.getElementById('versionHistoryTitle').textContent = `Version History - ${currentVersionStructureName}`;

        updateVersionHistoryTable(structureVersions);

        openModal('versionHistoryModal');
        hideLoading();
    } catch (error) {
        console.error('Error loading structure versions:', error);
        showToast(error.message || 'Failed to load version history', 'error');
        hideLoading();
    }
}

/**
 * Update version history table with versions data
 */
function updateVersionHistoryTable(versions) {
    const tbody = document.getElementById('versionHistoryTable');
    if (!tbody) return;

    if (!versions || versions.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="6">
                    <div class="empty-message">
                        <p>No versions found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = versions.map((v, index) => {
        const isCurrent = index === 0; // First version is most recent
        return `
        <tr class="${isCurrent ? 'current-version' : ''}">
            <td>
                <strong>v${v.version_number}</strong>
                ${isCurrent ? '<span class="badge-current">Current</span>' : ''}
            </td>
            <td>${formatDate(v.effective_from)}</td>
            <td>${v.effective_to ? formatDate(v.effective_to) : '<span class="text-muted">Ongoing</span>'}</td>
            <td>${v.components?.length || 0} components</td>
            <td>${v.change_reason || '-'}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewVersionDetails('${v.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    ${v.version_number > 1 ? `
                    <button class="action-btn" onclick="compareVersions('${currentVersionStructureId}', ${v.version_number - 1}, ${v.version_number})" title="Compare with Previous">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="20" x2="18" y2="10"></line>
                            <line x1="12" y1="20" x2="12" y2="4"></line>
                            <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                    </button>
                    ` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

/**
 * View detailed version information
 */
async function viewVersionDetails(versionId) {
    try {
        showLoading();
        const version = await api.request(`/hrms/payroll/structures/versions/${versionId}`);

        if (!version) {
            showToast('Version not found', 'error');
            hideLoading();
            return;
        }

        // Build styled HTML content
        const components = version.components || [];
        const earnings = components.filter(c => c.component_type === 'earning');
        const deductions = components.filter(c => c.component_type === 'deduction');

        let htmlContent = `
            <div class="detail-grid">
                <span class="detail-label">Effective From:</span>
                <span class="detail-value">${formatDate(version.effective_from)}</span>
                <span class="detail-label">Effective To:</span>
                <span class="detail-value">${version.effective_to ? formatDate(version.effective_to) : 'Ongoing'}</span>
                <span class="detail-label">Change Reason:</span>
                <span class="detail-value">${version.change_reason || 'Initial version'}</span>
            </div>
        `;

        if (components.length > 0) {
            htmlContent += `
                <div class="section-title">Components</div>
                <table class="component-table">
                    <thead>
                        <tr>
                            <th>Component</th>
                            <th>Type</th>
                            <th>Value</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            components.forEach(c => {
                const valueStr = c.calculation_type === 'percentage'
                    ? `${c.percentage || c.percentage_of_basic || 0}% of ${c.calculation_base || 'basic'}`
                    : `₹${(c.fixed_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                const badgeClass = c.component_type === 'earning' ? 'badge-earning' : 'badge-deduction';

                htmlContent += `
                    <tr>
                        <td><strong>${c.component_name}</strong> <span style="color: var(--text-tertiary)">(${c.component_code})</span></td>
                        <td><span class="badge ${badgeClass}">${c.component_type}</span></td>
                        <td class="amount">${valueStr}</td>
                    </tr>
                `;
            });

            htmlContent += `
                    </tbody>
                </table>
            `;
        }

        await InfoModal.show({
            title: `Version ${version.version_number} Details`,
            message: htmlContent,
            type: 'info',
            html: true
        });

        hideLoading();
    } catch (error) {
        console.error('Error loading version details:', error);
        showToast(error.message || 'Failed to load version details', 'error');
        hideLoading();
    }
}

/**
 * Compare two versions
 */
async function compareVersions(structureId, fromVersion, toVersion) {
    try {
        showLoading();
        const diff = await api.request(`/hrms/payroll/structures/${structureId}/versions/compare?fromVersion=${fromVersion}&toVersion=${toVersion}`);

        if (!diff) {
            showToast('Could not compare versions', 'error');
            hideLoading();
            return;
        }

        // Build styled HTML comparison
        let htmlContent = `
            <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 16px;">
                <strong>Version ${fromVersion}</strong> → <strong>Version ${toVersion}</strong>
            </div>
        `;

        if (diff.added_components?.length > 0) {
            htmlContent += `<div class="section-title" style="color: var(--color-success)">Added (${diff.added_components.length})</div>`;
            diff.added_components.forEach(c => {
                htmlContent += `
                    <div class="diff-item">
                        <div class="diff-icon added">+</div>
                        <span><strong>${c.component_name}</strong> <span style="color: var(--text-tertiary)">(${c.component_code})</span></span>
                    </div>
                `;
            });
        }

        if (diff.removed_components?.length > 0) {
            htmlContent += `<div class="section-title" style="color: var(--color-danger)">Removed (${diff.removed_components.length})</div>`;
            diff.removed_components.forEach(c => {
                htmlContent += `
                    <div class="diff-item">
                        <div class="diff-icon removed">−</div>
                        <span><strong>${c.component_name}</strong> <span style="color: var(--text-tertiary)">(${c.component_code})</span></span>
                    </div>
                `;
            });
        }

        if (diff.modified_components?.length > 0) {
            htmlContent += `<div class="section-title" style="color: var(--color-warning)">Modified (${diff.modified_components.length})</div>`;
            diff.modified_components.forEach(c => {
                htmlContent += `
                    <div class="diff-item">
                        <div class="diff-icon modified">~</div>
                        <span>
                            <strong>${c.component_name}</strong>
                            <br>
                            <span style="color: var(--text-tertiary); font-size: 12px;">
                                ${c.old_value} → ${c.new_value}
                            </span>
                        </span>
                    </div>
                `;
            });
        }

        if (diff.unchanged_components?.length > 0) {
            htmlContent += `
                <div class="section-title" style="color: var(--text-tertiary)">Unchanged</div>
                <div style="color: var(--text-tertiary); font-size: 12px;">
                    ${diff.unchanged_components.length} components remain the same
                </div>
            `;
        }

        // If no changes at all
        if (!diff.added_components?.length && !diff.removed_components?.length && !diff.modified_components?.length) {
            htmlContent += `
                <div style="text-align: center; padding: 20px; color: var(--text-tertiary);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px;">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <div>No differences found between versions</div>
                </div>
            `;
        }

        await InfoModal.show({
            title: 'Version Comparison',
            message: htmlContent,
            type: 'info',
            html: true
        });
        hideLoading();
    } catch (error) {
        console.error('Error comparing versions:', error);
        showToast(error.message || 'Failed to compare versions', 'error');
        hideLoading();
    }
}

/**
 * Show create new version modal
 */
function showCreateVersionModal() {
    if (!currentVersionStructureId) {
        showToast('No structure selected', 'error');
        return;
    }

    // Reset form
    document.getElementById('newVersionForm').reset();

    // Set default effective date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('versionEffectiveDate').value = tomorrow.toISOString().split('T')[0];

    // Populate components from latest version
    populateNewVersionComponents();

    document.getElementById('createVersionModalTitle').textContent = `Create New Version - ${currentVersionStructureName}`;
    openModal('createVersionModal');
}

/**
 * Populate components for new version based on current version
 */
function populateNewVersionComponents() {
    const container = document.getElementById('newVersionComponents');
    if (!container) return;

    // Get latest version's components
    const latestVersion = structureVersions[0];
    const existingComponents = latestVersion?.components || [];

    // Build component checkboxes with values
    container.innerHTML = components.map(c => {
        const existingComp = existingComponents.find(ec => ec.component_id === c.id);
        const isSelected = !!existingComp;
        const value = existingComp?.percentage || existingComp?.fixed_amount || '';
        const calcType = existingComp?.calculation_type || 'percentage';

        return `
        <div class="version-component-row">
            <label class="checkbox-label">
                <input type="checkbox" name="versionComponent" value="${c.id}" ${isSelected ? 'checked' : ''}
                       data-name="${c.component_name || c.name}" data-code="${c.component_code || c.code}"
                       data-type="${c.component_type || c.category}">
                <span>${c.component_name || c.name} (${c.component_code || c.code})</span>
                <span class="component-badge component-${c.component_type || c.category}">${c.component_type || c.category}</span>
            </label>
            <div class="component-value-inputs">
                <select class="form-control form-control-sm version-calc-type" data-component-id="${c.id}">
                    <option value="percentage" ${calcType === 'percentage' ? 'selected' : ''}>% of Basic</option>
                    <option value="fixed" ${calcType === 'fixed' ? 'selected' : ''}>Fixed Amount</option>
                </select>
                <input type="number" class="form-control form-control-sm version-value" data-component-id="${c.id}"
                       value="${value}" placeholder="${calcType === 'percentage' ? '%' : '₹'}" step="0.01" min="0">
            </div>
        </div>`;
    }).join('');
}

/**
 * Save new version
 */
async function saveNewVersion() {
    const form = document.getElementById('newVersionForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const effectiveDate = document.getElementById('versionEffectiveDate').value;
    const changeReason = document.getElementById('versionChangeReason').value;

    if (!effectiveDate) {
        showToast('Please select an effective date', 'error');
        return;
    }

    // Collect selected components with values
    const selectedComponents = [];
    document.querySelectorAll('input[name="versionComponent"]:checked').forEach((checkbox, index) => {
        const componentId = checkbox.value;
        const calcTypeSelect = document.querySelector(`.version-calc-type[data-component-id="${componentId}"]`);
        const valueInput = document.querySelector(`.version-value[data-component-id="${componentId}"]`);

        const calcType = calcTypeSelect?.value || 'percentage';
        const value = parseFloat(valueInput?.value) || 0;

        if (value > 0) {
            selectedComponents.push({
                component_id: componentId,
                calculation_order: index + 1,
                calculation_type: calcType,
                percentage_of_basic: calcType === 'percentage' ? value : null,
                fixed_amount: calcType === 'fixed' ? value : null,
                is_active: true
            });
        }
    });

    if (selectedComponents.length === 0) {
        showToast('Please select at least one component with a value', 'error');
        return;
    }

    // Determine new version number
    const latestVersion = structureVersions[0];
    const newVersionNumber = (latestVersion?.version_number || 0) + 1;

    try {
        showLoading();

        const data = {
            structure_id: currentVersionStructureId,
            version_number: newVersionNumber,
            effective_from: effectiveDate,
            change_reason: changeReason,
            components: selectedComponents
        };

        await api.request(`/hrms/payroll/structures/${currentVersionStructureId}/versions`, {
            method: 'POST',
            body: JSON.stringify(data)
        });

        closeModal('createVersionModal');
        showToast(`Version ${newVersionNumber} created successfully`, 'success');

        // Reload versions
        await viewStructureVersions(currentVersionStructureId);
        hideLoading();
    } catch (error) {
        console.error('Error creating version:', error);
        showToast(error.message || 'Failed to create version', 'error');
        hideLoading();
    }
}

/**
 * Preview versioned salary calculation
 */
async function previewVersionedSalary() {
    if (!currentVersionStructureId) {
        showToast('No structure selected', 'error');
        return;
    }

    const ctcInput = await Prompt.show({
        title: 'Preview Salary Calculation',
        message: 'Enter CTC (Cost to Company) for preview:',
        defaultValue: '1200000',
        placeholder: 'e.g., 1200000',
        type: 'number'
    });

    const ctc = parseFloat(ctcInput);
    if (!ctcInput || !ctc || ctc <= 0) {
        return;
    }

    const periodStart = await Prompt.show({
        title: 'Period Start Date',
        message: 'Enter period start date (YYYY-MM-DD):',
        defaultValue: new Date().toISOString().slice(0, 8) + '01',
        placeholder: 'YYYY-MM-DD',
        type: 'date'
    });

    if (!periodStart) {
        return;
    }

    const periodEnd = await Prompt.show({
        title: 'Period End Date',
        message: 'Enter period end date (YYYY-MM-DD):',
        defaultValue: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10),
        placeholder: 'YYYY-MM-DD',
        type: 'date'
    });

    if (!periodEnd) {
        return;
    }

    try {
        showLoading();
        const breakdown = await api.request(`/hrms/payroll/structures/${currentVersionStructureId}/versions/calculate`, {
            method: 'POST',
            body: JSON.stringify({
                ctc: ctc,
                period_start: periodStart,
                period_end: periodEnd
            })
        });

        // Build styled HTML breakdown
        let htmlContent = `
            <div class="detail-grid">
                <span class="detail-label">CTC:</span>
                <span class="detail-value amount">₹${ctc.toLocaleString('en-IN')}</span>
                <span class="detail-label">Period:</span>
                <span class="detail-value">${formatDate(periodStart)} to ${formatDate(periodEnd)}</span>
                <span class="detail-label">Working Days:</span>
                <span class="detail-value">${breakdown.total_working_days || 'N/A'}</span>
            </div>
        `;

        // Version periods if any
        if (breakdown.version_periods?.length > 0) {
            htmlContent += `<div class="section-title">Version Periods</div>`;
            breakdown.version_periods.forEach(vp => {
                htmlContent += `
                    <div style="background: var(--gray-50); padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; font-size: 12px;">
                        <strong>Version ${vp.version_number}</strong> (${formatDate(vp.period_start)} to ${formatDate(vp.period_end)})
                        <br>
                        <span style="color: var(--text-tertiary);">${vp.days_in_period} days • ${(vp.proration_factor * 100).toFixed(1)}% proration</span>
                    </div>
                `;
            });
        }

        // Component breakdown table
        const earnings = breakdown.component_breakdowns?.filter(c => c.component_type === 'earning') || [];
        const deductions = breakdown.component_breakdowns?.filter(c => c.component_type === 'deduction') || [];

        if (breakdown.component_breakdowns?.length > 0) {
            htmlContent += `
                <div class="section-title">Component Breakdown</div>
                <table class="component-table">
                    <thead>
                        <tr>
                            <th>Component</th>
                            <th style="text-align: right;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            // Earnings
            earnings.forEach(cb => {
                const partialBadge = cb.is_partial ? '<span class="badge badge-modified" style="margin-left: 8px;">Partial</span>' : '';
                htmlContent += `
                    <tr>
                        <td>
                            <span class="badge badge-earning" style="margin-right: 8px;">E</span>
                            ${cb.component_name}${partialBadge}
                        </td>
                        <td class="amount" style="text-align: right; color: var(--color-success);">+₹${(cb.prorated_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                `;
            });

            // Deductions
            deductions.forEach(cb => {
                const partialBadge = cb.is_partial ? '<span class="badge badge-modified" style="margin-left: 8px;">Partial</span>' : '';
                htmlContent += `
                    <tr>
                        <td>
                            <span class="badge badge-deduction" style="margin-right: 8px;">D</span>
                            ${cb.component_name}${partialBadge}
                        </td>
                        <td class="amount" style="text-align: right; color: var(--color-danger);">−₹${(cb.prorated_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                `;
            });

            htmlContent += `
                    </tbody>
                </table>
            `;
        }

        // Summary box
        htmlContent += `
            <div class="summary-box">
                <div class="summary-row">
                    <span>Total Gross</span>
                    <span class="amount positive">₹${(breakdown.total_gross || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div class="summary-row">
                    <span>Total Deductions</span>
                    <span class="amount negative">−₹${(breakdown.total_deductions || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div class="summary-row total">
                    <span>Net Pay</span>
                    <span class="amount" style="font-size: 16px;">₹${(breakdown.net_pay || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
            </div>
        `;

        await InfoModal.show({
            title: 'Salary Preview',
            message: htmlContent,
            type: 'success',
            html: true
        });
        hideLoading();
    } catch (error) {
        console.error('Error previewing versioned salary:', error);
        showToast(error.message || 'Failed to preview calculation', 'error');
        hideLoading();
    }
}

// ============================================
// ARREARS MANAGEMENT
// ============================================

let currentArrearsList = [];
let selectedArrearsIds = new Set();

/**
 * Open arrears management modal
 */
async function openArrearsModal() {
    try {
        showLoading();
        await refreshArrears();
        openModal('arrearsModal');
        hideLoading();
    } catch (error) {
        console.error('Error opening arrears modal:', error);
        showToast(error.message || 'Failed to load arrears', 'error');
        hideLoading();
    }
}

/**
 * Refresh arrears list
 */
async function refreshArrears() {
    try {
        // Get latest version ID if available - but don't error if none exists
        const versionId = structureVersions && structureVersions.length > 0
            ? structureVersions[0]?.id
            : null;

        // Only validate version ID if we're trying to use one
        if (versionId && !isValidGuid(versionId)) {
            console.warn('Invalid version ID format, fetching all arrears');
        }

        const arrears = await api.getPendingArrears(versionId);
        currentArrearsList = arrears || [];
        selectedArrearsIds.clear();
        updateModalArrearsTable();
        updateArrearsSummary();
        updateArrearsButtons();
    } catch (error) {
        console.error('Error refreshing arrears:', error);
        // Extract user-friendly error message
        const errorMessage = error.error || error.message || 'Failed to refresh arrears';
        showToast(errorMessage, 'error');
        // Reset state on error
        currentArrearsList = [];
        selectedArrearsIds.clear();
        updateModalArrearsTable();
        updateArrearsSummary();
        updateArrearsButtons();
    }
}

/**
 * Update arrears summary section
 */
function updateArrearsSummary() {
    const summary = document.getElementById('arrearsSummary');
    if (!currentArrearsList || currentArrearsList.length === 0) {
        summary.style.display = 'none';
        return;
    }

    summary.style.display = 'block';

    const uniqueEmployees = new Set(currentArrearsList.map(a => a.employee_id));
    const totalAmount = currentArrearsList.reduce((sum, a) => sum + (a.arrears_amount || 0), 0);
    const pendingCount = currentArrearsList.filter(a => a.status === 'pending').length;

    document.getElementById('arrearsEmployeeCount').textContent = uniqueEmployees.size;
    document.getElementById('arrearsTotalAmount').textContent = `₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('arrearsPendingCount').textContent = pendingCount;
}

/**
 * Update modal arrears table (Version History modal)
 */
function updateModalArrearsTable() {
    const tbody = document.getElementById('modalArrearsTable');
    if (!tbody) return;

    if (!currentArrearsList || currentArrearsList.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <p>No arrears found</p>
                        <small class="text-muted">Arrears are created when versions have retrospective effective dates</small>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = currentArrearsList.map(a => {
        const isPending = a.status === 'pending';
        const statusBadge = getArrearsStatusBadge(a.status);
        return `
        <tr class="${isPending ? '' : 'text-muted'}">
            <td>
                <input type="checkbox" class="arrears-checkbox" value="${a.id}"
                       ${isPending ? '' : 'disabled'}
                       ${selectedArrearsIds.has(a.id) ? 'checked' : ''}
                       onchange="toggleArrearsSelection('${a.id}')">
            </td>
            <td>
                <strong>${a.employee_name || 'Unknown'}</strong>
                <br><small class="text-muted">${a.employee_code || ''}</small>
            </td>
            <td>${getMonthName(a.payroll_month)} ${a.payroll_year}</td>
            <td>₹${(a.old_gross || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td>₹${(a.new_gross || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td class="${a.arrears_amount > 0 ? 'text-success' : 'text-danger'}">
                <strong>₹${(a.arrears_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
            </td>
            <td>${statusBadge}</td>
            <td>
                ${isPending ? `
                <div class="action-buttons">
                    <button class="action-btn" onclick="applySingleArrears('${a.id}')" title="Apply">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    <button class="action-btn" onclick="cancelSingleArrears('${a.id}')" title="Cancel">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                ` : '-'}
            </td>
        </tr>`;
    }).join('');
}

/**
 * Get status badge HTML
 */
function getArrearsStatusBadge(status) {
    const badges = {
        'pending': '<span class="badge" style="background: var(--color-warning-light); color: var(--color-warning-text);">Pending</span>',
        'applied': '<span class="badge" style="background: var(--color-success-light); color: var(--color-success-text);">Applied</span>',
        'cancelled': '<span class="badge" style="background: var(--color-danger-light); color: var(--color-danger-text);">Cancelled</span>'
    };
    return badges[status] || badges['pending'];
}

/**
 * Toggle all arrears selection
 */
function toggleAllArrears() {
    const selectAll = document.getElementById('selectAllArrears');
    const checkboxes = document.querySelectorAll('.arrears-checkbox:not(:disabled)');

    checkboxes.forEach(cb => {
        cb.checked = selectAll.checked;
        if (selectAll.checked) {
            selectedArrearsIds.add(cb.value);
        } else {
            selectedArrearsIds.delete(cb.value);
        }
    });

    updateArrearsButtons();
}

/**
 * Toggle single arrears selection
 */
function toggleArrearsSelection(arrearsId) {
    if (selectedArrearsIds.has(arrearsId)) {
        selectedArrearsIds.delete(arrearsId);
    } else {
        selectedArrearsIds.add(arrearsId);
    }
    updateArrearsButtons();
}

/**
 * Update arrears action buttons state
 */
function updateArrearsButtons() {
    const hasSelection = selectedArrearsIds.size > 0;
    document.getElementById('applyArrearsBtn').disabled = !hasSelection;
    document.getElementById('cancelArrearsBtn').disabled = !hasSelection;
}

/**
 * Apply single arrears
 */
async function applySingleArrears(arrearsId) {
    // Validate arrears ID
    if (!arrearsId || !isValidGuid(arrearsId)) {
        showToast('Invalid arrears ID', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Apply Arrears',
        message: 'Are you sure you want to apply this arrears to the next payroll?',
        type: 'info',
        confirmText: 'Apply',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();
        await api.applyArrears(arrearsId);
        showToast('Arrears applied successfully', 'success');
        await refreshArrears();
        hideLoading();
    } catch (error) {
        console.error('Error applying arrears:', error);
        const errorMessage = error.error || error.message || 'Failed to apply arrears';
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

/**
 * Cancel single arrears
 */
async function cancelSingleArrears(arrearsId) {
    // Validate arrears ID
    if (!arrearsId || !isValidGuid(arrearsId)) {
        showToast('Invalid arrears ID', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Cancel Arrears',
        message: 'Are you sure you want to cancel this arrears?',
        type: 'danger',
        confirmText: 'Cancel Arrears',
        cancelText: 'Keep'
    });
    if (!confirmed) return;

    try {
        showLoading();
        await api.cancelArrears(arrearsId);
        showToast('Arrears cancelled', 'success');
        await refreshArrears();
        hideLoading();
    } catch (error) {
        console.error('Error cancelling arrears:', error);
        const errorMessage = error.error || error.message || 'Failed to cancel arrears';
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

/**
 * Apply selected arrears
 */
async function applySelectedArrears() {
    if (selectedArrearsIds.size === 0) {
        showToast('No arrears selected', 'error');
        return;
    }

    // Filter out invalid IDs
    const validIds = Array.from(selectedArrearsIds).filter(id => isValidGuid(id));
    if (validIds.length === 0) {
        showToast('No valid arrears IDs selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Apply Multiple Arrears',
        message: `Are you sure you want to apply ${validIds.length} arrears to the next payroll?`,
        type: 'info',
        confirmText: 'Apply All',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const arrearsId of validIds) {
            try {
                await api.applyArrears(arrearsId);
                successCount++;
            } catch (e) {
                errorCount++;
                errors.push(e.error || e.message || 'Unknown error');
            }
        }

        if (successCount > 0) {
            showToast(`Applied ${successCount} arrears${errorCount > 0 ? `, ${errorCount} failed` : ''}`, 'success');
        } else {
            showToast(`Failed to apply arrears: ${errors[0] || 'Unknown error'}`, 'error');
        }
        await refreshArrears();
        hideLoading();
    } catch (error) {
        console.error('Error applying arrears:', error);
        const errorMessage = error.error || error.message || 'Failed to apply arrears';
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

/**
 * Cancel selected arrears
 */
async function cancelSelectedArrears() {
    if (selectedArrearsIds.size === 0) {
        showToast('No arrears selected', 'error');
        return;
    }

    // Filter out invalid IDs
    const validIds = Array.from(selectedArrearsIds).filter(id => isValidGuid(id));
    if (validIds.length === 0) {
        showToast('No valid arrears IDs selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Cancel Multiple Arrears',
        message: `Are you sure you want to cancel ${validIds.length} arrears? This action cannot be undone.`,
        type: 'danger',
        confirmText: 'Cancel All',
        cancelText: 'Keep'
    });
    if (!confirmed) return;

    try {
        showLoading();
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const arrearsId of validIds) {
            try {
                await api.cancelArrears(arrearsId);
                successCount++;
            } catch (e) {
                errorCount++;
                errors.push(e.error || e.message || 'Unknown error');
            }
        }

        if (successCount > 0) {
            showToast(`Cancelled ${successCount} arrears${errorCount > 0 ? `, ${errorCount} failed` : ''}`, 'success');
        } else {
            showToast(`Failed to cancel arrears: ${errors[0] || 'Unknown error'}`, 'error');
        }
        await refreshArrears();
        hideLoading();
    } catch (error) {
        console.error('Error cancelling arrears:', error);
        const errorMessage = error.error || error.message || 'Failed to cancel arrears';
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

/**
 * Get month name from month number
 */
function getMonthName(monthNumber) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthNumber - 1] || '';
}

// ============================================
// BULK VERSION ASSIGNMENT
// ============================================

let bulkAssignStructureId = null;
let bulkAssignVersionNumber = null;
let bulkPreviewResult = null;

/**
 * Open bulk assignment modal
 */
async function openBulkAssignModal() {
    if (!currentVersionStructureId) {
        showToast('Please select a structure first', 'error');
        return;
    }

    bulkAssignStructureId = currentVersionStructureId;
    bulkAssignVersionNumber = structureVersions[0]?.version_number || 1;

    try {
        showLoading();

        // Load offices, departments, designations for filters
        await loadBulkAssignFilters();

        // Reset form
        document.getElementById('bulkAssignForm').reset();
        document.getElementById('bulkPreviewSection').style.display = 'none';
        document.getElementById('executeBulkBtn').disabled = true;
        bulkPreviewResult = null;

        // Set default effective date
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('bulkEffectiveFrom').value = tomorrow.toISOString().split('T')[0];

        // Update title
        document.getElementById('bulkAssignModalTitle').textContent =
            `Bulk Assign - ${currentVersionStructureName} v${bulkAssignVersionNumber}`;

        openModal('bulkAssignModal');
        hideLoading();
    } catch (error) {
        console.error('Error opening bulk assign modal:', error);
        showToast(error.message || 'Failed to load bulk assignment', 'error');
        hideLoading();
    }
}

/**
 * Load filters for bulk assignment
 */
async function loadBulkAssignFilters() {
    try {
        // Load offices
        const officesData = await api.getHrmsOffices();
        const officeSelect = document.getElementById('bulkOfficeId');
        officeSelect.innerHTML = '<option value="">All Offices</option>' +
            (officesData || []).map(o => `<option value="${o.id}">${o.office_name}</option>`).join('');

        // Load departments
        const departmentsData = await api.getHrmsDepartments();
        const deptSelect = document.getElementById('bulkDepartmentId');
        deptSelect.innerHTML = '<option value="">All Departments</option>' +
            (departmentsData || []).map(d => `<option value="${d.id}">${d.department_name}</option>`).join('');

        // Load designations
        const designationsData = await api.getHrmsDesignations();
        const desigSelect = document.getElementById('bulkDesignationId');
        desigSelect.innerHTML = '<option value="">All Designations</option>' +
            (designationsData || []).map(d => `<option value="${d.id}">${d.designation_name}</option>`).join('');
    } catch (error) {
        console.error('Error loading bulk assign filters:', error);
    }
}

/**
 * Validate if a string is a valid GUID/UUID format
 */
function isValidGuid(value) {
    if (!value || value === '') return false;
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidRegex.test(value);
}

/**
 * Parse GUID from dropdown value, returns null if invalid
 */
function parseGuidOrNull(value) {
    if (!value || value === '' || value === 'undefined' || value === 'null') {
        return null;
    }
    if (!isValidGuid(value)) {
        console.warn(`Invalid GUID format: ${value}`);
        return null;
    }
    return value;
}

/**
 * Preview bulk assignment
 */
async function previewBulkAssignment() {
    const effectiveFrom = document.getElementById('bulkEffectiveFrom').value;
    if (!effectiveFrom) {
        showToast('Please select an effective date', 'error');
        return;
    }

    // Parse and validate filter values
    const officeId = parseGuidOrNull(document.getElementById('bulkOfficeId').value);
    const departmentId = parseGuidOrNull(document.getElementById('bulkDepartmentId').value);
    const designationId = parseGuidOrNull(document.getElementById('bulkDesignationId').value);

    // At least one filter must be selected
    if (!officeId && !departmentId && !designationId) {
        // Don't show error if this is an auto-triggered change event
        // Just reset the preview section silently
        document.getElementById('bulkPreviewSection').style.display = 'none';
        document.getElementById('executeBulkBtn').disabled = true;
        bulkPreviewResult = null;
        return;
    }

    // Validate effective date is not too old or too far in future
    const effectiveDate = new Date(effectiveFrom);
    const today = new Date();
    const minDate = new Date(today.getFullYear() - 5, 0, 1); // 5 years ago
    const maxDate = new Date(today.getFullYear() + 2, 11, 31); // 2 years from now

    if (effectiveDate < minDate) {
        showToast('Effective date cannot be more than 5 years in the past', 'error');
        return;
    }
    if (effectiveDate > maxDate) {
        showToast('Effective date cannot be more than 2 years in the future', 'error');
        return;
    }

    try {
        showLoading();

        const request = {
            structure_id: bulkAssignStructureId,
            version_number: bulkAssignVersionNumber,
            effective_from: effectiveFrom,
            office_id: officeId,
            department_id: departmentId,
            designation_id: designationId,
            preview_only: true,
            calculate_arrears: document.getElementById('bulkCalculateArrears').checked,
            reason: document.getElementById('bulkReason').value || null
        };

        bulkPreviewResult = await api.bulkAssignVersion(bulkAssignStructureId, bulkAssignVersionNumber, request);

        // Update preview UI
        document.getElementById('bulkPreviewSection').style.display = 'block';
        document.getElementById('bulkMatchedCount').textContent = bulkPreviewResult.total_employees_matched || 0;
        document.getElementById('bulkToAssignCount').textContent = bulkPreviewResult.employees_to_assign || 0;
        document.getElementById('bulkEstArrears').textContent =
            `₹${(bulkPreviewResult.estimated_arrears_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

        // Update preview table
        const tbody = document.getElementById('bulkPreviewTable');
        const employees = bulkPreviewResult.employee_details || bulkPreviewResult.employees || [];

        if (employees.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No employees matched the selected criteria</td></tr>';
        } else {
            tbody.innerHTML = employees.slice(0, 20).map(e => `
                <tr class="${e.status !== 'skipped' ? '' : 'text-muted'}">
                    <td>
                        <strong>${e.employee_name || 'N/A'}</strong>
                        <br><small class="text-muted">${e.employee_code || ''}</small>
                    </td>
                    <td>${e.current_structure_name || e.current_structure || '-'}</td>
                    <td>₹${(e.current_ctc || 0).toLocaleString('en-IN')}</td>
                    <td>${e.status !== 'skipped' ?
                        `₹${(e.arrears_amount || e.estimated_arrears || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` :
                        `<span class="text-muted">${e.error_message || 'Skipped'}</span>`}</td>
                </tr>
            `).join('');

            if (employees.length > 20) {
                tbody.innerHTML += `<tr><td colspan="4" class="text-center text-muted">...and ${employees.length - 20} more</td></tr>`;
            }
        }

        // Enable execute button if there are employees to assign
        const toAssign = bulkPreviewResult.employees_to_update || bulkPreviewResult.employees_to_assign || 0;
        document.getElementById('executeBulkBtn').disabled = toAssign === 0;

        hideLoading();
    } catch (error) {
        console.error('Error previewing bulk assignment:', error);
        // Extract user-friendly error message from API response
        const errorMessage = error.error || error.message || 'Failed to preview assignment';
        showToast(errorMessage, 'error');

        // Reset preview section on error
        document.getElementById('bulkPreviewSection').style.display = 'none';
        document.getElementById('executeBulkBtn').disabled = true;
        bulkPreviewResult = null;

        hideLoading();
    }
}

/**
 * Execute bulk assignment
 */
async function executeBulkAssignment() {
    // Validate preview result exists
    if (!bulkPreviewResult || bulkPreviewResult.employees_to_assign === 0) {
        showToast('No employees to assign. Please preview first.', 'error');
        return;
    }

    // Validate structure ID and version number
    if (!bulkAssignStructureId || !isValidGuid(bulkAssignStructureId)) {
        showToast('Invalid structure ID', 'error');
        return;
    }

    if (!bulkAssignVersionNumber || bulkAssignVersionNumber <= 0) {
        showToast('Invalid version number', 'error');
        return;
    }

    // Validate effective date
    const effectiveFrom = document.getElementById('bulkEffectiveFrom').value;
    if (!effectiveFrom) {
        showToast('Please select an effective date', 'error');
        return;
    }

    // Date range validation
    const effectiveDate = new Date(effectiveFrom);
    const today = new Date();
    const minDate = new Date(today.getFullYear() - 5, 0, 1);
    const maxDate = new Date(today.getFullYear() + 2, 11, 31);

    if (effectiveDate < minDate) {
        showToast('Effective date cannot be more than 5 years in the past', 'error');
        return;
    }
    if (effectiveDate > maxDate) {
        showToast('Effective date cannot be more than 2 years in the future', 'error');
        return;
    }

    // Parse and validate GUIDs
    const officeId = parseGuidOrNull(document.getElementById('bulkOfficeId').value);
    const departmentId = parseGuidOrNull(document.getElementById('bulkDepartmentId').value);
    const designationId = parseGuidOrNull(document.getElementById('bulkDesignationId').value);

    // At least one filter must be specified
    if (!officeId && !departmentId && !designationId) {
        showToast('At least one filter (office, department, or designation) must be selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Bulk Assign Structure',
        message: `Are you sure you want to assign this structure version to ${bulkPreviewResult.employees_to_assign} employees?`,
        type: 'warning',
        confirmText: 'Assign',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();

        const request = {
            structure_id: bulkAssignStructureId,
            version_number: bulkAssignVersionNumber,
            effective_from: effectiveFrom,
            office_id: officeId,
            department_id: departmentId,
            designation_id: designationId,
            preview_only: false,  // Actually execute
            calculate_arrears: document.getElementById('bulkCalculateArrears').checked,
            reason: document.getElementById('bulkReason').value || null
        };

        const result = await api.bulkAssignVersion(bulkAssignStructureId, bulkAssignVersionNumber, request);

        closeModal('bulkAssignModal');
        showToast(`Successfully assigned structure to ${result.employees_assigned || result.employees_to_assign} employees`, 'success');

        // Refresh data
        await loadStructures();

        hideLoading();
    } catch (error) {
        console.error('Error executing bulk assignment:', error);
        const errorMessage = error.error || error.message || 'Failed to execute assignment';
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

// ============================================
// ENHANCED VERSION COMPARISON
// ============================================

/**
 * Enhanced version comparison with visual diff
 */
async function showVersionComparison(fromVersionId, toVersionId) {
    try {
        showLoading();

        const comparison = await api.compareVersionSnapshots(fromVersionId, toVersionId);

        if (!comparison) {
            showToast('Could not compare versions', 'error');
            hideLoading();
            return;
        }

        // Update header
        document.getElementById('compareFromVersion').textContent = `v${comparison.from_version?.version_number || '?'}`;
        document.getElementById('compareToVersion').textContent = `v${comparison.to_version?.version_number || '?'}`;
        document.getElementById('compareFromDate').textContent = formatDate(comparison.from_version?.effective_from);
        document.getElementById('compareToDate').textContent = formatDate(comparison.to_version?.effective_from);

        // Update summary badges
        const summary = comparison.summary || {};
        document.getElementById('addedCount').textContent = `+ ${summary.components_added || 0} Added`;
        document.getElementById('removedCount').textContent = `- ${summary.components_removed || 0} Removed`;
        document.getElementById('modifiedCount').textContent = `~ ${summary.components_modified || 0} Modified`;
        document.getElementById('unchangedCount').textContent = `= ${summary.components_unchanged || 0} Unchanged`;

        // Render added components
        const addedSection = document.getElementById('addedSection');
        const addedList = document.getElementById('addedList');
        if (comparison.added_components?.length > 0) {
            addedSection.style.display = 'block';
            addedList.innerHTML = comparison.added_components.map(c => `
                <div style="padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                    <strong>${c.component_name}</strong> (${c.component_code})
                    <br><small class="text-muted">
                        ${c.new_values?.percentage_of_basic ? `${c.new_values.percentage_of_basic}% of Basic` : ''}
                        ${c.new_values?.fixed_amount ? `₹${c.new_values.fixed_amount}` : ''}
                    </small>
                </div>
            `).join('');
        } else {
            addedSection.style.display = 'none';
        }

        // Render removed components
        const removedSection = document.getElementById('removedSection');
        const removedList = document.getElementById('removedList');
        if (comparison.removed_components?.length > 0) {
            removedSection.style.display = 'block';
            removedList.innerHTML = comparison.removed_components.map(c => `
                <div style="padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                    <strong>${c.component_name}</strong> (${c.component_code})
                </div>
            `).join('');
        } else {
            removedSection.style.display = 'none';
        }

        // Render modified components
        const modifiedSection = document.getElementById('modifiedSection');
        const modifiedList = document.getElementById('modifiedList');
        if (comparison.modified_components?.length > 0) {
            modifiedSection.style.display = 'block';
            modifiedList.innerHTML = comparison.modified_components.map(c => `
                <div style="padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                    <strong>${c.component_name}</strong> (${c.component_code})
                    ${(c.changes || []).map(change => `
                        <div style="margin-left: 16px; margin-top: 4px;">
                            <small>
                                <span class="text-muted">${change.field}:</span>
                                <span class="text-danger-dark" style="text-decoration: line-through;">${formatChangeValue(change.old_value)}</span>
                                →
                                <span class="text-success-dark" style="font-weight: 600;">${formatChangeValue(change.new_value)}</span>
                            </small>
                        </div>
                    `).join('')}
                </div>
            `).join('');
        } else {
            modifiedSection.style.display = 'none';
        }

        // Render unchanged components
        const unchangedSection = document.getElementById('unchangedSection');
        const unchangedList = document.getElementById('unchangedList');
        if (comparison.unchanged_components?.length > 0) {
            unchangedSection.style.display = 'block';
            unchangedList.innerHTML = `<small class="text-muted">${comparison.unchanged_components.join(', ')}</small>`;
        } else {
            unchangedSection.style.display = 'none';
        }

        openModal('versionCompareModal');
        hideLoading();
    } catch (error) {
        console.error('Error comparing versions:', error);
        showToast(error.message || 'Failed to compare versions', 'error');
        hideLoading();
    }
}

/**
 * Format change value for display
 */
function formatChangeValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number') {
        if (value % 1 !== 0) return value.toFixed(2);
        return value.toString();
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

/**
 * Override compareVersions to use new visual modal
 */
async function compareVersionsVisual(structureId, fromVersion, toVersion) {
    try {
        showLoading();

        // Get version IDs from version numbers
        const versions = await api.getStructureVersions(structureId);
        const fromVersionObj = versions.find(v => v.version_number === fromVersion);
        const toVersionObj = versions.find(v => v.version_number === toVersion);

        if (!fromVersionObj || !toVersionObj) {
            showToast('Could not find version details', 'error');
            hideLoading();
            return;
        }

        await showVersionComparison(fromVersionObj.id, toVersionObj.id);
    } catch (error) {
        console.error('Error comparing versions:', error);
        showToast(error.message || 'Failed to compare versions', 'error');
        hideLoading();
    }
}

// ============================================================================
// PAYROLL APPROVAL WORKFLOW FUNCTIONS
// ============================================================================

/**
 * Approve a processed payroll run
 * Backend: POST /api/payroll-processing/runs/{runId}/approve
 */
async function approvePayrollRun() {
    if (!currentPayrollRunId) {
        showToast('No payroll run selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Approve Payroll Run',
        message: 'Are you sure you want to approve this payroll run? This action cannot be undone.',
        type: 'success',
        confirmText: 'Approve',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();

        await api.request(`/hrms/payroll-processing/runs/${currentPayrollRunId}/approve`, {
            method: 'POST'
        });

        showToast('Payroll run approved successfully', 'success');

        // Refresh the payroll runs list
        await loadPayrollRuns();

        // Close and reopen the modal to show updated status
        closeModal('payrollRunDetailsModal');
        await viewPayrollRun(currentPayrollRunId);

    } catch (error) {
        console.error('Error approving payroll run:', error);
        showToast(error.message || 'Failed to approve payroll run', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Show the Mark as Paid modal
 */
function showMarkPaidModal() {
    if (!currentPayrollRunId) {
        showToast('No payroll run selected', 'error');
        return;
    }

    // Clear previous input
    document.getElementById('paymentBatchRef').value = '';

    // Generate a suggested batch reference
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    document.getElementById('paymentBatchRef').placeholder = `e.g., BATCH-${year}-${month}-${day}`;

    openModal('markPaidModal');
}

/**
 * Confirm marking the payroll run as paid
 * Backend: POST /api/payroll-processing/runs/{runId}/mark-paid
 */
async function confirmMarkPaid() {
    if (!currentPayrollRunId) {
        showToast('No payroll run selected', 'error');
        return;
    }

    const batchRef = document.getElementById('paymentBatchRef').value.trim();

    if (!batchRef) {
        showToast('Payment batch reference is required', 'error');
        document.getElementById('paymentBatchRef').focus();
        return;
    }

    try {
        showLoading();

        await api.request(`/hrms/payroll-processing/runs/${currentPayrollRunId}/mark-paid`, {
            method: 'POST',
            body: JSON.stringify({
                payment_batch_ref: batchRef
            })
        });

        showToast('Payroll marked as paid successfully', 'success');

        // Close the mark paid modal
        closeModal('markPaidModal');

        // Refresh the payroll runs list
        await loadPayrollRuns();

        // Close and reopen the details modal to show updated status
        closeModal('payrollRunDetailsModal');
        await viewPayrollRun(currentPayrollRunId);

    } catch (error) {
        console.error('Error marking payroll as paid:', error);
        showToast(error.message || 'Failed to mark payroll as paid', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Download bank transfer file for payroll disbursement
 * Backend: GET /api/payroll-processing/runs/{runId}/bank-file
 */
async function downloadBankFile() {
    if (!currentPayrollRunId) {
        showToast('No payroll run selected', 'error');
        return;
    }

    try {
        showLoading();

        const response = await api.request(`/hrms/payroll-processing/runs/${currentPayrollRunId}/bank-file`);

        if (!response || !response.records) {
            showToast('No bank file data available', 'error');
            hideLoading();
            return;
        }

        // Generate CSV content
        const headers = [
            'Employee Code',
            'Employee Name',
            'Bank Name',
            'Account Number',
            'IFSC Code',
            'Net Pay',
            'Payment Reference'
        ];

        let csvContent = headers.join(',') + '\n';

        response.records.forEach(record => {
            const row = [
                escapeCSVField(record.employee_code || ''),
                escapeCSVField(record.employee_name || ''),
                escapeCSVField(record.bank_name || ''),
                escapeCSVField(record.account_number || ''),
                escapeCSVField(record.ifsc_code || ''),
                record.net_pay || 0,
                escapeCSVField(record.payment_reference || '')
            ];
            csvContent += row.join(',') + '\n';
        });

        // Download the file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = response.file_name || `BankTransfer_${currentPayrollRunId}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        showToast(`Bank file downloaded: ${response.record_count} records, Total: ${formatCurrency(response.total_amount)}`, 'success');

    } catch (error) {
        console.error('Error downloading bank file:', error);
        showToast(error.message || 'Failed to download bank file', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Escape a field for CSV format
 */
function escapeCSVField(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// ============================================================================
// ARREARS MANAGEMENT FUNCTIONS
// ============================================================================

let arrearsData = [];
let filteredArrearsData = [];
let currentArrearsId = null;

/**
 * Load pending arrears from the API
 * Backend: GET /api/payroll/structures/arrears/pending
 */
async function loadPendingArrears() {
    try {
        showLoading();

        const status = document.getElementById('arrearsStatus')?.value || 'pending';
        const structureId = document.getElementById('arrearsStructure')?.value || '';

        let url = '/hrms/payroll/structures/arrears/pending';
        const params = [];
        if (status) params.push(`status=${status}`);
        if (structureId) params.push(`versionId=${structureId}`);
        if (params.length > 0) url += '?' + params.join('&');

        const response = await api.request(url);
        arrearsData = response || [];
        filteredArrearsData = [...arrearsData];

        // Populate structure filter dropdown
        populateArrearsStructureFilter();

        // Update stats
        updateArrearsStats();

        // Render table
        updateArrearsTable();

        hideLoading();
    } catch (error) {
        console.error('Error loading arrears:', error);
        showToast(error.message || 'Failed to load arrears', 'error');
        arrearsData = [];
        filteredArrearsData = [];
        updateArrearsTable();
        hideLoading();
    }
}

/**
 * Populate the structure filter dropdown
 */
function populateArrearsStructureFilter() {
    const select = document.getElementById('arrearsStructure');
    if (!select) return;

    // Get unique structures from arrears data
    const structureMap = new Map();
    arrearsData.forEach(arr => {
        if (arr.structure_id && arr.structure_name) {
            structureMap.set(arr.structure_id, arr.structure_name);
        }
    });

    // Keep the first option
    select.innerHTML = '<option value="">All Structures</option>';

    structureMap.forEach((name, id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        select.appendChild(option);
    });
}

/**
 * Update arrears summary statistics
 */
function updateArrearsStats() {
    const totalCount = arrearsData.length;
    const pendingCount = arrearsData.filter(a => a.status === 'pending').length;
    const totalAmount = arrearsData.reduce((sum, a) => sum + (a.arrears_amount || 0), 0);
    const uniqueEmployees = new Set(arrearsData.map(a => a.employee_id)).size;

    document.getElementById('totalArrearsCount').textContent = totalCount;
    document.getElementById('pendingArrearsCount').textContent = pendingCount;
    document.getElementById('totalArrearsAmount').textContent = formatCurrency(totalAmount);
    document.getElementById('affectedEmployeesCount').textContent = uniqueEmployees;
}

/**
 * Filter arrears table by search term
 */
function filterArrearsTable() {
    const searchTerm = document.getElementById('arrearsSearch')?.value.toLowerCase() || '';

    if (!searchTerm) {
        filteredArrearsData = [...arrearsData];
    } else {
        filteredArrearsData = arrearsData.filter(arr =>
            (arr.employee_name && arr.employee_name.toLowerCase().includes(searchTerm)) ||
            (arr.employee_code && arr.employee_code.toLowerCase().includes(searchTerm))
        );
    }

    updateArrearsTable();
}

/**
 * Update the arrears table display
 */
function updateArrearsTable() {
    const tbody = document.getElementById('arrearsTable');
    if (!tbody) return;

    if (filteredArrearsData.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="9">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        <p>No arrears found</p>
                        <p class="hint">Arrears are generated when salary structure versions are applied retrospectively</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredArrearsData.map(arr => `
        <tr>
            <td>
                <div class="employee-info">
                    <span class="employee-name">${arr.employee_name || 'N/A'}</span>
                    <span class="employee-code">${arr.employee_code || ''}</span>
                </div>
            </td>
            <td>${arr.structure_name || 'N/A'}</td>
            <td>v${arr.version_number || '?'}</td>
            <td>${getMonthName(arr.payroll_month)} ${arr.payroll_year}</td>
            <td class="text-right">${formatCurrency(arr.old_gross)}</td>
            <td class="text-right">${formatCurrency(arr.new_gross)}</td>
            <td class="text-right text-success-dark"><strong>${formatCurrency(arr.arrears_amount)}</strong></td>
            <td><span class="status-badge status-${arr.status}">${arr.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewArrearsDetails('${arr.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    ${arr.status === 'pending' ? `
                        <button class="action-btn text-success" onclick="applyArrearsQuick('${arr.id}')" title="Apply">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                        <button class="action-btn text-danger" onclick="cancelArrearsQuick('${arr.id}')" title="Cancel">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * View arrears details in modal
 */
async function viewArrearsDetails(arrearsId) {
    try {
        showLoading();
        currentArrearsId = arrearsId;

        // Find the arrears in our data
        const arrears = arrearsData.find(a => a.id === arrearsId);
        if (!arrears) {
            showToast('Arrears not found', 'error');
            hideLoading();
            return;
        }

        // Build the details content
        const content = `
            <div class="arrears-details" style="font-size: 13px;">
                <div class="detail-header" style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--gray-200);">
                    <h4 style="margin: 0 0 4px 0; font-size: 15px;">${arrears.employee_name || 'Unknown Employee'}</h4>
                    <span class="employee-code" style="color: var(--gray-500); font-size: 12px;">${arrears.employee_code || ''}</span>
                    <span class="status-badge status-${arrears.status}" style="margin-left: 10px; font-size: 11px;">${arrears.status}</span>
                </div>

                <div class="detail-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
                    <div class="detail-item">
                        <label style="color: var(--gray-500); font-size: 11px; display: block; margin-bottom: 2px;">Structure</label>
                        <strong style="font-size: 13px;">${arrears.structure_name || 'N/A'}</strong>
                    </div>
                    <div class="detail-item">
                        <label style="color: var(--gray-500); font-size: 11px; display: block; margin-bottom: 2px;">Version</label>
                        <strong style="font-size: 13px;">Version ${arrears.version_number || '?'}</strong>
                    </div>
                    <div class="detail-item">
                        <label style="color: var(--gray-500); font-size: 11px; display: block; margin-bottom: 2px;">Period</label>
                        <strong style="font-size: 13px;">${getMonthName(arrears.payroll_month)} ${arrears.payroll_year}</strong>
                    </div>
                    <div class="detail-item">
                        <label style="color: var(--gray-500); font-size: 11px; display: block; margin-bottom: 2px;">Created</label>
                        <strong style="font-size: 13px;">${formatDate(arrears.created_at)}</strong>
                    </div>
                </div>

                <div class="calculation-breakdown" style="background: var(--gray-50); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
                    <h5 style="margin: 0 0 10px 0; font-size: 13px;">Calculation Breakdown</h5>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span>Old Gross Salary</span>
                        <span>${formatCurrency(arrears.old_gross)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span>New Gross Salary</span>
                        <span>${formatCurrency(arrears.new_gross)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span>Old Deductions</span>
                        <span>${formatCurrency(arrears.old_deductions || 0)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span>New Deductions</span>
                        <span>${formatCurrency(arrears.new_deductions || 0)}</span>
                    </div>
                    <hr style="border: none; border-top: 1px solid var(--gray-300); margin: 10px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 600; color: var(--color-success);">
                        <span>Arrears Amount</span>
                        <span>${formatCurrency(arrears.arrears_amount)}</span>
                    </div>
                </div>

                ${arrears.items && arrears.items.length > 0 ? `
                    <div class="component-breakdown">
                        <h5 style="margin: 0 0 10px 0; font-size: 13px;">Component-wise Breakdown</h5>
                        <table class="data-table" style="font-size: 12px;">
                            <thead>
                                <tr>
                                    <th style="padding: 6px 8px;">Component</th>
                                    <th class="text-right" style="padding: 6px 8px;">Old Amount</th>
                                    <th class="text-right" style="padding: 6px 8px;">New Amount</th>
                                    <th class="text-right" style="padding: 6px 8px;">Difference</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${arrears.items.map(item => `
                                    <tr>
                                        <td style="padding: 6px 8px;">${item.component_name || item.component_code}</td>
                                        <td class="text-right" style="padding: 6px 8px;">${formatCurrency(item.old_amount)}</td>
                                        <td class="text-right" style="padding: 6px 8px;">${formatCurrency(item.new_amount)}</td>
                                        <td class="text-right ${item.difference > 0 ? 'text-success' : item.difference < 0 ? 'text-danger' : ''}" style="padding: 6px 8px;">${formatCurrency(item.difference)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : ''}

                ${arrears.applied_in_payslip_id ? `
                    <div class="applied-info" style="margin-top: 12px; padding: 10px; background: var(--color-success-light); border-radius: 8px; font-size: 12px;">
                        <strong>Applied in Payslip:</strong> ${arrears.applied_in_payslip_number || arrears.applied_in_payslip_id}
                    </div>
                ` : ''}
            </div>
        `;

        document.getElementById('arrearsDetailsContent').innerHTML = content;

        // Show/hide action buttons based on status
        const applyBtn = document.getElementById('applyArrearsBtn');
        const cancelBtn = document.getElementById('cancelArrearsBtn');

        if (applyBtn) {
            applyBtn.style.display = arrears.status === 'pending' ? 'inline-flex' : 'none';
        }
        if (cancelBtn) {
            cancelBtn.style.display = arrears.status === 'pending' ? 'inline-flex' : 'none';
        }

        openModal('arrearsDetailsModal');
        hideLoading();
    } catch (error) {
        console.error('Error viewing arrears details:', error);
        showToast(error.message || 'Failed to load arrears details', 'error');
        hideLoading();
    }
}

/**
 * Apply arrears to next payroll
 * Backend: POST /api/payroll/structures/arrears/{arrearsId}/apply
 */
async function applyArrears() {
    if (!currentArrearsId) {
        showToast('No arrears selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Apply Arrears',
        message: 'Are you sure you want to apply this arrears to the next payroll run?',
        type: 'info',
        confirmText: 'Apply',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();

        await api.request(`/hrms/payroll/structures/arrears/${currentArrearsId}/apply`, {
            method: 'POST'
        });

        showToast('Arrears applied successfully', 'success');
        closeModal('arrearsDetailsModal');
        await loadPendingArrears();

    } catch (error) {
        console.error('Error applying arrears:', error);
        showToast(error.message || 'Failed to apply arrears', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Quick apply arrears from table
 */
async function applyArrearsQuick(arrearsId) {
    const confirmed = await Confirm.show({
        title: 'Apply Arrears',
        message: 'Apply this arrears to the next payroll run?',
        type: 'info',
        confirmText: 'Apply',
        cancelText: 'Cancel'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();

        await api.request(`/hrms/payroll/structures/arrears/${arrearsId}/apply`, {
            method: 'POST'
        });

        showToast('Arrears applied successfully', 'success');
        await loadPendingArrears();

    } catch (error) {
        console.error('Error applying arrears:', error);
        showToast(error.message || 'Failed to apply arrears', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Cancel pending arrears
 * Backend: POST /api/payroll/structures/arrears/{arrearsId}/cancel
 */
async function cancelArrears() {
    if (!currentArrearsId) {
        showToast('No arrears selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Cancel Arrears',
        message: 'Are you sure you want to cancel this arrears? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Cancel Arrears',
        cancelText: 'Keep'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();

        await api.request(`/hrms/payroll/structures/arrears/${currentArrearsId}/cancel`, {
            method: 'POST'
        });

        showToast('Arrears cancelled successfully', 'success');
        closeModal('arrearsDetailsModal');
        await loadPendingArrears();

    } catch (error) {
        console.error('Error cancelling arrears:', error);
        showToast(error.message || 'Failed to cancel arrears', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Quick cancel arrears from table
 */
async function cancelArrearsQuick(arrearsId) {
    const confirmed = await Confirm.show({
        title: 'Cancel Arrears',
        message: 'Cancel this arrears? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Cancel Arrears',
        cancelText: 'Keep'
    });
    if (!confirmed) {
        return;
    }

    try {
        showLoading();

        await api.request(`/hrms/payroll/structures/arrears/${arrearsId}/cancel`, {
            method: 'POST'
        });

        showToast('Arrears cancelled successfully', 'success');
        await loadPendingArrears();

    } catch (error) {
        console.error('Error cancelling arrears:', error);
        showToast(error.message || 'Failed to cancel arrears', 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================================
// CTC REVISION ARREARS FUNCTIONS
// ============================================================================

let ctcArrearsData = [];
let filteredCtcArrearsData = [];
let selectedCtcArrearsIds = [];
let currentCtcArrearsId = null;

/**
 * Switch between Version Arrears and CTC Revision Arrears sub-tabs
 */
function switchArrearsSubtab(subtabId) {
    // Update sub-tab buttons
    document.querySelectorAll('.arrears-subtab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subtab === subtabId);
    });

    // Update sub-tab content
    document.querySelectorAll('.arrears-subtab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${subtabId}-content`);
    });

    // Load data for the selected sub-tab
    if (subtabId === 'version-arrears') {
        loadPendingArrears();
    } else if (subtabId === 'ctc-arrears') {
        loadCtcRevisionArrears();
    }
}

/**
 * Load CTC Revision Arrears from the API
 * Backend: GET /api/payroll/ctc-arrears/pending
 */
async function loadCtcRevisionArrears() {
    try {
        showLoading();

        const status = document.getElementById('ctcArrearsStatus')?.value || 'pending';

        let url = '/hrms/payroll/ctc-arrears/pending';
        if (status) {
            url += `?status=${status}`;
        }

        const response = await api.request(url);
        ctcArrearsData = response || [];
        filteredCtcArrearsData = [...ctcArrearsData];
        selectedCtcArrearsIds = [];

        // Update stats
        updateCtcArrearsStats();

        // Render table
        updateCtcArrearsTable();

        hideLoading();
    } catch (error) {
        console.error('Error loading CTC revision arrears:', error);
        showToast(error.message || 'Failed to load CTC revision arrears', 'error');
        ctcArrearsData = [];
        filteredCtcArrearsData = [];
        updateCtcArrearsStats();
        updateCtcArrearsTable();
        hideLoading();
    }
}

/**
 * Update CTC arrears summary statistics
 */
function updateCtcArrearsStats() {
    const totalCount = ctcArrearsData.length;
    const pendingCount = ctcArrearsData.filter(a => a.status === 'pending').length;
    const totalAmount = ctcArrearsData.reduce((sum, a) => sum + (a.total_arrears_amount || 0), 0);
    const uniqueEmployees = new Set(ctcArrearsData.map(a => a.employee_id)).size;

    document.getElementById('totalCtcArrearsCount').textContent = totalCount;
    document.getElementById('pendingCtcArrearsCount').textContent = pendingCount;
    document.getElementById('totalCtcArrearsAmount').textContent = formatCurrency(totalAmount);
    document.getElementById('affectedCtcEmployeesCount').textContent = uniqueEmployees;
}

/**
 * Filter CTC arrears table by search term
 */
function filterCtcArrearsTable() {
    const searchTerm = document.getElementById('ctcArrearsSearch')?.value.toLowerCase() || '';

    if (!searchTerm) {
        filteredCtcArrearsData = [...ctcArrearsData];
    } else {
        filteredCtcArrearsData = ctcArrearsData.filter(arr =>
            (arr.employee_name?.toLowerCase().includes(searchTerm)) ||
            (arr.employee_code?.toLowerCase().includes(searchTerm))
        );
    }

    updateCtcArrearsTable();
}

/**
 * Update CTC arrears table display
 */
function updateCtcArrearsTable() {
    const tbody = document.getElementById('ctcArrearsTable');
    if (!tbody) return;

    if (filteredCtcArrearsData.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="9">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <p>No CTC revision arrears found</p>
                        <p class="hint">Arrears are generated when employee salaries are revised retroactively</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filteredCtcArrearsData.map(arr => {
        const isPending = arr.status === 'pending';
        const revisionType = arr.revision_type || 'adjustment';

        return `
        <tr class="${isPending ? 'pending' : ''}" data-id="${arr.id}">
            <td>
                <input type="checkbox" class="ctc-arrears-checkbox" value="${arr.id}"
                    ${selectedCtcArrearsIds.includes(arr.id) ? 'checked' : ''}
                    ${isPending ? '' : 'disabled'}
                    onchange="toggleCtcArrearsSelection('${arr.id}', this.checked)">
            </td>
            <td>
                <div class="employee-info">
                    <strong>${escapeHtml(arr.employee_name || 'Unknown')}</strong>
                    <span class="employee-code">${escapeHtml(arr.employee_code || '')}</span>
                </div>
            </td>
            <td>
                <span class="revision-type-badge ${revisionType}">${formatRevisionType(revisionType)}</span>
            </td>
            <td>${getMonthName(arr.payroll_month)} ${arr.payroll_year}</td>
            <td class="text-right">${formatCurrency(arr.old_ctc)}</td>
            <td class="text-right">${formatCurrency(arr.new_ctc)}</td>
            <td class="text-right ${arr.total_arrears_amount > 0 ? 'arrears-positive' : 'arrears-negative'}">
                ${formatCurrency(arr.total_arrears_amount)}
            </td>
            <td><span class="status-badge status-${arr.status}">${arr.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewCtcArrearsDetails('${arr.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    ${isPending ? `
                        <button class="action-btn text-success" onclick="applyCtcArrearsQuick('${arr.id}')" title="Apply">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                        <button class="action-btn text-danger" onclick="cancelCtcArrearsQuick('${arr.id}')" title="Cancel">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `}).join('');
}

/**
 * Format revision type for display
 */
function formatRevisionType(type) {
    const types = {
        'promotion': 'Promotion',
        'annual_increment': 'Annual Increment',
        'adjustment': 'Adjustment',
        'correction': 'Correction'
    };
    return types[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Toggle CTC arrears selection
 */
function toggleCtcArrearsSelection(id, checked) {
    if (checked) {
        if (!selectedCtcArrearsIds.includes(id)) {
            selectedCtcArrearsIds.push(id);
        }
    } else {
        selectedCtcArrearsIds = selectedCtcArrearsIds.filter(aid => aid !== id);
    }
    updateSelectAllCheckbox();
}

/**
 * Toggle all CTC arrears checkboxes
 */
function toggleAllCtcArrears(checkbox) {
    const checkboxes = document.querySelectorAll('.ctc-arrears-checkbox:not(:disabled)');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
        toggleCtcArrearsSelection(cb.value, checkbox.checked);
    });
}

/**
 * Update the select all checkbox state
 */
function updateSelectAllCheckbox() {
    const selectAll = document.getElementById('ctcArrearsSelectAll');
    const checkboxes = document.querySelectorAll('.ctc-arrears-checkbox:not(:disabled)');
    const checkedCount = selectedCtcArrearsIds.length;

    if (selectAll) {
        selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
        selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }
}

/**
 * View CTC arrears details
 */
async function viewCtcArrearsDetails(arrearsId) {
    try {
        showLoading();
        currentCtcArrearsId = arrearsId;

        // Fetch details from API
        const arrears = await api.request(`/hrms/payroll/ctc-arrears/${arrearsId}`);
        if (!arrears) {
            showToast('CTC revision arrears not found', 'error');
            hideLoading();
            return;
        }

        // Build the details modal content
        const content = `
            <div class="ctc-arrears-details">
                <div class="detail-header" style="margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color);">
                    <h4 style="margin: 0 0 4px 0;">${escapeHtml(arrears.employee_name || 'Unknown Employee')}</h4>
                    <span class="employee-code" style="color: var(--text-secondary);">${escapeHtml(arrears.employee_code || '')}</span>
                    <span class="status-badge status-${arrears.status}" style="margin-left: 10px;">${arrears.status}</span>
                    <span class="revision-type-badge ${arrears.revision_type}" style="margin-left: 10px;">${formatRevisionType(arrears.revision_type)}</span>
                </div>

                <div class="ctc-arrears-summary">
                    <div class="ctc-summary-card">
                        <div class="value">${formatCurrency(arrears.old_ctc)}</div>
                        <div class="label">Old CTC</div>
                    </div>
                    <div class="ctc-summary-card">
                        <div class="value">${formatCurrency(arrears.new_ctc)}</div>
                        <div class="label">New CTC</div>
                    </div>
                    <div class="ctc-summary-card">
                        <div class="value">${arrears.arrears_months || 1} month(s)</div>
                        <div class="label">Period</div>
                    </div>
                    <div class="ctc-summary-card highlight">
                        <div class="value">${formatCurrency(arrears.total_arrears_amount)}</div>
                        <div class="label">Total Arrears</div>
                    </div>
                </div>

                <div class="detail-section" style="margin-bottom: 20px;">
                    <h5 style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-primary);">Revision Details</h5>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 16px; background: var(--bg-input); border-radius: 10px;">
                        <div>
                            <span style="font-size: 12px; color: var(--text-secondary); display: block;">Effective From</span>
                            <strong style="font-size: 14px;">${formatDate(arrears.effective_from)}</strong>
                        </div>
                        <div>
                            <span style="font-size: 12px; color: var(--text-secondary); display: block;">Revision Reason</span>
                            <strong style="font-size: 14px;">${escapeHtml(arrears.revision_reason || 'N/A')}</strong>
                        </div>
                        <div>
                            <span style="font-size: 12px; color: var(--text-secondary); display: block;">Arrears From</span>
                            <strong style="font-size: 14px;">${getMonthName(arrears.arrears_from_month)} ${arrears.arrears_from_year}</strong>
                        </div>
                        <div>
                            <span style="font-size: 12px; color: var(--text-secondary); display: block;">Arrears To</span>
                            <strong style="font-size: 14px;">${getMonthName(arrears.arrears_to_month)} ${arrears.arrears_to_year}</strong>
                        </div>
                    </div>
                </div>

                ${arrears.daily_breakdown && arrears.daily_breakdown.length > 0 ? `
                    <div class="detail-section">
                        <h5 style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-primary);">Monthly Breakdown</h5>
                        <table class="ctc-breakdown-table">
                            <thead>
                                <tr>
                                    <th>Month</th>
                                    <th class="text-right">Days</th>
                                    <th class="text-right">Old Amount</th>
                                    <th class="text-right">New Amount</th>
                                    <th class="text-right">Arrears</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${arrears.daily_breakdown.map(item => `
                                    <tr>
                                        <td>${getMonthName(item.month)} ${item.year}</td>
                                        <td class="text-right">${item.days_count || '-'}</td>
                                        <td class="text-right">${formatCurrency(item.old_amount)}</td>
                                        <td class="text-right">${formatCurrency(item.new_amount)}</td>
                                        <td class="text-right ${item.arrears_amount > 0 ? 'arrears-positive' : 'arrears-negative'}">${formatCurrency(item.arrears_amount)}</td>
                                    </tr>
                                `).join('')}
                                <tr class="total-row">
                                    <td colspan="4"><strong>Total Arrears</strong></td>
                                    <td class="text-right arrears-positive"><strong>${formatCurrency(arrears.total_arrears_amount)}</strong></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                ` : ''}

                ${arrears.applied_in_payslip_id ? `
                    <div style="margin-top: 16px; padding: 12px; background: var(--color-success-light); border-radius: 8px;">
                        <strong style="color: var(--color-success);">Applied in Payslip:</strong> ${arrears.applied_in_payslip_number || arrears.applied_in_payslip_id}
                    </div>
                ` : ''}
            </div>
        `;

        // Use the arrears details modal
        document.getElementById('arrearsDetailsContent').innerHTML = content;

        // Update modal title
        const modalTitle = document.querySelector('#arrearsDetailsModal .modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'CTC Revision Arrears Details';
        }

        // Show/hide action buttons based on status
        const applyBtn = document.getElementById('applyArrearsBtn');
        const cancelBtn = document.getElementById('cancelArrearsBtn');

        if (applyBtn) {
            applyBtn.style.display = arrears.status === 'pending' ? 'inline-flex' : 'none';
            applyBtn.onclick = () => applyCtcArrears();
        }
        if (cancelBtn) {
            cancelBtn.style.display = arrears.status === 'pending' ? 'inline-flex' : 'none';
            cancelBtn.onclick = () => cancelCtcArrears();
        }

        openModal('arrearsDetailsModal');
        hideLoading();
    } catch (error) {
        console.error('Error viewing CTC arrears details:', error);
        showToast(error.message || 'Failed to load CTC arrears details', 'error');
        hideLoading();
    }
}

/**
 * Apply CTC revision arrears
 * Backend: POST /api/payroll/ctc-arrears/{arrearsId}/apply
 */
async function applyCtcArrears() {
    if (!currentCtcArrearsId) {
        showToast('No arrears selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Apply CTC Revision Arrears',
        message: 'Apply this arrears to the next payroll run?',
        type: 'info',
        confirmText: 'Apply',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();

        await api.request(`/hrms/payroll/ctc-arrears/${currentCtcArrearsId}/apply`, {
            method: 'POST'
        });

        showToast('CTC revision arrears applied successfully', 'success');
        closeModal('arrearsDetailsModal');
        await loadCtcRevisionArrears();

    } catch (error) {
        console.error('Error applying CTC arrears:', error);
        showToast(error.message || 'Failed to apply CTC revision arrears', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Cancel CTC revision arrears
 * Backend: POST /api/payroll/ctc-arrears/{arrearsId}/cancel
 */
async function cancelCtcArrears() {
    if (!currentCtcArrearsId) {
        showToast('No arrears selected', 'error');
        return;
    }

    const confirmed = await Confirm.show({
        title: 'Cancel CTC Revision Arrears',
        message: 'Are you sure you want to cancel this arrears? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Cancel Arrears',
        cancelText: 'Keep'
    });
    if (!confirmed) return;

    try {
        showLoading();

        await api.request(`/hrms/payroll/ctc-arrears/${currentCtcArrearsId}/cancel`, {
            method: 'POST'
        });

        showToast('CTC revision arrears cancelled', 'success');
        closeModal('arrearsDetailsModal');
        await loadCtcRevisionArrears();

    } catch (error) {
        console.error('Error cancelling CTC arrears:', error);
        showToast(error.message || 'Failed to cancel CTC revision arrears', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Quick apply CTC arrears from table
 */
async function applyCtcArrearsQuick(arrearsId) {
    const confirmed = await Confirm.show({
        title: 'Apply CTC Revision Arrears',
        message: 'Apply this arrears to the next payroll run?',
        type: 'info',
        confirmText: 'Apply',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();

        await api.request(`/hrms/payroll/ctc-arrears/${arrearsId}/apply`, {
            method: 'POST'
        });

        showToast('CTC revision arrears applied successfully', 'success');
        await loadCtcRevisionArrears();

    } catch (error) {
        console.error('Error applying CTC arrears:', error);
        showToast(error.message || 'Failed to apply CTC revision arrears', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Quick cancel CTC arrears from table
 */
async function cancelCtcArrearsQuick(arrearsId) {
    const confirmed = await Confirm.show({
        title: 'Cancel CTC Revision Arrears',
        message: 'Cancel this arrears? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Cancel Arrears',
        cancelText: 'Keep'
    });
    if (!confirmed) return;

    try {
        showLoading();

        await api.request(`/hrms/payroll/ctc-arrears/${arrearsId}/cancel`, {
            method: 'POST'
        });

        showToast('CTC revision arrears cancelled', 'success');
        await loadCtcRevisionArrears();

    } catch (error) {
        console.error('Error cancelling CTC arrears:', error);
        showToast(error.message || 'Failed to cancel CTC revision arrears', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Show bulk apply CTC arrears modal
 */
async function showBulkApplyCtcArrearsModal() {
    if (selectedCtcArrearsIds.length === 0) {
        showToast('Please select arrears to apply', 'warning');
        return;
    }

    const selectedArrears = ctcArrearsData.filter(a => selectedCtcArrearsIds.includes(a.id));
    const totalAmount = selectedArrears.reduce((sum, a) => sum + (a.total_arrears_amount || 0), 0);
    const employeeCount = new Set(selectedArrears.map(a => a.employee_id)).size;

    const confirmed = await Confirm.show({
        title: 'Bulk Apply CTC Revision Arrears',
        message: `Apply ${selectedCtcArrearsIds.length} arrears record(s) totaling ${formatCurrency(totalAmount)} for ${employeeCount} employee(s)?`,
        type: 'info',
        confirmText: 'Apply All',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();

        await api.request('/hrms/payroll/ctc-arrears/bulk-apply', {
            method: 'POST',
            body: JSON.stringify({ arrears_ids: selectedCtcArrearsIds })
        });

        showToast(`${selectedCtcArrearsIds.length} CTC revision arrears applied successfully`, 'success');
        selectedCtcArrearsIds = [];
        await loadCtcRevisionArrears();

    } catch (error) {
        console.error('Error bulk applying CTC arrears:', error);
        showToast(error.message || 'Failed to bulk apply CTC revision arrears', 'error');
    } finally {
        hideLoading();
    }
}

// ============================================
// Location Tax Management
// ============================================

async function loadTaxTypes() {
    try {
        const showInactive = document.getElementById('showInactiveTaxTypes')?.checked || false;
        const response = await api.getLocationTaxTypes(showInactive);
        taxTypes = Array.isArray(response) ? response : (response?.data || []);
        updateTaxTypesTable();
        populateTaxTypeSelects();
    } catch (error) {
        console.error('Error loading tax types:', error);
        showToast('Failed to load tax types', 'error');
    }
}

function updateTaxTypesTable() {
    const tbody = document.getElementById('taxTypesTable');
    if (!tbody) return;

    const searchTerm = document.getElementById('taxTypeSearch')?.value?.toLowerCase() || '';

    const filtered = taxTypes.filter(t =>
        t.tax_name?.toLowerCase().includes(searchTerm) ||
        t.tax_code?.toLowerCase().includes(searchTerm) ||
        t.description?.toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="6">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M4 7h16M4 12h16M4 17h10"></path>
                        </svg>
                        <p>No tax types configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(taxType => `
        <tr>
            <td><strong>${escapeHtml(taxType.tax_name)}</strong></td>
            <td><code>${escapeHtml(taxType.tax_code)}</code></td>
            <td><span class="badge badge-${escapeHtml(taxType.deduction_from || 'employee')}">${escapeHtml(formatDeductionFrom(taxType.deduction_from))}</span></td>
            <td>${escapeHtml(taxType.description || '-')}</td>
            <td><span class="status-badge status-${taxType.is_active ? 'active' : 'inactive'}">${taxType.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editTaxType('${escapeHtml(taxType.id)}')" data-tooltip="Edit Tax Type">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteTaxType('${escapeHtml(taxType.id)}')" data-tooltip="Delete Tax Type">
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

function populateTaxTypeSelects() {
    const selects = ['taxRuleTaxType', 'taxRuleTaxTypeId'];
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            const firstOption = id === 'taxRuleTaxType' ? '<option value="">All Tax Types</option>' : '<option value="">Select Tax Type</option>';
            select.innerHTML = firstOption;
            taxTypes.filter(t => t.is_active).forEach(taxType => {
                select.innerHTML += `<option value="${escapeHtml(taxType.id)}">${escapeHtml(taxType.tax_name)} (${escapeHtml(taxType.tax_code)})</option>`;
            });
        }
    });
}

function formatDeductionFrom(deductionFrom) {
    const map = {
        'employee': 'Employee',
        'employer': 'Employer',
        'both': 'Both'
    };
    return map[deductionFrom] || 'Employee';
}

// Tax Type Modal Functions
function showCreateTaxTypeModal() {
    document.getElementById('taxTypeForm').reset();
    document.getElementById('taxTypeId').value = '';
    document.getElementById('taxTypeIsActive').checked = true;
    document.getElementById('taxTypeModalTitle').textContent = 'Create Tax Type';
    document.getElementById('taxTypeModal').classList.add('active');
}

function editTaxType(id) {
    const taxType = taxTypes.find(t => t.id === id);
    if (!taxType) return;

    document.getElementById('taxTypeId').value = taxType.id;
    document.getElementById('taxTypeName').value = taxType.tax_name || '';
    document.getElementById('taxTypeCode').value = taxType.tax_code || '';
    document.getElementById('taxTypeDeductionFrom').value = taxType.deduction_from || 'employee';
    document.getElementById('taxTypeDisplayOrder').value = taxType.display_order || 0;
    document.getElementById('taxTypeDescription').value = taxType.description || '';
    document.getElementById('taxTypeIsActive').checked = taxType.is_active !== false;

    document.getElementById('taxTypeModalTitle').textContent = 'Edit Tax Type';
    document.getElementById('taxTypeModal').classList.add('active');
}

async function saveTaxType() {
    const form = document.getElementById('taxTypeForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('taxTypeId').value;
        const data = {
            tax_name: document.getElementById('taxTypeName').value,
            tax_code: document.getElementById('taxTypeCode').value,
            deduction_from: document.getElementById('taxTypeDeductionFrom').value,
            display_order: parseInt(document.getElementById('taxTypeDisplayOrder').value) || 0,
            description: document.getElementById('taxTypeDescription').value,
            is_active: document.getElementById('taxTypeIsActive').checked
        };

        if (id) {
            await api.updateLocationTaxType(id, data);
        } else {
            await api.createLocationTaxType(data);
        }

        closeModal('taxTypeModal');
        showToast(`Tax type ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadTaxTypes();
        hideLoading();
    } catch (error) {
        console.error('Error saving tax type:', error);
        showToast(error.message || 'Failed to save tax type', 'error');
        hideLoading();
    }
}

async function deleteTaxType(id) {
    const confirmed = await Confirm.show({
        title: 'Delete Tax Type',
        message: 'Are you sure you want to delete this tax type? This may affect associated tax rules.',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
        showLoading();
        await api.deleteLocationTaxType(id);
        showToast('Tax type deleted successfully', 'success');
        await loadTaxTypes();
        hideLoading();
    } catch (error) {
        console.error('Error deleting tax type:', error);
        showToast(error.message || 'Failed to delete tax type', 'error');
        hideLoading();
    }
}

// ============================================
// Office Tax Rules Management
// ============================================

async function loadOfficeTaxRules() {
    try {
        const officeFilter = document.getElementById('taxRuleOffice')?.value || '';
        const showInactive = document.getElementById('showInactiveTaxRules')?.checked || false;

        let response;
        if (officeFilter) {
            response = await api.getOfficeTaxRules(officeFilter, showInactive);
        } else {
            // Load all rules by making a request without office filter
            response = await api.request(`/hrms/location-taxes/rules?includeInactive=${showInactive}`);
        }
        taxRules = Array.isArray(response) ? response : (response?.data || []);
        updateTaxRulesTable();
        populateTaxRuleOfficeSelects();
    } catch (error) {
        console.error('Error loading tax rules:', error);
        showToast('Failed to load tax rules', 'error');
    }
}

function updateTaxRulesTable() {
    const tbody = document.getElementById('taxRulesTable');
    if (!tbody) return;

    const searchTerm = document.getElementById('taxRuleSearch')?.value?.toLowerCase() || '';
    const taxTypeFilter = document.getElementById('taxRuleTaxType')?.value || '';

    let filtered = taxRules.filter(r =>
        r.rule_name?.toLowerCase().includes(searchTerm) ||
        r.tax_code?.toLowerCase().includes(searchTerm) ||
        r.jurisdiction_name?.toLowerCase().includes(searchTerm)
    );

    if (taxTypeFilter) {
        filtered = filtered.filter(r => r.tax_type_id === taxTypeFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="9">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <p>No tax rules configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(rule => {
        const officeName = getOfficeName(rule.office_id);
        const taxTypeName = getTaxTypeName(rule.tax_type_id);
        const calcBadge = getCalculationBadge(rule.calculation_type);
        const amountDisplay = formatAmountDisplay(rule);

        return `
        <tr>
            <td><strong>${escapeHtml(officeName)}</strong></td>
            <td>${escapeHtml(taxTypeName)}</td>
            <td><strong>${escapeHtml(rule.rule_name || '-')}</strong></td>
            <td>${escapeHtml(rule.jurisdiction_name || '-')} <small>(${escapeHtml(rule.jurisdiction_level || '-')})</small></td>
            <td><span class="badge ${escapeHtml(calcBadge.class)}">${escapeHtml(calcBadge.label)}</span></td>
            <td>${amountDisplay}</td>
            <td>${escapeHtml(formatDate(rule.effective_from))}</td>
            <td><span class="status-badge status-${rule.is_active ? 'active' : 'inactive'}">${rule.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editTaxRule('${escapeHtml(rule.id)}')" data-tooltip="Edit Rule">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteTaxRule('${escapeHtml(rule.id)}')" data-tooltip="Delete Rule">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function getOfficeName(officeId) {
    if (!officeId) return 'Unknown';
    const office = offices.find(o => o.id === officeId);
    return office?.office_name || 'Unknown';
}

function getTaxTypeName(taxTypeId) {
    if (!taxTypeId) return 'Unknown';
    const taxType = taxTypes.find(t => t.id === taxTypeId);
    return taxType?.tax_name || 'Unknown';
}

function getCalculationBadge(calcType) {
    const badges = {
        'fixed': { class: 'badge-fixed', label: 'Fixed' },
        'percentage': { class: 'badge-percentage', label: 'Percentage' },
        'slab': { class: 'badge-slab', label: 'Slab' },
        'formula': { class: 'badge-formula', label: 'Formula' }
    };
    return badges[calcType] || { class: 'badge-fixed', label: 'Fixed' };
}

function formatAmountDisplay(rule) {
    switch (rule.calculation_type) {
        case 'fixed':
            return `<strong>${formatCurrency(rule.fixed_amount || 0)}</strong>`;
        case 'percentage':
            return `<strong>${rule.percentage || 0}%</strong> of ${rule.percentage_of || 'gross'}`;
        case 'slab':
            return '<em>Slab based</em>';
        case 'formula':
            return '<em>Formula</em>';
        default:
            return '-';
    }
}

function populateTaxRuleOfficeSelects() {
    const selects = ['taxRuleOffice', 'taxRuleOfficeId', 'copySourceOffice', 'copyTargetOffice', 'previewOffice'];
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            const firstOption = (id === 'taxRuleOffice') ? '<option value="">All Offices</option>' : '<option value="">Select Office</option>';
            select.innerHTML = firstOption;
            offices.filter(o => o.is_active).forEach(office => {
                select.innerHTML += `<option value="${escapeHtml(office.id)}">${escapeHtml(office.office_name)}</option>`;
            });
        }
    });
}

// Tax Rule Modal Functions
function showCreateTaxRuleModal() {
    if (offices.filter(o => o.is_active).length === 0) {
        showToast('Please create an office first', 'error');
        return;
    }

    if (taxTypes.filter(t => t.is_active).length === 0) {
        showToast('Please create a tax type first', 'error');
        return;
    }

    document.getElementById('taxRuleForm').reset();
    document.getElementById('taxRuleId').value = '';
    document.getElementById('taxRuleIsActive').checked = true;
    document.getElementById('taxRuleEffectiveFrom').value = new Date().toISOString().split('T')[0];

    // Populate dropdowns
    populateTaxRuleOfficeSelects();
    populateTaxTypeSelects();

    // Reset calculation fields visibility
    toggleCalculationFields();

    // Reset slab rows
    resetSlabRows();

    document.getElementById('taxRuleModalTitle').textContent = 'Create Tax Rule';
    document.getElementById('taxRuleModal').classList.add('active');
}

function editTaxRule(id) {
    const rule = taxRules.find(r => r.id === id);
    if (!rule) return;

    // Populate dropdowns first
    populateTaxRuleOfficeSelects();
    populateTaxTypeSelects();

    document.getElementById('taxRuleId').value = rule.id;
    document.getElementById('taxRuleOfficeId').value = rule.office_id || '';
    document.getElementById('taxRuleTaxTypeId').value = rule.tax_type_id || '';
    document.getElementById('taxRuleName').value = rule.rule_name || '';
    document.getElementById('taxRuleCode').value = rule.tax_code || '';
    document.getElementById('taxRuleJurisdictionLevel').value = rule.jurisdiction_level || 'state';
    document.getElementById('taxRuleJurisdictionName').value = rule.jurisdiction_name || '';
    document.getElementById('taxRuleJurisdictionCode').value = rule.jurisdiction_code || '';
    document.getElementById('taxRuleCalculationType').value = rule.calculation_type || 'fixed';
    document.getElementById('taxRuleFixedAmount').value = rule.fixed_amount || '';
    document.getElementById('taxRulePercentage').value = rule.percentage || '';
    document.getElementById('taxRulePercentageOf').value = rule.percentage_of || 'gross';
    document.getElementById('taxRuleFormula').value = rule.formula_expression || '';
    document.getElementById('taxRuleEffectiveFrom').value = rule.effective_from?.split('T')[0] || '';
    document.getElementById('taxRuleEffectiveTo').value = rule.effective_to?.split('T')[0] || '';
    document.getElementById('taxRuleNotes').value = rule.notes || '';
    document.getElementById('taxRuleIsActive').checked = rule.is_active !== false;

    // Toggle calculation fields visibility
    toggleCalculationFields();

    // Populate slab rows if calculation type is slab
    if (rule.calculation_type === 'slab' && rule.slab_config) {
        populateSlabRows(rule.slab_config);
    }

    document.getElementById('taxRuleModalTitle').textContent = 'Edit Tax Rule';
    document.getElementById('taxRuleModal').classList.add('active');
}

async function saveTaxRule() {
    const form = document.getElementById('taxRuleForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('taxRuleId').value;
        const calculationType = document.getElementById('taxRuleCalculationType').value;

        const data = {
            office_id: document.getElementById('taxRuleOfficeId').value,
            tax_type_id: document.getElementById('taxRuleTaxTypeId').value,
            rule_name: document.getElementById('taxRuleName').value,
            tax_code: document.getElementById('taxRuleCode').value,
            jurisdiction_level: document.getElementById('taxRuleJurisdictionLevel').value,
            jurisdiction_name: document.getElementById('taxRuleJurisdictionName').value,
            jurisdiction_code: document.getElementById('taxRuleJurisdictionCode').value,
            calculation_type: calculationType,
            effective_from: document.getElementById('taxRuleEffectiveFrom').value,
            effective_to: document.getElementById('taxRuleEffectiveTo').value || null,
            notes: document.getElementById('taxRuleNotes').value,
            is_active: document.getElementById('taxRuleIsActive').checked
        };

        // Add calculation-specific fields
        switch (calculationType) {
            case 'fixed':
                data.fixed_amount = parseFloat(document.getElementById('taxRuleFixedAmount').value) || 0;
                break;
            case 'percentage':
                data.percentage = parseFloat(document.getElementById('taxRulePercentage').value) || 0;
                data.percentage_of = document.getElementById('taxRulePercentageOf').value;
                break;
            case 'slab':
                data.slab_config = getSlabConfig();
                break;
            case 'formula':
                data.formula_expression = document.getElementById('taxRuleFormula').value;
                break;
        }

        if (id) {
            data.id = id; // Include ID in request body for backend validation
            await api.updateOfficeTaxRule(id, data);
        } else {
            await api.createOfficeTaxRule(data);
        }

        closeModal('taxRuleModal');
        showToast(`Tax rule ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadOfficeTaxRules();
        hideLoading();
    } catch (error) {
        console.error('Error saving tax rule:', error);
        showToast(error.message || 'Failed to save tax rule', 'error');
        hideLoading();
    }
}

async function deleteTaxRule(id) {
    const confirmed = await Confirm.show({
        title: 'Delete Tax Rule',
        message: 'Are you sure you want to delete this tax rule?',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
        showLoading();
        await api.deleteOfficeTaxRule(id);
        showToast('Tax rule deleted successfully', 'success');
        await loadOfficeTaxRules();
        hideLoading();
    } catch (error) {
        console.error('Error deleting tax rule:', error);
        showToast(error.message || 'Failed to delete tax rule', 'error');
        hideLoading();
    }
}

// Toggle calculation fields based on type
function toggleCalculationFields() {
    const calcType = document.getElementById('taxRuleCalculationType').value;

    document.getElementById('fixedAmountFields').style.display = calcType === 'fixed' ? 'flex' : 'none';
    document.getElementById('percentageFields').style.display = calcType === 'percentage' ? 'flex' : 'none';
    document.getElementById('slabFields').style.display = calcType === 'slab' ? 'block' : 'none';
}

// Slab row management
function addSlabRow() {
    const container = document.getElementById('slabContainer');
    const newRow = document.createElement('div');
    newRow.className = 'slab-row';
    newRow.innerHTML = `
        <input type="number" class="form-control slab-from" placeholder="From" min="0">
        <span class="slab-separator">to</span>
        <input type="number" class="form-control slab-to" placeholder="To" min="0">
        <span class="slab-separator">=</span>
        <input type="number" class="form-control slab-amount" placeholder="Amount" min="0" step="0.01">
        <button type="button" class="btn btn-sm btn-danger" onclick="removeSlabRow(this)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;
    container.appendChild(newRow);
}

function removeSlabRow(button) {
    const container = document.getElementById('slabContainer');
    if (container.children.length > 1) {
        button.closest('.slab-row').remove();
    } else {
        showToast('At least one slab row is required', 'error');
    }
}

function resetSlabRows() {
    const container = document.getElementById('slabContainer');
    container.innerHTML = `
        <div class="slab-row">
            <input type="number" class="form-control slab-from" placeholder="From" min="0">
            <span class="slab-separator">to</span>
            <input type="number" class="form-control slab-to" placeholder="To" min="0">
            <span class="slab-separator">=</span>
            <input type="number" class="form-control slab-amount" placeholder="Amount" min="0" step="0.01">
            <button type="button" class="btn btn-sm btn-danger" onclick="removeSlabRow(this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `;
}

function populateSlabRows(slabConfig) {
    const container = document.getElementById('slabContainer');
    container.innerHTML = '';

    const slabs = typeof slabConfig === 'string' ? JSON.parse(slabConfig) : slabConfig;
    if (!Array.isArray(slabs) || slabs.length === 0) {
        resetSlabRows();
        return;
    }

    slabs.forEach(slab => {
        const row = document.createElement('div');
        row.className = 'slab-row';
        row.innerHTML = `
            <input type="number" class="form-control slab-from" placeholder="From" min="0" value="${slab.from || ''}">
            <span class="slab-separator">to</span>
            <input type="number" class="form-control slab-to" placeholder="To" min="0" value="${slab.to || ''}">
            <span class="slab-separator">=</span>
            <input type="number" class="form-control slab-amount" placeholder="Amount" min="0" step="0.01" value="${slab.amount || ''}">
            <button type="button" class="btn btn-sm btn-danger" onclick="removeSlabRow(this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;
        container.appendChild(row);
    });
}

function getSlabConfig() {
    const slabs = [];
    document.querySelectorAll('#slabContainer .slab-row').forEach(row => {
        const from = parseFloat(row.querySelector('.slab-from').value) || 0;
        const to = parseFloat(row.querySelector('.slab-to').value) || 0;
        const amount = parseFloat(row.querySelector('.slab-amount').value) || 0;
        slabs.push({ from, to, amount });
    });
    return slabs;
}

// Copy Tax Rules
function showCopyTaxRulesModal() {
    if (offices.filter(o => o.is_active).length < 2) {
        showToast('You need at least 2 offices to copy tax rules', 'error');
        return;
    }

    document.getElementById('copyTaxRulesForm').reset();
    populateTaxRuleOfficeSelects();
    document.getElementById('copyTaxRulesModal').classList.add('active');
}

async function copyTaxRules() {
    const sourceOffice = document.getElementById('copySourceOffice').value;
    const targetOffice = document.getElementById('copyTargetOffice').value;

    if (!sourceOffice || !targetOffice) {
        showToast('Please select both source and target offices', 'error');
        return;
    }

    if (sourceOffice === targetOffice) {
        showToast('Source and target offices must be different', 'error');
        return;
    }

    try {
        showLoading();
        await api.copyOfficeTaxRules(sourceOffice, targetOffice);
        closeModal('copyTaxRulesModal');
        showToast('Tax rules copied successfully', 'success');
        await loadOfficeTaxRules();
        hideLoading();
    } catch (error) {
        console.error('Error copying tax rules:', error);
        showToast(error.message || 'Failed to copy tax rules', 'error');
        hideLoading();
    }
}

// Tax Preview
function showTaxPreviewModal() {
    if (offices.filter(o => o.is_active).length === 0) {
        showToast('No offices configured', 'error');
        return;
    }

    document.getElementById('taxPreviewForm').reset();
    document.getElementById('taxPreviewResults').style.display = 'none';
    document.getElementById('previewEffectiveDate').value = new Date().toISOString().split('T')[0];
    populateTaxRuleOfficeSelects();
    document.getElementById('taxPreviewModal').classList.add('active');
}

async function calculateTaxPreview() {
    const officeId = document.getElementById('previewOffice').value;
    const effectiveDate = document.getElementById('previewEffectiveDate').value;
    const grossSalary = parseFloat(document.getElementById('previewGrossSalary').value) || 0;

    if (!officeId || !effectiveDate || !grossSalary) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        showLoading();
        const request = {
            office_id: officeId,
            effective_date: effectiveDate,
            basic_salary: parseFloat(document.getElementById('previewBasicSalary').value) || 0,
            gross_salary: grossSalary,
            taxable_income: parseFloat(document.getElementById('previewTaxableIncome').value) || grossSalary
        };

        const result = await api.calculateTaxPreview(request);
        displayTaxPreviewResults(result);
        hideLoading();
    } catch (error) {
        console.error('Error calculating tax preview:', error);
        showToast(error.message || 'Failed to calculate tax preview', 'error');
        hideLoading();
    }
}

function displayTaxPreviewResults(result) {
    const tbody = document.getElementById('taxPreviewResultsTable');
    const totalEl = document.getElementById('taxPreviewTotal');
    const resultsDiv = document.getElementById('taxPreviewResults');

    // Backend returns tax_items, not tax_calculations
    if (!result || !result.tax_items || result.tax_items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center">No applicable taxes found for this configuration</td>
            </tr>
        `;
        totalEl.textContent = formatCurrency(0);
    } else {
        tbody.innerHTML = result.tax_items.map(item => `
            <tr>
                <td>${escapeHtml(item.tax_code || '-')}</td>
                <td>${escapeHtml(item.rule_name || '-')}</td>
                <td>${escapeHtml(item.calculation_type || '-')}</td>
                <td><strong>${formatCurrency(item.tax_amount || 0)}</strong></td>
            </tr>
        `).join('');
        totalEl.textContent = formatCurrency(result.total_tax || 0);
    }

    resultsDiv.style.display = 'block';
}

// Add search event listeners for tax management
document.addEventListener('DOMContentLoaded', function() {
    // Tax search listeners
    document.getElementById('taxTypeSearch')?.addEventListener('input', updateTaxTypesTable);
    document.getElementById('taxRuleSearch')?.addEventListener('input', updateTaxRulesTable);
    document.getElementById('taxRuleOffice')?.addEventListener('change', loadOfficeTaxRules);
    document.getElementById('taxRuleTaxType')?.addEventListener('change', updateTaxRulesTable);
});

// ============================================================================
// VOLUNTARY DEDUCTIONS MANAGEMENT
// ============================================================================

let vdTypes = [];
let vdEnrollments = [];
let allVDEnrollments = [];

// Switch between VD sub-tabs
function switchVDSubTab(subTabId) {
    // Update sub-tab buttons
    document.querySelectorAll('#voluntary-deductions .sub-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.subtab === subTabId) {
            btn.classList.add('active');
        }
    });

    // Update sub-tab content
    document.querySelectorAll('#voluntary-deductions .sub-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(subTabId)?.classList.add('active');

    // Load data for the selected sub-tab
    if (subTabId === 'vd-types') {
        loadVDTypes();
    } else if (subTabId === 'vd-enrollments') {
        loadVDEnrollments();
    }
}

// Load VD Types
async function loadVDTypes() {
    try {
        showLoading();
        const response = await api.request('/hrms/voluntary-deductions/types');
        vdTypes = response || [];
        updateVDTypesTable();
        populateVDTypeFilters();
    } catch (error) {
        console.error('Error loading VD types:', error);
        showToast('Failed to load VD types', 'error');
    } finally {
        hideLoading();
    }
}

// Update VD Types table
function updateVDTypesTable() {
    const tbody = document.getElementById('vdTypesTable');
    if (!tbody) return;

    const searchTerm = document.getElementById('vdTypeSearch')?.value.toLowerCase() || '';
    const showInactive = document.getElementById('showInactiveVDTypes')?.checked || false;

    let filtered = vdTypes.filter(t => {
        const matchesSearch = !searchTerm ||
            t.type_name?.toLowerCase().includes(searchTerm) ||
            t.type_code?.toLowerCase().includes(searchTerm);
        const matchesActive = showInactive || t.is_active;
        return matchesSearch && matchesActive;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <p>No voluntary deduction types found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(type => `
        <tr class="${!type.is_active ? 'inactive-row' : ''}">
            <td><strong>${escapeHtml(type.type_name)}</strong></td>
            <td><code>${escapeHtml(type.type_code)}</code></td>
            <td>${escapeHtml(type.description || '-')}</td>
            <td>${type.default_amount ? formatCurrency(type.default_amount) : '-'}</td>
            <td>${type.enrolled_count || 0}</td>
            <td><span class="badge ${type.is_active ? 'badge-success' : 'badge-secondary'}">${type.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <button class="btn btn-icon btn-ghost" onclick="editVDType('${type.id}')" title="Edit">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

// Populate VD type filter dropdowns
function populateVDTypeFilters() {
    const filterSelect = document.getElementById('vdEnrollmentType');
    const enrollmentSelect = document.getElementById('vdEnrollmentDeductionType');

    const activeTypes = vdTypes.filter(t => t.is_active);
    const options = activeTypes.map(t => `<option value="${t.id}">${escapeHtml(t.type_name)}</option>`).join('');

    if (filterSelect) {
        filterSelect.innerHTML = `<option value="">All Types</option>${options}`;
    }
    if (enrollmentSelect) {
        enrollmentSelect.innerHTML = `<option value="">Select VD Type</option>${options}`;
    }
}

// Toggle show inactive VD types
function toggleShowInactiveVDTypes() {
    const checkbox = document.getElementById('showInactiveVDTypes');
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        updateVDTypesTable();
    }
}

// Filter VD types (search input handler)
function filterVDTypes() {
    updateVDTypesTable();
}

// Show create VD type modal
function showCreateVDTypeModal() {
    document.getElementById('vdTypeModalTitle').textContent = 'Create VD Type';
    document.getElementById('vdTypeForm').reset();
    document.getElementById('vdTypeId').value = '';
    document.getElementById('vdTypeIsActive').value = 'true';
    document.getElementById('vdTypeModal').classList.add('active');
}

// Edit VD type
function editVDType(typeId) {
    const type = vdTypes.find(t => t.id === typeId);
    if (!type) return;

    document.getElementById('vdTypeModalTitle').textContent = 'Edit VD Type';
    document.getElementById('vdTypeId').value = type.id;
    document.getElementById('vdTypeName').value = type.type_name || '';
    document.getElementById('vdTypeCode').value = type.type_code || '';
    document.getElementById('vdTypeDescription').value = type.description || '';
    document.getElementById('vdTypeDefaultAmount').value = type.default_amount || '';
    document.getElementById('vdTypeIsActive').value = type.is_active ? 'true' : 'false';
    document.getElementById('vdTypeModal').classList.add('active');
}

// Close VD type modal
function closeVDTypeModal() {
    document.getElementById('vdTypeModal').classList.remove('active');
}

// Save VD type
async function saveVDType() {
    const id = document.getElementById('vdTypeId').value;
    const data = {
        type_name: document.getElementById('vdTypeName').value.trim(),
        type_code: document.getElementById('vdTypeCode').value.trim(),
        description: document.getElementById('vdTypeDescription').value.trim(),
        default_amount: parseFloat(document.getElementById('vdTypeDefaultAmount').value) || null,
        is_active: document.getElementById('vdTypeIsActive').value === 'true'
    };

    if (!data.type_name || !data.type_code) {
        showToast('Name and Code are required', 'error');
        return;
    }

    try {
        showLoading();
        if (id) {
            await api.request(`/hrms/voluntary-deductions/types/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' }
            });
            showToast('VD Type updated successfully', 'success');
        } else {
            await api.request('/hrms/voluntary-deductions/types', {
                method: 'POST',
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' }
            });
            showToast('VD Type created successfully', 'success');
        }
        closeVDTypeModal();
        await loadVDTypes();
    } catch (error) {
        console.error('Error saving VD type:', error);
        showToast(error.message || 'Failed to save VD type', 'error');
    } finally {
        hideLoading();
    }
}

// Load VD Enrollments
async function loadVDEnrollments() {
    try {
        showLoading();

        // Also load VD types for the filter
        if (vdTypes.length === 0) {
            const typesResponse = await api.request('/hrms/voluntary-deductions/types');
            vdTypes = typesResponse || [];
            populateVDTypeFilters();
        }

        const status = document.getElementById('vdEnrollmentStatus')?.value || '';
        const typeId = document.getElementById('vdEnrollmentType')?.value || '';

        let url = '/hrms/voluntary-deductions';
        const params = [];
        if (status) params.push(`status=${status}`);
        if (typeId) params.push(`typeId=${typeId}`);
        if (params.length > 0) url += '?' + params.join('&');

        const response = await api.request(url);
        allVDEnrollments = response || [];
        vdEnrollments = [...allVDEnrollments];

        updateVDEnrollmentsTable();
        updateVDStats();
    } catch (error) {
        console.error('Error loading VD enrollments:', error);
        showToast('Failed to load VD enrollments', 'error');
    } finally {
        hideLoading();
    }
}

// Update VD enrollments table
function updateVDEnrollmentsTable() {
    const tbody = document.getElementById('vdEnrollmentsTable');
    if (!tbody) return;

    const searchTerm = document.getElementById('vdEnrollmentSearch')?.value.toLowerCase() || '';

    let filtered = vdEnrollments.filter(e => {
        if (!searchTerm) return true;
        const employeeName = `${e.employee_first_name || ''} ${e.employee_last_name || ''}`.toLowerCase();
        const employeeCode = (e.employee_code || '').toLowerCase();
        return employeeName.includes(searchTerm) || employeeCode.includes(searchTerm);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="12" y1="18" x2="12" y2="12"></line>
                            <line x1="9" y1="15" x2="15" y2="15"></line>
                        </svg>
                        <p>No voluntary deduction enrollments found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(enrollment => {
        const statusBadge = getVDStatusBadge(enrollment.status);
        const employeeName = `${enrollment.employee_first_name || ''} ${enrollment.employee_last_name || ''}`.trim();
        const actions = getVDEnrollmentActions(enrollment);

        return `
            <tr>
                <td>
                    <div class="employee-info">
                        <strong>${escapeHtml(employeeName)}</strong>
                        <small>${escapeHtml(enrollment.employee_code || '')}</small>
                    </div>
                </td>
                <td>${escapeHtml(enrollment.deduction_type_name || '-')}</td>
                <td><strong>${formatCurrency(enrollment.amount)}</strong></td>
                <td>${formatDate(enrollment.start_date)}</td>
                <td>${enrollment.end_date ? formatDate(enrollment.end_date) : '<span class="text-muted">Ongoing</span>'}</td>
                <td>${statusBadge}</td>
                <td>${actions}</td>
            </tr>
        `;
    }).join('');
}

// Get VD status badge
function getVDStatusBadge(status) {
    const badges = {
        'pending': '<span class="badge badge-warning">Pending</span>',
        'approved': '<span class="badge badge-info">Approved</span>',
        'active': '<span class="badge badge-success">Active</span>',
        'opted_out': '<span class="badge badge-secondary">Opted Out</span>',
        'rejected': '<span class="badge badge-danger">Rejected</span>'
    };
    return badges[status] || `<span class="badge badge-secondary">${status}</span>`;
}

// Get VD enrollment actions based on status
function getVDEnrollmentActions(enrollment) {
    let actions = `
        <button class="btn btn-icon btn-ghost" onclick="viewVDEnrollment('${enrollment.id}')" title="View Details">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
        </button>`;

    if (enrollment.status === 'pending') {
        actions += `
            <button class="btn btn-icon btn-ghost text-success" onclick="approveVDEnrollment('${enrollment.id}')" title="Approve">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </button>
            <button class="btn btn-icon btn-ghost text-danger" onclick="showRejectVDModal('${enrollment.id}')" title="Reject">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>`;
    } else if (enrollment.status === 'active' && !enrollment.end_date) {
        actions += `
            <button class="btn btn-icon btn-ghost text-warning" onclick="showOptOutModal('${enrollment.id}')" title="Opt-Out">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
            </button>`;
    }

    // Show delete button for enrollments that haven't been processed in payroll yet
    // - pending/approved/rejected enrollments can always be deleted
    // - active enrollments with an end_date (not ongoing) can be deleted if not yet processed
    // Note: Backend validates if payroll has been processed via can-delete endpoint
    const isOngoing = enrollment.status === 'active' && !enrollment.end_date;
    const canShowDelete = !isOngoing && (
        ['pending', 'approved', 'rejected'].includes(enrollment.status) ||
        enrollment.status === 'active'
    );

    if (canShowDelete) {
        actions += `
            <button class="btn btn-icon btn-ghost text-danger" onclick="confirmDeleteVDEnrollment('${enrollment.id}')" title="Delete Enrollment">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            </button>`;
    }

    return actions;
}

// Filter VD enrollments (search input handler)
function filterVDEnrollments() {
    updateVDEnrollmentsTable();
}

// Update VD stats
function updateVDStats() {
    const active = allVDEnrollments.filter(e => e.status === 'active').length;
    const pending = allVDEnrollments.filter(e => e.status === 'pending').length;
    const totalMonthly = allVDEnrollments
        .filter(e => e.status === 'active')
        .reduce((sum, e) => sum + (e.amount || 0), 0);

    document.getElementById('vdTotalActive').textContent = active;
    document.getElementById('vdTotalPending').textContent = pending;
    document.getElementById('vdTotalMonthly').textContent = formatCurrency(totalMonthly);
    document.getElementById('vdTotalTypes').textContent = vdTypes.filter(t => t.is_active).length;
}

// Show create VD enrollment modal
async function showCreateVDEnrollmentModal() {
    document.getElementById('vdEnrollmentModalTitle').textContent = 'New VD Enrollment';
    document.getElementById('vdEnrollmentForm').reset();
    document.getElementById('vdEnrollmentId').value = '';

    // Set default start date to today
    document.getElementById('vdEnrollmentStartDate').value = new Date().toISOString().split('T')[0];

    // Load employees
    await loadEmployeesForVDEnrollment();

    document.getElementById('vdEnrollmentModal').classList.add('active');
}

// Load employees for VD enrollment dropdown with searchable dropdown
async function loadEmployeesForVDEnrollment() {
    try {
        const response = await api.request('/hrms/employees');
        const employeeList = response || [];

        // Transform employees to dropdown options format
        const employeeOptions = employeeList.map(e => ({
            value: e.id,
            label: `${e.first_name} ${e.last_name || ''}`.trim(),
            description: e.employee_code
        }));

        // Create or update the searchable dropdown
        const container = document.getElementById('vdEnrollmentEmployeeDropdown');
        if (container) {
            // Destroy existing dropdown if it exists
            if (vdEmployeeDropdown) {
                vdEmployeeDropdown.destroy();
            }

            // Create new searchable dropdown
            vdEmployeeDropdown = new PayrollSearchableDropdown(container, {
                id: 'vdEmployeeSearchable',
                options: employeeOptions,
                placeholder: 'Select Employee',
                searchPlaceholder: 'Search by name or code...',
                virtualScroll: true,
                itemHeight: 32,
                onChange: (value, option) => {
                    // Update the hidden input when employee is selected
                    document.getElementById('vdEnrollmentEmployee').value = value;
                }
            });
        }
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

// Handle VD type change in enrollment form
function onVDTypeChange() {
    const typeId = document.getElementById('vdEnrollmentDeductionType').value;
    const type = vdTypes.find(t => t.id === typeId);
    if (type && type.default_amount) {
        document.getElementById('vdEnrollmentAmount').value = type.default_amount;
    }
}

// Close VD enrollment modal
function closeVDEnrollmentModal() {
    document.getElementById('vdEnrollmentModal').classList.remove('active');
    // Reset the searchable dropdown
    if (vdEmployeeDropdown) {
        vdEmployeeDropdown.reset();
    }
    // Reset the hidden input
    document.getElementById('vdEnrollmentEmployee').value = '';
}

// Save VD enrollment
async function saveVDEnrollment() {
    const data = {
        employee_id: document.getElementById('vdEnrollmentEmployee').value,
        deduction_type_id: document.getElementById('vdEnrollmentDeductionType').value,
        amount: parseFloat(document.getElementById('vdEnrollmentAmount').value),
        start_date: document.getElementById('vdEnrollmentStartDate').value,
        end_date: document.getElementById('vdEnrollmentEndDate').value || null
    };

    if (!data.employee_id || !data.deduction_type_id || !data.amount || !data.start_date) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        showLoading();
        await api.request('/hrms/voluntary-deductions/enroll', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' }
        });
        showToast('VD Enrollment submitted for approval', 'success');
        closeVDEnrollmentModal();
        await loadVDEnrollments();
    } catch (error) {
        console.error('Error saving VD enrollment:', error);
        showToast(error.message || 'Failed to save VD enrollment', 'error');
    } finally {
        hideLoading();
    }
}

// View VD enrollment details
async function viewVDEnrollment(enrollmentId) {
    const enrollment = allVDEnrollments.find(e => e.id === enrollmentId);
    if (!enrollment) return;

    const employeeName = `${enrollment.employee_first_name || ''} ${enrollment.employee_last_name || ''}`.trim();

    document.getElementById('vdViewEmployee').textContent = `${employeeName} (${enrollment.employee_code || ''})`;
    document.getElementById('vdViewType').textContent = enrollment.deduction_type_name || '-';
    document.getElementById('vdViewAmount').textContent = formatCurrency(enrollment.amount);
    document.getElementById('vdViewStartDate').textContent = formatDate(enrollment.start_date);
    document.getElementById('vdViewEndDate').textContent = enrollment.end_date ? formatDate(enrollment.end_date) : 'Ongoing';

    // Update status badge with appropriate styling
    const statusBadge = document.getElementById('vdViewStatus');
    statusBadge.textContent = enrollment.status.charAt(0).toUpperCase() + enrollment.status.slice(1).replace('_', ' ');
    statusBadge.className = 'badge badge-' + getVDStatusClass(enrollment.status);

    document.getElementById('vdViewCreatedAt').textContent = formatDateTime(enrollment.created_at);

    // Only show Approved By row if there's an approver
    const approvedByRow = document.getElementById('vdViewApprovedByRow');
    if (enrollment.approved_by_name) {
        document.getElementById('vdViewApprovedBy').textContent = enrollment.approved_by_name;
        approvedByRow.style.display = '';
    } else {
        approvedByRow.style.display = 'none';
    }

    // Update footer with action buttons if pending
    const footer = document.getElementById('vdViewModalFooter');
    if (enrollment.status === 'pending') {
        footer.innerHTML = `
            <button type="button" class="btn btn-secondary" onclick="closeVDViewModal()">Close</button>
            <button type="button" class="btn btn-danger" onclick="closeVDViewModal(); showRejectVDModal('${enrollment.id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                Reject
            </button>
            <button type="button" class="btn btn-success" onclick="closeVDViewModal(); approveVDEnrollment('${enrollment.id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                Approve
            </button>
        `;
    } else {
        footer.innerHTML = `<button type="button" class="btn btn-secondary" onclick="closeVDViewModal()">Close</button>`;
    }

    document.getElementById('vdViewModal').classList.add('active');
}

// Get status class for VD badge
function getVDStatusClass(status) {
    switch (status) {
        case 'active': return 'success';
        case 'pending': return 'warning';
        case 'approved': return 'info';
        case 'rejected': return 'danger';
        case 'opted_out': return 'secondary';
        default: return 'secondary';
    }
}

// Close VD view modal
function closeVDViewModal() {
    document.getElementById('vdViewModal').classList.remove('active');
}

// Approve VD enrollment
async function approveVDEnrollment(enrollmentId) {
    const confirmed = await Confirm.show({
        title: 'Approve Enrollment',
        message: 'Are you sure you want to approve this voluntary deduction enrollment?',
        type: 'success',
        confirmText: 'Approve',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
        showLoading();
        await api.request(`/hrms/voluntary-deductions/${enrollmentId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        showToast('Enrollment approved successfully', 'success');
        await loadVDEnrollments();
    } catch (error) {
        console.error('Error approving VD enrollment:', error);
        showToast(error.message || 'Failed to approve enrollment', 'error');
    } finally {
        hideLoading();
    }
}

// Show reject VD modal
function showRejectVDModal(enrollmentId) {
    document.getElementById('vdRejectId').value = enrollmentId;
    document.getElementById('vdRejectReason').value = '';
    document.getElementById('vdRejectModal').classList.add('active');
}

// Close VD reject modal
function closeVDRejectModal() {
    document.getElementById('vdRejectModal').classList.remove('active');
}

// Confirm VD rejection
async function confirmVDReject() {
    const enrollmentId = document.getElementById('vdRejectId').value;
    const reason = document.getElementById('vdRejectReason').value.trim();

    if (!reason) {
        showToast('Please provide a rejection reason', 'error');
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/voluntary-deductions/${enrollmentId}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
            headers: { 'Content-Type': 'application/json' }
        });
        showToast('Enrollment rejected', 'success');
        closeVDRejectModal();
        await loadVDEnrollments();
    } catch (error) {
        console.error('Error rejecting VD enrollment:', error);
        showToast(error.message || 'Failed to reject enrollment', 'error');
    } finally {
        hideLoading();
    }
}

// Show opt-out modal
function showOptOutModal(enrollmentId) {
    const enrollment = allVDEnrollments.find(e => e.id === enrollmentId);
    if (!enrollment) return;

    const employeeName = `${enrollment.employee_first_name || ''} ${enrollment.employee_last_name || ''}`.trim();

    document.getElementById('vdOptOutId').value = enrollmentId;
    document.getElementById('vdOptOutTypeName').textContent = enrollment.deduction_type_name || '';
    document.getElementById('vdOptOutEmployeeName').textContent = employeeName;
    document.getElementById('vdOptOutDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('vdOptOutModal').classList.add('active');
}

// Close opt-out modal
function closeVDOptOutModal() {
    document.getElementById('vdOptOutModal').classList.remove('active');
}

// Confirm opt-out
async function confirmVDOptOut() {
    const enrollmentId = document.getElementById('vdOptOutId').value;
    const optOutDate = document.getElementById('vdOptOutDate').value;

    if (!optOutDate) {
        showToast('Please select an opt-out date', 'error');
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/voluntary-deductions/${enrollmentId}/opt-out`, {
            method: 'POST',
            body: JSON.stringify({ opt_out_date: optOutDate }),
            headers: { 'Content-Type': 'application/json' }
        });
        showToast('Opt-out confirmed successfully', 'success');
        closeVDOptOutModal();
        await loadVDEnrollments();
    } catch (error) {
        console.error('Error opting out:', error);
        showToast(error.message || 'Failed to opt-out', 'error');
    } finally {
        hideLoading();
    }
}

// Format date helper for VD
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Format datetime helper for VD
function formatDateTime(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Confirm and delete VD enrollment
async function confirmDeleteVDEnrollment(enrollmentId) {
    try {
        showLoading();

        // First check if deletion is allowed
        const canDeleteResponse = await api.request(`/hrms/voluntary-deductions/${enrollmentId}/can-delete`, {
            method: 'GET'
        });

        hideLoading();

        if (!canDeleteResponse.can_delete) {
            showToast('Cannot delete this enrollment because it has already been processed in payroll. Use "Opt-Out" to stop future deductions instead.', 'error');
            return;
        }

        // Confirm deletion using toast confirmation
        const confirmed = await showConfirm(
            'Are you sure you want to delete this voluntary deduction enrollment? This action cannot be undone.',
            'Delete Enrollment',
            'danger'
        );
        if (!confirmed) return;

        showLoading();
        await api.request(`/hrms/voluntary-deductions/${enrollmentId}`, {
            method: 'DELETE'
        });

        showToast('Voluntary deduction enrollment deleted successfully', 'success');
        await loadVDEnrollments();
    } catch (error) {
        console.error('Error deleting VD enrollment:', error);
        showToast(error.message || 'Failed to delete enrollment', 'error');
    } finally {
        hideLoading();
    }
}

// ========================================
// PAYROLL ADJUSTMENTS SECTION
// (Reimbursements, Bonuses, Deductions, etc.)
// ========================================

let adjustments = [];
let adjustmentEmployees = [];
let filteredAdjustmentEmployees = [];
let displayedAdjustmentEmployeeCount = 0;
let selectedAdjustmentEmployeeId = null;
const ADJUSTMENT_EMPLOYEE_BATCH_SIZE = 20;

// Load all adjustments
async function loadAdjustments() {
    try {
        showLoading();

        // Load pending adjustments (main endpoint available)
        const pendingResponse = await api.request('/hrms/payroll-processing/adjustments/pending');

        // Get pending adjustments
        adjustments = Array.isArray(pendingResponse) ? pendingResponse : [];

        // Update stats
        updateAdjustmentStats();

        // Render table
        renderAdjustmentsTable();

    } catch (error) {
        console.error('Error loading adjustments:', error);
        showToast('Failed to load adjustments', 'error');
        // Set empty array to prevent rendering issues
        adjustments = [];
        renderAdjustmentsTable();
    } finally {
        hideLoading();
    }
}

// Update adjustment stats cards
function updateAdjustmentStats() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const pendingCount = adjustments.filter(a => a.status === 'pending').length;
    const approvedThisMonth = adjustments.filter(a =>
        a.status === 'approved' &&
        a.effective_month === currentMonth &&
        a.effective_year === currentYear
    ).length;

    const totalReimbursements = adjustments
        .filter(a => a.adjustment_type === 'reimbursement' && (a.status === 'approved' || a.status === 'applied'))
        .reduce((sum, a) => sum + (a.amount || 0), 0);

    const totalBonuses = adjustments
        .filter(a => a.adjustment_type === 'bonus' && (a.status === 'approved' || a.status === 'applied'))
        .reduce((sum, a) => sum + (a.amount || 0), 0);

    document.getElementById('pendingAdjustmentsCount').textContent = pendingCount;
    document.getElementById('approvedAdjustmentsCount').textContent = approvedThisMonth;
    document.getElementById('totalReimbursements').textContent = formatCurrency(totalReimbursements);
    document.getElementById('totalBonuses').textContent = formatCurrency(totalBonuses);
}

// Render adjustments table
function renderAdjustmentsTable() {
    const tbody = document.getElementById('adjustmentsTableBody');
    if (!tbody) return;

    // Apply filters
    const search = (document.getElementById('adjustmentSearch')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('adjustmentStatusFilter')?.value || '';
    const typeFilter = document.getElementById('adjustmentTypeFilter')?.value || '';

    let filtered = adjustments.filter(adj => {
        // Search filter
        const employeeName = (adj.employee_name || '').toLowerCase();
        const employeeCode = (adj.employee_code || '').toLowerCase();
        if (search && !employeeName.includes(search) && !employeeCode.includes(search)) {
            return false;
        }

        // Status filter
        if (statusFilter && adj.status !== statusFilter) return false;

        // Type filter
        if (typeFilter && adj.adjustment_type !== typeFilter) return false;

        return true;
    });

    // Sort by created_at desc
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                            <line x1="8" y1="21" x2="16" y2="21"></line>
                            <line x1="12" y1="17" x2="12" y2="21"></line>
                        </svg>
                        <p>No adjustments found</p>
                        <p class="hint">Create a new adjustment using the "New Adjustment" button</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(adj => {
        const statusBadge = getAdjustmentStatusBadge(adj.status);
        const typeBadge = getAdjustmentTypeBadge(adj.adjustment_type);
        const period = `${getMonthName(adj.effective_month)} ${adj.effective_year}`;

        return `
            <tr>
                <td>
                    <div class="employee-cell">
                        <span class="employee-name">${escapeHtml(adj.employee_name || '-')}</span>
                        <span class="employee-code">${escapeHtml(adj.employee_code || '')}</span>
                    </div>
                </td>
                <td>${typeBadge}</td>
                <td class="amount-cell ${isDeductionType(adj.adjustment_type) ? 'negative' : 'positive'}">
                    ${isDeductionType(adj.adjustment_type) ? '-' : '+'}${formatCurrency(adj.amount)}
                </td>
                <td>${period}</td>
                <td class="reason-cell" title="${escapeHtml(adj.reason || '')}">${escapeHtml(truncateText(adj.reason, 30))}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn" onclick="viewAdjustment('${adj.id}')" title="View Details">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        ${adj.status === 'pending' ? `
                        <button class="action-btn success" onclick="quickApproveAdjustment('${adj.id}')" title="Approve">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Filter adjustments table
function filterAdjustments() {
    renderAdjustmentsTable();
}

// Get adjustment status badge
function getAdjustmentStatusBadge(status) {
    const badges = {
        'pending': '<span class="status-badge warning">Pending</span>',
        'approved': '<span class="status-badge success">Approved</span>',
        'rejected': '<span class="status-badge danger">Rejected</span>',
        'applied': '<span class="status-badge info">Applied</span>'
    };
    return badges[status] || `<span class="status-badge">${status}</span>`;
}

// Get adjustment type badge
function getAdjustmentTypeBadge(type) {
    const badges = {
        'reimbursement': '<span class="type-badge earning">Reimbursement</span>',
        'bonus': '<span class="type-badge earning">Bonus</span>',
        'incentive': '<span class="type-badge earning">Incentive</span>',
        'recovery': '<span class="type-badge deduction">Recovery</span>'
    };
    return badges[type] || `<span class="type-badge">${escapeHtml(type)}</span>`;
}

// Check if adjustment type is a deduction
function isDeductionType(type) {
    return ['recovery'].includes((type || '').toLowerCase());
}

// Truncate text helper
function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// Show create adjustment modal
async function showCreateAdjustmentModal() {
    // Reset form
    document.getElementById('createAdjustmentForm').reset();
    document.getElementById('recurringOptionsRow').style.display = 'none';

    // Reset employee dropdown
    resetAdjustmentEmployeeDropdown();

    // Load employees for searchable dropdown
    await loadAdjustmentEmployees();

    // Set default month to current (YYYY-MM format for type="month")
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('adjustmentEffectivePeriod').value = currentMonth;

    // Clear any previous type selection
    document.querySelectorAll('input[name="adjustmentType"]').forEach(r => r.checked = false);

    openModal('createAdjustmentModal');
}

// Load employees for adjustment searchable dropdown
async function loadAdjustmentEmployees() {
    try {
        // Use cached employees if available, otherwise fetch
        if (employees.length === 0) {
            const response = await api.request('/hrms/employees');
            employees = Array.isArray(response) ? response : (response.data || []);
        }

        // Filter to only active employees and sort by name
        adjustmentEmployees = employees
            .filter(emp => emp.employment_status === 'active')
            .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

        filteredAdjustmentEmployees = [...adjustmentEmployees];
        displayedAdjustmentEmployeeCount = 0;

        // Display employee list
        displayAdjustmentEmployeeList(filteredAdjustmentEmployees, false);

        // Setup scroll for lazy loading
        setupAdjustmentEmployeeListScroll();
    } catch (error) {
        console.error('Error loading employees for adjustment:', error);
    }
}

// Toggle adjustment employee dropdown
function toggleAdjustmentEmployeeDropdown() {
    const dropdown = document.getElementById('adjustmentEmployeeDropdown');
    dropdown.classList.toggle('open');

    if (dropdown.classList.contains('open')) {
        document.getElementById('adjustmentEmployeeSearch').focus();
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeAdjustmentEmployeeDropdownOnOutsideClick);
        }, 0);
    } else {
        document.removeEventListener('click', closeAdjustmentEmployeeDropdownOnOutsideClick);
    }
}

function closeAdjustmentEmployeeDropdownOnOutsideClick(e) {
    const dropdown = document.getElementById('adjustmentEmployeeDropdown');
    if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        document.removeEventListener('click', closeAdjustmentEmployeeDropdownOnOutsideClick);
    }
}

// Reset adjustment employee dropdown
function resetAdjustmentEmployeeDropdown() {
    const selectedText = document.getElementById('adjustmentSelectedText');
    if (selectedText) {
        selectedText.textContent = 'Select an employee...';
        selectedText.classList.add('placeholder');
    }
    const searchInput = document.getElementById('adjustmentEmployeeSearch');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('clearAdjustmentSearchBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    const dropdown = document.getElementById('adjustmentEmployeeDropdown');
    if (dropdown) dropdown.classList.remove('open');

    // Reset hidden input
    const hiddenInput = document.getElementById('adjustmentEmployeeId');
    if (hiddenInput) hiddenInput.value = '';

    selectedAdjustmentEmployeeId = null;
}

// Filter adjustment employee list
function filterAdjustmentEmployeeList() {
    const searchTerm = document.getElementById('adjustmentEmployeeSearch').value.toLowerCase();
    const clearBtn = document.getElementById('clearAdjustmentSearchBtn');

    clearBtn.style.display = searchTerm ? 'flex' : 'none';

    filteredAdjustmentEmployees = adjustmentEmployees.filter(emp => {
        const firstName = (emp.first_name || '').toLowerCase();
        const lastName = (emp.last_name || '').toLowerCase();
        const code = (emp.employee_code || '').toLowerCase();
        const deptName = (emp.department_name || '').toLowerCase();

        return firstName.includes(searchTerm) ||
               lastName.includes(searchTerm) ||
               code.includes(searchTerm) ||
               deptName.includes(searchTerm);
    });

    displayedAdjustmentEmployeeCount = 0;
    displayAdjustmentEmployeeList(filteredAdjustmentEmployees, false);
}

// Clear adjustment employee search
function clearAdjustmentEmployeeSearch() {
    document.getElementById('adjustmentEmployeeSearch').value = '';
    document.getElementById('clearAdjustmentSearchBtn').style.display = 'none';
    filteredAdjustmentEmployees = [...adjustmentEmployees];
    displayedAdjustmentEmployeeCount = 0;
    displayAdjustmentEmployeeList(filteredAdjustmentEmployees, false);
}

// Display adjustment employee list with virtual scroll
function displayAdjustmentEmployeeList(empList, append = false) {
    const list = document.getElementById('adjustmentEmployeeList');
    const countDisplay = document.getElementById('adjustmentEmployeeCountDisplay');

    if (!list) return;

    const totalEmployees = adjustmentEmployees.length;
    const filteredCount = empList.length;
    countDisplay.textContent = filteredCount === totalEmployees
        ? `${totalEmployees} employee${totalEmployees !== 1 ? 's' : ''}`
        : `${filteredCount} of ${totalEmployees} employees`;

    if (empList.length === 0) {
        list.innerHTML = '<p class="text-muted" style="text-align: center; font-size: 0.75rem; padding: 20px;">No employees found</p>';
        return;
    }

    const startIndex = append ? displayedAdjustmentEmployeeCount : 0;
    const endIndex = Math.min(startIndex + ADJUSTMENT_EMPLOYEE_BATCH_SIZE, empList.length);
    const batch = empList.slice(startIndex, endIndex);

    const batchHTML = batch.map(emp => {
        const firstName = emp.first_name || '';
        const lastName = emp.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
        const code = emp.employee_code || '';
        const deptName = emp.department_name || '';
        const isSelected = selectedAdjustmentEmployeeId === emp.id;

        return `
            <div class="employee-select-item ${isSelected ? 'selected' : ''}"
                 data-employee-id="${emp.id}"
                 onclick="selectAdjustmentEmployee('${emp.id}')">
                <div class="employee-info-compact">
                    <span class="employee-name-compact">${escapeHtml(fullName)}</span>
                    <div class="employee-badges">
                        <span class="employee-code-badge">${escapeHtml(code)}</span>
                        ${deptName ? `<span class="employee-dept-badge">${escapeHtml(deptName)}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (append) {
        const loadingIndicator = document.getElementById('adjustment-employee-loading-indicator');
        if (loadingIndicator) loadingIndicator.remove();
        list.insertAdjacentHTML('beforeend', batchHTML);
    } else {
        list.innerHTML = batchHTML;
    }

    displayedAdjustmentEmployeeCount = endIndex;

    // Show "scroll for more" indicator if there are more employees
    if (displayedAdjustmentEmployeeCount < empList.length) {
        list.insertAdjacentHTML('beforeend',
            '<div id="adjustment-employee-loading-indicator" class="text-muted" style="text-align: center; padding: 12px; font-size: 0.75rem;">Scroll for more...</div>');
    }
}

// Setup scroll handler for lazy loading
function setupAdjustmentEmployeeListScroll() {
    const list = document.getElementById('adjustmentEmployeeList');
    if (!list) return;

    list.onscroll = () => {
        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;

        // Load more when near bottom
        if (scrollTop + clientHeight >= scrollHeight - 50) {
            if (displayedAdjustmentEmployeeCount < filteredAdjustmentEmployees.length) {
                displayAdjustmentEmployeeList(filteredAdjustmentEmployees, true);
            }
        }
    };
}

// Select an employee from adjustment dropdown
function selectAdjustmentEmployee(employeeId) {
    selectedAdjustmentEmployeeId = employeeId;
    const emp = adjustmentEmployees.find(e => e.id === employeeId);

    if (emp) {
        // Update hidden input
        document.getElementById('adjustmentEmployeeId').value = employeeId;

        // Update selected text
        const firstName = emp.first_name || '';
        const lastName = emp.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
        const code = emp.employee_code || '';

        const selectedText = document.getElementById('adjustmentSelectedText');
        selectedText.textContent = `${fullName} (${code})`;
        selectedText.classList.remove('placeholder');

        // Update list to show selected state
        document.querySelectorAll('#adjustmentEmployeeList .employee-select-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.employeeId === employeeId);
        });

        // Close dropdown
        document.getElementById('adjustmentEmployeeDropdown').classList.remove('open');
        document.removeEventListener('click', closeAdjustmentEmployeeDropdownOnOutsideClick);
    }
}

// Toggle recurring options
function toggleRecurringOptions() {
    const isRecurring = document.getElementById('adjustmentRecurring').checked;
    document.getElementById('recurringOptionsRow').style.display = isRecurring ? 'flex' : 'none';
}

// Create adjustment
async function createAdjustment() {
    const employeeId = document.getElementById('adjustmentEmployeeId').value;

    // Validate employee selection
    if (!employeeId) {
        showToast('Please select an employee', 'error');
        return;
    }

    // Get selected adjustment type from radio buttons
    const selectedType = document.querySelector('input[name="adjustmentType"]:checked');
    if (!selectedType) {
        showToast('Please select an adjustment type', 'error');
        return;
    }

    const form = document.getElementById('createAdjustmentForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const adjustmentType = selectedType.value;
    const amount = parseFloat(document.getElementById('adjustmentAmount').value);

    // Parse month from type="month" input (YYYY-MM format)
    const periodValue = document.getElementById('adjustmentEffectivePeriod').value;
    const [year, month] = periodValue.split('-').map(Number);
    const effectiveMonth = month;
    const effectiveYear = year;

    const reason = document.getElementById('adjustmentReason').value.trim();
    const isRecurring = document.getElementById('adjustmentRecurring').checked;
    const recurringMonthsValue = document.getElementById('adjustmentRecurringMonths').value;
    const recurringMonths = isRecurring && recurringMonthsValue ? parseInt(recurringMonthsValue) : 0;

    try {
        showLoading();

        // Build request body - only include recurring_months if recurring is enabled
        const requestBody = {
            employee_id: employeeId,
            adjustment_type: adjustmentType,
            amount: amount,
            effective_month: effectiveMonth,
            effective_year: effectiveYear,
            reason: reason
        };

        // Only add recurring fields if checkbox is checked
        if (isRecurring) {
            requestBody.is_recurring = true;
            requestBody.recurring_months = recurringMonths;
        }

        await api.request('/hrms/payroll-processing/adjustments', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });

        showToast('Adjustment created successfully', 'success');
        closeModal('createAdjustmentModal');
        await loadAdjustments();

    } catch (error) {
        console.error('Error creating adjustment:', error);
        showToast(error.message || 'Failed to create adjustment', 'error');
    } finally {
        hideLoading();
    }
}

// View adjustment details
async function viewAdjustment(adjustmentId) {
    try {
        showLoading();

        const adj = await api.request(`/hrms/payroll-processing/adjustments/${adjustmentId}`);

        // Populate modal
        document.getElementById('viewAdjustmentId').value = adj.id;
        document.getElementById('viewAdjustmentEmployee').textContent = adj.employee_name || '-';
        document.getElementById('viewAdjustmentEmployeeCode').textContent = adj.employee_code || '-';

        // Type badge with class
        const typeBadge = document.getElementById('viewAdjustmentType');
        typeBadge.textContent = adj.adjustment_type || '-';
        typeBadge.className = `adj-type-badge ${(adj.adjustment_type || '').toLowerCase()}`;

        // Amount with positive/negative class
        const isDeduction = isDeductionType(adj.adjustment_type);
        const amountEl = document.getElementById('viewAdjustmentAmount');
        amountEl.textContent = `${isDeduction ? '-' : '+'}${formatCurrency(adj.amount)}`;
        amountEl.className = `adj-amount-value ${isDeduction ? 'negative' : 'positive'}`;

        document.getElementById('viewAdjustmentPeriod').textContent = `${getMonthName(adj.effective_month)} ${adj.effective_year}`;

        // Status badge with class
        const statusBadge = document.getElementById('viewAdjustmentStatus');
        const statusLower = (adj.status || '').toLowerCase();
        statusBadge.textContent = adj.status || '-';
        statusBadge.className = `adj-status-badge ${statusLower === 'applied_to_payroll' ? 'applied' : statusLower}`;

        document.getElementById('viewAdjustmentReason').textContent = adj.reason || '-';
        document.getElementById('viewAdjustmentCreatedBy').textContent = adj.created_by_name || '';
        document.getElementById('viewAdjustmentCreatedAt').textContent = formatDateTime(adj.created_at);

        // Show/hide approved by row
        const approvedByRow = document.getElementById('viewAdjustmentApprovedByRow');
        if (adj.approved_by_name && adj.approved_at) {
            document.getElementById('viewAdjustmentApprovedBy').textContent = adj.approved_by_name || '';
            document.getElementById('viewAdjustmentApprovedAt').textContent = formatDateTime(adj.approved_at);
            approvedByRow.style.display = '';
        } else {
            approvedByRow.style.display = 'none';
        }

        // Show/hide rejection reason
        const rejectionRow = document.getElementById('viewAdjustmentRejectionRow');
        if (adj.status === 'rejected' && adj.rejection_reason) {
            document.getElementById('viewAdjustmentRejectionReason').textContent = adj.rejection_reason;
            rejectionRow.style.display = '';
        } else {
            rejectionRow.style.display = 'none';
        }

        // Show/hide action buttons based on status and permissions
        const btnApprove = document.getElementById('btnApproveAdjustment');
        const btnReject = document.getElementById('btnRejectAdjustment');

        if (adj.status === 'pending' && hasHRAdminRole()) {
            btnApprove.style.display = '';
            btnReject.style.display = '';
        } else {
            btnApprove.style.display = 'none';
            btnReject.style.display = 'none';
        }

        openModal('viewAdjustmentModal');

    } catch (error) {
        console.error('Error loading adjustment details:', error);
        showToast('Failed to load adjustment details', 'error');
    } finally {
        hideLoading();
    }
}

// Check if user has HR Admin role
function hasHRAdminRole() {
    if (!currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.some(r => ['SUPERADMIN', 'HRMS_ADMIN', 'HRMS_HR_ADMIN'].includes(r.toUpperCase()));
}

// Quick approve adjustment from table
async function quickApproveAdjustment(adjustmentId) {
    const confirmed = await showConfirm(
        'Are you sure you want to approve this adjustment?',
        'Approve Adjustment',
        'success'
    );

    if (!confirmed) return;

    try {
        showLoading();

        await api.request(`/hrms/payroll-processing/adjustments/${adjustmentId}/approve`, {
            method: 'POST',
            body: JSON.stringify({ approved: true })
        });

        showToast('Adjustment approved successfully', 'success');
        await loadAdjustments();

    } catch (error) {
        console.error('Error approving adjustment:', error);
        showToast(error.message || 'Failed to approve adjustment', 'error');
    } finally {
        hideLoading();
    }
}

// Approve adjustment from modal
async function approveAdjustment() {
    const adjustmentId = document.getElementById('viewAdjustmentId').value;
    if (!adjustmentId) return;

    const confirmed = await showConfirm(
        'Are you sure you want to approve this adjustment?',
        'Approve Adjustment',
        'success'
    );

    if (!confirmed) return;

    try {
        showLoading();

        await api.request(`/hrms/payroll-processing/adjustments/${adjustmentId}/approve`, {
            method: 'POST',
            body: JSON.stringify({ approved: true })
        });

        showToast('Adjustment approved successfully', 'success');
        closeModal('viewAdjustmentModal');
        await loadAdjustments();

    } catch (error) {
        console.error('Error approving adjustment:', error);
        showToast(error.message || 'Failed to approve adjustment', 'error');
    } finally {
        hideLoading();
    }
}

// Show reject adjustment modal
function showRejectAdjustmentModal() {
    const adjustmentId = document.getElementById('viewAdjustmentId').value;
    if (!adjustmentId) return;

    document.getElementById('rejectAdjustmentId').value = adjustmentId;
    document.getElementById('adjustmentRejectReason').value = '';

    closeModal('viewAdjustmentModal');
    openModal('rejectAdjustmentModal');
}

// Confirm reject adjustment
async function confirmRejectAdjustment() {
    const adjustmentId = document.getElementById('rejectAdjustmentId').value;
    const reason = document.getElementById('adjustmentRejectReason').value.trim();

    if (!reason) {
        showToast('Please provide a reason for rejection', 'error');
        return;
    }

    try {
        showLoading();

        await api.request(`/hrms/payroll-processing/adjustments/${adjustmentId}/approve`, {
            method: 'POST',
            body: JSON.stringify({
                approved: false,
                rejection_reason: reason
            })
        });

        showToast('Adjustment rejected', 'success');
        closeModal('rejectAdjustmentModal');
        await loadAdjustments();

    } catch (error) {
        console.error('Error rejecting adjustment:', error);
        showToast(error.message || 'Failed to reject adjustment', 'error');
    } finally {
        hideLoading();
    }
}

// Get month name helper
function getMonthName(month) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month] || '';
}

// ============================================================================
// COLLAPSIBLE SIDEBAR NAVIGATION
// ============================================================================

function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('payrollSidebar');
    const activeTabName = document.getElementById('activeTabName');
    const container = document.querySelector('.hrms-container');

    if (!toggle || !sidebar) return;

    // Tab name mapping for display
    const tabNames = {
        'salary-components': 'Salary Components',
        'location-taxes': 'Location Taxes',
        'salary-structures': 'Salary Structures',
        'employee-salaries': 'Employee Salaries',
        'payroll-drafts': 'Payroll Drafts',
        'finalized-runs': 'Finalized Runs',
        'all-payslips': 'All Payslips',
        'loans': 'Loans & Advances',
        'arrears': 'Arrears Management'
    };

    // Update active tab title
    function updateActiveTabTitle(tabId) {
        if (activeTabName && tabNames[tabId]) {
            activeTabName.textContent = tabNames[tabId];
        }
    }

    // Open sidebar by default on page load
    toggle.classList.add('active');
    sidebar.classList.add('open');
    container?.classList.add('sidebar-open');

    // Toggle sidebar open/close
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
    });

    // Collapsible nav groups
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.nav-group');
            group.classList.toggle('collapsed');
        });
    });

    // Update title when a tab is selected (sidebar stays open)
    document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active tab title (sidebar remains open)
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

// Initialize sidebar on page load
document.addEventListener('DOMContentLoaded', setupSidebar);

// =====================================================
// SALARY REPORTS SECTION
// =====================================================

let salaryReportData = {
    employees: [],
    summary: {}
};

/**
 * Load salary reports data from API
 */
async function loadSalaryReports() {
    try {
        const officeId = document.getElementById('salaryReportOffice')?.value || '';
        const departmentId = document.getElementById('salaryReportDepartment')?.value || '';

        // Build query params
        let queryParams = [];
        if (officeId) queryParams.push(`office_id=${officeId}`);
        if (departmentId) queryParams.push(`department_id=${departmentId}`);
        const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

        // Fetch salary summary report
        const response = await fetch(`${CONFIG.hrmsApiBaseUrl}/payroll/reports/summary${queryString}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load salary reports');
        }

        const data = await response.json();
        salaryReportData.summary = data;
        salaryReportData.employees = data.employees || [];

        // Populate filter dropdowns if not already populated
        await populateSalaryReportFilters();

        // Update UI
        updateSalaryReportSummary(data);
        updateDepartmentBreakdown(data.employees || []);
        updateSalaryReportTable();

    } catch (error) {
        console.error('Error loading salary reports:', error);
        showNotification('Failed to load salary reports', 'error');
    }
}

/**
 * Populate salary report filter dropdowns
 */
async function populateSalaryReportFilters() {
    const officeSelect = document.getElementById('salaryReportOffice');
    const departmentSelect = document.getElementById('salaryReportDepartment');

    // Only populate if empty
    if (officeSelect && officeSelect.options.length <= 1) {
        try {
            const officesResp = await fetch(`${CONFIG.hrmsApiBaseUrl}/offices`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            if (officesResp.ok) {
                const officesData = await officesResp.json();
                officesData.forEach(office => {
                    const option = document.createElement('option');
                    option.value = office.id;
                    option.textContent = office.office_name;
                    officeSelect.appendChild(option);
                });
            }
        } catch (e) {
            console.error('Error loading offices for salary report filter:', e);
        }
    }

    if (departmentSelect && departmentSelect.options.length <= 1) {
        try {
            const deptsResp = await fetch(`${CONFIG.hrmsApiBaseUrl}/departments`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            if (deptsResp.ok) {
                const deptsData = await deptsResp.json();
                deptsData.forEach(dept => {
                    const option = document.createElement('option');
                    option.value = dept.id;
                    option.textContent = dept.department_name;
                    departmentSelect.appendChild(option);
                });
            }
        } catch (e) {
            console.error('Error loading departments for salary report filter:', e);
        }
    }

    // Add change listeners
    officeSelect?.addEventListener('change', loadSalaryReports);
    departmentSelect?.addEventListener('change', loadSalaryReports);
}

/**
 * Update the summary cards with report data
 */
function updateSalaryReportSummary(data) {
    document.getElementById('totalEmployeesWithSalary').textContent = data.employees_with_salary || 0;
    document.getElementById('employeesWithoutSalary').textContent = data.employees_without_salary || 0;
    document.getElementById('totalAnnualCtc').textContent = formatCurrency(data.total_annual_ctc || 0);
    document.getElementById('totalMonthlyGross').textContent = formatCurrency(data.total_monthly_gross || 0);
    document.getElementById('averageCtc').textContent = formatCurrency(data.average_ctc || 0);
}

/**
 * Update department-wise breakdown section
 */
function updateDepartmentBreakdown(employees) {
    const container = document.getElementById('departmentBreakdown');
    if (!container) return;

    // Group by department
    const deptMap = new Map();
    employees.forEach(emp => {
        const deptName = emp.department || 'Unassigned';
        if (!deptMap.has(deptName)) {
            deptMap.set(deptName, {
                name: deptName,
                count: 0,
                totalCtc: 0,
                employees: []
            });
        }
        const dept = deptMap.get(deptName);
        dept.count++;
        dept.totalCtc += emp.ctc || 0;
        dept.employees.push(emp);
    });

    // Sort by employee count descending
    const deptArray = Array.from(deptMap.values()).sort((a, b) => b.count - a.count);

    if (deptArray.length === 0) {
        container.innerHTML = `
            <div class="empty-breakdown">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="8.5" cy="7" r="4"></circle>
                </svg>
                <p>No department data available</p>
            </div>
        `;
        return;
    }

    // Calculate max for bar width
    const maxCount = Math.max(...deptArray.map(d => d.count));

    container.innerHTML = deptArray.map(dept => `
        <div class="dept-breakdown-card">
            <div class="dept-header">
                <span class="dept-name">${escapeHtml(dept.name)}</span>
                <span class="dept-count">${dept.count} employees</span>
            </div>
            <div class="dept-bar-container">
                <div class="dept-bar" style="width: ${(dept.count / maxCount) * 100}%"></div>
            </div>
            <div class="dept-stats">
                <div class="dept-stat">
                    <span class="dept-stat-label">Total CTC</span>
                    <span class="dept-stat-value">${formatCurrency(dept.totalCtc)}</span>
                </div>
                <div class="dept-stat">
                    <span class="dept-stat-label">Avg CTC</span>
                    <span class="dept-stat-value">${formatCurrency(dept.count > 0 ? dept.totalCtc / dept.count : 0)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Update the employee salary table
 */
function updateSalaryReportTable() {
    const tbody = document.getElementById('salaryReportTable');
    if (!tbody) return;

    const searchTerm = (document.getElementById('salaryReportSearch')?.value || '').toLowerCase();

    // Filter employees
    let filtered = salaryReportData.employees;
    if (searchTerm) {
        filtered = filtered.filter(emp =>
            (emp.employee_name || '').toLowerCase().includes(searchTerm) ||
            (emp.employee_code || '').toLowerCase().includes(searchTerm) ||
            (emp.department || '').toLowerCase().includes(searchTerm) ||
            (emp.designation || '').toLowerCase().includes(searchTerm)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <p>No salary data found</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // Sort by CTC descending
    filtered.sort((a, b) => (b.ctc || 0) - (a.ctc || 0));

    tbody.innerHTML = filtered.map(emp => `
        <tr>
            <td>
                <div class="employee-info">
                    <span class="employee-name">${escapeHtml(emp.employee_name || 'N/A')}</span>
                </div>
            </td>
            <td><code class="emp-code">${escapeHtml(emp.employee_code || 'N/A')}</code></td>
            <td>${escapeHtml(emp.department || 'N/A')}</td>
            <td>${escapeHtml(emp.designation || 'N/A')}</td>
            <td class="amount-cell"><strong>${formatCurrency(emp.ctc || 0)}</strong></td>
            <td class="amount-cell">${formatCurrency(emp.monthly_gross || 0)}</td>
            <td class="amount-cell">${formatCurrency(emp.monthly_net || 0)}</td>
            <td>${emp.effective_from ? new Date(emp.effective_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}</td>
        </tr>
    `).join('');
}

/**
 * Filter salary report table
 */
function filterSalaryReport() {
    updateSalaryReportTable();
}

/**
 * Export salary report to CSV
 */
function exportSalaryReport(format) {
    if (format !== 'csv') {
        showNotification('Only CSV export is supported', 'warning');
        return;
    }

    const employees = salaryReportData.employees || [];
    if (employees.length === 0) {
        showNotification('No data to export', 'warning');
        return;
    }

    // CSV headers
    const headers = ['Employee Name', 'Employee Code', 'Department', 'Designation', 'Annual CTC', 'Monthly Gross', 'Monthly Net', 'Effective From'];

    // CSV rows
    const rows = employees.map(emp => [
        emp.employee_name || '',
        emp.employee_code || '',
        emp.department || '',
        emp.designation || '',
        emp.ctc || 0,
        emp.monthly_gross || 0,
        emp.monthly_net || 0,
        emp.effective_from || ''
    ]);

    // Build CSV content
    let csvContent = headers.join(',') + '\n';
    rows.forEach(row => {
        csvContent += row.map(cell => {
            // Escape quotes and wrap in quotes if needed
            const str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join(',') + '\n';
    });

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `salary_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showNotification('Salary report exported successfully', 'success');
}
