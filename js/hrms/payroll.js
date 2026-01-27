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
let allOffices = []; // Unfiltered list of all offices (for country filtering)
let components = [];
let structures = [];
let currentPayslipId = null;
let drafts = [];
let statutoryEmployeeDeductions = []; // Auto-attached to salary structures
let statutoryEmployerContributions = []; // Employer-side statutory contributions (e.g., retirement, social insurance)
let costClassifications = {}; // CTC classifications from country config (charge_code -> {employee_portion, employer_portion})
let selectableComponentsForCountry = []; // COUNTRY-FILTERED: Selectable components from backend for selected office's country
let selectedGlobalCountry = ''; // Currently selected country in global filter
let loadedCountriesList = []; // Cached list of countries for the global filter
let allLoansData = []; // Store for loans data (for pagination)
let allPayslipsData = []; // Store for all payslips data (for pagination)
let allAdjustmentsData = []; // Store for adjustments data (for pagination)
let allArrearsData = []; // Store for arrears data (for pagination)
let allVdEnrollmentsData = []; // Store for VD enrollments data (for pagination)

// Store for searchable dropdown instances
const payrollSearchableDropdowns = new Map();

// Month picker instances
let draftMonthPicker = null;
let runMonthPicker = null;
let allPayslipsMonthPicker = null;
let sfMonthPicker = null; // Statutory Filing month picker
let createDraftMonthPicker = null;

// VD employee dropdown instance
let vdEmployeeDropdown = null;

// Pagination instances for tables
let empSalariesPagination = null;
let salaryStructuresPagination = null;
let loansPagination = null;
let vdEnrollmentsPagination = null;
let allPayslipsPagination = null;
let adjustmentsPagination = null;
let arrearsPagination = null;

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
        // Check actual class state instead of property (in case another dropdown forcibly closed us)
        const isCurrentlyOpen = this.dropdownEl.classList.contains('open');
        if (isCurrentlyOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        // Close all other open PayrollSearchableDropdowns first
        payrollSearchableDropdowns.forEach((instance, id) => {
            if (id !== this.id && instance.isOpen) {
                instance.close();
            }
        });

        // Close all open SearchableDropdowns (from searchable-dropdown.js)
        document.querySelectorAll('.searchable-dropdown.open').forEach(dropdown => {
            if (dropdown !== this.dropdownEl) {
                dropdown.classList.remove('open');
            }
        });

        // Close all open MonthPickers
        document.querySelectorAll('.month-picker.open').forEach(picker => {
            picker.classList.remove('open');
        });

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
        // If empty/null value passed, reset to placeholder
        if (value === '' || value === null || value === undefined) {
            this.selectedValue = null;
            this.selectedTextEl.textContent = this.placeholder;
            this.selectedTextEl.classList.add('placeholder');
            return;
        }
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

    /**
     * Enable or disable the dropdown
     * @param {boolean} disabled - true to disable, false to enable
     */
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.dropdownEl) {
            if (disabled) {
                this.dropdownEl.classList.add('disabled');
                this.triggerEl.setAttribute('tabindex', '-1');
                this.triggerEl.style.pointerEvents = 'none';
                this.triggerEl.style.opacity = '0.6';
                this.triggerEl.style.cursor = 'not-allowed';
            } else {
                this.dropdownEl.classList.remove('disabled');
                this.triggerEl.setAttribute('tabindex', '0');
                this.triggerEl.style.pointerEvents = '';
                this.triggerEl.style.opacity = '';
                this.triggerEl.style.cursor = '';
            }
        }
    }

    destroy() {
        payrollSearchableDropdowns.delete(this.id);
        this.container.innerHTML = '';
    }
}

/**
 * MonthPicker - A calendar-style month/year picker component
 * Shows a dropdown with year navigation and month grid
 */
const monthPickerInstances = new Map();

class MonthPicker {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.id = containerId;
        this.yearsBack = options.yearsBack ?? 5;
        this.yearsForward = options.yearsForward ?? 1;
        this.allowAllMonths = options.allowAllMonths !== false; // Default true for filtering
        this.onChange = options.onChange || (() => {});

        const now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth() + 1; // 1-12

        // Selected values (null month means "All Months")
        this.selectedYear = options.year ?? this.currentYear;
        this.selectedMonth = options.month ?? null; // null = All Months

        // View year for navigation
        this.viewYear = this.selectedYear;

        this.isOpen = false;
        this.monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        this.fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

        this.render();
        this.bindEvents();

        monthPickerInstances.set(this.id, this);
    }

    getDisplayText() {
        if (this.selectedMonth === null) {
            return `All Months ${this.selectedYear}`;
        }
        return `${this.monthNames[this.selectedMonth - 1]} ${this.selectedYear}`;
    }

    render() {
        const minYear = this.currentYear - this.yearsBack;
        const maxYear = this.currentYear + this.yearsForward;

        this.container.innerHTML = `
            <div class="month-picker ${this.isOpen ? 'open' : ''}" id="${this.id}-picker">
                <div class="month-picker-trigger" tabindex="0">
                    <svg class="calendar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span class="month-picker-text">${this.getDisplayText()}</span>
                    <svg class="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="month-picker-dropdown">
                    <div class="month-picker-header">
                        <button type="button" class="month-picker-nav prev" ${this.viewYear <= minYear ? 'disabled' : ''}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                        </button>
                        <span class="month-picker-year">${this.viewYear}</span>
                        <button type="button" class="month-picker-nav next" ${this.viewYear >= maxYear ? 'disabled' : ''}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>
                    </div>
                    ${this.allowAllMonths ? `
                    <div class="month-picker-all">
                        <button type="button" class="month-picker-all-btn ${this.selectedMonth === null && this.selectedYear === this.viewYear ? 'selected' : ''}">
                            All Months
                        </button>
                    </div>
                    ` : ''}
                    <div class="month-picker-grid">
                        ${this.monthNames.map((name, index) => {
                            const month = index + 1;
                            const isSelected = this.selectedMonth === month && this.selectedYear === this.viewYear;
                            const isCurrent = this.currentMonth === month && this.currentYear === this.viewYear;
                            const isFuture = this.viewYear > this.currentYear || (this.viewYear === this.currentYear && month > this.currentMonth);
                            return `
                                <button type="button"
                                    class="month-picker-month ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''} ${isFuture ? 'future' : ''}"
                                    data-month="${month}">
                                    ${name}
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        this.pickerEl = this.container.querySelector('.month-picker');
        this.triggerEl = this.container.querySelector('.month-picker-trigger');
        this.dropdownEl = this.container.querySelector('.month-picker-dropdown');
        this.textEl = this.container.querySelector('.month-picker-text');
        this.yearEl = this.container.querySelector('.month-picker-year');
        this.prevBtn = this.container.querySelector('.month-picker-nav.prev');
        this.nextBtn = this.container.querySelector('.month-picker-nav.next');
    }

    bindEvents() {
        // Toggle dropdown
        this.triggerEl.addEventListener('click', () => this.toggle());
        this.triggerEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggle();
            }
        });

        // Year navigation
        this.prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.navigateYear(-1);
        });
        this.nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.navigateYear(1);
        });

        // Month selection
        this.container.querySelectorAll('.month-picker-month').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const month = parseInt(btn.dataset.month);
                this.selectMonth(this.viewYear, month);
            });
        });

        // All months button
        const allBtn = this.container.querySelector('.month-picker-all-btn');
        if (allBtn) {
            allBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectMonth(this.viewYear, null);
            });
        }

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });
    }

    toggle() {
        // Check actual class state instead of property (in case another dropdown forcibly closed us)
        const isCurrentlyOpen = this.pickerEl.classList.contains('open');
        if (isCurrentlyOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        // Close all other open MonthPickers first
        document.querySelectorAll('.month-picker.open').forEach(picker => {
            if (picker !== this.pickerEl) {
                picker.classList.remove('open');
            }
        });

        // Close all open SearchableDropdowns
        document.querySelectorAll('.searchable-dropdown.open').forEach(dropdown => {
            dropdown.classList.remove('open');
        });

        this.isOpen = true;
        this.viewYear = this.selectedYear;
        this.pickerEl.classList.add('open');
        this.updateDropdown();
    }

    close() {
        this.isOpen = false;
        this.pickerEl.classList.remove('open');
    }

    navigateYear(delta) {
        const minYear = this.currentYear - this.yearsBack;
        const maxYear = this.currentYear + this.yearsForward;
        const newYear = this.viewYear + delta;

        if (newYear >= minYear && newYear <= maxYear) {
            this.viewYear = newYear;
            this.updateDropdown();
        }
    }

    updateDropdown() {
        const minYear = this.currentYear - this.yearsBack;
        const maxYear = this.currentYear + this.yearsForward;

        this.yearEl.textContent = this.viewYear;
        this.prevBtn.disabled = this.viewYear <= minYear;
        this.nextBtn.disabled = this.viewYear >= maxYear;

        // Update month buttons
        this.container.querySelectorAll('.month-picker-month').forEach(btn => {
            const month = parseInt(btn.dataset.month);
            const isSelected = this.selectedMonth === month && this.selectedYear === this.viewYear;
            const isCurrent = this.currentMonth === month && this.currentYear === this.viewYear;
            btn.classList.toggle('selected', isSelected);
            btn.classList.toggle('current', isCurrent);
        });

        // Update all months button
        const allBtn = this.container.querySelector('.month-picker-all-btn');
        if (allBtn) {
            allBtn.classList.toggle('selected', this.selectedMonth === null && this.selectedYear === this.viewYear);
        }
    }

    selectMonth(year, month) {
        this.selectedYear = year;
        this.selectedMonth = month;
        this.textEl.textContent = this.getDisplayText();
        this.close();
        this.onChange({ year: this.selectedYear, month: this.selectedMonth });
    }

    getValue() {
        return { year: this.selectedYear, month: this.selectedMonth };
    }

    getYear() {
        return this.selectedYear;
    }

    getMonth() {
        return this.selectedMonth;
    }

    setValue(year, month) {
        this.selectedYear = year;
        this.selectedMonth = month;
        this.viewYear = year;
        this.textEl.textContent = this.getDisplayText();
        if (this.isOpen) {
            this.updateDropdown();
        }
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

// Store for converted searchable dropdowns
const searchableDropdownInstances = new Map();

/**
 * Initialize all searchable dropdowns on the payroll page
 * Converts native select elements to SearchableDropdown components
 */
function initSearchableDropdowns() {
    // Only proceed if SearchableDropdown component is available
    if (typeof convertSelectToSearchable !== 'function') {
        console.warn('SearchableDropdown component not loaded');
        return;
    }

    // Filter dropdowns configuration (note: country filters are initialized separately via loadCountryFilter())
    const filterDropdowns = [
        { id: 'componentType', placeholder: 'All Types', searchPlaceholder: 'Search type...', compact: true },
        { id: 'structureOfficeFilter', placeholder: 'All Offices', searchPlaceholder: 'Search office...', compact: true },
        { id: 'draftOffice', placeholder: 'All Offices', searchPlaceholder: 'Search office...', compact: true },
        { id: 'runOffice', placeholder: 'All Offices', searchPlaceholder: 'Search office...', compact: true },
        // v3.0.32: Office filters for Employee section tabs - NO "All Offices", default to first
        { id: 'loanOfficeFilter', placeholder: 'Select Office', searchPlaceholder: 'Search office...', compact: true },
        { id: 'loanStatus', placeholder: 'All Status', searchPlaceholder: 'Search status...', compact: true },
        { id: 'vdOfficeFilter', placeholder: 'Select Office', searchPlaceholder: 'Search office...', compact: true },
        { id: 'vdEnrollmentStatus', placeholder: 'All Status', searchPlaceholder: 'Search status...', compact: true },
        { id: 'vdEnrollmentType', placeholder: 'All Types', searchPlaceholder: 'Search type...', compact: true },
        { id: 'adjustmentOfficeFilter', placeholder: 'Select Office', searchPlaceholder: 'Search office...', compact: true },
        { id: 'adjustmentStatusFilter', placeholder: 'All Status', searchPlaceholder: 'Search status...', compact: true },
        { id: 'adjustmentTypeFilter', placeholder: 'All Types', searchPlaceholder: 'Search type...', compact: true },
        { id: 'arrearsOfficeFilter', placeholder: 'Select Office', searchPlaceholder: 'Search office...', compact: true },
        { id: 'arrearsStatus', placeholder: 'Select Status', searchPlaceholder: 'Search status...', compact: true },
        { id: 'arrearsStructure', placeholder: 'All Structures', searchPlaceholder: 'Search structure...', compact: true },
        { id: 'allPayslipsOffice', placeholder: 'All Offices', searchPlaceholder: 'Search office...', compact: true },
        { id: 'allPayslipsDepartment', placeholder: 'All Departments', searchPlaceholder: 'Search department...', compact: true },
        { id: 'salaryReportOffice', placeholder: 'Select Office', searchPlaceholder: 'Search office...', compact: true },
        { id: 'salaryReportDepartment', placeholder: 'All Departments', searchPlaceholder: 'Search department...', compact: true },
        { id: 'ctcArrearsStatus', placeholder: 'Select Status', searchPlaceholder: 'Search status...', compact: true },
        // Employee Salaries tab filters
        { id: 'empSalaryOfficeFilter', placeholder: 'All Offices', searchPlaceholder: 'Search office...', compact: true },
        { id: 'empSalaryDeptFilter', placeholder: 'All Departments', searchPlaceholder: 'Search department...', compact: true },
        { id: 'empSalaryStatusFilter', placeholder: 'All Status', searchPlaceholder: 'Search status...', compact: true }
    ];

    // Form dropdowns configuration (18 dropdowns)
    const formDropdowns = [
        { id: 'draftPayrollOffice', placeholder: 'Select Office', searchPlaceholder: 'Search office...' },
        { id: 'structureOffice', placeholder: 'Select Office (Required)', searchPlaceholder: 'Search office...' },
        { id: 'structureIsDefault', placeholder: 'Select', searchPlaceholder: 'Search...' },
        { id: 'componentCategory', placeholder: 'Select Category', searchPlaceholder: 'Search...' },
        { id: 'calculationType', placeholder: 'Select Type', searchPlaceholder: 'Search...' },
        { id: 'calculationBase', placeholder: 'Select Base', searchPlaceholder: 'Search...' },
        { id: 'isTaxable', placeholder: 'Select', searchPlaceholder: 'Search...' },
        { id: 'loanEmployee', placeholder: 'Select Employee', searchPlaceholder: 'Search employee...', virtualScroll: true },
        { id: 'loanType', placeholder: 'Select Loan Type', searchPlaceholder: 'Search...' },
        { id: 'interestCalculationType', placeholder: 'Select Calculation', searchPlaceholder: 'Search...' },
        { id: 'disbursementMode', placeholder: 'Select Mode', searchPlaceholder: 'Search...' },
        { id: 'bulkOfficeId', placeholder: 'All Offices', searchPlaceholder: 'Search office...' },
        { id: 'bulkDepartmentId', placeholder: 'All Departments', searchPlaceholder: 'Search department...' },
        { id: 'bulkDesignationId', placeholder: 'All Designations', searchPlaceholder: 'Search designation...' },
        { id: 'vdTypeIsActive', placeholder: 'Select Status', searchPlaceholder: 'Search...' },
        { id: 'vdEnrollmentDeductionType', placeholder: 'Select VD Type', searchPlaceholder: 'Search type...' },
        // Employee Salary Modal dropdowns
        { id: 'empSalaryStructureId', placeholder: 'Select Salary Structure', searchPlaceholder: 'Search structure...', onChange: () => onEmpSalaryStructureChange() },
        { id: 'empRevisionType', placeholder: 'Select Revision Type', searchPlaceholder: 'Search type...' }
    ];

    // Convert all dropdowns
    [...filterDropdowns, ...formDropdowns].forEach(config => {
        const select = document.getElementById(config.id);
        if (select && select.tagName === 'SELECT') {
            const dropdown = convertSelectToSearchable(config.id, {
                placeholder: config.placeholder,
                searchPlaceholder: config.searchPlaceholder,
                compact: config.compact || false,
                virtualScroll: config.virtualScroll || false,
                onChange: config.onChange || null
            });
            if (dropdown) {
                searchableDropdownInstances.set(config.id, dropdown);
            }
        }
    });

    console.log(`[Payroll] Initialized ${searchableDropdownInstances.size} searchable dropdowns`);
}

/**
 * Get a searchable dropdown instance by its original select ID
 * @param {string} id - The original select element ID
 * @returns {SearchableDropdown|null}
 */
function getSearchableDropdown(id) {
    return searchableDropdownInstances.get(id) || null;
}

/**
 * Update options for a searchable dropdown
 * @param {string} id - The original select element ID
 * @param {Array} options - New options array [{value, label, description?}]
 */
function updateSearchableDropdownOptions(id, options) {
    const dropdown = searchableDropdownInstances.get(id);
    if (dropdown) {
        dropdown.setOptions(options);
    }
    // Also update the hidden select for form compatibility
    const select = document.getElementById(id);
    if (select) {
        select.innerHTML = options.map(opt =>
            `<option value="${escapeHtml(String(opt.value))}">${escapeHtml(opt.label)}</option>`
        ).join('');
    }
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

        // Initialize RBAC
        hrmsRoles.init();

        // CRITICAL: Require basic organization setup before accessing Payroll page
        // This prevents users from bypassing setup by directly navigating to URL
        // Payroll requires at least: compliance + office + department + designation + shift
        const setupComplete = await hrmsRoles.requireOrganizationSetup({
            showToast: true,
            redirectUrl: 'organization.html',
            requireBasicOnly: true  // Payroll can work with basic setup
        });
        if (!setupComplete) return;

        // Apply RBAC visibility
        applyPayrollRBAC();

        // Setup tabs
        setupTabs();

        // Load initial data - including year dropdowns
        await loadOffices();
        await populateYearDropdowns();

        // Populate employee salary filters
        await populateEmpSalaryFilters();

        // Initialize Employee Salaries tab event listeners
        initEmployeeSalariesTab();

        // Load country filter first (needed for components)
        await loadCountryFilter();

        if (hrmsRoles.isHRAdmin()) {
            await Promise.all([
                loadPayrollDrafts(),
                loadPayrollRuns(),
                loadEmployees(),
                loadComponents(),
                loadSalaryStructures()
            ]);
        }

        await loadLoans();

        // Set default dates for payroll run
        setDefaultPayrollDates();

        // Initialize searchable dropdowns (after data is loaded)
        initSearchableDropdowns();

        // v3.0.45: Initialize arrears guide section
        initArrearsGuide();

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

// Initialize month pickers for payroll tabs
async function populateYearDropdowns() {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    // Initialize Draft Month Picker - current month selected by default
    draftMonthPicker = new MonthPicker('draftMonthPicker', {
        yearsBack: 20,
        yearsForward: 10,
        year: currentYear,
        month: currentMonth,
        allowAllMonths: false,
        onChange: () => loadPayrollDrafts()
    });

    // Initialize Run Month Picker - current month selected by default
    runMonthPicker = new MonthPicker('runMonthPicker', {
        yearsBack: 20,
        yearsForward: 10,
        year: currentYear,
        month: currentMonth,
        allowAllMonths: false,
        onChange: () => loadPayrollRuns()
    });

    // Initialize All Payslips Month Picker - current month selected by default
    allPayslipsMonthPicker = new MonthPicker('allPayslipsMonthPicker', {
        yearsBack: 20,
        yearsForward: 10,
        year: currentYear,
        month: currentMonth,
        allowAllMonths: false,
        onChange: () => loadAllPayslips()
    });

    // Initialize Statutory Filing Month Picker - current month selected by default
    sfMonthPicker = new MonthPicker('sfMonthPicker', {
        yearsBack: 20,
        yearsForward: 10,
        year: currentYear,
        month: currentMonth,
        allowAllMonths: false,
        onChange: () => loadStatutoryFilingData()
    });

    // Keep draftPayrollYear select for create draft modal (if it exists)
    const draftPayrollYearSelect = document.getElementById('draftPayrollYear');
    if (draftPayrollYearSelect) {
        const years = [];
        for (let y = currentYear + 1; y >= currentYear - 5; y--) {
            years.push(y);
        }
        populateYearSelect(draftPayrollYearSelect, years);
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
            } else if (tabId === 'employee-salaries') {
                await loadEmployeeSalaries();
            } else if (tabId === 'tax-configuration') {
                await loadTaxConfiguration();
            } else if (tabId === 'statutory-filing') {
                initStatutoryFilingTab();
                await loadStatutoryFilingData();
            }
        });
    });

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
        const pickerValue = runMonthPicker?.getValue() || { year: new Date().getFullYear(), month: null };
        const year = pickerValue.year;
        const month = pickerValue.month || '';
        const officeId = document.getElementById('runOffice')?.value || '';

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
        const pickerValue = draftMonthPicker?.getValue() || { year: new Date().getFullYear(), month: null };
        const year = pickerValue.year;
        const month = pickerValue.month || '';
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
            <td>${formatCurrency(draft.total_gross, draft.currency_code, draft.currency_symbol)}</td>
            <td>${formatCurrency(draft.total_net, draft.currency_code, draft.currency_symbol)}</td>
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

    // Validate month picker selection
    if (!createDraftMonthPicker || !createDraftMonthPicker.getMonth()) {
        showToast('Please select a payroll period', 'error');
        return;
    }

    try {
        showLoading();
        const officeId = document.getElementById('draftPayrollOffice').value;

        // Get month and year from month picker
        const month = createDraftMonthPicker.getMonth();
        const year = createDraftMonthPicker.getYear();

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

        // Update summary cards - v3.0.25: Use currency from draft
        document.getElementById('draftTotalEmployees').textContent = summary.total_employees || 0;
        document.getElementById('draftTotalGross').textContent = formatCurrency(summary.total_gross || 0, draft.currency_code, draft.currency_symbol);
        document.getElementById('draftTotalDeductions').textContent = formatCurrency(summary.total_deductions || 0, draft.currency_code, draft.currency_symbol);
        document.getElementById('draftTotalNet').textContent = formatCurrency(summary.total_net || 0, draft.currency_code, draft.currency_symbol);

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
                    <td>${formatCurrency(p.gross_earnings, p.currency_code, p.currency_symbol)}</td>
                    <td>${formatCurrency(p.total_deductions, p.currency_code, p.currency_symbol)}</td>
                    <td><strong>${formatCurrency(p.net_pay, p.currency_code, p.currency_symbol)}</strong></td>
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

        // v3.0.18: COUNTRY-AGNOSTIC - Use currency from backend response
        const currencySymbol = payslip.currency_symbol || '₹';
        const currencyCode = payslip.currency_code || 'INR';
        const localeMap = { 'INR': 'en-IN', 'USD': 'en-US', 'GBP': 'en-GB', 'AED': 'ar-AE', 'IDR': 'id-ID', 'MVR': 'dv-MV' };
        const locale = localeMap[currencyCode] || 'en-IN';

        // Local currency formatter using backend-provided currency
        // v3.0.20: Added space between symbol and number for readability
        const fmtCurrency = (amt) => {
            if (amt === null || amt === undefined) return `${currencySymbol} 0`;
            return `${currencySymbol} ${Number(amt).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        };

        const items = payslip.items || [];

        // Group items by structure for compliance display
        const structureGroups = groupItemsByStructure(items);
        const hasMultipleStructures = structureGroups.length > 1;

        // Build structure-wise breakdown HTML
        let structureBreakdownHtml = '';

        // Calculate employer contributions for both single and multi-structure views
        // v3.1.0: Use backend-provided contributor_type directly
        const isEmployerComponentMulti = (item) => {
            // Primary: use backend-provided contributor_type
            if (item.contributor_type) {
                return item.contributor_type === 'employer';
            }
            // Fallback for legacy data
            return item.component_type === 'employer_contribution' ||
                   item.component_type === 'benefit' ||
                   (item.charge_category && item.charge_category.endsWith('_employer'));
        };
        const employerContributionsAll = items.filter(i => isEmployerComponentMulti(i));
        const ctcIncludedItemsAll = employerContributionsAll.filter(i => i.cost_classification_employer === 'included_in_ctc');
        const overheadItemsAll = employerContributionsAll.filter(i => i.cost_classification_employer === 'organizational_overhead');

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
                                                    <td class="text-right">${fmtCurrency(i.amount)}</td>
                                                    <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="3" class="text-muted">No earnings</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${fmtCurrency(groupEarningsTotal)}</td>
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
                                                    <td class="text-right">${fmtCurrency(i.amount)}</td>
                                                    <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="3" class="text-muted">No deductions</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${fmtCurrency(groupDeductionsTotal)}</td>
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
                                <span style="font-weight: 600; color: var(--color-success);">${fmtCurrency(payslip.gross_earnings)}</span>
                            </div>
                            ${payslip.arrears > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Arrears Total</span>
                                <span style="font-weight: 600; color: var(--color-warning);">${fmtCurrency(payslip.arrears)}</span>
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
                                                    ${arr.source_type === 'ctc_revision' && arr.old_ctc ? fmtCurrency(arr.old_ctc) + '/yr' : fmtCurrency(arr.old_gross)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--color-success);">
                                                    ${arr.source_type === 'ctc_revision' && arr.new_ctc ? fmtCurrency(arr.new_ctc) + '/yr' : fmtCurrency(arr.new_gross)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-warning);">${fmtCurrency(arr.arrears_amount)}</td>
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
                                <span style="font-weight: 600; color: var(--color-danger);">${fmtCurrency(payslip.total_deductions)}</span>
                            </div>
                            ${payslip.loan_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Loan Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${fmtCurrency(payslip.loan_deductions)}</span>
                            </div>
                            ` : ''}
                            ${payslip.voluntary_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Voluntary Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${fmtCurrency(payslip.voluntary_deductions)}</span>
                            </div>
                            ${payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0 ? `
                            <div class="vd-breakdown-section" style="margin: 0.5rem 0; padding: 0.5rem; background: color-mix(in srgb, var(--color-info) 8%, transparent); border-radius: 6px; border-left: 3px solid var(--color-info);">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                    <svg width="14" height="14" fill="currentColor" style="color: var(--color-info);"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445z"/></svg>
                                    <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-info);">Voluntary Deduction Details</span>
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
                                                    ${fmtCurrency(vd.full_amount)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-danger);">
                                                    ${fmtCurrency(vd.deducted_amount)}
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
                                <span style="font-weight: 700; color: var(--brand-primary); font-size: 1.1rem;">${fmtCurrency(payslip.net_pay)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                ${(ctcIncludedItemsAll.length > 0 || overheadItemsAll.length > 0) ? `
                <div style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-subtle); border-radius: 8px;">
                    <h5 style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: var(--text-secondary);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        Employer Cost Classification
                    </h5>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.8rem;">
                        ${ctcIncludedItemsAll.length > 0 ? `
                        <div style="padding: 0.5rem; background: rgba(var(--color-success-rgb, 34, 197, 94), 0.08); border-radius: 6px; border-left: 3px solid var(--color-success);">
                            <div style="font-size: 0.7rem; color: var(--color-success); margin-bottom: 0.4rem; font-weight: 600;">Within CTC</div>
                            ${ctcIncludedItemsAll.map(i => `
                                <div style="display: flex; justify-content: space-between; padding: 0.2rem 0;">
                                    <span>${i.component_name}</span>
                                    <span style="font-weight: 500;">${fmtCurrency(i.amount)}</span>
                                </div>
                            `).join('')}
                            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-top: 1px solid var(--border-color); margin-top: 0.3rem; font-weight: 600;">
                                <span>Total</span>
                                <span>${fmtCurrency(ctcIncludedItemsAll.reduce((sum, i) => sum + (i.amount || 0), 0))}</span>
                            </div>
                        </div>
                        ` : ''}
                        ${overheadItemsAll.length > 0 ? `
                        <div style="padding: 0.5rem; background: rgba(var(--color-info-rgb, 59, 130, 246), 0.08); border-radius: 6px; border-left: 3px solid var(--color-info);">
                            <div style="font-size: 0.7rem; color: var(--color-info); margin-bottom: 0.4rem; font-weight: 600;">Beyond CTC (Overhead)</div>
                            ${overheadItemsAll.map(i => `
                                <div style="display: flex; justify-content: space-between; padding: 0.2rem 0;">
                                    <span>${i.component_name}</span>
                                    <span style="font-weight: 500;">${fmtCurrency(i.amount)}</span>
                                </div>
                            `).join('')}
                            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-top: 1px solid var(--border-color); margin-top: 0.3rem; font-weight: 600;">
                                <span>Total</span>
                                <span>${fmtCurrency(overheadItemsAll.reduce((sum, i) => sum + (i.amount || 0), 0))}</span>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
            `;
        } else {
            // Single structure - use original layout with eligibility and cost classification
            const earnings = items.filter(i => i.component_type === 'earning');
            const deductions = items.filter(i => i.component_type === 'deduction');

            // Separate employer contributions for cost classification display
            // v3.1.0: Use backend-provided contributor_type and ctc_classification directly
            const isEmployerComponent = (item) => {
                // Primary: use backend-provided contributor_type
                if (item.contributor_type) {
                    return item.contributor_type === 'employer';
                }
                // Fallback for legacy data
                return item.component_type === 'employer_contribution' ||
                       item.component_type === 'benefit' ||
                       (item.charge_category && item.charge_category.endsWith('_employer'));
            };
            const employerContributions = items.filter(i => isEmployerComponent(i));
            // v3.1.0: Use backend-provided ctc_classification (fallback to cost_classification_employer for payslip items)
            const ctcIncludedItems = employerContributions.filter(i =>
                i.ctc_classification === 'included_in_ctc' || i.cost_classification_employer === 'included_in_ctc');
            const overheadItems = employerContributions.filter(i =>
                i.ctc_classification === 'organizational_overhead' || i.cost_classification_employer === 'organizational_overhead');

            const earningsHtml = earnings.length > 0 ?
                earnings.map(i => `<tr><td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td><td class="text-right">${fmtCurrency(i.amount)}</td><td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${fmtCurrency(i.ytd_amount || 0)}</td></tr>`).join('') :
                '<tr><td colspan="3" class="text-muted">No earnings</td></tr>';

            const deductionsHtml = deductions.length > 0 ?
                deductions.map(i => {
                    const isEligible = i.is_eligible !== false;
                    const eligibilityIcon = i.amount === 0 && !isEligible ? '<span style="color:var(--color-warning);" title="Not eligible">⚠</span> ' : '';
                    const eligibilityReason = !isEligible && i.eligibility_reason ?
                        `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;max-width:180px;">${i.eligibility_reason}</div>` : '';
                    const proratedTag = i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : '';
                    return `<tr>
                        <td>
                            ${eligibilityIcon}${i.component_name}${proratedTag}
                            ${eligibilityReason}
                        </td>
                        <td class="text-right">${fmtCurrency(i.amount)}</td>
                        <td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                    </tr>`;
                }).join('') :
                '<tr><td colspan="3" class="text-muted">No deductions</td></tr>';

            // Employer cost classification section
            const employerCostHtml = (ctcIncludedItems.length > 0 || overheadItems.length > 0) ? `
                <div style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-subtle); border-radius: 8px;">
                    <h5 style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: var(--text-secondary);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        Employer Cost Classification
                    </h5>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.8rem;">
                        ${ctcIncludedItems.length > 0 ? `
                        <div style="padding: 0.5rem; background: rgba(var(--color-success-rgb, 34, 197, 94), 0.08); border-radius: 6px; border-left: 3px solid var(--color-success);">
                            <div style="font-size: 0.7rem; color: var(--color-success); margin-bottom: 0.4rem; font-weight: 600;">Within CTC</div>
                            ${ctcIncludedItems.map(i => `
                                <div style="display: flex; justify-content: space-between; padding: 0.2rem 0;">
                                    <span>${i.component_name}</span>
                                    <span style="font-weight: 500;">${fmtCurrency(i.amount)}</span>
                                </div>
                            `).join('')}
                            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-top: 1px solid var(--border-color); margin-top: 0.3rem; font-weight: 600;">
                                <span>Total</span>
                                <span>${fmtCurrency(ctcIncludedItems.reduce((sum, i) => sum + (i.amount || 0), 0))}</span>
                            </div>
                        </div>
                        ` : ''}
                        ${overheadItems.length > 0 ? `
                        <div style="padding: 0.5rem; background: rgba(var(--color-info-rgb, 59, 130, 246), 0.08); border-radius: 6px; border-left: 3px solid var(--color-info);">
                            <div style="font-size: 0.7rem; color: var(--color-info); margin-bottom: 0.4rem; font-weight: 600;">Beyond CTC (Overhead)</div>
                            ${overheadItems.map(i => `
                                <div style="display: flex; justify-content: space-between; padding: 0.2rem 0;">
                                    <span>${i.component_name}</span>
                                    <span style="font-weight: 500;">${fmtCurrency(i.amount)}</span>
                                </div>
                            `).join('')}
                            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-top: 1px solid var(--border-color); margin-top: 0.3rem; font-weight: 600;">
                                <span>Total</span>
                                <span>${fmtCurrency(overheadItems.reduce((sum, i) => sum + (i.amount || 0), 0))}</span>
                            </div>
                        </div>
                        ` : ''}
                    </div>
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
                                    <td class="text-right">${fmtCurrency(payslip.gross_earnings)}</td>
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
                                ${payslip.loan_deductions > 0 ? `<tr><td>Loan EMI</td><td class="text-right">${fmtCurrency(payslip.loan_deductions)}</td><td></td></tr>` : ''}
                                ${payslip.voluntary_deductions > 0 && payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0 ?
                                    payslip.voluntary_deduction_items.map(vd => `
                                        <tr>
                                            <td>
                                                ${vd.deduction_type_name}
                                                ${vd.is_prorated ? `<span style="font-size:0.7rem;color:var(--text-muted);"> (${vd.days_applicable || '-'}/${vd.total_days_in_period || '-'} days)</span>` : ''}
                                            </td>
                                            <td class="text-right">${fmtCurrency(vd.deducted_amount)}</td>
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
                                    <td class="text-right">${fmtCurrency(payslip.total_deductions + (payslip.loan_deductions || 0) + (payslip.voluntary_deductions || 0))}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
                ${employerCostHtml}
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
                    <div style="font-size: 1.1rem; font-weight: 700;">${fmtCurrency(payslip.net_pay)}</div>
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
            <div style="margin-top: 1rem; padding: 1rem; background: linear-gradient(135deg, color-mix(in srgb, var(--color-success) 8%, transparent) 0%, color-mix(in srgb, var(--color-info) 8%, transparent) 100%); border-radius: 8px; border: 1px solid var(--border-color);">
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
                                            <span class="badge" style="background: var(--color-success); color: var(--text-inverse); font-size: 0.65rem; padding: 0.15rem 0.4rem;">Reimbursement</span>
                                        </span>
                                    </td>
                                    <td class="text-right" style="font-weight: 600; color: var(--color-success);">+${fmtCurrency(payslip.reimbursements)}</td>
                                </tr>
                                ` : ''}
                                ${payslip.other_earnings > 0 ? `
                                <tr>
                                    <td style="padding: 0.4rem 0;">
                                        <span style="display: flex; align-items: center; gap: 0.4rem;">
                                            <span class="badge" style="background: var(--brand-accent); color: var(--text-inverse); font-size: 0.65rem; padding: 0.15rem 0.4rem;">Bonus/Incentive</span>
                                        </span>
                                    </td>
                                    <td class="text-right" style="font-weight: 600; color: var(--color-success);">+${fmtCurrency(payslip.other_earnings)}</td>
                                </tr>
                                ` : ''}
                                ${payslip.arrears > 0 ? `
                                <tr>
                                    <td style="padding: 0.4rem 0;">
                                        <span style="display: flex; align-items: center; gap: 0.4rem;">
                                            <span class="badge" style="background: var(--color-warning); color: var(--text-inverse); font-size: 0.65rem; padding: 0.15rem 0.4rem;">Arrears</span>
                                        </span>
                                    </td>
                                    <td class="text-right" style="font-weight: 600; color: var(--color-warning);">+${fmtCurrency(payslip.arrears)}</td>
                                </tr>
                                ` : ''}
                                ${(payslip.reimbursements <= 0 && payslip.other_earnings <= 0 && payslip.arrears <= 0) ? `
                                <tr><td colspan="2" class="text-muted" style="font-size: 0.8rem;">No additional earnings</td></tr>
                                ` : ''}
                            </tbody>
                            <tfoot style="border-top: 1px solid var(--border-color);">
                                <tr style="font-weight: 600;">
                                    <td style="padding: 0.5rem 0;">Total Additional</td>
                                    <td class="text-right" style="color: var(--color-success);">+${fmtCurrency((payslip.reimbursements || 0) + (payslip.other_earnings || 0) + (payslip.arrears || 0))}</td>
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
                                            <span class="badge" style="background: var(--color-danger); color: var(--text-inverse); font-size: 0.65rem; padding: 0.15rem 0.4rem;">Recovery</span>
                                        </span>
                                    </td>
                                    <td class="text-right" style="font-weight: 600; color: var(--color-danger);">-${fmtCurrency(payslip.other_deductions)}</td>
                                </tr>
                                ` : `
                                <tr><td colspan="2" class="text-muted" style="font-size: 0.8rem;">No additional deductions</td></tr>
                                `}
                            </tbody>
                            ${payslip.other_deductions > 0 ? `
                            <tfoot style="border-top: 1px solid var(--border-color);">
                                <tr style="font-weight: 600;">
                                    <td style="padding: 0.5rem 0;">Total Deducted</td>
                                    <td class="text-right" style="color: var(--color-danger);">-${fmtCurrency(payslip.other_deductions || 0)}</td>
                                </tr>
                            </tfoot>
                            ` : ''}
                        </table>
                    </div>
                </div>
                <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Net Impact from Adjustments</span>
                    <span style="font-weight: 700; font-size: 1rem; color: ${((payslip.reimbursements || 0) + (payslip.other_earnings || 0) + (payslip.arrears || 0) - (payslip.other_deductions || 0)) >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">
                        ${((payslip.reimbursements || 0) + (payslip.other_earnings || 0) + (payslip.arrears || 0) - (payslip.other_deductions || 0)) >= 0 ? '+' : ''}${fmtCurrency((payslip.reimbursements || 0) + (payslip.other_earnings || 0) + (payslip.arrears || 0) - (payslip.other_deductions || 0))}
                    </span>
                </div>
            </div>
            ` : ''}

            <!-- Calculation Button - v3.0.16 -->
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed var(--border-color); display: flex; justify-content: center;">
                <button class="btn btn-secondary" onclick="viewCalculationProof('${payslipId}')" style="display: flex; align-items: center; gap: 0.5rem;">
                    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    View Calculation
                </button>
            </div>
        `;

        openModal('payslipModal');
        hideLoading();
    } catch (error) {
        console.error('Error loading draft payslip:', error);
        showToast('Failed to load payslip details', 'error');
        hideLoading();
    }
}

/**
 * View calculation proof for a draft payslip.
 * v3.0.16: Added for audit and compliance purposes.
 * v3.0.24: Updated to request markdown format from JSON-based proof storage.
 * v3.0.28: Complete UI rewrite - now uses JSON data to render a beautiful card-based UI.
 * v3.0.115: Delegated to unified PayslipModal component.
 */
async function viewCalculationProof(payslipId) {
    // Close the payslip modal first if open
    closeModal('payslipModal');
    // Use unified PayslipModal component (isDraft = true)
    PayslipModal.viewCalculationProof(payslipId, true);
}

/**
 * v3.0.26: View calculation proof for a PROCESSED payslip.
 * v3.0.115: Delegated to unified PayslipModal component.
 */
async function viewCalculationProofProcessed(payslipId) {
    // Close the payslip modal first if open
    closeModal('payslipModal');
    // Use unified PayslipModal component (isDraft = false for processed payslips)
    PayslipModal.viewCalculationProof(payslipId, false);
}


// Helper function to group payslip items by structure
function groupItemsByStructure(items) {
    const groups = [];
    const groupMap = new Map();

    for (const item of items) {
        // Group by period dates AND structure_name to handle:
        // 1. Mid-period appraisals (same structure, different CTC, different period dates)
        // 2. Structure version changes (different structure_name like "v1" vs "v2", same period dates)
        // Including structure_name ensures versioned structures are shown separately
        const structureName = item.structure_name || 'Standard';
        const periodKey = `${structureName}_${item.period_start || 'none'}_${item.period_end || 'none'}`;

        if (!groupMap.has(periodKey)) {
            const group = {
                structure_id: item.structure_id,
                structure_name: structureName,
                period_start: item.period_start,
                period_end: item.period_end,
                items: []
            };
            groupMap.set(periodKey, group);
            groups.push(group);
        }

        groupMap.get(periodKey).items.push(item);
    }

    // Sort groups by period_start date, then by structure_name (version order)
    groups.sort((a, b) => {
        if (!a.period_start) return -1;
        if (!b.period_start) return 1;
        const dateCompare = new Date(a.period_start) - new Date(b.period_start);
        if (dateCompare !== 0) return dateCompare;
        // Same period - sort by structure_name to maintain version order
        return (a.structure_name || '').localeCompare(b.structure_name || '');
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

    // Initialize or re-initialize the month picker for the create draft modal
    createDraftMonthPicker = new MonthPicker('createDraftMonthPicker', {
        yearsBack: 1,
        yearsForward: 1,
        year: currentYear,
        month: currentMonth,
        allowAllMonths: false,
        onChange: () => updateDraftPeriodDates()
    });

    const draftNameField = document.getElementById('draftName');
    if (draftNameField) draftNameField.value = 'Draft';

    // Set period start to 1st of month
    document.getElementById('draftPeriodStart').value = formatDateLocal(currentYear, currentMonth, 1);

    // Set period end to last day of month
    const lastDay = new Date(currentYear, currentMonth, 0).getDate();
    document.getElementById('draftPeriodEnd').value = formatDateLocal(currentYear, currentMonth, lastDay);

    // Reset office dropdown (searchable dropdown doesn't reset with form.reset())
    const officeDropdown = getSearchableDropdown('draftPayrollOffice');
    if (officeDropdown && typeof officeDropdown.setValue === 'function') {
        officeDropdown.setValue(''); // Reset to "Select Office" placeholder
    }

    // Also reset notes textarea
    const notesField = document.getElementById('draftNotes');
    if (notesField) notesField.value = '';

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
    if (!createDraftMonthPicker) return;

    const month = createDraftMonthPicker.getMonth();
    const year = createDraftMonthPicker.getYear();
    if (!month || !year) return;

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

    // v3.0.20: Use currency from run (enriched by backend from country config)
    tbody.innerHTML = runs.map(run => `
        <tr>
            <td><code>${run.run_number || run.id.substring(0, 8)}</code></td>
            <td>${getMonthName(run.payroll_month)} ${run.payroll_year}</td>
            <td>${run.office_name || 'All Offices'}</td>
            <td>${run.total_employees || 0}</td>
            <td>${formatCurrency(run.total_gross, run.currency_code, run.currency_symbol)}</td>
            <td>${formatCurrency(run.total_net, run.currency_code, run.currency_symbol)}</td>
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
    const searchTerm = document.getElementById('structureSearch')?.value?.toLowerCase() || '';

    const filtered = structures.filter(s =>
        (s.structure_name || '').toLowerCase().includes(searchTerm) ||
        (s.structure_code || '').toLowerCase().includes(searchTerm) ||
        (s.office_name || '').toLowerCase().includes(searchTerm)
    );

    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        salaryStructuresPagination = createTablePagination('salaryStructuresPagination', {
            containerSelector: '#salaryStructuresPagination',
            data: filtered,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderSalaryStructuresRows(paginatedData);
            }
        });
    } else {
        renderSalaryStructuresRows(filtered);
    }
}

function renderSalaryStructuresRows(filtered) {
    const tbody = document.getElementById('salaryStructuresTable');

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
                    ${!s.has_processed_payroll ? `
                    <button class="action-btn" onclick="editSalaryStructure('${s.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    ` : `
                    <span class="action-btn action-btn-disabled" title="Cannot edit: Payroll has been processed with this structure">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    </span>
                    `}
                    ${(s.employee_count || 0) === 0 ? `
                    <button class="action-btn danger" onclick="deleteSalaryStructure('${s.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                    ` : `
                    <span class="action-btn action-btn-disabled" title="Cannot delete: ${s.employee_count} employee(s) using this structure">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </span>
                    `}
                </div>
            </td>
        </tr>
    `).join('');
}

async function deleteSalaryStructure(structureId) {
    const structure = structures.find(s => s.id === structureId);
    if (!structure) {
        showToast('Salary structure not found', 'error');
        return;
    }

    // Double check employee count
    if ((structure.employee_count || 0) > 0) {
        showToast(`Cannot delete: ${structure.employee_count} employee(s) are using this structure`, 'error');
        return;
    }

    const structureName = structure.structure_name || 'this structure';
    const confirmed = await Confirm.show({
        message: `Are you sure you want to delete "${structureName}"? This action cannot be undone.`,
        title: 'Delete Salary Structure',
        type: 'danger',
        confirmText: 'Delete'
    });

    if (!confirmed) {
        return;
    }

    try {
        const response = await api.request(`/hrms/payroll/structures/${structureId}`, {
            method: 'DELETE'
        });

        if (response.ok || response.success) {
            showToast(`Salary structure "${structureName}" deleted successfully`, 'success');
            await loadSalaryStructures(); // Reload the structures list
        } else {
            const errorMessage = response.message || response.error || 'Failed to delete salary structure';
            showToast(errorMessage, 'error');
        }
    } catch (error) {
        console.error('Error deleting salary structure:', error);
        let errorMessage = 'Failed to delete salary structure';
        if (error.message) {
            errorMessage = error.message;
        }
        showToast(errorMessage, 'error');
    }
}

async function loadComponents() {
    try {
        const response = await api.request('/hrms/payroll/components');
        components = response || [];

        // Load cost classifications for the selected country (for CTC badges on employer contributions)
        const countryCode = getSelectedCountry();
        if (countryCode) {
            await loadCostClassifications(countryCode);
        }

        updateComponentsTables();
    } catch (error) {
        console.error('Error loading components:', error);
    }
}

/**
 * Load statutory employee deductions that are auto-attached to salary structures.
 * These are mandatory deductions like PF-EE, ESI-EE, LWF-EE, PT, TDS-EE that are
 * automatically added by the backend and cannot be removed by users.
 * @param {string} countryCode - Country code (e.g., "IN")
 * @param {string} stateCode - State code (e.g., "MH") or "ALL" for all states
 */
async function loadStatutoryEmployeeDeductions(countryCode, stateCode) {
    try {
        if (!countryCode || !stateCode) {
            console.log('No country/state code provided, skipping statutory deductions load');
            statutoryEmployeeDeductions = [];
            return;
        }
        const response = await api.request(`/hrms/payroll/components/statutory-employee-deductions?countryCode=${encodeURIComponent(countryCode)}&stateCode=${encodeURIComponent(stateCode)}`);
        statutoryEmployeeDeductions = response?.components || [];
        console.log(`Loaded ${statutoryEmployeeDeductions.length} statutory employee deductions for ${countryCode}/${stateCode}`);
    } catch (error) {
        console.error('Error loading statutory employee deductions:', error);
        statutoryEmployeeDeductions = [];
    }
}

/**
 * Render the statutory employee deductions section in the salary structure modal.
 * These components are auto-attached by the backend and are displayed as locked/non-editable.
 * Uses card-based layout in the Auto-Attached tab.
 */
function renderStatutoryDeductionsSection() {
    const container = document.getElementById('statutoryDeductionsContainer');
    if (!container) {
        console.warn('Statutory deductions container not found');
        return;
    }

    // Check if an office is selected
    const selectedOfficeId = document.getElementById('structureOffice')?.value;

    if (!selectedOfficeId) {
        container.innerHTML = `
            <div class="statutory-compact-list">
                <div class="statutory-compact-empty">Select an office to see applicable deductions</div>
            </div>
        `;
        updateStatutoryCountBadge();
        return;
    }

    if (!statutoryEmployeeDeductions || statutoryEmployeeDeductions.length === 0) {
        container.innerHTML = `
            <div class="statutory-compact-list">
                <div class="statutory-compact-empty">No deductions configured for this location</div>
            </div>
        `;
        updateStatutoryCountBadge();
        return;
    }

    const html = `
        <div class="statutory-compact-list">
            ${statutoryEmployeeDeductions.map(c => `
                <div class="statutory-compact-item">
                    <span class="statutory-compact-code">${escapeHtml(c.component_code || c.code)}</span>
                    <span class="statutory-compact-name">${escapeHtml(c.component_name || c.name)}</span>
                </div>
            `).join('')}
        </div>
    `;
    container.innerHTML = html;

    // Update the deduction count in header
    const countEl = document.getElementById('deductionCount');
    if (countEl) {
        countEl.textContent = statutoryEmployeeDeductions.length;
    }

    updateStatutoryCountBadge();
}

function toggleStatutorySection() {
    const content = document.querySelector('.statutory-collapse-content');
    const header = document.querySelector('.statutory-collapse-header');
    const hint = document.querySelector('.statutory-collapse-hint');

    if (content && header) {
        const isCollapsed = content.classList.contains('collapsed');
        content.classList.toggle('collapsed');
        header.classList.toggle('expanded');

        if (hint) {
            hint.textContent = isCollapsed ? 'Auto-attached • Click to collapse' : 'Auto-attached • Click to expand';
        }
    }
}

/**
 * Toggle the employer contributions section collapse state
 */
function toggleEmployerContributionsSection() {
    const content = document.querySelector('.employer-collapse-content');
    const header = document.querySelector('.employer-collapse-header');
    const hint = document.querySelector('.employer-collapse-hint');

    if (content && header) {
        const isCollapsed = content.classList.contains('collapsed');
        content.classList.toggle('collapsed');
        header.classList.toggle('expanded');

        if (hint) {
            hint.textContent = isCollapsed ? 'Auto-attached • Click to collapse' : 'Auto-attached • Click to expand';
        }
    }
}

/**
 * Switch between tabs in the salary structure modal
 * @param {string} tabName - 'components' or 'statutory'
 */
function switchStructureTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.structure-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.structure-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
}

/**
 * Update the statutory count badge on the Auto-Attached tab
 * v3.0.54: Only counts employee deductions - employer contributions are NOT part of salary structure
 */
function updateStatutoryCountBadge() {
    const badge = document.getElementById('statutoryCountBadge');
    if (badge) {
        // v3.0.54: Only count employee deductions - employer contributions are calculated during payroll
        const totalCount = statutoryEmployeeDeductions?.length || 0;
        badge.textContent = totalCount;
    }
}

/**
 * Update the empty state visibility for components
 */
function updateComponentsEmptyState() {
    const componentsList = document.getElementById('structureComponents');
    const emptyState = document.getElementById('componentsEmptyState');

    if (componentsList && emptyState) {
        const hasComponents = componentsList.children.length > 0;
        emptyState.classList.toggle('visible', !hasComponents);
    }
}

/**
 * Load statutory employer contributions for a given country/state.
 * v3.0.54: DEPRECATED - Employer contributions are NOT part of salary structure.
 * They are calculated during payroll processing from country compliance config.
 * This function is now a no-op and will be removed in a future version.
 */
async function loadStatutoryEmployerContributions(countryCode, stateCode) {
    // v3.0.54: No-op - employer contributions are not loaded for salary structures
    // Employer contributions (PF_ER, ESI_ER, GRATUITY, LWF_ER, etc.) are:
    // - NOT auto-attached to salary structures
    // - Calculated during payroll processing from country config
    // - Shown separately in payslip under "Employer Contributions"
    console.log('v3.0.54: loadStatutoryEmployerContributions is deprecated - employer contributions are calculated during payroll, not stored in salary structures');
    statutoryEmployerContributions = [];
}

/**
 * Load CTC cost classifications from the country config.
 * COUNTRY-AGNOSTIC: Returns classification for each charge_code based on the uploaded config.
 * Used to show "Part of CTC" vs "Organizational Overhead" badges on employer contributions.
 * @param {string} countryCode - Country code (e.g., "IN", "US")
 */
async function loadCostClassifications(countryCode) {
    try {
        if (!countryCode) {
            console.log('No country code provided, skipping cost classifications load');
            costClassifications = {};
            return;
        }
        const response = await api.request(`/hrms/statutory/configs/${encodeURIComponent(countryCode)}/cost-classifications`);
        if (response?.success && response?.classifications) {
            // Build a lookup map by charge_code for quick access
            costClassifications = {};
            response.classifications.forEach(c => {
                costClassifications[c.charge_code] = {
                    employee_portion: c.employee_portion,
                    employer_portion: c.employer_portion,
                    charge_name: c.charge_name,
                    comment: c.comment
                };
            });
            console.log(`Loaded cost classifications for ${countryCode}: ${Object.keys(costClassifications).length} charges`);
        } else {
            costClassifications = {};
        }
    } catch (error) {
        console.error('Error loading cost classifications:', error);
        costClassifications = {};
    }
}

/**
 * Get CTC classification badge HTML for an employer contribution.
 * COUNTRY-AGNOSTIC: Only uses data from backend - no hardcoded charge codes.
 * Returns "Part of CTC" (green) or "Org Overhead" (blue) badge based on cost_classification.
 *
 * NOTE: Backend stores charge_code in the statutory_type field when components are
 * auto-created from country config. See BusinessLayer_SalaryStructureVersions.cs:605-606.
 *
 * @param {Object} component - The component to check (statutory_type contains charge_code from backend)
 * @returns {string} HTML string for the badge, or empty string if not applicable
 */
function getCTCClassificationBadge(component) {
    // v3.1.0: Use backend-provided ctc_classification directly
    // No need for separate lookup - backend enriches components with this field
    const ctcClassification = component.ctc_classification;

    if (!ctcClassification) {
        // Fallback to legacy lookup if backend hasn't enriched this component
        const chargeCode = component.statutory_type || '';
        if (chargeCode && Object.keys(costClassifications).length > 0) {
            const classification = costClassifications[chargeCode];
            if (classification?.employer_portion === 'included_in_ctc') {
                return '<span class="ctc-badge ctc-included" title="Included in CTC">Part of CTC</span>';
            } else if (classification?.employer_portion === 'organizational_overhead') {
                return '<span class="ctc-badge ctc-overhead" title="Organizational Overhead - Not part of CTC">Org Overhead</span>';
            }
        }
        return '';
    }

    // v3.1.0: Use backend-provided ctc_classification directly
    if (ctcClassification === 'included_in_ctc') {
        return '<span class="ctc-badge ctc-included" title="Included in CTC">Part of CTC</span>';
    } else if (ctcClassification === 'organizational_overhead') {
        return '<span class="ctc-badge ctc-overhead" title="Organizational Overhead - Not part of CTC">Org Overhead</span>';
    }
    return '';
}

/**
 * Render the statutory employer contributions section in the salary structure modal.
 * v3.0.54: Employer contributions are NOT part of salary structure.
 * They are calculated during payroll processing from country compliance config.
 * This function is now a no-op since the info note is static HTML.
 */
function renderStatutoryEmployerContributionsSection() {
    // v3.0.54: No-op - employer contributions are not part of salary structure
    // The info note explaining this is now static HTML in payroll.html
    // Employer contributions (PF_ER, ESI_ER, GRATUITY, LWF_ER, etc.) are:
    // - NOT auto-attached to salary structures
    // - Calculated during payroll processing from country config
    // - Shown separately in payslip under "Employer Contributions"
    updateStatutoryCountBadge();
}

function updateComponentsTables() {
    const searchTerm = document.getElementById('componentSearch')?.value?.toLowerCase() || '';
    const typeFilter = document.getElementById('componentType')?.value || '';
    const countryFilter = getSelectedCountry();

    const filtered = components.filter(c => {
        const name = c.component_name || c.name || '';
        const code = c.component_code || c.code || '';
        const type = c.component_type || c.category || '';
        const country = c.country_code || '';
        const matchesSearch = name.toLowerCase().includes(searchTerm) ||
                             code.toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || type === typeFilter;
        const matchesCountry = !countryFilter || country === countryFilter;
        return matchesSearch && matchesType && matchesCountry;
    });

    // v3.1.0: Use source and component_type to filter components
    // Statutory Contributions: compliance-created deductions AND employer contributions
    const componentType = (c) => c.component_type || c.category || '';

    const statutory = filtered.filter(c =>
        c.source === 'compliance' &&
        (componentType(c) === 'deduction' || componentType(c) === 'employer_contribution' || componentType(c) === 'benefit')
    );

    // Earnings: ALL earnings including from compliance (like BASIC)
    const earnings = filtered.filter(c => componentType(c) === 'earning');

    // Deductions: User-created deductions only (not from compliance)
    const deductions = filtered.filter(c =>
        componentType(c) === 'deduction' &&
        c.source !== 'compliance'
    );

    // Benefits: kept for backward compatibility but now included in statutory above
    const benefits = [];

    updateEarningsTable(earnings);
    updateDeductionsTable(deductions);
    updateStatutoryContributionsSection(statutory, benefits);
}

/**
 * Check if a component is a statutory component.
 * COUNTRY-AGNOSTIC: Uses backend flags instead of hardcoded component codes.
 *
 * Backend flags:
 * - source === 'compliance': Created from country config
 * - is_immutable === true: Cannot be edited/deleted
 * - statutory_type: Set for statutory components (contains charge_code)
 * - calculation_type === 'compliance_linked': Gets rates from compliance rules
 */
function isStatutoryComponent(component) {
    // Use backend flags - no hardcoded codes
    if (component.source === 'compliance') return true;
    if (component.is_immutable === true) return true;
    if (component.statutory_type && component.statutory_type.length > 0) return true;
    if (component.calculation_type === 'compliance_linked') return true;

    return false;
}

/**
 * Update the Statutory Contributions section with grouped display.
 * v3.1.0: COUNTRY-AGNOSTIC - Uses backend-provided fields directly:
 * - contributor_type: "employee" or "employer" (from backend)
 * - ctc_classification: "included_in_ctc", "organizational_overhead", etc. (from backend)
 * - display_group: "Retirement", "Health Insurance", etc. (from backend)
 *
 * Frontend does NOT pattern-match - just displays what backend sends.
 *
 * IMPORTANT SEPARATION:
 * - Statutory Contributions (Paid to Government): contribution, insurance, tax, levy
 * - Statutory Provisions (Employer Accruals): benefit_accrual (e.g., Gratuity)
 */
function updateStatutoryContributionsSection(statutoryComponents, benefitComponents = []) {
    const contributionsContainer = document.getElementById('statutoryContributionsContainer');
    const provisionsContainer = document.getElementById('statutoryProvisionsContainer');
    const provisionsSection = document.getElementById('statutoryProvisionsSection');
    const allComponents = [...(statutoryComponents || []), ...(benefitComponents || [])];

    // Reset both containers
    if (!allComponents || allComponents.length === 0) {
        contributionsContainer.innerHTML = `
            <div class="empty-state">
                <p>No statutory contributions configured</p>
            </div>
        `;
        if (provisionsSection) provisionsSection.style.display = 'none';
        return;
    }

    // v3.1.0: Use backend-provided display_group for grouping (no pattern matching)
    const contributionGroups = {}; // For government payments (contribution, insurance, tax, levy)
    const provisionGroups = {};    // For employer accruals (benefit_accrual)
    const groupLabels = {}; // Dynamically built from backend display_group

    // Track CTC classification counts for summary
    let ctcIncludedCount = 0;
    let orgOverheadCount = 0;
    let employeeDeductionCount = 0;

    allComponents.forEach(c => {
        // v3.1.0: Use backend-provided fields directly (no pattern matching!)
        const contributorType = c.contributor_type || 'employee';
        const ctcClassification = c.ctc_classification || 'not_applicable';
        const displayGroup = c.display_group || 'Other';

        // Use display_group as the grouping key (backend provides proper label)
        let groupKey = displayGroup;

        // Track CTC classification for summary using backend-provided ctc_classification
        if (contributorType === 'employee') {
            employeeDeductionCount++;
        } else if (contributorType === 'employer') {
            if (ctcClassification === 'included_in_ctc') {
                ctcIncludedCount++;
            } else if (ctcClassification === 'organizational_overhead') {
                orgOverheadCount++;
            }
        }

        // Store the display_group as the label (backend provides proper label)
        if (!groupLabels[groupKey]) {
            groupLabels[groupKey] = displayGroup;
        }

        // v3.1.0: Use display_group to determine target (Gratuity → Provisions)
        // Gratuity, Benefit Accrual → Provisions (paid to employees)
        // Everything else → Contributions (paid to government)
        const isProvision = displayGroup === 'Gratuity' || displayGroup === 'Benefit Accrual';
        const targetGroups = isProvision ? provisionGroups : contributionGroups;

        // Use arrays to collect ALL components (no overwriting!)
        if (!targetGroups[groupKey]) {
            targetGroups[groupKey] = { employee: [], employer: [] };
        }
        targetGroups[groupKey][contributorType].push(c);
    });

    // Helper function to render CTC summary banner
    const renderCTCSummary = () => {
        if (ctcIncludedCount === 0 && orgOverheadCount === 0 && employeeDeductionCount === 0) {
            return '';
        }
        return `
            <div class="ctc-summary-banner">
                <div class="ctc-summary-item included-in-ctc">
                    <span class="ctc-summary-label">Included in CTC</span>
                    <span class="ctc-summary-value">${ctcIncludedCount} employer contribution${ctcIncludedCount !== 1 ? 's' : ''}</span>
                    <span class="ctc-summary-hint">Communicated to employees as part of total compensation</span>
                </div>
                <div class="ctc-summary-item org-overhead">
                    <span class="ctc-summary-label">Organizational Overhead</span>
                    <span class="ctc-summary-value">${orgOverheadCount} employer contribution${orgOverheadCount !== 1 ? 's' : ''}</span>
                    <span class="ctc-summary-hint">Business cost not shown in employee CTC</span>
                </div>
                <div class="ctc-summary-item employee-deductions">
                    <span class="ctc-summary-label">Employee Deductions</span>
                    <span class="ctc-summary-value">${employeeDeductionCount} deduction${employeeDeductionCount !== 1 ? 's' : ''}</span>
                    <span class="ctc-summary-hint">Deducted from employee gross salary</span>
                </div>
            </div>
        `;
    };

    // Helper function to render a group of components
    const renderGroups = (groups) => {
        const defaultIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
        let html = '<div class="statutory-contributions-grid">';

        Object.keys(groups).forEach(groupKey => {
            const group = groups[groupKey];
            const groupName = groupLabels[groupKey] || groupKey;
            const hasEmployee = group.employee && group.employee.length > 0;
            const hasEmployer = group.employer && group.employer.length > 0;

            if (!hasEmployee && !hasEmployer) return;

            html += `
                <div class="statutory-card">
                    <div class="statutory-card-header">
                        <div class="statutory-icon">${defaultIcon}</div>
                        <div class="statutory-title-area">
                            <h4>${escapeHtml(groupName)}</h4>
                        </div>
                    </div>
                    <div class="statutory-breakdown">
            `;

            // Render ALL employee contributions
            if (hasEmployee) {
                group.employee.forEach(emp => {
                    const value = formatStatutoryValue(emp);
                    const status = emp.is_active !== false ? 'Active' : 'Inactive';
                    const statusClass = emp.is_active !== false ? 'active' : 'inactive';
                    const displayName = emp.component_name || emp.name || emp.component_code || emp.code;
                    const code = emp.component_code || emp.code;
                    html += `
                        <div class="contribution-row employee-contribution">
                            <span class="contributor-badge employee">Employee</span>
                            <div class="component-info">
                                <span class="component-name">${escapeHtml(displayName)}</span>
                                <span class="component-code">${code}</span>
                            </div>
                            <div class="ctc-badge-cell"></div>
                            <div class="contribution-details">
                                <span class="contribution-value">${value}</span>
                                <span class="contribution-status ${statusClass}">${status}</span>
                            </div>
                        </div>
                    `;
                });
            }

            // Render ALL employer contributions with CTC classification badges
            if (hasEmployer) {
                group.employer.forEach(er => {
                    const value = formatStatutoryValue(er);
                    const status = er.is_active !== false ? 'Active' : 'Inactive';
                    const statusClass = er.is_active !== false ? 'active' : 'inactive';
                    const displayName = er.component_name || er.name || er.component_code || er.code;
                    const code = er.component_code || er.code;
                    const ctcBadge = getCTCClassificationBadge(er);
                    html += `
                        <div class="contribution-row employer-contribution">
                            <span class="contributor-badge employer">Employer</span>
                            <div class="component-info">
                                <span class="component-name">${escapeHtml(displayName)}</span>
                                <span class="component-code">${code}</span>
                            </div>
                            <div class="ctc-badge-cell">${ctcBadge}</div>
                            <div class="contribution-details">
                                <span class="contribution-value">${value}</span>
                                <span class="contribution-status ${statusClass}">${status}</span>
                            </div>
                        </div>
                    `;
                });
            }

            html += `
                    </div>
                </div>
            `;
        });

        html += '</div>';
        return html;
    };

    // Render Statutory Contributions (Paid to Government)
    const hasContributions = Object.keys(contributionGroups).length > 0;
    if (hasContributions) {
        contributionsContainer.innerHTML = renderCTCSummary() + renderGroups(contributionGroups);
    } else {
        contributionsContainer.innerHTML = `
            <div class="empty-state">
                <p>No statutory contributions configured</p>
            </div>
        `;
    }

    // Render Statutory Provisions (Employer Accruals) - only show if there are provisions
    const hasProvisions = Object.keys(provisionGroups).length > 0;
    if (provisionsSection) {
        if (hasProvisions) {
            provisionsSection.style.display = 'block';
            provisionsContainer.innerHTML = renderGroups(provisionGroups);
        } else {
            provisionsSection.style.display = 'none';
        }
    }
}

/**
 * Format statutory component value for display
 * v3.0.26: Country-agnostic - uses getSelectedCurrency() for symbol
 */
function formatStatutoryValue(component) {
    const calcType = (component.calculation_type || 'fixed').toLowerCase();

    if (calcType === 'compliance_linked') {
        return '<span class="compliance-tag">From Compliance Rules</span>';
    } else if (calcType === 'percentage') {
        const pct = component.percentage || component.percentage_of_basic || 0;
        const base = component.calculation_base || 'basic';
        return `${pct}% of ${base.toUpperCase()}`;
    } else if (calcType === 'fixed') {
        const amt = component.fixed_amount || component.default_value || 0;
        if (amt) {
            const { symbol } = getSelectedCurrency();
            return `${symbol}${Number(amt).toLocaleString('en-IN')}`;
        }
        return 'Per structure';
    }
    return '-';
}

/**
 * Format component value based on calculation type
 * v3.0.26: Country-agnostic - uses getSelectedCurrency() for symbol
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
            const { symbol } = getSelectedCurrency();
            return `${symbol}${Number(value).toLocaleString('en-IN')}`;
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
    } else if (calcType === 'compliance_linked') {
        // Compliance-linked components get their rates from statutory compliance rules at runtime
        const statutoryType = component.statutory_type || '';
        const typeLabel = formatStatutoryType(statutoryType, component.component_name);
        return `<span class="text-muted compliance-linked-value" title="Rate from ${typeLabel} compliance rules">From compliance rules</span>`;
    } else {
        const value = component.default_value || component.fixed_amount || component.percentage || 0;
        return value ? value.toString() : '-';
    }
}

/**
 * Format statutory type for display.
 * COUNTRY-AGNOSTIC: No hardcoded mappings - just display what backend sends.
 * The backend sends component_name from country config which contains proper labels.
 */
function formatStatutoryType(statutoryType, componentName) {
    // Prefer component_name from backend (contains proper label from country config)
    if (componentName) return componentName;
    // Fallback to statutory_type or generic label
    return statutoryType || 'Statutory';
}

/**
 * Check if a component is immutable (compliance-linked)
 */
function isImmutableComponent(component) {
    return component.is_immutable || component.source === 'compliance';
}

function updateEarningsTable(earnings) {
    const tbody = document.getElementById('earningsTable');

    if (!earnings || earnings.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><p>No earnings components</p></td></tr>';
        return;
    }

    tbody.innerHTML = earnings.map(c => {
        // Build badges for special component types
        let badges = '';
        if (c.is_basic_component) {
            badges += '<span class="component-badge basic-badge">Basic</span>';
        }
        if (c.is_balance_component) {
            badges += '<span class="component-badge balance-badge">Auto-Balance</span>';
        }
        // Check for immutable/statutory compliance components
        const isImmutable = isImmutableComponent(c);
        if (isImmutable) {
            const statutoryLabel = formatStatutoryType(c.statutory_type, c.component_name || c.name);
            badges += `<span class="component-badge statutory-badge" title="Linked to ${statutoryLabel} compliance rules">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                Statutory
            </span>`;
        }

        // Determine if actions should be disabled
        const isSystemManaged = c.is_balance_component || isImmutable;

        return `
        <tr class="${isImmutable ? 'immutable-row' : ''}">
            <td>
                <strong>${escapeHtml(c.component_name || c.name)}</strong>
                ${badges}
            </td>
            <td><code>${escapeHtml(c.component_code || c.code)}</code></td>
            <td>${escapeHtml(c.calculation_type || c.calculationType || 'Fixed')}</td>
            <td>${c.is_balance_component ? '<em>Auto-calculated</em>' : formatComponentValue(c)}</td>
            <td>${(c.is_taxable !== undefined ? c.is_taxable : c.isTaxable) ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'active' : 'inactive'}">${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'Active' : 'Inactive'}</span></td>
            <td>
                ${!isSystemManaged ? `
                <div class="action-buttons">
                    <button class="action-btn" onclick="editComponent('${c.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteComponent('${c.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </div>
                ` : `<span class="text-muted locked-indicator" title="${isImmutable ? 'Statutory component - managed via Compliance settings' : 'System managed component'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    ${isImmutable ? 'Compliance linked' : 'System managed'}
                </span>`}
            </td>
        </tr>
    `;}).join('');
}

function updateDeductionsTable(deductions) {
    const tbody = document.getElementById('deductionsTable');

    if (!deductions || deductions.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><p>No deduction components</p></td></tr>';
        return;
    }

    tbody.innerHTML = deductions.map(c => {
        // Check for immutable/statutory compliance components
        const isImmutable = isImmutableComponent(c);
        let badges = '';
        if (isImmutable) {
            const statutoryLabel = formatStatutoryType(c.statutory_type, c.component_name || c.name);
            badges = `<span class="component-badge statutory-badge" title="Linked to ${statutoryLabel} compliance rules">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                Statutory
            </span>`;
        }

        return `
        <tr class="${isImmutable ? 'immutable-row' : ''}">
            <td>
                <strong>${escapeHtml(c.component_name || c.name)}</strong>
                ${badges}
            </td>
            <td><code>${escapeHtml(c.component_code || c.code)}</code></td>
            <td>${escapeHtml(c.calculation_type || c.calculationType || 'Fixed')}</td>
            <td>${formatComponentValue(c)}</td>
            <td>${(c.is_pre_tax !== undefined ? c.is_pre_tax : c.isPreTax) ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'active' : 'inactive'}">${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'Active' : 'Inactive'}</span></td>
            <td>
                ${!isImmutable ? `
                <div class="action-buttons">
                    <button class="action-btn" onclick="editComponent('${c.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteComponent('${c.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </div>
                ` : `<span class="text-muted locked-indicator" title="Statutory component - managed via Compliance settings">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    Compliance linked
                </span>`}
            </td>
        </tr>
    `;}).join('');
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
        let loans = response || [];

        // v3.0.31: Filter by office if selected
        const officeFilter = document.getElementById('loanOfficeFilter')?.value;
        if (officeFilter) {
            loans = loans.filter(loan => loan.office_id === officeFilter);
        }

        allLoansData = loans;

        // Use pagination if available
        if (typeof createTablePagination !== 'undefined') {
            loansPagination = createTablePagination('loansPagination', {
                containerSelector: '#loansPagination',
                data: loans,
                rowsPerPage: 25,
                rowsPerPageOptions: [10, 25, 50, 100],
                onPageChange: (paginatedData, pageInfo) => {
                    updateLoansTable(paginatedData);
                }
            });
        } else {
            updateLoansTable(loans);
        }
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

        // v3.0.30: Determine if loan is editable (no EMIs deducted yet)
        const isEditable = loan.emis_paid === 0 && ['pending', 'approved', 'active'].includes(status);

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

        // v3.0.30: Add Edit/Cancel buttons for editable loans
        if (isAdmin && isEditable) {
            actionButtons += `
                <button class="action-btn" onclick="showEditLoanModal('${loan.id}')" title="Edit Loan">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="action-btn danger" onclick="confirmCancelLoan('${loan.id}')" title="Cancel Loan">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
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
                <td>${formatCurrency(loan.principal_amount, null, loan.currency_symbol)}</td>
                <td>${formatCurrency(loan.emi_amount, null, loan.currency_symbol)}</td>
                <td>${formatCurrency(loan.outstanding_amount, null, loan.currency_symbol)}</td>
                <td>${formatDate(loan.start_date)}</td>
                <td>
                    <span class="status-badge status-${status}">${loan.status}</span>
                    ${loan.emis_paid > 0 ? '<span class="status-badge status-secondary" style="margin-left:4px;" title="Loan is locked after EMI deduction">Locked</span>' : ''}
                </td>
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
        // Store ALL offices for country filtering
        allOffices = response || [];
        // Initially set offices to all (will be filtered when country is selected)
        offices = [...allOffices];

        console.log('[PayrollOffices] Loaded', allOffices.length, 'offices');

        // Initial population - will be re-filtered when country filter changes
        // Use HrmsOfficeSelection to get persisted or first office
        const selectedOfficeId = HrmsOfficeSelection.initializeSelection(offices);

        // Filter dropdowns - WITH "All Offices" as first option and default
        const filterSelects = ['runOffice', 'structureOfficeFilter', 'draftOffice', 'allPayslipsOffice'];
        filterSelects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                const options = [
                    { value: '', label: 'All Offices' },
                    ...offices.map(o => ({
                        value: o.id,
                        label: `${o.office_name} (${o.office_code || o.country_code || ''})`
                    }))
                ];
                select.innerHTML = options.map(opt =>
                    `<option value="${opt.value}"${opt.value === '' ? ' selected' : ''}>${opt.label}</option>`
                ).join('');

                // Update SearchableDropdown instance if exists - default to "All Offices"
                const dropdown = searchableDropdownInstances.get(id);
                if (dropdown) {
                    dropdown.setOptions(options);
                    dropdown.setValue(''); // Default to "All Offices"
                }
            }
        });

        // Filter dropdowns WITH "All Offices" as first option and default
        const officeFilterIds = ['loanOfficeFilter', 'vdOfficeFilter', 'adjustmentOfficeFilter', 'arrearsOfficeFilter'];
        officeFilterIds.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                // Build options WITH "All Offices" as first option
                const officeOptions = [
                    { value: '', label: 'All Offices' },
                    ...offices.map(o => ({
                        value: o.id,
                        label: `${o.office_name} (${o.office_code || o.country_code || ''})`
                    }))
                ];
                select.innerHTML = officeOptions.map(opt =>
                    `<option value="${opt.value}"${opt.value === '' ? ' selected' : ''}>${opt.label}</option>`
                ).join('');

                // Update SearchableDropdown instance if exists - default to "All Offices"
                const dropdown = searchableDropdownInstances.get(id);
                if (dropdown) {
                    dropdown.setOptions(officeOptions);
                    dropdown.setValue(''); // Default to "All Offices"
                } else if (select) {
                    select.value = ''; // Default to "All Offices"
                }
            }
        });

        // Form dropdowns - Keep "Select Office" placeholder
        const formSelects = [
            { id: 'payrollOffice', placeholder: 'Select Office' },
            { id: 'structureOffice', placeholder: 'Select Office (Required)' },
            { id: 'draftPayrollOffice', placeholder: 'Select Office' }
        ];
        formSelects.forEach(config => {
            const select = document.getElementById(config.id);
            if (select) {
                const options = HrmsOfficeSelection.buildOfficeOptions(offices, { isFormDropdown: true });
                // Replace first option label with custom placeholder
                if (options.length > 0 && options[0].value === '') {
                    options[0].label = config.placeholder;
                }
                select.innerHTML = options.map(opt =>
                    `<option value="${opt.value}">${opt.label}</option>`
                ).join('');
            }
        });

        // Setup change handlers for filter dropdowns to persist selection
        setupPayrollOfficeChangeHandlers();
    } catch (error) {
        console.error('Error loading offices:', error);
    }
}

/**
 * Setup change handlers for office filter dropdowns in payroll
 */
function setupPayrollOfficeChangeHandlers() {
    const filterSelects = ['runOffice', 'structureOfficeFilter', 'draftOffice', 'allPayslipsOffice'];
    filterSelects.forEach(id => {
        const select = document.getElementById(id);
        if (select && !select.dataset.hrmsOfficeHandler) {
            select.dataset.hrmsOfficeHandler = 'true'; // Mark to avoid duplicate handlers
            select.addEventListener('change', function() {
                HrmsOfficeSelection.setSelectedOfficeId(this.value);
            });
        }
    });
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

async function showCreateStructureModal() {
    document.getElementById('structureForm').reset();
    document.getElementById('structureId').value = '';
    document.getElementById('structureModalTitle').textContent = 'Create Salary Structure';
    document.getElementById('structureComponents').innerHTML = '';
    structureComponentCounter = 0; // Reset counter

    // RE-ENABLE code field (it may have been disabled during edit mode)
    const codeInput = document.getElementById('structureCode');
    if (codeInput) {
        codeInput.readOnly = false;
        codeInput.classList.remove('readonly-field');
        codeInput.title = '';
    }

    // Reset office dropdown and RE-ENABLE it (disabled during edit mode)
    const officeSelect = document.getElementById('structureOffice');
    if (officeSelect) {
        officeSelect.value = '';
        officeSelect.disabled = false; // Re-enable for new structure creation
    }
    // Also reset the searchable dropdown display text (it's a custom component on top of the native select)
    const officeDropdown = getSearchableDropdown('structureOffice');
    if (officeDropdown) {
        // Use setValue('') to select the placeholder option (first option with value '')
        // The SearchableDropdown class doesn't have a reset() method, so use setValue instead
        if (typeof officeDropdown.setValue === 'function') {
            officeDropdown.setValue(''); // Selects "Select Office (Required)" placeholder
        }
        // Re-enable the dropdown (it may have been disabled during edit mode)
        if (typeof officeDropdown.setDisabled === 'function') {
            officeDropdown.setDisabled(false);
        }
    }
    // Reset is_default dropdown to "No"
    const isDefaultDropdown = getSearchableDropdown('structureIsDefault');
    if (isDefaultDropdown && typeof isDefaultDropdown.setValue === 'function') {
        isDefaultDropdown.setValue('false');
    }
    // Set default effective date to 1st of current month (avoids proration issues)
    const effectiveFromInput = document.getElementById('structureEffectiveFrom');
    if (effectiveFromInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        effectiveFromInput.value = `${year}-${month}-01`;
    }
    // Reset is_default select
    const isDefaultSelect = document.getElementById('structureIsDefault');
    if (isDefaultSelect) isDefaultSelect.value = 'false';
    // Reset status to active for new structures
    const isActiveCheckbox = document.getElementById('structureIsActive');
    if (isActiveCheckbox) isActiveCheckbox.checked = true;

    // Reset to Components tab
    switchStructureTab('components');

    // Don't load statutory deductions/contributions yet - wait for office selection
    // This will show "Select an office to see applicable statutory deductions/contributions"
    statutoryEmployeeDeductions = [];
    statutoryEmployerContributions = [];
    selectableComponentsForCountry = []; // Clear components from previous office's country
    renderStatutoryDeductionsSection();
    renderStatutoryEmployerContributionsSection();

    // Disable Add Component button until office is selected (country-agnostic validation)
    const addComponentBtn = document.getElementById('btnAddStructureComponent');
    if (addComponentBtn) {
        addComponentBtn.disabled = true;
        addComponentBtn.title = 'Select an office first to add components';
    }

    // Show empty state for components
    updateComponentsEmptyState();

    document.getElementById('structureModal').classList.add('active');
}

/**
 * Handle office selection change in the salary structure modal.
 * When an office is selected, load the applicable statutory deductions and employer contributions
 * based on the office's country and state codes.
 * Also refreshes component dropdowns to show only components for the selected country.
 */
async function onStructureOfficeChange() {
    const officeId = document.getElementById('structureOffice')?.value;
    const addComponentBtn = document.getElementById('btnAddStructureComponent');

    if (!officeId) {
        // No office selected - disable Add Component button and clear statutory data
        if (addComponentBtn) {
            addComponentBtn.disabled = true;
            addComponentBtn.title = 'Select an office first to add components';
        }
        statutoryEmployeeDeductions = [];
        statutoryEmployerContributions = [];
        renderStatutoryDeductionsSection();
        renderStatutoryEmployerContributionsSection();
        // Refresh component dropdowns (will show empty since no office selected)
        refreshAllComponentDropdowns();
        return;
    }

    // Office selected - enable Add Component button
    if (addComponentBtn) {
        addComponentBtn.disabled = false;
        addComponentBtn.title = 'Add a salary component';
    }

    // Find the office in the offices array
    const selectedOffice = offices.find(o => o.id === officeId);
    if (!selectedOffice) {
        console.warn('Selected office not found in offices array:', officeId);
        statutoryEmployeeDeductions = [];
        statutoryEmployerContributions = [];
        renderStatutoryDeductionsSection();
        renderStatutoryEmployerContributionsSection();
        refreshAllComponentDropdowns();
        return;
    }

    const countryCode = selectedOffice.country_code;
    const stateCode = selectedOffice.state_code || 'ALL';

    console.log(`Office changed: ${selectedOffice.office_name} (${countryCode}/${stateCode})`);

    // Load both statutory employee deductions and employer contributions in parallel
    await Promise.all([
        loadStatutoryEmployeeDeductions(countryCode, stateCode),
        loadStatutoryEmployerContributions(countryCode, stateCode)
    ]);
    renderStatutoryDeductionsSection();
    renderStatutoryEmployerContributionsSection();

    // CRITICAL: Load selectable components from backend for this country
    // This ensures BASIC and other components are filtered by country at the backend level
    await loadSelectableComponentsForCountry(countryCode);

    // Refresh component dropdowns with the newly loaded country-filtered components
    refreshAllComponentDropdowns();
}

/**
 * Load selectable components from backend filtered by country code.
 * COUNTRY-AGNOSTIC: Backend returns only BASIC + user-created components for the specified country.
 * @param {string} countryCode - Country code (e.g., "IN", "ID", "MV")
 */
async function loadSelectableComponentsForCountry(countryCode) {
    try {
        if (!countryCode) {
            console.log('No country code provided, clearing selectable components');
            selectableComponentsForCountry = [];
            return;
        }

        const response = await api.request(`/hrms/payroll/components/selectable?countryCode=${encodeURIComponent(countryCode)}`);
        selectableComponentsForCountry = response?.components || [];
        console.log(`Loaded ${selectableComponentsForCountry.length} selectable components for country ${countryCode}`);
    } catch (error) {
        console.error('Error loading selectable components for country:', error);
        selectableComponentsForCountry = [];
    }
}

/**
 * Refresh all component dropdowns in the salary structure modal.
 * Called when office selection changes to update the component list for the new country.
 * Uses the backend-loaded selectableComponentsForCountry array.
 */
function refreshAllComponentDropdowns() {
    const dropdowns = document.querySelectorAll('.searchable-dropdown');
    // Use backend-loaded components instead of client-side filtering
    const selectableComponents = selectableComponentsForCountry;

    dropdowns.forEach(dropdown => {
        const optionsContainer = dropdown.querySelector('.dropdown-options');
        if (!optionsContainer) return;

        const componentId = optionsContainer.dataset.componentId;

        // Regenerate options HTML with country-filtered components from backend
        optionsContainer.innerHTML = selectableComponents.map(c => `
            <div class="dropdown-option"
                 data-value="${c.id}"
                 data-type="${c.component_type || c.category}"
                 data-calc-type="${c.calculation_type || 'fixed'}"
                 data-calc-base="${c.calculation_base || 'basic'}"
                 data-is-basic="${c.is_basic_component || false}"
                 data-is-balance="${c.is_balance_component || false}"
                 data-percentage="${c.percentage || c.default_percentage || ''}"
                 data-fixed="${c.fixed_amount || ''}"
                 data-name="${escapeHtml(c.component_name || c.name)}"
                 data-code="${escapeHtml(c.component_code || c.code)}"
                 onclick="selectDropdownOption('${dropdown.id}', this, '${componentId}')">
                <span class="option-name">${escapeHtml(c.component_name || c.name)}</span>
                <span class="option-code">${escapeHtml(c.component_code || c.code)}</span>
                <span class="option-type badge badge-${(c.component_type || c.category) === 'earning' ? 'success' : 'warning'}">${c.component_type || c.category}</span>
            </div>
        `).join('');

        // Clear any current selection if the selected component is no longer in the filtered list
        const selectedText = dropdown.querySelector('.dropdown-selected-text');
        if (selectedText && selectedText.textContent !== 'Select Component') {
            const selectedCode = selectedText.dataset.selectedCode;
            const stillExists = selectableComponents.some(c => c.component_code === selectedCode);
            if (!stillExists) {
                selectedText.textContent = 'Select Component';
                selectedText.removeAttribute('data-selected-code');
                // Clear hidden input if exists
                const hiddenInput = dropdown.querySelector('input[type="hidden"]');
                if (hiddenInput) hiddenInput.value = '';
            }
        }
    });

    console.log(`Refreshed ${dropdowns.length} component dropdowns with ${selectableComponents.length} backend-filtered components`);
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

        // DISABLE code field when editing (code is a key and cannot be changed after creation)
        const codeInput = document.getElementById('structureCode');
        if (codeInput) {
            codeInput.readOnly = true;
            codeInput.classList.add('readonly-field');
            codeInput.title = 'Structure code cannot be changed after creation';
        }

        // Set office dropdown and DISABLE it when editing (office cannot be changed after creation)
        const officeSelect = document.getElementById('structureOffice');
        if (officeSelect && structure.office_id) {
            officeSelect.value = structure.office_id;
            officeSelect.disabled = true; // Cannot change office when editing
        }

        // Also disable the searchable dropdown visual wrapper
        const officeDropdown = getSearchableDropdown('structureOffice');
        if (officeDropdown) {
            officeDropdown.setValue(structure.office_id); // Update visual display
            officeDropdown.setDisabled(true); // Disable the dropdown
        }

        // Enable Add Component button since office is already selected when editing
        const addComponentBtn = document.getElementById('btnAddStructureComponent');
        if (addComponentBtn) {
            addComponentBtn.disabled = false;
            addComponentBtn.title = 'Add a salary component';
        }

        // Load selectable components for this office's country BEFORE populating components
        // This ensures the dropdown options are available when we populate
        const officeForComponents = offices.find(o => o.id === structure.office_id);
        if (officeForComponents && officeForComponents.country_code) {
            await loadSelectableComponentsForCountry(officeForComponents.country_code);
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

        // Load and populate structure components (excluding statutory/auto-attached)
        if (structure.components && structure.components.length > 0) {
            // Filter to show only EDITABLE components
            // An editable component is one that exists in selectableComponentsForCountry
            // Statutory deductions/contributions and balance components are NOT in the selectable list
            const selectableIds = new Set((selectableComponentsForCountry || []).map(c => c.id));

            const editableComponents = structure.components.filter(c => {
                // Only show components that are in the selectable list
                // This automatically excludes statutory deductions, employer contributions, and balance components
                return selectableIds.has(c.component_id);
            });
            populateStructureComponents(editableComponents);
        } else {
            document.getElementById('structureComponents').innerHTML = '';
            structureComponentCounter = 0;
        }

        // Load and display both statutory employee deductions and employer contributions based on office's country/state
        const officeForStatutory = offices.find(o => o.id === structure.office_id);
        if (officeForStatutory) {
            const countryCode = officeForStatutory.country_code;
            const stateCode = officeForStatutory.state_code || 'ALL';
            await Promise.all([
                loadStatutoryEmployeeDeductions(countryCode, stateCode),
                loadStatutoryEmployerContributions(countryCode, stateCode)
            ]);
        } else {
            statutoryEmployeeDeductions = [];
            statutoryEmployerContributions = [];
        }
        renderStatutoryDeductionsSection();
        renderStatutoryEmployerContributionsSection();

        // Reset to Components tab
        switchStructureTab('components');

        // Update empty state
        updateComponentsEmptyState();

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

    // Check for duplicate components
    const componentIds = structureComponents.map(c => c.component_id);
    const uniqueIds = new Set(componentIds);
    if (componentIds.length !== uniqueIds.size) {
        showToast('Cannot save: Same component is selected multiple times. Please remove duplicates.', 'error');
        return;
    }

    // Check for multiple "is_basic" components
    const basicComponentsInStructure = [];
    const container = document.getElementById('structureComponents');
    const rows = container.querySelectorAll('.structure-component-row');
    rows.forEach(row => {
        const hiddenInput = row.querySelector('.component-select-value');
        if (hiddenInput && hiddenInput.value) {
            // Get the selected option from the searchable dropdown
            const dropdown = row.querySelector('.searchable-dropdown');
            const selectedOption = dropdown?.querySelector(`.dropdown-option[data-value="${hiddenInput.value}"]`);
            const isBasic = selectedOption?.getAttribute('data-is-basic') === 'true';
            if (isBasic) {
                basicComponentsInStructure.push(selectedOption?.getAttribute('data-name') || 'Unknown');
            }
        }
    });

    if (basicComponentsInStructure.length > 1) {
        showToast(`Cannot save: Multiple components marked as "Basic" (${basicComponentsInStructure.join(', ')}). Only ONE Basic component should be in a structure.`, 'error');
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
            // Include effective_from date for new structures
            const effectiveFromInput = document.getElementById('structureEffectiveFrom');
            if (effectiveFromInput && effectiveFromInput.value) {
                data.effective_from = effectiveFromInput.value;
            }
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

// Country dropdown instances (one per tab)
const countryDropdownInstances = new Map();

// List of all country filter container IDs
const COUNTRY_FILTER_CONTAINERS = [
    'countryFilterContainer',           // Salary Components tab
    'structureCountryFilterContainer',  // Salary Structures tab
    'draftCountryFilterContainer',      // Payroll Drafts tab
    'runCountryFilterContainer',        // Payroll Runs tab
    'empSalaryCountryFilterContainer',  // Employee Salaries tab
    'loanCountryFilterContainer',       // Loans tab
    'vdCountryFilterContainer',         // Voluntary Deductions tab
    'allPayslipsCountryFilterContainer', // All Payslips tab
    'adjustmentCountryFilterContainer', // Adjustments tab
    'arrearsCountryFilterContainer',    // Arrears tab
    'taxConfigCountryFilterContainer',  // Tax Configuration tab
    'sfCountryFilterContainer'          // Statutory Filing tab
];

// Load countries and initialize ALL country filter dropdowns across tabs
// COUNTRY-AGNOSTIC: A specific country MUST be selected first
async function loadCountryFilter() {
    try {
        const response = await api.request('/hrms/countries');
        const countries = Array.isArray(response) ? response : (response.countries || []);

        // Store countries globally for currency lookups across all tabs
        window.loadedCountries = countries;
        loadedCountriesList = countries;

        // Build options for SearchableDropdown
        const countryOptions = countries.length === 0
            ? [{ value: '', label: 'No countries configured', disabled: true }]
            : countries.map(c => ({
                value: c.country_code,
                label: `${c.country_name} (${c.country_code})`,
                description: c.currency_code || ''
            }));

        const defaultCountry = countries.length > 0 ? countries[0].country_code : null;

        // Initialize SearchableDropdown for EACH country filter container
        COUNTRY_FILTER_CONTAINERS.forEach(containerId => {
            const container = document.getElementById(containerId);
            if (container) {
                // Destroy existing instance if any
                const existingInstance = countryDropdownInstances.get(containerId);
                if (existingInstance && typeof existingInstance.destroy === 'function') {
                    existingInstance.destroy();
                }

                // Create new SearchableDropdown
                const dropdown = new SearchableDropdown(container, {
                    id: `${containerId}-dropdown`,
                    options: countryOptions,
                    placeholder: 'Select Country',
                    searchPlaceholder: 'Search countries...',
                    value: defaultCountry,
                    compact: true,
                    onChange: async (value, option) => {
                        // Sync all other country dropdowns to the same value
                        syncCountryDropdowns(containerId, value);
                        selectedGlobalCountry = value;
                        await onGlobalCountryChange();
                    }
                });

                countryDropdownInstances.set(containerId, dropdown);
            }
        });

        // Auto-select first country if any exist
        if (countries.length > 0) {
            selectedGlobalCountry = countries[0].country_code;
            // Trigger change event to filter offices and load data
            await onGlobalCountryChange();
        }

        console.log('[PayrollCountryFilter] Initialized', countryDropdownInstances.size, 'country dropdowns');
        return countries;
    } catch (error) {
        console.error('Error loading countries:', error);
        return [];
    }
}

// Sync all country dropdowns when one changes
function syncCountryDropdowns(sourceContainerId, newValue) {
    countryDropdownInstances.forEach((dropdown, containerId) => {
        if (containerId !== sourceContainerId && dropdown && typeof dropdown.setValue === 'function') {
            dropdown.setValue(newValue);
        }
    });
}

// Get selected country from any initialized country filter
function getSelectedCountry() {
    // Use the stored value (updated by onChange callback)
    return selectedGlobalCountry || '';
}

// Handle GLOBAL country filter change - filters ALL office dropdowns across all tabs
async function onGlobalCountryChange() {
    const countryCode = getSelectedCountry();
    selectedGlobalCountry = countryCode;

    console.log('[PayrollCountryFilter] Country changed to:', countryCode);

    // Filter offices by selected country
    filterOfficesByCountry(countryCode);

    // Load cost classifications for the selected country (for CTC badges)
    if (countryCode) {
        await loadCostClassifications(countryCode);
    } else {
        costClassifications = {};
    }

    // Refresh components table (filters by country)
    updateComponentsTables();

    // Refresh salary structures list (now filtered by country via offices)
    if (typeof loadSalaryStructures === 'function') {
        loadSalaryStructures();
    }

    // Refresh statutory filing available reports (country-specific)
    // COUNTRY-AGNOSTIC: Reload reports when country changes
    if (typeof loadAvailableReports === 'function') {
        loadAvailableReports();
    }
}

// Filter all office dropdowns by selected country
function filterOfficesByCountry(countryCode) {
    // Filter offices based on country
    if (countryCode && allOffices.length > 0) {
        offices = allOffices.filter(o => o.country_code === countryCode);
    } else {
        offices = [...allOffices];
    }

    console.log('[PayrollCountryFilter] Filtered offices:', offices.length, 'of', allOffices.length, 'for country:', countryCode);

    // Get persisted office ID (if still valid after filtering)
    const persistedOfficeId = HrmsOfficeSelection.getSelectedOfficeId();
    const persistedOfficeStillValid = offices.some(o => o.id === persistedOfficeId);
    const selectedOfficeId = persistedOfficeStillValid ? persistedOfficeId : (offices.length > 0 ? offices[0].id : '');

    // Update all filter dropdowns (with "All Offices" as first option and default)
    const filterSelects = ['runOffice', 'structureOfficeFilter', 'draftOffice', 'allPayslipsOffice'];
    filterSelects.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            const options = [
                { value: '', label: 'All Offices' },
                ...offices.map(o => ({
                    value: o.id,
                    label: `${o.office_name} (${o.office_code || o.country_code || ''})`
                }))
            ];
            select.innerHTML = options.map(opt =>
                `<option value="${opt.value}"${opt.value === '' ? ' selected' : ''}>${opt.label}</option>`
            ).join('');

            // Update SearchableDropdown instance if exists - default to "All Offices"
            const dropdown = searchableDropdownInstances.get(id);
            if (dropdown) {
                dropdown.setOptions(options);
                dropdown.setValue(''); // Default to "All Offices"
            }
        }
    });

    // Update employee/loan/adjustment filter dropdowns (with "All Offices" as first option and default)
    const employeeFilterIds = ['loanOfficeFilter', 'vdOfficeFilter', 'adjustmentOfficeFilter', 'arrearsOfficeFilter', 'empSalaryOfficeFilter'];
    employeeFilterIds.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            const officeOptions = [
                { value: '', label: 'All Offices' },
                ...offices.map(o => ({
                    value: o.id,
                    label: `${o.office_name} (${o.office_code || o.country_code || ''})`
                }))
            ];
            select.innerHTML = officeOptions.map(opt =>
                `<option value="${opt.value}"${opt.value === '' ? ' selected' : ''}>${opt.label}</option>`
            ).join('');

            // Update SearchableDropdown instance if exists - default to "All Offices"
            const dropdown = searchableDropdownInstances.get(id);
            if (dropdown) {
                dropdown.setOptions(officeOptions);
                dropdown.setValue(''); // Default to "All Offices"
            } else if (select) {
                select.value = ''; // Default to "All Offices"
            }
        }
    });

    // Update form dropdowns (with "Select Office" placeholder)
    const formSelects = [
        { id: 'payrollOffice', placeholder: 'Select Office' },
        { id: 'structureOffice', placeholder: 'Select Office (Required)' },
        { id: 'draftPayrollOffice', placeholder: 'Select Office' }
    ];
    formSelects.forEach(config => {
        const select = document.getElementById(config.id);
        if (select) {
            const options = [
                { value: '', label: config.placeholder },
                ...offices.map(o => ({
                    value: o.id,
                    label: `${o.office_name} (${o.office_code || o.country_code || ''})`
                }))
            ];
            select.innerHTML = options.map(opt =>
                `<option value="${opt.value}">${opt.label}</option>`
            ).join('');

            // Update PayrollSearchableDropdown instance if exists (used for structureOffice)
            const dropdown = payrollSearchableDropdowns.get(config.id);
            if (dropdown) {
                dropdown.setOptions(options);
                dropdown.reset(); // Reset to placeholder
            }
        }
    });

    // Persist the selected office if valid
    if (selectedOfficeId) {
        HrmsOfficeSelection.setSelectedOfficeId(selectedOfficeId);
    }
}

function showCreateComponentModal() {
    // Check if a country is selected in the global filter
    const selectedCountry = getSelectedCountry();
    if (!selectedCountry) {
        showToast('Please select a country from the filter first', 'warning');
        return;
    }

    document.getElementById('componentForm').reset();
    document.getElementById('componentId').value = '';
    document.getElementById('componentModalTitle').textContent = 'Create Salary Component';

    // Explicitly reset all form fields to defaults
    document.getElementById('componentName').value = '';
    document.getElementById('componentCode').value = '';
    document.getElementById('componentCategory').value = 'earning';
    document.getElementById('calculationType').value = 'fixed';
    document.getElementById('componentPercentage').value = '';
    document.getElementById('calculationBase').value = 'basic';
    document.getElementById('isTaxable').value = 'true';
    document.getElementById('componentDescription').value = '';
    const fixedAmountInput = document.getElementById('componentFixedAmount');
    if (fixedAmountInput) fixedAmountInput.value = '';

    // Reset status to active for new components
    const isActiveCheckbox = document.getElementById('componentIsActive');
    if (isActiveCheckbox) isActiveCheckbox.checked = true;

    document.getElementById('componentModal').classList.add('active');
    // Reset percentage fields visibility based on calculation type
    togglePercentageFields();
}

// Toggle percentage/fixed amount fields visibility based on calculation type
function togglePercentageFields() {
    const calcType = document.getElementById('calculationType').value;
    const percentageRow = document.getElementById('percentageFieldsRow');
    const percentageInput = document.getElementById('componentPercentage');
    const fixedAmountRow = document.getElementById('fixedAmountFieldsRow');
    const fixedAmountInput = document.getElementById('componentFixedAmount');

    if (calcType === 'percentage') {
        percentageRow.style.display = 'flex';
        percentageInput.required = true;
        if (fixedAmountRow) fixedAmountRow.style.display = 'none';
        if (fixedAmountInput) fixedAmountInput.value = '';
    } else {
        percentageRow.style.display = 'none';
        percentageInput.required = false;
        percentageInput.value = '';
        if (fixedAmountRow) fixedAmountRow.style.display = 'flex';
    }
}

// Note: Balance component toggle removed - balance is now automatic and implicit in every salary structure
// Note: Gross/CTC fields removed - custom earnings are always part of both, deductions don't use these

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

// Check if component code is reserved (used by compliance components)
function isReservedComponentCode(code) {
    const upperCode = code.toUpperCase();
    // Get codes from compliance components (source='compliance' or is_immutable=true)
    const reservedCodes = components
        .filter(c => c.source === 'compliance' || c.is_immutable === true)
        .map(c => (c.component_code || c.code || '').toUpperCase());
    return reservedCodes.includes(upperCode);
}

// Submit functions
async function saveComponent() {
    const form = document.getElementById('componentForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    // Frontend validation: Check for reserved codes
    const componentCode = document.getElementById('componentCode').value.toUpperCase();
    const componentId = document.getElementById('componentId').value;

    // Only check for new components or if code is being changed
    if (!componentId && isReservedComponentCode(componentCode)) {
        showToast(`Component code '${componentCode}' is reserved for statutory components. Please use a different code.`, 'error');
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('componentId').value;
        const calculationType = document.getElementById('calculationType').value;
        const componentType = document.getElementById('componentCategory').value;
        // Set Gross/CTC based on component type:
        // - Earnings: always part of both Gross and CTC
        // - Deductions: not part of Gross or CTC (they reduce net pay)
        const isEarning = componentType === 'earning';

        const data = {
            component_name: document.getElementById('componentName').value,
            component_code: document.getElementById('componentCode').value,
            country_code: getSelectedCountry(),  // From global filter
            state_code: 'ALL',  // Custom components apply to all states; regional statutory comes from config
            component_type: componentType,
            calculation_type: calculationType,
            is_taxable: document.getElementById('isTaxable').value === 'true',
            is_part_of_gross: isEarning,  // Earnings are part of gross, deductions are not
            is_part_of_ctc: isEarning,    // Earnings are part of CTC, deductions are not
            description: document.getElementById('componentDescription').value,
            is_active: document.getElementById('componentIsActive')?.checked !== false
        };

        // Add percentage fields if calculation type is percentage
        if (calculationType === 'percentage') {
            data.percentage = parseFloat(document.getElementById('componentPercentage').value) || 0;
            data.calculation_base = document.getElementById('calculationBase').value;
        } else if (calculationType === 'fixed') {
            const fixedAmount = document.getElementById('componentFixedAmount').value;
            if (fixedAmount) {
                data.fixed_amount = parseFloat(fixedAmount);
            }
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
                        <span class="value">${formatCurrency(loan.principal_amount, null, loan.currency_symbol)}</span>
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
                        <span class="value">${formatCurrency(loan.emi_amount, null, loan.currency_symbol)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Tenure:</span>
                        <span class="value">${loan.tenure_months || 'N/A'} months</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Outstanding Amount:</span>
                        <span class="value">${formatCurrency(loan.outstanding_amount, null, loan.currency_symbol)}</span>
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

// v3.0.30: Edit Loan functionality
let currentEditLoanData = null;

async function showEditLoanModal(loanId) {
    try {
        showLoading();
        // Fetch full loan details
        const loan = await api.request(`/hrms/payroll-processing/loans/${loanId}`);
        currentEditLoanData = loan;

        // Populate the edit form
        document.getElementById('editLoanId').value = loan.id;
        document.getElementById('editLoanNumber').value = loan.loan_number || 'N/A';
        document.getElementById('editLoanEmployee').value = loan.employee_name || loan.employee_code || 'N/A';
        document.getElementById('editLoanType').value = loan.loan_type || 'personal_loan';
        document.getElementById('editPrincipalAmount').value = loan.principal_amount || 0;
        document.getElementById('editInterestRate').value = loan.interest_rate || 0;
        document.getElementById('editInterestType').value = loan.interest_calculation_type || 'simple';
        document.getElementById('editTenureMonths').value = loan.tenure_months || 6;
        document.getElementById('editLoanStartDate').value = loan.start_date ? loan.start_date.split('T')[0] : '';
        document.getElementById('editLoanPriority').value = loan.priority || 100;
        document.getElementById('editLoanPurpose').value = loan.purpose || '';

        // Show current EMI (will be recalculated on save)
        document.getElementById('editCurrentEmi').value = formatCurrency(loan.emi_amount, null, loan.currency_symbol);

        closeModal('viewLoanModal');
        document.getElementById('editLoanModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading loan for edit:', error);
        showToast(error.message || 'Failed to load loan details', 'error');
        hideLoading();
    }
}

async function submitEditLoan() {
    const loanId = document.getElementById('editLoanId').value;
    if (!loanId) {
        showToast('No loan selected for editing', 'error');
        return;
    }

    const request = {
        loan_type: document.getElementById('editLoanType').value,
        principal_amount: parseFloat(document.getElementById('editPrincipalAmount').value) || 0,
        interest_rate: parseFloat(document.getElementById('editInterestRate').value) || 0,
        interest_calculation_type: document.getElementById('editInterestType').value,
        tenure_months: parseInt(document.getElementById('editTenureMonths').value) || 6,
        start_date: document.getElementById('editLoanStartDate').value || null,
        priority: parseInt(document.getElementById('editLoanPriority').value) || 100,
        purpose: document.getElementById('editLoanPurpose').value?.trim() || null
    };

    // Validation
    if (request.principal_amount <= 0) {
        showToast('Principal amount must be greater than 0', 'error');
        return;
    }
    if (request.tenure_months < 1 || request.tenure_months > 360) {
        showToast('Tenure must be between 1 and 360 months', 'error');
        return;
    }
    if (request.interest_rate < 0 || request.interest_rate > 100) {
        showToast('Interest rate must be between 0 and 100%', 'error');
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-processing/loans/${loanId}`, {
            method: 'PUT',
            body: JSON.stringify(request)
        });

        closeModal('editLoanModal');
        showToast(result.message || 'Loan updated successfully', 'success');
        await loadLoans();
        hideLoading();
    } catch (error) {
        console.error('Error updating loan:', error);
        showToast(error.message || error.error || 'Failed to update loan', 'error');
        hideLoading();
    }
}

// v3.0.30: Cancel/Delete loan functionality
async function confirmCancelLoan(loanId) {
    // Show confirmation dialog using toast.js Confirm
    const confirmed = await Confirm.show({
        title: 'Cancel Loan',
        message: 'Are you sure you want to cancel this loan? This will set the status to "cancelled" and delete all pending repayments. This action cannot be undone.',
        type: 'danger',
        confirmText: 'Cancel Loan',
        cancelText: 'Keep Loan'
    });

    if (!confirmed) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-processing/loans/${loanId}`, {
            method: 'DELETE'
        });

        showToast(result.message || 'Loan cancelled successfully', 'success');
        closeModal('viewLoanModal');
        await loadLoans();
        hideLoading();
    } catch (error) {
        console.error('Error cancelling loan:', error);
        showToast(error.message || error.error || 'Failed to cancel loan', 'error');
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

        // v3.0.18: COUNTRY-AGNOSTIC - Use currency from backend response
        const currencySymbol = payslip.currency_symbol || '₹';
        const currencyCode = payslip.currency_code || 'INR';
        const localeMap = { 'INR': 'en-IN', 'USD': 'en-US', 'GBP': 'en-GB', 'AED': 'ar-AE', 'IDR': 'id-ID', 'MVR': 'dv-MV' };
        const locale = localeMap[currencyCode] || 'en-IN';

        // Local currency formatter using backend-provided currency
        // v3.0.20: Added space between symbol and number for readability
        const fmtCurrency = (amt) => {
            if (amt === null || amt === undefined) return `${currencySymbol} 0`;
            return `${currencySymbol} ${Number(amt).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        };

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
                                                    <td class="text-right">${fmtCurrency(i.amount)}</td>
                                                    <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="3" class="text-muted">No earnings</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${fmtCurrency(groupEarningsTotal)}</td>
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
                                                    <td class="text-right">${fmtCurrency(i.amount)}</td>
                                                    <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="3" class="text-muted">No deductions</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${fmtCurrency(groupDeductionsTotal)}</td>
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
                                <span style="font-weight: 600; color: var(--color-success);">${fmtCurrency(payslip.gross_earnings)}</span>
                            </div>
                            ${payslip.arrears > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Arrears Total</span>
                                <span style="font-weight: 600; color: var(--color-warning);">${fmtCurrency(payslip.arrears)}</span>
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
                                                    ${arr.source_type === 'ctc_revision' && arr.old_ctc ? fmtCurrency(arr.old_ctc) + '/yr' : fmtCurrency(arr.old_gross)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--color-success);">
                                                    ${arr.source_type === 'ctc_revision' && arr.new_ctc ? fmtCurrency(arr.new_ctc) + '/yr' : fmtCurrency(arr.new_gross)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-warning);">${fmtCurrency(arr.arrears_amount)}</td>
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
                                <span style="font-weight: 600; color: var(--color-danger);">${fmtCurrency(payslip.total_deductions)}</span>
                            </div>
                            ${payslip.loan_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Loan Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${fmtCurrency(payslip.loan_deductions)}</span>
                            </div>
                            ` : ''}
                            ${payslip.voluntary_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Voluntary Deductions</span>
                                <span style="font-weight: 600; color: var(--color-danger);">${fmtCurrency(payslip.voluntary_deductions)}</span>
                            </div>
                            ${payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0 ? `
                            <div class="vd-breakdown-section" style="margin: 0.5rem 0; padding: 0.5rem; background: color-mix(in srgb, var(--color-info) 8%, transparent); border-radius: 6px; border-left: 3px solid var(--color-info);">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                    <svg width="14" height="14" fill="currentColor" style="color: var(--color-info);"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445z"/></svg>
                                    <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-info);">Voluntary Deduction Details</span>
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
                                                    ${fmtCurrency(vd.full_amount)}
                                                </td>
                                                <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-danger);">
                                                    ${fmtCurrency(vd.deducted_amount)}
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
                                <span style="font-weight: 700; color: var(--brand-primary); font-size: 1.1rem;">${fmtCurrency(payslip.net_pay)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Single structure - use original layout with YTD
            const earnings = items.filter(i => i.component_type === 'earning');
            const deductions = items.filter(i => i.component_type === 'deduction');

            // Separate employer contributions for cost classification display
            // v3.1.0: Use backend-provided contributor_type and ctc_classification directly
            const isEmployerComponent = (item) => {
                // Primary: use backend-provided contributor_type
                if (item.contributor_type) {
                    return item.contributor_type === 'employer';
                }
                // Fallback for legacy data
                return item.component_type === 'employer_contribution' ||
                       item.component_type === 'benefit' ||
                       (item.charge_category && item.charge_category.endsWith('_employer'));
            };
            const employerContributions = items.filter(i => isEmployerComponent(i));
            // v3.1.0: Use backend-provided ctc_classification (fallback to cost_classification_employer for payslip items)
            const ctcIncludedItems = employerContributions.filter(i =>
                i.ctc_classification === 'included_in_ctc' || i.cost_classification_employer === 'included_in_ctc');
            const overheadItems = employerContributions.filter(i =>
                i.ctc_classification === 'organizational_overhead' || i.cost_classification_employer === 'organizational_overhead');

            const earningsHtml = earnings.length > 0 ?
                earnings.map(i => `<tr><td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td><td class="text-right">${fmtCurrency(i.amount)}</td><td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${fmtCurrency(i.ytd_amount || 0)}</td></tr>`).join('') :
                '<tr><td colspan="3" class="text-muted">No earnings</td></tr>';

            const deductionsHtml = deductions.length > 0 ?
                deductions.map(i => {
                    const isEligible = i.is_eligible !== false;
                    const eligibilityIcon = i.amount === 0 && !isEligible ? '<span style="color:var(--color-warning);" title="Not eligible">⚠</span> ' : '';
                    const eligibilityReason = !isEligible && i.eligibility_reason ?
                        `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;max-width:180px;">${i.eligibility_reason}</div>` : '';
                    const proratedTag = i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : '';
                    return `<tr>
                        <td>
                            ${eligibilityIcon}${i.component_name}${proratedTag}
                            ${eligibilityReason}
                        </td>
                        <td class="text-right">${fmtCurrency(i.amount)}</td>
                        <td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                    </tr>`;
                }).join('') :
                '<tr><td colspan="3" class="text-muted">No deductions</td></tr>';

            // Arrears breakdown for single structure
            const arrearsBreakdownHtml = payslip.arrears > 0 && payslip.arrears_breakdown && payslip.arrears_breakdown.length > 0 ? `
                <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(var(--color-warning-rgb, 245, 158, 11), 0.08); border-radius: 8px; border-left: 3px solid var(--color-warning);">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <svg width="14" height="14" fill="currentColor" style="color: var(--color-warning);"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3.5a.5.5 0 0 1-.5-.5v-3.5A.5.5 0 0 1 8 4z"/></svg>
                        <span style="font-size: 0.8rem; font-weight: 600; color: var(--color-warning);">Arrears Breakdown (${fmtCurrency(payslip.arrears)} total)</span>
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
                                        ${arr.source_type === 'ctc_revision' && arr.old_ctc ? fmtCurrency(arr.old_ctc) + '/yr' : fmtCurrency(arr.old_gross)}
                                    </td>
                                    <td style="padding: 0.25rem 0.5rem; text-align: right; color: var(--color-success);">
                                        ${arr.source_type === 'ctc_revision' && arr.new_ctc ? fmtCurrency(arr.new_ctc) + '/yr' : fmtCurrency(arr.new_gross)}
                                    </td>
                                    <td style="padding: 0.25rem 0.5rem; text-align: right; font-weight: 600; color: var(--color-warning);">${fmtCurrency(arr.arrears_amount)}</td>
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
                                    <td class="text-right">${fmtCurrency(payslip.gross_earnings)}</td>
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
                                ${payslip.loan_deductions > 0 ? `<tr><td>Loan EMI</td><td class="text-right">${fmtCurrency(payslip.loan_deductions)}</td><td></td></tr>` : ''}
                                ${payslip.voluntary_deductions > 0 && payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0 ?
                                    payslip.voluntary_deduction_items.map(vd => `
                                        <tr>
                                            <td>
                                                ${vd.deduction_type_name}
                                                ${vd.is_prorated ? `<span style="font-size:0.7rem;color:var(--text-muted);"> (${vd.days_applicable || '-'}/${vd.total_days_in_period || '-'} days)</span>` : ''}
                                            </td>
                                            <td class="text-right">${fmtCurrency(vd.deducted_amount)}</td>
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
                                    <td class="text-right">${fmtCurrency(payslip.total_deductions + (payslip.loan_deductions || 0) + (payslip.voluntary_deductions || 0))}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
                ${arrearsBreakdownHtml}
                ${(ctcIncludedItems.length > 0 || overheadItems.length > 0) ? `
                <div style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-subtle); border-radius: 8px;">
                    <h5 style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: var(--text-secondary);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        Employer Cost Classification
                    </h5>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.8rem;">
                        ${ctcIncludedItems.length > 0 ? `
                        <div style="padding: 0.5rem; background: rgba(var(--color-success-rgb, 34, 197, 94), 0.08); border-radius: 6px; border-left: 3px solid var(--color-success);">
                            <div style="font-size: 0.7rem; color: var(--color-success); margin-bottom: 0.4rem; font-weight: 600;">Within CTC</div>
                            ${ctcIncludedItems.map(i => `
                                <div style="display: flex; justify-content: space-between; padding: 0.2rem 0;">
                                    <span>${i.component_name}</span>
                                    <span style="font-weight: 500;">${fmtCurrency(i.amount)}</span>
                                </div>
                            `).join('')}
                            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-top: 1px solid var(--border-color); margin-top: 0.3rem; font-weight: 600;">
                                <span>Total</span>
                                <span>${fmtCurrency(ctcIncludedItems.reduce((sum, i) => sum + (i.amount || 0), 0))}</span>
                            </div>
                        </div>
                        ` : ''}
                        ${overheadItems.length > 0 ? `
                        <div style="padding: 0.5rem; background: rgba(var(--color-info-rgb, 59, 130, 246), 0.08); border-radius: 6px; border-left: 3px solid var(--color-info);">
                            <div style="font-size: 0.7rem; color: var(--color-info); margin-bottom: 0.4rem; font-weight: 600;">Beyond CTC (Overhead)</div>
                            ${overheadItems.map(i => `
                                <div style="display: flex; justify-content: space-between; padding: 0.2rem 0;">
                                    <span>${i.component_name}</span>
                                    <span style="font-weight: 500;">${fmtCurrency(i.amount)}</span>
                                </div>
                            `).join('')}
                            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-top: 1px solid var(--border-color); margin-top: 0.3rem; font-weight: 600;">
                                <span>Total</span>
                                <span>${fmtCurrency(overheadItems.reduce((sum, i) => sum + (i.amount || 0), 0))}</span>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
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
                    <div style="font-size: 1.1rem; font-weight: 700;">${fmtCurrency(payslip.net_pay)}</div>
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

            <!-- v3.0.26: Calculation Button for processed payslips -->
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed var(--border-color); display: flex; justify-content: center;">
                <button class="btn btn-secondary" onclick="viewCalculationProofProcessed('${payslipId}')" style="display: flex; align-items: center; gap: 0.5rem;">
                    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    View Calculation
                </button>
            </div>
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
                                <span class="loc-value">${fmtCurrency(grossEarnings)}</span>
                                <span class="loc-label">Gross</span>
                            </div>
                        </div>
                        ${taxItems.length > 0 ? `
                            <div class="location-taxes">
                                <div class="tax-label">Location Taxes: ${fmtCurrency(locationTaxes)}</div>
                                ${taxItems.map(tax => `
                                    <div class="tax-item">
                                        <span>${tax.tax_name || tax.taxName} ${tax.jurisdiction_code ? `(${tax.jurisdiction_code})` : ''}</span>
                                        <span>${fmtCurrency(tax.tax_amount || tax.taxAmount)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                        <div class="location-net">
                            Net: ${fmtCurrency(netPay)}
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
        const pickerValue = allPayslipsMonthPicker?.getValue() || { year: new Date().getFullYear(), month: null };
        const year = pickerValue.year;
        const month = pickerValue.month || '';
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
    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        allPayslipsPagination = createTablePagination('allPayslipsPagination', {
            containerSelector: '#allPayslipsPagination',
            data: allPayslips,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderAllPayslipsRows(paginatedData);
            }
        });
    } else {
        renderAllPayslipsRows(allPayslips);
    }
}

function renderAllPayslipsRows(payslips) {
    const tbody = document.getElementById('allPayslipsTable');
    if (!tbody) return;

    if (!payslips || payslips.length === 0) {
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

    tbody.innerHTML = payslips.map(p => {
        const employeeName = p.employee_name || p.employeeName || 'N/A';
        const employeeCode = p.employee_code || p.employeeCode || 'N/A';
        const departmentName = p.department_name || p.departmentName || 'N/A';
        const month = p.payroll_month || p.month || p.payrollMonth || 0;
        const year = p.payroll_year || p.year || p.payrollYear || 0;
        const grossSalary = p.gross_earnings || p.grossSalary || p.gross || 0;
        const deductions = p.total_deductions || p.totalDeductions || p.deductions || 0;
        const netSalary = p.net_pay || p.netSalary || p.net || 0;
        const status = p.status || 'generated';
        const statusClass = getPayslipStatusBadgeClass(status);
        // Use currency_symbol from backend (country-agnostic)
        const currencyCode = p.currency_code || null;
        const currencySymbol = p.currency_symbol || null;
        const monthYearDisplay = (month && year) ? `${getMonthName(month)} ${year}` : '-';

        return `
            <tr>
                <td>${employeeName}</td>
                <td>${employeeCode}</td>
                <td>${departmentName}</td>
                <td>${monthYearDisplay}</td>
                <td>${formatCurrency(grossSalary, currencyCode, currencySymbol)}</td>
                <td>${formatCurrency(deductions, currencyCode, currencySymbol)}</td>
                <td>${formatCurrency(netSalary, currencyCode, currencySymbol)}</td>
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
    // Get currency from first payslip (country-agnostic)
    const firstPayslip = allPayslips[0] || {};
    const currencyCode = firstPayslip.currency_code || null;
    const currencySymbol = firstPayslip.currency_symbol || null;

    const totalCountEl = document.getElementById('totalPayslipsCount');
    const totalGrossEl = document.getElementById('totalGrossAmount');
    const totalNetEl = document.getElementById('totalNetAmount');
    const avgNetEl = document.getElementById('avgNetSalary');

    if (totalCountEl) totalCountEl.textContent = totalCount;
    if (totalGrossEl) totalGrossEl.textContent = formatCurrency(totalGross, currencyCode, currencySymbol);
    if (totalNetEl) totalNetEl.textContent = formatCurrency(totalNet, currencyCode, currencySymbol);
    if (avgNetEl) avgNetEl.textContent = formatCurrency(avgNet, currencyCode, currencySymbol);
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
        const token = getAuthToken();
        const response = await fetch(`${CONFIG.hrmsApiBaseUrl}/payroll-processing/payslips/${payslipId}?includeItems=true`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch payslip data');
        }

        const payslip = await response.json();

        // v3.0.25: Get currency symbol from payslip (country-agnostic)
        const currSymbol = payslip.currency_symbol || '₹';

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
            doc.text(`${currSymbol}${formatNumber(e.amount)}`, margin + tableWidth - 5, earningsY + 5.5, { align: 'right' });
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
        doc.text(`${currSymbol}${formatNumber(payslip.gross_earnings || 0)}`, margin + tableWidth - 5, earningsY + 7, { align: 'right' });

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
            doc.text(`${currSymbol}${formatNumber(d.amount)}`, dedX + tableWidth - 5, deductionsY + 5.5, { align: 'right' });
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
        doc.text(`${currSymbol}${formatNumber(payslip.total_deductions || 0)}`, dedX + tableWidth - 5, deductionsY + 7, { align: 'right' });

        y = Math.max(earningsY, deductionsY) + 20;

        // Net Pay Section
        addRect(margin, y, contentWidth, 35, primaryColor);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('NET PAY', pageWidth / 2, y + 10, { align: 'center' });
        doc.setFontSize(28);
        doc.setFont('helvetica', 'bold');
        doc.text(`${currSymbol}${formatNumber(payslip.net_pay || 0)}`, pageWidth / 2, y + 24, { align: 'center' });

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
    // v3.0.25: Country-agnostic currency symbol from backend
    const currSymbol = payslip.currency_symbol || '₹';

    // Format earnings rows
    const earningsRows = earnings.map((e, i) => `
        <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="padding: 10px 12px; font-size: 12px; color: #374151; border-bottom: 1px solid #e5e7eb;">${e.component_name}</td>
            <td style="padding: 10px 12px; text-align: right; font-size: 12px; color: #059669; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${currSymbol}${formatNumber(e.amount)}</td>
        </tr>
    `).join('');

    // Format deductions rows
    const deductionsRows = deductions.map((d, i) => `
        <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#fef2f2'};">
            <td style="padding: 10px 12px; font-size: 12px; color: #374151; border-bottom: 1px solid #e5e7eb;">${d.component_name}</td>
            <td style="padding: 10px 12px; text-align: right; font-size: 12px; color: #dc2626; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${currSymbol}${formatNumber(d.amount)}</td>
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
                                <td style="padding: 12px; text-align: right; font-size: 14px; font-weight: bold; color: #166534; border-top: 2px solid #22c55e;">${currSymbol}${formatNumber(payslip.gross_earnings || 0)}</td>
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
                                <td style="padding: 12px; text-align: right; font-size: 14px; font-weight: bold; color: #991b1b; border-top: 2px solid #ef4444;">${currSymbol}${formatNumber(payslip.total_deductions || 0)}</td>
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
                        <div style="color: white; font-size: 36px; font-weight: bold; margin: 8px 0;">${currSymbol}${formatNumber(payslip.net_pay || 0)}</div>
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
    document.getElementById('componentDescription').value = component.description || '';

    // Country is set from global filter, state not required for custom components
    // When editing, sync all country dropdowns to match the component's country
    if (component.country_code && component.country_code !== selectedGlobalCountry) {
        selectedGlobalCountry = component.country_code;
        // Sync all country dropdowns
        countryDropdownInstances.forEach((dropdown) => {
            if (dropdown && typeof dropdown.setValue === 'function') {
                dropdown.setValue(component.country_code);
            }
        });
        // Filter offices for the new country
        filterOfficesByCountry(component.country_code);
    }

    // Note: is_part_of_gross and is_part_of_ctc are auto-set based on component type

    // Set is_active checkbox
    const isActiveCheckbox = document.getElementById('componentIsActive');
    if (isActiveCheckbox) {
        isActiveCheckbox.checked = component.is_active !== false; // Default to true if not set
    }

    // Note: Balance component toggle removed - balance is now automatic and implicit

    // Populate percentage fields if applicable
    const calcType = component.calculation_type || component.calculationType || 'fixed';
    if (calcType === 'percentage') {
        document.getElementById('componentPercentage').value = component.percentage || component.percentage_of_basic || '';
        document.getElementById('calculationBase').value = component.calculation_base || 'basic';
    } else {
        // Populate fixed amount field
        const fixedAmountInput = document.getElementById('componentFixedAmount');
        if (fixedAmountInput) {
            fixedAmountInput.value = component.fixed_amount || component.default_value || '';
        }
    }

    // Show/hide percentage fields based on calculation type
    togglePercentageFields();

    document.getElementById('componentModalTitle').textContent = 'Edit Salary Component';
    document.getElementById('componentModal').classList.add('active');
}

async function deleteComponent(componentId) {
    const component = components.find(c => c.id === componentId);
    if (!component) {
        showToast('Component not found', 'error');
        return;
    }

    // Show confirmation dialog using toast.js Confirm
    const componentName = component.component_name || component.name || 'this component';
    const confirmed = await Confirm.show({
        message: `Are you sure you want to delete "${componentName}"? This action cannot be undone. Deletion will fail if this component is used in any processed payroll.`,
        title: 'Delete Salary Component',
        type: 'danger',
        confirmText: 'Delete'
    });

    if (!confirmed) {
        return;
    }

    try {
        const response = await api.request(`/hrms/payroll/components/${componentId}`, {
            method: 'DELETE'
        });

        if (response.ok || response.success) {
            showToast(`Component "${componentName}" deleted successfully`, 'success');
            await loadSalaryComponents(); // Reload the components list
        } else {
            // Handle error response
            const errorMessage = response.message || response.error || 'Failed to delete component';
            showToast(errorMessage, 'error');
        }
    } catch (error) {
        console.error('Error deleting component:', error);
        // Extract error message from the response
        let errorMessage = 'Failed to delete component';
        if (error.message) {
            errorMessage = error.message;
        }
        showToast(errorMessage, 'error');
    }
}

// Structure component management
let structureComponentCounter = 0;

/**
 * Get the currently selected office's country code from the structure modal.
 * Returns null if no office is selected.
 */
function getSelectedOfficeCountryCode() {
    const officeId = document.getElementById('structureOffice')?.value;
    if (!officeId) return null;

    const selectedOffice = offices.find(o => o.id === officeId);
    return selectedOffice?.country_code || null;
}

/**
 * Get components available for manual selection in salary structures.
 * BACKEND-DRIVEN: Returns the backend-loaded selectableComponentsForCountry array.
 * COUNTRY-AGNOSTIC: Backend filters by country_code and returns only applicable components.
 *
 * The backend /api/payroll/components/selectable?countryCode=XX returns:
 * - BASIC component for that country (is_basic_component=true)
 * - User-created earning components for that country
 * - Excludes statutory deductions/contributions (they are auto-attached)
 *
 * This function is called by createSearchableDropdown() and refreshAllComponentDropdowns()
 */
function getSelectableComponents() {
    // BACKEND-DRIVEN: Use the components loaded from /api/payroll/components/selectable
    // This is populated by loadSelectableComponentsForCountry() when office is selected
    return selectableComponentsForCountry || [];
}

/**
 * Create a searchable dropdown component with virtual scroll support
 */
function createSearchableDropdown(componentId, containerId) {
    const selectableComponents = getSelectableComponents();
    const dropdownId = `dropdown_${componentId}`;

    return `
        <div class="searchable-dropdown" id="${dropdownId}">
            <div class="dropdown-trigger" onclick="toggleSearchDropdown('${dropdownId}')">
                <span class="dropdown-selected-text">Select Component</span>
                <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            <div class="dropdown-menu">
                <div class="dropdown-search">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input type="text" class="dropdown-search-input" placeholder="Search components..."
                           oninput="filterDropdownOptions('${dropdownId}', this.value)"
                           onclick="event.stopPropagation()">
                </div>
                <div class="dropdown-options" data-component-id="${componentId}">
                    ${selectableComponents.map(c => {
                        const calcType = c.calculation_type || 'fixed';
                        const calcBase = c.calculation_base || 'basic';
                        const isBasic = c.is_basic_component || false;
                        // Determine calc type label
                        let calcLabel = calcType === 'fixed' ? 'Fixed' : '% ' + (isBasic ? 'CTC' : (calcBase === 'ctc' ? 'CTC' : calcBase === 'gross' ? 'Gross' : 'Basic'));
                        return `
                        <div class="dropdown-option"
                             data-value="${c.id}"
                             data-type="${c.component_type || c.category}"
                             data-calc-type="${calcType}"
                             data-calc-base="${calcBase}"
                             data-is-basic="${isBasic}"
                             data-is-balance="${c.is_balance_component || false}"
                             data-percentage="${c.percentage || c.default_percentage || ''}"
                             data-fixed="${c.fixed_amount || ''}"
                             data-name="${escapeHtml(c.component_name || c.name)}"
                             data-code="${escapeHtml(c.component_code || c.code)}"
                             data-calc-label="${calcLabel}"
                             onclick="selectDropdownOption('${dropdownId}', this, '${componentId}')">
                            <span class="option-name">${escapeHtml(c.component_name || c.name)}</span>
                            <span class="option-code">${escapeHtml(c.component_code || c.code)}</span>
                            <span class="option-calc-type badge badge-${calcType === 'fixed' ? 'info' : 'primary'}">${calcLabel}</span>
                        </div>
                    `}).join('')}
                </div>
            </div>
            <input type="hidden" class="component-select-value" name="component_${componentId}" required>
        </div>
    `;
}

function toggleSearchDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('open');

    // Close all other dropdowns first
    closeAllSearchDropdowns(dropdownId);

    if (isOpen) {
        closeSearchDropdown(dropdown);
    } else {
        openSearchDropdown(dropdown);
    }
}

function closeAllSearchDropdowns(exceptId = null) {
    document.querySelectorAll('.searchable-dropdown.open').forEach(d => {
        if (!exceptId || d.id !== exceptId) {
            closeSearchDropdown(d);
        }
    });
    // Also close any orphaned portal menus
    document.querySelectorAll('.dropdown-menu-portal').forEach(menu => {
        if (!exceptId || !menu.dataset.dropdownId || menu.dataset.dropdownId !== exceptId) {
            menu.remove();
        }
    });
}

function closeSearchDropdown(dropdown) {
    dropdown.classList.remove('open');
    dropdown.classList.remove('open-up');
    // Remove portal menu if exists
    const portalMenu = document.querySelector(`.dropdown-menu-portal[data-dropdown-id="${dropdown.id}"]`);
    if (portalMenu) {
        portalMenu.remove();
    }
}

function openSearchDropdown(dropdown) {
    dropdown.classList.add('open');

    const trigger = dropdown.querySelector('.dropdown-trigger');
    const originalMenu = dropdown.querySelector('.dropdown-menu');

    if (trigger && originalMenu) {
        // Clone the menu and append to body as a portal
        const portalMenu = originalMenu.cloneNode(true);
        portalMenu.classList.add('dropdown-menu-portal');
        portalMenu.dataset.dropdownId = dropdown.id;

        // Position using fixed coordinates
        const rect = trigger.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const menuHeight = 280; // Approximate max height of dropdown menu (search + options)
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;

        portalMenu.style.position = 'fixed';
        portalMenu.style.left = rect.left + 'px';
        portalMenu.style.width = rect.width + 'px';
        portalMenu.style.display = 'block';
        portalMenu.style.zIndex = '999999';

        // Check if there's enough space below, otherwise open upward (dropup)
        if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
            // Open upward - position bottom of menu at top of trigger
            portalMenu.style.bottom = (viewportHeight - rect.top + 4) + 'px';
            portalMenu.style.top = 'auto';
            portalMenu.classList.add('dropdown-menu-dropup');
            dropdown.classList.add('open-up');
        } else {
            // Open downward - default behavior
            portalMenu.style.top = (rect.bottom + 4) + 'px';
            portalMenu.style.bottom = 'auto';
            dropdown.classList.remove('open-up');
        }

        // Hide original menu
        originalMenu.style.display = 'none';

        // Append to body
        document.body.appendChild(portalMenu);

        // Re-attach event listeners to portal menu
        attachPortalMenuListeners(portalMenu, dropdown.id);

        // Focus search input in portal
        const searchInput = portalMenu.querySelector('.dropdown-search-input');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 100);
        }
    }
}

function attachPortalMenuListeners(portalMenu, dropdownId) {
    // Search input listener
    const searchInput = portalMenu.querySelector('.dropdown-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterPortalDropdownOptions(portalMenu, e.target.value);
        });
        searchInput.addEventListener('click', (e) => e.stopPropagation());
    }

    // Option click listeners
    // Extract componentId from dropdownId (dropdown_sc_0 -> sc_0)
    const componentId = dropdownId.replace('dropdown_', '');
    portalMenu.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById(dropdownId);
            selectDropdownOption(dropdownId, opt, componentId);
            closeSearchDropdown(dropdown);
        });
    });
}

function filterPortalDropdownOptions(portalMenu, searchTerm) {
    const options = portalMenu.querySelectorAll('.dropdown-option');
    const term = searchTerm.toLowerCase().trim();

    options.forEach(opt => {
        const name = (opt.dataset.name || '').toLowerCase();
        const code = (opt.dataset.code || '').toLowerCase();
        const type = (opt.dataset.type || '').toLowerCase();

        if (!term || name.includes(term) || code.includes(term) || type.includes(term)) {
            opt.style.display = 'flex';
        } else {
            opt.style.display = 'none';
        }
    });
}

function filterDropdownOptions(dropdownId, searchTerm) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const options = dropdown.querySelectorAll('.dropdown-option');
    const term = searchTerm.toLowerCase().trim();

    options.forEach(opt => {
        const name = (opt.dataset.name || '').toLowerCase();
        const code = (opt.dataset.code || '').toLowerCase();
        const type = (opt.dataset.type || '').toLowerCase();

        if (!term || name.includes(term) || code.includes(term) || type.includes(term)) {
            opt.style.display = 'flex';
        } else {
            opt.style.display = 'none';
        }
    });
}

function selectDropdownOption(dropdownId, optionElement, componentId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown || !optionElement) return;

    const value = optionElement.dataset.value;
    const name = optionElement.dataset.name;
    const code = optionElement.dataset.code;
    const componentType = optionElement.dataset.type || '';
    const calcType = optionElement.dataset.calcType || 'fixed';
    const calcLabel = optionElement.dataset.calcLabel || (calcType === 'fixed' ? 'Fixed' : '% Basic');
    // v3.0.54: Read calculation_base for percentage validation
    const calcBase = optionElement.dataset.calcBase || 'basic';

    // Update display with calc type badge
    const trigger = dropdown.querySelector('.dropdown-selected-text');
    if (trigger) {
        trigger.innerHTML = `<span class="selected-name">${escapeHtml(name)} (${escapeHtml(code)})</span><span class="selected-calc-badge badge badge-${calcType === 'fixed' ? 'info' : 'primary'}">${calcLabel}</span>`;
        trigger.classList.add('has-selection');
    }

    // Update hidden input with value, component type, calc type, and calc base
    const hiddenInput = dropdown.querySelector('.component-select-value');
    if (hiddenInput) {
        hiddenInput.value = value;
        hiddenInput.dataset.componentType = componentType;  // Store component type for validation
        hiddenInput.dataset.calcType = calcType;  // Store calc type for form submission
        hiddenInput.dataset.calcBase = calcBase;  // v3.0.54: Store calc base for backend validation
    }

    // Mark as selected in original dropdown (find by value)
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.value === value) {
            opt.classList.add('selected');
        }
    });

    // Close dropdown
    dropdown.classList.remove('open');

    // Clear search
    const searchInput = dropdown.querySelector('.dropdown-search-input');
    if (searchInput) {
        searchInput.value = '';
        filterDropdownOptions(dropdownId, '');
    }

    // Trigger calc type update
    updateStructureCalcTypeFromDropdown(optionElement, componentId);
}

function updateStructureCalcTypeFromDropdown(optionElement, componentId) {
    const row = document.getElementById(componentId);
    if (!row) return;

    const percentageInput = row.querySelector('.percentage-value');
    const fixedInput = row.querySelector('.fixed-value');

    // Check for duplicate
    const selectedValue = optionElement.dataset.value;
    if (selectedValue) {
        const isDuplicate = checkDuplicateComponentDropdown(selectedValue, componentId);
        const dropdown = row.querySelector('.searchable-dropdown');
        if (isDuplicate && dropdown) {
            dropdown.classList.add('duplicate-warning');
            showToast('Warning: This component is already added to the structure', 'warning');
        } else if (dropdown) {
            dropdown.classList.remove('duplicate-warning');
        }
    }

    const calcType = optionElement.dataset.calcType || 'fixed';
    const calcBase = optionElement.dataset.calcBase || 'basic';
    const isBasic = optionElement.dataset.isBasic === 'true';
    const defaultPercentage = optionElement.dataset.percentage;
    const defaultFixed = optionElement.dataset.fixed;

    // Build placeholder based on calculation base
    let percentagePlaceholder = '% of Basic';
    if (calcBase === 'ctc' || isBasic) {
        percentagePlaceholder = '% of CTC';
    } else if (calcBase === 'gross') {
        percentagePlaceholder = '% of Gross';
    }

    // Auto-show correct input based on component's calculation type
    if (calcType === 'fixed') {
        percentageInput.style.display = 'none';
        percentageInput.disabled = true;
        percentageInput.value = '';
        fixedInput.style.display = 'block';
        fixedInput.disabled = false;
        fixedInput.placeholder = 'Amount';
        if (defaultFixed) fixedInput.value = defaultFixed;
    } else {
        percentageInput.style.display = 'block';
        percentageInput.disabled = false;
        percentageInput.placeholder = percentagePlaceholder;
        fixedInput.style.display = 'none';
        fixedInput.disabled = true;
        fixedInput.value = '';
        if (defaultPercentage) percentageInput.value = defaultPercentage;
    }

    updateStructureSummary();
}

function checkDuplicateComponentDropdown(componentId, currentRowId) {
    const container = document.getElementById('structureComponents');
    if (!container) return false;

    const rows = container.querySelectorAll('.structure-component-row');
    for (const row of rows) {
        if (row.id === currentRowId) continue;
        const hiddenInput = row.querySelector('.component-select-value');
        if (hiddenInput && hiddenInput.value === componentId) {
            return true;
        }
    }
    return false;
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
    // Check if click is on dropdown or portal menu
    if (!e.target.closest('.searchable-dropdown') && !e.target.closest('.dropdown-menu-portal')) {
        closeAllSearchDropdowns();
    }
});

function addStructureComponent() {
    // VALIDATION: Require office selection first (country-agnostic - ensures components match office's country)
    const officeId = document.getElementById('structureOffice')?.value;
    if (!officeId) {
        showToast('Please select an office first before adding components', 'warning');
        return;
    }

    const container = document.getElementById('structureComponents');
    const componentId = `sc_${structureComponentCounter++}`;

    const componentHtml = `
        <div class="structure-component-row" id="${componentId}">
            <div class="form-row component-row">
                <div class="form-group" style="flex: 3;">
                    ${createSearchableDropdown(componentId)}
                </div>
                <div class="form-group value-field" style="flex: 1;">
                    <input type="number" class="form-control percentage-value" placeholder="%" step="0.01" min="0" max="100" oninput="updateStructureSummary()">
                    <input type="number" class="form-control fixed-value" placeholder="Amount" step="0.01" min="0" style="display: none;" disabled oninput="updateStructureSummary()">
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

    // Hide empty state when component is added
    updateComponentsEmptyState();
}

/**
 * Update the calculation type dropdown based on the selected component's configuration
 * Also checks for duplicate component selection
 */
function updateStructureCalcType(select, componentId) {
    const row = document.getElementById(componentId);
    if (!row) return;

    const selectedOption = select.options[select.selectedIndex];
    const calcTypeSelect = row.querySelector('.calc-type-select');
    const percentageInput = row.querySelector('.percentage-value');
    const fixedInput = row.querySelector('.fixed-value');

    // Check for duplicate component selection
    if (selectedOption.value) {
        const isDuplicate = checkDuplicateComponent(selectedOption.value, componentId);
        if (isDuplicate) {
            select.classList.add('duplicate-warning');
            showToast('Warning: This component is already added to the structure', 'warning');
        } else {
            select.classList.remove('duplicate-warning');
        }
    } else {
        select.classList.remove('duplicate-warning');
    }

    if (!selectedOption.value) {
        // Reset to default if no component selected
        calcTypeSelect.innerHTML = `
            <option value="percentage">% of Basic</option>
            <option value="fixed">Fixed Amount</option>
        `;
        updateStructureSummary();
        return;
    }

    const calcType = selectedOption.dataset.calcType || 'fixed';
    const calcBase = selectedOption.dataset.calcBase || 'basic';
    const isBasic = selectedOption.dataset.isBasic === 'true';
    const defaultPercentage = selectedOption.dataset.percentage;
    const defaultFixed = selectedOption.dataset.fixed;

    // Build label based on calculation base
    let percentageLabel = '% of Basic';
    if (calcBase === 'ctc') {
        percentageLabel = '% of CTC';
    } else if (calcBase === 'gross') {
        percentageLabel = '% of Gross';
    } else if (isBasic) {
        percentageLabel = '% of CTC'; // Basic salary is typically % of CTC
    }

    // Update dropdown options
    calcTypeSelect.innerHTML = `
        <option value="percentage">${percentageLabel}</option>
        <option value="fixed">Fixed Amount</option>
    `;

    // Set the default calculation type based on component definition
    if (calcType === 'fixed') {
        calcTypeSelect.value = 'fixed';
        percentageInput.style.display = 'none';
        percentageInput.disabled = true;
        fixedInput.style.display = 'block';
        fixedInput.disabled = false;
        if (defaultFixed) fixedInput.value = defaultFixed;
    } else {
        calcTypeSelect.value = 'percentage';
        percentageInput.style.display = 'block';
        percentageInput.disabled = false;
        fixedInput.style.display = 'none';
        fixedInput.disabled = true;
        if (defaultPercentage) percentageInput.value = defaultPercentage;
    }

    // Update the summary after component selection
    updateStructureSummary();
}

/**
 * Check if a component is already selected in another row
 */
function checkDuplicateComponent(componentId, currentRowId) {
    const container = document.getElementById('structureComponents');
    const rows = container.querySelectorAll('.structure-component-row');

    for (const row of rows) {
        if (row.id === currentRowId) continue; // Skip current row
        const hiddenInput = row.querySelector('.component-select-value');
        if (hiddenInput && hiddenInput.value === componentId) {
            return true; // Found duplicate
        }
    }
    return false;
}

/**
 * Update the structure summary showing earnings and deductions totals
 * This calculates the EFFECTIVE total gross as % of CTC
 *
 * Example: If Basic = 40% of CTC, and Allowance = 50% of Basic
 *   - Allowance effective = 50% * 40% / 100 = 20% of CTC
 *   - Total Gross = 40% + 20% = 60% of CTC
 *   - Remaining = 100% - 60% = 40% unallocated
 */
function updateStructureSummary() {
    const container = document.getElementById('structureComponents');
    const summaryDiv = document.getElementById('structureSummary');
    const rows = container.querySelectorAll('.structure-component-row');

    if (rows.length === 0) {
        summaryDiv.style.display = 'none';
        return;
    }

    let earningsCtcTotal = 0;      // Direct % of CTC earnings (includes Basic)
    let earningsBasicTotal = 0;    // % of Basic earnings (allowances, etc.)
    let earningsGrossTotal = 0;    // % of Gross earnings
    let deductionsBasicTotal = 0;  // Deductions as % of Basic
    let fixedAmountsCount = 0;     // Count of fixed amount components
    let hasComponents = false;
    const warnings = [];
    const selectedComponents = [];
    const basicComponents = [];    // Track components marked as "is_basic"
    const balanceComponents = [];  // Track components marked as "is_balance"
    let balanceComponentName = null;

    rows.forEach(row => {
        const hiddenInput = row.querySelector('.component-select-value');
        const percentageInput = row.querySelector('.percentage-value');
        const fixedInput = row.querySelector('.fixed-value');

        if (!hiddenInput || !hiddenInput.value) return;

        hasComponents = true;
        // Get the selected option from the searchable dropdown
        const dropdown = row.querySelector('.searchable-dropdown');
        const selectedOption = dropdown?.querySelector(`.dropdown-option[data-value="${hiddenInput.value}"]`);
        const componentType = selectedOption?.getAttribute('data-type') || '';
        const calcBase = selectedOption?.getAttribute('data-calc-base') || 'basic';
        const calcType = selectedOption?.getAttribute('data-calc-type') || 'fixed';
        const isBasic = selectedOption?.getAttribute('data-is-basic') === 'true';
        const isBalance = selectedOption?.getAttribute('data-is-balance') === 'true';
        const componentName = selectedOption?.getAttribute('data-name') || '';

        // Track for duplicate detection
        if (selectedComponents.includes(hiddenInput.value)) {
            warnings.push(`Duplicate: ${componentName}`);
        }
        selectedComponents.push(hiddenInput.value);

        // Track components marked as "is_basic"
        if (isBasic) {
            basicComponents.push(componentName);
        }

        // Track balance components (these don't count towards CTC allocation - they AUTO-FILL)
        if (isBalance && componentType === 'earning') {
            balanceComponents.push(componentName);
            balanceComponentName = componentName;
            // Skip counting balance component - it auto-calculates remaining CTC
            return;
        }

        if (calcType === 'percentage') {
            const percentage = parseFloat(percentageInput.value) || 0;

            if (componentType === 'earning') {
                if (calcBase === 'ctc' || isBasic) {
                    // Direct CTC % (Basic component or explicitly % of CTC)
                    earningsCtcTotal += percentage;
                } else if (calcBase === 'gross') {
                    // % of Gross
                    earningsGrossTotal += percentage;
                } else {
                    // % of Basic (allowances, etc.)
                    earningsBasicTotal += percentage;
                }
            } else if (componentType === 'deduction') {
                deductionsBasicTotal += percentage;
            }
        } else if (calcType === 'fixed') {
            // Fixed amount component
            if (componentType === 'earning') {
                fixedAmountsCount++;
            }
        }
    });

    if (!hasComponents) {
        summaryDiv.style.display = 'none';
        return;
    }

    // Calculate effective CTC percentages
    // Allowance 50% of Basic → if Basic is 40% of CTC → Allowance is effectively 20% of CTC
    const earningsBasicEffective = (earningsBasicTotal * earningsCtcTotal) / 100;

    // For gross-based components, we need to estimate gross first
    // Gross ≈ Basic + Basic-based earnings = earningsCtcTotal + earningsBasicEffective
    const estimatedGrossCtc = earningsCtcTotal + earningsBasicEffective;
    const earningsGrossEffective = (earningsGrossTotal * estimatedGrossCtc) / 100;

    // Total Gross = Direct CTC% + Effective Basic% + Effective Gross% + Fixed amounts (can't calculate %)
    const totalGrossCtc = earningsCtcTotal + earningsBasicEffective + earningsGrossEffective;
    const remainingCtc = 100 - totalGrossCtc;

    // Update summary values
    summaryDiv.style.display = 'block';

    // Main totals
    document.getElementById('totalGrossCtc').textContent = `${totalGrossCtc.toFixed(1)}%`;
    document.getElementById('remainingCtc').textContent = `${remainingCtc.toFixed(1)}%`;
    document.getElementById('deductionsBasicTotal').textContent = `${deductionsBasicTotal.toFixed(1)}%`;

    // Breakdown
    document.getElementById('earningsCtcTotal').textContent = `${earningsCtcTotal.toFixed(1)}%`;
    document.getElementById('earningsBasicTotal').textContent = `${earningsBasicTotal.toFixed(1)}%`;
    document.getElementById('earningsBasicEffective').textContent = `${earningsBasicEffective.toFixed(1)}%`;
    document.getElementById('fixedAmountsCount').textContent = fixedAmountsCount > 0 ? `${fixedAmountsCount} component(s)` : '0';

    // Style the remaining item based on value
    const remainingItem = document.getElementById('remainingItem');
    if (remainingCtc > 0.5) {
        remainingItem.classList.add('warning');
        remainingItem.classList.remove('ok');
    } else if (remainingCtc < -0.5) {
        remainingItem.classList.add('error');
        remainingItem.classList.remove('warning', 'ok');
    } else {
        remainingItem.classList.add('ok');
        remainingItem.classList.remove('warning', 'error');
    }

    // Check for multiple basic components
    if (basicComponents.length > 1) {
        warnings.push(`Multiple Basic components: ${basicComponents.join(', ')} - Only one should be marked as Basic`);
    }

    // Note: Balance is now automatic - no need to warn about multiple balance components
    // The backend will always auto-calculate: Balance = CTC - other earnings

    // Show warnings
    const warningDiv = document.getElementById('summaryWarning');
    const infoDiv = document.getElementById('summaryInfo');
    const balancePreview = document.getElementById('balancePreview');

    if (warnings.length > 0) {
        warningDiv.style.display = 'flex';
        warningDiv.innerHTML = '⚠️ ' + warnings.join(' | ');
    } else {
        // Auto-balance handles exceeding 100% - no warning needed
        warningDiv.style.display = 'none';
    }

    // Auto-balance handles remaining CTC automatically - no info message needed
    infoDiv.style.display = 'none';

    // AUTO-BALANCE: Update compact summary display
    // The backend will automatically calculate: Balance = CTC - Sum(other earnings)
    const balanceWillFill = remainingCtc;
    const balanceMetric = document.getElementById('balanceMetric');
    const balanceNote = document.getElementById('balanceNote');

    // Use explicit balance component name if present, otherwise show as "Auto-Balance"
    const displayName = balanceComponentName || 'Auto-Balance';
    document.getElementById('balanceComponentName').textContent = displayName;
    document.getElementById('balanceWillFill').textContent = `${balanceWillFill.toFixed(1)}%`;

    // Update balance metric styling based on value
    if (balanceMetric) {
        if (balanceWillFill < 0) {
            balanceMetric.classList.add('negative');
        } else {
            balanceMetric.classList.remove('negative');
        }
    }

    // Update note based on scenario
    if (balanceNote) {
        if (balanceWillFill < 0) {
            balanceNote.innerHTML = `⚠️ Negative balance! Other earnings exceed CTC by ${Math.abs(balanceWillFill).toFixed(1)}%. Balance will reduce Gross.`;
        } else if (balanceWillFill < 5) {
            balanceNote.innerHTML = `✓ Almost fully allocated. Balance: ${balanceWillFill.toFixed(1)}%`;
        } else if (fixedAmountsCount > 0) {
            balanceNote.innerHTML = `Fixed amounts (${fixedAmountsCount}) calculated first, then balance fills remaining ${balanceWillFill.toFixed(1)}%`;
        } else {
            balanceNote.innerHTML = `Balance auto-fills ${balanceWillFill.toFixed(1)}% of CTC. Gross always equals CTC.`;
        }
    }
}

function removeStructureComponent(componentId) {
    const element = document.getElementById(componentId);
    if (element) {
        element.remove();
        updateStructureSummary();
        // Show empty state if no components remain
        updateComponentsEmptyState();
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
        // Use hidden input from searchable dropdown
        const hiddenInput = row.querySelector('.component-select-value');
        const percentageInput = row.querySelector('.percentage-value');
        const fixedInput = row.querySelector('.fixed-value');

        if (hiddenInput && hiddenInput.value) {
            // Get component_type, calc_type, and calc_base from hidden input's data attributes (stored during selection)
            const componentType = hiddenInput.dataset.componentType || '';
            const calcType = hiddenInput.dataset.calcType || 'fixed';
            // v3.0.54: Include calculation_base - REQUIRED for percentage components
            const calcBase = hiddenInput.dataset.calcBase || (calcType === 'percentage' ? 'basic' : null);

            componentsList.push({
                component_id: hiddenInput.value,
                component_type: componentType,
                calculation_type: calcType,
                // v3.0.54: Include calculation_base for backend validation
                calculation_base: calcType === 'percentage' ? calcBase : null,
                percentage: calcType === 'percentage' ? parseFloat(percentageInput.value) || 0 : null,
                fixed_amount: calcType === 'fixed' ? parseFloat(fixedInput.value) || 0 : null,
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
                const dropdown = lastRow.querySelector('.searchable-dropdown');
                const hiddenInput = lastRow.querySelector('.component-select-value');
                const percentageInput = lastRow.querySelector('.percentage-value');
                const fixedInput = lastRow.querySelector('.fixed-value');

                // Find the dropdown option - first try in the existing options
                let option = dropdown?.querySelector(`.dropdown-option[data-value="${sc.component_id}"]`);

                // If option not found, dynamically add it to the dropdown
                if (!option && dropdown) {
                    const optionsContainer = dropdown.querySelector('.dropdown-options');
                    if (optionsContainer) {
                        const componentName = sc.component_name || sc.name || 'Unknown';
                        const componentCode = sc.component_code || sc.code || '';
                        const componentType = sc.component_type || 'earning';
                        const calcBase = sc.calculation_base || 'basic';
                        const calcType = sc.calculation_type || 'fixed';
                        const isBasic = sc.is_basic_component || false;

                        // Build calc label for badge
                        let calcLabel = calcType === 'fixed' ? 'Fixed' : '% ' + (isBasic ? 'CTC' : (calcBase === 'ctc' ? 'CTC' : calcBase === 'gross' ? 'Gross' : 'Basic'));

                        const newOptionHtml = `
                            <div class="dropdown-option"
                                 data-value="${sc.component_id}"
                                 data-type="${componentType}"
                                 data-calc-type="${calcType}"
                                 data-calc-base="${calcBase}"
                                 data-calc-label="${calcLabel}"
                                 data-is-basic="${isBasic}"
                                 data-is-balance="${sc.is_balance_component || false}"
                                 data-percentage="${sc.percentage || sc.default_percentage || ''}"
                                 data-fixed="${sc.fixed_amount || ''}"
                                 data-name="${escapeHtml(componentName)}"
                                 data-code="${escapeHtml(componentCode)}"
                                 onclick="selectDropdownOption('${dropdown.id}', this, '${lastRow.id}')">
                                <span class="option-name">${escapeHtml(componentName)}</span>
                                <span class="option-code">${escapeHtml(componentCode)}</span>
                                <span class="option-calc-type badge badge-${calcType === 'fixed' ? 'info' : 'primary'}">${calcLabel}</span>
                            </div>
                        `;
                        optionsContainer.insertAdjacentHTML('afterbegin', newOptionHtml);
                        option = optionsContainer.querySelector(`.dropdown-option[data-value="${sc.component_id}"]`);
                    }
                }

                if (option && dropdown) {
                    // Get component info
                    const calcBase = option.getAttribute('data-calc-base') || 'basic';
                    const calcType = sc.calculation_type || option.getAttribute('data-calc-type') || 'fixed';
                    const isBasic = option.getAttribute('data-is-basic') === 'true';
                    const componentName = option.dataset.name || sc.component_name || '';
                    const componentCode = option.dataset.code || sc.component_code || '';

                    // Build calc label for badge
                    let calcLabel = calcType === 'fixed' ? 'Fixed' : '% ' + (isBasic ? 'CTC' : (calcBase === 'ctc' ? 'CTC' : calcBase === 'gross' ? 'Gross' : 'Basic'));

                    // Set hidden input value, component type, calc type, and calc base
                    hiddenInput.value = sc.component_id;
                    hiddenInput.dataset.componentType = option.dataset.type || sc.component_type || '';
                    hiddenInput.dataset.calcType = calcType;
                    hiddenInput.dataset.calcBase = calcBase;  // v3.0.54: Store calc base for backend validation

                    // Update display text with badge
                    const trigger = dropdown.querySelector('.dropdown-selected-text');
                    if (trigger) {
                        trigger.innerHTML = `<span class="selected-name">${escapeHtml(componentName)} (${escapeHtml(componentCode)})</span><span class="selected-calc-badge badge badge-${calcType === 'fixed' ? 'info' : 'primary'}">${calcLabel}</span>`;
                        trigger.classList.add('has-selection');
                    }

                    // Mark option as selected
                    option.classList.add('selected');
                }

                // Get the actual calculation type to use
                const calcType = sc.calculation_type || 'fixed';

                if (calcType === 'fixed') {
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

        // Update summary after populating all components
        updateStructureSummary();
    }
}

// Utility functions
/**
 * v3.0.20: Country-agnostic currency formatting.
 * Accepts optional currencyCode and currencySymbol for country-specific display.
 * Adds space between symbol and number for readability.
 * @param {number} amount - The amount to format
 * @param {string} currencyCode - Optional currency code (e.g., 'INR', 'IDR', 'MVR')
 * @param {string} currencySymbol - Optional currency symbol (e.g., '₹', 'Rp', 'Rf')
 */
function formatCurrency(amount, currencyCode = null, currencySymbol = null) {
    if (amount === null || amount === undefined) {
        const symbol = currencySymbol || '₹';
        return `${symbol} 0`;
    }

    // Determine locale based on currency code for proper number formatting
    const localeMap = {
        'INR': 'en-IN',
        'IDR': 'id-ID',
        'MVR': 'en-MV',
        'USD': 'en-US',
        'GBP': 'en-GB',
        'EUR': 'de-DE',
        'AED': 'ar-AE',
        'SGD': 'en-SG',
        'MYR': 'ms-MY',
        'AUD': 'en-AU',
        'JPY': 'ja-JP',
        'CNY': 'zh-CN'
    };

    const code = currencyCode || 'INR';
    const symbol = currencySymbol || '₹';
    const locale = localeMap[code] || 'en-IN';

    // Format the number without currency symbol, then prepend symbol with space
    const formattedNumber = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);

    return `${symbol} ${formattedNumber}`;
}

/**
 * v3.0.26: Get currency info from global country filter.
 * Used for displays where backend doesn't provide currency (component config, arrears, bulk preview).
 * Falls back to INR if country not found.
 */
function getSelectedCurrency() {
    // Use the centralized getSelectedCountry() function which returns the synchronized country code
    const countryCode = getSelectedCountry() || 'IN';
    // Look up from loaded countries data (loaded at page init)
    const country = window.loadedCountries?.find(c => c.country_code === countryCode);
    return {
        code: country?.currency_code || 'INR',
        symbol: country?.currency_symbol || '₹'
    };
}

/**
 * v3.0.32: Get currency info from an office ID.
 * Used for tabs that don't have a global country filter (Loans, Adjustments, Arrears).
 * Falls back to INR if office/country not found.
 * @param {string} officeId - The office UUID
 * @returns {{ code: string, symbol: string }}
 */
function getCurrencyFromOfficeId(officeId) {
    if (!officeId) {
        return { code: 'INR', symbol: '₹' };
    }
    // Find office in global offices array
    const office = offices.find(o => o.id === officeId);
    if (!office) {
        return { code: 'INR', symbol: '₹' };
    }
    // Try to get country from office's country_code
    const countryCode = office.country_code;
    if (!countryCode) {
        return { code: 'INR', symbol: '₹' };
    }
    // Look up country to get currency
    const country = window.loadedCountries?.find(c => c.country_code === countryCode);
    return {
        code: country?.currency_code || 'INR',
        symbol: country?.currency_symbol || '₹'
    };
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
    // v3.0.29: Use currency symbol from country config (enriched by backend)
    const currencySymbol = loan.currency_symbol || null;

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
            // v3.0.28: Fixed field mappings to match backend LoanRepayment model
            const statusClass = r.status === 'paid' ? 'paid' : (r.status === 'pending' ? 'pending' : r.status?.toLowerCase() || 'pending');
            const statusLabel = r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : 'Pending';
            html += `
                <tr class="${r.status === 'paid' ? 'paid-row' : ''}">
                    <td>${r.emi_number}</td>
                    <td>${formatDate(r.repayment_date)}</td>
                    <td>${formatCurrency(r.principal_component, null, currencySymbol)}</td>
                    <td>${formatCurrency(r.interest_component, null, currencySymbol)}</td>
                    <td>${formatCurrency(r.total_amount, null, currencySymbol)}</td>
                    <td>${formatCurrency(r.balance_after, null, currencySymbol)}</td>
                    <td><span class="status-badge status-${statusClass}">${statusLabel}</span></td>
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
                    <span class="summary-value">${formatCurrency(principal, null, currencySymbol)}</span>
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
                    <span class="summary-value">${formatCurrency(emi, null, currencySymbol)}</span>
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
                <td>${formatCurrency(principalPortion, null, currencySymbol)}</td>
                <td>${formatCurrency(interestPortion, null, currencySymbol)}</td>
                <td>${formatCurrency(emiAmount, null, currencySymbol)}</td>
                <td>${formatCurrency(balance, null, currencySymbol)}</td>
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

        // v3.0.20: Get currency from first payslip (enriched by backend)
        const firstPayslip = payslips.length > 0 ? payslips[0] : null;
        const currencyCode = firstPayslip?.currency_code || run.currency_code || null;
        const currencySymbol = firstPayslip?.currency_symbol || run.currency_symbol || null;
        // Store currency in modal state for use in payslip rows
        payrollModalState.currencyCode = currencyCode;
        payrollModalState.currencySymbol = currencySymbol;

        // Extract dynamic columns from payslip items
        payrollModalState.dynamicColumns = extractDynamicColumns(payslips);

        // Update modal title
        document.getElementById('payrollRunDetailsTitle').textContent =
            `${getMonthName(run.payroll_month)} ${run.payroll_year} Payroll`;

        // Build compact content with country-specific currency
        let contentHtml = `
            <div class="pr-compact-header">
                <div class="pr-stats-row">
                    <div class="pr-stat"><span class="pr-stat-val">${summary.total_employees || 0}</span><span class="pr-stat-lbl">Employees</span></div>
                    <div class="pr-stat"><span class="pr-stat-val">${formatCurrency(summary.total_gross, currencyCode, currencySymbol)}</span><span class="pr-stat-lbl">Gross</span></div>
                    <div class="pr-stat"><span class="pr-stat-val">${formatCurrency(summary.total_deductions, currencyCode, currencySymbol)}</span><span class="pr-stat-lbl">Deductions</span></div>
                    <div class="pr-stat pr-stat-highlight"><span class="pr-stat-val">${formatCurrency(summary.total_net, currencyCode, currencySymbol)}</span><span class="pr-stat-lbl">Net Pay</span></div>
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
        return `<td class="pr-col-num text-right">${formatCurrencyCompact(amount, payrollModalState.currencyCode)}</td>`;
    }).join('');
}

// Format currency compactly (no decimals, with commas) - just number, no symbol
// v3.0.20: Uses locale based on currency code for proper thousand separators
function formatCurrencyCompact(amount, currencyCode = null) {
    if (amount === null || amount === undefined || amount === 0) return '0';

    const localeMap = {
        'INR': 'en-IN',
        'IDR': 'id-ID',
        'MVR': 'en-MV',
        'USD': 'en-US',
        'GBP': 'en-GB',
        'EUR': 'de-DE'
    };
    const locale = localeMap[currencyCode] || 'en-IN';
    return Math.round(amount).toLocaleString(locale);
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
                <td class="pr-col-num text-right pr-cell-bold">${formatCurrencyCompact(slip.gross_earnings, payrollModalState.currencyCode)}</td>
                <td class="pr-col-num text-right pr-cell-muted">${formatCurrencyCompact(slip.total_deductions, payrollModalState.currencyCode)}</td>
                <td class="pr-col-num text-right pr-cell-net">${formatCurrencyCompact(slip.net_pay, payrollModalState.currencyCode)}</td>
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
        const token = getAuthToken();
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
// Note: runYear/runMonth now handled by MonthPicker onChange callback
document.getElementById('runOffice')?.addEventListener('change', loadPayrollRuns);
document.getElementById('structureSearch')?.addEventListener('input', updateSalaryStructuresTable);
document.getElementById('structureOfficeFilter')?.addEventListener('change', loadSalaryStructures);
document.getElementById('structureOffice')?.addEventListener('change', onStructureOfficeChange);
document.getElementById('componentSearch')?.addEventListener('input', updateComponentsTables);
document.getElementById('componentType')?.addEventListener('change', updateComponentsTables);
document.getElementById('loanStatus')?.addEventListener('change', loadLoans);
document.getElementById('loanOfficeFilter')?.addEventListener('change', loadLoans);
// v3.0.31: Office filters for Employee section tabs
document.getElementById('vdOfficeFilter')?.addEventListener('change', loadVDEnrollments);
document.getElementById('adjustmentOfficeFilter')?.addEventListener('change', filterAdjustments);
document.getElementById('arrearsOfficeFilter')?.addEventListener('change', loadPendingArrears);

// =====================================================
// SALARY STRUCTURE VERSIONING FUNCTIONS
// =====================================================

let currentVersionStructureId = null;
let currentVersionStructureName = '';
let currentVersionStructureOffice = null; // Office info for the current structure (for country filtering)
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

        // Load versions (v3.0.44: include inactive/superseded versions for audit trail)
        const versions = await api.request(`/hrms/payroll/structures/${structureId}/versions?includeInactive=true`);
        structureVersions = versions || [];

        // Get structure name and office info for country filtering
        const structure = structures.find(s => s.id === structureId);
        currentVersionStructureName = structure?.structure_name || 'Structure';
        currentVersionStructureOffice = structure?.office_id ? offices.find(o => o.id === structure.office_id) : null;

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
        // v3.0.44: Use is_active field to determine version status
        // A version can be superseded (is_active=false) when a newer version with same effective_from is created
        const isCurrent = v.is_active === true && v.effective_to === null;
        const isSuperseded = v.is_active === false;
        return `
        <tr class="${isCurrent ? 'current-version' : ''} ${isSuperseded ? 'superseded-version' : ''}">
            <td>
                <div class="version-cell">
                    <strong>V${v.version_number}</strong>
                    ${isCurrent ? '<span class="badge-current">CURRENT</span>' : ''}
                    ${isSuperseded ? '<span class="badge-superseded">SUPERSEDED</span>' : ''}
                </div>
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
 * View detailed version information with tabs for visual and JSON views
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

        // Build visual HTML content
        const components = version.components || [];
        const { symbol: currSymbol } = getSelectedCurrency();

        let visualContent = `
            <div class="detail-grid">
                <span class="detail-label">EFFECTIVE FROM:</span>
                <span class="detail-value">${formatDate(version.effective_from)}</span>
                <span class="detail-label">EFFECTIVE TO:</span>
                <span class="detail-value">${version.effective_to ? formatDate(version.effective_to) : 'Ongoing'}</span>
                <span class="detail-label">CHANGE REASON:</span>
                <span class="detail-value">${version.change_reason || 'Initial version created with salary structure'}</span>
            </div>
        `;

        if (components.length > 0) {
            visualContent += `
                <div class="section-title">COMPONENTS</div>
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
                let valueStr;
                const calcType = (c.calculation_type || 'fixed').toLowerCase();
                if (calcType === 'compliance_linked') {
                    valueStr = '<span class="compliance-tag">From Compliance Rules</span>';
                } else if (calcType === 'percentage') {
                    valueStr = `${c.percentage || c.percentage_of_basic || 0}% of ${c.calculation_base || 'basic'}`;
                } else if (calcType === 'balance') {
                    valueStr = '<span style="color: var(--text-secondary);">Balance amount</span>';
                } else {
                    valueStr = `${currSymbol}${(c.fixed_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                }
                const badgeClass = c.component_type === 'earning' ? 'badge-earning' :
                                   c.component_type === 'employer_contribution' ? 'badge-employer_contribution' : 'badge-deduction';
                const badgeLabel = (c.component_type || '').replace(/_/g, ' ');

                visualContent += `
                    <tr>
                        <td><strong>${c.component_name}</strong> <span style="color: var(--text-tertiary)">(${c.component_code})</span></td>
                        <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
                        <td class="amount">${valueStr}</td>
                    </tr>
                `;
            });

            visualContent += `
                    </tbody>
                </table>
            `;
        }

        // Format JSON for display
        const jsonContent = JSON.stringify(version, null, 2);

        // Build tabbed content
        const htmlContent = `
            <div class="version-details-tabs">
                <div class="version-tab-buttons">
                    <button class="version-tab-btn active" data-tab="visual" onclick="switchVersionDetailsTab(this, 'visual')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="3" y1="9" x2="21" y2="9"></line>
                            <line x1="9" y1="21" x2="9" y2="9"></line>
                        </svg>
                        Visual
                    </button>
                    <button class="version-tab-btn" data-tab="json" onclick="switchVersionDetailsTab(this, 'json')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="16 18 22 12 16 6"></polyline>
                            <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>
                        JSON
                    </button>
                </div>
                <div class="version-tab-content">
                    <div class="version-tab-panel active" data-panel="visual">
                        ${visualContent}
                    </div>
                    <div class="version-tab-panel" data-panel="json">
                        <div class="json-toolbar">
                            <button class="json-copy-btn" onclick="copyVersionJson(this)">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                                Copy JSON
                            </button>
                        </div>
                        <pre class="json-display"><code>${escapeHtml(jsonContent)}</code></pre>
                    </div>
                </div>
            </div>
        `;

        await InfoModal.show({
            title: `Version ${version.version_number} Details`,
            message: htmlContent,
            type: 'info',
            html: true,
            maxWidth: '800px'
        });

        hideLoading();
    } catch (error) {
        console.error('Error loading version details:', error);
        showToast(error.message || 'Failed to load version details', 'error');
        hideLoading();
    }
}

/**
 * Switch between Visual and JSON tabs in version details modal
 */
function switchVersionDetailsTab(btn, targetTab) {
    const container = btn.closest('.version-details-tabs');
    if (!container) return;

    // Update button states
    container.querySelectorAll('.version-tab-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
    });

    // Update panel visibility
    container.querySelectorAll('.version-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === targetTab);
    });
}

/**
 * Copy version JSON to clipboard
 */
function copyVersionJson(btn) {
    const jsonCode = btn.closest('.version-tab-panel').querySelector('.json-display code');
    if (jsonCode) {
        navigator.clipboard.writeText(jsonCode.textContent).then(() => {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Copied!
            `;
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.classList.remove('copied');
            }, 2000);
        }).catch(() => {
            showToast('Failed to copy to clipboard', 'error');
        });
    }
}

/**
 * Escape HTML entities for safe display
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

// Counter for version components (for unique IDs)
let versionComponentCounter = 0;

/**
 * Show create new version modal
 */
async function showCreateVersionModal() {
    if (!currentVersionStructureId) {
        showToast('No structure selected', 'error');
        return;
    }

    // Reset form
    document.getElementById('newVersionForm').reset();
    versionComponentCounter = 0;

    // Set default effective date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('versionEffectiveDate').value = tomorrow.toISOString().split('T')[0];

    // Reset to Components tab
    switchVersionTab('version-components');

    // Load country-specific components and statutory deductions/contributions for this structure's office
    if (currentVersionStructureOffice) {
        const countryCode = currentVersionStructureOffice.country_code;
        const stateCode = currentVersionStructureOffice.state_code || 'ALL';

        // Load selectable components, statutory deductions AND employer contributions for this country
        await Promise.all([
            loadSelectableComponentsForCountry(countryCode),
            loadStatutoryEmployeeDeductions(countryCode, stateCode),
            loadStatutoryEmployerContributions(countryCode, stateCode)
        ]);
    }

    // Populate components from latest version using searchable dropdowns
    populateNewVersionComponents();

    // Populate statutory sections in Auto-Attached tab
    populateVersionStatutorySections();

    document.getElementById('createVersionModalTitle').textContent = `Create New Version - ${currentVersionStructureName}`;
    openModal('createVersionModal');
}

/**
 * Switch between version modal tabs
 */
function switchVersionTab(tabName) {
    // Update tab buttons (only within version modal)
    const modal = document.getElementById('createVersionModal');
    if (!modal) return;

    modal.querySelectorAll('.structure-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    modal.querySelectorAll('.structure-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
}

/**
 * Populate components for new version based on current version
 * COUNTRY-AGNOSTIC: Uses selectableComponentsForCountry (filtered by backend)
 * Uses searchable dropdowns like the structure modal
 *
 * IMPORTANT: Only user-created components are shown as editable rows.
 * Statutory components (source === 'compliance') are auto-attached and shown in the "Auto-Attached" tab.
 */
function populateNewVersionComponents() {
    const container = document.getElementById('versionComponents');
    const emptyState = document.getElementById('versionComponentsEmptyState');
    if (!container) return;

    // Clear the container
    container.innerHTML = '';

    // Get latest version's components
    const latestVersion = structureVersions[0];
    const existingComponents = latestVersion?.components || [];

    // Filter to show only EDITABLE components
    // An editable component is one that exists in selectableComponentsForCountry
    // Statutory deductions/contributions and balance components are NOT in the selectable list
    const selectableIds = new Set((selectableComponentsForCountry || []).map(c => c.id));

    const editableComponents = existingComponents.filter(comp => {
        // Only show components that are in the selectable list
        // This automatically excludes statutory deductions, employer contributions, and balance components
        return selectableIds.has(comp.component_id);
    });

    // If there are editable components, populate them
    if (editableComponents.length > 0) {
        editableComponents.forEach(comp => {
            addVersionComponentWithData(comp);
        });
        if (emptyState) emptyState.style.display = 'none';
    } else {
        // Show empty state
        if (emptyState) emptyState.style.display = 'flex';
    }

    // Update summary
    updateVersionSummary();
}

/**
 * Add a new component row to version modal (with searchable dropdown)
 */
function addVersionComponent() {
    const container = document.getElementById('versionComponents');
    const emptyState = document.getElementById('versionComponentsEmptyState');
    const componentId = `vc_${versionComponentCounter++}`;

    const componentHtml = `
        <div class="structure-component-row" id="${componentId}">
            <div class="form-row component-row">
                <div class="form-group" style="flex: 2;">
                    ${createVersionSearchableDropdown(componentId)}
                </div>
                <div class="form-group" style="flex: 1;">
                    <select id="${componentId}-calc-type" class="form-control calc-type-select">
                        <option value="percentage">% of Basic</option>
                        <option value="fixed">Fixed Amount</option>
                    </select>
                </div>
                <div class="form-group value-field" style="flex: 1;">
                    <input type="number" class="form-control percentage-value" placeholder="%" step="0.01" min="0" max="100" oninput="updateVersionSummary()">
                    <input type="number" class="form-control fixed-value" placeholder="Amount" step="0.01" min="0" style="display: none;" disabled oninput="updateVersionSummary()">
                </div>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeVersionComponent('${componentId}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', componentHtml);

    // Convert calc type select to searchable dropdown
    convertSelectToSearchable(`${componentId}-calc-type`, {
        placeholder: '% of Basic',
        searchPlaceholder: 'Search...',
        compact: true,
        onChange: (value) => {
            const row = document.getElementById(componentId);
            if (row) {
                const select = row.querySelector('.calc-type-select');
                toggleVersionComponentValueFields(select, componentId);
            }
        }
    });

    // Hide empty state
    if (emptyState) emptyState.style.display = 'none';
}

/**
 * Add a version component row with pre-populated data
 * Uses searchable dropdown with the component auto-selected
 */
function addVersionComponentWithData(comp) {
    const container = document.getElementById('versionComponents');
    const componentId = `vc_${versionComponentCounter++}`;

    // Get component data from selectable list or use comp itself
    const selectableComponents = selectableComponentsForCountry || [];
    const componentData = selectableComponents.find(c => c.id === comp.component_id);
    const effectiveData = componentData || comp;

    const calcType = comp.calculation_type || 'percentage';
    const value = calcType === 'percentage' ? (comp.percentage_of_basic || comp.percentage || '') : (comp.fixed_amount || '');

    // Determine the percentage label
    const calcBase = effectiveData.calculation_base || comp.calculation_base || 'basic';
    const isBasic = effectiveData.is_basic_component || comp.is_basic_component || false;
    let percentageLabel = '% of Basic';
    if (calcBase === 'ctc' || isBasic) {
        percentageLabel = '% of CTC';
    } else if (calcBase === 'gross') {
        percentageLabel = '% of Gross';
    }

    // Create component info object for the searchable dropdown
    const componentInfo = {
        component_id: comp.component_id,
        component_name: effectiveData.component_name || comp.component_name,
        component_code: effectiveData.component_code || comp.component_code,
        component_type: effectiveData.component_type || comp.component_type,
        calculation_type: calcType,
        calculation_base: calcBase,
        is_basic_component: isBasic,
        is_balance_component: effectiveData.is_balance_component || comp.is_balance_component || false,
        source: effectiveData.source || comp.source
    };

    const componentHtml = `
        <div class="structure-component-row" id="${componentId}">
            <div class="form-row component-row">
                <div class="form-group" style="flex: 2;">
                    ${createVersionSearchableDropdown(componentId, comp.component_id, componentInfo)}
                </div>
                <div class="form-group" style="flex: 1;">
                    <select class="form-control calc-type-select" onchange="toggleVersionComponentValueFields(this, '${componentId}')">
                        <option value="percentage" ${calcType === 'percentage' ? 'selected' : ''}>${percentageLabel}</option>
                        <option value="fixed" ${calcType === 'fixed' ? 'selected' : ''}>Fixed Amount</option>
                    </select>
                </div>
                <div class="form-group value-field" style="flex: 1;">
                    <input type="number" class="form-control percentage-value" placeholder="%" step="0.01" min="0" max="100"
                           value="${calcType === 'percentage' ? value : ''}"
                           style="${calcType === 'fixed' ? 'display: none;' : ''}"
                           ${calcType === 'fixed' ? 'disabled' : ''}
                           oninput="updateVersionSummary()">
                    <input type="number" class="form-control fixed-value" placeholder="Amount" step="0.01" min="0"
                           value="${calcType === 'fixed' ? value : ''}"
                           style="${calcType === 'percentage' ? 'display: none;' : ''}"
                           ${calcType === 'percentage' ? 'disabled' : ''}
                           oninput="updateVersionSummary()">
                </div>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeVersionComponent('${componentId}')">
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

/**
 * Create a searchable dropdown for version components
 * @param componentId - unique ID for this row
 * @param selectedComponentId - ID of the pre-selected component (if any)
 * @param componentInfo - optional component data for pre-selected component (used when component isn't in selectable list)
 */
function createVersionSearchableDropdown(componentId, selectedComponentId = null, componentInfo = null) {
    const selectableComponents = selectableComponentsForCountry || [];
    const dropdownId = `vdropdown_${componentId}`;

    // Find selected component data if provided
    let selectedText = 'Select Component';
    let selectedValue = '';
    let selectedData = null;

    if (selectedComponentId) {
        // First try to find in selectable components
        selectedData = selectableComponents.find(c => c.id === selectedComponentId);

        // If not found in selectable list, use the provided componentInfo (from existing version data)
        if (!selectedData && componentInfo) {
            selectedData = componentInfo;
        }

        if (selectedData) {
            const name = selectedData.component_name || selectedData.name || 'Unknown';
            const code = selectedData.component_code || selectedData.code || '';
            selectedText = `${name} (${code})`;
            selectedValue = selectedComponentId;
        }
    }

    // Build options list - include the selected component if it's not in selectable list
    const optionsToShow = [...selectableComponents];
    const selectedInList = selectableComponents.some(c => c.id === selectedComponentId);
    if (selectedComponentId && !selectedInList && selectedData) {
        // Add the existing component at the top of the list (it may be a statutory component)
        optionsToShow.unshift({
            id: selectedComponentId,
            component_name: selectedData.component_name || selectedData.name,
            component_code: selectedData.component_code || selectedData.code,
            component_type: selectedData.component_type,
            calculation_type: selectedData.calculation_type || 'fixed',
            calculation_base: selectedData.calculation_base || 'basic',
            is_basic_component: selectedData.is_basic_component || false,
            is_balance_component: selectedData.is_balance_component || false,
            source: selectedData.source || 'compliance'
        });
    }

    return `
        <div class="searchable-dropdown${selectedValue ? ' has-value' : ''}" id="${dropdownId}">
            <div class="dropdown-trigger" onclick="toggleSearchDropdown('${dropdownId}')">
                <span class="dropdown-selected-text">${escapeHtml(selectedText)}</span>
                <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            <div class="dropdown-menu">
                <div class="dropdown-search">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input type="text" class="dropdown-search-input" placeholder="Search components..."
                           oninput="filterDropdownOptions('${dropdownId}', this.value)"
                           onclick="event.stopPropagation()">
                </div>
                <div class="dropdown-options" data-component-id="${componentId}">
                    ${optionsToShow.map(c => `
                        <div class="dropdown-option${c.id === selectedValue ? ' selected' : ''}"
                             data-value="${c.id}"
                             data-type="${c.component_type || c.category}"
                             data-calc-type="${c.calculation_type || 'fixed'}"
                             data-calc-base="${c.calculation_base || 'basic'}"
                             data-is-basic="${c.is_basic_component || false}"
                             data-is-balance="${c.is_balance_component || false}"
                             data-percentage="${c.percentage || c.default_percentage || ''}"
                             data-fixed="${c.fixed_amount || ''}"
                             data-name="${escapeHtml(c.component_name || c.name)}"
                             data-code="${escapeHtml(c.component_code || c.code)}"
                             onclick="selectVersionDropdownOption('${dropdownId}', this, '${componentId}')">
                            <span class="option-name">${escapeHtml(c.component_name || c.name)}</span>
                            <span class="option-code">${escapeHtml(c.component_code || c.code)}</span>
                            <span class="option-type badge badge-${(c.component_type || c.category) === 'earning' ? 'success' : 'warning'}">${c.component_type || c.category}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <input type="hidden" class="component-select-value" name="vcomponent_${componentId}" value="${selectedValue}" required>
        </div>
    `;
}

/**
 * Handle version dropdown option selection
 */
function selectVersionDropdownOption(dropdownId, option, componentId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const value = option.dataset.value;
    const name = option.dataset.name;
    const code = option.dataset.code;

    // Update hidden input
    const hiddenInput = dropdown.querySelector('.component-select-value');
    if (hiddenInput) hiddenInput.value = value;

    // Update display text
    const selectedText = dropdown.querySelector('.dropdown-selected-text');
    if (selectedText) selectedText.textContent = `${name} (${code})`;

    // Add has-value class
    dropdown.classList.add('has-value');

    // Mark option as selected
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');

    // Close dropdown
    closeSearchDropdown(dropdown);

    // Update calc type based on component configuration
    updateVersionCalcType(option, componentId);
}

/**
 * Update the calculation type dropdown based on selected component
 */
function updateVersionCalcType(selectedOption, componentId) {
    const row = document.getElementById(componentId);
    if (!row) return;

    const calcTypeSelect = row.querySelector('.calc-type-select');
    const percentageInput = row.querySelector('.percentage-value');
    const fixedInput = row.querySelector('.fixed-value');

    const calcType = selectedOption.dataset.calcType || 'fixed';
    const calcBase = selectedOption.dataset.calcBase || 'basic';
    const isBasic = selectedOption.dataset.isBasic === 'true';
    const defaultPercentage = selectedOption.dataset.percentage;
    const defaultFixed = selectedOption.dataset.fixed;

    // Build label based on calculation base
    let percentageLabel = '% of Basic';
    if (calcBase === 'ctc') {
        percentageLabel = '% of CTC';
    } else if (calcBase === 'gross') {
        percentageLabel = '% of Gross';
    } else if (isBasic) {
        percentageLabel = '% of CTC';
    }

    // Update dropdown options
    calcTypeSelect.innerHTML = `
        <option value="percentage">${percentageLabel}</option>
        <option value="fixed">Fixed Amount</option>
    `;

    // Set the default calculation type
    if (calcType === 'fixed') {
        calcTypeSelect.value = 'fixed';
        percentageInput.style.display = 'none';
        percentageInput.disabled = true;
        fixedInput.style.display = 'block';
        fixedInput.disabled = false;
        if (defaultFixed) fixedInput.value = defaultFixed;
    } else {
        calcTypeSelect.value = 'percentage';
        percentageInput.style.display = 'block';
        percentageInput.disabled = false;
        fixedInput.style.display = 'none';
        fixedInput.disabled = true;
        if (defaultPercentage) percentageInput.value = defaultPercentage;
    }

    updateVersionSummary();
}

/**
 * Toggle between percentage and fixed value fields for version components
 */
function toggleVersionComponentValueFields(select, componentId) {
    const row = document.getElementById(componentId);
    if (!row) return;

    const percentageInput = row.querySelector('.percentage-value');
    const fixedInput = row.querySelector('.fixed-value');

    if (select.value === 'fixed') {
        percentageInput.style.display = 'none';
        percentageInput.disabled = true;
        fixedInput.style.display = 'block';
        fixedInput.disabled = false;
    } else {
        percentageInput.style.display = 'block';
        percentageInput.disabled = false;
        fixedInput.style.display = 'none';
        fixedInput.disabled = true;
    }

    updateVersionSummary();
}

/**
 * Remove a component from version modal
 */
function removeVersionComponent(componentId) {
    const row = document.getElementById(componentId);
    if (row) {
        row.remove();
        updateVersionComponentsEmptyState();
        updateVersionSummary();
    }
}

/**
 * Update empty state visibility for version components
 */
function updateVersionComponentsEmptyState() {
    const container = document.getElementById('versionComponents');
    const emptyState = document.getElementById('versionComponentsEmptyState');
    if (!container || !emptyState) return;

    const rows = container.querySelectorAll('.structure-component-row');
    emptyState.style.display = rows.length === 0 ? 'flex' : 'none';
}

/**
 * Update the version summary (similar to structure summary)
 */
function updateVersionSummary() {
    const container = document.getElementById('versionComponents');
    const summaryDiv = document.getElementById('versionSummary');
    if (!container || !summaryDiv) return;

    const rows = container.querySelectorAll('.structure-component-row');

    if (rows.length === 0) {
        summaryDiv.style.display = 'none';
        return;
    }

    summaryDiv.style.display = 'flex';

    // Calculate totals (simplified version)
    let totalCtc = 0;
    let totalDeductions = 0;

    rows.forEach(row => {
        // Support both native select and searchable dropdown
        const nativeSelect = row.querySelector('.component-select');
        const hiddenInput = row.querySelector('.component-select-value');
        const calcTypeSelect = row.querySelector('.calc-type-select');
        const percentageInput = row.querySelector('.percentage-value');
        const fixedInput = row.querySelector('.fixed-value');

        // Get component ID from native select or hidden input
        const componentId = nativeSelect?.value || hiddenInput?.value;
        if (!componentId) return;

        const calcType = calcTypeSelect?.value || 'percentage';
        const value = calcType === 'percentage' ? parseFloat(percentageInput?.value) || 0 : 0;

        // Check component type - from native select option or searchable dropdown
        let componentType = 'earning';
        if (nativeSelect) {
            const selectedOption = nativeSelect.options[nativeSelect.selectedIndex];
            componentType = selectedOption?.dataset?.type || 'earning';
        } else {
            const dropdown = row.querySelector('.searchable-dropdown');
            const selectedOption = dropdown?.querySelector('.dropdown-option.selected');
            componentType = selectedOption?.dataset.type || 'earning';
        }

        if (componentType === 'earning') {
            totalCtc += value;
        } else {
            totalDeductions += value;
        }
    });

    // Update display
    const grossEl = document.getElementById('versionTotalGrossCtc');
    const deductionsEl = document.getElementById('versionDeductionsTotal');
    const balanceEl = document.getElementById('versionBalanceWillFill');

    if (grossEl) grossEl.textContent = `${totalCtc.toFixed(1)}%`;
    if (deductionsEl) deductionsEl.textContent = `${totalDeductions.toFixed(1)}%`;
    if (balanceEl) balanceEl.textContent = `${Math.max(0, 100 - totalCtc).toFixed(1)}%`;
}

/**
 * Populate statutory sections in the Version modal's Auto-Attached tab
 * v3.0.54: ONLY shows employee deductions - employer contributions are NOT part of salary structure
 */
function populateVersionStatutorySections() {
    // Employee Deductions (auto-attached to salary structure)
    const deductionsContainer = document.getElementById('versionStatutoryDeductionsContainer');
    const deductionCountEl = document.getElementById('versionDeductionCount');

    if (deductionsContainer) {
        if (statutoryEmployeeDeductions && statutoryEmployeeDeductions.length > 0) {
            deductionsContainer.innerHTML = statutoryEmployeeDeductions.map(c => `
                <div class="statutory-compact-item">
                    <span class="statutory-item-code">${escapeHtml(c.component_code || c.code)}</span>
                    <span class="statutory-item-name">${escapeHtml(c.component_name || c.name)}</span>
                </div>
            `).join('');
        } else {
            deductionsContainer.innerHTML = '<div class="statutory-empty">No employee deductions configured</div>';
        }
    }
    if (deductionCountEl) {
        deductionCountEl.textContent = statutoryEmployeeDeductions?.length || 0;
    }

    // v3.0.54: Employer Contributions are NOT part of salary structure
    // They are calculated during payroll processing from country config
    // Show an informational note instead of listing components
    const contributionsContainer = document.getElementById('versionStatutoryContributionsContainer');
    const contributionCountEl = document.getElementById('versionContributionCount');

    if (contributionsContainer) {
        contributionsContainer.innerHTML = `
            <div class="statutory-info-note">
                <span style="opacity: 0.7; font-size: 11px;">
                    Employer contributions (PF, ESI, Gratuity) are calculated during payroll processing
                    based on country compliance rules. They are not part of the salary structure definition.
                </span>
            </div>
        `;
    }
    if (contributionCountEl) {
        contributionCountEl.textContent = '—';  // Em dash to indicate N/A
    }

    // Update badge count (only employee deductions count)
    updateVersionStatutoryCountBadge();
}

/**
 * Update the statutory count badge for version modal
 * v3.0.54: Only counts employee deductions (employer contributions are NOT part of structure)
 */
function updateVersionStatutoryCountBadge() {
    const badge = document.getElementById('versionStatutoryCountBadge');
    if (badge) {
        // Only count employee deductions - employer contributions are calculated during payroll
        const totalCount = statutoryEmployeeDeductions?.length || 0;
        badge.textContent = totalCount;
    }
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

    // Collect components from searchable dropdowns
    const container = document.getElementById('versionComponents');
    const rows = container.querySelectorAll('.structure-component-row');
    const selectedComponents = [];

    rows.forEach((row, index) => {
        const hiddenInput = row.querySelector('.component-select-value');
        const calcTypeSelect = row.querySelector('.calc-type-select');
        const percentageInput = row.querySelector('.percentage-value');
        const fixedInput = row.querySelector('.fixed-value');

        const componentId = hiddenInput?.value;
        if (!componentId) return; // Skip if no component selected

        const calcType = calcTypeSelect?.value || 'percentage';
        const value = calcType === 'percentage'
            ? parseFloat(percentageInput?.value) || 0
            : parseFloat(fixedInput?.value) || 0;

        if (value > 0) {
            selectedComponents.push({
                component_id: componentId,
                calculation_type: calcType,
                calculation_base: 'ctc',  // v3.0.42: Ensure calculation_base is set for percentage type
                percentage: calcType === 'percentage' ? value : null,  // v3.0.42: Fixed field name from percentage_of_basic to percentage
                fixed_amount: calcType === 'fixed' ? value : null,
                display_order: index + 1
            });
        }
    });

    if (selectedComponents.length === 0) {
        showToast('Please add at least one component with a value', 'error');
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

    // Use formatDateLocal to avoid timezone issues (toISOString converts to UTC, shifting dates for non-UTC timezones)
    const now = new Date();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const periodStart = await Prompt.show({
        title: 'Period Start Date',
        message: 'Select the period start date:',
        defaultValue: formatDateLocal(now.getFullYear(), now.getMonth() + 1, 1),
        placeholder: 'DD-MM-YYYY',
        type: 'date'
    });

    if (!periodStart) {
        return;
    }

    const periodEnd = await Prompt.show({
        title: 'Period End Date',
        message: 'Select the period end date:',
        defaultValue: formatDateLocal(now.getFullYear(), now.getMonth() + 1, lastDayOfMonth),
        placeholder: 'DD-MM-YYYY',
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

        // Build compact styled HTML breakdown
        // Component breakdown - Backend sends aggregated_earnings/aggregated_deductions
        const earnings = breakdown.aggregated_earnings || breakdown.component_breakdowns?.filter(c => c.component_type === 'earning') || [];
        const deductions = breakdown.aggregated_deductions || breakdown.component_breakdowns?.filter(c => c.component_type === 'deduction') || [];
        const employerContributions = breakdown.aggregated_employer_contributions || [];

        // v3.0.53: Show ALL earnings including negative adjustments (like CTC-BAL)
        // This ensures the math adds up correctly: sum of earnings = gross
        // Negative components (auto-balance) are shown with different styling
        const activeEarnings = earnings.filter(e => (e.total_amount || e.prorated_amount || 0) !== 0);
        const activeDeductions = deductions; // Show all deductions including zero for statutory transparency

        // Calculate sum of displayed earnings to detect if there's a discrepancy with gross
        const sumDisplayedEarnings = activeEarnings.reduce((sum, e) => sum + (e.total_amount || e.prorated_amount || 0), 0);

        // v3.0.18: COUNTRY-AGNOSTIC - Use currency symbol from backend response, not hardcoded
        const currencySymbol = breakdown.currency_symbol || '₹'; // Fallback to ₹ only if not provided
        const currencyCode = breakdown.currency_code || 'INR';

        // Use locale based on currency code for proper number formatting
        const localeMap = { 'INR': 'en-IN', 'USD': 'en-US', 'GBP': 'en-GB', 'AED': 'ar-AE', 'IDR': 'id-ID', 'MVR': 'dv-MV' };
        const locale = localeMap[currencyCode] || 'en-IN';
        const formatAmt = (amt) => amt.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

        const totalGross = breakdown.total_gross || 0;
        const totalDeductions = breakdown.total_deductions || 0;
        const netPay = breakdown.total_net || breakdown.net_pay || 0;

        let htmlContent = `
            <style>
                .sp-container { font-size: 13px; }
                .sp-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 12px; }
                .sp-header-item { text-align: center; }
                .sp-header-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
                .sp-header-value { font-size: 14px; font-weight: 600; color: var(--text-primary); }
                .sp-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
                .sp-column { background: var(--bg-secondary); border-radius: 6px; overflow: hidden; }
                .sp-column-header { padding: 6px 10px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
                .sp-earn-header { background: color-mix(in srgb, var(--color-success) 12%, transparent); color: var(--color-success); }
                .sp-ded-header { background: color-mix(in srgb, var(--color-danger) 12%, transparent); color: var(--color-danger); }
                .sp-column-body { padding: 6px 0; max-height: 150px; overflow-y: auto; }
                .sp-row { display: flex; justify-content: space-between; padding: 3px 10px; font-size: 12px; }
                .sp-row:hover { background: var(--bg-hover); }
                .sp-row-name { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
                .sp-row-amt { font-weight: 500; font-variant-numeric: tabular-nums; margin-left: 8px; flex-shrink: 0; }
                .sp-row-amt.earn { color: var(--color-success); }
                .sp-row-amt.ded { color: var(--color-danger); }
                .sp-row-zero { opacity: 0.5; }
                .sp-total-row { border-top: 1px solid var(--border-secondary); padding-top: 6px; margin-top: 4px; font-weight: 600; }
                .sp-summary { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 8px; padding: 8px; background: var(--bg-tertiary); border-radius: 8px; }
                .sp-summary-item { text-align: center; padding: 10px 8px; border-radius: 6px; }
                .sp-summary-label { font-size: 10px; opacity: 0.85; text-transform: uppercase; letter-spacing: 0.5px; }
                .sp-summary-value { font-size: 15px; font-weight: 700; margin-top: 2px; }
                .sp-summary-gross { background: var(--color-success); color: var(--text-inverse); }
                .sp-summary-ded { background: var(--color-danger); color: var(--text-inverse); }
                .sp-summary-net { background: var(--color-info); color: var(--text-inverse); }
                .sp-summary-net .sp-summary-value { font-size: 18px; }
                .sp-employer { margin-top: 8px; padding: 8px 10px; background: var(--bg-tertiary); border-radius: 6px; font-size: 11px; }
                .sp-employer-title { font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
                .sp-employer-row { display: flex; justify-content: space-between; color: var(--text-tertiary); }
            </style>
            <div class="sp-container">
                <div class="sp-header">
                    <div class="sp-header-item">
                        <div class="sp-header-label">CTC (Annual)</div>
                        <div class="sp-header-value">${currencySymbol} ${formatAmt(ctc)}</div>
                    </div>
                    <div class="sp-header-item">
                        <div class="sp-header-label">Period</div>
                        <div class="sp-header-value">${formatDate(periodStart).split(' ').slice(0,2).join(' ')} - ${formatDate(periodEnd).split(' ').slice(0,2).join(' ')}</div>
                    </div>
                    <div class="sp-header-item">
                        <div class="sp-header-label">Days</div>
                        <div class="sp-header-value">${breakdown.total_working_days || 'N/A'}</div>
                    </div>
                </div>

                <div class="sp-columns">
                    <div class="sp-column">
                        <div class="sp-column-header sp-earn-header">Earnings</div>
                        <div class="sp-column-body">
        `;

        // Earnings column - v3.0.53: Handle negative amounts (CTC-BAL, adjustments)
        activeEarnings.forEach(cb => {
            const amount = cb.total_amount || cb.prorated_amount || 0;
            const isNegative = amount < 0;
            const displayAmount = Math.abs(amount);
            const amtClass = isNegative ? 'ded' : 'earn';  // Use red for negative, green for positive
            const prefix = isNegative ? '−' : '+';  // Minus sign for negative
            htmlContent += `<div class="sp-row"><span class="sp-row-name" title="${cb.component_name}">${cb.component_name}</span><span class="sp-row-amt ${amtClass}">${prefix}${currencySymbol} ${formatAmt(displayAmount)}</span></div>`;
        });

        // v3.0.53: If there's a discrepancy between displayed earnings and gross, show explanation
        // This happens when CTC-BAL adjustment isn't fully captured in earnings array
        const earningsDiscrepancy = sumDisplayedEarnings - totalGross;
        if (Math.abs(earningsDiscrepancy) > 0.5) {  // Allow small rounding tolerance
            const adjustmentLabel = earningsDiscrepancy > 0 ? 'CTC Balance Adjustment' : 'Additional Allowance';
            const adjAmount = Math.abs(earningsDiscrepancy);
            const adjClass = earningsDiscrepancy > 0 ? 'ded' : 'earn';
            const adjPrefix = earningsDiscrepancy > 0 ? '−' : '+';
            htmlContent += `<div class="sp-row" style="font-style: italic; opacity: 0.85;"><span class="sp-row-name" title="Auto-calculated to match CTC allocation">${adjustmentLabel}</span><span class="sp-row-amt ${adjClass}">${adjPrefix}${currencySymbol} ${formatAmt(adjAmount)}</span></div>`;
        }

        htmlContent += `
                            <div class="sp-row sp-total-row"><span>Gross</span><span class="sp-row-amt earn">${currencySymbol} ${formatAmt(totalGross)}</span></div>
                        </div>
                    </div>
                    <div class="sp-column">
                        <div class="sp-column-header sp-ded-header">Deductions</div>
                        <div class="sp-column-body">
        `;

        // Deductions column
        activeDeductions.forEach(cb => {
            const amount = cb.total_amount || cb.prorated_amount || 0;
            const zeroClass = amount === 0 ? ' sp-row-zero' : '';
            htmlContent += `<div class="sp-row${zeroClass}"><span class="sp-row-name" title="${cb.component_name}">${cb.component_name}</span><span class="sp-row-amt ded">${amount > 0 ? '−' : ''}${currencySymbol} ${formatAmt(amount)}</span></div>`;
        });
        htmlContent += `
                            <div class="sp-row sp-total-row"><span>Total</span><span class="sp-row-amt ded">−${currencySymbol} ${formatAmt(totalDeductions)}</span></div>
                        </div>
                    </div>
                </div>

                <div class="sp-summary">
                    <div class="sp-summary-item sp-summary-gross">
                        <div class="sp-summary-label">Gross</div>
                        <div class="sp-summary-value">${currencySymbol} ${formatAmt(totalGross)}</div>
                    </div>
                    <div class="sp-summary-item sp-summary-ded">
                        <div class="sp-summary-label">Deductions</div>
                        <div class="sp-summary-value">−${currencySymbol} ${formatAmt(totalDeductions)}</div>
                    </div>
                    <div class="sp-summary-item sp-summary-net">
                        <div class="sp-summary-label">Net Pay</div>
                        <div class="sp-summary-value">${currencySymbol} ${formatAmt(netPay)}</div>
                    </div>
                </div>
        `;

        // Employer contributions (collapsed section)
        if (employerContributions.length > 0) {
            const activeEmployer = employerContributions.filter(e => (e.total_amount || e.prorated_amount || 0) > 0);
            if (activeEmployer.length > 0) {
                const totalEmployer = activeEmployer.reduce((sum, e) => sum + (e.total_amount || e.prorated_amount || 0), 0);
                htmlContent += `<div class="sp-employer"><div class="sp-employer-title">Employer Contributions (${currencySymbol} ${formatAmt(totalEmployer)})</div>`;
                activeEmployer.forEach(cb => {
                    const amount = cb.total_amount || cb.prorated_amount || 0;
                    htmlContent += `<div class="sp-employer-row"><span>${cb.component_name}</span><span>${currencySymbol} ${formatAmt(amount)}</span></div>`;
                });
                htmlContent += `</div>`;
            }
        }

        htmlContent += `</div>`;

        await InfoModal.show({
            title: 'Salary Preview',
            message: htmlContent,
            type: 'success',
            html: true,
            maxWidth: '720px'
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
 * v3.0.43: Calculate structure version arrears
 * This triggers backend calculation of arrears for the current version
 */
async function calculateVersionArrears() {
    try {
        // Get current version ID - use the most recent version (V2, V3, etc.)
        const versionId = structureVersions && structureVersions.length > 0
            ? structureVersions[0]?.id
            : null;

        if (!versionId) {
            showToast('No version available to calculate arrears', 'warning');
            return;
        }

        if (!isValidGuid(versionId)) {
            showToast('Invalid version ID format', 'error');
            return;
        }

        showLoading();

        // Call the calculate arrears API
        const result = await api.calculateVersionArrears(versionId);

        hideLoading();

        if (result.arrears_records && result.arrears_records.length > 0) {
            showToast(`Calculated ${result.arrears_records.length} arrears record(s) totaling ${formatCurrency(result.total_arrears)}`, 'success');
            // Refresh the arrears table to show newly calculated arrears
            await refreshArrears();
        } else if (result.warnings && result.warnings.length > 0) {
            showToast(result.warnings[0], 'info');
        } else {
            showToast('No arrears to calculate. Ensure there are processed payslips affected by this version change.', 'info');
        }
    } catch (error) {
        hideLoading();
        console.error('Error calculating arrears:', error);
        const errorMessage = error.error || error.message || 'Failed to calculate arrears';
        showToast(errorMessage, 'error');
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
 * v3.0.33: Country-agnostic currency using currency from arrears data
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

    // v3.0.33: Use currency from first arrears record (backend enriches with currency from country config)
    const firstArrears = currentArrearsList[0];
    const currCode = firstArrears?.currency_code || null;
    const currSymbol = firstArrears?.currency_symbol || null;

    document.getElementById('arrearsEmployeeCount').textContent = uniqueEmployees.size;
    document.getElementById('arrearsTotalAmount').textContent = formatCurrency(totalAmount, currCode, currSymbol);
    document.getElementById('arrearsPendingCount').textContent = pendingCount;
}

/**
 * Update modal arrears table (Version History modal)
 * v3.0.33: Country-agnostic currency using currency from arrears data
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

    // v3.0.33: Country-agnostic currency using currency from arrears data
    tbody.innerHTML = currentArrearsList.map(a => {
        const isPending = a.status === 'pending';
        const statusBadge = getArrearsStatusBadge(a.status);
        // v3.0.33: Use currency from individual arrears object
        const currCode = a.currency_code || null;
        const currSymbol = a.currency_symbol || null;
        const fmtCurr = (amt) => formatCurrency(amt, currCode, currSymbol);
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
            <td>${fmtCurr(a.old_gross || 0)}</td>
            <td>${fmtCurr(a.new_gross || 0)}</td>
            <td class="${a.arrears_amount > 0 ? 'text-success' : 'text-danger'}">
                <strong>${fmtCurr(a.arrears_amount || 0)}</strong>
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

        // v3.0.26: Country-agnostic currency symbol
        const { symbol: currSymbol } = getSelectedCurrency();

        // Update preview UI
        document.getElementById('bulkPreviewSection').style.display = 'block';
        document.getElementById('bulkMatchedCount').textContent = bulkPreviewResult.total_employees_matched || 0;
        document.getElementById('bulkToAssignCount').textContent = bulkPreviewResult.employees_to_assign || 0;
        document.getElementById('bulkEstArrears').textContent =
            `${currSymbol}${(bulkPreviewResult.estimated_arrears_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

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
                    <td>${currSymbol}${(e.current_ctc || 0).toLocaleString('en-IN')}</td>
                    <td>${e.status !== 'skipped' ?
                        `${currSymbol}${(e.arrears_amount || e.estimated_arrears || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` :
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

        // v3.0.26: Country-agnostic currency symbol for version comparison
        const { symbol: currSymbol } = getSelectedCurrency();

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
                        ${c.new_values?.fixed_amount ? `${currSymbol}${c.new_values.fixed_amount}` : ''}
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

        // v3.0.31: Filter by office if selected
        const officeFilter = document.getElementById('arrearsOfficeFilter')?.value || '';
        if (officeFilter) {
            filteredArrearsData = arrearsData.filter(arr => arr.office_id === officeFilter);
        } else {
            filteredArrearsData = [...arrearsData];
        }

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
 * v3.0.33: Country-agnostic currency using currency from arrears data
 */
function updateArrearsStats() {
    const totalCount = arrearsData.length;
    const pendingCount = arrearsData.filter(a => a.status === 'pending').length;
    const totalAmount = arrearsData.reduce((sum, a) => sum + (a.arrears_amount || 0), 0);
    const uniqueEmployees = new Set(arrearsData.map(a => a.employee_id)).size;

    // v3.0.33: Use currency from first arrears record, fallback to selected office's currency
    const firstArrears = arrearsData[0];
    let currCode = firstArrears?.currency_code;
    let currSymbol = firstArrears?.currency_symbol;

    // Fallback to selected office currency when no arrears data
    if (!currCode || !currSymbol) {
        const selectedOfficeId = document.getElementById('arrearsOfficeFilter')?.value || null;
        const officeCurrency = getCurrencyFromOfficeId(selectedOfficeId);
        currCode = currCode || officeCurrency.code;
        currSymbol = currSymbol || officeCurrency.symbol;
    }

    document.getElementById('totalArrearsCount').textContent = totalCount;
    document.getElementById('pendingArrearsCount').textContent = pendingCount;
    document.getElementById('totalArrearsAmount').textContent = formatCurrency(totalAmount, currCode, currSymbol);
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
    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        arrearsPagination = createTablePagination('arrearsPagination', {
            containerSelector: '#arrearsPagination',
            data: filteredArrearsData,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderArrearsRows(paginatedData);
            }
        });
    } else {
        renderArrearsRows(filteredArrearsData);
    }
}

function renderArrearsRows(arrearsItems) {
    const tbody = document.getElementById('arrearsTable');
    if (!tbody) return;

    if (!arrearsItems || arrearsItems.length === 0) {
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

    // v3.0.33: Use currency from arrears object (enriched by backend)
    tbody.innerHTML = arrearsItems.map(arr => {
        const currCode = arr.currency_code || null;
        const currSymbol = arr.currency_symbol || null;
        return `
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
            <td class="text-right">${formatCurrency(arr.old_gross, currCode, currSymbol)}</td>
            <td class="text-right">${formatCurrency(arr.new_gross, currCode, currSymbol)}</td>
            <td class="text-right text-success-dark"><strong>${formatCurrency(arr.arrears_amount, currCode, currSymbol)}</strong></td>
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
        </tr>`;
    }).join('');
}

/**
 * View arrears details in modal
 * v3.0.33: Country-agnostic currency using currency from arrears data
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

        // v3.0.33: Use currency from arrears object
        const currCode = arrears.currency_code || null;
        const currSymbol = arrears.currency_symbol || null;
        const fmtCurr = (amt) => formatCurrency(amt, currCode, currSymbol);

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
                        <span>${fmtCurr(arrears.old_gross)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span>New Gross Salary</span>
                        <span>${fmtCurr(arrears.new_gross)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span>Old Deductions</span>
                        <span>${fmtCurr(arrears.old_deductions || 0)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span>New Deductions</span>
                        <span>${fmtCurr(arrears.new_deductions || 0)}</span>
                    </div>
                    <hr style="border: none; border-top: 1px solid var(--gray-300); margin: 10px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 600; color: var(--color-success);">
                        <span>Arrears Amount</span>
                        <span>${fmtCurr(arrears.arrears_amount)}</span>
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
 * v3.0.45: Toggle the Arrears Visual Guide section
 * Stores preference in localStorage so it stays collapsed/expanded across sessions
 */
function toggleArrearsGuide() {
    const section = document.getElementById('arrearsGuideSection');
    const icon = document.getElementById('arrearsGuideToggleIcon');

    if (!section) return;

    const isCollapsed = section.classList.toggle('collapsed');

    // Update icon rotation
    if (icon) {
        icon.innerHTML = isCollapsed
            ? '<polyline points="6 15 12 9 18 15"></polyline>'  // Points up when collapsed
            : '<polyline points="6 9 12 15 18 9"></polyline>';  // Points down when expanded
    }

    // Store preference
    localStorage.setItem('arrearsGuideCollapsed', isCollapsed ? 'true' : 'false');
}

/**
 * v3.0.45: Initialize the Arrears Guide section state from localStorage
 */
function initArrearsGuide() {
    const section = document.getElementById('arrearsGuideSection');
    const icon = document.getElementById('arrearsGuideToggleIcon');

    if (!section) return;

    // Default to collapsed after first view
    const wasCollapsed = localStorage.getItem('arrearsGuideCollapsed');

    // If user has seen it before and collapsed it, keep it collapsed
    if (wasCollapsed === 'true') {
        section.classList.add('collapsed');
        if (icon) {
            icon.innerHTML = '<polyline points="6 15 12 9 18 15"></polyline>';
        }
    }
}

/**
 * Switch between Version Arrears and CTC Revision Arrears sub-tabs
 */
function switchArrearsSubtab(subtabId) {
    // Update sub-tab buttons (scoped to arrears tab)
    document.querySelectorAll('#arrears .sub-tab-btn').forEach(btn => {
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

        // v3.0.45: Also load pending calculations section
        loadPendingCtcRevisions();

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
 * v3.0.45: Load salary revisions that need arrears calculation
 * Shows a section at the top of CTC Arrears tab for revisions that have processed payslips
 * but no arrears calculated yet
 */
let pendingCtcRevisions = [];
let pendingCalcExpanded = true;

async function loadPendingCtcRevisions() {
    try {
        const response = await api.request('/hrms/payroll/salary-revisions/pending-arrears');
        pendingCtcRevisions = response?.revisions || [];
        renderPendingCalculations();
    } catch (error) {
        console.error('Error loading pending CTC revisions:', error);
        pendingCtcRevisions = [];
        renderPendingCalculations();
    }
}

/**
 * v3.0.45: Render the pending calculations section
 */
function renderPendingCalculations() {
    const section = document.getElementById('pendingCalculationsSection');
    const countBadge = document.getElementById('pendingCalcCount');
    const listContainer = document.getElementById('pendingCalculationsList');

    if (!section || !listContainer) return;

    const count = pendingCtcRevisions.length;
    countBadge.textContent = count;

    if (count === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Render each pending revision
    listContainer.innerHTML = pendingCtcRevisions.map(rev => {
        const currencySymbol = rev.currency_symbol || '₹';
        const oldCtc = rev.old_ctc ? formatCurrency(rev.old_ctc, rev.currency_code, currencySymbol) : 'N/A';
        const newCtc = formatCurrency(rev.new_ctc, rev.currency_code, currencySymbol);
        const affectedCount = rev.affected_periods?.length || 0;
        const effectiveDate = rev.effective_date ? new Date(rev.effective_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';

        return `
        <div class="pending-calc-card" data-revision-id="${rev.revision_id}">
            <div class="pending-calc-info">
                <div class="pending-calc-employee">
                    ${escapeHtml(rev.employee_name || 'Unknown')}
                    <span class="employee-code">${escapeHtml(rev.employee_code || '')}</span>
                </div>
                <div class="pending-calc-details">
                    <span class="revision-type-badge ${rev.revision_type}">${formatRevisionType(rev.revision_type)}</span>
                    <span class="ctc-change">
                        ${oldCtc}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                        ${newCtc}
                    </span>
                    <span class="effective-date">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        ${effectiveDate}
                    </span>
                    <span class="affected-periods">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        ${affectedCount} payslip${affectedCount !== 1 ? 's' : ''} affected
                    </span>
                </div>
            </div>
            <div class="pending-calc-actions">
                <button class="btn-calculate" onclick="calculateCtcArrearsForRevision('${rev.revision_id}', '${rev.employee_id}', this)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                        <line x1="8" y1="6" x2="16" y2="6"></line>
                        <line x1="8" y1="10" x2="16" y2="10"></line>
                        <line x1="8" y1="14" x2="12" y2="14"></line>
                    </svg>
                    Calculate Arrears
                </button>
            </div>
        </div>
        `;
    }).join('');
}

/**
 * v3.0.45: Toggle visibility of pending calculations content
 */
function togglePendingCalculations() {
    const content = document.getElementById('pendingCalculationsContent');
    const icon = document.getElementById('pendingCalcToggleIcon');

    if (!content || !icon) return;

    pendingCalcExpanded = !pendingCalcExpanded;
    content.style.display = pendingCalcExpanded ? 'block' : 'none';
    icon.innerHTML = pendingCalcExpanded
        ? '<polyline points="6 9 12 15 18 9"></polyline>'
        : '<polyline points="6 15 12 9 18 15"></polyline>';
}

/**
 * v3.0.45: Calculate arrears for a specific CTC revision
 * @param {string} revisionId - The salary revision history ID
 * @param {string} employeeId - The employee ID
 * @param {HTMLElement} button - The button element for loading state
 */
async function calculateCtcArrearsForRevision(revisionId, employeeId, button) {
    try {
        // Show loading state
        const originalContent = button.innerHTML;
        button.classList.add('loading');
        button.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="2" x2="12" y2="6"></line>
                <line x1="12" y1="18" x2="12" y2="22"></line>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                <line x1="2" y1="12" x2="6" y2="12"></line>
                <line x1="18" y1="12" x2="22" y2="12"></line>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
            </svg>
            Calculating...
        `;
        button.disabled = true;

        // Call the API to calculate arrears (uses revisionId, not employeeId)
        const response = await api.request(`/hrms/payroll/salary-revisions/${revisionId}/recalculate-arrears`, {
            method: 'POST'
        });

        if (response?.success || response?.arrears_count !== undefined) {
            showToast(`Arrears calculated successfully: ${response.arrears_count || 0} payslip(s) processed`, 'success');

            // Refresh both pending and calculated arrears
            await loadPendingCtcRevisions();
            await loadCtcRevisionArrears();
        } else {
            throw new Error(response?.message || 'Failed to calculate arrears');
        }

    } catch (error) {
        console.error('Error calculating arrears:', error);
        showToast(error.message || 'Failed to calculate arrears', 'error');

        // Reset button state
        button.classList.remove('loading');
        button.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                <line x1="8" y1="6" x2="16" y2="6"></line>
                <line x1="8" y1="10" x2="16" y2="10"></line>
                <line x1="8" y1="14" x2="12" y2="14"></line>
            </svg>
            Calculate Arrears
        `;
        button.disabled = false;
    }
}

/**
 * Update CTC arrears summary statistics
 * v3.0.33: Country-agnostic currency using currency from arrears data
 */
function updateCtcArrearsStats() {
    const totalCount = ctcArrearsData.length;
    const pendingCount = ctcArrearsData.filter(a => a.status === 'pending').length;
    const totalAmount = ctcArrearsData.reduce((sum, a) => sum + (a.arrears_amount || 0), 0);
    const uniqueEmployees = new Set(ctcArrearsData.map(a => a.employee_id)).size;

    // v3.0.33: Use currency from first arrears record, fallback to selected office's currency
    const firstArrears = ctcArrearsData[0];
    let currCode = firstArrears?.currency_code;
    let currSymbol = firstArrears?.currency_symbol;

    // Fallback to selected office currency when no arrears data
    if (!currCode || !currSymbol) {
        const selectedOfficeId = document.getElementById('ctcArrearsOfficeFilter')?.value || null;
        const officeCurrency = getCurrencyFromOfficeId(selectedOfficeId);
        currCode = currCode || officeCurrency.code;
        currSymbol = currSymbol || officeCurrency.symbol;
    }

    document.getElementById('totalCtcArrearsCount').textContent = totalCount;
    document.getElementById('pendingCtcArrearsCount').textContent = pendingCount;
    document.getElementById('totalCtcArrearsAmount').textContent = formatCurrency(totalAmount, currCode, currSymbol);
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

    // v3.0.33: Country-agnostic currency using currency from arrears data
    tbody.innerHTML = filteredCtcArrearsData.map(arr => {
        const isPending = arr.status === 'pending';
        const revisionType = arr.revision_type || 'adjustment';
        // v3.0.33: Use currency from arrears object
        const currCode = arr.currency_code || null;
        const currSymbol = arr.currency_symbol || null;
        const fmtCurr = (amt) => formatCurrency(amt, currCode, currSymbol);

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
            <td class="text-right">${fmtCurr(arr.old_ctc)}</td>
            <td class="text-right">${fmtCurr(arr.new_ctc)}</td>
            <td class="text-right ${arr.arrears_amount > 0 ? 'arrears-positive' : 'arrears-negative'}">
                ${fmtCurr(arr.arrears_amount)}
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

        // v3.0.33: Use currency from arrears object (enriched by backend)
        const currCode = arrears.currency_code || null;
        const currSymbol = arrears.currency_symbol || null;
        const fmtCurr = (amt) => formatCurrency(amt, currCode, currSymbol);

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
                        <div class="value">${fmtCurr(arrears.old_ctc)}</div>
                        <div class="label">Old CTC</div>
                    </div>
                    <div class="ctc-summary-card">
                        <div class="value">${fmtCurr(arrears.new_ctc)}</div>
                        <div class="label">New CTC</div>
                    </div>
                    <div class="ctc-summary-card">
                        <div class="value">${getMonthName(arrears.payroll_month)} ${arrears.payroll_year}</div>
                        <div class="label">Payroll Period</div>
                    </div>
                    <div class="ctc-summary-card highlight">
                        <div class="value">${fmtCurr(arrears.arrears_amount)}</div>
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
                            <span style="font-size: 12px; color: var(--text-secondary); display: block;">Proration Factor</span>
                            <strong style="font-size: 14px;">${(arrears.proration_factor * 100).toFixed(0)}%</strong>
                        </div>
                        <div>
                            <span style="font-size: 12px; color: var(--text-secondary); display: block;">Days Affected</span>
                            <strong style="font-size: 14px;">${arrears.days_affected || arrears.days_in_period || '-'} / ${arrears.days_in_period || '-'}</strong>
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
                                        <td class="text-right">${fmtCurr(item.old_amount)}</td>
                                        <td class="text-right">${fmtCurr(item.new_amount)}</td>
                                        <td class="text-right ${item.arrears_amount > 0 ? 'arrears-positive' : 'arrears-negative'}">${fmtCurr(item.arrears_amount)}</td>
                                    </tr>
                                `).join('')}
                                <tr class="total-row">
                                    <td colspan="4"><strong>Total Arrears</strong></td>
                                    <td class="text-right arrears-positive"><strong>${fmtCurr(arrears.arrears_amount)}</strong></td>
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
    const totalAmount = selectedArrears.reduce((sum, a) => sum + (a.arrears_amount || 0), 0);
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
    const activeTypes = vdTypes.filter(t => t.is_active);

    // Format options for searchable dropdowns
    const filterOptions = [
        { value: '', label: 'All Types' },
        ...activeTypes.map(t => ({ value: t.id, label: t.type_name }))
    ];

    const enrollmentOptions = [
        { value: '', label: 'Select VD Type' },
        ...activeTypes.map(t => ({ value: t.id, label: t.type_name }))
    ];

    // Update filter dropdown (searchable)
    const filterDropdown = searchableDropdownInstances.get('vdEnrollmentType');
    if (filterDropdown) {
        filterDropdown.setOptions(filterOptions);
    }

    // Update enrollment modal dropdown (searchable)
    const enrollmentDropdown = searchableDropdownInstances.get('vdEnrollmentDeductionType');
    if (enrollmentDropdown) {
        enrollmentDropdown.setOptions(enrollmentOptions);
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

        // v3.0.31: Filter by office if selected
        const officeFilter = document.getElementById('vdOfficeFilter')?.value;
        if (officeFilter) {
            vdEnrollments = allVDEnrollments.filter(e => e.office_id === officeFilter);
        } else {
            vdEnrollments = [...allVDEnrollments];
        }

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
    const searchTerm = document.getElementById('vdEnrollmentSearch')?.value.toLowerCase() || '';

    let filtered = vdEnrollments.filter(e => {
        if (!searchTerm) return true;
        const employeeName = `${e.employee_first_name || ''} ${e.employee_last_name || ''}`.toLowerCase();
        const employeeCode = (e.employee_code || '').toLowerCase();
        return employeeName.includes(searchTerm) || employeeCode.includes(searchTerm);
    });

    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        vdEnrollmentsPagination = createTablePagination('vdEnrollmentsPagination', {
            containerSelector: '#vdEnrollmentsPagination',
            data: filtered,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderVDEnrollmentsRows(paginatedData);
            }
        });
    } else {
        renderVDEnrollmentsRows(filtered);
    }
}

function renderVDEnrollmentsRows(filtered) {
    const tbody = document.getElementById('vdEnrollmentsTable');
    if (!tbody) return;

    if (!filtered || filtered.length === 0) {
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

    // Show Edit button for editable enrollments
    // - pending, approved, or active enrollments can be edited
    // - opted_out and rejected cannot be edited
    // - Backend validates if already processed in finalized payroll
    const canEdit = ['pending', 'approved', 'active'].includes(enrollment.status);
    if (canEdit) {
        actions += `
            <button class="btn btn-icon btn-ghost text-primary" onclick="showEditVDModal('${enrollment.id}')" title="Edit Amount">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>`;
    }

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

// Show edit modal for VD amount update
function showEditVDModal(enrollmentId) {
    const enrollment = allVDEnrollments.find(e => e.id === enrollmentId);
    if (!enrollment) {
        showToast('Enrollment not found', 'error');
        return;
    }

    const employeeName = `${enrollment.employee_first_name || ''} ${enrollment.employee_last_name || ''}`.trim();

    document.getElementById('vdEditId').value = enrollmentId;
    document.getElementById('vdEditTypeName').textContent = enrollment.deduction_type_name || '-';
    document.getElementById('vdEditEmployeeName').textContent = employeeName || '-';
    document.getElementById('vdEditCurrentAmount').textContent = formatCurrency(enrollment.amount || 0);
    document.getElementById('vdEditNewAmount').value = enrollment.amount || '';
    document.getElementById('vdEditEffectiveDate').value = '';
    document.getElementById('vdEditReason').value = '';
    document.getElementById('vdEditModal').classList.add('active');
}

// Close edit modal
function closeVDEditModal() {
    document.getElementById('vdEditModal').classList.remove('active');
}

// Save VD amount update
async function saveVDAmountUpdate() {
    const enrollmentId = document.getElementById('vdEditId').value;
    const newAmount = parseFloat(document.getElementById('vdEditNewAmount').value);
    const effectiveDate = document.getElementById('vdEditEffectiveDate').value;
    const reason = document.getElementById('vdEditReason').value.trim();

    if (!enrollmentId) {
        showToast('Invalid enrollment', 'error');
        return;
    }

    if (isNaN(newAmount) || newAmount < 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    try {
        showLoading();

        const requestBody = {
            new_amount: newAmount
        };

        if (effectiveDate) {
            requestBody.effective_date = effectiveDate;
        }

        if (reason) {
            requestBody.reason = reason;
        }

        const response = await api.request(`/hrms/voluntary-deductions/${enrollmentId}/amount`, {
            method: 'PUT',
            body: JSON.stringify(requestBody),
            headers: { 'Content-Type': 'application/json' }
        });

        showToast(response.message || 'Deduction amount updated successfully', 'success');
        closeVDEditModal();
        await loadVDEnrollments();
    } catch (error) {
        console.error('Error updating VD amount:', error);
        showToast(error.message || 'Failed to update deduction amount', 'error');
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

        // Load ALL adjustments (pending, approved, applied, rejected)
        const allAdjustmentsResponse = await api.request('/hrms/payroll-processing/adjustments');

        // Get all adjustments
        adjustments = Array.isArray(allAdjustmentsResponse) ? allAdjustmentsResponse : [];

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

    const reimbursementItems = adjustments
        .filter(a => a.adjustment_type === 'reimbursement' && (a.status === 'approved' || a.status === 'applied'));
    const totalReimbursements = reimbursementItems.reduce((sum, a) => sum + (a.amount || 0), 0);

    const bonusItems = adjustments
        .filter(a => a.adjustment_type === 'bonus' && (a.status === 'approved' || a.status === 'applied'));
    const totalBonuses = bonusItems.reduce((sum, a) => sum + (a.amount || 0), 0);

    // v3.0.55: Use backend-provided currency from adjustments (country-agnostic)
    // Get representative currency from first adjustment with currency info
    const firstWithCurrency = adjustments.find(a => a.currency_symbol);
    const currCode = firstWithCurrency?.currency_code || '';
    const currSymbol = firstWithCurrency?.currency_symbol || '';

    document.getElementById('pendingAdjustmentsCount').textContent = pendingCount;
    document.getElementById('approvedAdjustmentsCount').textContent = approvedThisMonth;
    document.getElementById('totalReimbursements').textContent = formatCurrency(totalReimbursements, currCode, currSymbol);
    document.getElementById('totalBonuses').textContent = formatCurrency(totalBonuses, currCode, currSymbol);
}

// Render adjustments table
function renderAdjustmentsTable() {
    // Apply filters
    const search = (document.getElementById('adjustmentSearch')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('adjustmentStatusFilter')?.value || '';
    const typeFilter = document.getElementById('adjustmentTypeFilter')?.value || '';
    // v3.0.31: Office filter
    const officeFilter = document.getElementById('adjustmentOfficeFilter')?.value || '';

    let filtered = adjustments.filter(adj => {
        // v3.0.31: Office filter
        if (officeFilter && adj.office_id !== officeFilter) return false;

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

    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        adjustmentsPagination = createTablePagination('adjustmentsPagination', {
            containerSelector: '#adjustmentsPagination',
            data: filtered,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderAdjustmentsRows(paginatedData);
            }
        });
    } else {
        renderAdjustmentsRows(filtered);
    }
}

function renderAdjustmentsRows(filtered) {
    const tbody = document.getElementById('adjustmentsTableBody');
    if (!tbody) return;

    if (!filtered || filtered.length === 0) {
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

    // v3.0.55: Removed hardcoded currency - now using backend-provided currency_symbol per adjustment
    // Each adjustment is enriched with currency from employee's office → country config

    tbody.innerHTML = filtered.map(adj => {
        const statusBadge = getAdjustmentStatusBadge(adj.status);
        const typeBadge = getAdjustmentTypeBadge(adj.adjustment_type);
        const period = `${getMonthName(adj.effective_month)} ${adj.effective_year}`;

        // v3.0.54: Generate initials from employee name for avatar
        const fullName = adj.employee_name || '-';
        const nameParts = fullName.split(' ').filter(p => p.length > 0);
        const initials = nameParts.length >= 2
            ? (nameParts[0].charAt(0) + nameParts[nameParts.length - 1].charAt(0)).toUpperCase()
            : (nameParts[0] || '-').substring(0, 2).toUpperCase();

        // Avatar: show profile photo if available, otherwise show initials
        const avatarHtml = adj.profile_photo_url
            ? `<img src="${escapeHtml(adj.profile_photo_url)}" alt="${escapeHtml(fullName)}" class="emp-avatar-xs-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
               <div class="emp-avatar-xs" style="display:none;">${initials}</div>`
            : `<div class="emp-avatar-xs">${initials}</div>`;

        // v3.0.55: Use backend-provided currency (country-agnostic)
        const currSymbol = adj.currency_symbol || '';
        const currCode = adj.currency_code || '';

        return `
            <tr>
                <td>
                    <div class="emp-cell-compact">
                        ${avatarHtml}
                        <span class="emp-name-inline">${escapeHtml(fullName)}</span>
                        <span class="emp-code-badge">${escapeHtml(adj.employee_code || '-')}</span>
                    </div>
                </td>
                <td>${typeBadge}</td>
                <td class="amount-cell ${isDeductionType(adj.adjustment_type) ? 'negative' : 'positive'}">
                    ${isDeductionType(adj.adjustment_type) ? '-' : '+'}${formatCurrency(adj.amount, currCode, currSymbol)}
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
    // v3.0.32: Also update stats when filter changes (for currency symbol update)
    updateAdjustmentStats();
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

        // v3.0.53: Show/hide receipt section for reimbursements with attached receipt
        const receiptRow = document.getElementById('viewAdjustmentReceiptRow');
        if (adj.receipt_s3_key && adj.receipt_file_name) {
            document.getElementById('viewAdjustmentReceiptName').textContent = adj.receipt_file_name;
            document.getElementById('viewAdjustmentReceiptBtn').setAttribute('data-adjustment-id', adj.id);
            receiptRow.style.display = '';
        } else {
            receiptRow.style.display = 'none';
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

/**
 * v3.0.53: Download/view reimbursement receipt
 * Gets presigned URL from backend and opens in new tab
 */
async function downloadAdjustmentReceipt() {
    try {
        const adjustmentId = document.getElementById('viewAdjustmentReceiptBtn')?.getAttribute('data-adjustment-id');
        if (!adjustmentId) {
            showToast('No receipt available', 'warning');
            return;
        }

        showLoading();

        // Get presigned download URL
        const result = await api.getReimbursementReceiptUrl(adjustmentId);

        if (result.url) {
            // Open receipt in new tab
            window.open(result.url, '_blank');
        } else {
            showToast('Receipt not found', 'error');
        }
    } catch (error) {
        console.error('Error downloading receipt:', error);
        showToast(error.message || 'Failed to download receipt', 'error');
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
        'salary-structures': 'Salary Structures',
        'employee-salaries': 'Employee Salaries',
        'payroll-drafts': 'Payroll Drafts',
        'finalized-runs': 'Finalized Runs',
        'all-payslips': 'All Payslips',
        'loans': 'Loans & Advances',
        'arrears': 'Arrears Management',
        'tax-configuration': 'Tax Configuration'
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
    summary: {},
    currency_code: null,
    currency_symbol: null
};

/**
 * Load salary reports data from API
 */
async function loadSalaryReports() {
    try {
        // Populate filter dropdowns first (if not already populated)
        await populateSalaryReportFilters();

        // Now get the selected values (first office will be selected by default)
        const officeId = document.getElementById('salaryReportOffice')?.value || '';
        const departmentId = document.getElementById('salaryReportDepartment')?.value || '';

        // Build query params - office_id is required
        let queryParams = [];
        if (officeId) queryParams.push(`office_id=${officeId}`);
        if (departmentId) queryParams.push(`department_id=${departmentId}`);
        const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

        // Fetch salary summary report
        const response = await fetch(`${CONFIG.hrmsApiBaseUrl}/payroll/reports/summary${queryString}`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load salary reports');
        }

        const data = await response.json();
        salaryReportData.summary = data;
        salaryReportData.employees = data.employees || [];
        salaryReportData.currency_code = data.currency_code || null;
        salaryReportData.currency_symbol = data.currency_symbol || null;

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
 * Load departments filtered by office ID
 */
async function loadDepartmentsForOffice(officeId) {
    const departmentSelect = document.getElementById('salaryReportDepartment');
    if (!departmentSelect) return;

    // Clear existing options except "All Departments"
    departmentSelect.innerHTML = '<option value="">All Departments</option>';

    if (!officeId) return;

    try {
        const deptsResp = await fetch(`${CONFIG.hrmsApiBaseUrl}/departments?office_id=${officeId}`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
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
        console.error('Error loading departments for office:', e);
    }
}

/**
 * Populate salary report filter dropdowns
 */
async function populateSalaryReportFilters() {
    const officeSelect = document.getElementById('salaryReportOffice');
    const departmentSelect = document.getElementById('salaryReportDepartment');

    // Only populate offices if empty (no options yet)
    if (officeSelect && officeSelect.options.length === 0) {
        try {
            const officesResp = await fetch(`${CONFIG.hrmsApiBaseUrl}/offices`, {
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });
            if (officesResp.ok) {
                const officesData = await officesResp.json();

                // Use HrmsOfficeSelection for auto-selection
                const selectedOfficeId = HrmsOfficeSelection.initializeSelection(officesData);

                // Build options using HrmsOfficeSelection (no "All" for filters)
                const options = HrmsOfficeSelection.buildOfficeOptions(officesData, { isFormDropdown: false });
                officeSelect.innerHTML = options.map(opt =>
                    `<option value="${opt.value}"${opt.value === selectedOfficeId ? ' selected' : ''}>${opt.label}</option>`
                ).join('');

                // Update SearchableDropdown instance if exists
                const dropdown = searchableDropdownInstances.get('salaryReportOffice');
                if (dropdown) {
                    dropdown.setOptions(options);
                    dropdown.setValue(selectedOfficeId);
                }

                // Load departments for the selected office
                if (selectedOfficeId) {
                    await loadDepartmentsForOffice(selectedOfficeId);
                }
            }
        } catch (e) {
            console.error('Error loading offices for salary report filter:', e);
        }

        // Add change listener for office - reload departments when office changes
        officeSelect?.addEventListener('change', async () => {
            HrmsOfficeSelection.setSelectedOfficeId(officeSelect.value);
            await loadDepartmentsForOffice(officeSelect.value);
            loadSalaryReports();
        });
    }

    // Add change listener for department
    departmentSelect?.addEventListener('change', loadSalaryReports);
}

/**
 * Update the summary cards with report data
 */
function updateSalaryReportSummary(data) {
    const currencyCode = salaryReportData.currency_code;
    const currencySymbol = salaryReportData.currency_symbol;

    document.getElementById('totalEmployeesWithSalary').textContent = data.employees_with_salary || 0;
    document.getElementById('employeesWithoutSalary').textContent = data.employees_without_salary || 0;
    document.getElementById('totalAnnualCtc').textContent = formatCurrency(data.total_annual_ctc || 0, currencyCode, currencySymbol);
    document.getElementById('totalMonthlyGross').textContent = formatCurrency(data.total_monthly_gross || 0, currencyCode, currencySymbol);
    document.getElementById('averageCtc').textContent = formatCurrency(data.average_ctc || 0, currencyCode, currencySymbol);
}

/**
 * Update department-wise breakdown section
 */
function updateDepartmentBreakdown(employees) {
    const container = document.getElementById('departmentBreakdown');
    if (!container) return;

    const currencyCode = salaryReportData.currency_code;
    const currencySymbol = salaryReportData.currency_symbol;

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
                    <span class="dept-stat-value">${formatCurrency(dept.totalCtc, currencyCode, currencySymbol)}</span>
                </div>
                <div class="dept-stat">
                    <span class="dept-stat-label">Avg CTC</span>
                    <span class="dept-stat-value">${formatCurrency(dept.count > 0 ? dept.totalCtc / dept.count : 0, currencyCode, currencySymbol)}</span>
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

    const currencyCode = salaryReportData.currency_code;
    const currencySymbol = salaryReportData.currency_symbol;
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
            <td class="amount-cell"><strong>${formatCurrency(emp.ctc || 0, currencyCode, currencySymbol)}</strong></td>
            <td class="amount-cell">${formatCurrency(emp.monthly_gross || 0, currencyCode, currencySymbol)}</td>
            <td class="amount-cell">${formatCurrency(emp.monthly_net || 0, currencyCode, currencySymbol)}</td>
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

// ============================================
// SignalR Real-Time Event Handlers
// ============================================

/**
 * Called when salary is updated (from hrms-signalr.js)
 */
function onSalaryUpdated(data) {
    console.log('[Payroll] Salary updated:', data);

    const action = data.Action;
    const employeeName = data.EmployeeName || 'Employee';

    let message = '';
    switch(action) {
        case 'created':
            message = `Salary created for ${employeeName}`;
            break;
        case 'updated':
            message = `Salary updated for ${employeeName}`;
            break;
        case 'revised':
            message = `Salary revised for ${employeeName}`;
            break;
        default:
            message = `Salary ${action} for ${employeeName}`;
    }

    showNotification(message, 'info');

    // Reload relevant data based on current section
    if (typeof loadSalaryComponents === 'function') {
        loadSalaryComponents();
    }
    if (typeof loadSalaryStructures === 'function') {
        loadSalaryStructures();
    }
}

/**
 * Called when payroll run is updated (from hrms-signalr.js)
 */
function onPayrollRunUpdated(data) {
    console.log('[Payroll] Payroll run updated:', data);

    const status = data.Status;
    const period = data.Period || 'Payroll';

    let message = '';
    let toastType = 'info';

    switch(status) {
        case 'draft':
            message = `${period} payroll draft created`;
            break;
        case 'processing':
            message = `${period} payroll is being processed`;
            break;
        case 'completed':
            message = `${period} payroll completed successfully`;
            toastType = 'success';
            break;
        case 'failed':
            message = `${period} payroll processing failed`;
            toastType = 'error';
            break;
        default:
            message = `${period} payroll status: ${status}`;
    }

    showNotification(message, toastType);
}

// =====================================================
// EMPLOYEE SALARIES TAB FUNCTIONS
// =====================================================

let empSalaryEmployees = [];
let empSalarySalaryStructures = [];
let empSalaryCurrentEmployee = null;
let empSalaryCurrentData = null;

/**
 * Initialize employee salaries tab event listeners
 */
function initEmployeeSalariesTab() {
    // Add event listeners for filter dropdowns (searchable dropdowns fire change on underlying select)
    document.getElementById('empSalaryOfficeFilter')?.addEventListener('change', loadEmployeeSalaries);
    document.getElementById('empSalaryDeptFilter')?.addEventListener('change', loadEmployeeSalaries);
    document.getElementById('empSalaryStatusFilter')?.addEventListener('change', filterEmployeeSalaries);
}

/**
 * Get currency info for an employee based on their office
 */
function getEmployeeCurrencyInfo(employee) {
    if (!employee || !employee.office_id) {
        return { code: null, symbol: null };
    }
    const office = offices.find(o => o.id === employee.office_id);
    return {
        code: office?.currency_code || null,
        symbol: office?.currency_symbol || null
    };
}

/**
 * Load employees with their salary status for the Employee Salaries tab
 */
async function loadEmployeeSalaries() {
    try {
        const officeFilter = document.getElementById('empSalaryOfficeFilter')?.value || '';
        const deptFilter = document.getElementById('empSalaryDeptFilter')?.value || '';

        // Load employees - use office-specific endpoint if office selected
        let url;
        if (officeFilter) {
            url = `/hrms/employees/office/${officeFilter}`;
        } else {
            url = '/hrms/employees';
        }

        let empList = await api.request(url) || [];

        // Apply department filter client-side (backend doesn't support combined office+dept filter)
        if (deptFilter) {
            empList = empList.filter(e => e.department_id === deptFilter);
        }

        empSalaryEmployees = empList;

        // Load salary info for each employee
        const employeesWithSalary = await Promise.all(empSalaryEmployees.map(async (emp) => {
            try {
                const salary = await api.getEmployeeSalary(emp.id);
                return { ...emp, salary: salary || null };
            } catch (e) {
                return { ...emp, salary: null };
            }
        }));

        empSalaryEmployees = employeesWithSalary;

        // Update stats
        updateEmployeeSalaryStats();

        // Render table
        filterEmployeeSalaries();
    } catch (error) {
        console.error('Error loading employee salaries:', error);
        showToast('Failed to load employee salaries', 'error');
    }
}

/**
 * Update the stats row for employee salaries
 */
function updateEmployeeSalaryStats() {
    const totalCount = empSalaryEmployees.length;
    const assignedCount = empSalaryEmployees.filter(e => e.salary && e.salary.id).length;
    const pendingCount = totalCount - assignedCount;

    // Group employees by currency for proper total display
    const currencyTotals = {};
    empSalaryEmployees.forEach(e => {
        if (e.salary?.ctc) {
            const currency = getEmployeeCurrencyInfo(e);
            const key = currency.code || 'DEFAULT';
            if (!currencyTotals[key]) {
                currencyTotals[key] = { total: 0, symbol: currency.symbol, code: currency.code };
            }
            currencyTotals[key].total += e.salary.ctc / 12;
        }
    });

    document.getElementById('totalEmployeesCount').textContent = totalCount;
    document.getElementById('salaryAssignedCount').textContent = assignedCount;
    document.getElementById('salaryPendingCount').textContent = pendingCount;

    // Display total - if single currency show formatted, otherwise show "Mixed"
    const currencyKeys = Object.keys(currencyTotals);
    if (currencyKeys.length === 1) {
        const curr = currencyTotals[currencyKeys[0]];
        document.getElementById('totalPayrollCost').textContent = formatCurrency(curr.total, curr.code, curr.symbol);
    } else if (currencyKeys.length > 1) {
        document.getElementById('totalPayrollCost').textContent = 'Mixed Currencies';
    } else {
        document.getElementById('totalPayrollCost').textContent = formatCurrency(0, null, null);
    }
}

/**
 * Filter employees based on search and status
 */
function filterEmployeeSalaries() {
    const searchTerm = document.getElementById('empSalarySearch')?.value?.toLowerCase() || '';
    const statusFilter = document.getElementById('empSalaryStatusFilter')?.value || '';

    let filtered = empSalaryEmployees;

    // Apply search filter
    if (searchTerm) {
        filtered = filtered.filter(emp => {
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            const empCode = (emp.employee_code || '').toLowerCase();
            return fullName.includes(searchTerm) || empCode.includes(searchTerm);
        });
    }

    // Apply status filter
    if (statusFilter === 'assigned') {
        filtered = filtered.filter(emp => emp.salary && emp.salary.id);
    } else if (statusFilter === 'pending') {
        filtered = filtered.filter(emp => !emp.salary || !emp.salary.id);
    }

    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        empSalariesPagination = createTablePagination('empSalariesPagination', {
            containerSelector: '#employeeSalariesPagination',
            data: filtered,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderEmployeeSalariesTable(paginatedData);
            }
        });
    } else {
        renderEmployeeSalariesTable(filtered);
    }
}

/**
 * Render the employee salaries table
 */
function renderEmployeeSalariesTable(employees) {
    const tbody = document.getElementById('employeeSalariesTable');

    if (!employees || employees.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <line x1="19" y1="8" x2="19" y2="14"></line>
                            <line x1="22" y1="11" x2="16" y2="11"></line>
                        </svg>
                        <p>No employees found</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const rows = employees.map(emp => {
        const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Unknown';
        const initials = getEmployeeInitials(emp.first_name, emp.last_name);
        const hasSalary = emp.salary && emp.salary.id;

        // Get currency info from employee's office
        const currency = getEmployeeCurrencyInfo(emp);
        const ctcDisplay = hasSalary ? formatCurrency(emp.salary.ctc, currency.code, currency.symbol) : '-';
        const effectiveFrom = hasSalary && emp.salary.effective_from
            ? new Date(emp.salary.effective_from).toLocaleDateString()
            : '-';
        const structureName = hasSalary ? (emp.salary.structure_name || '-') : '-';

        const statusBadge = hasSalary
            ? '<span class="badge badge-success">Assigned</span>'
            : '<span class="badge badge-warning">Pending</span>';

        const actionBtn = hasSalary
            ? `<button class="btn btn-sm btn-outline" onclick="openEmployeeSalaryModal('${emp.id}')" title="Revise Salary">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                       <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                   </svg>
                   Revise
               </button>`
            : `<button class="btn btn-sm btn-primary" onclick="openEmployeeSalaryModal('${emp.id}')" title="Assign Salary">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <line x1="12" y1="5" x2="12" y2="19"></line>
                       <line x1="5" y1="12" x2="19" y2="12"></line>
                   </svg>
                   Assign
               </button>`;

        // Avatar: show profile photo if available, otherwise show initials
        const avatarHtml = emp.profile_photo_url
            ? `<img src="${escapeHtml(emp.profile_photo_url)}" alt="${escapeHtml(fullName)}" class="emp-avatar-xs-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
               <div class="emp-avatar-xs" style="display:none;">${initials}</div>`
            : `<div class="emp-avatar-xs">${initials}</div>`;

        return `
            <tr>
                <td>
                    <div class="emp-cell-compact">
                        ${avatarHtml}
                        <span class="emp-name-inline">${escapeHtml(fullName)}</span>
                        <span class="emp-code-badge">${escapeHtml(emp.employee_code || '-')}</span>
                    </div>
                </td>
                <td>${escapeHtml(emp.department_name || '-')}</td>
                <td>${escapeHtml(emp.designation_name || '-')}</td>
                <td>${escapeHtml(structureName)}</td>
                <td class="amount-cell">${ctcDisplay}</td>
                <td>${effectiveFrom}</td>
                <td class="text-center">${statusBadge}</td>
                <td class="text-center">${actionBtn}</td>
            </tr>
        `;
    });

    tbody.innerHTML = rows.join('');
}

/**
 * Get employee initials
 */
function getEmployeeInitials(firstName, lastName) {
    const f = (firstName || '').charAt(0).toUpperCase();
    const l = (lastName || '').charAt(0).toUpperCase();
    return f + l || '--';
}

/**
 * Switch between tabs in the Employee Salary modal
 */
function switchEmpSalaryTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('#employeeSalaryModal .emp-salary-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('#employeeSalaryModal .emp-salary-tab-content').forEach(content => {
        content.classList.remove('active');
    });

    if (tabName === 'details') {
        document.getElementById('empSalaryTabDetails').classList.add('active');
    } else if (tabName === 'history') {
        document.getElementById('empSalaryTabHistory').classList.add('active');
    }
}

/**
 * Open the employee salary modal for assigning or revising salary
 */
async function openEmployeeSalaryModal(employeeId) {
    const employee = empSalaryEmployees.find(e => e.id === employeeId);
    if (!employee) {
        showToast('Employee not found', 'error');
        return;
    }

    empSalaryCurrentEmployee = employee;

    // Reset form
    document.getElementById('empSalaryEmployeeId').value = employeeId;
    document.getElementById('empSalaryExistingId').value = '';
    document.getElementById('empSalaryCTC').value = '';
    // Use formatDateLocal to avoid timezone issues and update flatpickr properly
    const now = new Date();
    const todayStr = formatDateLocal(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const effectiveFromEl = document.getElementById('empSalaryEffectiveFrom');
    if (effectiveFromEl._flatpickr) {
        effectiveFromEl._flatpickr.setDate(todayStr, true);
    } else {
        effectiveFromEl.value = todayStr;
    }
    document.getElementById('empCurrentSalarySection').style.display = 'none';
    document.getElementById('empSalaryBreakdownSection').style.display = 'none';
    document.getElementById('empRevisionTypeGroup').style.display = 'none';
    document.getElementById('empRevisionReasonGroup').style.display = 'none';
    document.getElementById('employeeSalaryFormTitle').textContent = 'Configure Salary';
    document.getElementById('empSaveSalaryBtnText').textContent = 'Save Salary';
    empSalaryCurrentData = null;

    // Reset to first tab and hide history count
    switchEmpSalaryTab('details');
    document.getElementById('empSalaryHistoryCount').style.display = 'none';
    document.getElementById('empSalaryHistoryTableBody').innerHTML = `
        <tr class="empty-state">
            <td colspan="5">
                <div class="empty-message">
                    <p>No salary history available</p>
                </div>
            </td>
        </tr>
    `;

    // Set employee info in header
    const initials = getEmployeeInitials(employee.first_name, employee.last_name);
    document.getElementById('empSalaryAvatar').textContent = initials;
    document.getElementById('empSalaryName').textContent =
        `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Unknown';
    document.getElementById('empSalaryDesignation').textContent =
        employee.designation_name || 'No Designation';
    document.getElementById('empSalaryDepartment').textContent =
        employee.department_name || 'No Department';

    // Load salary structures for employee's office
    try {
        empSalarySalaryStructures = await api.getHrmsSalaryStructures(employee.office_id);
        const structureOptions = [
            { value: '', label: 'Select Salary Structure...' },
            ...empSalarySalaryStructures.map(s => ({
                value: s.id,
                label: s.structure_name
            }))
        ];
        updateSearchableDropdownOptions('empSalaryStructureId', structureOptions);
        // Reset currency prefix to default
        updateEmpSalaryCurrencyPrefix();
    } catch (error) {
        console.error('Error loading salary structures:', error);
        showToast('Failed to load salary structures', 'error');
    }

    // Load existing salary if any
    try {
        const salary = await api.getEmployeeSalary(employeeId);
        if (salary && salary.id) {
            empSalaryCurrentData = salary;
            document.getElementById('empSalaryExistingId').value = salary.id;

            // Show current salary section
            document.getElementById('empCurrentSalarySection').style.display = 'block';
            // Use currency from employee's office
            const empCurrency = getEmployeeCurrencyInfo(employee);
            document.getElementById('empCurrentCTC').textContent = formatCurrency(salary.ctc, empCurrency.code, empCurrency.symbol);
            document.getElementById('empCurrentMonthlyGross').textContent = formatCurrency(salary.gross / 12, empCurrency.code, empCurrency.symbol);
            document.getElementById('empCurrentMonthlyNet').textContent = formatCurrency(salary.net / 12, empCurrency.code, empCurrency.symbol);
            document.getElementById('empCurrentEffectiveFrom').textContent =
                salary.effective_from ? new Date(salary.effective_from).toLocaleDateString() : '-';

            // Update status badge
            document.getElementById('empSalaryStatusBadge').innerHTML =
                '<span class="badge badge-success">Active</span>';

            // Pre-fill form for revision
            const structureDropdown = getSearchableDropdown('empSalaryStructureId');
            if (structureDropdown) {
                structureDropdown.setValue(salary.structure_id || '');
            }
            document.getElementById('empSalaryCTC').value = salary.ctc || '';
            document.getElementById('employeeSalaryFormTitle').textContent = 'Revise Salary';
            document.getElementById('empRevisionTypeGroup').style.display = 'block';
            document.getElementById('empRevisionReasonGroup').style.display = 'block';
            document.getElementById('empSaveSalaryBtnText').textContent = 'Revise Salary';

            // Update currency prefix after setting structure
            updateEmpSalaryCurrencyPrefix();

            // Trigger breakdown preview
            await previewEmpSalaryBreakdown();

            // Load salary history
            await loadEmpSalaryHistory(employeeId);
        } else {
            document.getElementById('empSalaryStatusBadge').innerHTML =
                '<span class="badge badge-warning">Not Configured</span>';
        }
    } catch (error) {
        // No existing salary - that's OK for new employees
        document.getElementById('empSalaryStatusBadge').innerHTML =
            '<span class="badge badge-warning">Not Configured</span>';
    }

    openModal('employeeSalaryModal');
}

/**
 * Update currency prefix when salary structure changes
 */
function updateEmpSalaryCurrencyPrefix() {
    const structureDropdown = getSearchableDropdown('empSalaryStructureId');
    const selectedValue = structureDropdown ? structureDropdown.getValue() : '';

    // Look up currency from stored structures array
    let currencySymbol = '';
    if (selectedValue && empSalarySalaryStructures) {
        const structure = empSalarySalaryStructures.find(s => s.id === selectedValue);
        if (structure) {
            currencySymbol = structure.currency_symbol || '';
        }
    }

    // If no structure selected, use employee's office currency as fallback
    if (!currencySymbol && empSalaryCurrentEmployee) {
        const empCurrency = getEmployeeCurrencyInfo(empSalaryCurrentEmployee);
        currencySymbol = empCurrency.symbol || '';
    }

    document.getElementById('empSalaryCurrencyPrefix').textContent = currencySymbol || '';
}

/**
 * Handle salary structure change
 */
async function onEmpSalaryStructureChange() {
    updateEmpSalaryCurrencyPrefix();
    await previewEmpSalaryBreakdown();
}

/**
 * Preview salary breakdown with full statutory calculations
 * Uses the versioned calculate endpoint to include PF, ESI, PT, TDS, etc.
 */
async function previewEmpSalaryBreakdown() {
    const structureDropdown = getSearchableDropdown('empSalaryStructureId');
    const structureId = structureDropdown ? structureDropdown.getValue() : '';
    const ctc = parseFloat(document.getElementById('empSalaryCTC').value);

    if (!structureId || !ctc || ctc <= 0) {
        document.getElementById('empSalaryBreakdownSection').style.display = 'none';
        return;
    }

    try {
        // Use the versioned calculate endpoint which includes statutory deductions
        // Calculate for current month as preview
        // Use formatDateLocal to avoid timezone issues (toISOString converts to UTC, shifting dates for non-UTC timezones)
        const now = new Date();
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const periodStart = formatDateLocal(now.getFullYear(), now.getMonth() + 1, 1);
        const periodEnd = formatDateLocal(now.getFullYear(), now.getMonth() + 1, lastDayOfMonth);

        const breakdown = await api.request(`/hrms/payroll/structures/${structureId}/versions/calculate`, {
            method: 'POST',
            body: JSON.stringify({
                ctc: ctc,
                period_start: periodStart,
                period_end: periodEnd
            })
        });

        if (breakdown) {
            renderEmpSalaryBreakdown(breakdown, ctc);
            document.getElementById('empSalaryBreakdownSection').style.display = 'block';
        }
    } catch (error) {
        console.error('Error calculating breakdown:', error);
        document.getElementById('empSalaryBreakdownSection').style.display = 'none';
    }
}

/**
 * Render salary breakdown in the modal with enhanced design
 * Shows two-column layout (Earnings | Deductions) with statutory components and summary cards
 */
function renderEmpSalaryBreakdown(breakdown, annualCtc) {
    const container = document.getElementById('empSalaryBreakdownSection');

    // Get currency from backend response or fallback to structure
    const currencySymbol = breakdown.currency_symbol || '₹';
    const currencyCode = breakdown.currency_code || 'INR';

    // Use locale based on currency code for proper number formatting
    const localeMap = { 'INR': 'en-IN', 'USD': 'en-US', 'GBP': 'en-GB', 'AED': 'ar-AE', 'IDR': 'id-ID', 'MVR': 'dv-MV' };
    const locale = localeMap[currencyCode] || 'en-IN';
    const formatAmt = (amt) => amt.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // Extract data from breakdown
    const earnings = breakdown.aggregated_earnings || breakdown.component_breakdowns?.filter(c => c.component_type === 'earning') || [];
    const deductions = breakdown.aggregated_deductions || breakdown.component_breakdowns?.filter(c => c.component_type === 'deduction') || [];
    const employerContributions = breakdown.aggregated_employer_contributions || [];

    // v3.0.53: Show ALL earnings including negative adjustments (like CTC-BAL)
    // This ensures the math adds up correctly: sum of earnings = gross
    const activeEarnings = earnings.filter(e => (e.total_amount || e.prorated_amount || 0) !== 0);
    const activeDeductions = deductions; // Show all deductions including zero for statutory transparency

    // Calculate sum of displayed earnings to detect if there's a discrepancy with gross
    const sumDisplayedEarnings = activeEarnings.reduce((sum, e) => sum + (e.total_amount || e.prorated_amount || 0), 0);

    const totalGross = breakdown.total_gross || 0;
    const totalDeductions = breakdown.total_deductions || 0;
    const netPay = breakdown.total_net || breakdown.net_pay || 0;
    const totalWorkingDays = breakdown.total_working_days || 'N/A';

    // Get period info for header
    const now = new Date();
    const periodStartDisplay = `01 ${now.toLocaleDateString('en-US', { month: 'short' })}`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const periodEndDisplay = `${lastDay} ${now.toLocaleDateString('en-US', { month: 'short' })}`;

    let htmlContent = `
        <style>
            .esp-container { font-size: 12px; }
            .esp-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 8px; }
            .esp-header-item { text-align: center; }
            .esp-header-label { font-size: 9px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.3px; }
            .esp-header-value { font-size: 13px; font-weight: 600; color: var(--text-primary); }
            .esp-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
            .esp-column { background: var(--bg-secondary); border-radius: 6px; overflow: hidden; border: 1px solid var(--border-primary); }
            .esp-column-header { padding: 5px 10px; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
            .esp-earn-header { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }
            .esp-ded-header { background: color-mix(in srgb, var(--color-danger) 15%, transparent); color: var(--color-danger); }
            .esp-column-body { padding: 4px 0; max-height: 130px; overflow-y: auto; }
            .esp-row { display: flex; justify-content: space-between; padding: 2px 10px; font-size: 11px; }
            .esp-row:hover { background: var(--bg-hover); }
            .esp-row-name { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
            .esp-row-amt { font-weight: 500; font-variant-numeric: tabular-nums; margin-left: 8px; flex-shrink: 0; }
            .esp-row-amt.earn { color: var(--color-success); }
            .esp-row-amt.ded { color: var(--color-danger); }
            .esp-row-zero { opacity: 0.5; }
            .esp-total-row { border-top: 1px solid var(--border-secondary); padding-top: 4px; margin-top: 4px; font-weight: 600; }
            .esp-summary { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 6px; padding: 6px; background: var(--bg-tertiary); border-radius: 6px; }
            .esp-summary-item { text-align: center; padding: 8px 6px; border-radius: 6px; }
            .esp-summary-label { font-size: 9px; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.3px; }
            .esp-summary-value { font-size: 13px; font-weight: 700; margin-top: 2px; }
            .esp-summary-gross { background: var(--color-success); color: var(--text-inverse); }
            .esp-summary-ded { background: var(--color-danger); color: var(--text-inverse); }
            .esp-summary-net { background: var(--color-info); color: var(--text-inverse); }
            .esp-summary-net .esp-summary-value { font-size: 14px; }
            .esp-employer { margin-top: 6px; padding: 6px 10px; background: var(--bg-tertiary); border-radius: 6px; font-size: 10px; }
            .esp-employer-title { font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
            .esp-employer-title:hover { color: var(--text-primary); }
            .esp-employer-body { display: none; }
            .esp-employer-body.show { display: block; }
            .esp-employer-row { display: flex; justify-content: space-between; color: var(--text-tertiary); padding: 1px 0; }
        </style>
        <div class="esp-container">
            <div class="esp-header">
                <div class="esp-header-item">
                    <div class="esp-header-label">CTC (Annual)</div>
                    <div class="esp-header-value">${currencySymbol} ${formatAmt(annualCtc || 0)}</div>
                </div>
                <div class="esp-header-item">
                    <div class="esp-header-label">Period</div>
                    <div class="esp-header-value">${periodStartDisplay} - ${periodEndDisplay}</div>
                </div>
                <div class="esp-header-item">
                    <div class="esp-header-label">Days</div>
                    <div class="esp-header-value">${totalWorkingDays}</div>
                </div>
            </div>

            <div class="esp-columns">
                <div class="esp-column">
                    <div class="esp-column-header esp-earn-header">Earnings</div>
                    <div class="esp-column-body">
    `;

    // Earnings column - v3.0.53: Handle negative amounts (CTC-BAL, adjustments)
    activeEarnings.forEach(cb => {
        const amount = cb.total_amount || cb.prorated_amount || 0;
        const isNegative = amount < 0;
        const displayAmount = Math.abs(amount);
        const amtClass = isNegative ? 'ded' : 'earn';  // Use red for negative, green for positive
        const prefix = isNegative ? '−' : '+';  // Minus sign for negative
        htmlContent += `<div class="esp-row"><span class="esp-row-name" title="${escapeHtml(cb.component_name)}">${escapeHtml(cb.component_name)}</span><span class="esp-row-amt ${amtClass}">${prefix}${currencySymbol} ${formatAmt(displayAmount)}</span></div>`;
    });

    // v3.0.53: If there's a discrepancy between displayed earnings and gross, show explanation
    const earningsDiscrepancy = sumDisplayedEarnings - totalGross;
    if (Math.abs(earningsDiscrepancy) > 0.5) {  // Allow small rounding tolerance
        const adjustmentLabel = earningsDiscrepancy > 0 ? 'CTC Balance Adjustment' : 'Additional Allowance';
        const adjAmount = Math.abs(earningsDiscrepancy);
        const adjClass = earningsDiscrepancy > 0 ? 'ded' : 'earn';
        const adjPrefix = earningsDiscrepancy > 0 ? '−' : '+';
        htmlContent += `<div class="esp-row" style="font-style: italic; opacity: 0.85;"><span class="esp-row-name" title="Auto-calculated to match CTC allocation">${adjustmentLabel}</span><span class="esp-row-amt ${adjClass}">${adjPrefix}${currencySymbol} ${formatAmt(adjAmount)}</span></div>`;
    }

    htmlContent += `
                        <div class="esp-row esp-total-row"><span>Gross</span><span class="esp-row-amt earn">${currencySymbol} ${formatAmt(totalGross)}</span></div>
                    </div>
                </div>
                <div class="esp-column">
                    <div class="esp-column-header esp-ded-header">Deductions</div>
                    <div class="esp-column-body">
    `;

    // Deductions column (including statutory like PF, ESI, PT, TDS)
    activeDeductions.forEach(cb => {
        const amount = cb.total_amount || cb.prorated_amount || 0;
        const zeroClass = amount === 0 ? ' esp-row-zero' : '';
        htmlContent += `<div class="esp-row${zeroClass}"><span class="esp-row-name" title="${escapeHtml(cb.component_name)}">${escapeHtml(cb.component_name)}</span><span class="esp-row-amt ded">${amount > 0 ? '−' : ''}${currencySymbol} ${formatAmt(amount)}</span></div>`;
    });
    htmlContent += `
                        <div class="esp-row esp-total-row"><span>Total</span><span class="esp-row-amt ded">−${currencySymbol} ${formatAmt(totalDeductions)}</span></div>
                    </div>
                </div>
            </div>

            <div class="esp-summary">
                <div class="esp-summary-item esp-summary-gross">
                    <div class="esp-summary-label">Gross</div>
                    <div class="esp-summary-value">${currencySymbol} ${formatAmt(totalGross)}</div>
                </div>
                <div class="esp-summary-item esp-summary-ded">
                    <div class="esp-summary-label">Deductions</div>
                    <div class="esp-summary-value">−${currencySymbol} ${formatAmt(totalDeductions)}</div>
                </div>
                <div class="esp-summary-item esp-summary-net">
                    <div class="esp-summary-label">Net Pay</div>
                    <div class="esp-summary-value">${currencySymbol} ${formatAmt(netPay)}</div>
                </div>
            </div>
    `;

    // Employer contributions section (collapsible)
    if (employerContributions.length > 0) {
        const activeEmployer = employerContributions.filter(e => (e.total_amount || e.prorated_amount || 0) > 0);
        if (activeEmployer.length > 0) {
            const totalEmployer = activeEmployer.reduce((sum, e) => sum + (e.total_amount || e.prorated_amount || 0), 0);
            htmlContent += `
                <div class="esp-employer">
                    <div class="esp-employer-title" onclick="this.nextElementSibling.classList.toggle('show')">
                        <span>▶</span> Employer Contributions (${currencySymbol} ${formatAmt(totalEmployer)})
                    </div>
                    <div class="esp-employer-body">
            `;
            activeEmployer.forEach(cb => {
                const amount = cb.total_amount || cb.prorated_amount || 0;
                htmlContent += `<div class="esp-employer-row"><span>${escapeHtml(cb.component_name)}</span><span>${currencySymbol} ${formatAmt(amount)}</span></div>`;
            });
            htmlContent += `</div></div>`;
        }
    }

    htmlContent += `</div>`;

    // Replace entire section content
    container.innerHTML = `<h5>Salary Breakdown (Monthly)</h5>${htmlContent}`;
}

/**
 * Load salary history for an employee
 */
async function loadEmpSalaryHistory(employeeId) {
    const tbody = document.getElementById('empSalaryHistoryTableBody');
    const countBadge = document.getElementById('empSalaryHistoryCount');

    try {
        const revisions = await api.getEmployeeSalaryRevisions(employeeId);

        if (!revisions || revisions.length === 0) {
            countBadge.style.display = 'none';
            tbody.innerHTML = `
                <tr class="empty-state">
                    <td colspan="5">
                        <div class="empty-message">
                            <p>No salary history available</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Show count badge
        countBadge.textContent = revisions.length;
        countBadge.style.display = 'inline-flex';

        // Get currency from employee's office
        const empCurrency = getEmployeeCurrencyInfo(empSalaryCurrentEmployee);

        // Sort by created_at descending
        const sortedRevisions = revisions.sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );

        const rows = sortedRevisions.map(item => {
            const effectiveDate = item.effective_date
                ? new Date(item.effective_date).toLocaleDateString()
                : '-';
            const ctcDisplay = formatCurrency(item.new_ctc, empCurrency.code, empCurrency.symbol);
            // Structure name: try structure_name first, then look up from current salary data
            let structureName = item.structure_name;
            if (!structureName && empSalaryCurrentData && empSalaryCurrentData.structure_name) {
                structureName = empSalaryCurrentData.structure_name;
            }
            structureName = structureName || '-';
            const revisionType = (item.revision_type || '-').replace(/_/g, ' ');
            // Updated by: check both field names (revised_by_name and created_by_name)
            const updatedBy = item.revised_by_name || item.created_by_name || '-';

            return `
                <tr>
                    <td>${effectiveDate}</td>
                    <td>${ctcDisplay}</td>
                    <td>${escapeHtml(structureName)}</td>
                    <td>${escapeHtml(revisionType)}</td>
                    <td>${escapeHtml(updatedBy)}</td>
                </tr>
            `;
        });

        tbody.innerHTML = rows.join('');
    } catch (error) {
        console.error('Error loading salary history:', error);
        countBadge.style.display = 'none';
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="5">
                    <div class="empty-message">
                        <p>Failed to load salary history</p>
                    </div>
                </td>
            </tr>
        `;
    }
}

/**
 * Save employee salary from payroll page
 */
async function saveEmployeeSalaryFromPayroll(event) {
    event.preventDefault();

    const employeeId = document.getElementById('empSalaryEmployeeId').value;
    const existingSalaryId = document.getElementById('empSalaryExistingId').value;
    const structureDropdown = getSearchableDropdown('empSalaryStructureId');
    const structureId = structureDropdown ? structureDropdown.getValue() : '';
    const ctc = parseFloat(document.getElementById('empSalaryCTC').value);
    const effectiveFrom = document.getElementById('empSalaryEffectiveFrom').value;

    if (!structureId || !ctc || !effectiveFrom) {
        showToast('Please fill all required fields', 'error');
        return;
    }

    const saveBtn = document.getElementById('empSaveSalaryBtn');
    const originalText = document.getElementById('empSaveSalaryBtnText').textContent;
    saveBtn.disabled = true;
    document.getElementById('empSaveSalaryBtnText').textContent = 'Saving...';

    try {
        let salaryData;

        if (existingSalaryId) {
            // Revise existing salary
            const revisionTypeDropdown = getSearchableDropdown('empRevisionType');
            const revisionType = revisionTypeDropdown ? revisionTypeDropdown.getValue() : 'adjustment';
            salaryData = {
                employee_id: employeeId,
                new_structure_id: structureId,
                new_ctc: ctc,
                effective_from: effectiveFrom,
                revision_type: revisionType || 'adjustment',
                revision_reason: document.getElementById('empRevisionReason')?.value || ''
            };
            // Mark as pending so SignalR handler skips notification for this user
            markHrmsPendingAction('SalaryRevised', employeeId);
            await api.updateEmployeeSalary(employeeId, salaryData);
            showToast('Salary revised successfully', 'success');
        } else {
            // Create new salary
            salaryData = {
                employee_id: employeeId,
                structure_id: structureId,
                ctc: ctc,
                effective_from: effectiveFrom
            };
            // Mark as pending so SignalR handler skips notification for this user
            markHrmsPendingAction('SalaryCreated', employeeId);
            await api.assignEmployeeSalary(salaryData);
            showToast('Salary assigned successfully', 'success');
        }

        closeModal('employeeSalaryModal');

        // Reload employee salaries table
        await loadEmployeeSalaries();
    } catch (error) {
        console.error('Error saving salary:', error);
        showToast(error.message || 'Failed to save salary', 'error');
    } finally {
        saveBtn.disabled = false;
        document.getElementById('empSaveSalaryBtnText').textContent = originalText;
    }
}

/**
 * Populate employee salary filter dropdowns
 */
async function populateEmpSalaryFilters() {
    try {
        // Populate offices filter
        const offices = await api.getHrmsOffices();
        if (offices) {
            const officeOptions = [
                { value: '', label: 'All Offices' },
                ...offices.map(o => ({ value: o.id, label: o.office_name }))
            ];
            updateSearchableDropdownOptions('empSalaryOfficeFilter', officeOptions);
        }

        // Populate departments filter
        const departments = await api.getHrmsDepartments();
        if (departments) {
            const deptOptions = [
                { value: '', label: 'All Departments' },
                ...departments.map(d => ({ value: d.id, label: d.department_name }))
            ];
            updateSearchableDropdownOptions('empSalaryDeptFilter', deptOptions);
        }

        // Status filter options are static, just need to initialize
        const statusOptions = [
            { value: '', label: 'All Status' },
            { value: 'assigned', label: 'Salary Assigned' },
            { value: 'pending', label: 'Pending Assignment' }
        ];
        updateSearchableDropdownOptions('empSalaryStatusFilter', statusOptions);
    } catch (error) {
        console.error('Error populating employee salary filters:', error);
    }
}

// =====================================================
// TAX CONFIGURATION SECTION
// =====================================================

let taxConfigRegimes = null;
let taxConfigFinancialYear = '';
let taxConfigEmployees = [];
let taxRegimeModalEmployeeId = null;
let selectedTaxRegimeCode = null;
let taxConfigCountryCode = null;

/**
 * Compute financial year string from country's fiscal_year_start_month
 */
function getFinancialYear(countryCode) {
    const country = window.loadedCountries?.find(c => c.country_code === countryCode);
    const fyStart = country?.fiscal_year_start_month || 1;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    if (fyStart === 1) {
        return `${year}`;
    }
    if (month >= fyStart) {
        return `${year}-${(year + 1).toString().slice(2)}`;
    } else {
        return `${year - 1}-${year.toString().slice(2)}`;
    }
}

/**
 * Main entry point: load tax configuration for selected country
 */
async function loadTaxConfiguration() {
    const countryCode = getSelectedCountry();
    if (!countryCode) {
        document.getElementById('taxConfigEmptyState').style.display = '';
        document.getElementById('taxConfigStats').style.display = 'none';
        document.getElementById('taxConfigTableContainer').style.display = 'none';
        document.getElementById('taxConfigInfoBanner').style.display = 'none';
        document.getElementById('taxConfigFYLabel').style.display = 'none';
        return;
    }

    taxConfigCountryCode = countryCode;
    taxConfigFinancialYear = getFinancialYear(countryCode);

    // Show FY label
    const fyLabel = document.getElementById('taxConfigFYLabel');
    fyLabel.style.display = 'flex';
    document.getElementById('taxConfigFYValue').textContent = taxConfigFinancialYear;

    try {
        // Fetch country config to get tax_regimes
        const configResponse = await api.request(`/hrms/statutory/configs/country/${countryCode}`);
        // API returns { success, config: { configData: {...} } }
        let configData = configResponse?.config?.configData || configResponse?.config_data || configResponse?.ConfigData || configResponse;

        // Handle string JSONB
        if (typeof configData === 'string') {
            try { configData = JSON.parse(configData); } catch (e) { configData = {}; }
        }

        const taxRegimes = configData?.tax_regimes || configData?.TaxRegimes || null;
        taxConfigRegimes = taxRegimes;

        renderTaxConfigContent();
    } catch (error) {
        console.error('Error loading tax configuration:', error);
        taxConfigRegimes = null;
        renderTaxConfigContent();
    }
}

/**
 * Decide which UI to show based on regime count (0, 1, or 2+)
 */
function renderTaxConfigContent() {
    const infoBanner = document.getElementById('taxConfigInfoBanner');
    const stats = document.getElementById('taxConfigStats');
    const tableContainer = document.getElementById('taxConfigTableContainer');
    const emptyState = document.getElementById('taxConfigEmptyState');

    emptyState.style.display = 'none';

    const regimeKeys = taxConfigRegimes ? Object.keys(taxConfigRegimes) : [];

    if (regimeKeys.length === 0) {
        // No tax regimes configured
        infoBanner.style.display = 'block';
        infoBanner.className = 'tax-config-info-banner tax-config-banner-info';
        infoBanner.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <div><strong>No tax regimes configured.</strong> This country's statutory compliance configuration does not include tax regimes. Tax will be calculated using default rules.</div>
        `;
        stats.style.display = 'none';
        tableContainer.style.display = 'none';
        return;
    }

    if (regimeKeys.length === 1) {
        // Single regime - show info, load employees read-only
        const regime = taxConfigRegimes[regimeKeys[0]];
        const regimeName = regime?.regime_name || regime?.name || regimeKeys[0];
        infoBanner.style.display = 'block';
        infoBanner.className = 'tax-config-info-banner tax-config-banner-info';
        infoBanner.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <div><strong>Single tax regime: ${regimeName}.</strong> All employees are automatically assigned to this regime. No switching is required.</div>
        `;
        stats.style.display = 'none';
        tableContainer.style.display = 'none';
        loadTaxConfigEmployees(taxConfigCountryCode, true);
        return;
    }

    // Multiple regimes - full functionality
    infoBanner.style.display = 'none';
    stats.style.display = '';  // Let CSS handle layout (stats-row uses flex)
    tableContainer.style.display = '';
    loadTaxConfigEmployees(taxConfigCountryCode, false);
}

/**
 * Fetch employees and their regime data
 */
async function loadTaxConfigEmployees(countryCode, readOnly) {
    const tableBody = document.getElementById('taxConfigTableBody');
    tableBody.innerHTML = `<tr><td colspan="7"><div class="loading-placeholder"><div class="spinner"></div><p>Loading employees...</p></div></td></tr>`;

    try {
        // Get active employees
        const empResponse = await api.request('/hrms/employees?status=active');
        let employees = Array.isArray(empResponse) ? empResponse : (empResponse.employees || []);

        // Filter by country - match employees whose office belongs to selected country
        // We use office data if available
        console.log('[TAX CONFIG DEBUG] Total employees from API:', employees.length);
        console.log('[TAX CONFIG DEBUG] Sample employee fields:', employees.slice(0, 2).map(e => ({
            code: e.employee_code,
            office_country_code: e.office_country_code,
            office_state_code: e.office_state_code,
            country_code: e.country_code
        })));
        console.log('[TAX CONFIG DEBUG] Filtering for country:', countryCode);

        const countryEmployees = employees.filter(emp => {
            const officeCountry = emp.office_country_code || emp.country_code;
            const matches = officeCountry === countryCode;
            if (!matches && emp.employee_code) {
                console.log(`[TAX CONFIG DEBUG] Employee ${emp.employee_code} filtered out: office_country=${emp.office_country_code}, country_code=${emp.country_code}, looking for=${countryCode}`);
            }
            return matches;
        });

        console.log('[TAX CONFIG DEBUG] Employees after country filter:', countryEmployees.length);

        // For each employee, try to fetch their tax regime
        const regimePromises = countryEmployees.map(async (emp) => {
            try {
                const regimeData = await api.request(`/hrms/statutory/employees/${emp.id}/tax-regime?countryCode=${countryCode}&financialYear=${encodeURIComponent(taxConfigFinancialYear)}`);
                return { ...emp, regime_data: regimeData };
            } catch (e) {
                return { ...emp, regime_data: null };
            }
        });

        taxConfigEmployees = await Promise.all(regimePromises);
        filterAndPaginateTaxConfig(readOnly);
        if (!readOnly) {
            updateTaxConfigStats();
        }
    } catch (error) {
        console.error('Error loading tax config employees:', error);
        tableBody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>Error loading employees</p><p class="hint">${error.message || 'Unknown error'}</p></div></td></tr>`;
    }
}

// Pagination instance for tax config
let taxConfigPagination = null;
let taxConfigReadOnly = false;

/**
 * Filter and paginate tax config employees
 */
function filterAndPaginateTaxConfig(readOnly) {
    taxConfigReadOnly = readOnly;
    const tableContainer = document.getElementById('taxConfigTableContainer');

    if (taxConfigEmployees.length === 0) {
        tableContainer.style.display = 'none';
        document.getElementById('taxConfigEmptyState').style.display = '';
        document.getElementById('taxConfigEmptyState').querySelector('.empty-message p').textContent = 'No employees found for this country';
        return;
    }

    tableContainer.style.display = '';
    document.getElementById('taxConfigEmptyState').style.display = 'none';

    // Use pagination if available
    if (typeof createTablePagination !== 'undefined') {
        taxConfigPagination = createTablePagination('taxConfigPagination', {
            containerSelector: '#taxConfigPagination',
            data: taxConfigEmployees,
            rowsPerPage: 25,
            rowsPerPageOptions: [10, 25, 50, 100],
            onPageChange: (paginatedData, pageInfo) => {
                renderTaxConfigTable(paginatedData, taxConfigReadOnly);
            }
        });
    } else {
        renderTaxConfigTable(taxConfigEmployees, readOnly);
    }
}

/**
 * Render the employee tax regime table
 */
function renderTaxConfigTable(employees, readOnly) {
    const tableBody = document.getElementById('taxConfigTableBody');

    if (!employees || employees.length === 0) {
        tableBody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                        </svg>
                        <p>No employees found</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const regimeKeys = taxConfigRegimes ? Object.keys(taxConfigRegimes) : [];
    const defaultRegimeKey = regimeKeys.find(k => taxConfigRegimes[k]?.is_default) || regimeKeys[0];

    const rows = employees.map(emp => {
        const rd = emp.regime_data;
        // Extract from nested API response: { success, tax_regime: { data: { regime_code, locked } } }
        const taxRegimeData = rd?.tax_regime?.data || rd;
        const currentRegimeCode = taxRegimeData?.regime_code || taxRegimeData?.regimeCode || defaultRegimeKey;
        const currentRegime = taxConfigRegimes?.[currentRegimeCode];
        const currentRegimeName = currentRegime?.regime_name || currentRegime?.name || currentRegimeCode || 'Default';
        const isLocked = taxRegimeData?.locked === true || taxRegimeData?.is_locked === true;
        const isCustom = rd && rd.tax_regime && currentRegimeCode !== defaultRegimeKey;

        let statusBadge = '';
        if (isLocked) {
            statusBadge = '<span class="badge badge-danger">Locked</span>';
        } else if (isCustom) {
            statusBadge = '<span class="badge badge-warning">Custom</span>';
        } else {
            statusBadge = '<span class="badge badge-info">Default</span>';
        }

        const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Unknown';
        const initials = getTaxConfigEmployeeInitials(emp.first_name, emp.last_name);
        const empCode = emp.employee_code || emp.emp_code || '-';
        const deptName = emp.department_name || emp.department || '-';
        const officeName = emp.office_name || emp.office || '-';

        // Avatar: show profile photo if available, otherwise show initials
        const avatarHtml = emp.profile_photo_url
            ? `<img src="${escapeHtml(emp.profile_photo_url)}" alt="${escapeHtml(fullName)}" class="emp-avatar-xs-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
               <div class="emp-avatar-xs" style="display:none;">${initials}</div>`
            : `<div class="emp-avatar-xs">${initials}</div>`;

        const actionBtn = readOnly
            ? ''
            : `<button class="btn btn-sm btn-outline" onclick="openTaxRegimeModal('${emp.id}')" title="Change Regime">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                       <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                   </svg>
                   Change
               </button>`;

        return `
            <tr>
                <td>
                    <div class="emp-cell-compact">
                        ${avatarHtml}
                        <span class="emp-name-inline">${escapeHtml(fullName)}</span>
                        <span class="emp-code-badge">${escapeHtml(empCode)}</span>
                    </div>
                </td>
                <td>${escapeHtml(deptName)}</td>
                <td>${escapeHtml(officeName)}</td>
                <td>${escapeHtml(currentRegimeName)}</td>
                <td class="text-center">${statusBadge}</td>
                <td>${taxConfigFinancialYear}</td>
                <td class="text-center">${actionBtn}</td>
            </tr>
        `;
    });

    tableBody.innerHTML = rows.join('');
}

/**
 * Get employee initials for tax config table
 */
function getTaxConfigEmployeeInitials(firstName, lastName) {
    const f = (firstName || '').charAt(0).toUpperCase();
    const l = (lastName || '').charAt(0).toUpperCase();
    return f + l || '--';
}

/**
 * Update the 4 stat cards
 */
function updateTaxConfigStats() {
    const total = taxConfigEmployees.length;
    const regimeKeys = taxConfigRegimes ? Object.keys(taxConfigRegimes) : [];
    const defaultRegimeKey = regimeKeys.find(k => taxConfigRegimes[k]?.is_default) || regimeKeys[0];

    let defaultCount = 0, customCount = 0, lockedCount = 0;
    taxConfigEmployees.forEach(emp => {
        const rd = emp.regime_data;
        // Extract from nested API response: { success, tax_regime: { data: { regime_code, locked } } }
        const taxRegimeData = rd?.tax_regime?.data || rd;
        const isLocked = taxRegimeData?.locked === true || taxRegimeData?.is_locked === true;
        const currentRegimeCode = taxRegimeData?.regime_code || taxRegimeData?.regimeCode || defaultRegimeKey;
        const isCustom = rd && rd.tax_regime && currentRegimeCode !== defaultRegimeKey;

        if (isLocked) lockedCount++;
        if (isCustom) customCount++;
        else defaultCount++;
    });

    document.getElementById('taxStatTotal').textContent = total;
    document.getElementById('taxStatDefault').textContent = defaultCount;
    document.getElementById('taxStatCustom').textContent = customCount;
    document.getElementById('taxStatLocked').textContent = lockedCount;
}

/**
 * Open the tax regime modal for an employee
 */
function openTaxRegimeModal(employeeId) {
    taxRegimeModalEmployeeId = employeeId;
    selectedTaxRegimeCode = null;

    const emp = taxConfigEmployees.find(e => e.id === employeeId || e.id === String(employeeId));
    if (!emp) return;

    const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
    const empCode = emp.employee_code || emp.emp_code || '';
    const deptName = emp.department_name || emp.department || '-';
    const officeName = emp.office_name || emp.office || '-';

    // Employee info header
    document.getElementById('taxRegimeEmployeeInfo').innerHTML = `
        <div class="tax-regime-emp-header">
            <div class="tax-regime-emp-name">${empName} ${empCode ? `<span class="emp-code">${empCode}</span>` : ''}</div>
            <div class="tax-regime-emp-details">${deptName} &middot; ${officeName}</div>
        </div>
    `;

    // FY display
    document.getElementById('taxRegimeFYDisplay').innerHTML = `
        <div style="font-size:13px; color:var(--text-secondary); margin-bottom:16px;">
            Financial Year: <strong>${taxConfigFinancialYear}</strong>
        </div>
    `;

    const rd = emp.regime_data;
    // Extract from nested API response: { success, tax_regime: { data: { regime_code, locked } } }
    const taxRegimeData = rd?.tax_regime?.data || rd;
    const currentRegimeCode = taxRegimeData?.regime_code || taxRegimeData?.regimeCode || null;
    const isLocked = taxRegimeData?.locked === true || taxRegimeData?.is_locked === true;

    // Lock warning
    const lockWarning = document.getElementById('taxRegimeLockWarning');
    if (isLocked) {
        lockWarning.style.display = 'flex';
        const regimeKeys = Object.keys(taxConfigRegimes);
        const currentRegime = taxConfigRegimes[currentRegimeCode];
        const lockRules = currentRegime?.lock_in_rules || '';
        document.getElementById('taxRegimeLockText').innerHTML = `<strong>Regime is locked.</strong> ${lockRules ? `Legal reference: ${lockRules}` : 'This employee\'s tax regime selection is locked for the current financial year.'}`;
    } else {
        lockWarning.style.display = 'none';
    }

    // Render regime cards
    renderRegimeCards(currentRegimeCode, isLocked);

    // Render comparison table
    renderRegimeComparison();

    // Disable save initially
    document.getElementById('taxRegimeSaveBtn').disabled = true;

    openModal('taxRegimeModal');
}

/**
 * Render clickable regime cards
 */
function renderRegimeCards(currentRegimeCode, isLocked) {
    const container = document.getElementById('taxRegimeCardsContainer');
    const regimeKeys = Object.keys(taxConfigRegimes);
    const defaultRegimeKey = regimeKeys.find(k => taxConfigRegimes[k]?.is_default) || regimeKeys[0];

    container.innerHTML = regimeKeys.map(key => {
        const regime = taxConfigRegimes[key];
        const regimeName = regime?.regime_name || regime?.name || key;
        const isDefault = regime?.is_default || key === defaultRegimeKey;
        const isCurrent = key === currentRegimeCode || (!currentRegimeCode && isDefault);
        const description = regime?.description || '';
        const standardDeduction = regime?.standard_deduction;
        const slabs = regime?.slabs || [];

        const badges = [];
        if (isDefault) badges.push('<span class="regime-badge regime-badge-default">Default</span>');
        if (isCurrent) badges.push('<span class="regime-badge regime-badge-current">Current</span>');

        const slabsHtml = slabs.length > 0 ? `
            <table class="regime-slab-mini-table">
                <thead><tr><th>From</th><th>To</th><th>Rate</th></tr></thead>
                <tbody>
                    ${slabs.slice(0, 4).map(s => `<tr>
                        <td>${formatSlabAmount(s.from || s.min || 0)}</td>
                        <td>${s.to || s.max ? formatSlabAmount(s.to || s.max) : '&infin;'}</td>
                        <td>${s.rate || s.percentage || 0}%</td>
                    </tr>`).join('')}
                    ${slabs.length > 4 ? `<tr><td colspan="3" style="text-align:center;color:var(--text-tertiary);font-size:11px;">+${slabs.length - 4} more slabs</td></tr>` : ''}
                </tbody>
            </table>
        ` : '';

        const cardClass = `regime-card ${isCurrent ? 'selected' : ''} ${isLocked ? 'locked' : ''}`;

        return `
            <div class="${cardClass}" data-regime-code="${key}" onclick="${isLocked ? '' : `selectRegimeCard('${key}')`}">
                <div class="regime-card-header">
                    <div class="regime-card-name">${regimeName}</div>
                    <div class="regime-card-badges">${badges.join(' ')}</div>
                </div>
                ${description ? `<div class="regime-card-description">${description}</div>` : ''}
                ${standardDeduction != null ? `<div class="regime-card-detail">Standard Deduction: <strong>${formatSlabAmount(standardDeduction)}</strong></div>` : ''}
                ${slabsHtml}
            </div>
        `;
    }).join('');
}

/**
 * Format a slab amount for display
 */
function formatSlabAmount(amount) {
    if (amount == null || amount === 0) return '0';
    const num = Number(amount);
    if (num >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`;
    if (num >= 100000) return `${(num / 100000).toFixed(1)}L`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num.toLocaleString();
}

/**
 * Select a regime card
 */
function selectRegimeCard(regimeCode) {
    selectedTaxRegimeCode = regimeCode;

    // Update card selection UI
    document.querySelectorAll('#taxRegimeCardsContainer .regime-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.regimeCode === regimeCode);
    });

    // Enable save button
    document.getElementById('taxRegimeSaveBtn').disabled = false;
}

/**
 * Render side-by-side slab comparison table
 */
function renderRegimeComparison() {
    const section = document.getElementById('taxRegimeComparisonSection');
    const wrapper = document.getElementById('taxRegimeComparisonTable');
    const regimeKeys = Object.keys(taxConfigRegimes);

    if (regimeKeys.length < 2) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';

    // Find max slabs
    let maxSlabs = 0;
    regimeKeys.forEach(k => {
        const slabs = taxConfigRegimes[k]?.slabs || [];
        if (slabs.length > maxSlabs) maxSlabs = slabs.length;
    });

    if (maxSlabs === 0) {
        wrapper.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px;">No slab data available for comparison.</p>';
        return;
    }

    let headerRow = '<tr><th>Slab</th>';
    regimeKeys.forEach(k => {
        const name = taxConfigRegimes[k]?.regime_name || k;
        headerRow += `<th colspan="2">${name}</th>`;
    });
    headerRow += '</tr>';

    let subHeaderRow = '<tr><th></th>';
    regimeKeys.forEach(() => {
        subHeaderRow += '<th>Range</th><th>Rate</th>';
    });
    subHeaderRow += '</tr>';

    let bodyRows = '';
    for (let i = 0; i < maxSlabs; i++) {
        let row = `<tr><td>${i + 1}</td>`;
        regimeKeys.forEach(k => {
            const slabs = taxConfigRegimes[k]?.slabs || [];
            const s = slabs[i];
            if (s) {
                const from = formatSlabAmount(s.from || s.min || 0);
                const to = s.to || s.max ? formatSlabAmount(s.to || s.max) : '&infin;';
                row += `<td>${from} - ${to}</td><td>${s.rate || s.percentage || 0}%</td>`;
            } else {
                row += '<td>-</td><td>-</td>';
            }
        });
        row += '</tr>';
        bodyRows += row;
    }

    wrapper.innerHTML = `
        <table class="regime-comparison-table">
            <thead>${headerRow}${subHeaderRow}</thead>
            <tbody>${bodyRows}</tbody>
        </table>
    `;
}

/**
 * Save the selected tax regime
 */
async function saveTaxRegimeSelection() {
    if (!selectedTaxRegimeCode || !taxRegimeModalEmployeeId) return;

    const saveBtn = document.getElementById('taxRegimeSaveBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;"></div> Saving...';

    try {
        await api.request(`/hrms/statutory/employees/${taxRegimeModalEmployeeId}/tax-regime`, {
            method: 'POST',
            body: JSON.stringify({
                countryCode: taxConfigCountryCode,
                financialYear: taxConfigFinancialYear,
                regimeCode: selectedTaxRegimeCode,
                locked: false
            }),
            headers: { 'Content-Type': 'application/json' }
        });

        showToast('Tax regime updated successfully', 'success');
        closeModal('taxRegimeModal');

        // Refresh the table
        await loadTaxConfiguration();
    } catch (error) {
        console.error('Error saving tax regime:', error);
        showToast(error.message || 'Failed to save tax regime', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Selection`;
    }
}

// =====================================================
// STATUTORY FILING FUNCTIONS
// =====================================================

// Statutory Filing state
let sfAvailableReports = [];
let sfGeneratedArtifacts = [];
let sfApprovedPayrollRuns = [];
let sfCurrentArtifactId = null;

// Statutory Filing searchable dropdown instances
let sfPayrollRunDropdown = null;
let genArtifactPayrollRunDropdown = null;

/**
 * Initialize the statutory filing tab
 * Note: MonthPicker is initialized in populateYearDropdowns() with onChange callback
 */
function initStatutoryFilingTab() {
    // MonthPicker (sfMonthPicker) is already initialized in populateYearDropdowns()
    // with onChange callback that calls loadStatutoryFilingData()

    // Initialize searchable dropdown for filter bar payroll run
    const sfPayrollRunContainer = document.getElementById('sfPayrollRunContainer');
    if (sfPayrollRunContainer && !sfPayrollRunDropdown) {
        sfPayrollRunDropdown = new SearchableDropdown(sfPayrollRunContainer, {
            id: 'sfPayrollRun',
            options: [{ value: '', label: 'All Payroll Runs' }],
            placeholder: 'All Payroll Runs',
            searchPlaceholder: 'Search payroll runs...',
            value: '',
            compact: true,
            onChange: (value, option) => {
                onStatutoryPayrollRunChange();
            }
        });
    }

    // Initialize searchable dropdown for Generate Artifacts modal
    const genArtifactContainer = document.getElementById('genArtifactPayrollRunContainer');
    if (genArtifactContainer && !genArtifactPayrollRunDropdown) {
        genArtifactPayrollRunDropdown = new SearchableDropdown(genArtifactContainer, {
            id: 'genArtifactPayrollRun',
            options: [{ value: '', label: 'Select approved payroll run...' }],
            placeholder: 'Select approved payroll run...',
            searchPlaceholder: 'Search payroll runs...',
            value: '',
            compact: true,
            onChange: (value, option) => {
                onGenerateModalPayrollRunChange();
            }
        });
    }

    console.log('[StatutoryFiling] Tab initialized with searchable dropdowns');
}

/**
 * Load all data for statutory filing tab
 */
async function loadStatutoryFilingData() {
    try {
        showLoading();
        await Promise.all([
            loadAvailableReports(),
            loadApprovedPayrollRuns(),
            loadGeneratedArtifacts()
        ]);
        updateStatutoryStats();
    } catch (error) {
        console.error('Error loading statutory filing data:', error);
        showToast(error.message || 'Failed to load statutory filing data', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Load available report types for the country
 * COUNTRY-AGNOSTIC: Uses selected country from global filter, no hardcoded defaults
 */
async function loadAvailableReports() {
    const countryCode = selectedGlobalCountry;
    if (!countryCode) {
        console.log('[StatutoryFiling] No country selected, skipping report load');
        sfAvailableReports = [];
        renderAvailableReports();
        return;
    }
    try {
        const response = await api.request(`/hrms/statutory/artifacts/reports/${countryCode}`);
        sfAvailableReports = response || [];
        renderAvailableReports();
    } catch (error) {
        console.error('Error loading available reports:', error);
        sfAvailableReports = [];
        renderAvailableReports();
    }
}

/**
 * Load approved payroll runs for dropdowns
 */
async function loadApprovedPayrollRuns() {
    try {
        const pickerValue = sfMonthPicker?.getValue() || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
        const year = pickerValue.year;
        const month = pickerValue.month;

        let url = `/hrms/payroll-processing/runs?year=${year}`;
        if (month) url += `&month=${month}`;

        const response = await api.request(url);
        // Filter for approved or paid runs only
        sfApprovedPayrollRuns = (response || []).filter(r =>
            r.status === 'approved' || r.status === 'paid'
        );
        populatePayrollRunDropdowns();
    } catch (error) {
        console.error('Error loading approved payroll runs:', error);
        sfApprovedPayrollRuns = [];
        populatePayrollRunDropdowns();
    }
}

/**
 * Load generated artifacts for selected period
 */
async function loadGeneratedArtifacts() {
    const pickerValue = sfMonthPicker?.getValue() || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    const month = pickerValue.month;
    const year = pickerValue.year;
    const payrollRunId = sfPayrollRunDropdown?.getValue() || '';

    if (!month || !year) {
        sfGeneratedArtifacts = [];
        renderGeneratedArtifacts();
        return;
    }

    try {
        let response;
        if (payrollRunId) {
            // Load by specific payroll run
            response = await api.request(`/hrms/statutory/artifacts/payroll-run/${payrollRunId}`);
        } else {
            // Load by period
            response = await api.request(`/hrms/statutory/artifacts/period/${year}/${month}`);
        }
        sfGeneratedArtifacts = response || [];
        renderGeneratedArtifacts();
    } catch (error) {
        console.error('Error loading generated artifacts:', error);
        sfGeneratedArtifacts = [];
        renderGeneratedArtifacts();
    }
}

/**
 * Populate payroll run dropdowns using SearchableDropdown API
 */
function populatePayrollRunDropdowns() {
    // Build options array for searchable dropdowns
    const runOptions = sfApprovedPayrollRuns.map(run => {
        const period = `${getMonthNameShort(run.payroll_month)} ${run.payroll_year}`;
        const office = run.office_name || 'All Offices';
        const status = run.status.charAt(0).toUpperCase() + run.status.slice(1);
        return {
            value: run.id,
            label: `${run.run_code || run.id.substring(0, 8)} - ${period} - ${office} (${status})`,
            description: `${office} | ${status}`
        };
    });

    // Update filter bar dropdown (with "All Payroll Runs" option)
    if (sfPayrollRunDropdown) {
        const filterOptions = [
            { value: '', label: 'All Payroll Runs' },
            ...runOptions
        ];
        sfPayrollRunDropdown.setOptions(filterOptions);
    }

    // Update modal dropdown (with "Select..." placeholder)
    if (genArtifactPayrollRunDropdown) {
        const modalOptions = [
            { value: '', label: 'Select approved payroll run...' },
            ...runOptions
        ];
        genArtifactPayrollRunDropdown.setOptions(modalOptions);
    }
}

/**
 * Toggle collapsible section visibility
 */
function toggleCollapsibleSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.classList.toggle('collapsed');
}

/**
 * Render available report type cards (compact version)
 * COUNTRY-AGNOSTIC: Shows message when no country selected
 */
function renderAvailableReports() {
    const grid = document.getElementById('availableReportsGrid');
    const countEl = document.getElementById('availableReportsCount');
    if (!grid) return;

    // Update count in header
    if (countEl) {
        countEl.textContent = `(${sfAvailableReports?.length || 0})`;
    }

    // Show message if no country selected
    if (!selectedGlobalCountry) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <p style="color: var(--text-tertiary);">Please select a country from the filter to view available reports</p>
            </div>
        `;
        return;
    }

    if (!sfAvailableReports || sfAvailableReports.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <p style="color: var(--text-tertiary);">No report types configured for ${selectedGlobalCountry}</p>
            </div>
        `;
        return;
    }

    // Compact card layout - single row with key info
    grid.innerHTML = sfAvailableReports.map(report => `
        <div class="report-card-compact">
            <div class="report-card-compact-name">${escapeHtml(report.report_name)}</div>
            <div class="report-card-compact-meta">
                <span class="report-code">${escapeHtml(report.report_code)}</span>
                <span class="report-badge">${(report.format || 'txt').toUpperCase()}</span>
                <span class="report-freq">${escapeHtml(report.frequency || 'monthly')}</span>
            </div>
        </div>
    `).join('');
}

/**
 * Render generated artifacts table
 */
function renderGeneratedArtifacts() {
    const tbody = document.getElementById('generatedArtifactsTable');
    if (!tbody) return;

    // COUNTRY-AGNOSTIC: Show message when no country selected
    if (!selectedGlobalCountry) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M2 12h20"></path>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        <p>Please select a country from the filter</p>
                        <p class="hint">Choose a country to view generated statutory filings</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    if (!sfGeneratedArtifacts || sfGeneratedArtifacts.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <p>No artifacts generated for this period</p>
                        <p class="hint">Select a payroll run and click "Generate Artifacts" to create statutory filings</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // Get period from filter dropdowns since API doesn't return it
    const pickerValue = sfMonthPicker?.getValue() || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    const filterMonth = pickerValue.month;
    const filterYear = pickerValue.year;

    tbody.innerHTML = sfGeneratedArtifacts.map(artifact => `
        <tr>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="report-icon-small">${getReportIcon(artifact.report_code)}</span>
                    <div>
                        <strong>${escapeHtml(artifact.report_name || artifact.report_code)}</strong>
                        <div style="font-size: 12px; color: var(--text-tertiary);">${escapeHtml(artifact.report_code)}</div>
                    </div>
                </div>
            </td>
            <td>${getMonthNameShort(filterMonth)} ${filterYear}</td>
            <td>${escapeHtml(artifact.establishment_code || 'All')}</td>
            <td><span class="badge badge-info">${(artifact.format || 'txt').toUpperCase()}</span></td>
            <td>${artifact.row_count || 0}</td>
            <td>
                <div style="font-size: 13px;">${formatDateTimeShort(artifact.generated_at)}</div>
                <div style="font-size: 11px; color: var(--text-tertiary);">by ${escapeHtml(artifact.generated_by_name || 'System')}</div>
            </td>
            <td>
                <span class="badge ${artifact.download_count > 0 ? 'badge-success' : 'badge-secondary'}">${artifact.download_count || 0}</span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-icon btn-ghost" onclick="downloadArtifact('${artifact.id}')" title="Download">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                    <button class="btn btn-icon btn-ghost" onclick="viewArtifactDetails('${artifact.id}')" title="Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M12 16v-4"></path>
                            <path d="M12 8h.01"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Update statutory filing stats
 */
function updateStatutoryStats() {
    const totalArtifacts = sfGeneratedArtifacts.length;
    const totalDownloads = sfGeneratedArtifacts.reduce((sum, a) => sum + (a.download_count || 0), 0);
    const availableCount = sfAvailableReports.length;
    const generatedCodes = new Set(sfGeneratedArtifacts.map(a => a.report_code));
    const pendingReports = availableCount - generatedCodes.size;
    const approvedRuns = sfApprovedPayrollRuns.length;

    const sfTotalArtifactsEl = document.getElementById('sfTotalArtifacts');
    const sfTotalDownloadsEl = document.getElementById('sfTotalDownloads');
    const sfPendingReportsEl = document.getElementById('sfPendingReports');
    const sfApprovedRunsEl = document.getElementById('sfApprovedRuns');

    if (sfTotalArtifactsEl) sfTotalArtifactsEl.textContent = totalArtifacts;
    if (sfTotalDownloadsEl) sfTotalDownloadsEl.textContent = totalDownloads;
    if (sfPendingReportsEl) sfPendingReportsEl.textContent = pendingReports > 0 ? pendingReports : 0;
    if (sfApprovedRunsEl) sfApprovedRunsEl.textContent = approvedRuns;
}

/**
 * Show generate artifacts modal
 * COUNTRY-AGNOSTIC: Requires country selection before generation
 */
function showGenerateArtifactsModal() {
    // Check if country is selected first
    if (!selectedGlobalCountry) {
        showToast('Please select a country from the filter first', 'warning');
        return;
    }

    // Check if there are approved payroll runs
    if (sfApprovedPayrollRuns.length === 0) {
        showToast('No approved payroll runs available. Please approve a payroll run first.', 'warning');
        return;
    }

    // Populate payroll run dropdown
    populatePayrollRunDropdowns();

    // Reset the modal dropdown selection
    if (genArtifactPayrollRunDropdown) {
        genArtifactPayrollRunDropdown.setValue('');
    }

    // Reset checkboxes
    const checkboxContainer = document.getElementById('reportCheckboxes');
    if (checkboxContainer) {
        checkboxContainer.innerHTML = '<p class="text-muted" style="margin: 0; font-size: 13px;">Select a payroll run to see available reports</p>';
    }

    // Reset regenerate checkbox
    const regenCheckbox = document.getElementById('genRegenerate');
    if (regenCheckbox) regenCheckbox.checked = false;

    openModal('generateArtifactsModal');
}

/**
 * Handle payroll run change in generate modal
 */
async function onGenerateModalPayrollRunChange() {
    const payrollRunId = genArtifactPayrollRunDropdown?.getValue() || '';
    const checkboxContainer = document.getElementById('reportCheckboxes');

    if (!payrollRunId || !checkboxContainer) {
        if (checkboxContainer) {
            checkboxContainer.innerHTML = '<p class="text-muted" style="margin: 0; font-size: 13px;">Select a payroll run to see available reports</p>';
        }
        return;
    }

    // COUNTRY-AGNOSTIC: Get country code from selected payroll run or global filter
    // No hardcoded defaults - user must select a country
    const selectedRun = sfApprovedPayrollRuns.find(r => r.id === payrollRunId);
    const countryCode = selectedRun?.country_code || selectedRun?.office_country_code || selectedGlobalCountry;
    if (!countryCode || countryCode === '') {
        checkboxContainer.innerHTML = '<p class="text-muted" style="margin: 0; font-size: 13px; color: var(--color-warning);">Please select a country from the filter first</p>';
        return;
    }

    try {
        // Load reports for this country
        const reports = await api.request(`/hrms/statutory/artifacts/reports/${countryCode}`);

        if (!reports || reports.length === 0) {
            checkboxContainer.innerHTML = '<p class="text-muted" style="margin: 0; font-size: 13px;">No report types configured for this country</p>';
            return;
        }

        checkboxContainer.innerHTML = reports.map(report => `
            <div class="report-toggle-item" style="display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border-secondary);">
                <label class="toggle-switch small" style="flex-shrink: 0;">
                    <input type="checkbox" value="${escapeHtml(report.report_code)}" checked>
                    <span class="toggle-slider"></span>
                </label>
                <span style="flex: 1; font-size: 13px; font-weight: 500; color: var(--text-primary);">${escapeHtml(report.report_name)}</span>
                <span class="badge badge-info" style="font-size: 10px;">${(report.format || 'txt').toUpperCase()}</span>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading reports for modal:', error);
        checkboxContainer.innerHTML = '<p class="text-muted" style="margin: 0; font-size: 13px; color: var(--color-error);">Failed to load report types</p>';
    }
}

/**
 * Generate statutory artifacts
 */
async function generateStatutoryArtifacts() {
    const payrollRunId = genArtifactPayrollRunDropdown?.getValue() || '';
    if (!payrollRunId) {
        showToast('Please select a payroll run', 'warning');
        return;
    }

    const selectedReports = Array.from(document.querySelectorAll('#reportCheckboxes input:checked'))
        .map(cb => cb.value);

    if (selectedReports.length === 0) {
        showToast('Please select at least one report to generate', 'warning');
        return;
    }

    const generateBtn = document.getElementById('generateArtifactsBtn');
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><div class="spinner" style="width:16px;height:16px;"></div> Generating...</span>';
    }

    try {
        const selectedRun = sfApprovedPayrollRuns.find(r => r.id === payrollRunId);
        // COUNTRY-AGNOSTIC: Get country code from payroll run or global filter
        // No hardcoded defaults - system must have a country selected
        const countryCode = selectedRun?.country_code || selectedRun?.office_country_code || selectedGlobalCountry;
        if (!countryCode || countryCode === '') {
            showToast('Please select a country from the filter first', 'warning');
            return;
        }

        // Get period from the MonthPicker
        const pickerValue = sfMonthPicker?.getValue() || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
        const month = pickerValue.month;
        const year = pickerValue.year;

        console.log('[StatutoryFiling] Generating artifacts with:', { countryCode, payrollRunId, month, year, selectedReports: selectedReports.length });

        const response = await api.request('/hrms/statutory/artifacts/generate-bulk', {
            method: 'POST',
            body: JSON.stringify({
                countryCode: countryCode,
                payrollRunId: payrollRunId,
                payrollMonth: month,
                payrollYear: year,
                reportCodes: selectedReports,
                regenerate: document.getElementById('genRegenerate')?.checked || false
            }),
            headers: { 'Content-Type': 'application/json' }
        });

        closeModal('generateArtifactsModal');

        const successCount = response.success_count || 0;
        const failCount = response.failed_count || 0;

        if (successCount > 0) {
            showToast(`Generated ${successCount} artifact(s) successfully${failCount > 0 ? `, ${failCount} failed` : ''}`, 'success');
        } else if (failCount > 0) {
            showToast(`Failed to generate ${failCount} artifact(s)`, 'error');
        }

        await loadStatutoryFilingData();
    } catch (error) {
        console.error('Error generating artifacts:', error);
        showToast(error.message || 'Failed to generate artifacts', 'error');
    } finally {
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg> Generate`;
        }
    }
}

/**
 * Download artifact file
 */
async function downloadArtifact(artifactId) {
    try {
        showToast('Downloading artifact...', 'info');

        const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
        const response = await fetch(`${CONFIG.hrmsApiBaseUrl}/statutory/artifacts/${artifactId}/download`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Download failed');
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'artifact.txt';

        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match && match[1]) {
                filename = match[1].replace(/['"]/g, '');
            }
        }

        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        showToast('Artifact downloaded successfully', 'success');

        // Refresh to update download count
        await loadGeneratedArtifacts();
        updateStatutoryStats();
    } catch (error) {
        console.error('Error downloading artifact:', error);
        showToast(error.message || 'Failed to download artifact', 'error');
    }
}

/**
 * View artifact details
 */
async function viewArtifactDetails(artifactId) {
    try {
        showLoading();

        const artifact = await api.request(`/hrms/statutory/artifacts/${artifactId}`);
        sfCurrentArtifactId = artifactId;

        const title = document.getElementById('artifactDetailsTitle');
        const content = document.getElementById('artifactDetailsContent');

        if (title) {
            // Support both camelCase (API) and snake_case (legacy)
            title.textContent = artifact.reportName || artifact.report_name || artifact.reportCode || artifact.report_code;
        }

        if (content) {
            // Support both camelCase (API response) and snake_case field names
            const reportCode = artifact.reportCode || artifact.report_code || '';
            const format = artifact.format || 'txt';
            const payrollMonth = artifact.payrollMonth || artifact.payroll_month;
            const payrollYear = artifact.payrollYear || artifact.payroll_year;
            const establishmentCode = artifact.establishmentCode || artifact.establishment_code || 'All';
            const rowCount = artifact.rowCount || artifact.row_count || 0;
            const fileName = artifact.fileName || artifact.file_name || 'N/A';
            const generatedAt = artifact.generatedAt || artifact.generated_at;
            const generatedByName = artifact.generatedByName || artifact.generated_by_name || 'System';
            const downloadCount = artifact.downloadCount || artifact.download_count || 0;
            const lastDownloadedAt = artifact.lastDownloadedAt || artifact.last_downloaded_at;

            content.innerHTML = `
                <div class="artifact-details-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Report Code</label>
                        <div style="font-size: 14px; margin-top: 4px;">${escapeHtml(reportCode)}</div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Format</label>
                        <div style="font-size: 14px; margin-top: 4px;"><span class="badge badge-info">${format.toUpperCase()}</span></div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Period</label>
                        <div style="font-size: 14px; margin-top: 4px;">${getMonthNameShort(payrollMonth)} ${payrollYear}</div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Establishment</label>
                        <div style="font-size: 14px; margin-top: 4px;">${escapeHtml(establishmentCode)}</div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Row Count</label>
                        <div style="font-size: 14px; margin-top: 4px;">${rowCount}</div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">File Name</label>
                        <div style="font-size: 14px; margin-top: 4px; word-break: break-all;">${escapeHtml(fileName)}</div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Generated At</label>
                        <div style="font-size: 14px; margin-top: 4px;">${formatDateTime(generatedAt)}</div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Generated By</label>
                        <div style="font-size: 14px; margin-top: 4px;">${escapeHtml(generatedByName)}</div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Download Count</label>
                        <div style="font-size: 14px; margin-top: 4px;">${downloadCount}</div>
                    </div>
                    <div class="detail-group">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Last Downloaded</label>
                        <div style="font-size: 14px; margin-top: 4px;">${lastDownloadedAt ? formatDateTime(lastDownloadedAt) : 'Never'}</div>
                    </div>
                </div>
                ${artifact.notes ? `
                    <div class="detail-group" style="margin-top: 16px;">
                        <label style="font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">Notes</label>
                        <div style="font-size: 14px; margin-top: 4px; padding: 12px; background: var(--bg-tertiary); border-radius: 6px;">${escapeHtml(artifact.notes)}</div>
                    </div>
                ` : ''}
            `;
        }

        openModal('artifactDetailsModal');
    } catch (error) {
        console.error('Error loading artifact details:', error);
        showToast(error.message || 'Failed to load artifact details', 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Download current artifact from details modal
 */
function downloadCurrentArtifact() {
    if (sfCurrentArtifactId) {
        downloadArtifact(sfCurrentArtifactId);
    }
}

/**
 * Handle statutory payroll run filter change
 */
function onStatutoryPayrollRunChange() {
    loadGeneratedArtifacts().then(() => updateStatutoryStats());
}

/**
 * Get report icon based on report code
 * Returns empty string - emojis removed for professional appearance
 */
function getReportIcon(reportCode) {
    return '';
}

/**
 * Get short month name
 */
function getMonthNameShort(month) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[(month || 1) - 1] || '';
}

/**
 * Format date time short
 */
function formatDateTimeShort(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

/**
 * Format full date time
 */
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}
